#!/usr/bin/env node
// Chongqing 3D — Walk & Fly Physics, Steep Slope, Hongyadong Multi-Level & Bridge Deck Collision Audit.
// Usage: node audit_collision.mjs [--url http://127.0.0.1:8768/] [--root <chongqing_3d_dir>]
import fs from 'node:fs';
import path from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchAuditPage, waitAppReady, loadSiteJSON, parseArg } from './pw_helper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = parseArg(argv, 'url', 'http://127.0.0.1:8768/');
const ROOT = parseArg(argv, 'root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));

function findLandmark(lm, ...keys) {
  const flat = {};
  const scan = (o, pref = '') => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((it, i) => scan(it, it?.id || it?.name || `${pref}_${i}`)); return; }
    if (typeof o.x === 'number' && typeof o.z === 'number') flat[pref.toLowerCase()] = o;
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') scan(v, pref ? `${pref}.${k}` : k);
  };
  scan(lm);
  for (const kw of keys) for (const [fk, fv] of Object.entries(flat)) if (fk.includes(kw)) return fv;
  return null;
}

const lm = loadSiteJSON(ROOT, 'landmarks.json') || {};
const { browser, page, diag } = await launchAuditPage({ width: 1280, height: 720 });

const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(180);
};

const getState = () => page.evaluate(() => {
  const a = window.__app;
  const p = a.player.getPose();
  const ter = a.terrain || a.city?.terrain;
  const ty = ter?.sample ? ter.sample(p.x, p.z) : (ter?.heightAt ? ter.heightAt(p.x, p.z) : (a.sampleTerrain ? a.sampleTerrain(p.x, p.z) : 0));
  const feetY = +(p.y - 1.66).toFixed(2);
  const surfY = a.collision?.surfaceBelow ? +a.collision.surfaceBelow(p.x, p.z, feetY + 0.6).toFixed(2) : null;
  return { ...p, onGround: a.player.onGround, terrainY: +ty.toFixed(2), feetY, surfY, aboveTerrain: +(feetY - ty).toFixed(2) };
});

const placeWalk = async (x, z, yaw = 0, extraY = 2.0, exactY = null) => {
  await page.evaluate(async ({ x, z, yaw, extraY, exactY }) => {
    const a = window.__app;
    const ter = a.terrain || a.city?.terrain;
    const ty = ter?.sample ? ter.sample(x, z) : (ter?.heightAt ? ter.heightAt(x, z) : (a.sampleTerrain ? a.sampleTerrain(x, z) : 0));
    const y = exactY !== null ? exactY : (ty + extraY);
    a.player.mode = 'walk';
    a.player.setPose(x, y, z, yaw, 0);
    if (typeof a.settle === 'function') await a.settle(30000);
    else if (typeof a.waitReady === 'function') await a.waitReady(30000);
    else await new Promise((r) => setTimeout(r, 1200));
  }, { x, z, yaw, extraY, exactY });
  await page.waitForTimeout(600);
};

