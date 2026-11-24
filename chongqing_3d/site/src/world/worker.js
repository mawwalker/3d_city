// Geometry Web Worker for Chongqing 3D:
//   - Holds its own fast TerrainField instance (initialized via 'initTerrain' before any tile/far job)
//   - Decodes CQT2 tiles, invokes @arch-builder's buildBuildings/buildNearBuildings & buildRoofClutter with full 3D terrain sampler
//   - Builds 3D terrain-draped ground, decks, street markings/lamps/cars, pedestrians, road signs, colliders, and DEM terrain meshes.

import { parseTile, decodeBuildings, decodePolys, decodeLines, decodeTraffic, SEC } from './data.js';
import { TerrainField, setActiveTerrain, sampleTerrain } from './terrain.js';
import { buildStreet } from './streetGeom.js';
import { buildPeople } from './peopleGeom.js';
import { buildSigns } from './signGeom.js';
import { buildDecks, decodeDecks } from './deckGeom.js';
import { buildRoofClutter } from './roofGeom.js';
import * as bldMod from './buildingGeom.js';
import { buildGround } from './groundGeom.js';
import { buildFarBlock, buildTerrainMesh } from './farGeom.js';

const terrain = new TerrainField();
let heroZones = []; // array of [wx, wz, r2] hero landmark & bridge abutment exclusion circles
let heroBoxes = []; // array of [cx, cz, cosA, sinA, hx, hz] exact oriented hero footprint OBBs
let tunnelZones = []; // flat array of [x, z, dx, dz, hw] tunnel portal mouth zones
const tunnelGrid = new Map(); // 64m spatial hash -> indices into tunnelZones
const TCELL = 64;

function indexTunnels(arr) {
  tunnelZones = Array.isArray(arr) ? arr : [];
  tunnelGrid.clear();
  for (let i = 0; i < tunnelZones.length; i += 5) {
    const x = tunnelZones[i], z = tunnelZones[i + 1];
    const cx = Math.floor(x / TCELL), cz = Math.floor(z / TCELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const k = (cx + dx) * 100003 + (cz + dz);
      let a = tunnelGrid.get(k);
      if (!a) tunnelGrid.set(k, a = []);
      a.push(i);
    }
  }
}

function inHero(wx, wz) {
  for (let i = 0; i < heroZones.length; i += 3) {
    const dx = wx - heroZones[i], dz = wz - heroZones[i + 1];
    if (dx * dx + dz * dz < heroZones[i + 2]) return true;
  }
  for (let i = 0; i < heroBoxes.length; i += 6) {
    const dx = wx - heroBoxes[i], dz = wz - heroBoxes[i + 1];
    const c = heroBoxes[i + 2], s = heroBoxes[i + 3];
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < heroBoxes[i + 4] && Math.abs(lz) < heroBoxes[i + 5]) return true;
  }
  return false;
}

function inTunnelMouth(wx, wz, padLat = 7.0, ahead = 22.0, inside = 12.0) {
  if (!tunnelZones.length) return false;
  const a = tunnelGrid.get(Math.floor(wx / TCELL) * 100003 + Math.floor(wz / TCELL));
  if (!a) return false;
  for (let k = 0; k < a.length; k++) {
    const o = a[k];
    const vx = wx - tunnelZones[o], vz = wz - tunnelZones[o + 1];
    const fx = tunnelZones[o + 2], fz = tunnelZones[o + 3], hw = tunnelZones[o + 4];
    const along = vx * fx + vz * fz; // +into tunnel, -ahead on approach road
    if (along < -ahead || along > inside) continue;
    const lat = Math.abs(vx * fz - vz * fx);
    if (lat < hw + padLat) return true;
  }
  return false;
}

function bTransfer(res) {
  const tr = [res.pos.buffer, res.nrm.buffer, res.bld.buffer, res.edge.buffer, res.flag.buffer, res.index.buffer];
  if (res.extra && res.extra.buffer) tr.push(res.extra.buffer);
  return tr;
}

