// Two-player identity: maps MediaPipe's unordered pose list to sticky player slots.
// P1 (slot 0) = person on screen-LEFT of the mirrored view, P2 (slot 1) = screen-RIGHT, decided when
// players (re)appear; afterwards identity is sticky (nearest-centroid tracking with hysteresis), so
// jitter or brief overlap never swaps players, and someone stepping out and back in gets their slot back.
//
// Rules per call (detections = poses with a centroid; near-duplicates dropped):
//  * maxPlayers 1: slot 0 ← first detection.
//  * Slots seen within trackMs are TRACKED and claim detections first. Matching cost =
//    |Δx| + |Δy| + 0.5·|Δshoulder-span| against the slot's last signature.
//      - both tracked + 2 detections: the cheaper assignment wins; the one keeping the slots' current
//        left/right order wins near-ties (within swapMargin). The slot signature is an EMA while tracked,
//        so jitter barely moves it and people of different height / distance keep identity even when
//        they overlap or cross;
//      - both tracked + 1 detection: nearest slot;
//      - one tracked: it takes its nearest detection if within the margin-biased comparison, the free
//        slot gets the other detection.
//  * No slot tracked: 2 detections → sorted by x (left = P1); 1 detection → nearest reference
//    (last known x if seen within staleMs, else default 0.25 / 0.75).
import { POSE_CONFIG } from './config.js';

const DEFAULT_X = [0.25, 0.75];

/** Mirrored-x centroid of a RAW (unmirrored) MediaPipe pose: shoulder midpoint, else visible core joints. */
export function poseCentroidX(raw) {
  return poseSignature(raw).x;
}

/** { x (mirrored), y, sw } — shoulder midpoint and shoulder span, used to match people across frames. */
export function poseSignature(raw) {
  const v = (i) => raw[i]?.visibility ?? 1;
  if (v(11) >= 0.3 && v(12) >= 0.3) {
    return {
      x: 1 - (raw[11].x + raw[12].x) / 2,
      y: (raw[11].y + raw[12].y) / 2,
      sw: Math.hypot(raw[11].x - raw[12].x, raw[11].y - raw[12].y),
    };
  }
  let sx = 0, sy = 0, sw = 0;
  for (const i of [0, 11, 12, 23, 24]) {
    const w = Math.max(v(i), 0.05);
    sx += raw[i].x * w; sy += raw[i].y * w; sw += w;
  }
  return { x: 1 - sx / sw, y: sy / sw, sw: null };
}

// Matching cost between a detection and a slot's last signature (x dominates; y and size disambiguate
// people of different height / distance when they overlap horizontally).
const cost = (d, s) => Math.abs(d.x - s.x) + (s.y === null ? 0 : Math.abs(d.y - s.y)) +
  (s.sw && d.sw ? 0.5 * Math.abs(d.sw - s.sw) : 0);

export function createPlayerAssigner({
  maxPlayers = 1,
  trackMs = POSE_CONFIG.players.trackMs,
  staleMs = POSE_CONFIG.players.staleMs,
  swapMargin = POSE_CONFIG.players.swapMargin,
  dupDist = POSE_CONFIG.players.dupDist,
  memoryAlpha = POSE_CONFIG.players.memoryAlpha,
} = {}) {
  let n = maxPlayers === 2 ? 2 : 1;
  let slots;
  const reset = () => { slots = [0, 1].map(() => ({ x: null, y: null, sw: null, seen: -Infinity, wasAssigned: false })); };
  reset();

  return {
    get slots() { return slots.map((s) => ({ x: s.x, seen: s.seen })); },
    get maxPlayers() { return n; },
    setMaxPlayers(m) { const k = m === 2 ? 2 : 1; if (k !== n) { n = k; reset(); } },
    reset,
    /**
     * @param {Array<Array<{x,y,visibility}>>} poses raw MediaPipe landmark lists (any order)
     * @param {number} tMs
     * @returns {{ poses: [raw|null, raw|null], reacquired: [boolean, boolean] }}
     */
    assign(poses, tMs) {
      const out = [null, null];
      const dets = [];
      for (const p of poses || []) {
        if (!p || p.length < 33) continue;
        const sig = poseSignature(p);
        if (!Number.isFinite(sig.x)) continue;
        // duplicate detection of one person
        if (dets.some((d) => Math.abs(d.x - sig.x) < dupDist && Math.abs(d.y - sig.y) < dupDist)) continue;
        dets.push({ p, ...sig });
      }
      if (n === 1) {
        if (dets.length) out[0] = dets[0];
      } else if (dets.length) {
        const tracked = slots.map((s) => s.x !== null && tMs - s.seen <= trackMs);
        const ref = (i) => (slots[i].x !== null && tMs - slots[i].seen <= staleMs ? slots[i].x : DEFAULT_X[i]);
        const d = dets.slice(0, 2).sort((a, b) => a.x - b.x); // d[0] = left
        if (tracked[0] && tracked[1]) {
          if (d.length === 2) {
            const costA = cost(d[0], slots[0]) + cost(d[1], slots[1]); // P1 ← left
            const costB = cost(d[1], slots[0]) + cost(d[0], slots[1]); // P1 ← right
            const keepA = slots[0].x <= slots[1].x;
            const useA = keepA ? !(costB + swapMargin < costA) : costA + swapMargin < costB;
            out[0] = useA ? d[0] : d[1]; out[1] = useA ? d[1] : d[0];
          } else {
            const k = cost(d[0], slots[0]) <= cost(d[0], slots[1]) ? 0 : 1;
            out[k] = d[0];
          }
        } else if (tracked[0] || tracked[1]) {
          const k = tracked[0] ? 0 : 1, o = 1 - k;
          if (d.length === 2) {
            const near = cost(d[0], slots[k]) <= cost(d[1], slots[k]) ? 0 : 1;
            out[k] = d[near]; out[o] = d[1 - near];
          } else {
            // the tracked slot keeps the person unless the free slot's reference is clearly closer
            const dk = cost(d[0], slots[k]), dO = Math.abs(d[0].x - ref(o));
            out[dO + swapMargin < dk ? o : k] = d[0];
          }
        } else if (d.length === 2) {
          out[0] = d[0]; out[1] = d[1];
        } else {
          const k = Math.abs(d[0].x - ref(0)) <= Math.abs(d[0].x - ref(1)) ? 0 : 1;
          out[k] = d[0];
        }
      }
      const reacquired = [false, false];
      for (let i = 0; i < 2; i++) {
        const s = slots[i];
        if (out[i]) {
          reacquired[i] = !s.wasAssigned;
          // EMA memory while continuously tracked (less jitter in the reference), snap on re-acquire
          const k = s.wasAssigned ? memoryAlpha : 1;
          const mix = (a, b) => (a === null || b === null || b === undefined ? b ?? null : a + k * (b - a));
          s.x = mix(s.x, out[i].x); s.y = mix(s.y, out[i].y); s.sw = mix(s.sw, out[i].sw);
          s.seen = tMs; s.wasAssigned = true;
        } else {
          s.wasAssigned = false;
        }
      }
      return { poses: [out[0] ? out[0].p : null, out[1] ? out[1].p : null], reacquired };
    },
  };
}
