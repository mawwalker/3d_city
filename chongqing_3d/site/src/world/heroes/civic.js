// 重庆文化与山城地标集群 (Chongqing Cultural & 8D Mountain-City Hero Landmarks)
//
// Builds 7 museum-grade architectural landmarks:
//  1. 重庆大剧院 (Chongqing Grand Theatre, Jiangbeizui) — monumental double-layer faceted origami emerald
//     crystal shell with 3D structural steel space-frame ridge ribs over an inner concrete auditorium hull!
//  2. 重庆人民大礼堂 (Great Hall of the People) — authentic Ming/Qing imperial circular rotunda with
//     triple-eaved emerald-green glazed tile dome roof (三重檐绿瓦攒尖顶), golden finial, 32 crimson
//     colonnade pillars with dougong brackets, triple white marble terraces, flanking palace wings,
//     monumental imperial archway (牌坊) & People's Square!
//  3. 重庆科技馆 (Science & Technology Museum, Jiangbeizui) — sculpted angular cantilevered stone & glass
//     crystalline wings fanning over Jiangbeizui waterfront!
//  4. 魁星楼 (Kuixinglou) — famous 8D "1F is 22F" cliffside tower, walkable 22F rooftop square & twin
//     high-altitude skybridges spanning across the cliff chasm!
//  5. 白象居 (Baixiangju) — iconic 6-block stepped 24-story elevator-less residential landmark with 3D
//     balconies & mid-air connecting sky-corridors framing the Yangtze River Cableway!
//  6. 十八梯 (Shibati) — cascading traditional Bayu mountain blue-stone stairway flanked by terraced
//     upturned-tile shophouses, wooden balconies & hanging red lantern festoons!
//  7. 南山一棵树观景台 (Nanshan Yikeshu Viewing Pavilion) — panoramic cantilevered circular viewing tower
//     perched atop Nanshan ridge beside the iconic lone giant Huangjue Tree (黄葛树)!

import * as THREE from 'three';
import { HeroKit, MAT } from './kit.js';

const TAU = Math.PI * 2;

const FALLBACKS = {
  grand_theatre:    { x: 640,  z: -1150, baseY: 50,  angle: 2.35,  w: 184, d: 96,  h: 64 },
  great_hall:       { x: -1780, z: -260, baseY: 72,  angle: 1.48,  w: 150, d: 130, h: 65 },
  science_museum:   { x: 960,  z: -1020, baseY: 42,  angle: 2.10,  w: 130, d: 90,  h: 48 },
  kuixinglou:       { x: -340, z: -280,  baseY: 28,  angle: 0.08,  w: 74,  d: 58,  h: 66 },
  baixiangju:       { x: 760,  z: 240,   baseY: 22,  angle: -0.45, w: 135, d: 34,  h: 72 },
  shibati:          { x: -240, z: 540,   baseY: 46,  angle: 0.20,  w: 62,  d: 120, h: 30 },
  nanshan_pavilion: { x: 2450, z: 1620,  baseY: 276, angle: -2.25, w: 46,  d: 46,  h: 28 },
};

function toWorld(cx, cy, cz, rotY, lx, ly, lz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
}
function xyObj([wx, , wz]) { return { x: wx, z: wz }; }

// ===================================================================================================
// 1. 重庆大剧院 (Chongqing Grand Theatre at Jiangbeizui) — Monumental Faceted Origami Emerald Crystal!
//    Round 2 Overhaul: replaced raw vertical stone bunker with sculpted multi-stepped terraced granite
//    plazas, recessed glazed lobby colonnades, wider sweeping angular cantilevered emerald-jade origami
//    shell, dark charcoal space-frame ridge ribs, and rich translucent deep-emerald night lighting!
// ===================================================================================================
function addGrandTheatre(group, P, terrain, materials, makePlaque, prisms, plazas, lights, labels) {
  const cx = P.x, cz = P.z;
  let rotY = (P.angle ?? 0) + Math.PI / 2;
  const pF = toWorld(cx, 0, cz, rotY, 0, 0, 95), pB = toWorld(cx, 0, cz, rotY, 0, 0, -95);
  if (terrain.sample(pF[0], pF[2]) > terrain.sample(pB[0], pB[2]) + 4) rotY += Math.PI;
  const cornerHs = [[-68, -110], [68, -110], [68, 110], [-68, 110], [0, 110], [68, 0], [-68, 0]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const minDEM = Math.min(...cornerHs);
  // Sit significantly lower on the Jiangbeizui terrace so it hugs the hillside instead of perching on a tall stone bunker!
  const y0 = (Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz)) - 7.5;
  const skirtDrop = Math.max(32, y0 - minDEM + 12);

  const K = new HeroKit();
  const C_GRANITE  = [0.48, 0.46, 0.43];
  const C_GRAN_DK  = [0.34, 0.33, 0.31];
  const C_STONE    = [0.28, 0.27, 0.25];
  const C_HULL     = [0.58, 0.54, 0.46];
  const C_EMERALD  = [0.06, 0.38, 0.28]; // Deep authentic Chongqing emerald-jade translucent crystal!
  const C_CHARCOAL = [0.13, 0.15, 0.16]; // Crisp dark gunmetal steel space-frame ribs silhouetted at night!
  const C_LED_EM   = [0.08, 0.72, 0.50];
  const C_GLASS_LB = [0.07, 0.13, 0.16];
  const C_FOLIAGE  = [0.11, 0.28, 0.11];

  // ---- Sculpted Multi-Tiered Terraced Riverside Granite Plazas & Recessed Glazed Lobby Base ----
  // Stepped tapering octagonal-chamfered terrace layers hugging the DEM slope (NEVER a sheer square fortress box!)
  const terracePoly = (hx, hz, ch) => [
    [-hx + ch, hz], [hx - ch, hz], [hx, hz - ch], [hx, -hz + ch],
    [hx - ch, -hz], [-hx + ch, -hz], [-hx, -hz + ch], [-hx, hz - ch],
  ];
  // Lowest terraced hillside retaining apron stepped cleanly into the park slope
  K.style(C_STONE, 0.86, 0, 0, MAT.STONE, 0.65);
  K.prism(terracePoly(66, 108, 22), -skirtDrop, -5.5);
  K.style(C_GRAN_DK, 0.72, 0, 0, MAT.GRANITE, 1.5);
  K.prism(terracePoly(64, 106, 21), -5.5, -4.6);
  // Landscaped terraced park green planter strips around the lower step
  for (const sg of [-1, 1]) {
    K.style(C_FOLIAGE, 0.84, 0, 0, MAT.FOLIAGE);
    K.box(sg * 58, -3.9, 10, 6.5, 1.4, 128);
  }
  // Mid terrace with recessed dark glazed lobby curtain-wall, 3D aluminum mullions & architectural piers!
  K.style(C_GLASS_LB, 0.08, 0.16, 0, MAT.GLASS, 2.8, 0.96);
  K.prism(terracePoly(56, 98, 18), -4.6, 4.2);
  // Real 3D dark-charcoal lobby mullions & glazed vestibule frames around the Grand Theatre base
  K.style(C_CHARCOAL, 0.30, 0.82, 0, MAT.METAL, 1.6);
  for (let z = -78; z <= 78; z += 4.0) {
    for (const sg of [-1, 1]) K.box(sg * 56.15, -0.2, z, 0.22, 8.8, 0.18);
  }
  for (let x = -36; x <= 36; x += 4.0) {
    K.box(x, -0.2, 98.15, 0.18, 8.8, 0.22);
  }
  K.style(C_GRANITE, 0.66, 0, 0, MAT.GRANITE, 1.4);
  for (let z = -76; z <= 76; z += 12) {
    for (const sg of [-1, 1]) K.box(sg * 56.5, -0.2, z, 1.5, 8.8, 1.7);
  }
  K.prism(terracePoly(59, 101, 18), 4.2, 5.4);
  // Upper grand promenade deck supporting the sweeping faceted crystal hull
  K.style(C_GRANITE, 0.64, 0, 0, MAT.GRANITE, 1.3);
  K.prism(terracePoly(52, 92, 16), 5.4, 7.6);
  // Sweeping monumental waterfront staircases cascading down from upper deck (+7.6) to lower park (-5.5)!
  K.stairs([0, -5.5, 108], [0, 5.4, 88], 48, 0.25, { rgb: C_GRANITE, cheekRgb: C_GRAN_DK });
  K.stairs([0, 5.4, 88], [0, 7.6, 80], 42, 0.22, { rgb: C_GRANITE, cheekRgb: C_GRAN_DK });
  K.stairs([64, -5.5, 12], [51, 7.6, 12], 36, 0.25, { rgb: C_GRANITE, cheekRgb: C_GRAN_DK });
  K.stairs([-64, -5.5, 12], [-51, 7.6, 12], 36, 0.25, { rgb: C_GRANITE, cheekRgb: C_GRAN_DK });

  // ---- Warm Inner Concrete Opera Hall Hull (subtle amber glow inside the emerald crystal shell!) ----
  K.style(C_HULL, 0.72, 0, -0.25, MAT.PLAIN);
  K.box(0, 21, -8, 54, 24, 106);
  K.box(0, 35, 6, 42, 16, 60);

  // ---- Sweeping Wider & Sharper Faceted Origami Crystal Shell (soars boldly wider & lower over the terraces!) ----
  const stations = [
    { z: -90, yB: 5.4, wB: 38, yM: 22, wM: 48, yRL: 34, xRL: -30, yP: 41, xP: 0,  yRR: 32, xRR: 32 },
    { z: -56, yB: 5.4, wB: 46, yM: 29, wM: 58, yRL: 45, xRL: -36, yP: 53, xP: -5, yRR: 42, xRR: 38 },
    { z: -20, yB: 5.4, wB: 50, yM: 34, wM: 64, yRL: 52, xRL: -40, yP: 62, xP: 3,  yRR: 49, xRR: 41 },
    { z:  18, yB: 5.4, wB: 48, yM: 36, wM: 62, yRL: 56, xRL: -36, yP: 67, xP: -4, yRR: 53, xRR: 37 },
    { z:  54, yB: 8.5, wB: 40, yM: 32, wM: 52, yRL: 52, xRL: -28, yP: 63, xP: 5,  yRR: 48, xRR: 30 },
    { z:  84, yB: 14.5, wB: 28, yM: 30, wM: 38, yRL: 45, xRL: -18, yP: 55, xP: 0, yRR: 43, xRR: 19 },
    { z: 104, yB: 22.0, wB: 10, yM: 30, wM: 18, yRL: 37, xRL: -6,  yP: 45, xP: 0, yRR: 37, xRR: 6  },
  ];
  const polyRing = (s) => [
    [-s.wB, s.yB, s.z],
    [-s.wM, s.yM, s.z],
    [s.xRL, s.yRL, s.z],
    [s.xP,  s.yP,  s.z],
    [s.xRR, s.yRR, s.z],
    [s.wM,  s.yM,  s.z],
    [s.wB,  s.yB,  s.z],
  ];
  const rings = stations.map(polyRing);

  // Translucent deep emerald-jade origami glass facets (calibrated emissive -1.25 -> rich jade, NEVER blown white!)
  K.style(C_EMERALD, 0.11, 0.12, -1.25, MAT.ORIGAMI_GLASS, 1.0, 0.96);
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    for (let k = 0; k < r0.length - 1; k++) {
      if ((i + k) % 2 === 0) {
        K.tri(r0[k], r1[k], r1[k + 1], [0, 0], [8, 0], [8, 8]);
        K.tri(r0[k], r1[k + 1], r0[k + 1], [0, 0], [8, 8], [0, 8]);
      } else {
        K.tri(r0[k], r1[k], r0[k + 1], [0, 0], [8, 0], [0, 8]);
        K.tri(r1[k], r1[k + 1], r0[k + 1], [8, 0], [8, 8], [0, 8]);
      }
    }
  }
  for (const [idx, flip] of [[0, true], [rings.length - 1, false]]) {
    const r = rings[idx];
    const mid = [0, (r[0][1] + r[3][1]) * 0.48, r[0][2] + (flip ? -8 : 11)];
    for (let k = 0; k < r.length - 1; k++) {
      if (flip) K.tri(r[k + 1], r[k], mid, [0, 0], [6, 0], [3, 6]);
      else K.tri(r[k], r[k + 1], mid, [0, 0], [6, 0], [3, 6]);
    }
  }

  // Crisp Dark Charcoal-Steel Space-Frame Fold Ribs (outer layer + secondary structural sub-ribs!)
  K.style(C_CHARCOAL, 0.30, 0.85, 0, MAT.METAL, 2.0);
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    for (let k = 0; k < r.length - 1; k++) {
      K.tube(r[k], r[k + 1], 0.62, 0.62, 6, false);
      if (i < rings.length - 1) {
        const rn = rings[i + 1];
        K.tube(r[k], rn[k], 0.68, 0.68, 6, false);
        if (k === r.length - 2) K.tube(r[k + 1], rn[k + 1], 0.68, 0.68, 6, false);
        if ((i + k) % 2 === 0) K.tube(r[k], rn[k + 1], 0.42, 0.42, 5, false);
        else K.tube(rn[k], r[k + 1], 0.42, 0.42, 5, false);
        // Sculpted cast-steel space-frame hub nodes at fold vertices
        K.sphere(r[k][0], r[k][1], r[k][2], 0.82, 6, 4);
      }
    }
  }
  // Subtle deep-emerald accent trace along the soaring top ridge crease
  K.style(C_LED_EM, 0.22, 0, -2.2, MAT.LANTERN);
  for (let i = 0; i < rings.length - 1; i++) {
    K.tube(rings[i][3], rings[i + 1][3], 0.24, 0.24, 4, false);
  }

  const sub = new THREE.Group();
  sub.name = 'chongqing-grand-theatre';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMatDouble);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);

  const plaque = makePlaque('重庆大剧院', {
    w: 11.0, h: 2.8, bg: '#091d19', fg: '#d6fff0', border: '#1fa87e',
    subtext: 'CHONGQING GRAND THEATRE', emissiveNight: 2.0, emissiveDay: 0.05,
  });
  plaque.position.set(0, 11.2, 92);
  sub.add(plaque);
  group.add(sub);

  const polyW = (pts) => pts.map(([lx, lz]) => { const w = toWorld(cx, 0, cz, rotY, lx, 0, lz); return [w[0], w[2]]; });
  const gtBase = Math.min(y0 - skirtDrop, minDEM - 18);
  prisms.push({ type: 'poly', pts: polyW(terracePoly(66, 108, 22)), base: gtBase, top: y0 - 4.7 });
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 56, hz: 98, base: gtBase, top: y0 + 7.5 });
  prisms.push({ type: 'rect', ...xyObj(toWorld(cx, y0, cz, rotY, 0, 0, -6)), ang: rotY, hx: 52, hz: 78, base: gtBase, top: y0 + 66 });
  plazas.push({ type: 'rectPlaza', ...xyObj(toWorld(cx, y0, cz, rotY, 0, 7.6, 86)), ang: rotY, hx: 52, hz: 14, base: y0 + 5, top: y0 + 7.65 });
  for (const [lx, ly, lz] of [[-54, 24, 30], [54, 24, 30], [-52, 24, -35], [52, 24, -35], [0, 34, 102], [0, 58, 10]]) {
    const [wx, wy, wz] = toWorld(cx, y0, cz, rotY, lx, ly, lz);
    lights.push({ x: wx, y: wy, z: wz, radius: 66, r: 0.08, g: 0.78, b: 0.56, intensity: 1850, omni: 1 });
  }
  labels.push({ name: '重庆大剧院', x: cx, y: y0 + 76, z: cz });
}

