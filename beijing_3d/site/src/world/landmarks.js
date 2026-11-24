// Hand-modelled landmarks: one merged mesh built with the procedural kit, shaded by a material-aware shader.

import * as THREE from 'three';
import { fetchJSON } from './data.js';
import { Kit, MAT } from './landmarkKit.js';
import { PRECISION, ENV_UNIFORMS, NOISE, ATMOSPHERE, SHADOWS, LIGHTING } from '../engine/shaderlib.js';
import * as imperial from './landmarks/imperial.js';
import * as modern from './landmarks/modern.js';
import * as heritage from './landmarks/heritage.js';
import * as olympic from './landmarks/olympic.js';

const MODULES = { imperial, modern, heritage, olympic };

const VERT = /* glsl */`${PRECISION}
in vec3 position;
in vec3 aNormal;
in vec4 aColor;
in vec2 aUv;
in vec3 aPar;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uGrow;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
flat out float vMat;
flat out vec3 vPar;
void main() {
  vec3 p = position;
  p.y *= uGrow;
  vec4 wp = modelMatrix * vec4(p, 1.0);       // identity for the static landmarks; moving props (aircraft) reuse this shader
  vWorld = wp.xyz; vNormal = mat3(modelMatrix) * aNormal; vColor = aColor.rgb; vMat = aColor.a; vUv = aUv; vPar = aPar;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`${PRECISION}
