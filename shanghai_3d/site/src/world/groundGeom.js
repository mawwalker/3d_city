// Street-level ground geometry (runs in the worker): triangulates the tile's classified ground polygons, adds kerb faces
// along the carriageway and embankment walls along the water.
//
// Vertex layout:  aPos Int16 x4  x, y, z in 1/40 m relative to the tile centre; w = ground class
//                 aNrm Int8 x4   normal (snorm), w unused
// Classes: 1 roadway, 2 sidewalk, 3 median, 5 pedestrian paving, 8 rail bed, 20 block interior, 30 kerb face, 31 embankment wall.

import earcut from '../../vendor/earcut/earcut.js';

const Q = 40;
export const GROUND_Y = { road: 0, raised: 0.15, rail: 0.08, water: -1.25 };

class GB {
  constructor(vcap) { this.pos = new Int16Array(vcap * 4); this.nrm = new Int8Array(vcap * 4); this.idx = new Uint32Array(vcap * 3); this.n = 0; this.ni = 0; }
  growV(e) { if ((this.n + e) * 4 <= this.pos.length) return; const cap = Math.max(this.pos.length / 2, this.n + e + 1024); const p = new Int16Array(cap * 4); p.set(this.pos); this.pos = p; const q = new Int8Array(cap * 4); q.set(this.nrm); this.nrm = q; }
  growI(e) { if (this.ni + e <= this.idx.length) return; const a = new Uint32Array(Math.max(this.idx.length * 2, this.ni + e + 2048)); a.set(this.idx); this.idx = a; }
  v(x, y, n, cls, nx, ny, nn) {
    this.growV(1);
    const o = this.n * 4;
    this.pos[o] = Math.round(x * Q); this.pos[o + 1] = Math.round(y * Q); this.pos[o + 2] = Math.round(-n * Q); this.pos[o + 3] = cls;
    this.nrm[o] = Math.round(nx * 127); this.nrm[o + 1] = Math.round(ny * 127); this.nrm[o + 2] = Math.round(-nn * 127);
    return this.n++;
  }
  tri(a, b, c) { this.growI(3); this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
}

/** d: decoded polygon set (decodePolys); tile: tile size in metres. Returns typed arrays + the water-edge and kerb outlines for other layers. */
export function buildGround(d, tile = 1000) {
  const half = tile / 2;
  const B = new GB(Math.max(2048, d.nv * 2));
  let vi = 0, ri = 0;
  const edgeMax = tile * 10;
  for (let p = 0; p < d.np; p++) {
    const cls = d.cls[p], nr = d.nrings[p];
    let total = 0;
    for (let r = 0; r < nr; r++) total += d.ringsize[ri + r];
    const flat = new Float64Array(total * 2); const raw = new Int32Array(total * 2); const holes = []; const starts = [];
    let px = 0, py = 0, o = 0;
    for (let r = 0; r < nr; r++) {
      const n = d.ringsize[ri++];
      if (r > 0) holes.push(o / 2);
      starts.push(o / 2);
      for (let k = 0; k < n; k++, vi++) { px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1]; raw[o] = px; raw[o + 1] = py; flat[o] = px * 0.1 - half; flat[o + 1] = py * 0.1 - half; o += 2; }
    }
    starts.push(total);
    const y = cls === 1 ? GROUND_Y.road : cls === 8 ? GROUND_Y.rail : GROUND_Y.raised;
    if (cls !== 4) {
      const tris = earcut(flat, holes.length ? holes : null, 2);
      const base = B.n;
      for (let i = 0; i < total; i++) B.v(flat[i * 2], y, flat[i * 2 + 1], cls, 0, 1, 0);
      for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i], b = tris[i + 1], c = tris[i + 2];
        const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
        if (cr > 0) B.tri(base + a, base + b, base + c); else B.tri(base + a, base + c, base + b);
      }
    }
    // faces looking into the polygon: kerbs around the carriageway, walls around the water
    if (cls === 1 || cls === 4) {
      const y0 = cls === 1 ? GROUND_Y.road : GROUND_Y.water, y1 = GROUND_Y.raised, wc = cls === 1 ? 30 : 31;
      for (let r = 0; r < nr; r++) {
        const s = starts[r], e = starts[r + 1], n = e - s;
        for (let k = 0; k < n; k++) {
          const i = s + k, j = s + (k + 1) % n;
          const xi = raw[i * 2], yi = raw[i * 2 + 1], xj = raw[j * 2], yj = raw[j * 2 + 1];
          // skip the cuts made by the tile boundary
          if ((xi <= 0 && xj <= 0) || (xi >= edgeMax && xj >= edgeMax) || (yi <= 0 && yj <= 0) || (yi >= edgeMax && yj >= edgeMax)) continue;
          const ex = flat[j * 2] - flat[i * 2], en = flat[j * 2 + 1] - flat[i * 2 + 1];
          const len = Math.hypot(ex, en);
          if (len < 0.02) continue;
          const nx = -en / len, nn = ex / len;                 // left of travel = into the polygon
          const a = B.v(flat[j * 2], y0, flat[j * 2 + 1], wc, nx, 0, nn), b = B.v(flat[i * 2], y0, flat[i * 2 + 1], wc, nx, 0, nn);
          const c = B.v(flat[i * 2], y1, flat[i * 2 + 1], wc, nx, 0, nn), dd = B.v(flat[j * 2], y1, flat[j * 2 + 1], wc, nx, 0, nn);
          B.tri(a, b, c); B.tri(a, c, dd);
        }
      }
    }
  }
  return { pos: B.pos.slice(0, B.n * 4), nrm: B.nrm.slice(0, B.n * 4), index: B.idx.slice(0, B.ni), nVerts: B.n, nTris: B.ni / 3, bounds: [-half, -1.3, -half, half, 0.2, half] };
}
