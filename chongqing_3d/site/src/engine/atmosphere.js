// Physically based sky after Hillaire (EGSR 2020) tuned for Chongqing's mountain basin & dramatic golden/cyber-night skies.
import * as THREE from 'three';
import { PRECISION, FS_VERT, NOISE } from './glsl.js';

export const ATMO_COMMON = /* glsl */`
#ifndef PI
#define PI 3.14159265359
#endif
const float groundRadiusMM = 6.360;
const float atmosphereRadiusMM = 6.460;
const vec3 rayleighScatteringBase = vec3(5.802, 13.558, 33.1);
const float mieScatteringBase = 3.996;
const float mieAbsorptionBase = 4.4;
const vec3 ozoneAbsorptionBase = vec3(0.650, 1.881, 0.085);
uniform vec4 uAtmo;          // x: haze (Mie) multiplier, y: Mie scale height (km), z: Mie anisotropy g, w: ground albedo
float getMiePhase(float cosTheta) {
  float g = uAtmo.z;
  float num = (1.0 - g * g) * (1.0 + cosTheta * cosTheta);
  float denom = (2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 1e-4), 1.5);
  return (3.0 / (8.0 * PI)) * num / denom;
}
float getRayleighPhase(float cosTheta) { return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta); }
void getScatteringValues(vec3 pos, out vec3 rayleighScattering, out float mieScattering, out vec3 extinction) {
  float altitudeKM = (length(pos) - groundRadiusMM) * 1000.0;
  float rayleighDensity = exp(-altitudeKM / 8.0);
  float mieDensity = exp(-altitudeKM / uAtmo.y) * uAtmo.x;
  rayleighScattering = rayleighScatteringBase * rayleighDensity;
  mieScattering = mieScatteringBase * mieDensity;
  float mieAbsorption = mieAbsorptionBase * mieDensity;
  vec3 ozoneAbsorption = ozoneAbsorptionBase * max(0.0, 1.0 - abs(altitudeKM - 25.0) / 15.0);
  extinction = rayleighScattering + mieScattering + mieAbsorption + ozoneAbsorption;
}
float safeacos(float x) { return acos(clamp(x, -1.0, 1.0)); }
float rayIntersectSphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  if (c > 0.0 && b > 0.0) return -1.0;
  float discr = b * b - c;
  if (discr < 0.0) return -1.0;
  if (discr > b * b) return -b + sqrt(discr);
  return -b - sqrt(discr);
}
vec2 lutUV(vec3 pos, vec3 sunDir) {
  float height = length(pos);
  float sunCos = dot(sunDir, pos / height);
  return vec2(clamp(0.5 + 0.5 * sunCos, 0.0, 1.0), clamp((height - groundRadiusMM) / (atmosphereRadiusMM - groundRadiusMM), 0.0, 1.0));
}
`;

const TRANSMITTANCE_FRAG = /* glsl */`${PRECISION}
${ATMO_COMMON}
in vec2 vUv; out vec4 fragColor;
void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float sunTheta = safeacos(sunCosTheta);
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCosTheta, -sin(sunTheta)));
  vec3 transmittance = vec3(1.0);
  if (rayIntersectSphere(pos, sunDir, groundRadiusMM) > 0.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float atmoDist = rayIntersectSphere(pos, sunDir, atmosphereRadiusMM);
  float t = 0.0;
  for (float i = 0.0; i < 40.0; i += 1.0) {
    float newT = ((i + 0.3) / 40.0) * atmoDist;
    float dt = newT - t; t = newT;
    vec3 rs, ext; float ms;
    getScatteringValues(pos + t * sunDir, rs, ms, ext);
    transmittance *= exp(-dt * ext);
  }
  fragColor = vec4(transmittance, 1.0);
}`;

