// Always-loaded 3D Mountain Terrain, Two-River Water (Yangtze vs Jialing confluence at Chaotianmen!),
// and distant 3D draped roads & elevated decks.
// Replaces flat base plane with real 3D Copernicus DEM mountain meshes (fine + coarse 64km backdrop) that cast sun shadows
// and feature slope-based mossy sandstone cliffs and lush subtropical Nanshan/Geleshan canopy shading!

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE, SM } from '../engine/glsl.js';
import { gbufferMaterial, depthMaterial } from '../engine/materials.js';
import { fetchBinary } from './data.js';

const WATER_FN = /* glsl */`
uniform float uTime;
// River surface ripples & gentle downstream currents
vec3 waterNormal(vec2 p, float dist) {
  float t = uTime;
  vec2 g = vec2(0.0);
  // Subtle river swells flowing east-northeast down the gorges
  vec4 w0 = vec4(0.84, -0.54, 7.6, 0.017), w1 = vec4(-0.32, 0.95, 4.3, 0.012), w2 = vec4(0.95, 0.30, 2.4, 0.0075), w3 = vec4(-0.68, -0.73, 1.35, 0.0045);
  for (int i = 0; i < 4; i++) {
    vec4 w = i == 0 ? w0 : i == 1 ? w1 : i == 2 ? w2 : w3;
    float k = 6.2831853 / w.z;
    float ph = dot(w.xy, p) * k + t * sqrt(9.8 * k) * 0.58;
    g += w.xy * (w.w * k * cos(ph));
  }
  float fade = 1.0 / (1.0 + dist * 0.0038);
  g *= 1.0 / (1.0 + dist * 0.011);
  vec2 q = p * 1.85 + vec2(t * 0.42, -t * 0.18);
  float e = 0.12;
  float n0 = vnoise(q), nx = vnoise(q + vec2(e, 0.0)), ny = vnoise(q + vec2(0.0, e));
  vec2 q2 = p * 4.6 - vec2(t * 0.55, -t * 0.35);
  float m0 = vnoise(q2), mx = vnoise(q2 + vec2(e, 0.0)), my = vnoise(q2 + vec2(0.0, e));
  g += (vec2(nx - n0, ny - n0) * 0.12 + vec2(mx - m0, my - m0) * 0.055) / e * fade;
  vec2 q3 = p * 0.30 + vec2(-t * 0.12, t * 0.08);
  float k0 = vnoise(q3), kx = vnoise(q3 + vec2(e, 0.0)), ky = vnoise(q3 + vec2(0.0, e));
  g += vec2(kx - k0, ky - k0) * 0.065 / e * mix(0.28, 1.0, fade);
  g *= mix(0.32, 1.0, fade);
  return normalize(vec3(-g.x, 1.0, -g.y));
}

// Chongqing signature "两江交汇 · 鸳鸯锅" Two-River Water Color:
//   - Jialing River (NW of Yuzhong Peninsula & West bank downstream): clearer deep emerald/jade-green
//   - Yangtze River (SE of Yuzhong Peninsula & East bank downstream): warm silt-olive-amber
//   - Swirling turbulent mixing front starting crisply right at Chaotianmen prow (1186, -1120)
float waterJialingMix(vec2 p) {
  float swirl = (fbm2(p * 0.0042 + vec2(uTime * 0.008, -uTime * 0.005)) - 0.5) * 190.0;
  float signedDist;
  float width;
  if (p.y > -1120.0) {
    // Upstream of Chaotianmen prow: Yuzhong Peninsula spine separates Jialing (north, z < zSpine) from Yangtze (south, z > zSpine)
    float zSpine = p.x >= 0.0 ? (-0.944 * p.x) : (-0.12 * p.x);
    signedDist = zSpine - p.y;
    width = 55.0;
  } else {
    // Downstream of Chaotianmen prow (1186, -1120) flowing NNW toward Chaotianmen Bridge (402, -3131)
    float down = -1120.0 - p.y;
    float seamX = 1186.0 - down * 0.365;
    signedDist = (seamX - p.x) + swirl * smoothstep(25.0, 950.0, down);
    width = clamp(34.0 + down * 0.095, 34.0, 260.0);
  }
  return smoothstep(-width, width, signedDist);
}

vec3 waterAlbedo(vec2 p, out float isJialing) {
  float fineS = vnoise(p * 0.015) * 0.6 + vnoise(p * 0.055 + 7.0) * 0.4;
  isJialing = waterJialingMix(p);
  vec3 yangtze = mix(vec3(0.112, 0.090, 0.040), vec3(0.168, 0.128, 0.054), fineS);
  vec3 jialing = mix(vec3(0.014, 0.068, 0.064), vec3(0.030, 0.104, 0.090), fineS);
  return mix(yangtze, jialing, isJialing);
}
`;

