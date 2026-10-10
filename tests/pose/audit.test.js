// Regression tests for the audit findings (one block per defect) + the 0.24 s clap pair.
import { describe, expect, it } from 'vitest';
import { bodyLandmarks, classifyLandmarks, createJudge, emptyScores, mirrorLandmarks, POSE_CONFIG } from '../../src/pose/index.js';

// single-frame onsets (round-4 dwell disabled) for tests about frame ordering
const NO_DWELL = { ...POSE_CONFIG, judge: { ...POSE_CONFIG.judge, dwellByMove: {} } };

const FPS = 30;

function frame(ts, scores = {}, extra = {}) {
  return {
    t: Math.round(ts * 1e6) / 1e3, source: 'camera', tracked: true,
    scores: { ...emptyScores(), ...scores },
    armAngle: { left: 0.2, right: 0.2 }, armAngleSigned: { left: 0.2, right: 0.2 },
    elbowStraight: { left: 1, right: 1 }, armVis: { left: 1, right: 1 }, energy: 0,
    ...extra,
  };
}

/** Runs t0..t1 at FPS; fn(ts) → frame | null. Returns final judgements with the song time they were emitted at. */
function simulate(judge, notes, fn, t0, t1) {
  const res = [];
  for (let i = 0; i <= Math.round((t1 - t0) * FPS); i++) {
    const ts = t0 + i / FPS;
    for (const j of judge.update(fn(ts), ts, notes)) if (j.result !== null) res.push({ ...j, at: ts });
  }
  return res;
}
const byT = (r) => Object.fromEntries(r.map((j) => [j.note.t, j.result]));

// Frame built through the real classifier from a generated body (arm angles in degrees, see body.js).
function bodyFrame(ts, angDeg, { visibility = 0.99, across = false } = {}) {
  const a = across ? -angDeg : angDeg;
  const lm = mirrorLandmarks(bodyLandmarks({ pose: { L: { u: a, f: a }, R: { u: a, f: a } }, visibility }));
  const c = classifyLandmarks(lm, 16 / 9);
  return {
    t: Math.round(ts * 1e6) / 1e3, source: 'camera', tracked: true, scores: c.scores,
    armAngle: c.armAngle, armAngleSigned: c.armAngleSigned, elbowStraight: c.elbowStraight, armVis: c.armVis,
  };
}
const DEG = 180 / Math.PI;
const arcDeg = (t, dur) => (ts) => {
  const p = Math.min(1, Math.max(0, (ts - t) / dur));
  return (2.95 + (0.3 - 2.95) * p) * DEG;
};
const sweepNote = () => [{ t: 2, move: 'sweep', dur: 1.5 }];
const sweepBody = (opts) => (ts) => bodyFrame(ts, ts < 1.6 ? 8 : arcDeg(2, 1.5)(ts), opts);

describe('audit #1: one onset never credits two notes', () => {
  it('onset at 2.20 hits 2.25 and does NOT retroactively hold-credit 2.00', () => {
    const notes = [{ t: 2, move: 'up' }, { t: 2.25, move: 'up' }];
    const r = simulate(createJudge(), notes, (ts) => frame(ts, ts >= 2.2 ? { up: 1 } : {}), 0, 3.5);
    expect(r).toHaveLength(2);
    expect(byT(r)).toEqual({ 2: 'miss', 2.25: 'perfect' });
  });
});

describe('audit #2: sweep is gated on arm visibility', () => {
  it('ideal arc with visible arms = perfect, with visibility 0.1 = miss', () => {
    expect(simulate(createJudge(), sweepNote(), sweepBody(), 0, 4.5)[0].result).toBe('perfect');
    const r = simulate(createJudge(), sweepNote(), sweepBody({ visibility: 0.1 }), 0, 4.5);
    expect(r[0].result).toBe('miss');
    expect(r[0].accuracy).toBeLessThan(0.3);
  });

  it('arms going invisible mid-sweep count as not tracking', () => {
    const fn = (ts) => bodyFrame(ts, ts < 1.6 ? 8 : arcDeg(2, 1.5)(ts), { visibility: ts > 2.5 ? 0.1 : 0.99 });
    expect(simulate(createJudge(), sweepNote(), fn, 0, 4.5)[0].result).toBe('miss');
  });
});

describe('audit #3: sweep must go out to the sides (signed angle)', () => {
  it('armAngleSigned is negative across the body, positive on own side', () => {
    const own = bodyFrame(0, 90), across = bodyFrame(0, 90, { across: true });
    expect(own.armAngleSigned.left).toBeCloseTo(Math.PI / 2, 1);
    expect(across.armAngleSigned.left).toBeCloseTo(-Math.PI / 2, 1);
    expect(across.armAngleSigned.right).toBeCloseTo(-Math.PI / 2, 1);
    expect(across.armAngle.left).toBeCloseTo(Math.PI / 2, 1); // unsigned contract unchanged
  });

  it('straight arms sweeping down ACROSS the body do not track', () => {
    const fn = (ts) => bodyFrame(ts, ts < 1.6 ? 8 : arcDeg(2, 1.5)(ts), { across: ts >= 2 });
    const r = simulate(createJudge(), sweepNote(), fn, 0, 4.5);
    expect(r[0].result).toBe('miss');
  });
});

