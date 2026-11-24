// 解放碑商圈核心建筑群 (Jiefangbei CBD Hero Landmarks) + 陆海国际中心 (Chongqing 100 at Hualongqiao)
//
// Landmarks built with museum-grade architectural modeling:
//  1. 人民解放纪念碑 (Jiefangbei Monument, 27.5m, world origin 0,0) — exact octagonal stepped base,
//     beveled plinth, fluted octagonal shaft, 4 illuminated clock faces, overhanging circular viewing
//     balcony with corbel brackets & carved balustrade, upper cupola, flagpole & anemometer spire,
//     surrounded by patterned granite pedestrian square!
//  2. 国泰艺术中心 (Guotai Arts Center) — 140+ interlocking 3D cantilevered crimson-red & obsidian-black
//     steel "chopstick" box-beams (题字红黑交错悬挑梁) flaring dramatically outward over recessed dark
//     curtain-wall theatre volumes & stepped granite entry plaza!
//  3. 重庆环球金融中心 (Chongqing WFC, 339m) — stepped crystalline glass setback supertall with dense 3D
//     vertical silver fins, mechanical louver bands, grand podium & glowing glass sky-lantern crown!
//  4. 陆海国际中心 (Chongqing 100 / Land-Sea Intl Center, 458m at Hualongqiao) — tallest tower in Chongqing:
//     sculpted tapered faceted shaft, corner mega-columns, vertical fins, glowing slanted crystal crown!

import * as THREE from 'three';
import { HeroKit, MAT } from './kit.js';

const TAU = Math.PI * 2;

const FALLBACKS = {
  jiefangbei:   { x: 0,     z: 0,    baseY: 85, angle: 0,     w: 48, d: 48, h: 27.5 },
  guotai:       { x: 185,   z: -210, baseY: 78, angle: 0.25,  w: 84, d: 68, h: 36 },
  wfc:          { x: 145,   z: 45,   baseY: 84, angle: 0.12,  w: 62, d: 54, h: 339 },
  chongqing100: { x: -4950, z: -260, baseY: 32, angle: -0.22, w: 72, d: 72, h: 458 },
};

function toWorld(cx, cy, cz, rotY, lx, ly, lz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
}
function xyObj([wx, , wz]) { return { x: wx, z: wz }; }

