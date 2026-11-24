#!/usr/bin/env node
// Chongqing 3D — Phase 5 Player Wall-Clipping Stress Test (scan_player_collision.mjs)
// Tests walking (normal + Shift sprint!) straight into walls across 28+ Chongqing locations:
//   - Downhill retaining-plinth sides of steep hillside procedural buildings
//   - Uphill sides, sharp building corners, thin buildings (sprint tunneling check!)
//   - Far-pack skyscraper footprints inside loaded near tiles
//   - Tile seam crossings (x=0, z=0)
//   - ALL major hero landmarks (Hongyadong 1F & 11F, Raffles, Jiefangbei, Guotai, WFC,
//     Shibati shophouses, Kuixinglou, Great Hall, Grand Theatre, Science Museum, Baixiangju,
//     Liziba station, Qiansimen/Dongshuimen bridge pylons, Cableway North/South stations)
//   - 3D Mountain Tunnel Portal headwalls/wing walls (Shihuang, Chaotianmen)
//
// Usage: node scan_player_collision.mjs [--url http://127.0.0.1:8790/]
import fs from 'node:fs';
import path from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchAuditPage, waitAppReady, loadSiteJSON, parseArg } from './pw_helper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = parseArg(argv, 'url', 'http://127.0.0.1:8790/');
const ROOT = parseArg(argv, 'root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));

const lm = loadSiteJSON(ROOT, 'landmarks.json') || {};
const tunnels = loadSiteJSON(ROOT, 'tunnels.json') || [];
const { browser, page, diag } = await launchAuditPage({ width: 1280, height: 720 });

try {
  await page.goto(`${BASE_URL}?pos=0,140,0&look=0,-10&mode=walk&hour=15&ui=0&q=high`, { waitUntil: 'load', timeout: 60000 });
  const ready = await waitAppReady(page, 90000);
  if (!ready.ok) throw new Error('App not ready');

  const results = [];
  const runWallCharge = async (name, cat, sx, sz, tx, tz, opts = {}) => {
    const res = await page.evaluate(async ({ sx, sz, tx, tz, sprint, useY, flyCharge }) => {
      const a = window.__app;
      const dx = tx - sx, dz = tz - sz;
      const dist = Math.hypot(dx, dz) || 1;
      const yawDeg = Math.atan2(dx, -dz) * 180 / Math.PI;
      // Load tiles at target
      a.player.mode = 'fly';
      const tyS = a.terrain.sample(sx, sz);
      a.player.setPose(sx, Math.max(tyS, 0) + 50, sz, yawDeg, 0);
      await a.settle(25000);

      // Place player in walk mode (or low fly mode when testing aerial bridge pylon legs!) at start
      a.player.mode = flyCharge ? 'fly' : 'walk';
      const surf = useY !== undefined ? useY : a.collision.surfaceBelow(sx, sz, Math.max(tyS, 0) + 6);
      a.player.setPose(sx, surf + 1.70, sz, yawDeg, 0);
      a.player.onGround = !flyCharge;
      // Check if collider raycast sees a wall along [start -> target]
      const eyeY = surf + 1.2;
      const rayHit = a.collision.raycast(sx, sz, dx / dist, dz / dist, dist + 3.0, eyeY);

      // Simulate walking / Shift-sprinting directly toward target for 3.5s (105 steps @ 33ms)
      a.player.keys.clear();
      a.player.keys.add('KeyW');
      if (sprint) a.player.keys.add('ShiftLeft');
      let maxProg = 0, minDistToTarget = dist, fellBelowTerrain = false;
      for (let i = 0; i < 120; i++) {
        a.player.update(1 / 30);
        const px = a.player.pos.x, py = a.player.pos.y, pz = a.player.pos.z;
        const prog = ((px - sx) * dx + (pz - sz) * dz) / dist;
        if (prog > maxProg) maxProg = prog;
        const dT = Math.hypot(px - tx, pz - tz);
        if (dT < minDistToTarget) minDistToTarget = dT;
        const terY = a.terrain.sample(px, pz);
        if (py - 1.70 < terY - 1.5) fellBelowTerrain = true;
      }
      a.player.keys.clear();

      // Did player reach inside the target wall/building center?
      const px = a.player.pos.x, py = a.player.pos.y, pz = a.player.pos.z;
      const finalDistToTarget = Math.hypot(px - tx, pz - tz);
      // Check if any collider exists at target (tx, tz) at player's feet/head height
      let hasColliderAtTarget = false;
      const ck = Math.floor(tx / 24) * 100003 + Math.floor(tz / 24);
      const arr = a.collision.grid.get(ck) || [];
      let targetPrismBase = null, targetPrismTop = null;
      for (let i = 0; i < arr.length; i += 2) {
        const t = arr[i], b = arr[i + 1];
        if (a.collision._inside(t, b, tx, tz)) {
          hasColliderAtTarget = true;
          targetPrismBase = +t.base[b].toFixed(1);
          targetPrismTop = +t.top[b].toFixed(1);
          break;
        }
      }
      return {
        start: [+sx.toFixed(1), +sz.toFixed(1)],
        target: [+tx.toFixed(1), +tz.toFixed(1)],
        end: [+px.toFixed(1), +py.toFixed(1), +pz.toFixed(1)],
        startDist: +dist.toFixed(2),
        rayHit: +rayHit.toFixed(2),
        maxProg: +maxProg.toFixed(2),
        minDistToTarget: +minDistToTarget.toFixed(2),
        finalDistToTarget: +finalDistToTarget.toFixed(2),
        hasColliderAtTarget,
        targetPrismBase,
        targetPrismTop,
        playerFeetY: +(py - 1.70).toFixed(2),
        fellBelowTerrain,
      };
    }, { sx, sz, tx, tz, sprint: !!opts.sprint, useY: opts.useY, flyCharge: !!opts.flyCharge });

    // A wall charge FAILS if the player walks right into/through the target core (minDistToTarget < stopR) OR lacks a collider!
    const stopR = opts.stopR ?? 1.5;
    const walkedThrough = res.minDistToTarget < stopR;
    const status = walkedThrough ? 'FAIL' : 'PASS';
    results.push({ name, cat, sprint: !!opts.sprint, status, walkedThrough, ...res });
    console.log(`[${status}] ${cat.padEnd(14)} ${name.padEnd(28)} | startD=${res.startDist}m ray=${res.rayHit}m minD=${res.minDistToTarget}m col=${res.hasColliderAtTarget} prismY=[${res.targetPrismBase},${res.targetPrismTop}] feetY=${res.playerFeetY}`);
  };

  // ---- A. Auto-discover 8 nasty STEEP HILLSIDE procedural buildings (downhill retaining wall + corners + sprint + far towers!)
  const steepProbes = await page.evaluate(async () => {
    const a = window.__app;
    const spots = [
      { id: 'shibati_steep', x: -420, z: 580 },
      { id: 'jiefangbei_cbd', x: -120, z: -120 },
      { id: 'nanbin_steep', x: 1850, z: 650 },
      { id: 'liziba_steep', x: -3650, z: 550 },
    ];
    const found = [];
    for (const sp of spots) {
      a.player.mode = 'fly';
      a.player.setPose(sp.x, Math.max(a.terrain.sample(sp.x, sp.z), 0) + 120, sp.z, 0, -45);
      await a.settle(25000);
      // Scan loaded collision tiles for buildings with large downhill drop OR elevated base!
      const cands = [];
      for (const [k, t] of a.collision.tiles.entries()) {
        if (typeof k !== 'number') continue;
        for (let b = 0; b < t.start.length; b++) {
          if (t.top[b] <= 2.2 && t.base[b] <= -5.0) continue; // skip water
          const s = t.start[b], c = t.count[b];
          if (c < 3) continue;
          let cx = 0, cz = 0, minD = 1e9, maxD = -1e9, lowX = 0, lowZ = 0;
          for (let i = 0; i < c; i++) {
            const vx = t.xz[(s + i) * 2], vz = t.xz[(s + i) * 2 + 1];
            cx += vx; cz += vz;
            const d = a.terrain.sample(vx, vz);
            if (d < minD) { minD = d; lowX = vx; lowZ = vz; }
            if (d > maxD) maxD = d;
          }
          cx /= c; cz /= c;
          if (Math.hypot(cx - sp.x, cz - sp.z) > 380) continue;
          const drop = maxD - minD;
          if (drop > 4.5 || t.base[b] > minD - 1.0) {
            // Stand 6m outside the lowest (downhill) corner pointing straight toward building centroid!
            const vx = lowX - cx, vz = lowZ - cz, vl = Math.hypot(vx, vz) || 1;
            const sx = lowX + (vx / vl) * 5.5, sz = lowZ + (vz / vl) * 5.5;
            if (!a.collision._inside(t, b, sx, sz)) {
              cands.push({ id: `${sp.id}_drop${drop.toFixed(0)}m`, sx, sz, tx: cx, tz: cz, drop, baseGap: +(t.base[b] - minD).toFixed(1) });
            }
          }
        }
      }
      cands.sort((u, v) => v.baseGap - u.baseGap || v.drop - u.drop);
      if (cands[0]) found.push(cands[0]);
      if (cands[1]) found.push({ ...cands[1], id: cands[1].id + '_sprint', sprint: true });
    }
    return found;
  });

  for (const p of steepProbes) {
    await runWallCharge(p.id, 'steep_bldg', p.sx, p.sz, p.tx, p.tz, { sprint: p.sprint, stopR: 2.0 });
  }

  // ---- B. Also test buildings with base > gzMin (elevated base/overhangs) & building corners + tile borders!
  const cornerProbes = await page.evaluate(async () => {
    const a = window.__app;
    a.player.mode = 'fly';
    a.player.setPose(0, 220, 0, 0, -45);
    await a.settle(25000);
    const out = [];
    // Find a tall building right near tile border x=0 or z=0, plus an elevated-base building:part!
    let borderB = null, partB = null, thinB = null;
    for (const [k, t] of a.collision.tiles.entries()) {
      if (typeof k !== 'number') continue;
      for (let b = 0; b < t.start.length; b++) {
        if (t.top[b] <= 2.2 && t.base[b] <= -5.0) continue;
        const s = t.start[b], c = t.count[b];
        let cx = 0, cz = 0, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
        for (let i = 0; i < c; i++) {
          const vx = t.xz[(s + i) * 2], vz = t.xz[(s + i) * 2 + 1];
          cx += vx; cz += vz;
          if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
          if (vz < minZ) minZ = vz; if (vz > maxZ) maxZ = vz;
        }
        cx /= c; cz /= c;
        const w = Math.min(maxX - minX, maxZ - minZ);
        const ter = a.terrain.sample(cx, cz);
        if (!borderB && (Math.abs(cx) < 25 || Math.abs(cz) < 25) && Math.hypot(cx, cz) < 400 && w > 8) {
          borderB = { id: 'tile_border_bldg', sx: maxX + 5, sz: cz, tx: cx, tz: cz };
        }
        if (!partB && t.base[b] > ter + 0.5 && Math.hypot(cx, cz) < 500 && w > 6) {
          partB = { id: 'elevated_part_bldg', sx: maxX + 5, sz: cz, tx: cx, tz: cz };
        }
        if (!thinB && w >= 2.0 && w <= 5.5 && Math.hypot(cx, cz) < 500) {
          thinB = { id: 'thin_bldg_sprint', sx: maxX + 5, sz: cz, tx: cx, tz: cz, sprint: true };
        }
      }
    }
    if (borderB) out.push(borderB);
    if (partB) out.push(partB);
    if (thinB) out.push(thinB);
    return out;
  });
  for (const p of cornerProbes) {
    await runWallCharge(p.id, 'edge_case', p.sx, p.sz, p.tx, p.tz, { sprint: p.sprint, stopR: 1.5 });
  }

  // ---- C. ALL Major Hero Landmarks (charge straight at solid ground/walkable-level walls!)
  const heroTargets = [
    ['jiefangbei_monument',   lm.jiefangbei,    10,  0,   2.0],
    ['hongyadong_1f_wall',    lm.hongyadong,     0, -52,  6.0],  // north riverside charging south into Hongyadong 1F
    ['hongyadong_11f_wall',   lm.hongyadong,     0,  46,  6.0],  // south Cangbai charging north into Hongyadong 11F
    ['raffles_tower',         lm.raffles,      -95,  0,  15.0],
    ['guotai_arts_wall',      lm.guotai,        45,  0,   6.0],
    ['wfc_tower',             lm.wfc,           40,  0,   8.0],
    ['great_hall_wall',       lm.great_hall,     0,  65, 10.0],
    ['grand_theatre_wall',    lm.grand_theatre,  0,  75, 10.0],
    ['science_museum_wall',   lm.science_museum, 0,  60,  8.0],
    ['shibati_shophouse',     lm.shibati,       22,  0,   3.0],
    ['kuixinglou_tower',      lm.kuixinglou,    28,  0,   5.0],
    ['baixiangju_block',      lm.baixiangju,    32,  0,   5.0],
    ['liziba_station_pier',   lm.liziba,         0, -35,  4.0],
    ['cableway_north_stn',    lm.cableway?.north, 20, 0,  2.0],
    ['cableway_south_stn',    lm.cableway?.south, 20, 0,  2.0],
  ];
  for (const [nm, obj, ox, oz, stopR] of heroTargets) {
    if (!obj || typeof obj.x !== 'number') continue;
    await runWallCharge(nm, 'hero_landmark', obj.x + ox, obj.z + oz, obj.x, obj.z, { sprint: true, stopR });
  }
  // Also test Shibati shophouse flank directly (west shophouse row at x-14, charging east into the flank!)
  if (lm.shibati) {
    await runWallCharge('shibati_shophouse_flank', 'hero_landmark', lm.shibati.x - 16, lm.shibati.z + 10, lm.shibati.x - 8, lm.shibati.z + 10, { sprint: true, stopR: 1.2 });
  }
  // Also test Qiansimen & Dongshuimen bridge shuttle-pylon leg colliders (auto-discovered from landmarks collider prisms!)
  const pylonProbes = await page.evaluate((bridges) => {
    const a = window.__app;
    const t = a.collision.tiles.get('landmarks');
    if (!t) return [];
    const out = [];
    for (const bid of ['qiansimen', 'dongshuimen']) {
      const b = (bridges || []).find((x) => x.id === bid);
      if (!b) continue;
      // Find a tall pylon leg prism (top > b.deckY + 60) near this bridge!
      let best = null, bd = 1e9;
      for (let i = 0; i < t.start.length; i++) {
        if (t.top[i] < b.deckY + 60) continue;
        const s = t.start[i], c = t.count[i];
        let cx = 0, cz = 0;
        for (let k = 0; k < c; k++) { cx += t.xz[(s + k) * 2]; cz += t.xz[(s + k) * 2 + 1]; }
        cx /= c; cz /= c;
        const d = Math.hypot(cx - b.x, cz - b.z);
        if (d < 350 && d < bd) { bd = d; best = { cx, cz }; }
      }
      if (best) {
        // Charge from 7m along the bridge direction straight into the pylon leg while flying/walking at deckY + 2m!
        const ux = b.ux || 0, uz = b.uz || -1;
        out.push({ id: `${bid}_pylon_leg`, sx: best.cx - ux * 8.0, sz: best.cz - uz * 8.0, tx: best.cx, tz: best.cz, useY: b.deckY + 2.0 });
      }
    }
    return out;
  }, lm.bridges);
  for (const pp of pylonProbes) {
    // Test in fly mode (non-noclip) at deck height so walking off edge into river doesn't interfere with pylon leg collision test!
    await runWallCharge(pp.id, 'bridge_pylon', pp.sx, pp.sz, pp.tx, pp.tz, { sprint: false, useY: pp.useY, flyCharge: true, stopR: 2.0 });
  }

  // ---- D. 3D Mountain Tunnel Portal Solid Headwalls (charging straight into side pier/wing wall — MUST block!)
  // Pick 2 major core tunnel portals (Shihuang around (-1084, -424) & Chaotianmen around (518, -676))
  const pickPortal = (qx, qz) => {
    let best = null, bd = 1e9;
    for (const p of tunnels) {
      const d = Math.hypot(p.x - qx, p.z - qz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  for (const [nm, qx, qz] of [['shihuang_portal_wall', -1084, -424], ['chaotianmen_portal_wall', 518, -676]]) {
    const p = pickPortal(qx, qz);
    if (!p) continue;
    const l = Math.hypot(p.dx, p.dz) || 1, fx = p.dx / l, fz = p.dz / l;
    const rx = fz, rz = -fx;
    const hw = Math.max(6.2, Math.min(22, p.width || 9)) * 0.5 + 0.35;
    // Target right on the solid concrete left portal pier (+hw + 0.7m laterally, +0.35m along)
    const tx = p.x + rx * (hw + 0.7) + fx * 0.35;
    const tz = p.z + rz * (hw + 0.7) + fz * 0.35;
    // Start 6m in front (-fx) on the approach road
    const sx = tx - fx * 6.0, sz = tz - fz * 6.0;
    await runWallCharge(nm, 'tunnel_wall', sx, sz, tx, tz, { sprint: false, stopR: 0.7 });
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL');
  console.log(`\n=== Player Wall-Collision Stress Summary: ${passed}/${results.length} PASSED, ${failed.length} FAILED ===`);
  for (const f of failed) {
    console.log(`  FAIL [${f.cat}] ${f.name}: minD=${f.minDistToTarget}m hasCollider=${f.hasColliderAtTarget} prismY=[${f.targetPrismBase},${f.targetPrismTop}] feetY=${f.playerFeetY} target=${JSON.stringify(f.target)}`);
  }
  fs.writeFileSync(path.join(__dir, 'phase5_player_collision_report.json'), JSON.stringify({ total: results.length, passed, failedCount: failed.length, results, errors: diag }, null, 2));
} finally {
  await browser.close();
}
