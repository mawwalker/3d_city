// Hand-modelled landmarks. Towers are stacks of extruded slices in the building vertex format, so they get the same
// curtain-wall shader (mullions, rooms behind glass, lit windows at night) as the rest of the city; spheres, spires,
// domes and other free shapes come from the modelling kit. Positions come from OSM (data/landmarks.json).

import * as THREE from 'three';
import { buildHeroes, girderBridge } from './heroes.js';
import { MeshBuilder, addPrism } from './buildingGeom.js';
import { Kit } from './kit.js';
import { kitMaterial, depthMaterial } from '../engine/materials.js';
import { fetchJSON } from './data.js';
import { KIND } from './styles.js';

const TAU = Math.PI * 2;
function ringFn(n, fn) { const r = new Float32Array(n * 2); for (let k = 0; k < n; k++) { const t = k / n * TAU; const rad = fn(t); r[k * 2] = Math.cos(t) * rad; r[k * 2 + 1] = Math.sin(t) * rad; } return r; }
function rect(cx, cy, hx, hy, ang = 0) { const c = Math.cos(ang), s = Math.sin(ang); const p = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]; const r = new Float32Array(8); p.forEach(([x, y], k) => { r[k * 2] = cx + x * c - y * s; r[k * 2 + 1] = cy + x * s + y * c; }); return r; }
function poly(pts, ang = 0) { const c = Math.cos(ang), s = Math.sin(ang); const r = new Float32Array(pts.length * 2); pts.forEach(([x, y], k) => { r[k * 2] = x * c - y * s; r[k * 2 + 1] = x * s + y * c; }); return r; }

// ---- Shanghai Tower: a rounded triangle that turns 120 degrees and tapers as it rises, with the notch running up it
function shanghaiTower(B) {
  const H = 580, step = 10;
  const shape = (h) => { const R = 42.5 * Math.exp(-0.60 * h / H), phi = h / H * TAU / 3; return (t) => { let d = ((t - phi) % TAU + TAU) % TAU; if (d > Math.PI) d -= TAU; return R * (1 + 0.10 * Math.cos(3 * d)) - 7.5 * Math.max(0, 1 - Math.abs(d) / 0.17) * (R / 42.5); }; };
  for (let y = 0; y < H; y += step) {
    const band = (Math.round(y / step) % 7) === 6;                     // plant floors between the nine zones
    addPrism(B, ringFn(54, shape(y + step * 0.5)), y, y + step, { style: 20, pal: band ? 3 : 0, fH: 4.5, cap: y + step >= H, top: 700 });
  }
  // the crown: the outer skin spirals up past the roof, open to the sky
  const top = shape(H);
  for (const [a0, a1, y1] of [[0.3, 5.6, 596], [0.9, 4.6, 612], [1.5, 3.6, 632]]) {
    const n = 26, out = [], inn = [];
    const phi = TAU / 3;
    for (let k = 0; k <= n; k++) { const t = phi + a0 + (a1 - a0) * k / n; const r = top(t); out.push([Math.cos(t) * r, Math.sin(t) * r]); inn.push([Math.cos(t) * (r - 1.6), Math.sin(t) * (r - 1.6)]); }
    addPrism(B, poly([...out, ...inn.reverse()]), 580, y1, { style: 20, pal: 0, fH: 4.5, top: 700 });
  }
}

