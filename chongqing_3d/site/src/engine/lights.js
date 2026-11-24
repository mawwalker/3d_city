// Local lights (street lamps, architectural landmark floodlights, vehicle headlamps, monorail/cableway lights)
// rendered as deferred additive screen-space light volumes against the G-buffer.

import * as THREE from 'three';
import { PRECISION, GBUFFER_DECODE } from './glsl.js';

const VERT = /* glsl */`${PRECISION}
in vec2 position;
in vec4 iLight;            // xyz: position relative to mesh origin, w: radius
in vec4 iColor;            // rgb: intensity, a: 0 = downward street luminaire, 1 = omnidirectional landmark/headlamp
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vCenter; out float vRadius; out vec4 vColor;

// Exact projected 1D tangent bounds [minSlope, maxSlope] of a 2D circle (coord, az) of radius R onto plane z = -1.
vec2 sphereAxisBounds(float coord, float az, float R) {
  float d2 = coord * coord + az * az;
  float r2 = R * R;
  if (d2 <= r2) return vec2(-1e4, 1e4);
  float d = sqrt(d2);
  float t = sqrt(d2 - r2);
  float cosA = t / d, sinA = R / d;
  float txL = coord * cosA - az * sinA, tzL = az * cosA + coord * sinA;
  float txR = coord * cosA + az * sinA, tzR = az * cosA - coord * sinA;
  float sMin = tzL > 1e-4 ? txL / tzL : -1e4;
  float sMax = tzR > 1e-4 ? txR / tzR :  1e4;
  return vec2(sMin, sMax);
}

void main() {
  vec4 c = viewMatrix * (modelMatrix * vec4(iLight.xyz, 1.0));
  vCenter = c.xyz; vRadius = iLight.w; vColor = iColor;
  float R = iLight.w * 1.04;
  // Cull lights entirely behind the camera
  if (c.z - R > 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // Camera inside or intersecting the light sphere -> full-screen quad (zero near-plane clipping)
  if (dot(c.xyz, c.xyz) <= R * R || c.z + R >= -0.25) {
    gl_Position = vec4(position, 0.0, 1.0);
    return;
  }
  float az = -c.z;
  vec2 bx = sphereAxisBounds(c.x, az, R);
  vec2 by = sphereAxisBounds(c.y, az, R);
  float x0 = bx.x * projectionMatrix[0][0] - projectionMatrix[2][0];
  float x1 = bx.y * projectionMatrix[0][0] - projectionMatrix[2][0];
  float y0 = by.x * projectionMatrix[1][1] - projectionMatrix[2][1];
  float y1 = by.y * projectionMatrix[1][1] - projectionMatrix[2][1];
  if (x1 < -1.0 || x0 > 1.0 || y1 < -1.0 || y0 > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 ndc = mix(
    vec2(max(x0, -1.02), max(y0, -1.02)),
    vec2(min(x1,  1.02), min(y1,  1.02)),
    position * 0.5 + 0.5
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const FRAG = /* glsl */`${PRECISION}
${GBUFFER_DECODE}
uniform sampler2D tAO;
uniform mat3 uCamRot;
uniform vec2 uRes;
uniform float uStrength;
in vec3 vCenter; in float vRadius; in vec4 vColor;
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
  if (model == 1) NoL = NoL * 0.5 + 0.5;
  if (NoL <= 0.0) discard;
  vec4 g0 = texture(tAlbedo, uv);
  vec3 albedo = g0.rgb * g0.rgb * (1.0 - g2.r);
  // Street lamps cast downward; architectural landmark lights (vColor.a > 0.5) illuminate all directions
  float cone = mix(smoothstep(-0.15, 0.35, Lw.y), 1.0, vColor.a);
  float w = 1.0 - smoothstep(vRadius * 0.25, vRadius, dist);
  float att = w * w / (dist * dist + mix(2.0, 6.0, vColor.a));
  vec3 V = normalize(-P);
  vec3 H = normalize(d / dist + V);
  vec3 Hw = uCamRot * H;
  float rough = g1.a;
  float spec = pow(max(dot(N, Hw), 0.0), 2.0 / max(rough * rough * rough * rough, 1e-3) - 2.0 + 1e-3) * (1.0 - rough) * 0.6;
  float ao = texture(tAO, uv).r;
  fragColor = vec4((albedo * 0.3183 + spec * 0.045) * vColor.rgb * (NoL * att * cone * uStrength * mix(0.6, 1.0, ao)), 1.0);
}`;

export class LocalLights {
  constructor(pipeline, max = 1024) {
    this.pipeline = pipeline; this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iLight = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.iLight.setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.iColor.setUsage(THREE.DynamicDrawUsage);
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
    this.geo = g; this.count = 0; this.nStatic = 0;
    this.ox = 0; this.oz = 0;
    this._last = new THREE.Vector3(1e9, 0, 1e9); this._ver = -1;
    this.landmarkLights = null; // Float32Array of 8-float [x, y, z, radius, r, g, b, omni]
    this._lmVer = 0;
    pipeline.onLights = (r, target, camera) => { if (this.count > 0 && this.uniforms.uStrength.value > 0.001) { r.setRenderTarget(target); r.render(this.scene, camera); } };
  }

  /**
   * Register architectural landmark lights (Hongyadong cliff lanterns, Raffles City, Guotai, bridges, etc.).
   * Accepts Float32Array / Array with stride 8: [x, y, z, radius, r, g, b, omni(0|1)] or stride 7: [x, y, z, radius, r, g, b] (omni defaults to 1).
   */
  setLandmarkLights(list, stride = null) {
    if (!list || !list.length) { this.landmarkLights = null; this._lmVer++; return; }
    const st = stride || (list.length % 8 === 0 ? 8 : 7);
    const n = Math.floor(list.length / st);
    const out = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      const s = i * st, d = i * 8;
      out[d] = list[s]; out[d + 1] = list[s + 1]; out[d + 2] = list[s + 2]; out[d + 3] = list[s + 3];
      out[d + 4] = list[s + 4]; out[d + 5] = list[s + 5]; out[d + 6] = list[s + 6];
      out[d + 7] = st >= 8 ? list[s + 7] : 1;
    }
    this.landmarkLights = out;
    this._lmVer++;
  }

  /** Street lamps + landmark lights around the camera. sources: iterable of Float32Array [x, y, z, ...]. */
  update(camera, sources, version, strength) {
    this.uniforms.uStrength.value = strength;
    if (strength <= 0.001) return;
    const p = camera.position;
    const ver = version * 10007 + this._lmVer;
    if (ver === this._ver && Math.abs(p.x - this._last.x) < 12 && Math.abs(p.z - this._last.z) < 12 && Math.abs(p.y - this._last.y) < 18) return;
    this._ver = ver; this._last.copy(p);
    const ox = Math.round(p.x / 64) * 64, oz = Math.round(p.z / 64) * 64;
    const L = this.iLight.array, C = this.iColor.array;
    const staticCap = this.max - 160; // reserve 160 slots for dynamic headlamps / trains
    let n = 0;

    // 1. Landmark lights first (longer range: 1100 m so Hongyadong & bridges illuminate river & cliffs from afar)
    if (this.landmarkLights) {
      const lm = this.landmarkLights, nl = lm.length / 8;
      const lmCand = [];
      for (let i = 0; i < nl; i++) {
        const o = i * 8;
        const dx = lm[o] - p.x, dy = lm[o + 1] - p.y, dz = lm[o + 2] - p.z;
        const d2 = dx * dx + dy * dy * 0.5 + dz * dz;
        const maxR = Math.max(950, lm[o + 3] * 14);
        if (d2 < maxR * maxR) lmCand.push(d2, o);
      }
      const lmN = Math.min(lmCand.length / 2, 360);
      let ord = Array.from({ length: lmCand.length / 2 }, (_, i) => i);
      if (ord.length > lmN) { ord.sort((a, b) => lmCand[a * 2] - lmCand[b * 2]); ord = ord.slice(0, lmN); }
      for (let k = 0; k < ord.length && n < staticCap; k++) {
        const o = lmCand[ord[k] * 2 + 1];
        L[n * 4] = lm[o] - ox; L[n * 4 + 1] = lm[o + 1]; L[n * 4 + 2] = lm[o + 2] - oz; L[n * 4 + 3] = lm[o + 3];
        C[n * 4] = lm[o + 4]; C[n * 4 + 1] = lm[o + 5]; C[n * 4 + 2] = lm[o + 6]; C[n * 4 + 3] = lm[o + 7];
        n++;
      }
    }

    // 2. Street lamps (340 m range)
    const RANGE = 340, R2 = RANGE * RANGE;
    const cand = [];
    if (sources) {
      for (const arr of sources) {
        for (let i = 0; i < arr.length; i += 3) {
          const dx = arr[i] - p.x, dz = arr[i + 2] - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < R2) cand.push(d2, arr[i], arr[i + 1], arr[i + 2]);
        }
      }
    }
    const rem = staticCap - n;
    let sn = cand.length / 4;
    let order = Array.from({ length: sn }, (_, i) => i);
    if (sn > rem) { order.sort((a, b) => cand[a * 4] - cand[b * 4]); order = order.slice(0, rem); sn = rem; }
    for (let k = 0; k < sn; k++) {
      const i = order[k] * 4;
      const lx = cand[i + 1], ly = cand[i + 2], lz = cand[i + 3];
      L[n * 4] = lx - ox; L[n * 4 + 1] = ly; L[n * 4 + 2] = lz - oz; L[n * 4 + 3] = 26;
      const v = 0.88 + 0.24 * ((Math.abs(lx * 7.3 + lz * 3.1) % 1));
      const pw = 720;
      C[n * 4] = 1.0 * pw * v; C[n * 4 + 1] = 0.81 * pw * v; C[n * 4 + 2] = 0.56 * pw * v; C[n * 4 + 3] = 0.0;
      n++;
    }

    this.iLight.needsUpdate = true; this.iColor.needsUpdate = true;
    this.nStatic = n; this.ox = ox; this.oz = oz;
    this.geo.instanceCount = n; this.count = n;
    this.mesh.position.set(ox, 0, oz); this.mesh.updateMatrix(); this.mesh.updateMatrixWorld(true);
  }

  /** Moving lights (headlamps, monorail, cableway): list = [x, y, z, radius, r, g, b] * n. */
  setDynamic(list, n) {
    const base = this.nStatic || 0;
    n = Math.min(n, this.max - base);
    if (this.uniforms.uStrength.value <= 0.001 || n <= 0) {
      if (this.count !== base) { this.count = base; this.geo.instanceCount = base; }
      return;
    }
    const ox = this.ox || 0, oz = this.oz || 0, L = this.iLight.array, C = this.iColor.array;
    for (let k = 0; k < n; k++) {
      const o = (base + k) * 4, i = k * 7;
      L[o] = list[i] - ox; L[o + 1] = list[i + 1]; L[o + 2] = list[i + 2] - oz; L[o + 3] = list[i + 3];
      C[o] = list[i + 4]; C[o + 1] = list[i + 5]; C[o + 2] = list[i + 6]; C[o + 3] = 1.0;
    }
    this.iLight.needsUpdate = true; this.iColor.needsUpdate = true;
    this.count = base + n; this.geo.instanceCount = base + n;
  }
}
