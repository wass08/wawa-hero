export const DEG = 180 / Math.PI;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** 1 when x <= full, 0 when x >= zero, smooth in between. */
export const softBelow = (x, full, zero) => 1 - smoothstep(full, zero, x);

/**
 * One-Euro filter over a fixed-size vector (Casiez et al. 2012). Low jitter at rest,
 * low lag when moving fast. Times in seconds.
 */
export function createOneEuroVec(size, { minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
  const x = new Float64Array(size);
  const dx = new Float64Array(size);
  let tPrev = null;
  const alpha = (fc, dt) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
  return {
    reset() { tPrev = null; },
    /** Filters `input` in place (also returns it). */
    filter(input, tSec) {
      if (tPrev === null) {
        x.set(input); dx.fill(0); tPrev = tSec;
        return input;
      }
      const dt = tSec - tPrev;
      if (!(dt > 0)) { input.set(x); return input; }
      tPrev = tSec;
      const ad = alpha(dCutoff, dt);
      for (let i = 0; i < size; i++) {
        const d = (input[i] - x[i]) / dt;
        dx[i] += ad * (d - dx[i]);
        const a = alpha(minCutoff + beta * Math.abs(dx[i]), dt);
        x[i] += a * (input[i] - x[i]);
        input[i] = x[i];
      }
      return input;
    },
  };
}

/** Deterministic PRNG (tests / synthetic noise). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng) {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
