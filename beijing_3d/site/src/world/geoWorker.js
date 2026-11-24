// Geometry worker for the ground layers: polygon triangulation (areas, water), road ribbons, terrain meshes.

import earcut from '../../vendor/earcut/earcut.js';
import { decodePolygons, decodeLines } from './data.js';

// ------------------------------------------------------------------ terrain sampler (fine grid, metres)
let TERR = null;   // { h: Uint16Array (dm), nx, ny, x0, y0, cell }
function heightAt(x, yN) {
  if (!TERR) return 0;
  const fx = (x - TERR.x0) / TERR.cell - 0.5, fy = (yN - TERR.y0) / TERR.cell - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= TERR.nx - 1 || j >= TERR.ny - 1) return 0;
  const tx = fx - i, ty = fy - j, o = j * TERR.nx + i, h = TERR.h;
  const a = h[o], b = h[o + 1], c = h[o + TERR.nx], d = h[o + TERR.nx + 1];
  if ((a | b | c | d) === 0) return 0;
  return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) * 0.1;
}

// ------------------------------------------------------------------ polygons
function buildPolys(buf, opts) {
  const { n, cls, polys } = decodePolygons(buf);
  let nv = 0;
  for (const rings of polys) for (const r of rings) nv += r.length / 2;
  const pos = new Float32Array(nv * 2);
  const vcls = new Uint8Array(nv);
  let idx = new Uint32Array(nv * 3);
  let ni = 0, vo = 0;
  const skip = opts.skip ? new Set(opts.skip) : null;
  for (let p = 0; p < n; p++) {
    const rings = polys[p];
    if (skip && skip.has(cls[p])) continue;
    let total = 0; for (const r of rings) total += r.length;
    const flat = new Float64Array(total); const holes = [];
    let o = 0;
    for (let ri = 0; ri < rings.length; ri++) { if (ri) holes.push(o / 2); flat.set(rings[ri], o); o += rings[ri].length; }
    const tri = earcut(flat, holes.length ? holes : undefined, 2);
    const base = vo;
    for (let k = 0; k < total; k += 2) { pos[vo * 2] = flat[k]; pos[vo * 2 + 1] = -flat[k + 1]; vcls[vo] = cls[p]; vo++; }
    if (ni + tri.length > idx.length) { const a = new Uint32Array(Math.max(idx.length * 2, ni + tri.length + 1024)); a.set(idx); idx = a; }
    for (let k = 0; k < tri.length; k += 3) {
      const a = tri[k], b = tri[k + 1], c = tri[k + 2];
      // enforce counter-clockwise seen from above (+y) in world x/z
      const cr = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
      if (cr >= 0) { idx[ni++] = base + a; idx[ni++] = base + b; idx[ni++] = base + c; } else { idx[ni++] = base + a; idx[ni++] = base + c; idx[ni++] = base + b; }
    }
  }
  return { pos: pos.slice(0, vo * 2), cls: vcls.slice(0, vo), index: idx.slice(0, ni), n };
}

