import { describe, expect, it } from 'vitest';
import { createMenuActivation } from '../menu-controls.js';
import { createPoseAnalyzer, bodyLandmarks, POSES } from '../pose/index.js';
import { lerpPose } from '../pose/body.js';

function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
// 30 fps camera stream, bounded +/- .15 score jitter, 1-3 frame losses, and
// transient (50-100 ms) confident competing shapes at each arm transition.
function noisyCamera(seed, { raises = 1, back = false, landmarks = false } = {}) {
  const rng = random(seed), gate = createMenuActivation();
  const analyzer = landmarks ? createPoseAnalyzer() : null;
  const actions = [];
  let t = 0, lost = 0, duplicateFrames = 0;
  const move = back ? 'down' : seed % 2 ? 'split_lu' : 'split_ld';
  function segment(duration, phase, from = POSES.neutral, to = from) {
    const frames = Math.round(duration * 30);
    for (let i = 0; i < frames; i++, t += 1000 / 30) {
      if (!lost && rng() < .035) lost = 1 + Math.floor(rng() * 3);
      const dropout = lost-- > 0 && !(phase === 'rest' && i >= frames - 18); lost = Math.max(0, lost);
      let frame;
      if (analyzer) {
        const pose = lerpPose(from, to, frames > 1 ? i / (frames - 1) : 1);
        const raw = dropout ? null : bodyLandmarks({ pose, noise: .004, roll: (rng() - .5) * 6, rng });
        frame = analyzer.process(raw, t, 16 / 9);
      } else {
        const scores = { split_lu: .08 + .15 * rng(), split_ld: .08 + .15 * rng(), clap: .08 + .15 * rng(), down: .08 + .15 * rng() };
        if (phase === 'hold') {
          // Settle confidently, then drift through the problematic .4-.7 band.
          scores[move] = (i < 45 || i % 90 < 12 ? .85 : .55) + (rng() - .5) * .3;
        } else if (phase === 'transition') {
          scores[i % 3 === 0 ? 'clap' : move === 'split_lu' ? 'split_ld' : 'split_lu'] = .8 + .15 * rng();
        }
        frame = { t, source: 'camera:0', tracked: !dropout, scores: dropout ? {} : scores };
      }
      const action = gate.update(frame);
      if (action) actions.push(action);
      // A 60 Hz renderer will often see the same 30 Hz camera frame twice.
      expect(gate.update(frame)).toBeNull(); duplicateFrames++;
    }
  }
  segment(.7, 'rest');
  for (let i = 0; i < raises; i++) {
    segment(.1, 'transition', POSES.neutral, POSES[move]);
    segment(5, 'hold', POSES[move]);
    segment(.1, 'transition', POSES[move], POSES.neutral);
    // A deliberate >= .5 s observed rest, allowing for occasional losses.
    segment(1.5, 'rest');
  }
  return { actions, move, duplicateFrames };
}

describe('realistic camera menu replay', () => {
  it('100 randomized raise-hold-lower streams yield one action each', () => {
    let total = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const { actions, move } = noisyCamera(seed);
      expect(actions, `score stream seed ${seed}`).toEqual([move]); total += actions.length;
    }
    console.info(`MENU REPLAY score noise: 100/100 runs passed; ${total} actions; 0 repeats`);
  });
  it('100 randomized double raises separated by deliberate rest yield two actions', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { actions, move } = noisyCamera(seed, { raises: 2 });
      expect(actions, `double raise seed ${seed}`).toEqual([move, move]);
    }
    console.info('MENU REPLAY double raise: 100/100 runs passed; 200 actions');
  });
  it('100 noisy ARMS DOWN activations yield Back once', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { actions } = noisyCamera(seed, { back: true });
      expect(actions, `Back seed ${seed}`).toEqual(['down']);
    }
    console.info('MENU REPLAY Back: 100/100 runs passed; 100 ARMS DOWN; 0 repeats');
  });
  it('runs 100 landmark streams through the REAL smoothed pose analyzer', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { actions, move } = noisyCamera(seed, { landmarks: true });
      expect(actions, `analyzer seed ${seed}`).toEqual([move]);
    }
    console.info('MENU REPLAY real analyzer: 100/100 runs passed; 100 actions; 0 repeats');
  });
});
