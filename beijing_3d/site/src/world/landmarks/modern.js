// Contemporary towers: the CBD icons and the broadcast tower.
import { Kit, MAT } from '../landmarkKit.js';

// small vector helpers (points are [x, y, z] in the landmark frame)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rnd = (a, b, c) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };

// Keep the part of the 2D segment a-b that lies inside a convex polygon, staying `margin` away from its edges.
function clipSegment(poly, a, b, margin = 0) {
  let area = 0;
  for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; }
  const sgn = area >= 0 ? 1 : -1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = sgn * (ex * dy - ey * dx);
    const num = sgn * (ex * (a[1] - p[1]) - ey * (a[0] - p[0])) - margin * Math.hypot(ex, ey);
    if (Math.abs(den) < 1e-9) { if (num < 0) return null; continue; }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  if (t1 - t0 < 1e-3) return null;
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

// CITIC Tower "China Zun" (528 m): a rounded square that pinches in at the waist like the ritual zun vessel.
function zun(kit, L) {
  kit.at(L.zun, () => {
    const H = 528;
    const width = (t) => (t < 0.72 ? 54 + 24 * Math.pow(1 - t / 0.72, 1.7) : 54 + 15 * Math.pow((t - 0.72) / 0.28, 1.6));
    const rings = [];
    for (let i = 0; i <= 26; i++) { const t = i / 26; const w = width(t); rings.push({ y: t * (H - 14), pts: Kit.roundRect(w, w, w * 0.2, 5) }); }
    kit.paint('#7d98ad', MAT.glass, { p0: 4.4, p1: 0.42 });
    kit.loft(rings, { capTop: true });
    // crown: an open lantern that glows at night
    const wt = width(1);
    kit.paint('#f2e6c8', MAT.glow, { p0: 2.2 });
    kit.loft([{ y: H - 14, pts: Kit.roundRect(wt - 3, wt - 3, wt * 0.2, 5) }, { y: H, pts: Kit.roundRect(wt - 1.5, wt - 1.5, wt * 0.2, 5) }], { capTop: true });
    // stone podium
    kit.paint('#b9b4aa', MAT.matte);
    kit.prism(Kit.roundRect(96, 92, 10, 4), 0, 9);
    kit.mark('中国尊', H + 30, { rank: 1 });
  });
}

