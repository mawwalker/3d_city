// Always-loaded ground: a base plane coloured from the 20 m land-cover map, every water body as crisp polygons with an
// animated surface, and all roads as ribbons. Street-level tiles sit on top of this near the camera.

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE, SM } from '../engine/glsl.js';
import { gbufferMaterial, depthMaterial } from '../engine/materials.js';
import { fetchBinary } from './data.js';

const BASE_VERT = /* glsl */`${PRECISION}
in vec3 position;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * (viewMatrix * w); }`;

const WATER_FN = /* glsl */`
uniform float uTime;
// normal of the river surface at world xz: a few travelling swells plus wind ripples, fading out with distance
vec3 waterNormal(vec2 p, float dist) {
  float t = uTime;
  vec2 g = vec2(0.0);
  // (direction, wavelength, amplitude, speed)
  vec4 w0 = vec4(0.80, 0.60, 7.3, 0.018), w1 = vec4(-0.35, 0.94, 4.1, 0.012), w2 = vec4(0.96, -0.28, 2.3, 0.007), w3 = vec4(-0.7, -0.71, 1.3, 0.004);
  for (int i = 0; i < 4; i++) {
    vec4 w = i == 0 ? w0 : i == 1 ? w1 : i == 2 ? w2 : w3;
    float k = 6.2831853 / w.z;
    float ph = dot(w.xy, p) * k + t * sqrt(9.8 * k) * 0.55;
    g += w.xy * (w.w * k * cos(ph));
  }
  float fade = 1.0 / (1.0 + dist * 0.004);
  // the regular swells would line up into streaks towards the horizon: let them die away with distance
  g *= 1.0 / (1.0 + dist * 0.012);
  // ripples
  vec2 q = p * 1.9 + vec2(t * 0.35, t * 0.21);
  float e = 0.12;
  float n0 = vnoise(q), nx = vnoise(q + vec2(e, 0.0)), ny = vnoise(q + vec2(0.0, e));
  vec2 q2 = p * 4.7 - vec2(t * 0.5, -t * 0.4);
  float m0 = vnoise(q2), mx = vnoise(q2 + vec2(e, 0.0)), my = vnoise(q2 + vec2(0.0, e));
  g += (vec2(nx - n0, ny - n0) * 0.13 + vec2(mx - m0, my - m0) * 0.06) / e * fade;
  vec2 q3 = p * 0.33 + vec2(-t * 0.11, t * 0.07);
  float k0 = vnoise(q3), kx = vnoise(q3 + vec2(e, 0.0)), ky = vnoise(q3 + vec2(0.0, e));
  g += vec2(kx - k0, ky - k0) * 0.07 / e * mix(0.3, 1.0, fade);
  g *= mix(0.35, 1.0, fade);
  return normalize(vec3(-g.x, 1.0, -g.y));
}
vec3 waterAlbedo(vec2 p) {
  // the Huangpu carries silt: a dull green-brown with slow streaks
  float s = vnoise(p * 0.012) * 0.6 + vnoise(p * 0.05 + 7.0) * 0.4;
  return mix(vec3(0.060, 0.068, 0.046), vec3(0.105, 0.098, 0.062), s);
}
`;

