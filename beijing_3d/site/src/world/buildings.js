// Building layer: loads the always-on base + mass tiles centre-out, streams detail tiles near the camera,
// and keeps three proxy scenes in sync (main, shadow casters, ground-AO occupancy).

import * as THREE from 'three';
import { fetchBin, fetchJSON } from './data.js';
import { createBuildingMaterials } from './buildingMaterial.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

class WorkerPool {
  constructor(n) {
    this.workers = []; this.idle = []; this.queue = []; this.jobs = new Map(); this.seq = 0;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./buildingWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => this._done(w, ev.data);
      w.onerror = (e) => console.error('building worker error', e.message || e);
      this.workers.push(w); this.idle.push(w);
    }
  }
  run(buffer, opts, priority = 0) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.queue.push({ id, buffer, opts, priority, resolve, reject });
      this.queue.sort((a, b) => a.priority - b.priority);
      this._pump();
    });
  }
  _pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      this.jobs.set(job.id, job);
      w.postMessage({ id: job.id, buffer: job.buffer, opts: job.opts }, [job.buffer]);
    }
  }
  _done(w, msg) {
    const job = this.jobs.get(msg.id);
    this.jobs.delete(msg.id);
    this.idle.push(w);
    if (job) { if (msg.ok) job.resolve(msg.res); else job.reject(new Error(msg.error)); }
    this._pump();
  }
  get pending() { return this.queue.length + this.jobs.size; }
}

