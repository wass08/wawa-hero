import { describe, expect, it } from 'vitest';
import {
  POSES, bodyLandmarks, classifyLandmarks, mirrorLandmarks, createPoseAnalyzer, argmaxMove, TAP_MOVES,
} from '../../src/pose/index.js';
import { mulberry32 } from '../../src/pose/math.js';

// Camera / body configurations: distance (shoulder width in frame-height units), position, aspect, roll.
const CONFIGS = [
  { sw: 0.11, cx: 0.5, cy: 0.3, aspect: 16 / 9, roll: 0 },   // far, centred, 16:9
  { sw: 0.24, cx: 0.4, cy: 0.42, aspect: 16 / 9, roll: 6 },  // close, off-centre, slight lean
  { sw: 0.15, cx: 0.62, cy: 0.35, aspect: 4 / 3, roll: -6 }, // 4:3 camera
];
const NOISE = 0.003; // normalized units

// Ideal and "sloppy" versions of each move (angles: deg from down, + = outward).
const MOVE_POSES = {
  up: [POSES.up, { L: { u: 102, f: 162 }, R: { u: 78, f: -165 } }],
  down: [POSES.down, { L: { u: 75, f: 16 }, R: { u: 100, f: -14 } }],
  split_lu: [POSES.split_lu, { L: { u: 98, f: 165 }, R: { u: 80, f: 12 } }],
  split_ld: [POSES.split_ld, { L: { u: 80, f: -12 }, R: { u: 100, f: 168 } }],
  clap: [POSES.clap, { L: { u: 25, f: -110 }, R: { u: 20, f: -118 } }],
};
// Clap with hands at face height (elbows raised).
const CLAP_HIGH = { joints: { lE: [-0.85, 0.35], lW: [-0.1, -0.35], rE: [0.85, 0.35], rW: [0.1, -0.35] } };

const NEGATIVES = {
  neutral: { pose: POSES.neutral },
  relaxedBent: { pose: { L: { u: 15, f: 50 }, R: { u: 15, f: 50 } } }, // hands slightly forward/out
  tpose: { pose: POSES.tpose },
  overhead: { pose: POSES.overhead },
  vArms: { pose: POSES.vup },
  crossedX: { joints: { lE: [-0.75, 0.85], lW: [0.25, 0.55], rE: [0.75, 0.85], rW: [-0.25, 0.5] } },
  foldedArms: { joints: { lE: [-0.6, 1.0], lW: [0.5, 0.75], rE: [0.6, 0.95], rW: [-0.5, 0.7] } },
  handsClaspedAtHips: { joints: { lE: [-0.6, 0.9], lW: [-0.05, 1.6], rE: [0.6, 0.9], rW: [0.05, 1.6] } },
  halfRaised: { pose: { L: { u: 55, f: 55 }, R: { u: 55, f: 55 } } },
};

function classify(opts, cfg, seed) {
  const raw = bodyLandmarks({ ...opts, ...cfg, noise: NOISE, rng: mulberry32(seed) });
  return classifyLandmarks(mirrorLandmarks(raw), cfg.aspect);
}

describe('classifier: positives', () => {
  for (const [move, poses] of Object.entries(MOVE_POSES)) {
    poses.forEach((pose, pi) => {
      CONFIGS.forEach((cfg, ci) => {
        it(`${move} #${pi} @ config ${ci}`, () => {
          for (let seed = 1; seed <= 5; seed++) {
            const c = classify({ pose }, cfg, seed * 97 + ci);
            const best = argmaxMove(c.scores);
            expect(best.move).toBe(move);
            expect(c.scores[move]).toBeGreaterThanOrEqual(0.6);
            for (const other of TAP_MOVES) if (other !== move) expect(c.scores[other]).toBeLessThan(0.3);
          }
        });
      });
    });
  }

  it('clap at face height', () => {
    for (const cfg of CONFIGS) {
      const c = classify(CLAP_HIGH, cfg, 7);
      expect(c.scores.clap).toBeGreaterThanOrEqual(0.6);
      expect(argmaxMove(c.scores).move).toBe('clap');
    }
  });
});

describe('classifier: negatives (no false positives)', () => {
  for (const [name, opts] of Object.entries(NEGATIVES)) {
    it(name, () => {
      CONFIGS.forEach((cfg, ci) => {
        for (let seed = 1; seed <= 5; seed++) {
          const c = classify(opts, cfg, seed * 31 + ci);
          for (const m of TAP_MOVES) expect(c.scores[m], `${name} ${m} cfg${ci}`).toBeLessThan(0.3);
        }
      });
    });
  }
});

