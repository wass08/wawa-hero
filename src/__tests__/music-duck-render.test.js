import {it,expect} from 'vitest';
import {loadTestPage} from './browser-page.js';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const chrome=process.env.CHROME_PATH||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
// Render a constant unit signal through the production music bus, measuring
// its gain envelope sample by sample. Offline rendering cannot play sound.
it.skipIf(!chrome)('renders miss depth/timing, retriggers, 2P pan and transport resets on the real audio graph',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wh-duck-render-'));let browser,ws;
 try{
  const source=[['music-duck.js','createMusicDuck'],['audio.js','createAudioPlayer'],['sfx.js','createSfx']].map(([file,name])=>`const ${name}=(()=>{${readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')}\nreturn ${name};})();`).join('\n');
  const script=`(async()=>{
    const rows=[];
    for(const scenario of ['solo','p1','p2','repeated','pause','seek','resume','stop','off']){
      const ctx=new OfflineAudioContext(2,67200,48000),realResume=ctx.resume.bind(ctx);
      // Initialize the production buses without trying to unlock offline output.
      ctx.resume=async()=>{};globalThis.AudioContext=function(){return ctx;};
      const audio=createAudioPlayer({muted:true});await audio.unlock();ctx.resume=realResume;
      // Meter upstream of the zero master. This route exists only in this
      // OfflineAudioContext and is never sent to an output device.
      audio.musicBus.connect(ctx.destination);
      const dc=ctx.createConstantSource();dc.offset.value=1;dc.connect(audio.musicBus);dc.start();
      const pans=[],nativePanner=ctx.createStereoPanner.bind(ctx);ctx.createStereoPanner=()=>{const node=nativePanner();pans.push(node);return node;};
      const sfx=createSfx(audio),players=scenario==='p1'||scenario==='p2'?2:1,player=scenario==='p2'?1:0;
      sfx.miss({at:.1,players,player});
      if(scenario==='repeated')for(const at of [.115,.13,.145,.16,.18,.2,.23,.27,.3])sfx.miss({at,players,player});
      const reset=['pause','seek','resume','stop','off'].includes(scenario),suspended=reset?ctx.suspend(.12):null;
      const rendering=ctx.startRendering();
      if(reset){await suspended;if(scenario==='off')sfx.setEnabled(false);else if(scenario==='seek')audio.seek(12);else if(scenario==='resume'){await audio.resume();}else audio[scenario]();if(ctx.state==='suspended')await realResume();}
      const data=(await rendering).getChannelData(0),sample=t=>data[Math.round(t*48000)]/.8;
      let min=1;for(const value of data)min=Math.min(min,value/.8);
      rows.push({scenario,gains:[0,.03,.18,.7].map(t=>sample(.1+t)),at300:sample(.4),final:sample(1.3),min,pan:pans[0].pan.value,clunks:sfx.counts.miss.scheduled,master:audio.masterGain.gain.value});
    }
    // Render the 2P clunk separately to verify audible energy is actually
    // biased to the intended side, rather than only checking pan metadata.
    const stereo=[];for(const player of [0,1]){const ctx=new OfflineAudioContext(2,24000,48000),bus=ctx.createGain();bus.gain.value=.7;bus.connect(ctx.destination);createSfx({ctx,sfxBus:bus,musicLevel:()=>.1,duckMusic(){}}).miss({at:.1,player,players:2});const buffer=await ctx.startRendering(),energy=[0,1].map(c=>buffer.getChannelData(c).reduce((sum,x)=>sum+x*x,0));stereo.push({player,energy});}
    return {rows,stereo};
  })()`;
  const html=join(dir,'duck.html');writeFileSync(html,'<!doctype html><title>Offline miss feedback test</title>');
  browser=spawn(chrome,['--headless=new','--mute-audio','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(dir,'profile')}`,'--remote-debugging-port=0',pathToFileURL(html).href+'?mute&fakeboard'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('Chrome CDP startup timeout')),10000);browser.stderr.on('data',chunk=>{text+=chunk;const m=text.match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)\//);if(m){clearTimeout(timeout);resolve(`http://127.0.0.1:${m[1]}`);}});browser.on('error',reject);});
  let page;for(let i=0;i<100&&!page;i++){page=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');if(!page)await new Promise(r=>setTimeout(r,30));}
  ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');await loadTestPage(ws,pathToFileURL(html).href+'?mute&fakeboard');
  const result=await new Promise((resolve,reject)=>{ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1){if(m.error||m.result.exceptionDetails)reject(Error(JSON.stringify(m)));else resolve(m.result.result.value);}});ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:source+'\n'+script,awaitPromise:true,returnByValue:true}}));});
  if(process.env.WH_DUCK_EVIDENCE)writeFileSync(process.env.WH_DUCK_EVIDENCE,JSON.stringify(result,null,2));
  expect(result.rows).toHaveLength(9);
  for(const row of result.rows){
    const versus=['p1','p2'].includes(row.scenario),target=10**((versus?-3.5:-6)/20);
    expect(row.master).toBe(0);expect(row.gains[0]).toBeCloseTo(1,4);expect(row.final).toBeCloseTo(1,4);expect(row.min).toBeGreaterThanOrEqual(10**(-9/20));
    if(['solo','p1','p2'].includes(row.scenario)){expect(row.gains[1]).toBeCloseTo(target,4);expect(row.gains[2]).toBeCloseTo(target,4);expect(row.gains[3]).toBeCloseTo(1,4);expect(row.clunks).toBe(1);}
    if(['pause','seek','resume','stop','off'].includes(row.scenario)){expect(row.gains[1]).toBeCloseTo(1,4);expect(row.gains[2]).toBeCloseTo(1,4);expect(row.at300).toBeCloseTo(1,4);}
    if(row.scenario==='repeated'){expect(row.clunks).toBe(10);expect(row.min).toBeCloseTo(target,4);}
    expect(row.pan).toBeCloseTo(row.scenario==='p1'?-.65:row.scenario==='p2'?.65:0);
  }
  expect(result.stereo[0].energy[0]).toBeGreaterThan(result.stereo[0].energy[1]*5);expect(result.stereo[1].energy[1]).toBeGreaterThan(result.stereo[1].energy[0]*5);
 }finally{ws?.close();if(browser&&browser.exitCode===null){const ended=once(browser,'close');browser.kill();await ended;}rmSync(dir,{recursive:true,force:true});}
},35000);