const TERRAIN_VERT = /* glsl */`${PRECISION}
in vec3 position;
in vec4 aNrm;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform sampler2D tNearMask;
uniform vec4 uGrid;            // x0, north0, tile size, hasNearMask
out vec3 vWorld; out vec3 vNormal;
bool isNearTile(vec2 xz) {
  ivec2 tc = ivec2(floor((xz.x - uGrid.x) / uGrid.z), floor((-xz.y - uGrid.y) / uGrid.z));
  ivec2 sz = textureSize(tNearMask, 0);
  return tc.x >= 0 && tc.y >= 0 && tc.x < sz.x && tc.y < sz.y && texelFetch(tNearMask, tc, 0).r > 0.5;
}
void main() {
  vec3 p = position;
  // Sink far terrain well beneath interior near tiles (-14m exceeds worst 30m DEM chord error even on Nanshan 45deg cliffs!)
  // while still solidly backing any sub-pixel Shapely polygon T-junction crack so sky never peeks through!
  if (uGrid.w > 0.5 && isNearTile(p.xz)) {
    bool interior = isNearTile(p.xz + vec2(35.0, 0.0)) && isNearTile(p.xz - vec2(35.0, 0.0))
      && isNearTile(p.xz + vec2(0.0, 35.0)) && isNearTile(p.xz - vec2(0.0, 35.0));
    p.y -= interior ? 14.0 : 1.25;
  }
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(aNrm.xyz * (1.0 / 127.0));
  gl_Position = projectionMatrix * (viewMatrix * w);
}`;

const TERRAIN_DEPTH_VERT = /* glsl */`${PRECISION}
in vec3 position;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform sampler2D tNearMask;
uniform vec4 uGrid;
bool isNearTile(vec2 xz) {
  ivec2 tc = ivec2(floor((xz.x - uGrid.x) / uGrid.z), floor((-xz.y - uGrid.y) / uGrid.z));
  ivec2 sz = textureSize(tNearMask, 0);
  return tc.x >= 0 && tc.y >= 0 && tc.x < sz.x && tc.y < sz.y && texelFetch(tNearMask, tc, 0).r > 0.5;
}
void main() {
  vec3 p = position;
  if (uGrid.w > 0.5 && isNearTile(p.xz)) {
    bool interior = isNearTile(p.xz + vec2(32.0, 0.0)) && isNearTile(p.xz - vec2(32.0, 0.0))
      && isNearTile(p.xz + vec2(0.0, 32.0)) && isNearTile(p.xz - vec2(0.0, 32.0));
    p.y -= interior ? 18.0 : 0.45;
  }
  gl_Position = projectionMatrix * (viewMatrix * (modelMatrix * vec4(p, 1.0)));
}`;

