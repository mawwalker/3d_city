// Structural engineering modelling kit for Chongqing 3D bridges, monorail viaducts, and cableways.
// Builds crisp, authentic 3D steelwork, chamfered concrete pylons, double-deck Warren trusses,
// arched box-truss ribs, variable-depth haunched girders, straddle-beam monorail trackways,
// walkable highway/pedestrian decks with markings & lamps, catenary cables, and cliff-anchored abutments.
//
// Coordinate frame: Three.js right-handed world (x = east, y = up, z = south, metres).
// All builders emit geometry into a Kit instance (compatible with heroes/kit.js & kitMaterial).

import * as THREE from 'three';
import { MAT } from './kit.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Linear-RGB PBR Material Palette for Chongqing Bridges & Transit Infrastructure
// (Note: negative emissive = lit at night only via heroMaterial uNight.y)
// t = procedural MAT.* micro-detail surface type from heroes/kit.js, p = param
// ---------------------------------------------------------------------------
export const PAL = {
  // Concrete & stone (wired to Phase 3 1024px MAT.CONCRETE formwork seams/tie-rod dimples & MAT.STONE!)
  concLight:    { c: [0.58, 0.57, 0.54], r: 0.78, m: 0.0, e: 0.0,   f: 0.45, t: MAT.CONCRETE, p: 2.2 },
  concPylon:    { c: [0.66, 0.64, 0.59], r: 0.74, m: 0.0, e: -0.40, f: 0.48, t: MAT.CONCRETE, p: 2.8 }, // Shuttle pylons (climbing formwork panels + warm night flood)
  concPier:     { c: [0.46, 0.45, 0.42], r: 0.86, m: 0.0, e: -0.10, f: 0.40, t: MAT.CONCRETE, p: 2.4 },
  concWet:      { c: [0.28, 0.27, 0.25], r: 0.48, m: 0.0, e: 0.0,   f: 0.58, t: MAT.STONE,    p: 0.55 }, // Waterline / splash zone
  concBarrier:  { c: [0.62, 0.61, 0.58], r: 0.80, m: 0.0, e: -0.04, f: 0.42, t: MAT.CONCRETE, p: 1.6 },
  concViaduct:  { c: [0.54, 0.53, 0.50], r: 0.80, m: 0.0, e: -0.06, f: 0.44, t: MAT.CONCRETE, p: 2.6 },
  sandstone:    { c: [0.44, 0.39, 0.31], r: 0.88, m: 0.0, e: 0.0,   f: 0.36, t: MAT.STONE,    p: 0.52 }, // Chongqing cliff retaining wall (堡坎石墙)

  // Signature Chongqing bridge paints & structural steel (wired to Phase 3 1024px MAT.METAL!)
  cqRed:        { c: [0.60, 0.075, 0.055], r: 0.42, m: 0.28, e: -0.38, f: 0.56, t: MAT.METAL, p: 2.4 }, // Chaotianmen / Qiansimen / Dongshuimen crimson red
  cqRedDark:    { c: [0.38, 0.048, 0.038], r: 0.52, m: 0.25, e: -0.16, f: 0.50, t: MAT.METAL, p: 2.0 }, // Shaded gussets / inner chord faces
  cqCoral:      { c: [0.68, 0.145, 0.055], r: 0.40, m: 0.24, e: -0.40, f: 0.56, t: MAT.METAL, p: 2.4 }, // Caiyuanba vibrant orange-red
  steelSilver:  { c: [0.64, 0.66, 0.68],   r: 0.34, m: 0.74, e: -0.16, f: 0.70, t: MAT.METAL, p: 1.6 },
  steelDark:    { c: [0.16, 0.17, 0.19],   r: 0.46, m: 0.76, e: 0.0,   f: 0.66, t: MAT.METAL, p: 1.4 },
  steelRail:    { c: [0.74, 0.75, 0.77],   r: 0.20, m: 0.94, e: 0.0,   f: 0.88, t: MAT.METAL, p: 2.0 },
  cableWhite:   { c: [0.80, 0.80, 0.78],   r: 0.40, m: 0.15, e: -0.60, f: 0.62, t: MAT.PLAIN, p: 0 },   // Stay cables (smooth HDPE sheath, subtly lit at night)
  cableSteel:   { c: [0.30, 0.31, 0.34],   r: 0.36, m: 0.82, e: -0.15, f: 0.72, t: MAT.METAL, p: 0.9 }, // Cableway / suspender steel rope

  // Roadway & markings
  asphalt:      { c: [0.058, 0.061, 0.068], r: 0.86, m: 0.0, e: 0.0,   f: 0.44, t: MAT.ASPHALT, p: 0 },
  asphaltWear:  { c: [0.036, 0.039, 0.044], r: 0.54, m: 0.0, e: 0.0,   f: 0.56, t: MAT.ASPHALT, p: 0 }, // Polished tire-wear wheel tracks
  sidewalk:     { c: [0.46, 0.45, 0.42],    r: 0.78, m: 0.0, e: 0.0,   f: 0.44, t: MAT.GRANITE, p: 1.0 },
  laneWhite:    { c: [0.88, 0.88, 0.85],    r: 0.62, m: 0.0, e: -0.06, f: 0.48, t: MAT.PLAIN,   p: 0 },
  laneYellow:   { c: [0.92, 0.68, 0.05],    r: 0.60, m: 0.0, e: -0.08, f: 0.48, t: MAT.PLAIN,   p: 0 },
  sleeper:      { c: [0.36, 0.35, 0.33],    r: 0.88, m: 0.0, e: 0.0,   f: 0.38, t: MAT.CONCRETE, p: 0.8 },
  ballast:      { c: [0.20, 0.19, 0.18],    r: 0.92, m: 0.0, e: 0.0,   f: 0.35, t: MAT.ASPHALT, p: 0 },
  foliageDeep:  { c: [0.09, 0.22, 0.07],    r: 0.78, m: 0.0, e: 0.0,   f: 0.32, t: MAT.FOLIAGE, p: 0 },
  foliageMid:   { c: [0.15, 0.31, 0.09],    r: 0.75, m: 0.0, e: 0.0,   f: 0.34, t: MAT.FOLIAGE, p: 0 },
  foliageLight: { c: [0.22, 0.38, 0.12],    r: 0.72, m: 0.0, e: 0.0,   f: 0.36, t: MAT.FOLIAGE, p: 0 },

  // Architectural building / station materials (wired to Phase 3 MAT.MOSAIC & MAT.BRICK!)
  creamWall:    { c: [0.76, 0.72, 0.64], r: 0.58, m: 0.0,  e: 0.0,   f: 0.50, t: MAT.MOSAIC,  p: 0.24 }, // 1990s Chongqing ceramic mosaic tile facade
  mosaicCoral:  { c: [0.58, 0.24, 0.17], r: 0.54, m: 0.0,  e: 0.0,   f: 0.52, t: MAT.MOSAIC,  p: 0.22 }, // Terracotta glazed ceramic tile pilasters
  ochreTile:    { c: [0.66, 0.53, 0.40], r: 0.70, m: 0.0,  e: 0.0,   f: 0.46, t: MAT.BRICK,   p: 0 },
  coralAccent:  { c: [0.58, 0.24, 0.17], r: 0.66, m: 0.0,  e: 0.0,   f: 0.48, t: MAT.PLAIN,   p: 0 },
  graniteWarm:  { c: [0.56, 0.52, 0.46], r: 0.68, m: 0.0,  e: 0.0,   f: 0.48, t: MAT.GRANITE, p: 1.2 },
  louverMetal:  { c: [0.42, 0.44, 0.46], r: 0.42, m: 0.68, e: 0.0,   f: 0.62, t: MAT.LOUVER,  p: 0.18 },
  timberWarm:   { c: [0.24, 0.10, 0.06], r: 0.58, m: 0.0,  e: 0.0,   f: 0.46, t: MAT.TIMBER,  p: 0 },

  // Architectural night lighting & beacons
  lampWarm:     { c: [1.00, 0.84, 0.52], r: 0.20, m: 0.0, e: -16.0, f: 0.80, t: MAT.LANTERN, p: 0 },
  ledGold:      { c: [1.00, 0.72, 0.24], r: 0.25, m: 0.0, e: -5.5,  f: 0.70, t: MAT.LANTERN, p: 0 },
  ledRed:       { c: [1.00, 0.18, 0.10], r: 0.25, m: 0.0, e: -6.5,  f: 0.70, t: MAT.LANTERN, p: 0 },
  ledGreen:     { c: [0.14, 0.82, 0.34], r: 0.25, m: 0.0, e: -5.5,  f: 0.70, t: MAT.LANTERN, p: 0 },
  ledCyan:      { c: [0.30, 0.82, 1.00], r: 0.25, m: 0.0, e: -4.5,  f: 0.70, t: MAT.LANTERN, p: 0 },
  ledWhite:     { c: [0.98, 0.96, 0.90], r: 0.22, m: 0.0, e: -9.0,  f: 0.75, t: MAT.PLAIN,   p: 0 },
  beaconRed:    { c: [1.00, 0.08, 0.04], r: 0.20, m: 0.0, e: -15.0, f: 0.80, t: MAT.PLAIN,   p: 0 },
  glassDark:    { c: [0.05, 0.08, 0.11], r: 0.08, m: 0.08, e: 0.0,  f: 0.92, t: MAT.GLASS,   p: 2.4 },
  glassPlain:   { c: [0.04, 0.06, 0.09], r: 0.07, m: 0.10, e: -0.4, f: 0.94, t: MAT.PLAIN,   p: 0 },
  glassLitWarm: { c: [0.96, 0.82, 0.54], r: 0.12, m: 0.0,  e: -4.2, f: 0.86, t: MAT.PLAIN,   p: 0 },
};

