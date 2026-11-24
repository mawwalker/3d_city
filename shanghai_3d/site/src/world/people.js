// Pedestrians: instanced figures walking the tile's loops (see peopleGeom.js for the conveyor scheme).
// Everything moves in the vertex shader: where the walker is along the loop, who it is (height, build, clothes, bag,
// umbrella in the rain) and the gait (hips, knees, shoulders, elbows swinging with the distance walked).

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { gbufferMaterial } from '../engine/materials.js';
import { PEOPLE } from './peopleGeom.js';

// ---- the figure: +x forward, y up, 1.72 m tall. Per vertex: part (which joint moves it) and colour code -----------------
// parts: 0 trunk and head, 1 / 3 thighs, 2 / 4 shins and shoes, 5 / 7 upper arms, 6 / 8 forearms and hands
// codes: 0 skin, 1 top, 2 trousers, 3 hair, 4 shoes, 5 bag, 6 forearm (sleeve or skin), 7 umbrella, 8 hips (trousers, or a long coat)
class Body {
  constructor() { this.p = []; this.n = []; this.pc = []; this.i = []; this.nv = 0; }
  v(x, y, z, nx, ny, nz, part, code) { this.p.push(x, y, z); const l = Math.hypot(nx, ny, nz) || 1; this.n.push(nx / l, ny / l, nz / l); this.pc.push(part, code); return this.nv++; }
  /** upright tube from A (lower) to B with elliptical sections [rx, rz] */
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
  /** cone from a rim (radius r at height y0) up to an apex; inside too */
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

function bodyGeometry(lod) {
  const S = lod ? 4 : 8, b = new Body();
  b.tube([0, 0.78, 0], [0, 0.94, 0], [0.118, 0.172], [0.118, 0.172], S, 0, 8, true, false);              // hips (trousers, or the skirt of a coat)
  b.tube([0, 0.92, 0], [0, 1.16, 0], [0.118, 0.172], [0.108, 0.158], S, 0, 1, false, false);             // waist
  b.tube([0, 1.16, 0], [0, 1.42, 0], [0.108, 0.158], [0.122, 0.186], S, 0, 1, false, true);              // chest
  if (!lod) b.ellipsoid([0, 1.405, 0], [0.115, 0.06, 0.21], 8, 4, 0, 1);                                 // shoulders
  b.tube([0, 1.41, 0], [0, 1.53, 0], [0.050, 0.050], [0.046, 0.046], lod ? 4 : 6, 0, 0);                 // neck
  b.ellipsoid([0.010, 1.615, 0], [0.098, 0.118, 0.088], lod ? 5 : 9, lod ? 3 : 6, 0, 0);                 // head
  b.ellipsoid([-0.018, 1.645, 0], [0.108, 0.106, 0.096], lod ? 5 : 9, lod ? 3 : 6, 0, 3);                // hair, back and up: the face stays clear
  for (const [sg, pt] of [[1, 1], [-1, 3]]) {
    const z = sg * 0.085;
    b.tube([0, 0.47, z], [0, 0.92, z], [0.066, 0.064], [0.096, 0.086], S, pt, 2);                        // thigh
    b.tube([0, 0.07, z], [0, 0.48, z], [0.047, 0.045], [0.064, 0.062], S, pt + 1, 2);                    // shin
    b.box([0.05, 0.042, z], [0.26, 0.085, 0.10], pt + 1, 4);                                             // shoe
  }
  for (const [sg, pt] of [[1, 5], [-1, 7]]) {
    const z = sg * 0.214;
    b.tube([0, 1.12, z], [0, 1.40, z], [0.043, 0.043], [0.056, 0.054], S, pt, 1, false, true);           // upper arm
    b.tube([0, 0.87, z], [0, 1.13, z], [0.033, 0.033], [0.043, 0.043], S, pt + 1, 6);                    // forearm
    b.box([0.005, 0.81, z], [0.08, 0.11, 0.05], pt + 1, 0);                                              // hand
  }
  b.box([-0.175, 1.20, 0], [0.13, 0.36, 0.27], 0, 5);                                                    // rucksack
  b.cone([0.05, 0, 0.10], 0.56, 1.93, 2.10, lod ? 5 : 8, 0, 7);                                          // umbrella
  b.tube([0.05, 1.10, 0.10], [0.05, 2.10, 0.10], [0.008, 0.008], [0.008, 0.008], 4, 0, 7);
  return b.geometry();
}

const VERT = /* glsl */`${PRECISION}
in vec3 position; in vec3 normal; in vec2 aPC;
in vec4 aS0, aS1;
uniform mat4 viewMatrix, projectionMatrix;
uniform sampler2D tPath;
uniform vec3 uOrigin, uCam;
uniform float uTime;
uniform vec4 uPeople;            // x: how many are out (0..1), y: rain (umbrellas up), z: farthest distance drawn
#ifndef DEPTH_ONLY
out vec3 vNormal; out vec3 vColor; out vec3 vWorld;
#endif
const float HIP = 0.90, KNEE = 0.475, SHO = 1.41, ELB = 1.125;
float hash(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
vec2 pathAt(float i) {
  vec4 t = texelFetch(tPath, ivec2(int(mod(i, ${PEOPLE.TEXW}.0)), int(floor(i / ${PEOPLE.TEXW}.0))), 0) * 255.0;
  return (vec2(t.r * 256.0 + t.g, t.b * 256.0 + t.a) / 65535.0 * 2.0 - 1.0) * ${PEOPLE.RANGE}.0;
}
void rz(inout vec3 p, float a) { float c = cos(a), s = sin(a); p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
void main() {
  float n = aS0.y, N = aS0.w, D = n / N, pace = abs(aS1.x);
  float adv = (uTime * pace + aS1.y) / D, sh = floor(adv), fr = adv - sh;
  float who = mod(aS0.z - sh, N);                       // the walker this slot shows now
  float seed = fract(aS1.w), kind = floor(aS1.w);
  float id = who * 1.37 + seed * 917.0 + aS0.x * 0.013;
  float h1 = hash(id), h2 = hash(id + 3.1), h3 = hash(id + 7.7), h4 = hash(id + 13.3), h5 = hash(id + 19.9), h6 = hash(id + 29.3), h7 = hash(id + 37.1);
  float f = (aS0.z + fr + (h1 - 0.5) * 0.6) * D;
  if (aS1.x < 0.0) f = n - f;
  f = mod(f, n);
  float i0 = floor(f), t = f - i0;
  vec2 pm = pathAt(aS0.x + mod(i0 - 1.0 + n, n)), p0 = pathAt(aS0.x + i0), p1 = pathAt(aS0.x + mod(i0 + 1.0, n)), p2 = pathAt(aS0.x + mod(i0 + 2.0, n));
  vec2 P = mix(p0, p1, t);
  vec2 tg = normalize(mix(p1 - pm, p2 - p0, t) + vec2(1e-5, 0.0));
  if (aS1.x < 0.0) tg = -tg;
  vec2 rt = vec2(-tg.y, tg.x);                          // right of travel (x east, z south)
  // keep right; on a pavement the band is narrow (kerb furniture on one side, walls on the other), on a square people spread out
  P += rt * ((kind > 2.5 ? 0.2 : kind > 0.5 ? 0.45 : 0.3) + (h2 - 0.5) * (kind > 2.5 ? 0.3 : kind > 0.5 ? 1.4 : 0.5));
  vec3 base = uOrigin + vec3(P.x, 0.15, P.y);
  float dc = distance(base, uCam);
  bool show = h3 < aS1.z * uPeople.x && dc < uPeople.z && distance(base.xz, uCam.xz) > 1.1;      // (nobody walks through the viewer's head)
  // the gait: one stride (two steps) every 1.45 m walked
  float speed = pace * ${PEOPLE.DS.toFixed(1)};
  float gait = (uTime * speed + h1 * 40.0) * (6.2832 / 1.45), sw = sin(gait), cw = cos(gait);
  vec3 p = position, nr = normal;
  float part = aPC.x, code = aPC.y;
  float side = (part < 2.5 || (part > 4.5 && part < 6.5)) ? 1.0 : -1.0;
  if (part > 0.5 && part < 4.5) {
    float hip = 0.40 * sw * side, knee = 0.95 * max(0.0, cw * side);
    if (part > 1.5 && part < 2.5 || part > 3.5) { p.y -= KNEE; rz(p, -knee); rz(nr, -knee); p.y += KNEE; }
    p.y -= HIP; rz(p, hip); rz(nr, hip); p.y += HIP;
  } else if (part > 4.5) {
    float sho = -0.36 * sw * side, elb = 0.28 + 0.26 * max(0.0, -sw * side);
    if (part > 5.5 && part < 6.5 || part > 7.5) { p.y -= ELB; rz(p, elb); rz(nr, elb); p.y += ELB; }
    p.y -= SHO; rz(p, sho); rz(nr, sho); p.y += SHO;
  }
  p.y += 0.016 * cos(2.0 * gait);
  rz(p, -0.04); rz(nr, -0.04);                           // leaning into the walk
  // bag for some, umbrella for most when it rains
  if (code > 4.5 && code < 5.5 && h6 > 0.32) show = false;
  if (code > 6.5 && code < 7.5 && !(uPeople.y > 0.25 && h7 < 0.8)) show = false;
  float tall = 0.90 + 0.155 * h4, wide = tall * (0.92 + 0.2 * h5);
  if (code > 6.5 && code < 7.5) wide = tall;
  p *= vec3(wide, tall, wide);
  vec3 wp = base + vec3(tg.x * p.x + rt.x * p.z, p.y, tg.y * p.x + rt.y * p.z);
  gl_Position = show ? projectionMatrix * (viewMatrix * vec4(wp, 1.0)) : vec4(2.0, 2.0, 2.0, 1.0);
#ifndef DEPTH_ONLY
  vWorld = wp;
  vNormal = vec3(tg.x * nr.x + rt.x * nr.z, nr.y, tg.y * nr.x + rt.y * nr.z);
  // clothes
  vec3 top = h5 < 0.16 ? vec3(0.03, 0.03, 0.035) : h5 < 0.30 ? vec3(0.62, 0.62, 0.60) : h5 < 0.42 ? vec3(0.07, 0.10, 0.22) : h5 < 0.52 ? vec3(0.22, 0.23, 0.25) : h5 < 0.60 ? vec3(0.36, 0.05, 0.05)
           : h5 < 0.68 ? vec3(0.45, 0.36, 0.22) : h5 < 0.76 ? vec3(0.10, 0.22, 0.14) : h5 < 0.84 ? vec3(0.50, 0.30, 0.34) : h5 < 0.92 ? vec3(0.16, 0.30, 0.46) : vec3(0.58, 0.44, 0.08);
  vec3 bottom = h6 < 0.38 ? vec3(0.025, 0.028, 0.035) : h6 < 0.66 ? vec3(0.05, 0.08, 0.16) : h6 < 0.80 ? vec3(0.16, 0.16, 0.17) : h6 < 0.92 ? vec3(0.34, 0.29, 0.20) : vec3(0.50, 0.50, 0.48);
  vec3 skin = mix(vec3(0.60, 0.42, 0.31), vec3(0.72, 0.54, 0.43), h2);
  vec3 hair = h7 > 0.93 ? vec3(0.30, 0.30, 0.30) : mix(vec3(0.012, 0.011, 0.010), vec3(0.06, 0.04, 0.03), h4);
  vec3 col = code < 0.5 ? skin : code < 1.5 ? top : code < 2.5 ? bottom : code < 3.5 ? hair : code < 4.5 ? (h1 < 0.4 ? vec3(0.55) : vec3(0.03)) : code < 5.5 ? mix(vec3(0.04, 0.04, 0.05), top.gbr, 0.5)
           : code < 6.5 ? (fract(h3 * 7.0) < 0.3 ? skin : top) : code < 7.5 ? (h4 < 0.35 ? vec3(0.03, 0.03, 0.04) : h4 < 0.6 ? vec3(0.08, 0.12, 0.30) : h4 < 0.8 ? vec3(0.45, 0.07, 0.07) : vec3(0.55, 0.55, 0.50))
           : (fract(h7 * 5.0) < 0.3 ? top : bottom);
  vColor = col;
#endif
}`;

const FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
in vec3 vNormal; in vec3 vColor; in vec3 vWorld;
void main() {
  Surface s = defaultSurface();
  s.albedo = vColor;
  s.normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  s.roughness = 0.82; s.reflectance = 0.4;
  s.model = 128.0;                       // moving: the temporal filter keeps it sharp
  writeGBuffer(s);
}`;
const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }`;

const hourFactor = (h) => { const P = [[0, 0.08], [5, 0.06], [7, 0.55], [9, 0.9], [12, 1.0], [18, 1.0], [20, 0.9], [22, 0.5], [24, 0.08]];
  for (let i = 0; i + 1 < P.length; i++) if (h <= P[i + 1][0]) return P[i][1] + (P[i + 1][1] - P[i][1]) * (h - P[i][0]) / (P[i + 1][0] - P[i][0]); return 0.08; };

export class PeopleLayer {
  constructor({ scenes, env }) {
    this.scenes = scenes; this.env = env;
    this.geo = [bodyGeometry(0), bodyGeometry(1)];
    this.tiles = new Map();
    this.uPeople = { value: new THREE.Vector4(1, 0, 270, 0) };
    this.uCam = { value: new THREE.Vector3() };
    this.shown = 0; this._t = 0;
  }

