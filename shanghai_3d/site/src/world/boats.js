// Vessels on the Huangpu: barges moored side by side, coasters, small craft, pontoons. Positions, sizes and headings are
// real (data/boats.json, see pipeline/36_boats.py); the hulls are small kit models, instanced and stretched to each
// vessel's length and beam. White vertices take the instance colour (hull paint or cargo).
// Vessels found out in the fairway are under way: they follow the river's centre line, keeping to the right, with more
// barges and coasters added between them; ferries shuttle on the crossings mapped in OSM. Each trails a wake.

import * as THREE from 'three';
import { Kit } from './kit.js';
import { kitMaterial, depthMaterial, gbufferMaterial } from '../engine/materials.js';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { fetchJSON } from './data.js';

const WATER_Y = -1.2;

/** Vertical walls around a plan outline ([x, z] pairs, positive shoelace area), from y0 to y1. */
function walls(K, pts, y0, y1) {
  for (let k = 0; k < pts.length; k++) {
    const A = pts[k], B = pts[(k + 1) % pts.length];
    K.quad([B[0], y0, B[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]]);
  }
}
/** The outline as a flat deck at height y (convex enough for a fan). */
function deck(K, pts, y) {
  for (let k = 1; k + 1 < pts.length; k++) K.quad([pts[0][0], y, pts[0][1]], [pts[k + 1][0], y, pts[k + 1][1]], [pts[k][0], y, pts[k][1]], [pts[k][0], y, pts[k][1]]);
}
const hullPlan = (bow, sh, stern = 0.03) => [[-0.5, -0.5 + stern * 1.4], [-0.5 + stern, -0.5], [bow, -0.5], [0.5 - (0.5 - bow) * 0.28, -sh], [0.5, 0], [0.5 - (0.5 - bow) * 0.28, sh], [bow, 0.5], [-0.5 + stern, 0.5], [-0.5, 0.5 - stern * 1.4]];
const WHITE = (K) => K.color(1, 1, 1).material(0.55, 0);
const PAINT = (K) => K.color(0.86, 0.86, 0.84).material(0.5, 0);
const GLASS = (K) => K.color(0.085, 0.078, 0.06).material(0.2, 0, -6.0, 0.9);        // dark by day, lit at night
const OXIDE = (K) => K.color(0.30, 0.09, 0.065).material(0.7, 0);

// all models: length 1 along x (bow at +x), beam 1 across z, heights in metres above the water line
function barge() {
  const K = new Kit();
  const P = hullPlan(0.36, 0.3);
  OXIDE(K); walls(K, P, -0.9, 0.3);
  K.color(0.06, 0.06, 0.07).material(0.6, 0); walls(K, P, 0.3, 1.25);
  K.color(0.20, 0.185, 0.17).material(0.85, 0); deck(K, P, 1.25);
  // hold coaming and the load: a long heap (sand, gravel, coal) or a tarpaulin over a ridge pole
  K.color(0.16, 0.15, 0.15).material(0.7, 0);
  walls(K, [[-0.30, -0.40], [0.33, -0.40], [0.33, 0.40], [-0.30, 0.40]], 1.25, 1.8);
  WHITE(K).material(0.9, 0);
  const x0 = -0.295, x1 = 0.325, z = 0.39, r0 = -0.22, r1 = 0.25, yb = 1.8, yr = 2.75;
  K.quad([x0, yb, z], [x1, yb, z], [r1, yr, 0], [r0, yr, 0]); K.quad([x1, yb, -z], [x0, yb, -z], [r0, yr, 0], [r1, yr, 0]);
  K.quad([x1, yb, z], [x1, yb, -z], [r1, yr, 0], [r1, yr, 0]); K.quad([x0, yb, -z], [x0, yb, z], [r0, yr, 0], [r0, yr, 0]);
  // deckhouse at the stern
  PAINT(K); K.box(-0.41, 2.5, 0, 0.115, 2.5, 0.66);
  GLASS(K); K.box(-0.41, 3.05, 0, 0.118, 0.7, 0.60); K.box(-0.41, 3.05, 0, 0.105, 0.7, 0.67);
  K.color(0.30, 0.31, 0.33).material(0.6, 0); K.box(-0.41, 3.82, 0, 0.125, 0.14, 0.72);
  K.color(0.12, 0.12, 0.13).material(0.5, 0.4); K.tube([-0.385, 3.85, 0.18], [-0.385, 5.6, 0.18], 0.004, 0.004, 5);
  return K.geometry();
}

