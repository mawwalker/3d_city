// Building geometry (runs in the worker). Turns decoded building records into one merged mesh per tile.
//
// Vertex layout (separate typed arrays):
//   aPos  Int16 x4   x, y, z in 1/40 m relative to the tile centre (y up, z south); w = distance along the wall edge (1/40 m)
//   aNrm  Int8 x4    world normal (snorm) + surface kind (see KIND)
//   aBld  Uint8 x4   style, seed, palette, levels
//   aEdge Uint16 x2  edge length (1/40 m), wall-top height above ground (1/40 m)
//   aFlag Uint8 x4   edge flags (1 street front, 2 party wall), floor height (1/40 m), ground-floor height (1/20 m), building flags

import earcut from '../../vendor/earcut/earcut.js';
import { ST, ROOF, KIND, STYLE } from './styles.js';

export const Q = 40;

export class MeshBuilder {
  constructor(vcap = 8192, icap = 16384) {
    this.pos = new Int16Array(vcap * 4); this.nrm = new Int8Array(vcap * 4); this.bld = new Uint8Array(vcap * 4);
    this.edge = new Uint16Array(vcap * 2); this.flag = new Uint8Array(vcap * 4); this.idx = new Uint32Array(icap);
    this.n = 0; this.ni = 0;
    this.minX = 1e9; this.maxX = -1e9; this.minZ = 1e9; this.maxZ = -1e9; this.maxY = 0; this.minY = 1e9;
    this.b0 = 0; this.b1 = 0; this.b2 = 0; this.b3 = 0;     // aBld
    this.e0 = 0; this.e1 = 0;                               // aEdge
    this.f0 = 0; this.f1 = 0; this.f2 = 0; this.f3 = 0;     // aFlag
  }
  growV(extra) {
    if ((this.n + extra) * 4 <= this.pos.length) return;
    const cap = Math.max(this.pos.length / 2, this.n + extra + 1024);     // doubles (length is 4 per vertex)
    const g = (A, per) => { const a = new A.constructor(cap * per); a.set(A); return a; };
    this.pos = g(this.pos, 4); this.nrm = g(this.nrm, 4); this.bld = g(this.bld, 4); this.edge = g(this.edge, 2); this.flag = g(this.flag, 4);
  }
  growI(extra) {
    if (this.ni + extra <= this.idx.length) return;
    const a = new Uint32Array(Math.max(this.idx.length * 2, this.ni + extra + 2048)); a.set(this.idx); this.idx = a;
  }
  /** x east, y up, n north (metres, relative to the tile centre); normal given in the same frame (nx, ny, nn). */
  v(x, y, n, u, nx, ny, nn, kind) {
    this.growV(1);
    const o = this.n * 4, z = -n;
    this.pos[o] = Math.round(x * Q); this.pos[o + 1] = Math.round(y * Q); this.pos[o + 2] = Math.round(z * Q); this.pos[o + 3] = Math.min(32767, Math.round(u * Q));
    this.nrm[o] = Math.round(nx * 127); this.nrm[o + 1] = Math.round(ny * 127); this.nrm[o + 2] = Math.round(-nn * 127); this.nrm[o + 3] = kind;
    this.bld[o] = this.b0; this.bld[o + 1] = this.b1; this.bld[o + 2] = this.b2; this.bld[o + 3] = this.b3;
    this.edge[this.n * 2] = this.e0; this.edge[this.n * 2 + 1] = this.e1;
    this.flag[o] = this.f0; this.flag[o + 1] = this.f1; this.flag[o + 2] = this.f2; this.flag[o + 3] = this.f3;
    if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
    if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    if (y > this.maxY) this.maxY = y; if (y < this.minY) this.minY = y;
    return this.n++;
  }
  tri(a, b, c) { this.growI(3); this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  quad(a, b, c, d) { this.growI(6); const i = this.idx; let n = this.ni; i[n++] = a; i[n++] = b; i[n++] = c; i[n++] = a; i[n++] = c; i[n++] = d; this.ni = n; }
  /** Flat-shaded polygon given as points [x, y, n] (planar, any winding): the normal is forced to the hemisphere of (hx, hy, hn). */
  face(pts, kind, hx = 0, hy = 1, hn = 0, uAlong = false) {
    const [a, b, c] = pts;
    let ux = b[0] - a[0], uy = b[1] - a[1], un = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vn = c[2] - a[2];
    // cross product in (x, y, n): note the world frame is (x, y, -n), handled by v()
    let nx = uy * vn - un * vy, ny = un * vx - ux * vn, nn = ux * vy - uy * vx;
    // (x, y, n) is left-handed relative to the world; flip to get the geometric normal in that frame
    nx = -nx; ny = -ny; nn = -nn;
    const l = Math.hypot(nx, ny, nn) || 1; nx /= l; ny /= l; nn /= l;
    let flip = false;
    if (nx * hx + ny * hy + nn * hn < 0) { nx = -nx; ny = -ny; nn = -nn; flip = true; }
    const base = this.n;
    for (let k = 0; k < pts.length; k++) { const p = pts[k]; this.v(p[0], p[1], p[2], uAlong ? (p[3] || 0) : 0, nx, ny, nn, kind); }
    // decide winding from the first triangle so the front face matches the normal
    const front = !flip;
    for (let k = 1; k + 1 < pts.length; k++) { if (front) this.tri(base, base + k, base + k + 1); else this.tri(base, base + k + 1, base + k); }
  }
  finish() {
    const n = this.n;
    return { pos: this.pos.slice(0, n * 4), nrm: this.nrm.slice(0, n * 4), bld: this.bld.slice(0, n * 4), edge: this.edge.slice(0, n * 2), flag: this.flag.slice(0, n * 4),
      index: this.idx.slice(0, this.ni), nVerts: n, nTris: this.ni / 3, bounds: [this.minX, this.minY === 1e9 ? 0 : this.minY, this.minZ, this.maxX, this.maxY, this.maxZ] };
  }
}

// ------------------------------------------------------------------ helpers (rings are flat [x0, n0, x1, n1, ...], outer CCW, holes CW)
export function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; }