const MULTISCATTER_FRAG = /* glsl */`${PRECISION}
${ATMO_COMMON}
uniform sampler2D tTransmittance;
in vec2 vUv; out vec4 fragColor;
vec3 getSphericalDir(float theta, float phi) {
  float cosPhi = cos(phi), sinPhi = sin(phi);
  return vec3(sinPhi * sin(theta), cosPhi, sinPhi * cos(theta));
}
void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float sunTheta = safeacos(sunCosTheta);
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCosTheta, -sin(sunTheta)));
  vec3 lumTotal = vec3(0.0), fms = vec3(0.0);
  const int N = 8;
  float invSamples = 1.0 / float(N * N);
  for (int i = 0; i < N; i++) for (int j = 0; j < N; j++) {
    float theta = PI * (float(i) + 0.5) / float(N);
    float phi = safeacos(1.0 - 2.0 * (float(j) + 0.5) / float(N));
    vec3 rayDir = getSphericalDir(theta, phi);
    float atmoDist = rayIntersectSphere(pos, rayDir, atmosphereRadiusMM);
    float groundDist = rayIntersectSphere(pos, rayDir, groundRadiusMM);
    float tMax = groundDist > 0.0 ? groundDist : atmoDist;
    float cosTheta = dot(rayDir, sunDir);
    float miePhaseValue = getMiePhase(cosTheta);
    float rayleighPhaseValue = getRayleighPhase(-cosTheta);
    vec3 lum = vec3(0.0), lumFactor = vec3(0.0), transmittance = vec3(1.0);
    float t = 0.0;
    for (float s = 0.0; s < 20.0; s += 1.0) {
      float newT = ((s + 0.3) / 20.0) * tMax;
      float dt = newT - t; t = newT;
      vec3 newPos = pos + t * rayDir;
      vec3 rs, ext; float ms;
      getScatteringValues(newPos, rs, ms, ext);
      vec3 sampleT = exp(-dt * ext);
      vec3 scatteringNoPhase = rs + ms;
      lumFactor += transmittance * (scatteringNoPhase - scatteringNoPhase * sampleT) / ext;
      vec3 sunT = texture(tTransmittance, lutUV(newPos, sunDir)).rgb;
      vec3 inScattering = (rs * rayleighPhaseValue + ms * miePhaseValue) * sunT;
      lum += (inScattering - inScattering * sampleT) / ext * transmittance;
      transmittance *= sampleT;
    }
    if (groundDist > 0.0) {
      vec3 hitPos = normalize(pos + groundDist * rayDir) * groundRadiusMM;
      if (dot(pos, sunDir) > 0.0) lum += transmittance * uAtmo.w * texture(tTransmittance, lutUV(hitPos, sunDir)).rgb;
    }
    fms += lumFactor * invSamples;
    lumTotal += lum * invSamples;
  }
  fragColor = vec4(lumTotal / (1.0 - fms), 1.0);
}`;

export const SKY_LOOKUP = /* glsl */`
uniform sampler2D tSkyView, tTransmittance, tMultiScatter;
uniform vec3 uSunDirTrue;
uniform vec4 uSkyParams;     // x: camera height above ground (Mm), y: sun radiance scale, z: night factor, w: time (s)
vec3 skyViewLookup(vec3 rayDir) {
  float height = groundRadiusMM + uSkyParams.x;
  vec3 up = vec3(0.0, 1.0, 0.0);
  float horizonAngle = safeacos(sqrt(height * height - groundRadiusMM * groundRadiusMM) / height);
  float altitudeAngle = horizonAngle - acos(clamp(rayDir.y, -1.0, 1.0));
  float azimuthAngle = 0.0;
  if (abs(altitudeAngle) <= 0.5 * PI - 1e-4) {
    vec3 right = cross(uSunDirTrue, up);
    float rl = length(right);
    right = rl > 1e-5 ? right / rl : vec3(1.0, 0.0, 0.0);
    vec3 forward = cross(up, right);
    vec3 projectedDir = normalize(rayDir - up * rayDir.y + vec3(1e-7, 0.0, 0.0));
    azimuthAngle = atan(dot(projectedDir, right), dot(projectedDir, forward)) + PI;
  }
  float v = 0.5 + 0.5 * sign(altitudeAngle) * sqrt(abs(altitudeAngle) * 2.0 / PI);
  return texture(tSkyView, vec2(azimuthAngle / (2.0 * PI), v)).rgb;
}
`;