/** Apply a palette entry (or custom override) to a HeroKit instance. */
export function useMat(K, p, nightOverride = null) {
  const e = nightOverride !== null ? nightOverride : p.e;
  K.color(p.c[0], p.c[1], p.c[2]).material(p.r, p.m, e, p.f ?? 0.5);
  if (typeof K.surface === 'function') K.surface(p.t ?? MAT.PLAIN, p.p ?? 0);
  return K;
}

// ---------------------------------------------------------------------------
// 3D Vector & Frame Math
// ---------------------------------------------------------------------------
export const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vLerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vLen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vNorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Compute right-handed orthogonal frame { p, T, R, U } with world-up stabilization (R = T x upHint). */
export function makeFrame(p, tangent, upHint = [0, 1, 0]) {
  const T = vNorm(tangent);
  let h = upHint;
  if (Math.abs(vDot(T, h)) > 0.98) h = [1, 0, 0];
  const R = vNorm(vCross(T, h));
  const U = vCross(R, T);
  return { p, T, R, U };
}

/** Exact sag curve between y0 and y1 with mid-span sag > 0 (catenary-matched). */
export function catenaryY(t, y0, y1, sag) {
  // Smooth cosh catenary profile normalized so f(0)=0, f(1)=0, f(0.5)=-sag
  const u = (t - 0.5) * 2;
  const k = 1.65;
  const c0 = Math.cosh(k);
  const f = (Math.cosh(k * u) - c0) / (1 - c0); // 0 at ends, 1 at center
  return y0 + (y1 - y0) * t - sag * f;
}

// ---------------------------------------------------------------------------
// Arc-length Parameterized 3D Spline (Catmull-Rom or Dense Polyline)
// ---------------------------------------------------------------------------
export class Spline3D {
  /** pts: [[x,y,z], ...], subdivisions per control span (1 = polyline, >1 = centripetal Catmull-Rom). */
  constructor(pts, subPerSpan = 8) {
    this.ctrl = pts.map((p) => [p[0], p[1], p[2]]);
    this.samples = [];
    const n = this.ctrl.length;
    if (n < 2) {
      this.samples = this.ctrl.slice();
      this.cum = new Float32Array([0]);
      this.length = 0;
      return;
    }
    if (subPerSpan <= 1 || n === 2) {
      this.samples = this.ctrl.slice();
    } else {
      for (let i = 0; i < n - 1; i++) {
        const p0 = this.ctrl[Math.max(0, i - 1)];
        const p1 = this.ctrl[i];
        const p2 = this.ctrl[i + 1];
        const p3 = this.ctrl[Math.min(n - 1, i + 2)];
        const m = subPerSpan;
        for (let k = 0; k < m; k++) {
          const t = k / m;
          this.samples.push(catmullRom(p0, p1, p2, p3, t));
        }
      }
      this.samples.push(this.ctrl[n - 1].slice());
    }
    const ns = this.samples.length;
    this.cum = new Float32Array(ns);
    for (let i = 1; i < ns; i++) {
      this.cum[i] = this.cum[i - 1] + vLen(vSub(this.samples[i], this.samples[i - 1]));
    }
    this.length = this.cum[ns - 1];
  }

  /** Sample position & stabilized frame at arc distance s in [0, length]. */
  sampleAt(s, upHint = [0, 1, 0]) {
    const ns = this.samples.length;
    if (ns < 2 || this.length < 1e-6) return makeFrame(this.samples[0] || [0, 0, 0], [1, 0, 0], upHint);
    const sc = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = ns - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= sc) lo = mid; else hi = mid - 1;
    }
    const seg = this.cum[lo + 1] - this.cum[lo] || 1e-6;
    const t = (sc - this.cum[lo]) / seg;
    const p = vLerp(this.samples[lo], this.samples[lo + 1], t);
    // Smooth tangent across neighbouring sample points
    const prev = this.samples[Math.max(0, lo - 1)];
    const next = this.samples[Math.min(ns - 1, lo + 2)];
    const a = this.samples[lo], b = this.samples[lo + 1];
    const t0 = vNorm(vSub(b, prev));
    const t1 = vNorm(vSub(next, a));
    const tan = vLerp(t0, t1, t);
    return makeFrame(p, vLen(tan) > 1e-4 ? tan : vSub(b, a), upHint);
  }

  /** Uniformly sample N+1 frames from s0 to s1. */
  framesRange(s0, s1, nSegs, upHint = [0, 1, 0]) {
    const out = [];
    for (let i = 0; i <= nSegs; i++) {
      const s = s0 + (s1 - s0) * (i / nSegs);
      out.push(this.sampleAt(s, upHint));
    }
    return out;
  }
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = 0.5 * (
      (2 * p1[k]) +
      (-p0[k] + p2[k]) * t +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
      (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core Swept & Structural Steel Primitives (verified outward CCW winding)
// ---------------------------------------------------------------------------

/**
 * Sweep a closed 2D cross-section polygon along a sequence of 3D frames.
 * frames: [{ p, T, R, U }, ...]
 * profileFn: either array [[r, u], ...] (CCW in R-U plane) or (i, t) => [[r, u], ...]
 * Every quad has verified outward normal (T x edgeDir).
 */
export function sweepProfile(K, frames, profileOrFn, caps = true) {
  const n = frames.length;
  if (n < 2) return K;
  const getRing = (i) => {
    const f = frames[i];
    const prof = typeof profileOrFn === 'function' ? profileOrFn(i, i / (n - 1)) : profileOrFn;
    return prof.map(([r, u]) => [
      f.p[0] + f.R[0] * r + f.U[0] * u,
      f.p[1] + f.R[1] * r + f.U[1] * u,
      f.p[2] + f.R[2] * r + f.U[2] * u,
    ]);
  };
  const rings = [];
  for (let i = 0; i < n; i++) rings.push(getRing(i));
  const m = rings[0].length;
  // Side faces
  for (let i = 0; i < n - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      K.quad(A[k], B[k], B[j], A[j]);
    }
  }
  // Convex fan caps
  if (caps && m >= 3) {
    const r0 = rings[0], r1 = rings[n - 1];
    const hasTri = typeof K.tri === 'function';
    for (let k = 1; k < m - 1; k++) {
      // Start cap faces -T: (p0, pk, pk+1)
      if (hasTri) K.tri(r0[0], r0[k], r0[k + 1]);
      else K.quad(r0[0], r0[k], r0[k + 1], r0[k + 1]);
      // End cap faces +T: (p0, pk+1, pk)
      if (hasTri) K.tri(r1[0], r1[k + 1], r1[k]);
      else K.quad(r1[0], r1[k + 1], r1[k], r1[k]);
    }
  }
  return K;
}

/** Generate a CCW chamfered rectangle profile in (R, U) plane: width w, height h, chamfer c. */
export function chamferRect(w, h, c = 0, rOff = 0, uOff = 0) {
  const hw = w * 0.5, hh = h * 0.5;
  if (c <= 0.001) {
    return [
      [rOff - hw, uOff - hh], [rOff + hw, uOff - hh],
      [rOff + hw, uOff + hh], [rOff - hw, uOff + hh],
    ];
  }
  const ch = Math.min(c, hw * 0.45, hh * 0.45);
  return [
    [rOff - hw + ch, uOff - hh], [rOff + hw - ch, uOff - hh],
    [rOff + hw, uOff - hh + ch], [rOff + hw, uOff + hh - ch],
    [rOff + hw - ch, uOff + hh], [rOff - hw + ch, uOff + hh],
    [rOff - hw, uOff + hh - ch], [rOff - hw, uOff - hh + ch],
  ];
}

/** Generate a CCW trapezoidal / winged concrete box-girder profile (top at u = 0, depth down to -h). */
export function boxGirderProfile(topW, botW, depth, wingT = 0.45) {
  const ht = topW * 0.5, hb = botW * 0.5;
  const hw = Math.max(hb + 0.5, ht * 0.72);
  return [
    [-hb, -depth], [hb, -depth],
    [hw, -wingT], [ht, -wingT * 0.65],
    [ht, 0], [-ht, 0],
    [-ht, -wingT * 0.65], [-hw, -wingT],
  ];
}

/**
 * Generate a CCW cutwater river pier cross-section in (R, U) plane for vertical sweep T=(0,1,0), upHint=(1,0,0):
 * R = across bridge (±Z, upstream/downstream river current -> pointed cutwater prows!)
 * U = along bridge (±X, pier thickness)
 */
export function cutwaterProfile(alongW, acrossW, noseLen = 2.4) {
  const hx = alongW * 0.5, hz = acrossW * 0.5;
  const nl = Math.min(noseLen, hz * 0.45);
  return [
    [-hz, 0],
    [-hz + nl, -hx],
    [hz - nl, -hx],
    [hz, 0],
    [hz - nl, hx],
    [-hz + nl, hx],
  ];
}

/**
 * Oriented structural steel rectangular box beam from point A to point B.
 * Width w along R (cross), height h along U (perpendicular up).
 */
export function steelBeam(K, A, B, w, h = w, upHint = [0, 1, 0], caps = true, chamfer = 0) {
  const d = vSub(B, A);
  if (vLen(d) < 1e-4) return K;
  const fA = makeFrame(A, d, upHint);
  const fB = { p: B, T: fA.T, R: fA.R, U: fA.U };
  return sweepProfile(K, [fA, fB], chamferRect(w, h, chamfer), caps);
}

/**
 * Detailed structural I-beam / H-beam between A and B (two distinct flanges + recessed web).
 */
export function steelIBeam(K, A, B, depth, flangeW, webT = 0.16, flangeT = 0.18, upHint = [0, 1, 0]) {
  const d = vSub(B, A);
  if (vLen(d) < 1e-4) return K;
  const fA = makeFrame(A, d, upHint);
  const fB = { p: B, T: fA.T, R: fA.R, U: fA.U };
  const hd = depth * 0.5;
  // Web
  sweepProfile(K, [fA, fB], chamferRect(webT, depth - flangeT * 2, 0), false);
  // Top & bottom flanges
  sweepProfile(K, [fA, fB], chamferRect(flangeW, flangeT, 0, 0, hd - flangeT * 0.5), true);
  sweepProfile(K, [fA, fB], chamferRect(flangeW, flangeT, 0, 0, -hd + flangeT * 0.5), true);
  return K;
}

/**
 * Tensioned stay cable or sagging catenary cable from A to B, with optional cylindrical anchor sockets.
 */
export function stayCable(K, A, B, r = 0.15, { sides = 6, sag = 0, segs = 1, anchorLen = 0, anchorR = r * 2.2, anchorMat = PAL.steelDark } = {}) {
  const n = sag > 0.01 ? Math.max(4, segs) : 1;
  let prev = A;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = [
      A[0] + (B[0] - A[0]) * t,
      sag > 0.01 ? catenaryY(t, A[1], B[1], sag) : A[1] + (B[1] - A[1]) * t,
      A[2] + (B[2] - A[2]) * t,
    ];
    K.tube(prev, p, r, r, sides, false);
    prev = p;
  }
  if (anchorLen > 0) {
    const dir = vNorm(vSub(B, A));
    const saveCol = K.col ? [...K.col] : null;
    const saveMat = K.mat ? [...K.mat] : null;
    useMat(K, anchorMat);
    K.tube(A, vAdd(A, vScale(dir, anchorLen)), anchorR, anchorR * 0.82, Math.max(6, sides), true);
    K.tube(B, vSub(B, vScale(dir, anchorLen)), anchorR, anchorR * 0.82, Math.max(6, sides), true);
    if (saveCol && saveMat) K.color(...saveCol).material(...saveMat);
  }
  return K;
}

