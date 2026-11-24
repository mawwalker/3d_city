// Phase 3 Photorealistic Chongqing 3D Building Facade & Architectural Kit Shader (WebGL 2 deferred G-buffer).
// Works hand-in-hand with macro-grade true-3D geometry from buildingGeom.js, facadeKit.js, and roofGeom.js:
//   - Samples `@data-pipe`'s 16-room 2048x2048 `tInteriorsArr` (`sampler2DArray`, zero mipmap bleeding!) via canonical
//     1-point perspective room-box raycasting (`0..5` residential, `6..10` CBD offices, `11..15` Chongqing shopfronts!)
//   - Physical Fresnel grazing-angle sky reflections + per-pane micro-tilt distortion + varied curtains & Venetian blinds
//   - Deep crevice & contact AO beneath overhangs, cornices, window eyebrows, sills & damp sidewalk splash-zones,
//     plus Chongqing humid mineral moss & rain-drip streaks beneath sills & AC units
//   - Dedicated high-contrast PBR shaders for all 29 architectural surface KINDs (0..28): walls, podiums, sandstone
//     retaining plinths, Bayu timber & carved fretwork, AC fan grilles, striped awnings, bloom-safe backlit Chongqing
//     shop lightboxes (`tSigns`) & vertical neon blade signs (`tSignsVert`), typographic LED billboards, PVC drainpipes,
//     brushed stainless security cages (`防盗网`), balcony foliage planters, hanging laundry, pier wall sconces, and brackets!

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { gbufferMaterial } from '../engine/materials.js';

