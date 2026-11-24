// Deferred lighting: one full-screen pass turns the G-buffer into lit HDR radiance.
// Upgraded for Chongqing 8D:
//   - Layered mountain-valley mist ("雾都") hugging the Yangtze & Jialing valleys while preserving street-level crispness
//   - Screen-space water reflections + wet-puddle reflections at night (Hongyadong, Raffles City, bridges & neon)
//   - Crisp contact-hardening 4-cascade sun shadows + GTAO + HeightField sky visibility

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
uniform sampler2D tPrev;          // last frame's lit HDR image (for water & wet-puddle reflections)
uniform float uPrevValid;
uniform mat3 uCamRot;             // view -> world rotation
uniform vec3 uCamPos;             // world position of the camera
uniform vec3 uLightDir;           // world, towards the light
uniform vec3 uLightColor;         // irradiance of the main light on a surface facing it
uniform vec4 uFrame;              // x: frame index, y: debug view, z: ao on, w: water/puddle SSR on
uniform vec2 uRes;
uniform vec4 uWet;                // x: wetness 0..1, y: puddle amount, z: night lights, w: waterY
uniform vec4 uFogParams;          // x: valley mist density, y: baseY (waterY), z: scale height (m), w: night factor
in vec2 vUv; out vec4 fragColor;

float expSeg(float h0, float h1, float H) {
  float d = h1 - h0;
  if (abs(d) < 1e-4) return exp(-h0 / H);
  return H * (exp(-h0 / H) - exp(-h1 / H)) / d;
}

// Aerial perspective + Chongqing river-valley height mist
void aerial(vec3 dirW, float dist, out vec3 inscatter, out vec3 trans) {
  float datum = uFogParams.y;
  float h0 = max(uCamPos.y - datum, 0.0) * 1e-3;
  float h1 = max(uCamPos.y + dirW.y * dist - datum, 0.0) * 1e-3;
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
  inscatter += uNightSky * 1.75 * (1.0 - trans.g);

  // Height-layered Chongqing river-valley mist (starts beyond immediate foreground so street detail stays razor sharp)
  float mistAmt = uFogParams.x;
  if (mistAmt > 0.002 && dist > 60.0) {
    float mh0 = max(uCamPos.y - datum, 0.0);
    float mh1 = max(uCamPos.y + dirW.y * dist - datum, 0.0);
    float avgMist = expSeg(mh0, mh1, max(uFogParams.z, 35.0));
    float dEff = max(0.0, dist - 60.0);
    float od = mistAmt * 0.00055 * dEff * avgMist * smoothstep(60.0, 260.0, dist);
    float mTrans = exp(-min(od, 3.5));
    // Mist colour blends sky ambient + forward sun scatter + warm Chongqing cyber-night glow
    float fwd = pow(max(c, 0.0), 4.0);
    vec3 mistDay = (uSkyAmbient * 0.85 + uSunRadiance * (0.04 + 0.08 * fwd)) * vec3(0.95, 0.98, 1.03);
    vec3 mistNight = uNightSky * 1.85 + vec3(0.008, 0.013, 0.022) * uWet.z;
    vec3 mistCol = mix(mistDay, mistNight, uFogParams.w);
    inscatter = inscatter * mTrans + mistCol * (1.0 - mTrans);
    trans *= mTrans;
  }
}