const SKYVIEW_FRAG = /* glsl */`${PRECISION}
${ATMO_COMMON}
uniform sampler2D tTransmittance, tMultiScatter;
uniform vec3 uSunDirTrue;
uniform vec4 uSkyParams;
in vec2 vUv; out vec4 fragColor;
void main() {
  float azimuthAngle = (vUv.x - 0.5) * 2.0 * PI;
  float adjV;
  if (vUv.y < 0.5) { float c = 1.0 - 2.0 * vUv.y; adjV = -c * c; } else { float c = vUv.y * 2.0 - 1.0; adjV = c * c; }
  float height = groundRadiusMM + uSkyParams.x;
  vec3 viewPos = vec3(0.0, height, 0.0);
  float horizonAngle = safeacos(sqrt(height * height - groundRadiusMM * groundRadiusMM) / height) - 0.5 * PI;
  float altitudeAngle = adjV * 0.5 * PI - horizonAngle;
  float cosAltitude = cos(altitudeAngle);
  vec3 rayDir = vec3(cosAltitude * sin(azimuthAngle), sin(altitudeAngle), -cosAltitude * cos(azimuthAngle));
  float sunAltitude = 0.5 * PI - acos(clamp(uSunDirTrue.y, -1.0, 1.0));
  vec3 sunDir = vec3(0.0, sin(sunAltitude), -cos(sunAltitude));
  float atmoDist = rayIntersectSphere(viewPos, rayDir, atmosphereRadiusMM);
  float groundDist = rayIntersectSphere(viewPos, rayDir, groundRadiusMM);
  float tMax = groundDist < 0.0 ? atmoDist : groundDist;
  float cosTheta = dot(rayDir, sunDir);
  float miePhaseValue = getMiePhase(cosTheta);
  float rayleighPhaseValue = getRayleighPhase(-cosTheta);
  vec3 lum = vec3(0.0), transmittance = vec3(1.0);
  float t = 0.0;
  const float STEPS = 32.0;
  for (float i = 0.0; i < STEPS; i += 1.0) {
    float f = (i + 0.3) / STEPS;
    float newT = f * f * tMax;
    float dt = newT - t; t = newT;
    vec3 newPos = viewPos + t * rayDir;
    vec3 rs, ext; float ms;
    getScatteringValues(newPos, rs, ms, ext);
    vec3 sampleT = exp(-dt * ext);
    vec2 uv = lutUV(newPos, sunDir);
    vec3 sunT = texture(tTransmittance, uv).rgb;
    vec3 psiMS = texture(tMultiScatter, uv).rgb;
    vec3 inScattering = rs * (rayleighPhaseValue * sunT + psiMS) + ms * (miePhaseValue * sunT + psiMS);
    lum += (inScattering - inScattering * sampleT) / ext * transmittance;
    transmittance *= sampleT;
  }
  fragColor = vec4(lum, 1.0);
}`;

