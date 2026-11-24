// Firefox smoke test: load the site, report shader / runtime errors and a frame time.
import { firefox } from 'playwright-core';
const browser = await firefox.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/firefox-1488/firefox/firefox', headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true, 'layers.acceleration.force-enabled': true } });
const ctx = await browser.newContext({ viewport: null }); const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 600)}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message.slice(0, 400)));
await page.goto(process.argv[2] || 'http://127.0.0.1:8766/?pos=1748,1.8,-520&look=186,-3&mode=walk&hour=15&ui=0', { waitUntil: 'load' });
let ok = false;
try { ok = await page.evaluate(async () => window.__app.settle(90000)); } catch (e) { logs.push('[settle] ' + e.message.slice(0, 200)); }
const info = await page.evaluate(() => { const a = window.__app; if (!a) return null; const gl = a.renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?', reversed: a.pipeline.reversed, bench: a.bench(20), stats: a.stats() }; }).catch((e) => ({ error: e.message }));
await page.screenshot({ path: '../shots/firefox.png' });
console.log(JSON.stringify({ ok, info }));
console.log([...new Set(logs)].slice(0, 12).join('\n'));
await browser.close();
