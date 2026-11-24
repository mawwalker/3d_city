// Sculpted multi-part realistic vehicles for Chongqing 3D (Phase 3 Photorealism):
//   - Iconic bright CHONGQING YELLOW-GREEN TAXIS ("黄色法拉利") with dark forest-green lower doors, white pinstripe & glowing roof TAXI crown!
//   - Sculpted sedans, SUVs, MPVs, hatchbacks with contoured front grilles, chrome trim, multi-element LED headlights + DRLs,
//     wrap-around LED taillights, A/B/C pillars, door handles, wing mirrors, shark-fin antennas, recessed wheel wells & 5-spoke alloy rims!
//   - Detailed Chongqing urban buses (rounded nose, wipers, glowing amber LED route display, folding doors, roof HVAC pods) & box lorries.

import { Kit } from './kit.js';

const PAINT = (k) => k.color(1, 1, 1).material(0.22, 0.38, 0, 0.72);
const GLASS = (k) => k.color(0.014, 0.019, 0.026).material(0.045, 0.02, 0, 0.56);
const TRIM = (k) => k.color(0.032, 0.034, 0.038).material(0.55, 0.12);
const CHROME = (k) => k.color(0.76, 0.78, 0.80).material(0.16, 0.92, 0, 0.85);
const TYRE = (k) => k.color(0.020, 0.021, 0.024).material(0.86, 0);
const ALLOY = (k) => k.color(0.62, 0.64, 0.67).material(0.24, 0.88, 0, 0.75);
const HEAD = (k, lit, lod) => k.color(1.0, 0.97, 0.90).material(0.14, 0, lit ? (lod ? -62 : -18) : 0.0001, 0.85);
const DRL = (k, lit) => k.color(0.95, 0.98, 1.0).material(0.14, 0, lit ? -12 : -1.2, 0.85);
const TAIL = (k, lit, lod) => k.color(0.90, 0.045, 0.035).material(0.20, 0, lit ? (lod ? -36 : -9.5) : 0.0001, 0.70);
const TAXI_GREEN = (k) => k.color(0.025, 0.25, 0.14).material(0.28, 0.28, 0, 0.68);

