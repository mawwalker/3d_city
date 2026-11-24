// Render pipeline: scene -> MSAA HDR target -> bloom pyramid -> AgX tone map, grade, vignette, grain -> canvas.

import * as THREE from 'three';
import { PRECISION, TONEMAP } from './shaderlib.js';

const FS_VERT = /* glsl */`${PRECISION}
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst; uniform float uThreshold;
in vec2 vUv; out vec4 fragColor;
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb, b = texture(tSrc, vUv + t * vec2(0.0, 2.0)).rgb, c = texture(tSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb, e = texture(tSrc, vUv).rgb, f = texture(tSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb, h = texture(tSrc, vUv + t * vec2(0.0, -2.0)).rgb, i = texture(tSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb, k = texture(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb, m = texture(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col;
  if (uFirst > 0.5) {
    // Karis average on the first pass tames fireflies (sun glints, bright windows)
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (0.125 * (w0 + w1 + w2 + w3) + 0.5 * w4);
    // only true highlights bloom (sun, glints, lamps): a soft knee keeps the haze out of the mid-tones
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + uThreshold * 0.5, 0.0, uThreshold);
    soft = soft * soft / (2.0 * uThreshold + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

const UP_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius;
in vec2 vUv; out vec4 fragColor;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture(tSrc, vUv).rgb * 4.0;
  c += (texture(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture(tSrc, vUv - vec2(t.x, 0.0)).rgb + texture(tSrc, vUv + vec2(0.0, t.y)).rgb + texture(tSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture(tSrc, vUv + t).rgb + texture(tSrc, vUv - t).rgb + texture(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  fragColor = vec4(c / 16.0, 1.0);
}`;

// ---- screen-space ambient occlusion -------------------------------------------------------------------------------
// Scalable Ambient Obscurance (McGuire et al. 2012) on the resolved depth buffer. The world-space radius grows with
// distance, so a close-up gets contact shadows under roof plant and along wall bases while the far city gets the broad
// darkening of street canyons and courtyards. Everything is normalised by the radius, which keeps the look scale-free.
const AO_COMMON = /* glsl */`
uniform sampler2D tDepth;
uniform vec4 uCam;          // near, far, 1/P00, 1/P11
float linZ(float d) { return uCam.x * uCam.y / (uCam.y * (1.0 - d) + uCam.x * d); }
`;

const AO_FRAG = (samples) => /* glsl */`${PRECISION}
${AO_COMMON}
uniform vec2 uDepthRes, uRes;
uniform vec4 uAo;           // radius as a fraction of depth, min radius (m), max radius (m), max radius (px of this target)
uniform vec2 uAoK;          // intensity, depth-buffer resolution term
in vec2 vUv; out vec4 fragColor;
const int N = ${samples};
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec2 snap(vec2 uv) { return (floor(uv * uDepthRes) + 0.5) / uDepthRes; }
vec3 posAt(vec2 uv) { float z = linZ(texture(tDepth, uv).r); return vec3((uv * 2.0 - 1.0) * uCam.zw * z, -z); }
void main() {
  vec2 uv = snap(vUv);
  float d = texture(tDepth, uv).r;
  if (d >= 1.0) { fragColor = vec4(1.0, 400.0, 0.0, 1.0); return; }
  float z = linZ(d);
  vec3 P = vec3((uv * 2.0 - 1.0) * uCam.zw * z, -z);
  vec2 t = 1.0 / uDepthRes;
  // normal from the depth buffer: on each axis take the neighbour that lies on the same surface
  vec3 Pr = posAt(uv + vec2(t.x, 0.0)), Pl = posAt(uv - vec2(t.x, 0.0));
  vec3 Pu = posAt(uv + vec2(0.0, t.y)), Pd = posAt(uv - vec2(0.0, t.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 n = normalize(cross(dx, dy));
  float R = clamp(z * uAo.x, uAo.y, uAo.z);
  vec2 ruv = R * 0.5 / (uCam.zw * z);
  float rpx = ruv.y * uRes.y;
  float k = min(1.0, uAo.w / rpx);
  ruv *= k; R *= k; rpx *= k;
  float ao = 1.0;
  if (rpx > 1.5) {
    float phi = ign(gl_FragCoord.xy) * 6.2831853;
    float bias = 0.03 + z * z * uAoK.y / R;
    float sum = 0.0;
    for (int i = 0; i < N; i++) {
      float a = (float(i) + 0.5) / float(N);
      float ang = a * 43.9823 + phi;                       // 7 turns of the spiral
      vec2 suv = snap(uv + vec2(cos(ang), sin(ang)) * a * ruv);
      vec3 v = (posAt(suv) - P) / R;
      float vv = dot(v, v), vn = dot(v, n);
      float f = max(1.0 - vv, 0.0);
      sum += f * f * f * max((vn - bias) / (0.015 + vv), 0.0);
    }
    // far away the occlusion is of whole blocks rather than corners: keep it lighter there
    float inten = uAoK.x * mix(1.0, 0.6, smoothstep(2500.0, 11000.0, z));
    ao = max(0.0, 1.0 - sum * 5.0 * inten / float(N));
    ao = mix(1.0, ao, smoothstep(1.5, 4.0, rpx));
  }
  fragColor = vec4(ao, z * 0.001, 0.0, 1.0);
}`;

