// Trees. Every tree of the street-level tiles is drawn as a three-quad impostor (two crossed side views + a top view,
// baked once per species from the real model); within ~110 m the impostors dissolve into instanced full models with
// branches, leaf cards and wind. Both cast shadows.

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE, SM } from '../engine/glsl.js';
import { SPECIES, generateTree } from './treeGen.js';

const ASSET_URL = new URL('../../assets/', import.meta.url).href;
const NEAR = 105, FADE = 16;
const GRID = [8, 4];            // impostor atlas cells
const CELL = 256;

const COMMON = /* glsl */`
float ignS(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const MESH_VERT = (depthOnly) => /* glsl */`${PRECISION}
in vec3 position; in vec3 normal; in vec2 uv; in vec4 aParam;
in vec4 iPos; in vec4 iScl;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uTime; uniform vec4 uWind; uniform vec3 uCamW;
out vec2 vUv; out vec4 vParam; out vec3 vNormal; out vec3 vWorld; out float vVar; out float vDist;
void main() {
  vec3 p = position * vec3(iScl.x, iScl.y, iScl.x);
  float c = cos(iPos.w), s = sin(iPos.w);
  p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
  vec3 n = normal / vec3(iScl.x, iScl.y, iScl.x);
  n.xz = vec2(c * n.x - s * n.z, s * n.x + c * n.z);
  vec4 w = modelMatrix * vec4(p + iPos.xyz, 1.0);
  // wind: the whole crown leans and recovers, leaves shiver
  float ph = iScl.w * 6.2831 + w.x * 0.04 + w.z * 0.03;
  float sw = aParam.y * aParam.y * (p.y * 0.1) * uWind.z;
  w.xz += uWind.xy * (sin(uTime * 1.05 + ph) * 0.11 + sin(uTime * 2.4 + ph * 1.7) * 0.04) * sw;
  if (aParam.x > 0.5) w.xyz += n * (sin(uTime * 5.5 + fract(aParam.w) * 90.0 + p.y * 1.3) * 0.022 * uWind.z);
  vUv = uv; vParam = aParam; vNormal = normalize(n); vWorld = w.xyz; vVar = iScl.z;
  vDist = distance(w.xyz, uCamW);
  gl_Position = projectionMatrix * (viewMatrix * w);
}`;

const LEAF_FN = /* glsl */`
uniform sampler2D tFoliage;
vec4 leafTex(vec2 uv, float cell) {
  float cx = mod(cell, 4.0), cy = floor(cell / 4.0);
  vec2 q = (vec2(cx, cy) + clamp(uv, 0.004, 0.996)) / vec2(4.0, 2.0);
  return texture(tFoliage, q);
}`;

const MESH_FRAG = (lib) => /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
${lib.glsl}
${LEAF_FN}
${COMMON}
uniform vec3 uTint; uniform float uBark; uniform vec2 uFade;
in vec2 vUv; in vec4 vParam; in vec3 vNormal; in vec3 vWorld; in float vVar; in float vDist;
void main() {
  if (vDist > uFade.x + uFade.y * ignS(gl_FragCoord.xy)) discard;
  Surface s = defaultSurface();
  vec3 N = normalize(vNormal);
  if (vParam.x < 0.5) {
    MatS m = matSample(uBark > 0.5 ? L_BARK_ROUGH : L_BARK, vec2(vUv.x, vUv.y) * 0.6);
    s.albedo = m.albedo * (uBark > 0.5 ? vec3(0.55, 0.5, 0.45) : vec3(0.85, 0.85, 0.8)); s.roughness = 0.9; s.normal = N;
    s.ao = 0.5 + 0.5 * vParam.z;
  } else {
    float cell = floor(vParam.w);
    // leaves that would brush the lens dissolve instead of filling the view
    if (vDist < 1.3 + 1.4 * ignS(gl_FragCoord.xy + 31.0)) discard;
    vec4 t = leafTex(vUv, cell);
    if (t.a < 0.42) discard;
    vec3 c = t.rgb * t.rgb;                       // approx. sRGB -> linear
    float var = fract(vVar * 7.31);
    c *= uTint * mix(vec3(0.85, 0.95, 0.8), vec3(1.12, 1.08, 0.95), var);
    float light = vParam.z;
    s.albedo = c * mix(0.42, 1.0, light);
    s.normal = gl_FrontFacing ? N : N;
    s.roughness = 0.5; s.ao = mix(0.45, 1.0, light); s.model = ${SM.FOLIAGE}.0; s.reflectance = 0.4;
  }
  writeGBuffer(s);
}`;

