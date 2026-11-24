// Where vehicles have stood longer than a red light lasts (sampled every 2 min over the run): window.__jamMinutes
(() => {
  const T = __app.traffic, cam = __app.camera; let t = __app.time;
  const MIN = window.__jamMinutes || 20, cells = new Map(); let samples = 0;
  const snap = () => { samples++; for (const lane of T.lanes) for (const v of lane.veh) { if (v.still <= 45) continue; const k = Math.round(v.x / 60) * 60 + ',' + Math.round(v.z / 60) * 60; let c = cells.get(k); if (!c) cells.set(k, c = { n: 0, ex: null }); c.n++; if (!c.ex || v.still > c.ex[0]) c.ex = [Math.round(v.still), lane.edge.cls, Math.round(lane.edge.len), lane.edge.nf + lane.edge.nb, lane.ctrl, v.why | 0, v.bk, v.cur ? 'curve' : v.committed ? 'commit' : 'lane', v.next ? v.next.edge.cls + '/' + Math.round(v.next.edge.len) + '/' + (v.next.edge.nf + v.next.edge.nb) + ' q' + v.next.veh.length : '-', +lane.edge.dirs[lane.d].feed.toFixed(2)]; } };
  for (let i = 0; i < MIN * 1200; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); if (i % 2400 === 2399) snap(); }
  __app.time = t;
  return { demand: +T.demand.toFixed(2), jam: +T.jam.toFixed(3), n: T.count, cells: [...cells.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, window.__top || 12).map(([k, c]) => [k, +(c.n / samples).toFixed(1), c.ex]) };
})()
