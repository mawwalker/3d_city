// 3D Terrain-Draped Pedestrians (Phase 3 Photorealism):
//   - Refined anatomical silhouette (tapered neck, sculpted shoulders, layered jacket/coat hem, varied hairstyles
//     incl. short crop/bob/ponytail, backpacks & shoulder totes, sculpted sneakers with light soles)
//   - Realistic per-material PBR fabric/skin/hair/shoe/wet-umbrella roughness & subtle garment micro-weave + crevice AO
//   - Slope-filtered walkability via pathY.b so pedestrians never walk on steep retaining embankments.

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { gbufferMaterial } from '../engine/materials.js';
import { PEOPLE } from './peopleGeom.js';

class Body {
  constructor() { this.p = []; this.n = []; this.pc = []; this.i = []; this.nv = 0; }
  v(x, y, z, nx, ny, nz, part, code) { this.p.push(x, y, z); const l = Math.hypot(nx, ny, nz) || 1; this.n.push(nx / l, ny / l, nz / l); this.pc.push(part, code); return this.nv++; }
  tube(A, B, ra, rb, sides, part, code, cap0 = false, cap1 = false) {
    const base = this.nv, sl = (ra[0] - rb[0]) / Math.max(B[1] - A[1], 1e-3);
    for (let k = 0; k <= sides; k++) {
      const t = k / sides * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      this.v(A[0] + c * ra[0], A[1], A[2] + s * ra[1], c / ra[0], sl / ra[0], s / ra[1], part, code);
      this.v(B[0] + c * rb[0], B[1], B[2] + s * rb[1], c / rb[0], sl / rb[0], s / rb[1], part, code);
    }
    for (let k = 0; k < sides; k++) { const i = base + k * 2; this.i.push(i, i + 1, i + 2, i + 2, i + 1, i + 3); }
    for (const [on, P, r, ny] of [[cap0, A, ra, -1], [cap1, B, rb, 1]]) {
      if (!on) continue;
      const c0 = this.v(P[0], P[1], P[2], 0, ny, 0, part, code), f = this.nv;
      for (let k = 0; k <= sides; k++) { const t = k / sides * Math.PI * 2; this.v(P[0] + Math.cos(t) * r[0], P[1], P[2] + Math.sin(t) * r[1], 0, ny, 0, part, code); }
      for (let k = 0; k < sides; k++) { if (ny > 0) this.i.push(c0, f + k + 1, f + k); else this.i.push(c0, f + k, f + k + 1); }
    }
    return this;
  }
  ellipsoid(C, R, seg, rings, part, code) {
    const base = this.nv;
    for (let j = 0; j <= rings; j++) {
      const a = -Math.PI / 2 + j / rings * Math.PI, cy = Math.sin(a), cr = Math.cos(a);
      for (let k = 0; k <= seg; k++) { const t = k / seg * Math.PI * 2, x = Math.cos(t) * cr, z = Math.sin(t) * cr; this.v(C[0] + x * R[0], C[1] + cy * R[1], C[2] + z * R[2], x / R[0], cy / R[1], z / R[2], part, code); }
    }
    for (let j = 0; j < rings; j++) for (let k = 0; k < seg; k++) { const a = base + j * (seg + 1) + k, b = a + seg + 1; this.i.push(a, b, a + 1, a + 1, b, b + 1); }
    return this;
  }
  box(C, S, part, code) {
    const [cx, cy, cz] = C, [sx, sy, sz] = [S[0] / 2, S[1] / 2, S[2] / 2];
    const F = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
    for (const [n, u, w] of F) {
      const i = this.nv;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) this.v(cx + (n[0] + u[0] * a + w[0] * b) * sx, cy + (n[1] + u[1] * a + w[1] * b) * sy, cz + (n[2] + u[2] * a + w[2] * b) * sz, n[0], n[1], n[2], part, code);
      this.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
    return this;
  }
  cone(C, r, y0, y1, sides, part, code) {
    for (const flip of [1, -1]) {
      const base = this.nv;
      for (let k = 0; k <= sides; k++) { const t = k / sides * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); this.v(C[0] + c * r, y0, C[2] + s * r, c * (y1 - y0) * flip, r * flip, s * (y1 - y0) * flip, part, code); this.v(C[0], y1, C[2], c * (y1 - y0) * flip, r * flip, s * (y1 - y0) * flip, part, code); }
      for (let k = 0; k < sides; k++) { const i = base + k * 2; if (flip > 0) this.i.push(i, i + 1, i + 2); else this.i.push(i, i + 2, i + 1); }
    }
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('aPC', new THREE.BufferAttribute(new Float32Array(this.pc), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(this.i), 1));
    return g;
  }
}