const MESH_DEPTH_FRAG = /* glsl */`${PRECISION}
${LEAF_FN}
in vec2 vUv; in vec4 vParam; in vec3 vNormal; in vec3 vWorld; in float vVar; in float vDist;
out vec4 fragColor;
uniform vec2 uFade;
void main() {
  if (vDist > uFade.x + uFade.y) discard;
  if (vParam.x > 0.5 && leafTex(vUv, floor(vParam.w)).a < 0.42) discard;
  fragColor = vec4(0.0);
}`;

// ---- bake: unlit side / top views into the impostor atlas
const BAKE_VERT = /* glsl */`${PRECISION}
in vec3 position; in vec3 normal; in vec2 uv; in vec4 aParam;
uniform mat4 viewMatrix, projectionMatrix;
out vec2 vUv; out vec4 vParam;
void main() { vUv = uv; vParam = aParam; gl_Position = projectionMatrix * (viewMatrix * vec4(position, 1.0)); }`;
const BAKE_FRAG = /* glsl */`${PRECISION}
${LEAF_FN}
uniform vec3 uTint; uniform float uBark;
in vec2 vUv; in vec4 vParam;
out vec4 fragColor;
void main() {
  vec3 c; float a = 1.0;
  if (vParam.x < 0.5) c = (uBark > 0.5 ? vec3(0.16, 0.12, 0.09) : vec3(0.36, 0.34, 0.27)) * (0.5 + 0.5 * vParam.z);
  else { vec4 t = leafTex(vUv, floor(vParam.w)); if (t.a < 0.42) discard; c = t.rgb * t.rgb * uTint * mix(0.42, 1.0, vParam.z); }
  fragColor = vec4(sqrt(c), a);
}`;

