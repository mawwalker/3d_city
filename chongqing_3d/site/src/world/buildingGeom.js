// Chongqing 3D building geometry generator (runs in Web Worker).
// Turns decoded Tile v2 ('CQT2') building records + DEM terrain elevation into merged, shadow-casting PBR meshes:
//   - ZERO floating buildings: per-corner DEM terrain sampling + stepped sandstone retaining wall plinths (石砌堡坎)
//     and cantilevered Bayu timber stilt bases (吊脚楼架空底层) descending 4m below the lowest footprint corner!
//   - Multi-part 3D massing: articulated commercial podiums, inset setback towers, mechanical louver floors, sculpted crowns
//   - Real 3D parapet walls with overhanging coping, pitched/hipped/Bayu upturned tile roofs with projecting eaves & rafters
//   - Delegates LOD0/LOD1 street-level & upper-facade true-3D detail generation to facadeKit.js
//
// Vertex layout (exact Float32 positions for 550m+ mountain relief + 458m supertalls + sub-mm 3D mullions/balconies):
//   aPos   Float32 x4  x, y, z in metres relative to tile centre (y up, z south); w = u along wall edge (or local 0..1)
//   aNrm   Int8 x4     world normal (snorm -127..127) + surface kind (KIND 0..127)
//   aBld   Uint8 x4    style, seed, palette, levels
//   aEdge  Float32 x4  walls: (edgeLen, topLocalH, yRef, podiumH); UV-local 3D kit boxes: (boxH, auxSeed, boxY0, aspect)
//   aFlag  Uint8 x4    edge flags (1 street front, 2 party wall), floor height (1/40 m), ground-floor height (1/20 m), building flags

import earcut from '../../vendor/earcut/earcut.js';
import { ST, ROOF, KIND, BMASK, STYLE, hash11, computeStoreys } from './styles.js';
import { addFacadeDetails } from './facadeKit.js';

export const Q = 40;
const MAX_LOD0_TRIS_PER_TILE = 880000;

export class MeshBuilder {
  constructor(vcap = 16384, icap = 32768) {
    this.pos = new Float32Array(vcap * 4);
    this.nrm = new Int8Array(vcap * 4);
    this.bld = new Uint8Array(vcap * 4);
    this.edge = new Float32Array(vcap * 4);
    this.flag = new Uint8Array(vcap * 4);
    this.idx = new Uint32Array(icap);
    this.n = 0;
    this.ni = 0;
    this.minX = 1e9; this.maxX = -1e9;
    this.minZ = 1e9; this.maxZ = -1e9;
    this.minY = 1e9; this.maxY = -1e9;
    this.b0 = 0; this.b1 = 0; this.b2 = 0; this.b3 = 0;   // aBld
    this.e0 = 0; this.e1 = 0; this.e2 = 0; this.e3 = 0;   // aEdge (Float32 x4)
    this.f0 = 0; this.f1 = 0; this.f2 = 0; this.f3 = 0;   // aFlag
  }

  growV(extra) {
    if ((this.n + extra) * 4 <= this.pos.length) return;
    const cap = Math.max(this.pos.length / 2, this.n + extra + 2048);
    const g = (A, per) => { const a = new A.constructor(cap * per); a.set(A); return a; };
    this.pos = g(this.pos, 4);
    this.nrm = g(this.nrm, 4);
    this.bld = g(this.bld, 4);
    this.edge = g(this.edge, 4);
    this.flag = g(this.flag, 4);
  }

  growI(extra) {
    if (this.ni + extra <= this.idx.length) return;
    const a = new Uint32Array(Math.max(this.idx.length * 2, this.ni + extra + 4096));
    a.set(this.idx);
    this.idx = a;
  }

  /** x east, y up, n north (metres, relative to tile centre); normal in the same (x, y, n) frame. */
  v(x, y, n, u, nx, ny, nn, kind) {
    this.growV(1);
    const o = this.n * 4, z = -n;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.pos[o + 3] = u;
    this.nrm[o] = Math.round(nx * 127);
    this.nrm[o + 1] = Math.round(ny * 127);
    this.nrm[o + 2] = Math.round(-nn * 127);
    this.nrm[o + 3] = kind;
    this.bld[o] = this.b0; this.bld[o + 1] = this.b1; this.bld[o + 2] = this.b2; this.bld[o + 3] = this.b3;
    this.edge[o] = this.e0; this.edge[o + 1] = this.e1; this.edge[o + 2] = this.e2; this.edge[o + 3] = this.e3;
    this.flag[o] = this.f0; this.flag[o + 1] = this.f1; this.flag[o + 2] = this.f2; this.flag[o + 3] = this.f3;
    if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
    if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
    return this.n++;
  }

  tri(a, b, c) {
    this.growI(3);
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  quad(a, b, c, d) {
    this.growI(6);
    const i = this.idx;
    let n = this.ni;
    i[n++] = a; i[n++] = b; i[n++] = c;
    i[n++] = a; i[n++] = c; i[n++] = d;
    this.ni = n;
  }

  /** Flat-shaded planar polygon [x, y, n, (optional u)]: normal forced to hemisphere of (hx, hy, hn). */
  face(pts, kind, hx = 0, hy = 1, hn = 0, uAlong = false) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], un = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vn = c[2] - a[2];
    let nx = -(uy * vn - un * vy), ny = -(un * vx - ux * vn), nn = -(ux * vy - uy * vx);
    const l = Math.hypot(nx, ny, nn) || 1;
    nx /= l; ny /= l; nn /= l;
    let flip = false;
    if (nx * hx + ny * hy + nn * hn < 0) { nx = -nx; ny = -ny; nn = -nn; flip = true; }
    const base = this.n;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      this.v(p[0], p[1], p[2], uAlong ? (p[3] || 0) : 0, nx, ny, nn, kind);
    }
    const front = !flip;
    for (let k = 1; k + 1 < pts.length; k++) {
      if (front) this.tri(base, base + k, base + k + 1);
      else this.tri(base, base + k + 1, base + k);
    }
  }

  finish() {
    const n = this.n;
    const empty = n === 0;
    return {
      pos: this.pos.slice(0, n * 4),
      nrm: this.nrm.slice(0, n * 4),
      bld: this.bld.slice(0, n * 4),
      edge: this.edge.slice(0, n * 4),
      flag: this.flag.slice(0, n * 4),
      index: this.idx.slice(0, this.ni),
      nVerts: n,
      nTris: this.ni / 3,
      bounds: empty ? [0, 0, 0, 0, 0, 0] : [this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ],
    };
  }
}

// ------------------------------------------------------------------ Ring geometry helpers
export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a / 2;
}

