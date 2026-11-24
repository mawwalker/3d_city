// Steady-state picture after a pre-roll: who is standing and why, speed by road class.
(() => {
  const T = __app.traffic, cam = __app.camera;
  let t = __app.time;
  const MIN = window.__jamMinutes || 15;
  // body boxes (shrunk by 10 cm all round) overlapping, sampled every two seconds of simulated time: separating-axis test
  const hit = (A, B) => { const dx = B.x - A.x, dz = B.z - A.z, c = Math.abs(A.hx * B.hx + A.hz * B.hz), sn = Math.abs(A.hx * B.hz - A.hz * B.hx), al = A.len / 2 - 0.1, aw = A.wid / 2 - 0.1, bl = B.len / 2 - 0.1, bw = B.wid / 2 - 0.1;
    return Math.abs(dx * A.hx + dz * A.hz) < al + bl * c + bw * sn && Math.abs(dx * A.hz - dz * A.hx) < aw + bl * sn + bw * c && Math.abs(dx * B.hx + dz * B.hz) < bl + al * c + aw * sn && Math.abs(dx * B.hz - dz * B.hx) < bw + al * sn + aw * c; };
  let samples = 0, ovSum = 0, ovMax = 0, vehSum = 0; const ovAt = new Map(), ovEx = [];
  const overlaps = () => {
    const cells = new Map(); let n = 0, nv = 0;
    for (const lane of T.lanes) for (const v of lane.veh) {
      if (v.y < -1 || v.x === 0) continue; nv++;
      const k = Math.floor(v.x / 8) * 100003 + Math.floor(v.z / 8);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = cells.get(k + a * 100003 + b); if (c) for (const o of c) if (Math.abs(o.y - v.y) < 1.8 && hit(v, o)) { n++; const key = Math.round(v.x / 40) + ',' + Math.round(v.z / 40); ovAt.set(key, (ovAt.get(key) || 0) + 1);
        if (ovEx.length < 8) ovEx.push([Math.round(v.x), Math.round(v.z), v.cur ? 1 : 0, o.cur ? 1 : 0, v.lane === o.lane ? 1 : 0, +v.v.toFixed(1), +o.v.toFixed(1), v.lane.edge.flags & 32 ? 1 : 0, +(v.hx * o.hx + v.hz * o.hz).toFixed(2)]); } }
      let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(v);
    }
    samples++; ovSum += n; ovMax = Math.max(ovMax, n); vehSum += nv;
  };
  for (let i = 0; i < MIN * 1200; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); if (i % 40 === 39) overlaps(); }
  __app.time = t;
  const why = { go: 0, room: 0, red: 0, yield: 0, box: 0 }, W = ['go', 'room', 'red', 'yield', 'box'];
  const cls = {}; let n = 0, stopped = 0, com = 0, comStill = 0, cur = 0, follower = 0, heads = 0;
  for (const lane of T.lanes) {
    const vs = lane.veh;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i], lead = vs[i + 1]; n++;
      const c = cls[lane.edge.cls] || (cls[lane.edge.cls] = [0, 0, 0]); c[0]++; c[1] += v.v; if (v.v < 0.3) c[2]++;
      if (v.v >= 0.3) continue;
      stopped++;
      if (v.committed) { com++; continue; }
      if (v.cur) { cur++; continue; }
      if (!lead || lead.committed) { heads++; if (v.next) why[W[v.why | 0]]++; } else follower++;
    }
  }
  const byCls = {}; for (const k in cls) byCls[k] = [cls[k][0], +(cls[k][1] / cls[k][0] * 3.6).toFixed(1), +(cls[k][2] / cls[k][0]).toFixed(2)];
  return { minutes: MIN, n, overlapPairsPerSample: +(ovSum / samples).toFixed(3), overlapMax: ovMax, overlapPer1000VehMin: +(ovSum / (vehSum * 2 / 60) * 1000).toFixed(2), overlapSpots: [...ovAt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), ovEx, stopped, heads, why, follower, committedStanding: com, onConnectorStanding: cur, byCls, rings: T.rings, rerouted: T.rerouted, backed: T.backed, unknotted: T.unknotted, cleared: T.cleared };
})()