// ---- World Financial Center: a square prism carved by two arcs into a blade, with the trapezoid opening
function swfc(B, ang) {
  const a = 29, H = 492;
  const cut = (h) => Math.min(2 * a - 3.2, 2 * a * Math.pow(h / H, 1.75) * 1.02);
  const hex = (c) => poly([[-a, -a], [a - c, -a], [a, -a + c], [a, a], [-a + c, a], [-a, a - c]], ang);
  const step = 8.2;
  for (let y = 0; y < 398; y += step) addPrism(B, hex(cut(y + step * 0.5)), y, Math.min(y + step, 398), { style: 20, pal: 1, fH: 4.1, cap: false, top: 700 });
  // around the opening the blade is two piers; the opening widens upwards
  const d = Math.SQRT1_2;
  for (let y = 398; y < 472; y += step) {
    const y1 = Math.min(y + step, 472), hm = (y + y1) / 2;
    const th = Math.max(1.8, (2 * a - cut(hm)) * d), half = 41, w = 17 + (hm - 398) / 74 * 8;
    for (const sgn of [-1, 1]) {
      const t0 = sgn * w, t1 = sgn * half;
      const pts = [[t0 * d - th * d * sgn * 0 + th * d, t0 * d - th * d], [t1 * d + th * d, t1 * d - th * d], [t1 * d - th * d, t1 * d + th * d], [t0 * d - th * d, t0 * d + th * d]];
      const ccw = sgn > 0 ? pts : [pts[1], pts[0], pts[3], pts[2]];
      addPrism(B, poly(ccw, ang), y, y1, { style: 20, pal: 1, fH: 4.1, cap: y1 >= 472, top: 700 });
    }
  }
  addPrism(B, hex(cut(472)), 472, 492, { style: 20, pal: 1, fH: 4.1, top: 700, bottom: true });
}

// ---- Jin Mao: thirteen tiers that shorten towards the top like a pagoda, each with a flared edge
function jinMao(B, K, ang) {
  const floors = [16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  let y = 0;
  const oct = (w) => { const c = w * 0.18; return poly([[-w + c, -w], [w - c, -w], [w, -w + c], [w, w - c], [w - c, w], [-w + c, w], [-w, w - c], [-w, -w + c]], ang); };
  floors.forEach((n, k) => {
    const w = 26.5 - k * 1.05 - (k > 8 ? (k - 8) * 0.9 : 0);
    const h = n * 4.0;
    addPrism(B, oct(w), y, y + h - 1.1, { style: 20, pal: 2, fH: 4.0, cap: false, top: 700 });
    addPrism(B, oct(w + 1.3), y + h - 1.1, y + h, { style: 20, pal: 3, fH: 4.0, top: 700, bottom: true });
    y += h;
  });
  // crown and spire
  K.color(0.62, 0.63, 0.64).material(0.3, 0.9);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  for (let k = 0; k < 5; k++) { const w = 9 - k * 1.6, y0 = y + k * 6.5; K.transform(new THREE.Matrix4().makeRotationY(ang)).box(0, y0 + 3.25, 0, w * 2, 6.5, w * 2); }
  K.transform(null).tube([0, y + 32, 0], [0, 420.5, 0], 1.1, 0.15, 8);
}

// ---- Oriental Pearl
function orientalPearl(K) {
  const conc = () => K.color(0.60, 0.60, 0.58).material(0.75, 0);
  const pink = () => K.color(0.50, 0.13, 0.25).material(0.18, 0.2, 0, 0.9);
  // three columns and three raking struts
  conc();
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU + 0.52;
    K.tube([Math.cos(a) * 12, 0, Math.sin(a) * 12], [Math.cos(a) * 12, 286, Math.sin(a) * 12], 4.5, 4.5, 20, false);
    const b = a + Math.PI / 3;
    K.tube([Math.cos(b) * 60, 0, Math.sin(b) * 60], [Math.cos(b) * 15, 78, Math.sin(b) * 15], 3.5, 3.5, 14, false);
  }
  // podium
  K.color(0.42, 0.47, 0.50).material(0.25, 0.3, 0, 0.8);
  K.lathe([[0, 16.5], [30, 16], [52, 12], [60, 6], [61, 0]], 48);
  // the spheres
  pink();
  K.sphere(0, 93, 0, 25, 36, 20);
  K.sphere(0, 272, 0, 22.5, 36, 20);
  for (let k = 0; k < 5; k++) K.sphere(0, 136 + k * 21.5, 0, 6.2, 18, 10);
  K.sphere(0, 342, 0, 7.5, 20, 12);
  // night: bands of light around the spheres
  K.color(1.0, 0.35, 0.75).material(0.3, 0, -5.0);
  for (const [y, r] of [[93, 25.25], [272, 22.75]]) K.lathe([[r, y - 0.9], [r, y + 0.9]], 48);
  K.color(0.7, 0.8, 1.0).material(0.3, 0, -3.0);
  K.lathe([[23.2, 262.5], [23.2, 263.5]], 48); K.lathe([[25.6, 84.5], [25.6, 85.5]], 48);
  // decks and the spire
  conc();
  K.lathe([[5, 286], [10, 290], [10, 296], [7, 300], [7, 334]], 24);
  K.lathe([[5.5, 349], [5.5, 356], [3, 360], [3, 384], [2.2, 386], [2.2, 410], [1.2, 412], [1.2, 440], [0.5, 442], [0.4, 468]], 12);
  K.color(0.75, 0.12, 0.10).material(0.5, 0.3);
  K.lathe([[2.3, 392], [2.3, 400]], 12); K.lathe([[1.3, 420], [1.3, 428]], 12);
  K.color(1.0, 0.1, 0.05).material(0.3, 0, -8.0); K.sphere(0, 468.4, 0, 0.6, 8, 6);
}