/** Minimum-area oriented bounding box: {cx, cy, ax, ay, hl, hw, area} with (ax, ay) unit long axis. */
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
      const p0 = r[k] * ex + r[k + 1] * ey;
      const p1 = -r[k] * ey + r[k + 1] * ex;
      if (p0 < mn0) mn0 = p0; if (p0 > mx0) mx0 = p0;
      if (p1 < mn1) mn1 = p1; if (p1 > mx1) mx1 = p1;
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

/** Offset ring inward (positive d) or outward (negative d) with mitred corners. Returns null if self-inverting. */
export function insetRing(r, d) {
  const n = r.length / 2;
  if (n < 3) return null;
  const out = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const i = ((k + n - 1) % n) * 2, j = k * 2, l = ((k + 1) % n) * 2;
    let ax = r[j] - r[i], ay = r[j + 1] - r[i + 1];
    let bx = r[l] - r[j], by = r[l + 1] - r[j + 1];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const n0x = -ay, n0y = ax, n1x = -by, n1y = bx;
    const dot = n0x * n1x + n0y * n1y;
    let mx = n0x + n1x, my = n0y + n1y;
    const k2 = 1 + dot;
    const maxMiter = d < 0 ? 1.25 : 1.8;
    if (k2 < 0.25) {
      const ml = Math.hypot(mx, my) || 1;
      mx = mx / ml * maxMiter; my = my / ml * maxMiter;
    } else {
      mx /= k2; my /= k2;
      const ml = Math.hypot(mx, my);
      if (ml > maxMiter) { mx = mx / ml * maxMiter; my = my / ml * maxMiter; }
    }
    out[j] = r[j] + mx * d;
    out[j + 1] = r[j + 1] + my * d;
  }
  for (let k = 0; k < n; k++) {
    const j = k * 2, l = ((k + 1) % n) * 2;
    if ((out[l] - out[j]) * (r[l] - r[j]) + (out[l + 1] - out[j + 1]) * (r[l + 1] - r[j + 1]) <= 0) return null;
  }
  const a0 = ringArea(r), a1 = ringArea(out);
  if (d > 0 && (a0 * a1 <= 0 || Math.abs(a1) < 0.05 * Math.abs(a0))) return null;
  if (d < 0 && a0 * a1 <= 0) return null;
  return out;
}

export function capPolygon(B, rings, y, kind) {
  let total = 0;
  for (const r of rings) total += r.length;
  const flat = new Float64Array(total);
  const holes = [];
  let o = 0;
  for (let k = 0; k < rings.length; k++) {
    if (k > 0) holes.push(o / 2);
    flat.set(rings[k], o);
    o += rings[k].length;
  }
  const tris = earcut(flat, holes.length ? holes : null, 2);
  const base = B.n;
  for (let i = 0; i < total; i += 2) B.v(flat[i], y, flat[i + 1], 0, 0, 1, 0, kind);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
    if (cr > 0) B.tri(base + a, base + b, base + c);
    else B.tri(base + a, base + c, base + b);
  }
}

export function flipLast(B, v0) {
  for (let i = B.ni - 3; i >= 0; i -= 3) {
    if (B.idx[i] < v0) break;
    const t = B.idx[i + 1]; B.idx[i + 1] = B.idx[i + 2]; B.idx[i + 2] = t;
  }
}

export function walls(B, r, y0, y1, kind, ef, inward = false) {
  const n = r.length / 2;
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    const ex = r[j] - r[i], en = r[j + 1] - r[i + 1];
    const len = Math.hypot(ex, en);
    if (len < 0.03) continue;
    let nx = en / len, nn = -ex / len;
    B.e0 = len;
    B.f0 = ef ? ef[k] : 0;
    if (!inward) {
      const a = B.v(r[i], y0, r[i + 1], 0, nx, 0, nn, kind);
      const b = B.v(r[j], y0, r[j + 1], len, nx, 0, nn, kind);
      const c = B.v(r[j], y1, r[j + 1], len, nx, 0, nn, kind);
      const dd = B.v(r[i], y1, r[i + 1], 0, nx, 0, nn, kind);
      B.quad(a, b, c, dd);
    } else {
      nx = -nx; nn = -nn;
      const a = B.v(r[j], y0, r[j + 1], 0, nx, 0, nn, kind);
      const b = B.v(r[i], y0, r[i + 1], len, nx, 0, nn, kind);
      const c = B.v(r[i], y1, r[i + 1], len, nx, 0, nn, kind);
      const dd = B.v(r[j], y1, r[j + 1], 0, nx, 0, nn, kind);
      B.quad(a, b, c, dd);
    }
  }
  B.f0 = 0;
}

export function strip(B, outer, inner, y, kind, down = false) {
  const n = outer.length / 2;
  const ny = down ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    const a = B.v(outer[i], y, outer[i + 1], 0, 0, ny, 0, kind);
    const b = B.v(outer[j], y, outer[j + 1], 0, 0, ny, 0, kind);
    const c = B.v(inner[j], y, inner[j + 1], 0, 0, ny, 0, kind);
    const d = B.v(inner[i], y, inner[i + 1], 0, 0, ny, 0, kind);
    if (!down) B.quad(a, b, c, d);
    else B.quad(a, d, c, b);
  }
}

/** Sloped batter walls connecting a wider bottom ring to a slightly narrower top ring (sandstone retaining plinths). */
function batteredWalls(B, rBot, rTop, y0, y1, kind) {
  const n = rTop.length / 2;
  const dy = y1 - y0;
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    const ex = rTop[j] - rTop[i], en = rTop[j + 1] - rTop[i + 1];
    const len = Math.hypot(ex, en);
    if (len < 0.04) continue;
    B.e0 = len;
    B.face([
      [rBot[i], y0, rBot[i + 1], 0],
      [rBot[j], y0, rBot[j + 1], len],
      [rTop[j], y1, rTop[j + 1], len],
      [rTop[i], y1, rTop[i + 1], 0],
    ], kind, en / len, Math.max(0.05, 0.22 / Math.max(dy, 1)), -ex / len, true);
  }
}

