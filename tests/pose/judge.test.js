import { describe, expect, it } from 'vitest';
import { createJudge, createSyntheticPose, emptyScores, POSE_CONFIG } from '../../src/pose/index.js';

const NO_DWELL = { ...POSE_CONFIG, judge: { ...POSE_CONFIG.judge, dwellByMove: {} } };

const FPS = 30;

function frame(ts, scores = {}, extra = {}) {
  return {
    t: Math.round(ts * 1e6) / 1e3, source: 'camera', tracked: true,
    scores: { ...emptyScores(), low: 1, ...scores },
    armAngle: { left: 0.2, right: 0.2 }, elbowStraight: { left: 1, right: 1 }, energy: 0,
    ...extra,
  };
}

/** Run judge from t0..t1 at FPS with frames from fn(ts) → frame. Returns final (non-null) judgements. */
function simulate(judge, notes, fn, t0, t1, { keepProgress = false } = {}) {
  const res = [];
  const n = Math.round((t1 - t0) * FPS);
  for (let i = 0; i <= n; i++) {
    const ts = t0 + i / FPS;
    for (const j of judge.update(fn(ts), ts, notes)) if (keepProgress || j.result !== null) res.push(j);
  }
  return res;
}

const pose = (move, from, to = Infinity) => (ts) => frame(ts, ts >= from && ts < to ? { [move]: 1, low: 0 } : {});

describe('judge: tap notes', () => {
  it('perfect when the onset is on time', () => {
    const notes = [{ t: 2, move: 'up' }];
    const r = simulate(createJudge(), notes, pose('up', 2.0), 0, 3);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe('perfect');
    expect(Math.abs(r[0].off)).toBeLessThan(0.04);
    expect(notes[0].judged).toBe(true);
  });

  it('early good / late good / outside window miss', () => {
    const early = simulate(createJudge(), [{ t: 2, move: 'down' }], pose('down', 1.78), 0, 3);
    expect(early[0].result).toBe('good');
    expect(early[0].off).toBeLessThan(-0.15);
    const late = simulate(createJudge(), [{ t: 2, move: 'down' }], pose('down', 2.22), 0, 3);
    expect(late[0].result).toBe('good');
    expect(late[0].off).toBeGreaterThan(0.15);
    const tooLate = simulate(createJudge(), [{ t: 2, move: 'down' }], pose('down', 2.4), 0, 3);
    expect(tooLate).toHaveLength(1);
    expect(tooLate[0].result).toBe('miss');
  });

  it('miss when nothing happens; miss is emitted just after t+good', () => {
    const judge = createJudge();
    const notes = [{ t: 1, move: 'clap' }];
    expect(judge.update(frame(1.29), 1.29, notes)).toHaveLength(0);
    const r = judge.update(frame(1.31), 1.31, notes);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe('miss');
  });

  it('wrong move does not hit', () => {
    const r = simulate(createJudge(), [{ t: 2, move: 'up' }], pose('down', 1.95), 0, 3);
    expect(r.map((j) => j.result)).toEqual(['miss']);
  });

  it('holding the pose through the window = good (no free perfect)', () => {
    const r = simulate(createJudge(), [{ t: 2, move: 'up' }], pose('up', 0.5), 0, 3);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe('good');
    expect(r[0].held).toBe(true);
  });

  it('two consecutive ups: re-entering hits both perfectly', () => {
    const notes = [{ t: 2, move: 'up' }, { t: 2.5, move: 'up' }];
    const fn = (ts) => frame(ts, (ts >= 2.0 && ts < 2.3) || ts >= 2.5 ? { up: 1 } : {});
    const r = simulate(createJudge(), notes, fn, 0, 3.5);
    expect(r.map((j) => [j.note.t, j.result])).toEqual([[2, 'perfect'], [2.5, 'perfect']]);
  });

  it('two consecutive ups: holding through gives perfect then good', () => {
    const notes = [{ t: 2, move: 'up' }, { t: 2.5, move: 'up' }];
    const r = simulate(createJudge(), notes, pose('up', 2.0), 0, 3.5);
    expect(r.map((j) => [j.note.t, j.result])).toEqual([[2, 'perfect'], [2.5, 'good']]);
  });

  it('fast repeats (eighths) can be held', () => {
    const notes = [{ t: 2, move: 'clap' }, { t: 2.25, move: 'clap' }, { t: 2.5, move: 'clap' }];
    const r = simulate(createJudge(), notes, pose('clap', 2.0), 0, 3.5);
    expect(r.map((j) => j.result)).toEqual(['perfect', 'good', 'good']);
  });

  it('one onset hits only the closest note; each note judged exactly once', () => {
    const notes = [{ t: 2, move: 'up' }, { t: 2.5, move: 'up' }, { t: 3, move: 'down' }];
    const fn = (ts) => frame(ts, ts >= 2.48 && ts < 2.6 ? { up: 1 } : {});
    const r = simulate(createJudge(), notes, fn, 0, 5);
    expect(r).toHaveLength(3);
    expect(new Set(r.map((j) => j.note)).size).toBe(3);
    expect(r.find((j) => j.note.t === 2).result).toBe('miss');
    expect(r.find((j) => j.note.t === 2.5).result).toBe('perfect');
    expect(r.find((j) => j.note.t === 3).result).toBe('miss');
  });

  it('hysteresis: jitter around the threshold does not create extra onsets', () => {
    const notes = [{ t: 2, move: 'up' }, { t: 2.4, move: 'up' }];
    // score jitters 0.55..0.65 after 2.0 → one onset only; second note then held → good
    const fn = (ts) => frame(ts, ts >= 2.0 ? { up: Math.round(ts * FPS) % 2 ? 0.65 : 0.55 } : {});
    const r = simulate(createJudge(), notes, fn, 0, 3);
    expect(r.map((j) => j.result)).toEqual(['perfect', 'good']);
    expect(r[1].held).toBe(true);
  });

  it('latency is subtracted from song time', () => {
    // pose happens at song 2.2 (would be late-good) but with 0.2 s latency it's on time
    const r = simulate(createJudge({ latency: 0.2 }), [{ t: 2, move: 'up' }], pose('up', 2.2), 0, 3);
    expect(r[0].result).toBe('perfect');
  });

  it('repeated frames (same t) are ignored; reset() clears flags', () => {
    const judge = createJudge({ config: NO_DWELL }); // single-frame onsets for this ordering test
    const notes = [{ t: 1, move: 'up' }];
    const f = frame(1.0, { up: 1 });
    expect(judge.update(frame(0.9), 0.9, notes)).toHaveLength(0);
    expect(judge.update(f, 1.0, notes)[0].result).toBe('perfect');
    expect(judge.update(f, 1.0, notes)).toHaveLength(0);
    for (let ts = 1.0; ts < 2; ts += 0.03) expect(judge.update(frame(ts, { up: 1 }), ts, notes)).toHaveLength(0);
    judge.reset();
    expect(notes[0].judged).toBeUndefined();
  });

  it('null frames only expire notes', () => {
    const judge = createJudge();
    const notes = [{ t: 1, move: 'up' }];
    expect(judge.update(null, 1.0, notes)).toHaveLength(0);
    expect(judge.update(null, 1.4, notes)[0].result).toBe('miss');
  });
});