// ===================================================================================================
// 2. 重庆人民大礼堂 (Chongqing Great Hall of the People — Ming/Qing Imperial Masterpiece!)
// ===================================================================================================
function addGreatHall(group, P, terrain, materials, makePlaque, prisms, plazas, lights, labels) {
  const cx = P.x, cz = P.z, rotY = P.angle ?? FALLBACKS.great_hall.angle;
  // Sample front center + left uphill wing so neither flanking pavilion nor People's Square gets buried by the SW hillside!
  const frontW = toWorld(cx, 0, cz, rotY, 0, 0, 56);
  const leftWingW = toWorld(cx, 0, cz, rotY, -58, 0, 8);
  const minRightW = toWorld(cx, 0, cz, rotY, 74, 0, -55);
  const y0 = Math.max(
    Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz),
    terrain.sample(frontW[0], frontW[2]) + 0.5,
    terrain.sample(leftWingW[0], leftWingW[2]) + 1.2,
  );
  const skirtDrop = Math.max(30, y0 - terrain.sample(minRightW[0], minRightW[2]) + 10);

  const K = new HeroKit();
  const C_MARBLE  = [0.80, 0.79, 0.75]; // Carved white marble (汉白玉)
  const C_GRANITE = [0.56, 0.54, 0.50];
  const C_CRIMSON = [0.56, 0.055, 0.042]; // Imperial palace crimson lacquer (朱红)
  const C_WALL_W  = [0.78, 0.75, 0.68];
  const C_GLAZED  = [0.06, 0.34, 0.19]; // Iconic emerald-green imperial glazed tiles (绿琉璃瓦)
  const C_DOUGONG = [0.10, 0.42, 0.36]; // Painted green-blue Qing dougong bracket frieze
  const C_GOLD    = [0.92, 0.68, 0.18];
  const C_GOLD_L  = [1.00, 0.74, 0.24];

  // ---- Deep Hillside Anchor + Asymmetric Chamfered People's Square Platform (clears SW uphill slope + front-right building!) ----
  const sqPoly = (hx, hzF, hzB, chR, chL) => [
    [-hx + chL, hzF], [hx - chR, hzF], [hx, hzF - chR], [hx, -hzB], [-hx, -hzB], [-hx, hzF - chL],
  ];
  K.style([0.34, 0.32, 0.29], 0.84, 0, 0, MAT.STONE, 0.6);
  K.prism(sqPoly(74, 82, 56, 18, 56), -skirtDrop, 0.4);
  K.style(C_GRANITE, 0.66, 0, 0, MAT.GRANITE, 1.8);
  K.prism(sqPoly(72, 80, 54, 17, 54), 0.4, 1.0);
  // Carved white marble balustrade framing People's Square front promenade
  K.balustrade([18, 1.0, 79.5], [54, 1.0, 79.5], 1.12, { rgb: C_MARBLE, matType: MAT.GRANITE, postSpacing: 4.5 });
  K.balustrade([-71.5, 1.0, 26], [-18, 1.0, 79.5], 1.12, { rgb: C_MARBLE, matType: MAT.GRANITE, postSpacing: 4.5 });

  // ---- Triple-Tiered Carved White Marble Circular Terrace (三层汉白玉台基) ----
  const terraces = [
    { r: 44.0, yA: 1.0, yB: 3.4 },
    { r: 39.2, yA: 3.4, yB: 5.8 },
    { r: 34.4, yA: 5.8, yB: 8.2 },
  ];
  for (const tr of terraces) {
    K.style(C_MARBLE, 0.58, 0, 0, MAT.GRANITE, 1.0);
    K.lathe([[tr.r + 0.4, tr.yA], [tr.r, tr.yB], [0, tr.yB]], 48);
    // Circular carved white marble balustrade around each terrace rim (48 carved posts!)
    K.lathe([[tr.r - 0.55, tr.yB + 1.02], [tr.r - 0.25, tr.yB + 1.02], [tr.r - 0.25, tr.yB + 1.18], [tr.r - 0.55, tr.yB + 1.18]], 48);
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * TAU;
      // Leave axial front opening for grand ceremonial imperial stairs (+Z)!
      if (Math.sin(a) > 0.88 && Math.abs(Math.cos(a)) < 0.28) continue;
      const bx = Math.cos(a) * (tr.r - 0.4), bz = Math.sin(a) * (tr.r - 0.4);
      K.box(bx, tr.yB + 0.64, bz, 0.32, 1.28, 0.32);
      K.sphere(bx, tr.yB + 1.38, bz, 0.20, 8, 5);
    }
  }
  // Grand axial marble ceremonial staircase climbing all 3 terraces on +Z front!
  K.stairs([0, 1.0, 49.5], [0, 8.2, 33.5], 18.0, 0.24, { rgb: C_MARBLE, cheekRgb: C_MARBLE });
  // Central carved imperial dragon-slab ramp (丹陛石) in the center of the staircase
  K.style([0.86, 0.84, 0.78], 0.52, 0, 0, MAT.GRANITE, 0.5);
  K.sweep([[0, 1.25, 49.0], [0, 8.45, 33.8]], [[1.8, 0, 0], [1.8, 0, 0]], [[0, 0.35, 0], [0, 0.35, 0]]);

  // ---- Circular Rotunda Auditorium Drum (y = 8.2 .. 42.5m) with 32 Crimson Colonnades! ----
  // Lower Drum Tier (y = 8.2 .. 22.8, R = 29.8m)
  K.style(C_CRIMSON, 0.46, 0.05, 0, MAT.PLAIN);
  K.lathe([[26.4, 8.2], [26.4, 22.4]], 40);
  // Warm golden carved gallery lattice windows around lower rotunda wall
  K.style([0.96, 0.68, 0.28], 0.32, 0, -2.2, MAT.LATTICE_WIN, 0.38);
  K.lathe([[26.65, 10.6], [26.65, 19.6]], 40);
  // Outer ring of 32 majestic crimson lacquered circular pillars (朱红大柱) with dougong capitals!
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * TAU;
    const px = Math.cos(a) * 30.8, pz = Math.sin(a) * 30.8;
    K.push().translate(px, 0, pz);
    K.column(0, 8.2, 22.4, 0.58, { shaftRgb: C_CRIMSON, baseRgb: C_MARBLE, capRgb: C_DOUGONG, sides: 12, dougong: true });
    K.pop();
  }
  // Painted green-and-gold dougong frieze ring & crimson beam ring
  K.style(C_DOUGONG, 0.48, 0.08, 0, MAT.PLAIN);
  K.lathe([[31.4, 21.0], [31.4, 22.6], [32.2, 23.2]], 48);
  K.style(C_GOLD_L, 0.25, 0, -4.8, MAT.LANTERN);
  K.lathe([[31.6, 22.4], [31.6, 22.75]], 48);

  // ---- AUTHENTIC TRIPLE-EAVED EMERALD-GREEN GLAZED TILE DOME ROOF (三重檐绿瓦攒尖顶)! ----
  // Upgraded with REAL 3D radial cylindrical glazed tile ribs (筒瓦) + dense polychrome dougong eaves frieze!
  const glazedCircularSkirt = (rOuter, rInner, yBot, yTop, flareH = 1.4, tilePitch = 0.34, nRibs = 40) => {
    const prof = [];
    const steps = 10;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const r = rOuter + (rInner - rOuter) * t;
      const lip = flareH * Math.pow(1 - t, 3.2);
      const y = yBot + (yTop - yBot) * Math.pow(t, 1.45) + lip;
      prof.push([r, y]);
    }
    K.style(C_GLAZED, 0.14, 0.10, 0, MAT.GLAZED_TILE, tilePitch, 0.88);
    K.lathe(prof, 64, 0, 0, { uvTileCircum: TAU * rOuter });
    // Real 3D raised glossy cylindrical glazed roof tile ribs (筒瓦脊) converging smoothly up the dome!
    K.style([0.08, 0.40, 0.22], 0.12, 0.12, 0, MAT.GLAZED_TILE, 0.25, 0.90);
    for (let k = 0; k < nRibs; k++) {
      const a = (k / nRibs) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      for (let s = 0; s < steps; s += 2) {
        const p0 = prof[s], p1 = prof[Math.min(steps, s + 2)];
        K.tube([ca * p0[0], p0[1] + 0.08, sa * p0[0]], [ca * p1[0], p1[1] + 0.08, sa * p1[0]], 0.14, 0.10, 4, false);
      }
    }
    // Solid imperial crimson-green underside eave fascia flush against upturned glazed lip + polychrome dougong frieze!
    const yTip = yBot + flareH;
    K.style(C_DOUGONG, 0.50, 0.05, 0, MAT.TIMBER);
    K.lathe([[rOuter - 3.6, yBot - 0.15], [rOuter - 0.12, yTip - 0.42], [rOuter, yTip - 0.42], [rOuter, yTip]], 64);
    const nDg = Math.max(16, Math.round(rOuter * 0.85));
    for (let k = 0; k < nDg; k++) {
      const a = (k / nDg) * TAU;
      K.dougongBracket(Math.cos(a) * (rOuter - 2.6), yBot - 0.45, Math.sin(a) * (rOuter - 2.6), 0.82, {
        rotY: Math.atan2(Math.cos(a), Math.sin(a)),
        woodRgb: C_CRIMSON,
        paintRgb: C_DOUGONG,
        goldRgb: C_GOLD,
        polychrome: true,
      });
    }
    // Warm gilded architectural night LED accent tucked FLUSH under the eave!
    K.style([0.52, 0.34, 0.08], 0.30, 0.4, -4.6, MAT.LANTERN);
    K.lathe([[rOuter - 0.10, yTip - 0.40], [rOuter - 0.02, yTip - 0.18]], 64);
  };

  // Eave Tier 1 (Lowest Broad Circular Glazed Eave: R = 36.2m -> 26.8m, y = 22.5 -> 28.4m)
  glazedCircularSkirt(36.2, 26.8, 22.6, 28.6, 1.6);

  // Middle Clerestory Drum (y = 27.6 .. 36.2m, R = 25.4m) with 24 crimson columns & lit gallery windows!
  K.style(C_CRIMSON, 0.45, 0.05, 0, MAT.PLAIN);
  K.lathe([[24.2, 27.6], [24.2, 36.0]], 40);
  K.style([0.98, 0.72, 0.30], 0.30, 0, -2.5, MAT.LATTICE_WIN, 0.36);
  K.lathe([[24.45, 29.4], [24.45, 34.4]], 40);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    K.push().translate(Math.cos(a) * 25.6, 0, Math.sin(a) * 25.6);
    K.column(0, 27.8, 35.8, 0.44, { shaftRgb: C_CRIMSON, baseRgb: C_MARBLE, capRgb: C_DOUGONG, sides: 10, dougong: true });
    K.pop();
  }
  K.style(C_DOUGONG, 0.48, 0.08, 0, MAT.PLAIN);
  K.lathe([[26.2, 35.0], [26.8, 36.2]], 48);

  // Eave Tier 2 (Middle Circular Glazed Eave: R = 30.8m -> 21.0m, y = 35.8 -> 41.6m)
  glazedCircularSkirt(30.8, 21.0, 35.8, 41.8, 1.5);

  // Upper Clerestory Drum (y = 40.8 .. 47.6m, R = 19.8m) with 20 crimson columns & glowing imperial frieze!
  K.style(C_CRIMSON, 0.45, 0.05, 0, MAT.PLAIN);
  K.lathe([[19.2, 40.8], [19.2, 47.4]], 36);
  K.style([1.0, 0.76, 0.34], 0.28, 0, -2.8, MAT.LATTICE_WIN, 0.34);
  K.lathe([[19.45, 42.2], [19.45, 46.2]], 36);
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * TAU;
    K.push().translate(Math.cos(a) * 20.2, 0, Math.sin(a) * 20.2);
    K.column(0, 40.8, 47.4, 0.36, { shaftRgb: C_CRIMSON, baseRgb: C_MARBLE, capRgb: C_DOUGONG, sides: 8, dougong: true });
    K.pop();
  }

  // Eave Tier 3 (Grand Sweeping Emerald Glazed Conical Dome Crown: R = 24.8m -> 0.5m, y = 47.2 -> 59.5m!)
  glazedCircularSkirt(24.8, 0.4, 47.2, 59.6, 1.8, 0.30);

  // Shimmering Multi-Tiered Golden Imperial Finial Spire (鎏金宝顶, y = 59.4 .. 65.8m!)
  K.style(C_GOLD, 0.20, 0.92, -3.5, MAT.PLAIN, 0, 0.9);
  K.lathe([
    [3.8, 59.2], [3.2, 59.8], [2.4, 60.4], [1.2, 60.9],
    [1.85, 61.9], [1.95, 62.5], [1.45, 63.2], [0.55, 63.7],
    [0.82, 64.4], [0.35, 65.1], [0.08, 66.0],
  ], 24);

  // ---- Flanking Symmetrical East & West Imperial Palace Pavilions + Connecting Corridors ----
  for (const sg of [-1, 1]) {
    // Connecting red-columned covered gallery bridge
    K.style(C_WALL_W, 0.72, 0, 0, MAT.PLAIN);
    K.box(sg * 42, 7.5, -2, 18, 12, 12);
    K.push().translate(sg * 42, 0, -2);
    K.bayuRoof(19, 13.5, 13.5, { rise: 3.4, eaveOut: 1.8, cornerLift: 1.2, tileRgb: C_GLAZED, tileMat: MAT.GLAZED_TILE, ridgeRgb: C_GOLD, woodRgb: C_CRIMSON, goldStrip: true, goldEmit: -5.2 });
    K.pop();
    // Symmetrical Flanking 2-Story Palace Wing (x = ±58, z = +8)
    const wx = sg * 58, wz = 8;
    K.style(C_MARBLE, 0.60, 0, 0, MAT.GRANITE, 1.0);
    K.box(wx, 2.2, wz, 28, 4.4, 38);
    K.style(C_WALL_W, 0.72, 0, 0, MAT.PLAIN);
    K.box(wx, 10.6, wz, 24, 12.6, 33);
    K.style([0.96, 0.70, 0.28], 0.32, 0, -2.0, MAT.LATTICE_WIN, 0.36);
    K.box(wx, 10.8, wz + 16.6, 18, 8.2, 0.14);
    for (let k = -3; k <= 3; k++) {
      K.push().translate(wx + k * 3.8, 0, wz + 17.6);
      K.column(0, 4.4, 16.6, 0.38, { shaftRgb: C_CRIMSON, baseRgb: C_MARBLE, capRgb: C_DOUGONG, dougong: true });
      K.pop();
    }
    // Double-eaved emerald glazed upturned hip roof atop each palace wing!
    K.push().translate(wx, 0, wz);
    K.bayuRoof(26, 36, 16.8, { rise: 4.0, eaveOut: 2.2, cornerLift: 1.5, tileRgb: C_GLAZED, tileMat: MAT.GLAZED_TILE, ridgeRgb: C_GOLD, woodRgb: C_CRIMSON, goldStrip: true, goldEmit: -5.4 });
    K.style(C_CRIMSON, 0.45, 0, 0, MAT.PLAIN);
    K.box(0, 22.0, 0, 17, 3.6, 25);
    K.bayuRoof(18, 26, 23.8, { rise: 4.8, eaveOut: 2.2, cornerLift: 1.7, tileRgb: C_GLAZED, tileMat: MAT.GLAZED_TILE, ridgeRgb: C_GOLD, woodRgb: C_CRIMSON, goldStrip: true, goldEmit: -5.8 });
    K.pop();
  }

  // ---- Monumental Imperial Entrance Archway (三间四柱琉璃牌坊) at People's Square Front (z = +72) ----
  K.push().translate(0, 1.0, 72);
  K.style(C_MARBLE, 0.58, 0, 0, MAT.GRANITE, 0.8);
  K.box(0, 0.55, 0, 32, 1.1, 6.5);
  // 4 towering crimson-and-marble archway pillars
  for (const px of [-12.5, -4.8, 4.8, 12.5]) {
    K.column(px, 1.1, 13.5, 0.52, { shaftRgb: C_CRIMSON, baseRgb: C_MARBLE, capRgb: C_DOUGONG, dougong: true });
  }
  K.style(C_CRIMSON, 0.45, 0, 0, MAT.PLAIN);
  K.box(0, 12.6, 0, 27, 1.4, 1.6);
  K.style(C_DOUGONG, 0.48, 0.08, 0, MAT.PLAIN);
  K.box(0, 14.0, 0, 11.4, 1.6, 1.8);
  // Triple-tiered emerald glazed tile archway roofs (higher central span, flanking side spans!)
  K.bayuRoof(12.2, 5.4, 15.0, { rise: 3.4, eaveOut: 1.6, cornerLift: 1.4, tileRgb: C_GLAZED, tileMat: MAT.GLAZED_TILE, ridgeRgb: C_GOLD, woodRgb: C_CRIMSON, goldStrip: true, goldEmit: -6.0 });
  for (const sg of [-1, 1]) {
    K.push().translate(sg * 9.2, 0, 0);
    K.bayuRoof(8.8, 4.6, 12.8, { rise: 2.6, eaveOut: 1.3, cornerLift: 1.1, tileRgb: C_GLAZED, tileMat: MAT.GLAZED_TILE, ridgeRgb: C_GOLD, woodRgb: C_CRIMSON, goldStrip: true, goldEmit: -5.6 });
    K.pop();
  }
  K.pop();

  const sub = new THREE.Group();
  sub.name = 'great-hall-of-the-people';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);

  const plaque = makePlaque('重庆市人民大礼堂', {
    w: 7.4, h: 2.1, bg: '#5a0e0a', fg: '#ffd45e', border: '#e5a928',
    emissiveNight: 2.8, emissiveDay: 0.06,
  });
  plaque.position.set(0, 13.8, 72.95);
  sub.add(plaque);
  group.add(sub);

  const polyW = (pts) => pts.map(([lx, lz]) => { const w = toWorld(cx, 0, cz, rotY, lx, 0, lz); return [w[0], w[2]]; });
  const ghBase = y0 - skirtDrop - 10;
  // Solid retaining plinth beneath elevated People's Square (blocks walking UNDER downhill walls while top stays 100% walkable!)
  prisms.push({ type: 'poly', pts: polyW(sqPoly(74, 82, 56, 18, 56)), base: ghBase, top: y0 + 0.92 });
  prisms.push({ type: 'circle', x: cx, z: cz, r: 34, base: ghBase, top: y0 + 65, sides: 16 });
  for (const sg of [-1, 1]) {
    prisms.push({ type: 'rect', ...xyObj(toWorld(cx, y0, cz, rotY, sg * 58, 0, 8)), ang: rotY, hx: 14, hz: 19, base: ghBase, top: y0 + 28 });
  }
  plazas.push({ type: 'polyPlaza', pts: polyW(sqPoly(72, 80, 54, 17, 54)), base: y0 - 4, top: y0 + 1.04 });
  // Imperial golden-amber floodlighting bathing the emerald dome & crimson colonnades!
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    const [wx, wy, wz] = toWorld(cx, y0, cz, rotY, Math.cos(a) * 40, 22, Math.sin(a) * 40);
    lights.push({ x: wx, y: wy, z: wz, radius: 70, r: 1.0, g: 0.78, b: 0.38, intensity: 3200, omni: 1 });
  }
  for (const [lx, ly, lz] of [[0, 56, 0], [0, 14, 78], [-58, 18, 28], [58, 18, 28]]) {
    const [wx, wy, wz] = toWorld(cx, y0, cz, rotY, lx, ly, lz);
    lights.push({ x: wx, y: wy, z: wz, radius: 68, r: 1.0, g: 0.80, b: 0.42, intensity: 3000, omni: 1 });
  }
  labels.push({ name: '重庆人民大礼堂', x: cx, y: y0 + 74, z: cz });
}

