(() => {
  const T = __app.traffic, cam = __app.camera;
  let t = __app.time;
  const t0 = performance.now();
  const N = 2400;
  for (let i = 0; i < N; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); }
  const ms = (performance.now() - t0) / N;
  __app.time = t;
  let n = 0, sp = 0, stopped = 0, maxWait = 0, w40 = 0, neg = 0, inBox = 0, noMove = 0, cur = 0;
  const cells = new Map(); let overlaps = 0; const ov = [];
  for (const lane of T.lanes) {
    const vs = lane.veh;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]; n++; sp += v.v; if (v.v < 0.3) stopped++; if (v.wait > maxWait) maxWait = v.wait; if (v.wait > 60) w40++;
      if (v.box) inBox++; if (v.noMove) noMove++; if (v.cur) cur++;
      if (i + 1 < vs.length && vs[i + 1].s - v.s - (vs[i + 1].len + v.len) / 2 < -0.3) neg++;
      if (v.y < -1) continue;
      // body boxes (shrunk by 10 cm all round) overlapping: separating-axis test
      const hit = (A, B) => { const dx = B.x - A.x, dz = B.z - A.z, c = Math.abs(A.hx * B.hx + A.hz * B.hz), sn = Math.abs(A.hx * B.hz - A.hz * B.hx), al = A.len / 2 - 0.1, aw = A.wid / 2 - 0.1, bl = B.len / 2 - 0.1, bw = B.wid / 2 - 0.1;
        return Math.abs(dx * A.hx + dz * A.hz) < al + bl * c + bw * sn && Math.abs(dx * A.hz - dz * A.hx) < aw + bl * sn + bw * c && Math.abs(dx * B.hx + dz * B.hz) < bl + al * c + aw * sn && Math.abs(dx * B.hz - dz * B.hx) < bw + al * sn + aw * c; };
      const k = Math.floor(v.x / 8) * 100003 + Math.floor(v.z / 8);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = cells.get(k + a * 100003 + b); if (c) for (const o of c) { if (Math.abs(o.y - v.y) < 2 && hit(v, o)) { overlaps++; if (ov.length < 6) ov.push([Math.round(v.x), Math.round(v.z), !!v.cur, !!o.cur, v.lane === o.lane, +(v.v).toFixed(1), +(o.v).toFixed(1)]); } } }
      let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(v);
    }
  }
  let boxed = 0; for (const nd of T.nodes.values()) boxed += nd.box.length;
  return { n, count: T.count, target: Math.round(T.target), meanKmh: +(sp / n * 3.6).toFixed(1), stopped, maxWait: +maxWait.toFixed(0), w40, neg, overlaps, ov, inBox, boxed, noMove, cur, msPerStep: +ms.toFixed(2), lanes: T.lanes.length };
})()
