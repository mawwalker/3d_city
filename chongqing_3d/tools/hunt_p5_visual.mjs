// Phase 5 Visual Motion-Defect Hunter (Wall Z-Fighting Flicker Heatmaps & 5-Frame Pedestrian Motion Bursts).
// Usage:
//   node hunt_p5_visual.mjs --round p5_hunt [--mode all|flicker|ped] [--url http://127.0.0.1:8779/] [--w 1600 --h 900] [--q ultra]
import { chromium } from 'playwright-core';
import { argv } from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const dataDir = resolve(rootDir, 'site/data');
const shotsRoot = resolve(rootDir, 'shots');

const args = argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const round = arg('round', 'p5_hunt');
const mode = arg('mode', 'all');
const baseUrl = arg('url', 'http://127.0.0.1:8779/');
const w = +arg('w', 1600), h = +arg('h', 900);
const quality = arg('q', 'ultra');
const only = arg('only', '') ? arg('only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;

const outDir = resolve(shotsRoot, round);
mkdirSync(outDir, { recursive: true });

const L = JSON.parse(readFileSync(resolve(dataDir, 'landmarks.json'), 'utf8'));
const B = L.bridgesById || Object.fromEntries((L.bridges || []).map((b) => [b.id, b]));
const pt = (o, fb) => ({ ...(o || fb), x: o?.x ?? fb.x, baseY: o?.baseY ?? o?.terrainY ?? o?.y ?? o?.deckY ?? fb.baseY, z: o?.z ?? fb.z });

const jfb = pt(L.jiefangbei, { x: 0, baseY: 107.6, z: 0 });
const guotai = pt(L.guotai, { x: 12.5, baseY: 109.0, z: -306.9 });
const wfc = pt(L.wfc, { x: 81.7, baseY: 116.0, z: -200.4 });
const hyd = pt(L.hongyadong, { x: 105.9, baseY: 26.5, lowY: 26.5, highY: 98.5, z: -507.6 });
const raffles = pt(L.raffles, { x: 980.3, baseY: 40.8, z: -848.1, tipX: 1186.3, tipZ: -1119.5 });
const qsm = B.qiansimen || { x: 140.0, z: -977.3, ux: -0.364, uz: -0.931, p0: [299.9, -568.7], deckY: 69.2 };
const dsm = B.dongshuimen || { x: 1281.3, z: -80.2, p0: [825.9, -219.5], deckY: 70.5 };
const liziba = pt(L.liziba, { x: -3824.9, baseY: 48.0, z: 491.6, portalY: 70.5, viewpoint: { x: -3774.4, y: 46.5, z: 379.3 } });
const greatHall = pt(L.great_hall, { x: -2246.6, baseY: 68.9, z: -472.4 });
const grandTheatre = pt(L.grand_theatre, { x: 403.4, baseY: 64.1, z: -1399.9 });
const shibati = pt(L.shibati, { x: -380.8, baseY: 43.4, z: 688.6 });
const kuixing = pt(L.kuixinglou, { x: -281.7, baseY: 113.4, plazaY: 113.4, z: -349.1 });
const baixiang = pt(L.baixiangju, { x: 781.2, baseY: 66.4, z: 173.8 });

const qsmUx = qsm.ux ?? -0.364, qsmUz = qsm.uz ?? -0.931;
const qsmPerpX = -qsmUz, qsmPerpZ = qsmUx;
const qsmP0x = qsm.p0?.[0] ?? 299.9, qsmP0z = qsm.p0?.[1] ?? -568.7;
const qsmDeckY = qsm.deckY ?? 69.2;
const lzbVp = liziba.viewpoint || { x: -3774.4, y: 46.5, z: 379.3 };

function aim(cx, cy, cz, tx, ty, tz) {
  const dx = tx - cx, dy = ty - cy, dz = tz - cz;
  const horiz = Math.hypot(dx, dz) || 1;
  return {
    yaw: +(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360).toFixed(2),
    pitch: +((Math.atan2(dy, horiz) * 180) / Math.PI).toFixed(2),
  };
}

function spot(name, { cx, cy, cz, tx, ty, tz, walkAutoY = false, hour = 15.5 }) {
  const estY = typeof cy === 'number' ? cy : 100;
  const a = aim(cx, estY, cz, tx, ty, tz);
  return { name, cx, cy: walkAutoY ? 'auto' : cy, cz, yaw: a.yaw, pitch: a.pitch, mode: walkAutoY ? 'walk' : 'fly', hour };
}

// 18 dense architectural & hero viewpoints for stationary + micro-jitter Z-fighting flicker heatmaps
const flickerSpots = [
  spot('f01_jiefangbei_cbd', { cx: jfb.x + 40, cy: jfb.baseY + 12, cz: jfb.z + 35, tx: jfb.x - 10, ty: jfb.baseY + 38, tz: jfb.z - 65 }),
  spot('f02_jiefangbei_plaza', { cx: jfb.x - 42, cy: jfb.baseY + 2, cz: jfb.z + 34, tx: jfb.x + 12, ty: jfb.baseY + 14, tz: jfb.z - 15, walkAutoY: true }),
  spot('f03_hillside_yuzhong', { cx: -512, cy: 108, cz: 320, tx: -468, ty: 104, tz: 262 }),
  spot('f04_hillside_slope', { cx: -545.8, cy: 79, cz: 548.6, tx: -502, ty: 88, tz: 506, walkAutoY: true }),
  spot('f05_hongyadong_1f', { cx: hyd.x - 58, cy: (hyd.lowY ?? 26.5) + 4, cz: hyd.z - 62, tx: hyd.x + 18, ty: (hyd.lowY ?? 26.5) + 22, tz: hyd.z + 5 }),
  spot('f06_hongyadong_11f', { cx: hyd.x + 14, cy: (hyd.highY ?? 98.5) + 2, cz: hyd.z + 56, tx: hyd.x - 18, ty: (hyd.highY ?? 98.5) + 4, tz: hyd.z - 10, walkAutoY: true }),
  spot('f07_raffles_podium', { cx: raffles.x - 145, cy: 115, cz: raffles.z - 150, tx: raffles.x + 20, ty: 135, tz: raffles.z + 10 }),
  spot('f08_guotai_center', { cx: guotai.x + 68, cy: guotai.baseY + 10, cz: guotai.z + 60, tx: guotai.x, ty: guotai.baseY + 18, tz: guotai.z }),
  spot('f09_kuixinglou', { cx: kuixing.x + 48, cy: (kuixing.plazaY ?? 113.4) + 14, cz: kuixing.z + 58, tx: kuixing.x, ty: (kuixing.plazaY ?? 113.4) - 2, tz: kuixing.z }),
  spot('f10_shibati', { cx: shibati.x + 55, cy: shibati.baseY + 10, cz: shibati.z - 45, tx: shibati.x - 18, ty: shibati.baseY + 12, tz: shibati.z + 25 }),
  spot('f11_great_hall', { cx: greatHall.x + 120, cy: greatHall.baseY + 26, cz: greatHall.z + 52, tx: greatHall.x, ty: greatHall.baseY + 24, tz: greatHall.z }),
  spot('f12_grand_theatre', { cx: grandTheatre.x - 130, cy: grandTheatre.baseY + 28, cz: grandTheatre.z + 125, tx: grandTheatre.x + 10, ty: grandTheatre.baseY + 22, tz: grandTheatre.z }),
  spot('f13_liziba', { cx: lzbVp.x, cy: lzbVp.y + 3.0, cz: lzbVp.z, tx: liziba.x, ty: liziba.portalY + 6, tz: liziba.z }),
  spot('f14_qiansimen_deck', { cx: qsmP0x + qsmUx * 190 + qsmPerpX * 8.5, cy: qsmDeckY + 4.0, cz: qsmP0z + qsmUz * 190 + qsmPerpZ * 8.5, tx: qsmP0x + qsmUx * 265, ty: qsmDeckY + 14, tz: qsmP0z + qsmUz * 265 }),
  spot('f15_dongshuimen_baixiang', { cx: (dsm.p0?.[0] ?? 825.9) - 55, cy: dsm.deckY + 18, cz: (dsm.p0?.[1] ?? -219.5) + 85, tx: baixiang.x, ty: baixiang.baseY + 28, tz: baixiang.z - 40 }),
  spot('f16_tile_border_0_0', { cx: -52, cy: 132, cz: -46, tx: 45, ty: 120, tz: 45 }),
  spot('f17_tile_border_1000', { cx: 935, cy: 108, cz: -620, tx: 1045, ty: 88, tz: -660 }),
  spot('f18_yuzhong_dense_mid', { cx: -796, cy: 96, cz: -191, tx: -710, ty: 94, tz: -260, walkAutoY: true }),
];

// 8 dense pedestrian zones for 5-frame motion bursts (dt = 0.6s)
const pedSpots = [
  spot('ped01_jiefangbei_plaza', { cx: jfb.x + 36, cy: jfb.baseY + 12, cz: jfb.z + 42, tx: jfb.x - 10, ty: jfb.baseY + 2, tz: jfb.z - 12 }),
  spot('ped02_jiefangbei_avenue', { cx: jfb.x + 88, cy: jfb.baseY + 11, cz: jfb.z + 96, tx: jfb.x + 48, ty: jfb.baseY + 2, tz: jfb.z + 42 }),
  spot('ped03_hongyadong_1f', { cx: hyd.x - 85, cy: (hyd.lowY ?? 26.5) + 9, cz: hyd.z - 64, tx: hyd.x + 25, ty: (hyd.lowY ?? 26.5) + 2, tz: hyd.z - 46 }),
  spot('ped04_hongyadong_11f', { cx: hyd.x + 16, cy: (hyd.highY ?? 98.5) + 12, cz: hyd.z + 74, tx: hyd.x - 18, ty: (hyd.highY ?? 98.5) + 1, tz: hyd.z + 18 }),
  spot('ped05_dongshuimen', { cx: (dsm.p0?.[0] ?? 825.9) - 55, cy: dsm.deckY + 16, cz: (dsm.p0?.[1] ?? -219.5) + 85, tx: (dsm.p0?.[0] ?? 825.9) - 10, ty: dsm.deckY - 12, tz: (dsm.p0?.[1] ?? -219.5) + 15 }),
  spot('ped06_shibati', { cx: shibati.x + 56, cy: shibati.baseY + 16, cz: shibati.z - 46, tx: shibati.x - 15, ty: shibati.baseY + 2, tz: shibati.z + 15 }),
  spot('ped07_hillside_street', { cx: -512, cy: 112, cz: 320, tx: -468, ty: 94, tz: 262 }),
  spot('ped08_tile_border_seam', { cx: -28, cy: 125, cz: 32, tx: 22, ty: 109, tz: -18 }),
];

const selFlicker = (mode === 'all' || mode === 'flicker')
  ? (only ? flickerSpots.filter((s) => only.includes(s.name)) : flickerSpots)
  : [];
const selPed = (mode === 'all' || mode === 'ped')
  ? (only ? pedSpots.filter((s) => only.includes(s.name)) : pedSpots)
  : [];

const executablePath = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
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

const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));