// CCTV Headquarters (234 m): one continuous tube folded into a loop. Two towers stand on opposite corners of a
// 160 m square (tower 1 north-west, tower 2 south-east, from the OSM building parts) and lean 6 degrees inwards
// in both directions; an L-shaped base joins their feet around the north-east corner, and an L-shaped overhang
// joins their heads around the south-west corner, 162 m up. Every outer facade lies on one of the four faces of
// a pyramid frustum, the roof is a single plane square to tower 1's axis (234 m down to about 210 m at tower 2).
function cctv(kit, L) {
  kit.at(L.cctv, () => {
    const t = Math.tan(6 * Math.PI / 180);
    // metres from the footprint centre: x east, n north
    const W0 = -79.5, E0 = 79.4, S0 = -84.0, N0 = 84.0;       // ground outline (OSM r7820447)
    const A1 = 35.1, B1 = 64, A2 = 50, B2 = 35.5;             // tower sections: 1 = east-west x north-south, likewise 2
    const H1 = 234, HU = 162, HB = 46.5;                      // top of tower 1, underside of the overhang, roof of the base
    const BN = 26.4, BE = 26.1;                               // inner faces of the base (edges of the courtyard in OSM)
    // facade planes as [c, s]: coordinate = c + s * height
    const west = [W0, t], east = [E0, -t], south = [S0, t], north = [N0, -t];
    const t1e = [W0 + A1, t], t1s = [N0 - B1, -t];            // inner faces of tower 1
    const t2w = [E0 - A2, -t], t2n = [S0 + B2, t];            // inner faces of tower 2
    const yardN = [BN, 0], yardE = [BE, 0];
    const xr = W0 + t * H1, nr = N0 - t * H1;                 // where the roof plane reaches 234 m
    const roofAt = (px, pn) => (H1 - t * (px[0] - xr) + t * (pn[0] - nr)) / (1 + t * (px[1] - pn[1]));
    const pt = (px, pn, h) => [px[0] + px[1] * h, h, -(pn[0] + pn[1] * h)];

    // A block bounded by four facade planes, a level floor and either a level top or the roof plane.
    const facades = [];
    const block = (xw, xe, ns, nn, h0, h1, sides, caps) => {
      const corners = [[xw, ns], [xe, ns], [xe, nn], [xw, nn]];             // SW, SE, NE, NW
      const lo = corners.map(([px, pn]) => pt(px, pn, h0));
      const hi = corners.map(([px, pn]) => pt(px, pn, h1 ?? roofAt(px, pn)));
      for (let i = 0; i < 4; i++) {
        if (!sides.includes('senw'[i])) continue;
        const j = (i + 1) % 4;
        const quad = [lo[i], lo[j], hi[j], hi[i]];
        kit.paint('#4a4f57', MAT.glass, { p0: 4.2, p1: 0.3 });
        kit.face(quad, quad.map((p) => [i % 2 ? p[2] : p[0], p[1]]));
        facades.push([quad, i]);
      }
      if (caps.includes('t')) { kit.paint('#3a3d42', MAT.matte); kit.face(hi); }
      if (caps.includes('b')) { kit.paint('#34373c', MAT.metal); kit.face([lo[3], lo[2], lo[1], lo[0]]); }
    };
    block(west, t1e, t1s, north, 0, null, 'senw', 't');        // tower 1
    block(t2w, east, south, t2n, 0, null, 'senw', 't');        // tower 2
    block(west, t1e, south, t1s, HU, null, 'sew', 'tb');       // overhang, west arm (67 m beyond tower 1)
    block(t1e, t2w, south, t2n, HU, null, 'sn', 'tb');         // overhang, south arm (75 m beyond tower 2)
    block(t1e, east, yardN, north, 0, HB, 'sen', 't');         // base, north wing
    block(yardE, east, t2n, yardN, 0, HB, 'ew', 't');          // base, east wing

    // The irregular diagrid: a diamond lattice of braces that thins out where the tube is lightly loaded and
    // doubles around the "armpits" where towers meet overhang and base.
    const armpits = [pt(t1e, t1s, HU), pt(t2w, t2n, HU), pt(t1e, yardN, HB), pt(yardE, t2n, HB)];
    const stress = (p) => Math.max(...armpits.map((j) => Math.exp(-((p[0] - j[0]) ** 2 + (p[1] - j[1]) ** 2 + (p[2] - j[2]) ** 2) / 3200)));
    const DU = 11.7, DV = 17;
    kit.paint('#2b2e33', MAT.metal);
    for (const [quad, side] of facades) {
      const N = unit(cross(sub(quad[1], quad[0]), sub(quad[3], quad[0])));     // outward
      const Uh = unit(cross(N, [0, 1, 0]));                                    // level direction in the facade
      const Vp = cross(Uh, N);
      const Vs = Vp.map((c) => c / Vp[1]);                                     // up the facade, per metre of height
      const q = quad[0].map((c, k) => c - quad[0][1] * Vs[k]);
      const d = dot(q, Uh);
      const O = q.map((c, k) => c - d * Uh[k]);                                // lattice origin: shared by coplanar facades
      const P3 = (u, v, off = 0.3) => [O[0] + u * Uh[0] + v * Vs[0] + off * N[0], O[1] + u * Uh[1] + v * Vs[1] + off * N[1], O[2] + u * Uh[2] + v * Vs[2] + off * N[2]];
      const poly = quad.map((p) => [dot(p, Uh), p[1]]);
      const strip = (a, b, w) => {
        const c = clipSegment(poly, a, b, 0.7);
        if (!c) return;
        const A = P3(c[0][0], c[0][1]), B = P3(c[1][0], c[1][1]);
        const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
        if (len < 1.5) return;
        const S = cross(N, unit(sub(B, A))).map((x) => x * w / 2);
        kit.face([sub(A, S), sub(B, S), [B[0] + S[0], B[1] + S[1], B[2] + S[2]], [A[0] + S[0], A[1] + S[1], A[2] + S[2]]], [[0, 0], [len, 0], [len, w], [0, w]]);
      };
      const us = poly.map((p) => p[0]), vs = poly.map((p) => p[1]);
      for (let i = Math.floor(Math.min(...us) / DU); i <= Math.floor(Math.max(...us) / DU); i++) {
        for (let j = Math.floor(Math.min(...vs) / DV); j <= Math.floor(Math.max(...vs) / DV); j++) {
          const u0 = i * DU, v0 = j * DV, u1 = u0 + DU, v1 = v0 + DV, um = u0 + DU / 2, vm = v0 + DV / 2;
          const s = stress(P3(um, vm, 0));
          const keep = 0.56 + 0.5 * s;
          if (rnd(i, j, side * 7 + 1) < keep) strip([u0, v0], [u1, v1], 1.1);
          if (rnd(i, j, side * 7 + 2) < keep) strip([u1, v0], [u0, v1], 1.1);
          if (s > 0.42) {
            strip([um, v0], [u1, vm], 0.8); strip([u0, vm], [um, v1], 0.8);
            strip([um, v0], [u0, vm], 0.8); strip([u1, vm], [um, v1], 0.8);
          }
        }
      }
    }
    kit.mark('央视总部', H1 + 18, { rank: 1 });
  }, { angle: 0 });
}