// ------------------------------------------------------------------ roads
// Ribbon vertex: aC (x, y, z) centre | aOff (ox, oz, class, flags) int8 (offset = right-hand normal * side * miter, scaled 1/2 into int8)
//                aDW (distance along, signed half width, deck height above the ground)
// Index order: ground-level lines first, then bridges / viaducts (bridgeStart marks the split) so decks can be drawn over everything else.
function buildRoadChunk(L) {
  let nv = 0;
  for (const l of L.lines) nv += l.length / 2;
  const C = new Float32Array(nv * 2 * 3), O = new Int8Array(nv * 2 * 4), D = new Float32Array(nv * 2 * 3);
  const idx = new Uint32Array(Math.max(0, (nv - L.n)) * 6);
  let v = 0, ni = 0;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = 0;
  // draw important classes last: sort lines by class priority; elevated decks after all ground lines, lowest deck first
  const prio = (c) => (c === 0 ? 9 : c === 1 ? 8 : c === 2 ? 7 : c === 3 ? 6 : c === 9 ? 5 : c === 4 ? 4 : c === 5 ? 3 : c === 7 ? 2 : c === 6 ? 1 : 0);
  const up = (i) => (Math.max(L.e0[i], L.eH[i], L.e1[i]) > 3 ? 1 : 0);
  const order = Array.from({ length: L.n }, (_, i) => i).sort((a, b) => (up(a) - up(b)) || (up(a) ? L.eH[a] - L.eH[b] : 0) || (prio(L.cls[a]) - prio(L.cls[b])));
  let bridgeStart = -1;
  const sm = (t) => t * t * (3 - 2 * t);
  for (const li of order) {
    if (bridgeStart < 0 && up(li)) bridgeStart = ni;
    const pts = L.lines[li]; const n = pts.length / 2;
    const cls = L.cls[li], flags = L.flags[li], hw = L.width[li] / 2;
    // deck profile: ramp from the start height up to the plateau and down to the end height
    const h0 = L.e0[li] * 0.25, H = L.eH[li] * 0.25, h1 = L.e1[li] * 0.25;
    const elevated = up(li) === 1;
    let total = 0;
    if (elevated) for (let k = 1; k < n; k++) total += Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
    let R0 = Math.max(25, Math.abs(H - h0) * 15), R1 = Math.max(25, Math.abs(H - h1) * 15);
    if (R0 + R1 > total) { const k = total / (R0 + R1); R0 *= k; R1 *= k; }
    const deck = (d) => (!elevated ? 0 : d < R0 ? h0 + (H - h0) * sm(d / Math.max(R0, 1e-3)) : d > total - R1 ? h1 + (H - h1) * sm((total - d) / Math.max(R1, 1e-3)) : H);
    let s = (li * 37.7) % 211;       // de-phase traffic between roads
    let dist = 0;
    const start = v;
    for (let k = 0; k < n; k++) {
      const x = pts[2 * k], z = -pts[2 * k + 1];
      let tx0 = 0, tz0 = 0, tx1 = 0, tz1 = 0;
      if (k > 0) { tx0 = x - pts[2 * k - 2]; tz0 = z + pts[2 * k - 1]; const l = Math.hypot(tx0, tz0) || 1; tx0 /= l; tz0 /= l; s += l; dist += l; }
      if (k < n - 1) { tx1 = pts[2 * k + 2] - x; tz1 = -pts[2 * k + 3] - z; const l = Math.hypot(tx1, tz1) || 1; tx1 /= l; tz1 /= l; }
      if (k === 0) { tx0 = tx1; tz0 = tz1; } if (k === n - 1) { tx1 = tx0; tz1 = tz0; }
      // right-hand normals of the two segments, mitred
      let rx = -tz0 - tz1, rz = tx0 + tx1;
      const rl = Math.hypot(rx, rz);
      if (rl < 1e-6) { rx = -tz1; rz = tx1; } else { rx /= rl; rz /= rl; }
      const cosHalf = Math.max(0.5, rx * -tz1 + rz * tx1);
      const m = 1 / cosHalf;
      const h = deck(dist);
      const y = heightAt(x, -z) + h;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      for (let side = -1; side <= 1; side += 2) {
        const o3 = v * 3, o4 = v * 4;
        C[o3] = x; C[o3 + 1] = y; C[o3 + 2] = z;
        O[o4] = Math.round(rx * side * m * 63.5); O[o4 + 1] = Math.round(rz * side * m * 63.5); O[o4 + 2] = cls; O[o4 + 3] = flags;
        D[o3] = s; D[o3 + 1] = hw * side; D[o3 + 2] = h;
        v++;
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const a = start + 2 * k;       // a: left, a+1: right, a+2: next left, a+3: next right
      idx[ni++] = a; idx[ni++] = a + 1; idx[ni++] = a + 3;
      idx[ni++] = a; idx[ni++] = a + 3; idx[ni++] = a + 2;
    }
  }
  if (bridgeStart < 0) bridgeStart = ni;
  return { C, O, D, index: idx.slice(0, ni), bridgeStart, bounds: [minX, minZ, maxX, maxZ, maxY] };
}

// ------------------------------------------------------------------ elevated structures
// Flyovers and viaducts get a body: a box girder with crash barriers under the painted deck, and piers that keep clear of
// whatever runs underneath (carriageways, tracks, lower decks).
const CELL = 64;
class SegmentHash {
  constructor() { this.cells = new Map(); this.seg = []; }
  add(ax, az, bx, bz, hw, lvl) {
    const id = this.seg.length / 6;
    this.seg.push(ax, az, bx, bz, hw, lvl);
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 32)), r = hw + 4;
    let last = -1;
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const key = cx * 131071 + cz;
        if (key === last) continue;
        last = key;
        let a = this.cells.get(key);
        if (!a) this.cells.set(key, a = []);
        if (a[a.length - 1] !== id) a.push(id);
      }
    }
  }
  /** true when something at a lower level than `lvl` passes within `clear` metres of its edge */
  blocked(x, z, lvl, clear) {
    const a = this.cells.get(Math.floor(x / CELL) * 131071 + Math.floor(z / CELL));
    if (!a) return false;
    const S = this.seg;
    for (const id of a) {
      const o = id * 6;
      if (S[o + 5] > lvl - 2.5) continue;
      const ax = S[o], az = S[o + 1], dx = S[o + 2] - ax, dz = S[o + 3] - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < S[o + 4] + clear) return true;
    }
    return false;
  }
}