// Fast view-space screen-space reflection march against tDepth, sampling previous frame HDR (tPrev)
vec4 traceSSR(vec3 P, vec3 Rv, float maxDist, float noise, int steps) {
  if (Rv.z > 0.45) return vec4(0.0);
  float stepLen = maxDist / float(steps);
  float t = stepLen * (0.35 + 0.65 * noise);
  for (int i = 0; i < 14; i++) {
    if (i >= steps) break;
    vec3 Q = P + Rv * t;
    if (Q.z > -0.25) break;
    vec2 ndc = vec2(Q.x / -Q.z * uProj.x, Q.y / -Q.z * uProj.y) - uProjOff.xy;
    vec2 ruv = ndc * 0.5 + 0.5;
    if (ruv.x <= 0.005 || ruv.x >= 0.995 || ruv.y <= 0.005 || ruv.y >= 0.995) break;
    float d = textureLod(tDepth, ruv, 0.0).r;
    if (!isSky(d)) {
      float sceneZ = linearZ(d);
      float rayZ = -Q.z;
      float diff = rayZ - sceneZ;
      float thick = max(2.2, stepLen * 1.45 + rayZ * 0.025);
      if (diff > 0.05 && diff < thick) {
        vec2 e = min(ruv, 1.0 - ruv);
        float edgeFade = smoothstep(0.0, 0.07, min(e.x, e.y));
        float distFade = 1.0 - smoothstep(maxDist * 0.65, maxDist, t);
        vec3 col = textureLod(tPrev, ruv, 0.0).rgb;
        return vec4(col, edgeFade * distFade);
      }
    }
    stepLen *= 1.18;
    t += stepLen;
  }
  return vec4(0.0);
}