// ---- the Bund: roof-top features added to the real footprints
function customsTower(K, h) {
  K.color(0.52, 0.49, 0.44).material(0.7, 0);
  K.box(0, 31, 0, 12, 62, 12);
  K.box(0, 68, 0, 11, 12, 11);
  K.color(0.90, 0.88, 0.80).material(0.4, 0, 0.0);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(dx, dz)).setPosition(dx * 5.56, 68, dz * 5.56);
    K.transform(m).color(0.92, 0.90, 0.82).material(0.4, 0, -1.6); K.lathe([[0.01, 0], [2.9, 0.02]], 28);
  }
  K.transform(null).color(0.52, 0.49, 0.44).material(0.7, 0);
  K.box(0, 76, 0, 9, 4, 9); K.box(0, 80, 0, 6.5, 4, 6.5); K.box(0, 83.5, 0, 4, 3, 4);
  K.color(0.3, 0.3, 0.3).material(0.5, 0.6); K.tube([0, 85, 0], [0, 92, 0], 0.12, 0.06, 6);
}
function hsbcDome(K) {
  K.color(0.55, 0.52, 0.47).material(0.7, 0);
  K.lathe([[11.5, 0], [11.5, 6.5], [11.0, 7.2]], 32);
  K.color(0.36, 0.40, 0.38).material(0.45, 0.4);
  const prof = []; for (let j = 0; j <= 12; j++) { const t = j / 12 * Math.PI / 2; prof.push([Math.cos(t) * 10.6, 7.2 + Math.sin(t) * 9.5]); }
  K.lathe(prof, 36);
  K.color(0.55, 0.52, 0.47).material(0.7, 0); K.lathe([[1.6, 16.5], [1.6, 19.5], [0.2, 21.5]], 12);
}
function peacePyramid(K) {
  K.color(0.50, 0.47, 0.42).material(0.7, 0);
  K.box(0, 7, 0, 19, 14, 19);
  K.color(0.16, 0.36, 0.28).material(0.5, 0.5);
  const b = 9.5, h = 19;
  const A = [0, 14 + h, 0];
  const c = [[-b, 14, b], [b, 14, b], [b, 14, -b], [-b, 14, -b]];
  for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; K.quad(p, q, A, A); }
  K.color(1.0, 0.9, 0.6).material(0.3, 0, -3.0); K.box(0, 14.3, 0, 19.3, 0.5, 19.3);
}
function chineseRoof(K, w, d) {
  K.color(0.14, 0.26, 0.30).material(0.5, 0.3);
  const hx = w / 2 + 1.2, hz = d / 2 + 1.2, y0 = 0, y1 = 5.5, r = Math.min(hx, hz) * 0.25;
  const e = [[-hx, y0, hz], [hx, y0, hz], [hx, y0, -hz], [-hx, y0, -hz]], t = [[-r, y1, r], [r, y1, r], [r, y1, -r], [-r, y1, -r]];
  for (let k = 0; k < 4; k++) K.quad(e[k], e[(k + 1) % 4], t[(k + 1) % 4], t[k]);
  K.quad(t[0], t[1], t[2], t[3]);
}

