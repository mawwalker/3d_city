// 3D Terrain-Anchored Elevated Decks (worker): Chongqing mountain viaducts, ramps, flyovers & interchanges.
// Deck clearance heights in section 9 (0.25m units) are added to max(sampleTerrain(wx, wz), waterY).
// Piers anchor cleanly 3.5m into the real DEM slope (ZERO floating piers!).
// Vertex layout matches groundMaterial.js: Float32 aPos x4 (metres relative to tile centre + class), Int8 aNrm x4.

const pad4 = (n) => (n + 3) & ~3;

/** Decode deck centre lines of a tile: [{ x, y (north), h (world Y), cl (clearance), n, cls, W, hung, twoWay }] in tile-centre metres. */
export function decodeDecks(sec, tile = 1000, opts = {}) {
  const { buffer, offset } = sec;
  const dv = new DataView(buffer, offset, sec.length);
  const nl = dv.getUint32(0, true), nv = dv.getUint32(4, true), na = dv.getUint32(8, true);
  let o = offset + 12;
  const cls = new Uint8Array(buffer, o, nl), wid = new Uint8Array(buffer, o + nl, nl); o += pad4(na * nl);
  const npts = new Uint16Array(buffer.slice(o, o + nl * 2)); o += pad4(nl * 2);
  const xy = new Int16Array(buffer.slice(o, o + nv * 4)); o += nv * 4;
  const zz = new Uint8Array(buffer, o, nv);
  const half = tile / 2, out = [];
  const cx = opts.cx || 0, cz = opts.cz || 0, terrain = opts.terrain || null;
  const waterY = terrain ? (terrain.waterY ?? 0.0) : 0.0;
  let vi = 0;
  for (let l = 0; l < nl; l++) {
    const n = npts[l];
    const x = new Float32Array(n), y = new Float32Array(n), h = new Float32Array(n), cl = new Float32Array(n);
    let px = 0, py = 0;
    for (let k = 0; k < n; k++, vi++) {
      px += xy[vi * 2]; py += xy[vi * 2 + 1];
      const lx = px * 0.1 - half, ln = py * 0.1 - half;
      const clr = zz[vi] * 0.25;
      const base = terrain ? Math.max(terrain.sample(cx + lx, cz - ln), waterY) : waterY;
      x[k] = lx; y[k] = ln; cl[k] = clr; h[k] = base + clr;
    }
    out.push({ x, y, h, cl, n, cls: cls[l] & 63, W: wid[l] / 4, hung: (cls[l] & 64) !== 0, twoWay: (cls[l] & 128) !== 0 });
  }
  return out;
}