void main() {
  float depth = texture(tDepth, vUv).r;
  vec3 rayV = viewRay(vUv);
  vec3 dirW = normalize(uCamRot * rayV);
  float noise = ignT(gl_FragCoord.xy, uFrame.x);
  if (isSky(depth)) {
    vec3 sky = skyRadiance(dirW, max(uCamPos.y - uFogParams.y, 1.5), true);
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
  int model = int(g2.a * 255.0 + 0.5) & 127;
  vec3 emissive = texture(tEmissive, vUv).rgb;
  vec3 V = -dirW;
  vec3 Nv = transpose(uCamRot) * N;
  vec2 aoS = uFrame.z > 0.5 ? texture(tAO, vUv).rg : vec2(1.0);
  float ao = min(matAO, aoS.r);
  float skyVis = aoS.g;

  // Wet weather: darker, glossier surfaces; flat streets collect reflective puddles
  float wet = uWet.x;
  float puddle = 0.0;
  if (wet > 0.001 && model != ${SM.WATER}) {
    float up = smoothstep(0.55, 0.95, N.y);
    vec3 wp = uCamPos + dirW * dist;
    puddle = up * smoothstep(0.46, 0.70, vnoise(wp.xz * 0.21) * 0.6 + vnoise(wp.xz * 0.57 + 7.0) * 0.4) * uWet.y;
    float film = wet * (0.35 + 0.65 * up);
    albedo *= mix(1.0, 0.52, film * (1.0 - metal));
    roughness = mix(roughness, mix(0.28, 0.045, puddle), film * (0.58 + 0.42 * puddle));
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), puddle * wet * 0.92));
    refl = mix(refl, 0.48, puddle * wet);
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
      spec = min(spec, 2500.0);
      direct = (diffuseColor / PI * (1.0 - F) + F * spec) * uLightColor * lit * shadow;
      if (model == ${SM.FOLIAGE}) {
        float back = clamp(-NoL, 0.0, 1.0) * 0.55 + 0.12;
        float vl = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
        direct += diffuseColor * vec3(1.05, 1.1, 0.55) / PI * uLightColor * back * (0.6 + 1.6 * vl) * shadow;
      }
    }
  }

  // ---- sky light (crisp daytime sun-vs-sky contrast + subtle night Chongqing urban skyglow bounce)
  vec3 irr = envIrradiance(N);
  vec3 nightFloor = uNightSky * (0.34 * uFogParams.w * (0.65 + 0.35 * max(N.y, 0.0)));
  vec3 bounce = envIrradiance(vec3(N.x, -abs(N.y) - 0.3, N.z)) * 0.78 + uLightColor * (0.026 * max(L.y, 0.0)) + nightFloor;
  vec3 fill = uLightColor * (0.018 * (0.22 + 0.78 * max(L.y, 0.0))) + nightFloor * 0.55;
  vec3 ambient = (mix(bounce * 0.46, irr + nightFloor * 0.45, skyVis) + fill * mix(0.45, 1.0, skyVis)) * ao;
  vec3 aoMB = ao + (1.0 - ao) * albedo * 0.38 * ao;
  vec3 diffuseAmb = diffuseColor * ambient * aoMB / max(ao, 1e-3);
  vec3 R = reflect(-V, N);
  R = normalize(mix(R, N, a * a));
  float horizon = clamp(1.0 + 1.6 * dot(R, N), 0.0, 1.0);
  float specOcc = clamp(pow(NoV + ao, exp2(-16.0 * roughness - 1.0)) - 1.0 + ao, 0.0, 1.0) * mix(0.42, 1.0, skyVis);
  // Crisp sky/environment reflection boost on smooth glass, metal & damp granite
  float glossBoost = mix(1.0, 1.24, smoothstep(0.38, 0.05, roughness));
  vec3 env = envSpecular(R, roughness) * specOcc * glossBoost;

  // Water & rainy-street screen-space reflections (Hongyadong, Raffles City, bridges & neon on river & puddles!)
  if (uPrevValid > 0.5 && R.y > -0.05) {
    if (model == ${SM.WATER}) {
      vec3 Rv = transpose(uCamRot) * R;
      // Far-field mirrored skyline fallback first
      if (Rv.z < -1e-3) {
        vec2 ndc = vec2(Rv.x / -Rv.z * uProj.x, Rv.y / -Rv.z * uProj.y) - uProjOff.xy;
        vec2 ruv = ndc * 0.5 + 0.5;
        vec2 e = min(ruv, 1.0 - ruv);
        float k = smoothstep(0.0, 0.06, min(e.x, e.y));
        if (k > 0.0) env = mix(env, textureLod(tPrev, ruv, 0.0).rgb, k * 0.92);
      }
      // Near/mid raymarched SSR for vivid riverside cliff & bridge reflections right below Hongyadong & bridges
      if (uFrame.w > 0.5 && dist < 2400.0) {
        vec4 hit = traceSSR(P, Rv, min(550.0, dist * 1.4 + 120.0), noise, 12);
        if (hit.a > 0.01) env = mix(env, hit.rgb * mix(1.0, 1.35, uWet.z), hit.a * 0.92);
      }
    } else if (uFrame.w > 0.5 && puddle * wet > 0.16 && dist < 180.0) {
      vec3 Rv = transpose(uCamRot) * R;
      vec4 hit = traceSSR(P, Rv, 95.0, noise, 10);
      if (hit.a > 0.01) env = mix(env, hit.rgb * mix(1.0, 1.25, uWet.z), hit.a * puddle * wet);
    }
  }

  vec3 specAmb = env * envBRDF(f0, roughness, NoV) * horizon * horizon;
  vec3 color = direct + diffuseAmb + specAmb + emissive;
  if (model == ${SM.UNLIT}) color = albedo + emissive;

  // ---- aerial perspective + valley mist
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
      uFrame: { value: new THREE.Vector4(0, 0, 0, 1) }, uRes: { value: new THREE.Vector2(1, 1) },
      uWet: { value: new THREE.Vector4(0, 0, 0, 0) },
      uFogParams: { value: new THREE.Vector4(0.06, 0, 110, 0) },
      ...atmosphere.uniforms, ...shadows.uniforms,
    };
    this.material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: LIGHTING_FRAG, uniforms: this.uniforms, depthTest: false, depthWrite: false });
  }
}

export function setProjUniforms(camera, reversed, uProj, uProjOff) {
  const e = camera.projectionMatrix.elements;
  uProj.set(e[0], e[5], e[10], e[14]);
  uProjOff.set(e[8], e[9], reversed ? 1 : 2, reversed ? 0 : -1);
}