// ---- the Huangpu bridges. Local frame: x along the bridge from the middle of the river, y up, z across the deck.
// The decks themselves come from the road data (decks at the given level over the whole length built here); this adds
// what carries them: the edge girders, towers and stay cables, or the arch with its hangers.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrmz = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** A box girder swept along `pts`: at each point a rectangle spanned by the half vectors U[i] and V[i]. */
function sweep(K, pts, U, V, caps = true) {
  const ring = (i) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [pts[i][0] + U[i][0] * s + V[i][0] * t, pts[i][1] + U[i][1] * s + V[i][1] * t, pts[i][2] + U[i][2] * s + V[i][2] * t]);
  let a = ring(0);
  const T0 = sub(pts[1], pts[0]), c0 = crs(U[0], V[0]);
  const flip = c0[0] * T0[0] + c0[1] * T0[1] + c0[2] * T0[2] > 0;
  if (caps) { if (flip) K.quad(a[0], a[3], a[2], a[1]); else K.quad(a[0], a[1], a[2], a[3]); }
  for (let i = 1; i < pts.length; i++) {
    const b = ring(i);
    for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; if (flip) K.quad(a[k], a[j], b[j], b[k]); else K.quad(a[j], a[k], b[k], b[j]); }
    a = b;
  }
  if (caps) { if (flip) K.quad(a[0], a[1], a[2], a[3]); else K.quad(a[0], a[3], a[2], a[1]); }
}
/** An upright member with a rectangular section (sx along the bridge, sz across) that may lean and taper. */
function post(K, A, B, sx, sz, sx1 = sx, sz1 = sz) { sweep(K, [A, B], [[sx / 2, 0, 0], [sx1 / 2, 0, 0]], [[0, 0, sz / 2], [0, 0, sz1 / 2]]); }

// (negative emission = lit at night only: towers and arch are floodlit, the stays carry strings of lamps, the girder stays dim)
const CONC = (K, night = 0.3) => K.color(0.54, 0.535, 0.515).material(0.82, 0, -night);
const GIRDER = (K) => K.color(0.33, 0.325, 0.315).material(0.85, 0, -0.03);
const STEEL = (K, night = 0.32) => K.color(0.80, 0.81, 0.82).material(0.5, 0, -night);
const CABLE = (K) => K.color(0.78, 0.78, 0.76).material(0.45, 0, -0.55);
const BEACON = (K, x, y, z) => { K.color(1.0, 0.1, 0.05).material(0.3, 0, -8.0); K.sphere(x, y, z, 0.8, 8, 6); };

/** Roadway outline at x along the bridge: [centre across, half width] (b.prof, every 20 m). */
function outlineAt(b, x) {
  const P = b.prof;
  if (!P || !P.length) return [0, b.edge];
  if (x <= P[0][0]) return [P[0][1], P[0][2]];
  for (let k = 1; k < P.length; k++) if (x <= P[k][0]) { const t = (x - P[k - 1][0]) / (P[k][0] - P[k - 1][0] || 1); return [P[k - 1][1] + (P[k][1] - P[k - 1][1]) * t, P[k - 1][2] + (P[k][2] - P[k - 1][2]) * t]; }
  return [P[P.length - 1][1], P[P.length - 1][2]];
}
/** The girder under the roadway from x0 to x1: follows the outline, `out` wider on each side, top at y. */
function girder(K, b, x0, x1, y, out = 1.6, depth = 2.7) {
  const pts = [], U = [], V = [];
  const n = Math.max(2, Math.round((x1 - x0) / 20));
  for (let k = 0; k <= n; k++) { const x = x0 + (x1 - x0) * k / n; const [zc, hw] = outlineAt(b, x); pts.push([x, y - depth / 2, zc]); U.push([0, 0, hw + out]); V.push([0, depth / 2, 0]); }
  sweep(K, pts, U, V);
}

function sidePier(K, x, D, E, zc = 0) {
  GIRDER(K);
  const zp = E * 0.55;
  for (const sg of [-1, 1]) post(K, [x, 0, zc + sg * zp], [x, D - 4.6, zc + sg * zp], 3.2, 3.6);
  K.box(x, D - 3.8, zc, 3.8, 2.2, zp * 2 + 6.5);
}

