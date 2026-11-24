// Ultra-detailed 3D rooftop architecture & equipment for Chongqing 3D (runs in Web Worker on near tiles).
// Terrain-anchored to exact footprint DEM elevation + synced with podium/tower setbacks (zero floating equipment!):
//   - Multi-part stairwell access bulkheads & elevator machine room penthouses with overhanging roof caps & louver vents
//   - HVAC chiller banks, paired cooling towers with recessed dark fan cowlings, chilled-water piping bridges
//   - Stainless-steel rooftop water tanks on concrete pedestals, solar collector arrays with tilted glass & header tanks
//   - Slender rooftop communication masts / skyscraper crown spires topped with pulsing red aviation warning beacons
//   - Illuminated architectural crown frames on CBD supertalls & high-rise hotels

import { MeshBuilder, obb, ringArea, insetRing, resolveFootprintGround, computeTowerRing } from './buildingGeom.js';
import { ST, ROOF, KIND, STYLE, computeStoreys } from './styles.js';

function inRing(x, y, r) {
  let inside = false;
  for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Build merged 3D rooftop equipment mesh for one near tile.
 * Signature supports both `buildRoofClutter(cols, tile, opts)` and `buildRoofClutter(cols, opts)`.
 */
export function buildRoofClutter(list, tileOrOpts = 1000, maybeOpts = {}) {
  const tile = typeof tileOrOpts === 'number' ? tileOrOpts : (tileOrOpts?.tile ?? 1000);
  const opts = typeof tileOrOpts === 'object' && tileOrOpts !== null ? tileOrOpts : (maybeOpts || {});
  const half = tile / 2;
  const ox = opts.ox ?? (opts.origin ? opts.origin[0] : 0);
  const oy = opts.oy ?? (opts.origin ? opts.origin[1] : 0);
  const cx = opts.cx ?? (ox + half);
  const cz = opts.cz ?? -(oy + half);

  let sampleY = null;
  if (opts.terrain && typeof opts.terrain.sample === 'function') {
    const T = opts.terrain;
    sampleY = (rx, rn) => T.sample(cx + rx, cz - rn);
  } else if (typeof opts.sampleTerrain === 'function') {
    const fn = opts.sampleTerrain;
    sampleY = (rx, rn) => fn(cx + rx, cz - rn);
  }

  const B = new MeshBuilder(8192, 16384);
  const sections = Array.isArray(list) ? list.filter(Boolean) : (list ? [list] : []);

  for (const d of sections) {
    let vi = 0, ri = 0;
    for (let b = 0; b < d.nb; b++) {
      const nr = d.nrings[b];
      let px = 0, py = 0, outer = null;
      for (let r = 0; r < nr; r++) {
        const n = d.ringsize[ri++];
        const ring = r === 0 ? new Float32Array(n * 2) : null;
        for (let k = 0; k < n; k++, vi++) {
          px += d.xy[vi * 2];
          py += d.xy[vi * 2 + 1];
          if (ring) {
            ring[k * 2] = px * 0.1 - half;
            ring[k * 2 + 1] = py * 0.1 - half;
          }
        }
        if (ring) outer = ring;
      }

      const style = d.style[b];
      const roof = d.roof[b];
      const height = d.height[b] * 0.1;
      const base = d.base[b] * 0.1;
      if ((roof !== ROOF.flat && roof !== ROOF.stepped_crown) || nr > 1 || height < 5.5) continue;
      if (style === ST.canopy || style === ST.tank || style === ST.temple || style === ST.construction ||
          style === ST.bigroof || style === ST.bayu_vernacular) continue;

      // Enforce CCW orientation matching buildingGeom.js
      if (ringArea(outer) < 0) {
        const n = outer.length / 2;
        const rr = new Float32Array(n * 2);
        for (let k = 0; k < n; k++) {
          rr[k * 2] = outer[(n - 1 - k) * 2];
          rr[k * 2 + 1] = outer[(n - 1 - k) * 2 + 1];
        }
        outer = rr;
      }

      const rec = {
        height,
        base,
        gzMin: d.ground_z_min ? d.ground_z_min[b] * 0.1 : NaN,
        gzMax: d.ground_z_max ? d.ground_z_max[b] * 0.1 : NaN,
        levels: d.levels[b],
        style,
        roof,
        seed: d.seed[b],
        pal: d.pal[b],
        flags: d.flags[b],
        podiumH: d.podium_h ? d.podium_h[b] * 0.25 : 0,
        balconyMask: d.balcony_mask ? d.balcony_mask[b] : 0,
        subtype: d.subtype ? d.subtype[b] : 0,
      };

      const st = computeStoreys(rec);
      const { S, ph, podiumH } = st;
      // Match buildingGeom.js setback tower ring so equipment never floats outside a setback roof!
      const towerRing = computeTowerRing(outer, rec, podiumH);
      const roofRing = towerRing || outer;
      const area = Math.abs(ringArea(roofRing));
      if (area < 55) continue;
      const o = obb(roofRing);
      if (!o || o.hw < 2.8) continue;

      // Resolve exact mountain-city roof deck elevation
      const gnd = resolveFootprintGround(outer, null, rec, sampleY);
      const H = gnd.yRef + base + height;
      let y0 = H - ph;
      // If buildingGeom added a stepped crown, raise equipment deck cleanly onto the crown top
      const hasSteppedCrown = roof === ROOF.stepped_crown ||
        ((style === ST.cbd_supertall || style === ST.office_glass) && height >= 68 && hash(rec.seed, 19) > 0.35);
      let activeRing = roofRing;
      if (hasSteppedCrown && o.hw >= 4.5) {
        const tier1 = insetRing(roofRing, Math.min(2.4, o.hw * 0.22));
        if (tier1) {
          const h1 = Math.min(6.5, Math.max(3.2, o.hw * 0.35));
          y0 = H + h1 - 0.8;
          activeRing = tier1;
        }
      }

      const seed = rec.seed;
      B.b0 = style; B.b1 = seed; B.b2 = rec.pal; B.b3 = 1;
      B.e0 = 0; B.e1 = height; B.e2 = gnd.yRef; B.e3 = 0;
      B.f0 = 0; B.f1 = 120; B.f2 = 60; B.f3 = 0;

      const ax = o.ax, ay = o.ay, pxv = -o.ay, pyv = o.ax;
      const pt = (s, t) => [o.cx + ax * s + pxv * t, o.cy + ay * s + pyv * t];

      // Oriented box helper validated inside activeRing
      const box = (s, t, hl, hw, h, kind, topKind = kind, baseY = y0, skipRingCheck = false) => {
        const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => pt(s + a * hl, t + bb * hw));
        if (!skipRingCheck) {
          for (const q of c) if (!inRing(q[0], q[1], activeRing)) return false;
        }
        const dirs = [[-pxv, -pyv], [ax, ay], [pxv, pyv], [-ax, -ay]];
        for (let k = 0; k < 4; k++) {
          const p0 = c[k], p1 = c[(k + 1) % 4];
          const w = 2 * (k % 2 ? hw : hl);
          B.face([
            [p0[0], baseY, p0[1], 0],
            [p1[0], baseY, p1[1], w],
            [p1[0], baseY + h, p1[1], w],
            [p0[0], baseY + h, p0[1], 0],
          ], kind, dirs[k][0], 0, dirs[k][1], true);
        }
        B.face([
          [c[0][0], baseY + h, c[0][1]],
          [c[1][0], baseY + h, c[1][1]],
          [c[2][0], baseY + h, c[2][1]],
          [c[3][0], baseY + h, c[3][1]],
        ], topKind, 0, 1, 0);
        return true;
      };

      // Sculpted elevator/stair penthouse with stepped overhanging drip cap, louver vent band & dark metal access door!
      // Non-overlapping Y strata so main shaft, lower cap, upper cap & hotel crown rim NEVER share coplanar faces!
      const penthouse = (s, t, hl, hw, h, wallKind) => {
        if (!box(s, t, hl, hw, h - 0.14, wallKind, KIND.trim)) return false;
        // Two-stepped overhanging concrete drip cap lip cleanly stacked above main shaft
        box(s, t, hl + 0.14, hw + 0.14, 0.14, KIND.trim, KIND.trim, y0 + h - 0.14, true);
        box(s, t, hl + 0.26, hw + 0.26, 0.18, KIND.trim, KIND.roofFlat, y0 + h + 0.005, true);
        // Dark steel maintenance access door (strictly proud of penthouse wall!) + louvered rain hood above
        if (hl >= 1.2 && h >= 2.4) {
          box(s, t + hw + 0.055, 0.46, 0.045, 2.04, KIND.darkFrame, KIND.darkFrame, y0 + 0.05, true);
          box(s, t + hw + 0.095, 0.56, 0.085, 0.10, KIND.steelBracket, KIND.steelBracket, y0 + 2.12, true);
        }
        return true;
      };

      // Industrial twin pipe / ductwork run connecting rooftop plant & chillers
      const pipeRun = (s0, t0, s1, t1, yPipe) => {
        const sm = (s0 + s1) * 0.5, tm = (t0 + t1) * 0.5;
        const ds = Math.abs(s1 - s0) * 0.5, dt = Math.abs(t1 - t0) * 0.5;
        if (ds >= dt) {
          box(sm, tm - 0.22, Math.max(ds, 0.3), 0.11, 0.22, KIND.steelBracket, KIND.steelBracket, yPipe, true);
          box(sm, tm + 0.22, Math.max(ds, 0.3), 0.11, 0.22, KIND.pvcPipe, KIND.pvcPipe, yPipe, true);
          // Pipe support sleepers
          box(s0 * 0.6 + s1 * 0.4, tm, 0.12, 0.44, yPipe - y0, KIND.trim, KIND.trim, y0, true);
          box(s0 * 0.4 + s1 * 0.6, tm, 0.12, 0.44, yPipe - y0, KIND.trim, KIND.trim, y0, true);
        } else {
          box(sm - 0.22, tm, 0.11, Math.max(dt, 0.3), 0.22, KIND.steelBracket, KIND.steelBracket, yPipe, true);
          box(sm + 0.22, tm, 0.11, Math.max(dt, 0.3), 0.22, KIND.pvcPipe, KIND.pvcPipe, yPipe, true);
        }
      };

      // Slender telecom mast + pulsing red aviation beacon at apex!
      const mast = (s, t, mh, baseY = y0, beacon = false) => {
        const q = pt(s, t);
        if (!inRing(q[0], q[1], activeRing)) return;
        box(s, t, 0.35, 0.35, 0.45, KIND.trim, KIND.trim, baseY, true);
        box(s, t, 0.09, 0.09, mh, KIND.metal, KIND.metal, baseY + 0.45, true);
        if (mh > 5.0) {
          // Crossbar dipole arrays projecting cleanly outside the mast shaft (zero coplanar mast overlap!)
          box(s - 0.39, t, 0.28, 0.05, 0.08, KIND.metal, KIND.metal, baseY + mh * 0.72, true);
          box(s + 0.39, t, 0.28, 0.05, 0.08, KIND.metal, KIND.metal, baseY + mh * 0.72, true);
          box(s, t - 0.39, 0.05, 0.28, 0.08, KIND.metal, KIND.metal, baseY + mh * 0.84, true);
          box(s, t + 0.39, 0.05, 0.28, 0.08, KIND.metal, KIND.metal, baseY + mh * 0.84, true);
        }
        if (beacon) {
          box(s, t, 0.22, 0.22, 0.38, KIND.aviationLight, KIND.aviationLight, baseY + 0.45 + mh, true);
        }
      };

      const r1 = hash(seed, 11), r2 = hash(seed, 23), r3 = hash(seed, 37), r4 = hash(seed, 53);

      // 1. Old walk-up, 1990s high-rise, generic, campus
      if (style === ST.resi_walkup || style === ST.resi_old_highrise || style === ST.generic || style === ST.campus) {
        const nStair = Math.max(1, Math.min(4, Math.round(o.hl * 2 / 18)));
        for (let k = 0; k < nStair; k++) {
          const s = -o.hl * 0.72 + (nStair === 1 ? o.hl * 0.72 : (k / (nStair - 1)) * o.hl * 1.44);
          penthouse(s, -o.hw * 0.20, 1.55, Math.min(2.3, o.hw * 0.38), 2.7, KIND.trim);
        }
        // Stainless water tank on raised concrete plinth
        if (r1 > 0.25) {
          const ts = o.hl * (r2 - 0.5) * 0.85, tt = o.hw * 0.30;
          if (box(ts, tt, 1.25, 1.25, 0.55, KIND.trim, KIND.trim)) {
            box(ts, tt, 1.05, 1.05, 1.85, KIND.metal, KIND.metal, y0 + 0.55, true);
          }
        }
        // Ventilation chimney stacks
        if (o.hl > 5) {
          box(-o.hl * 0.45, o.hw * 0.28, 0.42, 0.42, 1.45, KIND.trim, KIND.darkFrame);
          box(o.hl * 0.45, o.hw * 0.28, 0.42, 0.42, 1.45, KIND.trim, KIND.darkFrame);
        }
        // South-facing solar water heater collector arrays (classic Chinese rooftops!)
        if ((style === ST.resi_walkup || style === ST.resi_old_highrise) && r3 > 0.30 && o.hl > 5.5) {
          const south = pyv < 0 ? 1 : -1;
          const t = south * (o.hw - 1.7);
          const L = Math.min(o.hl - 1.6, 14.0);
          const a0 = pt(-L, t - 0.8 * south), a1 = pt(L, t - 0.8 * south);
          const b0 = pt(-L, t + 0.65 * south), b1 = pt(L, t + 0.65 * south);
          if ([a0, a1, b0, b1].every((q) => inRing(q[0], q[1], activeRing))) {
            B.face([
              [b0[0], y0 + 0.35, b0[1], 0],
              [b1[0], y0 + 0.35, b1[1], 2 * L],
              [a1[0], y0 + 1.30, a1[1], 2 * L],
              [a0[0], y0 + 1.30, a0[1], 0],
            ], KIND.glass, pxv * south, 0.72, pyv * south, true);
            box(0, t - 0.95 * south, L, 0.24, 1.55, KIND.metal, KIND.metal, y0, true);
          }
        }
        if (height >= 45) mast(o.hl * 0.25, -o.hw * 0.20, 6.0 + r4 * 4.0, y0, true);

      // 2. Contemporary Chongqing high-rise residential & hotels (30-45F!)
      } else if (style === ST.resi_modern || style === ST.hotel) {
        const phl = Math.min(5.2, o.hl * 0.42), phw = Math.min(4.2, o.hw * 0.42);
        const ok = penthouse(0, 0, phl, phw, 3.8, KIND.equipment);
        // Auxiliary twin water tank / chiller unit
        if (r1 > 0.25) {
          const sx = o.hl * 0.56 * (r2 > 0.5 ? 1 : -1);
          box(sx, 0, 1.35, 1.2, 2.1, KIND.metal, KIND.metal);
          box(sx, o.hw * 0.35, 0.9, 0.9, 1.5, KIND.metal, KIND.darkFrame);
        }
        // Rooftop telecom mast + red night aviation beacon!
        if (height >= 48) {
          const baseMast = ok ? y0 + 3.95 : y0;
          mast(ok ? phl * 0.45 : 0, ok ? phw * 0.35 : 0, 7.5 + r4 * 5.0, baseMast, true);
        }
        // Illuminated architectural crown rim on upscale high-rises / hotels (9cm proud of penthouse cap, zero Z-fighting!)
        if (height >= 70 && r3 > 0.45 && ok) {
          box(0, 0, phl + 0.35, phw + 0.35, 0.30, KIND.ledStrip, KIND.trim, y0 + 3.50, true);
        }

      // 3. CBD Supertalls, Glass/Grid Offices, Civic
      } else if (style === ST.cbd_supertall || style === ST.office_glass || style === ST.office_grid || style === ST.civic) {
        const phl = Math.min(8.5, o.hl * 0.48), phw = Math.min(6.5, o.hw * 0.44);
        let ok = false;
        if (phl > 2.4 && phw > 2.4) {
          ok = penthouse(-o.hl * 0.10, 0, phl, phw, 4.4, KIND.equipment);
        }
        // Bank of industrial cooling towers with circular fan collars + pipe bridge
        const nt = 2 + Math.floor(r1 * 3);
        let ctCount = 0;
        for (let k = 0; k < nt; k++) {
          const tPos = (k - (nt - 1) / 2) * 3.4;
          if (box(o.hl * 0.58, tPos, 1.45, 1.45, 3.1, KIND.metal, KIND.metal)) {
            // Raised fan cowling rim atop each cooling tower
            box(o.hl * 0.58, tPos, 0.85, 0.85, 0.45, KIND.darkFrame, KIND.darkFrame, y0 + 3.1, true);
            ctCount++;
          }
        }
        if (ctCount >= 2) {
          // Elevated twin chilled-water pipe & ductwork bridge connecting cooling towers to plant room
          pipeRun(o.hl * 0.12, 0, o.hl * 0.55, 0, y0 + 1.25);
        }
        // Iconic supertall crown spire / twin broadcast masts + pulsing red aviation beacons!
        if (height >= 55) {
          const spireH = style === ST.cbd_supertall ? (14.0 + r4 * 12.0) : (8.0 + r4 * 5.0);
          const mBase = ok ? y0 + 4.55 : y0;
          mast(ok ? -o.hl * 0.10 : 0, 0, spireH, mBase, true);
          if (style === ST.cbd_supertall && o.hl > 8) {
            mast(ok ? -o.hl * 0.10 + phl * 0.55 : o.hl * 0.3, 0, spireH * 0.65, mBase, true);
          }
        }

      // 4. Commercial malls, industrial halls, parking decks
      } else if (style === ST.commercial_mall || style === ST.industrial || style === ST.parking) {
        const nx = Math.min(7, Math.max(1, Math.floor(o.hl * 2 / 9.5)));
        const ny = Math.min(4, Math.max(1, Math.floor(o.hw * 2 / 11.5)));
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < ny; j++) {
            const hsh = hash(seed + i * 7, j * 13 + 5);
            const s = -o.hl * 0.82 + (i + 0.5) * (o.hl * 1.64) / nx;
            const t = -o.hw * 0.82 + (j + 0.5) * (o.hw * 1.64) / ny;
            if (hsh < 0.46) {
              // HVAC chiller / condenser box
              box(s, t, 1.05, 0.72, 1.45, KIND.metal, KIND.metal);
            } else if (hsh > 0.74) {
              // Raised glazed atrium skylight lantern
              if (box(s, t, 2.4, 1.35, 0.55, KIND.darkFrame, KIND.glass)) {
                box(s, t, 2.5, 0.08, 0.62, KIND.darkFrame, KIND.darkFrame, y0, true);
              }
            } else if (hsh < 0.60) {
              // Louvered exhaust box
              box(s, t, 1.2, 1.2, 1.8, KIND.equipment, KIND.roofFlat);
            }
          }
        }
      }
    }
  }
  return B.finish();
}