describe('classifier: sweep endpoints, angles, straightness', () => {
  it('overhead vs up vs neutral', () => {
    for (const cfg of CONFIGS) {
      const oh = classify({ pose: POSES.overhead }, cfg, 3);
      expect(oh.scores.overhead).toBeGreaterThan(0.8);
      expect(oh.armAngle.left).toBeGreaterThan(2.7);
      expect(oh.armAngle.right).toBeGreaterThan(2.7);
      expect(oh.elbowStraight.left).toBeGreaterThan(0.8);
      const up = classify({ pose: POSES.up }, cfg, 3);
      expect(up.scores.overhead).toBeLessThan(0.2); // bent elbows, elbow at shoulder height
      expect(up.elbowStraight.left).toBeLessThan(0.2);
      const n = classify({ pose: POSES.neutral }, cfg, 3);
      expect(n.scores.low).toBeGreaterThan(0.8);
      expect(n.scores.overhead).toBe(0);
      expect(n.armAngle.left).toBeLessThan(0.4);
    }
  });

  it('T-pose arm angle ≈ π/2', () => {
    const c = classify({ pose: POSES.tpose }, CONFIGS[0], 9);
    expect(c.armAngle.left).toBeCloseTo(Math.PI / 2, 0);
    expect(c.armAngle.right).toBeCloseTo(Math.PI / 2, 0);
  });

  it('left/right follow the PLAYER (landmarks 11/13/15 = left) and mirrored output puts left on screen-left', () => {
    // raw MediaPipe: person's left arm appears on image RIGHT (x > 0.5)
    const raw = bodyLandmarks({ pose: POSES.split_lu, cx: 0.5, aspect: 16 / 9 });
    expect(raw[15].x).toBeGreaterThan(0.5);
    expect(raw[15].y).toBeLessThan(raw[11].y); // person's left wrist raised
    const m = mirrorLandmarks(raw);
    expect(m[15].x).toBeLessThan(0.5);
    const c = classifyLandmarks(m, 16 / 9);
    expect(c.scores.split_lu).toBeGreaterThan(0.9);
    expect(c.scores.split_ld).toBe(0);
  });

  it('gates on visibility', () => {
    const raw = bodyLandmarks({ pose: POSES.up });
    raw[16].visibility = 0.1; // right wrist not visible
    const c = classifyLandmarks(mirrorLandmarks(raw), 16 / 9);
    expect(c.scores.up).toBe(0);
    expect(c.upperBody).toBe(false);
    const ok = classifyLandmarks(mirrorLandmarks(bodyLandmarks({ pose: POSES.up })), 16 / 9);
    expect(ok.upperBody).toBe(true);
    expect(ok.fullBody).toBe(true);
  });

  it('out-of-frame hips → fullBody false, upper body still classified', () => {
    const raw = bodyLandmarks({ pose: POSES.down, cy: 0.55, sw: 0.3 }); // hips at y = 1.0 → feet way out
    const c = classifyLandmarks(mirrorLandmarks(raw), 16 / 9);
    expect(c.fullBody).toBe(false);
    expect(c.upperBody).toBe(true);
    expect(c.scores.down).toBeGreaterThan(0.9);
  });
});

describe('analyzer (smoothing + energy)', () => {
  const run = (poseAt, seconds, fps = 30, noise = 0.002) => {
    const a = createPoseAnalyzer();
    const rng = mulberry32(42);
    let f;
    for (let i = 0; i <= seconds * fps; i++) {
      const t = i / fps;
      f = a.process(bodyLandmarks({ pose: poseAt(t), sw: 0.15, noise, rng }), t * 1000, 16 / 9);
    }
    return f;
  };

  it('outputs mirrored landmarks and arms', () => {
    const f = run(() => POSES.split_lu, 0.5);
    expect(f.tracked).toBe(true);
    expect(f.landmarks).toHaveLength(33);
    expect(f.arms.left.wrist[0]).toBeLessThan(0.5);
    expect(f.arms.left.wrist[1]).toBeLessThan(f.arms.left.shoulder[1]);
    expect(f.scores.split_lu).toBeGreaterThan(0.8);
  });

  it('energy ≈ 0 when still', () => {
    expect(run(() => POSES.neutral, 3).energy).toBeLessThan(0.1);
  });

  it('energy ≈ 0.5 for moderate dancing, ≈ 1 for vigorous', () => {
    // alternate up/down every beat at 120 bpm (forearms swing 180°)
    const dance = (period) => (t) => (Math.floor(t / period) % 2 ? POSES.up : POSES.down);
    const blend = (period) => (t) => {
      const ph = (t / period) % 2;
      const k = ph < 1 ? ph : 2 - ph; // triangle 0..1
      const a = POSES.neutral, b = POSES.up;
      const l = (p, q) => ({ u: p.u + (q.u - p.u) * k, f: p.f + (q.f - p.f) * k });
      return { L: l(a.L, b.L), R: l(a.R, b.R) };
    };
    const moderate = run(blend(0.5), 4).energy; // neutral↔up every beat at 120 bpm
    expect(moderate).toBeGreaterThan(0.3);
    expect(moderate).toBeLessThan(0.75);
    const vigorous = run(blend(0.25), 4).energy; // twice as fast
    expect(vigorous).toBeGreaterThan(0.85);
    // forearm-only flips (up↔down each beat) are lighter: only the wrists travel
    const flips = run(dance(0.5), 2).energy;
    expect(flips).toBeGreaterThan(0.15);
    expect(flips).toBeLessThan(moderate);
  });

  it('untracked frames decay energy and report tracked=false', () => {
    const a = createPoseAnalyzer();
    const f = a.process(null, 0, 16 / 9);
    expect(f.tracked).toBe(false);
    expect(f.landmarks).toBeNull();
    expect(f.scores.up).toBe(0);
  });
});
