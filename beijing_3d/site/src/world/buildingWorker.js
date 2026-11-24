// Building geometry worker.
// Turns a binary tile blob (see pipeline/30_build_tiles.py) into renderable typed arrays:
//   aPos  Int16 x4  : x, y(up), z, u   — decimetres, relative to the tile's SW corner (z = -north); u = wall perimeter coordinate
//   aInfo Uint8 x4  : style, palette, seed, part
//   aH    Uint16 x2 : wall-top height above the building base (dm), base elevation (dm)
//   index Uint32
// Normals are derived in the fragment shader (flat shading), so wall vertices can be shared.

import earcut from '../../vendor/earcut/earcut.js';

// ---- shared ids (keep in sync with pipeline + buildingMaterial.js)
const ST = { generic: 0, resi: 1, office: 2, retail: 3, industrial: 4, courtyard: 5, imperial: 6, temple: 7, public: 8, bigroof: 9, canopy: 10, tank: 11, construction: 12, village: 13, special: 14, villa: 15 };
const ROOF = { flat: 0, gable: 1, hip: 2, pyramid: 3, hip2: 4, dome: 7, shed: 8, round: 9 };
const PART = { body: 0, tile: 1, stone: 2, hallwall: 3, trim: 4, mass: 5, plant: 6, pitched: 7, gold: 8, mast: 9, unit: 10, tank: 11, sign: 12 };
const U_WRAP = 25200; // dm; common multiple of all facade bay widths

class Builder {
  constructor(vcap = 4096, icap = 8192) {
    this.pos = new Int16Array(vcap * 4);
    this.info = new Uint8Array(vcap * 4);
    this.hh = new Uint16Array(vcap * 2);
    this.idx = new Uint32Array(icap);
    this.n = 0; this.ni = 0;
    this.maxY = 0; this.minX = 1e9; this.maxX = -1e9; this.minZ = 1e9; this.maxZ = -1e9;
    // current per-building meta
    this.style = 0; this.pal = 0; this.seed = 0; this.H = 0; this.base = 0;
  }
  growV(extra) {
    if ((this.n + extra) * 4 <= this.pos.length) return;
    const cap = Math.max(this.pos.length / 4 * 2, this.n + extra + 1024);
    const p = new Int16Array(cap * 4); p.set(this.pos); this.pos = p;
    const i = new Uint8Array(cap * 4); i.set(this.info); this.info = i;
    const h = new Uint16Array(cap * 2); h.set(this.hh); this.hh = h;
  }
  growI(extra) {
    if (this.ni + extra <= this.idx.length) return;
    const cap = Math.max(this.idx.length * 2, this.ni + extra + 2048);
    const a = new Uint32Array(cap); a.set(this.idx); this.idx = a;
  }
  // x, yN in tile-local data space (dm, x east, yN north); y up (dm)
  v(x, y, yN, u, part) {
    if (this.mute) return this.n++;
    this.growV(1);
    const o = this.n * 4;
    const z = -yN;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z; this.pos[o + 3] = u;
    this.info[o] = this.style; this.info[o + 1] = this.pal; this.info[o + 2] = this.seed; this.info[o + 3] = part;
    const q = this.n * 2;
    this.hh[q] = this.H; this.hh[q + 1] = this.base;
    if (y > this.maxY) this.maxY = y;
    if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
    if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    return this.n++;
  }
  t(a, b, c) { if (this.mute) return; this.growI(3); this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  q(a, b, c, d) { this.growI(6); const i = this.idx; let n = this.ni; i[n++] = a; i[n++] = b; i[n++] = c; i[n++] = a; i[n++] = c; i[n++] = d; this.ni = n; }
  finish() {
    return {
      pos: this.pos.slice(0, this.n * 4), info: this.info.slice(0, this.n * 4), hh: this.hh.slice(0, this.n * 2), index: this.idx.slice(0, this.ni),
      nVerts: this.n, nTris: this.ni / 3, maxY: this.maxY, bounds: [this.minX, this.minZ, this.maxX, this.maxZ],
    };
  }
}

// ------------------------------------------------------------------ helpers
function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; }

function centroid(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; const f = r[i] * r[j + 1] - r[j] * r[i + 1]; a += f; cx += (r[i] + r[j]) * f; cy += (r[i + 1] + r[j + 1]) * f; }
  if (Math.abs(a) < 1e-6) return [r[0], r[1]];
  return [cx / (3 * a), cy / (3 * a)];
}

