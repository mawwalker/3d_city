// Ground material: one G-buffer shader for carriageways, pavements, plazas, kerbs, embankments and block interiors.
// Block interiors read the tile's 2 m land-cover raster (cover type + land use) and blend photographic PBR materials.

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { gbufferMaterial } from '../engine/materials.js';

const VERT = /* glsl */`${PRECISION}
in vec4 aPos; in vec4 aNrm;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform vec4 uTile;            // xy: tile centre modulo the texture period, z: tile size
out vec3 vWorld; out vec3 vNormal; out vec2 vTex; out vec2 vLand;
flat out float vClass;
void main() {
  vec3 p = aPos.xyz * (1.0 / 40.0);
  vClass = aPos.w;
  vNormal = aNrm.xyz * (1.0 / 127.0);
  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
  vTex = p.xz + uTile.xy;
  vLand = vec2(p.x, -p.z) / uTile.z + 0.5;
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(p, 1.0));
}`;

const FRAG = (lib) => /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
${lib.glsl}
uniform sampler2D tLand;
uniform vec4 uLandInfo;        // x: raster size, y: 1 when the raster is present
in vec3 vWorld; in vec3 vNormal; in vec2 vTex; in vec2 vLand;
flat in float vClass;

MatS paved(int lu, vec2 uv, float macro) {
  // paving inside a block depends on what the block is used for
  if (lu == 3 || lu == 15) return matSample(L_SLABS, uv * S_SLABS);
  if (lu == 1) return matSample(L_PAVERS_BRICK, uv * S_PAVERS_BRICK);
  if (lu == 8) return matSample(L_SOIL, uv * S_SOIL);
  if (lu == 13 || lu == 2) {
    MatS a = matSample(L_ASPHALT, uv * S_ASPHALT); a.albedo *= 0.62;
    MatS c = matSample(L_CONCRETE, uv * S_CONCRETE); c.albedo *= 0.85;
    return matMix(a, c, smoothstep(0.45, 0.6, macro));
  }
  MatS c = matSample(L_CONCRETE, uv * S_CONCRETE); c.albedo *= 0.82;
  return c;
}

