// Feature extraction + static pose classification from (mirrored) MediaPipe landmarks.
//
// Geometry is computed in a BODY FRAME so it works at any distance / position / slight roll:
//   origin = shoulder midpoint, x = along the shoulder line (screen-right in mirrored coords),
//   y = torso-down (perpendicular to the shoulder line, blended with the shoulder→hip axis when hips
//   are visible), unit = shoulder width (or torso length / 1.7 if the player is turned sideways).
// Image x is multiplied by the video aspect ratio first so angles are in true pixel geometry.
// Each arm is then expressed in (out, up) coordinates so left and right are analysed identically.
import { POSE_CONFIG, SCORE_KEYS } from './config.js';
import { DEG, clamp, smoothstep, softBelow } from './math.js';

export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
};

export function emptyScores() {
  const s = {};
  for (const k of SCORE_KEYS) s[k] = 0;
  return s;
}

/** Raw MediaPipe landmarks → mirrored copy (x' = 1 − x). Person's left (11/13/15) ends up screen-left. */
export function mirrorLandmarks(lms) {
  return lms.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0, visibility: p.visibility ?? 1 }));
}

function visOf(p, margin) {
  if (!p) return 0;
  const v = p.visibility ?? 1;
  if (p.x < -margin || p.x > 1 + margin || p.y < -margin || p.y > 1 + margin) return 0;
  return v;
}

const UPPER = [11, 12, 13, 14, 15, 16];
const LOWER = [23, 24, 25, 26, 27, 28];

/**
 * Classify one set of MIRRORED, normalized landmarks.
 * @param {Array<{x,y,z,visibility}>} lm 33 landmarks, mirrored
 * @param {number} aspect videoWidth / videoHeight
 * @returns {{ valid, scores, armAngle, armAngleSigned, elbowStraight, armVis, upperBody, fullBody, scale, debug }}
 *   armAngleSigned: like armAngle but negative when the wrist is across the body midline.
 *   armVis: per-arm visibility gate 0..1 (shoulder/elbow/wrist).
 *   upperArmAngle: signed shoulder→elbow angle (rad) from torso-down: 0 hanging, π/2 T, ±π up, − = across body.
 *   elbowVis: per-arm visibility gate 0..1 of shoulder + elbow only (used by the sweep).
 *   shoulderVis: per-arm shoulder visibility gate (sweep: elbow out of frame at the top).
 *   armStates: per-arm goal-post states { up, down } 0..1 (analyzer uses them for the coincidence lead).
 *   scores.overhead / scores.low: both upper arms high / hanging (shoulders + elbows only).
 *   scale is the body unit in "height units" (normalized y units), used for speed normalisation.
 */
