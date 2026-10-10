// Sweep practice helpers (tutorial ✓ and pose-debug.html): an instantaneous phase label and a
// self-arming sweep judge that starts a virtual sweep note whenever the player raises both arms HIGH.
import { POSE_CONFIG } from './config.js';
import { createJudge } from './judge.js';

/**
 * Instantaneous sweep phase from the upper arms only:
 * 'none' (not visible) | 'high' | 'mid' (between high and T) | 't' | 'below' (between T and low) | 'low' | 'across'
 */
export function sweepPhaseOf(frame, config = POSE_CONFIG) {
  const sc = config.judge.sweep;
  if (!frame || !frame.upperArmAngle) return 'none';
  const v = frame.elbowVis || { left: 1, right: 1 };
  if (Math.min(v.left, v.right) < sc.visMin) return 'none';
  const { left: L, right: R } = frame.upperArmAngle;
  const across = (a) => a <= -sc.acrossMin && a >= -sc.acrossMax;
  if (across(L) || across(R)) return 'across';
  const eff = (a) => (a < -Math.PI / 2 ? a + 2 * Math.PI : a);
  const lo = Math.min(eff(L), eff(R)), hi = Math.max(eff(L), eff(R));
  if (lo >= sc.highMin) return 'high';
  if (Math.abs(L) <= sc.lowMax && Math.abs(R) <= sc.lowMax) return 'low';
  const tBand = 0.3; // ±17° around the T
  if (Math.abs(eff(L) - sc.tAngle) <= tBand && Math.abs(eff(R) - sc.tAngle) <= tBand) return 't';
  return lo > sc.tAngle || hi >= sc.highMin ? 'mid' : 'below';
}

/**
 * Self-arming sweep practice: raising both arms HIGH starts a virtual sweep note (t = now, dur) judged by
 * the real judge; after a result, the arms must leave HIGH before it re-arms.
 * update(frame, tSec) → { phase, active, progress, result: Judgement|null (set on the resolving call), last }
 */
export function createSweepPractice({ dur = 1.5, config = POSE_CONFIG } = {}) {
  const judge = createJudge({ config });
  let notes = null;
  let armed = true;
  let progress = 0;
  let last = null;
  return {
    reset() { judge.reset(); notes = null; armed = true; progress = 0; last = null; },
    get last() { return last; },
    update(frame, tSec) {
      const phase = sweepPhaseOf(frame, config);
      let result = null;
      if (!notes) {
        if (!armed && phase !== 'high') armed = true;
        if (armed && phase === 'high') {
          judge.reset();
          notes = [{ t: tSec, move: 'sweep', dur }];
          armed = false; progress = 0;
        }
      }
      if (notes) {
        for (const j of judge.update(frame, tSec, notes)) {
          progress = j.progress ?? progress;
          if (j.result) { result = j; last = j; notes = null; }
        }
      }
      return { phase, active: !!notes, progress, result, last };
    },
  };
}