// Sweep helpers: armAngle trajectory a(ts), straightness s(ts)
const sweepFrame = (ts, a, s = 1) => frame(ts, {
  overhead: a > 2.6 && s > 0.8 ? 1 : 0, low: a < 0.5 ? 1 : 0,
}, { armAngle: { left: a, right: a }, elbowStraight: { left: s, right: s } });

const idealArc = (t, dur, lag = 0) => (ts) => {
  const p = Math.min(1, Math.max(0, (ts - t - lag) / dur));
  return 2.95 + (0.3 - 2.95) * p;
};

describe('judge: sweep', () => {
  const note = () => ({ t: 2, move: 'sweep', dur: 1.5 });

  it('ideal sweep = perfect, emits progress while active', () => {
    const n = note();
    const arc = idealArc(2, 1.5);
    const all = simulate(createJudge(), [n], (ts) => sweepFrame(ts, ts < 2 ? (ts > 1.6 ? 2.95 : 0.2) : arc(ts)), 0, 4.5, { keepProgress: true });
    const prog = all.filter((j) => j.result === null);
    expect(prog.length).toBeGreaterThan(30);
    expect(prog.at(-1).progress).toBeCloseTo(1, 1);
    const fin = all.filter((j) => j.result !== null);
    expect(fin).toHaveLength(1);
    expect(fin[0].result).toBe('perfect');
    expect(fin[0].accuracy).toBeGreaterThan(0.9);
  });

  it('a slightly late sweep is still good, a very late start misses', () => {
    const n = note();
    const lag = 0.28;
    const r = simulate(createJudge(), [n], (ts) => sweepFrame(ts, ts < 1.6 ? 0.2 : idealArc(2, 1.5, lag)(ts)), 0, 4.5);
    expect(['good', 'perfect']).toContain(r[0].result);
    const n2 = note();
    const r2 = simulate(createJudge(), [n2], (ts) => sweepFrame(ts, ts < 2.5 ? 0.2 : idealArc(2.5, 1.5)(ts)), 0, 4);
    expect(r2[0].result).toBe('miss');
  });

  it('bent elbows are fine (round 3: no straightness requirement)', () => {
    const n = note();
    const arc = idealArc(2, 1.5);
    const r = simulate(createJudge(), [n], (ts) => sweepFrame(ts, ts < 1.6 ? 0.2 : arc(ts), 0.1), 0, 4.5);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe('perfect');
  });

  it('no arc (arms stay overhead) fails', () => {
    const n = note();
    const r = simulate(createJudge(), [n], (ts) => sweepFrame(ts, ts < 1.6 ? 0.2 : 2.95), 0, 4.5);
    expect(r[0].result).toBe('miss');
    expect(r[0].accuracy).toBeLessThan(0.5);
  });

  it('dropping arms instantly = phases in order but loose timing → good (lenient)', () => {
    const n = note();
    const r = simulate(createJudge(), [n], (ts) => sweepFrame(ts, ts > 1.8 && ts < 2.1 ? 2.95 : 0.2), 0, 4.5);
    expect(r[0].result).toBe('good');
    expect(r[0].off).toBeLessThan(-0.375);
  });

  it('never overhead → miss at t+good', () => {
    const judge = createJudge();
    const n = note();
    const r = simulate(judge, [n], (ts) => sweepFrame(ts, 0.2), 0, 2.4);
    expect(r).toHaveLength(1);
    expect(r[0].result).toBe('miss');
  });
});

