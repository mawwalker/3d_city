// Chongqing 3D · 山城全景 — application bootstrap, DEM terrain, streaming city, hero landmarks & deferred frame loop.

import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { Environment } from './engine/env.js';
import { pickQuality } from './config.js';
import { Player } from './player/controller.js';
import { CollisionWorld } from './world/collision.js';
import { TerrainField, setActiveTerrain } from './world/terrain.js';
import { UI } from './ui/ui.js';
import { fetchJSON } from './world/data.js';
import { LocalLights } from './engine/lights.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');

// Default opening vista: elevated over the Jialing River facing Hongyadong's cliffside stilt houses,
// Qiansimen Cable-Stayed Bridge, Jiefangbei skyline, and Raffles City at the Two-Rivers confluence.
const DEFAULT_POSE = { x: -340, y: 165, z: -980, yaw: 118, pitch: -11 };

class App {
  constructor() {
    this.errors = [];
    window.addEventListener('error', (e) => this.errors.push(String(e.message || e.error || e)));
    window.addEventListener('unhandledrejection', (e) => this.errors.push(String(e.reason || e)));

    this.quality = pickQuality(params);
    this.pipeline = new Pipeline(canvas, this.quality);
    this.renderer = this.pipeline.renderer;
    this.env = new Environment(this.pipeline.atmosphere);
    this.scenes = {
      opaque: new THREE.Scene(),
      decals: new THREE.Scene(),
      shadow: new THREE.Scene(),
      moving: new THREE.Scene(),
      forward: null,
    };
    for (const s of Object.values(this.scenes)) if (s) s.matrixWorldAutoUpdate = true;

    const camFar = this.pipeline.reversed ? 160000 : 65000;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.35, camFar);
    this.time = 0; this.last = performance.now();
    this.frames = 0; this.fps = 0; this._fpsT = 0; this._fpsN = 0;
    this.focus = new THREE.Vector3();

    if (params.get('hour') !== null) this.env.setHour(+params.get('hour'));
    if (params.get('weather')) {
      this.env.setWeather(params.get('weather'));
      Object.assign(this.env.weather, this.env.weatherTarget);
      this.env.weatherTarget = null;
      this.env._dirty = true;
    }
    if (params.get('taa') === '0') this.pipeline.taaOn = false;
    if (params.get('ao') === '0') this.pipeline.aoOn = false;
    if (params.get('debug') !== null) this.pipeline.debugView = +params.get('debug');

    this.terrain = new TerrainField();
    this.lights = new LocalLights(this.pipeline);
    this.collision = new CollisionWorld(this.terrain);
    this.player = new Player(this.camera, canvas, this.collision);

    // Parse URL camera pose: ?pos=x,y,z (or x,auto,z or x,z) & ?look=yaw,pitch & ?mode=walk|fly
    this._pendingAutoY = false;
    this._explicitY = false;
    this.player.setPose(DEFAULT_POSE.x, DEFAULT_POSE.y, DEFAULT_POSE.z, DEFAULT_POSE.yaw, DEFAULT_POSE.pitch);
    if (params.get('pos')) {
      const parts = params.get('pos').split(',').map((s) => s.trim());
      if (parts.length === 2) {
        this.player.setPose(Number(parts[0]), DEFAULT_POSE.y, Number(parts[1]));
        this._pendingAutoY = true;
      } else if (parts.length >= 3) {
        const autoY = parts[1].toLowerCase() === 'auto' || Number.isNaN(Number(parts[1]));
        this.player.setPose(Number(parts[0]), autoY ? DEFAULT_POSE.y : Number(parts[1]), Number(parts[2]));
        this._pendingAutoY = autoY;
        this._explicitY = !autoY;
      }
    }
    if (params.get('look')) {
      const [yaw, pitch] = params.get('look').split(',').map(Number);
      this.player.setPose(this.player.pos.x, this.player.pos.y, this.player.pos.z, yaw, Number.isFinite(pitch) ? pitch : 0);
    }
    if (params.get('mode') === 'walk') {
      this.player.mode = 'walk';
      if (!this._explicitY) this._pendingAutoY = true;
    }

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

  sampleTerrain(x, z) { return this.terrain ? this.terrain.sample(x, z) : 0; }

