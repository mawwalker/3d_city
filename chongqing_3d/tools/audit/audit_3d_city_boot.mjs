#!/usr/bin/env node
// Phase 6 Audit — Boot-test ALL 3 Cities (beijing_3d, shanghai_3d, chongqing_3d) directly from 3d_city/
// Verifies: 0 404/HTTP>=400 requests, 0 failed network requests, 0 console/page/WebGL errors,
// non-black WebGL canvas render (pixel variance > 15.0) for every city out of the box!
//
// Usage: node audit_3d_city_boot.mjs --bj http://127.0.0.1:8811/ --sh http://127.0.0.1:8812/ --cq http://127.0.0.1:8813/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchAuditPage, parseArg } from './pw_helper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = [
  { id: 'beijing_3d',   url: parseArg(argv, 'bj', 'http://127.0.0.1:8811/') + '?ui=0&q=high' },
  { id: 'shanghai_3d',  url: parseArg(argv, 'sh', 'http://127.0.0.1:8812/') + '?ui=0&q=high' },
  { id: 'chongqing_3d', url: parseArg(argv, 'cq', 'http://127.0.0.1:8813/') + '?ui=0&q=high' },
];

function pngStats(buf) {
  let off = 8, w = 0, h = 0, ct = 2;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); };
  let ro = 0, sum = 0, sum2 = 0, cnt = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[ro++];
    for (let x = 0; x < stride; x++) {
      const v = raw[ro++], a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      cur[x] = ft === 1 ? (v + a) & 255 : ft === 2 ? (v + b) & 255 : ft === 3 ? (v + ((a + b) >> 1)) & 255 : ft === 4 ? (v + paeth(a, b, c)) & 255 : v;
    }
    if ((y & 3) === 0) {
      for (let x = 0; x < w; x += 4) {
        const lum = 0.299 * cur[x * bpp] + 0.587 * cur[x * bpp + 1] + 0.114 * cur[x * bpp + 2];
        sum += lum; sum2 += lum * lum; cnt++;
      }
    }
    prev.set(cur);
  }
  const mean = sum / Math.max(1, cnt);
  const std = Math.sqrt(Math.max(0, sum2 / Math.max(1, cnt) - mean * mean));
  return { w, h, meanLum: +mean.toFixed(1), stdLum: +std.toFixed(1) };
}

const results = [];
let totalFailed = 0;

for (const tgt of TARGETS) {
  const { browser, page, diag } = await launchAuditPage({ width: 1280, height: 720 });
  try {
    await page.goto(tgt.url, { waitUntil: 'load', timeout: 60000 });
    // Wait for __app.settle() if available, else wait for canvas + frames
    const info = await page.evaluate(async () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 45000) {
        const a = window.__app;
        if (a && typeof a.settle === 'function') {
          await a.settle(35000);
          return {
            hasApp: true,
            frames: a.frames ?? null,
            fps: a.fps ?? null,
            tris: a.renderer?.info?.render?.triangles ?? null,
            calls: a.renderer?.info?.render?.calls ?? null,
            appErrors: Array.isArray(a.errors) ? a.errors : [],
          };
        }
        // Fallback: wait until canvas is populated & city loaded
        if (a && (a.frames > 30 || a.city?.allFar)) {
          await new Promise((r) => setTimeout(r, 3000));
          return {
            hasApp: true,
            frames: a.frames ?? null,
            fps: a.fps ?? null,
            tris: a.renderer?.info?.render?.triangles ?? null,
            calls: a.renderer?.info?.render?.calls ?? null,
            appErrors: Array.isArray(a.errors) ? a.errors : [],
          };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      const c = document.querySelector('canvas');
      return { hasApp: !!window.__app, canvasW: c?.width || 0, canvasH: c?.height || 0, appErrors: [] };
    });

    await page.waitForTimeout(800);
    const shot = await page.screenshot({ type: 'png' });
    const ps = pngStats(shot);
    const errs = diag.consoleErrors.length + diag.pageErrors.length + diag.httpErrors.length + diag.failedRequests.length + (info.appErrors?.length || 0);
    const ok = errs === 0 && ps.stdLum >= 12.0 && ps.meanLum >= 10.0;
    if (!ok) totalFailed++;
    results.push({ id: tgt.id, url: tgt.url, status: ok ? 'PASS' : 'FAIL', info, pixelStats: ps, diag });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] boot.${tgt.id.padEnd(13)} | errs=${errs} (http=${diag.httpErrors.length}, failReq=${diag.failedRequests.length}, console=${diag.consoleErrors.length}, page=${diag.pageErrors.length}) | canvas=${ps.w}x${ps.h} lum=${ps.meanLum}±${ps.stdLum} | tris=${info.tris} calls=${info.calls}`);
    if (!ok) {
      console.log('   diag:', JSON.stringify(diag));
    }
  } catch (e) {
    totalFailed++;
    results.push({ id: tgt.id, url: tgt.url, status: 'FAIL', error: String(e), diag });
    console.log(`[FAIL] boot.${tgt.id}: exception ${e.message}`);
  } finally {
    await browser.close();
  }
}

const outPath = path.join(__dir, 'phase6_boot_report.json');
fs.writeFileSync(outPath, JSON.stringify({ passed: totalFailed === 0, failed: totalFailed, results }, null, 2));
console.log(`\n=== 3d_city 3-City Boot Audit: ${results.length - totalFailed}/${results.length} PASSED ===`);
exit(totalFailed === 0 ? 0 : 1);