/** Minimum-area oriented bounding box: {cx, cy, ax, ay, hl, hw, area} with (ax, ay) the unit long axis. */
export function obb(r) {
  let best = null;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n;
    let ex = r[j] - r[i], ey = r[j + 1] - r[i + 1];
    const len = Math.hypot(ex, ey);
    if (len < 0.05) continue;
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
  return { cx, cy, ax, ay, hl, hw, area: best.area };
}

/** Offset a ring towards its interior (left of travel) by d metres with mitred corners. Returns null when the shape collapses. */
export function insetRing(r, d) {
  const n = r.length / 2;
  if (n < 3) return null;
  const out = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const i = ((k + n - 1) % n) * 2, j = k * 2, l = ((k + 1) % n) * 2;
    let ax = r[j] - r[i], ay = r[j + 1] - r[i + 1], bx = r[l] - r[j], by = r[l + 1] - r[j + 1];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    // left normals
    const n0x = -ay, n0y = ax, n1x = -by, n1y = bx;
    const dot = n0x * n1x + n0y * n1y;
    let mx = n0x + n1x, my = n0y + n1y;
    const k2 = 1 + dot;
    if (k2 < 0.25) { const ml = Math.hypot(mx, my) || 1; mx = mx / ml * 2.0; my = my / ml * 2.0; } else { mx /= k2; my /= k2; }
    out[j] = r[j] + mx * d; out[j + 1] = r[j + 1] + my * d;
  }
  // every edge must keep its direction, and the area its sign
  for (let k = 0; k < n; k++) {
    const j = k * 2, l = ((k + 1) % n) * 2;
    if ((out[l] - out[j]) * (r[l] - r[j]) + (out[l + 1] - out[j + 1]) * (r[l + 1] - r[j + 1]) <= 0) return null;
  }
  const a0 = ringArea(r), a1 = ringArea(out);
  if (a0 * a1 <= 0 || Math.abs(a1) < 0.05 * Math.abs(a0)) return null;
  return out;
}