function buildDecks(L, hash) {
  const pos = [], rp = [], idx = [];
  const sm = (t) => t * t * (3 - 2 * t);
  const up = (i) => Math.max(L.e0[i], L.eH[i], L.e1[i]) > 3;
  for (let li = 0; li < L.n; li++) {
    if (!up(li)) continue;
    const pts = L.lines[li]; const n = pts.length / 2;
    const cls = L.cls[li], rail = cls >= 20;
    if (cls === 8) continue;                                  // footbridges stay as painted ribbons
    const W = L.width[li] / 2 + (rail ? 0.9 : 1.15);
    const h0 = L.e0[li] * 0.25, H = L.eH[li] * 0.25, h1 = L.e1[li] * 0.25;
    let total = 0;
    for (let k = 1; k < n; k++) total += Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
    let R0 = Math.max(25, Math.abs(H - h0) * 15), R1 = Math.max(25, Math.abs(H - h1) * 15);
    if (R0 + R1 > total) { const k = total / (R0 + R1); R0 *= k; R1 *= k; }
    const deck = (d) => (d < R0 ? h0 + (H - h0) * sm(d / Math.max(R0, 1e-3)) : d > total - R1 ? h1 + (H - h1) * sm((total - d) / Math.max(R1, 1e-3)) : H);
    const depth = rail ? 1.7 : 1.45, barH = rail ? 0.7 : 0.95;
    let dist = 0, nextPier = 14 + (li * 7.3) % 12;
    const base = pos.length / 3;
    let px = 0, pz = 0;
    for (let k = 0; k < n; k++) {
      const x = pts[2 * k], z = -pts[2 * k + 1];
      let tx0 = 0, tz0 = 0, tx1 = 0, tz1 = 0, seg = 0;
      if (k > 0) { tx0 = x - pts[2 * k - 2]; tz0 = z + pts[2 * k - 1]; seg = Math.hypot(tx0, tz0) || 1; tx0 /= seg; tz0 /= seg; }
      if (k < n - 1) { tx1 = pts[2 * k + 2] - x; tz1 = -pts[2 * k + 3] - z; const l = Math.hypot(tx1, tz1) || 1; tx1 /= l; tz1 /= l; }
      if (k === 0) { tx0 = tx1; tz0 = tz1; } if (k === n - 1) { tx1 = tx0; tz1 = tz0; }
      // piers along the span that ends at this point
      if (k > 0) {
        while (nextPier < dist + seg) {
          const t = (nextPier - dist) / seg, cx = px + (x - px) * t, cz = pz + (z - pz) * t, hd = deck(nextPier);
          nextPier += rail ? 26 : 30;
          if (hd < 3.2) continue;
          const g = heightAt(cx, -cz), top = g + hd - depth;
          const cols = W > 7 ? [-0.52 * W, 0.52 * W] : [0];
          for (const off of cols) {
            const ox = cx - tz0 * off, oz = cz + tx0 * off;
            if (hash.blocked(ox, oz, hd, 1.4)) continue;
            const a = 0.8, b = W > 7 ? 0.9 : Math.min(1.5, W * 0.4), pb = pos.length / 3;
            for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
              const vx = ox + tx0 * a * sa - tz0 * b * sb, vz = oz + tz0 * a * sa + tx0 * b * sb;
              pos.push(vx, g - 0.5, vz, vx, top, vz); rp.push(-hd, 1, -depth, 1);
            }
            for (let q = 0; q < 4; q++) { const i0 = pb + 2 * q, i1 = pb + 2 * ((q + 1) % 4); idx.push(i0, i1, i1 + 1, i0, i1 + 1, i0 + 1); }
          }
        }
        dist += seg;
      }
      px = x; pz = z;
      let rx = -tz0 - tz1, rz = tx0 + tx1;
      const rl = Math.hypot(rx, rz);
      if (rl < 1e-6) { rx = -tz1; rz = tx1; } else { rx /= rl; rz /= rl; }
      const m = 1 / Math.max(0.5, rx * -tz1 + rz * tx1);
      const hd = deck(dist), g = heightAt(x, -z), y = g + hd;
      const bar = barH * Math.min(1, hd / 1.2), bot = Math.max(g - 0.3, y - depth);
      const lx = x - rx * m * W, lz = z - rz * m * W, qx = x + rx * m * W, qz = z + rz * m * W;
      // cross-section: barrier top L, girder bottom L, girder bottom R, barrier top R, then the slab top L / R
      pos.push(lx, y + bar, lz, lx, bot, lz, qx, bot, qz, qx, y + bar, qz, lx, y - 0.04, lz, qx, y - 0.04, qz);
      rp.push(bar, 0, bot - y, 0, bot - y, 0, bar, 0, 0, 2, 0, 2);
    }
    for (let k = 0; k < n - 1; k++) {
      const a = base + 6 * k, b = a + 6;
      for (const [i, j] of [[0, 1], [1, 2], [2, 3], [4, 5]]) idx.push(a + i, a + j, b + j, a + i, b + j, b + i);
    }
  }
  if (!idx.length) return null;
  return { pos: new Float32Array(pos), rp: new Float32Array(rp), index: new Uint32Array(idx) };
}

