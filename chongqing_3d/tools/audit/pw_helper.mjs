// Shared Playwright + WebGL2 error/warning interceptor helper for Chongqing 3D runtime audits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

export async function loadPlaywright() {
  const candidates = [
    path.resolve(__dir, '../node_modules/playwright-core/index.mjs'),
    path.resolve(__dir, '../node_modules/playwright-core/index.js'),
    path.resolve(__dir, '../../../shanghai_3d/tools/node_modules/playwright-core/index.mjs'),
    path.resolve(__dir, '../../../shanghai_3d/tools/node_modules/playwright-core/index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const mod = await import(pathToFileURL(c).href);
      return mod.default || mod;
    }
  }
  throw new Error('playwright-core not found in chongqing_3d/tools/node_modules or shanghai_3d/tools/node_modules');
}

export async function launchAuditPage({ width = 1920, height = 1080, dpr = 1 } = {}) {
  const { chromium } = await loadPlaywright();
  const cfgDir = '/tmp/cq-chrome-cfg';
  const cacheDir = '/tmp/cq-chrome-cache';
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    env: { ...process.env, XDG_CONFIG_HOME: cfgDir, XDG_CACHE_HOME: cacheDir },
    args: [
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--use-gl=angle',
      '--use-angle=vulkan',
      '--enable-features=Vulkan',
    ],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await context.newPage();

  // Instrument WebGL2 shader compile/link info logs before any site script runs
  await page.addInitScript(() => {
    window.__webglAudit = { shaderErrors: [], shaderWarnings: [], programErrors: [], programWarnings: [] };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const origCompile = WebGL2RenderingContext.prototype.compileShader;
      WebGL2RenderingContext.prototype.compileShader = function (shader) {
        origCompile.call(this, shader);
        const ok = this.getShaderParameter(shader, this.COMPILE_STATUS);
        const log = (this.getShaderInfoLog(shader) || '').trim();
        if (!ok) window.__webglAudit.shaderErrors.push(log || 'compileShader failed');
        else if (log) window.__webglAudit.shaderWarnings.push(log);
      };
      const origLink = WebGL2RenderingContext.prototype.linkProgram;
      WebGL2RenderingContext.prototype.linkProgram = function (prog) {
        origLink.call(this, prog);
        const ok = this.getProgramParameter(prog, this.LINK_STATUS);
        const log = (this.getProgramInfoLog(prog) || '').trim();
        if (!ok) window.__webglAudit.programErrors.push(log || 'linkProgram failed');
        else if (log) window.__webglAudit.programWarnings.push(log);
      };
    }
  });

  const diag = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    httpErrors: [],
    failedRequests: [],
  };

  page.on('console', (m) => {
    const t = m.text();
    if (/DevTools|ReadPixels/.test(t)) return;
    if (m.type() === 'error') diag.consoleErrors.push(t.slice(0, 500));
    else if (m.type() === 'warning' && /WEBGL|shader|THREE\.WebGLProgram/i.test(t)) diag.consoleWarnings.push(t.slice(0, 500));
  });
  page.on('pageerror', (e) => diag.pageErrors.push(String(e.stack || e.message).slice(0, 600)));
  page.on('response', (res) => {
    const st = res.status();
    if (st >= 400) diag.httpErrors.push({ status: st, url: res.url() });
  });
  page.on('requestfailed', (req) => {
    const err = req.failure()?.errorText || '';
    if (err !== 'net::ERR_ABORTED') diag.failedRequests.push({ url: req.url(), error: err });
  });

  return { browser, context, page, diag };
}

export async function waitAppReady(page, timeoutMs = 90000) {
  return page.evaluate(async (ms) => {
    const t0 = performance.now();
    const sleep = (k) => new Promise((r) => setTimeout(r, k));
    while (!window.__app && performance.now() - t0 < ms) await sleep(100);
    if (!window.__app) return { ok: false, reason: 'window.__app missing' };
    if (typeof window.__app.waitReady === 'function') {
      await window.__app.waitReady(ms);
      return { ok: true, via: 'waitReady' };
    }
    if (typeof window.__app.settle === 'function') {
      await window.__app.settle(ms);
      return { ok: true, via: 'settle' };
    }
    while (!window.__app.loaded && performance.now() - t0 < ms) await sleep(100);
    return { ok: !!window.__app.loaded, via: 'loaded' };
  }, timeoutMs);
}

export function loadSiteJSON(rootDir, relPath) {
  const p = path.join(rootDir, 'site', 'data', relPath);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function parseArg(argv, key, fallback = null) {
  const idx = argv.indexOf('--' + key);
  return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : fallback;
}