function cableStayed(K, b, feet) {
  const S = b.span, Ls = b.side, D = b.deck, H = b.tower;
  const single = b.kind === 'cable_1';
  const x0 = -S / 2 - Ls, x1 = single ? S / 2 : S / 2 + Ls;
  // the girder: wider than the carriageways, the stays are anchored along its edges
  GIRDER(K);
  girder(K, b, x0, x1, D - 0.25);
  if (b.double) {
    girder(K, b, x0, x1, D - 10.25, 0.6);
    // the truss between the two decks
    STEEL(K, 0.05);
    const n = Math.round((x1 - x0) / 15.75), dx = (x1 - x0) / n;
    for (const sg of [-1, 1]) for (let k = 0; k < n; k++) {
      const xa = x0 + k * dx, [zc, hw] = outlineAt(b, xa + dx / 2), z = zc + sg * (hw + 0.2);
      K.tube([xa, D - 10.2, z], [xa + dx / 2, D - 2.9, z], 0.42, 0.42, 6, false);
      K.tube([xa + dx / 2, D - 2.9, z], [xa + dx, D - 10.2, z], 0.42, 0.42, 6, false);
    }
  }
  const Dl = b.double ? D - 10 : D;                 // lowest deck: the cross beam goes under it
  const yLow = D + 0.5 * (H - D), yTop = 0.965 * H;
  const towers = single ? [[-S / 2, 1]] : [[-S / 2, 1], [S / 2, -1]];
  for (const [xt, sg] of towers) {
    const [zc, hwT] = outlineAt(b, xt);
    const E = hwT + 1.6;
    const at = new THREE.Matrix4().makeTranslation(0, 0, zc);
    K.transform(at);
    CONC(K);
    let zAt;                                         // where a stay lands on the tower: distance from the centre plane at height y
    if (b.kind === 'cable_y') {
      // inverted Y: the legs close under the deck too (a diamond), join two thirds up, one mast above
      const yj = 0.66 * H, zb = E * 0.5, zd = E + 3.4;
      for (const q of [-1, 1]) {
        sweep(K, [[xt, 0, q * zb], [xt, Dl - 6, q * zd], [xt, D + 4, q * zd], [xt, yj, q * 2.4]],
          [[4.2, 0, 0], [3.8, 0, 0], [3.6, 0, 0], [3.2, 0, 0]], [[0, 0, 3.2], [0, 0, 2.6], [0, 0, 2.5], [0, 0, 2.4]]);
        feet.push([xt, zc + q * zb, 6.5]);
      }
      post(K, [xt, yj - 4, 0], [xt, H, 0], 6.4, 9.6, 5.0, 5.2);
      K.box(xt, Dl - 6.2, 0, 5.2, 4.2, 2 * zd);
      zAt = () => 1.5;
      BEACON(K, xt, H + 0.6, 0);
    } else if (b.kind === 'cable_a') {
      // A: two straight legs from wide feet to a common head
      const zb = E + 9, yh = 0.9 * H;
      const zl = (y) => zb + (2.6 - zb) * Math.min(1, y / yh);
      for (const q of [-1, 1]) {
        sweep(K, [[xt, 0, q * zb], [xt, yh, q * 2.6]], [[4.6, 0, 0], [3.0, 0, 0]], [[0, 0, 3.6], [0, 0, 2.4]]);
        feet.push([xt, zc + q * zb, 7]);
      }
      post(K, [xt, yh - 3, 0], [xt, H, 0], 6.0, 10.0, 4.6, 6.0);
      K.box(xt, Dl - 6.2, 0, 5.0, 4.2, 2 * zl(Dl - 6.2));
      K.box(xt, 0.6 * H, 0, 4.2, 4.0, 2 * zl(0.6 * H));
      zAt = (y) => Math.max(1.6, zl(y));
      BEACON(K, xt, H + 0.6, 0);
    } else {
      // H: the legs lean in above the deck as far as the upper cross beam, then stand upright
      const zb = E + 5.8, zd = E + 3.4, zt = Math.max(8, E * 0.62), yc = 0.7 * H;
      const zl = (y) => y < D ? zb + (zd - zb) * y / D : y < yc ? zd + (zt - zd) * (y - D) / (yc - D) : zt;
      for (const q of [-1, 1]) {
        sweep(K, [[xt, 0, q * zb], [xt, D, q * zd], [xt, yc, q * zt], [xt, H, q * zt]],
          [[4.0, 0, 0], [3.5, 0, 0], [3.0, 0, 0], [2.5, 0, 0]], [[0, 0, 2.8], [0, 0, 2.4], [0, 0, 2.0], [0, 0, 1.8]]);
        feet.push([xt, zc + q * zb, 6]);
        BEACON(K, xt, H + 0.6, q * zt);
        CONC(K);
      }
      K.box(xt, Dl - 6.2, 0, 5.4, 4.4, 2 * zl(Dl - 6.2));
      K.box(xt, yc, 0, 4.6, 5.5, 2 * zt);
      if (H > 180) K.box(xt, H - 9, 0, 4.0, 4.0, 2 * zt);
      zAt = (y) => zl(y);
    }
    K.transform(null);
    // the stays: two planes, a fan on each side of the tower
    CABLE(K);
    const a0 = 22;
    for (const [dir, len] of [[sg, single ? S - 14 : S / 2 - 5], [-sg, Ls - 6]]) {
      const n = Math.max(6, Math.round((len - a0) / 9.2));
      for (let k = 0; k < n; k++) {
        const x = xt + dir * (a0 + (len - a0) * k / (n - 1));
        const y = yLow + (yTop - yLow) * k / (n - 1);
        const [zd, hw] = outlineAt(b, x);
        for (const q of [-1, 1]) K.tube([x, D - 0.5, zd + q * (hw + 0.9)], [xt, y, zc + q * zAt(y)], 0.16, 0.16, 5, false);
      }
    }
    // the piers of the side span
    for (const xp of [xt - sg * Ls, xt - sg * Ls * 0.55]) { const [zp, hp] = outlineAt(b, xp); sidePier(K, xp, Dl, hp + 1.6, zp); }
  }
  if (single) { const [zp, hp] = outlineAt(b, x1); sidePier(K, x1, Dl, hp + 1.6, zp); }
}

