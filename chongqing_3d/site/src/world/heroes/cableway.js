// 长江索道 (Yangtze River Cableway — "万里长江第一条空中走廊").
//
// Museum-grade structural & kinetic modeling:
//   1. North Station (新华路索道站, Yuzhong) & South Station (上新街索道站, Nan'an):
//      - Multi-story hillside concrete & granite terminals anchored deep into DEM cliff slopes
//      - Cantilevered open steel-and-glass departure/arrival bays with overhead boarding gantry beams & bullwheels
//      - Walkable entrance granite terraces & stairs, warm interior lighting, and crisp illuminated red-and-gold
//        Chinese neon plaques ("长江索道 · YANGTZE RIVER CABLEWAY")
//   2. Riverbank Structural Steel Lattice Support Towers (支架塔架):
//      - Tapered 4-leg structural steel truss towers with dense 4-sided X-bracing, maintenance platforms,
//        cantilevered steel cross-arm saddle heads, grooved pulley sheave wheels, and aviation beacons
//   3. Physically Realistic Catenary Steel Track & Haulage Cables (~1,166m span across the Yangtze!)
//   4. Two Animated Iconic Red & Cream Panoramic Aerial Cableway Cabins:
//      - Overhead 8-wheel steel bogie carriage pitching dynamically to match the exact local catenary cable slope!
//      - Tall sculpted crimson/silver A-frame steel hanger arm keeping the cabin level vertically (true pendulum!)
//      - Red skirt, warm cream horizontal waist stripe, wrap-around panoramic windows glowing warm golden-amber
//        inside at night, rooftop vents & navigation lights — smoothly gliding counterbalanced back & forth across
//        the Yangtze right beside Baixiangju & Dongshuimen Bridge!

import * as THREE from 'three';
import { HeroKit, MAT } from './kit.js';
import {
  PAL, useMat, vAdd, vSub, vScale, vNorm, vLen, catenaryY,
  makeFrame, sweepProfile, chamferRect, steelBeam, localToWorld,
} from './bridgeKit.js';

const TAU = Math.PI * 2;

// Fallback WGS-84-projected local coordinates relative to Jiefangbei (106.573357, 29.560101), waterY = 0
const FALLBACK_CABLEWAY = {
  north: { x: 1030, z: 380, baseY: 56, deckY: 66, angle: 0 },
  south: { x: 1715, z: 1320, baseY: 48, deckY: 58, angle: 0 },
  span: 1166,
  sag: 34,
  towers: [],
};