function decodeTrees(sec, ox, oy, land = null, tile = 1000, decks = null) {
  const dv = new DataView(sec.buffer, sec.offset, sec.length);
  const nRaw = dv.getUint32(0, true);
  let o = sec.offset + 4;
  const rx = new Uint16Array(sec.buffer.slice(o, o + nRaw * 2)); o += nRaw * 2;
  const ry = new Uint16Array(sec.buffer.slice(o, o + nRaw * 2)); o += nRaw * 2;
  const rh = new Uint8Array(sec.buffer.slice(o, o + nRaw)); o += nRaw;
  const rr = new Uint8Array(sec.buffer.slice(o, o + nRaw)); o += nRaw;
  const rsp = new Uint8Array(sec.buffer.slice(o, o + nRaw)); o += nRaw;
  const rseed = new Uint8Array(sec.buffer.slice(o, o + nRaw));

  // Build spatial hash of elevated viaduct/deck footprints (tile-local centred coords) so ZERO trees grow through viaducts!
  const half = tile * 0.5;
  const deckCells = new Map();
  if (decks && decks.length) {
    for (let di = 0; di < decks.length; di++) {
      const D = decks[di], pad = D.W * 0.5 + 4.8;
      for (let k = 0; k + 1 < D.n; k++) {
        const ax = D.x[k], ay = D.y[k], bx = D.x[k + 1], by = D.y[k + 1];
        const x0 = Math.floor((Math.min(ax, bx) - pad) / 16), x1 = Math.floor((Math.max(ax, bx) + pad) / 16);
        const y0 = Math.floor((Math.min(ay, by) - pad) / 16), y1 = Math.floor((Math.max(ay, by) + pad) / 16);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
          const kk = gx * 100003 + gy;
          let arr = deckCells.get(kk); if (!arr) deckCells.set(kk, arr = []);
          arr.push(ax, ay, bx, by, pad * pad);
        }
      }
    }
  }
  const nearDeck = (lxC, lnC) => {
    if (!deckCells.size) return false;
    const arr = deckCells.get(Math.floor(lxC / 16) * 100003 + Math.floor(lnC / 16));
    if (!arr) return false;
    for (let i = 0; i < arr.length; i += 5) {
      const ax = arr[i], ay = arr[i + 1], ex = arr[i + 2] - ax, ey = arr[i + 3] - ay, l2 = ex * ex + ey * ey;
      const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((lxC - ax) * ex + (lnC - ay) * ey) / l2)) : 0;
      const dx = lxC - ax - ex * t, dy = lnC - ay - ey * t;
      if (dx * dx + dy * dy < arr[i + 4]) return true;
    }
    return false;
  };

  // Filter out trees inside hero landmark slabs, tunnel portal approaches & elevated deck viaducts; tag paved urban trees for grates
  const x = new Uint16Array(nRaw), y = new Uint16Array(nRaw), ty = new Float32Array(nRaw);
  const h = new Uint8Array(nRaw), r = new Uint8Array(nRaw), sp = new Uint8Array(nRaw), seed = new Uint8Array(nRaw), paved = new Uint8Array(nRaw);
  let n = 0;
  for (let k = 0; k < nRaw; k++) {
    const lx = rx[k] * 0.1, ln = ry[k] * 0.1;
    const wx = ox + lx, wz = -(oy + ln);
    if ((heroZones.length || heroBoxes.length) && inHero(wx, wz)) continue;
    if (tunnelZones.length && inTunnelMouth(wx, wz, 8.5, 24.0, 14.0)) continue;
    if (nearDeck(lx - half, ln - half)) continue;
    x[n] = rx[k]; y[n] = ry[k]; h[n] = rh[k]; r[n] = rr[k]; sp[n] = rsp[k]; seed[n] = rseed[k];
    ty[n] = terrain.ready ? Math.max(terrain.sample(wx, wz), terrain.waterY + 0.15) : 0.15;
    // Check landcover raster (cover = code & 15; 0 = paved urban sidewalk/plaza, 1..9 = grass/forest/soil/water!)
    let isPaved = 0;
    if (land && land.data && land.w > 0 && land.h > 0) {
      const ix = Math.max(0, Math.min(land.w - 1, Math.floor((lx / tile) * land.w)));
      const iy = Math.max(0, Math.min(land.h - 1, Math.floor((ln / tile) * land.h)));
      const code = land.data[iy * land.w + ix];
      const cover = code & 15;
      if (cover === 0) isPaved = 1;
    }
    paved[n] = isPaved;
    n++;
  }
  return {
    n,
    x: x.slice(0, n), y: y.slice(0, n), ty: ty.slice(0, n),
    h: h.slice(0, n), r: r.slice(0, n), sp: sp.slice(0, n), seed: seed.slice(0, n), paved: paved.slice(0, n),
  };
}