export function buildDecks(sec, tile = 1000, roads = null, opts = {}) {
  const { buffer, offset } = sec;
  const dv = new DataView(buffer, offset, sec.length);
  const nl = dv.getUint32(0, true), nv = dv.getUint32(4, true), na = dv.getUint32(8, true);
  let o = offset + 12;
  const cls = new Uint8Array(buffer, o, nl), wid = new Uint8Array(buffer, o + nl, nl); o += pad4(na * nl);
  const npts = new Uint16Array(buffer.slice(o, o + nl * 2)); o += pad4(nl * 2);
  const xy = new Int16Array(buffer.slice(o, o + nv * 4)); o += nv * 4;
  const zz = new Uint8Array(buffer, o, nv);
  const half = tile / 2;
  const cx = opts.cx || 0, cz = opts.cz || 0, terrain = opts.terrain || null;
  const waterY = terrain ? (terrain.waterY ?? 0.0) : 0.0;
  const groundAt = (lx, ln) => terrain ? terrain.sample(cx + lx, cz - ln) : 0.0;
  const baseAt = (lx, ln) => Math.max(groundAt(lx, ln), waterY);

  const pos = [], nrm = [], idx = [], segs = [];
  let n = 0, minY = 1e9, maxY = -1e9;

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
        for (let gx = Math.floor((Math.min(ax, bx) - r) / 12); gx <= Math.floor((Math.max(ax, bx) + r) / 12); gx++) {
          for (let gy = Math.floor((Math.min(ay, by) - r) / 12); gy <= Math.floor((Math.max(ay, by) + r) / 12); gy++) {
            const key = gx * 100003 + gy; let a = cells.get(key); if (!a) cells.set(key, a = []); a.push(seg);
          }
        }
      }
    }
  }
  const onRoad = (x, y) => {
    const a = cells.get(Math.floor(x / 12) * 100003 + Math.floor(y / 12));
    if (a) for (const [ax, ay, bx, by, r] of a) {
      const ux = bx - ax, uy = by - ay, l2 = ux * ux + uy * uy;
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / l2)) : 0;
      const ex = x - ax - ux * t, ey = y - ay - uy * t;
      if (ex * ex + ey * ey < r * r) return true;
    }
    return false;
  };

  const v = (x, y, nn, c, nx, ny, nz) => {
    pos.push(x, y, -nn, c);
    nrm.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(-nz * 127), 0);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    return n++;
  };
  const quad = (A, B, C, D, c, nx, ny, nz) => {
    const i = v(A[0], A[1], A[2], c, nx, ny, nz);
    v(B[0], B[1], B[2], c, nx, ny, nz);
    v(C[0], C[1], C[2], c, nx, ny, nz);
    v(D[0], D[1], D[2], c, nx, ny, nz);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const box = (pxc, pnc, y0, y1, ax, an, hl, hw) => {
    const px = -an, pn = ax;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [pxc + ax * hl * s + px * hw * t, pnc + an * hl * s + pn * hw * t]);
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      const ex = b[0] - a[0], en = b[1] - a[1], l = Math.hypot(ex, en) || 1;
      quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], 32, en / l, 0, -ex / l);
    }
  };

  const D = [];
  for (let l = 0, vi = 0; l < nl; l++) {
    const m = npts[l];
    let px = 0, py = 0;
    const rawX = new Float32Array(m), rawN = new Float32Array(m), rawCL = new Float32Array(m);
    for (let k = 0; k < m; k++, vi++) {
      px += xy[vi * 2]; py += xy[vi * 2 + 1];
      rawX[k] = px * 0.1 - half; rawN[k] = py * 0.1 - half; rawCL[k] = zz[vi] * 0.25;
    }
    // Subdivide long spans (> 10m) so elevated ramps & hillside viaducts NEVER chord underground across convex ridges!
    const sX = [], sN = [], sCL = [], sH = [];
    for (let k = 0; k < m; k++) {
      if (k === 0) {
        const lx = rawX[0], ln = rawN[0], cl = rawCL[0];
        sX.push(lx); sN.push(ln); sCL.push(cl); sH.push(baseAt(lx, ln) + cl);
      } else {
        const ax = rawX[k - 1], an = rawN[k - 1], acl = rawCL[k - 1];
        const bx = rawX[k], bn = rawN[k], bcl = rawCL[k];
        const segLen = Math.hypot(bx - ax, bn - an);
        const steps = Math.max(1, Math.min(20, Math.ceil(segLen / 10.0)));
        const ha = baseAt(ax, an) + acl, hb = baseAt(bx, bn) + bcl;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const lx = ax + (bx - ax) * t, ln = an + (bn - an) * t, cl = acl + (bcl - acl) * t;
          const g = baseAt(lx, ln);
          // Smoothly follow bridge world-Y chord while guaranteeing deck never dips below hillside terrain!
          const hInterp = ha + (hb - ha) * t;
          const h = Math.max(hInterp, g + Math.max(cl, 0.24));
          sX.push(lx); sN.push(ln); sCL.push(cl); sH.push(h);
        }
      }
    }
    D.push({ X: Float32Array.from(sX), N: Float32Array.from(sN), H: Float32Array.from(sH), CL: Float32Array.from(sCL), hw: wid[l] / 8 + 0.45 });
  }
  const dcells = new Map();
  for (let l = 0; l < nl; l++) {
    const { X, N, CL, hw } = D[l];
    for (let k = 0; k + 1 < X.length; k++) {
      if (CL[k] < 0.3 && CL[k + 1] < 0.3) continue;
      const ax = X[k], ay = N[k], bx = X[k + 1], by = N[k + 1];
      for (let gx = Math.floor((Math.min(ax, bx) - hw) / 12); gx <= Math.floor((Math.max(ax, bx) + hw) / 12); gx++) {
        for (let gy = Math.floor((Math.min(ay, by) - hw) / 12); gy <= Math.floor((Math.max(ay, by) + hw) / 12); gy++) {
          const key = gx * 100003 + gy; let a = dcells.get(key); if (!a) dcells.set(key, a = []); a.push(l, k);
        }
      }
    }
  }
  const onDeck = (x, y, h, self) => {
    const a = dcells.get(Math.floor(x / 12) * 100003 + Math.floor(y / 12));
    if (a) for (let i = 0; i < a.length; i += 2) {
      const l = a[i]; if (l === self) continue;
      const d = D[l], k = a[i + 1], ax = d.X[k], ay = d.N[k], ux = d.X[k + 1] - ax, uy = d.N[k + 1] - ay, l2 = ux * ux + uy * uy;
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / l2)) : 0;
      const ex = x - ax - ux * t, ey = y - ay - uy * t, r = d.hw - 0.6;
      if (r > 0 && ex * ex + ey * ey < r * r && Math.abs(d.H[k] + (d.H[k + 1] - d.H[k]) * t - h) < 1.2) return true;
    }
    return false;
  };

  for (let l = 0; l < nl; l++) {
    const { X, N, H, CL } = D[l], m = X.length;
    const W = wid[l] / 4, hw = W / 2 + 0.45;
    const was = [null, null];
    const hung = (cls[l] & 64) !== 0;
    const Lx = new Float32Array(m), Ln = new Float32Array(m), Rx = new Float32Array(m), Rn = new Float32Array(m), dirx = new Float32Array(m), dirn = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 1), b = Math.min(m - 1, k + 1);
      let dx = X[b] - X[a], dn = N[b] - N[a]; const len = Math.hypot(dx, dn) || 1; dx /= len; dn /= len;
      dirx[k] = dx; dirn[k] = dn;
      Lx[k] = X[k] - dn * hw; Ln[k] = N[k] + dx * hw; Rx[k] = X[k] + dn * hw; Rn[k] = N[k] - dx * hw;
    }
    let acc = 0, nextPier = 14;
    for (let k = 0; k + 1 < m; k++) {
      const cl0 = CL[k], cl1 = CL[k + 1];
      if (cl0 < 0.3 && cl1 < 0.3) continue;
      const h0 = H[k], h1 = H[k + 1];
      const seg = Math.hypot(X[k + 1] - X[k], N[k + 1] - N[k]);
      const dx = dirx[k], dn = dirn[k];
      const th = 1.45, par = 0.95;
      const g0 = groundAt(X[k], N[k]), g1 = groundAt(X[k + 1], N[k + 1]);
      // Check transverse uphill hillside at both left & right deck edges so mountain terrain NEVER pokes through a deck!
      const g0Side = Math.max(groundAt(Lx[k], Ln[k]), groundAt(Rx[k], Rn[k]));
      const g1Side = Math.max(groundAt(Lx[k + 1], Ln[k + 1]), groundAt(Rx[k + 1], Rn[k + 1]));
      const inTunnel = opts.inTunnel || null;
      const overRoadOrTunnel = onRoad(X[k], N[k]) || onRoad(X[k + 1], N[k + 1])
        || (inTunnel && (inTunnel(cx + X[k], cz - N[k]) || inTunnel(cx + X[k + 1], cz - N[k + 1])));
      // Never drop a solid ground-hugging sandstone abutment wall across a lower roadway or tunnel portal approach!
      const solidRamp0 = cl0 < 3.2 && !overRoadOrTunnel;
      const solidRamp1 = cl1 < 3.2 && !overRoadOrTunnel;
      const b0 = solidRamp0 ? g0 - 3.5 : h0 - Math.min(th, Math.max(0.50, cl0 * 0.45));
      const b1 = solidRamp1 ? g1 - 3.5 : h1 - Math.min(th, Math.max(0.50, cl1 * 0.45));
      const y0 = Math.max(h0, g0 + 0.24, Math.min(g0Side, g0 + 9.5) + 0.22);
      const y1 = Math.max(h1, g1 + 0.24, Math.min(g1Side, g1 + 9.5) + 0.22);

      // Sloped running surface normal
      const slope = (y1 - y0) / Math.max(seg, 0.1);
      const snLen = Math.hypot(slope, 1.0);
      const rnx = -dx * slope / snLen, rny = 1.0 / snLen, rnn = -dn * slope / snLen;
      quad([Rx[k], y0, Rn[k]], [Rx[k + 1], y1, Rn[k + 1]], [Lx[k + 1], y1, Ln[k + 1]], [Lx[k], y0, Ln[k]], 1, rnx, rny, rnn);

      const t = 0.28, np = Math.max(1, Math.ceil(seg / 4));
      const sideCls = (solidRamp0 && solidRamp1) ? 33 : 32; // sandstone abutment walls ONLY on earth-backed hillside ramps, concrete girders over roads/tunnels!
      for (let side = 0; side < 2; side++) {
        const Ex = side ? Rx : Lx, En = side ? Rn : Ln, ox = side ? dn : -dn, on = side ? -dx : dx;
        const at = (f) => [Ex[k] + (Ex[k + 1] - Ex[k]) * f, En[k] + (En[k + 1] - En[k]) * f, y0 + (y1 - y0) * f, b0 + (b1 - b0) * f];
        let from = 0, state = null;
        for (let j = 0; j <= np; j++) {
          let open = null;
          if (j < np) { const [ex, en, eh] = at((j + 0.5) / np); open = onDeck(ex - ox * 0.14, en - on * 0.14, eh, l); }
          if (j < np && was[side] !== null && was[side] !== open) {
            const [ex, en, ey] = at(j / np), ix = ex - ox * t, inn = en - on * t;
            quad([ex, ey, en], [ix, ey, inn], [ix, ey + par, inn], [ex, ey + par, en], 32, dx, 0, dn);
            quad([ix, ey, inn], [ex, ey, en], [ex, ey + par, en], [ix, ey + par, inn], 32, -dx, 0, -dn);
          }
          if (j < np) was[side] = open;
          if (j === np || open !== state) {
            if (j > from) {
              const [ax, an, ya, ba] = at(from / np), [bx, bn, yb, bb] = at(j / np), top = state ? 0 : par;
              if (side === 0) quad([bx, bb, bn], [ax, ba, an], [ax, ya + top, an], [bx, yb + top, bn], sideCls, ox, 0, on);
              else quad([ax, ba, an], [bx, bb, bn], [bx, yb + top, bn], [ax, ya + top, an], sideCls, ox, 0, on);
              if (!state) {
                const aix = ax - ox * t, ain = an - on * t, bix = bx - ox * t, bin = bn - on * t;
                if (side === 0) {
                  quad([aix, ya, ain], [bix, yb, bin], [bix, yb + par, bin], [aix, ya + par, ain], 32, -ox, 0, -on);
                  quad([ax, ya + par, an], [aix, ya + par, ain], [bix, yb + par, bin], [bx, yb + par, bn], 32, 0, 1, 0);
                } else {
                  quad([bix, yb, bin], [aix, ya, ain], [aix, ya + par, ain], [bix, yb + par, bin], 32, -ox, 0, -on);
                  quad([aix, ya + par, ain], [ax, ya + par, an], [bx, yb + par, bn], [bix, yb + par, bin], 32, 0, 1, 0);
                }
              }
            }
            from = j; state = open;
          }
        }
      }
      if (!solidRamp0 || !solidRamp1) quad([Lx[k], b0, Ln[k]], [Lx[k + 1], b1, Ln[k + 1]], [Rx[k + 1], b1, Rn[k + 1]], [Rx[k], b0, Rn[k]], 32, 0, -1, 0);
      segs.push(X[k], -N[k], y0, X[k + 1], -N[k + 1], y1, hw + 0.15);

      // Mountain-city piers extending 3.5m deep into DEM terrain (never floating on Chongqing cliffs!)
      acc += seg;
      if (!hung && acc >= nextPier && cl0 > 3.6 && cl1 > 3.6) {
        const pxc = (X[k] + X[k + 1]) / 2, pnc = (N[k] + N[k + 1]) / 2, hh = (h0 + h1) / 2;
        if (onRoad(pxc, pnc)) { nextPier = acc + 5; continue; }
        nextPier = acc + 30;
        const pierFoot = groundAt(pxc, pnc) - 3.5;
        if (hh - th - 1.3 > pierFoot + 0.5) {
          box(pxc, pnc, pierFoot, hh - th - 1.3, dx, dn, 0.95, Math.min(1.6, W * 0.17));
        }
        box(pxc, pnc, hh - th - 1.35, hh - th + 0.05, dx, dn, 1.15, Math.max(1.6, W * 0.38));
      }
    }
  }

  return {
    mesh: n ? {
      pos: new Float32Array(pos),
      nrm: new Int8Array(nrm),
      index: new Uint32Array(idx),
      nTris: idx.length / 3,
      bounds: [-half, minY === 1e9 ? -5 : minY - 1, -half, half, maxY === -1e9 ? 50 : maxY + 2, half],
    } : null,
    segs: new Float32Array(segs),
  };
}
