// Photo notes are presentation events, never inputs to a judge.
export function photoCountdown(t, time, bpm) {
  const remaining=t-time;
  return remaining>0&&remaining<=1.5?Math.min(3,Math.max(1,Math.ceil(remaining/(60/bpm)))):null;
}
export function createPhotoCueScheduler(notes,{bpm=120,onSchedule=()=>{},onPose=()=>{},onSnap=()=>{}}={}) {
  const cues=notes.filter(n=>n.move==='photo').slice().sort((a,b)=>a.t-b.t);
  const done=new Set(),prompted=new Set(),scheduled=new Map();
  let last=null,lastPerf=null,paused=false;
  function cancel(){for(const voice of scheduled.values())try{voice?.stop();}catch{}scheduled.clear();}
  return {
    cues,
    reset(time,includeBoundary=false){cancel();done.clear();prompted.clear();last=lastPerf=null;paused=false;if(Number.isFinite(time))for(const cue of cues)if(includeBoundary?cue.t<time:cue.t<=time)done.add(cue);},
    suspend(){cancel();paused=true;},
    update(time,playing=true,perfSeconds=performance.now()/1000){
      // A stalled render loop is elapsed time, not a seek: it must still snap.
      const seek=last!==null&&(time<last-.03||(time-last>2&&time-last-(perfSeconds-lastPerf)>.25));
      if(seek){cancel();for(const cue of cues)if(cue.t<time-.05)done.add(cue);}
      if(!playing){if(!paused)cancel();paused=true;}else paused=false;
      let countdown=null;
      for(const cue of cues){
        if(done.has(cue))continue;
        const count=photoCountdown(cue.t,time,bpm);
        if(count!==null){countdown=count;if(playing){
          if(!prompted.has(cue)){prompted.add(cue);onPose(cue);}
          if(!scheduled.has(cue))scheduled.set(cue,onSchedule(cue));
        }break;}
        if(playing&&time>=cue.t){
          // Skip stale cues on an initial seek; a normal crossing fires once.
          const planned=scheduled.has(cue);done.add(cue);scheduled.delete(cue);
          if((last!==null&&!seek&&last<=cue.t)||time-cue.t<.05){
            // A loop/transport can begin exactly at the flash without a
            // countdown. Schedule the shutter once, at this crossing.
            if(!planned)onSchedule(cue);
            if(!prompted.has(cue)){prompted.add(cue);onPose(cue);}
            onSnap(cue);
          }
        }
      }
      last=time;lastPerf=perfSeconds;return countdown;
    },
  };
}
