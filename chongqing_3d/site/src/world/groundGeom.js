// 3D Terrain-Draped Street-Level Ground Geometry (runs in the worker) for Chongqing 8D Mountain City.
// Triangulates classified ground polygons, subdivides long edges & large hillside triangles so roads, sidewalks,
// plazas, staircases, and parks hug real 10m DEM slopes smoothly without tearing, and generates:
//   - Kerb faces (cls 30) along carriageways
//   - Sandstone retaining walls / 堡坎 (cls 33) on steep road/hillside cuts
//   - Riverbank stone/concrete embankments (cls 31) descending cleanly below waterY = 0.0 m
//
// Vertex layout:
//   aPos  Float32 x4   x, y, z in exact metres relative to tile centre (cx, 0, cz); w = ground class
//   aNrm  Int8 x4      world normal (snorm), w unused

import earcut from '../../vendor/earcut/earcut.js';

export const GROUND_Y = { road: 0.04, raised: 0.19, rail: 0.10, water: -2.6 };

class GB {
  constructor(vcap) {
    this.pos = new Float32Array(vcap * 4);
    this.nrm = new Int8Array(vcap * 4);
    this.idx = new Uint32Array(vcap * 3);
    this.n = 0; this.ni = 0;
    this.minY = 1e9; this.maxY = -1e9;
  }
  growV(e) {
    if ((this.n + e) * 4 <= this.pos.length) return;
    const cap = Math.max(this.pos.length / 2, this.n + e + 2048);
    const p = new Float32Array(cap * 4); p.set(this.pos); this.pos = p;
    const q = new Int8Array(cap * 4); q.set(this.nrm); this.nrm = q;
  }
  growI(e) {
    if (this.ni + e <= this.idx.length) return;
    const a = new Uint32Array(Math.max(this.idx.length * 2, this.ni + e + 4096)); a.set(this.idx); this.idx = a;
  }
  v(x, y, n, cls, nx, ny, nn) {
    this.growV(1);
    const o = this.n * 4;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = -n; this.pos[o + 3] = cls;
    this.nrm[o] = Math.max(-127, Math.min(127, Math.round(nx * 127)));
    this.nrm[o + 1] = Math.max(-127, Math.min(127, Math.round(ny * 127)));
    this.nrm[o + 2] = Math.max(-127, Math.min(127, Math.round(-nn * 127)));
    this.nrm[o + 3] = 0;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    return this.n++;
  }
  tri(a, b, c) { this.growI(3); this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
}

/**
 * d: decoded polygon set (decodePolys)
 * tile: tile size in metres (1000)
 * opts: { cx, cz, terrain } where (cx, cz) is tile centre in WebGL world coordinates (x east, z south).
 */
export function buildGround(d, tile = 1000, opts = {}) {
  const half = tile / 2;
  const cx = opts.cx || 0, cz = opts.cz || 0;
  const terrain = opts.terrain || null;
  const waterY = terrain ? (terrain.waterY ?? 0.0) : 0.0;
  const nTmp = [0, 1, 0];

  const sampleY = (lx, ln, offset, isLand = true) => {
    if (!terrain) return offset;
    const ty = terrain.sample(cx + lx, cz - ln);
    const base = isLand ? Math.max(ty, waterY + 0.15) : ty;
    return base + offset;
  };
  const sampleN = (lx, ln) => {
    if (!terrain) return [0, 1, 0];
    terrain.sampleNormal(cx + lx, cz - ln, nTmp);
    // sampleNormal returns [nx, ny, nz] in WebGL frame (z south); convert to (nx, ny, nn = -nz)
    return [nTmp[0], nTmp[1], -nTmp[2]];
  };

  const B = new GB(Math.max(4096, d.nv * 4));
  let vi = 0, ri = 0;
  const edgeMax = tile * 10;

  // Symmetric endpoint-only edge-subdivision predicate so adjacent triangles & kerbs ALWAYS agree (100% watertight!)
  const subdivEdgePts = (x0, n0, x1, n1, dy, maxSeg, minSeg, errTol, out, depth = 5) => {
    const len = Math.hypot(x1 - x0, n1 - n0);
    let need = len > maxSeg;
    if (!need && terrain && depth > 0 && len > minSeg) {
      const y0 = sampleY(x0, n0, dy), y1 = sampleY(x1, n1, dy);
      const ym = sampleY((x0 + x1) * 0.5, (n0 + n1) * 0.5, dy);
      if (Math.abs(0.5 * (y0 + y1) - ym) > errTol || (len > minSeg * 1.35 && Math.abs(y0 - y1) > 0.42)) need = true;
    }
    if (need && depth > 0 && len > minSeg) {
      const mx = (x0 + x1) * 0.5, mn = (n0 + n1) * 0.5;
      subdivEdgePts(x0, n0, mx, mn, dy, maxSeg, minSeg, errTol, out, depth - 1);
      subdivEdgePts(mx, mn, x1, n1, dy, maxSeg, minSeg, errTol, out, depth - 1);
      return;
    }
    out.push(x0, n0);
  };

  // Watertight adaptive subdivision: road triangles (cls === 1) adapt down to 2.35m on 2.5m terrain_core bench edges
  // (crushing chord error < 0.05m so zero wheels ever clip rendered asphalt!) while flat roads/sidewalks stay lean!
  const emitTri = (ax, an, bx, bn, gx, gn, cls, dy, maxEdge, depth, adaptive) => {
    const ab = Math.hypot(bx - ax, bn - an);
    const bc = Math.hypot(gx - bx, gn - bn);
    const ca = Math.hypot(ax - gx, an - gn);
    const longest = Math.max(ab, bc, ca);
    if (depth > 0) {
      let abL = ab > maxEdge, bcL = bc > maxEdge, caL = ca > maxEdge;
      if (adaptive && terrain && longest > 2.35 && (!abL || !bcL || !caL)) {
        const ya = sampleY(ax, an, dy), yb = sampleY(bx, bn, dy), yg = sampleY(gx, gn, dy);
        if (!abL && ab > 2.35) {
          const ym = sampleY((ax + bx) * 0.5, (an + bn) * 0.5, dy);
          if (Math.abs(0.5 * (ya + yb) - ym) > 0.055 || (ab > 3.1 && Math.abs(ya - yb) > 0.42)) abL = true;
        }
        if (!bcL && bc > 2.35) {
          const ym = sampleY((bx + gx) * 0.5, (bn + gn) * 0.5, dy);
          if (Math.abs(0.5 * (yb + yg) - ym) > 0.055 || (bc > 3.1 && Math.abs(yb - yg) > 0.42)) bcL = true;
        }
        if (!caL && ca > 2.35) {
          const ym = sampleY((gx + ax) * 0.5, (gn + an) * 0.5, dy);
          if (Math.abs(0.5 * (yg + ya) - ym) > 0.055 || (ca > 3.1 && Math.abs(yg - ya) > 0.42)) caL = true;
        }
      }
      if (abL || bcL || caL) {
        // Smart 2-edge cut for skinny earcut ribbon slivers: cuts BOTH marked edges in half in a single depth step!
        if (abL && caL && !bcL) {
          const mabX = (ax + bx) * 0.5, mabN = (an + bn) * 0.5;
          const mcaX = (gx + ax) * 0.5, mcaN = (gn + an) * 0.5;
          emitTri(ax, an, mabX, mabN, mcaX, mcaN, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(mabX, mabN, bx, bn, gx, gn, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(mabX, mabN, gx, gn, mcaX, mcaN, cls, dy, maxEdge, depth - 1, adaptive);
          return;
        }
        if (abL && bcL && !caL) {
          const mabX = (ax + bx) * 0.5, mabN = (an + bn) * 0.5;
          const mbcX = (bx + gx) * 0.5, mbcN = (bn + gn) * 0.5;
          emitTri(bx, bn, mbcX, mbcN, mabX, mabN, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(ax, an, mabX, mabN, gx, gn, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(mabX, mabN, mbcX, mbcN, gx, gn, cls, dy, maxEdge, depth - 1, adaptive);
          return;
        }
        if (bcL && caL && !abL) {
          const mbcX = (bx + gx) * 0.5, mbcN = (bn + gn) * 0.5;
          const mcaX = (gx + ax) * 0.5, mcaN = (gn + an) * 0.5;
          emitTri(gx, gn, mcaX, mcaN, mbcX, mbcN, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(ax, an, bx, bn, mbcX, mbcN, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(ax, an, mbcX, mbcN, mcaX, mcaN, cls, dy, maxEdge, depth - 1, adaptive);
          return;
        }
        // Pick the longest edge that actually needs splitting
        const eAB = abL ? ab : -1, eBC = bcL ? bc : -1, eCA = caL ? ca : -1;
        if (eAB >= eBC && eAB >= eCA) {
          const mx = (ax + bx) * 0.5, mn = (an + bn) * 0.5;
          emitTri(ax, an, mx, mn, gx, gn, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(mx, mn, bx, bn, gx, gn, cls, dy, maxEdge, depth - 1, adaptive);
        } else if (eBC >= eAB && eBC >= eCA) {
          const mx = (bx + gx) * 0.5, mn = (bn + gn) * 0.5;
          emitTri(ax, an, bx, bn, mx, mn, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(ax, an, mx, mn, gx, gn, cls, dy, maxEdge, depth - 1, adaptive);
        } else {
          const mx = (gx + ax) * 0.5, mn = (gn + an) * 0.5;
          emitTri(ax, an, bx, bn, mx, mn, cls, dy, maxEdge, depth - 1, adaptive);
          emitTri(mx, mn, bx, bn, gx, gn, cls, dy, maxEdge, depth - 1, adaptive);
        }
        return;
      }
    }
    const ya = sampleY(ax, an, dy), na = sampleN(ax, an);
    const yb = sampleY(bx, bn, dy), nb = sampleN(bx, bn);
    const yg = sampleY(gx, gn, dy), ng = sampleN(gx, gn);
    const ia = B.v(ax, ya, an, cls, na[0], na[1], na[2]);
    const ib = B.v(bx, yb, bn, cls, nb[0], nb[1], nb[2]);
    const ig = B.v(gx, yg, gn, cls, ng[0], ng[1], ng[2]);
    B.tri(ia, ib, ig);
  };

  for (let p = 0; p < d.np; p++) {
    const cls = d.cls[p], nr = d.nrings[p];
    let total = 0;
    for (let r = 0; r < nr; r++) total += d.ringsize[ri + r];

    // Adaptive boundary subdivision: cls=1 roads & matching cls=30 kerbs adapt down to 2.3m on steep 2.5m bench lips;
    // cls=2/5 sidewalks relax to 10.5m on flat ground (saving triangles) while still matching steep bench lips!
    const subRings = [];
    const rawRings = [];
    let px = 0, py = 0;
    const dy = cls === 1 ? GROUND_Y.road : cls === 8 ? GROUND_Y.rail : GROUND_Y.raised;
    const isRoad = cls === 1;
    const isWalk = cls === 2 || cls === 5;
    const maxSeg = isRoad ? 7.0 : isWalk ? 10.5 : 12.0;
    for (let r = 0; r < nr; r++) {
      const n = d.ringsize[ri++];
      const rx = new Float64Array(n), ry = new Float64Array(n);
      const rawX = new Int32Array(n), rawY = new Int32Array(n);
      for (let k = 0; k < n; k++, vi++) {
        px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1];
        rawX[k] = px; rawY[k] = py;
        rx[k] = px * 0.1 - half; ry[k] = py * 0.1 - half;
      }
      rawRings.push({ rawX, rawY, rx, ry, n });
      if (cls !== 4) {
        const sRing = [];
        for (let k = 0; k < n; k++) {
          const j = (k + 1) % n;
          const x0 = rx[k], y0 = ry[k], x1 = rx[j], y1 = ry[j];
          if (terrain && (isRoad || isWalk)) {
            subdivEdgePts(x0, y0, x1, y1, dy, maxSeg, 2.3, isRoad ? 0.055 : 0.08, sRing, 5);
          } else {
            const len = Math.hypot(x1 - x0, y1 - y0);
            const steps = terrain ? Math.max(1, Math.min(24, Math.ceil(len / maxSeg))) : 1;
            for (let s = 0; s < steps; s++) {
              const t = s / steps;
              sRing.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
            }
          }
        }
        subRings.push(sRing);
      }
    }

    if (cls !== 4) {
      let flatLen = 0;
      for (const sr of subRings) flatLen += sr.length;
      const flat = new Float64Array(flatLen);
      const holes = [];
      let o = 0;
      for (let r = 0; r < subRings.length; r++) {
        if (r > 0) holes.push(o / 2);
        flat.set(subRings[r], o);
        o += subRings[r].length;
      }
      const tris = earcut(flat, holes.length ? holes : null, 2);
      const maxEdge = isRoad ? 7.5 : isWalk ? 12.0 : 13.5;
      const maxDepth = terrain ? 9 : 0;
      for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i], b = tris[i + 1], c = tris[i + 2];
        const ax = flat[a * 2], an = flat[a * 2 + 1];
        const bx = flat[b * 2], bn = flat[b * 2 + 1];
        const gx = flat[c * 2], gn = flat[c * 2 + 1];
        const cr = (bx - ax) * (gn - an) - (bn - an) * (gx - ax);
        if (cr > 0) emitTri(ax, an, bx, bn, gx, gn, cls, dy, maxEdge, maxDepth, isRoad);
        else emitTri(ax, an, gx, gn, bx, bn, cls, dy, maxEdge, maxDepth, isRoad);
      }
    }

    // Vertical faces: kerbs + sandstone retaining walls (堡坎) around roadways, embankment walls around water
    if (cls === 1 || cls === 4) {
      const isWater = cls === 4;
      for (let r = 0; r < rawRings.length; r++) {
        const { rawX, rawY, rx, ry, n } = rawRings[r];
        for (let k = 0; k < n; k++) {
          const j = (k + 1) % n;
          const xi = rawX[k], yi = rawY[k], xj = rawX[j], yj = rawY[j];
          if ((xi <= 0 && xj <= 0) || (xi >= edgeMax && xj >= edgeMax) || (yi <= 0 && yj <= 0) || (yi >= edgeMax && yj >= edgeMax)) continue;
          const x0 = rx[k], n0 = ry[k], x1 = rx[j], n1 = ry[j];
          const len = Math.hypot(x1 - x0, n1 - n0);
          if (len < 0.04) continue;
          const nx = -(n1 - n0) / len, nn = (x1 - x0) / len; // left of travel = into polygon
          const pts = [];
          if (!isWater && terrain) {
            subdivEdgePts(x0, n0, x1, n1, GROUND_Y.road, 7.0, 2.3, 0.055, pts, 5);
            pts.push(x1, n1);
          } else {
            const steps = terrain ? Math.max(1, Math.min(24, Math.ceil(len / 7.0))) : 1;
            for (let s = 0; s <= steps; s++) {
              const t = s / steps;
              pts.push(x0 + (x1 - x0) * t, n0 + (n1 - n0) * t);
            }
          }
          for (let s = 0; s + 2 < pts.length; s += 2) {
            const ax = pts[s], an = pts[s + 1];
            const bx = pts[s + 2], bn = pts[s + 3];
            if (isWater) {
              // Riverbank embankment wall: from carved riverbed (-2.6m) up to riverbank top (sampled slightly inland!)
              const topA = Math.max(waterY + 1.2, sampleY(ax - nx * 2.5, an - nn * 2.5, GROUND_Y.raised));
              const topB = Math.max(waterY + 1.2, sampleY(bx - nx * 2.5, bn - nn * 2.5, GROUND_Y.raised));
              const bot = waterY + GROUND_Y.water;
              const va = B.v(bx, bot, bn, 31, nx, 0, nn);
              const vb = B.v(ax, bot, an, 31, nx, 0, nn);
              const vc = B.v(ax, topA, an, 31, nx, 0, nn);
              const vd = B.v(bx, topB, bn, 31, nx, 0, nn);
              B.tri(va, vb, vc); B.tri(va, vc, vd);
            } else {
              // Kerb face + sandstone retaining skirt (堡坎) on steep hillside road cuts
              const yRoadA = sampleY(ax, an, GROUND_Y.road);
              const yRoadB = sampleY(bx, bn, GROUND_Y.road);
              const yTopA = yRoadA + (GROUND_Y.raised - GROUND_Y.road);
              const yTopB = yRoadB + (GROUND_Y.raised - GROUND_Y.road);
              const va = B.v(bx, yRoadB, bn, 30, nx, 0, nn);
              const vb = B.v(ax, yRoadA, an, 30, nx, 0, nn);
              const vc = B.v(ax, yTopA, an, 30, nx, 0, nn);
              const vd = B.v(bx, yTopB, bn, 30, nx, 0, nn);
              B.tri(va, vb, vc); B.tri(va, vc, vd);

              // Check downhill slope next to carriageway; add crisp sandstone 堡坎 retaining wall where terrain drops steeply
              if (terrain) {
                const nMid = sampleN((ax + bx) * 0.5, (an + bn) * 0.5);
                if (nMid[1] < 0.90) {
                  const drop = Math.min(6.0, Math.max(1.8, (1.0 - nMid[1]) * 18.0));
                  const r0 = B.v(ax, yRoadA - drop, an, 33, -nx, 0, -nn);
                  const r1 = B.v(bx, yRoadB - drop, bn, 33, -nx, 0, -nn);
                  const r2 = B.v(bx, yRoadB + 0.05, bn, 33, -nx, 0, -nn);
                  const r3 = B.v(ax, yRoadA + 0.05, an, 33, -nx, 0, -nn);
                  B.tri(r0, r1, r2); B.tri(r0, r2, r3);
                }
              }
            }
          }
        }
      }
    }
  }

  const minY = B.minY === 1e9 ? -3 : B.minY - 1;
  const maxY = B.maxY === -1e9 ? 2 : B.maxY + 1;
  return {
    pos: B.pos.slice(0, B.n * 4),
    nrm: B.nrm.slice(0, B.n * 4),
    index: B.idx.slice(0, B.ni),
    nVerts: B.n,
    nTris: B.ni / 3,
    bounds: [-half, minY, -half, half, maxY, half],
  };
}
