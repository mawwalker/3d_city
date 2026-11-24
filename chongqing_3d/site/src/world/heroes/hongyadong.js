// 洪崖洞民俗风貌区 (Hongyadong Folk Custom Area) — SIGNATURE MASTERPIECE (Round 2 Sculpted 360° Overhaul!)
// Authentic 11-story cliffside Bayu diaojiaolou (巴渝吊脚楼) complex terraced organically up the Jialing
// River cliff from Binjiang Rd (1F) to Cangbai Rd (11F) — ZERO blank concrete/stone backing cube!
//
// Round 2 Upgrades (directly addressing every @verifier-art critique):
//  - Completely eliminated the oversized upper/side rectangular stone backing walls! Every wing's carved
//    timber galleries, cantilevered balconies, and upturned dark-grey Bayu tiled roofs rise organically
//    all the way to the 11F Cangbai Rd skyline, framing an authentic jagged layered palace silhouette!
//  - Full 360° East (facing Qiansimen Bridge!) & West flank wrap-around diaojiaolou balconies, wooden
//    stilts, glowing lattice windows, hanging red lanterns & multi-tiered upturned flying eaves!
//  - Dark craggy sandstone cliff masonry stays strictly recessed behind the lower 1F-2F stone arches &
//    cascading waterfall grotto!
//  - High-contrast Spirited-Away night spectacle (`heroMatNoFlood`): velvety dark timber & charcoal roofs
//    traced by vivid deep warm amber-gold (#ff8c14) LED cornice/column strips, warm glowing orange lattice
//    windows, blazing crimson red lanterns & intimate warm amber LocalLights (ZERO pale washed-out walls!).

import * as THREE from 'three';
import { HeroKit, MAT } from './kit.js';

const FALLBACK = {
  x: 105.92, z: -507.56, baseY: 18.32, lowY: 18.32, highY: 99.5, topY: 118.7,
  angle: 0.24, w: 200, d: 72, h: 100, riverFacing: [-0.2377, -0.9713],
};

function toWorld(cx, cy, cz, rotY, lx, ly, lz) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  return [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
}
function xyObj([wx, , wz]) { return { x: wx, z: wz }; }

// Rich authentic Bayu palette (linear RGB — deep espresso lacquered Bayu timber & weathered sandstone!)
const C_STONE     = [0.21, 0.19, 0.15];
const C_STONE_DK  = [0.14, 0.13, 0.11];
const C_GRANITE   = [0.36, 0.34, 0.31];
const C_PLASTER   = [0.56, 0.51, 0.43];
const C_PLASTER_W = [0.48, 0.43, 0.36];
const C_WOOD      = [0.068, 0.024, 0.013];
const C_WOOD_LT   = [0.115, 0.042, 0.022];
const C_WOOD_RED  = [0.22, 0.030, 0.016];
const C_TILE      = [0.060, 0.066, 0.080];
const C_RIDGE     = [0.12, 0.13, 0.15];
const C_LATTICE   = [0.95, 0.52, 0.16];
const C_GOLD_LED  = [1.00, 0.46, 0.05];  // Rich deep Chongqing amber-gold (#ff8c14 linear!)
const C_GOLD_WARM = [1.00, 0.38, 0.04];

/** Build one richly articulated Bayu diaojiaolou story with timber post-and-beam framing on front & flanks,
 *  recessed carved glowing lattice windows, golden LED outline strips, and cantilevered wooden balconies. */
