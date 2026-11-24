// Vessels on Chongqing's Two Rivers (长江 Yangtze & 嘉陵江 Jialing):
//   - Kind 0: small craft / patrol boats
//   - Kind 1: river cargo barges
//   - Kind 2: Yangtze river cargo ships / coasters
//   - Kind 3: riverside pier pontoons (趸船)
//   - Kind 4: Iconic Chongqing Two-Rivers Golden Multi-Deck Sightseeing Cruise Ships (两江游轮)!
//             4 ornate tiered decks, Bayu upturned golden-red roofline, glowing warm panoramic saloons,
//             golden LED railing trim, crimson lanterns & illuminated bow crown reflecting across the rivers at night!
//   - Kind 5: Two-Rivers ferries shuttling across Hongyadong–Jiangbeizui and Yangtze crossings
// Each moving vessel trails a procedural foam wake across the river surface.

import * as THREE from 'three';
import { Kit } from './kit.js';
import { kitMaterial, depthMaterial, gbufferMaterial } from '../engine/materials.js';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { fetchJSON } from './data.js';

function walls(K, pts, y0, y1) {
  for (let k = 0; k < pts.length; k++) {
    const A = pts[k], B = pts[(k + 1) % pts.length];
    K.quad([B[0], y0, B[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]]);
  }
}
function deck(K, pts, y) {
  for (let k = 1; k + 1 < pts.length; k++) K.quad([pts[0][0], y, pts[0][1]], [pts[k + 1][0], y, pts[k + 1][1]], [pts[k][0], y, pts[k][1]], [pts[k][0], y, pts[k][1]]);
}
const hullPlan = (bow, sh, stern = 0.03) => [
  [-0.5, -0.5 + stern * 1.4], [-0.5 + stern, -0.5], [bow, -0.5],
  [0.5 - (0.5 - bow) * 0.28, -sh], [0.5, 0], [0.5 - (0.5 - bow) * 0.28, sh],
  [bow, 0.5], [-0.5 + stern, 0.5], [-0.5, 0.5 - stern * 1.4],
];

const WHITE = (K) => K.color(1, 1, 1).material(0.55, 0);
const PAINT = (K) => K.color(0.88, 0.87, 0.84).material(0.48, 0);
const GLASS = (K) => K.color(0.085, 0.075, 0.055).material(0.18, 0, -6.5, 0.9);
const WARM_SALOON = (K) => K.color(0.98, 0.78, 0.42).material(0.16, 0, -8.5, 1.0);
const GOLD_TRIM = (K) => K.color(1.0, 0.76, 0.24).material(0.32, 0.55, -10.5, 1.0);
const RED_LANTERN = (K) => K.color(0.95, 0.16, 0.08).material(0.40, 0, -9.5, 1.0);
const OXIDE = (K) => K.color(0.30, 0.09, 0.065).material(0.7, 0);

function barge() {
  const K = new Kit();
  const P = hullPlan(0.36, 0.3);
  OXIDE(K); walls(K, P, -0.9, 0.3);
  K.color(0.06, 0.06, 0.07).material(0.6, 0); walls(K, P, 0.3, 1.25);
  K.color(0.20, 0.185, 0.17).material(0.85, 0); deck(K, P, 1.25);
  K.color(0.16, 0.15, 0.15).material(0.7, 0);
  walls(K, [[-0.30, -0.40], [0.33, -0.40], [0.33, 0.40], [-0.30, 0.40]], 1.25, 1.8);
  WHITE(K).material(0.9, 0);
  const x0 = -0.295, x1 = 0.325, z = 0.39, r0 = -0.22, r1 = 0.25, yb = 1.8, yr = 2.75;
  K.quad([x0, yb, z], [x1, yb, z], [r1, yr, 0], [r0, yr, 0]); K.quad([x1, yb, -z], [x0, yb, -z], [r0, yr, 0], [r1, yr, 0]);
  K.quad([x1, yb, z], [x1, yb, -z], [r1, yr, 0], [r1, yr, 0]); K.quad([x0, yb, -z], [x0, yb, z], [r0, yr, 0], [r0, yr, 0]);
  PAINT(K); K.box(-0.41, 2.5, 0, 0.115, 2.5, 0.66);
  GLASS(K); K.box(-0.41, 3.05, 0, 0.118, 0.7, 0.60); K.box(-0.41, 3.05, 0, 0.105, 0.7, 0.67);
  K.color(0.30, 0.31, 0.33).material(0.6, 0); K.box(-0.41, 3.82, 0, 0.125, 0.14, 0.72);
  K.color(0.12, 0.12, 0.13).material(0.5, 0.4); K.tube([-0.385, 3.85, 0.18], [-0.385, 5.6, 0.18], 0.004, 0.004, 5);
  return K.geometry();
}

