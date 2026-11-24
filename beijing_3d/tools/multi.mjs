// Load the site once, then take several screenshots, running a JS snippet before each (for A/B parameter tuning).
//   node multi.mjs --cam x,z,dist,heading,pitch --hour 15 [--extra "k=v"] --prefix ../shots/ab_ name1 "js1" name2 "js2" ...
import { chromium } from 'playwright-core';
import { argv } from 'node:process';
const flags = {}; const rest = [];
for (let i = 2; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { flags[a.slice(2)] = argv[++i]; } else rest.push(a); }
const qs = new URLSearchParams();
for (const k of ['cam', 'hour', 'q']) if (flags[k]) qs.set(k, flags[k]);
if (flags.extra) for (const [k, v] of new URLSearchParams(flags.extra)) qs.set(k, v);
const url = (flags.url || 'http://127.0.0.1:8765/') + '?' + qs.toString();
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +(flags.w || 1600), height: +(flags.h || 900) }, deviceScaleFactor: +(flags.dpr || 1) });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));
await page.goto(url, { waitUntil: 'load' });
await page.evaluate(async () => (window.__app ? await window.__app.settle(90000) : false));
for (let i = 0; i + 1 < rest.length; i += 2) {
  try { const r = await page.evaluate(rest[i + 1]); if (r !== undefined && r !== null) console.log(rest[i], JSON.stringify(r)); } catch (e) { console.log('[js error]', rest[i], e.message); }
  if (flags.settle) await page.evaluate(async () => window.__app.settle(60000));
  await page.waitForTimeout(+(flags.wait || 500));
  await page.screenshot({ path: (flags.prefix || '../shots/ab_') + rest[i] + '.png' });
}
const uniq = [...new Set(logs)].filter((l) => !/status of 404|ReadPixels/.test(l));
if (uniq.length) console.log(uniq.slice(0, 20).join('\n').slice(0, 3000));
await browser.close();