function capPolygon(B, rings, y, kind) {
  let total = 0;
  for (const r of rings) total += r.length;
  const flat = new Float64Array(total); const holes = [];
  let o = 0;
  for (let k = 0; k < rings.length; k++) { if (k > 0) holes.push(o / 2); flat.set(rings[k], o); o += rings[k].length; }
  const tris = earcut(flat, holes.length ? holes : null, 2);
  const base = B.n;
  for (let i = 0; i < total; i += 2) B.v(flat[i], y, flat[i + 1], 0, 0, 1, 0, kind);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
    if (cr > 0) B.tri(base + a, base + b, base + c); else B.tri(base + a, base + c, base + b);
  }
}

/** Walls of one ring from y0 to y1 (per-edge quads; u runs along each edge). ef: per-vertex edge flags or null. */
function walls(B, r, y0, y1, kind, ef, inward = false) {
  const n = r.length / 2;
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    const ex = r[j] - r[i], en = r[j + 1] - r[i + 1];
    const len = Math.hypot(ex, en);
    if (len < 0.03) continue;
    let nx = en / len, nn = -ex / len;            // outward (right of travel) for CCW rings
    B.e0 = Math.min(65535, Math.round(len * Q));
    B.f0 = ef ? ef[k] : 0;
    if (!inward) {
      const a = B.v(r[i], y0, r[i + 1], 0, nx, 0, nn, kind), b = B.v(r[j], y0, r[j + 1], len, nx, 0, nn, kind);
      const c = B.v(r[j], y1, r[j + 1], len, nx, 0, nn, kind), dd = B.v(r[i], y1, r[i + 1], 0, nx, 0, nn, kind);
      B.quad(a, b, c, dd);
    } else {
      nx = -nx; nn = -nn;
      const a = B.v(r[j], y0, r[j + 1], 0, nx, 0, nn, kind), b = B.v(r[i], y0, r[i + 1], len, nx, 0, nn, kind);
      const c = B.v(r[i], y1, r[i + 1], len, nx, 0, nn, kind), dd = B.v(r[j], y1, r[j + 1], 0, nx, 0, nn, kind);
      B.quad(a, b, c, dd);
    }
  }
  B.f0 = 0;
}

/** Horizontal strip between two rings with the same vertex count (parapet tops, ledges). */
function strip(B, outer, inner, y, kind) {
  const n = outer.length / 2;
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    const a = B.v(outer[i], y, outer[i + 1], 0, 0, 1, 0, kind), b = B.v(outer[j], y, outer[j + 1], 0, 0, 1, 0, kind);
    const c = B.v(inner[j], y, inner[j + 1], 0, 0, 1, 0, kind), d = B.v(inner[i], y, inner[i + 1], 0, 0, 1, 0, kind);
    B.quad(a, b, c, d);
  }
}

// ------------------------------------------------------------------ roofs
function roofFlat(B, rings, H, ph, simple) {
  if (simple || ph < 0.15) { capPolygon(B, rings, H, KIND.roofFlat); return; }
  const tw = 0.24;
  const inner = [];
  for (const r of rings) { const q = insetRing(r, tw); if (!q) { capPolygon(B, rings, H, KIND.roofFlat); return; } inner.push(q); }
  for (let k = 0; k < rings.length; k++) {
    strip(B, rings[k], inner[k], H, KIND.trim);
    walls(B, inner[k], H - ph, H, KIND.trim, null, true);
  }
  capPolygon(B, inner, H - ph, KIND.roofFlat);
}

// rectangle corner helper: centre + s*a*(hl) + t*p*(hw) in data coords
function rc(o, s, t) { return [o.cx + s * o.ax - t * o.ay, o.cy + s * o.ay + t * o.ax]; }

