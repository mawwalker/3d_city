// 李子坝轻轨穿楼 (Liziba CRT Line 2 Station) + Elevated Straddle-Beam Monorail Viaduct + Animated CRT Line 2 Trains.
//
// Museum-grade architectural & transit modeling:
//   1. 19-Story Liziba Residential & Station Building:
//      - Cliff retaining base + Floors 1-5 commercial podium arcade + 6 structurally independent giant concrete station piers
//      - Floors 6-8 TRUE 3D hollowed-out open station cavity with visible twin straddle-beams, side platforms,
//        platform screen doors (PSD), overhead glowing LED station ceiling strips, acoustic ceiling baffles,
//        and crisp illuminated Chinese signboard ("李子坝 LIZIBA · CRT LINE 2")
//      - Floors 9-19 detailed Chongqing residential apartments with real 3D recessed window bays (lit at night),
//        protruding 3D balconies with glass/steel railings, louvered AC outdoor unit cages, terracotta accent bands,
//        and sculpted rooftop parapet, elevator penthouse, water tanks & aviation beacon
//   2. Liziba Tourist Viewing Platform (李子坝观景台) directly across Binjiang Rd with walkable granite terrace & pergola
//   3. Elevated Straddle-Beam Concrete Viaduct (单轨高架PC轨道梁) following liziba.spline with sculpted T-piers anchored into DEM
//   4. Two Animated 6-Car Chongqing CRT Line 2 Articulated Monorail Trains (signature emerald-green & silver-white livery,
//      straddle-bogie skirts wrapping over the concrete PC beam, glowing warm interior windows, LED headlights & taillights)
//      gliding smoothly right THROUGH the 6-8F building portal in opposite directions!

import * as THREE from 'three';
import { HeroKit, MAT } from './kit.js';
import {
  PAL, useMat, vAdd, vSub, vScale, vNorm, vLen,
  makeFrame, Spline3D, sweepProfile, chamferRect, steelBeam, localToWorld,
} from './bridgeKit.js';

// Fallback WGS-84-projected local coordinates relative to Jiefangbei (106.573357, 29.560101), waterY = 0
const FALLBACK_LIZIBA = {
  x: -3470,
  z: 495,
  baseY: 22,
  portalY: 44,
  topY: 88,
  angle: 0.24,
  w: 48,
  d: 22,
  h: 66,
  viewpoint: { x: -3482, z: 452, y: 24 },
  spline: [
    [-3820, 40.5, 585],
    [-3710, 41.8, 558],
    [-3600, 43.0, 528],
    [-3520, 43.8, 508],
    [-3470, 44.0, 495],
    [-3410, 44.0, 480],
    [-3320, 43.2, 456],
    [-3210, 41.8, 430],
    [-3090, 40.2, 410],
  ],
};

/** Find closest arc distance s on spline to world (wx, wz). */
function closestArcOnSpline(spline, wx, wz) {
  let bestS = spline.length * 0.5, bestD2 = Infinity;
  const steps = Math.max(80, Math.round(spline.length / 2));
  for (let i = 0; i <= steps; i++) {
    const s = spline.length * (i / steps);
    const f = spline.sampleAt(s);
    const dx = f.p[0] - wx, dz = f.p[2] - wz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestS = s; }
  }
  return bestS;
}

/** Build a macro-detailed articulated CRT Line 2 straddle-beam monorail car (local +x forward, y=0 at top of PC track beam). */
function buildMonorailCarGeo({ isFront = false, isRear = false } = {}) {
  const K = new HeroKit();
  const L = 13.8, hl = L * 0.5;
  const hw = 1.48;         // 2.96m total width
  const skirtBot = -0.94;  // Straddle-bogie skirt wraps 0.94m DOWN around both sides of the concrete PC beam!
  const floorY = 0.22;
  const winBot = 1.14, winTop = 2.30, roofY = 2.94;
  const bodyLen = (isFront || isRear) ? L - 1.6 : L;
  const bx = isFront ? -0.80 : isRear ? 0.80 : 0;

  // 1. Detailed Straddle-Bogie Side Skirts (hugging the concrete PC beam on ±Z sides, visible guide-wheel recesses!)
  K.style([0.74, 0.77, 0.78], 0.34, 0.32, 0, MAT.PLAIN);
  for (const sg of [-1, 1]) {
    // Upper beveled body-to-skirt sill + lower skirt fairing panels wrapping around concrete beam
    K.box(bx, (skirtBot + floorY) * 0.5, sg * (hw - 0.14), bodyLen - 0.25, floorY - skirtBot, 0.28);
    // Dark skirt rubber trim rail strictly BELOW skirt bottom (skirtBot-0.10 .. skirtBot -> ZERO coplanar bottom!)
    K.style([0.11, 0.12, 0.13], 0.78, 0.15, 0, MAT.PLAIN);
    K.box(bx, skirtBot - 0.05, sg * (hw - 0.14), bodyLen - 0.35, 0.10, 0.38);
    // Recessed dark wheel-bogie maintenance louver vents & visible guide-wheel fender housings
    K.style([0.14, 0.16, 0.18], 0.55, 0.65, 0, MAT.LOUVER, 0.11);
    for (const wx of [-bodyLen * 0.31, bodyLen * 0.31]) {
      K.box(bx + wx, skirtBot + 0.48, sg * (hw + 0.045), 2.95, 0.64, 0.06);
      // Inner bogie suspension frame & rubber guide-wheel drum tucked behind skirt
      K.style([0.08, 0.08, 0.09], 0.88, 0.10, 0, MAT.PLAIN);
      K.tube([bx + wx - 0.85, skirtBot + 0.32, sg * 0.62], [bx + wx - 0.85, skirtBot + 0.62, sg * 0.62], 0.34, 0.34, 10, true);
      K.tube([bx + wx + 0.85, skirtBot + 0.32, sg * 0.62], [bx + wx + 0.85, skirtBot + 0.62, sg * 0.62], 0.34, 0.34, 10, true);
      K.style([0.14, 0.16, 0.18], 0.55, 0.65, 0, MAT.LOUVER, 0.11);
    }
    // Recessed inspection panel seam bars along skirt
    K.style([0.28, 0.30, 0.32], 0.50, 0.45, 0, MAT.PLAIN);
    for (const px of [-bodyLen * 0.44, -bodyLen * 0.14, bodyLen * 0.14, bodyLen * 0.44]) {
      K.box(bx + px, skirtBot + 0.52, sg * (hw + 0.006), 0.04, 0.88, 0.03);
    }
    K.style([0.74, 0.77, 0.78], 0.34, 0.32, 0, MAT.PLAIN);
  }
  // Underside floor bulkhead plate right above the PC beam top
  K.style([0.14, 0.15, 0.17], 0.76, 0.45, 0, MAT.PLAIN);
  K.box(bx, floorY - 0.06, 0, bodyLen, 0.18, hw * 2 - 0.1);

  // 2. Sleek Pearl-White / Brushed-Silver Cabin Body with sculpted upper cantrail bevel
  K.style([0.86, 0.88, 0.88], 0.26, 0.38, 0, MAT.PLAIN);
  K.box(bx, (floorY + winBot) * 0.5, 0, bodyLen, winBot - floorY, hw * 2);
  K.box(bx, (winTop + roofY) * 0.5, 0, bodyLen, roofY - winTop, hw * 1.92);
  // Crowned aerodynamic aluminum roof deck + side drip gutter rails
  K.box(bx, roofY + 0.12, 0, bodyLen - 0.15, 0.24, hw * 1.66);
  K.style([0.55, 0.58, 0.60], 0.38, 0.65, 0, MAT.PLAIN);
  for (const sg of [-1, 1]) K.box(bx, roofY + 0.02, sg * (hw * 0.94), bodyLen - 0.1, 0.07, 0.08);

  // 3. Signature CRT Line 2 Vivid Emerald-Green + Lime-Green Livery Bands!
  K.style([0.07, 0.54, 0.24], 0.30, 0.18, -0.35, MAT.PLAIN);
  for (const sg of [-1, 1]) {
    K.box(bx, floorY + 0.48, sg * (hw + 0.025), bodyLen, 0.44, 0.04);
    K.style([0.36, 0.84, 0.28], 0.28, 0.14, -0.55, MAT.PLAIN);
    K.box(bx, floorY + 0.78, sg * (hw + 0.028), bodyLen, 0.13, 0.04);
    K.style([0.07, 0.54, 0.24], 0.30, 0.18, -0.35, MAT.PLAIN);
    K.box(bx, roofY - 0.18, sg * (hw * 0.96 + 0.02), bodyLen, 0.22, 0.04);
  }

  // 4. Flush Panoramic Window Band with Dark Rubber Gasket Seals, Warm Lit Cabin & Double Sliding Doors!
  K.style([0.035, 0.045, 0.055], 0.22, 0.10, 0, MAT.PLAIN, 0, 0.92);
  K.box(bx, (winBot + winTop) * 0.5, 0, bodyLen - 0.06, winTop - winBot, hw * 1.98);
  // Warm brightly lit passenger window panes with visible interior seat backs & ceiling glow
  const nWin = 5;
  for (let w = 0; w < nWin; w++) {
    const wx = bx - bodyLen * 0.42 + (w + 0.5) * (bodyLen * 0.84 / nWin);
    const wPane = bodyLen * 0.138;
    for (const sg of [-1, 1]) {
      // Dark rubber window gasket surround (>= 5cm proud of window band!)
      K.style([0.05, 0.055, 0.06], 0.65, 0.05, 0, MAT.PLAIN);
      K.box(wx, (winBot + winTop) * 0.5, sg * (hw + 0.04), wPane + 0.10, winTop - winBot - 0.08, 0.05);
      // Reflective warm-lit window glazing (>= 5cm proud of gasket!)
      K.style([0.98, 0.88, 0.66], 0.08, 0.05, -4.6, MAT.PLAIN, 0, 0.94);
      K.box(wx, (winBot + winTop) * 0.5, sg * (hw + 0.09), wPane, winTop - winBot - 0.18, 0.05);
    }
  }
  // Double-leaf sliding passenger doors (2 per side): crisp vertical rubber center seal, recessed door frames & LED door indicator lamps!
  for (const dx of [-bodyLen * 0.24, bodyLen * 0.24]) {
    for (const sg of [-1, 1]) {
      K.style([0.12, 0.13, 0.14], 0.72, 0.10, 0, MAT.PLAIN);
      K.box(bx + dx, (floorY + winTop) * 0.5, sg * (hw + 0.022), 0.045, winTop - floorY - 0.08, 0.04); // center rubber door seam
      K.style([0.74, 0.76, 0.78], 0.32, 0.55, 0, MAT.PLAIN);
      K.box(bx + dx - 0.66, (floorY + winTop) * 0.5, sg * (hw + 0.020), 0.04, winTop - floorY - 0.08, 0.03);
      K.box(bx + dx + 0.66, (floorY + winTop) * 0.5, sg * (hw + 0.020), 0.04, winTop - floorY - 0.08, 0.03);
      // Red/green LED door-status indicator above door header
      K.style([1.0, 0.26, 0.12], 0.20, 0, -5.0, MAT.LANTERN);
      K.box(bx + dx, winTop + 0.14, sg * (hw + 0.024), 0.18, 0.07, 0.04);
    }
  }

  // 5. Sculpted Multi-Part Aerodynamic Driver Cab Nose (Front / Rear end cars)
  if (isFront || isRear) {
    const sg = isFront ? 1 : -1;
    const xBase = bx + sg * (bodyLen * 0.5);
    // Stepped aerodynamic fiberglass nose fairing
    K.style([0.86, 0.88, 0.88], 0.22, 0.35, 0, MAT.PLAIN);
    K.box(xBase + sg * 0.76, (floorY + winBot) * 0.5 + 0.04, 0, 1.56, winBot - floorY + 0.08, hw * 1.84);
    K.box(xBase + sg * 0.60, (winTop + roofY) * 0.5, 0, 1.24, roofY - winTop, hw * 1.72);
    // Emerald green & lime chevron bumper fairing + recessed emergency coupler hatch
    K.style([0.07, 0.54, 0.24], 0.30, 0.16, -0.35, MAT.PLAIN);
    K.box(xBase + sg * 1.52, floorY + 0.42, 0, 0.14, 0.54, hw * 1.78);
    K.style([0.12, 0.13, 0.14], 0.62, 0.55, 0, MAT.PLAIN);
    K.box(xBase + sg * 1.54, floorY + 0.16, 0, 0.14, 0.24, 0.86);
    // Wrap-around dark panoramic cab windshield + rubber bezel + twin 3D windshield wipers!
    K.style([0.025, 0.04, 0.06], 0.05, 0.12, -0.5, MAT.PLAIN, 0, 0.96);
    K.box(xBase + sg * 0.82, (winBot + winTop) * 0.5 + 0.04, 0, 1.32, winTop - winBot + 0.08, hw * 1.78);
    // Twin 3D dark steel windshield wiper arms across front glass
    K.style([0.08, 0.08, 0.09], 0.45, 0.70, 0, MAT.PLAIN);
    for (const wz of [-0.46, 0.46]) {
      steelBeam(K, [xBase + sg * 1.50, winBot + 0.08, wz], [xBase + sg * 1.48, winBot + 0.74, wz + 0.24], 0.035, 0.04);
    }
    // Recessed glowing amber LED destination dot-matrix display ("2 较场口 / 李子坝")
    K.style([0.06, 0.06, 0.07], 0.40, 0.20, 0, MAT.PLAIN);
    K.box(xBase + sg * 1.25, winTop + 0.24, 0, 0.12, 0.34, 1.52);
    K.style([1.0, 0.68, 0.12], 0.18, 0, -9.5, MAT.LANTERN);
    K.box(xBase + sg * 1.30, winTop + 0.24, 0, 0.06, 0.22, 1.36);
    // Recessed dual LED headlight / ruby taillight pods with dark molded housings (>= 5cm step proud of nose bumper!)
    for (const zsg of [-1, 1]) {
      K.style([0.08, 0.09, 0.10], 0.35, 0.55, 0, MAT.PLAIN);
      K.box(xBase + sg * 1.63, floorY + 0.62, zsg * 0.88, 0.10, 0.34, 0.56);
      if (isFront) {
        K.style([1.0, 0.97, 0.88], 0.12, 0, -26.0, MAT.LANTERN);
        K.box(xBase + sg * 1.71, floorY + 0.62, zsg * 0.88, 0.06, 0.20, 0.42);
      } else {
        K.style([1.0, 0.08, 0.05], 0.16, 0, -20.0, MAT.LANTERN);
        K.box(xBase + sg * 1.71, floorY + 0.62, zsg * 0.88, 0.06, 0.20, 0.42);
      }
    }
    // Straddle nose skirt
    K.style([0.74, 0.77, 0.78], 0.34, 0.30, 0, MAT.PLAIN);
    for (const zsg of [-1, 1]) K.box(xBase + sg * 0.62, (skirtBot + floorY) * 0.5, zsg * (hw - 0.18), 1.28, floorY - skirtBot, 0.28);
  }

  // 6. Multi-Part Rooftop HVAC Shrouds (fan grilles + roof cable trays + antennas) & Ribbed Accordion Gangway Bellows
  for (const ax of [-bodyLen * 0.25, bodyLen * 0.25]) {
    K.style([0.66, 0.68, 0.70], 0.42, 0.35, 0, MAT.PLAIN);
    K.box(bx + ax, roofY + 0.36, 0, 3.3, 0.32, 1.88);
    K.style([0.22, 0.24, 0.26], 0.52, 0.60, 0, MAT.LOUVER, 0.12);
    K.box(bx + ax, roofY + 0.54, 0, 2.6, 0.08, 1.42);
  }
  K.style([0.45, 0.47, 0.49], 0.45, 0.65, 0, MAT.PLAIN);
  K.box(bx, roofY + 0.28, 0, bodyLen - 0.5, 0.08, 0.36); // Longitudinal roof cable tray
  // Ribbed black accordion gangway bellows between cars
  K.style([0.08, 0.085, 0.09], 0.86, 0, 0, MAT.PLAIN);
  for (const endX of [!isFront ? hl + 0.15 : null, !isRear ? -hl - 0.15 : null]) {
    if (endX === null) continue;
    for (const dr of [-0.14, 0, 0.14]) {
      K.box(endX + dr, (floorY + roofY) * 0.5, 0, 0.11, roofY - floorY - 0.30, hw * 1.66);
    }
  }

  return K.geometry();
}