  _snapPlayerToTerrain() {
    const p = this.player;
    const gx = p.pos.x, gz = p.pos.z;
    const surf = this.collision.surfaceBelow(gx, gz, 900);
    if (p.mode === 'walk') {
      p.setPose(gx, surf + 1.72, gz);
    } else {
      p.setPose(gx, Math.max(surf + 120, 140), gz);
    }
  }

  async start() {
    const world = params.get('world') || 'city';
    requestAnimationFrame((t) => this.frame(t));

    if (world === 'test') {
      this.terrain.initSynthetic();
      setActiveTerrain(this.terrain);
      this.collision.setTerrain(this.terrain);
      const { buildTestWorld } = await import('./world/testWorld.js');
      buildTestWorld(this.scenes);
    } else {
      // 1. Load real 2.5m core + 10m fine + 100m coarse DEM mountain terrain, landmarks & tunnel portals FIRST!
      this.ui.setProgress(0.05);
      const [, lmMeta, tunnelMeta] = await Promise.all([
        this.terrain.load(),
        fetchJSON('landmarks.json').catch(() => null),
        fetchJSON('tunnels.json').catch(() => null),
      ]);
      setActiveTerrain(this.terrain);
      this.env.setWaterY(this.terrain.waterY ?? 0.0);
      this.collision.setTerrain(this.terrain);
      if (this._pendingAutoY) this._snapPlayerToTerrain();
      this.ui.setProgress(0.14);

      // Compact hero structure & bridge abutment exclusion circles [wx, wz, r2] + exact OBBs [cx, cz, c, s, hx, hz]
      const heroZones = [];
      const heroBoxes = [];
      const addZ = (x, z, r) => { if (Number.isFinite(x) && Number.isFinite(z)) heroZones.push(x, z, r * r); };
      const addOBB = (x, z, rotY, hx, hz) => {
        if (Number.isFinite(x) && Number.isFinite(z)) heroBoxes.push(x, z, Math.cos(rotY || 0), Math.sin(rotY || 0), hx, hz);
      };
      const addBoxZones = (lm, pad = 4) => {
        if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.z)) return;
        const w = (lm.w || 40) * 0.5 + pad, d = (lm.d || 40) * 0.5 + pad;
        const r = Math.min(w, d);
        const span = Math.max(0, Math.max(w, d) - r);
        const a = lm.angle || 0;
        const ax = w >= d ? Math.cos(a) : -Math.sin(a), az = w >= d ? -Math.sin(a) : -Math.cos(a);
        const steps = span > r * 0.5 ? Math.max(2, Math.ceil(span / Math.max(r * 0.65, 8))) : 0;
        addZ(lm.x, lm.z, Math.max(r, Math.min(w, d) * 1.15));
        for (let s = 1; s <= steps; s++) {
          const off = (span * s) / steps;
          addZ(lm.x + ax * off, lm.z + az * off, r * 1.05);
          addZ(lm.x - ax * off, lm.z - az * off, r * 1.05);
        }
      };
      if (lmMeta) {
        if (lmMeta.hongyadong) {
          const h = lmMeta.hongyadong, fx = h.riverFacing?.[0] ?? -0.24, fz = h.riverFacing?.[1] ?? -0.97;
          const tx = -fz, tz = fx; // along facade (east/west)
          addZ(h.x, h.z, 48);
          addZ(h.x - fx * 36, h.z - fz * 36, 42); // 11F Cangbai slab & retaining wall toe
          addZ(h.x + fx * 46, h.z + fz * 46, 24); // 1F red bridge / waterfall front apron (q08 stray tree!)
          addZ(h.x + fx * 40 - tx * 55, h.z + fz * 40 - tz * 55, 22); // 1F west wall apron (t04 bus shelter!)
          addZ(h.x + fx * 40 + tx * 55, h.z + fz * 40 + tz * 55, 22); // 1F east wall apron
        }
        if (lmMeta.jiefangbei) addOBB(lmMeta.jiefangbei.x, lmMeta.jiefangbei.z, lmMeta.jiefangbei.angle, 24.6, 24.6); // exact 46m square raised terrace + 1.6m margin!
        if (lmMeta.raffles) addZ(lmMeta.raffles.x, lmMeta.raffles.z, 108);
        if (lmMeta.guotai) addZ(lmMeta.guotai.x, lmMeta.guotai.z, 58);
        if (lmMeta.wfc) addZ(lmMeta.wfc.x, lmMeta.wfc.z, 34);
        if (lmMeta.great_hall) addBoxZones(lmMeta.great_hall, 6);
        if (lmMeta.grand_theatre) addBoxZones(lmMeta.grand_theatre, 6);
        if (lmMeta.science_museum) addBoxZones(lmMeta.science_museum, 5);
        if (lmMeta.shibati) addBoxZones(lmMeta.shibati, 4);
        if (lmMeta.baixiangju) addBoxZones(lmMeta.baixiangju, 5);
        if (lmMeta.kuixinglou) addBoxZones(lmMeta.kuixinglou, 5);
        if (lmMeta.chongqing100) addZ(lmMeta.chongqing100.x, lmMeta.chongqing100.z, 46);
        if (lmMeta.nanshan_pavilion) addZ(lmMeta.nanshan_pavilion.x, lmMeta.nanshan_pavilion.z, 24);
        if (lmMeta.liziba) addZ(lmMeta.liziba.x, lmMeta.liziba.z, 24);
        if (lmMeta.cableway?.north) addZ(lmMeta.cableway.north.x, lmMeta.cableway.north.z, 22);
        if (lmMeta.cableway?.south) addZ(lmMeta.cableway.south.x, lmMeta.cableway.south.z, 22);
        for (const b of lmMeta.bridges || []) {
          if (b.id === 'sujiaba') addZ(b.x, b.z, 68);
          else if (b.id === 'huangjuewan') addZ(b.x, b.z, 145);
          else {
            if (b.p0) addZ(b.p0[0], b.p0[1], 22);
            if (b.p1) addZ(b.p1[0], b.p1[1], 22);
          }
        }
      }