const checks = [];
const record = (name, ok, detail, data) => {
  checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail, data });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] collision.${name}: ${detail}`);
};

try {
  await page.goto(`${BASE_URL}?mode=walk&hour=15&ui=0&q=high`, { waitUntil: 'load', timeout: 60000 });
  const ready = await waitAppReady(page, 90000);
  if (!ready.ok) throw new Error('App not ready: ' + JSON.stringify(ready));

  // 1. Jiefangbei plaza: walk, jump, fly/walk toggle, wall collision check
  const jfb = findLandmark(lm, 'jiefangbei') || { x: 0, z: 0 };
  await placeWalk(jfb.x + 15, jfb.z + 15, 0, 2.2);
  const s0 = await getState();
  await hold('KeyW', 1800);
  const sWalk = await getState();
  const movedDist = Math.hypot(sWalk.x - s0.x, sWalk.z - s0.z);
  const fellThrough = sWalk.feetY < sWalk.terrainY - 1.5;
  record('jiefangbei_walk', movedDist > 1.5 && !fellThrough && sWalk.onGround,
    `moved=${movedDist.toFixed(1)}m, feetY=${sWalk.feetY}, terrainY=${sWalk.terrainY}, onGround=${sWalk.onGround}`, { s0, sWalk });

  // Jump & land
  await page.keyboard.press('Space');
  await page.waitForTimeout(220);
  const sJump = await getState();
  await page.waitForTimeout(950);
  const sLand = await getState();
  record('jiefangbei_jump', sJump.y > sWalk.y + 0.3 && sLand.onGround && Math.abs(sLand.feetY - sLand.terrainY) < 2.5,
    `jumpDeltaY=${(sJump.y - sWalk.y).toFixed(2)}m, landed onGround=${sLand.onGround}, aboveTerrain=${sLand.aboveTerrain}m`, { sJump, sLand });

  // Fly -> Walk transition
  await page.keyboard.press('KeyF');
  await hold('Space', 1000);
  const sFly = await getState();
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(2500);
  const sBack = await getState();
  record('fly_walk_toggle', sFly.mode === 'fly' && sFly.y > sLand.y + 5 && sBack.mode === 'walk' && sBack.feetY >= sBack.terrainY - 1.5,
    `flyY=${sFly.y}, backMode=${sBack.mode}, backFeetY=${sBack.feetY} vs terrainY=${sBack.terrainY}`, { sFly, sBack });

  // Wall collision check: raycast for a nearby tall building wall (at eye+1.5m to skip knee-high plaza planters!) and walk into it
  const wallProbe = await page.evaluate(() => {
    const a = window.__app;
    if (!a.collision?.raycast) return null;
    const p = a.player.pos;
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = deg * Math.PI / 180;
      const dx = Math.sin(rad), dz = -Math.cos(rad);
      const t = a.collision.raycast(p.x, p.z, dx, dz, 35, p.y + 1.5);
      // Verify wide enough wall (+-1m laterally also hits) so player doesn't graze past a thin corner!
      if (t > 2.5 && t < 30.0) {
        const lx = -dz, lz = dx;
        const tL = a.collision.raycast(p.x + lx * 1.2, p.z + lz * 1.2, dx, dz, t + 2.0, p.y + 1.5);
        const tR = a.collision.raycast(p.x - lx * 1.2, p.z - lz * 1.2, dx, dz, t + 2.0, p.y + 1.5);
        if (tL > 0 && tR > 0 && Math.abs(tL - t) < 2.0 && Math.abs(tR - t) < 2.0) {
          return { deg, dist: +t.toFixed(2), hitX: +(p.x + dx * t).toFixed(2), hitZ: +(p.z + dz * t).toFixed(2) };
        }
      }
    }
    return null;
  });
  if (wallProbe) {
    await page.evaluate((deg) => { window.__app.player.yaw = deg * Math.PI / 180; }, wallProbe.deg);
    const wStart = await getState();
    await page.keyboard.down('ShiftLeft');
    await hold('KeyW', Math.min(4500, Math.max(1500, Math.round(wallProbe.dist * 350))));
    const wHit1 = await getState();
    await hold('KeyW', 1200);
    await page.keyboard.up('ShiftLeft');
    const wHit2 = await getState();
    const creep = Math.hypot(wHit2.x - wHit1.x, wHit2.z - wHit1.z);
    // Verify player did NOT pass far past wall distance
    const traveled = Math.hypot(wHit2.x - wStart.x, wHit2.z - wStart.z);
    const blocked = traveled < wallProbe.dist + 1.5 && creep < 1.5;
    record('building_wall_collision', blocked,
      `wallDist=${wallProbe.dist}m, traveled=${traveled.toFixed(2)}m, extraCreep=${creep.toFixed(2)}m`, { wallProbe, wStart, wHit1, wHit2 });
  } else {
    record('building_wall_collision', false, 'No building wall found within 35m of Jiefangbei spawn via collision.raycast!', {});
  }

  // 2. Steep Chongqing hillside slope walk (walk downhill & uphill)
  const hyd = findLandmark(lm, 'hongyadong') || { x: 180, z: -550 };
  // Pick a sloped location slightly west/south of Hongyadong along Yuzhong slope
  await placeWalk(hyd.x - 120, hyd.z + 180, 0, 2.2);
  const slopeTrace = [];
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    slopeTrace.push(await getState());
  }
  await page.keyboard.up('KeyW');
  const minRel = Math.min(...slopeTrace.map((s) => s.aboveTerrain));
  const maxRel = Math.max(...slopeTrace.map((s) => s.aboveTerrain));
  const elevSpan = Math.max(...slopeTrace.map((s) => s.terrainY)) - Math.min(...slopeTrace.map((s) => s.terrainY));
  const slopeDist = Math.hypot(slopeTrace.at(-1).x - slopeTrace[0].x, slopeTrace.at(-1).z - slopeTrace[0].z);
  record('steep_slope_walk', minRel >= -1.2 && slopeDist > 1.5,
    `dist=${slopeDist.toFixed(1)}m, terrainSpan=${elevSpan.toFixed(1)}m, feet-terrain in [${minRel.toFixed(2)}, ${maxRel.toFixed(2)}]m`,
    { start: slopeTrace[0], end: slopeTrace.at(-1), minRel, maxRel, elevSpan });

  // 3. Hongyadong lower (Binjiang Rd, north/river side) & upper (Cangbai Rd, south/cliff top)
  const hydTopZ = hyd.z + 45;
  const hydBotZ = hyd.z - 55;
  await placeWalk(hyd.x, hydBotZ, 180, 2.5);
  await page.waitForTimeout(800);
  const hydBot = await getState();
  await placeWalk(hyd.x, hydTopZ, 0, 2.5);
  await page.waitForTimeout(800);
  const hydTop = await getState();
  const hydOk = hydBot.feetY >= hydBot.terrainY - 1.5 && hydTop.feetY >= hydTop.terrainY - 1.5 && (hydTop.feetY - hydBot.feetY) > 10;
  record('hongyadong_levels', hydOk,
    `1F feetY=${hydBot.feetY} (ter=${hydBot.terrainY}), 11F feetY=${hydTop.feetY} (ter=${hydTop.terrainY}), levelDiff=${(hydTop.feetY - hydBot.feetY).toFixed(1)}m`,
    { hydBot, hydTop });

  // 4. Qiansimen, Dongshuimen & Chaotianmen Bridge upper deck collider tests (using gotoPlace + walking along deck!)
  const bridgeTargets = [
    ['qiansimen_bridge_deck', lm?.bridgesById?.qiansimen || findLandmark(lm, 'qiansimen')],
    ['dongshuimen_bridge_deck', lm?.bridgesById?.dongshuimen || findLandmark(lm, 'dongshuimen')],
    ['chaotianmen_bridge_deck', lm?.bridgesById?.chaotianmen || findLandmark(lm, 'chaotianmen_br')],
  ];
  for (const [label, br] of bridgeTargets) {
    if (!br) {
      record(label, false, `${label} entry missing from landmarks.json`, {});
      continue;
    }
    const deckY = br.deckY ?? br.deck_y ?? br.deck ?? 55;
    const ux = br.ux ?? 0, uz = br.uz ?? -1;
    const yawDeg = Math.atan2(ux, -uz) * 180 / Math.PI;
    // Query actual cambered upper deck height (via collision.surfaceBelow, matching gotoPlace in walk mode)
    const surfTop = await page.evaluate(({ x, z, maxH }) => window.__app.collision.surfaceBelow(x, z, maxH), { x: br.x, z: br.z, maxH: deckY + 20 });
    await placeWalk(br.x, br.z, yawDeg, 2.0, surfTop + 1.8);
    await page.waitForTimeout(800);
    const br0 = await getState();
    await hold('KeyW', 2200);
    const br1 = await getState();
    const brMoved = Math.hypot(br1.x - br0.x, br1.z - br0.z);
    // River waterY = 0.0; bridge deck is ~40-95m above waterY — player must stay on cambered deck and never fall!
    const stayedOnDeck = br0.feetY > br0.terrainY + 15 && br1.feetY > br1.terrainY + 15 && Math.abs(br1.feetY - surfTop) < 4.0 && br1.onGround;
    record(label, stayedOnDeck && brMoved > 1.5,
      `deckY=${deckY} (cambered surf=${surfTop.toFixed(1)}), startFeetY=${br0.feetY}, endFeetY=${br1.feetY}, riverY=${br1.terrainY}, walked=${brMoved.toFixed(1)}m`,
      { br: { x: br.x, z: br.z, deckY, surfTop }, br0, br1 });
  }

  const failed = checks.filter((c) => c.status === 'FAIL').length;
  const out = { passed: failed === 0 && diag.pageErrors.length === 0, failed, checks, errors: diag };
  fs.writeFileSync(path.join(__dir, 'last_collision_report.json'), JSON.stringify(out, null, 2));
  console.log(`\n=== Collision Audit: ${checks.length - failed}/${checks.length} PASSED ===`);
  exit(out.passed ? 0 : 1);
} finally {
  await browser.close();
}
