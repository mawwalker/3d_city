// Master Landmark Registry & Loader for Chongqing 3D.
// Integrates all Yuzhong/Jiangbeizui/Nanshan architectural heroes (@hero-yuzhong)
// and all 8D bridges, Liziba CRT monorail, and Yangtze River Cableway (@hero-bridges).
//
// Exposes both the Landmarks class AND functional hooks:
//   initLandmarks(ctxOrScenes, terrain, matlib, data, env, collision, city)
//   updateLandmarks(dt, time, env)
//   getLandmarkColliders()
//   getLandmarkLights()

import * as THREE from 'three';
import { fetchJSON } from './data.js';
import { createHeroMaterials, heroMaterial, heroTexMaterial, makePlaqueMesh, makeClockFaceMesh } from './heroes/kit.js';
import { buildAllHeroes } from './heroes/index.js';

const TAU = Math.PI * 2;

/** Normalize terrain object / sampler function into a uniform { sample(x,z), normal(x,z), riverY } helper. */
function wrapTerrain(terrain, data) {
  const riverY = terrain?.riverY ?? terrain?.waterY ?? data?.riverY ?? data?.waterY ?? 0;
  const sample = (x, z) => {
    if (!terrain) return riverY;
    if (typeof terrain.sample === 'function') return terrain.sample(x, z);
    if (typeof terrain.sampleTerrain === 'function') return terrain.sampleTerrain(x, z);
    if (typeof terrain.heightAt === 'function') return terrain.heightAt(x, z);
    if (typeof terrain.getHeight === 'function') return terrain.getHeight(x, z);
    if (typeof terrain === 'function') return terrain(x, z);
    return riverY;
  };
  const normal = (x, z) => {
    if (terrain && typeof terrain.sampleNormal === 'function') return terrain.sampleNormal(x, z);
    if (terrain && typeof terrain.normal === 'function') return terrain.normal(x, z);
    if (terrain && typeof terrain.sampleTerrainNormal === 'function') return terrain.sampleTerrainNormal(x, z);
    const e = 2.0;
    const hL = sample(x - e, z), hR = sample(x + e, z), hD = sample(x, z - e), hU = sample(x, z + e);
    const nx = hL - hR, ny = 2 * e, nz = hD - hU;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  return { sample, normal, riverY, raw: terrain };
}

/** Pack high-level collider descriptors into CollisionWorld's prism, plaza & walkable-deck formats. */
function packColliders(prismList, deckList, plazaList) {
  const xz = [], start = [], count = [], base = [], top = [];
  const pXz = [], pStart = [], pCount = [], pBase = [], pTop = [];
  const decks = [];

  const pushPoly = (target, pts, y0, y1) => {
    if (!pts || pts.length < 3) return;
    target.start.push(target.xz.length / 2);
    target.count.push(pts.length);
    target.base.push(y0);
    target.top.push(y1);
    for (const [px, pz] of pts) target.xz.push(px, pz);
  };

  const prismTarget = { xz, start, count, base, top };
  const plazaTarget = { xz: pXz, start: pStart, count: pCount, base: pBase, top: pTop };

  const emitShape = (target, c) => {
    const y0 = c.base ?? -200, y1 = c.top ?? 500;
    if (c.type === 'rect' || c.type === 'rectPlaza') {
      const ang = c.ang || 0, cs = Math.cos(ang), sn = Math.sin(ang);
      const hx = c.hx, hz = c.hz;
      const pts = [[hx, hz], [hx, -hz], [-hx, -hz], [-hx, hz]].map(([lx, lz]) => [
        c.x + lx * cs + lz * sn,
        c.z - lx * sn + lz * cs,
      ]);
      pushPoly(target, pts, y0, y1);
    } else if (c.type === 'circle' || c.type === 'circlePlaza') {
      const n = c.sides || 12, r = c.r, pts = [];
      for (let k = 0; k < n; k++) {
        const a = -k / n * TAU;
        pts.push([c.x + Math.cos(a) * r, c.z + Math.sin(a) * r]);
      }
      pushPoly(target, pts, y0, y1);
    } else if ((c.type === 'poly' || c.type === 'polyPlaza') && c.pts) {
      pushPoly(target, c.pts, y0, y1);
    }
  };

  for (const c of prismList) if (c) emitShape(prismTarget, c);
  for (const p of plazaList) if (p) emitShape(plazaTarget, p);

  for (const d of deckList) {
    if (!d) continue;
    if (Array.isArray(d) && d.length >= 7) {
      for (let i = 0; i + 6 < d.length; i += 7) {
        decks.push(d[i], d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5], d[i + 6]);
      }
    } else if (d instanceof Float32Array) {
      for (let i = 0; i + 6 < d.length; i += 7) {
        decks.push(d[i], d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5], d[i + 6]);
      }
    } else if (d.type === 'rectDeck') {
      const ang = d.ang || 0, cs = Math.cos(ang), sn = Math.sin(ang);
      const alongX = d.hx >= d.hz;
      const halfL = alongX ? d.hx : d.hz;
      const halfW = alongX ? d.hz : d.hx;
      const dx = alongX ? cs * halfL : sn * halfL;
      const dz = alongX ? -sn * halfL : cs * halfL;
      decks.push(d.x - dx, d.z - dz, d.y, d.x + dx, d.z + dz, d.y, halfW);
    }
  }

  return {
    prisms: start.length ? {
      xz: new Float32Array(xz),
      start: new Uint32Array(start),
      count: new Uint16Array(count),
      base: new Float32Array(base),
      top: new Float32Array(top),
    } : null,
    plazas: pStart.length ? {
      xz: new Float32Array(pXz),
      start: new Uint32Array(pStart),
      count: new Uint16Array(pCount),
      base: new Float32Array(pBase),
      top: new Float32Array(pTop),
    } : null,
    decks: decks.length ? new Float32Array(decks) : null,
  };
}