// ===================================================================================================
// 3. 重庆科技馆 (Chongqing Science & Technology Museum at Jiangbeizui)
// ===================================================================================================
function addScienceMuseum(group, P, terrain, materials, prisms, lights, labels) {
  const cx = P.x, cz = P.z, rotY = P.angle ?? FALLBACKS.science_museum.angle;
  const perimHs = [[-64, -45], [0, -45], [64, -45], [64, 0], [64, 45], [0, 45], [-64, 45], [-64, 0]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const maxDEM = Math.max(...perimHs), minDEM = Math.min(...perimHs);
  const y0 = Math.max(Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz), maxDEM + 0.3);
  const skirtDrop = Math.max(24, y0 - minDEM + 8);

  const K = new HeroKit();
  const C_LIME   = [0.74, 0.72, 0.66]; // Pale sculpted Chongqing limestone cladding
  const C_STONE  = [0.40, 0.39, 0.36];
  const C_GLASS  = [0.09, 0.17, 0.25];
  const C_STEEL  = [0.70, 0.74, 0.78];
  const C_LED    = [0.46, 0.86, 1.00];

  // Deep bedrock cliff anchor + broad chamfered granite waterfront podium (clears Jiangbeizui front-right loop road cleanly!)
  const sciPoly = (hx, hz, ch) => [
    [-hx + ch, hz], [hx - ch, hz], [hx, hz - ch], [hx, -hz + ch * 0.5],
    [hx - ch * 0.5, -hz], [-hx + ch * 0.5, -hz], [-hx, -hz + ch * 0.5], [-hx, hz - ch],
  ];
  K.style(C_STONE, 0.85, 0, 0, MAT.STONE, 0.65);
  K.prism(sciPoly(62, 42, 22), -skirtDrop, 0);
  K.style([0.55, 0.53, 0.49], 0.68, 0, 0, MAT.GRANITE, 1.5);
  K.prism(sciPoly(60, 40, 21), 0, 4.4);
  K.stairs([0, 0, 44], [0, 4.4, 37], 26, 0.24, { rgb: [0.56, 0.54, 0.50], cheekRgb: C_STONE });

  // Sculpted angular faceted crystalline wings fanning outward (signature "living fan / rock crystal" geometry!)
  const wings = [
    { x: -34, z: -6, ry: -0.34, len: 58, w0: 14, w1: 22, h0: 18, h1: 36, cant: 12 },
    { x:   0, z:  4, ry:  0.04, len: 68, w0: 16, w1: 24, h0: 22, h1: 44, cant: 16 },
    { x:  34, z: -4, ry:  0.38, len: 56, w0: 14, w1: 20, h0: 18, h1: 34, cant: 11 },
  ];
  for (const wg of wings) {
    K.push().translate(wg.x, 4.4, wg.z).rotateY(wg.ry);
    // Faceted angled limestone prism cantilevering forward (+Z)!
    const rBack = [[-wg.w0, 0, -wg.len * 0.45], [wg.w0, 0, -wg.len * 0.45], [wg.w0 * 0.85, wg.h0, -wg.len * 0.40], [-wg.w0 * 0.85, wg.h0 * 1.06, -wg.len * 0.40]];
    const rFront = [[-wg.w1 * 0.82, 4.2, wg.len * 0.55], [wg.w1 * 0.82, 4.2, wg.len * 0.55], [wg.w1, wg.h1, wg.len * 0.55 + wg.cant], [-wg.w1, wg.h1 * 0.92, wg.len * 0.55 + wg.cant]];
    K.style(C_LIME, 0.52, 0.05, 0, MAT.GRANITE, 1.6);
    K.loft([rBack, rFront], { caps: true, smooth: false });
    // Deep recessed diagonal glass curtain-wall face at cantilevered front nose!
    K.style(C_GLASS, 0.09, 0.16, 0, MAT.GLASS, 2.8, 0.96);
    K.quad(
      [-wg.w1 * 0.72, 5.2, wg.len * 0.55 + 0.4], [wg.w1 * 0.72, 5.2, wg.len * 0.55 + 0.4],
      [wg.w1 * 0.88, wg.h1 - 1.4, wg.len * 0.55 + wg.cant - 0.3], [-wg.w1 * 0.88, wg.h1 * 0.92 - 1.4, wg.len * 0.55 + wg.cant - 0.3]
    );
    // 3D projecting vertical structural steel mullions on glazed nose
    K.style(C_STEEL, 0.26, 0.85, 0, MAT.PLAIN);
    for (let k = -3; k <= 3; k++) {
      const f = k / 3.5;
      K.tube([f * wg.w1 * 0.72, 5.2, wg.len * 0.55 + 0.55], [f * wg.w1 * 0.88, wg.h1 * 0.96 - 1.4, wg.len * 0.55 + wg.cant - 0.15], 0.22, 0.22, 5, false);
    }
    // Crisp cyan-white night architectural edge rib tracing cantilevered silhouette!
    K.style(C_LED, 0.22, 0, -4.8, MAT.LANTERN);
    K.tube(rFront[2], rFront[3], 0.24, 0.24, 4, false);
    K.tube(rBack[2], rFront[2], 0.22, 0.22, 4, false);
    K.tube(rBack[3], rFront[3], 0.22, 0.22, 4, false);
    K.pop();
  }

  const sub = new THREE.Group();
  sub.name = 'science-museum';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);
  group.add(sub);

  const polyW = (pts) => pts.map(([lx, lz]) => { const w = toWorld(cx, 0, cz, rotY, lx, 0, lz); return [w[0], w[2]]; });
  const sciBase = Math.min(y0 - skirtDrop, minDEM - 18);
  prisms.push({ type: 'poly', pts: polyW(sciPoly(62, 42, 22)), base: sciBase, top: y0 + 48 });
  lights.push({ x: cx, y: y0 + 36, z: cz, radius: 75, r: 0.48, g: 0.86, b: 1.0, intensity: 3200, omni: 1 });
  labels.push({ name: '重庆科技馆', x: cx, y: y0 + 56, z: cz });
}

