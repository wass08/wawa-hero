// Shared engine for the gameplay HUD directions: voxel stage, mirrored avatar,
// demo chart, autoplay + keyboard judging. Each direction file owns its HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ─── palette — OKLch is the source of truth (brand-spec.md) ─── */
export const P = {
  bg: [0.16, 0.07, 285], stage: [0.24, 0.05, 285], floor: [0.13, 0.05, 285],
  metal: [0.34, 0.03, 280], dark: [0.12, 0.03, 285], fg: [0.97, 0.01, 280],
  up: [0.84, 0.14, 205], down: [0.86, 0.17, 88], clap: [0.70, 0.25, 345],
  perfect: [0.90, 0.20, 135], good: [0.86, 0.09, 250], miss: [0.68, 0.22, 28],
};
export const css = (c, a = 1) => `oklch(${c[0]} ${c[1]} ${c[2]} / ${a})`;
function linear([L, C, h]) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(v => Math.min(1, Math.max(0, v)));
}
export const col = (c, k = 1) => { const [r, g, b] = linear(c); return new THREE.Color(r * k, g * k, b * k); };

/* ─── moves + pixel pictograms (13×11 grids) ─── */
export const MOVES = {
  up:   { id: 'up',   lane: 0, label: 'ARMS UP',   cue: 'Elbows 90°, hands up',   key: '↑',     c: P.up },
  down: { id: 'down', lane: 1, label: 'ARMS DOWN', cue: 'Elbows 90°, hands down', key: '↓',     c: P.down },
  clap: { id: 'clap', lane: 2, label: 'CLAP',      cue: 'Clap in front of chest', key: 'Space', c: P.clap },
};
export const LANES = [MOVES.up, MOVES.down, MOVES.clap];
const ICONS = {
  up: ['#...........#', '#....###....#', '#....###....#', '#.....#.....#', '#############', '.....###.....',
       '.....###.....', '.....###.....', '.....#.#.....', '.....#.#.....', '.....#.#.....'],
  down: ['.....###.....', '.....###.....', '......#......', '#############', '#....###....#', '#....###....#',
         '#....###....#', '#....#.#....#', '.....#.#.....', '.....#.#.....', '.....#.#.....'],
  clap: ['..#..#.#..#..', '...#.....#...', '.....#.#.....', '....##.##....', '...###.###...', '...###.###...',
         '..####.####..', '..####.####..', '...###.###...', '....##.##....', '.....#.#.....'],
  idle: ['.....###.....', '.....###.....', '......#......', '...#######...', '...#.###.#...', '...#.###.#...',
         '...#.###.#...', '.....#.#.....', '.....#.#.....', '.....#.#.....', '.....#.#.....'],
  star: ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
};
export function iconSVG(id, cls = '') {
  const rows = ICONS[id]; let r = '';
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') r += `<rect x="${x}" y="${y}" width="1.04" height="1.04"/>`; });
  return `<svg class="${cls}" viewBox="0 0 ${rows[0].length} ${rows.length}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
export function drawIcon(ctx, id, cx, cy, size, fill) {
  const rows = ICONS[id], px = size / rows[0].length, ox = cx - size / 2, oy = cy - px * rows.length / 2;
  ctx.fillStyle = fill;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(ox + x * px, oy + y * px, px + 0.6, px + 0.6); });
}

/* ─── demo chart: 16 bars of eighths, 116 BPM (placeholder track) ─── */
export const BPM = 116, BEAT = 60 / BPM, LEAD = 2.6;
const BARS = [
  'U...D...', 'U...D...', 'C...C...', 'U...D...',
  'U.U.D.D.', 'C.C.C...', 'U...C...', 'D...C...',
  'U.D.U.D.', 'C.CC....', 'U...U...', 'D...D.C.',
  'U.C.D.C.', 'U.C.D.C.', 'C.C.C.C.', 'U.......',
];
const CODE = { U: 'up', D: 'down', C: 'clap' };
export const CHART = BARS.flatMap((bar, b) => [...bar].map((ch, s) => CODE[ch] && { t: (b * 8 + s) * BEAT / 2, move: CODE[ch], lane: MOVES[CODE[ch]].lane }).filter(Boolean));
export const SONG = { title: 'Demo track', meta: `${BPM} BPM · placeholder chart`, len: BARS.length * 4 * BEAT };
const PERFECT = 0.07, GOOD = 0.15;
const MAX_SCORE = CHART.reduce((acc, _, i) => acc + 100 * Math.min(4, 1 + Math.floor((i + 1) / 8)), 0);

function rng(seed) {
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ─── HUD helpers shared by every direction ─── */
export function fmtDigits(n, pad = 7) {
  const s = String(n).padStart(pad, '0'), lead = s.search(/[1-9]/);
  return [...s].map((d, i) => `<span${lead === -1 || i < lead ? ' class="z"' : ''}>${d}</span>`).join('');
}
export function popJudge(layer, j, x, y) {
  const el = document.createElement('div');
  el.className = `judge ${j.result}`;
  const timing = j.result === 'good' ? (j.off < 0 ? 'EARLY' : 'LATE') : '';
  el.innerHTML = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' }[j.result] + (timing ? `<small>${timing}</small>` : '');
  el.style.left = typeof x === 'number' ? x + 'px' : x;
  el.style.top = typeof y === 'number' ? y + 'px' : y;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 720);
}
export function starsHTML(n) {
  return [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}">${iconSVG('star')}</i>`).join('');
}
export function mountTrack(el) {
  el.innerHTML = `<span class="track-fig">${iconSVG('idle')}</span><span class="track-txt"><b>Full body in frame</b><em></em></span>`;
  const em = el.querySelector('em'); let last = '';
  return mode => {
    if (mode === last) return; last = mode;
    em.textContent = mode === 'auto' ? 'Autoplay demo · press ↑ ↓ Space to play' : 'Keyboard play · Esc returns to demo';
  };
}

/* ─── avatar arm poses as world directions (right arm; left mirrors x) ─── */
const POSES = {
  idle:     { u: [0.13, -1, 0.05],     f: [0.06, -0.9, 0.45] },
  up:       { u: [1, 0.03, 0.06],      f: [0.02, 1, 0.14] },
  down:     { u: [1, 0.03, 0.06],      f: [0.02, -1, 0.14] },
  clapOpen: { u: [0.4, -0.55, 0.75],   f: [0.45, 0.2, 0.88] },
  clap:     { u: [0.12, -0.72, 0.68],  f: [-0.95, 0.15, 0.28] },
};