function pointInRing(x, y, r) {
  let inside = false;
  for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isConvex(r) {
  let sign = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n, k = (i + 4) % n;
    const c = (r[j] - r[i]) * (r[k + 1] - r[j + 1]) - (r[j + 1] - r[i + 1]) * (r[k] - r[j]);
    if (Math.abs(c) < 1e-3) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

// Minimum-area oriented bounding box. Returns {cx, cy, ax, ay, hl, hw} with (ax, ay) the unit vector of the long axis.
function obb(r) {
  let best = null;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n;
    let ex = r[j] - r[i], ey = r[j + 1] - r[i + 1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-3) continue;
    ex /= len; ey /= len;
    let mn0 = 1e18, mx0 = -1e18, mn1 = 1e18, mx1 = -1e18;
    for (let k = 0; k < n; k += 2) {
      const p0 = r[k] * ex + r[k + 1] * ey, p1 = -r[k] * ey + r[k + 1] * ex;
      if (p0 < mn0) mn0 = p0; if (p0 > mx0) mx0 = p0; if (p1 < mn1) mn1 = p1; if (p1 > mx1) mx1 = p1;
    }
    const area = (mx0 - mn0) * (mx1 - mn1);
    if (!best || area < best.area) best = { area, ex, ey, mn0, mx0, mn1, mx1 };
  }
  if (!best) return null;
  const { ex, ey, mn0, mx0, mn1, mx1 } = best;
  const c0 = (mn0 + mx0) / 2, c1 = (mn1 + mx1) / 2;
  const cx = c0 * ex - c1 * ey, cy = c0 * ey + c1 * ex;
  let hl = (mx0 - mn0) / 2, hw = (mx1 - mn1) / 2, ax = ex, ay = ey;
  if (hw > hl) { const t = hl; hl = hw; hw = t; ax = -ey; ay = ex; }
  return { cx, cy, ax, ay, hl, hw };
}

function hash01(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// ------------------------------------------------------------------ primitives
// Extrude rings (outer CCW, holes CW; flat arrays [x0,y0,x1,y1,...]) from y0 to y1. Returns top-vertex index lists for roofing.
function extrude(B, rings, y0, y1, part, roofPart, withRoof) {
  const tops = [];
  for (const r of rings) {
    const n = r.length / 2;
    const start = B.n;
    let u = 0;
    for (let k = 0; k <= n; k++) {
      const i = (k % n) * 2;
      const uu = u % U_WRAP;
      B.v(r[i], y0, r[i + 1], uu, part);
      B.v(r[i], y1, r[i + 1], uu, part);
      const j = ((k + 1) % n) * 2;
      u += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]);
    }
    for (let k = 0; k < n; k++) { const a = start + 2 * k, b = a + 2; B.t(a, b, b + 1); B.t(a, b + 1, a + 1); }
    tops.push(start);
  }
  if (!withRoof) return tops;
  roofFlat(B, rings, y1, roofPart);
  return tops;
}

function roofFlat(B, rings, y, part) {
  if (B.mute) return;
  const outer = rings[0];
  const n0 = outer.length / 2;
  const base = B.n;
  if (rings.length === 1 && n0 <= 4) {
    for (let k = 0; k < n0; k++) B.v(outer[2 * k], y, outer[2 * k + 1], 0, part);
    if (n0 === 3) B.t(base, base + 1, base + 2);
    else {
      // choose the diagonal that keeps both triangles CCW (handles concave quads)
      const c = (a, b, d) => (outer[2 * b] - outer[2 * a]) * (outer[2 * d + 1] - outer[2 * a + 1]) - (outer[2 * b + 1] - outer[2 * a + 1]) * (outer[2 * d] - outer[2 * a]);
      if (c(0, 1, 2) > 0 && c(0, 2, 3) > 0) { B.t(base, base + 1, base + 2); B.t(base, base + 2, base + 3); }
      else { B.t(base + 1, base + 2, base + 3); B.t(base + 1, base + 3, base); }
    }
    return;
  }
  let total = 0; for (const r of rings) total += r.length;
  const flat = new Float64Array(total); const holes = [];
  let o = 0;
  for (let ri = 0; ri < rings.length; ri++) { if (ri) holes.push(o / 2); flat.set(rings[ri], o); o += rings[ri].length; }
  const tri = earcut(flat, holes.length ? holes : undefined, 2);
  for (let k = 0; k < total; k += 2) B.v(flat[k], y, flat[k + 1], 0, part);
  for (let k = 0; k < tri.length; k += 3) {
    const a = tri[k], b = tri[k + 1], c = tri[k + 2];
    const cr = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
    if (cr >= 0) B.t(base + a, base + b, base + c); else B.t(base + a, base + c, base + b);
  }
}

function rectRing(o, hl, hw) {
  const { cx, cy, ax, ay } = o; const bx = -ay, by = ax;
  return [cx - ax * hl - bx * hw, cy - ay * hl - by * hw, cx + ax * hl - bx * hw, cy + ay * hl - by * hw,
    cx + ax * hl + bx * hw, cy + ay * hl + by * hw, cx - ax * hl + bx * hw, cy - ay * hl + by * hw];
}

function scaleRing(r, cx, cy, s) { const out = new Array(r.length); for (let i = 0; i < r.length; i += 2) { out[i] = cx + (r[i] - cx) * s; out[i + 1] = cy + (r[i + 1] - cy) * s; } return out; }

// point in OBB frame -> local
function P(o, l, w) { return [o.cx + o.ax * l - o.ay * w, o.cy + o.ay * l + o.ax * w]; }

// Simple straight hip / gable roof on an OBB (ordinary houses, re-roofed slabs, sheds).
function simpleRoof(B, o, yEave, rise, kind, part) {
  const { hl, hw } = o;
  const lr = kind === 'gable' ? hl : Math.max(0, hl - hw);
  const c = [P(o, -hl, -hw), P(o, hl, -hw), P(o, hl, hw), P(o, -hl, hw)];
  const rw = P(o, -lr, 0), re = P(o, lr, 0);
  const b = B.n;
  for (const p of c) B.v(p[0], yEave, p[1], 0, part);
  B.v(rw[0], yEave + rise, rw[1], 0, part); B.v(re[0], yEave + rise, re[1], 0, part);
  B.t(b, b + 1, b + 5); B.t(b, b + 5, b + 4);          // -w slope
  B.t(b + 2, b + 3, b + 4); B.t(b + 2, b + 4, b + 5);  // +w slope
  if (kind === 'gable') {
    // gable ends are walls
    const g = B.n;
    B.v(c[1][0], yEave, c[1][1], 0, PART.body); B.v(c[2][0], yEave, c[2][1], 0, PART.body); B.v(re[0], yEave + rise, re[1], 0, PART.body);
    B.v(c[3][0], yEave, c[3][1], 0, PART.body); B.v(c[0][0], yEave, c[0][1], 0, PART.body); B.v(rw[0], yEave + rise, rw[1], 0, PART.body);
    B.t(g, g + 1, g + 2); B.t(g + 3, g + 4, g + 5);
  } else {
    B.t(b + 1, b + 2, b + 5); B.t(b + 3, b, b + 4);
  }
}