// ---------------------------------------------------------------------------
// 1. Cableway Terminal Building (North Xinhua Rd & South Shangxinjie Stations)
//    Local frame: +x pointing OUT over the Yangtze toward the opposite bank!
//                 y = 0 at world datum; baseY = ground terrace; deckY = cable departure bay level.
// ---------------------------------------------------------------------------
function buildCablewayStation(K, {
  baseY, deckY, cableHalfSep, isNorth, terrain,
  outLights, outDecks, outPrisms,
  wx, wz, ux, uz, rotY,
}) {
  const plinthBot = baseY - 14.0;
  const W = 26.0;  // Length along cable axis (x ∈ [-13, +13], bay projects out to +19m!)
  const D = 22.0;  // Transverse width across both cable lanes (z ∈ [-11, +11])
  const roofY = deckY + 9.2;

  // A. Massive Hillside Sandstone Retaining Plinth descending deep into slope
  useMat(K, PAL.sandstone);
  K.box(-2.0, (plinthBot + baseY) * 0.5, 0, W + 3.0, baseY - plinthBot, D + 3.0);

  // B. Lower Entrance Hall & Stepped Granite Plaza (baseY -> deckY) with weathered brick/granite pilasters
  const lowerH = Math.max(4.5, deckY - baseY);
  useMat(K, PAL.ochreTile);
  K.box(-2.0, baseY + lowerH * 0.5, 0, W, lowerH, D);
  useMat(K, PAL.graniteWarm);
  K.box(-2.0, baseY + 0.65, 0, W + 0.5, 1.3, D + 0.5); // Granite water-table base plinth
  // Entrance panoramic curtain-wall windows with 3D mullions
  useMat(K, PAL.glassDark);
  K.box(-2.0, baseY + lowerH * 0.52, D * 0.5 + 0.06, W - 4.0, lowerH * 0.60, 0.16);
  K.box(-2.0, baseY + lowerH * 0.52, -D * 0.5 - 0.06, W - 4.0, lowerH * 0.60, 0.16);
  K.box(-W * 0.5 - 2.06, baseY + lowerH * 0.46, 0, 0.16, lowerH * 0.66, D * 0.56);
  useMat(K, PAL.steelDark);
  for (let m = -10; m <= 6; m += 3.2) {
    for (const sg of [-1, 1]) K.box(m, baseY + lowerH * 0.52, sg * (D * 0.5 + 0.14), 0.16, lowerH * 0.64, 0.16);
  }

  // Entrance Terrace Apron behind station (-x side) matched to REAL DEM hillside elevation (ZERO buried stairs!)
  const sampleLoc = (lx, lz) => {
    if (!terrain) return baseY;
    const [sx, , sz] = localToWorld(wx, 0, wz, ux, uz, lx, 0, lz);
    return terrain.sample(sx, sz);
  };
  const maxTerrDem = Math.max(sampleLoc(-19.5, 0), sampleLoc(-19.5, -D * 0.4), sampleLoc(-19.5, D * 0.4), sampleLoc(-23.5, 0));
  const terrY = Math.max(baseY + 0.30, maxTerrDem + 0.18);
  const landDem = Math.max(sampleLoc(-29.5, 0), sampleLoc(-29.5, -3.5), sampleLoc(-29.5, 3.5));
  // Deep sandstone retaining skirt beneath terrace apron
  useMat(K, PAL.sandstone);
  K.box(-W * 0.5 - 6.5, (plinthBot + terrY - 0.25) * 0.5, 0, 9.4, Math.max(2.0, terrY - 0.25 - plinthBot), D + 2.2);
  useMat(K, PAL.graniteWarm);
  K.box(-W * 0.5 - 6.5, terrY - 0.25, 0, 9.0, 0.55, D + 2.0);
  for (let kb = -3; kb <= 3; kb++) {
    K.box(-W * 0.5 - 10.6, terrY + 0.45, kb * 3.2, 0.34, 0.92, 0.34); // Granite plaza bollards seated flush on terrY
  }
  if (typeof K.stairs === 'function' && Math.abs(landDem - terrY) >= 0.45) {
    // Automatically climbs UP or descends DOWN to match the exact street DEM elevation behind the station!
    K.stairs([-W * 0.5 - 11.0, terrY, 0], [-W * 0.5 - 16.5, landDem + 0.10, 0], 8.0, 0.24);
  } else {
    // Flush granite landing bridge into level street
    K.box(-W * 0.5 - 13.75, (terrY + landDem) * 0.5 - 0.2, 0, 5.8, 0.5, 8.2);
  }
  // Walkable terrace collider
  const [tx, , tz] = localToWorld(wx, 0, wz, ux, uz, -W * 0.5 - 6.5, 0, 0);
  outDecks.push({ type: 'rectDeck', x: tx, z: tz, ang: rotY, hx: 4.5, hz: D * 0.5 + 1.0, y: terrY + 0.05 });

  // C. Upper Departure & Boarding Hall (deckY -> roofY) with OPEN RIVERFRONT DEPARTURE BAY!
  const bayH = roofY - deckY;
  // Back enclosed waiting hall (x ∈ [-15, +2])
  useMat(K, PAL.creamWall);
  K.box(-6.5, deckY + bayH * 0.5, 0, 17.0, bayH, D + 0.4);
  // Architectural vertical fins along upper hall side facades (cleanly proud of glass/mullions -> ZERO Z-fighting!)
  useMat(K, PAL.concLight);
  for (const sg of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      K.box(-14.2 + k * 3.1, deckY + bayH * 0.5, sg * (D * 0.5 + 0.52), 0.55, bayH + 0.4, 0.48);
    }
    // Illuminated upper panoramic observation glass band (>= 5cm proud of creamWall) + crisp 3D mullions (>= 5cm proud of glass!)
    const gwY = deckY + bayH * 0.54, gwH = bayH * 0.56, gwZ = sg * (D * 0.5 + 0.28);
    useMat(K, PAL.glassLitWarm);
    K.box(-6.5, gwY, gwZ, 15.6, gwH, 0.08);
    useMat(K, PAL.steelDark);
    K.box(-6.5, gwY + gwH * 0.22, gwZ + sg * 0.08, 15.7, 0.11, 0.08);
    K.box(-6.5, gwY - gwH * 0.48, gwZ + sg * 0.08, 15.7, 0.12, 0.10);
    K.box(-6.5, gwY + gwH * 0.48, gwZ + sg * 0.08, 15.7, 0.12, 0.10);
    for (let mx = -13.5; mx <= 0.5; mx += 2.33) {
      K.box(mx, gwY, gwZ + sg * 0.08, 0.11, gwH, 0.08);
    }
    useMat(K, PAL.concLight);
  }

  // D. CANTILEVERED OPEN DEPARTURE BAY projecting out over the river slope (x ∈ [+2, +17.5])!
  // Floor boarding deck cantilevered out over steep slope with diagonal concrete struts underneath
  useMat(K, PAL.concLight);
  K.box(9.5, deckY - 0.45, 0, 15.5, 0.95, D - 1.2);
  // Sweeping diagonal concrete cantilever struts supporting the departure deck
  useMat(K, PAL.concPier);
  for (const zsg of [-1, 0, 1]) {
    steelBeam(K, [2.0, deckY - 6.2, zsg * (D * 0.38)], [15.5, deckY - 0.9, zsg * (D * 0.38)], 0.95, 1.15);
  }
  // Open Departure Bay Roof Canopy + Steel Gantry Portal Frame (allowing cabins to glide straight inside!)
  useMat(K, PAL.concLight);
  K.box(9.5, roofY - 0.35, 0, 16.5, 0.85, D + 0.8);
  // Signature Chongqing red architectural cornice band wrapping around the entire station roofline!
  useMat(K, PAL.cqRed);
  K.box(1.5, roofY + 0.45, 0, 33.2, 0.95, D + 1.4);
  // Warm glowing red-gold neon outline strip under canopy eaves
  useMat(K, PAL.ledRed);
  K.box(1.5, roofY + 1.02, 0, 33.5, 0.24, D + 1.65);

  // Steel outer columns & glass wind-screen balustrades framing the open riverfront bay
  useMat(K, PAL.steelDark);
  for (const sg of [-1, 1]) {
    for (const cx of [3.0, 9.5, 16.5]) {
      K.box(cx, deckY + bayH * 0.5, sg * (D * 0.5 - 0.6), 0.62, bayH, 0.62);
    }
    // Side viewing balcony railings
    useMat(K, PAL.steelSilver);
    K.box(9.5, deckY + 1.15, sg * (D * 0.5 - 0.6), 14.5, 0.08, 0.08);
    useMat(K, PAL.glassPlain);
    K.box(9.5, deckY + 0.58, sg * (D * 0.5 - 0.6), 14.2, 0.92, 0.05);
    useMat(K, PAL.steelDark);
  }

  // Inside the Open Bay: Twin Overhead Steel Cable-Rail Gantries + Giant Bullwheel Sheave Drums!
  const railY = deckY + 6.4;
  for (const sg of [-1, 1]) {
    const zLane = sg * cableHalfSep;
    // Overhead steel track gantry beam extending cleanly to front mouth (x = +17.5)
    useMat(K, PAL.steelSilver);
    K.box(8.0, railY + 0.55, zLane, 19.0, 0.52, 0.72);
    // Giant horizontal/vertical steel cable bullwheel sheave drum inside machinery bay (inset >= 10cm clear of gantry sides!)
    useMat(K, PAL.cqRed);
    K.tube([1.8, railY, zLane - 0.22], [1.8, railY, zLane + 0.22], 1.75, 1.75, 16, true);
    useMat(K, PAL.steelDark);
    K.tube([1.8, railY, zLane - 0.52], [1.8, railY, zLane + 0.52], 0.45, 0.45, 10, true);
    // Yellow boarding safety gates along central boarding island
    useMat(K, PAL.laneYellow);
    K.box(9.5, deckY + 0.65, sg * (cableHalfSep - 2.1), 11.0, 1.2, 0.14);
  }

  // Glowing overhead bay ceiling lights + local light pools
  useMat(K, PAL.ledWhite);
  for (const lx of [5.5, 10.5, 15.0]) {
    K.box(lx, roofY - 0.85, 0, 2.2, 0.14, 4.5);
  }
  const [lwx, lwy, lwz] = localToWorld(wx, 0, wz, ux, uz, 10.0, deckY + 5.2, 0);
  outLights.push({ x: lwx, y: lwy, z: lwz, radius: 40, r: 1.0, g: 0.86, b: 0.58, intensity: 980 });

  // Station rooftop signage pedestal frame (holds the glowing red "长江索道" plaque!)
  useMat(K, PAL.steelDark);
  K.box(15.5, roofY + 2.8, 0, 0.45, 3.6, 13.5);
  // Walkable cantilevered viewing deck inside open departure terrace
  const [dwx, , dwz] = localToWorld(wx, 0, wz, ux, uz, 9.5, 0, 0);
  outDecks.push({ type: 'rectDeck', x: dwx, z: dwz, ang: rotY, hx: 7.5, hz: D * 0.45, y: deckY + 0.06 });
  // Station solid core prism colliders:
  //   1) Full-height back waiting hall (lx ∈ [-15, +2], base=plinthBot..roofY+3)
  //   2) Full lower entrance hall & sandstone plinth (lx ∈ [-15.5, +11.5], base=plinthBot..deckY-0.30) — blocks walking through front lower walls!
  //   3) Rear terrace sandstone retaining wall below terrY-0.35 (blocks walking under terrace from downhill while top stays walkable!)
  const [pwx, , pwz] = localToWorld(wx, 0, wz, ux, uz, -6.5, 0, 0);
  outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: rotY, hx: 8.5, hz: D * 0.5 + 0.3, base: plinthBot - 6, top: roofY + 3 });
  const [lhallX, , lhallZ] = localToWorld(wx, 0, wz, ux, uz, -2.0, 0, 0);
  outPrisms.push({ type: 'rect', x: lhallX, z: lhallZ, ang: rotY, hx: W * 0.5 + 0.8, hz: D * 0.5 + 0.8, base: plinthBot - 6, top: deckY - 0.30 });
  const [terrSkirtX, , terrSkirtZ] = localToWorld(wx, 0, wz, ux, uz, -W * 0.5 - 6.5, 0, 0);
  outPrisms.push({ type: 'rect', x: terrSkirtX, z: terrSkirtZ, ang: rotY, hx: 4.7, hz: D * 0.5 + 1.1, base: plinthBot - 6, top: terrY - 0.35 });

  return { cableAttachX: 16.5, cableAttachY: railY, roofY, isNorth };
}