// ------------------------------------------------------------------ Terrain anchoring & Mountain-City Foundations
/** Sample exact terrain min/max across all footprint vertices & edges so buildings NEVER float or bury uphill on Chongqing slopes. */
export function resolveFootprintGround(outer, ef, rec, sampleY) {
  let zMin = Number.isFinite(rec.gzMin) ? rec.gzMin : 1e9;
  let zMax = Number.isFinite(rec.gzMax) ? rec.gzMax : -1e9;

  if (sampleY) {
    let sMin = 1e9, sMax = -1e9;
    const n = outer.length / 2;
    let cx = 0, cn = 0;
    const pushY = (x, nn) => {
      const y = sampleY(x, nn);
      if (Number.isFinite(y)) {
        if (y < sMin) sMin = y;
        if (y > sMax) sMax = y;
      }
    };
    for (let k = 0; k < n; k++) {
      const rx = outer[k * 2], rn = outer[k * 2 + 1];
      cx += rx; cn += rn;
      pushY(rx, rn);
      // Dense edge sampling catches narrow 2.5m road-benched cuts & cliff breaks inside long footprints
      const nk = ((k + 1) % n) * 2;
      const nx = outer[nk], nn = outer[nk + 1];
      const len = Math.hypot(nx - rx, nn - rn);
      if (len > 18) {
        pushY(rx + (nx - rx) * 0.333, rn + (nn - rn) * 0.333);
        pushY(rx + (nx - rx) * 0.667, rn + (nn - rn) * 0.667);
      } else if (len > 6) {
        pushY((rx + nx) * 0.5, (rn + nn) * 0.5);
      }
    }
    pushY(cx / n, cn / n);
    if (sMin < 1e8) {
      // Trust live TerrainField (includes 2.5m road-benched terrain_core.bin!) as single source of truth
      zMin = sMin;
      zMax = sMax;
    }
  }

  if (zMin > 1e8 || zMax < -1e8) { zMin = 0; zMax = 0; }
  const slope = Math.max(0, zMax - zMin);
  // Anchor yRef cleanly at zMax + 4cm so uphill entrances/shopfronts NEVER sink half-underground into cut slopes,
  // while downhill sides expose authentic Chongqing dressed-sandstone retaining walls (石砌堡坎)!
  const yRef = zMax + 0.04;
  const safeMin = Number.isFinite(rec.gzMin) ? Math.min(zMin, rec.gzMin) : zMin;
  const yBot = safeMin - Math.max(6.0, Math.min(12.0, slope * 0.35 + 4.5));
  return { zMin, zMax, slope, yRef, yBot };
}

