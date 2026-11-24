// Far ground geometry (worker): water polygons and road ribbons for a block of chunks.
import earcut from '../../vendor/earcut/earcut.js';
import { decodePolys, decodeLines } from './data.js';

/** chunks: [{ ox, oz (chunk SW corner relative to the block centre, metres; z already negated north), water: section|null, roads: section|null }] */
export function buildFarBlock(chunks) {
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
          for (let k = 0; k < n; k++, vi++) { px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1]; flat[o++] = ch.ox + px * 0.1; flat[o++] = ch.on + py * 0.1; }
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
        const n = d.npts[l];
        const hw = wid[l] / 8;             // half width (m)
        let px = 0, py = 0;
        const xs = new Float64Array(n), ys = new Float64Array(n);
        for (let k = 0; k < n; k++, vi++) { px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1]; xs[k] = ch.ox + px * 0.1; ys[k] = ch.on + py * 0.1; }
        const base = rn;
        let acc = 0;
        for (let k = 0; k < n; k++) {
          // averaged direction at the vertex
          const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
          let dx = xs[b] - xs[a], dy = ys[b] - ys[a];
          const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
          if (k > 0) acc += Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
          // left / right of travel (data frame: x east, y north)
          rpos.push(xs[k] - dy * hw, -(ys[k] + dx * hw), xs[k] + dy * hw, -(ys[k] - dx * hw));
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
    decks: buildFarDecks(chunks),
  };
}

// Elevated ways for the distant view: the running surface as a ribbon at its height (same attributes as the flat roads),
// a girder under it and piers; attribute x = 32 marks structure. The street-level tiles carry the detailed version, and
// the material drops this one wherever such a tile is loaded.
function buildFarDecks(chunks) {
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
      const X = new Float64Array(m), N = new Float64Array(m), H = new Float64Array(m);
      let px = 0, py = 0;
      for (let k = 0; k < m; k++, vi++) { px += xy[vi * 2]; py += xy[vi * 2 + 1]; X[k] = ch.ox + px * 0.1; N[k] = ch.on + py * 0.1; H[k] = zz[vi] * 0.25; }
      const start = new Int32Array(m);
      let acc = 0, nextPier = 20;
      for (let k = 0; k < m; k++) {
        const a = Math.max(0, k - 1), b = Math.min(m - 1, k + 1);
        let dx = X[b] - X[a], dn = N[b] - N[a]; const len = Math.hypot(dx, dn) || 1; dx /= len; dn /= len;
        if (k > 0) acc += Math.hypot(X[k] - X[k - 1], N[k] - N[k - 1]);
        const y = Math.max(H[k], 0.16), yb = H[k] < 3.2 ? 0.1 : H[k] - 1.4, yp = y + 0.95;
        const lx = X[k] - dn * hw, ln = N[k] + dx * hw, rx = X[k] + dn * hw, rn = N[k] - dx * hw;
        // 0, 1: running surface; 2, 3: left face; 4, 5: right face; 6, 7: soffit
        start[k] = n;
        v(lx, y, ln, c, 0, acc, hw); v(rx, y, rn, c, 1, acc, hw);
        v(lx, yb, ln, 32, 0, acc, hw); v(lx, yp, ln, 32, 0, acc, hw);
        v(rx, yb, rn, 32, 0, acc, hw); v(rx, yp, rn, 32, 0, acc, hw);
        v(lx, yb, ln, 32, 0, acc, hw); v(rx, yb, rn, 32, 0, acc, hw);
        // piers
        if (!hung && k > 0 && acc >= nextPier && H[k] > 8 && H[k - 1] > 8) {
          nextPier = acc + 45;
          const cx = (X[k] + X[k - 1]) / 2, cn = (N[k] + N[k - 1]) / 2, top = (H[k] + H[k - 1]) / 2 - 1.3;
          const sl = 1.1, sw = Math.max(1.4, hw * 0.34);
          const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [cx + dx * sl * s - dn * sw * t, cn + dn * sl * s + dx * sw * t]);
          for (let q = 0; q < 4; q++) {
            const A = cs[q], B = cs[(q + 1) % 4];
            const i = v(A[0], 0.1, A[1], 32, 0, 0, 0); v(B[0], 0.1, B[1], 32, 0, 0, 0); v(B[0], top, B[1], 32, 0, 0, 0); v(A[0], top, A[1], 32, 0, 0, 0);
            idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
          }
        }
      }
      for (let k = 0; k + 1 < m; k++) {
        if (H[k] < 0.4 && H[k + 1] < 0.4) continue;
        const i = start[k], j = start[k + 1];
        idx.push(i, i + 1, j + 1, i, j + 1, j);                 // top
        idx.push(i + 2, j + 3, j + 2, i + 2, i + 3, j + 3);     // left face
        idx.push(i + 4, j + 4, j + 5, i + 4, j + 5, i + 5);     // right face
        idx.push(i + 6, j + 6, j + 7, i + 6, j + 7, i + 7);     // soffit
      }
    }
  }
  return n ? { pos: new Float32Array(pos), attr: new Float32Array(attr), index: new Uint32Array(idx) } : null;
}