export const CLOUDS = /* glsl */`
uniform vec4 uCloud;         // x: coverage 0..1, y: layer altitude (m), z, w: wind offset (m)
uniform vec4 uCloud2;        // x: density, y: shadow strength, z: cirrus amount, w: valley mist amount
float cloudDensityAt(vec2 p) {
  vec2 q = p * 0.00016;
  float base = fbm(q + vec2(0.0, 3.7));
  float detail = fbm(q * 3.1 + vec2(11.3, 5.1));
  float d = base * 0.78 + detail * 0.30;
  float cov = 1.0 - uCloud.x;
  return smoothstep(cov * 0.62 + 0.14, cov * 0.62 + 0.38, d) * uCloud2.x;
}
vec4 cloudLayer(vec3 dir, float camY, vec3 sunDir, vec3 sunColor, vec3 ambient) {
  if (uCloud.x <= 0.001) return vec4(0.0);
  float h = uCloud.y - camY;
  if (dir.y * h <= 1e-4) return vec4(0.0);
  float R = 6360000.0 + camY;
  float Rc = 6360000.0 + uCloud.y;
  float b = R * dir.y;
  float disc = b * b - R * R + Rc * Rc;
  if (disc < 0.0) return vec4(0.0);
  float t = h > 0.0 ? -b + sqrt(disc) : -b - sqrt(disc);
  if (t <= 0.0) return vec4(0.0);
  vec2 p = dir.xz * t + uCloud.zw;
  float d = cloudDensityAt(p);
  if (d <= 0.001) return vec4(0.0);
  vec2 sp = p + normalize(sunDir.xz + vec2(1e-5)) * 420.0;
  float ds = cloudDensityAt(sp);
  float lit = exp(-ds * 1.9) * 0.82 + 0.18;
  float cosT = dot(dir, sunDir);
  float fwd = pow(max(cosT, 0.0), 6.0);
  float silver = pow(max(cosT, 0.0), 40.0) * (1.0 - d) * 2.2;
  vec3 col = sunColor * (0.085 * lit + 0.11 * fwd * lit + silver * 0.12) + ambient * (0.75 - 0.3 * min(d, 1.0));
  float alpha = 1.0 - exp(-d * 2.6);
  alpha *= smoothstep(0.0, 0.07, abs(dir.y));
  return vec4(col * alpha, alpha);
}
float cloudShadowAt(vec3 wp, vec3 sunDir) {
  if (uCloud2.y <= 0.0 || uCloud.x <= 0.001) return 1.0;
  float t = (uCloud.y - wp.y) / max(sunDir.y, 0.08);
  vec2 p = wp.xz + sunDir.xz * t + uCloud.zw;
  return 1.0 - uCloud2.y * (1.0 - exp(-cloudDensityAt(p) * 2.2));
}
`;

export const SKY_COLOR = /* glsl */`
uniform vec3 uSunRadiance;
uniform vec3 uMoonDir;
uniform vec3 uNightSky;
uniform vec3 uSkyAmbient;
vec3 skyRadiance(vec3 dir, float camY, bool withSun) {
  vec3 d = normalize(dir);
  vec3 col = skyViewLookup(d) * uSkyParams.y;
  float night = uSkyParams.z;
  // Deep midnight indigo-navy dome + warm Chongqing urban horizon glow hugging only the lower horizon
  float hz = exp(-max(d.y, 0.0) * 3.4);
  col += uNightSky * (0.26 + 0.92 * hz);
  if (night > 0.01) {
    float cityHz = pow(1.0 - clamp(d.y, 0.0, 1.0), 7.5);
    col += vec3(0.024, 0.012, 0.007) * cityHz * night;
  }
  vec4 cl = cloudLayer(d, camY, uSunDirTrue.y > -0.05 ? uSunDirTrue : uMoonDir, uSunRadiance + uNightSky * 2.0, uSkyAmbient);
  float far = smoothstep(0.0, 0.16, d.y);
  cl *= mix(0.25, 1.0, far);
  if (night > 0.01 && d.y > 0.14) {
    // Sparse, natural stars with magnitude variation, faded near the light-polluted horizon and masked by clouds
    vec3 sd = d * 360.0;
    vec3 cell = floor(sd);
    vec3 h = hash33(cell);
    float mag = pow(h.y, 3.2);
    float star = smoothstep(0.9968, 1.0, h.x) * smoothstep(0.62, 0.08, length(fract(sd) - 0.5 - (h.yzx - 0.5) * 0.45) * 2.4);
    vec3 starCol = mix(vec3(0.80, 0.88, 1.0), vec3(1.0, 0.92, 0.76), h.z);
    col += starCol * star * (0.10 + 0.78 * mag) * night * smoothstep(0.14, 0.52, d.y) * (1.0 - cl.a);
    float m = dot(d, uMoonDir);
    float disc = smoothstep(0.99985, 0.99992, m);
    col += vec3(1.0, 0.98, 0.9) * (disc * 2.2 + pow(max(m, 0.0), 900.0) * 0.12) * night * (1.0 - cl.a * 0.85);
  }
  col = col * (1.0 - cl.a) + cl.rgb;
  if (withSun) {
    float s = dot(d, uSunDirTrue);
    float mu = sqrt(max(1.0 - (1.0 - s) / (1.0 - 0.999989), 0.0));
    float disc = step(0.999989, s) * (0.4 + 0.6 * mu);
    col += uSunRadiance * disc * 900.0 * (1.0 - cl.a);
  }
  return col;
}
`;

