// True-3D Photorealistic Architectural Facade Kit for Chongqing 3D (Phase 3 Overhaul — runs in Web Worker on LOD0/LOD1).
// Eliminates "simple lines" at 5-15m macro inspection with real physical shadow-casting & GTAO-catching geometry:
//   - True 3D recessed window assemblies: beveled stone sills, left/right perimeter jambs, overhanging eyebrow hoods,
//     central 3D vertical mullions & upper transom bars, and stainless-steel anti-theft security cages (防盗网)
//   - Lived-in Chongqing balcony architecture: multi-bar iron railings & glass balustrades with vertical posts & steel
//     spigots, terracotta planter boxes with organic 3D foliage tufts, balcony drying poles with hanging laundry,
//     multi-part AC outdoor units (galvanized L-brackets + fan casing + refrigerant conduit), vertical exterior PVC
//     drainpipes (落水管) with floor-by-floor steel clamp collars
//   - True 3D ground-floor Chongqing storefronts: granite threshold steps, recessed aluminum display frames, horizontal
//     transoms, twin stainless door pull-handles, angled awnings with structural steel side brackets, pier wall sconces
//     & shop soffit downlights, stepped 2-tier podium cornices + dentils, framed lightboxes & vertical neon blade signs
//   - Deep 3D CBD curtain-wall grids: both vertical aluminum structural fins AND horizontal spandrel transom fins!

import { ST, KIND, BFLAG, BMASK, STYLE, hash11, computeBayGrid, isBalconyBay } from './styles.js';

/** Build an orthonormal wall frame for ring edge k: (x0, n0) -> (x1, n1) in tile-local (east, north) space. */
function makeEdgeFrame(r, k) {
  const n = r.length / 2;
  const i = k * 2, j = ((k + 1) % n) * 2;
  const x0 = r[i], n0 = r[i + 1], x1 = r[j], n1 = r[j + 1];
  const ex = x1 - x0, en = n1 - n0;
  const len = Math.hypot(ex, en);
  if (len < 0.4) return null;
  const tx = ex / len, tn = en / len;
  const nx = tn, nn = -tx; // outward right of CCW ring
  return { x0, n0, tx, tn, nx, nn, len, south: -nn > 0.25 };
}

/** Point on an edge frame: u along edge, y tile elevation, d outward protrusion from wall plane. */
function ep(e, u, y, d) {
  return [e.x0 + e.tx * u + e.nx * d, y, e.n0 + e.tn * u + e.nn * d];
}

/**
 * Emit an oriented 3D architectural box attached to wall edge `e`.
 * Spans [u0, u1] along edge, [y0, y1] vertically, [d0, d1] outward protrusion (d1 > d0).
 * Supports exact box-local [0,1]x[0,1] UV encoding via `aEdge = (boxH, aux0, boxY0, aux1)`.
 */
export function addWallBox(B, e, u0, u1, y0, y1, d0, d1, kFront, kSide, kTop, kBot, opts = null) {
  if (u1 - u0 < 0.012 || y1 - y0 < 0.012 || d1 - d0 < 0.008) return;
  const w = u1 - u0, h = y1 - y0, dep = d1 - d0;
  const uvLocal = opts && opts.uvLocal;
  const skipBack = !opts || opts.skipBack !== false;
  const skipBot = opts && opts.skipBot;
  const skipTop = opts && opts.skipTop;
  const skipSides = opts && opts.skipSides;

  const savedE0 = B.e0, savedE1 = B.e1, savedE2 = B.e2, savedE3 = B.e3;
  if (uvLocal) {
    B.e0 = h;
    B.e1 = opts.aux0 ?? 0;
    B.e2 = y0;
    B.e3 = opts.aux1 ?? (w / Math.max(h, 0.05));
  } else if (opts && opts.aux0 !== undefined) {
    B.e1 = opts.aux0;
  }

  // Front face (outward = +N at d1)
  if (kFront >= 0) {
    const a = ep(e, u0, y0, d1), b = ep(e, u1, y0, d1), c = ep(e, u1, y1, d1), d = ep(e, u0, y1, d1);
    const ua = uvLocal ? 0 : u0, ub = uvLocal ? 1 : u1;
    B.face([[a[0], a[1], a[2], ua], [b[0], b[1], b[2], ub], [c[0], c[1], c[2], ub], [d[0], d[1], d[2], ua]],
      kFront, e.nx, 0, e.nn, true);
  }
  // Back face (-N at d0, only when detached from wall)
  if (!skipBack && kFront >= 0) {
    const kB = (opts && opts.kBack !== undefined) ? opts.kBack : kSide;
    if (kB >= 0) {
      const a = ep(e, u1, y0, d0), b = ep(e, u0, y0, d0), c = ep(e, u0, y1, d0), d = ep(e, u1, y1, d0);
      const ua = uvLocal ? 0 : u0, ub = uvLocal ? 1 : u1;
      B.face([[a[0], a[1], a[2], ua], [b[0], b[1], b[2], ub], [c[0], c[1], c[2], ub], [d[0], d[1], d[2], ua]],
        kB, -e.nx, 0, -e.nn, true);
    }
  }
  // Top face (+Y at y1)
  if (!skipTop && kTop >= 0) {
    const a = ep(e, u0, y1, d0), b = ep(e, u1, y1, d0), c = ep(e, u1, y1, d1), d = ep(e, u0, y1, d1);
    B.face([[a[0], a[1], a[2], 0], [b[0], b[1], b[2], w], [c[0], c[1], c[2], w], [d[0], d[1], d[2], 0]],
      kTop, 0, 1, 0, true);
  }
  // Bottom face (-Y at y0)
  if (!skipBot && kBot >= 0) {
    const a = ep(e, u0, y0, d1), b = ep(e, u1, y0, d1), c = ep(e, u1, y0, d0), d = ep(e, u0, y0, d0);
    B.face([[a[0], a[1], a[2], 0], [b[0], b[1], b[2], w], [c[0], c[1], c[2], w], [d[0], d[1], d[2], 0]],
      kBot, 0, -1, 0, true);
  }
  // Side faces (-T at u0, +T at u1)
  if (!skipSides && kSide >= 0) {
    const sideLocal = opts && opts.sideUvLocal;
    if (sideLocal) {
      B.e0 = h; B.e1 = opts.aux0 ?? 0; B.e2 = y0; B.e3 = opts.aux1 ?? (dep / Math.max(h, 0.05));
    }
    const uS0 = sideLocal ? 0 : 0, uS1 = sideLocal ? 1 : dep;
    const l0 = ep(e, u0, y0, d1), l1 = ep(e, u0, y0, d0), l2 = ep(e, u0, y1, d0), l3 = ep(e, u0, y1, d1);
    B.face([[l0[0], l0[1], l0[2], uS0], [l1[0], l1[1], l1[2], uS1], [l2[0], l2[1], l2[2], uS1], [l3[0], l3[1], l3[2], uS0]],
      kSide, -e.tx, 0, -e.tn, true);
    const r0 = ep(e, u1, y0, d0), r1 = ep(e, u1, y0, d1), r2 = ep(e, u1, y1, d1), r3 = ep(e, u1, y1, d0);
    B.face([[r0[0], r0[1], r0[2], uS0], [r1[0], r1[1], r1[2], uS1], [r2[0], r2[1], r2[2], uS1], [r3[0], r3[1], r3[2], uS0]],
      kSide, e.tx, 0, e.tn, true);
  }

  B.e0 = savedE0; B.e1 = savedE1; B.e2 = savedE2; B.e3 = savedE3;
}

/** Two-tier stepped architectural cornice moulding + optional corbelled dentils (corner-inset & pier-clear, ZERO Z-fighting!). */
function addSteppedCornice(B, e, u0, u1, yCenter, totalH, depth, kindMain, addDentils = false, bedDepth = null) {
  const cu0 = Math.max(0.04, u0);
  const cu1 = Math.min(e.len - 0.04, u1);
  if (cu1 - cu0 < 0.4) return;
  const hBot = totalH * 0.42;
  const yBot = yCenter - totalH * 0.5;
  const dBed = bedDepth !== null ? Math.min(depth - 0.06, bedDepth) : (depth * 0.58);
  // Lower recessed bed mould (stops strictly at yBot + hBot, skipTop prevents coplanar soffit overlap!)
  addWallBox(B, e, cu0, cu1, yBot, yBot + hBot, -0.02, dBed, kindMain, kindMain, -1, KIND.soffit, { skipTop: true });
  // Upper overhanging crown fascia (inset 2cm from edge ends so adjacent building corners NEVER overlap!)
  addWallBox(B, e, Math.max(0.02, cu0 - 0.02), Math.min(e.len - 0.02, cu1 + 0.02), yBot + hBot, yBot + totalH, -0.02, depth, kindMain, kindMain, kindMain, KIND.soffit);
  // Corbel / dentil brackets tucked cleanly in front of bed mould and strictly below crown soffit
  if (addDentils && cu1 - cu0 >= 4.0 && depth - dBed >= 0.07) {
    const span = cu1 - cu0;
    const nd = Math.min(12, Math.max(3, Math.floor(span / 1.15)));
    for (let i = 0; i < nd; i++) {
      const uc = cu0 + (i + 0.5) * (span / nd);
      addWallBox(B, e, uc - 0.09, uc + 0.09, yBot - 0.12, yBot + hBot - 0.01, dBed + 0.01, depth - 0.01,
        kindMain, kindMain, -1, KIND.soffit, { skipTop: true });
    }
  }
}

