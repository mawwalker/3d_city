// Chongqing 3D Iconic Cross-River Bridges & 8D Overpasses ("中国桥都").
// Museum-grade structural engineering geometry built with HeroKit + bridgeKit:
//   - 千厮门嘉陵江大桥 (Qiansimen Bridge): Single Sky-Shuttle pylon, double-deck crimson Warren truss, CRT Line 6 train
//   - 东水门长江大桥 (Dongshuimen Bridge): Twin Sky-Shuttle pylons, double-deck crimson Warren truss, CRT Line 6 train
//   - 朝天门长江大桥 (Chaotianmen Bridge): World's longest 552m 3-span crimson steel truss arch, double-deck + CRT Loop
//   - 菜园坝长江大桥 (Caiyuanba Bridge): Y-shaped concrete rigid-frame piers + 420m coral basket-handle tied arch
//   - 石板坡长江大桥 (Shibanpo Bridge): Twin parallel variable-depth parabolic haunched concrete box-girder spans
//   - 嘉陵江大桥 (Jialing River Bridge): Classic multi-span open-spandrel concrete deck-arch bridge
//   - 渝澳大桥 / 黄花园大桥 (Yu'ao & Huanghuayuan Bridges): Sculpted continuous haunched box-girder spans
//   - 苏家坝立交 (Sujiaba 72m Spiral Overpass): 72m towering twin-column concrete piers + 360° helical spiral ramp
//   - 黄角湾立交 (Huangjuewan Interchange): Multi-tier stacked sweeping ramps (when present in landmarks.json)

import * as THREE from 'three';
import { HeroKit, MAT } from './kit.js';
import {
  PAL, useMat, vAdd, vSub, vScale, vLerp, vNorm, vLen,
  makeFrame, Spline3D, sweepProfile, chamferRect, boxGirderProfile, cutwaterProfile,
  steelBeam, stayCable, gussetNode, emitCableDamperAssembly, buildRoadDeck, buildDoubleDeckTruss,
  buildShuttlePylon, buildRiverPier, buildAbutment, buildTunnelPortal, localToWorld,
} from './bridgeKit.js';

const TAU = Math.PI * 2;

// Fallback WGS-84-projected local coordinates relative to Jiefangbei (106.573357, 29.560101), waterY = 0
// Used ONLY if landmarks.json hasn't supplied a given bridge yet.
const FALLBACK_BRIDGES = [
  {
    id: 'qiansimen', name: '千厮门嘉陵江大桥', kind: 'qiansimen',
    x: 560, z: -760, ux: 0.14, uz: -0.99, length: 740, mainSpan: 312, sideSpan: 88,
    deckY: 64, railY: 53.2, towerH: 185, waterY: 0, doubleDeck: true,
  },
  {
    id: 'dongshuimen', name: '东水门长江大桥', kind: 'dongshuimen',
    x: 1380, z: 180, ux: 0.72, uz: 0.69, length: 940, mainSpan: 445, sideSpan: 205,
    deckY: 64, railY: 53.2, towerH: 178, waterY: 0, doubleDeck: true,
  },
  {
    id: 'chaotianmen', name: '朝天门长江大桥', kind: 'chaotianmen',
    x: 2240, z: -1580, ux: 0.88, uz: 0.47, length: 1220, mainSpan: 552, sideSpan: 190,
    deckY: 66, railY: 55.0, towerH: 168, waterY: 0, doubleDeck: true,
  },
  {
    id: 'caiyuanba', name: '菜园坝长江大桥', kind: 'caiyuanba',
    x: -2320, z: 1650, ux: 0.36, uz: 0.93, length: 960, mainSpan: 420, sideSpan: 120,
    deckY: 68, railY: 57.0, towerH: 166, waterY: 0, doubleDeck: true,
  },
  {
    id: 'shibanpo', name: '石板坡长江大桥', kind: 'shibanpo',
    x: -1020, z: 1380, ux: 0.25, uz: 0.97, length: 1120, mainSpan: 330, sideSpan: 145,
    deckY: 62, towerH: 0, waterY: 0, doubleDeck: false,
  },
  {
    id: 'jialing', name: '嘉陵江大桥', kind: 'jialing',
    x: -2150, z: -960, ux: -0.05, uz: -0.998, length: 640, mainSpan: 150, sideSpan: 120,
    deckY: 54, towerH: 0, waterY: 0, doubleDeck: false,
  },
  {
    id: 'yuao', name: '渝澳大桥', kind: 'yuao',
    x: -2220, z: -960, ux: -0.05, uz: -0.998, length: 680, mainSpan: 160, sideSpan: 120,
    deckY: 56, towerH: 0, waterY: 0, doubleDeck: false,
  },
  {
    id: 'huanghuayuan', name: '黄花园大桥', kind: 'huanghuayuan',
    x: -940, z: -780, ux: -0.10, uz: -0.995, length: 920, mainSpan: 250, sideSpan: 145,
    deckY: 60, towerH: 0, waterY: 0, doubleDeck: false,
  },
  {
    id: 'sujiaba', name: '苏家坝立交', kind: 'sujiaba',
    x: -2060, z: 2220, ux: 0.36, uz: 0.93, length: 420,
    deckY: 72, waterY: 0,
  },
];

/** Normalize a bridge record from landmarks.json into a consistent local frame (+x along bridge). */
function normalizeBridge(raw, waterYDefault) {
  let ux = raw.ux, uz = raw.uz;
  let x = raw.x, z = raw.z;
  let length = raw.length || raw.waterSpan || 600;
  if (raw.p0 && raw.p1) {
    const dx = raw.p1[0] - raw.p0[0];
    const dz = raw.p1[1] - raw.p0[1];
    const d = Math.hypot(dx, dz);
    if (d > 10) {
      ux = ux ?? dx / d;
      uz = uz ?? dz / d;
      if (x == null) x = (raw.p0[0] + raw.p1[0]) * 0.5;
      if (z == null) z = (raw.p0[1] + raw.p1[1]) * 0.5;
      if (!raw.length) length = d;
    }
  }
  const ul = Math.hypot(ux || 1, uz || 0) || 1;
  ux = (ux ?? 1) / ul;
  uz = (uz ?? 0) / ul;
  const waterY = raw.waterY ?? waterYDefault ?? 0;
  const deckY = raw.deckY ?? (waterY + 62);
  return {
    ...raw,
    id: (raw.id || raw.kind || raw.name || 'bridge').toLowerCase(),
    x: x ?? 0,
    z: z ?? 0,
    ux, uz,
    rotY: Math.atan2(-uz, ux),
    length: Math.max(120, length),
    waterY,
    deckY,
    railY: raw.railY ?? (deckY - 10.6),
    towerH: raw.towerH ?? 175,
  };
}

/** Sample terrain safely in a bridge's local (lx, lz) frame. */
function bridgeTerrainSample(terrain, b) {
  return (lx, lz = 0) => {
    const [wx, , wz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, lx, 0, lz);
    return terrain.sample(wx, wz);
  };
}

/** Transform local road deck segments + lamp positions into world coordinates. */
function emitBridgeDeckAndLights(b, deckInfo, outDecks, outLights, lightColor = [1.0, 0.84, 0.54], lightRadius = 32, lightIntensity = 680) {
  const ds = deckInfo.deckSegs;
  for (let i = 0; i + 6 < ds.length; i += 7) {
    const [x0, y0, z0] = localToWorld(b.x, 0, b.z, b.ux, b.uz, ds[i], ds[i + 2], ds[i + 1]);
    const [x1, y1, z1] = localToWorld(b.x, 0, b.z, b.ux, b.uz, ds[i + 3], ds[i + 5], ds[i + 4]);
    outDecks.push([x0, z0, y0, x1, z1, y1, ds[i + 6]]);
  }
  // Sample bridge lamps thoughtfully into LocalLights so all 9 bridges stay comfortably within the shared 512 light budget
  const lamps = deckInfo.lamps || [];
  const isHero = ['qiansimen', 'dongshuimen', 'chaotianmen', 'sujiaba'].some((k) => b.id.includes(k));
  const maxLightsForBridge = isHero ? 20 : 10;
  const stride = Math.max(1, Math.ceil(lamps.length / maxLightsForBridge));
  for (let i = 0; i < lamps.length; i += stride) {
    const [lx, ly, lz] = lamps[i];
    const [wx, wy, wz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, lx, ly, lz);
    outLights.push({
      x: wx, y: wy, z: wz,
      radius: lightRadius,
      r: lightColor[0], g: lightColor[1], b: lightColor[2],
      intensity: lightIntensity,
    });
  }
}

/** Find the real river water channel [xMin, xMax, xMid, width] in bridge local X by sampling DEM. */
function findWaterChannel(sampleH, x0, x1, waterY) {
  const n = 80;
  let wMin = null, wMax = null;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * (i / n);
    if (sampleH(x, 0) <= waterY + 2.5) {
      if (wMin === null) wMin = x;
      wMax = x;
    }
  }
  if (wMin === null || wMax - wMin < 40) {
    return { xMin: x0 * 0.45, xMax: x1 * 0.45, xMid: (x0 + x1) * 0.5, span: (x1 - x0) * 0.45 };
  }
  return { xMin: wMin, xMax: wMax, xMid: (wMin + wMax) * 0.5, span: wMax - wMin };
}

/** Build continuous concrete box-girder approach viaducts + rhythmic piers between [a, e]. */
function buildApproachViaduct(K, {
  a, e, deckYFn, sampleH, waterY, roadW, pierSpacing = 72, girderDepth = 3.6,
  outPrisms, b,
}) {
  const xStart = Math.min(a, e), xEnd = Math.max(a, e);
  const len = xEnd - xStart;
  if (len < 16) return;
  const nSegs = Math.max(3, Math.ceil(len / 18));
  const frames = [];
  for (let i = 0; i <= nSegs; i++) {
    const x = xStart + len * (i / nSegs);
    frames.push(makeFrame([x, deckYFn(x) - 0.85, 0], [1, 0, 0]));
  }
  useMat(K, PAL.concViaduct);
  sweepProfile(K, frames, boxGirderProfile(roadW + 2.8, roadW * 0.56, girderDepth, 0.72), true);

  const nPiers = Math.max(1, Math.floor(len / pierSpacing));
  for (let k = 1; k <= nPiers; k++) {
    const px = xStart + len * (k / (nPiers + 1));
    const ty = sampleH(px, 0);
    const topY = deckYFn(px) - 0.85 - girderDepth + 0.35;
    if (topY < ty + 2.0) continue;
    buildRiverPier(K, {
      x: px,
      baseY: Math.min(ty - 10, waterY - 8),
      waterY,
      topY,
      pierW: roadW * 0.72,
      shaftX: 3.4,
      shaftZ: 3.4,
    });
    if (outPrisms && b) {
      const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, px, 0, 0);
      outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: b.rotY, hx: 2.6, hz: roadW * 0.38, base: Math.min(ty - 8, waterY - 8), top: topY });
    }
  }
}

/** Sample minimum DEM across transverse bridge abutment width so abutments never float on sideways slopes. */
function minBankGround(sampleH, x, halfW = 12) {
  return Math.min(sampleH(x, 0), sampleH(x, -halfW), sampleH(x, halfW));
}

/** Emit a solid ground-anchored prism collider for a bridge abutment strictly below deckY - 0.45 (blocks walking through abutment walls from below while keeping top roadway 100% walkable!). */
function emitAbutmentPrism(b, outPrisms, { x, deckY, groundY, width = 22.0, dir = 1, length = 22.0 }) {
  const drop = deckY - groundY;
  const cx = x - dir * (length * 0.5);
  const botY = Math.min(groundY - 14.0, deckY - 18.0);
  if (drop > 16.0) {
    // Match buildAbutment's pier-bent mode: emit solid pier bents + low earthwork plinth
    for (const bx of [x - dir * 3.0, x - dir * (length - 3.5)]) {
      for (const sg of [-1, 1]) {
        const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, bx, 0, sg * (width * 0.34));
        outPrisms.push({ type: 'circle', x: pwx, z: pwz, r: 2.1, sides: 8, base: botY, top: deckY - 0.45 });
      }
    }
    const [ex, , ez] = localToWorld(b.x, 0, b.z, b.ux, b.uz, cx, 0, 0);
    outPrisms.push({ type: 'rect', x: ex, z: ez, ang: b.rotY, hx: length * 0.5 + 1.0, hz: width * 0.5 + 1.2, base: botY, top: groundY + 4.5 });
    return;
  }
  const [awx, , awz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, cx, 0, 0);
  outPrisms.push({
    type: 'rect', x: awx, z: awz, ang: b.rotY,
    hx: length * 0.5 + 0.4, hz: width * 0.5 + 1.6,
    base: botY, top: deckY - 0.45,
  });
}

/** Emit twin left/right solid cheek-wall prisms for a mountain tunnel portal (leaving the central road bore 100% passable!). */
function emitTunnelPortalPrisms(outPrisms, { ox, oz, ux, uz, ang, deckY, groundY, width = 12.0, dir = 1 }) {
  const hw = width * 0.5;
  const botY = Math.min(groundY - 14.0, deckY - 14.0);
  const topY = deckY + 8.6;
  const headX = -dir * 4.5;
  for (const sg of [-1, 1]) {
    const [wx, , wz] = localToWorld(ox, 0, oz, ux, uz, headX, 0, sg * (hw + 2.3));
    outPrisms.push({ type: 'rect', x: wx, z: wz, ang, hx: 5.5, hz: 2.3, base: botY, top: topY });
  }
}

/**
 * Smooth longitudinal deck profile: level/cambered over river channel, gently ramping approaches to cliff banks,
 * AND enforcing a smooth terrain-clearance floor across full ±halfW width so NO bridge deck or sidewalk
 * ever plunges below hillside DEM (fixes jialing -7.59m plunge & sideways riverbank pokes)!
 */