const BASE_FRAG = (lib) => /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
${lib.glsl}
${WATER_FN}
uniform sampler2D tFarLand;
uniform vec4 uFarRect;         // x0, north0 (SW corner, data frame), metres per pixel, unused
uniform vec2 uFarSize;
uniform vec3 uCamPosW;
in vec3 vWorld;
void main() {
  Surface s = defaultSurface();
  vec2 W = vWorld.xz;
  vec2 warp = (vec2(vnoise(W * 0.07), vnoise(W * 0.07 + 31.0)) - 0.5) * 1.4;
  vec2 q = vec2(W.x - uFarRect.x, -W.y - uFarRect.y) / uFarRect.z + warp;
  ivec2 qi = clamp(ivec2(q), ivec2(0), ivec2(uFarSize) - 1);
  int code = int(texelFetch(tFarLand, qi, 0).r * 255.0 + 0.5);
  int cover = code & 15, lu = code >> 4;
  float macro = vnoise(W * 0.021) * 0.6 + vnoise(W * 0.11 + 3.7) * 0.4;
  vec2 uv = vec2(W.x, -W.y);
  vec3 c; float rough = 0.9;
  if (cover == 6) {
    float dist = length(vWorld - uCamPosW);
    s.albedo = waterAlbedo(W); s.normal = waterNormal(W, dist); s.roughness = 0.07; s.reflectance = 0.36; s.model = ${SM.WATER}.0;
    writeGBuffer(s); return;
  }
  if (cover == 1 || cover == 7) c = matSample(L_GRASS, uv * 0.11).albedo * mix(vec3(0.7, 0.85, 0.65), vec3(0.95, 0.95, 0.7), macro);
  else if (cover == 2) c = matSample(L_GRASS, uv * 0.09).albedo * vec3(0.38, 0.52, 0.36);
  else if (cover == 3) c = matSample(L_GRASS, uv * 0.11).albedo * vec3(0.55, 0.7, 0.5);
  else if (cover == 4) {
    float dir = hash12(floor(W / 110.0)) * 3.14159;
    float rows = sin((W.x * cos(dir) + W.y * sin(dir)) * 6.2831853 / 2.2);
    c = mix(vec3(0.16, 0.13, 0.09), vec3(0.11, 0.17, 0.06), 0.5 + 0.3 * rows) * (0.75 + 0.5 * hash12(floor(W / 110.0) + 3.0));
  }
  else if (cover == 5) c = matSample(L_SOIL, uv * 0.13).albedo * 0.9;
  else if (cover == 8) c = vec3(0.10, 0.22, 0.12);
  else if (cover == 9) c = vec3(0.42, 0.36, 0.26);
  else {
    c = matSample(L_CONCRETE, uv * 0.11).albedo * 0.62;
    if (lu == 4) c *= vec3(1.08, 1.06, 1.02); else if (lu == 2) c *= vec3(0.9, 0.9, 0.88); else if (lu == 8) c = mix(c, vec3(0.3, 0.24, 0.17), 0.6);
  }
  s.albedo = c * (0.85 + 0.3 * macro);
  s.roughness = rough;
  writeGBuffer(s);
}`;

const WATER_VERT = /* glsl */`${PRECISION}
in vec2 aXZ;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(aXZ.x, 0.0, aXZ.y, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * (viewMatrix * w); }`;
const WATER_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
${WATER_FN}
uniform vec3 uCamPosW;
in vec3 vWorld;
void main() {
  Surface s = defaultSurface();
  float dist = length(vWorld - uCamPosW);
  s.albedo = waterAlbedo(vWorld.xz);
  s.normal = waterNormal(vWorld.xz, dist);
  s.roughness = 0.07; s.reflectance = 0.36; s.model = ${SM.WATER}.0;
  writeGBuffer(s);
}`;

