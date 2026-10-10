import { MENU_MOVES } from '../menu-controls.js';

// Opt-in camera diagnostics. Reuse nodes and update at 10 Hz, independent of
// menu eligibility (including play / text entry), to reveal swallowed gestures.
export function createMenuDebug() {
  const root = document.createElement('aside');
  root.className = 'menu-debug';
  root.setAttribute('aria-label', 'Menu gesture diagnostics');
  const title = document.createElement('strong');
  title.textContent = 'MENU DEBUG · rest to re-arm';
  root.append(title);
  const rows = [0, 1].map(() => {
    const row = document.createElement('pre'); root.append(row); return row;
  });
  document.body.append(root);
  let last = -Infinity;
  return {
    update(players, count, now) {
      if (now - last < 100) return;
      last = now;
      for (let i = 0; i < 2; i++) {
        rows[i].hidden = i >= count;
        if (i >= count) continue;
        const d = players[i].menu.debug();
        rows[i].textContent = `P${i + 1} ${d.state.toUpperCase()} · ${d.observed ? 'tracked' : 'tracking lost'}\n`
          + `rest ${Math.round(d.restMs)}/350 ms · confirm ${Math.round(d.confirmMs)}/120 ms\n`
          + MENU_MOVES.map(move => `${move} ${(d.scores?.[move] || 0).toFixed(2)}`).join(' · ')
          + `\nframes ${d.processed} · duplicates ignored ${d.duplicates}`;
      }
    },
    close() { root.remove(); },
  };
}