function buildRoads(buf, chunks) {
  const decoded = chunks.map((c) => decodeLines(buf, c.o));
  // everything a pier must keep clear of
  const hash = new SegmentHash();
  for (const L of decoded) {
    for (let li = 0; li < L.n; li++) {
      const cls = L.cls[li];
      if (!(cls <= 5 || cls === 9 || cls >= 20)) continue;
      const pts = L.lines[li], hw = L.width[li] / 2, lvl = Math.max(L.e0[li], L.eH[li], L.e1[li]) > 3 ? L.eH[li] * 0.25 : 0;
      for (let k = 0; k + 1 < pts.length / 2; k++) hash.add(pts[2 * k], -pts[2 * k + 1], pts[2 * k + 2], -pts[2 * k + 3], hw, lvl);
    }
  }
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const r = buildRoadChunk(decoded[i]);
    const deck = c.g === 4 ? null : buildDecks(decoded[i], hash);
    out.push({ ci: c.ci, cj: c.cj, g: c.g, ...r, deck });
  }
  return out;
}

// ------------------------------------------------------------------ terrain mesh
function buildTerrain(hbuf, m, hole) {
  const h = new Uint16Array(hbuf);
  const { nx, ny, x0, y0, cell } = m;
  const map = new Int32Array(nx * ny).fill(-1);
  const used = new Uint8Array(nx * ny);
  const inHole = (i, j) => {
    if (!hole) return false;
    const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
    return x > hole[0] && x < hole[2] && y > hole[1] && y < hole[3];
  };
  // a cell (i,j)-(i+1,j+1) is emitted when any corner is above the plain
  let nCells = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const o = j * nx + i;
    if ((h[o] | h[o + 1] | h[o + nx] | h[o + nx + 1]) === 0) continue;
    if (hole && inHole(i, j) && inHole(i + 1, j) && inHole(i, j + 1) && inHole(i + 1, j + 1)) continue;
    used[o] = used[o + 1] = used[o + nx] = used[o + nx + 1] = 1; nCells++;
  }
  let nv = 0;
  for (let k = 0; k < used.length; k++) if (used[k]) map[k] = nv++;
  const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 4);
  const H = (i, j) => h[Math.min(ny - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))] * 0.1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = map[j * nx + i]; if (k < 0) continue;
    let y = H(i, j);
    // where the coarse mesh dives under the fine one, push it down so the fine mesh always wins
    if (hole && inHole(i, j)) y -= 30;
    pos[3 * k] = x0 + (i + 0.5) * cell; pos[3 * k + 1] = y; pos[3 * k + 2] = -(y0 + (j + 0.5) * cell);
    const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell), dy = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
    // normal in world space: (-dh/dx, 1, +dh/dnorth) since z = -north
    const il = 1 / Math.hypot(dx, 1, dy);
    nrm[4 * k] = Math.round(-dx * il * 127); nrm[4 * k + 1] = Math.round(il * 127); nrm[4 * k + 2] = Math.round(dy * il * 127);
  }
  const idx = new Uint32Array(nCells * 6);
  let ni = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const o = j * nx + i;
    if ((h[o] | h[o + 1] | h[o + nx] | h[o + nx + 1]) === 0) continue;
    if (hole && inHole(i, j) && inHole(i + 1, j) && inHole(i, j + 1) && inHole(i + 1, j + 1)) continue;
    const a = map[o], b = map[o + 1], c = map[o + nx], d = map[o + nx + 1];
    // (i,j)=a south-west, b south-east, c north-west, d north-east; counter-clockwise from above
    idx[ni++] = a; idx[ni++] = b; idx[ni++] = d;
    idx[ni++] = a; idx[ni++] = d; idx[ni++] = c;
  }
  return { pos, nrm, index: idx };
}

self.onmessage = (ev) => {
  const { id, task, data } = ev.data;
  try {
    let res, transfer = [];
    if (task === 'terrainData') {
      TERR = { h: new Uint16Array(data.buffer), ...data.meta };
      res = { ok: true };
    } else if (task === 'polys') {
      res = buildPolys(data.buffer, data.opts || {});
      transfer = [res.pos.buffer, res.cls.buffer, res.index.buffer];
    } else if (task === 'roads') {
      res = buildRoads(data.buffer, data.chunks);
      for (const r of res) { transfer.push(r.C.buffer, r.O.buffer, r.D.buffer, r.index.buffer); if (r.deck) transfer.push(r.deck.pos.buffer, r.deck.rp.buffer, r.deck.index.buffer); }
    } else if (task === 'terrain') {
      res = buildTerrain(data.buffer, data.meta, data.hole);
      transfer = [res.pos.buffer, res.nrm.buffer, res.index.buffer];
    } else throw new Error('unknown task ' + task);
    self.postMessage({ id, ok: true, res }, transfer);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.stack || e) });
  }
};