const VERT = /* glsl */`${PRECISION}
in vec4 aPos;
in vec4 aNrm;
in vec4 aBld;
in vec4 aEdge;
in vec4 aFlag;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
out vec3 vWorld;
out vec3 vView;
out vec3 vNormal;
out vec2 vUv;
out vec2 vTex;
flat out vec4 vBld;
flat out vec4 vFlag;
flat out vec4 vEdge;
flat out float vKind;
void main() {
  vec3 p = aPos.xyz;
  vUv = vec2(aPos.w, p.y);
  vNormal = aNrm.xyz * (1.0 / 127.0);
  vKind = aNrm.w;
  vBld = aBld;
  vFlag = aFlag;
  vEdge = aEdge;
  vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
  vTex = p.xz + mod(modelMatrix[3].xz, 8400.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = (lib) => /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
${lib.glsl}

// Safe fallbacks if any Chongqing-extended PBR layer is absent from a minimal test materials.json
#ifndef L_SANDSTONE
#define L_SANDSTONE L_GRANITE
#define S_SANDSTONE S_GRANITE
#define C_SANDSTONE C_GRANITE
#endif
#ifndef L_CLIFF_ROCK
#define L_CLIFF_ROCK L_SANDSTONE
#define S_CLIFF_ROCK S_SANDSTONE
#define C_CLIFF_ROCK C_SANDSTONE
#endif
#ifndef L_MOSAIC_TILE
#define L_MOSAIC_TILE L_TILES_WHITE
#define S_MOSAIC_TILE (S_TILES_WHITE * 2.2)
#define C_MOSAIC_TILE C_TILES_WHITE
#endif
#ifndef L_BAYU_TILE
#define L_BAYU_TILE L_ROOF_GREY
#define S_BAYU_TILE S_ROOF_GREY
#define C_BAYU_TILE C_ROOF_GREY
#endif
#ifndef L_BAYU_TIMBER
#define L_BAYU_TIMBER L_PLANKS
#define S_BAYU_TIMBER S_PLANKS
#define C_BAYU_TIMBER C_PLANKS
#endif
#ifndef L_LIMESTONE
#define L_LIMESTONE L_GRANITE
#define S_LIMESTONE S_GRANITE
#define C_LIMESTONE C_GRANITE
#endif
#ifndef L_CURTAIN_GLASS
#define L_CURTAIN_GLASS L_METAL_PANEL
#define S_CURTAIN_GLASS S_METAL_PANEL
#define C_CURTAIN_GLASS C_METAL_PANEL
#endif
#ifndef L_RED_LACQUER
#define L_RED_LACQUER L_PAINTED_METAL
#define S_RED_LACQUER S_PAINTED_METAL
#define C_RED_LACQUER C_PAINTED_METAL
#endif

uniform mat4 viewMatrix;
uniform vec3 uLightDir;
uniform vec4 uNight;            // x: night, y: city lights 0..1, z: wetness, w: frame
uniform float uTime;
#ifdef HAS_SIGNS
uniform sampler2DArray tSigns;
uniform vec2 uSigns;
#endif
#ifdef HAS_SIGNS_VERT
uniform sampler2DArray tSignsVert;
uniform vec2 uSignsVert;
#endif
#ifdef HAS_INTERIORS
uniform sampler2DArray tInteriorsArr;
uniform vec4 uInteriors;        // cols, rows, count, hasInteriors (1.0 when loaded)
#endif

in vec3 vWorld;
in vec3 vView;
in vec3 vNormal;
in vec2 vUv;
in vec2 vTex;
flat in vec4 vBld;
flat in vec4 vFlag;
flat in vec4 vEdge;
flat in float vKind;

// ---- 20 Chongqing architectural archetypes (keep 100% synced with styles.js)
const int ST_GENERIC = 0;
const int ST_CBD_SUPERTALL = 1;
const int ST_OFFICE_GLASS = 2;
const int ST_OFFICE_GRID = 3;
const int ST_RESI_MODERN = 4;
const int ST_RESI_OLD_HIGHRISE = 5;
const int ST_RESI_WALKUP = 6;
const int ST_BAYU_VERNACULAR = 7;
const int ST_HISTORIC_MASONRY = 8;
const int ST_COMMERCIAL_MALL = 9;
const int ST_HOTEL = 10;
const int ST_CIVIC = 11;
const int ST_CAMPUS = 12;
const int ST_INDUSTRIAL = 13;
const int ST_TEMPLE = 14;
const int ST_BIGROOF = 15;
const int ST_CANOPY = 16;
const int ST_TANK = 17;
const int ST_PARKING = 18;
const int ST_CONSTRUCTION = 19;
const int ST_LANDMARK_GLASS = 20;

struct Facade {
  float bay;
  vec2 win;
  float sill;
  float depth;
  float frame;
  vec2 panes;
  float layer, scale;
  vec3 mean, tint;
  vec3 glass;
  float refl;
  float curtain;
  float margin;
  vec3 frameCol;
  float shop;
  float office;
  float humid;
};

vec3 pick4(float h, vec3 a, vec3 b, vec3 c, vec3 d) {
  return h < 0.25 ? a : (h < 0.5 ? b : (h < 0.75 ? c : d));
}

Facade facadeFor(int style, float pal, float seed, bool south) {
  float h = hash11(pal * 0.731 + 1.7);
  float h2 = hash11(pal * 1.37 + 9.1);
  float h3 = hash11(seed * 0.513 + pal * 0.11);
  float jitter = 0.89 + 0.22 * hash11(seed * 2.17 + 4.3);

  Facade F;
  F.bay = 3.4; F.win = vec2(0.54, 0.52); F.sill = 0.28; F.depth = 0.24; F.frame = 0.055; F.panes = vec2(2.0, 1.0);
  F.layer = L_PLASTER_STAINED; F.scale = S_PLASTER_STAINED; F.mean = C_PLASTER_STAINED;
  F.tint = vec3(0.54, 0.51, 0.46) * jitter;
  F.glass = vec3(0.46, 0.56, 0.58); F.refl = 0.74; F.curtain = 0.0; F.margin = 0.55;
  F.frameCol = vec3(0.24, 0.26, 0.28); F.shop = 1.0; F.office = 0.0; F.humid = 1.0;

  if (style == ST_CBD_SUPERTALL) {
    F.curtain = 1.0; F.bay = 3.6; F.depth = 0.09; F.frame = 0.065; F.margin = 0.0; F.office = 1.0; F.panes = vec2(3.0, 1.0);
    F.glass = pick4(h, vec3(0.18, 0.34, 0.48), vec3(0.20, 0.40, 0.44), vec3(0.32, 0.38, 0.44), vec3(0.42, 0.36, 0.28));
    F.refl = 0.94 + 0.06 * h3;
    F.frameCol = h2 > 0.45 ? vec3(0.46, 0.49, 0.53) : vec3(0.14, 0.16, 0.18);
    F.layer = L_CURTAIN_GLASS; F.scale = S_CURTAIN_GLASS; F.mean = C_CURTAIN_GLASS; F.tint = vec3(0.34, 0.36, 0.39);
    F.humid = 0.35;
  } else if (style == ST_OFFICE_GLASS) {
    F.curtain = 1.0; F.bay = 3.2; F.depth = 0.08; F.frame = 0.06; F.margin = 0.0; F.office = 1.0; F.panes = vec2(2.0, 1.0);
    F.glass = pick4(h, vec3(0.22, 0.38, 0.48), vec3(0.26, 0.44, 0.42), vec3(0.36, 0.40, 0.44), vec3(0.30, 0.35, 0.42));
    F.refl = 0.90 + 0.08 * h3;
    F.frameCol = h2 > 0.5 ? vec3(0.42, 0.44, 0.46) : vec3(0.16, 0.17, 0.19);
    F.layer = L_METAL_PANEL; F.scale = S_METAL_PANEL; F.mean = C_METAL_PANEL; F.tint = vec3(0.38, 0.40, 0.42);
    F.humid = 0.40;
  } else if (style == ST_OFFICE_GRID) {
    F.bay = 3.2; F.win = vec2(0.68, 0.54); F.sill = 0.26; F.depth = 0.26; F.panes = vec2(2.0, 1.0); F.margin = 0.55; F.office = 1.0;
    F.layer = h2 > 0.45 ? L_GRANITE : L_LIMESTONE;
    F.scale = h2 > 0.45 ? S_GRANITE : S_LIMESTONE;
    F.mean = h2 > 0.45 ? C_GRANITE : C_LIMESTONE;
    F.tint = pick4(h, vec3(0.48, 0.46, 0.43), vec3(0.58, 0.55, 0.50), vec3(0.40, 0.37, 0.34), vec3(0.52, 0.53, 0.56)) * jitter;
    F.frameCol = vec3(0.20, 0.21, 0.23);
    F.glass = pick4(h3, vec3(0.28, 0.42, 0.50), vec3(0.34, 0.46, 0.44), vec3(0.40, 0.44, 0.48), vec3(0.24, 0.38, 0.46));
    F.refl = 0.82; F.humid = 0.78;
  } else if (style == ST_RESI_MODERN) {
    F.bay = 3.6; F.win = south ? vec2(0.64, 0.56) : vec2(0.46, 0.48); F.sill = 0.26; F.depth = 0.26; F.margin = 0.48;
    F.tint = pick4(h, vec3(0.60, 0.54, 0.44), vec3(0.64, 0.62, 0.57), vec3(0.50, 0.44, 0.38), vec3(0.52, 0.54, 0.56)) * jitter;
    if (h2 > 0.55) { F.layer = L_LIMESTONE; F.scale = S_LIMESTONE * 1.2; F.mean = C_LIMESTONE; }
    else if (h2 > 0.25) { F.layer = L_PLASTER; F.scale = S_PLASTER; F.mean = C_PLASTER; }
    else { F.layer = L_TILES_WHITE; F.scale = S_TILES_WHITE * 2.0; F.mean = C_TILES_WHITE; }
    F.frameCol = vec3(0.20, 0.19, 0.18);
    F.glass = vec3(0.42, 0.54, 0.56); F.refl = 0.80; F.humid = 0.90;
  } else if (style == ST_RESI_OLD_HIGHRISE) {
    F.bay = 3.3; F.win = south ? vec2(0.58, 0.52) : vec2(0.38, 0.44); F.sill = 0.28; F.depth = 0.22; F.margin = 0.45;
    F.layer = h2 > 0.25 ? L_MOSAIC_TILE : L_PLASTER_STAINED;
    F.scale = h2 > 0.25 ? S_MOSAIC_TILE : S_PLASTER_STAINED;
    F.mean = h2 > 0.25 ? C_MOSAIC_TILE : C_PLASTER_STAINED;
    F.tint = pick4(h, vec3(0.62, 0.58, 0.50), vec3(0.56, 0.42, 0.34), vec3(0.46, 0.50, 0.52), vec3(0.58, 0.54, 0.42)) * jitter;
    F.frameCol = h3 > 0.45 ? vec3(0.58, 0.60, 0.62) : vec3(0.22, 0.24, 0.26);
    F.glass = vec3(0.46, 0.54, 0.52); F.refl = 0.76; F.humid = 1.40;
  } else if (style == ST_RESI_WALKUP) {
    F.bay = 3.2; F.win = south ? vec2(0.54, 0.50) : vec2(0.36, 0.42); F.sill = 0.30; F.depth = 0.22; F.margin = 0.45;
    if (h2 > 0.52) { F.layer = L_MOSAIC_TILE; F.scale = S_MOSAIC_TILE * 1.1; F.mean = C_MOSAIC_TILE; }
    else if (h2 > 0.24) { F.layer = L_PEBBLEDASH; F.scale = S_PEBBLEDASH; F.mean = C_PEBBLEDASH; }
    else { F.layer = L_PLASTER_STAINED; F.scale = S_PLASTER_STAINED; F.mean = C_PLASTER_STAINED; }
    F.tint = pick4(h, vec3(0.58, 0.52, 0.42), vec3(0.54, 0.39, 0.31), vec3(0.52, 0.54, 0.50), vec3(0.60, 0.58, 0.52)) * jitter;
    F.frameCol = h3 > 0.5 ? vec3(0.58) : vec3(0.24, 0.27, 0.28);
    F.refl = 0.74; F.humid = 1.50;
  } else if (style == ST_BAYU_VERNACULAR) {
    F.bay = 3.4; F.win = vec2(0.54, 0.52); F.sill = 0.26; F.depth = 0.22; F.panes = vec2(3.0, 2.0); F.margin = 0.38;
    if (h > 0.55) { F.layer = L_PLASTER_STAINED; F.scale = S_PLASTER_STAINED; F.mean = C_PLASTER_STAINED; F.tint = vec3(0.66, 0.63, 0.57) * jitter; }
    else if (h > 0.25) { F.layer = L_BAYU_TIMBER; F.scale = S_BAYU_TIMBER; F.mean = C_BAYU_TIMBER; F.tint = vec3(0.24, 0.14, 0.09) * jitter; }
    else { F.layer = L_BRICK_GREY; F.scale = S_BRICK_GREY; F.mean = C_BRICK_GREY; F.tint = vec3(0.26, 0.27, 0.27) * jitter; }
    F.frameCol = vec3(0.18, 0.09, 0.06);
    F.glass = vec3(0.72, 0.66, 0.54); F.refl = 0.60; F.humid = 1.35;
  } else if (style == ST_HISTORIC_MASONRY) {
    F.bay = 3.4; F.win = vec2(0.44, 0.58); F.sill = 0.22; F.depth = 0.32; F.panes = vec2(2.0, 3.0); F.margin = 0.75;
    if (h2 > 0.55) { F.layer = L_SANDSTONE; F.scale = S_SANDSTONE; F.mean = C_SANDSTONE; F.tint = vec3(0.46, 0.41, 0.34) * jitter; }
    else if (h2 > 0.25) { F.layer = L_BRICK_RED; F.scale = S_BRICK_RED; F.mean = C_BRICK_RED; F.tint = vec3(0.36, 0.17, 0.12) * jitter; }
    else { F.layer = L_BRICK_GREY; F.scale = S_BRICK_GREY; F.mean = C_BRICK_GREY; F.tint = vec3(0.30, 0.30, 0.30) * jitter; }
    F.frameCol = vec3(0.15, 0.11, 0.08);
    F.glass = vec3(0.48, 0.52, 0.48); F.refl = 0.72; F.humid = 1.20;
  } else if (style == ST_COMMERCIAL_MALL) {
    F.bay = 4.6; F.win = vec2(0.74, 0.42); F.sill = 0.34; F.depth = 0.20; F.margin = 0.45; F.office = 1.0;
    F.layer = h2 > 0.5 ? L_METAL_PANEL : L_LIMESTONE;
    F.scale = h2 > 0.5 ? S_METAL_PANEL * 0.6 : S_LIMESTONE;
    F.mean = h2 > 0.5 ? C_METAL_PANEL : C_LIMESTONE;
    F.tint = pick4(h, vec3(0.56, 0.53, 0.48), vec3(0.36, 0.38, 0.42), vec3(0.60, 0.48, 0.36), vec3(0.46, 0.24, 0.20)) * jitter;
    F.frameCol = vec3(0.16, 0.17, 0.19); F.refl = 0.84; F.humid = 0.55;
  } else if (style == ST_HOTEL) {
    F.bay = 3.8; F.win = vec2(0.68, 0.54); F.sill = 0.24; F.depth = 0.26; F.margin = 0.55; F.office = 0.0;
    F.layer = h2 > 0.4 ? L_LIMESTONE : L_GRANITE;
    F.scale = h2 > 0.4 ? S_LIMESTONE : S_GRANITE;
    F.mean = h2 > 0.4 ? C_LIMESTONE : C_GRANITE;
    F.tint = pick4(h, vec3(0.60, 0.55, 0.47), vec3(0.52, 0.50, 0.48), vec3(0.44, 0.38, 0.32), vec3(0.58, 0.58, 0.56)) * jitter;
    F.frameCol = vec3(0.24, 0.21, 0.18); F.glass = vec3(0.40, 0.50, 0.54); F.refl = 0.84; F.humid = 0.65;
  } else if (style == ST_CIVIC) {
    F.bay = 3.6; F.win = vec2(0.58, 0.56); F.sill = 0.24; F.depth = 0.28; F.margin = 0.70; F.office = 1.0; F.shop = 0.0;
    F.layer = L_LIMESTONE; F.scale = S_LIMESTONE; F.mean = C_LIMESTONE;
    F.tint = pick4(h, vec3(0.62, 0.59, 0.53), vec3(0.55, 0.54, 0.52), vec3(0.58, 0.52, 0.44), vec3(0.48, 0.49, 0.50)) * jitter;
    F.frameCol = vec3(0.22, 0.22, 0.24); F.refl = 0.78; F.humid = 0.75;
  } else if (style == ST_CAMPUS) {
    F.bay = 3.5; F.win = vec2(0.72, 0.52); F.sill = 0.28; F.depth = 0.24; F.panes = vec2(3.0, 1.0); F.margin = 0.55; F.office = 1.0; F.shop = 0.0;
    F.layer = h2 > 0.5 ? L_TILES_WHITE : L_PLASTER;
    F.scale = h2 > 0.5 ? S_TILES_WHITE * 1.8 : S_PLASTER;
    F.mean = h2 > 0.5 ? C_TILES_WHITE : C_PLASTER;
    F.tint = pick4(h, vec3(0.66, 0.63, 0.58), vec3(0.58, 0.40, 0.32), vec3(0.62, 0.64, 0.66), vec3(0.62, 0.56, 0.46)) * jitter;
    F.frameCol = vec3(0.32, 0.34, 0.36); F.humid = 0.90;
  } else if (style == ST_INDUSTRIAL || style == ST_BIGROOF) {
    F.bay = 6.0; F.win = vec2(0.72, 0.18); F.sill = 0.68; F.depth = 0.12; F.panes = vec2(4.0, 1.0); F.shop = 0.0; F.office = 1.0;
    if (h > 0.35) { F.layer = L_CORRUGATED; F.scale = S_CORRUGATED; F.mean = C_CORRUGATED; F.tint = pick4(h2, vec3(0.52, 0.54, 0.56), vec3(0.30, 0.42, 0.54), vec3(0.56, 0.54, 0.48), vec3(0.46, 0.48, 0.46)); }
    else { F.layer = L_CONCRETE_PANEL; F.scale = S_CONCRETE_PANEL; F.mean = C_CONCRETE_PANEL; F.tint = vec3(0.42, 0.41, 0.39); }
    F.frameCol = vec3(0.22); F.humid = 1.15;
  } else if (style == ST_TEMPLE) {
    F.bay = 3.3; F.win = vec2(0.68, 0.58); F.sill = 0.22; F.depth = 0.18; F.panes = vec2(4.0, 4.0); F.margin = 0.4; F.shop = 0.0;
    F.layer = L_PLASTER; F.scale = S_PLASTER; F.mean = C_PLASTER;
    F.tint = vec3(0.70, 0.67, 0.60); F.frameCol = vec3(0.28, 0.07, 0.05); F.glass = vec3(0.82, 0.74, 0.56); F.humid = 0.95;
  } else if (style == ST_PARKING) {
    F.bay = 6.8; F.win = vec2(0.90, 0.50); F.sill = 0.36; F.depth = 0.55; F.frame = 0.0; F.shop = 0.0;
    F.layer = L_CONCRETE; F.scale = S_CONCRETE; F.mean = C_CONCRETE; F.tint = vec3(0.44, 0.43, 0.41); F.humid = 1.25;
  } else if (style == ST_LANDMARK_GLASS) {
    int k = int(pal + 0.5);
    F.curtain = 1.0; F.bay = 3.0; F.depth = 0.08; F.frame = 0.055; F.margin = 0.0; F.office = 1.0; F.shop = 0.0; F.panes = vec2(2.0, 1.0);
    F.glass = k == 0 ? vec3(0.36, 0.50, 0.56) : k == 1 ? vec3(0.20, 0.33, 0.46) : k == 2 ? vec3(0.42, 0.45, 0.46) : k == 3 ? vec3(0.10, 0.13, 0.16) : vec3(0.46, 0.40, 0.28);
    F.refl = 0.96; F.frameCol = vec3(0.36, 0.38, 0.40);
    F.layer = L_METAL_PANEL; F.scale = S_METAL_PANEL; F.mean = C_METAL_PANEL; F.tint = vec3(0.40, 0.41, 0.42); F.humid = 0.3;
  }
  return F;
}

// ---- Analytic deep window reveal raybox intersection: 0 wall, 1 reveal jamb/head/sill, 2 glazing plane
int recessHit(vec2 p, vec4 ap, float D, vec3 d, out vec2 q, out vec3 nT, out float dh) {
  q = p; nT = vec3(0.0, 0.0, 1.0); dh = 0.0;
  if (p.x < ap.x || p.x > ap.y || p.y < ap.z || p.y > ap.w) return 0;
  float tz = D / max(-d.z, 1e-3);
  float tx = d.x > 1e-5 ? (ap.y - p.x) / d.x : (d.x < -1e-5 ? (ap.x - p.x) / d.x : 1e9);
  float ty = d.y > 1e-5 ? (ap.w - p.y) / d.y : (d.y < -1e-5 ? (ap.z - p.y) / d.y : 1e9);
  float ts = min(tx, ty);
  if (ts < tz) {
    q = p + d.xy * ts;
    dh = ts * -d.z;
    nT = tx < ty ? vec3(-sign(d.x), 0.0, 0.0) : vec3(0.0, -sign(d.y), 0.0);
    return 1;
  }
  q = p + d.xy * tz;
  dh = D;
  return 2;
}

float recessSun(vec2 q, float dh, vec4 ap, vec3 Lt) {
  if (Lt.z < 0.02) return 1.0;
  vec2 e = q + Lt.xy * (dh / Lt.z);
  float m = min(min(e.x - ap.x, ap.y - e.x), min(e.y - ap.z, ap.w - e.y));
  return smoothstep(-0.014, 0.024, m);
}

// ---- Canonical 1-Point Perspective Photorealistic Interior Box-Parallax (samples 16-room tInteriorsArr!)
// Cell indices locked by #56/#57: 0..5 residential, 6..10 CBD offices, 11..15 Chongqing ground-floor shopfronts.
vec3 interiorParallax(vec2 g, vec2 size, vec3 d, float rs, int category, int style, float lit, out vec3 glow) {
  // Map window glazing coordinate g in [0, size] to canonical room window plane pos in [-1, 1] x [-1, 1]
  vec2 uv01 = clamp(g / max(size, vec2(0.05)), 0.0, 1.0);
  vec2 pos = uv01 * 2.0 - 1.0;

  // Vary perceived room depth per cell so adjacent windows never look identical
  float depthScale = 0.85 + 0.45 * hash11(rs + 0.37);
  vec3 rd = vec3(d.x * 1.15 / depthScale, d.y * 1.15 / depthScale, min(d.z, -0.02));
  float tx = rd.x > 1e-5 ? (1.0 - pos.x) / rd.x : (rd.x < -1e-5 ? (-1.0 - pos.x) / rd.x : 1e9);
  float ty = rd.y > 1e-5 ? (1.0 - pos.y) / rd.y : (rd.y < -1e-5 ? (-1.0 - pos.y) / rd.y : 1e9);
  float tz = -1.0 / min(rd.z, -1e-4);
  float tHit = min(min(tx, ty), tz);
  vec3 hit = vec3(pos, 0.0) + rd * tHit; // hit.x, hit.y in [-1, 1], hit.z in [-1, 0]

  // Random horizontal flip for 2x room variety on residential/office rooms;
  // NEVER flip ground-floor shopfronts (cells 11..15 contain readable Chinese signage!)
  float flipX = category == 2 ? 0.0 : step(0.5, hash11(rs + 13.7));
  float hx = mix(hit.x, -hit.x, flipX);
  float hy = hit.y;
  float hz = clamp(hit.z, -1.0, 0.0);

  // Pick photorealistic room layer index (0..15) tuned to Chongqing building archetype!
  float rPick = hash11(rs + 1.93);
  float roomIdx = 0.0;
  if (category == 2) {
    // Chongqing ground-floor shopfronts (11..15: hotpot, convenience, teahouse, bakery/pharm, cafe/boutique)
    if (style == ST_BAYU_VERNACULAR || style == ST_RESI_WALKUP || style == ST_RESI_OLD_HIGHRISE) {
      roomIdx = rPick < 0.34 ? 11.0 : (rPick < 0.62 ? 13.0 : (rPick < 0.82 ? 12.0 : 14.0));
    } else if (style == ST_COMMERCIAL_MALL || style == ST_CBD_SUPERTALL || style == ST_OFFICE_GLASS || style == ST_HOTEL) {
      roomIdx = rPick < 0.38 ? 15.0 : (rPick < 0.68 ? 14.0 : (rPick < 0.86 ? 12.0 : 11.0));
    } else {
      roomIdx = 11.0 + floor(rPick * 5.0);
    }
  } else if (category == 1) {
    // Modern CBD offices (6..10)
    roomIdx = 6.0 + floor(rPick * 5.0);
  } else {
    // Residential rooms (0..5: warm living, modern living, bedroom, study, old apt, kitchen/dining)
    if (style == ST_RESI_OLD_HIGHRISE || style == ST_RESI_WALKUP) {
      roomIdx = rPick < 0.35 ? 4.0 : floor(rPick * 6.0);
    } else {
      roomIdx = floor(rPick * 6.0);
    }
  }

  vec3 roomCol;
  float depthAtten = 0.62 + 0.38 * (1.0 + hz * 0.65);

#ifdef HAS_INTERIORS
  if (uInteriors.w > 0.5) {
    float s = 1.0 / (1.0 - hz);
    vec2 cellUV = vec2(0.5 + 0.5 * hx * s, 0.5 - 0.5 * hy * s);
    roomCol = texture(tInteriorsArr, vec3(clamp(cellUV, 0.003, 0.997), min(roomIdx, max(uInteriors.z - 1.0, 0.0)))).rgb;
    // Subtle per-room warm/cool white-balance shift so neighboring apartments look naturally diverse
    vec3 tintShift = category == 1
      ? mix(vec3(0.92, 0.97, 1.06), vec3(1.06, 0.98, 0.88), hash11(rs + 6.1))
      : mix(vec3(1.08, 0.92, 0.78), vec3(0.94, 0.98, 1.04), hash11(rs + 6.1));
    roomCol *= tintShift;
  } else
#endif
  {
    // Clean procedural fallback if interiors.webp is unavailable
    vec3 wallc = category == 2 ? vec3(0.68, 0.52, 0.36) : (category == 1 ? vec3(0.56, 0.60, 0.64) : vec3(0.62, 0.56, 0.48));
    roomCol = wallc * (0.65 + 0.35 * (1.0 - abs(hx) * 0.4));
  }

  // Natural luminance-weighted night lamp glow: bright fixtures/screens/lanterns inside the photographed room
  // radiate vividly while furniture & darker corners retain photographic contrast!
  float luma = dot(roomCol, vec3(0.2126, 0.7152, 0.0722));
  float lampBoost = 0.55 + 1.35 * smoothstep(0.18, 0.75, luma);
  vec3 lampTint = category == 2
    ? mix(vec3(1.0, 0.82, 0.54), vec3(0.96, 0.98, 1.0), step(0.65, hash11(rs + 8.3)))
    : (category == 1
      ? mix(vec3(0.90, 0.96, 1.0), vec3(1.0, 0.90, 0.74), step(0.55, hash11(rs + 8.3)))
      : pick4(hash11(rs + 8.3), vec3(1.0, 0.70, 0.38), vec3(1.0, 0.80, 0.52), vec3(1.0, 0.88, 0.68), vec3(0.80, 0.90, 1.0)));

  glow = roomCol * lampTint * lampBoost * depthAtten * lit;
  // Unlit rooms stay deep & realistic (never flat pastel stickers!); lit rooms & daylight shops show crisp interior depth
  float dayVis = category == 2 ? 1.02 : (category == 1 ? 0.68 : 0.65);
  return roomCol * depthAtten * mix(dayVis, 0.14 + 0.78 * lit, uNight.x);
}

// Analytical distance anti-aliasing factor for procedural micro-patterns (prevents moire & wall shimmer in motion!)
float aaKeep(float period, float px) {
  return 1.0 - smoothstep(period * 0.20, period * 0.55, px);
}

float frameMask(vec2 g, vec2 size, Facade F, float trans, float px) {
  float ft = F.frame;
  if (ft <= 0.0) return 0.0;
  float aa = max(px * 0.75, 0.004);
  float edgeD = min(min(g.x, size.x - g.x), min(g.y, size.y - g.y));
  float fm = smoothstep(ft + aa, ft - aa, edgeD);
  vec2 cell = size / max(F.panes, vec2(1.0));
  vec2 m = abs(fract(g / cell + 0.5) - 0.5) * cell;
  float subX = smoothstep(ft * 0.5 + aa, ft * 0.5 - aa, m.x) * aaKeep(cell.x, px);
  fm = max(fm, subX);
  if (F.panes.y > 1.5) {
    fm = max(fm, smoothstep(ft * 0.5 + aa, ft * 0.5 - aa, m.y) * aaKeep(cell.y, px));
  }
  if (trans > 0.5) {
    fm = max(fm, smoothstep(ft * 0.5 + aa, ft * 0.5 - aa, abs(g.y - size.y * 0.70)) * aaKeep(size.y * 0.6, px));
  }
  return clamp(fm, 0.0, 1.0);
}

// ---- Horizontal Chongqing shop signboard texture lookup
vec3 sampleSignH(vec2 uv, float aspect, float sd, out float mask, out vec3 bgOut) {
  vec3 bg = pick4(hash11(sd),
    vec3(0.72, 0.08, 0.06),
    vec3(0.06, 0.24, 0.54),
    vec3(0.78, 0.54, 0.08),
    vec3(0.06, 0.34, 0.20));
  if (hash11(sd + 1.3) > 0.58) {
    bg = pick4(hash11(sd + 2.9),
      vec3(0.10, 0.09, 0.11),
      vec3(0.84, 0.82, 0.76),
      vec3(0.56, 0.16, 0.08),
      vec3(0.82, 0.34, 0.06));
  }
  bgOut = bg;
  float luma = dot(bg, vec3(0.3, 0.6, 0.1));
  vec3 fg = luma > 0.44 ? vec3(0.08, 0.06, 0.06) : vec3(0.98, 0.94, 0.84);
  if (hash11(sd + 4.7) > 0.55 && luma < 0.30) fg = vec3(1.0, 0.84, 0.26);
  mask = 0.0;
#ifdef HAS_SIGNS
  if (uSigns.x > 0.5) {
    float a = clamp(aspect, 1.5, 6.0);
    vec2 t = (uv - 0.5) * vec2(a / 4.0, 1.0) / 0.88 + 0.5;
    if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0) {
      mask = texture(tSigns, vec3(t.x, 1.0 - t.y, floor(hash11(sd + 5.1) * uSigns.x))).r;
    }
  }
#endif
  float border = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  vec3 c = mix(bg, fg, mask);
  return mix(c, bg * 0.45, step(border, 0.04));
}

// ---- Vertical Chongqing neon blade sign lookup (dedicated tSignsVert with upright 4-char fallback)
vec3 sampleSignV(vec2 uv, float sd, out float mask, out vec3 neonRim) {
  vec3 bg = pick4(hash11(sd * 1.13 + 0.7),
    vec3(0.68, 0.06, 0.05),
    vec3(0.07, 0.12, 0.30),
    vec3(0.10, 0.08, 0.10),
    vec3(0.06, 0.28, 0.22));
  neonRim = pick4(hash11(sd * 2.31 + 3.1),
    vec3(1.0, 0.22, 0.12),
    vec3(1.0, 0.76, 0.16),
    vec3(0.20, 0.85, 1.0),
    vec3(1.0, 0.30, 0.62));
  vec3 fg = hash11(sd + 6.3) > 0.4 ? vec3(1.0, 0.94, 0.76) : neonRim;
  mask = 0.0;
#ifdef HAS_SIGNS_VERT
  if (uSignsVert.x > 0.5) {
    vec2 t = (uv - 0.5) / 0.88 + 0.5;
    if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0) {
      mask = texture(tSignsVert, vec3(t.x, 1.0 - t.y, floor(hash11(sd + 5.1) * uSignsVert.x))).r;
    }
  }
#elif defined(HAS_SIGNS)
  if (uSigns.x > 0.5) {
    float vTop = 1.0 - uv.y;
    float slot = floor(clamp(vTop * 4.0, 0.0, 3.999));
    float cy = fract(vTop * 4.0);
    vec2 t = vec2((slot + clamp((uv.x - 0.08) / 0.84, 0.0, 1.0)) * 0.25, cy);
    if (uv.x > 0.08 && uv.x < 0.92) {
      mask = texture(tSigns, vec3(t.x, t.y, floor(hash11(sd + 5.1) * uSigns.x))).r;
    }
  }
#endif
  float borderX = min(uv.x, 1.0 - uv.x);
  float borderY = min(uv.y, 1.0 - uv.y);
  float tube = smoothstep(0.08, 0.03, borderX) + smoothstep(0.035, 0.012, borderY);
  vec3 c = mix(bg, fg, mask);
  return mix(c, neonRim, clamp(tube, 0.0, 1.0) * 0.85);
}

// =========================================================================
// MAIN WALL FACADE SHADER (KIND.wall = 0)
// =========================================================================
void shadeWall(inout Surface s) {
  int style = int(vBld.x + 0.5);
  float seed = vBld.y, pal = vBld.z, levels = max(vBld.w, 1.0);
  float eflag = vFlag.x;
  float fH = max(vFlag.y * (1.0 / 40.0), 2.2);
  float gH = max(vFlag.z * (1.0 / 20.0), 2.4);
  float bFlags = vFlag.w;
  float edgeLen = vEdge.x;
  float topH = max(vEdge.y, 2.0);
  float yRef = vEdge.z;
  float podiumH = vEdge.w;

  vec3 N = normalize(vNormal);
  vec3 T = normalize(vec3(N.z, 0.0, -N.x));
  vec3 Bv = vec3(0.0, 1.0, 0.0);
  vec3 V = normalize(-vView * mat3(viewMatrix));
  vec3 d = -vec3(dot(V, T), dot(V, Bv), dot(V, N));
  vec3 Lt = vec3(dot(uLightDir, T), dot(uLightDir, Bv), dot(uLightDir, N));

  float u = vUv.x;
  float y = vUv.y - yRef;
  bool south = N.z > 0.25;
  Facade F = facadeFor(style, pal, seed, south);
  bool party = mod(floor(eflag * 0.5), 2.0) > 0.5;
  bool front = mod(eflag, 2.0) > 0.5;
  if (y > 9.0 || topH > 24.0 || front) party = false;
  bool commGround = mod(floor(bFlags / 32.0), 2.0) > 0.5;
  float px = max(fwidth(u), fwidth(y));
  float lights = uNight.y;
  float wet = uNight.z;

  // ---- Podium override: richer granite/limestone panels on ground podium of tall towers!
  bool inPodium = podiumH > 0.5 && y >= 0.0 && y < podiumH;
  if (inPodium && style != ST_BAYU_VERNACULAR && style != ST_TEMPLE) {
    F.layer = hash11(pal * 3.1) > 0.5 ? L_LIMESTONE : L_GRANITE;
    F.scale = hash11(pal * 3.1) > 0.5 ? S_LIMESTONE : S_GRANITE;
    F.mean = hash11(pal * 3.1) > 0.5 ? C_LIMESTONE : C_GRANITE;
    F.tint = mix(F.tint, vec3(0.46, 0.43, 0.39), 0.55);
    F.curtain = (style == ST_CBD_SUPERTALL || style == ST_OFFICE_GLASS) ? 0.0 : F.curtain;
  }

  // ---- Base wall PBR + high-contrast Chongqing humid weathering & macro close-up grit
  vec2 wuv = vec2(u + seed * 0.37, y);
  MatS wm = matTint(F.layer, wuv * F.scale, F.mean, F.tint);
  float streakN = vnoise(vec2(u * 2.4 + seed, y * 0.12)) * 0.65 + vnoise(vec2(u * 7.5 + seed * 1.3, y * 0.32)) * 0.35;
  float topStreak = smoothstep(0.46, 0.90, streakN) * (0.26 + 0.74 * smoothstep(topH - 12.0, topH, y));
  float dampBase = smoothstep(1.8, -0.5, y) * 0.44;
  float macroPatch = (vnoise(vWorld.xz * 0.32 + y * 0.22) - 0.5) * 0.22;
  float grime = (dampBase + topStreak * 0.36 + max(macroPatch, 0.0)) * F.humid;
  if (F.curtain < 0.5) {
    wm.albedo *= clamp(1.0 - grime * 0.88, 0.36, 1.06);
    float moss = smoothstep(1.0, -0.4, y) * smoothstep(0.50, 0.84, vnoise(wuv * 1.5 + seed)) * F.humid;
    wm.albedo = mix(wm.albedo, wm.albedo * vec3(0.50, 0.68, 0.42), moss * 0.44);
  }

  // High-frequency close-up stone/concrete/plaster micro-grit & normal tooth (fades smoothly before aliasing!)
  float closeK = 1.0 - smoothstep(0.001, 0.0065, px);
  if (closeK > 0.0) {
    float gr = vnoise(wuv * 220.0) * 0.55 + vnoise(wuv * 75.0) * 0.45;
    wm.albedo *= 1.0 + (gr - 0.5) * 0.24 * closeK;
    wm.n = normalize(wm.n + vec3(vnoise(wuv * 190.0 + 7.0) - 0.5, vnoise(wuv * 190.0 + 31.0) - 0.5, 0.0) * 0.40 * closeK);
    wm.rough = clamp(wm.rough + (gr - 0.5) * 0.20 * closeK, 0.05, 1.0);
  }

  vec3 albedo = wm.albedo;
  vec3 nT = wm.n;
  float rough = wm.rough;
  float metal = (F.layer == L_CORRUGATED || F.layer == L_METAL_PANEL) ? 0.52 : 0.0;
  float refl = 0.5, ao = 1.0, micro = 1.0;
  vec3 emissive = vec3(0.0);

  // Subtle architectural stone ashlar panel bevels on podiums & civic/historic/grid facades (AA-filtered!)
  if (inPodium || style == ST_OFFICE_GRID || style == ST_CIVIC || style == ST_HOTEL) {
    float ashAA = aaKeep(0.72, px);
    if (ashAA > 0.01) {
      vec2 pj = abs(fract(vec2(u / 1.15, y / 0.72) + 0.5) - 0.5);
      float seam = smoothstep(0.018 + px * 0.5, 0.0, min(pj.x, pj.y)) * ashAA;
      albedo *= 1.0 - 0.22 * seam;
      nT = normalize(nT + vec3(0.0, seam * 0.20, 0.0));
    }
  }

  // ---- Storey indexing
  float yTop = gH + (levels - 1.0) * fH;
  float fi, fy, fh;
  if (y < 0.0) { fi = -2.0; fy = mod(y, 3.6); fh = 3.6; }
  else if (y < gH) { fi = -1.0; fy = y; fh = gH; }
  else if (y < yTop) { fi = floor((y - gH) / fH); fy = y - gH - fi * fH; fh = fH; }
  else { fi = 999.0; fy = y - yTop; fh = max(topH - yTop, 0.2); }

  bool belowGrade = fi < -1.5;
  bool ground = fi > -1.5 && fi < -0.5;
  bool capBand = fi > 900.0;
  bool shops = ground && (front || commGround) && F.shop > 0.5 && gH > 2.75 && edgeLen > 4.2;

  // Deep crevice contact AO right under every floor cornice/slab overhang and near damp street base!
  if (F.curtain < 0.5 && !belowGrade) {
    float underSlabAO = mix(1.0, 0.62, smoothstep(fh - 0.42, fh, fy));
    float baseSplashAO = mix(0.68, 1.0, smoothstep(0.0, 0.65, y));
    ao *= underSlabAO * baseSplashAO;
  }

  // ---- Bay grid (exact sync with facadeKit.js + curved-tower short-facet support)
  float bayN = shops ? 4.2 + 0.8 * hash11(seed + 3.0) : F.bay;
  float margin = shops ? 0.35 : F.margin;
  if (edgeLen < bayN + 2.0 * margin && edgeLen >= 1.5) margin = min(margin, edgeLen * 0.08);
  float usable = edgeLen - 2.0 * margin;
  float nb = floor(usable / bayN + 0.4);
  if (nb < 1.0 && !party && edgeLen >= 1.5 && topH > 12.0) nb = 1.0;
  bool bays = nb >= 1.0 && !party && !belowGrade && u > margin && u < edgeLen - margin;
  float bw = bays ? usable / nb : edgeLen;
  float ub = (u - margin) / max(bw, 0.1);
  float ci = floor(ub);
  vec2 p = vec2((ub - ci) * bw, fy);
  float hb = hash11(ci * 1.13 + seed * 0.71 + (south ? 0.0 : 5.0));
  float hc = hash12(vec2(ci, fi) + seed * 0.37);
  float rs = hc * 97.0 + seed;

  // Contact AO alongside vertical bay piers & stone plinth band
  if (bays && F.curtain < 0.5) {
    float pierDist = min(p.x, bw - p.x);
    ao *= mix(0.72, 1.0, smoothstep(0.0, 0.34, pierDist));
  }

  if (style == ST_HISTORIC_MASONRY && !party) {
    if (ground) {
      float j = abs(fract(y / 0.46) - 0.5) * 0.46;
      albedo *= mix(0.54, 1.0, smoothstep(0.0, 0.032, j)) * 0.88;
    }
    float band = smoothstep(0.16, 0.0, abs(y - gH)) + smoothstep(0.28, 0.0, abs(y - yTop));
    albedo *= 1.0 + 0.15 * band;
  }
  if ((style == ST_TEMPLE || style == ST_BAYU_VERNACULAR) && bays && !capBand) {
    float col = smoothstep(0.16, 0.11, min(p.x, bw - p.x));
    vec3 timberCol = style == ST_TEMPLE ? vec3(0.32, 0.06, 0.04) : vec3(0.14, 0.08, 0.05);
    albedo = mix(albedo, timberCol, col);
    rough = mix(rough, 0.52, col);
  }
  if (ground && F.curtain < 0.5 && style != ST_INDUSTRIAL) {
    float pl = step(y, 0.45);
    albedo = mix(albedo, albedo * 0.54 + vec3(0.02), pl);
    rough = mix(rough, 0.78, pl);
  }

  // ---- Opening layout (exact sync with facadeKit.js 3D window assemblies, balconies & storefronts!)
  vec4 ap = vec4(0.0);
  float D = F.depth;
  int okind = 0; // 1 window, 2 curtain wall, 3 shopfront, 4 louvre, 5 door
  float signY0 = 0.0, signY1 = 0.0;

  if (bays) {
    if (capBand) {
      if ((style == ST_RESI_MODERN || style == ST_OFFICE_GRID || style == ST_HOTEL || style == ST_CBD_SUPERTALL) && fh > 1.4 && topH > 35.0 && hb > 0.28) {
        ap = vec4(bw * 0.12, bw * 0.88, 0.22, fh - 0.45); okind = 4; D = 0.14;
      } else if (F.curtain > 0.5) {
        ap = vec4(0.0, bw, 0.0, fh - 0.20); okind = 2;
      }
    } else if (F.curtain > 0.5 && !inPodium) {
      bool mechFloor = topH >= 60.0 && fi > 4.0 && mod(fi, 12.0) < 0.5;
      if (mechFloor) { ap = vec4(0.06, bw - 0.06, 0.14, fh - 0.14); okind = 4; D = 0.16; }
      else { ap = vec4(0.0, bw, 0.0, fh); okind = 2; }
    } else if (shops) {
      float top = min(2.90, gH - 0.95);
      ap = vec4(0.26, bw - 0.26, 0.12, top); okind = 3; D = 0.26;
      signY0 = top + 0.12; signY1 = min(gH - 0.10, signY0 + 0.92);
    } else if (ground) {
      bool door = mod(ci + floor(seed * 0.07), 4.0) < 0.5 && style != ST_INDUSTRIAL && !inPodium;
      if (door) { ap = vec4(bw * 0.5 - 0.85, bw * 0.5 + 0.85, 0.02, min(2.45, fh - 0.4)); okind = 5; D = 0.30; }
      else if (style != ST_INDUSTRIAL && style != ST_BIGROOF && fh > 2.4) {
        float w = bw * (inPodium ? 0.78 : 0.52);
        ap = vec4((bw - w) * 0.5, (bw + w) * 0.5, inPodium ? 0.35 : max(0.85, fh * 0.28), min(fh - 0.35, inPodium ? fh - 0.45 : 2.65));
        okind = inPodium ? 3 : 1; D = 0.26;
      } else if (style == ST_INDUSTRIAL && hb > 0.70 && fh > 4.0) {
        ap = vec4(bw * 0.18, bw * 0.82, 0.02, min(4.2, fh - 0.5)); okind = 5; D = 0.24;
      }
    } else {
      vec2 win = inPodium ? vec2(style == ST_HISTORIC_MASONRY ? 0.44 : 0.64, style == ST_HISTORIC_MASONRY ? 0.58 : 0.54) : F.win;
      float sill = inPodium ? (style == ST_HISTORIC_MASONRY ? 0.22 : 0.26) : F.sill;
      bool blank = false;
      if (!inPodium) {
        if (style == ST_RESI_MODERN) {
          if ((south && hb > 0.32) || (!south && hb > 0.62)) { win = vec2(0.82, 0.76); sill = 0.06; }
        } else if (style == ST_RESI_OLD_HIGHRISE) {
          if ((south && hb > 0.36) || (!south && hb > 0.68)) { win = vec2(0.80, 0.72); sill = 0.08; }
          else if (!south && hb < 0.14) blank = true;
        } else if (style == ST_RESI_WALKUP || style == ST_GENERIC) {
          if (south && hb > 0.44) { win = vec2(0.76, 0.68); sill = 0.10; }
          else if (!south && hb < 0.14) blank = true;
        } else if (style == ST_BAYU_VERNACULAR) {
          if (hb > 0.22) { win = vec2(0.74, 0.68); sill = 0.12; }
        } else if (style == ST_COMMERCIAL_MALL) {
          blank = hb < 0.30;
        }
      }
      if (!blank && fh > 2.0) {
        float w = bw * win.x, hgt = fh * win.y;
        ap = vec4((bw - w) * 0.5, (bw + w) * 0.5, fh * sill, min(fh * sill + hgt, fh - 0.22));
        okind = 1;
      }
    }
  }

  // ---- Analytic deep recess intersection & photorealistic interior box-parallax!
  float detail = 1.0 - smoothstep(0.32, 1.35, px);
  vec2 q; vec3 rn; float dh;
  int hit = okind == 0 ? 0 : recessHit(p, ap, D, d, q, rn, dh);
  vec3 nTan = nT;

  if (hit == 1) {
    albedo = (okind == 2 || okind == 3) ? F.frameCol : mix(albedo, F.tint * 0.92, 0.5);
    nTan = rn; rough = 0.70;
    ao = mix(0.88, 0.42, clamp(dh / max(D, 0.01), 0.0, 1.0));
    micro = recessSun(q, dh, ap, Lt);
  } else if (hit == 2) {
    vec2 g = q - ap.xz;
    vec2 size = vec2(ap.y - ap.x, ap.w - ap.z);
    micro = recessSun(q, dh, ap, Lt);
    ao = 0.78;

    if (okind == 4) {
      float louvAA = aaKeep(0.11, px);
      float sl = abs(fract(g.y / 0.11) - 0.5);
      float slVal = mix(0.60, mix(0.28, 0.94, smoothstep(0.10, 0.38, sl)), louvAA);
      albedo = F.frameCol * slVal;
      rough = 0.46; metal = 0.62;
      nTan = normalize(mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 0.64, 0.76), louvAA));
    } else if (okind == 5) {
      vec3 dc = pick4(hash11(rs), vec3(0.18, 0.10, 0.07), vec3(0.18, 0.20, 0.22), vec3(0.10, 0.16, 0.14), vec3(0.26, 0.24, 0.22));
      float leaf = step(0.07, min(g.x, size.x - g.x)) * step(g.y, size.y - 0.07);
      float mid = step(abs(g.x - size.x * 0.5), 0.022) * aaKeep(0.25, px);
      float handle = step(abs(g.x - size.x * 0.54), 0.015) * step(abs(g.y - 1.05), 0.14) * aaKeep(0.15, px);
      albedo = mix(dc * (0.68 + 0.32 * leaf) * (1.0 - 0.60 * mid), vec3(0.75, 0.76, 0.78), handle);
      rough = mix(0.38, 0.22, handle); metal = mix(0.28, 0.88, handle); nTan = vec3(0.0, 0.0, 1.0);
    } else {
      float fm = frameMask(g, size, F, okind == 1 ? 1.0 : 0.0, px);
      float aaF = max(px * 0.75, 0.004);
      bool spandrel = okind == 2 && (g.y < fh * 0.24);
      if (okind == 2) {
        float cwF = max(
          smoothstep(F.frame * 0.55 + aaF, F.frame * 0.55 - aaF, abs(g.y - fh * 0.24)),
          max(smoothstep(F.frame * 0.6 + aaF, F.frame * 0.6 - aaF, g.y),
              smoothstep(F.frame * 0.55 + aaF, F.frame * 0.55 - aaF, min(g.x, size.x - g.x)))
        );
        fm = max(fm, cwF * aaKeep(0.55, px));
      }
      if ((style == ST_BAYU_VERNACULAR || style == ST_TEMPLE) && okind == 1) {
        float latAA = aaKeep(0.24, px);
        if (latAA > 0.01) {
          vec2 lg = abs(fract(g / 0.24 + 0.5) - 0.5) * 0.24;
          fm = max(fm, smoothstep(0.018 + aaF, 0.018 - aaF, min(lg.x, lg.y)) * latAA);
        }
      }

      bool riser = false;
      if (okind == 3) {
        bool rightDoor = hash11(rs + 9.0) > 0.5;
        float dx = rightDoor ? size.x - 1.15 : 1.15;
        bool inDoor = rightDoor ? g.x > dx : g.x < dx;
        float sfM = max(
          max(smoothstep(0.032 + aaF, 0.032 - aaF, abs(g.x - dx)), smoothstep(0.028 + aaF, 0.028 - aaF, abs(g.y - 2.15))),
          max(smoothstep(0.05 + aaF, 0.05 - aaF, min(g.x, size.x - g.x)), smoothstep(0.07 + aaF, 0.07 - aaF, size.y - g.y))
        );
        fm = max(fm, sfM * aaKeep(0.45, px));
        riser = !inDoor && g.y < 0.36;
      }

      if (fm > 0.92) {
        albedo = F.frameCol; rough = 0.34; metal = (style == ST_BAYU_VERNACULAR || style == ST_TEMPLE) ? 0.05 : 0.62;
        nTan = vec3(0.0, 0.0, 1.0); ao = 0.85;
      } else if (riser) {
        MatS rm = matTint(L_GRANITE, vec2(u, y) * S_GRANITE * 2.0, C_GRANITE, vec3(0.16, 0.15, 0.15));
        albedo = mix(rm.albedo, F.frameCol, fm); rough = 0.32; nTan = rm.n; ao = 0.85;
      } else {
        // Architectural glass with subtle per-pane micro-tilt & slight glass waviness (AA-faded to prevent sub-pixel shimmer!)
        vec2 pane = floor(g / (size / max(F.panes, vec2(1.0)))) + vec2(ci, fi) * 3.0;
        float waveAA = aaKeep(0.60, px);
        vec2 wave = vec2(sin(g.x * 5.2 + g.y * 3.1), cos(g.y * 4.7 - g.x * 2.3)) * (0.004 * waveAA);
        vec2 tilt = (hash22(pane + seed) - 0.5) * (okind == 2 ? 0.020 : 0.014) * aaKeep(1.2, px) + wave;
        nTan = normalize(vec3(tilt, 1.0));
        // Physical Fresnel glazing response: crisp mirror-like sky reflection at grazing angles!
        float NoVg = clamp(dot(normalize(T * nTan.x + Bv * nTan.y + N * nTan.z), V), 0.0, 1.0);
        float fres = pow(1.0 - NoVg, 4.0);
        rough = mix(0.035, 0.015, fres);
        refl = clamp(mix(F.refl, 1.0, fres * 0.7), 0.55, 1.0);
        metal = 0.0;

        vec3 glow = vec3(0.0);
        vec3 inside;

        if (spandrel) {
          float spRib = 0.86 + 0.14 * sin(g.y * 35.0) * aaKeep(0.18, px);
          inside = F.glass * 0.16 * spRib;
        } else {
          int cat = okind == 3 ? 2 : (F.office > 0.5 ? 1 : 0);
          float litP = cat == 1 ? 0.30 : 0.48;
          if (cat == 1 && hash11(fi * 3.7 + seed) > 0.78) litP = 0.86;
          if (style == ST_BAYU_VERNACULAR || style == ST_HOTEL) litP = 0.64;
          float lit = step(hash11(rs + 11.0), litP) * lights;
          if (cat == 2) lit = max(lit, 0.48 * step(hash11(rs + 12.0), 0.94) + lights * step(hash11(rs + 12.0), 0.96));

          inside = interiorParallax(g, size, d, rs, cat, style, lit, glow);

          // Occasional closed curtains (~30% residential) & half-drawn blinds (~32% offices), AA-filtered to stop shimmer!
          if (okind == 1 && cat == 0 && hash11(rs + 20.5) < 0.30) {
            float cl = hash11(rs + 21.0), cr = hash11(rs + 22.0);
            float cx = g.x / max(size.x, 0.01);
            float cL = step(cx, cl * 0.42), cR = step(1.0 - cr * 0.42, cx);
            float cover = max(cL, cR);
            float sheer = step(0.55, hash11(rs + 25.0));
            float folds = 0.78 + 0.22 * sin(g.x * 52.0 + rs) * aaKeep(0.12, px);
            vec3 fab = pick4(hash11(rs + 23.0),
              vec3(0.76, 0.72, 0.64), vec3(0.56, 0.46, 0.38), vec3(0.38, 0.44, 0.50), vec3(0.62, 0.46, 0.40)) * folds;
            float covAmt = cover * mix(0.86, 0.42, sheer);
            inside = mix(inside, fab * mix(0.65, 0.22, uNight.x), covAmt);
            glow = mix(glow, glow * fab * 1.45 + fab * 0.24 * lit, covAmt);
          } else if (okind != 3 && cat == 1 && hash11(rs + 20.5) < 0.32) {
            float drop = 0.12 + hash11(rs + 24.0) * 0.36;
            float bl = step(1.0 - drop, g.y / max(size.y, 0.01));
            float sl = mix(0.85, 0.70 + 0.30 * step(0.45, fract(g.y / 0.045)), aaKeep(0.045, px));
            inside = mix(inside, vec3(0.58, 0.59, 0.57) * sl * mix(1.0, 0.25, uNight.x), bl * 0.84);
            glow *= mix(1.0, 0.48, bl);
          }

          // Clear storefront glazing on ground shops vs tinted architectural glass on upper stories
          vec3 gTint = okind == 3 ? vec3(0.95, 0.96, 0.98) : mix(F.glass * 1.25, vec3(0.88), 0.18);
          inside *= gTint;
          glow *= (okind == 3 ? vec3(1.0, 0.92, 0.78) : mix(F.glass * 1.25, vec3(1.0), 0.25));
        }

        // Subtle sky-reflection tint mixed gently at grazing angles so glass reads unmistakably as physical glass
        vec3 skyTint = mix(vec3(0.18, 0.26, 0.36), vec3(0.04, 0.06, 0.12), uNight.x);
        inside = mix(inside, skyTint, fres * (okind == 2 ? 0.42 : (okind == 3 ? 0.18 : 0.26)));
        inside = mix(F.glass * 0.14, inside, detail);
        // Smooth anti-aliased blend with window frame mullion at pane borders (eliminates sub-pixel frame flickering!)
        albedo = mix(inside * 0.92, F.frameCol, fm);
        rough = mix(rough, 0.34, fm);
        metal = mix(metal, (style == ST_BAYU_VERNACULAR || style == ST_TEMPLE) ? 0.05 : 0.62, fm);
        nTan = normalize(mix(nTan, vec3(0.0, 0.0, 1.0), fm));
        emissive = glow * (1.0 - fm) * mix(1.0, 0.84, 1.0 - detail) * (okind == 3 ? mix(1.25, 3.1, uNight.x) : 2.35);
      }
    }
  } else if (okind == 1 && bays && F.curtain < 0.5) {
    // Crisp dark Chongqing humid rain-drip streaks beneath window sills & eyebrow corners!
    float under = step(ap.x - 0.06, p.x) * step(p.x, ap.y + 0.06) * smoothstep(ap.z - 1.5, ap.z, p.y) * step(p.y, ap.z);
    float edgeDrip = (smoothstep(0.14, 0.0, abs(p.x - ap.x)) + smoothstep(0.14, 0.0, abs(p.x - ap.y))) * smoothstep(ap.z - 1.8, ap.z, p.y) * step(p.y, ap.z);
    float dripTex = 0.45 + 0.55 * vnoise(vec2(u * 13.0 + seed, y * 0.65));
    albedo *= 1.0 - clamp((0.26 * under + 0.22 * edgeDrip) * F.humid * dripTex, 0.0, 0.52);
    // Contact AO shadow directly under window sill & above window eyebrow
    float sillShadow = step(ap.x - 0.12, p.x) * step(p.x, ap.y + 0.12) * smoothstep(ap.z - 0.26, ap.z, p.y) * step(p.y, ap.z);
    ao *= 1.0 - 0.34 * sillShadow;
    if (style == ST_HISTORIC_MASONRY) {
      float sur = step(ap.x - 0.22, p.x) * step(p.x, ap.y + 0.22) * step(ap.z - 0.20, p.y) * step(p.y, ap.w + 0.26);
      albedo *= 1.0 + 0.14 * sur;
    }
  }

  // Fallback flush signboard for LOD1/LOD2 mid-distance continuity (on LOD0, 3D KIND.signH box sits in front)
  if (shops && bays && hit == 0 && signY1 > signY0 && p.y > signY0 && p.y < signY1 && p.x > 0.24 && p.x < bw - 0.24) {
    float smask; vec3 sbg;
    vec2 suv = vec2((p.x - 0.24) / max(bw - 0.48, 0.1), (p.y - signY0) / max(signY1 - signY0, 0.1));
    vec3 sc = sampleSignH(suv, (bw - 0.48) / max(signY1 - signY0, 0.1), hash11(ci * 3.7 + seed * 1.9) * 97.0, smask, sbg);
    float lightBg = step(0.44, dot(sbg, vec3(0.3, 0.6, 0.1)));
    vec3 vivid = pow(max(sc, 0.0), vec3(1.28));
    float lbBoost = mix(mix(0.62, 2.25, smask), mix(1.28, 0.06, smask), lightBg);
    albedo = sc * 0.88; rough = 0.30; nTan = vec3(0.0, 0.0, 1.0);
    emissive = vivid * (0.14 + 1.65 * lights) * lbBoost;
  }

  // ---- Night architectural floodlighting & Chongqing skyline vibrancy
  if (lights > 0.01) {
    if ((style == ST_HISTORIC_MASONRY || style == ST_CIVIC) && !party && hit == 0) {
      float wash = (0.35 + 0.65 * exp(-fract(max(y, 0.0) / max(fH, 3.0)) * 2.1)) * (0.55 + 0.45 * sin(u * 1.8 + seed));
      emissive += albedo * vec3(1.0, 0.72, 0.36) * (3.6 * lights * wash);
    }
    if (style == ST_BAYU_VERNACULAR && !party && hit == 0) {
      float eaveGlow = smoothstep(fH * 0.45, fH, fy) * 0.65 + 0.35;
      emissive += albedo * vec3(1.0, 0.62, 0.22) * (2.2 * lights * eaveGlow);
    }
    if ((style == ST_CBD_SUPERTALL || style == ST_OFFICE_GLASS) && capBand) {
      vec3 crownCol = pick4(hash11(seed * 0.77), vec3(0.35, 0.75, 1.0), vec3(1.0, 0.72, 0.32), vec3(0.95, 0.35, 0.55), vec3(0.35, 0.95, 0.75));
      emissive += crownCol * (2.1 * lights * step(48.0, topH));
    }
  }

  if (wet > 0.01 && F.curtain < 0.5 && hit != 2) {
    albedo *= mix(1.0, 0.72, wet * 0.72);
    rough = mix(rough, 0.24, wet * 0.62);
  }

  s.albedo = albedo;
  s.normal = normalize(T * nTan.x + Bv * nTan.y + N * nTan.z);
  s.roughness = rough;
  s.metalness = metal;
  s.reflectance = refl;
  s.ao = ao;
  s.microShadow = micro;
  s.emissive = emissive;
}

// =========================================================================
// ROOF & ARCHITECTURAL TRIM SHADERS
// =========================================================================
void shadeRoof(inout Surface s, int kind) {
  int style = int(vBld.x + 0.5);
  float seed = vBld.y, pal = vBld.z;
  vec3 N = normalize(vNormal);
  vec3 T, B;
  vec2 uv;
  if (abs(N.y) > 0.96) {
    T = vec3(1.0, 0.0, 0.0);
    B = vec3(0.0, 0.0, -1.0);
    uv = vec2(vTex.x, -vTex.y);
  } else {
    T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
    B = normalize(cross(N, T));
    vec3 P = vec3(vTex.x, vWorld.y, vTex.y);
    uv = vec2(dot(P, T), dot(P, B));
  }
  float h = hash11(pal * 2.11 + 0.7), h2 = hash11(seed * 0.91);
  float macro = vnoise(vWorld.xz * 0.32) * 0.6 + vnoise(vWorld.xz * 1.25) * 0.4;
  MatS m;

  if (kind == 2) {
    bool bayuGrey = style == ST_BAYU_VERNACULAR || style == ST_TEMPLE || style == ST_HISTORIC_MASONRY || h > 0.42;
    if (bayuGrey) {
      vec3 tileTint = style == ST_TEMPLE ? vec3(0.11, 0.13, 0.14) : vec3(0.16, 0.17, 0.18);
      m = matTint(L_BAYU_TILE, uv * S_BAYU_TILE, C_BAYU_TILE, tileTint);
    } else {
      vec3 tint = mix(vec3(0.36, 0.15, 0.10), vec3(0.24, 0.14, 0.10), h2);
      m = matTint(L_ROOF_CLAY, uv * S_ROOF_CLAY, C_ROOF_CLAY, tint);
    }
    m.albedo *= 0.80 + 0.40 * macro;
  } else if (kind == 7) {
    m = matTint(L_CORRUGATED, uv * S_CORRUGATED, C_CORRUGATED, mix(vec3(0.32, 0.42, 0.54), vec3(0.52, 0.54, 0.56), step(0.45, h)));
    m.albedo *= 0.84 + 0.32 * macro;
    s.metalness = 0.62;
  } else if (kind == 3) {
    // Architectural precast concrete / limestone trim with weathering & subtle building palette harmony
    Facade F = facadeFor(style, pal, seed, true);
    vec3 baseTrim = mix(vec3(0.45, 0.43, 0.40), vec3(0.57, 0.55, 0.51), h2);
    vec3 trimCol = F.curtain > 0.5 ? baseTrim * 0.90 : mix(baseTrim, clamp(F.tint * 1.06, 0.18, 0.70), 0.44);
    m = matTint(L_CONCRETE, uv * S_CONCRETE * 1.25, C_CONCRETE, trimCol);
    // Subtle weathering streak on concrete balcony/sill/cornice trim so nothing looks sterile!
    float grit = vnoise(uv * 18.0 + seed) * 0.55 + vnoise(uv * 5.0) * 0.45;
    m.albedo *= (0.82 + 0.30 * macro) * (0.90 + 0.20 * grit);
    m.rough = clamp(m.rough + (grit - 0.5) * 0.16, 0.25, 0.95);
  } else {
    if (h < 0.52) m = matTint(L_BITUMEN, uv * S_BITUMEN, C_BITUMEN, vec3(0.13, 0.13, 0.135));
    else m = matTint(L_CONCRETE, uv * S_CONCRETE, C_CONCRETE, vec3(0.30, 0.29, 0.28));
    float stain = smoothstep(0.42, 0.80, vnoise(vWorld.xz * 0.22 + seed));
    m.albedo *= mix(1.0, 0.58, stain) * (0.84 + 0.32 * macro);
    if (h2 > 0.72) m.albedo = mix(m.albedo, vec3(0.28, 0.13, 0.11), 0.34);
  }
  s.albedo = m.albedo;
  s.roughness = m.rough;
  s.normal = normalize(T * m.n.x + B * m.n.y + N * m.n.z);
}

void main() {
  Surface s = defaultSurface();
  int kind = int(vKind + 0.5);
  int style = int(vBld.x + 0.5);
  float seed = vBld.y, pal = vBld.z;
  float lights = uNight.y, wet = uNight.z;
  vec3 N = normalize(vNormal);
  vec3 T = abs(N.y) < 0.95 ? normalize(vec3(N.z, 0.0, -N.x)) : vec3(1.0, 0.0, 0.0);
  vec3 Bv = normalize(cross(N, T));
  s.normal = N;

  if (kind == 0) {
    shadeWall(s);
  } else if (kind == 4) {
    Facade F = facadeFor(style, pal, seed, N.z > 0.25);
    if (N.y > 0.5) {
      s.albedo = vec3(0.22, 0.21, 0.20) * (0.8 + 0.4 * vnoise(vWorld.xz * 0.12));
      if (style == ST_BAYU_VERNACULAR || style == ST_TEMPLE) s.albedo = vec3(0.16, 0.17, 0.18);
    } else {
      float yL = vUv.y - vEdge.z;
      float w = step(0.28, fract(yL / 3.1)) * step(fract(yL / 3.1), 0.80) * step(0.24, fract(vUv.x / 3.3)) * step(fract(vUv.x / 3.3), 0.76);
      s.albedo = mix(F.tint, vec3(0.08, 0.10, 0.12), w * 0.82);
      s.roughness = mix(0.84, 0.28, w);
      if (lights > 0.01 && w > 0.5) {
        float hLit = hash12(vec2(floor(vUv.x / 3.3), floor(yL / 3.1)) + seed);
        s.emissive = vec3(1.0, 0.78, 0.46) * (step(0.68, hLit) * lights * 1.4);
      }
    }
  } else if (kind == 5) {
    // Brushed aluminum / steel (curtain-wall fins, roof tanks, cooling towers, HVAC)
    float rib = 0.88 + 0.12 * step(0.5, fract(vUv.y / 0.36));
    float brush = 0.94 + 0.12 * vnoise(vec2(vUv.x * 16.0, vWorld.y * 42.0));
    vec3 col = mix(vec3(0.52, 0.55, 0.59), vec3(0.34, 0.37, 0.41), hash11(seed * 0.37));
    s.albedo = col * rib * brush;
    s.roughness = 0.28; s.metalness = 0.84;
    if (N.y > 0.5) {
      float fan = smoothstep(0.42, 0.36, length(fract(vTex / 1.45) - 0.5));
      s.albedo = mix(s.albedo, vec3(0.05), fan * 0.85);
    }
  } else if (kind == 6) {
    // Architectural glass (balcony guardrails, bay windows, enclosed sunrooms, glass canopies, skylights)
    vec3 gCol = style == ST_RESI_MODERN ? vec3(0.07, 0.13, 0.17) : vec3(0.06, 0.10, 0.13);
    s.albedo = gCol; s.roughness = 0.04; s.reflectance = 0.92; s.metalness = 0.06;
    if (lights > 0.01 && style == ST_RESI_OLD_HIGHRISE) {
      float gl = step(0.56, hash12(floor(vec2(vUv.x / 2.6, vUv.y / 3.0)) + seed));
      s.emissive = vec3(1.0, 0.74, 0.42) * (gl * lights * 0.95);
    }
  } else if (kind == 8) {
    // Shaded undersides / soffits (deep crevice occlusion!)
    s.albedo = vec3(0.24, 0.23, 0.21); s.roughness = 0.92; s.ao = 0.52;
  } else if (kind == 9) {
    float eqPx = fwidth(vUv.y);
    float eqAA = aaKeep(0.15, eqPx);
    float sl = abs(fract(vUv.y / 0.15) - 0.5);
    s.albedo = vec3(0.32, 0.34, 0.36) * mix(0.68, mix(0.38, 1.0, smoothstep(0.08, 0.36, sl)), eqAA);
    s.roughness = 0.48; s.metalness = 0.56;
    s.normal = normalize(N + vec3(0.0, 0.52 * eqAA, 0.0) * step(sl, 0.22));
  } else if (kind == 10) {
    // Chongqing sandstone retaining wall plinth (石砌堡坎) with AA-filtered deep mortar joints & damp moss!
    vec2 suv = vec2(vUv.x, vWorld.y) * S_SANDSTONE;
    MatS m = matTint(L_SANDSTONE, suv, C_SANDSTONE, mix(vec3(0.38, 0.35, 0.30), vec3(0.46, 0.40, 0.32), hash11(pal * 1.9)));
    float yRel = vUv.y - vEdge.z;
    float damp = smoothstep(0.5, -3.5, yRel);
    float moss = damp * smoothstep(0.45, 0.80, vnoise(vec2(vUv.x * 0.85 + seed, vWorld.y * 0.95)));
    m.albedo *= mix(1.0, 0.60, damp * 0.78);
    m.albedo = mix(m.albedo, vec3(0.12, 0.21, 0.09), moss * 0.52);
    float stAA = aaKeep(0.40, max(fwidth(vUv.x), fwidth(vWorld.y)));
    vec2 bj = abs(fract(vec2(vUv.x / 0.82 + 0.5 * floor(vWorld.y / 0.40), vWorld.y / 0.40)) - 0.5);
    float mortar = smoothstep(0.45, 0.50, max(bj.x, bj.y)) * stAA;
    m.albedo *= 1.0 - 0.36 * mortar;
    s.albedo = m.albedo;
    s.roughness = mix(m.rough, 0.26, wet * 0.65);
    s.normal = normalize(T * m.n.x + Bv * m.n.y + N * m.n.z);
  } else if (kind == 11) {
    // Articulated ground-podium honed granite / limestone piers & entablatures (AA-filtered joints, darkens naturally at night!)
    vec2 puv = vec2(vUv.x, vWorld.y) * S_LIMESTONE;
    MatS m = matTint(L_LIMESTONE, puv, C_LIMESTONE, mix(vec3(0.42, 0.39, 0.36), vec3(0.30, 0.30, 0.31), hash11(pal * 2.7)));
    float jtAA = aaKeep(0.72, fwidth(vWorld.y));
    float joint = smoothstep(0.46, 0.50, abs(fract(vWorld.y / 0.72) - 0.5)) * jtAA;
    float grime = 0.88 + 0.22 * vnoise(vec2(vUv.x * 2.4 + seed, vWorld.y * 0.6));
    m.albedo *= (1.0 - 0.24 * joint) * grime;
    s.albedo = m.albedo;
    s.roughness = mix(0.44, 0.22, wet);
    s.normal = normalize(T * m.n.x + Bv * m.n.y + N * m.n.z);
  } else if (kind == 12) {
    vec2 tuv = vec2(vUv.x, vWorld.y) * S_BAYU_TIMBER;
    vec3 tint = style == ST_TEMPLE ? vec3(0.38, 0.07, 0.05) : vec3(0.18, 0.10, 0.06);
    MatS m = matTint(L_BAYU_TIMBER, tuv, C_BAYU_TIMBER, tint);
    s.albedo = m.albedo; s.roughness = 0.48;
    s.normal = normalize(T * m.n.x + Bv * m.n.y + N * m.n.z);
    if (lights > 0.01) s.emissive = m.albedo * vec3(1.0, 0.58, 0.18) * (0.35 * lights);
  } else if (kind == 13) {
    // Multi-part 3D AC Outdoor Unit casing: detailed dark recessed fan grille, radial blades, brand panel & rust patina!
    float boxH = max(vEdge.x, 0.1);
    float boxY0 = vEdge.z;
    vec2 uv = vec2(clamp(vUv.x, 0.0, 1.0), clamp((vUv.y - boxY0) / boxH, 0.0, 1.0));
    float rust = smoothstep(0.65, 0.95, vnoise(uv * 9.0 + vEdge.y)) * smoothstep(0.45, 0.0, uv.y);
    vec3 casing = mix(vec3(0.66, 0.65, 0.61), vec3(0.52, 0.51, 0.48), hash11(vEdge.y * 0.71));
    casing = mix(casing, vec3(0.38, 0.24, 0.16), rust * 0.42);
    vec2 fc = (uv - vec2(0.35, 0.50)) * vec2(1.42, 1.0);
    float rad = length(fc);
    float fanHole = smoothstep(0.40, 0.36, rad);
    float rings = step(0.72, fract(rad * 18.0));
    float spoke = step(0.88, abs(sin(atan(fc.y, fc.x) * 4.0)));
    float blades = smoothstep(0.20, 0.65, sin(atan(fc.y, fc.x) * 3.0 + vEdge.y));
    vec3 fanCol = mix(vec3(0.04, 0.045, 0.055), vec3(0.24, 0.25, 0.26), max(max(rings * 0.75, spoke * 0.45), blades * 0.32));
    float panel = step(0.70, uv.x) * step(uv.x, 0.94) * step(0.12, uv.y) * step(uv.y, 0.88);
    float logo = step(0.75, uv.x) * step(uv.x, 0.89) * step(0.72, uv.y) * step(uv.y, 0.80);
    float border = step(min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)), 0.04);
    vec3 col = mix(casing * (1.0 - 0.12 * panel), fanCol, fanHole);
    col = mix(col, vec3(0.18, 0.26, 0.38), logo * 0.7);
    s.albedo = col * (1.0 - 0.28 * border);
    s.roughness = mix(0.46, 0.68, fanHole);
    s.metalness = 0.45;
  } else if (kind == 14) {
    // 3D Street-level shop awning / rain canopy with realistic canvas weave & rain weathering!
    float asd = vEdge.y;
    vec3 c1 = pick4(hash11(asd), vec3(0.62, 0.10, 0.08), vec3(0.08, 0.22, 0.46), vec3(0.08, 0.34, 0.18), vec3(0.66, 0.32, 0.08));
    vec3 c2 = vec3(0.82, 0.79, 0.72);
    float stripe = hash11(asd + 3.7) > 0.32 ? step(0.5, fract(vUv.x * 2.2)) : 0.0;
    float rib = 0.90 + 0.10 * sin(vUv.x * 28.0);
    float weather = 0.86 + 0.18 * vnoise(vec2(vUv.x * 3.5, vWorld.y * 4.0) + asd);
    s.albedo = mix(c1, c2, stripe * 0.82) * rib * weather;
    s.roughness = mix(0.80, 0.30, wet);
  } else if (kind == 15) {
    // 3D Horizontal Chongqing Illuminated Shop Signboard Lightbox (bloom-safe saturation!)
    float boxH = max(vEdge.x, 0.1);
    float boxSeed = vEdge.y;
    float boxY0 = vEdge.z;
    float aspect = max(vEdge.w, 1.5);
    vec2 uv = vec2(clamp(vUv.x, 0.0, 1.0), clamp((vUv.y - boxY0) / boxH, 0.0, 1.0));
    float smask; vec3 sbg;
    vec3 sc = sampleSignH(uv, aspect, boxSeed, smask, sbg);
    float lightBg = step(0.44, dot(sbg, vec3(0.3, 0.6, 0.1)));
    vec3 vivid = pow(max(sc, 0.0), vec3(1.30));
    float lbBoost = mix(mix(0.65, 2.40, smask), mix(1.35, 0.05, smask), lightBg);
    float edgeGlow = 0.86 + 0.14 * smoothstep(0.0, 0.18, min(uv.y, 1.0 - uv.y));
    s.albedo = sc * 0.88;
    s.roughness = 0.24; s.reflectance = 0.68;
    s.emissive = vivid * (0.16 + 1.85 * lights) * lbBoost * edgeGlow;
  } else if (kind == 16) {
    // 3D Vertical Chongqing Neon / LED Blade Sign
    float boxH = max(vEdge.x, 0.1);
    float boxSeed = vEdge.y;
    float boxY0 = vEdge.z;
    vec2 uv = vec2(clamp(vUv.x, 0.0, 1.0), clamp((vUv.y - boxY0) / boxH, 0.0, 1.0));
    float smask; vec3 neonRim;
    vec3 sc = sampleSignV(uv, boxSeed, smask, neonRim);
    vec3 vivid = pow(max(sc, 0.0), vec3(1.25));
    s.albedo = sc * 0.88;
    s.roughness = 0.22; s.reflectance = 0.70;
    float border = smoothstep(0.09, 0.02, min(uv.x, 1.0 - uv.x)) + smoothstep(0.04, 0.01, min(uv.y, 1.0 - uv.y));
    s.emissive = vivid * (0.22 + 2.40 * lights) * mix(0.55, 1.95, smask) + neonRim * (clamp(border, 0.0, 1.0) * (0.25 + 3.2 * lights));
  } else if (kind == 17) {
    float aspect = vEdge.w;
    if (aspect > 0.2) {
      float boxH = max(vEdge.x, 0.5);
      float boxSeed = vEdge.y;
      float boxY0 = vEdge.z;
      vec2 uv = vec2(clamp(vUv.x, 0.0, 1.0), clamp((vUv.y - boxY0) / boxH, 0.0, 1.0));
      vec3 bg = pick4(hash11(boxSeed),
        vec3(0.08, 0.05, 0.12), vec3(0.32, 0.04, 0.05), vec3(0.04, 0.10, 0.22), vec3(0.10, 0.08, 0.06));
      vec3 accent = pick4(hash11(boxSeed + 4.1),
        vec3(1.0, 0.72, 0.22), vec3(0.95, 0.24, 0.18), vec3(0.24, 0.78, 1.0), vec3(0.96, 0.94, 0.88));
      float stripe = smoothstep(0.02, 0.0, abs(uv.y - 0.18)) + smoothstep(0.02, 0.0, abs(uv.y - 0.82));
      float sideBar = step(uv.x, 0.045) + step(0.955, uv.x);
      float diagGlow = smoothstep(0.16, 0.0, abs(uv.x * 0.7 - uv.y * 0.5 - 0.12 + 0.04 * sin(uTime * 0.5 + boxSeed)));
      vec3 panel = bg + accent * (0.14 * diagGlow + 0.55 * clamp(stripe + sideBar, 0.0, 1.0));
      float textMask = 0.0;
#ifdef HAS_SIGNS
      if (uSigns.x > 0.5) {
        vec2 tu = (uv - vec2(0.5, 0.52)) * vec2(max(aspect, 1.2) / 3.4, 1.85) + 0.5;
        if (tu.x > 0.0 && tu.x < 1.0 && tu.y > 0.0 && tu.y < 1.0) {
          textMask = texture(tSigns, vec3(tu.x, 1.0 - tu.y, floor(hash11(boxSeed + 7.3) * uSigns.x))).r;
        }
      }
#endif
      vec3 screenCol = mix(panel, mix(vec3(0.98, 0.95, 0.88), accent, 0.35), textMask);
      float ledAA = aaKeep(1.0 / 96.0, max(fwidth(uv.x), fwidth(uv.y)));
      float grid = mix(0.96, 0.90 + 0.10 * step(0.14, fract(uv.x * 96.0)) * step(0.14, fract(uv.y * 54.0)), ledAA);
      s.albedo = screenCol * 0.42 * grid;
      s.roughness = 0.14; s.reflectance = 0.72;
      s.emissive = screenCol * grid * mix(0.45 + 0.65 * textMask, 4.6 * mix(0.45, 1.65, textMask), lights);
    } else {
      s.albedo = vec3(0.32, 0.35, 0.39); s.roughness = 0.25; s.metalness = 0.85;
      if (lights > 0.01) {
        vec3 ledCol = pick4(hash11(seed * 0.77 + pal * 0.19),
          vec3(1.0, 0.72, 0.26), vec3(0.26, 0.74, 1.0), vec3(1.0, 0.28, 0.42), vec3(0.95, 0.96, 1.0));
        float pulse = 0.82 + 0.18 * sin(uTime * 1.4 + vWorld.y * 0.08 + seed);
        s.emissive = ledCol * (3.6 * lights * pulse);
      }
    }
  } else if (kind == 18) {
    // Dark powder-coated balcony metal handrails & iron pickets
    s.albedo = vec3(0.13, 0.14, 0.16); s.roughness = 0.38; s.metalness = 0.78;
  } else if (kind == 19) {
    float blink = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 3.1 + seed * 1.7), 2.0);
    s.albedo = vec3(0.6, 0.04, 0.04); s.roughness = 0.2;
    s.emissive = vec3(1.0, 0.08, 0.05) * (0.4 + 14.0 * lights * blink);
  } else if (kind == 20) {
    float carvAA = aaKeep(0.19, max(fwidth(vUv.x), fwidth(vWorld.y)));
    vec2 fuv = vec2(vUv.x, vWorld.y) * 5.2;
    vec2 gf = abs(fract(fuv) - 0.5);
    float bar = smoothstep(0.38, 0.44, max(gf.x, gf.y));
    float crossD = smoothstep(0.08, 0.02, abs(gf.x - gf.y));
    float lattice = mix(0.45, max(bar, crossD), carvAA);
    s.albedo = mix(vec3(0.06, 0.03, 0.02), vec3(0.22, 0.11, 0.06), lattice);
    s.roughness = 0.52;
    if (lights > 0.01) s.emissive = vec3(1.0, 0.58, 0.18) * (1.5 * lights * (1.0 - lattice * 0.4));
  } else if (kind == 21) {
    // Dark bronze/charcoal window & shopfront aluminum mullions
    s.albedo = vec3(0.10, 0.105, 0.115); s.roughness = 0.34; s.metalness = 0.72;
  } else if (kind == 22) {
    // Weathered white/grey exterior PVC drainpipe (落水管) & AC refrigerant conduit!
    float grime = 0.78 + 0.22 * vnoise(vec2(vUv.x * 12.0, vWorld.y * 1.6) + seed);
    float jointRing = smoothstep(0.03, 0.0, abs(fract(vWorld.y / 3.2) - 0.5));
    s.albedo = mix(vec3(0.64, 0.65, 0.63), vec3(0.42, 0.43, 0.41), jointRing * 0.65) * grime;
    s.roughness = mix(0.34, 0.18, wet); s.metalness = 0.06;
  } else if (kind == 23) {
    // Brushed stainless-steel window anti-theft security cages (防盗网) & shop door pull-handles!
    float grain = 0.90 + 0.16 * vnoise(vec2(vUv.x * 40.0, vWorld.y * 40.0));
    s.albedo = vec3(0.70, 0.73, 0.76) * grain;
    s.roughness = 0.24; s.metalness = 0.90;
  } else if (kind == 24) {
    // Subtropical Chongqing balcony potted greenery & trailing shrubs (阳台盆栽绿植)!
    float pSeed = vEdge.y;
    float leafN = vnoise(vWorld.xz * 14.0 + vWorld.y * 12.0 + pSeed) * 0.6 + vnoise(vWorld.xz * 34.0 + vWorld.y * 28.0) * 0.4;
    vec3 cDark = vec3(0.035, 0.11, 0.03);
    vec3 cMid = mix(vec3(0.07, 0.22, 0.055), vec3(0.11, 0.26, 0.065), hash11(pSeed * 1.7));
    vec3 cTip = vec3(0.18, 0.34, 0.09);
    s.albedo = mix(mix(cDark, cMid, smoothstep(0.2, 0.65, leafN)), cTip, smoothstep(0.65, 0.92, leafN));
    s.roughness = 0.74; s.ao = 0.55 + 0.45 * leafN;
    s.normal = normalize(N + vec3(vnoise(vWorld.xy * 26.0) - 0.5, vnoise(vWorld.yz * 26.0) - 0.5, 0.0) * 0.55);
  } else if (kind == 25) {
    // Lived-in Chongqing balcony hanging laundry / drying clothes (阳台晾晒衣物)!
    float cSeed = vEdge.y;
    float h = hash11(cSeed * 1.37 + 0.9);
    vec3 fabric = pick4(h,
      vec3(0.76, 0.73, 0.66),  // warm cotton cream
      vec3(0.18, 0.28, 0.44),  // washed denim indigo
      vec3(0.58, 0.20, 0.17),  // soft brick terracotta
      vec3(0.42, 0.54, 0.62)); // faded sky cotton
    if (hash11(cSeed * 2.9) > 0.68) fabric = mix(vec3(0.24, 0.25, 0.27), vec3(0.54, 0.58, 0.48), hash11(cSeed * 4.1));
    float drape = 0.84 + 0.16 * sin(vWorld.x * 24.0 + vWorld.z * 24.0 + cSeed);
    s.albedo = fabric * drape;
    s.roughness = 0.90; s.metalness = 0.0;
  } else if (kind == 26) {
    // Exterior architectural bronze pier wall sconce & shop soffit downlight (glows warm 2700K at night!)
    s.albedo = vec3(0.18, 0.15, 0.11); s.roughness = 0.32; s.metalness = 0.55;
    s.emissive = vec3(1.0, 0.74, 0.34) * (0.18 + 5.2 * lights);
  } else if (kind == 27) {
    // Terracotta balcony planter boxes (upper) / bush-hammered granite storefront threshold steps (ground)
    float yRel = vUv.y - vEdge.z;
    if (yRel < 1.0) {
      MatS m = matTint(L_GRANITE, vec2(vUv.x, vWorld.y) * S_GRANITE * 1.8, C_GRANITE, vec3(0.32, 0.31, 0.30));
      s.albedo = m.albedo * 0.85; s.roughness = mix(0.72, 0.28, wet);
      s.normal = normalize(T * m.n.x + Bv * m.n.y + N * m.n.z);
    } else {
      float clay = 0.88 + 0.20 * vnoise(vWorld.xz * 12.0 + vWorld.y * 8.0);
      s.albedo = vec3(0.46, 0.24, 0.15) * clay;
      s.roughness = 0.84;
    }
  } else if (kind == 28) {
    // Galvanized structural steel awning brackets, AC L-brackets, balustrade spigots & roof pipes
    float patina = 0.88 + 0.20 * vnoise(vec2(vUv.x * 18.0, vWorld.y * 18.0));
    s.albedo = vec3(0.26, 0.28, 0.30) * patina;
    s.roughness = 0.38; s.metalness = 0.84;
  } else {
    shadeRoof(s, kind);
  }

  writeGBuffer(s);
}`;