export const EQUIRECT = /* glsl */`
#ifndef PI
#define PI 3.14159265359
#endif
vec2 dirToEquirect(vec3 d) { return vec2(atan(d.x, -d.z) / (2.0 * PI) + 0.5, acos(clamp(-d.y, -1.0, 1.0)) / PI); }
vec3 equirectToDir(vec2 uv) {
  float az = (uv.x - 0.5) * 2.0 * PI, pol = uv.y * PI;
  return vec3(sin(pol) * sin(az), -cos(pol), -sin(pol) * cos(az));
}
`;

const ENV_BASE_FRAG = /* glsl */`${PRECISION}
${NOISE}
${ATMO_COMMON}
${SKY_LOOKUP}
${CLOUDS}
${SKY_COLOR}
${EQUIRECT}
uniform vec3 uGroundRadiance;
in vec2 vUv; out vec4 fragColor;
void main() {
  vec3 d = equirectToDir(vUv);
  vec3 sky = skyRadiance(vec3(d.x, max(d.y, 0.0), d.z), uSkyParams.x * 1e6, false);
  float g = smoothstep(0.02, -0.06, d.y);
  vec3 col = mix(sky, uGroundRadiance, g);
  fragColor = vec4(col, 1.0);
}`;

const IRRADIANCE_FRAG = /* glsl */`${PRECISION}
${NOISE}
${EQUIRECT}
uniform sampler2D tEnv;
in vec2 vUv; out vec4 fragColor;
void main() {
  vec3 n = equirectToDir(vUv);
  vec3 up = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(up, n)), ty = cross(n, tx);
  vec3 sum = vec3(0.0);
  const int N = 12, M = 6;
  for (int i = 0; i < N; i++) for (int j = 0; j < M; j++) {
    float u1 = (float(j) + 0.5) / float(M), u2 = (float(i) + 0.5) / float(N);
    float r = sqrt(u1), phi = u2 * 2.0 * PI;
    vec3 l = normalize(tx * (r * cos(phi)) + ty * (r * sin(phi)) + n * sqrt(1.0 - u1));
    sum += textureLod(tEnv, dirToEquirect(l), 0.0).rgb;
  }
  vec3 e = sum / float(N * M);
  float l = dot(e, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(mix(e, vec3(l), 0.42), 1.0);
}`;

const PREFILTER_FRAG = /* glsl */`${PRECISION}
${EQUIRECT}
uniform sampler2D tEnv;
uniform float uRoughness;
in vec2 vUv; out vec4 fragColor;
float radicalInverse(uint bits) {
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return float(bits) * 2.3283064365386963e-10;
}
void main() {
  vec3 n = equirectToDir(vUv);
  if (uRoughness < 0.02) { fragColor = vec4(textureLod(tEnv, vUv, 0.0).rgb, 1.0); return; }
  vec3 up = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(up, n)), ty = cross(n, tx);
  float a = uRoughness * uRoughness;
  vec3 sum = vec3(0.0); float wsum = 0.0;
  const uint N = 40u;
  for (uint i = 0u; i < N; i++) {
    vec2 xi = vec2(float(i) / float(N), radicalInverse(i));
    float phi = 2.0 * PI * xi.x;
    float cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    vec3 h = tx * (sinTheta * cos(phi)) + ty * (sinTheta * sin(phi)) + n * cosTheta;
    vec3 l = 2.0 * dot(n, h) * h - n;
    float nl = dot(n, l);
    if (nl > 0.0) { sum += textureLod(tEnv, dirToEquirect(l), 0.0).rgb * nl; wsum += nl; }
  }
  fragColor = vec4(sum / max(wsum, 1e-4), 1.0);
}`;

