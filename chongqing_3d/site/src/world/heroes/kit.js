// High-precision procedural architectural geometry & G-buffer material toolkit for Chongqing 3D hero landmarks.
// Shared by @hero-yuzhong (Yuzhong, Jiangbeizui, Nanshan heroes) and @hero-bridges (bridges, monorail, cableway).
//
// Vertex format for HeroKit (compatible with deferred G-buffer + cascaded shadows):
//   position  Float32 x3   local (x, y, z) in metres
//   normal    Float32 x3   unit normal
//   color     Float32 x3   linear RGB albedo (or emissive tint)
//   aMat      Float32 x4   (roughness, metalness, emissive, reflectance)
//                          negative emissive = night-only (multiplied by city lights factor)
//   aTex      Float32 x4   (u, v, matType, param)
//                          u, v in metres (or tile units) driving procedural close-up PBR micro-detail

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE, SM } from '../../engine/glsl.js';
import { gbufferMaterial, depthMaterial } from '../../engine/materials.js';

const TAU = Math.PI * 2;

/** Procedural close-up PBR surface types encoded in aTex.z. */
export const MAT = {
  PLAIN: 0,          // Architectural concrete / painted steel / plaster with fine micro-grain & subtle weathering
  STONE: 1,          // Chongqing sandstone / ashlar cliff retaining wall (堡坎石墙): coursed blocks, mortar, moss
  BAYU_TILE: 2,      // Bayu dark-grey small curved clay tiles (巴渝小青瓦): cylindrical tile ribs + overlapping courses
  TIMBER: 3,         // Lacquered Bayu dark timber / carved wood (巴渝木构): directional wood grain + satin sheen
  GLASS: 4,          // Curtain-wall architectural glass: mullion seams, per-pane tilt, night interior room glow
  LATTICE_WIN: 5,    // Traditional carved wooden lattice window (花格木窗): dark muntin grid + warm glowing interior
  GLAZED_TILE: 6,    // Imperial emerald-green glazed cylindrical roof tiles (琉璃瓦): glossy barrel ribs & courses
  GRANITE: 7,        // Paved granite plaza / carved stone steps: ashlar pavers + crystalline speckle
  LANTERN: 8,        // Red paper lantern / golden cornice LED strip: ribbed translucency + warm HDR night bloom
  WATERFALL: 9,      // Animated cascading waterfall / cliff water: scrolling white-aqua foam streaks + night uplight
  LOUVER: 10,        // Mechanical floor louvers / architectural fins: crisp horizontal shadow slats + metallic sheen
  ORIGAMI_GLASS: 11, // Chongqing Grand Theatre double-skin faceted emerald glass: space-frame edge + backlit glow
  ASPHALT: 12,       // Weathered bridge/road asphalt with aggregate normal map & tire tracks
  FOLIAGE: 13,       // Lush sky-garden & cliff foliage (uses SM.FOLIAGE subsurface translucency)
  BRICK: 14,         // Running-bond historic masonry brick with recessed mortar
  CONCRETE: 15,      // Weathered poured concrete with formwork seams, tie-rod dimples & rain streaks
  METAL: 16,         // Brushed/painted architectural steel & aluminum panels with rivet/seam normal detail
  MOSAIC: 17,        // 1990s Chongqing glazed ceramic mosaic facade tiles (马赛克/瓷砖) with dark grout
};

// ---- G-buffer Photographic PBR + Interior Box-Parallax Shader for HeroKit geometry ---------------------------------

const HERO_VERT = /* glsl */`${PRECISION}
in vec3 position;
in vec3 normal;
in vec3 color;
in vec4 aMat;
in vec4 aTex;
#ifdef INSTANCED
in mat4 instanceMatrix;
#ifdef ICOLOR
in vec3 instanceColor;
#endif
#endif
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vNormal;
out vec3 vColor;
out vec4 vMat;
out vec4 vTex;
out vec3 vWorld;
out vec3 vCamWorld;
void main() {
  mat4 m = modelMatrix;
#ifdef INSTANCED
  m = m * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz;
  vCamWorld = -transpose(mat3(viewMatrix)) * viewMatrix[3].xyz;
  vNormal = normalize(mat3(m) * normal);
  vColor = color;
  vMat = aMat;
  vTex = aTex;
#if defined(INSTANCED) && defined(ICOLOR)
  if (aMat.z == 0.0 && color.r > 0.9 && color.g > 0.9 && color.b > 0.9) vColor = instanceColor;
#endif
  gl_Position = projectionMatrix * (viewMatrix * wp);
}`;

const HERO_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform vec4 uNight;      // x: night factor, y: city lights 0..1, z: wetness, w: frame
uniform float uTime;
uniform vec3 uFlood;
#ifdef HAS_MATLIB
uniform sampler2DArray tMatAlbedo;
uniform sampler2DArray tMatNR;
#endif
#ifdef HAS_INTERIORS
uniform sampler2DArray tInteriorsArr;
uniform vec4 uInteriors;  // x: cols (4), y: rows (4), z: count (16), w: hasInteriors (0|1)
#endif
in vec3 vNormal;
in vec3 vColor;
in vec4 vMat;
in vec4 vTex;
in vec3 vWorld;
in vec3 vCamWorld;

// Compute an orthonormal screen-space tangent frame for arbitrary hero geometry UVs
mat3 cotangentFrame(vec3 N, vec3 pos, vec2 uv) {
  vec3 dp1 = dFdx(pos);
  vec3 dp2 = dFdy(pos);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = max(dot(T, T), dot(B, B));
  if (invmax < 1e-10) {
    vec3 up = abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    T = normalize(cross(up, N));
    B = cross(N, T);
    return mat3(T, B, N);
  }
  float sc = inversesqrt(invmax);
  return mat3(T * sc, B * sc, N);
}

vec3 perturbNormal(vec3 N, vec3 pos, vec2 uv, vec2 dH) {
  mat3 TBN = cotangentFrame(N, pos, uv);
  return normalize(N - (TBN[0] * dH.x + TBN[1] * dH.y));
}

#ifdef HAS_MATLIB
struct HeroPBR { vec3 albedo; vec3 tsN; float rough; };
HeroPBR samplePBR(float layer, vec2 uvMeters, float tileMeters, vec3 meanRGB, vec3 tintRGB, float contrast) {
  vec2 u = uvMeters / max(tileMeters, 0.25);
  vec3 c = vec3(u.x, -u.y, layer);
  vec3 rawA = texture(tMatAlbedo, c).rgb;
  vec3 rawNR = texture(tMatNR, c).rgb;
  // Blend luminance-preserving detail ratio with per-channel ratio so very dark layers (bayu_tile, bayu_timber,
  // cliff_rock, red_lacquer) keep crisp photographic micro-grain without hue-blowing or darkening!
  float meanL = max(dot(meanRGB, vec3(0.2126, 0.7152, 0.0722)), 0.006);
  float rawL = dot(rawA, vec3(0.2126, 0.7152, 0.0722));
  vec3 lumaRel = vec3(rawL / meanL);
  vec3 chRel = rawA / max(meanRGB, vec3(0.012));
  float darkLayer = 1.0 - smoothstep(0.03, 0.14, min(meanRGB.r, min(meanRGB.g, meanRGB.b)));
  vec3 rel = mix(chRel, lumaRel, darkLayer * 0.75);
  rel = mix(vec3(1.0), clamp(rel, 0.22, 2.15), contrast);
  vec2 xy = (rawNR.rg * 2.0 - 1.0);
  vec3 tsN = vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.04)));
  return HeroPBR(clamp(tintRGB * rel, 0.0, 1.0), tsN, rawNR.b);
}
vec3 applyTsNormal(vec3 N, vec3 pos, vec2 uv, vec3 tsN, float strength) {
  mat3 TBN = cotangentFrame(N, pos, uv);
  vec3 blended = normalize(vec3(tsN.xy * strength, max(tsN.z, 0.25)));
  return normalize(TBN * blended);
}
#endif

// Exact 1-point perspective room-box raycast into zero-bleed 16-room DataArrayTexture (tInteriorsArr)
// Matches data-pipe #56/#57: x,y in [-1,1] (+y strictly world-UP), z in [0,-1], v=0 ceiling, v=1 floor
vec3 sampleRoomInterior(vec2 f, vec3 Vworld, vec3 N, float cellIdx, float roomSeed) {
  float hx0 = clamp(f.x, 0.02, 0.98) * 2.0 - 1.0;
  float hy0 = clamp(f.y, 0.02, 0.98) * 2.0 - 1.0;
  vec3 upAxis = abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 B = normalize(upAxis - N * dot(upAxis, N));
  vec3 T = normalize(cross(B, N));
  float depthScale = 0.88 + 0.36 * hash11(roomSeed * 7.13 + 0.37);
  vec3 rd = vec3(dot(-Vworld, T) * 1.12 / depthScale, dot(-Vworld, B) * 1.12 / depthScale, -max(abs(dot(Vworld, N)), 0.14));
  float tz = -1.0 / min(rd.z, -0.05);
  float tx = rd.x > 0.001 ? (1.0 - hx0) / rd.x : (rd.x < -0.001 ? (-1.0 - hx0) / rd.x : 1e6);
  float ty = rd.y > 0.001 ? (1.0 - hy0) / rd.y : (rd.y < -0.001 ? (-1.0 - hy0) / rd.y : 1e6);
  float tHit = min(tz, min(tx, ty));
  vec3 hit = vec3(hx0, hy0, 0.0) + rd * tHit;
  // Keep shopfront text/signage (cells 11..15) un-mirrored; randomly flip residential/office rooms for 2x variety!
  float flipX = cellIdx < 10.5 ? step(0.5, hash11(roomSeed * 19.7 + 3.1)) : 0.0;
  float hx = mix(hit.x, -hit.x, flipX);
  float hz = clamp(hit.z, -1.0, 0.0);
  float depthAtten = 0.65 + 0.35 * (1.0 + hz * 0.62);
  float s = 1.0 / (1.0 - hz);
  vec2 cellUV = clamp(vec2(0.5 + 0.5 * hx * s, 0.5 - 0.5 * hit.y * s), 0.004, 0.996);
#ifdef HAS_INTERIORS
  if (uInteriors.w > 0.5) {
    float idx = mod(floor(cellIdx), max(uInteriors.z, 1.0));
    // tInteriorsArr is SRGBColorSpace -> hardware decodes to linear RGB automatically
    return texture(tInteriorsArr, vec3(cellUV, idx)).rgb * depthAtten;
  }
#endif
  // Procedural room fallback when interiors.webp is absent
  float ceilLight = smoothstep(0.18, 0.02, cellUV.y) * smoothstep(0.25, 0.5, 1.0 - abs(cellUV.x - 0.5) * 2.0);
  float wallShade = (tHit == tz) ? 0.92 : (tHit == ty ? (rd.y > 0.0 ? 1.15 : 0.62) : 0.78);
  vec3 baseRoom = mix(vec3(0.42, 0.32, 0.22), vec3(0.92, 0.74, 0.48), (1.0 - cellUV.y) * 0.65 + ceilLight * 0.8);
  return baseRoom * wallShade * depthAtten;
}

