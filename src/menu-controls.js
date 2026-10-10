export const MENU_MOVES = ['split_lu', 'split_ld', 'clap'];
export const MENU_LABELS = { split_lu: 'LEFT UP', split_ld: 'RIGHT UP', clap: 'CLAP' };
export const menuActionForMove = move => ({ split_lu: 'previous', split_ld: 'next', clap: 'choose', back: 'back' })[move] || null;
export const menuMoveForKey = code => ({ ArrowUp: 'split_lu', ArrowDown: 'split_ld', Space: 'clap', Digit4: 'split_lu', Numpad4: 'split_lu', Digit5: 'split_ld', Numpad5: 'split_ld', Digit3: 'clap', Numpad3: 'clap' })[code] || null;
// The title selects a mode; a clap starts the chosen mode.
export function titleChoice(move, current = 1) {
  return move === 'split_lu' ? 1 : move === 'split_ld' ? 2 : current;
}
export function createBackHold(durationMs = 1200) {
  let start = null, fired = false;
  return {
    reset() { start = null; fired = false; },
    update(active, now) {
      if (!active) { start = null; fired = false; return { progress: 0, trigger: false }; }
      start ??= now;
      const progress = Math.min(1, Math.max(0, (now - start) / durationMs));
      const trigger = progress === 1 && !fired;
      if (trigger) fired = true;
      return { progress, trigger };
    },
  };
}
