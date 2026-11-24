// Local lights (street lamps and other small sources) as deferred light volumes: one screen-space quad per light,
// additively blended into the lit image, shading from the G-buffer. No shadows; the lamps are overhead and the
// ambient-occlusion buffer keeps corners grounded.

import * as THREE from 'three';
import { PRECISION, GBUFFER_DECODE } from './glsl.js';

const VERT = /* glsl */`${PRECISION}
in vec2 position;
in vec4 iLight;            // xyz: position relative to the mesh origin, w: radius
in vec3 iColor;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vCenter; out float vRadius; out vec3 vColor;
void main() {
  vec4 c = viewMatrix * (modelMatrix * vec4(iLight.xyz, 1.0));
  vCenter = c.xyz; vRadius = iLight.w; vColor = iColor;
  vec4 p = c;
  p.xy += position * iLight.w * 1.2;
  p.z = min(c.z + iLight.w, -0.2);
  gl_Position = projectionMatrix * p;
}`;

const FRAG = /* glsl */`${PRECISION}
${GBUFFER_DECODE}
uniform sampler2D tAO;
uniform mat3 uCamRot;
uniform vec2 uRes;
uniform float uStrength;
in vec3 vCenter; in float vRadius; in vec3 vColor;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float depth = texture(tDepth, uv).r;
  if (isSky(depth)) discard;
  vec3 P = viewPosAt(uv, depth);
  vec3 d = vCenter - P;
  float dist = length(d);
  if (dist > vRadius) discard;
  vec3 Lw = uCamRot * (d / dist);
  vec4 g1 = texture(tNormal, uv);
  vec3 N = octDecode(unpack2x12(g1.rgb));
  float NoL = dot(N, Lw);
  vec4 g2 = texture(tMaterial, uv);
  int model = int(g2.a * 255.0 + 0.5) & 127;
  if (model == 1) NoL = NoL * 0.5 + 0.5;                 // foliage lets light through
  if (NoL <= 0.0) discard;
  vec4 g0 = texture(tAlbedo, uv);
  vec3 albedo = g0.rgb * g0.rgb * (1.0 - g2.r);
  // street luminaires throw their light down and outwards, not up
  float cone = smoothstep(-0.15, 0.35, Lw.y);
  float w = 1.0 - smoothstep(vRadius * 0.45, vRadius, dist);
  float att = w * w / (dist * dist + 2.0);
  vec3 V = normalize(-P);
  vec3 H = normalize(d / dist + V);
  vec3 Hw = uCamRot * H;
  float rough = g1.a;
  float spec = pow(max(dot(N, Hw), 0.0), 2.0 / max(rough * rough * rough * rough, 1e-3) - 2.0 + 1e-3) * (1.0 - rough) * 0.6;
  float ao = texture(tAO, uv).r;
  fragColor = vec4((albedo * 0.3183 + spec * 0.04) * vColor * (NoL * att * cone * uStrength * mix(0.6, 1.0, ao)), 1.0);
}`;

export class LocalLights {
  constructor(pipeline, max = 640) {
    this.pipeline = pipeline; this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iLight = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.iLight.setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.iColor.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iLight', this.iLight); g.setAttribute('iColor', this.iColor);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const L = pipeline.lighting.uniforms;
    this.uniforms = { tAlbedo: L.tAlbedo, tNormal: L.tNormal, tMaterial: L.tMaterial, tEmissive: L.tEmissive, tDepth: L.tDepth, uProj: L.uProj, uProjOff: L.uProjOff,
      tAO: L.tAO, uCamRot: L.uCamRot, uRes: L.uRes, uStrength: { value: 0 } };
    this.material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.geo = g; this.count = 0;
    this._last = new THREE.Vector3(1e9, 0, 1e9); this._ver = -1;
    pipeline.onLights = (r, target, camera) => { if (this.count > 0 && this.uniforms.uStrength.value > 0.001) { r.setRenderTarget(target); r.render(this.scene, camera); } };
  }

  /** sources: iterable of Float32Array [x, y, z, ...] (world); strength 0..1 (city lights factor). */
  update(camera, sources, version, strength) {
    this.uniforms.uStrength.value = strength;
    if (strength <= 0.001) return;
    const p = camera.position;
    if (version === this._ver && Math.abs(p.x - this._last.x) < 12 && Math.abs(p.z - this._last.z) < 12) return;
    this._ver = version; this._last.copy(p);
    const RANGE = 330, R2 = RANGE * RANGE;
    const cand = [];
    for (const arr of sources) for (let i = 0; i < arr.length; i += 3) { const dx = arr[i] - p.x, dz = arr[i + 2] - p.z; const d2 = dx * dx + dz * dz; if (d2 < R2) cand.push(d2, arr[i], arr[i + 1], arr[i + 2]); }
    let n = cand.length / 4;
    let order = Array.from({ length: n }, (_, i) => i);
    if (n > this.max) { order.sort((a, b) => cand[a * 4] - cand[b * 4]); order = order.slice(0, this.max); n = this.max; }
    const ox = Math.round(p.x / 64) * 64, oz = Math.round(p.z / 64) * 64;
    for (let k = 0; k < n; k++) {
      const i = order[k] * 4;
      this.iLight.array[k * 4] = cand[i + 1] - ox; this.iLight.array[k * 4 + 1] = cand[i + 2]; this.iLight.array[k * 4 + 2] = cand[i + 3] - oz; this.iLight.array[k * 4 + 3] = cand[i + 2] > 8 ? 30 : 22;
      // warm white, a little variation between lamps
      const v = 0.9 + 0.2 * ((Math.abs(cand[i + 1] * 7.3 + cand[i + 3] * 3.1) % 1));
      const pw = cand[i + 2] > 8 ? 900 : 520;
      this.iColor.array[k * 3] = 1.0 * pw * v; this.iColor.array[k * 3 + 1] = 0.83 * pw * v; this.iColor.array[k * 3 + 2] = 0.60 * pw * v;
    }
    this.iLight.needsUpdate = true; this.iColor.needsUpdate = true;
    this.nStatic = n; this.ox = ox; this.oz = oz;
    this.geo.instanceCount = n; this.count = n;
    this.mesh.position.set(ox, 0, oz); this.mesh.updateMatrix(); this.mesh.updateMatrixWorld(true);
  }

  /** Lights that move (headlamp pools): list = [x, y, z, radius, r, g, b] * n, appended after the street lamps every frame. */
  setDynamic(list, n) {
    const base = this.nStatic || 0;
    n = Math.min(n, this.max - base);
    if (this.uniforms.uStrength.value <= 0.001 || n <= 0) { if (this.count !== base) { this.count = base; this.geo.instanceCount = base; } return; }
    const ox = this.ox || 0, oz = this.oz || 0, L = this.iLight.array, C = this.iColor.array;
    for (let k = 0; k < n; k++) {
      const o = (base + k) * 4, c = (base + k) * 3, i = k * 7;
      L[o] = list[i] - ox; L[o + 1] = list[i + 1]; L[o + 2] = list[i + 2] - oz; L[o + 3] = list[i + 3];
      C[c] = list[i + 4]; C[c + 1] = list[i + 5]; C[c + 2] = list[i + 6];
    }
    this.iLight.needsUpdate = true; this.iColor.needsUpdate = true;
    this.count = base + n; this.geo.instanceCount = base + n;
  }
}
