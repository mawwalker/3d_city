// Headless screenshot tool for the Beijing 3D site.
//   node shot.mjs --out shot.png [--cam x,z,dist,heading,pitch] [--hour 16.9] [--w 1600 --h 900] [--q high] [--extra "k=v&k2=v2"] [--js "expr"] [--wait ms]
import { chromium } from 'playwright-core';
import { argv } from 'node:process';

const arg = (k, d) => { const p = argv.find((a) => a.startsWith('--' + k + '=')); if (p) return p.slice(k.length + 3); const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : d; };
const out = arg('out', 'shot.png');
const w = +arg('w', 1600), h = +arg('h', 900);
const base = arg('url', 'http://127.0.0.1:8765/');
const qs = new URLSearchParams();
for (const k of ['cam', 'hour', 'q']) if (arg(k)) qs.set(k, arg(k));
if (arg('extra')) for (const [k, v] of new URLSearchParams(arg('extra'))) qs.set(k, v);
const url = base + (qs.toString() ? '?' + qs.toString() : '');

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', ...(arg('angle') ? ['--use-angle=' + arg('angle')] : []), ...(arg('nolimit') ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +arg('dpr', 1) });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/Download the React|DevTools/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));
page.on('requestfailed', (r) => logs.push('[requestfailed] ' + r.url() + ' ' + (r.failure()?.errorText || '')));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
let settled = false;
try {
  settled = await page.evaluate(async (ms) => (window.__app ? await window.__app.settle(ms) : false), +arg('timeout', 90000));
} catch (e) { logs.push('[settle error] ' + e.message); }
if (arg('js')) { try { const r = await page.evaluate(arg('js')); if (r !== undefined) logs.push('[js] ' + JSON.stringify(r)); } catch (e) { logs.push('[js error] ' + e.message); } }
await page.waitForTimeout(+arg('wait', 800));
const stats = await page.evaluate(() => {
  const a = window.__app; if (!a) return null;
  const i = a.renderer.info;
  return { fps: Math.round(a.fps), calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, buildings: a.buildings.stats, quality: a.quality.name,
    shadowRenders: a.shadow.renders, cam: a.rig.get(), hour: a.env.hour, elev: +a.env.elevation.toFixed(2) };
}).catch((e) => ({ error: e.message }));
await page.screenshot({ path: out, type: out.endsWith('.jpg') ? 'jpeg' : 'png', quality: out.endsWith('.jpg') ? 90 : undefined });
console.log(JSON.stringify({ url, out, settled, secs: ((Date.now() - t0) / 1000).toFixed(1), stats }));
const uniq = [...new Set(logs)];
if (uniq.length) console.log(uniq.slice(0, +arg('maxlog', 30)).join('\n'));
await browser.close();