  _material(tex, origin, depth) {
    const uniforms = { tPath: { value: tex }, uOrigin: { value: origin }, uCam: this.uCam, uTime: this.env.uniforms.uTime, uPeople: this.uPeople };
    if (depth) { const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: DEPTH_FRAG, uniforms, defines: { DEPTH_ONLY: 1 }, colorWrite: false, side: THREE.DoubleSide }); m.name = 'people-depth'; return m; }
    return gbufferMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: THREE.DoubleSide, name: 'people' });
  }

  /** t: the tile (x, z of its centre); d: buildPeople() output */
  addTile(key, t, d) {
    if (!d || this.tiles.has(key)) return;
    const tex = new THREE.DataTexture(d.path, d.w, d.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const origin = new THREE.Vector3(t.x, 0, t.z);
    const mat = this._material(tex, origin, false), dep = this._material(tex, origin, true);
    const cells = [];
    for (let c = 0; c < d.cells.length; c += 4) {
      const first = d.cells[c + 2], count = d.cells[c + 3];
      const s0 = new THREE.InstancedBufferAttribute(d.a0.subarray(first * 4, (first + count) * 4), 4), s1 = new THREE.InstancedBufferAttribute(d.a1.subarray(first * 4, (first + count) * 4), 4);
      const cx = t.x + d.cells[c], cz = t.z + d.cells[c + 1];
      const mk = (base, material, scene) => {
        const g = new THREE.InstancedBufferGeometry();
        g.index = base.index; for (const name of ['position', 'normal', 'aPC']) g.setAttribute(name, base.attributes[name]);
        g.setAttribute('aS0', s0); g.setAttribute('aS1', s1); g.instanceCount = count;
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 1, cz), 150);
        const m = new THREE.Mesh(g, material); m.matrixAutoUpdate = false; m.visible = false; scene.add(m);
        return m;
      };
      const hi = mk(this.geo[0], mat, this.scenes.opaque), lo = mk(this.geo[1], mat, this.scenes.opaque), sh = mk(this.geo[1], dep, this.scenes.moving);
      cells.push({ cx, cz, hi, lo, sh, count });
    }
    this.tiles.set(key, { tex, mat, dep, cells, count: d.count });
    this._t = 0;
  }

  removeTile(key) {
    const o = this.tiles.get(key);
    if (!o) return;
    for (const c of o.cells) for (const m of [c.hi, c.lo, c.sh]) {
      m.parent && m.parent.remove(m);
      const g = m.geometry; g.index = null; for (const name of ['position', 'normal', 'aPC']) g.deleteAttribute(name); g.dispose();
    }
    o.tex.dispose(); o.mat.dispose(); o.dep.dispose();
    this.tiles.delete(key);
  }

  update(dt, camera, hour, wet, shadows) {
    const p = camera.position;
    this.uCam.value.copy(p);
    this.uPeople.value.set(hourFactor(((hour % 24) + 24) % 24) * (1 - 0.45 * Math.min(1, wet * 1.5)), wet, 270, 0);
    this._t -= dt;
    if (this._t > 0 && Math.abs(p.x - (this._px || 0)) + Math.abs(p.z - (this._pz || 0)) < 6) return;
    this._t = 0.25; this._px = p.x; this._pz = p.z;
    // from high up people are specks: none drawn
    const far = p.y > 420 ? 0 : 270 + 90, near = p.y > 150 ? 0 : 42 + 90, shd = shadows ? 115 + 90 : 0;
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