// Chinese hall roof: overhanging eaves, sagging profile, upturned corners, ridge beam.
function hallRoof(B, o, yEave, rise, overhang, ridgeFrac, part) {
  const hl = o.hl + overhang, hw = o.hw + overhang;
  const lr = Math.max(0, hl - hw * ridgeFrac);
  const up = Math.min(12, Math.max(2.5, hw * 0.07));        // corner upturn (dm)
  const d1 = hw * 0.52;                                     // inset of the break line
  const y1 = yEave + rise * 0.34, y2 = yEave + rise;
  const b = B.n;
  // eave ring: 4 corners (raised) + 4 mid points
  const E = [[-hl, -hw, up], [0, -hw, 0], [hl, -hw, up], [hl, 0, 0], [hl, hw, up], [0, hw, 0], [-hl, hw, up], [-hl, 0, 0]];
  for (const e of E) { const p = P(o, e[0], e[1]); B.v(p[0], yEave + e[2], p[1], 0, part); }
  const ml = hl - d1, mw = hw - d1;
  const M = [[-ml, -mw], [ml, -mw], [ml, mw], [-ml, mw]];
  for (const m of M) { const p = P(o, m[0], m[1]); B.v(p[0], y1, p[1], 0, part); }
  const rA = P(o, -lr, 0), rB = P(o, lr, 0);
  B.v(rA[0], y2, rA[1], 0, part); B.v(rB[0], y2, rB[1], 0, part);
  const e = (i) => b + i, m = (i) => b + 8 + i, RA = b + 12, RB = b + 13;
  // lower band: sides (-w, +l, +w, -l)
  const side = (ea, em, eb, ma, mb) => { B.t(ea, em, ma); B.t(em, mb, ma); B.t(em, eb, mb); };
  side(e(0), e(1), e(2), m(0), m(1));
  side(e(2), e(3), e(4), m(1), m(2));
  side(e(4), e(5), e(6), m(2), m(3));
  side(e(6), e(7), e(0), m(3), m(0));
  // upper band
  B.t(m(0), m(1), RB); B.t(m(0), RB, RA);
  B.t(m(2), m(3), RA); B.t(m(2), RA, RB);
  B.t(m(1), m(2), RB); B.t(m(3), m(0), RA);
  // ridge beam
  if (lr > 4) {
    const rb = { cx: o.cx, cy: o.cy, ax: o.ax, ay: o.ay };
    extrude(B, [rectRing(rb, lr + 3, 2.2)], y2 - 2, y2 + 4.5, PART.trim, PART.trim, true);
  } else {
    // finial on pyramidal roofs
    const rb = { cx: o.cx, cy: o.cy, ax: o.ax, ay: o.ay };
    const s = Math.max(2.5, hw * 0.07);
    extrude(B, [rectRing(rb, s, s)], y2 - 2, y2 + s * 2.4, PART.gold, PART.gold, true);
  }
}

// Skirt roof ring between an outer eave rectangle and an inner (upper-storey) rectangle.
function skirtRoof(B, o, yEave, overhang, inset, rise, part) {
  const hl = o.hl + overhang, hw = o.hw + overhang, il = o.hl - inset, iw = o.hw - inset;
  const up = Math.min(10, Math.max(2, hw * 0.06));
  const b = B.n;
  const E = [[-hl, -hw, up], [0, -hw, 0], [hl, -hw, up], [hl, 0, 0], [hl, hw, up], [0, hw, 0], [-hl, hw, up], [-hl, 0, 0]];
  for (const e of E) { const p = P(o, e[0], e[1]); B.v(p[0], yEave + e[2], p[1], 0, part); }
  const M = [[-il, -iw], [il, -iw], [il, iw], [-il, iw]];
  for (const m of M) { const p = P(o, m[0], m[1]); B.v(p[0], yEave + rise, p[1], 0, part); }
  const e = (i) => b + i, m = (i) => b + 8 + i;
  const side = (ea, em, eb, ma, mb) => { B.t(ea, em, ma); B.t(em, mb, ma); B.t(em, eb, mb); };
  side(e(0), e(1), e(2), m(0), m(1)); side(e(2), e(3), e(4), m(1), m(2)); side(e(4), e(5), e(6), m(2), m(3)); side(e(6), e(7), e(0), m(3), m(0));
}

