// City tile manager: streams the building tiles, decides each tile's level of detail from the camera position, and keeps
// the render, shadow and collision scenes in step.
//
//   far   (always)        base buildings (simplified beyond MID range) + block masses standing in for the small ones
//   near  (inside NEAR)   the tile file with every small building and all street-level layers

import * as THREE from 'three';
import { fetchBinary, fetchJSON, SEC } from './data.js';
import { createBuildingMaterials } from './buildingMaterial.js';
import { createGroundMaterial, TEX_PERIOD } from './groundMaterial.js';

class WorkerPool {
  constructor(n) {
    this.workers = []; this.idle = []; this.queue = []; this.pending = 0; this.seq = 0; this.cb = new Map();
    for (let k = 0; k < n; k++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { const c = this.cb.get(e.data.id); this.cb.delete(e.data.id); this.idle.push(w); this.pending--; this._pump(); if (c) (e.data.ok ? c.resolve(e.data.out) : c.reject(new Error(e.data.error))); };
      w.onerror = (e) => console.error('worker error', e.message || e);
      this.workers.push(w); this.idle.push(w);
    }
  }
  run(msg, transfer = []) {
    return new Promise((resolve, reject) => { const id = ++this.seq; this.cb.set(id, { resolve, reject }); this.queue.push({ msg: { ...msg, id }, transfer }); this.pending++; this._pump(); });
  }
  _pump() { while (this.idle.length && this.queue.length) { const w = this.idle.pop(), j = this.queue.shift(); w.postMessage(j.msg, j.transfer); } }
}

function gpuOnly(attr) { attr.onUploadCallback = function () { this.array = null; }; return attr; }

function makeGeometry(res) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('aPos', gpuOnly(new THREE.BufferAttribute(res.pos, 4)));
  geo.setAttribute('aNrm', gpuOnly(new THREE.BufferAttribute(res.nrm, 4)));
  geo.setAttribute('aBld', gpuOnly(new THREE.BufferAttribute(res.bld, 4)));
  geo.setAttribute('aEdge', gpuOnly(new THREE.BufferAttribute(res.edge, 2)));
  geo.setAttribute('aFlag', gpuOnly(new THREE.BufferAttribute(res.flag, 4)));
  geo.setIndex(gpuOnly(new THREE.BufferAttribute(res.index, 1)));
  const b = res.bounds;
  const c = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
  geo.boundingSphere = new THREE.Sphere(c, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 + 1);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
  return geo;
}

