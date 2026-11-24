// Material helpers: every world material is a RawShaderMaterial writing the G-buffer (see glsl.js), with a matching
// depth-only material for the shadow / height passes.

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from './glsl.js';

export function gbufferMaterial({ vertexShader, fragmentShader, uniforms = {}, defines = {}, side = THREE.FrontSide, name = '' }) {
  const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms, defines, side });
  m.name = name;
  return m;
}

/** Blended decal: only albedo is written (see writeDecal). Draw after the opaque G-buffer pass. */
export function decalMaterial({ vertexShader, fragmentShader, uniforms = {}, defines = {}, name = '' }) {
  const m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms, defines, transparent: true, depthWrite: false,
    blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  m.name = name;
  return m;
}

const STD_VERT = /* glsl */`${PRECISION}
in vec3 position; in vec3 normal;
#ifdef VCOLOR
in vec3 color;
#endif
#ifdef INSTANCED
in mat4 instanceMatrix;
#ifdef ICOLOR
in vec3 instanceColor;
#endif
#endif
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vNormal; out vec3 vColor; out vec3 vWorld;
void main() {
  mat4 m = modelMatrix;
#ifdef INSTANCED
  m = m * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = mat3(m) * normal;
  vColor = vec3(1.0);
#ifdef VCOLOR
  vColor = color;
#endif
#if defined(INSTANCED) && defined(ICOLOR)
  vColor *= instanceColor;
#endif
  gl_Position = projectionMatrix * (viewMatrix * wp);
}`;

const STD_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform vec3 uColor; uniform vec4 uPbr;   // roughness, metalness, reflectance, emissive scale
uniform vec3 uEmissive;
in vec3 vNormal; in vec3 vColor; in vec3 vWorld;
void main() {
  Surface s = defaultSurface();
  s.albedo = uColor * vColor;
  s.normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  s.roughness = uPbr.x; s.metalness = uPbr.y; s.reflectance = uPbr.z;
  s.emissive = uEmissive * uPbr.w;
  writeGBuffer(s);
}`;

/** Plain PBR surface: uniform colour x optional vertex / instance colours. */
export function standardMaterial({ color = 0xffffff, roughness = 0.8, metalness = 0, reflectance = 0.5, emissive = 0x000000, emissiveScale = 1, vertexColors = false, instanced = false, instanceColor = false, side = THREE.FrontSide } = {}) {
  const defines = {};
  if (vertexColors) defines.VCOLOR = 1;
  if (instanced) defines.INSTANCED = 1;
  if (instanceColor) defines.ICOLOR = 1;
  return gbufferMaterial({ vertexShader: STD_VERT, fragmentShader: STD_FRAG, defines, side, name: 'standard',
    uniforms: { uColor: { value: new THREE.Color(color) }, uPbr: { value: new THREE.Vector4(roughness, metalness, reflectance, emissiveScale) }, uEmissive: { value: new THREE.Color(emissive) } } });
}

const DEPTH_VERT = /* glsl */`${PRECISION}
in vec3 position;
#ifdef INSTANCED
in mat4 instanceMatrix;
#endif
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
void main() {
  mat4 m = modelMatrix;
#ifdef INSTANCED
  m = m * instanceMatrix;
#endif
  gl_Position = projectionMatrix * (viewMatrix * (m * vec4(position, 1.0)));
}`;
const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }`;

const _depthCache = new Map();
/** Depth-only material for opaque geometry with a float `position` attribute. */
export function depthMaterial({ instanced = false, side = THREE.FrontSide } = {}) {
  const key = `${instanced}|${side}`;
  let m = _depthCache.get(key);
  if (!m) {
    m = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, defines: instanced ? { INSTANCED: 1 } : {}, side, colorWrite: false });
    m.name = 'depth';
    _depthCache.set(key, m);
  }
  return m;
}

// ---- kit geometry (see world/kit.js): per-vertex colour and material, optional instancing ---------------------------
const KIT_VERT = /* glsl */`${PRECISION}
in vec3 position; in vec3 normal; in vec3 color; in vec4 aMat;
#ifdef INSTANCED
in mat4 instanceMatrix;
#ifdef ICOLOR
in vec3 instanceColor;
#endif
#endif
#ifdef SIGNAL
in vec2 aSig; out vec2 vSig;        // traffic signal head: phase (fraction of the cycle), group
#endif
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vNormal; out vec3 vColor; out vec4 vMat; out vec3 vWorld;
void main() {
  mat4 m = modelMatrix;
#ifdef INSTANCED
  m = m * instanceMatrix;
#endif
#ifdef SIGNAL
  vSig = aSig;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz; vNormal = mat3(m) * normal; vColor = color; vMat = aMat;
#if defined(INSTANCED) && defined(ICOLOR)
  // paint takes the instance colour; glass, tyres and lamps (dark or emissive vertices) keep theirs
  if (aMat.z == 0.0 && color.r > 0.9 && color.g > 0.9 && color.b > 0.9) vColor = instanceColor;
#endif
  gl_Position = projectionMatrix * (viewMatrix * wp);
}`;
const KIT_FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform vec4 uNight; uniform vec3 uFlood;
in vec3 vNormal; in vec3 vColor; in vec4 vMat; in vec3 vWorld;
#ifdef SIGNAL
in vec2 vSig; uniform float uTime;
#endif
void main() {
  Surface s = defaultSurface();
  s.albedo = vColor;
  s.normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  s.roughness = vMat.x; s.metalness = vMat.y; s.reflectance = vMat.w;
  // negative emissive strength: a lamp that only burns once the city lights are on
  float e = vMat.z < 0.0 ? -vMat.z * smoothstep(0.25, 0.6, uNight.y) : vMat.z;
#ifdef SIGNAL
  // lenses carry 101 (red), 102 (amber), 103 (green) in the emissive slot; the clock is the one the traffic obeys (traffic.js)
  if (vMat.z > 100.0) {
    float u = mod(uTime + vSig.x * 72.0, 72.0);
    float st = vSig.y < 0.5 ? (u < 31.0 ? 0.0 : u < 34.0 ? 1.0 : 2.0) : (u >= 36.0 && u < 67.0 ? 0.0 : u >= 67.0 && u < 70.0 ? 1.0 : 2.0);
    float lens = vMat.z - 101.0;
    bool on = lens < 0.5 ? st > 1.5 : lens < 1.5 ? (st > 0.5 && st < 1.5) : st < 0.5;
    e = on ? mix(26.0, 7.0, uNight.x) : 0.0;
    if (!on) s.albedo *= 0.25;
  }
#endif
  s.emissive = vColor * e;
  if (e > 0.0) s.albedo *= 0.3;
  else s.emissive += vColor * uFlood * uNight.y;
#ifdef MOVING
  s.model = 128.0;
#endif
  writeGBuffer(s);
}`;
export function kitMaterial(env, { instanced = false, instanceColor = false, side = THREE.FrontSide, flood = [0, 0, 0], signal = false, moving = false } = {}) {
  return gbufferMaterial({ vertexShader: KIT_VERT, fragmentShader: KIT_FRAG, defines: { ...(instanced ? { INSTANCED: 1 } : {}), ...(instanceColor ? { ICOLOR: 1 } : {}), ...(signal ? { SIGNAL: 1 } : {}), ...(moving ? { MOVING: 1 } : {}) }, side, name: 'kit',
    uniforms: { uNight: env.uniforms.uNight, uFlood: { value: new THREE.Vector3(...flood) }, ...(signal ? { uTime: env.uniforms.uTime } : {}) } });
}
