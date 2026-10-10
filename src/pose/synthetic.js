// Keyboard / bot pose driver. Produces full PoseFrames (source: 'synthetic:<player>', tracked: false)
// so the game has ONE judging path. Tap moves ramp their score 0→1 over `ramp` seconds while held;
// the arms (for avatar mirroring) blend to the move's goal-post pose. Holding 'sweep' plays the
// sweep phases: arms HIGH (165°) → T (90°, ≈ mid-duration) → LOW (10°) linearly over `dur` seconds
// (out to the sides, upper arm + forearm straight), then stays low until released.
import { MOVES, POSE_CONFIG, TAP_MOVES } from './config.js';
import { POSES, bodyLandmarks, lerpPose } from './body.js';
import { classifyLandmarks } from './features.js';
import { armsFromLandmarks, createEnergyMeter } from './analyzer.js';
import { clamp01 } from './math.js';

/**
 * @param {object} [o]
 * @param {0|1}    [o.player=0]     frames carry player and source 'synthetic:<player>'
 * @param {number} [o.sweepDur=1.5] default sweep arc duration (s); press('sweep', { dur }) overrides
 * @param {number} [o.ramp=0.06]    pose ramp time (s)
 */
export function createSyntheticPose({ player = 0, sweepDur = 1.5, ramp = 0.06, config = POSE_CONFIG, body = {} } = {}) {
  const source = `synthetic:${player}`;
  const bodyOpts = { cx: 0.5, cy: 0.38, sw: 0.2, aspect: 16 / 9, ...body };
  const sc = config.judge.sweep;
  const held = new Map(); // move → { t0 (ms|null), dur }
  const level = Object.fromEntries(TAP_MOVES.map((m) => [m, 0]));
  let cur = structuredClone(POSES.neutral);
  let lastT = null;
  const energy = createEnergyMeter(config);
  const startDeg = sc.synthStartDeg;
  const endDeg = sc.synthEndDeg;

  return {
    /** press(move, { t?: ms (sweep start time; default = next update), dur?: s (sweep) }). Key repeats are ignored. */
    press(move, opts = {}) {
      if (!MOVES.includes(move) || held.has(move)) return;
      held.set(move, { t0: opts.t ?? null, dur: opts.dur ?? sweepDur });
    },
    release(move) { held.delete(move); },
    releaseAll() { held.clear(); },
    isHeld(move) { return held.has(move); },
    update(nowMs = performance.now()) {
      const dt = lastT === null ? 0 : Math.min(Math.max((nowMs - lastT) / 1000, 0), 0.1);
      lastT = nowMs;
      for (const m of TAP_MOVES) {
        const target = held.has(m) ? 1 : 0;
        const step = ramp > 0 ? dt / ramp : 1;
        level[m] = target > level[m] ? Math.min(target, level[m] + step) : Math.max(target, level[m] - step);
      }
      // Most recently pressed held move drives the arms.
      let display = null;
      for (const m of held.keys()) display = m;
      if (display === 'sweep') {
        const h = held.get('sweep');
        if (h.t0 === null) h.t0 = nowMs;
        const p = clamp01((nowMs - h.t0) / 1000 / h.dur);
        const a = startDeg + (endDeg - startDeg) * p;
        cur = { L: { u: a, f: a }, R: { u: a, f: a } };
      } else {
        const target = POSES[display] || POSES.neutral;
        const k = ramp > 0 ? 1 - Math.exp((-3 * dt) / ramp) : 1;
        cur = lerpPose(cur, target, k);
      }
      const lm = bodyLandmarks({ pose: cur, mirrored: true, ...bodyOpts });
      const c = classifyLandmarks(lm, bodyOpts.aspect, config);
      const scores = { ...c.scores };
      for (const m of TAP_MOVES) scores[m] = level[m];
      const e = energy.update(lm, c.scale, bodyOpts.aspect, nowMs);
      return {
        t: nowMs, player, source, synthetic: true, tracked: false, upperBody: false, fullBody: false,
        landmarks: lm, arms: armsFromLandmarks(lm), scores,
        armAngle: c.armAngle, armAngleSigned: c.armAngleSigned, elbowStraight: c.elbowStraight,
        armVis: c.armVis, upperArmAngle: c.upperArmAngle, elbowVis: c.elbowVis, shoulderVis: c.shoulderVis,
        onsetLead: null, energy: e, debug: null,
      };
    },
  };
}