function octRing(r, rot = Math.PI / 8) {
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const a = rot + (k / 8) * TAU;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function chamferRect(hx, hz, ch) {
  return [
    [-hx + ch, hz], [hx - ch, hz],
    [hx, hz - ch], [hx, -hz + ch],
    [hx - ch, -hz], [-hx + ch, -hz],
    [-hx, -hz + ch], [-hx, hz - ch],
  ];
}

// ===================================================================================================
// 1. 人民解放纪念碑 (Jiefangbei Monument, 27.5m)
// ===================================================================================================
function addJiefangbei(group, P, terrain, materials, makePlaque, makeClockFace, prisms, plazas, lights, labels) {
  const cx = P.x ?? 0, cz = P.z ?? 0, rotY = P.angle ?? 0;
  // Sample full 46m square perimeter so uphill DEM NEVER pokes through the granite square & downhill plinth drops below grade!
  const perimHs = [[-23, -23], [0, -23], [23, -23], [23, 0], [23, 23], [0, 23], [-23, 23], [-23, 0]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const maxDEM = Math.max(...perimHs), minDEM = Math.min(...perimHs);
  const y0 = Math.max(Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz), maxDEM + 0.18);
  const skirtDrop = Math.max(12, y0 - minDEM + 4.5);

  const K = new HeroKit();
  const C_IVORY   = [0.76, 0.74, 0.68];
  const C_IVORY_D = [0.64, 0.61, 0.55];
  const C_GRANITE = [0.52, 0.50, 0.47];
  const C_GRAN_DK = [0.34, 0.33, 0.31];
  const C_BRONZE  = [0.36, 0.28, 0.16];
  const C_GOLD    = [0.88, 0.68, 0.22];

  // ---- Patterned Granite Pedestrian Square (46m x 46m) with clean >=0.06m stepped vertical offsets (ZERO Z-fighting!) ----
  K.style(C_GRAN_DK, 0.80, 0, 0, MAT.STONE, 0.55);
  K.box(0, -skirtDrop / 2, 0, 48, skirtDrop, 48);
  K.style(C_GRANITE, 0.65, 0, 0, MAT.GRANITE, 1.4);
  K.box(0, 0.07, 0, 46, 0.14, 46);
  // Decorative inlaid radial granite medallion around the monument (strictly >=0.06m proud per step!)
  K.style(C_GRAN_DK, 0.58, 0, 0, MAT.GRANITE, 0.9);
  K.prism(octRing(16.5), 0.14, 0.20);
  K.style([0.62, 0.59, 0.54], 0.58, 0, 0, MAT.GRANITE, 0.8);
  K.prism(octRing(14.8), 0.20, 0.26);
  // Radial stone compass stripes strictly outside r=16.5 medallion (ZERO overlap!)
  for (let k = 0; k < 8; k++) {
    K.push().rotateY(k * Math.PI / 4);
    K.style(C_GRAN_DK, 0.62, 0, 0, MAT.GRANITE, 0.6);
    K.box(0, 0.17, 19.8, 0.75, 0.06, 6.0);
    K.pop();
  }
  // Carved stone plaza seating benches with timber slats, ornamental tree planters & heritage bronze streetlamps
  for (let k = 0; k < 4; k++) {
    K.push().rotateY(k * Math.PI / 2 + Math.PI / 4);
    K.style(C_GRANITE, 0.68, 0, 0, MAT.GRANITE, 0.8);
    K.box(0, 0.46, 17.5, 6.8, 0.72, 1.9);
    K.style([0.36, 0.22, 0.12], 0.56, 0, 0, MAT.TIMBER);
    K.box(0, 0.52, 16.45, 5.8, 0.10, 0.48); // wooden bench slat seat
    K.style([0.13, 0.30, 0.11], 0.85, 0, 0, MAT.FOLIAGE);
    K.box(0, 0.92, 17.5, 5.8, 0.42, 1.15);
    K.sphere(-1.8, 1.55, 17.5, 0.85, 7, 5);
    K.sphere(1.8, 1.50, 17.5, 0.80, 7, 5);
    // Heritage ornate bronze twin-globe plaza streetlamp
    K.style(C_BRONZE, 0.36, 0.80, 0, MAT.METAL);
    K.tube([4.8, 0.14, 17.5], [4.8, 4.4, 17.5], 0.18, 0.09, 8, true);
    K.tube([4.0, 4.15, 17.5], [5.6, 4.15, 17.5], 0.05, 0.05, 6, false);
    K.style([1.0, 0.82, 0.46], 0.22, 0, -4.8, MAT.LANTERN);
    K.sphere(4.0, 4.42, 17.5, 0.26, 10, 6);
    K.sphere(5.6, 4.42, 17.5, 0.26, 10, 6);
    K.pop();
  }

  // ---- Octagonal 3-Step Granite Base & Beveled Pedestal Plinth ----
  K.style(C_GRANITE, 0.66, 0, 0, MAT.GRANITE, 0.8);
  K.prism(octRing(6.8), 0.26, 0.56);
  K.prism(octRing(6.0), 0.56, 0.86);
  K.prism(octRing(5.2), 0.86, 1.16);
  // Low protective octagonal stone chain fence (8 carved corner posts + bronze chains)
  const fencePts = octRing(7.4);
  for (let k = 0; k < 8; k++) {
    const p = fencePts[k], q = fencePts[(k + 1) % 8];
    K.style(C_IVORY_D, 0.68, 0, 0, MAT.GRANITE, 0.5);
    K.box(p[0], 0.68, p[1], 0.36, 1.1, 0.36);
    K.sphere(p[0], 1.30, p[1], 0.18, 8, 5);
    // Draped bronze chain catenary between posts
    K.style(C_BRONZE, 0.38, 0.78, 0, MAT.PLAIN);
    for (let s = 0; s < 4; s++) {
      const t0 = s / 4, t1 = (s + 1) / 4;
      const a = [p[0] + (q[0] - p[0]) * t0, 1.02 - 0.28 * 4 * t0 * (1 - t0), p[1] + (q[1] - p[1]) * t0];
      const b = [p[0] + (q[0] - p[0]) * t1, 1.02 - 0.28 * 4 * t1 * (1 - t1), p[1] + (q[1] - p[1]) * t1];
      K.tube(a, b, 0.035, 0.035, 5, false);
    }
  }

  // Sculpted beveled dark-granite & ivory octagonal plinth (y = 1.16 .. 3.85)
  K.style(C_GRAN_DK, 0.58, 0.05, 0, MAT.GRANITE, 0.6);
  K.frustum(octRing(4.35), octRing(3.95), 1.16, 2.35);
  K.style(C_IVORY_D, 0.65, 0, 0, MAT.GRANITE, 0.5);
  K.frustum(octRing(3.95), octRing(3.35), 2.35, 3.25);
  K.frustum(octRing(3.35), octRing(2.68), 3.25, 3.85);
  // Carved bronze inscription relief frames on each plinth face (>=0.08m proud separation — ZERO Z-fighting!)
  for (let k = 0; k < 8; k++) {
    K.push().rotateY(k * Math.PI / 4);
    K.style(C_BRONZE, 0.42, 0.68, 0, MAT.PLAIN);
    K.box(0, 1.78, 3.82, 2.15, 0.92, 0.12);
    K.style(C_GOLD, 0.35, 0.75, -0.6, MAT.PLAIN);
    K.box(0, 1.78, 3.92, 1.85, 0.62, 0.08);
    K.pop();
  }

  // ---- Tapered Octagonal Monument Tower Shaft (y = 3.85 .. 18.8) with Fluted Relief ----
  K.style(C_IVORY, 0.64, 0, 0, MAT.GRANITE, 0.6);
  K.frustum(octRing(2.48), octRing(1.88), 3.85, 18.8);
  // 8 vertical recessed fluted channels + proud corner stone ribs along all 8 faces!
  // Exact face apothem = R * cos(PI/8) -> 2.291m at y=3.85 tapering linearly to 1.737m at y=18.8
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    K.push().rotateY(a);
    // Skip central flute on front face (k=0) between cornices so the inscription plaque mounts cleanly
    if (k !== 0) {
      K.style(C_IVORY_D, 0.74, 0, 0, MAT.GRANITE, 0.4);
      K.sweep([[0, 4.4, 2.29], [0, 18.0, 1.78]], [[0.34, 0, 0], [0.25, 0, 0]], [[0, 0, 0.05], [0, 0, 0.05]]);
    }
    // Proud beveled stone pilaster ribs flanking each facet
    K.style(C_IVORY, 0.60, 0, 0, MAT.GRANITE, 0.5);
    for (const sg of [-1, 1]) {
      K.sweep([[sg * 0.58, 4.1, 2.31], [sg * 0.44, 18.2, 1.80]], [[0.11, 0, 0], [0.09, 0, 0]], [[0, 0, 0.09], [0, 0, 0.08]]);
    }
    K.pop();
  }
  // Horizontal sculpted stone ashlar rustication belt moldings up the octagonal shaft
  K.style(C_IVORY_D, 0.64, 0, 0, MAT.GRANITE, 0.5);
  for (let yr = 5.4; yr < 18.0; yr += 1.6) {
    const t = (yr - 3.85) / (18.8 - 3.85);
    const rr = 2.48 - 0.60 * t + 0.04;
    K.prism(octRing(rr), yr, yr + 0.10);
  }
  K.prism(octRing(2.38), 8.2, 8.58);
  K.prism(octRing(2.14), 13.6, 13.96);
  K.prism(octRing(2.04), 18.4, 18.82);

  // ---- Clock Drum Section (y = 18.8 .. 21.15) with 4 Ornate Gilded Bronze Bezels & 3D Raised Hands! ----
  K.style(C_IVORY, 0.60, 0, 0, MAT.GRANITE, 0.5);
  K.prism(octRing(1.94), 18.82, 21.15);
  for (let k = 0; k < 4; k++) {
    K.push().rotateY(k * Math.PI / 2).translate(0, 19.98, 1.80);
    // Multi-ring ornate bronze bezel + gilded inner fillet ring (back recess at +0.04 -> 0.10m clear behind clock dial!)
    K.style(C_BRONZE, 0.34, 0.82, 0, MAT.METAL);
    K.rotateX(Math.PI / 2);
    K.lathe([[0, 0.04], [1.14, 0.04], [1.14, 0.22], [0.96, 0.22], [0.94, 0.06]], 28);
    K.style(C_GOLD, 0.26, 0.88, -1.2, MAT.METAL);
    K.lathe([[1.02, 0.22], [1.08, 0.25], [1.00, 0.25]], 28);
    K.pop();
    // 3D physical raised bronze hour & minute hands + central boss floating 6cm proud of the clock dial!
    K.push().rotateY(k * Math.PI / 2).translate(0, 19.98, 2.00);
    K.style(C_BRONZE, 0.28, 0.88, 0, MAT.METAL);
    K.sphere(0, 0, 0, 0.08, 8, 5);
    K.tube([0, 0, 0], [-0.42, 0.26, 0], 0.045, 0.025, 5, true); // hour hand (~10)
    K.tube([0, 0, 0], [0.58, 0.34, 0], 0.035, 0.018, 5, true);  // minute hand (~10)
    K.pop();
  }

  // ---- Overhanging Circular Viewing Balcony (y = 21.15 .. 22.45, R = 2.95m) ----
  // 16 sculpted stone corbel brackets supporting the balcony slab
  K.style(C_IVORY_D, 0.66, 0, 0, MAT.GRANITE, 0.5);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    K.push().rotateY(a);
    K.sweep([[0, 20.65, 1.82], [0, 21.18, 2.75]], [[0.14, 0, 0], [0.14, 0, 0]], [[0, 0.24, 0], [0, 0.16, 0]]);
    K.pop();
  }
  // Circular cantilevered balcony deck slab + warm night under-rim glow
  K.style(C_IVORY, 0.62, 0, 0, MAT.GRANITE, 0.6);
  K.lathe([[1.80, 21.05], [2.98, 21.20], [3.05, 21.52], [2.95, 21.62], [1.72, 21.62]], 32);
  K.style([1.0, 0.84, 0.52], 0.25, 0, -4.2, MAT.LANTERN);
  K.lathe([[2.86, 21.14], [2.92, 21.22]], 32);
  // Finely carved circular balcony balustrade (16 posts + top handrail + 48 balusters!)
  K.style(C_IVORY, 0.62, 0, 0, MAT.GRANITE, 0.5);
  K.lathe([[2.76, 22.52], [2.92, 22.52], [2.92, 22.68], [2.76, 22.68]], 32);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const bx = Math.cos(a) * 2.84, bz = Math.sin(a) * 2.84;
    K.box(bx, 22.14, bz, 0.22, 1.08, 0.22);
    K.sphere(bx, 22.76, bz, 0.13, 8, 5);
  }
  for (let k = 0; k < 48; k++) {
    if (k % 3 === 0) continue;
    const a = (k / 48) * TAU;
    K.tube([Math.cos(a) * 2.84, 21.62, Math.sin(a) * 2.84], [Math.cos(a) * 2.84, 22.52, Math.sin(a) * 2.84], 0.045, 0.045, 5, false);
  }

  // ---- Upper Octagonal Cupola / Watchtower Drum (y = 21.62 .. 24.75) ----
  K.style(C_IVORY, 0.60, 0, 0, MAT.GRANITE, 0.5);
  K.prism(octRing(1.66), 21.62, 24.45);
  // 8 recessed glazed observation windows around cupola
  for (let k = 0; k < 8; k++) {
    K.push().rotateY(k * Math.PI / 4);
    K.style([0.10, 0.14, 0.18], 0.12, 0.15, -1.8, MAT.GLASS, 1.2, 0.9);
    K.box(0, 23.15, 1.56, 0.82, 1.48, 0.10);
    K.style(C_IVORY_D, 0.62, 0, 0, MAT.GRANITE, 0.4);
    K.box(0, 23.95, 1.62, 0.96, 0.18, 0.16);
    K.pop();
  }
  // Overhanging cupola crown cornice & stepped dome cap
  K.style(C_IVORY, 0.60, 0, 0, MAT.GRANITE, 0.5);
  K.lathe([[1.66, 24.40], [2.04, 24.52], [2.04, 24.78], [1.65, 24.85], [1.32, 25.15], [0.75, 25.38], [0.22, 25.55]], 24);

  // ---- Spire, Flagpole, Wind-Vane & Anemometer Crossbars (y = 25.5 .. 27.5m) ----
  K.style(C_BRONZE, 0.32, 0.85, 0, MAT.PLAIN);
  K.tube([0, 25.4, 0], [0, 27.55, 0], 0.12, 0.035, 10, true);
  // Cardinal anemometer crossbars & revolving wind cups
  K.tube([-0.75, 26.85, 0], [0.75, 26.85, 0], 0.025, 0.025, 5, false);
  K.tube([0, 26.85, -0.75], [0, 26.85, 0.75], 0.025, 0.025, 5, false);
  for (const [ax, az] of [[-0.75, 0], [0.75, 0], [0, -0.75], [0, 0.75]]) {
    K.sphere(ax, 26.85, az, 0.09, 6, 5);
  }
  // Golden apex sphere finial
  K.style(C_GOLD, 0.22, 0.90, -4.0, MAT.PLAIN);
  K.sphere(0, 27.62, 0, 0.16, 10, 6);

  // ---- Assemble Jiefangbei sub-group ----
  const sub = new THREE.Group();
  sub.name = 'jiefangbei-monument';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);

  // 4 Real Illuminated Clock Faces mounted flush inside the 4 cardinal bronze bezels!
  const clockDirs = [
    { x: 0, z: 1.94, ry: 0 },
    { x: 1.94, z: 0, ry: Math.PI / 2 },
    { x: 0, z: -1.94, ry: Math.PI },
    { x: -1.94, z: 0, ry: -Math.PI / 2 },
  ];
  for (const cd of clockDirs) {
    const cf = makeClockFace(0.95, { hour: 10, minute: 10 });
    cf.position.set(cd.x, 19.98, cd.z);
    cf.rotation.y = cd.ry;
    sub.add(cf);
  }

  // Front golden-on-ivory inscription plaque ("人民解放纪念碑") mounted flush to the tapered shaft face!
  const plaque = makePlaque('人民解放纪念碑', {
    w: 1.02, h: 4.4, bg: '#d9d2c2', fg: '#8f2214', border: '#7b6844',
    vertical: true, emissiveNight: 1.6, emissiveDay: 0.02,
  });
  plaque.position.set(0, 11.1, 2.08);
  plaque.rotation.x = -0.037; // matches exact octagonal shaft taper so top & bottom sit flush!
  sub.add(plaque);

  group.add(sub);

  // Colliders & uplights (Phase 5: block downhill terrace retaining wall & raised corner planters + monument base!)
  const jfbBase = Math.min(y0 - skirtDrop, minDEM - 15);
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 24, hz: 24, base: jfbBase, top: y0 - 0.08 });
  for (let k = 0; k < 4; k++) {
    const a = rotY + k * Math.PI / 2 + Math.PI / 4;
    const [bx, , bz] = toWorld(cx, y0, cz, rotY, Math.sin(k * Math.PI / 2 + Math.PI / 4) * 17.5, 0, Math.cos(k * Math.PI / 2 + Math.PI / 4) * 17.5);
    prisms.push({ type: 'rect', x: bx, z: bz, ang: a, hx: 3.6, hz: 1.2, base: y0 - 2, top: y0 + 2.4 });
  }
  prisms.push({ type: 'circle', x: cx, z: cz, r: 6.8, base: jfbBase, top: y0 + 1.16, sides: 8 });
  prisms.push({ type: 'circle', x: cx, z: cz, r: 4.5, base: jfbBase, top: y0 + 27.5, sides: 8 });
  plazas.push({ type: 'rectPlaza', x: cx, z: cz, ang: rotY, hx: 23, hz: 23, base: y0 - 4, top: y0 + 0.16 });
  for (let k = 0; k < 4; k++) {
    const a = rotY + k * Math.PI / 2 + Math.PI / 4;
    lights.push({ x: cx + Math.cos(a) * 11, y: y0 + 3.5, z: cz + Math.sin(a) * 11, radius: 42, r: 1.0, g: 0.86, b: 0.62, intensity: 1900, omni: 1 });
  }
  lights.push({ x: cx, y: y0 + 22.5, z: cz, radius: 34, r: 1.0, g: 0.84, b: 0.56, intensity: 1600, omni: 1 });
  labels.push({ name: '解放碑', x: cx, y: y0 + 34, z: cz });
}