function archBridge(K, b, feet) {
  const S = b.span, Ls = b.side, D = b.deck, Hc = b.tower;
  const E = Math.max(...(b.prof || [[0, 0, b.edge]]).map((p) => Math.abs(p[1]) + p[2])) + 1.6;     // the ribs clear the widest point of the roadway
  const y0 = 5, zb = E + 12.5;
  const ya = (x) => y0 + (Hc - y0) * (1 - (2 * x / S) * (2 * x / S));
  const za = (y) => zb - (y - y0) / 5;                 // the ribs lean towards each other, 1 in 5
  GIRDER(K);
  girder(K, b, -S / 2 - Ls, S / 2 + Ls, D - 0.25);
  // abutment piers under the springings, end piers of the side spans
  for (const sg of [-1, 1]) { K.box(sg * S / 2, 4, 0, 26, 12, 2 * zb + 12); feet.push([sg * S / 2, 0, zb + 8]); sidePier(K, sg * (S / 2 + Ls), D, E); GIRDER(K); }
  STEEL(K);
  for (const q of [-1, 1]) {
    // main rib
    const pts = [], U = [], V = [];
    const N = 44;
    for (let i = 0; i <= N; i++) {
      const x = -S / 2 + S * i / N, y = ya(x);
      pts.push([x, y, q * za(y)]);
    }
    for (let i = 0; i <= N; i++) {
      const T = nrmz(sub(pts[Math.min(N, i + 1)], pts[Math.max(0, i - 1)]));
      const lat = nrmz([0, q * 0.196, 0.98]);            // across, in the leaning plane's normal direction
      const dep = nrmz(crs(T, lat));
      const d = 3.0 + 1.6 * Math.abs(2 * i / N - 1);       // deeper towards the springings
      U.push([lat[0] * 2.5, lat[1] * 2.5, lat[2] * 2.5]); V.push([dep[0] * d, dep[1] * d, dep[2] * d]);
    }
    sweep(K, pts, U, V);
    // side-span ribs: from the springing up to the deck at the end pier
    for (const sg of [-1, 1]) {
      const sp = [], sU = [], sV = [];
      const M = 10;
      for (let i = 0; i <= M; i++) { const u = i / M; const y = y0 + (D - 4 - y0) * (1 - (1 - u) * (1 - u)); sp.push([sg * (S / 2 + Ls * u), y, q * za(y)]); }
      for (let i = 0; i <= M; i++) {
        const T = nrmz(sub(sp[Math.min(M, i + 1)], sp[Math.max(0, i - 1)]));
        const lat = nrmz([0, q * 0.196, 0.98]); const dep = nrmz(crs(T, lat));
        sU.push([lat[0] * 2.3, lat[1] * 2.3, lat[2] * 2.3]); sV.push([dep[0] * 2.6, dep[1] * 2.6, dep[2] * 2.6]);
      }
      sweep(K, sp, sU, sV);
    }
  }
  // wind bracing between the ribs, clear of the traffic
  for (let x = 0; x <= S / 2; x += 27) for (const sg of x === 0 ? [1] : [-1, 1]) {
    const y = ya(sg * x);
    if (y < D + 11) continue;
    const z = za(y) - 1.5;
    K.box(sg * x, y, 0, 3.0, 2.6, 2 * z);
  }
  // hangers where the ribs are above the deck, columns where they are below
  for (let x = 6.75; x < S / 2; x += 13.5) for (const sg of [-1, 1]) {
    const y = ya(sg * x);
    for (const q of [-1, 1]) {
      const [zd, hw] = outlineAt(b, sg * x);
      if (y > D + 4) { CABLE(K); K.tube([sg * x, D - 0.5, zd + q * (hw + 0.9)], [sg * x, y - 2.5, q * za(y)], 0.14, 0.14, 5, false); }
      else if (y < D - 6 && Math.round((x - 6.75) / 13.5) % 2 === 0) { STEEL(K); post(K, [sg * x, y + 2, q * za(y)], [sg * x, D - 2.9, zd + q * (hw - 0.4)], 2.2, 2.2); }
    }
  }
  STEEL(K);
  BEACON(K, 0, Hc + 4, za(Hc)); BEACON(K, 0, Hc + 4, -za(Hc));
}

