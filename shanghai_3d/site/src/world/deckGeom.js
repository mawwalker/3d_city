// Elevated decks (worker): viaducts, flyovers, ramps and the big river bridges, from 3D centre lines.
// Output uses the ground vertex layout (aPos Int16 x4: x, y, z in 1/40 m + class; aNrm Int8 x4), classes 1 (running
// surface) and 32 (concrete structure), plus the segments the walker can stand on.

const Q = 40;
const pad4 = (n) => (n + 3) & ~3;

/** The deck centre lines of a tile: [{ x, y (north), h, n, cls, W, hung, twoWay }] in tile-centre metres. */
export function decodeDecks(sec, tile = 1000) {
  const { buffer, offset } = sec;
  const dv = new DataView(buffer, offset, sec.length);
  const nl = dv.getUint32(0, true), nv = dv.getUint32(4, true), na = dv.getUint32(8, true);
  let o = offset + 12;
  const cls = new Uint8Array(buffer, o, nl), wid = new Uint8Array(buffer, o + nl, nl); o += pad4(na * nl);
  const npts = new Uint16Array(buffer.slice(o, o + nl * 2)); o += pad4(nl * 2);
  const xy = new Int16Array(buffer.slice(o, o + nv * 4)); o += nv * 4;
  const zz = new Uint8Array(buffer, o, nv);
  const half = tile / 2, out = [];
  let vi = 0;
  for (let l = 0; l < nl; l++) {
    const n = npts[l];
    const x = new Float32Array(n), y = new Float32Array(n), h = new Float32Array(n);
    let px = 0, py = 0;
    for (let k = 0; k < n; k++, vi++) { px += xy[vi * 2]; py += xy[vi * 2 + 1]; x[k] = px * 0.1 - half; y[k] = py * 0.1 - half; h[k] = zz[vi] * 0.25; }
    out.push({ x, y, h, n, cls: cls[l] & 63, W: wid[l] / 4, hung: (cls[l] & 64) !== 0, twoWay: (cls[l] & 128) !== 0 });
  }
  return out;
}

