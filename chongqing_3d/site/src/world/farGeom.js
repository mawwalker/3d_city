// Far ground & 3D DEM terrain mesh builder (runs in the worker):
//   - buildTerrainMesh: triangulated 3D DEM mountain mesh (fine core + fine outer + coarse 64km parallel ranges)
//   - buildFarBlock: 2D river water polygons, 3D terrain-draped distant road ribbons, and 3D terrain-anchored elevated decks.

import earcut from '../../vendor/earcut/earcut.js';
import { decodePolys, decodeLines } from './data.js';

/**
 * Build a 3D triangulated DEM terrain mesh from a Uint16 height grid, optionally punching a rectangular hole
 * (in pipeline x, y_north metres) where a higher-resolution grid sits inside.
 */
export function buildTerrainMesh(g, data, { step = 2, hole = null, exagOuter = 0, terrain = null } = {}) {
  const nx = Math.floor((g.nx - 1) / step) + 1;
  const ny = Math.floor((g.ny - 1) / step) + 1;
  const scale = g.scale ?? 0.1, offset = g.offset ?? -20.0;
  const useCore = !!(terrain && terrain.core && terrain.coreData);
  const hAt = (gi, gj) => {
    const i = Math.max(0, Math.min(g.nx - 1, gi));
    const j = Math.max(0, Math.min(g.ny - 1, gj));
    if (useCore) {
      const x = g.x0 + (i + 0.5) * g.cell;
      const z = -(g.y0 + (j + 0.5) * g.cell);
      if (terrain.inCore(x, z)) return terrain.sample(x, z);
    }
    return data[j * g.nx + i] * scale + offset;
  };
  const pos = new Float32Array(nx * ny * 3);
  const nrm = new Int8Array(nx * ny * 4);
  const stepM = g.cell * step;

  for (let j = 0; j < ny; j++) {
    const gj = Math.min(g.ny - 1, j * step);
    const north = g.y0 + (gj + 0.5) * g.cell;
    const z = -north;
    for (let i = 0; i < nx; i++) {
      const gi = Math.min(g.nx - 1, i * step);
      const x = g.x0 + (gi + 0.5) * g.cell;
      let y = hAt(gi, gj);
      if (exagOuter > 0) {
        const d = Math.hypot(x, z);
        const k = 1 + exagOuter * Math.max(0, Math.min(1, (d - 16000) / 18000));
        if (y > 0) y *= k;
      }
      const o = j * nx + i;
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;

      const hL = hAt(gi - step, gj), hR = hAt(gi + step, gj);
      const hS = hAt(gi, gj - step), hN = hAt(gi, gj + step);
      let mx = hL - hR, my = 2.0 * stepM, mz = hN - hS; // z = -north, so +z is south (-gj)
      const inv = 1.0 / (Math.hypot(mx, my, mz) || 1.0);
      nrm[o * 4] = Math.round(mx * inv * 127);
      nrm[o * 4 + 1] = Math.round(my * inv * 127);
      nrm[o * 4 + 2] = Math.round(mz * inv * 127);
      nrm[o * 4 + 3] = 0;
    }
  }

  const idx = [];
  for (let j = 0; j < ny - 1; j++) {
    const gj0 = Math.min(g.ny - 1, j * step), gj1 = Math.min(g.ny - 1, (j + 1) * step);
    const yMid = g.y0 + ((gj0 + gj1) * 0.5 + 0.5) * g.cell;
    for (let i = 0; i < nx - 1; i++) {
      if (hole) {
        const gi0 = Math.min(g.nx - 1, i * step), gi1 = Math.min(g.nx - 1, (i + 1) * step);
        const xMid = g.x0 + ((gi0 + gi1) * 0.5 + 0.5) * g.cell;
        if (xMid > hole[0] && xMid < hole[2] && yMid > hole[1] && yMid < hole[3]) continue;
      }
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // CCW seen from +Y (note: +j is +north = -z, so (a, b, d) faces +Y!)
      idx.push(a, b, d, a, d, c);
    }
  }
  return { pos, nrm, index: new Uint32Array(idx), nVerts: nx * ny, nTris: idx.length / 3 };
}

/**
 * chunks: [{ ox, on (chunk SW corner relative to block centre), water, roads, decks }]
 * opts: { cx, cz (block centre in WebGL world coords), terrain }
 */
