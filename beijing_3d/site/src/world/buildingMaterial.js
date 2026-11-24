// The building shader: procedural facades (windows, curtain walls, palace timber), roofs (flat, tiled, glazed),
// sun glints, night lighting, grounded AO, shadows and haze – all from 16 bytes per vertex.

import * as THREE from 'three';
import { PRECISION, ENV_UNIFORMS, NOISE, ATMOSPHERE, SHADOWS, LIGHTING } from '../engine/shaderlib.js';

const lin = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const arr = (name, list) => `const vec3 ${name}[${list.length}] = vec3[${list.length}](${list.map(lin).join(', ')});`;

const PALETTES = [
  arr('RESI_WALL', ['#d8cbb5', '#cdb89b', '#c8c5bd', '#b98e7a', '#e3ddd0', '#d6bcaa', '#b3bac0', '#c2a98c']),
  arr('GLASS', ['#557893', '#44706f', '#3a4d66', '#77665a', '#8a9ba8', '#4f7a70', '#2f3e52', '#6d8ea6']),
  arr('PUBLIC_WALL', ['#cfc5b2', '#a8644c', '#bab7af', '#d6c79f', '#b7a58d', '#e0d9c8']),
  arr('GENERIC_WALL', ['#c9c2b4', '#bdb5a6', '#d2cdc2', '#b5aea2', '#c4b7a3', '#aeb0b0']),
  arr('IND_WALL', ['#cfd3d4', '#b9bec1', '#d9d6cc', '#a9b4bd']),
  arr('IND_ROOF', ['#4b7bb2', '#5887bd', '#d3d6d8', '#a3a8ab', '#96584a', '#6890b6', '#3f6ea8', '#c2c6c8']),
  arr('GREY_TILE', ['#6b6b6d', '#74726f', '#626468', '#7b7873']),
  arr('VILLAGE_WALL', ['#b9aea0', '#a89a8c', '#c8beb0', '#a06450']),
  arr('VILLAGE_ROOF', ['#77757a', '#9a5a49', '#5882b2', '#8a8782', '#ac5641', '#6e6c70']),
  arr('RESI_PITCH', ['#8c5648', '#7b8896', '#5d6f69', '#8a6a5e']),
  arr('FLAT_ROOF', ['#aaa59c', '#9c9890', '#b5b0a6', '#8f8f8d', '#a39f99', '#bab6ad']),
  arr('GLAZED', ['#dba02b', '#3d7b56', '#2b4a8d', '#6c6c6f']),          // imperial yellow, green, blue, grey
].join('\n');

const VERT = /* glsl */`${PRECISION}
in vec4 aPos;      // x, y, z, u (decimetres, tile local)
in vec4 aInfo;     // style, palette, seed, part
in vec2 aH;        // wall-top height above base, base elevation (dm)
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uGrow;
out vec3 vWorld;
out vec3 vView;
out vec3 vFac;       // u (m), height above base (m), wall height H (m)
flat out vec4 vInfo;
void main() {
  vec3 p = aPos.xyz;
  float above = p.y - aH.y;
  // rise animation: buildings grow out of the ground
  float g = uGrow;
  p.y = aH.y + above * (above > 0.0 ? g : 1.0);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec4 vp = viewMatrix * wp;
  vWorld = wp.xyz;
  vView = vp.xyz;
  vFac = vec3(aPos.w, above, aH.x) * 0.1;
  vInfo = aInfo;
  gl_Position = projectionMatrix * vp;
}`;