/** Build authentic Chongqing mountain-city sandstone retaining plinths (堡坎) or Bayu cantilevered stilts (吊脚楼) — strictly flush with lot line! */
function buildFoundation(B, outer, ef, rec, gnd, lod, sampleY) {
  const { style, balconyMask } = rec;
  const S = STYLE[style] || STYLE[0];
  const { zMin, slope, yRef, yBot } = gnd;
  const plinthH = yRef - yBot;
  if (plinthH < 0.2) return;

  const isBayuStilt = (style === ST.bayu_vernacular || (balconyMask & BMASK.stiltsBase)) && slope >= 1.6 && lod === 0;
  const plinthKind = S.foundation === 'granite' ? KIND.podiumWall : (S.foundation === 'concrete' ? KIND.trim : KIND.plinthStone);

  if (isBayuStilt) {
    // Lower flush sandstone base up to stoneTop (0.0m outward encroachment into steep lanes/neighbors!),
    // then dark timber stilt piers & cross-braced columns up to yRef!
    const stoneTop = Math.min(yRef - 1.4, zMin + Math.max(1.2, slope * 0.35));
    walls(B, outer, yBot, stoneTop, KIND.plinthStone, null);
    // Recessed shaded stone core wall behind timber stilts (prevents seeing empty void underneath)
    const core = insetRing(outer, 0.75);
    if (core) {
      walls(B, core, stoneTop - 0.2, yRef, KIND.plinthStone, null);
      strip(B, outer, core, stoneTop, KIND.trim);
      strip(B, outer, core, yRef - 0.24, KIND.soffit, true);
    } else {
      walls(B, outer, stoneTop, yRef, KIND.plinthStone, null);
    }
    const n = outer.length / 2;
    for (let k = 0; k < n; k++) {
      const i = k * 2, j = ((k + 1) % n) * 2;
      const ex = outer[j] - outer[i], en = outer[j + 1] - outer[i + 1];
      const len = Math.hypot(ex, en);
      if (len < 1.2) continue;
      const tx = ex / len, tn = en / len, nx = tn, nn = -tx;
      const nCols = Math.max(2, Math.min(6, Math.round(len / 3.2) + 1));
      for (let c = 0; c < nCols; c++) {
        const u = (c / (nCols - 1)) * len;
        const px = outer[i] + tx * u - nx * 0.14, pn = outer[i + 1] + tn * u - nn * 0.14;
        const r = 0.14;
        // Square dark timber stilt column tucked cleanly flush inside footprint
        const pts = [[px - r, pn - r], [px + r, pn - r], [px + r, pn + r], [px - r, pn + r]];
        for (let s = 0; s < 4; s++) {
          const p0 = pts[s], p1 = pts[(s + 1) % 4];
          const sx = p1[0] - p0[0], sn = p1[1] - p0[1], sl = Math.hypot(sx, sn) || 1;
          B.face([[p0[0], stoneTop - 0.2, p0[1]], [p1[0], stoneTop - 0.2, p1[1]], [p1[0], yRef, p1[1]], [p0[0], yRef, p0[1]]],
            KIND.timber, sn / sl, 0, -sx / sl, false);
        }
      }
      // Horizontal timber tie-beam at yRef (8cm proud of outer wall — zero Z-fighting!)
      B.face([
        [outer[i] + nx * 0.08, yRef - 0.28, outer[i + 1] + nn * 0.08, 0],
        [outer[j] + nx * 0.08, yRef - 0.28, outer[j + 1] + nn * 0.08, len],
        [outer[j] + nx * 0.08, yRef - 0.01, outer[j + 1] + nn * 0.08, len],
        [outer[i] + nx * 0.08, yRef - 0.01, outer[i + 1] + nn * 0.08, 0],
      ], KIND.timber, nx, 0, nn, true);
    }
    return;
  }

  // Standard Chongqing mountain-city sandstone retaining wall plinth (堡坎):
  // Built STRICTLY FLUSH with building footprint (0.0m outward spread — ZERO road/sidewalk/party-wall clipping!).
  const capY = yRef;
  walls(B, outer, yBot, capY, plinthKind, null);

  if (lod === 0 && slope > 1.0) {
    const n = outer.length / 2;
    for (let k = 0; k < n; k++) {
      if (ef && (ef[k] & 2)) continue; // never protrude across party walls!
      const i = k * 2, j = ((k + 1) % n) * 2;
      const ex = outer[j] - outer[i], en = outer[j + 1] - outer[i + 1];
      const len = Math.hypot(ex, en);
      if (len < 1.2) continue;
      const tx = ex / len, tn = en / len, nx = tn, nn = -tx;
      const mx = (outer[i] + outer[j]) * 0.5, mn = (outer[i + 1] + outer[j + 1]) * 0.5;
      const gMid = sampleY ? sampleY(mx + nx * 0.5, mn + nn * 0.5) : zMin;
      const exposedMid = capY - (Number.isFinite(gMid) ? gMid : zMin);

      // Subtle 9cm beveled sandstone coping molding cleanly below yRef (inset 4cm from corners -> zero corner Z-fighting!)
      if (exposedMid >= 0.35 && len >= 1.4) {
        const ld = 0.09, pad = 0.04;
        const a0x = outer[i] + tx * pad, a0n = outer[i + 1] + tn * pad;
        const a1x = outer[j] - tx * pad, a1n = outer[j + 1] - tn * pad;
        const b0x = a0x + nx * ld, b0n = a0n + nn * ld, b1x = a1x + nx * ld, b1n = a1n + nn * ld;
        const clen = len - 2 * pad;
        B.face([[b0x, capY - 0.18, b0n, 0], [b1x, capY - 0.18, b1n, clen], [b1x, capY - 0.02, b1n, clen], [b0x, capY - 0.02, b0n, 0]], KIND.trim, nx, 0, nn, true);
        B.face([[a0x, capY - 0.02, a0n, 0], [a1x, capY - 0.02, a1n, clen], [b1x, capY - 0.02, b1n, clen], [b0x, capY - 0.02, b0n, 0]], KIND.trim, 0, 1, 0, true);
        B.face([[b0x, capY - 0.18, b0n, 0], [b1x, capY - 0.18, b1n, clen], [a1x, capY - 0.18, a1n, clen], [a0x, capY - 0.18, a0n, 0]], KIND.soffit, 0, -1, 0, true);
      }

      // Slim 22cm architectural sandstone retaining buttresses strictly on deep exposed downhill cliff faces (>= 1.5m drop!)
      if (slope >= 3.5 && len >= 6.0 && exposedMid >= 1.5) {
        const nb = Math.min(5, Math.floor(len / 5.5));
        for (let bi = 1; bi <= nb; bi++) {
          const u = (bi / (nb + 1)) * len;
          const ux = outer[i] + tx * u, un = outer[i + 1] + tn * u;
          const gLoc = sampleY ? sampleY(ux + nx * 0.5, un + nn * 0.5) : gMid;
          if (capY - (Number.isFinite(gLoc) ? gLoc : gMid) < 1.35) continue; // keep uphill shallow sidewalk 100% clear!
          const bw = 0.48, bd = 0.22;
          const a0x = ux - tx * bw * 0.5, a0n = un - tn * bw * 0.5;
          const a1x = ux + tx * bw * 0.5, a1n = un + tn * bw * 0.5;
          const b0x = a0x + nx * bd, b0n = a0n + nn * bd;
          const b1x = a1x + nx * bd, b1n = a1n + nn * bd;
          B.face([[b0x, yBot, b0n, 0], [b1x, yBot, b1n, bw], [b1x, capY - 0.16, b1n, bw], [b0x, capY - 0.16, b0n, 0]], plinthKind, nx, 0.05, nn, true);
          B.face([[a0x, yBot, a0n, 0], [b0x, yBot, b0n, bd], [b0x, capY - 0.16, b0n, bd], [a0x, capY - 0.16, a0n, 0]], plinthKind, -tx, 0, -tn, true);
          B.face([[b1x, yBot, b1n, 0], [a1x, yBot, a1n, bd], [a1x, capY - 0.16, a1n, bd], [b1x, capY - 0.16, b1n, 0]], plinthKind, tx, 0, tn, true);
          B.face([[a0x, capY - 0.16, a0n, 0], [a1x, capY - 0.16, a1n, bw], [b1x, capY - 0.16, b1n, bw], [b0x, capY - 0.16, b0n, 0]], KIND.trim, 0, 1, 0, true);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ Roofs (Flat parapet, Pitched Bayu, Xieshan, Stepped Crown, Sawtooth, Dome)
function roofFlat(B, rings, H, ph, simple, style, lod) {
  if (simple || ph < 0.15) {
    capPolygon(B, rings, H, KIND.roofFlat);
    return;
  }
  const tw = 0.28;
  const inner = [];
  for (const r of rings) {
    const q = insetRing(r, tw);
    if (!q) { capPolygon(B, rings, H, KIND.roofFlat); return; }
    inner.push(q);
  }
  for (let k = 0; k < rings.length; k++) {
    strip(B, rings[k], inner[k], H, KIND.trim);
    walls(B, inner[k], H - ph, H, KIND.trim, null, true);
  }
  capPolygon(B, inner, H - ph, KIND.roofFlat);

  // Rooftop perimeter safety handrail on LOD0 tall residential/office roofs
  if (lod === 0 && ph >= 0.9 && rings.length === 1 && (style === ST.resi_modern || style === ST.office_grid || style === ST.hotel)) {
    const rail = insetRing(rings[0], 0.14);
    if (rail) {
      walls(B, rail, H + 0.05, H + 0.30, KIND.railMetal, null, false);
    }
  }
}

/** Sculpted stepped skyscraper crown / illuminated penthouse cap (ROOF.stepped_crown or tall CBD towers). */
function roofSteppedCrown(B, rings, H, ph, style, lod) {
  roofFlat(B, rings, H, ph, false, style, lod);
  if (rings.length !== 1) return;
  const outer = rings[0];
  const o = obb(outer);
  if (!o || o.hw < 4.5) return;
  const tier1 = insetRing(outer, Math.min(2.4, o.hw * 0.22));
  if (!tier1) return;
  const h1 = Math.min(6.5, Math.max(3.2, o.hw * 0.35));
  walls(B, tier1, H - ph + 0.04, H + h1, KIND.equipment, null);
  const tier1In = insetRing(tier1, 0.25);
  if (tier1In) {
    strip(B, tier1, tier1In, H + h1, KIND.trim);
    walls(B, tier1In, H + h1 - 0.8, H + h1, KIND.trim, null, true);
    capPolygon(B, [tier1In], H + h1 - 0.8, KIND.roofFlat);
  } else {
    capPolygon(B, [tier1], H + h1, KIND.roofFlat);
  }
  // Illuminated architectural crown rim on CBD towers (14cm proud of tier1, strictly below cap H+h1!)
  if (lod <= 1 && (style === ST.cbd_supertall || style === ST.office_glass || style === ST.hotel)) {
    const ledOut = insetRing(tier1, -0.14);
    if (ledOut) walls(B, ledOut, H + h1 - 0.62, H + h1 - 0.08, KIND.ledStrip, null);
  }
}

function rc(o, s, t) {
  return [o.cx + s * o.ax - t * o.ay, o.cy + s * o.ay + t * o.ax];
}

/** Pitched / hipped roof with real projecting 3D eaves, timber/trim fascia, underside soffit, and ridge beam. */
function roofPitched(B, o, H, pitchDeg, eave, hipFrac, kind, gableKind, trimKind, lod) {
  const tanP = Math.tan(pitchDeg * Math.PI / 180);
  const rh = Math.min(o.hw * tanP, 9.5);
  const ye = H - eave * tanP, yr = H + rh;
  const hlE = o.hl + (hipFrac > 0 ? eave : Math.min(eave, 0.55));
  const hwE = o.hw + eave;
  const hip = Math.min(o.hl, o.hw * hipFrac);
  const c = (s, t, hl, hw) => rc(o, s * hl, t * hw);
  const e00 = c(-1, -1, hlE, hwE), e10 = c(1, -1, hlE, hwE), e11 = c(1, 1, hlE, hwE), e01 = c(-1, 1, hlE, hwE);
  const r0 = c(-1, 0, hipFrac > 0 ? o.hl - hip : hlE, 0);
  const r1 = c(1, 0, hipFrac > 0 ? o.hl - hip : hlE, 0);
  const P = (p, y) => [p[0], y, p[1]];

  // Upper roof slopes
  B.face([P(e00, ye), P(e10, ye), P(r1, yr), P(r0, yr)], kind, o.ay, 0.55, -o.ax);
  B.face([P(e11, ye), P(e01, ye), P(r0, yr), P(r1, yr)], kind, -o.ay, 0.55, o.ax);

  if (hipFrac > 0) {
    B.face([P(e10, ye), P(e11, ye), P(r1, yr)], kind, o.ax, 0.55, o.ay);
    B.face([P(e01, ye), P(e00, ye), P(r0, yr)], kind, -o.ax, 0.55, -o.ay);
  } else {
    const g0a = c(-1, -1, o.hl, o.hw), g0b = c(-1, 1, o.hl, o.hw), g0r = c(-1, 0, o.hl, 0);
    const g1a = c(1, -1, o.hl, o.hw), g1b = c(1, 1, o.hl, o.hw), g1r = c(1, 0, o.hl, 0);
    B.face([P(g0a, H), P(g0b, H), P(g0r, yr)], gableKind, -o.ax, 0, -o.ay);
    B.face([P(g1a, H), P(g1b, H), P(g1r, yr)], gableKind, o.ax, 0, o.ay);
  }

  // Real 3D eave fascia thickness + underside soffit (visible from 1.7m eye height looking UP!)
  if (lod <= 1 && eave >= 0.25) {
    const fH = 0.20;
    const E = [e00, e10, e11, e01];
    const W = [c(-1, -1, o.hl, o.hw), c(1, -1, o.hl, o.hw), c(1, 1, o.hl, o.hw), c(-1, 1, o.hl, o.hw)];
    const dirs = [[o.ay, -o.ax], [o.ax, o.ay], [-o.ay, o.ax], [-o.ax, -o.ay]];
    for (let k = 0; k < 4; k++) {
      const a = E[k], b = E[(k + 1) % 4], wa = W[k], wb = W[(k + 1) % 4];
      // Vertical fascia board at eave edge
      B.face([P(a, ye - fH), P(b, ye - fH), P(b, ye), P(a, ye)], trimKind, dirs[k][0], 0, dirs[k][1]);
      // Shaded eave soffit underside closing gap back to wall
      B.face([P(a, ye - fH), P(b, ye - fH), P(wb, ye - fH), P(wa, ye - fH)], KIND.soffit, 0, -1, 0);
    }
    // 3D ridge cap beam along spine
    const rw = 0.16, rhh = 0.24;
    const q = (s, t) => rc(o, s * (hipFrac > 0 ? o.hl - hip : hlE), t * rw);
    B.face([P(q(-1, -1), yr + rhh), P(q(1, -1), yr + rhh), P(q(1, 1), yr + rhh), P(q(-1, 1), yr + rhh)], trimKind, 0, 1, 0);
    B.face([P(q(-1, -1), yr - 0.08), P(q(1, -1), yr - 0.08), P(q(1, -1), yr + rhh), P(q(-1, -1), yr + rhh)], trimKind, o.ay, 0, -o.ax);
    B.face([P(q(1, 1), yr - 0.08), P(q(-1, 1), yr - 0.08), P(q(-1, 1), yr + rhh), P(q(1, 1), yr + rhh)], trimKind, -o.ay, 0, o.ax);
  }
  return yr;
}

function roofPyramid(B, o, H, pitchDeg, eave, kind) {
  const tanP = Math.tan(pitchDeg * Math.PI / 180);
  const ye = H - eave * tanP;
  const ya = H + Math.min(o.hw, o.hl) * tanP;
  const hl = o.hl + eave, hw = o.hw + eave;
  const e = [rc(o, -hl, -hw), rc(o, hl, -hw), rc(o, hl, hw), rc(o, -hl, hw)];
  const apex = [o.cx, ya, o.cy];
  const dirs = [[o.ay, -o.ax], [o.ax, o.ay], [-o.ay, o.ax], [-o.ax, -o.ay]];
  for (let k = 0; k < 4; k++) {
    const a = e[k], b = e[(k + 1) % 4];
    B.face([[a[0], ye, a[1]], [b[0], ye, b[1]], apex], kind, dirs[k][0], 0.5, dirs[k][1]);
  }
  return ya;
}

/** Bayu / Chinese hip-and-gable (xieshan) with upturned flying eaves (飞檐翘角), underside soffits, and ridge beam. */
function roofXieshan(B, o, H, eave, kind, trimKind) {
  const skirt = Math.min(o.hw * 0.45, 2.6);
  const y0 = H - 0.25, y1 = H + skirt * 0.55, yr = y1 + (o.hw - skirt) * 0.78;
  const hlE = o.hl + eave, hwE = o.hw + eave, hlI = o.hl - skirt, hwI = o.hw - skirt;
  const lift = 0.42 + eave * 0.30;
  const E = [rc(o, -hlE, -hwE), rc(o, hlE, -hwE), rc(o, hlE, hwE), rc(o, -hlE, hwE)];
  const I = [rc(o, -hlI, -hwI), rc(o, hlI, -hwI), rc(o, hlI, hwI), rc(o, -hlI, hwI)];
  const W = [rc(o, -o.hl, -o.hw), rc(o, o.hl, -o.hw), rc(o, o.hl, o.hw), rc(o, -o.hl, o.hw)];
  const dirs = [[o.ay, -o.ax], [o.ax, o.ay], [-o.ay, o.ax], [-o.ax, -o.ay]];
  for (let k = 0; k < 4; k++) {
    const a = E[k], b = E[(k + 1) % 4], ia = I[k], ib = I[(k + 1) % 4];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], im = [(ia[0] + ib[0]) / 2, (ia[1] + ib[1]) / 2];
    B.face([[a[0], y0 + lift, a[1]], [m[0], y0, m[1]], [im[0], y1, im[1]], [ia[0], y1, ia[1]]], kind, dirs[k][0], 0.6, dirs[k][1]);
    B.face([[m[0], y0, m[1]], [b[0], y0 + lift, b[1]], [ib[0], y1, ib[1]], [im[0], y1, im[1]]], kind, dirs[k][0], 0.6, dirs[k][1]);
    // Shaded eave underside soffit
    const wa = W[k], wb = W[(k + 1) % 4];
    B.face([[a[0], y0 + lift - 0.16, a[1]], [b[0], y0 + lift - 0.16, b[1]], [wb[0], y0 - 0.16, wb[1]], [wa[0], y0 - 0.16, wa[1]]], KIND.soffit, 0, -1, 0);
  }
  const r0 = rc(o, -hlI, 0), r1 = rc(o, hlI, 0);
  B.face([[I[0][0], y1, I[0][1]], [I[1][0], y1, I[1][1]], [r1[0], yr, r1[1]], [r0[0], yr, r0[1]]], kind, o.ay, 0.5, -o.ax);
  B.face([[I[2][0], y1, I[2][1]], [I[3][0], y1, I[3][1]], [r0[0], yr, r0[1]], [r1[0], yr, r1[1]]], kind, -o.ay, 0.5, o.ax);
  B.face([[I[3][0], y1, I[3][1]], [I[0][0], y1, I[0][1]], [r0[0], yr, r0[1]]], trimKind, -o.ax, 0, -o.ay);
  B.face([[I[1][0], y1, I[1][1]], [I[2][0], y1, I[2][1]], [r1[0], yr, r1[1]]], trimKind, o.ax, 0, o.ay);
  // Sculpted ridge beam with upturned ridge finials
  const rw = 0.22, rhh = 0.45;
  const q = (s, t) => rc(o, s * hlI, t * rw);
  B.face([[q(-1, -1)[0], yr + rhh, q(-1, -1)[1]], [q(1, -1)[0], yr + rhh, q(1, -1)[1]], [q(1, 1)[0], yr + rhh, q(1, 1)[1]], [q(-1, 1)[0], yr + rhh, q(-1, 1)[1]]], trimKind, 0, 1, 0);
  B.face([[q(-1, -1)[0], yr - 0.2, q(-1, -1)[1]], [q(1, -1)[0], yr - 0.2, q(1, -1)[1]], [q(1, -1)[0], yr + rhh, q(1, -1)[1]], [q(-1, -1)[0], yr + rhh, q(-1, -1)[1]]], trimKind, o.ay, 0, -o.ax);
  B.face([[q(1, 1)[0], yr - 0.2, q(1, 1)[1]], [q(-1, 1)[0], yr - 0.2, q(-1, 1)[1]], [q(-1, 1)[0], yr + rhh, q(-1, 1)[1]], [q(1, 1)[0], yr + rhh, q(1, 1)[1]]], trimKind, -o.ay, 0, o.ax);
  return yr + rhh;
}

function roofInsetHip(B, ring, H, pitchDeg, depth, kind, eave = 0, trimKind = KIND.trim) {
  const outer = eave > 0.05 ? (insetRing(ring, -eave) || ring) : ring;
  const inner = insetRing(ring, depth);
  if (!inner) return false;
  const tanP = Math.tan(pitchDeg * Math.PI / 180);
  const ye = H - eave * tanP;
  const y1 = H + depth * tanP;
  const n = ring.length / 2;
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    const ex = outer[j] - outer[i], en = outer[j + 1] - outer[i + 1];
    const len = Math.hypot(ex, en) || 1;
    B.face([[outer[i], ye, outer[i + 1]], [outer[j], ye, outer[j + 1]], [inner[j], y1, inner[j + 1]], [inner[i], y1, inner[i + 1]]],
      kind, en / len, 0.6, -ex / len);
  }
  if (outer !== ring) strip(B, outer, ring, ye, KIND.soffit, true);
  capPolygon(B, [inner], y1, kind);
  return true;
}

function roofSawtooth(B, o, H, kind, glassKind) {
  const teeth = Math.max(2, Math.round(o.hl * 2 / 9));
  const w = o.hl * 2 / teeth, rise = Math.min(3.2, w * 0.38);
  for (let t = 0; t < teeth; t++) {
    const s0 = -o.hl + t * w, s1 = s0 + w;
    const a0 = rc(o, s0, -o.hw), a1 = rc(o, s0, o.hw), b0 = rc(o, s1, -o.hw), b1 = rc(o, s1, o.hw);
    B.face([[a0[0], H, a0[1]], [a1[0], H, a1[1]], [a1[0], H + rise, a1[1]], [a0[0], H + rise, a0[1]]], glassKind, -o.ax, 0, -o.ay);
    B.face([[a0[0], H + rise, a0[1]], [a1[0], H + rise, a1[1]], [b1[0], H, b1[1]], [b0[0], H, b0[1]]], kind, o.ax, 0.7, o.ay);
    B.face([[a0[0], H, a0[1]], [b0[0], H, b0[1]], [a0[0], H + rise, a0[1]]], KIND.wall, o.ay, 0, -o.ax);
    B.face([[a1[0], H, a1[1]], [b1[0], H, b1[1]], [a1[0], H + rise, a1[1]]], KIND.wall, -o.ay, 0, o.ax);
  }
  return H + rise;
}

function roofDome(B, ring, H, kind) {
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

/** Shared setback tower ring computation (used by buildingGeom.js and roofGeom.js so roof clutter never overhangs!). */
export function computeTowerRing(outer, rec, podiumH) {
  const S = STYLE[rec.style] || STYLE[0];
  if ((rec.base || 0) >= 0.5 || podiumH <= 0 || S.setback <= 0.4) return null;
  const o = obb(outer);
  if (!o || o.hw < 6.5 || Math.abs(ringArea(outer)) < 220) return null;
  const sb = Math.min(S.setback, o.hw * 0.22);
  const inset = insetRing(outer, sb);
  if (!inset || Math.abs(ringArea(inset)) < 0.36 * Math.abs(ringArea(outer))) return null;
  return inset;
}

// ------------------------------------------------------------------ Single building builder
function addBuilding(B, rings, eflags, rec, opts, sampleY, budgetRatio) {
  // Never allow urban mid/high-rise buildings to render as blank windowless shells (parking/construction/tank/canopy)
  if ((rec.height >= 16 && (rec.style === ST.construction || rec.style === ST.parking || rec.style === ST.tank || rec.style === ST.canopy)) ||
      (rec.height >= 24 && rec.style === ST.industrial)) {
    rec.style = rec.height >= 55 ? ST.office_glass : ST.office_grid;
  }
  const { style, roof, seed, pal, flags } = rec;
  const lod = opts.lod ?? (opts.far ? 2 : opts.simple ? 1 : 0);
  const simple = opts.simple || lod >= 2;
  const outer = rings[0];

  // Sanitize party-wall edge flags: street-facing edges (ef & 1), raised tower parts (base > 0.5),
  // tall towers (>= 26m), or footprints with >65% party edges MUST NOT suppress facades/windows!
  if (eflags[0]) {
    const ef0 = eflags[0];
    let pCnt = 0, streetParty = false;
    for (let k = 0; k < ef0.length; k++) {
      if (ef0[k] & 2) { pCnt++; if (ef0[k] & 1) streetParty = true; }
    }
    const clearAll = pCnt > 0 && (rec.base > 0.5 || rec.height >= 26 || pCnt / ef0.length > 0.65);
    if (clearAll || streetParty) {
      const cleaned = new Uint8Array(ef0.length);
      for (let k = 0; k < ef0.length; k++) {
        cleaned[k] = (clearAll || (ef0[k] & 1)) ? (ef0[k] & ~2) : ef0[k];
      }
      eflags[0] = cleaned;
    }
  }

  // 1. Resolve true mountain-city terrain elevation across footprint
  const gnd = resolveFootprintGround(outer, eflags[0], rec, sampleY);
  const { yRef, yBot } = gnd;
  const yStart = yRef + rec.base;
  const H = yStart + rec.height;

  const st = computeStoreys(rec);
  const { S, levels, fH, gH, ph, podiumH } = st;

  B.b0 = style; B.b1 = seed; B.b2 = pal; B.b3 = Math.min(255, levels);
  B.e0 = 0;
  B.e1 = rec.base + rec.height;
  B.e2 = yRef;
  B.e3 = podiumH;
  B.f1 = Math.max(1, Math.min(255, Math.round(fH * Q)));
  B.f2 = Math.max(1, Math.min(255, Math.round(gH * 20)));
  B.f3 = flags;

  // Distant block mass proxy
  if (opts.mass) {
    for (let k = 0; k < rings.length; k++) walls(B, rings[k], yBot, H, KIND.mass, null);
    capPolygon(B, rings, H, KIND.mass);
    return;
  }

  // 2. Mountain-city foundation plinth (ZERO floating on Chongqing slopes, strictly flush with footprint!)
  if (rec.base < 0.5) {
    buildFoundation(B, outer, eflags[0], rec, gnd, lod, sampleY);
  }

  // 3. Multi-part 3D massing: Commercial Podium + Inset Setback Tower (for tall buildings > 22m!)
  const towerRing = (!simple && rings.length === 1) ? computeTowerRing(outer, rec, podiumH) : null;

  if (towerRing) {
    // Ground Podium (full footprint, yStart -> yStart + podiumH)
    const yPod = yStart + podiumH;
    walls(B, outer, yStart, yPod, KIND.wall, eflags[0]);
    // Podium setback roof terrace + real parapet around terrace rim
    const podInner = insetRing(outer, 0.26);
    if (podInner && lod <= 1) {
      strip(B, outer, podInner, yPod + 0.85, KIND.trim);
      walls(B, outer, yPod, yPod + 0.85, KIND.trim, null);
      walls(B, podInner, yPod, yPod + 0.85, KIND.trim, null, true);
    }
    strip(B, podInner || outer, towerRing, yPod, KIND.roofFlat);

    // Setback Upper Tower (inset footprint, yPod -> H)
    walls(B, towerRing, yPod, H, KIND.wall, null);
  } else {
    // Full-footprint shaft (podium still articulated via facadeKit piers & belt cornice!)
    for (let k = 0; k < rings.length; k++) {
      walls(B, rings[k], yStart, H, KIND.wall, eflags[k]);
    }
  }

  B.e0 = 0;
  // Underside soffit for raised building parts (skybridges, cantilevered blocks)
  if (rec.base > 1.0 && !simple) {
    const b0 = B.n;
    capPolygon(B, rings, yStart, KIND.soffit);
    for (let i = b0 * 4 + 1; i < B.n * 4; i += 4) B.nrm[i] = -127;
    flipLast(B, b0);
  }

  // 4. Roofs (Flat parapet, Stepped Crown, Pitched Bayu Tile, Xieshan, Sawtooth, Dome)
  if (style === ST.canopy) {
    capPolygon(B, rings, H, KIND.roofMetal);
    return;
  }

  const roofRings = towerRing ? [towerRing] : rings;
  const roofOuter = roofRings[0];
  const pitchedRoof = roof !== ROOF.flat && roof !== ROOF.stepped_crown;
  let done = false;

  if (pitchedRoof && roofRings.length === 1) {
    const o = obb(roofOuter);
    const fill = o ? Math.abs(ringArea(roofOuter)) / Math.max(o.area, 1e-3) : 0;
    const tile = style === ST.industrial || style === ST.bigroof ? KIND.roofMetal : KIND.roofTile;
    const trimK = (style === ST.bayu_vernacular || style === ST.temple) ? KIND.timber : KIND.trim;

    if (roof === ROOF.dome || roof === ROOF.round) {
      roofDome(B, roofOuter, H, KIND.roofMetal);
      done = true;
    } else if (o && fill >= 0.82 && o.hw > 1.2) {
      if (roof === ROOF.gable || roof === ROOF.shed) {
        roofPitched(B, o, H, roof === ROOF.shed ? 11 : S.pitch, S.eave, 0, tile, KIND.wall, trimK, lod);
        done = true;
      } else if (roof === ROOF.hip) {
        roofPitched(B, o, H, S.pitch, S.eave, 1, tile, KIND.wall, trimK, lod);
        done = true;
      } else if (roof === ROOF.pyramid) {
        roofPyramid(B, o, H, S.pitch + 6, S.eave, tile);
        done = true;
      } else if (roof === ROOF.xieshan) {
        if (o.hw > 2.2) roofXieshan(B, o, H, Math.min(S.eave, o.hw * 0.45), tile, trimK);
        else roofPitched(B, o, H, 30, 0.65, 1, tile, KIND.wall, trimK, lod);
        done = true;
      } else if (roof === ROOF.sawtooth) {
        roofSawtooth(B, o, H, KIND.roofMetal, KIND.glass);
        done = true;
      } else if (roof === ROOF.mansard) {
        done = roofInsetHip(B, roofOuter, H, 62, Math.min(1.6, o.hw * 0.5), tile, 0.25, trimK);
      }
    }
    if (!done && o && roof !== ROOF.sawtooth) {
      const depth = Math.min(o.hw * 0.72, 5.5);
      done = roofInsetHip(B, roofOuter, H, style === ST.industrial ? 11 : S.pitch, depth, tile, S.eave * 0.6, trimK);
    }
  }

  if (!done) {
    const wantsCrown = !simple && (roof === ROOF.stepped_crown ||
      ((style === ST.cbd_supertall || style === ST.office_glass) && rec.height >= 68 && hash11(seed * 1.31) > 0.35));
    if (wantsCrown) {
      roofSteppedCrown(B, roofRings, H, ph, style, lod);
    } else {
      roofFlat(B, roofRings, H, ph, simple, style, lod);
    }
  }

  // 5. True-3D Architectural Facade Relief Kit (LOD0 full street-level realism + LOD1 tall tower fins!)
  if (lod <= 1 && rec.height >= 3.2) {
    addFacadeDetails(B, outer, eflags[0], towerRing, rec, {
      ...st, yRef, yBot, H, lod, budgetRatio, sampleY, slope: gnd.slope,
    });
  }
}

/** Decode all rings & records from one decoded building section and append into MeshBuilder `B`. */
function appendBuildingSection(B, d, opts, sampleY) {
  if (!d || !d.nb) return;
  const count = Math.min(opts.count ?? d.nb, d.nb);
  const half = (opts.tile ?? 1000) / 2;
  const lod = opts.lod ?? (opts.far ? 2 : opts.simple ? 1 : 0);
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
      for (let k = 0; k < n; k++, vi++) {
        px += d.xy[vi * 2];
        py += d.xy[vi * 2 + 1];
        ring[k * 2] = px * 0.1 - half;
        ring[k * 2 + 1] = py * 0.1 - half;
      }
      const ef = d.edge ? d.edge.subarray(vi - n, vi) : new Uint8Array(n);
      const a = ringArea(ring);
      if ((r === 0 && a < 0) || (r > 0 && a > 0)) {
        const rr = new Float32Array(n * 2), re = new Uint8Array(n);
        for (let k = 0; k < n; k++) {
          rr[k * 2] = ring[(n - 1 - k) * 2];
          rr[k * 2 + 1] = ring[(n - 1 - k) * 2 + 1];
          re[k] = ef[(2 * n - 2 - k) % n];
        }
        rings.push(rr); eflags.push(re);
      } else {
        rings.push(ring); eflags.push(ef);
      }
    }

    rec.height = d.height[b] * 0.1;
    rec.base = d.base[b] * 0.1;
    rec.gzMin = d.ground_z_min ? d.ground_z_min[b] * 0.1 : NaN;
    rec.gzMax = d.ground_z_max ? d.ground_z_max[b] * 0.1 : NaN;
    rec.levels = d.levels[b];
    rec.style = d.style[b];
    rec.roof = d.roof[b];
    rec.seed = d.seed[b];
    rec.pal = d.pal[b];
    rec.flags = d.flags[b];
    rec.podiumH = d.podium_h ? d.podium_h[b] * 0.25 : 0;
    rec.balconyMask = d.balcony_mask ? d.balcony_mask[b] : 0;
    rec.subtype = d.subtype ? d.subtype[b] : 0;

    if (rec.height < 0.5) continue;
    if (opts.far && rec.height < 26 && Math.abs(ringArea(rings[0])) < 650) continue;

    const budgetRatio = lod === 0 ? (B.ni / 3) / MAX_LOD0_TRIS_PER_TILE : 0;
    addBuilding(B, rings, eflags, rec, opts, sampleY, budgetRatio);
  }
}

/**
 * Build merged building mesh for one tile (accepts a single decoded section OR an array of sections `[farBld, nearBld]`).
 * opts: { count, simple, far, mass, lod, tile, ox, oy, cx, cz, origin, terrain, sampleTerrain }
 */
export function buildBuildings(input, opts = {}) {
  const list = Array.isArray(input) ? input.filter(Boolean) : (input ? [input] : []);
  let totalNv = 0;
  for (const d of list) totalNv += d.nv || 0;
  const lod = opts.lod ?? (opts.far ? 2 : opts.simple ? 1 : 0);
  const vMult = lod === 0 ? 18 : 6;
  const B = new MeshBuilder(Math.max(2048, totalNv * vMult), Math.max(4096, totalNv * vMult * 2));

  const tile = opts.tile ?? 1000;
  const half = tile / 2;
  const ox = opts.ox ?? (opts.origin ? opts.origin[0] : 0);
  const oy = opts.oy ?? (opts.origin ? opts.origin[1] : 0);
  const cx = opts.cx ?? (ox + half);
  const cz = opts.cz ?? -(oy + half);

  let sampleY = null;
  if (opts.terrain && typeof opts.terrain.sample === 'function') {
    const T = opts.terrain;
    sampleY = (rx, rn) => T.sample(cx + rx, cz - rn);
  } else if (typeof opts.sampleTerrain === 'function') {
    const fn = opts.sampleTerrain;
    sampleY = (rx, rn) => fn(cx + rx, cz - rn);
  }

  for (const d of list) {
    appendBuildingSection(B, d, opts, sampleY);
  }
  return B.finish();
}

export const buildNearBuildings = buildBuildings;

/**
 * Extruded slice in the building vertex format (backwards-compatible helper for landmarks/tests).
 */
export function addPrism(B, ring, y0, y1, o = {}) {
  B.b0 = o.style ?? ST.landmark_glass;
  B.b1 = o.seed ?? 0;
  B.b2 = o.pal ?? 0;
  B.b3 = 255;
  B.e0 = 0;
  B.e1 = (o.top ?? y1) - (o.yRef ?? y0);
  B.e2 = o.yRef ?? y0;
  B.e3 = o.podiumH ?? 0;
  B.f1 = Math.max(1, Math.min(255, Math.round((o.fH ?? 4.2) * Q)));
  B.f2 = Math.max(1, Math.min(255, Math.round((o.gH ?? o.fH ?? 4.2) * 20)));
  B.f3 = 0;
  walls(B, ring, y0, y1, o.kind ?? KIND.wall, null);
  B.e0 = 0;
  if (o.cap !== false) capPolygon(B, [ring], y1, o.capKind ?? KIND.roofFlat);
  if (o.bottom) {
    const b0 = B.n;
    capPolygon(B, [ring], y0, KIND.soffit);
    for (let i = b0 * 4 + 1; i < B.n * 4; i += 4) B.nrm[i] = -127;
    flipLast(B, b0);
  }
}