const TERRAIN_DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }`;

const TERRAIN_FRAG = (lib) => /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
${lib.glsl}
#ifndef L_CLIFF_ROCK
#define L_CLIFF_ROCK L_GRANITE
#define S_CLIFF_ROCK S_GRANITE
#endif
${WATER_FN}
uniform sampler2D tFarLand;
uniform sampler2D tNearMask;
uniform vec4 uGrid;
uniform vec4 uFarRect;         // x0, north0, mpp, hasFarLand
uniform vec2 uFarSize;
uniform vec3 uCamPosW;
uniform float uWaterY;
in vec3 vWorld; in vec3 vNormal;
void main() {
  Surface s = defaultSurface();
  vec3 N = normalize(vNormal);
  vec2 W = vWorld.xz;
  float dist = length(vWorld - uCamPosW);
  float macro = vnoise(W * 0.018) * 0.6 + vnoise(W * 0.095 + 3.7) * 0.4;
  vec2 uv = vec2(W.x, -W.y);

  // Check if inside the far_land 20m raster
  vec2 q = vec2(W.x - uFarRect.x, -W.y - uFarRect.y) / max(uFarRect.z, 1.0);
  bool inLand = uFarRect.w > 0.5 && q.x >= 0.0 && q.y >= 0.0 && q.x < uFarSize.x && q.y < uFarSize.y;
  int cover = 2, lu = 0; // default outside city: subtropical mountain forest
  if (inLand) {
    vec2 warp = (vec2(vnoise(W * 0.07), vnoise(W * 0.07 + 31.0)) - 0.5) * 1.4;
    ivec2 qi = clamp(ivec2(q + warp), ivec2(0), ivec2(uFarSize) - 1);
    int code = int(texelFetch(tFarLand, qi, 0).r * 255.0 + 0.5);
    cover = code & 15; lu = code >> 4;
  }

  if (inLand && cover == 6 && vWorld.y <= uWaterY + 0.6) {
    float isJialing = 0.0;
    s.albedo = waterAlbedo(W, isJialing); s.normal = waterNormal(W, dist); s.roughness = mix(0.095, 0.065, isJialing); s.reflectance = mix(0.27, 0.38, isJialing); s.model = ${SM.WATER}.0;
    writeGBuffer(s); return;
  }

  vec3 c; float rough = 0.88;
  bool isVeg = !inLand || cover == 1 || cover == 2 || cover == 3 || cover == 7;
  if (cover == 1 || cover == 7) {
    c = matSample(L_GRASS, uv * 0.11).albedo * mix(vec3(0.58, 0.80, 0.52), vec3(0.84, 0.88, 0.58), macro);
  } else if (!inLand || cover == 2) {
    // Lush subtropical Chongqing evergreen mountain forest (Nanshan, Geleshan, Tongluoshan)
    float big = fbm(W * 0.0022);
    c = mix(vec3(0.068, 0.138, 0.058), vec3(0.125, 0.185, 0.075), big * 0.7 + macro * 0.3);
    // Subtle subtropical canopy crown breakup at mid-range
    float lod = 1.0 - smoothstep(1400.0, 9500.0, dist);
    if (lod > 0.01) {
      vec2 cq = W * 0.18; vec2 id = floor(cq), f = fract(cq);
      float dmin = 1.0, r = 0.5;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        float dd = length(g + hash22(id + g) - f);
        if (dd < dmin) { dmin = dd; r = hash12(id + g + 5.3); }
      }
      c *= mix(1.0, (0.86 + 0.28 * r) * (0.86 + 0.22 * smoothstep(0.75, 0.15, dmin)), lod);
    }
  } else if (cover == 3) {
    c = matSample(L_GRASS, uv * 0.11).albedo * vec3(0.50, 0.68, 0.45);
  } else if (cover == 4) {
    float dir = hash12(floor(W / 110.0)) * 3.14159;
    float rows = sin((W.x * cos(dir) + W.y * sin(dir)) * 6.2831853 / 2.2);
    c = mix(vec3(0.15, 0.13, 0.08), vec3(0.10, 0.18, 0.06), 0.5 + 0.3 * rows) * (0.75 + 0.5 * hash12(floor(W / 110.0) + 3.0));
  } else if (cover == 5) {
    c = matSample(L_SOIL, uv * 0.13).albedo * 0.88;
  } else if (cover == 8) {
    c = vec3(0.09, 0.21, 0.12);
  } else if (cover == 9) {
    c = vec3(0.40, 0.34, 0.24);
  } else {
    c = matSample(L_CONCRETE, uv * 0.11).albedo * 0.58;
    if (lu == 4) c *= vec3(1.06, 1.04, 1.00);
    else if (lu == 2) c *= vec3(0.88, 0.88, 0.86);
    else if (lu == 8) c = mix(c, vec3(0.28, 0.22, 0.16), 0.6);
  }

  // Steep slope sandstone cliff rock exposure on Chongqing hills & riverbanks (N.y < 0.84)
  float cliff = smoothstep(0.85, 0.60, N.y);
  if (cliff > 0.01) {
    float strata = sin(vWorld.y * 0.85 + vnoise(W * 0.04) * 3.2) * 0.5 + 0.5;
    vec3 rock = mix(vec3(0.24, 0.22, 0.19), vec3(0.36, 0.31, 0.25), strata * 0.65 + macro * 0.35);
    float moss = smoothstep(0.42, 0.78, fbm2(W * 0.06 + vWorld.y * 0.04)) * (isVeg ? 0.65 : 0.35);
    rock = mix(rock, vec3(0.09, 0.15, 0.07), moss);
    c = mix(c, rock, cliff);
    rough = mix(rough, 0.84, cliff);
  }

  // Subtle darker damp riverbank band right near the water line
  float shore = smoothstep(uWaterY + 5.0, uWaterY + 0.2, vWorld.y);
  c = mix(c, vec3(0.22, 0.20, 0.16), shore * 0.55);

  s.albedo = c * (0.86 + 0.28 * macro);
  s.normal = N;
  s.roughness = max(rough, 0.92);
  s.reflectance = 0.16;
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
  float isJialing = 0.0;
  s.albedo = waterAlbedo(vWorld.xz, isJialing);
  s.normal = waterNormal(vWorld.xz, dist);
  s.roughness = mix(0.095, 0.062, isJialing);
  s.reflectance = mix(0.27, 0.38, isJialing);
  s.model = ${SM.WATER}.0;
  writeGBuffer(s);
}`;

