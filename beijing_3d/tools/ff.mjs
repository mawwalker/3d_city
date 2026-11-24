// Cross-browser check: load the site in Firefox and report shader / runtime errors.
import { firefox } from 'playwright-core';
import fs from 'node:fs';
const cands = [process.env.HOME + '/.cache/ms-playwright/firefox-1488/firefox/firefox', '/usr/bin/firefox'];
const exe = cands.find((p) => fs.existsSync(p));
const browser = await firefox.launch({ executablePath: exe, headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true, 'layers.acceleration.force-enabled': true } });
const ctx = await browser.newContext({ viewport: null }); const page = await ctx.newPage();
const logs = new Set();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.add(`[${m.type()}] ${m.text().slice(0, 700)}`); });
page.on('pageerror', (e) => logs.add('[pageerror] ' + (e.stack || e.message).slice(0, 500)));
await page.goto(`http://127.0.0.1:8765/?q=${process.env.Q || 'low'}`, { waitUntil: 'load' });
let settled = false;
try { settled = await page.evaluate(() => window.__app ? window.__app.settle(100000) : 'no app'); } catch (e) { logs.add('[settle] ' + e.message); }
const info = await page.evaluate(() => { const a = window.__app; if (!a) return null; const gl = a.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?', fps: Math.round(a.fps), tris: a.renderer.info.render.triangles, programs: a.renderer.info.programs.length, loaded: !!a.loaded }; }).catch((e) => ({ err: e.message }));
await page.screenshot({ path: '../shots/firefox.jpg', type: 'jpeg', quality: 85 });
console.log(JSON.stringify({ exe, settled, info }));
console.log(logs.size ? [...logs].slice(0, 12).join('\n') : 'no console errors');
await browser.close();
