// Procedural Chongqing tree models:
//   - Species 0 & 12: 重庆市树 黄葛树 (Ficus virens) — wide spreading gnarled banyan-style canopy, buttressed roots!
//   - Subtropical camphor (香樟), golden ginkgo (银杏), metasequoia (水杉), willow (垂柳), magnolia (玉兰),
//     mountain cypress/cedar (柏树), osmanthus (桂花), mountain bamboo (翠竹), palm (棕榈), blossom (红梅/樱花).
//   - Every trunk extends 0.9 m below y=0 (root skirt) so trees standing on steep 35° Chongqing cliffs never float!

export const SPECIES = [
  { name: 'huangge',     H: 14.5, R: 7.4, cb: 0.25, limbs: 6, elev: [24, 48], card: 0, cardSize: 1.95, fill: 210, bark: 1, tint: [0.68, 0.84, 0.58], form: 'banyan', flat: 0.68 },
  { name: 'camphor',     H: 11.5, R: 5.5, cb: 0.27, limbs: 5, elev: [34, 58], card: 1, cardSize: 1.55, fill: 205, bark: 1, tint: [0.72, 0.88, 0.68], form: 'broad',  flat: 0.88 },
  { name: 'ginkgo',      H: 13.0, R: 3.6, cb: 0.24, limbs: 6, elev: [54, 72], card: 2, cardSize: 1.35, fill: 145, bark: 1, tint: [0.88, 0.84, 0.44], form: 'broad',  flat: 1.22 },
  { name: 'metasequoia', H: 21.0, R: 3.4, cb: 0.14, limbs: 0, elev: [10, 25], card: 3, cardSize: 1.90, fill: 0,   bark: 1, tint: [0.92, 0.94, 0.78], form: 'cone',   power: 0.9 },
  { name: 'willow',      H: 10.5, R: 5.2, cb: 0.30, limbs: 5, elev: [40, 62], card: 4, cardSize: 2.35, fill: 75,  bark: 1, tint: [0.85, 0.96, 0.74], form: 'weeping', flat: 0.8 },
  { name: 'magnolia',    H: 8.5,  R: 3.2, cb: 0.26, limbs: 5, elev: [45, 68], card: 5, cardSize: 1.40, fill: 115, bark: 0, tint: [0.88, 0.96, 0.82], form: 'broad',  flat: 1.08 },
  { name: 'cypress',     H: 15.0, R: 4.8, cb: 0.10, limbs: 0, elev: [-6, 14], card: 7, cardSize: 2.15, fill: 0,   bark: 1, tint: [0.70, 0.86, 0.64], form: 'cone',   power: 1.22 },
  { name: 'osmanthus',   H: 4.8,  R: 2.6, cb: 0.20, limbs: 5, elev: [38, 62], card: 6, cardSize: 1.05, fill: 135, bark: 1, tint: [0.78, 0.92, 0.72], form: 'broad',  flat: 0.95 },
  { name: 'poplar',      H: 19.0, R: 2.8, cb: 0.18, limbs: 7, elev: [60, 78], card: 1, cardSize: 1.50, fill: 150, bark: 0, tint: [0.96, 1.04, 0.76], form: 'broad',  flat: 2.4 },
  { name: 'bamboo',      H: 8.5,  R: 2.2, cb: 0.12, limbs: 6, elev: [68, 84], card: 4, cardSize: 1.55, fill: 105, bark: 0, tint: [0.76, 1.04, 0.62], form: 'broad',  flat: 1.75 },
  { name: 'palm',        H: 6.5,  R: 2.6, cb: 0.24, limbs: 5, elev: [36, 62], card: 6, cardSize: 1.15, fill: 110, bark: 1, tint: [0.84, 0.95, 0.74], form: 'broad',  flat: 0.95 },
  { name: 'blossom',     H: 5.5,  R: 3.2, cb: 0.28, limbs: 5, elev: [30, 55], card: 6, cardSize: 1.15, fill: 115, bark: 1, tint: [1.45, 0.95, 0.56], form: 'broad',  flat: 0.8 },
  { name: 'evergreen',   H: 11.0, R: 5.4, cb: 0.26, limbs: 5, elev: [32, 56], card: 6, cardSize: 1.65, fill: 185, bark: 1, tint: [0.74, 0.88, 0.64], form: 'banyan', flat: 0.78 },
];

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class G {
  constructor() { this.p = []; this.n = []; this.uv = []; this.q = []; this.i = []; this.nv = 0; }
  v(x, y, z, nx, ny, nz, u, v, a, b, c, d) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.q.push(a, b, c, d); return this.nv++; }
  tube(A, B, r0, r1, sides, v0, v1, sway0, sway1) {
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1; d[0] /= L; d[1] /= L; d[2] /= L;
    let ux = Math.abs(d[1]) < 0.95 ? 0 : 1, uy = Math.abs(d[1]) < 0.95 ? 1 : 0, uz = 0;
    let ax = uy * d[2] - uz * d[1], ay = uz * d[0] - ux * d[2], az = ux * d[1] - uy * d[0];
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const bx = d[1] * az - d[2] * ay, by = d[2] * ax - d[0] * az, bz = d[0] * ay - d[1] * ax;
    const base = this.nv;
    for (let k = 0; k <= sides; k++) {
      const t = k / sides * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      const nx = ax * c + bx * s, ny = ay * c + by * s, nz = az * c + bz * s;
      const uu = k / sides * Math.max(1, Math.round(r0 * 6.28 / 0.8)) * 0.8;
      this.v(A[0] + nx * r0, A[1] + ny * r0, A[2] + nz * r0, nx, ny, nz, uu, v0, 0, sway0, 1, 0);
      this.v(B[0] + nx * r1, B[1] + ny * r1, B[2] + nz * r1, nx, ny, nz, uu, v1, 0, sway1, 1, 0);
    }
    for (let k = 0; k < sides; k++) { const a = base + k * 2; this.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  card(C, X, Y, out, cell, light, sway, phase) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const base = this.nv;
    let nx = X[1] * Y[2] - X[2] * Y[1], ny = X[2] * Y[0] - X[0] * Y[2], nz = X[0] * Y[1] - X[1] * Y[0];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const [a, b] of corners) {
      const px = C[0] + X[0] * a + Y[0] * b, py = C[1] + X[1] * a + Y[1] * b, pz = C[2] + X[2] * a + Y[2] * b;
      let mx = out[0] * 0.75 + nx * 0.25 + (X[0] * a + Y[0] * b) * 0.12;
      let my = out[1] * 0.75 + ny * 0.25 + (X[1] * a + Y[1] * b) * 0.12;
      let mz = out[2] * 0.75 + nz * 0.25 + (X[2] * a + Y[2] * b) * 0.12;
      const ml = Math.hypot(mx, my, mz) || 1;
      this.v(px, py, pz, mx / ml, my / ml, mz / ml, a * 0.5 + 0.5, b * 0.5 + 0.5, 1, sway, light, cell + phase / 16);
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function generateTree(spId, seed = 1, quality = 1) {
  const sp = SPECIES[spId] || SPECIES[0];
  const R = rng(seed * 7919 + spId * 104729 + 13);
  const g = new G();
  const H = sp.H, CR = sp.R, cbH = sp.cb * H;
  const tr = (sp.form === 'banyan' ? 0.029 : 0.020) * H + 0.08;
  const sides = quality >= 1 ? 8 : 5;
  const crownC = [0, cbH + (H - cbH) * 0.54, 0];
  const cv = (H - cbH) * 0.5;
  const outDir = (P) => norm([(P[0] - crownC[0]) / CR, (P[1] - crownC[1]) / cv * 0.9, (P[2] - crownC[2]) / CR]);
  const lightAt = (P) => { const e = Math.hypot(P[0] / CR, (P[1] - crownC[1]) / cv, P[2] / CR); return Math.min(1, 0.25 + 0.8 * e * e); };
  const cs = sp.cardSize * (quality >= 1 ? 1 : 1.5);
  const addCluster = (P, n, size, sw) => {
    const o = outDir(P);
    for (let k = 0; k < n; k++) {
      let t = norm(cross(o, [R() - 0.5, R() - 0.5, R() - 0.5]));
      let b = cross(o, t);
      const tilt = (R() - 0.5) * 1.3;
      const X = [t[0] * size, t[1] * size, t[2] * size];
      const Y = [(b[0] * Math.cos(tilt) + o[0] * Math.sin(tilt)) * size, (b[1] * Math.cos(tilt) + o[1] * Math.sin(tilt)) * size, (b[2] * Math.cos(tilt) + o[2] * Math.sin(tilt)) * size];
      const C = [P[0] + (R() - 0.5) * size * 0.9, P[1] + (R() - 0.5) * size * 0.7, P[2] + (R() - 0.5) * size * 0.9];
      g.card(C, X, Y, o, sp.card, lightAt(C), sw, Math.floor(R() * 16));
    }
  };

  if (sp.form === 'cone') {
    // Subterranean root anchor (-0.9m) prevents floating on steep Chongqing cliffs
    g.tube([0, -0.9, 0], [0, 0, 0], tr * 1.35, tr, sides, -0.9, 0, 0, 0);
    const segs = 5;
    for (let s = 0; s < segs; s++) {
      const y0 = H * s / segs, y1 = H * (s + 1) / segs;
      g.tube([0, y0, 0], [0, y1, 0], tr * (1 - 0.9 * s / segs), tr * (1 - 0.9 * (s + 1) / segs), sides, y0, y1, s / segs * 0.3, (s + 1) / segs * 0.3);
    }
    const whorls = Math.round((H - cbH) / (quality >= 1 ? 1.25 : 2.0));
    for (let w = 0; w < whorls; w++) {
      const f = (w + 0.5) / whorls;
      const y = cbH + (H - cbH) * f;
      const rad = CR * Math.pow(1 - f, sp.power) + 0.35;
      const nb = quality >= 1 ? 6 : 4;
      const a0 = R() * 6.28;
      for (let k = 0; k < nb; k++) {
        const a = a0 + k / nb * 6.28 + (R() - 0.5) * 0.4;
        const el = (sp.elev[0] + R() * (sp.elev[1] - sp.elev[0])) * Math.PI / 180 * (1 - f * 0.3);
        const dir = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
        const E = [dir[0] * rad, y + dir[1] * rad, dir[2] * rad];
        if (quality >= 1 && rad > 1.2) g.tube([0, y, 0], E, tr * (1 - f) * 0.28 + 0.02, 0.015, 4, 0, rad, 0.3, 0.9);
        const side = norm(cross(dir, [0, 1, 0]));
        const n = Math.max(1, Math.round(rad / (cs * 0.75)));
        for (let j = 0; j < n; j++) {
          const t = (j + 0.6) / n;
          const C = [dir[0] * rad * t, y + dir[1] * rad * t - 0.15 * t * rad * (sp.name === 'cypress' ? 1 : 0.3), dir[2] * rad * t];
          const sz = cs * (0.55 + 0.25 * (1 - f));
          const o = norm([dir[0], 0.6, dir[2]]);
          g.card(C, [side[0] * sz, side[1] * sz, side[2] * sz], [dir[0] * sz, dir[1] * sz - 0.12 * sz, dir[2] * sz], o, sp.card, Math.min(1, 0.35 + 0.65 * t), 0.5 + 0.5 * t, Math.floor(R() * 16));
        }
      }
    }
    addCluster([0, H - 0.6, 0], 2, cs * 0.5, 1);
  } else {
    const lean = [(R() - 0.5) * 0.08, 1, (R() - 0.5) * 0.08];
    const top = [lean[0] * cbH, cbH, lean[2] * cbH];
    // Root anchor extending -0.9m below origin so hillside trees never hover
    g.tube([0, -0.9, 0], [0, 0, 0], tr * 1.65, tr * 1.28, sides, -0.9, 0, 0, 0);
    g.tube([0, 0, 0], [top[0] * 0.5, cbH * 0.5, top[2] * 0.5], tr * 1.28, tr * 0.96, sides, 0, cbH * 0.5, 0, 0.05);
    g.tube([top[0] * 0.5, cbH * 0.5, top[2] * 0.5], top, tr * 0.96, tr * 0.85, sides, cbH * 0.5, cbH, 0.05, 0.12);
    // Huangge (Ficus virens) buttress roots & aerial prop roots gripping cliff/soil!
    if (sp.form === 'banyan' && quality >= 1) {
      for (let b = 0; b < 5; b++) {
        const ba = b * (6.28318 / 5) + R() * 0.4;
        g.tube([Math.cos(ba) * tr * 2.1, -0.8, Math.sin(ba) * tr * 2.1], [Math.cos(ba) * tr * 0.5, cbH * 0.55, Math.sin(ba) * tr * 0.5], tr * 0.36, tr * 0.18, 4, 0, 2, 0, 0.04);
      }
    }
    const nl = sp.limbs;
    const a0 = R() * 6.28;
    const tips = [];
    for (let k = 0; k < nl; k++) {
      const a = a0 + k / nl * 6.28 + (R() - 0.5) * 0.5;
      const el = (sp.elev[0] + R() * (sp.elev[1] - sp.elev[0])) * Math.PI / 180;
      const horiz = CR * (0.64 + 0.30 * R());
      const rise = Math.min(H - cbH - 0.8, horiz * Math.tan(el) * sp.flat);
      const E = [top[0] + Math.cos(a) * horiz, cbH + rise, top[2] + Math.sin(a) * horiz];
      const M = [top[0] + (E[0] - top[0]) * 0.46, cbH + rise * (sp.form === 'banyan' ? 0.52 : 0.62), top[2] + (E[2] - top[2]) * 0.46];
      const r0 = tr * 0.64, r1 = tr * 0.36, r2 = tr * 0.13;
      g.tube(top, M, r0, r1, quality >= 1 ? 6 : 4, 0, 2, 0.12, 0.4);
      g.tube(M, E, r1, r2, quality >= 1 ? 6 : 4, 2, 4, 0.4, 0.85);
      // Hanging aerial root from Huangge main limb
      if (sp.form === 'banyan' && quality >= 1 && k % 2 === 0) {
        g.tube([M[0], M[1], M[2]], [M[0] * 0.92, Math.max(0.4, M[1] - 2.6), M[2] * 0.92], 0.035, 0.015, 4, 0, 2, 0.4, 0.6);
      }
      tips.push(E);
      const nsb = quality >= 1 ? 3 : 1;
      for (let s = 0; s < nsb; s++) {
        const f = 0.35 + 0.5 * (s + R()) / nsb;
        const P = f < 0.45
          ? [top[0] + (M[0] - top[0]) * f / 0.45, top[1] + (M[1] - top[1]) * f / 0.45, top[2] + (M[2] - top[2]) * f / 0.45]
          : [M[0] + (E[0] - M[0]) * (f - 0.45) / 0.55, M[1] + (E[1] - M[1]) * (f - 0.45) / 0.55, M[2] + (E[2] - M[2]) * (f - 0.45) / 0.55];
        const a2 = a + (R() - 0.5) * 2.2;
        const len = CR * (0.35 + 0.3 * R());
        const E2 = [P[0] + Math.cos(a2) * len, Math.min(H - 0.6, P[1] + len * (0.3 + 0.7 * R()) * sp.flat), P[2] + Math.sin(a2) * len];
        g.tube(P, E2, r1 * 0.55, 0.02, 4, 0, 2, 0.5, 0.95);
        tips.push(E2);
      }
    }
    if (sp.flat > 1.05) { const E = [top[0], H - 0.8, top[2]]; g.tube(top, E, tr * 0.7, 0.03, quality >= 1 ? 6 : 4, cbH, H, 0.12, 0.8); tips.push(E); }
    if (sp.form === 'weeping') {
      const n = Math.round(quality >= 1 ? 46 : 22);
      for (let k = 0; k < n; k++) {
        const a = k / n * 6.28 + R() * 0.3;
        const rr = CR * (0.55 + 0.45 * R());
        const yTop = cbH + (H - cbH) * (0.55 + 0.4 * (1 - rr / CR) + 0.1 * R());
        const len = Math.min(yTop - 1.6, 3.0 + 3.0 * R());
        const C = [Math.cos(a) * rr, yTop - len * 0.5, Math.sin(a) * rr];
        const t = [-Math.sin(a + (R() - 0.5)), 0, Math.cos(a + (R() - 0.5))];
        const o = norm([Math.cos(a), 0.3, Math.sin(a)]);
        g.card(C, [t[0] * cs * 0.55, 0, t[2] * cs * 0.55], [0, -len * 0.5, 0], o, sp.card, 0.9, 1.0, Math.floor(R() * 16));
      }
      for (const E of tips) addCluster(E, 2, cs * 0.5, 0.9);
      const nf = Math.round(sp.fill * quality);
      for (let k = 0; k < nf; k++) {
        const a = R() * 6.28, e = Math.acos(1 - R() * 0.8), rr = 0.7 + 0.25 * R();
        addCluster([Math.cos(a) * Math.sin(e) * CR * rr, crownC[1] + Math.cos(e) * cv * rr, Math.sin(a) * Math.sin(e) * CR * rr], 1, cs * 0.5, 0.9);
      }
    } else {
      for (const E of tips) addCluster(E, quality >= 1 ? 3 : 2, cs * 0.55, 0.95);
      const nf = Math.round(sp.fill * (quality >= 1 ? 1 : 0.45));
      for (let k = 0; k < nf; k++) {
        const a = R() * 6.28, cz = 1 - 2 * R(), e = Math.acos(cz * 0.96);
        const rr = k % 4 === 0 ? 0.45 + 0.3 * R() : 0.8 + 0.2 * R();
        let y = crownC[1] + Math.cos(e) * cv * rr;
        if (y < cbH + 0.4) y = cbH + 0.4 + R() * 0.8;
        addCluster([Math.cos(a) * Math.sin(e) * CR * rr, y, Math.sin(a) * Math.sin(e) * CR * rr], 1, cs * (0.5 + 0.2 * R()), 0.75 + 0.25 * rr);
      }
    }
  }
  return { position: new Float32Array(g.p), normal: new Float32Array(g.n), uv: new Float32Array(g.uv), param: new Float32Array(g.q), index: new Uint32Array(g.i), H, R: CR, tris: g.i.length / 3 };
}