const ROAD_VERT = /* glsl */`${PRECISION}
in vec3 position; in vec4 aAttr;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vWorld; out vec4 vAttr;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vAttr = aAttr; gl_Position = projectionMatrix * (viewMatrix * w); }`;

const ROAD_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform vec4 uNight;
uniform sampler2D tNearMask;
uniform vec4 uGrid;
in vec3 vWorld; in vec4 vAttr;
void main() {
  if (uGrid.w > 0.5) {
    ivec2 tc = ivec2(floor((vWorld.x - uGrid.x) / uGrid.z), floor((-vWorld.z - uGrid.y) / uGrid.z));
    ivec2 sz = textureSize(tNearMask, 0);
    if (tc.x >= 0 && tc.y >= 0 && tc.x < sz.x && tc.y < sz.y && texelFetch(tNearMask, tc, 0).r > 0.5) discard;
  }
  Surface s = defaultSurface();
  float cls = floor(vAttr.x + 0.5);
  float across = (vAttr.y * 2.0 - 1.0) * vAttr.w;
  vec3 c = vec3(0.066, 0.066, 0.070) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.05));
  float px = fwidth(across);
  if (cls >= 2.0 && cls <= 4.0 && vAttr.w > 4.0) c = mix(c, vec3(0.42, 0.36, 0.14), (1.0 - smoothstep(0.12, 0.12 + px, abs(across))) * clamp(0.35 / px, 0.0, 1.0));
  if (cls <= 1.0) c = mix(c, vec3(0.5), (1.0 - smoothstep(0.1, 0.1 + px, abs(abs(across) - vAttr.w + 0.5))) * clamp(0.3 / px, 0.0, 1.0));
  s.albedo = c; s.roughness = 0.85;
  if (uNight.y > 0.01 && cls <= 5.0) {
    float bead = smoothstep(0.35, 0.0, abs(fract(vAttr.z / 34.0) - 0.5) * 34.0 / max(3.0, px * 60.0)) * smoothstep(1.6, 0.4, abs(abs(across) - vAttr.w + 0.3) / max(1.0, px * 30.0));
    s.emissive = vec3(1.0, 0.76, 0.44) * (bead * mix(0.28, 3.2, clamp(px * 0.6, 0.0, 1.0)) + 0.025) * uNight.y;
  }
  writeGBuffer(s);
}`;

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
uniform vec4 uGrid;
uniform vec3 uCamPosW;
in vec3 vWorld; in vec4 vAttr;
void main() {
  ivec2 tc = ivec2(floor((vWorld.x - uGrid.x) / uGrid.z), floor((-vWorld.z - uGrid.y) / uGrid.z));
  ivec2 sz = textureSize(tNearMask, 0);
  if (tc.x >= 0 && tc.y >= 0 && tc.x < sz.x && tc.y < sz.y && texelFetch(tNearMask, tc, 0).r > 0.5) discard;
  Surface s = defaultSurface();
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(n, uCamPosW - vWorld) < 0.0) n = -n;
  s.normal = n;
  float cls = floor(vAttr.x + 0.5);
  if (cls > 31.5) {
    s.albedo = vec3(0.36, 0.355, 0.34) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.11 + vWorld.y * 0.3));
    s.roughness = 0.88;
    writeGBuffer(s); return;
  }
  float across = (vAttr.y * 2.0 - 1.0) * vAttr.w;
  vec3 c = vec3(0.068, 0.068, 0.070) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.05));
  float px = fwidth(across);
  c = mix(c, vec3(0.5), (1.0 - smoothstep(0.1, 0.1 + px, abs(abs(across) - vAttr.w + 1.0))) * clamp(0.3 / px, 0.0, 1.0));
  c = mix(c, vec3(0.33, 0.325, 0.31), smoothstep(vAttr.w - 0.45 - px, vAttr.w - 0.45, abs(across)));
  s.albedo = c; s.roughness = 0.85;
  if (uNight.y > 0.01) {
    float bead = smoothstep(0.35, 0.0, abs(fract(vAttr.z / 34.0) - 0.5) * 34.0 / max(3.0, px * 60.0)) * smoothstep(1.6, 0.4, abs(abs(across) - vAttr.w + 0.3) / max(1.0, px * 30.0));
    s.emissive = vec3(1.0, 0.76, 0.44) * (bead * mix(0.28, 3.2, clamp(px * 0.6, 0.0, 1.0)) + 0.025) * uNight.y;
  }
  writeGBuffer(s);
}`;

