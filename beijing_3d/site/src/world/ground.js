// Ground: base plane, land-cover / land-use polygons, water, roads + rail (with animated traffic), and the
// baked building-occupancy maps (ground AO + "how urban is it here") that tie buildings to the ground.

import * as THREE from 'three';
import { fetchBin, fetchJSON } from './data.js';
import { PRECISION, ENV_UNIFORMS, NOISE, ATMOSPHERE, SHADOWS, LIGHTING } from '../engine/shaderlib.js';

const COMMON_FRAG = /* glsl */`${PRECISION}
${ENV_UNIFORMS}
uniform vec3 cameraPosition;
uniform sampler2D uUrbanMap;
${NOISE}
${ATMOSPHERE}
${SHADOWS}
${LIGHTING}
// warm paving of the built-up city vs. the patchwork of fields around it
vec3 pavedColor(vec2 p) {
  float n = fbm2(p / 130.0);
  vec3 c = vec3(0.380, 0.368, 0.350) * (0.93 + 0.14 * n);
  // up close the ground is cast in bays, patched and stained
  float px = max(fwidth(p.x), fwidth(p.y));
  float near = 1.0 - smoothstep(0.35, 1.6, px);
  if (near > 0.01) {
    vec2 bay = p / 4.5;
    vec2 g = abs(fract(bay) - 0.5);
    float joint = smoothstep(0.5 - 0.022 - px / 4.5, 0.5 - 0.004, max(g.x, g.y));
    float tone = hash12(floor(bay));
    float patchy = step(0.86, hash12(floor(p / 13.0) + 4.1)) * (0.5 + 0.5 * vnoise(p * 0.5));
    c *= 1.0 - near * (0.09 * joint + 0.05 * (tone - 0.5) + 0.07 * patchy);
    c *= 1.0 - 0.06 * near * (vnoise(p * 1.9) - 0.5);
  }
  return c;
}
vec3 carColor(float r) {
  if (r < 0.34) return vec3(0.80, 0.80, 0.79);
  if (r < 0.54) return vec3(0.045, 0.045, 0.05);
  if (r < 0.72) return vec3(0.40, 0.41, 0.42);
  if (r < 0.80) return vec3(0.42, 0.04, 0.035);
  if (r < 0.88) return vec3(0.06, 0.12, 0.33);
  if (r < 0.94) return vec3(0.60, 0.46, 0.08);
  return vec3(0.16, 0.26, 0.18);
}
vec3 fieldColor(vec2 p, float green) {
  // irregular plots: jittered cells, each with its own crop tone and furrow direction
  vec2 q = mat2(0.94, -0.34, 0.34, 0.94) * p / 240.0;
  q += (vec2(vnoise(q * 0.7), vnoise(q * 0.7 + 9.0)) - 0.5) * 0.9;
  vec2 id = floor(q);
  vec3 r = hash32(id);
  vec3 c = mix(vec3(0.30, 0.27, 0.17), vec3(0.20, 0.25, 0.11), r.x);
  c = mix(c, vec3(0.40, 0.34, 0.20), step(0.72, r.y) * 0.8);                // stubble / bare plots
  c = mix(c, vec3(0.16, 0.24, 0.10), green);
  float ang = r.z * 3.1416;
  float fur = dot(p, vec2(cos(ang), sin(ang))) / 5.0;
  float fw = fwidth(fur);
  c *= 0.95 + 0.07 * sin(fur * 6.2832) * (1.0 - smoothstep(0.15, 0.6, fw));
  vec2 f = abs(fract(q) - 0.5);
  c *= 0.90 + 0.10 * smoothstep(0.5, 0.44, max(f.x, f.y));
  return c * (0.9 + 0.2 * fbm2(p / 700.0));
}
float urbanAt(vec3 wp) {
  vec2 uv = (wp.xz - uAoRect.xy) * uAoRect.zw;
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return 0.0;
  return texture(uUrbanMap, uv).g;
}
vec3 finish(vec3 albedo, vec3 wp, vec3 n, float aoK) {
  float sh = sunShadow(wp, n) * cloudShadow(wp);
  float ao = 1.0 - aoK * groundAO(wp);
  vec3 col = shade(albedo, n, sh, ao);
  col += sunSheen(n, normalize(cameraPosition - wp), sh, 0.8) * albedo;
  return applyFog(col, wp, cameraPosition);
}
`;