void main() {
  int cls = int(vClass + 0.5);
  vec3 N = normalize(vNormal);
  Surface s = defaultSurface();
  vec2 uv = vec2(vTex.x, -vTex.y);                       // metres: +u east, +v north
  vec2 W = vWorld.xz;
  float macro = vnoise(W * 0.043) * 0.6 + vnoise(W * 0.19 + 3.7) * 0.4;
  float fine = vnoise(W * 1.7);
  MatS m;
  vec3 T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, -1.0);
  if (cls == 32) {
    // concrete structure of bridges and viaducts
    if (abs(N.y) < 0.5) { T = normalize(vec3(-N.z, 0.0, N.x)); B = vec3(0.0, 1.0, 0.0); }
    vec2 wuv = abs(N.y) < 0.5 ? vec2(dot(vTex, T.xz), vWorld.y) : uv;
    m = matSample(L_CONCRETE, wuv * S_CONCRETE); m.albedo *= 0.62;
    float st = vnoise(vec2(dot(vTex, vec2(0.7, 0.7)) * 1.3, vWorld.y * 0.2));
    m.albedo *= 1.0 - 0.3 * smoothstep(0.5, 0.9, st);
  } else if (cls == 30 || cls == 31) {
    // vertical faces: kerb stone, embankment wall
    T = normalize(vec3(-N.z, 0.0, N.x)); B = vec3(0.0, 1.0, 0.0);
    vec2 wuv = vec2(dot(vTex, T.xz), vWorld.y);
    if (cls == 30) { m = matSample(L_GRANITE, wuv * S_GRANITE); m.albedo *= 0.55; m.rough = max(m.rough, 0.6); }
    else {
      m = matSample(L_CONCRETE, wuv * S_CONCRETE); m.albedo *= 0.7;
      // tide marks and algae towards the water line
      float wet = smoothstep(-0.2, -1.1, vWorld.y);
      m.albedo = mix(m.albedo, m.albedo * vec3(0.42, 0.47, 0.36), wet * (0.6 + 0.4 * fine));
      m.rough = mix(m.rough, 0.45, wet);
    }
  } else if (cls == 1) {
    m = matSample(L_ASPHALT, uv * S_ASPHALT);
    m.albedo *= 0.52;
    // older, lighter patches and the odd repair strip
    MatS w = matSample(L_ASPHALT_WORN, uv * S_ASPHALT_WORN); w.albedo = w.albedo * 2.4 + 0.02;
    m = matMix(m, w, smoothstep(0.52, 0.72, macro) * 0.75);
    m.albedo *= 0.9 + 0.2 * vnoise(W * 0.31);
  } else if (cls == 2) {
    float h = hash12(floor(W / 260.0));
    if (h < 0.55) { m = matSample(L_PAVERS, uv * S_PAVERS); m.albedo *= 0.78; }
    else if (h < 0.82) { m = matSample(L_PAVERS_BRICK, uv * S_PAVERS_BRICK); m.albedo *= 0.9; }
    else { m = matSample(L_SLABS, uv * S_SLABS); m.albedo *= 0.8; }
    m.albedo *= 0.88 + 0.2 * macro;
  } else if (cls == 3) {
    MatS g = matSample(L_GRASS, uv * S_GRASS); g.albedo *= vec3(0.75, 0.85, 0.7);
    MatS so = matSample(L_SOIL, uv * S_SOIL); so.albedo *= 0.7;
    m = matMix(g, so, smoothstep(0.62, 0.8, fine));
  } else if (cls == 5) {
    m = matSample(L_SLABS, uv * S_SLABS); m.albedo *= 0.86 + 0.16 * macro;
  } else if (cls == 8) {
    m = matSample(L_GRAVEL, uv * S_GRAVEL); m.albedo *= vec3(0.62, 0.58, 0.54);
  } else {
    // block interior: land-cover raster, edges broken up so that 2 m cells do not show
    int cover = 0, lu = 0;
    if (uLandInfo.y > 0.5) {
      vec2 warp = (vec2(vnoise(W * 0.83), vnoise(W * 0.83 + 19.3)) - 0.5) * 1.5 + (vec2(vnoise(W * 0.21 + 5.0), vnoise(W * 0.21 + 41.0)) - 0.5) * 1.6;
      ivec2 q = clamp(ivec2(vLand * uLandInfo.x + warp), ivec2(0), ivec2(int(uLandInfo.x) - 1));
      int code = int(texelFetch(tLand, q, 0).r * 255.0 + 0.5);
      cover = code & 15; lu = code >> 4;
    }
    if (cover == 1 || cover == 3 || cover == 7) {
      m = matSample(L_GRASS, uv * S_GRASS);
      m.albedo *= mix(vec3(0.78, 0.9, 0.72), vec3(0.95, 0.95, 0.7), macro);
      if (cover == 3) m.albedo *= vec3(0.7, 0.8, 0.7);
      MatS so = matSample(L_SOIL, uv * S_SOIL); so.albedo *= 0.75;
      m = matMix(m, so, smoothstep(0.7, 0.9, fine * 0.6 + macro * 0.5) * 0.7);
    } else if (cover == 2) {
      // planting under trees: leaf litter, ground cover, bare soil
      MatS l = matSample(L_LEAVES, uv * S_LEAVES); l.albedo *= vec3(0.62, 0.66, 0.5);
      MatS g = matSample(L_GRASS, uv * S_GRASS); g.albedo *= vec3(0.55, 0.7, 0.5);
      m = matMix(l, g, smoothstep(0.35, 0.65, macro));
    } else if (cover == 4) {
      // crops: rows
      MatS so = matSample(L_SOIL, uv * S_SOIL); so.albedo *= 0.8;
      MatS g = matSample(L_GRASS, uv * S_GRASS); g.albedo *= vec3(0.8, 1.0, 0.6);
      float dir = hash12(floor(W / 90.0)) * 3.14159;
      float rows = sin((W.x * cos(dir) + W.y * sin(dir)) * 6.2831853 / 1.4);
      m = matMix(so, g, smoothstep(-0.3, 0.5, rows) * (0.5 + 0.5 * hash12(floor(W / 90.0) + 7.0)));
    } else if (cover == 5) {
      m = matSample(L_SOIL, uv * S_SOIL); m.albedo *= 0.9;
    } else if (cover == 6) {
      // open water known only from the raster (sea, estuary, ponds)
      m.albedo = vec3(0.10, 0.115, 0.09); m.n = vec3(0.0, 0.0, 1.0); m.rough = 0.08;
      s.reflectance = 0.38;
    } else if (cover == 8) {
      m = matSample(L_GRASS, uv * S_GRASS); m.albedo = mix(m.albedo * vec3(0.5, 0.95, 0.55), vec3(0.16, 0.36, 0.2), 0.5); m.rough = 0.8;
    } else if (cover == 9) {
      m = matSample(L_SOIL, uv * S_SOIL); m.albedo = m.albedo * 1.6 + vec3(0.2, 0.17, 0.11);
    } else {
      m = paved(lu, uv, macro);
      m.albedo *= 0.9 + 0.18 * macro;
    }
  }
  s.albedo = m.albedo;
  s.normal = normalize(T * m.n.x + B * m.n.y + N * m.n.z);
  s.roughness = m.rough;
  writeGBuffer(s);
}`;

export function createGroundMaterial(lib) {
  return gbufferMaterial({ vertexShader: VERT, fragmentShader: FRAG(lib), name: 'ground',
    uniforms: { ...lib.uniforms, tLand: { value: null }, uLandInfo: { value: new THREE.Vector4(500, 0, 0, 0) }, uTile: { value: new THREE.Vector4(0, 0, 1000, 0) } } });
}

export const TEX_PERIOD = 8400;
