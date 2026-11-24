#!/usr/bin/env node
// Chongqing 3D — Dynamic Simulation Audit (Traffic on 3D slopes, Pedestrians, Liziba Monorail, Yangtze Cableway, Boats).
// Usage: node audit_dynamics.mjs [--url http://127.0.0.1:8768/] [--root <chongqing_3d_dir>] [--minutes 3]
import fs from 'node:fs';
import path from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchAuditPage, waitAppReady, loadSiteJSON, parseArg } from './pw_helper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = parseArg(argv, 'url', 'http://127.0.0.1:8768/');
const ROOT = parseArg(argv, 'root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const SIM_MINUTES = Number(parseArg(argv, 'minutes', '3'));

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

const checks = [];
const record = (name, status, detail, data) => {
  checks.push({ name, status, detail, data });
  console.log(`[${status}] dynamics.${name}: ${detail}`);
};

try {
  // Spawn at Jiefangbei / Yuzhong core for traffic + pedestrians
  await page.goto(`${BASE_URL}?pos=0,280,0&look=30,-25&mode=fly&hour=15&ui=0&q=high`, { waitUntil: 'load', timeout: 60000 });
  const ready = await waitAppReady(page, 90000);
  if (!ready.ok) throw new Error('App not ready: ' + JSON.stringify(ready));

  // ---- 1. Traffic simulation & 3D terrain adherence
  const trafficRes = await page.evaluate((simMinutes) => {
    const a = window.__app;
    const T = a.traffic;
    if (!T) return { missing: true };
    const cam = a.camera;
    const ter = a.terrain || a.city?.terrain;
    const sampleY = (x, z) => ter?.sample ? ter.sample(x, z) : (ter?.heightAt ? ter.heightAt(x, z) : (a.sampleTerrain ? a.sampleTerrain(x, z) : 0));

    let t = a.time || 0;
    const steps = Math.max(600, Math.round(simMinutes * 1200));
    const t0 = performance.now();
    const hit = (A, B) => {
      const dx = B.x - A.x, dz = B.z - A.z;
      const c = Math.abs(A.hx * B.hx + A.hz * B.hz), sn = Math.abs(A.hx * B.hz - A.hz * B.hx);
      const al = (A.len || 4.4) / 2 - 0.1, aw = (A.wid || 1.8) / 2 - 0.1;
      const bl = (B.len || 4.4) / 2 - 0.1, bw = (B.wid || 1.8) / 2 - 0.1;
      return Math.abs(dx * A.hx + dz * A.hz) < al + bl * c + bw * sn &&
             Math.abs(dx * A.hz - dz * A.hx) < aw + bl * sn + bw * c &&
             Math.abs(dx * B.hx + dz * B.hz) < bl + al * c + aw * sn &&
             Math.abs(dx * B.hz - dz * B.hx) < bw + al * sn + aw * c;
    };

    let ovSamples = 0, ovSum = 0, ovMax = 0, vehSum = 0;
    const ovEx = [];
    const sampleOverlaps = () => {
      const cells = new Map();
      let n = 0, nv = 0;
      for (const lane of T.lanes || []) {
        for (const v of lane.veh || []) {
          if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x === 0) continue;
          nv++;
          const k = Math.floor(v.x / 8) * 100003 + Math.floor(v.z / 8);
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            const arr = cells.get(k + dx * 100003 + dz);
            if (!arr) continue;
            for (const o of arr) {
              if (Math.abs(o.y - v.y) < 1.8 && hit(v, o)) {
                n++;
                if (ovEx.length < 8) ovEx.push([Math.round(v.x), Math.round(v.z), +v.y.toFixed(1), +o.y.toFixed(1), +v.v.toFixed(1), +o.v.toFixed(1)]);
              }
            }
          }
          let arr = cells.get(k);
          if (!arr) cells.set(k, arr = []);
          arr.push(v);
        }
      }
      ovSamples++; ovSum += n; ovMax = Math.max(ovMax, n); vehSum += nv;
    };

    for (let i = 0; i < steps; i++) {
      t += 0.05;
      T.update(0.05, t, cam, a.env?.hour ?? 15);
      if (i % 60 === 59) sampleOverlaps();
    }
    const msPerStep = (performance.now() - t0) / steps;
    a.time = t;

    let n = 0, sp = 0, stopped = 0, stuck60 = 0, nanVeh = 0, tunnelVeh = 0, buriedVeh = 0, skyVeh = 0;
    const badY = [];
    for (const lane of T.lanes || []) {
      const ed = lane.edge;
      const isDeck = !!(ed && (ed.flags & 2));
      for (const v of lane.veh || []) {
        n++;
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) { nanVeh++; continue; }
        sp += v.v || 0;
        if ((v.v || 0) < 0.3) stopped++;
        if ((v.wait || 0) > 60) stuck60++;
        const isTunnel = (v.cl !== undefined && v.cl < -1.1);
        if (isTunnel) { tunnelVeh++; continue; }
        const ty = sampleY(v.x, v.z);
        if (Number.isFinite(ty) && !isDeck) {
          const dy = v.y - ty;
          if (dy < -2.0) { buriedVeh++; if (badY.length < 8) badY.push({ kind: 'buried', x: Math.round(v.x), z: Math.round(v.z), vy: +v.y.toFixed(2), ty: +ty.toFixed(2), cl: +(v.cl ?? 0).toFixed(2) }); }
          else if (dy > 4.0) { skyVeh++; if (badY.length < 8) badY.push({ kind: 'floating', x: Math.round(v.x), z: Math.round(v.z), vy: +v.y.toFixed(2), ty: +ty.toFixed(2), cl: +(v.cl ?? 0).toFixed(2) }); }
        }
      }
    }
    return {
      lanes: (T.lanes || []).length,
      n,
      tunnelVeh,
      meanKmh: n ? +(sp / n * 3.6).toFixed(1) : 0,
      stoppedRatio: n ? +(stopped / n).toFixed(3) : 0,
      stuck60,
      nanVeh,
      buriedVeh,
      skyVeh,
      badY,
      overlapPairsPerSample: ovSamples ? +(ovSum / ovSamples).toFixed(3) : 0,
      overlapMax: ovMax,
      ovEx,
      msPerStep: +msPerStep.toFixed(2),
    };
  }, SIM_MINUTES);

  if (trafficRes.missing) {
    record('traffic', 'WARN', 'window.__app.traffic not active yet', trafficRes);
  } else if (trafficRes.n === 0) {
    record('traffic', 'WARN', `0 active vehicles (lanes=${trafficRes.lanes})`, trafficRes);
  } else {
    const ok = trafficRes.nanVeh === 0 && trafficRes.meanKmh >= 6.0 && trafficRes.overlapPairsPerSample <= 1.5 && trafficRes.buriedVeh <= 2 && trafficRes.skyVeh <= 2;
    record('traffic', ok ? 'PASS' : 'FAIL',
      `n=${trafficRes.n} (tunnels=${trafficRes.tunnelVeh}), mean=${trafficRes.meanKmh}km/h, stopped=${(trafficRes.stoppedRatio * 100).toFixed(1)}%, stuck60=${trafficRes.stuck60}, overlaps/sample=${trafficRes.overlapPairsPerSample}, surfaceBuried=${trafficRes.buriedVeh}, surfaceFloat=${trafficRes.skyVeh}, ${trafficRes.msPerStep}ms/step`,
      trafficRes);
  }

  // ---- 2. Pedestrians terrain-draping check (move to street level in Jiefangbei)
  const pedRes = await page.evaluate(async () => {
    const a = window.__app;
    if (!a.people) return { missing: true };
    const ter = a.terrain || a.city?.terrain;
    const sampleY = (x, z) => ter?.sample ? ter.sample(x, z) : (ter?.heightAt ? ter.heightAt(x, z) : (a.sampleTerrain ? a.sampleTerrain(x, z) : 0));
    const ty0 = sampleY(0, 0);
    a.player.mode = 'walk';
    a.player.setPose(10, (Number.isFinite(ty0) ? ty0 : 250) + 1.7, 10, 0, 0);
    if (typeof a.settle === 'function') await a.settle(20000);
    for (let i = 0; i < 60; i++) a.people.update(0.05, a.camera, a.env?.hour ?? 15, 0, true);
    const shown = a.people.shown ?? a.people.count ?? 0;
    // Decode path & pathY DataTextures from active tiles to verify every pedestrian sample tracks DEM terrain!
    let checked = 0, badY = 0, maxErr = 0;
    if (a.people.tiles && a.people.tiles.size > 0) {
      const RANGE = 1500, YMIN = -30, YMAX = 750;
      const waterY = ter?.waterY ?? 0.0;
      for (const o of a.people.tiles.values()) {
        const pd = o.tex?.image?.data, yd = o.texY?.image?.data;
        const orig = o.mat?.uniforms?.uOrigin?.value;
        if (!pd || !yd || !orig) continue;
        const nPx = pd.length / 4;
        const step = Math.max(1, Math.floor(nPx / 60));
        for (let i = 0; i < nPx && checked < 300; i += step) {
          if (yd[i * 4 + 3] === 0) continue; // unused padding texel
          const ux = (pd[i * 4] * 256 + pd[i * 4 + 1]) / 65535;
          const uz = (pd[i * 4 + 2] * 256 + pd[i * 4 + 3]) / 65535;
          const uy = (yd[i * 4] * 256 + yd[i * 4 + 1]) / 65535;
          const wx = orig.x + ux * 2 * RANGE - RANGE;
          const wz = orig.z + uz * 2 * RANGE - RANGE;
          const py = YMIN + uy * (YMAX - YMIN);
          const ty = Math.max(sampleY(wx, wz), waterY + 0.15) + 0.19;
          if (!Number.isFinite(ty)) continue;
          checked++;
          const err = Math.abs(py - ty);
          if (err > maxErr) maxErr = err;
          if (err > 1.0) badY++;
        }
      }
    }
    return { shown, checked, badY, maxErr: +maxErr.toFixed(3) };
  });
  if (pedRes.missing) record('pedestrians', 'WARN', 'window.__app.people not active', pedRes);
  else if (pedRes.shown === 0) record('pedestrians', 'WARN', '0 visible pedestrians at Jiefangbei street level', pedRes);
  else record('pedestrians', pedRes.checked > 0 && pedRes.badY === 0 ? 'PASS' : 'FAIL',
    `shown=${pedRes.shown}, pathY-checked=${pedRes.checked}, badY(>1.0m)=${pedRes.badY}, maxErr=${pedRes.maxErr}m`, pedRes);

  // ---- 3. Liziba Monorail animation & through-building check
  const liziba = lm?.liziba || findLandmark(lm, 'liziba');
  const monorailRes = await page.evaluate(async (lz) => {
    const a = window.__app;
    if (lz) {
      const ty = lz.baseY ?? lz.terrain_y ?? 20;
      a.player.mode = 'fly';
      a.player.setPose(lz.x, ty + 45, lz.z - 80, 180, -10);
      if (typeof a.settle === 'function') await a.settle(20000);
    }
    const findObjs = (rx) => {
      const hits = [];
      const scan = (sc) => sc?.traverse((o) => { if (rx.test(o.name || '')) hits.push(o); });
      scan(a.scenes?.opaque); scan(a.scenes?.moving); scan(a.scenes?.forward); scan(a.landmarks?.group);
      return [...new Set(hits)];
    };
    const trains = findObjs(/^crt-line2-t0-c0$/i);
    if (!trains.length && typeof a.landmarks?.getMonorailState !== 'function') {
      return { found: false };
    }
    const samples = [];
    let t = a.time || 0;
    for (let i = 0; i < 120; i++) {
      t += 0.5;
      if (typeof a.landmarks?.update === 'function') a.landmarks.update(0.5, t, a.env, a.camera);
      else a.tick(0.05);
      if (typeof a.landmarks?.getMonorailState === 'function') {
        const st = a.landmarks.getMonorailState();
        if (st && Number.isFinite(st.x)) samples.push([st.x, st.y, st.z]);
      } else {
        trains[0].updateWorldMatrix(true, false);
        const e = trains[0].matrixWorld.elements;
        samples.push([e[12], e[13], e[14]]);
      }
    }
    if (samples.length < 2) return { found: true, samples: samples.length };
    let totalDist = 0, maxNonWrapStep = 0, wraps = 0, minDistToLz = 1e9, portalY = null;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      if (i > 0) {
        const d = Math.hypot(p[0] - samples[i - 1][0], p[1] - samples[i - 1][1], p[2] - samples[i - 1][2]);
        if (d > 250) { wraps++; } // End-of-line loop respawn at tunnel portal
        else { totalDist += d; if (d > maxNonWrapStep) maxNonWrapStep = d; }
      }
      if (lz) {
        const dh = Math.hypot(p[0] - lz.x, p[2] - lz.z);
        if (dh < minDistToLz) { minDistToLz = dh; portalY = p[1]; }
      }
    }
    const portalYErr = (lz && Number.isFinite(lz.portalY) && portalY !== null) ? +(portalY - lz.portalY).toFixed(2) : null;
    return { found: true, samples: samples.length, totalDist: +totalDist.toFixed(1), maxStep: +maxNonWrapStep.toFixed(1), wraps, minDistToLz: +minDistToLz.toFixed(2), portalY: portalY !== null ? +portalY.toFixed(2) : null, expectedPortalY: lz?.portalY ?? null, portalYErr };
  }, liziba);

  if (!monorailRes.found) {
    record('liziba_monorail', 'FAIL', 'Could not find animated monorail train object (crt-line2-t0-c0)', monorailRes);
  } else {
    const yOk = monorailRes.portalYErr === null || Math.abs(monorailRes.portalYErr) < 2.0;
    const ok = monorailRes.totalDist > 200 && monorailRes.maxStep < 25 && (liziba ? monorailRes.minDistToLz < 6 : true) && yOk;
    record('liziba_monorail', ok ? 'PASS' : 'FAIL',
      `dist=${monorailRes.totalDist}m over 60s (wraps=${monorailRes.wraps}), maxStep=${monorailRes.maxStep}m, closestToLiziba=${monorailRes.minDistToLz}m, portalY=${monorailRes.portalY} (expected=${monorailRes.expectedPortalY})`, monorailRes);
  }

  // ---- 4. Yangtze Cableway animation check
  const cwObj = lm?.cableway || null;
  const cablewayRes = await page.evaluate(async () => {
    const a = window.__app;
    const findObjs = (rx) => {
      const hits = [];
      const scan = (sc) => sc?.traverse((o) => { if (rx.test(o.name || '')) hits.push(o); });
      scan(a.scenes?.opaque); scan(a.scenes?.moving); scan(a.scenes?.forward); scan(a.landmarks?.group);
      return [...new Set(hits)];
    };
    const cabins = findObjs(/cableway.*cabin|ropeway.*cabin|^cabin/i);
    if (!cabins.length && typeof a.landmarks?.getCablewayState !== 'function') return { found: false };
    const samples = [];
    let t = a.time || 0;
    for (let i = 0; i < 120; i++) {
      t += 0.5;
      if (typeof a.landmarks?.update === 'function') a.landmarks.update(0.5, t, a.env, a.camera);
      if (typeof a.landmarks?.getCablewayState === 'function') {
        const st = a.landmarks.getCablewayState();
        const c0 = Array.isArray(st) ? st[0] : st;
        if (c0 && Number.isFinite(c0.x)) samples.push([c0.x, c0.y, c0.z]);
      } else {
        cabins[0].updateWorldMatrix(true, false);
        const e = cabins[0].matrixWorld.elements;
        samples.push([e[12], e[13], e[14]]);
      }
    }
    let totalDist = 0, maxJump = 0, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      if (i > 0) {
        const d = Math.hypot(p[0] - samples[i - 1][0], p[1] - samples[i - 1][1], p[2] - samples[i - 1][2]);
        totalDist += d; if (d > maxJump) maxJump = d;
      }
    }
    const waterY = a.terrain?.waterY ?? 0.0;
    return { found: true, cabins: cabins.length || 1, totalDist: +totalDist.toFixed(1), maxJump: +maxJump.toFixed(1), minY: +minY.toFixed(1), maxY: +maxY.toFixed(1), clearanceAboveWater: +(minY - waterY).toFixed(1) };
  }, cwObj);

  if (!cablewayRes.found) {
    record('yangtze_cableway', 'FAIL', 'Could not find animated cableway cabin object (name /cableway.*cabin|cabin/i or landmarks.getCablewayState)', cablewayRes);
  } else {
    const ok = cablewayRes.totalDist > 20 && cablewayRes.maxJump < 40 && cablewayRes.clearanceAboveWater > 10.0;
    record('yangtze_cableway', ok ? 'PASS' : 'FAIL',
      `cabins=${cablewayRes.cabins}, dist=${cablewayRes.totalDist}m over 60s, maxStep=${cablewayRes.maxJump}m, Y=[${cablewayRes.minY}, ${cablewayRes.maxY}], riverClearance=${cablewayRes.clearanceAboveWater}m`, cablewayRes);
  }

  // ---- 5. Two-river boats elevation check
  const boatsRes = await page.evaluate(() => {
    const a = window.__app;
    if (!a.boats) return { missing: true };
    const total = a.boats.count ?? 0;
    const movers = a.boats.movers?.length ?? 0;
    const wy = a.boats.waterY ?? 0;
    const expectedWy = a.terrain?.waterY ?? 0;
    // Check actual dynamic instanced mesh Y matrices
    let checked = 0, bad = 0;
    for (const im of a.boats.dyn || []) {
      if (!im || !im.instanceMatrix) continue;
      const arr = im.instanceMatrix.array;
      for (let i = 0; i < im.count; i++) {
        const y = arr[i * 16 + 13];
        if (y < -400) continue; // culled far boat
        checked++;
        if (Math.abs(y - expectedWy) > 1.0) bad++;
      }
    }
    return { total, movers, waterY: wy, checked, bad };
  });
  if (boatsRes.missing) record('boats', 'WARN', 'window.__app.boats not active', boatsRes);
  else record('boats', boatsRes.total > 0 && boatsRes.bad === 0 ? 'PASS' : 'FAIL', `total=${boatsRes.total} (movers=${boatsRes.movers}), activeChecked=${boatsRes.checked}, offWater(>1m)=${boatsRes.bad}`, boatsRes);

  const failed = checks.filter((c) => c.status === 'FAIL').length;
  const out = { passed: failed === 0 && diag.pageErrors.length === 0, failed, checks, errors: diag };
  fs.writeFileSync(path.join(__dir, 'last_dynamics_report.json'), JSON.stringify(out, null, 2));
  console.log(`\n=== Dynamics Audit: failed=${failed} ===`);
  exit(out.passed ? 0 : 1);
} finally {
  await browser.close();
}