// ---------------------------------------------------------------------------
// 2. Riverbank Structural Steel Lattice Support Pylon (支架塔架)
//    Local frame: +x along span, y up, origin at tower world XZ (y=0 datum)
// ---------------------------------------------------------------------------
function buildLatticeTower(K, {
  groundY, waterY = 0, saddleY, cableHalfSep,
  outPrisms, outLights, wx, wz,
}) {
  const baseY = groundY - 14.0;
  // Riverbank towers standing in the Yangtze riverbed rise on a solid concrete floodwater pier above waterY + 11.5m!
  const plinthTop = groundY < waterY + 2.0 ? Math.max(groundY + 3.8, waterY + 11.5) : (groundY + 3.8);
  const h = Math.max(18.0, saddleY - plinthTop);
  const nBays = Math.max(4, Math.round(h / 6.5));
  const dxBot = 4.6, dzBot = cableHalfSep + 3.2;
  const dxTop = 1.9, dzTop = cableHalfSep + 0.6;

  // Massive concrete foundation pedestal piers anchored into riverbank terrain
  useMat(K, PAL.sandstone);
  K.box(0, (baseY + plinthTop - 1.5) * 0.5, 0, dxBot * 2 + 4.0, plinthTop - 1.5 - baseY, dzBot * 2 + 4.0);
  useMat(K, PAL.concLight);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    K.box(sx * dxBot, plinthTop - 0.8, sz * dzBot, 2.4, 2.2, 2.4);
  }

  // Corner coordinates at level fraction t ∈ [0, 1]
  const corner = (t, sx, sz) => [
    sx * (dxBot + (dxTop - dxBot) * t),
    plinthTop + h * t,
    sz * (dzBot + (dzTop - dzBot) * t),
  ];

  // 4 Inclined Heavy Steel Corner Legs
  useMat(K, PAL.steelSilver);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    steelBeam(K, corner(0, sx, sz), corner(1, sx, sz), 0.62, 0.62, [1, 0, 0], true, 0.06);
  }

  // Dense 4-Sided Structural X-Bracing Lattice Bays + Horizontal Girts
  for (let i = 0; i < nBays; i++) {
    const t0 = i / nBays, t1 = (i + 1) / nBays;
    const c00 = corner(t0, -1, -1), c10 = corner(t0, 1, -1), c11 = corner(t0, 1, 1), c01 = corner(t0, -1, 1);
    const d00 = corner(t1, -1, -1), d10 = corner(t1, 1, -1), d11 = corner(t1, 1, 1), d01 = corner(t1, -1, 1);
    const faces = [
      [c00, c10, d10, d00],
      [c10, c11, d11, d10],
      [c11, c01, d01, d11],
      [c01, c00, d00, d01],
    ];
    for (const [a, b, c, d] of faces) {
      // Horizontal perimeter girt
      useMat(K, PAL.steelSilver);
      steelBeam(K, d, c, 0.34, 0.34);
      // Crisscross X-bracing steel diagonals + bolted corner gusset plates
      useMat(K, PAL.steelDark);
      steelBeam(K, a, c, 0.24, 0.24);
      steelBeam(K, b, d, 0.24, 0.24);
      K.box(d[0], d[1], d[2], 0.88, 0.72, 0.88);
    }
    // Internal maintenance catwalk platform near top
    if (i === nBays - 2) {
      useMat(K, PAL.steelDark);
      const yp = plinthTop + h * t1;
      K.box(0, yp, 0, dxTop * 2.5, 0.18, dzTop * 2.2);
    }
  }
  // Vertical exterior steel maintenance ladder with safety rungs climbing one face of the tower
  const ladBot = [0, plinthTop, dzBot - 0.25], ladTop = [0, saddleY - 0.5, dzTop - 0.15];
  useMat(K, PAL.steelDark);
  steelBeam(K, [-0.26, ladBot[1], ladBot[2]], [-0.26, ladTop[1], ladTop[2]], 0.06, 0.06);
  steelBeam(K, [0.26, ladBot[1], ladBot[2]], [0.26, ladTop[1], ladTop[2]], 0.06, 0.06);
  const nRungs = Math.max(12, Math.round(h / 0.9));
  for (let r = 0; r < nRungs; r++) {
    const tr = r / nRungs;
    const ry = ladBot[1] + (ladTop[1] - ladBot[1]) * tr;
    const rz = ladBot[2] + (ladTop[2] - ladBot[2]) * tr;
    K.box(0, ry, rz, 0.54, 0.045, 0.045);
  }

  // Wide Cantilevered Steel Cross-Arm Saddle Head + Curved Cable Shoes + Grooved Pulley Sheaves!
  const crossZ = cableHalfSep + 2.4;
  useMat(K, PAL.steelSilver);
  // Twin longitudinal box beams & wide transverse cross-head truss
  K.box(0, saddleY - 0.55, 0, 4.4, 1.15, crossZ * 2);
  // Diagonal knee struts under cross-arm overhangs
  for (const sz of [-1, 1]) {
    steelBeam(K, [0, saddleY - 4.2, sz * dzTop], [0, saddleY - 0.7, sz * crossZ], 0.38, 0.38);
  }
  // Curved steel cable saddles & twin pulley sheave wheels for BOTH cableway lanes (distinct widths -> ZERO Z-fight!)
  for (const sz of [-1, 1]) {
    const zLane = sz * cableHalfSep;
    // Curved steel track-rope support shoe (3.6m long saddle cradling the twin track ropes)
    useMat(K, PAL.cqRed);
    K.box(0, saddleY + 0.34, zLane, 3.8, 0.62, 0.88);
    // Grooved steel haulage pulley sheave wheels strictly wider than saddle (+0.18m per side)
    useMat(K, PAL.steelDark);
    for (const sx of [-1.2, 1.2]) {
      K.tube([sx, saddleY - 0.18, zLane - 0.62], [sx, saddleY - 0.18, zLane + 0.62], 0.56, 0.56, 12, true);
    }
  }
  // Maintenance railing along top gantry + red aviation obstruction beacon!
  useMat(K, PAL.steelSilver);
  K.box(0, saddleY + 1.45, crossZ - 0.15, 4.4, 0.08, 0.08);
  K.box(0, saddleY + 1.45, -crossZ + 0.15, 4.4, 0.08, 0.08);
  K.tube([0, saddleY + 0.4, 0], [0, saddleY + 4.2, 0], 0.14, 0.06, 6, true);
  useMat(K, PAL.beaconRed);
  K.sphere(0, saddleY + 4.45, 0, 0.48, 8, 6);

  outPrisms.push({ type: 'circle', x: wx, z: wz, r: 5.5, sides: 8, base: baseY, top: saddleY });
  outLights.push({ x: wx, y: saddleY - 2.0, z: wz, radius: 38, r: 1.0, g: 0.78, b: 0.42, intensity: 760 });
}

