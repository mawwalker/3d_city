// Cost of the traffic simulation per frame (after a pre-roll), at 60 steps a second.
(() => {
  const T = __app.traffic, cam = __app.camera;
  let t = __app.time;
  for (let i = 0; i < 3600; i++) { t += 0.05; T.update(0.05, t, cam, __app.env.hour); }
  const t0 = performance.now(); let worst = 0;
  for (let i = 0; i < 1200; i++) { const a = performance.now(); t += 1 / 60; T.update(1 / 60, t, cam, __app.env.hour); worst = Math.max(worst, performance.now() - a); }
  __app.time = t;
  return { vehicles: T.count, lanes: T.lanes.length, msPerFrame: +((performance.now() - t0) / 1200).toFixed(3), worstMs: +worst.toFixed(2) };
})()
