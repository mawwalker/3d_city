// Shared GLSL chunks (GLSL ES 3.00). Every world material is a RawShaderMaterial writing the G-buffer;
// lighting, atmosphere and post passes read it back with the decode helpers below.
//
// G-buffer layout
//   RT0 RGBA8            rgb = albedo (sqrt encoded), a = micro shadow (analytic sun visibility inside facade relief)
//   RT1 RGBA8            rgb = world normal, octahedral 2 x 12 bit, a = perceptual roughness
//   RT2 RGBA8            r = metalness, g = ambient occlusion, b = reflectance (F0 = 0.16 b^2), a = shading model / 255
//   RT3 R11F_G11F_B10F   emissive radiance
//   depth  DEPTH32F, reversed when EXT_clip_control is available

export const PRECISION = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
precision highp sampler3D;
`;

// shading model ids (RT2.a * 255)
export const SM = { DEFAULT: 0, FOLIAGE: 1, WATER: 2, GLASS: 3, UNLIT: 4, MOVING: 128 };

export const FS_VERT = /* glsl */`${PRECISION}
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const NOISE = /* glsl */`
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2  hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3  hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3  hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s;
}
float fbm2(vec2 p) { return 0.6 * vnoise(p) + 0.4 * vnoise(p * 2.31 + 7.3); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float ignT(vec2 p, float frame) { return ign(p + 5.588238 * mod(frame, 64.0)); }
`;

export const GBUFFER_ENCODE = /* glsl */`
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gMaterial;
layout(location = 3) out vec4 gEmissive;
vec2 octWrap(vec2 v) { return (1.0 - abs(v.yx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0); }
vec2 octEncode(vec3 n) { n /= (abs(n.x) + abs(n.y) + abs(n.z)); n.xy = n.z >= 0.0 ? n.xy : octWrap(n.xy); return n.xy * 0.5 + 0.5; }
vec3 pack2x12(vec2 v) {
  vec2 u = floor(clamp(v, 0.0, 1.0) * 4095.0 + 0.5);
  float t = floor(u.y / 256.0);
  return vec3(floor(u.x / 16.0), fract(u.x / 16.0) * 256.0 + t, u.y - t * 256.0) / 255.0;
}
struct Surface {
  vec3 albedo;
  vec3 normal;
  float roughness;
  float metalness;
  float ao;
  float reflectance;
  float model;
  vec3 emissive;
  float microShadow;
};
Surface defaultSurface() {
  return Surface(vec3(0.5), vec3(0.0, 1.0, 0.0), 0.8, 0.0, 1.0, 0.5, 0.0, vec3(0.0), 1.0);
}
void writeGBuffer(Surface s) {
  gAlbedo = vec4(sqrt(clamp(s.albedo, 0.0, 1.0)), clamp(s.microShadow, 0.0, 1.0));
  gNormal = vec4(pack2x12(octEncode(normalize(s.normal))), clamp(s.roughness, 0.03, 1.0));
  gMaterial = vec4(clamp(s.metalness, 0.0, 1.0), clamp(s.ao, 0.0, 1.0), clamp(s.reflectance, 0.0, 1.0), s.model / 255.0);
  gEmissive = vec4(max(s.emissive, 0.0), 1.0);
}
void writeDecal(vec3 albedo, float alpha) {
  gAlbedo = vec4(sqrt(clamp(albedo, 0.0, 1.0)), alpha);
  gNormal = vec4(0.0); gMaterial = vec4(0.0); gEmissive = vec4(0.0);
}
`;

export const GBUFFER_DECODE = /* glsl */`
uniform sampler2D tAlbedo, tNormal, tMaterial, tEmissive, tDepth;
uniform vec4 uProj;        // P[0][0], P[1][1], P[2][2] (e10), P[3][2] (e14)
uniform vec4 uProjOff;     // P[2][0], P[2][1] (jitter / off-centre), ndc scale, ndc bias
vec2 unpack2x12(vec3 p) {
  vec3 u = floor(p * 255.0 + 0.5);
  float t = floor(u.y / 16.0);
  return vec2(u.x * 16.0 + t, (u.y - t * 16.0) * 256.0 + u.z) / 4095.0;
}
vec3 octDecode(vec2 f) {
  f = f * 2.0 - 1.0;
  vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  float t = clamp(-n.z, 0.0, 1.0);
  n.x += n.x >= 0.0 ? -t : t; n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}
float linearZ(float depth) { return uProj.w / (depth * uProjOff.z + uProjOff.w + uProj.z); }
bool isSky(float depth) { return uProjOff.z > 1.5 ? depth >= 1.0 : depth <= 0.0; }
vec3 viewPosAt(vec2 uv, float depth) {
  float z = linearZ(depth);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3((ndc + uProjOff.xy) * z / uProj.xy, -z);
}
vec3 viewRay(vec2 uv) { vec2 ndc = uv * 2.0 - 1.0; return vec3((ndc + uProjOff.xy) / uProj.xy, -1.0); }
`;

export const BRDF = /* glsl */`
#ifndef PI
#define PI 3.14159265359
#endif
float D_GGX(float NoH, float a) { float a2 = a * a; float d = (NoH * a2 - NoH) * NoH + 1.0; return a2 / (PI * d * d + 1e-7); }
float V_SmithGGXCorrelatedFast(float NoV, float NoL, float a) { return 0.5 / mix(2.0 * NoL * NoV, NoL + NoV, a); }
vec3 F_Schlick(vec3 f0, float VoH) { float f = pow(1.0 - VoH, 5.0); return f0 + (1.0 - f0) * f; }
vec3 envBRDF(vec3 f0, float roughness, float NoV) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
  return f0 * AB.x + AB.y;
}
`;

export const TONEMAP = /* glsl */`
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
  const mat3 AgXInsetMatrix = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 AgXOutsetMatrix = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = clamp(log2(color), AgxMinEv, AgxMaxEv);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = agxDefaultContrastApprox(color);
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(color, vec3(1.07));
  color = luma + 1.18 * (color - luma);
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  return clamp(color, 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
