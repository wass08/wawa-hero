import {it,expect} from 'vitest';
import {loadTestPage} from './browser-page.js';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const chrome=process.env.CHROME_PATH||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
// Real stage + real painter + real uniforms. No pose, camera, music or backend
// is initialized. Hold rAF so a delayed first paint cannot make the test pass.
it.skipIf(!chrome)('paints menu walls before the first frame with and without a live camera',async()=>{
 const markup=readFileSync(new URL('../../index.html',import.meta.url),'utf8').match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script\b[\s\S]*?<\/script>/g,'');
 const dir=mkdtempSync(join(tmpdir(),'wh-wall-render-'));let server,browser,ws;
 try{
  server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'silent',plugins:[{name:'wall-test',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.startsWith('/__wall-test')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Wall regression</title><style>#stage{width:800px;height:450px}</style>'+markup);}else next();});}}]});
  await server.listen();const port=server.httpServer.address().port;
  browser=spawn(chrome,['--headless=new','--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(dir,'profile')}`,'--remote-debugging-port=0',`http://127.0.0.1:${port}/__wall-test?mute&fakeboard`],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('Chrome CDP startup timeout')),10000);browser.stderr.on('data',chunk=>{text+=chunk;const m=text.match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)\//);if(m){clearTimeout(timeout);resolve(`http://127.0.0.1:${m[1]}`);}});browser.on('error',reject);});
  let page;for(let i=0;i<100&&!page;i++){page=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.type==='page');if(!page)await new Promise(r=>setTimeout(r,30));}
  ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');await loadTestPage(ws,`http://127.0.0.1:${port}/__wall-test?mute&fakeboard`);
  const expression=`(async()=>{
    const {createStage}=await import('/src/engine/stage.js');
    const {createWallPainter}=await import('/src/hud/menu.js');
    const texts=[];let canvas,frames=0;
    const original=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.width===1600){texts.push(text);canvas=this.canvas;}return original.call(this,text,...args);};
    window.requestAnimationFrame=()=>{frames++;};
    const model={state:'songs',song:{title:'Arms Up, Arms Down',bpm:137,moves:['up','down','clap','sweep']},menuCamera:false};
    const stage=createStage({container:document.getElementById('stage'),video:document.createElement('video'),wall:'cam',jumbotron:true,crowd:false,drawWall:createWallPainter(()=>model)});
    const rows=[];
    for(const state of ['songs','title'])for(const live of [false,true]){
      model.state=state;model.menuCamera=live;stage.setVideo(live);stage.setMenuCamera(live);texts.length=0;
      stage.setWall(live?'cam':'canvas');
      const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let bright=0,transparent=0;for(let i=0;i<data.length;i+=4){if(data[i]+data[i+1]+data[i+2]>450)bright++;if(data[i+3]===0)transparent++;}
      rows.push({state,live,texts:[...texts],bright,transparent,...stage.wallDebug});
    }
    // Exercise the real renderers, not just their shared move table.
    const {MOVES,CUES}=await import('/src/moves.js');
    const {MENU_LABELS}=await import('/src/menu-controls.js');
    const {hydrateButtons}=await import('/src/hud/button.js');hydrateButtons();
    const {createMenuHUD}=await import('/src/hud/menu.js');
    const {createGameplayHUD}=await import('/src/hud/gameplay.js');
    const {createTutorial}=await import('/src/hud/tutorial.js');
    const {createReviewHUD}=await import('/src/review/hud.js');
    const {emptyScore}=await import('/src/game/versus.js');
    const song={id:'label-test',title:'Label test',bpm:120,duration:10,moves:['split_ld'],energy:1};
    const menu=createMenuHUD([song],()=>{});menu.render('songs',0);
    const legendMoves={songs:[...document.querySelectorAll('#legend [data-m]')].map(b=>b.dataset.m)};
    const labels={move:MOVES.split_ld.label,cue:CUES.split_ld.label,menu:MENU_LABELS.split_ld,
      title:document.querySelector('#twoPlayers .move-badge-name').textContent,
      legend:document.querySelector('#legend [data-m="split_ld"] .move-badge-name').textContent};
    menu.render('tutorial',0);legendMoves.tutorial=[...document.querySelectorAll('#legend [data-m]')].map(b=>b.dataset.m);labels.tutorialLegend=document.querySelector('#legend [data-m="split_ld"] .move-badge-name').textContent;
    menu.render('count',0);legendMoves.count=[...document.querySelectorAll('#legend [data-m]')].map(b=>b.dataset.m);
    const backBadges=['backBtn','tutorialBack'].map(id=>document.querySelector('#'+id+' .move-badge').dataset.move);
    const tutorial=createTutorial({stage:{},onDone(){}});tutorial.start(0);
    for(let i=0;i<4;i++)tutorial.move('next',0);
    labels.tutorialCard=document.querySelector('#tutorialMoves .active .move-badge-name').textContent;
    labels.tutorialTitle=document.getElementById('tutorialName').textContent;
    const instruction=document.getElementById('tutorialInstruction').textContent;
    const chart={bpm:120,notes:[{t:1,move:'split_ld'}],sections:[]};
    const gameplay=createGameplayHUD();gameplay.setSong(song,chart);gameplay.update(emptyScore(),0,10,0,0);
    labels.rail=document.querySelector('#railTrack .cue-head b').textContent;
    const review=createReviewHUD({song,chart,duration:10,cameraCues:[],params:new URLSearchParams('mute&fakeboard'),
      getState:()=>({camera:'avatar',rate:1}),onToggle(){},onSeek(){},onRate(){},onLoop(){},onCamera(){},onSfx(){}});
    review.update(0);labels.inspector=document.querySelector('.review-note-move').textContent;
    const oldLook=stage.jumboLook;stage.setMenuCamera(true);
    const photo=await stage.captureJumbotron();const dimensions=await createImageBitmap(photo);
    const capture={width:dimensions.width,height:dimensions.height,type:photo.type,size:photo.size,look:stage.jumboLook,mix:stage.wallDebug.mix};dimensions.close();
    return {rows,frames,labels,instruction,capture,oldLook,legendMoves,backBadges};
  })()`;
  const result=await new Promise((resolve,reject)=>{ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1){if(m.error||m.result.exceptionDetails)reject(Error(JSON.stringify(m)));else resolve(m.result.result.value);}});ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
  expect(result.legendMoves).toEqual({songs:['split_lu','split_ld','clap'],tutorial:['split_lu','split_ld','clap'],count:['down']});expect(result.backBadges).toEqual(['down','down']);
  expect(result.capture).toMatchObject({width:960,height:540,type:'image/webp',mix:1});expect(result.capture.size).toBeLessThanOrEqual(200*1024);expect(result.capture.look).toEqual(result.oldLook);expect(result.oldLook).toMatchObject({tones:10,rows:100});
  for(const [surface,label] of Object.entries(result.labels))expect(label,surface).toBe('RIGHT UP');
  expect(result.instruction).toBe('Right forearm up, left forearm down');
  expect(result.frames).toBe(1);expect(result.rows).toHaveLength(4);
  for(const row of result.rows){
    expect(row.texts).toEqual(row.state==='songs'?['NOW SELECTED','ARMS UP, ARMS DOWN','137',' BPM']:['WAWA HERO','The rhythm game you play with your arms','CLAP TO START']);
    expect(row.bright).toBeGreaterThan(1000);expect(row.paints).toBeGreaterThan(0);expect(row.textureVersion).toBeGreaterThan(1);expect(row.visible).toBe(true);
    expect(row.mode).toBe(row.live?'cam':'canvas');expect(row.mix).toBe(row.live?1:0);
    expect(row.menuCamera).toBe(row.live);expect(row.transparent>0).toBe(row.live);
  }
 }finally{ws?.close();if(browser&&browser.exitCode===null){const ended=once(browser,'close');browser.kill();await ended;}await server?.close();rmSync(dir,{recursive:true,force:true});}
},45000);