// ===================================================================================================
// 4. 魁星楼 (Kuixinglou — Iconic 8D "1F is 22F" Rooftop Plaza & Twin Skybridges!)
// ===================================================================================================
function addKuixinglou(group, P, terrain, materials, prisms, plazas, decks, lights, labels) {
  const cx = P.x, cz = P.z, rotY = P.angle ?? FALLBACKS.kuixinglou.angle;
  // Kuixinglou's famous 22F rooftop square sits cleanly at P.plazaY (113.36m in real DEM), while its base drops into the lower canyon!
  const yTop = Number.isFinite(P.plazaY) ? P.plazaY : Math.max(terrain.sample(cx, cz) + 12, (P.baseY ?? 92) + 21);
  const towerH = 62;
  const yBot = yTop - towerH;

  const K = new HeroKit();
  const C_CONC    = [0.58, 0.56, 0.52];
  const C_GLASS   = [0.10, 0.16, 0.21];
  const C_GRANITE = [0.52, 0.50, 0.46];
  const C_STEEL   = [0.72, 0.75, 0.78];

  // Sample hillside slope around Kuixinglou so lower window bands sit cleanly ABOVE a solid dressed-sandstone cliff plinth!
  const kDEMs = [[-36, -20], [10, -20], [-36, 20], [10, 20]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const plinthTopLocal = Math.max(10, Math.min(towerH - 22, Math.max(...kDEMs) - yBot + 1.2));

  // Deep 22-story cliffside commercial tower below the rooftop plaza (y = 0 .. 62m local)
  K.style([0.32, 0.30, 0.27], 0.86, 0, 0, MAT.STONE, 0.62);
  K.box(-14, (plinthTopLocal - 12) / 2, 0, 50.2, plinthTopLocal + 12, 44.2);
  K.style(C_GRANITE, 0.68, 0, 0, MAT.GRANITE, 1.2);
  K.box(-14, plinthTopLocal + 0.3, 0, 51.0, 0.65, 45.0);
  K.style(C_CONC, 0.72, 0, 0, MAT.CONCRETE, 2.4);
  K.box(-14, (plinthTopLocal + towerH) / 2, 0, 48, towerH - plinthTopLocal, 42);
  // Horizontal floor ledges, 3D vertical mullions & recessed glass bands cleanly above the sandstone slope plinth!
  for (let fy = plinthTopLocal + 0.8; fy < towerH - 3.0; fy += 3.6) {
    K.style(C_GLASS, 0.12, 0.16, 0, MAT.GLASS, 2.8, 0.92);
    K.box(-14, fy + 1.5, 0, 48.3, 2.1, 42.3);
    K.style(C_CONC, 0.70, 0, 0, MAT.CONCRETE, 2.2);
    K.box(-14, fy + 2.8, 0, 49.0, 0.45, 43.0);
  }

  // Walkable 22F Rooftop Pedestrian Square (y = towerH) + Perimeter Safety Glass/Stone Railings
  K.style(C_GRANITE, 0.66, 0, 0, MAT.GRANITE, 1.3);
  K.box(-14, towerH + 0.25, 0, 52, 0.6, 46);
  K.balustrade([-39, towerH + 0.55, 22.6], [11.5, towerH + 0.55, 22.6], 1.25, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 3.5, goldCap: true });
  K.balustrade([-39, towerH + 0.55, -22.6], [11.5, towerH + 0.55, -22.6], 1.25, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 3.5, goldCap: true });
  K.balustrade([11.5, towerH + 0.55, -22.6], [11.5, towerH + 0.55, -9], 1.25, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 3.2 });
  K.balustrade([11.5, towerH + 0.55, 9], [11.5, towerH + 0.55, 22.6], 1.25, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 3.2 });

  // Traditional Bayu Pavilion perched on the 22F plaza corner (with solid timber frieze under eaves — ZERO floating gap!)
  K.push().translate(-24, towerH + 0.55, -10);
  K.style(C_GRANITE, 0.68, 0, 0, MAT.GRANITE, 0.9);
  K.box(0, 0.22, 0, 10.6, 0.44, 10.6);
  for (const sx of [-4.2, 4.2]) for (const sz of [-4.2, 4.2]) {
    K.column(sx, 0.44, 4.8, 0.26, { shaftRgb: [0.42, 0.08, 0.05], baseRgb: C_GRANITE, capRgb: [0.18, 0.07, 0.04], dougong: true });
  }
  K.style([0.14, 0.05, 0.025], 0.52, 0, 0, MAT.TIMBER);
  K.box(0, 4.65, 0, 9.2, 0.75, 9.2); // solid timber eave beam ring tying columns cleanly into roof!
  K.bayuRoof(10.5, 10.5, 4.55, { rise: 3.2, eaveOut: 1.5, cornerLift: 1.05, goldStrip: true, goldEmit: -5.4 });
  K.pop();

  // Neighboring Cliffside Receiving Commercial High-Rise across the 26m chasm (x = +46)
  // Phase 4 Fix (t05/t06): FULL 4-sided curtain-wall glazing + 3D floor spandrel slabs + vertical silver mullions +
  // glazed skybridge reception portals & canopies (NO blank windowless concrete monolith!)
  const rx = 46, rW = 26, rD = 34, rH = towerH + 26;
  const rDEMs = [[33, -17], [59, -17], [59, 17], [33, 17]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const rPlinthTop = Math.max(12, Math.min(towerH - 8, Math.max(...rDEMs) - yBot + 1.2));
  // Grounded dressed-sandstone slope retaining base wrapping receiving tower cleanly into cliff
  K.style([0.32, 0.30, 0.27], 0.86, 0, 0, MAT.STONE, 0.62);
  K.box(rx, (rPlinthTop - 14) / 2, 0, rW + 1.2, rPlinthTop + 14, rD + 1.2);
  K.style(C_GRANITE, 0.66, 0, 0, MAT.GRANITE, 1.2);
  K.box(rx, rPlinthTop + 0.3, 0, rW + 1.8, 0.6, rD + 1.8);
  // Recessed concrete structural core + FULL 4-SIDED glazed curtain-wall skin (proud on BOTH ±X and ±Z!)
  K.style(C_CONC, 0.72, 0, 0, MAT.CONCRETE, 2.4);
  K.box(rx, (rPlinthTop + rH) / 2, 0, rW - 0.6, rH - rPlinthTop, rD - 0.6);
  K.style(C_GLASS, 0.10, 0.18, 0, MAT.GLASS, 2.6, 0.94);
  K.box(rx, (rPlinthTop + rH) / 2, 0, rW + 0.1, rH - rPlinthTop - 1.2, rD + 0.1);
  // Crisp 3D floor spandrel bands & vertical aluminum fins on ALL 4 faces!
  K.style(C_CONC, 0.64, 0.08, 0, MAT.CONCRETE, 2.0);
  for (let fy = rPlinthTop + 3.6; fy <= rH; fy += 3.6) {
    K.box(rx, fy, 0, rW + 0.65, 0.55, rD + 0.65);
  }
  K.style(C_STEEL, 0.26, 0.84, 0, MAT.METAL, 2.2);
  for (let mx = -11; mx <= 11; mx += 4.4) {
    for (const sz of [-1, 1]) K.box(rx + mx, (rPlinthTop + rH) / 2, sz * (rD / 2 + 0.22), 0.24, rH - rPlinthTop, 0.36);
  }
  for (let mz = -14; mz <= 14; mz += 4.6) {
    for (const sx of [-1, 1]) K.box(rx + sx * (rW / 2 + 0.22), (rPlinthTop + rH) / 2, mz, 0.36, rH - rPlinthTop, 0.24);
  }
  // Rooftop parapet & mechanical crown
  K.style(C_CONC, 0.70, 0, 0, MAT.CONCRETE, 2.2);
  K.box(rx, rH + 0.8, 0, rW + 0.8, 1.6, rD + 0.8);
  K.box(rx, rH + 3.4, 0, rW * 0.58, 3.8, rD * 0.55);
  // Sculpted steel-and-glass skybridge entry portals & cantilevered canopies on the receiving tower west face (-X)!
  for (const bz of [-4.8, 4.8]) {
    K.style(C_STEEL, 0.26, 0.86, 0, MAT.METAL);
    K.box(rx - rW / 2 - 0.6, towerH + 4.4, bz, 2.6, 0.42, 4.8); // entrance rain canopy
    K.box(rx - rW / 2 - 0.2, towerH + 2.2, bz - 2.1, 0.55, 4.4, 0.42);
    K.box(rx - rW / 2 - 0.2, towerH + 2.2, bz + 2.1, 0.55, 4.4, 0.42);
    K.style([1.0, 0.82, 0.48], 0.16, 0.10, -2.6, MAT.GLASS, 2.2, 0.94);
    K.box(rx - rW / 2 - 0.15, towerH + 2.2, bz, 0.22, 4.0, 3.8); // glowing glazed lobby doors!
  }

  // ---- ICONIC TWIN HIGH-ALTITUDE SKYBRIDGES (双空中廊桥, 26m span, 62m above canyon!) ----
  for (const bz of [-4.8, 4.8]) {
    // Structural steel-and-concrete box deck
    K.style(C_STEEL, 0.34, 0.80, 0, MAT.PLAIN);
    K.box(22.5, towerH - 0.35, bz, 25.0, 1.35, 3.6);
    // Open steel diagonal truss underneath each skybridge!
    for (let k = 0; k < 6; k++) {
      const xa = 11.0 + k * 3.85, xb = xa + 3.85;
      for (const sz of [-1.6, 1.6]) {
        K.tube([xa, towerH - 2.3, bz + sz], [xb, towerH - 2.3, bz + sz], 0.14, 0.14, 5, false);
        K.tube([xa, towerH - 2.3, bz + sz], [xa + 1.92, towerH - 0.9, bz + sz], 0.10, 0.10, 4, false);
        K.tube([xa + 1.92, towerH - 0.9, bz + sz], [xb, towerH - 2.3, bz + sz], 0.10, 0.10, 4, false);
      }
    }
    // Walkable granite deck surface & side railings
    K.style(C_GRANITE, 0.65, 0, 0, MAT.GRANITE, 1.0);
    K.box(22.5, towerH + 0.42, bz, 25.0, 0.18, 3.3);
    K.balustrade([11.0, towerH + 0.5, bz - 1.55], [34.0, towerH + 0.5, bz - 1.55], 1.25, { rgb: C_STEEL, matType: MAT.PLAIN, postSpacing: 2.8, goldCap: true });
    K.balustrade([11.0, towerH + 0.5, bz + 1.55], [34.0, towerH + 0.5, bz + 1.55], 1.25, { rgb: C_STEEL, matType: MAT.PLAIN, postSpacing: 2.8, goldCap: true });

    // Walkable skybridge deck collider!
    const pA = toWorld(cx, yBot, cz, rotY, 10.5, towerH + 0.52, bz);
    const pB = toWorld(cx, yBot, cz, rotY, 34.5, towerH + 0.52, bz);
    decks.push([pA[0], pA[2], pA[1], pB[0], pB[2], pB[1], 1.8]);
  }

  const sub = new THREE.Group();
  sub.name = 'kuixinglou';
  sub.position.set(cx, yBot, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);
  group.add(sub);

  prisms.push({ type: 'rect', ...xyObj(toWorld(cx, yBot, cz, rotY, -14, 0, 0)), ang: rotY, hx: 24, hz: 21, base: yBot - 22, top: yTop + 0.4 });
  prisms.push({ type: 'rect', ...xyObj(toWorld(cx, yBot, cz, rotY, 46, 0, 0)), ang: rotY, hx: 13.5, hz: 17.5, base: yBot - 22, top: yTop + 24 });
  plazas.push({ type: 'rectPlaza', ...xyObj(toWorld(cx, yBot, cz, rotY, -14, towerH + 0.55, 0)), ang: rotY, hx: 26, hz: 23, base: yTop - 3, top: yTop + 0.58 });
  const [lx, ly, lz] = toWorld(cx, yBot, cz, rotY, 22, towerH + 4, 0);
  lights.push({ x: lx, y: ly, z: lz, radius: 52, r: 1.0, g: 0.78, b: 0.40, intensity: 2200, omni: 1 });
  labels.push({ name: '魁星楼 (22F悬空广场)', x: cx, y: yTop + 14, z: cz });
}