export const ENV_LEVELS = 5;
export const ENV_SAMPLE = /* glsl */`
uniform sampler2D tEnvSpec, tEnvIrr;
const float ENV_LEVELS = ${ENV_LEVELS}.0;
vec3 envSpecular(vec3 r, float roughness) {
  vec2 uv = dirToEquirect(r);
  float lv = clamp(roughness, 0.0, 1.0) * (ENV_LEVELS - 1.0);
  float l0 = floor(lv), f = lv - l0, l1 = min(l0 + 1.0, ENV_LEVELS - 1.0);
  float vv = clamp(uv.y, 0.5 / 64.0, 1.0 - 0.5 / 64.0);
  vec3 a = textureLod(tEnvSpec, vec2(uv.x, (l0 + vv) / ENV_LEVELS), 0.0).rgb;
  vec3 b = textureLod(tEnvSpec, vec2(uv.x, (l1 + vv) / ENV_LEVELS), 0.0).rgb;
  return mix(a, b, f);
}
vec3 envIrradiance(vec3 n) { return textureLod(tEnvIrr, dirToEquirect(n), 0.0).rgb; }
`;

function fsMaterial(frag, uniforms) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

function target(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.LinearSRGBColorSpace, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, ...opts });
}

export function sunTransmittance(heightKm, cosZenith, haze = 1, mieHeight = 1.2) {
  const R0 = 6360, R1 = 6460;
  const h = R0 + Math.max(heightKm, 0.001);
  const sinZ = Math.sqrt(Math.max(0, 1 - cosZenith * cosZenith));
  const b = h * cosZenith;
  const cG = h * h - R0 * R0;
  const discG = b * b - cG;
  if (discG >= 0 && -b - Math.sqrt(discG) > 0) return [0, 0, 0];
  const cA = h * h - R1 * R1;
  const dist = -b + Math.sqrt(Math.max(0, b * b - cA));
  const od = [0, 0, 0];
  let t = 0;
  for (let i = 0; i < 40; i++) {
    const nt = ((i + 0.3) / 40) * dist, dt = nt - t; t = nt;
    const x = sinZ * t, y = h + cosZenith * t;
    const alt = Math.sqrt(x * x + y * y) - R0;
    const ray = Math.exp(-alt / 8), mie = Math.exp(-alt / mieHeight) * haze;
    const oz = Math.max(0, 1 - Math.abs(alt - 25) / 15);
    od[0] += dt * (5.802 * ray + (3.996 + 4.4) * mie + 0.650 * oz);
    od[1] += dt * (13.558 * ray + (3.996 + 4.4) * mie + 1.881 * oz);
    od[2] += dt * (33.1 * ray + (3.996 + 4.4) * mie + 0.085 * oz);
  }
  return od.map((v) => Math.exp(-v * 1e-3));
}