/** roads: the tile's road centre lines (decodeLines), so that no pier is stood in a carriageway. */
export function buildDecks(sec, tile = 1000, roads = null) {
  const { buffer, offset } = sec;
  const dv = new DataView(buffer, offset, sec.length);
  const nl = dv.getUint32(0, true), nv = dv.getUint32(4, true), na = dv.getUint32(8, true);
  let o = offset + 12;
  const cls = new Uint8Array(buffer, o, nl), wid = new Uint8Array(buffer, o + nl, nl); o += pad4(na * nl);
  const npts = new Uint16Array(buffer.slice(o, o + nl * 2)); o += pad4(nl * 2);
  const xy = new Int16Array(buffer.slice(o, o + nv * 4)); o += nv * 4;
  const zz = new Uint8Array(buffer, o, nv);
  const half = tile / 2;
  const pos = [], nrm = [], idx = [], segs = [];
  let n = 0;
  // the carriageways at street level, in 12 m cells: [x0, y0, x1, y1, half width + clearance] per segment
  const cells = new Map();
  if (roads) {
    const rc = roads.attrs[0], rw = roads.attrs[1], rf = roads.attrs[3];
    let ri = 0;
    for (let l = 0; l < roads.nl; l++) {
      const m = roads.npts[l], c = rc[l] & 15, use = (c <= 7 || c === 11) && !(rf[l] & 2);
      let x0 = 0, y0 = 0;
      for (let k = 0; k < m; k++, ri++) {
        x0 += roads.xy[ri * 2]; y0 += roads.xy[ri * 2 + 1];
        if (!use || k + 1 >= m) continue;
        const ax = x0 * 0.1 - half, ay = y0 * 0.1 - half, bx = ax + roads.xy[ri * 2 + 2] * 0.1, by = ay + roads.xy[ri * 2 + 3] * 0.1, r = rw[l] / 8 + 1.4;
        const seg = [ax, ay, bx, by, r];
        for (let gx = Math.floor((Math.min(ax, bx) - r) / 12); gx <= Math.floor((Math.max(ax, bx) + r) / 12); gx++) for (let gy = Math.floor((Math.min(ay, by) - r) / 12); gy <= Math.floor((Math.max(ay, by) + r) / 12); gy++) {
          const key = gx * 100003 + gy; let a = cells.get(key); if (!a) cells.set(key, a = []); a.push(seg);
        }
      }
    }
  }
  const onRoad = (x, y) => {
    const a = cells.get(Math.floor(x / 12) * 100003 + Math.floor(y / 12));
    if (a) for (const [ax, ay, bx, by, r] of a) {
      const ux = bx - ax, uy = by - ay, l2 = ux * ux + uy * uy, t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / l2)) : 0, ex = x - ax - ux * t, ey = y - ay - uy * t;
      if (ex * ex + ey * ey < r * r) return true;
    }
    return false;
  };
  const v = (x, y, nn, c, nx, ny, nz) => { pos.push(Math.round(x * Q), Math.round(y * Q), Math.round(-nn * Q), c); nrm.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(-nz * 127), 0); return n++; };
  // quad a-b-c-d (counter-clockwise seen from the side the normal points to), flat normal
  const quad = (A, B, C, D, c, nx, ny, nz) => { const i = v(A[0], A[1], A[2], c, nx, ny, nz); v(B[0], B[1], B[2], c, nx, ny, nz); v(C[0], C[1], C[2], c, nx, ny, nz); v(D[0], D[1], D[2], c, nx, ny, nz); idx.push(i, i + 1, i + 2, i, i + 2, i + 3); };
  const box = (cx, cn, y0, y1, ax, an, hl, hw) => {
    // oriented box: (ax, an) unit direction along, half-length hl, half-width hw
    const px = -an, pn = ax;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [cx + ax * hl * s + px * hw * t, cn + an * hl * s + pn * hw * t]);
    for (let k = 0; k < 4; k++) { const a = c[k], b = c[(k + 1) % 4]; const ex = b[0] - a[0], en = b[1] - a[1], l = Math.hypot(ex, en) || 1; quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], 32, en / l, 0, -ex / l); }
  };
  // Every deck of the tile first. Where two of them meet at one level (a fork, a merge, a junction on a viaduct or on the hump
  // of a bridge head) the parapet of one would stand across the other's carriageway: it is left out wherever it falls inside
  // another deck's running surface.
  const D = [];
  for (let l = 0, vi = 0; l < nl; l++) {
    const m = npts[l];
    let px = 0, py = 0;
    const X = new Float32Array(m), N = new Float32Array(m), H = new Float32Array(m);
    for (let k = 0; k < m; k++, vi++) { px += xy[vi * 2]; py += xy[vi * 2 + 1]; X[k] = px * 0.1 - half; N[k] = py * 0.1 - half; H[k] = zz[vi] * 0.25; }
    D.push({ X, N, H, hw: wid[l] / 8 + 0.45 });
  }
  const dcells = new Map();
  for (let l = 0; l < nl; l++) {
    const { X, N, H, hw } = D[l];
    for (let k = 0; k + 1 < X.length; k++) {
      if (H[k] < 0.3 && H[k + 1] < 0.3) continue;
      const ax = X[k], ay = N[k], bx = X[k + 1], by = N[k + 1];
      for (let gx = Math.floor((Math.min(ax, bx) - hw) / 12); gx <= Math.floor((Math.max(ax, bx) + hw) / 12); gx++) for (let gy = Math.floor((Math.min(ay, by) - hw) / 12); gy <= Math.floor((Math.max(ay, by) + hw) / 12); gy++) {
        const key = gx * 100003 + gy; let a = dcells.get(key); if (!a) dcells.set(key, a = []); a.push(l, k);
      }
    }
  }
  const onDeck = (x, y, h, self) => {
    const a = dcells.get(Math.floor(x / 12) * 100003 + Math.floor(y / 12));
    if (a) for (let i = 0; i < a.length; i += 2) {
      const l = a[i]; if (l === self) continue;
      const d = D[l], k = a[i + 1], ax = d.X[k], ay = d.N[k], ux = d.X[k + 1] - ax, uy = d.N[k + 1] - ay, l2 = ux * ux + uy * uy;
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / l2)) : 0, ex = x - ax - ux * t, ey = y - ay - uy * t, r = d.hw - 0.6;
      if (r > 0 && ex * ex + ey * ey < r * r && Math.abs(d.H[k] + (d.H[k + 1] - d.H[k]) * t - h) < 1.2) return true;
    }
    return false;
  };
  for (let l = 0; l < nl; l++) {
    const { X, N, H } = D[l], m = X.length;
    const W = wid[l] / 4, hw = W / 2 + 0.45;
    const was = [null, null];                  // per side: was the last piece of parapet left out?
    const hung = (cls[l] & 64) !== 0;          // a span that hangs from towers: no piers under it
    // cross-sections
    const Lx = new Float32Array(m), Ln = new Float32Array(m), Rx = new Float32Array(m), Rn = new Float32Array(m), dirx = new Float32Array(m), dirn = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 1), b = Math.min(m - 1, k + 1);
      let dx = X[b] - X[a], dn = N[b] - N[a]; const len = Math.hypot(dx, dn) || 1; dx /= len; dn /= len;
      dirx[k] = dx; dirn[k] = dn;
      Lx[k] = X[k] - dn * hw; Ln[k] = N[k] + dx * hw; Rx[k] = X[k] + dn * hw; Rn[k] = N[k] - dx * hw;
    }
    let acc = 0, nextPier = 14;
    for (let k = 0; k + 1 < m; k++) {
      const h0 = H[k], h1 = H[k + 1];
      if (h0 < 0.3 && h1 < 0.3) continue;
      const seg = Math.hypot(X[k + 1] - X[k], N[k + 1] - N[k]);
      const dx = dirx[k], dn = dirn[k];
      const th = 1.4, par = 0.95;
      // structure depth: a girder in the air, a solid embankment where the ramp is low
      const b0 = h0 < 3.2 ? 0.15 : h0 - th, b1 = h1 < 3.2 ? 0.15 : h1 - th;
      const y0 = Math.max(h0, 0.16), y1 = Math.max(h1, 0.16);
      // running surface
      quad([Rx[k], y0, Rn[k]], [Rx[k + 1], y1, Rn[k + 1]], [Lx[k + 1], y1, Ln[k + 1]], [Lx[k], y0, Ln[k]], 1, 0, 1, 0);
      // the two sides: the outer face of the structure, and on it the parapet (outer face, inner face, top), in pieces of
      // 4 m at most, each left out where it would stand in another deck's carriageway
      const t = 0.28, np = Math.max(1, Math.ceil(seg / 4));
      for (let side = 0; side < 2; side++) {
        const Ex = side ? Rx : Lx, En = side ? Rn : Ln, ox = side ? dn : -dn, on = side ? -dx : dx;      // (ox, on): outwards
        const at = (f) => [Ex[k] + (Ex[k + 1] - Ex[k]) * f, En[k] + (En[k + 1] - En[k]) * f, y0 + (y1 - y0) * f, b0 + (b1 - b0) * f];
        let from = 0, state = null;
        for (let j = 0; j <= np; j++) {
          let open = null;
          if (j < np) { const [ex, en, eh] = at((j + 0.5) / np); open = onDeck(ex - ox * 0.14, en - on * 0.14, eh, l); }
          if (j < np && was[side] !== null && was[side] !== open) {
            // the parapet stops (or starts) here: its end face, seen from either side
            const [ex, en, ey] = at(j / np), ix = ex - ox * t, inn = en - on * t;
            quad([ex, ey, en], [ix, ey, inn], [ix, ey + par, inn], [ex, ey + par, en], 32, dx, 0, dn);
            quad([ix, ey, inn], [ex, ey, en], [ex, ey + par, en], [ix, ey + par, inn], 32, -dx, 0, -dn);
          }
          if (j < np) was[side] = open;
          if (j === np || open !== state) {
            if (j > from) {
              const [ax, an, ya, ba] = at(from / np), [bx, bn, yb, bb] = at(j / np), top = state ? 0 : par;
              if (side === 0) quad([bx, bb, bn], [ax, ba, an], [ax, ya + top, an], [bx, yb + top, bn], 32, ox, 0, on);
              else quad([ax, ba, an], [bx, bb, bn], [bx, yb + top, bn], [ax, ya + top, an], 32, ox, 0, on);
              if (!state) {
                const aix = ax - ox * t, ain = an - on * t, bix = bx - ox * t, bin = bn - on * t;
                if (side === 0) { quad([aix, ya, ain], [bix, yb, bin], [bix, yb + par, bin], [aix, ya + par, ain], 32, -ox, 0, -on); quad([ax, ya + par, an], [aix, ya + par, ain], [bix, yb + par, bin], [bx, yb + par, bn], 32, 0, 1, 0); }
                else { quad([bix, yb, bin], [aix, ya, ain], [aix, ya + par, ain], [bix, yb + par, bin], 32, -ox, 0, -on); quad([aix, ya + par, ain], [ax, ya + par, an], [bx, yb + par, bn], [bix, yb + par, bin], 32, 0, 1, 0); }
              }
            }
            from = j; state = open;
          }
        }
      }
      // soffit
      if (b0 > 0.2 || b1 > 0.2) quad([Lx[k], b0, Ln[k]], [Lx[k + 1], b1, Ln[k + 1]], [Rx[k + 1], b1, Rn[k + 1]], [Rx[k], b0, Rn[k]], 32, 0, -1, 0);
      segs.push(X[k], -N[k], y0, X[k + 1], -N[k + 1], y1, hw - 0.3);
      // piers
      acc += seg;
      if (!hung && acc >= nextPier && h0 > 3.6 && h1 > 3.6) {
        const cx = (X[k] + X[k + 1]) / 2, cn = (N[k] + N[k + 1]) / 2, hh = (h0 + h1) / 2;
        // (not in the road the deck crosses: the pier goes up a few metres further on)
        if (onRoad(cx, cn)) { nextPier = acc + 5; continue; }
        nextPier = acc + 30;
        box(cx, cn, 0.1, hh - th - 1.3, dx, dn, 0.9, Math.min(1.5, W * 0.16));
        box(cx, cn, hh - th - 1.3, hh - th + 0.05, dx, dn, 1.1, Math.max(1.6, W * 0.36));
      }
    }
  }
  return { mesh: n ? { pos: new Int16Array(pos), nrm: new Int8Array(nrm), index: new Uint32Array(idx), nTris: idx.length / 3 } : null, segs: new Float32Array(segs) };
}
