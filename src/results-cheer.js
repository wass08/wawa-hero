import { DEFAULT_SFX_VOLUME, FALLBACK_MUSIC_RMS } from './sfx.js';
// Own the pending decode and results lifetime separately from menu/tap voices.
// A late decode may never start a cheer after the player has left results.
export function createResultsCheer(audio,url) {
  let pending,active=false,generation=0,current=null;
  const voices=new Set(),counts={entered:0,scheduled:0,stopped:0};
  function preload(){return pending??=audio.getBuffer(url).then(buffer=>{
    let power=0,n=0,peak=0;
    for(let c=0;c<buffer.numberOfChannels;c++)for(const value of buffer.getChannelData(c)){power+=value*value;n++;peak=Math.max(peak,Math.abs(value));}
    return {buffer,rms:Math.sqrt(power/n)||1,peak};
  }).catch(()=>null);}
  function stop(voice,fade){
    if(!voice)return;const now=audio.ctx.currentTime;counts.stopped++;
    voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(voice.level,now);
    voice.gain.gain.linearRampToValueAtTime(0,now+fade);try{voice.source.stop(now+fade);}catch{}
  }
  return {
    preload,counts,
    async enter(musicRms=FALLBACK_MUSIC_RMS){
      if(active)return;active=true;counts.entered++;const token=++generation,data=await preload(),ctx=audio.ctx;
      if(!active||token!==generation||!data||!ctx||ctx.state!=='running'||audio.sfxEnabled===false)return;
      const target=Math.max(.08,Math.min(.25,musicRms||FALLBACK_MUSIC_RMS));
      const level=Math.min(target/data.rms,.9/Math.max(.01,data.peak))/DEFAULT_SFX_VOLUME;
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=data.buffer;
      gain.gain.setValueAtTime(level,ctx.currentTime);source.connect(gain);gain.connect(audio.sfxBus);
      const voice={source,gain,level};current=voice;voices.add(voice);counts.scheduled++;
      source.onended=()=>{voices.delete(voice);if(current===voice)current=null;source.disconnect();gain.disconnect();};source.start(ctx.currentTime);
    },
    leave(){if(!active)return;active=false;generation++;stop(current,.18);current=null;},
    close(){active=false;generation++;for(const voice of voices)stop(voice,0);voices.clear();current=null;},
  };
}
