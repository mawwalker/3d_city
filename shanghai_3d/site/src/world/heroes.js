// More hand-built landmarks (Kit geometry), placed from landmarks.json (pipeline/34_landmarks.py):
// the halls of the gardens and temples (Yu Garden and the City God Temple, Jing'an Temple, Longhua, the Jade Buddha
// Temple, the Confucian Temple) with curved tiled roofs, Longhua Pagoda, the Mid-Lake Pavilion, the Garden Bridge,
// the China Art Museum, the Mercedes-Benz Arena, Shanghai Museum, St Ignatius Cathedral, the Disney castle, and the
// haunched girders and river piers of Fengpu Bridge. Shapes follow the real ones in outline, not in measured detail.

import * as THREE from 'three';
import { Kit } from './kit.js';

const STONE = [0.50, 0.49, 0.46];
const STYLE = [
  { wall: [0.80, 0.79, 0.75], wood: [0.20, 0.07, 0.05], lattice: [0.30, 0.13, 0.08], tile: [0.085, 0.09, 0.10], rough: 0.7, metal: 0, ridge: [0.12, 0.12, 0.13] },      // Jiangnan garden
  { wall: [0.33, 0.20, 0.11], wood: [0.25, 0.13, 0.07], lattice: [0.40, 0.25, 0.11], tile: [0.90, 0.60, 0.13], rough: 0.4, metal: 0.45, ridge: [0.90, 0.60, 0.13] },    // Jing'an: teak and gold
  { wall: [0.72, 0.52, 0.18], wood: [0.30, 0.07, 0.05], lattice: [0.34, 0.11, 0.07], tile: [0.13, 0.135, 0.14], rough: 0.7, metal: 0, ridge: [0.16, 0.16, 0.17] },       // monastery: ochre walls
  { wall: [0.50, 0.10, 0.08], wood: [0.22, 0.07, 0.05], lattice: [0.32, 0.13, 0.08], tile: [0.14, 0.14, 0.15], rough: 0.7, metal: 0, ridge: [0.16, 0.16, 0.17] },        // Confucian temple: red walls
];

/** Hipped roof over an eave rectangle (half sizes A along x, B along z) at height y0: concave slopes, corners turned up. */
function hipRoof(K, A, B, y0, rise, lift, nu = 6, nt = 4) {
  if (B > A) { const m = new THREE.Matrix4().makeRotationY(Math.PI / 2), keep = K.xf; K.transform(keep ? keep.clone().multiply(m) : m); hipRoof(K, B, A, y0, rise, lift, nu, nt); K.transform(keep); return; }
  const r = Math.max(A - B, A * 0.12);
  const P = (f, u, t) => {
    const s = 1 - t, y = y0 + rise * Math.pow(t, 1.55) + lift * Math.abs(u) ** 3 * s * s, x = A + (r - A) * t;
    return f === 0 ? [u * x, y, B * s] : f === 1 ? [x, y, -u * B * s] : f === 2 ? [-u * x, y, -B * s] : [-x, y, u * B * s];
  };
  for (let f = 0; f < 4; f++) for (let i = 0; i < nu; i++) for (let j = 0; j < nt; j++) {
    const u0 = -1 + 2 * i / nu, u1 = -1 + 2 * (i + 1) / nu, t0 = j / nt, t1 = (j + 1) / nt;
    K.quad(P(f, u0, t0), P(f, u1, t0), P(f, u1, t1), P(f, u0, t1));
  }
  return r;
}

