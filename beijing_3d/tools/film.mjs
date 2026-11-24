// Render the introduction film frame by frame (deterministic: every frame waits for streaming to finish).
//   node film.mjs [--only id1,id2] [--fps 30] [--w 1920 --h 1080 --dpr 1.5] [--q ultra] [--step 1] [--out ../video/frames]
// Writes <out>/<shot>/f00000.jpg ...; encode with film_encode.py.
import { chromium } from 'playwright-core';
import { argv } from 'node:process';
import fs from 'node:fs';
import { SHOTS, DEFAULT_SEASON } from './film_shots.mjs';

const arg = (k, d) => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : d; };
const fps = +arg('fps', 30), W = +arg('w', 1920), H = +arg('h', 1080), dpr = +arg('dpr', 1.5), step = +arg('step', 1);
const outDir = arg('out', '../video/frames');
const only = arg('only') ? arg('only').split(',') : null;

const mixAng = (a, b, t) => { const d = ((b - a + 540) % 360) - 180; return a + d * t; };
// gentle ease: mostly linear so the camera keeps drifting, softened at both ends
const ease = (t) => 0.55 * t + 0.45 * (t * t * (3 - 2 * t));
function pose(s, t) {
  const k = ease(t), a = s.a, b = s.b;
  return {
    x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k,
    dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * k),
    heading: mixAng(a.heading, b.heading, k), pitch: a.pitch + (b.pitch - a.pitch) * k,
  };
}

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const logs = new Set();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/ReadPixels|status of 404/.test(m.text())) logs.add(m.text().slice(0, 300)); });
page.on('pageerror', (e) => logs.add('[pageerror] ' + (e.stack || e.message).slice(0, 400)));
await page.goto(`http://127.0.0.1:8765/?q=${arg('q', 'ultra')}&ui=0&labels=0&fixedres=1&cam=2300,-250,9200,267,9.6&hour=17.05`, { waitUntil: 'load' });
await page.evaluate(() => window.__app.settle(120000));

for (const s of SHOTS) {
  if (only && !only.includes(s.id)) continue;
  const dir = `${outDir}/${s.id}`;
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(s.dur * fps);
  const t0 = Date.now();
  for (let i = 0; i < n; i += step) {
    const t = n > 1 ? i / (n - 1) : 0;
    const hour = s.hour[0] + (s.hour[1] - s.hour[0]) * t;
    await page.evaluate(([p, hour, season, dt]) => window.__app.captureFrame(p, { hour, season, dt }), [pose(s, t), hour, s.season || DEFAULT_SEASON, 1 / fps]);
    await page.screenshot({ path: `${dir}/f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 94 });
  }
  console.log(s.id, n, 'frames', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
if (logs.size) console.log([...logs].slice(0, 20).join('\n'));
await browser.close();