export class Landmarks {
  constructor({ scenes, env, city, collision }) { this.scenes = scenes; this.env = env; this.city = city; this.collision = collision; this.labels = []; }

  async load() {
    const L = await fetchJSON('landmarks.json');
    const kitMat = kitMaterial(this.env, { flood: [2.6, 2.0, 1.3] }), dep = depthMaterial();
    const bridgeMat = kitMaterial(this.env);            // no blanket floodlight: the parts carry their own night level
    const addKit = (K, x, y, z, rotY = 0, mat = kitMat) => {
      const geo = K.geometry();
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = rotY; m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
      const s = new THREE.Mesh(geo, dep); s.position.copy(m.position); s.rotation.y = rotY; s.matrixAutoUpdate = false; s.updateMatrix(); s.updateMatrixWorld(true); s.layers.enable(1);
      this.scenes.opaque.add(m); this.scenes.shadow.add(s);
    };
    const addTower = (B, x, z) => {
      const res = B.finish();
      const o = this.city._mesh(res, { x, z });
      this.city._show(o);
    };
    const cols = { xz: [], start: [], count: [], base: [], top: [] };
    const collide = (x, z, r, top, n = 12) => { cols.start.push(cols.xz.length / 2); cols.count.push(n); cols.base.push(0); cols.top.push(top); for (let k = 0; k < n; k++) cols.xz.push(x + Math.cos(-k / n * TAU) * r, z + Math.sin(-k / n * TAU) * r); };
    if (L.tower) { const B = new MeshBuilder(); shanghaiTower(B); addTower(B, L.tower.x, L.tower.z); collide(L.tower.x, L.tower.z, 44, 580); this.labels.push({ name: '上海中心', x: L.tower.x, y: 640, z: L.tower.z }); }
    if (L.swfc) { const B = new MeshBuilder(); swfc(B, L.swfc.angle + Math.PI / 4 * 0); addTower(B, L.swfc.x, L.swfc.z); collide(L.swfc.x, L.swfc.z, 40, 492, 4); this.labels.push({ name: '环球金融中心', x: L.swfc.x, y: 500, z: L.swfc.z }); }
    if (L.jinmao) { const B = new MeshBuilder(), K = new Kit(); jinMao(B, K, L.jinmao.angle); addTower(B, L.jinmao.x, L.jinmao.z); addKit(K, L.jinmao.x, 0, L.jinmao.z); collide(L.jinmao.x, L.jinmao.z, 36, 372, 8); this.labels.push({ name: '金茂大厦', x: L.jinmao.x, y: 428, z: L.jinmao.z }); }
    if (L.pearl) { const K = new Kit(); orientalPearl(K); addKit(K, L.pearl.x, 0, L.pearl.z); collide(L.pearl.x, L.pearl.z, 17, 286); this.labels.push({ name: '东方明珠', x: L.pearl.x, y: 476, z: L.pearl.z }); }
    // the Bund: the long axis of each footprint runs along the waterfront; features sit towards the river (east)
    const onRoof = (P, fn, off = 0, roofY = null) => { const K = new Kit(); fn(K, P); const a = P.angle; const ex = Math.cos(a), ez = -Math.sin(a); addKit(K, P.x + ex * off, roofY ?? P.h, P.z + ez * off, a); };
    if (L.customs) onRoof(L.customs, (K) => customsTower(K), 0, 0);
    if (L.hsbc) onRoof(L.hsbc, (K) => hsbcDome(K), 0, L.hsbc.h);
    if (L.peace) { const P = L.peace; const east = Math.cos(P.angle) >= 0 ? 1 : -1; onRoof(P, (K) => peacePyramid(K), east * (P.w / 2 - 12), P.h); }
    if (L.bankofchina) onRoof(L.bankofchina, (K, P) => chineseRoof(K, P.w, P.d), 0, L.bankofchina.h);
    for (const b of L.bridges || []) {
      const K = new Kit(), feet = [];
      if (b.kind === 'arch') archBridge(K, b, feet); else if (b.kind === 'girder') girderBridge(K, b, outlineAt); else cableStayed(K, b, feet);
      addKit(K, b.x, 0, b.z, Math.atan2(-b.uz, b.ux), bridgeMat);
      // local (x along, z across) -> world: across = up x along
      for (const [lx, lz, r] of feet) collide(b.x + b.ux * lx - b.uz * lz, b.z + b.uz * lx + b.ux * lz, r, 30, 8);
      this.labels.push({ name: b.name, x: b.x, y: (b.kind === 'arch' ? b.tower : b.tower * 0.6) + 30, z: b.z });
    }
    // gardens, temples and the other single buildings (heroes.js)
    const rect = (x, z, ang, hx, hz, top) => { cols.start.push(cols.xz.length / 2); cols.count.push(4); cols.base.push(0); cols.top.push(top); const c = Math.cos(ang), sn = Math.sin(ang);
      for (const [lx, lz] of [[hx, hz], [hx, -hz], [-hx, -hz], [-hx, hz]]) cols.xz.push(x + lx * c + lz * sn, z - lx * sn + lz * c); };
    try { buildHeroes(L, { addKit, circle: collide, rect, hallMat: kitMaterial(this.env, { flood: [0.9, 0.7, 0.4], side: THREE.DoubleSide }) }); } catch (e) { console.error('heroes failed', e); }
    if (cols.start.length) this.collision.addTile('landmarks', { xz: new Float32Array(cols.xz), start: new Uint32Array(cols.start), count: new Uint16Array(cols.count), base: new Float32Array(cols.base), top: new Float32Array(cols.top) });
  }
}