/** A timber hall: plinth, plastered walls between columns, lattice windows, one to three tiers of roof. */
function hall(K, w, d, h, style, tiersMin = 1) {
  const S = STYLE[style];
  let sa = Math.max(w, d) / 2, sb = Math.min(w, d) / 2;
  if (d > w) { const m = new THREE.Matrix4().makeRotationY(Math.PI / 2), keep = K.xf; K.transform(keep ? keep.clone().multiply(m) : m); hall(K, d, w, h, style, tiersMin); K.transform(keep); return; }
  const tiers = Math.max(tiersMin, h > 21 ? 3 : h > 12.5 ? 2 : 1);
  const rise = Math.min(sb * 0.62, 5.2) + 0.6, eave = Math.max(3.2, h - rise * 0.55);
  K.color(...STONE).material(0.85, 0); K.box(0, 0.25, 0, sa * 2 + 1.6, 0.5, sb * 2 + 1.6);
  let ya = 0.5;
  for (let t = 0; t < tiers; t++) {
    const top = t === tiers - 1, yb = 0.5 + (eave - 0.5) * (t + 1) / tiers;
    K.color(...S.wall).material(0.8, 0); K.box(0, (ya + yb) / 2, 0, sa * 2, yb - ya, sb * 2);
    K.color(...S.wood).material(0.6, 0);
    const nb = Math.max(1, Math.round(sa * 2 / 3.6)), bay = sa * 2 / nb;
    for (const sg of [1, -1]) {
      for (let k = 0; k <= nb; k++) K.box(-sa + k * bay, (ya + yb) / 2, sg * (sb + 0.04), 0.3, yb - ya, 0.3);
      K.box(0, yb - 0.3, sg * (sb + 0.03), sa * 2, 0.5, 0.2);
      K.box(sg * (sa + 0.03), yb - 0.3, 0, 0.2, 0.5, sb * 2);
    }
    // lattice windows: lit from inside at night
    K.color(...S.lattice).material(0.5, 0, -1.6);
    if (bay > 1.6) for (const sg of [1, -1]) for (let k = 0; k < nb; k++) K.box(-sa + (k + 0.5) * bay, ya + (yb - ya) * 0.5 - 0.1, sg * (sb + 0.02), bay - 0.9, (yb - ya) * 0.62, 0.1);
    K.color(...S.tile).material(S.rough, S.metal);
    const over = top ? 1.9 : 1.5;
    const r = hipRoof(K, sa + over, sb + over, yb, top ? rise : 1.9, top ? Math.min(1.6, 0.5 + sb * 0.12) : 0.9);
    if (top) {
      K.color(...S.ridge).material(0.7, S.metal);
      K.box(0, yb + rise + 0.2, 0, r * 2 + 0.8, 0.55, 0.45);
      for (const sg of [1, -1]) K.box(sg * (r + 0.3), yb + rise + 0.7, 0, 0.5, 1.0, 0.5);
    }
    ya = yb + 0.6; sa -= 1.3; sb -= 1.3;
    if (sa < 2 || sb < 2) break;
  }
}

/** Octagonal brick-and-timber pagoda (Longhua: seven storeys, about 40 m). */
function pagoda(K, n, R, H) {
  const sh = H * 0.80 / n;
  let y = 1.0, r = R;
  K.color(...STONE).material(0.85, 0); K.tube([0, 0, 0], [0, 1.0, 0], R + 2.4, R + 2.2, 8, true);
  for (let k = 0; k < n; k++) {
    const r1 = r * 0.93;
    K.color(0.74, 0.60, 0.30).material(0.8, 0); K.tube([0, y, 0], [0, y + sh * 0.74, 0], r, r1, 8, false);
    K.color(0.28, 0.07, 0.05).material(0.6, 0); K.tube([0, y + 0.05, 0], [0, y + 0.95, 0], r + 1.0, r + 1.0, 8, true);
    K.color(0.20, 0.06, 0.05).material(0.5, 0, -1.2); for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + Math.PI / 8; K.box(Math.cos(a) * r * 0.97, y + sh * 0.36, Math.sin(a) * r * 0.97, 0.9, sh * 0.42, 0.9); }
    K.color(0.12, 0.125, 0.13).material(0.7, 0);
    K.tube([0, y + sh * 0.72, 0], [0, y + sh * 0.98, 0], r1 + 2.7 - k * 0.14, r1 * 0.98, 8, false);
    K.tube([0, y + sh * 0.66, 0], [0, y + sh * 0.72, 0], r1 + 2.9 - k * 0.14, r1 + 2.7 - k * 0.14, 8, false);      // the eaves' turned-up lip
    y += sh; r = r1;
  }
  K.color(0.12, 0.125, 0.13).material(0.7, 0); K.tube([0, y, 0], [0, y + H * 0.05, 0], r * 0.9, 0.35, 8, true);
  K.color(0.55, 0.45, 0.20).material(0.4, 0.8); K.tube([0, y + H * 0.05, 0], [0, H, 0], 0.30, 0.05, 6, true);
  for (let q = 0; q < 4; q++) K.sphere(0, y + H * 0.07 + q * H * 0.025, 0, 0.62 - q * 0.1, 8, 5);
}