function makeDeckProfile(x0, x1, baseDeckY, bank0Y, bank1Y, camber = 2.2, waterChan = null, sampleH = null, halfW = 11.0, {
  allowSteepDrop0 = false,
  allowSteepDrop1 = false,
} = {}) {
  const L = Math.max(1, x1 - x0);
  const w0 = waterChan ? waterChan.xMin : x0 + L * 0.22;
  const w1 = waterChan ? waterChan.xMax : x1 - L * 0.22;
  const minDrop0 = allowSteepDrop0 ? 34 : 16;
  const minDrop1 = allowSteepDrop1 ? 34 : 16;
  const end0 = (bank0Y != null && bank0Y > baseDeckY - minDrop0 && bank0Y < baseDeckY + 26) ? bank0Y : baseDeckY;
  const end1 = (bank1Y != null && bank1Y > baseDeckY - minDrop1 && bank1Y < baseDeckY + 26) ? bank1Y : baseDeckY;

  const baseFn = (x) => {
    const u = Math.max(0, Math.min(1, (x - x0) / L));
    const arch = 4 * u * (1 - u) * camber;
    if (x < w0 && w0 > x0 + 25) {
      const t = Math.max(0, Math.min(1, (w0 - x) / (w0 - x0)));
      const s = t * t * (3 - 2 * t);
      return baseDeckY + (end0 - baseDeckY) * s + arch;
    }
    if (x > w1 && x1 > w1 + 25) {
      const t = Math.max(0, Math.min(1, (x - w1) / (x1 - w1)));
      const s = t * t * (3 - 2 * t);
      return baseDeckY + (end1 - baseDeckY) * s + arch;
    }
    return baseDeckY + arch;
  };

  if (!sampleH) return baseFn;

  // Build a smoothly filtered longitudinal elevation table ensuring every point clears max(dem(x, -hw), dem(x, 0), dem(x, +hw)) + 0.35m!
  const N = Math.max(32, Math.ceil(L / 10));
  const ys = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const x = x0 + (L * i) / N;
    const demMax = Math.max(sampleH(x, 0), sampleH(x, -halfW), sampleH(x, halfW));
    ys[i] = Math.max(baseFn(x), demMax + 0.35);
  }
  // 3 gentle smoothing passes (never dipping below terrain clearance floor!)
  for (let pass = 0; pass < 3; pass++) {
    const prev = ys.slice();
    for (let i = 1; i < N; i++) {
      const x = x0 + (L * i) / N;
      const demMax = Math.max(sampleH(x, 0), sampleH(x, -halfW), sampleH(x, halfW));
      ys[i] = Math.max(demMax + 0.35, 0.25 * prev[i - 1] + 0.5 * prev[i] + 0.25 * prev[i + 1]);
    }
  }
  return (x) => {
    const f = Math.max(0, Math.min(1, (x - x0) / L)) * N;
    const i = Math.min(N - 1, Math.floor(f));
    const t = f - i;
    return ys[i] + (ys[i + 1] - ys[i]) * t;
  };
}

// ---------------------------------------------------------------------------
// Sleek 6-Car CRT Line 6 Metro Train (gliding across Qiansimen & Dongshuimen lower decks)
// ---------------------------------------------------------------------------
function buildCrtLine6TrainGeo(stripeRgb = [0.88, 0.24, 0.56]) {
  const K = new HeroKit();
  const nCars = 6, carL = 17.5, gap = 0.7, totalL = nCars * carL + (nCars - 1) * gap;
  const xStart = -totalL * 0.5;
  const hw = 1.48, H = 3.55, y0 = 0.45;

  for (let c = 0; c < nCars; c++) {
    const cx = xStart + c * (carL + gap) + carL * 0.5;
    const isFront = c === nCars - 1;
    const isRear = c === 0;
    const bodyL = (isFront || isRear) ? carL - 1.2 : carL;
    const bodyCx = isFront ? cx - 0.6 : isRear ? cx + 0.6 : cx;

    // Brushed aluminum/white metro body
    K.style([0.82, 0.84, 0.86], 0.28, 0.45, 0, MAT.PLAIN);
    K.box(bodyCx, y0 + H * 0.5, 0, bodyL, H, hw * 2);
    // Streamlined sloped end nose cabs
    if (isFront || isRear) {
      const sg = isFront ? 1 : -1;
      const xBase = bodyCx + sg * (bodyL * 0.5);
      const xTip = xBase + sg * 1.35;
      K.box((xBase + xTip) * 0.5, y0 + H * 0.38, 0, 1.35, H * 0.72, hw * 1.92);
      // Sloped windshield glass (>= 6cm proud of sloped nose -> ZERO Z-fighting!)
      K.style([0.04, 0.06, 0.08], 0.06, 0.1, -0.5, MAT.PLAIN, 0, 0.95);
      K.box(xTip - sg * 0.30, y0 + H * 0.66, 0, 0.86, H * 0.34, hw * 1.72);
      // Headlights (front) / Ruby taillights (rear)
      if (isFront) {
        K.style([1.0, 0.96, 0.84], 0.15, 0, -24.0, MAT.LANTERN);
        for (const zsg of [-1, 1]) K.box(xTip + 0.06, y0 + 0.85, zsg * 0.88, 0.10, 0.24, 0.42);
      } else {
        K.style([1.0, 0.08, 0.06], 0.2, 0, -18.0, MAT.LANTERN);
        for (const zsg of [-1, 1]) K.box(xTip - 0.06, y0 + 0.85, zsg * 0.88, 0.10, 0.24, 0.42);
      }
    }
    // Signature Chongqing Line 6 rose-pink livery stripe along waist & roofline (>= 5cm proud of body!)
    K.style(stripeRgb, 0.36, 0.15, -0.35, MAT.PLAIN);
    for (const zsg of [-1, 1]) {
      K.box(bodyCx, y0 + 1.05, zsg * (hw + 0.055), bodyL, 0.44, 0.05);
      K.box(bodyCx, y0 + H - 0.24, zsg * (hw + 0.055), bodyL, 0.24, 0.05);
    }
    // Warm brightly-lit metro passenger window band (glowing vividly through bridge truss at night!)
    K.style([1.0, 0.88, 0.62], 0.10, 0, -4.6, MAT.PLAIN, 0, 0.9);
    for (let w = 0; w < 5; w++) {
      const wx = bodyCx - bodyL * 0.40 + (w + 0.5) * (bodyL * 0.80 / 5);
      for (const zsg of [-1, 1]) {
        K.box(wx, y0 + 2.18, zsg * (hw + 0.060), bodyL * 0.125, 1.05, 0.05);
      }
    }
    // Dark bogies + rooftop HVAC units
    K.style([0.14, 0.15, 0.17], 0.65, 0.55, 0, MAT.PLAIN);
    for (const bx of [-bodyL * 0.32, bodyL * 0.32]) K.box(bodyCx + bx, y0 * 0.55, 0, 2.8, y0, hw * 1.65);
    K.style([0.62, 0.64, 0.66], 0.45, 0.35, 0, MAT.LOUVER, 0.16);
    for (const ax of [-bodyL * 0.22, bodyL * 0.22]) K.box(bodyCx + ax, y0 + H + 0.22, 0, 3.6, 0.42, 1.85);
    // Articulated black accordion gangway between cars
    if (c < nCars - 1) {
      K.style([0.10, 0.10, 0.11], 0.85, 0, 0, MAT.PLAIN);
      K.box(xStart + (c + 1) * carL + c * gap + gap * 0.5, y0 + H * 0.48, 0, gap + 0.25, H * 0.86, hw * 1.72);
    }
  }
  return K.geometry();
}

// ---------------------------------------------------------------------------
// 1. 千厮门嘉陵江大桥 (Qiansimen Bridge — Single Sky-Shuttle Pylon beside Hongyadong!)
// ---------------------------------------------------------------------------
function buildQiansimenBridge(K, b, terrain, outPrisms, outDecks, outLights, animSpecs) {
  const sampleH = bridgeTerrainSample(terrain, b);
  const halfL = Math.max(b.length * 0.5, 360);
  const x0 = -halfL, x1 = halfL;
  const waterY = b.waterY;
  const wc = findWaterChannel(sampleH, x0, x1, waterY);
  const deckYFn = makeDeckProfile(x0, x1, b.deckY, b.bank0Y, b.bank1Y, 2.0, wc, sampleH, 11.4);
  const trussDepth = Math.max(10.4, b.deckY - b.railY);

  // Determine which end of local X is the Yuzhong (south, larger world Z) bank!
  // In real Chongqing, Qiansimen's iconic single shuttle pylon stands ~88-100m out from Yuzhong (south bank)
  // right inside the Jialing River channel beside Hongyadong, with the 312m main span reaching NORTH toward Jiangbeizui!
  const [, , zNeg] = localToWorld(b.x, 0, b.z, b.ux, b.uz, x0, 0, 0);
  const [, , zPos] = localToWorld(b.x, 0, b.z, b.ux, b.uz, x1, 0, 0);
  const southIsNeg = zNeg >= zPos;
  const mainDir = southIsNeg ? 1 : -1;

  const mainSpan = Math.min(b.mainSpan || 312, halfL * 1.15);
  const sideSpan = Math.min(b.sideSpan || 88, halfL * 0.40);
  // Anchor the shuttle pylon cleanly inside the south-side river channel (~90m from south bank edge)
  const xSouthWater = southIsNeg ? wc.xMin : wc.xMax;
  const xTower = xSouthWater + mainDir * 58.0;
  const xMainEnd = xTower + mainDir * mainSpan;

  // 1. Upper 4-Lane Highway + Wide Tourist Pedestrian Sidewalks + Raised Median Barrier + Streetlamps
  const deckInfo = buildRoadDeck(K, {
    x0, x1,
    deckY: deckYFn,
    roadW: 16.8,
    sidewalkW: 2.8,      // Extra-wide Hongyadong viewing sidewalks!
    medianW: 2.35,       // Wide solid raised central stay-cable anchorage median island
    lanesPerSide: 2,
    slabDepth: 0.90,
    step: 16,
    lampSpacing: 26,
    lampSide: 'both',
    railColor: PAL.steelSilver,
    edgeLight: PAL.ledGold,
    macroDetail: true,
  });
  emitBridgeDeckAndLights(b, deckInfo, outDecks, outLights, [1.0, 0.82, 0.48], 34, 720);

  // 2. Iconic Vermilion-Red Double-Deck Steel Warren Truss (cleanly stops before hillside rises above lower rail chord!)
  let qTr0 = x0 + 18, qTr1 = x1 - 18;
  while (qTr0 < wc.xMin && sampleH(qTr0, 0) > deckYFn(qTr0) - trussDepth + 1.5) qTr0 += 6;
  while (qTr1 > wc.xMax && sampleH(qTr1, 0) > deckYFn(qTr1) - trussDepth + 1.5) qTr1 -= 6;
  buildDoubleDeckTruss(K, {
    x0: qTr0,
    x1: qTr1,
    upperY: deckYFn,
    trussDepth,
    trussHalfW: 8.6,
    bayLen: 12.0,
    steelMat: PAL.cqRed,
    darkMat: PAL.cqRedDark,
    trackSep: 4.2,
    nightStrip: PAL.ledGold,
  });
  if (qTr0 > x0 + 22) buildApproachViaduct(K, { a: x0 + 16, e: qTr0, deckYFn, sampleH, waterY, roadW: 21.0, pierSpacing: 45, girderDepth: 2.6, outPrisms, b });
  if (qTr1 < x1 - 22) buildApproachViaduct(K, { a: qTr1, e: x1 - 16, deckYFn, sampleH, waterY, roadW: 21.0, pierSpacing: 45, girderDepth: 2.6, outPrisms, b });

  // 3. Single Iconic 185m "Sky Shuttle" (天梭形) Concrete Pylon
  const towerDeckY = deckYFn(xTower);
  const towerTopY = Math.max(waterY + (b.towerH || 185), towerDeckY + 122);
  const pylon = buildShuttlePylon(K, {
    x: xTower,
    baseY: Math.min(sampleH(xTower, 0) - 10, waterY - 12),
    waterY,
    lowerDeckY: towerDeckY - trussDepth,
    upperDeckY: towerDeckY,
    topY: towerTopY,
    deckHalfW: 11.4,
    nightFlood: PAL.ledGold,
  });

  // Pylon collision prisms (river pedestal below deck + twin curved outer legs flanking the walkable deck!)
  const [twx, , twz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xTower, 0, 0);
  outPrisms.push({ type: 'circle', x: twx, z: twz, r: 10.5, sides: 10, base: waterY - 14, top: towerDeckY - 2 });
  for (const sg of [-1, 1]) {
    const [lx, , lz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xTower, 0, sg * 15.2);
    outPrisms.push({ type: 'circle', x: lx, z: lz, r: 2.7, sides: 8, base: waterY - 14, top: towerTopY });
  }
  // Pylon architectural night floodlights
  for (const hFrac of [0.35, 0.65, 0.90]) {
    outLights.push({
      x: twx, y: towerDeckY + (towerTopY - towerDeckY) * hFrac, z: twz,
      radius: 58, r: 1.0, g: 0.72, b: 0.28, intensity: 1100,
    });
  }

  // 4. Dense Twin Central Stay-Cable Plane (grounded deep inside the raised central median barrier with macro hydraulic vibration dampers!)
  const emitGroundedStay = (xd, ydDeck, xt, yt, zc) => {
    emitCableDamperAssembly(K, { xd, ydDeck, xt, yt, zc, cableR: 0.165 });
  };
  const emitTwinDamperTie = (xd, ydDeck, xt, yt) => {
    const dx = xt - xd, dy = yt - ydDeck, l = Math.hypot(dx, dy) || 1;
    const tCrown = 0.98 / Math.max(1.0, dy);
    const xC = xd + dx * tCrown + (dx / l) * 3.3;
    const yC = ydDeck + 0.98 + (dy / l) * 3.3;
    useMat(K, PAL.steelSilver);
    K.box(xC, yC, 0, 0.22, 0.18, 1.04); // Cross-tie clamp linking the twin central cable dampers
  };

  const nMain = 20, nBack = 12;
  // Main span cable fan (reaching 312m north across Jialing River)
  const mainStart = 20, mainReach = Math.min(mainSpan - 26, Math.abs(xMainEnd - xTower) - 18);
  for (let k = 0; k < nMain; k++) {
    const f = k / (nMain - 1);
    const xd = xTower + mainDir * (mainStart + mainReach * f);
    const yd = deckYFn(xd);
    const yt = pylon.yAnchBot + (pylon.yAnchTop - pylon.yAnchBot) * (0.06 + 0.92 * f);
    for (const sg of [-1, 1]) emitGroundedStay(xd, yd, xTower, yt, sg * 0.50);
    emitTwinDamperTie(xd, yd, xTower, yt);
  }
  // South back-span cable fan (into Yuzhong / Hongyadong side)
  const backStart = 18, backReach = Math.min(sideSpan + 24, Math.abs(xTower - (southIsNeg ? x0 + 26 : x1 - 26)));
  for (let k = 0; k < nBack; k++) {
    const f = k / (nBack - 1);
    const xd = xTower - mainDir * (backStart + backReach * f);
    const yd = deckYFn(xd);
    const yt = pylon.yAnchBot + (pylon.yAnchTop - pylon.yAnchBot) * (0.10 + 0.86 * f);
    for (const sg of [-1, 1]) emitGroundedStay(xd, yd, xTower, yt, sg * 0.50);
    emitTwinDamperTie(xd, yd, xTower, yt);
  }

  // 5. Approach River & Bank Piers + Sandstone Hillside Abutments
  const pierXs = [
    xTower - mainDir * (sideSpan + 14),
    xMainEnd,
  ];
  // Extra Jiangbeizui approach piers beyond main span
  const remApproach = Math.abs((mainDir > 0 ? x1 - 28 : x0 + 28) - xMainEnd);
  if (remApproach > 95) {
    const nApp = Math.max(1, Math.round(remApproach / 95));
    for (let k = 1; k < nApp; k++) {
      pierXs.push(xMainEnd + mainDir * (remApproach * k / nApp));
    }
  }
  for (const px of pierXs) {
    if (px <= x0 + 18 || px >= x1 - 18) continue;
    const ty = sampleH(px, 0);
    const baseY = Math.min(ty - 12, waterY - 14);
    const topY = deckYFn(px) - trussDepth - 0.6;
    buildRiverPier(K, {
      x: px, baseY, waterY, topY,
      pierW: 16.0, shaftX: 3.6, shaftZ: 3.8,
    });
    const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, px, 0, 0);
    outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: b.rotY, hx: 2.8, hz: 9.0, base: baseY, top: topY });
  }
  const qAb0 = { x: x0 + 18, deckY: deckYFn(x0 + 18), groundY: minBankGround(sampleH, x0 + 18, 11.4), width: 22.8, dir: 1, length: 24 };
  const qAb1 = { x: x1 - 18, deckY: deckYFn(x1 - 18), groundY: minBankGround(sampleH, x1 - 18, 11.4), width: 22.8, dir: -1, length: 24 };
  buildAbutment(K, qAb0); emitAbutmentPrism(b, outPrisms, qAb0);
  buildAbutment(K, qAb1); emitAbutmentPrism(b, outPrisms, qAb1);

  // 6. Register animated CRT Line 6 metro train on lower deck!
  animSpecs.push({
    bridge: b,
    x0: x0 + 60, x1: x1 - 60,
    deckYFn,
    yOffset: -trussDepth + 0.92,
    zTrack: 2.1,
    speed: 19.0,
    phase: 0.32,
    stripeRgb: [0.88, 0.22, 0.54], // CRT Line 6 rose-pink
  });
}

