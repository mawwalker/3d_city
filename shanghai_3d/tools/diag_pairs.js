// Vehicle pairs whose bodies overlap, sampled every two seconds: what kind of pair, and where they recur.
(() => {
  const T = __app.traffic, cam = __app.camera;
  let t = __app.time;
  const MIN = window.__jamMinutes || 10;
  const hit = (A, B) => { const dx = B.x - A.x, dz = B.z - A.z, c = Math.abs(A.hx * B.hx + A.hz * B.hz), sn = Math.abs(A.hx * B.hz - A.hz * B.hx), al = A.len / 2 - 0.1, aw = A.wid / 2 - 0.1, bl = B.len / 2 - 0.1, bw = B.wid / 2 - 0.1;
    return Math.abs(dx * A.hx + dz * A.hz) < al + bl * c + bw * sn && Math.abs(dx * A.hz - dz * A.hx) < aw + bl * sn + bw * c && Math.abs(dx * B.hx + dz * B.hz) < bl + al * c + aw * sn && Math.abs(dx * B.hz - dz * B.hx) < bw + al * sn + aw * c; };
  const kinds = new Map(), spots = new Map();
  let samples = 0, vehSum = 0, tot = 0;
  const u0 = T.unknotted, c0 = T.cleared;
  const where = (q) => (q.cur ? 'curve' : q.committed ? 'commit' : 'lane');
  for (let i = 0; i < MIN * 1200; i++) {
    t += 0.05; T.update(0.05, t, cam, __app.env.hour);
    if (i % 40 !== 39) continue;
    samples++;
    const cells = new Map();
    for (const lane of T.lanes) for (const v of lane.veh) {
      if (v.y < -1 || v.x === 0) continue;
      vehSum++;
      const k = Math.floor(v.x / 8) * 100003 + Math.floor(v.z / 8);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = cells.get(k + a * 100003 + b); if (c) for (const o of c) if (Math.abs(o.y - v.y) < 1.8 && hit(v, o)) {
        tot++;
        const dot = v.hx * o.hx + v.hz * o.hz;
        const ang = dot > 0.85 ? 'same' : dot > 0.3 ? 'acute' : dot > -0.3 ? 'cross' : dot > -0.85 ? 'obtuse' : 'headon';
        const big = v.kind >= 5 || o.kind >= 5 ? ' big' : '';
        const mv = v.v > 0.5 || o.v > 0.5 ? ' moving' : ' still';
        const s = ang + ' ' + [where(v), where(o)].sort().join('+') + (v.lane === o.lane ? ' samelane' : v.lane.edge === o.lane.edge ? ' sameedge' : '') + (((v.lane.edge.flags | o.lane.edge.flags) & 2) ? ' deck' : '') + big + mv;
        let r = kinds.get(s); if (!r) kinds.set(s, r = { n: 0, ex: [Math.round(v.x), Math.round(v.z), v.lane.edge.cls, o.lane.edge.cls, Math.round(v.lane.edge.len), Math.round(o.lane.edge.len), v.lane.edge.nf, o.lane.edge.nf, +v.lat.toFixed(1), +o.lat.toFixed(1), v.kind, o.kind] }); r.n++;
        const sk = Math.round(v.x / 30) * 30 + ',' + Math.round(v.z / 30) * 30; spots.set(sk, (spots.get(sk) || 0) + 1);
      } }
      let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(v);
    }
  }
  __app.time = t;
  return { minutes: MIN, n: T.count, per1000VehMin: +(tot / (vehSum * 2 / 60) * 1000).toFixed(2), tot, unknotted: T.unknotted - u0, cleared: T.cleared - c0,
    kinds: [...kinds.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 14).map(([k, r]) => [k, r.n, r.ex.join(' ')]), spots: [...spots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) };
})()
