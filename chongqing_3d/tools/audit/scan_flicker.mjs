#!/usr/bin/env node
// Chongqing 3D — Phase 5 Live Wall Z-Fighting & Shimmer Hunter (scan_flicker.mjs)
// 1. Across 18 dense Chongqing spots (landmarks, CBD, steep hillside streets, bridge decks, tile borders):
//    Captures micro-shifted camera pairs:
//      - Ultra-micro jitter (Δpos = 0.004m, Δyaw = 0.015° -> <0.15px motion, 100% pure Z-fighting detector!)
//      - Standard jitter (Δpos = 0.06m, Δyaw = 0.35°, BOTH taa=0 and taa=1) with 5x5 spatial-neighborhood
//        parallax-invariant diff (min_{dx,dy in [-2..2]} |I1(x,y) - I0(x+dx,y+dy)| > 38) so camera parallax
//        produces ZERO false positives while Z-fighting wall patches & shadow/shader flicker light up!
// 2. Directly audits loaded Three.js hero landmark meshes for coplanar overlapping faces (planeDist < 0.035m).
//
// Usage: node scan_flicker.mjs [--url http://127.0.0.1:8790/]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchAuditPage, waitAppReady, loadSiteJSON, parseArg } from './pw_helper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = parseArg(argv, 'url', 'http://127.0.0.1:8790/');
const ROOT = parseArg(argv, 'root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));

// Pure-Node PNG decoder (8-bit RGB/RGBA, standard Playwright screenshot format)
function decodePNG(buf) {
  let off = 8;
  let w = 0, h = 0, bitDepth = 8, colorType = 2;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 3);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
  };
  let ro = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[ro++];
    for (let x = 0; x < stride; x++) {
      const v = raw[ro++];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let val = v;
      if (ft === 1) val = (v + a) & 255;
      else if (ft === 2) val = (v + b) & 255;
      else if (ft === 3) val = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) val = (v + paeth(a, b, c)) & 255;
      cur[x] = val;
    }
    const rowOff = y * w * 3;
    for (let x = 0; x < w; x++) {
      out[rowOff + x * 3]     = cur[x * bpp];
      out[rowOff + x * 3 + 1] = cur[x * bpp + 1];
      out[rowOff + x * 3 + 2] = cur[x * bpp + 2];
    }
    prev.set(cur);
  }
  return { w, h, rgb: out };
}

// Parallax-invariant flicker detector: for each pixel (x,y), compute min L-inf RGB diff against (2R+1)x(2R+1) window in img0
function analyzeFlicker(img0, img1, searchR = 2, thr = 38) {
  const { w, h } = img0;
  const a = img0.rgb, b = img1.rgb;
  // Ignore top 4% & bottom 4% border; also count contiguous 16x16 block hotspots!
  const bxN = Math.ceil(w / 16), byN = Math.ceil(h / 16);
  const blockHits = new Uint16Array(bxN * byN);
  let flipPx = 0, strongFlipPx = 0, totalPx = 0;
  const step = 2; // 2x2 subsample for speed (still 480x270 = 130k samples per pair!)
  for (let y = searchR + 4; y < h - searchR - 4; y += step) {
    for (let x = searchR + 4; x < w - searchR - 4; x += step) {
      totalPx++;
      const o1 = (y * w + x) * 3;
      const r1 = b[o1], g1 = b[o1 + 1], b1 = b[o1 + 2];
      let minD = 999;
      for (let dy = -searchR; dy <= searchR; dy++) {
        const row = (y + dy) * w;
        for (let dx = -searchR; dx <= searchR; dx++) {
          const o0 = (row + x + dx) * 3;
          const d = Math.max(Math.abs(r1 - a[o0]), Math.abs(g1 - a[o0 + 1]), Math.abs(b1 - a[o0 + 2]));
          if (d < minD) { minD = d; if (minD <= thr) break; }
        }
        if (minD <= thr) break;
      }
      if (minD > thr) {
        flipPx++;
        if (minD > 65) strongFlipPx++;
        blockHits[(y >> 4) * bxN + (x >> 4)]++;
      }
    }
  }
  // A real Z-fighting wall patch lights up >= 6 sampled pixels inside a 16x16 cell (= >=24 full-res pixels)
  let hotBlocks = 0;
  let worstBlockPx = 0, worstBlockXY = null;
  for (let by = 0; by < byN; by++) {
    for (let bx = 0; bx < bxN; bx++) {
      const cnt = blockHits[by * bxN + bx];
      if (cnt >= 6) {
        hotBlocks++;
        if (cnt > worstBlockPx) { worstBlockPx = cnt; worstBlockXY = [bx * 16 + 8, by * 16 + 8]; }
      }
    }
  }
  return {
    flipPx,
    strongFlipPx,
    flipPct: +(flipPx * 100 / Math.max(1, totalPx)).toFixed(3),
    hotBlocks,
    worstBlockPx,
    worstBlockXY,
  };
}