      // Compact tunnel portal exclusion zones [x, z, dx, dz, hw] so workers clear trees, streetlights & signs around every portal!
      const tunnelZones = [];
      const rawTunnels = Array.isArray(tunnelMeta) ? tunnelMeta : (tunnelMeta?.portals || tunnelMeta?.tunnels || []);
      for (const p of rawTunnels) {
        if (!p || p.x < -14500 || p.x > 10500 || p.z < -12500 || p.z > 10500) continue;
        const l = Math.hypot(p.dx || 0, p.dz || 0);
        if (l < 1e-4) continue;
        const hw = Math.max(6.2, Math.min(22.0, p.width || 9.0)) * 0.5 + 0.5;
        tunnelZones.push(p.x, p.z, p.dx / l, p.dz / l, hw);
      }

      const [
        { City },
        { FarGround },
        { loadMaterialLibrary },
        { TreeLayer },
        { StreetLayer },
        { Landmarks },
        { Traffic },
        { PeopleLayer },
        { SignLayer },
        { TunnelPortals },
      ] = await Promise.all([
        import('./world/city.js'),
        import('./world/farGround.js'),
        import('./world/matlib.js'),
        import('./world/trees.js'),
        import('./world/street.js'),
        import('./world/landmarks.js'),
        import('./world/traffic.js'),
        import('./world/people.js'),
        import('./world/signs.js'),
        import('./world/tunnels.js'),
      ]);

      this.lib = await loadMaterialLibrary(this.renderer);
      this.ui.setProgress(0.24);

      this.city = new City({ scenes: this.scenes, env: this.env, quality: this.quality, lib: this.lib, terrain: this.terrain, heroZones, heroBoxes, tunnelZones });
      this.trees = new TreeLayer({ scenes: this.scenes, env: this.env, lib: this.lib, renderer: this.renderer, terrain: this.terrain });
      await this.trees.load();
      this.pipeline.onContextRestored = () => { if (this.trees) this.trees.rebake(); };
      this.street = new StreetLayer({ scenes: this.scenes, env: this.env, terrain: this.terrain });
      this.signs = new SignLayer({ scenes: this.scenes, env: this.env, quality: this.quality });
      this.people = params.get('people') === '0' ? null : new PeopleLayer({ scenes: this.scenes, env: this.env, terrain: this.terrain });
      this.traffic = params.get('traffic') === '0' ? null : new Traffic({ scenes: this.scenes, env: this.env, terrain: this.terrain, collision: this.collision });