// ---------------------------------------------------------------------------
// 3. Iconic Chongqing Red & Cream Aerial Cableway Cabin (2 Parts: Bogie + Pendulum Cabin!)
//    Separating Bogie (pitches to cable slope!) from Cabin+Hanger (stays level vertically!)
//    produces 100% physically authentic cableway motion!
// ---------------------------------------------------------------------------

/** Overhead 8-wheel articulated multi-sheave steel bogie carriage riding directly ON the catenary track ropes. */
function buildBogieGeo() {
  const K = new HeroKit();
  // Main structural bogie chassis beam + twin articulated 4-bar equalizer rocker beams!
  useMat(K, PAL.steelDark);
  K.box(0, 0.44, 0, 5.4, 0.34, 0.66);
  useMat(K, PAL.steelSilver);
  for (const rx of [-1.55, 1.55]) {
    K.box(rx, 0.28, 0, 2.05, 0.18, 0.82); // Articulated equalizer rocker bar
    K.tube([rx, 0.42, -0.45], [rx, 0.42, 0.45], 0.14, 0.14, 8, true); // Rocker pivot pin
  }
  // 8 grooved steel wheels (4 pairs straddling twin track ropes) with flanged hubs & axles!
  for (const wx of [-2.25, -0.85, 0.85, 2.25]) {
    useMat(K, PAL.steelDark);
    K.tube([wx, 0.16, -0.48], [wx, 0.16, 0.48], 0.08, 0.08, 6, true); // Axle shaft
    for (const wz of [-0.36, 0.36]) {
      useMat(K, PAL.steelSilver);
      K.tube([wx, 0.16, wz - 0.09], [wx, 0.16, wz + 0.09], 0.30, 0.30, 14, true); // Flanged sheave wheel
      useMat(K, PAL.steelDark);
      K.tube([wx, 0.16, wz - 0.04], [wx, 0.16, wz + 0.04], 0.23, 0.23, 12, true); // Grooved cable tread
    }
  }
  // Red hydraulic emergency track-brake caliper housing, coil spring block & haulage-rope grip clamp
  useMat(K, PAL.cqRed);
  K.box(0, 0.72, 0, 1.65, 0.42, 0.78);
  useMat(K, PAL.steelDark);
  K.box(0, -0.48, 0, 1.25, 0.32, 0.42); // Haulage traction rope grip jaws
  useMat(K, PAL.steelSilver);
  K.box(0, -0.14, 0, 0.78, 0.86, 0.50); // Main pendulum pivot yoke
  return K.geometry();
}