// ===================================================================================================
// 5. 白象居 (Baixiangju — Iconic 24-Story Elevator-less Residential Complex & Sky-Corridors!)
//    Round 2 Upgrade: authentic weathered 1990s Chongqing warm ochre-grey concrete/mosaic patina,
//    open metal balcony railings, 3D AC outdoor unit boxes, recessed corridor loggias, and bolder
//    multi-story mid-air connecting skybridges (连廊) framing the Yangtze River Cableway!
// ===================================================================================================
function addBaixiangju(group, P, terrain, materials, prisms, lights, labels) {
  const cx = P.x, cz = P.z, rotY = P.angle ?? FALLBACKS.baixiangju.angle;
  const cornerHs = [[-46, -12], [0, -12], [46, -12], [46, 0], [46, 12], [0, 12], [-46, 12], [-46, 0]].map(([lx, lz]) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, lz);
    return terrain.sample(w[0], w[2]);
  });
  const maxDEM = Math.max(...cornerHs), minDEM = Math.min(...cornerHs);
  const y0 = Math.max(Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz), maxDEM + 0.35);
  const skirtDrop = Math.max(26, y0 - minDEM + 10);

  const K = new HeroKit();
  const C_WALL    = [0.56, 0.49, 0.40]; // Authentic 1990s weathered Chongqing warm sandstone-ochre concrete!
  const C_WALL_D  = [0.46, 0.40, 0.33];
  const C_TRIM    = [0.34, 0.30, 0.26]; // Weathered concrete lintels & skybridge trim
  const C_RAIL    = [0.22, 0.24, 0.25]; // Dark wrought-iron balcony railings
  const C_AC      = [0.64, 0.62, 0.58]; // 3D AC outdoor condenser boxes
  const C_STONE   = [0.30, 0.28, 0.24];
  const C_GLASS   = [0.08, 0.11, 0.14];

  // Deep cliffside sandstone retaining plinths descending below hillside grade across all 5 staggered blocks
  K.style(C_STONE, 0.88, 0, 0, MAT.STONE, 0.60);
  K.box(0, -skirtDrop / 2, 0, 96, skirtDrop, 28);

  // 5 Staggered 24-Story Residential Blocks stepping gently along the Yangtze hillside!
  const nBlocks = 5;
  const bw = 15.2, bd = 18.0, gap = 3.8;
  const stepX = bw + gap;
  const xStart = -((nBlocks - 1) * stepX) / 2;

  for (let i = 0; i < nBlocks; i++) {
    const bx = xStart + i * stepX;
    const bz = (i % 2 === 0 ? -1.6 : 1.8);
    const floors = 22 + (i % 3);
    const fH = 2.95;
    const bh = floors * fH;

    // Main weathered 1990s Chongqing glazed ceramic mosaic facade block (MAT.MOSAIC!) + exterior PVC drainpipes!
    K.style(i % 2 === 0 ? C_WALL : C_WALL_D, 0.80, 0, 0, MAT.MOSAIC, 0.20);
    K.box(bx, bh / 2, bz, bw, bh, bd);
    // Exterior vertical rainwater PVC drainpipes (落水管) running down block corners!
    K.drainpipe(bx - bw / 2 - 0.08, 0.4, bh, bz + bd / 2 - 0.4, 0.085);
    K.drainpipe(bx + bw / 2 + 0.08, 0.4, bh, bz - bd / 2 + 0.4, 0.085);
    // Deep recessed vertical open-air stairwell slot with weathered concrete stair landings (glass >=0.08m proud -> ZERO Z-fighting!)
    K.style(C_TRIM, 0.84, 0, 0, MAT.CONCRETE, 2.2);
    K.box(bx, bh / 2, bz + bd / 2 - 0.15, 3.2, bh - 2, 0.55);
    K.style(C_GLASS, 0.18, 0.10, -1.0, MAT.GLASS, 2.0, 0.80);
    K.box(bx, bh / 2, bz + bd / 2 + 0.18, 2.5, bh - 3, 0.10);

    // Real 3D projecting weathered balcony slabs, open iron railings, security cages (防盗网), laundry & AC units!
    for (let fl = 2; fl < floors; fl += 2) {
      const fy = fl * fH;
      for (const side of [-1, 1]) {
        const zFace = bz + side * (bd / 2 + 0.82);
        for (const sx of [-4.5, 4.5]) {
          // Projecting concrete floor slab & side divider wing walls
          K.style(C_WALL_D, 0.84, 0, 0, MAT.CONCRETE, 2.0);
          K.box(bx + sx, fy, zFace, 5.4, 0.26, 1.68);
          K.box(bx + sx - 2.6, fy + 1.4, zFace, 0.22, 2.8, 1.55);
          K.box(bx + sx + 2.6, fy + 1.4, zFace, 0.22, 2.8, 1.55);
          // Half-height weathered concrete curb + crisp open iron handrail & vertical balusters
          K.style(C_TRIM, 0.84, 0, 0, MAT.CONCRETE, 1.8);
          K.box(bx + sx, fy + 0.34, zFace + side * 0.74, 5.2, 0.48, 0.16);
          K.style(C_RAIL, 0.42, 0.70, 0, MAT.METAL);
          K.box(bx + sx, fy + 1.04, zFace + side * 0.76, 5.2, 0.08, 0.08);
          for (let r = -2; r <= 2; r++) {
            K.box(bx + sx + r * 1.0, fy + 0.78, zFace + side * 0.76, 0.06, 0.52, 0.06);
          }
          // Authentic Chongqing stainless-steel security cage (防盗网) on ~35% of apartment balconies!
          const bSeed = i * 31 + fl * 7 + (sx > 0 ? 3 : 1) + (side > 0 ? 11 : 0);
          if (bSeed % 3 === 0) {
            K.securityCage(bx + sx, fy + 1.65, zFace + side * 0.52, 4.8, 1.8, 0.42, side > 0 ? 0 : Math.PI);
          } else if (fl % 4 === 2) {
            // Lived-in potted plants & balcony laundry drying poles!
            K.balconyClutter(bx + sx, fy + 0.14, zFace, 4.2, side > 0 ? 0 : Math.PI, bSeed);
          }
          // 3D AC outdoor unit box mounted beside balcony!
          K.style(C_AC, 0.62, 0.18, 0, MAT.LOUVER, 0.14);
          K.box(bx + sx + (sx > 0 ? 1.8 : -1.8), fy + 0.56, zFace + side * 0.96, 0.88, 0.62, 0.38);
          // Lived-in residential window recessed behind balcony (>=0.08m proud of mosaic wall -> ZERO Z-fighting!)
          K.style(C_GLASS, 0.12, 0.12, 0, MAT.GLASS, 2.2, 0.88);
          K.box(bx + sx, fy + 1.50, bz + side * (bd / 2 + 0.08), 4.4, 1.9, 0.12);
        }
      }
    }

    // Weathered rooftop parapet walls, stairwell penthouse shed & stainless water tank
    K.style(C_WALL_D, 0.86, 0, 0, MAT.CONCRETE, 2.0);
    K.box(bx, bh + 0.65, bz, bw + 0.35, 1.3, bd + 0.35);
    K.style(C_TRIM, 0.82, 0, 0, MAT.CONCRETE, 1.8);
    K.box(bx, bh + 2.8, bz - 1.5, 6.2, 3.8, 5.2);
    K.style([0.66, 0.68, 0.70], 0.30, 0.84, 0, MAT.METAL);
    K.tube([bx + 3.6, bh + 1.2, bz + 3.0], [bx + 3.6, bh + 3.4, bz + 3.0], 0.95, 0.95, 10, true);

    // ICONIC BOLDER MID-AIR CONNECTING SKY-CORRIDOR BRIDGES (连廊) at 8F, 13F & 18F framing the Yangtze Cableway!
    if (i < nBlocks - 1) {
      const midX = bx + stepX / 2;
      const midZ = 0.2;
      for (const cFloor of [8, 13, 18]) {
        const cy = cFloor * fH;
        // Heavy concrete bridge girder deck + overhanging rain roof slab + side support piers
        K.style(C_TRIM, 0.82, 0, 0, MAT.CONCRETE, 2.2);
        K.box(midX, cy - 0.15, midZ, gap + 2.8, 0.72, 4.6);
        K.box(midX, cy + 3.35, midZ, gap + 2.8, 0.48, 5.0);
        // Side safety parapets + iron corridor guardrails + open vertical window columns
        K.style(C_WALL, 0.84, 0, 0, MAT.MOSAIC, 0.20);
        for (const sz of [-2.15, 2.15]) {
          K.box(midX, cy + 0.72, midZ + sz, gap + 2.4, 1.05, 0.22);
          K.box(midX - 0.8, cy + 2.1, midZ + sz, 0.28, 2.2, 0.28);
          K.box(midX + 0.8, cy + 2.1, midZ + sz, 0.28, 2.2, 0.28);
        }
        // Warm glowing Chongqing corridor ceiling lamp!
        K.style([1.0, 0.72, 0.28], 0.28, 0, -4.4, MAT.LANTERN);
        K.box(midX, cy + 3.0, midZ, gap + 1.2, 0.16, 0.9);
      }
    }
  }

  const sub = new THREE.Group();
  sub.name = 'baixiangju';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);
  group.add(sub);

  const bxjBase = Math.min(y0 - skirtDrop, minDEM - 18);
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 48, hz: 14, base: bxjBase, top: y0 + 0.2 });
  prisms.push({ type: 'rect', x: cx, z: cz, ang: rotY, hx: 46, hz: 12, base: bxjBase, top: y0 + 74 });
  lights.push({ x: cx, y: y0 + 44, z: cz, radius: 64, r: 1.0, g: 0.76, b: 0.42, intensity: 2200, omni: 1 });
  labels.push({ name: '白象居', x: cx, y: y0 + 82, z: cz });
}