function ship() {
  const K = new Kit();
  const P = hullPlan(0.28, 0.33, 0.04);
  OXIDE(K); walls(K, P, -1.6, 0.7);
  WHITE(K).material(0.5, 0); walls(K, P, 0.7, 4.3);
  K.color(0.24, 0.12, 0.09).material(0.8, 0); deck(K, P, 4.3);
  // forecastle
  const F = [[0.33, -0.44], [0.5 - 0.22 * 0.28, -0.33], [0.5, 0], [0.5 - 0.22 * 0.28, 0.33], [0.33, 0.44]];
  WHITE(K).material(0.5, 0); walls(K, F, 4.3, 5.9);
  K.color(0.24, 0.12, 0.09).material(0.8, 0); deck(K, F, 5.9);
  // hatch covers
  K.color(0.33, 0.36, 0.35).material(0.6, 0.2);
  for (const [a, b] of [[-0.24, -0.08], [-0.05, 0.11], [0.14, 0.30]]) K.box((a + b) / 2, 4.9, 0, b - a, 1.2, 0.74);
  // superstructure at the stern: three decks, bridge with wings, funnel
  PAINT(K);
  K.box(-0.385, 5.7, 0, 0.17, 2.8, 0.86); K.box(-0.39, 8.5, 0, 0.14, 2.8, 0.74); K.box(-0.40, 11.2, 0, 0.09, 2.6, 0.96);
  GLASS(K);
  K.box(-0.40, 11.6, 0, 0.092, 0.9, 0.90); K.box(-0.39, 8.9, 0, 0.142, 0.7, 0.66); K.box(-0.385, 6.1, 0, 0.172, 0.7, 0.78);
  K.color(0.08, 0.08, 0.09).material(0.5, 0.3); K.box(-0.345, 13.6, 0, 0.035, 3.2, 0.2);
  WHITE(K); K.box(-0.345, 14.2, 0, 0.036, 0.9, 0.205);
  K.color(0.75, 0.75, 0.72).material(0.5, 0.3); K.tube([0.40, 5.9, 0], [0.40, 13, 0], 0.003, 0.002, 5); K.tube([-0.40, 12.5, 0], [-0.40, 16.5, 0], 0.003, 0.002, 5);
  K.color(1.0, 0.95, 0.8).material(0.3, 0, -6.0); K.box(0.40, 13.1, 0, 0.004, 0.4, 0.03);
  return K.geometry();
}

function smallCraft() {
  const K = new Kit();
  const P = hullPlan(0.14, 0.32, 0.05);
  OXIDE(K); walls(K, P, -0.5, 0.15);
  WHITE(K).material(0.45, 0); walls(K, P, 0.15, 1.0);
  K.color(0.36, 0.35, 0.33).material(0.8, 0); deck(K, P, 1.0);
  PAINT(K); K.box(-0.08, 2.0, 0, 0.38, 2.0, 0.62);
  GLASS(K); K.box(-0.08, 2.35, 0, 0.385, 0.7, 0.56); K.box(-0.08, 2.35, 0, 0.34, 0.7, 0.63);
  K.color(0.30, 0.31, 0.33).material(0.6, 0); K.box(-0.08, 3.06, 0, 0.40, 0.12, 0.68);
  return K.geometry();
}

function pontoon() {
  const K = new Kit();
  const P = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  K.color(0.10, 0.13, 0.12).material(0.7, 0); walls(K, P, -0.6, 1.1);
  K.color(0.30, 0.31, 0.29).material(0.85, 0); deck(K, P, 1.1);
  PAINT(K); K.box(0, 2.7, 0, 0.56, 3.2, 0.56);
  GLASS(K); K.box(0, 2.9, 0, 0.565, 0.9, 0.5); K.box(0, 2.9, 0, 0.5, 0.9, 0.565);
  WHITE(K).material(0.6, 0.2); K.box(0, 4.42, 0, 0.62, 0.24, 0.62);
  // fenders along the edge
  K.color(0.05, 0.05, 0.05).material(0.9, 0);
  for (let k = -2; k <= 2; k++) { K.box(k * 0.2, 0.6, 0.505, 0.03, 0.9, 0.012); K.box(k * 0.2, 0.6, -0.505, 0.03, 0.9, 0.012); }
  return K.geometry();
}