/** Gable / hip family on the oriented rectangle. hipFrac: 0 = full gable, 1 = full hip. */
function roofPitched(B, o, H, pitchDeg, eave, hipFrac, kind, gableKind) {
  const tanP = Math.tan(pitchDeg * Math.PI / 180);
  const rh = o.hw * tanP;                          // ridge above the wall top
  const ye = H - eave * tanP, yr = H + rh;
  const hlE = o.hl + (hipFrac > 0 ? eave : Math.min(eave, 0.35)), hwE = o.hw + eave;
  const hip = Math.min(o.hl, o.hw * hipFrac);      // how far the ridge ends are pulled in
  const c = (s, t, hl, hw) => rc(o, s * hl, t * hw);
  const e00 = c(-1, -1, hlE, hwE), e10 = c(1, -1, hlE, hwE), e11 = c(1, 1, hlE, hwE), e01 = c(-1, 1, hlE, hwE);
  const r0 = c(-1, 0, hipFrac > 0 ? o.hl - hip : hlE, 0), r1 = c(1, 0, hipFrac > 0 ? o.hl - hip : hlE, 0);
  const P = (p, y) => [p[0], y, p[1]];
  // long slopes
  B.face([P(e00, ye), P(e10, ye), P(r1, yr), P(r0, yr)], kind, -(-o.ay), 0.5, -(o.ax));
  B.face([P(e11, ye), P(e01, ye), P(r0, yr), P(r1, yr)], kind, -o.ay, 0.5, o.ax);
  if (hipFrac > 0) {
    B.face([P(e10, ye), P(e11, ye), P(r1, yr)], kind, o.ax, 0.5, o.ay);
    B.face([P(e01, ye), P(e00, ye), P(r0, yr)], kind, -o.ax, 0.5, -o.ay);
    if (hipFrac < 1) {
      // half hip: small gable triangle above the hip
      // (the ridge end sits inside the wall line, the hip face already closes the volume)
    }
  } else {
    // gable walls up to the roof
    const g0a = c(-1, -1, o.hl, o.hw), g0b = c(-1, 1, o.hl, o.hw), g0r = c(-1, 0, o.hl, 0);
    const g1a = c(1, -1, o.hl, o.hw), g1b = c(1, 1, o.hl, o.hw), g1r = c(1, 0, o.hl, 0);
    B.face([P(g0a, H), P(g0b, H), P(g0r, yr)], gableKind, -o.ax, 0, -o.ay);
    B.face([P(g1a, H), P(g1b, H), P(g1r, yr)], gableKind, o.ax, 0, o.ay);
  }
  return yr;
}

function roofPyramid(B, o, H, pitchDeg, eave, kind) {
  const tanP = Math.tan(pitchDeg * Math.PI / 180);
  const ye = H - eave * tanP, ya = H + Math.min(o.hw, o.hl) * tanP;
  const hl = o.hl + eave, hw = o.hw + eave;
  const e = [rc(o, -hl, -hw), rc(o, hl, -hw), rc(o, hl, hw), rc(o, -hl, hw)];
  const apex = [o.cx, ya, o.cy];
  const dirs = [[o.ay, -o.ax], [o.ax, o.ay], [-o.ay, o.ax], [-o.ax, -o.ay]];
  for (let k = 0; k < 4; k++) { const a = e[k], b = e[(k + 1) % 4]; B.face([[a[0], ye, a[1]], [b[0], ye, b[1]], apex], kind, dirs[k][0], 0.5, dirs[k][1]); }
  return ya;
}

