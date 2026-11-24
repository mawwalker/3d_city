// Pedestrians (worker side): resamples walking paths into 100%-walkable, wall-free, teleport-free closed/ping-pong loops!
// Output:
//   path  (RGBA8: x and z as 16-bit fixed point over +-RANGE m from tile centre)
//   pathY (RGBA8: terrain elevation y in [YMIN, YMAX] as 16-bit fixed point in RG, smooth latScale [0..255] in B, 255 in A)
//   a0, a1, cells (5-float stride: [cx, cy, cz, first, count])

export const PEOPLE = { DS: 1.5, RANGE: 1500, YMIN: -30, YMAX: 750, CELL: 125, TEXW: 256, FILL: 0.6, MAXSLOT: 60 };

export function buildPeople(sec, tile, opts = {}) {
  const { DS, RANGE, YMIN, YMAX, CELL, TEXW, FILL, MAXSLOT } = PEOPLE;
  const cx = opts.cx || 0, cz = opts.cz || 0, terrain = opts.terrain || null;
  const inHero = opts.inHero || null;
  const inTunnel = opts.inTunnel || null;
  const waterY = terrain ? (terrain.waterY ?? 0.0) : 0.0;
  const sampleY = (lx, lz) => (terrain ? Math.max(terrain.sample(cx + lx, cz + lz), waterY + 0.15) : 0) + 0.19;

  // 1. Fast 8m grid of tree trunks so pedestrians NEVER clip cliffside tree trunks!
  const treeGrid = new Map();
  if (opts.trees && opts.trees.n) {
    const T = opts.trees, h2 = tile / 2;
    for (let k = 0; k < T.n; k++) {
      const tx = T.x[k] * 0.1 - h2, tz = -(T.y[k] * 0.1 - h2);
      const ck = Math.floor(tx / 8) * 100003 + Math.floor(tz / 8);
      let a = treeGrid.get(ck); if (!a) treeGrid.set(ck, a = []);
      a.push(tx, tz);
    }
  }
  const nearTree = (lx, lz) => {
    if (!treeGrid.size) return false;
    const ix = Math.floor(lx / 8), iz = Math.floor(lz / 8);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = treeGrid.get((ix + dx) * 100003 + (iz + dz));
      if (a) for (let i = 0; i < a.length; i += 2) {
        const d2 = (lx - a[i]) * (lx - a[i]) + (lz - a[i + 1]) * (lz - a[i + 1]);
        if (d2 < 1.40 * 1.40) return true;
      }
    }
    return false;
  };

  // 2. Fast 16m grid of ALL procedural building + river polygons in this tile (world coords -> tile-local)
  //    Guarantees 0% pedestrians ever walk inside or scrape against procedural building walls (+ 0.85m facadeKit margin)!
  const WALL_MARGIN = 0.85;
  const WALL_M2 = WALL_MARGIN * WALL_MARGIN;
  const col = opts.col || null;
  const bldGrid = new Map();
  if (col && col.start && col.start.length) {
    const nb = col.start.length, xz = col.xz;
    for (let b = 0; b < nb; b++) {
      const s = col.start[b], c = col.count[b];
      if (c < 3) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let k = 0; k < c; k++) {
        const wx = xz[(s + k) * 2] - cx, wz = xz[(s + k) * 2 + 1] - cz;
        if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
        if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
      }
      const gx0 = Math.floor((x0 - WALL_MARGIN) / 16), gx1 = Math.floor((x1 + WALL_MARGIN) / 16);
      const gz0 = Math.floor((z0 - WALL_MARGIN) / 16), gz1 = Math.floor((z1 + WALL_MARGIN) / 16);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const ck = gx * 100003 + gz;
        let a = bldGrid.get(ck); if (!a) bldGrid.set(ck, a = []);
        a.push(b);
      }
    }
  }
  const nearBuilding = (lx, lz, sy) => {
    if (!col || !bldGrid.size) return false;
    const a = bldGrid.get(Math.floor(lx / 16) * 100003 + Math.floor(lz / 16));
    if (!a) return false;
    const wx = cx + lx, wz = cz + lz, xz = col.xz;
    for (let idx = 0; idx < a.length; idx++) {
      const b = a[idx];
      if (sy + 1.85 < col.base[b] || sy - 0.35 > col.top[b]) continue;
      const s = col.start[b], c = col.count[b];
      let inside = false;
      for (let i = 0, j = c - 1; i < c; j = i++) {
        const xi = xz[(s + i) * 2], zi = xz[(s + i) * 2 + 1];
        const xj = xz[(s + j) * 2], zj = xz[(s + j) * 2 + 1];
        if ((zi > wz) !== (zj > wz) && wx < ((xj - xi) * (wz - zi)) / (zj - zi) + xi) inside = !inside;
        const ex = xi - xj, ez = zi - zj, l2 = ex * ex + ez * ez;
        let t = l2 > 1e-8 ? ((wx - xj) * ex + (wz - zj) * ez) / l2 : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const dx = wx - (xj + ex * t), dz = wz - (zj + ez * t);
        if (dx * dx + dz * dz < WALL_M2) return true;
      }
      if (inside) return true;
    }
    return false;
  };

  const nTmp = [0, 1, 0];
  const pointOk = (lx, lz, sy) => {
    const wx = cx + lx, wz = cz + lz;
    if (inHero && inHero(wx, wz)) return false;
    if (inTunnel && inTunnel(wx, wz)) return false;
    if (nearTree(lx, lz)) return false;
    if (nearBuilding(lx, lz, sy)) return false;
    if (terrain && terrain.ready) {
      terrain.sampleNormal(wx, wz, nTmp);
      if (nTmp[1] < 0.88) return false; // reject >28° retaining walls & cliff faces
    }
    return true;
  };

  const dv = new DataView(sec.buffer, sec.offset, sec.length);
  const nl = dv.getUint32(0, true), act = dv.getUint8(8) / 255;
  const half = tile / 2;
  let o = 12;
  const kinds = new Uint8Array(nl), flags = new Uint8Array(nl), npts = new Uint16Array(nl);
  for (let l = 0; l < nl; l++) {
    kinds[l] = dv.getUint8(o);
    flags[l] = dv.getUint8(o + 1); // bit 0 (flags & 1): 1 = open ping-pong centerline, 0 = closed ring
    npts[l] = dv.getUint16(o + 2, true);
    o += 4;
  }
  let seed = (nl * 7919 + dv.getUint32(4, true) * 31) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const samples = [], samplesY = [], samplesLat = [], a0 = [], a1 = [], cellOf = [];
  let start = 0;

  // Emit one 100%-walkable, teleport-free closed cycle (either naturally closed OR smooth ping-pong back-and-forth!)
  const emitCycle = (cxArr, czArr, cyArr, latArr, kind) => {
    const n = cxArr.length;
    if (n < 6) return;
    let L = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      L += Math.hypot(cxArr[j] - cxArr[i], czArr[j] - czArr[i]);
    }
    if (L < 10 || L > 60000) return;

    for (let i = 0; i < n; i++) {
      samples.push(cxArr[i], czArr[i]);
      samplesY.push(cyArr[i]);
      samplesLat.push(latArr[i]);
    }

    // Natural un-bunched pedestrian densities & wider minimum spacing (>= 4.5m)
    const rho = kind === 0 ? 0.006 + 0.042 * act * act : kind === 1 ? 0.026 + 0.095 * act : kind === 2 ? 0.012 + 0.034 * act : 0.004 + 0.014 * act;
    for (const [dir, pace, share] of [[1, 1.25, 0.45], [-1, 1.33, 0.45], [1, 1.72, 0.10]]) {
      const want = L * rho * share;
      let N = Math.max(Math.ceil(L / MAXSLOT), Math.round(want / FILL));
      N = Math.min(N, Math.floor(L / 4.5));
      if (N < 1 || want < 0.05) continue;
      const fill = Math.min(FILL + 0.08, want / N), D = n / N, phase = rnd() * 997, sd = rnd() * 0.999;
      for (let j = 0; j < N; j++) {
        a0.push(start, n, j, N);
        a1.push(pace * dir * n / L, phase, fill, kind + sd);
        let f = (j + 0.5) * D; if (dir < 0) f = n - f;
        const i0 = start + Math.min(n - 1, Math.max(0, Math.floor(f)));
        cellOf.push(Math.floor((samples[i0 * 2] + RANGE) / CELL) * 64 + Math.floor((samples[i0 * 2 + 1] + RANGE) / CELL));
      }
    }
    start += n;
  };

  for (let l = 0; l < nl; l++) {
    const m = npts[l];
    const X = new Float32Array(m + 1), Z = new Float32Array(m + 1), C = new Float32Array(m + 1);
    let px = 0, py = 0;
    for (let k = 0; k < m; k++, o += 4) {
      px += dv.getInt16(o, true); py += dv.getInt16(o + 2, true);
      X[k] = px * 0.1 - half; Z[k] = -(py * 0.1 - half);
    }
    if (m < 2) continue;

    // Detect whether polyline is genuinely closed (flags bit 0 == 0 AND gap <= 3.0m) vs an open ping-pong centerline!
    // NEVER connect open endpoints across buildings!
    const endGap = Math.hypot(X[m - 1] - X[0], Z[m - 1] - Z[0]);
    const isClosed = (flags[l] & 1) === 0 && m >= 3 && endGap <= 3.0;
    const segCount = isClosed ? m : m - 1;
    if (isClosed) { X[m] = X[0]; Z[m] = Z[0]; }
    C[0] = 0;
    for (let k = 1; k <= segCount; k++) C[k] = C[k - 1] + Math.hypot(X[k] - X[k - 1], Z[k] - Z[k - 1]);
    const L = C[segCount];
    if (L < 8 || L > 60000) continue;

    // Uniformly resample along the polyline at ~DS = 1.5m spacing
    const rawN = isClosed ? Math.max(6, Math.round(L / DS)) : Math.max(5, Math.round(L / DS) + 1);
    const rx = new Float32Array(rawN), rz = new Float32Array(rawN), ry = new Float32Array(rawN), ok = new Uint8Array(rawN);
    for (let i = 0, k = 0; i < rawN; i++) {
      const s = isClosed ? (i * L / rawN) : (i * L / (rawN - 1));
      while (k + 1 < segCount && C[k + 1] < s) k++;
      const t = (s - C[k]) / Math.max(C[k + 1] - C[k], 1e-6);
      const sx = X[k] + (X[k + 1] - X[k]) * t, sz = Z[k] + (Z[k + 1] - Z[k]) * t;
      const sy = sampleY(sx, sz);
      rx[i] = sx; rz[i] = sz; ry[i] = sy;
      ok[i] = pointOk(sx, sz, sy) ? 1 : 0;
    }

    // Validate adjacent step continuity (reject cliff drops > 0.42 grade or midpoint wall clips)
    const segOk = new Uint8Array(rawN);
    const numSegs = isClosed ? rawN : rawN - 1;
    for (let i = 0; i < numSegs; i++) {
      const j = (i + 1) % rawN;
      if (!ok[i] || !ok[j]) continue;
      const d = Math.hypot(rx[j] - rx[i], rz[j] - rz[i]);
      if (d > DS * 2.2) continue;
      if (Math.abs(ry[j] - ry[i]) / Math.max(d, 0.5) > 0.42) continue;
      const mx = (rx[i] + rx[j]) * 0.5, mz = (rz[i] + rz[j]) * 0.5, my = (ry[i] + ry[j]) * 0.5;
      if (nearBuilding(mx, mz, my)) continue;
      segOk[i] = 1;
    }

    const kind = kinds[l];

    // Case 1: Genuinely closed loop where EVERY sample & segment is 100% walkable & wall-free!
    let allClosedOk = isClosed;
    if (allClosedOk) {
      for (let i = 0; i < rawN; i++) if (!segOk[i]) { allClosedOk = false; break; }
    }
    if (allClosedOk) {
      const lat = new Float32Array(rawN);
      for (let i = 0; i < rawN; i++) {
        const ip = (i - 1 + rawN) % rawN, inx = (i + 1) % rawN;
        let ax = rx[i] - rx[ip], az = rz[i] - rz[ip], al = Math.hypot(ax, az) || 1;
        let bx = rx[inx] - rx[i], bz = rz[inx] - rz[i], bl = Math.hypot(bx, bz) || 1;
        const dot = (ax * bx + az * bz) / (al * bl);
        // Smoothly attenuate lateral offset around sharp corners so rt never whips sideways!
        lat[i] = Math.max(0.0, Math.min(1.0, (dot + 0.15) / 0.85));
      }
      emitCycle(rx, rz, ry, lat, kind);
      continue;
    }

    // Case 2: Open polyline OR loop broken by buildings/trees/cliffs/heroes -> extract clean continuous sub-runs
    //         and fold each run into a smooth back-and-forth ping-pong loop (ZERO teleports, ZERO wall crossing!).
    const runs = [];
    let cur = [];
    for (let i = 0; i < numSegs; i++) {
      if (segOk[i]) {
        if (!cur.length) cur.push(i);
        cur.push((i + 1) % rawN);
      } else if (cur.length) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
    // If originally closed and last run meets first run seamlessly at index 0, stitch them into one longer run
    if (isClosed && runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][runs[runs.length - 1].length - 1] === 0) {
      const tail = runs.pop();
      tail.pop(); // drop duplicate 0
      runs[0] = tail.concat(runs[0]);
    }

    for (const run of runs) {
      const K = run.length;
      if (K < 5) continue; // skip tiny <6m isolated pockets
      // Ping-pong closed cycle: [0, 1, ..., K-2, K-1, K-2, ..., 1] -> length 2*K - 2, every step ~1.5m!
      const n = 2 * K - 2;
      const cxArr = new Float32Array(n), czArr = new Float32Array(n), cyArr = new Float32Array(n), latArr = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const idx = i < K ? i : (n - i);
        const ri = run[idx];
        cxArr[i] = rx[ri]; czArr[i] = rz[ri]; cyArr[i] = ry[ri];
        // Smoothly taper lateral offset to 0.0 at turnaround endpoints (over 2.5 steps = 3.75m) so 180° turn has ZERO jump!
        const distEnd = Math.min(idx, K - 1 - idx);
        let ls = Math.min(1.0, distEnd / 2.5);
        if (idx > 0 && idx < K - 1) {
          const rp = run[idx - 1], rn = run[idx + 1];
          const ax = rx[ri] - rx[rp], az = rz[ri] - rz[rp], al = Math.hypot(ax, az) || 1;
          const bx = rx[rn] - rx[ri], bz = rz[rn] - rz[ri], bl = Math.hypot(bx, bz) || 1;
          const dot = (ax * bx + az * bz) / (al * bl);
          ls *= Math.max(0.0, Math.min(1.0, (dot + 0.15) / 0.85));
        }
        latArr[i] = ls;
      }
      emitCycle(cxArr, czArr, cyArr, latArr, kind);
    }
  }

  const ni = cellOf.length;
  if (!ni) return null;
  const h = Math.max(1, Math.ceil(start / TEXW));
  const path = new Uint8Array(TEXW * h * 4);
  const pathY = new Uint8Array(TEXW * h * 4);
  for (let i = 0; i < start; i++) {
    const u = Math.max(0, Math.min(65535, Math.round((samples[i * 2] + RANGE) / (2 * RANGE) * 65535)));
    const w = Math.max(0, Math.min(65535, Math.round((samples[i * 2 + 1] + RANGE) / (2 * RANGE) * 65535)));
    path[i * 4] = u >> 8; path[i * 4 + 1] = u & 255; path[i * 4 + 2] = w >> 8; path[i * 4 + 3] = w & 255;
    const qy = Math.max(0, Math.min(65535, Math.round((samplesY[i] - YMIN) / (YMAX - YMIN) * 65535)));
    pathY[i * 4] = qy >> 8; pathY[i * 4 + 1] = qy & 255;
    pathY[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(samplesLat[i] * 255)));
    pathY[i * 4 + 3] = 255;
  }
  const order = Array.from({ length: ni }, (_, i) => i).sort((a, b) => cellOf[a] - cellOf[b]);
  const A0 = new Float32Array(ni * 4), A1 = new Float32Array(ni * 4), cells = [];
  for (let q = 0; q < ni; q++) {
    const i = order[q];
    for (let c = 0; c < 4; c++) { A0[q * 4 + c] = a0[i * 4 + c]; A1[q * 4 + c] = a1[i * 4 + c]; }
    const cid = cellOf[i];
    if (!cells.length || cells[cells.length - 4] !== cid) cells.push(cid, 0, q, 0);
    cells[cells.length - 1]++;
  }
  const C = new Float32Array((cells.length / 4) * 5);
  for (let c = 0, ci = 0; c < cells.length; c += 4, ci += 5) {
    const cid = cells[c];
    const lx = (Math.floor(cid / 64) + 0.5) * CELL - RANGE;
    const lz = ((cid % 64) + 0.5) * CELL - RANGE;
    C[ci] = lx; C[ci + 1] = sampleY(lx, lz); C[ci + 2] = lz;
    C[ci + 3] = cells[c + 2]; C[ci + 4] = cells[c + 3];
  }
  return { path, pathY, w: TEXW, h, a0: A0, a1: A1, cells: C, count: ni };
}