function waterRings(d) {
  const rings = [];
  let vi = 0, ri = 0;
  for (let p = 0; p < d.np; p++) {
    let px = 0, py = 0;
    for (let r = 0; r < d.nrings[p]; r++) {
      const n = d.ringsize[ri++];
      const ring = r === 0 && d.cls[p] === 4 ? new Float32Array(n * 2) : null;
      for (let k = 0; k < n; k++, vi++) {
        px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1];
        if (ring) { ring[k * 2] = px * 0.1; ring[k * 2 + 1] = py * 0.1; }
      }
      if (ring) rings.push(ring);
    }
  }
  return rings;
}

/** 3D terrain-aware building & river-edge collision prisms in world coordinates. */
function makeColliders(list, ox, oy, water = []) {
  let nb = water.length, nv = 0;
  for (const d of list) { nb += d.nb; nv += d.nv; }
  for (const w of water) nv += w.length / 2;
  const xz = new Float32Array(nv * 2), start = new Uint32Array(nb), count = new Uint16Array(nb);
  const base = new Float32Array(nb), top = new Float32Array(nb);
  let o = 0, bi = 0;
  for (const d of list) {
    let vi = 0, ri = 0;
    for (let b = 0; b < d.nb; b++) {
      let px = 0, py = 0;
      const nr = d.nrings[b];
      let sumX = 0, sumZ = 0, cnt0 = 0, vMinY = 1e9;
      for (let r = 0; r < nr; r++) {
        const n = d.ringsize[ri++];
        if (r === 0) { start[bi] = o; count[bi] = n; }
        for (let k = 0; k < n; k++, vi++) {
          px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1];
          if (r === 0) {
            const wx = ox + px * 0.1, wz = -(oy + py * 0.1);
            xz[o * 2] = wx; xz[o * 2 + 1] = wz;
            if (terrain.ready) { const ty = terrain.sample(wx, wz); if (ty < vMinY) vMinY = ty; }
            sumX += wx; sumZ += wz; cnt0++; o++;
          }
        }
      }
      const gzMin0 = d.ground_z_min ? d.ground_z_min[b] * 0.1 : (cnt0 && terrain.ready ? terrain.sample(sumX / cnt0, sumZ / cnt0) : 0);
      const gzMin = vMinY < 1e8 ? Math.min(gzMin0, vMinY) : gzMin0;
      const gzMax = d.ground_z_max ? d.ground_z_max[b] * 0.1 : gzMin;
      const bMinH = d.base[b] * 0.1, bH = d.height[b] * 0.1;
      // Extend every ground-level / low-plinth building collider 18m below lowest downhill vertex DEM so player NEVER walks under hillside plinths!
      base[bi] = (bMinH > 2.4 ? gzMax + bMinH : gzMin - 18.0);
      top[bi] = gzMax + bMinH + bH + 0.4;
      bi++;
    }
  }
  const wy = terrain.ready ? terrain.waterY : 0.0;
  for (const w of water) {
    const n = w.length / 2;
    if (n > 65535) continue;
    start[bi] = o; count[bi] = n; base[bi] = wy - 10; top[bi] = wy + 1.8;
    for (let k = 0; k < n; k++) { xz[o * 2] = ox + w[k * 2]; xz[o * 2 + 1] = -(oy + w[k * 2 + 1]); o++; }
    bi++;
  }
  return { xz: xz.slice(0, o * 2), start: start.slice(0, bi), count: count.slice(0, bi), base: base.slice(0, bi), top: top.slice(0, bi) };
}