// ===================================================================================================
// 2. 国泰艺术中心 (Guotai Arts Center — "Chongqing Chopsticks" / 题字红黑交错悬挑梁)
// ===================================================================================================
function addGuotai(group, P, terrain, materials, makePlaque, prisms, plazas, lights, labels) {
  const cx = P.x, cz = P.z, rotY = P.angle ?? 0.25;
  // Sample full 8-point footprint perimeter so entry plaza clears the uphill slope cleanly with ZERO terrain poke!
  const cornerHs = [[-42, -35], [0, -35], [42, -35], [42, 0], [42, 35], [0, 35], [-42, 35], [-42, 0]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const maxDEM = Math.max(...cornerHs);
  const minDEM = Math.min(...cornerHs);
  const y0 = Math.max(Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz), maxDEM + 0.25);
  const skirtDrop = Math.max(24, y0 - minDEM + 10);

  const K = new HeroKit();
  const C_RED    = [0.62, 0.042, 0.025];  // Iconic Guotai lacquered vermilion red steel
  const C_RED_DK = [0.42, 0.028, 0.018];
  const C_BLACK  = [0.055, 0.056, 0.062]; // Matte obsidian black steel beams
  const C_GLASS  = [0.04, 0.06, 0.085];
  const C_GRAN   = [0.48, 0.46, 0.43];
  const C_STONE  = [0.34, 0.33, 0.30];

  // ---- Monumental Chamfered Stepped Granite Entry Plaza & Hillside Retaining Plinth (ZERO road corner clip, ZERO floating!) ----
  K.style(C_STONE, 0.84, 0, 0, MAT.STONE, 0.6);
  K.prism(chamferRect(42, 35, 8), -skirtDrop, 0);
  K.style(C_GRAN, 0.68, 0, 0, MAT.GRANITE, 1.4);
  K.prism(chamferRect(41, 34, 7.5), 0, 2.0);
  K.box(0, 2.8, -3, 74, 1.6, 58);
  // Wide ceremonial entry staircases approaching from front (+Z) & side (+X)
  K.stairs([0, 0, 41], [0, 3.6, 26], 34, 0.24, { rgb: C_GRAN, cheekRgb: C_STONE });
  K.stairs([47, 0, 0], [37, 3.6, 0], 22, 0.24, { rgb: C_GRAN, cheekRgb: C_STONE });

  // ---- Recessed Dark Reflective Glass Theatre & Museum Core Volume WITH 3D Exterior Curtain Mullions ----
  K.style(C_GLASS, 0.08, 0.18, 0, MAT.GLASS, 2.8, 0.96);
  K.box(0, 15.5, -2, 46, 24, 38);
  K.box(-10, 27.5, -5, 32, 12, 28);
  // Real 3D exterior charcoal-steel curtain-wall vertical & horizontal mullions across the theatre atrium glass!
  K.style(C_BLACK, 0.36, 0.78, 0, MAT.METAL, 1.6);
  for (let mx = -21; mx <= 21; mx += 3.5) {
    K.box(mx, 15.5, 17.12, 0.16, 24, 0.28);
    K.box(mx, 15.5, -21.12, 0.16, 24, 0.28);
  }
  for (let my = 4.2; my <= 26.0; my += 3.8) {
    K.box(0, my, 17.12, 46.2, 0.18, 0.26);
  }
  // Sculpted cantilevered glass-and-red-steel grand theatre entrance canopy
  K.style(C_RED, 0.34, 0.42, 0, MAT.METAL, 1.8);
  K.box(0, 8.6, 20.8, 22, 0.55, 7.6);
  // Warm amber glowing grand lobby curtain-wall band revealing furnished interior atrium via tInteriorsArr!
  K.style([0.96, 0.58, 0.22], 0.16, 0.12, -2.0, MAT.GLASS, 2.6, 0.92);
  K.box(0, 6.2, 17.04, 34, 5.2, 0.20);

  // ---- 140+ TRUE 3D INTERLOCKING CANTILEVERED RED & BLACK "CHOPSTICK" STEEL BOX-BEAMS ----
  // Inspired by traditional Chinese bonfire (题字) & dougong: 10 staggered vertical tiers flaring
  // progressively outward as they ascend, crossing orthogonally along X and Z with bold asymmetric cantilevers!
  const nTiers = 10;
  const baseY = 5.4;
  const tierStep = 2.85;
  const beamH = 1.68;
  const beamW = 1.48;

  // Deterministic pseudo-random overhang variation so the lattice looks organically sculpted like the real museum!
  const jit = (a, b) => Math.sin(a * 12.9898 + b * 78.233) * 0.5 + 0.5;

  for (let t = 0; t < nTiers; t++) {
    const ty = baseY + t * tierStep;
    // Dramatic outward pagoda/bonfire flare from bottom tier to upper crown!
    const flare = 1.0 + 0.56 * Math.pow(t / (nTiers - 1), 1.15);
    const spanX = 24.0 * flare;
    const spanZ = 20.5 * flare;
    const isEven = t % 2 === 0;

    // 1) Longitudinal beams running along X (stacked on front & back facades + upper overhanging canopy)
    const zPositions = isEven
      ? [-spanZ * 0.94, -spanZ * 0.62, -spanZ * 0.24, spanZ * 0.24, spanZ * 0.62, spanZ * 0.94]
      : [-spanZ * 0.86, -spanZ * 0.45, 0, spanZ * 0.45, spanZ * 0.86];

    for (let k = 0; k < zPositions.length; k++) {
      const bz = zPositions[k];
      const isOuter = Math.abs(bz) > spanZ * 0.72 || t >= 7;
      // Only hollow out the center where the glass core sits on lower tiers
      if (!isOuter && t < 8 && Math.abs(bz) < 16) continue;
      const isRed = (t + k) % 3 !== 1; // Iconic dominant crimson-red laced with crisp black contrast beams!
      const extL = (jit(t, k * 3 + 1) - 0.35) * 9.5;
      const extR = (jit(t, k * 3 + 2) - 0.35) * 9.5;
      const x0 = -spanX - Math.max(0, extL);
      const x1 =  spanX + Math.max(0, extR);
      const len = x1 - x0;
      const midX = (x0 + x1) / 2;

      K.style(isRed ? (t % 2 === 0 ? C_RED : C_RED_DK) : C_BLACK, isRed ? 0.34 : 0.46, isRed ? 0.38 : 0.55, 0, MAT.METAL, 2.2);
      K.box(midX, ty, bz, len, beamH, beamW);
      // 3D beveled metallic end-cap collar plates set 0.12m back from beam tip (ZERO 0.02m Z-fighting!)
      K.style(isRed ? C_RED_DK : [0.14, 0.15, 0.17], 0.30, 0.72, 0, MAT.METAL);
      K.box(x0 + 0.28, ty, bz, 0.32, beamH + 0.14, beamW + 0.14);
      K.box(x1 - 0.28, ty, bz, 0.32, beamH + 0.14, beamW + 0.14);

      // End-cap bevel plate + dramatic crimson-gold night glow along major red beam undersides!
      if (isRed) {
        K.style([1.0, 0.16, 0.06], 0.3, 0, -3.6, MAT.LANTERN);
        K.box(midX, ty - beamH * 0.52, bz, len - 0.6, 0.14, beamW * 0.55);
        K.style([0.92, 0.12, 0.05], 0.35, 0, -2.4, MAT.METAL);
        K.box(x0 - 0.04, ty, bz, 0.08, beamH * 0.82, beamW * 0.82);
        K.box(x1 + 0.04, ty, bz, 0.08, beamH * 0.82, beamW * 0.82);
      }
    }

    // 2) Cross-interlocking beams running along Z (offset half-tier up so beams genuinely interleave in 3D!)
    const tyZ = ty + tierStep * 0.48;
    const xPositions = isEven
      ? [-spanX * 0.92, -spanX * 0.56, -spanX * 0.18, spanX * 0.18, spanX * 0.56, spanX * 0.92]
      : [-spanX * 0.84, -spanX * 0.42, 0, spanX * 0.42, spanX * 0.84];

    for (let k = 0; k < xPositions.length; k++) {
      const bx = xPositions[k];
      const isOuter = Math.abs(bx) > spanX * 0.68 || t >= 7;
      if (!isOuter && t < 8 && Math.abs(bx) < 20) continue;
      const isRed = (t + k) % 3 !== 2;
      const extF = (jit(t + 17, k * 5 + 1) - 0.30) * 9.0;
      const extB = (jit(t + 17, k * 5 + 2) - 0.35) * 8.0;
      const z0 = -spanZ - Math.max(0, extB);
      const z1 =  spanZ + Math.max(0, extF);
      const len = z1 - z0;
      const midZ = (z0 + z1) / 2;

      K.style(isRed ? (t % 2 === 0 ? C_RED : C_RED_DK) : C_BLACK, isRed ? 0.34 : 0.46, isRed ? 0.38 : 0.55, 0, MAT.METAL, 2.2);
      K.box(bx, tyZ, midZ, beamW, beamH, len);
      // 3D beveled metallic end-cap collar plates set 0.12m back from beam tip (ZERO 0.02m Z-fighting!)
      K.style(isRed ? C_RED_DK : [0.14, 0.15, 0.17], 0.30, 0.72, 0, MAT.METAL);
      K.box(bx, tyZ, z0 + 0.28, beamW + 0.14, beamH + 0.14, 0.32);
      K.box(bx, tyZ, z1 - 0.28, beamW + 0.14, beamH + 0.14, 0.32);

      if (isRed) {
        K.style([1.0, 0.16, 0.06], 0.3, 0, -3.6, MAT.LANTERN);
        K.box(bx, tyZ - beamH * 0.52, midZ, beamW * 0.55, 0.14, len - 0.6);
        K.style([0.92, 0.12, 0.05], 0.35, 0, -2.4, MAT.METAL);
        K.box(bx, tyZ, z0 - 0.04, beamW * 0.82, beamH * 0.82, 0.08);
        K.box(bx, tyZ, z1 + 0.04, beamW * 0.82, beamH * 0.82, 0.08);
      }
    }
  }

  // Structural vertical black steel corner support masts tying the lower cantilevered tiers cleanly to the plaza
  K.style(C_BLACK, 0.40, 0.70, 0, MAT.METAL);
  for (const sx of [-24, -12, 12, 24]) {
    for (const sz of [-19, 19]) {
      K.box(sx, 14, sz, 1.4, 22, 1.4);
    }
  }

  const sub = new THREE.Group();
  sub.name = 'guotai-arts-center';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);

  const plaque = makePlaque('重庆国泰艺术中心', {
    w: 9.2, h: 2.2, bg: '#160908', fg: '#f3d8a0', border: '#b32818',
    subtext: 'CHONGQING GUOTAI ARTS CENTER', emissiveNight: 2.4, emissiveDay: 0.05,
  });
  plaque.position.set(0, 6.2, 22.8);
  sub.add(plaque);
  group.add(sub);

  const polyW = (pts) => pts.map(([lx, lz]) => { const w = toWorld(cx, 0, cz, rotY, lx, 0, lz); return [w[0], w[2]]; });
  const guotaiBase = Math.min(y0 - skirtDrop, minDEM - 15);
  prisms.push({ type: 'poly', pts: polyW(chamferRect(42, 35, 8)), base: guotaiBase, top: y0 + 1.92 });
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 30, hz: 25, base: guotaiBase, top: y0 + 36 });
  plazas.push({ type: 'polyPlaza', pts: polyW(chamferRect(41, 34, 7.5)), base: y0 - 2, top: y0 + 2.02 });
  // Dramatic crimson-red & warm architectural night lights!
  for (const [lx, ly, lz] of [[-28, 18, 28], [0, 20, 32], [28, 18, 28], [-32, 20, -24], [32, 20, -24], [0, 34, 0]]) {
    const [wx, wy, wz] = toWorld(cx, y0, cz, rotY, lx, ly, lz);
    lights.push({ x: wx, y: wy, z: wz, radius: 58, r: 1.0, g: 0.18, b: 0.10, intensity: 3200, omni: 1 });
  }
  labels.push({ name: '国泰艺术中心', x: cx, y: y0 + 44, z: cz });
}