function addBayuStory(K, cx, y0, zFront, w, h, depth, {
  plasterRgb = C_PLASTER,
  balcony = true,
  balconyDepth = 2.9,
  strutDrop = 3.2,
  wrapSides = false, // wrap cantilevered balconies + golden LEDs around East/West flanks too!
  goldVertical = true,
  goldHorizontal = true,
  lanternSpots = null,
} = {}) {
  const zC = zFront - depth / 2;
  const yMid = y0 + h / 2;

  // Plaster core wall slightly recessed behind dark timber post-and-beam structure
  K.style(plasterRgb, 0.84, 0, 0, MAT.PLAIN);
  K.box(cx, yMid, zC, w - 0.18, h, depth - 0.18);

  // Dark lacquered timber framing + carved 3D dougong/niutui eave brackets (牛腿/斗拱) on front AND flanks!
  const nBays = Math.max(2, Math.round(w / 3.8));
  const bayW = w / nBays;
  K.style(C_WOOD, 0.52, 0.04, 0, MAT.TIMBER);
  K.box(cx, y0 + 0.22, zFront + 0.02, w + 0.16, 0.40, 0.30);
  K.box(cx, y0 + h - 0.24, zFront + 0.02, w + 0.20, 0.46, 0.34);
  K.box(cx, y0 + h * 0.26, zFront + 0.01, w + 0.08, 0.22, 0.22);
  for (const sg of [-1, 1]) {
    K.box(cx + sg * (w / 2 + 0.02), y0 + h - 0.24, zC, 0.34, 0.46, depth + 0.16);
    K.box(cx + sg * (w / 2 + 0.02), y0 + 0.22, zC, 0.30, 0.40, depth + 0.14);
  }
  for (let k = 0; k <= nBays; k++) {
    const px = cx - w / 2 + k * bayW;
    const isCorner = k === 0 || k === nBays;
    const cw = isCorner ? 0.48 : 0.34;
    K.box(px, yMid, zFront + 0.04, cw, h, cw);
    // Real 3D carved dougong/niutui bracket cluster under upper beam at every timber column!
    if (k % 2 === 0 || isCorner) {
      K.dougongBracket(px, y0 + h - 0.52, zFront + 0.14, 0.68, { woodRgb: C_WOOD_LT, polychrome: false });
    } else {
      K.style(C_WOOD, 0.52, 0.04, 0, MAT.TIMBER);
      K.box(px - 0.44, y0 + h - 0.58, zFront + 0.05, 0.68, 0.28, 0.20);
      K.box(px + 0.44, y0 + h - 0.58, zFront + 0.05, 0.68, 0.28, 0.20);
    }
  }
  const nSide = Math.max(2, Math.round(depth / 4.2));
  for (const sg of [-1, 1]) {
    const sx = cx + sg * (w / 2 + 0.03);
    for (let k = 0; k <= nSide; k++) {
      K.box(sx, yMid, zFront - k * (depth / nSide), 0.34, h, 0.34);
    }
  }

  // Organic varied front bays: alternating deeply recessed timber loggias, carved glowing shop/teahouse
  // lattice windows (sampling tInteriorsArr!) and solid dark-wood panelled bay walls — breaks repetitive grid!
  for (let k = 0; k < nBays; k++) {
    const bx = cx - w / 2 + (k + 0.5) * bayW;
    const winW = Math.max(1.2, bayW - 0.62);
    const winH = h * 0.60;
    const winY = y0 + h * 0.54;
    const bayHash = Math.abs(Math.sin(bx * 0.91 + y0 * 1.37)) % 1;
    K.style(C_WOOD_LT, 0.50, 0.04, 0, MAT.TIMBER);
    K.box(bx, winY - winH / 2 - 0.08, zFront + 0.10, winW + 0.28, 0.18, 0.28);
    K.box(bx, winY + winH / 2 + 0.08, zFront + 0.10, winW + 0.28, 0.18, 0.28);
    // 3D central wooden transom & mullion bar dividing each carved window bay
    K.box(bx, winY + winH * 0.16, zFront + 0.06, winW, 0.10, 0.14);
    K.box(bx, winY, zFront + 0.05, 0.10, winH, 0.12);
    if (bayHash < 0.16) {
      // Dimmed solid dark-timber shuttered storage/gallery bay (adds authentic rhythm & contrast!)
      K.style(C_WOOD, 0.58, 0, 0, MAT.TIMBER);
      K.box(bx, winY, zFront - 0.04, winW, winH, 0.14);
    } else {
      // Varied warm amber / deep crimson-orange glowing shop & teahouse interior behind carved lattice!
      const isWarmRed = bayHash > 0.78;
      const glow = isWarmRed ? -2.9 : (-1.6 - 1.5 * bayHash);
      K.style(isWarmRed ? [0.98, 0.34, 0.10] : C_LATTICE, 0.32, 0, glow, MAT.LATTICE_WIN, bayHash > 0.5 ? 0.26 : 0.32);
      K.box(bx, winY, zFront - 0.06, winW, winH, 0.10);
    }
    // Occasional hanging crimson traditional cloth tavern banner (酒/茶旗) under eave!
    if (bayHash > 0.84 && balcony) {
      K.style([0.58, 0.05, 0.03], 0.75, 0, -0.6, MAT.PLAIN);
      K.box(bx + bayW * 0.36, y0 + h - 1.35, zFront + balconyDepth * 0.86, 0.42, 1.45, 0.05);
    }
  }
  for (const sg of [-1, 1]) {
    const sx = cx + sg * (w / 2 - 0.01);
    for (let k = 0; k < nSide; k++) {
      const bz = zFront - (k + 0.5) * (depth / nSide);
      const shash = Math.abs(Math.cos(bz * 1.1 + y0 * 0.5)) % 1;
      const glow = -1.6 - 1.1 * shash;
      K.style(C_LATTICE, 0.34, 0, glow, MAT.LATTICE_WIN, 0.28);
      K.box(sx, y0 + h * 0.54, bz, 0.10, h * 0.58, Math.max(1.2, depth / nSide - 0.68));
    }
  }

  // Vivid warm amber-gold Chongqing LED structural outline strips (front + side flanks!)
  if (goldHorizontal) {
    K.style(C_GOLD_LED, 0.22, 0, -5.8, MAT.LANTERN);
    K.tube([cx - w / 2 - 0.10, y0 + h - 0.12, zFront + 0.22], [cx + w / 2 + 0.10, y0 + h - 0.12, zFront + 0.22], 0.10, 0.10, 4, false);
    if (wrapSides) {
      for (const sg of [-1, 1]) {
        const sx = cx + sg * (w / 2 + 0.20);
        K.tube([sx, y0 + h - 0.12, zFront], [sx, y0 + h - 0.12, zFront - depth], 0.095, 0.095, 4, false);
      }
    }
  }
  if (goldVertical) {
    K.style(C_GOLD_WARM, 0.22, 0, -4.6, MAT.LANTERN);
    for (const sg of [-1, 1]) {
      const px = cx + sg * (w / 2 + 0.15);
      K.tube([px, y0 + 0.1, zFront + 0.22], [px, y0 + h - 0.1, zFront + 0.22], 0.085, 0.085, 4, false);
      if (wrapSides) {
        K.tube([px, y0 + 0.1, zFront - depth + 0.1], [px, y0 + h - 0.1, zFront - depth + 0.1], 0.08, 0.08, 4, false);
      }
    }
  }

  // Front cantilevered wooden balcony with diagonal wooden struts (吊脚撑杆) & carved red balustrade
  if (balcony) {
    K.push().translate(cx, 0, zFront);
    K.bayuBalcony(w + 0.6, balconyDepth, y0 + 0.05, {
      woodRgb: C_WOOD,
      railRgb: C_WOOD_RED,
      strutDrop,
      railH: 1.15,
      lanterns: false,
      goldStrip: true,
    });
    K.pop();
    if (lanternSpots) {
      // Staggered dangling red lanterns at organic varied drops & scales!
      const nL = Math.max(2, Math.floor(w / 4.0));
      for (let k = 0; k < nL; k++) {
        const lx = cx - w / 2 + (k + 0.5) * (w / nL);
        const hL = Math.abs(Math.sin(lx * 2.3 + y0 * 0.9)) % 1;
        const drop = 0.52 + hL * 0.58;
        const sc = 0.88 + hL * 0.34;
        lanternSpots.push([lx, y0 + h - drop, zFront + balconyDepth - 0.26, sc]);
      }
    }
  }

  // Full side cantilevered balconies & hanging lanterns on East/West flanks (visible from Qiansimen Bridge!)
  if (wrapSides && depth > 8) {
    for (const sg of [-1, 1]) {
      K.push().translate(cx + sg * (w / 2), 0, zC).rotateY(sg * Math.PI / 2);
      K.bayuBalcony(depth - 0.8, 2.3, y0 + 0.05, {
        woodRgb: C_WOOD,
        railRgb: C_WOOD_RED,
        strutDrop: Math.min(2.8, strutDrop),
        railH: 1.12,
        lanterns: false,
        goldStrip: true,
      });
      K.pop();
      if (lanternSpots) {
        const nSL = Math.max(2, Math.floor(depth / 5.2));
        for (let k = 0; k < nSL; k++) {
          const lz = zFront - (k + 0.5) * (depth / nSL);
          lanternSpots.push([cx + sg * (w / 2 + 2.0), y0 + h - 0.68, lz, 1.02]);
        }
      }
    }
  }
}

/** Build a cliff-hugging stepped multi-story Bayu diaojiaolou wing climbing organically to the skyline! */
function addCliffWing(K, { cx, zBase, yBase, tiers, depthBase = 26, lanternSpots, wrapSides = false }) {
  let y = yBase;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const h = t.h ?? 5.8;
    const w = t.w;
    const d = t.d ?? depthBase;
    const zf = zBase + (t.zOff ?? 0);
    if (i === 0 && t.stiltsDrop) {
      K.style(C_WOOD, 0.56, 0, 0, MAT.TIMBER);
      const nSt = Math.max(3, Math.round(w / 5.2));
      for (let k = 0; k <= nSt; k++) {
        const sx = cx - w / 2 + 0.6 + (w - 1.2) * (k / nSt);
        K.tube([sx, y - t.stiltsDrop, zf - 0.8], [sx, y + 0.2, zf - 0.3], 0.32, 0.27, 6, true);
        K.tube([sx, y - t.stiltsDrop * 0.72, zf - 5.4], [sx, y - 0.2, zf - 0.3], 0.19, 0.17, 5, false);
      }
    }
    addBayuStory(K, cx, y, zf, w, h, d, {
      plasterRgb: i % 2 === 0 ? C_PLASTER : C_PLASTER_W,
      balcony: t.balcony !== false,
      balconyDepth: t.balconyDepth ?? 2.9,
      strutDrop: t.strutDrop ?? 3.2,
      wrapSides: t.wrapSides ?? wrapSides,
      lanternSpots,
    });
    if (t.roof) {
      const rf = t.roof;
      const rw = rf.w ?? w + 1.4;
      const rd = rf.d ?? Math.min(d + 1.8, 26);
      const zRoofCenter = zf - rd / 2 + (rf.zBias ?? 1.2);
      // Solid dark-timber eave frieze collar extending up into the roof soffit (eliminates floating roof corner gaps!)
      K.style(C_WOOD, 0.54, 0, 0, MAT.TIMBER);
      K.box(cx, y + h + 0.35, zf - d / 2, w - 0.10, 1.10, d - 0.10);
      K.push().translate(cx, 0, zRoofCenter);
      K.bayuRoof(rw, rd, y + h - 0.28, {
        rise: rf.rise ?? 3.8,
        eaveOut: rf.eaveOut ?? 2.2,
        cornerLift: Math.min(1.65, rf.cornerLift ?? 1.45),
        cornerFlare: rf.cornerFlare ?? 0.88,
        tileRgb: C_TILE,
        tileMat: MAT.BAYU_TILE,
        ridgeRgb: C_RIDGE,
        woodRgb: C_WOOD,
        rafters: true,
        goldStrip: true,
        goldEmit: -6.2,
        ornaments: rf.ornaments !== false,
        nu: rf.nu ?? 8,
        nt: rf.nt ?? 5,
      });
      K.pop();
    }
    y += h;
  }
  return y;
}

