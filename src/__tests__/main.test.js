import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const env=vi.hoisted(()=>({nodes:new Map(),events:{},storage:new Map(),now:0,elapsed:0,duration:5,suspended:false,failLoad:false,frame:null,trackerFactory:null,notes:[],cameraCues:[],tick:null,audio:null,camera:null,stage:null,results:null}));
vi.mock('../engine/stage.js',()=>({createStage:options=>{
  env.tick=options.onFrame;
  return env.stage=Object.fromEntries(['setMenuCamera','setPhotoCue','setShot','setWall','setBpm','setVideo','setHype','setMenu','setSongTime','setAvatarArms','setSkeleton','setAvatarLayout','strike','hit','setCamera','setFov'].map(k=>[k,vi.fn()]));
}}));
vi.mock('../hud/menu.js',()=>({
  $:id=>env.nodes.get(id),fmtTime:s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`,
  createWallPainter:()=>()=>{},createMenuHUD:()=>env.menu=({render:vi.fn(),flash:vi.fn()}),
}));
vi.mock('../hud/gameplay.js',()=>({createGameplayHUD:()=>({setSong:vi.fn(),judgement:vi.fn(),update:vi.fn()})}));
vi.mock('../hud/results.js',()=>({createResultsHUD:(_board,{onContinue})=>env.results={show:vi.fn(),setShots:vi.fn(),hide:vi.fn(),activity:vi.fn(),tick:vi.fn(),setBackProgress:vi.fn(),keydown:vi.fn(),primary:vi.fn(),leave:vi.fn(onContinue),movesBlocked:()=>document.activeElement?.tagName==='INPUT'&&!!document.activeElement.value}}));
vi.mock('../preview.js',()=>({createSongPreview:()=>({select:vi.fn(),refresh:vi.fn(),stop:vi.fn(async()=>{})})}));
vi.mock('../charts.js',()=>({siteURL:s=>s,loadCatalog:async()=>[{id:'song',title:'Song',bpm:120,duration:5,audio:'audio',moves:['up','down','clap','split_lu','split_ld','sweep']}],loadChart:async()=>({bpm:120,camera:env.cameraCues,notes:env.notes.map(n=>({...n}))})}));
vi.mock('../audio.js',()=>({createAudioPlayer:({muted})=>{
  const api={calibrationMs:0,muted,running:false,silent:false,
    get duration(){return env.duration;},get suspended(){return env.suspended;},
    unlock:vi.fn(async()=>{env.suspended=false;}),load:vi.fn(async()=>{if(env.failLoad)throw Error('missing audio');return env.duration;}),
    play:vi.fn(({silentClock})=>{api.silent=silentClock;api.running=true;env.elapsed=0;}),
    pause:vi.fn(()=>{api.running=false;}),resume:vi.fn(async()=>{api.running=true;}),stop:vi.fn(()=>{api.running=false;env.elapsed=0;}),cancelLoad:vi.fn(),
    getBuffer:vi.fn(async()=>({duration:4.8,numberOfChannels:1,getChannelData:()=>new Float32Array([.1,-.1])})),musicLevel:()=>.1,setVolumes:vi.fn(),contextTimeForSong:t=>t,playbackTime:()=>env.elapsed,songTime:()=>env.elapsed-api.calibrationMs/1000,perfToSongTime:t=>env.elapsed-api.calibrationMs/1000+(t-env.now)/1000,
  };return env.audio=api;
}}));
vi.mock('../camera.js',()=>({CAMERA_COPY:{avatar:['avatar','',''],live:['live','','']},createCamera:options=>{
  const api={status:'avatar',video:{},
    enable:vi.fn(async()=>{api.status='live';options.onStatus('live');await options.onLive(api.video);}),
    close:vi.fn(()=>{api.status='avatar';options.onStatus('avatar');}),restore:vi.fn(),
  };options.onStatus('avatar');return env.camera=api;
}}));
vi.mock('../pose/index.js',async importOriginal=>({...await importOriginal(),createPoseTracker:options=>env.trackerFactory(options)}));
const ids=['cameraPrompt','cameraMessage','cameraRetry','bodyStatus','backBtn','backFill','onePlayer','twoPlayers','onePlayerIcon','twoPlayersIcon','titleStart','titleClapIcon','playBtn','startGate','startBtn','resultSong','resultScore','resultStars','resultCombo','resultPerfect','resultGood','resultMiss','resultKcal','resultTime','newBest','chkDist','chkBody','trackTitle','trackSub','keyboardBtn','pauseBtn','resumeBtn','quitBtn','resultsBtn','weight','calibration'];
function node() {const classes=new Set();return {textContent:'',value:0,hidden:false,dataset:{},handlers:{},style:{},setAttribute(k,v){this[k]=v;},addEventListener(type,fn){this.handlers[type]=fn;},classList:{toggle(k,on){on?classes.add(k):classes.delete(k);},contains:k=>classes.has(k)}};}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}
async function boot({query='?state=play&mute&offline&demo',bests={},calibration=0}={}){
  env.storage.set('wh.bests',JSON.stringify(bests));env.storage.set('wh.settings',JSON.stringify({weightKg:70,calibrationMs:calibration}));
  vi.stubGlobal('location',{search:query});await import('../main.js');await settle();
  return window.wh;
}
function event(type,code,repeat=false){env.events[type]({code,target:{tagName:'BODY'},preventDefault(){},repeat});}
function tick(t){env.now=t*1000;env.elapsed=t;if(env.frame)env.frame.t=env.now;env.tick({},1/60,env.now);}
function advance(start,end,step=.02){for(let ms=Math.round(start*1000);ms<=Math.round(end*1000);ms+=Math.round(step*1000))tick(ms/1000);}
function pose(scores={}) {return {t:env.now,source:'camera',tracked:true,upperBody:true,scores:{up:0,down:0,clap:0,split_lu:0,split_ld:0,overhead:0,low:0,...scores},arms:null,landmarks:null,armAngle:{left:0,right:0},elbowStraight:{left:1,right:1},energy:0};}
beforeEach(()=>{
  vi.resetModules();env.nodes=new Map(ids.map(id=>[id,node()]));env.events={};env.storage=new Map();env.now=env.elapsed=0;env.duration=5;env.suspended=false;env.failLoad=false;env.frame=null;env.notes=[{t:1,move:'up'}];
  env.cameraCues=[];
  env.trackerFactory=async()=>({updateAll:()=>[env.frame,null],setMaxPlayers:vi.fn(),close:vi.fn(),stats:{}});
  vi.stubGlobal('window',{});vi.stubGlobal('document',{});vi.stubGlobal('addEventListener',(type,fn)=>{env.events[type]=fn;});
  vi.stubGlobal('localStorage',{getItem:k=>env.storage.get(k),setItem:(k,v)=>env.storage.set(k,v)});
  vi.spyOn(performance,'now').mockImplementation(()=>env.now);vi.spyOn(console,'warn').mockImplementation(()=>{});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('game integration audit regressions',()=>{
  it('enters the results cheer once and leaves it when returning to songs',async()=>{const app=await boot();tick(5);expect(app.state).toBe('results');expect(app.cheer.counts.entered).toBe(1);tick(5.1);expect(app.cheer.counts.entered).toBe(1);env.results.leave();expect(app.state).toBe('songs');expect(env.audio.getBuffer).toHaveBeenCalledExactlyOnceWith('sfx/stadium-cheer.mp3');});
  it('keeps exactly one shared photo shutter trigger in a versus run',async()=>{
    env.notes=[{t:1,move:'up'},{t:2,move:'photo'}];
    const app=await boot({query:'?state=play&players=2&mute&offline&demo'});
    for(const time of [.6,1,1.5,2,2.1,2.5])tick(time);
    expect(app.sfx.counts.shutter.attempted).toBe(1);
    expect(app.photoNotes[0].photoTaken).toBe(true);
  });
  it('returns to the title after a camera LEFT UP hold and consumes the held edge',async()=>{
    const app=await boot({query:'?state=songs&players=2&mute&offline&demo'});await env.camera.enable();
    env.frame=pose({split_lu:1});tick(.1);expect(app.state).toBe('songs');
    advance(.12,.82);expect(env.nodes.get('backFill').style.strokeDasharray).toBe('50 100');
    advance(.84,1.44);expect(app.state).toBe('title');env.nodes.get('twoPlayers').handlers.click();tick(1.4);expect(app.players).toHaveLength(2);
  });
  it('composites one live camera behind title and song text, preserving fallback and gameplay',async()=>{const app=await boot({query:'?mute&offline&demo'});expect(env.stage.setMenuCamera).toHaveBeenLastCalledWith(false);await env.camera.enable();expect(env.stage.setVideo).toHaveBeenCalledTimes(1);expect(env.stage.setMenuCamera).toHaveBeenLastCalledWith(true);expect(env.stage.setWall).toHaveBeenLastCalledWith('cam');env.nodes.get('titleStart').handlers.click();expect(app.state).toBe('tutorial');expect(env.stage.setMenuCamera).toHaveBeenLastCalledWith(false);});
  it.each(['title','songs'])('routes the %s wall to a painted canvas without a camera, and to the menu composite when live',async state=>{
    await boot({query:`?state=${state}&mute&offline&demo`});
    expect(env.stage.setWall).toHaveBeenLastCalledWith('canvas');
    expect(env.stage.setMenuCamera).toHaveBeenLastCalledWith(false);
    await env.camera.enable();
    expect(env.stage.setWall).toHaveBeenLastCalledWith('cam');
    expect(env.stage.setMenuCamera).toHaveBeenLastCalledWith(true);
  });
  it('routes a held results LEFT UP through the shared leave action',async()=>{const app=await boot();await env.camera.enable();tick(5);env.frame=pose({split_lu:1});advance(5.1,5.82);expect(env.results.setBackProgress).toHaveBeenLastCalledWith(.5);advance(5.84,6.44);expect(env.results.leave).toHaveBeenCalledTimes(1);expect(app.state).toBe('songs');});
  it('uses clickable title choices and a clap button without any keyboard option',async()=>{
    const app=await boot({query:'?mute&offline&demo'});
    env.nodes.get('twoPlayers').handlers.click();expect(app.players).toHaveLength(2);
    env.nodes.get('onePlayer').handlers.click();expect(app.players).toHaveLength(1);
    env.nodes.get('titleStart').handlers.click();expect(app.state).toBe('tutorial');
  });

  it('keeps the lite model while switching player counts and reports the pending transition',async()=>{
    let finish;const tracker={maxPlayers:1,updateAll:()=>[null,null],setMaxPlayers:vi.fn(n=>new Promise(resolve=>{finish=()=>{tracker.maxPlayers=n;resolve();};})),close:vi.fn(),stats:{}};
    env.trackerFactory=vi.fn(async()=>tracker);const app=await boot({query:'?mute&offline&demo'});await env.camera.enable();
    expect(env.trackerFactory.mock.lastCall[0]).toMatchObject({model:'lite',maxPlayers:1});event('keydown','Digit5');expect(app.players).toHaveLength(2);expect(tracker.setMaxPlayers).toHaveBeenCalledWith(2);expect(app.poseStatus).toBe('switching');expect(env.nodes.get('bodyStatus').textContent).toBe('Switching tracker…');finish();await settle();expect(app.poseStatus).toBe('ready');
  });

  it('keeps photo notes out of both judges, score totals, combos and misses',async()=>{
    env.notes=[{t:1,move:'up'},{t:2,move:'photo'},{t:3,move:'down'}];
    const app=await boot({query:'?state=play&players=2&mute&offline&demo'});
    tick(.9);event('keydown','Digit1');event('keydown','Digit7');tick(.92);tick(.96);tick(1);tick(1.06);
    for(const p of app.players){expect(p.notes.map(n=>n.move)).toEqual(['up','down']);expect(p.score.score).toBe(100);expect(p.score.stars).toBe(2);}
    tick(1.5);expect(env.stage.setPhotoCue).toHaveBeenLastCalledWith(1);
    tick(2);tick(2.6);
    for(const p of app.players){expect(p.score.combo).toBe(1);expect(p.score.stats).toEqual({perfect:1,good:0,miss:0});}
    expect(app.photoNotes[0].photoTaken).toBe(true);
  });

  it('enters results and saves a positive score with wh.bests=42 (#1)',async()=>{
    const app=await boot({bests:42});tick(0.9);event('keydown','Digit1');tick(0.92);tick(0.96);tick(1);tick(1.06);
    expect(app.score.score).toBeGreaterThan(0);tick(5);expect(app.state).toBe('results');
    expect(JSON.parse(env.storage.get('wh.bests'))['song']).toBe(app.score.score);
  });
  it('judges a synthetic release before null-frame expiry (#3)',async()=>{
    const app=await boot();tick(0.5);event('keydown','Digit1');
    for(let i=30;i<=77;i++)tick(i/60);
    env.now=1305;env.elapsed=1.305;event('keyup','Digit1');tick(1.3167);
    expect(app.notes[0].uiResult).toBe('good');expect(app.score.stats.miss).toBe(0);
  });
  it('recovers a cached page into a resumable pause and reacquires camera/tracker (#4)',async()=>{
    const app=await boot();await env.camera.enable();const old=env.trackerFactory=vi.fn(async()=>({updateAll:()=>[null,null],setMaxPlayers:vi.fn(),close:vi.fn(),stats:{}}));
    tick(0.5);env.events.pagehide({persisted:true});expect(app.state).toBe('pause');expect(env.audio.running).toBe(false);expect(env.camera.status).toBe('avatar');
    env.events.pageshow({persisted:true});await settle();expect(env.camera.restore).toHaveBeenCalledOnce();expect(env.camera.status).toBe('live');expect(old).toHaveBeenCalledOnce();
    await env.nodes.get('resumeBtn').handlers.click();expect(app.state).toBe('play');expect(env.audio.running).toBe(true);
  });
  it('migrates old calibration without shifting the playback clock (#5)',async()=>{
    const app=await boot({calibration:-1000});tick(4.1);expect(app.songTime).toBeCloseTo(4.1);expect(app.state).toBe('play');
    tick(5);expect(app.state).toBe('results');expect(env.nodes.get('resultTime').textContent).toBe('0:05');
  });
  it('keeps results visible when a gameplay clap remains held (#7)',async()=>{
    const app=await boot();await env.camera.enable();env.frame=pose({clap:1});tick(4.98);tick(5);expect(app.state).toBe('results');
    tick(5.02);expect(app.state).toBe('results');env.frame.scores.clap=0;tick(5.04);env.frame.scores.clap=1;tick(5.1);expect(app.state).toBe('results');
  });
  it('allows camera LEFT UP to cancel countdown (#8)',async()=>{
    env.suspended=true;const app=await boot();await env.nodes.get('startBtn').handlers.click();expect(app.state).toBe('count');
    await env.camera.enable();env.frame=pose({split_lu:1});advance(.1,.24);expect(app.state).toBe('songs');env.frame.scores.split_lu=0;tick(5);expect(app.state).toBe('songs');expect(env.audio.running).toBe(false);
  });
  it('explicitly chooses silent mode after load failure even if an old duration exists (#9)',async()=>{
    env.failLoad=true;const app=await boot();expect(env.nodes.get('startBtn').textContent).toBe('Start with silent audio');
    await env.nodes.get('startBtn').handlers.click();expect(app.state).toBe('play');expect(env.audio.play).toHaveBeenCalledWith({silentClock:true});
  });
  it('closes a tracker whose initialization finishes after pagehide (#10)',async()=>{
    await boot();let finish;const resource={updateAll:()=>[null,null],setMaxPlayers:vi.fn(),close:vi.fn(),stats:{}};
    env.trackerFactory=()=>new Promise(r=>{finish=r;});const enable=env.camera.enable();await settle();
    env.events.pagehide({persisted:true});finish(resource);await enable;expect(resource.close).toHaveBeenCalledOnce();expect(window.wh.poseStats).toBeUndefined();
  });
  it('drives chart shots from audio time and freezes them across gameplay pause',async()=>{
    env.cameraCues=[{t:0,shot:'wide',ease:0},{t:2,shot:'low_left',ease:1}];const app=await boot();
    tick(1);expect(app.shot).toBe('wide');const before=structuredClone(env.stage.setShot.mock.lastCall[0]);
    env.nodes.get('pauseBtn').handlers.click();tick(3);expect(env.stage.setShot.mock.lastCall[0]).toEqual(before);
    await env.nodes.get('resumeBtn').handlers.click();tick(3);expect(app.shot).toBe('low_left');
  });
  it('passes the operator position to the live-avatar layout and restores the centred fallback',async()=>{
    env.cameraCues=[{t:0,shot:'low_left',ease:0},{t:2,shot:'low_right',ease:0}];await boot();
    await env.camera.enable();tick(0);
    expect(env.stage.setAvatarLayout.mock.lastCall).toEqual([true,-11]);
    tick(2);expect(env.stage.setAvatarLayout.mock.lastCall).toEqual([true,11]);
    env.camera.close();tick(2.1);expect(env.stage.setAvatarLayout.mock.lastCall[0]).toBe(false);
  });
  it('judges identical chart notes independently for P1 and P2 keyboard inputs',async()=>{
    const app=await boot({query:'?state=play&players=2&mute&offline&demo'});
    tick(.9);event('keydown','Digit1');event('keydown','Digit7');tick(.92);tick(.96);tick(1);tick(1.06);
    expect(app.players).toHaveLength(2);expect(app.players[0].score.score).toBe(100);expect(app.players[1].score.score).toBe(100);
    expect(app.players[0].notes[0]).not.toBe(app.players[1].notes[0]);tick(5);expect(app.state).toBe('results');
  });
  it('shows practice before the first song and lets title moves select solo or versus',async()=>{
    const app=await boot({query:'?mute&offline&demo'});event('keydown','Digit5');expect(app.players).toHaveLength(2);
    event('keyup','Digit5');event('keydown','Digit4');expect(app.players).toHaveLength(1);
    event('keyup','Digit4');event('keydown','Space');expect(app.state).toBe('tutorial');expect(env.audio.play).not.toHaveBeenCalled();
  });
  it('suppresses pose menu actions while entering a results name and consumes held edges',async()=>{
    const app=await boot();await env.camera.enable();tick(5);expect(app.state).toBe('results');
    document.activeElement={tagName:'INPUT',value:'Kai'};env.frame=pose({clap:1});advance(5.1,5.24);expect(app.state).toBe('results');
    document.activeElement=undefined;tick(5.3);expect(app.state).toBe('results');
    expect(env.results.primary).not.toHaveBeenCalled();env.frame.scores.clap=0;advance(5.4,5.9);env.frame.scores.clap=1;advance(6,6.14);expect(app.state).toBe('results');expect(env.results.primary).toHaveBeenCalledTimes(1);
  });

});


describe('menu activation integration',()=>{
  it('updates the tracker once per rAF, ignores duplicate captures, and never routes P2 in 1P',async()=>{
    await boot({query:'?state=songs&mute&offline&demo'});
    const tracker={updateAll:vi.fn(()=>[env.frame,{...pose({split_ld:1}),t:env.now,source:'camera:1',player:1}]),update:vi.fn(),close:vi.fn(),setMaxPlayers:vi.fn()};
    env.trackerFactory=async()=>tracker;await env.camera.enable();env.frame=pose({split_ld:1});env.frame.t=0;
    for(let i=0;i<60;i++){env.now=i*1000/60;env.tick({},1/60,env.now);}
    expect(tracker.updateAll).toHaveBeenCalledTimes(60);expect(tracker.update).not.toHaveBeenCalled();
    expect(window.wh.players[0].menu.debug()).toMatchObject({processed:1,duplicates:59,confirmMs:0});expect(env.menu.flash).not.toHaveBeenCalled();
    advance(1,1.14);expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_ld')).toHaveLength(1);
  });
  it('holds the camera latch through dropout → re-acquire and a different transition move',async()=>{
    await boot({query:'?state=songs&mute&offline&demo'});await env.camera.enable();env.frame=pose({split_ld:.8});advance(0,.2);
    env.frame.tracked=false;advance(.22,.8);env.frame.tracked=true;env.frame.scores={clap:.9,split_ld:0};advance(.82,.9);
    env.frame.scores={split_ld:.8};advance(.92,2);
    expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_ld')).toHaveLength(1);expect(env.menu.flash.mock.calls.filter(([move])=>move==='clap')).toHaveLength(0);
  });
  it('pauses a Back fill during lost tracking, and never counts the lost interval',async()=>{
    const app=await boot({query:'?state=songs&mute&offline&demo'});await env.camera.enable();env.frame=pose({split_lu:1});advance(.1,.82);
    expect(env.nodes.get('backFill').style.strokeDasharray).toBe('50 100');env.frame.tracked=false;advance(.84,2);
    expect(env.nodes.get('backFill').style.strokeDasharray).toBe('50 100');expect(app.state).toBe('songs');env.frame.tracked=true;advance(2.02,2.6);expect(app.state).toBe('songs');
    advance(2.62,2.64);expect(app.state).toBe('title');expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_lu')).toHaveLength(1);
  });

  it('fires song next only once through five seconds of a noisy held RIGHT UP',async()=>{
    await boot({query:'?state=songs&mute&offline&demo'});await env.camera.enable();env.frame=pose({split_ld:1});
    for(let i=0;i<=250;i++){env.frame.scores.split_ld=i%5===0?.6:1;tick(i/50);}
    expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_ld')).toHaveLength(1);
    env.frame.scores.split_ld=0;advance(5.1,5.6);env.frame.scores.split_ld=1;advance(5.7,5.84);
    expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_ld')).toHaveLength(2);
  });
  it('fires previous once before the deliberate Back hold and never repeats it on title',async()=>{
    const app=await boot({query:'?state=songs&players=2&mute&offline&demo'});await env.camera.enable();env.frame=pose({split_lu:1});
    advance(.1,.82);expect(env.nodes.get('backFill').style.strokeDasharray).toBe('50 100');advance(.84,1.44);expect(app.state).toBe('title');
    env.nodes.get('twoPlayers').handlers.click();for(let i=70;i<250;i++)tick(i/50);
    expect(app.players).toHaveLength(2);expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_lu')).toHaveLength(1);expect(env.menu.flash.mock.calls.filter(([move])=>move==='back')).toHaveLength(1);
  });
  it('consumes a results Back hold across results → songs rather than cascading to title',async()=>{
    const app=await boot();await env.camera.enable();tick(5);env.frame=pose({split_lu:1});advance(5.1,6.44);expect(app.state).toBe('songs');
    for(let i=320;i<550;i++)tick(i/50);expect(env.results.leave).toHaveBeenCalledTimes(1);expect(app.state).toBe('songs');
  });
  it('each player can activate the same move once without a shared cooldown',async()=>{
    await boot({query:'?state=songs&players=2&mute&offline&demo'});let second=null;env.trackerFactory=async()=>({updateAll:()=>[env.frame,second],setMaxPlayers:vi.fn(),close:vi.fn()});await env.camera.enable();
    env.frame=pose({split_ld:1});advance(.1,.24);second={...pose({split_ld:1}),source:'camera:1',player:1};for(let t=.26;t<=.5;t+=.02){second.t=t*1000;tick(t);}
    expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_ld')).toHaveLength(2);
  });
  it('tutorial and results clap shortcuts latch until release',async()=>{
    await boot({query:'?state=tutorial&mute&offline&demo'});await env.camera.enable();env.frame=pose({clap:1});for(let i=0;i<250;i++)tick(i/50);
    expect(env.menu.flash.mock.calls.filter(([move])=>move==='clap')).toHaveLength(1);
  });
  it('a held results clap invokes the primary action only once',async()=>{
    const app=await boot();await env.camera.enable();tick(5);env.frame=pose({clap:1});for(let i=251;i<500;i++)tick(i/50);
    expect(app.state).toBe('results');expect(env.results.primary).toHaveBeenCalledTimes(1);
  });
  it('ignores keyboard autorepeat and the synthetic pose echo, but accepts a new keydown',async()=>{
    await boot({query:'?state=songs&mute&offline&demo'});event('keydown','ArrowDown');for(let i=0;i<200;i++){event('keydown','ArrowDown',true);tick(i/50);}
    expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_ld')).toHaveLength(1);
    event('keyup','ArrowDown');tick(4.1);event('keydown','ArrowDown');tick(4.2);expect(env.menu.flash.mock.calls.filter(([move])=>move==='split_ld')).toHaveLength(2);
  });
});
