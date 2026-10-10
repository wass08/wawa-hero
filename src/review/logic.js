import { formatTime } from '../time.js';
import { cloneNotes } from '../game/versus.js';
export const REVIEW_RATES = [.5, .75, 1];
export const reviewRate = value => REVIEW_RATES.includes(Number(value)) ? Number(value) : 1;
export const clampTime = (time, duration) => Math.max(0, Math.min(duration, Number(time) || 0));
const clean = values => [...new Set((values || []).filter(Number.isFinite))].sort((a, b) => a - b);
const latest = (values, time) => {
  let lo = 0, hi = values.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (values[m] <= time + 1e-7) lo = m + 1; else hi = m; }
  return lo - 1;
};
// Anchor bars to detected downbeats. Beats before the first downbeat are a
// pickup, not bar 1 beat 1. Use measured intervals, including tempo drift.
export function createBeatGrid(chart = {}, duration = 180) {
  const interval = 60 / (chart.bpm > 0 ? chart.bpm : 120), beats = clean(chart.beats);
  let downbeats = clean(chart.downbeats);
  if (!downbeats.length) {
    const first = Number.isFinite(chart.offset) ? chart.offset : beats[0] || 0;
    downbeats = Array.from({ length: Math.ceil((duration - first) / (interval * 4)) + 2 }, (_, i) => first + i * interval * 4);
  }
  const anchors = [];
  for (let i = 0; i < downbeats.length; i++) {
    const start = downbeats[i], end = downbeats[i + 1] ?? start + (downbeats[i] - downbeats[i - 1] || interval * 4);
    const measured = beats.filter(t => t >= start - .015 && t < end - .015);
    // Missing/extra detector pulses fall back to four subdivisions of the
    // measured bar, rather than allowing an accidental fifth beat.
    anchors.push(start);
    for (let j = 1; j < 4; j++) anchors.push(measured.length === 4 ? measured[j] : start + (end - start) * j / 4);
  }
  function beatTime(position) {
    const index = Math.floor(position), fraction = position - index;
    if (index < 0) return anchors[0] + position * (anchors[1] - anchors[0]);
    if (index >= anchors.length - 1) return anchors.at(-1) + (position - anchors.length + 1) * (anchors.at(-1) - anchors.at(-2));
    return anchors[index] + fraction * (anchors[index + 1] - anchors[index]);
  }
  function beatPosition(time) {
    const index = latest(anchors, time);
    if (index < 0) return (time - anchors[0]) / (anchors[1] - anchors[0]);
    const next = index + 1 < anchors.length ? anchors[index + 1] : beatTime(index + 1);
    return index + (time - anchors[index]) / (next - anchors[index]);
  }
  return {
    anchors, beatPosition, beatTime,
    at(time) { const position = beatPosition(time), index = Math.floor(position + 1e-7); return { bar: Math.floor(index / 4) + 1, beat: ((index % 4) + 4) % 4 + 1, fraction: position - index }; },
    time(bar, beat = 1) { return beatTime((bar - 1) * 4 + beat - 1); },
    step(time, amount) { return clampTime(beatTime(beatPosition(time) + amount), duration); },
    loop(time) {
      const bar = Math.max(1, this.at(Math.min(time, Math.max(0, duration - .001))).bar), start = clampTime(this.time(bar), duration), end = clampTime(this.time(bar + 4), duration);
      return { start, end, bar, endBar: Math.min(bar + 3, Math.max(bar, this.at(Math.max(start, end - .001)).bar)) };
    },
  };
}
export function cueAt(cues = [], time) {
  let lo=0,hi=cues.length;while(lo<hi){const mid=(lo+hi)>>1;if(cues[mid].t<=time)lo=mid+1;else hi=mid;}return cues[lo-1]||null;
}
export function createSeekState(source, time) {
  const visualNotes = cloneNotes(source);
  const active = n => n.move === 'sweep' && n.t < time && n.t + (n.dur || 0) > time;
  for (const note of visualNotes) if (note.t < time - 1e-7 && !active(note)) note.uiResult = 'good';
  return {
    visualNotes, notes: visualNotes.filter(n => n.t >= time - 1e-7 || active(n)),
    resolved: new Set(), botCursor: 0, botMove: null, botNote: null,
    botReleaseAt: 0, photoPose: null, photoUntil: 0, releasePending: false,
  };
}
export function reviewCopy({ songId, time, grid, note, index, camera }) {
  const { bar, beat } = grid.at(time);
  return `${songId} @ ${formatTime(time, 3)} · bar ${bar}.${beat}${note ? ` · note #${index + 1} ${note.move}${note.move === 'sweep' ? ` (sweep dur ${Number(note.dur || 0).toFixed(2)})` : ''}` : ''}${camera ? ` · camera ${camera}` : ''}`;
}
export function reviewLink(params, songId) {
  const next = new URLSearchParams(params); next.set('review', '');
  for (const field of ['state', 'autoplay', 'song', 't', 'rate', 'shot']) next.delete(field);
  if (songId) next.set('song', songId);
  return `?${next}`;
}