/** Merge two decoded building arrays cleanly if @arch-builder's buildBuildings takes a single object. */
function concatBuildings(list) {
  if (list.length === 1) return list[0];
  let nb = 0, nr = 0, nv = 0;
  for (const d of list) { nb += d.nb; nr += d.nr; nv += d.nv; }
  const out = {
    version: 2, nb, nr, nv,
    height: new Uint16Array(nb), base: new Uint16Array(nb),
    ground_z_min: new Int16Array(nb), ground_z_max: new Int16Array(nb),
    levels: new Uint8Array(nb), style: new Uint8Array(nb), roof: new Uint8Array(nb),
    seed: new Uint8Array(nb), pal: new Uint8Array(nb), flags: new Uint8Array(nb),
    nrings: new Uint8Array(nb), podium_h: new Uint8Array(nb), balcony_mask: new Uint8Array(nb), subtype: new Uint8Array(nb),
    ringsize: new Uint16Array(nr), xy: new Int16Array(nv * 2), edge: new Uint8Array(nv),
  };
  out.groundZMin = out.ground_z_min; out.groundZMax = out.ground_z_max;
  out.podiumH = out.podium_h; out.balconyMask = out.balcony_mask;
  let ob = 0, or = 0, ov = 0;
  for (const d of list) {
    out.height.set(d.height, ob); out.base.set(d.base, ob);
    if (d.ground_z_min) out.ground_z_min.set(d.ground_z_min, ob);
    if (d.ground_z_max) out.ground_z_max.set(d.ground_z_max, ob);
    out.levels.set(d.levels, ob); out.style.set(d.style, ob); out.roof.set(d.roof, ob);
    out.seed.set(d.seed, ob); out.pal.set(d.pal, ob); out.flags.set(d.flags, ob);
    out.nrings.set(d.nrings, ob);
    if (d.podium_h) out.podium_h.set(d.podium_h, ob);
    if (d.balcony_mask) out.balcony_mask.set(d.balcony_mask, ob);
    if (d.subtype) out.subtype.set(d.subtype, ob);
    out.ringsize.set(d.ringsize, or);
    out.xy.set(d.xy, ov * 2);
    out.edge.set(d.edge, ov);
    ob += d.nb; or += d.nr; ov += d.nv;
  }
  return out;
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'initTerrain') {
      if (m.synthetic) terrain.initSynthetic();
      else terrain.initFromBuffers(m.meta, m.fineBuf, m.coarseBuf, m.coreBuf || null);
      if (Array.isArray(m.heroZones)) heroZones = m.heroZones;
      if (Array.isArray(m.heroBoxes)) heroBoxes = m.heroBoxes;
      if (Array.isArray(m.tunnelZones)) indexTunnels(m.tunnelZones);
      setActiveTerrain(terrain);
      self.postMessage({ id: m.id, ok: true, out: { ready: true } });
    } else if (m.type === 'terrainMesh') {
      const g = m.which === 'coarse' ? terrain.coarse : terrain.fine;
      const data = m.which === 'coarse' ? terrain.coarseData : terrain.fineData;
      if (!g || !data) { self.postMessage({ id: m.id, ok: true, out: null }); return; }
      const res = buildTerrainMesh(g, data, {
        step: m.step || 2, hole: m.hole || null, exagOuter: m.exagOuter || 0,
        terrain: m.which === 'fine' ? terrain : null,
      });
      self.postMessage({ id: m.id, ok: true, out: res }, [res.pos.buffer, res.nrm.buffer, res.index.buffer]);
    } else if (m.type === 'buildings') {
      const secs = parseTile(m.buffer, m.offset || 0, m.length ?? (m.buffer.byteLength - (m.offset || 0)));
      const out = {}; const tr = [];
      const cx = m.cx || 0, cz = m.cz || 0;
      const origin = m.origin || [cx - m.tile / 2, -cz - m.tile / 2];
      for (const job of m.jobs) {
        const sec = secs[job.section];
        if (!sec) { out[job.key] = null; continue; }
        const d = decodeBuildings(sec);
        const res = bldMod.buildBuildings(d, {
          count: job.count, simple: job.simple, far: job.far, mass: job.section === SEC.masses,
          lod: job.far ? 2 : 1, tile: m.tile, origin, cx, cz,
          terrain, sampleTerrain,
        });
        out[job.key] = res;
        if (res && res.nVerts) tr.push(...bTransfer(res));
      }
      self.postMessage({ id: m.id, ok: true, out }, tr);
    } else if (m.type === 'near') {
      const secs = parseTile(m.buffer);
      const out = { detail: null, ground: null, land: null, trees: null, col: null }; const tr = [];
      const cx = m.cx ?? (m.origin ? m.origin[0] + m.tile / 2 : 0);
      const cz = m.cz ?? (m.origin ? -(m.origin[1] + m.tile / 2) : 0);
      const origin = m.origin || [cx - m.tile / 2, -cz - m.tile / 2];
      const hasHero = heroZones.length > 0 || heroBoxes.length > 0;
      const inTunnel = tunnelZones.length ? (wx, wz) => inTunnelMouth(wx, wz, 6.0, 34.0, 14.0) : null;
      const opts = { tile: m.tile, origin, cx, cz, terrain, sampleTerrain, inHero: hasHero ? inHero : null, inTunnel, lod: 0, simple: false, far: false };

      // Collect BOTH near small buildings AND far tall towers for unified LOD0 true-3D facadeKit modeling!
      const cols = [];
      if (secs[SEC.buildings]) cols.push(decodeBuildings(secs[SEC.buildings]));
      if (m.far) {
        const fs = parseTile(m.far);
        if (fs[SEC.buildings]) cols.push(decodeBuildings(fs[SEC.buildings]));
      }
      if (cols.length) {
        const res = typeof bldMod.buildNearBuildings === 'function'
          ? bldMod.buildNearBuildings(cols, opts)
          : bldMod.buildBuildings(concatBuildings(cols), opts);
        if (res && res.nVerts) { out.detail = res; tr.push(...bTransfer(res)); }
        const rc = buildRoofClutter(cols, m.tile, opts);
        if (rc && rc.nVerts) { out.roofs = rc; tr.push(...bTransfer(rc)); }
      }

      const groundPolys = secs[SEC.ground] ? decodePolys(secs[SEC.ground]) : null;
      const water = groundPolys ? waterRings(groundPolys) : [];
      if ((cols.length || water.length) && origin) {
        const c = makeColliders(cols, origin[0], origin[1], water);
        out.col = c; tr.push(c.xz.buffer, c.start.buffer, c.count.buffer, c.base.buffer, c.top.buffer);
      }
      if (groundPolys) {
        const g = buildGround(groundPolys, m.tile, opts);
        if (g.nVerts) { out.ground = g; tr.push(g.pos.buffer, g.nrm.buffer, g.index.buffer); }
      }
      let landObj = null;
      if (secs[SEC.landcover]) {
        const s = secs[SEC.landcover]; const dv = new DataView(s.buffer, s.offset, 8);
        const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
        const data = new Uint8Array(s.buffer.slice(s.offset + 8, s.offset + 8 + w * h));
        landObj = { w, h, data };
        out.land = landObj; tr.push(data.buffer);
      }
      const decksDec = secs[SEC.bridges] ? decodeDecks(secs[SEC.bridges], m.tile, opts) : null;
      let treesObj = null;
      if (secs[SEC.trees]) {
        treesObj = decodeTrees(secs[SEC.trees], origin[0], origin[1], landObj, m.tile, decksDec);
        out.trees = treesObj; tr.push(treesObj.x.buffer, treesObj.y.buffer, treesObj.ty.buffer, treesObj.h.buffer, treesObj.r.buffer, treesObj.sp.buffer, treesObj.seed.buffer, treesObj.paved.buffer);
      }
      const tf = secs[SEC.traffic] ? decodeTraffic(secs[SEC.traffic]) : null;
      if (tf) out.traffic = { E: tf.E, xyz: tf.xyz };
      const roads = secs[SEC.roads] ? decodeLines(secs[SEC.roads]) : null;
      if (roads) {
        const st = buildStreet(roads, m.tile, decksDec, tf, opts);
        out.street = st;
        if (st.decals) tr.push(st.decals.pos.buffer, st.decals.uv.buffer, st.decals.index.buffer);
        tr.push(st.lamps.buffer, st.signals.buffer, st.cars.buffer);
        if (st.rails) tr.push(st.rails.buffer);
        if (st.furniture) tr.push(st.furniture.buffer);
        if (st.shelters) tr.push(st.shelters.buffer);
      }
      if (secs[SEC.bridges]) {
        const dk = buildDecks(secs[SEC.bridges], m.tile, roads, opts);
        out.decks = dk;
        if (dk.mesh) tr.push(dk.mesh.pos.buffer, dk.mesh.nrm.buffer, dk.mesh.index.buffer);
        tr.push(dk.segs.buffer);
      }
      if (secs[SEC.walks]) {
        const inTunnelPed = tunnelZones.length ? (wx, wz) => inTunnelMouth(wx, wz, 3.5, 10.0, 12.0) : null;
        const pp = buildPeople(secs[SEC.walks], m.tile, { ...opts, inTunnel: inTunnelPed, trees: treesObj, col: out.col });
        if (pp) {
          out.people = pp;
          tr.push(pp.path.buffer, pp.a0.buffer, pp.a1.buffer, pp.cells.buffer);
          if (pp.pathY) tr.push(pp.pathY.buffer);
        }
      }
      if (secs[SEC.signs]) {
        const sg = buildSigns(secs[SEC.signs], m.tile, opts);
        if (sg) { out.signs = sg; tr.push(sg.pos.buffer, sg.nrm.buffer, sg.uv.buffer, sg.index.buffer, sg.inst.buffer); }
      }
      self.postMessage({ id: m.id, ok: true, out }, tr);
    } else if (m.type === 'far') {
      const wrap = (b) => (b ? { buffer: b, offset: 0, length: b.byteLength } : null);
      const out = buildFarBlock(
        m.chunks.map((c) => ({ ox: c.ox, on: c.on, water: wrap(c.water), roads: wrap(c.roads), decks: wrap(c.decks) })),
        { cx: m.cx || 0, cz: m.cz || 0, terrain }
      );
      const tr = [];
      if (out.decks) tr.push(out.decks.pos.buffer, out.decks.attr.buffer, out.decks.index.buffer);
      if (out.water) tr.push(out.water.pos.buffer, out.water.index.buffer);
      if (out.roads) tr.push(out.roads.pos.buffer, out.roads.attr.buffer, out.roads.index.buffer);
      self.postMessage({ id: m.id, ok: true, out }, tr);
    } else {
      self.postMessage({ id: m.id, ok: false, error: 'unknown job ' + m.type });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.stack) || err) });
  }
};
