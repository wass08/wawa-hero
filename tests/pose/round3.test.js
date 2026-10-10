// Round 3: phase-based sweep (upper arms only), two-player identity, P2 keyboard driver.
import { describe, expect, it, vi } from 'vitest';
import {
  bodyLandmarks, classifyLandmarks, createJudge, createPlayerAssigner, createSyntheticPose, createSweepPractice,
  mirrorLandmarks, MOVE_KEYS, MOVE_KEYS_P2, PLAYER_KEYS, POSES, sweepPhaseOf, TAP_MOVES,
} from '../../src/pose/index.js';
import { mulberry32 } from '../../src/pose/math.js';

const FPS = 30;
const DEG = 180 / Math.PI;

function simulate(judge, notes, fn, t0, t1, { keepProgress = false } = {}) {
  const res = [];
  for (let i = 0; i <= Math.round((t1 - t0) * FPS); i++) {
    const ts = t0 + i / FPS;
    for (const j of judge.update(fn(ts), ts, notes)) if (keepProgress || j.result !== null) res.push({ ...j, at: ts });
  }
  return res;
}

/**
 * Frame from a generated body via the real classifier. `deg` = upper-arm angle (both arms, own side
 * unless across), forearm continues straight unless `fore` given. Options tweak wrists / visibility.
 */
function bodyFrame(ts, deg, { across = false, fore = null, wristVis = 0.99, cy = 0.4, sw = 0.2 } = {}) {
  const u = across ? -deg : deg;
  const f = fore ?? u;
  const raw = bodyLandmarks({ pose: { L: { u, f }, R: { u, f } }, cy, sw });
  for (const i of [15, 16, 17, 18, 19, 20, 21, 22]) raw[i].visibility = wristVis;
  const c = classifyLandmarks(mirrorLandmarks(raw), 16 / 9);
  return {
    t: Math.round(ts * 1e6) / 1e3, player: 0, source: 'camera:0', tracked: true, scores: c.scores,
    armAngle: c.armAngle, armAngleSigned: c.armAngleSigned, upperArmAngle: c.upperArmAngle,
    elbowVis: c.elbowVis, armVis: c.armVis, elbowStraight: c.elbowStraight,
  };
}
// upper-arm angle (deg) along a linear arc HIGH(165°) → LOW(10°) from t over d seconds
const arc = (t, d, from = 165, to = 10) => (ts) => from + (to - from) * Math.min(1, Math.max(0, (ts - t) / d));
const note = (dur = 1.5) => [{ t: 2, move: 'sweep', dur }];
const pre = (fn) => (ts) => (ts < 1.6 ? 8 : fn(ts)); // arms hang before raising