/** Sloped 3D awning / cantilevered rain canopy with angled structural steel side brackets & front aluminum drip lip! */
function addSlopedAwning(B, e, u0, u1, yBack, yFront, dOut, valanceH, kindTop, seedVal, addBrackets = true) {
  const savedE0 = B.e0, savedE1 = B.e1;
  B.e0 = u1 - u0;
  B.e1 = seedVal;
  const a0 = ep(e, u0, yBack, -0.02), a1 = ep(e, u1, yBack, -0.02);
  const b0 = ep(e, u0, yFront, dOut), b1 = ep(e, u1, yFront, dOut);
  const slopeDy = yBack - yFront;
  const sl = Math.hypot(dOut, slopeDy) || 1;
  const nyUp = dOut / sl, ndUp = slopeDy / sl;
  // Top sloped canopy face
  B.face([[b0[0], b0[1], b0[2], 0], [b1[0], b1[1], b1[2], u1 - u0], [a1[0], a1[1], a1[2], u1 - u0], [a0[0], a0[1], a0[2], 0]],
    kindTop, e.nx * ndUp, nyUp, e.nn * ndUp, true);
  // Shaded underside soffit
  B.face([[a0[0], a0[1] - 0.04, a0[2], 0], [a1[0], a1[1] - 0.04, a1[2], u1 - u0], [b1[0], b1[1] - 0.04, b1[2], u1 - u0], [b0[0], b0[1] - 0.04, b0[2], 0]],
    KIND.soffit, -e.nx * ndUp, -nyUp, -e.nn * ndUp, true);
  // Front vertical valance lip + slim dark aluminum front drip rail
  if (valanceH > 0.04) {
    const v0 = ep(e, u0, yFront - valanceH, dOut), v1 = ep(e, u1, yFront - valanceH, dOut);
    B.face([[v0[0], v0[1], v0[2], 0], [v1[0], v1[1], v1[2], u1 - u0], [b1[0], b1[1], b1[2], u1 - u0], [b0[0], b0[1], b0[2], 0]],
      kindTop, e.nx, 0, e.nn, true);
    B.face([[ep(e, u0, yFront, -0.02)[0], yFront, ep(e, u0, yFront, -0.02)[2]], b0, a0], kindTop, -e.tx, 0, -e.tn, false);
    B.face([[ep(e, u1, yFront, -0.02)[0], yFront, ep(e, u1, yFront, -0.02)[2]], a1, b1], kindTop, e.tx, 0, e.tn, false);
  }
  B.e0 = savedE0; B.e1 = savedE1;

  // Real 3D angled dark-steel awning support brackets under both ends!
  if (addBrackets && dOut >= 0.7) {
    addDiagonalStrut(B, e, u0 + 0.08, yFront - 0.42, yFront - 0.04, dOut * 0.78, 0.045, KIND.steelBracket);
    addDiagonalStrut(B, e, u1 - 0.08, yFront - 0.42, yFront - 0.04, dOut * 0.78, 0.045, KIND.steelBracket);
  }
}

/** Diagonal 3D support strut (timber Bayu diaojiaolou brace or steel canopy/awning bracket). */
function addDiagonalStrut(B, e, uCenter, yWall, yOuter, dOuter, thickness, kind) {
  const ht = thickness * 0.5;
  const w0 = ep(e, uCenter - ht, yWall, -0.02);
  const w1 = ep(e, uCenter + ht, yWall, -0.02);
  const o0 = ep(e, uCenter - ht, yOuter, dOuter);
  const o1 = ep(e, uCenter + ht, yOuter, dOuter);
  const w0b = [w0[0], w0[1] - thickness, w0[2]];
  const w1b = [w1[0], w1[1] - thickness, w1[2]];
  const o0b = [o0[0], o0[1] - thickness, o0[2]];
  const o1b = [o1[0], o1[1] - thickness, o1[2]];
  B.face([w0, w1, o1, o0], kind, e.nx * 0.4, 0.85, e.nn * 0.4, false);
  B.face([o0b, o1b, w1b, w0b], kind, -e.nx * 0.4, -0.85, -e.nn * 0.4, false);
  B.face([w0b, w0, o0, o0b], kind, -e.tx, 0, -e.tn, false);
  B.face([w1, w1b, o1b, o1], kind, e.tx, 0, e.tn, false);
}

/** 3D Vertical Chongqing illuminated neon/LED blade sign mounted perpendicular to a facade pier. */
function addVerticalBladeSign(B, e, uPier, y0, h, proj, seedVal) {
  const halfT = 0.08;
  const d0 = 0.16;
  const d1 = d0 + proj;
  const y1 = y0 + h;
  addWallBox(B, e, uPier - 0.035, uPier + 0.035, y0 + h * 0.16, y0 + h * 0.16 + 0.06, -0.03, d0 + 0.02, -1, KIND.steelBracket, KIND.steelBracket, KIND.steelBracket);
  addWallBox(B, e, uPier - 0.035, uPier + 0.035, y1 - h * 0.16 - 0.06, y1 - h * 0.16, -0.03, d0 + 0.02, -1, KIND.steelBracket, KIND.steelBracket, KIND.steelBracket);
  addWallBox(B, e, uPier - halfT, uPier + halfT, y0, y1, d0, d1,
    KIND.darkFrame, KIND.signV, KIND.darkFrame, KIND.darkFrame,
    { skipBack: false, kBack: KIND.darkFrame, sideUvLocal: true, aux0: seedVal, aux1: proj / Math.max(h, 0.1) });
}

/** Multi-part 3D AC Outdoor Unit: galvanized L-brackets + detailed fan casing + insulated wall refrigerant conduit! */
function addMultiPartAC(B, e, uLeft, yBot, seedVal) {
  const w = 0.78, h = 0.54, d = 0.30;
  // Twin galvanized steel L-brackets underneath
  addWallBox(B, e, uLeft + 0.08, uLeft + 0.14, yBot - 0.08, yBot, -0.02, d + 0.02, -1, KIND.steelBracket, -1, KIND.steelBracket, { skipTop: true });
  addWallBox(B, e, uLeft + w - 0.14, uLeft + w - 0.08, yBot - 0.08, yBot, -0.02, d + 0.02, -1, KIND.steelBracket, -1, KIND.steelBracket, { skipTop: true });
  // Main AC unit body with exact [0,1]x[0,1] UV on front face for fan grille shader
  addWallBox(B, e, uLeft, uLeft + w, yBot, yBot + h, 0.02, d,
    KIND.acUnit, KIND.trim, KIND.trim, KIND.soffit,
    { uvLocal: true, aux0: seedVal, aux1: w / h });
  // Refrigerant conduit pipe looping cleanly from right side of AC unit into facade wall
  addWallBox(B, e, uLeft + w, uLeft + w + 0.07, yBot + 0.06, yBot + 0.36, 0.0, 0.12,
    KIND.pvcPipe, KIND.pvcPipe, -1, -1, { skipTop: true, skipBot: true });
}

/** Vertical exterior PVC drainpipe (落水管) running continuously down a facade with steel wall clamp collars! */
function addDrainPipe(B, e, uPos, y0, y1) {
  if (y1 - y0 < 2.5) return;
  const r = 0.055;
  addWallBox(B, e, uPos - r, uPos + r, y0, y1, 0.01, 0.11, KIND.pvcPipe, KIND.pvcPipe, KIND.darkFrame, -1, { skipBot: true });
  // Steel mounting clamp collars every ~3.4m (capped at 8 collars)
  const step = Math.max(3.2, (y1 - y0) / 8);
  for (let yc = y0 + 1.4; yc < y1 - 0.8; yc += step) {
    addWallBox(B, e, uPos - r - 0.025, uPos + r + 0.025, yc, yc + 0.06, -0.01, 0.125,
      KIND.railMetal, KIND.railMetal, -1, -1, { skipTop: true, skipBot: true });
  }
}

/**
 * True 3D Recessed Architectural Window Assembly:
 *   - Beveled projecting stone sill (2-step profile with drip lip)
 *   - Left & right 3D perimeter jamb surrounds + top head frame + overhanging rain eyebrow hood
 *   - Real 3D central vertical aluminum mullion + upper horizontal transom bar casting CSM micro-shadows!
 *   - Optional Chongqing stainless-steel anti-theft security cage (防盗网)!
 */