/** Bolted steel gusset node assembly (main plate + upper/lower flange splice plates + bolt studs). */
export function gussetNode(K, p, sx, sy, sz) {
  K.box(p[0], p[1], p[2], sx, sy, sz);
  // Crisp outer splice flange ribs catching macro highlights & shadows
  K.box(p[0], p[1] + sy * 0.48, p[2], sx * 1.08, 0.14, sz * 1.12);
  K.box(p[0], p[1] - sy * 0.48, p[2], sx * 1.08, 0.14, sz * 1.12);
  return K;
}

/**
 * Macro-detailed stay-cable deck anchorage & hydraulic vibration damper assembly:
 * - Stepped concrete anchor pedestal block integrated into the raised median barrier
 * - Bolted steel base flange plate with 6 raised anchor bolt heads seated flush on median crown
 * - Dark steel guide pipe plunging -1.5m solidly into the deck slab (zero floating!)
 * - Stepped cylindrical viscous vibration damper collar with twin clamp bands & safety stripe
 * - Tapered weather-boot cone transitioning cleanly onto the white HDPE stay-cable sheath
 */
export function emitCableDamperAssembly(K, { xd, ydDeck, xt, yt, zc, cableR = 0.165 }) {
  const dx = xt - xd, dy = yt - ydDeck;
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len, dirY = dy / len;

  // Plunge anchor point -1.50m solidly inside the concrete deck slab
  const tBelow = -1.50 / Math.max(1.0, dy);
  const pBase = [xd + dx * tBelow, ydDeck - 1.50, zc];
  const pTop = [xt, yt, zc];

  // Exact point where inclined cable pierces the raised concrete median crown (y = ydDeck + 0.98m)
  const tCrown = 0.98 / Math.max(1.0, dy);
  const xCrown = xd + dx * tCrown;
  const pCrown = [xCrown, ydDeck + 0.98, zc];

  // 1. White HDPE stay cable + upper anchor boot inside shuttle pylon
  useMat(K, PAL.cableWhite);
  stayCable(K, pBase, pTop, cableR, {
    sides: 8, anchorLen: 3.4, anchorR: cableR * 1.75, anchorMat: PAL.steelDark,
  });

  // 2. Stepped concrete anchor pedestal + bolted steel base flange plate with hex anchor bolts on median crown (>= 8cm steps -> ZERO Z-fight!)
  useMat(K, PAL.concBarrier);
  K.box(xCrown, ydDeck + 0.58, zc, 1.56, 0.84, 0.96);
  useMat(K, PAL.concPier);
  K.box(xCrown, ydDeck + 1.07, zc, 1.38, 0.14, 0.78);
  useMat(K, PAL.steelDark);
  K.box(xCrown, ydDeck + 1.21, zc, 1.14, 0.14, 0.60);
  // 6 raised steel hex anchor bolt studs around the base collar plate
  useMat(K, PAL.steelSilver);
  for (const bx of [-0.46, 0.0, 0.46]) {
    for (const bz of [-0.22, 0.22]) {
      K.box(xCrown + bx, ydDeck + 1.32, zc + bz, 0.075, 0.08, 0.075);
    }
  }

  // 3. Lower heavy steel anti-vandalism guide pipe rising from below deck up to damper collar
  const pPipeEnd = [pCrown[0] + dirX * 2.8, pCrown[1] + dirY * 2.8, zc];
  useMat(K, PAL.steelDark);
  K.tube(pBase, pPipeEnd, 0.30, 0.27, 10, true);

  // 4. Stepped cylindrical viscous vibration damper collar + twin brushed-steel clamp rings + red indicator band!
  const pDamp0 = [pCrown[0] + dirX * 2.65, pCrown[1] + dirY * 2.65, zc];
  const pDamp1 = [pCrown[0] + dirX * 4.05, pCrown[1] + dirY * 4.05, zc];
  const pBootEnd = [pCrown[0] + dirX * 4.75, pCrown[1] + dirY * 4.75, zc];
  useMat(K, PAL.steelSilver);
  K.tube(pDamp0, [pDamp0[0] + dirX * 0.22, pDamp0[1] + dirY * 0.22, zc], 0.34, 0.34, 10, true);
  useMat(K, PAL.steelDark);
  K.tube([pDamp0[0] + dirX * 0.20, pDamp0[1] + dirY * 0.20, zc], pDamp1, 0.31, 0.31, 10, true);
  // Signature subtle red/silver damper inspection collar ring
  useMat(K, PAL.cqRed);
  K.tube([pDamp1[0] - dirX * 0.38, pDamp1[1] - dirY * 0.38, zc], [pDamp1[0] - dirX * 0.16, pDamp1[1] - dirY * 0.16, zc], 0.33, 0.33, 10, true);
  // Upper brushed-steel flange + tapered weather-boot cone sealing onto white HDPE stay cable
  useMat(K, PAL.steelSilver);
  K.tube([pDamp1[0] - dirX * 0.16, pDamp1[1] - dirY * 0.16, zc], pDamp1, 0.34, 0.34, 10, true);
  useMat(K, PAL.steelDark);
  K.tube(pDamp1, pBootEnd, 0.26, cableR * 1.12, 10, true);
}

// ---------------------------------------------------------------------------
// Complete Walkable Bridge Roadway Deck (Asphalt + Markings + Sidewalks +
// Guardrails + Architectural Streetlamps + Walkable Colliders)
// ---------------------------------------------------------------------------