/** The Garden Bridge: two riveted steel camelback spans, a pier in the creek between them. Local x along the bridge. */
function gardenBridge(K, len) {
  const span = len / 2 - 1.2, hz = 5.9, n = 8, dx = span / n, top = [0, 5.4, 7.7, 8.9, 9.3, 8.9, 7.7, 5.4, 0];
  const steel = () => K.color(0.47, 0.49, 0.50).material(0.5, 0.55);
  const bar = (A, B, r = 0.2) => K.tube(A, B, r, r, 4, false);
  steel();
  for (const sx of [-1, 1]) {
    const x0 = sx * (span / 2 + 0.6) - span / 2;
    for (const z of [-hz, hz]) {
      bar([x0, 0.75, z], [x0 + span, 0.75, z], 0.3);                                               // bottom chord
      for (let k = 0; k < n; k++) {
        const xa = x0 + k * dx, xb = xa + dx;
        bar([xa, k === 0 ? 0.75 : top[k], z], [xb, k === n - 1 ? 0.75 : top[k + 1], z], 0.26);     // top chord and the raking end posts
        if (k > 0) bar([xa, 0.75, z], [xa, top[k], z], 0.16);                                      // verticals
        if (k > 0 && k < n - 1) { if (k < n / 2) bar([xa, top[k], z], [xb, 0.75, z], 0.13); else bar([xa, 0.75, z], [xb, top[k + 1], z], 0.13); }
      }
    }
    // bracing between the two trusses overhead
    for (let k = 1; k < n; k++) { bar([x0 + k * dx, top[k], -hz], [x0 + k * dx, top[k], hz], 0.15); if (k < n - 1) bar([x0 + k * dx, top[k], k % 2 ? -hz : hz], [x0 + (k + 1) * dx, top[k + 1], k % 2 ? hz : -hz], 0.1); }
    // footway railings outside the trusses
    for (const z of [-hz - 2.6, hz + 2.6]) { bar([x0, 1.25, z], [x0 + span, 1.25, z], 0.05); for (let q = 0; q <= 16; q++) bar([x0 + span * q / 16, 0.2, z], [x0 + span * q / 16, 1.25, z], 0.04); }
  }
  K.color(0.44, 0.43, 0.41).material(0.85, 0);
  K.box(0, -1.3, 0, 3.2, 3.4, hz * 2 + 7.5);
  for (const sx of [-1, 1]) K.box(sx * (len / 2 - 0.4), -1.3, 0, 1.6, 3.4, hz * 2 + 7.5);
}

/** China Art Museum (the Expo's China Pavilion): four legs carrying a crown of red beams that widens as it rises. */
function artPalace(K, w) {
  const s = w / 140, red = () => K.color(0.50, 0.055, 0.04).material(0.55, 0, -0.5, 0.5);
  red();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(sx * 35 * s, 16.5, sz * 35 * s, 19 * s, 33, 19 * s);
  for (let k = 0; k < 7; k++) {
    const half = (36 + k * 5.6) * s, y = 33 + k * 4.3;
    red(); K.box(0, y + 1.7, 0, half * 2, 3.4, half * 2);
    K.color(0.14, 0.02, 0.02).material(0.8, 0); K.box(0, y + 3.85, 0, half * 2 - 4, 0.9, half * 2 - 4);
    // beam ends: the bracket rhythm along each edge
    red(); const nbm = 9 + k;
    for (let q = 0; q < nbm; q++) { const t = -half + 3 + (half * 2 - 6) * q / (nbm - 1); for (const sg of [-1, 1]) { K.box(t, y + 3.85, sg * (half - 0.6), 2.2 * s, 0.9, 3.4); K.box(sg * (half - 0.6), y + 3.85, t, 3.4, 0.9, 2.2 * s); } }
  }
  K.color(0.20, 0.20, 0.21).material(0.8, 0); K.box(0, 63.3, 0, 139 * s, 0.4, 139 * s);
  K.color(0.62, 0.60, 0.56).material(0.8, 0); K.box(0, 4.5, 0, 150 * s, 9, 150 * s * 0.72);          // the podium between the legs
}

/** Mercedes-Benz Arena: a shell-shaped saucer. */
function benzArena(K, w, d) {
  const keep = K.xf, m = new THREE.Matrix4().makeScale(w / 2, 1, d / 2);
  K.transform(keep ? keep.clone().multiply(m) : m);
  K.color(0.70, 0.72, 0.74).material(0.32, 0.7); K.lathe([[0.62, 0], [0.80, 5], [0.95, 11]], 40);
  K.color(0.06, 0.08, 0.10).material(0.1, 0, -1.4, 0.9); K.lathe([[0.95, 11], [1.0, 15], [0.985, 18.5]], 40);          // the glazed rim
  K.color(0.74, 0.76, 0.78).material(0.30, 0.7); K.lathe([[0.985, 18.5], [0.86, 24], [0.62, 29.5], [0.30, 32.4], [0.0, 33.2]], 40);
  K.transform(keep);
}

