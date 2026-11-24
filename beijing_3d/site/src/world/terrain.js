// Terrain: the Western Hills / Yan range backdrop (coarse, 250 m) and the hills inside the city (fine, 40 m).
// The plain itself is y = 0 and is not meshed.

import * as THREE from 'three';
import { fetchBin, fetchJSON } from './data.js';
import { PRECISION, ENV_UNIFORMS, NOISE, ATMOSPHERE, SHADOWS, LIGHTING } from '../engine/shaderlib.js';

const VERT = /* glsl */`${PRECISION}
in vec3 position;
in vec4 aNrm;
uniform mat4 viewMatrix, projectionMatrix;
uniform float uExag;
out vec3 vWorld;
out vec3 vNormal;
out float vH;
void main() {
  vec3 p = position;
  // far ranges get a gentle vertical exaggeration so they read as a horizon line, the way they do on a clear day
  float k = 1.0 + uExag * smoothstep(36000.0, 70000.0, length(p.xz));
  vH = p.y;
  p.y *= k;
  vWorld = p;
  vNormal = normalize(vec3(aNrm.x * k, aNrm.y, aNrm.z * k) / 127.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`${PRECISION}
${ENV_UNIFORMS}
uniform vec3 cameraPosition;
in vec3 vWorld;
in vec3 vNormal;
in float vH;
out vec4 fragColor;
${NOISE}
${ATMOSPHERE}
${SHADOWS}
${LIGHTING}
void main() {
  vec3 n = normalize(vNormal);
  vec2 p = vWorld.xz;
  float slope = 1.0 - n.y;
  float big = fbm(p / 900.0);
  vec3 forest = mix(vec3(0.085, 0.155, 0.060), vec3(0.150, 0.195, 0.075), big);
  // autumn: gold and red on the lower slopes (the famous red leaves of the Western Hills)
  float band = smoothstep(900.0, 150.0, vH);
  float au = smoothstep(0.50, 0.78, fbm(p / 170.0 + 3.0) * 0.8 + 0.25 * band) * uSeason;
  vec3 autumn = mix(vec3(0.46, 0.30, 0.06), vec3(0.40, 0.13, 0.045), smoothstep(0.4, 0.75, vnoise(p / 90.0)));
  forest = mix(forest, autumn, au * 0.85);
  vec3 rock = mix(vec3(0.30, 0.265, 0.215), vec3(0.36, 0.33, 0.28), vnoise(p / 60.0));
  float rk = clamp(smoothstep(0.28, 0.55, slope) * 0.75 + smoothstep(1100.0, 1900.0, vH) * 0.5, 0.0, 1.0);
  vec3 col = mix(forest, rock, rk);
  // crown texture up close
  float d = length(cameraPosition - vWorld);
  float lod = 1.0 - smoothstep(1500.0, 9000.0, d);
  if (lod > 0.01) {
    // jittered cells -> irregular crowns
    vec2 q = p / 8.0; vec2 id = floor(q); vec2 f = fract(q);
    float dmin = 1.0; float r = 0.5;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      float d = length(g + hash22(id + g) - f);
      if (d < dmin) { dmin = d; r = hash12(id + g + 5.3); }
    }
    col *= mix(1.0, (0.78 + 0.44 * r) * (0.72 + 0.42 * smoothstep(0.75, 0.1, dmin)), lod * (1.0 - rk));
  }
  // toe of the slope blends into the plain
  col = mix(col, vec3(0.20, 0.25, 0.12), smoothstep(6.0, 0.0, vH) * 0.6);
  col = snowOn(col, n, vWorld, 0.9);
  float sh = sunShadow(vWorld, n) * cloudShadow(vWorld);
  col = shade(col, n, sh, 1.0);
  col = applyFog(col, vWorld, cameraPosition);
  fragColor = vec4(col, 1.0);
}`;

const DEPTH_VERT = /* glsl */`${PRECISION}
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
void main() { gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const DEPTH_FRAG = /* glsl */`${PRECISION}
out vec4 fragColor; void main() { fragColor = vec4(1.0); }`;

export class Terrain {
  constructor({ env, scene, shadowScene }) {
    this.env = env; this.scene = scene; this.shadowScene = shadowScene;
    this.fineData = null; this.fineMeta = null;
    this.uniforms = { ...env.uniforms, uExag: { value: 0.75 } };
  }

  async loadData() {
    const meta = this.meta = await fetchJSON('terrain.json');
    const [fine, coarse] = await Promise.all([fetchBin(meta.fine.file), fetchBin(meta.coarse.file)]);
    this.fineData = new Uint16Array(fine); this.fineMeta = meta.fine;
    this.coarseData = new Uint16Array(coarse); this.coarseMeta = meta.coarse;
  }

  /** Terrain height (m) at world x / z. */
  heightAt(x, z) {
    const m = this.fineMeta, h = this.fineData;
    if (!h) return 0;
    const fx = (x - m.x0) / m.cell - 0.5, fy = (-z - m.y0) / m.cell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= m.nx - 1 || j >= m.ny - 1) return this._coarseAt(x, z);
    const tx = fx - i, ty = fy - j, o = j * m.nx + i;
    return ((h[o] * (1 - tx) + h[o + 1] * tx) * (1 - ty) + (h[o + m.nx] * (1 - tx) + h[o + m.nx + 1] * tx) * ty) * 0.1;
  }

  _coarseAt(x, z) {
    const m = this.coarseMeta, h = this.coarseData;
    const fx = (x - m.x0) / m.cell - 0.5, fy = (-z - m.y0) / m.cell - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= m.nx - 1 || j >= m.ny - 1) return 0;
    const tx = fx - i, ty = fy - j, o = j * m.nx + i;
    const y = ((h[o] * (1 - tx) + h[o + 1] * tx) * (1 - ty) + (h[o + m.nx] * (1 - tx) + h[o + m.nx + 1] * tx) * ty) * 0.1;
    const k = 1 + this.uniforms.uExag.value * THREE.MathUtils.smoothstep(Math.hypot(x, z), 36000, 70000);
    return y * k;
  }

  async build(worker) {
    const f = this.fineMeta, c = this.coarseMeta;
    const hole = [f.x0 + c.cell, f.y0 + c.cell, f.x0 + f.nx * f.cell - c.cell, f.y0 + f.ny * f.cell - c.cell];
    const fb = this.fineData.slice(0), cb = this.coarseData.slice(0);
    const [fine, coarse] = await Promise.all([
      worker.run('terrain', { buffer: fb.buffer, meta: f }, [fb.buffer]),
      worker.run('terrain', { buffer: cb.buffer, meta: c, hole }, [cb.buffer]),
    ]);
    const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
    const mk = (res, name) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(res.pos, 3));
      geo.setAttribute('aNrm', new THREE.BufferAttribute(res.nrm, 4));
      geo.setIndex(new THREE.BufferAttribute(res.index, 1));
      geo.computeBoundingSphere();
      geo.boundingSphere.radius *= 2.0;
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 2; m.name = name; m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.fine = mk(fine, 'terrainFine');
    this.coarse = mk(coarse, 'terrainCoarse');
    const dm = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, side: THREE.DoubleSide });
    const sm = new THREE.Mesh(this.fine.geometry, dm); sm.frustumCulled = false;
    this.shadowScene.add(sm);
  }
}
