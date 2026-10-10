// Procedural 33-landmark body (MediaPipe Pose topology). Used by the synthetic/keyboard pose
// driver (avatar arms + armAngle) and by the unit tests.
//
// Arm poses are given as joint angles in the body frame, degrees measured FROM "hanging down",
// positive = rotating OUTWARD (away from the body) in the frontal plane:
//   0 = pointing down, 90 = horizontal out to the side, 180 = straight up, negative = across the body.
//   u = upper arm (shoulder→elbow), f = forearm (elbow→wrist), both absolute (not relative to each other).
import { gaussian } from './math.js';

export const POSES = {
  neutral: { L: { u: 10, f: 6 }, R: { u: 10, f: 6 } },
  up: { L: { u: 90, f: 180 }, R: { u: 90, f: 180 } },
  down: { L: { u: 90, f: 0 }, R: { u: 90, f: 0 } },
  split_lu: { L: { u: 90, f: 180 }, R: { u: 90, f: 0 } },
  split_ld: { L: { u: 90, f: 0 }, R: { u: 90, f: 180 } },
  clap: { L: { u: 15, f: -122 }, R: { u: 15, f: -122 } },
  overhead: { L: { u: 170, f: 170 }, R: { u: 170, f: 170 } },
  low: { L: { u: 14, f: 12 }, R: { u: 14, f: 12 } },
  tpose: { L: { u: 90, f: 90 }, R: { u: 90, f: 90 } },
  vup: { L: { u: 135, f: 135 }, R: { u: 135, f: 135 } },
};

const UPPER_LEN = 0.9; // body units (shoulder widths)
const FORE_LEN = 0.8;

// Static parts in body units (x: screen-right in mirrored view, y: down, origin: shoulder midpoint).
const STATIC = {
  0: [0, -0.75], 1: [-0.08, -0.85], 2: [-0.13, -0.86], 3: [-0.18, -0.85],
  4: [0.08, -0.85], 5: [0.13, -0.86], 6: [0.18, -0.85], 7: [-0.28, -0.8], 8: [0.28, -0.8],
  9: [-0.08, -0.62], 10: [0.08, -0.62],
  11: [-0.5, 0], 12: [0.5, 0],
  23: [-0.33, 1.5], 24: [0.33, 1.5], 25: [-0.34, 2.3], 26: [0.34, 2.3],
  27: [-0.34, 3.1], 28: [0.34, 3.1], 29: [-0.36, 3.2], 30: [0.36, 3.2], 31: [-0.3, 3.3], 32: [0.3, 3.3],
};

const dirOf = (side, deg) => {
  const r = (deg * Math.PI) / 180;
  return [side * Math.sin(r), Math.cos(r)];
};

/** Arm joints in body units from angle pose. */
export function armJoints(pose) {
  const j = {};
  for (const [key, side, s] of [['L', -1, 11], ['R', 1, 12]]) {
    const S = STATIC[s];
    const du = dirOf(side, pose[key].u), df = dirOf(side, pose[key].f);
    const E = [S[0] + du[0] * UPPER_LEN, S[1] + du[1] * UPPER_LEN];
    const W = [E[0] + df[0] * FORE_LEN, E[1] + df[1] * FORE_LEN];
    j[key] = { S, E, W, df };
  }
  return j;
}

/**
 * Build 33 landmarks.
 * @param {object} o
 * @param {object} [o.pose]   angle pose (see POSES)
 * @param {object} [o.joints] explicit { lE, lW, rE, rW } in body units (overrides pose arms)
 * @param {number} [o.cx]     shoulder-midpoint x in normalized (mirrored) image coords
 * @param {number} [o.cy]     shoulder-midpoint y in normalized image coords
 * @param {number} [o.sw]     shoulder width in normalized-HEIGHT units
 * @param {number} [o.aspect] video width / height
 * @param {number} [o.roll]   body roll in degrees
 * @param {number} [o.noise]  gaussian σ in normalized units
 * @param {boolean}[o.mirrored] true → output mirrored coords (as in PoseFrame), false → raw MediaPipe
 */
export function bodyLandmarks({
  pose = POSES.neutral, joints = null, cx = 0.5, cy = 0.4, sw = 0.2, aspect = 16 / 9, roll = 0,
  noise = 0, rng = Math.random, mirrored = false, visibility = 0.99,
} = {}) {
  const pts = new Array(33);
  for (const k in STATIC) pts[k] = STATIC[k];
  let lDir, rDir;
  if (joints) {
    pts[13] = joints.lE; pts[15] = joints.lW; pts[14] = joints.rE; pts[16] = joints.rW;
    const n = (a, b) => { const d = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; };
    lDir = n(joints.lE, joints.lW); rDir = n(joints.rE, joints.rW);
  } else {
    const j = armJoints(pose);
    pts[13] = j.L.E; pts[15] = j.L.W; pts[14] = j.R.E; pts[16] = j.R.W;
    lDir = j.L.df; rDir = j.R.df;
  }
  // hands: pinky / index / thumb a bit beyond the wrist along the forearm
  const hand = (W, d, side) => {
    const nx = -d[1] * side, ny = d[0] * side; // a perpendicular
    return [
      [W[0] + d[0] * 0.18 - nx * 0.05, W[1] + d[1] * 0.18 - ny * 0.05],
      [W[0] + d[0] * 0.22 + nx * 0.03, W[1] + d[1] * 0.22 + ny * 0.03],
      [W[0] + d[0] * 0.1 + nx * 0.08, W[1] + d[1] * 0.1 + ny * 0.08],
    ];
  };
  const hl = hand(pts[15], lDir, -1), hr = hand(pts[16], rDir, 1);
  pts[17] = hl[0]; pts[19] = hl[1]; pts[21] = hl[2];
  pts[18] = hr[0]; pts[20] = hr[1]; pts[22] = hr[2];

  const c = Math.cos((roll * Math.PI) / 180), s = Math.sin((roll * Math.PI) / 180);
  const out = new Array(33);
  for (let i = 0; i < 33; i++) {
    const [bx, by] = pts[i];
    const rx = bx * c - by * s, ry = bx * s + by * c;
    let x = (cx * aspect + rx * sw) / aspect;
    let y = cy + ry * sw;
    if (noise) { x += gaussian(rng) * noise; y += gaussian(rng) * noise; }
    out[i] = { x: mirrored ? x : 1 - x, y, z: 0, visibility: visibility };
  }
  return out;
}

/** Linear interpolation between two angle poses. */
export function lerpPose(a, b, t) {
  const l = (p, q) => ({ u: p.u + (q.u - p.u) * t, f: p.f + (q.f - p.f) * t });
  return { L: l(a.L, b.L), R: l(a.R, b.R) };
}
