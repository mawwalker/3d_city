// The moment two bodies first overlap near a point: what each vehicle was doing. window.__spot = [x, z, r]
(() => {
  const T = __app.traffic, cam = __app.camera, [X, Z, R] = window.__spot;
  let t = __app.time;
  const MIN = window.__jamMinutes || 15;
  const hit = (A, B, m) => { const dx = B.x - A.x, dz = B.z - A.z, c = Math.abs(A.hx * B.hx + A.hz * B.hz), sn = Math.abs(A.hx * B.hz - A.hz * B.hx), al = A.len / 2 - m, aw = A.wid / 2 - m, bl = B.len / 2 - m, bw = B.wid / 2 - m;
    return Math.abs(dx * A.hx + dz * A.hz) < al + bl * c + bw * sn && Math.abs(dx * A.hz - dz * A.hx) < aw + bl * sn + bw * c && Math.abs(dx * B.hx + dz * B.hz) < bl + al * c + aw * sn && Math.abs(dx * B.hz - dz * B.hx) < bw + al * sn + aw * c; };
  const d = (v) => ({ id: v.id, at: [+v.x.toFixed(1), +v.z.toFixed(1)], h: [+v.hx.toFixed(2), +v.hz.toFixed(2)], k: v.kind, e: v.lane.edge.cls + '/' + Math.round(v.lane.edge.len) + '/' + v.lane.idx, s: +v.s.toFixed(1), s0: +v.lane.s0.toFixed(1), cur: v.cur ? v.cur.id + ':' + Math.round(v.cur.len) : 0, com: v.committed ? 1 : 0, v: +v.v.toFixed(1), nc: v.nc, bk: v.bk, blk: v.blk ? v.blk.id : 0, back: +v.back.toFixed(1), bw: +v.backW.toFixed(1), lat: +v.lat.toFixed(2), off: +v.lane.off.toFixed(2), far: v.lane.far, still: +v.still.toFixed(1) });
  const was = new Set(), out = [];
  for (let i = 0; i < MIN * 1200 && out.length < 6; i++) {
    t += 0.05; T.update(0.05, t, cam, __app.env.hour);
    const near = [];
    for (const lane of T.lanes) { const e = lane.edge, m = e.n >> 1; if (Math.abs(e.X[m] - X) > R + 300 || Math.abs(e.Z[m] - Z) > R + 300) continue; for (const v of lane.veh) if (Math.abs(v.x - X) < R && Math.abs(v.z - Z) < R) near.push(v); }
    const now = new Set();
    for (let a = 0; a < near.length; a++) for (let b = a + 1; b < near.length; b++) {
      const A = near[a], B = near[b];
      if (Math.abs(A.y - B.y) > 1.8 || !hit(A, B, 0.1)) continue;
      const key = Math.min(A.id, B.id) + '-' + Math.max(A.id, B.id); now.add(key);
      if (!was.has(key) && i > 600) out.push({ step: i, A: d(A), B: d(B) });
    }
    was.clear(); for (const k of now) was.add(k);
  }
  __app.time = t;
  return out;
})()
