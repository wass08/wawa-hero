import {loadGameFonts} from './typography.js';
import {createReviewBot} from './review/bot.js';
import './styles/review.css';
import {createReviewAudio} from './review/audio.js';
import {createReviewIndex,createReviewHUD} from './review/hud.js';
import {createSeekState,clampTime,reviewRate} from './review/logic.js';
import './styles/hud.css';
import './styles/results.css';
import { createStage } from './engine/stage.js';
import { MOVES,MOVE_IDS,iconSVG } from './moves.js';
import { createPoseTracker,createCalorieMeter,createJudge,MOVE_KEYS } from './pose/index.js';
import { createGameInput } from './input.js';
import { createResourceSlot } from './lifecycle.js';
import { createAudioPlayer } from './audio.js';
import { createSongPreview } from './preview.js';
import { createSfx, playJudgementSfx } from './sfx.js';
import { createResultsCheer } from './results-cheer.js';
import { createTopHeroes } from './hud/top-heroes.js';
import { createMenuDebug } from './hud/menu-debug.js';
import { createShotScheduler } from './engine/shots.js';
import { MENU_MOVES,menuActionForMove,menuMoveForKey,titleChoice,createBackHold,createMenuActivation } from './menu-controls.js';
import { createCamera } from './camera.js';
import { loadCatalog,loadChart,siteURL } from './charts.js';
import { settings,saveSettings,saveBest } from './settings.js';
import { createMenuHUD,createWallPainter,fmtTime,$ } from './hud/menu.js';
import { createGameplayHUD } from './hud/gameplay.js';
import { starsHTML } from './hud/helpers.js';
import { P2_KEYS,modeCount,emptyScore,cloneNotes,sweepDescent,allReleased } from './game/versus.js';
import { updatePlayers,setTrackerPlayers } from './services/pose.js';
import { createBoardClient } from './services/scoreboard.js';
import { createHomeHUD } from './hud/home.js';
import { createTutorial } from './hud/tutorial.js';
import { createResultsHUD } from './hud/results.js';
import {createPhotoCueScheduler} from './game/photo-cues.js';
import {createPhotoHUD} from './hud/photo.js';
import { createHeroCollector } from './game/photos.js';
const params=new URLSearchParams(location.search),review=params.has('review'),autoplay=review||params.has('autoplay');
const fontsReady=loadGameFonts();
const songs=await loadCatalog();
await fontsReady;
if(review&&!params.get('song')){createReviewIndex(songs,params);window.wh={state:'review-index'};}else{
// Review is a local tool: it never contacts the scoreboard or offers saving.
const board=await createBoardClient(review?new URLSearchParams('offline'):params);
const CAMS={title:{pos:[0,2,10.2],look:[0,4.9,-6]},songs:{pos:[0,2.3,13.5],look:[0,5.4,-6]},play:{pos:[0,1.5,11.5],look:[0,3.3,-4]},tutorial:{pos:[0,2.3,10.5],look:[0,3.7,-4]}};
let state='title',sel=Math.max(0,songs.findIndex(s=>s.id===params.get('song'))),playerCount=review?1:modeCount(params.get('players')??params.get('mode')??settings.players);
let activePage=true,cameraWanted=false,recoverToSongs=false,audioReady=false,poseStatus='',keyboardBypass=false;
let chart=null,notes=[],maxScore=1,countAt=0,pendingStart=false,loading=false,runToken=0,duration=0,playedFor=0;
const trackerSlot=createResourceSlot(),score=emptyScore(),synthetic=createGameInput({player:0}),heldKeys=new Set(),pressedMoves=new Map();
const players=[0,1].map(i=>({index:i,score:i?emptyScore():score,input:i?createGameInput({player:1}):synthetic,held:i?new Set():heldKeys,judge:createJudge(),calories:createCalorieMeter({weightKg:70}),notes:[],resolved:new Set(),frame:null,releasePending:false,menu:createMenuActivation(),backHold:createBackHold(),botCursor:0,botMove:null,botNote:null,botReleaseAt:0}));
const cameraFrames=[null,null],frames=[null,null],skeletons=[null,null];
const menuDebug=params.has('menudebug')?createMenuDebug():null;
let lastTrack='',tutorialReturn='songs',heroShots=[],trackerSwitch=0;
let photoCues=null;
let reviewHUD=null,reviewLoop=null,reviewResumeToken=0,reviewWantsPlaying=false;
const audio=(review?createReviewAudio:createAudioPlayer)({muted:params.has('mute'),musicVolume:.8,sfxVolume:.7}),sfx=createSfx(audio);
const cheer=review?null:createResultsCheer(audio,siteURL('sfx/stadium-cheer.mp3'));void cheer?.preload();
const previews=createSongPreview(audio);
function cameraPrompt(status){const show=!review&&['requesting','blocked','unavailable'].includes(status)&&state!=='results';$('cameraPrompt').hidden=!show;$('cameraRetry').disabled=status==='requesting';$('cameraRetry').textContent=status==='requesting'?'Requesting camera…':'Try camera again';$('cameraMessage').textContent=status==='blocked'?'Allow camera access in your browser, then try again.':status==='unavailable'?'Connect a camera, then try again.':'Choose Allow in your browser to see yourself on stage.';}
let shots=createShotScheduler({}, {pinned:params.get('shot')}),currentShot='front',currentShotX=0;
const camera=createCamera({
  onStatus:cameraPrompt,
  async onLive(video){if(!activePage)return;stage.setVideo();syncWall();try{await trackerSlot.acquire(onStatus=>createPoseTracker({video,model:'lite',maxPlayers:playerCount,onStatus}),(s,detail)=>{poseStatus=s;if(s==='error')console.warn('Pose tracker:',detail);});switchTracker();}catch(e){if(activePage){poseStatus='error';console.warn('Pose tracker unavailable:',e);}}},
});
const gameplay=createGameplayHUD();
const menu=createMenuHUD(songs,i=>{if(state!=='songs')return;audio.unlock().then(()=>previews.refresh());if(sel===i){menuMove('clap');}else{sel=i;sfx.play('tick');render();}});
const stage=createStage({container:$('stage'),video:camera.video,camera:{pos:CAMS.title.pos,target:CAMS.title.look,fov:58},avatar:{x:0,z:.6,scale:1.45},wall:'cam',jumbotron:true,wallBox:{w:21,h:7.8,y:4.2,z:-6.2},crowd:true,crowdClearX:2.4,beams:.5,menu:true,drawWall:createWallPainter(()=>({state,song:songs[sel],countAt,menuCamera:camera.status==='live'&&['title','songs'].includes(state)})),onFrame:tick});
const home=createHomeHUD(board),resultHUD=createResultsHUD(board,{onContinue:()=>{sfx.play('confirm');go('songs');}});
const topHeroes=createTopHeroes(board,$('topHeroes'));
const tutorial=createTutorial({stage,onDone(){settings.tutorialSeen=true;saveSettings();if(tutorialReturn==='prepare'){go('songs');prepareGame();}else go(tutorialReturn);}});
const photoHUD=createPhotoHUD();
const heroes=createHeroCollector({capture:()=>stage.captureJumbotron?.(),bpm:songs[sel].bpm,onCapture(shot){if(shot.photo){photoHUD.show(shot);return;}photoHUD.flash();const toast=$('heroToast');if(toast){toast.classList.remove('taken');void toast.offsetWidth;toast.classList.add('taken');}}});
async function switchTracker(){const tracker=trackerSlot.current;if(!tracker||tracker.closed||tracker.maxPlayers===playerCount)return;const token=++trackerSwitch;poseStatus='switching';$('bodyStatus').textContent='Switching tracker…';try{await setTrackerPlayers(tracker,playerCount);if(token===trackerSwitch&&tracker===trackerSlot.current){poseStatus='ready';lastTrack='';}}catch(e){if(token===trackerSwitch)poseStatus='error';console.warn('Tracker switch:',e);}}
function syncWall(){const menuFeed=camera.status==='live'&&['title','songs'].includes(state);stage.setMenuCamera?.(menuFeed);stage.setWall(menuFeed||['play','pause','tutorial'].includes(state)?'cam':'canvas');}
function render(){
  menu.render(state,sel);syncWall();stage.setBpm(songs[sel].bpm);
  topHeroes.select(state==='songs'?songs[sel].id:null);
  $('hud')?.setAttribute?.('data-players',playerCount);
  $('onePlayer').setAttribute('aria-pressed',String(playerCount===1));$('twoPlayers').setAttribute('aria-pressed',String(playerCount===2));
  if(state==='songs'&&!loading)previews.select(songs[sel]);else previews.stop();
  cameraPrompt(camera.status);
  if(state==='title'&&!review)home.refresh();
}

function setMode(count){playerCount=modeCount(count);if(playerCount===1){players[1].input.reset();players[1].held.clear();frames[1]=skeletons[1]=null;for(const [code,key] of pressedMoves)if(key.index===1)pressedMoves.delete(code);}settings.players=playerCount;saveSettings();stage.setPlayers?.(playerCount);switchTracker();audio.unlock().then(()=>sfx.play('tick'));render();}
function openTutorial(back='songs'){tutorialReturn=back;go('tutorial');tutorial.start(performance.now());}
function go(next,snap=false){
  if(next!=='results')cheer?.leave();
  for(const p of players){p.backHold.suspend();p.menu.suspend();}$('backFill').style.strokeDasharray='0 100';
  if(next!=='play')pendingStart=false;
  if(['songs','title','tutorial'].includes(next)){runToken++;loading=false;audio.stop();$('playBtn').disabled=false;$('playBtn').textContent='Choose this song';$('startGate').hidden=true;}
  if(!['play','pause'].includes(next)){photoCues?.suspend();stage.setPhotoCue?.(null);photoHUD.reset();}
  if(next!=='results')resultHUD.hide?.();
  state=next;if(review)stage.setPaused?.(state==='pause');const cam=CAMS[next==='title'?'title':next==='tutorial'?'tutorial':['songs','results'].includes(next)?'songs':'play'];
  stage.setFov(['play','pause','count'].includes(next)?58:54);stage.setCamera(cam.pos,cam.look,snap);stage.setWall(['title','play','pause','tutorial'].includes(next)?'cam':'canvas');stage.setMenu(['title','songs','results'].includes(next));render();
}
async function prepareGame(deep=false){
  if(loading)return;loading=true;const token=++runToken,silence=previews.stop();$('playBtn').disabled=true;$('playBtn').textContent='Loading song…';
  const song=songs[sel],chartPromise=loadChart(song);let ready=true;
  try{await audio.load(siteURL(song.audio));}catch(e){ready=false;console.warn(e);}
  const loaded=await chartPromise;await silence;if(token!==runToken)return;
  audioReady=ready;loading=false;$('playBtn').disabled=false;$('playBtn').textContent='Choose this song';chart=loaded;duration=audio.duration||song.duration;
  // The two judges mutate distinct notes; the rail gets its own shared visual track.
  notes=chart.notes;for(const n of notes){delete n.uiResult;delete n.uiProgress;delete n.photoTaken;}
  for(const p of players){p.notes=cloneNotes(notes);p.resolved=new Set();p.judge=createJudge();p.calories=createCalorieMeter({weightKg:70});Object.assign(p.score,emptyScore());p.botCursor=0;p.botMove=p.botNote=p.photoPose=null;p.releasePending=false;p.input.reset();p.held.clear();for(const n of p.notes)n.botOffset=review?0:(Math.random()-.5)*.075;}
  maxScore=players[0].notes.reduce((s,n,i)=>s+(n.move==='sweep'?300:100)*Math.min(4,1+Math.floor((i+1)/8)),0)||1;
  playedFor=0;heroShots=[];heroes.reset(song.bpm,notes);photoHUD.reset();photoCues=createPhotoCueScheduler(notes,{bpm:chart.bpm,onSchedule:cue=>sfx.play('shutter',audio.contextTimeForSong(cue.t)),onPose(cue){if(autoplay)for(const p of players){p.photoPose=MOVE_IDS[Math.floor(Math.random()*MOVE_IDS.length)];p.photoUntil=cue.t+.4;}},onSnap(cue){cue.photoTaken=true;stage.setPhotoCue?.(null);photoHUD.flash();heroes.photo({t:cue.t,realCamera:camera.status==='live'});}});pressedMoves.clear();stage.setHype(.55);stage.setPlayers?.(playerCount);
  shots=createShotScheduler(chart,{duration,pinned:params.get('shot')});gameplay.setSong(song,chart,playerCount);
  if(review){
    $('hud').setAttribute('data-review','true');document.title=`Chart review · ${song.title} · Wawa Hero`;
    reviewHUD=createReviewHUD({song,chart,duration,cameraCues:shots.cues,params,onToggle:()=>reviewWantsPlaying?pause():resume(),onSeek:reviewSeek,onRate:reviewSetRate,onLoop:reviewToggleLoop,onCamera:()=>camera.enable(),onSfx:()=>sfx.setEnabled(!sfx.enabled),getState:()=>({playing:state==='play',pending:reviewWantsPlaying&&state==='pause',rate:audio.rate,loop:reviewLoop,camera:camera.status,sfx:sfx.enabled})});
    if(!audioReady)reviewHUD.error('Audio unavailable · return to the review index to retry.');
    audio.setRate(reviewRate(params.get('rate')));go('pause',true);reviewSeek(Number(params.get('t'))||0);return;
  }
  if(autoplay){if(audio.suspended||!audioReady)startPlaying(true,deep);else if(deep)startPlaying(false,true);else beginCount();}
  else if(audio.suspended||!audioReady){go('play',deep);pendingStart=true;$('startGate').hidden=false;$('startBtn').textContent=audioReady?'Start song':'Start with silent audio';}
  else if(deep)startPlaying(false,true);else beginCount();
}
function beginCount(){go('count');countAt=performance.now();sfx.countdown();}
function startPlaying(silent=false,snap=false){go('play',snap);$('startGate').hidden=true;pendingStart=false;audio.play({silentClock:silent});}
async function unlockAndStart(){await audio.unlock();if(!activePage)return;previews.refresh();if(pendingStart){$('startGate').hidden=true;pendingStart=false;audioReady?beginCount():startPlaying(true);}}
function pause(){if(review){reviewWantsPlaying=false;reviewResumeToken++;audio.pause();}if(state!=='play'||pendingStart)return;if(!review)for(const p of players)p.input.pause(performance.now());shots.pause(audio.playbackTime());audio.pause();photoCues?.suspend();sfx.cancel();go('pause');}
async function resume(){if(state!=='pause')return;if(review)reviewWantsPlaying=true;const token=++reviewResumeToken;try{await audio.resume();}catch(e){if(token===reviewResumeToken){reviewWantsPlaying=false;reviewHUD?.error(e.message);}return;}if(review&&token!==reviewResumeToken)return;if(state!=='pause'||!activePage)return;if(!review)for(const p of players)p.input.resume(performance.now());shots.resume();go('play');}
function results(demo=false){
  if(review){pause();return;}
  if(state==='results')return;
  const elapsed=demo?104:playedFor;
  if(demo)for(let i=0;i<playerCount;i++)Object.assign(players[i].score,{score:i?38800:42650,maxCombo:i?56:64,stars:3,stats:{perfect:i?82:92,good:i?18:12,miss:i?7:3}});
  const bests=players.map(p=>!demo&&saveBest(songs[sel].id,p.score.score));
  const musicRms=audio.musicLevel();audio.stop();go('results');void cheer?.enter(musicRms);
  // Retain the original single-player diagnostic fields for integrations.
  $('resultSong').textContent=songs[sel].title;$('resultScore').textContent=score.score.toLocaleString('en-US');$('resultStars').innerHTML=starsHTML(score.stars);
  $('resultCombo').textContent=score.maxCombo;$('resultPerfect').textContent=score.stats.perfect;$('resultGood').textContent=score.stats.good;$('resultMiss').textContent=score.stats.miss;$('resultKcal').textContent=demo?'12.8':players[0].calories.kcal.toFixed(1);$('resultTime').textContent=fmtTime(elapsed);$('newBest').hidden=!(demo||bests[0]);
  resultHUD.show({song:songs[sel],duration:elapsed,players:players.slice(0,playerCount).map((p,i)=>({score:structuredClone(p.score),kcal:demo?(i?11.2:12.8):p.calories.kcal,newBest:demo||bests[i]}))});
  const token=runToken;
  if(demo&&stage.captureJumbotron){(async()=>{if(params.has('camera'))await camera.enable();const photos=[];stage.setWall('cam');for(let i=0;i<4;i++){stage.strike(MOVE_IDS[i]);if(playerCount===2)stage.strike(MOVE_IDS[5-i],1);await new Promise(r=>setTimeout(r,140));const blob=await stage.captureJumbotron();if(blob)photos.push({t:24+i*24,blob,quality:1,realCamera:camera.status==='live'});}if(state==='results'&&token===runToken){heroShots=photos;resultHUD.setShots(photos);stage.setWall('canvas');}})();}
  else heroes.finish().then(photos=>{if(state==='results'&&token===runToken){heroShots=photos;resultHUD.setShots(photos);}});
}
function menuMove(move,bypass=false){
  const action=menuActionForMove(move);if(!action)return;if(state==='results')resultHUD.activity();menu.flash(move);
  if(pendingStart&&action==='choose'){unlockAndStart();return;}
  if(state==='tutorial'){tutorial.move(action,performance.now());return;}
  if(state==='title'){
    const choice=titleChoice(move,playerCount);if(choice!==playerCount)setMode(choice);
    if(action==='choose'&&(keyboardBypass||bypass||players.some(p=>p.frame?.upperBody))){audio.unlock().then(()=>{sfx.play('confirm');previews.refresh();});settings.tutorialSeen?go('songs'):openTutorial('songs');}
  }else if(state==='songs'){
    if(action==='back'){sfx.play('back');return go('title');}
    if(loading)return;
    if(action==='choose'){sfx.play('confirm');settings.tutorialSeen?prepareGame():openTutorial('prepare');return;}
    sel=(sel+(action==='previous'?-1:1)+songs.length)%songs.length;sfx.play('tick');render();
  }else if(state==='count'&&(action==='previous'||action==='back')){sfx.cancel();sfx.play('back');go('songs');}
  else if(state==='results'&&action==='choose')resultHUD.primary();
  else if(state==='pause'&&action==='choose')resume();
}
function applyJudgement(j,index=0){
  const p=players[index],n=j.note;if(!n||n.move==='photo'||p.resolved.has(n))return;
  if(j.result===null){n.uiProgress=j.progress||0;return;}
  if(!playJudgementSfx(sfx,audio,j,p.resolved,{player:index,players:playerCount}))return;n.uiResult=j.result;n.judged=j.result;
  const st=p.score;st.stats[j.result]++;
  if(j.result==='miss'){st.combo=0;st.mult=1;st.hype=Math.max(0,st.hype-.09);}
  else {st.combo++;st.maxCombo=Math.max(st.maxCombo,st.combo);st.mult=Math.min(4,1+Math.floor(st.combo/8));const accuracy=j.accuracy??(j.result==='perfect'?1:.5);st.score+=Math.round((n.move==='sweep'?300*accuracy:j.result==='perfect'?100:50)*st.mult);st.hype=Math.min(1,st.hype+(j.result==='perfect'?.035:.018));stage.strike(n.move,index);stage.hit(n.move);
    if(n.move==='sweep'||st.combo%16===0||j.result==='perfect'&&songs[sel].energy>=2||currentShot==='drop')heroes.offer({t:audio.playbackTime(),quality:(n.move==='sweep'?5:2)+st.combo/16+(j.result==='perfect'?2:0),realCamera:camera.status==='live'});
  }
  st.stars=st.score>=maxScore*.75?3:st.score>=maxScore*.5?2:st.score>=maxScore*.25?1:0;gameplay.judgement(j,index);stage.setHype(playerCount===2?(players[0].score.hype+players[1].score.hype)/2:st.hype);
}
function updateBot(p,time,now){
  if(p.botMove&&time>=p.botReleaseAt){p.input.release(p.botMove);p.botMove=p.botNote=null;}
  while(p.botCursor<p.notes.length&&p.resolved.has(p.notes[p.botCursor]))p.botCursor++;
  const n=p.notes[p.botCursor];if(!p.botMove&&n&&time>=n.t+n.botOffset){p.botMove=n.move;p.botNote=n;p.input.press(n.move,{t:now,dur:n.dur});stage.strike(n.move,p.index);p.botReleaseAt=n.t+n.botOffset+(n.dur?n.dur+.1:.13);p.botCursor++;}
  const frame=p.input.update(now);if(p.botMove==='sweep'&&p.botNote)stage.setSweepProgress(Math.max(0,Math.min(1,(time-p.botNote.t)/p.botNote.dur)),p.index);return frame;
}
function formFocused(){if(state==='results')return resultHUD.movesBlocked();const el=document.activeElement;return !!el&&(['INPUT','SELECT','TEXTAREA'].includes(el.tagName)||el.isContentEditable);}
function tick(st,dt,now){
  if(!activePage)return;
  if(review&&reviewLoop&&state==='play'&&audio.songTime()>=reviewLoop.end)reviewSeek(reviewLoop.start,{includeBoundary:true});
  updatePlayers(trackerSlot.current,now,playerCount,cameraFrames);const time=audio.songTime();
  stage.setSongTime(['play','pause'].includes(state)?time:now/1000);
  if(['play','pause'].includes(state)&&!pendingStart){const shot=shots.sample(audio.playbackTime());currentShot=shot.shot;currentShotX=shot.pos[0];stage.setShot(shot);}
  stage.setAvatarLayout(camera.status==='live'&&['play','pause'].includes(state),currentShotX);
  let upper=false;const menuState=state;
  for(let index=0;index<playerCount;index++){
    const p=players[index];let frame=cameraFrames[index],syntheticFrame=null;
    if(review&&state==='pause')frame=p.frame;
    else if(review&&state==='play')frame=p.reviewBot.update(time);
    else if(state==='play'&&!pendingStart&&autoplay)frame=updateBot(p,time,now);
    else {if(p.held.size||p.releasePending)syntheticFrame=p.input.update(now);if(p.held.size)frame=syntheticFrame;}
    p.frame=frames[index]=frame;upper ||=!!frame?.upperBody;
    const descent=sweepDescent(frame);if((p.held.has(index?'Equal':'Digit6')||p.held.has(index?'NumpadAdd':'Numpad6'))&&descent!==null)stage.setSweepProgress(descent,index);
    const avatarFrame=review&&cameraFrames[index]?.tracked?cameraFrames[index]:frame;
    stage.setAvatarArms(state==='tutorial'||review&&p.photoPose&&time<=p.photoUntil?null:avatarFrame&&(review||avatarFrame.tracked)?avatarFrame.arms:null,index);if(autoplay&&p.photoPose&&time<=p.photoUntil)stage.strike(p.photoPose,index);skeletons[index]=cameraFrames[index]?.tracked?cameraFrames[index].landmarks:null;
    const menuAllowed=!review&&(state!=='play'||pendingStart)&&!p.held.size&&!formFocused();
    if(menuAllowed&&p.menuAllowed===false)p.menu.suspend();
    p.menuAllowed=menuAllowed;
    const activation=p.menu.update(frame);
    if(state!==menuState)p.menu.suspend();
    else if(menuAllowed&&MENU_MOVES.includes(activation))menuMove(activation);
    if(state==='play'&&!pendingStart){
      if(!review)p.calories.update(dt,frame?.energy??0);
      if(p.releasePending&&!p.held.size&&syntheticFrame)for(const j of p.judge.update(syntheticFrame,audio.perfToSongTime(syntheticFrame.t),p.notes))applyJudgement(j,index);
      if(!review)for(const j of p.judge.update(frame,frame?audio.perfToSongTime(frame.t):time,p.notes))applyJudgement(j,index);
      for(const n of p.notes){if(n.t>time)break;if(p.resolved.has(n))continue;if(time>n.t+(n.dur||0)+.5)applyJudgement({note:n,result:n.result||(typeof n.judged==='string'?n.judged:'miss'),off:time-n.t},index);}
    }
    if(state!=='pause'&&p.releasePending&&syntheticFrame&&allReleased(syntheticFrame))p.releasePending=false;
  }
  stage.setSkeleton(playerCount===2?(skeletons[0]||skeletons[1]?skeletons:null):skeletons[0]);
  const bodyLabel=poseStatus==='switching'?'Switching tracker…':upper?(playerCount===2?'Players in frame · clap to start':'Body in frame · clap to start'):poseStatus==='loading'?'Finding your arms…':'Step back · keep shoulders and elbows in frame';
  if(bodyLabel!==lastTrack){lastTrack=bodyLabel;$('bodyStatus').textContent=bodyLabel;}
  const backEnabled=['songs','results'].includes(state)&&!formFocused();let backProgress=0,backTriggered=false;
  for(let i=0;i<playerCount;i++){
    const p=players[i];
    // Only confirmed LEFT UP owns a Back hold. Brief score dips/dropouts pause
    // it without re-arming; only the global rest unlock resets the consumed hold.
    if(!p.menu.locked||p.menu.active!=='split_lu')p.backHold.reset();
    else if(!backEnabled)p.backHold.suspend();
    else if(!p.menu.backHeld)p.backHold.pause();
    else if(p.menu.fresh){if(!p.menu.continuous)p.backHold.pause();const back=p.backHold.update(true,p.menu.time);if(back.trigger){backTriggered=true;p.menu.consume('split_lu',p.menu.time);}}
    backProgress=Math.max(backProgress,p.backHold.progress);
  }
  menuDebug?.update(players,playerCount,now);
  if(backEnabled){if(state==='results')resultHUD.setBackProgress(backProgress);else $('backFill').style.strokeDasharray=`${backProgress*100} 100`;if(backTriggered){if(state==='results')resultHUD.leave();else menuMove('back');}}
  if(state==='tutorial')tutorial.tick(frames,now,playerCount);if(state==='title'&&!review)home.tick(now);if(state==='results')resultHUD.tick();
  if(state==='count'&&now-countAt>3300)startPlaying(autoplay&&audio.suspended);
  if((state==='play'&&!pendingStart)||state==='pause'){const count=photoCues?.update(time,state==='play')??null;stage.setPhotoCue?.(count);}
  if(state==='play'&&!pendingStart||state==='pause'||pendingStart){
    if(state==='play'&&!pendingStart)playedFor=Math.max(playedFor,Math.min(duration,audio.playbackTime()));
    // One visual track aggregates two independent judgements, never scores them twice.
    for(let i=0,j=0;i<notes.length;i++){const n=notes[i];if(n.move==='photo')continue;const a=(players[0].visualNotes||players[0].notes)[j],b=playerCount===2?(players[1].visualNotes||players[1].notes)[j]:null;j++;n.uiProgress=Math.max(a?.uiProgress||0,b?.uiProgress||0);n.uiResult=b?(a?.uiResult&&b.uiResult?(a.uiResult==='miss'&&b.uiResult==='miss'?'miss':'good'):null):a?.uiResult;}
    gameplay.update(score,Math.max(0,time),duration,players[0].calories.kcal,state==='play'?dt:0,playerCount===2?players[1]:null,players[0]);
    if(review)reviewHUD?.update(time);
    if(state==='play'&&!pendingStart&&audio.playbackTime()>=duration)results();
  }
}
$('onePlayerIcon').innerHTML=iconSVG('split_lu');$('twoPlayersIcon').innerHTML=iconSVG('split_ld');$('titleClapIcon').innerHTML=iconSVG('clap');
$('onePlayer').addEventListener('click',()=>setMode(1));$('twoPlayers').addEventListener('click',()=>setMode(2));
$('titleStart').addEventListener('click',()=>menuMove('clap',true));
$('playBtn').addEventListener('click',async()=>{await audio.unlock();if(state==='songs')menuMove('clap');});
$('backBtn').addEventListener('click',()=>menuMove('back'));$('cameraRetry').addEventListener('click',()=>camera.enable());$('startBtn').addEventListener('click',unlockAndStart);
$('pauseBtn').addEventListener('click',pause);$('resumeBtn').addEventListener('click',resume);$('quitBtn').addEventListener('click',()=>go('songs'));
$('tutorialBtn')?.addEventListener('click',()=>openTutorial('title'));
addEventListener('keydown',e=>{
  if(review){reviewHUD?.keydown(e);return;}
  const typing=['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable;
  if(e.repeat&&(!typing||['Escape','Enter'].includes(e.code)||(e.ctrlKey||e.metaKey)&&e.code==='KeyS')){e.preventDefault();return;}
  if(state==='results'){resultHUD.keydown(e);return;}
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
  if(e.target.tagName==='BUTTON'&&(state==='results'||e.code==='Space'||e.code==='Enter'))return;
  if(e.code==='Escape'||e.code==='KeyP'){e.preventDefault();if(e.repeat)return;if(state==='play')pause();else if(state==='pause')resume();else menuMove('back');return;}
  const index=P2_KEYS[e.code]?1:0;if(index>=playerCount)return;const p=players[index],move=P2_KEYS[e.code]||(state!=='play'||pendingStart?menuMoveForKey(e.code):null)||MOVE_KEYS[e.code];if(!move)return;e.preventDefault();if(e.repeat)return;
  keyboardBypass=true;audio.unlock().then(()=>previews.refresh());p.held.add(e.code);pressedMoves.set(e.code,{move,index});
  const sweep=move==='sweep'&&state==='play'?p.notes.find(n=>n.move==='sweep'&&!p.resolved.has(n)&&Math.abs(n.t-audio.songTime())<.35):null;p.input.press(move,sweep?{dur:sweep.dur}:undefined);stage.strike(move,index);
  if(state!=='play'||pendingStart){p.menu.consume(move,performance.now());menuMove(move,true);}
});
addEventListener('keyup',e=>{const key=pressedMoves.get(e.code);if(!key)return;const p=players[key.index];p.held.delete(e.code);pressedMoves.delete(e.code);if(![...pressedMoves.values()].some(k=>k.index===key.index&&k.move===key.move))p.input.release(key.move);p.releasePending=true;});
addEventListener('blur',()=>{for(const p of players){for(const move of MOVE_IDS)p.input.release(move);p.held.clear();p.releasePending=true;}pressedMoves.clear();if(state==='play'&&!autoplay)pause();});
addEventListener('pagehide',()=>{cameraWanted=['live','requesting'].includes(camera.status);recoverToSongs=loading||pendingStart||state==='count';if(state==='play'&&!pendingStart)pause();else for(const p of players)p.input.pause(performance.now());activePage=false;runToken++;if(loading)audio.cancelLoad();loading=false;previews.stop({immediate:true});photoCues?.suspend();sfx.cancel();cheer?.close();trackerSlot.close();poseStatus='';camera.close();stage.setVideo(false);stage.setSkeleton(null);});
addEventListener('pageshow',event=>{if(!event.persisted)return;activePage=true;camera.restore();if(recoverToSongs){for(const p of players){p.input.reset();p.held.clear();}pressedMoves.clear();if(review)prepareGame(true);else go('songs');}else if(state!=='pause')for(const p of players)p.input.resume(performance.now());if(state==='songs')previews.select(songs[sel]);if(cameraWanted)camera.enable();});
stage.setPlayers?.(playerCount);
if(review){prepareGame(true);}else{go('title',true);
if(params.get('state')==='results'&&params.has('demo'))results(true);else if(params.get('state')==='play')prepareGame(true);else if(params.get('state')==='tutorial')openTutorial('songs');else if(['songs','level'].includes(params.get('state')))go('songs',true);
}
if(!autoplay&&!params.has('demo')||params.has('camera'))camera.enable();
window.wh={get wallDebug(){return stage.wallDebug;},get state(){return state;},get songTime(){return audio.songTime();},get shot(){return currentShot;},review:review?{seek:reviewSeek,pause,resume,setRate:reviewSetRate,toggleLoop:reviewToggleLoop,get loop(){return reviewLoop;}}:null,score,board,get notes(){return players[0].notes;},get players(){return players.slice(0,playerCount);},get photoNotes(){return photoCues?.cues||[];},get photoShots(){return heroes.cueShots;},get heroShots(){return heroShots;},makeStrip:(player=0)=>resultHUD.strip(player),makeZip:()=>resultHUD.archive(),results:resultHUD,audio,sfx,cheer,get cameraStatus(){return camera.status;},get poseStatus(){return poseStatus;},get poseStats(){return trackerSlot.current?.stats;}};

function reviewSeek(seconds,{includeBoundary=false}={}){
  if(!reviewHUD||!chart)return;
  const time=clampTime(seconds,duration),playing=reviewWantsPlaying;reviewResumeToken++;
  audio.seek(time);sfx.cancel();photoCues.reset(time,includeBoundary);heroes.reset(chart.bpm,notes);heroShots=[];photoHUD.reset();stage.setPhotoCue?.(null);
  for(const note of notes){delete note.uiResult;delete note.uiProgress;delete note.photoTaken;if(note.move==='photo'&&(includeBoundary?note.t<time:note.t<=time))note.photoTaken=true;}
  for(const p of players){
    Object.assign(p,createSeekState(notes,time));p.judge=createJudge();p.calories=createCalorieMeter({weightKg:70});Object.assign(p.score,emptyScore());p.input.reset();p.held.clear();
    // Warm only a sweep spanning the seek point. Reconstruct HIGH→T→LOW
    // silently, so a mid-sweep seek shows the correct arc without old SFX.
    let warming=true;const start=Math.min(time,(p.notes[0]?.t??time)-.05);
    p.reviewBot=createReviewBot({notes:p.notes,judge:p.judge,start,onJudgement(j){if(!warming){applyJudgement(j,p.index);return;}if(j.result===null)j.note.uiProgress=j.progress;else{j.note.uiResult=j.result;p.resolved.add(j.note);}},onStrike:move=>{if(!warming)stage.strike(move,p.index);},onEnergy:(dt,energy)=>{if(!warming)p.calories.update(dt,energy);}});
    p.frame=p.reviewBot.update(time-1e-6);warming=false;
  }
  pressedMoves.clear();playedFor=time;gameplay.setSong(songs[sel],chart,playerCount);shots.seek(time);if(!playing)shots.pause(time);
  stage.setShot(shots.sample(time));stage.setSongTime(time);stage.strike('idle');stage.setAvatarArms(players[0].frame?.arms,0,true);stage.setHype(.55);stage.resetEffects?.();
  if(reviewLoop&&(time<reviewLoop.start||time>=reviewLoop.end))reviewLoop=reviewHUD.grid.loop(time);
  reviewHUD.error(audioReady?'':'Audio unavailable · return to the review index to retry.');reviewHUD.update(time);
  // Pause and rebuild synchronously; a stale media.play promise cannot resume
  // an older seek. Resume only the latest requested timeline.
  if(playing){state='pause';stage.setPaused?.(true);resume();}
}
function reviewSetRate(value){if(!review)return;sfx.cancel();photoCues?.suspend();audio.setRate(value);reviewHUD?.update(audio.songTime());}
function reviewToggleLoop(){if(!reviewHUD)return;reviewLoop=reviewLoop?null:reviewHUD.grid.loop(audio.songTime());reviewHUD.update(audio.songTime());}
}