// ---------------------------------------------------------------------------
// 2. 东水门长江大桥 (Dongshuimen Bridge — Twin Sky-Shuttle Pylons across Yangtze!)
// ---------------------------------------------------------------------------
function buildDongshuimenBridge(K, b, terrain, outPrisms, outDecks, outLights, animSpecs) {
  const sampleH = bridgeTerrainSample(terrain, b);
  const halfL = Math.max(b.length * 0.5, 420);
  const x0 = -halfL, x1 = halfL;
  const waterY = b.waterY;
  const wc = findWaterChannel(sampleH, x0, x1, waterY);
  const mainSpan = Math.min(b.mainSpan || 445, Math.max(wc.span * 0.92, 360), halfL * 1.15);
  // Center twin shuttle pylons cleanly over the real Yangtze River channel (clamped inside abutments)
  const maxShift = Math.max(0, halfL - mainSpan * 0.5 - 125);
  const xMid = Math.max(-maxShift, Math.min(maxShift, wc.xMid));
  const xT0 = xMid - mainSpan * 0.5, xT1 = xMid + mainSpan * 0.5;
  const side0 = Math.max(70, xT0 - (x0 + 26));
  const side1 = Math.max(70, (x1 - 26) - xT1);
  const deckYFn = makeDeckProfile(x0, x1, b.deckY, b.bank0Y, b.bank1Y, 2.8, wc, sampleH, 11.4);
  const trussDepth = Math.max(10.5, b.deckY - b.railY);

  // 1. Upper 4-Lane Highway + Sidewalks + Wide Central Stay-Cable Median + Streetlamps
  const deckInfo = buildRoadDeck(K, {
    x0, x1,
    deckY: deckYFn,
    roadW: 16.8,
    sidewalkW: 2.6,
    medianW: 2.35,
    lanesPerSide: 2,
    slabDepth: 0.90,
    step: 18,
    lampSpacing: 28,
    lampSide: 'both',
    railColor: PAL.steelSilver,
    edgeLight: PAL.ledGold,
    macroDetail: true,
  });
  emitBridgeDeckAndLights(b, deckInfo, outDecks, outLights, [1.0, 0.80, 0.45], 34, 700);

  // 2. Twin Sister Vermilion-Red Double-Deck Steel Warren Truss (stops cleanly before bank rises above lower rail chord!)
  let dTr0 = x0 + 20, dTr1 = x1 - 20;
  while (dTr0 < wc.xMin && sampleH(dTr0, 0) > deckYFn(dTr0) - trussDepth + 1.5) dTr0 += 6;
  while (dTr1 > wc.xMax && sampleH(dTr1, 0) > deckYFn(dTr1) - trussDepth + 1.5) dTr1 -= 6;
  buildDoubleDeckTruss(K, {
    x0: dTr0, x1: dTr1,
    upperY: deckYFn,
    trussDepth,
    trussHalfW: 8.6,
    bayLen: 12.5,
    steelMat: PAL.cqRed,
    darkMat: PAL.cqRedDark,
    trackSep: 4.2,
    nightStrip: PAL.ledGold,
  });
  if (dTr0 > x0 + 24) buildApproachViaduct(K, { a: x0 + 18, e: dTr0, deckYFn, sampleH, waterY, roadW: 21.0, pierSpacing: 45, girderDepth: 2.6, outPrisms, b });
  if (dTr1 < x1 - 24) buildApproachViaduct(K, { a: dTr1, e: x1 - 18, deckYFn, sampleH, waterY, roadW: 21.0, pierSpacing: 45, girderDepth: 2.6, outPrisms, b });

  // 3. TWIN Iconic "Sky Shuttle" Concrete Pylons framing the Yangtze channel!
  const towers = [[xT0, 1, Math.min(side0, 215)], [xT1, -1, Math.min(side1, 215)]];
  for (const [xt, innerDir, sideSpan] of towers) {
    const tdY = deckYFn(xt);
    const tTopY = Math.max(waterY + (b.towerH || 178), tdY + 116);
    const pylon = buildShuttlePylon(K, {
      x: xt,
      baseY: Math.min(sampleH(xt, 0) - 10, waterY - 14),
      waterY,
      lowerDeckY: tdY - trussDepth,
      upperDeckY: tdY,
      topY: tTopY,
      deckHalfW: 11.4,
      nightFlood: PAL.ledGold,
    });
    const [twx, , twz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xt, 0, 0);
    outPrisms.push({ type: 'circle', x: twx, z: twz, r: 10.5, sides: 10, base: waterY - 14, top: tdY - 2 });
    for (const sg of [-1, 1]) {
      const [lx, , lz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xt, 0, sg * 15.2);
      outPrisms.push({ type: 'circle', x: lx, z: lz, r: 2.7, sides: 8, base: waterY - 14, top: tTopY });
    }
    outLights.push({ x: twx, y: tdY + (tTopY - tdY) * 0.55, z: twz, radius: 62, r: 1.0, g: 0.72, b: 0.28, intensity: 1150 });

    // Symmetrical Twin Central Stay-Cable Fans grounded deep inside raised median barrier with macro dampers on BOTH sides of each pylon
    for (const [dir, reach, nCables] of [[innerDir, mainSpan * 0.46, 17], [-innerDir, sideSpan - 18, 15]]) {
      const a0 = 20;
      for (let k = 0; k < nCables; k++) {
        const f = k / Math.max(1, nCables - 1);
        const xd = xt + dir * (a0 + (reach - a0) * f);
        if (xd < x0 + 22 || xd > x1 - 22) continue;
        const yd = deckYFn(xd);
        const yt = pylon.yAnchBot + (pylon.yAnchTop - pylon.yAnchBot) * (0.06 + 0.92 * f);
        for (const sg of [-1, 1]) {
          emitCableDamperAssembly(K, { xd, ydDeck: yd, xt, yt, zc: sg * 0.50, cableR: 0.165 });
        }
        const dx = xt - xd, dy = yt - yd, l = Math.hypot(dx, dy) || 1;
        const xC = xd + dx * (0.98 / Math.max(1.0, dy)) + (dx / l) * 3.3;
        const yC = yd + 0.98 + (dy / l) * 3.3;
        useMat(K, PAL.steelSilver);
        K.box(xC, yC, 0, 0.22, 0.18, 1.04);
      }
    }
    // Side-span auxiliary pier
    const xp = xt - innerDir * sideSpan;
    if (xp > x0 + 26 && xp < x1 - 26) {
      const baseY = Math.min(sampleH(xp, 0) - 12, waterY - 14);
      const topY = deckYFn(xp) - trussDepth - 0.6;
      buildRiverPier(K, { x: xp, baseY, waterY, topY, pierW: 16.0, shaftX: 3.6, shaftZ: 3.8 });
      const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xp, 0, 0);
      outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: b.rotY, hx: 2.8, hz: 9.0, base: baseY, top: topY });
    }
  }

  const dAb0 = { x: x0 + 20, deckY: deckYFn(x0 + 20), groundY: minBankGround(sampleH, x0 + 20, 11.4), width: 22.8, dir: 1, length: 24 };
  const dAb1 = { x: x1 - 20, deckY: deckYFn(x1 - 20), groundY: minBankGround(sampleH, x1 - 20, 11.4), width: 22.8, dir: -1, length: 24 };
  buildAbutment(K, dAb0); emitAbutmentPrism(b, outPrisms, dAb0);
  buildAbutment(K, dAb1); emitAbutmentPrism(b, outPrisms, dAb1);

  animSpecs.push({
    bridge: b,
    x0: x0 + 65, x1: x1 - 65,
    deckYFn,
    yOffset: -trussDepth + 0.92,
    zTrack: -2.1,
    speed: -20.5,
    phase: 0.62,
    stripeRgb: [0.88, 0.22, 0.54],
  });
}

