// 重庆来福士广场 & 朝天门广场 (Raffles City Chongqing & Chaotianmen Confluence Plaza)
// Moshe Safdie's "Sailing Forward / 朝天扬帆" megastructure at the exact prow of Yuzhong Peninsula!
//
// Features:
//  - 8 sculpted curved aerodynamic sail-shaped supertall towers:
//      * Front arc (4 towers, ~250m tall) carrying The Crystal horizontal skybridge
//      * Rear arc: 2 central twin supertalls (~354.5m tall) + 2 outer sail towers (~255m tall)
//      * True 22-station curved lenticular sail lofts, 3D projecting vertical silver-aluminum sail fins,
//        double-height dark mechanical louver zones, slanted glazed crowns & curved vertical LED light ribbons
//  - The Crystal (水晶连廊, 300m long curved elliptical skybridge at ~250m height):
//      * True 3D exterior steel diagrid exoskeleton + structural ring ribs + glazed conservatory shell
//      * Visible lush interior sky-garden promenade with subtropical trees & warm golden lounge glow
//      * Cantilevered glass-bottom exploration deck jutting out toward the Yangtze–Jialing confluence
//      * Two elevated glazed skybridge connectors linking The Crystal to the 354.5m twin towers
//  - 5-story curved sculpted podium mall + lush terraced rooftop park (walkable!)
//  - Monumental triangular Chaotianmen stepped granite waterfront plaza descending cleanly into confluence!

import * as THREE from 'three';
import { HeroKit, MAT } from './kit.js';

const TAU = Math.PI * 2;
const FALLBACK = { x: 1120, z: -435, baseY: 36, angle: -0.35, w: 320, d: 220, h: 354.5 };

function toWorld(cx, cy, cz, rotY, lx, ly, lz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
}
function xyObj([wx, , wz]) { return { x: wx, z: wz }; }

// Palette (linear RGB — sleek dark blue-steel reflective glass & crisp silver fins!)
const C_GLASS_SAIL = [0.055, 0.105, 0.165];
const C_GLASS_CRY  = [0.065, 0.135, 0.195];
const C_SILVER     = [0.80, 0.84, 0.89];
const C_STEEL_DK   = [0.18, 0.21, 0.25];
const C_LOUVER     = [0.10, 0.13, 0.17];
const C_PODIUM     = [0.58, 0.56, 0.52];
const C_GRANITE    = [0.48, 0.46, 0.43];
const C_STONE_DK   = [0.28, 0.27, 0.25];
const C_FOLIAGE    = [0.10, 0.26, 0.10];
const C_FOLIAGE_LT = [0.15, 0.34, 0.12];
const C_LED_GOLD   = [1.00, 0.78, 0.36];
const C_LED_CYAN   = [0.64, 0.88, 1.00];

/** Evaluate a single curved sail tower's sharp aerodynamic nautical-blade cross-section at t in [0,1].
 *  Sharper lenticular blade edges + crisp diagonal crown slice (NEVER pill-rounded tops!). */
function sailRingAt(t, { H, halfW, halfD, bow, leanZ, slantY, slantX = 0, nSides = 20 }) {
  // Dramatic forward wind-filled spinnaker curve toward +Z river confluence
  const billow = bow * Math.sin(t * Math.PI * 0.88) + leanZ * t * t;
  const taperX = 1.0 - 0.14 * Math.pow(t, 1.6);
  const taperZ = 1.0 - 0.32 * Math.pow(t, 1.25); // slims sharply toward the crown like a sleek nautical blade!
  const rx = halfW * taperX;
  const rz = halfD * taperZ;
  const baseY = t * H;
  const ring = [];
  for (let k = 0; k < nSides; k++) {
    const a = (k / nSides) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Crisp lenticular sail blade (sharpened leading prow + crisp tapered edges instead of fat pill cylinders!)
    const lx = Math.sign(ca) * Math.pow(Math.abs(ca), 0.86) * rx;
    const lz = (sa > 0 ? sa * 1.18 : sa * 0.86) * rz * (1.0 - 0.22 * ca * ca) + billow;
    // Dramatic diagonal chiseled sail crown (slants sharply across BOTH X and Z so head-on AND side views read as crisp slanted sails!)
    const crownRamp = Math.pow(t, 2.4);
    const crownTilt = (slantY * (sa * 0.5 + 0.5) + slantX * (ca * 0.5 + 0.5)) * crownRamp;
    ring.push([lx, baseY + crownTilt, lz]);
  }
  return ring;
}

/** Build one ultra-detailed sculpted curved sail tower with:
 *  - Smooth 22-station sharp-edged nautical sail glass loft
 *  - 16 real 3D projecting external curved silver-aluminum vertical sail fins
 *  - Recessed dark mechanical louver floor bands
 *  - Continuous crisp vertical warm-gold & silver architectural LED ribbons along the curved sail spines
 *  - Sharp slanted metallic crown parapet & red aviation beacon */