describe('sweep: phase-based judge (upper arms only)', () => {
  it('HIGH → T → LOW on time = perfect, emits monotonic progress and phases, resolves at LOW', () => {
    const r = simulate(createJudge(), note(), (ts) => bodyFrame(ts, pre(arc(2, 1.5))(ts)), 0, 4.5, { keepProgress: true });
    const prog = r.filter((j) => j.result === null);
    const fin = r.filter((j) => j.result !== null);
    expect(fin).toHaveLength(1);
    expect(fin[0].result).toBe('perfect');
    expect(Math.abs(fin[0].off)).toBeLessThan(0.1);
    expect(fin[0].accuracy).toBeGreaterThan(0.9);
    expect(fin[0].at).toBeLessThan(2 + 1.5 + 0.05); // LOW (≤ 34°) reached at ≈ 85 % → resolves early
    for (let i = 1; i < prog.length; i++) expect(prog[i].progress).toBeGreaterThanOrEqual(prog[i - 1].progress);
    expect(prog.some((j) => j.phase === 'high')).toBe(true);
    expect(prog.some((j) => j.phase === 't')).toBe(true);
  });

  it('works with the wrists invisible / out of frame (palms above the top edge)', () => {
    // cy 0.22, sw 0.2: overhead wrists at y ≈ −0.12 (out of frame) and visibility 0.05
    const fn = (ts) => bodyFrame(ts, pre(arc(2, 1.5))(ts), { wristVis: 0.05, cy: 0.22 });
    const high = fn(2.0);
    expect(high.scores.overhead).toBeGreaterThan(0.8);
    expect(high.elbowVis.left).toBeGreaterThan(0.9);
    const r = simulate(createJudge(), note(), fn, 0, 4.5);
    expect(r[0].result).toBe('perfect');
  });

  it('bent elbows are fine (forearms hanging while the upper arms sweep)', () => {
    const fn = (ts) => bodyFrame(ts, pre(arc(2, 1.5))(ts), { fore: 0 });
    expect(simulate(createJudge(), note(), fn, 0, 4.5)[0].result).toBe('perfect');
  });

  it('T crossing outside ±25 % of mid-duration = good (loose timing)', () => {
    // fast descent: HIGH at t, then down in 0.5 s → T at ≈ t+0.24 vs mid t+0.75
    const fn = (ts) => bodyFrame(ts, pre(arc(2.0, 0.5))(ts));
    const r = simulate(createJudge(), note(), fn, 0, 4.5);
    expect(r[0].result).toBe('good');
    expect(r[0].off).toBeLessThan(-0.375);
  });

  it('LOW late but within the 0.4 s grace = good; beyond grace = miss', () => {
    // descent over 2.1 s: T ≈ t+1.02 (inside ±25 %), LOW (≤ 34°) ≈ t+1.77 → late but within t+1.9
    const late = simulate(createJudge(), note(), (ts) => bodyFrame(ts, pre(arc(2, 2.1))(ts)), 0, 5);
    expect(late[0].result).toBe('good');
    expect(late[0].at).toBeGreaterThan(3.55);
    expect(late[0].at).toBeLessThanOrEqual(3.9 + 1e-9);
    const tooLate = simulate(createJudge(), note(), (ts) => bodyFrame(ts, pre(arc(2, 3))(ts)), 0, 6);
    expect(tooLate[0].result).toBe('miss');
    expect(tooLate[0].reason).toBe('no-low');
  });

  it('never HIGH (only to the T, then down) → miss at t+good', () => {
    const r = simulate(createJudge(), note(), (ts) => bodyFrame(ts, pre(arc(2, 1.5, 100, 10))(ts)), 0, 4.5);
    expect(r[0].result).toBe('miss');
    expect(r[0].reason).toBe('no-high');
    expect(r[0].at).toBeLessThan(2.4);
  });

  it('wrong direction: sweeping down across the body → miss', () => {
    const fn = (ts) => bodyFrame(ts, pre(arc(2, 1.5))(ts), { across: ts >= 2.1 });
    const r = simulate(createJudge(), note(), fn, 0, 4.5);
    expect(r[0].result).toBe('miss');
    expect(r[0].reason).toBe('wrong-direction');
  });

  it('wrong direction: raising instead of lowering (LOW → HIGH) → miss', () => {
    const r = simulate(createJudge(), note(), (ts) => bodyFrame(ts, arc(2, 1.5, 10, 165)(ts)), 0, 4.5);
    expect(r[0].result).toBe('miss');
  });

  it('elbows not visible → frames ignored → miss', () => {
    const fn = (ts) => {
      const f = bodyFrame(ts, pre(arc(2, 1.5))(ts));
      return { ...f, elbowVis: { left: 0.1, right: 0.1 } };
    };
    expect(simulate(createJudge(), note(), fn, 0, 4.5)[0].result).toBe('miss');
  });

  it('straight arms going up / down for a sweep never trigger up / down / split_* / clap', () => {
    for (let d = 0; d <= 180; d += 5) {
      const f = bodyFrame(0, d);
      for (const m of TAP_MOVES) expect(f.scores[m], `${m} @ ${d}°`).toBeLessThan(0.3);
    }
    // and a judge with tap notes during a sweep only misses them
    const notes = [{ t: 2, move: 'sweep', dur: 1.5 }, { t: 2.5, move: 'up' }, { t: 3, move: 'split_lu' }, { t: 3.2, move: 'down' }];
    const r = simulate(createJudge(), notes, (ts) => bodyFrame(ts, pre(arc(2, 1.5))(ts)), 0, 4.5);
    const by = Object.fromEntries(r.map((j) => [j.note.move, j.result]));
    expect(by).toEqual({ sweep: 'perfect', up: 'miss', split_lu: 'miss', down: 'miss' });
  });

  it('sweepPhaseOf + practice helper', () => {
    expect(sweepPhaseOf(bodyFrame(0, 165))).toBe('high');
    expect(sweepPhaseOf(bodyFrame(0, 90))).toBe('t');
    expect(sweepPhaseOf(bodyFrame(0, 10))).toBe('low');
    expect(sweepPhaseOf(bodyFrame(0, 90, { across: true }))).toBe('across');
    const p = createSweepPractice();
    let res = null;
    for (let i = 0; i <= 4 * FPS; i++) {
      const ts = i / FPS;
      const r = p.update(bodyFrame(ts, pre(arc(1.7, 1.5))(ts)), ts);
      if (r.result) res = r.result;
    }
    expect(['perfect', 'good']).toContain(res.result);
  });
});