export function classifyLandmarks(lm, aspect = 1, cfg = POSE_CONFIG) {
  const scores = emptyScores();
  const out = {
    valid: false, scores,
    armAngle: { left: 0, right: 0 }, armAngleSigned: { left: 0, right: 0 },
    elbowStraight: { left: 0, right: 0 }, armVis: { left: 0, right: 0 },
    upperArmAngle: { left: 0, right: 0 }, elbowVis: { left: 0, right: 0 }, shoulderVis: { left: 0, right: 0 },
    armStates: { left: { up: 0, down: 0 }, right: { up: 0, down: 0 } },
    upperBody: false, fullBody: false, scale: 0, debug: null,
  };
  if (!lm || lm.length < 29) return out;
  const m = cfg.frameMargin;
  const V = (i) => visOf(lm[i], m);
  out.upperBody = UPPER.every((i) => V(i) >= cfg.presentVis);
  out.fullBody = out.upperBody && LOWER.every((i) => V(i) >= cfg.presentVis);

  const px = (i) => lm[i].x * aspect;
  const py = (i) => lm[i].y;

  // Body frame
  let exx = px(12) - px(11), exy = py(12) - py(11);
  const sw = Math.hypot(exx, exy);
  if (!(sw > 1e-4)) return out;
  exx /= sw; exy /= sw;
  const smx = (px(11) + px(12)) / 2, smy = (py(11) + py(12)) / 2;
  let dx = -exy, dy = exx; // perpendicular to shoulder line, pointing down (y-down image coords)
  let torso = 0;
  if (Math.min(V(23), V(24)) >= cfg.presentVis) {
    const hx = (px(23) + px(24)) / 2 - smx, hy = (py(23) + py(24)) / 2 - smy;
    torso = Math.hypot(hx, hy);
    if (torso > 1e-4 && (hx * dx + hy * dy) > 0) {
      // blend shoulder-line normal with the torso axis (robust to both shrugging and leaning)
      let bx = dx + hx / torso, by = dy + hy / torso;
      const bn = Math.hypot(bx, by);
      bx /= bn; by /= bn;
      // re-orthogonalise x against the blended down axis
      dx = bx; dy = by;
      exx = dy; exy = -dx;
    }
  }
  const scale = Math.max(sw, torso / cfg.torsoToShoulder);
  out.scale = scale;
  const lx = (i) => ((px(i) - smx) * exx + (py(i) - smy) * exy) / scale;
  const ly = (i) => ((px(i) - smx) * dx + (py(i) - smy) * dy) / scale;

  const arm = (side, si, ei, wi) => {
    const Sx = lx(si), Sy = ly(si), Ex = lx(ei), Ey = ly(ei), Wx = lx(wi), Wy = ly(wi);
    // (out, up) components; side = −1 for left (screen-left), +1 for right
    const ux = (Ex - Sx) * side, uy = -(Ey - Sy);
    const fx = (Wx - Ex) * side, fy = -(Wy - Ey);
    const ax = (Wx - Sx) * side, ay = -(Wy - Sy);
    const uLen = Math.hypot(ux, uy), fLen = Math.hypot(fx, fy), aLen = Math.hypot(ax, ay);
    const elev = Math.atan2(uy, ux) * DEG;             // 0 = horizontal outward, +90 up, −90 down
    // Goal-post arm (round 4, loosened): upper arm ~horizontal — a DROPPED elbow (below the shoulder
    // line) is tolerated more than a raised one —, forearm ~vertical, and the elbow clearly BENT
    // (interior angle band). The bend requirement is what keeps straight-arm poses (T-pose, sweep, V,
    // hanging) from ever scoring, so the angle tolerances can be generous.
    const horiz = elev >= 0
      ? softBelow(elev, cfg.upperRaiseFull, cfg.upperRaiseZero)
      : softBelow(-elev, cfg.upperDropFull, cfg.upperDropZero);
    const fUp = Math.atan2(Math.abs(fx), fy) * DEG;     // 0 = forearm pointing straight up
    const fDown = 180 - fUp;                            // 0 = forearm pointing straight down
    const upF = fx >= 0
      ? softBelow(fUp, cfg.forearmUpFull, cfg.forearmUpZero)
      : softBelow(fUp, cfg.forearmUpInFull, cfg.forearmUpInZero);
    const downF = fx >= 0                               // down forearm drifting OUTWARD is common
      ? softBelow(fDown, cfg.forearmDownOutFull, cfg.forearmDownOutZero)
      : softBelow(fDown, cfg.forearmDownInFull, cfg.forearmDownInZero);
    const lenOk = Math.min(smoothstep(cfg.segLenLo, cfg.segLenHi, uLen), smoothstep(cfg.segLenLo, cfg.segLenHi, fLen));
    const cosE0 = uLen > 1e-6 && fLen > 1e-6 ? -(ux * fx + uy * fy) / (uLen * fLen) : 1;
    const interior0 = Math.acos(clamp(cosE0, -1, 1)) * DEG;
    const bend = Math.min(
      smoothstep(cfg.bendMinZero, cfg.bendMinFull, interior0),
      softBelow(interior0, cfg.bendMaxFull, cfg.bendMaxZero),
    );
    const armUp = Math.min(horiz, upF, bend, lenOk);
    const armDown = Math.min(horiz, downF, bend, lenOk);
    const angle = Math.atan2(Math.abs(ax), -ay);        // rad: 0 = hanging, π = straight overhead
    // signed frontal-plane angle: + = on the arm's OWN side (outward), − = across the body midline.
    // (−π, π]; straight up is ±π, so compare with a wrapped difference.
    const signed = Math.atan2(ax, -ay);
    const cosE = uLen > 1e-6 && fLen > 1e-6 ? -(ux * fx + uy * fy) / (uLen * fLen) : 1;
    const interior = Math.acos(clamp(cosE, -1, 1)) * DEG; // 180 = straight
    const straight = smoothstep(cfg.elbowBent, cfg.elbowStraight, interior);
    // Upper arm (shoulder→elbow) signed angle from torso-down: 0 hanging, π/2 T, ±π up, − = across.
    // HIGH / LOW (sweep phases, scores.overhead / scores.low) use ONLY shoulders + elbows so they work
    // when the hands leave the frame. "Effective" angle maps slightly-inward-past-vertical to > π.
    const upper = Math.atan2(ux, -uy);
    const upperEffDeg = (upper < -Math.PI / 2 ? upper + 2 * Math.PI : upper) * DEG;
    const lenU = smoothstep(cfg.segLenLo, cfg.segLenHi, uLen);
    const high = Math.min(
      smoothstep(cfg.highZero, cfg.highFull, upperEffDeg),
      softBelow(upperEffDeg, cfg.highPastFull, cfg.highPastZero),
      lenU,
    );
    const low = softBelow(Math.abs(upper) * DEG, cfg.lowFull, cfg.lowZero);
    const elbowVis = smoothstep(cfg.visLo, cfg.visHi, Math.min(V(si), V(ei)));
    const shoulderVis = smoothstep(cfg.visLo, cfg.visHi, V(si));
    const gate = smoothstep(cfg.visLo, cfg.visHi, Math.min(V(si), V(ei), V(wi)));
    return { Ey, Wx, Wy, armUp, armDown, angle, signed, straight, high, low, gate, elbowVis, shoulderVis, upper, elev, fUp, interior };
  };

  const L = arm(-1, 11, 13, 15);
  const R = arm(1, 12, 14, 16);
  const g = Math.min(L.gate, R.gate);

  scores.up = Math.min(L.armUp, R.armUp) * g;
  scores.down = Math.min(L.armDown, R.armDown) * g;
  scores.split_lu = Math.min(L.armUp, R.armDown) * g;
  scores.split_ld = Math.min(L.armDown, R.armUp) * g;
  const ge = Math.min(L.elbowVis, R.elbowVis); // wrists not required
  scores.overhead = Math.min(L.high, R.high) * ge;
  scores.low = Math.min(L.low, R.low) * ge;

  // Clap: wrists together, not crossed, centred, between face and belly height.
  const wd = Math.hypot(L.Wx - R.Wx, L.Wy - R.Wy);
  const cross = L.Wx - R.Wx; // > 0 → left wrist is right of the right wrist (arms crossed)
  const midX = (L.Wx + R.Wx) / 2, midY = (L.Wy + R.Wy) / 2;
  scores.clap = Math.min(
    softBelow(wd, cfg.clapDistFull, cfg.clapDistZero),
    softBelow(cross, cfg.clapCrossFull, cfg.clapCrossZero),
    softBelow(Math.abs(midX), cfg.clapCenterFull, cfg.clapCenterZero),
    smoothstep(cfg.clapHighZero, cfg.clapHighFull, midY),
    softBelow(midY, cfg.clapLowFull, cfg.clapLowZero),
    smoothstep(cfg.clapElbowZero, cfg.clapElbowFull, Math.min(L.Ey, R.Ey)),
  ) * g;

  out.armAngle.left = L.angle; out.armAngle.right = R.angle;
  out.armAngleSigned.left = L.signed; out.armAngleSigned.right = R.signed;
  out.armVis.left = L.gate; out.armVis.right = R.gate;
  out.upperArmAngle.left = L.upper; out.upperArmAngle.right = R.upper;
  out.elbowVis.left = L.elbowVis; out.elbowVis.right = R.elbowVis;
  out.shoulderVis.left = L.shoulderVis; out.shoulderVis.right = R.shoulderVis;
  out.armStates.left.up = L.armUp * L.gate; out.armStates.left.down = L.armDown * L.gate;
  out.armStates.right.up = R.armUp * R.gate; out.armStates.right.down = R.armDown * R.gate;
  out.elbowStraight.left = L.straight; out.elbowStraight.right = R.straight;
  out.valid = true;
  out.debug = {
    scale, wristDist: wd, cross,
    left: { elev: L.elev, forearmFromUp: L.fUp, elbow: L.interior, vis: L.gate, upper: L.upper * DEG, elbowVis: L.elbowVis },
    right: { elev: R.elev, forearmFromUp: R.fUp, elbow: R.interior, vis: R.gate, upper: R.upper * DEG, elbowVis: R.elbowVis },
  };
  return out;
}

/** Index of the best tap move and its score (debug helper). */
export function argmaxMove(scores, keys = ['up', 'down', 'clap', 'split_lu', 'split_ld']) {
  let best = null, bestS = -1;
  for (const k of keys) if (scores[k] > bestS) { bestS = scores[k]; best = k; }
  return { move: best, score: bestS };
}