export class City {
  constructor({ scenes, env, quality, lib }) {
    this.scenes = scenes; this.env = env; this.quality = quality; this.lib = lib;
    this.mats = createBuildingMaterials(env, lib);
    this.pool = new WorkerPool(Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
    this.tiles = new Map();
    this.order = [];
    this.NEAR = 1150 * quality.range; this.MID = 4200 * quality.range;
    this.maxJobs = 8;
    this.jobs = 0;
    this.dirty = false;             // geometry changed since the app last looked (shadows / height field / colliders)
    this.counts = { far: 0, mid: 0, near: 0, tris: 0 };
    this.onTileNear = null; this.onTileGone = null;       // hooks for the street-level layers
    this._camTile = null;
  }

  async load(onProgress) {
    const man = this.manifest = await fetchJSON('city.json');
    const g = man.grid; this.grid = g;
    for (const t of man.tiles) {
      const cx = g.x0 + (t.i + 0.5) * g.tile, cn = g.y0 + (t.j + 0.5) * g.tile;
      this.tiles.set(t.i * 1000 + t.j, { info: t, i: t.i, j: t.j, x: cx, z: -cn, far: null, baseLod: -1, wantLod: -1, base: null, mass: null, detail: null, detailState: 0, busy: false, d: 1e9 });
    }
    this.order = [...this.tiles.values()];
    // one texel per tile: set while the tile's detailed decks are shown (the far-view decks give way there)
    this.nearMask = new THREE.DataTexture(new Uint8Array(g.nx * g.ny), g.nx, g.ny, THREE.RedFormat, THREE.UnsignedByteType);
    this.nearMask.minFilter = this.nearMask.magFilter = THREE.NearestFilter; this.nearMask.unpackAlignment = 1; this.nearMask.generateMipmaps = false; this.nearMask.needsUpdate = true;
    // far shells arrive centre-first; tiles become buildable as their shell lands
    let done = 0;
    const total = man.farFiles.reduce((s, f) => s + f.bytes, 0);
    this.farLoaded = (async () => {
      for (let s = 0; s < man.farFiles.length; s++) {
        const buf = await fetchBinary(man.farFiles[s].name);
        for (const t of this.order) if (t.info.f === s && t.info.l) t.far = { buffer: buf, offset: t.info.o, length: t.info.l };
        done += man.farFiles[s].bytes;
        if (onProgress) onProgress(done / total);
        if (s === 0) this._firstShell && this._firstShell();
      }
      this.allFar = true;
    })();
    await new Promise((r) => { this._firstShell = r; });
  }

  _mesh(res, t, layer1 = true) {
    const geo = makeGeometry(res);
    const mesh = new THREE.Mesh(geo, this.mats.material);
    mesh.position.set(t.x, 0, t.z); mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.updateMatrixWorld(true);
    const sh = new THREE.Mesh(geo, this.mats.depth);
    sh.position.copy(mesh.position); sh.matrixAutoUpdate = false; sh.updateMatrix(); sh.updateMatrixWorld(true);
    if (layer1) sh.layers.enable(1);
    return { mesh, sh, geo, tris: res.nTris };
  }
  _show(o) { if (o && !o.on) { this.scenes.opaque.add(o.mesh); this.scenes.shadow.add(o.sh); o.on = true; this.counts.tris += o.tris; this.dirty = true; } }
  _hide(o) { if (o && o.on) { this.scenes.opaque.remove(o.mesh); this.scenes.shadow.remove(o.sh); o.on = false; this.counts.tris -= o.tris; this.dirty = true; } }
  _free(o) { if (!o) return; this._hide(o); o.geo.dispose(); }

  async _buildFar(t, lod) {
    t.busy = true; this.jobs++;
    try {
      const f = t.far;
      const copy = f.buffer.slice(f.offset, f.offset + f.length);
      const jobs = [{ key: 'base', section: SEC.buildings, simple: lod === 1, far: lod === 1 }];
      if (!t.mass && !t.massNone) jobs.push({ key: 'mass', section: SEC.masses, simple: true });
      const out = await this.pool.run({ type: 'buildings', buffer: copy, jobs, tile: this.grid.tile }, [copy]);
      const old = t.base;
      t.base = out.base && out.base.nVerts ? this._mesh(out.base, t) : null;
      this._show(t.base); this._free(old);
      if (jobs.length > 1) { if (out.mass && out.mass.nVerts) { t.mass = this._mesh(out.mass, t); if (t.detailState !== 2) this._show(t.mass); } else t.massNone = true; }
      t.baseLod = lod;
    } catch (e) { console.error('far tile failed', t.i, t.j, e); t.baseLod = lod; }
    t.busy = false; this.jobs--;
  }

  async _loadDetail(t) {
    t.detailState = 1; this.jobs++;
    try {
      const buf = await fetchBinary(`tiles/${t.i}_${t.j}.bin`);
      const far = t.far ? t.far.buffer.slice(t.far.offset, t.far.offset + t.far.length) : null;
      const origin = [this.grid.x0 + t.i * this.grid.tile, this.grid.y0 + t.j * this.grid.tile];
      const out = await this.pool.run({ type: 'near', buffer: buf, far, origin, tile: this.grid.tile }, far ? [buf, far] : [buf]);
      if (t.detailState !== 1) { this.jobs--; return; }            // cancelled meanwhile
      t.detail = out.detail ? this._mesh(out.detail, t) : null;
      if (out.ground) t.ground = this._groundMesh(out.ground, out.land, t);
      if (out.roofs) { t.roofs = this._mesh(out.roofs, t, false); this._show(t.roofs); }
      t.detailState = 2;
      this._show(t.detail); this._hide(t.mass);
      if (t.ground) { this.scenes.opaque.add(t.ground.mesh); this.counts.tris += t.ground.tris; }
      if (out.decks && out.decks.mesh && t.ground) {
        // decks share the tile's ground material; they cast shadows and close the sky over the street below
        const g = new THREE.BufferGeometry();
        g.setAttribute('aPos', gpuOnly(new THREE.BufferAttribute(out.decks.mesh.pos, 4)));
        g.setAttribute('aNrm', gpuOnly(new THREE.BufferAttribute(out.decks.mesh.nrm, 4)));
        g.setIndex(gpuOnly(new THREE.BufferAttribute(out.decks.mesh.index, 1)));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, 0), this.grid.tile * 0.75);
        const mesh = new THREE.Mesh(g, t.ground.mat); mesh.position.set(t.x, 0, t.z); mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.updateMatrixWorld(true);
        const sh = new THREE.Mesh(g, this.mats.depth); sh.position.copy(mesh.position); sh.matrixAutoUpdate = false; sh.updateMatrix(); sh.updateMatrixWorld(true); sh.layers.enable(1);
        t.decks = { mesh, sh, geo: g, tris: out.decks.mesh.nTris, on: false };
        this._show(t.decks);
        this.nearMask.image.data[t.j * this.grid.nx + t.i] = 255; this.nearMask.needsUpdate = true;
      }
      if (this.onTileNear) this.onTileNear(t, out);
    } catch (e) { console.error('near tile failed', t.i, t.j, e); t.detailState = 3; }
    this.jobs--;
  }

  _groundMesh(res, land, t) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aPos', gpuOnly(new THREE.BufferAttribute(res.pos, 4)));
    geo.setAttribute('aNrm', gpuOnly(new THREE.BufferAttribute(res.nrm, 4)));
    geo.setIndex(gpuOnly(new THREE.BufferAttribute(res.index, 1)));
    const half = this.grid.tile / 2;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), half * 1.45);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-half, -1.3, -half), new THREE.Vector3(half, 0.2, half));
    let tex = null;
    if (land) {
      tex = new THREE.DataTexture(land.data, land.w, land.h, THREE.RedFormat, THREE.UnsignedByteType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.unpackAlignment = 1; tex.generateMipmaps = false; tex.needsUpdate = true;
    }
    const mat = createGroundMaterial(this.lib);
    mat.uniforms.tLand.value = tex;
    mat.uniforms.uLandInfo.value.set(land ? land.w : 1, land ? 1 : 0, 0, 0);
    const mod = (v) => ((v % TEX_PERIOD) + TEX_PERIOD) % TEX_PERIOD;
    mat.uniforms.uTile.value.set(mod(t.x), mod(t.z), this.grid.tile, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(t.x, 0, t.z); mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.updateMatrixWorld(true);
    return { mesh, geo, mat, tex, tris: res.nTris };
  }

  _dropDetail(t) {
    if (t.detailState === 2) {
      this._free(t.detail); t.detail = null;
      if (t.ground) { this.scenes.opaque.remove(t.ground.mesh); this.counts.tris -= t.ground.tris; t.ground.geo.dispose(); t.ground.mat.dispose(); if (t.ground.tex) t.ground.tex.dispose(); t.ground = null; }
      if (t.decks) { this._free(t.decks); t.decks = null; this.nearMask.image.data[t.j * this.grid.nx + t.i] = 0; this.nearMask.needsUpdate = true; }
      if (t.roofs) { this._free(t.roofs); t.roofs = null; }
      if (this.onTileGone) this.onTileGone(t);
      this._show(t.mass);
    }
    t.detailState = 0;
  }

  update(camera) {
    if (!this.grid) return;
    const px = camera.position.x, pz = camera.position.z, half = this.grid.tile / 2;
    const alt = Math.max(0, camera.position.y);
    // from high up nothing needs street-level detail; shrink the near ring as the camera climbs
    const near = Math.max(0, this.NEAR - Math.max(0, alt - 400) * 1.2);
    const mid = this.MID + alt * 1.5;
    for (const t of this.order) {
      const dx = Math.max(0, Math.abs(px - t.x) - half), dz = Math.max(0, Math.abs(pz - t.z) - half);
      t.d = Math.hypot(dx, dz);
    }
    // closest first
    if (!this._sortT || performance.now() - this._sortT > 400) { this.order.sort((a, b) => a.d - b.d); this._sortT = performance.now(); }
    let nearN = 0, midN = 0;
    for (const t of this.order) {
      const lod = t.d < (t.baseLod === 0 ? mid * 1.12 : mid) ? 0 : 1;
      if (lod === 0) midN++;
      if (t.far && !t.busy && t.baseLod !== lod && this.jobs < this.maxJobs) this._buildFar(t, lod);
      const hasDetail = t.info.db > 0;
      if (hasDetail) {
        // wait for the tile's always-loaded part: the colliders of its large buildings come from there
        if (t.d < near && t.detailState === 0 && this.jobs < this.maxJobs && (t.far || !t.info.l)) this._loadDetail(t);
        else if (t.d > near * 1.3 + 100 && (t.detailState === 2 || t.detailState === 3)) this._dropDetail(t);
        if (t.detailState === 2) nearN++;
      }
    }
    this.counts.near = nearN; this.counts.mid = midN;
  }

  /** True once the street-level data under (x, z) is in place (colliders, decks), or there is none to wait for. */
  readyAt(x, z) {
    const g = this.grid;
    if (!g) return false;
    const t = this.tiles.get(Math.floor((x - g.x0) / g.tile) * 1000 + Math.floor((-z - g.y0) / g.tile));
    return !t || !(t.info.db > 0) || t.detailState >= 2;
  }

  /** True while tiles around the camera are still being fetched or built. */
  get busy() {
    if (this.jobs > 0 || this.pool.pending > 0) return true;
    for (const t of this.order) { if (t.far && t.baseLod < 0) return true; if (t.d > this.MID) break; }
    return false;
  }
}
