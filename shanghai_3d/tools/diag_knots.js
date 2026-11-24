// What the knots (rings of vehicles standing in each other's way that no rule undoes) are made of.
(() => {
  const T = __app.traffic, cam = __app.camera;
  let t = __app.time;
  const MIN = window.__jamMinutes || 10;
  T.knotLog = []; T.clearLog = [];
  const u0 = T.unknotted;
  for (let i = 0; i < MIN * 1200; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); }
  __app.time = t;
  const sig = new Map();
  const seenPair = new Set();
  for (const m of T.knotLog) {
    const ids = m.map((q) => q[15]).sort((a, b) => a - b).join('-');
    if (seenPair.has(ids)) continue; seenPair.add(ids);
    let s;
    if (m.length === 2) {
      const [a, b] = m, dot = a[2] * b[2] + a[3] * b[3];
      const ang = dot > 0.85 ? 'same' : dot > 0.3 ? 'acute' : dot > -0.3 ? 'cross' : dot > -0.85 ? 'obtuse' : 'headon';
      const rule = [a[5], b[5]].sort().join('');
      const where = [a, b].map((q) => (q[8] ? 'curve' : q[9] ? 'commit' : 'lane')).sort().join('+') + ' nb' + Math.max(a[17], b[17]) + ' cf' + Math.max(a[18], b[18]);
      s = '2 ' + ang + ' r' + rule + ' ' + where + (((a[7] | b[7]) & 2) ? ((a[7] & b[7] & 2) ? ' deck' : ' deck/ground') : ' ground') + (a[16] & 128 || b[16] & 128 ? ' inside' : '');
    } else s = m.length + ' rules ' + m.map((q) => q[5]).sort().join('');
    let r = sig.get(s); if (!r) sig.set(s, r = { n: 0, ex: m }); r.n++;
  }
  const out = [...sig.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 16).map(([k, r]) => ({ k, n: r.n, ex: r.ex.slice(0, 3) }));
  return { n: T.count, unknotted: T.unknotted - u0, rings: T.rings, distinct: seenPair.size, cleared: T.clearLog.length, clearLog: T.clearLog.slice(0, 24).map((r) => r.join(' ')), out: out.slice(0, 12) };
})()
