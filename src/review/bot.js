import {createGameInput} from '../input.js';
// Simulate in song seconds, not render/performance seconds: slow playback,
// dropped render frames and pauses must not change a cue's judgement.
export function createReviewBot({notes,judge,start=0,onJudgement=()=>{},onStrike=()=>{},onEnergy=()=>{}}){
  const input=createGameInput({ramp:0});let cursor=0,held=null,releaseAt=0,time=start;
  let frame=input.update(start*1000);
  function step(nextTime){
    if(held&&nextTime>=releaseAt){input.release(held);held=null;}
    const note=notes[cursor];
    if(!held&&note&&nextTime>=note.t){
      held=note.move;input.press(held,{t:note.t*1000,dur:note.dur});onStrike(held);
      releaseAt=note.t+(note.dur?note.dur+.1:note.move==='clap'?.13:.22);cursor++;
    }
    frame=input.update(nextTime*1000);
    for(const judgement of judge.update(frame,nextTime,notes))onJudgement(judgement);
    onEnergy(nextTime-time,frame.energy||0);time=nextTime;
  }
  return {update(songTime){while(time+1/60<=songTime+1e-8)step(time+1/60);return frame;}};
}
