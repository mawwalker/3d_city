// Pedestrians, worker side: turns a tile's walking loops (pipeline/37_traffic.py) into conveyors.
//
// A loop is resampled at even steps into a path texture. Along it run a few conveyors (each a direction and a pace) cut
// into slots; an instance stands for one slot and never leaves its stretch of the loop, so instances can be binned into
// ground cells and culled like static things. Who walks in the slot (build, clothes, whether anyone is there at all) is
// a hash of the walker's number, which the shader shifts along the slots as time passes: people walk right round the
// block, handed from instance to instance.
//
// Output: path (RGBA8: x and z as 16-bit fixed point over +-RANGE m from the tile centre), a0 = [first sample, samples,
// slot, slots], a1 = [pace in samples / s (negative: against the loop), phase, share of slots occupied, kind + seed],
// cells = [centre x, centre z, first instance, count] (centres relative to the tile centre).

export const PEOPLE = { DS: 1.5, RANGE: 1500, CELL: 125, TEXW: 256, FILL: 0.6, MAXSLOT: 60 };

export function buildPeople(sec, tile) {
  const { DS, RANGE, CELL, TEXW, FILL, MAXSLOT } = PEOPLE;
  const dv = new DataView(sec.buffer, sec.offset, sec.length);
  const nl = dv.getUint32(0, true), act = dv.getUint8(8) / 255;
  const half = tile / 2;
  let o = 12;
  const kinds = new Uint8Array(nl), npts = new Uint16Array(nl);
  for (let l = 0; l < nl; l++) { kinds[l] = dv.getUint8(o); npts[l] = dv.getUint16(o + 2, true); o += 4; }
  let seed = (nl * 7919 + dv.getUint32(4, true) * 31) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const samples = [], a0 = [], a1 = [], cellOf = [];
  let start = 0;
  for (let l = 0; l < nl; l++) {
    const m = npts[l];
    const X = new Float32Array(m + 1), Z = new Float32Array(m + 1), C = new Float32Array(m + 1);
    let px = 0, py = 0;
    for (let k = 0; k < m; k++, o += 4) { px += dv.getInt16(o, true); py += dv.getInt16(o + 2, true); X[k] = px * 0.1 - half; Z[k] = -(py * 0.1 - half); }
    X[m] = X[0]; Z[m] = Z[0];
    for (let k = 1; k <= m; k++) C[k] = C[k - 1] + Math.hypot(X[k] - X[k - 1], Z[k] - Z[k - 1]);
    const L = C[m];
    if (L < 8 || L > 60000) continue;
    const n = Math.max(6, Math.round(L / DS));
    for (let i = 0, k = 0; i < n; i++) {
      const s = i * L / n;
      while (k + 1 < m && C[k + 1] < s) k++;
      const t = (s - C[k]) / Math.max(C[k + 1] - C[k], 1e-6);
      samples.push(X[k] + (X[k + 1] - X[k]) * t, Z[k] + (Z[k + 1] - Z[k]) * t);
    }
    const kind = kinds[l];
    // people per metre of loop
    const rho = kind === 0 ? 0.008 + 0.075 * act * act : kind === 1 ? 0.05 + 0.20 * act : kind === 2 ? 0.015 + 0.045 * act : 0.005 + 0.018 * act;
    for (const [dir, pace, share] of [[1, 1.25, 0.45], [-1, 1.33, 0.45], [1, 1.72, 0.10]]) {
      const want = L * rho * share;                       // walkers on this conveyor
      let N = Math.max(Math.ceil(L / MAXSLOT), Math.round(want / FILL));
      N = Math.min(N, Math.floor(L / 2.4));
      if (N < 1 || want < 0.05) continue;
      const fill = Math.min(FILL + 0.1, want / N), D = n / N, phase = rnd() * 997, sd = rnd() * 0.999;
      for (let j = 0; j < N; j++) {
        a0.push(start, n, j, N); a1.push(pace * dir * n / L, phase, fill, kind + sd);
        let f = (j + 0.5) * D; if (dir < 0) f = n - f;
        const i0 = start + Math.min(n - 1, Math.max(0, Math.floor(f)));
        cellOf.push(Math.floor((samples[i0 * 2] + RANGE) / CELL) * 64 + Math.floor((samples[i0 * 2 + 1] + RANGE) / CELL));
      }
    }
    start += n;
  }
  const ni = cellOf.length;
  if (!ni) return null;
  // path texture
  const h = Math.max(1, Math.ceil(start / TEXW)), path = new Uint8Array(TEXW * h * 4);
  for (let i = 0; i < start; i++) {
    const u = Math.max(0, Math.min(65535, Math.round((samples[i * 2] + RANGE) / (2 * RANGE) * 65535))), w = Math.max(0, Math.min(65535, Math.round((samples[i * 2 + 1] + RANGE) / (2 * RANGE) * 65535)));
    path[i * 4] = u >> 8; path[i * 4 + 1] = u & 255; path[i * 4 + 2] = w >> 8; path[i * 4 + 3] = w & 255;
  }
  // instances grouped by cell
  const order = Array.from({ length: ni }, (_, i) => i).sort((a, b) => cellOf[a] - cellOf[b]);
  const A0 = new Float32Array(ni * 4), A1 = new Float32Array(ni * 4), cells = [];
  for (let q = 0; q < ni; q++) {
    const i = order[q];
    for (let c = 0; c < 4; c++) { A0[q * 4 + c] = a0[i * 4 + c]; A1[q * 4 + c] = a1[i * 4 + c]; }
    const cid = cellOf[i];
    if (!cells.length || cells[cells.length - 4] !== cid) cells.push(cid, 0, q, 0);
    cells[cells.length - 1]++;
  }
  const C = new Float32Array(cells.length);
  for (let c = 0; c < cells.length; c += 4) { const cid = cells[c]; C[c] = (Math.floor(cid / 64) + 0.5) * CELL - RANGE; C[c + 1] = ((cid % 64) + 0.5) * CELL - RANGE; C[c + 2] = cells[c + 2]; C[c + 3] = cells[c + 3]; }
  return { path, w: TEXW, h, a0: A0, a1: A1, cells: C, count: ni };
}