/** Pack light descriptors [{ x, y, z, radius, r, g, b, intensity?, omni? }, ...] into 8-float stride Float32Array
 *  matching engine-core LocalLights.setLandmarkLights: [x, y, z, radius, r, g, b, omnidirectional(0|1), ...]. */
function packLights(lightList) {
  const out = [];
  const posOnly = [];
  for (const l of lightList) {
    if (!l) continue;
    const inten = l.intensity ?? 1200;
    const rad = l.radius ?? 36;
    const r = (l.r ?? 1.0) * inten;
    const g = (l.g ?? 0.78) * inten;
    const b = (l.b ?? 0.45) * inten;
    const omni = l.omni === undefined ? 1 : (l.omni ? 1 : 0);
    out.push(l.x, l.y, l.z, rad, r, g, b, omni);
    posOnly.push(l.x, l.y, l.z);
  }
  return {
    packed: new Float32Array(out),
    stride: 8,
    positions: new Float32Array(posOnly),
    count: lightList.length,
  };
}

export class Landmarks {
  constructor({ scenes, env, terrain = null, matlib = null, lib = null, city = null, collision = null, lights = null } = {}) {
    this.scenes = scenes;
    this.env = env;
    this.rawTerrain = terrain;
    this.matlib = matlib || lib;
    this.city = city;
    this.collision = collision;
    this.localLights = lights;
    this.root = new THREE.Group();
    this.root.name = 'chongqing-landmarks';
    this.shadowRoot = new THREE.Group();
    this.shadowRoot.name = 'chongqing-landmarks-shadow';
    this.movingRoot = new THREE.Group();
    this.movingRoot.name = 'chongqing-landmarks-moving';
    this.updaters = [];
    this.labels = [];
    this.colliders = { prisms: null, plazas: null, decks: null };
    this.lights = { packed: new Float32Array(0), positions: new Float32Array(0), count: 0 };
    this.stats = { modules: [], meshes: 0, tris: 0 };
    this.loaded = false;
  }