// Surface codes: 0 skin, 1 jacket/top, 2 trousers, 3 hair, 4 shoe upper, 5 backpack, 6 forearm/sleeve, 7 umbrella, 8 coat/hem, 9 shoe sole, 10 collar/scarf, 11 ponytail/long hair, 12 tote bag
function bodyGeometry(lod) {
  const S = lod ? 4 : 10, b = new Body();
  // Pelvis & tapered coat/jacket lower hem
  b.tube([0, 0.77, 0], [0, 0.94, 0], [0.120, 0.168], [0.116, 0.164], S, 0, 8, true, false);
  // Natural waist-to-chest torso curve
  b.tube([0, 0.93, 0], [0, 1.15, 0], [0.114, 0.162], [0.104, 0.152], S, 0, 1, false, false);
  b.tube([0, 1.15, 0], [0, 1.39, 0], [0.104, 0.150], [0.118, 0.180], S, 0, 1, false, true);
  if (!lod) {
    // Naturally sloped anatomical shoulder yoke & jacket collar
    b.ellipsoid([0, 1.385, 0], [0.110, 0.056, 0.194], 10, 5, 0, 1);
    b.tube([0.008, 1.40, 0], [0.005, 1.46, 0], [0.068, 0.072], [0.060, 0.064], 8, 0, 10, false, true);
  }
  // Neck & sculpted head with varied natural hair silhouettes
  b.tube([0, 1.43, 0], [0, 1.54, 0], [0.048, 0.048], [0.044, 0.044], lod ? 4 : 8, 0, 0);
  b.ellipsoid([0.012, 1.622, 0], [0.094, 0.114, 0.084], lod ? 5 : 10, lod ? 3 : 7, 0, 0);
  b.ellipsoid([-0.016, 1.652, 0], [0.104, 0.102, 0.092], lod ? 5 : 10, lod ? 3 : 7, 0, 3);
  if (!lod) {
    // Optional shoulder-length hair / ponytail (toggled per person by h4 in vertex shader!)
    b.ellipsoid([-0.095, 1.59, 0], [0.056, 0.088, 0.078], 8, 5, 0, 11);
  }
  // Legs: natural thigh/calf trouser taper + sculpted sneakers with distinct outsole!
  for (const [sg, pt] of [[1, 1], [-1, 3]]) {
    const z = sg * 0.086;
    b.tube([0, 0.48, z], [0, 0.91, z], [0.064, 0.062], [0.094, 0.086], S, pt, 2);
    b.tube([0, 0.08, z], [0, 0.49, z], [0.048, 0.046], [0.064, 0.062], S, pt + 1, 2);
    if (!lod) {
      // Sculpted shoe upper + contrast rubber outsole
      b.ellipsoid([0.055, 0.055, z], [0.132, 0.046, 0.050], 8, 4, pt + 1, 4);
      b.box([0.052, 0.018, z], [0.265, 0.032, 0.102], pt + 1, 9);
    } else {
      b.box([0.05, 0.042, z], [0.26, 0.085, 0.10], pt + 1, 4);
    }
  }
  // Arms: smooth natural deltoid transition, tapered sleeves, wrists & hands
  for (const [sg, pt] of [[1, 5], [-1, 7]]) {
    const z = sg * 0.196;
    if (!lod) b.ellipsoid([0, 1.372, z], [0.048, 0.046, 0.046], 7, 4, pt, 1);
    b.tube([0, 1.12, z], [0, 1.375, z], [0.042, 0.042], [0.050, 0.048], S, pt, 1, false, true);
    b.tube([0, 0.87, z], [0, 1.13, z], [0.033, 0.033], [0.043, 0.043], S, pt + 1, 6);
    b.ellipsoid([0.008, 0.825, z], [0.042, 0.055, 0.028], lod ? 4 : 6, lod ? 3 : 4, pt + 1, 0);
  }
  // Optional backpack (code 5) OR casual shoulder tote bag (code 12)
  b.box([-0.172, 1.20, 0], [0.125, 0.36, 0.26], 0, 5);
  if (!lod) b.box([-0.03, 0.94, 0.255], [0.26, 0.30, 0.09], 0, 12);
  // Rain umbrella (canopy + handle shaft, code 7)
  b.cone([0.05, 0, 0.10], 0.56, 1.93, 2.11, lod ? 5 : 10, 0, 7);
  b.tube([0.05, 1.10, 0.10], [0.05, 2.11, 0.10], [0.008, 0.008], [0.008, 0.008], 4, 0, 7);
  return b.geometry();
}