/** Shanghai Museum: a square base under a round top with four handles, after a bronze ding. */
function museum(K, size) {
  const B = size, g = () => K.color(0.66, 0.57, 0.51).material(0.6, 0);
  g(); K.box(0, 6, 0, B, 12, B); K.box(0, 16.5, 0, B * 0.80, 9, B * 0.80);
  K.tube([0, 21, 0], [0, 26.5, 0], B * 0.44, B * 0.44, 40, false);
  K.tube([0, 26.5, 0], [0, 29, 0], B * 0.50, B * 0.50, 40, true); K.tube([0, 25.6, 0], [0, 26.5, 0], B * 0.44, B * 0.50, 40, false);
  K.color(0.07, 0.09, 0.11).material(0.1, 0, -1.2, 0.9); K.sphere(0, 27.5, 0, B * 0.17, 20, 10);
  g();
  for (let q = 0; q < 4; q++) {
    const a = q * Math.PI / 2, cx = Math.cos(a) * B * 0.47, cz = Math.sin(a) * B * 0.47, tx = -Math.sin(a), tz = Math.cos(a);
    for (let k = 0; k < 6; k++) { const t0 = k / 6 * Math.PI, t1 = (k + 1) / 6 * Math.PI, R = B * 0.12; K.tube([cx + tx * Math.cos(t0) * R, 29 + Math.sin(t0) * R, cz + tz * Math.cos(t0) * R], [cx + tx * Math.cos(t1) * R, 29 + Math.sin(t1) * R, cz + tz * Math.cos(t1) * R], 1.3, 1.3, 6, false); }
  }
  K.color(0.07, 0.09, 0.11).material(0.1, 0, -0.8, 0.9); for (const sg of [-1, 1]) { K.box(0, 5, sg * (B / 2 + 0.05), B * 0.3, 7, 0.2); K.box(sg * (B / 2 + 0.05), 5, 0, 0.2, 7, B * 0.3); }
}

/** St Ignatius Cathedral, Xujiahui: red brick nave and transept, twin spires over the front (local -x). */
function cathedral(K, L) {
  const brick = () => K.color(0.42, 0.17, 0.12).material(0.85, 0), slate = () => K.color(0.13, 0.14, 0.15).material(0.6, 0.1);
  const gable = (x0, x1, hw, y0, y1, alongX = true) => {      // pitched roof between two stations
    const A = alongX ? [[x0, y0, hw], [x1, y0, hw], [x1, y1, 0], [x0, y1, 0]] : [[hw, y0, x1], [hw, y0, x0], [0, y1, x0], [0, y1, x1]];
    const mir = (p) => (alongX ? [p[0], p[1], -p[2]] : [-p[0], p[1], p[2]]);
    K.quad(A[0], A[1], A[2], A[3]); K.quad(mir(A[1]), mir(A[0]), mir(A[3]), mir(A[2]));
  };
  const n0 = -L / 2 + 9, n1 = L / 2;
  brick(); K.box((n0 + n1) / 2, 9, 0, n1 - n0, 18, 20); K.box((n0 + n1) / 2, 5, 0, n1 - n0 - 4, 10, 31); K.box(4, 9, 0, 15, 18, 44);
  K.color(0.80, 0.76, 0.66).material(0.8, 0); for (let x = n0 + 4; x < n1 - 3; x += 6.5) for (const sg of [-1, 1]) K.box(x, 13.5, sg * 10.05, 1.6, 6, 0.2);      // clerestory windows' stone frames
  slate(); gable(n0, n1, 10.6, 18, 26); gable(-22, 22, 8.1, 18, 25, false);
  K.tube([n1, 0, 0], [n1, 14, 0], 10, 10, 10, false); K.tube([n1, 14, 0], [n1, 20, 0], 10.4, 0.3, 10, true);       // apse
  // west front: gable between two towers
  brick(); K.box(n0 - 3, 14, 0, 6, 28, 12);
  K.color(0.80, 0.76, 0.66).material(0.8, 0); K.tube([n0 - 6.05, 17, 0], [n0 - 5.9, 17, 0], 3.6, 3.6, 16, true);       // rose window
  for (const sg of [-1, 1]) {
    brick(); K.box(n0 - 3, 17, sg * 10, 8.5, 34, 8.5);
    K.color(0.80, 0.76, 0.66).material(0.8, 0); K.box(n0 - 3, 30, sg * 10, 8.8, 0.8, 8.8); K.box(n0 - 7.3, 24, sg * 10, 0.2, 9, 2.4);
    slate(); K.tube([n0 - 3, 34, sg * 10], [n0 - 3, 57, sg * 10], 4.6, 0.12, 8, true);
    K.color(0.75, 0.62, 0.25).material(0.4, 0.8); K.box(n0 - 3, 58.4, sg * 10, 0.16, 2.8, 0.16); K.box(n0 - 3, 58.9, sg * 10, 0.16, 0.16, 1.3);
  }
}