describe('synthetic sweep follows the new phases', () => {
  it('held sweep key: HIGH at press, T near mid, LOW before the end; bot gets perfect', () => {
    const syn = createSyntheticPose();
    syn.press('sweep', { t: 0, dur: 1.5 });
    expect(sweepPhaseOf(syn.update(0))).toBe('high');
    expect(sweepPhaseOf(syn.update(730))).toBe('t');
    expect(sweepPhaseOf(syn.update(1400))).toBe('low');
    const judge = createJudge();
    const notes = [{ t: 1, move: 'sweep', dur: 2 }];
    const bot = createSyntheticPose();
    const res = [];
    for (let ms = 0; ms <= 4000; ms += 1000 / 60) {
      if (ms >= 1000 && !bot.isHeld('sweep') && !res.length) bot.press('sweep', { t: 1000, dur: 2 });
      for (const j of judge.update(bot.update(ms), ms / 1000, notes)) if (j.result) res.push(j);
    }
    expect(res.map((j) => j.result)).toEqual(['perfect']);
  });
});

// ---------------------------------------------------------------- two players
// A raw MediaPipe pose for a person whose shoulder midpoint is at mirrored x = cx. `id` is stashed in
// landmark 0's z so tests can check identity.
const person = (cx, id, { cy = 0.4, sw = 0.12, jitter = 0, rng = Math.random } = {}) => {
  const raw = bodyLandmarks({ cx: cx + (jitter ? (rng() * 2 - 1) * jitter : 0), cy, sw });
  raw[0].z = id;
  return raw;
};
const ids = (r) => r.poses.map((p) => (p ? p[0].z : null));