function ship() {
  const K = new Kit();
  const P = hullPlan(0.28, 0.33, 0.04);
  OXIDE(K); walls(K, P, -1.6, 0.7);
  WHITE(K).material(0.5, 0); walls(K, P, 0.7, 4.1);
  K.color(0.24, 0.12, 0.09).material(0.8, 0); deck(K, P, 4.1);
  const F = [[0.33, -0.44], [0.5 - 0.22 * 0.28, -0.33], [0.5, 0], [0.5 - 0.22 * 0.28, 0.33], [0.33, 0.44]];
  WHITE(K).material(0.5, 0); walls(K, F, 4.1, 5.6);
  K.color(0.24, 0.12, 0.09).material(0.8, 0); deck(K, F, 5.6);
  K.color(0.33, 0.36, 0.35).material(0.6, 0.2);
  for (const [a, b] of [[-0.24, -0.08], [-0.05, 0.11], [0.14, 0.30]]) K.box((a + b) / 2, 4.7, 0, b - a, 1.1, 0.74);
  PAINT(K);
  K.box(-0.385, 5.4, 0, 0.17, 2.7, 0.86); K.box(-0.39, 8.1, 0, 0.14, 2.7, 0.74); K.box(-0.40, 10.6, 0, 0.09, 2.4, 0.96);
  GLASS(K);
  K.box(-0.40, 11.0, 0, 0.092, 0.85, 0.90); K.box(-0.39, 8.5, 0, 0.142, 0.7, 0.66); K.box(-0.385, 5.8, 0, 0.172, 0.7, 0.78);
  K.color(0.08, 0.08, 0.09).material(0.5, 0.3); K.box(-0.345, 12.9, 0, 0.035, 2.8, 0.2);
  WHITE(K); K.box(-0.345, 13.5, 0, 0.036, 0.8, 0.205);
  K.color(0.75, 0.75, 0.72).material(0.5, 0.3); K.tube([0.40, 5.6, 0], [0.40, 12.2, 0], 0.003, 0.002, 5); K.tube([-0.40, 11.8, 0], [-0.40, 15.6, 0], 0.003, 0.002, 5);
  K.color(1.0, 0.95, 0.8).material(0.3, 0, -6.5); K.box(0.40, 12.3, 0, 0.004, 0.4, 0.03);
  return K.geometry();
}

function smallCraft() {
  const K = new Kit();
  const P = hullPlan(0.14, 0.32, 0.05);
  OXIDE(K); walls(K, P, -0.5, 0.15);
  WHITE(K).material(0.45, 0); walls(K, P, 0.15, 1.0);
  K.color(0.36, 0.35, 0.33).material(0.8, 0); deck(K, P, 1.0);
  PAINT(K); K.box(-0.08, 2.0, 0, 0.38, 2.0, 0.62);
  GLASS(K); K.box(-0.08, 2.35, 0, 0.385, 0.7, 0.56); K.box(-0.08, 2.35, 0, 0.34, 0.7, 0.63);
  K.color(0.30, 0.31, 0.33).material(0.6, 0); K.box(-0.08, 3.06, 0, 0.40, 0.12, 0.68);
  return K.geometry();
}