const FRAG = /* glsl */`${PRECISION}
${ENV_UNIFORMS}
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform float uGrow;
uniform float uDetail;     // quality: 1 = full facade detail
in vec3 vWorld;
in vec3 vView;
in vec3 vFac;
flat in vec4 vInfo;
out vec4 fragColor;
${NOISE}
${ATMOSPHERE}
${SHADOWS}
${LIGHTING}
${PALETTES}

const int ST_GENERIC = 0, ST_RESI = 1, ST_OFFICE = 2, ST_RETAIL = 3, ST_IND = 4, ST_COURT = 5, ST_IMPERIAL = 6, ST_TEMPLE = 7, ST_PUBLIC = 8,
          ST_BIGROOF = 9, ST_CANOPY = 10, ST_TANK = 11, ST_CONSTR = 12, ST_VILLAGE = 13, ST_SPECIAL = 14, ST_VILLA = 15;
const int P_BODY = 0, P_TILE = 1, P_STONE = 2, P_HALL = 3, P_TRIM = 4, P_MASS = 5, P_PLANT = 6, P_PITCH = 7, P_GOLD = 8, P_MAST = 9, P_UNIT = 10, P_TANK = 11, P_SIGN = 12;

struct Surf { vec3 albedo; float gloss; float spec; vec3 emissive; float glass; vec3 refl; float occ; };

float aastep(float edge, float x, float w) { return smoothstep(edge - w, edge + w, x); }
float boxMask(vec2 p, vec2 lo, vec2 hi, vec2 w) {
  vec2 a = smoothstep(lo - w, lo + w, p) * (1.0 - smoothstep(hi - w, hi + w, p));
  return a.x * a.y;
}

Surf blank() { Surf s; s.albedo = vec3(0.5); s.gloss = 0.0; s.spec = 0.0; s.emissive = vec3(0.0); s.glass = 0.0; s.refl = vec3(0.0); s.occ = 1.0; return s; }
float rectMask(vec2 p, vec2 c, vec2 hs, float w) { vec2 d = abs(p - c) - hs; return 1.0 - smoothstep(-w, w, max(d.x, d.y)); }

// ---- flat roofs: waterproofing membranes, seams, weathering, rooftop plant, solar water heaters
Surf roofSurface(int st, float pal, float seed, vec3 wp, float Hm) {
  Surf s = blank();
  vec2 p = wp.xz;
  float hb = fract(seed * 0.618 + pal * 0.271), hb2 = fract(seed * 0.377 + pal * 0.113);
  int i = int(mod(pal * 7.0 + seed * 3.0, 6.0));
  vec3 c;
  bool urban = false;
  if (st == ST_IND) c = IND_ROOF[int(mod(pal + seed * 5.0, 8.0))];
  else if (st == ST_COURT) c = GREY_TILE[int(mod(seed, 4.0))];
  else if (st == ST_VILLAGE) c = (pal > 127.5 ? VILLAGE_ROOF[int(mod(seed * 3.0 + pal, 6.0))] : GREY_TILE[int(mod(seed, 4.0))]) * 1.05;
  else if (st == ST_IMPERIAL || st == ST_TEMPLE) c = GLAZED[int(mod(pal, 4.0))] * 0.9;
  else if (st == ST_BIGROOF) c = mix(vec3(0.72, 0.74, 0.76), vec3(0.50, 0.56, 0.62), fract(seed * 0.37));
  else if (st == ST_CANOPY) c = vec3(0.62, 0.66, 0.68);
  else if (st == ST_TANK) c = vec3(0.70, 0.71, 0.70);
  else if (st == ST_CONSTR) c = vec3(0.50, 0.48, 0.44);
  else {
    urban = true;
    vec3 grey = FLAT_ROOF[i];
    if (hb < 0.50) c = grey;
    else if (hb < 0.64) c = grey * 0.30 + vec3(0.075, 0.075, 0.085);        // bitumen
    else if (hb < 0.74) c = vec3(0.255, 0.150, 0.125);                       // weathered red-brown waterproof coating
    else if (hb < 0.87) c = vec3(0.49, 0.51, 0.54);                          // reflective aluminium paint
    else if (hb < 0.905) c = vec3(0.175, 0.235, 0.205);                      // faded green coating
    else c = vec3(0.24, 0.285, 0.35);                                        // blue-grey
    if (st == ST_OFFICE || st == ST_RETAIL) c = mix(c, vec3(0.23, 0.24, 0.26), 0.45);
  }
  float px = max(fwidth(p.x), fwidth(p.y));                                  // metres per pixel on the roof
  c *= 0.88 + 0.22 * fbm2(p * 0.11 + seed);
  c *= 0.94 + 0.10 * vnoise(p * 0.9 + seed * 3.0) * (1.0 - smoothstep(0.3, 1.5, px));
  s.albedo = c;
  if (!urban) return s;
  float near = (1.0 - smoothstep(0.5, 2.6, px)) * uDetail;
  if (near < 0.01) return s;
  // membrane seams
  vec2 g = abs(fract(p / 7.5 + hb) - 0.5) * 7.5;
  float seam = 1.0 - smoothstep(0.05, 0.05 + px, min(g.x, g.y));
  c *= 1.0 - 0.12 * seam * near * (1.0 - smoothstep(0.2, 0.9, px));
  // solar water heaters on housing: south-facing collector rows with their white tanks
  if ((st == ST_RESI || st == ST_GENERIC) && Hm > 8.0 && Hm < 75.0 && hb2 < 0.6) {
    vec2 q = vec2(p.x / 11.0, p.y / 3.2) + hb * 7.0;
    vec2 id = floor(q), f = fract(q);
    float r = hash12(id + seed);
    if (r < 0.42) {
      float panel = rectMask(f, vec2(0.5, 0.50), vec2(0.40, 0.24), px / 3.2);
      float tank = rectMask(f, vec2(0.5, 0.20), vec2(0.40, 0.055), px / 3.2);
      c = mix(c, vec3(0.020, 0.035, 0.075), panel * near);
      c = mix(c, vec3(0.74, 0.75, 0.76), tank * near);
      s.spec = max(s.spec, 0.85 * panel * near); s.gloss = 0.8;
    }
  }
  // plant on commercial roofs: condensers and vents with a short cast shadow
  float pEq = st == ST_OFFICE || st == ST_RETAIL ? 0.34 : st == ST_PUBLIC ? 0.22 : st == ST_GENERIC ? 0.16 : Hm > 30.0 ? 0.10 : 0.0;
  if (pEq > 0.0) {
    vec2 q = p / 8.5 + hb2 * 5.0;
    vec2 id = floor(q), f = (fract(q) - 0.5) * 8.5;
    vec3 r = hash32(id + seed * 1.7);
    if (r.x < pEq) {
      vec2 ctr = (r.yz - 0.5) * 3.2, hs = vec2(0.8 + 1.0 * r.y, 0.55 + 0.7 * r.z);
      vec2 sl = -uSunDir.xz / max(uSunDir.y, 0.25) * 1.2;
      float shd = rectMask(f - sl * 0.5, ctr + sl * 0.5, hs + abs(sl) * 0.5, px);
      float box = rectMask(f, ctr, hs, px);
      c *= 1.0 - 0.45 * shd * near * (1.0 - box) * uShadowParams.y;
      vec2 gr = abs(fract((f - ctr) / 0.9) - 0.5);
      vec3 unit = mix(vec3(0.50, 0.52, 0.54), vec3(0.66, 0.67, 0.68), r.z) * (0.86 + 0.14 * step(0.18, max(gr.x, gr.y)));
      c = mix(c, unit, box * near);
    }
  }
  // the occasional roof garden
  if (hb2 > 0.955) c = mix(c, vec3(0.13, 0.25, 0.09), smoothstep(0.50, 0.58, fbm2(p / 8.0 + seed)) * 0.9);
  s.albedo = c;
  return s;
}

// ---- walls
Surf wallSurface(int st, float pal, float seed, vec3 n, vec3 V) {
  Surf s = blank();
  float u = vFac.x, y = vFac.y, H = max(vFac.z, 1.0);
  float lights = uTimeNight.z;
  float hb = fract(seed * 0.618 + pal * 0.271), hb2 = fract(seed * 0.377 + pal * 0.113);
  // ---- style table
  float floorH = 3.3, bayW = 3.6; vec2 wlo = vec2(0.20, 0.30), whi = vec2(0.80, 0.78);
  vec3 wall = GENERIC_WALL[int(mod(pal, 6.0))];
  vec3 glassCol = GLASS[int(mod(pal * 3.0 + seed, 8.0))];
  float litP = 0.42, coolShare = 0.12;
  int kind = 0;                    // 0 punched windows, 1 curtain wall, 2 ribbon windows, 3 blank, 4 glass with vertical fins
  bool balcony = false, shops = false, ac = false, signs = false;
  vec3 warm = vec3(1.0, 0.58, 0.24), neutral = vec3(1.0, 0.78, 0.50), cool = vec3(0.66, 0.80, 1.0);
  if (st == ST_RESI || st == ST_VILLA) {
    wall = RESI_WALL[int(mod(pal, 8.0))]; floorH = 2.95; bayW = 3.5; wlo = vec2(0.22, 0.32); whi = vec2(0.78, 0.80); litP = 0.34;
    balcony = n.z > 0.30 || (H > 40.0 && hb > 0.55 && abs(n.x) > 0.7);     // living rooms face south (+z)
    ac = true; shops = hb2 < 0.30;
  } else if (st == ST_OFFICE) {
    floorH = 4.0; litP = 0.30; coolShare = 0.36; shops = true;
    if (hb < 0.42) { kind = 1; bayW = 1.5; wlo = vec2(0.035, 0.0); whi = vec2(0.965, 0.80); wall = mix(glassCol, vec3(0.62, 0.65, 0.68), 0.55); }
    else if (hb < 0.62) { kind = 4; bayW = 1.2; wlo = vec2(0.14, 0.0); whi = vec2(0.86, 0.86); wall = vec3(0.66, 0.67, 0.68); }
    else { kind = 2; bayW = 6.0; wlo = vec2(0.0, 0.30); whi = vec2(1.0, 0.84); wall = mix(GENERIC_WALL[int(mod(pal, 6.0))], vec3(0.78, 0.78, 0.76), 0.5); }
  } else if (st == ST_RETAIL) {
    wall = mix(GENERIC_WALL[int(mod(pal, 6.0))], vec3(0.80, 0.78, 0.74), 0.5); shops = true; litP = 0.6; coolShare = 0.25;
    // low shopping centres are mostly blank cladding with a few hoardings; anything taller reads as a commercial block with windows
    if (H < 34.0) { floorH = 5.2; bayW = 6.0; kind = 3; signs = true; }
    else { floorH = 4.0; bayW = 3.0; kind = 2; wlo = vec2(0.0, 0.30); whi = vec2(1.0, 0.84); }
  } else if (st == ST_PUBLIC) {
    wall = PUBLIC_WALL[int(mod(pal, 6.0))]; floorH = 3.8; bayW = 3.8; wlo = vec2(0.27, 0.20); whi = vec2(0.73, 0.84); litP = 0.30; coolShare = 0.2;
  } else if (st == ST_IND) {
    wall = IND_WALL[int(mod(pal, 4.0))]; kind = 3;
  } else if (st == ST_COURT) {
    wall = vec3(0.275, 0.265, 0.255) * (0.92 + 0.16 * fract(seed * 0.173)); kind = 3;
  } else if (st == ST_VILLAGE) {
    wall = VILLAGE_WALL[int(mod(seed, 4.0))]; floorH = 3.2; bayW = 3.6; wlo = vec2(0.30, 0.34); whi = vec2(0.70, 0.74); litP = 0.4;
  } else if (st == ST_IMPERIAL || st == ST_TEMPLE) {
    wall = vec3(0.36, 0.045, 0.03); kind = 3;
  } else if (st == ST_BIGROOF) {
    wall = vec3(0.70, 0.72, 0.73); floorH = 9.0; bayW = 4.0; kind = 2; wlo = vec2(0.0, 0.10); whi = vec2(1.0, 0.86); litP = 0.7; coolShare = 0.5;
  } else if (st == ST_CANOPY || st == ST_TANK) {
    wall = vec3(0.60, 0.62, 0.63); kind = 3;
  } else if (st == ST_CONSTR) {
    wall = vec3(0.20, 0.34, 0.22); kind = 3;      // green safety netting
  } else {
    ac = hb > 0.5; shops = hb2 < 0.4;
  }
  // per-building tone, weathering streaks running down the facade
  wall *= 0.93 + 0.14 * fract(seed * 0.311 + pal * 0.07);
  wall *= 0.95 + 0.07 * fbm2(vec2(u * 0.18, y * 0.05) + seed);
  wall *= 0.97 + 0.05 * vnoise(vec2(u * 1.3, y * 0.11) + seed * 2.0);
  s.albedo = wall;
  if (st == ST_IND) {
    float cor = u / 0.9, fwc = fwidth(cor);
    s.albedo *= 0.93 + 0.07 * step(0.5, fract(cor)) * (1.0 - smoothstep(0.3, 0.9, fwc));
    // clerestory strip and loading doors
    float band = boxMask(vec2(fract(u / 6.0), y / H), vec2(0.06, 0.70), vec2(0.94, 0.84), vec2(fwidth(u / 6.0), fwidth(y / H)) + 0.003) * step(6.5, H);
    float door = boxMask(vec2(fract(u / 34.0), y), vec2(0.42, 0.0), vec2(0.58, min(4.6, H * 0.7)), vec2(fwidth(u / 34.0), fwidth(y)) + 0.003);
    s.albedo = mix(s.albedo, vec3(0.16, 0.20, 0.24), band * 0.85);
    s.albedo = mix(s.albedo, wall * 0.62, door);
    s.emissive = vec3(0.75, 0.85, 1.0) * band * 0.35 * lights * step(0.6, hb);
    return s;
  }
  if (st == ST_CONSTR) { vec2 g = abs(fract(vec2(u, y) / 2.4) - 0.5); s.albedo = mix(s.albedo, vec3(0.42, 0.40, 0.36), smoothstep(0.42, 0.46, max(g.x, g.y))); return s; }
  if (st == ST_COURT || st == ST_VILLAGE && H < 4.5) {
    // brick courses and a doorway now and then
    float rows = y / 0.32, fwr = fwidth(rows);
    s.albedo *= 1.0 - 0.10 * smoothstep(0.40, 0.5, abs(fract(rows) - 0.5)) * (1.0 - smoothstep(0.2, 0.8, fwr));
    float bay = u / 5.2, fwb = fwidth(bay);
    float door = boxMask(vec2(fract(bay), y), vec2(0.40, 0.0), vec2(0.60, 2.2), vec2(fwb, fwidth(y)) + 0.003) * step(0.72, hash12(vec2(floor(bay), seed)));
    s.albedo = mix(s.albedo, st == ST_COURT ? vec3(0.30, 0.045, 0.035) : vec3(0.16, 0.11, 0.08), door * (1.0 - smoothstep(0.1, 0.5, fwb)));
    if (st == ST_COURT) return s;
  }
  if (kind == 3 && !signs) return s;
  if (y > H + 0.02) return s;                      // gable ends above the eaves

  float nF = max(1.0, floor(H / floorH + 0.5));
  float fh = H / nF;                               // actual storey height
  float fy = clamp(y / H, 0.0, 0.9999) * nF;
  float fx = u / bayW;
  vec2 cell = vec2(floor(fx), floor(fy));
  vec2 f = vec2(fract(fx), fract(fy));
  vec2 fw = vec2(fwidth(fx), fwidth(fy));
  float blur = max(fw.x, fw.y);
  float detail = (1.0 - smoothstep(0.30, 0.95, blur)) * uDetail;
  float fine = (1.0 - smoothstep(0.05, 0.22, blur)) * uDetail;      // sub-window features (frames, units, railings)
  bool ground = cell.y < 0.5;
  bool top = cell.y > nF - 1.5;
  // random per window / per floor
  float r1 = hash12(cell + seed * 13.7);
  float r2 = hash12(cell.yx * 1.7 + seed * 5.1 + 3.3);
  float rf = hash12(vec2(cell.y, seed * 3.1));
  // light direction in the wall's own frame: +u along the wall, used for the shadow the reveals throw on the glass
  vec3 tu = normalize(vec3(n.z, 0.0, -n.x) + vec3(1e-5, 0.0, 0.0));
  float ndl = dot(n, uSunDir), sunU = dot(uSunDir, tu), sunV = uSunDir.y;
  float lit = step(0.02, ndl) * uShadowParams.y;

  // reflections
  vec3 R = reflect(-V, n);
  vec3 skyRef = skyColor(normalize(vec3(R.x, abs(R.y) * 0.55 + 0.06, R.z)));
  float fres = 0.10 + 0.90 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
  float curtainK = kind == 1 || kind == 4 ? 1.0 : 0.0;
  float tone = mix(r1, 0.5 + 0.5 * (rf - 0.5), curtainK * 0.85);
  vec3 glassDay = glassCol * (0.32 + mix(0.26, 0.12, curtainK) * tone);
  vec3 reflDay = skyRef * clamp(0.16 + fres * 0.84, 0.0, 1.0) * (0.55 + 0.45 * curtainK) * (0.86 + mix(0.34, 0.16, curtainK) * tone);

  // ---- ground floor: shopfronts / lobbies
  if (ground && shops && kind != 1 && kind != 4) { wlo = vec2(0.07, 0.06); whi = vec2(0.93, 0.74); }
  if (ground && (kind == 1 || kind == 4)) { whi.y = 0.92; }

  // ---- balconies: a slab and a solid or glazed parapet in front of a full-height door
  float balc = 0.0;
  if (balcony && !ground) {
    float rb = hash12(vec2(cell.x, seed * 7.7));
    if (rb < 0.86) { balc = 1.0; wlo = vec2(0.12, 0.10); whi = vec2(0.88, 0.84); }
  }

  float cover, mask;
  vec3 frameCol = wall * 1.10 + 0.03;
  if (kind == 2) {
    // ribbon glazing between spandrels, mullions every quarter bay
    cover = (whi.y - wlo.y) * 0.94;
    float mul = 1.0 - smoothstep(0.012, 0.012 + fw.x * 4.0, abs(fract(fx * 4.0 + 0.5) - 0.5) / 4.0);
    mask = smoothstep(wlo.y - fw.y, wlo.y + fw.y, f.y) * (1.0 - smoothstep(whi.y - fw.y, whi.y + fw.y, f.y)) * (1.0 - mul * fine);
  } else {
    cover = (whi.x - wlo.x) * (whi.y - wlo.y);
    mask = boxMask(f, wlo, whi, fw * 0.75 + 0.004);
  }

  // curtains / blinds on a share of residential windows
  if (st == ST_RESI || st == ST_VILLAGE || st == ST_GENERIC) { float cur = step(0.72, r2) * 0.55; glassDay = mix(glassDay, wall * 0.92 + 0.05, cur); reflDay *= 1.0 - cur; }

  // ---- night: lit windows switch on progressively through dusk; occupancy varies per building and (in offices) per floor
  float p = litP * (0.25 + 1.5 * fract(seed * 0.6180339 + pal * 0.137)) * (st == ST_OFFICE ? (0.5 + 1.0 * step(0.45, rf)) : 1.0);
  if (ground && st != ST_VILLAGE) p = max(p, 0.8);
  float on = step(r1, p) * smoothstep(0.0, 0.12, lights - r2 * 0.75);
  vec3 lc = r2 < coolShare ? cool : (fract(r1 * 7.3) < 0.55 ? warm : neutral);
  float lum = (0.40 + 1.1 * fract(r1 * 31.7)) * (st == ST_OFFICE || st == ST_RETAIL ? 1.2 : 1.0);
  vec3 emis = lc * lum * on;
  emis *= mix(1.0, 0.55 + 0.75 * f.y, detail);

  // ---- assemble the wall
  vec3 col = wall;
  float occ = 1.0;
  if (kind == 1 || kind == 4) {
    // glass skin: spandrel band at each slab, mullion grid
    float span = 1.0 - smoothstep(0.16, 0.16 + fw.y, f.y - (whi.y - 1.0) * 0.0);
    span = max(span, smoothstep(whi.y - fw.y, whi.y + fw.y, f.y));
    vec3 spandrel = mix(glassCol * 0.55, wall, 0.45);
    float mulV = 1.0 - smoothstep(0.0, fw.x + 0.02, min(f.x, 1.0 - f.x) - (kind == 4 ? 0.10 : 0.02));
    vec3 g = glassDay;
    col = mix(g, spandrel, span * detail * 0.9);
    col = mix(col, wall, mulV * (kind == 4 ? 1.0 : 0.75) * detail);
    mask = (1.0 - span * 0.9) * (1.0 - mulV);
    cover = 0.72;
    if (kind == 4) {
      // fins throw a slanted shadow across the glass beside them
      float sh = smoothstep(0.0, 0.05, (sunU > 0.0 ? 1.0 - f.x - 0.14 : f.x - 0.14)) ;
      float band = clamp(0.35 * abs(sunU) / max(ndl, 0.15), 0.0, 0.6);
      float inSh = sunU > 0.0 ? step(1.0 - 0.14 - band, f.x) : step(f.x, 0.14 + band);
      occ = mix(1.0, 0.45, inSh * lit * detail * (1.0 - mulV));
    }
  } else {
    // masonry wall with openings
    vec3 opening = glassDay;
    // reveal: the opening sits ~22 cm back, so its head and the jamb on the sunny side shade the glass
    if (fine > 0.01 && kind == 0) {
      float d = balc > 0.5 ? 0.9 : 0.24;
      float bandV = clamp(d * sunV / max(ndl, 0.14) / fh, 0.0, 0.7 * (whi.y - wlo.y));
      float bandU = clamp(d * abs(sunU) / max(ndl, 0.14) / bayW, 0.0, 0.7 * (whi.x - wlo.x));
      float inV = smoothstep(whi.y - bandV - fw.y, whi.y - bandV + fw.y, f.y);
      float inU = sunU > 0.0 ? smoothstep(whi.x - bandU - fw.x, whi.x - bandU + fw.x, f.x) : 1.0 - smoothstep(wlo.x + bandU - fw.x, wlo.x + bandU + fw.x, f.x);
      occ = mix(1.0, 0.38, max(inV, inU) * mask * lit * fine);
      // frame and glazing bars
      vec2 e = min(f - wlo, whi - f);
      float fr = 1.0 - smoothstep(0.0, fw.x * 1.2 + 0.006, min(e.x, e.y * (fh / bayW)) - 0.022);
      float bar = 1.0 - smoothstep(0.0, fw.x + 0.004, abs(f.x - 0.5 * (wlo.x + whi.x)) - 0.008);
      opening = mix(opening, frameCol, clamp(fr + bar * 0.8, 0.0, 1.0) * fine);
    }
    col = mix(wall, opening, mask);
    // sill catching the light, storey bands
    if (kind == 0) {
      float sill = boxMask(f, vec2(wlo.x - 0.03, wlo.y - 0.045), vec2(whi.x + 0.03, wlo.y - 0.005), fw * 0.75 + 0.003) * (1.0 - balc);
      col = mix(col, frameCol * 1.06, sill * fine);
    }
    if (hb > 0.35) col *= 1.0 - 0.10 * (1.0 - smoothstep(0.0, fw.y + 0.012, f.y - 0.0)) * detail * step(0.5, 1.0 - mask);      // slab line
    if (hb2 > 0.6 && kind == 0) col = mix(col, frameCol, (1.0 - smoothstep(0.0, fw.x + 0.01, min(f.x, 1.0 - f.x) - 0.035)) * 0.6 * detail * (1.0 - mask));   // piers
  }

  // ---- balcony front
  if (balc > 0.5) {
    float bm = boxMask(f, vec2(0.05, 0.02), vec2(0.95, 0.40), fw * 0.75 + 0.004);
    float glazed = step(0.5, hb);                 // newer blocks: glass balustrades / enclosed balconies
    vec3 bc = mix(wall * 1.12 + 0.02, mix(glassCol * 0.5, skyRef, 0.35), glazed * 0.8);
    float rail = step(0.5, fract(u / 0.14)) * (1.0 - glazed) * fine * step(0.5, hb2) * step(0.10, f.y);
    bc *= 1.0 - 0.25 * rail;
    bc = mix(bc, wall * 1.2 + 0.03, (1.0 - smoothstep(0.0, fw.y + 0.01, abs(f.y - 0.40) - 0.012)) * fine);       // handrail
    float slab = 1.0 - smoothstep(0.0, fw.y + 0.008, f.y - 0.03);
    col = mix(col, bc, bm * detail);
    col = mix(col, wall * 0.55, slab * bm * detail);
    mask *= 1.0 - bm * 0.999; emis *= 1.0 - bm;
    // shade under the slab above
    float under = smoothstep(0.86, 0.99, f.y) * lit * clamp(sunV * 2.5, 0.0, 1.0);
    occ = min(occ, mix(1.0, 0.5, under * detail));
  }
  // ---- air-conditioner condensers bracketed under the windows
  if (ac && !ground && fine > 0.01 && balc < 0.5 && r2 > 0.52) {
    vec2 c0 = vec2(mix(0.30, 0.70, fract(r1 * 5.3)), wlo.y - 0.13);
    vec2 hs = vec2(0.40 / bayW, 0.27 / fh);
    float unit = rectMask(f, c0, hs, fw.x * 0.9 + 0.003);
    float shd = rectMask(f, c0 + vec2(-sign(sunU) * 0.012, -0.05) * step(0.02, ndl), hs, fw.x * 0.9 + 0.003);
    col *= 1.0 - 0.35 * shd * (1.0 - unit) * fine * lit;
    vec2 gp = (f - c0) / hs;
    vec3 uc = vec3(0.70, 0.71, 0.70) * (0.80 + 0.20 * step(0.55, length(gp * vec2(0.7, 1.0))));
    col = mix(col, uc, unit * fine);
    mask *= 1.0 - unit * fine;
  }
  // ---- shop signs above the ground-floor fronts
  if (ground && shops && st != ST_OFFICE) {
    float sb = hash12(vec2(cell.x, seed * 3.3 + 9.0));
    float sign = boxMask(f, vec2(0.05, 0.78), vec2(0.95, 0.96), fw * 0.75 + 0.004) * step(sb, 0.72);
    vec3 sc = sb < 0.22 ? vec3(0.55, 0.06, 0.04) : sb < 0.36 ? vec3(0.06, 0.20, 0.45) : sb < 0.48 ? vec3(0.62, 0.42, 0.05) : sb < 0.58 ? vec3(0.06, 0.32, 0.16) : vec3(0.70, 0.69, 0.66);
    float glyph = step(0.5, hash12(floor(vec2(u / 0.55, 1.0)) + cell.x)) * boxMask(f, vec2(0.14, 0.82), vec2(0.86, 0.92), fw + 0.004);
    sc = mix(sc, vec3(0.86, 0.84, 0.78), glyph * fine * 0.8);
    col = mix(col, sc, sign * detail);
    s.emissive += sc * sign * detail * lights * 1.6;
    mask *= 1.0 - sign;
  }
  // ---- big signboards / screens on shopping centres
  if (signs && !ground) {
    vec2 q = vec2(u / 21.0, (y - 5.2) / max(H - 6.4, 4.0));
    vec2 id = floor(q), ff = fract(q);
    float rs = hash12(id + seed * 2.3);
    float board = boxMask(ff, vec2(0.16, 0.22), vec2(0.84, 0.80), vec2(fwidth(q.x), fwidth(q.y)) + 0.004) * step(rs, 0.30) * step(5.2, y) * step(y, H - 1.2);
    vec3 bc = rs < 0.10 ? vec3(0.50, 0.05, 0.05) : rs < 0.2 ? vec3(0.05, 0.14, 0.38) : rs < 0.29 ? vec3(0.60, 0.58, 0.54) : vec3(0.08, 0.09, 0.10);
    col = mix(col, bc, board);
    s.emissive += (rs < 0.29 ? bc : vec3(0.35, 0.55, 0.85) * (0.5 + 0.5 * vnoise(vec2(u, y) * 0.6 + uTimeNight.x * 0.4))) * board * lights * 1.8;
    if (kind == 3) { mask = 0.0; cover = 0.0; emis = vec3(0.0); }
  }
  // ---- plinth and coping
  if (kind != 1 && kind != 4) {
    float pl = 1.0 - smoothstep(0.75, 0.9, y);
    col = mix(col, col * 0.78, pl * (1.0 - mask) * step(8.0, H));
    float cap = smoothstep(H - 0.75, H - 0.65, y);
    float capLine = smoothstep(H - 1.0, H - 0.9, y) * (1.0 - cap);
    col = mix(col, frameCol * 1.03, cap * (1.0 - smoothstep(0.3, 1.2, fwidth(y))));
    col *= 1.0 - 0.22 * capLine * (1.0 - smoothstep(0.1, 0.5, fwidth(y)));
    mask *= 1.0 - cap;
  }

  vec3 avg = mix(wall, glassDay, cover);
  s.albedo = mix(avg, col, detail);
  float gl = mix(cover, mask, detail);
  s.glass = gl;
  s.gloss = gl * (0.55 + 0.45 * curtainK);
  s.spec = gl;
  s.emissive += emis * gl;
  s.refl = reflDay * gl;
  s.occ = occ;
  return s;
}

// ---- palace / temple timber walls: vermilion with column rhythm, painted beam band under the eaves, stone plinth
Surf hallWall(float pal, float seed) {
  Surf s = blank();
  float u = vFac.x, y = vFac.y, H = max(vFac.z, 1.0);
  float t = clamp(y / H, 0.0, 1.0);        // note: y is measured from the building base, platform included
  vec3 red = vec3(0.40, 0.050, 0.032);
  vec3 col = red;
  float bay = u / 4.2;
  float fb = fract(bay);
  float fw = fwidth(bay);
  float column = 1.0 - smoothstep(0.045, 0.045 + fw + 0.01, abs(fb - 0.5) - 0.44);
  // recessed lattice doors / windows between the columns (dark gold-brown)
  float door = boxMask(vec2(fb, t), vec2(0.14, 0.22), vec2(0.86, 0.74), vec2(fw, 0.01) + 0.004);
  col = mix(col, vec3(0.20, 0.085, 0.045), door * 0.85);
  col = mix(col, vec3(0.30, 0.035, 0.025), column * 0.6);
  // painted beams: blue-green band with gold flecks
  float band = smoothstep(0.80, 0.83, t);
  vec3 beam = mix(vec3(0.05, 0.22, 0.30), vec3(0.07, 0.30, 0.20), step(0.5, fract(bay * 2.0)));
  beam = mix(beam, vec3(0.62, 0.43, 0.10), step(0.86, fract(bay * 6.0 + 0.3)) * 0.8);
  col = mix(col, beam, band);
  // night: warm lantern glow behind the lattice
  s.emissive = vec3(1.0, 0.55, 0.22) * door * 0.55 * uTimeNight.z * step(0.35, hash12(vec2(floor(bay), seed)));
  s.albedo = col;
  return s;
}

void main() {
  int st = int(vInfo.x + 0.5);
  float pal = vInfo.y, seed = vInfo.z;
  int part = int(vInfo.w + 0.5);
  vec3 nv = normalize(cross(dFdx(vView), dFdy(vView)));
  vec3 n = normalize(transpose(mat3(viewMatrix)) * nv);
  vec3 V = normalize(cameraPosition - vWorld);
  float y = vFac.y;
  bool up = n.y > 0.42;
  Surf s = blank();
  float ao = 1.0;

  if (part == P_TILE || part == P_PITCH || (part == P_BODY && up && (st == ST_COURT))) {
    // tiled roofs: ribs run down the slope
    vec3 base;
    float glaze = 0.0;
    if (part == P_TILE) { base = GLAZED[int(mod(pal, 4.0))]; glaze = pal < 2.5 ? 1.0 : 0.25; }
    else if (st == ST_RESI) base = RESI_PITCH[int(mod(pal, 4.0))];
    else if (st == ST_IND) base = IND_ROOF[int(mod(pal + seed * 5.0, 8.0))];
    else if (st == ST_VILLAGE && pal > 127.5) base = VILLAGE_ROOF[int(mod(seed * 3.0 + pal, 6.0))];      // suburban villages: red, blue-steel and grey roofs
    else base = GREY_TILE[int(mod(seed, 4.0))];                                                           // the old city stays grey
    vec2 down = normalize(n.xz + vec2(1e-5));
    float across = dot(vWorld.xz, vec2(-down.y, down.x));
    float rib = across / (part == P_TILE ? 0.62 : 0.5);
    float fwr = fwidth(rib);
    float ribs = mix(0.5, smoothstep(0.0, 0.5, abs(fract(rib) - 0.5) * 2.0), 1.0 - smoothstep(0.25, 0.8, fwr));
    base *= 0.80 + 0.30 * ribs;
    base *= 0.94 + 0.12 * fract(seed * 0.37);
    s.albedo = base;
    s.gloss = glaze * 0.75; s.spec = glaze * 0.5 + 0.06;
  } else if (part == P_STONE) {
    s.albedo = vec3(0.74, 0.71, 0.64) * (0.94 + 0.08 * fbm2(vWorld.xz * 0.6));
    if (!up) { float bal = fract(vFac.x / 1.6); s.albedo *= 0.9 + 0.1 * step(0.25, bal); }
  } else if (part == P_HALL) {
    if (up) s.albedo = GLAZED[int(mod(pal, 4.0))] * 0.9;
    else s = hallWall(pal, seed);
  } else if (part == P_TRIM) {
    s.albedo = GLAZED[int(mod(pal, 4.0))] * 0.72; s.gloss = 0.4; s.spec = 0.3;
  } else if (part == P_GOLD) {
    s.albedo = vec3(0.83, 0.56, 0.12); s.gloss = 0.9; s.spec = 0.9;
  } else if (part == P_MAST) {
    s.albedo = mix(vec3(0.72, 0.73, 0.74), vec3(0.62, 0.10, 0.08), step(0.5, fract(y / 9.0)) * step(0.75, fract(seed * 0.37)));
    s.emissive = vec3(1.0, 0.08, 0.04) * 6.0 * uTimeNight.z * step(vFac.z + 0.0, 1e9) * smoothstep(0.0, 1.0, sin(uTimeNight.x * 2.4 + seed)) * step(0.9, fract(y / 9.0 + 0.05));
  } else if (part == P_PLANT) {
    // lift overruns, stair heads and plant rooms: walls in the building's own render, a door or a louvre band, dark felt roof
    bool resi = st == ST_RESI || st == ST_VILLA;
    vec3 wc = resi ? RESI_WALL[int(mod(pal, 8.0))] * 0.90 : vec3(0.56, 0.56, 0.55);
    s.albedo = up ? vec3(0.27, 0.27, 0.28) : wc;
    s.albedo *= 0.92 + 0.1 * fract(seed * 0.71);
    if (!up) {
      float fwu = fwidth(vFac.x) + 0.01;
      if (resi || vFac.z < 3.4) {
        float door = (1.0 - smoothstep(0.45, 0.45 + fwu, abs(vFac.x - 1.3))) * (1.0 - smoothstep(2.0, 2.0 + fwu, y));
        s.albedo = mix(s.albedo, vec3(0.20, 0.23, 0.26), door * 0.9 * (1.0 - smoothstep(0.1, 0.5, fwu)));
      } else {
        float lv = step(0.5, fract(vWorld.y / 0.22)) * step(0.3, fract(vFac.x / 3.1)) * (1.0 - smoothstep(0.05, 0.3, fwidth(vWorld.y / 0.22))); s.albedo *= 1.0 - 0.22 * lv;
      }
      s.albedo *= 1.0 - 0.16 * smoothstep(vFac.z - 0.22, vFac.z - 0.12, y) * step(1.5, vFac.z);      // shadow line under the coping
    }
  } else if (part == P_UNIT) {
    // condensers, cooling towers, ducts, vent shafts: galvanised boxes with fan grilles on top
    s.albedo = mix(vec3(0.47, 0.49, 0.51), vec3(0.64, 0.65, 0.66), fract(seed * 0.71 + pal * 0.13));
    if (vFac.z < 1.3 && (st == ST_RESI || st == ST_VILLA)) s.albedo = mix(RESI_WALL[int(mod(pal, 8.0))] * 0.78, vec3(0.42), 0.35);     // masonry vent stacks
    else if (up) { vec2 g = fract(vWorld.xz / 1.1) - 0.5; float fan = smoothstep(0.42, 0.36, length(g)) * (1.0 - smoothstep(0.05, 0.4, fwidth(vWorld.x / 1.1))); s.albedo = mix(s.albedo, vec3(0.10, 0.11, 0.12), fan * 0.8); }
    else { float lv = step(0.5, fract(vWorld.y / 0.16)) * (1.0 - smoothstep(0.05, 0.3, fwidth(vWorld.y / 0.16))); s.albedo *= 1.0 - 0.18 * lv; }
    s.spec = 0.25; s.gloss = 0.3;
  } else if (part == P_TANK) {
    // sectional water tank: pressed panels a metre square on a steel frame
    vec2 q = up ? vWorld.xz : vec2(vFac.x, y - 0.35);
    vec2 g = abs(fract(q) - 0.5);
    float fwq = max(fwidth(q.x), fwidth(q.y));
    float joint = smoothstep(0.44, 0.47, max(g.x, g.y)) * (1.0 - smoothstep(0.08, 0.4, fwq));
    float boss = smoothstep(0.30, 0.10, length(g)) * (1.0 - smoothstep(0.05, 0.25, fwq));
    s.albedo = mix(vec3(0.58, 0.60, 0.62), vec3(0.47, 0.53, 0.58), step(0.7, fract(seed * 0.37)));
    s.albedo *= (1.0 - 0.30 * joint) * (1.0 + 0.07 * boss);
    if (!up && y < 0.35) s.albedo = vec3(0.16, 0.17, 0.18);
    s.spec = 0.45; s.gloss = 0.45;
  } else if (part == P_SIGN) {
    // roof-top hoarding: a coloured face on a dark frame; lit after dark
    float r = fract(seed * 0.618 + pal * 0.271);
    vec3 face = r < 0.3 ? vec3(0.55, 0.05, 0.04) : r < 0.55 ? vec3(0.05, 0.16, 0.42) : r < 0.75 ? vec3(0.62, 0.60, 0.56) : vec3(0.60, 0.40, 0.05);
    float band = step(0.25, fract(vFac.x / 1.9)) * step(0.3, fract(vWorld.y / 2.6)) * (1.0 - smoothstep(0.1, 0.5, fwidth(vFac.x / 1.9)));
    s.albedo = up ? vec3(0.12) : mix(face, vec3(0.86, 0.84, 0.78), band * 0.55);
    if (!up) s.emissive = s.albedo * uTimeNight.z * 2.2;
  } else if (part == P_MASS) {
    // far stand-in for many small houses: break the block into a patchwork of little roofs and courtyards
    vec3 base = roofSurface(st, pal, seed, vWorld, 6.0).albedo;
    if (up) {
      vec2 q = vWorld.xz / 9.0;
      vec2 id = floor(q);
      float r = hash12(id);
      vec2 f = abs(fract(q) - 0.5);
      float fwq = max(fwidth(q.x), fwidth(q.y));
      float gap = smoothstep(0.40, 0.47, max(f.x, f.y)) * (1.0 - smoothstep(0.2, 0.9, fwq));
      vec3 c = base * (0.82 + 0.36 * r);
      if (st == ST_VILLAGE) c = mix(c, VILLAGE_ROOF[int(mod(r * 17.0, 6.0))], 0.75);
      if (st == ST_COURT) c = mix(c, vec3(0.20, 0.27, 0.13), step(0.86, r) * 0.7);      // courtyard trees
      s.albedo = mix(c, c * 0.55, gap);
    } else {
      s.albedo = (st == ST_COURT ? vec3(0.27, 0.26, 0.25) : st == ST_IMPERIAL || st == ST_TEMPLE ? vec3(0.36, 0.05, 0.03) : VILLAGE_WALL[int(mod(seed, 4.0))]) * 0.95;
    }
  } else {
    // generic body
    if (up) {
      s = roofSurface(st, pal, seed, vWorld, vFac.z);
      if (st == ST_BIGROOF || st == ST_CANOPY) { s.gloss = 0.35; s.spec = 0.2; }
      if (st == ST_IND) { float cr = fract(dot(vWorld.xz, vec2(0.7071)) / 1.1); s.albedo *= 0.93 + 0.07 * step(0.5, cr) * (1.0 - smoothstep(0.3, 0.9, fwidth(dot(vWorld.xz, vec2(0.7071)) / 1.1))); s.spec = 0.15; s.gloss = 0.3; }
    } else {
      s = wallSurface(st, pal, seed, n, V);
    }
  }

  // the inner face of a parapet (seen through the open top of a recessed roof) is plain render
  if (!gl_FrontFacing && part == P_BODY) { s.glass = 0.0; s.refl = vec3(0.0); s.emissive = vec3(0.0); s.spec = 0.0; s.occ = 1.0; }
  if (uSnow > 0.0 && n.y > 0.2) {
    // glazed and tiled slopes shed part of their snow, most of all where they face the sun (south)
    s.albedo = snowOn(s.albedo, n, vWorld, part == P_TILE || part == P_PITCH ? 0.50 - 0.28 * max(n.z, 0.0) : 1.0);
    s.spec *= 1.0 - 0.8 * uSnow; s.refl *= 1.0 - uSnow;
  }
  // ---- lighting
  float sh = sunShadow(vWorld, n) * cloudShadow(vWorld);
  // grounding: walls darken towards the street, roofs pick up a little occlusion from neighbours
  float gao = groundAO(vWorld);
  if (!up) ao = mix(0.50, 1.0, smoothstep(-1.0, 16.0, y)) * (1.0 - 0.28 * gao * (1.0 - smoothstep(10.0, 60.0, y)));
  else ao = 1.0 - 0.10 * gao * (1.0 - smoothstep(6.0, 40.0, y));
  sh *= s.occ;
  vec3 col = shade(s.albedo, n, sh, ao);
  // specular: sun glint + sky sheen on glass and glazed tile
  if (s.spec > 0.0) {
    vec3 nn = n;
    if (s.glass > 0.0) nn = normalize(n + (hash32(floor(vec2(vFac.x / 1.5, vFac.y / 3.3)) + seed) - 0.5) * 0.045);
    vec3 Hh = normalize(uSunDir + V);
    float nh = max(dot(nn, Hh), 0.0);
    float pw = mix(24.0, 420.0, s.gloss);
    float spec = pow(nh, pw) * (pw + 8.0) / 25.0;
    float fr = 0.04 + 0.96 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
    col += uSunColor * spec * s.spec * sh * mix(0.25, 1.0, fr) * max(dot(n, uSunDir), 0.0) * 0.55;
  }
  // mirror-like sky reflection on glazing (not modulated by the local diffuse light)
  col += s.refl * (0.35 + 0.65 * ao);
  // matte surfaces still gain a sheen when seen against a low sun
  col += sunSheen(n, V, sh, up ? 0.5 : 0.22) * s.albedo * (1.0 - s.glass);
  col += s.emissive;
  col = applyFog(col, vWorld, cameraPosition);
  fragColor = vec4(col, 1.0);
}`;

