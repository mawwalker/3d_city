// Shanghai · walkable panorama — application bootstrap and frame loop.

import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { Environment } from './engine/env.js';
import { pickQuality } from './config.js';
import { Player } from './player/controller.js';
import { CollisionWorld } from './world/collision.js';
import { UI } from './ui/ui.js';
import { fetchJSON } from './world/data.js';
import { LocalLights } from './engine/lights.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');

class App {
  constructor() {
    this.quality = pickQuality(params);
    this.pipeline = new Pipeline(canvas, this.quality);
    this.renderer = this.pipeline.renderer;
    this.env = new Environment(this.pipeline.atmosphere);
    this.scenes = { opaque: new THREE.Scene(), decals: new THREE.Scene(), shadow: new THREE.Scene(), moving: new THREE.Scene(), forward: null };     // moving: shadow casters redrawn every frame (traffic, people)
    for (const s of Object.values(this.scenes)) if (s) s.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.15, 150000);
    this.time = 0; this.last = performance.now();
    this.frames = 0; this.fps = 0; this._fpsT = 0; this._fpsN = 0;
    this.focus = new THREE.Vector3();
    if (params.get('hour')) this.env.setHour(+params.get('hour'));
    if (params.get('weather')) { this.env.setWeather(params.get('weather')); Object.assign(this.env.weather, this.env.weatherTarget); this.env.weatherTarget = null; this.env._dirty = true; }
    if (params.get('taa') === '0') this.pipeline.taaOn = false;
    if (params.get('ao') === '0') this.pipeline.aoOn = false;
    if (params.get('debug')) this.pipeline.debugView = +params.get('debug');
    // player: ?pos=x,y,z&look=yaw,pitch (degrees; yaw 0 = north, clockwise) &mode=walk|fly
    this.lights = new LocalLights(this.pipeline);
    this.collision = new CollisionWorld();
    this.player = new Player(this.camera, canvas, this.collision);
    this.player.setPose(1380, 250, -60, 80, -9);
    if (params.get('pos')) { const [x, y, z] = params.get('pos').split(',').map(Number); this.player.setPose(x, y, z); }
    if (params.get('look')) { const [yaw, pitch] = params.get('look').split(',').map(Number); this.player.setPose(this.player.pos.x, this.player.pos.y, this.player.pos.z, yaw, pitch || 0); }
    if (params.get('mode') === 'walk') this.player.mode = 'walk';
    this.ui = new UI(this, document.getElementById('ui'));
    if (params.get('ui') === '0') document.body.classList.add('bare');
    this.animHour = null;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr);
    this.pipeline.setSize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async start() {
    const world = params.get('world') || 'city';
    requestAnimationFrame((t) => this.frame(t));
    if (world === 'test') {
      const { buildTestWorld } = await import('./world/testWorld.js');
      buildTestWorld(this.scenes);
    } else {
      const [{ City }, { FarGround }, { loadMaterialLibrary }, { TreeLayer }, { StreetLayer }, { Landmarks }] = await Promise.all([import('./world/city.js'), import('./world/farGround.js'), import('./world/matlib.js'), import('./world/trees.js'), import('./world/street.js'), import('./world/landmarks.js')]);
      this.lib = await loadMaterialLibrary(this.renderer);
      this.city = new City({ scenes: this.scenes, env: this.env, quality: this.quality, lib: this.lib });
      this.trees = new TreeLayer({ scenes: this.scenes, env: this.env, lib: this.lib, renderer: this.renderer });
      await this.trees.load();
      this.street = new StreetLayer({ scenes: this.scenes, env: this.env });
      const { Traffic } = await import('./world/traffic.js');
      const { PeopleLayer } = await import('./world/people.js');
      const { SignLayer } = await import('./world/signs.js');
      this.signs = new SignLayer({ scenes: this.scenes, env: this.env, quality: this.quality });
      this.people = params.get('people') === '0' ? null : new PeopleLayer({ scenes: this.scenes, env: this.env });
      this.traffic = params.get('traffic') === '0' ? null : new Traffic({ scenes: this.scenes, env: this.env });
      this.city.onTileNear = (t, out) => { const k = t.i * 1000 + t.j; if (out.col) this.collision.addTile(k, out.col); this.trees.addTile(k, t, out.trees, this.city.grid); this.street.addTile(k, t, out.street);
        if (this.people && out.people) this.people.addTile(k, t, out.people);
        if (out.signs) this.signs.addTile(k, t, out.signs);
        if (this.traffic && out.traffic) this.traffic.addTile(k, out.traffic, this.city.grid.x0 + t.i * this.city.grid.tile, this.city.grid.y0 + t.j * this.city.grid.tile); if (out.decks && out.decks.segs.length) { const sg = out.decks.segs; for (let i = 0; i < sg.length; i += 7) { sg[i] += t.x; sg[i + 1] += t.z; sg[i + 3] += t.x; sg[i + 4] += t.z; } this.collision.addDecks(k, sg); } };
      this.city.onTileGone = (t) => { const k = t.i * 1000 + t.j; this.collision.removeTile(k); this.collision.removeDecks(k); this.trees.removeTile(k); this.street.removeTile(k); if (this.traffic) this.traffic.removeTile(k); if (this.people) this.people.removeTile(k); this.signs.removeTile(k); };
      await this.city.load((p) => { this.progress = p; this.ui.setProgress(0.15 + 0.85 * p); });
      fetchJSON('places.json').then((pl) => { this.ui.setPlaces(pl); this.ui.setLabels(pl.map((q) => ({ name: q.name, x: q.x, y: 70, z: q.z }))); }).catch(() => {});
      this.landmarks = new Landmarks({ scenes: this.scenes, env: this.env, city: this.city, collision: this.collision });
      this.landmarks.load().catch((e) => console.error('landmarks failed', e));
      import('./world/boats.js').then(({ Boats }) => { this.boats = new Boats({ scenes: this.scenes, env: this.env }); return this.boats.load(); }).catch((e) => console.error('boats failed', e));
      import('./world/rain.js').then(({ Rain }) => { this.rain = new Rain({ scenes: this.scenes, env: this.env, pipeline: this.pipeline }); }).catch((e) => console.error('rain failed', e));
      this.farGround = new FarGround({ scenes: this.scenes, env: this.env, lib: this.lib, pool: this.city.pool });
      await this.farGround.load(this.city.grid, this.city.nearMask);
    }
    this.loaded = true;
    this.ui.setProgress(1, true);
  }

  /** Glide the clock to an hour of day. */
  glideHour(to) { let from = this.env.hour; if (to < from - 12) to += 24; else if (to > from + 12) to -= 24; this.animHour = { from, to, t: 0, dur: Math.min(4, 0.8 + Math.abs(to - from) * 0.35) }; }

  /** Teleport: stand at a place when walking, hover in front of it when flying. */
  gotoPlace(p) { this.gotoPoint(p.x, p.z); }
  gotoPoint(x, z) {
    const pl = this.player;
    if (pl.mode === 'walk') pl.setPose(x, 2.0, z);
    else { const a = pl.yaw; pl.setPose(x - Math.sin(a) * 260, Math.max(120, Math.min(pl.pos.y, 600)), z + Math.cos(a) * 260, undefined, -18); }
    this.pipeline.historyValid = false;
  }

  /** Resolves when streaming has settled and TAA has converged (used by the screenshot tool). */
  async settle(timeout = 60000) {
    const t0 = performance.now();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    while (!this.loaded && performance.now() - t0 < timeout) await wait(100);
    for (let calm = 0; calm < 4 && performance.now() - t0 < timeout;) { await wait(120); calm = this.city && this.city.busy ? 0 : calm + 1; }
    const f0 = this.frames;
    while (this.frames < f0 + 40 && performance.now() - t0 < timeout) await wait(50);
    return true;
  }

  stats() { return this.city ? { ...this.city.counts, jobs: this.city.jobs, trees: this.trees ? this.trees.count : 0 } : null; }

  /** GPU-synchronised timing of n frames (ms per frame); for profiling from the console or the screenshot tool. */
  bench(n = 40) {
    const gl = this.renderer.getContext(), px = new Uint8Array(4);
    this.tick(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.tick(0.016);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const info = this.renderer.info.render;
    return { ms: +((performance.now() - t0) / n).toFixed(2), calls: info.calls, tris: info.triangles };
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt);
  }

  tick(dt) {
    this.time += dt;
    if (this.animHour) { const a = this.animHour; a.t = Math.min(1, a.t + dt / a.dur); const k = a.t * a.t * (3 - 2 * a.t); this.env.setHour(a.from + (a.to - a.from) * k); if (a.t >= 1) this.animHour = null; }
    this.player.hold = !!this.city && this.player.mode === 'walk' && !this.city.readyAt(this.player.pos.x, this.player.pos.z);
    this.player.update(dt);
    this.env.update(this.time, dt, this.pipeline.frame);
    if (this.city) {
      this.city.update(this.camera);
      if (this.farGround) this.farGround.update(this.camera);
      if (this.trees) { this.trees.update(this.camera); if (this.trees.dirty) { this.trees.dirty = false; this.pipeline.shadows.invalidate(); } }
      if (this.city.dirty) { this.city.dirty = false; this.pipeline.shadows.invalidate(); this.pipeline.heightField.dirty = true; }
    }
    // exposure: daylight adapts freely, the night is kept dark so that lamps and windows carry the picture
    const nt = this.env.night, ex = this.pipeline.exposure;
    ex.key = 0.16 - 0.118 * nt; ex.max = 6 - 4.6 * nt; ex.bloom = 0.06 + 0.10 * nt; ex.bloomThreshold = 1.2 - 0.5 * nt;
    if (this.street) { this.street.update(this.camera); this.lights.update(this.camera, this.street.lights.values(), this.street.version, this.env.lights); }
    if (this.traffic) {
      const p = this.player;
      this.traffic.player = p.mode === 'walk' ? { x: p.pos.x, y: p.pos.y - 1.6, z: p.pos.z } : null;
      this.traffic.dynShadows = this.camera.position.y < 160;
      this.traffic.update(dt, this.time, this.camera, this.env.hour);
      this.lights.setDynamic(this.traffic.beams, this.traffic.nBeams);
    }
    if (this.rain) this.rain.update(this.camera);
    if (this.boats) this.boats.update(this.time, this.camera);
    const dyn = this.camera.position.y < 160;
    if (this.people) this.people.update(dt, this.camera, this.env.hour, this.env.weather.wet || 0, dyn);
    this.pipeline.shadows.dynamic = dyn && ((this.traffic && this.traffic.count > 0) || (this.people && this.people.shown > 0));
    this.pipeline.beginFrame(this.camera);
    this.focus.copy(this.camera.position);
    this.pipeline.render(this.scenes, this.camera, this.env, this.time, dt, { focus: this.focus, shadowScale: Math.max(1, this.camera.position.y / 20) });
    this.frames++;
    this.ui.update(dt);
    this.ui.updateLabels(this.camera);
    this._fpsN++; this._fpsT += dt;
    if (this._fpsT > 0.5) { this.fps = this._fpsN / this._fpsT; this._fpsN = 0; this._fpsT = 0; }
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
  app = new App();
} catch (e) {
  fail('这台设备的浏览器显示不了这座模型：需要支持 WebGL 2 的较新浏览器（Chrome、Edge、Safari 或 Firefox 的近期版本）。', e);
  throw e;
}
window.__app = app;
app.start().catch((e) => fail('城市数据没有载入成功。请检查网络后刷新页面。', e));