// China World Trade Center phase 3: square glass shafts with a slight entasis and a set-back lantern crown.
function tradeTower(kit, lm, { H, sx, sz, crown, tint, name, rank }) {
  kit.at(lm, () => {
    const Lx = 2 * lm.hl, Wz = 2 * lm.hw;
    // podium: stone plinth, two glazed storeys, a stone cornice
    kit.paint('#bdb7ab', MAT.matte);
    kit.prism(Kit.roundRect(Lx + 9, Wz + 9, 2.5, 3), 0, 1.3, { top: false });
    kit.paint('#7f8f9a', MAT.glass, { p0: 4.9, p1: 0.75 });
    kit.prism(Kit.roundRect(Lx + 8, Wz + 8, 2.5, 3), 1.3, 11.1, { top: false });
    kit.paint('#c4beb2', MAT.matte);
    kit.prism(Kit.roundRect(Lx + 10, Wz + 10, 3, 3), 11.1, 12.8, { bottom: true });
    // shaft: widest a fifth of the way up, drawn in gently towards the crown
    const yb = H - crown;
    const profile = [[0, 0.962], [0.05, 0.981], [0.12, 0.995], [0.2, 1], [0.45, 0.996], [0.65, 0.985], [0.82, 0.966], [0.93, 0.944], [1, 0.925]];
    const ring = (y, s) => ({ y, pts: Kit.roundRect(Lx * sx * s, Wz * sz * s, 3.4 * s, 4) });
    kit.paint(tint, MAT.glass, { p0: 4.25, p1: 0.38 });
    kit.loft(profile.map(([f, s]) => ring(12.8 + f * (yb - 12.8), s)), { capTop: true });
    // crown: a narrower glass lantern, lit from within at night
    kit.paint('#a9bccb', MAT.glass, { p0: 4.25, p1: 0.92 });
    kit.loft([ring(yb, 0.872), ring(H - 1.6, 0.855)], { capTop: false });
    kit.paint('#f1ecdc', MAT.glow, { p0: 1.8 });
    kit.loft([ring(H - 1.6, 0.86), ring(H, 0.86)], { capTop: true });
    kit.mark(name, H + 22, { rank });
  });
}

function guomao3a(kit, L) {
  tradeTower(kit, L.guomao3a, { H: 330, sx: 0.93, sz: 0.985, crown: 27, tint: '#8ca2b5', name: '国贸三期', rank: 2 });
}

function guomao3b(kit, L) {
  tradeTower(kit, L.guomao3b, { H: 296, sx: 0.80, sz: 0.83, crown: 22, tint: '#8497aa', name: '国贸三期B', rank: 3 });
}

