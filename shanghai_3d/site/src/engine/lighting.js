// Deferred lighting: one full-screen pass turns the G-buffer into lit HDR radiance.
// Sun (cascaded shadows, contact-hardening), sky light from the atmosphere's irradiance / prefiltered maps, emissive,
// then aerial perspective. Pixels with no geometry get the sky itself.

import * as THREE from 'three';
import { PRECISION, FS_VERT, NOISE, GBUFFER_DECODE, BRDF, SM } from './glsl.js';
import { ATMO_COMMON, SKY_LOOKUP, CLOUDS, SKY_COLOR, EQUIRECT, ENV_SAMPLE } from './atmosphere.js';
import { SHADOW_GLSL } from './shadows.js';

const LIGHTING_FRAG = /* glsl */`${PRECISION}
${NOISE}
${BRDF}
${GBUFFER_DECODE}
${ATMO_COMMON}
${SKY_LOOKUP}
${CLOUDS}
${SKY_COLOR}
${EQUIRECT}
${ENV_SAMPLE}
${SHADOW_GLSL}
uniform sampler2D tAO;            // r: ambient occlusion, g: sky visibility (large scale)
uniform sampler2D tSSR;           // rgb: reflected radiance, a: confidence
uniform sampler2D tPrev;          // last frame's lit image (for mirror reflections on water)
uniform float uPrevValid;
uniform mat3 uCamRot;             // view -> world rotation
uniform vec3 uCamPos;             // world position of the camera
uniform vec3 uLightDir;           // world, towards the light
uniform vec3 uLightColor;         // irradiance of the main light on a surface facing it
uniform vec4 uFrame;              // x: frame index, y: debug view, z: ao on, w: ssr on
uniform vec2 uRes;
uniform vec4 uWet;                // x: wetness 0..1, y: puddle amount, z: night lights, w: exposure hint
in vec2 vUv; out vec4 fragColor;

// mean of exp(-h / H) between two heights (km)
float expSeg(float h0, float h1, float H) {
  float d = h1 - h0;
  if (abs(d) < 1e-4) return exp(-h0 / H);
  return H * (exp(-h0 / H) - exp(-h1 / H)) / d;
}
// Aerial perspective for a segment from the camera: in-scattered light and transmittance, same coefficients as the sky.
void aerial(vec3 dirW, float dist, out vec3 inscatter, out vec3 trans) {
  float h0 = max(uCamPos.y, 0.0) * 1e-3;
  float h1 = max(uCamPos.y + dirW.y * dist, 0.0) * 1e-3;
  float dR = expSeg(h0, h1, 8.0);
  float dM = expSeg(h0, h1, uAtmo.y) * uAtmo.x;
  vec3 sR = rayleighScatteringBase * dR;
  float sM = mieScatteringBase * dM;
  vec3 ext = sR + sM + mieAbsorptionBase * dM;
  trans = exp(-ext * (dist * 1e-6));
  vec3 pos = vec3(0.0, groundRadiusMM + (h0 + h1) * 0.5e-3, 0.0);
  vec2 uv = lutUV(pos, uSunDirTrue);
  vec3 sunT = texture(tTransmittance, uv).rgb;
  vec3 psi = texture(tMultiScatter, uv).rgb;
  float c = dot(dirW, uSunDirTrue);
  vec3 S = sR * (getRayleighPhase(-c) * sunT + psi) + sM * (getMiePhase(c) * sunT + psi);
  inscatter = S / max(ext, vec3(1e-6)) * (1.0 - trans) * uSkyParams.y;
  // at night the haze carries the glow of the city
  inscatter += uNightSky * 1.6 * (1.0 - trans.g);
}

void main() {
  float depth = texture(tDepth, vUv).r;
  vec3 rayV = viewRay(vUv);
  vec3 dirW = normalize(uCamRot * rayV);
  float noise = ignT(gl_FragCoord.xy, uFrame.x);
  if (isSky(depth)) {
    vec3 sky = skyRadiance(dirW, uCamPos.y, true);
    fragColor = vec4(sky, 1.0);
    return;
  }
  vec3 P = viewPosAt(vUv, depth);
  float dist = length(P);
  vec4 g0 = texture(tAlbedo, vUv), g1 = texture(tNormal, vUv), g2 = texture(tMaterial, vUv);
  vec3 albedo = g0.rgb * g0.rgb;
  float micro = g0.a;
  vec3 N = octDecode(unpack2x12(g1.rgb));
  float roughness = g1.a;
  float metal = g2.r, matAO = g2.g, refl = g2.b;
  int model = int(g2.a * 255.0 + 0.5) & 127;          // (128: a moving object, for the temporal filter)
  vec3 emissive = texture(tEmissive, vUv).rgb;
  vec3 V = -dirW;
  vec3 Nv = transpose(uCamRot) * N;
  vec2 aoS = uFrame.z > 0.5 ? texture(tAO, vUv).rg : vec2(1.0);
  float ao = min(matAO, aoS.r);
  float skyVis = aoS.g;

  // wet weather: darker, glossier surfaces; flat ground collects a film of water
  float wet = uWet.x;
  if (wet > 0.001 && model != ${SM.WATER}) {
    float up = smoothstep(0.55, 0.95, N.y);
    vec3 wp = uCamPos + dirW * dist;
    float puddle = up * smoothstep(0.50, 0.72, vnoise(wp.xz * 0.23) * 0.6 + vnoise(wp.xz * 0.61 + 7.0) * 0.4) * uWet.y;
    float film = wet * (0.35 + 0.65 * up);
    albedo *= mix(1.0, 0.55, film * (1.0 - metal));
    roughness = mix(roughness, mix(0.32, 0.06, puddle), film * (0.55 + 0.45 * puddle));
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), puddle * wet * 0.9));
    refl = mix(refl, 0.42, puddle * wet);
  }

  float NoV = clamp(dot(N, V), 1e-4, 1.0);
  vec3 f0 = mix(vec3(0.16 * refl * refl), albedo, metal);
  vec3 diffuseColor = albedo * (1.0 - metal);
  float a = roughness * roughness;

  // ---- main light
  vec3 L = uLightDir;
  float NoL = dot(N, L);
  vec3 direct = vec3(0.0);
  float shadow = 1.0;
  vec3 wposApprox = uCamPos + dirW * dist;
  if (uLightColor.r + uLightColor.g + uLightColor.b > 1e-5) {
    float lit = clamp(NoL, 0.0, 1.0);
    if (model == ${SM.FOLIAGE}) lit = clamp(NoL * 0.6 + 0.4, 0.0, 1.0);
    if (lit > 0.0 || model == ${SM.FOLIAGE}) {
      shadow = min(sunShadow(P, Nv, clamp(NoL, 0.0, 1.0), noise), dynShadow(P, Nv, clamp(NoL, 0.0, 1.0), noise)) * micro;
      shadow *= cloudShadowAt(wposApprox, L);
      vec3 H = normalize(L + V);
      float NoH = clamp(dot(N, H), 0.0, 1.0), VoH = clamp(dot(V, H), 0.0, 1.0);
      vec3 F = F_Schlick(f0, VoH);
      float spec = D_GGX(NoH, max(a, 0.002)) * V_SmithGGXCorrelatedFast(NoV, max(lit, 1e-4), a);
      // the sun is not a point: clamp the mirror peak to the disc's radiance
      spec = min(spec, 2500.0);
      direct = (diffuseColor / PI * (1.0 - F) + F * spec) * uLightColor * lit * shadow;
      if (model == ${SM.FOLIAGE}) {
        // light coming through the leaf from behind
        float back = clamp(-NoL, 0.0, 1.0) * 0.55 + 0.12;
        float vl = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
        direct += diffuseColor * vec3(1.05, 1.1, 0.55) / PI * uLightColor * back * (0.6 + 1.6 * vl) * shadow;
      }
    }
  }

  // ---- sky light
  vec3 irr = envIrradiance(N);
  // sky visibility only removes light from above; what is left when a street is boxed in is the bounce off its walls
  vec3 bounce = envIrradiance(vec3(N.x, -abs(N.y) - 0.3, N.z)) * 0.9 + uLightColor * (0.035 * max(L.y, 0.0));
  // sun light scattered once off the surrounding streets and facades: an even, warm-neutral fill
  vec3 fill = uLightColor * (0.030 * (0.25 + 0.75 * max(L.y, 0.0)));
  vec3 ambient = (mix(bounce * 0.55, irr, skyVis) + fill * mix(0.6, 1.0, skyVis)) * ao;
  // multi-bounce: bright surfaces fill their own crevices
  vec3 aoMB = ao + (1.0 - ao) * albedo * 0.6 * ao;
  vec3 diffuseAmb = diffuseColor * ambient * aoMB / max(ao, 1e-3);
  vec3 R = reflect(-V, N);
  // rough surfaces reflect closer to the normal
  R = normalize(mix(R, N, a * a));
  float horizon = clamp(1.0 + 1.6 * dot(R, N), 0.0, 1.0);
  float specOcc = clamp(pow(NoV + ao, exp2(-16.0 * roughness - 1.0)) - 1.0 + ao, 0.0, 1.0) * mix(0.35, 1.0, skyVis);
  vec3 env = envSpecular(R, roughness);
  if (uFrame.w > 0.5) {
    vec4 ssr = texture(tSSR, vUv);
    env = mix(env * specOcc, ssr.rgb, ssr.a);
  } else env *= specOcc;
  if (model == ${SM.WATER} && uPrevValid > 0.5 && R.y > 0.0) {
    // mirror the far scene in the water: treat what is reflected as distant, so only the direction matters
    vec3 Rv = transpose(uCamRot) * R;
    if (Rv.z < -1e-3) {
      vec2 ndc = vec2(Rv.x / -Rv.z * uProj.x, Rv.y / -Rv.z * uProj.y) - uProjOff.xy;
      vec2 ruv = ndc * 0.5 + 0.5;
      vec2 e = min(ruv, 1.0 - ruv);
      float k = smoothstep(0.0, 0.06, min(e.x, e.y));
      if (k > 0.0) env = mix(env, textureLod(tPrev, ruv, 0.0).rgb, k);
    }
  }
  vec3 specAmb = env * envBRDF(f0, roughness, NoV) * horizon * horizon;

  vec3 color = direct + diffuseAmb + specAmb + emissive;

  if (model == ${SM.UNLIT}) color = albedo + emissive;

  // ---- aerial perspective
  vec3 ins, tr;
  aerial(dirW, dist, ins, tr);
  color = color * tr + ins;

  int dbg = int(uFrame.y + 0.5);
  if (dbg == 1) color = albedo;
  else if (dbg == 2) color = N * 0.5 + 0.5;
  else if (dbg == 3) color = vec3(roughness, metal, refl);
  else if (dbg == 4) color = vec3(ao, skyVis, matAO);
  else if (dbg == 5) color = vec3(shadow);
  else if (dbg == 6) color = vec3(fract(dist * 0.1), fract(dist * 0.01), fract(dist * 0.001));
  else if (dbg == 7) color = emissive;
  else if (dbg == 8) color = irr;
  else if (dbg == 9) color = env;
  fragColor = vec4(max(color, 0.0), 1.0);
}`;

