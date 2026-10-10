// Stateful per-frame pipeline: raw MediaPipe landmarks → mirrored, One-Euro-smoothed landmarks →
// classification → energy → PoseFrame. Pure JS (no MediaPipe import) so it is unit-testable.
import { POSE_CONFIG } from './config.js';
import { classifyLandmarks, emptyScores } from './features.js';
import { clamp01, createOneEuroVec } from './math.js';

/**
 * Movement energy: EMA of mean joint speed (shoulder widths / s) over elbows, wrists, hips,
 * mapped linearly to 0..1 (~0 still, ~0.5 dancing, ~1 vigorous).
 */
export function createEnergyMeter(cfg = POSE_CONFIG) {
  const ec = cfg.energy;
  const n = ec.joints.length;
  const prev = new Float64Array(n * 2);
  const prevOk = new Uint8Array(n);
  let prevT = null;
  let speed = 0;
  const map = (s) => clamp01((s - ec.speedLo) / (ec.speedHi - ec.speedLo));
  return {
    get value() { return map(speed); },
    get speed() { return speed; },
    reset() { prevT = null; speed = 0; },
    /** Forget previous joint positions (no speed across a re-acquire), keep the smoothed level. */
    forgetPositions() { prevOk.fill(0); },
    /** lm: mirrored landmarks (or null = not tracked), scale: body unit in height units. */
    update(lm, scale, aspect, tMs) {
      if (prevT !== null && tMs <= prevT) return map(speed);
      const dt = prevT === null ? 0 : (tMs - prevT) / 1000;
      if (!lm || !(scale > 0)) {
        // decay towards 0 while not tracked
        if (dt > 0) speed *= Math.exp(-Math.min(dt, 1) / ec.tau);
        prevT = tMs; prevOk.fill(0);
        return map(speed);
      }
      let sum = 0, cnt = 0;
      for (let k = 0; k < n; k++) {
        const p = lm[ec.joints[k]];
        const ok = (p.visibility ?? 1) >= cfg.presentVis;
        const x = p.x * aspect, y = p.y;
        if (ok && prevOk[k] && dt > 0 && dt <= ec.maxDt) {
          sum += Math.hypot(x - prev[2 * k], y - prev[2 * k + 1]) / scale / dt;
          cnt++;
        }
        prev[2 * k] = x; prev[2 * k + 1] = y; prevOk[k] = ok ? 1 : 0;
      }
      if (cnt > 0) {
        const inst = sum / cnt;
        const a = 1 - Math.exp(-dt / ec.tau);
        speed += a * (inst - speed);
      }
      prevT = tMs;
      return map(speed);
    },
  };
}

// Goal-post moves and the per-arm states they need (left, right).
const PAIR_MOVES = {
  up: ['up', 'up'], down: ['down', 'down'], split_lu: ['up', 'down'], split_ld: ['down', 'up'],
};

/**
 * Coincidence lead (round 4): people rarely put both arms in place on the same frame (one lags by
 * ~100 ms). Scores still require BOTH arms (no cross-talk), but when a goal-post move becomes active
 * the frame reports onsetLead[move] = how long ago the FIRST arm arrived (if ≤ coincidenceMs), and
 * the judge back-dates the onset by that much. Arm arrival uses hysteresis on armStates.
 */
export function createArmArrivals(cfg = POSE_CONFIG) {
  const on = cfg.armOn, off = cfg.armOff, win = cfg.coincidenceMs;
  const st = { left: { up: null, down: null }, right: { up: null, down: null } }; // arrival time (ms) or null
  return {
    reset() { for (const a of ['left', 'right']) st[a].up = st[a].down = null; },
    update(armStates, tMs) {
      for (const a of ['left', 'right']) {
        for (const k of ['up', 'down']) {
          const v = armStates ? armStates[a][k] : 0;
          if (st[a][k] === null && v >= on) st[a][k] = tMs;
          else if (st[a][k] !== null && v <= off) st[a][k] = null;
        }
      }
      const lead = {};
      for (const m in PAIR_MOVES) {
        const [l, r] = PAIR_MOVES[m];
        const tl = st.left[l], tr = st.right[r];
        const d = tl !== null && tr !== null ? Math.abs(tl - tr) : 0;
        lead[m] = d <= win ? d / 1000 : 0; // seconds; 0 when the arms arrived far apart (true onset = later arm)
      }
      return lead;
    },
  };
}