const DEPTH_VERT = /* glsl */`${PRECISION}
in vec4 aPos;
in vec2 aH;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uGrow;
void main() {
  vec3 p = aPos.xyz;
  float above = p.y - aH.y;
  p.y = aH.y + above * (above > 0.0 ? uGrow : 1.0);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
}`;
const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor;
void main() { fragColor = vec4(1.0); }`;

// occupancy for the baked ground-AO map (top-down orthographic render)
const OCC_FRAG = /* glsl */`${PRECISION}
in float vHeight;
out vec4 fragColor;
void main() { fragColor = vec4(clamp(vHeight / 45.0, 0.12, 1.0), 1.0, 0.0, 1.0); }   // r: height-weighted (contact AO), g: plain coverage (urban-ness)`;
const OCC_VERT = /* glsl */`${PRECISION}
in vec4 aPos;
in vec2 aH;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out float vHeight;
void main() {
  vHeight = aH.x * 0.1;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(aPos.xyz, 1.0);
}`;

export function createBuildingMaterials(env, quality) {
  const shared = { uDetail: { value: 1 } };
  const make = (grow, side = THREE.FrontSide) => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...env.uniforms, ...shared, uGrow: grow },
    side,
  });
  const makeDepth = (grow) => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, uniforms: { uGrow: grow }, side: THREE.DoubleSide, colorWrite: false,
  });
  const occupancy = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: OCC_VERT, fragmentShader: OCC_FRAG, side: THREE.DoubleSide, depthTest: true, depthWrite: true });
  return { make, makeDepth, occupancy, shared };
}