// A traditional timber hall on a stone platform.
function buildHall(B, o, y0, bodyH, roofKind, style, areaM2) {
  const W = o.hw * 2;                                       // dm
  const big = areaM2 > 700;
  const hp = Math.min(26, Math.max(3, W * (big ? 0.085 : 0.055)));           // platform height
  const pm = Math.min(40, Math.max(4, W * 0.09));                            // platform margin
  extrude(B, [rectRing(o, o.hl + pm, o.hw + pm)], y0, y0 + hp, PART.stone, PART.stone, true);
  const overhang = Math.min(34, Math.max(5, W * 0.13));
  const rise = Math.min(95, Math.max(11, W * 0.36 + 4));
  let yb = y0 + hp;
  B.H = bodyH; // facade mapping for the hall walls uses the body height
  if (roofKind === ROOF.hip2) {
    const h1 = bodyH * 0.56, inset = Math.min(45, Math.max(8, W * 0.16)), sr = rise * 0.3;
    extrude(B, [rectRing(o, o.hl, o.hw)], yb, yb + h1, PART.hallwall, PART.hallwall, false);
    skirtRoof(B, o, yb + h1 - 1.5, overhang, inset, sr, PART.tile);
    const o2 = { ...o, hl: o.hl - inset, hw: o.hw - inset };
    const yu = yb + h1 + sr - 2;
    const h2 = bodyH * 0.46;
    extrude(B, [rectRing(o2, o2.hl, o2.hw)], yu, yu + h2, PART.hallwall, PART.hallwall, false);
    hallRoof(B, o2, yu + h2 - 1.5, rise, overhang, 0.86, PART.tile);
  } else {
    extrude(B, [rectRing(o, o.hl, o.hw)], yb, yb + bodyH, PART.hallwall, PART.hallwall, false);
    const frac = roofKind === ROOF.pyramid ? 1.0 : 0.9;
    hallRoof(B, o, yb + bodyH - 1.5, roofKind === ROOF.pyramid ? rise * 1.15 : rise, overhang, frac, PART.tile);
  }
}

// Offset a ring towards its solid side (outer rings run counter-clockwise, holes clockwise, so "left of the edge" is always solid).
function insetRing(r, d) {
  const n = r.length / 2, out = new Array(r.length);
  for (let i = 0; i < n; i++) {
    const p = ((i + n - 1) % n) * 2, c = i * 2, q = ((i + 1) % n) * 2;
    let ax = r[c] - r[p], ay = r[c + 1] - r[p + 1], bx = r[q] - r[c], by = r[q + 1] - r[c + 1];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    // left normals of the two edges, mitred (the mitre is capped so sharp corners do not shoot off)
    const k = d / Math.max(0.35, 1 + (-ay * -by + ax * bx));
    out[c] = r[c] + (-ay - by) * k; out[c + 1] = r[c + 1] + (ax + bx) * k;
  }
  return out;
}

// Palace and temple ranges whose plans are not simple rectangles (galleries, L- and U-shaped wings, precinct walls):
// timber walls under a glazed-tile roof that slopes in from overhanging eaves to a level ridge.
function hallBlock(B, rings, y0, yEave) {
  let area = 0, perim = 0;
  for (const r of rings) {
    area += ringArea(r);
    for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; perim += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]); }
  }
  const width = 2 * Math.abs(area) / Math.max(perim, 1);            // ~ the width of the range (dm)
  // how far the roof can run in before the plan closes up: half the short side of a plain rectangle, half the range width otherwise
  const ob = rings.length === 1 ? obb(rings[0]) : null;
  const reach = ob && Math.abs(area) / (4 * ob.hl * ob.hw) > 0.85 ? Math.min(ob.hw, width) : width * 0.5;
  const d = Math.min(60, 0.84 * reach);
  extrude(B, rings, y0, yEave, PART.hallwall, PART.hallwall, false);
  if (d < 4) { roofFlat(B, rings, yEave, PART.tile); return; }
  const rise = d * 0.62, over = Math.min(7, d * 0.3);
  const inner = [];
  for (const r of rings) {
    const eave = insetRing(r, -over), top = insetRing(r, d);
    inner.push(top);
    const n = r.length / 2, b = B.n;
    for (let i = 0; i < n; i++) { B.v(eave[2 * i], yEave - 2, eave[2 * i + 1], 0, PART.tile); B.v(top[2 * i], yEave + rise, top[2 * i + 1], 0, PART.tile); }
    for (let i = 0; i < n; i++) { const a = b + 2 * i, c = b + 2 * ((i + 1) % n); B.t(a, c, c + 1); B.t(a, c + 1, a + 1); }
  }
  roofFlat(B, inner, yEave + rise, PART.tile);
}

// Flat-roofed body: walls run up to a parapet, the roof deck sits a little lower (the inner parapet face is the wall's back side,
// drawn double-sided near the camera).
function extrudeBody(B, rings, y0, yTop, parapet) {
  extrude(B, rings, y0, yTop, PART.body, PART.body, false);
  roofFlat(B, rings, yTop - parapet, PART.body);
}

function parapetOf(st, Hm) {
  if (st === ST.courtyard || st === ST.canopy || st === ST.tank || st === ST.construction || st === ST.special) return 0;
  if (st === ST.village) return 3;
  if (st === ST.industrial || st === ST.bigroof) return 5;
  return Hm >= 9 ? 11 : 6;
}