describe('two-player identity', () => {
  it('fresh start: sorted by x (P1 = screen-left), regardless of detection order', () => {
    const a = createPlayerAssigner({ maxPlayers: 2 });
    expect(ids(a.assign([person(0.72, 'B'), person(0.3, 'A')], 0))).toEqual(['A', 'B']);
    const b = createPlayerAssigner({ maxPlayers: 2 });
    expect(ids(b.assign([person(0.3, 'A'), person(0.72, 'B')], 0))).toEqual(['A', 'B']);
  });

  it('a single person at start goes to the slot of their side', () => {
    expect(ids(createPlayerAssigner({ maxPlayers: 2 }).assign([person(0.7, 'B')], 0))).toEqual([null, 'B']);
    expect(ids(createPlayerAssigner({ maxPlayers: 2 }).assign([person(0.3, 'A')], 0))).toEqual(['A', null]);
  });

  it('jitter while standing close never swaps, in any detection order', () => {
    const a = createPlayerAssigner({ maxPlayers: 2 });
    const rng = mulberry32(5);
    a.assign([person(0.4, 'A'), person(0.6, 'B')], 0);
    for (let i = 1; i < 300; i++) {
      // same-looking people shoulder to shoulder (0.13 apart, shoulders 0.12 wide), ±0.04 jitter
      // (MediaPipe jitter is ~0.005)
      const A = person(0.435, 'A', { jitter: 0.04, rng }), B = person(0.565, 'B', { jitter: 0.04, rng });
      expect(ids(a.assign(rng() < 0.5 ? [A, B] : [B, A], i * 33))).toEqual(['A', 'B']);
    }
  });

  it('jitter around a crossing (x order flips) never swaps people of different height', () => {
    const a = createPlayerAssigner({ maxPlayers: 2 });
    const rng = mulberry32(6);
    a.assign([person(0.4, 'A', { cy: 0.37 }), person(0.6, 'B', { cy: 0.43 })], 0);
    let flips = 0;
    for (let i = 1; i < 300; i++) {
      const A = person(0.49, 'A', { cy: 0.37, jitter: 0.04, rng }), B = person(0.51, 'B', { cy: 0.43, jitter: 0.04, rng });
      if (1 - (A[11].x + A[12].x) / 2 > 1 - (B[11].x + B[12].x) / 2) flips++;
      expect(ids(a.assign(rng() < 0.5 ? [A, B] : [B, A], i * 33))).toEqual(['A', 'B']);
    }
    expect(flips).toBeGreaterThan(50); // the x order really did flip a lot
  });

  it('people of different height / distance keep identity through a full crossing', () => {
    const a = createPlayerAssigner({ maxPlayers: 2 });
    const rng = mulberry32(9);
    for (let i = 0; i <= 120; i++) {
      const k = i / 120;
      const A = person(0.3 + 0.4 * k, 'A', { cy: 0.35, sw: 0.14, jitter: 0.005, rng });
      const B = person(0.7 - 0.4 * k, 'B', { cy: 0.45, sw: 0.1, jitter: 0.005, rng });
      expect(ids(a.assign(rng() < 0.5 ? [A, B] : [B, A], i * 33))).toEqual(['A', 'B']);
    }
  });

  it('one player leaving and re-entering keeps both slots; reacquire is flagged', () => {
    const a = createPlayerAssigner({ maxPlayers: 2 });
    a.assign([person(0.3, 'A'), person(0.7, 'B')], 0);
    let t = 0;
    // P2 leaves for 3 s; P1 alone keeps slot 0
    for (let i = 0; i < 90; i++) expect(ids(a.assign([person(0.32, 'A')], (t += 33)))).toEqual(['A', null]);
    let r = a.assign([person(0.31, 'A'), person(0.66, 'B')], (t += 33));
    expect(ids(r)).toEqual(['A', 'B']);
    expect(r.reacquired).toEqual([false, true]);
    // P1 leaves; P2 alone (even drifting left of centre) keeps slot 1
    for (let i = 0; i < 60; i++) expect(ids(a.assign([person(0.66 - i * 0.003, 'B')], (t += 33)))).toEqual([null, 'B']);
    r = a.assign([person(0.25, 'A'), person(0.5, 'B')], (t += 33));
    expect(ids(r)).toEqual(['A', 'B']);
    expect(r.reacquired).toEqual([true, false]);
  });

  it('both gone for a long time → next appearance re-sorts by x', () => {
    const a = createPlayerAssigner({ maxPlayers: 2 });
    a.assign([person(0.3, 'A'), person(0.7, 'B')], 0);
    a.assign([], 100);
    expect(ids(a.assign([person(0.3, 'B'), person(0.7, 'A')], 10000))).toEqual(['B', 'A']);
  });

  it('duplicate detections of one person are merged', () => {
    const a = createPlayerAssigner({ maxPlayers: 2 });
    expect(ids(a.assign([person(0.3, 'A'), person(0.305, 'A2')], 0))).toEqual(['A', null]);
  });

  it('maxPlayers 1: P1 = first detection wherever it is; slot 2 always empty', () => {
    const a = createPlayerAssigner({ maxPlayers: 1 });
    expect(ids(a.assign([person(0.8, 'A')], 0))).toEqual(['A', null]);
    expect(ids(a.assign([person(0.8, 'A'), person(0.2, 'B')], 33))).toEqual(['A', null]);
    a.setMaxPlayers(2);
    expect(ids(a.assign([person(0.8, 'A'), person(0.2, 'B')], 66))).toEqual(['B', 'A']);
  });
});

// ---------------------------------------------------------------- tracker with 1 vs 2 poses (mocked MediaPipe)
const ctl = vi.hoisted(() => ({ numPoses: [], setOptions: [], poses: [] }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: {
    createFromOptions: async (_fs, opts) => {
      ctl.numPoses.push(opts.numPoses);
      return {
        close() {},
        setOptions: async (o) => { ctl.setOptions.push(o); },
        detectForVideo: () => ({ landmarks: ctl.poses }),
      };
    },
  },
}));
const { createPoseTracker } = await import('../../src/pose/tracker.js');