// ------------------------------------------------------------------ base plane
const PLANE_VERT = /* glsl */`${PRECISION}
in vec3 position;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vWorld;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;

const PLANE_FRAG = /* glsl */`${COMMON_FRAG}
in vec3 vWorld;
out vec4 fragColor;
uniform float uDebug;
void main() {
  vec2 p = vWorld.xz;
  float urban = smoothstep(0.015, 0.14, urbanAt(vWorld));
  vec3 albedo = mix(fieldColor(p, 0.0), pavedColor(p), urban);
  albedo = snowOn(albedo, vec3(0.0, 1.0, 0.0), vWorld, mix(1.0, 0.86, urban));
  fragColor = vec4(finish(albedo, vWorld, vec3(0.0, 1.0, 0.0), 0.55), 1.0);
  if (uDebug > 0.5) fragColor = vec4(groundAO(vWorld), urbanAt(vWorld), 0.0, 1.0);
}`;

// ------------------------------------------------------------------ areas
const AREA_VERT = /* glsl */`${PRECISION}
in vec2 aXZ;
in float aCls;
uniform mat4 viewMatrix, projectionMatrix;
out vec3 vWorld;
flat out float vCls;
void main() { vWorld = vec3(aXZ.x, 0.0, aXZ.y); vCls = aCls; gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0); }`;

const AREA_FRAG = /* glsl */`${COMMON_FRAG}
in vec3 vWorld;
flat in float vCls;
out vec4 fragColor;
vec3 canopy(vec2 p, vec3 base, float density) {
  // tree crowns: soft cellular bumps, lit tops, dark gaps; a share turns gold / russet in autumn
  vec2 q = p / 7.5;
  vec2 id = floor(q); vec2 f = fract(q);
  float dmin = 1.0; vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(id + g);
    float d = length(g + o - f);
    if (d < dmin) { dmin = d; best = id + g; }
  }
  float fw = max(fwidth(q.x), fwidth(q.y));
  float lod = 1.0 - smoothstep(0.25, 1.1, fw);
  float r = hash12(best + 3.7);
  float crown = smoothstep(0.75, 0.15, dmin);
  vec3 c = base * (0.80 + 0.45 * r);
  float au = smoothstep(1.0 - 0.34 * uSeason, 1.0, hash12(best * 1.3 + 9.1) + 0.25 * fbm2(p / 260.0) - 0.12);
  vec3 gold = mix(vec3(0.62, 0.43, 0.07), vec3(0.50, 0.17, 0.05), step(0.7, r));
  c = mix(c, gold, au);
  c *= mix(1.0, 0.55 + 0.6 * crown, lod * density);
  return c;
}
void main() {
  int c = int(vCls + 0.5);
  vec2 p = vWorld.xz;
  vec3 col; float aoK = 0.45;
  float n = fbm2(p / 60.0);
  float farK = smoothstep(2600.0, 5600.0, length(cameraPosition - vWorld));
  if (c == 1 || c == 11) { col = mix(vec3(0.19, 0.30, 0.105), vec3(0.26, 0.36, 0.135), n); col = mix(col, canopy(p, col * 0.85, 0.45), farK * 0.75); }
  else if (c == 2) { vec3 fl = mix(vec3(0.13, 0.215, 0.08), vec3(0.17, 0.25, 0.095), n); col = mix(fl, canopy(p, vec3(0.105, 0.20, 0.075), 1.0), 0.25 + 0.75 * farK); aoK = 0.2; }
  else if (c == 3) { col = mix(vec3(0.25, 0.36, 0.13), vec3(0.31, 0.40, 0.17), n); }
  else if (c == 4) { col = canopy(p * 1.6, vec3(0.20, 0.26, 0.11), 0.7); }
  else if (c == 5) { col = fieldColor(p, 0.45); }
  else if (c == 6) { float m = step(0.5, fract(p.x / 6.0)); col = vec3(0.14, 0.36, 0.13) * (0.94 + 0.08 * m); }
  else if (c == 7) { col = vec3(0.52, 0.15, 0.10); }
  else if (c == 8) { col = canopy(p, vec3(0.22, 0.29, 0.17), 0.5); }
  else if (c == 9) { col = vec3(0.56, 0.49, 0.34) * (0.9 + 0.2 * n); }
  else if (c == 10) { col = vec3(0.15, 0.25, 0.16) * (0.9 + 0.2 * n); }
  else if (c == 12) {
    // the planted strip beside a housing block: lawn, tired by autumn, with clipped shrubs
    col = mix(vec3(0.170, 0.275, 0.098), vec3(0.235, 0.325, 0.120), n);
    col = mix(col, vec3(0.33, 0.32, 0.15), 0.30 * uSeason * fbm2(p / 9.0));
    vec2 q = p / 2.3; float fw = max(fwidth(q.x), fwidth(q.y));
    float shrub = smoothstep(0.36, 0.20, length(fract(q) - 0.5 + (hash22(floor(q)) - 0.5) * 0.3)) * step(0.70, hash12(floor(q) + 1.7)) * (1.0 - smoothstep(0.25, 0.8, fw));
    col = mix(col, vec3(0.075, 0.150, 0.055), shrub * 0.85);
    aoK = 0.3;
  }
  else if (c == 20) { col = pavedColor(p) * vec3(1.05, 1.03, 0.99); }
  else if (c == 21) { col = pavedColor(p) * vec3(1.02, 1.04, 1.08); }
  else if (c == 22) { col = pavedColor(p) * vec3(0.90, 0.91, 0.93); }
  else if (c == 23) { col = vec3(0.40, 0.33, 0.22) * (0.88 + 0.24 * n); }
  else if (c == 24) { col = vec3(0.20, 0.185, 0.175) * (0.9 + 0.2 * n); }
  else if (c == 25) { col = pavedColor(p) * vec3(0.98, 1.0, 0.97); }
  else if (c == 26) { col = mix(pavedColor(p), vec3(0.30, 0.37, 0.20), 0.22); }
  else if (c == 27) {
    // car park: double rows of bays either side of an aisle, most of them taken
    col = vec3(0.205, 0.205, 0.215) * (0.94 + 0.12 * n);
    float row = p.y / 17.0, fr = fract(row) * 17.0;                 // 0..5.5 bays, 5.5..11 bays, 11..17 aisle
    float bx = p.x / 2.6, fb = fract(bx);
    float fw = max(fwidth(bx), fwidth(p.y / 5.5));
    float lod = 1.0 - smoothstep(0.18, 0.7, fw);
    if (fr < 11.0) {
      float half_ = step(5.5, fr);
      float fy = (fr - 5.5 * half_) / 5.5;
      float line = smoothstep(0.47, 0.5, abs(fb - 0.5)) + smoothstep(0.03, 0.0, abs(fr - 5.5) / 5.5);
      col = mix(col, vec3(0.56), clamp(line, 0.0, 1.0) * lod * 0.6);
      vec2 id = vec2(floor(bx), floor(row) * 2.0 + half_);
      float r = hash12(id + 7.7), r2 = hash12(id + 31.1);
      float taken = step(r, 0.68);
      vec2 d = abs(vec2(fb - 0.5, fy - 0.5 + (half_ - 0.5) * 0.06)) * vec2(2.6, 5.5);
      float body = (1.0 - smoothstep(0.86, 0.92, d.x)) * (1.0 - smoothstep(2.05, 2.15, d.y));
      float cabin = (1.0 - smoothstep(0.72, 0.78, d.x)) * (1.0 - smoothstep(0.95, 1.05, abs(d.y - 0.15)));
      vec3 cc = mix(carColor(fract(r2 * 9.7)), vec3(0.035, 0.045, 0.055), cabin * 0.75);
      // a soft shadow hugging the car, then the car; from far away the lot keeps its average tone
      col *= 1.0 - 0.30 * taken * lod * (1.0 - smoothstep(0.9, 1.25, d.x)) * (1.0 - smoothstep(2.1, 2.5, d.y)) * (1.0 - body);
      col = mix(col, cc, taken * body * lod);
      col = mix(col, vec3(0.27, 0.27, 0.28), (1.0 - lod) * 0.45);
    }
  }
  else if (c == 28 || c == 33) {
    vec2 g = abs(fract(p / 6.0) - 0.5); float fw = fwidth(p.x / 6.0);
    col = (c == 33 ? vec3(0.46, 0.44, 0.40) : vec3(0.52, 0.50, 0.455)) * (0.94 + 0.10 * n);
    col *= 1.0 - 0.10 * smoothstep(0.455, 0.5, max(g.x, g.y)) * (1.0 - smoothstep(0.15, 0.6, fw));
  }
  else if (c == 29) { col = vec3(0.43, 0.43, 0.42) * (0.95 + 0.1 * n); }
  else if (c == 30) { col = vec3(0.115, 0.115, 0.125); }
  else if (c == 31) { col = vec3(0.21, 0.21, 0.215); }
  else if (c == 32) { col = vec3(0.39, 0.38, 0.365); }
  else { col = pavedColor(p); }
  // ploughed runways stay dark, paved yards are trodden, everything else lies under snow
  float snowK = (c >= 29 && c <= 31) ? 0.22 : (c == 27 || c == 28 || c == 33 || c == 24) ? 0.72 : (c >= 20 ? 0.86 : 1.0);
  col = snowOn(col, vec3(0.0, 1.0, 0.0), vWorld, snowK);
  fragColor = vec4(finish(col, vWorld, vec3(0.0, 1.0, 0.0), aoK), 1.0);
}`;

// ------------------------------------------------------------------ water
const WATER_FRAG = /* glsl */`${COMMON_FRAG}
in vec3 vWorld;
flat in float vCls;
out vec4 fragColor;
vec2 ripple(vec2 p, float t) {
  vec2 a = vec2(vnoise(p * 0.11 + vec2(t * 0.05, t * 0.03)), vnoise(p * 0.11 + vec2(-t * 0.04, t * 0.06) + 31.7)) - 0.5;
  vec2 b = vec2(vnoise(p * 0.47 + vec2(t * 0.21, -t * 0.13) + 5.1), vnoise(p * 0.47 + vec2(t * 0.11, t * 0.19) + 12.3)) - 0.5;
  return a * 0.10 + b * 0.05;
}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float t = uTimeNight.x;
  float dist = length(cameraPosition - vWorld);
  float lod = 1.0 - smoothstep(2500.0, 26000.0, dist);
  vec2 r = ripple(vWorld.xz, t) * mix(0.35, 1.0, lod);
  vec3 n = normalize(vec3(r.x, 1.0, r.y));
  vec3 R = reflect(-V, n);
  vec3 sky = skyColor(normalize(vec3(R.x, abs(R.y) + 0.02, R.z)));
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  float sh = sunShadow(vWorld, vec3(0.0, 1.0, 0.0));
  float cs = cloudShadow(vWorld);
  vec3 deep = mix(vec3(0.020, 0.075, 0.075), vec3(0.050, 0.125, 0.105), fbm2(vWorld.xz / 180.0));
  vec3 body = deep * (uSunColor * max(uSunDir.y, 0.0) * sh * cs * 0.9 + hemiAmbient(vec3(0.0, 1.0, 0.0)) * 1.4);
  vec3 col = mix(body, sky * (0.72 + 0.28 * sh), fres);
  // sun glitter: many tiny facets catching the sun along the reflection path
  vec3 Hh = normalize(uSunDir + V);
  float nh = max(dot(n, Hh), 0.0);
  float spark = hash12(floor(vWorld.xz * 0.9) + floor(t * 3.0));
  float glit = pow(nh, 900.0) * 14.0 + pow(nh, 90.0) * 0.55 * smoothstep(0.55, 1.0, spark);
  col += uSunColor * glit * sh * cs * (1.0 - uTimeNight.y);
  // at night the lakes mirror the glow of the city
  col += vec3(0.20, 0.13, 0.06) * uTimeNight.z * fres * 0.5;
  if (uSnow > 0.0) {
    // winter: the lakes freeze over, with wind-swept snow on the ice
    vec3 iceA = mix(vec3(0.30, 0.37, 0.42), vec3(0.55, 0.59, 0.64), smoothstep(0.35, 0.7, fbm(vWorld.xz / 55.0)));
    vec3 ice = shade(iceA, vec3(0.0, 1.0, 0.0), sh * cs, 1.0) + sky * fres * 0.35;
    col = mix(col, ice, uSnow * 0.93);
  }
  col = applyFog(col, vWorld, cameraPosition);
  fragColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ roads
