// All show-camera tuning lives here. The LED wall spans x ±10.5, y 4.2–12,
// z -6.2. Framing includes its side EQ panels; the mirrored feed is its centre.
// preview selects a stationary, representative motion phase for ?shot tuning.
export const SHOTS = {
  front:     { pos: [0, 1.5, 11.5], look: [0, 3.3, -4], fov: 58, motion: 'breathe', amount: 0.18 },
  wide:      { pos: [0, 7, 28], look: [0, 4, -4], fov: 50, motion: 'drift', amount: 0.4 },
  close:     { pos: [0, 3, 8], look: [-0.25, 7.8, -6.2], fov: 54, motion: 'handheld', amount: 0.045 },
  low_left:  { pos: [-11, 0.35, 10.2], look: [0, 6.5, -6.2], fov: 63, motion: 'breathe', amount: 0.16, crowdBrightness: 0.22 },
  low_right: { pos: [11, 0.35, 10.2], look: [0, 6.5, -6.2], fov: 63, motion: 'breathe', amount: 0.16, crowdBrightness: 0.22 },
  high:      { pos: [0, 11, 18], look: [0, -0.5, -6.2], fov: 65, motion: 'drift', amount: 0.28 },
  orbit:     { pos: [0, 4.5, 14], look: [0, 4.4, -6.2], fov: 56, motion: 'orbit', amount: Math.PI / 4, preview: 0.5 },
  drop:      { pos: [0, 1.2, 19], look: [-0.25, 6.8, -6.2], fov: 58, motion: 'push', amount: 9, fovKick: 10 },
};
const ids = ['front', 'wide', 'orbit', 'low_left', 'high', 'low_right', 'close'];
const clamp = n => Math.max(0, Math.min(1, n));
const pose = () => ({ pos: [0, 0, 0], look: [0, 0, 0], fov: 58 });
function copy(out, source) {
  for (let j = 0; j < 3; j++) { out.pos[j] = source.pos[j]; out.look[j] = source.look[j]; }
  out.fov = source.fov; out.crowdBrightness = source.crowdBrightness ?? 1; return out;
}
export function fallbackCameraTrack(chart, duration = 183.5) {
  const bpm = Number.isFinite(chart.bpm) && chart.bpm > 0 ? chart.bpm : 120;
  const bar = 240 / bpm, offset = Number.isFinite(chart.offset) ? chart.offset : 0;
  const bars = Array.isArray(chart.downbeats) ? chart.downbeats.filter(t => Number.isFinite(t) && t >= 0).sort((a,b) => a-b) : [];
  const cues = [{ t: 0, shot: 'front', ease: 0 }];
  if (bars.length > 8) {
    for (let i = 8; i < bars.length; i += 8) if (bars[i] < duration) cues.push({ t: bars[i], shot: ids[cues.length % ids.length], ease: 1.9 });
  } else for (let t = offset + bar * 8; t < duration; t += bar * 8) if (t > 0) cues.push({ t, shot: ids[cues.length % ids.length], ease: 1.9 });
  return cues;
}
export function cameraCueIndex(cues, time) {
  let lo = 0, hi = cues.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cues[m].t <= time) lo = m + 1; else hi = m; }
  return lo - 1;
}
function target(out, cue, time, end, downbeatPhase) {
  const preset = SHOTS[cue.shot]; copy(out, preset);
  const elapsed = Math.max(0, time - cue.t), a = preset.amount;
  if (preset.motion === 'breathe') out.pos[2] += Math.sin(elapsed * 0.65) * a;
  if (preset.motion === 'drift') { out.pos[0] += Math.sin(elapsed * 0.3) * a; out.pos[1] += Math.sin(elapsed * 0.45) * 0.09; }
  if (preset.motion === 'handheld') { out.pos[0] += Math.sin(elapsed * 1.7) * a; out.pos[1] += Math.sin(elapsed * 2.1) * a * 0.6; }
  if (preset.motion === 'orbit') {
    // Linger at the first corner, then sweep across: the middle of the shot
    // remains an unmistakable three-quarter view rather than another front.
    const p = clamp(elapsed / Math.max(1, end - cue.t));
    const angle = (2 * p*p*p - 1) * a, radius = preset.pos[2] - preset.look[2];
    out.pos[0] = Math.sin(angle) * radius; out.pos[2] = preset.look[2] + Math.cos(angle) * radius;
  }
  if (preset.motion === 'push') {
    const kick = Math.exp(-downbeatPhase * 18);
    out.pos[2] -= a * kick; out.fov -= preset.fovKick * kick;
  }
  if (preset.motion !== 'handheld') out.pos[1] += Math.sin(elapsed * 0.5) * 0.04;
}
// Stateless cue lookup + precomputed transition origins make backward seeks deterministic.
// One output object and its arrays are reused for every frame.
export function createShotScheduler(chart = {}, { duration = 183.5, pinned } = {}) {
  const bpm = Number.isFinite(chart.bpm) && chart.bpm > 0 ? chart.bpm : 120;
  const downbeats = Array.isArray(chart.downbeats) ? chart.downbeats.filter(Number.isFinite).sort((a,b)=>a-b) : [];
  const beats = Array.isArray(chart.beats) ? chart.beats.filter(Number.isFinite).sort((a,b)=>a-b) : [];
  // Detected downbeats take precedence; every fourth detected beat is a
  // fallback, then bpm/offset. A drop punches once per bar, not four times.
  const pulseTimes = downbeats.length ? downbeats : beats.filter((_,i) => i % 4 === 0);
  function phaseAt(time) {
    let lo=0,hi=pulseTimes.length;
    while(lo<hi){const m=(lo+hi)>>1;if(pulseTimes[m]<=time)lo=m+1;else hi=m;}
    const i=lo-1;
    if(i>=0&&i<pulseTimes.length-1&&pulseTimes[i+1]>pulseTimes[i])return clamp((time-pulseTimes[i])/(pulseTimes[i+1]-pulseTimes[i]));
    const phase=(time-(pulseTimes[i] ?? chart.offset ?? 0))*bpm/240;
    return ((phase%1)+1)%1;
  }
  let cues = Array.isArray(chart.camera) ? chart.camera.filter(c => c && Number.isFinite(c.t) && c.t >= 0 && Object.hasOwn(SHOTS, c.shot)).map(c => ({ t: c.t, shot: c.shot, ease: Number.isFinite(c.ease) ? Math.max(0, c.ease) : 1.9 })).sort((a,b) => a.t-b.t) : [];
  if (!cues.length) cues = fallbackCameraTrack(chart, duration);
  if (cues[0].t > 0) cues.unshift({ t: 0, shot: 'front', ease: 0 });
  const output = pose(), scratch = pose(); let frozenTime = null, cutIndex = -1;
  function evaluate(out, index, time) {
    if (index < 0) return copy(out, SHOTS.front);
    const cue = cues[index]; target(out, cue, time, cues[index+1]?.t ?? Math.max(duration, cue.t + 16), phaseAt(time));
    const p = cue.ease && index !== cutIndex ? clamp((time - cue.t) / cue.ease) : 1, k = p*p*(3-2*p);
    for (let j = 0; j < 3; j++) { out.pos[j] = cue.from.pos[j] + (out.pos[j] - cue.from.pos[j]) * k; out.look[j] = cue.from.look[j] + (out.look[j] - cue.from.look[j]) * k; }
    out.fov = cue.from.fov + (out.fov - cue.from.fov) * k;
    out.crowdBrightness = cue.from.crowdBrightness + (out.crowdBrightness - cue.from.crowdBrightness) * k; return out;
  }
  for (let i = 0; i < cues.length; i++) { evaluate(scratch, i-1, cues[i].t); cues[i].from = copy(pose(), scratch); }
  // Precompute the stationary tuning view; no per-frame cue allocation.
  const hasPinned = Object.hasOwn(SHOTS, pinned), pinnedPose = pose();
  if (hasPinned) target(pinnedPose, { shot: pinned, t: 0 }, (SHOTS[pinned].preview ?? 0) * 16, 16, 0);
  return {
    cues,
    sample(time) {
      time = frozenTime ?? time;
      if (hasPinned) {
        // Freeze the orbit mid-shot and the drop on a downbeat. All other
        // presets freeze at their base pose (zero handheld/breathing sway).
        copy(output, pinnedPose);
        output.shot = pinned; output.cueIndex = -1;
      }
      else { const i = cameraCueIndex(cues, time); evaluate(output, i, time); output.shot = cues[i]?.shot ?? 'front'; output.cueIndex = i; }
      return output;
    },
    pause(time) { frozenTime = time; }, resume() { frozenTime = null; }, reset() { frozenTime = null; cutIndex = -1; },
    seek(time) { frozenTime = null; cutIndex = cameraCueIndex(cues, time); return this.sample(time); },
  };
}