/** Double-ended river ferry: two glazed decks the length of the hull, a wheelhouse on top. */
function ferry() {
  const K = new Kit();
  const P = hullPlan(0.36, 0.34, 0.14);
  K.color(0.07, 0.10, 0.20).material(0.6, 0); walls(K, P, -1.0, 1.3);
  K.color(0.30, 0.31, 0.30).material(0.85, 0); deck(K, P, 1.3);
  WHITE(K).material(0.5, 0); K.box(0, 2.55, 0, 0.78, 2.5, 0.86); K.box(0, 5.0, 0, 0.62, 2.4, 0.74);
  GLASS(K); K.box(0, 2.75, 0, 0.782, 1.1, 0.80); K.box(0, 2.75, 0, 0.72, 1.1, 0.865); K.box(0, 5.2, 0, 0.622, 1.0, 0.68); K.box(0, 5.2, 0, 0.56, 1.0, 0.745);
  K.color(0.78, 0.79, 0.78).material(0.6, 0); K.box(0, 6.28, 0, 0.66, 0.16, 0.80);
  PAINT(K); K.box(0, 7.4, 0, 0.12, 2.1, 0.42);
  GLASS(K); K.box(0, 7.7, 0, 0.122, 0.8, 0.38); K.box(0, 7.7, 0, 0.10, 0.8, 0.425);
  K.color(0.55, 0.12, 0.10).material(0.6, 0); K.box(0, 8.9, 0, 0.05, 1.0, 0.14);
  return K.geometry();
}

const PALETTE = [
  [[0.80, 0.80, 0.78], [0.10, 0.22, 0.42], [0.45, 0.10, 0.08], [0.10, 0.28, 0.20], [0.42, 0.43, 0.44], [0.75, 0.55, 0.12]],     // small craft hulls
  [[0.56, 0.48, 0.33], [0.60, 0.53, 0.38], [0.40, 0.39, 0.37], [0.06, 0.06, 0.065], [0.13, 0.27, 0.19], [0.13, 0.22, 0.40], [0.50, 0.44, 0.31]],   // barge loads
  [[0.05, 0.05, 0.06], [0.07, 0.11, 0.24], [0.36, 0.09, 0.07], [0.07, 0.20, 0.15], [0.30, 0.31, 0.33]],     // ship hulls
  [[0.16, 0.30, 0.52], [0.50, 0.14, 0.11], [0.30, 0.33, 0.32], [0.14, 0.34, 0.26]],                         // pontoon roofs
  [[0.86, 0.86, 0.84], [0.84, 0.80, 0.70]],                                                                  // ferries
];

