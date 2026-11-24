// Vehicle models (Kit geometry; +x forward, y up, origin on the road under the middle of the vehicle).
// Car bodies are lofted: a side profile (bonnet, windscreen, roof, rear window, boot) swept across the width, with the
// cabin narrowing towards the roof and the corners rounded in plan. White paint takes the instance colour.
// Every model comes in two levels of detail; lamps are emissive once the city lights are on (when `lit`).

import { Kit } from './kit.js';

const PAINT = (k) => k.color(1, 1, 1).material(0.30, 0.3, 0, 0.6);
const GLASS = (k) => k.color(0.030, 0.038, 0.046).material(0.05, 0, 0, 0.9);
const TRIM = (k) => k.color(0.035, 0.035, 0.038).material(0.6, 0);
const TYRE = (k) => k.color(0.022, 0.022, 0.025).material(0.9, 0);
// (the simplified models are seen from afar, where a lamp is smaller than a pixel: theirs burn brighter so that the
// streams of white and red lights along the roads survive the distance)
const HEAD = (k, lit, lod) => k.color(1.0, 0.96, 0.86).material(0.2, 0, lit ? (lod ? -60 : -16) : 0.0001, 0.8);
const TAIL = (k, lit, lod) => k.color(0.85, 0.05, 0.04).material(0.25, 0, lit ? (lod ? -34 : -8) : 0.0001, 0.6);