export function createGame(opts) {
  const o = {
    camera: { pos: [0, 3, 12], target: [0, 2, 0], fov: 50 }, avatar: { x: 0, z: 0, scale: 1 },
    wall: 'ambient', wallBox: { w: 21, h: 10, y: 4.5, z: -6.2 }, highway: null,
    crowd: true, crowdClearX: 0, beams: 1, lookahead: 2, onJudge() {}, onFrame() {}, onCam() {},
    menu: false, onMove() {}, drawWall: null, jumbotron: false, ...opts,
  };
  const lite = new URLSearchParams(location.search).has('lite');
  if (lite) document.documentElement.classList.add('lite');
  const host = o.container;

  const renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1 : 1.75));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = col(P.bg);
  scene.fog = new THREE.Fog(col(P.bg), 26, 56);
  const camera = new THREE.PerspectiveCamera(o.camera.fov, 16 / 9, 0.1, 140);
  const camPos = new THREE.Vector3(...o.camera.pos), camTarget = new THREE.Vector3(...o.camera.target);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), lite ? 0.6 : 0.8, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  scene.add(new THREE.HemisphereLight(col([0.78, 0.08, 290]), col([0.25, 0.08, 300]), 1.15));
  const key = new THREE.DirectionalLight(col([0.97, 0.02, 280]), 1.7); key.position.set(3, 9, 12); scene.add(key);
  const rimL = new THREE.PointLight(col(P.clap), 40, 24, 1.6); rimL.position.set(-7, 6, 2); scene.add(rimL);
  const rimR = new THREE.PointLight(col(P.up), 40, 24, 1.6); rimR.position.set(7, 6, 2); scene.add(rimR);

  const std = (c, extra) => new THREE.MeshStandardMaterial({ color: col(c), roughness: 0.82, metalness: 0.04, ...extra });
  const glow = (c, k = 1.4) => new THREE.MeshBasicMaterial({ color: col(c, k) });
  const geos = new Map();
  const boxGeo = (w, h, d) => { const k = `${w}|${h}|${d}`; if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(w, h, d)); return geos.get(k); };
  const box = (w, h, d, m, x, y, z, parent = scene) => { const mesh = new THREE.Mesh(boxGeo(w, h, d), m); mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

  /* stage */
  box(70, 0.2, 46, std(P.floor), 0, -1.7, 10);
  box(28, 1.6, 10, std(P.stage), 0, -0.8, -1.5);
  const grid = new THREE.GridHelper(28, 28, col([0.42, 0.1, 290]), col([0.34, 0.08, 290]));
  grid.scale.z = 10 / 28; grid.position.set(0, 0.012, -1.5); grid.material.transparent = true; grid.material.opacity = 0.45; scene.add(grid);
  box(28, 0.1, 0.1, glow(P.clap, 1.6), 0, -0.04, 3.52);
  box(28, 0.07, 0.07, glow(P.up, 1.4), 0, -1.2, 3.52);

  /* LED wall — a canvas texture so directions can paint diegetic UI onto it */
  const wb = o.wallBox;
  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = 1600; wallCanvas.height = Math.round(1600 * wb.h / wb.w);
  const wctx = wallCanvas.getContext('2d');
  const wallTex = new THREE.CanvasTexture(wallCanvas);
  wallTex.colorSpace = THREE.SRGBColorSpace; wallTex.anisotropy = 8;
  const jumbo = o.wall === 'cam' || o.jumbotron ? makeJumbotron() : null;
  const canvasMat = new THREE.MeshBasicMaterial({ map: wallTex, fog: false });
  canvasMat.color.setScalar(o.wall === 'highway' ? 0.8 : o.drawWall ? 1 : 0.5);
  let wallMode = o.wall;
  const wallMat = wallMode === 'cam' ? jumbo.material : canvasMat;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(wb.w, wb.h), wallMat);
  wall.position.set(0, wb.y + wb.h / 2, wb.z); scene.add(wall);
  const metal = std(P.metal, { metalness: 0.5, roughness: 0.5 });
  box(wb.w + 0.8, 0.4, 0.4, metal, 0, wb.y - 0.2, wb.z);
  box(wb.w + 0.8, 0.4, 0.4, metal, 0, wb.y + wb.h + 0.2, wb.z);
  for (const s of [-1, 1]) box(0.4, wb.h + 0.8, 0.4, metal, s * (wb.w / 2 + 0.2), wb.y + wb.h / 2, wb.z);
  if (wb.y > 1) box(wb.w, wb.y, 0.3, std(P.dark), 0, wb.y / 2, wb.z - 0.1);

  // frame bulbs (chase on beat)
  const bulbPts = [];
  for (let x = -wb.w / 2; x <= wb.w / 2 + 0.01; x += 0.7) { bulbPts.push([x, wb.y - 0.2]); bulbPts.push([x, wb.y + wb.h + 0.2]); }
  for (let y = wb.y + 0.5; y < wb.y + wb.h; y += 0.7) { bulbPts.push([-wb.w / 2 - 0.2, y]); bulbPts.push([wb.w / 2 + 0.2, y]); }
  const bulbs = new THREE.InstancedMesh(boxGeo(0.16, 0.16, 0.12), new THREE.MeshBasicMaterial(), bulbPts.length);
  const m4 = new THREE.Matrix4();
  bulbPts.forEach(([x, y], i) => { m4.makeTranslation(x, y, wb.z + 0.24); bulbs.setMatrixAt(i, m4); });
  scene.add(bulbs);
  const bulbCols = [col(P.up, 1.7), col(P.clap, 1.7), col(P.down, 1.7), col(P.fg, 0.25)];

  /* truss, speaker towers, EQ panels */
  const tx = wb.w / 2 + 1.3, topY = Math.max(wb.y + wb.h + 1.2, 9);
  for (const s of [-1, 1]) box(0.5, topY + 0.2, 0.5, metal, s * tx, topY / 2, wb.z + 0.7);
  box(2 * tx + 0.5, 0.45, 0.45, metal, 0, topY, wb.z + 0.7);
  const eqCols = 7, eqRows = 18, eqCells = [];
  for (const s of [-1, 1]) {
    const cx = s * (tx + 2.3);
    box(2.8, 7.4, 2, std(P.dark), cx, 3.7, -4.2);
    for (let c = 0; c < eqCols; c++) for (let r = 0; r < eqRows; r++) eqCells.push({ x: cx - 1.02 + c * 0.34, y: 0.6 + r * 0.34, c, r });
  }
  const eq = new THREE.InstancedMesh(boxGeo(0.24, 0.24, 0.08), new THREE.MeshBasicMaterial(), eqCells.length);
  eqCells.forEach((e, i) => { m4.makeTranslation(e.x, e.y, -3.16); eq.setMatrixAt(i, m4); });
  scene.add(eq);
  const eqOn = [col(P.up, 1.5), col(P.down, 1.5), col(P.clap, 1.5)], eqOff = col(P.fg, 0.04);

  /* moving-head beams */
  const beamGeo = new THREE.ConeGeometry(2.1, 17, 28, 1, true); beamGeo.translate(0, -8.5, 0);
  const beamCols = [P.up, P.clap, P.down, P.down, P.clap, P.up];
  const beams = beamCols.map((c, i) => {
    const g = new THREE.Group(); g.position.set(-tx + 1.6 + i * (2 * tx - 3.2) / 5, topY - 0.45, wb.z + 1.1);
    box(0.55, 0.5, 0.6, metal, 0, 0, 0, g);
    box(0.36, 0.06, 0.36, glow(c, 2), 0, -0.28, 0, g);
    const cone = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col(c), transparent: true, opacity: 0.075 * o.beams, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    g.add(cone); scene.add(g);
    return g;
  });

  /* avatar */
  const av = buildAvatar();
  av.group.scale.setScalar(o.avatar.scale);
  av.group.position.set(o.avatar.x, 0, o.avatar.z);
  scene.add(av.group);
  const padMat = glow(P.up, 1.3);
  const pad = new THREE.Group(); pad.position.set(o.avatar.x, 0.03, o.avatar.z); scene.add(pad);
  const ps = 0.95 * o.avatar.scale;
  for (const s of [-1, 1]) { box(2 * ps, 0.05, 0.08, padMat, 0, 0, s * ps, pad); box(0.08, 0.05, 2 * ps, padMat, s * ps, 0, 0, pad); }

  function buildAvatar() {
    const g = new THREE.Group();
    const skin = std([0.58, 0.09, 50]), shirt = std([0.84, 0.02, 280]), pants = std([0.40, 0.09, 262]);
    const shoe = std([0.96, 0.01, 280]), hair = std([0.26, 0.05, 45]), ink = std([0.15, 0.03, 285]);
    for (const s of [-1, 1]) { box(0.34, 0.86, 0.36, pants, s * 0.2, 0.55, 0, g); box(0.38, 0.14, 0.5, shoe, s * 0.2, 0.07, 0.05, g); }
    box(0.9, 0.86, 0.48, shirt, 0, 1.4, 0, g);
    box(0.26, 0.26, 0.02, glow(P.up, 1.1), 0.0, 1.5, 0.25, g);
    const head = new THREE.Group(); head.position.set(0, 1.84, 0); g.add(head);
    box(0.66, 0.66, 0.62, skin, 0, 0.35, 0, head);
    box(0.7, 0.2, 0.66, hair, 0, 0.72, 0, head);
    box(0.7, 0.48, 0.14, hair, 0, 0.5, -0.27, head);
    for (const s of [-1, 1]) { box(0.08, 0.12, 0.02, ink, s * 0.14, 0.4, 0.315, head); box(0.12, 0.26, 0.26, ink, s * 0.38, 0.36, 0, head); }
    box(0.2, 0.05, 0.02, ink, 0, 0.2, 0.315, head);
    box(0.84, 0.08, 0.12, ink, 0, 0.8, 0, head);
    const arms = [1, -1].map(s => {
      const shoulder = new THREE.Group(); shoulder.position.set(s * 0.58, 1.74, 0); g.add(shoulder);
      box(0.3, 0.24, 0.32, shirt, 0, -0.1, 0, shoulder);
      box(0.25, 0.5, 0.27, skin, 0, -0.25, 0, shoulder);
      const elbow = new THREE.Group(); elbow.position.set(0, -0.48, 0); shoulder.add(elbow);
      box(0.24, 0.44, 0.26, skin, 0, -0.22, 0, elbow);
      box(0.28, 0.22, 0.3, skin, 0, -0.52, 0, elbow);
      return { shoulder, elbow };
    });
    return { group: g, head, arms };
  }
  const DOWNV = new THREE.Vector3(0, -1, 0);
  const poseQ = {};
  for (const [name, p] of Object.entries(POSES)) poseQ[name] = [1, -1].map(s => {
    const u = new THREE.Vector3(p.u[0] * s, p.u[1], p.u[2]).normalize();
    const f = new THREE.Vector3(p.f[0] * s, p.f[1], p.f[2]).normalize();
    const qs = new THREE.Quaternion().setFromUnitVectors(DOWNV, u);
    const fl = f.clone().applyQuaternion(qs.clone().invert());
    return { qs, qe: new THREE.Quaternion().setFromUnitVectors(DOWNV, fl) };
  });
  av.arms.forEach((a, i) => { a.shoulder.quaternion.copy(poseQ.idle[i].qs); a.elbow.quaternion.copy(poseQ.idle[i].qe); });
  let pose = 'idle', poseUntil = 0;
  const setPose = (name, hold) => { pose = name; poseUntil = clock + hold; };

  /* crowd */
  let crowd = null;
  if (o.crowd) {
    const r = rng(7), people = [];
    for (let row = 0; row < 7; row++) for (let i = 0; i < 20; i++) {
      const x = -14.5 + i * 1.5 + (r() - 0.5) * 0.7 + (row % 2) * 0.7, z = 4.7 + row * 1.15 + (r() - 0.5) * 0.4;
      if (Math.abs(x) < o.crowdClearX || z > o.camera.pos[2] - 3) continue;
      people.push({ x, z, ph: r(), arms: r() < 0.45 });
    }
    const lam = new THREE.MeshLambertMaterial();
    const bodies = new THREE.InstancedMesh(boxGeo(0.72, 1.3, 0.42), lam, people.length);
    const heads = new THREE.InstancedMesh(boxGeo(0.52, 0.52, 0.52), lam, people.length);
    const armsN = people.filter(p => p.arms).length * 2;
    const arms = new THREE.InstancedMesh(boxGeo(0.17, 0.7, 0.17), lam, Math.max(1, armsN));
    const shirts = [[0.55, 0.15, 25], [0.6, 0.12, 250], [0.68, 0.14, 150], [0.62, 0.18, 340], [0.85, 0.02, 280], [0.5, 0.1, 200], [0.75, 0.15, 85]];
    const hairs = [[0.25, 0.04, 50], [0.35, 0.08, 45], [0.55, 0.12, 60], [0.2, 0.02, 280], [0.58, 0.16, 40], [0.8, 0.12, 90]];
    const skins = [[0.58, 0.09, 50], [0.75, 0.07, 60], [0.45, 0.07, 45]];
    let ai = 0;
    people.forEach((p, i) => {
      bodies.setColorAt(i, col(shirts[Math.floor(r() * shirts.length)]));
      heads.setColorAt(i, col(hairs[Math.floor(r() * hairs.length)]));
      if (p.arms) { const sc = col(skins[Math.floor(r() * skins.length)]); p.ai = ai; arms.setColorAt(ai++, sc); arms.setColorAt(ai++, sc); }
    });
    scene.add(bodies, heads, arms);
    crowd = { people, bodies, heads, arms };
  }

  /* confetti */
  const confN = lite ? 120 : 280, confPos = new Float32Array(confN * 3), confCol = new Float32Array(confN * 3), confV = [];
  const cr = rng(11), confPal = [P.up, P.down, P.clap, P.fg, P.perfect];
  for (let i = 0; i < confN; i++) {
    confPos.set([(cr() - 0.5) * 26, cr() * 14, -5 + cr() * 13], i * 3);
    const c = col(confPal[i % confPal.length], 1.2); confCol.set([c.r, c.g, c.b], i * 3);
    confV.push({ v: 0.8 + cr() * 1.0, ph: cr() * 6.28 });
  }
  const confGeo = new THREE.BufferGeometry();
  confGeo.setAttribute('position', new THREE.BufferAttribute(confPos, 3));
  confGeo.setAttribute('color', new THREE.BufferAttribute(confCol, 3));
  const confetti = new THREE.Points(confGeo, new THREE.PointsMaterial({ size: 0.13, vertexColors: true, sizeAttenuation: true }));
  scene.add(confetti);

  /* optional 3D floor highway (direction C) */
  let hw = null;
  if (o.highway) {
    const { z0, hitZ, laneW = 1.35 } = o.highway, zEnd = hitZ + 1.0, width = laneW * 3, len = zEnd - z0, cz = (z0 + zEnd) / 2;
    const surf = new THREE.Mesh(boxGeo(width + 0.4, 0.08, len), new THREE.MeshStandardMaterial({ color: col([0.13, 0.06, 285]), roughness: 0.35, metalness: 0.25 }));
    surf.position.set(0, 0.06, cz); scene.add(surf);
    LANES.forEach((m, i) => {
      const tint = new THREE.Mesh(new THREE.PlaneGeometry(laneW * 0.96, len), new THREE.MeshBasicMaterial({ color: col(m.c), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
      tint.rotation.x = -Math.PI / 2; tint.position.set((i - 1) * laneW, 0.105, cz); scene.add(tint);
    });
    for (let j = 0; j <= 3; j++) {
      const edge = j === 0 || j === 3;
      box(edge ? 0.1 : 0.05, 0.03, len, edge ? glow(P.clap, 1.6) : glow(P.fg, 0.35), (j - 1.5) * laneW, 0.115, cz);
    }
    box(width + 0.4, 0.04, 0.05, glow(P.fg, 0.8), 0, 0.13, hitZ);
    const padTex = id => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      drawIcon(x, id, 64, 64, 70, css(MOVES[id].c, 0.75));
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const noteTex = id => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      x.fillStyle = css(MOVES[id].c); x.fillRect(0, 0, 128, 128);
      x.fillStyle = css(P.fg, 0.35); x.fillRect(0, 0, 128, 8);
      drawIcon(x, id, 64, 66, 86, css(P.bg));
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const padMats = LANES.map((m, i) => {
      const fm = glow(m.c, 1.2);
      const g = new THREE.Group(); g.position.set((i - 1) * laneW, 0.14, hitZ); scene.add(g);
      const w = laneW * 0.84, d = 0.8;
      for (const s of [-1, 1]) { box(w, 0.05, 0.08, fm, 0, 0, s * d / 2, g); box(0.08, 0.05, d, fm, s * w / 2, 0, 0, g); }
      const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: padTex(m.id), transparent: true, depthWrite: false }));
      icon.rotation.x = -Math.PI / 2; g.add(icon);
      return fm;
    });
    const noteMats = Object.fromEntries(LANES.map(m => {
      const side = new THREE.MeshBasicMaterial({ color: col(m.c, 0.62) });
      const front = new THREE.MeshBasicMaterial({ color: col(m.c, 0.85) });
      const top = new THREE.MeshBasicMaterial({ map: noteTex(m.id) });
      return [m.id, [side, side, top, side, front, side]];
    }));
    const grey = new THREE.MeshBasicMaterial({ color: col([0.42, 0.02, 285]) });
    const notePool = Array.from({ length: 26 }, () => { const n = new THREE.Mesh(boxGeo(laneW * 0.8, 0.3, 0.66), grey); n.visible = false; scene.add(n); return n; });
    const beatPool = Array.from({ length: 6 }, () => { const b = box(width, 0.02, 0.05, glow(P.fg, 0.3), 0, 0.12, 0); b.visible = false; return b; });
    const sparkMats = LANES.map(m => glow(m.c, 1.8));
    const sparks = Array.from({ length: 48 }, () => { const s = box(0.12, 0.12, 0.12, sparkMats[0], 0, 0, 0); s.visible = false; return { mesh: s, life: 0, v: new THREE.Vector3() }; });
    hw = { z0, hitZ, laneW, padMats, noteMats, grey, notePool, beatPool, sparks, sparkMats, sparkI: 0 };
  }
  function spark(lane) {
    if (!hw) return;
    for (let k = 0; k < 7; k++) {
      const s = hw.sparks[hw.sparkI++ % hw.sparks.length];
      s.mesh.material = hw.sparkMats[lane]; s.mesh.visible = true; s.life = 0.55;
      s.mesh.position.set((lane - 1) * hw.laneW + (Math.random() - 0.5) * 0.6, 0.3, hw.hitZ);
      s.v.set((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 2);
    }
  }

  /* ─── game state ─── */
  const st = {
    mode: 'auto', songTime: -LEAD, song: SONG, notes: [], score: 0, combo: 0, maxCombo: 0, mult: 1, hype: 0.55, stars: 0,
    stats: { perfect: 0, good: 0, miss: 0 }, beat: 0, beatPhase: 0, lookahead: o.lookahead, laneFlash: [0, 0, 0], last: null,
  };
  let clock = 0, t0 = 0;
  function reset() {
    const r = rng(42 + Math.floor(clock));
    st.notes = CHART.map(n => {
      const roll = r(), outcome = roll < 0.8 ? 'perfect' : roll < 0.95 ? 'good' : 'miss';
      const off = outcome === 'perfect' ? (r() - 0.5) * 0.08 : outcome === 'good' ? (r() < 0.5 ? -1 : 1) * (0.085 + r() * 0.05) : 0;
      return { ...n, judged: null, off: 0, plan: { outcome, off }, prep: 0 };
    });
    Object.assign(st, { score: 0, combo: 0, maxCombo: 0, mult: 1, hype: 0.55, stars: 0, last: null, stats: { perfect: 0, good: 0, miss: 0 } });
    t0 = clock;
  }
  function judge(n, result, off) {
    n.judged = result; n.off = off;
    if (result === 'miss') { st.combo = 0; st.mult = 1; st.hype = Math.max(0, st.hype - 0.09); }
    else {
      st.combo++; st.maxCombo = Math.max(st.maxCombo, st.combo); st.mult = Math.min(4, 1 + Math.floor(st.combo / 8));
      const pts = (result === 'perfect' ? 100 : 50) * st.mult; st.score += pts; n.pts = pts;
      st.hype = Math.min(1, st.hype + (result === 'perfect' ? 0.035 : 0.018));
      st.laneFlash[n.lane] = 1; spark(n.lane); jumbo?.hit(n.move);
    }
    st.stats[result]++;
    st.stars = st.score >= MAX_SCORE * 0.75 ? 3 : st.score >= MAX_SCORE * 0.5 ? 2 : st.score >= MAX_SCORE * 0.25 ? 1 : 0;
    st.last = { result, off, move: n.move, lane: n.lane, pts: n.pts || 0, at: clock };
    o.onJudge({ ...st.last, combo: st.combo, mult: st.mult, score: st.score });
  }
  const strike = m => setPose(m, m === 'clap' ? 0.24 : 0.5);
  addEventListener('keydown', e => {
    if (e.code === 'Escape' && st.mode === 'manual') { st.mode = 'auto'; reset(); return; }
    const m = e.code === 'ArrowUp' ? 'up' : e.code === 'ArrowDown' ? 'down' : e.code === 'Space' ? 'clap' : null;
    if (o.menu) {   // menus are driven by the same three moves
      if (e.code === 'Escape') return o.onMove('back');
      if (!m || e.repeat) return;
      e.preventDefault(); strike(m); menuIdle = clock; o.onMove(m); return;
    }
    if (!m) return;
    e.preventDefault();
    if (e.repeat) return;
    if (st.mode === 'auto') { st.mode = 'manual'; reset(); strike(m); return; }
    strike(m);
    let best = null, bd = 1;
    for (const n of st.notes) {
      if (n.judged || n.move !== m) continue;
      const d = Math.abs(n.t - st.songTime);
      if (d <= GOOD && d < bd) { best = n; bd = d; }
    }
    if (best) judge(best, bd <= PERFECT ? 'perfect' : 'good', st.songTime - best.t);
  });

  /* ─── wall painters ─── */
  const FONT = '"Pixelify Sans", ui-monospace, monospace';
  const maskC = document.createElement('canvas'); maskC.width = maskC.height = 6;
  { const m = maskC.getContext('2d'); m.fillStyle = css([0.05, 0.02, 285], 0.6); m.fillRect(4, 0, 2, 6); m.fillRect(0, 4, 6, 2); }
  const mask = wctx.createPattern(maskC, 'repeat');
  function eqColumns(ctx, W, H, cols, alphaFor) {
    const cell = W / cols, rows = Math.floor(H / cell), pulse = Math.max(0, 1 - st.beatPhase * 3);
    for (let c = 0; c < cols; c++) {
      const a = alphaFor(c, cols); if (a <= 0) continue;
      const lv = 0.18 + 0.5 * Math.abs(Math.sin(clock * 1.3 + c * 0.55)) * (0.55 + 0.45 * Math.sin(clock * 0.7 + c * 0.21)) + pulse * 0.25;
      const lit = Math.round(lv * rows);
      for (let r = 0; r < rows; r++) {
        const t = r / rows, on = r < lit;
        ctx.fillStyle = on ? css(t < 0.45 ? P.up : t < 0.75 ? P.down : P.clap, 0.9 * a) : css(P.fg, 0.035);
        ctx.fillRect(c * cell + 2, H - (r + 1) * cell + 2, cell - 4, cell - 4);
      }
    }
  }
  function drawWallAmbient(ctx, W, H) {
    ctx.fillStyle = css([0.1, 0.05, 285]); ctx.fillRect(0, 0, W, H);
    eqColumns(ctx, W, H, 48, (c, n) => 0.25 + 0.75 * Math.abs(c - (n - 1) / 2) / (n / 2));
  }
  function drawWallHighway(ctx, W, H) {
    ctx.fillStyle = css([0.12, 0.06, 285]); ctx.fillRect(0, 0, W, H);
    eqColumns(ctx, W, H, 40, (c, n) => (c < 4 || c > n - 5) ? 0.5 : 0);
    const cx = W / 2, yTop = H * 0.04, yHit = H * 0.76, botLane = 250, topLane = 66, look = st.lookahead;
    const kOf = p => p > 1 ? 1 + (p - 1) * 2.5 : (1 / (7 - 6 * p) - 1 / 7) / (6 / 7);
    const yOf = k => yTop + (yHit - yTop) * k, lw = k => topLane + (botLane - topLane) * k, xb = (j, k) => cx + (j - 1.5) * lw(k);
    const kBot = (H * 0.84 - yTop) / (yHit - yTop);
    const quad = (j0, j1) => { ctx.beginPath(); ctx.moveTo(xb(j0, 0), yTop); ctx.lineTo(xb(j1, 0), yTop); ctx.lineTo(xb(j1, kBot), yOf(kBot)); ctx.lineTo(xb(j0, kBot), yOf(kBot)); ctx.closePath(); };
    quad(0, 3); ctx.fillStyle = css([0.07, 0.04, 285], 0.9); ctx.fill();
    LANES.forEach((m, i) => { quad(i, i + 1); ctx.fillStyle = css(m.c, 0.1 + st.laneFlash[i] * 0.22); ctx.fill(); });
    for (let j = 0; j <= 3; j++) {
      const edge = j === 0 || j === 3;
      ctx.strokeStyle = edge ? css(P.clap) : css(P.fg, 0.28); ctx.lineWidth = edge ? 6 : 3;
      ctx.beginPath(); ctx.moveTo(xb(j, 0), yTop); ctx.lineTo(xb(j, kBot), yOf(kBot)); ctx.stroke();
    }
    for (let b = Math.ceil(st.songTime / BEAT); b * BEAT - st.songTime < look; b++) {
      const k = kOf(1 - (b * BEAT - st.songTime) / look);
      ctx.strokeStyle = css(P.fg, (b % 4 === 0 ? 0.4 : 0.18) * k); ctx.lineWidth = b % 4 === 0 ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(xb(0, k), yOf(k)); ctx.lineTo(xb(3, k), yOf(k)); ctx.stroke();
    }
    LANES.forEach((m, i) => {
      const w = botLane * 0.82, x = cx + (i - 1) * botLane, f = st.laneFlash[i];
      ctx.beginPath(); ctx.roundRect(x - w / 2, yHit - 26, w, 52, 8);
      ctx.fillStyle = css(m.c, 0.2 + f * 0.7); ctx.fill();
      ctx.strokeStyle = css(m.c); ctx.lineWidth = 6; ctx.stroke();
      ctx.font = `700 46px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = css(P.fg); ctx.fillText(m.label, x, H * 0.91);
    });
    for (const n of st.notes) {
      const dt = n.t - st.songTime;
      if (dt > look) break;
      if (dt < -0.3 || (n.judged && n.judged !== 'miss')) continue;
      const k = kOf(1 - dt / look), size = 40 + (botLane * 0.6 - 40) * k, x = cx + (n.lane - 1) * lw(k), y = yOf(k);
      const missed = n.judged === 'miss';
      ctx.beginPath(); ctx.roundRect(x - size / 2, y - size / 2, size, size, size * 0.12);
      ctx.fillStyle = missed ? css([0.42, 0.02, 285], 0.6) : css(MOVES[n.move].c); ctx.fill();
      drawIcon(ctx, n.move, x, y, size * 0.7, css(P.bg, missed ? 0.6 : 1));
    }
    // diegetic HUD: combo left, stars + score right, judgement centre
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const lx = W * 0.135, rx = W * 0.865;
    ctx.fillStyle = css(P.fg, 0.8); ctx.font = `700 40px ${FONT}`; ctx.fillText('COMBO', lx, H * 0.2);
    ctx.fillStyle = css(P.fg); ctx.font = `700 150px ${FONT}`; ctx.fillText(st.combo, lx, H * 0.42);
    ctx.font = `700 64px ${FONT}`; ctx.fillStyle = st.mult > 1 ? css(P.down) : css(P.fg, 0.45); ctx.fillText(`×${st.mult}`, lx, H * 0.55);
    for (let i = 0; i < 3; i++) drawIcon(ctx, 'star', rx + (i - 1) * 84, H * 0.15, 72, i < st.stars ? css(P.down) : css(P.fg, 0.16));
    ctx.font = `700 76px ${FONT}`; ctx.fillStyle = css(P.fg); ctx.fillText(st.score.toLocaleString('en-US'), rx, H * 0.34);
    ctx.fillStyle = css(P.fg, 0.8); ctx.font = `700 34px ${FONT}`; ctx.fillText('SCORE', rx, H * 0.41);
    // crowd meter
    const segs = 12, sw = 22, sx = rx - (segs * (sw + 6)) / 2, lit = Math.round(st.hype * segs);
    for (let s = 0; s < segs; s++) { ctx.fillStyle = s < lit ? css(st.hype < 0.3 ? P.miss : st.hype < 0.7 ? P.down : P.perfect) : css(P.fg, 0.12); ctx.fillRect(sx + s * (sw + 6), H * 0.5, sw, 34); }
    ctx.fillStyle = css(P.fg, 0.8); ctx.font = `700 30px ${FONT}`; ctx.fillText('CROWD', rx, H * 0.6);
    const L = st.last;
    if (L && clock - L.at < 0.65) {
      const a = clock - L.at, s = a < 0.08 ? 1.35 - a * 4.4 : 1;
      ctx.save(); ctx.translate(cx, H * 0.5 - a * 40); ctx.scale(s, s); ctx.globalAlpha = a > 0.45 ? 1 - (a - 0.45) / 0.2 : 1;
      ctx.font = `700 104px ${FONT}`; ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = css(P.bg);
      const txt = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' }[L.result];
      ctx.strokeText(txt, 0, 0); ctx.fillStyle = css(P[L.result]); ctx.fillText(txt, 0, 0);
      if (L.result === 'good') { ctx.font = `700 40px ${FONT}`; ctx.lineWidth = 8; const sub = L.off < 0 ? 'EARLY' : 'LATE'; ctx.strokeText(sub, 0, 52); ctx.fillText(sub, 0, 52); }
      ctx.restore();
    }
    ctx.fillStyle = mask; ctx.fillRect(0, 0, W, H);
  }

  /* ─── jumbotron: the LED wall plays the player's webcam as a shaded LED feed.
     Falls back to a close-up "avatar cam" when the camera is off or blocked. ─── */
  function makeJumbotron() {
    const rt = new THREE.WebGLRenderTarget(lite ? 384 : 640, lite ? 216 : 360);
    const avCam = new THREE.PerspectiveCamera(26, 16 / 9, 0.1, 80);
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    const vtex = new THREE.VideoTexture(video);
    const flash = new THREE.Color(0, 0, 0);
    const uniforms = {
      feed: { value: rt.texture }, gammaIn: { value: 1 / 2.2 }, flip: { value: 0 }, srcAspect: { value: 16 / 9 },
      wallAspect: { value: wb.w / wb.h }, time: { value: 0 }, pulse: { value: 0 }, flash: { value: flash },
      r0: { value: col([0.10, 0.05, 285]) }, r1: { value: col([0.28, 0.14, 295]) }, r2: { value: col([0.55, 0.24, 335]) },
      r3: { value: col([0.80, 0.14, 210]) }, r4: { value: col([0.95, 0.04, 250]) },
      cUp: { value: col(P.up) }, cDown: { value: col(P.down) }, cClap: { value: col(P.clap) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms, fog: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D feed;
        uniform float gammaIn, flip, srcAspect, wallAspect, time, pulse;
        uniform vec3 flash, r0, r1, r2, r3, r4, cUp, cDown, cClap;
        vec3 tone(float l) {            // 5-step posterise onto the stage palette
          float i = clamp(floor(l * 5.0), 0.0, 4.0);
          return i < 0.5 ? r0 : i < 1.5 ? r1 : i < 2.5 ? r2 : i < 3.5 ? r3 : r4;
        }
        void main() {
          float feedW = (16.0 / 9.0) / wallAspect, dx = vUv.x - 0.5;
          vec3 c;
          if (abs(dx) < feedW * 0.5) {
            vec2 g = vec2(60.0 * 16.0 / 9.0, 60.0);
            vec2 fuv = vec2((vUv.x - (0.5 - feedW * 0.5)) / feedW, vUv.y);
            vec2 cell = floor(fuv * g), f = fract(fuv * g), s = (cell + 0.5) / g;
            if (flip > 0.5) s.x = 1.0 - s.x;
            float k = (16.0 / 9.0) / srcAspect;
            if (k < 1.0) s.x = 0.5 + (s.x - 0.5) * k; else s.y = 0.5 + (s.y - 0.5) / k;
            float l = pow(dot(texture2D(feed, s).rgb, vec3(0.299, 0.587, 0.114)), gammaIn);
            l = clamp((l - 0.06) * 1.3, 0.0, 1.0);
            c = tone(l) + flash * smoothstep(0.35, 0.9, l) * 0.6;
            float band = 1.0 - smoothstep(0.0, 0.04, abs(fuv.y - fract(1.0 - time * 0.16)));
            c *= (1.0 + band * 0.25) * (0.16 + 0.84 * smoothstep(0.5, 0.3, length(f - 0.5)));
          } else {
            vec2 g = vec2(16.0 * wallAspect, 16.0);
            vec2 cell = floor(vUv * g), f = fract(vUv * g);
            float lv = 0.18 + 0.5 * abs(sin(time * 1.3 + cell.x * 0.55)) * (0.55 + 0.45 * sin(time * 0.7 + cell.x * 0.21)) + pulse * 0.25;
            float t = (cell.y + 0.5) / g.y;
            vec3 on = t < 0.45 ? cUp : t < 0.75 ? cDown : cClap;
            c = (t < lv ? on * 0.42 : r0 * 0.4) * smoothstep(0.62, 0.42, max(abs(f.x - 0.5), abs(f.y - 0.5)));
            if (abs(dx) < feedW * 0.5 + 0.006) c = r3 * 0.7;
          }
          gl_FragColor = vec4(c * (0.82 + pulse * 0.18), 1.0);
        }`,
    });
    const api = {
      material, status: 'avatar', tick: false,
      setStatus(s) { api.status = s; o.onCam(s); },
      async enable() {
        if (api.status === 'live' || api.status === 'requesting') return;
        if (!navigator.mediaDevices?.getUserMedia) return api.setStatus('unavailable');
        api.setStatus('requesting');
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
          video.srcObject = stream; await video.play();
          uniforms.feed.value = vtex; uniforms.gammaIn.value = 1; uniforms.flip.value = 1;
          uniforms.srcAspect.value = (video.videoWidth / video.videoHeight) || 16 / 9;
          api.setStatus('live');
        } catch { api.setStatus('blocked'); }
      },
      hit(move) { flash.copy(col(MOVES[move].c)); },
      update(dt) {
        uniforms.time.value = clock;
        uniforms.pulse.value = Math.max(0, 1 - st.beatPhase * 3);
        flash.multiplyScalar(Math.max(0, 1 - dt * 4));
        if (api.status === 'live' || (lite && (api.tick = !api.tick))) return;
        const s = o.avatar.scale;
        avCam.position.set(o.avatar.x + Math.sin(clock * 0.3) * 0.4 * s, 1.75 * s, o.avatar.z + 4.3 * s);
        avCam.lookAt(o.avatar.x, 1.65 * s, o.avatar.z);
        // camera-operator shot: no wall feedback, no beams or confetti in front of the subject
        wall.visible = confetti.visible = false; beams.forEach(b => (b.visible = false));
        renderer.setRenderTarget(rt); renderer.render(scene, avCam); renderer.setRenderTarget(null);
        wall.visible = confetti.visible = true; beams.forEach(b => (b.visible = true));
      },
    };
    return api;
  }

  /* ─── resize ─── */
  function resize() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight, aspect = w / h;
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = aspect;
    camera.fov = aspect < 16 / 9 ? 2 * Math.atan(Math.tan(o.camera.fov * Math.PI / 360) * (16 / 9) / aspect) * 180 / Math.PI : o.camera.fov;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  const v3 = new THREE.Vector3();
  function project(x, y, z) {
    v3.set(x, y, z).project(camera);
    return { x: (v3.x + 1) / 2 * host.clientWidth, y: (1 - v3.y) / 2 * host.clientHeight };
  }

  /* ─── frame loop ─── */
  const q = new THREE.Quaternion(), e3 = new THREE.Euler(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let last = performance.now(), wallTick = 0, beatLen = BEAT, menuIdle = 0, danceBeat = -1;
  const camGoal = camPos.clone(), camLook = camTarget.clone();
  reset();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    st.songTime = clock - t0 - LEAD;
    st.beat = st.songTime / beatLen; st.beatPhase = ((st.beat % 1) + 1) % 1;
    if (!o.menu && st.songTime > SONG.len + 2.5) reset();
    // menu: when the player is still, the avatar loops a demo of the three moves
    if (o.menu && clock - menuIdle > 2.5) {
      const b = Math.floor(st.beat);
      if (b !== danceBeat && b % 2 === 0) { danceBeat = b; const m = ['up', 'down', 'up', 'clap'][(b / 2) % 4 | 0]; setPose(m, m === 'clap' ? 0.24 : 0.9); }
    }

    // autoplay performs the chart with planned timing errors; manual just expires late notes
    if (!o.menu) for (const n of st.notes) {
      if (n.judged) continue;
      if (n.t - st.songTime > 0.4) break;
      if (st.mode === 'auto') {
        const p = n.plan, hit = n.t + p.off;
        if (p.outcome !== 'miss') {
          if (n.move === 'clap') {
            if (n.prep < 1 && st.songTime >= hit - 0.24) { setPose('clapOpen', 0.4); n.prep = 1; }
            if (n.prep < 2 && st.songTime >= hit - 0.06) { setPose('clap', 0.24); n.prep = 2; }
          } else if (n.prep < 1 && st.songTime >= hit - 0.17) { setPose(n.move, 0.55); n.prep = 1; }
          if (st.songTime >= hit) judge(n, Math.abs(p.off) <= PERFECT ? 'perfect' : 'good', p.off);
        } else if (st.songTime > n.t + GOOD) judge(n, 'miss', 0);
      } else if (st.songTime > n.t + GOOD) judge(n, 'miss', 0);
    }

    // avatar
    if (clock > poseUntil && pose !== 'idle') pose = 'idle';
    const kArm = 1 - Math.exp(-dt * (pose === 'clap' ? 32 : 17));
    av.arms.forEach((a, i) => { a.shoulder.quaternion.slerp(poseQ[pose][i].qs, kArm); a.elbow.quaternion.slerp(poseQ[pose][i].qe, kArm); });
    const bounce = Math.abs(Math.sin(st.beatPhase * Math.PI));
    av.group.position.y = bounce * 0.05 * o.avatar.scale;
    av.group.rotation.y = Math.sin(clock * 0.9) * 0.08;
    av.head.rotation.x = Math.sin(st.beatPhase * Math.PI * 2) * 0.06;
    padMat.color.copy(col(P.up, 0.9 + (1 - st.beatPhase) * 0.8));

    // lights + crowd + confetti
    for (let i = 0; i < 3; i++) st.laneFlash[i] = Math.max(0, st.laneFlash[i] - dt * 4);
    beams.forEach((g, i) => { g.rotation.z = Math.sin(clock * 0.55 + i * 1.1) * 0.5; g.rotation.x = -(0.32 + Math.sin(clock * 0.42 + i * 1.3) * 0.22); });
    const chase = Math.floor(st.beat);
    if (chase !== bulbs.userData.b) { bulbs.userData.b = chase; bulbPts.forEach((_, i) => bulbs.setColorAt(i, (i + chase) % 4 === 3 ? bulbCols[3] : bulbCols[(i + chase) % 3])); bulbs.instanceColor.needsUpdate = true; }
    const pulse = Math.max(0, 1 - st.beatPhase * 3);
    eqCells.forEach((c, i) => {
      const lv = 0.25 + 0.45 * Math.abs(Math.sin(clock * 1.6 + c.c * 0.8 + (c.x > 0 ? 1.7 : 0))) + pulse * 0.3;
      eq.setColorAt(i, c.r < lv * eqRows ? eqOn[c.r < 8 ? 0 : c.r < 13 ? 1 : 2] : eqOff);
    });
    eq.instanceColor.needsUpdate = true;
    if (crowd) {
      const k = 0.5 + st.hype;
      crowd.people.forEach((p, i) => {
        const y0 = -1.6 + Math.abs(Math.sin((st.beat + p.ph) * Math.PI)) * 0.14 * k;
        m4.makeTranslation(p.x, y0 + 0.65, p.z); crowd.bodies.setMatrixAt(i, m4);
        m4.makeTranslation(p.x, y0 + 1.56, p.z); crowd.heads.setMatrixAt(i, m4);
        if (p.arms) [1, -1].forEach((s, j) => {
          const a = -s * (0.25 + 0.2 * Math.sin((st.beat + p.ph) * Math.PI * 2));
          q.setFromEuler(e3.set(0, 0, a));
          pos.set(p.x + s * 0.42 - 0.35 * Math.sin(a), y0 + 1.2 + 0.35 * Math.cos(a), p.z);
          crowd.arms.setMatrixAt(p.ai + j, m4.compose(pos, q, one));
        });
      });
      crowd.bodies.instanceMatrix.needsUpdate = crowd.heads.instanceMatrix.needsUpdate = crowd.arms.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < confN; i++) {
      confPos[i * 3 + 1] -= confV[i].v * dt;
      confPos[i * 3] += Math.sin(clock * 2 + confV[i].ph) * dt * 0.4;
      if (confPos[i * 3 + 1] < -1.5) confPos[i * 3 + 1] = 14;
    }
    confGeo.attributes.position.needsUpdate = true;

    // floor highway
    if (hw) {
      const span = hw.hitZ - hw.z0, look = st.lookahead; let k = 0;
      for (const n of st.notes) {
        const d = n.t - st.songTime;
        if (d > look) break;
        if (d < -0.35 || (n.judged && n.judged !== 'miss')) continue;
        const m = hw.notePool[k++]; if (!m) break;
        m.visible = true; m.material = n.judged === 'miss' ? hw.grey : hw.noteMats[n.move];
        m.position.set((n.lane - 1) * hw.laneW, 0.27, hw.hitZ - (d / look) * span);
        m.scale.setScalar(Math.min(1, 0.4 + (1 - d / look) * 1.8));
      }
      for (; k < hw.notePool.length; k++) hw.notePool[k].visible = false;
      hw.beatPool.forEach((b, i) => {
        const bt = (Math.ceil(st.songTime / BEAT) + i) * BEAT, d = bt - st.songTime;
        b.visible = d < look; b.position.z = hw.hitZ - (d / look) * span;
      });
      hw.padMats.forEach((pm, i) => pm.color.copy(col(LANES[i].c, 1.1 + st.laneFlash[i] * 2.2)));
      hw.sparks.forEach(s => {
        if (s.life <= 0) return;
        s.life -= dt; s.v.y -= 12 * dt; s.mesh.position.addScaledVector(s.v, dt);
        s.mesh.scale.setScalar(Math.max(0.01, s.life * 2)); if (s.life <= 0) s.mesh.visible = false;
      });
    }

    // wall
    wallTick += dt;
    if (wallMode === 'cam') jumbo.update(dt);
    else if (o.wall === 'highway' || wallTick > 1 / 30) {
      wallTick = 0;
      if (o.drawWall) o.drawWall(wctx, wallCanvas.width, wallCanvas.height, st);
      else (o.wall === 'highway' ? drawWallHighway : drawWallAmbient)(wctx, wallCanvas.width, wallCanvas.height);
      wallTex.needsUpdate = true;
    }

    const kc = 1 - Math.exp(-dt * 2.2); camPos.lerp(camGoal, kc); camTarget.lerp(camLook, kc);
    camera.position.set(camPos.x + Math.sin(clock * 0.35) * 0.18, camPos.y + Math.sin(clock * 0.5) * 0.06, camPos.z);
    camera.lookAt(camTarget);
    composer.render();
    o.onFrame(st);
  }
  requestAnimationFrame(frame);

  return {
    state: st, camera, project,
    enableCamera: () => jumbo?.enable(), camStatus: () => jumbo?.status,
    setWall(mode) { if (mode === 'cam' && !jumbo) return; wallMode = mode; wall.material = mode === 'cam' ? jumbo.material : canvasMat; },
    setCamera(p, t, instant) { camGoal.set(...p); camLook.set(...t); if (instant) { camPos.copy(camGoal); camTarget.copy(camLook); } },
    setBpm(bpm) { beatLen = 60 / bpm; },
    projectLane: (i, y = 0.2) => hw ? project((i - 1) * hw.laneW, y, hw.hitZ) : null,
  };
}
