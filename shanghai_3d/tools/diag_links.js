// Where the slip roads stand still, and what the head of each standing queue waits for.
(() => {
  const T = __app.traffic, cam = __app.camera; let t = __app.time;
  for (let i = 0; i < (window.__jamMinutes || 15) * 1200; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); }
  __app.time = t;
  const cells = new Map();
  for (const lane of T.lanes) { if (lane.edge.cls !== (window.__cls || 11)) continue; const vs = lane.veh;
    for (let i = 0; i < vs.length; i++) { const v = vs[i]; if (v.v > 0.3) continue;
      const k = Math.round(v.x / 80) * 80 + ',' + Math.round(v.z / 80) * 80; let c = cells.get(k); if (!c) cells.set(k, c = { n: 0, heads: [] }); c.n++;
      const lead = vs[i + 1];
      if ((!lead || lead.committed) && c.heads.length < 3) { const b = v.blk; c.heads.push({ at: [Math.round(v.x), Math.round(v.z), +v.y.toFixed(1)], e: lane.edge.cls + '/' + lane.edge.flags + '/' + Math.round(lane.edge.len) + '/' + lane.edge.nf, ctrl: lane.ctrl, why: v.why | 0, bk: v.bk, com: v.committed ? 1 : 0, cur: v.cur ? 1 : 0, go: v.go ? 1 : 0, wait: Math.round(v.wait), still: Math.round(v.still), dStop: +(lane.sStop - v.s).toFixed(1), turn: v.move ? v.move.turn : '-', to: v.next ? v.next.edge.cls + '/' + Math.round(v.next.edge.len) + '/' + v.next.edge.nf + (v.next.veh.length ? ' q' + v.next.veh.length + ' v' + v.next.veh[0].v.toFixed(1) + ' s' + (v.next.veh[0].s - v.next.s0).toFixed(0) : ' empty') : '-', blk: b ? [Math.round(b.x), Math.round(b.z), b.lane.edge.cls + '/' + Math.round(b.lane.edge.len), b.cur ? 'cur' : b.committed ? 'com' : 'lane', +b.v.toFixed(1), Math.round(b.still), b.why | 0] : 0 }); }
    } }
  return [...cells.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 5).map(([k, c]) => ({ k, n: c.n, heads: c.heads }));
})()