// ===================================================================================================
// 6. 十八梯 (Shibati — Cascading Traditional Bayu Mountain Stairway & Courtyard District!)
// ===================================================================================================
function addShibati(group, P, terrain, materials, makePlaque, prisms, decks, lights, labels) {
  const cx = P.x, cz = P.z;
  // Auto-align local +Z with the exact steepest downhill slope from the real DEM so the blue-stone mountain
  // stairs climb straight up the real hillside with zero floating and zero buried courtyards!
  let rotY = P.angle ?? FALLBACKS.shibati.angle;
  let bestDrop = -1e9;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const pD = toWorld(cx, 0, cz, a, 0, 0, 50), pU = toWorld(cx, 0, cz, a, 0, 0, -50);
    const drop = terrain.sample(pU[0], pU[2]) - terrain.sample(pD[0], pD[2]);
    if (drop > bestDrop) { bestDrop = drop; rotY = a; }
  }
  const pLow = toWorld(cx, 0, cz, rotY, 0, 0, 52);
  const pHigh = toWorld(cx, 0, cz, rotY, 0, 0, -52);
  const yBot = terrain.sample(pLow[0], pLow[2]) + 0.4;
  const yRise = Math.max(12, Math.min(34, terrain.sample(pHigh[0], pHigh[2]) - yBot + 2.0));

  const K = new HeroKit();
  const C_STONE   = [0.42, 0.40, 0.36];
  const C_GRANITE = [0.48, 0.47, 0.44];
  const C_PLASTER = [0.76, 0.73, 0.65];
  const C_WOOD    = [0.18, 0.065, 0.038];
  const C_TILE    = [0.085, 0.092, 0.105];

  // Central cascading blue-stone mountain stairway (青石梯坎, 6 stepped flights & landings from z=+52 to z=-52!)
  const nFlights = 6;
  const z0 = 52, z1 = -52;
  const dz = (z1 - z0) / nFlights;
  const dy = yRise / nFlights;

  for (let i = 0; i < nFlights; i++) {
    const za = z0 + i * dz, zb = za + dz;
    const ya = i * dy, yb = (i + 1) * dy;
    // Deep stone retaining base beneath stairs & flanking courtyards (leave +X cross-alley open on flight i=4!)
    K.style(C_STONE, 0.86, 0, 0, MAT.STONE, 0.58);
    if (i === 4) K.box(-11.5, (ya - 12) / 2, (za + zb) / 2, 33, ya + 12, Math.abs(dz) + 1.5);
    else K.box(0, (ya - 12) / 2, (za + zb) / 2, 50, ya + 12, Math.abs(dz) + 1.5);
    // Stone stairway flight
    K.stairs([0, ya, za], [0, yb, zb + 3.2], 7.4, 0.24, { rgb: C_GRANITE, cheekRgb: C_STONE });
    // Level stone landing at top of flight
    K.style(C_GRANITE, 0.70, 0, 0, MAT.GRANITE, 1.0);
    K.box(0, yb - 0.25, zb + 1.6, 8.6, 0.5, 3.6);
    // Walkable stair deck collider segment
    const wA = toWorld(cx, yBot, cz, rotY, 0, ya + 0.1, za);
    const wB = toWorld(cx, yBot, cz, rotY, 0, yb + 0.1, zb);
    decks.push([wA[0], wA[2], wA[1], wB[0], wB[2], wB[1], 4.2]);

    // Flanking cascading Bayu terraced courtyard shophouses on LEFT (-X) & RIGHT (+X)!
    // Phase 4 Fix (t01): FULL 4-sided authentic whitewashed Bayu timber-framed facades + lattice windows on ALL street faces
    // + solid dark-timber upper eave collar + real cross-alley opening on right-side flight i=4 so cls=5 lane passes cleanly!
    for (const sg of [-1, 1]) {
      // Flight i=4 spans z ∈ [-17.3, -34.6]; a local cls=5 service lane crosses the +X side at z ∈ [-21.5, -26.5] -> leave a real Bayu cross-alley!
      if (sg === 1 && i === 4) continue;
      const hx = sg * 14.8, hz = (za + zb) / 2;
      const hy = (ya + yb) / 2;
      const sh = 7.4 + (i % 2) * 3.4;
      const hw = 14.2, hd = Math.abs(dz) - 2.2;
      // Level dressed-sandstone courtyard foundation dropping cleanly below hillside street (0.8m apron avoids neighbor overlap!)
      K.style(C_STONE, 0.86, 0, 0, MAT.STONE, 0.58);
      K.box(hx, hy - 6.0, hz, hw + 1.2, 12.0, hd + 0.8);
      K.style([0.36, 0.35, 0.34], 0.88, 0, 0, MAT.BRICK);
      K.box(hx, hy + 1.1, hz, hw + 0.20, 2.2, hd + 0.20);
      // Warm whitewashed Bayu plaster walls (rough=0.52 -> L10 plaster, NEVER raw formwork concrete!)
      K.style(C_PLASTER, 0.52, 0, 0, MAT.PLAIN);
      K.box(hx, hy + 2.2 + (sh - 2.2) / 2, hz, hw, sh - 2.2, hd);
      // Solid dark-espresso Bayu timber post-and-beam frame (穿斗式木构) wrapping ALL FOUR FACES + attic roof collar!
      K.style(C_WOOD, 0.52, 0, 0, MAT.TIMBER);
      // Top eave beam collar extending +0.75m up into roof soffit so upturned eaves NEVER show sky gaps!
      K.box(hx, hy + sh + 0.18, hz, hw + 0.28, 0.95, hd + 0.28);
      // Mid-story horizontal timber stringcourse band wrapping all 4 faces
      K.box(hx, hy + 3.45, hz, hw + 0.24, 0.34, hd + 0.24);
      K.box(hx, hy + 2.25, hz, hw + 0.22, 0.22, hd + 0.22);
      // Vertical timber corner & bay posts on BOTH inner stairway face AND outer street face!
      for (const sideX of [-1, 1]) {
        const fx = hx + sideX * (hw / 2 + 0.08);
        for (const pz of [-hd * 0.48, -hd * 0.16, hd * 0.16, hd * 0.48]) {
          K.box(fx, hy + sh / 2, hz + pz, 0.28, sh, 0.28);
        }
        // Carved wooden dougong brackets (牛腿) under eaves on BOTH inner & outer faces!
        for (const pz of [-hd * 0.40, 0, hd * 0.40]) {
          K.dougongBracket(fx, hy + sh - 0.52, hz + pz, 0.78, { rotY: sideX > 0 ? Math.PI / 2 : -Math.PI / 2, woodRgb: C_WOOD });
        }
      }
      // Vertical timber posts + warm wooden lattice windows on BOTH ±Z gable ends (>=0.06m proud of wainscot/stringcourse, ZERO Z-fighting!)
      const winUpY = hy + 3.72 + (sh - 4.15) * 0.5;
      const winUpH = Math.max(1.8, sh - 4.55);
      for (const sideZ of [-1, 1]) {
        const fz = hz + sideZ * (hd / 2 + 0.08);
        const fzWin = hz + sideZ * (hd / 2 + 0.18);
        for (const px of [-hw * 0.34, 0, hw * 0.34]) {
          K.box(hx + px, hy + sh / 2, fz, 0.28, sh, 0.28);
        }
        K.style([0.92, 0.58, 0.22], 0.34, 0, -2.0, MAT.LATTICE_WIN, 0.30);
        K.box(hx, winUpY, fzWin, hw - 2.6, winUpH, 0.10);
        K.box(hx, hy + 2.82, fzWin, hw - 4.0, 0.90, 0.10);
        K.style(C_WOOD, 0.52, 0, 0, MAT.TIMBER);
      }
      const faceX = hx - sg * (hw / 2 + 0.18);
      const outerX = hx + sg * (hw / 2 + 0.18);
      // Stone entrance threshold step + potted Bayu doorway planters on inner stairway face
      K.style(C_GRANITE, 0.72, 0, 0, MAT.GRANITE, 0.8);
      K.box(faceX - sg * 0.45, hy + 0.18, hz, 0.9, 0.36, 3.6);
      K.style([0.36, 0.24, 0.16], 0.86, 0, 0, MAT.BRICK);
      K.box(faceX - sg * 0.55, hy + 0.45, hz + 2.5, 0.52, 0.52, 0.52);
      K.style([0.08, 0.24, 0.08], 0.86, 0, 0, MAT.FOLIAGE);
      K.sphere(faceX - sg * 0.55, hy + 0.95, hz + 2.5, 0.46, 7, 5);
      // Warm furnished Chongqing shopfront & teahouse interiors strictly proud of brick/timber trim (ZERO Z-fighting in hm_f10!)
      K.style([0.96, 0.62, 0.24], 0.34, 0, -2.4, MAT.LATTICE_WIN, 0.30);
      K.box(faceX, hy + 2.82, hz, 0.10, 0.92, hd - 2.4);
      K.box(faceX, winUpY, hz, 0.10, winUpH, hd - 2.6);
      K.box(outerX, hy + 2.82, hz, 0.10, 0.92, hd - 2.8);
      K.box(outerX, winUpY, hz, 0.10, winUpH, hd - 2.8);
      // Cantilevered upturned dark-grey Bayu tile roof seated cleanly over the timber attic collar!
      K.push().translate(hx, 0, hz);
      K.bayuRoof(hw + 0.8, hd + 0.8, hy + sh - 0.28, { rise: 3.0, eaveOut: 1.5, cornerLift: 0.95, tileRgb: C_TILE, woodRgb: C_WOOD, goldStrip: true, goldEmit: -4.8 });
      K.pop();
      // Carved stone pathway street lantern pedestal flanking the landing!
      const lx = sg * 4.6, lz = zb + 1.6;
      K.style(C_STONE, 0.82, 0, 0, MAT.STONE, 0.4);
      K.box(lx, yb + 0.85, lz, 0.48, 1.7, 0.48);
      K.style([1.0, 0.64, 0.18], 0.24, 0, -4.5, MAT.LANTERN);
      K.box(lx, yb + 1.95, lz, 0.38, 0.46, 0.38);
      K.style(C_TILE, 0.65, 0, 0, MAT.BAYU_TILE);
      K.box(lx, yb + 2.28, lz, 0.68, 0.18, 0.68);
    }

    // Arching red lantern string overhead across the stone stairway!
    K.lanternString([-7.5, yb + 4.8, (za + zb) / 2], [7.5, yb + 4.8, (za + zb) / 2], 5, 0.85, 0.32, 0.52);
  }

  // Traditional stone & timber entrance gate archway (十八梯牌坊) at bottom entrance (z = +53)
  K.push().translate(0, 0, 53);
  for (const px of [-5.2, 5.2]) {
    K.column(px, 0, 6.2, 0.38, { shaftRgb: C_STONE, baseRgb: C_GRANITE, capRgb: C_WOOD, dougong: true });
    K.dougongBracket(px, 5.7, 0.45, 0.95, { rotY: 0, woodRgb: C_WOOD });
  }
  K.style(C_WOOD, 0.52, 0, 0, MAT.TIMBER);
  K.box(0, 5.8, 0, 12.2, 0.9, 1.2);
  K.bayuRoof(12.8, 4.2, 6.3, { rise: 2.6, eaveOut: 1.4, cornerLift: 1.2, tileRgb: C_TILE, goldStrip: true, goldEmit: -5.4 });
  K.pop();

  const sub = new THREE.Group();
  sub.name = 'shibati';
  sub.position.set(cx, yBot, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);

  const plaque = makePlaque('十八梯', { w: 4.8, h: 1.7, bg: '#220c08', fg: '#f6c852', border: '#c48d2a', emissiveNight: 2.6 });
  plaque.position.set(0, 5.85, 53.68);
  sub.add(plaque);
  group.add(sub);

  // Solid Bayu shophouse walls on both sides down below downhill hillside grade, leaving the right-side cross-alley (flight i=4, z∈[-34.7,-17.3]) open!
  const sbtBase = yBot - 22, sbtTop = yBot + yRise + 22;
  prisms.push({ type: 'rect', ...xyObj(toWorld(cx, yBot, cz, rotY, -14.8, 0, 0)), ang: rotY, hx: 7.8, hz: 52, base: sbtBase, top: sbtTop });
  prisms.push({ type: 'rect', ...xyObj(toWorld(cx, yBot, cz, rotY, 14.8, 0, 17.33)), ang: rotY, hx: 7.8, hz: 34.67, base: sbtBase, top: sbtTop });
  prisms.push({ type: 'rect', ...xyObj(toWorld(cx, yBot, cz, rotY, 14.8, 0, -43.33)), ang: rotY, hx: 7.8, hz: 8.67, base: sbtBase, top: sbtTop });
  for (let k = 0; k < 4; k++) {
    const t = k / 3;
    const [lx, ly, lz] = toWorld(cx, yBot, cz, rotY, 0, t * yRise + 6, z0 + t * (z1 - z0));
    lights.push({ x: lx, y: ly, z: lz, radius: 42, r: 1.0, g: 0.62, b: 0.22, intensity: 1900, omni: 1 });
  }
  labels.push({ name: '十八梯传统风貌区', x: cx, y: yBot + yRise + 18, z: cz });
}

