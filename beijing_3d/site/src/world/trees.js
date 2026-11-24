// Instanced trees for the tiles near the camera. One low-poly crown, reshaped per species in the vertex shader,
// lit with wrap diffuse + back-light translucency so foliage glows against a low sun.

import * as THREE from 'three';
import { PRECISION, ENV_UNIFORMS, NOISE, ATMOSPHERE, SHADOWS, LIGHTING } from '../engine/shaderlib.js';

const TREE_VERT_COMMON = /* glsl */`
in vec3 position;
in vec3 aN;         // crown normal (puffy: partly from the lobe, partly from the whole crown)
in float aT;        // 1 = trunk vertex (position = unit circle x/z, y 0..1 up the trunk)
in vec4 aInst;      // x, y, z, crown radius
in float aKS;       // kind * 256 + seed
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uTreeScale;
uniform float uTreeGrow;
uniform vec4 uTimeNight;
vec3 treeVertex(out float kind, out float seed, out vec3 local, out vec3 nrm) {
  kind = floor(aKS / 256.0);
  seed = (aKS - kind * 256.0) / 255.0;
  float r = aInst.w * uTreeScale * uTreeGrow;
  float a = seed * 6.2831;
  float c = cos(a), s = sin(a);
  mat2 rot = mat2(c, -s, s, c);
  bool conifer = kind > 0.5 && kind < 1.5, poplar = kind > 2.5;
  if (aT > 0.5) {
    // trunk: a tapering post with a flared foot, reaching up into the crown
    float hT = conifer ? 0.55 : poplar ? 0.75 : 1.08;
    float tr = (conifer ? 0.050 : 0.062) * (1.0 + 0.9 * (1.0 - position.y) * (1.0 - position.y) * (1.0 - position.y));
    vec2 xz = rot * position.xz;
    local = vec3(0.0, -3.0, 0.0);
    nrm = vec3(xz.x, 0.0, xz.y);
    return aInst.xyz + vec3(xz.x * tr, position.y * hT, xz.y * tr) * r;
  }
  vec3 p = position;
  vec3 n = aN;
  local = p;
  // species shapes
  if (conifer) {
    // tall cone
    float t = p.y * 0.5 + 0.5;
    p.xz *= mix(0.78, 0.10, t);
    p.y = p.y * 1.55 + 0.75;
    n = normalize(vec3(n.x, n.y * 0.45 + 0.25, n.z));
  } else if (poplar) {
    // upright ellipsoid
    p.xz *= 0.62; p.y = p.y * 1.45 + 0.75;
    n = normalize(vec3(n.x, n.y * 0.5, n.z));
  } else {
    // broadleaf / ginkgo: wide crown, flat base
    p.y = p.y * (0.78 + 0.25 * seed) + 0.35;
    if (p.y < 0.0) p.y *= 0.55;
    p.xz *= 1.0 + 0.18 * sin(seed * 40.0 + p.y * 3.0);
  }
  // rotate each crown and wobble vertices so no two look alike
  p.xz = rot * p.xz;
  n.xz = rot * n.xz;
  p += normalize(position) * (0.13 * sin(dot(position, vec3(7.1, 3.3, 5.7)) + seed * 31.0));
  vec3 wp = aInst.xyz + vec3(0.0, r * 0.95, 0.0) + p * r;
  // gentle sway
  float sway = sin(uTimeNight.x * (0.9 + seed) + aInst.x * 0.05 + aInst.z * 0.04) * 0.05 * r * max(local.y + 0.3, 0.0);
  wp.x += sway; wp.z += sway * 0.6;
  nrm = n;
  return wp;
}`;