export function buildFarBlock(chunks, opts = {}) {
  const cx = opts.cx || 0, cz = opts.cz || 0;
  const terrain = opts.terrain || null;
  const waterY = terrain ? (terrain.waterY ?? 0.0) : 0.0;
  const sampleBase = (lx, ln) => terrain ? Math.max(terrain.sample(cx + lx, cz - ln), waterY) : waterY;

  const wpos = [], widx = [];
  const rpos = [], rattr = [], ridx = [];
  let wn = 0, rn = 0;

  for (const ch of chunks) {
    if (ch.water) {
      const d = decodePolys(ch.water);
      let vi = 0, ri = 0;
      for (let p = 0; p < d.np; p++) {
        const nr = d.nrings[p];
        let total = 0;
        for (let r = 0; r < nr; r++) total += d.ringsize[ri + r];
        const flat = new Float64Array(total * 2); const holes = [];
        let px = 0, py = 0, o = 0;
        for (let r = 0; r < nr; r++) {
          const n = d.ringsize[ri++];
          if (r > 0) holes.push(o / 2);
          for (let k = 0; k < n; k++, vi++) {
            px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1];
            flat[o++] = ch.ox + px * 0.1; flat[o++] = ch.on + py * 0.1;
          }
        }
        const tris = earcut(flat, holes.length ? holes : null, 2);
        for (let i = 0; i < total; i++) wpos.push(flat[i * 2], -flat[i * 2 + 1]);
        for (let i = 0; i < tris.length; i += 3) {
          const a = tris[i], b = tris[i + 1], c = tris[i + 2];
          const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
          if (cr > 0) widx.push(wn + a, wn + b, wn + c); else widx.push(wn + a, wn + c, wn + b);
        }
        wn += total;
      }
    }

    if (ch.roads) {
      const d = decodeLines(ch.roads);
      const cls = d.attrs[0], wid = d.attrs[1];
      let vi = 0;
      for (let l = 0; l < d.nl; l++) {
        const n0 = d.npts[l];
        const hw = wid[l] / 8;
        let px = 0, py = 0;
        const rawX = new Float64Array(n0), rawY = new Float64Array(n0);
        for (let k = 0; k < n0; k++, vi++) {
          px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1];
          rawX[k] = ch.ox + px * 0.1; rawY[k] = ch.on + py * 0.1;
        }
        // Subdivide long road segments every ~22 m so far roads drape smoothly over mountain ridges!
        const xs = [], ys = [];
        for (let k = 0; k < n0 - 1; k++) {
          const len = Math.hypot(rawX[k + 1] - rawX[k], rawY[k + 1] - rawY[k]);
          const steps = terrain ? Math.max(1, Math.min(24, Math.ceil(len / 22.0))) : 1;
          for (let s = 0; s < steps; s++) {
            const t = s / steps;
            xs.push(rawX[k] + (rawX[k + 1] - rawX[k]) * t);
            ys.push(rawY[k] + (rawY[k + 1] - rawY[k]) * t);
          }
        }
        xs.push(rawX[n0 - 1]); ys.push(rawY[n0 - 1]);
        const n = xs.length;
        const base = rn;
        let acc = 0;
        for (let k = 0; k < n; k++) {
          const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
          let dx = xs[b] - xs[a], dy = ys[b] - ys[a];
          const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
          if (k > 0) acc += Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
          const lx = xs[k] - dy * hw, ln = ys[k] + dx * hw;
          const rx = xs[k] + dy * hw, rn2 = ys[k] - dx * hw;
          const yL = sampleBase(lx, ln) + 0.35;
          const yR = sampleBase(rx, rn2) + 0.35;
          rpos.push(lx, yL, -ln, rx, yR, -rn2);
          rattr.push(cls[l], 0, acc, hw, cls[l], 1, acc, hw);
          rn += 2;
        }
        for (let k = 0; k < n - 1; k++) { const i = base + k * 2; ridx.push(i, i + 1, i + 3, i, i + 3, i + 2); }
      }
    }
  }

  return {
    water: wn ? { pos: new Float32Array(wpos), index: new Uint32Array(widx) } : null,
    roads: rn ? { pos: new Float32Array(rpos), attr: new Float32Array(rattr), index: new Uint32Array(ridx) } : null,
    decks: buildFarDecks(chunks, opts),
  };
}

