// Note judging. Pure logic over PoseFrames + song time; no DOM, no MediaPipe.
//
// TAP NOTES (up/down/clap/split_lu/split_ld)
//  * Each move has an on/off state per frame source with hysteresis (on ≥ judge.on, off ≤ judge.off).
//    Each continuous "on" period is an ACTIVATION.
//  * A rising ONSET at song time ts (= songTime − latency) hits the CLOSEST unjudged note of that move
//    with |ts − t| ≤ good (ties → earlier note). off = ts − t; |off| ≤ perfect → 'perfect' else 'good'.
//    Round 4: goal-post moves (up/down/split_*) must DWELL ≥ dwellByMove (60 ms) above `on` without
//    dropping to `off` before the onset is confirmed — this filters the ~40 ms split-shaped transient
//    when flipping up↔down with one arm lagging. The onset time is the START of the dwell, back-dated
//    by frame.onsetLead (first arm's arrival, ≤ maxLead), so timing is not delayed; misses are deferred
//    while such an activation is pending. Splits use on 0.5 / off 0.3 (others 0.6 / 0.4).
//  * HOLD rule → 'good' (never perfect, `held: true`). An activation is ELIGIBLE for note n if it began
//    before n's window opened (since ≤ t − good) or it already credited an EARLIER note (t' < t).
//    It never credits a note earlier than one it already credited. Credit is given only if the
//    activation is still on at holdEnd = max(t, min(t + good, nextNote.t − good)) — i.e. the pose
//    is held through the window, or until the next chart note's window opens, whichever is first.
//    Releasing before holdEnd → no hold credit (a new onset inside the window can still hit it).
//      - a statue that holds the pose from before the window gets 'good' at t + good;
//      - repeated identical notes (up, up / clap 0.24 s clap): re-entering the pose hits each one
//        normally (perfect possible); holding through gives the first its onset judgement and the
//        following ones 'good' each.
//  * Unjudged when ts > t + good (+ missDelay) → 'miss'. Every note is judged exactly once (tracked
//    internally and mirrored onto note.judged / note.result).
//
// SWEEP NOTES ({ move:'sweep', dur }) — phase-based and FORGIVING (SPEC rounds 3–4)
//  * Uses only the UPPER arms: frame.upperArmAngle (signed, rad: 0 hanging, π/2 T, ±π up, − = across),
//    frame.elbowVis and frame.shoulderVis. Each arm is read independently: an arm with a visible elbow
//    is used; an arm whose elbow is not visible but whose shoulder is, and whose last visible reading
//    was high or rising above inferMin, is INFERRED high (elbow left the frame at the top). One usable
//    arm is enough; a frame with no usable arm is ignored.
//  * HIGH: all usable arms ≥ highMin (1.9 rad) at some frame within [t − good − earlyHigh, t + good]
//    (holding high before the cue counts).
//  * LOW: after HIGH, all usable (non-inferred) arms |angle| ≤ lowMax (0.85 rad), at or before
//    t + dur + phaseGrace (0.7 s). Resolves immediately. LOW before the cue (t) means the player came
//    down early → state resets (a new HIGH within the window is needed).
//  * T crossing (each arm downward through π/2 on its own side, interpolated between frames) only
//    decides perfect vs good: perfect = T (latest arm) within ±tWindow·dur (25 %) of t + dur/2 AND LOW by
//    t + dur; otherwise good (also when no crossing was observed, or LOW came late within the grace).
//  * miss only for: no HIGH in the window (resolved at t + good), no LOW by t + dur + phaseGrace, or
//    clearly wrong direction (a visible upper arm across the body for acrossFrames frames).
//  * Emits { note, result: null, progress (descent fraction, monotonic), phase: 'high'|'t' } while
//    active; final { off: T − (t + dur/2) (0 if unknown), progress, accuracy, phase|reason }.
//    accuracy: perfect 0.8..1, good 0.4..0.6, miss 0.
//
// MULTIPLE SOURCES: frames carry `source` ('camera' | 'synthetic'); edge/hold state is kept per source,
// so the game may call update() with the camera frame AND the keyboard frame each rAF. Frames that are
// not strictly newer than the last frame of the same source (repeated or out-of-order frame.t) are
// ignored except for miss expiry. Pass frame = null to only expire notes. Sweeps are tracked per
// source and the best source wins.
// `missDelay` (s, default 0) postpones miss/sweep resolution without widening the hit window — useful
// when a low-latency source (keyboard, songTime≈now) and the camera (songTime≈now−latency) are both fed,
// so the keyboard frames don't expire a note before a late camera frame for it has arrived.
import { POSE_CONFIG, TAP_MOVES } from './config.js';
import { clamp01 } from './math.js';