// ---------------------------------------------------------------------------
// 19-Story Liziba Residential Building with TRUE Hollowed-Out 6-8F Station Portal
// Local frame: +x along track/building length (W=48m), +y up (origin at y=0 world datum),
//              +z perpendicular toward cliff or river (determined from viewpoint side!).
// ---------------------------------------------------------------------------
function buildLizibaBuilding(K, {
  W, D, baseY, portalFloorY, portalRoofY, topY,
  riverSign, // +1 if river/viewpoint is at +z in building frame, -1 if at -z
  outLights,
  bOrigin, ux, uz,
}) {
  const hw = W * 0.5, hd = D * 0.5;
  const plinthBot = baseY - 12.0; // Deep sandstone retaining wall into hillside

  // -----------------------------------------------------------------------
  // A. Cliff Retaining Wall Plinth (below baseY)
  // -----------------------------------------------------------------------
  useMat(K, PAL.sandstone);
  K.box(0, (plinthBot + baseY) * 0.5, 0, W + 2.4, baseY - plinthBot, D + 2.4);
  useMat(K, PAL.graniteWarm);
  K.box(0, baseY + 0.25, 0, W + 2.8, 0.5, D + 2.8);

  // -----------------------------------------------------------------------
  // B. Floors 1-5 Commercial Podium + Structurally Independent Giant Station Columns
  //    (baseY -> portalFloorY - 1.6m)
  // -----------------------------------------------------------------------
  const podTop = portalFloorY - 1.6;
  const podH = Math.max(8.0, podTop - baseY);
  const nPodFloors = Math.max(3, Math.round(podH / 3.8));
  const podFH = podH / nPodFloors;

  // Main commercial podium core (recessed slightly on riverfront side to showcase the giant independent station piers!)
  const podRecess = 2.4;
  const podZ = -riverSign * (podRecess * 0.5);
  const podD = D - podRecess;
  useMat(K, PAL.ochreTile);
  K.box(0, baseY + podH * 0.5, podZ, W - 0.4, podH, podD);

  // Commercial podium floor slabs, real 3D framed storefront glass bays (sampling tInteriorsArr!), doors, awnings & pilasters
  const nPodBays = 9;
  const bayW = (W - 2.0) / nPodBays;
  const zFrontPod = podZ + riverSign * (podD * 0.5);
  const SHOP_SIGNS = [[0.68, 0.14, 0.10], [0.10, 0.42, 0.24], [0.76, 0.46, 0.12], [0.16, 0.28, 0.52]];
  for (let f = 0; f < nPodFloors; f++) {
    const yf = baseY + f * podFH;
    // Horizontal concrete slab cornice band
    useMat(K, PAL.concLight);
    K.box(0, yf + podFH - 0.22, podZ, W + 0.6, 0.45, podD + 0.6);
    // Framed commercial storefront windows along riverfront face (MAT.GLASS picks up 3D parallax rooms & Fresnel!)
    for (let k = 0; k < nPodBays; k++) {
      const bx = -hw + 1.0 + (k + 0.5) * bayW;
      const gW = bayW - 0.85, gH = podFH - 0.95, gY = yf + podFH * 0.48;
      useMat(K, PAL.glassDark);
      K.box(bx, gY, zFrontPod + riverSign * 0.08, gW, gH, 0.16);
      // 3D dark aluminum window mullions & upper transom bar
      useMat(K, PAL.steelDark);
      K.box(bx, gY + gH * 0.26, zFrontPod + riverSign * 0.16, gW + 0.06, 0.09, 0.16);
      K.box(bx - gW * 0.24, gY, zFrontPod + riverSign * 0.16, 0.09, gH, 0.16);
      K.box(bx + gW * 0.24, gY, zFrontPod + riverSign * 0.16, 0.09, gH, 0.16);
      // Ground-floor recessed double entrance door handles, granite threshold step & Chongqing shop fascia signboard
      if (f === 0) {
        useMat(K, PAL.steelSilver);
        K.box(bx - 0.14, yf + 1.15, zFrontPod + riverSign * 0.22, 0.05, 0.65, 0.08);
        K.box(bx + 0.14, yf + 1.15, zFrontPod + riverSign * 0.22, 0.05, 0.65, 0.08);
        useMat(K, PAL.graniteWarm);
        K.box(bx, yf + 0.14, zFrontPod + riverSign * 0.48, bayW - 0.55, 0.28, 0.85);
        const sc = SHOP_SIGNS[k % SHOP_SIGNS.length];
        K.style(sc, 0.36, 0.12, -1.2, MAT.PLAIN);
        K.box(bx, yf + podFH - 0.16, zFrontPod + riverSign * 0.32, bayW - 0.72, 0.56, 0.18);
      }
      // Shopfront canopy awning on 1st & 2nd floor
      if (f <= 1) {
        useMat(K, f === 0 ? PAL.coralAccent : PAL.steelDark);
        K.box(bx, yf + podFH - 0.48, zFrontPod + riverSign * 0.85, bayW - 0.25, 0.22, 1.55);
      }
    }
  }
  // Vertical pilasters framing commercial facade
  useMat(K, PAL.concLight);
  for (let k = 0; k <= nPodBays; k++) {
    const bx = -hw + 1.0 + k * bayW;
    K.box(bx, baseY + podH * 0.5, zFrontPod + riverSign * 0.16, 0.55, podH, 0.42);
  }

  // REAL-LIFE ENGINEERING DETAIL: 6 Structurally Independent Massive Concrete Station Support Piers
  // standing proudly in front of the commercial podium, carrying the acoustic isolation slab of floors 6-8!
  useMat(K, PAL.concPylon);
  const zPierFront = riverSign * (hd - 0.9);
  for (let k = 0; k < 6; k++) {
    const px = -hw + 3.2 + k * ((W - 6.4) / 5);
    K.box(px, baseY + podH * 0.5, zPierFront, 1.75, podH, 1.85);
    // Flared acoustic transfer capital at top of each station column
    K.box(px, podTop - 0.4, zPierFront - riverSign * 0.6, 2.3, 1.2, 3.2);
  }
  // Heavy independent concrete acoustic transfer deck slab directly beneath the 6F station
  useMat(K, PAL.concViaduct);
  K.box(0, portalFloorY - 0.80, 0, W + 1.2, 1.65, D + 1.2);
  // Crisp illuminated architectural highlight under the station soffit overhang
  useMat(K, PAL.ledGold);
  K.box(0, portalFloorY - 1.65, riverSign * (hd + 0.55), W + 0.8, 0.18, 0.18);

  // -----------------------------------------------------------------------
  // C. Floors 6-8 TRUE 3D HOLLOWED-OUT OPEN MONORAIL STATION CAVITY!
  //    Train tracks run straight through X = -hw .. +hw along z = ±2.15m!
  //    Center corridor z ∈ [-4.9, +4.9] is 100% OPEN THROUGH THE BUILDING!
  // -----------------------------------------------------------------------
  const cavH = portalRoofY - portalFloorY;
  const trackHalfClear = 4.9; // Open central train tunnel channel (9.8m wide!)
  const sideWallD = Math.max(3.6, hd - trackHalfClear);

  // 1. Solid outer side-station halls flanking the open central train tunnel (+z and -z sides)
  for (const sg of [-1, 1]) {
    const zSideCenter = sg * (trackHalfClear + sideWallD * 0.5);
    // Concrete structural side walls & station concourse enclosure
    useMat(K, PAL.creamWall);
    K.box(0, portalFloorY + cavH * 0.5, zSideCenter, W, cavH, sideWallD);

    // On the riverfront outer face (+riverSign), add iconic LARGE PANORAMIC STATION WINDOWS
    // so tourists on the viewing platform see the brightly lit station concourse inside!
    const zOutFace = sg * hd;
    if (sg === riverSign) {
      const swH = cavH * 0.56, swY = portalFloorY + cavH * 0.52;
      for (let k = 0; k < 8; k++) {
        const wx = -hw + 2.8 + (k + 0.5) * ((W - 5.6) / 8);
        useMat(K, PAL.glassLitWarm);
        K.box(wx, swY, zOutFace + sg * 0.08, 4.4, swH, 0.16);
        // 3D dark steel curtain-wall mullions & transom framing each station concourse window
        useMat(K, PAL.steelDark);
        K.box(wx - 2.2, swY, zOutFace + sg * 0.18, 0.14, swH + 0.12, 0.22);
        K.box(wx + 2.2, swY, zOutFace + sg * 0.18, 0.14, swH + 0.12, 0.22);
        K.box(wx - 0.72, swY, zOutFace + sg * 0.16, 0.09, swH, 0.16);
        K.box(wx + 0.72, swY, zOutFace + sg * 0.16, 0.09, swH, 0.16);
        K.box(wx, swY + swH * 0.22, zOutFace + sg * 0.16, 4.4, 0.10, 0.16);
      }
      // Architectural horizontal steel sunshade louvers framing the station viewing windows
      useMat(K, PAL.steelDark);
      K.box(0, portalFloorY + cavH * 0.82, zOutFace + sg * 0.25, W + 0.2, 0.35, 0.45);
      K.box(0, portalFloorY + cavH * 0.20, zOutFace + sg * 0.25, W + 0.2, 0.35, 0.45);
    }

    // INSIDE THE OPEN STATION TUNNEL: Passenger Side Platforms + Platform Screen Doors (PSD)!
    const zPlatEdge = sg * (trackHalfClear - 0.15);
    const zPlatBack = sg * (trackHalfClear + 1.4);
    // Raised concrete passenger platform deck
    useMat(K, PAL.graniteWarm);
    K.box(0, portalFloorY + 0.95, (zPlatEdge + zPlatBack) * 0.5, W - 1.2, 1.85, 1.8);
    // Bright yellow tactile platform safety line along platform edge
    useMat(K, PAL.laneYellow);
    K.box(0, portalFloorY + 1.90, zPlatEdge - sg * 0.18, W - 1.4, 0.06, 0.22);
    // Stainless-steel & glass half-height Platform Screen Doors (PSD)
    useMat(K, PAL.steelSilver);
    K.box(0, portalFloorY + 3.20, zPlatEdge - sg * 0.05, W - 2.0, 0.12, 0.14); // top PSD rail
    for (let p = 0; p <= 12; p++) {
      const px = -hw + 2.0 + p * ((W - 4.0) / 12);
      K.box(px, portalFloorY + 2.60, zPlatEdge - sg * 0.05, 0.14, 1.35, 0.14);
    }
    useMat(K, PAL.glassPlain);
    K.box(0, portalFloorY + 2.60, zPlatEdge - sg * 0.05, W - 2.4, 1.15, 0.06);
    // Glowing emerald CRT Line 2 route strip running along interior station wall above PSD
    useMat(K, PAL.ledGreen);
    K.box(0, portalFloorY + 4.35, zPlatEdge + sg * 0.16, W - 2.4, 0.28, 0.08);
  }

  // 2. Sculpted Deep Portal Entry Frames (on BOTH x = -hw and x = +hw train mouths!)
  for (const xsg of [-1, 1]) {
    const xFace = xsg * (hw + 0.55);
    // Heavy chamfered concrete portal surround + acoustic hood overhang projecting 1.4m
    useMat(K, PAL.concLight);
    K.box(xFace, portalRoofY - 0.55, 0, 1.8, 1.35, trackHalfClear * 2 + 2.8); // lintel hood
    for (const zsg of [-1, 1]) {
      K.box(xFace, portalFloorY + cavH * 0.5, zsg * (trackHalfClear + 0.65), 1.8, cavH, 1.4); // portal jambs
    }
    // Acoustic rib fins lining the portal mouth
    useMat(K, PAL.louverMetal);
    K.box(xFace - xsg * 0.4, portalRoofY - 1.35, 0, 1.0, 0.45, trackHalfClear * 2 - 0.4);
    // Crisp glowing white/green LED arch outline framing the train portal mouth at night!
    useMat(K, PAL.ledGreen);
    K.box(xFace + xsg * 0.92, portalRoofY - 0.55, 0, 0.12, 0.24, trackHalfClear * 2 + 1.8);
  }

  // 3. Station Interior Coffered Ceiling & Bright Glowing Overhead LED Light Strips!
  useMat(K, PAL.concLight);
  K.box(0, portalRoofY + 0.75, 0, W + 1.0, 1.55, D + 1.0); // Heavy transfer slab carrying floors 9-19!
  // Interior acoustic ceiling transverse beams + luminous white LED light banks
  for (let k = 0; k < 7; k++) {
    const lx = -hw + 4.0 + k * ((W - 8.0) / 6);
    useMat(K, PAL.concPier);
    K.box(lx, portalRoofY - 0.35, 0, 0.75, 0.65, trackHalfClear * 2);
    useMat(K, PAL.ledWhite);
    K.box(lx + 1.8, portalRoofY - 0.18, 0, 2.2, 0.14, 1.8);
    // Emit bright warm-white local station lights right inside the hollowed-out tunnel!
    if (k === 1 || k === 3 || k === 5) {
      const [wx, wy, wz] = localToWorld(bOrigin[0], 0, bOrigin[2], ux, uz, lx, portalRoofY - 1.2, 0);
      outLights.push({ x: wx, y: wy, z: wz, radius: 28, r: 1.0, g: 0.94, b: 0.80, intensity: 950 });
    }
  }

  // -----------------------------------------------------------------------
  // D. Floors 9-19 Detailed Chongqing 11-Story Residential Tower
  //    (Real 3D protruding balconies, railings, recessed windows, AC cages, terracotta stripes!)
  // -----------------------------------------------------------------------
  const resStartY = portalRoofY + 1.50;
  const resH = Math.max(30.0, topY - resStartY);
  const nResFloors = 11;
  const fH = resH / nResFloors;

  // Main warm cream/ochre concrete tower core (slightly recessed so balconies & pilasters protrude crisply!)
  useMat(K, PAL.creamWall);
  K.box(0, resStartY + resH * 0.5, 0, W - 0.8, resH, D - 0.8);

  // Deterministic lived-in Chongqing residential clutter colors (subtle laundry & planters)
  const LAUNDRY_COLS = [[0.78, 0.80, 0.82], [0.24, 0.38, 0.56], [0.68, 0.32, 0.28], [0.76, 0.70, 0.54]];

  // Vertical terracotta/coral architectural shear-wall fins framing apartment bays on front & back
  const nBaysX = Math.max(7, Math.round((W - 2.4) / 5.5));
  const bSpanX = (W - 2.4) / nBaysX;
  for (let f = 0; f < nResFloors; f++) {
    const yf = resStartY + f * fH;
    // Continuous subtle floor stringcourse slab molding
    useMat(K, PAL.concLight);
    K.box(0, yf + 0.12, 0, W - 0.2, 0.24, D - 0.2);

    // Front (+z) and Back (-z) facades: deep 3D perimeter window frames, balconies, AC piping, laundry & potted greenery!
    for (const sg of [-1, 1]) {
      const zWall = sg * (D * 0.5 - 0.4);
      for (let k = 0; k < nBaysX; k++) {
        const bx = -hw + 1.2 + (k + 0.5) * bSpanX;
        const hasBalcony = (k % 2 === 0 || k === nBaysX - 1);
        const hSeed = (f * 17 + k * 31 + (sg > 0 ? 5 : 13)) % 23;
        const winW = bSpanX - 1.18, winH = fH * 0.62, winY = yf + fH * 0.54;

        // Deep 3D window frame (clean >= 5cm tiers: wall -> glassDark [+0.05..+0.13] -> steelDark mullions [+0.13..+0.21]!)
        useMat(K, PAL.glassDark);
        K.box(bx, winY, zWall + sg * 0.09, winW - 0.12, winH - 0.12, 0.08);
        useMat(K, PAL.steelDark);
        K.box(bx - winW * 0.48, winY, zWall + sg * 0.17, 0.10, winH, 0.08);
        K.box(bx + winW * 0.48, winY, zWall + sg * 0.17, 0.10, winH, 0.08);
        K.box(bx, winY, zWall + sg * 0.17, 0.08, winH, 0.08);              // vertical center mullion
        K.box(bx, winY + winH * 0.24, zWall + sg * 0.17, winW, 0.07, 0.08); // upper transom bar
        // Projecting beveled concrete window sill & eyebrow drip hood
        useMat(K, PAL.concLight);
        K.box(bx, yf + fH * 0.21, zWall + sg * 0.24, bSpanX - 0.92, 0.15, 0.40);
        K.box(bx, yf + fH * 0.87, zWall + sg * 0.22, bSpanX - 0.92, 0.15, 0.36);

        if (hasBalcony) {
          const balD = 1.48, balW = bSpanX - 0.85;
          const zBal = zWall + sg * (balD * 0.5);
          useMat(K, PAL.concLight);
          K.box(bx, yf + 0.14, zBal, balW, 0.26, balD);
          // Coral privacy wing wall strictly ABOVE slab & inset >= 8cm from slab side/front edges (ZERO Z-fighting!)
          const divH = fH * 0.72 - 0.28;
          useMat(K, PAL.coralAccent);
          K.box(bx - balW * 0.44, yf + 0.28 + divH * 0.5, zWall + sg * ((balD - 0.22) * 0.5), 0.18, divH, balD - 0.22);
          // Cream parapet wall inset from slab front & seated strictly on slab top (yf + 0.27)
          useMat(K, PAL.creamWall);
          K.box(bx, yf + 0.50, zWall + sg * (balD - 0.14), balW - 0.12, 0.46, 0.16);
          useMat(K, PAL.glassPlain);
          K.box(bx, yf + 0.94, zWall + sg * (balD - 0.14), balW - 0.25, 0.42, 0.06);
          useMat(K, PAL.steelSilver);
          K.box(bx, yf + 1.19, zWall + sg * (balD - 0.14), balW + 0.04, 0.07, 0.08);
          for (const esg of [-1, 1]) K.box(bx + esg * (balW * 0.48), yf + 1.19, zWall + sg * ((balD - 0.14) * 0.5), 0.08, 0.07, balD - 0.14);

          // Authentic lived-in Chongqing balcony clutter: terracotta planter box + trimmed foliage OR hanging laundry!
          if (hSeed % 3 === 0) {
            useMat(K, PAL.coralAccent);
            K.box(bx + balW * 0.24, yf + 0.48, zWall + sg * (balD - 0.36), 0.76, 0.32, 0.34);
            useMat(K, PAL.foliageDeep);
            K.box(bx + balW * 0.24, yf + 0.72, zWall + sg * (balD - 0.36), 0.64, 0.22, 0.26);
          }
          if (hSeed % 4 === 1) {
            // Subtle balcony clothesline rod + hanging laundry garments
            useMat(K, PAL.steelSilver);
            K.box(bx, yf + fH * 0.74, zWall + sg * (balD - 0.42), balW * 0.72, 0.04, 0.04);
            const lc = LAUNDRY_COLS[hSeed % LAUNDRY_COLS.length];
            K.style(lc, 0.85, 0, 0, MAT.PLAIN);
            K.box(bx - 0.35, yf + fH * 0.56, zWall + sg * (balD - 0.42), 0.52, 0.78, 0.06);
            K.box(bx + 0.32, yf + fH * 0.58, zWall + sg * (balD - 0.42), 0.44, 0.68, 0.06);
          }
        } else {
          // Multi-part AC Outdoor Unit (louvered casing + dark circular fan opening + L-brackets + insulated wall conduit pipe!)
          const acX = bx + bSpanX * 0.34;
          useMat(K, PAL.louverMetal);
          K.box(acX, yf + 0.76, zWall + sg * 0.38, 1.02, 0.82, 0.58);
          useMat(K, PAL.steelDark);
          K.box(acX - 0.14, yf + 0.76, zWall + sg * 0.72, 0.52, 0.52, 0.06); // fan grille cutout (>= 5cm proud!)
          K.box(acX - 0.34, yf + 0.32, zWall + sg * 0.34, 0.07, 0.10, 0.62); // steel L-brackets
          K.box(acX + 0.34, yf + 0.32, zWall + sg * 0.34, 0.07, 0.10, 0.62);
          useMat(K, PAL.concBarrier);
          K.tube([acX + 0.48, yf + 0.62, zWall + sg * 0.24], [acX + 0.62, yf + 1.05, zWall + sg * 0.12], 0.045, 0.045, 5, false);
          // Occasional stainless-steel anti-theft security grille (防盗网) on older bays
          if (hSeed % 5 === 0) {
            useMat(K, PAL.steelSilver);
            for (let g = -2; g <= 2; g++) K.box(bx + g * 0.42, winY, zWall + sg * 0.32, 0.03, winH, 0.03);
            K.box(bx, winY, zWall + sg * 0.32, winW * 0.88, 0.03, 0.03);
          }
        }
      }
    }

    // East & West End Facades (directly above the train entry portals — prominently viewed from Liziba Viewing Platform!)
    for (const xsg of [-1, 1]) {
      const xWall = xsg * (hw - 0.4);
      const nEndBays = 3;
      const endBayW = (D - 4.4) / nEndBays;
      for (let m = 0; m < nEndBays; m++) {
        const bz = -hd + 2.2 + (m + 0.5) * endBayW;
        const eSeed = (f * 11 + m * 7 + (xsg > 0 ? 3 : 1)) % 17;
        const winW = endBayW - 1.10, winH = fH * 0.62, winY = yf + fH * 0.54;
        // Deep 3D window frame (clean >= 5cm tiers: wall -> glassDark [+0.05..+0.13] -> steelDark mullions [+0.13..+0.21]!)
        useMat(K, PAL.glassDark);
        K.box(xWall + xsg * 0.09, winY, bz, 0.08, winH - 0.10, winW - 0.10);
        useMat(K, PAL.steelDark);
        K.box(xWall + xsg * 0.17, winY, bz - winW * 0.48, 0.08, winH, 0.10);
        K.box(xWall + xsg * 0.17, winY, bz + winW * 0.48, 0.08, winH, 0.10);
        K.box(xWall + xsg * 0.17, winY, bz, 0.08, winH, 0.08);
        K.box(xWall + xsg * 0.17, winY + winH * 0.24, bz, 0.08, 0.07, winW);
        // Projecting horizontal concrete window sill & lintel eyebrow hood
        useMat(K, PAL.concLight);
        K.box(xWall + xsg * 0.24, yf + fH * 0.22, bz, 0.42, 0.14, endBayW - 0.85);
        K.box(xWall + xsg * 0.22, yf + fH * 0.86, bz, 0.38, 0.14, endBayW - 0.85);

        // Real 3D Protruding Balconies on ALL 3 bays (strict non-overlapping slab/divider/parapet -> ZERO Z-fighting!)
        const balD = m === 1 ? 1.55 : 1.28;
        const balW = endBayW - 0.85;
        const xBal = xWall + xsg * (balD * 0.5);
        useMat(K, PAL.concLight);
        K.box(xBal, yf + 0.14, bz, balD, 0.26, balW);
        const divH = fH * 0.74 - 0.28;
        useMat(K, PAL.coralAccent);
        K.box(xWall + xsg * ((balD - 0.22) * 0.5), yf + 0.28 + divH * 0.5, bz - balW * 0.44, balD - 0.22, divH, 0.18);
        useMat(K, PAL.creamWall);
        K.box(xWall + xsg * (balD - 0.14), yf + 0.50, bz, 0.16, 0.46, balW - 0.12);
        useMat(K, PAL.glassPlain);
        K.box(xWall + xsg * (balD - 0.14), yf + 0.94, bz, 0.06, 0.42, balW - 0.24);
        useMat(K, PAL.steelSilver);
        K.box(xWall + xsg * (balD - 0.14), yf + 1.19, bz, 0.08, 0.07, balW + 0.04);
        for (const esg of [-1, 1]) K.box(xWall + xsg * ((balD - 0.14) * 0.5), yf + 1.19, bz + esg * (balW * 0.48), balD - 0.14, 0.07, 0.08);
        // Lived-in terracotta planter boxes & subtle laundry on end-wall balconies facing the viewing platform!
        if (eSeed % 3 === 0) {
          useMat(K, PAL.coralAccent);
          K.box(xWall + xsg * (balD - 0.36), yf + 0.48, bz + balW * 0.22, 0.34, 0.32, 0.72);
          useMat(K, PAL.foliageDeep);
          K.box(xWall + xsg * (balD - 0.36), yf + 0.72, bz + balW * 0.22, 0.26, 0.22, 0.60);
        }
        if (eSeed % 4 === 2) {
          const lc = LAUNDRY_COLS[eSeed % LAUNDRY_COLS.length];
          K.style(lc, 0.85, 0, 0, MAT.PLAIN);
          K.box(xWall + xsg * (balD - 0.40), yf + fH * 0.56, bz - 0.35, 0.06, 0.72, 0.52);
          K.box(xWall + xsg * (balD - 0.40), yf + fH * 0.58, bz + 0.30, 0.06, 0.64, 0.44);
        }
        // Multi-part 3D AC Outdoor Unit + fan grille + conduit pipe beside outer bays
        if (m !== 1) {
          const acZ = bz + (m === 0 ? -1 : 1) * (balW * 0.5 + 0.46);
          useMat(K, PAL.louverMetal);
          K.box(xWall + xsg * 0.42, yf + 0.76, acZ, 0.62, 0.84, 0.92);
          useMat(K, PAL.steelDark);
          K.box(xWall + xsg * 0.78, yf + 0.76, acZ, 0.06, 0.50, 0.50);
          useMat(K, PAL.concLight);
          K.box(xWall + xsg * 0.42, yf + 0.28, acZ, 0.76, 0.12, 1.02);
        }
      }
    }
  }

  // Continuous vertical exterior PVC facade drainpipes (落水管) with dark steel pipe-clamp collars!
  for (const xsg of [-1, 1]) {
    for (const zsg of [-1, 1]) {
      const px = xsg * (hw - 0.35), pz = zsg * (hd - 0.35);
      useMat(K, PAL.concBarrier);
      K.tube([px, resStartY, pz], [px, resStartY + resH, pz], 0.09, 0.09, 6, true);
      useMat(K, PAL.steelDark);
      for (let cy = resStartY + 1.6; cy < resStartY + resH - 0.8; cy += 3.5) {
        K.box(px, cy, pz, 0.24, 0.12, 0.24);
      }
    }
  }

  // Vertical terracotta glazed ceramic mosaic shear-wall pilasters framing the East/West end walls too!
  useMat(K, PAL.mosaicCoral);
  for (const xsg of [-1, 1]) {
    for (const pz of [-hd + 1.1, -hd * 0.34, hd * 0.34, hd - 1.1]) {
      K.box(xsg * (hw - 0.18), resStartY + resH * 0.5, pz, 0.65, resH + 1.2, 0.72);
    }
  }

  // Vertical coral-terracotta glazed ceramic mosaic pilaster fins tying the 19-story massing together
  useMat(K, PAL.mosaicCoral);
  for (const sg of [-1, 1]) {
    for (let k = 0; k <= nBaysX; k++) {
      if (k % 2 !== 0 && k !== nBaysX) continue;
      const px = -hw + 1.2 + k * bSpanX;
      K.box(px, resStartY + resH * 0.5, sg * (hd - 0.22), 0.72, resH + 1.2, 0.62);
    }
  }

  // -----------------------------------------------------------------------
  // E. Detailed Chongqing Rooftop Parapet, Penthouse, Water Tanks, Pergola & Beacon
  // -----------------------------------------------------------------------
  const roofY = resStartY + resH;
  useMat(K, PAL.concLight);
  // 1.5m raised roof parapet wall with chamfered coping
  K.box(0, roofY + 0.75, hd - 0.35, W, 1.5, 0.55);
  K.box(0, roofY + 0.75, -hd + 0.35, W, 1.5, 0.55);
  K.box(hw - 0.35, roofY + 0.75, 0, 0.55, 1.5, D);
  K.box(-hw + 0.35, roofY + 0.75, 0, 0.55, 1.5, D);
  // Iconic Chongqing decorative rooftop concrete pergola frame
  useMat(K, PAL.coralAccent);
  K.box(0, roofY + 3.6, riverSign * (hd - 0.5), W - 4.0, 0.65, 0.75);
  for (let k = 0; k <= 6; k++) {
    const px = -hw + 2.5 + k * ((W - 5.0) / 6);
    K.box(px, roofY + 2.1, riverSign * (hd - 0.5), 0.65, 3.0, 0.65);
  }
  // Rooftop elevator machine-room penthouse + HVAC units + twin stainless water tanks
  useMat(K, PAL.creamWall);
  K.box(-8, roofY + 2.6, -2.5, 11.5, 5.2, 8.0);
  K.box(10, roofY + 2.2, -3.0, 8.5, 4.4, 6.8);
  useMat(K, PAL.louverMetal);
  K.box(1, roofY + 1.1, 1.0, 5.6, 2.2, 3.6);
  useMat(K, PAL.steelSilver);
  K.tube([12, roofY + 4.4, -3.0], [12, roofY + 6.8, -3.0], 1.45, 1.45, 12, true);
  K.tube([8.5, roofY + 4.4, -3.0], [8.5, roofY + 6.6, -3.0], 1.25, 1.25, 12, true);
  // Roof telecom mast & red aviation beacon
  K.tube([-8, roofY + 5.2, -2.5], [-8, roofY + 12.5, -2.5], 0.18, 0.06, 8, true);
  useMat(K, PAL.beaconRed);
  K.sphere(-8, roofY + 12.8, -2.5, 0.45, 8, 6);
}

