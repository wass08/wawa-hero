// Buffer transport and heard playback account for output-device latency.
export function createAudioPlayer({ muted = false, musicVolume = 0.8, sfxVolume = 0.7 } = {}) {
  let ctx, masterGain, musicBus, sfxBus, buffer, source, previewVoice, startCtx = 0, position = 0, heardPosition = 0, running = false;
  const buffers = new Map();
  const previewVoices = new Set();
  let silent = false, silentAnchor = 0, loadGeneration = 0, playGeneration = 0;
  const context = () => {
    if (!ctx) {
      ctx = new AudioContext(); masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 1; masterGain.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.gain.value = musicVolume; musicBus.connect(masterGain);
      sfxBus = ctx.createGain(); sfxBus.gain.value = sfxVolume; sfxBus.connect(masterGain);
    }
    return ctx;
  };
  const transportTime = () => position + (running ? silent
    ? (performance.now() - silentAnchor) / 1000 : ctx.currentTime - startCtx : 0);
  const rawTime = () => running ? transportTime() - (silent ? 0 : ctx.outputLatency || 0) : heardPosition;
  const halt = () => { if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; } };
  function startSource() {
    halt(); source = ctx.createBufferSource(); source.buffer = buffer; source.connect(musicBus);
    startCtx = ctx.currentTime; source.start(0, Math.min(position, Math.max(0, buffer.duration - 0.001))); running = true;
  }
  return {
    get ctx() { return ctx; }, get masterGain() { return masterGain; }, get musicBus() { return musicBus; }, get sfxBus() { return sfxBus; },
    get muted() { return muted; }, get suspended() { return !ctx || ctx.state !== 'running'; },
    get duration() { return buffer?.duration || 0; }, get running() { return running; }, get silent() { return silent; },
    get musicVolume() { return musicVolume; }, get sfxVolume() { return sfxVolume; },
    setVolumes(music, effects) {
      musicVolume = Math.min(1, Math.max(0, music)); sfxVolume = Math.min(1, Math.max(0, effects));
      if (ctx) { setGain(musicBus.gain, musicVolume, ctx.currentTime); setGain(sfxBus.gain, sfxVolume, ctx.currentTime); }
    },
    async unlock() { const c = context(); await c.resume(); return c.state === 'running'; },
    async getBuffer(url) {
      if (!buffers.has(url)) {
        const promise = (async () => {
          const c = context(), r = await fetch(url);
          if (!r.ok) throw new Error('Audio could not be loaded');
          return c.decodeAudioData(await r.arrayBuffer());
        })();
        buffers.set(url, promise);
        promise.catch(() => { if (buffers.get(url) === promise) buffers.delete(url); });
        // Keep a small cache; adjacent highlights and gameplay share pending decodes too.
        if (buffers.size > 3) buffers.delete(buffers.keys().next().value);
      }
      return buffers.get(url);
    },
    async load(url) {
      const generation = ++loadGeneration;
      buffer = null; // A failed replacement must never retain the previous song.
      const decoded = await this.getBuffer(url);
      if (generation !== loadGeneration) return 0;
      buffer = decoded; return buffer.duration;
    },
    preview(decoded, loop) {
      if (context().state !== 'running') return false;
      this.stopPreview();
      const voice = ctx.createBufferSource(), gain = ctx.createGain(), now = ctx.currentTime;
      voice.buffer = decoded; voice.loop = true; voice.loopStart = loop.start; voice.loopEnd = loop.start + loop.dur;
      voice.connect(gain); gain.connect(musicBus);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(1, now + 0.8);
      const entry = { voice, gain, start: now }; previewVoices.add(entry);
      voice.onended = () => { previewVoices.delete(entry); voice.disconnect(); gain.disconnect(); };
      voice.start(now, loop.start); previewVoice = entry; return true;
    },
    stopPreview(fade = 0.6) {
      if (!fade) {
        // Teardown also stops older voices that are still crossfading out.
        if (ctx) for (const { voice, gain } of previewVoices) {
          gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.setValueAtTime(0, ctx.currentTime);
          try { voice.stop(ctx.currentTime); } catch {}
        }
        previewVoices.clear(); previewVoice = null; return Promise.resolve();
      }
      if (!previewVoice) return Promise.resolve();
      const { voice, gain, start } = previewVoice; previewVoice = null;
      const now = ctx.currentTime;
      if (gain.gain.cancelAndHoldAtTime) gain.gain.cancelAndHoldAtTime(now);
      else { gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(Math.min(1, (now - start) / 0.8), now); }
      gain.gain.linearRampToValueAtTime(0, now + fade);
      voice.stop(now + fade);
      return fade ? new Promise(resolve => setTimeout(resolve, fade * 1000)) : Promise.resolve();
    },
    play({ silentClock = false } = {}) {
      this.stop(); silent = silentClock;
      if (silent) { silentAnchor = performance.now(); running = true; return true; }
      if (!buffer || context().state !== 'running') return false;
      startSource(); return true;
    },
    pause() {
      playGeneration++; // Invalidate an asynchronous resume even if it has not started yet.
      if (!running) return;
      heardPosition = rawTime(); position = transportTime();
      halt(); running = false;
    },
    async resume() {
      if (running) return;
      if (silent) { silentAnchor = performance.now(); running = true; return; }
      const generation = playGeneration;
      await this.unlock(); if (generation === playGeneration && buffer) startSource();
    },
    stop() { playGeneration++; halt(); running = false; position = heardPosition = 0; },
    seek(seconds) {
      const wasRunning = running;
      halt(); position = Math.max(0, Math.min(buffer?.duration || Infinity, seconds));
      heardPosition = position - (silent ? 0 : ctx?.outputLatency || 0);
      if (wasRunning) { if (silent) silentAnchor = performance.now(); else startSource(); }
    },
    cancelLoad() { loadGeneration++; buffer = null; },
    playbackTime() { return rawTime(); }, // Completion follows heard audio.
    songTime() { return rawTime(); },
    perfToSongTime(perfMs) {
      return rawTime() + (perfMs - performance.now()) / 1000;
    },
    contextTimeForSong(seconds) {
      // Schedule against buffer transport (the shared output latency is not added twice).
      return ctx ? ctx.currentTime + seconds - transportTime() : 0;
    },
    musicLevel() {
      if (!running || silent || !buffer?.getChannelData) return 0;
      const start = Math.max(0, Math.floor(transportTime() * buffer.sampleRate));
      let power = 0, count = 0;
      // Only sampled on judgements, never in the render loop. No transient arrays.
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = start; i < Math.min(data.length, start + buffer.sampleRate * 0.08); i += 8) { power += data[i] * data[i]; count++; }
      }
      return count ? Math.sqrt(power / count) * musicVolume : 0;
    },
  };
}
function setGain(param, value, now) {
  if (param.setTargetAtTime) param.setTargetAtTime(value, now, 0.03); else param.value = value;
}