// Separable blur that follows the surface: a neighbour only counts if its depth sits on the plane through the centre tap.
const AO_BLUR_FRAG = /* glsl */`${PRECISION}
uniform sampler2D tAo; uniform vec2 uDir;
in vec2 vUv; out vec4 fragColor;
void main() {
  vec2 c = texture(tAo, vUv).rg;
  vec2 a1 = texture(tAo, vUv + uDir).rg, b1 = texture(tAo, vUv - uDir).rg;
  float sa = a1.g - c.g, sb = c.g - b1.g;
  float slope = abs(sa) < abs(sb) ? sa : sb;
  float tol = 1.0 / (c.g * 0.004 + abs(slope) * 0.6 + 1e-6);
  float sum = c.r * 0.22, w = 0.22;
  float g[3]; g[0] = 0.19; g[1] = 0.13; g[2] = 0.07;
  for (int i = 1; i <= 3; i++) {
    float fi = float(i);
    vec2 a = i == 1 ? a1 : texture(tAo, vUv + uDir * fi).rg;
    vec2 b = i == 1 ? b1 : texture(tAo, vUv - uDir * fi).rg;
    float wa = g[i - 1] * max(0.0, 1.0 - abs(a.g - (c.g + slope * fi)) * tol);
    float wb = g[i - 1] * max(0.0, 1.0 - abs(b.g - (c.g - slope * fi)) * tol);
    sum += a.r * wa + b.r * wb; w += wa + wb;
  }
  fragColor = vec4(sum / w, c.g, 0.0, 1.0);
}`;

const FINAL_FRAG = /* glsl */`${PRECISION}
${AO_COMMON}
uniform sampler2D tAo; uniform vec2 uAoRes; uniform vec4 uAoP; uniform vec3 uAoTint;   // uAoP: strength, fog fade, ambient-lit luminance, share kept in direct light
float aoAt(vec2 uv, float z0) {
  vec2 p = uv * uAoRes - 0.5; vec2 ip = floor(p), f = p - ip;
  ivec2 hi = ivec2(uAoRes) - 1;
  float s = 0.0, w = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 a = texelFetch(tAo, clamp(ivec2(ip) + ivec2(i, j), ivec2(0), hi), 0).rg;
    float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) + 0.02;
    float wz = bw / (0.0006 + abs(a.g * 1000.0 - z0) / z0);
    s += a.r * wz; w += wz;
  }
  return s / w;
}
uniform sampler2D tScene, tBloom, tBlur;
uniform float uExposure, uBloom, uTime, uVignette, uGrain, uTilt, uTiltCenter, uSaturation, uFade;
uniform vec3 uTint;
uniform vec2 uRes;
in vec2 vUv; out vec4 fragColor;
${TONEMAP}
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 hdr = texture(tScene, vUv).rgb;
  if (uAoP.x > 0.0) {
    float d = texture(tDepth, vUv).r;
    if (d < 1.0) {
      float z0 = linZ(d);
      float ao = aoAt(vUv, z0);
      // occlusion only removes sky light: surfaces in full sun (or lit from within at night) keep most of their brightness
      float lum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
      float lit = smoothstep(uAoP.z * 0.7, uAoP.z * 2.2, lum);
      float k = uAoP.x * mix(1.0, uAoP.w, lit) * exp(-z0 * uAoP.y);
      if (uAoTint.x < 0.0) hdr = vec3(mix(1.0, ao, k)) * 0.5;      // debug view
      else hdr *= mix(vec3(1.0), mix(uAoTint, vec3(1.0), ao), k);
    }
  }
  // tilt-shift: blend towards a blurred pyramid level away from the focus band
  if (uTilt > 0.001) {
    float d = abs(vUv.y - uTiltCenter);
    float k = smoothstep(0.10, 0.48, d) * uTilt;
    hdr = mix(hdr, texture(tBlur, vUv).rgb, k);
  }
  // the upsample chain accumulates every pyramid level into level 0; normalise before mixing
  vec3 bloom = texture(tBloom, vUv).rgb * (1.0 / 6.0);
  vec3 col = (hdr + bloom * uBloom) * uExposure;
  col = agx(col);
  // grade: gentle filmic split-tone (warm highlights, cool shadows)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  // a gentle S-curve for depth
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
  col *= mix(vec3(0.985, 0.995, 1.03), uTint, smoothstep(0.0, 0.75, l));
  // vignette
  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y * 0.82;
  float v = smoothstep(0.95, 0.25, length(q));
  col *= mix(1.0, v, uVignette);
  col = linearToSRGB(clamp(col, 0.0, 1.0));
  // film grain + dither (kills banding in the sky gradients)
  float n = h12(gl_FragCoord.xy + fract(uTime) * 311.7) - 0.5;
  col += n * (uGrain + 1.0 / 255.0);
  col *= uFade;
  fragColor = vec4(col, 1.0);
}`;

