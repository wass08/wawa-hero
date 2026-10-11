import { MOVES } from './moves.js';
export const MENU_MOVES = ['split_lu', 'split_ld', 'clap', 'down'];
export const MENU_LABELS = Object.fromEntries(MENU_MOVES.map(id => [id, MOVES[id].label]));
export const menuActionForMove = move => ({ split_lu: 'previous', split_ld: 'next', clap: 'choose', down: 'back', back: 'back' })[move] || null;
export const menuMoveForKey = code => ({ Digit2: 'down', Numpad2: 'down', ArrowUp: 'split_lu', ArrowDown: 'split_ld', Space: 'clap', Digit4: 'split_lu', Numpad4: 'split_lu', Digit5: 'split_ld', Numpad5: 'split_ld', Digit3: 'clap', Numpad3: 'clap' })[code] || null;
// The title selects a mode; a clap starts the chosen mode.
export function titleChoice(move, current = 1) {
  return move === 'split_lu' ? 1 : move === 'split_ld' ? 2 : current;
}
// Camera menu gestures have one GLOBAL latch per player. A different pose is
// not a release: only continuously observed rest unlocks the next action.
export const MENU_TIMING = Object.freeze({ on: .6, off: .3, confirmMs: 120, restMs: 350, cooldownMs: 450, maxGapMs: 120 });
export function createMenuActivation(options = {}) {
  const { on, off, confirmMs, restMs, cooldownMs, maxGapMs } = { ...MENU_TIMING, ...options };
  const seen = new Map();
  let active = null, candidate = null, candidateAt = null, restAt = null;
  let locked = false, lastActionAt = -Infinity, time = 0, previousTime = null, previousSource = null;
  let fresh = false, observed = false, continuous = false, scores = null, processed = 0, duplicates = 0;
  function interrupt() { candidate = candidateAt = restAt = null; observed = false; }
  function consume(move, now = time) {
    if (!MENU_MOVES.includes(move)) return;
    active = move; locked = true; lastActionAt = now; candidate = candidateAt = restAt = null;
  }
  return {
    get active() { return active; },
    get locked() { return locked; },
    get fresh() { return fresh; },
    get observed() { return observed; },
    get continuous() { return continuous; },
    get time() { return time; },
    consume,
    // A gesture begun on gameplay / a text input must not become a menu action
    // just because the screen changes while the player still holds it.
    suspend() { if (candidate) { active = candidate; locked = true; } interrupt(); },
    debug() {
      return { state: locked ? 'locked' : candidate ? 'confirming' : 'armed', active, candidate,
        restMs: restAt === null ? 0 : Math.max(0, time - restAt),
        confirmMs: candidateAt === null ? 0 : Math.max(0, time - candidateAt),
        cooldownMs: Math.max(0, cooldownMs - (time - lastActionAt)), observed, processed, duplicates, scores };
    },
    update(frame) {
      fresh = false;
      if (!frame || !Number.isFinite(frame.t)) { interrupt(); return null; }
      const source = frame.source || `camera:${frame.player || 0}`;
      const t = frame.t;
      // MediaPipe returns lastFrames between video captures. Replaying one of
      // those frames must never advance activation or rest timers.
      if (seen.has(source) && t <= seen.get(source)) { duplicates++; return null; }
      seen.set(source, t); fresh = true; processed++; time = t; scores = frame.scores;
      continuous = observed && source === previousSource && previousTime !== null && t - previousTime <= maxGapMs;
      if (source !== previousSource || previousTime !== null && t - previousTime > maxGapMs) interrupt();
      previousSource = source; previousTime = t;
      observed = !!scores && (!!frame.tracked && frame.upperBody !== false || !!frame.synthetic || source.startsWith('synthetic:'));
      if (!observed) { interrupt(); return null; }
      let resting = true, next = null, best = on;
      // Stable ties favour the candidate; only the MENU moves participate.
      if (candidate && (scores?.[candidate] || 0) >= on) { next = candidate; best = scores[candidate]; }
      for (const move of MENU_MOVES) {
        const value = scores?.[move] || 0;
        if (value >= off) resting = false;
        if (value >= on && (next === null || value > best)) { next = move; best = value; }
      }
      if (locked) {
        if (!resting) restAt = null;
        else {
          restAt ??= t;
          if (t - restAt >= restMs) { locked = false; active = null; restAt = null; }
        }
        return null;
      }
      if (!next) { candidate = candidateAt = null; return null; }
      if (next !== candidate) { candidate = next; candidateAt = t; }
      if (t - candidateAt < confirmMs || t - lastActionAt < cooldownMs) return null;
      consume(next, t);
      return next;
    },
  };
}
