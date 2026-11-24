// Headless screenshot tool for Chongqing 3D.
// Usage:
//   node shot.mjs --out ../shots/a.png [--q "pos=0,1.7,0&look=30,0&hour=16&ui=0"] [--w 1600 --h 900] [--js "expr"] [--wait ms]
//   node shot.mjs --q "ui=0" --multi name1 "js1" name2 "js2" ...
//   node shot.mjs --manifest shots_batch.json [--url http://127.0.0.1:8768/] [--w 1600 --h 900]
import { chromium } from 'playwright-core';
import { argv } from 'node:process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shotsDir = resolve(__dirname, '../shots');
mkdirSync(shotsDir, { recursive: true });

const args = argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes('--' + k);

const out = arg('out', resolve(shotsDir, 'shot.png'));
const w = +arg('w', 1600), h = +arg('h', 900);
const base = arg('url', 'http://127.0.0.1:8768/');
const defaultQ = arg('q', '');
const url = base + (defaultQ ? (base.includes('?') ? '&' : '?') + defaultQ : '');
const timeoutMs = +arg('timeout', 90000);
const waitMs = +arg('wait', 400);
const mi = args.indexOf('--multi');
const multi = mi >= 0 ? args.slice(mi + 1) : null;
const manifestPath = arg('manifest', null);

const executablePath = existsSync('/usr/bin/chromium')
  ? '/usr/bin/chromium'
  : existsSync('/usr/bin/google-chrome')
    ? '/usr/bin/google-chrome'
    : undefined;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || '/tmp/cq-chrome-cfg',
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || '/tmp/cq-chrome-cache',
  },
  args: [
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage({
  viewport: { width: w, height: h },
  deviceScaleFactor: +arg('dpr', 1),
});

const logs = [];
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (/DevTools|ReadPixels/.test(t)) return;
  const entry = `[${m.type()}] ${t}`;
  logs.push(entry);
  if (m.type() === 'error') errors.push(entry);
});
page.on('pageerror', (e) => {
  const entry = '[pageerror] ' + (e.stack || e.message);
  logs.push(entry);
  errors.push(entry);
});
page.on('requestfailed', (r) => {
  const entry = '[requestfailed] ' + r.url() + ' ' + (r.failure()?.errorText || '');
  logs.push(entry);
  errors.push(entry);
});

const settle = async (ms = timeoutMs) => {
  try {
    return await page.evaluate(async (t) => {
      const a = window.__app;
      if (!a) return false;
      if (typeof a.settle === 'function') return await a.settle(t);
      if (typeof a.waitReady === 'function') return await a.waitReady(t);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return true;
    }, ms);
  } catch (e) {
    logs.push('[settle error] ' + e.message);
    return false;
  }
};

const getStats = async () => page.evaluate(() => {
  const a = window.__app;
  if (!a) return null;
  if (typeof a.getStats === 'function') return a.getStats();
  const i = a.renderer?.info;
  return {
    fps: a.fps != null ? Math.round(a.fps) : undefined,
    calls: i?.render?.calls,
    tris: i?.render?.triangles,
    geometries: i?.memory?.geometries,
    textures: i?.memory?.textures,
    quality: a.quality?.name,
    extra: typeof a.stats === 'function' ? a.stats() : undefined,
  };
}).catch((e) => ({ error: e.message }));

const shoot = async (path) => {
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({
    path,
    type: path.endsWith('.jpg') || path.endsWith('.jpeg') ? 'jpeg' : 'png',
    quality: path.endsWith('.jpg') || path.endsWith('.jpeg') ? 90 : undefined,
  });
};

const t0 = Date.now();
const results = [];

if (manifestPath) {
  const items = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let loaded = false;
  for (const item of items) {
    const tShot = Date.now();
    const outPath = item.out ? resolve(shotsDir, item.out) : resolve(shotsDir, `${item.name}.png`);
    if (item.q !== undefined || !loaded) {
      const q = item.q ?? defaultQ;
      const targetUrl = base + (q ? (base.includes('?') ? '&' : '?') + q : '');
      await page.goto(targetUrl, { waitUntil: 'load', timeout: timeoutMs });
      loaded = true;
    }
    let jsResult = null;
    if (item.js) {
      try {
        jsResult = await page.evaluate(item.js);
      } catch (e) {
        logs.push(`[js error:${item.name}] ${e.message}`);
        errors.push(`[js error:${item.name}] ${e.message}`);
      }
    }
    const settled = await settle(item.timeout || timeoutMs);
    await page.waitForTimeout(item.wait ?? waitMs);
    await shoot(outPath);
    const stats = await getStats();
    results.push({
      name: item.name,
      out: outPath,
      settled,
      secs: +((Date.now() - tShot) / 1000).toFixed(1),
      jsResult,
      stats,
    });
    console.log(JSON.stringify(results[results.length - 1]));
  }
} else {
  await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  const settled = await settle();
  if (multi) {
    for (let i = 0; i + 1 < multi.length; i += 2) {
      const name = multi[i];
      const expr = multi[i + 1];
      try {
        const r = await page.evaluate(expr);
        if (r !== undefined && r !== null) console.log(name, JSON.stringify(r));
      } catch (e) {
        console.log('[js error]', name, e.message);
      }
      await settle();
      await page.waitForTimeout(waitMs);
      await shoot(resolve(shotsDir, `${name}.png`));
    }
  } else {
    if (arg('js')) {
      try {
        const r = await page.evaluate(arg('js'));
        if (r !== undefined) logs.push('[js] ' + JSON.stringify(r));
      } catch (e) {
        logs.push('[js error] ' + e.message);
        errors.push('[js error] ' + e.message);
      }
      await settle();
    }
    await page.waitForTimeout(waitMs);
    await shoot(out);
  }
  const stats = await getStats();
  console.log(JSON.stringify({
    url,
    out: multi ? undefined : out,
    settled,
    secs: ((Date.now() - t0) / 1000).toFixed(1),
    errorCount: errors.length,
    stats,
  }));
}

const uniq = [...new Set(logs)];
if (uniq.length) {
  console.log(uniq.slice(0, +arg('maxlog', 40)).join('\n').slice(0, +arg('maxchars', 6000)));
}
await browser.close();
if (hasFlag('strict') && errors.length > 0) process.exit(2);
