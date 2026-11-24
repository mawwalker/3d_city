#!/usr/bin/env node
// Chongqing 3D — Phase 4 Live Rendered-Mesh Raycaster Complex-Terrain Defect Scanner!
// Visits 10 nasty steep-terrain zones across Chongqing, builds the EXACT rendered groundGeom + deckGeom
// triangles for every loaded tile + uses actual rendered hero-bridges / hero-landmarks meshes, and raycasts:
//   1. ALL 4 wheel corners + front/rear bumpers + center of EVERY moving vehicle (traffic.js)
//   2. ALL 4 wheel corners of EVERY parked car (street.js)
//   3. ALL street props (guardrails, bollards, shelters, lamps, signals)
//   4. Actual rendered ground road/sidewalk triangle cross-tilt angles
//   5. Hero bridge abutment-to-road step transitions
//
// Usage: node scan_complex_terrain_live.mjs [--url http://127.0.0.1:8775/]
import fs from 'node:fs';
import path from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchAuditPage, waitAppReady, loadSiteJSON, parseArg } from './pw_helper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = parseArg(argv, 'url', 'http://127.0.0.1:8775/');
const ROOT = parseArg(argv, 'root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));

const ZONES = [
  { id: 'shibati_kaixuan',     label: '十八梯/凯旋路/储奇门',     x: -380,  z: 688 },
  { id: 'hongyadong_kuixing',  label: '洪崖洞/沧白路/魁星楼',     x: 40,    z: -460 },
  { id: 'jiefangbei_slopes',   label: '解放碑/临江门/隧道口',     x: -200,  z: -260 },
  { id: 'baixiangju_dsm',      label: '白象居/东水门/索道北站',   x: 920,   z: 100 },
  { id: 'nanbin_cw_south',     label: '南滨路/龙门浩/索道南站',   x: 1650,  z: 520 },
  { id: 'caiyuanba_sujiaba',   label: '菜园坝/苏家坝立交',       x: -2450, z: 2200 },
  { id: 'liziba_fotuguan',     label: '李子坝/佛图关沿线',       x: -3825, z: 490 },
  { id: 'qiansimen_jbz',       label: '千厮门大桥/江北嘴',       x: 140,   z: -977 },
  { id: 'chaotianmen_bridge',  label: '朝天门大桥引桥',           x: 480,   z: -3135 },
  { id: 'huangjuewan',         label: '黄桷湾立交',               x: 4267,  z: -1630 },
];

const lm = loadSiteJSON(ROOT, 'landmarks.json') || {};
const { browser, page, diag } = await launchAuditPage({ width: 1280, height: 720 });

try {
  await page.goto(`${BASE_URL}?pos=0,280,0&look=0,-30&mode=fly&hour=15&ui=0&q=high`, { waitUntil: 'load', timeout: 60000 });
  const ready = await waitAppReady(page, 90000);
  if (!ready.ok) throw new Error('App not ready');

  // Install fast spatial-grid triangle vertical-raycaster inside browser using exact buildGround/buildDecks + hero-bridges!
  await page.evaluate(async () => {
    const { fetchBinary, parseTile, decodePolys, decodeLines, SEC } = await import('/src/world/data.js');
    const { buildGround } = await import('/src/world/groundGeom.js');
    const { buildDecks } = await import('/src/world/deckGeom.js');

    // Fast 2D grid-accelerated vertical raycaster against arbitrary triangle soup (pos4 or pos3 + idx + world offset)
    class SurfGrid {
      constructor(cell = 16) { this.cell = cell; this.bins = new Map(); this.tris = []; }
      addSoup(pos, stride, idx, ox, oy, oz, tag, clsArr = null, maxCls = 999) {
        const C = this.cell;
        for (let i = 0; i < idx.length; i += 3) {
          const i0 = idx[i] * stride, i1 = idx[i + 1] * stride, i2 = idx[i + 2] * stride;
          const cls = clsArr ? clsArr(i0) : (stride === 4 ? Math.round(pos[i0 + 3]) : -1);
          if (cls > maxCls) continue;
          const x0 = pos[i0] + ox, y0 = pos[i0 + 1] + oy, z0 = pos[i0 + 2] + oz;
          const x1 = pos[i1] + ox, y1 = pos[i1 + 1] + oy, z1 = pos[i1 + 2] + oz;
          const x2 = pos[i2] + ox, y2 = pos[i2 + 1] + oy, z2 = pos[i2 + 2] + oz;
          // Skip vertical / downward faces (only walkable/drivable upward surfaces)
          const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
          const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
          const ny = az * bx - ax * bz;
          const nx = ay * bz - az * by, nz = ax * by - ay * bx;
          const area2 = Math.hypot(nx, ny, nz);
          if (area2 < 1e-4) continue;
          const upNy = Math.abs(ny) / area2;
          if (upNy < 0.35) continue; // skip near-vertical retaining wall faces
          const tid = this.tris.length;
          this.tris.push([x0, y0, z0, x1, y1, z1, x2, y2, z2, upNy, tag, cls]);
          const gx0 = Math.floor(Math.min(x0, x1, x2) / C), gx1 = Math.floor(Math.max(x0, x1, x2) / C);
          const gz0 = Math.floor(Math.min(z0, z1, z2) / C), gz1 = Math.floor(Math.max(z0, z1, z2) / C);
          for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
            const k = gx * 100003 + gz;
            let b = this.bins.get(k); if (!b) this.bins.set(k, b = []);
            b.push(tid);
          }
        }
      }
      // Return all surface hits at (x, z) sorted descending by y
      hitsAt(x, z) {
        const b = this.bins.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
        if (!b) return [];
        const out = [];
        for (let k = 0; k < b.length; k++) {
          const T = this.tris[b[k]];
          const x0 = T[0], z0 = T[2], x1 = T[3], z1 = T[5], x2 = T[6], z2 = T[8];
          const v0x = x2 - x0, v0z = z2 - z0, v1x = x1 - x0, v1z = z1 - z0, v2x = x - x0, v2z = z - z0;
          const d00 = v0x * v0x + v0z * v0z, d01 = v0x * v1x + v0z * v1z, d11 = v1x * v1x + v1z * v1z;
          const d20 = v2x * v0x + v2z * v0z, d21 = v2x * v1x + v2z * v1z;
          const denom = d00 * d11 - d01 * d01;
          if (Math.abs(denom) < 1e-8) continue;
          const u = (d11 * d20 - d01 * d21) / denom;
          const v = (d00 * d21 - d01 * d20) / denom;
          if (u >= -1e-4 && v >= -1e-4 && u + v <= 1.0001) {
            const y = T[1] + (T[7] - T[1]) * u + (T[4] - T[1]) * v;
            out.push({ y, ny: T[9], tag: T[10], cls: T[11] });
          }
        }
        out.sort((a, b) => b.y - a.y);
        return out;
      }
      // Nearest surface hit to expected y (within window) or highest below y + 6
      nearestSurface(x, z, refY) {
        const hs = this.hitsAt(x, z);
        if (!hs.length) return null;
        let best = null, bd = 1e9;
        for (const h of hs) {
          const d = Math.abs(h.y - refY);
          if (d < bd) { bd = d; best = h; }
        }
        return best;
      }
    }

    // Pre-index hero bridges actual rendered geometry once!
    const heroGrid = new SurfGrid(16);
    const a = window.__app;
    a.landmarks?.root?.updateMatrixWorld(true);
    a.landmarks?.root?.traverse((m) => {
      if (!m.isMesh || !m.geometry) return;
      if (!/bridge|sujiaba|huangjuewan|viaduct|monorail|hongyadong|plaza/i.test(m.name || m.parent?.name || '')) return;
      const pos = m.geometry.attributes?.position;
      const idx = m.geometry.index;
      if (!pos || !idx || !pos.array || !idx.array) return;
      // Transform positions into world coords
      const arr = pos.array;
      const e = m.matrixWorld.elements;
      const wpos = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i], y = arr[i + 1], z = arr[i + 2];
        wpos[i]     = e[0] * x + e[4] * y + e[8]  * z + e[12];
        wpos[i + 1] = e[1] * x + e[5] * y + e[9]  * z + e[13];
        wpos[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      heroGrid.addSoup(wpos, 3, idx.array, 0, 0, 0, 'hero:' + (m.name || m.parent?.name || 'lm'));
    });

    const tileCache = new Map();
    async function loadTileSurf(ti, tj) {
      const key = `${ti}_${tj}`;
      if (tileCache.has(key)) return tileCache.get(key);
      const g = a.city.grid;
      const cx = g.x0 + (ti + 0.5) * g.tile;
      const cz = -(g.y0 + (tj + 0.5) * g.tile);
      const sg = new SurfGrid(16);
      let roadTiltStats = { tris: 0, gt5: 0, gt10: 0, gt15: 0, gt20: 0, maxDeg: 0 };
      let deckClips = 0;
      try {
        const buf = await fetchBinary(`tiles/${ti}_${tj}.bin`);
        const secs = parseTile(buf);
        if (secs[SEC.ground]) {
          const gp = decodePolys(secs[SEC.ground]);
          const res = buildGround(gp, g.tile, { cx, cz, terrain: a.terrain });
          // Index roads/sidewalks/plazas/parks (cls <= 22, skipping vertical kerb/wall cls 30..33)
          sg.addSoup(res.pos, 4, res.index, cx, 0, cz, 'ground', null, 22);
          // Compute rendered carriageway (cls === 1) triangle tilt stats (skipping cls=2/5 mountain hillsides and cls 30..33 vertical walls!)
          const pos = res.pos, idx = res.index;
          for (let i = 0; i < idx.length; i += 3) {
            const i0 = idx[i] * 4, i1 = idx[i + 1] * 4, i2 = idx[i + 2] * 4;
            const c0 = Math.round(pos[i0 + 3]);
            if (c0 !== 1) continue;
            const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
            const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
            const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
            const len = Math.hypot(nx, ny, nz);
            if (len < 1e-4) continue;
            const deg = Math.acos(Math.min(1, Math.abs(ny) / len)) * 180 / Math.PI;
            if (deg > 75) continue; // skip degenerate kerb-edge sliver
            roadTiltStats.tris++;
            if (deg > 5) roadTiltStats.gt5++;
            if (deg > 10) roadTiltStats.gt10++;
            if (deg > 15) roadTiltStats.gt15++;
            if (deg > 20) roadTiltStats.gt20++;
            if (deg > roadTiltStats.maxDeg) roadTiltStats.maxDeg = deg;
          }
        }
        if (secs[SEC.bridges]) {
          const roads = secs[SEC.roads] ? decodeLines(secs[SEC.roads]) : null;
          const dk = buildDecks(secs[SEC.bridges], g.tile, roads, { cx, cz, terrain: a.terrain });
          if (dk && dk.mesh) {
            sg.addSoup(dk.mesh.pos, 4, dk.mesh.index, cx, 0, cz, 'deck', null, 22);
            const pos = dk.mesh.pos;
            for (let i = 0; i < pos.length; i += 4) {
              const c = Math.round(pos[i + 3]);
              if (c > 12) continue;
              const wx = pos[i] + cx, wy = pos[i + 1], wz = pos[i + 2] + cz;
              const ty = a.terrain.sample(wx, wz);
              if (wy < ty - 0.15) deckClips++;
            }
          }
        }
      } catch (e) { console.warn('[loadTileSurf]', key, e.message); }
      const entry = { sg, roadTiltStats, deckClips };
      if (tileCache.size > 10) tileCache.clear();
      tileCache.set(key, entry);
      return entry;
    }

    window.__phase4 = { heroGrid, loadTileSurf, clearCache: () => tileCache.clear() };
  });

  const zoneResults = [];
  const allBuriedMoving = [];
  const allFloatMoving = [];
  const allBridgeMismatch = [];
  const allBuriedParked = [];
  const allBadProps = [];

  for (const z of ZONES) {
    const res = await page.evaluate(async (zone) => {
      const a = window.__app;
      const ter = a.terrain;
      const ty0 = ter.sample(zone.x, zone.z);
      a.player.mode = 'fly';
      a.player.setPose(zone.x, Math.max(ty0, 0) + 120, zone.z, 0, -35);
      await a.settle(35000);
      // Warm up traffic for 20s in this zone
      let t = a.time;
      for (let i = 0; i < 400; i++) { t += 0.05; a.traffic?.update(0.05, t, a.camera, 15); }
      a.time = t;

      const g = a.city.grid;
      const ti0 = Math.floor((zone.x - g.x0) / g.tile);
      const tj0 = Math.floor((-zone.z - g.y0) / g.tile);
      const loadedGrids = new Map();
      window.__phase4.clearCache();
      let roadTris = 0, roadGt10 = 0, roadGt15 = 0, roadGt20 = 0, maxRoadDeg = 0, deckSurfClips = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        // Only load tiles intersecting the 550m zone radius
        const tx = g.x0 + (ti0 + di + 0.5) * g.tile, tz = -(g.y0 + (tj0 + dj + 0.5) * g.tile);
        if (Math.abs(tx - zone.x) > 1050 || Math.abs(tz - zone.z) > 1050) continue;
        const ent = await window.__phase4.loadTileSurf(ti0 + di, tj0 + dj);
        loadedGrids.set(`${ti0 + di}_${tj0 + dj}`, ent.sg);
        roadTris += ent.roadTiltStats.tris;
        roadGt10 += ent.roadTiltStats.gt10;
        roadGt15 += ent.roadTiltStats.gt15;
        roadGt20 += ent.roadTiltStats.gt20;
        if (ent.roadTiltStats.maxDeg > maxRoadDeg) maxRoadDeg = ent.roadTiltStats.maxDeg;
        deckSurfClips += ent.deckClips;
      }

      const surfAt = (wx, wz, refY) => {
        const ti = Math.floor((wx - g.x0) / g.tile), tj = Math.floor((-wz - g.y0) / g.tile);
        const sg = loadedGrids.get(`${ti}_${tj}`);
        const h1 = sg ? sg.nearestSurface(wx, wz, refY) : null;
        const h2 = window.__phase4.heroGrid.nearestSurface(wx, wz, refY);
        if (!h1) return h2;
        if (!h2) return h1;
        return Math.abs(h1.y - refY) <= Math.abs(h2.y - refY) ? h1 : h2;
      };

      // 1. Audit EVERY moving vehicle within 550m using its LITERAL rendered 4-wheel GPU instanceMatrix (pitch + roll)!
      // Position camera overhead looking straight down so 100% of cars within 550m are rendered into k.hi / k.lo!
      a.player.setPose(zone.x, Math.max(ty0, 0) + 520, zone.z, 0, -88);
      a.camera.updateMatrixWorld(true);
      a.traffic?._draw(a.camera, 520);

      let movTot = 0, movBuried = 0, movSevereBuried = 0, movFloat = 0, movHeroMismatch = 0, movInHongyadong = 0, movInRaffles = 0;
      const buriedEx = [], floatEx = [], bridgeEx = [], heroClipEx = [];

      for (const kObj of a.traffic?.kinds || []) {
        const len = kObj.K?.len || 4.6, wid = kObj.K?.wid || 1.85;
        const pts = [
          [0, 0],
          [len * 0.34, wid * 0.43], [len * 0.34, -wid * 0.43],
          [-len * 0.34, wid * 0.43], [-len * 0.34, -wid * 0.43],
          [len * 0.48, 0], [-len * 0.48, 0],
        ];
        for (const [im, cnt] of [[kObj.hi, kObj.nh], [kObj.lo, kObj.nl]]) {
          const arr = im.instanceMatrix.array;
          for (let i = 0; i < cnt; i++) {
            const b = i * 16;
            const vx = arr[b + 12], vy = arr[b + 13], vz = arr[b + 14];
            if (Math.hypot(vx - zone.x, vz - zone.z) > 550) continue;
            if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) continue;
            movTot++;
            // Exact rendered basis: col 0 = forward (X), col 2 = right with roll (Z)
            const xx = arr[b + 0], xy = arr[b + 1], xz = arr[b + 2];
            const zx = arr[b + 8], zy = arr[b + 9], zz = arr[b + 10];
            let minClear = 1e9, maxClear = -1e9, hitTag = '';
            let centerSurf = null;
            for (let pi = 0; pi < pts.length; pi++) {
              const [fl, rl] = pts[pi];
              const px = vx + xx * fl + zx * rl;
              const py = vy + xy * fl + zy * rl;
              const pz = vz + xz * fl + zz * rl;
              const hit = surfAt(px, pz, py);
              if (!hit) continue;
              if (pi === 0) centerSurf = hit;
              const clr = py - hit.y;
              if (clr < minClear) { minClear = clr; hitTag = hit.tag; }
              if (clr > maxClear) maxClear = clr;
            }
            if (minClear < 1e8) {
              if (minClear < -0.25) {
                movBuried++;
                if (minClear < -0.40) movSevereBuried++;
                if (buriedEx.length < 8) buriedEx.push({ x: +vx.toFixed(1), z: +vz.toFixed(1), vy: +vy.toFixed(2), minClear: +minClear.toFixed(2), maxClear: +maxClear.toFixed(2), hitTag, zone: zone.id });
              }
              if (maxClear > 0.45) {
                movFloat++;
                if (floatEx.length < 8) floatEx.push({ x: +vx.toFixed(1), z: +vz.toFixed(1), vy: +vy.toFixed(2), minClear: +minClear.toFixed(2), maxClear: +maxClear.toFixed(2), hitTag, zone: zone.id });
              }
              if (centerSurf && centerSurf.tag.startsWith('hero:') && Math.abs(vy - centerSurf.y) > 1.5) {
                movHeroMismatch++;
                if (bridgeEx.length < 6) bridgeEx.push({ x: +vx.toFixed(1), z: +vz.toFixed(1), vy: +vy.toFixed(2), heroY: +centerSurf.y.toFixed(2), diff: +(vy - centerSurf.y).toFixed(2), tag: centerSurf.tag, zone: zone.id });
              }
            }
            // Check Hongyadong main building interior & Raffles podium interior intrusion
            if (centerSurf && /hongyadong-main/i.test(centerSurf.tag) && vy < centerSurf.y - 2.0) {
              movInHongyadong++;
              if (heroClipEx.length < 6) heroClipEx.push({ hero: 'hongyadong', x: +vx.toFixed(1), z: +vz.toFixed(1), vy: +vy.toFixed(2), surfY: +centerSurf.y.toFixed(2), zone: zone.id });
            }
            // Raffles City podium core footprint around (975, -835)
            if (Math.hypot(vx - 975, vz - (-835)) < 68) {
              movInRaffles++;
              if (heroClipEx.length < 6) heroClipEx.push({ hero: 'raffles', x: +vx.toFixed(1), z: +vz.toFixed(1), vy: +vy.toFixed(2), zone: zone.id });
            }
          }
        }
      }

      // 2. Audit EVERY parked car within 550m (4 wheel corners!)
      let pkTot = 0, pkBuried = 0, pkFloat = 0;
      const pkEx = [];
      for (const o of a.street?.tiles?.values() || []) {
        for (const c of o.cars || []) {
          const im = c.im, arr = im.instanceMatrix.array;
          for (let i = 0; i < im.count; i++) {
            const b = i * 16;
            const cx = arr[b + 12], cy = arr[b + 13], cz = arr[b + 14];
            if (Math.hypot(cx - zone.x, cz - zone.z) > 550) continue;
            pkTot++;
            // Local X axis = col 0 (forward), Local Z axis = col 2 (right)
            const xx = arr[b + 0], xy = arr[b + 1], xz = arr[b + 2];
            const zx = arr[b + 8], zy = arr[b + 9], zz = arr[b + 10];
            let minC = 1e9, maxC = -1e9;
            for (const [fl, rl] of [[1.6, 0.8], [1.6, -0.8], [-1.6, 0.8], [-1.6, -0.8]]) {
              const px = cx + xx * fl + zx * rl;
              const py = cy + xy * fl + zy * rl;
              const pz = cz + xz * fl + zz * rl;
              const hit = surfAt(px, pz, py);
              if (!hit) continue;
              const clr = py - hit.y;
              if (clr < minC) minC = clr;
              if (clr > maxC) maxC = clr;
            }
            if (minC < -0.25) {
              pkBuried++;
              if (pkEx.length < 6) pkEx.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), y: +cy.toFixed(2), minClear: +minC.toFixed(2), maxClear: +maxC.toFixed(2), zone: zone.id });
            }
            if (maxC > 0.40) pkFloat++;
          }
        }
      }

      // 3. Audit street props (lamps, guardrails, bollards, shelters, signals) within 450m
      let propTot = 0, propFloat = 0, propBuried = 0;
      const propEx = [];
      for (const o of a.street?.tiles?.values() || []) {
        const carSet = new Set((o.cars || []).map((c) => c.im));
        for (const obj of o.objs || []) {
          if (!obj.isInstancedMesh || carSet.has(obj) || obj.material === a.street.depthMat) continue;
          const arr = obj.instanceMatrix.array;
          for (let i = 0; i < obj.count; i++) {
            const b = i * 16;
            const px = arr[b + 12], py = arr[b + 13], pz = arr[b + 14];
            if (Math.hypot(px - zone.x, pz - zone.z) > 450) continue;
            propTot++;
            const hit = surfAt(px, pz, py);
            if (!hit) continue;
            const clr = py - hit.y;
            if (clr > 0.35) {
              propFloat++;
              if (propEx.length < 5) propEx.push({ kind: 'float', x: +px.toFixed(1), z: +pz.toFixed(1), py: +py.toFixed(2), surfY: +hit.y.toFixed(2), clr: +clr.toFixed(2), zone: zone.id });
            } else if (clr < -0.50) {
              propBuried++;
              if (propEx.length < 5) propEx.push({ kind: 'buried', x: +px.toFixed(1), z: +pz.toFixed(1), py: +py.toFixed(2), surfY: +hit.y.toFixed(2), clr: +clr.toFixed(2), zone: zone.id });
            }
          }
        }
      }

      return {
        zone: zone.id,
        label: zone.label,
        renderedRoadTris: { total: roadTris, gt10deg: roadGt10, gt15deg: roadGt15, gt20deg: roadGt20, maxDeg: +maxRoadDeg.toFixed(1) },
        deckVertsBelowDEM: deckSurfClips,
        moving: { tot: movTot, buried: movBuried, severeBuried: movSevereBuried, float: movFloat, heroMismatch: movHeroMismatch, inHongyadong: movInHongyadong, inRaffles: movInRaffles, buriedEx, floatEx, bridgeEx, heroClipEx },
        parked: { tot: pkTot, buried: pkBuried, float: pkFloat, pkEx },
        props: { tot: propTot, float: propFloat, buried: propBuried, propEx },
      };
    }, z);

    zoneResults.push(res);
    allBuriedMoving.push(...res.moving.buriedEx);
    allFloatMoving.push(...res.moving.floatEx);
    allBridgeMismatch.push(...res.moving.bridgeEx);
    allBuriedParked.push(...res.parked.pkEx);
    allBadProps.push(...res.props.propEx);

    console.log(`[ZONE] ${z.id.padEnd(20)} | road>10°:${res.renderedRoadTris.gt10deg}/${res.renderedRoadTris.total} (max ${res.renderedRoadTris.maxDeg}°) | deckClipVerts:${res.deckVertsBelowDEM} | mov:${res.moving.tot} (bur:${res.moving.buried} [sev:${res.moving.severeBuried}], flt:${res.moving.float}, brErr:${res.moving.heroMismatch}, hyd:${res.moving.inHongyadong}, raf:${res.moving.inRaffles}) | park:${res.parked.tot} (bur:${res.parked.buried}, flt:${res.parked.float}) | props:${res.props.tot} (flt:${res.props.float}, bur:${res.props.buried})`);
  }

  // 4. Audit Hero Bridge Abutment step gaps against DEM/roads + Tunnel Portals + Terrain Core loaded check
  const sysCheck = await page.evaluate((bridges) => {
    const a = window.__app;
    const abutments = [];
    for (const b of bridges || []) {
      const [x0, z0] = b.p0 || [b.x, b.z];
      const [x1, z1] = b.p1 || [b.x, b.z];
      const t0 = a.terrain.sample(x0, z0);
      const t1 = a.terrain.sample(x1, z1);
      const s0 = a.collision.surfaceBelow(x0, z0, 500);
      const s1 = a.collision.surfaceBelow(x1, z1, 500);
      abutments.push({
        id: b.id, deckY: b.deckY,
        p0: [x0, z0], dem0: +t0.toFixed(1), surf0: +s0.toFixed(1), step0: +(s0 - t0).toFixed(1),
        p1: [x1, z1], dem1: +t1.toFixed(1), surf1: +s1.toFixed(1), step1: +(s1 - t1).toFixed(1),
      });
    }
    let tunnelMeshCount = 0, tunnelNan = 0;
    a.scenes?.opaque?.traverse((m) => {
      if (m.isMesh && /^tunnel-portals-/i.test(m.name || '')) {
        tunnelMeshCount++;
        const pos = m.geometry?.attributes?.aPos || m.geometry?.attributes?.position;
        if (pos?.array) {
          for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) { tunnelNan++; break; }
        }
      }
    });
    return {
      abutments,
      coreLoaded: !!(a.terrain?.core && a.terrain?.coreData),
      coreCell: a.terrain?.core?.cell ?? null,
      tunnelPortalsLoaded: a.tunnels?.portals?.length ?? 0,
      tunnelMeshCount,
      tunnelNan,
    };
  }, lm.bridges);
  const abutmentReport = sysCheck.abutments;

  const movTot = zoneResults.reduce((s, r) => s + r.moving.tot, 0);
  const movBur = zoneResults.reduce((s, r) => s + r.moving.buried, 0);
  const movSev = zoneResults.reduce((s, r) => s + r.moving.severeBuried, 0);
  const movFlt = zoneResults.reduce((s, r) => s + r.moving.float, 0);
  const pkTot = zoneResults.reduce((s, r) => s + r.parked.tot, 0);
  const pkBur = zoneResults.reduce((s, r) => s + r.parked.buried, 0);
  const summary = {
    zonesScanned: zoneResults.length,
    coreLoaded: sysCheck.coreLoaded,
    coreCell: sysCheck.coreCell,
    tunnelPortalsLoaded: sysCheck.tunnelPortalsLoaded,
    tunnelMeshCount: sysCheck.tunnelMeshCount,
    tunnelNan: sysCheck.tunnelNan,
    movingTotal: movTot,
    movingBuriedWheels: movBur,
    movingBuriedPct: movTot ? +(movBur * 100 / movTot).toFixed(2) : 0,
    movingSevereBuried: movSev,
    movingFloatWheels: movFlt,
    movingFloatPct: movTot ? +(movFlt * 100 / movTot).toFixed(2) : 0,
    movingHeroBridgeMismatch: zoneResults.reduce((s, r) => s + r.moving.heroMismatch, 0),
    movingInHongyadong: zoneResults.reduce((s, r) => s + r.moving.inHongyadong, 0),
    movingInRaffles: zoneResults.reduce((s, r) => s + r.moving.inRaffles, 0),
    parkedTotal: pkTot,
    parkedBuriedWheels: pkBur,
    parkedBuriedPct: pkTot ? +(pkBur * 100 / pkTot).toFixed(2) : 0,
    parkedFloatWheels: zoneResults.reduce((s, r) => s + r.parked.float, 0),
    propsTotal: zoneResults.reduce((s, r) => s + r.props.tot, 0),
    propsFloat: zoneResults.reduce((s, r) => s + r.props.float, 0),
    propsBuried: zoneResults.reduce((s, r) => s + r.props.buried, 0),
    deckVertsBelowDEM: zoneResults.reduce((s, r) => s + r.deckVertsBelowDEM, 0),
  };

  console.log('\n=== LIVE RAYCAST COMPLEX-TERRAIN SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  const outPath = path.join(__dir, 'complex_terrain_live_report.json');
  fs.writeFileSync(outPath, JSON.stringify({ summary, zones: zoneResults, abutments: abutmentReport, worstBuriedMoving: allBuriedMoving.sort((a, b) => a.minClear - b.minClear).slice(0, 25), worstFloatMoving: allFloatMoving.sort((a, b) => b.maxClear - a.maxClear).slice(0, 20), bridgeMismatches: allBridgeMismatch.slice(0, 20), worstBuriedParked: allBuriedParked.sort((a, b) => a.minClear - b.minClear).slice(0, 20), worstProps: allBadProps.slice(0, 20), errors: diag }, null, 2));
} finally {
  await browser.close();
}