/**
 * Builds a realistic upper bridge roadway along local X in [x0, x1] at elevation deckY
 * (or variable elevation deckYFn(x)).
 *
 * Local frame: x along bridge, y up, z across bridge (0 = centerline).
 * Returns: { deckSegs: [lx0, lz0, y0, lx1, lz1, y1, hw, ...], lamps: [[lx, ly, lz], ...] }
 */
export function buildRoadDeck(K, {
  x0, x1,
  deckY,              // number or (x) => y
  roadW = 16.0,       // total asphalt width (e.g. 4-lane = 15-16m, 6-lane = 22-24m)
  sidewalkW = 2.4,    // each side
  medianW = 1.6,      // central median barrier width (0 for painted double yellow)
  lanesPerSide = 2,
  slabDepth = 0.85,   // concrete deck slab thickness below asphalt
  step = 16,          // longitudinal segmentation for slopes / curved elevation
  lampSpacing = 28,
  lampSide = 'both',  // 'both' | 'center' | 'alt' | 'none'
  railColor = PAL.steelSilver,
  curbColor = PAL.concBarrier,
  edgeLight = null,   // optional LED strip palette along outer fascia (e.g. PAL.ledGold)
  macroDetail = false, // Enable dense bolted flanges, vertical safety pickets, curb drains & cat's-eyes on hero walkable bridges
} = {}) {
  const yAt = typeof deckY === 'function' ? deckY : () => deckY;
  const n = Math.max(2, Math.ceil((x1 - x0) / step));
  const dx = (x1 - x0) / n;
  const hwRoad = roadW * 0.5;
  const hwTotal = hwRoad + sidewalkW;
  const hwMed = medianW * 0.5;
  const deckSegs = [];
  const lamps = [];

  // Build frames along x0..x1
  const frames = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * dx;
    const xm = Math.max(x0, x - 1), xp = Math.min(x1, x + 1);
    const dy = (yAt(xp) - yAt(xm)) / Math.max(xp - xm, 1e-4);
    frames.push(makeFrame([x, yAt(x), 0], [1, dy, 0]));
  }

  // 1. Structural concrete deck slab underside & fascia edges (TOP strictly at u = 0.00 so asphalt sits cleanly on top!)
  useMat(K, PAL.concLight);
  sweepProfile(K, frames, [
    [-hwTotal - 0.35, -slabDepth], [hwTotal + 0.35, -slabDepth],
    [hwTotal + 0.50, -0.18], [hwTotal + 0.50, 0.00],
    [-hwTotal - 0.50, 0.00], [-hwTotal - 0.50, -0.18],
  ], true);

  // 2. Weathered dark asphalt carriageway wearing surface (u = +0.01 .. +0.09, cleanly proud of concrete slab!)
  useMat(K, PAL.asphalt);
  sweepProfile(K, frames, chamferRect(roadW + 0.08, 0.08, 0, 0, 0.05), false);

  // 3. Raised granite pedestrian sidewalks & curbs on both sides (strictly non-overlapping, bottom at +0.06 >= 5cm clear of asphalt bottom!)
  if (sidewalkW > 0.2) {
    const curbW = Math.min(0.24, sidewalkW * 0.25);
    const walkW = Math.max(0.20, sidewalkW - curbW);
    useMat(K, curbColor);
    for (const sg of [-1, 1]) {
      sweepProfile(K, frames, chamferRect(curbW, 0.26, 0.03, sg * (hwRoad + curbW * 0.5), 0.19), false);
    }
    useMat(K, PAL.sidewalk);
    for (const sg of [-1, 1]) {
      const rCenter = sg * (hwRoad + curbW + walkW * 0.5);
      sweepProfile(K, frames, chamferRect(walkW, 0.20, 0.02, rCenter, 0.16), true);
    }
  }

  // 4. Raised Central Median Concrete Jersey Barrier Island OR Double Yellow Centerline
  const markY = 0.145; // 5.5cm cleanly proud of asphalt top (0.09) -> ZERO Z-fighting at all distances!
  if (medianW > 0.3) {
    useMat(K, curbColor);
    // Robust wide-crown central concrete median island (bottom at +0.06 >= 5cm clear of asphalt bottom!)
    const topHW = Math.max(hwMed * 0.76, Math.min(hwMed - 0.12, 0.88));
    const medProf = [
      [-hwMed, 0.06], [hwMed, 0.06],
      [hwMed, 0.26], [topHW + 0.12, 0.44], [topHW, 0.98],
      [-topHW, 0.98], [-topHW - 0.12, 0.44], [-hwMed, 0.26],
    ];
    sweepProfile(K, frames, medProf, true);
    // Dark concrete cap trim strip sitting strictly ABOVE median crown (inset >= 6cm per side!)
    useMat(K, PAL.concPier);
    sweepProfile(K, frames, chamferRect(topHW * 1.80, 0.07, 0.02, 0, 1.015), false);
    // Double yellow edge lines flanking median barrier
    useMat(K, PAL.laneYellow);
    for (const sg of [-1, 1]) {
      sweepProfile(K, frames, chamferRect(0.18, 0.025, 0, sg * (hwMed + 0.26), markY), false);
      sweepProfile(K, frames, chamferRect(0.14, 0.025, 0, sg * (hwMed + 0.52), markY), false);
    }
  } else {
    useMat(K, PAL.laneYellow);
    for (const sg of [-1, 1]) {
      sweepProfile(K, frames, chamferRect(0.16, 0.025, 0, sg * 0.18, markY), false);
    }
  }

  // 5. Outer solid white lines & crisp dashed white lane dividers (zero paper-thin asphaltWear Z-fight quads!)
  useMat(K, PAL.laneWhite);
  for (const sg of [-1, 1]) {
    sweepProfile(K, frames, chamferRect(0.18, 0.025, 0, sg * (hwRoad - 0.30), markY), false);
  }
  const carrStart = hwMed + (medianW > 0.3 ? 0.62 : 0.30);
  const carrW = hwRoad - carrStart - 0.32;
  if (lanesPerSide >= 2 && carrW > 2.0) {
    const lw = carrW / lanesPerSide;
    // Dashed white lane divider stripes split at 2.25m sub-steps so curved/cambered decks never dip toward asphalt!
    useMat(K, PAL.laneWhite);
    const dashLen = 4.5, gapLen = 7.5, stride = dashLen + gapLen;
    const dashYOff = markY + 0.015; // +7.0cm cleanly proud of asphalt top (0.09)
    for (let x = x0 + 3; x < x1 - dashLen; x += stride) {
      const xm = x + dashLen * 0.5, x2 = x + dashLen;
      const ya = yAt(x) + dashYOff, ym = yAt(xm) + dashYOff, yb = yAt(x2) + dashYOff;
      for (const sg of [-1, 1]) {
        for (let l = 1; l < lanesPerSide; l++) {
          const z = sg * (carrStart + l * lw);
          K.quad([x, ya, z + 0.095], [xm, ym, z + 0.095], [xm, ym, z - 0.095], [x, ya, z - 0.095]);
          K.quad([xm, ym, z + 0.095], [x2, yb, z + 0.095], [x2, yb, z - 0.095], [xm, ym, z - 0.095]);
        }
      }
    }
  }

  // 5b. Modular Steel Deck Expansion Joints (strictly non-overlapping tiers >= 4.5cm proud of asphalt!)
  const expStep = 120;
  for (let x = x0 + 48; x < x1 - 40; x += expStep) {
    const y = yAt(x);
    useMat(K, PAL.concPier);
    K.box(x - 0.48, y + 0.115, 0, 0.42, 0.05, roadW);
    K.box(x + 0.48, y + 0.115, 0, 0.42, 0.05, roadW);
    useMat(K, PAL.steelDark);
    K.box(x, y + 0.115, 0, 0.50, 0.05, hwTotal * 2 + 0.2);
    useMat(K, PAL.steelSilver);
    for (const dxj of [-0.17, 0.17]) {
      K.box(x + dxj, y + 0.155, 0, 0.11, 0.03, hwTotal * 2 + 0.3);
    }
  }
  // Macro-level curb storm-drain grates & median cat's-eye studs on walkable hero bridges
  if (macroDetail) {
    for (let x = x0 + 10; x < x1 - 10; x += 18) {
      const y = yAt(x);
      for (const sg of [-1, 1]) {
        const zg = sg * (hwRoad - 0.48);
        useMat(K, PAL.louverMetal);
        K.box(x, y + 0.118, zg, 0.68, 0.055, 0.42);
      }
    }
    if (medianW > 0.3) {
      for (let x = x0 + 8; x < x1 - 8; x += 12) {
        const y = yAt(x);
        useMat(K, PAL.ledGold);
        for (const sg of [-1, 1]) {
          K.box(x, y + 0.145, sg * (hwMed + 0.39), 0.12, 0.05, 0.12);
          K.box(x, y + 0.76, sg * (Math.max(hwMed * 0.76, Math.min(hwMed - 0.12, 0.88)) + 0.10), 0.26, 0.10, 0.06);
        }
      }
    }
  }

  // 6. Engineered Bolted Steel Crash Guardrails (between carriageway & sidewalk) + Outer Pedestrian Balustrades
  //    Strict >= 5cm lateral/vertical tiering between plinths, coping, posts & rails -> ZERO Z-fighting!
  for (const sg of [-1, 1]) {
    // Multi-rail structural steel crash barrier seated cleanly on sidewalk inside curb (zCrash = hwRoad + 0.38!)
    const zCrash = sg * (hwRoad + 0.38);
    useMat(K, PAL.concPier);
    sweepProfile(K, frames, chamferRect(0.28, 0.14, 0.02, zCrash, 0.33), false); // Concrete plinth (u=0.26..0.40)
    useMat(K, railColor);
    sweepProfile(K, frames, chamferRect(0.08, 0.15, 0.02, zCrash, 0.68), false); // Heavy lower box crash rail
    sweepProfile(K, frames, chamferRect(0.08, 0.10, 0.02, zCrash, 1.00), false); // Upper crash rail

    // Outer pedestrian balustrade along deck edge: chamfered concrete parapet + brushed steel rails
    const zOuter = sg * (hwTotal + 0.20);
    useMat(K, curbColor);
    sweepProfile(K, frames, chamferRect(0.32, 0.38, 0.04, zOuter, 0.35), false); // Beveled concrete parapet (u=0.16..0.54)
    useMat(K, PAL.concPier);
    sweepProfile(K, frames, chamferRect(0.44, 0.10, 0.02, zOuter, 0.59), false); // Parapet coping cap (u=0.54..0.64)
    useMat(K, railColor);
    sweepProfile(K, frames, chamferRect(0.08, 0.08, 0.02, zOuter, 1.34), false); // Ergonomic top handrail
    sweepProfile(K, frames, chamferRect(0.07, 0.06, 0.01, zOuter, 1.12), false); // Sub-top bar
    sweepProfile(K, frames, chamferRect(0.07, 0.06, 0.01, zOuter, 0.84), false); // Mid rail
    sweepProfile(K, frames, chamferRect(0.07, 0.06, 0.01, zOuter, 0.70), false); // Lower rail (clear of coping 0.64!)

    // Bolted steel stanchion posts (strictly 0.18 wide -> >= 5cm clear of BOTH 0.28/0.44 concrete plinth AND 0.08 rails!)
    const postStep = macroDetail ? 3.6 : 5.5;
    for (let x = x0 + 1.0; x <= x1 - 1.0; x += postStep) {
      const y = yAt(x);
      if (macroDetail) {
        useMat(K, PAL.steelDark);
        K.box(x, y + 0.665, zOuter, 0.24, 0.05, 0.28);
      }
      useMat(K, railColor);
      K.box(x, y + 1.03, zOuter, 0.10, 0.64, 0.18);
      if (macroDetail && x + postStep * 0.7 < x1) {
        K.box(x + postStep * 0.33, y + 1.03, zOuter, 0.045, 0.62, 0.045);
        K.box(x + postStep * 0.66, y + 1.03, zOuter, 0.045, 0.62, 0.045);
      }
      if (sidewalkW > 0.2) {
        if (macroDetail) {
          useMat(K, PAL.steelDark);
          K.box(x, y + 0.425, zCrash, 0.24, 0.05, 0.22);
          useMat(K, railColor);
        }
        K.box(x, y + 0.76, zCrash, 0.11, 0.62, 0.18);
        if (macroDetail) K.box(x, y + 0.70, zCrash - sg * 0.13, 0.06, 0.44, 0.06);
      }
    }

    // Optional architectural LED fascia line at night (cleanly proud of concrete deck edge ±(hwTotal + 0.50)!)
    if (edgeLight) {
      useMat(K, edgeLight);
      sweepProfile(K, frames, chamferRect(0.14, 0.16, 0, sg * (hwTotal + 0.62), -0.34), false);
    }
  }

  // 7. Sculpted Architectural Bridge Streetlamps (flanged pedestal base + tapered shaft + curved arm + multi-part cobra head!)
  if (lampSide !== 'none' && lampSpacing > 4) {
    const nLamps = Math.max(1, Math.floor((x1 - x0 - 12) / lampSpacing));
    for (let k = 0; k <= nLamps; k++) {
      const x = x0 + 6 + (x1 - x0 - 12) * (k / Math.max(1, nLamps));
      const y = yAt(x);
      const sides = lampSide === 'both' ? [-1, 1] : lampSide === 'center' ? [0] : [(k % 2 === 0 ? 1 : -1)];
      for (const sg of sides) {
        const zBase = sg === 0 ? 0 : sg * (hwTotal + 0.15);
        const hPole = 9.4;
        // Bolted octagonal cast-iron pedestal base + inspection hatch collar
        useMat(K, PAL.steelDark);
        K.box(x, y + 0.52, zBase, 0.46, 0.10, 0.46); // Base anchor flange
        K.tube([x, y + 0.56, zBase], [x, y + 1.65, zBase], 0.21, 0.15, 8, true);
        K.tube([x, y + 1.62, zBase], [x, y + hPole, zBase], 0.14, 0.075, 8, true);
        // Subtle architectural decorative warm amber vertical LED accent strip on upper shaft
        useMat(K, PAL.ledGold);
        K.box(x, y + hPole * 0.72, zBase - (sg === 0 ? 0 : sg * 0.12), 0.06, 2.2, 0.06);
        useMat(K, PAL.steelDark);

        const emitCobraHead = (hx, hy, hz, armDir) => {
          // Die-cast ribbed aluminum luminaire hood + cooling fins + recessed glowing LED lens array
          useMat(K, PAL.steelDark);
          K.box(hx, hy + 0.12, hz, 0.54, 0.12, 1.08);
          useMat(K, PAL.steelSilver);
          K.box(hx, hy + 0.19, hz - armDir * 0.06, 0.42, 0.06, 0.86);
          useMat(K, PAL.lampWarm);
          K.box(hx, hy + 0.04, hz + armDir * 0.05, 0.44, 0.07, 0.82);
        };

        if (sg === 0) {
          for (const armDir of [-1, 1]) {
            K.tube([x, y + hPole - 0.45, 0], [x, y + hPole + 0.25, armDir * 1.05], 0.065, 0.055, 6, false);
            K.tube([x, y + hPole + 0.25, armDir * 1.05], [x, y + hPole + 0.58, armDir * 2.15], 0.055, 0.045, 6, true);
            emitCobraHead(x, y + hPole + 0.52, armDir * 2.25, armDir);
            lamps.push([x, y + hPole + 0.1, armDir * 2.2]);
          }
        } else {
          const z1 = zBase - sg * 0.85, z2 = zBase - sg * 1.75, zTip = zBase - sg * 2.45;
          K.tube([x, y + hPole - 0.55, zBase], [x, y + hPole + 0.18, z1], 0.070, 0.060, 6, false);
          K.tube([x, y + hPole + 0.18, z1], [x, y + hPole + 0.55, z2], 0.060, 0.052, 6, false);
          K.tube([x, y + hPole + 0.55, z2], [x, y + hPole + 0.68, zTip], 0.052, 0.044, 6, true);
          emitCobraHead(x, y + hPole + 0.60, zTip, -sg);
          lamps.push([x, y + hPole + 0.1, zTip]);
        }
      }
    }
  }

  // 8. Walkable deck collider segments (local coordinates — caller transforms to world)
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * dx, xb = x0 + (i + 1) * dx;
    deckSegs.push(xa, 0, yAt(xa) + 0.10, xb, 0, yAt(xb) + 0.10, hwTotal - 0.15);
  }

  return { deckSegs, lamps };
}