function addSailTower(K, {
  cx, cz, y0, H, halfW, halfD, bow = 16, leanZ = 6, slantY = 14, slantX = 0, rotY = 0, ledRgb = C_LED_GOLD,
}) {
  // Phase 3 Photorealism: silky 26-station x 28-segment curved sails, 22 dense brushed-silver aerodynamic fins,
  // horizontal aluminum floor spandrel rings, and furnished office interiors via tInteriorsArr!
  const N_ST = 26;
  const N_SIDES = 28;
  K.push().translate(cx, y0, cz).rotateY(rotY);

  const rings = [];
  for (let s = 0; s <= N_ST; s++) {
    rings.push(sailRingAt(s / N_ST, { H, halfW, halfD, bow, leanZ, slantY, slantX, nSides: N_SIDES }));
  }
  K.style(C_GLASS_SAIL, 0.07, 0.22, 0, MAT.GLASS, 2.8, 0.96);
  K.loft(rings, { caps: true, smooth: true, uvScale: 1 });

  // Dark recessed mechanical louver refuge bands (3-ring curved loft with >=0.68m clearance proud of curved glass sail — ZERO Z-fighting!)
  K.style(C_LOUVER, 0.55, 0.45, 0, MAT.LOUVER, 0.24);
  const louverFracs = H > 300 ? [0.22, 0.44, 0.66, 0.88] : [0.28, 0.58, 0.88];
  for (const tf of louverFracs) {
    const rA = sailRingAt(tf - 0.014, { H, halfW: halfW + 0.68, halfD: halfD + 0.68, bow, leanZ, slantY, slantX, nSides: N_SIDES });
    const rM = sailRingAt(tf,         { H, halfW: halfW + 0.68, halfD: halfD + 0.68, bow, leanZ, slantY, slantX, nSides: N_SIDES });
    const rB = sailRingAt(tf + 0.014, { H, halfW: halfW + 0.68, halfD: halfD + 0.68, bow, leanZ, slantY, slantX, nSides: N_SIDES });
    K.loft([rA, rM, rB], { caps: true, smooth: true, uvScale: 1 });
  }

  // Dense 3D projecting curved vertical brushed-silver aerodynamic sail fins (22 fins per tower!)
  K.style(C_SILVER, 0.22, 0.90, 0, MAT.METAL, 2.4, 0.84);
  const finIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 21, 23, 25, 27];
  const prowIdx = 7; // +Z prow on 28-side ring (7/28 * TAU = PI/2)
  for (const idx of finIndices) {
    const pts = [], U = [], V = [];
    const a = (idx / N_SIDES) * TAU;
    const outX = Math.cos(a), outZ = Math.sin(a);
    const tanX = -outZ, tanZ = outX;
    const isSpine = idx === prowIdx || idx === 0 || idx === 14;
    const finDepth = isSpine ? 1.95 : 0.95;
    const finThick = isSpine ? 0.38 : 0.19;
    for (let s = 0; s <= N_ST; s++) {
      const p = rings[s][idx];
      pts.push([p[0] + outX * finDepth * 0.45, p[1], p[2] + outZ * finDepth * 0.45]);
      U.push([outX * finDepth * 0.55, 0, outZ * finDepth * 0.55]);
      V.push([tanX * finThick, 0, tanZ * finThick]);
    }
    K.sweep(pts, U, V, true);
  }

  // Horizontal brushed-silver spandrel accent rings wrapping the curved sails every 4 stations!
  K.style(C_SILVER, 0.26, 0.86, 0, MAT.METAL, 2.0);
  for (let s = 3; s < N_ST; s += 4) {
    const r = rings[s];
    for (let k = 0; k < N_SIDES; k++) {
      K.tube(r[k], r[(k + 1) % N_SIDES], 0.24, 0.24, 4, false);
    }
  }

  // Crisp slanted crown parapet rim + sharp vertical silver crest blades
  const topRing = rings[N_ST];
  K.style(C_SILVER, 0.22, 0.90, 0, MAT.METAL, 2.0);
  for (let k = 0; k < N_SIDES; k++) {
    K.tube(topRing[k], topRing[(k + 1) % N_SIDES], 0.65, 0.65, 6, false);
  }
  // Sleek continuous glowing vertical architectural LED ribbons tracing the curved sail ribs & sharp crown!
  K.style(ledRgb, 0.20, 0, -5.8, MAT.LANTERN);
  for (const idx of [0, 4, prowIdx, 10, 14, 21]) {
    const a = (idx / N_SIDES) * TAU;
    const isMain = idx === prowIdx || idx === 0 || idx === 14;
    const ox = Math.cos(a) * (isMain ? 1.75 : 0.98);
    const oz = Math.sin(a) * (isMain ? 1.75 : 0.98);
    for (let s = 1; s < N_ST; s++) {
      const a0 = rings[s][idx], a1 = rings[s + 1][idx];
      K.tube([a0[0] + ox, a0[1], a0[2] + oz], [a1[0] + ox, a1[1], a1[2] + oz], isMain ? 0.30 : 0.18, isMain ? 0.30 : 0.18, 4, false);
    }
  }
  K.style(C_LED_GOLD, 0.18, 0, -6.2, MAT.LANTERN);
  for (let k = 0; k < N_SIDES; k++) {
    const p0 = topRing[k], p1 = topRing[(k + 1) % N_SIDES];
    K.tube([p0[0], p0[1] + 0.65, p0[2]], [p1[0], p1[1] + 0.65, p1[2]], 0.26, 0.26, 4, false);
  }
  let bestTop = topRing[0];
  for (const pt of topRing) if (pt[1] > bestTop[1]) bestTop = pt;
  K.style([1.0, 0.12, 0.05], 0.25, 0, -9.0, MAT.PLAIN);
  K.sphere(bestTop[0], bestTop[1] + 2.4, bestTop[2], 0.65, 8, 6);
  K.style(C_SILVER, 0.3, 0.85, 0, MAT.METAL);
  K.tube([bestTop[0], bestTop[1], bestTop[2]], [bestTop[0], bestTop[1] + 2.2, bestTop[2]], 0.14, 0.08, 6, false);

  K.pop();
}