const VERT = /* glsl */`${PRECISION}
in vec3 position; in vec3 normal; in vec2 aPC;
in vec4 aS0, aS1;
uniform mat4 viewMatrix, projectionMatrix;
uniform sampler2D tPath, tPathY;
uniform vec3 uOrigin, uCam;
uniform float uTime;
uniform vec4 uPeople;
#ifndef DEPTH_ONLY
out vec3 vNormal; out vec3 vColor; out vec3 vWorld; out vec2 vMeta;
#endif
const float HIP = 0.90, KNEE = 0.475, SHO = 1.40, ELB = 1.125;
float hash(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
vec2 pathAt(float i) {
  int ii = max(0, int(floor(i + 0.5)));
  vec4 t = texelFetch(tPath, ivec2(ii % ${PEOPLE.TEXW}, ii / ${PEOPLE.TEXW}), 0) * 255.0;
  return (vec2(t.r * 256.0 + t.g, t.b * 256.0 + t.a) / 65535.0 * 2.0 - 1.0) * ${PEOPLE.RANGE}.0;
}
vec2 pathYAt(float i) {
  int ii = max(0, int(floor(i + 0.5)));
  vec4 t = texelFetch(tPathY, ivec2(ii % ${PEOPLE.TEXW}, ii / ${PEOPLE.TEXW}), 0);
  float y = (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * ${(PEOPLE.YMAX - PEOPLE.YMIN).toFixed(1)} + ${(PEOPLE.YMIN).toFixed(1)};
  return vec2(y, t.b); // x = DEM height, y = smooth latScale [0..1]
}
void rz(inout vec3 p, float a) { float c = cos(a), s = sin(a); p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
void main() {
  float n = aS0.y, N = aS0.w, D = n / N, pace = abs(aS1.x);
  float adv = (uTime * pace + aS1.y) / D, sh = floor(adv), fr = adv - sh;
  // Exact 32-bit integer modulo eliminates float32 mod() rounding teleports at slot handoffs!
  int iN = max(1, int(floor(N + 0.5)));
  int iWho = (int(floor(aS0.z + 0.5)) - int(sh)) % iN;
  if (iWho < 0) iWho += iN;
  float who = float(iWho);
  float seed = fract(aS1.w), kind = floor(aS1.w);
  float id = who * 1.37 + seed * 917.0 + aS0.x * 0.013;
  float h1 = hash(id), h2 = hash(id + 3.1), h3 = hash(id + 7.7), h4 = hash(id + 13.3), h5 = hash(id + 19.9), h6 = hash(id + 29.3), h7 = hash(id + 37.1);
  float f = (aS0.z + fr + (h1 - 0.5) * 0.55) * D;
  if (aS1.x < 0.0) f = n - f;
  // Safe [0, n) wrap prevents float32 mod(-eps, n) == n from reading the next loop's texel!
  f = f - n * floor(f / n);
  if (f >= n || f < 0.0) f = 0.0;
  float i0 = min(floor(f), n - 1.0), t = clamp(f - i0, 0.0, 1.0);
  float i1 = (i0 + 1.0 >= n) ? 0.0 : i0 + 1.0;
  float im = (i0 < 1.0) ? n - 1.0 : i0 - 1.0;
  float i2 = (i1 + 1.0 >= n) ? 0.0 : i1 + 1.0;
  vec2 pm = pathAt(aS0.x + im), p0 = pathAt(aS0.x + i0), p1 = pathAt(aS0.x + i1), p2 = pathAt(aS0.x + i2);
  vec2 y0 = pathYAt(aS0.x + i0), y1 = pathYAt(aS0.x + i1);
  float py = mix(y0.x, y1.x, t);
  float latScale = mix(y0.y, y1.y, t);
  vec2 P = mix(p0, p1, t);
  // Turnaround-safe tangent (stays unit length cleanly even at 180-deg ping-pong apexes!)
  vec2 dCur = p1 - p0;
  vec2 tgCur = length(dCur) > 1e-4 ? normalize(dCur) : vec2(1.0, 0.0);
  vec2 dPrev = p0 - pm;
  vec2 tgPrev = length(dPrev) > 1e-4 ? normalize(dPrev) : tgCur;
  vec2 dNext = p2 - p1;
  vec2 tgNext = length(dNext) > 1e-4 ? normalize(dNext) : tgCur;
  vec2 tA = dot(tgPrev, tgCur) > -0.35 ? normalize(tgPrev + tgCur) : tgCur;
  vec2 tB = dot(tgCur, tgNext) > -0.35 ? normalize(tgCur + tgNext) : tgCur;
  vec2 tg = dot(tA, tB) > -0.35 ? normalize(mix(tA, tB, t)) : tgCur;
  if (aS1.x < 0.0) tg = -tg;
  vec2 rt = vec2(-tg.y, tg.x);
  // Wall-safe lateral spread (<= +-0.35m, smoothly tapered to 0 at corners & ping-pong turnarounds -> ZERO whips or wall clips!)
  float latOff = latScale * ((kind > 2.5 ? 0.08 : kind > 0.5 ? 0.14 : 0.10) + (h2 - 0.5) * (kind > 2.5 ? 0.18 : kind > 0.5 ? 0.38 : 0.26));
  P += rt * latOff;
  vec3 base = uOrigin + vec3(P.x, py, P.y);
  float dc = distance(base, uCam);
  bool show = h3 < aS1.z * uPeople.x && dc < uPeople.z && distance(base.xz, uCam.xz) > 0.75;
  float speed = pace * ${PEOPLE.DS.toFixed(1)};
  float gait = (uTime * speed + h1 * 40.0) * (6.2832 / 1.45), sw = sin(gait), cw = cos(gait);
  vec3 p = position, nr = normal;
  float part = aPC.x, code = aPC.y;
  float side = (part < 2.5 || (part > 4.5 && part < 6.5)) ? 1.0 : -1.0;
  if (part > 0.5 && part < 4.5) {
    float hip = 0.38 * sw * side, knee = 0.90 * max(0.0, cw * side);
    if (part > 1.5 && part < 2.5 || part > 3.5) { p.y -= KNEE; rz(p, -knee); rz(nr, -knee); p.y += KNEE; }
    p.y -= HIP; rz(p, hip); rz(nr, hip); p.y += HIP;
  } else if (part > 4.5) {
    float sho = -0.34 * sw * side, elb = 0.26 + 0.24 * max(0.0, -sw * side);
    if (part > 5.5 && part < 6.5 || part > 7.5) { p.y -= ELB; rz(p, elb); rz(nr, elb); p.y += ELB; }
    p.y -= SHO; rz(p, sho); rz(nr, sho); p.y += SHO;
  }
  p.y += 0.015 * cos(2.0 * gait);
  rz(p, -0.035); rz(nr, -0.035);
  // Accessory & hairstyle variety
  if (code > 4.5 && code < 5.5 && h6 > 0.28) show = false;               // backpack (~28%)
  if (code > 11.5 && (h6 <= 0.28 || h6 > 0.54)) show = false;            // shoulder tote bag (~26%)
  if (code > 10.5 && code < 11.5 && h4 < 0.52) show = false;             // longer hair / ponytail (~48%)
  if (code > 6.5 && code < 7.5 && !(uPeople.y > 0.25 && h7 < 0.82)) show = false; // rain umbrella
  float tall = 0.90 + 0.155 * h4, wide = tall * (0.91 + 0.19 * h5);
  if (code > 6.5 && code < 7.5) wide = tall;
  float localY = p.y;
  p *= vec3(wide, tall, wide);
  vec3 wp = base + vec3(tg.x * p.x + rt.x * p.z, p.y, tg.y * p.x + rt.y * p.z);
  gl_Position = show ? projectionMatrix * (viewMatrix * vec4(wp, 1.0)) : vec4(2.0, 2.0, 2.0, 1.0);
#ifndef DEPTH_ONLY
  vWorld = wp;
  vNormal = vec3(tg.x * nr.x + rt.x * nr.z, nr.y, tg.y * nr.x + rt.y * nr.z);
  vMeta = vec2(code, localY);
  // Authentic contemporary Chongqing urban fashion palette (coats, denim, knits, earthy neutrals, muted reds & blues)
  vec3 top = h5 < 0.18 ? vec3(0.032, 0.034, 0.040) : h5 < 0.32 ? vec3(0.58, 0.57, 0.54) : h5 < 0.44 ? vec3(0.07, 0.11, 0.22)
           : h5 < 0.54 ? vec3(0.22, 0.23, 0.24) : h5 < 0.62 ? vec3(0.38, 0.07, 0.06) : h5 < 0.70 ? vec3(0.42, 0.34, 0.22)
           : h5 < 0.78 ? vec3(0.11, 0.21, 0.15) : h5 < 0.86 ? vec3(0.44, 0.28, 0.30) : h5 < 0.93 ? vec3(0.16, 0.28, 0.42)
           : vec3(0.54, 0.42, 0.14);
  vec3 bottom = h6 < 0.38 ? vec3(0.028, 0.030, 0.036) : h6 < 0.68 ? vec3(0.055, 0.088, 0.175) : h6 < 0.82 ? vec3(0.16, 0.16, 0.17)
              : h6 < 0.93 ? vec3(0.34, 0.29, 0.21) : vec3(0.46, 0.45, 0.42);
  vec3 skin = mix(vec3(0.58, 0.41, 0.31), vec3(0.70, 0.53, 0.42), h2);
  vec3 hair = h7 > 0.93 ? vec3(0.28, 0.28, 0.28) : mix(vec3(0.012, 0.011, 0.010), vec3(0.055, 0.036, 0.024), h4);
  vec3 bagCol = h2 < 0.35 ? vec3(0.04, 0.04, 0.045) : h2 < 0.65 ? vec3(0.26, 0.17, 0.10) : vec3(0.52, 0.46, 0.38);
  vec3 col = code < 0.5 ? skin
           : code < 1.5 ? top
           : code < 2.5 ? bottom
           : code < 3.5 ? hair
           : code < 4.5 ? (h1 < 0.36 ? vec3(0.56, 0.55, 0.53) : vec3(0.035, 0.035, 0.04))
           : code < 5.5 ? bagCol
           : code < 6.5 ? (fract(h3 * 7.0) < 0.26 ? skin : top)
           : code < 7.5 ? (h4 < 0.35 ? vec3(0.03, 0.03, 0.04) : h4 < 0.6 ? vec3(0.08, 0.12, 0.30) : h4 < 0.8 ? vec3(0.50, 0.07, 0.07) : vec3(0.58, 0.54, 0.42))
           : code < 8.5 ? (fract(h7 * 5.0) < 0.42 ? top * 0.92 : bottom)
           : code < 9.5 ? vec3(0.68, 0.67, 0.64)          // light sneaker outsole
           : code < 10.5 ? mix(top, vec3(0.72, 0.70, 0.66), 0.38) // jacket collar / inner shirt
           : code < 11.5 ? hair                           // longer hair / ponytail
           : bagCol;                                      // shoulder tote bag
  vColor = col;
#endif
}`;

const FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
in vec3 vNormal; in vec3 vColor; in vec3 vWorld; in vec2 vMeta;
void main() {
  Surface s = defaultSurface();
  float code = vMeta.x, ly = vMeta.y;
  // Subtle micro-weave cloth variation & contact crevice darkening (collar, under-chin, jacket hem)
  float weave = vnoise(vWorld.xz * 26.0 + vWorld.y * 22.0);
  float crease = smoothstep(0.0, 0.08, abs(ly - 0.79)) * smoothstep(0.0, 0.06, abs(ly - 1.44));
  vec3 c = vColor * (0.93 + 0.14 * weave) * mix(0.84, 1.0, crease);
  float rough = 0.86;
  if (code < 0.5) rough = 0.58;                         // skin
  else if ((code > 2.5 && code < 3.5) || (code > 10.5 && code < 11.5)) rough = 0.44; // hair sheen
  else if (code > 3.5 && code < 4.5) rough = 0.38;      // shoes
  else if (code > 6.5 && code < 7.5) rough = 0.24;      // wet nylon umbrella
  s.albedo = c;
  s.normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  s.roughness = rough; s.reflectance = 0.42;
  s.ao = mix(0.76, 1.0, crease);
  s.model = 128.0;
  writeGBuffer(s);
}`;
const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }`;