function buildFarDecks(chunks, opts = {}) {
  const cx = opts.cx || 0, cz = opts.cz || 0;
  const terrain = opts.terrain || null;
  const waterY = terrain ? (terrain.waterY ?? 0.0) : 0.0;
  const groundAt = (lx, ln) => terrain ? terrain.sample(cx + lx, cz - ln) : 0.0;
  const baseAt = (lx, ln) => Math.max(groundAt(lx, ln), waterY);

  const pos = [], attr = [], idx = [];
  let n = 0;
  const v = (x, y, nn, a0, a1, a2, a3) => { pos.push(x, y, -nn); attr.push(a0, a1, a2, a3); return n++; };

  for (const ch of chunks) {
    if (!ch.decks) continue;
    const { buffer, offset } = ch.decks;
    const dv = new DataView(buffer, offset, ch.decks.length);
    const nl = dv.getUint32(0, true), nv = dv.getUint32(4, true), na = dv.getUint32(8, true);
    let o = offset + 12;
    const cls = new Uint8Array(buffer, o, nl), wid = new Uint8Array(buffer, o + nl, nl); o += (na * nl + 3) & ~3;
    const npts = new Uint16Array(buffer.slice(o, o + nl * 2)); o += (nl * 2 + 3) & ~3;
    const xy = new Int16Array(buffer.slice(o, o + nv * 4)); o += nv * 4;
    const zz = new Uint8Array(buffer, o, nv);
    let vi = 0;
    for (let l = 0; l < nl; l++) {
      const m = npts[l], c = cls[l] & 63, hung = (cls[l] & 64) !== 0;
      const hw = wid[l] / 8 + 0.45;
      const X = new Float64Array(m), N = new Float64Array(m), H = new Float64Array(m), CL = new Float64Array(m);
      let px = 0, py = 0;
      for (let k = 0; k < m; k++, vi++) {
        px += xy[vi * 2]; py += xy[vi * 2 + 1];
        X[k] = ch.ox + px * 0.1; N[k] = ch.on + py * 0.1;
        CL[k] = zz[vi] * 0.25;
        H[k] = baseAt(X[k], N[k]) + CL[k];
      }
      const start = new Int32Array(m);
      let acc = 0, nextPier = 22;
      for (let k = 0; k < m; k++) {
        const a = Math.max(0, k - 1), b = Math.min(m - 1, k + 1);
        let dx = X[b] - X[a], dn = N[b] - N[a]; const len = Math.hypot(dx, dn) || 1; dx /= len; dn /= len;
        if (k > 0) acc += Math.hypot(X[k] - X[k - 1], N[k] - N[k - 1]);
        const g = groundAt(X[k], N[k]);
        const y = Math.max(H[k], g + 0.25), yb = CL[k] < 3.2 ? g - 2.5 : H[k] - 1.45, yp = y + 0.95;
        const lx = X[k] - dn * hw, ln = N[k] + dx * hw, rx = X[k] + dn * hw, rn = N[k] - dx * hw;
        start[k] = n;
        v(lx, y, ln, c, 0, acc, hw); v(rx, y, rn, c, 1, acc, hw);
        v(lx, yb, ln, 32, 0, acc, hw); v(lx, yp, ln, 32, 0, acc, hw);
        v(rx, yb, rn, 32, 0, acc, hw); v(rx, yp, rn, 32, 0, acc, hw);
        v(lx, yb, ln, 32, 0, acc, hw); v(rx, yb, rn, 32, 0, acc, hw);
        if (!hung && k > 0 && acc >= nextPier && CL[k] > 6 && CL[k - 1] > 6) {
          nextPier = acc + 45;
          const pxc = (X[k] + X[k - 1]) / 2, pnc = (N[k] + N[k - 1]) / 2, top = (H[k] + H[k - 1]) / 2 - 1.35;
          const foot = groundAt(pxc, pnc) - 4.0;
          const sl = 1.1, sw = Math.max(1.4, hw * 0.34);
          const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [pxc + dx * sl * s - dn * sw * t, pnc + dn * sl * s + dx * sw * t]);
          for (let q = 0; q < 4; q++) {
            const A = cs[q], B = cs[(q + 1) % 4];
            const i = v(A[0], foot, A[1], 32, 0, 0, 0); v(B[0], foot, B[1], 32, 0, 0, 0); v(B[0], top, B[1], 32, 0, 0, 0); v(A[0], top, A[1], 32, 0, 0, 0);
            idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
          }
        }
      }
      for (let k = 0; k + 1 < m; k++) {
        if (CL[k] < 0.4 && CL[k + 1] < 0.4) continue;
        const i = start[k], j = start[k + 1];
        idx.push(i, i + 1, j + 1, i, j + 1, j);
        idx.push(i + 2, j + 3, j + 2, i + 2, i + 3, j + 3);
        idx.push(i + 4, j + 4, j + 5, i + 4, j + 5, i + 5);
        idx.push(i + 6, j + 6, j + 7, i + 6, j + 7, i + 7);
      }
    }
  }
  return n ? { pos: new Float32Array(pos), attr: new Float32Array(attr), index: new Uint32Array(idx) } : null;
}