const ROAD_VERT = /* glsl */`${PRECISION}
in vec2 aXZ; in vec4 aAttr;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vWorld; out vec4 vAttr;
void main() { vec4 w = modelMatrix * vec4(aXZ.x, 0.0, aXZ.y, 1.0); vWorld = w.xyz; vAttr = aAttr; gl_Position = projectionMatrix * (viewMatrix * w); }`;
const ROAD_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform vec4 uNight;
in vec3 vWorld; in vec4 vAttr;
void main() {
  Surface s = defaultSurface();
  float cls = floor(vAttr.x + 0.5);
  float across = (vAttr.y * 2.0 - 1.0) * vAttr.w;        // metres from the centre line
  vec3 c = vec3(0.068, 0.068, 0.070) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.05));
  // a centre line on the wider roads, visible from a few hundred metres up
  float px = fwidth(across);
  if (cls >= 2.0 && cls <= 4.0 && vAttr.w > 4.0) c = mix(c, vec3(0.42, 0.36, 0.14), (1.0 - smoothstep(0.12, 0.12 + px, abs(across))) * clamp(0.35 / px, 0.0, 1.0));
  if (cls <= 1.0) c = mix(c, vec3(0.5), (1.0 - smoothstep(0.1, 0.1 + px, abs(abs(across) - vAttr.w + 0.5))) * clamp(0.3 / px, 0.0, 1.0));
  s.albedo = c; s.roughness = 0.85;
  // street lighting seen from afar: beads of lamps along the kerbs
  if (uNight.y > 0.01 && cls <= 5.0) {
    float bead = smoothstep(0.35, 0.0, abs(fract(vAttr.z / 34.0) - 0.5) * 34.0 / max(3.0, px * 60.0)) * smoothstep(1.6, 0.4, abs(abs(across) - vAttr.w + 0.3) / max(1.0, px * 30.0));
    // close up the real lamps take over: keep the beads from blooming into a solid band
    s.emissive = vec3(1.0, 0.78, 0.48) * (bead * mix(0.25, 3.0, clamp(px * 0.6, 0.0, 1.0)) + 0.02) * uNight.y;
  }
  writeGBuffer(s);
}`;

// elevated ways seen from afar; dropped wherever the street-level tile (with the detailed decks) is loaded
const DECK_VERT = /* glsl */`${PRECISION}
in vec3 position; in vec4 aAttr;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vWorld; out vec4 vAttr;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vAttr = aAttr; gl_Position = projectionMatrix * (viewMatrix * w); }`;
const DECK_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform vec4 uNight;
uniform sampler2D tNearMask;
uniform vec4 uGrid;            // x0, north0, tile size, unused
uniform vec3 uCamPosW;
in vec3 vWorld; in vec4 vAttr;
void main() {
  ivec2 tc = ivec2(floor((vWorld.x - uGrid.x) / uGrid.z), floor((-vWorld.z - uGrid.y) / uGrid.z));
  if (texelFetch(tNearMask, tc, 0).r > 0.5) discard;
  Surface s = defaultSurface();
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(n, uCamPosW - vWorld) < 0.0) n = -n;
  s.normal = n;
  float cls = floor(vAttr.x + 0.5);
  if (cls > 31.5) {
    // structure: weathered concrete
    s.albedo = vec3(0.36, 0.355, 0.34) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.11 + vWorld.y * 0.3));
    s.roughness = 0.88;
    writeGBuffer(s); return;
  }
  float across = (vAttr.y * 2.0 - 1.0) * vAttr.w;
  vec3 c = vec3(0.068, 0.068, 0.070) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.05));
  float px = fwidth(across);
  // edge lines and the parapets that hem the carriageway in
  c = mix(c, vec3(0.5), (1.0 - smoothstep(0.1, 0.1 + px, abs(abs(across) - vAttr.w + 1.0))) * clamp(0.3 / px, 0.0, 1.0));
  c = mix(c, vec3(0.33, 0.325, 0.31), smoothstep(vAttr.w - 0.45 - px, vAttr.w - 0.45, abs(across)));
  s.albedo = c; s.roughness = 0.85;
  if (uNight.y > 0.01) {
    float bead = smoothstep(0.35, 0.0, abs(fract(vAttr.z / 34.0) - 0.5) * 34.0 / max(3.0, px * 60.0)) * smoothstep(1.6, 0.4, abs(abs(across) - vAttr.w + 0.3) / max(1.0, px * 30.0));
    s.emissive = vec3(1.0, 0.78, 0.48) * (bead * mix(0.25, 3.0, clamp(px * 0.6, 0.0, 1.0)) + 0.02) * uNight.y;
  }
  writeGBuffer(s);
}`;