const fakeVideo = () => ({
  readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0,
  requestVideoFrameCallback: () => 1, cancelVideoFrameCallback() {},
});

describe('tracker: maxPlayers', () => {
  it('numPoses follows maxPlayers; updateAll returns per-player frames with player/source', async () => {
    ctl.numPoses = []; ctl.setOptions = [];
    const video = fakeVideo();
    const t = await createPoseTracker({ video, maxPlayers: 2 });
    expect(ctl.numPoses).toEqual([2]);
    ctl.poses = [person(0.72, 'B'), person(0.3, 'A')];
    video.currentTime = 1;
    const [p1, p2] = t.updateAll(1000);
    expect(p1.player).toBe(0); expect(p1.source).toBe('camera:0');
    expect(p2.player).toBe(1); expect(p2.source).toBe('camera:1');
    expect(p1.arms.left.shoulder[0]).toBeLessThan(0.5); // P1 is the screen-left person
    expect(p2.arms.left.shoulder[0]).toBeGreaterThan(0.5);
    expect(t.update(1000)).toBe(p1); // update() = P1, no re-detection on the same video frame
    // only P2 visible → P1 untracked frame, P2 tracked
    ctl.poses = [person(0.7, 'B')];
    video.currentTime = 2;
    const [q1, q2] = t.updateAll(2000);
    expect(q1.tracked).toBe(false);
    expect(q2.tracked).toBe(true);

    await t.setMaxPlayers(1);
    expect(ctl.setOptions).toEqual([{ numPoses: 1 }]);
    ctl.poses = [person(0.7, 'B')];
    video.currentTime = 3;
    const [r1, r2] = t.updateAll(3000);
    expect(r1.tracked).toBe(true); // solo: P1 wherever they stand
    expect(r2).toBeNull();
    t.close();
  });

  it('maxPlayers defaults to 1 (backward compatible)', async () => {
    ctl.numPoses = [];
    const t = await createPoseTracker({ video: fakeVideo() });
    expect(ctl.numPoses).toEqual([1]);
    expect(t.maxPlayers).toBe(1);
    t.close();
  });
});

// ---------------------------------------------------------------- P2 keyboard
describe('P2 keyboard + synthetic player', () => {
  it('key maps', () => {
    expect(MOVE_KEYS_P2).toEqual({ Digit7: 'up', Digit8: 'down', Digit9: 'clap', Digit0: 'split_lu', Minus: 'split_ld', Equal: 'sweep' });
    expect(PLAYER_KEYS.Digit7).toEqual({ player: 1, move: 'up' });
    expect(PLAYER_KEYS.Equal).toEqual({ player: 1, move: 'sweep' });
    expect(PLAYER_KEYS.Digit1).toEqual({ player: 0, move: 'up' });
    expect(PLAYER_KEYS.Space).toEqual({ player: 0, move: 'clap' });
    for (const code of Object.keys(MOVE_KEYS_P2)) expect(MOVE_KEYS[code]).toBeUndefined();
  });

  it('createSyntheticPose({ player: 1 }) frames carry player 1 / synthetic:1 and judge normally', () => {
    const syn = createSyntheticPose({ player: 1 });
    const judge = createJudge();
    const notes = [{ t: 0.5, move: 'clap' }, { t: 1, move: 'split_ld' }];
    const res = [];
    for (let ms = 0; ms <= 2000; ms += 1000 / 60) {
      const ts = ms / 1000;
      if (ts >= 0.5 && ts < 0.7) syn.press('clap'); else syn.release('clap');
      if (ts >= 1 && ts < 1.2) syn.press('split_ld'); else syn.release('split_ld');
      const f = syn.update(ms);
      expect(f.player).toBe(1);
      expect(f.source).toBe('synthetic:1');
      for (const j of judge.update(f, ts, notes)) if (j.result) res.push(j.result);
    }
    expect(res).toEqual(['perfect', 'perfect']);
  });
});
