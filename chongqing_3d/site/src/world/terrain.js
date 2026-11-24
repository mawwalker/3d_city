// Chongqing 3D DEM Terrain System (works identically on main thread AND inside Web Workers).
// Loads terrain.json + gzipped uint16 grids terrain_fine.bin (10m) & terrain_coarse.bin (100m).
// Coordinates: WebGL frame (x east, y up, z south); pipeline north = -z.
// Vertical datum: world_y = u16 * scale + offset (waterY = 0.0 m, datum_asl = 168.0 m).

import { fetchBinary, fetchJSON } from './data.js';

let _activeTerrain = null;

export function setActiveTerrain(t) { _activeTerrain = t; }
export function getActiveTerrain() { return _activeTerrain; }
export function sampleTerrain(x, z) { return _activeTerrain ? _activeTerrain.sample(x, z) : 0; }
export function sampleTerrainNormal(x, z, out) { return _activeTerrain ? _activeTerrain.sampleNormal(x, z, out) : [0, 1, 0]; }

export class TerrainField {
  constructor() {
    this.meta = null;
    this.core = null;
    this.coreData = null;
    this.fine = null;
    this.fineData = null;
    this.coarse = null;
    this.coarseData = null;
    this.datumAsl = 168.0;
    this.waterY = 0.0;
    this.riverY = 0.0;
    this.ready = false;
    this.synthetic = false;
  }

  /** Load terrain.json + core (2.5m road-benched), fine (10m) & coarse (100m) binary grids on the main thread. */
  async load() {
    try {
      const meta = await fetchJSON('terrain.json');
      const jobs = [];
      if (meta.fine && meta.fine.file) jobs.push(fetchBinary(meta.fine.file));
      else jobs.push(Promise.resolve(null));
      if (meta.coarse && meta.coarse.file) jobs.push(fetchBinary(meta.coarse.file));
      else jobs.push(Promise.resolve(null));
      if (meta.core && meta.core.file) jobs.push(fetchBinary(meta.core.file).catch(() => null));
      else jobs.push(Promise.resolve(null));
      const [fineBuf, coarseBuf, coreBuf] = await Promise.all(jobs);
      this.initFromBuffers(meta, fineBuf, coarseBuf, coreBuf);
    } catch (e) {
      console.warn('[terrain] terrain.json/bin unavailable, enabling synthetic Chongqing fallback:', e.message || e);
      this.initSynthetic();
    }
    setActiveTerrain(this);
    return this;
  }

  /** Initialize from already-fetched metadata and ArrayBuffers (used by both main thread & Web Workers). */
  initFromBuffers(meta, fineBuf, coarseBuf, coreBuf = null) {
    this.meta = meta;
    this.datumAsl = meta.datum_asl ?? 168.0;
    this.waterY = meta.waterY ?? 0.0;
    this.riverY = this.waterY;
    if (meta.core && coreBuf) {
      this.core = {
        x0: meta.core.x0, y0: meta.core.y0, cell: meta.core.cell,
        nx: meta.core.nx, ny: meta.core.ny,
        scale: meta.core.scale ?? 0.02, offset: meta.core.offset ?? -20.0,
        min: meta.core.min ?? -2.5, max: meta.core.max ?? 600,
      };
      this.coreData = coreBuf instanceof Uint16Array ? coreBuf : new Uint16Array(coreBuf);
    }
    if (meta.fine && fineBuf) {
      this.fine = {
        x0: meta.fine.x0, y0: meta.fine.y0, cell: meta.fine.cell,
        nx: meta.fine.nx, ny: meta.fine.ny,
        scale: meta.fine.scale ?? 0.1, offset: meta.fine.offset ?? -20.0,
        min: meta.fine.min ?? -2.5, max: meta.fine.max ?? 600,
      };
      this.fineData = fineBuf instanceof Uint16Array ? fineBuf : new Uint16Array(fineBuf);
    }
    if (meta.coarse && coarseBuf) {
      this.coarse = {
        x0: meta.coarse.x0, y0: meta.coarse.y0, cell: meta.coarse.cell,
        nx: meta.coarse.nx, ny: meta.coarse.ny,
        scale: meta.coarse.scale ?? 0.1, offset: meta.coarse.offset ?? -20.0,
        min: meta.coarse.min ?? -2.5, max: meta.coarse.max ?? 800,
      };
      this.coarseData = coarseBuf instanceof Uint16Array ? coarseBuf : new Uint16Array(coarseBuf);
    }
    this.ready = true;
    this.synthetic = false;
    setActiveTerrain(this);
  }

  /** Synthetic Chongqing Yuzhong ridge + two rivers + Nanshan fallback if DEM files are missing. */
  initSynthetic() {
    this.meta = { datum_asl: 168.0, waterY: 0.0, synthetic: true };
    this.datumAsl = 168.0;
    this.waterY = 0.0;
    this.riverY = 0.0;
    this.ready = true;
    this.synthetic = true;
    setActiveTerrain(this);
  }