export class FarGround {
  constructor({ scenes, env, lib, pool }) {
    this.scenes = scenes; this.env = env; this.lib = lib; this.pool = pool;
    this.uCam = { value: new THREE.Vector3() };
    this.uTime = env.uniforms.uTime;
    this.water = gbufferMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: { uTime: this.uTime, uCamPosW: this.uCam }, name: 'water' });
    this.roads = gbufferMaterial({ vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG, uniforms: { uNight: env.uniforms.uNight }, name: 'farRoads' });
    this.ready = false;
    this.deckMeshes = [];
  }

  /** nearMask: R8 texture, one texel per tile, > 0 where the street-level tile (and with it the detailed decks) is shown. */
  async load(grid, nearMask = null) {
    if (!nearMask) { nearMask = new THREE.DataTexture(new Uint8Array(grid.nx * grid.ny), grid.nx, grid.ny, THREE.RedFormat, THREE.UnsignedByteType); nearMask.needsUpdate = true; }
    this.decks = gbufferMaterial({ vertexShader: DECK_VERT, fragmentShader: DECK_FRAG, side: THREE.DoubleSide, name: 'farDecks',
      uniforms: { uNight: this.env.uniforms.uNight, tNearMask: { value: nearMask }, uGrid: { value: new THREE.Vector4(grid.x0, grid.y0, grid.tile, 0) }, uCamPosW: this.uCam } });
    const deckDepth = depthMaterial({ side: THREE.DoubleSide });
    // ---- base plane with the coarse land-cover map
    const lb = await fetchBinary('far_land.bin');
    const dv = new DataView(lb);
    const w = dv.getUint32(0, true), h = dv.getUint32(4, true), x0 = dv.getFloat32(8, true), y0 = dv.getFloat32(12, true), mpp = dv.getFloat32(16, true);
    const tex = new THREE.DataTexture(new Uint8Array(lb, 20, w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.unpackAlignment = 1; tex.generateMipmaps = false; tex.needsUpdate = true;
    const mat = gbufferMaterial({ vertexShader: BASE_VERT, fragmentShader: BASE_FRAG(this.lib), name: 'farBase',
      uniforms: { ...this.lib.uniforms, tFarLand: { value: tex }, uFarRect: { value: new THREE.Vector4(x0, y0, mpp, 0) }, uFarSize: { value: new THREE.Vector2(w, h) }, uTime: this.uTime, uCamPosW: this.uCam } });
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const base = new THREE.Mesh(g, mat);
    const cx = x0 + w * mpp / 2, cn = y0 + h * mpp / 2;
    base.scale.set(w * mpp + 240000, 1, h * mpp + 240000);
    base.position.set(cx, -1.3, -cn); base.frustumCulled = false; base.updateMatrixWorld();
    this.scenes.opaque.add(base);
    this.base = base;
    // ---- water + roads, in 8 km blocks
    const buf = await fetchBinary('far_ground.bin');
    const d = new DataView(buf);
    const n = d.getUint32(4, true), CH = d.getFloat32(8, true);
    const v2 = d.getUint8(3) === 0x32;                  // 'SHG2': each entry also has the elevated decks
    const ES = v2 ? 28 : 20;
    const blocks = new Map();
    const B = 4;
    for (let k = 0; k < n; k++) {
      const o = 12 + k * ES;
      const ci = d.getUint16(o, true), cj = d.getUint16(o + 2, true), wo = d.getUint32(o + 4, true), wl = d.getUint32(o + 8, true), ro = d.getUint32(o + 12, true), rl = d.getUint32(o + 16, true);
      const dko = v2 ? d.getUint32(o + 20, true) : 0, dkl = v2 ? d.getUint32(o + 24, true) : 0;
      const key = Math.floor(ci / B) * 1000 + Math.floor(cj / B);
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push({ ci, cj, wo, wl, ro, rl, dko, dkl });
    }
    const jobs = [];
    for (const [key, list] of blocks) {
      const bi = Math.floor(key / 1000), bj = key % 1000;
      const cx2 = grid.x0 + (bi + 0.5) * B * CH, cn2 = grid.y0 + (bj + 0.5) * B * CH;
      const chunks = []; const tr = [];
      for (const c of list) {
        const water = c.wl ? buf.slice(c.wo, c.wo + c.wl) : null, roads = c.rl ? buf.slice(c.ro, c.ro + c.rl) : null, decks = c.dkl ? buf.slice(c.dko, c.dko + c.dkl) : null;
        if (water) tr.push(water); if (roads) tr.push(roads); if (decks) tr.push(decks);
        chunks.push({ ox: grid.x0 + c.ci * CH - cx2, on: grid.y0 + c.cj * CH - cn2, water, roads, decks });
      }
      jobs.push(this.pool.run({ type: 'far', chunks }, tr).then((out) => {
        const R = B * CH * 0.75;
        if (out.water) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('aXZ', new THREE.BufferAttribute(out.water.pos, 2)); geo.setIndex(new THREE.BufferAttribute(out.water.index, 1));
          geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R);
          const m = new THREE.Mesh(geo, this.water); m.position.set(cx2, -1.2, -cn2); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
          this.scenes.opaque.add(m);
        }
        if (out.roads) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('aXZ', new THREE.BufferAttribute(out.roads.pos, 2)); geo.setAttribute('aAttr', new THREE.BufferAttribute(out.roads.attr, 4)); geo.setIndex(new THREE.BufferAttribute(out.roads.index, 1));
          geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R);
          const m = new THREE.Mesh(geo, this.roads); m.position.set(cx2, -0.05, -cn2); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
          this.scenes.opaque.add(m);
        }
        if (out.decks) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(out.decks.pos, 3)); geo.setAttribute('aAttr', new THREE.BufferAttribute(out.decks.attr, 4)); geo.setIndex(new THREE.BufferAttribute(out.decks.index, 1));
          geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 30, 0), R);
          const m = new THREE.Mesh(geo, this.decks); m.position.set(cx2, 0, -cn2); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
          // the caster sits a little low: it is coarser than the detailed deck of a loaded tile and must stay inside it, or it would shade its surface
          const sh = new THREE.Mesh(geo, deckDepth); sh.position.copy(m.position); sh.position.y = -1.25; sh.matrixAutoUpdate = false; sh.updateMatrix(); sh.updateMatrixWorld(true); sh.layers.enable(1);
          this.scenes.opaque.add(m); this.scenes.shadow.add(sh);
          this.deckMeshes.push(m);
        }
      }));
    }
    await Promise.all(jobs);
    this.ready = true;
  }

  update(camera) { this.uCam.value.copy(camera.position); }
}