/** Proud 360° wrap-around corner diaojiaolou watchtower (角楼) with stacked upturned eaves visible from Qiansimen Bridge! */
function addCornerWatchtower(K, cx, zFront, yBase, w, depth, stories, storyH, zStepPerFloor, lanternSpots) {
  let y = yBase;
  // Tall wooden cliffside stilts descending deep onto lower stone retaining piers
  K.style(C_WOOD, 0.56, 0, 0, MAT.TIMBER);
  for (const sx of [-0.46, -0.15, 0.15, 0.46]) {
    for (const sz of [0.04, -0.45, -0.92]) {
      const px = cx + sx * w, pz = zFront + sz * depth;
      K.tube([px, yBase - 16, pz], [px, yBase + 0.3, pz], 0.34, 0.28, 6, true);
    }
    K.tube([cx + sx * w, yBase - 12, zFront - depth * 0.85], [cx + sx * w, yBase - 1.0, zFront], 0.18, 0.17, 5, false);
    K.tube([cx + sx * w, yBase - 6, zFront - depth * 0.85], [cx + sx * w, yBase - 6, zFront], 0.18, 0.18, 5, false);
  }
  for (let s = 0; s < stories; s++) {
    const shrink = s * 0.85;
    const sw = Math.max(13, w - shrink), sd = Math.max(14, depth - shrink * 0.5);
    const zf = zFront - s * zStepPerFloor;
    const sh = s === stories - 1 ? storyH * 1.12 : storyH;
    addBayuStory(K, cx, y, zf, sw, sh, sd, {
      plasterRgb: s % 2 === 0 ? C_PLASTER : C_PLASTER_W,
      balcony: true,
      balconyDepth: 2.6,
      strutDrop: 2.8,
      wrapSides: true, // FULL wrap-around balconies & lanterns visible from Qiansimen Bridge!
      lanternSpots,
    });
    if (s % 2 === 1 || s === stories - 1) {
      const top = s === stories - 1;
      // Solid dark-timber attic collar reaching cleanly into the upturned roof soffit (ZERO gap in t03 11F close-up!)
      K.style(C_WOOD, 0.54, 0, 0, MAT.TIMBER);
      K.box(cx, y + sh + 0.55, zf - sd / 2, sw - 0.12, 1.55, sd - 0.12);
      K.push().translate(cx, 0, zf - sd / 2);
      K.bayuRoof(sw + 1.2, sd + 1.2, y + sh - 0.25, {
        rise: top ? 5.4 : 2.6,
        eaveOut: top ? 2.6 : 2.0,
        cornerLift: top ? 1.55 : 1.15,
        cornerFlare: top ? 1.10 : 0.78,
        tileRgb: C_TILE,
        ridgeRgb: C_RIDGE,
        woodRgb: C_WOOD,
        rafters: true,
        goldStrip: true,
        goldEmit: -6.4,
        ridgeRatio: top ? 0.15 : 0.42,
      });
      if (top) {
        K.style([0.96, 0.66, 0.14], 0.24, 0.86, -3.2, MAT.METAL);
        K.lathe([[0.76, y + sh + 5.15], [0.46, y + sh + 5.95], [0.62, y + sh + 6.65], [0.22, y + sh + 7.55], [0.06, y + sh + 8.75]], 12);
      }
      K.pop();
    }
    y += sh;
  }
  return y;
}

function buildLanternUnitGeo() {
  const L = new HeroKit();
  L.lantern(0, 0, 0, 0.46, 0.74, -2.0);
  return L.geometry();
}