export class FarGround {
  constructor({ scenes, env, lib, pool, terrain }) {
    this.scenes = scenes; this.env = env; this.lib = lib; this.pool = pool; this.terrain = terrain;
    this.uCam = { value: new THREE.Vector3() };
    this.uTime = env.uniforms.uTime;
    this.water = gbufferMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: { uTime: this.uTime, uCamPosW: this.uCam }, name: 'water' });
    this.ready = false;
    this.deckMeshes = [];
    this.terrainMeshes = [];
  }

  async load(grid, nearMask = null) {
    const waterY = this.terrain ? (this.terrain.waterY ?? 0.0) : 0.0;
    if (!nearMask) {
      nearMask = new THREE.DataTexture(new Uint8Array(grid.nx * grid.ny), grid.nx, grid.ny, THREE.RedFormat, THREE.UnsignedByteType);
      nearMask.minFilter = nearMask.magFilter = THREE.NearestFilter; nearMask.unpackAlignment = 1; nearMask.generateMipmaps = false; nearMask.needsUpdate = true;
    }
    const uGrid = { value: new THREE.Vector4(grid.x0, grid.y0, grid.tile, 1) };
    this.roads = gbufferMaterial({ vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG, uniforms: { uNight: this.env.uniforms.uNight, tNearMask: { value: nearMask }, uGrid }, name: 'farRoads' });
    this.decks = gbufferMaterial({ vertexShader: DECK_VERT, fragmentShader: DECK_FRAG, side: THREE.DoubleSide, name: 'farDecks',
      uniforms: { uNight: this.env.uniforms.uNight, tNearMask: { value: nearMask }, uGrid, uCamPosW: this.uCam } });
    const deckDepth = depthMaterial({ side: THREE.DoubleSide });

    // ---- 1. Coarse 20m land-cover raster (optional if building early)
    let farLandTex = new THREE.DataTexture(new Uint8Array([2]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    farLandTex.needsUpdate = true;
    let farRect = new THREE.Vector4(grid.x0, grid.y0, 20, 0), farSize = new THREE.Vector2(1, 1);
    try {
      const lb = await fetchBinary('far_land.bin');
      const dv = new DataView(lb);
      const w = dv.getUint32(0, true), h = dv.getUint32(4, true), x0 = dv.getFloat32(8, true), y0 = dv.getFloat32(12, true), mpp = dv.getFloat32(16, true);
      farLandTex = new THREE.DataTexture(new Uint8Array(lb, 20, w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType);
      farLandTex.minFilter = farLandTex.magFilter = THREE.NearestFilter; farLandTex.unpackAlignment = 1; farLandTex.generateMipmaps = false; farLandTex.needsUpdate = true;
      farRect.set(x0, y0, mpp, 1); farSize.set(w, h);
    } catch (e) { console.warn('[farGround] far_land.bin unavailable, using mountain forest shading:', e.message || e); }

    const terrainMat = gbufferMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG(this.lib),
      name: 'farTerrain',
      uniforms: {
        ...this.lib.uniforms,
        tFarLand: { value: farLandTex },
        uFarRect: { value: farRect },
        uFarSize: { value: farSize },
        tNearMask: { value: nearMask },
        uGrid,
        uTime: this.uTime,
        uCamPosW: this.uCam,
        uWaterY: { value: waterY },
      },
    });
    const terrainDepth = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TERRAIN_DEPTH_VERT,
      fragmentShader: TERRAIN_DEPTH_FRAG,
      uniforms: { tNearMask: { value: nearMask }, uGrid },
      side: THREE.DoubleSide,
      colorWrite: false,
    });
    terrainDepth.name = 'farTerrainDepth';

    // ---- 2. Build true 3D DEM terrain meshes (fine 30m city relief + coarse 100m 64km mountain backdrop)
    const meshJobs = [];
    if (this.terrain && !this.terrain.synthetic && this.terrain.fine) {
      const f = this.terrain.fine;
      // Inner core (step 2 = 20m around Yuzhong/Nanshan) + full fine grid (step 3 = 30m covering all 25x23km)
      meshJobs.push(this.pool.run({ type: 'terrainMesh', which: 'fine', step: 3, hole: null, exagOuter: 0 }).then((res) => {
        if (!res || !res.nVerts) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(res.pos, 3));
        geo.setAttribute('aNrm', new THREE.BufferAttribute(res.nrm, 4));
        geo.setIndex(new THREE.BufferAttribute(res.index, 1));
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, terrainMat);
        m.frustumCulled = false; m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
        const sh = new THREE.Mesh(geo, terrainDepth);
        sh.frustumCulled = false; sh.matrixAutoUpdate = false; sh.updateMatrix(); sh.updateMatrixWorld(true);
        sh.layers.enable(1);
        this.scenes.opaque.add(m); this.scenes.shadow.add(sh);
        this.terrainMeshes.push(m);
      }));
      if (this.terrain.coarse) {
        const pad = 250;
        const hole = [f.x0 + pad, f.y0 + pad, f.x0 + f.nx * f.cell - pad, f.y0 + f.ny * f.cell - pad];
        meshJobs.push(this.pool.run({ type: 'terrainMesh', which: 'coarse', step: 1, hole, exagOuter: 0.25 }).then((res) => {
          if (!res || !res.nVerts) return;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(res.pos, 3));
          geo.setAttribute('aNrm', new THREE.BufferAttribute(res.nrm, 4));
          geo.setIndex(new THREE.BufferAttribute(res.index, 1));
          geo.computeBoundingSphere();
          const m = new THREE.Mesh(geo, terrainMat);
          m.frustumCulled = false; m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
          this.scenes.opaque.add(m);
          this.terrainMeshes.push(m);
        }));
      }
    } else {
      // Synthetic fallback plane if DEM hasn't arrived yet
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      const base = new THREE.Mesh(g, terrainMat);
      base.scale.set(80000, 1, 80000); base.position.set(0, -1.3, 0); base.frustumCulled = false; base.updateMatrixWorld();
      this.scenes.opaque.add(base);
    }

    // ---- 3. Water polygons + distant 3D draped roads + distant decks from far_ground.bin
    try {
      const buf = await fetchBinary('far_ground.bin');
      const d = new DataView(buf);
      const n = d.getUint32(4, true), CH = d.getFloat32(8, true);
      const v2 = d.getUint8(3) === 0x32;
      const ES = v2 ? 28 : 20;
      const blocks = new Map();
      const B = 4;
      for (let k = 0; k < n; k++) {
        const o = 12 + k * ES;
        const ci = d.getUint16(o, true), cj = d.getUint16(o + 2, true);
        const wo = d.getUint32(o + 4, true), wl = d.getUint32(o + 8, true);
        const ro = d.getUint32(o + 12, true), rl = d.getUint32(o + 16, true);
        const dko = v2 ? d.getUint32(o + 20, true) : 0, dkl = v2 ? d.getUint32(o + 24, true) : 0;
        const key = Math.floor(ci / B) * 1000 + Math.floor(cj / B);
        if (!blocks.has(key)) blocks.set(key, []);
        blocks.get(key).push({ ci, cj, wo, wl, ro, rl, dko, dkl });
      }
      for (const [key, list] of blocks) {
        const bi = Math.floor(key / 1000), bj = key % 1000;
        const cx2 = grid.x0 + (bi + 0.5) * B * CH, cn2 = grid.y0 + (bj + 0.5) * B * CH;
        const chunks = [], tr = [];
        for (const c of list) {
          const water = c.wl ? buf.slice(c.wo, c.wo + c.wl) : null;
          const roads = c.rl ? buf.slice(c.ro, c.ro + c.rl) : null;
          const decks = c.dkl ? buf.slice(c.dko, c.dko + c.dkl) : null;
          if (water) tr.push(water); if (roads) tr.push(roads); if (decks) tr.push(decks);
          chunks.push({ ox: grid.x0 + c.ci * CH - cx2, on: grid.y0 + c.cj * CH - cn2, water, roads, decks });
        }
        meshJobs.push(this.pool.run({ type: 'far', chunks, cx: cx2, cz: -cn2 }, tr).then((out) => {
          const R = B * CH * 0.85;
          if (out.water) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('aXZ', new THREE.BufferAttribute(out.water.pos, 2));
            geo.setIndex(new THREE.BufferAttribute(out.water.index, 1));
            geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R);
            const m = new THREE.Mesh(geo, this.water);
            m.position.set(cx2, waterY, -cn2); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
            this.scenes.opaque.add(m);
          }
          if (out.roads) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(out.roads.pos, 3));
            geo.setAttribute('aAttr', new THREE.BufferAttribute(out.roads.attr, 4));
            geo.setIndex(new THREE.BufferAttribute(out.roads.index, 1));
            geo.computeBoundingSphere();
            const m = new THREE.Mesh(geo, this.roads);
            m.position.set(cx2, 0, -cn2); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
            this.scenes.opaque.add(m);
          }
          if (out.decks) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(out.decks.pos, 3));
            geo.setAttribute('aAttr', new THREE.BufferAttribute(out.decks.attr, 4));
            geo.setIndex(new THREE.BufferAttribute(out.decks.index, 1));
            geo.computeBoundingSphere();
            const m = new THREE.Mesh(geo, this.decks);
            m.position.set(cx2, 0, -cn2); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
            const sh = new THREE.Mesh(geo, deckDepth);
            sh.position.copy(m.position); sh.position.y = -1.2; sh.matrixAutoUpdate = false; sh.updateMatrix(); sh.updateMatrixWorld(true); sh.layers.enable(1);
            this.scenes.opaque.add(m); this.scenes.shadow.add(sh);
            this.deckMeshes.push(m);
          }
        }));
      }
    } catch (e) {
      console.warn('[farGround] far_ground.bin unavailable:', e.message || e);
    }

    await Promise.all(meshJobs);
    this.ready = true;
  }

  update(camera) { this.uCam.value.copy(camera.position); }
}
