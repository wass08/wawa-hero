// Calorie estimate from measured movement energy using the standard MET formula:
//   kcal/min = MET × 3.5 × weightKg / 200
//
// MET anchors (2011 Compendium of Physical Activities, Ainsworth et al., Med Sci Sports Exerc 43(8);
// values unchanged in the 2024 Adult Compendium):
//   energy 0.0 → 1.3 MET  : code 07040 "standing quietly, standing in a line" (1.3)
//   energy 0.5 → 4.0 MET  : code 02068 "video exercise workouts, TV conditioning programs, moderate effort" (4.0);
//                           between 03040 "dancing, ballroom, slow" (3.0) and 03020 "aerobic, low impact" (5.0)
//   energy 1.0 → 7.5 MET  : code 03021 "aerobic, high impact" (7.3) / 03025 "general dancing, e.g. disco" (7.8)
// Linear interpolation between anchors; energy is clamped to 0..1.

export const MET_ANCHORS = [
  [0.0, 1.3],
  [0.5, 4.0],
  [1.0, 7.5],
];

export function metFromEnergy(energy) {
  const e = Number.isFinite(energy) ? Math.min(1, Math.max(0, energy)) : 0;
  for (let i = 1; i < MET_ANCHORS.length; i++) {
    const [e1, m1] = MET_ANCHORS[i];
    if (e <= e1) {
      const [e0, m0] = MET_ANCHORS[i - 1];
      return m0 + ((m1 - m0) * (e - e0)) / (e1 - e0);
    }
  }
  return MET_ANCHORS[MET_ANCHORS.length - 1][1];
}

export const kcalPerMinute = (met, weightKg) => (met * 3.5 * weightKg) / 200;

/**
 * @param {{ weightKg?: number, maxDt?: number }} [o] maxDt clamps each step (s) so tab stalls don't add calories.
 */
export function createCalorieMeter({ weightKg = 70, maxDt = 0.25 } = {}) {
  let kcal = 0;
  const kg = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 70;
  return {
    update(dtSec, energy) {
      const dt = Number.isFinite(dtSec) ? Math.min(Math.max(dtSec, 0), maxDt) : 0;
      kcal += (kcalPerMinute(metFromEnergy(energy), kg) * dt) / 60;
      return kcal;
    },
    get kcal() { return kcal; },
    get weightKg() { return kg; },
    reset() { kcal = 0; },
  };
}
