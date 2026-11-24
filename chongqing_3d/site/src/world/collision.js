// 3D Terrain-Aware Collision World for Chongqing 8D Mountain City:
//   - Base elevation from real DEM terrain (terrain.sample(x, z))
//   - Solid building prisms (footprint + base/top heights in world Y)
//   - Walkable elevated bridge/ramp/skybridge decks (segments [x0, z0, y0, x1, z1, y1, halfWidth])
//   - Walkable elevated horizontal plazas/terraces (addPlazas: walkable top, open underneath for 8D multi-level walking!)

const CELL = 24;

export class CollisionWorld {
  constructor(terrain = null) {
    this.terrain = terrain;
    this.tiles = new Map();
    this.grid = new Map();
    this.groundOffset = 0.15;
    this.version = 0;
    this.decks = new Map();
    this.deckGrid = new Map();
    this.plazas = new Map();
    this.plazaGrid = new Map();
  }

  setTerrain(terrain) { this.terrain = terrain; }

  /** Base DEM ground height at (x, z), clamped slightly above water surface so walker stands cleanly on riverbanks. */
  terrainY(x, z) {
    if (!this.terrain) return this.groundOffset;
    const h = this.terrain.sample(x, z);
    return h < -0.2 ? (this.terrain.waterY ?? 0) : h + this.groundOffset;
  }

  /** Register building/obstacle prisms for a tile or landmark set. */
  addTile(key, col) {
    if (this.tiles.has(key)) this.removeTile(key);
    const t = { ...col, cells: new Set() };
    const n = col.start.length;
    for (let b = 0; b < n; b++) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      const s = col.start[b], c = col.count[b];
      for (let k = 0; k < c; k++) {
        const x = col.xz[(s + k) * 2], z = col.xz[(s + k) * 2 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
      const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const ck = cx * 100003 + cz;
        let arr = this.grid.get(ck);
        if (!arr) { arr = []; this.grid.set(ck, arr); }
        arr.push(t, b);
        t.cells.add(ck);
      }
    }
    this.tiles.set(key, t);
    this.version++;
  }

  removeTile(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    for (const ck of t.cells) {
      const arr = this.grid.get(ck);
      if (!arr) continue;
      const out = [];
      for (let i = 0; i < arr.length; i += 2) if (arr[i] !== t) out.push(arr[i], arr[i + 1]);
      if (out.length) this.grid.set(ck, out); else this.grid.delete(ck);
    }
    this.tiles.delete(key);
    this.version++;
  }

  /** Walkable bridge / ramp / skybridge / stair segments: Float32Array [x0, z0, y0, x1, z1, y1, halfWidth] * n (world coords). */
  addDecks(key, segs) {
    if (this.decks.has(key)) this.removeDecks(key);
    if (!segs || !segs.length) return;
    const cells = new Set();
    for (let i = 0; i < segs.length; i += 7) {
      const hw = segs[i + 6] + 0.85;
      const cx0 = Math.floor((Math.min(segs[i], segs[i + 3]) - hw) / CELL);
      const cx1 = Math.floor((Math.max(segs[i], segs[i + 3]) + hw) / CELL);
      const cz0 = Math.floor((Math.min(segs[i + 1], segs[i + 4]) - hw) / CELL);
      const cz1 = Math.floor((Math.max(segs[i + 1], segs[i + 4]) + hw) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const ck = cx * 100003 + cz;
        let a = this.deckGrid.get(ck);
        if (!a) this.deckGrid.set(ck, a = []);
        a.push(segs, i);
        cells.add(ck);
      }
    }
    this.decks.set(key, { segs, cells });
    this.version++;
  }

  removeDecks(key) {
    const d = this.decks.get(key);
    if (!d) return;
    for (const ck of d.cells) {
      const a = this.deckGrid.get(ck);
      if (!a) continue;
      const out = [];
      for (let i = 0; i < a.length; i += 2) if (a[i] !== d.segs) out.push(a[i], a[i + 1]);
      if (out.length) this.deckGrid.set(ck, out); else this.deckGrid.delete(ck);
    }
    this.decks.delete(key);
    this.version++;
  }