export class Atmosphere {
  constructor(renderer) {
    this.renderer = renderer;
    this.transmittance = target(256, 64);
    this.multiScatter = target(32, 32);
    this.skyView = target(256, 144, { wrapS: THREE.RepeatWrapping });
    this.envBase = target(256, 128, { wrapS: THREE.RepeatWrapping });
    this.envSpec = target(128, 64 * ENV_LEVELS, { wrapS: THREE.RepeatWrapping });
    this.envIrr = target(32, 16, { wrapS: THREE.RepeatWrapping });
    this.uniforms = {
      uAtmo: { value: new THREE.Vector4(1, 1.2, 0.8, 0.3) },
      tTransmittance: { value: this.transmittance.texture },
      tMultiScatter: { value: this.multiScatter.texture },
      tSkyView: { value: this.skyView.texture },
      tEnvSpec: { value: this.envSpec.texture },
      tEnvIrr: { value: this.envIrr.texture },
      uSunDirTrue: { value: new THREE.Vector3(0, 1, 0) },
      uSkyParams: { value: new THREE.Vector4(0.0002, 20, 0, 0) },
      uSunRadiance: { value: new THREE.Vector3(1, 1, 1) },
      uMoonDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
      uNightSky: { value: new THREE.Vector3(0, 0, 0) },
      uSkyAmbient: { value: new THREE.Vector3(0.3, 0.4, 0.6) },
      uCloud: { value: new THREE.Vector4(0.35, 2800, 0, 0) },
      uCloud2: { value: new THREE.Vector4(1.0, 0.5, 0.3, 0.0) },
      uGroundRadiance: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
    };
    const u = this.uniforms;
    this.matT = fsMaterial(TRANSMITTANCE_FRAG, { uAtmo: u.uAtmo });
    this.matM = fsMaterial(MULTISCATTER_FRAG, { uAtmo: u.uAtmo, tTransmittance: u.tTransmittance });
    this.matS = fsMaterial(SKYVIEW_FRAG, { uAtmo: u.uAtmo, tTransmittance: u.tTransmittance, tMultiScatter: u.tMultiScatter, uSunDirTrue: u.uSunDirTrue, uSkyParams: u.uSkyParams });
    this.matEnv = fsMaterial(ENV_BASE_FRAG, { ...u });
    this.matIrr = fsMaterial(IRRADIANCE_FRAG, { tEnv: { value: this.envBase.texture } });
    this.matPre = fsMaterial(PREFILTER_FRAG, { tEnv: { value: this.envBase.texture }, uRoughness: { value: 0 } });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(tri, null); this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this._lutKey = ''; this._skyKey = ''; this._envKey = ''; this._envAge = 1e9;
  }

  invalidate() {
    this._lutKey = '';
    this._skyKey = '';
    this._envKey = '';
    this._envAge = 1e9;
  }

  _pass(mat, rt) {
    const r = this.renderer;
    this.mesh.material = mat;
    r.setRenderTarget(rt);
    r.render(this.scene, this.cam);
  }

  update(camHeightM, dt = 0.016) {
    const r = this.renderer, u = this.uniforms;
    const a = u.uAtmo.value;
    const lutKey = `${a.x.toFixed(3)}|${a.y.toFixed(3)}|${a.z.toFixed(3)}|${a.w.toFixed(3)}`;
    const vp = new THREE.Vector4(); r.getViewport(vp);
    const sc = r.getScissorTest();
    r.setScissorTest(false);
    if (lutKey !== this._lutKey) {
      this._lutKey = lutKey;
      this._pass(this.matT, this.transmittance);
      this._pass(this.matM, this.multiScatter);
      this._skyKey = '';
    }
    u.uSkyParams.value.x = Math.max(camHeightM, 2.0) * 1e-6;
    const s = u.uSunDirTrue.value;
    const skyKey = `${s.y.toFixed(5)}|${(camHeightM / 25).toFixed(0)}|${lutKey}`;
    if (skyKey !== this._skyKey) {
      this._skyKey = skyKey;
      this._pass(this.matS, this.skyView);
    }
    this._envAge += dt;
    const c = u.uCloud.value, sr = u.uSunRadiance.value, ns = u.uNightSky.value;
    const envKey = `${skyKey}|${s.x.toFixed(4)}|${c.x.toFixed(3)}|${sr.x.toFixed(3)}|${ns.x.toFixed(4)}|${u.uGroundRadiance.value.x.toFixed(3)}`;
    if (envKey !== this._envKey || this._envAge > 4) {
      this._envKey = envKey; this._envAge = 0;
      this._pass(this.matEnv, this.envBase);
      this._pass(this.matIrr, this.envIrr);
      const h = 64;
      r.setRenderTarget(this.envSpec);
      r.setScissorTest(true);
      for (let i = 0; i < ENV_LEVELS; i++) {
        this.matPre.uniforms.uRoughness.value = i / (ENV_LEVELS - 1);
        this.envSpec.viewport.set(0, i * h, 128, h);
        this.envSpec.scissor.set(0, i * h, 128, h);
        this.envSpec.scissorTest = true;
        this._pass(this.matPre, this.envSpec);
      }
      this.envSpec.scissorTest = false;
      r.setScissorTest(false);
    }
    r.setScissorTest(sc);
  }
}