// ---------------------------------------------------------------------------
// Double-Deck Steel Warren Truss + Lower CRT Rail Deck
// (Authentic to Qiansimen, Dongshuimen, Chaotianmen, Caiyuanba)
// ---------------------------------------------------------------------------
export function buildDoubleDeckTruss(K, {
  x0, x1,
  upperY,           // number or (x) => y
  trussDepth = 10.6,// vertical distance from upper road deck to lower rail deck
  trussHalfW = 8.4, // half-width between left & right vertical truss planes
  bayLen = 12.0,    // length of each diagonal bay
  steelMat = PAL.cqRed,
  darkMat = PAL.cqRedDark,
  railGauge = 1.435,
  trackSep = 4.2,   // centerline-to-centerline spacing between the two CRT rail tracks
  hasSideRoadLanes = false, // Chaotianmen has 2 outer lanes on lower deck as well
  nightStrip = PAL.ledGold,
} = {}) {
  const yTop = typeof upperY === 'function' ? upperY : () => upperY;
  const yBot = (x) => yTop(x) - trussDepth;
  const nBays = Math.max(2, Math.round((x1 - x0) / bayLen));
  const dx = (x1 - x0) / nBays;

  // Build longitudinal frames for chords
  const topFrames = [], botFrames = [];
  for (let i = 0; i <= nBays; i++) {
    const x = x0 + i * dx;
    const xm = Math.max(x0, x - 1), xp = Math.min(x1, x + 1);
    const dy = (yTop(xp) - yTop(xm)) / Math.max(xp - xm, 1e-4);
    topFrames.push(makeFrame([x, yTop(x) - 0.85, 0], [1, dy, 0]));
    botFrames.push(makeFrame([x, yBot(x), 0], [1, dy, 0]));
  }

  // 1. Upper & Lower Steel Longitudinal Box Chords on both truss planes (+trussHalfW, -trussHalfW)
  useMat(K, steelMat);
  for (const sg of [-1, 1]) {
    const z = sg * trussHalfW;
    sweepProfile(K, topFrames, chamferRect(1.05, 1.15, 0.08, z, 0), true);
    sweepProfile(K, botFrames, chamferRect(1.15, 1.25, 0.08, z, 0), true);
  }

  // 2. Warren Truss Diagonals, Verticals, Transverse Floor Beams, Cantilever Brackets & Gussets
  for (let i = 0; i <= nBays; i++) {
    const x = x0 + i * dx;
    const yt = yTop(x) - 0.85, yb = yBot(x);

    // Transverse upper floor beam + outer cantilever brackets carrying wider upper roadway (0.48 wide -> >= 0.07m inset from 0.62 verticals!)
    useMat(K, darkMat);
    steelBeam(K, [x, yt - 0.25, -trussHalfW - 3.6], [x, yt - 0.25, trussHalfW + 3.6], 0.48, 0.76);
    // Diagonal knee braces supporting upper sidewalk cantilevers
    for (const sg of [-1, 1]) {
      steelBeam(K, [x, yt - 2.6, sg * trussHalfW], [x, yt - 0.45, sg * (trussHalfW + 3.1)], 0.36, 0.42);
    }

    // Transverse lower floor beam carrying CRT tracks
    steelBeam(K, [x, yb - 0.15, -trussHalfW], [x, yb - 0.15, trussHalfW], 0.50, 0.88);

    // Truss verticals & nodal gussets
    useMat(K, steelMat);
    for (const sg of [-1, 1]) {
      const z = sg * trussHalfW;
      // Vertical post every panel (keeps Warren+verticals super crisp like Chongqing twin bridges)
      steelBeam(K, [x, yb + 0.5, z], [x, yt - 0.5, z], 0.62, 0.62, [1, 0, 0], false);
      // Bolted gusset node housings at upper & lower chord joints
      useMat(K, darkMat);
      gussetNode(K, [x, yt, z], 1.7, 1.45, 1.35);
      gussetNode(K, [x, yb, z], 1.8, 1.55, 1.45);
      useMat(K, steelMat);
    }

    // Warren diagonals + lower wind X-bracing inside each bay
    if (i < nBays) {
      const xNext = x0 + (i + 1) * dx;
      const ytNext = yTop(xNext) - 0.85, ybNext = yBot(xNext);
      const upSlash = (i % 2 === 0);
      for (const sg of [-1, 1]) {
        const z = sg * trussHalfW;
        if (upSlash) {
          steelBeam(K, [x, yb + 0.35, z], [xNext, ytNext - 0.35, z], 0.72, 0.78, [0, 1, 0], false, 0.06);
        } else {
          steelBeam(K, [x, yt - 0.35, z], [xNext, ybNext + 0.35, z], 0.72, 0.78, [0, 1, 0], false, 0.06);
        }
      }
      // Horizontal K / X lateral wind bracing beneath lower rail deck
      useMat(K, darkMat);
      steelBeam(K, [x, yb - 0.35, -trussHalfW + 0.6], [xNext, ybNext - 0.35, trussHalfW - 0.6], 0.34, 0.34, [0, 1, 0], false);
      steelBeam(K, [x, yb - 0.35, trussHalfW - 0.6], [xNext, ybNext - 0.35, -trussHalfW + 0.6], 0.34, 0.34, [0, 1, 0], false);
    }
  }

  // 3. Lower Deck Concrete/Steel Floor Slab (top at +0.525, strictly 10cm below crimson chord top +0.625 -> ZERO Z-fight!)
  const lowerDeckHW = hasSideRoadLanes ? trussHalfW + 4.0 : trussHalfW - 0.55;
  useMat(K, PAL.concPier);
  sweepProfile(K, botFrames, chamferRect(lowerDeckHW * 2, 0.55, 0, 0, 0.25), true);

  // Twin CRT tracks (ballast/plinth beds + sleepers + gleaming steel rails + overhead catenary bar)
  const halfTrackSep = trackSep * 0.5;
  for (const sg of [-1, 1]) {
    const zc = sg * halfTrackSep;
    // Concrete track plinth (top at +0.84)
    useMat(K, PAL.ballast);
    sweepProfile(K, botFrames, chamferRect(2.4, 0.24, 0, zc, 0.72), false);
    // Brushed steel rails sitting cleanly atop sleepers (y = +0.93..+1.11)
    useMat(K, PAL.steelRail);
    for (const rsg of [-1, 1]) {
      sweepProfile(K, botFrames, chamferRect(0.11, 0.18, 0, zc + rsg * (railGauge * 0.5), 1.02), false);
    }
    // Overhead rigid power catenary conductor bar
    useMat(K, PAL.steelSilver);
    sweepProfile(K, botFrames, chamferRect(0.12, 0.16, 0, zc, trussDepth - 2.3), false);
  }
  // Sleepers sitting cleanly +8cm proud above ballast top (+0.84 -> +0.92, ZERO cambered Z-fight!)
  useMat(K, PAL.sleeper);
  for (let x = x0 + 1.2; x < x1 - 1.0; x += 2.4) {
    const y = yBot(x) + 0.875;
    for (const sg of [-1, 1]) {
      K.box(x, y, sg * halfTrackSep, 0.28, 0.11, 2.25);
    }
  }
  // Center emergency walkway between tracks
  useMat(K, PAL.steelDark);
  sweepProfile(K, botFrames, chamferRect(1.1, 0.14, 0, 0, 0.80), false);

  // Optional glowing architectural night strip along lower truss chord (strictly +0.10m proud of gusset nodes!)
  if (nightStrip) {
    useMat(K, nightStrip);
    for (const sg of [-1, 1]) {
      sweepProfile(K, botFrames, chamferRect(0.16, 0.22, 0, sg * (trussHalfW + 0.90), -0.15), false);
    }
  }
}