// ---------------------------------------------------------------------------
// Elevated Straddle-Beam Concrete Viaduct (单轨高架PC轨道梁) & T-Shaped Concrete Piers
// ---------------------------------------------------------------------------
function buildMonorailViaduct(K, spline, terrain, bCenter, bUx, bUz, bHalfW, bHalfD, outPrisms) {
  const nSegs = Math.max(48, Math.round(spline.length / 6));
  const frames = spline.framesRange(0, spline.length, nSegs);
  const trackOffset = 2.15; // Twin parallel PC straddle beams at ±2.15m from centerline

  // Authentic Chongqing CRT Straddle-Beam PC Track Cross-Section (0.85m wide x 1.50m deep recessed I-beam!)
  const pcBeamProfile = (rOff) => [
    [rOff - 0.425, -1.50], [rOff + 0.425, -1.50],
    [rOff + 0.425, -1.16], [rOff + 0.30,  -1.08],
    [rOff + 0.30,  -0.36], [rOff + 0.425, -0.28],
    [rOff + 0.425,  0.00], [rOff - 0.425,  0.00],
    [rOff - 0.425, -0.28], [rOff - 0.30,  -0.36],
    [rOff - 0.30,  -1.08], [rOff - 0.425, -1.16],
  ];

  for (const sg of [-1, 1]) {
    const rOff = sg * trackOffset;
    // Main prestressed concrete straddle beam
    useMat(K, PAL.concViaduct);
    sweepProfile(K, frames, pcBeamProfile(rOff), true);
    // Side steel stabilizer guide rails & third-rail power busbar (cleanly >= 5cm clear of concrete flange ±0.425!)
    useMat(K, PAL.steelDark);
    for (const side of [-1, 1]) {
      sweepProfile(K, frames, chamferRect(0.08, 0.14, 0, rOff + side * 0.50, -0.58), false);
    }
    useMat(K, PAL.steelSilver);
    sweepProfile(K, frames, chamferRect(0.08, 0.12, 0, rOff - sg * 0.51, -1.04), false);
  }

  // Central steel evacuation walkway & periodic cross-beams between the two PC beams (handrails raised cleanly above beam top!)
  useMat(K, PAL.steelDark);
  sweepProfile(K, frames, chamferRect(1.55, 0.14, 0, 0, -0.82), false);
  useMat(K, PAL.steelSilver);
  for (const sg of [-1, 1]) {
    sweepProfile(K, frames, chamferRect(0.06, 0.06, 0, sg * 0.67, 0.08), false);
  }
  for (let s = 8; s < spline.length - 8; s += 10) {
    const f = spline.sampleAt(s);
    const pA = vAdd(f.p, vAdd(vScale(f.R, -trackOffset), [0, -1.35, 0]));
    const pB = vAdd(f.p, vAdd(vScale(f.R, trackOffset), [0, -1.35, 0]));
    useMat(K, PAL.concPier);
    steelBeam(K, pA, pB, 0.52, 0.45);
  }

  // Sculpted T-Shaped / Hammerhead Concrete Viaduct Piers (automatically skipped inside Liziba building footprint!)
  const pierSpacing = 22.0;
  for (let s = 14; s < spline.length - 10; s += pierSpacing) {
    const f = spline.sampleAt(s);
    const px = f.p[0], py = f.p[1], pz = f.p[2];
    // Transform pier position into Liziba building's local coords to skip piers inside the building
    const dx = px - bCenter[0], dz = pz - bCenter[2];
    const lx = dx * bUx + dz * bUz;
    const lz = -dx * bUz + dz * bUx;
    if (Math.abs(lx) < bHalfW + 3.5 && Math.abs(lz) < bHalfD + 3.5) continue;

    const gy = terrain.sample(px, pz);
    const pierBot = Math.min(gy - 14.0, py - 10.0);
    const beamBot = py - 1.50;
    if (beamBot < gy - 1.5) continue;

    // Flared prestressed T-cap crosshead strictly below bearing pads (ZERO coplanar overlap with PC beam!)
    const capTop = beamBot - 0.18;
    const capBot = capTop - 1.85;
    const cL = vAdd([px, (capTop + capBot) * 0.5, pz], vScale(f.R, -trackOffset - 0.85));
    const cR = vAdd([px, (capTop + capBot) * 0.5, pz], vScale(f.R, trackOffset + 0.85));
    useMat(K, PAL.concLight);
    steelBeam(K, cL, cR, 1.75, 1.85, [0, 1, 0], true, 0.16);
    // Elastomeric bearings seated cleanly in the 0.18m gap between T-cap and PC beam
    useMat(K, PAL.steelDark);
    for (const sg of [-1, 1]) {
      const bp = vAdd([px, beamBot - 0.09, pz], vScale(f.R, sg * trackOffset));
      K.box(bp[0], bp[1], bp[2], 0.92, 0.16, 0.92);
    }
    // Chamfered tapered octagonal concrete pier column descending into DEM terrain
    useMat(K, PAL.concPylon);
    steelBeam(K, [px, pierBot, pz], [px, capBot + 0.2, pz], 2.05, 2.35, f.T, true, 0.28);
    // Sandstone base collar at terrain contact
    useMat(K, PAL.sandstone);
    K.box(px, gy - 0.8, pz, 3.6, 3.2, 3.6);
    outPrisms.push({ type: 'circle', x: px, z: pz, r: 1.55, sides: 8, base: pierBot, top: capTop });
  }
}

