// Beijing · inside the Fifth Ring — application bootstrap and frame loop.

import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { Environment } from './engine/environment.js';
import { createSky } from './engine/sky.js';
import { SunShadow } from './engine/shadows.js';
import { CameraRig } from './engine/controls.js';
import { BuildingLayer } from './world/buildings.js';
import { Ground } from './world/ground.js';
import { Terrain } from './world/terrain.js';
import { TreeLayer } from './world/trees.js';
import { Landmarks } from './world/landmarks.js';
import { Aircraft } from './world/aircraft.js';
import { pickQuality, VIEWS } from './config.js';
import { UI, buildViews } from './ui/ui.js';
import { Labels } from './ui/labels.js';
import { fetchJSON } from './world/data.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');

class App {
  constructor() {
    this.pipeline = new Pipeline(canvas, { samples: 4 });
    this.renderer = this.pipeline.renderer;
    this.quality = pickQuality(this.renderer);
    this.pipeline.samples = Math.min(this.quality.samples, this.renderer.capabilities.maxSamples);
    this.pipeline.setAo(params.get('ao') === '0' ? null : this.quality.ao);
    this.env = new Environment();
    this.scene = new THREE.Scene();
    this.shadowScene = new THREE.Scene();
    this.aoScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 10, 320000);
    this.scene.add(createSky(this.env));
    this.shadow = new SunShadow(this.renderer, this.env, this.quality.shadow);
    this.terrain = new Terrain({ env: this.env, scene: this.scene, shadowScene: this.shadowScene });
    this.rig = new CameraRig(this.camera, canvas, { heightAt: (x, z) => this.terrain.heightAt(x, z) });
    this.ground = new Ground({ env: this.env, scene: this.scene, renderer: this.renderer, aoScene: this.aoScene, quality: this.quality });
    this.buildings = new BuildingLayer({ env: this.env, scene: this.scene, shadowScene: this.shadowScene, aoScene: this.aoScene, quality: this.quality });
    this.trees = new TreeLayer({ env: this.env, scene: this.scene, shadowScene: this.shadowScene, terrain: this.terrain, quality: this.quality });
    this.buildings.onTrees = (tile, trees) => this.trees.add(tile.info.i * 1000 + tile.info.j, tile, trees);
    this.buildings.onTreesRemove = (tile) => this.trees.remove(tile.info.i * 1000 + tile.info.j);
    this.landmarks = new Landmarks({ env: this.env, scene: this.scene, shadowScene: this.shadowScene, terrain: this.terrain });
    this.aircraft = new Aircraft({ env: this.env, scene: this.scene });
    this.time = 0; this.last = performance.now();
    this.opts = { tilt: 0, fade: 1, aoDebug: params.get('debug') === 'ssao' };
    this.progress = 0;
    this.frames = 0; this.fps = 0; this._fpsT = 0; this._fpsN = 0;
    this._lastAo = -10;
    this.rig.set(VIEWS.hero);
    this.customView = false;
    if (params.get('cam')) {
      const [x, z, dist, heading, pitch] = params.get('cam').split(',').map(Number);
      this.rig.set({ x, z, dist, heading, pitch });
      this.customView = true;
    }
    if (params.get('hour')) { this.env.setHour(+params.get('hour')); this.customView = true; }
    this.season = 'autumn';
    if (params.get('season')) this.setSeason(params.get('season'), 0);
    this.hourChanged = true; this._hourAnim = null;
    this.ui = new UI(this, document.getElementById('ui'));
    this.labels = new Labels(this.ui.labelRoot);
    if (params.get('ui') === '0') document.body.classList.add('bare');
    if (params.get('labels') === '0') this.labels.setEnabled(false);
    this.rig.onUserInput = () => { this.ui.clearCurrent(); if (this.ui.tour) this.ui.setTour(false); };
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr) * (this.resScale || 1);
    this.pipeline.setSize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewH = h * dpr;
  }

  /** Keep the frame rate up on modest GPUs by trading a little resolution (never below 60% of the tier's pixel ratio). */
  _adaptResolution() {
    if (!this.loaded || document.hidden || params.get('fixedres')) return;
    this.resScale = this.resScale || 1;
    this._slow = this.fps < 27 ? (this._slow || 0) + 1 : 0;
    this._fast = this.fps > 55 ? (this._fast || 0) + 1 : 0;
    let s = this.resScale;
    if (this._slow >= 4 && s > 0.6) { s = Math.max(0.6, s * 0.85); this._slow = 0; }
    else if (this._fast >= 16 && s < 1) { s = Math.min(1, s * 1.1); this._fast = 0; }
    if (s !== this.resScale) { this.resScale = s; this.resize(); }
  }

  setHour(h) { this.env.setHour(h); this.hourChanged = true; }

  /** season: 'autumn' | 'snow' | 'summer' */
  setSeason(name, seconds = 1.8) {
    const target = { autumn: [0.62, 0], snow: [0.0, 1], summer: [0.0, 0] }[name];
    if (!target) return;
    this.season = name;
    const u = this.env.uniforms;
    this._seasonAnim = { from: [u.uSeason.value, u.uSnow.value], to: target, t: 0, dur: Math.max(0.01, seconds) };
  }
  stopHourAnimation() { this._hourAnim = null; }
  /** Glide the clock to a target hour. */
  animateHour(to, seconds = 2) {
    const from = this.env.hour;
    if (Math.abs(to - from) < 0.01) return;
    this._hourAnim = { from, to, t: 0, dur: seconds };
  }

  async start() {
    requestAnimationFrame((t) => this.frame(t));
    await this.terrain.loadData();
    const g = { x0: -32000, z0: -34000, x1: 32000, z1: 34000 };
    this.ground.setExtent(g.x0, g.z0, g.x1, g.z1);
    const groundReady = this.ground.load(this.terrain).then(() => this.terrain.build(this.ground.worker));
    const landmarksReady = this.landmarks.load().catch((e) => console.error('landmarks failed', e));
    const buildingsReady = this.buildings.load((p) => { this.progress = p; });
    landmarksReady.then(async () => {
      const L = this.landmarks.data;
      if (!L) return;
      const views = buildViews(L);
      this.ui.setViews(views);
      if (!this.customView) { for (const b of this.ui.places.children) b.classList.toggle('current', b.dataset.id === views[0].id); this.ui._current = views[0].id; }
      this.labels.add(this.landmarks.labels.map((m) => ({ ...m, kind: 'landmark', rank: m.rank || 2 })));
      try {
        const places = await fetchJSON('labels.json');
        this.labels.add(places.map((p) => ({ name: p.name, kind: p.kind, rank: p.rank, x: p.x, z: -p.y, y: this.terrain.heightAt(p.x, -p.y) + 12 })));
      } catch (e) { console.warn('labels failed', e); }
    });
    await Promise.all([groundReady, buildingsReady, landmarksReady]);
    this.loaded = true;
  }

  /** Resolves when streaming and animations have settled (used by the screenshot tool). */
  async settle(timeout = 60000) {
    const t0 = performance.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 250));
      const b = this.buildings;
      const busy = !this.loaded || b.pool.pending > 0 || b.anims.length > 0 || b._detailLoading > 0 || [...this.trees.tiles.values()].some((t) => t.t < 1) || (this.landmarks.mesh && this.landmarks.t < 1);
      if (!busy) { await new Promise((r) => setTimeout(r, 600)); if (b.pool.pending === 0 && b.anims.length === 0 && b._detailLoading === 0) return true; }
      if (performance.now() - t0 > timeout) return false;
    }
  }

  /** Offline rendering (tools/film.mjs): stop the live loop, then draw frames on demand with a fixed time step. */
  async captureFrame(pose, { dt = 1 / 30, hour, season } = {}) {
    this.capturing = true; this.customView = true;
    if (hour !== undefined) this.setHour(hour);
    if (season) { const u = this.env.uniforms; u.uSeason.value = season[0]; u.uSnow.value = season[1]; this._seasonAnim = null; }
    this.rig.set(pose);
    // let streaming and growth animations finish with the clock stopped, so nothing pops or grows on screen
    const b = this.buildings;
    const busy = () => b.pool.pending > 0 || b.anims.length > 0 || b._detailLoading > 0 || [...this.trees.tiles.values()].some((t) => t.t < 1);
    this.frozen = true;
    // tiles are scheduled a little after the camera moves: only stop once nothing has been in flight for several checks
    for (let i = 0, calm = 0; i < 1500 && calm < 4; i++) {
      this.tick(i === 0 ? dt : 0.2, false);
      calm = busy() ? 0 : calm + 1;
      await new Promise((r) => setTimeout(r, calm ? 4 : 10));
    }
    this.frozen = false;
    this.tick(dt, true);
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.capturing) return;
    this.tick(dt, true);
  }

  tick(dt, draw = true) {
    if (!this.frozen) this.time += dt;
    const time = this.time;
    if (this._hourAnim) {
      const a = this._hourAnim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = a.t * a.t * (3 - 2 * a.t);
      this.setHour(a.from + (a.to - a.from) * k);
      if (a.t >= 1) this._hourAnim = null;
    }
    if (this._seasonAnim) {
      const a = this._seasonAnim, u = this.env.uniforms;
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = a.t * a.t * (3 - 2 * a.t);
      u.uSeason.value = a.from[0] + (a.to[0] - a.from[0]) * k;
      u.uSnow.value = a.from[1] + (a.to[1] - a.from[1]) * k;
      if (a.t >= 1) this._seasonAnim = null;
    }
    // until someone takes the camera, the opening view breathes with a slow drift
    if (!this.rig.touched && !this.customView && !this.rig.flying && this.loaded) this.rig.goal.heading = VIEWS.hero.heading + 1.6 * Math.sin((time - (this._t0 ?? (this._t0 = time))) * 0.07);
    this.rig.update(dt);
    this.env.update(time);
    this.buildings.update(this.camera, dt, time, this.viewH);
    this.ground.update(this.camera, this.viewH);
    this.trees.update(this.camera, dt);
    this.landmarks.update(dt);
    this.aircraft.update(time);

    // ground AO / urban maps follow the buildings as they arrive
    if (this.buildings.aoDirty && (time - this._lastAo > 0.7 || this.capturing)) {
      this.ground.bakeAo(); this.buildings.aoDirty = false; this._lastAo = time;
    }
    // sun shadow map
    const c = this.rig.cur;
    const p = c.pitch * Math.PI / 180, h = c.heading * Math.PI / 180;
    const R0 = c.dist * 0.62;
    const R = THREE.MathUtils.clamp(c.dist * Math.min(2.4, 0.62 / Math.pow(Math.sin(p), 0.9)), 700, 52000);
    const shift = (R - R0) * 0.6;
    const center = new THREE.Vector3(c.x + Math.sin(h) * shift, 0, c.z - Math.cos(h) * shift);
    const changed = this.shadow.fit(center, R);
    if ((changed || this.buildings.shadowDirty || this.trees.dirty || this.landmarks.dirty) && this.env.shadowStrength > 0.001) {
      this.shadow.render(this.shadowScene);
      this.buildings.shadowDirty = false; this.trees.dirty = false; this.landmarks.dirty = false;
    }
    if (!draw) return;
    this.pipeline.render(this.scene, this.camera, this.env, time, this.opts);
    this.ui.update(dt);
    this.labels.update(this.camera, window.innerWidth, window.innerHeight);
    this.frames++;
    this._fpsN++; this._fpsT += dt;
    if (this._fpsT > 0.5) { this.fps = this._fpsN / this._fpsT; this._fpsN = 0; this._fpsT = 0; this._adaptResolution(); }
  }
}

function fail(message, detail) {
  console.error(message, detail || '');
  const box = document.createElement('p');
  box.className = 'fatal';
  box.textContent = message;
  document.getElementById('ui').append(box);
}

let app;
try {
  if (!document.createElement('canvas').getContext('webgl2')) throw new Error('no webgl2');
  if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
  app = new App();
} catch (e) {
  fail('这台设备的浏览器显示不了这座模型：需要支持 WebGL 2 的较新浏览器（Chrome、Edge、Safari 16.4 以上或 Firefox）。', e);
  throw e;
}
// Geometry lives only on the GPU (the CPU copies are freed after upload), so a lost context cannot be rebuilt in place: reload.
canvas.addEventListener('webglcontextlost', () => console.warn(`WebGL context lost at ${performance.now().toFixed(0)} ms (frames ${app.frames})`));
canvas.addEventListener('webglcontextrestored', () => location.reload());
window.__app = app;
app.start().catch((e) => fail('城市数据没有载入成功。请检查网络后刷新页面。', e));
