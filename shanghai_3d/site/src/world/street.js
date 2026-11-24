// Street dressing: lane-marking decals, street lamps and traffic signals for the street-level tiles.

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
  float a = 1.0; vec3 c = vec3(0.62, 0.62, 0.60);
  if (type == 1) a = step(fract(along / 6.0), 0.3334);
  else if (type == 2) { a = step(0.085, abs(across)); c = vec3(0.62, 0.44, 0.06); }
  else if (type == 3) { a = step(fract(along / 10.0), 0.4); c = vec3(0.62, 0.44, 0.06); }
  else if (type == 4) a = step(fract(across / 1.0 + 0.25), 0.45);
  // paint wears: scuffed along the wheel paths, cracked with the asphalt under it
  float wear = vnoise(vWorld.xz * 2.3) * 0.6 + vnoise(vWorld.xz * 11.0) * 0.4;
  a *= mix(0.55, 1.0, smoothstep(0.25, 0.6, wear));
  c *= 0.85 + 0.25 * vnoise(vWorld.xz * 0.7);
  if (a < 0.01) discard;
  writeDecal(c, a);
}`;

function lampGeometry(tall) {
  const k = new Kit();
  const H = tall ? 9.6 : 6.6, arm = tall ? 2.3 : 1.3;
  k.color(0.34, 0.35, 0.36).material(0.45, 0.8);
  k.tube([0, 0, 0], [0, 0.9, 0], 0.13, 0.11, 10, false);                  // base sleeve
  k.tube([0, 0.9, 0], [0, H - 0.4, 0], 0.095, 0.065, 10, false);
  // arm sweeping towards the road (+x)
  const pts = [[0, H - 0.4, 0], [arm * 0.15, H - 0.05, 0], [arm * 0.55, H + 0.22, 0], [arm, H + 0.25, 0]];
  for (let i = 0; i + 1 < pts.length; i++) k.tube(pts[i], pts[i + 1], 0.06 - i * 0.008, 0.052 - i * 0.008, 8, false);
  // luminaire
  k.color(0.30, 0.31, 0.32).material(0.4, 0.7);
  k.box(arm + 0.32, H + 0.24, 0, 0.78, 0.11, 0.30);
  k.color(1.0, 0.86, 0.62).material(0.3, 0, -9.0);
  k.quad([arm, H + 0.18, -0.12], [arm + 0.64, H + 0.18, -0.12], [arm + 0.64, H + 0.18, 0.12], [arm, H + 0.18, 0.12]);
  return { geo: k.geometry(), head: [arm + 0.32, H + 0.15, 0] };
}

function signalGeometry() {
  const k = new Kit();
  k.color(0.16, 0.17, 0.18).material(0.5, 0.6);
  k.tube([0, 0, 0], [0, 6.4, 0], 0.11, 0.085, 10, true);
  k.tube([0, 6.0, 0], [5.6, 6.25, 0], 0.07, 0.05, 8, true);
  // two heads over the lanes, one on the pole for pedestrians; lenses face -z
  for (const [x, y] of [[3.0, 5.95], [5.0, 6.05]]) {
    k.color(0.05, 0.05, 0.055).material(0.6, 0.2);
    k.box(x, y - 0.25, 0, 0.36, 1.05, 0.26);
    // lenses: 101 red, 102 amber, 103 green in the emissive slot; the material lights the one that is on (materials.js)
    const lens = (dy, r, g, b, e) => { k.color(r, g, b).material(0.3, 0, e); k.quad([x + 0.12, y - 0.25 + dy - 0.12, -0.135], [x - 0.12, y - 0.25 + dy - 0.12, -0.135], [x - 0.12, y - 0.25 + dy + 0.12, -0.135], [x + 0.12, y - 0.25 + dy + 0.12, -0.135]); };
    lens(0.33, 1.0, 0.07, 0.04, 101); lens(0.0, 1.0, 0.62, 0.05, 102); lens(-0.33, 0.08, 1.0, 0.4, 103);
  }
  k.color(0.05, 0.05, 0.055).material(0.6, 0.2);
  k.box(0.2, 2.7, 0, 0.22, 0.5, 0.2);
  return k.geometry();
}

export class StreetLayer {
  constructor({ scenes, env }) {
    this.scenes = scenes; this.env = env;
    this.decalMat = decalMaterial({ vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, name: 'markings' });
    this.kitMat = kitMaterial(env, { instanced: true });
    this.depthMat = depthMaterial({ instanced: true });
    this.lamp = [lampGeometry(false), lampGeometry(true)];
    this.signal = signalGeometry();
    this.signalMat = kitMaterial(env, { instanced: true, signal: true });
    this.carMat = kitMaterial(env, { instanced: true, instanceColor: true });
    // parked cars (lamps off): sedan, SUV, MPV, hatchback, each detailed and simplified
    this.cars = [0, 1, 2, 3].map((k) => ({ hi: KINDS[k].make(false, 0), lo: KINDS[k].make(false, 1), colors: KINDS[k].colors }));
    this.tiles = new Map();
    this.lights = new Map();            // key -> Float32Array of lamp head positions (world x, y, z)
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
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 720);
      const m = new THREE.Mesh(geo, this.decalMat); m.position.set(t.x, 0, t.z); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
      this.scenes.decals.add(m); out.decal = m;
    }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const inst = (geo, list, stride, filter, y = 0.15) => {
      const sel = []; for (let i = 0; i < list.length; i += stride) if (filter(list, i)) sel.push(i);
      if (!sel.length) return null;
      const im = new THREE.InstancedMesh(geo, this.kitMat, sel.length), sh = new THREE.InstancedMesh(geo, this.depthMat, sel.length);
      // (a fifth value per item is its own height: lamps on elevated decks)
      sel.forEach((i, k) => { q.setFromAxisAngle(up, list[i + 2]); p.set(t.x + list[i], stride > 4 ? list[i + 4] : y, t.z + list[i + 1]); M.compose(p, q, one); im.setMatrixAt(k, M); sh.setMatrixAt(k, M); });
      im.instanceMatrix.needsUpdate = true; sh.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere(); sh.computeBoundingSphere();
      this.scenes.opaque.add(im); this.scenes.shadow.add(sh); out.objs.push(im, sh);
      return sel;
    };
    const lights = [];
    for (const tall of [0, 1]) {
      const sel = inst(this.lamp[tall].geo, st.lamps, 5, (l, i) => l[i + 3] === tall);
      if (sel) for (const i of sel) { const yaw = st.lamps[i + 2], h = this.lamp[tall].head; lights.push(t.x + st.lamps[i] + Math.cos(yaw) * h[0], st.lamps[i + 4] + h[1], t.z + st.lamps[i + 1] - Math.sin(yaw) * h[0]); }
    }
    // signal heads: each knows its junction's clock and its group
    if (st.signals && st.signals.length) {
      const S = st.signals, n = S.length / 6, base = this.signal;
      const geo = new THREE.BufferGeometry(); geo.setIndex(base.index);
      for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.attributes[name]);
      const sig = new Float32Array(n * 2);
      const im = new THREE.InstancedMesh(geo, this.signalMat, n), sh = new THREE.InstancedMesh(base, this.depthMat, n);
      for (let k = 0; k < n; k++) { q.setFromAxisAngle(up, S[k * 6 + 2]); p.set(t.x + S[k * 6], 0.15, t.z + S[k * 6 + 1]); M.compose(p, q, one); im.setMatrixAt(k, M); sh.setMatrixAt(k, M); sig[k * 2] = S[k * 6 + 4]; sig[k * 2 + 1] = S[k * 6 + 5]; }
      geo.setAttribute('aSig', new THREE.InstancedBufferAttribute(sig, 2));
      im.instanceMatrix.needsUpdate = true; sh.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere(); sh.computeBoundingSphere(); geo.boundingSphere = base.boundingSphere;
      this.scenes.opaque.add(im); this.scenes.shadow.add(sh); out.objs.push(im, sh); out.own = [geo];
    }
    // parked cars: body type and colour from a hash of the position
    if (st.cars && st.cars.length) {
      const C = st.cars, col = new THREE.Color();
      const hsh = (i) => { const v = Math.sin(C[i] * 12.9898 + C[i + 1] * 78.233) * 43758.5453; return v - Math.floor(v); };
      const pick = (i) => { const h = hsh(i); return h < 0.44 ? 0 : h < 0.74 ? 1 : h < 0.84 ? 2 : 3; };
      out.cars = [];
      for (let g = 0; g < this.cars.length; g++) {
        const sel = []; for (let i = 0; i < C.length; i += 5) if (pick(i) === g) sel.push(i);
        if (!sel.length) continue;
        const im = new THREE.InstancedMesh(this.cars[g].lo, this.carMat, sel.length), sh = new THREE.InstancedMesh(this.cars[g].lo, this.depthMat, sel.length);
        sel.forEach((i, k) => {
          q.setFromAxisAngle(up, C[i + 2]); p.set(t.x + C[i], C[i + 4], t.z + C[i + 1]); M.compose(p, q, one); im.setMatrixAt(k, M); sh.setMatrixAt(k, M);
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

  /** Parked cars near the camera get the detailed body. */
  update(camera) {
    const px = camera.position.x, pz = camera.position.z;
    for (const o of this.tiles.values()) {
      if (!o.cars) continue;
      const d = Math.hypot(Math.max(0, Math.abs(px - o.x) - 500), Math.max(0, Math.abs(pz - o.z) - 500));
      const hi = d < (o.hi ? 150 : 110) && camera.position.y < 260;
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