${ENV_UNIFORMS}
uniform vec3 cameraPosition;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUv;
flat in float vMat;
flat in vec3 vPar;
out vec4 fragColor;
${NOISE}
${ATMOSPHERE}
${SHADOWS}
${LIGHTING}
const int M_MATTE = 0, M_TILE = 1, M_GLASS = 2, M_METAL = 3, M_GLOW = 4, M_MARBLE = 5, M_TIMBER = 6, M_LATTICE = 7, M_BUBBLE = 8, M_BRICK = 9, M_WATER = 10;
float boxMask(vec2 p, vec2 lo, vec2 hi, vec2 w) { vec2 a = smoothstep(lo - w, lo + w, p) * (1.0 - smoothstep(hi - w, hi + w, p)); return a.x * a.y; }
vec2 voronoi(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
void main() {
  int mat = int(vMat + 0.5);
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 albedo = vColor;
  float gloss = 0.0, spec = 0.0;
  vec3 emis = vec3(0.0), refl = vec3(0.0);
  float lights = uTimeNight.z;
  float u = vUv.x, v = vUv.y;
  vec3 R = reflect(-V, n);
  vec3 skyRef = skyColor(normalize(vec3(R.x, abs(R.y) * 0.6 + 0.05, R.z)));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);

  if (mat == M_TILE) {
    vec2 down = normalize(n.xz + vec2(1e-5));
    float rib = dot(vWorld.xz, vec2(-down.y, down.x)) / 0.62;
    float ribs = mix(0.5, smoothstep(0.0, 0.5, abs(fract(rib) - 0.5) * 2.0), 1.0 - smoothstep(0.25, 0.8, fwidth(rib)));
    albedo *= 0.80 + 0.30 * ribs;
    gloss = 0.75; spec = 0.5;
  } else if (mat == M_GLASS) {
    float fh = vPar.x > 0.5 ? vPar.x : 4.0;
    vec2 g = vec2(u / 1.5, v / fh);
    vec2 f = fract(g), cell = floor(g);
    vec2 fw = fwidth(g);
    float detail = 1.0 - smoothstep(0.3, 0.95, max(fw.x, fw.y));
    float r1 = hash12(cell + 7.3), rf = hash12(vec2(cell.y, 3.1));
    float frame = 1.0 - boxMask(f, vec2(0.04, 0.10), vec2(0.96, 0.94), fw * 0.75 + 0.004);
    vec3 body = albedo * (0.30 + 0.25 * r1);
    albedo = mix(body, mix(body, albedo * 1.5 + 0.08, frame * 0.8), detail);
    refl = skyRef * clamp(0.22 + 0.78 * fres, 0.0, 1.0) * (0.85 + 0.3 * r1) * (1.0 - frame * detail * 0.7);
    gloss = 0.9; spec = 1.0;
    float p = vPar.y * (0.5 + 1.0 * step(0.4, rf));
    float on = step(r1, p) * smoothstep(0.0, 0.12, lights - hash12(cell * 1.7 + 2.0) * 0.7);
    vec3 lc = hash12(cell + 11.0) < 0.6 ? vec3(0.70, 0.82, 1.0) : vec3(1.0, 0.78, 0.50);
    emis = lc * on * (0.5 + 0.9 * fract(r1 * 13.0)) * mix(0.75, 1.0 - frame, detail);
  } else if (mat == M_METAL) {
    albedo *= 0.92 + 0.12 * fbm2(vec2(u * 0.12, v * 0.5));
    gloss = 0.45; spec = 0.8;
    refl = skyRef * (0.10 + 0.5 * fres) * albedo;
  } else if (mat == M_GLOW) {
    emis = vColor * vPar.x * lights;
  } else if (mat == M_MARBLE) {
    albedo *= 0.93 + 0.10 * fbm2(vWorld.xz * 0.35 + vWorld.y);
    if (vPar.x > 0.0 && abs(n.y) < 0.5) {
      // carved balustrade along the top edge, course lines below
      float tp = vPar.x - v;
      float posts = step(0.3, fract(u / 1.6));
      float rail = smoothstep(1.15, 1.0, tp) * (0.86 + 0.14 * posts);
      albedo *= mix(0.92 + 0.08 * step(0.5, fract(v / 0.9)), rail, step(tp, 1.15));
    }
    spec = 0.12; gloss = 0.3;
  } else if (mat == M_TIMBER) {
    float H = max(vPar.x, 1.0);
    float t = clamp(v / H, 0.0, 1.0);
    float bay = u / 4.4, fb = fract(bay), fwb = fwidth(bay);
    float column = 1.0 - smoothstep(0.045, 0.055 + fwb, abs(fb - 0.5) - 0.44);
    float door = boxMask(vec2(fb, t), vec2(0.14, 0.10), vec2(0.86, 0.74), vec2(fwb, 0.01) + 0.004);
    vec3 col = albedo;
    col = mix(col, vec3(0.20, 0.085, 0.045), door * 0.85);
    col = mix(col, albedo * 0.72, column * 0.6);
    float band = smoothstep(0.80, 0.83, t);
    vec3 beam = mix(vec3(0.05, 0.22, 0.30), vec3(0.07, 0.30, 0.20), step(0.5, fract(bay * 2.0)));
    beam = mix(beam, vec3(0.62, 0.43, 0.10), step(0.86, fract(bay * 6.0 + 0.3)) * 0.8);
    col = mix(col, beam, band);
    emis = vec3(1.0, 0.55, 0.22) * door * 0.5 * lights * step(0.3, hash12(vec2(floor(bay), 1.0)));
    albedo = col;
  } else if (mat == M_LATTICE) {
    // woven steel: three families of members over a dark void
    float w = 0.07 + fwidth(u / 9.0) * 1.2;
    float a1 = abs(fract(u / 9.0 + v / 13.0 + 0.3 * sin(u * 0.05)) - 0.5);
    float a2 = abs(fract(u / 14.0 - v / 8.0 + 0.2 * sin(v * 0.11)) - 0.5);
    float a3 = abs(fract(u / 27.0 + v / 5.5) - 0.5);
    float a4 = abs(fract(-u / 6.5 + v / 21.0) - 0.5);
    float member = max(max(1.0 - smoothstep(w, w * 1.6, a1), 1.0 - smoothstep(w * 0.8, w * 1.4, a2)), max(1.0 - smoothstep(w * 0.7, w * 1.3, a3), 1.0 - smoothstep(w * 0.6, w * 1.2, a4)));
    float lod = 1.0 - smoothstep(0.25, 0.9, fwidth(u / 9.0));
    member = mix(0.80, member, lod);          // from afar the weave closes up into a pale steel shell
    vec3 voidCol = vec3(0.105, 0.036, 0.032);      // the red bowl behind the steel, deep in shadow by day
    emis = vec3(1.0, 0.25, 0.10) * (1.0 - member) * lights * 1.2 * vPar.x;
    albedo = mix(voidCol, albedo, member);
    spec = 0.5 * member; gloss = 0.4;
  } else if (mat == M_BUBBLE) {
    vec2 vv = voronoi(vec2(u, v) / 7.5);
    float edge = smoothstep(0.10, 0.03, vv.y - vv.x);
    float lod = 1.0 - smoothstep(0.2, 0.8, fwidth(u / 7.5));
    float cellTone = hash12(floor(vec2(u, v) / 7.5) + 1.0);
    albedo = mix(albedo * (0.82 + 0.3 * cellTone), vec3(0.86, 0.92, 0.96), edge * lod * 0.8);
    refl = skyRef * (0.12 + 0.5 * fres);
    gloss = 0.6; spec = 0.5;
    emis = vec3(0.10, 0.42, 1.0) * lights * (0.9 + 0.6 * cellTone) * max(vPar.x, 0.6);
  } else if (mat == M_BRICK) {
    float rows = v / 0.55;
    float fwr = fwidth(rows);
    float course = smoothstep(0.42, 0.5, abs(fract(rows) - 0.5)) * (1.0 - smoothstep(0.15, 0.6, fwr));
    albedo *= (0.90 + 0.14 * fbm2(vec2(u * 0.3, v * 0.3))) * (1.0 - 0.18 * course);
  } else if (mat == M_WATER) {
    albedo = vColor * 0.4;
    refl = skyRef * (0.25 + 0.75 * fres);
    gloss = 0.95; spec = 1.0;
  } else {
    albedo *= 0.94 + 0.10 * fbm2(vec2(u * 0.2 + vWorld.x * 0.05, v * 0.2 + vWorld.z * 0.05));
  }

  if (uSnow > 0.0 && n.y > 0.2 && mat != M_WATER && mat != M_GLOW) {
    albedo = snowOn(albedo, n, vWorld, mat == M_TILE ? 0.46 - 0.26 * max(n.z, 0.0) : 1.0);
    spec *= 1.0 - 0.8 * uSnow; refl *= 1.0 - uSnow;
  }
  float sh = sunShadow(vWorld, n) * cloudShadow(vWorld);
  float ao = 1.0 - 0.2 * groundAO(vWorld) * (1.0 - smoothstep(4.0, 30.0, vWorld.y)) * (1.0 - abs(n.y));
  vec3 col = shade(albedo, n, sh, ao);
  if (spec > 0.0) {
    vec3 Hh = normalize(uSunDir + V);
    float nh = max(dot(n, Hh), 0.0);
    float pw = mix(24.0, 420.0, gloss);
    float sp = pow(nh, pw) * (pw + 8.0) / 25.0;
    float fr = 0.04 + 0.96 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
    col += uSunColor * sp * spec * sh * mix(0.25, 1.0, fr) * max(dot(n, uSunDir), 0.0) * 0.55;
  }
  col += refl;
  col += sunSheen(n, V, sh, n.y > 0.4 ? 0.5 : 0.22) * albedo * (1.0 - step(0.5, spec));
  // heritage flood-lighting: warm wash that is strongest low on the walls
  col += albedo * vec3(1.0, 0.70, 0.40) * vPar.z * lights * 1.5;
  col += emis;
  col = applyFog(col, vWorld, cameraPosition);
  fragColor = vec4(col, 1.0);
}`;

const DEPTH_VERT = /* glsl */`${PRECISION}
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uGrow;
void main() { vec3 p = position; p.y *= uGrow; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`;
const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor; void main() { fragColor = vec4(1.0); }`;

/** The landmark surface shader as a material (also used for small moving props). */
export function createLandmarkMaterial(env, grow = { value: 1 }) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...env.uniforms, uGrow: grow }, side: THREE.DoubleSide });
}