const TAP_SET = new Set(TAP_MOVES);

export function createJudge({ perfect = 0.15, good = 0.3, latency = 0, missDelay = 0, config = POSE_CONFIG } = {}) {
  const jc = config.judge;
  const sc = jc.sweep;
  let notesRef = null;
  let judged = new Set();
  let sweeps = new Map();
  let sources = new Map();
  let cursor = 0;

  const newSource = () => ({
    lastT: -Infinity,
    // usedT: t of the latest note credited by the current activation (−∞ if none)
    // pending: onset candidate time while dwelling (goal-post moves), null otherwise
    moves: Object.fromEntries(TAP_MOVES.map((m) => [m, { on: false, since: -Infinity, usedT: -Infinity, pending: null, pendingTs: 0 }])),
  });
  const getSource = (key) => {
    let s = sources.get(key);
    if (!s) { s = newSource(); sources.set(key, s); }
    return s;
  };

  function clearState() {
    if (notesRef) for (const n of notesRef) { delete n.judged; delete n.result; }
    judged = new Set(); sweeps = new Map(); sources = new Map(); cursor = 0;
  }

  function finish(out, n, result, extra) {
    judged.add(n);
    n.judged = true;
    n.result = result;
    out.push({ note: n, result, ...extra });
  }

  // ---- SWEEP (phase-based, forgiving; upper arms only) ----
  const eff = (a) => (a < -Math.PI / 2 ? a + 2 * Math.PI : a); // past-vertical-inward counts as > π

  /**
   * Per-arm reading for the sweep: { a: signed angle, e: effective angle, inferred } or null.
   * An arm is usable when its elbow is visible. If the elbow is NOT visible but the shoulder is, and the
   * last visible reading of that arm was high or rising above ~80° (elbow left the frame at the top when
   * the player is close), the arm is INFERRED high.
   */
  function readArm(mem, frame, side, ts) {
    const ua = frame.upperArmAngle || frame.armAngleSigned || frame.armAngle;
    const defVis = frame.tracked === false && !frame.synthetic ? 0 : 1;
    const ev = (frame.elbowVis || frame.armVis || { left: defVis, right: defVis })[side];
    const sv = (frame.shoulderVis || { left: ev, right: ev })[side];
    const m = mem[side];
    if (ev >= sc.visMin) {
      const a = ua[side], e = eff(a);
      m.rising = m.e !== null && e > m.e + 0.01 ? true : m.e !== null && e < m.e - 0.01 ? false : m.rising;
      m.e = e; m.ts = ts; m.inferred = false;
      return { a, e, inferred: false };
    }
    if (sv >= sc.visMin && m.e !== null && m.e >= sc.inferMin && (m.rising || m.e >= sc.highMin)) {
      m.inferred = true;
      const e = Math.max(m.e, sc.highMin + 0.05);
      return { a: e > Math.PI ? e - 2 * Math.PI : e, e, inferred: true };
    }
    return null;
  }

  /** Advance one source's phase machine with a fresh frame. */
  function sweepStep(s, n, dur, frame, ts) {
    if (s.failed || s.lowTs !== null) return;
    const arms = { left: readArm(s.mem, frame, 'left', ts), right: readArm(s.mem, frame, 'right', ts) };
    const list = [arms.left, arms.right].filter(Boolean);
    if (!list.length) return; // nothing usable on this frame: neither progress nor failure
    const isHigh = list.every((r) => r.e >= sc.highMin && r.e <= sc.highMax);
    if (s.highTs === null) {
      if (isHigh && ts >= n.t - good - sc.earlyHigh && ts <= n.t + good) s.highTs = ts;
      else return;
    }
    // clearly wrong direction: a VISIBLE upper arm well across the body for several frames
    const across = list.some((r) => !r.inferred && r.a <= -sc.acrossMin && r.a >= -sc.acrossMax);
    if (across) { if (++s.acrossN >= sc.acrossFrames) { s.failed = true; return; } } else s.acrossN = 0;
    // T crossing per arm: interpolated between consecutive usable readings of that arm
    for (const side of ['left', 'right']) {
      const r = arms[side], p = s.prev[side];
      if (!r) continue;
      if (s.tCross[side] === null && p && ts - p.ts <= sc.maxInterpGap && p.e >= sc.tAngle && r.e < sc.tAngle && r.a > -sc.acrossMin) {
        s.tCross[side] = p.ts + (ts - p.ts) * ((p.e - sc.tAngle) / Math.max(p.e - r.e, 1e-6));
      }
      s.prev[side] = { ts, e: r.e };
    }
    const mean = list.reduce((acc, r) => acc + r.e, 0) / list.length;
    s.progress = Math.max(s.progress, clamp01((sc.progressFrom - mean) / (sc.progressFrom - sc.progressTo)));
    const isLow = list.every((r) => !r.inferred && Math.abs(r.a) <= sc.lowMax);
    if (isLow && ts <= n.t + dur + sc.phaseGrace + 1e-9) {
      if (ts < n.t + sc.minLowAfter * dur) {
        // came down long before the cue: not this sweep — needs a new HIGH (still within the window)
        s.highTs = null; s.tCross = { left: null, right: null }; s.progress = 0;
        return;
      }
      s.lowTs = ts; s.progress = 1;
    }
  }

  function sweepVerdict(s, n, dur) {
    const crossings = [s.tCross.left, s.tCross.right].filter((v) => v !== null);
    const lateLow = s.lowTs > n.t + dur + sc.lowOnTimeTol;
    const tol = sc.tWindow * dur;
    if (!crossings.length) return { result: 'good', off: 0, accuracy: lateLow ? 0.4 : 0.55 };
    const off = Math.max(...crossings) - (n.t + dur / 2);
    if (!lateLow && Math.abs(off) <= tol + 1e-9) {
      return { result: 'perfect', off, accuracy: 1 - 0.2 * (Math.abs(off) / tol) };
    }
    const loose = clamp01((Math.abs(off) - tol) / tol);
    return { result: 'good', off, accuracy: lateLow ? 0.4 : 0.6 - 0.2 * loose };
  }

  const newSweepState = () => ({
    highTs: null, tCross: { left: null, right: null }, lowTs: null, failed: false, acrossN: 0,
    prev: { left: null, right: null }, progress: 0,
    mem: { left: { e: null, ts: 0, rising: false, inferred: false }, right: { e: null, ts: 0, rising: false, inferred: false } },
  });

  function sweepUpdate(out, n, frame, srcKey, ts) {
    let per = sweeps.get(n);
    if (!per) { per = new Map(); sweeps.set(n, per); }
    const dur = n.dur > 0 ? n.dur : sc.defaultDur;
    if (frame) {
      let s = per.get(srcKey);
      if (!s) { s = newSweepState(); per.set(srcKey, s); }
      sweepStep(s, n, dur, frame, ts);
      if (s.lowTs !== null) {
        const v = sweepVerdict(s, n, dur);
        finish(out, n, v.result, { off: v.off, progress: 1, accuracy: v.accuracy, phase: 'low' });
        sweeps.delete(n);
        return;
      }
    }
    let started = false, alive = false, best = null;
    for (const s of per.values()) {
      if (s.highTs === null) continue;
      started = true;
      if (s.failed) continue;
      alive = true;
      if (!best || s.progress > best.progress) best = s;
    }
    const over = ts > n.t + dur + sc.phaseGrace + missDelay;
    if ((!started && ts > n.t + good + missDelay) || (started && !alive) || over) {
      const failed = started && !alive;
      finish(out, n, 'miss', { off: 0, progress: best ? best.progress : 0, accuracy: 0,
        reason: !started ? 'no-high' : failed ? 'wrong-direction' : 'no-low' });
      sweeps.delete(n);
    } else if (frame && best && ts >= n.t - good) {
      const phase = best.tCross.left !== null || best.tCross.right !== null ? 't' : 'high';
      out.push({ note: n, result: null, progress: best.progress, accuracy: 0, phase });
    }
  }

  return {
    /**
     * @param {PoseFrame|null} frame
     * @param {number} songTime song time (s) at frame.t (or current song time when frame is null)
     * @param {Array} notes chart notes, sorted by t
     * @returns {Array<{note, result:'perfect'|'good'|'miss'|null, off?, progress?, accuracy?, held?}>}
     */
    update(frame, songTime, notes) {
      const out = [];
      if (!notes) return out;
      if (notes !== notesRef) { clearState(); notesRef = notes; }
      const ts = songTime - latency;
      while (cursor < notes.length && judged.has(notes[cursor])) cursor++;

      // Fresh frame? (dedupe per source)
      let src = null;
      const srcKey = (frame && frame.source) || 'default';
      if (frame && frame.scores) {
        const s = getSource(srcKey);
        if (frame.t > s.lastT) { s.lastT = frame.t; src = s; } // ignore repeated / out-of-order frames
      }
      const fresh = src ? frame : null;

      // 1) onsets
      if (src) {
        for (const m of TAP_MOVES) {
          const st = src.moves[m];
          const v = frame.scores[m] ?? 0;
          const on = jc.onByMove?.[m] ?? jc.on, offT = jc.offByMove?.[m] ?? jc.off;
          const dwell = jc.dwellByMove?.[m] ?? 0;
          if (!st.on && st.pending === null && v >= on) {
            // back-date by the coincidence lead (first arm arrived up to maxLead earlier)
            const lead = Math.min(Math.max(frame.onsetLead?.[m] ?? 0, 0), jc.maxLead ?? 0);
            st.pending = ts - lead; st.pendingTs = ts;
          }
          if (!st.on && st.pending !== null && v <= offT) st.pending = null; // transient: never confirmed
          if (!st.on && st.pending !== null && ts - st.pendingTs >= dwell - 1e-9) {
            // confirmed (held ≥ dwell): the onset time is the start of the dwell
            const tOn = st.pending;
            st.pending = null;
            st.on = true; st.since = tOn; st.usedT = -Infinity;
            let best = null, bestD = Infinity;
            for (let i = cursor; i < notes.length; i++) {
              const n = notes[i];
              if (n.t - good > tOn) break;
              if (n.move !== m || judged.has(n)) continue;
              const d = Math.abs(tOn - n.t);
              if (d <= good + 1e-9 && d < bestD - 1e-9) { best = n; bestD = d; }
            }
            if (best) {
              const off = tOn - best.t;
              finish(out, best, Math.abs(off) <= perfect + 1e-9 ? 'perfect' : 'good', { off });
              st.usedT = best.t;
            }
          } else if (st.on && v <= offT) {
            st.on = false;
          }
        }
      }

      // 2) holds, sweeps, misses (sweeps are watched from t − good − earlyHigh)
      const look = good + (sc.earlyHigh ?? 0);
      for (let i = cursor; i < notes.length; i++) {
        const n = notes[i];
        if (n.t - look > ts) break;
        if (judged.has(n)) continue;
        if (n.move === 'sweep') { sweepUpdate(out, n, fresh, srcKey, ts); continue; }
        if (!TAP_SET.has(n.move)) continue;
        if (src) {
          const st = src.moves[n.move];
          // next chart note (any move) after n: its window opening ends n's required hold
          let nextT = Infinity;
          for (let k = i + 1; k < notes.length; k++) if (notes[k].t > n.t) { nextT = notes[k].t; break; }
          const holdEnd = Math.max(n.t, Math.min(n.t + good, nextT - good));
          const eligible = st.on && st.since <= holdEnd &&
            (st.since <= n.t - good + 1e-9 || (st.usedT > -Infinity && st.usedT < n.t));
          if (eligible && ts >= holdEnd - 1e-9) {
            finish(out, n, 'good', { off: st.since - n.t, held: true });
            st.usedT = Math.max(st.usedT, n.t);
            continue;
          }
        }
        // don't expire while an activation that started inside the window is still dwelling
        const pend = src ? src.moves[n.move].pending : null;
        if (pend !== null && pend <= n.t + good + 1e-9) continue;
        if (ts > n.t + good + missDelay + 1e-9) finish(out, n, 'miss', { off: ts - n.t });
      }
      return out;
    },
    /** Clears all judging state (and note.judged/result flags of the last notes array). */
    reset() { clearState(); notesRef = null; },
  };
}