// ---------------------------------------------------------------------------
// Authentic Chongqing Dressed Sandstone Retaining Terraces (堡坎石墙)
// Dresses the steep hillside cut between Liziba Viaduct & Binjiang Rd with coursed sandstone walls,
// battered stone pilasters, recessed framed drainage niches & slim steel railings — while keeping
// the viewing-platform sightline to the viaduct & emerging 6-car CRT Line 2 train 100% UNOBSTRUCTED!
// ---------------------------------------------------------------------------
function buildLizibaCliffWall(K, spline, sStation, W, riverSign, terrain, vp, outLights) {
  // Dress ONLY the road-free hillside cut & median strips beside Liziba Building!
  // Real Binjiang Rd has TWO diagonal divided carriageways running across this slope:
  //   Upper carriageway centerline: offUp(s) ≈ max(3.5, 17.8 - (s - 255) * 0.088)  (half-width 3.6m + 1.8m clearance -> ±5.4m)
  //   Lower carriageway centerline: offLo(s) ≈ max(17.0, 26.5 - (s - 255) * 0.048) (half-width 3.6m + 1.8m clearance -> ±5.4m)
  // By dynamically computing offBack/offFace strictly OUTSIDE both road corridors, ZERO cars ever clip retaining walls
  // while keeping the viewing-platform sightline to the viaduct & emerging 6-car CRT Line 2 train 100% UNOBSTRUCTED!
  const camY = (vp?.y ?? 34.24) + 2.2;
  const stFrame = spline.sampleAt(sStation);
  const viaductClearY = stFrame.p[1] - 1.65;
  const vpOffMag = Math.max(26.0, Math.abs((vp.x - stFrame.p[0]) * stFrame.R[0] + (vp.z - stFrame.p[2]) * stFrame.R[2]));

  const offUp = (s) => Math.max(3.5, 17.8 - (s - (sStation + W * 0.5)) * 0.088);
  const offLo = (s) => Math.max(17.0, 26.5 - (s - (sStation + W * 0.5)) * 0.048);

  const emitBay = (sm, ds, offBack, offFace, maxRise, hasRail, isNeFlank) => {
    const wallD = offFace - offBack;
    if (wallD < 1.8 || offFace < 3.0) return;
    const fm = spline.sampleAt(sm);
    const ang = Math.atan2(-fm.T[2], fm.T[0]);
    const railH = hasRail ? 0.85 : 0.0;
    const rayFrac = Math.max(0.05, Math.min(0.95, (vpOffMag - offFace) / (vpOffMag + 2.15)));
    const sightlineMaxY = camY + (viaductClearY - camY) * rayFrac - 3.2 - railH;

    const pTopW = vAdd(fm.p, vScale(fm.R, riverSign * offBack));
    const pBotW = vAdd(fm.p, vScale(fm.R, riverSign * offFace));
    const yTopDem = terrain.sample(pTopW[0], pTopW[2]);
    const yBotDem = terrain.sample(pBotW[0], pBotW[2]);

    const rawTop = Math.min(yTopDem + 0.15, yBotDem + maxRise);
    const wallTop = isNeFlank ? Math.min(rawTop, sightlineMaxY) : rawTop;
    const wallBot = yBotDem - 4.2;
    const wallH = wallTop - wallBot;
    if (wallH < 2.2) return;

    const pCenterW = vAdd(fm.p, vScale(fm.R, riverSign * (offFace - wallD * 0.5)));
    K.push().translate(pCenterW[0], 0, pCenterW[2]).rotateY(ang);

    // 1. Coursed Chongqing dressed sandstone retaining wall (1024px MAT.STONE)
    useMat(K, PAL.sandstone);
    K.box(0, (wallBot + wallTop) * 0.5, 0, ds + 0.28, wallH, wallD);

    // 2. Beveled dressed granite coping cap + tapered stone buttress pilasters
    const zFace = riverSign * (wallD * 0.5);
    useMat(K, PAL.graniteWarm);
    K.box(0, wallTop + 0.14, zFace * 0.12, ds + 0.34, 0.28, wallD + 0.32);
    useMat(K, PAL.sandstone);
    K.box(-ds * 0.48, (wallBot + wallTop) * 0.5, zFace + riverSign * 0.22, 0.95, wallH + 0.10, 0.52);
    K.box(ds * 0.48, (wallBot + wallTop) * 0.5, zFace + riverSign * 0.22, 0.95, wallH + 0.10, 0.52);

    // 3. Flush Architectural Recessed Stone Niche + Dressed Lintel & Keystone + Cast-Iron Weep Pipes
    const nicheW = ds - 1.8;
    const visH = Math.max(1.1, wallTop - yBotDem);
    const nicheH = Math.max(0.9, visH - 0.55);
    const nicheMidY = wallTop - 0.36 - nicheH * 0.5;
    K.style([0.24, 0.22, 0.18], 0.92, 0, 0, MAT.STONE, 0.42);
    K.box(0, nicheMidY, zFace + riverSign * 0.05, nicheW, nicheH, 0.12);
    useMat(K, PAL.graniteWarm);
    K.box(0, wallTop - 0.30, zFace + riverSign * 0.15, nicheW + 0.22, 0.24, 0.26);
    K.box(0, wallTop - 0.24, zFace + riverSign * 0.19, 0.58, 0.36, 0.32);
    useMat(K, PAL.steelDark);
    for (const wx of [-nicheW * 0.28, nicheW * 0.28]) {
      K.tube([wx, yBotDem + 0.55, zFace], [wx, yBotDem + 0.50, zFace + riverSign * 0.28], 0.06, 0.06, 6, true);
    }

    // 4. Low dark-charcoal Chongqing hillside safety railing
    if (hasRail) {
      const zRail = zFace - riverSign * 0.16;
      useMat(K, PAL.steelDark);
      K.box(0, wallTop + railH, zRail, ds + 0.14, 0.065, 0.065);
      K.box(0, wallTop + railH * 0.52, zRail, ds + 0.14, 0.05, 0.05);
      for (let p = 0; p < 4; p++) {
        const px = -ds * 0.38 + p * (ds * 0.253);
        K.box(px, wallTop + railH * 0.5 + 0.14, zRail, 0.055, railH - 0.04, 0.055);
      }
    }
    K.pop();
  };

  // Strip A (NE Uphill Cut Bank beneath viaduct, strictly uphill of upper carriageway!): s = 254..332
  const sNe0 = Math.min(spline.length - 40, sStation + W * 0.5 - 2.0);
  const sNeCutEnd = Math.min(spline.length - 20, sNe0 + 78.0);
  const dsA = 8.5;
  for (let s = sNe0; s < sNeCutEnd; s += dsA) {
    const sm = s + dsA * 0.5;
    const face = offUp(sm) - 5.6; // Strict >= 2.0m clear of upper road uphill curb!
    const back = Math.max(2.6, face - 3.6);
    emitBay(sm, dsA, back, face, 2.7, true, true);
  }

  // Strip B (NE Inter-Carriageway Median Escarpment strictly BETWEEN upper & lower Binjiang Rd!): s = 290..428
  const sMed0 = Math.min(spline.length - 40, sNe0 + 36.0);
  const sMed1 = Math.min(spline.length - 20, sNe0 + 172.0);
  const dsB = 9.0;
  for (let s = sMed0; s < sMed1; s += dsB) {
    const sm = s + dsB * 0.5;
    const back = offUp(sm) + 5.4;  // Strict >= 1.8m clear of upper road outer curb!
    const face = offLo(sm) - 5.4;  // Strict >= 1.8m clear of lower road uphill curb!
    emitBay(sm, dsB, back, face, 2.2, true, true);
  }

  // Strip C (SW Flank behind building, strictly uphill of upper carriageway): s = sStation - W/2 - 48 .. -W/2
  const sSw0 = Math.max(18, sStation - W * 0.5 - 48.0);
  const sSw1 = Math.max(18, sStation - W * 0.5 + 1.0);
  for (let s = sSw0; s < sSw1 - 4; s += 9.0) {
    const sm = s + 4.5;
    emitBay(sm, 9.0, 5.5, 11.5, 2.8, true, false);
  }
}