// ---------------------------------------------------------------------------
// Iconic Chongqing "Sky Shuttle" (天梭形) Concrete Pylon Builder
// Faithful to Qiansimen Bridge (single 182m pylon) & Dongshuimen Bridge (twin ~172m pylons)
// ---------------------------------------------------------------------------
export function buildShuttlePylon(K, {
  x,
  baseY,         // riverbed / foundation bottom (well below waterY)
  waterY,        // water surface elevation for wet-zone & pier cap placement
  lowerDeckY,    // lower CRT rail deck elevation
  upperDeckY,    // upper highway deck elevation
  topY,          // pinnacle top elevation (e.g. waterY + 182m)
  deckHalfW = 11.0, // clearance needed for double-deck girder
  nightFlood = PAL.ledGold,
} = {}) {
  const pierCapTop = waterY + 9.5;
  const pierCapBot = Math.min(baseY, waterY - 12.0);
  const legStartY = pierCapTop - 1.0;
  const pylonH = topY - legStartY;

  // 1. Massive Submerged Caisson Foundation & Cutwater Concrete River Pier
  useMat(K, PAL.concWet);
  const subFrames = [
    makeFrame([x, pierCapBot, 0], [0, 1, 0], [1, 0, 0]),
    makeFrame([x, waterY + 2.2, 0], [0, 1, 0], [1, 0, 0]),
  ];
  sweepProfile(K, subFrames, cutwaterProfile(18.0, 32.0, 5.5), true);

  // Above-water terraced pier pedestal with cutwater prow
  useMat(K, PAL.concPier);
  const pedFrames = [
    makeFrame([x, waterY + 2.0, 0], [0, 1, 0], [1, 0, 0]),
    makeFrame([x, pierCapTop, 0], [0, 1, 0], [1, 0, 0]),
  ];
  sweepProfile(K, pedFrames, (i) => cutwaterProfile(16.0 - i * 1.4, 28.0 - i * 2.2, 4.5), true);
  // Crisp chamfered pier-cap cornice + steel maintenance walkway railing around pier pedestal
  useMat(K, PAL.concLight);
  K.box(x, pierCapTop + 0.6, 0, 15.2, 1.3, 26.8);
  useMat(K, PAL.steelSilver);
  for (const sgn of [-1, 1]) {
    K.box(x + sgn * 7.35, pierCapTop + 1.85, 0, 0.10, 0.10, 26.2);
    K.box(x, pierCapTop + 1.85, sgn * 13.1, 14.8, 0.10, 0.10);
    for (let k = -3; k <= 3; k++) {
      K.box(x + sgn * 7.35, pierCapTop + 1.55, k * 4.0, 0.10, 0.65, 0.10);
    }
  }

  // 2. Twin Curved Shuttle-Shaped Concrete Legs
  // Authentic Sky Shuttle curve:
  //   - Starts at z = ±7.2m on pier cap
  //   - Curves OUTWARD to clear the double-deck truss (z = ±(deckHalfW + 3.2) at upperDeckY)
  //   - Reaches max belly width slightly above upperDeckY, then arches smoothly INWARD
  //   - Fuses into a slender pointed shuttle spire from 0.78*H to 1.0*H, leaving a dramatic hollow almond cutout!
  const yJoin = legStartY + pylonH * 0.77;
  const zDeckClear = deckHalfW + 3.4;
  const zMaxBelly = deckHalfW + 4.8;
  const yBelly = upperDeckY + (yJoin - upperDeckY) * 0.22;

  const zOfY = (y) => {
    if (y <= yBelly) {
      const u = Math.max(0, Math.min(1, (y - legStartY) / Math.max(1, yBelly - legStartY)));
      // Smooth S-curve outward from pedestal to widest point above deck
      const s = Math.max(0, Math.sin(u * Math.PI * 0.5));
      return 6.8 + (zMaxBelly - 6.8) * Math.pow(s, 0.85);
    }
    if (y <= yJoin) {
      const u = (y - yBelly) / Math.max(1, yJoin - yBelly);
      // Graceful curved shuttle convergence inward
      const c = Math.max(0, Math.cos(u * Math.PI * 0.5));
      return 2.3 + (zMaxBelly - 2.3) * Math.pow(c, 1.15);
    }
    const u = Math.min(1, (y - yJoin) / Math.max(1, topY - yJoin));
    return 2.3 * (1 - u * 0.88);
  };

  const N = 28;
  useMat(K, PAL.concPylon);
  for (const sg of [-1, 1]) {
    const legFrames = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = legStartY + (yJoin + 4.0 - legStartY) * t;
      const z = sg * zOfY(y);
      const yPrev = Math.max(legStartY, y - 2), yNext = Math.min(topY, y + 2);
      const dz = sg * (zOfY(yNext) - zOfY(yPrev)) / Math.max(1e-4, yNext - yPrev);
      legFrames.push(makeFrame([x, y, z], [0, 1, dz], [1, 0, 0]));
    }
    // Note: in frame with T ≈ (0, 1, dz) and upHint = (1, 0, 0):
    // R = T x (1, 0, 0) ≈ (0, 0, -1) (transverse along z), U = R x T ≈ (1, 0, 0) (longitudinal along x)
    sweepProfile(K, legFrames, (i, t) => {
      const wZ = 5.4 - t * 1.9;  // thickness across bridge
      const wX = 7.8 - t * 2.4;  // depth along bridge (wider for bending stiffness)
      return chamferRect(wZ, wX, 0.75);
    }, true);

    // Concrete climbing-formwork horizontal shadow reveal bands every ~8m up the curved shuttle legs!
    useMat(K, PAL.concPier);
    for (let yBand = legStartY + 8; yBand < yJoin - 2; yBand += 8.5) {
      const tb = (yBand - legStartY) / Math.max(1, yJoin + 4.0 - legStartY);
      const wZ = 5.4 - tb * 1.9;
      const wX = 7.8 - tb * 2.4;
      K.box(x, yBand, sg * zOfY(yBand), wX + 0.14, 0.20, wZ + 0.14);
    }

    // Recessed architectural LED outline channels running smoothly up BOTH outer & inner shuttle spines!
    useMat(K, nightFlood);
    const ledOut = [], ledIn = [];
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const y = legStartY + (yJoin + 2.0 - legStartY) * t;
      const wZ = 5.4 - t * 1.9;
      const yPrev = Math.max(legStartY, y - 2), yNext = Math.min(topY, y + 2);
      const dz = sg * (zOfY(yNext) - zOfY(yPrev)) / Math.max(1e-4, yNext - yPrev);
      ledOut.push(makeFrame([x, y, sg * (zOfY(y) + wZ * 0.5 + 0.08)], [0, 1, dz], [1, 0, 0]));
      if (y > upperDeckY + 2.0 && y < yJoin - 1.0) {
        ledIn.push(makeFrame([x, y, sg * (zOfY(y) - wZ * 0.5 - 0.08)], [0, 1, dz], [1, 0, 0]));
      }
    }
    sweepProfile(K, ledOut, chamferRect(0.22, 0.38, 0), false);
    if (ledIn.length >= 2) sweepProfile(K, ledIn, chamferRect(0.24, 0.42, 0), false);
    useMat(K, PAL.concPylon);
  }

  // 3. Upper Fused Shuttle Pinnacle Crown (yJoin -> topY) with tapered diamond point
  const crownFrames = [];
  const Nc = 10;
  for (let i = 0; i <= Nc; i++) {
    const t = i / Nc;
    const y = (yJoin - 3.0) + (topY - (yJoin - 3.0)) * t;
    crownFrames.push(makeFrame([x, y, 0], [0, 1, 0], [1, 0, 0]));
  }
  useMat(K, PAL.concPylon);
  sweepProfile(K, crownFrames, (i, t) => {
    const pinch = Math.pow(1 - t, 0.75);
    const wZ = Math.max(0.8, 7.6 * pinch);
    const wX = Math.max(1.2, 6.2 * (0.28 + 0.72 * pinch));
    return chamferRect(wZ, wX, Math.min(0.6, wZ * 0.25));
  }, true);

  // Sleek stay-cable anchor steel spine inside upper anchor zone (slim & architectural, preserving hollow shuttle silhouette!)
  const yAnchBot = upperDeckY + (yJoin - upperDeckY) * 0.44;
  const yAnchTop = topY - 8.0;
  useMat(K, PAL.concPier);
  K.box(x, (yAnchBot + yAnchTop) * 0.5, 0, 2.8, yAnchTop - yAnchBot, 1.05);

  // Sculpted concrete cross-beams tying the legs together:
  //   a) Lower cross-beam directly carrying the lower rail truss deck
  //   b) Intermediate upper cross-beam inside the shuttle arch throat
  useMat(K, PAL.concPylon);
  const zLowBeam = zOfY(lowerDeckY - 2.4);
  K.box(x, lowerDeckY - 2.6, 0, 6.4, 3.8, zLowBeam * 2.0);
  // Decorative prestressed cross-beam just below cable-anchor convergence
  const yMidBeam = upperDeckY + (yJoin - upperDeckY) * 0.62;
  const zMidBeam = zOfY(yMidBeam);
  K.box(x, yMidBeam, 0, 4.6, 3.2, zMidBeam * 2.0);
  // Golden night accent bar under the lower cross-beam & crown tip
  useMat(K, nightFlood);
  K.box(x, lowerDeckY - 4.65, 0, 6.6, 0.35, zLowBeam * 1.9);
  K.box(x, topY - 2.0, 0, 1.8, 4.5, 1.2);

  // 4. Lightning Mast & Aviation Red Beacon Light
  useMat(K, PAL.steelSilver);
  K.tube([x, topY - 0.5, 0], [x, topY + 7.5, 0], 0.24, 0.08, 8, true);
  useMat(K, PAL.beaconRed);
  K.sphere(x, topY + 7.8, 0, 0.75, 10, 6);

  return { yAnchBot, yAnchTop, zOfY };
}

