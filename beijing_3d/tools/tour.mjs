// Fly through every preset view and save one screenshot each (QA contact sheet).
//   node tour.mjs [--prefix tour] [--w 1600 --h 900] [--ui 1]
import { chromium } from 'playwright-core';
import { argv } from 'node:process';

const arg = (k, d) => { const p = argv.find((a) => a.startsWith('--' + k + '=')); if (p) return p.slice(k.length + 3); const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : d; };
const prefix = arg('prefix', 'tour');
const w = +arg('w', 1600), h = +arg('h', 900);
const url = arg('url', 'http://127.0.0.1:8765/') + (arg('ui', '1') === '0' ? '?ui=0' : '');

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = new Set();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/ReadPixels|404/.test(m.text())) logs.add(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.add('[pageerror] ' + (e.stack || e.message).slice(0, 400)));
await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => window.__app.settle(90000));
const views = await page.evaluate(() => window.__app.ui.views.map((v) => ({ id: v.id, name: v.name })));
for (let i = 0; i < views.length; i++) {
  await page.evaluate((k) => { const a = window.__app; a.ui.goto(k, 0.2); }, i);
  await page.waitForTimeout(3200);                       // clock glide + flight
  await page.evaluate(() => window.__app.settle(60000));
  await page.waitForTimeout(500);
  const out = `../shots/${prefix}_${String(i).padStart(2, '0')}_${views[i].id}.jpg`;
  await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
  const st = await page.evaluate(() => { const a = window.__app; return { fps: Math.round(a.fps), tris: a.renderer.info.render.triangles, calls: a.renderer.info.render.calls, hour: +a.env.hour.toFixed(2) }; });
  console.log(views[i].id, views[i].name, out, JSON.stringify(st));
}
if (logs.size) console.log([...logs].slice(0, 20).join('\n'));
await browser.close();