const ROAD_VERT = /* glsl */`${PRECISION}
in vec3 aC;
in vec4 aOff;
in vec3 aDW;                 // distance along, signed half width, deck height above the ground
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uSunDir;
uniform float uExtra;        // extra half width in metres (casing / kerb pass)
uniform float uPixelAngle;   // world metres per pixel at unit distance
uniform float uMinPx;        // scale for the screen-space minimum width
uniform float uDeckShadow;   // 1 = draw the shadow a bridge deck throws on the ground instead of the deck
out vec3 vWorld;
out vec4 vRoad;              // s, signed across (m), half width (m), real half width (m)
out vec2 vTan;
out float vDeck;
flat out vec2 vCF;           // class, flags
void main() {
  float cls = aOff.z;
  vec2 off = aOff.xy / 63.5;
  float hw = abs(aDW.y), side = sign(aDW.y);
  vec3 c = aC;
  vDeck = aDW.z;
  if (uDeckShadow > 0.5) {
    // drop to the ground and slide away from the sun
    vec2 sl = -uSunDir.xz * (aDW.z / max(uSunDir.y, 0.07));
    float len = length(sl), cap = aDW.z * 9.0;
    if (len > cap) sl *= cap / max(len, 1e-4);
    c.y -= aDW.z; c.xz += sl;
  }
  vec4 vp0 = viewMatrix * vec4(c, 1.0);
  float px = max(-vp0.z, 1.0) * uPixelAngle;
  float minPx = cls < 1.5 ? 1.25 : cls < 2.5 ? 0.95 : cls < 3.5 ? 0.7 : cls > 19.5 ? 0.55 : cls > 8.5 ? 0.6 : 0.4;
  // at grade the casing is the pavement; on a bridge it is only the strip between kerb and barrier
  bool onBridge = mod(floor(aOff.w / 2.0), 2.0) > 0.5 || aDW.z > 1.0;
  float halfW = max(hw + uExtra * (onBridge && uDeckShadow < 0.5 ? 0.4 : 1.0), minPx * uMinPx * px);
  vec3 p = c + vec3(off.x, 0.0, off.y) * halfW;
  p.y += uDeckShadow > 0.5 ? 0.05 : 0.12;
  vWorld = p;
  vRoad = vec4(aDW.x, side * halfW, halfW, hw);
  vec2 rn = normalize(off * side + vec2(1e-6));
  vTan = vec2(rn.y, -rn.x);
  vCF = vec2(cls, aOff.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const ROAD_FRAG = /* glsl */`${COMMON_FRAG}