// ---------------------------------------------------------------------------
// 3. 朝天门长江大桥 (Chaotianmen Bridge — World's Longest 552m Steel Truss Arch!)
// ---------------------------------------------------------------------------
function buildChaotianmenBridge(K, b, terrain, outPrisms, outDecks, outLights, animSpecs) {
  const sampleH = bridgeTerrainSample(terrain, b);
  const halfL = Math.max(b.length * 0.5, 560);
  const x0 = -halfL, x1 = halfL;
  const waterY = b.waterY;
  const wc = findWaterChannel(sampleH, x0, x1, waterY);
  const S = Math.min(b.mainSpan || 552, halfL * 1.12); // 552m world-record main span
  const Ls = Math.min(b.sideSpan || 190, (halfL * 2 - S) * 0.44); // 190m side spans
  // Center the 552m steel truss arch DEAD-CENTER over the real Yangtze River channel!
  const maxShift = Math.max(0, halfL - (S * 0.5 + Ls) - 35);
  const xC = Math.max(-maxShift, Math.min(maxShift, wc.xMid));
  const xArch0 = xC - (S * 0.5 + Ls), xArch1 = xC + (S * 0.5 + Ls);
  const deckY = b.deckY;
  const deckYFn = makeDeckProfile(x0, x1, deckY, b.bank0Y, b.bank1Y, 3.0, wc, sampleH, 14.2);
  const trussDepth = 11.4;

  // 1. Wide 6-Lane Upper Highway + Sidewalks + Guardrails + Streetlamps across entire 1.7km length
  const deckInfo = buildRoadDeck(K, {
    x0, x1,
    deckY: deckYFn,
    roadW: 22.8,
    sidewalkW: 2.6,
    medianW: 1.4,
    lanesPerSide: 3,
    slabDepth: 0.95,
    step: 22,
    lampSpacing: 32,
    lampSide: 'both',
    railColor: PAL.steelSilver,
    edgeLight: PAL.ledGold,
    macroDetail: true,
  });
  emitBridgeDeckAndLights(b, deckInfo, outDecks, outLights, [1.0, 0.78, 0.44], 36, 700);

  // 2. Double-Deck Crimson-Red Steel Truss Girder across the 932m 3-span arch
  buildDoubleDeckTruss(K, {
    x0: xArch0, x1: xArch1,
    upperY: deckYFn,
    trussDepth,
    trussHalfW: 14.5,
    bayLen: 16.0,
    steelMat: PAL.cqRed,
    darkMat: PAL.cqRedDark,
    trackSep: 4.6,
    hasSideRoadLanes: true,
    nightStrip: PAL.ledRed,
  });

  // Continuous concrete approach viaducts + rhythmic piers on BOTH flanks from arch ends to cliff abutments!
  buildApproachViaduct(K, { a: x0 + 20, e: xArch0, deckYFn, sampleH, waterY, roadW: 26.0, pierSpacing: 76, girderDepth: 4.2, outPrisms, b });
  buildApproachViaduct(K, { a: xArch1, e: x1 - 20, deckYFn, sampleH, waterY, roadW: 26.0, pierSpacing: 76, girderDepth: 4.2, outPrisms, b });

  // 3. THREE-SPAN CONTINUOUS CRIMSON-RED STEEL TRUSS ARCH (190m + 552m + 190m) centered at xC!
  const ySpring = waterY + 13.0;
  const crownBotY = deckY + 68.0;
  const crownTopY = deckY + 82.0;
  const yPierPeak = deckY + 42.0;
  const archHalfZ = 15.6;

  const lowerArchY = (x) => {
    const ax = Math.abs(x - xC);
    if (ax <= S * 0.5) {
      const u = ax / (S * 0.5);
      return ySpring + (crownBotY - ySpring) * (1 - u * u);
    }
    const u = Math.min(1, (ax - S * 0.5) / Ls);
    const yEnd = deckYFn(x) - trussDepth;
    return ySpring + (yEnd - ySpring) * Math.pow(u, 0.72);
  };

  const upperArchY = (x) => {
    const ax = Math.abs(x - xC);
    if (ax <= S * 0.5) {
      const u = ax / (S * 0.5);
      const ribThick = 14.0 + (yPierPeak - ySpring - 14.0) * Math.pow(u, 2.35);
      const base = lowerArchY(x) + ribThick;
      return Math.max(base, ySpring + (crownTopY - ySpring) * (1 - 0.85 * u * u));
    }
    const u = Math.min(1, (ax - S * 0.5) / Ls);
    const yStart = upperArchY(xC + S * 0.5);
    const yEnd = deckYFn(x) + 1.5;
    return yStart + (yEnd - yStart) * Math.pow(u, 0.86);
  };

  const nMainPanels = 32, nSidePanels = 11;
  const xs = [];
  for (let i = 0; i < nSidePanels; i++) xs.push(xC - S * 0.5 - Ls + Ls * (i / nSidePanels));
  for (let i = 0; i <= nMainPanels; i++) xs.push(xC - S * 0.5 + S * (i / nMainPanels));
  for (let i = 1; i <= nSidePanels; i++) xs.push(xC + S * 0.5 + Ls * (i / nSidePanels));

  // Build both twin crimson-red truss arch ribs (z = ±archHalfZ)
  for (const sg of [-1, 1]) {
    const z = sg * archHalfZ;
    const lowPts = xs.map((x) => [x, lowerArchY(x), z]);
    const topPts = xs.map((x) => [x, upperArchY(x), z]);

    // Swept heavy chamfered crimson box chords (lower + upper)
    const buildChord = (pts, w, h) => {
      const frames = pts.map((p, i) => {
        const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
        return makeFrame(p, vSub(next, prev));
      });
      useMat(K, PAL.cqRed);
      sweepProfile(K, frames, chamferRect(w, h, 0.16), true);
      // Crimson-gold architectural night LED tracing edge strictly proud of outer chord (>= 8cm clear!)
      useMat(K, PAL.ledRed);
      sweepProfile(K, frames, chamferRect(0.22, 0.28, 0, sg * (w * 0.5 + 0.20), 0), false);
    };
    buildChord(lowPts, 2.2, 2.6);
    buildChord(topPts, 2.0, 2.4);

    // Truss web verticals + alternating N/Warren diagonals + bolted gusset nodes
    for (let i = 0; i < xs.length; i++) {
      const pL = lowPts[i], pT = topPts[i];
      if (vLen(vSub(pT, pL)) > 2.0) {
        useMat(K, PAL.cqRed);
        steelBeam(K, pL, pT, 1.15, 1.15, [1, 0, 0], false, 0.08);
        useMat(K, PAL.cqRedDark);
        gussetNode(K, pL, 2.8, 2.9, 2.6);
        gussetNode(K, pT, 2.6, 2.7, 2.5);
      }
      if (i + 1 < xs.length) {
        const pL2 = lowPts[i + 1], pT2 = topPts[i + 1];
        useMat(K, PAL.cqRed);
        // Symmetric chevron diagonals pointing toward crown & pier peaks
        const leftHalf = xs[i] < xC;
        const slash = (i % 2 === 0) !== leftHalf;
        if (slash) steelBeam(K, pL, pT2, 1.05, 1.15, [0, 1, 0], false, 0.06);
        else steelBeam(K, pT, pL2, 1.05, 1.15, [0, 1, 0], false, 0.06);
      }
    }
  }

  // 4. Overhead Lateral Wind Bracing & Portal Frames Spanning Between the Twin Arch Ribs
  for (let i = 1; i < xs.length - 1; i++) {
    const x = xs[i], yL = lowerArchY(x), yT = upperArchY(x), yd = deckYFn(x);
    // Upper chord transverse strut & X-bracing wherever it clears highway traffic (> deckY + 13m)
    if (yT > yd + 14.0) {
      useMat(K, PAL.cqRed);
      steelBeam(K, [x, yT, -archHalfZ], [x, yT, archHalfZ], 1.1, 1.2);
      if (i + 1 < xs.length - 1 && upperArchY(xs[i + 1]) > deckYFn(xs[i + 1]) + 14.0) {
        const xn = xs[i + 1], yTn = upperArchY(xn);
        useMat(K, PAL.cqRedDark);
        steelBeam(K, [x, yT, -archHalfZ + 0.8], [xn, yTn, archHalfZ - 0.8], 0.65, 0.65);
        steelBeam(K, [x, yT, archHalfZ - 0.8], [xn, yTn, -archHalfZ + 0.8], 0.65, 0.65);
      }
    }
    // Lower chord transverse wind struts & portal bracing (wherever arch rib rises cleanly above traffic)
    if (yL > yd + 13.0) {
      useMat(K, PAL.cqRed);
      steelBeam(K, [x, yL, -archHalfZ], [x, yL, archHalfZ], 1.15, 1.25);
      // K-bracing vertical ties between upper & lower transverse portals every 2nd bay
      if (i % 2 === 0) {
        useMat(K, PAL.cqRedDark);
        steelBeam(K, [x, yL, 0], [x, yT, -archHalfZ + 1.5], 0.65, 0.65);
        steelBeam(K, [x, yL, 0], [x, yT, archHalfZ - 1.5], 0.65, 0.65);
      }
    }
  }

  // 5. Vertical Twin Steel Suspender Cables (hanging double-deck truss from central arch)
  for (let i = 1; i < xs.length - 1; i++) {
    const x = xs[i];
    if (Math.abs(x - xC) >= S * 0.48) continue;
    const yL = lowerArchY(x), yd = deckYFn(x);
    if (yL > yd + 5.0) {
      for (const sg of [-1, 1]) {
        const z = sg * (archHalfZ - 0.5);
        useMat(K, PAL.cableWhite);
        // Twin parallel vertical suspender cables per hanger panel
        stayCable(K, [x - 0.45, yd - 0.4, z], [x - 0.45, yL - 1.0, z], 0.14, {
          sides: 6, anchorLen: 2.2, anchorR: 0.30, anchorMat: PAL.cqRed,
        });
        stayCable(K, [x + 0.45, yd - 0.4, z], [x + 0.45, yL - 1.0, z], 0.14, {
          sides: 6, anchorLen: 2.2, anchorR: 0.30, anchorMat: PAL.cqRed,
        });
        // Bolted deck-edge steel suspender anchor clevis housing
        useMat(K, PAL.steelDark);
        K.box(x, yd - 0.35, z, 1.55, 0.55, 0.85);
      }
    } else if (yL < yd - trussDepth - 2.0) {
      // Steel spandrel columns where the lower arch rib descends below deck near piers
      useMat(K, PAL.cqRed);
      for (const sg of [-1, 1]) {
        steelBeam(K, [x, yL + 1.2, sg * (archHalfZ - 0.6)], [x, yd - trussDepth, sg * (archHalfZ - 0.6)], 1.35, 1.35, [1, 0, 0]);
      }
    }
  }

  // 6. Monumental Fluted Concrete Main Arch Piers (inspired by Jiefangbei!) + End Piers + Abutments
  for (const sg of [-1, 1]) {
    const xp = xC + sg * S * 0.5;
    const baseY = Math.min(sampleH(xp, 0) - 10, waterY - 14);
    // Massive cutwater Yangtze foundation caisson
    useMat(K, PAL.concWet);
    sweepProfile(K, [
      makeFrame([xp, baseY, 0], [0, 1, 0], [1, 0, 0]),
      makeFrame([xp, waterY + 4.0, 0], [0, 1, 0], [1, 0, 0]),
    ], cutwaterProfile(24.0, archHalfZ * 2 + 14.0, 6.0), true);
    // Stepped monumental concrete pier pedestals cradling the arch springings
    useMat(K, PAL.concPylon);
    sweepProfile(K, [
      makeFrame([xp, waterY + 3.8, 0], [0, 1, 0], [1, 0, 0]),
      makeFrame([xp, ySpring + 2.0, 0], [0, 1, 0], [1, 0, 0]),
    ], cutwaterProfile(18.5, archHalfZ * 2 + 9.0, 4.5), true);
    // Twin fluted columns rising from springing up to carry the double-deck girder
    for (const zsg of [-1, 1]) {
      K.box(xp, (ySpring + deckY - trussDepth) * 0.5, zsg * archHalfZ, 6.8, deckY - trussDepth - ySpring + 2.0, 5.4);
    }
    K.box(xp, deckY - trussDepth - 2.2, 0, 6.4, 3.6, archHalfZ * 2 + 4.0);
    // Steel arch hinge shoe
    useMat(K, PAL.steelDark);
    for (const zsg of [-1, 1]) K.box(xp, ySpring + 1.2, zsg * archHalfZ, 5.5, 2.8, 4.2);

    const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xp, 0, 0);
    outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: b.rotY, hx: 10, hz: archHalfZ + 4, base: baseY, top: deckY - trussDepth });
    outLights.push({ x: pwx, y: deckY + 38, z: pwz, radius: 75, r: 1.0, g: 0.28, b: 0.16, intensity: 1200 });

    // Side-span end pier
    const xEnd = xC + sg * (S * 0.5 + Ls);
    const endBase = Math.min(sampleH(xEnd, 0) - 12, waterY - 14);
    const endTop = deckYFn(xEnd) - trussDepth - 0.6;
    buildRiverPier(K, { x: xEnd, baseY: endBase, waterY, topY: endTop, pierW: 26.0, shaftX: 4.0, shaftZ: 4.2 });
    const [epx, , epz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xEnd, 0, 0);
    outPrisms.push({ type: 'rect', x: epx, z: epz, ang: b.rotY, hx: 3.2, hz: 14.0, base: endBase, top: endTop });
  }
  // Arch crown aviation beacons & crown red light
  useMat(K, PAL.beaconRed);
  for (const sg of [-1, 1]) K.sphere(xC, crownTopY + 2.2, sg * archHalfZ, 0.85, 8, 6);
  const [cwx, , cwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xC, 0, 0);
  outLights.push({ x: cwx, y: crownBotY, z: cwz, radius: 85, r: 1.0, g: 0.24, b: 0.14, intensity: 1300 });

  const cAb0 = { x: x0 + 20, deckY: deckYFn(x0 + 20), groundY: minBankGround(sampleH, x0 + 20, 14.5), width: 29.0, dir: 1, length: 24 };
  const cAb1 = { x: x1 - 20, deckY: deckYFn(x1 - 20), groundY: minBankGround(sampleH, x1 - 20, 14.5), width: 29.0, dir: -1, length: 24 };
  buildAbutment(K, cAb0); emitAbutmentPrism(b, outPrisms, cAb0);
  buildAbutment(K, cAb1); emitAbutmentPrism(b, outPrisms, cAb1);

  // Animated CRT Loop Line train (golden-yellow stripe) across lower deck!
  animSpecs.push({
    bridge: b,
    x0: xArch0, x1: xArch1,
    deckYFn,
    yOffset: -trussDepth + 0.92,
    zTrack: 2.3,
    speed: 22.0,
    phase: 0.45,
    stripeRgb: [0.95, 0.76, 0.10], // CRT Loop Line amber-gold
  });
}

