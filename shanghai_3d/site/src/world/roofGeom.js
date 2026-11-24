// Roof-top clutter for the street-level tiles (worker): stair bulkheads, lift motor rooms, water tanks, solar water
// heaters, plant rooms, cooling towers and rows of air-conditioning units, placed inside each flat roof's outline.
// Uses the building vertex layout, so it is drawn (and shadowed) with the building material.

import { MeshBuilder, obb, ringArea } from './buildingGeom.js';
import { ST, ROOF, KIND, STYLE } from './styles.js';

function inRing(x, y, r) {
  let inside = false;
  for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

export function buildRoofClutter(list, tile = 1000) {
  const B = new MeshBuilder(4096, 8192);
  const half = tile / 2;
  for (const d of list) {
    let vi = 0, ri = 0;
    for (let b = 0; b < d.nb; b++) {
      const nr = d.nrings[b];
      let px = 0, py = 0, outer = null;
      for (let r = 0; r < nr; r++) {
        const n = d.ringsize[ri++];
        const ring = r === 0 ? new Float32Array(n * 2) : null;
        for (let k = 0; k < n; k++, vi++) { px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1]; if (ring) { ring[k * 2] = px * 0.1 - half; ring[k * 2 + 1] = py * 0.1 - half; } }
        if (ring) outer = ring;
      }
      const style = d.style[b], height = d.height[b] * 0.1, H = (d.base[b] + d.height[b]) * 0.1;
      if (d.roof[b] !== ROOF.flat || nr > 1 || height < 6) continue;
      if (style === ST.canopy || style === ST.tank || style === ST.temple || style === ST.construction || style === ST.bigroof || style === ST.village || style === ST.lilong) continue;
      const area = Math.abs(ringArea(outer));
      if (area < 70) continue;
      const o = obb(outer);
      if (!o || o.hw < 3) continue;
      const S = STYLE[style] || STYLE[0];
      const ph = Math.min(S.parapet, height * 0.25);
      const y0 = H - ph;
      const seed = d.seed[b];
      B.b0 = style; B.b1 = seed; B.b2 = d.pal[b]; B.b3 = 1; B.e0 = 0; B.e1 = 0; B.f0 = 0; B.f1 = 120; B.f2 = 60; B.f3 = 0;
      const ax = o.ax, ay = o.ay, pxv = -o.ay, pyv = o.ax;
      // oriented box (s, t: centre in OBB coordinates; hl, hw half-sizes); rejected unless it sits on the roof
      const box = (s, t, hl, hw, h, kind, topKind) => {
        const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => [o.cx + ax * (s + a * hl) + pxv * (t + bb * hw), o.cy + ay * (s + a * hl) + pyv * (t + bb * hw)]);
        for (const q of c) if (!inRing(q[0], q[1], outer)) return false;
        const dirs = [[-pxv, -pyv], [ax, ay], [pxv, pyv], [-ax, -ay]];
        for (let k = 0; k < 4; k++) { const p0 = c[k], p1 = c[(k + 1) % 4]; B.face([[p0[0], y0, p0[1], 0], [p1[0], y0, p1[1], 2 * (k % 2 ? hw : hl)], [p1[0], y0 + h, p1[1], 2 * (k % 2 ? hw : hl)], [p0[0], y0 + h, p0[1], 0]], kind, dirs[k][0], 0, dirs[k][1], true); }
        B.face([[c[0][0], y0 + h, c[0][1]], [c[1][0], y0 + h, c[1][1]], [c[2][0], y0 + h, c[2][1]], [c[3][0], y0 + h, c[3][1]]], topKind ?? kind, 0, 1, 0);
        return true;
      };
      const r1 = hash(seed, 11), r2 = hash(seed, 23), r3 = hash(seed, 37);
      if (style === ST.resi_slab || style === ST.generic || style === ST.public) {
        // one stair bulkhead per staircase, a steel tank, and a run of solar water heaters along the sunny edge
        const n = Math.max(1, Math.round(o.hl * 2 / 17));
        for (let k = 0; k < n; k++) box(-o.hl + (k + 0.5) * o.hl * 2 / n, -o.hw * 0.25, 1.4, Math.min(2.2, o.hw * 0.4), 2.5, KIND.trim, KIND.roofFlat);
        if (r1 > 0.4) box(o.hl * (r2 - 0.5), o.hw * 0.3, 1.1, 1.1, 1.7, KIND.metal);
        if (style === ST.resi_slab && r3 > 0.35 && o.hl > 6) {
          // which long edge faces south? (north is +y in tile data space)
          const south = pyv < 0 ? 1 : -1;
          const t = south * (o.hw - 1.6);
          const L = o.hl - 1.5;
          // tilted collector strip + the row of tanks behind it
          const a0 = [o.cx + ax * -L + pxv * (t - 0.8 * south), o.cy + ay * -L + pyv * (t - 0.8 * south)], a1 = [o.cx + ax * L + pxv * (t - 0.8 * south), o.cy + ay * L + pyv * (t - 0.8 * south)];
          const b0 = [o.cx + ax * -L + pxv * (t + 0.6 * south), o.cy + ay * -L + pyv * (t + 0.6 * south)], b1 = [o.cx + ax * L + pxv * (t + 0.6 * south), o.cy + ay * L + pyv * (t + 0.6 * south)];
          if ([a0, a1, b0, b1].every((q) => inRing(q[0], q[1], outer))) {
            B.face([[b0[0], y0 + 0.35, b0[1], 0], [b1[0], y0 + 0.35, b1[1], 2 * L], [a1[0], y0 + 1.25, a1[1], 2 * L], [a0[0], y0 + 1.25, a0[1], 0]], KIND.glass, pxv * south, 0.7, pyv * south, true);
            box(0, t - 1.0 * south, L, 0.24, 1.5, KIND.metal);
          }
        }
      } else if (style === ST.resi_tower || style === ST.hotel) {
        box(0, 0, Math.min(5, o.hl * 0.45), Math.min(4, o.hw * 0.45), 3.6, KIND.trim, KIND.roofFlat);
        if (r1 > 0.3) box(o.hl * 0.55 * (r2 > 0.5 ? 1 : -1), 0, 1.3, 1.3, 2.0, KIND.metal);
      } else if (style === ST.office_glass || style === ST.office_grid) {
        // plant room set back from the edge, cooling towers beside it
        const hl = o.hl * 0.5, hw = o.hw * 0.45;
        if (hl > 3 && hw > 3) box(-o.hl * 0.12, 0, hl, hw, 4.2, KIND.equipment, KIND.roofFlat);
        const nt = 2 + Math.floor(r1 * 3);
        for (let k = 0; k < nt; k++) box(o.hl * 0.68, (k - (nt - 1) / 2) * 3.6, 1.5, 1.5, 3.0, KIND.metal);
      } else if (style === ST.retail || style === ST.industrial || style === ST.parking) {
        // rows of condensers and a few roof lights
        const nx = Math.min(8, Math.floor(o.hl * 2 / 9)), ny = Math.min(4, Math.floor(o.hw * 2 / 12));
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
          const hsh = hash(seed + i * 7, j * 13 + 5);
          const s = -o.hl + (i + 0.5) * o.hl * 2 / nx, t = -o.hw + (j + 0.5) * o.hw * 2 / ny;
          if (hsh < 0.45) box(s, t, 0.8, 0.55, 1.25, KIND.metal);
          else if (hsh > 0.8) box(s, t, 2.2, 1.2, 0.5, KIND.glass);
        }
      }
    }
  }
  return B.finish();
}
