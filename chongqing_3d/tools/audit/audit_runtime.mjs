#!/usr/bin/env node
// Chongqing 3D — Runtime Telemetry, WebGL Error/Warning, Benchmark & Floating-Geometry Audit.
// Usage: node audit_runtime.mjs [--url http://127.0.0.1:8768/] [--root <chongqing_3d_dir>] [--quality ultra]
import fs from 'node:fs';
import path from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchAuditPage, waitAppReady, loadSiteJSON, parseArg } from './pw_helper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = parseArg(argv, 'url', 'http://127.0.0.1:8768/');
const ROOT = parseArg(argv, 'root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const QUALITY = parseArg(argv, 'quality', 'ultra');
const W = Number(parseArg(argv, 'w', '1920'));
const H = Number(parseArg(argv, 'h', '1080'));
const BENCH_FRAMES = Number(parseArg(argv, 'frames', '60'));

// Build viewpoints dynamically from landmarks.json + places.json + standard Chongqing checks
function buildViewpoints() {
  const lm = loadSiteJSON(ROOT, 'landmarks.json') || {};
  const pts = [];
  const grab = (id, label, obj, dy = 25, look = [0, -10], mode = 'fly', hour = 15, weather = 'clear') => {
    if (!obj || typeof obj.x !== 'number' || typeof obj.z !== 'number') return;
    pts.push({ id, label, x: obj.x, z: obj.z, dy, look, mode, hour, weather, raw: obj });
  };

  // Flexible lookup across flat or nested landmarks.json structures
  const flat = {};
  const scan = (o, pref = '') => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      o.forEach((it, idx) => { if (it && typeof it === 'object') scan(it, it.id || it.key || it.name || `${pref}_${idx}`); });
      return;
    }
    if (typeof o.x === 'number' && typeof o.z === 'number') flat[pref.toLowerCase()] = o;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') scan(v, pref ? `${pref}.${k}` : k);
    }
  };
  scan(lm);
  const find = (...keys) => {
    for (const kw of keys) {
      for (const [fk, fv] of Object.entries(flat)) if (fk.includes(kw)) return fv;
    }
    return null;
  };

  // 12 key Chongqing viewpoints (day, sunset, night, rainy)
  grab('jiefangbei_walk',   'Jiefangbei Plaza Walk',        find('jiefangbei') || { x: 0, z: 0 }, 1.7, [30, 5], 'walk', 15);
  grab('hongyadong_day',    'Hongyadong Riverfront Day',    find('hongyadong') || { x: 180, z: -550 }, 12, [190, 12], 'fly', 15);
  grab('hongyadong_night',  'Hongyadong Night',             find('hongyadong') || { x: 180, z: -550 }, 35, [200, -5], 'fly', 21);
  grab('raffles_sunset',    'Raffles City & Confluence',    find('raffles') || { x: 930, z: -930 }, 180, [240, -18], 'fly', 17.8);
  grab('qiansimen_bridge',  'Qiansimen Bridge Deck',        find('qiansimen') || { x: 270, z: -900 }, 20, [180, -8], 'fly', 16);
  grab('dongshuimen_br',    'Dongshuimen Bridge',           find('dongshuimen') || { x: 1020, z: -30 }, 30, [260, -10], 'fly', 20.5);
  grab('chaotianmen_br',    'Chaotianmen Arch Bridge',      find('chaotianmen_br', 'chaotianmen_bridge') || { x: 1770, z: -3130 }, 50, [210, -12], 'fly', 15);
  grab('liziba_monorail',   'Liziba Monorail Portal',       find('liziba') || { x: -4030, z: 410 }, 15, [180, 18], 'fly', 15);
  grab('cableway_yangtze',  'Yangtze River Cableway',       find('cableway_north', 'cableway') || { x: 890, z: -45 }, 40, [135, -8], 'fly', 16.5);
  grab('grand_theatre',     'Chongqing Grand Theatre',      find('grand_theatre', 'theatre') || { x: 620, z: -1400 }, 40, [160, -10], 'fly', 21);
  grab('great_hall',        'Great Hall of the People',     find('great_hall') || { x: -2520, z: -560 }, 25, [0, -8], 'fly', 15);
  grab('nanshan_skyline',   'Nanshan Panoramic Skyline',    find('nanshan') || { x: 1960, z: 1220 }, 40, [315, -10], 'fly', 20.5);
  grab('hillside_rain',     'Rainy Night Ordinary Street',  { x: -350, z: 220 }, 1.7, [45, 0], 'walk', 21.5, 'rain');
  return { pts, flat };
}

const { pts: VIEWPOINTS, flat: LANDMARK_MAP } = buildViewpoints();
const { browser, page, diag } = await launchAuditPage({ width: W, height: H });

const report = {
  url: BASE_URL,
  viewport: `${W}x${H}`,
  quality: QUALITY,
  viewpoints: [],
  benchmarks: [],
  geometryAudit: null,
  webglAudit: null,
  errors: null,
  passed: false,
};