// ---------------------------------------------------------------------------
// 4. 菜园坝长江大桥 (Caiyuanba Bridge — Concrete Y-Piers + 420m Coral Basket-Handle Tied Arch!)
// ---------------------------------------------------------------------------
function buildCaiyuanbaBridge(K, b, terrain, outPrisms, outDecks, outLights) {
  const sampleH = bridgeTerrainSample(terrain, b);
  const halfL = Math.max(b.length * 0.5, 480);
  // Extend North (p0) approach viaduct 125m onto the ~28m Caiyuanba plaza (zero 47m vertical stone skyscraper!)
  // AND stop South (p1) approach cleanly at the base of the rising Nan'an cliff (lx = halfL - 28, dem ~66m)
  // entering a monumental 6-lane mountain tunnel portal (南城隧道) with gentle <= 8% grade (zero 38% ski-jump & zero chopped-off stub in t08!)
  const northExt = (b.bank0Y != null && b.bank0Y < b.deckY - 20) ? 125 : 0;
  const hasSouthCliff = (b.bank1Y != null && b.bank1Y > b.deckY + 10);
  const southPull = hasSouthCliff ? 28 : 0;
  const x0 = -halfL - northExt, x1 = halfL - southPull;
  const waterY = b.waterY;
  const wc = findWaterChannel(sampleH, -halfL, halfL, waterY);
  const S = Math.min(b.mainSpan || 420, halfL * 1.1);
  // Center the 420m basket-handle tied arch & Y-piers cleanly over the real Yangtze River channel!
  const maxShift = Math.max(0, halfL - S * 0.5 - 90);
  const xC = Math.max(-maxShift, Math.min(maxShift, wc.xMid));
  const deckY = b.deckY;
  const end0Y = northExt > 0 ? Math.max(sampleH(x0 + 18, 0) + 1.0, 28.5) : b.bank0Y;
  const end1Y = hasSouthCliff ? Math.min(deckY + 12.5, Math.max(sampleH(x1, 0), sampleH(x1, -13.8), sampleH(x1, 13.8)) + 0.6) : b.bank1Y;
  const deckYFn = makeDeckProfile(x0, x1, deckY, end0Y, end1Y, 2.4, wc, sampleH, 13.8, { allowSteepDrop0: northExt > 0 });
  const trussDepth = 10.6;

  // 1. 6-Lane Upper Roadway + Sidewalks + Streetlamps
  const deckInfo = buildRoadDeck(K, {
    x0, x1,
    deckY: deckYFn,
    roadW: 22.4,
    sidewalkW: 2.4,
    medianW: 1.4,
    lanesPerSide: 3,
    slabDepth: 0.90,
    step: 18,
    lampSpacing: 30,
    lampSide: 'both',
    railColor: PAL.steelSilver,
    edgeLight: PAL.ledGold,
  });
  emitBridgeDeckAndLights(b, deckInfo, outDecks, outLights, [1.0, 0.80, 0.48], 34, 650);

  // 2. Coral/Orange-Red Double-Deck Steel Truss across main arch span (carrying CRT Line 3 below)
  buildDoubleDeckTruss(K, {
    x0: xC - S * 0.5, x1: xC + S * 0.5,
    upperY: deckYFn,
    trussDepth,
    trussHalfW: 13.8,
    bayLen: 14.0,
    steelMat: PAL.cqCoral,
    darkMat: PAL.cqRedDark,
    trackSep: 4.4,
    nightStrip: PAL.ledGold,
  });

  // Continuous concrete box-girder approach viaducts + rhythmic piers on BOTH sides out to abutments!
  buildApproachViaduct(K, { a: x0 + 20, e: xC - S * 0.5, deckYFn, sampleH, waterY, roadW: 24.4, pierSpacing: 72, girderDepth: 4.4, outPrisms, b });
  buildApproachViaduct(K, { a: xC + S * 0.5, e: x1 - 20, deckYFn, sampleH, waterY, roadW: 24.4, pierSpacing: 72, girderDepth: 4.4, outPrisms, b });

  // 3. ICONIC CONCRETE Y-SHAPED RIGID-FRAME MAIN PIERS (x = xC ± S/2)
  const yYStemTop = waterY + 24.0;
  const yYArmTop = deckY - trussDepth;
  for (const sg of [-1, 1]) {
    const xp = xC + sg * S * 0.5;
    const baseY = Math.min(sampleH(xp, 0) - 10, waterY - 14);
    // Submerged cutwater foundation
    useMat(K, PAL.concWet);
    sweepProfile(K, [
      makeFrame([xp, baseY, 0], [0, 1, 0], [1, 0, 0]),
      makeFrame([xp, waterY + 4.5, 0], [0, 1, 0], [1, 0, 0]),
    ], cutwaterProfile(20.0, 34.0, 5.0), true);
    // Sculpted central concrete pier stem
    useMat(K, PAL.concPylon);
    sweepProfile(K, [
      makeFrame([xp, waterY + 4.2, 0], [0, 1, 0], [1, 0, 0]),
      makeFrame([xp, yYStemTop, 0], [0, 1, 0], [1, 0, 0]),
    ], chamferRect(27.0, 11.5, 1.4), true);

    // Sweeping Twin Concrete Y-Arms splitting outward (±36m along bridge!)
    for (const armDir of [-1, 1]) {
      const armFrames = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const ax = xp + armDir * 36.0 * t;
        const ay = yYStemTop - 3.0 + (yYArmTop - (yYStemTop - 3.0)) * Math.pow(t, 0.85);
        armFrames.push(makeFrame([ax, ay, 0], [armDir * 36, yYArmTop - yYStemTop, 0]));
      }
      useMat(K, PAL.concPylon);
      sweepProfile(K, armFrames, (i, t) => chamferRect(26.5 - t * 2.5, 6.2 - t * 1.4, 0.7), true);
    }
    // Horizontal prestressed tie slab at top of Y-frame
    K.box(xp, yYArmTop - 1.6, 0, 74.0, 3.2, 24.5);

    const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xp, 0, 0);
    outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: b.rotY, hx: 8.5, hz: 15, base: baseY, top: yYArmTop });
  }

  // 4. VIBRANT CORAL-ORANGE BASKET-HANDLE STEEL TIED ARCH (leaning inward ~10°!)
  const archSpan = S - 64; // Springs from inner tips of the concrete Y-arms!
  const ySpring = yYArmTop - 1.0;
  const yCrown = deckY + 86.0;
  const zBase = 16.4, zCrown = 10.0; // Basket-handle inward tilt!
  const archY = (x) => {
    const u = (2 * (x - xC)) / archSpan;
    return ySpring + (yCrown - ySpring) * (1 - u * u);
  };
  const archZ = (x) => {
    const u = Math.min(1, Math.abs((2 * (x - xC)) / archSpan));
    return zCrown + (zBase - zCrown) * (u * u);
  };

  const N = 30;
  for (const sg of [-1, 1]) {
    const ptsBot = [], ptsTop = [];
    for (let i = 0; i <= N; i++) {
      const x = xC - archSpan * 0.5 + archSpan * (i / N);
      const y = archY(x), z = sg * archZ(x);
      const ribDepth = 4.4 + 2.8 * Math.abs((2 * i) / N - 1);
      ptsBot.push([x, y, z]);
      ptsTop.push([x, y + ribDepth, z * 0.96]);
    }
    const buildRibChord = (pts, w, h) => {
      const fr = pts.map((p, i) => makeFrame(p, vSub(pts[Math.min(N, i + 1)], pts[Math.max(0, i - 1)])));
      useMat(K, PAL.cqCoral);
      sweepProfile(K, fr, chamferRect(w, h, 0.14), true);
    };
    buildRibChord(ptsBot, 2.0, 2.0);
    buildRibChord(ptsTop, 1.85, 1.85);
    // Zigzag truss web inside each tilted basket-handle arch rib
    useMat(K, PAL.cqCoral);
    for (let i = 0; i < N; i++) {
      steelBeam(K, ptsBot[i], ptsTop[i], 0.72, 0.72, [1, 0, 0], false);
      steelBeam(K, i % 2 === 0 ? ptsBot[i] : ptsTop[i], i % 2 === 0 ? ptsTop[i + 1] : ptsBot[i + 1], 0.65, 0.65, [0, 1, 0], false);
    }
    // Glowing golden-coral night rib accent strictly proud of outer chord (>= 8cm clear!)
    useMat(K, PAL.ledGold);
    const frLed = ptsBot.map((p, i) => makeFrame(p, vSub(ptsBot[Math.min(N, i + 1)], ptsBot[Math.max(0, i - 1)])));
    sweepProfile(K, frLed, chamferRect(0.20, 0.22, 0, sg * 1.20, 0), false);
  }

  // Overhead X-braced lateral wind struts tying the leaning basket-handle ribs
  for (let i = 4; i <= N - 4; i += 2) {
    const x = xC - archSpan * 0.5 + archSpan * (i / N);
    const y = archY(x) + 2.4, z = archZ(x);
    if (y < deckY + 14) continue;
    useMat(K, PAL.cqCoral);
    steelBeam(K, [x, y, -z], [x, y, z], 1.1, 1.15);
    if (i + 2 <= N - 4) {
      const xn = xC - archSpan * 0.5 + archSpan * ((i + 2) / N);
      const yn = archY(xn) + 2.4, zn = archZ(xn);
      if (yn > deckY + 14) {
        useMat(K, PAL.cqRedDark);
        steelBeam(K, [x, y, -z + 0.6], [xn, yn, zn - 0.6], 0.58, 0.58);
        steelBeam(K, [x, y, z - 0.6], [xn, yn, -zn + 0.6], 0.58, 0.58);
      }
    }
  }

  // Vertical twin steel hanger cables suspending double-deck truss from basket-handle ribs
  for (let i = 2; i <= N - 2; i++) {
    const x = xC - archSpan * 0.5 + archSpan * (i / N);
    const yA = archY(x), yd = deckYFn(x);
    if (yA < yd + 6.0) continue;
    for (const sg of [-1, 1]) {
      useMat(K, PAL.cableWhite);
      stayCable(K, [x, yd - 0.5, sg * 14.0], [x, yA - 0.5, sg * archZ(x)], 0.14, {
        sides: 6, anchorLen: 2.0, anchorR: 0.28, anchorMat: PAL.cqCoral,
      });
    }
  }

  const cyAb0 = { x: x0 + 20, deckY: deckYFn(x0 + 20), groundY: minBankGround(sampleH, x0 + 20, 13.8), width: 27.6, dir: 1, length: 24 };
  const cyAb1 = { x: x1 - 4, deckY: deckYFn(x1), groundY: minBankGround(sampleH, x1, 13.8), width: 27.6, dir: -1, length: 26 };
  buildAbutment(K, cyAb0); emitAbutmentPrism(b, outPrisms, cyAb0);
  buildAbutment(K, cyAb1); emitAbutmentPrism(b, outPrisms, cyAb1);
  if (hasSouthCliff) {
    // Grounded Chongqing hillside portal (南城隧道) framing Caiyuanba's south approach into Nan'an cliff (zero floating stub in t08!)
    const gy1 = minBankGround(sampleH, x1, 13.8);
    buildTunnelPortal(K, { x: x1, deckY: deckYFn(x1), groundY: gy1, width: 25.0, dir: -1 });
    const [pox, , poz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, x1, 0, 0);
    emitTunnelPortalPrisms(outPrisms, { ox: pox, oz: poz, ux: b.ux, uz: b.uz, ang: b.rotY, deckY: deckYFn(x1), groundY: gy1, width: 25.0, dir: -1 });
  }

  const [cwx, , cwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xC, 0, 0);
  outLights.push({ x: cwx, y: yCrown - 12, z: cwz, radius: 75, r: 1.0, g: 0.36, b: 0.14, intensity: 1100 });
}

// ---------------------------------------------------------------------------
// 5. 石板坡长江大桥 (Shibanpo Bridge — Twin Parallel Variable-Depth Haunched Concrete Box-Girder)
// ---------------------------------------------------------------------------
function buildShibanpoBridge(K, b, terrain, outPrisms, outDecks, outLights) {
  const sampleH = bridgeTerrainSample(terrain, b);
  const halfL = Math.max(b.length * 0.5, 480);
  // Extend North (p0) approach viaduct 145m across low riverbank park directly into the 52.5m Yuzhong cliffside!
  const northExt = (b.bank0Y != null && b.bank0Y < b.deckY - 18) ? 145 : 0;
  const x0 = -halfL - northExt, x1 = halfL;
  const waterY = b.waterY;
  const wc = findWaterChannel(sampleH, -halfL, halfL, waterY);
  const end0Y = northExt > 0 ? sampleH(x0 + 18, 0) : b.bank0Y;
  const deckYFn = makeDeckProfile(x0, x1, b.deckY, end0Y, b.bank1Y, 2.2, wc, sampleH, 14.8);

  // World-record 330m main haunched span centered over Yangtze water channel + flanking continuous spans
  const S = Math.min(b.mainSpan || 330, halfL * 0.78);
  const maxShift = Math.max(0, halfL - S * 0.5 - 120);
  const xC = Math.max(-maxShift, Math.min(maxShift, wc.xMid));
  const sideSpans = [138, 138, 138, 120];
  const piers = [xC - S * 0.5, xC + S * 0.5];
  for (const sg of [-1, 1]) {
    let cur = xC + sg * S * 0.5;
    for (const sp of sideSpans) {
      cur += sg * sp;
      if (cur > x0 + 35 && cur < x1 - 35) piers.push(cur);
    }
  }
  piers.sort((a, c) => a - c);

  // Parabolic haunched box-girder depth function: ~4.8m at mid-span, sweeping down to ~15.5m over main piers!
  const depthAt = (x) => {
    for (let i = 0; i + 1 < piers.length; i++) {
      const a = piers[i], e = piers[i + 1];
      if (x >= a && x <= e) {
        const u = (x - a) / (e - a);
        const spanL = e - a;
        const maxHaunch = spanL > 220 ? 11.2 : 5.8;
        return 4.6 + maxHaunch * Math.pow(Math.abs(2 * u - 1), 2.2);
      }
    }
    return 4.6;
  };

  // Twin parallel decks (separated by subtle 2.4m median gap — authentic Shibanpo Old + Duplicate twin bridges!)
  const deckInfo = buildRoadDeck(K, {
    x0, x1,
    deckY: deckYFn,
    roadW: 25.0,
    sidewalkW: 2.2,
    medianW: 2.2,
    lanesPerSide: 3,
    slabDepth: 0.75,
    step: 16,
    lampSpacing: 30,
    lampSide: 'both',
    railColor: PAL.steelSilver,
    edgeLight: PAL.ledGold,
  });
  emitBridgeDeckAndLights(b, deckInfo, outDecks, outLights, [1.0, 0.84, 0.54], 32, 620);

  // Twin parallel sculpted variable-depth haunched concrete box girders underneath
  const nSegs = Math.max(40, Math.round((x1 - x0) / 14));
  for (const sg of [-1, 1]) {
    const zc = sg * 7.6;
    const frames = [];
    for (let i = 0; i <= nSegs; i++) {
      const x = x0 + 18 + (x1 - x0 - 36) * (i / nSegs);
      frames.push(makeFrame([x, deckYFn(x) - 0.72, zc], [1, 0, 0]));
    }
    useMat(K, PAL.concViaduct);
    sweepProfile(K, frames, (i) => {
      const x = x0 + 18 + (x1 - x0 - 36) * (i / nSegs);
      const d = depthAt(x);
      return boxGirderProfile(14.0, 8.2, d, 0.85);
    }, true);
  }

  // Sleek twin-blade river piers beneath every pier station
  for (const xp of piers) {
    const d = depthAt(xp);
    const ty = sampleH(xp, 0);
    buildRiverPier(K, {
      x: xp,
      baseY: Math.min(ty - 10, waterY - 12),
      waterY,
      topY: deckYFn(xp) - 0.72 - d + 0.4,
      pierW: 24.5,
      shaftX: 4.4,
      shaftZ: 4.6,
    });
    const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xp, 0, 0);
    outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: b.rotY, hx: 3.5, hz: 13.5, base: waterY - 12, top: deckYFn(xp) - d });
  }
  const sAb0 = { x: x0 + 18, deckY: deckYFn(x0 + 18), groundY: minBankGround(sampleH, x0 + 18, 14.8), width: 30.0, dir: 1, length: 24 };
  const sAb1 = { x: x1 - 18, deckY: deckYFn(x1 - 18), groundY: minBankGround(sampleH, x1 - 18, 14.8), width: 30.0, dir: -1, length: 24 };
  buildAbutment(K, sAb0); emitAbutmentPrism(b, outPrisms, sAb0);
  buildAbutment(K, sAb1); emitAbutmentPrism(b, outPrisms, sAb1);
}

// ---------------------------------------------------------------------------
// 6. 嘉陵江大桥 (Jialing River Bridge — Classic Multi-Span Open-Spandrel Concrete Deck-Arch)
// ---------------------------------------------------------------------------
function buildJialingArchBridge(K, b, terrain, outPrisms, outDecks, outLights) {
  const sampleH = bridgeTerrainSample(terrain, b);
  const halfL = Math.max(b.length * 0.5, 240);
  const x0 = -halfL, x1 = halfL;
  const waterY = b.waterY;
  const wc = findWaterChannel(sampleH, x0, x1, waterY);
  const deckYFn = makeDeckProfile(x0, x1, b.deckY, b.bank0Y, b.bank1Y, 1.6, wc, sampleH, 10.6);

  const deckInfo = buildRoadDeck(K, {
    x0, x1,
    deckY: deckYFn,
    roadW: 16.0,
    sidewalkW: 2.4,
    medianW: 0.6,
    lanesPerSide: 2,
    slabDepth: 1.35,
    step: 14,
    lampSpacing: 26,
    lampSide: 'both',
    railColor: PAL.concBarrier,
    edgeLight: PAL.ledGold,
  });
  emitBridgeDeckAndLights(b, deckInfo, outDecks, outLights, [1.0, 0.84, 0.56], 30, 580);

  // 4 graceful parabolic concrete arch spans across the Jialing River
  const nSpans = Math.max(3, Math.round((x1 - x0 - 60) / 145));
  const spanL = (x1 - x0 - 50) / nSpans;
  const xStart = x0 + 25;
  const ySpring = waterY + 12.0;

  for (let s = 0; s < nSpans; s++) {
    const xa = xStart + s * spanL, xb = xa + spanL, xm = (xa + xb) * 0.5;
    const crownY = deckYFn(xm) - 2.6;
    const archY = (u) => ySpring + (crownY - ySpring) * (1 - (2 * u - 1) ** 2);

    // Twin sculpted concrete arch ribs per span
    const nSeg = 18;
    for (const sg of [-1, 1]) {
      const z = sg * 6.4;
      const frames = [];
      for (let i = 0; i <= nSeg; i++) {
        const u = i / nSeg;
        const x = xa + spanL * u;
        const y = archY(u);
        const dy = -4 * (crownY - ySpring) * (2 * u - 1) / spanL;
        frames.push(makeFrame([x, y, z], [1, dy, 0]));
      }
      useMat(K, PAL.concPylon);
      sweepProfile(K, frames, (i) => {
        const u = i / nSeg;
        const dep = 2.1 + 1.8 * (2 * u - 1) ** 2;
        return chamferRect(2.6, dep, 0.25);
      }, true);
    }
    // Transverse arch braces & open-spandrel vertical columns carrying the roadway slab
    const nCols = 8;
    useMat(K, PAL.concLight);
    for (let k = 1; k < nCols; k++) {
      const u = k / nCols;
      const x = xa + spanL * u, yA = archY(u), yTop = deckYFn(x) - 1.25;
      if (yTop - yA > 1.8) {
        for (const sg of [-1, 1]) K.box(x, (yA + yTop) * 0.5, sg * 6.4, 1.35, yTop - yA, 1.55);
        K.box(x, yTop - 0.65, 0, 1.45, 1.25, 15.6); // transverse cap beam
      }
      if (k % 2 === 0) K.box(x, yA, 0, 1.2, 1.1, 12.8); // lateral arch rib strut
    }
  }

  // Stone-clad cutwater piers at arch springings
  for (let s = 0; s <= nSpans; s++) {
    const xp = xStart + s * spanL;
    const ty = sampleH(xp, 0);
    buildRiverPier(K, {
      x: xp,
      baseY: Math.min(ty - 10, waterY - 12),
      waterY,
      topY: deckYFn(xp) - 1.4,
      pierW: 16.8,
      shaftX: 4.8,
      shaftZ: 4.2,
      singleShaft: true,
    });
    const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xp, 0, 0);
    outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: b.rotY, hx: 3.5, hz: 9.0, base: waterY - 12, top: deckYFn(xp) - 2 });
  }
  const jAb0 = { x: x0 + 20, deckY: deckYFn(x0 + 20), groundY: minBankGround(sampleH, x0 + 20, 10.6), width: 21.6, dir: 1, length: 24 };
  const jAb1 = { x: x1 - 20, deckY: deckYFn(x1 - 20), groundY: minBankGround(sampleH, x1 - 20, 10.6), width: 21.6, dir: -1, length: 24 };
  buildAbutment(K, jAb0); emitAbutmentPrism(b, outPrisms, jAb0);
  buildAbutment(K, jAb1); emitAbutmentPrism(b, outPrisms, jAb1);
}