const SPOTS = [
  { id: 'jiefangbei_cbd',      label: 'Jiefangbei CBD street',     x: 28,    dz: 0, dy: 8,   z: 18,    yaw: 315, pitch: 8 },
  { id: 'jiefangbei_north',    label: 'Jiefangbei north towers',   x: -120,  dz: 0, dy: 28,  z: -160,  yaw: 135, pitch: -4 },
  { id: 'hongyadong_1f',       label: 'Hongyadong 1F riverfront',  x: 78,    dz: 0, dy: 12,  z: -575,  yaw: 168, pitch: 12 },
  { id: 'hongyadong_11f',      label: 'Hongyadong 11F Cangbai',    x: 118,   dz: 0, dy: 5,   z: -435,  yaw: 350, pitch: -2 },
  { id: 'raffles_plaza',       label: 'Raffles City podium',       x: 910,   dz: 0, dy: 26,  z: -740,  yaw: 32,  pitch: 8 },
  { id: 'guotai_arts',         label: 'Guotai Arts Center',        x: 340,   dz: 0, dy: 12,  z: -180,  yaw: 215, pitch: 4 },
  { id: 'shibati_steps',       label: 'Shibati shophouses',        x: -368,  dz: 0, dy: 6,   z: 702,   yaw: 15,  pitch: 4 },
  { id: 'kuixinglou',          label: 'Kuixinglou skybridge',      x: -48,   dz: 0, dy: 14,  z: -245,  yaw: 170, pitch: 2 },
  { id: 'great_hall',          label: 'Great Hall of the People',  x: -2215, dz: 0, dy: 16,  z: -410,  yaw: 0,   pitch: 4 },
  { id: 'grand_theatre',       label: 'Grand Theatre Jiangbeizui', x: 430,   dz: 0, dy: 18,  z: -1405, yaw: 175, pitch: 2 },
  { id: 'baixiangju',          label: 'Baixiangju corridors',      x: 840,   dz: 0, dy: 16,  z: 205,   yaw: 300, pitch: 4 },
  { id: 'liziba_station',      label: 'Liziba Monorail building',  x: -3785, dz: 0, dy: 18,  z: 395,   yaw: 185, pitch: 8 },
  { id: 'qiansimen_deck',      label: 'Qiansimen Bridge deck',     x: 140,   dz: 0, dy: 76,  z: -975,  yaw: 180, pitch: -6, absY: true },
  { id: 'dongshuimen_deck',    label: 'Dongshuimen Bridge deck',   x: 1260,  dz: 0, dy: 78,  z: -80,   yaw: 260, pitch: -6, absY: true },
  { id: 'hillside_shibati',    label: 'Steep hillside blocks',     x: -510,  dz: 0, dy: 22,  z: 480,   yaw: 60,  pitch: -8 },
  { id: 'hillside_nanbin',     label: 'Nanbin / Longmenhao hill',  x: 1720,  dz: 0, dy: 24,  z: 490,   yaw: 125, pitch: -6 },
  { id: 'tile_border_0_0',     label: 'Tile border x=0, z=0',      x: -18,   dz: 0, dy: 26,  z: -22,   yaw: 135, pitch: -8 },
  { id: 'tile_border_1000',    label: 'Tile border x=1000, z=-500',x: 995,   dz: 0, dy: 32,  z: -515,  yaw: 45,  pitch: -10 },
];

