// Geometry worker: decodes tile sections and builds meshes off the main thread.
import { parseTile, decodeBuildings, decodePolys, decodeLines, decodeTraffic, SEC } from './data.js';
import { buildStreet } from './streetGeom.js';
import { buildPeople } from './peopleGeom.js';
import { buildSigns } from './signGeom.js';
import { buildDecks, decodeDecks } from './deckGeom.js';
import { buildRoofClutter } from './roofGeom.js';
import { buildBuildings } from './buildingGeom.js';
import { buildGround } from './groundGeom.js';
import { buildFarBlock } from './farGeom.js';

const bTransfer = (res) => [res.pos.buffer, res.nrm.buffer, res.bld.buffer, res.edge.buffer, res.flag.buffer, res.index.buffer];

function decodeTrees(sec) {
  const dv = new DataView(sec.buffer, sec.offset, sec.length);
  const n = dv.getUint32(0, true);
  let o = sec.offset + 4;
  const x = new Uint16Array(sec.buffer.slice(o, o + n * 2)); o += n * 2;
  const y = new Uint16Array(sec.buffer.slice(o, o + n * 2)); o += n * 2;
  const h = new Uint8Array(sec.buffer.slice(o, o + n)); o += n;
  const r = new Uint8Array(sec.buffer.slice(o, o + n)); o += n;
  const sp = new Uint8Array(sec.buffer.slice(o, o + n)); o += n;
  const seed = new Uint8Array(sec.buffer.slice(o, o + n));
  return { n, x, y, h, r, sp, seed };
}

// Footprint prisms for the collision world: exterior rings in world x / z, with base and top heights.
// Exterior rings of the tile's water polygons (ground class 4), as blocking prisms for the walker.
function waterRings(d) {
  const rings = [];
  let vi = 0, ri = 0;
  for (let p = 0; p < d.np; p++) {
    let px = 0, py = 0;
    for (let r = 0; r < d.nrings[p]; r++) {
      const n = d.ringsize[ri++];
      const ring = r === 0 && d.cls[p] === 4 ? new Float32Array(n * 2) : null;
      for (let k = 0; k < n; k++, vi++) { px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1]; if (ring) { ring[k * 2] = px * 0.1; ring[k * 2 + 1] = py * 0.1; } }
      if (ring) rings.push(ring);
    }
  }
  return rings;
}