/** Iconic Red & Cream Panoramic Cableway Cabin + Articulated Hanger Frame + Visible Interior Benches & Handrails! */
function buildCabinGeo() {
  const K = new HeroKit();
  const drop = 4.4;       // Pivot-to-cabin-roof suspension height
  const L = 8.6, W = 3.55, H = 3.0; // Iconic large 80-passenger Yangtze cableway cabin
  const roofY = -drop;
  const floorY = roofY - H;
  const beltY = floorY + 1.24;
  const hl = L * 0.5, hw = W * 0.5;

  // 1. Detailed Riveted Steel Goose-Neck A-Frame Hanger Arm + Sway Dampers + Maintenance Ladder!
  useMat(K, PAL.steelSilver);
  steelBeam(K, [0, 0, 0], [0, -1.65, 0], 0.40, 0.44, [1, 0, 0], true, 0.05);
  // Central bolted gusset plate at A-frame fork junction
  useMat(K, PAL.steelDark);
  K.box(0, -1.55, 0, 0.92, 0.78, 0.52);
  // Sweeping double-plate crimson A-frame arms + diagonal sway-damper pistons!
  useMat(K, PAL.cqRed);
  steelBeam(K, [0, -1.55, 0], [-2.35, roofY + 0.14, 0], 0.34, 0.40, [0, 1, 0], true, 0.04);
  steelBeam(K, [0, -1.55, 0], [2.35, roofY + 0.14, 0], 0.34, 0.40, [0, 1, 0], true, 0.04);
  // Horizontal brace + hydraulic sway-damper cylinders
  useMat(K, PAL.steelSilver);
  steelBeam(K, [-1.35, -2.95, 0], [1.35, -2.95, 0], 0.18, 0.20);
  K.tube([0, -1.75, 0.32], [0, roofY + 0.25, 0.32], 0.09, 0.07, 8, true);
  // Maintenance ladder rungs up one arm of hanger frame
  for (let r = 0; r < 7; r++) {
    const t = r / 6;
    K.box(-2.2 * (1 - t), roofY + 0.45 + t * 2.55, -0.28, 0.38, 0.05, 0.05);
  }
  useMat(K, PAL.steelDark);
  K.box(0, roofY + 0.30, 0, 5.4, 0.30, 1.12);
  for (const ax of [-2.2, 2.2]) K.box(ax, roofY + 0.12, 0, 0.62, 0.20, 1.50);

  // 2. Iconic Chongqing Red & Cream Panoramic Cabin Body with recessed seams & rubber bumpers!
  K.style([0.78, 0.10, 0.06], 0.28, 0.24, -0.45, MAT.PLAIN);
  K.box(0, (floorY + beltY) * 0.5, 0, L, beltY - floorY, W);
  // Dark underfloor bumper skirt + corner rubber shock bumpers
  useMat(K, PAL.steelDark);
  K.box(0, floorY - 0.12, 0, L - 0.25, 0.24, W - 0.20);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    K.box(sx * (hl + 0.06), floorY + 0.22, sz * (hw + 0.06), 0.24, 0.32, 0.24);
  }

  // Iconic warm cream / ivory waist stripe, upper fascia & streamlined roof deck (>= 6cm proud -> ZERO Z-fight!)
  K.style([0.92, 0.87, 0.74], 0.30, 0.12, -0.32, MAT.PLAIN);
  K.box(0, beltY - 0.14, 0, L + 0.12, 0.28, W + 0.12);
  K.box(0, roofY - 0.16, 0, L + 0.12, 0.32, W + 0.12);
  K.box(0, roofY + 0.08, 0, L - 0.32, 0.16, W - 0.28);
  useMat(K, PAL.louverMetal);
  for (const vx of [-1.25, 1.25]) K.box(vx, roofY + 0.32, 0, 1.15, 0.22, 1.38);

  // 3. Panoramic Recessed Glass Windows + VISIBLE 3D INTERIOR CABIN BENCHES, CEILING LIGHT & GRAB HANDRAILS!
  const winH = roofY - 0.32 - beltY;
  const winY = beltY + winH * 0.5;
  // Slightly inset warm-lit panoramic glazing core so 3D exterior frames & interior fixtures read with crisp depth!
  K.style([1.0, 0.88, 0.60], 0.07, 0.06, -5.2, MAT.PLAIN, 0, 0.94);
  K.box(0, winY, 0, L - 0.38, winH - 0.04, W - 0.38);
  // Visible interior cabin ceiling LED diffuser, central vertical stanchion pole, overhead grab rails & perimeter benches!
  useMat(K, PAL.ledWhite);
  K.box(0, roofY - 0.42, 0, L - 1.2, 0.08, 0.95);
  useMat(K, PAL.steelSilver);
  // Overhead longitudinal passenger grab handrails & hanging strap rings visible right behind glass!
  for (const sz of [-0.75, 0.75]) {
    K.box(0, roofY - 0.58, sz, L - 1.4, 0.05, 0.05);
    for (let h = -3; h <= 3; h++) K.box(h * 1.05, roofY - 0.78, sz, 0.05, 0.32, 0.05);
  }
  K.tube([0, floorY + 0.2, 0], [0, roofY - 0.3, 0], 0.06, 0.06, 8, true); // Central cabin vertical handrail pole
  // Interior perimeter passenger seats strictly inset clear of glazing
  useMat(K, PAL.coralAccent);
  for (const sz of [-1, 1]) K.box(0, beltY + 0.14, sz * (hw - 0.52), L - 1.4, 0.16, 0.36);

  // 4. Crisp 3D Exterior Window Frames, Corner Pillars, Upper Sliding Transom Vent Bars & Boarding Doors!
  useMat(K, PAL.cqRed);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    K.box(sx * (hl - 0.09), winY, sz * (hw - 0.09), 0.24, winH + 0.12, 0.24);
  }
  useMat(K, PAL.steelDark);
  // Horizontal upper sliding transom vent bar wrapping all 4 sides (unmistakable Yangtze Cableway detail!)
  for (const sz of [-1, 1]) K.box(0, roofY - 0.62, sz * (hw + 0.015), L - 0.16, 0.08, 0.09);
  for (const sx of [-1, 1]) K.box(sx * (hl + 0.015), roofY - 0.62, 0, 0.09, 0.08, W - 0.16);
  // Side window vertical aluminum mullions + center double-door frame track & vertical door handles!
  for (let k = 1; k < 5; k++) {
    const mx = -hl + (L * k) / 5;
    for (const sz of [-1, 1]) K.box(mx, winY, sz * (hw + 0.015), 0.11, winH, 0.09);
  }
  // Sliding double passenger door track rail + center seam on both sides
  useMat(K, PAL.steelSilver);
  for (const sz of [-1, 1]) {
    K.box(0, roofY - 0.24, sz * (hw + 0.045), 2.4, 0.08, 0.06);
    K.box(0, (floorY + roofY - 0.3) * 0.5, sz * (hw + 0.03), 0.05, H - 0.4, 0.04);
  }
  useMat(K, PAL.steelDark);
  for (const sx of [-1, 1]) {
    for (const mz of [-0.68, 0.68]) K.box(sx * (hl + 0.015), winY, mz, 0.09, winH, 0.11);
  }

  // 5. Exterior Navigation & Flood Lamps
  K.style([1.0, 0.95, 0.78], 0.15, 0, -18.0, MAT.LANTERN);
  for (const sx of [-1, 1]) {
    K.box(sx * (hl + 0.05), roofY - 0.15, 0, 0.08, 0.18, 0.90);
    K.box(sx * (hl + 0.05), floorY + 0.35, 0, 0.08, 0.18, 0.58);
  }
  K.style([1.0, 0.74, 0.32], 0.2, 0, -6.0, MAT.LANTERN);
  K.box(0, floorY - 0.25, 0, L * 0.65, 0.06, 0.55);

  return K.geometry();
}

