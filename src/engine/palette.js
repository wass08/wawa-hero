import * as THREE from 'three';
export const P = {
  bg: [0.16, 0.07, 285], stage: [0.24, 0.05, 285], floor: [0.13, 0.05, 285],
  metal: [0.34, 0.03, 280], dark: [0.12, 0.03, 285], fg: [0.97, 0.01, 280],
  up: [0.84, 0.14, 205], down: [0.86, 0.17, 88], clap: [0.70, 0.25, 345],
  split_lu: [0.80, 0.15, 165], split_ld: [0.78, 0.16, 55], sweep: [0.82, 0.11, 300],
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

