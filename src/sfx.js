// Procedural PCM. Normalise the finished filter + envelope, not its input
// amplitude: narrow filters and short exponential tails used to lose 30+ dB.
export const SFX_SOUNDS = Object.freeze({
  tick:    { type:'bandpass', hz:1300, endHz:2100, dur:.085, db:-26 },
  confirm: { type:'highpass', hz:950, endHz:3200, dur:.14, db:-23 },
  back:    { type:'lowpass', hz:1600, endHz:250, dur:.16, db:-25 },
  three:   { type:'bandpass', hz:700, endHz:1100, dur:.10, db:-23 },
  two:     { type:'bandpass', hz:1100, endHz:1800, dur:.10, db:-22 },
  one:     { type:'bandpass', hz:1800, endHz:2900, dur:.12, db:-21 },
  go:      { type:'highpass', hz:700, endHz:2300, dur:.20, db:-19 },
  miss:    { kind:'buzzer', dur:.20, db:-10, song:true },
  shutter: { kind:'shutter', dur:.078, db:-14, song:true },
});
export const DEFAULT_SFX_VOLUME = .7;
export const FALLBACK_MUSIC_RMS = .1;
const amplitude = db => 10 ** (db / 20);
// Biquad coefficients follow the Web Audio/RBJ cookbook. Baking a swept filter
// and smooth envelope into reusable PCM avoids filter-dependent level guessing.
export function makeSfxBuffer(ctx, sound) {
  const length=Math.ceil(ctx.sampleRate*sound.dur),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0);
  let seed=0x5eed1234,x1=0,x2=0,y1=0,y2=0,power=0;
  if(sound.kind==='buzzer') {
    // Detuned square + saw, falling at different rates, with low noise and a
    // tanh waveshaper. Bake once so each miss stays cheap and sample-accurate.
    let phaseA=0,phaseB=0,noise=0;
    for(let i=0;i<length;i++){
      const t=i/ctx.sampleRate,bend=1-Math.exp(-t/.05);
      phaseA+=(104-28*bend)/ctx.sampleRate;phaseB+=(116-33*bend)/ctx.sampleRate;
      seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;noise=.85*noise+.15*((seed>>>0)/2147483648-1);
      const square=phaseA%1<.5?1:-1,saw=2*(phaseB%1)-1;
      const env=t<.003?t/.003:t<.045?1:.5*(1+Math.cos(Math.PI*(t-.045)/(sound.dur-.045)));
      data[i]=Math.tanh(1.8*(.55*square+.3*saw+.2*noise))*env;
    }
  } else if(sound.kind==='shutter') {
    const first=makeSfxBuffer(ctx,{type:'bandpass',hz:2900,endHz:3600,dur:.012,attack:.0006}).getChannelData(0);
    const second=makeSfxBuffer(ctx,{type:'bandpass',hz:6100,endHz:7600,dur:.008,attack:.0003}).getChannelData(0);
    const body=makeSfxBuffer(ctx,{type:'lowpass',hz:210,endHz:120,dur:.012,attack:.001}).getChannelData(0);
    for(let i=0;i<first.length;i++)data[i]=first[i]*.65+body[i]*.12;
    const offset=Math.round(.07*ctx.sampleRate);for(let i=0;i<second.length&&offset+i<length;i++)data[offset+i]=second[i];
  } else for(let i=0;i<length;i++){
    const t=i/ctx.sampleRate,hz=sound.hz*(sound.endHz/sound.hz)**(t/sound.dur),w=2*Math.PI*hz/ctx.sampleRate,c=Math.cos(w),a=Math.sin(w)/(2*.7),a0=1+a;
    const b0=sound.type==='lowpass'?(1-c)/2:sound.type==='highpass'?(1+c)/2:a;
    const b1=sound.type==='lowpass'?1-c:sound.type==='highpass'?-(1+c):0;
    const b2=sound.type==='bandpass'?-a:b0;
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const x=(seed>>>0)/2147483648-1;
    const y=(b0*x+b1*x1+b2*x2+2*c*y1-(1-a)*y2)/a0;x2=x1;x1=x;y2=y1;y1=y;
    const attack=sound.attack||.004,env=t<attack?t/attack:.5*(1+Math.cos(Math.PI*(t-attack)/(sound.dur-attack)));
    data[i]=y*env;
  }
  for(const value of data)power+=value*value;
  const rms=Math.sqrt(power/length)||1;
  // Bound the crest factor of dull thuds as well as crisp ticks, then restore RMS.
  power=0;for(let i=0;i<length;i++){data[i]=3*Math.tanh(data[i]/rms/3);power+=data[i]*data[i];}
  const finalRms=Math.sqrt(power/length)||1;for(let i=0;i<length;i++)data[i]/=finalRms;
  return buffer;
}
export function createSfx(audio) {
  const buffers=new Map(),voices=new Set();
  const counts=Object.fromEntries(Object.keys(SFX_SOUNDS).map(name=>[name,{attempted:0,scheduled:0,skipped:0,cancelled:0}]));
  function play(name,at=audio.ctx?.currentTime,pan=0){
    const ctx=audio.ctx,sound=SFX_SOUNDS[name],stats=counts[name];if(!sound)return;
    stats.attempted++;
    // OfflineAudioContext renders the exact production PCM and bus in level tests.
    if(!ctx||(ctx.state!=='running'&&typeof ctx.startRendering!=='function')||audio.sfxEnabled===false){stats.skipped++;return;}
    const measured=audio.musicLevel(),musicRms=Number.isFinite(measured)&&measured>0?measured:FALLBACK_MUSIC_RMS;
    // Equal-power mono panning otherwise drops a centre buzzer by 3 dB against
    // stereo music. Compensate once; left/right pan keeps the same total energy.
    const target=amplitude(sound.db)*(sound.song?musicRms:1)*(name==='miss'?Math.SQRT2:1);
    if(!buffers.has(name))buffers.set(name,makeSfxBuffer(ctx,sound));
    at=Math.max(ctx.currentTime+.003,Number.isFinite(at)?at:ctx.currentTime);
    const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffers.get(name);
    // The single SFX bus still controls all effects. These targets are calibrated
    // at its default 70%, so that gain is counted exactly once.
    gain.gain.setValueAtTime(target/DEFAULT_SFX_VOLUME,at);
    const panner=name==='miss'?ctx.createStereoPanner():null;
    if(panner){panner.pan.setValueAtTime(pan,at);gain.connect(panner);panner.connect(audio.sfxBus);}else gain.connect(audio.sfxBus);
    source.connect(gain);voices.add(source);stats.scheduled++;
    let cancelled=false;const stop=source.stop.bind(source);
    source.stop=(...args)=>{if(!cancelled){cancelled=true;stats.cancelled++;}return stop(...args);};
    source.onended=()=>{voices.delete(source);source.disconnect();gain.disconnect();panner?.disconnect();};source.scheduledAt=at;source.start(at);return source;
  }
  return {
    play,counts,
    miss({at=audio.ctx?.currentTime,player=0,players=1}={}) {
      const ctx=audio.ctx;if(!ctx)return;
      at=Math.max(ctx.currentTime+.003,Number.isFinite(at)?at:ctx.currentTime);
      const voice=play('miss',at,players===2?(player===0?-.65:.65):0);
      if(voice)audio.duckMusic({at:voice.scheduledAt,players});return voice;
    },
    get enabled(){return audio.sfxEnabled!==false;},
    setEnabled(value){audio.setSfxEnabled(value);if(!value)this.cancel();},
    countdown(){const now=audio.ctx?.currentTime||0;play('three',now);play('two',now+.8);play('one',now+1.6);play('go',now+2.4);},
    cancel(){for(const source of voices)try{source.stop();}catch{}voices.clear();audio.resetMusicDuck?.();},
  };
}
// Commit once per player's note identity; progress updates and photos are silent.
// Sweep `off` measures the T crossing, not completion. Feedback starts when LOW
// resolves (or the miss expires), never at a guessed future note-end timestamp.
export function playJudgementSfx(sfx,audio,j,resolved,{player=0,players=1}={}){
  const n=j.note;if(!n||n.move==='photo'||resolved.has(n)||!['perfect','good','miss'].includes(j.result))return false;
  resolved.add(n);if(j.result==='miss')sfx.miss({at:audio.ctx?.currentTime,player,players});return true;
}
