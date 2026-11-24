// After a pre-roll: the vehicles standing near a point and what each is waiting for. window.__spot = [x, z, r]
(() => {
  const T = __app.traffic, cam = __app.camera, [X, Z, R] = window.__spot;
  let t = __app.time;
  const MIN = window.__jamMinutes || 6;
  let found = null;
  for (let i = 0; i < MIN * 1200 && !found; i++) {
    t += 0.05; T.update(0.05, t, cam, __app.env.hour);
    if (i % 100 === 99 && i > 2400) { let n = 0; for (const lane of T.lanes) for (const v of lane.veh) if (v.cur && v.still > (window.__minWait || 25) && Math.hypot(v.x - X, v.z - Z) < R) n++; if (n >= 1) found = i; }
  }
  __app.time = t;
  const out = [];
  for (const lane of T.lanes) for (let i = 0; i < lane.veh.length; i++) { const v = lane.veh[i];
    if (Math.hypot(v.x - X, v.z - Z) > R) continue;
    const e = lane.edge, b = v.blk;
    out.push({ id: v.id, at: [+v.x.toFixed(1), +v.z.toFixed(1), +v.y.toFixed(1)], h: [+v.hx.toFixed(2), +v.hz.toFixed(2)], k: v.kind, e: e.cls + '/' + e.flags + '/' + Math.round(e.len) + '/' + e.nf + '+' + e.nb, ln: lane.d + '.' + lane.idx, i: i + '/' + lane.veh.length, s: +v.s.toFixed(1), s0: +lane.s0.toFixed(1), s1: +lane.s1.toFixed(1), stop: +lane.sStop.toFixed(1), v: +v.v.toFixed(1), still: Math.round(v.still), cur: v.cur ? +v.cur.len.toFixed(1) : 0, com: v.committed ? 1 : 0, go: v.go ? 1 : 0, why: v.why | 0, bk: v.bk, blk: b ? b.id : 0, pg: v.pg < 1e8 ? +v.pg.toFixed(1) : -1, mv: v.move ? v.move.turn : '-', nx: v.next ? 1 : 0, ctrl: lane.ctrl, wait: Math.round(v.wait), blkAt: b ? [Math.round(b.x), Math.round(b.z), b.lane.edge.cls + '/' + Math.round(b.lane.edge.len), b.cur ? 'cur' : b.committed ? 'com' : 'lane', +b.v.toFixed(1), Math.round(b.still)] : 0 });
  }
  return { found, t: Math.round(t), out };
})()