export class BuildingLayer {
  constructor({ env, scene, shadowScene, aoScene, quality }) {
    this.env = env; this.scene = scene; this.shadowScene = shadowScene; this.aoScene = aoScene;
    this.quality = quality;
    this.mats = createBuildingMaterials(env, quality);
    this.one = { value: 1 };
    this.matStatic = this.mats.make(this.one);            // shared by every settled tile
    this.matStaticDS = this.mats.make(this.one, THREE.DoubleSide);   // near tiles: lets the inner faces of roof parapets show
    this.depthStatic = this.mats.makeDepth(this.one);
    this.pool = new WorkerPool(Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)));
    this.tiles = new Map();
    this.anims = [];
    this.manifest = null;
    this.group = new THREE.Group(); this.group.name = 'buildings';
    this.shadowGroup = new THREE.Group(); this.aoGroup = new THREE.Group();
    scene.add(this.group); shadowScene.add(this.shadowGroup); aoScene.add(this.aoGroup);
    this.aoDirty = false; this.shadowDirty = true;
    this.stats = { tris: 0, tiles: 0, detail: 0, buildings: 0 };
    this._lastLod = 0;
    this._detailLoading = 0;
    this.onTile = null;
    this.onTrees = null; this.onTreesRemove = null;
    this.ready = false;
  }

  key(i, j) { return i * 1000 + j; }

  async load(onProgress) {
    const man = this.manifest = await fetchJSON('buildings.json');
    const g = man.grid;
    for (const t of man.tiles) {
      const ox = g.x0 + t.i * g.tile, oy = g.y0 + t.j * g.tile;
      this.tiles.set(this.key(t.i, t.j), {
        info: t, ox, oy, cx: ox + g.tile / 2, cz: -(oy + g.tile / 2),
        base: null, mass: null, detail: null, detailState: 'none', mix: 0, mixGoal: 0, lastWanted: 0, lod: -1,
      });
    }
    const total = man.baseFiles.slice(0, Math.min(man.baseFiles.length, this.quality.maxShell ?? man.baseFiles.length)).reduce((s, f) => s + f.bytes, 0);
    let done = 0;
    const builds = [];
    const nFiles = Math.min(man.baseFiles.length, this.quality.maxShell ?? man.baseFiles.length);
    for (let fi = 0; fi < nFiles; fi++) {
      const f = man.baseFiles[fi];
      const buf = await fetchBin(f.name, (l) => onProgress && onProgress((done + l) / total, fi));
      done += f.bytes;
      for (const t of man.tiles) {
        if (t.file !== fi) continue;
        const tile = this.tiles.get(this.key(t.i, t.j));
        const dc = Math.hypot(tile.cx, tile.cz);
        if (t.nb) {
          // inner-city tiles keep their source blob so roof-top equipment can be generated when the camera comes close
          const blob = buf.slice(t.bo, t.bo + t.bl);
          if (t.inner && this.quality.garnish !== 0) tile.baseBlob = blob.slice(0);
          builds.push(this.pool.run(blob, { kind: 'base' }, dc).then((res) => this._attach(tile, 'base', res)));
        }
        if (t.nm) builds.push(this.pool.run(buf.slice(t.mo, t.mo + t.ml), { kind: 'mass' }, dc + 500).then((res) => this._attach(tile, 'mass', res)));
      }
      if (fi === 0) { await Promise.all(builds); this.ready = true; }
    }
    await Promise.all(builds);
    onProgress && onProgress(1, man.baseFiles.length);
  }

  _makeMesh(tile, res, grow) {
    const geo = new THREE.BufferGeometry();
    // the CPU copies are dropped once they are on the GPU (hundreds of MB across the city)
    const gpuOnly = (attr) => attr.onUpload(function () { this.array = null; });
    geo.setAttribute('aPos', gpuOnly(new THREE.BufferAttribute(res.pos, 4)));
    geo.setAttribute('aInfo', gpuOnly(new THREE.BufferAttribute(res.info, 4)));
    geo.setAttribute('aH', gpuOnly(new THREE.BufferAttribute(res.hh, 2)));
    geo.setIndex(gpuOnly(new THREE.BufferAttribute(res.index, 1)));
    const [x0, z0, x1, z1] = res.bounds;
    const c = new THREE.Vector3((x0 + x1) / 2, res.maxY / 2, (z0 + z1) / 2);
    geo.boundingSphere = new THREE.Sphere(c, Math.hypot(x1 - x0, res.maxY, z1 - z0) / 2 + 20);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, res.maxY, z1));
    const place = (m) => { m.position.set(tile.ox, 0, -tile.oy); m.scale.setScalar(0.1); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true); return m; };
    const mesh = place(new THREE.Mesh(geo, this.mats.make(grow)));
    mesh.renderOrder = 1;
    const shadow = place(new THREE.Mesh(geo, this.mats.makeDepth(grow)));
    return { mesh, shadow, geo, grow, tris: res.nTris, count: res.count, cuts: res.cuts, indexCount: res.index.length };
  }

  _settle(part) {
    // once an animation ends the tile joins the shared static material (far fewer uniform uploads)
    if (part.grow.value >= 1) {
      part.mesh.material.dispose(); part.shadow.material.dispose();
      part.mesh.material = this.matStatic; part.shadow.material = this.depthStatic;
    }
  }

  _isStatic(part) { return part.mesh.material === this.matStatic || part.mesh.material === this.matStaticDS; }

  async _loadGarnish(tile) {
    tile.garnishBusy = true;
    try {
      const res = await this.pool.run(tile.baseBlob.slice(0), { kind: 'garnish' }, 8);
      if (!res.nVerts) { tile.garnish = { empty: true }; return; }
      const part = this._makeMesh(tile, res, { value: 0 });
      tile.garnish = part;
      this.group.add(part.mesh); this.shadowGroup.add(part.shadow);
      this.stats.tris += res.nTris;
      this._animate(part, 1, 0.6, () => this._settle(part));
    } catch (e) { console.warn('garnish failed', e); tile.garnish = { empty: true }; }
    finally { tile.garnishBusy = false; }
  }

  _disposeGarnish(tile) {
    const g = tile.garnish; tile.garnish = null;
    if (!g || g.empty) return;
    this.group.remove(g.mesh); this.shadowGroup.remove(g.shadow);
    g.geo.dispose();
    if (!this._isStatic(g)) { g.mesh.material.dispose(); g.shadow.material.dispose(); }
    this.stats.tris -= g.tris;
    this.anims = this.anims.filter((a) => a.part !== g);
    this.shadowDirty = true;
  }

  _animate(part, to, dur, onDone) {
    const from = part.grow.value;
    if (this._isStatic(part)) {
      part.mesh.material = this.mats.make(part.grow); part.shadow.material = this.mats.makeDepth(part.grow);
    }
    this.anims = this.anims.filter((a) => a.part !== part);
    this.anims.push({ part, from, to, t: 0, dur, onDone });
  }

  _attach(tile, kind, res) {
    if (!res.nVerts) return;
    const grow = { value: 0 };
    const part = this._makeMesh(tile, res, grow);
    tile[kind] = part;
    this.group.add(part.mesh); this.shadowGroup.add(part.shadow);
    if (kind !== 'detail') {
      const ao = new THREE.Mesh(part.geo, this.mats.occupancy);
      ao.matrixAutoUpdate = false; ao.matrix.copy(part.mesh.matrix); ao.matrixWorld.copy(part.mesh.matrixWorld);
      part.ao = ao; this.aoGroup.add(ao);
      this.aoDirty = true;
      const delay = Math.min(0.5, Math.hypot(tile.cx, tile.cz) / 60000);
      this._animate(part, 1, 1.1 + delay, () => this._settle(part));
      // a mass arriving after its detail tile is already in must stay hidden
      if (kind === 'mass' && tile.mix >= 1) part.mesh.visible = part.shadow.visible = false;
    }
    this.stats.tris += res.nTris; this.stats.buildings += res.count;
    this.shadowDirty = true;
    if (this.onTile) this.onTile(tile, kind);
  }

  // ---------------------------------------------------------------- detail streaming
  async _loadDetail(tile) {
    tile.detailState = 'loading'; this._detailLoading++;
    try {
      const buf = await fetchBin(`detail/${tile.info.i}_${tile.info.j}.bin`);
      const res = await this.pool.run(buf, { kind: 'detail', seed: tile.info.i * 1000 + tile.info.j, trees: this.quality.trees }, -1);
      if (tile.detailState !== 'loading') return;
      if (res.nVerts) this._attach(tile, 'detail', res);
      if (res.trees && res.trees.length && this.onTrees) { this.onTrees(tile, res.trees); tile.hasTrees = true; }
      tile.detailState = 'ready';
      this.stats.detail++;
      if (tile.detail) tile.mixGoal = 1;
    } catch (e) {
      console.warn('detail tile failed', tile.info.i, tile.info.j, e);
      tile.detailState = 'failed';
    } finally { this._detailLoading--; }
  }

  _disposeDetail(tile) {
    if (tile.hasTrees && this.onTreesRemove) { this.onTreesRemove(tile); tile.hasTrees = false; }
    const d = tile.detail;
    if (d) {
      this.group.remove(d.mesh); this.shadowGroup.remove(d.shadow);
      d.geo.dispose();
      if (!this._isStatic(d)) { d.mesh.material.dispose(); d.shadow.material.dispose(); }
      this.stats.tris -= d.tris; this.stats.buildings -= d.count;
      this.anims = this.anims.filter((a) => a.part !== d);
    }
    this.stats.detail--;
    tile.detail = null; tile.detailState = 'none'; tile.mix = 0; tile.mixGoal = 0;
  }

  update(camera, dt, _time, viewportH) {
    // own clock: keeps scheduling even while the scene clock is frozen (offline film rendering)
    const now = this._clock = (this._clock || 0) + dt;
    // animations
    if (this.anims.length) {
      for (const a of this.anims) {
        a.t = Math.min(1, a.t + dt / a.dur);
        a.part.grow.value = a.from + (a.to - a.from) * easeOut(a.t);
        if (a.t >= 1 && a.onDone) a.onDone();
      }
      this.anims = this.anims.filter((a) => a.t < 1);
      this.shadowDirty = true;
    }
    if (now - this._lastLod < 0.12) return;
    this._lastLod = now;
    const q = this.quality;
    const e = camera.position;
    const rIn = THREE.MathUtils.clamp(6200 * (viewportH / 1080) * q.detailRange, 2500, 10500);
    const rOut = rIn * 1.3;
    const want = [];
    for (const tile of this.tiles.values()) {
      const d = Math.hypot(tile.cx - e.x, e.y, tile.cz - e.z);
      // far LOD: draw only the most significant buildings of distant tiles (index buffer is sorted by significance)
      if (tile.base && tile.base.cuts) {
        const lod = d > 34000 * q.lodRange ? 2 : d > 20000 * q.lodRange ? 1 : 0;
        if (lod !== tile.lod) {
          tile.lod = lod;
          const cnt = lod === 0 ? tile.base.indexCount : tile.base.cuts[lod === 1 ? 1 : 0];
          tile.base.geo.setDrawRange(0, cnt);
        }
      }
      // close tiles: double-sided walls (parapets) and roof-top equipment
      const nearDS = d < 3600;
      for (const part of [tile.base, tile.detail]) {
        if (part && this._isStatic(part)) { const m = nearDS ? this.matStaticDS : this.matStatic; if (part.mesh.material !== m) part.mesh.material = m; }
      }
      if (tile.baseBlob && tile.base) {
        const rG = 2400 * q.detailRange;
        if (d < rG && !tile.garnish && !tile.garnishBusy && this.pool.pending < 6) this._loadGarnish(tile);
        else if (d > rG * 1.6 && tile.garnish && !tile.garnishBusy) this._disposeGarnish(tile);
      }
      if (tile.mass) {
        const vis = (tile.mix < 1 || !!tile._mixing) && d < 60000 * q.lodRange;       // stays up while cross-growing with the detail tile
        if (tile.mass.mesh.visible !== vis) { tile.mass.mesh.visible = tile.mass.shadow.visible = vis; this.shadowDirty = true; }
      }
      if (!tile.info.nd && !tile.info.nt) continue;
      if (d < rIn) {
        tile.lastWanted = now;
        if (tile.detailState === 'none') want.push([d, tile]);
        else if (tile.detailState === 'ready' && tile.mixGoal !== 1) tile.mixGoal = 1;
      } else if (d > rOut && tile.detailState === 'ready' && now - tile.lastWanted > 2.5) {
        if (tile.detail) tile.mixGoal = 0;
        else this._disposeDetail(tile);          // trees-only tile
      }
      // cross-grow between the mass stand-in and the real small buildings
      if (tile.detail && tile.mix !== tile.mixGoal && !tile._mixing) {
        tile._mixing = true;
        const to = tile.mixGoal;
        if (tile.mass) { tile.mass.mesh.visible = tile.mass.shadow.visible = true; this._animate(tile.mass, 1 - to, 0.7, () => this._settle(tile.mass)); }
        this._animate(tile.detail, to, 0.7, () => {
          tile.mix = to; tile._mixing = false;
          this._settle(tile.detail);
          if (to === 0) this._disposeDetail(tile);
          else if (tile.mass) tile.mass.mesh.visible = tile.mass.shadow.visible = false;
        });
      }
    }
    if (want.length && this._detailLoading < q.detailConcurrency) {
      want.sort((a, b) => a[0] - b[0]);
      for (const [, tile] of want) { if (this._detailLoading >= q.detailConcurrency) break; this._loadDetail(tile); }
    }
  }
}