// ===================================================================================================
// 7. 南山一棵树观景台 (Nanshan Yikeshu Panoramic Viewing Pavilion + Lone Giant Huangjue Tree!)
// ===================================================================================================
function addNanshanPavilion(group, P, terrain, materials, prisms, plazas, lights, labels) {
  const cx = P.x, cz = P.z, rotY = P.angle ?? FALLBACKS.nanshan_pavilion.angle;
  // Sample 8-point ring at r = 25m so Nanshan mountain ridge NEVER clips through the 1F-2F observation glass galleries!
  const ringHs = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    ringHs.push(terrain.sample(cx + Math.cos(a) * 25, cz + Math.sin(a) * 25));
  }
  const maxDEM = Math.max(...ringHs), minDEM = Math.min(...ringHs);
  const y0 = Math.max(Number.isFinite(P.baseY) ? P.baseY : terrain.sample(cx, cz), maxDEM + 0.3);
  const skirtDrop = Math.max(34, y0 - minDEM + 10);

  const K = new HeroKit();
  const C_STONE   = [0.40, 0.39, 0.35];
  const C_GRANITE = [0.56, 0.54, 0.50];
  const C_CONC    = [0.78, 0.77, 0.74];
  const C_GLASS   = [0.10, 0.18, 0.24];
  const C_STEEL   = [0.76, 0.80, 0.84];
  const C_GOLD    = [1.00, 0.80, 0.36];

  // Deep mountain-ridge stone retaining terrace descending solidly below ridge slopes (ZERO floating, ZERO hill poke!)
  K.style(C_STONE, 0.86, 0, 0, MAT.STONE, 0.68);
  K.lathe([[30, -skirtDrop], [24.2, 0], [0, 0]], 28);
  K.style(C_GRANITE, 0.66, 0, 0, MAT.GRANITE, 1.4);
  K.lathe([[24.2, 0], [24.2, 0.8], [0, 0.8]], 28);

  // Sculpted 5-Story Curved Cantilevered Panoramic Viewing Tower (24m high!)
  const levels = [
    { y: 0.8,  h: 4.5, r: 14.5 },
    { y: 5.3,  h: 4.5, r: 15.8 },
    { y: 9.8,  h: 4.5, r: 17.2 },
    { y: 14.3, h: 4.5, r: 18.8 },
    { y: 18.8, h: 4.6, r: 20.5 }, // Top panoramic cantilevered circular observation deck!
  ];
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    // Curved recessed panoramic glass gallery
    K.style(C_GLASS, 0.09, 0.16, 0, MAT.GLASS, 2.4, 0.95);
    K.lathe([[lv.r - 1.8, lv.y], [lv.r - 1.8, lv.y + lv.h - 0.6]], 32);
    // Sweeping cantilevered white-concrete circular balcony slab
    K.style(C_CONC, 0.48, 0.08, 0, MAT.CONCRETE, 2.6);
    K.lathe([[lv.r - 2.2, lv.y + lv.h - 0.75], [lv.r, lv.y + lv.h - 0.55], [lv.r, lv.y + lv.h], [0, lv.y + lv.h]], 32);
    // Glowing golden-white rim accent ribbon
    K.style(C_GOLD, 0.22, 0, -4.8, MAT.LANTERN);
    K.lathe([[lv.r + 0.08, lv.y + lv.h - 0.48], [lv.r + 0.08, lv.y + lv.h - 0.18]], 32);
    // Exterior steel columns & balcony safety railing
    K.style(C_STEEL, 0.28, 0.84, 0, MAT.METAL);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      K.tube([Math.cos(a) * (lv.r - 0.6), lv.y, Math.sin(a) * (lv.r - 0.6)], [Math.cos(a) * (lv.r - 0.6), lv.y + lv.h + 1.1, Math.sin(a) * (lv.r - 0.6)], 0.16, 0.14, 6, true);
    }
    K.lathe([[lv.r - 0.45, lv.y + lv.h + 1.05], [lv.r - 0.25, lv.y + lv.h + 1.05], [lv.r - 0.25, lv.y + lv.h + 1.18], [lv.r - 0.45, lv.y + lv.h + 1.18]], 32);
  }

  // Sweeping Sculpted Curved Cantilevered Observation Canopy Roof (y = 28m)
  const topY = 23.4;
  K.style(C_STEEL, 0.26, 0.85, 0, MAT.METAL);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    K.tube([Math.cos(a) * 14, topY, Math.sin(a) * 14], [Math.cos(a) * 17.5, topY + 5.2, Math.sin(a) * 17.5], 0.30, 0.22, 6, true);
  }
  K.style(C_CONC, 0.40, 0.18, 0, MAT.CONCRETE, 2.8);
  K.lathe([[22.2, topY + 4.8], [22.6, topY + 5.4], [15.0, topY + 6.8], [6.0, topY + 7.6], [0, topY + 7.8]], 32);
  K.style(C_GOLD, 0.20, 0, -5.8, MAT.LANTERN);
  K.lathe([[22.65, topY + 5.0], [22.65, topY + 5.42]], 32);

  // ICONIC LONE GIANT HUANGJUE TREE ("一棵树" / Ficus virens!) right beside the viewing pavilion!
  const tx = 20.5, tz = -8.5;
  K.style([0.24, 0.17, 0.11], 0.88, 0, 0, MAT.TIMBER);
  K.tube([tx, 0.6, tz], [tx, 6.2, tz], 1.15, 0.72, 10, false);
  // Spreading gnarled Huangjue branches + wide multi-lobed lush emerald canopy!
  const branches = [
    [tx - 4.2, 10.2, tz + 2.8, 5.2],
    [tx + 4.5, 10.6, tz + 1.5, 5.0],
    [tx - 1.5, 11.4, tz - 4.4, 4.8],
    [tx + 2.2, 12.2, tz - 1.8, 5.6],
    [tx,       13.4, tz + 0.4, 5.8],
  ];
  for (const [bx, by, bz, r] of branches) {
    K.style([0.24, 0.17, 0.11], 0.88, 0, 0, MAT.TIMBER);
    K.tube([tx, 5.6, tz], [bx, by - 1.2, bz], 0.42, 0.18, 6, false);
    K.style([0.11, 0.30, 0.11], 0.84, 0, 0, MAT.FOLIAGE);
    K.sphere(bx, by, bz, r, 10, 7);
  }

  const sub = new THREE.Group();
  sub.name = 'nanshan-yikeshu';
  sub.position.set(cx, y0, cz);
  sub.rotation.y = rotY;
  const m = new THREE.Mesh(K.geometry(), materials.heroMat);
  m.matrixAutoUpdate = false; m.updateMatrix();
  sub.add(m);
  group.add(sub);

  const nsBase = Math.min(y0 - skirtDrop, minDEM - 18);
  prisms.push({ type: 'circle', x: cx, z: cz, r: 21.8, base: nsBase, top: y0 - 0.05, sides: 16 });
  prisms.push({ type: 'circle', x: cx, z: cz, r: 16.5, base: nsBase, top: y0 + 23, sides: 14 });
  plazas.push({ type: 'circlePlaza', x: cx, z: cz, r: 20.5, base: y0 + 21, top: y0 + topY + 0.05, sides: 16 });
  lights.push({ x: cx, y: y0 + topY + 4.5, z: cz, radius: 68, r: 1.0, g: 0.82, b: 0.44, intensity: 3200, omni: 1 });
  labels.push({ name: '南山一棵树观景台', x: cx, y: y0 + 38, z: cz });
}