function fsMaterial(frag, uniforms) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

export class Pipeline {
  constructor(canvas, { samples = 4 } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: false });
    const r = this.renderer;
    r.autoClear = false;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;   // we do the encode ourselves in the final pass
    r.info.autoReset = false;
    r.sortObjects = true;
    this.samples = Math.min(samples, r.capabilities.maxSamples);
    this.levels = 6;
    this.width = 2; this.height = 2; this.pixelRatio = 1;
    this.fsScene = new THREE.Scene();
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fsMesh = new THREE.Mesh(tri, null);
    this.fsMesh.frustumCulled = false;
    this.fsScene.add(this.fsMesh);
    this.downMat = fsMaterial(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.0 } });
    this.upMat = fsMaterial(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } });
    this.upMat.blending = THREE.AdditiveBlending; this.upMat.transparent = true;
    this.finalMat = fsMaterial(FINAL_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tBlur: { value: null },
      uExposure: { value: 1 }, uBloom: { value: 0.1 }, uTime: { value: 0 }, uVignette: { value: 0.30 }, uGrain: { value: 0.012 },
      uTilt: { value: 0 }, uTiltCenter: { value: 0.52 }, uSaturation: { value: 1.10 }, uFade: { value: 1 },
      uTint: { value: new THREE.Vector3(1.02, 1.0, 0.975) }, uRes: { value: new THREE.Vector2(1, 1) },
    });
    Object.assign(this.finalMat.uniforms, {
      tDepth: { value: null }, tAo: { value: null }, uCam: { value: new THREE.Vector4(1, 1000, 1, 1) }, uAoRes: { value: new THREE.Vector2(1, 1) },
      uAoP: { value: new THREE.Vector4(0, 0, 1, 1) }, uAoTint: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
    });
    this.ao = null;        // set by setAo()
    this.targets = null;
  }

  /** cfg: null/false to disable, or { scale: 0.5 | 1, samples, strength } */
  setAo(cfg) {
    if (this.aoMat) { this.aoMat.dispose(); this.aoBlurMat.dispose(); this.aoMat = this.aoBlurMat = null; }
    this.ao = cfg && cfg.samples > 0 ? { scale: 0.5, strength: 1, intensity: 3.0, radius: 0.036, minShare: 0.55, ...cfg } : null;
    if (this.ao) {
      const cam = this.finalMat.uniforms.uCam;
      this.aoMat = fsMaterial(AO_FRAG(this.ao.samples), {
        tDepth: { value: null }, uCam: cam, uDepthRes: { value: new THREE.Vector2(1, 1) }, uRes: { value: new THREE.Vector2(1, 1) },
        uAo: { value: new THREE.Vector4(0.036, 1.2, 48, 44) }, uAoK: { value: new THREE.Vector2(1.0, 0) },
      });
      this.aoBlurMat = fsMaterial(AO_BLUR_FRAG, { tAo: { value: null }, uDir: { value: new THREE.Vector2() } });
    }
    if (this.targets) { const w = this.width, h = this.height; this.dispose(); this.width = this.height = 0; this._alloc(w, h); }
  }

  setSize(w, h, pixelRatio) {
    this.pixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    const W = Math.max(2, Math.floor(w * pixelRatio)), H = Math.max(2, Math.floor(h * pixelRatio));
    if (this.targets && W === this.width && H === this.height) return;
    this.dispose();
    this._alloc(W, H);
  }

  _alloc(W, H) {
    this.width = W; this.height = H;
    const scene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: this.samples, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace });
    let ao = null;
    if (this.ao) {
      // the (multisampled) depth buffer is resolved into this texture together with the colour
      const depth = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
      depth.minFilter = depth.magFilter = THREE.NearestFilter;
      scene.depthTexture = depth;
      const aw = Math.max(2, Math.round(W * this.ao.scale)), ah = Math.max(2, Math.round(H * this.ao.scale));
      const mk = () => new THREE.WebGLRenderTarget(aw, ah, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace });
      ao = [mk(), mk()];
    }
    const mips = [];
    let mw = W, mh = H;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace }));
    }
    this.targets = { scene, mips, ao };
    this.finalMat.uniforms.uRes.value.set(W, H);
  }

  dispose() {
    if (!this.targets) return;
    if (this.targets.scene.depthTexture) this.targets.scene.depthTexture.dispose();
    this.targets.scene.dispose();
    for (const m of this.targets.mips) m.dispose();
    if (this.targets.ao) for (const m of this.targets.ao) m.dispose();
    this.targets = null;
  }

  pass(material, target) {
    this.fsMesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  /** env: {exposure, bloom}; time in seconds */
  render(scene, camera, env, time, opts = {}) {
    const r = this.renderer, t = this.targets;
    r.info.reset();
    r.setRenderTarget(t.scene);
    r.clear(true, true, false);
    r.render(scene, camera);

    // bloom pyramid
    let src = t.scene;
    for (let i = 0; i < t.mips.length; i++) {
      const u = this.downMat.uniforms;
      u.tSrc.value = src.texture; u.uTexel.value.set(1 / src.width, 1 / src.height); u.uFirst.value = i === 0 ? 1 : 0;
      u.uThreshold.value = env.bloomThreshold ?? 1.0;
      this.pass(this.downMat, t.mips[i]);
      src = t.mips[i];
    }
    // keep a copy of level 1 semantics for tilt-shift before the upsample pass adds into it: level 2 is only touched additively, good enough as blur source
    for (let i = t.mips.length - 1; i > 0; i--) {
      const u = this.upMat.uniforms;
      u.tSrc.value = t.mips[i].texture; u.uTexel.value.set(1 / t.mips[i].width, 1 / t.mips[i].height); u.uRadius.value = 1.0;
      this.pass(this.upMat, t.mips[i - 1]);
    }
    const f = this.finalMat.uniforms;
    const aoOn = !!(this.ao && t.ao && (opts.ao ?? 1) > 0);
    if (aoOn) {
      const pm = camera.projectionMatrix.elements;
      f.uCam.value.set(camera.near, camera.far, 1 / pm[0], 1 / pm[5]);
      const a = this.aoMat.uniforms;
      a.tDepth.value = t.scene.depthTexture;
      a.uDepthRes.value.set(t.scene.width, t.scene.height);
      a.uRes.value.set(t.ao[0].width, t.ao[0].height);
      a.uAo.value.w = 0.05 * t.ao[0].height;                                  // never reach further than 5% of the frame
      a.uAo.value.x = this.ao.radius;
      a.uAoK.value.set(this.ao.intensity, 2.5 / (camera.near * 16777216));
      this.pass(this.aoMat, t.ao[0]);
      const b = this.aoBlurMat.uniforms;
      b.tAo.value = t.ao[0].texture; b.uDir.value.set(1 / t.ao[0].width, 0); this.pass(this.aoBlurMat, t.ao[1]);
      b.tAo.value = t.ao[1].texture; b.uDir.value.set(0, 1 / t.ao[0].height); this.pass(this.aoBlurMat, t.ao[0]);
      f.tDepth.value = t.scene.depthTexture; f.tAo.value = t.ao[0].texture;
      f.uAoRes.value.set(t.ao[0].width, t.ao[0].height);
      // how much of a sun-lit surface's light is sky light: that is the share occlusion may take away there
      const u = env.uniforms, lum = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
      const amb = lum(u.uAmbSky.value) * 0.75 + lum(u.uAmbGround.value) * 0.25, sun = lum(u.uSunColor.value) * 0.6 * env.shadowStrength;
      const share = Math.min(1, Math.max(this.ao.minShare, amb / (amb + sun + 1e-6) * 1.35));
      const fogK = u.uFog.value.x * Math.exp(-Math.max(camera.position.y, 0) * u.uFog.value.y) * 0.8;
      f.uAoP.value.set(this.ao.strength * (opts.ao ?? 1), fogK, amb * 0.42, share);
      if (opts.aoDebug) f.uAoTint.value.set(-1, 0, 0); else f.uAoTint.value.set(0.035, 0.05, 0.085);
    } else f.uAoP.value.x = 0;
    f.tScene.value = t.scene.texture;
    f.tBloom.value = t.mips[0].texture;
    f.tBlur.value = t.mips[1].texture;
    f.uExposure.value = env.exposure * (opts.exposureScale ?? 1);
    // the upsample chain accumulates all levels; normalise so uBloom is a sane 0..1 mix
    f.uBloom.value = env.bloom * (opts.bloomScale ?? 1);
    f.uTime.value = time;
    f.uTilt.value = opts.tilt ?? 0;
    f.uFade.value = opts.fade ?? 1;
    this.pass(this.finalMat, null);
  }
}