function makeColliders(list, ox, oy, water = []) {
  let nb = water.length, nv = 0;
  for (const d of list) { nb += d.nb; nv += d.nv; }
  for (const w of water) nv += w.length / 2;
  const xz = new Float32Array(nv * 2), start = new Uint32Array(nb), count = new Uint16Array(nb), base = new Float32Array(nb), top = new Float32Array(nb);
  let o = 0, bi = 0;
  for (const d of list) {
    let vi = 0, ri = 0;
    for (let b = 0; b < d.nb; b++) {
      let px = 0, py = 0;
      const nr = d.nrings[b];
      for (let r = 0; r < nr; r++) {
        const n = d.ringsize[ri++];
        if (r === 0) { start[bi] = o; count[bi] = n; }
        for (let k = 0; k < n; k++, vi++) {
          px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1];
          if (r === 0) { xz[o * 2] = ox + px * 0.1; xz[o * 2 + 1] = -(oy + py * 0.1); o++; }
        }
      }
      base[bi] = d.base[b] * 0.1; top[bi] = (d.base[b] + d.height[b]) * 0.1;
      bi++;
    }
  }
  for (const w of water) {
    const n = w.length / 2;
    if (n > 65535) continue;
    start[bi] = o; count[bi] = n; base[bi] = -3; top[bi] = 1.25;
    for (let k = 0; k < n; k++) { xz[o * 2] = ox + w[k * 2]; xz[o * 2 + 1] = -(oy + w[k * 2 + 1]); o++; }
    bi++;
  }
  return { xz: xz.slice(0, o * 2), start: start.slice(0, bi), count: count.slice(0, bi), base: base.slice(0, bi), top: top.slice(0, bi) };
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'buildings') {
      // far data: m.buffer holds one tile's far sections
      const secs = parseTile(m.buffer, m.offset || 0, m.length ?? (m.buffer.byteLength - (m.offset || 0)));
      const out = {}; const tr = [];
      for (const job of m.jobs) {
        const sec = secs[job.section];
        if (!sec) { out[job.key] = null; continue; }
        const d = decodeBuildings(sec);
        const res = buildBuildings(d, { count: job.count, simple: job.simple, far: job.far, mass: job.section === SEC.masses, tile: m.tile });
        out[job.key] = res; tr.push(...bTransfer(res));
      }
      self.postMessage({ id: m.id, ok: true, out }, tr);
    } else if (m.type === 'near') {
      // a near tile file: small buildings, ground, land cover, trees ...
      const secs = parseTile(m.buffer);
      const out = { detail: null, ground: null, land: null, trees: null, col: null }; const tr = [];
      const cols = [];
      if (secs[SEC.buildings]) { const d = decodeBuildings(secs[SEC.buildings]); cols.push(d); const res = buildBuildings(d, { tile: m.tile }); if (res.nVerts) { out.detail = res; tr.push(...bTransfer(res)); } }
      if (m.far) { const fs = parseTile(m.far); if (fs[SEC.buildings]) cols.push(decodeBuildings(fs[SEC.buildings])); }
      if (cols.length) { const rc = buildRoofClutter(cols, m.tile); if (rc.nVerts) { out.roofs = rc; tr.push(...bTransfer(rc)); } }
      const water = secs[SEC.ground] ? waterRings(decodePolys(secs[SEC.ground])) : [];
      if ((cols.length || water.length) && m.origin) { const c = makeColliders(cols, m.origin[0], m.origin[1], water); out.col = c; tr.push(c.xz.buffer, c.start.buffer, c.count.buffer, c.base.buffer, c.top.buffer); }
      if (secs[SEC.ground]) { const g = buildGround(decodePolys(secs[SEC.ground]), m.tile); if (g.nVerts) { out.ground = g; tr.push(g.pos.buffer, g.nrm.buffer, g.index.buffer); } }
      if (secs[SEC.landcover]) {
        const s = secs[SEC.landcover]; const dv = new DataView(s.buffer, s.offset, 8);
        const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
        const data = new Uint8Array(s.buffer.slice(s.offset + 8, s.offset + 8 + w * h));
        out.land = { w, h, data }; tr.push(data.buffer);
      }
      const tf = secs[SEC.traffic] ? decodeTraffic(secs[SEC.traffic]) : null;
      if (tf) out.traffic = { E: tf.E, xyz: tf.xyz };
      if (secs[SEC.roads]) { const st = buildStreet(decodeLines(secs[SEC.roads]), m.tile, secs[SEC.bridges] ? decodeDecks(secs[SEC.bridges], m.tile) : null, tf); out.street = st; if (st.decals) tr.push(st.decals.pos.buffer, st.decals.uv.buffer, st.decals.index.buffer); tr.push(st.lamps.buffer, st.signals.buffer, st.cars.buffer); }
      if (secs[SEC.bridges]) { const dk = buildDecks(secs[SEC.bridges], m.tile, secs[SEC.roads] ? decodeLines(secs[SEC.roads]) : null); out.decks = dk; if (dk.mesh) tr.push(dk.mesh.pos.buffer, dk.mesh.nrm.buffer, dk.mesh.index.buffer); tr.push(dk.segs.buffer); }
      if (secs[SEC.walks]) { const pp = buildPeople(secs[SEC.walks], m.tile); if (pp) { out.people = pp; tr.push(pp.path.buffer, pp.a0.buffer, pp.a1.buffer, pp.cells.buffer); } }
      if (secs[SEC.signs]) { const sg = buildSigns(secs[SEC.signs], m.tile); if (sg) { out.signs = sg; tr.push(sg.pos.buffer, sg.nrm.buffer, sg.uv.buffer, sg.index.buffer, sg.inst.buffer); } }
      if (secs[SEC.trees]) { const t = decodeTrees(secs[SEC.trees]); out.trees = t; tr.push(t.x.buffer, t.y.buffer, t.h.buffer, t.r.buffer, t.sp.buffer, t.seed.buffer); }
      self.postMessage({ id: m.id, ok: true, out }, tr);
    } else if (m.type === 'far') {
      const wrap = (b) => (b ? { buffer: b, offset: 0, length: b.byteLength } : null);
      const out = buildFarBlock(m.chunks.map((c) => ({ ox: c.ox, on: c.on, water: wrap(c.water), roads: wrap(c.roads), decks: wrap(c.decks) })));
      const tr = [];
      if (out.decks) tr.push(out.decks.pos.buffer, out.decks.attr.buffer, out.decks.index.buffer);
      if (out.water) tr.push(out.water.pos.buffer, out.water.index.buffer);
      if (out.roads) tr.push(out.roads.pos.buffer, out.roads.attr.buffer, out.roads.index.buffer);
      self.postMessage({ id: m.id, ok: true, out }, tr);
    } else {
      self.postMessage({ id: m.id, ok: false, error: 'unknown job ' + m.type });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.stack || err) });
  }
};