const VERT = /* glsl */`${PRECISION}
${TREE_VERT_COMMON}
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
flat out vec2 vKS;
void main() {
  float kind, seed; vec3 local, n;
  vec3 wp = (modelMatrix * vec4(treeVertex(kind, seed, local, n), 1.0)).xyz;
  vWorld = wp; vLocal = local; vKS = vec2(kind, seed);
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */`${PRECISION}
${ENV_UNIFORMS}
uniform vec3 cameraPosition;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
flat in vec2 vKS;
out vec4 fragColor;
${NOISE}
${ATMOSPHERE}
${SHADOWS}
${LIGHTING}
void main() {
  float kind = vKS.x, seed = vKS.y;
  vec3 n = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float r2 = fract(seed * 7.31), r3 = fract(seed * 13.7 + 0.3);
  if (vLocal.y < -2.0) {
    // bark
    vec3 bark = mix(vec3(0.115, 0.095, 0.078), vec3(0.20, 0.185, 0.165), r2) * (0.85 + 0.3 * hash12(floor(vWorld.xy * 9.0)));
    bark = snowOn(bark, n, vWorld, 0.3);
    float shb = sunShadow(vWorld, n) * cloudShadow(vWorld);
    vec3 lb = bark * (uSunColor * clamp(dot(n, uSunDir) * 0.5 + 0.5, 0.0, 1.0) * shb + hemiAmbient(n) * 0.7);
    fragColor = vec4(applyFog(lb, vWorld, cameraPosition), 1.0);
    return;
  }
  vec3 col;
  if (kind > 0.5 && kind < 1.5) {
    col = mix(vec3(0.045, 0.105, 0.055), vec3(0.075, 0.135, 0.065), r2);                    // cypress / pine
  } else {
    vec3 green = mix(vec3(0.115, 0.215, 0.055), vec3(0.185, 0.275, 0.075), r2);
    vec3 gold = mix(vec3(0.72, 0.50, 0.06), vec3(0.80, 0.60, 0.10), r3);
    vec3 russet = mix(vec3(0.52, 0.22, 0.05), vec3(0.42, 0.11, 0.04), r3);
    float turn;
    if (kind > 1.5 && kind < 2.5) { turn = smoothstep(0.15, 0.55, uSeason); col = mix(green, gold, turn); }          // ginkgo: pure gold
    else if (kind > 2.5) { turn = smoothstep(0.55, 1.1, uSeason + (r2 - 0.5) * 0.7); col = mix(green, mix(gold, vec3(0.50, 0.42, 0.10), 0.4), turn * 0.7); }
    else {
      turn = smoothstep(0.84, 1.14, uSeason * 0.9 + r3 * 0.6);
      col = mix(green, r2 > 0.6 ? russet : mix(gold, green, 0.35), turn);
    }
  }
  if (uSnow > 0.0) {
    // deciduous crowns are bare twigs in winter; snow sits on every bough
    bool evergreen = kind > 0.5 && kind < 1.5;
    if (!evergreen) {
      // twiggy, see-through crowns rather than solid balls
      if (uSnow > 0.35 && hash13(floor(vLocal * 7.0) + seed * 17.0) > 0.46 - 0.2 * vLocal.y) discard;
      col = mix(col, mix(vec3(0.115, 0.095, 0.08), vec3(0.17, 0.145, 0.12), r2), uSnow);
    }
    col = mix(col, vec3(0.60, 0.63, 0.68), uSnow * smoothstep(0.0, 0.8, n.y) * (evergreen ? 0.6 : 0.34));
  }
  // leaf clumps: broad masses, then the flicker of individual sprays up close
  float dist = length(cameraPosition - vWorld);
  float clump = vnoise(vLocal.xz * 5.0 + vLocal.y * 4.0 + seed * 50.0);
  float leaf = vnoise(vLocal.xy * 21.0 + vLocal.z * 17.0 + seed * 90.0) - 0.5;
  col *= 0.84 + 0.30 * clump + 0.34 * leaf * (1.0 - smoothstep(120.0, 520.0, dist));
  // the crown is darkest underneath and in the creases between its masses
  float ao = mix(0.40, 1.0, smoothstep(-0.75, 0.55, vLocal.y)) * mix(0.72, 1.0, smoothstep(0.35, 0.95, length(vLocal)));
  float sh = sunShadow(vWorld, n) * cloudShadow(vWorld);
  // foliage: wrapped diffuse + light leaking through the crown
  float ndl = dot(n, uSunDir);
  float wrap = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
  float back = pow(max(dot(V, -uSunDir), 0.0), 2.0) * clamp(0.5 - 0.5 * ndl, 0.0, 1.0);
  vec3 leafT = col * vec3(1.35, 1.25, 0.55);
  vec3 lit = col * (uSunColor * wrap * sh + hemiAmbient(n) * ao) + leafT * uSunColor * back * sh * 0.55;
  lit = applyFog(lit, vWorld, cameraPosition);
  fragColor = vec4(lit, 1.0);
}`;

const DEPTH_VERT = /* glsl */`${PRECISION}
${TREE_VERT_COMMON}
void main() {
  float kind, seed; vec3 local, n;
  vec3 wp = (modelMatrix * vec4(treeVertex(kind, seed, local, n), 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor; void main() { fragColor = vec4(1.0); }`;

// ---- crown geometry ---------------------------------------------------------------------------------------------------
// near: a crown of several overlapping masses on a trunk; far: one faceted ball on a stick.
function sphereMesh(detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position');
  // weld the non-indexed icosphere
  const map = new Map(), verts = [], index = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = map.get(k);
    if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(k, id); }
    index.push(id);
  }
  g.dispose();
  return { verts, index };
}

function buildTreeGeometry(lobes, trunkSides) {
  const ball = sphereMesh(1);
  const pos = [], nrm = [], trunk = [], index = [];
  for (let li = 0; li < lobes.length; li++) {
    const [cx, cy, cz, r] = lobes[li];
    const base = pos.length / 3;
    const hidden = [];
    for (let i = 0; i < ball.verts.length; i += 3) {
      const x = cx + ball.verts[i] * r, y = cy + ball.verts[i + 1] * r, z = cz + ball.verts[i + 2] * r;
      pos.push(x, y, z);
      // puffy normal: mostly the lobe's own, leaning towards the direction from the middle of the crown
      const l = Math.hypot(x, y, z) || 1;
      const k = lobes.length > 1 ? 0.4 : 0;
      const nx = ball.verts[i] * (1 - k) + x / l * k, ny = ball.verts[i + 1] * (1 - k) + y / l * k, nz = ball.verts[i + 2] * (1 - k) + z / l * k;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / nl, ny / nl, nz / nl); trunk.push(0);
      // vertices buried inside another mass never show
      let h = false;
      for (let lj = 0; lj < lobes.length && !h; lj++) if (lj !== li) { const o = lobes[lj]; h = Math.hypot(x - o[0], y - o[1], z - o[2]) < o[3] * 0.93; }
      hidden.push(h);
    }
    for (let i = 0; i < ball.index.length; i += 3) {
      const a = ball.index[i], b = ball.index[i + 1], c = ball.index[i + 2];
      if (hidden[a] && hidden[b] && hidden[c]) continue;
      index.push(base + a, base + b, base + c);
    }
  }
  const tb = pos.length / 3;
  for (let i = 0; i < trunkSides; i++) {
    const a = i / trunkSides * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    pos.push(x, 0, z, x, 1, z); nrm.push(x, 0, z, x, 0, z); trunk.push(1, 1);
  }
  for (let i = 0; i < trunkSides; i++) {
    const a = tb + 2 * i, b = tb + 2 * ((i + 1) % trunkSides);
    index.push(a, a + 1, b + 1, a, b + 1, b);
  }
  return {
    position: new THREE.BufferAttribute(new Float32Array(pos), 3), aN: new THREE.BufferAttribute(new Float32Array(nrm), 3),
    aT: new THREE.BufferAttribute(new Float32Array(trunk), 1), index: new THREE.BufferAttribute(new Uint16Array(index), 1), tris: index.length / 3,
  };
}

const CHUNKS = 3;      // each 2 km tile is split 3 x 3 so that culling and the near crowns work on ~670 m squares

export class TreeLayer {
  constructor({ env, scene, shadowScene, terrain, quality }) {
    this.env = env; this.scene = scene; this.shadowScene = shadowScene; this.terrain = terrain; this.quality = quality;
    this.far = buildTreeGeometry([[0, 0, 0, 1]], 3);
    this.near = buildTreeGeometry([[0, 0.0, 0, 0.74], [0.46, -0.10, 0.14, 0.50], [-0.40, -0.04, 0.34, 0.52], [-0.10, -0.12, -0.50, 0.50], [0.08, 0.44, -0.04, 0.52], [0.34, 0.12, -0.38, 0.40], [-0.36, 0.26, -0.20, 0.38]], 6);
    this.nearRange = quality.treeNear ?? 0;
    this.tiles = new Map();
    this.group = new THREE.Group(); this.group.name = 'trees';
    this.shadowGroup = new THREE.Group();
    scene.add(this.group); shadowScene.add(this.shadowGroup);
    this.count = 0;
    this.dirty = false;
  }

  _materials() {
    const scale = { value: 1 }, grow = { value: 0 };
    const u = { ...this.env.uniforms, uTreeScale: scale, uTreeGrow: grow };
    const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: u });
    const depth = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG,
      uniforms: { uTreeScale: scale, uTreeGrow: grow, uTimeNight: this.env.uniforms.uTimeNight } });
    return { mat, depth, scale, grow };
  }

  _geometry(src, inst, ks, n, sphere) {
    const geo = new THREE.InstancedBufferGeometry();
    // own copies of the (tiny) crown mesh: disposing one chunk must not free GPU buffers that other chunks still draw from
    geo.setAttribute('position', src.position.clone()); geo.setAttribute('aN', src.aN.clone()); geo.setAttribute('aT', src.aT.clone()); geo.setIndex(src.index.clone());
    geo.setAttribute('aInst', inst); geo.setAttribute('aKS', ks);
    geo.instanceCount = n;
    geo.boundingSphere = sphere;
    return geo;
  }

  /** trees: Float32Array [x, z, r, kindSeed] tile-local metres; tile: { ox, oy } world origin (x east, y north) */
  add(key, tile, trees) {
    const n = trees.length / 4;
    if (!n) return;
    const wx0 = tile.ox, wz0 = -tile.oy;
    const size = 2000 / CHUNKS;
    // bucket by chunk, keeping the (shuffled) order so any prefix of a chunk is still a fair sample
    const cell = new Uint8Array(n), counts = new Array(CHUNKS * CHUNKS).fill(0);
    for (let i = 0; i < n; i++) {
      const cx = Math.min(CHUNKS - 1, Math.max(0, Math.floor(trees[4 * i] / size))), cz = Math.min(CHUNKS - 1, Math.max(0, Math.floor(-trees[4 * i + 1] / size)));
      cell[i] = cz * CHUNKS + cx; counts[cell[i]]++;
    }
    const m = this._materials();
    const chunks = [];
    for (let c = 0; c < CHUNKS * CHUNKS; c++) {
      const cn = counts[c];
      if (!cn) continue;
      const inst = new Float32Array(cn * 4), ks = new Float32Array(cn);
      let k = 0, maxY = 20;
      for (let i = 0; i < n; i++) {
        if (cell[i] !== c) continue;
        const x = wx0 + trees[4 * i], z = wz0 + trees[4 * i + 1];
        const y = this.terrain.heightAt(x, z);
        inst[4 * k] = x; inst[4 * k + 1] = y; inst[4 * k + 2] = z; inst[4 * k + 3] = trees[4 * i + 2];
        ks[k++] = trees[4 * i + 3];
        if (y > maxY) maxY = y;
      }
      const cx = wx0 + ((c % CHUNKS) + 0.5) * size, cz = wz0 - (Math.floor(c / CHUNKS) + 0.5) * size;
      const sphere = new THREE.Sphere(new THREE.Vector3(cx, maxY / 2, cz), size * 0.75 + maxY);
      const aInst = new THREE.InstancedBufferAttribute(inst, 4), aKS = new THREE.InstancedBufferAttribute(ks, 1);
      const far = this._geometry(this.far, aInst, aKS, cn, sphere), near = this.nearRange > 0 ? this._geometry(this.near, aInst, aKS, cn, sphere) : null;
      const mesh = new THREE.Mesh(far, m.mat); mesh.renderOrder = 2;
      const shadow = new THREE.Mesh(far, m.depth);
      this.group.add(mesh); this.shadowGroup.add(shadow);
      chunks.push({ far, near, mesh, shadow, n: cn, cx, cz, isNear: false });
    }
    this.tiles.set(key, { chunks, n, m, cx: wx0 + 1000, cz: wz0 - 1000, t: 0, lod: 1 });
    this.count += n;
    this.dirty = true;
  }

  remove(key) {
    const t = this.tiles.get(key); if (!t) return;
    for (const c of t.chunks) {
      this.group.remove(c.mesh); this.shadowGroup.remove(c.shadow);
      c.far.dispose(); if (c.near) c.near.dispose();
    }
    t.m.mat.dispose(); t.m.depth.dispose();
    this.count -= t.n;
    this.tiles.delete(key);
    this.dirty = true;
  }

  update(camera, dt) {
    const e = camera.position;
    for (const t of this.tiles.values()) {
      if (t.t < 1) { t.t = Math.min(1, t.t + dt / 0.9); t.m.grow.value = 1 - Math.pow(1 - t.t, 3); this.dirty = true; }
      const d = Math.hypot(t.cx - e.x, e.y, t.cz - e.z);
      // far tiles draw a random subset with slightly larger crowns
      const lod = d < 3000 ? 1 : d < 5200 ? 0.55 : 0.28;
      if (lod !== t.lod) {
        t.lod = lod;
        for (const c of t.chunks) { const k = Math.max(1, Math.floor(c.n * lod)); c.far.instanceCount = k; if (c.near) c.near.instanceCount = k; }
        t.m.scale.value = lod === 1 ? 1 : lod > 0.5 ? 1.18 : 1.4;
        this.dirty = true;
      }
      if (this.nearRange > 0) {
        for (const c of t.chunks) {
          const dc = Math.hypot(c.cx - e.x, e.y, c.cz - e.z);
          // hysteresis keeps a chunk from flickering between the two crowns at the boundary
          const near = c.isNear ? dc < this.nearRange * 1.12 : dc < this.nearRange;
          if (near !== c.isNear) { c.isNear = near; c.mesh.geometry = near ? c.near : c.far; }
        }
      }
    }
  }
}