// A tower shaft from yBase to yTop: tall ones step back into a crown (some with a mast), the rest get a parapet and a plant room.
// Roof decks that can carry equipment are appended to `slots`.
function tower(B, ring, holes, y0, yBase, yTop, st, sd, k, slots) {
  const Hm = (yTop - yBase) / 10, areaM2 = Math.abs(ringArea(ring)) / 100;
  const rnd = hash01(sd, k);
  const rings = holes.length ? [ring, ...holes] : [ring];
  if (Hm >= 80 && !holes.length && isConvex(ring) && areaM2 > 350) {
    const [cx, cy] = centroid(ring);
    const crown = Hm * (0.07 + 0.08 * rnd) * 10;
    extrudeBody(B, rings, y0, yTop - crown, 0);
    const r2 = scaleRing(ring, cx, cy, 0.74 + 0.14 * hash01(sd, 7));
    extrudeBody(B, [r2], yTop - crown, yTop, 9);
    if (Hm >= 170 && (sd & 1)) {
      const mh = Hm * (0.04 + 0.05 * hash01(sd, 11)) * 10;
      extrude(B, [rectRing({ cx, cy, ax: 1, ay: 0 }, 6, 6)], yTop - 9, yTop + mh, PART.mast, PART.mast, true);
    }
    slots.push({ ring: r2, holes: [], y: yTop - 9, keep: null });
    return;
  }
  const par = parapetOf(st, Hm);
  extrudeBody(B, rings, y0, yTop, par);
  let keep = null;
  if (Hm >= 26 && areaM2 >= 220) {
    // lift overrun / plant room
    const [cx, cy] = centroid(ring);
    const ob = pointInRing(cx, cy, ring) ? obb(ring) : null;
    if (ob) {
      const sc = 0.3 + 0.2 * rnd;
      const pr = rectRing({ ...ob, cx, cy }, ob.hl * sc, ob.hw * Math.min(0.55, sc + 0.12));
      let ok = true;
      for (let i = 0; i < 8; i += 2) if (!pointInRing(pr[i], pr[i + 1], ring)) { ok = false; break; }
      if (ok) { extrude(B, [pr], yTop - par, yTop + 28 + 30 * hash01(sd, 3), PART.plant, PART.plant, true); keep = pr; }
    }
  }
  slots.push({ ring, holes, y: yTop - par, keep });
}

// Roof-top equipment for one deck: condenser banks, cooling towers, duct runs, stair heads, water tanks, the odd hoarding.
function garnishDeck(G, slot, st, sd, k, Hm) {
  const ring = slot.ring;
  const ob = obb(ring); if (!ob || ob.hw < 30) return;
  const areaM2 = Math.abs(ringArea(ring)) / 100;
  const rng = mulberry(sd * 7919 + k * 31 + 5);
  const commercial = st === ST.office || st === ST.retail || st === ST.public || st === ST.generic;
  const n = commercial ? Math.min(10, Math.max(1, Math.floor(areaM2 / 230))) : 0;
  const inside = (r) => {
    for (let i = 0; i < r.length; i += 2) {
      if (!pointInRing(r[i], r[i + 1], ring)) return false;
      if (slot.keep && pointInRing(r[i], r[i + 1], slot.keep)) return false;
      for (const h of slot.holes) if (pointInRing(r[i], r[i + 1], h)) return false;
    }
    return true;
  };
  // every item stands on the deck: heights in the shader are measured from there
  const put = (r, h, part) => { G.base = slot.y; G.H = h; extrude(G, [r], slot.y, slot.y + h, part, part, true); };
  const along = { cx: 0, cy: 0, ax: ob.ax, ay: ob.ay }, across = { cx: 0, cy: 0, ax: -ob.ay, ay: ob.ax };
  const at = (frame, l, w) => { const c = P(ob, l, w); return { ...frame, cx: c[0], cy: c[1] }; };
  if (st === ST.resi) {
    // housing: a lift / stair head for each entrance on the taller slabs, kitchen vent stacks in a row, a water tank on some old walk-ups
    const units = Math.max(1, Math.round(ob.hl * 2 / 230));
    const side = (sd & 1) ? 1 : -1;
    if (Hm >= 24 && !slot.keep && ob.hw > 45) {
      for (let i = 0; i < units; i++) {
        const r = rectRing(at(across, ((i + 0.5) / units * 2 - 1) * ob.hl, side * ob.hw * 0.2), Math.min(30, ob.hw * 0.42), 17);
        if (inside(r)) put(r, 27 + (sd % 5), PART.plant);
      }
    } else if (Hm < 24 && (sd % 3) === 0 && ob.hw > 40) {
      const r = rectRing(at(along, (rng() * 2 - 1) * ob.hl * 0.6, side * ob.hw * 0.25), 15, 11);
      if (inside(r)) put(r, 19, PART.tank);
    }
    const nv = Math.min(14, Math.floor(ob.hl * 2 / 75));
    for (let i = 0; i < nv; i++) {
      const r = rectRing(at(along, ((i + 0.5) / nv * 2 - 1) * ob.hl * 0.94, -side * ob.hw * 0.42), 3, 3);
      if (inside(r)) put(r, 9, PART.unit);
    }
    return;
  }
  if (st === ST.industrial) {
    // sheds: a ridge monitor along the long axis
    if (ob.hw > 70 && ob.hl > 150) {
      const r = rectRing(at(along, 0, 0), ob.hl * 0.82, Math.min(22, ob.hw * 0.14));
      if (inside(r)) put(r, 13, PART.unit);
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const c = P(ob, (rng() * 2 - 1) * ob.hl * 0.84, (rng() * 2 - 1) * ob.hw * 0.80);
      const t = rng();
      let hl, hw, h, part;
      if (commercial) {
        if (t < 0.45) { hl = 12 + rng() * 22; hw = 6.5; h = 13 + rng() * 5; part = PART.unit; }           // condenser bank
        else if (t < 0.63) { hl = 15; hw = 15; h = 28 + rng() * 10; part = PART.unit; }                   // cooling tower
        else if (t < 0.86) { hl = 30 + rng() * 55; hw = 4.5; h = 7; part = PART.unit; }                   // duct run
        else { hl = 16; hw = 23; h = 26; part = PART.plant; }                                             // stair head
      } else break;
      const turn = rng() < 0.5;
      const r = rectRing({ cx: c[0], cy: c[1], ax: turn ? -ob.ay : ob.ax, ay: turn ? ob.ax : ob.ay }, hl, hw);
      if (!inside(r)) continue;
      put(r, h, part);
      break;
    }
  }
  if ((st === ST.retail || st === ST.office) && slot.y < 800 && areaM2 > 500 && hash01(sd, 23) < 0.2) {
    // hoarding along one long edge
    const side = hash01(sd, 29) < 0.5 ? -1 : 1;
    const c = P(ob, 0, side * (ob.hw - 9));
    const r = rectRing({ cx: c[0], cy: c[1], ax: ob.ax, ay: ob.ay }, Math.min(ob.hl * 0.7, 95), 2.5);
    if (inside(r)) { G.base = slot.y; G.H = 54; extrude(G, [r], slot.y + 10, slot.y + 10 + 44, PART.sign, PART.sign, true); }
  }
}