// the wake: a sheet on the water behind the stern, foam where a V and a churned middle say so
const WAKE_VERT = /* glsl */`${PRECISION}
in vec3 position; in mat4 instanceMatrix;
uniform mat4 viewMatrix, projectionMatrix;
out vec3 vLocal; out vec3 vWorld;
void main() { vec4 w = instanceMatrix * vec4(position, 1.0); vLocal = position; vWorld = w.xyz; gl_Position = projectionMatrix * (viewMatrix * w); }`;
const WAKE_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform float uTime;
in vec3 vLocal; in vec3 vWorld;
void main() {
  float u = -vLocal.x, w = abs(vLocal.z), spread = mix(0.22, 1.0, sqrt(u));
  float arm = smoothstep(0.14, 0.0, abs(w - spread * 0.86)) * (1.0 - u);
  float mid = smoothstep(spread * 0.42, 0.0, w) * (1.0 - u) * (1.0 - u);
  float foam = max(arm, mid);
  float n = vnoise(vWorld.xz * 0.8 + uTime * 0.15) * 0.55 + vnoise(vWorld.xz * 2.9 - uTime * 0.3) * 0.45;
  if (foam < n * 0.95 + 0.06) discard;
  Surface s = defaultSurface();
  s.albedo = vec3(0.74, 0.79, 0.80); s.normal = vec3(0.0, 1.0, 0.0); s.roughness = 0.65;
  s.model = 128.0;
  writeGBuffer(s);
}`;

const KIND_SPEED = [5.0, 3.0, 3.8, 0, 4.4];

export class Boats {
  constructor({ scenes, env }) { this.scenes = scenes; this.env = env; this.count = 0; this.movers = []; }

  async load() {
    const D = await fetchJSON('boats.json');
    const B = D.boats, st = D.stride, n = B.length / st;
    const geos = [smallCraft(), barge(), ship(), pontoon(), ferry()];
    const mat = kitMaterial(this.env, { instanced: true, instanceColor: true }), dep = depthMaterial({ instanced: true });
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const hsh = (x, z) => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return h - Math.floor(h); };
    const scaleY = (kind, L) => (kind === 2 ? Math.min(1.5, Math.max(0.8, L / 95)) : kind === 0 ? Math.min(1.3, Math.max(0.7, L / 16)) : 1);
    // ---- moored and anchored vessels: static instances
    for (let kind = 0; kind < 4; kind++) {
      const sel = []; for (let i = 0; i < n; i++) if (B[i * st + 5] === kind && !B[i * st + 6]) sel.push(i);
      if (!sel.length) continue;
      const im = new THREE.InstancedMesh(geos[kind], mat, sel.length), sh = new THREE.InstancedMesh(geos[kind], dep, sel.length);
      sel.forEach((i, k) => {
        const x = B[i * st], z = B[i * st + 1], L = B[i * st + 2], W = B[i * st + 3], r = hsh(x, z);
        // bigger vessels ride higher; a loaded barge sits low
        q.setFromAxisAngle(up, B[i * st + 4]); p.set(x, WATER_Y - (kind === 1 ? r * 0.5 : 0), z); s.set(L, scaleY(kind, L), W);
        M.compose(p, q, s); im.setMatrixAt(k, M); sh.setMatrixAt(k, M);
        const pal = PALETTE[kind], c = pal[Math.floor(((r * 7919) % 1) * pal.length)];
        col.setRGB(c[0], c[1], c[2]); im.setColorAt(k, col);
      });
      im.instanceMatrix.needsUpdate = true; sh.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); sh.computeBoundingSphere();
      sh.layers.enable(1);
      this.scenes.opaque.add(im); this.scenes.shadow.add(sh);
    }
    // ---- vessels under way
    const R = D.river, nr = R.length / 2, cum = new Float32Array(nr);
    for (let k = 1; k < nr; k++) cum[k] = cum[k - 1] + Math.hypot(R[k * 2] - R[k * 2 - 2], R[k * 2 + 1] - R[k * 2 - 1]);
    this.river = { R, cum, n: nr, len: cum[nr - 1] };
    const movers = this.movers;
    let seed = 20261113; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < n; i++) if (B[i * st + 6]) {
      const kind = B[i * st + 5], off = Math.max(-115, Math.min(115, B[i * st + 8]));
      movers.push({ kind, L: B[i * st + 2], W: B[i * st + 3], s: B[i * st + 7], off, dir: off < 0 ? 1 : -1, v: KIND_SPEED[kind] * (0.8 + 0.4 * rnd()), k: seed });
    }
    // more of them: a working river has a barge every few hundred metres each way
    for (let s0 = 300 * rnd(); s0 < this.river.len; s0 += 160 + 340 * rnd()) {
      const r = rnd(), kind = r < 0.68 ? 1 : r < 0.82 ? 2 : 0, dir = rnd() < 0.5 ? 1 : -1;
      const L = kind === 1 ? 34 + 26 * rnd() : kind === 2 ? 70 + 60 * rnd() : 12 + 10 * rnd();
      movers.push({ kind, L, W: kind === 1 ? L / 5.2 : kind === 2 ? L / 6.2 : L / 3.2, s: s0, off: -dir * (38 + 62 * rnd()), dir, v: KIND_SPEED[kind] * (0.8 + 0.4 * rnd()), k: seed });
    }
    // ferries: there and back with a wait at each landing
    for (const f of D.ferries || []) {
      const len = Math.hypot(f[2] - f[0], f[3] - f[1]);
      movers.push({ kind: 4, L: 38, W: 10.5, ferry: f, len, v: 4.4, t0: rnd() * 600, k: seed });
    }
    const mm = kitMaterial(this.env, { instanced: true, instanceColor: true, moving: true });
    this.dyn = geos.map((g, kind) => {
      const cnt = movers.filter((m) => m.kind === kind).length;
      if (!cnt) return null;
      const im = new THREE.InstancedMesh(g, mm, cnt); im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      let k = 0;
      for (const m of movers) if (m.kind === kind) { m.slot = k; const pal = PALETTE[kind], c = pal[m.k % pal.length]; col.setRGB(c[0], c[1], c[2]); im.setColorAt(k++, col); }
      im.instanceColor.needsUpdate = true;
      this.scenes.opaque.add(im);
      return im;
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 0.04, 0, -1, 0.04, 0, 1, -1, 0, 1]), 3));
    wg.setIndex([0, 2, 1, 0, 3, 2]);
    this.wake = new THREE.InstancedMesh(wg, gbufferMaterial({ vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, uniforms: { uTime: this.env.uniforms.uTime }, side: THREE.DoubleSide, name: 'wake' }), movers.length);
    this.wake.frustumCulled = false; this.wake.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scenes.opaque.add(this.wake);
    this.count = n + movers.length;
    this._M = M; this._q = q; this._p = p; this._s = s; this._up = up; this._sy = scaleY;
  }

  /** Point on the river's centre line at distance s from its upstream end, with the unit tangent. */
  _riverAt(s, out) {
    const { R, cum, n } = this.river;
    let lo = 0, hi = n - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    const seg = cum[lo + 1] - cum[lo] || 1, t = (s - cum[lo]) / seg;
    out.x = R[lo * 2] + (R[lo * 2 + 2] - R[lo * 2]) * t; out.z = R[lo * 2 + 1] + (R[lo * 2 + 3] - R[lo * 2 + 1]) * t;
    out.dx = (R[lo * 2 + 2] - R[lo * 2]) / seg; out.dz = (R[lo * 2 + 3] - R[lo * 2 + 1]) / seg;
    return out;
  }

  update(time, camera) {
    if (!this.river || !this.dyn) return;
    const M = this._M, q = this._q, p = this._p, s = this._s, up = this._up, A = {}, Bq = {};
    const len = this.river.len, cx = camera.position.x, cz = camera.position.z;
    let nw = 0;
    for (const m of this.movers) {
      let x, z, hx, hz, speed = m.v;
      if (m.ferry) {
        const f = m.ferry, sail = m.len / m.v, wait = 75, T = 2 * (sail + wait), u = (time + m.t0) % T;
        const a = u < sail ? u / sail : u < sail + wait ? 1 : u < 2 * sail + wait ? 1 - (u - sail - wait) / sail : 0;
        if (!(u < sail || (u >= sail + wait && u < 2 * sail + wait))) speed = 0;
        const e = a * a * (3 - 2 * a);                                    // easing away from and into the landings
        x = f[0] + (f[2] - f[0]) * e; z = f[1] + (f[3] - f[1]) * e;
        const back = u >= sail + wait;
        hx = (f[2] - f[0]) / m.len; hz = (f[3] - f[1]) / m.len;
        speed *= Math.min(1, 6 * a * (1 - a) + 0.1) * (back ? -1 : 1);
      } else {
        let sd = (m.s + m.dir * m.v * time) % len; if (sd < 0) sd += len;
        this._riverAt(sd, A);
        // the heading follows the bend ahead rather than the kink underfoot
        this._riverAt(Math.min(len, Math.max(0, sd + m.dir * 40)), Bq);
        let tx = (Bq.x - A.x) * m.dir, tz = (Bq.z - A.z) * m.dir; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        x = A.x + A.dz * m.off; z = A.z - A.dx * m.off;                   // offset to the left of the line
        hx = tx; hz = tz;
      }
      if ((x - cx) ** 2 + (z - cz) ** 2 > 9000 * 9000) { p.set(0, -500, 0); s.set(1, 1, 1); q.identity(); M.compose(p, q, s); this.dyn[m.kind].setMatrixAt(m.slot, M); continue; }
      q.setFromAxisAngle(up, Math.atan2(-hz, hx)); p.set(x, WATER_Y, z); s.set(m.L, this._sy(m.kind, m.L), m.W);
      M.compose(p, q, s); this.dyn[m.kind].setMatrixAt(m.slot, M);
      const sp = Math.abs(speed);
      if (sp > 0.4) {
        const dir = speed < 0 ? -1 : 1, k = Math.min(1, sp / 4);
        q.setFromAxisAngle(up, Math.atan2(-hz * dir, hx * dir)); p.set(x - hx * dir * m.L * 0.47, WATER_Y + 0.06, z - hz * dir * m.L * 0.47); s.set(m.L * (1.6 + 2.2 * k), 1, m.W * (1.3 + 1.6 * k));
        M.compose(p, q, s); this.wake.setMatrixAt(nw++, M);
      }
    }
    for (const im of this.dyn) if (im) im.instanceMatrix.needsUpdate = true;
    this.wake.count = nw; this.wake.instanceMatrix.needsUpdate = true;
  }
}
