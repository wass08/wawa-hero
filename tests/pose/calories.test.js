import { describe, expect, it } from 'vitest';
import { createCalorieMeter, metFromEnergy, kcalPerMinute } from '../../src/pose/index.js';

describe('calories', () => {
  it('MET interpolation', () => {
    expect(metFromEnergy(0)).toBeCloseTo(1.3);
    expect(metFromEnergy(0.25)).toBeCloseTo(2.65);
    expect(metFromEnergy(0.5)).toBeCloseTo(4.0);
    expect(metFromEnergy(1)).toBeCloseTo(7.5);
    expect(metFromEnergy(3)).toBeCloseTo(7.5);
    expect(metFromEnergy(-1)).toBeCloseTo(1.3);
    expect(metFromEnergy(NaN)).toBeCloseTo(1.3);
  });

  it('kcal/min = MET × 3.5 × kg / 200', () => {
    expect(kcalPerMinute(4, 70)).toBeCloseTo(4.9);
  });

  it('one minute of moderate dancing at 70 kg ≈ 4.9 kcal', () => {
    const m = createCalorieMeter({ weightKg: 70 });
    for (let i = 0; i < 3600; i++) m.update(1 / 60, 0.5);
    expect(m.kcal).toBeCloseTo(4.9, 2);
  });

  it('3 min vigorous at 80 kg ≈ 31.5 kcal; still at 60 kg ≈ 1.37 kcal / min', () => {
    const v = createCalorieMeter({ weightKg: 80 });
    for (let i = 0; i < 180 * 30; i++) v.update(1 / 30, 1);
    expect(v.kcal).toBeCloseTo(7.5 * 3.5 * 80 / 200 * 3, 1);
    const s = createCalorieMeter({ weightKg: 60 });
    for (let i = 0; i < 60; i++) s.update(1, 0); // dt clamped to 0.25 s per call
    expect(s.kcal).toBeCloseTo(1.3 * 3.5 * 60 / 200 / 4, 3);
  });

  it('clamps dt and resets', () => {
    const m = createCalorieMeter();
    m.update(10, 1);
    expect(m.kcal).toBeCloseTo(7.5 * 3.5 * 70 / 200 * 0.25 / 60, 6);
    m.update(-5, 1);
    m.update(NaN, 1);
    expect(m.kcal).toBeCloseTo(7.5 * 3.5 * 70 / 200 * 0.25 / 60, 6);
    m.reset();
    expect(m.kcal).toBe(0);
  });
});