in vec3 vWorld;
in vec4 vRoad;
in vec2 vTan;
in float vDeck;
flat in vec2 vCF;
uniform float uCasing;
uniform float uTraffic;
uniform float uFade;
uniform float uDeckShadow;
out vec4 fragColor;

void main() {
  int cls = int(vCF.x + 0.5);
  int flags = int(vCF.y + 0.5);
  bool oneway = (flags & 1) != 0;
  bool bridge = (flags & 2) != 0;
  bool ring = (flags & 4) != 0;
  bool avenue = (flags & 8) != 0;
  bool rail = cls >= 20;
  float s = vRoad.x, v = vRoad.y, halfW = vRoad.z, hw = vRoad.w;
  float fwV = fwidth(v);
  float edge = 1.0 - smoothstep(halfW - fwV * 1.2, halfW, abs(v));
  // roads thinner than a pixel fade instead of shimmering
  float pxW = (2.0 * hw) / max(fwV, 1e-4);
  float thin = clamp(pxW / 1.1, 0.0, 1.0);
  float minA = cls <= 1 ? 0.85 : cls == 2 ? 0.7 : cls == 3 ? 0.55 : cls == 9 ? 0.45 : rail ? 0.4 : 0.0;
  float alpha = edge * max(thin, minA) * uFade;
  if (uDeckShadow > 0.5) {
    // soft-edged shadow of an elevated deck
    float soft = 1.0 - smoothstep(halfW * 0.45, halfW, abs(v));
    float a = soft * 0.55 * uShadowParams.y * smoothstep(1.0, 3.2, vDeck) * uFade;
    if (a < 0.004) discard;
    fragColor = vec4(applyFog(hemiAmbient(vec3(0.0, 1.0, 0.0)) * 0.10, vWorld, cameraPosition), a);
    return;
  }
  if (alpha < 0.003) discard;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float lights = uTimeNight.z;
  vec3 col; vec3 emis = vec3(0.0);
  float t = clamp(v / max(hw, 0.01), -1.0, 1.0);
  if (cls == 12) {
    // zebra crossing: painted bars lying along the direction of travel
    float q = v / 1.1, fwq = fwidth(q);
    float bar = smoothstep(0.27 - fwq, 0.27 + fwq, abs(fract(q) - 0.5));
    bar = mix(bar, 0.46, smoothstep(0.30, 0.85, fwq));
    float a = bar * edge * uFade * (0.70 + 0.25 * vnoise(vWorld.xz * 1.7));
    if (a < 0.01) discard;
    vec3 paint = snowOn(vec3(0.60, 0.60, 0.58), n, vWorld, 0.25);
    float shz = sunShadow(vWorld, n) * cloudShadow(vWorld);
    vec3 lz = shade(paint, n, shz, 1.0 - 0.35 * groundAO(vWorld)) + paint * vec3(1.0, 0.66, 0.34) * lights * 1.1;
    fragColor = vec4(applyFog(lz, vWorld, cameraPosition), a);
    return;
  }

  if (uCasing > 0.5) {
    // kerb / pavement band (or shoulder on expressways)
    col = cls <= 1 || cls == 9 ? vec3(0.30, 0.30, 0.30) : vec3(0.44, 0.425, 0.395);
    if (bridge || vDeck > 1.0) col = vec3(0.50, 0.49, 0.475);
    else if (cls >= 2 && cls <= 5) {
      // pavement: a pale kerb stone against the carriageway, square flags beyond it
      float near = 1.0 - smoothstep(0.12, 0.6, fwV);
      float kerb = smoothstep(hw - fwV, hw + fwV, abs(v)) * (1.0 - smoothstep(hw + 0.28, hw + 0.28 + fwV, abs(v)));
      vec2 g = abs(fract(vec2(s, abs(v) - hw) / 0.9) - 0.5);
      col *= 1.0 - 0.10 * smoothstep(0.43, 0.49, max(g.x, g.y)) * near * (1.0 - smoothstep(0.08, 0.3, fwV));
      col = mix(col, vec3(0.585, 0.575, 0.55), kerb * near);
    }
  } else if (rail) {
    // ballast, two rails, sleepers
    col = vec3(0.235, 0.215, 0.20);
    float lod = 1.0 - smoothstep(0.08, 0.5, fwV / max(hw, 0.1));
    float sl = step(0.55, fract(s / 0.65));
    col = mix(col, vec3(0.30, 0.27, 0.24), sl * 0.6 * lod * (1.0 - smoothstep(0.2, 0.7, fwidth(s / 0.65))));
    float rails = smoothstep(0.10, 0.03, abs(abs(t) - 0.44));
    col = mix(col, vec3(0.42, 0.42, 0.44), rails * lod);
    if (cls == 21) col = mix(col, vec3(0.30, 0.31, 0.33), 0.5);
  } else {
    // carriageway
    vec3 asphalt = cls <= 3 || cls == 9 ? vec3(0.155, 0.158, 0.168) : cls <= 5 ? vec3(0.225, 0.225, 0.228) : cls == 6 ? vec3(0.30, 0.295, 0.285)
                 : cls == 7 ? vec3(0.50, 0.47, 0.41) : vec3(0.56, 0.51, 0.41);
    if (bridge) asphalt *= 1.08;
    asphalt *= 0.94 + 0.10 * fbm2(vec2(s * 0.05, v * 0.4));
    col = asphalt;
    float lanesTotal = max(1.0, floor(2.0 * hw / 3.55 + 0.5));
    float lc = (t * 0.5 + 0.5) * lanesTotal;
    float fwL = fwidth(lc);
    float mk = (1.0 - smoothstep(0.10, 0.42, fwL)) * step(float(cls), 5.5) * (cls == 9 ? 0.6 : 1.0);
    if (mk > 0.01 && cls <= 5) {
      float lw = 0.045;
      float lineD = abs(fract(lc + 0.5) - 0.5);
      float inner = step(0.5, lc) * step(lc, lanesTotal - 0.5);
      float dash = step(0.6, fract(s / 15.0));
      float lane = (1.0 - smoothstep(lw, lw + fwL, lineD)) * inner * dash;
      float edgeL = 1.0 - smoothstep(lw, lw + fwL, abs(abs(lc - lanesTotal * 0.5) - (lanesTotal * 0.5 - 0.09)));
      vec3 paint = vec3(0.62, 0.62, 0.60);
      float centre = 0.0;
      if (!oneway && lanesTotal >= 2.0) {
        centre = 1.0 - smoothstep(lw * 1.3, lw * 1.3 + fwL, abs(abs(lc - lanesTotal * 0.5) - 0.06));
        lane *= step(0.2, abs(lc - lanesTotal * 0.5));
      }
      col = mix(col, paint, clamp(lane + edgeL * 0.8, 0.0, 1.0) * mk);
      col = mix(col, vec3(0.62, 0.50, 0.12), centre * mk);
    }
    // ---- traffic
    float dens = cls == 0 ? 0.50 : cls == 1 ? 0.56 : cls == 2 ? 0.40 : cls == 3 ? 0.24 : cls == 9 ? 0.22 : cls == 4 ? 0.10 : 0.0;
    if (ring || avenue) dens += 0.10;
    dens *= uTraffic;
    if (dens > 0.0) {
      float perDir = oneway ? lanesTotal : max(1.0, floor(lanesTotal * 0.5));
      float dir = 1.0, laneCoord;
      if (oneway) laneCoord = (t * 0.5 + 0.5) * perDir;
      else { dir = t > 0.0 ? 1.0 : -1.0; laneCoord = abs(t) * perDir; }
      float lane = floor(laneCoord), lf = fract(laneCoord);
      float laneW = (oneway ? 2.0 * hw : hw) / perDir;
      float speed = (cls == 0 ? 21.0 : cls == 1 ? 15.0 : cls == 2 ? 10.5 : 8.0) * (0.8 + 0.4 * hash11(lane * 7.13 + dir * 2.0 + 1.0));
      float slot = cls <= 1 ? 22.0 : 30.0;
      float x = (s * dir - uTimeNight.x * speed) / slot + hash11(lane * 3.71 + dir * 1.3) * 37.0;
      float id = floor(x), fx = fract(x);
      vec2 key = vec2(id, lane * 13.0 + dir * 5.0 + floor(vCF.x) * 3.0);
      float r = hash12(key), r2 = hash12(key + 17.3);
      float present = step(r, dens);
      float len = r2 > 0.955 ? 11.5 : (r2 > 0.9 ? 6.2 : 4.5);
      float wid = len > 6.0 ? 1.25 : 0.92;
      float along = (fx - 0.5) * slot;          // metres from the slot centre, + = forward
      float acr = (lf - 0.5) * laneW;
      float fwS = fwidth(s);
      float carLod = 1.0 - smoothstep(0.9, 3.2, fwS);
      float body = (1.0 - smoothstep(len * 0.5 - fwS, len * 0.5 + fwS, abs(along))) * (1.0 - smoothstep(wid - fwV, wid + fwV, abs(acr)));
      vec3 cc = carColor(fract(r2 * 9.7));
      // darker glass house
      float cabin = (1.0 - smoothstep(len * 0.22, len * 0.26, abs(along + len * 0.04))) * (1.0 - smoothstep(wid * 0.74, wid * 0.8, abs(acr)));
      cc = mix(cc, vec3(0.03, 0.04, 0.05), cabin * 0.75 * step(len, 6.0));
      float cover = present * body * carLod;
      col = mix(col, cc, cover);
      // contact shadow just beside the car
      col *= 1.0 - 0.35 * present * carLod * (1.0 - smoothstep(wid, wid + 0.9, abs(acr))) * (1.0 - smoothstep(len * 0.5, len * 0.5 + 1.2, abs(along))) * (1.0 - body);
      // lights: seen head-on -> white headlights, from behind -> red tail lights
      vec2 flow = vTan * dir;
      vec2 toCam = normalize(cameraPosition.xz - vWorld.xz + vec2(1e-4));
      float facing = dot(flow, toCam);
      vec3 head = vec3(1.0, 0.93, 0.78), tail = vec3(1.0, 0.07, 0.03);
      float night = max(lights, 0.0);
      // near: beams painted on the road ahead + lamp points; far: an averaged ribbon of light
      float beam = smoothstep(len * 0.5 + 14.0, len * 0.5, along) * step(len * 0.5 - 0.3, along) * (1.0 - smoothstep(wid * 0.9, wid * 2.2, abs(acr)));
      float lampH = (1.0 - smoothstep(0.0, 0.7, abs(along - len * 0.5))) * (1.0 - smoothstep(0.3, 0.95, abs(abs(acr) - wid * 0.62)));
      float lampT = (1.0 - smoothstep(0.0, 0.6, abs(along + len * 0.5))) * (1.0 - smoothstep(0.3, 0.9, abs(abs(acr) - wid * 0.62)));
      vec3 nearL = head * (beam * 0.55 + lampH * 6.0 * smoothstep(-0.2, 0.5, facing)) + tail * lampT * 5.0 * smoothstep(0.2, -0.5, facing);
      float avgK = len / slot;
      vec3 farL = mix(tail * 0.55, head * 1.0, smoothstep(-0.25, 0.25, facing)) * avgK * 2.6 * dens;
      emis += mix(farL, nearL * present, carLod) * night;
      // daytime sun glint off windscreens far away adds a little sparkle to busy roads
    }
    // ---- street lighting
    if (lights > 0.0 && cls <= 6) {
      float k = cls <= 1 ? 1.0 : cls == 2 ? 0.95 : cls == 3 ? 0.75 : cls == 9 ? 0.6 : cls == 4 ? 0.5 : cls == 5 ? 0.22 : 0.10;
      if (avenue) k = 1.5;
      float sp = 32.0;
      float fwS = fwidth(s / sp);
      float pool = 0.55 + 0.9 * exp(-pow((fract(s / sp) - 0.5) * sp / 9.5, 2.0));
      pool = mix(0.95, pool, 1.0 - smoothstep(0.15, 0.6, fwS));
      vec3 lamp = avenue ? vec3(1.0, 0.76, 0.44) : mix(vec3(1.0, 0.58, 0.24), vec3(1.0, 0.72, 0.42), step(2.5, float(cls)) * 0.5);
      emis += col * lamp * k * pool * lights * 1.5 + lamp * k * lights * 0.035;
    }
  }
  if (uSnow > 0.0) {
    // carriageways are slushy and dark, kerbs and paths white
    float k = uCasing > 0.5 ? 0.9 : rail ? 0.6 : cls >= 6 && cls <= 8 ? 0.8 : cls >= 4 && cls <= 5 ? 0.42 : 0.2;
    col = snowOn(col, n, vWorld, k);
  }
  float sh = sunShadow(vWorld, n) * cloudShadow(vWorld);
  float ao = 1.0 - 0.35 * groundAO(vWorld);
  vec3 lit = shade(col, n, sh, ao) + emis;
  if (uCasing < 0.5 && !rail) lit += sunSheen(n, normalize(cameraPosition - vWorld), sh, 1.6) * (col + 0.06);
  lit = applyFog(lit, vWorld, cameraPosition);
  fragColor = vec4(lit, alpha);
}`;

// ------------------------------------------------------------------ flyover structure (girders, barriers, piers)
const DECK_VERT = /* glsl */`${PRECISION}
in vec3 position;
in vec2 aRP;                 // height relative to the deck surface (m), part: 0 girder + barrier, 1 pier, 2 slab top
uniform mat4 viewMatrix, projectionMatrix;
out vec3 vWorld;
out vec2 vRP;
void main() { vWorld = position; vRP = aRP; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;

const DECK_FRAG = /* glsl */`${COMMON_FRAG}
in vec3 vWorld;
in vec2 vRP;
out vec4 fragColor;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(n, V) < 0.0) n = -n;
  float rel = vRP.x; int part = int(vRP.y + 0.5);
  vec3 col = vec3(0.50, 0.49, 0.475);
  float shade_ = 1.0;
  if (part == 1) {
    // pier: board-marked concrete standing in the shade of its deck
    col = vec3(0.47, 0.465, 0.45) * (0.93 + 0.10 * vnoise(vWorld.xz * 0.7 + vWorld.y * 0.9));
    shade_ = mix(0.35, 0.8, smoothstep(-2.0, -9.0, rel));
  } else if (part == 0) {
    if (n.y < -0.5) { col = vec3(0.36, 0.36, 0.355); shade_ = 0.25; }                 // soffit
    else {
      float fwr = fwidth(rel) + 0.01;
      col = vec3(0.56, 0.555, 0.54) * (0.94 + 0.08 * vnoise(vec2(dot(vWorld.xz, vec2(0.7, 0.7)) * 0.25, vWorld.y)));
      // barrier above the deck line, a shadow gap under its edge, then the girder web, darker towards the bottom flange
      float below = 1.0 - smoothstep(-fwr, fwr, rel);
      col *= 1.0 - 0.30 * below * (1.0 - smoothstep(0.12, 0.30, -rel));
      col *= 1.0 - 0.14 * below * smoothstep(0.3, 1.4, -rel);
      col = mix(col, vec3(0.63, 0.625, 0.61), smoothstep(fwr, 3.0 * fwr, rel) * (1.0 - smoothstep(0.3, 1.5, fwr)));
    }
  }
  col = snowOn(col, n, vWorld, 0.9);
  float sh = sunShadow(vWorld, n) * cloudShadow(vWorld) * shade_;
  vec3 lit = shade(col, n, sh, 1.0 - 0.3 * groundAO(vWorld) * step(rel, -1.0));
  // street lamps on the deck and below wash the structure at night
  lit += col * vec3(1.0, 0.62, 0.30) * uTimeNight.z * (part == 2 ? 0.5 : 0.22);
  fragColor = vec4(applyFog(lit, vWorld, cameraPosition), 1.0);
}`;

// ------------------------------------------------------------------ AO baker shaders
const FS_VERT = /* glsl */`${PRECISION}
in vec3 position; out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLUR_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tSrc; uniform vec2 uDir; in vec2 vUv; out vec4 fragColor;
void main() {
  float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec2 s = texture(tSrc, vUv).rg * w[0];
  for (int i = 1; i < 5; i++) { s += texture(tSrc, vUv + uDir * float(i)).rg * w[i]; s += texture(tSrc, vUv - uDir * float(i)).rg * w[i]; }
  fragColor = vec4(s, 0.0, 1.0);
}`;

class GeoWorker {
  constructor() {
    this.w = new Worker(new URL('./geoWorker.js', import.meta.url), { type: 'module' });
    this.seq = 0; this.jobs = new Map();
    this.w.onmessage = (ev) => { const j = this.jobs.get(ev.data.id); this.jobs.delete(ev.data.id); if (!j) return; ev.data.ok ? j.resolve(ev.data.res) : j.reject(new Error(ev.data.error)); };
    this.w.onerror = (e) => console.error('geo worker error', e.message || e);
  }
  run(task, data, transfer = []) {
    return new Promise((resolve, reject) => { const id = ++this.seq; this.jobs.set(id, { resolve, reject }); this.w.postMessage({ id, task, data }, transfer); });
  }
}

export class Ground {
  constructor({ env, scene, renderer, aoScene, quality }) {
    this.env = env; this.scene = scene; this.renderer = renderer; this.aoScene = aoScene; this.quality = quality;
    this.worker = new GeoWorker();
    this.group = new THREE.Group(); this.group.name = 'ground';
    scene.add(this.group);
    this.uniforms = {
      ...env.uniforms,
      uDebug: { value: new URLSearchParams(location.search).get('debug') === 'ao' ? 1 : 0 }, uUrbanMap: { value: null }, uTraffic: { value: 1.0 }, uPixelAngle: { value: 0.001 }, uMinPx: { value: 1.0 },
    };
    this.roadMeshes = [];
    this._initAo();
    this._initPlane();
  }

  mat(vert, frag, extra = {}, opts = {}) {
    return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vert, fragmentShader: frag, uniforms: { ...this.uniforms, ...extra }, ...opts });
  }

  _initPlane() {
    const geo = new THREE.PlaneGeometry(700000, 700000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, this.mat(PLANE_VERT, PLANE_FRAG, {}, { depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }));
    m.renderOrder = 3; m.frustumCulled = false; m.name = 'groundPlane';
    this.group.add(m);
    // The ground layers are painted over one another without writing depth (no z-fighting between coplanar layers).
    // Once they are all down, this invisible copy records the ground in the depth buffer for the ambient-occlusion pass.
    const dm = new THREE.Mesh(geo, new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: PLANE_VERT, fragmentShader: `${PRECISION}\nout vec4 fragColor;\nvoid main() { fragColor = vec4(0.0); }`,
      colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }));
    dm.renderOrder = 6; dm.frustumCulled = false; dm.name = 'groundDepth';
    this.group.add(dm);
  }

  // ---------------------------------------------------------------- occupancy / AO maps
  _initAo() {
    const size = this.quality.aoSize;
    const opt = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false };
    this.aoOcc = new THREE.WebGLRenderTarget(size, size, { ...opt, depthBuffer: true });
    this.aoA = new THREE.WebGLRenderTarget(size, size, opt);
    this.aoB = new THREE.WebGLRenderTarget(size, size, opt);
    this.urbA = new THREE.WebGLRenderTarget(512, 512, opt);
    this.urbB = new THREE.WebGLRenderTarget(512, 512, opt);
    this.aoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
    this.fsScene = new THREE.Scene();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.blurMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
    const fs = new THREE.Mesh(tri, this.blurMat); fs.frustumCulled = false;
    this.fsScene.add(fs);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.env.uniforms.uAoMap.value = this.aoB.texture;
    this.uniforms.uUrbanMap.value = this.urbB.texture;
  }

  setExtent(x0, z0, x1, z1) {
    // world rect covered by the occupancy maps (x east, z south)
    this.extent = [x0, z0, x1, z1];
    const cam = this.aoCam;
    cam.left = x0; cam.right = x1; cam.top = -z0; cam.bottom = -z1;      // camera looks straight down, up = -z (north)
    cam.near = 1; cam.far = 4000;
    cam.position.set(0, 3000, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    // the top-down render has north at the top row, so v runs from the southern edge (z1) to the northern one (z0)
    this.env.uniforms.uAoRect.value.set(x0, z1, 1 / (x1 - x0), -1 / (z1 - z0));
  }

  bakeAo() {
    const r = this.renderer;
    const prev = r.getClearColor(new THREE.Color()); const pa = r.getClearAlpha();
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(this.aoOcc); r.clear(true, true, false);
    r.render(this.aoScene, this.aoCam);
    const blur = (src, dst, dx, dy) => {
      this.blurMat.uniforms.tSrc.value = src.texture; this.blurMat.uniforms.uDir.value.set(dx, dy);
      r.setRenderTarget(dst); r.render(this.fsScene, this.fsCam);
    };
    const s = this.aoOcc.width;
    // tight contact occlusion (~35 m)
    blur(this.aoOcc, this.aoA, 1.1 / s, 0); blur(this.aoA, this.aoB, 0, 1.1 / s);
    // wide "urban-ness" (~400 m), on a small target
    blur(this.aoOcc, this.urbA, 4 / s, 0); blur(this.urbA, this.urbB, 0, 4 / s);
    blur(this.urbB, this.urbA, 2.2 / 512, 0); blur(this.urbA, this.urbB, 0, 2.2 / 512);
    blur(this.urbB, this.urbA, 3.0 / 512, 0); blur(this.urbA, this.urbB, 0, 3.0 / 512);
    r.setRenderTarget(null);
    r.setClearColor(prev, pa);
  }

  // ---------------------------------------------------------------- data layers
  async load(terrain) {
    const man = this.manifest = await fetchJSON('ground.json');
    if (terrain && terrain.fineData) {
      const copy = terrain.fineData.slice(0);
      await this.worker.run('terrainData', { buffer: copy.buffer, meta: terrain.fineMeta }, [copy.buffer]);
    }
    const [areasBuf, waterBuf, roadsBuf] = await Promise.all([fetchBin(man.files.areas), fetchBin(man.files.water), fetchBin(man.files.roads)]);
    const [areas, water] = await Promise.all([
      this.worker.run('polys', { buffer: areasBuf }, [areasBuf]),
      this.worker.run('polys', { buffer: waterBuf }, [waterBuf]),
    ]);
    const polyMesh = (res, frag, order, name) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('aXZ', new THREE.BufferAttribute(res.pos, 2));
      geo.setAttribute('aCls', new THREE.BufferAttribute(res.cls, 1));
      geo.setIndex(new THREE.BufferAttribute(res.index, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 60000);
      const m = new THREE.Mesh(geo, this.mat(AREA_VERT, frag, {}, { depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }));
      m.renderOrder = order; m.frustumCulled = false; m.name = name;
      this.group.add(m);
      return m;
    };
    this.areas = polyMesh(areas, AREA_FRAG, 4, 'areas');
    this.water = polyMesh(water, WATER_FRAG, 5, 'water');
    if (man.files.yards) {
      // lawns beside housing blocks arrive a moment later; nothing waits for them
      fetchBin(man.files.yards).then((buf) => this.worker.run('polys', { buffer: buf }, [buf])).then((res) => { this.yards = polyMesh(res, AREA_FRAG, 4.5, 'yards'); })
        .catch((e) => console.warn('yards failed', e));
    }

    // roads
    const chunks = man.roadChunks;
    const res = await this.worker.run('roads', { buffer: roadsBuf, chunks }, [roadsBuf]);
    const casing = { uCasing: { value: 1 }, uExtra: { value: 2.3 }, uFade: { value: 1 }, uDeckShadow: { value: 0 } };
    const fill = { uCasing: { value: 0 }, uExtra: { value: 0 }, uFade: { value: 1 }, uDeckShadow: { value: 0 } };
    const opts = { transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
    // one material set per group so each group can fade independently
    this.roadMats = [];
    for (let g = 0; g < 5; g++) {
      const fadeU = { value: 1 };
      this.roadMats.push({
        fade: fadeU,
        casing: g >= 3 ? null : this.mat(ROAD_VERT, ROAD_FRAG, { ...casing, uFade: fadeU }, opts),
        fill: this.mat(ROAD_VERT, ROAD_FRAG, { ...fill, uFade: fadeU }, opts),
        deckShadow: this.mat(ROAD_VERT, ROAD_FRAG, { ...fill, uFade: fadeU, uExtra: { value: 1.2 }, uDeckShadow: { value: 1 } }, opts),
      });
    }
    this.deckMat = this.mat(DECK_VERT, DECK_FRAG, {}, { side: THREE.DoubleSide });
    // render order: paths < minor < major < rail (casings of a group below its fills), then deck shadows, then the decks themselves
    const ORDER = { 2: 10, 1: 12, 0: 14, 3: 16, 4: 18 };      // 4 = markings (zebra crossings) over every carriageway at grade
    for (const c of res) {
      if (!c.index.length) continue;
      const aC = new THREE.BufferAttribute(c.C, 3), aOff = new THREE.BufferAttribute(c.O, 4), aDW = new THREE.BufferAttribute(c.D, 3), index = new THREE.BufferAttribute(c.index, 1);
      const [x0, z0, x1, z1, y1] = c.bounds;
      const sphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, y1 / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, z1 - z0, y1) / 2 + 80);
      const part = (start, count) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('aC', aC); geo.setAttribute('aOff', aOff); geo.setAttribute('aDW', aDW); geo.setIndex(index);
        geo.setDrawRange(start, count);
        geo.boundingSphere = sphere;
        return geo;
      };
      const mats = this.roadMats[c.g];
      const entry = { g: c.g, center: sphere.center, meshes: [] };
      const add = (geo, mat, order) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; this.group.add(m); entry.meshes.push(m); };
      if (c.bridgeStart > 0) {
        const ground = part(0, c.bridgeStart);
        if (mats.casing) add(ground, mats.casing, ORDER[c.g]);
        add(ground, mats.fill, ORDER[c.g] + 1);
      }
      if (c.bridgeStart < c.index.length) {
        const decks = part(c.bridgeStart, c.index.length - c.bridgeStart);
        add(decks, mats.deckShadow, 20);
        if (mats.casing) add(decks, mats.casing, 22);
        add(decks, mats.fill, 23);
      }
      if (c.deck) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(c.deck.pos, 3)); geo.setAttribute('aRP', new THREE.BufferAttribute(c.deck.rp, 2));
        geo.setIndex(new THREE.BufferAttribute(c.deck.index, 1));
        geo.boundingSphere = sphere;
        entry.solid = new THREE.Mesh(geo, this.deckMat); entry.solid.name = 'deckStructure';
        this.group.add(entry.solid);
      }
      this.roadMeshes.push(entry);
    }
  }

  update(camera, viewportH) {
    this.uniforms.uPixelAngle.value = 2 * Math.tan(camera.fov * Math.PI / 360) / viewportH;
    // minor road groups only exist near the camera (they are sub-pixel beyond)
    const e = camera.position;
    const range = [1e9, 26000 * this.quality.lodRange, 9000 * this.quality.lodRange, 1e9, 5200 * this.quality.lodRange];
    for (const r of this.roadMeshes) {
      const d = Math.hypot(r.center.x - e.x, e.y, r.center.z - e.z);
      const vis = d < range[r.g];
      for (const m of r.meshes) m.visible = vis;
      if (r.solid) r.solid.visible = d < 7500 * this.quality.lodRange;       // beyond that the structure is thinner than a pixel
    }
  }
}