// ---------------------------------------------------------------------------
// Sculpted River Pier & Hillside Cliff Abutment Builders
// ---------------------------------------------------------------------------

/** Twin-shaft chamfered river pier with cutwater plinth, bearings, and deep foundation. */
export function buildRiverPier(K, {
  x, zCenter = 0,
  baseY,         // guaranteed below riverbed / terrain
  waterY,
  topY,          // bottom of bridge girder
  pierW = 14.0,  // transverse span across bridge
  shaftX = 3.2,
  shaftZ = 3.6,
  singleShaft = false,
} = {}) {
  const capH = 2.4;
  const shaftTop = topY - capH;
  const plinthTop = Math.max(baseY + 4.0, waterY + 4.2);

  // Submerged & splash-zone cutwater plinth
  const hasPlinth = (plinthTop > baseY + 0.5 && plinthTop < shaftTop - 1.5);
  if (hasPlinth) {
    useMat(K, PAL.concWet);
    const f0 = makeFrame([x, baseY, zCenter], [0, 1, 0], [1, 0, 0]);
    const f1 = makeFrame([x, plinthTop, zCenter], [0, 1, 0], [1, 0, 0]);
    sweepProfile(K, [f0, f1], cutwaterProfile(shaftX * 2.0 + 2.4, pierW + 4.5, 2.8), true);
  }
  const shaftBot = hasPlinth ? (plinthTop - 0.25) : Math.min(baseY, shaftTop - 1.5);

  useMat(K, PAL.concPier);
  if (singleShaft) {
    const f0 = makeFrame([x, shaftBot, zCenter], [0, 1, 0], [1, 0, 0]);
    const f1 = makeFrame([x, shaftTop, zCenter], [0, 1, 0], [1, 0, 0]);
    sweepProfile(K, [f0, f1], chamferRect(pierW * 0.65, shaftX, 0.45), true);
  } else {
    const zOff = pierW * 0.36;
    for (const sg of [-1, 1]) {
      const f0 = makeFrame([x, shaftBot, zCenter + sg * zOff], [0, 1, 0], [1, 0, 0]);
      const f1 = makeFrame([x, shaftTop, zCenter + sg * zOff], [0, 1, 0], [1, 0, 0]);
      sweepProfile(K, [f0, f1], chamferRect(shaftZ, shaftX, 0.35), true);
    }
    // Mid-height tie beam on tall piers
    if (shaftTop - shaftBot > 24) {
      const ym = (shaftTop + shaftBot) * 0.52;
      K.box(x, ym, zCenter, shaftX * 0.85, 2.2, zOff * 2);
    }
  }

  // Pier cap hammerhead beam + steel pot bearings
  useMat(K, PAL.concLight);
  K.box(x, topY - capH * 0.5, zCenter, shaftX + 1.2, capH, pierW + 2.6);
  useMat(K, PAL.steelDark);
  for (const sg of [-1, 1]) {
    K.box(x, topY + 0.15, zCenter + sg * (pierW * 0.36), 1.4, 0.45, 1.6);
  }
}

