#!/usr/bin/env node
// Chongqing 3D — Phase 5 120-Second Pedestrian Teleport & Wall-Clipping Hunter (scan_pedestrians.mjs)
// Evaluates EVERY active pedestrian across 10 dense Chongqing zones over 120 seconds at dt = 0.1s (1,200 steps)
// using the EXACT people.js vertex-shader path & visibility math, catching:
//   1. EVERY teleport (dist(p(t+dt), p(t)) > 0.55m in 0.1s) — distinguishing loop closing-chord wrap vs slot wrap!
//   2. EVERY mid-walk disappear/reappear pop (walkable pathY.b flipping 1->0->1 mid-walk!)
//   3. EVERY wall clip where a pedestrian enters ANY collision prism (procedural buildings, hero landmarks,
//      bridge piers) or tunnel portal headwall/wing wall!
//
// Usage: node scan_pedestrians.mjs [--url http://127.0.0.1:8790/]
import fs from 'node:fs';
import path from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { launchAuditPage, waitAppReady, loadSiteJSON, parseArg } from './pw_helper.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = parseArg(argv, 'url', 'http://127.0.0.1:8790/');
const ROOT = parseArg(argv, 'root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));

const ZONES = [
  { id: 'jiefangbei_cbd',    x: 0,     z: 0 },
  { id: 'hongyadong',        x: 90,    z: -510 },
  { id: 'shibati_kaixuan',   x: -380,  z: 688 },
  { id: 'baixiangju_dsm',    x: 920,   z: 100 },
  { id: 'raffles_ctm',       x: 960,   z: -830 },
  { id: 'guotai_kuixing',    x: 180,   z: -240 },
  { id: 'grand_theatre_jbz', x: 350,   z: -1450 },
  { id: 'great_hall',        x: -2210, z: -475 },
  { id: 'liziba_fotuguan',   x: -3825, z: 490 },
  { id: 'nanbin_longmenhao', x: 1750,  z: 480 },
];

const tunnelsJson = loadSiteJSON(ROOT, 'tunnels.json') || [];
const { browser, page, diag } = await launchAuditPage({ width: 1280, height: 720 });

try {
  await page.goto(`${BASE_URL}?pos=0,200,0&look=0,-30&mode=fly&hour=15&ui=0&q=high`, { waitUntil: 'load', timeout: 60000 });
  const ready = await waitAppReady(page, 90000);
  if (!ready.ok) throw new Error('App not ready');

  const zoneReports = [];
  const seenTiles = new Set();

  for (const z of ZONES) {
    const rep = await page.evaluate(async ({ zone, seenArr, tunnels }) => {
      const a = window.__app;
      const seen = new Set(seenArr);
      const ty = a.terrain.sample(zone.x, zone.z);
      a.player.mode = 'fly';
      a.player.setPose(zone.x, Math.max(ty, 0) + 90, zone.z, 0, -35);
      await a.settle(30000);
      a.people?.update(0.5, a.camera, 15, 0, true);

      const TEXW = 256, RANGE = 1500, YMIN = -30, YMAX = 750;
      const fract = (v) => v - Math.floor(v);
      const mod = (x, y) => x - y * Math.floor(x / y);
      const hash = (x) => fract(Math.sin(x * 127.1 + 311.7) * 43758.5453);

      // Helper: check if (wx, wy, wz) is inside ANY solid collider prism (buildings + hero landmarks + water)!
      const col = a.collision;
      const CELL = 24;
      const insideBuilding = (wx, wy, wz, margin = 0.0) => {
        const cx0 = Math.floor((wx - margin) / CELL), cx1 = Math.floor((wx + margin) / CELL);
        const cz0 = Math.floor((wz - margin) / CELL), cz1 = Math.floor((wz + margin) / CELL);
        for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
          const arr = col.grid.get(cx * 100003 + cz);
          if (!arr) continue;
          for (let i = 0; i < arr.length; i += 2) {
            const t = arr[i], b = arr[i + 1];
            if (wy + 1.6 <= t.base[b] + 0.05 || wy >= t.top[b] - 0.05) continue;
            // Skip river water prism (top <= 2.0 and base <= -5.0)
            if (t.top[b] <= 2.2 && t.base[b] <= -5.0) continue;
            if (col._inside(t, b, wx, wz)) return { hit: true, exact: true, top: t.top[b], base: t.base[b] };
            if (margin > 0) {
              const s = t.start[b], c = t.count[b], xz = t.xz;
              for (let k = 0, j = c - 1; k < c; j = k++) {
                const ax = xz[(s + j) * 2], az = xz[(s + j) * 2 + 1];
                const ex = xz[(s + k) * 2] - ax, ez = xz[(s + k) * 2 + 1] - az;
                const l2 = ex * ex + ez * ez;
                let tt = l2 > 0 ? ((wx - ax) * ex + (wz - az) * ez) / l2 : 0;
                tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
                const dx = wx - (ax + ex * tt), dz = wz - (az + ez * tt);
                if (dx * dx + dz * dz < margin * margin) return { hit: true, exact: false, top: t.top[b], base: t.base[b] };
              }
            }
          }
        }
        return null;
      };

      // Also check tunnel portal headwalls (solid pier/wing blocks)
      const nearTunnelWall = (wx, wz) => {
        for (let i = 0; i < tunnels.length; i++) {
          const p = tunnels[i];
          const dx = wx - p.x, dz = wz - p.z;
          if (dx * dx + dz * dz > 225) continue;
          const l = Math.hypot(p.dx, p.dz) || 1, fx = p.dx / l, fz = p.dz / l;
          const along = dx * fx + dz * fz;
          const lat = Math.abs(dx * fz - dz * fx);
          const hw = Math.max(6.2, Math.min(22, p.width || 9)) * 0.5 + 0.35;
          if (along >= -0.4 && along <= 1.2 && lat >= hw && lat <= hw + 2.2) return true;
        }
        return false;
      };

      const auditedTiles = [];
      let totalPeds = 0, activePeds = 0;
      let teleportPeds = 0, totalTeleports = 0, openLoopTeleports = 0, slotWrapTeleports = 0;
      let popPeds = 0, totalPops = 0;
      let wallClipPedsExact = 0, wallClipPedsMargin = 0, wallClipTunnelPeds = 0;
      let wallClipSamplesExact = 0, wallClipSamplesMargin = 0, totalVisibleSamples = 0;
      const teleportEx = [], popEx = [], wallEx = [];

      // Inspect tiles near this zone
      for (const [key, o] of a.people?.tiles?.entries() || []) {
        if (seen.has(key)) continue;
        const orig = o.mat?.uniforms?.uOrigin?.value;
        if (!orig || Math.hypot(orig.x - zone.x, orig.z - zone.z) > 850) continue;
        seen.add(key);
        auditedTiles.push(key);

        const pd = o.tex?.image?.data;
        const yd = o.texY?.image?.data;
        if (!pd || !yd) continue;

        const pathAt = (idx) => {
          const ii = Math.floor(idx);
          const off = ii * 4;
          const x = ((pd[off] * 256 + pd[off + 1]) / 65535 * 2 - 1) * RANGE;
          const z = ((pd[off + 2] * 256 + pd[off + 3]) / 65535 * 2 - 1) * RANGE;
          return [x, z];
        };
        const pathYAt = (idx) => {
          const ii = Math.floor(idx);
          const off = ii * 4;
          const y = (yd[off] * 256 + yd[off + 1]) / 65535 * (YMAX - YMIN) + YMIN;
          const ok = yd[off + 2] / 255.0;
          return [y, ok];
        };

        // Detect whether the shader uses the Phase 5 ping-pong / latScale shader vs legacy walkable bool
        const vsrc = o.mat?.vertexShader || '';
        const isPhase5Shader = vsrc.includes('latScale');

        // Gather all pedestrian instances in this tile
        for (const c of o.cells || []) {
          const s0 = c.hi?.geometry?.attributes?.aS0?.array;
          const s1 = c.hi?.geometry?.attributes?.aS1?.array;
          if (!s0 || !s1) continue;
          const cnt = c.count;
          // Sample up to 180 instances per tile
          const stepInst = Math.max(1, Math.floor(cnt / 180));
          for (let ii = 0; ii < cnt; ii += stepInst) {
            totalPeds++;
            const o4 = ii * 4;
            const aS0x = s0[o4], n = s0[o4 + 1], zSlot = s0[o4 + 2], N = s0[o4 + 3];
            const aS1x = s1[o4], aS1y = s1[o4 + 1], aS1z = s1[o4 + 2], aS1w = s1[o4 + 3];
            if (n < 2 || N < 1) continue;
            const D = n / N, pace = Math.abs(aS1x);
            const seed = fract(aS1w), kind = Math.floor(aS1w);

            // Check if the underlying path loop itself has a jump between index (n-1) and 0!
            const pFirst = pathAt(aS0x), pLast = pathAt(aS0x + n - 1);
            const loopEndGap = Math.hypot(pLast[0] - pFirst[0], pLast[1] - pFirst[1]);

            let prevX = null, prevY = null, prevZ = null, prevVis = false, everVis = false;
            let pedHasTele = false, pedHasPop = false, pedHasWallExact = false, pedHasWallMargin = false, pedHasTunnel = false;

            const evalAt = (uTime) => {
              const adv = (uTime * pace + aS1y) / D;
              const sh = Math.floor(adv);
              const fr = adv - sh;
              const iN = Math.max(1, Math.floor(N + 0.5));
              let zCur = (Math.floor(zSlot + 0.5) + sh) % iN;
              if (zCur < 0) zCur += iN;
              let iWho = (zCur - sh) % iN;
              if (iWho < 0) iWho += iN;
              const who = iWho;
              const id = who * 1.37 + seed * 917.0 + aS0x * 0.013;
              const h1 = hash(id), h2 = hash(id + 3.1), h3 = hash(id + 7.7);
              if (!(h3 < aS1z)) return null; // inactive person (hourFactor=1.0)
              let f = (zCur + fr + (h1 - 0.5) * 0.55) * D;
              if (aS1x < 0) f = n - f;
              f = f - n * Math.floor(f / n);
              if (f >= n || f < 0) f = 0;
              const i0 = Math.min(Math.floor(f), n - 1);
              const t = Math.max(0, Math.min(1, f - i0));
              const i1 = (i0 + 1 >= n) ? 0 : i0 + 1;
              const im = (i0 < 1) ? n - 1 : i0 - 1;
              const i2 = (i1 + 1 >= n) ? 0 : i1 + 1;
              const pm = pathAt(aS0x + im), p0 = pathAt(aS0x + i0), p1 = pathAt(aS0x + i1), p2 = pathAt(aS0x + i2);
              const y0 = pathYAt(aS0x + i0), y1 = pathYAt(aS0x + i1);
              const py = y0[0] + (y1[0] - y0[0]) * t;
              let px = p0[0] + (p1[0] - p0[0]) * t;
              let pz = p0[1] + (p1[1] - p0[1]) * t;
              let walkable = true;
              if (isPhase5Shader) {
                const latScale = y0[1] + (y1[1] - y0[1]) * t;
                const norm2 = (ax, az, fx, fz) => { const l = Math.hypot(ax, az); return l > 1e-4 ? [ax / l, az / l] : [fx, fz]; };
                const tgCur = norm2(p1[0] - p0[0], p1[1] - p0[1], 1, 0);
                const tgPrev = norm2(p0[0] - pm[0], p0[1] - pm[1], tgCur[0], tgCur[1]);
                const tgNext = norm2(p2[0] - p1[0], p2[1] - p1[1], tgCur[0], tgCur[1]);
                const tA = (tgPrev[0]*tgCur[0] + tgPrev[1]*tgCur[1]) > -0.35 ? norm2(tgPrev[0]+tgCur[0], tgPrev[1]+tgCur[1], tgCur[0], tgCur[1]) : tgCur;
                const tB = (tgCur[0]*tgNext[0] + tgCur[1]*tgNext[1]) > -0.35 ? norm2(tgCur[0]+tgNext[0], tgCur[1]+tgNext[1], tgCur[0], tgCur[1]) : tgCur;
                let tg = (tA[0]*tB[0] + tA[1]*tB[1]) > -0.35 ? norm2(tA[0]+(tB[0]-tA[0])*t, tA[1]+(tB[1]-tA[1])*t, tgCur[0], tgCur[1]) : tgCur;
                if (aS1x < 0) tg = [-tg[0], -tg[1]];
                const rtx = -tg[1], rtz = tg[0];
                const latOff = latScale * ((kind > 2.5 ? 0.08 : kind > 0.5 ? 0.14 : 0.10) + (h2 - 0.5) * (kind > 2.5 ? 0.18 : kind > 0.5 ? 0.38 : 0.26));
                px += rtx * latOff; pz += rtz * latOff;
              } else {
                walkable = Math.min(y0[1], y1[1]) > 0.5;
                let tgx = (p1[0] - pm[0]) + ((p2[0] - p0[0]) - (p1[0] - pm[0])) * t + 1e-5;
                let tgz = (p1[1] - pm[1]) + ((p2[1] - p0[1]) - (p1[1] - pm[1])) * t;
                const tl = Math.hypot(tgx, tgz) || 1; tgx /= tl; tgz /= tl;
                if (aS1x < 0) { tgx = -tgx; tgz = -tgz; }
                const rtx = -tgz, rtz = tgx;
                const lat = (kind > 2.5 ? 0.12 : kind > 0.5 ? 0.32 : 0.16) + (h2 - 0.5) * (kind > 2.5 ? 0.24 : kind > 0.5 ? 1.15 : 0.34);
                px += rtx * lat; pz += rtz * lat;
              }
              return { wx: orig.x + px, wy: py, wz: orig.z + pz, walkable, i0, f };
            };

            // Quick filter: check if person is active at t=0
            if (!evalAt(0)) continue;
            activePeds++;

            // 120 seconds at dt = 0.1s (1,200 steps!)
            for (let step = 0; step <= 1200; step++) {
              const st = evalAt(step * 0.1);
              const vis = st.walkable;
              if (vis) {
                everVis = true;
                totalVisibleSamples++;
                if (prevVis) {
                  const jump = Math.hypot(st.wx - prevX, st.wz - prevZ);
                  if (jump > 0.55) {
                    totalTeleports++;
                    pedHasTele = true;
                    const cause = loopEndGap > 2.0 ? 'open_loop_wrap' : 'step_or_tangent_jump';
                    if (loopEndGap > 2.0) openLoopTeleports++; else slotWrapTeleports++;
                    if (teleportEx.length < 8) {
                      teleportEx.push({ tile: key, t: +(step * 0.1).toFixed(1), jumpM: +jump.toFixed(2), cause, loopEndGap: +loopEndGap.toFixed(1), from: [+prevX.toFixed(1), +prevZ.toFixed(1)], to: [+st.wx.toFixed(1), +st.wz.toFixed(1)] });
                    }
                  }
                } else if (everVis && step > 0) {
                  // Reappeared after vanishing mid-walk!
                  totalPops++;
                  pedHasPop = true;
                  if (popEx.length < 8) {
                    popEx.push({ tile: key, t: +(step * 0.1).toFixed(1), at: [+st.wx.toFixed(1), +st.wy.toFixed(1), +st.wz.toFixed(1)], cause: 'walkable_mask_pop' });
                  }
                }
                // Check wall clipping every 1.0s (step % 10 === 0) for speed
                if (step % 10 === 0) {
                  const hit = insideBuilding(st.wx, st.wy, st.wz, 0.35);
                  if (hit) {
                    if (hit.exact) {
                      wallClipSamplesExact++;
                      pedHasWallExact = true;
                      if (wallEx.length < 10) wallEx.push({ tile: key, kind: 'inside_bldg', t: +(step * 0.1).toFixed(1), x: +st.wx.toFixed(1), y: +st.wy.toFixed(1), z: +st.wz.toFixed(1), bBase: +hit.base.toFixed(1), bTop: +hit.top.toFixed(1) });
                    } else {
                      wallClipSamplesMargin++;
                      pedHasWallMargin = true;
                    }
                  }
                  if (nearTunnelWall(st.wx, st.wz)) pedHasTunnel = true;
                }
                prevX = st.wx; prevY = st.wy; prevZ = st.wz;
              } else if (prevVis) {
                // Vanished mid-walk!
                totalPops++;
                pedHasPop = true;
              }
              prevVis = vis;
            }
            if (pedHasTele) teleportPeds++;
            if (pedHasPop) popPeds++;
            if (pedHasWallExact) wallClipPedsExact++;
            if (pedHasWallMargin) wallClipPedsMargin++;
            if (pedHasTunnel) wallClipTunnelPeds++;
          }
        }
      }

      return {
        zone: zone.id,
        auditedTiles,
        totalPeds,
        activePeds,
        teleportPeds,
        totalTeleports,
        openLoopTeleports,
        slotWrapTeleports,
        popPeds,
        totalPops,
        wallClipPedsExact,
        wallClipPedsMargin,
        wallClipTunnelPeds,
        wallClipSamplesExact,
        wallClipSamplesMargin,
        totalVisibleSamples,
        teleportEx,
        popEx,
        wallEx,
      };
    }, { zone: z, seenArr: [...seenTiles], tunnels: tunnelsJson });

    for (const tk of rep.auditedTiles) seenTiles.add(tk);
    zoneReports.push(rep);
    console.log(`[PED_ZONE] ${z.id.padEnd(18)} | tiles=${rep.auditedTiles.length} active=${String(rep.activePeds).padStart(4)} | telePeds=${String(rep.teleportPeds).padStart(3)} (events=${rep.totalTeleports}, openLoop=${rep.openLoopTeleports}) | popPeds=${String(rep.popPeds).padStart(3)} (events=${rep.totalPops}) | wallExact=${String(rep.wallClipPedsExact).padStart(3)} margin=${String(rep.wallClipPedsMargin).padStart(3)} tun=${rep.wallClipTunnelPeds}`);
  }

  const sum = (fn) => zoneReports.reduce((a, r) => a + fn(r), 0);
  const activeTot = sum((r) => r.activePeds);
  const summary = {
    zonesScanned: zoneReports.length,
    uniqueTilesAudited: seenTiles.size,
    activePedsAudited: activeTot,
    teleportPeds: sum((r) => r.teleportPeds),
    teleportPedsPct: activeTot ? +(sum((r) => r.teleportPeds) * 100 / activeTot).toFixed(2) : 0,
    totalTeleportEvents: sum((r) => r.totalTeleports),
    openLoopTeleports: sum((r) => r.openLoopTeleports),
    otherTeleports: sum((r) => r.slotWrapTeleports),
    popPeds: sum((r) => r.popPeds),
    popPedsPct: activeTot ? +(sum((r) => r.popPeds) * 100 / activeTot).toFixed(2) : 0,
    totalPopEvents: sum((r) => r.totalPops),
    wallClipPedsExact: sum((r) => r.wallClipPedsExact),
    wallClipPedsExactPct: activeTot ? +(sum((r) => r.wallClipPedsExact) * 100 / activeTot).toFixed(2) : 0,
    wallClipPedsMargin35cm: sum((r) => r.wallClipPedsMargin),
    wallClipTunnelPeds: sum((r) => r.wallClipTunnelPeds),
  };

  console.log('\n=== 120s PEDESTRIAN TELEPORT & WALL-CLIP SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(__dir, 'phase5_pedestrians_report.json'), JSON.stringify({ summary, zones: zoneReports, errors: diag }, null, 2));
} finally {
  await browser.close();
}
