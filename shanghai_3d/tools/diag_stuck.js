// Who stands near a point, and what each is held by: window.__spot = [x, z, r]; window.__jamMinutes
(() => {
  const T = __app.traffic, cam = __app.camera; let t = __app.time;
  const [X, Z, R] = window.__spot;
  const snap = () => { const out = [];
    for (const lane of T.lanes) { const vs = lane.veh;
      for (let i = 0; i < vs.length; i++) { const v = vs[i]; if (Math.hypot(v.x - X, v.z - Z) > R || v.still < (window.__minStill || 15)) continue; const b = v.blk;
        out.push({ id: v.id, at: [+v.x.toFixed(1), +v.z.toFixed(1), +v.y.toFixed(1)], hd: [+v.hx.toFixed(2), +v.hz.toFixed(2)], e: lane.edge.cls + '/' + Math.round(lane.edge.len) + '/' + lane.idx + (lane.d ? 'b' : 'f'), ctrl: lane.ctrl, st: v.cur ? 'curve' : v.committed ? 'commit' : 'lane', go: v.go ? 1 : 0, why: v.why | 0, bk: v.bk, still: Math.round(v.still), wait: Math.round(v.wait), dStop: +(lane.sStop - v.s).toFixed(1), dEnd: +(lane.s1 - v.s).toFixed(1), turn: v.move ? v.move.turn : '-', pg: v.pg < 1e8 ? +v.pg.toFixed(1) : -1, nobox: v.nobox ? 1 : 0, backs: v.backs | 0,
          to: v.next ? v.next.edge.cls + '/' + Math.round(v.next.edge.len) + ' q' + v.next.veh.length : '-', blk: b ? b.id + '@' + Math.round(b.x) + ',' + Math.round(b.z) + ' ' + (b.cur ? 'curve' : b.committed ? 'commit' : 'lane') : '-', bw: v.bw && !v.bw.dead ? v.bw.id : '-' }); } }
    return out; };
  const MIN = window.__jamMinutes || 15; let res = null, when = 0;
  for (let i = 0; i < MIN * 1200; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); if (i % 600 === 599) { const s = snap(); if (!res || s.length > res.length) { res = s; when = (i + 1) / 1200; } } }
  __app.time = t;
  return { minute: +when.toFixed(1), n: res.length, veh: res.sort((a, b) => b.still - a.still).slice(0, window.__top || 28) };
})()