const IMP_VERT = /* glsl */`${PRECISION}
in vec3 aPos; in vec4 aNrm; in vec4 aUv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uTime; uniform vec4 uWind; uniform vec3 uCamW;
out vec2 vUv; out float vCell; out vec3 vNormal; out float vVar; out float vDist; out vec3 vToCam;
void main() {
  vec4 w = modelMatrix * vec4(aPos, 1.0);
  float sway = aNrm.w * (1.0 / 127.0);
  w.xz += uWind.xy * sin(uTime * 1.05 + aUv.w * 0.1 + w.x * 0.04 + w.z * 0.03) * 0.09 * sway * uWind.z;
  vUv = aUv.xy * (1.0 / 255.0); vCell = aUv.z; vVar = aUv.w * (1.0 / 255.0);
  vNormal = aNrm.xyz * (1.0 / 127.0);
  vDist = distance(w.xyz, uCamW);
  vToCam = normalize(vec3(uCamW.x - w.x, 0.0, uCamW.z - w.z) + vec3(1e-4, 0.0, 0.0));
  gl_Position = projectionMatrix * (viewMatrix * w);
}`;
const IMP_FN = /* glsl */`
uniform sampler2D tImpostor;
vec4 impTex(vec2 uv, float cell) {
  float cx = mod(cell, ${GRID[0]}.0), cy = floor(cell / ${GRID[0]}.0);
  return texture(tImpostor, (vec2(cx, cy) + clamp(uv, 0.01, 0.99)) / vec2(${GRID[0]}.0, ${GRID[1]}.0));
}`;
const IMP_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
${IMP_FN}
${COMMON}
uniform vec2 uFade;
in vec2 vUv; in float vCell; in vec3 vNormal; in float vVar; in float vDist; in vec3 vToCam;
void main() {
  if (vDist < uFade.x + uFade.y * ignS(gl_FragCoord.xy)) discard;
  vec4 t = impTex(vUv, vCell);
  if (t.a < 0.5) discard;
  Surface s = defaultSurface();
  vec3 c = t.rgb * t.rgb;
  float var = fract(vVar * 7.31);
  s.albedo = c * mix(vec3(0.85, 0.95, 0.8), vec3(1.12, 1.08, 0.95), var);
  // the cards are flat: round the shading off towards the viewer so a crown reads as a volume
  s.normal = normalize(normalize(vNormal) + vToCam * 0.7);
  s.roughness = 0.55; s.ao = 0.85; s.model = ${SM.FOLIAGE}.0; s.reflectance = 0.4;
  writeGBuffer(s);
}`;
const IMP_DEPTH_FRAG = /* glsl */`${PRECISION}
${IMP_FN}
in vec2 vUv; in float vCell; in vec3 vNormal; in float vVar; in float vDist;
uniform vec2 uFade;
out vec4 fragColor;
void main() { if (vDist < uFade.x) discard; if (impTex(vUv, vCell).a < 0.5) discard; fragColor = vec4(0.0); }`;

const raw = (o) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, ...o });

export class TreeLayer {
  constructor({ scenes, env, lib, renderer }) {
    this.scenes = scenes; this.env = env; this.lib = lib; this.renderer = renderer;
    this.tiles = new Map();
    this.species = [];
    this.origin = new THREE.Vector3();
    this._last = new THREE.Vector3(1e9, 0, 1e9);
    this.uFadeMesh = { value: new THREE.Vector2(NEAR, FADE) };
    this.uFadeImp = { value: new THREE.Vector2(NEAR, FADE) };
    this.uCamW = { value: new THREE.Vector3() };
    this.count = 0; this.nearCount = 0;
    this.dirty = false;
  }

  async load() {
    const res = await fetch(ASSET_URL + 'foliage.webp');
    const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const tex = new THREE.Texture(bmp);
    tex.premultiplyAlpha = false; tex.flipY = false; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
    this.foliage = tex;
    const env = this.env.uniforms;
    const shared = { ...this.lib.uniforms, tFoliage: { value: tex }, uTime: env.uTime, uWind: env.uWind, uCamW: this.uCamW };
    // species models + materials
    for (let s = 0; s < SPECIES.length; s++) {
      const sp = SPECIES[s];
      const m = generateTree(s, 1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
      geo.setAttribute('aParam', new THREE.BufferAttribute(m.param, 4));
      geo.setIndex(new THREE.BufferAttribute(m.index, 1));
      const cap = 256;
      const iPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); iPos.setUsage(THREE.DynamicDrawUsage);
      const iScl = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); iScl.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iPos', iPos); geo.setAttribute('iScl', iScl);
      geo.instanceCount = 0;
      const uni = { ...shared, uTint: { value: new THREE.Vector3(...sp.tint) }, uBark: { value: sp.bark }, uFade: this.uFadeMesh };
      const mat = raw({ vertexShader: MESH_VERT(false), fragmentShader: MESH_FRAG(this.lib), uniforms: uni, side: THREE.DoubleSide });
      const dmat = raw({ vertexShader: MESH_VERT(true), fragmentShader: MESH_DEPTH_FRAG, uniforms: uni, side: THREE.DoubleSide, colorWrite: false });
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      const sh = new THREE.Mesh(geo, dmat); sh.frustumCulled = false; sh.matrixAutoUpdate = false;
      this.scenes.opaque.add(mesh); this.scenes.shadow.add(sh);
      this.species.push({ sp, model: m, geo, mesh, sh, cap, n: 0, uni });
    }
    this._bake();
    this.impMat = raw({ vertexShader: IMP_VERT, fragmentShader: IMP_FRAG, uniforms: { tImpostor: { value: this.atlas.texture }, uTime: env.uTime, uWind: env.uWind, uFade: this.uFadeImp, uCamW: this.uCamW }, side: THREE.DoubleSide });
    this.impDepth = raw({ vertexShader: IMP_VERT, fragmentShader: IMP_DEPTH_FRAG, uniforms: this.impMat.uniforms, side: THREE.DoubleSide, colorWrite: false });
  }

  _bake() {
    const r = this.renderer;
    const W = GRID[0] * CELL, H = GRID[1] * CELL;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
    const prevColor = new THREE.Color(); r.getClearColor(prevColor); const prevAlpha = r.getClearAlpha();
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    cam._reversedDepth = r.capabilities.reversedDepthBuffer === true;
    r.setRenderTarget(rt);
    r.setClearColor(new THREE.Color(0.27, 0.33, 0.17), 0);
    r.clear(true, true, false);
    this.frames = [];
    for (let s = 0; s < SPECIES.length; s++) {
      const S = this.species[s], sp = S.sp;
      const geo = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'aParam']) geo.setAttribute(k, S.geo.getAttribute(k));
      geo.setIndex(S.geo.getIndex());
      const mat = raw({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, uniforms: { tFoliage: { value: this.foliage }, uTint: S.uni.uTint, uBark: S.uni.uBark }, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
      scene.add(mesh);
      // frame: half-width of the crown incl. leaf cards, height of the tree
      const hw = sp.R * 1.18 + sp.cardSize * 0.4, hh = sp.H * 1.04 + 0.3;
      this.frames.push({ hw, hh });
      for (let view = 0; view < 2; view++) {
        const cell = s * 2 + view;
        const cx = cell % GRID[0], cy = Math.floor(cell / GRID[0]);
        if (view === 0) { cam.left = -hw; cam.right = hw; cam.bottom = 0; cam.top = hh; cam.position.set(0, 0, 80); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); cam.position.set(0, 0, 80); cam.rotation.set(0, 0, 0); }
        else { cam.left = -hw; cam.right = hw; cam.bottom = -hw; cam.top = hw; cam.position.set(0, 120, 0); cam.rotation.set(-Math.PI / 2, 0, 0); }
        cam.near = 0.1; cam.far = 200; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
        rt.viewport.set(cx * CELL, cy * CELL, CELL, CELL); rt.scissor.set(cx * CELL, cy * CELL, CELL, CELL); rt.scissorTest = true;
        r.setRenderTarget(rt);
        r.render(scene, cam);
      }
      scene.remove(mesh); mat.dispose();
    }
    rt.scissorTest = false; rt.viewport.set(0, 0, W, H);
    r.setRenderTarget(null);
    r.setClearColor(prevColor, prevAlpha);
    this.atlas = rt;
  }

  /** trees: { n, x, y (dm from the tile's SW corner), h (0.25 m), r (0.1 m), sp, seed } */
  addTile(key, t, trees, grid) {
    if (!trees || !trees.n || !this.impMat) return;
    const n = trees.n;
    const ox = grid.x0 + t.i * grid.tile, on = grid.y0 + t.j * grid.tile;       // SW corner (x east, north)
    const pos = new Float32Array(n * 12 * 3), nrm = new Int8Array(n * 12 * 4), uv = new Uint8Array(n * 12 * 4), idx = new Uint32Array(n * 18);
    const wx = new Float32Array(n), wz = new Float32Array(n);
    let o = 0, io = 0;
    const half = grid.tile / 2;
    const put = (x, y, z, nx, ny, nz, sway, u, v, cell, seed) => {
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[o * 4] = nx / l * 127; nrm[o * 4 + 1] = ny / l * 127; nrm[o * 4 + 2] = nz / l * 127; nrm[o * 4 + 3] = sway * 127;
      uv[o * 4] = u * 255; uv[o * 4 + 1] = v * 255; uv[o * 4 + 2] = cell; uv[o * 4 + 3] = seed;
      return o++;
    };
    for (let k = 0; k < n; k++) {
      const s = Math.min(trees.sp[k], SPECIES.length - 1), sp = SPECIES[s], fr = this.frames[s];
      const h = trees.h[k] * 0.25, r = trees.r[k] * 0.1, seed = trees.seed[k];
      // tile-local position (centre origin, z south)
      const lx = trees.x[k] * 0.1 - half, lz = -(trees.y[k] * 0.1 - half);
      wx[k] = ox + trees.x[k] * 0.1; wz[k] = -(on + trees.y[k] * 0.1);
      const sy = h / sp.H, sx = Math.max(0.45, Math.min(2.2, r / sp.R)) ;
      const hw = fr.hw * sx, hh = fr.hh * sy;
      const yaw = seed * 0.0246;
      const y0 = 0.15;
      for (let q = 0; q < 2; q++) {
        const a = yaw + q * Math.PI / 2, dx = Math.cos(a), dz = Math.sin(a);
        // corners: (-1, 0) (1, 0) (1, 1) (-1, 1); the rounded normal points away from the crown centre
        const base = o;
        for (const [cu, cv] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
          put(lx + dx * hw * cu, y0 + hh * cv, lz + dz * hw * cu, dx * cu * 0.9 + (q ? dx : -dz) * 0, cv * 1.5 - 0.35, dz * cu * 0.9, cv, cu * 0.5 + 0.5, cv, s * 2, seed);
        }
        idx[io++] = base; idx[io++] = base + 1; idx[io++] = base + 2; idx[io++] = base; idx[io++] = base + 2; idx[io++] = base + 3;
      }
      // top view, at the widest part of the crown
      const yt = y0 + h * (sp.form === 'cone' ? sp.cb + 0.12 : sp.cb + (1 - sp.cb) * 0.5);
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const base = o;
      for (const [cu, cv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = (c * cu - sn * cv) * hw, pz = (sn * cu + c * cv) * hw;
        put(lx + px, yt, lz + pz, px / hw * 0.55, 0.8, pz / hw * 0.55, 1, cu * 0.5 + 0.5, cv * 0.5 + 0.5, s * 2 + 1, seed);
      }
      idx[io++] = base; idx[io++] = base + 2; idx[io++] = base + 1; idx[io++] = base; idx[io++] = base + 3; idx[io++] = base + 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('aPos', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aNrm', new THREE.BufferAttribute(nrm, 4));
    geo.setAttribute('aUv', new THREE.BufferAttribute(uv, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 15, 0), half * 1.45);
    const mesh = new THREE.Mesh(geo, this.impMat); mesh.position.set(t.x, 0, t.z); mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.updateMatrixWorld(true);
    const sh = new THREE.Mesh(geo, this.impDepth); sh.position.copy(mesh.position); sh.matrixAutoUpdate = false; sh.updateMatrix(); sh.updateMatrixWorld(true);
    this.scenes.opaque.add(mesh); this.scenes.shadow.add(sh);
    // coarse cells for the near-instance query
    const CS = 50, cells = new Map();
    for (let k = 0; k < n; k++) { const ck = Math.floor(wx[k] / CS) * 100003 + Math.floor(wz[k] / CS); let a = cells.get(ck); if (!a) cells.set(ck, a = []); a.push(k); }
    this.tiles.set(key, { mesh, sh, geo, trees, wx, wz, cells, n });
    this.count += n; this._last.set(1e9, 0, 1e9); this.dirty = true;
  }

  removeTile(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    this.scenes.opaque.remove(t.mesh); this.scenes.shadow.remove(t.sh); t.geo.dispose();
    this.tiles.delete(key); this.count -= t.n; this._last.set(1e9, 0, 1e9); this.dirty = true;
  }

  update(camera) {
    if (!this.impMat) return;
    const p = camera.position;
    this.uCamW.value.copy(p);
    if (Math.abs(p.x - this._last.x) < 6 && Math.abs(p.z - this._last.z) < 6 && Math.abs(p.y - this._last.y) < 10) return;
    this._last.copy(p);
    // nothing to instance from high up
    const R = p.y > 220 ? 0 : NEAR + FADE + 8;
    this.uFadeMesh.value.set(p.y > 220 ? -1000 : NEAR, FADE);
    this.uFadeImp.value.set(p.y > 220 ? -1000 : NEAR, FADE);
    this.origin.set(Math.round(p.x / 64) * 64, 0, Math.round(p.z / 64) * 64);
    const lists = this.species.map(() => []);
    if (R > 0) {
      const CS = 50;
      const cx0 = Math.floor((p.x - R) / CS), cx1 = Math.floor((p.x + R) / CS), cz0 = Math.floor((p.z - R) / CS), cz1 = Math.floor((p.z + R) / CS);
      for (const t of this.tiles.values()) {
        for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
          const arr = t.cells.get(cx * 100003 + cz);
          if (!arr) continue;
          for (const k of arr) {
            const dx = t.wx[k] - p.x, dz = t.wz[k] - p.z;
            if (dx * dx + dz * dz > R * R) continue;
            lists[Math.min(t.trees.sp[k], SPECIES.length - 1)].push(t, k);
          }
        }
      }
    }
    let total = 0;
    for (let s = 0; s < this.species.length; s++) {
      const S = this.species[s], L = lists[s], n = L.length / 2;
      if (n > S.cap) {
        S.cap = Math.max(n + 64, S.cap * 2);
        const a = new THREE.InstancedBufferAttribute(new Float32Array(S.cap * 4), 4); a.setUsage(THREE.DynamicDrawUsage);
        const b = new THREE.InstancedBufferAttribute(new Float32Array(S.cap * 4), 4); b.setUsage(THREE.DynamicDrawUsage);
        S.geo.setAttribute('iPos', a); S.geo.setAttribute('iScl', b);
      }
      const ip = S.geo.getAttribute('iPos'), is = S.geo.getAttribute('iScl');
      for (let i = 0; i < n; i++) {
        const t = L[i * 2], k = L[i * 2 + 1];
        const h = t.trees.h[k] * 0.25, r = t.trees.r[k] * 0.1, seed = t.trees.seed[k];
        ip.array[i * 4] = t.wx[k] - this.origin.x; ip.array[i * 4 + 1] = 0.15; ip.array[i * 4 + 2] = t.wz[k] - this.origin.z; ip.array[i * 4 + 3] = seed * 0.0246;
        is.array[i * 4] = Math.max(0.45, Math.min(2.2, r / S.sp.R)); is.array[i * 4 + 1] = h / S.sp.H; is.array[i * 4 + 2] = seed / 255; is.array[i * 4 + 3] = (seed * 37 % 256) / 255;
      }
      ip.needsUpdate = true; is.needsUpdate = true;
      S.geo.instanceCount = n; S.n = n;
      S.mesh.visible = S.sh.visible = n > 0;
      S.mesh.position.copy(this.origin); S.mesh.updateMatrix(); S.mesh.updateMatrixWorld(true);
      S.sh.position.copy(this.origin); S.sh.updateMatrix(); S.sh.updateMatrixWorld(true);
      total += n;
    }
    this.nearCount = total;
    this.dirty = true;
  }
}