try {
  const startUrl = `${BASE_URL}?mode=fly&q=${QUALITY}&ui=0&hour=15`;
  await page.goto(startUrl, { waitUntil: 'load', timeout: 60000 });
  const ready = await waitAppReady(page, 90000);
  if (!ready.ok) throw new Error(`App did not become ready: ${JSON.stringify(ready)}`);

  // Probe GPU renderer info & terrain sampler availability
  const sysInfo = await page.evaluate(() => {
    const a = window.__app;
    const gl = a.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const hasTerrain = !!(a.terrain || a.city?.terrain);
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
      quality: a.quality?.name,
      hasTerrain,
      hasLandmarks: !!a.landmarks,
      hasTraffic: !!a.traffic,
      hasPeople: !!a.people,
      hasBoats: !!a.boats,
    };
  });
  report.sysInfo = sysInfo;
  console.log('[INFO] sysInfo:', JSON.stringify(sysInfo));

  // Visit every viewpoint
  const benchIds = new Set(['jiefangbei_walk', 'hongyadong_night', 'raffles_sunset', 'hillside_rain']);
  for (const vp of VIEWPOINTS) {
    const res = await page.evaluate(async (v) => {
      const a = window.__app;
      const ter = a.terrain || a.city?.terrain;
      const sampleY = (x, z) => {
        if (ter && typeof ter.sample === 'function') return ter.sample(x, z);
        if (ter && typeof ter.heightAt === 'function') return ter.heightAt(x, z);
        if (typeof a.sampleTerrain === 'function') return a.sampleTerrain(x, z);
        return 0;
      };
      const ty = sampleY(v.x, v.z);
      const targetY = (Number.isFinite(ty) ? ty : 0) + v.dy;
      if (a.env) {
        if (typeof a.env.setHour === 'function') a.env.setHour(v.hour);
        if (typeof a.env.setWeather === 'function') {
          a.env.setWeather(v.weather || 'clear');
          if (a.env.weatherTarget) { Object.assign(a.env.weather, a.env.weatherTarget); a.env.weatherTarget = null; a.env._dirty = true; }
        }
      }
      if (typeof a.teleport === 'function') {
        a.teleport(v.x, targetY, v.z, v.look[0], v.look[1], v.mode);
      } else {
        a.player.mode = v.mode;
        a.player.setPose(v.x, targetY, v.z, v.look[0], v.look[1]);
      }
      if (typeof a.settle === 'function') await a.settle(30000);
      else if (typeof a.waitReady === 'function') await a.waitReady(30000);
      else await new Promise((r) => setTimeout(r, 1500));

      const info = a.renderer.info;
      const pose = a.player.getPose();
      return {
        id: v.id,
        label: v.label,
        terrainY: +ty.toFixed(2),
        pose,
        fps: Math.round(a.fps || 0),
        calls: info.render.calls,
        tris: info.render.triangles,
        geoms: info.memory.geometries,
        textures: info.memory.textures,
        stats: typeof a.stats === 'function' ? a.stats() : (typeof a.getStats === 'function' ? a.getStats() : null),
      };
    }, vp);

    if (benchIds.has(vp.id)) {
      const b = await page.evaluate((n) => (typeof window.__app.bench === 'function' ? window.__app.bench(n) : null), BENCH_FRAMES);
      res.bench = b;
      report.benchmarks.push({ id: vp.id, label: vp.label, ...b });
    }
    report.viewpoints.push(res);
    console.log(`[VP] ${vp.id}: terrainY=${res.terrainY} poseY=${res.pose.y} calls=${res.calls} tris=${res.tris}${res.bench ? ` bench=${res.bench.ms}ms (${(1000 / Math.max(0.1, res.bench.ms)).toFixed(1)} fps)` : ''}`);
  }

  // Programmatic NaN geometry & floating landmark anchor audit
  report.geometryAudit = await page.evaluate((lmMap) => {
    const a = window.__app;
    const ter = a.terrain || a.city?.terrain;
    const sampleY = (x, z) => {
      if (ter && typeof ter.sample === 'function') return ter.sample(x, z);
      if (ter && typeof ter.heightAt === 'function') return ter.heightAt(x, z);
      if (typeof a.sampleTerrain === 'function') return a.sampleTerrain(x, z);
      return NaN;
    };

    let meshCount = 0, nanMeshes = 0, emptyMeshes = 0;
    const nanSamples = [];
    const checkScene = (sc, sname) => {
      if (!sc) return;
      sc.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        meshCount++;
        const pos = o.geometry.attributes?.position;
        if (!pos || pos.count === 0) { emptyMeshes++; return; }
        const arr = pos.array;
        const step = Math.max(1, Math.floor(arr.length / 900));
        for (let i = 0; i < arr.length; i += step) {
          if (!Number.isFinite(arr[i])) {
            nanMeshes++;
            if (nanSamples.length < 5) nanSamples.push({ scene: sname, name: o.name || '(unnamed)', idx: i });
            break;
          }
        }
      });
    };
    checkScene(a.scenes?.opaque, 'opaque');
    checkScene(a.scenes?.shadow, 'shadow');
    checkScene(a.scenes?.forward, 'forward');

    // Check individual hero structural meshes world bounding boxes vs DEM terrain at anchor
    const landmarkChecks = [];
    const floatingLandmarks = [];
    const lmGroup = a.landmarks?.group || a.landmarks?.root || null;
    if (lmGroup) {
      lmGroup.updateMatrixWorld(true);
      lmGroup.traverse((m) => {
        if (!m.isMesh || !m.visible || !m.geometry) return;
        const nm = m.name || m.parent?.name || '(unnamed_hero)';
        // Skip small facade-mounted signage/clocks/lanterns/animated transit vehicles & suspended cables
        if (/cabin|cable|train|beam|crt-line|bogie|plaque|clock|beacon|lantern|sign/i.test(nm)) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        if (!bb) return;
        const b2 = bb.clone().applyMatrix4(m.matrixWorld);
        const hSpan = b2.max.y - b2.min.y;
        // Skip tiny mounted wall plaques/ornaments (< 6m tall) attached to larger hero facades
        if (hSpan < 6.0) return;
        const cx = 0.5 * (b2.min.x + b2.max.x), cz = 0.5 * (b2.min.z + b2.max.z);
        const ty = sampleY(cx, cz);
        const cornerYs = [
          sampleY(b2.min.x, b2.min.z), sampleY(b2.max.x, b2.min.z),
          sampleY(b2.min.x, b2.max.z), sampleY(b2.max.x, b2.max.z), ty,
        ].filter(Number.isFinite);
        const minTerrainY = cornerYs.length ? Math.min(...cornerYs) : NaN;
        const gap = Number.isFinite(ty) ? +(b2.min.y - ty).toFixed(2) : null;
        const gapMinCorner = Number.isFinite(minTerrainY) ? +(b2.min.y - minTerrainY).toFixed(2) : null;
        const rec = { name: nm, cx: +cx.toFixed(1), cz: +cz.toFixed(1), boxMinY: +b2.min.y.toFixed(2), boxMaxY: +b2.max.y.toFixed(2), terrainCenterY: Number.isFinite(ty) ? +ty.toFixed(2) : null, gapCenter: gap, gapMinCorner };
        landmarkChecks.push(rec);
        if (gap !== null && gap > 2.5) {
          floatingLandmarks.push(rec);
        }
      });
    }

    // Also evaluate terrain at every landmarks.json anchor
    const anchorSamples = {};
    for (const [k, v] of Object.entries(lmMap)) {
      const ty = sampleY(v.x, v.z);
      anchorSamples[k] = { x: +v.x.toFixed(1), z: +v.z.toFixed(1), demY: Number.isFinite(ty) ? +ty.toFixed(2) : null, jsonY: v.terrain_y ?? v.baseY ?? v.y ?? null };
    }
    return { meshCount, nanMeshes, nanSamples, emptyMeshes, landmarkChecks, floatingLandmarks, anchorSamples };
  }, LANDMARK_MAP);

  report.webglAudit = await page.evaluate(() => window.__webglAudit);
  report.errors = {
    consoleErrors: [...new Set(diag.consoleErrors)],
    consoleWarnings: [...new Set(diag.consoleWarnings)],
    pageErrors: [...new Set(diag.pageErrors)],
    httpErrors: diag.httpErrors,
    failedRequests: diag.failedRequests,
  };

  const errCount =
    report.errors.consoleErrors.length +
    report.errors.pageErrors.length +
    report.errors.httpErrors.length +
    report.errors.failedRequests.length +
    (report.webglAudit?.shaderErrors?.length || 0) +
    (report.webglAudit?.shaderWarnings?.length || 0) +
    (report.webglAudit?.programErrors?.length || 0) +
    (report.webglAudit?.programWarnings?.length || 0);

  const nanCount = report.geometryAudit?.nanMeshes || 0;
  const floatCount = report.geometryAudit?.floatingLandmarks?.length || 0;
  const worstBenchMs = report.benchmarks.length ? Math.max(...report.benchmarks.map((b) => b.ms || 0)) : 0;

  report.summary = {
    errCount,
    nanMeshes: nanCount,
    floatingLandmarks: floatCount,
    worstBenchMs: +worstBenchMs.toFixed(2),
    worstBenchFps: worstBenchMs > 0 ? +(1000 / worstBenchMs).toFixed(1) : null,
  };
  report.passed = errCount === 0 && nanCount === 0 && floatCount === 0;

  console.log('\n=== Runtime Audit Summary ===');
  console.log(JSON.stringify(report.summary, null, 2));
  if (errCount > 0) console.log('[ERRORS]', JSON.stringify({ ...report.errors, webgl: report.webglAudit }, null, 2));
  if (floatCount > 0) console.log('[FLOATING LANDMARKS]', JSON.stringify(report.geometryAudit.floatingLandmarks, null, 2));

  fs.writeFileSync(path.join(__dir, 'last_runtime_report.json'), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

exit(report.passed ? 0 : 1);