// ------------------------------------------------------------------ tile decode + build
function buildTile(buf, opts, off = 0) {
  const dv = new DataView(buf, off);
  const nb = dv.getUint32(0, true), nr = dv.getUint32(4, true), nv = dv.getUint32(8, true);
  let o = off + 12;
  const height = new Uint16Array(buf, o, nb); o += 2 * nb;
  const base = new Uint16Array(buf, o, nb); o += 2 * nb;
  const elev = new Uint16Array(buf, o, nb); o += 2 * nb;
  const style = new Uint8Array(buf, o, nb); o += nb;
  const pal = new Uint8Array(buf, o, nb); o += nb;
  const roof = new Uint8Array(buf, o, nb); o += nb;
  const seed = new Uint8Array(buf, o, nb); o += nb;
  const nrings = new Uint8Array(buf, o, nb); o += nb;
  if ((o - off) & 1) o++;
  const ringsize = new Uint16Array(buf, o, nr); o += 2 * nr;
  const xy = new Int16Array(buf, o, 2 * nv);

  const isMass = opts.kind === 'mass';
  const isGarnish = opts.kind === 'garnish';
  const B = isGarnish ? new Builder(16, 16) : new Builder(Math.max(1024, nv * (isMass ? 3 : 4)), Math.max(2048, nv * (isMass ? 9 : 12)));
  // garnish pass: the massing is replayed silently to find the roof decks; only the equipment is emitted
  const G = isGarnish ? new Builder(2048, 4096) : null;
  if (isGarnish) B.mute = true;
  let ri = 0, vi = 0;
  const footprints = opts.wantFootprints ? [] : null;

  const one = (k) => {
    // decode rings (delta coded across the whole building)
    const rings = [];
    let px = 0, py = 0;
    for (let r = 0; r < nrings[k]; r++) {
      const n = ringsize[ri++];
      const ring = new Array(n * 2);
      for (let i = 0; i < n; i++) { px += xy[vi * 2]; py += xy[vi * 2 + 1]; vi++; ring[2 * i] = px; ring[2 * i + 1] = py; }
      rings.push(ring);
    }
    const st = style[k], H = height[k], el = elev[k], bs = base[k];
    const y0 = el + bs - (el > 0 && bs === 0 ? 40 : 0);
    const yb = el + bs;
    B.style = st; B.pal = pal[k]; B.seed = seed[k]; B.H = Math.max(10, H - bs); B.base = yb;
    if (G) { G.style = st; G.pal = pal[k]; G.seed = seed[k]; }
    if (footprints) footprints.push(rings[0]);

    if (isMass) { extrude(B, rings, y0, el + H, PART.mass, PART.mass, true); return; }

    const rk = roof[k];
    const outer = rings[0];
    const hall = (st === ST.imperial || st === ST.temple);
    if (hall && (rk === ROOF.hip || rk === ROOF.pyramid || rk === ROOF.hip2) && rings.length === 1) {
      const ob = obb(outer);
      if (ob && ob.hw > 9) {
        const areaM2 = Math.abs(ringArea(outer)) / 100;
        buildHall(B, ob, y0, B.H, rk, st, areaM2);
        return;
      }
    }
    if ((rk === ROOF.gable || rk === ROOF.hip || rk === ROOF.shed) && rings.length === 1) {
      const ob = obb(outer);
      if (ob && ob.hw > 8) {
        const ring = rectRing(ob, ob.hl, ob.hw);
        const top = yb + B.H;
        extrude(B, [ring], y0, top, PART.body, PART.body, false);
        let rise, kind;
        if (rk === ROOF.shed) { rise = Math.min(45, ob.hw * 0.22); kind = 'gable'; }
        else if (rk === ROOF.hip) { rise = Math.min(40, ob.hw * 0.5); kind = 'hip'; }
        else { rise = Math.min(34, Math.max(9, ob.hw * 0.62)); kind = 'gable'; }
        simpleRoof(B, ob, top, rise, kind, PART.pitched);
        return;
      }
    }

    const Hm = B.H / 10;
    const areaM2 = Math.abs(ringArea(outer)) / 100;
    const towerish = (st === ST.office || st === ST.resi || st === ST.generic || st === ST.public || st === ST.retail);
    const yTop = yb + B.H;
    const holes = rings.slice(1);
    const slots = [];
    // re-roofed walk-up slabs (平改坡): a share of 5-7 storey slabs carry low hipped roofs
    if (st === ST.resi && Hm >= 13 && Hm <= 23 && rings.length === 1 && outer.length <= 12 && (seed[k] % 4) === 0) {
      const ob = obb(outer);
      const fill = ob ? areaM2 * 100 / (4 * ob.hl * ob.hw) : 0;
      if (ob && fill > 0.86 && ob.hl / ob.hw > 2.2 && ob.hw > 45 && ob.hw < 110) {
        extrude(B, rings, y0, yTop, PART.body, PART.body, true);
        simpleRoof(B, { ...ob, hl: ob.hl + 3, hw: ob.hw + 3 }, yTop + 1, Math.min(32, ob.hw * 0.42), 'hip', PART.pitched);
        return;
      }
    }
    // a very large footprint carrying a tall height is a podium with a tower on it, not one colossal block
    if (towerish && rings.length === 1 && ((Hm >= 55 && areaM2 >= 4200) || (Hm >= 90 && areaM2 >= 3000))) {
      const ob = obb(outer);
      const [cx, cy] = centroid(outer);
      if (ob && pointInRing(cx, cy, outer)) {
        const target = Math.min(2800, Math.max(1100, areaM2 * 0.34)) * 100;
        const asp = Math.min(2.2, Math.max(1, ob.hl / ob.hw));
        const hwT = Math.sqrt(target / (4 * asp)), hlT = hwT * asp;
        let tr = null;
        for (const sc of [1, 0.82, 0.66]) {
          const cand = rectRing({ ...ob, cx, cy }, hlT * sc, hwT * sc);
          let ok = true;
          for (let i = 0; i < 8; i += 2) if (!pointInRing(cand[i], cand[i + 1], outer)) { ok = false; break; }
          if (ok) { tr = cand; break; }
        }
        if (tr) {
          const podH = Math.round(Math.min(260, Math.max(140, B.H * 0.2)));
          extrudeBody(B, rings, y0, yb + podH, 11);
          slots.push({ ring: outer, holes: [], y: yb + podH - 11, keep: tr });
          tower(B, tr, [], yb + podH - 11, yb + podH - 11, yTop, st, seed[k], k, slots);
          if (G) for (const sl of slots) garnishDeck(G, sl, st, seed[k], k, Hm);
          return;
        }
      }
    }
    if (towerish) tower(B, outer, holes, y0, yb, yTop, st, seed[k], k, slots);
    else if (hall) hallBlock(B, rings, y0, yTop);
    else {
      const par = parapetOf(st, Hm);
      extrudeBody(B, rings, y0, yTop, par);
      if (st === ST.industrial || st === ST.bigroof) slots.push({ ring: outer, holes, y: yTop - par, keep: null });
    }
    if (G) for (const sl of slots) garnishDeck(G, sl, st, seed[k], k, Hm);
  };
  // LOD cuts: the index count after the most significant 30% / 60% of buildings (tiles are sorted by significance)
  const cutA = Math.ceil(nb * 0.3), cutB = Math.ceil(nb * 0.6);
  const cuts = [0, 0];
  for (let k = 0; k < nb; k++) {
    one(k);
    if (k + 1 === cutA) cuts[0] = B.ni;
    if (k + 1 === cutB) cuts[1] = B.ni;
  }
  const out = (G || B).finish();
  out.count = nb;
  out.cuts = cuts;
  if (footprints) out.footprints = footprints;
  return out;
}