// ===================================================================================================
// 3. 重庆环球金融中心 (Chongqing WFC, 339m)
// ===================================================================================================
function addWFC(group, P, terrain, materials, prisms, lights, labels) {
  const cx = P.x, cz = P.z, rotY = P.angle ?? 0.12;
  // Sample full 66x58m podium perimeter so uphill terrain NEVER pokes into ground-floor luxury podium glass!
  const perimHs = [[-33, -29], [0, -29], [33, -29], [33, 0], [33, 29], [0, 29], [-33, 29], [-33, 0]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const maxDEM = Math.max(...perimHs), minDEM = Math.min(...perimHs);
  const y0 = Math.max(Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz), maxDEM + 0.25);
  const skirtDrop = Math.max(18, y0 - minDEM + 6);
  const H = P.h || 339;
  const sc = H / 339;

  const K = new HeroKit();
  const C_GLASS  = [0.11, 0.17, 0.23];
  const C_SILVER = [0.76, 0.80, 0.85];
  const C_PODIUM = [0.56, 0.54, 0.50];
  const C_LOUVER = [0.14, 0.16, 0.20];
  const C_CROWN  = [0.92, 0.96, 1.00];

  // Deep bedrock skirt + Grand 6-story stone & glass luxury podium (h = 26m)
  K.style([0.34, 0.33, 0.30], 0.85, 0, 0, MAT.STONE, 0.6);
  K.box(0, -skirtDrop / 2, 0, 68, skirtDrop, 60);
  K.style(C_GLASS, 0.10, 0.18, 0, MAT.GLASS, 3.0, 0.95);
  K.box(0, 13, 0, 60, 26, 52);
  // Sculpted stone podium colonnade piers & projecting grand entrance canopy
  K.style(C_PODIUM, 0.50, 0.08, 0, MAT.GRANITE, 1.2);
  for (let k = -4; k <= 4; k++) {
    for (const sz of [-26.4, 26.4]) K.box(k * 7.2, 13, sz, 1.6, 26, 1.6);
  }
  K.box(0, 26.2, 0, 63, 1.2, 55);
  K.style(C_SILVER, 0.24, 0.88, 0, MAT.METAL);
  K.box(0, 7.2, 29.8, 22, 0.65, 7.6); // cantilevered glass-and-steel lobby canopy

  // Multi-Stage Stepped Crystalline Setback Tower (5 geometric setback zones!)
  const zones = [
    { y0: 26,  y1: 118, hx: 23.5, hz: 22.0, ch: 2.2 },
    { y0: 118, y1: 196, hx: 20.5, hz: 19.2, ch: 2.0 },
    { y0: 196, y1: 262, hx: 17.5, hz: 16.5, ch: 1.8 },
    { y0: 262, y1: 308, hx: 14.5, hz: 13.8, ch: 1.6 },
  ];
  for (const z of zones) {
    const za = z.y0 * sc, zb = z.y1 * sc;
    const pts = chamferRect(z.hx, z.hz, z.ch);
    K.style(C_GLASS, 0.09, 0.16, 0, MAT.GLASS, 2.6, 0.96);
    K.prism(pts, za, zb, { capTop: true, capBottom: false });
    // Recessed dark mechanical louver band at top of each setback zone
    K.style(C_LOUVER, 0.55, 0.45, 0, MAT.LOUVER, 0.24);
    K.prism(chamferRect(z.hx + 0.15, z.hz + 0.15, z.ch), zb - 5.2 * sc, zb - 0.6 * sc, { capTop: false, capBottom: false });
    // Dense 3D projecting vertical silver curtain-wall structural fins on all 4 faces!
    K.style(C_SILVER, 0.24, 0.88, 0, MAT.METAL, 2.4, 0.80);
    const nFx = Math.max(6, Math.round(z.hx * 0.55));
    for (let k = -nFx; k <= nFx; k++) {
      const fx = (k / nFx) * (z.hx - z.ch);
      for (const sg of [-1, 1]) K.box(fx, (za + zb) / 2, sg * (z.hz + 0.28), 0.26, zb - za, 0.58);
    }
    const nFz = Math.max(6, Math.round(z.hz * 0.55));
    for (let k = -nFz; k <= nFz; k++) {
      const fz = (k / nFz) * (z.hz - z.ch);
      for (const sg of [-1, 1]) K.box(sg * (z.hx + 0.28), (za + zb) / 2, fz, 0.58, zb - za, 0.26);
    }
    // Glowing silver-gold setback shoulder halo strip!
    K.style([0.95, 0.88, 0.68], 0.22, 0, -4.6, MAT.LANTERN);
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      K.tube([a[0], zb + 0.15, a[1]], [b[0], zb + 0.15, b[1]], 0.20, 0.20, 4, false);
    }
  }

  // Famous Illuminated Glowing Glass Sky-Lantern Crown (y = 308m .. 339m)!
  const c0 = 308 * sc, c1 = 336 * sc;
  K.style(C_CROWN, 0.12, 0.10, -2.8, MAT.GLASS, 2.2, 0.96);
  K.prism(chamferRect(12.2, 11.6, 1.4), c0, c1, { capTop: true, capBottom: false });
  // Glowing vertical steel lantern mullions framing the luminous crown
  K.style([1.0, 0.92, 0.72], 0.20, 0, -6.5, MAT.LANTERN);
  for (const [fx, fz] of chamferRect(12.45, 11.85, 1.4)) {
    K.tube([fx, c0, fz], [fx, c1 + 2.8, fz], 0.26, 0.22, 5, true);
  }
  const cTop = chamferRect(12.45, 11.85, 1.4);
  for (let k = 0; k < cTop.length; k++) {
    const a = cTop[k], b = cTop[(k + 1) % cTop.length];
    K.tube([a[0], c1 + 2.6, a[1]], [b[0], c1 + 2.6, b[1]], 0.26, 0.26, 4, false);
  }
  // Red aviation beacons
  K.style([1.0, 0.12, 0.05], 0.25, 0, -9.0, MAT.PLAIN);
  for (const sx of [-9, 9]) K.sphere(sx, c1 + 3.4, 0, 0.55, 8, 6);

  const sub = new THREE.Group();
  sub.name = 'chongqing-wfc';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);
  group.add(sub);

  const wfcBase = Math.min(y0 - skirtDrop, minDEM - 15);
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 34, hz: 30, base: wfcBase, top: y0 + 0.2 });
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 31, hz: 27, base: wfcBase, top: y0 + 27 });
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 24, hz: 22.5, base: wfcBase, top: y0 + H });
  lights.push({ x: cx, y: y0 + c1, z: cz, radius: 95, r: 1.0, g: 0.92, b: 0.72, intensity: 4800, omni: 1 });
  labels.push({ name: '重庆环球金融中心 WFC', x: cx, y: y0 + H + 12, z: cz });
}