// ---------------------------------------------------------------------------
// Liziba Tourist Viewing Platform (李子坝观景台 — cantilevered cleanly above riverfront slope!)
// ---------------------------------------------------------------------------
function buildViewingPlatform(K, vp, bAngle, ux, uz, riverSign, terrain, outDecks, outLights, outPrisms) {
  // Shift the flat cantilevered viewing terrace cleanly toward the river/downhill side (+riverSign)
  // while keeping deckY aligned to vp.y (~34.5m, 1.9m below eye-height camera at 36.4m!)
  const shiftOut = 7.5 * riverSign;
  const vx = vp.x - uz * shiftOut;
  const vz = vp.z + ux * shiftOut;
  const W = 38.0, D = 10.5;

  let minY = Infinity;
  for (const lx of [-W * 0.48, 0, W * 0.48]) {
    for (const lz of [-D * 0.48, 0, D * 0.48]) {
      const [wx, , wz] = localToWorld(vx, 0, vz, ux, uz, lx, 0, lz);
      const ty = terrain.sample(wx, wz);
      if (ty < minY) minY = ty;
    }
  }
  const deckY = Math.max(vp.y ?? 34.24, minY + 1.5) + 0.15;
  const baseBot = minY - 12.0;

  K.push().translate(vx, 0, vz).rotateY(bAngle);
  // Deep sandstone retaining support wall & cantilevered concrete deck beam descending into riverfront slope
  useMat(K, PAL.sandstone);
  K.box(0, (baseBot + deckY - 0.55) * 0.5, 0, W - 0.6, deckY - 0.55 - baseBot, D - 0.8);
  // Sculpted concrete cantilever cornice slab + diagonal brackets along outer riverfront rim
  useMat(K, PAL.concLight);
  K.box(0, deckY - 0.45, 0, W + 0.8, 0.55, D + 0.8);
  for (let k = 0; k <= 6; k++) {
    const bx = -W * 0.45 + k * ((W * 0.90) / 6);
    steelBeam(K, [bx, deckY - 3.6, riverSign * (D * 0.34)], [bx, deckY - 0.65, riverSign * (D * 0.52)], 0.55, 0.70);
  }
  // Granite paved viewing terrace top
  useMat(K, PAL.graniteWarm);
  K.box(0, deckY - 0.08, 0, W + 0.4, 0.24, D + 0.4);
  // Crisp low sandstone planter troughs with granite coping & neat low dark-green clipped boxwood trim along uphill edge
  useMat(K, PAL.concBarrier);
  K.box(0, deckY + 0.24, -riverSign * (D * 0.5 - 0.25), W, 0.48, 0.42);
  for (const px of [-14, -7, 7, 14]) {
    const pz = -riverSign * (D * 0.5 - 0.72);
    useMat(K, PAL.sandstone);
    K.box(px, deckY + 0.30, pz, 3.6, 0.56, 1.02);
    useMat(K, PAL.graniteWarm);
    K.box(px, deckY + 0.60, pz, 3.74, 0.08, 1.14);
    useMat(K, PAL.ballast);
    K.box(px, deckY + 0.56, pz, 3.32, 0.06, 0.78);
    useMat(K, PAL.foliageDeep);
    K.box(px, deckY + 0.72, pz, 3.10, 0.26, 0.62);
  }

  // Sleek stainless steel & glass viewing balustrades along the riverfront edge & sides
  useMat(K, PAL.steelSilver);
  const zRiv = riverSign * (D * 0.5 + 0.06);
  K.box(0, deckY + 1.12, zRiv, W + 0.4, 0.09, 0.09);
  for (let k = 0; k <= 12; k++) {
    const px = -W * 0.5 + k * (W / 12);
    K.box(px, deckY + 0.58, zRiv, 0.08, 1.10, 0.08);
  }
  useMat(K, PAL.glassPlain);
  K.box(0, deckY + 0.58, zRiv, W, 0.86, 0.05);

  // Sleek modern steel-and-timber slatted shade pergola positioned strictly on the flat outer riverfront half
  const zPergIn = riverSign * 0.6;
  const zPergOut = riverSign * (D * 0.5 - 1.1);
  const zPergMid = (zPergIn + zPergOut) * 0.5;
  const pergD = Math.abs(zPergOut - zPergIn) + 0.8;
  for (const px of [-13.5, -6.5, 6.5, 13.5]) {
    useMat(K, PAL.steelDark);
    K.box(px, deckY + 1.85, zPergIn, 0.24, 3.7, 0.24);
    K.box(px, deckY + 1.85, zPergOut, 0.24, 3.7, 0.24);
    K.box(px, deckY + 3.72, zPergMid, 0.24, 0.24, pergD);
  }
  for (const cx of [-10.0, 10.0]) {
    useMat(K, PAL.steelDark);
    K.box(cx, deckY + 3.72, zPergIn, 7.6, 0.24, 0.22);
    K.box(cx, deckY + 3.72, zPergOut, 7.6, 0.24, 0.22);
    useMat(K, PAL.timberWarm);
    for (let s = 0; s < 9; s++) {
      const sx = cx - 3.6 + s * 0.90;
      K.box(sx, deckY + 3.88, zPergMid, 0.16, 0.14, pergD + 0.4);
    }
    // Slatted timber park bench beneath each pergola bay
    K.box(cx, deckY + 0.48, zPergMid, 3.2, 0.10, 0.56);
    useMat(K, PAL.steelDark);
    K.box(cx - 1.2, deckY + 0.24, zPergMid, 0.12, 0.44, 0.50);
    K.box(cx + 1.2, deckY + 0.24, zPergMid, 0.12, 0.44, 0.50);
  }

  // Viewing platform warm lamps
  for (const px of [-15, 0, 15]) {
    useMat(K, PAL.steelDark);
    K.tube([px, deckY, zRiv - riverSign * 0.45], [px, deckY + 4.4, zRiv - riverSign * 0.45], 0.09, 0.06, 6, true);
    useMat(K, PAL.lampWarm);
    K.sphere(px, deckY + 4.55, zRiv - riverSign * 0.45, 0.26, 8, 6);
  }
  K.pop();

  outDecks.push({ type: 'rectDeck', x: vx, z: vz, ang: bAngle, hx: W * 0.5, hz: D * 0.5 + 1.0, y: deckY + 0.04 });
  if (outPrisms) {
    // Solid sandstone retaining base strictly BELOW deckY - 0.55 (blocks walking under viewing platform from Binjiang Rd!)
    outPrisms.push({ type: 'rect', x: vx, z: vz, ang: bAngle, hx: W * 0.5 - 0.2, hz: D * 0.5 - 0.3, base: baseBot - 6, top: deckY - 0.55 });
  }
  outLights.push({ x: vx, y: deckY + 5.0, z: vz, radius: 36, r: 1.0, g: 0.86, b: 0.58, intensity: 760 });
}