const startUrl = `${baseUrl}?pos=0,120,0&look=0,-10&hour=15.5&weather=clear&mode=fly&q=${quality}&ui=0&taa=0`;
await page.goto(startUrl, { waitUntil: 'load', timeout: 90000 });
await page.evaluate(() => window.__app.settle(60000));

const meta = { round, quality, w, h, flicker: [], ped: [], errors };

// Helper: teleport + settle + read actual pose
async function gotoSpot(s, taaOn) {
  return await page.evaluate(async ({ s, taaOn }) => {
    const a = window.__app;
    a.pipeline.taaOn = !!taaOn;
    a.env.setHour(s.hour);
    a.teleport(s.cx, s.cy, s.cz, s.yaw, s.pitch, s.mode);
    await a.settle(60000);
    // Let 2 frames render cleanly
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const p = a.player.pos;
    return {
      x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
      yaw: +(a.player.yaw * 180 / Math.PI).toFixed(3),
      pitch: +(a.player.pitch * 180 / Math.PI).toFixed(3),
      fps: +a.fps.toFixed(1),
      peopleShown: a.people ? a.people.shown : 0,
    };
  }, { s, taaOn });
}

// PART A: Zero-Clock-Drift Z-Fighting Flicker Capture across ALL 18 views:
//   1. taa=0 pure +0.008m forward Z-nudge with animation clock frozen (0 moving peds/cars/wind, <0.2px parallax -> 100% pure Z-fighting!)
//   2. taa=1 stationary 0.000m Halton-jitter diff (4 frames apart, frozen clock -> exposes TAA wall shimmer / coplanar Z-fighting!)
for (const s of selFlicker) {
  const t0 = Date.now();
  const pose = await gotoSpot(s, false);
  const pathA = resolve(outDir, `${s.name}_a.png`);
  const pathB = resolve(outDir, `${s.name}_b.png`);

  // Freeze time/actors cleanly while rendering Frame A and +0.008m Frame B
  await page.evaluate(() => {
    const a = window.__app;
    if (!a._origTick) a._origTick = a.tick.bind(a);
    a.tick = () => {};
    const cam = a.camera.position;
    const groundY = a.terrain ? a.terrain.surfaceY(cam.x, cam.z) : 0;
    const agl = Math.max(0, cam.y - groundY);
    a._renderStatic = () => {
      a.player.update(0);
      a.pipeline.beginFrame(a.camera);
      a.focus.copy(a.camera.position);
      a.pipeline.render(a.scenes, a.camera, a.env, a.time, 0, { focus: a.focus, shadowScale: Math.max(1, agl / 20) });
    };
    a._renderStatic();
  });
  await page.screenshot({ path: pathA });

  await page.evaluate(() => {
    const a = window.__app;
    const p = a.player.pos;
    const fwdX = Math.sin(a.player.yaw), fwdZ = -Math.cos(a.player.yaw);
    a.player.setPose(p.x + fwdX * 0.008, p.y + 0.002, p.z + fwdZ * 0.008);
    a._renderStatic();
  });
  await page.screenshot({ path: pathB });

  // Stationary TAA=1 Halton subpixel jitter check (0.000m camera move, 4 frames apart)
  const pathTA = resolve(outDir, `${s.name}_taa_a.png`);
  const pathTB = resolve(outDir, `${s.name}_taa_b.png`);
  await page.evaluate(() => {
    const a = window.__app;
    const p = a.player.pos;
    const fwdX = Math.sin(a.player.yaw), fwdZ = -Math.cos(a.player.yaw);
    a.player.setPose(p.x - fwdX * 0.008, p.y - 0.002, p.z - fwdZ * 0.008);
    a.pipeline.taaOn = true;
    a.pipeline.historyValid = false;
    for (let i = 0; i < 6; i++) a._renderStatic();
  });
  await page.screenshot({ path: pathTA });
  await page.evaluate(() => {
    const a = window.__app;
    for (let i = 0; i < 4; i++) a._renderStatic();
  });
  await page.screenshot({ path: pathTB });
  const taaPair = { a: pathTA, b: pathTB };

  // Unfreeze tick before next teleport/settle
  await page.evaluate(() => {
    const a = window.__app;
    if (a._origTick) a.tick = a._origTick;
  });

  const rec = { name: s.name, pose, a: pathA, b: pathB, taaPair, secs: +((Date.now() - t0) / 1000).toFixed(1) };
  meta.flicker.push(rec);
  console.log(JSON.stringify({ type: 'flicker', name: s.name, pose, secs: rec.secs }));
}

// PART B: 5-Frame Pedestrian Motion Bursts (dt = 0.6s, taa=1)
for (const s of selPed) {
  const t0 = Date.now();
  const pose = await gotoSpot(s, true);
  const frames = [];
  for (let i = 0; i < 5; i++) {
    if (i > 0) await page.waitForTimeout(600);
    const fPath = resolve(outDir, `${s.name}_f${i}.png`);
    await page.screenshot({ path: fPath });
    frames.push(fPath);
  }
  const rec = { name: s.name, pose, frames, secs: +((Date.now() - t0) / 1000).toFixed(1) };
  meta.ped.push(rec);
  console.log(JSON.stringify({ type: 'ped', name: s.name, pose, secs: rec.secs }));
}

writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify({ done: true, flickerCount: meta.flicker.length, pedCount: meta.ped.length, errorCount: errors.length, errors }));
await browser.close();
if (errors.length > 0) process.exit(2);