// ---------------------------------------------------------------------------
// 7. 渝澳大桥 / 黄花园大桥 (Continuous Variable-Depth Haunched Concrete Box-Girder)
// ---------------------------------------------------------------------------
function buildHaunchedBoxBridge(K, b, terrain, outPrisms, outDecks, outLights) {
  const sampleH = bridgeTerrainSample(terrain, b);
  const halfL = Math.max(b.length * 0.5, 260);
  const x0 = -halfL, x1 = halfL;
  const waterY = b.waterY;
  const wc = findWaterChannel(sampleH, x0, x1, waterY);
  const deckYFn = makeDeckProfile(x0, x1, b.deckY, b.bank0Y, b.bank1Y, 2.0, wc, sampleH, 11.4);
  const S = Math.min(b.mainSpan || 220, halfL * 0.72);
  const maxShift = Math.max(0, halfL - S * 0.5 - 80);
  const xC = Math.max(-maxShift, Math.min(maxShift, wc.xMid));
  const piers = [xC - S * 0.5, xC + S * 0.5];
  const sideSp = Math.max(95, Math.min(145, b.sideSpan || 125));
  for (const sg of [-1, 1]) {
    let cx = xC + sg * S * 0.5 + sg * sideSp;
    while (cx > x0 + 35 && cx < x1 - 35) { piers.push(cx); cx += sg * sideSp; }
  }
  piers.sort((a, c) => a - c);

  const depthAt = (x) => {
    for (let i = 0; i + 1 < piers.length; i++) {
      const a = piers[i], e = piers[i + 1];
      if (x >= a && x <= e) {
        const u = (x - a) / (e - a);
        const h = (e - a) > 180 ? 8.2 : 4.5;
        return 3.8 + h * Math.pow(2 * u - 1, 2.0);
      }
    }
    return 3.8;
  };

  const roadW = b.width ? Math.max(14, Math.min(24, b.width - 4)) : 19.0;
  const deckInfo = buildRoadDeck(K, {
    x0, x1,
    deckY: deckYFn,
    roadW,
    sidewalkW: 2.2,
    medianW: 1.2,
    lanesPerSide: roadW > 18 ? 3 : 2,
    slabDepth: 0.75,
    step: 16,
    lampSpacing: 30,
    lampSide: 'both',
    railColor: PAL.steelSilver,
    edgeLight: PAL.ledGold,
  });
  emitBridgeDeckAndLights(b, deckInfo, outDecks, outLights, [1.0, 0.82, 0.52], 32, 600);

  const nSegs = Math.max(32, Math.round((x1 - x0) / 14));
  const frames = [];
  for (let i = 0; i <= nSegs; i++) {
    const x = x0 + 18 + (x1 - x0 - 36) * (i / nSegs);
    frames.push(makeFrame([x, deckYFn(x) - 0.72, 0], [1, 0, 0]));
  }
  useMat(K, PAL.concViaduct);
  sweepProfile(K, frames, (i) => {
    const x = x0 + 18 + (x1 - x0 - 36) * (i / nSegs);
    return boxGirderProfile(roadW + 3.4, roadW * 0.58, depthAt(x), 0.75);
  }, true);

  for (const xp of piers) {
    const d = depthAt(xp), ty = sampleH(xp, 0);
    buildRiverPier(K, {
      x: xp,
      baseY: Math.min(ty - 10, waterY - 12),
      waterY,
      topY: deckYFn(xp) - 0.72 - d + 0.4,
      pierW: roadW * 0.72,
      shaftX: 3.8,
      shaftZ: 3.6,
    });
    const [pwx, , pwz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, xp, 0, 0);
    outPrisms.push({ type: 'rect', x: pwx, z: pwz, ang: b.rotY, hx: 3.0, hz: roadW * 0.4, base: waterY - 12, top: deckYFn(xp) - d });
  }
  const hAb0 = { x: x0 + 18, deckY: deckYFn(x0 + 18), groundY: minBankGround(sampleH, x0 + 18, (roadW + 4.8) * 0.5), width: roadW + 4.8, dir: 1, length: 22 };
  const hAb1 = { x: x1 - 18, deckY: deckYFn(x1 - 18), groundY: minBankGround(sampleH, x1 - 18, (roadW + 4.8) * 0.5), width: roadW + 4.8, dir: -1, length: 22 };
  buildAbutment(K, hAb0); emitAbutmentPrism(b, outPrisms, hAb0);
  buildAbutment(K, hAb1); emitAbutmentPrism(b, outPrisms, hAb1);
}