/** Build THE CRYSTAL (水晶连廊) — iconic 300m curved horizontal elliptical skybridge atop the 4 front towers,
 *  complete with true 3D exterior steel diagrid exoskeleton, visible interior green sky-garden trees,
 *  and cantilevered glass-bottom exploration deck jutting toward Chaotianmen! */
function addTheCrystal(K, { yCrystal, arcZ, spanHalf = 148, rx = 16.5, ry = 13.5, frontTowerXs }) {
  const N_LONG = 32;
  const N_AROUND = 18;

  // Spine curves gracefully forward along the 4 front towers (+Z bow)
  const spineAt = (u) => {
    // u in [-1, 1]
    const x = u * spanHalf;
    const z = arcZ(x);
    // Subtle slight vertical arch across the 300m skybridge
    const y = yCrystal + 1.8 * (1 - u * u);
    return [x, y, z];
  };
  const tangentAt = (u) => {
    const a = spineAt(u - 0.01), b = spineAt(u + 0.01);
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return [dx / l, dy / l, dz / l];
  };

  // Precompute elliptical cross-section stations (tapered sleekly at both cantilevered tips!)
  const glassRings = [];
  const diagridRings = [];
  for (let i = 0; i <= N_LONG; i++) {
    const u = -1 + 2 * (i / N_LONG);
    const [sx, sy, sz] = spineAt(u);
    const [tx, ty, tz] = tangentAt(u);
    // Lateral outward normal in XZ plane (pointing toward +Z riverfront)
    const lx = -tz, lz = tx;
    // Slight sculptural nose taper at cantilevered outer tips
    const endTaper = 1.0 - 0.16 * Math.pow(Math.max(0, Math.abs(u) - 0.80) / 0.20, 1.5);
    const rHoriz = rx * endTaper;
    const rVert = ry * endTaper;
    const gRing = [], dRing = [];
    for (let k = 0; k < N_AROUND; k++) {
      const a = (k / N_AROUND) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      // Glazed inner elliptical hull
      gRing.push([
        sx + lx * ca * rHoriz,
        sy + sa * rVert,
        sz + lz * ca * rHoriz,
      ]);
      // Slightly proud 3D steel diagrid exoskeleton outside glass
      dRing.push([
        sx + lx * ca * (rHoriz + 0.55),
        sy + sa * (rVert + 0.55),
        sz + lz * ca * (rHoriz + 0.55),
      ]);
    }
    glassRings.push(gRing);
    diagridRings.push(dRing);
  }

  // 1. Curved elliptical Crystal hull: lower/side reflective conservatory shell recessed inside the 3D steel diagrid,
  //    with a sculpted recessed open sky-garden promenade along the upper crown so the lush subtropical trees and
  //    warm golden sky-lounge galleries are genuinely visible right through the soaring 3D steel diagrid arches!
  const lowerGlassRings = [];
  for (let i = 0; i <= N_LONG; i++) {
    const u = -1 + 2 * (i / N_LONG);
    const [sx, sy, sz] = spineAt(u);
    const [tx, , tz] = tangentAt(u);
    const lx = -tz, lz = tx;
    const endTaper = 1.0 - 0.16 * Math.pow(Math.max(0, Math.abs(u) - 0.80) / 0.20, 1.5);
    const rH = rx * endTaper * 0.94, rV = ry * endTaper * 0.92;
    const r = [];
    for (let k = 0; k < N_AROUND; k++) {
      const a = (k / N_AROUND) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      // Indent the upper crown arc (sa > 0.35) down into an open landscaped conservatory deck basin!
      const yOff = sa > 0.35 ? rV * 0.18 : sa * rV;
      r.push([sx + lx * ca * rH, sy + yOff, sz + lz * ca * rH]);
    }
    lowerGlassRings.push(r);
  }
  K.style(C_GLASS_CRY, 0.09, 0.15, 0, MAT.GLASS, 3.2, 0.96);
  K.loft(lowerGlassRings, { caps: true, smooth: true, uvScale: 1 });

  // 2. Luminous warm golden conservatory promenade deck & curved balcony ribbon visible through the diagrid!
  K.style([1.0, 0.82, 0.48], 0.32, 0, -3.4, MAT.LANTERN);
  for (let i = 0; i < N_LONG; i++) {
    const u0 = -0.95 + 1.90 * (i / N_LONG), u1 = -0.95 + 1.90 * ((i + 1) / N_LONG);
    const p0 = spineAt(u0), p1 = spineAt(u1);
    K.sweep([
      [p0[0], p0[1] + ry * 0.16, p0[2]],
      [p1[0], p1[1] + ry * 0.16, p1[2]],
    ], [[0, 0, rx * 0.68], [0, 0, rx * 0.68]], [[0, 0.45, 0], [0, 0.45, 0]], true);
  }

  // 3. Visible lush green subtropical sky-garden trees & lawn beds flourishing under the curved 3D steel diagrid roof!
  for (let i = 2; i <= N_LONG - 2; i++) {
    const u = -1 + 2 * (i / N_LONG);
    const [sx, sy, sz] = spineAt(u);
    const [tx, , tz] = tangentAt(u);
    const lx = -tz, lz = tx;
    const deckY = sy + ry * 0.22;
    const side = (i % 2 === 0 ? 1 : -1) * 4.2;
    K.style([0.24, 0.16, 0.10], 0.85, 0, 0, MAT.TIMBER);
    K.tube([sx + lx * side, deckY, sz + lz * side], [sx + lx * side, deckY + 4.2, sz + lz * side], 0.35, 0.20, 5, false);
    K.style(i % 3 === 0 ? C_FOLIAGE_LT : C_FOLIAGE, 0.82, 0, 0, MAT.FOLIAGE);
    K.sphere(sx + lx * side, deckY + 5.8, sz + lz * side, 3.6 + (i % 3) * 0.55, 8, 6);
    if (i % 2 === 0) {
      K.sphere(sx - lx * side * 0.8, deckY + 4.8, sz - lz * side * 0.8, 2.9, 7, 5);
    }
  }

  // 4. TRUE 3D EXTERIOR STEEL DIAGRID EXOSKELETON WITH CAST-STEEL HUB NODES!
  K.style(C_SILVER, 0.24, 0.90, 0, MAT.METAL, 1.8, 0.82);
  for (let i = 0; i < N_LONG; i++) {
    const r0 = diagridRings[i], r1 = diagridRings[i + 1];
    for (let k = 0; k < N_AROUND; k++) {
      const kNext = (k + 1) % N_AROUND;
      const kPrev = (k + N_AROUND - 1) % N_AROUND;
      K.tube(r0[k], r1[kNext], 0.36, 0.36, 5, false);
      K.tube(r0[k], r1[kPrev], 0.36, 0.36, 5, false);
      if (i > 0 && i % 2 === 0) {
        K.tube(r0[k], r0[kNext], 0.40, 0.40, 5, false);
        // Sculpted cast-steel diagrid junction hub node every 2 rings!
        if (k % 2 === 0) K.sphere(r0[k][0], r0[k][1], r0[k][2], 0.56, 6, 4);
      }
    }
  }
  // End-cap glowing oval bezel rings at both cantilevered Crystal ends!
  K.style(C_LED_GOLD, 0.22, 0, -6.2, MAT.LANTERN);
  for (const endIdx of [0, N_LONG]) {
    const ring = diagridRings[endIdx];
    for (let k = 0; k < N_AROUND; k++) {
      K.tube(ring[k], ring[(k + 1) % N_AROUND], 0.42, 0.42, 5, false);
    }
  }
  // Longitudinal glowing LED architectural spine ribbons along top & bottom belly of The Crystal
  K.style(C_LED_GOLD, 0.22, 0, -5.6, MAT.LANTERN);
  for (let i = 0; i < N_LONG; i++) {
    for (const kIdx of [0, 4, 9, 13]) { // front, top, back, bottom
      K.tube(diagridRings[i][kIdx], diagridRings[i + 1][kIdx], 0.28, 0.28, 4, false);
    }
  }

  // 5. Heavy steel seismic-isolation transfer pedestals seating The Crystal solidly on the 4 front towers
  K.style(C_STEEL_DK, 0.38, 0.82, 0, MAT.PLAIN);
  for (const tx of frontTowerXs) {
    const tz = arcZ(tx);
    K.box(tx, yCrystal - ry - 2.5, tz, 16, 7, 16);
  }

  // 6. Iconic Cantilevered Glass-Bottom Exploration Deck jutting out from the tip over Chaotianmen!
  const [ex, ey, ez] = spineAt(1.0);
  K.push().translate(ex + 9, ey - 3.5, ez + 2).rotateY(-0.18);
  K.style(C_SILVER, 0.24, 0.88, 0, MAT.PLAIN);
  K.box(0, 0, 0, 18, 1.2, 12);
  K.style(C_GLASS_CRY, 0.08, 0.12, 0, MAT.GLASS, 2.0, 0.95);
  K.box(0, 2.6, 0, 17.6, 4.0, 11.6);
  K.style(C_LED_CYAN, 0.20, 0, -5.8, MAT.LANTERN);
  K.tube([-9, -0.5, 6.1], [9, -0.5, 6.1], 0.25, 0.25, 4, false);
  K.tube([-9, -0.5, -6.1], [9, -0.5, -6.1], 0.25, 0.25, 4, false);
  K.tube([9, -0.5, -6.1], [9, -0.5, 6.1], 0.25, 0.25, 4, false);
  K.pop();
}

