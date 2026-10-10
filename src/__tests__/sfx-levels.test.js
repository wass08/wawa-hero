import {it,expect} from 'vitest';
import {loadTestPage} from './browser-page.js';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const chrome=process.env.CHROME_PATH||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
// A real Web Audio render, not a mock: available on developer/browser-test hosts.
it.skipIf(!chrome)('renders every procedural SFX through the 70% bus inside its RMS and peak budget',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wh-sfx-levels-'));
 let browser,ws;
 try{
  const source=readFileSync(new URL('../sfx.js',import.meta.url),'utf8').replace(/export /g,'');
  const script=`(async()=>{const rows=[];for(const [name,sound] of Object.entries(SFX_SOUNDS)){const ctx=new OfflineAudioContext(1,48000,48000),bus=ctx.createGain();bus.gain.value=.7;bus.connect(ctx.destination);createSfx({ctx,sfxBus:bus,musicLevel:()=>.1}).play(name,.1);const data=(await ctx.startRendering()).getChannelData(0);let peak=0,power=0,last=0;const from=4800,end=from+Math.ceil(sound.dur*48000);for(let i=from;i<end;i++){peak=Math.max(peak,Math.abs(data[i]));power+=data[i]*data[i];}for(let i=from;i<data.length;i++)if(Math.abs(data[i])>peak*.00001)last=i;const row={name,peak:20*Math.log10(peak),rms:20*Math.log10(Math.sqrt(power/(end-from))),target:sound.db+(sound.song?-20:0),durationMs:(last-from+1)/48};if(name==='shutter'){let first=0,second=0,firstAt=0,secondAt=0,gap=0,tail=0;for(let i=from;i<from+960;i++)if(Math.abs(data[i])>first){first=Math.abs(data[i]);firstAt=i;}for(let i=from+2880;i<from+4800;i++)if(Math.abs(data[i])>second){second=Math.abs(data[i]);secondAt=i;}for(let i=from+576;i<from+3360;i++)gap=Math.max(gap,Math.abs(data[i]));for(let i=from+3744;i<data.length;i++)tail=Math.max(tail,Math.abs(data[i]));Object.assign(row,{firstMs:(firstAt-from)/48,secondMs:(secondAt-from)/48,separationMs:(secondAt-firstAt)/48,firstDb:20*Math.log10(first),secondDb:20*Math.log10(second),gap,tail});}rows.push(row);}return rows;})()`;
  const html=join(dir,'levels.html');writeFileSync(html,'<!doctype html><title>Offline SFX level test</title>');
  browser=spawn(chrome,['--headless=new','--mute-audio','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(dir,'profile')}`,'--remote-debugging-port=0',pathToFileURL(html).href+'?mute&fakeboard'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('Chrome CDP startup timeout')),10000);browser.stderr.on('data',chunk=>{text+=chunk;const match=text.match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)\//);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`);}});browser.on('error',reject);});
  let page;for(let i=0;i<100&&!page;i++){page=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');if(!page)await new Promise(r=>setTimeout(r,30));}expect(page).toBeDefined();
  ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');await loadTestPage(ws,pathToFileURL(html).href+'?mute&fakeboard');
  const response=await new Promise((resolve,reject)=>{ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1){if(m.error||m.result.exceptionDetails)reject(Error(JSON.stringify(m)));else resolve(m.result.result.value);}});ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:source+'\n'+script,awaitPromise:true,returnByValue:true}}));});
  const rows=response,peaks={tick:-15.7,confirm:-13.5,back:-14.2,three:-12.6,two:-11.8,one:-10.8,go:-9.7};
  if(process.env.WH_SFX_EVIDENCE)writeFileSync(process.env.WH_SFX_EVIDENCE,JSON.stringify(rows,null,2));
  expect(rows).toHaveLength(9);for(const row of rows){expect(row.rms,`${row.name} RMS`).toBeCloseTo(row.target,1);if(peaks[row.name]){expect(row.peak,`${row.name} peak`).toBeGreaterThan(peaks[row.name]-1);expect(row.peak,`${row.name} peak`).toBeLessThan(peaks[row.name]+1);}else{expect(row.peak).toBeGreaterThan(-32);expect(row.peak).toBeLessThan(-18);}expect(row.peak).toBeLessThan(0);}
  const buzzer=rows.find(r=>r.name==='miss'),shutter=rows.find(r=>r.name==='shutter');
  expect(buzzer.durationMs).toBeGreaterThan(195);expect(buzzer.durationMs).toBeLessThanOrEqual(201);expect(buzzer.rms).toBeCloseTo(-30,1);
  expect(shutter.durationMs).toBeGreaterThan(76);expect(shutter.durationMs).toBeLessThanOrEqual(78);expect(shutter.separationMs).toBeGreaterThanOrEqual(60);expect(shutter.separationMs).toBeLessThanOrEqual(80);expect(shutter.secondDb).toBeGreaterThan(shutter.firstDb);expect(shutter.gap).toBe(0);expect(shutter.tail).toBe(0);
 }finally{ws?.close();if(browser&&browser.exitCode===null){const exited=once(browser,'close');browser.kill();await exited;}rmSync(dir,{recursive:true,force:true});}
},35000);