describe('audit #4: per-arm sweep errors cannot cancel', () => {
  it('one arm 0.85 rad above the ideal, the other 0.85 below → miss', () => {
    const ideal = (ts) => arcDeg(2, 1.5)(ts) / DEG;
    const fn = (ts) => {
      if (ts < 1.6) return frame(ts, { low: 1 });
      if (ts < 2) return frame(ts, { overhead: 1 }, { armAngleSigned: { left: 2.95, right: 2.95 }, armAngle: { left: 2.95, right: 2.95 } });
      const i = ideal(ts);
      const L = i + 0.85, R = i - 0.85; // mean == ideal
      return frame(ts, { low: 0 }, { armAngleSigned: { left: L, right: R }, armAngle: { left: Math.abs(L), right: Math.abs(R) } });
    };
    const r = simulate(createJudge(), sweepNote(), fn, 0, 4.5);
    expect(r[0].result).toBe('miss');
  });
});

describe('audit #5 (round 3 semantics): incomplete sweeps fail; LOW is required', () => {
  it('first 0.8 s observed, then no frames → miss', () => {
    const fn = (ts) => (ts < 2.8 ? sweepBody()(ts) : null);
    const r = simulate(createJudge(), sweepNote(), fn, 0, 4.5);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe('miss');
  });

  it('arc that stops at the T (never LOW) → miss', () => {
    const fn = (ts) => bodyFrame(ts, ts < 1.6 ? 8 : Math.max(arcDeg(2, 1.5)(ts), 80));
    const r = simulate(createJudge(), sweepNote(), fn, 0, 4.5);
    expect(r[0].result).toBe('miss');
    expect(r[0].reason).toBe('no-low');
  });
});

describe('audit #6: out-of-order frames are ignored', () => {
  it('an older frame cannot cause a false release / re-onset', () => {
    const judge = createJudge({ config: NO_DWELL });
    const notes = [{ t: 1, move: 'up' }, { t: 1.2, move: 'up' }];
    expect(judge.update(frame(1.0, { up: 1 }), 1.0, notes).map((j) => j.result)).toEqual(['perfect']);
    expect(judge.update(frame(0.95, {}), 0.95, notes)).toEqual([]); // stale, out of order
    // still the same activation → no fresh onset credit for 1.2 at 1.03
    expect(judge.update(frame(1.03, { up: 1 }), 1.03, notes)).toEqual([]);
    const rest = [];
    for (let ts = 1.06; ts < 1.6; ts += 1 / FPS) rest.push(...judge.update(frame(ts, { up: 1 }), ts, notes));
    expect(rest.map((j) => [j.note.t, j.result, j.held])).toEqual([[1.2, 'good', true]]);
  });
});

describe('audit #7: hold credit requires holding through the window', () => {
  it('released before t+good → no hold credit (miss)', () => {
    const r = simulate(createJudge(), [{ t: 2, move: 'up' }], (ts) => frame(ts, ts >= 0.5 && ts < 2.1 ? { up: 1 } : {}), 0, 3);
    expect(r.map((j) => j.result)).toEqual(['miss']);
  });

  it('held through t+good → good, resolved at t+good', () => {
    const r = simulate(createJudge(), [{ t: 2, move: 'up' }], (ts) => frame(ts, ts >= 0.5 && ts < 2.4 ? { up: 1 } : {}), 0, 3);
    expect(r.map((j) => j.result)).toEqual(['good']);
    expect(r[0].held).toBe(true);
    expect(r[0].at).toBeGreaterThanOrEqual(2.3 - 1e-9);
  });

  it('required hold ends when the next note window opens', () => {
    const notes = [{ t: 2, move: 'up' }, { t: 2.4, move: 'down' }];
    const fn = (ts) => frame(ts, ts >= 0.5 && ts < 2.15 ? { up: 1 } : ts >= 2.4 ? { down: 1 } : {});
    const r = simulate(createJudge(), notes, fn, 0, 3);
    expect(byT(r)).toEqual({ 2: 'good', 2.4: 'perfect' });
  });
});

describe('clap pair 0.24 s apart ("Clap. Clap.")', () => {
  const notes = () => [{ t: 2, move: 'clap' }, { t: 2.24, move: 'clap' }];

  it('two separate onsets → two perfects', () => {
    const fn = (ts) => frame(ts, (ts >= 2.0 && ts < 2.1) || (ts >= 2.24 && ts < 2.4) ? { clap: 1 } : {});
    const r = simulate(createJudge(), notes(), fn, 0, 3);
    expect(byT(r)).toEqual({ 2: 'perfect', 2.24: 'perfect' });
  });

  it('two separate onsets at 60 fps with a realistic short gap → two perfects', () => {
    const judge = createJudge();
    const ns = notes();
    const res = [];
    for (let i = 0; i <= 180; i++) {
      const ts = i / 60;
      const on = (ts >= 1.98 && ts < 2.08) || (ts >= 2.2 && ts < 2.35);
      for (const j of judge.update(frame(ts, on ? { clap: 1 } : {}), ts, ns)) if (j.result) res.push(j);
    }
    expect(res.map((j) => j.result)).toEqual(['perfect', 'perfect']);
  });

  it('hands held together through both → perfect then held good', () => {
    const r = simulate(createJudge(), notes(), (ts) => frame(ts, ts >= 2.0 && ts < 2.8 ? { clap: 1 } : {}), 0, 3);
    expect(byT(r)).toEqual({ 2: 'perfect', 2.24: 'good' });
    expect(r.find((j) => j.note.t === 2.24).held).toBe(true);
  });

  it('held for the first but released before the second window ends → second not credited', () => {
    const r = simulate(createJudge(), notes(), (ts) => frame(ts, ts >= 2.0 && ts < 2.4 ? { clap: 1 } : {}), 0, 3);
    expect(byT(r)).toEqual({ 2: 'perfect', 2.24: 'miss' });
  });
});
