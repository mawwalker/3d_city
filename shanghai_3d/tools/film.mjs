// Frame-by-frame film recorder for the Shanghai 3D site.
//
// The page's own frame loop is stopped; every frame of the film the camera, the clock and the weather are set from the shot's
// description, the world is stepped by exactly 1/fps (in sub-steps), tiles the view needs are waited for, and the canvas is
// read back and piped to ffmpeg. What comes out does not depend on how fast the machine renders.
//
//   node film.mjs --shots film/shots.mjs [--only a,b] [--w 1920 --h 1080 --fps 30] [--out ../video/clips]
//                 [--stills 5]      five evenly spaced stills per shot instead of clips (../shots/film_<shot>_<k>.jpg)
//                 [--q ultra] [--range 1.6] [--crf 14] [--from-frame n --frames m]
//
// A shots module exports `shots`: [{ name, frames, pre?: seconds of traffic warm-up, weather?, cam(u, f) -> { p: [x, y, z],
// t: [x, y, z] (looked at) or yaw/pitch, fov?, hour?, weather? } }], u running 0..1 over the shot's frames.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const W = +arg('w', 1920), H = +arg('h', 1080), FPS = +arg('fps', 30), SUB = +arg('sub', 2);
const outDir = arg('out', '../video/clips');
const stills = +arg('stills', 0);
const only = arg('only') ? arg('only').split(',') : null;
const { shots } = await import(pathToFileURL(path.resolve(arg('shots', 'film/shots.mjs'))).href);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/DevTools|ReadPixels/.test(t)) logs.push(t); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));
const first = shots.find((s) => !only || only.includes(s.name)) || shots[0];
const c0 = first.cam(0, 0);
await page.goto(`${arg('url', 'http://127.0.0.1:8766/')}?ui=0&q=${arg('q', 'ultra')}&pos=${c0.p.join(',')}&hour=${c0.hour ?? 12}`, { waitUntil: 'load' });
await page.evaluate(async () => { await window.__app.settle(120000); });
await page.evaluate(({ range }) => {
  const a = window.__app;
  a.frame = () => {};                                   // the page's own loop stops here: frames are stepped from outside
  document.body.classList.add('bare');
  const st = document.createElement('style'); st.textContent = '#ui, .labels, .label { display: none !important; }'; document.head.append(st);
  if (range) { a.city.NEAR *= range; a.city.MID *= range; }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setWeather = (name, now) => { if (a.env.weatherName === name && !now) return; a.env.setWeather(name); if (now) { Object.assign(a.env.weather, a.env.weatherTarget); a.env.weatherTarget = null; a.env._dirty = true; } };
  const pose = (s) => {
    const p = a.player;
    let yaw = s.yaw, pitch = s.pitch;
    if (s.t) { const dx = s.t[0] - s.p[0], dy = s.t[1] - s.p[1], dz = s.t[2] - s.p[2]; yaw = Math.atan2(dx, -dz) * 180 / Math.PI; pitch = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI; }
    p.setPose(s.p[0], s.p[1], s.p[2], yaw, pitch);
    if (s.fov) { p.fovBase = s.fov; p.fov = s.fov; }
    if (s.hour !== undefined) a.env.setHour(s.hour);
    if (s.weather) setWeather(s.weather, false);
  };
  const calm = async (limit) => {                       // tiles the view needs are in before the frame is taken
    let waited = 0;
    while (a.city.busy && waited < limit) { await wait(12); waited += 12; a.tick(1e-4); }
    if (waited) for (let i = 0; i < 3; i++) a.tick(1e-4);
    return waited;
  };
  window.__film = {
    /** Start of a shot: pose, weather at once, everything loaded, the traffic run in for `pre` seconds. */
    async begin(s, pre) {
      pose(s); if (s.weather) setWeather(s.weather, true); else setWeather('clear', true);
      a.pipeline.historyValid = false;
      for (let i = 0; i < 4; i++) { a.tick(1e-4); await wait(30); }
      await calm(60000);
      for (let t = 0; t < pre; t += 0.1) { a.tick(0.1); if ((Math.round(t * 10) % 40) === 39) await wait(0); }
      await calm(20000);
      for (let i = 0; i < 12; i++) a.tick(1e-4);
      return a.stats();
    },
    async frame(s, dt, sub, q) {
      pose(s);
      for (let i = 0; i < sub; i++) a.tick(dt / sub);
      const waited = await calm(15000);
      return { waited, jpg: a.renderer.domElement.toDataURL('image/jpeg', q).slice(23) };
    },
  };
}, { range: +arg('range', 0) });

const t00 = Date.now();
for (const shot of shots) {
  if (only && !only.includes(shot.name)) continue;
  const N = shot.frames;
  const f0 = +arg('from-frame', 0), f1 = Math.min(N, f0 + +arg('frames', N));
  const list = stills ? Array.from({ length: stills }, (_, k) => Math.round(k * (N - 1) / Math.max(1, stills - 1))) : Array.from({ length: f1 - f0 }, (_, k) => f0 + k);
  const at = (f) => shot.cam(N > 1 ? f / (N - 1) : 0, f);
  const t0 = Date.now();
  const st = await page.evaluate(([s, pre]) => window.__film.begin(s, pre), [at(list[0]), stills ? Math.min(shot.pre ?? 20, 12) : (shot.pre ?? 20)]);
  let ff = null;
  if (!stills) {
    // (intermediate clips: the graphics card's encoder at a fixed, high quality is many times faster than x264 and leaves the processor to the browser)
    const enc = arg('enc', 'x264') === 'nvenc' ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'constqp', '-qp', arg('qp', '15'), '-bf', '0'] : ['-c:v', 'libx264', '-preset', 'slow', '-crf', arg('crf', '14')];
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...enc, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outDir, shot.name + '.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  let waitedTot = 0, k = 0;
  for (const f of list) {
    if (stills && k > 0) await page.evaluate(([s]) => window.__film.begin(s, 3), [at(f)]);        // (stills are far apart in time: each is set up afresh)
    const r = await page.evaluate(([s, dt, sub, q]) => window.__film.frame(s, dt, sub, q), [at(f), 1 / FPS, SUB, stills ? 0.92 : 0.97]);
    waitedTot += r.waited;
    const buf = Buffer.from(r.jpg, 'base64');
    if (stills) writeFileSync(`../shots/film_${shot.name}_${k}.jpg`, buf);
    else if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res));
    k++;
    if (!stills && k % 150 === 0) console.log(`  ${shot.name}: ${k}/${list.length} frames, ${((Date.now() - t0) / k).toFixed(0)} ms/frame`);
  }
  if (ff) { ff.stdin.end(); await new Promise((res) => ff.on('close', res)); }
  console.log(`${shot.name}: ${list.length} ${stills ? 'stills' : 'frames'} in ${((Date.now() - t0) / 1000).toFixed(1)} s (${((Date.now() - t0) / list.length).toFixed(0)} ms each; waited for tiles ${(waitedTot / 1000).toFixed(1)} s); near tiles ${st ? st.near : '?'}`);
}
if (logs.length) console.log('page errors:', logs.slice(0, 8));
console.log(`done in ${((Date.now() - t00) / 1000).toFixed(0)} s`);
await browser.close();
