// Shared GLSL chunks. Every world material is a RawShaderMaterial (GLSL ES 3.00) assembled from these.

export const PRECISION = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;
`;

// Uniforms every world shader may use; the JS side shares one object per uniform (see environment.js).
export const ENV_UNIFORMS = /* glsl */`
uniform vec3  uSunDir;        // unit vector towards the main light (sun, or moon at night)
uniform vec3  uSunColor;      // linear radiance of the main light
uniform vec3  uSkyZenith;     // sky colour overhead
uniform vec3  uSkyHorizon;    // sky colour at the horizon away from the sun
uniform vec3  uSunGlow;       // horizon colour towards the sun
uniform vec3  uAmbSky;        // hemispheric ambient from above
uniform vec3  uAmbGround;     // hemispheric ambient from below (bounce)
uniform vec4  uFog;           // density at ground, 1/scale height, max opacity, sun-glow sharpness
uniform vec4  uTimeNight;     // x: time (s), y: night factor 0..1, z: city-lights factor 0..1, w: twilight factor
uniform vec4  uCloud;         // x: cloud shadow strength, y: scale (1/m), z,w: wind offset (m)
uniform mat4  uShadowMatrix;  // world -> shadow clip (0..1)
uniform vec4  uShadowParams;  // x: 1/size, y: strength (0 = off), z: world size of one texel, w: bias
uniform sampler2DShadow uShadowMap;
uniform sampler2D uAoMap;     // baked building occupancy (blurred)
uniform vec4  uAoRect;        // x0, z0, 1/w, 1/h in world metres
uniform float uSeason;        // 0 = midsummer green .. 1 = deep autumn
uniform float uSnow;          // 0..1 fresh snow cover
`;

export const NOISE = /* glsl */`
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2  hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3  hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s;
}
float fbm2(vec2 p) { return 0.6 * vnoise(p) + 0.4 * vnoise(p * 2.31 + 7.3); }
`;

// Atmosphere: one function gives the horizon colour for a view direction; sky and fog both use it, so distant geometry melts into the sky.
export const ATMOSPHERE = /* glsl */`
vec3 horizonColor(vec3 dir) {
  vec2 dh = normalize(dir.xz + vec2(1e-6));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-6));
  float toSun = max(dot(dh, sh), 0.0);
  float g = pow(toSun, uFog.w) * clamp(1.0 - abs(uSunDir.y) * 1.6, 0.0, 1.0);
  return mix(uSkyHorizon, uSunGlow, g);
}
vec3 skyColor(vec3 dir) {
  float y = max(dir.y, 0.0);
  vec3 hz = horizonColor(dir);
  float t = pow(1.0 - y, 4.0);
  vec3 col = mix(uSkyZenith, hz, t);
  // broad forward-scattering halo around the sun
  float s = max(dot(dir, uSunDir), 0.0);
  col += uSunGlow * (pow(s, 24.0) * 0.30 + pow(s, 220.0) * 0.40) * (1.0 - uTimeNight.y);
  return col;
}
// Exponential height fog, integrated analytically along the view ray.
float fogFactor(vec3 worldPos, vec3 camPos) {
  vec3 v = worldPos - camPos;
  float d = length(v);
  float b = uFog.y;
  float dy = v.y;
  float k = abs(dy) < 1.0 ? d : d * (1.0 - exp(-dy * b)) / (dy * b);
  float amount = uFog.x * exp(-max(camPos.y, 0.0) * b) * k;
  return clamp(1.0 - exp(-amount), 0.0, uFog.z);
}
vec3 applyFog(vec3 col, vec3 worldPos, vec3 camPos) {
  float f = fogFactor(worldPos, camPos);
  vec3 dir = normalize(worldPos - camPos);
  vec3 fc = horizonColor(dir);
  // a touch of zenith colour for rays looking steeply down (aerial perspective rather than haze wall)
  fc = mix(fc, mix(uSkyHorizon, uSkyZenith, 0.35), clamp(-dir.y * 1.3, 0.0, 0.6));
  return mix(col, fc, f);
}
`;

export const SHADOWS = /* glsl */`
float cloudShadow(vec3 wp) {
  if (uCloud.x <= 0.0) return 1.0;
  vec2 p = (wp.xz + uCloud.zw) * uCloud.y;
  float c = fbm(p) * 0.65 + vnoise(p * 0.37 + 3.1) * 0.5;
  return 1.0 - uCloud.x * smoothstep(0.52, 0.80, c);
}
float sunShadow(vec3 wp, vec3 n) {
  if (uShadowParams.y <= 0.0) return 1.0;
  float ndl = max(dot(n, uSunDir), 0.0);
  // normal offset keeps acne away on grazing faces; scaled by the world size of a shadow texel
  vec3 p = wp + n * uShadowParams.z * (1.5 + 2.5 * (1.0 - ndl));
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  vec3 s = sc.xyz / sc.w;
  if (s.x <= 0.002 || s.x >= 0.998 || s.y <= 0.002 || s.y >= 0.998 || s.z >= 1.0) return 1.0;
  float bias = uShadowParams.w;
  float t = uShadowParams.x;
  float a = hash12(gl_FragCoord.xy) * 6.2831853;
  vec2 r = vec2(cos(a), sin(a)) * t;
  vec2 q = vec2(-r.y, r.x);
  float sum = 0.0;
  sum += texture(uShadowMap, vec3(s.xy + r * 0.45 + q * 0.2, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy - r * 0.9 + q * 0.6, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + r * 0.3 - q * 1.2, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy - r * 1.4 - q * 0.5, s.z - bias));
  sum += texture(uShadowMap, vec3(s.xy + r * 1.5 + q * 1.1, s.z - bias));
  float sh = sum / 5.0;
  // fade out towards the edge of the shadow map
  vec2 e = min(s.xy, 1.0 - s.xy);
  float edge = smoothstep(0.0, 0.05, min(e.x, e.y));
  return mix(1.0, sh, uShadowParams.y * edge);
}
float groundAO(vec3 wp) {
  vec2 uv = (wp.xz - uAoRect.xy) * uAoRect.zw;
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return 0.0;
  return texture(uAoMap, uv).r;
}
`;

export const LIGHTING = /* glsl */`
vec3 hemiAmbient(vec3 n) {
  float k = n.y * 0.5 + 0.5;
  vec3 a = mix(uAmbGround, uAmbSky, k);
  // the sky is brighter and warmer towards the sun: upright faces turned that way pick it up even in shadow
  vec2 sh = normalize(uSunDir.xz + vec2(1e-6));
  float toward = dot(n.xz, sh);
  float upright = 1.0 - abs(n.y);
  a += uSunGlow * (0.06 * max(toward, 0.0) * upright);
  a *= 1.0 - 0.14 * max(-toward, 0.0) * upright;
  return a;
}
// Diffuse sun + sky for an opaque surface. A slight wrap softens the terminator (model-like).
vec3 shade(vec3 albedo, vec3 n, float shadow, float ao) {
  float ndl = dot(n, uSunDir);
  float lam = clamp((ndl + 0.08) / 1.08, 0.0, 1.0);
  vec3 direct = uSunColor * lam * shadow;
  vec3 amb = hemiAmbient(n) * ao;
  return albedo * (direct + amb);
}
// Fresh snow settles on anything that faces the sky.
vec3 snowOn(vec3 albedo, vec3 n, vec3 wp, float amount) {
  if (uSnow <= 0.0) return albedo;
  float cover = smoothstep(0.28, 0.72, n.y) * amount * uSnow;
  cover *= 0.82 + 0.18 * fbm2(wp.xz * 0.19);
  return mix(albedo, vec3(0.60, 0.63, 0.68), clamp(cover, 0.0, 1.0));
}
// Broad grazing-angle sheen: looking towards a low sun, roofs and pavements glow.
vec3 sunSheen(vec3 n, vec3 V, float shadow, float amount) {
  vec3 Hh = normalize(uSunDir + V);
  float nh = max(dot(n, Hh), 0.0);
  float f = pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
  return uSunColor * ((pow(nh, 26.0) * 0.8 + pow(nh, 90.0) * 1.6) * (0.03 + 0.97 * f) * amount * shadow * max(dot(n, uSunDir), 0.0) * 3.0);
}
`;

export const TONEMAP = /* glsl */`
// AgX (Troy Sobotka), fitted version used by Blender / three.js, with a punchy look transform.
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
  // look: slightly more contrast + saturation ("punchy")
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(color, vec3(1.12));
  color = luma + 1.22 * (color - luma);
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  return clamp(color, 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;