// Central Radio & TV Tower (405 m): round base building, flared concrete shaft, the lantern-like head with its
// decks between 221 and 238 m, then the upper shaft and the banded antenna mast.
function tvtower(kit, L) {
  kit.at(L.tvtower, () => {
    const STONE = '#d0ccc2', CONCRETE = '#c7c3b9', DECK = '#dcd9d0', WINDOW = '#6f8596';
    const band = (r, y0, y1, seg = 48, caps = {}) => kit.lathe([[r, y0], [r, y1]], { seg, ...caps });
    // base building, 71 m across: two set-back glazed storeys under stone cornices
    kit.paint(STONE, MAT.matte); band(35.6, 0, 1.4);
    kit.paint(WINDOW, MAT.glass, { p0: 4.6, p1: 0.6 }); band(34.9, 1.4, 6);
    kit.paint(STONE, MAT.matte); band(36.2, 6, 7.2, 48, { capTop: true, capBottom: true });
    kit.paint(WINDOW, MAT.glass, { p0: 4.6, p1: 0.6 }); band(28.6, 7.2, 11.8);
    kit.paint(STONE, MAT.matte); band(29.8, 11.8, 13, 48, { capTop: true, capBottom: true });
    // shaft: 40 m across where it leaves the base, 12 m under the head
    const shaftR = (y) => 6 + 10.8 * Math.exp(-(y - 13) / 26) + 3.2 * (1 - (y - 13) / 192);
    kit.paint(CONCRETE, MAT.matte, { flood: 0.3 });
    kit.lathe([13, 18, 24, 31, 39, 48, 58, 70, 85, 105, 130, 160, 190, 205].map((y) => [shaftR(y), y]), { seg: 40 });
    // head: flaring underside, two glazed decks (revolving restaurant 221 m, observation hall), open-air deck at 238 m
    kit.paint(DECK, MAT.metal);
    kit.lathe([[6, 203], [8.2, 208], [12.2, 213.5], [16.6, 218], [19.6, 221]], { seg: 48 });
    kit.paint('#8f7f5c', MAT.glass, { p0: 2.6, p1: 0.85 }); band(19.6, 221, 226.2);
    kit.paint(DECK, MAT.metal); band(20.6, 226.2, 227.4, 48, { capTop: true, capBottom: true });
    kit.paint('#8f7f5c', MAT.glass, { p0: 2.6, p1: 0.85 }); band(19.6, 227.4, 232.6);
    kit.paint(DECK, MAT.metal); band(20.6, 232.6, 233.8, 48, { capTop: true, capBottom: true });
    kit.lathe([[19.3, 233.8], [18.2, 238]], { seg: 48, capTop: true });
    band(18.2, 238, 239.3);
    kit.paint(WINDOW, MAT.glass, { p0: 4, p1: 0.7 }); band(12.2, 238, 242);
    kit.paint(DECK, MAT.metal);
    kit.lathe([[13.4, 242], [11.6, 243.7], [8.2, 245.3], [4.6, 246.2]], { seg: 48, capBottom: true });
    kit.paint('#ffd9a0', MAT.glow, { p0: 2.2 });
    band(20.75, 226.5, 227.1); band(20.75, 232.9, 233.5); band(18.35, 238.6, 239.1);
    // upper shaft with its dish platforms
    kit.paint(CONCRETE, MAT.matte, { flood: 0.3 });
    kit.lathe([[4.6, 246.2], [4.0, 292]], { seg: 24 });
    kit.paint(DECK, MAT.metal);
    for (const y of [256, 266.5, 277]) band(6.6, y, y + 1.2, 24, { capTop: true, capBottom: true });
    // antenna mast: five steps, red and white bands
    const steps = [[292, 3.0], [318, 2.3], [345, 1.6], [370, 1.0], [388, 0.5]];
    const n = 12, dy = (405 - 292) / n;
    for (let b = 0; b < n; b++) {
      const y0 = 292 + b * dy;
      const r = steps.filter((s) => s[0] <= y0 + 0.01).pop()[1];
      kit.paint(b % 2 ? '#f1eee8' : '#c9342c', MAT.matte, { flood: 0.25 });
      band(r, y0, y0 + dy, 12, { capTop: true });
    }
    kit.mark('中央电视塔', 405 + 22, { rank: 1 });
  });
}

export const LANDMARKS = { zun, cctv, guomao3a, guomao3b, tvtower };