const hourFactor = (h) => {
  const P = [[0, 0.16], [4, 0.08], [7, 0.55], [9, 0.9], [12, 1.0], [18, 1.05], [21.5, 1.0], [23, 0.65], [24, 0.16]];
  for (let i = 0; i + 1 < P.length; i++) if (h <= P[i + 1][0]) return P[i][1] + (P[i + 1][1] - P[i][1]) * (h - P[i][0]) / (P[i + 1][0] - P[i][0]);
  return 0.16;
};

export class PeopleLayer {
  constructor({ scenes, env, terrain }) {
    this.scenes = scenes; this.env = env; this.terrain = terrain;
    this.geo = [bodyGeometry(0), bodyGeometry(1)];
    this.tiles = new Map();
    this.uPeople = { value: new THREE.Vector4(1, 0, 270, 0) };
    this.uCam = { value: new THREE.Vector3() };
    this.shown = 0; this._t = 0;
  }

  _material(tex, texY, origin, depth) {
    const uniforms = { tPath: { value: tex }, tPathY: { value: texY }, uOrigin: { value: origin }, uCam: this.uCam, uTime: this.env.uniforms.uTime, uPeople: this.uPeople };
    if (depth) { const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: DEPTH_FRAG, uniforms, defines: { DEPTH_ONLY: 1 }, colorWrite: false, side: THREE.DoubleSide }); m.name = 'people-depth'; return m; }
    return gbufferMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: THREE.DoubleSide, name: 'people' });
  }

  addTile(key, t, d) {
    if (!d || this.tiles.has(key)) return;
    const tex = new THREE.DataTexture(d.path, d.w, d.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const texY = new THREE.DataTexture(d.pathY || new Uint8Array(d.w * d.h * 4), d.w, d.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    texY.minFilter = texY.magFilter = THREE.NearestFilter; texY.generateMipmaps = false; texY.needsUpdate = true;
    const origin = new THREE.Vector3(t.x, 0, t.z);
    const mat = this._material(tex, texY, origin, false), dep = this._material(tex, texY, origin, true);
    const cells = [];
    for (let c = 0; c < d.cells.length; c += 5) {
      const first = d.cells[c + 3], count = d.cells[c + 4];
      const s0 = new THREE.InstancedBufferAttribute(d.a0.subarray(first * 4, (first + count) * 4), 4);
      const s1 = new THREE.InstancedBufferAttribute(d.a1.subarray(first * 4, (first + count) * 4), 4);
      const cx = t.x + d.cells[c], cy = d.cells[c + 1], cz = t.z + d.cells[c + 2];
      const mk = (base, material, scene) => {
        const g = new THREE.InstancedBufferGeometry();
        g.index = base.index; for (const name of ['position', 'normal', 'aPC']) g.setAttribute(name, base.attributes[name]);
        g.setAttribute('aS0', s0); g.setAttribute('aS1', s1); g.instanceCount = count;
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), 180);
        const m = new THREE.Mesh(g, material); m.matrixAutoUpdate = false; m.visible = false; scene.add(m);
        return m;
      };
      const hi = mk(this.geo[0], mat, this.scenes.opaque), lo = mk(this.geo[1], mat, this.scenes.opaque), sh = mk(this.geo[1], dep, this.scenes.moving);
      cells.push({ cx, cy, cz, hi, lo, sh, count });
    }
    this.tiles.set(key, { tex, texY, mat, dep, cells, count: d.count });
    this._t = 0;
  }

  removeTile(key) {
    const o = this.tiles.get(key);
    if (!o) return;
    for (const c of o.cells) for (const m of [c.hi, c.lo, c.sh]) {
      m.parent && m.parent.remove(m);
      const g = m.geometry; g.index = null; for (const name of ['position', 'normal', 'aPC']) g.deleteAttribute(name); g.dispose();
    }
    o.tex.dispose(); o.texY.dispose(); o.mat.dispose(); o.dep.dispose();
    this.tiles.delete(key);
  }

  update(dt, camera, hour, wet, shadows) {
    const p = camera.position;
    this.uCam.value.copy(p);
    this.uPeople.value.set(hourFactor(((hour % 24) + 24) % 24) * (1 - 0.35 * Math.min(1, wet * 1.4)), wet, 270, 0);
    this._t -= dt;
    if (this._t > 0 && Math.abs(p.x - (this._px || 0)) + Math.abs(p.z - (this._pz || 0)) < 6) return;
    this._t = 0.25; this._px = p.x; this._pz = p.z;
    const groundY = this.terrain ? Math.max(this.terrain.sample(p.x, p.z), 0) : 0;
    const agl = Math.max(0, p.y - groundY);
    const far = agl > 420 ? 0 : 270 + 165, near = agl > 160 ? 0 : 48 + 165, shd = shadows ? 115 + 165 : 0;
    let n = 0;
    for (const o of this.tiles.values()) for (const c of o.cells) {
      const d = Math.hypot(c.cx - p.x, c.cz - p.z);
      const hi = d < near, lo = !hi && d < far;
      c.hi.visible = hi; c.lo.visible = lo; c.sh.visible = d < shd;
      if (hi || lo) n += c.count;
    }
    this.shown = n;
  }
}