function pontoon() {
  const K = new Kit();
  const P = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  K.color(0.10, 0.12, 0.14).material(0.7, 0); walls(K, P, -0.6, 1.2);
  K.color(0.30, 0.31, 0.29).material(0.85, 0); deck(K, P, 1.2);
  PAINT(K); K.box(0, 2.9, 0, 0.60, 3.4, 0.60);
  GLASS(K); K.box(0, 3.1, 0, 0.605, 1.0, 0.52); K.box(0, 3.1, 0, 0.54, 1.0, 0.605);
  WHITE(K).material(0.55, 0.2); K.box(0, 4.72, 0, 0.66, 0.26, 0.66);
  // Warm pier trim strip at night
  GOLD_TRIM(K); K.box(0, 4.54, 0.332, 0.64, 0.14, 0.014); K.box(0, 4.54, -0.332, 0.64, 0.14, 0.014);
  K.color(0.05, 0.05, 0.05).material(0.9, 0);
  for (let k = -2; k <= 2; k++) { K.box(k * 0.2, 0.65, 0.505, 0.03, 0.95, 0.012); K.box(k * 0.2, 0.65, -0.505, 0.03, 0.95, 0.012); }
  return K.geometry();
}

/**
 * Iconic Chongqing Two-Rivers Golden Sightseeing Cruise Ship (两江游轮 — e.g. 朝天皓月 / 交运明珠 / 金碧皇宫):
 * 4 ornate tiered decks, glowing warm panoramic saloons, vivid golden LED deck trims,
 * crimson Bayu decorative pavilion crown & lanterns that blaze on the dark Yangtze & Jialing waters!
 */
function cruiseShip() {
  const K = new Kit();
  const P = hullPlan(0.30, 0.34, 0.06);
  // Hull: dark crimson-oxide below waterline, deep lacquer / white-gold hull above
  OXIDE(K); walls(K, P, -1.4, 0.35);
  WHITE(K).material(0.38, 0.10); walls(K, P, 0.35, 2.25);
  K.color(0.22, 0.17, 0.14).material(0.72, 0); deck(K, P, 2.25);
  // Golden waterline LED ribbon wrapping the hull sheer!
  GOLD_TRIM(K);
  for (const sgn of [-1, 1]) {
    K.box(-0.04, 2.20, sgn * 0.505, 0.80, 0.22, 0.014);
    K.box(0.39, 2.20, sgn * 0.34, 0.16, 0.22, 0.016);
  }
  K.box(0.485, 2.25, 0, 0.03, 0.40, 0.10); // glowing bow badge

  // Tier 1 (Main Banquet Hall): y 2.25..5.45
  PAINT(K); K.box(-0.04, 3.85, 0, 0.78, 3.2, 0.86);
  WARM_SALOON(K);
  K.box(-0.04, 3.95, 0, 0.786, 1.75, 0.78);
  K.box(-0.04, 3.95, 0, 0.72, 1.75, 0.868);
  // Deck 2 overhang + golden LED fascia
  K.color(0.86, 0.78, 0.62).material(0.42, 0.15); K.box(-0.03, 5.58, 0, 0.84, 0.28, 0.94);
  GOLD_TRIM(K);
  K.box(-0.03, 5.58, 0.474, 0.83, 0.24, 0.016); K.box(-0.03, 5.58, -0.474, 0.83, 0.24, 0.016);
  K.box(0.392, 5.58, 0, 0.016, 0.24, 0.92); K.box(-0.452, 5.58, 0, 0.016, 0.24, 0.92);

  // Tier 2 (Observation Gallery Deck): y 5.72..8.75
  PAINT(K); K.box(-0.05, 7.22, 0, 0.68, 3.0, 0.78);
  WARM_SALOON(K);
  K.box(-0.05, 7.30, 0, 0.686, 1.65, 0.70);
  K.box(-0.05, 7.30, 0, 0.62, 1.65, 0.788);
  // Deck 3 overhang + golden LED fascia
  K.color(0.88, 0.76, 0.56).material(0.42, 0.18); K.box(-0.05, 8.86, 0, 0.74, 0.28, 0.86);
  GOLD_TRIM(K);
  K.box(-0.05, 8.86, 0.434, 0.73, 0.26, 0.016); K.box(-0.05, 8.86, -0.434, 0.73, 0.26, 0.016);
  K.box(0.322, 8.86, 0, 0.016, 0.26, 0.84); K.box(-0.422, 8.86, 0, 0.016, 0.26, 0.84);

  // Tier 3 (VIP Bayu Pavilion Deck + Forward Wheelhouse): y 9.0..11.9
  K.color(0.42, 0.10, 0.07).material(0.48, 0.05); // crimson lacquer columns/fascia
  K.box(-0.08, 10.45, 0, 0.50, 2.9, 0.62);
  WARM_SALOON(K);
  K.box(-0.08, 10.50, 0, 0.506, 1.55, 0.54);
  K.box(-0.08, 10.50, 0, 0.44, 1.55, 0.628);
  // Forward bridge / wheelhouse
  PAINT(K); K.box(0.22, 10.35, 0, 0.14, 2.7, 0.56);
  GLASS(K); K.box(0.225, 10.65, 0, 0.142, 0.95, 0.50);

  // Ornate Bayu upturned double-eave palace crown roof!
  K.color(0.18, 0.14, 0.12).material(0.55, 0.1);
  K.box(-0.08, 12.08, 0, 0.58, 0.36, 0.74);
  K.color(0.72, 0.16, 0.09).material(0.45, 0.08);
  K.box(-0.08, 12.65, 0, 0.46, 0.95, 0.52);
  // Glowing golden palace ridge & eave outlines
  GOLD_TRIM(K);
  K.box(-0.08, 12.05, 0.376, 0.58, 0.24, 0.016); K.box(-0.08, 12.05, -0.376, 0.58, 0.24, 0.016);
  K.box(-0.08, 13.28, 0, 0.44, 0.34, 0.12);
  // Upturned golden corner finials
  for (const sx of [-0.36, 0.20]) for (const sz of [-0.36, 0.36]) {
    K.box(sx, 12.35, sz, 0.04, 0.48, 0.04);
  }
  // Crimson lantern strings along the upper promenade decks
  RED_LANTERN(K);
  for (let i = -3; i <= 3; i++) {
    const lx = -0.05 + i * 0.095;
    K.box(lx, 8.35, 0.44, 0.022, 0.52, 0.042);
    K.box(lx, 8.35, -0.44, 0.022, 0.52, 0.042);
    K.box(lx, 5.10, 0.48, 0.022, 0.48, 0.042);
    K.box(lx, 5.10, -0.48, 0.022, 0.48, 0.042);
  }
  // Radar mast & navigation crown light
  K.color(0.85, 0.75, 0.52).material(0.35, 0.6);
  K.tube([0.22, 11.7, 0], [0.22, 15.8, 0], 0.004, 0.002, 5);
  GOLD_TRIM(K); K.box(0.22, 15.9, 0, 0.015, 0.45, 0.06);

  return K.geometry();
}

