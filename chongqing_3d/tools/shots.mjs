// Chongqing 3D Mandatory 12-View Visual QA Inspection Suite Runner.
// Calibrated directly against live site/data/landmarks.json & engine-core (#12) URL hooks.
//
// Usage:
//   node shots.mjs [--suite all|core|heroes|night|street|bridges] [--only name1,name2] [--round r1] [--url http://127.0.0.1:8768/] [--w 1600 --h 900] [--q ultra] [--dry-run]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const dataDir = resolve(rootDir, 'site/data');
const shotsDir = resolve(rootDir, 'shots');
mkdirSync(shotsDir, { recursive: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const suite = arg('suite', 'all');
const only = arg('only', '') ? arg('only', '').split(',').map((s) => s.trim()).filter(Boolean) : null;
const round = arg('round', 'r1');
const url = arg('url', 'http://127.0.0.1:8768/');
const w = +arg('w', 1600), h = +arg('h', 900);
const quality = arg('q', 'ultra');

function loadJson(p) {
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

const L = loadJson(resolve(dataDir, 'landmarks.json')) || {};
const B = L.bridgesById || Object.fromEntries((L.bridges || []).map((b) => [b.id, b]));

function pt(obj, fallback = { x: 0, baseY: 100, z: 0 }) {
  if (!obj) return fallback;
  return {
    ...obj,
    x: obj.x ?? fallback.x,
    baseY: obj.baseY ?? obj.terrainY ?? obj.y ?? obj.deckY ?? fallback.baseY,
    z: obj.z ?? fallback.z,
  };
}

// Compass yaw (deg clockwise from -Z north) & pitch (deg, +up / -down).
function aim(cx, cy, cz, tx, ty, tz) {
  const dx = tx - cx;
  const dy = ty - cy;
  const dz = tz - cz;
  const horiz = Math.hypot(dx, dz) || 1;
  const yaw = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  const pitch = (Math.atan2(dy, horiz) * 180) / Math.PI;
  return { yaw: +yaw.toFixed(1), pitch: +pitch.toFixed(1) };
}

function makeShot(name, group, { cx, cy, cz, tx, ty, tz, yaw, pitch, hour = 15.5, weather = 'clear', mode = 'fly', ui = 0, walkAutoY = false, js = undefined, wait = undefined }) {
  const estY = typeof cy === 'number' ? cy : 100;
  const angles = (yaw !== undefined && pitch !== undefined)
    ? { yaw, pitch }
    : aim(cx, estY, cz, tx ?? cx, ty ?? estY, tz ?? (cz - 100));
  const yStr = walkAutoY ? 'auto' : Number(cy).toFixed(1);
  const q = `pos=${Number(cx).toFixed(1)},${yStr},${Number(cz).toFixed(1)}&look=${angles.yaw},${angles.pitch}&hour=${hour}&weather=${weather}&mode=${mode}&q=${quality}&ui=${ui}`;
  return { name, group, out: `${round}/${name}.png`, q, ...(js ? { js } : {}), ...(wait ? { wait } : {}) };
}

const jfb = pt(L.jiefangbei, { x: 0, baseY: 107.6, z: 0 });
const guotai = pt(L.guotai, { x: 12.5, baseY: 109.0, z: -306.9 });
const wfc = pt(L.wfc, { x: 81.7, baseY: 116.0, z: -200.4 });
const hyd = pt(L.hongyadong, { x: 105.9, baseY: 18.3, z: -507.6, riverFacing: [-0.2377, -0.9713] });
const hydFx = hyd.riverFacing?.[0] ?? -0.2377;
const hydFz = hyd.riverFacing?.[1] ?? -0.9713;
const raffles = pt(L.raffles, { x: 980.3, baseY: 40.8, z: -848.1, tipX: 1186.3, tipZ: -1119.5, crystalY: 290.8 });
const qsm = B.qiansimen || { x: 140.0, z: -977.3, ux: -0.364, uz: -0.931, p0: [299.9, -568.7], deckY: 69.2, towerH: 189 };
const dsm = B.dongshuimen || { x: 1281.3, z: -80.2, ux: 0.956, uz: 0.293, deckY: 70.5, towerH: 172 };
const ctm = B.chaotianmen || { x: 480.2, z: -3135.1, ux: 0.999, uz: -0.053, deckY: 92.0, mainSpan: 552, towerH: 142 };
const liziba = pt(L.liziba, { x: -3824.9, baseY: 53.1, z: 491.6, portalY: 74.1, viewpoint: { x: -3774.4, y: 34.2, z: 379.3 } });
const cabN = pt(L.cableway?.north, { x: 560.0, baseY: 112.0, z: -56.5 });
const cabT0 = L.cableway?.towers?.[0] || { x: 786.9, z: 67.3, baseY: 73.5, topY: 118.4 };
const cabS = pt(L.cableway?.south, { x: 1591.4, baseY: 50.2, z: 506.6 });
const baixiang = pt(L.baixiangju, { x: 781.2, baseY: 66.4, z: 173.8 });
const greatHall = pt(L.great_hall, { x: -2246.6, baseY: 68.9, z: -472.4 });
const grandTheatre = pt(L.grand_theatre, { x: 403.4, baseY: 64.1, z: -1399.9 });
const nanshan = pt(L.nanshan_pavilion, { x: 2472.1, baseY: 278.1, z: 1347.0 });
const shibati = pt(L.shibati, { x: -380.8, baseY: 43.4, z: 688.6 });

// Qiansimen Bridge axes & south deck anchor
const qsmUx = qsm.ux ?? -0.364, qsmUz = qsm.uz ?? -0.931;
const qsmPerpX = -qsmUz, qsmPerpZ = qsmUx;
const qsmP0x = qsm.p0?.[0] ?? 299.9, qsmP0z = qsm.p0?.[1] ?? -568.7;
const qsmDeckY = qsm.deckY ?? 69.2;

// Dongshuimen perpendicular
const dsmUx = dsm.ux ?? 0.956, dsmUz = dsm.uz ?? 0.293;
const dsmPerpX = -dsmUz, dsmPerpZ = dsmUx;

// Liziba viewing platform looking UP at 6-8F open portal
const lzbVp = liziba.viewpoint || { x: liziba.x + 50, y: liziba.baseY - 18, z: liziba.z - 112 };

const allShots = [
  // 1. ANTI-CHEAT TEST: Street-level 1.7m ordinary hillside street (non-hero Yuzhong slope!)
  makeShot('01a_hillside_street_day', 'street', {
    cx: -520, cy: 92, cz: 310,
    tx: -420, ty: 102, tz: 230,
    hour: 15.2, mode: 'walk', walkAutoY: true,
  }),
  // 1b. Second ordinary residential/commercial hillside slope (south Yuzhong slope near Shibati edge)
  makeShot('01b_hillside_slope_day', 'street', {
    cx: shibati.x - 165, cy: shibati.baseY + 2, cz: shibati.z - 140,
    tx: shibati.x - 60, ty: shibati.baseY + 24, tz: shibati.z - 220,
    hour: 15.5, mode: 'walk', walkAutoY: true,
  }),

  // 2. Street-level 1.7m Jiefangbei CBD commercial canyon
  makeShot('02_cbd_canyon_day', 'street', {
    cx: jfb.x + 88, cy: jfb.baseY, cz: jfb.z + 92,
    tx: wfc.x, ty: wfc.baseY + 55, tz: wfc.z,
    hour: 15.5, mode: 'walk', walkAutoY: true,
  }),

  // 3. 洪崖洞 Hongyadong: riverfront close-up day, dramatic night, and iconic Qiansimen Bridge view
  makeShot('03a_hongyadong_day', 'heroes', {
    cx: hyd.x + hydFx * 165, cy: hyd.baseY + 26, cz: hyd.z + hydFz * 165,
    tx: hyd.x, ty: hyd.baseY + 46, tz: hyd.z,
    hour: 15.5, mode: 'fly',
  }),
  makeShot('03b_hongyadong_night', 'night', {
    cx: hyd.x + hydFx * 165, cy: hyd.baseY + 26, cz: hyd.z + hydFz * 165,
    tx: hyd.x, ty: hyd.baseY + 46, tz: hyd.z,
    hour: 21.0, mode: 'fly',
  }),
  makeShot('03c_hongyadong_from_qiansimen', 'heroes', {
    cx: qsmP0x + qsmUx * 160 + qsmPerpX * 14, cy: qsmDeckY + 4, cz: qsmP0z + qsmUz * 160 + qsmPerpZ * 14,
    tx: hyd.x, ty: hyd.baseY + 44, tz: hyd.z,
    hour: 18.6, mode: 'fly',
  }),

  // 4. 来福士广场 & 朝天门两江交汇: aerial golden hour + riverfront night
  makeShot('04a_raffles_aerial_golden', 'heroes', {
    cx: raffles.tipX + 520, cy: 270, cz: raffles.tipZ - 320,
    tx: raffles.x + 20, ty: 165, tz: raffles.z - 40,
    hour: 17.5, mode: 'fly',
  }),
  makeShot('04b_raffles_riverfront_night', 'night', {
    cx: raffles.tipX + 290, cy: 20, cz: raffles.tipZ - 260,
    tx: raffles.x + 30, ty: 175, tz: raffles.z - 40,
    hour: 21.0, mode: 'fly',
  }),

  // 5. 解放碑 + 国泰艺术中心 + WFC
  makeShot('05a_jiefangbei_plaza_day', 'heroes', {
    cx: jfb.x - 24, cy: jfb.baseY, cz: jfb.z + 44,
    tx: jfb.x + 8, ty: jfb.baseY + 20, tz: jfb.z - 12,
    hour: 15.2, mode: 'walk', walkAutoY: true,
  }),
  makeShot('05b_guotai_wfc_day', 'heroes', {
    cx: guotai.x + 110, cy: guotai.baseY + 24, cz: guotai.z - 110,
    tx: guotai.x, ty: guotai.baseY + 22, tz: guotai.z,
    hour: 15.5, mode: 'fly',
  }),

  // 6. 千厮门大桥 & 东水门大桥 & 朝天门大桥 (on-bridge pedestrian sidewalk walk + close-ups!)
  makeShot('06a_qiansimen_walk', 'bridges', {
    cx: qsmP0x + qsmUx * 190 + qsmPerpX * 9.5, cy: qsmDeckY + 3.4, cz: qsmP0z + qsmUz * 190 + qsmPerpZ * 9.5,
    tx: qsmP0x + qsmUx * 490, ty: qsmDeckY + 42, tz: qsmP0z + qsmUz * 490,
    hour: 16.5, mode: 'fly',
  }),
  makeShot('06b_qiansimen_close', 'bridges', {
    cx: qsm.x + qsmPerpX * 300, cy: qsmDeckY + 42, cz: qsm.z + qsmPerpZ * 300,
    tx: qsm.x, ty: qsmDeckY + 28, tz: qsm.z,
    hour: 16.5, mode: 'fly',
  }),
  makeShot('06c_dongshuimen_close', 'bridges', {
    cx: dsm.x - dsmPerpX * 320, cy: dsm.deckY + 45, cz: dsm.z - dsmPerpZ * 320,
    tx: dsm.x, ty: dsm.deckY + 32, tz: dsm.z,
    hour: 17.2, mode: 'fly',
  }),
  makeShot('06d_chaotianmen_bridge', 'bridges', {
    cx: ctm.x - 160, cy: ctm.deckY + 75, cz: ctm.z + 440,
    tx: ctm.x, ty: ctm.deckY + 38, tz: ctm.z,
    hour: 16.8, mode: 'fly',
  }),

  // 7. 李子坝轻轨穿楼 (street-level tourist viewing platform looking UP!)
  makeShot('07_liziba_monorail', 'heroes', {
    cx: lzbVp.x, cy: lzbVp.y + 2.2, cz: lzbVp.z,
    tx: liziba.x, ty: liziba.portalY + 6, tz: liziba.z,
    hour: 15.5, mode: 'fly',
  }),

  // 8. 长江索道 + 白象居 (North station + river tower + catenary cables + red/cream cabin + Baixiangju!)
  makeShot('08a_cableway_baixiangju', 'heroes', {
    cx: cabT0.x + 175, cy: cabT0.topY + 12, cz: cabT0.z + 210,
    tx: (cabN.x + cabT0.x) * 0.5 + 30, ty: (cabN.baseY + baixiang.baseY) * 0.5 + 18, tz: (cabN.z + baixiang.z) * 0.5,
    hour: 16.6, mode: 'fly',
  }),
  makeShot('08b_cableway_cabin_close', 'heroes', {
    cx: cabT0.x + 125, cy: cabT0.topY - 6, cz: cabT0.z - 55,
    tx: cabT0.x + 48, ty: cabT0.topY - 12, tz: cabT0.z + 42,
    hour: 16.5, mode: 'fly',
  }),

  // 9. 重庆人民大礼堂 & 重庆大剧院
  makeShot('09a_great_hall_day', 'heroes', {
    cx: greatHall.x + 165, cy: greatHall.baseY + 26, cz: greatHall.z + 32,
    tx: greatHall.x, ty: greatHall.baseY + 28, tz: greatHall.z,
    hour: 15.2, mode: 'fly',
  }),
  makeShot('09b_grand_theatre_day', 'heroes', {
    cx: grandTheatre.x + 195, cy: grandTheatre.baseY + 34, cz: grandTheatre.z + 155,
    tx: grandTheatre.x, ty: grandTheatre.baseY + 26, tz: grandTheatre.z,
    hour: 15.8, mode: 'fly',
  }),
  makeShot('09c_grand_theatre_night', 'night', {
    cx: grandTheatre.x + 195, cy: grandTheatre.baseY + 34, cz: grandTheatre.z + 155,
    tx: grandTheatre.x, ty: grandTheatre.baseY + 26, tz: grandTheatre.z,
    hour: 20.8, mode: 'fly',
  }),

  // 10. 南山一棵树 Panoramic Skyline (golden sunset + neon night)
  makeShot('10a_nanshan_panorama_golden', 'core', {
    cx: nanshan.x - 15, cy: nanshan.baseY + 26, cz: nanshan.z - 15,
    tx: 460, ty: 115, tz: -480,
    hour: 17.6, mode: 'fly',
  }),
  makeShot('10b_nanshan_panorama_night', 'night', {
    cx: nanshan.x - 15, cy: nanshan.baseY + 26, cz: nanshan.z - 15,
    tx: 460, ty: 115, tz: -480,
    hour: 21.0, mode: 'fly',
  }),

  // 11. Rainy Chongqing Night Street Walk (unobstructed avenue + shopfront close-up!)
  makeShot('11a_rain_night_avenue', 'night', {
    cx: jfb.x + 88, cy: jfb.baseY, cz: jfb.z + 92,
    tx: wfc.x, ty: wfc.baseY + 25, tz: wfc.z,
    hour: 21.0, weather: 'rain', mode: 'walk', walkAutoY: true,
  }),
  makeShot('11b_rain_night_shops', 'night', {
    cx: jfb.x + 76, cy: jfb.baseY, cz: jfb.z + 82,
    tx: jfb.x - 10, ty: jfb.baseY + 14, tz: jfb.z - 15,
    hour: 21.0, weather: 'rain', mode: 'walk', walkAutoY: true,
  }),

  // 12. Full UI & Minimap Check (ui=1)
  makeShot('12_ui_minimap', 'core', {
    cx: raffles.tipX + 460, cy: 230, cz: raffles.tipZ - 290,
    tx: raffles.x, ty: 145, tz: raffles.z - 20,
    hour: 17.8, mode: 'fly', ui: 1,
  }),

  // --- PHASE 3 EXTREME CLOSE-UP MACRO ARCHITECTURAL GATES (5-15m / tight detail) ---
  // M1. Ordinary hillside residential macro (8-12m: 3D window frames/sills/mullions, tInteriors, railings,防盗网, laundry, drainpipes, AC brackets, mortar PBR)
  makeShot('m1_macro_resi_balcony', 'macro', {
    cx: -511, cy: 96, cz: 304,
    tx: -475, ty: 109, tz: 274,
    hour: 15.8, mode: 'walk', walkAutoY: true,
  }),
  // M2. Ground-floor Chongqing shopfront macro (recessed double doors, threshold steps, furnished shop interiors, awning brackets, signage, sidewalk clutter)
  makeShot('m2_macro_shopfront', 'macro', {
    cx: jfb.x + 83, cy: jfb.baseY, cz: jfb.z + 86,
    tx: jfb.x + 62, ty: jfb.baseY + 2.6, tz: jfb.z + 74,
    hour: 16.6, mode: 'walk', walkAutoY: true,
  }),
  // M3. Jiefangbei CBD podium, deep curtain-wall mullions, sculpted yellow taxis, pedestrians & street clutter macro
  makeShot('m3_macro_cbd_podium', 'macro', {
    cx: jfb.x + 84, cy: jfb.baseY, cz: jfb.z + 72,
    tx: jfb.x + 48, ty: jfb.baseY + 14, tz: jfb.z - 8,
    hour: 15.8, mode: 'walk', walkAutoY: true,
  }),
  // M4. Hongyadong carved dougong brackets, ribbed clay eaves, staggered lanterns, varied lit interiors & mossy cliff waterfall macro
  makeShot('m4_macro_hongyadong_eaves', 'macro', {
    cx: hyd.x + hydFx * 82 + 16, cy: hyd.baseY + 38, cz: hyd.z + hydFz * 82 - 6,
    tx: hyd.x + 6, ty: hyd.baseY + 46, tz: hyd.z,
    hour: 18.3, mode: 'fly',
  }),
  // M5. Qiansimen Bridge deck PBR asphalt/tire tracks, expansion joints, bolted guardrails, cable vibration dampers & anchor collars macro
  makeShot('m5_macro_qiansimen_deck', 'macro', {
    cx: qsmP0x + qsmUx * 208 + qsmPerpX * 6.8, cy: qsmDeckY + 2.8, cz: qsmP0z + qsmUz * 208 + qsmPerpZ * 6.8,
    tx: qsmP0x + qsmUx * 242, ty: qsmDeckY + 2.8, tz: qsmP0z + qsmUz * 242,
    hour: 16.5, mode: 'fly',
  }),
  // M6. Liziba dressed cliff retaining arches/ivy, 19F tower windows/interiors/balconies & detailed CRT Line 2 monorail cab macro
  makeShot('m6_macro_liziba_cliff_train', 'macro', {
    cx: lzbVp.x - 14, cy: lzbVp.y + 12, cz: lzbVp.z + 24,
    tx: liziba.x + 8, ty: liziba.portalY + 10, tz: liziba.z - 8,
    hour: 15.8, mode: 'fly',
  }),

  // --- PHASE 4 COMPLEX-TERRAIN BUG-HUNT SUITE (22 brutal eye-level & low-oblique diagnostic views) ---
  // T01-02: 十八梯 / 凯旋路 / 储奇门 steep switchback roads & hillside buildings
  makeShot('t01_shibati_road_walk', 'terrain', {
    cx: shibati.x + 55, cy: shibati.baseY + 2, cz: shibati.z - 45,
    tx: shibati.x - 20, ty: shibati.baseY + 10, tz: shibati.z + 30,
    hour: 15.2, mode: 'walk', walkAutoY: true,
  }),
  makeShot('t02_kaixuan_slope_traffic', 'terrain', {
    cx: -190, cy: 112, cz: 580,
    tx: -290, ty: 82, tz: 690,
    hour: 15.2, mode: 'fly',
  }),
  // T03-04: 洪崖洞 11F 沧白路 upper seam & 1F 嘉滨路 lower road/west cliff
  makeShot('t03_hongyadong_11f_cangbai', 'terrain', {
    cx: hyd.x + 12, cy: hyd.highY, cz: hyd.z + 55,
    tx: hyd.x - 20, ty: hyd.highY - 4, tz: hyd.z - 10,
    hour: 15.4, mode: 'walk', walkAutoY: true,
  }),
  makeShot('t04_hongyadong_1f_west_road', 'terrain', {
    cx: hyd.x - 125, cy: hyd.lowY + 2, cz: hyd.z - 42,
    tx: hyd.x + 10, ty: hyd.lowY + 10, tz: hyd.z - 32,
    hour: 15.4, mode: 'walk', walkAutoY: true,
  }),
  // T05-06: 魁星楼 22F high-drop road & cliff canyon below
  makeShot('t05_kuixinglou_plaza_seam', 'terrain', {
    cx: (L.kuixinglou?.x ?? -281.7) + 45, cy: (L.kuixinglou?.plazaY ?? 113.4) + 12, cz: (L.kuixinglou?.z ?? -349.1) + 55,
    tx: L.kuixinglou?.x ?? -281.7, ty: (L.kuixinglou?.plazaY ?? 113.4) - 4, tz: L.kuixinglou?.z ?? -349.1,
    hour: 15.3, mode: 'fly',
  }),
  makeShot('t06_kuixinglou_cliff_below', 'terrain', {
    cx: (L.kuixinglou?.x ?? -281.7) + 15, cy: 85, cz: (L.kuixinglou?.z ?? -349.1) - 75,
    tx: L.kuixinglou?.x ?? -281.7, ty: 98, tz: L.kuixinglou?.z ?? -349.1,
    hour: 15.3, mode: 'walk', walkAutoY: true,
  }),
  // T07-09: 苏家坝立交 (72m spiral) & 菜园坝大桥 north/south abutments
  makeShot('t07_sujiaba_spiral_below', 'terrain', {
    cx: (B.sujiaba?.x ?? -2448.7) + 125, cy: (B.sujiaba?.baseY ?? 101.3) + 28, cz: (B.sujiaba?.z ?? 2634.5) - 95,
    tx: B.sujiaba?.x ?? -2448.7, ty: (B.sujiaba?.baseY ?? 101.3) + 42, tz: B.sujiaba?.z ?? 2634.5,
    hour: 15.6, mode: 'fly',
  }),
  makeShot('t08_sujiaba_ramp_top', 'terrain', {
    cx: (B.sujiaba?.x ?? -2448.7) - 95, cy: (B.sujiaba?.topY ?? 173.3) + 22, cz: (B.sujiaba?.z ?? 2634.5) + 85,
    tx: B.sujiaba?.x ?? -2448.7, ty: (B.sujiaba?.topY ?? 173.3) - 10, tz: B.sujiaba?.z ?? 2634.5,
    hour: 15.6, mode: 'fly',
  }),
  makeShot('t09_caiyuanba_north_abutment', 'terrain', {
    cx: (B.caiyuanba?.p0?.[0] ?? -2460.9) + 95, cy: 64, cz: (B.caiyuanba?.p0?.[1] ?? 1072.1) - 65,
    tx: B.caiyuanba?.p0?.[0] ?? -2460.9, ty: 44, tz: (B.caiyuanba?.p0?.[1] ?? 1072.1) + 45,
    hour: 15.6, mode: 'fly',
  }),
  // T10-11: 李子坝 road cars & 鹅岭 steep hillside road
  makeShot('t10_liziba_road_cars', 'terrain', {
    cx: liziba.x + 125, cy: liziba.baseY - 4, cz: liziba.z - 145,
    tx: liziba.x + 25, ty: liziba.baseY + 4, tz: liziba.z - 40,
    hour: 15.5, mode: 'fly',
  }),
  makeShot('t11_eling_steep_slope', 'terrain', {
    cx: -3480, cy: 118, cz: 780,
    tx: -3580, ty: 105, tz: 880,
    hour: 15.5, mode: 'walk', walkAutoY: true,
  }),
  // T12-13: 东水门大桥 Yuzhong & Nan'an abutments + 白象居 cliff seam
  makeShot('t12_dongshuimen_yuzhong_head', 'terrain', {
    cx: (dsm.p0?.[0] ?? 825.9) - 55, cy: dsm.deckY + 18, cz: (dsm.p0?.[1] ?? -219.5) + 85,
    tx: (dsm.p0?.[0] ?? 825.9) + 45, ty: dsm.deckY - 4, tz: (dsm.p0?.[1] ?? -219.5) + 12,
    hour: 15.8, mode: 'fly',
  }),
  makeShot('t13_dongshuimen_nanan_head', 'terrain', {
    cx: (dsm.p1?.[0] ?? 1736.7) + 45, cy: dsm.deckY + 16, cz: (dsm.p1?.[1] ?? 59.1) + 95,
    tx: (dsm.p1?.[0] ?? 1736.7) - 35, ty: dsm.deckY - 6, tz: (dsm.p1?.[1] ?? 59.1) - 10,
    hour: 15.8, mode: 'fly',
  }),
  // T14-15: 长江索道北站 & 南站/龙门浩/南滨路崖壁路
  makeShot('t14_cableway_north_slope', 'terrain', {
    cx: cabN.x - 55, cy: cabN.baseY + 22, cz: cabN.z + 55,
    tx: cabN.x + 10, ty: cabN.baseY + 6, tz: cabN.z - 5,
    hour: 15.8, mode: 'fly',
  }),
  makeShot('t15_cableway_south_nanbin', 'terrain', {
    cx: cabS.x - 85, cy: cabS.baseY + 18, cz: cabS.z + 65,
    tx: cabS.x + 15, ty: cabS.baseY + 4, tz: cabS.z - 10,
    hour: 15.8, mode: 'fly',
  }),
  // T16-17: 黄桷湾立交 multi-level ramps & underside piers
  makeShot('t16_huangjuewan_oblique', 'terrain', {
    cx: (B.huangjuewan?.x ?? 4267.5) - 210, cy: (B.huangjuewan?.baseY ?? 339.2) + 85, cz: (B.huangjuewan?.z ?? -1630.1) + 195,
    tx: B.huangjuewan?.x ?? 4267.5, ty: (B.huangjuewan?.baseY ?? 339.2) + 18, tz: B.huangjuewan?.z ?? -1630.1,
    hour: 16.0, mode: 'fly',
  }),
  makeShot('t17_huangjuewan_low_ramps', 'terrain', {
    cx: (B.huangjuewan?.x ?? 4267.5) + 95, cy: (B.huangjuewan?.baseY ?? 339.2) + 12, cz: (B.huangjuewan?.z ?? -1630.1) + 115,
    tx: B.huangjuewan?.x ?? 4267.5, ty: (B.huangjuewan?.baseY ?? 339.2) + 22, tz: B.huangjuewan?.z ?? -1630.1,
    hour: 16.0, mode: 'fly',
  }),
  // T18-20: 朝天门大桥 both abutments & 千厮门大桥 Yuzhong abutment
  makeShot('t18_chaotianmen_west_head', 'terrain', {
    cx: (ctm.p0?.[0] ?? -377.9) - 95, cy: ctm.deckY + 24, cz: (ctm.p0?.[1] ?? -3089.9) + 110,
    tx: (ctm.p0?.[0] ?? -377.9) + 45, ty: ctm.deckY - 6, tz: ctm.p0?.[1] ?? -3089.9,
    hour: 16.2, mode: 'fly',
  }),
  makeShot('t19_chaotianmen_east_head', 'terrain', {
    cx: (ctm.p1?.[0] ?? 1338.2) + 85, cy: ctm.deckY + 22, cz: (ctm.p1?.[1] ?? -3180.3) + 105,
    tx: (ctm.p1?.[0] ?? 1338.2) - 45, ty: ctm.deckY - 6, tz: ctm.p1?.[1] ?? -3180.3,
    hour: 16.2, mode: 'fly',
  }),
  makeShot('t20_qiansimen_yuzhong_head', 'terrain', {
    cx: qsmP0x + 85, cy: qsmDeckY + 20, cz: qsmP0z + 55,
    tx: qsmP0x - 15, ty: qsmDeckY - 6, tz: qsmP0z - 25,
    hour: 15.8, mode: 'fly',
  }),
  // T21-22: 石板坡大桥 south abutment (18.7m bank jump!) & Yuzhong steep ridge road/tunnel zone
  makeShot('t21_shibanpo_south_head', 'terrain', {
    cx: (B.shibanpo?.p1?.[0] ?? -848.8) + 95, cy: 78, cz: (B.shibanpo?.p1?.[1] ?? 2072.9) - 75,
    tx: B.shibanpo?.p1?.[0] ?? -848.8, ty: 56, tz: B.shibanpo?.p1?.[1] ?? 2072.9,
    hour: 16.0, mode: 'fly',
  }),
  makeShot('t22_yuzhong_steep_arterial', 'terrain', {
    cx: -796, cy: 95, cz: -191,
    tx: -710, ty: 92, tz: -260,
    hour: 15.5, mode: 'walk', walkAutoY: true,
  }),

  // --- PHASE 4 TOP-8 QUANTITATIVE WORST SPOTS (from verifier-data #87 scanner) ---
  makeShot('q01_tilted_caiyuanba', 'worst', {
    cx: -1545.3 + 22, cy: 120, cz: 1851.9 + 22,
    tx: -1545.3, ty: 112, tz: 1851.9,
    hour: 15.4, mode: 'walk', walkAutoY: true,
  }),
  makeShot('q02_tilted_nanbin', 'worst', {
    cx: 2460.3 - 28, cy: 180, cz: 1141.1 - 24,
    tx: 2460.3, ty: 175, tz: 1141.1,
    hour: 15.4, mode: 'walk', walkAutoY: true,
  }),
  makeShot('q03_buried_car_linjiangmen', 'worst', {
    cx: -492, cy: 96, cz: -458,
    tx: -480, ty: 82, tz: -494,
    hour: 15.4, mode: 'fly',
  }),
  makeShot('q04_buried_car_jiabin', 'worst', {
    cx: -145, cy: 36, cz: -555,
    tx: -102, ty: 22, tz: -512,
    hour: 15.4, mode: 'fly',
  }),
  makeShot('q05_deck_pierce_fotuguan', 'worst', {
    cx: -4025, cy: 112, cz: 495,
    tx: -4055, ty: 88, tz: 538,
    hour: 15.5, mode: 'fly',
  }),
  makeShot('q06_floating_car_qiansimen', 'worst', {
    cx: 590, cy: 62, cz: -690,
    tx: 545, ty: 40, tz: -727,
    hour: 15.6, mode: 'fly',
  }),
  makeShot('q07_shibanpo_north_cliff', 'worst', {
    cx: -1105, cy: 58, cz: 820,
    tx: -1178, ty: 38, tz: 876,
    hour: 15.6, mode: 'fly',
  }),
  makeShot('q08_hongyadong_car_clip', 'worst', {
    cx: 18, cy: 26, cz: -575,
    tx: 65, ty: 24, tz: -535,
    hour: 15.5, mode: 'fly',
  }),
  // --- PHASE 4 3D TUNNEL PORTALS (from site/data/tunnels.json) ---
  makeShot('p01_shihuang_tunnel_portal', 'worst', {
    cx: -1084, cy: 65, cz: -424,
    tx: -1087, ty: 61, tz: -380,
    hour: 15.5, mode: 'fly',
  }),
  makeShot('p02_chaotianmen_tunnel_portal', 'worst', {
    cx: 518, cy: 61, cz: -676,
    tx: 547, ty: 57, tz: -649,
    hour: 15.6, mode: 'fly',
  }),
];

let selected = allShots;
if (only) {
  selected = allShots.filter((s) => only.some((pat) => s.name.includes(pat)));
} else if (suite !== 'all') {
  selected = allShots.filter((s) => s.group === suite);
}

const manifestPath = resolve(shotsDir, `${round}_manifest.json`);
writeFileSync(manifestPath, JSON.stringify(selected, null, 2));
const loadedCount = ['jiefangbei', 'hongyadong', 'raffles', 'guotai', 'wfc', 'grand_theatre', 'great_hall', 'liziba', 'cableway', 'nanshan_pavilion'].filter((k) => L[k]).length;
console.log(`Generated manifest ${manifestPath} (${selected.length} shots; landmarks loaded: ${loadedCount}/10, bridges: ${Object.keys(B).length})`);

if (args.includes('--dry-run')) process.exit(0);

const capped = resolve(rootDir, 'pipeline/capped.sh');
const nodeBin = process.execPath;
const shotScript = resolve(__dirname, 'shot.mjs');
const shotArgs = [shotScript, '--manifest', manifestPath, '--url', url, '--w', String(w), '--h', String(h)];

const res = existsSync(capped)
  ? spawnSync('bash', [capped, '12G', nodeBin, ...shotArgs], { stdio: 'inherit' })
  : spawnSync(nodeBin, shotArgs, { stdio: 'inherit' });

process.exit(res.status ?? 0);