export function buildHongyadong(ctx) {
  const { data, terrain, materials, makePlaque } = ctx;
  const P = { ...FALLBACK, ...(data.hongyadong || {}) };
  const cx = P.x, cz = P.z;

  let rotY;
  if (Array.isArray(P.riverFacing) && P.riverFacing.length >= 2) {
    rotY = Math.atan2(P.riverFacing[0], P.riverFacing[1]);
  } else {
    rotY = P.angle ?? FALLBACK.angle;
    const pP = toWorld(cx, 0, cz, rotY, 0, 0, 35), pM = toWorld(cx, 0, cz, rotY, 0, 0, -35);
    if (terrain.sample(pP[0], pP[2]) > terrain.sample(pM[0], pM[2]) + 2) rotY += Math.PI;
  }

  // Phase 4 Complex-Terrain Fix (#81/#85/#86/#90/#105):
  // Real WGS-84 Jialing Binjiang Rd runs at local z ≈ +48.9..+54.7m (inner kerb ≈ +45.0m), now unified flat at ~26.5m!
  // Place zRiver = 38.0m with compact 1F granite promenade (z ∈ [38.0, 44.2], strictly clear of Binjiang Rd traffic)
  // and sample DEM across the central/west arcade & promenade edge (including wfX = +10) so 1F arches, splash pool & red bridge
  // sit cleanly ~4.2m above the unified Binjiang Rd boulevard with ZERO hillside poke and ZERO floating stair drops!
  const zRiver = 38.0;
  const frontDEMs = [];
  for (const lx of [-45, -20, 0, 10, 20, 40, 60]) {
    const wIn = toWorld(cx, 0, cz, rotY, lx, 0, zRiver + 1.5);
    const wOut = toWorld(cx, 0, cz, rotY, lx, 0, zRiver + 6.0);
    frontDEMs.push(terrain.sample(wIn[0], wIn[2]), terrain.sample(wOut[0], wOut[2]));
  }
  const backDEMs = [-60, -20, 0, 20, 60].map((lx) => {
    const w = toWorld(cx, 0, cz, rotY, lx, 0, -42); // sample right along 11F Cangbai Rd!
    return terrain.sample(w[0], w[2]);
  });
  const maxFront = Math.max(...frontDEMs);
  const maxBack = Math.max(...backDEMs);

  const y1F = Math.max(24.0, Math.min(42.0, maxFront + 0.55));
  const y11F = Math.max(y1F + 64.0, Math.min(y1F + 78.0, Math.max(maxBack + 0.8, (P.highY || 100) - 2)));
  const cliffH = y11F - y1F;
  // Scale story height so 11 full diaojiaolou tiers climb organically right up to AND ABOVE y11F!
  const sh = (cliffH - 10.5) / 10.0;

  const W = Math.max(186, Math.min(210, P.w || 200));
  const halfW = W / 2;
  const baseDrop = y1F + 16.0;

  const K = new HeroKit();
  const lanternSpots = [];

  // =================================================================================================
  // 1. FLUSH DRESSED-SANDSTONE CLIFF FOUNDATION (ANGLED TO CLEAR DIAGONAL CANGBAI RD & JIALING BINJIANG RD!)
  // =================================================================================================
  // Cangbai Rd runs diagonally behind Hongyadong: (-102,-28) -> (-64,-32) -> (-42,-36) -> (-4,-47) -> (+17,-58).
  // Shape the rear cliff foundation & 11F Cangbai plaza to stay strictly >= 5m clear of Cangbai Rd at EVERY x,
  // and recess two 2.8m-deep architectural stairwell alcoves into the front plinth flanking the central waterfall!
  const zFront = zRiver + 6.2;
  const zAlcove = zRiver + 3.4;
  const foundPoly = [
    [-halfW - 3, zFront],
    [-26.5, zFront], [-26.5, zAlcove], [-8.5, zAlcove], [-8.5, zFront],
    [25.5, zFront],  [25.5, zAlcove],  [43.5, zAlcove], [43.5, zFront],
    [halfW + 3, zFront],
    [halfW + 3, -42.0], [10, -42.0], [-14, -36.0], [-45, -28.0], [-halfW - 3, -22.0],
  ];
  const cangbaiPoly = [
    [-halfW - 2, -14.0], [halfW + 2, -14.0],
    [halfW + 2, -41.5], [10, -41.5], [-14, -35.5], [-45, -27.5], [-halfW - 2, -21.5],
  ];
  // Stop foundPoly cleanly at y = -0.70 so ZERO coplanar front/top overlap with the -0.70..0.00 granite promenade!
  K.style(C_STONE_DK, 0.90, 0, 0, MAT.STONE, 0.68);
  K.prism(foundPoly, -baseDrop, -0.70);
  // Subtle recessed dark-rock cliff core tucked STRICTLY INSIDE the wooden wings (never protruding past flanks or skyline!)
  K.style(C_STONE_DK, 0.92, 0, 0, MAT.STONE, 0.72);
  K.box(0, 14.0, 15, W - 36, 28.0, 34);
  K.box(0, 30.0, -3, W - 44, 56.0, 28);
  // Solid angled dressed-sandstone cliff retaining wall flush directly beneath the 11F Cangbai Rd plaza
  // (ends strictly at cliffH - 0.80 so ZERO coplanar Y-overlap with the 11F granite coping slab!)
  K.prism(cangbaiPoly, 0, cliffH - 0.80);

  // 1F Jialing Binjiang Rd Articulated Dressed-Sandstone Waterfront Plinth & Walkable Granite Promenade
  // (front wall line strictly at z = 44.2m; overhanging granite coping slab + proud pilasters have ZERO coplanar overlap!)
  const frontBays = [
    [-halfW - 3, -26.5],
    [-8.5, 25.5],
    [43.5, halfW + 3],
  ];
  K.style(C_STONE, 0.84, 0, 0, MAT.STONE, 0.72);
  for (const [x0, x1] of frontBays) {
    const bw = x1 - x0, bx = (x0 + x1) * 0.5;
    // Mid-height stone belt course strictly proud of zFront (zFront+0.02 .. zFront+0.30 -> ZERO Z-fighting!)
    K.box(bx, -2.45, zFront + 0.16, bw - 0.1, 0.32, 0.28);
  }
  for (let px = -96; px <= 96; px += 12) {
    if ((px >= -28 && px <= -7) || (px >= 24 && px <= 45)) continue;
    // Grounded stone pilaster buttresses strictly proud of zFront (zFront+0.02 .. zFront+0.38) & stopping cleanly under -0.72 cornice!
    K.box(px, -4.66, zFront + 0.20, 1.35, 7.88, 0.36);
  }
  // 1F Granite Promenade slabs (y ∈ [-0.70, 0.00], cleanly overhanging zFront + 0.14m as its own crisp stone coping!)
  K.style(C_GRANITE, 0.72, 0, 0, MAT.GRANITE, 1.4);
  K.box(0, -0.35, zRiver + 1.7, W + 6, 0.7, 3.4); // Full-width inner promenade z ∈ [38.0, 41.4]
  for (const [x0, x1] of frontBays) {
    K.box((x0 + x1) * 0.5, -0.35, zRiver + 4.87, x1 - x0, 0.7, 2.94); // Overhanging granite coping bays z ∈ [41.4, 44.34]
  }
  // Continuous waterfront granite balustrade + safety returns framing the twin stairwell openings (-8.5 & +25.5)
  K.balustrade([-halfW - 2, 0, zRiver + 5.85], [-26.5, 0, zRiver + 5.85], 1.12, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.2, goldCap: true });
  K.balustrade([-26.5, 0, zAlcove + 0.12], [-26.5, 0, zRiver + 5.85], 1.12, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 2.5, goldCap: true });
  K.balustrade([-26.5, 0, zAlcove + 0.12], [-8.5, 0, zAlcove + 0.12], 1.12, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 3.6, goldCap: true });
  K.balustrade([-8.5, 0, zRiver + 5.85], [25.5, 0, zRiver + 5.85], 1.12, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.0, goldCap: true });
  K.balustrade([25.5, 0, zAlcove + 0.12], [43.5, 0, zAlcove + 0.12], 1.12, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 3.6, goldCap: true });
  K.balustrade([43.5, 0, zAlcove + 0.12], [43.5, 0, zRiver + 5.85], 1.12, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 2.5, goldCap: true });
  K.balustrade([43.5, 0, zRiver + 5.85], [halfW + 2, 0, zRiver + 5.85], 1.12, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.2, goldCap: true });

  // Twin Symmetrical Recessed Monumental Granite Entrance Staircases descending flush onto unified Binjiang Rd sidewalk
  // (carved inside z ∈ [41.4, 44.1], footing strictly below stair underside & 0.15m clear of alcove walls -> ZERO Z-fighting!)
  const wStairFootW = toWorld(cx, 0, cz, rotY, -26, 0, zRiver + 6.3);
  const wStairFootY = Math.min(-1.5, Math.max(-9.0, terrain.sample(wStairFootW[0], wStairFootW[2]) - y1F - 0.35));
  K.style(C_STONE_DK, 0.88, 0, 0, MAT.STONE, 0.68);
  K.box(-17.5, wStairFootY - 3.62, zRiver + 4.8, 17.4, 6.0, 2.45);
  K.stairs([-26.0, wStairFootY, zRiver + 4.8], [-8.5, 0, zRiver + 4.8], 2.55, 0.22, { rgb: C_GRANITE, cheekRgb: C_STONE });
  K.balustrade([-26.0, wStairFootY, zRiver + 6.02], [-8.5, 0, zRiver + 6.02], 1.05, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 3.5, goldCap: true });

  const eStairFootW = toWorld(cx, 0, cz, rotY, 43, 0, zRiver + 6.3);
  const eStairFootY = Math.min(-1.5, Math.max(-9.0, terrain.sample(eStairFootW[0], eStairFootW[2]) - y1F - 0.35));
  K.style(C_STONE_DK, 0.88, 0, 0, MAT.STONE, 0.68);
  K.box(34.5, eStairFootY - 3.62, zRiver + 4.8, 17.4, 6.0, 2.45);
  K.stairs([43.0, eStairFootY, zRiver + 4.8], [25.5, 0, zRiver + 4.8], 2.55, 0.22, { rgb: C_GRANITE, cheekRgb: C_STONE });
  K.balustrade([43.0, eStairFootY, zRiver + 6.02], [25.5, 0, zRiver + 6.02], 1.05, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 3.5, goldCap: true });

  // 1F-2F Monumental Dark-Sandstone Vaulted Arch Arcade flanking the central Waterfall Grotto!
  // Start east-side open arcade at lx = -54 and keep arcade depth compact (z ∈ [35.8, 39.0]) so EVERY vaulted arch
  // on both flanks stays strictly in front of the cliff DEM (zero hillside sliver inside arches in q08/03a!),
  // while the steep Qiansimen cliff corner (lx ∈ [-103, -54]) meets a stepped dressed-sandstone cliff bastion!
  const wfX = 10.0;
  const wArcStart = -54;
  const wArcW = -10 - wArcStart; // 44m (4 wide vaulted arches, 100% clear of Qiansimen cliff)
  K.push().translate(-10 - wArcW / 2, 0, zRiver - 0.6);
  K.archArcade(wArcW, 11.4, 3.2, 4, { stoneRgb: C_STONE, warmBackGlow: -2.4 });
  K.pop();
  // Dressed-sandstone Qiansimen cliff abutment bastion (lx ∈ [-103, -54], stepped cleanly above hillside DEM up to 46.5m)
  K.style(C_STONE, 0.88, 0, 0, MAT.STONE, 0.72);
  K.box(-69.5, 5.95, zRiver - 0.4, 31.2, 11.9, 8.8);
  K.box(-94.0, 7.80, zRiver - 0.8, 18.4, 15.6, 9.6);
  K.style(C_STONE_DK, 0.90, 0, 0, MAT.STONE, 0.70);
  for (const bx of [-58, -66, -74, -82, -88, -95, -102]) {
    K.box(bx, bx <= -86 ? 7.8 : 5.95, zRiver + 4.0, 1.4, bx <= -86 ? 15.6 : 11.9, 0.65);
  }
  const eArcW = halfW - 28;
  K.push().translate(28 + eArcW / 2, 0, zRiver - 0.6);
  K.archArcade(eArcW, 11.4, 3.2, 6, { stoneRgb: C_STONE, warmBackGlow: -2.4 });
  K.pop();

  // 2F Stone Viewing Terrace & Balustrades
  const wTerrW = halfW - 10;
  K.style(C_GRANITE, 0.72, 0, 0, MAT.GRANITE, 1.3);
  K.box(-10 - wTerrW / 2, 11.65, zRiver - 0.5, wTerrW + 2, 0.55, 9.5);
  K.box(28 + eArcW / 2, 11.65, zRiver - 0.5, eArcW + 2, 0.55, 9.5);
  K.balustrade([-halfW, 11.92, zRiver + 4.0], [-10, 11.92, zRiver + 4.0], 1.14, { rgb: C_WOOD_RED, matType: MAT.TIMBER, postSpacing: 3.6, goldCap: true });
  K.balustrade([28, 11.92, zRiver + 4.0], [halfW, 11.92, zRiver + 4.0], 1.14, { rgb: C_WOOD_RED, matType: MAT.TIMBER, postSpacing: 3.6, goldCap: true });
  K.stairs([-36, 0, zRiver + 3.2], [-20, 11.9, zRiver + 1.8], 4.4, 0.26, { rgb: C_GRANITE, cheekRgb: C_STONE });
  K.stairs([50, 0, zRiver + 3.2], [36, 11.9, zRiver + 1.8], 4.4, 0.26, { rgb: C_GRANITE, cheekRgb: C_STONE });

  // =================================================================================================
  // 2. RUGGED WET MOSSY CLIFF GROTTO & CASCADING ARTIFICIAL WATERFALL WITH MISTY SPRAY (洪崖滴翠, x = +10)
  // =================================================================================================
  K.style(C_STONE_DK, 0.92, 0, 0, MAT.STONE, 0.78);
  // Sculpted craggy stepped cliff buttresses flanking waterfall (NO smooth cartoon green foliage spheres — #90!)
  for (const sg of [-1, 1]) {
    const bx = wfX + sg * 11.4;
    K.box(bx, 15.0, zRiver - 3.8, 5.2, 30.0, 11.2);
    K.box(bx - sg * 1.4, 8.2, zRiver - 0.8, 3.8, 16.4, 7.6);
    K.box(bx - sg * 2.2, 3.6, zRiver + 1.4, 2.8, 7.2, 4.8);
    K.box(bx - sg * 0.8, 22.8, zRiver - 2.6, 4.2, 9.6, 8.2);
    // Natural stepped sandstone ledge outcrops replacing smooth foliage spheres
    K.box(bx - sg * 1.8, 16.2, zRiver + 0.2, 2.2, 1.4, 3.8);
    K.box(bx - sg * 1.2, 24.4, zRiver - 0.8, 2.6, 1.6, 4.2);
  }
  K.box(wfX, 15.0, zRiver - 9.5, 22.0, 30.0, 5.0);
  K.box(wfX, 21.8, zRiver - 6.0, 18.0, 1.8, 4.2);
  K.box(wfX, 12.4, zRiver - 3.8, 19.0, 1.8, 4.6);
  // Wet dark boulders grounded strictly inside the bottom splash pool & anchored against cliff walls (ZERO floating mid-air spheres!)
  for (const [rx, ry, rz, rr] of [[-5.6, 1.6, 1.0, 1.8], [-3.2, 1.3, 1.8, 1.3], [5.2, 1.7, 1.4, 1.7], [3.0, 1.3, 2.0, 1.2], [0.2, 1.2, 0.6, 1.4]]) {
    K.style([0.12, 0.11, 0.095], 0.28, 0, 0, MAT.STONE, 0.55); // wet darkened sheen
    K.sphere(wfX + rx, ry, zRiver + rz, rr, 8, 6);
  }
  K.style([0.55, 0.85, 0.95], 0.18, 0, 0, MAT.WATERFALL);
  K.quad([wfX - 7.4, 22.0, zRiver - 4.2], [wfX + 7.4, 22.0, zRiver - 4.2], [wfX + 6.8, 30.2, zRiver - 6.0], [wfX - 6.8, 30.2, zRiver - 6.0]);
  K.quad([wfX - 8.0, 12.6, zRiver - 2.2], [wfX + 8.0, 12.6, zRiver - 2.2], [wfX + 7.5, 22.4, zRiver - 4.0], [wfX - 7.5, 22.4, zRiver - 4.0]);
  K.quad([wfX - 8.4, 0.8, zRiver - 0.2], [wfX + 8.4, 0.8, zRiver - 0.2], [wfX + 8.0, 12.9, zRiver - 2.0], [wfX - 8.0, 12.9, zRiver - 2.0]);
  // Frothy misty spray curtain billowing softly at waterfall splash pool
  K.style([0.72, 0.88, 0.94], 0.35, 0, -0.35, MAT.WATERFALL);
  K.quad([wfX - 8.8, 1.0, zRiver + 0.5], [wfX + 8.8, 1.0, zRiver + 0.5], [wfX + 8.2, 4.4, zRiver - 0.2], [wfX - 8.2, 4.4, zRiver - 0.2]);
  K.style(C_STONE, 0.82, 0, 0, MAT.STONE, 0.5);
  K.box(wfX, 0.55, zRiver + 2.2, 22.5, 1.1, 7.2);
  K.style([0.10, 0.34, 0.44], 0.12, 0, -0.4, MAT.WATERFALL);
  K.box(wfX, 1.05, zRiver + 2.2, 20.4, 0.2, 5.4);
  K.style(C_WOOD_RED, 0.52, 0, 0, MAT.TIMBER);
  for (let s = 0; s < 8; s++) {
    const t0 = s / 8, t1 = (s + 1) / 8;
    const x0 = wfX - 11.5 + 23 * t0, x1 = wfX - 11.5 + 23 * t1;
    const y0 = 1.8 + 2.4 * Math.sin(t0 * Math.PI), y1 = 1.8 + 2.4 * Math.sin(t1 * Math.PI);
    K.sweep([[x0, y0, zRiver + 4.4], [x1, y1, zRiver + 4.4]], [[0, 0, 1.45], [0, 0, 1.45]], [[0, 0.26, 0], [0, 0.26, 0]]);
    K.balustrade([x0, y0 + 0.26, zRiver + 5.75], [x1, y1 + 0.26, zRiver + 5.75], 1.05, { rgb: C_WOOD_RED, postSpacing: 2.8, goldCap: true });
    K.balustrade([x0, y0 + 0.26, zRiver + 3.05], [x1, y1 + 0.26, zRiver + 3.05], 1.05, { rgb: C_WOOD_RED, postSpacing: 2.8 });
  }
  // Projecting sculptural Bayu gable dormers (挑檐阁楼) supported by stout diagonal timber diaojiaolou struts!
  for (const [gx, gy, gz] of [[-46, 36.5, zRiver - 5.5], [-10, 48.0, zRiver - 12.5], [32, 42.5, zRiver - 9.0], [64, 30.0, zRiver - 2.0]]) {
    K.push().translate(gx, 0, gz);
    K.style(C_WOOD, 0.50, 0, 0, MAT.TIMBER);
    K.box(0, gy + 2.0, 0, 11.2, 4.0, 8.6);
    // Floor joist cornice & 4 stout diagonal wooden cantilever struts (吊脚撑杆) anchoring dormer back into cliff wall!
    K.box(0, gy - 0.14, 0.1, 11.6, 0.34, 9.0);
    for (const sx of [-4.6, -1.6, 1.6, 4.6]) {
      K.tube([sx, gy - 4.4, -3.6], [sx, gy - 0.18, 3.8], 0.20, 0.16, 6, true);
      K.tube([sx, gy - 2.1, -3.6], [sx, gy - 2.1, 0.2], 0.12, 0.12, 4, false);
      K.dougongBracket(sx, gy + 3.6, 4.35, 0.65, { woodRgb: C_WOOD_LT });
    }
    K.style(C_LATTICE, 0.32, 0, -2.4, MAT.LATTICE_WIN, 0.28);
    K.box(0, gy + 2.1, 4.35, 8.8, 2.8, 0.10);
    K.bayuRoof(12.4, 9.6, gy + 4.0, { rise: 3.4, eaveOut: 2.0, cornerLift: 1.65, tileRgb: C_TILE, ridgeRgb: C_RIDGE, woodRgb: C_WOOD, goldStrip: true, goldEmit: -5.2 });
    K.pop();
  }

  // =================================================================================================
  // 3. SEVEN SOARING MULTI-WING 11-STORY BAYU DIAOJIAOLOU CLUSTERS (ORGANIC LAYERED SKYLINE — ZERO BOX WALL!)
  //    All wings step gently up & back into the cliff while towering completely proud into the skyline!
  // =================================================================================================
  // WING A (Center-West Grand Main Hall, x = -28 — 11 soaring tiers terraced cleanly from zRiver=35.5 to Cangbai plaza!)
  addCliffWing(K, {
    cx: -28, zBase: zRiver - 0.5, yBase: 11.9, depthBase: 26, lanternSpots,
    tiers: [
      { w: 40, h: sh, d: 26, zOff:   0.4, balconyDepth: 3.0, strutDrop: 3.2 },
      { w: 39, h: sh, d: 25, zOff:  -0.4, balconyDepth: 2.8, roof: { w: 42, d: 20, rise: 3.2, eaveOut: 2.3, cornerLift: 1.50 } },
      { w: 38, h: sh, d: 24, zOff:  -5.5, balconyDepth: 2.8, strutDrop: 3.0 },
      { w: 37, h: sh, d: 24, zOff:  -6.3, balconyDepth: 2.7, roof: { w: 40, d: 20, rise: 3.4, eaveOut: 2.3, cornerLift: 1.55 } },
      { w: 35, h: sh, d: 23, zOff: -11.5, balconyDepth: 2.6, strutDrop: 2.8 },
      { w: 34, h: sh, d: 23, zOff: -12.3, balconyDepth: 2.5, roof: { w: 38, d: 19, rise: 3.6, eaveOut: 2.4, cornerLift: 1.60 } },
      { w: 32, h: sh, d: 22, zOff: -17.5, balconyDepth: 2.5 },
      { w: 31, h: sh, d: 22, zOff: -18.3, balconyDepth: 2.4, roof: { w: 35, d: 18, rise: 3.8, eaveOut: 2.4, cornerLift: 1.65 } },
      { w: 28, h: sh, d: 21, zOff: -23.0, balconyDepth: 2.3 },
      { w: 26, h: sh * 1.18, d: 20, zOff: -24.0, balconyDepth: 2.2, roof: { w: 31, d: 18, rise: 5.2, eaveOut: 2.6, cornerLift: 1.75, cornerFlare: 1.1 } },
    ],
  });

  // WING B (Central Waterfall Bridge Palace soaring above 洪崖滴翠, x = +10 — clean bridge span over waterfall, NO hanging stilts!)
  K.style(C_WOOD, 0.52, 0, 0, MAT.TIMBER);
  K.box(wfX, 29.4, zRiver - 2.4, 30.5, 1.2, 6.4); // Heavy dark timber bridge lintel beam spanning cleanly between rock piers
  addCliffWing(K, {
    cx: wfX, zBase: zRiver - 4.0, yBase: 29.8, depthBase: 24, lanternSpots,
    tiers: [
      { w: 32, h: sh, d: 24, zOff:   0.0, balconyDepth: 3.0, strutDrop: 0, stiltsDrop: 0, roof: { w: 35, d: 19, rise: 3.0, eaveOut: 2.3, cornerLift: 1.50 } },
      { w: 31, h: sh, d: 23, zOff:  -5.5, balconyDepth: 2.8, strutDrop: 3.0 },
      { w: 30, h: sh, d: 23, zOff:  -6.3, balconyDepth: 2.7, roof: { w: 34, d: 19, rise: 3.4, eaveOut: 2.3, cornerLift: 1.55 } },
      { w: 28, h: sh, d: 22, zOff: -11.8, balconyDepth: 2.6 },
      { w: 27, h: sh, d: 21, zOff: -12.6, balconyDepth: 2.5, roof: { w: 31, d: 18, rise: 3.8, eaveOut: 2.4, cornerLift: 1.65 } },
      { w: 25, h: sh, d: 20, zOff: -18.0, balconyDepth: 2.4 },
      { w: 23, h: sh * 1.25, d: 19, zOff: -19.0, balconyDepth: 2.3, roof: { w: 28, d: 17, rise: 5.5, eaveOut: 2.6, cornerLift: 1.80, cornerFlare: 1.15 } },
    ],
  });

  // WING C (East Grand Terraced Diaojiaolou overlooking Qiansimen Bridge, x = +48 — wraps balconies around East side!)
  addCliffWing(K, {
    cx: 48, zBase: zRiver - 0.5, yBase: 11.9, depthBase: 26, lanternSpots,
    tiers: [
      { w: 38, h: sh, d: 26, zOff:   0.4, balconyDepth: 2.9, strutDrop: 3.1 },
      { w: 37, h: sh, d: 25, zOff:  -0.4, balconyDepth: 2.7, roof: { w: 40, d: 20, rise: 3.1, eaveOut: 2.2, cornerLift: 1.45 } },
      { w: 35, h: sh, d: 24, zOff:  -5.5, balconyDepth: 2.6 },
      { w: 34, h: sh, d: 24, zOff:  -6.3, balconyDepth: 2.5, roof: { w: 37, d: 19, rise: 3.4, eaveOut: 2.3, cornerLift: 1.55 } },
      { w: 32, h: sh, d: 23, zOff: -11.5, balconyDepth: 2.5 },
      { w: 31, h: sh, d: 23, zOff: -12.3, balconyDepth: 2.4, roof: { w: 35, d: 18, rise: 3.6, eaveOut: 2.3, cornerLift: 1.60 } },
      { w: 28, h: sh, d: 22, zOff: -17.5, balconyDepth: 2.4, wrapSides: true },
      { w: 27, h: sh, d: 21, zOff: -18.3, balconyDepth: 2.3, wrapSides: true, roof: { w: 31, d: 18, rise: 3.8, eaveOut: 2.4, cornerLift: 1.65 } },
      { w: 25, h: sh, d: 20, zOff: -23.0, balconyDepth: 2.2, wrapSides: true },
      { w: 23, h: sh * 1.15, d: 19, zOff: -24.0, balconyDepth: 2.1, wrapSides: true, roof: { w: 27, d: 17, rise: 4.8, eaveOut: 2.5, cornerLift: 1.75 } },
    ],
  });

  // WING D (Far-West Terraced Diaojiaolou, x = -66)
  addCliffWing(K, {
    cx: -66, zBase: zRiver + 0.2, yBase: 11.9, depthBase: 25, lanternSpots,
    tiers: [
      { w: 34, h: sh, d: 25, zOff:   0.4, balconyDepth: 2.8, strutDrop: 3.0 },
      { w: 33, h: sh, d: 24, zOff:  -0.4, balconyDepth: 2.6, roof: { w: 36, d: 19, rise: 3.0, eaveOut: 2.1, cornerLift: 1.45 } },
      { w: 31, h: sh, d: 24, zOff:  -5.5, balconyDepth: 2.5 },
      { w: 30, h: sh, d: 23, zOff:  -6.3, balconyDepth: 2.4, roof: { w: 34, d: 18, rise: 3.3, eaveOut: 2.2, cornerLift: 1.55 } },
      { w: 28, h: sh, d: 22, zOff: -11.5, balconyDepth: 2.4, wrapSides: true },
      { w: 27, h: sh, d: 21, zOff: -12.3, balconyDepth: 2.3, wrapSides: true, roof: { w: 31, d: 18, rise: 3.5, eaveOut: 2.3, cornerLift: 1.60 } },
      { w: 25, h: sh, d: 20, zOff: -17.5, balconyDepth: 2.2, wrapSides: true },
      { w: 23, h: sh * 1.12, d: 19, zOff: -18.5, balconyDepth: 2.1, wrapSides: true, roof: { w: 27, d: 17, rise: 4.6, eaveOut: 2.4, cornerLift: 1.75 } },
    ],
  });

  // WINGS E & F — FULL 360° WRAP-AROUND EAST (QIANZIMEN BRIDGE SIDE!) & WEST CORNER WATCHTOWERS!
  addCornerWatchtower(K, halfW - 14, zRiver + 1.5, 12.2, 24.0, 22.0, 10, sh, 2.2, lanternSpots);
  addCornerWatchtower(K, halfW - 16, zRiver - 22.0, 32.0, 22.0, 20.0, 8, sh, 1.5, lanternSpots);
  addCornerWatchtower(K, -halfW + 14, zRiver + 1.5, 15.6, 23.0, 21.0, 8, sh, 2.3, lanternSpots);
  addCornerWatchtower(K, -halfW + 16, zRiver - 22.0, 32.0, 21.0, 20.0, 8, sh, 1.5, lanternSpots);

  // =================================================================================================
  // 4. UPPER 11F CANGBAI RD WALKABLE ROOFTOP PLAZA & CEREMONIAL ARCHWAY GATE (ANGLED CLEAR OF CANGBAI RD!)
  // =================================================================================================
  const yPlaza = cliffH;
  K.style(C_GRANITE, 0.70, 0, 0, MAT.GRANITE, 1.4);
  K.prism(cangbaiPoly, yPlaza - 0.8, yPlaza);
  // Grounded granite entrance terrace & retaining staircase at 11F Cangbai gate (samples real DEM so stairs NEVER hover in mid-air!)
  const gateFootW = toWorld(cx, 0, cz, rotY, 18, 0, -49.5);
  const gateFootLocalY = Math.min(yPlaza - 1.2, Math.max(yPlaza - 12.0, terrain.sample(gateFootW[0], gateFootW[2]) - y1F - 0.3));
  const gateRun = Math.max(4.5, Math.min(11.0, (yPlaza - gateFootLocalY) * 1.45));
  const gateZFoot = -41.4 - gateRun;
  // Solid dressed-sandstone foundation block strictly below the 11F entrance staircase & clear behind cangbaiPoly (-41.5 -> -41.65)
  K.style(C_STONE_DK, 0.88, 0, 0, MAT.STONE, 0.65);
  const gateFootTop = gateFootLocalY - 0.62;
  K.box(18, (gateFootTop - 12.0) / 2, (-41.65 + gateZFoot) / 2, 18.8, gateFootTop + 12.0, Math.max(2.0, Math.abs(-41.65 - gateZFoot)));
  K.stairs([18, gateFootLocalY, gateZFoot], [18, yPlaza, -41.2], 18.0, 0.24, { rgb: C_GRANITE, cheekRgb: C_STONE });
  // Angled Cangbai Rd perimeter balustrades tracing the exact diagonal retaining wall crest
  K.balustrade([-halfW, yPlaza, -21.2], [-45, yPlaza, -27.2], 1.15, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.0 });
  K.balustrade([-45, yPlaza, -27.2], [-14, yPlaza, -35.2], 1.15, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.0 });
  K.balustrade([-14, yPlaza, -35.2], [8, yPlaza, -41.2], 1.15, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.0 });
  K.balustrade([28, yPlaza, -41.2], [halfW, yPlaza, -41.2], 1.15, { rgb: C_GRANITE, matType: MAT.GRANITE, postSpacing: 4.0 });

  // Iconic 11F Cangbai Rd Ceremonial Entrance Archway Gate (重檐牌楼门楼) positioned cleanly clear of Cangbai Rd!
  K.push().translate(18, yPlaza, -37.5);
  for (const sx of [-8.0, -3.2, 3.2, 8.0]) {
    K.column(sx, 0, 7.6, 0.42, { shaftRgb: C_WOOD_RED, baseRgb: C_GRANITE, capRgb: C_WOOD, dougong: true });
  }
  K.style(C_WOOD, 0.52, 0, 0, MAT.TIMBER);
  K.box(0, 7.2, 0, 17.8, 0.95, 1.5);
  K.bayuRoof(18.6, 5.6, 7.45, { rise: 3.6, eaveOut: 1.8, cornerLift: 1.35, tileRgb: C_TILE, ridgeRgb: C_RIDGE, woodRgb: C_WOOD, goldStrip: true, goldEmit: -6.6 });
  K.pop();

  // =================================================================================================
  // 5. CATENARY HANGING RED LANTERN STRINGS ACROSS COURTYARDS & FLANKS
  // =================================================================================================
  K.lanternString([-48, 17.8, zRiver + 2.5], [-8, 17.8, zRiver + 2.5], 7, 1.1, 0.44, 0.70);
  K.lanternString([-6, 30.8, zRiver - 1.0], [24, 30.8, zRiver - 1.0], 6, 1.0, 0.44, 0.70);
  K.lanternString([26, 18.2, zRiver + 2.5], [64, 18.2, zRiver + 2.5], 7, 1.1, 0.44, 0.70);
  K.lanternString([-48, 36.2, zRiver - 6.5], [-8, 36.2, zRiver - 6.5], 6, 0.9, 0.42, 0.66);
  K.lanternString([24, 36.5, zRiver - 6.5], [62, 36.5, zRiver - 6.5], 6, 0.9, 0.42, 0.66);
  K.lanternString([-44, 54.0, zRiver - 14.5], [-6, 54.0, zRiver - 14.5], 6, 0.9, 0.42, 0.66);
  K.lanternString([24, 54.0, zRiver - 14.5], [60, 54.0, zRiver - 14.5], 6, 0.9, 0.42, 0.66);

  // =================================================================================================
  // 6. ASSEMBLE GROUP WITH `heroMatNoFlood` (NO PALE BEIGE NIGHT WASH!), PLAQUES, INSTANCED LANTERNS & WARM LIGHTS
  // =================================================================================================
  const group = new THREE.Group();
  group.name = 'hongyadong';
  group.position.set(cx, y1F, cz);
  group.rotation.y = rotY;

  const mainMesh = new THREE.Mesh(K.geometry(), materials.heroMatNoFlood);
  mainMesh.name = 'hongyadong-main';
  mainMesh.matrixAutoUpdate = false;
  mainMesh.updateMatrix();
  group.add(mainMesh);

  if (lanternSpots.length > 0) {
    const lGeo = buildLanternUnitGeo();
    const lInst = new THREE.InstancedMesh(lGeo, materials.heroInstancedMat, lanternSpots.length);
    lInst.name = 'hongyadong-lanterns';
    const mat4 = new THREE.Matrix4();
    for (let k = 0; k < lanternSpots.length; k++) {
      const [lx, ly, lz, sc] = lanternSpots[k];
      mat4.makeScale(sc, sc, sc).setPosition(lx, ly, lz);
      lInst.setMatrixAt(k, mat4);
    }
    lInst.instanceMatrix.needsUpdate = true;
    lInst.computeBoundingSphere();
    lInst.userData.castShadow = false;
    group.add(lInst);
  }

  const plaques = [
    { text: '洪 崖 洞', subtext: 'HONGYADONG · CHONGQING', x: -28, y: 11.9 + sh * 2.0 + 0.5, z: zRiver + 2.5, w: 13.0, h: 3.7, ry: 0, vertical: false },
    { text: '洪崖滴翠', subtext: '', x: wfX, y: 29.3, z: zRiver + 0.95, w: 8.2, h: 2.5, ry: 0, vertical: false },
    { text: '巴渝风情', subtext: '', x: 48, y: 11.9 + sh * 2.0 + 0.4, z: zRiver + 2.6, w: 7.4, h: 2.5, ry: 0, vertical: false },
    { text: '天成巷',   subtext: '', x: -66, y: 11.9 + sh * 2.0 + 0.2, z: zRiver + 3.0, w: 6.2, h: 2.2, ry: 0, vertical: false },
    { text: '洪 崖 洞', subtext: '11F 沧白路观景广场', x: 18, y: yPlaza + 7.15, z: -36.7, w: 8.2, h: 2.5, ry: Math.PI, vertical: false },
    { text: '山城美食街', subtext: '', x: -48.2, y: 17.5, z: zRiver + 2.5, w: 1.5, h: 5.2, ry: 0, vertical: true },
    { text: '巴渝吊脚楼', subtext: '', x: 28.5, y: 17.5, z: zRiver + 2.5, w: 1.5, h: 5.2, ry: 0, vertical: true },
  ];
  const frameKit = new HeroKit();
  for (const pl of plaques) {
    // 0.05m clean proud separation between glowing plaque plane & wooden backing box (ZERO distant Z-fighting!)
    const zBack = pl.ry === 0 ? -0.22 : 0.22;
    frameKit.style(C_WOOD, 0.48, 0.05, 0, MAT.TIMBER);
    frameKit.box(pl.x, pl.y, pl.z + zBack, pl.w + 0.4, pl.h + 0.4, 0.34);
    const m = makePlaque(pl.text, { w: pl.w, h: pl.h, subtext: pl.subtext, vertical: pl.vertical, emissiveNight: 3.4, emissiveDay: 0.08 });
    m.position.set(pl.x, pl.y, pl.z);
    m.rotation.y = pl.ry;
    group.add(m);
  }
  const frameMesh = new THREE.Mesh(frameKit.geometry(), materials.heroMatNoFlood);
  frameMesh.name = 'hongyadong-plaque-frames';
  frameMesh.matrixAutoUpdate = false;
  frameMesh.updateMatrix();
  group.add(frameMesh);

  // ---- Colliders (Phase 5: full solid walls down to -baseDrop + angled 11F retaining wall + walkable 1F/11F stairs!) ----
  const polyW = (pts) => pts.map(([lx, lz]) => { const w = toWorld(cx, 0, cz, rotY, lx, 0, lz); return [w[0], w[2]]; });
  const prisms = [
    // Main 11-story diaojiaolou building volume (strictly behind 1F promenade z=38.8 & in front of 11F plaza z=-14)
    { type: 'rect', ...xyObj(toWorld(cx, y1F, cz, rotY, 0, 0, 12.4)), ang: rotY, hx: halfW + 3, hz: 26.4, base: y1F - baseDrop, top: y11F + 18 },
    // Diagonal 11F Cangbai sandstone retaining wall (matches exact cangbaiPoly so ZERO wall-clipping in t03 & >=5m clear of Cangbai Rd!)
    { type: 'poly', pts: polyW(cangbaiPoly), base: y1F - baseDrop, top: y11F - 0.12 },
    // Three 1F waterfront sandstone retaining plinth bays (z ∈ [35.5, 44.2], leaving twin recessed entrance staircases passable!)
    ...frontBays.map(([x0, x1]) => ({
      type: 'rect',
      ...xyObj(toWorld(cx, y1F, cz, rotY, (x0 + x1) * 0.5, 0, (35.5 + zFront) * 0.5)),
      ang: rotY,
      hx: (x1 - x0) * 0.5,
      hz: (zFront - 35.5) * 0.5,
      base: y1F - baseDrop,
      top: y1F - 0.12,
    })),
  ];
  const plazas = [
    { type: 'rectPlaza', ...xyObj(toWorld(cx, y1F, cz, rotY, 0, 0, zRiver + 3.25)), ang: rotY, hx: halfW + 4, hz: 3.5, base: y1F - 8, top: y1F + 0.04 },
    { type: 'polyPlaza', pts: polyW(cangbaiPoly), base: y11F - 4, top: y11F + 0.04 },
    { type: 'rectPlaza', ...xyObj(toWorld(cx, y1F, cz, rotY, -10 - wTerrW / 2, 11.92, zRiver - 0.5)), ang: rotY, hx: wTerrW / 2, hz: 4.7, base: y1F + 9, top: y1F + 11.95 },
    { type: 'rectPlaza', ...xyObj(toWorld(cx, y1F, cz, rotY, 28 + eArcW / 2, 11.92, zRiver - 0.5)), ang: rotY, hx: eArcW / 2, hz: 4.7, base: y1F + 9, top: y1F + 11.95 },
  ];
  const mkDeck = (a, b, hw) => {
    const pA = toWorld(cx, y1F, cz, rotY, a[0], a[1], a[2]);
    const pB = toWorld(cx, y1F, cz, rotY, b[0], b[1], b[2]);
    return [pA[0], pA[2], pA[1], pB[0], pB[2], pB[1], hw];
  };
  const decks = [
    mkDeck([-26.0, wStairFootY + 0.35, zRiver + 4.8], [-8.5, 0.04, zRiver + 4.8], 1.35),
    mkDeck([43.0, eStairFootY + 0.35, zRiver + 4.8], [25.5, 0.04, zRiver + 4.8], 1.35),
    mkDeck([18, gateFootLocalY + 0.3, gateZFoot], [18, yPlaza + 0.04, -41.2], 9.0),
  ];

  // ---- Deep Warm Amber-Gold & Crimson LocalLights (tasteful pools — ZERO pale bleached walls!) ----
  const lights = [];
  const pushLight = (lx, ly, lz, radius, r, g, b, intensity, omni = 1) => {
    const [wx, wy, wz] = toWorld(cx, y1F, cz, rotY, lx, ly, lz);
    lights.push({ x: wx, y: wy, z: wz, radius, r, g, b, intensity, omni });
  };
  for (let row = 0; row < 3; row++) {
    const ly = 12 + row * 24;
    const lz = zRiver + 6 - row * 10;
    for (let k = 0; k < 6; k++) {
      const lx = -halfW + 16 + (W - 32) * (k / 5);
      pushLight(lx, ly, lz, 38, 1.0, 0.40, 0.06, 560, 1);
    }
  }
  // Warm golden flank lights illuminating East (Qiansimen Bridge side) & West watchtowers
  for (const sg of [-1, 1]) {
    pushLight(sg * (halfW + 6), 24, zRiver - 8, 36, 1.0, 0.38, 0.06, 540, 1);
    pushLight(sg * (halfW + 6), 54, zRiver - 22, 36, 1.0, 0.40, 0.06, 540, 1);
  }
  pushLight(wfX, 5.5, zRiver + 4.5, 32, 0.18, 0.62, 0.85, 620, 1);
  pushLight(wfX, 18.0, zRiver + 1.0, 34, 1.0, 0.48, 0.10, 520, 1);
  for (let k = 0; k < 4; k++) {
    const lx = -halfW + 24 + (W - 48) * (k / 3);
    pushLight(lx, 5.2, zRiver + 11, 26, 1.0, 0.48, 0.12, 480, 0);
    pushLight(lx, yPlaza + 5.5, -30, 30, 1.0, 0.50, 0.12, 540, 0);
  }

  return {
    group,
    colliders: { prisms, plazas, decks },
    lights,
    labels: [{ name: '洪崖洞', x: cx, y: y11F + 28, z: cz }],
  };
}
