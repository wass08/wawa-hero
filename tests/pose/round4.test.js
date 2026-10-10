// Round 4: looser splits (+ coincidence lead), forgiving sweep, and a cross-talk matrix proving
// that no move's canonical or loosened variants trigger any other move.
import { describe, expect, it } from 'vitest';
import {
  bodyLandmarks, classifyLandmarks, createJudge, createPoseAnalyzer, emptyScores, mirrorLandmarks, POSE_CONFIG, POSES, TAP_MOVES,
} from '../../src/pose/index.js';
import { mulberry32 } from '../../src/pose/math.js';

const FPS = 30;
const onOf = (m) => POSE_CONFIG.judge.onByMove?.[m] ?? POSE_CONFIG.judge.on;
const NEG = 0.3; // every non-target tap move must stay below this (below every release threshold)

// Body configurations: tall/short players, near/far, roll, 16:9 and 4:3.
const CONFIGS = [
  { sw: 0.11, cx: 0.3, cy: 0.28, aspect: 16 / 9, roll: 0 },   // tall player, far, left side
  { sw: 0.24, cx: 0.55, cy: 0.42, aspect: 16 / 9, roll: 6 },  // close, leaning
  { sw: 0.15, cx: 0.7, cy: 0.5, aspect: 4 / 3, roll: -6 },    // short player (shoulders low in frame)
];
const cls = (opts, cfg, seed) => classifyLandmarks(
  mirrorLandmarks(bodyLandmarks({ ...opts, ...cfg, noise: 0.003, rng: mulberry32(seed) })), cfg.aspect);

// Arm helpers (deg from hanging, + outward; u upper arm, f forearm absolute direction)
const A = (u, f) => ({ u, f });
const pose = (L, R) => ({ pose: { L, R } });

// expected move → variants (canonical first). "Loosened" = what real players do.
const VARIANTS = {
  up: {
    canonical: pose(A(90, 180), A(90, 180)),
    'elbows dropped 25°': pose(A(65, 175), A(65, 175)),
    'forearms leaning out 25°': pose(A(90, 155), A(90, 155)),
    'forearms leaning in 25°': pose(A(90, -155), A(90, -155)),
  },
  down: {
    canonical: pose(A(90, 0), A(90, 0)),
    'elbows dropped 25°': pose(A(65, 0), A(65, 0)),
    'forearms drifting out 30°': pose(A(90, 30), A(90, 30)),
  },
  split_lu: {
    canonical: pose(A(90, 180), A(90, 0)),
    'elbows dropped 28°': pose(A(62, 175), A(62, 5)),
    'up forearm leaning 25°, down forearm drifting out 32°': pose(A(85, 155), A(85, 32)),
    'raised elbow 18° + dropped elbow 25°': pose(A(108, 180), A(65, 0)),
    'everything loose at once': pose(A(66, 158), A(64, 30)),
  },
  split_ld: {
    canonical: pose(A(90, 0), A(90, 180)),
    'elbows dropped 28°': pose(A(62, 5), A(62, 175)),
    'up forearm leaning 25°, down forearm drifting out 32°': pose(A(85, 32), A(85, 155)),
    'everything loose at once': pose(A(64, 30), A(66, 158)),
  },
  clap: {
    canonical: { pose: POSES.clap },
    'hands at face height': { joints: { lE: [-0.85, 0.35], lW: [-0.1, -0.35], rE: [0.85, 0.35], rW: [0.1, -0.35] } },
    'loose clap': pose(A(25, -110), A(20, -118)),
  },
  none: {
    neutral: { pose: POSES.neutral },
    'T-pose': { pose: POSES.tpose },
    'T-pose, wrists slightly up': pose(A(90, 110), A(90, 110)),
    'V arms': { pose: POSES.vup },
    overhead: { pose: POSES.overhead },
    'sweep @165° (straight)': pose(A(165, 165), A(165, 165)),
    'sweep @125° (straight)': pose(A(125, 125), A(125, 125)),
    'sweep @90° (straight)': pose(A(90, 90), A(90, 90)),
    'sweep @45° (straight)': pose(A(45, 45), A(45, 45)),
    'sweep @90°, slightly bent (elbow 160°)': pose(A(90, 110), A(90, 110)),
    'half raised (55°)': pose(A(55, 55), A(55, 55)),
    'relaxed bent': pose(A(15, 50), A(15, 50)),
    'hands on hips (akimbo)': { joints: { lE: [-1.14, 0.64], lW: [-0.4, 1.4], rE: [1.14, 0.64], rW: [0.4, 1.4] } },
    'crossed X in front': { joints: { lE: [-0.75, 0.85], lW: [0.25, 0.55], rE: [0.75, 0.85], rW: [-0.25, 0.5] } },
    'folded arms': { joints: { lE: [-0.6, 1.0], lW: [0.5, 0.75], rE: [0.6, 0.95], rW: [-0.5, 0.7] } },
    'one arm up only (L goal post, R hanging)': pose(A(90, 180), A(10, 6)),
    'one arm down only (L goal post, R hanging)': pose(A(90, 0), A(10, 6)),
    'L up, R T (forearm horizontal)': pose(A(90, 180), A(90, 90)),
    'hands behind head': { joints: { lE: [-1.35, -0.15], lW: [-0.12, -0.75], rE: [1.35, -0.15], rW: [0.12, -0.75] } },
    'hands on head (forearms ~50° in)': { joints: { lE: [-1.3, -0.1], lW: [-0.55, -0.75], rE: [1.3, -0.1], rW: [0.55, -0.75] } },
  },
};