  /** Walkable elevated plazas/terraces without blocking walls underneath (e.g., Hongyadong 11F, Kuixinglou 22F). */
  addPlazas(key, col) {
    if (this.plazas.has(key)) this.removePlazas(key);
    if (!col || !col.start || !col.start.length) return;
    const t = { ...col, cells: new Set() };
    const n = col.start.length;
    for (let b = 0; b < n; b++) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      const s = col.start[b], c = col.count[b];
      for (let k = 0; k < c; k++) {
        const x = col.xz[(s + k) * 2], z = col.xz[(s + k) * 2 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const ck = cx * 100003 + cz;
          let arr = this.plazaGrid.get(ck);
          if (!arr) this.plazaGrid.set(ck, arr = []);
          arr.push(t, b);
          t.cells.add(ck);
        }
      }
    }
    this.plazas.set(key, t);
    this.version++;
  }

  removePlazas(key) {
    const t = this.plazas.get(key);
    if (!t) return;
    for (const ck of t.cells) {
      const arr = this.plazaGrid.get(ck);
      if (!arr) continue;
      const out = [];
      for (let i = 0; i < arr.length; i += 2) if (arr[i] !== t) out.push(arr[i], arr[i + 1]);
      if (out.length) this.plazaGrid.set(ck, out); else this.plazaGrid.delete(ck);
    }
    this.plazas.delete(key);
    this.version++;
  }

  _inside(t, b, x, z) {
    const s = t.start[b], c = t.count[b], xz = t.xz;
    let inside = false;
    for (let i = 0, j = c - 1; i < c; j = i++) {
      const xi = xz[(s + i) * 2], zi = xz[(s + i) * 2 + 1];
      const xj = xz[(s + j) * 2], zj = xz[(s + j) * 2 + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Exact rendered deck surface height (tile deckGeom + hero bridges.js) at (x, z) closest to approxY within maxDiff, or NaN. */
  deckSurfaceAt(x, z, approxY, maxDiff = 9.0) {
    const ck = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
    const dk = this.deckGrid.get(ck);
    if (!dk) return NaN;
    let bestH = NaN, bestErr = maxDiff;
    for (let i = 0; i < dk.length; i += 2) {
      const s = dk[i], o = dk[i + 1];
      const ex = s[o + 3] - s[o], ez = s[o + 4] - s[o + 1], l2 = ex * ex + ez * ez;
      if (l2 < 1e-6) continue;
      const t = ((x - s[o]) * ex + (z - s[o + 1]) * ez) / l2;
      if (t < -0.15 || t > 1.15) continue;
      const tc = Math.min(1, Math.max(0, t));
      const qx = s[o] + ex * tc, qz = s[o + 1] + ez * tc;
      const hw = s[o + 6] + 0.65;
      if ((x - qx) * (x - qx) + (z - qz) * (z - qz) > hw * hw) continue;
      const h = s[o + 2] + (s[o + 5] - s[o + 2]) * tc;
      const err = Math.abs(h - approxY);
      if (err < bestErr) { bestErr = err; bestH = h; }
    }
    return bestH;
  }

  /** Highest walkable surface under (x, z) not above maxY: DEM terrain, building roofs, bridge decks, or elevated plazas. */
  surfaceBelow(x, z, maxY) {
    let y = this.terrainY(x, z);
    const ck = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
    const arr = this.grid.get(ck);
    if (arr) {
      for (let i = 0; i < arr.length; i += 2) {
        const t = arr[i], b = arr[i + 1];
        const top = t.top[b];
        if (top > y && top <= maxY && this._inside(t, b, x, z)) y = top;
      }
    }
    const pl = this.plazaGrid.get(ck);
    if (pl) {
      for (let i = 0; i < pl.length; i += 2) {
        const t = pl[i], b = pl[i + 1];
        const top = t.top[b];
        if (top > y && top <= maxY && this._inside(t, b, x, z)) y = top;
      }
    }
    const dk = this.deckGrid.get(ck);
    if (dk) {
      for (let i = 0; i < dk.length; i += 2) {
        const s = dk[i], o = dk[i + 1];
        const ex = s[o + 3] - s[o], ez = s[o + 4] - s[o + 1], l2 = ex * ex + ez * ez;
        if (l2 < 1e-6) continue;
        const t = ((x - s[o]) * ex + (z - s[o + 1]) * ez) / l2;
        if (t < -0.04 || t > 1.04) continue;
        const tc = Math.min(1, Math.max(0, t));
        const qx = s[o] + ex * tc, qz = s[o + 1] + ez * tc;
        if ((x - qx) * (x - qx) + (z - qz) * (z - qz) > s[o + 6] * s[o + 6]) continue;
        const h = s[o + 2] + (s[o + 5] - s[o + 2]) * tc;
        if (h > y && h <= maxY) y = h;
      }
    }
    return y;
  }

  /** True if point (x, z) overlaps the interior of any solid prism in vertical range [y0, y1]. */
  isInsideSolid(x, z, y0, y1) {
    const arr = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!arr) return false;
    for (let i = 0; i < arr.length; i += 2) {
      const t = arr[i], b = arr[i + 1];
      if (y1 <= t.base[b] + 0.05 || y0 >= t.top[b] - 0.05) continue;
      if (this._inside(t, b, x, z)) return true;
    }
    return false;
  }

  /** True if (x, y, z) is within `pad` horizontal metres of any solid prism spanning y. */
  isNearSolid(x, z, y, pad = 10.0) {
    const p2 = pad * pad;
    const cx0 = Math.floor((x - pad) / CELL), cx1 = Math.floor((x + pad) / CELL);
    const cz0 = Math.floor((z - pad) / CELL), cz1 = Math.floor((z + pad) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const arr = this.grid.get(cx * 100003 + cz);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 2) {
        const t = arr[i], b = arr[i + 1];
        if (y + pad < t.base[b] || y - pad > t.top[b]) continue;
        if (this._inside(t, b, x, z)) return true;
        const s = t.start[b], c = t.count[b], xz = t.xz;
        for (let k = 0, j = c - 1; k < c; j = k++) {
          const ax = xz[(s + j) * 2], az = xz[(s + j) * 2 + 1];
          const ex = xz[(s + k) * 2] - ax, ez = xz[(s + k) * 2 + 1] - az, l2 = ex * ex + ez * ez;
          let tt = l2 > 1e-8 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
          if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
          const dx = x - (ax + ex * tt), dz = z - (az + ez * tt);
          if (dx * dx + dz * dz < p2) return true;
        }
      }
    }
    return false;
  }

  /** Push a vertical capsule (centre x, z; feet y0, head y1) out of overlapping solid building/water/tunnel prisms. */
  resolve(p, radius, y0, y1, prevX = NaN, prevZ = NaN) {
    const startInside = Number.isFinite(prevX) ? this.isInsideSolid(prevX, prevZ, y0, y1) : false;
    let hit = false;
    for (let iter = 0; iter < 6; iter++) {
      let moved = false;
      const cx0 = Math.floor((p.x - radius) / CELL), cx1 = Math.floor((p.x + radius) / CELL);
      const cz0 = Math.floor((p.z - radius) / CELL), cz1 = Math.floor((p.z + radius) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.grid.get(cx * 100003 + cz);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i += 2) {
          const t = arr[i], b = arr[i + 1];
          if (y1 <= t.base[b] + 0.05 || y0 >= t.top[b] - 0.05) continue;
          const s = t.start[b], c = t.count[b], xz = t.xz;
          let best = 1e9, bx = 0, bz = 0;
          for (let k = 0, j = c - 1; k < c; j = k++) {
            const ax = xz[(s + j) * 2], az = xz[(s + j) * 2 + 1];
            const ex = xz[(s + k) * 2] - ax, ez = xz[(s + k) * 2 + 1] - az;
            const l2 = ex * ex + ez * ez;
            let tt = l2 > 0 ? ((p.x - ax) * ex + (p.z - az) * ez) / l2 : 0;
            tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
            const qx = ax + ex * tt, qz = az + ez * tt;
            const d2 = (p.x - qx) * (p.x - qx) + (p.z - qz) * (p.z - qz);
            if (d2 < best) { best = d2; bx = qx; bz = qz; }
          }
          const inside = this._inside(t, b, p.x, p.z);
          const d = Math.sqrt(best);
          if (inside) {
            const nx = d > 1e-5 ? (bx - p.x) / d : 1, nz = d > 1e-5 ? (bz - p.z) / d : 0;
            p.x = bx + nx * radius; p.z = bz + nz * radius; moved = hit = true;
          } else if (d < radius) {
            const nx = d > 1e-5 ? (p.x - bx) / d : 1, nz = d > 1e-5 ? (p.z - bz) / d : 0;
            p.x = bx + nx * radius; p.z = bz + nz * radius; moved = hit = true;
          }
        }
      }
      if (!moved) break;
    }
    // Fail-safe against acute multi-building V-corner tunneling: if start was outside and push failed, stay at previous safe pos!
    if (hit && !startInside && Number.isFinite(prevX) && this.isInsideSolid(p.x, p.z, y0, y1)) {
      p.x = prevX; p.z = prevZ;
    }
    return hit;
  }

  raycast(ox, oz, dx, dz, maxT, y) {
    let best = -1;
    const steps = Math.ceil(maxT / CELL) + 1;
    const seen = new Set();
    for (let sIdx = 0; sIdx <= steps; sIdx++) {
      const tt = Math.min(maxT, sIdx * CELL);
      const ck = Math.floor((ox + dx * tt) / CELL) * 100003 + Math.floor((oz + dz * tt) / CELL);
      if (seen.has(ck)) continue; seen.add(ck);
      const arr = this.grid.get(ck);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 2) {
        const t = arr[i], b = arr[i + 1];
        if (y < t.base[b] || y > t.top[b]) continue;
        const s = t.start[b], c = t.count[b], xz = t.xz;
        for (let k = 0, j = c - 1; k < c; j = k++) {
          const ax = xz[(s + j) * 2], az = xz[(s + j) * 2 + 1];
          const ex = xz[(s + k) * 2] - ax, ez = xz[(s + k) * 2 + 1] - az;
          const den = dx * ez - dz * ex;
          if (Math.abs(den) < 1e-9) continue;
          const u = ((ax - ox) * ez - (az - oz) * ex) / den, v = ((ax - ox) * dz - (az - oz) * dx) / den;
          if (u >= 0 && u <= maxT && v >= 0 && v <= 1 && (best < 0 || u < best)) best = u;
        }
      }
    }
    return best;
  }
}