function ferry() {
  const K = new Kit();
  const P = hullPlan(0.36, 0.34, 0.14);
  K.color(0.08, 0.14, 0.26).material(0.55, 0); walls(K, P, -1.0, 1.3);
  K.color(0.30, 0.31, 0.30).material(0.85, 0); deck(K, P, 1.3);
  WHITE(K).material(0.48, 0); K.box(0, 2.55, 0, 0.78, 2.5, 0.86); K.box(0, 5.0, 0, 0.62, 2.4, 0.74);
  WARM_SALOON(K);
  K.box(0, 2.75, 0, 0.784, 1.1, 0.80); K.box(0, 2.75, 0, 0.72, 1.1, 0.868);
  K.box(0, 5.2, 0, 0.624, 1.0, 0.68); K.box(0, 5.2, 0, 0.56, 1.0, 0.748);
  GOLD_TRIM(K); K.box(0, 6.26, 0.402, 0.66, 0.16, 0.012); K.box(0, 6.26, -0.402, 0.66, 0.16, 0.012);
  K.color(0.78, 0.79, 0.78).material(0.6, 0); K.box(0, 6.32, 0, 0.66, 0.14, 0.80);
  PAINT(K); K.box(0, 7.4, 0, 0.12, 2.1, 0.42);
  GLASS(K); K.box(0, 7.7, 0, 0.122, 0.8, 0.38); K.box(0, 7.7, 0, 0.10, 0.8, 0.425);
  K.color(0.62, 0.14, 0.10).material(0.55, 0); K.box(0, 8.9, 0, 0.05, 1.0, 0.14);
  return K.geometry();
}