// ---------------------------------------------------------------------------
// 8. 苏家坝立交 (Sujiaba 72m Spiral Helical Overpass!)
//    Towering slender twin-column concrete piers + dramatic 360°+ helical spiral ramp:
//    - Entry enters from the South uphill ridge (<= 6.5% gentle highway grade, ZERO blind crest / floating stub!)
//    - Spiral circles smoothly at ~4.5% grade & exits gently Eastward along contour into a grounded hillside portal (<= 7.5%!)
//    - Double-deck overlap arc uses tightly-hugged straddle portal bents (ZERO pier punch-through, ZERO protruding posts!)
// ---------------------------------------------------------------------------
function buildSujiabaSpiral(K, b, terrain, outPrisms, outDecks, outLights) {
  const cx = b.x, cz = b.z;
  const groundCenter = terrain.sample(cx, cz);
  const R = b.radius ?? 56.0;
  let maxRingGround = groundCenter;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const ty = terrain.sample(cx + Math.cos(a) * R, cz + Math.sin(a) * R);
    if (ty > maxRingGround) maxRingGround = ty;
  }
  const rampW = Math.max(10.6, Math.min(12.4, b.width ?? 11.4));
  const hw = rampW * 0.5;

  // Helical spiral: 1.48 turns starting at West-SW (aStart = 0.88*PI) so entry enters gently from the South hilltop
  // strictly INSIDE the r=122m building-free zone (<= 6.5% grade!), spirals 1.48 turns down from 167.5m to 148.5m
  // (double-decking dramatically over the 95-110m North/West canyon with >= 10.6m clear stacked headroom!),
  // and exits gently SSE along contour into the 149m ESE hillside plateau (<= 6.5% grade, flush tunnel portals at both ends!).
  const aStart = 0.88 * Math.PI;
  const turnsUse = 1.48;
  const aEndUse = aStart + turnsUse * TAU;
  // 165.2m -> 150.2m across 1.48 turns = 10.14m/turn (~7.9m clear vertical headroom between double-deck spans!)
  // Soars 55-68m above the 95-110m North/West canyon AND lands BOTH entry & exit flush (clr <= 1.5m)
  // strictly INSIDE the r=122m building-free zone at <= 6.8% grade!
  const topYUse = Math.max(maxRingGround + 10.0, 165.2);
  const botYUse = Math.max(topYUse - 15.0, 150.2);

  const sampleWideMax = (x, z, tx, tz) => {
    const rx = -tz, rz = tx;
    return Math.max(
      terrain.sample(x, z),
      terrain.sample(x + rx * hw, z + rz * hw),
      terrain.sample(x - rx * hw, z - rz * hw),
    );
  };

  // Build world-space 3D spline with strict <= 6.8% grade on BOTH approaches!
  const pts = [];
  const t0x = -Math.sin(aStart), t0z = Math.cos(aStart);
  const x0 = cx + Math.cos(aStart) * R, z0 = cz + Math.sin(aStart) * R;
  // March BACKWARD from spiral start along -t0 (+0.37, +0.93 = SSE uphill ridge!) at <= 6.8% grade until meeting terrain!
  const entryPts = [];
  let ey = topYUse;
  const stepA = 10.0;
  for (let k = 1; k <= 10; k++) {
    const px = x0 - t0x * (k * stepA), pz = z0 - t0z * (k * stepA);
    const dem = sampleWideMax(px, pz, t0x, t0z);
    const prevY = ey;
    const target = dem + 0.45;
    const dy = Math.max(-stepA * 0.068, Math.min(stepA * 0.068, target - ey));
    ey += dy;
    if (k >= 4 && ey <= dem + 1.4) {
      // Exact terrain-contact stop (no steep upward flick at final step!)
      const prevPx = x0 - t0x * ((k - 1) * stepA), prevPz = z0 - t0z * ((k - 1) * stepA);
      const prevDem = sampleWideMax(prevPx, prevPz, t0x, t0z);
      const c0 = prevY - (prevDem + 0.55), c1 = ey - (dem + 0.55);
      const frac = c0 > c1 + 1e-3 ? Math.max(0.2, Math.min(1.0, c0 / (c0 - c1))) : 1.0;
      const fx = prevPx + (px - prevPx) * frac, fz = prevPz + (pz - prevPz) * frac;
      const fDem = sampleWideMax(fx, fz, t0x, t0z);
      entryPts.push([fx, Math.max(fDem + 0.45, prevY + (ey - prevY) * frac), fz]);
      break;
    }
    ey = Math.max(dem + 0.45, ey);
    entryPts.push([px, ey, pz]);
  }
  for (let i = entryPts.length - 1; i >= 0; i--) pts.push(entryPts[i]);

  // Helical spiral loop (1.48 turns, constant smooth descent clearing all hillside ground & >= 7.9m stacked headroom!)
  const nSpiral = 84;
  for (let i = 0; i <= nSpiral; i++) {
    const f = i / nSpiral;
    const a = aStart + f * (turnsUse * TAU);
    const px = cx + Math.cos(a) * R, pz = cz + Math.sin(a) * R;
    const py = Math.max(sampleWideMax(px, pz, -Math.sin(a), Math.cos(a)) + 2.0, topYUse + (botYUse - topYUse) * f);
    pts.push([px, py, pz]);
  }

  // March FORWARD from spiral exit along +t1 (+0.48, +0.88 = SSE toward 150m plateau!) at <= 6.8% grade until meeting terrain!
  const t1x = -Math.sin(aEndUse), t1z = Math.cos(aEndUse);
  const xEnd = cx + Math.cos(aEndUse) * R, zEnd = cz + Math.sin(aEndUse) * R;
  let xyY = pts[pts.length - 1][1];
  for (let k = 1; k <= 10; k++) {
    const px = xEnd + t1x * (k * stepA), pz = zEnd + t1z * (k * stepA);
    const dem = sampleWideMax(px, pz, t1x, t1z);
    const prevY = xyY;
    const target = dem + 0.45;
    const dy = Math.max(-stepA * 0.068, Math.min(stepA * 0.068, target - xyY));
    xyY += dy;
    if (k >= 4 && xyY <= dem + 1.4) {
      const prevPx = xEnd + t1x * ((k - 1) * stepA), prevPz = zEnd + t1z * ((k - 1) * stepA);
      const prevDem = sampleWideMax(prevPx, prevPz, t1x, t1z);
      const c0 = prevY - (prevDem + 0.55), c1 = xyY - (dem + 0.55);
      const frac = c0 > c1 + 1e-3 ? Math.max(0.2, Math.min(1.0, c0 / (c0 - c1))) : 1.0;
      const fx = prevPx + (px - prevPx) * frac, fz = prevPz + (pz - prevPz) * frac;
      const fDem = sampleWideMax(fx, fz, t1x, t1z);
      pts.push([fx, Math.max(fDem + 0.45, prevY + (xyY - prevY) * frac), fz]);
      break;
    }
    xyY = Math.max(dem + 0.45, xyY);
    pts.push([px, xyY, pz]);
  }

  // Gentle 2-pass vertical smoothing across spline joints (eliminating spiral-to-exit grade bump while staying >= dem+0.45m!)
  for (let pass = 0; pass < 2; pass++) {
    const prev = pts.map((p) => p[1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const dx = pts[i + 1][0] - pts[i - 1][0], dz = pts[i + 1][2] - pts[i - 1][2];
      const dl = Math.hypot(dx, dz) || 1;
      const dem = sampleWideMax(p[0], p[2], dx / dl, dz / dl);
      p[1] = Math.max(dem + 0.45, 0.25 * prev[i - 1] + 0.50 * prev[i] + 0.25 * prev[i + 1]);
    }
  }

  const spline = new Spline3D(pts, 2);
  const nSegs = 112;
  const frames = spline.framesRange(0, spline.length, nSegs);

  // 1. Sculpted Winged Concrete Curved Box Girder (2.1m deep)
  useMat(K, PAL.concViaduct);
  sweepProfile(K, frames, boxGirderProfile(rampW + 0.8, rampW * 0.52, 2.25, 0.55), true);

  // 2. Curved Asphalt Wearing Surface + Lane Markings + Concrete Jersey Parapets + Outer Steel Guardrails (>= 6cm clearance -> ZERO Z-fight!)
  useMat(K, PAL.asphalt);
  sweepProfile(K, frames, chamferRect(rampW - 0.8, 0.08, 0, 0, 0.06), false);

  useMat(K, PAL.laneWhite);
  for (const sg of [-1, 1]) {
    sweepProfile(K, frames, chamferRect(0.14, 0.03, 0, sg * (hw - 0.65), 0.165), false);
  }
  for (let s = 4; s < spline.length - 6; s += 11) {
    const f0 = spline.sampleAt(s), fm = spline.sampleAt(Math.min(spline.length, s + 2.25)), f1 = spline.sampleAt(Math.min(spline.length, s + 4.5));
    const a = vAdd(f0.p, vScale(f0.U, 0.17)), m = vAdd(fm.p, vScale(fm.U, 0.17)), e = vAdd(f1.p, vScale(f1.U, 0.17));
    const r0 = vScale(f0.R, 0.075), rm = vScale(fm.R, 0.075), r1 = vScale(f1.R, 0.075);
    K.quad(vAdd(a, r0), vAdd(m, rm), vSub(m, rm), vSub(a, r0));
    K.quad(vAdd(m, rm), vAdd(e, r1), vSub(e, r1), vSub(m, rm));
  }

  for (const sg of [-1, 1]) {
    useMat(K, PAL.concBarrier);
    const rEdge = sg * (hw + 0.15);
    sweepProfile(K, frames, [
      [rEdge - 0.24, 0.04], [rEdge + 0.24, 0.04],
      [rEdge + 0.20, 0.98], [rEdge - 0.20, 0.98],
    ], true);
    useMat(K, PAL.steelSilver);
    sweepProfile(K, frames, chamferRect(0.10, 0.10, 0, rEdge, 1.32), false);
    // Cleanly >= 9cm outside box girder edge (±(hw + 0.40))!
    useMat(K, PAL.ledGold);
    sweepProfile(K, frames, chamferRect(0.14, 0.16, 0, sg * (hw + 0.56), -0.45), false);
  }

  // Grounded stone & concrete earthwork abutments + hillside tunnel portals + solid wall colliders at BOTH entry & exit ends!
  for (const [isStart, fEnd] of [[true, frames[0]], [false, frames[frames.length - 1]]]) {
    const ang = Math.atan2(-fEnd.T[2], fEnd.T[0]);
    const dir = isStart ? 1 : -1;
    const gMin = Math.min(
      terrain.sample(fEnd.p[0], fEnd.p[2]),
      terrain.sample(fEnd.p[0] + fEnd.R[0] * hw, fEnd.p[2] + fEnd.R[2] * hw),
      terrain.sample(fEnd.p[0] - fEnd.R[0] * hw, fEnd.p[2] - fEnd.R[2] * hw),
    );
    K.push().translate(fEnd.p[0], 0, fEnd.p[2]).rotateY(ang);
    buildAbutment(K, { x: 0, deckY: fEnd.p[1], groundY: gMin, width: rampW + 0.8, dir, length: 16 });
    buildTunnelPortal(K, { x: 0, deckY: fEnd.p[1], groundY: gMin, width: rampW + 0.2, dir });
    K.pop();
    const hLen = Math.hypot(fEnd.T[0], fEnd.T[2]) || 1;
    const uxE = fEnd.T[0] / hLen, uzE = fEnd.T[2] / hLen;
    emitTunnelPortalPrisms(outPrisms, { ox: fEnd.p[0], oz: fEnd.p[2], ux: uxE, uz: uzE, ang, deckY: fEnd.p[1], groundY: gMin, width: rampW + 0.2, dir });
  }

  // Helper: find if another spiral segment passes directly below or above (px, pz)
  const findOverlapDeck = (sQuery, px, pz, pyQuery) => {
    let belowY = null, hasAbove = false;
    for (let i = 0; i < frames.length; i++) {
      const sOther = (i / (frames.length - 1)) * spline.length;
      if (Math.abs(sOther - sQuery) < 95) continue;
      const fp = frames[i].p;
      if (Math.hypot(fp[0] - px, fp[2] - pz) < rampW + 2.0) {
        if (fp[1] < pyQuery - 4.0) belowY = belowY === null ? fp[1] : Math.min(belowY, fp[1]);
        if (fp[1] > pyQuery + 4.0) hasAbove = true;
      }
    }
    return { belowY, hasAbove };
  };
  const colHitsLowerDeck = (qx, qz, pyTop, sSelf) => {
    for (let i = 0; i < frames.length; i++) {
      const sOther = (i / (frames.length - 1)) * spline.length;
      if (Math.abs(sOther - sSelf) < 60) continue;
      const fp = frames[i].p;
      if (fp[1] < pyTop - 2.5 && Math.hypot(fp[0] - qx, fp[2] - qz) < hw + 1.85) return true;
    }
    return false;
  };

  // 3. ICONIC 72-METER-TALL SLENDER TWIN-COLUMN PIERS + TIGHTLY-HUGGED STRADDLE PORTAL BENTS
  //    Strict max sep <= hw + 2.6m so ZERO concrete posts ever protrude out beside a deck into empty air!
  const pierStep = 28.0;
  for (let s = 24; s < spline.length - 22; s += pierStep) {
    let f = spline.sampleAt(s);
    const tryBuildAt = (sCand) => {
      const fc = spline.sampleAt(sCand);
      const px = fc.p[0], py = fc.p[1] - 2.25, pz = fc.p[2];
      const groundY = terrain.sample(px, pz);
      if (py < groundY + 3.2) return null;
      const { belowY, hasAbove } = findOverlapDeck(sCand, px, pz, fc.p[1]);
      if (hasAbove) return { skip: true };
      const isStraddle = belowY !== null;
      const sep = isStraddle ? (hw + 2.15) : (hw * 0.56);
      if (colHitsLowerDeck(px - fc.R[0] * sep, pz - fc.R[2] * sep, fc.p[1], sCand) ||
          colHitsLowerDeck(px + fc.R[0] * sep, pz + fc.R[2] * sep, fc.p[1], sCand)) return null;
      return { f: fc, px, py, pz, groundY, belowY, isStraddle, sep };
    };
    let plan = tryBuildAt(s);
    if (!plan) {
      for (const ds of [-9, 9, -15, 15]) {
        const sc = Math.max(20, Math.min(spline.length - 20, s + ds));
        plan = tryBuildAt(sc);
        if (plan) break;
      }
    }
    if (!plan || plan.skip) continue;
    const { px, py, pz, groundY, belowY, isStraddle, sep } = plan;
    f = plan.f;

    const gL = terrain.sample(px - f.R[0] * sep, pz - f.R[2] * sep);
    const gR = terrain.sample(px + f.R[0] * sep, pz + f.R[2] * sep);
    const pierBot = Math.min(groundY, gL, gR) - 12.0;

    // Upper transverse hammerhead cap beam directly flush beneath upper box girder
    const pLeft = vAdd([px, py - 1.1, pz], vScale(f.R, -(sep + 1.25)));
    const pRight = vAdd([px, py - 1.1, pz], vScale(f.R, sep + 1.25));
    useMat(K, PAL.concLight);
    steelBeam(K, pLeft, pRight, 2.3, 2.2, [0, 1, 0], true, 0.18);

    // Lower deck transverse cradle cap beam on double-deck straddle portal bents
    if (isStraddle) {
      const yLowCap = belowY - 2.25 - 1.0;
      const bLeft = vAdd([px, yLowCap, pz], vScale(f.R, -sep));
      const bRight = vAdd([px, yLowCap, pz], vScale(f.R, sep));
      steelBeam(K, bLeft, bRight, 2.2, 2.0, [0, 1, 0], true, 0.16);
    }

    // Slender twin chamfered concrete columns descending cleanly into slope
    useMat(K, PAL.concPylon);
    const cL0 = vAdd([px, pierBot, pz], vScale(f.R, -sep));
    const cL1 = vAdd([px, py - 2.0, pz], vScale(f.R, -sep));
    const cR0 = vAdd([px, pierBot, pz], vScale(f.R, sep));
    const cR1 = vAdd([px, py - 2.0, pz], vScale(f.R, sep));
    steelBeam(K, cL0, cL1, 1.85, 2.15, f.T, true, 0.22);
    steelBeam(K, cR0, cR1, 1.85, 2.15, f.T, true, 0.22);

    // Rhythmic horizontal concrete diaphragm tie-beams strictly BELOW the lowest deck
    const lowestClearY = isStraddle ? (belowY - 5.2) : (py - 2.0);
    const minG = Math.min(gL, gR);
    const nTies = Math.floor((lowestClearY - minG - 6) / 16);
    for (let t = 1; t <= nTies; t++) {
      const yt = lowestClearY - t * 16.0;
      if (yt < minG + 3.0) break;
      const tL = vAdd([px, yt, pz], vScale(f.R, -sep));
      const tR = vAdd([px, yt, pz], vScale(f.R, sep));
      steelBeam(K, tL, tR, 1.45, 1.75, [0, 1, 0], true, 0.12);
    }

    // Recessed concrete pile-cap collars at hillside contact
    useMat(K, PAL.concPier);
    for (const [sepSigned, gyC] of [[-sep, gL], [sep, gR]]) {
      const cPos = vAdd([px, 0, pz], vScale(f.R, sepSigned));
      K.box(cPos[0], gyC - 2.8, cPos[2], 3.0, 6.2, 3.0);
      outPrisms.push({ type: 'circle', x: cPos[0], z: cPos[2], r: 1.45, sides: 8, base: pierBot, top: py });
    }
  }

  // 4. Curved Ramp Architectural Streetlamps + Walkable Spiral Deck Colliders
  for (let s = 18; s < spline.length - 18; s += 28) {
    const f = spline.sampleAt(s);
    const base = vAdd(f.p, vScale(f.R, hw + 0.15));
    const tip = vAdd(vAdd(f.p, vScale(f.R, hw - 1.9)), [0, 8.6, 0]);
    useMat(K, PAL.steelDark);
    K.tube([base[0], base[1] + 0.8, base[2]], [base[0], base[1] + 8.3, base[2]], 0.12, 0.07, 6, true);
    K.tube([base[0], base[1] + 8.1, base[2]], tip, 0.06, 0.045, 5, true);
    useMat(K, PAL.lampWarm);
    K.box(tip[0], tip[1] - 0.08, tip[2], 0.65, 0.14, 0.65);
    outLights.push({ x: tip[0], y: tip[1] - 0.3, z: tip[2], radius: 30, r: 1.0, g: 0.80, b: 0.45, intensity: 640 });
  }

  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i].p, e = frames[i + 1].p;
    outDecks.push([a[0], a[2], a[1] + 0.10, e[0], e[2], e[1] + 0.10, hw - 0.25]);
  }
}