/** The castle of the Disney park, in outline: a keep and a crowd of round towers with pointed roofs. */
function castle(K) {
  const wall = () => K.color(0.84, 0.78, 0.72).material(0.8, 0, -0.9), roof = () => K.color(0.18, 0.27, 0.46).material(0.5, 0.2, -0.3), gold = () => K.color(0.80, 0.62, 0.22).material(0.35, 0.85);
  const tower = (x, z, r, h, cone) => { wall(); K.tube([x, 0, z], [x, h, z], r, r * 0.94, 14, false); K.tube([x, h, z], [x, h + 1.2, z], r * 1.12, r * 1.12, 14, true); roof(); K.tube([x, h + 1.2, z], [x, h + 1.2 + cone, z], r * 1.15, 0.08, 14, true); gold(); K.tube([x, h + 1.2 + cone, z], [x, h + 3.4 + cone, z], 0.12, 0.03, 5, true); };
  wall(); K.box(0, 7, 0, 44, 14, 32); K.box(0, 20, 0, 24, 14, 20);
  K.color(0.62, 0.50, 0.52).material(0.8, 0); K.box(0, 14.5, 0, 45, 1.0, 33);
  roof(); K.quad([-12.5, 27, 10.5], [12.5, 27, 10.5], [12.5, 35, 0], [-12.5, 35, 0]); K.quad([12.5, 27, -10.5], [-12.5, 27, -10.5], [-12.5, 35, 0], [12.5, 35, 0]);
  tower(0, 0, 6.4, 40, 17);
  for (const [x, z, r, h, c] of [[-21, 15, 4.2, 24, 11], [21, 15, 4.2, 24, 11], [-21, -15, 4.2, 22, 10], [21, -15, 4.2, 22, 10], [-11, 11, 3.0, 31, 10], [11, 11, 3.0, 33, 11], [-10, -10, 2.8, 30, 9], [10, -10, 2.8, 29, 9], [0, 15, 2.4, 26, 8], [-16, 0, 2.6, 27, 9], [16, 0, 2.6, 28, 9], [5, -4, 2.0, 46, 9], [-5, 5, 2.0, 44, 8]]) tower(x, z, r, h, c);
  K.color(0.10, 0.08, 0.09).material(0.6, 0); K.box(0, 4.5, 16.05, 7, 9, 0.2);        // the gate
}

/** Fengpu Bridge: continuous box girders deepening over the river piers (85 + 3 x 125 + 85 m). Bridge frame as landmarks.js. */
export function girderBridge(K, b, outlineAt) {
  const P = [-272.65, -187.5, -62.5, 62.5, 187.5, 272.65], D = b.deck;
  const depth = (x) => { for (let i = 0; i + 1 < P.length; i++) if (x >= P[i] && x <= P[i + 1]) { const u = (x - P[i]) / (P[i + 1] - P[i]); return i === 0 ? 3 + 4.2 * u * u : i === P.length - 2 ? 3 + 4.2 * (1 - u) * (1 - u) : 3 + 4.2 * (2 * u - 1) * (2 * u - 1); } return 3; };
  K.color(0.54, 0.535, 0.515).material(0.82, 0, -0.2);
  const st = [];
  for (let x = P[0]; x <= P[5] + 0.01; x += 5.4533) { const [zc, hw] = outlineAt(b, x); st.push([x, zc, Math.max(4, hw - 2.6), D - 0.4, D - 0.4 - depth(x)]); }
  for (let i = 0; i + 1 < st.length; i++) {
    const [x0, c0, w0, t0, b0] = st[i], [x1, c1, w1, t1, b1] = st[i + 1];
    K.quad([x0, b0, c0 + w0], [x1, b1, c1 + w1], [x1, t1, c1 + w1], [x0, t0, c0 + w0]);
    K.quad([x1, b1, c1 - w1], [x0, b0, c0 - w0], [x0, t0, c0 - w0], [x1, t1, c1 - w1]);
    K.quad([x0, b0, c0 - w0], [x1, b1, c1 - w1], [x1, b1, c1 + w1], [x0, b0, c0 + w0]);
  }
  for (const x of P) { const [zc, hw] = outlineAt(b, x), top = D - 0.4 - depth(x); K.box(x, (top - 3) / 2, zc, 4.2, top + 3, Math.max(6, hw * 2 - 7)); K.box(x, -1.0, zc, 9, 4.5, hw * 2 + 3); }
}

