import { createAudioPlayer } from '../audio.js';
import { reviewRate, clampTime } from './logic.js';
// HTML media supplies pitch-preserving rate changes. Its *only* audio route
// is the game's music bus, so ?mute also silences this transport and its SFX.
export function createReviewAudio(options = {}, { media = new Audio() } = {}) {
  const base = createAudioPlayer(options);
  let source, analyser, samples, duration = 0, generation = 0, rate = 1;
  media.preload = 'auto'; media.preservesPitch = true; media.webkitPreservesPitch = true;
  function connect() {
    if (source) return;
    source = base.ctx.createMediaElementSource(media); analyser = base.ctx.createAnalyser(); analyser.fftSize = 256;
    samples = new Float32Array(analyser.fftSize); source.connect(analyser); analyser.connect(base.musicBus);
  }
  const api = Object.create(base);
  Object.defineProperties(api, {
    duration: { get: () => duration }, running: { get: () => !media.paused && !media.ended },
    silent: { get: () => false }, rate: { get: () => rate }, media: { get: () => media },
  });
  api.load = async url => {
    api.pause(); duration = 0;
    // The review player needs no decoded duplicate: metadata + streamed media.
    void base.unlock().catch(() => {}); connect();
    return new Promise((resolve, reject) => {
      const token = ++generation;
      const cleanup = () => { media.removeEventListener('loadedmetadata', loaded); media.removeEventListener('error', failed); };
      const loaded = () => { cleanup(); if (token !== generation) return resolve(0); duration = media.duration; resolve(duration); };
      const failed = () => { cleanup(); reject(new Error('Review audio could not be loaded. Retry from the review index.')); };
      media.addEventListener('loadedmetadata', loaded); media.addEventListener('error', failed);
      media.src = url; media.load();
    });
  };
  api.pause = () => { base.resetMusicDuck(); generation++; media.pause(); };
  api.resume = async () => {
    base.resetMusicDuck();
    const token = generation; await base.unlock(); connect();
    if (token === generation) await media.play();
  };
  api.play = () => api.resume();
  api.stop = () => { api.pause(); media.currentTime = 0; };
  api.seek = seconds => { api.pause(); media.currentTime = clampTime(seconds, duration || Infinity); };
  api.setRate = value => { rate = reviewRate(value); media.playbackRate = rate; };
  api.songTime = api.playbackTime = () => media.currentTime;
  api.perfToSongTime = perfMs => media.currentTime + (api.running ? (perfMs - performance.now()) / 1000 * rate : 0);
  api.contextTimeForSong = seconds => (base.ctx?.currentTime || 0) + (seconds - media.currentTime) / rate;
  api.musicLevel = () => {
    if (!api.running || !analyser) return 0;
    analyser.getFloatTimeDomainData(samples); let energy = 0;
    for (const sample of samples) energy += sample * sample;
    return Math.sqrt(energy / samples.length) * base.musicVolume;
  };
  api.cancelLoad = () => { api.pause(); media.removeAttribute('src'); media.load(); duration = 0; };
  return api;
}