      this.city.onTileNear = (t, out) => {
        const k = t.i * 1000 + t.j;
        if (out.col) this.collision.addTile(k, out.col);
        if (out.trees) this.trees.addTile(k, t, out.trees, this.city.grid);
        if (out.street) this.street.addTile(k, t, out.street);
        if (this.people && out.people) this.people.addTile(k, t, out.people);
        if (out.signs) this.signs.addTile(k, t, out.signs);
        if (out.decks && out.decks.segs && out.decks.segs.length) {
          const sg = out.decks.segs;
          for (let i = 0; i < sg.length; i += 7) {
            sg[i] += t.x; sg[i + 1] += t.z;
            sg[i + 3] += t.x; sg[i + 4] += t.z;
          }
          this.collision.addDecks(k, sg);
        }
        if (this.traffic && out.traffic) {
          this.traffic.addTile(k, out.traffic, this.city.grid.x0 + t.i * this.city.grid.tile, this.city.grid.y0 + t.j * this.city.grid.tile);
        }
      };

      this.city.onTileGone = (t) => {
        const k = t.i * 1000 + t.j;
        this.collision.removeTile(k);
        this.collision.removeDecks(k);
        this.trees.removeTile(k);
        this.street.removeTile(k);
        if (this.traffic) this.traffic.removeTile(k);
        if (this.people) this.people.removeTile(k);
        this.signs.removeTile(k);
      };

      await this.city.load((p) => { this.progress = p; this.ui.setProgress(0.24 + 0.44 * p); });

      // Curated places & labels
      fetchJSON('places.json')
        .then((pl) => {
          if (Array.isArray(pl) && pl.length) {
            this.ui.setPlaces(pl);
            this.ui.setLabels(pl.map((q) => ({ name: q.name, x: q.x, y: q.y ?? 70, z: q.z })));
          }
        })
        .catch(() => {});

      // Hero Landmarks (Hongyadong, Raffles City, Jiefangbei, Civic, Bridges, Liziba Monorail, Yangtze Cableway)
      this.landmarks = new Landmarks({
        scenes: this.scenes, env: this.env, terrain: this.terrain,
        matlib: this.lib, lib: this.lib, city: this.city, collision: this.collision, lights: this.lights,
      });
      const lmPromise = this.landmarks.load()
        .then(() => {
          const ll = this.landmarks.getLights();
          if (ll && ll.count > 0 && ll.packed && ll.packed.length) {
            this.lights.setLandmarkLights(ll.packed, ll.stride || 8);
          }
          const lbl = this.landmarks.getLabels();
          if (lbl && lbl.length) this.ui.mergeLabels(lbl);
          this.pipeline.shadows.invalidate();
          this.pipeline.heightField.dirty = true;
          if (this._pendingAutoY && this.player.mode === 'walk') this._snapPlayerToTerrain();
        })
        .catch((e) => { console.error('[landmarks] failed', e); this.errors.push('landmarks: ' + (e?.message || e)); });

      // Two-Rivers Boats & Golden Sightseeing Cruise Ships + Rain
      const boatsPromise = import('./world/boats.js')
        .then(({ Boats }) => { this.boats = new Boats({ scenes: this.scenes, env: this.env, terrain: this.terrain }); return this.boats.load(); })
        .catch((e) => { console.error('[boats] failed', e); this.errors.push('boats: ' + (e?.message || e)); });

      import('./world/rain.js')
        .then(({ Rain }) => { this.rain = new Rain({ scenes: this.scenes, env: this.env, pipeline: this.pipeline }); })
        .catch((e) => console.error('[rain] failed', e));

      // 3D Chongqing Tunnel Portals (隧道洞口) from site/data/tunnels.json (+ solid pier/wing/seal wall colliders!)
      this.tunnels = new TunnelPortals({ scenes: this.scenes, env: this.env, terrain: this.terrain });
      const tunnelsPromise = this.tunnels.load()
        .then(() => { if (this.tunnels.colliders) this.collision.addTile('tunnel-portals', this.tunnels.colliders); })
        .catch((e) => { console.warn('[tunnels] skipped', e?.message || e); });