function quadN(k, P, N) {
  const i = k.nv;
  for (let q = 0; q < 4; q++) k.v(P[q][0], P[q][1], P[q][2], N[q][0], N[q][1], N[q][2]);
  k.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

function wheels(k, xs, hw, r, lod, wide = 0.24) {
  for (const x of xs) for (const sg of [1, -1]) {
    TYRE(k); k.tube([x, r, sg * (hw - wide)], [x, r, sg * (hw + 0.012)], r, r, lod ? 7 : 16, true);
    if (!lod) { k.color(0.50, 0.51, 0.53).material(0.3, 0.9); k.tube([x, r, sg * (hw + 0.012)], [x, r, sg * (hw + 0.02)], r * 0.62, r * 0.62, 10, true); }
  }
}

/** Lofted car. P: L, W, H, cab: [rear glass foot, roof start, roof end, windscreen foot], deck: boot / bonnet heights [rear, front]. */
export function carGeometry(P = {}, lit = false, lod = 0) {
  const { L = 4.7, W = 1.82, H = 1.46, cab = [-1.62, -1.0, 0.32, 1.02], deck = [1.02, 0.86], taxi = false, wheelR = 0.33, plate = [0.10, 0.22, 0.62] } = P;
  const k = new Kit();
  const hl = L / 2, hw = W / 2, floor = 0.20, belt = Math.min(0.94, H * 0.64);
  // stations from the tail to the nose: [x, top height, cabin?]
  const st = lod
    ? [[-hl, deck[0] - 0.12, 0], [cab[0], deck[0], 0], [cab[1], H, 1], [cab[2], H - 0.02, 1], [cab[3], deck[1] + 0.10, 0], [hl, deck[1] - 0.14, 0]]
    : [[-hl, deck[0] - 0.22, 0], [-hl + 0.10, deck[0] - 0.04, 0], [(cab[0] - hl) / 2, deck[0], 0], [cab[0], deck[0] + 0.01, 0], [cab[1], H - 0.01, 1], [(cab[1] + cab[2]) / 2, H, 1], [cab[2], H - 0.02, 1],
      [cab[3], deck[1] + 0.10, 0], [(cab[3] + hl) / 2, deck[1] + 0.04, 0], [hl - 0.16, deck[1] - 0.06, 0], [hl, deck[1] - 0.24, 0]];
  const ns = st.length;
  // plan: the body narrows a little towards both ends
  const wAt = (x) => { const t = Math.max(0, (Math.abs(x) - (hl - 0.55)) / 0.55); return hw * (1 - 0.13 * t * t); };
  // cross-section rows (one side): underside edge, widest point, shoulder, roof / deck edge, crown
  const row = (x, top, cabin) => {
    const w = wAt(x), sh = Math.min(belt, top - 0.07);
    return cabin ? [[w * 0.93, floor], [w, 0.50], [w * 0.985, sh], [w * 0.80, top - 0.055], [0, top]]
      : [[w * 0.93, floor], [w, 0.50], [w * 0.985, sh], [w * 0.88, top - 0.025], [0, top + 0.012]];
  };
  const G = st.map(([x, top, cabin]) => row(x, top, cabin).map(([z, y]) => [x, y, z]));
  const nr = G[0].length;
  // smooth normals over the grid
  const Nrm = G.map((r) => r.map(() => [0, 0, 0]));
  for (let i = 0; i + 1 < ns; i++) for (let j = 0; j + 1 < nr; j++) {
    const a = G[i][j], b = G[i + 1][j], d = G[i][j + 1];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(...n) || 1;
    for (const [p, q] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) { Nrm[p][q][0] += n[0] / l; Nrm[p][q][1] += n[1] / l; Nrm[p][q][2] += n[2] / l; }
  }
  for (const r of Nrm) for (const n of r) { const l = Math.hypot(...n) || 1; n[0] /= l; n[1] /= l; n[2] /= l; }
  for (const r of Nrm) r[nr - 1][2] = 0;                                    // crown: normal stays in the mirror plane
  const cabin = (i) => st[i][2] === 1;
  for (let i = 0; i + 1 < ns; i++) for (let j = 0; j + 1 < nr; j++) {
    // glass: the side windows (shoulder -> roof edge) and the screens (roof edge -> crown where the roof line climbs or falls)
    const side = j === 2 && (cabin(i) || cabin(i + 1));
    const screen = j === 3 && cabin(i) !== cabin(i + 1);
    if (side || screen) GLASS(k); else PAINT(k);
    for (const sg of [1, -1]) {
      const f = (p, q) => [G[p][q][0], G[p][q][1], G[p][q][2] * sg], fn = (p, q) => [Nrm[p][q][0], Nrm[p][q][1], Nrm[p][q][2] * sg];
      const P4 = [f(i, j), f(i + 1, j), f(i + 1, j + 1), f(i, j + 1)], N4 = [fn(i, j), fn(i + 1, j), fn(i + 1, j + 1), fn(i, j + 1)];
      if (sg < 0) { P4.reverse(); N4.reverse(); }
      quadN(k, P4, N4);
    }
  }
  // end faces and underside
  for (const [i, nx] of [[0, -1], [ns - 1, 1]]) {
    PAINT(k);
    const r = G[i];
    for (let j = 0; j + 1 < nr; j++) {
      const a = [r[j][0], r[j][1], r[j][2]], b = [r[j + 1][0], r[j + 1][1], r[j + 1][2]], c = [b[0], b[1], -b[2]], d = [a[0], a[1], -a[2]];
      if (nx > 0) k.quad(a, d, c, b); else k.quad(d, a, b, c);
    }
  }
  TRIM(k); k.quad([-hl, floor, -hw * 0.93], [hl, floor, -hw * 0.93], [hl, floor, hw * 0.93], [-hl, floor, hw * 0.93]);
  // pillars, mirrors, bumpers' dark insets, plates
  if (!lod) {
    PAINT(k);
    const xb = (cab[1] + cab[2]) / 2 - 0.12, top = H - 0.06;
    for (const sg of [1, -1]) { k.box(xb, (belt + top) / 2, sg * hw * 0.895, 0.10, top - belt, 0.035); k.box(cab[3] - 0.22, belt + 0.07, sg * (hw + 0.09), 0.10, 0.11, 0.20); }
    TRIM(k); k.box(hl - 0.005, 0.40, 0, 0.03, 0.22, W * 0.62); k.box(-hl + 0.005, 0.36, 0, 0.03, 0.16, W * 0.7);
    k.color(...plate).material(0.5, 0); k.box(hl + 0.012, 0.44, 0, 0.012, 0.13, 0.44); k.box(-hl - 0.012, 0.62, 0, 0.012, 0.13, 0.44);
  }
  wheels(k, [hl - 0.86, -hl + 0.84], hw, wheelR, lod);
  const yl = deck[1] - 0.30, yt = deck[0] - 0.22;
  for (const sg of [1, -1]) {
    HEAD(k, lit, lod); k.box(hl + 0.002, yl + 0.065, sg * hw * 0.66, 0.014, 0.13, hw * 0.32);
    TAIL(k, lit, lod); k.box(-hl - 0.002, yt + 0.065, sg * hw * 0.66, 0.014, 0.13, hw * 0.36);
  }
  if (taxi) { k.color(0.95, 0.9, 0.5).material(0.4, 0, lit ? -2.5 : 0.0001); k.box(-0.25, H + 0.07, 0, 0.30, 0.13, 0.52); }
  return k.geometry();
}

export const CAR = {
  sedan: {},
  suv: { L: 4.72, W: 1.90, H: 1.70, cab: [-2.30, -2.02, 0.28, 1.02], deck: [1.18, 0.98], wheelR: 0.37 },
  mpv: { L: 5.15, W: 1.88, H: 1.78, cab: [-2.52, -2.28, 0.72, 1.62], deck: [1.20, 0.98], wheelR: 0.35 },
  hatch: { L: 4.05, W: 1.74, H: 1.52, cab: [-1.98, -1.62, 0.10, 0.82], deck: [1.10, 0.88], wheelR: 0.31, plate: [0.16, 0.50, 0.30] },
};

/** City bus, 12 m: livery skirt (instance colour), glazed band with pillars, white roof with the air-conditioning pack, route sign. */
export function busGeometry(lit = false, lod = 0) {
  const k = new Kit();
  const L = 12.0, hl = L / 2, hw = 1.27, yb = 0.34, yw0 = 1.22, yw1 = 2.52, H = 3.06;
  PAINT(k); k.box(0, (yb + yw0) / 2, 0, L, yw0 - yb, hw * 2);
  k.color(0.86, 0.87, 0.86).material(0.35, 0.2, 0, 0.6); k.box(0, (yw1 + H) / 2, 0, L, H - yw1, hw * 2);
  GLASS(k); k.box(0, (yw0 + yw1) / 2, 0, L - 0.04, yw1 - yw0, hw * 2 - 0.03);
  if (!lod) {
    // window pillars, doors, roof pack, mirrors
    k.color(0.86, 0.87, 0.86).material(0.35, 0.2, 0, 0.6);
    for (let x = -hl + 0.9; x < hl - 1.0; x += 1.48) for (const sg of [1, -1]) k.box(x, (yw0 + yw1) / 2, sg * hw, 0.10, yw1 - yw0, 0.03);
    k.box(-hl + 0.06, (yw0 + yw1) / 2, 0, 0.14, yw1 - yw0, hw * 2);                                         // solid tail above the engine
    TRIM(k);
    for (const x of [hl - 1.25, -0.6]) k.box(x, (yb + yw1) / 2, hw + 0.006, 1.10, yw1 - yb - 0.1, 0.02);     // doors (kerb side, +z)
    k.color(0.70, 0.71, 0.72).material(0.5, 0.3); k.box(-1.2, H + 0.13, 0, 3.6, 0.26, 1.7);
    TRIM(k); for (const sg of [1, -1]) k.box(hl + 0.10, 2.25, sg * (hw + 0.16), 0.08, 0.34, 0.16);
    k.color(0.10, 0.22, 0.62).material(0.5, 0); k.box(-hl - 0.012, 0.85, 0, 0.012, 0.14, 0.46);
  }
  // route sign over the windscreen, lit amber at night
  k.color(1.0, 0.62, 0.12).material(0.4, 0, lit ? -3.5 : 0.0001); k.quad([hl + 0.008, 2.60, 0.85], [hl + 0.008, 2.60, -0.85], [hl + 0.008, 2.86, -0.85], [hl + 0.008, 2.86, 0.85]);
  wheels(k, [hl - 2.45, -hl + 3.0], hw, 0.49, lod, 0.32);
  for (const sg of [1, -1]) {
    HEAD(k, lit, lod); k.box(hl + 0.004, 0.71, sg * hw * 0.73, 0.014, 0.18, hw * 0.30);
    TAIL(k, lit, lod); k.box(-hl - 0.004, 1.07, sg * hw * 0.75, 0.014, 0.25, hw * 0.30);
  }
  return k.geometry();
}

/** Light box lorry, 6 m: cab in the instance colour, pale box. */
export function lorryGeometry(lit = false, lod = 0) {
  const k = new Kit();
  const L = 6.0, hl = L / 2, hw = 1.05;
  PAINT(k); k.box(hl - 0.85, 1.20, 0, 1.7, 1.55, hw * 2 - 0.1);
  GLASS(k); k.box(hl - 0.42, 1.62, 0, 0.88, 0.62, hw * 2 - 0.08); k.box(hl - 0.9, 1.62, 0, 1.2, 0.5, hw * 2 - 0.085);
  k.color(0.80, 0.81, 0.80).material(0.6, 0.1); k.box(-0.86, 1.82, 0, 4.2, 2.3, hw * 2 + 0.1);
  TRIM(k); k.box(0, 0.52, 0, L - 0.3, 0.26, hw * 1.5);
  if (!lod) { k.color(0.10, 0.22, 0.62).material(0.5, 0); k.box(-hl - 0.012, 0.52, 0, 0.012, 0.13, 0.44); TRIM(k); for (const sg of [1, -1]) k.box(hl - 0.2, 1.75, sg * (hw + 0.12), 0.07, 0.26, 0.14); }
  wheels(k, [hl - 1.0, -hl + 1.25], hw, 0.40, lod, 0.30);
  for (const sg of [1, -1]) {
    HEAD(k, lit, lod); k.box(hl + 0.002, 0.74, sg * hw * 0.71, 0.014, 0.16, hw * 0.30);
    TAIL(k, lit, lod); k.box(-hl - 0.002, 0.70, sg * hw * 0.78, 0.014, 0.16, hw * 0.33);
  }
  return k.geometry();
}

export const CAR_COLORS = [[0.82, 0.82, 0.80], [0.82, 0.82, 0.80], [0.82, 0.82, 0.80], [0.03, 0.03, 0.035], [0.03, 0.03, 0.035], [0.32, 0.33, 0.35], [0.32, 0.33, 0.35], [0.55, 0.56, 0.58],
  [0.10, 0.14, 0.30], [0.42, 0.04, 0.04], [0.12, 0.10, 0.09], [0.60, 0.58, 0.50]];
export const TAXI_COLORS = [[0.05, 0.42, 0.44], [0.75, 0.56, 0.06], [0.10, 0.22, 0.52], [0.80, 0.80, 0.78], [0.05, 0.42, 0.44]];
export const BUS_COLORS = [[0.14, 0.33, 0.62], [0.16, 0.46, 0.30], [0.14, 0.33, 0.62], [0.62, 0.20, 0.12], [0.16, 0.46, 0.30]];
export const LORRY_COLORS = [[0.80, 0.80, 0.78], [0.10, 0.22, 0.52], [0.75, 0.56, 0.06], [0.42, 0.04, 0.04]];

// kinds: 0 sedan, 1 SUV, 2 MPV, 3 hatchback, 4 taxi, 5 bus, 6 lorry
export const KINDS = [
  { name: 'sedan', len: 4.7, wid: 1.82, make: (lit, lod) => carGeometry(CAR.sedan, lit, lod), colors: CAR_COLORS },
  { name: 'suv', len: 4.72, wid: 1.90, make: (lit, lod) => carGeometry(CAR.suv, lit, lod), colors: CAR_COLORS },
  { name: 'mpv', len: 5.15, wid: 1.88, make: (lit, lod) => carGeometry(CAR.mpv, lit, lod), colors: CAR_COLORS },
  { name: 'hatch', len: 4.05, wid: 1.74, make: (lit, lod) => carGeometry(CAR.hatch, lit, lod), colors: CAR_COLORS },
  { name: 'taxi', len: 4.7, wid: 1.82, make: (lit, lod) => carGeometry({ taxi: true }, lit, lod), colors: TAXI_COLORS },
  { name: 'bus', len: 12.0, wid: 2.55, make: (lit, lod) => busGeometry(lit, lod), colors: BUS_COLORS },
  { name: 'lorry', len: 6.0, wid: 2.2, make: (lit, lod) => lorryGeometry(lit, lod), colors: LORRY_COLORS },
];
