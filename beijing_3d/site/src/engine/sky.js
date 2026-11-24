// Sky dome: analytic gradient shared with the fog, sun disc + halo, wispy procedural clouds, moon and stars.

import * as THREE from 'three';
import { PRECISION, ENV_UNIFORMS, NOISE, ATMOSPHERE } from './shaderlib.js';

const VERT = /* glsl */`${PRECISION}
in vec3 position;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;       // pin to the far plane
}`;

const FRAG = /* glsl */`${PRECISION}
${ENV_UNIFORMS}
uniform vec3 uTrueSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunDisk;
uniform float uCloudAmount;
in vec3 vDir;
out vec4 fragColor;
${NOISE}
${ATMOSPHERE}

vec4 clouds(vec3 dir) {
  if (dir.y < 0.015 || uCloudAmount <= 0.0) return vec4(0.0);
  // project onto a high layer; stretch along the wind for cirrus-like streaks
  vec2 uv = dir.xz / (dir.y + 0.16);
  vec2 w = uCloud.zw * 0.000022;
  mat2 rot = mat2(0.82, -0.57, 0.57, 0.82);
  vec2 p = rot * uv;
  p = p * vec2(0.55, 1.5) + w;
  float n = fbm(p * 1.1);
  float d = fbm(p * 3.7 + vec2(4.2, 1.7) + w * 1.7);
  float wisps = fbm(vec2(p.x * 0.9, p.y * 5.0) + 11.0);
  float cov = smoothstep(1.02 - uCloudAmount * 0.62, 1.22 - uCloudAmount * 0.42, n * 0.95 + d * 0.38 + wisps * 0.3);
  cov *= smoothstep(0.015, 0.16, dir.y);
  float s = max(dot(dir, uTrueSunDir), 0.0);
  vec3 lit = uSunDisk * 0.20 + uSunGlow * (0.30 + 1.25 * pow(s, 5.0)) + uSkyHorizon * 0.55;
  vec3 dark = mix(uSkyZenith, uSkyHorizon, 0.55) * 0.92;
  vec3 c = mix(dark, lit, smoothstep(0.25, 0.95, d * 0.9 + 0.35 * wisps + 0.25 * s));
  return vec4(c, cov * 0.92);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(vec3(dir.x, max(dir.y, 0.0), dir.z));
  float night = uTimeNight.y;

  // stars (few: this is a big bright city)
  if (night > 0.02 && dir.y > 0.0) {
    vec3 p = dir * 260.0;
    vec3 ip = floor(p);
    float h = hash13(ip);
    float b = smoothstep(0.9972, 1.0, h);
    float tw = 0.75 + 0.25 * sin(uTimeNight.x * (1.5 + h * 3.0) + h * 90.0);
    vec3 fp = fract(p) - 0.5;
    float pt = smoothstep(0.42, 0.0, length(fp));
    col += vec3(0.85, 0.9, 1.0) * b * tw * pt * night * 1.6 * smoothstep(0.02, 0.35, dir.y);
  }
  // moon
  float md = dot(dir, uMoonDir);
  float moon = smoothstep(0.99991, 0.99996, md);
  col += (vec3(1.0, 0.97, 0.9) * moon * 2.2 + vec3(0.25, 0.32, 0.5) * pow(max(md, 0.0), 900.0) * 0.5) * night;

  // sun disc (HDR; the bloom pass turns it into a soft glow)
  float sd = dot(dir, uTrueSunDir);
  float disc = smoothstep(0.999935, 0.99997, sd);                  // ~0.55 degree: a touch larger than life, as a long lens would show it
  float limb = mix(0.75, 1.0, smoothstep(0.99994, 0.99999, sd));
  // reddened and dimmed by the haze as it nears the horizon
  float low = clamp(1.0 - uTrueSunDir.y * 6.0, 0.0, 1.0);
  vec3 sunCol = mix(vec3(1.0, 0.86, 0.62) * 22.0, vec3(1.0, 0.50, 0.16) * 6.5, smoothstep(0.0, 0.75, low));
  col += sunCol * disc * limb * step(0.001, dot(uSunDisk, vec3(1.0)));

  vec4 cl = clouds(dir);
  col = mix(col, cl.rgb, cl.a);

  // below the horizon: the same haze colour the fog converges to
  if (dir.y < 0.0) col = mix(col, horizonColor(dir), smoothstep(0.0, -0.02, dir.y));
  fragColor = vec4(col, 1.0);
}`;

export function createSky(env) {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: env.uniforms,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}
