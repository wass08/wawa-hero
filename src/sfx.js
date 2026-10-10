// Procedural, non-tonal sounds. All sources enter the SFX bus, then the mute master.
const SOUNDS = {
  tick:    { type: 'bandpass', hz: 1300, endHz: 2100, dur: 0.085, peak: 0.055 },
  confirm: { type: 'highpass', hz: 950, endHz: 3200, dur: 0.14, peak: 0.07 },
  back:    { type: 'lowpass', hz: 1600, endHz: 250, dur: 0.16, peak: 0.065 },
  three:   { type: 'bandpass', hz: 700, endHz: 1100, dur: 0.10, peak: 0.10 },
  two:     { type: 'bandpass', hz: 1100, endHz: 1800, dur: 0.10, peak: 0.11 },
  one:     { type: 'bandpass', hz: 1800, endHz: 2900, dur: 0.12, peak: 0.12 },
  go:      { type: 'highpass', hz: 700, endHz: 2300, dur: 0.20, peak: 0.16 },
  miss:    { type: 'lowpass', hz: 550, endHz: 160, dur: 0.11, peak: 0.25, song: true },
  perfect: { type: 'highpass', hz: 6500, endHz: 9000, dur: 0.025, peak: 0.04, song: true },
  good:    { type: 'highpass', hz: 4700, endHz: 7000, dur: 0.03, peak: 0.035, song: true },
  sweep:   { type: 'highpass', hz: 1800, endHz: 6500, dur: 0.20, peak: 0.07, attack: 0.065, song: true },
  shutter: { type: 'highpass', hz: 2900, endHz: 1100, dur: 0.065, peak: 0.045, song: true },
};
export function createSfx(audio) {
  let noise = null;
  const voices = new Set();
  function play(name, at = audio.ctx?.currentTime) {
    const ctx = audio.ctx, sound = SOUNDS[name];
    if (!ctx || ctx.state !== 'running' || !sound) return;
    // MISS peaks are capped at 1/4 of measured music RMS (~-12 dB), before the
    // dull filter and SFX volume reduce them further. Silent music means silent hits.
    const peak = sound.peak * (sound.song ? audio.musicLevel() : 1);
    if (peak <= 0) return;
    if (!noise) {
      noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.7), ctx.sampleRate);
      const data = noise.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    at = Math.max(ctx.currentTime + 0.003, Number.isFinite(at) ? at : ctx.currentTime);
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    source.buffer = noise; filter.type = sound.type; filter.Q.value = 0.35;
    filter.frequency.setValueAtTime(sound.hz, at); filter.frequency.exponentialRampToValueAtTime(sound.endHz, at + sound.dur);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + (sound.attack || 0.004));
    gain.gain.exponentialRampToValueAtTime(0.00001, at + sound.dur); gain.gain.setValueAtTime(0, at + sound.dur + 0.002);
    source.connect(filter); filter.connect(gain); gain.connect(audio.sfxBus); voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + sound.dur + 0.003);return source;
  }
  return {
    play,
    countdown() { const now = audio.ctx?.currentTime || 0; play('three', now); play('two', now + 0.8); play('one', now + 1.6); play('go', now + 2.4); },
    results() { const now = audio.ctx?.currentTime || 0; play('back', now); play('confirm', now + 0.13); play('confirm', now + 0.27); play('go', now + 0.42); },
    cancel() { for (const source of voices) { try { source.stop(); } catch {} } voices.clear(); },
  };
}