  async load(dataOverride = null) {
    let data = dataOverride;
    if (!data) {
      try {
        data = await fetchJSON('landmarks.json');
      } catch (err) {
        console.warn('[landmarks] landmarks.json fetch failed, falling back to built-in coordinates:', err.message || err);
        data = {};
      }
    }
    this.data = data;
    const terrain = wrapTerrain(this.rawTerrain, data);
    const materials = createHeroMaterials(this.env, this.matlib);
    this.materials = materials;

    const addMesh = (geoOrKit, {
      x = 0, y = 0, z = 0, rotY = 0,
      mat = materials.heroMat,
      castShadow = true,
      moving = false,
      doubleSide = false,
      layer1 = true,
      parent = null,
      shadowParent = null,
      name = '',
    } = {}) => {
      const geo = typeof geoOrKit.geometry === 'function' ? geoOrKit.geometry() : geoOrKit;
      const useMat = doubleSide && mat === materials.heroMat ? materials.heroMatDouble : (moving && mat === materials.heroMat ? materials.heroMovingMat : mat);
      const mesh = new THREE.Mesh(geo, useMat);
      if (name) mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotY;
      mesh.userData.moving = moving;
      mesh.userData.castShadow = castShadow;
      mesh.userData.shadowAdded = true;
      if (!moving) {
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
      }
      (parent || this.root).add(mesh);

      let shadowMesh = null;
      if (castShadow) {
        const dMat = doubleSide ? materials.depthDoubleMat : materials.depthMat;
        shadowMesh = new THREE.Mesh(geo, dMat);
        shadowMesh.position.set(x, y, z);
        shadowMesh.rotation.y = rotY;
        if (!moving) {
          shadowMesh.matrixAutoUpdate = false;
          shadowMesh.updateMatrix();
          shadowMesh.updateMatrixWorld(true);
        }
        if (layer1) shadowMesh.layers.enable(1);
        const target = shadowParent || (moving ? this.movingRoot : this.shadowRoot);
        target.add(shadowMesh);
      }

      this.stats.meshes++;
      if (geo.index) this.stats.tris += geo.index.count / 3;
      return { mesh, shadowMesh, geo };
    };

    const addInstanced = (geoOrKit, matrices, colors = null, {
      mat = materials.heroInstancedMat,
      castShadow = true,
      layer1 = true,
      parent = null,
      name = '',
    } = {}) => {
      const count = matrices.length;
      if (!count) return null;
      const geo = typeof geoOrKit.geometry === 'function' ? geoOrKit.geometry() : geoOrKit;
      const inst = new THREE.InstancedMesh(geo, mat, count);
      if (name) inst.name = name;
      for (let k = 0; k < count; k++) {
        inst.setMatrixAt(k, matrices[k]);
        if (colors && colors[k]) inst.setColorAt(k, colors[k]);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.matrixAutoUpdate = false;
      inst.updateMatrix();
      inst.updateMatrixWorld(true);
      inst.userData.shadowAdded = true;
      (parent || this.root).add(inst);

      let shadowInst = null;
      if (castShadow) {
        shadowInst = new THREE.InstancedMesh(geo, materials.depthInstancedMat, count);
        for (let k = 0; k < count; k++) shadowInst.setMatrixAt(k, matrices[k]);
        shadowInst.instanceMatrix.needsUpdate = true;
        shadowInst.computeBoundingSphere();
        shadowInst.matrixAutoUpdate = false;
        shadowInst.updateMatrix();
        shadowInst.updateMatrixWorld(true);
        if (layer1) shadowInst.layers.enable(1);
        this.shadowRoot.add(shadowInst);
      }
      this.stats.meshes++;
      if (geo.index) this.stats.tris += (geo.index.count / 3) * count;
      return { mesh: inst, shadowMesh: shadowInst, geo };
    };

    const ctx = {
      data,
      scenes: this.scenes,
      env: this.env,
      terrain,
      matlib: this.matlib,
      city: this.city,
      materials,
      addMesh,
      addInstanced,
      createMaterial: (opts) => heroMaterial(this.env, { matlib: this.matlib, ...opts }),
      makeTexMaterial: (tex, opts) => heroTexMaterial(this.env, tex, opts),
      makePlaque: (text, opts) => makePlaqueMesh(this.env, text, opts),
      makeClockFace: (radius, opts) => makeClockFaceMesh(this.env, radius, opts),
    };

    const built = await buildAllHeroes(ctx);

    const allPrisms = [];
    const allPlazas = [];
    const allDecks = [];
    const allLights = [];
    const shadowSyncUpdaters = [];

    for (const mod of built) {
      this.stats.modules.push(mod.name);
      if (typeof mod.update === 'function') this.updaters.push(mod.update);
      if (mod.group && mod.group !== this.root && !mod.group.parent) {
        this.root.add(mod.group);
        // Auto-create shadow casters for any mesh inside mod.group that didn't go through addMesh
        mod.group.updateMatrixWorld(true);
        mod.group.traverse((obj) => {
          if (!obj.isMesh || obj.userData.shadowAdded || obj.userData.castShadow === false) return;
          const isInst = obj.isInstancedMesh;
          const dMat = isInst ? materials.depthInstancedMat : (obj.material?.side === THREE.DoubleSide ? materials.depthDoubleMat : materials.depthMat);
          let sh;
          if (isInst) {
            sh = new THREE.InstancedMesh(obj.geometry, dMat, obj.count);
            sh.instanceMatrix.copy(obj.instanceMatrix);
            sh.instanceMatrix.needsUpdate = true;
          } else {
            sh = new THREE.Mesh(obj.geometry, dMat);
          }
          sh.layers.enable(1);
          if (obj.userData.moving) {
            // Link moving shadow mesh to track world transform AFTER mod.update runs each frame
            this.movingRoot.add(sh);
            shadowSyncUpdaters.push(() => {
              obj.updateWorldMatrix(true, false);
              sh.matrixAutoUpdate = false;
              sh.matrix.copy(obj.matrixWorld);
              sh.matrixWorld.copy(obj.matrixWorld);
            });
          } else {
            sh.matrixAutoUpdate = false;
            sh.matrix.copy(obj.matrixWorld);
            sh.matrixWorld.copy(obj.matrixWorld);
            this.shadowRoot.add(sh);
          }
          obj.userData.shadowAdded = true;
          this.stats.meshes++;
          if (obj.geometry?.index) this.stats.tris += (obj.geometry.index.count / 3) * (isInst ? obj.count : 1);
        });
      }
      if (mod.shadowGroup && !mod.shadowGroup.parent) this.shadowRoot.add(mod.shadowGroup);
      if (mod.movingGroup && !mod.movingGroup.parent) this.movingRoot.add(mod.movingGroup);

      // Accept either { colliders: { prisms, plazas, decks } } OR { colliders: [...], plazas: [...], decks: [...] }
      if (mod.colliders) {
        if (Array.isArray(mod.colliders)) allPrisms.push(...mod.colliders);
        else {
          if (Array.isArray(mod.colliders.prisms)) allPrisms.push(...mod.colliders.prisms);
          if (Array.isArray(mod.colliders.plazas)) allPlazas.push(...mod.colliders.plazas);
          if (Array.isArray(mod.colliders.decks)) allDecks.push(...mod.colliders.decks);
        }
      }
      if (Array.isArray(mod.plazas)) allPlazas.push(...mod.plazas);
      if (Array.isArray(mod.decks)) allDecks.push(...mod.decks);
      if (Array.isArray(mod.lights)) allLights.push(...mod.lights);
      if (Array.isArray(mod.labels)) this.labels.push(...mod.labels);
    }

    this.updaters.push(...shadowSyncUpdaters);

    // Mount into engine scenes
    if (this.scenes?.opaque) this.scenes.opaque.add(this.root);
    if (this.scenes?.shadow) this.scenes.shadow.add(this.shadowRoot);
    if (this.scenes?.moving) this.scenes.moving.add(this.movingRoot);

    this.colliders = packColliders(allPrisms, allDecks, allPlazas);
    this.lights = packLights(allLights);

    if (this.collision) {
      if (this.colliders.prisms) this.collision.addTile('landmarks', this.colliders.prisms);
      if (this.colliders.plazas) {
        if (typeof this.collision.addPlazas === 'function') this.collision.addPlazas('landmarks', this.colliders.plazas);
        else this.collision.addTile('landmarks_plazas', this.colliders.plazas);
      }
      if (this.colliders.decks && typeof this.collision.addDecks === 'function') {
        this.collision.addDecks('landmarks', this.colliders.decks);
      }
    }

    if (this.localLights && typeof this.localLights.setLandmarkLights === 'function' && this.lights.count > 0) {
      this.localLights.setLandmarkLights(this.lights.packed, this.lights.stride);
    }

    this.loaded = true;
    return this;
  }

  update(dt, time, env = this.env, camera = null) {
    for (let k = 0; k < this.updaters.length; k++) {
      this.updaters[k](dt, time, env, camera);
    }
  }

  getColliders() { return this.colliders; }
  getLights() { return this.lights; }
  getLabels() { return this.labels; }
}

// ---- Singleton functional API (matches engine-core brief) -----------------------------------------------------------

let _activeLandmarks = null;

export async function initLandmarks(scenesOrOpts, terrain, matlib, data, env, collision, city) {
  let opts;
  if (scenesOrOpts && scenesOrOpts.scenes) {
    opts = scenesOrOpts;
  } else {
    opts = { scenes: scenesOrOpts, terrain, matlib, env, collision, city };
  }
  _activeLandmarks = new Landmarks(opts);
  await _activeLandmarks.load(opts.data ?? data ?? null);
  return _activeLandmarks;
}

export function updateLandmarks(dt, time, env) {
  if (_activeLandmarks) _activeLandmarks.update(dt, time, env);
}

export function getLandmarkColliders() {
  return _activeLandmarks ? _activeLandmarks.getColliders() : { prisms: null, decks: null };
}

export function getLandmarkLights() {
  return _activeLandmarks ? _activeLandmarks.getLights() : { packed: new Float32Array(0), positions: new Float32Array(0), count: 0 };
}