/**
 * Hillside stone & concrete bridge abutment anchored deeply into DEM cliff slope.
 * dir: +1 if bridge enters from +x (abutment faces +x, wing walls extend toward -x), -1 vice versa.
 * Supports optional transverse DEM sampler (groundYMin) and caps monolithic height via viaduct pier bents
 * when deckY - groundY > 14m so no bridge ever terminates in a 45m vertical dead-end stone skyscraper!
 */
export function buildAbutment(K, {
  x, deckY, groundY, width = 22.0, dir = 1, length = 22.0,
} = {}) {
  const drop = deckY - groundY;
  const botY = Math.min(groundY - 12.0, deckY - 16.0);
  const cx = x - dir * (length * 0.5);

  if (drop > 16.0) {
    // Tall riverbank transition: sleek twin concrete abutment bents + tapered sloped stone embankment toe
    // instead of a giant 45m dead-end vertical stone skyscraper!
    const capH = 2.6;
    const shaftTop = deckY - capH;
    useMat(K, PAL.concLight);
    K.box(cx, deckY - 0.55, 0, length + 0.8, 1.1, width + 1.8);
    K.box(x - dir * 3.0, deckY - capH * 0.5, 0, 4.2, capH, width + 1.2);
    useMat(K, PAL.concPier);
    for (const bx of [x - dir * 3.0, x - dir * (length - 3.5)]) {
      for (const sg of [-1, 1]) {
        const zc = sg * (width * 0.34);
        const f0 = makeFrame([bx, botY, zc], [0, 1, 0], [1, 0, 0]);
        const f1 = makeFrame([bx, shaftTop, zc], [0, 1, 0], [1, 0, 0]);
        sweepProfile(K, [f0, f1], chamferRect(3.2, 3.0, 0.35), true);
      }
      // Mid-height horizontal tie-beam
      K.box(bx, (groundY + shaftTop) * 0.5, 0, 2.4, 2.0, width * 0.72);
    }
    // Modest terraced sandstone earthwork plinth hugging ground slope
    const plinthTop = groundY + 4.5;
    useMat(K, PAL.sandstone);
    K.box(cx, (botY + plinthTop) * 0.5, 0, length + 2.0, plinthTop - botY, width + 2.4);
    return;
  }

  const h = Math.max(4.0, deckY - botY);
  // Main sandstone-clad retaining block descending deep into cliff
  useMat(K, PAL.sandstone);
  K.box(cx, botY + h * 0.5, 0, length, h, width + 3.2);

  // Stepped concrete bridge seat & flared wing-wall buttresses
  useMat(K, PAL.concPier);
  K.box(x - dir * 2.5, deckY - h * 0.25, 0, 5.2, h * 0.52, width + 1.4);
  for (const sg of [-1, 1]) {
    K.box(cx - dir * 2.0, deckY - 2.2, sg * (width * 0.5 + 1.2), length + 4.0, 4.6, 1.4);
  }
  // Top concrete cap
  useMat(K, PAL.concLight);
  K.box(cx, deckY - 0.45, 0, length + 0.8, 0.9, width + 2.2);
}

/**
 * Architectural 3D Chongqing mountain highway tunnel portal (隧道洞口) where an elevated expressway
 * ramp seamlessly enters a rising hillside slope — eliminates raw concrete wedges slicing into grass!
 * Local frame: origin at ramp end (x=0, y=0 datum, z=0 center), dir = +1 if road comes from +x (enters hillside toward -x), -1 vice versa.
 */
export function buildTunnelPortal(K, {
  x = 0, deckY, groundY, width = 12.0, dir = 1,
} = {}) {
  const hw = width * 0.5;
  const clearH = 6.2;
  const wallH = clearH + 2.4;
  const botY = Math.min(groundY - 12.0, deckY - 12.0);
  const headX = x - dir * 1.4;
  const wingDepth = 10.0;

  // 1. Deep sandstone-clad foundation plinth beneath portal & roadway entry
  useMat(K, PAL.sandstone);
  K.box(x - dir * 4.5, (botY + deckY - 0.1) * 0.5, 0, 11.0, Math.max(2.0, deckY - 0.1 - botY), width + 5.6);

  // 2. Sculpted concrete tunnel portal headwall (left/right side piers + heavy top lintel brow)
  useMat(K, PAL.concPylon);
  const pierW = 2.4;
  for (const sg of [-1, 1]) {
    K.box(headX, deckY + wallH * 0.5, sg * (hw + pierW * 0.5), 3.0, wallH, pierW);
    // Flared stepped sandstone retaining wing walls anchoring cleanly into the flanking hillside
    useMat(K, PAL.sandstone);
    K.box(headX - dir * (wingDepth * 0.45), (botY + deckY + wallH * 0.72) * 0.5, sg * (hw + pierW + 1.1), wingDepth, deckY + wallH * 0.72 - botY, 2.2);
    useMat(K, PAL.concPylon);
  }
  // Portal crown lintel beam + projecting cornice hood
  K.box(headX, deckY + clearH + 1.2, 0, 3.4, 2.4, width + pierW * 2 + 0.8);
  useMat(K, PAL.concLight);
  K.box(headX + dir * 0.35, deckY + wallH + 0.25, 0, 3.8, 0.55, width + pierW * 2 + 1.4);

  // 3. Recessed pitch-black 6m interior tunnel bore & rear light-tight seal wall (zero grass poking inside!)
  const boreCx = headX - dir * 4.2;
  K.style([0.015, 0.016, 0.02], 0.96, 0, 0, MAT.PLAIN);
  K.box(headX - dir * 7.0, deckY + clearH * 0.5, 0, 1.2, clearH + 0.6, width + 0.8); // Back seal wall
  K.box(boreCx, deckY + clearH + 0.1, 0, 6.2, 0.4, width + 0.8); // Dark roof vault
  for (const sg of [-1, 1]) K.box(boreCx, deckY + clearH * 0.5, sg * (hw + 0.2), 6.2, clearH + 0.4, 0.4); // Side bore walls
  // Dark asphalt throat continuing into tunnel (strictly >= 5cm clear of foundation & ramp deck!)
  useMat(K, PAL.asphalt);
  K.box(boreCx, deckY + 0.055, 0, 7.2, 0.08, width - 0.5);

  // 4. Overhead yellow clearance warning band & glowing emerald highway lane arrow (>= 8cm proud of lintel!)
  useMat(K, PAL.laneYellow);
  K.box(headX + dir * 1.82, deckY + clearH + 0.24, 0, 0.14, 0.32, width - 0.6);
  useMat(K, PAL.ledGreen);
  K.box(headX + dir * 1.86, deckY + clearH + 1.18, 0, 0.14, 0.55, 1.4);
}

// ---------------------------------------------------------------------------
// World Transform Helpers for Bridge/Structure Local Frames
// ---------------------------------------------------------------------------
/** Transform local (lx, ly, lz) point to world (wx, wy, wz) given origin (ox, oy, oz) and unit axis (ux, uz). */
export function localToWorld(ox, oy, oz, ux, uz, lx, ly, lz) {
  // Right vector in world XZ when moving along (ux, 0, uz) with up=(0,1,0): R = T x U = (-uz, 0, ux)
  return [
    ox + ux * lx - uz * lz,
    oy + ly,
    oz + uz * lx + ux * lz,
  ];
}

/** Build a Three.js Matrix4 for a local frame where +x maps to (ux, 0, uz), +y to (0,1,0), +z to (-uz, 0, ux). */
export function frameMatrix(ox, oy, oz, ux, uz) {
  const m = new THREE.Matrix4();
  // Column 0 = (ux, 0, uz), Column 1 = (0, 1, 0), Column 2 = (-uz, 0, ux)
  m.set(
    ux, 0, -uz, ox,
    0,  1,  0,  oy,
    uz, 0,  ux, oz,
    0,  0,  0,  1,
  );
  return m;
}