/** Chinese hip-and-gable (xieshan): a hipped skirt with upturned corners, and a gabled upper part. */
function roofXieshan(B, o, H, eave, kind, trimKind) {
  const skirt = Math.min(o.hw * 0.45, 2.6);                 // plan depth of the lower hipped skirt
  const y0 = H - 0.25, y1 = H + skirt * 0.55, yr = y1 + (o.hw - skirt) * 0.78;
  const hlE = o.hl + eave, hwE = o.hw + eave, hlI = o.hl - skirt, hwI = o.hw - skirt;
  const lift = 0.35 + eave * 0.25;                          // corners curl up
  const E = [rc(o, -hlE, -hwE), rc(o, hlE, -hwE), rc(o, hlE, hwE), rc(o, -hlE, hwE)];
  const I = [rc(o, -hlI, -hwI), rc(o, hlI, -hwI), rc(o, hlI, hwI), rc(o, -hlI, hwI)];
  const dirs = [[o.ay, -o.ax], [o.ax, o.ay], [-o.ay, o.ax], [-o.ax, -o.ay]];
  for (let k = 0; k < 4; k++) {
    const a = E[k], b = E[(k + 1) % 4], ia = I[k], ib = I[(k + 1) % 4];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], im = [(ia[0] + ib[0]) / 2, (ia[1] + ib[1]) / 2];
    // two panels per side so the eave line sags in the middle and rises at the corners
    B.face([[a[0], y0 + lift, a[1]], [m[0], y0, m[1]], [im[0], y1, im[1]], [ia[0], y1, ia[1]]], kind, dirs[k][0], 0.6, dirs[k][1]);
    B.face([[m[0], y0, m[1]], [b[0], y0 + lift, b[1]], [ib[0], y1, ib[1]], [im[0], y1, im[1]]], kind, dirs[k][0], 0.6, dirs[k][1]);
  }
  // upper gabled part over the inner rectangle
  const r0 = rc(o, -hlI, 0), r1 = rc(o, hlI, 0);
  B.face([[I[0][0], y1, I[0][1]], [I[1][0], y1, I[1][1]], [r1[0], yr, r1[1]], [r0[0], yr, r0[1]]], kind, o.ay, 0.5, -o.ax);
  B.face([[I[2][0], y1, I[2][1]], [I[3][0], y1, I[3][1]], [r0[0], yr, r0[1]], [r1[0], yr, r1[1]]], kind, -o.ay, 0.5, o.ax);
  B.face([[I[3][0], y1, I[3][1]], [I[0][0], y1, I[0][1]], [r0[0], yr, r0[1]]], trimKind, -o.ax, 0, -o.ay);
  B.face([[I[1][0], y1, I[1][1]], [I[2][0], y1, I[2][1]], [r1[0], yr, r1[1]]], trimKind, o.ax, 0, o.ay);
  // ridge beam
  const rw = 0.22, rhh = 0.45;
  const q = (s, t) => rc(o, s * hlI, t * rw);
  B.face([[q(-1, -1)[0], yr + rhh, q(-1, -1)[1]], [q(1, -1)[0], yr + rhh, q(1, -1)[1]], [q(1, 1)[0], yr + rhh, q(1, 1)[1]], [q(-1, 1)[0], yr + rhh, q(-1, 1)[1]]], trimKind, 0, 1, 0);
  B.face([[q(-1, -1)[0], yr - 0.2, q(-1, -1)[1]], [q(1, -1)[0], yr - 0.2, q(1, -1)[1]], [q(1, -1)[0], yr + rhh, q(1, -1)[1]], [q(-1, -1)[0], yr + rhh, q(-1, -1)[1]]], trimKind, o.ay, 0, -o.ax);
  B.face([[q(1, 1)[0], yr - 0.2, q(1, 1)[1]], [q(-1, 1)[0], yr - 0.2, q(-1, 1)[1]], [q(-1, 1)[0], yr + rhh, q(-1, 1)[1]], [q(1, 1)[0], yr + rhh, q(1, 1)[1]]], trimKind, -o.ay, 0, o.ax);
  return yr + rhh;
}

