import {GAME_FONT} from '../typography.js';
// Shared engine for the gameplay HUD directions: voxel stage, mirrored avatar,
// stage-only port; the app owns song time, input, judging and HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { P, css, col } from './palette.js';
import { MOVES } from '../moves.js';
import { AVATAR_LOOKS } from './avatar-looks.js';
import { createWallLayer } from './wall-layer.js';
export const POSES = {
  idle:     { u: [0.13, -1, 0.05],     f: [0.06, -0.9, 0.45] },
  up:       { u: [1, 0.03, 0.06],      f: [0.02, 1, 0.14] },
  down:     { u: [1, 0.03, 0.06],      f: [0.02, -1, 0.14] },
  overhead: { u: [0.28, 1, 0], f: [0.28, 1, 0] },
  low: { u: [0.18, -1, 0], f: [0.08, -1, 0] },
  split_lu: { sides: ['down', 'up'] },
  split_ld: { sides: ['up', 'down'] },
  clapOpen: { u: [0.4, -0.55, 0.75],   f: [0.45, 0.2, 0.88] },
  clap:     { u: [0.12, -0.72, 0.68],  f: [-0.95, 0.15, 0.28] },
};

function rng(seed) {
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function createStage(opts) {
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
  let showCamera = false;
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
  let wallMode = o.wall, menuCamera = false;
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

  const originalAvatar = { ...o.avatar };
  let avatarAside = false, playerCount = 1;
  /* avatar */
  const av = buildAvatar();
  av.group.scale.setScalar(o.avatar.scale);
  av.group.position.set(o.avatar.x, 0, o.avatar.z);
  scene.add(av.group);
  const padMat = glow(P.up, 1.3), padColor = col(P.up);
  const pad = new THREE.Group(); pad.position.set(o.avatar.x, 0.03, o.avatar.z); scene.add(pad);
  const ps = 0.95 * o.avatar.scale;
  for (const s of [-1, 1]) { box(2 * ps, 0.05, 0.08, padMat, 0, 0, s * ps, pad); box(0.08, 0.05, 2 * ps, padMat, s * ps, 0, 0, pad); }

  function buildAvatar(look=AVATAR_LOOKS[0],accent=P.up) {
    const g = new THREE.Group();
    const fabric = c => std(c, { emissive: col(c), emissiveIntensity: look.fill });
    const skin = fabric(look.skin), shirt = fabric(look.shirt), pants = fabric(look.pants);
    const shoe = fabric(look.shoes), hair = fabric(look.hair), ink = std([0.15, 0.03, 285]);
    for (const s of [-1, 1]) { box(0.34, 0.86, 0.36, pants, s * 0.2, 0.55, 0, g); box(0.38, 0.14, 0.5, shoe, s * 0.2, 0.07, 0.05, g); }
    box(0.9, 0.86, 0.48, shirt, 0, 1.4, 0, g);
    box(0.26, 0.26, 0.02, glow(accent, 1.1), 0.0, 1.5, 0.25, g);
    const head = new THREE.Group(); head.position.set(0, 1.84, 0); g.add(head);
    box(0.66, 0.66, 0.62, skin, 0, 0.35, 0, head);
    box(0.7, 0.2, 0.66, hair, 0, 0.72, 0, head);
    box(0.7, 0.48, 0.14, hair, 0, 0.5, -0.27, head);
    if (look.hairShape === 'bun') {
      box(0.40, 0.32, 0.40, hair, 0, 0.96, -0.1, head);
      box(0.28, 0.10, 0.28, hair, 0, 1.17, -0.1, head);
    } else {
      box(0.28, 0.12, 0.26, hair, -0.17, 0.84, 0.16, head);
    }
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
  const av2 = buildAvatar(AVATAR_LOOKS[1],P.clap); av2.group.visible = false; scene.add(av2.group);
  const pad2 = pad.clone(); pad2.visible = false; scene.add(pad2);
  const padMat2 = glow(P.clap, 1.3), padColor2 = col(P.clap);
  pad2.children.forEach(mesh => { mesh.material = padMat2; });
  const performers = [av,av2].map((avatar,i)=>({av:avatar,pad:i?pad2:pad,material:i?padMat2:padMat,color:i?padColor2:padColor,pose:'idle',until:0,arms:null,sweepQ:null}));
  const upperDir = new THREE.Vector3(), foreDir = new THREE.Vector3();
  const liveShoulder = new THREE.Quaternion(), liveElbow = new THREE.Quaternion(), invShoulder = new THREE.Quaternion();
  const DOWNV = new THREE.Vector3(0, -1, 0);
  const poseQ = {};
  for (const [name, p] of Object.entries(POSES)) poseQ[name] = [1, -1].map(s => {
    const armPose = p.sides ? POSES[p.sides[s === 1 ? 0 : 1]] : p;
    const u = new THREE.Vector3(armPose.u[0] * s, armPose.u[1], armPose.u[2]).normalize();
    const f = new THREE.Vector3(armPose.f[0] * s, armPose.f[1], armPose.f[2]).normalize();
    const qs = new THREE.Quaternion().setFromUnitVectors(DOWNV, u);
    const fl = f.clone().applyQuaternion(qs.clone().invert());
    return { qs, qe: new THREE.Quaternion().setFromUnitVectors(DOWNV, fl) };
  });
  poseQ.sweep = poseQ.overhead.map(p => ({ qs: p.qs.clone(), qe: p.qe.clone() }));
  av.arms.forEach((a, i) => { a.shoulder.quaternion.copy(poseQ.idle[i].qs); a.elbow.quaternion.copy(poseQ.idle[i].qe); });
  performers.forEach(p => { p.sweepQ = poseQ.overhead.map(q => ({qs:q.qs.clone(),qe:q.qe.clone()})); });
  const setPose = (name, hold, player=0) => { const p=performers[player]; p.pose=poseQ[name]?name:'idle';p.until=clock+hold; };

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

  const st = { songTime: 0, beat: 0, beatPhase: 0, hype: 0.55 };
  let clock = 0, liveArms = null, simulationPaused = false;
  const strike = (m, player=0) => setPose(m === 'sweep' ? 'overhead' : m, m === 'clap' ? 0.24 : 0.55, player);

  /* ─── wall painters ─── */
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
  /* ─── jumbotron: the LED wall plays the player's webcam as a shaded LED feed.
     Falls back to a close-up "avatar cam" when the camera is off or blocked. ─── */
  function makeJumbotron() {
    const rt = new THREE.WebGLRenderTarget(lite ? 384 : 640, lite ? 216 : 360);
    const avCam = new THREE.PerspectiveCamera(26, 16 / 9, 0.1, 80);
    const video = o.video;
    const vtex = new THREE.VideoTexture(video);
    const flash = new THREE.Color(0, 0, 0);
    const uniforms = {
      menuLayer:{value:wallTex},menuMix:{value:0},
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
        uniform sampler2D feed, menuLayer;
        uniform float menuMix;
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
            vec3 sampleColor=texture2D(feed,s).rgb;
            if(menuMix>.5){vec2 blur=vec2(.012,.012);sampleColor=(sampleColor*2.0+texture2D(feed,s+blur).rgb+texture2D(feed,s-blur).rgb+texture2D(feed,s+vec2(blur.x,-blur.y)).rgb+texture2D(feed,s+vec2(-blur.x,blur.y)).rgb)/6.0;}
            float l = pow(dot(sampleColor, vec3(0.299, 0.587, 0.114)), gammaIn);
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
          c*=0.82+pulse*0.18;
          if(menuMix>.5){c=mix(c,r1*dot(c,vec3(.299,.587,.114))*2.0,.2)*.32;vec4 ink=texture2D(menuLayer,vUv);c=mix(c,ink.rgb,ink.a);}
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const api = {
      material, status: 'avatar', tick: false,
      setStatus(s) { api.status = s; o.onCam(s); },
      useVideo(live = true) {
        if (!live) {
          uniforms.feed.value = rt.texture; uniforms.gammaIn.value = 1 / 2.2; uniforms.flip.value = 0;
          uniforms.srcAspect.value = 16 / 9; api.status = 'avatar'; return;
        }
        uniforms.feed.value = vtex; uniforms.gammaIn.value = 1; uniforms.flip.value = 1;
        uniforms.srcAspect.value = (video.videoWidth / video.videoHeight) || 16 / 9;
        api.status = 'live';
      },
      hit(move) { flash.copy(col(MOVES[move].c)); },
      clearHit() {flash.setRGB(0,0,0);},
      update(dt) {
        uniforms.time.value = clock;
        uniforms.pulse.value = Math.max(0, 1 - st.beatPhase * 3);
        flash.multiplyScalar(Math.max(0, 1 - dt * 4));
        if (api.status === 'live' || (lite && (api.tick = !api.tick))) return;
        const s = o.avatar.scale;
        if(playerCount===2) { avCam.position.set(0,2.5,12);avCam.lookAt(0,1.7,0.6);avCam.fov=44; }
        else { avCam.position.set(o.avatar.x + Math.sin(clock * 0.3) * 0.4 * s, 1.75 * s, o.avatar.z + 4.3 * s);avCam.lookAt(o.avatar.x,1.65*s,o.avatar.z);avCam.fov=26; }
        avCam.updateProjectionMatrix();
        // camera-operator shot: no wall feedback, no beams or confetti in front of the subject
        const promptVisible=photoPlane.visible;photoPlane.visible=false;
        wall.visible = confetti.visible = skPlane.visible = false; beams.forEach(b => (b.visible = false));
        renderer.setRenderTarget(rt); renderer.render(scene, avCam); renderer.setRenderTarget(null);
        wall.visible = confetti.visible = true;photoPlane.visible=promptVisible; beams.forEach(b => (b.visible = true));
      },
    };
    return api;
  }

  let skeletonLandmarks = null;
  const skCanvas = document.createElement('canvas'); skCanvas.width = 640; skCanvas.height = 360;
  const skCtx = skCanvas.getContext('2d'), skTex = new THREE.CanvasTexture(skCanvas);
  const skPlane = new THREE.Mesh(new THREE.PlaneGeometry(wb.h * 16 / 9, wb.h), new THREE.MeshBasicMaterial({ map: skTex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  skPlane.position.set(0, wb.y + wb.h / 2, wb.z + 0.03); scene.add(skPlane);
  const skX = new Float32Array(33), skY = new Float32Array(33);
  const connections = [[11,13],[13,15],[12,14],[14,16],[11,12],[11,23],[12,24],[23,24]];
  function drawSkeleton() {
    skPlane.visible = !!skeletonLandmarks && wallMode === 'cam';
    if (!skPlane.visible) return;
    skCtx.clearRect(0,0,640,360);
    const sets=skeletonLandmarks.length===2?skeletonLandmarks:[skeletonLandmarks];
    const aspect=videoAspect(),crop=(16/9)/aspect;
    for(let player=0;player<sets.length;player++) {
      const landmarks=sets[player];if(!landmarks)continue;
      skCtx.fillStyle=css(player?P.clap:P.up,.8);
      for(let i=0;i<33;i++){const p=landmarks[i];if(!p)continue;skX[i]=320+(p.x-.5)*640/Math.min(1,crop);skY[i]=180+(p.y-.5)*360*Math.max(1,crop);}
      for(const [a,b] of connections){const p=landmarks[a],q=landmarks[b];if(!p||!q||p.visibility<.5||q.visibility<.5)continue;
        const x=skX[a],y=skY[a],xx=skX[b],yy=skY[b],steps=Math.ceil(Math.hypot(xx-x,yy-y)/9);
        for(let i=0;i<=steps;i++)skCtx.fillRect(Math.round((x+(xx-x)*i/steps)/4)*4,Math.round((y+(yy-y)*i/steps)/4)*4,4,4);
      }
      for(const i of [11,12,13,14,15,16,23,24]){const p=landmarks[i];if(p?.visibility>.5)skCtx.fillRect(skX[i]-4,skY[i]-4,8,8);}
    }
    skTex.needsUpdate=true;
  }
  function videoAspect() { return (o.video.videoWidth/o.video.videoHeight)||16/9; }

  // Embedded screen overlay. It is separate from the shaded feed capture.
  const photoCanvas=document.createElement('canvas');photoCanvas.width=640;photoCanvas.height=360;
  const photoCtx=photoCanvas.getContext('2d'),photoTex=new THREE.CanvasTexture(photoCanvas);photoTex.colorSpace=THREE.SRGBColorSpace;
  const photoPlane=new THREE.Mesh(new THREE.PlaneGeometry(wb.h*16/9,wb.h),new THREE.MeshBasicMaterial({map:photoTex,transparent:true,depthWrite:false,toneMapped:false}));
  photoPlane.position.set(0,wb.y+wb.h/2,wb.z+.06);photoPlane.visible=false;scene.add(photoPlane);
  let photoCount=null;
  function setPhotoCue(count){
    photoPlane.visible=count!==null&&wallMode==='cam';if(count===photoCount)return;photoCount=count;
    photoCtx.clearRect(0,0,640,360);
    if(count!==null){
      photoCtx.fillStyle='rgba(18,11,40,.82)';photoCtx.fillRect(54,22,532,134);
      photoCtx.textAlign='center';photoCtx.fillStyle='#fff6cb';photoCtx.font='700 44px "Chakra Petch", system-ui, sans-serif';photoCtx.fillText('STRIKE A POSE!',320,76);
      for(let i=0;i<3;i++){photoCtx.fillStyle=i<count?'#fff6cb':'#534563';photoCtx.fillRect(266+i*44,95,20,20);}
      photoCtx.font=`700 25px ${GAME_FONT}`;photoCtx.fillStyle='#fff6cb';photoCtx.fillText(String(count),320,145);
    }
    photoTex.needsUpdate=true;
  }

  const heroRT=new THREE.WebGLRenderTarget(640,360),heroScene=new THREE.Scene(),heroCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,2);
  heroCamera.position.z=1;
  const heroGeo=new THREE.PlaneGeometry(2,2),heroUV=heroGeo.attributes.uv,feedW=(16/9)/(wb.w/wb.h);
  for(let i=0;i<heroUV.count;i++)heroUV.setX(i,.5+(heroUV.getX(i)-.5)*feedW);
  heroScene.add(new THREE.Mesh(heroGeo,jumbo.material));
  const heroPixels=new Uint8Array(640*360*4),heroCanvas=document.createElement('canvas');heroCanvas.width=640;heroCanvas.height=360;
  const heroCtx=heroCanvas.getContext('2d'),heroImage=heroCtx.createImageData(640,360);
  function captureJumbotron() {
    const previous=renderer.getRenderTarget();renderer.setRenderTarget(heroRT);renderer.render(heroScene,heroCamera);
    renderer.readRenderTargetPixels(heroRT,0,0,640,360,heroPixels);renderer.setRenderTarget(previous);
    for(let y=0;y<360;y++)heroImage.data.set(heroPixels.subarray((359-y)*640*4,(360-y)*640*4),y*640*4);
    heroCtx.putImageData(heroImage,0,0);
    return new Promise(resolve=>heroCanvas.toBlob(resolve,'image/webp',.8));
  }

  /* ─── resize ─── */
  function resize() {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight, aspect = w / h;
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = aspect;
    updateFov();
  }
  function updateFov() {
    camera.fov = camera.aspect < 16 / 9 ? 2 * Math.atan(Math.tan(o.camera.fov * Math.PI / 360) * (16 / 9) / camera.aspect) * 180 / Math.PI : o.camera.fov;
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
  const wallLayer=createWallLayer({ctx:wctx,canvas:wallCanvas,texture:wallTex,draw:o.drawWall||drawWallAmbient,state:st,menuMix:jumbo?.material.uniforms.menuMix||{value:0}});
  let last = performance.now(), beatLen = 60 / 120, menuIdle = 0, danceBeat = -1;
  const camGoal = camPos.clone(), camLook = camTarget.clone();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = simulationPaused ? 0 : Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    st.beat = st.songTime / beatLen; st.beatPhase = ((st.beat % 1) + 1) % 1;
    o.onFrame(st, dt, now);
    if (o.menu && !liveArms) {
      const b = Math.floor(clock / beatLen);
      if (b !== danceBeat && b % 2 === 0) { danceBeat = b; setPose(['up', 'down', 'split_lu', 'clap'][(b / 2) % 4 | 0], 0.9); }
    }

    // Each player has independent arms and cue poses; all share the beat.
    const bounce=Math.abs(Math.sin(st.beatPhase*Math.PI));
    for(let player=0;player<playerCount;player++) {
      const p=performers[player],avatar=p.av;
      if(clock>p.until&&p.pose!=='idle')p.pose='idle';
      const kArm=p.snapArms?1:1-Math.exp(-dt*(p.pose==='clap'?32:17));p.snapArms=false;
      avatar.arms.forEach((a,i)=>{
        const arm=p.arms&&(i===0?p.arms.right:p.arms.left);
        if(arm){
          upperDir.set((arm.elbow[0]-arm.shoulder[0])*videoAspect(),arm.shoulder[1]-arm.elbow[1],0).normalize();
          if(arm.wrist)foreDir.set((arm.wrist[0]-arm.elbow[0])*videoAspect(),arm.elbow[1]-arm.wrist[1],0).normalize();else foreDir.copy(upperDir);
          liveShoulder.setFromUnitVectors(DOWNV,upperDir);invShoulder.copy(liveShoulder).invert();foreDir.applyQuaternion(invShoulder);
          liveElbow.setFromUnitVectors(DOWNV,foreDir);a.shoulder.quaternion.slerp(liveShoulder,kArm);a.elbow.quaternion.slerp(liveElbow,kArm);
        }else {const poses=p.pose==='sweep'?p.sweepQ:poseQ[p.pose];a.shoulder.quaternion.slerp(poses[i].qs,kArm);a.elbow.quaternion.slerp(poses[i].qe,kArm);}
      });
      avatar.group.position.y=bounce*.05*avatar.group.scale.x;avatar.group.rotation.y=Math.sin(clock*.9)*.08;
      avatar.head.rotation.x=Math.sin(st.beatPhase*Math.PI*2)*.06;p.material.color.copy(p.color).multiplyScalar(.9+(1-st.beatPhase)*.8);
    }

    // lights + crowd + confetti
    beams.forEach((g, i) => { g.rotation.z = Math.sin(clock * 0.55 + i * 1.1) * 0.5; g.rotation.x = -(0.32 + Math.sin(clock * 0.42 + i * 1.3) * 0.22); });
    const chase = Math.floor(st.beat);
    if (chase !== bulbs.userData.b) { bulbs.userData.b = chase; bulbPts.forEach((_, i) => { const phase = ((i + chase) % 12 + 12) % 12; bulbs.setColorAt(i, phase % 4 === 3 ? bulbCols[3] : bulbCols[phase % 3]); }); bulbs.instanceColor.needsUpdate = true; }
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

    // wall
    if (wallMode === 'cam') jumbo.update(dt);
    wallLayer.update(dt,wallMode);

    const kc = 1 - Math.exp(-dt * 2.2); camPos.lerp(camGoal, kc); camTarget.lerp(camLook, kc);
    camera.position.set(camPos.x + (showCamera ? 0 : Math.sin(clock * 0.35) * 0.18), camPos.y + (showCamera ? 0 : Math.sin(clock * 0.5) * 0.06), camPos.z);
    camera.lookAt(camTarget);
    drawSkeleton();
    composer.render();
  }
  requestAnimationFrame(frame);

  return {
    setPaused(value) { simulationPaused = !!value; },
    resetEffects() { jumbo.clearHit(); },
    state: st, camera, project, captureJumbotron, setPhotoCue,
    get wallDebug() { return {mode:wallMode,menuCamera,mix:jumbo?.material.uniforms.menuMix.value||0,paints:wallLayer.paints,textureVersion:wallTex.version,visible:wall.visible}; },
    strike, hit: m => jumbo.hit(m),
    setSweepProgress(progress,player=0) {
      const angle=Math.PI*(1-progress),p=performers[player];
      for(let i=0;i<2;i++){upperDir.set((i===0?1:-1)*Math.sin(angle),-Math.cos(angle),0);p.sweepQ[i].qs.setFromUnitVectors(DOWNV,upperDir);p.sweepQ[i].qe.identity();}
      setPose('sweep',.12,player);
    },
    setVideo: live => jumbo.useVideo(live),
    setMenuCamera(enabled){menuCamera=!!enabled&&jumbo?.status==='live';wallLayer.setMenuCamera(menuCamera);skPlane.material.opacity=menuCamera?.3:1;},
    setPlayers(count) { playerCount=count===2?2:1;av2.group.visible=pad2.visible=playerCount===2;avatarAside=null; },
    setAvatarLayout(aside,cameraX=0) {
      if(playerCount===2) {
        for(let i=0;i<2;i++){const p=performers[i],x=(i?1:-1)*(aside?6.5:2.4),scale=aside ? 0.88 : 1.3,z=aside?-1.5:.6;
          p.av.group.position.x=p.pad.position.x=x;p.av.group.position.z=p.pad.position.z=z;
          p.av.group.scale.setScalar(scale);p.pad.scale.setScalar(scale/originalAvatar.scale);}
        avatarAside=aside;return;
      }
      const x=aside?(cameraX>2?-5.4:5.4):originalAvatar.x;
      if(aside===avatarAside&&o.avatar.x===x)return;avatarAside=aside;o.avatar.x=x;o.avatar.scale=aside?1:originalAvatar.scale;
      av.group.position.x=pad.position.x=x;av.group.position.z=pad.position.z=originalAvatar.z;
      av.group.scale.setScalar(o.avatar.scale);pad.scale.setScalar(o.avatar.scale/originalAvatar.scale);
    },
    setHype: h => { st.hype = h; },
    setMenu: m => { o.menu = m; },
    setSongTime: t => { st.songTime = t; },
    setAvatarArms(arms,player=0,snap=false) { performers[player].arms=arms;if(snap)performers[player].snapArms=true; if(player===0)liveArms=arms; },
    setSkeleton: landmarks => { skeletonLandmarks = landmarks; },
    setWall(mode) {
      if (mode === 'cam' && !jumbo) return;
      wallMode = mode; wall.material = mode === 'cam' ? jumbo.material : canvasMat;
      if(mode!=='cam'||menuCamera)wallLayer.paint();
    },
    setCamera(p, t, instant) { showCamera = false; crowd?.bodies.material.color.setScalar(1); camGoal.set(...p); camLook.set(...t); if (instant) { camPos.copy(camGoal); camTarget.copy(camLook); } },
    setShot(shot) {
      showCamera = true; camPos.set(...shot.pos); camGoal.copy(camPos); camTarget.set(...shot.look); camLook.copy(camTarget);
      crowd?.bodies.material.color.setScalar(shot.crowdBrightness ?? 1);
      if (o.camera.fov !== shot.fov) { o.camera.fov = shot.fov; updateFov(); }
    },
    setBpm(bpm) { beatLen = 60 / bpm; },
    setFov(fov) { if (o.camera.fov !== fov) { o.camera.fov = fov; updateFov(); } },
  };
}
