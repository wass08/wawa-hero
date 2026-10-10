import { createSyntheticPose } from './pose/index.js';
// The driver's arc clock excludes pauses. Frame timestamps still use real performance time
// so camera and keyboard frames share the audio bridge and judge timebase.
export function createGameInput({player=0,ramp=.06}={}) {
  let driver = createSyntheticPose({player,ramp}), pausedAt = null, pausedMs = 0;
  const virtualTime = now => (pausedAt ?? now) - pausedMs;
  return {
    press(move, options) {
      driver.press(move, options?.t === undefined ? options : { ...options, t: virtualTime(options.t) });
    },
    release(move) { driver.release(move); },
    update(now) { const frame = driver.update(virtualTime(now)); frame.t = now; frame.player=player; frame.source=`synthetic:${player}`; return frame; },
    pause(now) { if (pausedAt === null) pausedAt = now; },
    resume(now) { if (pausedAt !== null) { pausedMs += now - pausedAt; pausedAt = null; } },
    reset() { driver = createSyntheticPose({player,ramp}); pausedAt = null; pausedMs = 0; },
  };
}