export class Landmarks {
  constructor({ env, scene, shadowScene, terrain }) {
    this.env = env; this.scene = scene; this.shadowScene = shadowScene; this.terrain = terrain;
    this.grow = { value: 0 };
    this.labels = [];
    this.t = 0;
    this.dirty = false;
  }

  async load() {
    const L = this.data = await fetchJSON('landmarks.json');
    const kit = new Kit();
    kit.heightAt = (x, z) => this.terrain.heightAt(x, z);
    kit.labels = this.labels;
    const only = new URLSearchParams(location.search).get('lm');
    for (const [name, mod] of Object.entries(MODULES)) {
      if (!mod.LANDMARKS) continue;
      for (const [key, fn] of Object.entries(mod.LANDMARKS)) {
        if (only && only !== key && only !== name) continue;
        const before = kit.n;
        try { fn(kit, L); } catch (e) { console.warn(`landmark ${name}.${key} failed:`, e); kit.stack.length = 0; }
        if (!(kit.n >= before)) console.warn('landmark', key, 'corrupted the kit');
      }
    }
    if (!kit.n) return;
    const geo = kit.build();
    const mat = createLandmarkMaterial(this.env, this.grow);
    const depth = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, uniforms: { uGrow: this.grow }, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.renderOrder = 1; this.mesh.frustumCulled = false; this.mesh.name = 'landmarks';
    this.shadowMesh = new THREE.Mesh(geo, depth); this.shadowMesh.frustumCulled = false;
    this.scene.add(this.mesh); this.shadowScene.add(this.shadowMesh);
    this.tris = geo.index.count / 3;
  }

  update(dt) {
    if (!this.mesh || this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / 1.6);
    this.grow.value = 1 - Math.pow(1 - this.t, 3);
    this.dirty = true;
  }
}

export { MAT };
