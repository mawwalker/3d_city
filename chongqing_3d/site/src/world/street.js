// 3D Terrain-Draped Street Dressing & Authentic Chongqing Street Clutter:
//   - Weathered thermoplastic lane markings & zebra crosswalks
//   - Tapered fluted street lamps, traffic signals, slope-aligned parked cars
//   - Chinese white/gold arterial road guardrails (渝式护栏) + hillside drop railings
//   - Sculpted granite sidewalk bollards (石墩), Chongqing twin classification trash bins, street utility cabinets
//   - Modern glass & brushed-steel Chongqing bus shelters with warm backlit night panels!

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { decalMaterial, kitMaterial, depthMaterial } from '../engine/materials.js';
import { Kit } from './kit.js';
import { KINDS } from './vehicles.js';

const DECAL_VERT = /* glsl */`${PRECISION}
in vec3 aPos; in vec3 aUv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vUv; out vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(aPos, 1.0); vWorld = w.xyz; vUv = aUv; gl_Position = projectionMatrix * (viewMatrix * w); }`;

const DECAL_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
in vec3 vUv; in vec3 vWorld;
void main() {
  int type = int(vUv.z + 0.5);
  float across = vUv.x, along = vUv.y;
  float a = 1.0; vec3 c = vec3(0.68, 0.67, 0.63);
  if (type == 1) a = step(fract(along / 6.0), 0.3334);
  else if (type == 2) { a = step(0.085, abs(across)); c = vec3(0.72, 0.48, 0.05); }
  else if (type == 3) { a = step(fract(along / 10.0), 0.4); c = vec3(0.72, 0.48, 0.05); }
  else if (type == 4) a = step(fract(across / 1.0 + 0.25), 0.46);
  // Photographic weathered thermoplastic paint: tire scuffing + asphalt aggregate chipping along wheel paths
  float scuff = vnoise(vWorld.xz * 2.1) * 0.50 + vnoise(vWorld.xz * 9.5) * 0.32 + vnoise(vWorld.xz * 24.0) * 0.18;
  a *= mix(0.42, 1.0, smoothstep(0.24, 0.66, scuff));
  c *= 0.80 + 0.28 * vnoise(vWorld.xz * 0.9) - 0.10 * smoothstep(0.55, 0.9, vnoise(vWorld.xz * 5.2));
  if (a < 0.02) discard;
  writeDecal(c, a);
}`;

function lampGeometry(tall) {
  const k = new Kit();
  const H = tall ? 9.6 : 6.6, arm = tall ? 2.3 : 1.3;
  // Cast-iron decorative base flange & ribbed lower plinth
  k.color(0.22, 0.23, 0.25).material(0.42, 0.78);
  k.tube([0, -0.65, 0], [0, 0.22, 0], 0.19, 0.17, 10, true);
  k.tube([0, 0.22, 0], [0, 0.95, 0], 0.15, 0.115, 10, true);
  k.color(0.32, 0.34, 0.36).material(0.42, 0.82);
  k.tube([0, 0.95, 0], [0, H - 0.4, 0], 0.098, 0.064, 10, false);
  const pts = [[0, H - 0.4, 0], [arm * 0.15, H - 0.04, 0], [arm * 0.55, H + 0.22, 0], [arm, H + 0.25, 0]];
  for (let i = 0; i + 1 < pts.length; i++) k.tube(pts[i], pts[i + 1], 0.058 - i * 0.008, 0.050 - i * 0.008, 8, false);
  // Sculpted LED cobra-head luminaire housing with cooling fin cap
  k.color(0.24, 0.25, 0.28).material(0.36, 0.75);
  k.box(arm + 0.34, H + 0.25, 0, 0.84, 0.10, 0.32);
  k.box(arm + 0.22, H + 0.31, 0, 0.50, 0.04, 0.22);
  k.color(1.0, 0.85, 0.60).material(0.25, 0, -10.5);
  k.quad([arm, H + 0.19, -0.13], [arm + 0.68, H + 0.19, -0.13], [arm + 0.68, H + 0.19, 0.13], [arm, H + 0.19, 0.13]);
  return { geo: k.geometry(), head: [arm + 0.34, H + 0.15, 0] };
}

function signalGeometry() {
  const k = new Kit();
  k.color(0.16, 0.17, 0.19).material(0.46, 0.65);
  k.tube([0, -0.6, 0], [0, 0.35, 0], 0.17, 0.14, 10, true);
  k.tube([0, 0.35, 0], [0, 6.4, 0], 0.11, 0.085, 10, true);
  k.tube([0, 6.0, 0], [5.6, 6.25, 0], 0.07, 0.05, 8, true);
  for (const [x, y] of [[3.0, 5.95], [5.0, 6.05]]) {
    k.color(0.05, 0.05, 0.055).material(0.55, 0.25);
    k.box(x, y - 0.25, 0, 0.38, 1.08, 0.28);
    // Sun visors over each signal lens
    for (const dy of [0.33, 0.0, -0.33]) k.box(x, y - 0.25 + dy + 0.14, -0.22, 0.30, 0.03, 0.18);
    const lens = (dy, r, g, b, e) => { k.color(r, g, b).material(0.25, 0, e); k.quad([x + 0.12, y - 0.25 + dy - 0.12, -0.145], [x - 0.12, y - 0.25 + dy - 0.12, -0.145], [x - 0.12, y - 0.25 + dy + 0.12, -0.145], [x + 0.12, y - 0.25 + dy + 0.12, -0.145]); };
    lens(0.33, 1.0, 0.07, 0.04, 101); lens(0.0, 1.0, 0.62, 0.05, 102); lens(-0.33, 0.08, 1.0, 0.4, 103);
  }
  k.color(0.05, 0.05, 0.055).material(0.55, 0.25);
  k.box(0.22, 2.7, 0, 0.24, 0.54, 0.22);
  return k.geometry();
}

/** Chinese municipal arterial guardrail (kind 0: white/gold 渝式护栏) or Chongqing hillside drop railing (kind 1). 3.0m bay along X. */
function railGeometry(kind) {
  const k = new Kit();
  const L = 3.0;
  if (kind === 0) {
    // Weighted dark cast-iron base blocks (extend -0.22m below kerb so zero floating on hills)
    k.color(0.11, 0.12, 0.13).material(0.65, 0.35);
    for (const x of [-1.42, 1.42]) k.box(x, -0.04, 0, 0.22, 0.36, 0.28);
    // Crisp white painted steel frame (posts + top/mid/bottom rails)
    k.color(0.86, 0.87, 0.85).material(0.36, 0.32);
    for (const x of [-1.42, 1.42]) k.box(x, 0.58, 0, 0.068, 0.96, 0.068);
    k.box(0, 0.98, 0, L, 0.055, 0.055);
    k.box(0, 0.78, 0, L - 0.12, 0.036, 0.036);
    k.box(0, 0.18, 0, L - 0.12, 0.042, 0.042);
    // Vertical infill pickets
    for (let i = -4; i <= 4; i++) k.box(i * 0.30, 0.48, 0, 0.024, 0.60, 0.024);
    // Iconic Chinese gold accent medallion rings & post finials!
    k.color(0.82, 0.64, 0.18).material(0.26, 0.82);
    for (const x of [-0.75, 0.0, 0.75]) {
      k.box(x, 0.88, 0, 0.20, 0.14, 0.026);
    }
    for (const x of [-1.42, 1.42]) k.box(x, 1.09, 0, 0.088, 0.065, 0.088);
  } else {
    // Heavy Chongqing hillside pedestrian drop safety railing (dark charcoal-bronze posts + stainless handrail)
    k.color(0.16, 0.15, 0.14).material(0.48, 0.68);
    for (const x of [-1.45, 0.0, 1.45]) {
      k.box(x, 0.40, 0, 0.068, 1.48, 0.068); // extends -0.34m below slope
      k.box(x, 0.04, 0, 0.15, 0.05, 0.15);
    }
    k.box(0, 0.22, 0, L, 0.042, 0.042);
    k.box(0, 0.66, 0, L, 0.034, 0.034);
    for (let i = -5; i <= 5; i++) if (i !== 0) k.box(i * 0.26, 0.66, 0, 0.022, 0.88, 0.022);
    // Brushed stainless-steel top handrail
    k.color(0.68, 0.70, 0.72).material(0.24, 0.88);
    k.tube([-1.5, 1.12, 0], [1.5, 1.12, 0], 0.032, 0.032, 8, true);
  }
  return k.geometry();
}

/** Sculpted grey granite sidewalk bollard (石墩) with reflective safety band. */
function bollardGeometry() {
  const k = new Kit();
  k.color(0.46, 0.45, 0.43).material(0.68, 0.05);
  k.tube([0, -0.22, 0], [0, 0.06, 0], 0.155, 0.145, 10, true);
  k.color(0.56, 0.55, 0.52).material(0.62, 0.05);
  k.tube([0, 0.06, 0], [0, 0.56, 0], 0.122, 0.116, 10, false);
  // Recessed dark charcoal & reflective amber safety band
  k.color(0.12, 0.12, 0.13).material(0.42, 0.2);
  k.tube([0, 0.56, 0], [0, 0.63, 0], 0.110, 0.110, 10, false);
  k.color(0.88, 0.66, 0.12).material(0.28, 0.4, -0.4);
  k.tube([0, 0.575, 0], [0, 0.615, 0], 0.114, 0.114, 10, false);
  k.color(0.56, 0.55, 0.52).material(0.58, 0.05);
  k.tube([0, 0.63, 0], [0, 0.77, 0], 0.116, 0.112, 10, false);
  k.tube([0, 0.77, 0], [0, 0.83, 0], 0.112, 0.062, 10, true);
  return k.geometry();
}

/** Iconic Chinese twin classification sidewalk trash bin (分类垃圾桶). */
function binGeometry() {
  const k = new Kit();
  k.color(0.15, 0.16, 0.17).material(0.48, 0.65);
  k.box(0, -0.14, 0, 0.96, 0.42, 0.46); // deep grounded pedestal (never floats on hillside sidewalks!)
  // Left bin: Recyclable deep blue
  k.color(0.08, 0.24, 0.48).material(0.44, 0.35);
  k.box(-0.23, 0.48, 0, 0.40, 0.78, 0.38);
  // Right bin: Residual dark charcoal-green
  k.color(0.14, 0.22, 0.19).material(0.48, 0.30);
  k.box(0.23, 0.48, 0, 0.40, 0.78, 0.38);
  // Brushed stainless steel chute rims & arched rain canopy
  k.color(0.55, 0.57, 0.59).material(0.32, 0.78);
  for (const x of [-0.23, 0.23]) k.box(x, 0.78, 0.195, 0.30, 0.14, 0.025);
  k.color(0.18, 0.19, 0.20).material(0.42, 0.62);
  for (const x of [-0.46, 0.46]) k.box(x, 0.56, 0, 0.045, 1.05, 0.045);
  k.box(0, 1.08, 0, 1.02, 0.055, 0.50);
  return k.geometry();
}

/** Weathered steel street electrical / traffic control cabinet (配电箱). */
function cabinetGeometry() {
  const k = new Kit();
  k.color(0.42, 0.41, 0.39).material(0.84, 0);
  k.box(0, -0.10, 0, 1.02, 0.62, 0.62); // deep concrete plinth for hillside slopes
  k.color(0.44, 0.47, 0.44).material(0.52, 0.42);
  k.box(0, 0.86, 0, 0.94, 1.32, 0.54);
  // Recessed dark door seam & louver vents
  k.color(0.14, 0.15, 0.15).material(0.62, 0.3);
  k.box(0, 0.86, 0.275, 0.022, 1.18, 0.015);
  for (const y of [0.42, 0.50, 0.58, 1.24, 1.32]) k.box(-0.22, y, 0.275, 0.28, 0.032, 0.016);
  // Sloped rain hood
  k.color(0.34, 0.36, 0.35).material(0.48, 0.55);
  k.box(0, 1.54, 0, 1.00, 0.06, 0.60);
  return k.geometry();
}

/** Modern Chongqing glass & steel bus shelter (重庆公交候车亭, 5.4m wide, +Z faces street). */
function shelterGeometry() {
  const k = new Kit();
  // Dark brushed-steel structural columns & roof frame
  k.color(0.16, 0.18, 0.20).material(0.38, 0.78);
  for (const x of [-2.45, 0.45, 2.45]) k.box(x, 1.16, -0.52, 0.11, 2.95, 0.11); // extends -0.31m
  k.box(0, 2.62, 0.12, 5.55, 0.11, 1.62); // cantilevered roof beam frame
  k.box(-0.98, 2.42, -0.52, 3.0, 0.07, 0.07);
  k.box(-0.98, 0.26, -0.52, 3.0, 0.07, 0.07);
  // Smoked translucent canopy glass & rear windbreak glass
  k.color(0.08, 0.12, 0.15).material(0.12, 0.1, 0, 0.85);
  k.box(0, 2.67, 0.12, 5.35, 0.03, 1.44);
  k.box(-1.0, 1.35, -0.52, 2.84, 2.08, 0.03);
  // Backlit advertising & Chongqing bus-route lightbox (right bay x = 0.55..2.35)
  k.color(0.12, 0.13, 0.15).material(0.36, 0.72);
  k.box(1.45, 1.32, -0.48, 1.88, 2.18, 0.18);
  // Glowing warm poster panel (daytime cream poster, backlit warm glow at night!)
  k.color(0.84, 0.78, 0.68).material(0.24, 0, -3.6, 0.75);
  k.box(1.45, 1.34, -0.385, 1.66, 1.94, 0.02);
  k.box(1.45, 1.34, -0.575, 1.66, 1.94, 0.02);
  // Subtle Chongqing transit blue header strip on the shelter fascia
  k.color(0.08, 0.34, 0.62).material(0.32, 0.2, -1.8);
  k.box(-0.98, 2.54, 0.90, 3.0, 0.14, 0.03);
  // Under-canopy warm LED downlight strip
  k.color(1.0, 0.90, 0.70).material(0.25, 0, -5.2);
  k.box(0, 2.55, 0.05, 4.6, 0.02, 0.10);
  // Slatted warm timber & steel waiting bench
  k.color(0.18, 0.19, 0.21).material(0.40, 0.75);
  for (const x of [-1.95, -0.05]) k.box(x, 0.22, -0.18, 0.07, 0.48, 0.36);
  k.color(0.42, 0.26, 0.14).material(0.62, 0.05);
  for (const z of [-0.30, -0.18, -0.06]) k.box(-1.0, 0.47, z, 2.25, 0.045, 0.09);
  return k.geometry();
}

export class StreetLayer {
  constructor({ scenes, env, terrain }) {
    this.scenes = scenes; this.env = env; this.terrain = terrain;
    this.decalMat = decalMaterial({ vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, name: 'markings' });
    this.kitMat = kitMaterial(env, { instanced: true });
    this.depthMat = depthMaterial({ instanced: true });
    this.lamp = [lampGeometry(false), lampGeometry(true)];
    this.signal = signalGeometry();
    this.signalMat = kitMaterial(env, { instanced: true, signal: true });
    this.carMat = kitMaterial(env, { instanced: true, instanceColor: true });
    this.cars = [0, 1, 2, 3, 4].map((k) => ({ hi: KINDS[k].make(false, 0), lo: KINDS[k].make(false, 1), colors: KINDS[k].colors }));
    this.railGeo = [railGeometry(0), railGeometry(1)];
    this.furnGeo = [bollardGeometry(), binGeometry(), cabinetGeometry()];
    this.shelterGeo = shelterGeometry();
    this.tiles = new Map();
    this.lights = new Map();
    this.version = 0;
  }

  addTile(key, t, st) {
    if (!st) return;
    const out = { objs: [] };
    if (st.decals) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('aPos', new THREE.BufferAttribute(st.decals.pos, 3));
      geo.setAttribute('aUv', new THREE.BufferAttribute(st.decals.uv, 3));
      geo.setIndex(new THREE.BufferAttribute(st.decals.index, 1));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, this.decalMat); m.position.set(t.x, 0, t.z); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
      this.scenes.decals.add(m); out.decal = m;
    }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), qP = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();

    const inst = (geo, list, stride, filter, pitchIdx = -1) => {
      if (!list || !list.length) return null;
      const sel = [];
      for (let i = 0; i < list.length; i += stride) if (!filter || filter(list, i)) sel.push(i);
      if (!sel.length) return null;
      const im = new THREE.InstancedMesh(geo, this.kitMat, sel.length);
      const sh = new THREE.InstancedMesh(geo, this.depthMat, sel.length);
      const yIdx = pitchIdx >= 0 ? (stride === 6 ? 4 : 3) : 4;
      sel.forEach((i, k) => {
        q.setFromAxisAngle(up, list[i + 2]);
        if (pitchIdx >= 0) {
          const pitch = Math.atan(Math.max(-0.34, Math.min(0.34, list[i + pitchIdx] || 0)));
          qP.setFromAxisAngle(zAxis, pitch);
          q.multiply(qP);
        }
        p.set(t.x + list[i], list[i + yIdx], t.z + list[i + 1]);
        M.compose(p, q, one); im.setMatrixAt(k, M); sh.setMatrixAt(k, M);
      });
      im.instanceMatrix.needsUpdate = true; sh.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere(); sh.computeBoundingSphere();
      this.scenes.opaque.add(im); this.scenes.shadow.add(sh); out.objs.push(im, sh);
      return sel;
    };

    const lights = [];
    for (const tall of [0, 1]) {
      const sel = inst(this.lamp[tall].geo, st.lamps, 5, (l, i) => l[i + 3] === tall);
      if (sel) for (const i of sel) {
        const yaw = st.lamps[i + 2], h = this.lamp[tall].head;
        lights.push(t.x + st.lamps[i] + Math.cos(yaw) * h[0], st.lamps[i + 4] + h[1], t.z + st.lamps[i + 1] - Math.sin(yaw) * h[0]);
      }
    }

    // Phase 3 Chongqing Street Clutter: guardrails (pitched to slope), bollards, bins, utility cabinets, bus shelters
    if (st.rails && st.rails.length) {
      for (const rk of [0, 1]) inst(this.railGeo[rk], st.rails, 6, (l, i) => l[i + 3] === rk, 5);
    }
    if (st.furniture && st.furniture.length) {
      for (const fk of [0, 1, 2]) inst(this.furnGeo[fk], st.furniture, 5, (l, i) => l[i + 3] === fk);
    }
    if (st.shelters && st.shelters.length) {
      inst(this.shelterGeo, st.shelters, 5, null, 4);
    }

    if (st.signals && st.signals.length) {
      const S = st.signals, stride = 7, n = Math.floor(S.length / stride), base = this.signal;
      const geo = new THREE.BufferGeometry(); geo.setIndex(base.index);
      for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.attributes[name]);
      const sig = new Float32Array(n * 2);
      const im = new THREE.InstancedMesh(geo, this.signalMat, n), sh = new THREE.InstancedMesh(base, this.depthMat, n);
      for (let k = 0; k < n; k++) {
        q.setFromAxisAngle(up, S[k * stride + 2]);
        p.set(t.x + S[k * stride], S[k * stride + 6], t.z + S[k * stride + 1]);
        M.compose(p, q, one); im.setMatrixAt(k, M); sh.setMatrixAt(k, M);
        sig[k * 2] = S[k * stride + 4]; sig[k * 2 + 1] = S[k * stride + 5];
      }
      geo.setAttribute('aSig', new THREE.InstancedBufferAttribute(sig, 2));
      im.instanceMatrix.needsUpdate = true; sh.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere(); sh.computeBoundingSphere(); geo.boundingSphere = base.boundingSphere;
      this.scenes.opaque.add(im); this.scenes.shadow.add(sh); out.objs.push(im, sh); out.own = [geo];
    }

    if (st.cars && st.cars.length) {
      const C = st.cars, stride = 7, col = new THREE.Color();
      const hsh = (i) => { const v = Math.sin(C[i] * 12.9898 + C[i + 1] * 78.233) * 43758.5453; return v - Math.floor(v); };
      const pick = (i) => { const h = hsh(i); return h < 0.38 ? 0 : h < 0.66 ? 1 : h < 0.76 ? 2 : h < 0.88 ? 3 : 4; };
      out.cars = [];
      for (let g = 0; g < this.cars.length; g++) {
        const sel = []; for (let i = 0; i < C.length; i += stride) if (pick(i) === g) sel.push(i);
        if (!sel.length) continue;
        const im = new THREE.InstancedMesh(this.cars[g].lo, this.carMat, sel.length), sh = new THREE.InstancedMesh(this.cars[g].lo, this.depthMat, sel.length);
        sel.forEach((i, k) => {
          const yaw = C[i + 2];
          const sl = Math.max(-0.32, Math.min(0.32, C[i + 5] || 0));
          const rl = Math.max(-0.32, Math.min(0.32, C[i + 6] || 0));
          // Exact orthonormal [X (fwd+pitch), Y (surface normal), Z (right+roll)] matching traffic.js 4-wheel fit!
          const hx = Math.cos(yaw), hz = -Math.sin(yaw);
          const il = 1 / Math.sqrt(1 + sl * sl), Xx = hx * il, Xy = sl * il, Xz = hz * il;
          const Z0x = -hz, Z0y = rl, Z0z = hx;
          let Yx = Z0y * Xz - Z0z * Xy, Yy = Z0z * Xx - Z0x * Xz, Yz = Z0x * Xy - Z0y * Xx;
          const yl = 1 / (Math.hypot(Yx, Yy, Yz) || 1); Yx *= yl; Yy *= yl; Yz *= yl;
          const Zx = Xy * Yz - Xz * Yy, Zy = Xz * Yx - Xx * Yz, Zz = Xx * Yy - Xy * Yx;
          M.set(
            Xx, Yx, Zx, t.x + C[i],
            Xy, Yy, Zy, C[i + 4],
            Xz, Yz, Zz, t.z + C[i + 1],
            0,  0,  0,  1,
          );
          im.setMatrixAt(k, M); sh.setMatrixAt(k, M);
          const h2 = (hsh(i) * 977) % 1, pal = this.cars[g].colors;
          const c = pal[Math.floor(h2 * pal.length)]; col.setRGB(c[0], c[1], c[2]); im.setColorAt(k, col);
        });
        im.instanceMatrix.needsUpdate = true; sh.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere(); sh.computeBoundingSphere();
        this.scenes.opaque.add(im); this.scenes.shadow.add(sh); out.objs.push(im, sh); out.cars.push({ im, g });
      }
    }
    out.x = t.x; out.z = t.z;
    this.lights.set(key, new Float32Array(lights));
    this.tiles.set(key, out); this.version++;
  }

  update(camera) {
    const px = camera.position.x, pz = camera.position.z;
    const groundY = this.terrain ? Math.max(this.terrain.sample(px, pz), 0) : 0;
    const agl = Math.max(0, camera.position.y - groundY);
    for (const o of this.tiles.values()) {
      if (!o.cars) continue;
      const d = Math.hypot(Math.max(0, Math.abs(px - o.x) - 500), Math.max(0, Math.abs(pz - o.z) - 500));
      const hi = d < (o.hi ? 150 : 110) && agl < 260;
      if (hi === !!o.hi) continue;
      o.hi = hi;
      for (const c of o.cars) c.im.geometry = hi ? this.cars[c.g].hi : this.cars[c.g].lo;
    }
  }

  removeTile(key) {
    const o = this.tiles.get(key);
    if (!o) return;
    if (o.decal) { this.scenes.decals.remove(o.decal); o.decal.geometry.dispose(); }
    for (const m of o.objs) { m.parent && m.parent.remove(m); m.dispose && m.dispose(); }
    if (o.own) for (const g of o.own) { g.index = null; for (const name of Object.keys(g.attributes)) if (name !== 'aSig') g.deleteAttribute(name); g.dispose(); }
    this.tiles.delete(key); this.lights.delete(key); this.version++;
  }
}