  /** Return transferable/cloneable payload to initialize Web Workers. */
  serializeForWorker() {
    if (this.synthetic || !this.meta) return { synthetic: true };
    return {
      synthetic: false,
      meta: this.meta,
      coreBuf: this.coreData ? this.coreData.buffer.slice(this.coreData.byteOffset, this.coreData.byteOffset + this.coreData.byteLength) : null,
      fineBuf: this.fineData ? this.fineData.buffer.slice(this.fineData.byteOffset, this.fineData.byteOffset + this.fineData.byteLength) : null,
      coarseBuf: this.coarseData ? this.coarseData.buffer.slice(this.coarseData.byteOffset, this.coarseData.byteOffset + this.coarseData.byteLength) : null,
    };
  }

  /** True if (x, z) falls inside the high-resolution road-benched core DEM. */
  inCore(x, z) {
    const g = this.core;
    if (!g || !this.coreData) return false;
    const north = -z;
    return x >= g.x0 + g.cell && north >= g.y0 + g.cell && x < g.x0 + (g.nx - 1) * g.cell && north < g.y0 + (g.ny - 1) * g.cell;
  }

  _sampleGrid(g, data, x, north) {
    const fx = (x - g.x0) / g.cell - 0.5;
    const fy = (north - g.y0) / g.cell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return NaN;
    const tx = fx - i, ty = fy - j;
    const o = j * g.nx + i;
    const h00 = data[o], h10 = data[o + 1], h01 = data[o + g.nx], h11 = data[o + g.nx + 1];
    const h = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
    return h * g.scale + g.offset;
  }

  _sampleSynthetic(x, z) {
    // Approximate Yuzhong ridge around (0,0), Jialing river to north (-z > 550), Yangtze to south/east, Nanshan SE
    const n = -z;
    const ridge = Math.exp(-((n - 0) * (n - 0)) / (520 * 520)) * Math.exp(-((x - 100) * (x - 100)) / (2600 * 2600)) * 85;
    const nanshan = Math.exp(-((x - 2400) ** 2 + (n + 1600) ** 2) / (2400 * 2400)) * 310;
    const jialing = Math.exp(-((n - 780 + x * 0.12) ** 2) / (230 * 230));
    const yangtze = Math.exp(-((n + 920 - x * 0.25) ** 2) / (300 * 300));
    const river = Math.max(jialing, yangtze);
    if (river > 0.55) return -2.5;
    return Math.max(0.5, (ridge + nanshan + 22) * (1 - river * 0.8));
  }

  /** Fast bilinear terrain elevation in world metres (y up; waterY = 0.0) at WebGL (x east, z south). */
  sample(x, z) {
    if (this.synthetic) return this._sampleSynthetic(x, z);
    const north = -z;
    if (this.core && this.coreData) {
      const h = this._sampleGrid(this.core, this.coreData, x, north);
      if (h === h) return h;
    }
    if (this.fine && this.fineData) {
      const h = this._sampleGrid(this.fine, this.fineData, x, north);
      if (h === h) return h; // not NaN
    }
    if (this.coarse && this.coarseData) {
      const h = this._sampleGrid(this.coarse, this.coarseData, x, north);
      if (h === h) return h;
    }
    return this.waterY;
  }

  /** Convenience: surface height clamped to at least water surface. */
  surfaceY(x, z) {
    return Math.max(this.sample(x, z), this.waterY);
  }

  /** Unit world normal [nx, ny, nz] via central difference (tighter eps inside 2.5m core DEM). */
  sampleNormal(x, z, out = [0, 1, 0]) {
    const eps = this.inCore(x, z)
      ? Math.max(1.25, Math.min(2.0, this.core.cell * 0.6))
      : (this.fine ? Math.max(2.5, this.fine.cell * 0.45) : 5.0);
    const hL = this.sample(x - eps, z);
    const hR = this.sample(x + eps, z);
    const hU = this.sample(x, z - eps); // north (-z)
    const hD = this.sample(x, z + eps); // south (+z)
    const nx = hL - hR;
    const ny = 2.0 * eps;
    const nz = hU - hD;
    const inv = 1.0 / (Math.hypot(nx, ny, nz) || 1.0);
    out[0] = nx * inv; out[1] = ny * inv; out[2] = nz * inv;
    return out;
  }

  /** Alias expected by landmarks.js */
  normal(x, z, out) { return this.sampleNormal(x, z, out); }

  /** Slope steepness in [0, 1]: 0 = flat, 1 = vertical cliff. */
  slope(x, z) {
    const n = this.sampleNormal(x, z);
    return 1.0 - n[1];
  }
}
