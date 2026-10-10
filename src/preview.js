import { siteURL } from './charts.js';
export function previewLoop(song, duration) {
  const fallback = duration * 0.3;
  const start = Math.max(0, Math.min(duration - 0.05, Number.isFinite(song.preview?.start) ? song.preview.start : fallback));
  const dur = Math.max(0.05, Math.min(duration - start, Number.isFinite(song.preview?.dur) && song.preview.dur > 0 ? song.preview.dur : 15));
  return { start, dur };
}
// Debounce highlights, reject obsolete decodes, and reuse the decoded buffer for gameplay.
export function createSongPreview(audio, { debounceMs = 200, onStatus = () => {} } = {}) {
  let desired = null, decoded = null, generation = 0, timer = null, playing = false, fading = Promise.resolve();
  const begin = () => {
    if (!desired || !decoded || playing) return;
    if (audio.suspended) { onStatus('gesture'); return; }
    playing = audio.preview(decoded, previewLoop(desired, decoded.duration));
    onStatus(playing ? 'playing' : 'gesture');
  };
  return {
    select(song) {
      if (desired?.id === song.id) { begin(); return; }
      const epoch = ++generation; clearTimeout(timer);
      fading = audio.stopPreview(); desired = song; decoded = null; playing = false; onStatus('loading');
      timer = setTimeout(async () => {
        timer = null;
        try { const next = await audio.getBuffer(siteURL(song.audio)); if (epoch !== generation) return; decoded = next; begin(); }
        catch { if (epoch === generation) onStatus('unavailable'); }
      }, debounceMs);
    },
    refresh: begin,
    stop({ immediate = false } = {}) {
      generation++; clearTimeout(timer); timer = null; desired = decoded = null; playing = false; onStatus('off');
      const stopped = audio.stopPreview(immediate ? 0 : 0.6);
      if (immediate) { fading = Promise.resolve(); return stopped; }
      fading = Promise.all([fading, stopped]); return fading;
    },
  };
}