export function untrackedFrame(t, energy = 0, source = 'camera:0', player = 0) {
  return {
    t, player, source, tracked: false, upperBody: false, fullBody: false, landmarks: null, arms: null,
    scores: emptyScores(), armAngle: { left: 0, right: 0 }, armAngleSigned: { left: 0, right: 0 },
    elbowStraight: { left: 0, right: 0 }, armVis: { left: 0, right: 0 },
    upperArmAngle: { left: 0, right: 0 }, elbowVis: { left: 0, right: 0 }, shoulderVis: { left: 0, right: 0 },
    onsetLead: null, energy, debug: null,
  };
}

export function armsFromLandmarks(lm) {
  const xy = (i) => [lm[i].x, lm[i].y];
  return {
    left: { shoulder: xy(11), elbow: xy(13), wrist: xy(15) },
    right: { shoulder: xy(12), elbow: xy(14), wrist: xy(16) },
  };
}

/**
 * @returns {{ process(raw, tMs, aspect, opts?) : PoseFrame, reset() }}
 *   raw: 33 raw MediaPipe landmarks (NOT mirrored) or null when no person detected.
 *   opts.mirrored: pass true if `raw` is already mirrored. Frames carry `player` and `source`.
 */
export function createPoseAnalyzer({ config = POSE_CONFIG, smoothing = true, player = 0, source = `camera:${player}` } = {}) {
  const filt = createOneEuroVec(33 * 3, config.filter);
  const buf = new Float64Array(33 * 3);
  const energy = createEnergyMeter(config);
  const arrivals = createArmArrivals(config);
  let lostSince = null;

  return {
    reset() { filt.reset(); energy.reset(); arrivals.reset(); lostSince = null; },
    /** Re-acquired after a gap (possibly a different body): drop smoothing history, keep energy level. */
    reacquire() { filt.reset(); energy.forgetPositions(); arrivals.reset(); },
    process(raw, tMs, aspect = 1, { mirrored = false } = {}) {
      if (!raw || raw.length < 33) {
        if (lostSince === null) lostSince = tMs;
        if (tMs - lostSince > config.lostResetMs) filt.reset();
        const e = energy.update(null, 0, aspect, tMs);
        arrivals.update(null, tMs);
        return untrackedFrame(tMs, e, source, player);
      }
      lostSince = null;
      for (let i = 0; i < 33; i++) {
        const p = raw[i];
        buf[3 * i] = mirrored ? p.x : 1 - p.x;
        buf[3 * i + 1] = p.y;
        buf[3 * i + 2] = p.z ?? 0;
      }
      if (smoothing) filt.filter(buf, tMs / 1000);
      const lm = new Array(33);
      for (let i = 0; i < 33; i++) {
        lm[i] = { x: buf[3 * i], y: buf[3 * i + 1], z: buf[3 * i + 2], visibility: raw[i].visibility ?? 1 };
      }
      const c = classifyLandmarks(lm, aspect, config);
      const e = energy.update(c.valid ? lm : null, c.scale, aspect, tMs);
      const onsetLead = arrivals.update(c.valid ? c.armStates : null, tMs);
      return {
        t: tMs, player, source, tracked: true, upperBody: c.upperBody, fullBody: c.fullBody,
        landmarks: lm, arms: armsFromLandmarks(lm), scores: c.scores,
        armAngle: c.armAngle, armAngleSigned: c.armAngleSigned, elbowStraight: c.elbowStraight,
        armVis: c.armVis, upperArmAngle: c.upperArmAngle, elbowVis: c.elbowVis, shoulderVis: c.shoulderVis,
        onsetLead, energy: e, debug: c.debug,
      };
    },
  };
}