// ---------------------------------------------------------------------------
// Module Entry Point: buildMonorail(ctx)
// ---------------------------------------------------------------------------
export function buildMonorail(ctx) {
  const { data, terrain, materials, makePlaque } = ctx;
  const raw = data?.liziba || FALLBACK_LIZIBA;

  const group = new THREE.Group();
  group.name = 'hero-monorail';
  const movingGroup = new THREE.Group();
  movingGroup.name = 'hero-monorail-moving-shadow';
  const prisms = [];
  const decks = [];
  const lights = [];
  const labels = [];

  // 1. Build & Sanitize Spline3D from liziba.spline (trim extreme cliff-climb ends into a realistic hillside tunnel portal!)
  let rawPts = Array.isArray(raw.spline) && raw.spline.length >= 2 ? raw.spline : null;
  const bx = raw.x ?? FALLBACK_LIZIBA.x;
  const bz = raw.z ?? FALLBACK_LIZIBA.z;
  const bTerrainY = terrain.sample(bx, bz);
  const baseY = raw.baseY ?? bTerrainY;
  const defaultPortalY = raw.portalY ?? (baseY + 21.0);

  let splinePts = null;
  let hasWestTunnel = false;
  if (rawPts) {
    // Find station index closest to (bx, bz)
    let stIdx = 0, bestD2 = Infinity;
    for (let i = 0; i < rawPts.length; i++) {
      const d2 = (rawPts[i][0] - bx) ** 2 + (rawPts[i][2] - bz) ** 2;
      if (d2 < bestD2) { bestD2 = d2; stIdx = i; }
    }
    const stY = rawPts[stIdx][1];
    // Walk outward from station in both directions, stopping cleanly before unrealistically steep mountain climbs (> +10m above portal)
    let i0 = stIdx;
    while (i0 > 0 && Math.abs(rawPts[i0 - 1][1] - stY) < 9.5) i0--;
    let i1 = stIdx;
    while (i1 < rawPts.length - 1 && Math.abs(rawPts[i1 + 1][1] - stY) < 9.5) i1++;
    hasWestTunnel = (i0 > 0);
    splinePts = rawPts.slice(i0, i1 + 1).map((p) => [p[0], p[1], p[2]]);
    // Add a short smooth level stub entering the hillside tunnel portal if trimmed on the cliff side
    if (hasWestTunnel && splinePts.length >= 2) {
      const pA = splinePts[0], pB = splinePts[1];
      const dx = pA[0] - pB[0], dz = pA[2] - pB[2], dl = Math.hypot(dx, dz) || 1;
      splinePts.unshift([pA[0] + (dx / dl) * 28, pA[1], pA[2] + (dz / dl) * 28]);
    }
  }
  if (!splinePts || splinePts.length < 2) {
    const a = raw.angle ?? 0.24;
    const dx = Math.cos(a), dz = -Math.sin(a);
    splinePts = [];
    for (let k = -6; k <= 6; k++) {
      const dist = k * 55;
      const curve = (k * k) * 0.85;
      splinePts.push([bx + dx * dist - dz * curve, defaultPortalY - Math.abs(k) * 0.45, bz + dz * dist + dx * curve]);
    }
  }
  const spline = new Spline3D(splinePts, 6);

  // Lock building EXACTLY onto the monorail spline so the track passes dead-center through floors 6-8!
  const sStation = closestArcOnSpline(spline, bx, bz);
  const stFrame = spline.sampleAt(sStation);
  const bCenter = [stFrame.p[0], 0, stFrame.p[2]];
  // Horizontal unit axis along the track at the building
  const hLen = Math.hypot(stFrame.T[0], stFrame.T[2]) || 1;
  const ux = stFrame.T[0] / hLen, uz = stFrame.T[2] / hLen;
  const bAngle = Math.atan2(-uz, ux);

  const W = Math.max(46, raw.w ?? 64);
  const D = Math.max(22, raw.d ?? 24);
  const trackY = stFrame.p[1];                  // Top of concrete PC straddle beam inside station
  const portalFloorY = trackY - 1.55;           // Station floor slab sits right under PC beam
  const portalRoofY = trackY + 9.4;             // ~11m open station cavity (floors 6-8)

  // Determine which side (+z or -z in building local frame) faces the viewing platform & river
  const vp = raw.viewpoint || {
    x: bCenter[0] - uz * 38,
    z: bCenter[2] + ux * 38,
    y: terrain.sample(bCenter[0] - uz * 38, bCenter[2] + ux * 38) + 1.6,
  };
  const vpLocalZ = -(vp.x - bCenter[0]) * uz + (vp.z - bCenter[2]) * ux;
  const riverSign = vpLocalZ >= 0 ? 1 : -1;

  // Anchor Liziba's 5-story podium & deep sandstone retaining wall cleanly down the steep cliff toward Binjiang Rd!
  const effectiveBaseY = Math.min(baseY, portalFloorY - 18.5);
  const topY = Math.max(raw.topY ?? (portalRoofY + 37.5), portalRoofY + 36.0);

  // 2. Build 19-Story Liziba Building in its local frame
  const bKit = new HeroKit();
  buildLizibaBuilding(bKit, {
    W, D,
    baseY: effectiveBaseY,
    portalFloorY,
    portalRoofY,
    topY,
    riverSign,
    outLights: lights,
    bOrigin: bCenter,
    ux, uz,
  });
  const bMesh = new THREE.Mesh(bKit.geometry(), materials?.heroMat);
  bMesh.name = 'liziba-building';
  bMesh.position.set(bCenter[0], 0, bCenter[2]);
  bMesh.rotation.y = bAngle;
  bMesh.matrixAutoUpdate = false;
  bMesh.updateMatrix();
  bMesh.updateMatrixWorld(true);
  group.add(bMesh);

  // Building collision prisms: deep downhill-anchored lower podium + 6-8F solid side station halls (leaving 9.8m center bore open!) + upper tower
  prisms.push({ type: 'rect', x: bCenter[0], z: bCenter[2], ang: bAngle, hx: W * 0.5 + 0.6, hz: D * 0.5 + 0.6, base: Math.min(effectiveBaseY, bTerrainY) - 18, top: portalFloorY });
  const sideWallD = Math.max(3.6, D * 0.5 - 4.9);
  for (const sg of [-1, 1]) {
    const [swx, , swz] = localToWorld(bCenter[0], 0, bCenter[2], ux, uz, 0, 0, sg * (4.9 + sideWallD * 0.5));
    prisms.push({ type: 'rect', x: swx, z: swz, ang: bAngle, hx: W * 0.5, hz: sideWallD * 0.5, base: portalFloorY, top: portalRoofY });
  }
  prisms.push({ type: 'rect', x: bCenter[0], z: bCenter[2], ang: bAngle, hx: W * 0.5, hz: D * 0.5, base: portalRoofY, top: topY + 6 });

  // 3. Iconic Illuminated Chinese Signboards ("李子坝 LIZIBA · CRT LINE 2")
  if (typeof makePlaque === 'function') {
    // Main facade plaque directly above the 8F station facing the viewing platform!
    const frontSign = makePlaque('李子坝', {
      w: 11.5, h: 3.2,
      bg: '#0c3b20', fg: '#ffffff', border: '#46d86a',
      subtext: 'LIZIBA · CRT LINE 2',
      emissiveNight: 3.4, emissiveDay: 0.12,
    });
    const [fsx, fsy, fsz] = localToWorld(bCenter[0], 0, bCenter[2], ux, uz, 0, portalRoofY + 2.35, riverSign * (D * 0.5 + 0.52));
    frontSign.position.set(fsx, fsy, fsz);
    frontSign.rotation.y = bAngle + (riverSign > 0 ? 0 : Math.PI);
    frontSign.matrixAutoUpdate = false; frontSign.updateMatrix(); frontSign.updateMatrixWorld(true);
    group.add(frontSign);

    // Portal mouth plaques directly above BOTH train tunnel entrances (East & West)!
    for (const xsg of [-1, 1]) {
      const pSign = makePlaque('李子坝站', {
        w: 8.4, h: 2.2,
        bg: '#0c3b20', fg: '#ffffff', border: '#46d86a',
        subtext: 'LIZIBA STATION',
        emissiveNight: 3.2, emissiveDay: 0.12,
      });
      const [psx, psy, psz] = localToWorld(bCenter[0], 0, bCenter[2], ux, uz, xsg * (W * 0.5 + 1.50), portalRoofY + 1.1, 0);
      pSign.position.set(psx, psy, psz);
      pSign.rotation.y = bAngle + (xsg > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      pSign.matrixAutoUpdate = false; pSign.updateMatrix(); pSign.updateMatrixWorld(true);
      group.add(pSign);
    }
  }

  // 4. Build Elevated Straddle-Beam Concrete Viaduct + Hillside Mountain Tunnel Portal + Viewing Platform
  const vKit = new HeroKit();
  buildMonorailViaduct(vKit, spline, terrain, bCenter, ux, uz, W * 0.5, D * 0.5, prisms);
  if (hasWestTunnel) {
    // Sculpted concrete mountain tunnel portal arch where the west end of CRT Line 2 enters the hillside!
    const tf = spline.sampleAt(16);
    const tAng = Math.atan2(-tf.T[2], tf.T[0]);
    vKit.push().translate(tf.p[0], tf.p[1], tf.p[2]).rotateY(tAng);
    useMat(vKit, PAL.sandstone);
    vKit.box(-6, 4.0, 0, 14.0, 15.0, 14.0);
    useMat(vKit, PAL.concLight);
    vKit.box(1.5, 8.2, 0, 2.2, 2.2, 12.6);
    for (const sg of [-1, 1]) vKit.box(1.5, 3.2, sg * 5.6, 2.2, 10.2, 1.8);
    useMat(vKit, PAL.steelDark);
    vKit.box(-1.2, 3.4, 0, 1.2, 8.2, 9.6); // Deep dark tunnel bore backing
    vKit.pop();
  }
  buildLizibaCliffWall(vKit, spline, sStation, W, riverSign, terrain, vp, lights);
  buildViewingPlatform(vKit, vp, bAngle, ux, uz, riverSign, terrain, decks, lights, prisms);

  const vMesh = new THREE.Mesh(vKit.geometry(), materials?.heroMatNoFlood || materials?.heroMat);
  vMesh.name = 'liziba-viaduct-and-platform';
  vMesh.matrixAutoUpdate = false;
  vMesh.updateMatrix();
  vMesh.updateMatrixWorld(true);
  group.add(vMesh);

  // 5. Build TWO Animated 6-Car Articulated CRT Line 2 Monorail Trains!
  const carGeos = {
    front: buildMonorailCarGeo({ isFront: true }),
    mid:   buildMonorailCarGeo({}),
    rear:  buildMonorailCarGeo({ isRear: true }),
  };
  const movingMat = materials?.heroMovingMat || materials?.heroMat;
  const depthMat = materials?.depthMat;
  const nCars = 6;
  const carStep = 14.25; // Center-to-center spacing along spline
  const trackOffset = 2.15;

  const trains = [
    // Train 0 (+direction on +R track): starts emerging RIGHT OUT of the Liziba 6F portal at t=0!
    { dir: 1, rOff: trackOffset, speed: 15.5, tOffset: 0, cars: [] },
    // Train 1 (-direction on -R track): glides along elevated riverfront viaduct approaching portal!
    { dir: -1, rOff: -trackOffset, speed: 15.5, tOffset: 0, cars: [] },
  ];

  for (let ti = 0; ti < trains.length; ti++) {
    const tr = trains[ti];
    for (let c = 0; c < nCars; c++) {
      const geo = c === 0 ? carGeos.front : c === nCars - 1 ? carGeos.rear : carGeos.mid;
      const mesh = new THREE.Mesh(geo, movingMat);
      mesh.name = `crt-line2-t${ti}-c${c}`;
      mesh.userData.moving = true;
      mesh.userData.shadowAdded = true;
      group.add(mesh);

      let sh = null;
      if (depthMat) {
        sh = new THREE.Mesh(geo, depthMat);
        sh.layers.enable(1);
        movingGroup.add(sh);
      }
      tr.cars.push({ mesh, sh, idx: c });
    }
  }

  // Deterministic train motion along spline with smooth station pause right at the Liziba 6F portal!
  // Building NE portal mouth is at sStation + W*0.5 (+32m). With 6 cars (~85m train), placing leadS at
  // sStation + W*0.5 + 34m (+66m past station center!) puts ~2.5 sleek emerald-and-white cars dramatically
  // emerging OUT of the 6-8F portal over the viewing platform while rear 3.5 cars remain INSIDE the building!
  const sMin = 48, sMax = Math.max(sMin + 120, spline.length - 48);
  const runLen = sMax - sMin;
  const sHeroEmerge = Math.min(sMax - 20, sStation + W * 0.5 + 36.0);
  const heroFrac = Math.max(0.10, Math.min(0.85, (sHeroEmerge - sMin) / runLen));
  const _mat = new THREE.Matrix4();
  const _basisX = new THREE.Vector3(), _basisY = new THREE.Vector3(), _basisZ = new THREE.Vector3();

  // Compute train lead arc-length s(time) with slow scenic emergence through Liziba portal around t = 0..10s
  const evalTrainS = (time, dir, phaseSec) => {
    const travelT = runLen / 12.5;
    const stopT = 6.5; // Scenic 6.5s dwell/crawl while emerging half-out of the 6F portal!
    const cycle = travelT + stopT;
    const u = ((time + phaseSec) % cycle + cycle) % cycle;
    const dwellU = dir > 0 ? heroFrac : Math.max(0.12, 1 - heroFrac);
    const tBefore = dwellU * travelT;
    let pNorm;
    if (u < tBefore) {
      const a = u / Math.max(0.1, tBefore);
      pNorm = dwellU * (a * 0.72 + (1 - (1 - a) * (1 - a)) * 0.28);
    } else if (u < tBefore + stopT) {
      // Gentle slow creep forward (8m over 6.5s) while half-emerged out of the 6F portal!
      const creep = (u - tBefore) / stopT;
      pNorm = dwellU + (12.0 / runLen) * creep;
    } else {
      const a = (u - tBefore - stopT) / Math.max(0.1, travelT - tBefore);
      const startP = dwellU + (12.0 / runLen);
      pNorm = startP + (1 - startP) * (a * a * 0.35 + a * 0.65);
    }
    return dir > 0 ? (sMin + runLen * Math.min(1, pNorm)) : (sMax - runLen * Math.min(1, pNorm));
  };

  // Phase offsets calibrated so that across t = 3..10s (screenshot settle + live first impression):
  //   - Train 0 (+dir) is DRAMATICALLY 2.5–3 cars emerged straight out of the 6-8F Liziba portal!
  //   - Train 1 (-dir) is smoothly approaching along the foreground elevated riverfront viaduct!
  const travelT0 = runLen / 12.5;
  const phaseSec0 = Math.max(0, heroFrac * travelT0 - 2.0);
  const phaseSec1 = (phaseSec0 + (travelT0 + 6.5) * 0.42) % (travelT0 + 6.5);

  const update = (_dt, time = 0) => {
    const phases = [phaseSec0, phaseSec1];
    for (let ti = 0; ti < trains.length; ti++) {
      const tr = trains[ti];
      const leadS = evalTrainS(time, tr.dir, phases[ti]);
      for (const car of tr.cars) {
        const sc = Math.max(2, Math.min(spline.length - 2, leadS - tr.dir * car.idx * carStep));
        const f = spline.sampleAt(sc);
        // Position offset laterally onto this track's PC beam centerline
        const px = f.p[0] + f.R[0] * tr.rOff;
        const py = f.p[1] + f.R[1] * tr.rOff;
        const pz = f.p[2] + f.R[2] * tr.rOff;

        // Forward axis (+x of car) follows travel direction (tr.dir * f.T), right axis (+z of car) = tr.dir * f.R
        _basisX.set(f.T[0] * tr.dir, f.T[1] * tr.dir, f.T[2] * tr.dir).normalize();
        _basisY.set(f.U[0], f.U[1], f.U[2]).normalize();
        _basisZ.crossVectors(_basisX, _basisY).normalize();
        _basisY.crossVectors(_basisZ, _basisX).normalize();

        _mat.makeBasis(_basisX, _basisY, _basisZ);
        _mat.setPosition(px, py, pz);

        car.mesh.matrixAutoUpdate = false;
        car.mesh.matrix.copy(_mat);
        car.mesh.matrixWorld.copy(_mat);
        if (car.sh) {
          car.sh.matrixAutoUpdate = false;
          car.sh.matrix.copy(_mat);
          car.sh.matrixWorld.copy(_mat);
        }
      }
    }
  };
  update(0, 0);

  labels.push({ name: '李子坝轻轨穿楼', x: bCenter[0], y: topY + 12, z: bCenter[2] });

  return {
    group,
    movingGroup,
    update,
    colliders: { prisms, decks },
    lights,
    labels,
  };
}

export default buildMonorail;