// ---------------------------------------------------------------------------
// 9. 黄角湾立交 (Huangjuewan 5-Level Stacked Mountain Expressway Interchange)
//    - Authentic <= 6.8% highway ramp grades (ZERO 35° rollercoaster ski-jumps!)
//    - Sleek 6.5m stacked crossing hub nestled cleanly inside the natural 340-375m mountain bowl
//    - Every ramp arm glides gracefully into a crisp 3D concrete hillside tunnel portal / grounded abutment (ZERO grass slicing!)
// ---------------------------------------------------------------------------
function buildHuangjuewanInterchange(K, b, terrain, outPrisms, outDecks, outLights) {
  const cx = b.x, cz = b.z;
  const centerDem = terrain.sample(cx, cz);
  const hubBaseY = centerDem + 12.2; // ~351.5m -> levels span 351.5..377.5m, sailing cleanly out over inner shoulders into all 10 hillside portals!

  // 5 sweeping directional expressway ramps whose ALL 10 arms (both + and -) aim directly at the natural
  // 348-385m surrounding hillside ridges (avoiding the lone 215-235° deep valley notch!):
  const levels = [
    { dy: 0.0,  ang: 0.00,  maxDist: 360, w: 11.4, curve: 0.0 },
    { dy: 6.5,  ang: 1.57,  maxDist: 360, w: 11.0, curve: 0.0 },
    { dy: 13.0, ang: 1.98,  maxDist: 340, w: 9.4,  curve: 22.0 },
    { dy: 19.5, ang: -0.74, maxDist: 340, w: 9.2,  curve: -22.0 },
    { dy: 26.0, ang: -0.26, maxDist: 370, w: 8.8,  curve: 16.0 },
  ];

  const MAX_GRADE = 0.062; // Silky <= 6.2% (3.5°) mountain highway ramp grade everywhere!

  // Pass 1: March outward from the central stacked hub (cx, cz) in both ±directions at <= 6.2% grade until hitting hillside!
  const builtLevels = [];
  for (const lv of levels) {
    const cs = Math.cos(lv.ang), sn = Math.sin(lv.ang);
    const hw = lv.w * 0.5;
    const targetHubY = hubBaseY + lv.dy;
    const evalXY = (along) => {
      const u = Math.max(-1, Math.min(1, along / 260));
      const side = Math.sin(u * Math.PI) * lv.curve;
      return [cx + cs * along - sn * side, cz + sn * along + cs * side];
    };
    const sampleWideMax = (along) => {
      const [wx, wz] = evalXY(along);
      const [nx, nz] = evalXY(along + 4.0);
      const dx = nx - wx, dz = nz - wz, l = Math.hypot(dx, dz) || 1;
      const rx = -dz / l, rz = dx / l;
      return Math.max(
        terrain.sample(wx, wz),
        terrain.sample(wx + rx * hw, wz + rz * hw),
        terrain.sample(wx - rx * hw, wz - rz * hw),
      );
    };

    const yHub = Math.max(targetHubY, sampleWideMax(0) + 3.2);
    const marchArm = (sign) => {
      const arm = [];
      const step = 10.0;
      let yCur = yHub;
      let prevAlong = 0;
      let prevDem = sampleWideMax(0);
      for (let d = step; d <= lv.maxDist; d += step) {
        const along = sign * d;
        const [wx, wz] = evalXY(along);
        const dem = sampleWideMax(along);
        const prevY = yCur;
        // Inside the central 42m stacked hub stay flat; outside, glide smoothly toward hillside at <= 6.2% grade!
        if (d > 42) {
          const desired = dem + 1.4;
          const dy = Math.max(-step * MAX_GRADE, Math.min(step * MAX_GRADE, desired - yCur));
          yCur += dy;
        }
        // The moment a rising mountainside meets our smooth viaduct, interpolate exact intersection at <= 6.2% grade!
        // (Zero upward ski-tip flick on the final segment — crisp concrete tunnel portal cleanly embedded into hillside!)
        if (d >= 60 && yCur <= dem + 1.6) {
          const c0 = prevY - (prevDem + 0.65);
          const c1 = yCur - (dem + 0.65);
          const frac = c0 > c1 + 1e-3 ? Math.max(0.25, Math.min(1.0, c0 / (c0 - c1))) : 0.6;
          const hitAlong = prevAlong + (along - prevAlong) * frac;
          const [hx2, hz2] = evalXY(hitAlong);
          const hitDem = sampleWideMax(hitAlong);
          const hitY = Math.max(hitDem + 0.50, prevY + (yCur - prevY) * frac);
          // Only append if final step doesn't exceed 7.2% grade; otherwise terminate at previous clear point!
          const distSeg = Math.max(1.0, Math.abs(hitAlong - prevAlong));
          if (Math.abs(hitY - prevY) / distSeg <= 0.072) {
            arm.push([hx2, hitY, hz2]);
          }
          return { pts: arm, hitHill: true };
        }
        if (yCur < dem + 1.6) {
          // Early inner-shoulder brush: never jump steeply, enter portal cleanly if past d>=50
          if (d >= 50) return { pts: arm, hitHill: true };
          yCur = Math.min(dem + 1.6, prevY + step * 0.068);
        }
        arm.push([wx, yCur, wz]);
        prevAlong = along;
        prevDem = dem;
      }
      return { pts: arm, hitHill: false };
    };

    const neg = marchArm(-1);
    const pos = marchArm(1);
    const [hx, hz] = evalXY(0);
    const pts = [];
    for (let i = neg.pts.length - 1; i >= 0; i--) pts.push(neg.pts[i]);
    pts.push([hx, yHub, hz]);
    for (let i = 0; i < pos.pts.length; i++) pts.push(pos.pts[i]);

    // Gentle 2-pass vertical smoothing (preserving terrain clearance >= +0.50m & silky <= 7.0% grade everywhere)
    for (let pass = 0; pass < 2; pass++) {
      const prev = pts.map((p) => p[1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        const dem = Math.max(terrain.sample(p[0], p[2]), terrain.sample(p[0] + hw, p[2]), terrain.sample(p[0] - hw, p[2]));
        p[1] = Math.max(dem + 0.50, 0.22 * prev[i - 1] + 0.56 * prev[i] + 0.22 * prev[i + 1]);
      }
    }

    const sp = new Spline3D(pts, 2);
    const fr = sp.framesRange(0, sp.length, Math.max(24, Math.round(sp.length / 10)));
    builtLevels.push({ lv, sp, fr, negHill: neg.hitHill, posHill: pos.hitHill });
  }

  // Pass 2: Emit decks, architectural mountain tunnel portals / abutments, and non-colliding piers!
  for (let li = 0; li < builtLevels.length; li++) {
    const { lv, sp, fr, negHill, posHill } = builtLevels[li];
    const hw = lv.w * 0.5;
    useMat(K, PAL.concViaduct);
    sweepProfile(K, fr, boxGirderProfile(lv.w + 0.6, lv.w * 0.52, 1.8, 0.45), true);
    useMat(K, PAL.asphalt);
    sweepProfile(K, fr, chamferRect(lv.w - 0.7, 0.08, 0, 0, 0.06), false);
    for (const sg of [-1, 1]) {
      useMat(K, PAL.concBarrier);
      sweepProfile(K, fr, chamferRect(0.36, 0.92, 0.04, sg * hw, 0.50), false);
      // Cleanly >= 8cm outside box girder outer fascia (±(hw + 0.30)) -> ZERO Z-fighting!
      useMat(K, PAL.ledGold);
      sweepProfile(K, fr, chamferRect(0.12, 0.14, 0, sg * (hw + 0.46), -0.35), false);
    }

    // Crisp 3D Concrete Tunnel Portal or Grounded Abutment + solid cheek-wall colliders at BOTH ends!
    for (const [isStart, fEnd, hitHill] of [[true, fr[0], negHill], [false, fr[fr.length - 1], posHill]]) {
      const ang = Math.atan2(-fEnd.T[2], fEnd.T[0]);
      const dir = isStart ? 1 : -1;
      const gMin = Math.min(
        terrain.sample(fEnd.p[0], fEnd.p[2]),
        terrain.sample(fEnd.p[0] + fEnd.R[0] * hw, fEnd.p[2] + fEnd.R[2] * hw),
        terrain.sample(fEnd.p[0] - fEnd.R[0] * hw, fEnd.p[2] - fEnd.R[2] * hw),
      );
      K.push().translate(fEnd.p[0], 0, fEnd.p[2]).rotateY(ang);
      if (hitHill || fEnd.p[1] - gMin <= 7.0) {
        buildTunnelPortal(K, { x: 0, deckY: fEnd.p[1], groundY: gMin, width: lv.w + 0.2, dir });
        const hLen = Math.hypot(fEnd.T[0], fEnd.T[2]) || 1;
        emitTunnelPortalPrisms(outPrisms, { ox: fEnd.p[0], oz: fEnd.p[2], ux: fEnd.T[0] / hLen, uz: fEnd.T[2] / hLen, ang, deckY: fEnd.p[1], groundY: gMin, width: lv.w + 0.2, dir });
      } else {
        buildAbutment(K, { x: 0, deckY: fEnd.p[1], groundY: gMin, width: lv.w + 0.6, dir, length: 16 });
      }
      K.pop();
    }

    // Non-colliding concrete piers clearing ALL lower ramps!
    const hitsLowerRamp = (px, pz, py) => {
      for (let lj = 0; lj < li; lj++) {
        const lower = builtLevels[lj];
        const minDist = lower.lv.w * 0.5 + 2.5;
        for (const lf of lower.fr) {
          if (lf.p[1] < py - 2.0 && Math.hypot(lf.p[0] - px, lf.p[2] - pz) < minDist) return true;
        }
      }
      return false;
    };

    for (let s = 26; s < sp.length - 22; s += 34) {
      let f = sp.sampleAt(s);
      if (hitsLowerRamp(f.p[0], f.p[2], f.p[1])) {
        let found = false;
        for (const ds of [-12, 12, -20, 20]) {
          const sc = Math.max(18, Math.min(sp.length - 18, s + ds));
          const fc = sp.sampleAt(sc);
          if (!hitsLowerRamp(fc.p[0], fc.p[2], fc.p[1])) { f = fc; found = true; break; }
        }
        if (!found) continue;
      }
      const gy = terrain.sample(f.p[0], f.p[2]);
      const pierTop = f.p[1] - 1.8;
      if (pierTop <= gy + 1.8) continue;
      useMat(K, PAL.concPylon);
      steelBeam(K, [f.p[0], gy - 12, f.p[2]], [f.p[0], pierTop, f.p[2]], 2.0, 2.0, f.T, true, 0.2);
      useMat(K, PAL.concLight);
      const cL = vAdd([f.p[0], pierTop - 0.5, f.p[2]], vScale(f.R, -hw * 0.65));
      const cR = vAdd([f.p[0], pierTop - 0.5, f.p[2]], vScale(f.R, hw * 0.65));
      steelBeam(K, cL, cR, 1.8, 1.4, [0, 1, 0], true, 0.14);
      outPrisms.push({ type: 'circle', x: f.p[0], z: f.p[2], r: 1.45, sides: 8, base: gy - 14, top: pierTop });
    }
    for (let i = 0; i < fr.length - 1; i++) {
      const a = fr[i].p, e = fr[i + 1].p;
      outDecks.push([a[0], a[2], a[1] + 0.1, e[0], e[2], e[1] + 0.1, lv.w * 0.46]);
    }
  }
  outLights.push({ x: cx, y: hubBaseY + 30, z: cz, radius: 95, r: 1.0, g: 0.78, b: 0.44, intensity: 1150 });
}

// ---------------------------------------------------------------------------
// Module Entry Point: buildBridges(ctx)
// ---------------------------------------------------------------------------
export function buildBridges(ctx) {
  const { data, terrain, materials } = ctx;
  const waterY = terrain?.riverY ?? data?.waterY ?? 0;
  const group = new THREE.Group();
  group.name = 'hero-bridges';
  const movingGroup = new THREE.Group();
  movingGroup.name = 'hero-bridges-moving-shadow';

  const prisms = [];
  const decks = [];
  const lights = [];
  const labels = [];
  const animSpecs = [];

  // Collect bridge definitions from landmarks.json (bridges list + bridgesById map) with fallbacks
  const byId = new Map();
  if (Array.isArray(data?.bridges)) {
    for (const raw of data.bridges) {
      if (!raw) continue;
      const b = normalizeBridge(raw, waterY);
      byId.set(b.id, b);
    }
  }
  if (data?.bridgesById && typeof data.bridgesById === 'object') {
    for (const [key, raw] of Object.entries(data.bridgesById)) {
      if (!raw) continue;
      const b = normalizeBridge({ id: key, ...raw }, waterY);
      byId.set(b.id, b);
    }
  }
  // Ensure iconic Chongqing bridges are always present even before full pipeline data lands
  if (byId.size === 0) {
    for (const raw of FALLBACK_BRIDGES) {
      const b = normalizeBridge(raw, waterY);
      byId.set(b.id, b);
    }
  }

  const bridgeMat = materials?.heroMatNoFlood || materials?.heroMat;

  for (const b of byId.values()) {
    const K = new HeroKit();
    const id = b.id;
    const kind = (b.kind || id).toLowerCase();
    const isWorldSpace = (id === 'sujiaba' || kind === 'sujiaba' || kind === 'spiral_overpass' || kind === 'spiral' || id === 'huangjuewan' || kind === 'multilevel_interchange' || kind === 'interchange');

    if (id.includes('qiansimen') || kind === 'qiansimen' || kind === 'cable_shuttle_1') {
      buildQiansimenBridge(K, b, terrain, prisms, decks, lights, animSpecs);
    } else if (id.includes('dongshuimen') || kind === 'dongshuimen' || kind === 'cable_shuttle_2') {
      buildDongshuimenBridge(K, b, terrain, prisms, decks, lights, animSpecs);
    } else if (id.includes('chaotianmen') || kind === 'chaotianmen' || kind === 'arch_truss' || kind === 'arch_truss_red') {
      buildChaotianmenBridge(K, b, terrain, prisms, decks, lights, animSpecs);
    } else if (id.includes('caiyuanba') || kind === 'caiyuanba' || kind === 'arch_basket' || kind === 'arch_y_frame') {
      buildCaiyuanbaBridge(K, b, terrain, prisms, decks, lights);
    } else if (id.includes('shibanpo') || kind === 'shibanpo' || kind === 'box_twin') {
      buildShibanpoBridge(K, b, terrain, prisms, decks, lights);
    } else if (id.includes('jialing') || kind === 'jialing' || kind === 'arch_concrete') {
      buildJialingArchBridge(K, b, terrain, prisms, decks, lights);
    } else if (id.includes('sujiaba') || kind === 'sujiaba' || kind === 'spiral_overpass' || kind === 'spiral') {
      buildSujiabaSpiral(K, b, terrain, prisms, decks, lights);
    } else if (id.includes('huangjuewan') || kind === 'huangjuewan' || kind === 'multilevel_interchange' || kind === 'interchange') {
      buildHuangjuewanInterchange(K, b, terrain, prisms, decks, lights);
    } else {
      buildHaunchedBoxBridge(K, b, terrain, prisms, decks, lights);
    }

    if (K.nv > 0) {
      const geo = K.geometry();
      const mesh = new THREE.Mesh(geo, bridgeMat);
      mesh.name = `bridge-${b.id}`;
      if (!isWorldSpace) {
        mesh.position.set(b.x, 0, b.z);
        mesh.rotation.y = b.rotY;
      }
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      group.add(mesh);
    }

    labels.push({
      name: b.name || b.id,
      x: b.x,
      y: Math.max(b.deckY + 26, (b.towerH > 40 ? b.waterY + b.towerH * 0.72 : b.deckY + 28)),
      z: b.z,
    });
  }

  // ---- Build Animated CRT Metro Trains on Double-Deck River Bridges (Qiansimen, Dongshuimen, Chaotianmen)
  const trainInstances = [];
  const movingMat = materials?.heroMovingMat || bridgeMat;
  const depthMat = materials?.depthMat;
  for (const spec of animSpecs) {
    const geo = buildCrtLine6TrainGeo(spec.stripeRgb);
    const mesh = new THREE.Mesh(geo, movingMat);
    mesh.name = `crt-train-${spec.bridge.id}`;
    mesh.userData.moving = true;
    mesh.userData.shadowAdded = true;
    group.add(mesh);

    let sh = null;
    if (depthMat) {
      sh = new THREE.Mesh(geo, depthMat);
      sh.layers.enable(1);
      movingGroup.add(sh);
    }
    trainInstances.push({ spec, mesh, sh });
  }

  // Deterministic update(dt, time, env): smoothly shuttle CRT trains back & forth across lower bridge decks
  const update = (_dt, time = 0) => {
    for (const tr of trainInstances) {
      const { bridge: b, x0, x1, deckYFn, yOffset, zTrack, speed, phase } = tr.spec;
      const span = Math.max(10, x1 - x0);
      const travelT = span / Math.abs(speed);
      const waitT = 4.0;
      const cycle = 2 * (travelT + waitT);
      const u = ((time + phase * cycle) % cycle + cycle) % cycle;
      let frac, forward;
      if (u < travelT) {
        const s = u / travelT;
        frac = s * s * (3 - 2 * s);
        forward = true;
      } else if (u < travelT + waitT) {
        frac = 1; forward = true;
      } else if (u < 2 * travelT + waitT) {
        const s = (u - travelT - waitT) / travelT;
        frac = 1 - s * s * (3 - 2 * s);
        forward = false;
      } else {
        frac = 0; forward = false;
      }
      const lx = x0 + span * frac;
      const ly = deckYFn(lx) + yOffset;
      const lz = forward ? zTrack : -zTrack;
      const [wx, wy, wz] = localToWorld(b.x, 0, b.z, b.ux, b.uz, lx, ly, lz);
      const rotY = b.rotY + (forward ? 0 : Math.PI);
      tr.mesh.position.set(wx, wy, wz);
      tr.mesh.rotation.set(0, rotY, 0);
      tr.mesh.updateMatrixWorld(true);
      if (tr.sh) {
        tr.sh.position.set(wx, wy, wz);
        tr.sh.rotation.set(0, rotY, 0);
        tr.sh.updateMatrixWorld(true);
      }
    }
  };
  // Initialize train poses at t=0 immediately
  update(0, 0);

  return {
    group,
    movingGroup,
    update,
    colliders: { prisms, decks },
    lights,
    labels,
  };
}

export default buildBridges;