describe('cross-talk matrix (every variant × every tap move, 3 body configs × 3 noise seeds)', () => {
  const summary = [];
  for (const [target, vs] of Object.entries(VARIANTS)) {
    for (const [name, opts] of Object.entries(vs)) {
      it(`${target}: ${name}`, () => {
        let minT = 1, maxOther = 0, maxOtherMove = '';
        CONFIGS.forEach((cfg, ci) => {
          for (let seed = 1; seed <= 3; seed++) {
            const c = cls(opts, cfg, seed * 13 + ci);
            for (const m of TAP_MOVES) {
              if (m === target) {
                expect(c.scores[m], `${target}/${name} cfg${ci} seed${seed}`).toBeGreaterThanOrEqual(onOf(m));
                minT = Math.min(minT, c.scores[m]);
              } else {
                expect(c.scores[m], `${target}/${name}: ${m} cfg${ci} seed${seed}`).toBeLessThan(NEG);
                if (c.scores[m] > maxOther) { maxOther = c.scores[m]; maxOtherMove = m; }
              }
            }
          }
        });
        summary.push({ target, name, minT, maxOther, maxOtherMove });
      });
    }
  }
  it('summary', () => {
    // eslint-disable-next-line no-console
    if (process.env.POSE_MATRIX) for (const r of summary) console.log(`MATRIX ${r.target.padEnd(8)} ${r.name.padEnd(56)} target≥${r.minT.toFixed(2)}  worst-other ${r.maxOther.toFixed(2)} ${r.maxOtherMove}`);
    expect(summary.length).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------- coincidence lead (lagging arm)
describe('splits: lagging arm', () => {
  // live analyzer + judge; LEFT arm reaches position at `tL`, RIGHT at `tR` (s)
  function run(target, tL, tR, noteT = 2) {
    const an = createPoseAnalyzer();
    const judge = createJudge();
    const notes = [{ t: noteT, move: target }];
    const P = POSES[target];
    const res = [];
    for (let i = 0; i <= 3.5 * FPS; i++) {
      const s = i / FPS;
      const p = { L: s >= tL && s < 3 ? P.L : POSES.neutral.L, R: s >= tR && s < 3 ? P.R : POSES.neutral.R };
      const f = an.process(bodyLandmarks({ pose: p, sw: 0.16 }), s * 1000, 16 / 9);
      for (const j of judge.update(f, s, notes)) if (j.result) res.push(j);
    }
    return res[0];
  }
  it('right arm 100 ms late: onset back-dated to the first arm → perfect with off ≈ 0', () => {
    const j = run('split_lu', 2.0, 2.1);
    expect(j.result).toBe('perfect');
    expect(Math.abs(j.off)).toBeLessThan(0.05);
  });
  it('left arm 133 ms late (split_ld) → perfect', () => {
    const j = run('split_ld', 2.133, 2.0);
    expect(j.result).toBe('perfect');
    expect(Math.abs(j.off)).toBeLessThan(0.05);
  });
  it('arms far apart (0.5 s): no back-dating, onset = second arm', () => {
    const j = run('split_lu', 1.6, 2.1);
    expect(j.off).toBeGreaterThan(0.05);
  });
  it('up → down flip with one arm lagging does not create a false split hit', () => {
    const an = createPoseAnalyzer();
    const judge = createJudge();
    const notes = [{ t: 1, move: 'up' }, { t: 1.5, move: 'down' }, { t: 1.4, move: 'split_lu' }, { t: 1.6, move: 'split_ld' }];
    notes.sort((a, b) => a.t - b.t);
    const res = {};
    for (let i = 0; i <= 3 * FPS; i++) {
      const s = i / FPS;
      // forearms rotate from up to down through horizontal over ~150 ms; LEFT lags 100 ms
      const fa = (t0) => { const k = Math.min(1, Math.max(0, (s - t0) / 0.15)); return 180 - 180 * k; };
      const p = s < 0.95 ? POSES.neutral : { L: { u: 90, f: fa(1.5) }, R: { u: 90, f: fa(1.4) } };
      const f = an.process(bodyLandmarks({ pose: p, sw: 0.16 }), s * 1000, 16 / 9);
      for (const j of judge.update(f, s, notes)) if (j.result) res[j.note.move] = j.result;
    }
    expect(res.up).not.toBe('miss');
    expect(res.down).not.toBe('miss');
    expect(res.split_lu).toBe('miss');
    expect(res.split_ld).toBe('miss');
  });
});

// ---------------------------------------------------------------- forgiving sweep
const sweepFrame = (ts, L, R = L, { ev = [1, 1], sv = [1, 1] } = {}) => ({
  t: Math.round(ts * 1e6) / 1e3, source: 'camera:0', tracked: true,
  scores: { ...emptyScores() },
  armAngle: { left: Math.abs(L), right: Math.abs(R) },
  upperArmAngle: { left: L, right: R },
  elbowVis: { left: ev[0], right: ev[1] }, shoulderVis: { left: sv[0], right: sv[1] },
});
const D = Math.PI / 180;
const lin = (t, d, from, to) => (ts) => from + (to - from) * Math.min(1, Math.max(0, (ts - t) / d));
function simulate(fn, { dur = 1.5, t1 = 5, fps = FPS } = {}) {
  const judge = createJudge();
  const notes = [{ t: 2, move: 'sweep', dur }];
  const res = [];
  for (let i = 0; i <= t1 * fps; i++) {
    const ts = i / fps;
    const f = fn(ts);
    for (const j of judge.update(f, ts, notes)) if (j.result) res.push({ ...j, at: ts });
  }
  return res[0];
}

describe('sweep: forgiving rules', () => {
  it('HIGH at only 112° (≥ 1.9 rad) is enough', () => {
    // from 112° a linear descent crosses the T early → good; a natural pace (T at mid) → perfect
    const a = lin(2, 1.5, 112 * D, 10 * D);
    expect(simulate((ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : a(ts))).result).toBe('good');
    const b = (ts) => (ts < 2.6 ? lin(2, 0.6, 112 * D, 100 * D)(ts) : lin(2.6, 0.9, 100 * D, 10 * D)(ts));
    expect(simulate((ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : b(ts))).result).toBe('perfect');
  });

  it('HIGH reached 0.6 s before the cue and held (or briefly) counts', () => {
    // raised at t − 0.6 (0.3 s before the good window), descends from t
    const a = lin(2, 1.5, 165 * D, 10 * D);
    expect(simulate((ts) => sweepFrame(ts, ts < 1.4 ? 0.1 : a(ts))).result).toBe('perfect');
    // held high from long before the cue
    expect(simulate((ts) => sweepFrame(ts, a(ts))).result).toBe('perfect');
  });

  it('LOW at a looser angle (45°)', () => {
    const a = lin(2, 1.5, 165 * D, 45 * D);
    expect(simulate((ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : a(ts))).result).toBe('perfect');
  });

  it('LOW 0.6 s late is still good (grace 0.7 s)', () => {
    const a = lin(2, 2.2, 165 * D, 10 * D); // LOW (≤ 49°) at ≈ t + 1.95 + … → late
    const r = simulate((ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : a(ts)));
    expect(r.result).toBe('good');
    expect(r.at).toBeGreaterThan(3.5);
  });

  it('one arm with low visibility, the other clear → still judged (perfect)', () => {
    const a = lin(2, 1.5, 165 * D, 10 * D);
    const r = simulate((ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : a(ts), -2.9, { ev: [1, 0.1], sv: [1, 0.1] }));
    expect(r.result).toBe('perfect');
  });

  it('fast arms skipping the T frame (10 fps) → T interpolated → perfect', () => {
    const a = lin(2, 1.5, 165 * D, 10 * D);
    expect(simulate((ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : a(ts)), { fps: 10 }).result).toBe('perfect');
  });

  it('T timing only affects perfect vs good: very fast drop and no observed T are good, never miss', () => {
    const fast = lin(2.1, 0.15, 165 * D, 10 * D); // whole descent in 0.15 s right after the cue
    expect(simulate((ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : fast(ts))).result).toBe('good');
    // arms invisible during the whole descent (only HIGH and LOW observed)
    const gap = (ts) => (ts < 1.6 ? sweepFrame(ts, 0.1) : ts < 2.2 ? sweepFrame(ts, 165 * D)
      : ts < 3.2 ? sweepFrame(ts, 90 * D, 90 * D, { ev: [0, 0], sv: [0, 0] }) : sweepFrame(ts, 10 * D));
    expect(simulate(gap).result).toBe('good');
  });

  it('elbows out of frame at the top while rising → inferred HIGH', () => {
    // rises to 100° visible, then elbows leave the frame (shoulders visible) until t+0.3, then descend visible
    const fn = (ts) => {
      if (ts < 1.2) return sweepFrame(ts, 0.1);
      if (ts < 1.5) return sweepFrame(ts, lin(1.2, 0.3, 0.1, 100 * D)(ts));
      if (ts < 2.3) return sweepFrame(ts, 100 * D, 100 * D, { ev: [0.05, 0.05], sv: [1, 1] });
      return sweepFrame(ts, lin(2.3, 1.0, 100 * D, 10 * D)(ts));
    };
    expect(['perfect', 'good']).toContain(simulate(fn).result);
    // …but NOT when the last visible reading was falling / low
    const fn2 = (ts) => (ts < 1.5 ? sweepFrame(ts, lin(1, 0.5, 100 * D, 60 * D)(ts))
      : ts < 2.3 ? sweepFrame(ts, 60 * D, 60 * D, { ev: [0.05, 0.05], sv: [1, 1] }) : sweepFrame(ts, 10 * D));
    expect(simulate(fn2).result).toBe('miss');
  });

  it('miss only for: no HIGH, no LOW, clearly wrong direction', () => {
    expect(simulate((ts) => sweepFrame(ts, lin(2, 1.5, 95 * D, 10 * D)(ts))).reason).toBe('no-high');
    expect(simulate((ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : lin(2, 1.5, 165 * D, 70 * D)(ts))).reason).toBe('no-low');
    // across the body: signed angles go negative (other side) for several frames
    const across = (ts) => sweepFrame(ts, ts < 1.6 ? 0.1 : ts < 2.1 ? 165 * D : -lin(2.1, 1.0, 165 * D, 10 * D)(ts));
    expect(simulate(across).reason).toBe('wrong-direction');
  });

  it('coming down long before the cue does not count; re-raising within the window does', () => {
    const early = (ts) => sweepFrame(ts, ts < 1.4 ? 0.1 : ts < 1.6 ? 165 * D : 0.1); // high 1.4–1.6, low at 1.6
    expect(simulate(early).result).toBe('miss');
    const again = (ts) => sweepFrame(ts, ts < 1.4 ? 0.1 : ts < 1.6 ? 165 * D : ts < 1.9 ? 0.1 : lin(2, 1.5, 165 * D, 10 * D)(ts));
    expect(simulate(again).result).toBe('perfect');
  });
});