/** Generic pitched roof for any footprint: slopes rise from every edge to an inset ring, flat on top. */
function roofInsetHip(B, ring, H, pitchDeg, depth, kind) {
  const inner = insetRing(ring, depth);
  if (!inner) return false;
  const y1 = H + depth * Math.tan(pitchDeg * Math.PI / 180);
  const n = ring.length / 2;
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    const ex = ring[j] - ring[i], en = ring[j + 1] - ring[i + 1];
    const len = Math.hypot(ex, en) || 1;
    B.face([[ring[i], H, ring[i + 1]], [ring[j], H, ring[j + 1]], [inner[j], y1, inner[j + 1]], [inner[i], y1, inner[i + 1]]], kind, en / len, 0.6, -ex / len);
  }
  capPolygon(B, [inner], y1, kind);
  return true;
}

function roofSawtooth(B, o, H, kind, glassKind) {
  const teeth = Math.max(2, Math.round(o.hl * 2 / 9));
  const w = o.hl * 2 / teeth, rise = Math.min(3.2, w * 0.38);
  for (let t = 0; t < teeth; t++) {
    const s0 = -o.hl + t * w, s1 = s0 + w;
    const a0 = rc(o, s0, -o.hw), a1 = rc(o, s0, o.hw), b0 = rc(o, s1, -o.hw), b1 = rc(o, s1, o.hw);
    // glazed riser at s0, slope down to s1
    B.face([[a0[0], H, a0[1]], [a1[0], H, a1[1]], [a1[0], H + rise, a1[1]], [a0[0], H + rise, a0[1]]], glassKind, -o.ax, 0, -o.ay);
    B.face([[a0[0], H + rise, a0[1]], [a1[0], H + rise, a1[1]], [b1[0], H, b1[1]], [b0[0], H, b0[1]]], kind, o.ax, 0.7, o.ay);
    // triangular cheeks
    B.face([[a0[0], H, a0[1]], [b0[0], H, b0[1]], [a0[0], H + rise, a0[1]]], KIND.wall, o.ay, 0, -o.ax);
    B.face([[a1[0], H, a1[1]], [b1[0], H, b1[1]], [a1[0], H + rise, a1[1]]], KIND.wall, -o.ay, 0, o.ax);
  }
  return H + rise;
}

function roofDome(B, ring, H, kind) {
  // low cone / dome over a round footprint (tanks, silos)
  const n = ring.length / 2;
  let cx = 0, cy = 0;
  for (let k = 0; k < n; k++) { cx += ring[k * 2]; cy += ring[k * 2 + 1]; }
  cx /= n; cy /= n;
  let rad = 0;
  for (let k = 0; k < n; k++) rad += Math.hypot(ring[k * 2] - cx, ring[k * 2 + 1] - cy);
  rad /= n;
  const rise = Math.min(rad * 0.28, 6);
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    const mx = (ring[i] + ring[j]) / 2 - cx, mn = (ring[i + 1] + ring[j + 1]) / 2 - cy;
    const l = Math.hypot(mx, mn) || 1;
    B.face([[ring[i], H, ring[i + 1]], [ring[j], H, ring[j + 1]], [cx, H + rise, cy]], kind, mx / l, 1, mn / l);
  }
  return H + rise;
}

