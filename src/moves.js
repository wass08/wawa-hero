import { P } from './engine/palette.js';
export { P, css } from './engine/palette.js';
export const MOVES = {
  up:   { id: 'up',   lane: 0, label: 'ARMS UP',   cue: 'Elbows 90°, hands up',   key: '1', alias: '↑',     c: P.up },
  down: { id: 'down', lane: 1, label: 'ARMS DOWN', cue: 'Elbows 90°, hands down · ARMS DOWN also goes back in menus', key: '2', alias: '↓',     c: P.down },
  clap: { id: 'clap', lane: 2, label: 'CLAP',      cue: 'Clap in front of chest', key: '3', alias: 'Space', c: P.clap },
};
MOVES.split_lu = { id: 'split_lu', lane: 3, label: 'LEFT UP', cue: 'Left forearm up, right forearm down', key: '4', c: P.split_lu };
MOVES.split_ld = { id: 'split_ld', lane: 4, label: 'RIGHT UP', cue: 'Right forearm up, left forearm down', key: '5', c: P.split_ld };
MOVES.sweep = { id: 'sweep', lane: 5, label: 'SWEEP', cue: 'SWEEP: arms up high, then down the sides', key: '6', c: P.sweep };
export const MOVE_IDS = Object.keys(MOVES);
export const PHOTO = {id:'photo',label:'PHOTO!',cue:'PHOTO: strike any pose when the camera flashes',c:P.fg};
export const CUES = {...MOVES,photo:PHOTO};
export const token = id => id.replaceAll('_', '-');
export const LANES = MOVE_IDS.map(id => MOVES[id]);
export const ICONS = {
  up: ['#...........#', '#....###....#', '#....###....#', '#.....#.....#', '#############', '.....###.....',
       '.....###.....', '.....###.....', '.....#.#.....', '.....#.#.....', '.....#.#.....'],
  down: ['.....###.....', '.....###.....', '......#......', '#############', '#....###....#', '#....###....#',
         '#....###....#', '#....#.#....#', '.....#.#.....', '.....#.#.....', '.....#.#.....'],
  clap: ['..#..#.#..#..', '...#.....#...', '.....#.#.....', '....##.##....', '...###.###...', '...###.###...',
         '..####.####..', '..####.####..', '...###.###...', '....##.##....', '.....#.#.....'],
  idle: ['.....###.....', '.....###.....', '......#......', '...#######...', '...#.###.#...', '...#.###.#...',
         '...#.###.#...', '.....#.#.....', '.....#.#.....', '.....#.#.....', '.....#.#.....'],
  split_lu: ['#............', '#....###.....', '#....###.....', '#.....#......', '#############', '.....###....#', '.....###....#', '.....###....#', '.....#.#....#', '.....#.#.....', '.....#.#.....'],
  split_ld: ['............#', '.....###....#', '.....###....#', '......#.....#', '#############', '#....###.....', '#....###.....', '#....###.....', '#....#.#.....', '.....#.#.....', '.....#.#.....'],
  sweep: ['..#.......#..', '...#.###.#...', '....#####....', '.....###.....', '..#..###..#..', '.#...###...#.', '#....###....#', '.....###.....', '.....#.#.....', '.....#.#.....', '.....#.#.....'],
  photo: ['.........#...', '.....##.###..', '....####.#...', '.###########.', '.##.......##.', '.##..###..##.', '.##.##.##.##.', '.##.##.##.##.', '.##..###..##.', '.###########.', '.............'],
  flame: ['....#....', '...##....', '...###...', '..####.#.', '.#######.', '.#######.', '..#####..', '...###...'],
  star: ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
};
ICONS.sweep_high=['..#.......#..','...#.###.#...','....#####....','.....###.....','.....###.....','.....###.....','.....###.....','.....###.....','.....#.#.....','.....#.#.....','.....#.#.....'];
ICONS.sweep_t=['.....###.....','.....###.....','......#......','#############','.....###.....','.....###.....','.....###.....','.....###.....','.....#.#.....','.....#.#.....','.....#.#.....'];
ICONS.sweep_low=['.....###.....','.....###.....','......#......','...#######...','...#.###.#...','...#.###.#...','...#.###.#...','...#.#.#.#...','.....#.#.....','.....#.#.....','.....#.#.....'];
export function iconSVG(id, cls = '') {
  if(id==='sweep')return `<span class="sweep-icon ${cls}" aria-hidden="true">${['sweep_high','sweep_t','sweep_low'].map((m,i)=>iconSVG(m,`sweep-frame f${i}`)).join('')}</span>`;
  const rows = ICONS[id]; let r = '';
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') r += `<rect x="${x}" y="${y}" width="1.04" height="1.04"${id==='photo'&&y<3&&x>=8?' fill="var(--down)"':''}/>`; });
  return `<svg class="${cls}" viewBox="0 0 ${rows[0].length} ${rows.length}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
export function drawIcon(ctx, id, cx, cy, size, fill) {
  const rows = ICONS[id], px = size / rows[0].length, ox = cx - size / 2, oy = cy - px * rows.length / 2;
  ctx.fillStyle = fill;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(ox + x * px, oy + y * px, px + 0.6, px + 0.6); });
}
