// Headless screenshot tool for the Shanghai 3D site.
//   node shot.mjs --out ../shots/a.png [--q "pos=0,1.7,0&look=30,0&hour=16"] [--w 1600 --h 900] [--js "expr"] [--wait ms]
// Several shots from one page load:  node shot.mjs --q "..." --multi name1 "js1" name2 "js2" ...   (writes ../shots/<name>.png)
import { chromium } from 'playwright-core';
import { argv } from 'node:process';

const args = argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = arg('out', '../shots/shot.png');
const w = +arg('w', 1600), h = +arg('h', 900);
const base = arg('url', 'http://127.0.0.1:8766/');
const url = base + (arg('q') ? '?' + arg('q') : '');
const mi = args.indexOf('--multi');
const multi = mi >= 0 ? args.slice(mi + 1) : null;

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +arg('dpr', 1) });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/DevTools|ReadPixels/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));
page.on('requestfailed', (r) => logs.push('[requestfailed] ' + r.url() + ' ' + (r.failure()?.errorText || '')));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
const settle = async () => { try { return await page.evaluate(async (ms) => (window.__app ? await window.__app.settle(ms) : false), +arg('timeout', 90000)); } catch (e) { logs.push('[settle error] ' + e.message); return false; } };
let settled = await settle();
const shoot = async (path) => page.screenshot({ path, type: path.endsWith('.jpg') ? 'jpeg' : 'png', quality: path.endsWith('.jpg') ? 90 : undefined });
if (multi) {
  for (let i = 0; i + 1 < multi.length; i += 2) {
    try { const r = await page.evaluate(multi[i + 1]); if (r !== undefined && r !== null) console.log(multi[i], JSON.stringify(r)); } catch (e) { console.log('[js error]', multi[i], e.message); }
    await settle();
    await page.waitForTimeout(+arg('wait', 300));
    await shoot(`../shots/${multi[i]}.png`);
  }
} else {
  if (arg('js')) { try { const r = await page.evaluate(arg('js')); if (r !== undefined) logs.push('[js] ' + JSON.stringify(r)); } catch (e) { logs.push('[js error] ' + e.message); } await settle(); }
  await page.waitForTimeout(+arg('wait', 300));
  await shoot(out);
}
const stats = await page.evaluate(() => {
  const a = window.__app; if (!a) return null;
  const i = a.renderer.info;
  return { fps: Math.round(a.fps), calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, quality: a.quality.name, extra: a.stats ? a.stats() : undefined };
}).catch((e) => ({ error: e.message }));
console.log(JSON.stringify({ url, settled, secs: ((Date.now() - t0) / 1000).toFixed(1), stats }));
const uniq = [...new Set(logs)];
if (uniq.length) console.log(uniq.slice(0, +arg('maxlog', 25)).join('\n').slice(0, +arg('maxchars', 4000)));
await browser.close();