const { browser, page, diag } = await launchAuditPage({ width: 960, height: 540 });

try {
  // Freeze dynamic traffic & people & clouds/water movement during flicker pairs so ONLY wall/geometry/shader flicker shows up!
  await page.goto(`${BASE_URL}?pos=0,160,0&look=0,-20&mode=fly&hour=15&ui=0&q=high&people=0&traffic=0`, { waitUntil: 'load', timeout: 60000 });
  const ready = await waitAppReady(page, 90000);
  if (!ready.ok) throw new Error('App not ready');

  const results = [];
  for (const sp of SPOTS) {
    // Freeze RAF animation loop during flicker captures so water/clouds/trees stay 100% stationary!
    const pose = await page.evaluate(async (s) => {
      const a = window.__app;
      if (a._origFrame) a.frame = a._origFrame;
      const ty = a.terrain.sample(s.x, s.z);
      const y = s.absY ? s.dy : (Math.max(ty, 0) + s.dy);
      a.player.mode = 'fly';
      a.player.setPose(s.x, y, s.z, s.yaw, s.pitch);
      await a.settle(30000);
      // Pause live RAF ticking while we render deterministic camera-jitter pairs
      if (!a._origFrame) a._origFrame = a.frame.bind(a);
      a.frame = () => {};
      return { x: s.x, y, z: s.z, yaw: s.yaw, pitch: s.pitch };
    }, sp);

    async function runPair(taaOn, dPos, dYaw, searchR, framesA = 3, framesB = 3) {
      await page.evaluate(({ p, taa, nA }) => {
        const a = window.__app;
        a.pipeline.taaOn = taa;
        a.player.setPose(p.x, p.y, p.z, p.yaw, p.pitch);
        for (let i = 0; i < nA; i++) a.pipeline.render(a.scenes, a.camera, a.env, a.time);
      }, { p: pose, taa: taaOn, nA: framesA });
      const b0 = await page.screenshot({ type: 'png' });

      await page.evaluate(({ p, taa, dp, dy, nB }) => {
        const a = window.__app;
        a.pipeline.taaOn = taa;
        const rad = p.yaw * Math.PI / 180;
        const rx = Math.cos(rad), rz = Math.sin(rad);
        a.player.setPose(p.x + rx * dp, p.y, p.z + rz * dp, p.yaw + dy, p.pitch);
        for (let i = 0; i < nB; i++) a.pipeline.render(a.scenes, a.camera, a.env, a.time);
      }, { p: pose, taa: taaOn, dp: dPos, dy: dYaw, nB: framesB });
      const b1 = await page.screenshot({ type: 'png' });

      return analyzeFlicker(decodePNG(b0), decodePNG(b1), searchR, 38);
    }

    // 1. Frozen-camera TAA subpixel jitter (0mm move, taa=1, frame 6 vs frame 9): catches stationary rainbow Z-fighting!
    const frozenTaa = await runPair(true, 0.0, 0.0, 1, 6, 3);
    // 2. Ultra-micro jitter (4mm, 0.015 deg, taa=0): pure Z-fighting detector (<0.15px motion)!
    const micro = await runPair(false, 0.004, 0.015, 1, 2, 2);
    // 3. Standard jitter (6cm, 0.35 deg, taa=0 & taa=1) with 11x11 (R=5) parallax-invariant window!
    const shiftTaa0 = await runPair(false, 0.06, 0.35, 5, 2, 2);
    const shiftTaa1 = await runPair(true, 0.06, 0.35, 5, 8, 8);

    const flagged = frozenTaa.hotBlocks > 0 || micro.hotBlocks > 0 || shiftTaa0.hotBlocks >= 3 || shiftTaa1.hotBlocks >= 3;
    results.push({ id: sp.id, label: sp.label, pose, frozen_taa1: frozenTaa, micro_4mm_taa0: micro, shift_6cm_taa0: shiftTaa0, shift_6cm_taa1: shiftTaa1, flagged });
    const tag = flagged ? 'FLICKER' : 'CLEAN  ';
    console.log(`[${tag}] ${sp.id.padEnd(20)} | 0mm(taa1): hot=${String(frozenTaa.hotBlocks).padStart(3)} | 4mm(taa0): hot=${String(micro.hotBlocks).padStart(3)} flip=${micro.flipPct}% | 6cm(taa0): hot=${String(shiftTaa0.hotBlocks).padStart(3)} | 6cm(taa1): hot=${String(shiftTaa1.hotBlocks).padStart(3)}`);
  }

  // Restore RAF loop before finishing
  await page.evaluate(() => { const a = window.__app; if (a._origFrame) a.frame = a._origFrame; });

  // 3. Direct Hero Landmark Mesh Coplanar-Face Geometric Audit!
  const heroCoplanar = await page.evaluate(() => {
    const a = window.__app;
    const issues = [];
    a.landmarks?.root?.updateMatrixWorld(true);
    a.landmarks?.root?.traverse((m) => {
      if (!m.isMesh || !m.geometry) return;
      const pos = m.geometry.attributes?.position;
      const idx = m.geometry.index;
      if (!pos || !idx || !pos.array || !idx.array) return;
      const arr = pos.array, ix = idx.array, e = m.matrixWorld.elements;
      // Extract vertical / wall triangles (|ny| < 0.3) and bucket by quantized plane (nx,nz,d)
      const buckets = new Map();
      const nTris = ix.length / 3;
      if (nTris > 120000) return; // cap huge merged hero meshes? No, check up to 120k tris per mesh!
      for (let t = 0; t < ix.length; t += 3) {
        const a0 = ix[t] * 3, a1 = ix[t + 1] * 3, a2 = ix[t + 2] * 3;
        const x0 = e[0]*arr[a0]+e[4]*arr[a0+1]+e[8]*arr[a0+2]+e[12], y0 = e[1]*arr[a0]+e[5]*arr[a0+1]+e[9]*arr[a0+2]+e[13], z0 = e[2]*arr[a0]+e[6]*arr[a0+1]+e[10]*arr[a0+2]+e[14];
        const x1 = e[0]*arr[a1]+e[4]*arr[a1+1]+e[8]*arr[a1+2]+e[12], y1 = e[1]*arr[a1]+e[5]*arr[a1+1]+e[9]*arr[a1+2]+e[13], z1 = e[2]*arr[a1]+e[6]*arr[a1+1]+e[10]*arr[a1+2]+e[14];
        const x2 = e[0]*arr[a2]+e[4]*arr[a2+1]+e[8]*arr[a2+2]+e[12], y2 = e[1]*arr[a2]+e[5]*arr[a2+1]+e[9]*arr[a2+2]+e[13], z2 = e[2]*arr[a2]+e[6]*arr[a2+1]+e[10]*arr[a2+2]+e[14];
        const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0, vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 0.08) continue; // skip tiny <0.04m2 sliver
        nx /= len; ny /= len; nz /= len;
        // Keep SIGNED normal (n1 · n2 > +0.99 = SAME-FACING true Z-fighting, avoiding thin double-sided box front/back false positives!)
        const d = nx * x0 + ny * y0 + nz * z0;
        const key = `${Math.round(nx * 20)}_${Math.round(ny * 20)}_${Math.round(nz * 20)}_${Math.round(d * 25)}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, b = []);
        if (b.length < 40) {
          b.push([
            Math.min(x0, x1, x2), Math.max(x0, x1, x2),
            Math.min(y0, y1, y2), Math.max(y0, y1, y2),
            Math.min(z0, z1, z2), Math.max(z0, z1, z2),
            d, nx, ny, nz, len * 0.5,
          ]);
        }
      }
      let pairs = 0;
      const samples = [];
      for (const b of buckets.values()) {
        if (b.length < 2) continue;
        for (let i = 0; i < b.length; i++) {
          const A = b[i];
          for (let j = i + 1; j < b.length; j++) {
            const B = b[j];
            if (Math.abs(A[6] - B[6]) > 0.03) continue;
            if ((A[7]*B[7] + A[8]*B[8] + A[9]*B[9]) < 0.995) continue; // strictly SAME-FACING coplanar!
            // Check 3D AABB strict overlap (> 0.15m on at least 2 axes!)
            const ox = Math.min(A[1], B[1]) - Math.max(A[0], B[0]);
            const oy = Math.min(A[3], B[3]) - Math.max(A[2], B[2]);
            const oz = Math.min(A[5], B[5]) - Math.max(A[4], B[4]);
            const dims = [ox, oy, oz].filter((v) => v > 0.25).length;
            if (dims >= 2) {
              // Exclude the two halves of the exact same quad (share exact same bbox AND identical area)?
              // Wait: a triangulated quad has 2 triangles with IDENTICAL bbox! Skip identical-bbox same-quad pair!
              const sameBox = Math.abs(A[0]-B[0])<1e-3 && Math.abs(A[1]-B[1])<1e-3 && Math.abs(A[2]-B[2])<1e-3 && Math.abs(A[3]-B[3])<1e-3 && Math.abs(A[4]-B[4])<1e-3 && Math.abs(A[5]-B[5])<1e-3;
              if (sameBox) continue;
              pairs++;
              if (samples.length < 5) {
                samples.push({
                  x: +((Math.max(A[0], B[0]) + Math.min(A[1], B[1])) * 0.5).toFixed(1),
                  y: +((Math.max(A[2], B[2]) + Math.min(A[3], B[3])) * 0.5).toFixed(1),
                  z: +((Math.max(A[4], B[4]) + Math.min(A[5], B[5])) * 0.5).toFixed(1),
                  gapM: +Math.abs(A[6] - B[6]).toFixed(4),
                });
              }
            }
          }
        }
      }
      if (pairs > 0) issues.push({ mesh: m.name || m.parent?.name || 'anon', coplanarPairs: pairs, samples });
    });
    return issues.sort((a, b) => b.coplanarPairs - a.coplanarPairs);
  });

  // Also check if ANY tile currently has overlapping LODs (detail + base/mass simultaneously visible!)
  const lodOverlap = await page.evaluate(() => {
    const a = window.__app;
    let both = 0;
    for (const t of a.city?.tiles?.values() || []) {
      if (t.detail?.on && (t.base?.on || t.mass?.on)) both++;
    }
    return { lodSimultaneousTiles: both, nearPlane: a.camera?.near, farPlane: a.camera?.far, reverseZ: !!(a.pipeline?.reversed ?? a.pipeline?.reverseZ) };
  });

  const flaggedSpots = results.filter((r) => r.flagged);
  console.log('\n=== FLICKER & COPLANAR SUMMARY ===');
  console.log(`Flagged flicker spots: ${flaggedSpots.length} / ${results.length}`);
  console.log(`Camera/LOD:`, JSON.stringify(lodOverlap));
  console.log(`Hero meshes with coplanar overlapping faces: ${heroCoplanar.length}`);
  for (const hc of heroCoplanar.slice(0, 12)) {
    console.log(`  HERO_COPLANAR ${hc.mesh}: ${hc.coplanarPairs} pairs, e.g. ${JSON.stringify(hc.samples[0])}`);
  }

  fs.writeFileSync(path.join(__dir, 'phase5_flicker_report.json'), JSON.stringify({ flaggedCount: flaggedSpots.length, totalSpots: results.length, lodOverlap, spots: results, heroCoplanar, errors: diag }, null, 2));
} finally {
  await browser.close();
}
