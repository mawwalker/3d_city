// Collision world for the walker: buildings are prisms (footprint + base / top heights), so everything reduces to 2D
// segment tests in plan plus a "what am I standing on" query. Tiles register their footprints as they stream in.

const CELL = 24;

export class CollisionWorld {
  constructor() {
    this.tiles = new Map();          // key -> { xz, start, count, base, top, cells: [cellKey...] }
    this.grid = new Map();           // cellKey -> [ [tile, buildingIndex], ... ]
    this.groundY = 0.15;
    this.version = 0;
    this.decks = new Map(); this.deckGrid = new Map();
  }

  /** col: { xz: Float32Array (world x, z pairs), start: Uint32Array, count: Uint16Array, base: Float32Array, top: Float32Array } */
  addTile(key, col) {
    if (this.tiles.has(key)) this.removeTile(key);
    const t = { ...col, cells: new Set() };
    const n = col.start.length;
    for (let b = 0; b < n; b++) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      const s = col.start[b], c = col.count[b];
      for (let k = 0; k < c; k++) { const x = col.xz[(s + k) * 2], z = col.xz[(s + k) * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL), cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
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

  /** Walkable decks: segs = [x0, z0, y0, x1, z1, y1, halfWidth] * n in world coordinates. */
  addDecks(key, segs) {
    if (!segs || !segs.length) return;
    const cells = new Set();
    for (let i = 0; i < segs.length; i += 7) {
      const hw = segs[i + 6];
      const cx0 = Math.floor((Math.min(segs[i], segs[i + 3]) - hw) / CELL), cx1 = Math.floor((Math.max(segs[i], segs[i + 3]) + hw) / CELL);
      const cz0 = Math.floor((Math.min(segs[i + 1], segs[i + 4]) - hw) / CELL), cz1 = Math.floor((Math.max(segs[i + 1], segs[i + 4]) + hw) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) { const ck = cx * 100003 + cz; let a = this.deckGrid.get(ck); if (!a) this.deckGrid.set(ck, a = []); a.push(segs, i); cells.add(ck); }
    }
    this.decks.set(key, { segs, cells });
  }
  removeDecks(key) {
    const d = this.decks.get(key);
    if (!d) return;
    for (const ck of d.cells) { const a = this.deckGrid.get(ck); if (!a) continue; const out = []; for (let i = 0; i < a.length; i += 2) if (a[i] !== d.segs) out.push(a[i], a[i + 1]); if (out.length) this.deckGrid.set(ck, out); else this.deckGrid.delete(ck); }
    this.decks.delete(key);
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

  _inside(t, b, x, z) {
    const s = t.start[b], c = t.count[b], xz = t.xz;
    let inside = false;
    for (let i = 0, j = c - 1; i < c; j = i++) {
      const xi = xz[(s + i) * 2], zi = xz[(s + i) * 2 + 1], xj = xz[(s + j) * 2], zj = xz[(s + j) * 2 + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Height of the highest surface under (x, z) that is not above maxY (roof tops count, the street is the fallback). */
  surfaceBelow(x, z, maxY) {
    let y = this.groundY;
    const arr = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (arr) {
      for (let i = 0; i < arr.length; i += 2) {
        const t = arr[i], b = arr[i + 1];
        const top = t.top[b];
        if (top > y && top <= maxY && this._inside(t, b, x, z)) y = top;
      }
    }
    const dk = this.deckGrid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (dk) {
      for (let i = 0; i < dk.length; i += 2) {
        const s = dk[i], o = dk[i + 1];
        const ex = s[o + 3] - s[o], ez = s[o + 4] - s[o + 1], l2 = ex * ex + ez * ez;
        if (l2 < 1e-6) continue;
        const t = ((x - s[o]) * ex + (z - s[o + 1]) * ez) / l2;
        if (t < -0.02 || t > 1.02) continue;
        const qx = s[o] + ex * t, qz = s[o + 1] + ez * t;
        if ((x - qx) * (x - qx) + (z - qz) * (z - qz) > s[o + 6] * s[o + 6]) continue;
        const h = s[o + 2] + (s[o + 5] - s[o + 2]) * Math.min(1, Math.max(0, t));
        if (h > y && h <= maxY) y = h;
      }
    }
    return y;
  }

  /**
   * Push a vertical capsule (centre x, z; feet at y0, head at y1) out of every wall it overlaps. Mutates `p` ({x, z}).
   * Returns true when something was hit.
   */
  resolve(p, radius, y0, y1) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const cx0 = Math.floor((p.x - radius) / CELL), cx1 = Math.floor((p.x + radius) / CELL), cz0 = Math.floor((p.z - radius) / CELL), cz1 = Math.floor((p.z + radius) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.grid.get(cx * 100003 + cz);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i += 2) {
          const t = arr[i], b = arr[i + 1];
          // vertical overlap: the body must be between the block's base and top (standing on the roof is not a hit)
          if (y1 <= t.base[b] + 0.05 || y0 >= t.top[b] - 0.05) continue;
          const s = t.start[b], c = t.count[b], xz = t.xz;
          let best = 1e9, bx = 0, bz = 0;
          for (let k = 0, j = c - 1; k < c; j = k++) {
            const ax = xz[(s + j) * 2], az = xz[(s + j) * 2 + 1], ex = xz[(s + k) * 2] - ax, ez = xz[(s + k) * 2 + 1] - az;
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
            // deep inside a block (teleported or squeezed): step out through the nearest wall
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
    return hit;
  }

  /** First wall hit by a horizontal ray (ox, oz) + t * (dx, dz), t in [0, maxT], at height y. Returns t or -1. */
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
          const ax = xz[(s + j) * 2], az = xz[(s + j) * 2 + 1], ex = xz[(s + k) * 2] - ax, ez = xz[(s + k) * 2 + 1] - az;
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