void main() {
  Surface s = defaultSurface();
  vec3 Ngeom = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 N = Ngeom;
  vec3 Vworld = normalize(vCamWorld - vWorld);
  vec3 col = vColor;
  float rough = vMat.x;
  float metal = vMat.y;
  float emRaw = vMat.z;
  float refl = vMat.w;
  vec2 uv = vTex.xy;
  int mtype = int(vTex.z + 0.5);
  float param = vTex.w;
  float nightOn = smoothstep(0.18, 0.58, uNight.y);
  float e = emRaw < 0.0 ? -emRaw * nightOn : emRaw;
  vec3 extraEmit = vec3(0.0);
  float micro = 1.0;

  // Global重庆 humid crevice & overhang weathering (breaks up plastic/clean CAD shading on every hero!)
  float overhangAO = mix(1.0, 0.58, smoothstep(-0.08, -0.78, Ngeom.y));
  float rainStreak = fbm(vec2(vWorld.x * 0.55 + vWorld.z * 0.55, vWorld.y * 0.07));
  float macroGrime = fbm2(vWorld.xz * 0.045 + vec2(vWorld.y * 0.03, 1.9));
  s.ao = overhangAO;

  if (mtype == ${MAT.PLAIN}) {
    vec2 mUv = abs(Ngeom.y) > 0.75 ? vWorld.xz : vec2(uv.x, uv.y);
#ifdef HAS_MATLIB
    if (metal > 0.35) {
      // Sleek architectural brushed metal plates (L18 metal_panel) with subtle seam & specular variation
      HeroPBR p = samplePBR(18.0, mUv, 3.0, vec3(0.0597, 0.0660, 0.0680), col, 0.55);
      col = p.albedo;
      rough = clamp(mix(rough, p.rough, 0.40), 0.14, 0.82);
      N = applyTsNormal(N, vWorld, mUv, p.tsN, 0.42);
    } else if (rough > 0.58) {
      // Weathered architectural concrete / stained plaster with formwork seams & Chongqing rain streaking
      HeroPBR p = samplePBR(15.0, mUv, 3.2, vec3(0.203, 0.203, 0.205), col, 0.88);
      col = p.albedo * (0.88 + 0.20 * macroGrime);
      col *= mix(0.84, 1.04, smoothstep(0.25, 0.78, rainStreak));
      rough = clamp(mix(rough, p.rough + 0.14, 0.62), 0.35, 0.96);
      N = applyTsNormal(N, vWorld, mUv, p.tsN, 0.78);
    } else {
      HeroPBR p = samplePBR(10.0, mUv, 3.0, vec3(0.564, 0.542, 0.522), col, 0.55);
      col = p.albedo * (0.92 + 0.14 * macroGrime);
      rough = clamp(mix(rough, p.rough, 0.45), 0.18, 0.92);
      N = applyTsNormal(N, vWorld, mUv, p.tsN, 0.45);
    }
#else
    float g = fbm2(vWorld.xz * 0.45 + vWorld.y * 0.35);
    col *= 0.90 + 0.18 * g;
    rough = clamp(rough + (g - 0.5) * 0.14, 0.06, 0.98);
#endif
  } else if (mtype == ${MAT.STONE}) {
    // Photographic Chongqing sandstone retaining wall (堡坎) blended with mossy cliff rock
    // Phase 5: analytical fwidth() anti-aliasing prevents sunlit mortar groove shimmer at distance!
    float rowH = max(0.32, param > 0.01 ? param : 0.48);
    float colW = rowH * 2.15;
    vec2 sUv = vec2(uv.x / colW, uv.y / rowH);
    vec2 fw = fwidth(sUv);
    float aaFade = 1.0 - smoothstep(0.18, 0.65, max(fw.x, fw.y));
    float row = floor(sUv.y);
    float shift = mod(row, 2.0) * 0.5 + (hash11(row * 17.3) - 0.5) * 0.25;
    vec2 cell = vec2(floor(sUv.x + shift), row);
    vec2 f = vec2(fract(sUv.x + shift), fract(sUv.y));
    float hBlock = hash12(cell * 1.37 + 3.1);
    float wx = max(0.055, fw.x * 1.25);
    float wy = max(0.085, fw.y * 1.25);
    float jx = smoothstep(0.0, wx, f.x) * smoothstep(0.0, wx, 1.0 - f.x);
    float jy = smoothstep(0.0, wy, f.y) * smoothstep(0.0, wy, 1.0 - f.y);
    float mortar = mix(0.84, jx * jy, aaFade);
#ifdef HAS_MATLIB
    HeroPBR st = samplePBR(28.0, uv, 2.5, vec3(0.155, 0.127, 0.080), col, 1.05);
    HeroPBR rk = samplePBR(29.0, uv, 4.0, vec3(0.047, 0.049, 0.030), col * 0.82, 1.0);
    float mossPatch = smoothstep(0.50, 0.80, fbm(vWorld.xz * 0.16 + vec2(vWorld.y * 0.09, 2.7)));
    col = mix(st.albedo, rk.albedo, mossPatch * 0.48);
    rough = clamp(mix(0.94, mix(st.rough, rk.rough, mossPatch * 0.5) + 0.12, mortar), 0.45, 0.98);
    N = applyTsNormal(N, vWorld, uv, mix(st.tsN, rk.tsN, mossPatch * 0.5), 0.85 * (0.35 + 0.65 * aaFade));
#endif
    vec3 stoneTint = mix(vec3(0.80, 0.76, 0.70), vec3(1.14, 1.06, 0.95), hBlock);
    col *= stoneTint * mix(0.82, 1.05, smoothstep(0.22, 0.78, rainStreak));
    float moss = smoothstep(0.54, 0.82, fbm(vWorld.xz * 0.19 + vec2(vWorld.y * 0.12, 5.1)));
    col = mix(col, col * vec3(0.42, 0.62, 0.36), moss * (1.0 - mortar * 0.45) * 0.52);
    col = mix(col * 0.44, col, mortar);
    s.ao *= mix(0.48, 1.0, mortar);
    micro = mix(0.60, 1.0, mortar);
    vec2 dH = vec2((smoothstep(wx, 0.0, f.x) - smoothstep(1.0 - wx, 1.0, f.x)) * 0.48,
                   (smoothstep(wy, 0.0, f.y) - smoothstep(1.0 - wy, 1.0, f.y)) * 0.58) * aaFade;
    N = perturbNormal(N, vWorld, uv, dH);
  } else if (mtype == ${MAT.BAYU_TILE} || mtype == ${MAT.GLAZED_TILE}) {
    // Photographic Bayu curved clay tiles / Imperial emerald glazed cylindrical tiles (小青瓦 / 绿琉璃瓦)
    float pitch = param > 0.01 ? param : (mtype == ${MAT.GLAZED_TILE} ? 0.32 : 0.25);
    float courseLen = pitch * 1.42;
    vec2 tUv = vec2(uv.x / pitch, uv.y / courseLen);
    vec2 tFw = fwidth(tUv);
    float tAa = 1.0 - smoothstep(0.22, 0.70, max(tFw.x, tFw.y));
    float ph = tUv.x * 6.2831853;
    float rib = cos(ph) * tAa;
    float ribSlope = -sin(ph) * tAa;
    float cF = fract(tUv.y);
    float cId = floor(tUv.y);
    float tId = floor(tUv.x);
    float var = hash12(vec2(tId, cId) * 0.73);
    float lip = mix(0.86, smoothstep(0.0, max(0.16, tFw.y * 1.2), cF), tAa);
#ifdef HAS_MATLIB
    HeroPBR tp = samplePBR(31.0, uv, 1.8, vec3(0.0174, 0.0165, 0.0227), col, mtype == ${MAT.GLAZED_TILE} ? 0.42 : 0.85);
    col = tp.albedo;
    N = applyTsNormal(N, vWorld, uv, tp.tsN, (mtype == ${MAT.GLAZED_TILE} ? 0.45 : 0.75) * (0.35 + 0.65 * tAa));
#endif
    float ridgeShade = 0.58 + 0.42 * (rib * 0.5 + 0.5);
    col *= ridgeShade * (0.82 + 0.30 * var) * mix(0.45, 1.0, lip);
    if (mtype == ${MAT.GLAZED_TILE}) {
      rough = clamp(0.11 + 0.14 * (1.0 - (rib * 0.5 + 0.5)) + (var - 0.5) * 0.06, 0.06, 0.42);
      refl = 0.86;
    } else {
      rough = clamp(rough + 0.16 * (0.5 - rib * 0.5) + (var - 0.5) * 0.12, 0.34, 0.94);
    }
    s.ao *= mix(0.44, 1.0, (rib * 0.5 + 0.5) * lip);
    micro = mix(0.60, 1.0, lip);
    vec2 dH = vec2(ribSlope * 0.65, (1.0 - lip) * 0.78) * tAa;
    N = perturbNormal(N, vWorld, uv, dH);
  } else if (mtype == ${MAT.TIMBER}) {
    // Photographic lacquered dark Bayu timber / imperial crimson wood grain
#ifdef HAS_MATLIB
    bool isRed = col.r > col.g * 2.4 && col.r > 0.25;
    HeroPBR wp;
    if (isRed) wp = samplePBR(37.0, uv, 2.0, vec3(0.405, 0.014, 0.010), col, 0.75);
    else wp = samplePBR(32.0, uv, 2.0, vec3(0.043, 0.014, 0.005), col, 0.88);
    col = wp.albedo;
    rough = clamp(mix(rough, wp.rough, 0.55), 0.20, 0.88);
    N = applyTsNormal(N, vWorld, uv, wp.tsN, 0.75);
#else
    float grain = fbm2(vec2(uv.x * 1.4, uv.y * 14.0)) * 0.7 + vnoise(vec2(uv.x * 3.0, uv.y * 32.0)) * 0.3;
    col *= 0.84 + 0.30 * grain;
    rough = clamp(rough + (0.5 - grain) * 0.18, 0.18, 0.88);
    N = perturbNormal(N, vWorld, uv, vec2(0.0, (grain - 0.5) * 0.22));
#endif
  } else if (mtype == ${MAT.GLASS}) {
    // Photorealistic curtain-wall glass: 3D interior room box-parallax (tInteriorsArr!), blinds/curtains, physical Fresnel!
    float bayW = param > 0.2 ? param : 2.8;
    float floorH = 3.9;
    vec2 gUv = vec2(uv.x / bayW, uv.y / floorH);
    vec2 cell = floor(gUv);
    vec2 f = fract(gUv);
    float mulX = smoothstep(0.0, 0.055, f.x) * smoothstep(0.0, 0.055, 1.0 - f.x);
    float spandrel = smoothstep(0.0, 0.22, f.y) * smoothstep(0.0, 0.08, 1.0 - f.y);
    float glassMask = mulX * spandrel;
    vec2 suite = vec2(floor(cell.x * 0.333), cell.y);
    float flHash = hash11(cell.y * 1.73 + floor(vWorld.x * 0.008) * 13.7 + floor(vWorld.z * 0.008) * 7.3);
    float suiteHash = hash12(suite + vec2(11.3, 4.7));
    float h2 = hash12(suite * 1.7 + vec2(3.1, 19.7));
    float paneVar = hash12(cell + vec2(5.2, 8.9));
    // Physical curtain / Venetian blind mask at top of window pane
    float blindDrop = mix(0.08, 0.58, hash12(cell * 2.1 + 7.4));
    float hasBlind = step(0.45, hash12(cell + 19.1));
    float blindMask = hasBlind * smoothstep(1.0 - blindDrop - 0.04, 1.0 - blindDrop, f.y);
    float blindSlats = 0.72 + 0.28 * cos(f.y * 75.0);
    // Slight per-pane specular tilt for authentic hand-installed curtain wall shimmer
    mat3 TBN = cotangentFrame(N, vWorld, gUv);
    vec2 tilt = (hash22(cell + 5.2) - 0.5) * 0.042 * glassMask;
    N = normalize(N - (TBN[0] * tilt.x + TBN[1] * tilt.y));
    // Pick furnished room cell from 16-room array: offices (6..10) on tall towers, residential (0..5) on low/mid!
    float roomIdx = vWorld.y > 140.0 ? (6.0 + floor(suiteHash * 5.0)) : floor(suiteHash * 6.0);
    vec3 roomCol = sampleRoomInterior(f, Vworld, N, roomIdx, suiteHash + paneVar * 0.37);
    roomCol = mix(roomCol, roomCol * vec3(0.75, 0.72, 0.66) * blindSlats, blindMask * 0.68);
    // Physical Fresnel: grazing angles mirror sky strongly, steep angles reveal furnished room behind glass!
    float NoV = clamp(dot(N, Vworld), 0.0, 1.0);
    float fresnel = 0.08 + 0.88 * pow(1.0 - NoV, 4.2);
    vec3 frameCol = col * 0.30 + vec3(0.032, 0.040, 0.052);
    vec3 paneCol = mix(col * 0.48 + roomCol * (0.48 * (1.0 - fresnel)), col * (0.90 + 0.20 * paneVar), fresnel);
    col = mix(frameCol, paneCol, glassMask);
    rough = mix(0.38, clamp(rough, 0.04, 0.16), glassMask);
    metal = mix(0.72, mix(0.18, 0.32, fresnel), glassMask);
    refl = mix(0.55, 0.96, glassMask);
    s.ao *= mix(0.58, 1.0, glassMask);
    // Cohesive office/residence night illumination with luminance-weighted interior lamp fixtures!
    float bandLit = step(0.58, flHash) * step(0.38, suiteHash) + step(0.82, suiteHash);
    float occ = clamp(bandLit, 0.0, 1.0);
    float roomLuma = dot(roomCol, vec3(0.2126, 0.7152, 0.0722));
    float lampBoost = 0.60 + 1.25 * smoothstep(0.16, 0.72, roomLuma);
    vec3 warmBias = mix(vec3(1.05, 0.90, 0.72), vec3(0.90, 0.96, 1.05), step(0.72, h2));
    float litIntensity = occ * glassMask * (1.0 - blindMask * 0.50) * (0.42 + 0.50 * h2) * nightOn;
    extraEmit += roomCol * warmBias * lampBoost * litIntensity * 1.45;
  } else if (mtype == ${MAT.LATTICE_WIN}) {
    // Authentic Bayu carved wooden shop/teahouse window: intricate dark-timber lattice transom (花格窗棂) across top
    // + open wooden-framed glass storefront panes below revealing vivid 3D tInteriorsArr hotpot/teahouse rooms!
    // Phase 5: analytical fwidth() anti-aliasing eliminates distant wooden lattice shimmer!
    float grid = param > 0.05 ? param : 0.30;
    vec2 bayUv = vec2(uv.x / 1.85, uv.y / 3.85);
    vec2 bayFw = fwidth(bayUv);
    vec2 bayId = floor(bayUv);
    vec2 bayF = fract(bayUv);
    float hBay = hash12(bayId + vec2(3.7, 9.1));
    // Outer wooden stiles & upper transom rail (bayF.y = 0.62)
    float fxw = max(0.04, bayFw.x * 1.15);
    float fyw = max(0.04, bayFw.y * 1.15);
    float outerFrame = smoothstep(0.045, 0.045 + fxw, bayF.x) * smoothstep(0.045, 0.045 + fxw, 1.0 - bayF.x)
                     * smoothstep(0.035, 0.035 + fyw, bayF.y) * smoothstep(0.035, 0.035 + fyw, 1.0 - bayF.y);
    float midRail = smoothstep(0.022, 0.022 + max(0.028, bayFw.y), abs(bayF.y - 0.62));
    float centerStile = smoothstep(0.018, 0.018 + max(0.022, bayFw.x), abs(bayF.x - 0.50));
    // Fine carved wooden lattice ONLY in the upper transom (bayF.y > 0.62) or on traditional closed screens (~28% of bays)
    vec2 lUv = uv / grid;
    vec2 lFw = fwidth(lUv);
    float lAa = 1.0 - smoothstep(0.16, 0.55, max(lFw.x, lFw.y));
    vec2 f = fract(lUv);
    float bxw = max(0.06, lFw.x * 1.2);
    float byw = max(0.06, lFw.y * 1.2);
    float bar = smoothstep(0.11, 0.11 + bxw, f.x) * smoothstep(0.11, 0.11 + bxw, 1.0 - f.x)
              * smoothstep(0.11, 0.11 + byw, f.y) * smoothstep(0.11, 0.11 + byw, 1.0 - f.y);
    float diag = smoothstep(0.06, 0.06 + max(0.05, max(lFw.x, lFw.y) * 1.1), abs(abs(f.x - 0.5) + abs(f.y - 0.5) - 0.36));
    float fineLattice = mix(0.46, bar * mix(1.0, diag, step(0.45, hBay)), lAa);
    float useFine = max(step(0.62, bayF.y), step(0.74, hBay));
    float open = outerFrame * midRail * mix(centerStile, fineLattice, useFine);
    // Sample vibrant Chongqing shopfront / teahouse rooms (cells 11..15) behind the glass!
    float shopCell = 11.0 + floor(hBay * 5.0);
    vec3 shopRoom = sampleRoomInterior(bayF, Vworld, N, shopCell, hBay);
    // Crisp dark espresso Bayu timber muntins vs warm glassy storefront interior with physical Fresnel reflection
    float NoV = clamp(dot(N, Vworld), 0.0, 1.0);
    float fresnel = 0.06 + 0.55 * pow(1.0 - NoV, 3.8);
    vec3 woodCol = vec3(0.050, 0.018, 0.010);
    vec3 glassPane = mix(shopRoom * 0.92, vec3(0.12, 0.16, 0.22), fresnel * 0.48);
    col = mix(woodCol, mix(glassPane, col * 0.38 + shopRoom * 0.62, useFine * 0.65), open);
    rough = mix(0.56, mix(0.10, 0.28, useFine), open);
    refl = mix(0.42, 0.92, open);
    s.ao *= mix(0.42, 1.0, open);
    N = perturbNormal(N, vWorld, uv, vec2((1.0 - open) * 0.28 * lAa, (1.0 - open) * 0.28 * lAa));
    // Rich organic warm/amber/crimson variation across bays (breaks up uniform yellow wall!)
    float bayActivity = mix(0.24, 1.15, smoothstep(0.12, 0.88, hBay));
    vec3 bayTint = mix(vec3(1.0, 0.52, 0.16), vec3(1.0, 0.34, 0.12), step(0.74, hBay));
    bayTint = mix(bayTint, vec3(1.0, 0.78, 0.42), step(0.48, hash12(bayId * 1.9 + 5.2)) * 0.48);
    float roomLuma = dot(shopRoom, vec3(0.2126, 0.7152, 0.0722));
    float lampBoost = 0.58 + 1.15 * smoothstep(0.15, 0.70, roomLuma);
    float glow = (emRaw < 0.0 ? -emRaw * nightOn : max(emRaw, 1.4 * nightOn));
    extraEmit += mix(shopRoom * bayTint * 1.85 * lampBoost, bayTint * 0.78, useFine * 0.38) * open * glow * 0.46 * bayActivity;
    e = 0.0;
  } else if (mtype == ${MAT.GRANITE}) {
    // Photographic granite pavers / marble / stone plaza slabs with analytical fwidth() anti-aliased mortar joints
    float tileS = param > 0.05 ? param : 1.2;
    vec2 gUv = uv / tileS;
    vec2 gFw = fwidth(gUv);
    float gAa = 1.0 - smoothstep(0.18, 0.62, max(gFw.x, gFw.y));
    vec2 cell = floor(gUv);
    vec2 f = fract(gUv);
    float sxw = max(0.032, gFw.x * 1.25);
    float syw = max(0.032, gFw.y * 1.25);
    float seam = mix(0.92, smoothstep(0.0, sxw, f.x) * smoothstep(0.0, sxw, 1.0 - f.x)
                         * smoothstep(0.0, syw, f.y) * smoothstep(0.0, syw, 1.0 - f.y), gAa);
    float tileVar = 0.88 + 0.22 * hash12(cell * 1.91);
#ifdef HAS_MATLIB
    bool isMarble = col.r > 0.72 && col.g > 0.70 && col.b > 0.66;
    HeroPBR gp;
    if (isMarble) gp = samplePBR(26.0, uv, 2.5, vec3(0.381, 0.386, 0.429), col, 0.75);
    else gp = samplePBR(2.0, uv, 2.0, vec3(0.259, 0.262, 0.265), col, 0.92);
    col = gp.albedo * tileVar * mix(0.56, 1.0, seam);
    rough = clamp(mix(rough, gp.rough + 0.18, 0.55), 0.16, 0.92);
    N = applyTsNormal(N, vWorld, uv, gp.tsN, (isMarble ? 0.45 : 0.75) * (0.35 + 0.65 * gAa));
#else
    float speckle = vnoise(uv * 18.0) * 0.5 + vnoise(uv * 43.0) * 0.5;
    col *= tileVar * (0.88 + 0.22 * speckle) * mix(0.56, 1.0, seam);
    rough = clamp(rough + (speckle - 0.5) * 0.16, 0.20, 0.92);
#endif
    s.ao *= mix(0.62, 1.0, seam);
    vec2 dH = vec2((smoothstep(sxw, 0.0, f.x) - smoothstep(1.0 - sxw, 1.0, f.x)) * 0.38,
                   (smoothstep(syw, 0.0, f.y) - smoothstep(1.0 - syw, 1.0, f.y)) * 0.38) * gAa;
    N = perturbNormal(N, vWorld, uv, dH);
  } else if (mtype == ${MAT.LANTERN}) {
    float rib = 0.74 + 0.26 * cos(uv.x * 24.0);
    float core = 0.72 + 0.28 * sin(clamp(uv.y, 0.0, 1.0) * 3.14159);
    col *= rib;
    float pulse = 0.94 + 0.06 * sin(uTime * 1.6 + vWorld.x * 0.17 + vWorld.z * 0.13);
    e *= (0.72 + 0.42 * core * rib) * pulse;
  } else if (mtype == ${MAT.WATERFALL}) {
    float flow = uv.y + uTime * 2.9;
    float s1 = fbm(vec2(uv.x * 3.5, flow * 0.85));
    float s2 = fbm(vec2(uv.x * 8.2 + 4.1, flow * 1.9));
    float mist = smoothstep(0.28, 0.0, fract(uv.y * 0.08));
    float foam = clamp(smoothstep(0.32, 0.76, s1 * 0.55 + s2 * 0.45) + mist * 0.35, 0.0, 1.0);
    col = mix(vec3(0.05, 0.20, 0.28), vec3(0.74, 0.86, 0.92), foam);
    rough = mix(0.10, 0.42, foam);
    refl = 0.88;
    N = perturbNormal(N, vWorld, uv, vec2((s1 - 0.5) * 0.55, (s2 - 0.5) * 0.45));
    extraEmit += mix(vec3(0.06, 0.32, 0.48), vec3(0.88, 0.64, 0.28), foam * 0.42) * (0.08 + 0.58 * nightOn);
    e = 0.0;
  } else if (mtype == ${MAT.LOUVER}) {
    float pitch = param > 0.02 ? param : 0.22;
    float f = fract(uv.y / pitch);
    float blade = smoothstep(0.08, 0.32, f) * smoothstep(0.95, 0.72, f);
#ifdef HAS_MATLIB
    HeroPBR lp = samplePBR(18.0, uv, 3.0, vec3(0.060, 0.066, 0.068), col, 0.6);
    col = lp.albedo;
#endif
    col *= mix(0.18, 1.12, blade);
    s.ao *= mix(0.26, 1.0, blade);
    micro = mix(0.40, 1.0, blade);
    N = perturbNormal(N, vWorld, uv, vec2(0.0, (f - 0.5) * 1.25));
  } else if (mtype == ${MAT.ORIGAMI_GLASS}) {
    // Chongqing Grand Theatre double-layer faceted emerald crystal with VISIBLE PARALLAX INNER SPACE-FRAME TRUSS!
    mat3 TBN = cotangentFrame(N, vWorld, uv * 0.42);
    vec2 f = fract(uv * 0.42);
    float edge = smoothstep(0.0, 0.065, f.x) * smoothstep(0.0, 0.065, 1.0 - f.x)
               * smoothstep(0.0, 0.065, f.y) * smoothstep(0.0, 0.065, 1.0 - f.y);
    float innerDiag = smoothstep(0.0, 0.045, abs(f.x - f.y));
    float panel = edge * (0.35 + 0.65 * innerDiag);
    // Parallax offset of inner structural steel truss plane ~1.4m behind outer emerald glass!
    vec2 parOff = vec2(dot(-Vworld, TBN[0]), dot(-Vworld, TBN[1])) / max(abs(dot(Vworld, N)), 0.28) * 0.26;
    vec2 fIn = fract(uv * 0.42 + parOff);
    float inBeam = smoothstep(0.0, 0.055, fIn.x) * smoothstep(0.0, 0.055, 1.0 - fIn.x)
                 * smoothstep(0.0, 0.055, fIn.y) * smoothstep(0.0, 0.055, 1.0 - fIn.y)
                 * smoothstep(0.0, 0.045, abs(fIn.x + fIn.y - 1.0));
    vec3 frameC = vec3(0.08, 0.10, 0.11);
    float shimmer = 0.78 + 0.30 * fbm2(vWorld.xz * 0.06 + vWorld.y * 0.08);
    float lowerWarm = smoothstep(32.0, 6.0, vWorld.y - 54.0);
    vec3 glassC = col * shimmer * mix(0.46, 1.0, inBeam);
    col = mix(frameC, glassC, panel);
    rough = mix(0.36, 0.09, panel);
    metal = mix(0.75, 0.14, panel);
    refl = mix(0.55, 0.96, panel);
    s.ao *= mix(0.52, mix(0.70, 1.0, inBeam), panel);
    float glow = (emRaw < 0.0 ? -emRaw * nightOn : emRaw) * panel * mix(0.32, 1.0, inBeam);
    vec3 emTint = mix(vec3(0.015, 0.36, 0.24), vec3(0.04, 0.54, 0.36), shimmer * 0.55);
    emTint = mix(emTint, vec3(0.36, 0.40, 0.18), lowerWarm * 0.38);
    extraEmit += emTint * glow;
    e = 0.0;
  } else if (mtype == ${MAT.ASPHALT}) {
    // Photographic weathered bridge/road asphalt with aggregate normal map & polished wheel tracks!
#ifdef HAS_MATLIB
    HeroPBR ap = samplePBR(0.0, vWorld.xz, 3.0, vec3(0.128, 0.126, 0.108), col, 1.0);
    float track = smoothstep(0.35, 0.85, sin(uv.y * 1.8) * 0.5 + 0.5);
    col = ap.albedo * mix(0.92, 1.06, macroGrime);
    rough = clamp(mix(ap.rough + 0.12, ap.rough - 0.10, track * 0.45), 0.25, 0.95);
    N = applyTsNormal(N, vWorld, vWorld.xz, ap.tsN, 0.95);
#else
    float agg = vnoise(vWorld.xz * 7.5) * 0.55 + vnoise(vWorld.xz * 23.0) * 0.45;
    col *= (0.86 + 0.26 * agg) * (0.88 + 0.20 * macroGrime);
    rough = clamp(rough + (agg - 0.5) * 0.16, 0.30, 0.96);
#endif
  } else if (mtype == ${MAT.FOLIAGE}) {
    float leaf = fbm2(vWorld.xz * 1.7 + vWorld.y * 1.4);
    col *= 0.72 + 0.50 * leaf;
    s.model = float(${SM.FOLIAGE});
  } else if (mtype == ${MAT.BRICK}) {
    float bh = 0.12, bw = 0.28;
    float r = floor(uv.y / bh);
    float fx = fract(uv.x / bw + mod(r, 2.0) * 0.5);
    float fy = fract(uv.y / bh);
    float m = smoothstep(0.0, 0.075, fx) * smoothstep(0.0, 0.075, 1.0 - fx)
            * smoothstep(0.0, 0.12, fy) * smoothstep(0.0, 0.12, 1.0 - fy);
#ifdef HAS_MATLIB
    bool isRed = col.r > col.b * 1.35;
    HeroPBR bp;
    if (isRed) bp = samplePBR(13.0, uv, 2.4, vec3(0.292, 0.160, 0.104), col, 1.0);
    else bp = samplePBR(14.0, uv, 2.4, vec3(0.262, 0.258, 0.250), col, 1.0);
    col = mix(bp.albedo * 0.48, bp.albedo, m);
    rough = clamp(mix(0.95, bp.rough + 0.14, m), 0.42, 0.98);
    N = applyTsNormal(N, vWorld, uv, bp.tsN, 1.0);
#else
    float bv = hash12(vec2(floor(uv.x / bw + mod(r, 2.0) * 0.5), r));
    col = mix(col * 0.50 + vec3(0.16), col * (0.80 + 0.36 * bv), m);
#endif
    s.ao *= mix(0.46, 1.0, m);
    N = perturbNormal(N, vWorld, uv, vec2((smoothstep(0.08, 0.0, fx) - smoothstep(0.92, 1.0, fx)) * 0.45,
                                          (smoothstep(0.12, 0.0, fy) - smoothstep(0.88, 1.0, fy)) * 0.55));
  } else if (mtype == ${MAT.CONCRETE}) {
    // Architectural poured concrete with formwork panel joints, tie-rod dimples & Chongqing vertical rain staining
    vec2 mUv = abs(Ngeom.y) > 0.75 ? vWorld.xz : uv;
    float panW = param > 0.2 ? param : 2.4;
    float panH = panW * 0.55;
    vec2 pf = fract(vec2(mUv.x / panW, mUv.y / panH));
    float seam = smoothstep(0.0, 0.025, pf.x) * smoothstep(0.0, 0.025, 1.0 - pf.x)
               * smoothstep(0.0, 0.035, pf.y) * smoothstep(0.0, 0.035, 1.0 - pf.y);
    float tie = smoothstep(0.04, 0.075, length((pf - vec2(0.25, 0.5)) * vec2(1.8, 1.0)))
              * smoothstep(0.04, 0.075, length((pf - vec2(0.75, 0.5)) * vec2(1.8, 1.0)));
#ifdef HAS_MATLIB
    HeroPBR cp = samplePBR(15.0, mUv, 3.0, vec3(0.203, 0.203, 0.205), col, 1.05);
    col = cp.albedo;
    rough = clamp(mix(rough, cp.rough + 0.16, 0.70), 0.42, 0.98);
    N = applyTsNormal(N, vWorld, mUv, cp.tsN, 1.0);
#endif
    col *= (0.86 + 0.22 * macroGrime) * mix(0.78, 1.05, smoothstep(0.20, 0.78, rainStreak));
    col *= mix(0.62, 1.0, seam) * mix(0.58, 1.0, tie);
    s.ao *= mix(0.55, 1.0, seam * tie);
    N = perturbNormal(N, vWorld, mUv, vec2((smoothstep(0.03, 0.0, pf.x) - smoothstep(0.97, 1.0, pf.x)) * 0.5,
                                           (smoothstep(0.04, 0.0, pf.y) - smoothstep(0.96, 1.0, pf.y)) * 0.5));
  } else if (mtype == ${MAT.METAL}) {
    // Brushed/painted structural steel & aluminum panels with plate seams & metallic sheen
    vec2 mUv = abs(Ngeom.y) > 0.75 ? vWorld.xz : uv;
    float pSize = param > 0.2 ? param : 1.8;
    vec2 mf = fract(mUv / pSize);
    float seam = smoothstep(0.0, 0.02, mf.x) * smoothstep(0.0, 0.02, 1.0 - mf.x)
               * smoothstep(0.0, 0.02, mf.y) * smoothstep(0.0, 0.02, 1.0 - mf.y);
#ifdef HAS_MATLIB
    HeroPBR mp = samplePBR(18.0, mUv, 3.0, vec3(0.0597, 0.0660, 0.0680), col, 0.62);
    col = mp.albedo * mix(0.68, 1.0, seam);
    rough = clamp(mix(rough, mp.rough, 0.48), 0.14, 0.78);
    N = applyTsNormal(N, vWorld, mUv, mp.tsN, 0.50);
#else
    col *= mix(0.72, 1.0, seam);
#endif
    s.ao *= mix(0.68, 1.0, seam);
  } else if (mtype == ${MAT.MOSAIC}) {
    // Authentic 1990s Chongqing glazed ceramic mosaic facade tiles (马赛克/瓷砖) with dark grout & grime!
    float ts = param > 0.04 ? param : 0.18;
    vec2 mc = floor(uv / ts);
    vec2 mf = fract(uv / ts);
    float grout = smoothstep(0.0, 0.09, mf.x) * smoothstep(0.0, 0.09, 1.0 - mf.x)
                * smoothstep(0.0, 0.09, mf.y) * smoothstep(0.0, 0.09, 1.0 - mf.y);
    float tv = hash12(mc * 1.13 + 4.7);
#ifdef HAS_MATLIB
    HeroPBR mop = samplePBR(30.0, uv, 1.0, vec3(0.399, 0.433, 0.401), col, 1.0);
    col = mop.albedo;
    rough = clamp(mix(0.88, mop.rough + 0.14, grout), 0.18, 0.94);
    N = applyTsNormal(N, vWorld, uv, mop.tsN, 0.85);
#endif
    col *= (0.86 + 0.24 * tv) * mix(0.80, 1.05, smoothstep(0.22, 0.80, rainStreak));
    col = mix(col * 0.42, col, grout);
    s.ao *= mix(0.50, 1.0, grout);
    N = perturbNormal(N, vWorld, uv, vec2((smoothstep(0.10, 0.0, mf.x) - smoothstep(0.90, 1.0, mf.x)) * 0.45,
                                          (smoothstep(0.10, 0.0, mf.y) - smoothstep(0.90, 1.0, mf.y)) * 0.45));
  }

  s.albedo = col;
  s.normal = N;
  s.roughness = rough;
  s.metalness = metal;
  s.reflectance = refl;
  s.microShadow = micro;
  s.emissive = vColor * e + extraEmit;
  if (e > 0.0) s.albedo *= 0.35;
  else s.emissive += col * uFlood * uNight.y;
#ifdef MOVING
  s.model = s.model + 128.0;
#endif
  writeGBuffer(s);
}`;

/** Create the shared HeroKit G-buffer material, automatically binding 1024px PBR texture arrays & zero-bleed 16-room tInteriorsArr! */
export function heroMaterial(env, { matlib = null, instanced = false, instanceColor = false, side = THREE.FrontSide, flood = [0, 0, 0], moving = false } = {}) {
  const hasMatlib = !!(matlib && matlib.uniforms && matlib.uniforms.tMatAlbedo && matlib.uniforms.tMatNR);
  const intUnif = matlib?.interiorUniforms || matlib?.uniforms || null;
  const intArr = intUnif?.tInteriorsArr || null;
  const intVec = intUnif?.uInteriors || null;
  const hasInteriors = !!(intArr && intArr.value);

  return gbufferMaterial({
    vertexShader: HERO_VERT,
    fragmentShader: HERO_FRAG,
    defines: {
      ...(instanced ? { INSTANCED: 1 } : {}),
      ...(instanceColor ? { ICOLOR: 1 } : {}),
      ...(moving ? { MOVING: 1 } : {}),
      ...(hasMatlib ? { HAS_MATLIB: 1 } : {}),
      ...(hasInteriors ? { HAS_INTERIORS: 1 } : {}),
    },
    side,
    name: moving ? 'hero-moving' : 'hero',
    uniforms: {
      uNight: env.uniforms.uNight,
      uTime: env.uniforms.uTime,
      uFlood: { value: new THREE.Vector3(...flood) },
      ...(hasMatlib ? { tMatAlbedo: matlib.uniforms.tMatAlbedo, tMatNR: matlib.uniforms.tMatNR } : {}),
      ...(hasInteriors ? {
        tInteriorsArr: intArr,
        uInteriors: intVec || { value: new THREE.Vector4(4, 4, 16, 1) },
      } : {}),
    },
  });
}

// ---- Canvas-textured G-buffer material for crisp calligraphy plaques, clock faces, station signs --------------------

const TEX_VERT = /* glsl */`${PRECISION}
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * (viewMatrix * wp);
}`;

const TEX_FRAG = /* glsl */`${PRECISION}
${GBUFFER_ENCODE}
uniform sampler2D tMap;
uniform vec4 uNight;
uniform vec4 uParams;   // x: roughness, y: metalness, z: emissiveNight, w: emissiveDay
in vec3 vNormal;
in vec2 vUv;
void main() {
  vec4 tex = texture(tMap, vUv);
  vec3 lin = tex.rgb * tex.rgb;
  Surface s = defaultSurface();
  s.albedo = lin;
  s.normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  s.roughness = uParams.x;
  s.metalness = uParams.y;
  float nightOn = smoothstep(0.18, 0.58, uNight.y);
  float em = mix(uParams.w, uParams.z, nightOn);
  s.emissive = lin * em;
  writeGBuffer(s);
}`;

/** Create a G-buffer material backed by a CanvasTexture / Texture (signboards, plaques, clocks). */
export function heroTexMaterial(env, texture, { roughness = 0.45, metalness = 0.1, emissiveNight = 1.8, emissiveDay = 0.0, side = THREE.FrontSide } = {}) {
  return gbufferMaterial({
    vertexShader: TEX_VERT,
    fragmentShader: TEX_FRAG,
    side,
    name: 'hero-tex',
    uniforms: {
      tMap: { value: texture },
      uNight: env.uniforms.uNight,
      uParams: { value: new THREE.Vector4(roughness, metalness, emissiveNight, emissiveDay) },
    },
  });
}

/** Create a crisp calligraphy plaque THREE.Mesh (e.g. "洪崖洞", "人民解放纪念碑"). */
export function makePlaqueMesh(env, text, {
  w = 6.0, h = 2.0,
  bg = '#240b08', fg = '#f5c44e', border = '#c9932e', subtext = '',
  emissiveNight = 2.6, emissiveDay = 0.05, vertical = false,
} = {}) {
  const geo = new THREE.PlaneGeometry(w, h);
  if (typeof document === 'undefined') {
    return new THREE.Mesh(geo, heroMaterial(env));
  }
  const cw = vertical ? 256 : 512, ch = vertical ? 512 : 256;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);
  // Decorative double traditional border
  ctx.strokeStyle = border;
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, cw - 20, ch - 20);
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, cw - 48, ch - 48);
  // Corner flourishes
  ctx.fillStyle = border;
  for (const [cx, cy] of [[24, 24], [cw - 24, 24], [24, ch - 24], [cw - 24, ch - 24]]) {
    ctx.fillRect(cx - 7, cy - 7, 14, 14);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontStack = '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif';
  if (vertical) {
    const chars = [...text];
    const fs = Math.min(82, Math.floor((ch - 90) / Math.max(1, chars.length)));
    ctx.font = `700 ${fs}px ${fontStack}`;
    const step = (ch - 96) / Math.max(1, chars.length);
    chars.forEach((chStr, idx) => ctx.fillText(chStr, cw / 2, 54 + step * (idx + 0.5)));
  } else {
    const fs = subtext ? Math.min(92, Math.floor((cw - 80) / Math.max(2, text.length))) : Math.min(110, Math.floor((cw - 70) / Math.max(2, text.length)));
    ctx.font = `700 ${fs}px ${fontStack}`;
    ctx.fillText(text, cw / 2, subtext ? ch * 0.43 : ch * 0.52);
    if (subtext) {
      ctx.font = `600 28px "Noto Sans SC", sans-serif`;
      ctx.fillStyle = border;
      ctx.fillText(subtext, cw / 2, ch * 0.77);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const mat = heroTexMaterial(env, tex, { roughness: 0.38, metalness: 0.2, emissiveNight, emissiveDay });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.castShadow = false;
  return mesh;
}

/** Create a crisp illuminated clock-face THREE.Mesh (for Jiefangbei Monument). */
export function makeClockFaceMesh(env, radius = 1.05, { hour = 10, minute = 10 } = {}) {
  const geo = new THREE.CircleGeometry(radius, 32);
  if (typeof document === 'undefined') {
    return new THREE.Mesh(geo, heroMaterial(env));
  }
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const cx = S / 2, cy = S / 2, R = S * 0.46;
  // Cream ivory illuminated dial
  const grad = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  grad.addColorStop(0, '#fffdf5');
  grad.addColorStop(0.85, '#f2e8cf');
  grad.addColorStop(1, '#c8b892');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
  // Bronze outer bezel ring
  ctx.strokeStyle = '#3a2d1b';
  ctx.lineWidth = 18;
  ctx.beginPath(); ctx.arc(cx, cy, R - 4, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#6c5737';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.87, 0, TAU); ctx.stroke();
  // 60 minute ticks & 12 bold hour bars
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU - Math.PI / 2;
    const isHour = i % 5 === 0;
    const r0 = isHour ? R * 0.72 : R * 0.81;
    const r1 = R * 0.86;
    ctx.strokeStyle = '#1d1914';
    ctx.lineWidth = isHour ? 10 : 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  // Hour & minute hands
  const hAng = ((hour % 12 + minute / 60) / 12) * TAU - Math.PI / 2;
  const mAng = (minute / 60) * TAU - Math.PI / 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#14110e';
  ctx.lineWidth = 15;
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(hAng) * R * 0.12, cy - Math.sin(hAng) * R * 0.12);
  ctx.lineTo(cx + Math.cos(hAng) * R * 0.50, cy + Math.sin(hAng) * R * 0.50); ctx.stroke();
  ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(mAng) * R * 0.15, cy - Math.sin(mAng) * R * 0.15);
  ctx.lineTo(cx + Math.cos(mAng) * R * 0.72, cy + Math.sin(mAng) * R * 0.72); ctx.stroke();
  ctx.fillStyle = '#8b6e35';
  ctx.beginPath(); ctx.arc(cx, cy, 16, 0, TAU); ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const mat = heroTexMaterial(env, tex, { roughness: 0.25, metalness: 0.05, emissiveNight: 2.2, emissiveDay: 0.02 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.castShadow = false;
  return mesh;
}

// ---- Math utilities -------------------------------------------------------------------------------------------------

const _v3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const _nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const _len = (a) => Math.hypot(a[0], a[1], a[2]);
const _dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---- HeroKit: High-Precision Procedural Architectural Geometry Builder ----------------------------------------------

export class HeroKit {
  constructor() {
    this.p = [];   // positions (3)
    this.n = [];   // normals (3)
    this.c = [];   // colors (3)
    this.m = [];   // aMat (4)
    this.t = [];   // aTex (4)
    this.i = [];   // indices
    this.nv = 0;
    this.col = [0.55, 0.55, 0.55];
    this.mat = [0.65, 0.0, 0.0, 0.5];
    this.texType = MAT.PLAIN;
    this.texParam = 0.0;
    this.xf = null;
    this._nxf = null; // Matrix3 normal matrix
    this._stack = [];
  }

  /** Set linear RGB vertex color. */
  color(r, g, b) { this.col = [r, g, b]; return this; }

  /** Set PBR parameters: roughness, metalness, emissive (<0 = night only), reflectance. */
  material(rough, metal = 0, emissive = 0, refl = 0.5) {
    this.mat = [rough, metal, emissive, refl];
    return this;
  }

  /** Set procedural surface micro-detail type (from MAT.*) and optional scale/pitch param. */
  surface(matType = MAT.PLAIN, param = 0) {
    this.texType = matType;
    this.texParam = param;
    return this;
  }

  /** Convenience combo: color + PBR + procedural surface in one call. */
  style(rgb, rough = 0.7, metal = 0, emissive = 0, matType = MAT.PLAIN, param = 0, refl = 0.5) {
    this.col = rgb;
    this.mat = [rough, metal, emissive, refl];
    this.texType = matType;
    this.texParam = param;
    return this;
  }

  // ---- Transform stack ----------------------------------------------------------------------------------------------

  transform(m) {
    this.xf = m ? m.clone() : null;
    this._nxf = this.xf ? new THREE.Matrix3().getNormalMatrix(this.xf) : null;
    return this;
  }

  push() {
    this._stack.push(this.xf ? this.xf.clone() : null);
    return this;
  }

  pop() {
    const prev = this._stack.pop() ?? null;
    return this.transform(prev);
  }

  _mul(m) {
    if (!this.xf) this.xf = m;
    else this.xf = this.xf.clone().multiply(m);
    this._nxf = new THREE.Matrix3().getNormalMatrix(this.xf);
    return this;
  }

  translate(x, y, z) { return this._mul(new THREE.Matrix4().makeTranslation(x, y, z)); }
  rotateX(a) { return this._mul(new THREE.Matrix4().makeRotationX(a)); }
  rotateY(a) { return this._mul(new THREE.Matrix4().makeRotationY(a)); }
  rotateZ(a) { return this._mul(new THREE.Matrix4().makeRotationZ(a)); }
  scale(sx, sy = sx, sz = sx) { return this._mul(new THREE.Matrix4().makeScale(sx, sy, sz)); }

  // ---- Low-level vertex & face emission -----------------------------------------------------------------------------

  v(x, y, z, nx, ny, nz, u = 0, v = 0) {
    if (this.xf) {
      const e = this.xf.elements;
      const X = e[0] * x + e[4] * y + e[8] * z + e[12];
      const Y = e[1] * x + e[5] * y + e[9] * z + e[13];
      const Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      const ne = this._nxf.elements;
      let NX = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      let NY = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      let NZ = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const l = Math.hypot(NX, NY, NZ) || 1;
      x = X; y = Y; z = Z; nx = NX / l; ny = NY / l; nz = NZ / l;
    }
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(this.col[0], this.col[1], this.col[2]);
    this.m.push(this.mat[0], this.mat[1], this.mat[2], this.mat[3]);
    this.t.push(u, v, this.texType, this.texParam);
    return this.nv++;
  }

  tri(a, b, c, uvA = [0, 0], uvB = [1, 0], uvC = [0, 1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const i = this.v(a[0], a[1], a[2], nx, ny, nz, uvA[0], uvA[1]);
    this.v(b[0], b[1], b[2], nx, ny, nz, uvB[0], uvB[1]);
    this.v(c[0], c[1], c[2], nx, ny, nz, uvC[0], uvC[1]);
    this.i.push(i, i + 1, i + 2);
    return this;
  }

  /** Counter-clockwise quad seen from outside; U runs along a->b, V runs along a->d in physical metres. */
  quad(a, b, c, d, uvScale = 1, uvOverride = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-8) return this;
    nx /= l; ny /= l; nz /= l;
    let u0 = 0, v0 = 0, u1 = Math.hypot(ux, uy, uz) * uvScale, v1 = 0;
    let u2 = Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2]) * uvScale, v2 = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]) * uvScale;
    let u3 = 0, v3 = Math.hypot(vx, vy, vz) * uvScale;
    if (uvOverride) { [[u0, v0], [u1, v1], [u2, v2], [u3, v3]] = uvOverride; }
    const i = this.v(a[0], a[1], a[2], nx, ny, nz, u0, v0);
    this.v(b[0], b[1], b[2], nx, ny, nz, u1, v1);
    this.v(c[0], c[1], c[2], nx, ny, nz, u2, v2);
    this.v(d[0], d[1], d[2], nx, ny, nz, u3, v3);
    this.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
    return this;
  }

  /** Axis-aligned box centred at (cx, cy, cz) with metric UVs on all 6 faces. */
  box(cx, cy, cz, sx, sy, sz, uvScale = 1) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uvScale);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uvScale);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uvScale);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uvScale);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uvScale);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], uvScale);
    return this;
  }

  /** Chamfered / beveled plinth or column block (8-sided plan with beveled corners & optional top bevel). */
  beveledBox(cx, cy, cz, sx, sy, sz, bevel = 0.25) {
    const hx = sx / 2, hz = sz / 2, b = Math.min(bevel, hx * 0.45, hz * 0.45);
    const pts = [
      [cx - hx + b, cz + hz], [cx + hx - b, cz + hz],
      [cx + hx, cz + hz - b], [cx + hx, cz - hz + b],
      [cx + hx - b, cz - hz], [cx - hx + b, cz - hz],
      [cx - hx, cz - hz + b], [cx - hx, cz + hz - b],
    ];
    return this.prism(pts, cy - sy / 2, cy + sy / 2);
  }

  /** Extruded polygon prism (pts: CCW in XZ viewed from +Y, i.e. positive (x1-x0)*(z2-z0)-(z1-z0)*(x2-x0) < 0 in right-handed XZ). */
  prism(pts, y0, y1, { capTop = true, capBottom = true, uvScale = 1 } = {}) {
    return this.frustum(pts, pts, y0, y1, { capTop, capBottom, uvScale });
  }

  /** Tapered polygonal frustum between bottom ring pts0 (at y0) and top ring pts1 (at y1).
   *  Rings are [[x, z], ...] ordered counter-clockwise when viewed from ABOVE (+Y). */
  frustum(pts0, pts1, y0, y1, { capTop = true, capBottom = true, uvScale = 1, smooth = false } = {}) {
    const n = pts0.length;
    if (n < 3) return this;
    // Check orientation from above (+Y): standard right-handed (X right, Z toward viewer):
    // CCW from +Y means signed area sum(x_i * z_{i+1} - z_i * x_{i+1}) < 0.
    let area = 0;
    for (let k = 0; k < n; k++) {
      const a = pts0[k], b = pts0[(k + 1) % n];
      area += a[0] * b[1] - a[1] * b[0];
    }
    const r0 = area > 0 ? [...pts0].reverse() : pts0;
    const r1 = area > 0 ? [...pts1].reverse() : pts1;

    let uAcc = 0;
    if (smooth) {
      const base = this.nv;
      const dy = y1 - y0;
      for (let k = 0; k <= n; k++) {
        const idx = k % n, prev = (k + n - 1) % n, next = (k + 1) % n;
        const p0 = r0[idx], p1 = r1[idx];
        const ePrev = [p0[0] - r0[prev][0], p0[1] - r0[prev][1]];
        const eNext = [r0[next][0] - p0[0], r0[next][1] - p0[1]];
        // Outward normal in XZ for CCW from +Y: for edge (dx, dz), outward is (-dz, dx)
        const n0 = _nrm([-ePrev[1], 0, ePrev[0]]), n1 = _nrm([-eNext[1], 0, eNext[0]]);
        let nx = n0[0] + n1[0], nz = n0[2] + n1[2];
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const dr = (p0[0] - p1[0]) * nx + (p0[1] - p1[1]) * nz;
        const nVec = _nrm([nx * dy, dr, nz * dy]);
        this.v(p0[0], y0, p0[1], nVec[0], nVec[1], nVec[2], uAcc * uvScale, y0 * uvScale);
        this.v(p1[0], y1, p1[1], nVec[0], nVec[1], nVec[2], uAcc * uvScale, y1 * uvScale);
        if (k < n) uAcc += Math.hypot(r0[next][0] - p0[0], r0[next][1] - p0[1]);
      }
      for (let k = 0; k < n; k++) {
        const i = base + k * 2;
        this.i.push(i, i + 2, i + 3, i, i + 3, i + 1);
      }
    } else {
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const a = [r0[k][0], y0, r0[k][1]], b = [r0[j][0], y0, r0[j][1]];
        const c = [r1[j][0], y1, r1[j][1]], d = [r1[k][0], y1, r1[k][1]];
        const w = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const h = Math.hypot(d[0] - a[0], y1 - y0, d[2] - a[2]);
        this.quad(a, b, c, d, uvScale, [
          [uAcc * uvScale, y0 * uvScale], [(uAcc + w) * uvScale, y0 * uvScale],
          [(uAcc + w) * uvScale, (y0 + h) * uvScale], [uAcc * uvScale, (y0 + h) * uvScale],
        ]);
        uAcc += w;
      }
    }
    if (capTop) this._capRing(r1, y1, 1, uvScale);
    if (capBottom) this._capRing(r0, y0, -1, uvScale);
    return this;
  }

  _capRing(ring, y, ny, uvScale) {
    const n = ring.length;
    let cx = 0, cz = 0;
    for (let k = 0; k < n; k++) { cx += ring[k][0]; cz += ring[k][1]; }
    cx /= n; cz /= n;
    const cIdx = this.v(cx, y, cz, 0, ny, 0, cx * uvScale, cz * uvScale);
    const base = this.nv;
    for (let k = 0; k < n; k++) this.v(ring[k][0], y, ring[k][1], 0, ny, 0, ring[k][0] * uvScale, ring[k][1] * uvScale);
    for (let k = 0; k < n; k++) {
      const a = base + k, b = base + ((k + 1) % n);
      if (ny > 0) this.i.push(cIdx, a, b);
      else this.i.push(cIdx, b, a);
    }
  }

  /** Smooth tapered tube from A to B with optional top & bottom caps. */
  tube(A, B, r0, r1 = r0, sides = 12, capTop = true, capBottom = false) {
    const d = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const L = d.length();
    if (L < 1e-6) return this;
    d.normalize();
    const up = Math.abs(d.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const a = new THREE.Vector3().crossVectors(up, d).normalize();
    const b = new THREE.Vector3().crossVectors(d, a);
    const base = this.nv;
    const slope = (r0 - r1) / L;
    const circum = Math.PI * (r0 + r1);
    for (let k = 0; k <= sides; k++) {
      const frac = k / sides, t = frac * TAU, c = Math.cos(t), s = Math.sin(t);
      let nx = a.x * c + b.x * s + d.x * slope;
      let ny = a.y * c + b.y * s + d.y * slope;
      let nz = a.z * c + b.z * s + d.z * slope;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const u = frac * circum;
      this.v(A[0] + (a.x * c + b.x * s) * r0, A[1] + (a.y * c + b.y * s) * r0, A[2] + (a.z * c + b.z * s) * r0, nx, ny, nz, u, 0);
      this.v(B[0] + (a.x * c + b.x * s) * r1, B[1] + (a.y * c + b.y * s) * r1, B[2] + (a.z * c + b.z * s) * r1, nx, ny, nz, u, L);
    }
    for (let k = 0; k < sides; k++) {
      const i = base + k * 2;
      this.i.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
    if (capTop && r1 > 1e-4) {
      const c0 = this.v(B[0], B[1], B[2], d.x, d.y, d.z, 0, 0);
      for (let k = 0; k < sides; k++) {
        const t0 = k / sides * TAU, t1 = (k + 1) / sides * TAU;
        const i0 = this.v(B[0] + (a.x * Math.cos(t0) + b.x * Math.sin(t0)) * r1, B[1] + (a.y * Math.cos(t0) + b.y * Math.sin(t0)) * r1, B[2] + (a.z * Math.cos(t0) + b.z * Math.sin(t0)) * r1, d.x, d.y, d.z, Math.cos(t0) * r1, Math.sin(t0) * r1);
        const i1 = this.v(B[0] + (a.x * Math.cos(t1) + b.x * Math.sin(t1)) * r1, B[1] + (a.y * Math.cos(t1) + b.y * Math.sin(t1)) * r1, B[2] + (a.z * Math.cos(t1) + b.z * Math.sin(t1)) * r1, d.x, d.y, d.z, Math.cos(t1) * r1, Math.sin(t1) * r1);
        this.i.push(c0, i0, i1);
      }
    }
    if (capBottom && r0 > 1e-4) {
      const c0 = this.v(A[0], A[1], A[2], -d.x, -d.y, -d.z, 0, 0);
      for (let k = 0; k < sides; k++) {
        const t0 = k / sides * TAU, t1 = (k + 1) / sides * TAU;
        const i0 = this.v(A[0] + (a.x * Math.cos(t0) + b.x * Math.sin(t0)) * r0, A[1] + (a.y * Math.cos(t0) + b.y * Math.sin(t0)) * r0, A[2] + (a.z * Math.cos(t0) + b.z * Math.sin(t0)) * r0, -d.x, -d.y, -d.z, Math.cos(t0) * r0, Math.sin(t0) * r0);
        const i1 = this.v(A[0] + (a.x * Math.cos(t1) + b.x * Math.sin(t1)) * r0, A[1] + (a.y * Math.cos(t1) + b.y * Math.sin(t1)) * r0, A[2] + (a.z * Math.cos(t1) + b.z * Math.sin(t1)) * r0, -d.x, -d.y, -d.z, Math.cos(t1) * r0, Math.sin(t1) * r0);
        this.i.push(c0, i1, i0);
      }
    }
    return this;
  }

  /** Surface of revolution around Y axis: profile = [[radius, y], ...] bottom to top. */
  lathe(profile, sides = 28, cx = 0, cz = 0, { uvTileCircum = 0 } = {}) {
    const base = this.nv, n = profile.length;
    let maxR = 0.01;
    for (let j = 0; j < n; j++) if (profile[j][0] > maxR) maxR = profile[j][0];
    const uSpan = uvTileCircum > 0 ? uvTileCircum : TAU * maxR;
    let vAcc = 0;
    for (let j = 0; j < n; j++) {
      const [r, y] = profile[j];
      if (j > 0) vAcc += Math.hypot(r - profile[j - 1][0], y - profile[j - 1][1]);
      const p0 = profile[Math.max(0, j - 1)], p1 = profile[Math.min(n - 1, j + 1)];
      const dr = p1[0] - p0[0], dy = p1[1] - p0[1];
      const l = Math.hypot(dr, dy) || 1;
      const nr = dy / l, ny = -dr / l;
      for (let k = 0; k <= sides; k++) {
        const frac = k / sides, t = frac * TAU, c = Math.cos(t), s = Math.sin(t);
        this.v(cx + c * r, y, cz + s * r, c * nr, ny, s * nr, frac * uSpan, vAcc);
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let k = 0; k < sides; k++) {
        const a = base + j * (sides + 1) + k, b = a + sides + 1;
        this.i.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    return this;
  }

  sphere(cx, cy, cz, r, sides = 20, rings = 12) {
    const prof = [];
    for (let j = 0; j <= rings; j++) {
      const t = -Math.PI / 2 + j / rings * Math.PI;
      prof.push([Math.max(0, Math.cos(t) * r), cy + Math.sin(t) * r]);
    }
    return this.lathe(prof, sides, cx, cz);
  }

  /** Rectangular cross-section swept along 3D polyline `pts`, spanned by half-vectors U[i], V[i]. */
  sweep(pts, U, V, caps = true, uvScale = 1) {
    if (pts.length < 2) return this;
    const ring = (i) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [
      pts[i][0] + U[i][0] * s + V[i][0] * t,
      pts[i][1] + U[i][1] * s + V[i][1] * t,
      pts[i][2] + U[i][2] * s + V[i][2] * t,
    ]);
    let a = ring(0);
    const T0 = _v3(pts[1], pts[0]), c0 = _crs(U[0], V[0]);
    const flip = _dot(c0, T0) > 0;
    if (caps) {
      if (flip) this.quad(a[0], a[3], a[2], a[1], uvScale);
      else this.quad(a[0], a[1], a[2], a[3], uvScale);
    }
    for (let i = 1; i < pts.length; i++) {
      const b = ring(i);
      for (let k = 0; k < 4; k++) {
        const j = (k + 1) % 4;
        if (flip) this.quad(a[k], a[j], b[j], b[k], uvScale);
        else this.quad(a[j], a[k], b[k], b[j], uvScale);
      }
      a = b;
    }
    if (caps) {
      if (flip) this.quad(a[0], a[1], a[2], a[3], uvScale);
      else this.quad(a[0], a[3], a[2], a[1], uvScale);
    }
    return this;
  }

  /** Arbitrary closed cross-section loft: rings[s] = [[x,y,z], ...] of equal length N along a spine. */
  loft(rings, { caps = true, smooth = true, uvScale = 1 } = {}) {
    const S = rings.length;
    if (S < 2) return this;
    const N = rings[0].length;
    // Detect winding from ring 0 -> ring 1 so normals face outward
    const center = (r) => {
      let x = 0, y = 0, z = 0;
      for (const p of r) { x += p[0]; y += p[1]; z += p[2]; }
      return [x / N, y / N, z / N];
    };
    const c0 = center(rings[0]), c1 = center(rings[1]);
    const fwd = _v3(c1, c0);
    const eA = _v3(rings[0][1], rings[0][0]), out = _v3(rings[0][0], c0);
    const flip = _dot(_crs(eA, fwd), out) < 0;

    if (!smooth) {
      for (let s = 0; s < S - 1; s++) {
        for (let k = 0; k < N; k++) {
          const j = (k + 1) % N;
          const p00 = rings[s][k], p01 = rings[s][j], p11 = rings[s + 1][j], p10 = rings[s + 1][k];
          if (flip) this.quad(p01, p00, p10, p11, uvScale);
          else this.quad(p00, p01, p11, p10, uvScale);
        }
      }
    } else {
      const base = this.nv;
      let vAcc = 0;
      const centers = rings.map(center);
      for (let s = 0; s < S; s++) {
        if (s > 0) vAcc += _len(_v3(centers[s], centers[s - 1]));
        const sPrev = Math.max(0, s - 1), sNext = Math.min(S - 1, s + 1);
        let uAcc = 0;
        for (let k = 0; k <= N; k++) {
          const idx = k % N, kPrev = (k + N - 1) % N, kNext = (k + 1) % N;
          const p = rings[s][idx];
          const tU = _v3(rings[s][kNext], rings[s][kPrev]);
          const tV = _v3(rings[sNext][idx], rings[sPrev][idx]);
          let n = _nrm(flip ? _crs(tV, tU) : _crs(tU, tV));
          this.v(p[0], p[1], p[2], n[0], n[1], n[2], uAcc * uvScale, vAcc * uvScale);
          if (k < N) uAcc += _len(_v3(rings[s][kNext], p));
        }
      }
      for (let s = 0; s < S - 1; s++) {
        for (let k = 0; k < N; k++) {
          const a = base + s * (N + 1) + k, b = a + (N + 1);
          if (flip) this.i.push(a, b, a + 1, a + 1, b, b + 1);
          else this.i.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    if (caps) {
      for (const [s, rev] of [[0, !flip], [S - 1, flip]]) {
        const r = rings[s], c = center(r);
        const tA = _v3(r[1], r[0]), tB = _v3(r[2], r[0]);
        let n = _nrm(_crs(tA, tB));
        const toMid = _v3(s === 0 ? centersOrMid(rings, 1) : centersOrMid(rings, S - 2), c);
        if (_dot(n, toMid) > 0) n = [-n[0], -n[1], -n[2]];
        const cIdx = this.v(c[0], c[1], c[2], n[0], n[1], n[2], 0, 0);
        const base = this.nv;
        for (let k = 0; k < N; k++) this.v(r[k][0], r[k][1], r[k][2], n[0], n[1], n[2], k, 0);
        for (let k = 0; k < N; k++) {
          const a = base + k, b = base + ((k + 1) % N);
          const e1 = _v3(r[k], c), e2 = _v3(r[(k + 1) % N], c);
          if (_dot(_crs(e1, e2), n) >= 0) this.i.push(cIdx, a, b);
          else this.i.push(cIdx, b, a);
        }
      }
    }
    return this;
  }

  // ---- Chongqing / Bayu High-Detail Architectural Builders ----------------------------------------------------------

  /**
   * Authentic Bayu / Chinese concave swept roof with upturned flying corner eaves (重檐飞檐翘角),
   * sculpted ridge beams, hip ridges, ridge finials (翘角吻兽), exposed rafters (椽子),
   * and optional warm golden Chongqing night LED cornice strip underneath.
   */
  bayuRoof(w, d, y0, {
    rise = 3.2,
    eaveOut = 1.6,
    cornerLift = 1.25,
    cornerFlare = 0.65,
    tileRgb = [0.095, 0.105, 0.12],
    tileMat = MAT.BAYU_TILE,
    tilePitch = 0.28,
    ridgeRgb = [0.16, 0.17, 0.19],
    woodRgb = [0.18, 0.065, 0.04],
    rafters = true,
    goldStrip = true,
    goldEmit = -5.2,
    nu = 8,
    nt = 5,
    ridgeRatio = 0.52,
    ornaments = true,
  } = {}) {
    if (d > w) {
      this.push().rotateY(Math.PI / 2);
      this.bayuRoof(d, w, y0, { rise, eaveOut, cornerLift, cornerFlare, tileRgb, tileMat, tilePitch, ridgeRgb, woodRgb, rafters, goldStrip, goldEmit, nu, nt, ridgeRatio, ornaments });
      return this.pop();
    }
    const A = w / 2 + eaveOut, B = d / 2 + eaveOut;
    const ridgeHalf = Math.max(A - B * 0.85, A * ridgeRatio);

    // Concave roof surface evaluator: f in 0..3 (front +Z, right +X, back -Z, left -X), u in [-1,1], t in [0,1]
    const evalP = (f, u, t) => {
      const s = 1 - t;
      const au = Math.abs(u);
      const flare = 1 + cornerFlare * Math.pow(au, 3.2) * s * s / Math.max(A, B);
      const lift = cornerLift * Math.pow(au, 2.8) * Math.pow(s, 1.8);
      const y = y0 + rise * Math.pow(t, 1.62) + lift;
      const xHalf = (A + (ridgeHalf - A) * t) * flare;
      const zHalf = B * s * flare;
      if (f === 0) return [u * xHalf, y, zHalf];
      if (f === 1) return [xHalf, y, -u * zHalf];
      if (f === 2) return [-u * xHalf, y, -zHalf];
      return [-xHalf, y, u * zHalf];
    };

    // Upper tiled roof shell (with cylindrical tile UVs: u = eave distance, v = slope distance)
    this.style(tileRgb, tileMat === MAT.GLAZED_TILE ? 0.18 : 0.62, tileMat === MAT.GLAZED_TILE ? 0.08 : 0.0, 0, tileMat, tilePitch, tileMat === MAT.GLAZED_TILE ? 0.8 : 0.5);
    for (let f = 0; f < 4; f++) {
      const spanW = (f === 0 || f === 2) ? A * 2 : B * 2;
      const slopeL = Math.hypot(B, rise);
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nt; j++) {
          const u0 = -1 + 2 * i / nu, u1 = -1 + 2 * (i + 1) / nu;
          const t0 = j / nt, t1 = (j + 1) / nt;
          const p00 = evalP(f, u0, t0), p10 = evalP(f, u1, t0), p11 = evalP(f, u1, t1), p01 = evalP(f, u0, t1);
          const U0 = (u0 * 0.5 + 0.5) * spanW, U1 = (u1 * 0.5 + 0.5) * spanW;
          const V0 = t0 * slopeL, V1 = t1 * slopeL;
          this.quad(p00, p10, p11, p01, 1, [[U0, V0], [U1, V0], [U1, V1], [U0, V1]]);
        }
      }
    }

    // Thickened wooden soffit / fascia edge under eaves (prevents paper-thin edges from below!)
    this.style(woodRgb, 0.58, 0, 0, MAT.TIMBER);
    const thick = 0.24;
    for (let f = 0; f < 4; f++) {
      for (let i = 0; i < nu; i++) {
        const u0 = -1 + 2 * i / nu, u1 = -1 + 2 * (i + 1) / nu;
        const a = evalP(f, u0, 0), b = evalP(f, u1, 0);
        const aD = [a[0], a[1] - thick, a[2]], bD = [b[0], b[1] - thick, b[2]];
        // Outer fascia lip
        this.quad(aD, bD, b, a);
        // Underside soffit band inward toward wall
        const aIn = evalP(f, u0, 0.35), bIn = evalP(f, u1, 0.35);
        this.quad(bD, aD, [aIn[0], aIn[1] - thick, aIn[2]], [bIn[0], bIn[1] - thick, bIn[2]]);
      }
    }

    // Exposed double-layer wooden rafters (椽子) + carved dougong/niutui eave brackets (牛腿) + cylindrical eave tile drip caps (瓦当)!
    if (rafters) {
      this.style([woodRgb[0] * 1.15, woodRgb[1] * 1.1, woodRgb[2] * 1.1], 0.55, 0, 0, MAT.TIMBER);
      const nX = Math.max(4, Math.min(18, Math.round(w / 1.45)));
      for (let k = 0; k <= nX; k++) {
        const u = -0.92 + 1.84 * (k / nX);
        for (const f of [0, 2]) {
          const pOut = evalP(f, u, 0.01);
          const pIn = evalP(f, u, 0.44);
          this.tube([pIn[0], pIn[1] - 0.22, pIn[2]], [pOut[0], pOut[1] - 0.16, pOut[2]], 0.08, 0.072, 4, false);
        }
      }
      // Sculpted 3D cylindrical eave tile end-caps (瓦当) along front eave for crisp macro detail!
      this.style(ridgeRgb, 0.50, 0.05, 0, MAT.PLAIN);
      const nCap = Math.max(6, Math.min(18, Math.round(w / 1.5)));
      for (let k = 0; k <= nCap; k++) {
        const u = -0.94 + 1.88 * (k / nCap);
        const pF = evalP(0, u, 0.0);
        this.box(pF[0], pF[1] - 0.06, pF[2] + 0.04, 0.18, 0.20, 0.12);
      }
      // Real 3D carved dougong / niutui timber eave brackets under front eave purlin!
      const nBrk = Math.max(2, Math.min(6, Math.round(w / 5.5)));
      for (let k = 0; k <= nBrk; k++) {
        const u = -0.82 + 1.64 * (k / nBrk);
        const pIn = evalP(0, u, 0.36);
        this.dougongBracket(pIn[0], pIn[1] - 0.52, pIn[2] - 0.25, 0.72, {
          woodRgb,
          polychrome: tileMat === MAT.GLAZED_TILE,
        });
      }
    }

    // Main ridge beam (正脊) + curved corner hip ridges (垂脊) + upturned ridge ornaments (吻兽)
    this.style(ridgeRgb, 0.48, 0.08, 0, MAT.PLAIN);
    this.box(0, y0 + rise + 0.22, 0, ridgeHalf * 2 + 0.5, 0.48, 0.42);
    for (let f = 0; f < 4; f++) {
      // Corner hip ridge follows u = 1 on each face
      const pts = [], Uv = [], Vv = [];
      for (let j = 0; j <= nt; j++) {
        const p = evalP(f, 1, j / nt);
        pts.push([p[0], p[1] + 0.14, p[2]]);
        Uv.push([0.16, 0, 0]);
        Vv.push([0, 0.18, 0]);
      }
      this.sweep(pts, Uv, Vv, true);
      if (ornaments) {
        const tip = evalP(f, 1, 0);
        this.tube([tip[0], tip[1] + 0.1, tip[2]], [tip[0] * 1.03, tip[1] + 0.72, tip[2] * 1.03], 0.15, 0.04, 6, true);
      }
    }
    if (ornaments) {
      // Chiwen (吻兽) curled end finials on main ridge
      for (const sg of [-1, 1]) {
        this.box(sg * (ridgeHalf + 0.25), y0 + rise + 0.65, 0, 0.48, 0.95, 0.46);
        this.box(sg * (ridgeHalf + 0.42), y0 + rise + 0.92, 0, 0.34, 0.52, 0.36);
      }
    }

    // Iconic Chongqing golden night LED cornice strip tucked cleanly BELOW the wooden eave soffit (0.048m clear — ZERO Z-fighting!)
    if (goldStrip) {
      this.style([1.0, 0.66, 0.18], 0.25, 0, goldEmit, MAT.LANTERN);
      for (let f = 0; f < 4; f++) {
        for (let i = 0; i < nu; i++) {
          const u0 = -1 + 2 * i / nu, u1 = -1 + 2 * (i + 1) / nu;
          const a = evalP(f, u0, 0.03), b = evalP(f, u1, 0.03);
          this.tube([a[0], a[1] - 0.36, a[2]], [b[0], b[1] - 0.36, b[2]], 0.072, 0.072, 4, false);
        }
      }
    }
    return this;
  }

  /**
   * Carved balustrade / railing from A to B (both timber Bayu style and carved white/grey stone).
   */
  balustrade(A, B, h = 1.08, {
    rgb = [0.22, 0.075, 0.045],
    matType = MAT.TIMBER,
    postSpacing = 2.4,
    balusterSpacing = 0.45,
    topW = 0.14,
    curbH = 0.16,
    goldCap = false,
  } = {}) {
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.2) return this;
    const ang = Math.atan2(-dz, dx);
    const hLen = Math.hypot(dx, dz);
    this.push().translate(A[0], A[1], A[2]).rotateY(ang);
    const slope = dy / Math.max(hLen, 1e-4);
    const at = (x, yo) => [x, x * slope + yo, 0];

    this.style(rgb, matType === MAT.STONE || matType === MAT.GRANITE ? 0.72 : 0.55, 0, 0, matType);
    // Bottom curb & rails
    this.tube(at(0, curbH * 0.5), at(hLen, curbH * 0.5), curbH * 0.55, curbH * 0.55, 4, true);
    this.tube(at(0, h - 0.06), at(hLen, h - 0.06), topW * 0.65, topW * 0.65, 4, true);
    this.tube(at(0, h * 0.35), at(hLen, h * 0.35), topW * 0.32, topW * 0.32, 4, false);
    this.tube(at(0, h * 0.72), at(hLen, h * 0.72), topW * 0.32, topW * 0.32, 4, false);

    // Carved main newel posts
    const nPosts = Math.max(1, Math.round(hLen / postSpacing));
    for (let k = 0; k <= nPosts; k++) {
      const x = hLen * k / nPosts;
      const yBase = x * slope;
      this.box(x, yBase + (h + 0.14) / 2, 0, topW * 1.35, h + 0.14, topW * 1.35);
      // Lotus/sphere finial cap on post
      this.sphere(x, yBase + h + 0.20, 0, topW * 0.78, 8, 5);
    }

    // Vertical lattice balusters between posts
    const nBal = Math.max(2, Math.round(hLen / balusterSpacing));
    for (let k = 1; k < nBal; k++) {
      const x = hLen * k / nBal;
      const yBase = x * slope;
      this.box(x, yBase + h * 0.52, 0, 0.055, h - curbH - 0.1, 0.055);
    }

    if (goldCap) {
      // Position warm architectural LED strip cleanly tucked beneath top handrail (>0.05m clear of curb & rails — ZERO Z-fighting!)
      this.style([1.0, 0.68, 0.20], 0.25, 0, -4.0, MAT.LANTERN);
      this.tube(at(0, h - 0.17), at(hLen, h - 0.17), 0.032, 0.032, 4, false);
    }
    return this.pop();
  }

  /**
   * Cantilevered Bayu diaojiaolou balcony (吊脚阳台): deck slab, floor joists,
   * diagonal wooden support struts (吊脚撑杆), carved balustrade, and optional lanterns.
   * Local space: centred at x=0, wall at z=0, projecting to z = +depth, deck surface at y.
   */
  bayuBalcony(w, depth, y, {
    woodRgb = [0.19, 0.068, 0.042],
    railRgb = [0.24, 0.082, 0.048],
    strutDrop = 2.6,
    railH = 1.12,
    lanterns = true,
    goldStrip = true,
  } = {}) {
    // Deck slab & protruding floor joists
    this.style(woodRgb, 0.62, 0, 0, MAT.TIMBER);
    this.box(0, y - 0.16, depth / 2, w + 0.2, 0.32, depth);
    const nStruts = Math.max(2, Math.round(w / 3.4) + 1);
    for (let k = 0; k < nStruts; k++) {
      const x = -w / 2 + 0.4 + (w - 0.8) * (nStruts === 1 ? 0.5 : k / (nStruts - 1));
      // Horizontal cantilever joist beam
      this.box(x, y - 0.36, depth * 0.52, 0.22, 0.24, depth + 0.35);
      // Diagonal diaojiaolou strut from wall below up to balcony outer rim
      if (strutDrop > 0.3) {
        this.tube([x, y - strutDrop, 0.05], [x, y - 0.32, depth * 0.86], 0.13, 0.11, 6, true);
        // Horizontal tie cross-brace
        this.tube([x, y - strutDrop * 0.48, 0.05], [x, y - strutDrop * 0.48, depth * 0.44], 0.08, 0.08, 5, false);
      }
    }
    // Carved balustrades along front and sides
    this.balustrade([-w / 2, y, depth - 0.08], [w / 2, y, depth - 0.08], railH, { rgb: railRgb, goldCap: goldStrip });
    this.balustrade([-w / 2, y, 0.05], [-w / 2, y, depth - 0.08], railH, { rgb: railRgb });
    this.balustrade([w / 2, y, 0.05], [w / 2, y, depth - 0.08], railH, { rgb: railRgb });

    if (lanterns) {
      const nL = Math.max(2, Math.floor(w / 4.2));
      for (let k = 0; k < nL; k++) {
        const lx = -w / 2 + (k + 0.5) * (w / nL);
        this.lantern(lx, y + 2.35, depth - 0.35, 0.34, 0.56);
      }
    }
    return this;
  }

  /** Detailed glowing traditional red Chinese lantern (with gold end-caps & tassel; ACES-calibrated crimson!). */
  lantern(cx, cy, cz, r = 0.34, h = 0.56, emit = -2.4) {
    // Hanging cord
    this.style([0.12, 0.05, 0.03], 0.6, 0, 0, MAT.PLAIN);
    this.tube([cx, cy + h * 0.55, cz], [cx, cy + h * 0.92, cz], 0.025, 0.025, 4, false);
    // Gold top & bottom collar caps
    this.style([0.82, 0.56, 0.12], 0.32, 0.82, 0, MAT.METAL);
    this.tube([cx, cy + h * 0.42, cz], [cx, cy + h * 0.55, cz], r * 0.48, r * 0.38, 8, true);
    this.tube([cx, cy - h * 0.54, cz], [cx, cy - h * 0.42, cz], r * 0.36, r * 0.46, 8, true);
    // Deep matte velvet Chinese vermilion-crimson silk (rough=0.84, refl=0.10 prevents white sky specular turning red paper pink!)
    const clampedEmit = emit < 0 ? Math.max(emit, -2.2) : Math.min(emit, 2.2);
    this.style([0.56, 0.012, 0.005], 0.84, 0, clampedEmit, MAT.LANTERN, 0, 0.10);
    const prof = [
      [r * 0.42, cy - h * 0.44],
      [r * 0.86, cy - h * 0.28],
      [r, cy],
      [r * 0.86, cy + h * 0.28],
      [r * 0.42, cy + h * 0.44],
    ];
    this.lathe(prof, 10, cx, cz);
    // Tassel
    this.style([0.82, 0.14, 0.06], 0.7, 0, emit * 0.25, MAT.PLAIN);
    this.tube([cx, cy - h * 0.54, cz], [cx, cy - h * 0.96, cz], 0.055, 0.02, 5, false);
    return this;
  }

  /** Catenary string of hanging glowing red lanterns from A to B. */
  lanternString(A, B, count = 6, sag = 0.9, r = 0.32, h = 0.52) {
    this.style([0.12, 0.08, 0.06], 0.6, 0, 0, MAT.PLAIN);
    const segs = Math.max(8, count * 2);
    const pt = (t) => [
      A[0] + (B[0] - A[0]) * t,
      A[1] + (B[1] - A[1]) * t - 4 * sag * t * (1 - t),
      A[2] + (B[2] - A[2]) * t,
    ];
    for (let k = 0; k < segs; k++) this.tube(pt(k / segs), pt((k + 1) / segs), 0.025, 0.025, 4, false);
    for (let k = 0; k < count; k++) {
      const p = pt((k + 0.5) / count);
      this.lantern(p[0], p[1] - h * 0.65, p[2], r, h);
    }
    return this;
  }

  /** Multi-bay vaulted stone arch colonnade / arcade (true curved arch soffits & keystones).
   *  Local space: centred at x=0, front face at z = +depth/2, base at y=0, total height h. */
  archArcade(totalW, h, depth, nArches, {
    stoneRgb = [0.44, 0.41, 0.36],
    innerRgb = [0.16, 0.13, 0.11],
    pierRatio = 0.28,
    archSegs = 10,
    warmBackGlow = -1.6,
  } = {}) {
    const bayW = totalW / nArches;
    const pierW = bayW * pierRatio;
    const openW = bayW - pierW;
    const rad = openW / 2;
    const springY = Math.max(h * 0.38, h - rad - 1.2);
    const zF = depth / 2, zB = -depth / 2;

    this.style(stoneRgb, 0.82, 0, 0, MAT.STONE, 0.55);
    // Piers between arches
    for (let k = 0; k <= nArches; k++) {
      const x = -totalW / 2 + k * bayW;
      const pw = (k === 0 || k === nArches) ? pierW * 0.65 : pierW;
      const px = k === 0 ? x + pw / 2 : k === nArches ? x - pw / 2 : x;
      this.box(px, h / 2, 0, pw, h, depth);
      // Projecting impost capital at arch springing
      this.box(px, springY, 0, pw + 0.24, 0.36, depth + 0.22);
      // Base plinth
      this.box(px, 0.4, 0, pw + 0.22, 0.8, depth + 0.20);
    }

    // Spandrel wall + arched intrados soffit + keystone over each bay
    for (let k = 0; k < nArches; k++) {
      const cx = -totalW / 2 + (k + 0.5) * bayW;
      const xL = cx - rad, xR = cx + rad;
      this.style(stoneRgb, 0.80, 0, 0, MAT.STONE, 0.52);
      for (let s = 0; s < archSegs; s++) {
        const a0 = Math.PI - (s / archSegs) * Math.PI;
        const a1 = Math.PI - ((s + 1) / archSegs) * Math.PI;
        const p0x = cx + Math.cos(a0) * rad, p0y = springY + Math.sin(a0) * rad;
        const p1x = cx + Math.cos(a1) * rad, p1y = springY + Math.sin(a1) * rad;
        // Front spandrel quad
        this.quad([p0x, p0y, zF], [p1x, p1y, zF], [p1x, h, zF], [p0x, h, zF]);
        // Back spandrel quad
        this.quad([p1x, p1y, zB], [p0x, p0y, zB], [p0x, h, zB], [p1x, h, zB]);
        // Curved vault soffit underneath
        this.quad([p0x, p0y, zB], [p1x, p1y, zB], [p1x, p1y, zF], [p0x, p0y, zF]);
      }
      // Top cornice cap
      this.box(cx, h - 0.18, 0, openW + 0.1, 0.36, depth + 0.28);
      // Projecting keystone at arch crown
      this.box(cx, springY + rad + 0.15, zF + 0.12, 0.55, 0.72, 0.26);

      // Recessed dark warm-lit arcade interior shop/passage back wall
      if (warmBackGlow !== 0) {
        this.style([0.92, 0.58, 0.22], 0.4, 0, warmBackGlow, MAT.LATTICE_WIN, 0.36);
        this.box(cx, (springY + rad * 0.5) / 2, zB + 0.35, openW - 0.15, springY + rad * 0.5, 0.2);
      } else {
        this.style(innerRgb, 0.85, 0, 0, MAT.STONE, 0.5);
        this.box(cx, springY / 2, zB + 0.2, openW, springY, 0.2);
      }
    }
    return this;
  }

  /** Real 3D stepped staircase rising from A to B with treads, risers, and stone cheek walls. */
  stairs(A, B, width = 6.0, stepH = 0.26, {
    rgb = [0.54, 0.52, 0.48],
    cheekRgb = [0.46, 0.44, 0.40],
    cheeks = true,
    matType = MAT.GRANITE,
  } = {}) {
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const hLen = Math.hypot(dx, dz);
    const nSteps = Math.max(2, Math.round(Math.abs(dy) / stepH));
    const ang = Math.atan2(-dz, dx);
    this.push().translate(A[0], A[1], A[2]).rotateY(ang);
    const run = hLen / nSteps, rise = dy / nSteps;
    // Phase 5: exact step run (ZERO step-to-step side-face Z-fighting!) & tuck step sides cleanly inside stone cheek walls
    // (0.06m clear of both cheek inner & outer faces -> ZERO Z-fighting on staircase cheeks in hm_f05/hm_f06!)
    const stepW = cheeks ? width + 0.12 : width;
    this.style(rgb, 0.72, 0, 0, matType, 1.0);
    for (let k = 0; k < nSteps; k++) {
      const x0 = k * run, x1 = (k + 1) * run;
      const yTop = (k + 1) * rise;
      const yBot = Math.min(0, yTop) - 0.6;
      this.box((x0 + x1) / 2, (yBot + yTop) / 2, 0, run, Math.max(0.2, yTop - yBot), stepW);
    }
    if (cheeks) {
      this.style(cheekRgb, 0.78, 0, 0, MAT.STONE, 0.5);
      for (const sg of [-1, 1]) {
        const z = sg * (width / 2 + 0.28);
        this.sweep([[0, 0.4, z], [hLen, dy + 0.4, z]], [[0, 0, 0.28], [0, 0, 0.28]], [[0, 0.75, 0], [0, 0.75, 0]]);
      }
    }
    return this.pop();
  }

  /** Classical column (circular or fluted) with stone drum plinth, shaft, and capital / dougong bracket. */
  column(x, y0, y1, r = 0.45, {
    shaftRgb = [0.58, 0.08, 0.06],
    baseRgb = [0.76, 0.74, 0.70],
    capRgb = [0.16, 0.44, 0.34],
    sides = 14,
    dougong = false,
  } = {}) {
    const H = y1 - y0;
    if (H < 0.2) return this;
    const baseH = Math.min(0.65, H * 0.12);
    const capH = Math.min(0.85, H * 0.14);
    this.style(baseRgb, 0.68, 0, 0, MAT.GRANITE, 0.6);
    this.box(x, y0 + baseH * 0.35, 0, r * 2.7, baseH * 0.7, r * 2.7);
    this.tube([x, y0 + baseH * 0.68, 0], [x, y0 + baseH, 0], r * 1.28, r * 1.06, sides, true);
    this.style(shaftRgb, 0.42, 0.05, 0, MAT.TIMBER);
    this.tube([x, y0 + baseH, 0], [x, y1 - capH, 0], r, r * 0.94, sides, false);
    if (dougong) {
      // Multi-tiered imperial dougong bracket cluster
      this.style(capRgb, 0.48, 0.05, 0, MAT.PLAIN);
      this.box(x, y1 - capH * 0.72, 0, r * 2.5, capH * 0.34, r * 2.5);
      this.style([0.82, 0.60, 0.16], 0.38, 0.45, 0, MAT.PLAIN);
      this.box(x, y1 - capH * 0.40, 0, r * 3.1, capH * 0.30, r * 3.1);
      this.style(capRgb, 0.48, 0.05, 0, MAT.PLAIN);
      this.box(x, y1 - capH * 0.14, 0, r * 3.6, capH * 0.28, r * 3.6);
    } else {
      this.style(capRgb, 0.55, 0, 0, MAT.PLAIN);
      this.tube([x, y1 - capH, 0], [x, y1, 0], r * 0.96, r * 1.32, sides, true);
    }
    return this;
  }

  /**
   * Multi-tiered carved Chinese dougong / niutui (斗拱 / 牛腿) timber eave bracket cluster.
   * Built in real 3D stepped bearing blocks & cantilevered arms for 5-15m macro inspection!
   */
  dougongBracket(x, y, z, sc = 1.0, {
    rotY = 0,
    woodRgb = [0.16, 0.055, 0.030],
    paintRgb = [0.12, 0.40, 0.34],
    goldRgb = [0.85, 0.62, 0.16],
    polychrome = false,
  } = {}) {
    this.push().translate(x, y, z).rotateY(rotY).scale(sc, sc, sc);
    // Base bearing block (栌斗) + stepped projecting bracket arms (华拱 / 牛腿)
    this.style(woodRgb, 0.50, 0.05, 0, MAT.TIMBER);
    this.box(0, -0.35, 0.08, 0.34, 0.24, 0.34);
    this.style(polychrome ? paintRgb : woodRgb, 0.48, 0.05, 0, MAT.TIMBER);
    this.box(0, -0.14, 0.22, 0.72, 0.18, 0.56);
    this.style(polychrome ? goldRgb : [woodRgb[0] * 1.35, woodRgb[1] * 1.25, woodRgb[2] * 1.1], 0.38, polychrome ? 0.55 : 0.08, 0, MAT.TIMBER);
    this.box(0, 0.05, 0.36, 0.96, 0.18, 0.78);
    // End bearing cap blocks (散斗) & diagonal carved scroll strut
    for (const sx of [-0.36, 0, 0.36]) this.box(sx, 0.20, 0.46, 0.18, 0.14, 0.20);
    this.style(woodRgb, 0.52, 0.04, 0, MAT.TIMBER);
    this.tube([0, -0.78, 0.02], [0, 0.04, 0.66], 0.09, 0.07, 5, true);
    return this.pop();
  }

  /** Authentic Chongqing residential stainless-steel protruding window security cage (防盗网). */
  securityCage(cx, cy, cz, w = 2.4, h = 1.6, depth = 0.55, rotY = 0) {
    this.push().translate(cx, cy, cz).rotateY(rotY);
    this.style([0.70, 0.73, 0.76], 0.28, 0.85, 0, MAT.PLAIN);
    // Outer frame rails
    for (const sy of [-h / 2, h / 2]) {
      this.box(0, sy, depth, w, 0.045, 0.045);
      for (const sx of [-w / 2, w / 2]) this.box(sx, sy, depth / 2, 0.045, 0.045, depth);
    }
    // Vertical security bars across front & sides
    const nBars = Math.max(4, Math.round(w / 0.24));
    for (let k = 0; k <= nBars; k++) {
      const bx = -w / 2 + w * (k / nBars);
      this.box(bx, 0, depth, 0.028, h, 0.028);
    }
    // Horizontal cross-bar + bottom shelf slats
    this.box(0, 0, depth, w, 0.032, 0.032);
    for (const sx of [-w / 2, w / 2]) this.box(sx, 0, depth * 0.55, 0.028, h, 0.028);
    return this.pop();
  }

  /** Authentic lived-in Chongqing balcony clutter: drying pole with muted laundry & potted balcony plant. */
  balconyClutter(cx, cy, cz, w = 3.2, rotY = 0, seed = 1) {
    this.push().translate(cx, cy, cz).rotateY(rotY);
    const h1 = Math.abs(Math.sin(seed * 12.7));
    const h2 = Math.abs(Math.cos(seed * 27.3));
    // Terracotta planter pot + lush balcony shrub
    const px = (h1 > 0.5 ? 1 : -1) * (w * 0.32);
    this.style([0.48, 0.22, 0.14], 0.78, 0, 0, MAT.PLAIN);
    this.tube([px, 0, 0.2], [px, 0.42, 0.2], 0.16, 0.22, 7, true);
    this.style([0.12, 0.30, 0.11], 0.84, 0, 0, MAT.FOLIAGE);
    this.sphere(px, 0.62, 0.2, 0.34, 7, 5);
    // Bamboo/metal drying pole & 2–3 muted fabric laundry pieces
    if (h2 > 0.32) {
      this.style([0.62, 0.64, 0.66], 0.35, 0.75, 0, MAT.PLAIN);
      this.tube([-w * 0.38, 1.58, 0.42], [w * 0.38, 1.58, 0.42], 0.024, 0.024, 5, false);
      const fabrics = [[0.68, 0.66, 0.62], [0.24, 0.34, 0.48], [0.58, 0.26, 0.22], [0.64, 0.58, 0.42]];
      for (let k = 0; k < 2; k++) {
        const fx = -w * 0.18 + k * w * 0.34 + (h1 - 0.5) * 0.25;
        const fc = fabrics[(Math.floor(seed * 7) + k) % fabrics.length];
        this.style(fc, 0.88, 0, 0, MAT.PLAIN);
        this.box(fx, 1.18, 0.42, 0.52, 0.74, 0.05);
      }
    }
    return this.pop();
  }

  /** Vertical exterior PVC / galvanized facade rainwater drainpipe (落水管) with wall clamps & elbow. */
  drainpipe(x, y0, y1, z, r = 0.075, rgb = [0.62, 0.64, 0.66]) {
    this.style(rgb, 0.46, 0.22, 0, MAT.PLAIN);
    this.tube([x, y0 + 0.25, z], [x, y1, z], r, r, 6, true);
    this.tube([x, y0 + 0.25, z], [x, y0 + 0.08, z + 0.22], r, r * 0.95, 6, true);
    this.style([0.24, 0.25, 0.27], 0.42, 0.70, 0, MAT.PLAIN);
    for (let y = y0 + 1.8; y < y1 - 0.8; y += 3.6) {
      this.box(x, y, z - r * 0.4, r * 2.5, 0.12, r * 2.6);
    }
    return this;
  }

  /** Build the Three.js BufferGeometry for this HeroKit. */
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(this.m), 4));
    g.setAttribute('aTex', new THREE.BufferAttribute(new Float32Array(this.t), 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.i), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function centersOrMid(rings, s) {
  const r = rings[s];
  let x = 0, y = 0, z = 0;
  for (const p of r) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / r.length, y / r.length, z / r.length];
}

// Backwards-compatible alias so any helper importing { Kit } gets HeroKit seamlessly.
export { HeroKit as Kit };

/** Pre-build the shared material set passed in `ctx.materials` to every hero builder.
 *  Binds real 1024px PBR texture arrays (matlib.uniforms) AND furnished room parallax atlas (tInteriors)! */
export function createHeroMaterials(env, matlib = null) {
  return {
    heroMat: heroMaterial(env, { matlib, flood: [0.05, 0.04, 0.025] }),
    heroMatNoFlood: heroMaterial(env, { matlib, flood: [0, 0, 0] }),
    heroMatDouble: heroMaterial(env, { matlib, side: THREE.DoubleSide, flood: [0.035, 0.03, 0.02] }),
    heroMovingMat: heroMaterial(env, { matlib, moving: true, flood: [0.04, 0.035, 0.025] }),
    heroInstancedMat: heroMaterial(env, { matlib, instanced: true, instanceColor: true, flood: [0.03, 0.025, 0.015] }),
    depthMat: depthMaterial(),
    depthDoubleMat: depthMaterial({ side: THREE.DoubleSide }),
    depthInstancedMat: depthMaterial({ instanced: true }),
  };
}
