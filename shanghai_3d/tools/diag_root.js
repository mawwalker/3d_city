// For every vehicle standing behind something: follow the chain of who waits for whom to its end, and say what the last one is waiting for.
(() => {
  const T = __app.traffic, cam = __app.camera;
  let t = __app.time;
  const MIN = window.__jamMinutes || 15;
  for (let i = 0; i < MIN * 1200; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); }
  __app.time = t;
  const W = ['go', 'room', 'red', 'yield', 'box'];
  const roots = new Map(); let standing = 0;
  for (const lane of T.lanes) for (const v of lane.veh) {
    if (v.still < 4) continue; standing++;
    let o = v, n = 0; while (o.blk && o.blk.still > 1 && n < 600) { o = o.blk; n++; }
    let r = roots.get(o); if (!r) roots.set(o, r = { n: 0, o }); r.n++;
  }
  const kind = (o) => { const l = o.lane, vs = l.veh, i = vs.indexOf(o), lead = vs[i + 1]; const first = !o.committed && (!lead || lead.committed);
    return o.committed ? 'committed' : o.cur ? 'connector' : first ? (o.next ? W[o.why | 0] : (o.move ? 'wrongLane' : 'noMove')) : 'follower'; };
  const byKind = {}; for (const r of roots.values()) { const k = kind(r.o); byKind[k] = (byKind[k] || 0) + r.n; }
  const top = [...roots.values()].sort((a, b) => b.n - a.n).slice(0, 14).map((r) => { const o = r.o, l = o.lane, i = l.veh.indexOf(o);
    return { behind: r.n, kind: kind(o), x: Math.round(o.x), z: Math.round(o.z), still: Math.round(o.still), cls: l.edge.cls, len: Math.round(l.edge.len), ctrl: l.ctrl, rb: l.edge.flags & 32 ? 1 : 0, i, n: l.veh.length, ds: +(l.sStop - o.s).toFixed(1), s: +o.s.toFixed(1), s0: +l.s0.toFixed(1), mv: o.move ? o.move.turn : null, wait: Math.round(o.wait), go: o.go ? 1 : 0, pg: o.pg < 1e8 ? +o.pg.toFixed(1) : null, blk: o.blk ? Math.round(o.blk.still) : null,
      to: o.next ? { len: Math.round(o.next.edge.len), n: o.next.veh.length, ctrl: o.next.ctrl, cls: o.next.edge.cls } : null }; });
  return { standing, byKind, top };
})()
