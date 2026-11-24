// Rain: a box of falling streaks that travels with the camera (each streak wraps round the box, so the rain stays put in
// the world while you move through it). Drawn after lighting, hidden behind whatever the depth buffer says is nearer.

import * as THREE from 'three';
import { PRECISION, GBUFFER_DECODE } from '../engine/glsl.js';

const VERT = /* glsl */`${PRECISION}
in vec2 position; in vec3 aSeed;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 uCam; uniform float uTime; uniform vec4 uRain;      // x: amount 0..1, y: fall speed, zw: wind (m/s east, south)
out float vAlpha; out float vViewZ; out float vAcross;
const vec3 BOX = vec3(34.0, 26.0, 34.0);
void main() {
  vec3 vel = vec3(uRain.z, -uRain.y * (0.85 + 0.3 * aSeed.x), uRain.w);
  vec3 p = mod(aSeed * BOX + vel * uTime - uCam, BOX) - BOX * 0.5 + uCam;
  vec3 dir = normalize(vel);
  float d = length(p - uCam), len = 0.55 + 0.5 * aSeed.z;
  vec3 side = normalize(cross(dir, uCam - p));
  vec3 wp = p + dir * (position.y * len) + side * (position.x * max(0.0035, d * 0.0008));
  vec4 vp = viewMatrix * vec4(wp, 1.0);
  vViewZ = vp.z; vAcross = position.x;
  // drawn only if this streak's number is under the amount: the shower thickens and thins streak by streak
  vAlpha = step(aSeed.y, uRain.x) * smoothstep(17.0, 9.0, d) * smoothstep(0.8, 2.6, d) * (0.5 + 0.5 * aSeed.z) * min(1.0, 5.0 / d + 0.35);
  gl_Position = vAlpha > 0.0 ? projectionMatrix * vp : vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FRAG = /* glsl */`${PRECISION}
${GBUFFER_DECODE}
uniform vec2 uRes; uniform vec3 uColor;
in float vAlpha; in float vViewZ; in float vAcross;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float depth = texture(tDepth, uv).r;
  if (!isSky(depth) && viewPosAt(uv, depth).z > vViewZ) discard;
  fragColor = vec4(uColor * (vAlpha * (1.0 - vAcross * vAcross)), 1.0);
}`;

export class Rain {
  constructor({ scenes, env, pipeline }) {
    this.env = env;
    const N = 9000, seed = new Float32Array(N * 3);
    let s = 4242; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < N * 3; i++) seed[i] = rnd();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3));
    g.instanceCount = N; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = { ...pipeline.gb, uRes: pipeline.lighting.uniforms.uRes, uTime: env.uniforms.uTime, uCam: { value: new THREE.Vector3() }, uRain: { value: new THREE.Vector4(0, 9.5, 1.6, 0.8) }, uColor: { value: new THREE.Vector3() } };
    const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.visible = false;
    if (!scenes.forward) scenes.forward = new THREE.Scene();
    scenes.forward.add(this.mesh);
  }

  update(camera) {
    const w = this.env.weather, amount = Math.max(0, Math.min(1, (w.wet - 0.5) * 2));
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uRain.value.x = amount;
    // streaks catch the light of the sky, and of the street lamps at night
    const a = this.env.atmo.uniforms.uSkyAmbient.value, l = this.env.lights;
    this.uniforms.uColor.value.set(a.x * 0.09 + 0.010 * l, a.y * 0.09 + 0.009 * l, a.z * 0.09 + 0.007 * l);
  }
}