// ------------------------------------------------------------------ one building
function hash01(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function addBuilding(B, rings, eflags, rec, opts) {
  const { style, roof, seed, pal, flags } = rec;
  const S = STYLE[style] || STYLE[0];
  const base = rec.base, H = rec.base + rec.height;
  let levels = Math.max(1, rec.levels);
  // facade grid: ground floor, regular upper floors, cap band
  let gH = Math.min(S.ground, rec.height);
  const pitchedRoof = roof !== ROOF.flat;
  let ph = pitchedRoof ? 0 : Math.min(S.parapet, rec.height * 0.25);
  if (style === ST.tank || style === ST.canopy) ph = 0;
  const cap = ph + (pitchedRoof ? 0.25 : 0.35);
  let fH = S.floor;
  const upper = rec.height - gH - cap;
  if (levels > 1 && upper > 2.2) {
    fH = upper / (levels - 1);
    if (fH < 2.6 || fH > 6.2) { levels = 1 + Math.max(1, Math.round(upper / S.floor)); fH = upper / (levels - 1); }
  } else if (upper > 2.6) { levels = 1 + Math.max(1, Math.round(upper / S.floor)); fH = upper / (levels - 1); } else { levels = 1; gH = rec.height - cap; fH = S.floor; }
  if (base > 0.5) { fH = Math.min(6.2, Math.max(2.8, S.floor)); gH = fH; levels = Math.max(2, Math.ceil((H - cap) / fH)); }
  B.b0 = style; B.b1 = seed; B.b2 = pal; B.b3 = Math.min(255, levels);
  B.e1 = Math.min(65535, Math.round(H * Q));
  B.f1 = Math.max(1, Math.min(255, Math.round(fH * Q))); B.f2 = Math.max(1, Math.min(255, Math.round(gH * 20))); B.f3 = flags;
  const outer = rings[0];
  if (opts.mass) {
    for (let k = 0; k < rings.length; k++) walls(B, rings[k], base, H, KIND.mass, null);
    capPolygon(B, rings, H, KIND.mass);
    return;
  }
  for (let k = 0; k < rings.length; k++) walls(B, rings[k], base, H, KIND.wall, eflags[k]);
  B.e0 = 0;
  // underside for raised parts (bridging blocks, sky lobbies)
  if (base > 1.5 && !opts.simple) { const b0 = B.n; capPolygon(B, rings, base, KIND.soffit); for (let i = b0 * 4 + 1; i < B.n * 4; i += 4) B.nrm[i] = -127; flipLast(B, b0); }
  if (style === ST.canopy) { capPolygon(B, rings, H, KIND.roofMetal); return; }
  const simple = opts.simple;
  let done = false;
  if (pitchedRoof && rings.length === 1) {
    const o = obb(outer);
    const fill = o ? Math.abs(ringArea(outer)) / Math.max(o.area, 1e-3) : 0;
    const tile = style === ST.industrial ? KIND.roofMetal : KIND.roofTile;
    if (roof === ROOF.dome || roof === ROOF.round) { roofDome(B, outer, H, KIND.roofMetal); done = true; }
    else if (o && fill >= 0.86 && o.hw > 1.2) {
      if (roof === ROOF.gable || roof === ROOF.shed) { roofPitched(B, o, H, roof === ROOF.shed ? 11 : S.pitch, S.eave, 0, tile, KIND.wall); done = true; }
      else if (roof === ROOF.hip) { roofPitched(B, o, H, S.pitch, S.eave, o.hl / o.hw > 1.25 ? 1 : 1, tile, KIND.wall); done = true; }
      else if (roof === ROOF.pyramid) { roofPyramid(B, o, H, S.pitch + 6, S.eave, tile); done = true; }
      else if (roof === ROOF.xieshan) { if (o.hw > 2.4) roofXieshan(B, o, H, Math.min(S.eave, o.hw * 0.4), tile, KIND.trim); else roofPitched(B, o, H, 30, 0.5, 1, tile, KIND.wall); done = true; }
      else if (roof === ROOF.sawtooth) { roofSawtooth(B, o, H, KIND.roofMetal, KIND.glass); done = true; }
      else if (roof === ROOF.mansard) { done = roofInsetHip(B, outer, H, 62, Math.min(1.6, o.hw * 0.5), tile); }
    }
    if (!done && o && roof !== ROOF.sawtooth) {
      // irregular plan: slopes in from every edge
      const depth = Math.min(o.hw * 0.72, 5.5);
      done = roofInsetHip(B, outer, H, style === ST.industrial ? 11 : S.pitch, depth, tile);
    }
  }
  if (!done) roofFlat(B, rings, H, ph, simple);
}

// flip the winding of the triangles added since vertex index v0 (used for downward-facing caps)
function flipLast(B, v0) {
  for (let i = B.ni - 3; i >= 0; i -= 3) {
    if (B.idx[i] < v0) break;
    const t = B.idx[i + 1]; B.idx[i + 1] = B.idx[i + 2]; B.idx[i + 2] = t;
  }
}

/**
 * d: decoded building section (see data.js). opts: { count, simple, mass, half }
 *   count  build only the first `count` records (they are sorted most-important-first)
 *   simple far LOD: flat caps, no parapets
 */
export function buildBuildings(d, opts = {}) {
  const B = new MeshBuilder(Math.max(1024, d.nv * 5), Math.max(2048, d.nv * 9));
  const count = Math.min(opts.count ?? d.nb, d.nb);
  const half = (opts.tile ?? 1000) / 2;
  let vi = 0, ri = 0;
  const rec = {};
  for (let b = 0; b < d.nb; b++) {
    const nr = d.nrings[b];
    if (b >= count) break;
    const rings = [], eflags = [];
    let px = 0, py = 0;
    for (let r = 0; r < nr; r++) {
      const n = d.ringsize[ri++];
      const ring = new Float32Array(n * 2);
      for (let k = 0; k < n; k++, vi++) { px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1]; ring[k * 2] = px * 0.1 - half; ring[k * 2 + 1] = py * 0.1 - half; }
      // walls face away from the solid only if the outer ring runs counter-clockwise and holes clockwise: enforce it
      let ef = d.edge.subarray(vi - n, vi);
      const a = ringArea(ring);
      if ((r === 0 && a < 0) || (r > 0 && a > 0)) {
        const rr = new Float32Array(n * 2), re = new Uint8Array(n);
        for (let k = 0; k < n; k++) { rr[k * 2] = ring[(n - 1 - k) * 2]; rr[k * 2 + 1] = ring[(n - 1 - k) * 2 + 1]; re[k] = ef[(2 * n - 2 - k) % n]; }
        rings.push(rr); eflags.push(re);
      } else { rings.push(ring); eflags.push(ef); }
    }
    rec.height = d.height[b] * 0.1; rec.base = d.base[b] * 0.1; rec.levels = d.levels[b]; rec.style = d.style[b]; rec.roof = d.roof[b];
    rec.seed = d.seed[b]; rec.pal = d.pal[b]; rec.flags = d.flags[b];
    if (rec.height < 0.5) continue;
    // far LOD keeps what still reads from kilometres away
    if (opts.far && rec.height < 26 && Math.abs(ringArea(rings[0])) < 650) continue;
    addBuilding(B, rings, eflags, rec, opts);
  }
  return B.finish();
}

/**
 * One extruded slice in the building vertex format, for hand-modelled landmarks built as stacks of prisms.
 * ring: flat [x, north] pairs, counter-clockwise, metres relative to the mesh origin.
 */
export function addPrism(B, ring, y0, y1, o = {}) {
  B.b0 = o.style ?? 20; B.b1 = o.seed ?? 0; B.b2 = o.pal ?? 0; B.b3 = 255;
  B.e1 = Math.min(65535, Math.round((o.top ?? y1) * Q));
  B.f1 = Math.max(1, Math.min(255, Math.round((o.fH ?? 4.2) * Q))); B.f2 = Math.max(1, Math.min(255, Math.round((o.gH ?? o.fH ?? 4.2) * 20))); B.f3 = 0;
  walls(B, ring, y0, y1, o.kind ?? KIND.wall, null);
  B.e0 = 0;
  if (o.cap !== false) capPolygon(B, [ring], y1, o.capKind ?? KIND.roofFlat);
  if (o.bottom) { const b0 = B.n; capPolygon(B, [ring], y0, KIND.soffit); for (let i = b0 * 4 + 1; i < B.n * 4; i += 4) B.nrm[i] = -127; flipLast(B, b0); }
}
