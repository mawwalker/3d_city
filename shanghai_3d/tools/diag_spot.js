// The traffic graph around a point: window.__spot = [x, z, r]
(() => {
  const T = __app.traffic, [X, Z, R] = window.__spot;
  const out = [];
  for (const edges of T.tiles.values()) for (const e of edges) {
    let near = 1e9, at = 0;
    for (let k = 0; k < e.n; k++) { const d = Math.hypot(e.X[k] - X, e.Z[k] - Z); if (d < near) { near = d; at = k; } }
    if (near > R) continue;
    const na = T.nodes.get(e.a), nb = T.nodes.get(e.b);
    out.push({ cls: e.cls, fl: e.flags, len: Math.round(e.len), n: e.nf + '+' + e.nb, lw: +e.lw.toFixed(1), sh: +e.shift.toFixed(1), W: +e.W.toFixed(1), a: e.a, b: e.b, armsA: na ? na.arms.length : 0, armsB: nb ? nb.arms.length : 0,
      A: [Math.round(e.X[0]), Math.round(e.Z[0])], B: [Math.round(e.X[e.n - 1]), Math.round(e.Z[e.n - 1])], h: +e.H[at].toFixed(1), s0: e.lanes[0][0] ? +e.lanes[0][0].s0.toFixed(1) : 0, s1: e.lanes[0][0] ? +e.lanes[0][0].s1.toFixed(1) : 0, ctrl: e.lanes[0][0] ? e.lanes[0][0].ctrl : 0, ctrlB: e.lanes[1][0] ? e.lanes[1][0].ctrl : -1, veh: e.lanes[0].reduce((a, l) => a + l.veh.length, 0) + e.lanes[1].reduce((a, l) => a + l.veh.length, 0) });
  }
  return out;
})()