const PALETTE = [
  [[0.80, 0.80, 0.78], [0.10, 0.22, 0.42], [0.48, 0.12, 0.08], [0.12, 0.30, 0.22], [0.76, 0.56, 0.12]],     // 0 small craft
  [[0.56, 0.48, 0.33], [0.60, 0.53, 0.38], [0.40, 0.39, 0.37], [0.06, 0.06, 0.065], [0.13, 0.27, 0.19], [0.13, 0.22, 0.40]], // 1 barge loads
  [[0.06, 0.06, 0.07], [0.08, 0.12, 0.26], [0.38, 0.09, 0.07], [0.08, 0.22, 0.16], [0.30, 0.31, 0.33]],     // 2 cargo ship hulls
  [[0.18, 0.32, 0.52], [0.54, 0.14, 0.11], [0.32, 0.34, 0.33], [0.16, 0.35, 0.26]],                         // 3 pontoons
  [[0.96, 0.90, 0.76], [0.62, 0.11, 0.09], [0.12, 0.18, 0.34], [0.88, 0.72, 0.38]],                         // 4 Two-Rivers Golden Cruise Ships
  [[0.90, 0.88, 0.82], [0.86, 0.80, 0.68]],                                                                  // 5 Two-Rivers Ferries
];

const WAKE_VERT = /* glsl */`${PRECISION}
in vec3 position; in mat4 instanceMatrix;
uniform mat4 viewMatrix, projectionMatrix;
out vec3 vLocal; out vec3 vWorld;
void main() { vec4 w = instanceMatrix * vec4(position, 1.0); vLocal = position; vWorld = w.xyz; gl_Position = projectionMatrix * (viewMatrix * w); }`;
const WAKE_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform float uTime;
in vec3 vLocal; in vec3 vWorld;
void main() {
  float u = -vLocal.x, w = abs(vLocal.z), spread = mix(0.22, 1.0, sqrt(u));
  float arm = smoothstep(0.14, 0.0, abs(w - spread * 0.86)) * (1.0 - u);
  float mid = smoothstep(spread * 0.42, 0.0, w) * (1.0 - u) * (1.0 - u);
  float foam = max(arm, mid);
  float n = vnoise(vWorld.xz * 0.8 + uTime * 0.15) * 0.55 + vnoise(vWorld.xz * 2.9 - uTime * 0.3) * 0.45;
  if (foam < n * 0.95 + 0.06) discard;
  Surface s = defaultSurface();
  s.albedo = vec3(0.76, 0.80, 0.79); s.normal = vec3(0.0, 1.0, 0.0); s.roughness = 0.62;
  s.model = 128.0;
  writeGBuffer(s);
}`;

const KIND_SPEED = [5.2, 3.0, 3.8, 0, 3.6, 4.4];

function buildRiverCurve(arr) {
  if (!arr || arr.length < 4) return null;
  const nr = arr.length / 2, cum = new Float32Array(nr);
  for (let k = 1; k < nr; k++) cum[k] = cum[k - 1] + Math.hypot(arr[k * 2] - arr[k * 2 - 2], arr[k * 2 + 1] - arr[k * 2 - 1]);
  return { R: arr, cum, n: nr, len: cum[nr - 1] };
}

function sampleRiver(rv, s, out) {
  const { R, cum, n } = rv;
  const sc = Math.max(0, Math.min(rv.len, s));
  let lo = 0, hi = n - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= sc) lo = m; else hi = m - 1; }
  const seg = cum[lo + 1] - cum[lo] || 1, t = (sc - cum[lo]) / seg;
  out.x = R[lo * 2] + (R[lo * 2 + 2] - R[lo * 2]) * t;
  out.z = R[lo * 2 + 1] + (R[lo * 2 + 3] - R[lo * 2 + 1]) * t;
  out.dx = (R[lo * 2 + 2] - R[lo * 2]) / seg;
  out.dz = (R[lo * 2 + 3] - R[lo * 2 + 1]) / seg;
  return out;
}

/** Find the arc-length s on river rv closest to (x, z). */
function projectRiver(rv, x, z) {
  let bestS = 0, bestD2 = 1e18;
  const { R, cum, n } = rv;
  for (let k = 0; k + 1 < n; k++) {
    const ax = R[k * 2], az = R[k * 2 + 1], bx = R[k * 2 + 2], bz = R[k * 2 + 3];
    const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz;
    const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0;
    const dx = x - (ax + ux * t), dz = z - (az + uz * t), d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestS = cum[k] + t * (cum[k + 1] - cum[k]); }
  }
  return { s: bestS, d2: bestD2 };
}

export class Boats {
  constructor({ scenes, env, terrain = null }) {
    this.scenes = scenes; this.env = env; this.terrain = terrain;
    this.waterY = terrain ? (terrain.waterY ?? 0.0) : 0.0;
    this.count = 0; this.movers = []; this.rivers = [];
  }

  async load() {
    let D;
    try { D = await fetchJSON('boats.json'); } catch { return; }
    if (D.waterY !== undefined) this.waterY = D.waterY;
    const B = D.boats || [], st = D.stride || 9, n = Math.floor(B.length / st);
    const geos = [smallCraft(), barge(), ship(), pontoon(), cruiseShip(), ferry()];
    const mat = kitMaterial(this.env, { instanced: true, instanceColor: true });
    const dep = depthMaterial({ instanced: true });
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const hsh = (x, z) => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return h - Math.floor(h); };
    const scaleY = (kind, L) => {
      if (kind === 4) return Math.min(1.25, Math.max(0.88, L / 70));
      if (kind === 2) return Math.min(1.45, Math.max(0.8, L / 95));
      if (kind === 0) return Math.min(1.3, Math.max(0.7, L / 16));
      return 1;
    };

    // ---- moored and anchored vessels: static instances
    for (let kind = 0; kind < 5; kind++) {
      const sel = [];
      for (let i = 0; i < n; i++) if (B[i * st + 5] === kind && !B[i * st + 6]) sel.push(i);
      if (!sel.length) continue;
      const im = new THREE.InstancedMesh(geos[kind], mat, sel.length);
      const sh = new THREE.InstancedMesh(geos[kind], dep, sel.length);
      sel.forEach((i, k) => {
        const x = B[i * st], z = B[i * st + 1], L = B[i * st + 2], W = B[i * st + 3], r = hsh(x, z);
        q.setFromAxisAngle(up, B[i * st + 4]);
        p.set(x, this.waterY - (kind === 1 ? r * 0.45 : 0), z);
        s.set(L, scaleY(kind, L), W);
        M.compose(p, q, s); im.setMatrixAt(k, M); sh.setMatrixAt(k, M);
        const pal = PALETTE[kind], c = pal[Math.floor(((r * 7919) % 1) * pal.length)];
        col.setRGB(c[0], c[1], c[2]); im.setColorAt(k, col);
      });
      im.instanceMatrix.needsUpdate = true; sh.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); sh.computeBoundingSphere();
      sh.layers.enable(1);
      this.scenes.opaque.add(im); this.scenes.shadow.add(sh);
    }

    // ---- Two Rivers centerlines: Yangtze (0) & Jialing (1)
    const yz = buildRiverCurve(D.river);
    const jl = buildRiverCurve(D.jialing);
    this.rivers = [yz, jl].filter(Boolean);
    this.river = yz || jl;
    if (!this.river) return;

    const movers = this.movers;
    let seed = 20261113;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const tmpA = {};

    // Underway vessels from boats.json (auto-assign each to Yangtze or Jialing!)
    for (let i = 0; i < n; i++) if (B[i * st + 6]) {
      const x = B[i * st], z = B[i * st + 1], L = B[i * st + 2], W = B[i * st + 3];
      const kind = Math.min(4, B[i * st + 5]), sd = B[i * st + 7];
      const off = Math.max(-105, Math.min(105, B[i * st + 8]));
      let rv = yz || jl;
      if (yz && jl) {
        let dy = 1e18, dj = 1e18;
        if (sd <= yz.len) { sampleRiver(yz, sd, tmpA); dy = (tmpA.x - x) ** 2 + (tmpA.z - z) ** 2; }
        if (sd <= jl.len) { sampleRiver(jl, sd, tmpA); dj = (tmpA.x - x) ** 2 + (tmpA.z - z) ** 2; }
        rv = dj < dy ? jl : yz;
      }
      movers.push({ kind, rv, L, W, s: Math.min(rv.len - 1, Math.max(0, sd)), off, dir: off < 0 ? 1 : -1, v: KIND_SPEED[kind] * (0.85 + 0.35 * rnd()), k: seed });
    }

    // Core-zone scenic Chongqing Two-Rivers Golden Cruise Ships (两江游轮) gliding past Hongyadong, Qiansimen, Raffles/Chaotianmen & Dongshuimen!
    if (yz) {
      const yzCore = projectRiver(yz, 1450, -700).s; // right at Chaotianmen / Dongshuimen
      for (const [ds, off, dir, L] of [
        [-2200, -55, 1, 74], [-750, 48, -1, 78], [450, -42, 1, 70], [1900, 52, -1, 76],
      ]) {
        movers.push({ kind: 4, rv: yz, L, W: L * 0.23, s: (yzCore + ds + yz.len) % yz.len, off, dir, v: 3.4 + 0.8 * rnd(), k: seed });
      }
      // Extra Yangtze working barges/coasters along the core stretch (within +-18km of Chaotianmen)
      for (let ds = -14000; ds <= 14000; ds += 1400 + 1600 * rnd()) {
        const r = rnd(), kind = r < 0.65 ? 1 : r < 0.88 ? 2 : 0, dir = rnd() < 0.5 ? 1 : -1;
        const L = kind === 1 ? 38 + 28 * rnd() : kind === 2 ? 70 + 48 * rnd() : 14 + 9 * rnd();
        movers.push({ kind, rv: yz, L, W: kind === 1 ? L / 4.8 : kind === 2 ? L / 5.8 : L / 3.0, s: (yzCore + ds + yz.len) % yz.len, off: -dir * (42 + 56 * rnd()), dir, v: KIND_SPEED[kind] * (0.8 + 0.4 * rnd()), k: seed });
      }
    }
    if (jl) {
      // Jialing River near Hongyadong / Qiansimen / Grand Theatre — cruises loop smoothly along the lower Jialing reach!
      const jlHongya = projectRiver(jl, 200, -780).s;
      const jlMin = Math.max(0, jlHongya - 5200), jlMax = Math.min(jl.len - 200, jlHongya + 900);
      for (const [f, off, dir, L] of [
        [0.86, -24, 1, 68], [0.68, 26, -1, 72], [0.42, -22, 1, 64],
      ]) {
        movers.push({ kind: 4, rv: jl, minS: jlMin, maxS: jlMax, L, W: L * 0.22, s: jlMin + (jlMax - jlMin) * f, off, dir, v: 3.1 + 0.6 * rnd(), k: seed });
      }
    }

    // Two-Rivers Ferries (kind 5) from D.ferries (including Hongyadong–Jiangbeizui!)
    for (const f of D.ferries || []) {
      const len = Math.hypot(f[2] - f[0], f[3] - f[1]);
      if (len < 30) continue;
      movers.push({ kind: 5, L: 36, W: 10.5, ferry: f, len, v: 4.4, t0: rnd() * 500, k: seed });
    }

    const mm = kitMaterial(this.env, { instanced: true, instanceColor: true, moving: true });
    this.dyn = geos.map((g, kind) => {
      const cnt = movers.filter((m) => m.kind === kind).length;
      if (!cnt) return null;
      const im = new THREE.InstancedMesh(g, mm, cnt); im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      let k = 0;
      for (const m of movers) if (m.kind === kind) {
        m.slot = k;
        const pal = PALETTE[kind], c = pal[m.k % pal.length];
        col.setRGB(c[0], c[1], c[2]); im.setColorAt(k++, col);
      }
      im.instanceColor.needsUpdate = true;
      this.scenes.opaque.add(im);
      return im;
    });

    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 0.04, 0, -1, 0.04, 0, 1, -1, 0, 1]), 3));
    wg.setIndex([0, 2, 1, 0, 3, 2]);
    this.wake = new THREE.InstancedMesh(wg, gbufferMaterial({
      vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG,
      uniforms: { uTime: this.env.uniforms.uTime }, side: THREE.DoubleSide, name: 'wake',
    }), Math.max(1, movers.length));
    this.wake.frustumCulled = false; this.wake.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scenes.opaque.add(this.wake);

    this.count = n + movers.length;
    this._M = M; this._q = q; this._p = p; this._s = s; this._up = up; this._sy = scaleY;
  }

  update(time, camera) {
    if (!this.river || !this.dyn) return;
    const M = this._M, q = this._q, p = this._p, s = this._s, up = this._up;
    const A = this._A || (this._A = {}), Bq = this._Bq || (this._Bq = {});
    const cx = camera.position.x, cz = camera.position.z;
    const wy = this.waterY;
    let nw = 0;
    for (const m of this.movers) {
      let x, z, hx, hz, speed = m.v;
      if (m.ferry) {
        const f = m.ferry, sail = m.len / m.v, wait = 55, T = 2 * (sail + wait), u = (time + m.t0) % T;
        const a = u < sail ? u / sail : u < sail + wait ? 1 : u < 2 * sail + wait ? 1 - (u - sail - wait) / sail : 0;
        if (!(u < sail || (u >= sail + wait && u < 2 * sail + wait))) speed = 0;
        const e = a * a * (3 - 2 * a);
        x = f[0] + (f[2] - f[0]) * e; z = f[1] + (f[3] - f[1]) * e;
        const back = u >= sail + wait;
        hx = (f[2] - f[0]) / m.len; hz = (f[3] - f[1]) / m.len;
        speed *= Math.min(1, 6 * a * (1 - a) + 0.1) * (back ? -1 : 1);
      } else {
        const rv = m.rv || this.river;
        let sd, dir = m.dir;
        if (m.minS !== undefined && m.maxS !== undefined) {
          // Ping-pong smoothly along the lower Jialing reach past Hongyadong & Qiansimen
          const span = Math.max(100, m.maxS - m.minS);
          const u = ((m.s - m.minS) + dir * m.v * time) % (2 * span);
          const w = u < 0 ? u + 2 * span : u;
          if (w <= span) { sd = m.minS + w; dir = 1; }
          else { sd = m.maxS - (w - span); dir = -1; }
        } else {
          sd = (m.s + dir * m.v * time) % rv.len;
          if (sd < 0) sd += rv.len;
        }
        sampleRiver(rv, sd, A);
        sampleRiver(rv, Math.min(rv.len, Math.max(0, sd + dir * 40)), Bq);
        let tx = Bq.x - A.x, tz = Bq.z - A.z;
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const off = m.minS !== undefined ? -dir * Math.abs(m.off) : m.off;
        x = A.x + A.dz * off; z = A.z - A.dx * off;
        hx = tx; hz = tz;
      }
      if ((x - cx) ** 2 + (z - cz) ** 2 > 11000 * 11000) {
        p.set(0, -500, 0); s.set(1, 1, 1); q.identity(); M.compose(p, q, s);
        this.dyn[m.kind].setMatrixAt(m.slot, M); continue;
      }
      q.setFromAxisAngle(up, Math.atan2(-hz, hx));
      p.set(x, wy, z);
      s.set(m.L, this._sy(m.kind, m.L), m.W);
      M.compose(p, q, s);
      this.dyn[m.kind].setMatrixAt(m.slot, M);

      const sp = Math.abs(speed);
      if (sp > 0.4) {
        const dir = speed < 0 ? -1 : 1, k = Math.min(1, sp / 4);
        q.setFromAxisAngle(up, Math.atan2(-hz * dir, hx * dir));
        p.set(x - hx * dir * m.L * 0.47, wy + 0.06, z - hz * dir * m.L * 0.47);
        s.set(m.L * (1.6 + 2.2 * k), 1, m.W * (1.3 + 1.6 * k));
        M.compose(p, q, s);
        this.wake.setMatrixAt(nw++, M);
      }
    }
    for (const im of this.dyn) if (im) im.instanceMatrix.needsUpdate = true;
    this.wake.count = nw; this.wake.instanceMatrix.needsUpdate = true;
  }
}