// ---------------------------------------------------------------------------
// Multi-Segment Piecewise Catenary Evaluator (North Station -> North Tower -> South Tower -> South Station)
// ---------------------------------------------------------------------------
function makeCablewayPath(anchors) {
  // anchors: [{ s, y, sagToNext }, ...] ordered by increasing distance s along axis
  const totalS = anchors[anchors.length - 1].s;
  const evalY = (s) => {
    const sc = Math.max(0, Math.min(totalS, s));
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (sc <= b.s + 1e-4 || i === anchors.length - 2) {
        const t = Math.max(0, Math.min(1, (sc - a.s) / Math.max(1e-4, b.s - a.s)));
        return catenaryY(t, a.y, b.y, a.sagToNext || 0);
      }
    }
    return anchors[0].y;
  };
  const evalSlope = (s) => {
    const eps = 1.5;
    const s0 = Math.max(0, s - eps), s1 = Math.min(totalS, s + eps);
    return (evalY(s1) - evalY(s0)) / Math.max(1e-4, s1 - s0);
  };
  return { totalS, evalY, evalSlope };
}

// ---------------------------------------------------------------------------
// Module Entry Point: buildCableway(ctx)
// ---------------------------------------------------------------------------
export function buildCableway(ctx) {
  const { data, terrain, materials, makePlaque } = ctx;
  const raw = data?.cableway || FALLBACK_CABLEWAY;

  const group = new THREE.Group();
  group.name = 'hero-cableway';
  const movingGroup = new THREE.Group();
  movingGroup.name = 'hero-cableway-moving-shadow';
  const prisms = [];
  const decks = [];
  const lights = [];
  const labels = [];

  // 1. Resolve North (Yuzhong Xinhua Rd) & South (Nan'an Shangxinjie) Terminal Coordinates
  const N = raw.north || FALLBACK_CABLEWAY.north;
  const S = raw.south || FALLBACK_CABLEWAY.south;
  const dx = S.x - N.x, dz = S.z - N.z;
  const fullDist = Math.max(100, Math.hypot(dx, dz));
  const ux = dx / fullDist, uz = dz / fullDist;
  const rotNorth = Math.atan2(-uz, ux);             // North station +x faces South toward Yangtze
  const rotSouth = Math.atan2(uz, -ux);             // South station +x faces North toward Yangtze

  const waterY = terrain?.riverY ?? data?.waterY ?? 0;
  const nBaseY = N.baseY ?? terrain.sample(N.x, N.z);
  const sBaseY = S.baseY ?? terrain.sample(S.x, S.z);
  const nDeckY = Math.max(N.deckY ?? (nBaseY + 10.0), waterY + 54.0);
  const sDeckY = Math.max(S.deckY ?? (sBaseY + 10.0), waterY + 46.0);
  const cableHalfSep = 3.85; // 7.7m spacing between parallel Northbound & Southbound cable lines

  // 2. Build North & South Terminal Stations
  const staticKit = new HeroKit();
  const buildStationAt = (st, baseY, deckY, ax, az, rotY, isNorth) => {
    staticKit.push().translate(st.x, 0, st.z).rotateY(rotY);
    const info = buildCablewayStation(staticKit, {
      baseY, deckY, cableHalfSep, isNorth, terrain,
      outLights: lights, outDecks: decks, outPrisms: prisms,
      wx: st.x, wz: st.z, ux: ax, uz: az, rotY,
    });
    staticKit.pop();

    // Glowing Red & Gold "长江索道" Rooftop Plaques facing river AND city street!
    if (typeof makePlaque === 'function') {
      const sub = isNorth ? 'YANGTZE CABLEWAY · NORTH' : 'YANGTZE CABLEWAY · SOUTH';
      for (const faceRiver of [true, false]) {
        const plaque = makePlaque('长江索道', {
          w: 12.0, h: 3.4,
          bg: '#520806', fg: '#ffdf6b', border: '#ff3b28',
          subtext: sub,
          emissiveNight: 4.0, emissiveDay: 0.14,
        });
        const lx = faceRiver ? 15.85 : 15.15;
        const [px, py, pz] = localToWorld(st.x, 0, st.z, ax, az, lx, info.roofY + 2.85, 0);
        plaque.position.set(px, py, pz);
        plaque.rotation.y = rotY + (faceRiver ? Math.PI * 0.5 : -Math.PI * 0.5);
        plaque.matrixAutoUpdate = false; plaque.updateMatrix(); plaque.updateMatrixWorld(true);
        group.add(plaque);
      }
    }
    return info;
  };

  const nInfo = buildStationAt(N, nBaseY, nDeckY, ux, uz, rotNorth, true);
  const sInfo = buildStationAt(S, sBaseY, sDeckY, -ux, -uz, rotSouth, false);

  // 3. Riverbank Structural Steel Lattice Support Pylons (2 towers along the span!)
  // Place towers either from landmarks.json `cableway.towers` or cleanly on both riverbank slopes (~13% & ~87% of span)
  const towerPositions = [];
  if (Array.isArray(raw.towers) && raw.towers.length >= 1) {
    for (const tw of raw.towers) {
      const projS = (tw.x - N.x) * ux + (tw.z - N.z) * uz;
      if (projS > 35 && projS < fullDist - 35) {
        towerPositions.push({ s: projS, y: tw.topY ?? tw.y ?? null, baseY: tw.baseY ?? null });
      }
    }
    towerPositions.sort((a, b) => a.s - b.s);
  }
  if (towerPositions.length === 0 && fullDist > 360) {
    towerPositions.push({ s: fullDist * 0.135, y: null, baseY: null });
    towerPositions.push({ s: fullDist * 0.865, y: null, baseY: null });
  }

  // Cable endpoints at North & South station departure gantry mouths
  const sStart = nInfo.cableAttachX;
  const sEnd = fullDist - sInfo.cableAttachX;
  const yStart = nInfo.cableAttachY;
  const yEnd = sInfo.cableAttachY;

  const anchors = [{ s: sStart, y: yStart, sagToNext: 0 }];
  for (let i = 0; i < towerPositions.length; i++) {
    const tp = towerPositions[i];
    const [twx, , twz] = localToWorld(N.x, 0, N.z, ux, uz, tp.s, 0, 0);
    const groundY = Math.min(terrain.sample(twx, twz), tp.baseY ?? 1e9);
    // Tower saddle sits high enough to keep main Yangtze catenary high & dramatic (~45m+ above river!)
    const frac = (tp.s - sStart) / Math.max(1, sEnd - sStart);
    const chordY = yStart + (yEnd - yStart) * frac;
    const saddleY = Math.max(tp.y ?? (chordY + 12.0), groundY + 26.0, waterY + 68.0);

    staticKit.push().translate(twx, 0, twz).rotateY(rotNorth);
    buildLatticeTower(staticKit, {
      groundY, waterY, saddleY, cableHalfSep,
      outPrisms: prisms, outLights: lights, wx: twx, wz: twz,
    });
    staticKit.pop();
    anchors.push({ s: tp.s, y: saddleY + 0.55, sagToNext: 0 });
  }
  anchors.push({ s: sEnd, y: yEnd, sagToNext: 0 });

  // Assign physical catenary sag to each span segment proportional to L^2 (main Yangtze span gets ~34m sag!)
  const mainSag = raw.sag ?? 34.0;
  let maxSegLen = 1;
  for (let i = 0; i < anchors.length - 1; i++) {
    maxSegLen = Math.max(maxSegLen, anchors[i + 1].s - anchors[i].s);
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const segLen = anchors[i + 1].s - anchors[i].s;
    anchors[i].sagToNext = mainSag * Math.pow(segLen / maxSegLen, 1.85);
  }

  const cablePath = makeCablewayPath(anchors);

  // 4. Build Smooth Multi-Rope Catenary Steel Track & Haulage Cables across the Full Yangtze Span!
  const cableKit = new HeroKit();
  for (const laneSg of [-1, 1]) {
    const zLane = laneSg * cableHalfSep;
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      const segLen = b.s - a.s;
      const nSub = Math.max(10, Math.round(segLen / 20));
      // Twin heavy steel track ropes (carrying bogie wheels, spaced ±0.36m) + lower haulage traction rope
      const ropes = [
        { dz: -0.36, dy: 0.0,  r: 0.075, mat: PAL.cableSteel },
        { dz:  0.36, dy: 0.0,  r: 0.075, mat: PAL.cableSteel },
        { dz:  0.00, dy: -0.55, r: 0.055, mat: PAL.steelDark },
      ];
      for (const rp of ropes) {
        useMat(cableKit, rp.mat);
        let prev = null;
        for (let k = 0; k <= nSub; k++) {
          const t = k / nSub;
          const s = a.s + segLen * t;
          const y = catenaryY(t, a.y, b.y, a.sagToNext) + rp.dy;
          const pt = localToWorld(N.x, 0, N.z, ux, uz, s, y, zLane + rp.dz);
          if (prev) cableKit.tube(prev, pt, rp.r, rp.r, 5, false);
          prev = pt;
        }
      }
      // Periodic steel spacer yokes & aviation warning spheres on the main Yangtze span
      if (segLen > 240) {
        for (let m = 1; m <= 7; m++) {
          const t = m / 8;
          const s = a.s + segLen * t;
          const y = catenaryY(t, a.y, b.y, a.sagToNext);
          const pL = localToWorld(N.x, 0, N.z, ux, uz, s, y, zLane - 0.36);
          const pR = localToWorld(N.x, 0, N.z, ux, uz, s, y, zLane + 0.36);
          useMat(cableKit, PAL.steelDark);
          steelBeam(cableKit, pL, pR, 0.10, 0.12);
          if (m % 2 === 0) {
            const pMid = localToWorld(N.x, 0, N.z, ux, uz, s, y - 0.55, zLane);
            useMat(cableKit, PAL.cqCoral);
            cableKit.sphere(pMid[0], pMid[1], pMid[2], 0.36, 8, 6);
          }
        }
      }
    }
  }

  // Mount static stations + towers + catenary cables
  const stMesh = new THREE.Mesh(staticKit.geometry(), materials?.heroMat);
  stMesh.name = 'cableway-stations-and-towers';
  stMesh.matrixAutoUpdate = false; stMesh.updateMatrix(); stMesh.updateMatrixWorld(true);
  group.add(stMesh);

  const cbMesh = new THREE.Mesh(cableKit.geometry(), materials?.heroMatNoFlood || materials?.heroMat);
  cbMesh.name = 'cableway-cables';
  cbMesh.userData.castShadow = false; // Thin cables avoid shadow acne across the river
  cbMesh.matrixAutoUpdate = false; cbMesh.updateMatrix(); cbMesh.updateMatrixWorld(true);
  group.add(cbMesh);

  // 5. Build TWO Iconic Counterbalanced Red & Cream Animated Aerial Cableway Cabins!
  const bogieGeo = buildBogieGeo();
  const cabinGeo = buildCabinGeo();
  const movingMat = materials?.heroMovingMat || materials?.heroMat;
  const depthMat = materials?.depthMat;

  const cabins = [-1, 1].map((laneSg, idx) => {
    const bogie = new THREE.Mesh(bogieGeo, movingMat);
    bogie.name = `cableway-bogie-${idx}`;
    bogie.userData.moving = true;
    bogie.userData.shadowAdded = true;
    group.add(bogie);

    const cabin = new THREE.Mesh(cabinGeo, movingMat);
    cabin.name = `cableway-cabin-${idx}`;
    cabin.userData.moving = true;
    cabin.userData.shadowAdded = true;
    group.add(cabin);

    let shCabin = null;
    if (depthMat) {
      shCabin = new THREE.Mesh(cabinGeo, depthMat);
      shCabin.layers.enable(1);
      movingGroup.add(shCabin);
    }
    return { laneSg, bogie, cabin, shCabin };
  });

  // Deterministic counterbalanced jig-back animation:
  // Cabin 0 travels North -> South while Cabin 1 travels South -> North, crossing gracefully mid-river!
  // Calibrated so around t = 4..9s Cabin 0 glides prominently right past the Yuzhong North steel lattice
  // tower & Baixiangju (f ≈ 0.24..0.29, s ≈ 290..350m) directly in riverfront & Baixiangju views!
  const sRide0 = sStart + 4.5, sRide1 = sEnd - 4.5;
  const rideSpan = Math.max(20, sRide1 - sRide0);
  const glideTime = Math.max(55, rideSpan / 8.8); // Graceful real cableway glide (~8.8 m/s, ~130s crossing)
  const dwellTime = 8.0;
  const halfCycle = glideTime + dwellTime;
  const fullCycle = halfCycle * 2;
  const initialPhaseSec = Math.max(0, glideTime * 0.335 - 5.5); // At t=5-8s: Cabin 0 squarely beside North Tower & Baixiangju!

  const _qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotNorth);
  const _qPitch = new THREE.Quaternion();
  const _axisZ = new THREE.Vector3(0, 0, 1);

  const update = (_dt, time = 0) => {
    const u = ((time + initialPhaseSec) % fullCycle + fullCycle) % fullCycle;
    let frac;
    if (u < glideTime) {
      const a = u / glideTime;
      frac = a * a * (3 - 2 * a); // Smooth S-curve acceleration/deceleration
    } else if (u < halfCycle) {
      frac = 1;
    } else if (u < halfCycle + glideTime) {
      const a = (u - halfCycle) / glideTime;
      frac = 1 - a * a * (3 - 2 * a);
    } else {
      frac = 0;
    }

    for (let i = 0; i < 2; i++) {
      const cb = cabins[i];
      const f = i === 0 ? frac : (1 - frac); // Counterbalanced opposite directions!
      const s = sRide0 + rideSpan * f;
      const y = cablePath.evalY(s);
      const slope = cablePath.evalSlope(s);
      const zOff = cb.laneSg * cableHalfSep;
      const [wx, wy, wz] = localToWorld(N.x, 0, N.z, ux, uz, s, y, zOff);

      // Bogie carriage pitches cleanly to match the exact local catenary cable tangent!
      _qPitch.setFromAxisAngle(_axisZ, Math.atan(slope));
      cb.bogie.position.set(wx, wy, wz);
      cb.bogie.quaternion.copy(_qYaw).multiply(_qPitch);
      cb.bogie.updateMatrixWorld(true);

      // Pendulum cabin + hanger arm hangs strictly vertical (zero pitch tilt, authentic gravity leveling!)
      cb.cabin.position.set(wx, wy, wz);
      cb.cabin.rotation.set(0, rotNorth, 0);
      cb.cabin.updateMatrixWorld(true);

      if (cb.shCabin) {
        cb.shCabin.position.set(wx, wy, wz);
        cb.shCabin.rotation.set(0, rotNorth, 0);
        cb.shCabin.updateMatrixWorld(true);
      }
    }
  };
  update(0, 0);

  // Mid-river label & station labels
  const midS = (sStart + sEnd) * 0.5;
  const [mwx, , mwz] = localToWorld(N.x, 0, N.z, ux, uz, midS, 0, 0);
  labels.push({ name: '长江索道', x: mwx, y: cablePath.evalY(midS) + 18, z: mwz });
  labels.push({ name: '长江索道北站', x: N.x, y: nInfo.roofY + 12, z: N.z });
  labels.push({ name: '长江索道南站', x: S.x, y: sInfo.roofY + 12, z: S.z });

  return {
    group,
    movingGroup,
    update,
    colliders: { prisms, decks },
    lights,
    labels,
  };
}

export default buildCableway;