function quadN(k, P, N) {
  const i = k.nv;
  for (let q = 0; q < 4; q++) k.v(P[q][0], P[q][1], P[q][2], N[q][0], N[q][1], N[q][2]);
  k.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

/** Multi-part wheels: recessed dark wheel well, contoured rubber tire, dark inner brake disc, 5-spoke silver alloy rim & center lug hub! */
function wheels(k, xs, hw, r, lod, wide = 0.24) {
  for (const x of xs) for (const sg of [1, -1]) {
    if (!lod) {
      // Recessed dark wheel-well arch backing behind tire
      TRIM(k);
      k.tube([x, r + 0.02, sg * (hw - wide - 0.06)], [x, r + 0.02, sg * (hw - wide + 0.01)], r * 1.12, r * 1.12, 12, true);
    }
    // Tire carcass + chamfered shoulder
    TYRE(k);
    k.tube([x, r, sg * (hw - wide)], [x, r, sg * (hw - 0.015)], r, r, lod ? 8 : 18, true);
    if (!lod) {
      k.tube([x, r, sg * (hw - 0.015)], [x, r, sg * (hw + 0.014)], r, r * 0.93, 18, true);
      // Dark inner brake rotor cavity
      TRIM(k);
      k.tube([x, r, sg * (hw + 0.004)], [x, r, sg * (hw + 0.012)], r * 0.68, r * 0.68, 12, true);
      // Silver outer alloy rim lip + center hubcap
      ALLOY(k);
      k.tube([x, r, sg * (hw + 0.011)], [x, r, sg * (hw + 0.021)], r * 0.66, r * 0.60, 14, false);
      k.tube([x, r, sg * (hw + 0.010)], [x, r, sg * (hw + 0.023)], r * 0.20, r * 0.16, 10, true);
      // 5 radial alloy wheel spokes
      for (let s = 0; s < 5; s++) {
        const a = (s / 5) * Math.PI * 2;
        const dx = Math.cos(a) * r * 0.60, dy = Math.sin(a) * r * 0.60;
        k.tube([x, r, sg * (hw + 0.016)], [x + dx, r + dy, sg * (hw + 0.016)], r * 0.065, r * 0.052, 5, false);
      }
    }
  }
}

export function carGeometry(P = {}, lit = false, lod = 0) {
  const {
    L = 4.7, W = 1.82, H = 1.46,
    cab = [-1.62, -1.0, 0.32, 1.02],
    deck = [1.02, 0.86],
    taxi = false,
    wheelR = 0.33,
    plate = [0.10, 0.24, 0.64],
  } = P;
  const k = new Kit();
  const hl = L / 2, hw = W / 2, floor = 0.19, belt = Math.min(0.94, H * 0.64);
  const st = lod
    ? [[-hl, deck[0] - 0.12, 0], [cab[0], deck[0], 0], [cab[1], H, 1], [cab[2], H - 0.02, 1], [cab[3], deck[1] + 0.10, 0], [hl, deck[1] - 0.14, 0]]
    : [
      [-hl, deck[0] - 0.24, 0],
      [-hl + 0.08, deck[0] - 0.05, 0],
      [(cab[0] - hl) * 0.5, deck[0], 0],
      [cab[0], deck[0] + 0.01, 0],
      [cab[1], H - 0.015, 1],
      [(cab[1] + cab[2]) * 0.5, H + 0.008, 1],
      [cab[2], H - 0.022, 1],
      [cab[3], deck[1] + 0.10, 0],
      [(cab[3] + hl) * 0.5, deck[1] + 0.045, 0],
      [hl - 0.16, deck[1] - 0.05, 0],
      [hl - 0.04, deck[1] - 0.16, 0],
      [hl, deck[1] - 0.28, 0],
    ];
  const ns = st.length;
  const wAt = (x) => { const t = Math.max(0, (Math.abs(x) - (hl - 0.58)) / 0.58); return hw * (1 - 0.14 * t * t); };
  const row = (x, top, cabin) => {
    const w = wAt(x), sh = Math.min(belt, top - 0.07);
    return cabin
      ? [[w * 0.92, floor], [w, 0.48], [w * 0.985, sh], [w * 0.78, top - 0.055], [0, top]]
      : [[w * 0.92, floor], [w, 0.48], [w * 0.985, sh], [w * 0.87, top - 0.025], [0, top + 0.014]];
  };
  const G = st.map(([x, top, cabin]) => row(x, top, cabin).map(([z, y]) => [x, y, z]));
  const nr = G[0].length;
  const Nrm = G.map((r) => r.map(() => [0, 0, 0]));
  for (let i = 0; i + 1 < ns; i++) for (let j = 0; j + 1 < nr; j++) {
    const a = G[i][j], b = G[i + 1][j], d = G[i][j + 1];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(...n) || 1;
    for (const [p, q] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) { Nrm[p][q][0] += n[0] / l; Nrm[p][q][1] += n[1] / l; Nrm[p][q][2] += n[2] / l; }
  }
  for (const r of Nrm) for (const n of r) { const l = Math.hypot(...n) || 1; n[0] /= l; n[1] /= l; n[2] /= l; }
  for (const r of Nrm) r[nr - 1][2] = 0;
  const cabin = (i) => st[i][2] === 1;
  for (let i = 0; i + 1 < ns; i++) for (let j = 0; j + 1 < nr; j++) {
    const side = j === 2 && (cabin(i) || cabin(i + 1));
    const screen = j === 3 && cabin(i) !== cabin(i + 1);
    if (side || screen) GLASS(k);
    else if (taxi && j === 0) TAXI_GREEN(k);
    else PAINT(k);
    for (const sg of [1, -1]) {
      const f = (p, q) => [G[p][q][0], G[p][q][1], G[p][q][2] * sg], fn = (p, q) => [Nrm[p][q][0], Nrm[p][q][1], Nrm[p][q][2] * sg];
      const P4 = [f(i, j), f(i + 1, j), f(i + 1, j + 1), f(i, j + 1)], N4 = [fn(i, j), fn(i + 1, j), fn(i + 1, j + 1), fn(i, j + 1)];
      if (sg < 0) { P4.reverse(); N4.reverse(); }
      quadN(k, P4, N4);
    }
  }
  for (const [i, nx] of [[0, -1], [ns - 1, 1]]) {
    const r = G[i];
    for (let j = 0; j + 1 < nr; j++) {
      if (taxi && j === 0) TAXI_GREEN(k); else PAINT(k);
      const a = [r[j][0], r[j][1], r[j][2]], b = [r[j + 1][0], r[j + 1][1], r[j + 1][2]], c = [b[0], b[1], -b[2]], d = [a[0], a[1], -a[2]];
      if (nx > 0) k.quad(a, d, c, b); else k.quad(d, a, b, c);
    }
  }
  TRIM(k); k.quad([-hl, floor, -hw * 0.92], [hl, floor, -hw * 0.92], [hl, floor, hw * 0.92], [-hl, floor, hw * 0.92]);

  if (!lod) {
    // Sculpted A/B/C window pillars, side beltline trim, door handles, wing mirrors on stalks, shark-fin antenna!
    const xb = (cab[1] + cab[2]) * 0.5 - 0.10, top = H - 0.055;
    for (const sg of [1, -1]) {
      // Gloss-black B-pillar + chrome beltline trim + body-colored A/C pillars
      TRIM(k);
      k.box(xb, (belt + top) * 0.5, sg * hw * 0.89, 0.11, top - belt, 0.04);
      CHROME(k);
      k.box((cab[0] + cab[3]) * 0.5, belt + 0.008, sg * (hw * 0.985), (cab[3] - cab[0]) * 0.86, 0.022, 0.022);
      // Sculpted door handles (front & rear)
      k.box(xb + 0.22, belt - 0.08, sg * (hw + 0.012), 0.16, 0.032, 0.028);
      k.box(xb - 0.58, belt - 0.08, sg * (hw + 0.012), 0.16, 0.032, 0.028);
      // Wing mirrors on sleek dark stalks
      TRIM(k);
      k.box(cab[3] - 0.24, belt + 0.04, sg * (hw + 0.04), 0.06, 0.045, 0.09);
      PAINT(k);
      k.box(cab[3] - 0.26, belt + 0.08, sg * (hw + 0.115), 0.11, 0.095, 0.16);
      // Dark lower rocker sill trim
      TRIM(k);
      k.box(0, floor + 0.04, sg * (hw * 0.965), L * 0.54, 0.075, 0.035);
      // Signature white waist pinstripe on Chongqing yellow-green taxis
      if (taxi) {
        k.color(0.94, 0.94, 0.92).material(0.32, 0.1);
        k.box(0, 0.495, sg * (hw + 0.006), L * 0.86, 0.032, 0.012);
      }
    }
    // Shark-fin roof antenna
    TRIM(k);
    k.box(cab[1] + 0.25, H + 0.045, 0, 0.16, 0.08, 0.032);

    // Front fascia: dark honeycomb grille + chrome surround slats + lower air dam + fog light bezels
    TRIM(k);
    k.box(hl - 0.01, 0.48, 0, 0.05, 0.26, W * 0.54);
    k.box(hl - 0.01, 0.25, 0, 0.05, 0.12, W * 0.68);
    CHROME(k);
    k.box(hl + 0.014, 0.56, 0, 0.014, 0.024, W * 0.50);
    k.box(hl + 0.014, 0.49, 0, 0.014, 0.020, W * 0.46);
    k.box(hl + 0.016, 0.52, 0, 0.018, 0.085, 0.095); // front grille emblem badge

    // Rear fascia: dark diffuser valance + twin chrome exhaust tips + trunk chrome strip
    TRIM(k);
    k.box(-hl + 0.01, 0.27, 0, 0.05, 0.16, W * 0.72);
    CHROME(k);
    k.box(-hl - 0.01, deck[0] - 0.14, 0, 0.012, 0.022, W * 0.56);
    for (const sg of [1, -1]) k.tube([-hl + 0.04, 0.24, sg * hw * 0.55], [-hl - 0.03, 0.24, sg * hw * 0.55], 0.042, 0.042, 8, true);

    // Crisp Chinese license plates (blue ICE / emerald-green EV)
    k.color(...plate).material(0.45, 0.08);
    k.box(hl + 0.016, 0.36, 0, 0.014, 0.14, 0.44);
    k.box(-hl - 0.016, 0.56, 0, 0.014, 0.14, 0.44);
  }

  wheels(k, [hl - 0.86, -hl + 0.84], hw, wheelR, lod);
  const yl = deck[1] - 0.28, yt = deck[0] - 0.21;
  for (const sg of [1, -1]) {
    if (!lod) {
      // Dark headlight/taillight bezel housings + white DRL eyebrow strip
      TRIM(k);
      k.box(hl - 0.008, yl + 0.065, sg * hw * 0.66, 0.032, 0.15, hw * 0.36);
      DRL(k, lit);
      k.box(hl + 0.008, yl + 0.12, sg * hw * 0.67, 0.014, 0.024, hw * 0.33);
    }
    HEAD(k, lit, lod); k.box(hl + 0.004, yl + 0.058, sg * hw * 0.66, 0.016, 0.105, hw * 0.30);
    TAIL(k, lit, lod); k.box(-hl - 0.004, yt + 0.065, sg * hw * 0.64, 0.016, 0.125, hw * 0.38);
  }
  if (!lod) {
    // Full-width subtle red LED rear reflector lightbar connecting taillights
    TAIL(k, lit, lod);
    k.box(-hl - 0.004, yt + 0.08, 0, 0.012, 0.032, W * 0.52);
  }

  if (taxi) {
    // Sculpted glowing Chongqing TAXI roof lightbox + base mount + green/red status lamp
    TRIM(k);
    k.box(-0.22, H + 0.018, 0, 0.30, 0.04, 0.58);
    k.color(0.98, 0.92, 0.60).material(0.24, 0, lit ? -5.8 : 0.0001);
    k.box(-0.22, H + 0.098, 0, 0.26, 0.135, 0.54);
    k.color(0.10, 0.96, 0.36).material(0.18, 0, lit ? -7.5 : 0.0001);
    k.box(-0.08, H + 0.098, 0.20, 0.022, 0.075, 0.11);
  }
  return k.geometry();
}

export const CAR = {
  sedan: {},
  suv: { L: 4.72, W: 1.90, H: 1.70, cab: [-2.30, -2.02, 0.28, 1.02], deck: [1.18, 0.98], wheelR: 0.37 },
  mpv: { L: 5.15, W: 1.88, H: 1.78, cab: [-2.52, -2.28, 0.72, 1.62], deck: [1.20, 0.98], wheelR: 0.35 },
  hatch: { L: 4.05, W: 1.74, H: 1.52, cab: [-1.98, -1.62, 0.10, 0.82], deck: [1.10, 0.88], wheelR: 0.31, plate: [0.16, 0.52, 0.32] },
};

export function busGeometry(lit = false, lod = 0) {
  const k = new Kit();
  const L = 11.6, hl = L / 2, hw = 1.26, yb = 0.34, yw0 = 1.22, yw1 = 2.52, H = 3.08;
  PAINT(k); k.box(0, (yb + yw0) / 2, 0, L, yw0 - yb, hw * 2);
  k.color(0.90, 0.91, 0.89).material(0.32, 0.22, 0, 0.65); k.box(0, (yw1 + H) / 2, 0, L, H - yw1, hw * 2);
  GLASS(k); k.box(0, (yw0 + yw1) / 2, 0, L - 0.04, yw1 - yw0, hw * 2 - 0.03);
  if (!lod) {
    // Crisp window pillars & dark rubber mullions
    k.color(0.88, 0.89, 0.88).material(0.32, 0.22, 0, 0.65);
    for (let x = -hl + 0.9; x < hl - 1.0; x += 1.48) for (const sg of [1, -1]) k.box(x, (yw0 + yw1) / 2, sg * hw, 0.095, yw1 - yw0, 0.032);
    k.box(-hl + 0.06, (yw0 + yw1) / 2, 0, 0.14, yw1 - yw0, hw * 2);
    // White livery waist band + lower dark bumper trim
    k.color(0.92, 0.93, 0.91).material(0.34, 0.15);
    for (const sg of [1, -1]) k.box(0, yw0 - 0.14, sg * (hw + 0.008), L - 0.2, 0.14, 0.015);
    TRIM(k);
    k.box(hl - 0.01, 0.44, 0, 0.06, 0.22, hw * 1.98);
    k.box(-hl + 0.01, 0.44, 0, 0.06, 0.22, hw * 1.98);
    // Twin passenger entry doors with glazed door leaves
    for (const x of [hl - 1.25, -0.6]) {
      TRIM(k); k.box(x, (yb + yw1) / 2, hw + 0.006, 1.14, yw1 - yb - 0.08, 0.025);
      GLASS(k); k.box(x - 0.26, (yb + yw1) / 2 + 0.12, hw + 0.015, 0.46, yw1 - yb - 0.46, 0.016);
      k.box(x + 0.26, (yb + yw1) / 2 + 0.12, hw + 0.015, 0.46, yw1 - yb - 0.46, 0.016);
    }
    // Dual sculpted roof HVAC pods + front windshield wipers + twin-arm chrome bus mirrors
    k.color(0.76, 0.77, 0.78).material(0.45, 0.25);
    k.box(-1.6, H + 0.14, 0, 3.4, 0.28, 1.72);
    k.box(2.4, H + 0.11, 0, 2.1, 0.22, 1.55);
    TRIM(k);
    for (const sg of [1, -1]) {
      k.box(hl + 0.12, 2.28, sg * (hw + 0.16), 0.08, 0.36, 0.16);
      k.tube([hl, 2.45, sg * hw], [hl + 0.12, 2.45, sg * (hw + 0.16)], 0.018, 0.018, 5, false);
      k.box(hl + 0.01, 1.38, sg * 0.48, 0.02, 0.03, 0.72); // wipers
    }
    k.color(0.10, 0.24, 0.64).material(0.45, 0);
    k.box(hl + 0.014, 0.50, 0, 0.014, 0.14, 0.46);
    k.box(-hl - 0.014, 0.82, 0, 0.014, 0.14, 0.46);
  }
  // Glowing amber LED destination route board (front + side)
  k.color(1.0, 0.64, 0.12).material(0.32, 0, lit ? -4.5 : -0.6);
  k.quad([hl + 0.010, 2.60, 0.85], [hl + 0.010, 2.60, -0.85], [hl + 0.010, 2.86, -0.85], [hl + 0.010, 2.86, 0.85]);
  wheels(k, [hl - 2.45, -hl + 3.0], hw, 0.49, lod, 0.32);
  for (const sg of [1, -1]) {
    HEAD(k, lit, lod); k.box(hl + 0.006, 0.72, sg * hw * 0.73, 0.016, 0.18, hw * 0.32);
    TAIL(k, lit, lod); k.box(-hl - 0.006, 1.07, sg * hw * 0.75, 0.016, 0.26, hw * 0.30);
  }
  return k.geometry();
}

export function lorryGeometry(lit = false, lod = 0) {
  const k = new Kit();
  const L = 6.0, hl = L / 2, hw = 1.05;
  PAINT(k); k.box(hl - 0.85, 1.20, 0, 1.72, 1.56, hw * 2 - 0.1);
  GLASS(k); k.box(hl - 0.42, 1.62, 0, 0.90, 0.64, hw * 2 - 0.08); k.box(hl - 0.9, 1.62, 0, 1.2, 0.50, hw * 2 - 0.085);
  k.color(0.82, 0.83, 0.81).material(0.55, 0.12); k.box(-0.86, 1.84, 0, 4.22, 2.32, hw * 2 + 0.1);
  TRIM(k); k.box(0, 0.52, 0, L - 0.3, 0.26, hw * 1.5);
  if (!lod) {
    // Cab grille, sun visor, vertical cargo box ribs, twin mirrors & rear safety underrun bar
    TRIM(k);
    k.box(hl + 0.01, 0.96, 0, 0.04, 0.34, hw * 1.32);
    k.box(hl - 0.02, 2.02, 0, 0.26, 0.06, hw * 1.82); // cab sun visor
    for (const sg of [1, -1]) {
      k.box(hl - 0.18, 1.75, sg * (hw + 0.14), 0.07, 0.30, 0.14);
      k.box(-0.86, 0.52, sg * (hw + 0.02), 3.2, 0.08, 0.06); // side underrun bar
    }
    k.color(0.72, 0.73, 0.72).material(0.52, 0.22);
    for (let rx = -2.65; rx <= 0.95; rx += 0.60) for (const sg of [1, -1]) k.box(rx, 1.84, sg * (hw + 0.06), 0.05, 2.24, 0.03);
    k.color(0.82, 0.12, 0.08).material(0.42, 0.1); k.box(-hl + 0.06, 0.42, 0, 0.08, 0.10, hw * 1.85);
    k.color(0.10, 0.24, 0.64).material(0.48, 0); k.box(-hl - 0.014, 0.56, 0, 0.014, 0.13, 0.44);
  }
  wheels(k, [hl - 1.0, -hl + 1.25], hw, 0.40, lod, 0.30);
  for (const sg of [1, -1]) {
    HEAD(k, lit, lod); k.box(hl + 0.004, 0.74, sg * hw * 0.71, 0.016, 0.16, hw * 0.30);
    TAIL(k, lit, lod); k.box(-hl - 0.004, 0.70, sg * hw * 0.78, 0.016, 0.16, hw * 0.33);
  }
  return k.geometry();
}

export const CAR_COLORS = [
  [0.84, 0.84, 0.82], [0.84, 0.84, 0.82], [0.84, 0.84, 0.82],
  [0.028, 0.030, 0.034], [0.028, 0.030, 0.034],
  [0.30, 0.32, 0.35], [0.30, 0.32, 0.35], [0.56, 0.58, 0.60],
  [0.09, 0.14, 0.30], [0.46, 0.04, 0.04], [0.13, 0.11, 0.10], [0.58, 0.56, 0.48],
];
export const TAXI_COLORS = [[0.94, 0.68, 0.02], [0.96, 0.72, 0.03], [0.91, 0.65, 0.02], [0.94, 0.68, 0.02]];
export const BUS_COLORS = [[0.10, 0.34, 0.66], [0.72, 0.22, 0.10], [0.12, 0.46, 0.28], [0.10, 0.34, 0.66]];
export const LORRY_COLORS = [[0.82, 0.82, 0.80], [0.10, 0.22, 0.52], [0.75, 0.56, 0.06], [0.42, 0.04, 0.04]];

export const KINDS = [
  { name: 'sedan', len: 4.7, wid: 1.82, make: (lit, lod) => carGeometry(CAR.sedan, lit, lod), colors: CAR_COLORS },
  { name: 'suv',   len: 4.72, wid: 1.90, make: (lit, lod) => carGeometry(CAR.suv, lit, lod), colors: CAR_COLORS },
  { name: 'mpv',   len: 5.15, wid: 1.88, make: (lit, lod) => carGeometry(CAR.mpv, lit, lod), colors: CAR_COLORS },
  { name: 'hatch', len: 4.05, wid: 1.74, make: (lit, lod) => carGeometry(CAR.hatch, lit, lod), colors: CAR_COLORS },
  { name: 'taxi',  len: 4.7, wid: 1.82, make: (lit, lod) => carGeometry({ taxi: true }, lit, lod), colors: TAXI_COLORS },
  { name: 'bus',   len: 11.6, wid: 2.52, make: (lit, lod) => busGeometry(lit, lod), colors: BUS_COLORS },
  { name: 'lorry', len: 6.0, wid: 2.2, make: (lit, lod) => lorryGeometry(lit, lod), colors: LORRY_COLORS },
];
