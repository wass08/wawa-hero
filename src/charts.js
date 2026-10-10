import { MOVE_IDS } from './moves.js';
export const siteURL = path => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
const fallbackSong = {
  id: 'system-online', title: 'System Online', artist: 'Wawa Sensei', audio: 'songs/system-online/audio.mp3',
  cover: 'songs/system-online/cover.jpg', bpm: 120, duration: 183.5, energy: 2,
  moves: MOVE_IDS,
};
async function readJSON(path) {
  const r = await fetch(siteURL(path)); if (!r.ok) throw new Error(`Missing ${path}`);
  return r.json();
}
export async function loadCatalog() {
  try { const data = await readJSON('songs/index.json'); if (data.songs?.length) return data.songs; } catch {}
  return [fallbackSong];
}
export async function loadChart(song) {
  // Old catalogs remain playable while the single-chart catalog rolls out.
  for (const path of new Set([song.chart, song.charts?.normal].filter(Boolean))) {
    try {
      const chart = await readJSON(path);
      if (!Array.isArray(chart.notes)) throw new Error('Invalid chart');
      return { ...chart, notes: chart.notes.filter(n => Number.isFinite(n.t) && (MOVE_IDS.includes(n.move) || n.move === 'photo')).map(n => ({ ...n })).sort((a,b) => a.t-b.t) };
    } catch (e) { console.warn('Chart unavailable:', e.message); }
  }
  const beat = 60 / (song.bpm || 120), step = 2, notes = [];
  for (let i = 0, t = 3; t < Math.min(song.duration - 2, 33); i++, t += step * beat) {
    const move = MOVE_IDS[i % MOVE_IDS.length]; notes.push({ t, move, ...(move === 'sweep' ? { dur: step * beat * 0.8 } : {}) });
  }
  return { version: 1, songId: song.id, bpm: song.bpm, offset: 0, notes, fallback: true };
}
