// Chongqing 3D Ground Material (G-buffer shader):
//   - Wet/weathered mountain asphalt, granite kerbs, stone-stepped hillside walkways (青石梯坎 on steep footpaths!)
//   - Chongqing sandstone retaining walls (石砌堡坎, cls 33) with damp moss & rain streaks
//   - Slope-based triplanar mossy cliff rock shading (when N.y < 0.80) for dramatic Yuzhong & Nanshan cliffs!
//   - Riverbank embankments (cls 31) with Yangtze/Jialing waterline silt & algae band near waterY = 0.0

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { gbufferMaterial } from '../engine/materials.js';

const VERT = /* glsl */`${PRECISION}
in vec4 aPos; in vec4 aNrm;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform vec4 uTile;            // xy: tile centre modulo texture period, z: tile size
out vec3 vWorld; out vec3 vNormal; out vec2 vTex; out vec2 vLand;
flat out float vClass;
void main() {
  vec3 p = aPos.xyz;
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
#ifndef L_SANDSTONE
#define L_SANDSTONE L_GRANITE
#define S_SANDSTONE S_GRANITE
#endif
#ifndef L_CLIFF_ROCK
#define L_CLIFF_ROCK L_GRANITE
#define S_CLIFF_ROCK S_GRANITE
#endif
#ifndef L_STONE_STEPS
#define L_STONE_STEPS L_SLABS
#define S_STONE_STEPS S_SLABS
#endif
#ifndef L_ASPHALT_WET
#define L_ASPHALT_WET L_ASPHALT
#define S_ASPHALT_WET S_ASPHALT
#endif

uniform sampler2D tLand;
uniform vec4 uLandInfo;        // x: raster size, y: 1 when raster present, z: waterY
in vec3 vWorld; in vec3 vNormal; in vec2 vTex; in vec2 vLand;
flat in float vClass;

MatS paved(int lu, vec2 uv, float macro) {
  if (lu == 3 || lu == 15) return matSample(L_SLABS, uv * S_SLABS);
  if (lu == 1) return matSample(L_PAVERS_BRICK, uv * S_PAVERS_BRICK);
  if (lu == 8) {
    MatS gr = matSample(L_GRAVEL, uv * S_GRAVEL); gr.albedo *= vec3(0.95, 0.90, 0.82);
    MatS c = matSample(L_CONCRETE, uv * S_CONCRETE); c.albedo *= 0.78;
    return matMix(c, gr, 0.52);
  }
  if (lu == 13 || lu == 2) {
    MatS a = matSample(L_ASPHALT, uv * S_ASPHALT); a.albedo *= 0.60;
    MatS c = matSample(L_CONCRETE, uv * S_CONCRETE); c.albedo *= 0.84;
    return matMix(a, c, smoothstep(0.45, 0.6, macro));
  }
  MatS c = matSample(L_CONCRETE, uv * S_CONCRETE); c.albedo *= 0.80;
  return c;
}

// World triplanar dressed Chongqing sandstone retaining wall (石砌堡坎) for steep urban road-bench cuts & embankments
MatS sampleBaokan(vec3 wp, vec3 N, float macro) {
  vec2 suvX = vec2(wp.z, wp.y) * S_SANDSTONE;
  vec2 suvZ = vec2(wp.x, wp.y) * S_SANDSTONE;
  float wxS = abs(N.x) / (abs(N.x) + abs(N.z) + 1e-4);
  MatS bWall = matMix(matSample(L_SANDSTONE, suvZ), matSample(L_SANDSTONE, suvX), wxS);
  bWall.albedo *= mix(vec3(0.56, 0.52, 0.46), vec3(0.74, 0.68, 0.58), macro);
  float streak = smoothstep(0.50, 0.86, vnoise(vec2((wp.x + wp.z) * 0.72, wp.y * 0.22)));
  bWall.albedo = mix(bWall.albedo, bWall.albedo * vec3(0.46, 0.56, 0.40), streak * 0.46);
  bWall.n = normalize(vec3(bWall.n.xy * 0.55, bWall.n.z));
  bWall.rough = clamp(0.86 + bWall.rough * 0.10, 0.86, 0.96);
  return bWall;
}

// World triplanar cliff rock for steep Chongqing sandstone escarpments & Nanshan rock faces (matte, zero specular glare!)
MatS sampleCliff(vec3 wp, vec3 N, float macro, float fine) {
  vec2 uvX = vec2(wp.z, wp.y) * S_CLIFF_ROCK;
  vec2 uvZ = vec2(wp.x, wp.y) * S_CLIFF_ROCK;
  float wx = abs(N.x) / (abs(N.x) + abs(N.z) + 1e-4);
  MatS rx = matSample(L_CLIFF_ROCK, uvX);
  MatS rz = matSample(L_CLIFF_ROCK, uvZ);
  MatS m = matMix(rz, rx, wx);
  // Warm grey-ochre Chongqing sandstone strata + lush subtropical hillside moss on gentler slopes (zero vertical stretching!)
  float strata = sin(wp.y * 1.4 + vnoise(wp.xz * 0.08) * 3.0) * 0.5 + 0.5;
  m.albedo *= mix(vec3(0.54, 0.50, 0.44), vec3(0.74, 0.66, 0.55), strata * 0.65 + macro * 0.35);
  float moss = smoothstep(0.35, 0.84, N.y) * smoothstep(0.34, 0.74, fbm2(wp.xz * 0.14 + wp.y * 0.04));
  m.albedo = mix(m.albedo, mix(vec3(0.09, 0.15, 0.065), vec3(0.14, 0.20, 0.085), macro), moss * 0.76);
  m.n = normalize(vec3(m.n.xy * 0.48, m.n.z));
  m.rough = clamp(0.88 + fine * 0.08, 0.88, 0.97);
  return m;
}

void main() {
  int cls = int(vClass + 0.5);
  vec3 N = normalize(vNormal);
  Surface s = defaultSurface();
  vec2 uv = vec2(vTex.x, -vTex.y);
  vec2 W = vWorld.xz;
  float waterY = uLandInfo.z;
  float macro = vnoise(W * 0.043) * 0.6 + vnoise(W * 0.19 + 3.7) * 0.4;
  float fine = vnoise(W * 1.7);
  MatS m;
  vec3 T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, -1.0);

  if (cls == 32) {
    // Concrete structure of bridges and mountain viaducts
    if (abs(N.y) < 0.5) { T = normalize(vec3(-N.z, 0.0, N.x)); B = vec3(0.0, 1.0, 0.0); }
    vec2 wuv = abs(N.y) < 0.5 ? vec2(dot(vTex, T.xz), vWorld.y) : uv;
    m = matSample(L_CONCRETE, wuv * S_CONCRETE); m.albedo *= 0.62;
    float st = vnoise(vec2(dot(vTex, vec2(0.7, 0.7)) * 1.3, vWorld.y * 0.18));
    m.albedo *= 1.0 - 0.32 * smoothstep(0.48, 0.88, st);
    m.rough = max(m.rough, 0.84);
    s.reflectance = 0.24;
  } else if (cls == 33) {
    // Chongqing sandstone retaining wall (石砌堡坎) with damp mossy streaks
    T = normalize(vec3(-N.z, 0.0, N.x)); B = vec3(0.0, 1.0, 0.0);
    vec2 wuv = vec2(dot(vTex, T.xz), vWorld.y);
    m = matSample(L_SANDSTONE, wuv * S_SANDSTONE);
    m.albedo *= mix(vec3(0.60, 0.56, 0.50), vec3(0.76, 0.70, 0.60), macro);
    float streak = smoothstep(0.48, 0.85, vnoise(vec2(wuv.x * 1.1, wuv.y * 0.22)));
    m.albedo = mix(m.albedo, m.albedo * vec3(0.48, 0.56, 0.42), streak * 0.50);
    m.rough = clamp(0.86 + m.rough * 0.10, 0.86, 0.96);
    s.reflectance = 0.22;
  } else if (cls == 30 || cls == 31) {
    // Kerb stone (30) and river embankment wall (31)
    T = normalize(vec3(-N.z, 0.0, N.x)); B = vec3(0.0, 1.0, 0.0);
    vec2 wuv = vec2(dot(vTex, T.xz), vWorld.y);
    if (cls == 30) {
      m = matSample(L_GRANITE, wuv * S_GRANITE); m.albedo *= 0.56; m.rough = max(m.rough, 0.78); s.reflectance = 0.28;
    } else {
      m = matSample(L_SANDSTONE, wuv * S_SANDSTONE); m.albedo *= 0.64;
      float wetBand = smoothstep(waterY + 2.8, waterY - 0.2, vWorld.y);
      m.albedo = mix(m.albedo, m.albedo * vec3(0.40, 0.44, 0.34), wetBand * (0.65 + 0.35 * fine));
      m.rough = mix(max(m.rough, 0.86), 0.48, wetBand);
      s.reflectance = mix(0.22, 0.36, wetBand);
    }
  } else if (cls == 1) {
    // Photographic weathered Chongqing asphalt: aggregate grit, subtle tire-polish tracks, micro-cracks & periodic cast-iron manholes!
    m = matSample(L_ASPHALT, uv * S_ASPHALT);
    m.albedo *= 0.44;
    MatS w = matSample(L_ASPHALT_WORN, uv * S_ASPHALT_WORN); w.albedo = w.albedo * 2.0 + 0.018;
    float wearMix = smoothstep(0.46, 0.72, macro) * 0.74;
    m = matMix(m, w, wearMix);
    float grit = vnoise(W * 0.35) * 0.6 + vnoise(W * 2.4 + 4.1) * 0.4;
    m.albedo *= 0.88 + 0.22 * grit;
    // Subtle weathered hairline asphalt fissures (multi-frequency ridge without curly contour loops)
    float cr = abs(fbm2(W * 0.55 + vec2(0.0, vnoise(W * 1.3) * 0.6)) - 0.50);
    float crack = (1.0 - smoothstep(0.004, 0.018, cr)) * smoothstep(0.45, 0.75, macro);
    m.albedo *= 1.0 - crack * 0.16;
    m.rough = clamp(m.rough - crack * 0.14 + (grit - 0.5) * 0.12, 0.34, 0.94);
    // Periodic circular cast-iron street manhole covers (井盖, ~18m cells)
    vec2 mCell = floor(W / 18.0);
    float mHash = hash12(mCell + 13.7);
    if (mHash > 0.62) {
      vec2 mCen = (mCell + 0.30 + 0.40 * hash22(mCell + 3.1)) * 18.0;
      float md = length(W - mCen);
      if (md < 0.46) {
        float rim = smoothstep(0.46, 0.41, md);
        float ring = smoothstep(0.03, 0.0, abs(md - 0.38)) + smoothstep(0.02, 0.0, abs(md - 0.22));
        float hatch = sin((W.x - mCen.x) * 42.0) * sin((W.y - mCen.y) * 42.0);
        vec3 iron = vec3(0.075, 0.078, 0.082) * (0.85 + 0.15 * hatch - 0.22 * ring);
        m.albedo = mix(m.albedo, iron, rim);
        m.rough = mix(m.rough, 0.42, rim);
        s.metalness = rim * 0.68;
        s.ao = mix(s.ao, 0.65, smoothstep(0.46, 0.42, md) * smoothstep(0.39, 0.43, md));
      }
    }
  } else if (cls == 2) {
    // Sidewalks: matte Chongqing bluestone steps (青石梯坎) on steeper footpaths, crisp granite pavers on flat walks!
    float stepSlope = smoothstep(0.982, 0.93, N.y);
    if (stepSlope > 0.35) {
      m = matSample(L_STONE_STEPS, uv * S_STONE_STEPS);
      float riser = smoothstep(0.0, 0.14, fract(vWorld.y * 3.0));
      m.albedo *= vec3(0.74, 0.75, 0.72) * (0.88 + 0.16 * macro) * (0.93 + 0.07 * riser);
      m.rough = clamp(0.84 + m.rough * 0.12, 0.84, 0.95);
      s.reflectance = 0.26;
    } else {
      float h = hash12(floor(W / 240.0));
      if (h < 0.50) { m = matSample(L_PAVERS, uv * S_PAVERS); m.albedo *= 0.74; }
      else if (h < 0.78) { m = matSample(L_PAVERS_BRICK, uv * S_PAVERS_BRICK); m.albedo *= 0.84; }
      else { m = matSample(L_SLABS, uv * S_SLABS); m.albedo *= 0.78; }
      // Subtle physical bevel-jointed 0.55m granite paver grid harmonizing with 1024px PavingStones texture
      vec2 gp = W / 0.55;
      vec2 gid = floor(gp), gf = fract(gp);
      float edgeD = min(min(gf.x, 1.0 - gf.x), min(gf.y, 1.0 - gf.y));
      float groove = 1.0 - smoothstep(0.014, 0.042, edgeD);
      float tileVar = hash12(gid + 19.4);
      m.albedo *= (0.93 + 0.12 * tileVar) * (0.90 + 0.16 * macro) * (1.0 - groove * 0.16);
      m.rough = clamp(max(m.rough, 0.72) + groove * 0.10 + (tileVar - 0.5) * 0.06, 0.70, 0.95);
      s.reflectance = 0.30;
      s.ao = 1.0 - groove * 0.14;
      vec2 bevel = (smoothstep(0.06, 0.0, gf) - smoothstep(0.94, 1.0, gf)) * 0.08;
      m.n = normalize(m.n + vec3(bevel.x, -bevel.y, 0.0));
    }
    // Steep road-bench cut/fill aprons (N.y < 0.88) render as horizontal-coursed triplanar sandstone 堡坎 instead of stretched pavers!
    float wallMix = smoothstep(0.88, 0.70, N.y);
    if (wallMix > 0.01) {
      m = matMix(m, sampleBaokan(vWorld, N, macro), wallMix);
      s.reflectance = mix(s.reflectance, 0.20, wallMix);
    }
  } else if (cls == 3) {
    MatS g = matSample(L_GRASS, uv * S_GRASS); g.albedo *= vec3(0.68, 0.84, 0.62);
    MatS so = matSample(L_SOIL, uv * S_SOIL); so.albedo *= 0.68;
    m = matMix(g, so, smoothstep(0.62, 0.8, fine));
    m.rough = clamp(0.90 + m.rough * 0.08, 0.90, 0.98);
    s.reflectance = 0.14;
    float steepPark = smoothstep(0.90, 0.72, N.y);
    if (steepPark > 0.01) m = matMix(m, sampleCliff(vWorld, N, macro, fine), steepPark);
  } else if (cls == 5) {
    float stepSlope = smoothstep(0.975, 0.92, N.y);
    if (stepSlope > 0.35) {
      m = matSample(L_STONE_STEPS, uv * S_STONE_STEPS);
      // Warm Chongqing bluestone/sandstone stepped terrace risers on sloped plazas (e.g. Grand Theatre riverfront steps)
      float riser = smoothstep(0.0, 0.14, fract(vWorld.y * 2.8));
      m.albedo *= vec3(0.88, 0.85, 0.80) * (0.88 + 0.14 * macro) * (0.93 + 0.07 * riser);
      m.rough = clamp(0.84 + m.rough * 0.12, 0.84, 0.95);
    } else {
      m = matSample(L_SLABS, uv * S_SLABS);
      m.albedo *= vec3(0.92, 0.90, 0.86) * (0.86 + 0.14 * macro);
      m.rough = max(m.rough, 0.74);
    }
    s.reflectance = 0.28;
    float wallMix = smoothstep(0.87, 0.68, N.y);
    if (wallMix > 0.01) {
      m = matMix(m, sampleBaokan(vWorld, N, macro), wallMix);
      s.reflectance = mix(s.reflectance, 0.20, wallMix);
    }
  } else if (cls == 8) {
    m = matSample(L_GRAVEL, uv * S_GRAVEL); m.albedo *= vec3(0.60, 0.56, 0.52);
    m.rough = max(m.rough, 0.88);
    s.reflectance = 0.18;
  } else {
    // Block interior: smooth 2x2 bilinear land-cover blending (eliminates raster pixel staircases & harsh mud splodges!)
    float wGrass = 0.0, wForest = 0.0, wSoil = 0.0, wWater = 0.0;
    int lu = 0;
    if (uLandInfo.y > 0.5) {
      int sz = int(uLandInfo.x);
      // Gentle sub-texel organic break-up so raster boundaries dissolve into natural parkland & stone edges
      vec2 warp = (vec2(vnoise(W * 0.28), vnoise(W * 0.28 + 19.3)) - 0.5) * 0.55;
      vec2 tc = vLand * uLandInfo.x - 0.5 + warp;
      ivec2 q0 = clamp(ivec2(floor(tc)), ivec2(0), ivec2(sz - 1));
      ivec2 q1 = clamp(q0 + ivec2(1, 1), ivec2(0), ivec2(sz - 1));
      vec2 f = clamp(fract(tc), 0.0, 1.0);
      float w00 = (1.0 - f.x) * (1.0 - f.y);
      float w10 = f.x * (1.0 - f.y);
      float w01 = (1.0 - f.x) * f.y;
      float w11 = f.x * f.y;
      int c00 = int(texelFetch(tLand, ivec2(q0.x, q0.y), 0).r * 255.0 + 0.5);
      int c10 = int(texelFetch(tLand, ivec2(q1.x, q0.y), 0).r * 255.0 + 0.5);
      int c01 = int(texelFetch(tLand, ivec2(q0.x, q1.y), 0).r * 255.0 + 0.5);
      int c11 = int(texelFetch(tLand, ivec2(q1.x, q1.y), 0).r * 255.0 + 0.5);
      lu = (c00 >> 4);
      int cov[4] = int[4](c00 & 15, c10 & 15, c01 & 15, c11 & 15);
      float wt[4] = float[4](w00, w10, w01, w11);
      for (int k = 0; k < 4; k++) {
        int cv = cov[k];
        if (cv == 1 || cv == 3 || cv == 4 || cv == 7 || cv == 8) wGrass += wt[k];
        else if (cv == 2) wForest += wt[k];
        else if (cv == 5 || cv == 9) wSoil += wt[k];
        else if (cv == 6) wWater += wt[k];
      }
    }

    // Start with warm matte Chongqing paved stone / concrete base
    m = paved(lu, uv, macro);
    m.albedo *= 0.88 + 0.16 * macro;
    m.rough = max(m.rough, 0.78);
    s.reflectance = 0.24;

    // Gentle weathered sandstone gravel where bare soil is classified (prevents raw dark-brown mud splodges on sidewalks!)
    if (wSoil > 0.05) {
      MatS sg = matSample(L_GRAVEL, uv * S_GRAVEL);
      sg.albedo *= vec3(0.68, 0.64, 0.58);
      sg.rough = max(sg.rough, 0.88);
      m = matMix(m, sg, smoothstep(0.25, 0.85, wSoil) * 0.55);
    }

    // Smooth organic matte vegetation blend (clamp roughness >= 0.90 & suppress L_LEAVES on slopes to eliminate glare & dark cliff stripes!)
    float wVeg = wGrass + wForest;
    if (wVeg > 0.02) {
      MatS vg = matSample(L_GRASS, uv * S_GRASS);
      vg.albedo *= mix(vec3(0.56, 0.78, 0.50), vec3(0.74, 0.82, 0.54), macro);
      float flatFloor = smoothstep(0.92, 0.985, N.y);
      if (wForest > 0.15 && flatFloor > 0.02) {
        MatS lv = matSample(L_LEAVES, uv * S_LEAVES); lv.albedo *= vec3(0.48, 0.58, 0.40);
        vg = matMix(vg, lv, clamp(wForest / max(wVeg, 0.01), 0.0, 1.0) * 0.24 * flatFloor);
      }
      vg.rough = clamp(0.90 + vg.rough * 0.08, 0.90, 0.98);
      float vegBlend = smoothstep(0.16, 0.82, wVeg + (macro - 0.5) * 0.22);
      m = matMix(m, vg, vegBlend);
      s.reflectance = mix(s.reflectance, 0.14, vegBlend);
    }

    if (wWater > 0.65 && vWorld.y <= waterY + 0.8) {
      m.albedo = vec3(0.04, 0.08, 0.07); m.n = vec3(0.0, 0.0, 1.0); m.rough = 0.07;
      s.reflectance = 0.36;
    }

    // Triplanar transition on steep cuts & vegetated cliffs (starts at N.y < 0.90 so planar grass/leaves NEVER stretch into stripes!)
    float cliffMix = smoothstep(0.90, 0.72, N.y);
    if (cliffMix > 0.01) {
      if (wVeg < 0.45) {
        m = matMix(m, sampleBaokan(vWorld, N, macro), cliffMix);
      } else {
        MatS cliff = sampleCliff(vWorld, N, macro, fine);
        m = matMix(m, cliff, cliffMix);
      }
      m.rough = max(m.rough, 0.87);
      s.reflectance = mix(s.reflectance, 0.16, cliffMix);
    }
  }

  // Singularity-free orthonormal tangent basis on sloped surfaces (safe even on vertical E/W cliffs where N.x ~= +-1!)
  if (cls != 30 && cls != 31 && cls != 32 && cls != 33) {
    vec3 ref = abs(N.x) < 0.85 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
    T = normalize(ref - N * dot(ref, N));
    B = cross(N, T);
  }
  s.albedo = m.albedo;
  s.normal = normalize(T * m.n.x + B * m.n.y + N * m.n.z);
  s.roughness = m.rough;
  writeGBuffer(s);
}`;

export function createGroundMaterial(lib, waterY = 0.0) {
  return gbufferMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG(lib),
    name: 'ground',
    uniforms: {
      ...lib.uniforms,
      tLand: { value: null },
      uLandInfo: { value: new THREE.Vector4(500, 0, waterY, 0) },
      uTile: { value: new THREE.Vector4(0, 0, 1000, 0) },
    },
  });
}

export const TEX_PERIOD = 8400;