function add3DWindowAssembly(B, e, wu0, wu1, ySill, yHead, opts) {
  const w = wu1 - wu0, h = yHead - ySill;
  if (w < 0.7 || h < 0.8) return;
  const trimK = opts.trimKind ?? KIND.trim;
  const sillD = opts.sillD ?? 0.17;
  const browD = opts.browD ?? 0.30;
  const jambD = opts.jambD ?? 0.14;
  const jambW = opts.jambW ?? 0.095;
  const addSill = opts.addSill !== false;
  const addBrow = opts.addBrow !== false;

  // 1. Beveled projecting stone sill (drip undercut + wider projecting sill cap, non-overlapping!)
  if (addSill) {
    addWallBox(B, e, wu0 - 0.10, wu1 + 0.10, ySill - 0.10, ySill - 0.04, -0.02, sillD * 0.62, trimK, trimK, -1, KIND.soffit, { skipTop: true });
    addWallBox(B, e, wu0 - 0.12, wu1 + 0.12, ySill - 0.04, ySill + 0.02, -0.02, sillD, trimK, trimK, trimK, KIND.soffit);
  }
  // 2. Protruding left & right 3D perimeter stone/precast jambs (strictly between sill cap and eyebrow!)
  addWallBox(B, e, wu0 - jambW, wu0 + 0.02, ySill + 0.025, yHead - 0.005, -0.02, jambD, trimK, trimK, -1, -1, { skipTop: true, skipBot: true });
  addWallBox(B, e, wu1 - 0.02, wu1 + jambW, ySill + 0.025, yHead - 0.005, -0.02, jambD, trimK, trimK, -1, -1, { skipTop: true, skipBot: true });

  // 3. Overhanging rain-shedding eyebrow hood / head lintel
  if (addBrow) {
    addWallBox(B, e, wu0 - 0.12, wu1 + 0.12, yHead, yHead + 0.11, -0.02, browD, trimK, trimK, trimK, KIND.soffit);
  } else {
    addWallBox(B, e, wu0 - jambW, wu1 + jambW, yHead, yHead + 0.09, -0.02, jambD + 0.06, trimK, trimK, trimK, KIND.soffit);
  }

  // 4. Physical 3D dark-bronze/charcoal aluminum inner window sash mullions (strict 5cm depth separation between vertical & transom!)
  if (opts.mullions !== false) {
    const midU = (wu0 + wu1) * 0.5;
    addWallBox(B, e, midU - 0.026, midU + 0.026, ySill + 0.025, yHead - 0.015, -0.01, 0.115,
      KIND.darkFrame, KIND.darkFrame, -1, -1, { skipTop: true, skipBot: true });
    if (h >= 1.25) {
      const yTr = ySill + h * 0.70;
      addWallBox(B, e, wu0 + 0.025, wu1 - 0.025, yTr - 0.022, yTr + 0.022, -0.01, 0.065,
        KIND.darkFrame, -1, KIND.darkFrame, KIND.soffit, { skipSides: true });
    }
  }

  // 5. Authentic Chongqing stainless-steel anti-theft security cage (防盗网 — non-overlapping front rails, inner verticals & side returns!)
  if (opts.cage) {
    const cD = 0.28;
    const cu0 = wu0 - 0.04, cu1 = wu1 + 0.04;
    const cy0 = ySill + 0.03, cy1 = yHead - 0.03;
    // Top & bottom front horizontal stainless rails
    addWallBox(B, e, cu0, cu1, cy0, cy0 + 0.035, cD - 0.03, cD, KIND.securityCage, -1, KIND.securityCage, KIND.soffit, { skipSides: true });
    addWallBox(B, e, cu0, cu1, cy1 - 0.035, cy1, cD - 0.03, cD, KIND.securityCage, -1, KIND.securityCage, KIND.soffit, { skipSides: true });
    // Two mid-height side return bars anchoring cage cleanly behind front rails
    const cyMid = (cy0 + cy1) * 0.5;
    addWallBox(B, e, cu0, cu0 + 0.03, cyMid - 0.02, cyMid + 0.02, 0.0, cD - 0.04, -1, KIND.securityCage, KIND.securityCage, -1, { skipBot: true });
    addWallBox(B, e, cu1 - 0.03, cu1, cyMid - 0.02, cyMid + 0.02, 0.0, cD - 0.04, -1, KIND.securityCage, KIND.securityCage, -1, { skipBot: true });
    // 3-4 slim vertical stainless bars tucked cleanly behind front rails (zero coplanar junction Z-fighting!)
    const nBars = Math.min(4, Math.max(3, Math.round(w / 0.56)));
    for (let bi = 0; bi < nBars; bi++) {
      const ub = cu0 + 0.06 + (cu1 - cu0 - 0.12) * (bi / (nBars - 1));
      addWallBox(B, e, ub - 0.013, ub + 0.013, cy0 + 0.035, cy1 - 0.035, cD - 0.055, cD - 0.035,
        KIND.securityCage, KIND.securityCage, -1, -1, { skipTop: true, skipBot: true });
    }
  }
}

/** Lived-in Chongqing balcony clutter: terracotta planter boxes with organic 3D foliage tufts + hanging laundry (zero balustrade overlap!). */
function addBalconyClutter(B, e, bU0, bU1, yFl, fH, balD, seedVal, allowLaundry) {
  const w = bU1 - bU0;
  if (w < 1.4) return;
  const hPlant = hash11(seedVal * 1.73 + 2.1);
  const hCloth = hash11(seedVal * 2.91 + 9.7);

  // 1. Terracotta / ceramic planter box tucked cleanly inside glass/iron balustrade (14cm+ clearance -> zero Z-fighting!)
  if (hPlant < 0.46) {
    const pw = Math.min(0.84, w * 0.34);
    const pu0 = hPlant < 0.23 ? (bU0 + 0.22) : (bU1 - 0.22 - pw);
    const pu1 = pu0 + pw;
    const pd0 = Math.max(0.14, balD - 0.54), pd1 = balD - 0.25;
    if (pd1 - pd0 >= 0.14) {
      addWallBox(B, e, pu0, pu1, yFl + 0.045, yFl + 0.40, pd0, pd1, KIND.terracottaPot, KIND.terracottaPot, KIND.terracottaPot, -1, { skipBot: true });
      // Two non-overlapping 3D foliage clusters rising cleanly above planter top
      const fBase = yFl + 0.41;
      const pMid = pu0 + pw * 0.50;
      addWallBox(B, e, pu0 - 0.02, pMid - 0.01, fBase, fBase + 0.44 + 0.20 * hash11(seedVal + 4.1), pd0, pd1,
        KIND.planterFoliage, KIND.planterFoliage, KIND.planterFoliage, KIND.soffit, { aux0: seedVal });
      addWallBox(B, e, pMid + 0.02, pu1 + 0.02, fBase + 0.03, fBase + 0.54 + 0.22 * hash11(seedVal + 8.3), pd0 + 0.02, pd1 - 0.02,
        KIND.planterFoliage, KIND.planterFoliage, KIND.planterFoliage, KIND.soffit, { aux0: seedVal + 7.1 });
    }
  }

  // 2. Balcony stainless drying pole + staggered hanging laundry garments (strictly below pole -> zero pole/cloth Z-fighting!)
  if (allowLaundry && hCloth < 0.34 && fH >= 2.65) {
    const yPole = yFl + fH - 0.34;
    const pd = balD * 0.56;
    addWallBox(B, e, bU0 + 0.18, bU1 - 0.18, yPole, yPole + 0.028, pd - 0.016, pd + 0.016,
      KIND.securityCage, -1, KIND.securityCage, KIND.soffit, { skipSides: true });
    const nItems = w >= 2.2 ? 3 : 2;
    const span = w - 0.52;
    for (let li = 0; li < nItems; li++) {
      const lh = hash11(seedVal * 3.1 + li * 11.7);
      if (lh > 0.78) continue;
      const cu = bU0 + 0.26 + (li + 0.5) * (span / nItems) + (lh - 0.5) * 0.12;
      const gw = 0.34 + 0.18 * hash11(lh * 17.3);
      const gh = 0.52 + 0.34 * hash11(lh * 29.1);
      addWallBox(B, e, cu - gw * 0.5, cu + gw * 0.5, yPole - gh, yPole - 0.025, pd - 0.008, pd + 0.008,
        KIND.laundryCloth, -1, -1, -1,
        { skipBack: false, kBack: KIND.laundryCloth, skipTop: true, skipBot: true, skipSides: true, aux0: seedVal + li * 19.3 });
    }
  }
}

/**
 * True 3D Recessed Ground-Floor Storefront Assembly (terrain-aware & depth-layered, ZERO Z-fighting!):
 */
function addShopfront3D(B, e, u0, u1, yStart, shopTop, baySeed, drop = 0.0) {
  const su0 = u0 + 0.26, su1 = u1 - 0.26;
  const sw = su1 - su0;
  if (sw < 1.6 || shopTop < 2.2) return;
  if (drop < -0.35) return; // terrain outside bay rises above floor level
  const rightDoor = hash11(baySeed + 9.0) > 0.5;
  const dx = rightDoor ? (su1 - 1.15) : (su0 + 1.15);
  const atStreetGrade = drop <= 0.95;

  // 1. Grounded bush-hammered granite threshold step (street-level) OR slim flush stone sill (cliff-perched display bay)
  if (atStreetGrade) {
    const stepBot = Math.min(yStart - 0.16, yStart - Math.max(0, drop) - 0.18);
    addWallBox(B, e, su0 - 0.04, su1 + 0.04, stepBot, yStart + 0.11, -0.02, 0.30,
      KIND.terracottaPot, KIND.terracottaPot, KIND.trim, -1, { skipBot: true });
  } else {
    addWallBox(B, e, su0 - 0.04, su1 + 0.04, yStart, yStart + 0.11, -0.02, 0.12,
      KIND.trim, KIND.trim, KIND.trim, KIND.soffit);
  }

  // 2. Recessed 3D dark-bronze aluminum perimeter frame (strict 5cm strata: transom 0.075 < door mullion 0.125 < jambs 0.175!)
  addWallBox(B, e, su0, su0 + 0.065, yStart + 0.115, yStart + shopTop - 0.085, -0.02, 0.175, KIND.darkFrame, KIND.darkFrame, -1, -1, { skipTop: true, skipBot: true });
  addWallBox(B, e, su1 - 0.065, su1, yStart + 0.115, yStart + shopTop - 0.085, -0.02, 0.175, KIND.darkFrame, KIND.darkFrame, -1, -1, { skipTop: true, skipBot: true });
  addWallBox(B, e, su0, su1, yStart + shopTop - 0.08, yStart + shopTop + 0.02, -0.02, 0.19, KIND.darkFrame, -1, KIND.darkFrame, KIND.soffit, { skipSides: true });
  addWallBox(B, e, su0 + 0.07, su1 - 0.07, yStart + 2.13, yStart + 2.20, -0.02, 0.075, KIND.darkFrame, -1, KIND.darkFrame, KIND.soffit, { skipSides: true });
  addWallBox(B, e, dx - 0.035, dx + 0.035, yStart + 0.115, yStart + shopTop - 0.085, -0.02, 0.125, KIND.darkFrame, KIND.darkFrame, -1, -1, { skipTop: true, skipBot: true });

  // 3. Real 3D brushed stainless-steel vertical door pull-handles (strictly proud of glass & transom!)
  if (atStreetGrade) {
    const hx = rightDoor ? dx + 0.14 : dx - 0.14;
    addWallBox(B, e, hx - 0.018, hx + 0.018, yStart + 0.88, yStart + 1.30, 0.14, 0.22,
      KIND.securityCage, KIND.securityCage, KIND.securityCage, KIND.securityCage);
  }

  // 4. Recessed warm 2700K shop soffit downlight tucked cleanly above head rail under entablature
  const midU = (su0 + su1) * 0.5;
  addWallBox(B, e, midU - 0.14, midU + 0.14, yStart + shopTop + 0.03, yStart + shopTop + 0.10, 0.16, 0.28,
    KIND.wallSconce, KIND.darkFrame, -1, KIND.wallSconce, { skipTop: true });
}