const DEPTH_VERT = /* glsl */`${PRECISION}
in vec4 aPos;
uniform mat4 modelViewMatrix, projectionMatrix;
void main() {
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(aPos.xyz, 1.0));
}`;

const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }`;

export function createBuildingMaterials(env, lib) {
  const su = lib.signUniforms || {};
  const iu = lib.interiorUniforms || lib.uniforms || {};
  const hasSigns = !!(su.tSigns && su.tSigns.value && su.uSigns && su.uSigns.value && su.uSigns.value.x > 0.5);
  const hasSignsVert = !!(su.tSignsVert && su.tSignsVert.value && su.uSignsVert && su.uSignsVert.value && su.uSignsVert.value.x > 0.5);
  // Always bind tInteriorsArr when matlib provides it (shader checks uInteriors.w > 0.5 at runtime too!)
  const hasInteriors = !!(iu.tInteriorsArr && iu.tInteriorsArr.value && iu.uInteriors && iu.uInteriors.value);

  const defines = {};
  if (hasSigns) defines.HAS_SIGNS = 1;
  if (hasSignsVert) defines.HAS_SIGNS_VERT = 1;
  if (hasInteriors) defines.HAS_INTERIORS = 1;

  const uniforms = {
    tMatAlbedo: lib.uniforms.tMatAlbedo,
    tMatNR: lib.uniforms.tMatNR,
    uNight: env.uniforms.uNight,
    uLightDir: env.uniforms.uLightDir,
    uTime: env.uniforms.uTime,
  };
  if (hasSigns) {
    uniforms.tSigns = su.tSigns;
    uniforms.uSigns = su.uSigns;
  }
  if (hasSignsVert) {
    uniforms.tSignsVert = su.tSignsVert;
    uniforms.uSignsVert = su.uSignsVert;
  }
  if (hasInteriors) {
    uniforms.tInteriorsArr = iu.tInteriorsArr;
    uniforms.uInteriors = iu.uInteriors;
  }

  const material = gbufferMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG(lib),
    uniforms,
    defines,
    name: 'building',
  });
  const depth = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: DEPTH_VERT,
    fragmentShader: DEPTH_FRAG,
    colorWrite: false,
  });
  depth.name = 'buildingDepth';
  return { material, depth };
}