      // Continuous 3D DEM Mountain Terrain + Two-Rivers Confluence Water + Far Roads/Decks
      this.farGround = new FarGround({ scenes: this.scenes, env: this.env, lib: this.lib, pool: this.city.pool, terrain: this.terrain });
      await Promise.all([
        this.farGround.load(this.city.grid, this.city.nearMask),
        lmPromise,
        boatsPromise,
        tunnelsPromise,
      ]);
      this.pipeline.shadows.invalidate();
      this.pipeline.heightField.dirty = true;
    }

    this.loaded = true;
    this.ui.setProgress(1, true);
  }

  /** Glide the clock to an hour of day. */
  glideHour(to) {
    let from = this.env.hour;
    if (to < from - 12) to += 24;
    else if (to > from + 12) to -= 24;
    this.animHour = { from, to, t: 0, dur: Math.min(4, 0.8 + Math.abs(to - from) * 0.35) };
  }

  /** Teleport to a named place (stands on terrain/deck in walk mode, hovers cleanly in fly mode). */
  gotoPlace(p) { this.gotoPoint(p.x, p.z, p.y); }
  gotoPoint(x, z, hintY = null) {
    const pl = this.player;
    const groundY = this.terrain ? this.terrain.surfaceY(x, z) : (hintY ?? 0);
    if (pl.mode === 'walk') {
      const surf = this.collision.surfaceBelow(x, z, groundY + 120);
      pl.setPose(x, Math.max(surf, groundY) + 1.72, z);
    } else {
      const a = pl.yaw;
      const fx = x - Math.sin(a) * 280, fz = z + Math.cos(a) * 280;
      const fg = this.terrain ? this.terrain.surfaceY(fx, fz) : groundY;
      pl.setPose(fx, Math.max(fg + 95, groundY + 115, Math.min(pl.pos.y, fg + 450)), fz, undefined, -16);
    }
    this.pipeline.historyValid = false;
  }

  /** Programmatic camera teleport for verifiers & scripts. */
  teleport(x, y, z, yaw, pitch, mode) {
    if (mode === 'walk' || mode === 'fly') this.player.setMode(mode);
    let ty = y;
    if (ty === 'auto' || ty === null || ty === undefined || Number.isNaN(Number(ty))) {
      const surf = this.collision.surfaceBelow(x, z, 900);
      ty = this.player.mode === 'walk' ? surf + 1.72 : Math.max(surf + 110, 140);
    }
    this.player.setPose(Number(x), Number(ty), Number(z), yaw !== undefined ? Number(yaw) : undefined, pitch !== undefined ? Number(pitch) : undefined);
    this.pipeline.historyValid = false;
  }

  /** Resolves when terrain, tiles, landmarks & TAA have settled (used by @verifier-art & @verifier-data). */
  async settle(timeout = 60000) {
    const t0 = performance.now();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    while (!this.loaded && performance.now() - t0 < timeout) await wait(100);
    for (let calm = 0; calm < 5 && performance.now() - t0 < timeout;) {
      await wait(120);
      calm = this.city && this.city.busy ? 0 : calm + 1;
    }
    const f0 = this.frames;
    while (this.frames < f0 + 36 && performance.now() - t0 < timeout) await wait(45);
    return true;
  }

  waitReady(timeout = 60000) { return this.settle(timeout); }

  stats() {
    const pos = this.player.pos;
    const groundY = this.terrain ? this.terrain.surfaceY(pos.x, pos.z) : 0;
    return {
      loaded: !!this.loaded,
      fps: +this.fps.toFixed(1),
      frames: this.frames,
      pos: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)],
      groundY: +groundY.toFixed(1),
      agl: +(pos.y - groundY).toFixed(1),
      mode: this.player.mode,
      hour: +this.env.hour.toFixed(2),
      weather: this.env.weatherName,
      ...(this.city ? this.city.counts : { far: 0, mid: 0, near: 0, tris: 0 }),
      jobs: this.city ? this.city.jobs : 0,
      trees: this.trees ? this.trees.count : 0,
      traffic: this.traffic ? this.traffic.count : 0,
      boats: this.boats ? this.boats.count : 0,
      landmarks: this.landmarks ? this.landmarks.stats : null,
      lights: this.lights ? this.lights.activeCount : 0,
      errors: this.errors.slice(),
    };
  }

  getStats() { return this.stats(); }

  /** GPU-synchronised timing of n frames (ms per frame & fps). */
  bench(n = 40) {
    const gl = this.renderer.getContext(), px = new Uint8Array(4);
    this.tick(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.tick(0.016);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / n;
    const info = this.renderer.info.render;
    return { ms: +ms.toFixed(2), fps: +(1000 / Math.max(ms, 0.01)).toFixed(1), calls: info.calls, tris: info.triangles };
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt);
  }

  tick(dt) {
    this.time += dt;
    if (this.animHour) {
      const a = this.animHour;
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = a.t * a.t * (3 - 2 * a.t);
      this.env.setHour(a.from + (a.to - a.from) * k);
      if (a.t >= 1) this.animHour = null;
    }

    this.player.hold = !!this.city && this.player.mode === 'walk' && !this.city.readyAt(this.player.pos.x, this.player.pos.z);
    this.player.update(dt);
    this.env.update(this.time, dt, this.pipeline.frame);

    if (this.city) {
      this.city.update(this.camera);
      if (this.farGround) this.farGround.update(this.camera);
      if (this.trees) {
        this.trees.update(this.camera);
        if (this.trees.dirty) { this.trees.dirty = false; this.pipeline.shadows.invalidate(); }
      }
      if (this.city.dirty) {
        this.city.dirty = false;
        this.pipeline.shadows.invalidate();
        this.pipeline.heightField.dirty = true;
      }
    }

    // Animated hero landmarks (Liziba CRT monorail trains, Yangtze Cableway cabins, Bridge rail trains)
    if (this.landmarks && this.landmarks.loaded) {
      this.landmarks.update(dt, this.time, this.env, this.camera);
    }

    // Chongqing Cyber-Night exposure & bloom tuning:
    // Crisp daylight exposure; at night keep sky/shadows deep so Hongyadong's golden glow,
    // Raffles sails, bridge towers, neon blade signs, and Two-Rivers cruise ships blaze!
    const nt = this.env.night, ex = this.pipeline.exposure;
    ex.key = 0.165 - 0.115 * nt;
    ex.max = 6.5 - 4.7 * nt;
    ex.bloom = 0.062 + 0.132 * nt;
    ex.bloomThreshold = 1.15 - 0.50 * nt;

    if (this.street) {
      this.street.update(this.camera);
      this.lights.update(this.camera, this.street.lights.values(), this.street.version, this.env.lights);
    } else if (this.landmarks && this.landmarks.loaded) {
      this.lights.update(this.camera, [], 0, this.env.lights);
    }

    const cam = this.camera.position;
    const groundY = this.terrain ? this.terrain.surfaceY(cam.x, cam.z) : 0;
    const agl = Math.max(0, cam.y - groundY);
    const dyn = agl < 220;

    // Maximize standard-Z depth buffer precision when EXT_clip_control reverse-Z is unavailable (fixes distant wall Z-fighting!)
    if (!this.pipeline.reversed) {
      let targetNear = 0.35;
      if (this.player.mode === 'fly' && agl > 28 && !this.collision.isNearSolid(cam.x, cam.z, cam.y, 12.0)) {
        targetNear = Math.min(2.5, Math.max(0.35, agl * 0.025));
      }
      if (Math.abs(this.camera.near - targetNear) > 0.05) {
        this.camera.near = targetNear;
        this.camera.updateProjectionMatrix();
      }
    }

    if (this.traffic) {
      const p = this.player;
      this.traffic.player = p.mode === 'walk' ? { x: p.pos.x, y: p.pos.y - 1.6, z: p.pos.z } : null;
      this.traffic.dynShadows = dyn;
      this.traffic.update(dt, this.time, this.camera, this.env.hour);
      this.lights.setDynamic(this.traffic.beams, this.traffic.nBeams);
    }
    if (this.rain) this.rain.update(this.camera);
    if (this.boats) this.boats.update(this.time, this.camera);
    if (this.people) this.people.update(dt, this.camera, this.env.hour, this.env.weather.wet || 0, dyn);

    const hasMovingHeroes = !!(this.landmarks && this.landmarks.movingRoot && this.landmarks.movingRoot.children.length > 0);
    this.pipeline.shadows.dynamic = dyn && ((this.traffic && this.traffic.count > 0) || (this.people && this.people.shown > 0) || hasMovingHeroes);

    this.pipeline.beginFrame(this.camera);
    this.focus.copy(cam);
    this.pipeline.render(this.scenes, this.camera, this.env, this.time, dt, {
      focus: this.focus,
      shadowScale: Math.max(1, agl / 20),
    });

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
  if (typeof WebGL2RenderingContext === 'undefined') throw new Error('no webgl2');
  app = new App();
} catch (e) {
  fail('这台设备的浏览器显示不了这座模型：需要支持 WebGL 2 的较新浏览器（Chrome、Edge、Safari 或 Firefox 的近期版本）。', e);
  throw e;
}
window.__app = app;
app.start().catch((e) => fail('城市数据没有载入成功。请检查服务是否启动后刷新页面。', e));
