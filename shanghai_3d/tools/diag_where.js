// Where vehicles are taken away (knots cut, long standstills cleared), by place: window.__jamMinutes
(() => {
  const T = __app.traffic, cam = __app.camera; let t = __app.time;
  T.clearLog = []; T.knotLog = []; T.ringLog = [];
  const MIN = window.__jamMinutes || 20;
  for (let i = 0; i < MIN * 1200; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); }
  __app.time = t;
  const agg = (rows, key, ex) => { const m = new Map(); for (const r of rows) { const k = key(r); let c = m.get(k); if (!c) m.set(k, c = { n: 0, ex: [] }); c.n++; if (c.ex.length < 2) c.ex.push(ex(r)); } return [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, window.__top || 10).map(([k, c]) => ({ at: k, n: c.n, ex: c.ex })); };
  const cell = (x, z) => Math.round(x / 60) * 60 + ',' + Math.round(z / 60) * 60;
  return { cleared: T.cleared, unknotted: T.unknotted,
    clearedAt: agg(T.clearLog, (r) => cell(r[0], r[1]), (r) => r),
    knotsAt: agg(T.knotLog, (m) => cell(m[0][0], m[0][1]), (m) => m.map((q) => [q[0], q[1], q[5], q[6], q[8], q[9], q[11], q[14], q[16]]).slice(0, 4)),
    ringsAt: agg(T.ringLog.map((s) => s.split(' > ')[0]), (s) => { const p = s.split('@')[1].split(','); return cell(+p[0], +p[1]); }, (s) => s) };
})()
