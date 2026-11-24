// Building materials.
//
// Walls are flat quads; everything that makes a facade read as built is resolved per pixel:
//   * a floor / bay grid derived from the building's storeys and the length of each wall edge,
//   * openings that are really recessed: the view ray is intersected with the reveal box, so jambs, heads and sills
//     appear with correct parallax, and the sun's shadow inside the recess is computed analytically,
//   * rooms behind the glass (interior mapping) with curtains, and lights that come on at dusk,
//   * photographic PBR wall materials tinted per building / housing estate, plus rain streaks and grime,
//   * shop fronts with sign boards on street-facing ground floors.
// Roofs, parapets and block masses share the shader (surface kind per vertex).

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { gbufferMaterial } from '../engine/materials.js';

const VERT = /* glsl */`${PRECISION}
in vec4 aPos; in vec4 aNrm; in vec4 aBld; in vec2 aEdge; in vec4 aFlag;
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
out vec3 vWorld; out vec3 vView; out vec3 vNormal; out vec2 vUv; out vec2 vTex;
flat out vec4 vBld; flat out vec4 vFlag; flat out vec2 vEdge; flat out float vKind;
void main() {
  vec3 p = aPos.xyz * (1.0 / 40.0);
  vUv = vec2(aPos.w * (1.0 / 40.0), p.y);
  vNormal = aNrm.xyz * (1.0 / 127.0);
  vKind = aNrm.w;
  vBld = aBld; vFlag = aFlag; vEdge = aEdge * (1.0 / 40.0);
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
uniform mat4 viewMatrix;
uniform vec3 uLightDir;
uniform vec4 uNight;            // x: night, y: city lights 0..1, z: wetness, w: frame
uniform float uTime;
in vec3 vWorld; in vec3 vView; in vec3 vNormal; in vec2 vUv; in vec2 vTex;
flat in vec4 vBld; flat in vec4 vFlag; flat in vec2 vEdge; flat in float vKind;

// ---- style ids (keep in sync with styles.js)
const int ST_GENERIC = 0, ST_SLAB = 1, ST_TOWER = 2, ST_LILONG = 3, ST_VILLA = 4, ST_GLASS = 5, ST_GRID = 6, ST_RETAIL = 7, ST_IND = 8, ST_PUBLIC = 9,
  ST_HERITAGE = 10, ST_TEMPLE = 11, ST_BIGROOF = 12, ST_CANOPY = 13, ST_TANK = 14, ST_CONSTR = 15, ST_VILLAGE = 16, ST_HOTEL = 17, ST_PARKING = 18;

struct Facade {
  float bay;          // nominal bay width (m)
  vec2 win;           // window width (fraction of bay), height (fraction of storey)
  float sill;         // sill height (fraction of storey)
  float depth;        // reveal depth (m)
  float frame;        // frame thickness (m)
  vec2 panes;         // mullion divisions
  float layer, scale; vec3 mean, tint;   // wall material
  vec3 glass;         // glass tint
  float refl;         // glass reflectance parameter
  float curtain;      // 1 = curtain wall
  float margin;       // solid corner (m)
  vec3 frameCol;
  float shop;         // may carry shops at street level
  float office;       // 1 = office-type interiors and lighting
};

vec3 pick4(float h, vec3 a, vec3 b, vec3 c, vec3 d) { return h < 0.25 ? a : h < 0.5 ? b : h < 0.75 ? c : d; }

Facade facadeFor(int style, float pal, float seed, bool south) {
  float h = hash11(pal * 0.731 + 1.7), h2 = hash11(pal * 1.37 + 9.1), h3 = hash11(seed * 0.513 + pal * 0.11);
  Facade F;
  F.bay = 3.4; F.win = vec2(0.5, 0.5); F.sill = 0.3; F.depth = 0.16; F.frame = 0.05; F.panes = vec2(2.0, 1.0);
  F.layer = L_PLASTER; F.scale = S_PLASTER; F.mean = C_PLASTER; F.tint = vec3(0.56, 0.53, 0.48);
  F.glass = vec3(0.55, 0.62, 0.62); F.refl = 0.62; F.curtain = 0.0; F.margin = 0.7; F.frameCol = vec3(0.62); F.shop = 1.0; F.office = 0.0;
  if (style == ST_SLAB) {
    // walk-up slabs: painted render or small tiles, estate-wide colour
    F.bay = 3.3; F.win = south ? vec2(0.56, 0.52) : vec2(0.36, 0.42); F.sill = south ? 0.30 : 0.36; F.depth = 0.14;
    F.tint = pick4(h, vec3(0.60, 0.55, 0.44), vec3(0.62, 0.60, 0.55), vec3(0.56, 0.42, 0.34), vec3(0.50, 0.52, 0.50)) * (0.92 + 0.16 * h2);
    if (h2 > 0.62) { F.layer = L_TILES_WHITE; F.scale = S_TILES_WHITE * 2.4; F.mean = C_TILES_WHITE; F.tint *= 1.05; }
    else if (h2 > 0.30) { F.layer = L_PLASTER_STAINED; F.scale = S_PLASTER_STAINED; F.mean = C_PLASTER_STAINED; }
    F.frameCol = h3 > 0.5 ? vec3(0.70) : vec3(0.32, 0.33, 0.34);
  } else if (style == ST_TOWER) {
    F.bay = 3.6; F.win = south ? vec2(0.62, 0.56) : vec2(0.40, 0.46); F.sill = 0.28; F.depth = 0.18;
    F.tint = pick4(h, vec3(0.58, 0.50, 0.40), vec3(0.66, 0.64, 0.60), vec3(0.47, 0.30, 0.22), vec3(0.52, 0.53, 0.54)) * (0.92 + 0.16 * h2);
    if (h2 > 0.45) { F.layer = L_TILES_WHITE; F.scale = S_TILES_WHITE * 2.0; F.mean = C_TILES_WHITE; }
    F.frameCol = vec3(0.30, 0.31, 0.33); F.glass = vec3(0.50, 0.60, 0.58);
  } else if (style == ST_LILONG) {
    F.bay = 3.2; F.win = vec2(0.40, 0.50); F.sill = 0.30; F.depth = 0.20; F.panes = vec2(2.0, 2.0); F.margin = 0.5;
    if (h > 0.45) { F.layer = L_BRICK_RED; F.scale = S_BRICK_RED; F.mean = C_BRICK_RED; F.tint = vec3(0.30, 0.13, 0.09) * (0.9 + 0.3 * h2); }
    else { F.layer = L_BRICK_GREY; F.scale = S_BRICK_GREY; F.mean = C_BRICK_GREY; F.tint = vec3(0.19, 0.19, 0.19) * (0.9 + 0.3 * h2); }
    F.frameCol = pick4(h3, vec3(0.20, 0.10, 0.07), vec3(0.10, 0.22, 0.16), vec3(0.45, 0.42, 0.36), vec3(0.16, 0.10, 0.08));
  } else if (style == ST_VILLA || style == ST_VILLAGE) {
    F.bay = 3.6; F.win = vec2(0.46, 0.50); F.sill = 0.30; F.depth = 0.15; F.margin = 0.6;
    F.tint = pick4(h, vec3(0.66, 0.64, 0.58), vec3(0.62, 0.55, 0.42), vec3(0.58, 0.44, 0.34), vec3(0.60, 0.60, 0.60)) * (0.9 + 0.2 * h3);
    if (style == ST_VILLAGE && h2 > 0.5) { F.layer = L_TILES_WHITE; F.scale = S_TILES_WHITE; F.mean = C_TILES_WHITE; }
    F.frameCol = vec3(0.66);
  } else if (style == ST_GLASS) {
    F.curtain = 1.0; F.bay = h2 > 0.5 ? 1.5 : 1.2; F.depth = 0.05; F.frame = 0.06; F.margin = 0.0; F.office = 1.0;
    F.glass = pick4(h, vec3(0.22, 0.36, 0.48), vec3(0.26, 0.40, 0.42), vec3(0.34, 0.38, 0.42), vec3(0.42, 0.36, 0.26));
    F.refl = 0.86 + 0.12 * h3; F.frameCol = h2 > 0.4 ? vec3(0.42, 0.44, 0.46) : vec3(0.10, 0.11, 0.12);
    F.layer = L_METAL_PANEL; F.scale = S_METAL_PANEL; F.mean = C_METAL_PANEL; F.tint = vec3(0.36, 0.37, 0.39);
  } else if (style == ST_GRID || style == ST_HOTEL || style == ST_PUBLIC) {
    F.bay = style == ST_HOTEL ? 3.9 : 3.0; F.win = vec2(0.70, 0.52); F.sill = 0.26; F.depth = 0.20; F.panes = vec2(2.0, 1.0); F.office = style == ST_HOTEL ? 0.0 : 1.0;
    F.tint = pick4(h, vec3(0.52, 0.50, 0.47), vec3(0.62, 0.60, 0.57), vec3(0.44, 0.38, 0.31), vec3(0.55, 0.56, 0.58)) * (0.9 + 0.2 * h2);
    if (h2 > 0.55) { F.layer = L_GRANITE; F.scale = S_GRANITE; F.mean = C_GRANITE; }
    else if (h2 > 0.25) { F.layer = L_TILES_WHITE; F.scale = S_TILES_WHITE * 1.6; F.mean = C_TILES_WHITE; }
    F.frameCol = vec3(0.26, 0.27, 0.29); F.glass = pick4(h3, vec3(0.34, 0.46, 0.52), vec3(0.40, 0.50, 0.46), vec3(0.45, 0.48, 0.50), vec3(0.30, 0.42, 0.50));
    F.refl = 0.72;
  } else if (style == ST_RETAIL) {
    F.bay = 4.8; F.win = vec2(0.72, 0.34); F.sill = 0.42; F.depth = 0.12; F.office = 1.0;
    F.layer = L_METAL_PANEL; F.scale = S_METAL_PANEL * 0.5; F.mean = C_METAL_PANEL;
    F.tint = pick4(h, vec3(0.56, 0.55, 0.52), vec3(0.42, 0.43, 0.45), vec3(0.60, 0.50, 0.38), vec3(0.50, 0.30, 0.24));
    F.frameCol = vec3(0.2);
  } else if (style == ST_IND || style == ST_BIGROOF) {
    F.bay = 6.0; F.win = vec2(0.72, 0.16); F.sill = 0.70; F.depth = 0.08; F.panes = vec2(4.0, 1.0); F.shop = 0.0; F.office = 1.0;
    if (h > 0.4) { F.layer = L_CORRUGATED; F.scale = S_CORRUGATED; F.mean = C_CORRUGATED; F.tint = pick4(h2, vec3(0.56, 0.57, 0.58), vec3(0.34, 0.44, 0.56), vec3(0.60, 0.58, 0.52), vec3(0.50, 0.52, 0.50)); }
    else { F.layer = L_CONCRETE_PANEL; F.scale = S_CONCRETE_PANEL; F.mean = C_CONCRETE_PANEL; F.tint = vec3(0.42, 0.41, 0.39); }
    F.frameCol = vec3(0.22);
  } else if (style == ST_HERITAGE) {
    F.bay = 3.4; F.win = vec2(0.42, 0.60); F.sill = 0.22; F.depth = 0.32; F.panes = vec2(2.0, 3.0); F.margin = 0.9;
    F.layer = L_GRANITE; F.scale = S_GRANITE * 0.8; F.mean = C_GRANITE;
    F.tint = pick4(h, vec3(0.44, 0.40, 0.34), vec3(0.50, 0.47, 0.42), vec3(0.38, 0.33, 0.27), vec3(0.47, 0.44, 0.40)) * (0.9 + 0.2 * h2);
    if (h2 > 0.72) { F.layer = L_BRICK_RED; F.scale = S_BRICK_RED; F.mean = C_BRICK_RED; F.tint = vec3(0.30, 0.13, 0.09); }
    F.frameCol = vec3(0.13, 0.11, 0.09); F.glass = vec3(0.45, 0.50, 0.46);
  } else if (style == ST_TEMPLE) {
    F.bay = 3.2; F.win = vec2(0.66, 0.56); F.sill = 0.24; F.depth = 0.12; F.panes = vec2(4.0, 4.0); F.margin = 0.4; F.shop = 0.0;
    F.tint = vec3(0.70, 0.69, 0.65); F.frameCol = vec3(0.20, 0.07, 0.05); F.glass = vec3(0.80, 0.78, 0.70);
  } else if (style == 20) {
    // landmark curtain walls: the palette byte picks the glass
    int k = int(pal + 0.5);
    F.curtain = 1.0; F.bay = 1.5; F.depth = 0.05; F.frame = 0.055; F.margin = 0.0; F.office = 1.0; F.shop = 0.0;
    F.glass = k == 0 ? vec3(0.40, 0.52, 0.56) : k == 1 ? vec3(0.22, 0.33, 0.44) : k == 2 ? vec3(0.42, 0.44, 0.44) : k == 3 ? vec3(0.10, 0.12, 0.14) : k == 4 ? vec3(0.50, 0.42, 0.26) : vec3(0.30, 0.40, 0.46);
    F.refl = k == 2 ? 1.0 : 0.94; F.frameCol = k == 2 ? vec3(0.55, 0.56, 0.56) : k == 3 ? vec3(0.08) : vec3(0.36, 0.38, 0.40);
    F.layer = L_METAL_PANEL; F.scale = S_METAL_PANEL; F.mean = C_METAL_PANEL; F.tint = vec3(0.40, 0.41, 0.42);
  } else if (style == ST_PARKING) {
    F.bay = 7.5; F.win = vec2(0.92, 0.52); F.sill = 0.36; F.depth = 0.5; F.frame = 0.0; F.shop = 0.0;
    F.layer = L_CONCRETE; F.scale = S_CONCRETE; F.mean = C_CONCRETE; F.tint = vec3(0.45);
  }
  return F;
}

// ---- recess: where does the view ray land inside an opening?  0 wall, 1 reveal, 2 glazing plane
int recessHit(vec2 p, vec4 ap, float D, vec3 d, out vec2 q, out vec3 nT, out float dh) {
  q = p; nT = vec3(0.0, 0.0, 1.0); dh = 0.0;
  if (p.x < ap.x || p.x > ap.y || p.y < ap.z || p.y > ap.w) return 0;
  float tz = D / max(-d.z, 1e-3);
  float tx = d.x > 1e-5 ? (ap.y - p.x) / d.x : (d.x < -1e-5 ? (ap.x - p.x) / d.x : 1e9);
  float ty = d.y > 1e-5 ? (ap.w - p.y) / d.y : (d.y < -1e-5 ? (ap.z - p.y) / d.y : 1e9);
  float ts = min(tx, ty);
  if (ts < tz) { q = p + d.xy * ts; dh = ts * -d.z; nT = tx < ty ? vec3(-sign(d.x), 0.0, 0.0) : vec3(0.0, -sign(d.y), 0.0); return 1; }
  q = p + d.xy * tz; dh = D;
  return 2;
}
// sun reaching a point at depth dh behind the opening
float recessSun(vec2 q, float dh, vec4 ap, vec3 Lt) {
  if (Lt.z < 0.02) return 1.0;
  vec2 e = q + Lt.xy * (dh / Lt.z);
  float m = min(min(e.x - ap.x, ap.y - e.x), min(e.y - ap.z, ap.w - e.y));
  return smoothstep(-0.012, 0.02, m);
}

// ---- a room seen through glass. q: position on the glass plane inside the room box [0, size]; d: ray (tangent space)
vec3 goods(vec2 c, float rs) {
  // a shelf cell: a packet of some bright colour, a strip of shadow under each shelf board
  vec2 id = floor(c), f = fract(c);
  vec3 h = hash32(id + rs);
  vec3 col = mix(vec3(0.75, 0.2, 0.15), vec3(0.2, 0.45, 0.75), h.x);
  col = mix(col, vec3(0.85, 0.70, 0.25), step(0.80, h.y)); col = mix(col, vec3(0.86), step(0.72, h.z)); col = mix(col, vec3(0.25, 0.5, 0.3), step(0.9, h.x));
  col = mix(col, vec3(dot(col, vec3(0.333))), 0.38) * (0.45 + 0.5 * h.y);
  float gap = step(0.08, f.x) * step(f.x, 0.92) * step(0.14, f.y);
  return mix(vec3(0.10, 0.09, 0.08), col, gap);
}
vec3 shopColor(vec2 q, vec2 size, vec3 d, float rs, float lit, out vec3 glow) {
  float RD = 4.5 + 3.0 * hash11(rs + 0.3);
  // low display stands half way in: a ray that dips below their top lands on stock instead of the floor
  float standZ = 1.3 + 0.5 * hash11(rs + 1.1), standH = 0.95 + 0.3 * hash11(rs + 1.2);
  float tS = standZ / max(-d.z, 1e-3);
  vec2 ps = q + d.xy * tS;
  vec3 col; float depth;
  bool onStand = ps.y < standH && ps.y > 0.0 && ps.x > size.x * 0.12 && ps.x < size.x * 0.88 && fract(ps.x / 1.6 + hash11(rs + 1.3)) < 0.72;
  if (onStand) { col = goods(vec2(ps.x / 0.22, ps.y / 0.26), rs + 3.0); depth = standZ; }
  else {
    float tx = d.x > 1e-5 ? (size.x - q.x) / d.x : (d.x < -1e-5 ? -q.x / d.x : 1e9);
    float ty = d.y > 1e-5 ? (size.y - q.y) / d.y : (d.y < -1e-5 ? -q.y / d.y : 1e9);
    float tz = RD / max(-d.z, 1e-3);
    float t = min(tx, min(ty, tz));
    vec3 h = vec3(q, 0.0) + d * t;
    depth = -h.z;
    if (t == tz) {
      // back wall: shelving up to door height, a counter, a menu / price board above
      col = h.y < 2.1 ? goods(vec2(h.x / 0.24, h.y / 0.34), rs) : mix(vec3(0.72, 0.70, 0.66), vec3(0.75, 0.16, 0.12), step(0.5, hash11(rs + 8.0)) * step(2.3, h.y) * step(h.y, 2.9));
    } else if (t == ty) {
      if (d.y > 0.0) { vec2 g = fract(vec2(h.x, -h.z) / vec2(1.4, 1.2)); col = mix(vec3(0.78), vec3(2.2), step(0.2, g.x) * step(g.x, 0.8) * step(0.44, g.y) * step(g.y, 0.56)); }
      else { vec2 g = fract(vec2(h.x, -h.z) / 0.6); col = vec3(0.62, 0.60, 0.56) * (0.9 + 0.1 * step(0.03, min(g.x, g.y))); }
    } else col = h.y < 2.0 ? goods(vec2(-h.z / 0.24, h.y / 0.34), rs + 5.0) * 0.85 : vec3(0.66, 0.64, 0.60);
  }
  vec3 lamp = mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.86, 0.66), step(0.7, hash11(rs + 6.1)));
  float fall = 1.0 / (1.0 + 0.16 * depth);
  glow = col * lamp * (0.55 + 0.45 * fall) * lit;
  return col * (0.30 + 0.5 * fall);
}

vec3 roomColor(vec2 q, vec2 size, vec3 d, float rs, float office, float lit, out vec3 glow) {
  float RD = 3.8 + 2.4 * hash11(rs + 0.3);
  float tx = d.x > 1e-5 ? (size.x - q.x) / d.x : (d.x < -1e-5 ? -q.x / d.x : 1e9);
  float ty = d.y > 1e-5 ? (size.y - q.y) / d.y : (d.y < -1e-5 ? -q.y / d.y : 1e9);
  float tz = RD / max(-d.z, 1e-3);
  float t = min(tx, min(ty, tz));
  vec3 h = vec3(q, 0.0) + d * t;
  vec3 wallc = mix(vec3(0.62, 0.60, 0.56), pick4(hash11(rs + 4.1), vec3(0.66, 0.62, 0.52), vec3(0.55, 0.58, 0.60), vec3(0.62, 0.55, 0.50), vec3(0.50, 0.55, 0.50)), 0.6);
  vec3 col;
  if (t == tz) {
    col = wallc;
    // furniture silhouettes against the back wall: shelves, a door, a picture
    vec2 b = h.xy / size;
    float door = step(0.62, b.x) * step(b.x, 0.84) * step(b.y, 0.74);
    float shelf = step(b.x, 0.45) * step(b.y, 0.5 + 0.2 * hash11(rs + 2.0));
    col = mix(col, wallc * vec3(0.55, 0.45, 0.36), door * step(0.5, hash11(rs + 7.7)));
    col = mix(col, wallc * (0.45 + 0.3 * step(0.5, fract(b.y * 7.0))), shelf * step(0.4, hash11(rs + 5.5)));
    if (office > 0.5) col = wallc * (0.85 + 0.15 * step(0.5, fract(b.x * 3.0 + 0.2)));
  } else if (t == ty) {
    if (d.y > 0.0) { col = vec3(0.72);                                       // ceiling
      if (office > 0.5) { vec2 g = fract(vec2(h.x, -h.z) / vec2(1.2, 1.8)); col = mix(col, vec3(1.6), step(0.25, g.x) * step(g.x, 0.75) * step(0.42, g.y) * step(g.y, 0.58) * lit); }
    } else col = office > 0.5 ? vec3(0.30, 0.31, 0.33) : mix(vec3(0.34, 0.24, 0.16), vec3(0.45, 0.42, 0.38), step(0.5, hash11(rs + 3.3)));
  } else col = wallc * 0.86;
  float depth = -h.z;
  float fall = 1.0 / (1.0 + 0.30 * depth);
  // lamp: residential rooms have one warm source, offices an even ceiling
  vec3 lamp = office > 0.5 ? mix(vec3(0.92, 0.96, 1.0), vec3(1.0, 0.93, 0.82), step(0.6, hash11(rs + 6.1)))
                          : pick4(hash11(rs + 6.1), vec3(1.0, 0.72, 0.42), vec3(1.0, 0.80, 0.55), vec3(1.0, 0.90, 0.74), vec3(0.86, 0.92, 1.0));
  float lp = office > 0.5 ? 1.0 : 0.55 + 0.9 / (1.0 + 2.5 * length(vec3(h.x - size.x * 0.5, h.y - size.y * 0.8, h.z + RD * 0.5)));
  glow = col * lamp * lp * lit;
  return col * (0.20 + 0.55 * fall);
}

vec3 frameAndGlass(vec2 g, vec2 size, Facade F, float trans) {
  // returns x: frame mask
  float ft = F.frame;
  float fm = 0.0;
  if (ft > 0.0) {
    fm = (g.x < ft || g.x > size.x - ft || g.y < ft || g.y > size.y - ft) ? 1.0 : 0.0;
    vec2 cell = size / F.panes;
    vec2 m = abs(fract(g / cell + 0.5) - 0.5) * cell;
    if (m.x < ft * 0.5 || (F.panes.y > 1.5 && m.y < ft * 0.5)) fm = 1.0;
    if (trans > 0.5 && abs(g.y - size.y * 0.70) < ft * 0.5) fm = 1.0;       // transom of a casement window
  }
  return vec3(fm, 0.0, 0.0);
}

// ---- sign boards: a coloured light box carrying a shop name
uniform sampler2DArray tSigns;
uniform vec2 uSigns;            // x: number of signs (0 while the lettering is not loaded)
vec3 signBoard(vec2 p, vec2 size, float sd, out float mask) {
  vec3 bg = pick4(hash11(sd), vec3(0.62, 0.06, 0.05), vec3(0.05, 0.22, 0.50), vec3(0.75, 0.62, 0.10), vec3(0.06, 0.30, 0.16));
  if (hash11(sd + 1.3) > 0.6) bg = pick4(hash11(sd + 2.9), vec3(0.85), vec3(0.10), vec3(0.50, 0.26, 0.10), vec3(0.80, 0.42, 0.06));
  vec3 fg = dot(bg, vec3(0.3, 0.6, 0.1)) > 0.4 ? vec3(0.08, 0.06, 0.06) : vec3(0.92, 0.90, 0.84);
  if (hash11(sd + 4.7) > 0.7 && bg.r < 0.3) fg = vec3(0.95, 0.80, 0.20);
  // the lettering is laid out 4 : 1; fit it inside the board
  float s = min(size.x / 4.0, size.y);
  vec2 t = (p - size * 0.5) / vec2(4.0 * s, s) / 0.9 + 0.5;
  mask = 0.0;
  if (uSigns.x > 0.5 && t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0)
    mask = texture(tSigns, vec3(t.x, 1.0 - t.y, floor(hash11(sd + 5.1) * uSigns.x))).r;
  // a thin border, like a framed light box
  float edge = min(min(p.x, size.x - p.x), min(p.y, size.y - p.y));
  vec3 c = mix(bg, fg, mask);
  return mix(c, bg * 0.55, step(edge, 0.035));
}

void shadeWall(inout Surface s) {
  int style = int(vBld.x + 0.5); float seed = vBld.y, pal = vBld.z, levels = max(vBld.w, 1.0);
  float eflag = vFlag.x, fH = vFlag.y * (1.0 / 40.0), gH = vFlag.z * (1.0 / 20.0);
  float edgeLen = vEdge.x, topH = vEdge.y;
  vec3 N = normalize(vNormal);
  vec3 T = normalize(vec3(N.z, 0.0, -N.x)), Bv = vec3(0.0, 1.0, 0.0);
  vec3 V = normalize(-vView * mat3(viewMatrix));
  vec3 d = -vec3(dot(V, T), dot(V, Bv), dot(V, N));
  vec3 Lt = vec3(dot(uLightDir, T), dot(uLightDir, Bv), dot(uLightDir, N));
  float u = vUv.x, y = vUv.y;
  bool south = N.z > 0.25;
  Facade F = facadeFor(style, pal, seed, south);
  bool party = mod(floor(eflag * 0.5), 2.0) > 0.5, front = mod(eflag, 2.0) > 0.5;
  float px = max(fwidth(u), fwidth(y));                  // metres per pixel on the wall
  float lights = uNight.y;

  // ---- wall material + weathering
  vec2 wuv = vec2(u + seed * 0.37, y);
  MatS wm = matTint(F.layer, wuv * F.scale, F.mean, F.tint);
  float streakN = vnoise(vec2(u * 2.1 + seed, y * 0.10));
  float streak = smoothstep(0.5, 0.95, streakN) * (0.25 + 0.75 * smoothstep(topH - 9.0, topH, y));
  float grime = smoothstep(1.1, 0.0, y) * 0.35 + streak * 0.30 + 0.10 * vnoise(vWorld.xz * 0.5 + y * 0.3);
  if (F.curtain < 0.5) wm.albedo *= 1.0 - grime * (style == ST_HERITAGE ? 0.8 : 1.0);
  // grain finer than the texture, fading in as the camera comes close (keeps the wall from going soft)
  float closeK = 1.0 - smoothstep(0.0015, 0.007, px);
  if (closeK > 0.0) {
    float gr = vnoise(wuv * 260.0) * 0.6 + vnoise(wuv * 90.0) * 0.4;
    wm.albedo *= 1.0 + (gr - 0.5) * 0.22 * closeK;
    wm.n = normalize(wm.n + vec3(vnoise(wuv * 240.0 + 7.0) - 0.5, vnoise(wuv * 240.0 + 31.0) - 0.5, 0.0) * 0.35 * closeK);
    wm.rough = clamp(wm.rough + (gr - 0.5) * 0.2 * closeK, 0.05, 1.0);
  }
  vec3 albedo = wm.albedo; vec3 nT = wm.n; float rough = wm.rough; float metal = 0.0, refl = 0.5, ao = 1.0, micro = 1.0;
  vec3 emissive = vec3(0.0);
  if (F.layer == L_CORRUGATED || F.layer == L_METAL_PANEL) metal = 0.55;

  // ---- storey
  float yTop = gH + (levels - 1.0) * fH;
  float fi, fy, fh;
  if (y < gH) { fi = -1.0; fy = y; fh = gH; }
  else if (y < yTop) { fi = floor((y - gH) / fH); fy = y - gH - fi * fH; fh = fH; }
  else { fi = 999.0; fy = y - yTop; fh = max(topH - yTop, 0.2); }

  // ---- bays
  bool ground = fi < 0.0, capBand = fi > 900.0;
  bool shops = ground && front && F.shop > 0.5 && gH > 2.9 && edgeLen > 4.5;
  float bayN = shops ? 4.2 + 0.8 * hash11(seed + 3.0) : F.bay;
  float margin = shops ? 0.35 : F.margin;
  float usable = edgeLen - 2.0 * margin;
  float nb = floor(usable / bayN + 0.4);
  bool bays = nb >= 1.0 && !party && u > margin && u < edgeLen - margin;
  float bw = bays ? usable / nb : edgeLen;
  float ub = (u - margin) / bw;
  float ci = floor(ub);
  vec2 p = vec2((ub - ci) * bw, fy);                    // metres inside the cell
  float hb = hash11(ci * 1.13 + seed * 0.71 + (south ? 0.0 : 5.0));     // per bay (constant up the building)
  float hc = hash12(vec2(ci, fi) + seed * 0.37);                        // per cell
  float rs = hc * 97.0 + seed;                                          // room seed

  // heritage / temple articulation drawn on the wall plane
  if (style == ST_HERITAGE && !party) {
    if (ground) { float j = abs(fract(y / 0.48) - 0.5) * 0.48; albedo *= mix(0.55, 1.0, smoothstep(0.0, 0.035, j)); albedo *= 0.92; }
    // string courses and the main cornice
    float band = smoothstep(0.16, 0.0, abs(y - gH)) + smoothstep(0.30, 0.0, abs(y - yTop));
    albedo *= 1.0 + 0.16 * band;
    if (bays && !ground && !capBand) { float pil = smoothstep(0.34, 0.26, min(p.x, bw - p.x)); albedo *= 1.0 + 0.10 * pil; }
    if (capBand) { float dent = step(0.5, fract(u / 0.36)) * step(fy, 0.22); albedo *= 1.0 - 0.25 * dent; }
  }
  if (style == ST_TEMPLE && bays && !capBand) {
    float col = smoothstep(0.16, 0.12, min(p.x, bw - p.x));
    albedo = mix(albedo, F.frameCol * 1.2, col); rough = mix(rough, 0.55, col);
    if (y < 0.5) albedo = mix(albedo, vec3(0.25, 0.25, 0.26), 0.8);
  }
  // plinth
  if (ground && F.curtain < 0.5 && style != ST_TEMPLE && style != ST_IND) { float pl = step(y, 0.42); albedo = mix(albedo, albedo * 0.55 + 0.02, pl); rough = mix(rough, 0.75, pl); }

  // ---- opening in this cell
  vec4 ap = vec4(0.0); float D = F.depth; int kind = 0;        // 1 window, 2 curtain wall, 3 shop, 4 louvre, 5 door
  float signY0 = 0.0, signY1 = 0.0;
  if (bays) {
    if (capBand) {
      // plant floor louvres on towers
      if ((style == ST_TOWER || style == ST_GRID || style == ST_HOTEL) && fh > 1.6 && topH > 40.0 && hb > 0.3) { ap = vec4(bw * 0.12, bw * 0.88, 0.25, fh - 0.55); kind = 4; D = 0.10; }
      else if (F.curtain > 0.5) { ap = vec4(0.0, bw, 0.0, fh - 0.25); kind = 2; }
    } else if (F.curtain > 0.5) {
      ap = vec4(0.0, bw, 0.0, fh); kind = 2;
      if (ground) { ap = vec4(0.0, bw, 0.1, fh - 0.35); }
    } else if (shops) {
      float top = min(2.85, gH - 0.9);
      ap = vec4(0.28, bw - 0.28, 0.14, top); kind = 3; D = 0.14;
      signY0 = top + 0.14; signY1 = min(gH - 0.12, signY0 + 0.95);
    } else if (ground) {
      // entrances every few bays, otherwise windows (or blank for industry / big sheds)
      bool door = mod(ci + floor(seed * 0.07), 5.0) < 0.5 && style != ST_IND;
      if (door) { ap = vec4(bw * 0.5 - 0.75, bw * 0.5 + 0.75, 0.03, min(2.35, fh - 0.4)); kind = 5; D = 0.25; }
      else if (style != ST_IND && style != ST_BIGROOF && style != ST_RETAIL && fh > 2.4) {
        float w = bw * F.win.x * 0.9; ap = vec4((bw - w) * 0.5, (bw + w) * 0.5, max(0.95, fh * 0.3), min(fh - 0.35, 2.6)); kind = 1;
      } else if (style == ST_IND && hb > 0.72 && fh > 4.0) { ap = vec4(bw * 0.2, bw * 0.8, 0.03, min(4.2, fh - 0.5)); kind = 5; D = 0.2; }
    } else {
      // upper storeys
      vec2 win = F.win; float sill = F.sill;
      bool blank = false;
      if (style == ST_SLAB || style == ST_TOWER) {
        if (south) { if (hb > 0.55) { win = vec2(0.80, 0.60); sill = 0.26; } }           // balcony glazing
        else { if (hb > 0.78) { win = vec2(0.22, 0.26); sill = 0.52; } else if (hb < 0.14) blank = true; }
      } else if (style == ST_RETAIL) { blank = hb < 0.45; }
      else if (style == ST_LILONG || style == ST_VILLAGE || style == ST_VILLA) { blank = hb < 0.12; }
      if (!blank && fh > 2.0) {
        float w = bw * win.x, hgt = fh * win.y;
        ap = vec4((bw - w) * 0.5, (bw + w) * 0.5, fh * sill, min(fh * sill + hgt, fh - 0.25)); kind = 1;
      }
    }
  }

  // far away the grid collapses into its average: fade the relief and interior out
  float detail = 1.0 - smoothstep(0.35, 1.4, px);
  vec2 q; vec3 rn; float dh;
  int hit = kind == 0 ? 0 : recessHit(p, ap, D, d, q, rn, dh);
  vec3 nTan = nT;                                             // tangent-space normal so far (wall texture)
  if (hit == 1) {
    // reveal: the wall's own render, a little cleaner, shaded by depth
    albedo = mix(albedo, F.tint * 1.05, 0.5);
    if (kind == 2 || kind == 3) albedo = F.frameCol;
    nTan = rn; rough = 0.7;
    ao = mix(1.0, 0.62, clamp(dh / D, 0.0, 1.0));
    micro = recessSun(q, dh, ap, Lt);
  } else if (hit == 2) {
    vec2 g = q - ap.xz, size = vec2(ap.y - ap.x, ap.w - ap.z);
    micro = recessSun(q, dh, ap, Lt);
    ao = 0.85;
    if (kind == 4) {
      // louvres
      float sl = abs(fract(g.y / 0.11) - 0.5);
      albedo = F.frameCol * mix(0.35, 1.0, smoothstep(0.1, 0.4, sl)); rough = 0.5; metal = 0.6; nTan = normalize(vec3(0.0, 0.6, 0.8));
    } else if (kind == 5) {
      // doors: a dark leaf with a glazed panel
      vec3 dc = pick4(hash11(rs), vec3(0.16, 0.10, 0.07), vec3(0.20, 0.21, 0.22), vec3(0.10, 0.16, 0.13), vec3(0.34, 0.33, 0.31));
      float leaf = step(0.06, min(g.x, size.x - g.x)) * step(g.y, size.y - 0.06);
      float mid = step(abs(g.x - size.x * 0.5), 0.02);
      albedo = dc * (0.7 + 0.3 * leaf) * (1.0 - 0.6 * mid); rough = 0.45; metal = 0.2; nTan = vec3(0.0, 0.0, 1.0);
      if (style == ST_LILONG) { albedo = vec3(0.045, 0.04, 0.04); rough = 0.35; }         // black lacquered shikumen doors
    } else {
      vec3 fg = frameAndGlass(g, size, F, kind == 1 ? 1.0 : 0.0);
      float fm = fg.x;
      // spandrel band of a curtain wall: opaque back-painted glass at each floor line
      bool spandrel = kind == 2 && (g.y < fh * 0.26);
      if (kind == 2) {
        vec2 cellm = vec2(bw, fh);
        if (abs(g.y - fh * 0.26) < F.frame * 0.5 || g.y < F.frame * 0.6 || g.x < F.frame * 0.5 || g.x > size.x - F.frame * 0.5) fm = 1.0;
      }
      bool riser = false; float sticker = 0.0;
      if (kind == 3) {
        // shop front: a door bay on one side, a low stall riser under the display window, a transom line
        bool right = hash11(rs + 9.0) > 0.5;
        float dx = right ? size.x - 1.1 : 1.1;
        bool inDoor = right ? g.x > dx : g.x < dx;
        if (abs(g.x - dx) < 0.03 || g.y > size.y - 0.07 || g.x < 0.05 || g.x > size.x - 0.05 || abs(g.y - 2.15) < 0.025) fm = 1.0;
        if (inDoor && abs(g.x - (right ? dx + 0.12 : dx - 0.12)) < 0.02 && abs(g.y - 1.05) < 0.16) fm = 1.0;        // pull handle
        riser = !inDoor && g.y < 0.42;
        // paper notices and price cards stuck inside the glass
        vec2 sc = vec2(g.x / 0.36, g.y / 0.5); vec2 sf = fract(sc);
        float sh = hash12(floor(sc) + rs);
        if (!inDoor && g.y > 0.5 && g.y < 2.0 && sh > 0.93 && sf.x > 0.15 && sf.x < 0.85 && sf.y > 0.2 && sf.y < 0.8) sticker = 1.0;
      }
      if (fm > 0.5) {
        albedo = F.frameCol; rough = 0.42; metal = 0.5; nTan = vec3(0.0, 0.0, 1.0); ao = 0.9;
      } else if (riser) {
        MatS rm = matTint(L_GRANITE, vec2(u, y) * S_GRANITE * 2.0, C_GRANITE, vec3(0.16, 0.15, 0.15));
        albedo = rm.albedo; rough = 0.35; nTan = rm.n; ao = 0.9;
      } else if (sticker > 0.5) {
        albedo = pick4(hash11(rs + floor(g.x / 0.36) * 3.1), vec3(0.85, 0.82, 0.74), vec3(0.80, 0.12, 0.10), vec3(0.88, 0.72, 0.15), vec3(0.75, 0.80, 0.84)); rough = 0.6; nTan = vec3(0.0, 0.0, 1.0);
        emissive = albedo * 0.25 * lights;
      } else {
        // glass: each pane sits slightly out of true, which is what breaks reflections up on a real facade
        vec2 pane = floor(g / (size / max(F.panes, vec2(1.0)))) + vec2(ci, fi) * 3.0;
        vec2 tilt = (hash22(pane + seed) - 0.5) * (kind == 2 ? 0.016 : 0.010);
        nTan = normalize(vec3(tilt, 1.0));
        rough = 0.045; refl = F.refl; metal = 0.0;
        vec3 glow = vec3(0.0);
        vec3 inside;
        if (spandrel) { inside = F.glass * 0.22; }
        else {
          // room box spans the cell; the glass plane coordinate inside it:
          vec2 roomSize = kind == 3 ? vec2(bw, gH) : vec2(bw, fh);
          vec2 rq = vec2(q.x, q.y);
          float officeK = kind == 3 ? 1.0 : F.office;
          // which windows are lit: homes in the evening, offices in patches
          float litP = officeK > 0.5 ? 0.22 : 0.40;
          // whole office floors stay lit together; homes switch off one by one as the night goes on
          if (officeK > 0.5 && hash11(fi * 3.7 + seed) > 0.82) litP = 0.85;
          litP *= 1.0 - 0.5 * smoothstep(0.9, 1.0, uNight.x) * step(officeK, 0.5) * 0.0;
          float lit = step(hash11(rs + 11.0), litP) * lights;
          if (kind == 3) lit = max(lit, 0.5 * step(hash11(rs + 12.0), 0.85) + lights * step(hash11(rs + 12.0), 0.7));
          inside = kind == 3 ? shopColor(rq, roomSize, d, rs, lit, glow) : roomColor(rq, roomSize, d, rs, officeK, lit, glow);
          // curtains / blinds just behind the glass
          float cl = hash11(rs + 21.0), cr = hash11(rs + 22.0);
          float cx = g.x / size.x;
          if (kind == 1 && F.office < 0.5) {
            float cover = max(step(cx, cl * 0.55), step(1.0 - cr * 0.55, cx));
            vec3 fab = pick4(hash11(rs + 23.0), vec3(0.70, 0.68, 0.62), vec3(0.55, 0.50, 0.42), vec3(0.42, 0.46, 0.52), vec3(0.62, 0.48, 0.44)) * (0.82 + 0.18 * sin(g.x * 46.0));
            inside = mix(inside, fab * 0.75, cover * 0.92);
            glow = mix(glow, glow * fab * 1.6 + fab * 0.25 * lit, cover * 0.9);
          } else if (kind != 3 && F.office > 0.5) {
            float drop = hash11(rs + 24.0) * 0.5;
            float bl = step(1.0 - drop, g.y / size.y);
            float sl = 0.75 + 0.25 * step(0.5, fract(g.y / 0.05));
            inside = mix(inside, vec3(0.62, 0.62, 0.58) * sl, bl * 0.9);
            glow *= mix(1.0, 0.55, bl);
          }
          inside *= F.glass * 1.25;
          glow *= F.glass * 1.2;
        }
        // fade interiors to a flat tone with distance
        inside = mix(F.glass * 0.16, inside, detail);
        albedo = inside * 0.85;
        emissive = glow * mix(1.0, 0.8, 1.0 - detail) * (kind == 3 ? 3.0 : 2.0);
      }
    }
  } else if (kind == 1 && bays && F.curtain < 0.5) {
    // sill and head drawn on the wall plane
    float sillBand = step(ap.x - 0.08, p.x) * step(p.x, ap.y + 0.08) * step(ap.z - 0.09, p.y) * step(p.y, ap.z);
    albedo = mix(albedo, vec3(0.50, 0.49, 0.46), sillBand * 0.8);
    // dirt washing down from the sill
    float under = step(ap.x, p.x) * step(p.x, ap.y) * smoothstep(ap.z - 1.2, ap.z, p.y) * step(p.y, ap.z - 0.09);
    albedo *= 1.0 - 0.22 * under * (0.5 + 0.5 * vnoise(vec2(u * 9.0, y * 0.5)));
    if (style == ST_HERITAGE) { float sur = step(ap.x - 0.2, p.x) * step(p.x, ap.y + 0.2) * step(ap.z - 0.2, p.y) * step(p.y, ap.w + 0.26); albedo *= 1.0 + 0.14 * sur; }
  }
  // sign board over a shop
  if (shops && bays && hit == 0 && signY1 > signY0 && p.y > signY0 && p.y < signY1 && p.x > 0.22 && p.x < bw - 0.22) {
    float m;
    vec2 sp = vec2(p.x - 0.22, p.y - signY0), ss = vec2(bw - 0.44, signY1 - signY0);
    vec3 sc = signBoard(sp, ss, hash11(ci * 3.7 + seed * 1.9) * 50.0, m);
    albedo = sc * 0.9; rough = 0.35; nTan = vec3(0.0, 0.0, 1.0);
    emissive = sc * (0.25 + 2.6 * lights) * mix(0.55, 1.4, m);
  }
  // night dressing: warm flood lighting washes up the old stone fronts; towers carry LED bands
  if (lights > 0.01) {
    if (style == ST_HERITAGE && !party && hit == 0) {
      float wash = (0.35 + 0.65 * exp(-fract(y / max(fH, 3.0)) * 2.2)) * (0.55 + 0.45 * sin(u * 1.9 + seed) * sin(u * 0.7));
      emissive += albedo * vec3(1.0, 0.72, 0.36) * (5.5 * lights * wash);
    }
    if (style == 20 && int(pal + 0.5) == 3) emissive += vec3(0.55, 0.75, 1.0) * (2.2 * lights);
    if (style == ST_GLASS && capBand) emissive += mix(vec3(0.5, 0.8, 1.0), vec3(1.0, 0.75, 0.45), step(0.5, hash11(seed * 0.77))) * (1.6 * lights * step(60.0, topH));
  }
  // collapse to the facade's mean when a cell is only a few pixels
  s.albedo = albedo;
  s.normal = normalize(T * nTan.x + Bv * nTan.y + N * nTan.z);
  s.roughness = rough; s.metalness = metal; s.reflectance = refl; s.ao = ao; s.microShadow = micro; s.emissive = emissive;
}

void shadeRoof(inout Surface s, int kind) {
  int style = int(vBld.x + 0.5); float seed = vBld.y, pal = vBld.z;
  vec3 N = normalize(vNormal);
  vec3 T, B;
  vec2 uv;
  if (N.y > 0.985) { T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, -1.0); uv = vec2(vTex.x, -vTex.y); }
  else {
    // tiles run across the slope
    T = normalize(cross(vec3(0.0, 1.0, 0.0), N)); B = normalize(cross(N, T));
    vec3 P = vec3(vTex.x, vWorld.y, vTex.y);
    uv = vec2(dot(P, T), dot(P, B));
  }
  float h = hash11(pal * 2.11 + 0.7), h2 = hash11(seed * 0.91);
  float macro = vnoise(vWorld.xz * 0.35) * 0.6 + vnoise(vWorld.xz * 1.3) * 0.4;
  MatS m;
  if (kind == 2) {
    // clay / cement roof tiles
    bool grey = style == ST_LILONG ? h > 0.42 : style == ST_TEMPLE ? true : h > 0.80;
    if (grey) { m = matTint(L_ROOF_GREY, uv * S_ROOF_GREY, C_ROOF_GREY, style == ST_TEMPLE ? vec3(0.085, 0.09, 0.095) : vec3(0.13, 0.13, 0.14)); }
    else { vec3 tint = style == ST_SLAB ? (h < 0.5 ? vec3(0.34, 0.13, 0.09) : vec3(0.16, 0.22, 0.33)) : mix(vec3(0.36, 0.14, 0.09), vec3(0.28, 0.12, 0.08), h2); m = matTint(L_ROOF_CLAY, uv * S_ROOF_CLAY, C_ROOF_CLAY, tint); }
    m.albedo *= 0.8 + 0.4 * macro;
  } else if (kind == 7) {
    m = matTint(L_CORRUGATED, uv * S_CORRUGATED, C_CORRUGATED, mix(vec3(0.34, 0.42, 0.52), vec3(0.52, 0.53, 0.54), step(0.45, h)));
    m.albedo *= 0.85 + 0.3 * macro; s.metalness = 0.6;
  } else if (kind == 3) {
    m = matTint(L_CONCRETE, uv * S_CONCRETE, C_CONCRETE, vec3(0.42, 0.41, 0.39));
    m.albedo *= 0.85 + 0.3 * macro;
  } else {
    // flat roofs: waterproofing with stains, ponding marks and patches
    if (h < 0.55) m = matTint(L_BITUMEN, uv * S_BITUMEN, C_BITUMEN, vec3(0.11, 0.11, 0.115));
    else m = matTint(L_CONCRETE, uv * S_CONCRETE, C_CONCRETE, vec3(0.30, 0.29, 0.28));
    float stain = smoothstep(0.45, 0.8, vnoise(vWorld.xz * 0.22 + seed));
    m.albedo *= mix(1.0, 0.62, stain) * (0.85 + 0.3 * macro);
    if (h2 > 0.7) m.albedo = mix(m.albedo, vec3(0.28, 0.12, 0.10), 0.35);          // red waterproof coating
  }
  s.albedo = m.albedo; s.roughness = m.rough;
  s.normal = normalize(T * m.n.x + B * m.n.y + N * m.n.z);
}

void main() {
  Surface s = defaultSurface();
  int kind = int(vKind + 0.5);
  vec3 N = normalize(vNormal);
  s.normal = N;
  if (kind == 0) shadeWall(s);
  else if (kind == 4) {
    // block masses standing in for many small buildings
    Facade F = facadeFor(int(vBld.x + 0.5), vBld.z, vBld.y, N.z > 0.25);
    if (N.y > 0.5) { s.albedo = vec3(0.20, 0.19, 0.19) * (0.8 + 0.4 * vnoise(vWorld.xz * 0.12)); if (int(vBld.x + 0.5) == ST_LILONG || int(vBld.x + 0.5) == ST_VILLAGE) s.albedo = mix(s.albedo, vec3(0.22, 0.11, 0.08), step(0.5, hash11(vBld.z * 2.11 + 0.7)) * 0.8); }
    else { float w = step(0.3, fract(vUv.y / 3.1)) * step(fract(vUv.y / 3.1), 0.8) * step(0.25, fract(vUv.x / 3.3)) * step(fract(vUv.x / 3.3), 0.75); s.albedo = mix(F.tint, vec3(0.07, 0.09, 0.10), w * 0.8); s.roughness = mix(0.85, 0.3, w); }
  }
  else if (kind == 6) { s.albedo = vec3(0.045, 0.06, 0.10); s.roughness = 0.08; s.reflectance = 0.8; }
  else if (kind == 5) {
    // steel tanks, cooling towers, condensers
    float rib = 0.85 + 0.15 * step(0.5, fract(vUv.y / 0.35));
    s.albedo = mix(vec3(0.62, 0.64, 0.66), vec3(0.50, 0.52, 0.50), hash11(vBld.y * 0.37)) * rib; s.roughness = 0.32; s.metalness = 0.85;
    if (N.y > 0.5) { float fan = smoothstep(0.42, 0.38, length(fract(vTex / 1.4) - 0.5)); s.albedo = mix(s.albedo, vec3(0.05), fan * 0.8); }
  }
  else if (kind == 9) {
    // louvred plant-room walls
    float sl = abs(fract(vUv.y / 0.16) - 0.5);
    s.albedo = vec3(0.36, 0.37, 0.38) * mix(0.45, 1.0, smoothstep(0.08, 0.35, sl)); s.roughness = 0.5; s.metalness = 0.5;
    s.normal = normalize(N + vec3(0.0, 0.5, 0.0) * step(sl, 0.2));
  }
  else if (kind == 8) { s.albedo = vec3(0.34, 0.33, 0.32); s.roughness = 0.9; }
  else shadeRoof(s, kind);
  writeGBuffer(s);
}`;

const DEPTH_VERT = /* glsl */`${PRECISION}
in vec4 aPos;
uniform mat4 modelViewMatrix, projectionMatrix;
void main() { gl_Position = projectionMatrix * (modelViewMatrix * vec4(aPos.xyz * (1.0 / 40.0), 1.0)); }`;
const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }`;

export function createBuildingMaterials(env, lib) {
  const material = gbufferMaterial({ vertexShader: VERT, fragmentShader: FRAG(lib), name: 'building',
    uniforms: { ...lib.uniforms, ...lib.signUniforms, uNight: env.uniforms.uNight, uLightDir: env.uniforms.uLightDir, uTime: env.uniforms.uTime } });
  const depth = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, colorWrite: false });
  depth.name = 'buildingDepth';
  return { material, depth };
}