/** Build everything listed in landmarks.json. h: { addKit(K, x, y, z, rotY, mat?), circle(x, z, r, top), rect(x, z, ang, hx, hz, top), hallMat } */
export function buildHeroes(L, h) {
  // halls: one mesh per site keeps the draw calls down
  const H = L.halls || [];
  const groups = new Map();
  for (let i = 0; i < H.length; i += 7) { const key = Math.round(H[i] / 600) * 1000 + Math.round(H[i + 1] / 600); let g = groups.get(key); if (!g) groups.set(key, g = { K: new Kit(), ox: H[i], oz: H[i + 1] }); g.list = (g.list || 0) + 1;
    const [x, z, ang, w, d, ht, style] = H.slice(i, i + 7);
    g.K.transform(new THREE.Matrix4().makeRotationY(ang).setPosition(x - g.ox, 0, z - g.oz));
    hall(g.K, w, d, Math.max(4.5, Math.min(ht, 24)), style);
    h.rect(x, z, ang, w / 2, d / 2, Math.max(4, ht));
  }
  for (const g of groups.values()) { g.K.transform(null); h.addKit(g.K, g.ox, 0, g.oz, 0, h.hallMat); }
  const put = (P, fn, mat) => { if (!P) return; const K = new Kit(); fn(K, P); h.addKit(K, P.x, 0, P.z, P.angle || 0, mat); };
  put(L.huxinting, (K, P) => hall(K, Math.max(P.w, 11), Math.max(P.d, 8.5), 10.5, 0, 2), h.hallMat);
  put(L.longhuata, (K) => pagoda(K, 7, 4.7, 40.6), h.hallMat);
  if (L.longhuata) h.circle(L.longhuata.x, L.longhuata.z, 6.5, 40);
  put(L.artpalace, (K, P) => artPalace(K, Math.min(P.w, P.d)));
  if (L.artpalace) { const P = L.artpalace, s = Math.min(P.w, P.d) / 140, c = Math.cos(P.angle), sn = Math.sin(P.angle); for (const sx of [-1, 1]) for (const sz of [-1, 1]) h.circle(P.x + (sx * c + sz * sn) * 35 * s, P.z + (-sx * sn + sz * c) * 35 * s, 12 * s, 60, 4); }
  put(L.benz, (K, P) => benzArena(K, P.w, P.d));
  if (L.benz) h.circle(L.benz.x, L.benz.z, Math.min(L.benz.w, L.benz.d) * 0.42, 33, 16);
  put(L.museum, (K, P) => museum(K, Math.min(P.w, P.d) * 0.95));
  if (L.museum) h.rect(L.museum.x, L.museum.z, L.museum.angle, L.museum.d * 0.47, L.museum.d * 0.47, 29);
  if (L.cathedral) {
    // the front faces east
    const P = L.cathedral, a = Math.cos(P.angle) > 0 ? P.angle + Math.PI : P.angle;
    put({ ...P, angle: a }, (K) => cathedral(K, Math.max(P.w, 62)));
    h.rect(P.x, P.z, a, P.w / 2, 11, 18);
  }
  put(L.castle, (K) => castle(K));
  if (L.castle) h.rect(L.castle.x, L.castle.z, L.castle.angle, 22, 16, 30);
  if (L.waibaidu) { const P = L.waibaidu, K = new Kit(); gardenBridge(K, P.len); h.addKit(K, P.x, 0.15, P.z, Math.atan2(-P.uz, P.ux)); }
}