export class LightingPass {
  constructor(atmosphere, shadows) {
    this.uniforms = {
      tAlbedo: { value: null }, tNormal: { value: null }, tMaterial: { value: null }, tEmissive: { value: null }, tDepth: { value: null },
      tAO: { value: null }, tSSR: { value: null }, tPrev: { value: null }, uPrevValid: { value: 0 },
      uProj: { value: new THREE.Vector4() }, uProjOff: { value: new THREE.Vector4() },
      uCamRot: { value: new THREE.Matrix3() }, uCamPos: { value: new THREE.Vector3() },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightColor: { value: new THREE.Vector3(1, 1, 1) },
      uFrame: { value: new THREE.Vector4(0, 0, 0, 0) }, uRes: { value: new THREE.Vector2(1, 1) },
      uWet: { value: new THREE.Vector4(0, 0, 0, 1) },
      ...atmosphere.uniforms, ...shadows.uniforms,
    };
    this.material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: LIGHTING_FRAG, uniforms: this.uniforms, depthTest: false, depthWrite: false });
  }
}

/** Fill the shared projection uniforms (uProj / uProjOff) for a camera. */
export function setProjUniforms(camera, reversed, uProj, uProjOff) {
  const e = camera.projectionMatrix.elements;
  uProj.set(e[0], e[5], e[10], e[14]);
  uProjOff.set(e[8], e[9], reversed ? 1 : 2, reversed ? 0 : -1);
}