/**
 * Generate full 3D facade relief for ONE building (LOD0 full street-level & macro realism + LOD1 tall tower fins).
 */
export function addFacadeDetails(B, outer, ef, towerRing, rec, layout) {
  const { style, seed, pal, flags, balconyMask, subtype } = rec;
  const { S, levels, fH, gH, ph, podiumH, yTop, yRef, yBot, H, lod, budgetRatio, sampleY, slope = 0 } = layout;
  if (style === ST.canopy || style === ST.tank || style === ST.construction) return;

  const sampleOut = (e, u, dOut) => {
    if (!sampleY) return yRef;
    const y = sampleY(e.x0 + e.tx * u + e.nx * dOut, e.n0 + e.tn * u + e.nn * dOut);
    return Number.isFinite(y) ? y : yRef;
  };

  const base = rec.base || 0;
  const yStart = yRef + base;
  const hTotal = H - yStart;
  if (hTotal < 2.6) return;

  // Set building vertex attributes (preserved across all kit parts)
  B.b0 = style; B.b1 = seed; B.b2 = pal; B.b3 = Math.min(255, levels);
  B.e0 = 0; B.e1 = hTotal; B.e2 = yRef; B.e3 = podiumH;
  B.f1 = Math.max(1, Math.min(255, Math.round(fH * 40)));
  B.f2 = Math.max(1, Math.min(255, Math.round(gH * 20)));
  B.f3 = flags;

  // LOD1 mid-range: silhouette-defining vertical fins & crown cornices on tall towers (> 34m)
  if (lod >= 1) {
    if (hTotal >= 34 && (S.fins === 'curtain' || S.fins === 'pilaster' || S.crownLed)) {
      const targetRing = towerRing || outer;
      const yBaseFin = towerRing ? yStart + podiumH : yStart + gH;
      const n = targetRing.length / 2;
      for (let k = 0; k < n; k++) {
        const e = makeEdgeFrame(targetRing, k);
        if (!e || e.len < 6.0) continue;
        const grid = computeBayGrid(e.len, style, seed, false);
        if (grid.nb < 2) continue;
        const step = Math.max(1, Math.ceil(grid.nb / 6));
        const finKind = S.curtain ? KIND.metal : KIND.trim;
        for (let ci = 0; ci <= grid.nb; ci += step) {
          const u = grid.margin + ci * grid.bw;
          addWallBox(B, e, u - 0.11, u + 0.11, yBaseFin, H, -0.02, S.curtain ? 0.28 : 0.20, finKind, finKind, finKind, -1);
        }
        if (S.crownLed && hTotal >= 55) {
          addWallBox(B, e, 0.0, e.len, H - 0.55, H + 0.05, -0.02, 0.30, KIND.ledStrip, KIND.ledStrip, KIND.trim, KIND.soffit);
        }
      }
    }
    return;
  }

  // ---- LOD 0: FULL PHASE 3 MACRO-GRADE 3D ARCHITECTURAL REALISM ----
  // Never early-abort a building mid-tile! Every LOD0 building ALWAYS keeps its core 3D architecture
  // (podium pilasters, stone pedestals, stepped entablature, 3D window frames/sills/eyebrows, stringcourses,
  // shopfront frames/lightboxes, balconies & fins); dense >300-building tiles gracefully taper only secondary
  // fine clutter (security cages, dentils, laundry/planters, extra pickets, conduits) via highBudget/medBudget.
  const highBudget = budgetRatio < 0.85;
  const medBudget = budgetRatio < 1.15;
  const hasExplicitMask = (balconyMask || 0) !== 0;

  const wantBalcony = S.balcony !== 'none' && (!hasExplicitMask || (balconyMask & BMASK.balconies) !== 0 || S.balcony === 'bayu');
  const wantAC = S.acDensity > 0 && highBudget && (!hasExplicitMask || (balconyMask & BMASK.acUnits) !== 0);
  const wantSunshade = S.eyebrows && (!hasExplicitMask || (balconyMask & BMASK.sunshades) !== 0 || S.eyebrows);
  const wantBlades = S.bladeProb > 0 && (!hasExplicitMask || (balconyMask & BMASK.neonBlades) !== 0 || S.bladeProb >= 0.45);
  const wantFins = S.fins !== 'none' || (balconyMask & BMASK.curtainFins) !== 0;
  const wantCornices = S.ledgeStep > 0 || (balconyMask & BMASK.cornices) !== 0;
  const wantCrownLed = (S.crownLed || (balconyMask & BMASK.crownLeds) !== 0) && hTotal >= 45;
  const isResiOld = style === ST.resi_old_highrise || style === ST.resi_walkup || style === ST.generic;
  const isHistoric = style === ST.historic_masonry || style === ST.civic;

  // Determine longest non-party edges so buildings without OSM street-front flags still get streetscape on primary facades
  const nOuter = outer.length / 2;
  let longestEdge = -1, longestLen = 0, secondEdge = -1, secondLen = 0;
  let hasAnyStreetFlag = false;
  for (let k = 0; k < nOuter; k++) {
    const f = ef ? ef[k] : 0;
    if (f & 1) hasAnyStreetFlag = true;
    if (f & 2) continue;
    const i = k * 2, j = ((k + 1) % nOuter) * 2;
    const l = Math.hypot(outer[j] - outer[i], outer[j + 1] - outer[i + 1]);
    if (l > longestLen) { secondLen = longestLen; secondEdge = longestEdge; longestLen = l; longestEdge = k; }
    else if (l > secondLen) { secondLen = l; secondEdge = k; }
  }

  // =========================================================================
  // PART A: GROUND FLOOR / MULTI-STORY PODIUM 3D STREETSCAPE (outer ring)
  // =========================================================================
  if (base < 0.5) {
    for (let k = 0; k < nOuter; k++) {
      const f = ef ? ef[k] : 0;
      if (f & 2) continue;
      const e = makeEdgeFrame(outer, k);
      if (!e || e.len < 3.6) continue;
      B.e0 = e.len;
      B.f0 = f;

      const isFront = (f & 1) !== 0 || (!hasAnyStreetFlag && (k === longestEdge || (k === secondEdge && e.len > 7.5)));
      const commFlag = (flags & BFLAG.commercialGround) !== 0;
      const isShop = isFront && gH >= 2.8 && e.len >= 4.4 &&
        (commFlag || hash11(seed * 0.73 + k * 2.1) < S.shopProb);

      const grid = computeBayGrid(e.len, style, seed, isShop);
      if (grid.nb < 1) continue;

      const pierH = podiumH > 0 ? podiumH : gH;
      const pierKind = (style === ST.bayu_vernacular || style === ST.temple) ? KIND.timber
        : (style === ST.cbd_supertall || style === ST.office_glass || style === ST.commercial_mall || style === ST.hotel || style === ST.civic) ? KIND.podiumWall
        : KIND.trim;
      const trimK = (style === ST.bayu_vernacular || style === ST.temple) ? KIND.timber : KIND.trim;

      // 1. Full-podium-height 3D vertical structural piers (corner-inset, strictly below podium roof terrace, non-overlapping pedestals & capitals!)
      const pierW = (style === ST.bayu_vernacular || style === ST.temple) ? 0.26 : (isShop ? 0.42 : 0.34);
      const pierD = isShop ? (slope >= 3.0 ? 0.38 : 0.42) : (podiumH > 0 ? 0.32 : 0.28);
      const beamH = podiumH > 0 ? 0.42 : 0.32;
      const beamD = pierD + 0.16;
      const hasPedestal = (isShop || podiumH > 0) && style !== ST.bayu_vernacular;
      const pierStep = grid.nb > 14 ? 2 : 1;
      for (let ci = 0; ci <= grid.nb; ci += pierStep) {
        const u = grid.margin + ci * grid.bw;
        const uL = Math.max(0.05, u - pierW * 0.5);
        const uR = Math.min(e.len - 0.05, u + pierW * 0.5);
        if (uR - uL < 0.08) continue;
        // Stop pier strictly below podium roof terrace (pierH - 0.06) and cleanly above pedestal (+0.545) -> ZERO coplanar Z-fighting!
        const yPierBot = hasPedestal ? (yStart + 0.545) : (yStart - 0.15);
        addWallBox(B, e, uL, uR, yPierBot, yStart + pierH - 0.06, -0.02, pierD, pierKind, pierKind, pierKind, -1);
        if (hasPedestal) {
          addWallBox(B, e, Math.max(0.03, uL - 0.06), Math.min(e.len - 0.03, uR + 0.06), yStart - 0.15, yStart + 0.54, -0.02, pierD + 0.08,
            KIND.plinthStone, KIND.plinthStone, KIND.trim, -1);
          // Carved pier capital collar tucked cleanly below ground entablature bottom
          const capTop = yStart + gH - beamH * 0.5 - 0.02;
          addWallBox(B, e, Math.max(0.03, uL - 0.05), Math.min(e.len - 0.03, uR + 0.05), capTop - 0.20, capTop, -0.02, pierD + 0.07,
            trimK, trimK, trimK, KIND.soffit);
        }
        // Exterior architectural pier wall sconce (warm bronze lantern box, glowing 2700K at dusk/night!)
        if ((isShop || (podiumH > 0 && isFront)) && highBudget && ci % 2 === 0 && gH >= 3.2) {
          addWallBox(B, e, u - 0.075, u + 0.075, yStart + 2.30, yStart + 2.60, pierD + 0.01, pierD + 0.13,
            KIND.wallSconce, KIND.darkFrame, KIND.darkFrame, KIND.wallSconce);
        }
      }

      // 2. Stepped 2-tier ground-floor entablature cornice (both bed mould & fascia strictly proud of piers!)
      addSteppedCornice(B, e, 0.04, e.len - 0.04, yStart + gH, beamH, beamD, pierKind, isHistoric && highBudget, pierD + 0.06);

      // 3. Non-shop ground-floor TRUE 3D recessed window frames (sill 0.20 < piers 0.28..0.42 -> zero crossing overlap!)
      if (!isShop && gH >= 2.6 && style !== ST.industrial) {
        const gSillY = podiumH > 0 ? yStart + 0.35 : yStart + Math.max(0.85, gH * 0.28);
        const gHeadY = Math.min(yStart + gH - 0.35, podiumH > 0 ? yStart + gH - 0.45 : yStart + 2.65);
        const winFracW = podiumH > 0 ? 0.78 : 0.52;
        const maxGBays = Math.min(grid.nb, medBudget ? 10 : 6);
        addWallBox(B, e, 0.04, e.len - 0.04, gSillY - 0.11, gSillY, -0.02, 0.20, trimK, trimK, trimK, KIND.soffit);
        for (let ci = 0; ci < maxGBays; ci++) {
          if (Math.round(ci + Math.floor(seed * 0.07)) % 4 === 0 && podiumH === 0) continue; // doorway bay
          const u0 = grid.margin + ci * grid.bw;
          const wW = grid.bw * winFracW;
          const wu0 = u0 + (grid.bw - wW) * 0.5, wu1 = wu0 + wW;
          add3DWindowAssembly(B, e, wu0, wu1, gSillY, gHeadY, {
            trimKind: trimK, sillD: 0.20, browD: pierD + 0.06, jambD: 0.16, jambW: 0.095, addSill: false, mullions: true,
            cage: isResiOld && highBudget && hash11(seed + ci * 7.1 + k) < 0.45,
          });
        }
      }

      // 4. Articulate EVERY upper floor of multi-story podiums (2F..podiumH) with REAL 3D recessed window frames + stringcourses!
      if (podiumH > gH + 1.5) {
        const podUpperFloors = Math.min(5, Math.max(1, Math.floor((podiumH - gH + 0.3) / fH)));
        const pSillFrac = style === ST.historic_masonry ? 0.22 : 0.26;
        const pWinFracH = style === ST.historic_masonry ? 0.58 : 0.54;
        const pWinFracW = style === ST.historic_masonry ? 0.44 : 0.64;
        const maxPBays = Math.min(grid.nb, highBudget ? 10 : 6);
        for (let pfi = 0; pfi < podUpperFloors; pfi++) {
          const yFl = yStart + gH + pfi * fH;
          if (yFl + 1.5 > yStart + podiumH) break;
          const ySill = yFl + fH * pSillFrac;
          const yHead = Math.min(yFl + fH - 0.20, ySill + fH * pWinFracH);
          addWallBox(B, e, 0.04, e.len - 0.04, ySill - 0.10, ySill, -0.02, 0.20, trimK, trimK, trimK, KIND.soffit);
          if (pfi > 0) {
            addSteppedCornice(B, e, 0.04, e.len - 0.04, yFl, 0.24, pierD + 0.14, trimK, false, pierD + 0.06);
          }
          for (let ci = 0; ci < maxPBays; ci++) {
            const u0 = grid.margin + ci * grid.bw;
            const wW = grid.bw * pWinFracW;
            const wu0 = u0 + (grid.bw - wW) * 0.5, wu1 = wu0 + wW;
            add3DWindowAssembly(B, e, wu0, wu1, ySill, yHead, {
              trimKind: trimK, sillD: 0.20, browD: pierD + 0.07, jambD: 0.16, jambW: 0.09, addSill: false, mullions: highBudget,
            });
          }
        }
        // Deep 2-tier stepped podium crown cornice strictly proud of piers!
        addSteppedCornice(B, e, 0.04, e.len - 0.04, yStart + podiumH - 0.30, 0.52, pierD + 0.22, KIND.trim, highBudget, pierD + 0.08);
      }

      // 5. True 3D Street-Level Chongqing Storefronts (granite step, aluminum frame, pull-handles, awnings w/ brackets, lightboxes, neon blades!)
      if (isShop) {
        const shopTop = Math.min(2.90, gH - 0.95);
        const signY0 = yStart + shopTop + 0.12;
        const signY1 = yStart + Math.min(gH - beamH * 0.5 - 0.04, shopTop + 1.04);
        const maxShopBays = Math.min(grid.nb, medBudget ? 12 : 6);
        for (let ci = 0; ci < maxShopBays; ci++) {
          const u0 = grid.margin + ci * grid.bw;
          const u1 = u0 + grid.bw;
          const uMid = (u0 + u1) * 0.5;
          const baySeed = hash11(ci * 3.7 + seed * 1.9 + k * 0.41) * 97.0;
          const gBay = sampleOut(e, uMid, 0.70);
          const bayDrop = yStart - gBay;

          // True 3D recessed shopfront glazing frame, grounded granite step (only at street grade!), twin door handles & soffit downlight!
          if (highBudget || ci < 6) {
            addShopfront3D(B, e, u0, u1, yStart, shopTop, baySeed, bayDrop);
          }

          // 3D protruding framed shop signboard lightbox strictly BETWEEN piers (zero pier-face Z-fighting!)
          const sgU0 = u0 + pierW * 0.5 + 0.06, sgU1 = u1 - pierW * 0.5 - 0.06;
          if (signY1 - signY0 >= 0.42 && sgU1 - sgU0 >= 1.2) {
            addWallBox(B, e, sgU0, sgU1, signY0, signY1, 0.0, pierD + 0.08,
              KIND.signH, KIND.darkFrame, KIND.darkFrame, KIND.soffit,
              { uvLocal: true, aux0: baySeed, aux1: (sgU1 - sgU0) / (signY1 - signY0) });
          }

          // 3D angled street shop awning (雨棚) with structural dark-steel side brackets (strict headroom & cliff-drop guards!)
          if (medBudget && hash11(baySeed + 4.3) < 0.64 && shopTop >= 2.5 && bayDrop <= 2.4 && sgU1 - sgU0 >= 1.2) {
            const awnOut = (slope >= 3.0 ? 0.88 : 1.04) + (slope >= 3.0 ? 0.24 : 0.32) * hash11(baySeed + 8.1);
            const gAwn = Math.max(gBay, sampleOut(e, uMid, awnOut + 0.25));
            const awnLowY = yStart + shopTop - 0.36;
            if (awnLowY >= gAwn + 2.15) {
              addSlopedAwning(B, e, sgU0 + 0.02, sgU1 - 0.02, yStart + shopTop + 0.04, awnLowY, awnOut, 0.22, KIND.awning, baySeed, highBudget);
            }
          }
        }

        // Chongqing 3D Vertical Illuminated Neon / LED Blade Signs (竖排霓虹灯箱)
        if (wantBlades && hTotal >= 6.5 && e.len >= 7.0) {
          const nBlades = Math.min(3, Math.max(1, Math.floor(e.len / 11)));
          for (let bi = 0; bi < nBlades; bi++) {
            const bHash = hash11(seed * 2.3 + k * 5.7 + bi * 11.3);
            if (bHash > S.bladeProb + (commFlag ? 0.25 : 0.0)) continue;
            const pierIdx = Math.min(grid.nb, Math.max(1, Math.round((bi + 0.5) * grid.nb / nBlades)));
            const uPier = grid.margin + pierIdx * grid.bw;
            const bh = 2.4 + 1.8 * hash11(bHash * 19.7 + 1.1);
            const by0 = yStart + Math.min(hTotal - bh - 1.2, Math.max(2.9, gH - 0.2 + 2.4 * hash11(bHash * 7.3)));
            if (by0 + bh < H - 0.6) {
              addVerticalBladeSign(B, e, uPier, by0, bh, 0.66 + 0.16 * hash11(bHash * 3.1), bHash * 100.0 + bi * 13.7);
            }
          }
        }
      } else if (isFront && (style === ST.cbd_supertall || style === ST.office_glass || style === ST.office_grid || style === ST.hotel || style === ST.civic) && e.len >= 9.0 && k === longestEdge) {
        // Grand 3D cantilevered glass-and-steel entrance canopy (门头雨棚) — strictly street-grade & headroom verified!
        const cMid = e.len * 0.5;
        const cHalf = Math.min(3.6, e.len * 0.24);
        const cY = yStart + Math.min(gH - 0.6, 4.4);
        const cOut = slope >= 3.0 ? 1.65 : 2.15;
        const gBase = sampleOut(e, cMid, 0.70);
        const gTip = Math.max(gBase, sampleOut(e, cMid, cOut + 0.35));
        const cDrop = yStart - gBase;
        if (cDrop >= -0.35 && cDrop <= 1.0 && cY >= gTip + 2.6) {
          addWallBox(B, e, cMid - cHalf, cMid + cHalf, cY, cY + 0.16, -0.02, cOut, KIND.darkFrame, KIND.darkFrame, KIND.glass, KIND.soffit);
          addDiagonalStrut(B, e, cMid - cHalf * 0.72, cY + 1.50, cY + 0.14, cOut * 0.84, 0.06, KIND.steelBracket);
          addDiagonalStrut(B, e, cMid + cHalf * 0.72, cY + 1.50, cY + 0.14, cOut * 0.84, 0.06, KIND.steelBracket);
        }
      }

      // 6. Giant 3D Illuminated Commercial Facade LED Media Billboard (解放碑/观音桥商圈)
      if (style === ST.commercial_mall && isFront && e.len >= 12.0 && hTotal >= 12.0 && k === longestEdge) {
        const bwScreen = Math.min(e.len * 0.55, 16.0);
        const bhScreen = Math.min(hTotal - gH - 1.5, 8.5);
        if (bhScreen >= 3.2) {
          const su0 = (e.len - bwScreen) * 0.5;
          const sy0 = yStart + gH + 0.65;
          const bbD0 = pierD + 0.22;
          addWallBox(B, e, su0 - 0.20, su0 + bwScreen + 0.20, sy0 - 0.20, sy0 + bhScreen + 0.20, -0.02, bbD0, KIND.darkFrame, KIND.darkFrame, KIND.darkFrame, KIND.soffit);
          addWallBox(B, e, su0, su0 + bwScreen, sy0, sy0 + bhScreen, bbD0 + 0.06, bbD0 + 0.14, KIND.ledStrip, KIND.darkFrame, KIND.darkFrame, KIND.darkFrame,
            { uvLocal: true, aux0: seed + 17.3, aux1: bwScreen / bhScreen });
        }
      }
    }
  }

  // =========================================================================
  // PART B: UPPER FACADE 3D ARCHITECTURE (towerRing if setback, else outer)
  // =========================================================================
  const upperRing = towerRing || outer;
  const upperEf = towerRing ? null : ef;
  // Always start Part B strictly ABOVE Part A's podium (podiumH when > 0, else gH) so non-setback towers NEVER overlap podium piers/sills!
  const yUpperStart = yStart + (podiumH > 0 ? podiumH : gH);
  const yUpperTop = yStart + Math.min(hTotal, yTop + 0.1);
  if (yUpperTop - yUpperStart < 2.2) return;

  const upperFloors = Math.max(1, Math.floor((yUpperTop - yUpperStart + 0.3) / fH));
  const nUp = upperRing.length / 2;

  for (let k = 0; k < nUp; k++) {
    const f = upperEf ? upperEf[k] : 0;
    if (f & 2) continue;
    const e = makeEdgeFrame(upperRing, k);
    if (!e || e.len < 3.2) continue;
    B.e0 = e.len;
    B.f0 = f;

    const grid = computeBayGrid(e.len, style, seed, false);
    if (grid.nb < 1) continue;
    const isUpperFront = (f & 1) !== 0 || (!hasAnyStreetFlag && (k === longestEdge || k === secondEdge));

    // 0. Authentic vertical exterior PVC drainpipe (落水管) with mounting collars on residential/historic/generic corners!
    if ((isResiOld || style === ST.resi_modern || style === ST.historic_masonry) && highBudget && e.len >= 5.5 && k % 2 === 0) {
      const pipeU = hash11(seed + k * 4.3) > 0.5 ? 0.28 : (e.len - 0.28);
      const gPipe = sampleOut(e, pipeU, 0.25);
      const pipeBot = Math.max(yBot + 0.5, Math.min(yStart + 0.15, gPipe + 0.05));
      addDrainPipe(B, e, pipeU, pipeBot, Math.min(H - ph, yUpperStart + 32.0));
    }

    // 1. Full-height 3D Vertical Structural Fins / Deep Curtain-Wall Mullions + Horizontal Spandrel Fins!
    // Strict non-overlapping depth strata (>= 8cm separation between EVERY crossing plane -> ZERO Z-fighting!):
    //   CBD curtain wall: wall(0) < louver(0.14) / transom(0.16) < mid-mullion(0.25) < primary fin(0.35/0.43) < mech trim(0.44/0.52) < LED accent(0.52/0.60)
    const finTop = H - Math.max(ph * 0.45, 0.10);
    const finD = style === ST.cbd_supertall ? 0.43 : 0.35;
    const pilD = S.fins === 'quoin' ? 0.26 : 0.22;
    if (wantFins) {
      if (S.fins === 'curtain' || (balconyMask & BMASK.curtainFins)) {
        const finStep = grid.nb > 16 ? 2 : 1;
        const finW = style === ST.cbd_supertall ? 0.15 : 0.11;
        for (let ci = 0; ci <= grid.nb; ci += finStep) {
          const u = grid.margin + ci * grid.bw;
          const uL = Math.max(0.05, u - finW * 0.5), uR = Math.min(e.len - 0.05, u + finW * 0.5);
          if (uR - uL < 0.04) continue;
          const isAccent = wantCrownLed && (ci === 0 || ci === grid.nb || ci === Math.floor(grid.nb / 2));
          const fk = isAccent ? KIND.ledStrip : KIND.metal;
          addWallBox(B, e, uL, uR, yUpperStart + 0.06, finTop, -0.02, isAccent ? finD + 0.17 : finD, fk, KIND.metal, KIND.metal, -1);
          // Secondary mid-bay slim 3D aluminum mullion (0.25m -> 9cm proud of transoms & 10-18cm behind primary fins!)
          if (highBudget && finStep === 1 && ci < grid.nb && grid.bw >= 2.8) {
            const um = u + grid.bw * 0.5;
            addWallBox(B, e, um - 0.035, um + 0.035, yUpperStart + 0.06, finTop, -0.01, 0.25,
              KIND.darkFrame, KIND.darkFrame, -1, -1, { skipTop: true, skipBot: true });
          }
        }
        // Horizontal 3D curtain-wall spandrel transom fins on non-mechanical floors (0.16m -> 9cm behind mid-mullions, inset at corners!)
        const maxTransoms = Math.min(upperFloors, highBudget ? 16 : 8);
        for (let fi = 1; fi < maxTransoms; fi++) {
          if (hTotal >= 60 && fi % 12 === 0) continue; // mechanical floor uses its own full-depth trim bands!
          const yt = yUpperStart + fi * fH;
          if (yt > finTop - 0.5) break;
          addWallBox(B, e, 0.06, e.len - 0.06, yt - 0.06, yt + 0.06, -0.01, 0.16,
            KIND.metal, -1, KIND.metal, KIND.soffit, { skipSides: true });
        }
      } else if (S.fins === 'pilaster' || S.fins === 'quoin') {
        const pStep = grid.nb > 10 ? 2 : 1;
        const pW = S.fins === 'quoin' ? 0.36 : 0.28;
        for (let ci = 0; ci <= grid.nb; ci += pStep) {
          const u = grid.margin + ci * grid.bw;
          const uL = Math.max(0.05, u - pW * 0.5), uR = Math.min(e.len - 0.05, u + pW * 0.5);
          if (uR - uL < 0.06) continue;
          addWallBox(B, e, uL, uR, yUpperStart + 0.06, finTop, -0.02, pilD, KIND.trim, KIND.trim, KIND.trim, -1);
        }
      } else if (S.fins === 'concrete') {
        const pStep = Math.max(2, Math.round(grid.nb / 3));
        for (let ci = 0; ci <= grid.nb; ci += pStep) {
          const u = grid.margin + ci * grid.bw;
          const uL = Math.max(0.05, u - 0.14), uR = Math.min(e.len - 0.05, u + 0.14);
          if (uR - uL < 0.06) continue;
          addWallBox(B, e, uL, uR, yUpperStart + 0.06, finTop, -0.02, 0.26, KIND.trim, KIND.trim, KIND.trim, -1);
        }
      }
    }

    // 2. Stepped 3D Horizontal Cornices / Stringcourse Floor Ledges (腰线) & Overhanging Roof Crown Cornice!
    const baseVertD = (S.fins === 'curtain' || (balconyMask & BMASK.curtainFins)) ? finD
      : (wantFins ? (S.fins === 'concrete' ? 0.26 : pilD) : 0.22);
    if (wantCornices && S.ledgeStep > 0) {
      const step = S.ledgeStep;
      const ledgeD = baseVertD + ((style === ST.historic_masonry || style === ST.civic) ? 0.14 : (style === ST.bayu_vernacular ? 0.16 : 0.12));
      const ledgeH = (style === ST.historic_masonry) ? 0.26 : 0.18;
      const ledgeKind = style === ST.bayu_vernacular ? KIND.timber : (S.curtain ? KIND.metal : KIND.trim);
      const maxLedges = medBudget ? 12 : 6;
      let count = 0;
      for (let fi = step; fi < upperFloors && count < maxLedges; fi += step, count++) {
        const yl = yUpperStart + fi * fH;
        if (yl > H - ph - 0.8) break;
        if (S.curtain && hTotal >= 60 && fi % 12 === 0 && yl + fH < H - 4) {
          // Mechanical louver floor: deep trim bands strictly 9cm proud of primary fins; recessed louver handled cleanly by wall shader (ZERO coplanar plate Z-fighting in hm_f01!)
          const mTrimD = finD + 0.09;
          addWallBox(B, e, 0.06, e.len - 0.06, yl - 0.12, yl + 0.14, -0.02, mTrimD, KIND.metal, KIND.metal, KIND.metal, KIND.soffit);
          addWallBox(B, e, 0.06, e.len - 0.06, yl + fH - 0.12, yl + fH + 0.12, -0.02, mTrimD, KIND.metal, KIND.metal, KIND.metal, KIND.soffit);
        } else {
          addSteppedCornice(B, e, 0.04, e.len - 0.04, yl, ledgeH, ledgeD, ledgeKind, false, baseVertD + 0.05);
        }
      }
    }

    // Sculpted 2-tier overhanging Top Parapet Crown Cornice (strictly proud of vertical fins, zero overlap w/ LED strip!)
    if (ph >= 0.4) {
      const cD = style === ST.historic_masonry ? 0.54 : Math.max(0.36, baseVertD + 0.14);
      const cH = style === ST.historic_masonry ? 0.44 : 0.28;
      addSteppedCornice(B, e, 0.04, e.len - 0.04, H - cH * 0.55, cH, cD, KIND.trim, isHistoric && highBudget, baseVertD + 0.06);
      if (wantCrownLed) {
        const ledTop = H - cH - 0.12;
        addWallBox(B, e, 0.08, e.len - 0.08, ledTop - 0.24, ledTop, -0.01, baseVertD + 0.09, KIND.ledStrip, KIND.ledStrip, KIND.metal, KIND.soffit);
      }
    }

    // 3. Real 3D Balconies, Multi-Bar Open Railings, Glass Balustrades w/ Posts, Enclosed Sunrooms, Potted Plants & Laundry!
    if (wantBalcony && (medBudget || isUpperFront)) {
      const maxBalFloors = Math.min(upperFloors, highBudget ? (isUpperFront ? 16 : 10) : (medBudget ? 8 : 4));
      const bayStride = (grid.nb > 8 || (!isUpperFront && !highBudget)) ? 2 : 1;

      if (S.balcony === 'bayu') {
        const gFloors = Math.min(upperFloors, highBudget ? 3 : 2);
        const galD = 0.95 + 0.25 * hash11(seed + k * 3.1);
        for (let fi = 0; fi < gFloors; fi++) {
          const yFl = yUpperStart + fi * fH;
          if (yFl + 1.8 > H) break;
          // Non-overlapping Bayu timber depth ladder: carving(galD-0.06) < slab(galD) < posts(galD+0.07) < handrail(galD+0.13)!
          addWallBox(B, e, 0.15, e.len - 0.15, yFl - 0.18, yFl + 0.04, -0.03, galD, KIND.timber, KIND.timber, KIND.timber, KIND.soffit);
          addWallBox(B, e, 0.22, e.len - 0.22, yFl + 0.05, yFl + 0.93, galD - 0.13, galD - 0.06, KIND.bayuCarving, KIND.bayuCarving, KIND.timber, -1, { skipBack: false, kBack: KIND.bayuCarving });
          addWallBox(B, e, 0.16, e.len - 0.16, yFl + 0.94, yFl + 1.04, galD - 0.16, galD + 0.13, KIND.timber, KIND.timber, KIND.timber, KIND.soffit);
          const nPosts = Math.max(2, Math.min(5, grid.nb + 1));
          const postTop = Math.min(H - 0.1, yFl + fH - 0.20);
          for (let pi = 0; pi < nPosts; pi++) {
            const up = 0.24 + (e.len - 0.48) * (pi / (nPosts - 1));
            addWallBox(B, e, up - 0.08, up + 0.08, yFl + 0.045, postTop, galD - 0.14, galD + 0.07, KIND.timber, KIND.timber, -1, -1, { skipBack: false, kBack: KIND.timber });
            addDiagonalStrut(B, e, up, yFl - 0.95, yFl - 0.19, galD - 0.12, 0.11, KIND.timber);
          }
          if (highBudget && fi < 2) {
            addBalconyClutter(B, e, 0.3, Math.min(e.len - 0.3, 3.4), yFl, fH, galD, seed + k * 13 + fi * 29, true);
          }
        }
      } else {
        for (let ci = 0; ci < grid.nb; ci += bayStride) {
          const hb = hash11(ci * 1.13 + seed * 0.71 + (e.south ? 0.0 : 5.0));
          const u0 = grid.margin + ci * grid.bw;
          const u1 = u0 + grid.bw;
          const bU0 = u0 + 0.18, bU1 = u1 - 0.18;
          if (bU1 - bU0 < 1.3) continue;

          if (isBalconyBay(style, e.south, hb, subtype)) {
            const balD = style === ST.resi_modern ? 1.15 : (style === ST.resi_old_highrise ? 0.96 : 0.92);
            let topBalY = yUpperStart, nStack = 0;
            for (let fi = 0; fi < maxBalFloors; fi++) {
              const yFl = yUpperStart + fi * fH;
              if (yFl + 1.6 > H - ph) break;
              topBalY = yFl + fH; nStack++;
            }
            if (nStack === 0) continue;
            const stackTop = Math.min(H - ph - 0.08, topBalY);
            const wingW = style === ST.resi_modern ? 0.16 : (style === ST.resi_old_highrise ? 0.14 : 0.0);
            const inU0 = bU0 + wingW, inU1 = bU1 - wingW;

            // Wing walls sit 7cm proud of floor slabs; top cap & floor slabs span STRICTLY [inU0, inU1] -> ZERO wing/slab Z-fighting!
            if (style === ST.resi_modern) {
              addWallBox(B, e, bU0, inU0, yUpperStart, stackTop, -0.02, balD + 0.07, KIND.trim, KIND.trim, KIND.trim, KIND.soffit);
              addWallBox(B, e, inU1, bU1, yUpperStart, stackTop, -0.02, balD + 0.07, KIND.trim, KIND.trim, KIND.trim, KIND.soffit);
              addWallBox(B, e, inU0, inU1, stackTop - 0.20, stackTop, -0.02, balD, KIND.trim, -1, KIND.trim, KIND.soffit, { skipSides: true });
            } else if (style === ST.resi_old_highrise) {
              addWallBox(B, e, bU0, inU0, yUpperStart, stackTop, -0.02, balD + 0.07, KIND.trim, KIND.trim, KIND.trim, KIND.soffit);
              addWallBox(B, e, inU1, bU1, yUpperStart, stackTop, -0.02, balD + 0.07, KIND.trim, KIND.trim, KIND.trim, KIND.soffit);
            }

            for (let fi = 0; fi < nStack; fi++) {
              const yFl = yUpperStart + fi * fH;
              if (fi < 2 && sampleY && yFl - 0.20 < sampleOut(e, (bU0 + bU1) * 0.5, balD + 0.25) + 2.0) continue;
              const cellSeed = ci * 7.3 + fi * 13.1 + seed * 1.7 + k * 3.1;
              const cellH = hash11(cellSeed);
              const flanked = wingW > 0;

              // Projecting concrete balcony floor slab strictly between wing walls (when flanked)
              addWallBox(B, e, inU0, inU1, yFl - 0.18, yFl + 0.04, -0.02, balD,
                KIND.trim, flanked ? -1 : KIND.trim, KIND.trim, KIND.soffit, { skipSides: flanked });

              if (style === ST.resi_modern) {
                // Upstand curb recessed 7cm behind slab lip; glass at balD-0.12..-0.08; steel posts proud at balD-0.06..-0.01!
                addWallBox(B, e, inU0, inU1, yFl + 0.045, yFl + 0.20, balD - 0.16, balD - 0.07, KIND.trim, -1, KIND.trim, -1, { skipSides: true, skipBot: true });
                addWallBox(B, e, inU0, inU1, yFl + 0.205, yFl + 1.055, balD - 0.12, balD - 0.08,
                  KIND.glass, -1, -1, -1, { skipBack: false, kBack: KIND.glass, skipTop: true, skipBot: true, skipSides: true });
                addWallBox(B, e, inU0, inU1, yFl + 1.06, yFl + 1.13, balD - 0.14, balD - 0.05,
                  KIND.railMetal, -1, KIND.railMetal, KIND.soffit, { skipSides: true });
                if (fi < 8 && highBudget) {
                  const midU = (inU0 + inU1) * 0.5;
                  addWallBox(B, e, midU - 0.025, midU + 0.025, yFl + 0.205, yFl + 1.055, balD - 0.06, balD - 0.01,
                    KIND.steelBracket, KIND.steelBracket, -1, -1, { skipTop: true, skipBot: true });
                  addBalconyClutter(B, e, inU0, inU1, yFl, fH, balD, cellSeed, true);
                }
              } else if (style === ST.resi_old_highrise) {
                const enclosed = cellH > 0.42;
                addWallBox(B, e, inU0, inU1, yFl + 0.045, yFl + 0.86, balD - 0.16, balD - 0.07,
                  KIND.trim, -1, KIND.trim, -1, { skipSides: true, skipBot: true });
                if (enclosed) {
                  // Enclosed glass recessed at balD-0.15..-0.10, central vertical mullion 9cm proud at balD-0.08..-0.01!
                  addWallBox(B, e, inU0, inU1, yFl + 0.865, yFl + fH - 0.20, balD - 0.15, balD - 0.10,
                    KIND.glass, -1, -1, -1, { skipTop: true, skipBot: true, skipSides: true });
                  addWallBox(B, e, (inU0 + inU1) * 0.5 - 0.04, (inU0 + inU1) * 0.5 + 0.04, yFl + 0.865, yFl + fH - 0.20, balD - 0.08, balD - 0.01,
                    KIND.darkFrame, KIND.darkFrame, -1, -1, { skipTop: true, skipBot: true });
                } else {
                  addWallBox(B, e, inU0, inU1, yFl + 1.08, yFl + 1.15, balD - 0.12, balD - 0.05,
                    KIND.railMetal, -1, KIND.railMetal, KIND.soffit, { skipSides: true });
                  if (fi < 7 && highBudget) {
                    const nP = 3;
                    for (let pi = 0; pi < nP; pi++) {
                      const pu = inU0 + 0.22 + (inU1 - inU0 - 0.44) * (pi / (nP - 1));
                      addWallBox(B, e, pu - 0.018, pu + 0.018, yFl + 0.865, yFl + 1.075, balD - 0.10, balD - 0.06,
                        KIND.railMetal, KIND.railMetal, -1, -1, { skipTop: true, skipBot: true });
                    }
                    addBalconyClutter(B, e, inU0, inU1, yFl, fH, balD, cellSeed, true);
                  }
                }
              } else {
                // Old Chongqing walk-up (老小区): low curb recessed behind slab, side return handrails stopping strictly before front rail!
                const lowWallH = cellH > 0.5 ? 0.58 : 0.26;
                addWallBox(B, e, bU0 + 0.02, bU1 - 0.02, yFl + 0.045, yFl + lowWallH, balD - 0.15, balD - 0.06, KIND.trim, KIND.trim, KIND.trim, -1, { skipBot: true });
                addWallBox(B, e, bU0, bU1, yFl + 1.04, yFl + 1.11, balD - 0.10, balD - 0.03, KIND.railMetal, -1, KIND.railMetal, KIND.soffit, { skipSides: true });
                addWallBox(B, e, bU0, bU0 + 0.05, yFl + 1.04, yFl + 1.11, 0.0, balD - 0.11, -1, KIND.railMetal, KIND.railMetal, KIND.soffit);
                addWallBox(B, e, bU1 - 0.05, bU1, yFl + 1.04, yFl + 1.11, 0.0, balD - 0.11, -1, KIND.railMetal, KIND.railMetal, KIND.soffit);
                if (fi < 7 && highBudget) {
                  const nP = Math.min(6, Math.max(3, Math.round((bU1 - bU0) / 0.48)));
                  for (let pi = 0; pi < nP; pi++) {
                    const pu = bU0 + 0.08 + (bU1 - bU0 - 0.16) * (pi / (nP - 1));
                    addWallBox(B, e, pu - 0.015, pu + 0.015, yFl + lowWallH + 0.005, yFl + 1.035, balD - 0.085, balD - 0.045,
                      KIND.railMetal, KIND.railMetal, -1, -1, { skipTop: true, skipBot: true });
                  }
                  addBalconyClutter(B, e, bU0 + 0.08, bU1 - 0.08, yFl, fH, balD, cellSeed, true);
                }
                if (cellH > 0.60 && highBudget) {
                  addSlopedAwning(B, e, bU0, bU1, yFl + fH - 0.14, yFl + fH - 0.40, balD + 0.18, 0.08, KIND.roofMetal, cellH * 30, false);
                }
              }
            }
          } else if (style === ST.resi_modern && highBudget && hb > 0.16 && hb <= 0.32 && e.south) {
            // Contemporary Chongqing projecting Bay Window (飘窗) — mullion 10cm proud of glass (zero 6-21 Z-fighting!)
            const maxBayF = Math.min(upperFloors, 12);
            const wU0 = u0 + grid.bw * 0.18, wU1 = u1 - grid.bw * 0.18;
            for (let fi = 0; fi < maxBayF; fi++) {
              const yFl = yUpperStart + fi * fH;
              if (yFl + fH * 0.85 > H - ph) break;
              const ySill = yFl + fH * 0.24, yHead = yFl + fH * 0.84;
              addWallBox(B, e, wU0, wU1, ySill - 0.14, ySill, -0.02, 0.56, KIND.trim, KIND.trim, KIND.trim, KIND.soffit);
              addWallBox(B, e, wU0, wU1, yHead, yHead + 0.14, -0.02, 0.56, KIND.trim, KIND.trim, KIND.trim, KIND.soffit);
              addWallBox(B, e, wU0, wU1, ySill + 0.005, yHead - 0.005, 0.38, 0.44, KIND.glass, KIND.glass, -1, -1, { skipTop: true, skipBot: true });
              addWallBox(B, e, (wU0 + wU1) * 0.5 - 0.03, (wU0 + wU1) * 0.5 + 0.03, ySill + 0.005, yHead - 0.005, 0.46, 0.54,
                KIND.darkFrame, KIND.darkFrame, -1, -1, { skipTop: true, skipBot: true });
            }
          }
        }
      }
    }

    // 4. TRUE 3D Recessed Window Frames, Mullions, Security Cages (防盗网), & Multi-Part AC Units (空调外机)!
    if ((wantSunshade || wantAC) && !S.curtain) {
      const sillFrac = style === ST.historic_masonry ? 0.22 : (style === ST.commercial_mall ? 0.34 : 0.28);
      const winFracH = style === ST.historic_masonry ? 0.58 : (style === ST.commercial_mall ? 0.42 : 0.52);
      const winFracW = style === ST.historic_masonry ? 0.44 : (style === ST.office_grid || style === ST.hotel ? 0.68 : 0.54);
      const sillD = 0.14; // strictly 8cm behind pilasters (0.22) so continuous sills NEVER Z-fight pilasters!
      const browD = (style === ST.campus || style === ST.resi_old_highrise || style === ST.resi_walkup) ? 0.36 : 0.32;
      const trimK = (style === ST.bayu_vernacular || style === ST.temple) ? KIND.timber : KIND.trim;

      let hasAnyBalOnEdge = false;
      if (wantBalcony && S.balcony !== 'bayu') {
        for (let ci = 0; ci < grid.nb; ci++) {
          const hb = hash11(ci * 1.13 + seed * 0.71 + (e.south ? 0.0 : 5.0));
          if (isBalconyBay(style, e.south, hb, subtype)) { hasAnyBalOnEdge = true; break; }
        }
      }

      // Upper floors (above detailed macro band): fast continuous 3D sill (0.14m) & eyebrow ledges (0.32m) + bay pilasters (0.22m)!
      const maxFullFrameF = Math.min(upperFloors, isUpperFront ? (highBudget ? 5 : 4) : (highBudget ? 3 : 2));
      const maxSillF = Math.min(upperFloors, isUpperFront ? (medBudget ? 10 : 6) : 5);

      if (wantSunshade && !hasAnyBalOnEdge && S.balcony !== 'bayu') {
        for (let fi = maxFullFrameF; fi < maxSillF; fi++) {
          const yFl = yUpperStart + fi * fH;
          if (yFl + fH * 0.88 > H - ph) break;
          const ySill = yFl + fH * sillFrac;
          const yHead = Math.min(yFl + fH - 0.20, ySill + fH * winFracH);
          addWallBox(B, e, 0.04, e.len - 0.04, ySill - 0.09, ySill, -0.02, sillD, trimK, trimK, trimK, KIND.soffit);
          addWallBox(B, e, 0.04, e.len - 0.04, yHead, yHead + 0.12, -0.02, browD, trimK, trimK, trimK, KIND.soffit);
        }
        if (!wantFins && grid.nb >= 2) {
          const pStep = grid.nb > 10 ? 2 : 1;
          for (let ci = 0; ci <= grid.nb; ci += pStep) {
            const u = grid.margin + ci * grid.bw;
            const uL = Math.max(0.05, u - 0.13), uR = Math.min(e.len - 0.05, u + 0.13);
            if (uR - uL < 0.06) continue;
            addWallBox(B, e, uL, uR, yUpperStart + 0.06, finTop, -0.02, 0.22, trimK, trimK, trimK, -1);
          }
        }
      }

      // Macro-close floors (1F..5F): FULL 3D Perimeter Window Assemblies (jambs + beveled sill + mullions + eyebrow + security cages) + Multi-Part AC Units!
      const maxBaysMicro = Math.min(grid.nb, isUpperFront ? 10 : 6);
      const maxACF = Math.min(upperFloors, isUpperFront ? (highBudget ? 6 : 3) : 3);
      for (let ci = 0; ci < maxBaysMicro; ci++) {
        const hb = hash11(ci * 1.13 + seed * 0.71 + (e.south ? 0.0 : 5.0));
        if (wantBalcony && isBalconyBay(style, e.south, hb, subtype)) continue;
        if (hb < 0.14 && (style === ST.resi_old_highrise || style === ST.resi_walkup)) continue;

        const u0 = grid.margin + ci * grid.bw;
        const wW = grid.bw * winFracW;
        const wu0 = u0 + (grid.bw - wW) * 0.5, wu1 = wu0 + wW;

        const limF = Math.max(maxFullFrameF, maxACF);
        for (let fi = 0; fi < limF; fi++) {
          const yFl = yUpperStart + fi * fH;
          if (yFl + fH * 0.88 > H - ph) break;
          const ySill = yFl + fH * sillFrac;
          const yHead = Math.min(yFl + fH - 0.22, ySill + fH * winFracH);

          if (wantSunshade && fi < maxFullFrameF) {
            const wantCage = highBudget && fi < 4 && (
              (isResiOld && hash11(ci * 11.1 + fi * 19.3 + seed + k) < 0.42) ||
              (style === ST.resi_modern && fi < 2 && hash11(ci * 11.1 + fi * 19.3 + seed + k) < 0.20)
            );
            add3DWindowAssembly(B, e, wu0, wu1, ySill, yHead, {
              trimKind: trimK, sillD, browD, jambD: 0.14, jambW: 0.09, mullions: highBudget || isUpperFront, cage: wantCage,
            });
          } else if (wantSunshade && hasAnyBalOnEdge && fi < maxSillF) {
            addWallBox(B, e, wu0 - 0.10, wu1 + 0.10, ySill - 0.10, ySill, -0.02, sillD, trimK, trimK, trimK, KIND.soffit);
            addWallBox(B, e, wu0 - 0.12, wu1 + 0.12, yHead, yHead + 0.12, -0.02, browD, trimK, trimK, trimK, KIND.soffit);
          }

          // Multi-part 3D AC Outdoor Unit (L-brackets + fan casing + refrigerant wall conduit!)
          if (wantAC && fi < maxACF && (isUpperFront || highBudget) && hash11(ci * 17.3 + fi * 29.1 + seed * 3.7 + k) < S.acDensity) {
            const acU = Math.min(u0 + grid.bw - 0.86, Math.max(u0 + 0.08, wu1 + 0.06));
            const acY = Math.max(yFl + 0.22, ySill - 0.54);
            if (acU + 0.85 < e.len - 0.06 && (!sampleY || fi >= 2 || acY >= sampleOut(e, acU + 0.4, 0.55) + 1.8)) {
              addMultiPartAC(B, e, acU, acY, ci * 5.3 + fi * 11.7 + seed);
            }
          }
        }
      }
    }
  }
}