// ------------------------------------------------------------------ trees
// Scatter instanced trees from the per-tile zones / rows / points (see pipeline/32_tree_zones.py).
// Returns Float32Array [x, z, crownRadius, kind * 256 + seed] in metres, tile local (z = -north), shuffled so any prefix is a fair sample.
const KIND = { broadleaf: 0, conifer: 1, ginkgo: 2, poplar: 3 };
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function vnoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const h = (a, b) => { let n = (a * 374761393 + b * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
function scatterTrees(buf, off, len, tileSeed, quality) {
  if (len < 24) return new Float32Array(0);
  const dv = new DataView(buf, off);
  const nPoly = dv.getUint32(0, true), nRing = dv.getUint32(4, true), nVert = dv.getUint32(8, true);
  const nLine = dv.getUint32(12, true), nLineVert = dv.getUint32(16, true), nPoint = dv.getUint32(20, true);
  const pad4 = (x) => (x + 3) & ~3;
  let o = off + 24;
  const pcls = new Uint8Array(buf, o, nPoly); const prings = new Uint8Array(buf, o + nPoly, nPoly); o = off + pad4(o - off + 2 * nPoly);
  const ringSize = new Uint16Array(buf, o, nRing); o = off + pad4(o - off + 2 * nRing);
  const pxy = new Int16Array(buf, o, 2 * nVert); o = off + pad4(o - off + 4 * nVert);
  const linePts = new Uint16Array(buf, o, nLine); o = off + pad4(o - off + 2 * nLine);
  const lxy = new Int16Array(buf, o, 2 * nLineVert); o = off + pad4(o - off + 4 * nLineVert);
  const pts = new Uint16Array(buf, o, 2 * nPoint);
  const rnd = mulberry(tileSeed * 7919 + 13);
  const out = [];
  const push = (xd, yd, r, kind) => { out.push(xd * 0.1, -yd * 0.1, r, kind * 256 + Math.floor(rnd() * 256)); };

  // ---- zones: decode, triangulate, measure
  const tris = [];           // [ax, ay, bx, by, cx, cy, area(m2), cls]
  const areaByCls = [0, 0, 0, 0, 0];
  let ri = 0, vi = 0;
  for (let p = 0; p < nPoly; p++) {
    let total = 0; for (let r = 0; r < prings[p]; r++) total += ringSize[ri + r];
    const flat = new Float64Array(total * 2); const holes = [];
    let x = 0, y = 0, k = 0;
    for (let r = 0; r < prings[p]; r++) {
      if (r) holes.push(k);
      const n = ringSize[ri++];
      for (let i = 0; i < n; i++) { x += pxy[vi * 2]; y += pxy[vi * 2 + 1]; vi++; flat[2 * k] = x; flat[2 * k + 1] = y; k++; }
    }
    const tr = earcut(flat, holes.length ? holes : undefined, 2);
    for (let t = 0; t < tr.length; t += 3) {
      const a = tr[t] * 2, b = tr[t + 1] * 2, c = tr[t + 2] * 2;
      const ar = Math.abs((flat[b] - flat[a]) * (flat[c + 1] - flat[a + 1]) - (flat[b + 1] - flat[a + 1]) * (flat[c] - flat[a])) / 200;
      if (ar < 1) continue;
      tris.push(flat[a], flat[a + 1], flat[b], flat[b + 1], flat[c], flat[c + 1], ar, pcls[p]);
      areaByCls[pcls[p]] += ar;
    }
  }
  // densities (trees per m2); big forests are thinned (their floor already carries a canopy texture)
  const cap = 9000 * quality;
  const dDense = Math.min(1 / 80, cap / Math.max(areaByCls[1], 1));
  const dPark = Math.min(1 / 300, cap * 0.5 / Math.max(areaByCls[2], 1));
  const dCyp = Math.min(1 / 150, cap * 0.6 / Math.max(areaByCls[3], 1));
  const dYard = Math.min(1 / 70, cap * 0.8 / Math.max(areaByCls[4], 1));
  const thin = Math.sqrt((1 / 80) / dDense);
  for (let t = 0; t < tris.length; t += 8) {
    const cls = tris[t + 7];
    const dens = cls === 1 ? dDense : cls === 2 ? dPark * 2.2 : cls === 4 ? dYard : dCyp;
    let n = tris[t + 6] * dens; n = Math.floor(n) + (rnd() < n - Math.floor(n) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const x = tris[t] + (tris[t + 2] - tris[t]) * u + (tris[t + 4] - tris[t]) * v;
      const y = tris[t + 1] + (tris[t + 3] - tris[t + 1]) * u + (tris[t + 5] - tris[t + 1]) * v;
      if (cls === 2) {
        // parkland: groves and open lawns
        if (vnoise2(x / 420, y / 420) + 0.35 * vnoise2(x / 110 + 9, y / 110) < 0.62) continue;
        const k = rnd();
        push(x, y, 3.4 + rnd() * 3.4, k < 0.16 ? KIND.ginkgo : k < 0.34 ? KIND.conifer : k < 0.5 ? KIND.poplar : KIND.broadleaf);
      } else if (cls === 3) {
        push(x, y, 2.6 + rnd() * 2.6, rnd() < 0.82 ? KIND.conifer : KIND.broadleaf);
      } else if (cls === 4) {
        // housing yards: modest trees of mixed kinds
        const k = rnd();
        push(x, y, 2.3 + rnd() * 1.9, k < 0.12 ? KIND.ginkgo : k < 0.26 ? KIND.conifer : k < 0.44 ? KIND.poplar : KIND.broadleaf);
      } else {
        const k = rnd();
        push(x, y, (3.0 + rnd() * 2.6) * Math.min(1.9, 0.9 + 0.35 * thin), k < 0.22 ? KIND.conifer : k < 0.42 ? KIND.poplar : KIND.broadleaf);
      }
    }
  }
  // ---- street-tree rows: one species per row
  let li = 0;
  const step = 105 / Math.sqrt(Math.max(quality, 0.25));
  for (let l = 0; l < nLine; l++) {
    const n = linePts[l];
    let x = 0, y = 0;
    const sp = rnd();
    const kind = sp < 0.14 ? KIND.ginkgo : sp < 0.42 ? KIND.poplar : KIND.broadleaf;
    const size = 2.5 + rnd() * 1.6;
    let carry = rnd() * step;
    let px = 0, py = 0;
    for (let i = 0; i < n; i++) {
      x += lxy[li * 2]; y += lxy[li * 2 + 1]; li++;
      if (i > 0) {
        const dx = x - px, dy = y - py; const len = Math.hypot(dx, dy);
        let d = carry;
        while (d < len) {
          if (rnd() > 0.12) { const t = d / len; push(px + dx * t + (rnd() - 0.5) * 8, py + dy * t + (rnd() - 0.5) * 8, size * (0.85 + 0.3 * rnd()), kind); }
          d += step * (0.85 + 0.3 * rnd());
        }
        carry = d - len;
      }
      px = x; py = y;
    }
  }
  // ---- courtyard trees
  for (let i = 0; i < nPoint; i++) push(pts[2 * i], pts[2 * i + 1], 2.4 + rnd() * 2.4, rnd() < 0.12 ? KIND.conifer : KIND.broadleaf);
  // ---- shuffle (blocks of 4 floats)
  const count = out.length / 4;
  const arr = new Float32Array(out);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    for (let k = 0; k < 4; k++) { const t = arr[i * 4 + k]; arr[i * 4 + k] = arr[j * 4 + k]; arr[j * 4 + k] = t; }
  }
  return arr;
}

self.onmessage = (ev) => {
  const { id, buffer, opts } = ev.data;
  try {
    const t0 = performance.now();
    let res;
    if (opts && opts.kind === 'detail') {
      // detail bundle: [u32 lenBuildings][u32 lenTrees][buildings][trees]
      const dv = new DataView(buffer);
      const lenB = dv.getUint32(0, true), lenT = dv.getUint32(4, true);
      res = buildTile(buffer, opts, 8);
      res.trees = lenT ? scatterTrees(buffer, 8 + lenB, lenT, opts.seed || 1, opts.trees ?? 1) : new Float32Array(0);
    } else res = buildTile(buffer, opts || {});
    res.ms = performance.now() - t0;
    const transfer = [res.pos.buffer, res.info.buffer, res.hh.buffer, res.index.buffer];
    if (res.trees) transfer.push(res.trees.buffer);
    delete res.footprints;
    self.postMessage({ id, ok: true, res }, transfer);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.stack || e) });
  }
};