describe('synthetic pose + judge (bot)', () => {
  it('a bot pressing keys on time gets perfects on everything', () => {
    const notes = [
      { t: 1, move: 'up' }, { t: 1.5, move: 'up' }, { t: 2, move: 'down' }, { t: 2.5, move: 'clap' },
      { t: 3, move: 'split_lu' }, { t: 3.5, move: 'split_ld' }, { t: 4, move: 'sweep', dur: 1.5 },
      { t: 6, move: 'clap' },
    ];
    const syn = createSyntheticPose();
    const judge = createJudge();
    const res = [];
    let held = null;
    for (let ms = 0; ms <= 7000; ms += 1000 / 60) {
      const ts = ms / 1000;
      // bot: press each note's move at note.t, release 0.3 s later (or at dur end for sweeps)
      for (const n of notes) {
        if (!n._pressed && ts >= n.t) {
          if (held) syn.release(held);
          syn.press(n.move, { t: ms, dur: n.dur });
          held = n.move; n._pressed = true; n._rel = n.t + (n.dur || 0.3);
        }
        if (held === n.move && n._pressed && !n._released && ts >= n._rel) { syn.release(n.move); held = null; n._released = true; }
      }
      const f = syn.update(ms);
      for (const j of judge.update(f, ts, notes)) if (j.result) res.push(j);
    }
    expect(res).toHaveLength(notes.length);
    for (const j of res) expect(j.result, `${j.note.move}@${j.note.t}`).toBe('perfect');
  });

  it('synthetic frame shape', () => {
    const syn = createSyntheticPose();
    syn.press('split_lu');
    let f;
    for (let ms = 0; ms <= 200; ms += 16) f = syn.update(ms);
    expect(f.source).toBe('synthetic:0');
    expect(f.player).toBe(0);
    expect(f.scores.split_lu).toBe(1);
    expect(f.arms.left.wrist[1]).toBeLessThan(f.arms.left.elbow[1]); // left forearm up
    expect(f.arms.left.wrist[0]).toBeLessThan(0.5);                  // left on screen-left
    expect(f.arms.right.wrist[1]).toBeGreaterThan(f.arms.right.elbow[1]);
    expect(f.landmarks).toHaveLength(33);
    syn.release('split_lu');
    for (let ms = 216; ms <= 600; ms += 16) f = syn.update(ms);
    expect(f.scores.split_lu).toBe(0);
    expect(f.scores.low).toBeGreaterThan(0.8);
  });

  it('synthetic sweep follows the arc and key repeat does not restart it', () => {
    const syn = createSyntheticPose();
    syn.press('sweep', { t: 0 });
    const f0 = syn.update(0);
    expect(f0.armAngle.left).toBeGreaterThan(2.8);
    expect(f0.scores.overhead).toBeGreaterThan(0.8);
    syn.update(700);
    syn.press('sweep', { t: 700 }); // auto-repeat keydown
    const f1 = syn.update(750);
    expect(f1.upperArmAngle.left).toBeGreaterThan(1.4); // ≈ T at mid-duration
    expect(f1.upperArmAngle.left).toBeLessThan(1.8);
    const f2 = syn.update(1600);
    expect(f2.upperArmAngle.left).toBeCloseTo((10 * Math.PI) / 180, 1);
    expect(f2.scores.low).toBeGreaterThan(0.9);
  });
});