export function buildRaffles(ctx) {
  const { data, terrain, materials } = ctx;
  const P = { ...FALLBACK, ...(data.raffles || {}) };
  const cx = P.x, cz = P.z;

  // Aim local +Z (billowing sail fronts & Chaotianmen stepped waterfront prow) EXACTLY toward Chaotianmen tip!
  let rotY;
  if (Number.isFinite(P.tipX) && Number.isFinite(P.tipZ)) {
    rotY = Math.atan2(P.tipX - cx, P.tipZ - cz);
  } else {
    rotY = P.angle ?? FALLBACK.angle;
    const pPlus = toWorld(cx, 0, cz, rotY, 0, 0, 120);
    const pMinus = toWorld(cx, 0, cz, rotY, 0, 0, -120);
    if (terrain.sample(pPlus[0], pPlus[2]) > terrain.sample(pMinus[0], pMinus[2]) + 3) rotY += Math.PI;
  }

  const baseSample = terrain.sample(cx, cz);
  const yBase = Number.isFinite(P.baseY) ? P.baseY : Math.max(20, baseSample);
  const podiumH = P.podiumH || 28;
  const baseDrop = Math.max(52, yBase + 16); // Extends deeply below river surface 0.0m (ZERO floating!)

  const K = new HeroKit();

  // =================================================================================================
  // 1. SCULPTED 5-STORY CURVED PODIUM MALL + DEEP BEDROCK SKIRT + GREEN ROOFTOP PARK
  // =================================================================================================
  const podiumPts = [
    [-138, -76], [138, -76], [148, -12], [132, 34], [88, 66], [34, 84], [-34, 84], [-88, 66], [-132, 34], [-148, -12],
  ];
  K.style(C_STONE_DK, 0.86, 0, 0, MAT.STONE, 0.72);
  K.prism(podiumPts, -baseDrop, 0.0);

  for (let tier = 0; tier < 5; tier++) {
    const y0 = tier * (podiumH / 5), y1 = (tier + 1) * (podiumH / 5);
    const shrink = tier * 2.2;
    const pts = podiumPts.map(([px, pz]) => [px * (1 - shrink / 190), pz * (1 - shrink / 160)]);
    K.style(C_GLASS_SAIL, 0.14, 0.18, 0, MAT.GLASS, 3.0, 0.92);
    K.prism(pts, y0, y1 - 0.9, { capTop: false, capBottom: false });
    const slabPts = pts.map(([px, pz]) => [px * 1.015, pz * 1.015]);
    K.style(C_PODIUM, 0.42, 0.18, 0, MAT.PLAIN);
    K.prism(slabPts, y1 - 0.9, y1, { capTop: tier === 4, capBottom: true });
    if (tier === 0 || tier === 4) {
      K.style(C_LED_GOLD, 0.25, 0, -3.5, MAT.LANTERN);
      for (let k = 0; k < slabPts.length; k++) {
        const a = slabPts[k], b = slabPts[(k + 1) % slabPts.length];
        K.tube([a[0], y1 - 0.1, a[1]], [b[0], y1 - 0.1, b[1]], 0.16, 0.16, 4, false);
      }
    }
  }

  // Lush Green Terraced Rooftop Park atop the 5-story podium!
  K.style(C_GRANITE, 0.68, 0, 0, MAT.GRANITE, 1.8);
  const parkPts = podiumPts.map(([px, pz]) => [px * 0.90, pz * 0.90]);
  K.prism(parkPts, podiumH, podiumH + 0.4);
  const parkClusters = [
    [-82, 42], [-42, 60], [0, 68], [42, 60], [82, 42],
    [-98, -22], [-58, -10], [0, 12], [58, -10], [98, -22],
    [-66, -54], [0, -58], [66, -54],
  ];
  for (let i = 0; i < parkClusters.length; i++) {
    const [gx, gz] = parkClusters[i];
    K.style(C_FOLIAGE, 0.85, 0, 0, MAT.FOLIAGE);
    K.lathe([[9.5, podiumH + 0.4], [8.6, podiumH + 1.3], [0, podiumH + 1.5]], 12, gx, gz);
    for (const [dx, dz, r] of [[-2.8, -1.5, 3.2], [2.4, 1.2, 3.6], [0, 2.8, 2.7]]) {
      K.style([0.24, 0.16, 0.10], 0.85, 0, 0, MAT.TIMBER);
      K.tube([gx + dx, podiumH + 1.0, gz + dz], [gx + dx, podiumH + 4.4, gz + dz], 0.34, 0.22, 6, false);
      K.style(i % 2 === 0 ? C_FOLIAGE_LT : C_FOLIAGE, 0.82, 0, 0, MAT.FOLIAGE);
      K.sphere(gx + dx, podiumH + 5.6, gz + dz, r, 8, 6);
    }
  }

  // =================================================================================================
  // 2. MONUMENTAL TRIANGULAR CHAOTIANMEN STEPPED WATERFRONT PLAZA (朝天门广场)
  //    Descends cleanly to the Yangtze–Jialing confluence prow, with an open waterfront boulevard corridor
  //    at z ∈ [125, 170] spanned by a sculpted granite pedestrian skybridge (>= 6.5m clear over Chaotianmen Loop Rd!)
  // =================================================================================================
  const tipDist = Number.isFinite(P.tipX) ? Math.min(315, Math.max(190, Math.hypot(P.tipX - cx, P.tipZ - cz) - 22)) : 220;
  const prowTiers = [
    { z0: 78,  z1: 125, w0: 84, w1: 66, yTop: 6.0 },
    { z0: 170, z1: 238, w0: 52, w1: 36, yTop: -11.0 },
    { z0: 236, z1: Math.max(276, tipDist - 32), w0: 36, w1: 20, yTop: -23.0 },
    { z0: Math.max(274, tipDist - 34), z1: tipDist, w0: 20, w1: 6, yTop: -yBase + 4.5 },
  ];
  for (const pt of prowTiers) {
    // Clamp terrace cleanly above real DEM along its centerline so terrain never pokes through!
    const wMid = toWorld(cx, 0, cz, rotY, 0, 0, (pt.z0 + pt.z1) / 2);
    const demMid = terrain.sample(wMid[0], wMid[2]);
    pt.yTop = Math.max(pt.yTop, demMid - yBase + 1.4);
    const triPts = [[-pt.w0, pt.z0], [pt.w0, pt.z0], [pt.w1, pt.z1], [-pt.w1, pt.z1]];
    K.style(C_STONE_DK, 0.86, 0, 0, MAT.STONE, 0.65);
    K.prism(triPts, -baseDrop, pt.yTop - 0.5, { capTop: false, capBottom: false });
    K.style(C_GRANITE, 0.68, 0, 0, MAT.GRANITE, 1.5);
    K.prism(triPts, pt.yTop - 0.5, pt.yTop, { capTop: true, capBottom: false });
    K.balustrade([-pt.w0 + 1, pt.yTop, pt.z0], [-pt.w1 + 1, pt.yTop, pt.z1], 1.15, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.8, goldCap: true });
    K.balustrade([pt.w0 - 1, pt.yTop, pt.z0], [pt.w1 - 1, pt.yTop, pt.z1], 1.15, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.8, goldCap: true });
    // Sculpted stone planter beds with ornamental foliage & warm plaza bollards on each Chaotianmen terrace!
    const zMid = (pt.z0 + pt.z1) * 0.5;
    const planterX = (pt.w0 + pt.w1) * 0.36;
    if (planterX > 12) {
      for (const sg of [-1, 1]) {
        K.style(C_GRANITE, 0.64, 0, 0, MAT.GRANITE, 0.9);
        K.box(sg * planterX, pt.yTop + 0.45, zMid, 6.8, 0.9, 14.0);
        K.style(C_FOLIAGE_LT, 0.82, 0, 0, MAT.FOLIAGE);
        K.box(sg * planterX, pt.yTop + 1.05, zMid, 5.6, 0.6, 12.6);
        K.sphere(sg * planterX, pt.yTop + 2.2, zMid - 3.2, 1.9, 7, 5);
        K.sphere(sg * planterX, pt.yTop + 2.1, zMid + 3.2, 1.7, 7, 5);
      }
    }
  }
  // Sculpted Chaotianmen Pedestrian Overpass Bridge spanning cleanly ABOVE the waterfront boulevard (z = 125..170, >= 6.8m clearance!)
  const roadMidW = toWorld(cx, 0, cz, rotY, 0, 0, 148);
  const roadLocalY = terrain.sample(roadMidW[0], roadMidW[2]) - yBase;
  const bridgeY = Math.max(prowTiers[0].yTop - 0.6, roadLocalY + 7.4);
  K.style(C_GRANITE, 0.62, 0.08, 0, MAT.GRANITE, 1.4);
  K.box(0, bridgeY - 0.55, 147.5, 18.0, 1.1, 47.0);
  K.balustrade([-8.6, bridgeY, 125], [-8.6, bridgeY, 170], 1.18, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.5, goldCap: true });
  K.balustrade([8.6, bridgeY, 125], [8.6, bridgeY, 170], 1.18, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.5, goldCap: true });
  // Descending grand stairs from bridge down onto Tier 1 confluence terrace
  K.stairs([0, podiumH, 82], [0, prowTiers[0].yTop, 108], 26, 0.28, { rgb: C_GRANITE, cheekRgb: C_STONE_DK });
  K.stairs([0, bridgeY, 170], [0, prowTiers[1].yTop, 198], 18, 0.26, { rgb: C_GRANITE, cheekRgb: C_STONE_DK });
  for (let i = 1; i < prowTiers.length - 1; i++) {
    const a = prowTiers[i], b = prowTiers[i + 1];
    K.stairs([0, a.yTop, a.z1 - 4], [0, b.yTop, b.z0 + 18], Math.max(12, 22 - i * 3), 0.26, { rgb: C_GRANITE, cheekRgb: C_STONE_DK });
  }

  // =================================================================================================
  // 3. EIGHT SCULPTED AERODYNAMIC CURVED SAIL SUPERTALL TOWERS
  // =================================================================================================
  const arcZ = (x) => 42 - (x * x) / 640;
  const frontTowerXs = [-111, -37, 37, 111];
  const crystalCenterY = Number.isFinite(P.crystalY) ? (P.crystalY - yBase) : (podiumH + 236);
  const crystalBaseY = crystalCenterY - 14.5;
  const frontH = Math.max(210, crystalBaseY - podiumH + 2);

  for (let i = 0; i < frontTowerXs.length; i++) {
    const tx = frontTowerXs[i];
    const tz = arcZ(tx);
    const fanRot = -tx * 0.0022;
    addSailTower(K, {
      cx: tx, cz: tz, y0: podiumH - 2,
      H: frontH, halfW: 16.5, halfD: 13.5,
      bow: 14.5, leanZ: 4.5, slantY: 6.0,
      rotY: fanRot,
      ledRgb: C_LED_GOLD,
    });
  }

  const twinH = Math.max(320, (P.h || 354.5) - podiumH);
  // Twin central supertalls get sharp mirrored asymmetric diagonal sail-blade crowns (slantX = +28 / -28!)
  // so head-on AND riverfront shots read as crisp soaring nautical sails instead of rounded pill cylinders!
  const rearTowers = [
    { x: -112, z: -46, H: frontH + 16, hw: 18.0, hd: 11.5, bow: 16, slant: 14, slantX:  18, rot: 0.22,  led: C_LED_CYAN },
    { x: -39,  z: -32, H: twinH - 14,  hw: 21.5, hd: 13.0, bow: 21, slant: 24, slantX:  28, rot: 0.06,  led: C_LED_GOLD },
    { x:  39,  z: -32, H: twinH - 14,  hw: 21.5, hd: 13.0, bow: 21, slant: 24, slantX: -28, rot: -0.06, led: C_LED_GOLD },
    { x:  112, z: -46, H: frontH + 16, hw: 18.0, hd: 11.5, bow: 16, slant: 14, slantX: -18, rot: -0.22, led: C_LED_CYAN },
  ];
  for (const tw of rearTowers) {
    addSailTower(K, {
      cx: tw.x, cz: tw.z, y0: podiumH - 2,
      H: tw.H, halfW: tw.hw, halfD: tw.hd,
      bow: tw.bow, leanZ: 6.0, slantY: tw.slant, slantX: tw.slantX,
      rotY: tw.rot,
      ledRgb: tw.led,
    });
  }

  // =================================================================================================
  // 4. THE CRYSTAL (水晶连廊 — 300m CURVED SKYBRIDGE AT 250m) + TWIN CONNECTOR SKYBRIDGES
  // =================================================================================================
  addTheCrystal(K, {
    yCrystal: crystalBaseY + 14.5,
    arcZ,
    spanHalf: 149,
    rx: 16.2,
    ry: 13.4,
    frontTowerXs,
  });

  // Two high-altitude glazed skybridge connectors linking the 354.5m Twin Towers into The Crystal!
  for (const bx of [-38, 38]) {
    const zRear = -22, zFront = arcZ(bx) - 10;
    const yConn = crystalBaseY + 12.0;
    K.style(C_GLASS_CRY, 0.10, 0.15, 0, MAT.GLASS, 2.6, 0.95);
    K.box(bx, yConn, (zRear + zFront) / 2, 10.5, 9.2, Math.abs(zFront - zRear));
    K.style(C_SILVER, 0.25, 0.88, 0, MAT.METAL);
    // Steel diagrid trusses along skybridge connector sides
    const nC = 6, dz = (zFront - zRear) / nC;
    for (const sg of [-1, 1]) {
      const sx = bx + sg * 5.4;
      K.tube([sx, yConn - 4.6, zRear], [sx, yConn - 4.6, zFront], 0.35, 0.35, 5, false);
      K.tube([sx, yConn + 4.6, zRear], [sx, yConn + 4.6, zFront], 0.35, 0.35, 5, false);
      for (let k = 0; k < nC; k++) {
        const za = zRear + k * dz, zb = za + dz;
        K.tube([sx, yConn - 4.6, za], [sx, yConn + 4.6, zb], 0.22, 0.22, 4, false);
        K.tube([sx, yConn + 4.6, za], [sx, yConn - 4.6, zb], 0.22, 0.22, 4, false);
      }
    }
    K.style(C_LED_GOLD, 0.2, 0, -5.0, MAT.LANTERN);
    K.tube([bx, yConn - 4.9, zRear], [bx, yConn - 4.9, zFront], 0.22, 0.22, 4, false);
  }

  // =================================================================================================
  // 5. ASSEMBLE GROUP, COLLIDERS & ARCHITECTURAL NIGHT LIGHTS
  // =================================================================================================
  const group = new THREE.Group();
  group.name = 'raffles-city-chongqing';
  group.position.set(cx, yBase, cz);
  group.rotation.y = rotY;

  const mesh = new THREE.Mesh(K.geometry(), materials.heroMatNoFlood);
  mesh.name = 'raffles-main';
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  group.add(mesh);

  // Colliders (Phase 5: full solid tower/podium/prow retaining walls down to -baseDrop + walkable Chaotianmen skybridge & stairs!)
  const polyW = (pts) => pts.map(([lx, lz]) => { const w = toWorld(cx, 0, cz, rotY, lx, 0, lz); return [w[0], w[2]]; });
  const prisms = [];
  for (const tx of frontTowerXs) {
    prisms.push({ type: 'circle', ...xyObj(toWorld(cx, yBase, cz, rotY, tx, 0, arcZ(tx))), r: 17, base: yBase - baseDrop, top: yBase + 265, sides: 10 });
  }
  for (const tw of rearTowers) {
    prisms.push({ type: 'circle', ...xyObj(toWorld(cx, yBase, cz, rotY, tw.x, 0, tw.z)), r: tw.hw + 1, base: yBase - baseDrop, top: yBase + tw.H + 28, sides: 10 });
  }
  // Exact sculpted curved podium footprint prism (matches podiumPts with ZERO wall-clipping!)
  prisms.push({ type: 'poly', pts: polyW(podiumPts), base: yBase - baseDrop, top: yBase + podiumH - 0.1 });
  // Solid retaining-wall prisms beneath each Chaotianmen stepped waterfront terrace (leaving z∈[125,170] boulevard 100% open!)
  for (const pt of prowTiers) {
    const triPts = [[-pt.w0, pt.z0], [pt.w0, pt.z0], [pt.w1, pt.z1], [-pt.w1, pt.z1]];
    prisms.push({ type: 'poly', pts: polyW(triPts), base: yBase - baseDrop, top: yBase + pt.yTop - 0.12 });
  }

  const plazas = [
    // Walkable 5F Rooftop Park atop the podium!
    { type: 'polyPlaza', pts: polyW(podiumPts), base: yBase + podiumH - 2, top: yBase + podiumH + 0.42 },
    // Walkable Chaotianmen stepped waterfront plaza terraces
    ...prowTiers.map((pt) => ({
      type: 'polyPlaza',
      pts: polyW([[-pt.w0, pt.z0], [pt.w0, pt.z0], [pt.w1, pt.z1], [-pt.w1, pt.z1]]),
      base: yBase + pt.yTop - 3,
      top: yBase + pt.yTop + 0.02,
    })),
  ];
  const mkDeck = (a, b, hw) => {
    const pA = toWorld(cx, yBase, cz, rotY, a[0], a[1], a[2]);
    const pB = toWorld(cx, yBase, cz, rotY, b[0], b[1], b[2]);
    return [pA[0], pA[2], pA[1], pB[0], pB[2], pB[1], hw];
  };
  const decks = [
    mkDeck([0, bridgeY + 0.04, 125], [0, bridgeY + 0.04, 170], 8.8),
    mkDeck([0, podiumH + 0.04, 82], [0, prowTiers[0].yTop + 0.04, 108], 13.0),
    mkDeck([0, bridgeY + 0.04, 170], [0, prowTiers[1].yTop + 0.04, 198], 9.0),
  ];

  // Dramatic architectural night lights along Chaotianmen Plaza, Podium & The Crystal!
  const lights = [];
  const pushL = (lx, ly, lz, radius, r, g, b, intensity, omni = 1) => {
    const [wx, wy, wz] = toWorld(cx, yBase, cz, rotY, lx, ly, lz);
    lights.push({ x: wx, y: wy, z: wz, radius, r, g, b, intensity, omni });
  };
  // Podium & Chaotianmen waterfront warm-gold architectural wash
  for (const lx of [-100, -50, 0, 50, 100]) {
    pushL(lx, 12, 82, 65, 1.0, 0.80, 0.48, 3200, 1);
    pushL(lx, podiumH + 8, 25, 58, 1.0, 0.84, 0.56, 2600, 1);
  }
  for (const lz of [98, 124, 150, 170]) {
    pushL(0, 14 - (lz - 98) * 0.14, lz, 55, 1.0, 0.78, 0.44, 2400, 1);
  }
  // Glowing Crystal conservatory sky lights illuminating tower crowns
  for (const lx of [-120, -60, 0, 60, 120]) {
    pushL(lx, crystalBaseY + 14, arcZ(lx) + 22, 95, 1.0, 0.84, 0.50, 5200, 1);
  }

  return {
    group,
    colliders: { prisms, plazas, decks },
    lights,
    labels: [
      { name: '重庆来福士', x: cx, y: yBase + 368, z: cz },
      { name: '朝天门广场', ...xyObj(toWorld(cx, yBase, cz, rotY, 0, 0, 152)), y: yBase + 22 },
    ],
  };
}