export function buildCivic(ctx) {
  const { data, terrain, materials, makePlaque } = ctx;
  const group = new THREE.Group();
  group.name = 'chongqing-civic-cluster';
  const prisms = [], plazas = [], decks = [], lights = [], labels = [];

  const pick = (snake, camel, fb) => ({ ...fb, ...(data[snake] || data[camel] || {}) });

  addGrandTheatre(group, pick('grand_theatre', 'grandTheatre', FALLBACKS.grand_theatre), terrain, materials, makePlaque, prisms, plazas, lights, labels);
  addGreatHall(group, pick('great_hall', 'greatHall', FALLBACKS.great_hall), terrain, materials, makePlaque, prisms, plazas, lights, labels);
  addScienceMuseum(group, pick('science_museum', 'scienceMuseum', FALLBACKS.science_museum), terrain, materials, prisms, lights, labels);
  addKuixinglou(group, pick('kuixinglou', 'kuixinglou', FALLBACKS.kuixinglou), terrain, materials, prisms, plazas, decks, lights, labels);
  addBaixiangju(group, pick('baixiangju', 'baixiangju', FALLBACKS.baixiangju), terrain, materials, prisms, lights, labels);
  addShibati(group, pick('shibati', 'shibati', FALLBACKS.shibati), terrain, materials, makePlaque, prisms, decks, lights, labels);
  addNanshanPavilion(group, pick('nanshan_pavilion', 'nanshan', FALLBACKS.nanshan_pavilion), terrain, materials, prisms, plazas, lights, labels);

  return {
    group,
    colliders: { prisms, plazas, decks },
    lights,
    labels,
  };
}