// ===================================================================================================
// 4. 陆海国际中心 (Chongqing 100 / Land-Sea International Center, 458m — Tallest in Chongqing!)
// ===================================================================================================
function addChongqing100(group, P, terrain, materials, prisms, lights, labels) {
  const cx = P.x, cz = P.z, rotY = P.angle ?? -0.22;
  const cornerHs = [[-40, -38], [0, -38], [40, -38], [40, 0], [40, 38], [0, 38], [-40, 38], [-40, 0]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const maxDEM = Math.max(...cornerHs), minDEM = Math.min(...cornerHs);
  const y0 = Math.max(Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz), maxDEM + 0.35);
  const skirtDrop = Math.max(24, y0 - minDEM + 8);
  const H = P.h || 458;
  const sc = H / 458;

  const K = new HeroKit();
  const C_GLASS  = [0.09, 0.15, 0.22];
  const C_SILVER = [0.78, 0.82, 0.88];
  const C_LOUVER = [0.13, 0.16, 0.20];
  const C_POD    = [0.58, 0.56, 0.52];

  // Deep bedrock skirt & sculpted terraced retail podium
  K.style([0.34, 0.33, 0.30], 0.85, 0, 0, MAT.STONE, 0.65);
  K.box(0, -skirtDrop / 2, 0, 88, skirtDrop, 86);
  K.style(C_POD, 0.48, 0.12, 0, MAT.GRANITE, 1.4);
  K.prism(chamferRect(38, 36, 6), 0, 24);
  K.style(C_GLASS, 0.10, 0.18, 0, MAT.GLASS, 3.0, 0.95);
  K.prism(chamferRect(36, 34, 5.5), 2, 22);

  // Sculpted 6-zone tapered faceted supertall shaft (24m -> 418m)
  const nZones = 6;
  const yStart = 24 * sc, yCrown0 = 416 * sc;
  const zoneH = (yCrown0 - yStart) / nZones;
  const ringAt = (t) => {
    const hw = 28.5 * (1 - 0.38 * Math.pow(t, 1.15));
    const ch = 4.2 + 4.8 * t; // corner bevels widen gracefully as tower tapers!
    return chamferRect(hw, hw, ch);
  };

  for (let z = 0; z < nZones; z++) {
    const t0 = z / nZones, t1 = (z + 1) / nZones;
    const za = yStart + z * zoneH, zb = za + zoneH;
    const r0 = ringAt(t0), r1 = ringAt(t1);
    K.style(C_GLASS, 0.09, 0.18, 0, MAT.GLASS, 2.8, 0.96);
    K.frustum(r0, r1, za, zb - 5.2 * sc, { capTop: false, capBottom: false });
    // Dark mechanical louver belt between zones
    K.style(C_LOUVER, 0.55, 0.45, 0, MAT.LOUVER, 0.24);
    K.frustum(r1, r1, zb - 5.2 * sc, zb, { capTop: z === nZones - 1, capBottom: false });

    // Heavy 3D exterior corner mega-columns & diagonal chamfer ribs + silver curtain-wall fins
    K.style(C_SILVER, 0.24, 0.88, 0, MAT.METAL, 2.6, 0.82);
    for (let k = 0; k < 8; k++) {
      K.tube([r0[k][0], za, r0[k][1]], [r1[k][0], zb, r1[k][1]], 0.72, 0.62, 6, false);
      // 4 intermediate vertical fins along each of the 4 main flat faces (even indices 0, 2, 4, 6)
      if (k % 2 === 0) {
        const j = (k + 1) % 8;
        for (let f = 1; f <= 5; f++) {
          const u = f / 6;
          const ax = r0[k][0] + (r0[j][0] - r0[k][0]) * u, az = r0[k][1] + (r0[j][1] - r0[k][1]) * u;
          const bx = r1[k][0] + (r1[j][0] - r1[k][0]) * u, bz = r1[k][1] + (r1[j][1] - r1[k][1]) * u;
          K.tube([ax, za, az], [bx, zb, bz], 0.24, 0.22, 4, false);
        }
      }
    }
    // Glowing silver-gold architectural rib along chamfer edges
    K.style([0.92, 0.95, 1.0], 0.20, 0, -4.5, MAT.LANTERN);
    for (let k = 0; k < 8; k++) {
      K.tube([r0[k][0] * 1.015, za, r0[k][1] * 1.015], [r1[k][0] * 1.015, zb, r1[k][1] * 1.015], 0.18, 0.16, 4, false);
    }
  }

  // Sculpted Slanted Faceted Crystal Sky-Crown & Pinnacle (416m -> 458m!)
  const rBase = ringAt(1.0);
  const rTop = chamferRect(11.5, 11.5, 4.8);
  const crownTop = 458 * sc;
  // Asymmetric slanted sky-crown blades (higher on the +Z/+X side like Chongqing 100's iconic chisel crown!)
  const cRings = [
    rBase.map(([x, z]) => [x, yCrown0, z]),
    rTop.map(([x, z]) => [x, crownTop - 16 * sc + (x + z) * 0.55 * sc, z]),
  ];
  K.style([0.14, 0.24, 0.34], 0.08, 0.20, -1.6, MAT.GLASS, 2.6, 0.96);
  K.loft(cRings, { caps: true, smooth: false });
  // Glowing neon-gold/white sculptural crown edge frame
  K.style([1.0, 0.90, 0.65], 0.18, 0, -7.2, MAT.LANTERN);
  for (let k = 0; k < 8; k++) {
    const a = cRings[0][k], b = cRings[1][k], bNext = cRings[1][(k + 1) % 8];
    K.tube(a, b, 0.36, 0.28, 5, false);
    K.tube(b, bNext, 0.32, 0.32, 5, false);
  }
  // Red aviation warning beacons at summit
  K.style([1.0, 0.10, 0.05], 0.25, 0, -10.0, MAT.PLAIN);
  K.sphere(cRings[1][1][0], cRings[1][1][1] + 2.0, cRings[1][1][2], 0.72, 8, 6);
  K.sphere(cRings[1][5][0], cRings[1][5][1] + 2.0, cRings[1][5][2], 0.72, 8, 6);

  const sub = new THREE.Group();
  sub.name = 'chongqing-100';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);
  group.add(sub);

  const cq100Base = Math.min(y0 - skirtDrop, minDEM - 15);
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 44, hz: 43, base: cq100Base, top: y0 + 0.2 });
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 38, hz: 36, base: cq100Base, top: y0 + 25 });
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 29, hz: 29, base: cq100Base, top: y0 + H });
  lights.push({ x: cx, y: y0 + crownTop - 10, z: cz, radius: 110, r: 1.0, g: 0.90, b: 0.68, intensity: 5400, omni: 1 });
  labels.push({ name: '陆海国际中心 (458m)', x: cx, y: y0 + H + 16, z: cz });
}

export function buildJiefangbei(ctx) {
  const { data, terrain, materials, makePlaque, makeClockFace } = ctx;
  const group = new THREE.Group();
  group.name = 'jiefangbei-cluster';
  const prisms = [], plazas = [], lights = [], labels = [];

  addJiefangbei(group, { ...FALLBACKS.jiefangbei, ...(data.jiefangbei || {}) }, terrain, materials, makePlaque, makeClockFace, prisms, plazas, lights, labels);
  addGuotai(group, { ...FALLBACKS.guotai, ...(data.guotai || {}) }, terrain, materials, makePlaque, prisms, plazas, lights, labels);
  addWFC(group, { ...FALLBACKS.wfc, ...(data.wfc || {}) }, terrain, materials, prisms, lights, labels);
  addChongqing100(group, { ...FALLBACKS.chongqing100, ...(data.chongqing100 || {}) }, terrain, materials, prisms, lights, labels);

  return {
    group,
    colliders: { prisms, plazas },
    lights,
    labels,
  };
}
