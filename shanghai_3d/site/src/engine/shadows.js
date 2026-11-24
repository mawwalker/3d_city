// Cascaded sun shadows. Four orthographic depth maps in one atlas, each a sphere around a focus point (the walker, or the
// ground the camera is looking at when flying) so that turning the head never re-renders anything; the far cascades are
// redrawn only every few frames. Filtering (blocker search + variable-width PCF) happens in the lighting pass.

import * as THREE from 'three';

export const SHADOW_GLSL = /* glsl */`
uniform sampler2D tShadow;
uniform mat4 uShadowMat[4];      // view space -> atlas uv (xy) and depth (z)
uniform vec4 uShadowInfo[4];     // x: world width of the cascade, y: depth range (m), z: world size of a texel, w: 1 when valid
uniform vec4 uShadowParams;      // x: strength, y: +1 reversed depth / -1 standard, z: 1 / atlas size, w: tan of the light's angular radius
const vec2 POISSON[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));
// P, N in view space. Returns sun visibility 0..1.
float sunShadow(vec3 P, vec3 N, float NoL, float noise) {
  if (uShadowParams.x <= 0.0) return 1.0;
  int ci = -1; vec3 s = vec3(0.0); vec4 info = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    info = uShadowInfo[i];
    if (info.w < 0.5) continue;
    // normal offset in proportion to the cascade's texel size keeps acne away on grazing faces
    vec3 Po = P + N * info.z * (1.2 + 2.2 * (1.0 - NoL));
    vec3 q = (uShadowMat[i] * vec4(Po, 1.0)).xyz;
    vec2 cell = vec2(float(i & 1), float(i >> 1)) * 0.5;
    vec2 l = (q.xy - cell) * 2.0;
    // leave a rim for the filter kernel; dither the hand-over between cascades
    float rim = 0.035 + 0.05 * noise;
    if (l.x > rim && l.x < 1.0 - rim && l.y > rim && l.y < 1.0 - rim && q.z > 0.0 && q.z < 1.0) { ci = i; s = q; break; }
  }
  if (ci < 0) return 1.0;
  float dir = uShadowParams.y;
  float range = info.y;                         // metres of light-space depth
  float uvPerM = 0.5 / info.x;                  // atlas uv per metre
  float bias = (0.6 * info.z + 0.02) / range;
  float a = noise * 6.2831853;
  mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 cellMin = vec2(float(ci & 1), float(ci >> 1)) * 0.5 + uShadowParams.z;
  vec2 cellMax = cellMin + 0.5 - 2.0 * uShadowParams.z;
  // blocker search
  float searchM = clamp(0.0012 * info.x + 0.5, info.z * 1.5, 6.0);
  float sum = 0.0, cnt = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 uv = clamp(s.xy + rot * POISSON[i * 2] * searchM * uvPerM, cellMin, cellMax);
    float d = textureLod(tShadow, uv, 0.0).r;
    float diff = (d - s.z) * dir;               // > 0: the stored surface is nearer the light
    if (diff > bias) { sum += diff; cnt += 1.0; }
  }
  if (cnt < 0.5) return 1.0;
  float gap = sum / cnt * range;                // metres between blocker and receiver
  float pen = clamp(gap * uShadowParams.w * 2.0, info.z * 1.1, max(searchM, info.z * 1.1));
  float lit = 0.0;
  for (int i = 0; i < 16; i++) {
    vec2 uv = clamp(s.xy + rot * POISSON[i] * pen * uvPerM, cellMin, cellMax);
    float d = textureLod(tShadow, uv, 0.0).r;
    lit += ((d - s.z) * dir > bias) ? 0.0 : 1.0;
  }
  lit /= 16.0;
  return mix(1.0, lit, uShadowParams.x);
}
// Moving casters (traffic, people) have a small map of their own, redrawn every frame; the cascades above stay cached.
uniform sampler2D tShadowDyn;
uniform mat4 uShadowDynMat;      // view space -> uv and depth
uniform vec4 uShadowDynInfo;     // x: world width, y: depth range (m), z: world size of a texel, w: 1 when in use
float dynShadow(vec3 P, vec3 N, float NoL, float noise) {
  if (uShadowDynInfo.w < 0.5 || uShadowParams.x <= 0.0) return 1.0;
  vec3 Po = P + N * uShadowDynInfo.z * (1.5 + 2.5 * (1.0 - NoL));
  vec3 q = (uShadowDynMat * vec4(Po, 1.0)).xyz;
  if (q.x < 0.01 || q.x > 0.99 || q.y < 0.01 || q.y > 0.99 || q.z <= 0.0 || q.z >= 1.0) return 1.0;
  float bias = (0.8 * uShadowDynInfo.z + 0.03) / uShadowDynInfo.y;
  float a = noise * 6.2831853;
  mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
  float pen = max(0.07, uShadowDynInfo.z * 1.3) / uShadowDynInfo.x;      // a narrow penumbra: these stand on what they shade
  float lit = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = textureLod(tShadowDyn, q.xy + rot * POISSON[i * 2] * pen, 0.0).r;
    lit += ((d - q.z) * uShadowParams.y > bias) ? 0.0 : 1.0;
  }
  // fade out towards the rim of the map
  float rim = smoothstep(0.5, 0.42, max(abs(q.x - 0.5), abs(q.y - 0.5)));
  return mix(1.0, lit / 8.0, uShadowParams.x * rim);
}
`;

const _v = new THREE.Vector3(), _m = new THREE.Matrix4();

export class CascadedShadows {
  /** size: resolution of one cascade; the atlas is 2 x 2 of them. */
  constructor(renderer, size = 2048) {
    this.renderer = renderer;
    this.reversed = renderer.capabilities.reversedDepthBuffer === true;
    this.count = 4;
    this.maxCasterHeight = 640;
    this.cascades = [];
    for (let i = 0; i < 4; i++) {
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
      cam.matrixAutoUpdate = false;
      cam._reversedDepth = this.reversed;
      this.cascades.push({ cam, worldMat: new THREE.Matrix4(), key: '', valid: false, lastFrame: -1e9, radius: 1, range: 1, texel: 1, dirty: true });
    }
    this.uniforms = {
      tShadow: { value: null },
      uShadowMat: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] },
      uShadowInfo: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uShadowParams: { value: new THREE.Vector4(1, this.reversed ? 1 : -1, 1 / (size * 2), 0.0047) },
    };
    this.renders = 0;
    // moving casters (their own scene) are drawn into their own map every frame while `dynamic` is set
    this.dynamic = false;
    const dcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
    dcam.matrixAutoUpdate = false; dcam._reversedDepth = this.reversed;
    const dsize = 2048, ddepth = new THREE.DepthTexture(dsize, dsize, THREE.UnsignedIntType);
    ddepth.minFilter = ddepth.magFilter = THREE.NearestFilter;
    this.dyn = { cam: dcam, size: dsize, worldMat: new THREE.Matrix4(), radius: 1, range: 1, texel: 1, on: false,
      target: new THREE.WebGLRenderTarget(dsize, dsize, { depthTexture: ddepth, depthBuffer: true, stencilBuffer: false, generateMipmaps: false, format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }) };
    this.uniforms.tShadowDyn = { value: ddepth }; this.uniforms.uShadowDynMat = { value: new THREE.Matrix4() }; this.uniforms.uShadowDynInfo = { value: new THREE.Vector4() };
    this.setSize(size);
  }

  setSize(size) {
    this.size = size;
    if (this.target) { this.target.depthTexture.dispose(); this.target.dispose(); }
    const depth = new THREE.DepthTexture(size * 2, size * 2, THREE.UnsignedIntType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(size * 2, size * 2, { depthTexture: depth, depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.uniforms.tShadow.value = depth;
    this.uniforms.uShadowParams.value.z = 1 / (size * 2);
    const r = this.renderer;
    r.setRenderTarget(this.target); r.clear(true, true, false); r.setRenderTarget(null);
    for (const c of this.cascades) { c.key = ''; c.valid = false; }
  }

  invalidate() { for (const c of this.cascades) c.dirty = true; }

  /**
   * focus: world point the cascades are centred on; scale: multiplies the base radii (1 at street level).
   * Decides which cascades need redrawing this frame and draws them.
   */
  render(shadowScene, focus, scale, lightDir, strength, frame, movingScene = null) {
    const u = this.uniforms;
    u.uShadowParams.value.x = strength;
    if (strength <= 0.001) return;
    const L = lightDir;
    const right = new THREE.Vector3(L.z, 0, -L.x);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(L, right).normalize();
    const sinEl = Math.max(L.y, 0.03);
    const base = [24, 85, 300, 1250];
    const period = [1, 1, 3, 6];
    const r = this.renderer;
    let drew = false;
    for (let i = 0; i < this.count; i++) {
      const c = this.cascades[i];
      const R = base[i] * scale * (i >= 2 ? 1.12 : 1.0);
      const texel = (2 * R) / this.size;
      // snap the centre to the texel grid in light space so the shadow edges do not crawl
      let cx = focus.dot(right), cy = focus.dot(up);
      const cz = focus.dot(L);
      cx = Math.round(cx / texel) * texel; cy = Math.round(cy / texel) * texel;
      const key = `${cx.toFixed(3)}|${cy.toFixed(3)}|${Math.round(cz / (R * 0.25))}|${R.toFixed(2)}|${L.x.toFixed(4)}|${L.y.toFixed(4)}|${L.z.toFixed(4)}`;
      const due = frame - c.lastFrame >= period[i] + (i >= 2 ? (i - 2) : 0);
      if (!(c.dirty || !c.valid || (key !== c.key && due))) continue;
      // casters can sit this far towards the light and still shade the sphere
      const toward = Math.min(R + this.maxCasterHeight / sinEl + 40, R + 9000);
      const away = R + 20;
      const center = _v.set(0, 0, 0).addScaledVector(right, cx).addScaledVector(up, cy).addScaledVector(L, cz);
      const cam = c.cam;
      cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.5; cam.far = toward + away;
      cam.updateProjectionMatrix();
      const pos = center.clone().addScaledVector(L, toward);
      const m = new THREE.Matrix4().makeBasis(right, up, L); m.setPosition(pos);
      cam.matrix.copy(m); cam.matrixWorld.copy(m); cam.matrixWorldInverse.copy(m).invert();
      // world -> atlas
      const ox = (i & 1) * 0.5, oy = (i >> 1) * 0.5;
      const bias = this.reversed
        ? new THREE.Matrix4().set(0.25, 0, 0, 0.25 + ox, 0, 0.25, 0, 0.25 + oy, 0, 0, 1, 0, 0, 0, 0, 1)
        : new THREE.Matrix4().set(0.25, 0, 0, 0.25 + ox, 0, 0.25, 0, 0.25 + oy, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      c.worldMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).premultiply(bias);
      c.radius = R; c.range = cam.far - cam.near; c.texel = texel; c.key = key; c.valid = true; c.dirty = false; c.lastFrame = frame;
      const S = this.size;
      this.target.viewport.set((i & 1) * S, (i >> 1) * S, S, S);
      this.target.scissor.set((i & 1) * S, (i >> 1) * S, S, S);
      this.target.scissorTest = true;
      r.setRenderTarget(this.target);
      r.clear(false, true, false);
      r.render(shadowScene, cam);
      this.renders++; drew = true;
    }
    if (drew) { this.target.scissorTest = false; r.setRenderTarget(null); }
    // the moving casters' own map, around the focus
    const d = this.dyn;
    d.on = this.dynamic && !!movingScene;
    if (d.on) {
      const R = Math.min(110 * scale, 300), texel = (2 * R) / d.size;
      const cx = Math.round(focus.dot(right) / texel) * texel, cy = Math.round(focus.dot(up) / texel) * texel, cz = focus.dot(L);
      const toward = R + Math.min(90 / sinEl, 900) + 20, away = R + 20;
      const cam = d.cam;
      cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.5; cam.far = toward + away;
      cam.updateProjectionMatrix();
      const pos = _v.set(0, 0, 0).addScaledVector(right, cx).addScaledVector(up, cy).addScaledVector(L, cz + toward);
      const m = _m.makeBasis(right, up, L); m.setPosition(pos);
      cam.matrix.copy(m); cam.matrixWorld.copy(m); cam.matrixWorldInverse.copy(m).invert();
      const bias = this.reversed ? new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 1) : new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      d.worldMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).premultiply(bias);
      d.radius = R; d.range = cam.far - cam.near; d.texel = texel;
      r.setRenderTarget(d.target);
      r.clear(false, true, false);
      r.render(movingScene, cam);
      r.setRenderTarget(null);
    }
  }

  /** Refresh the view-space lookup matrices for the current camera (call every frame after render()). */
  updateUniforms(camera) {
    const u = this.uniforms;
    for (let i = 0; i < this.count; i++) {
      const c = this.cascades[i];
      u.uShadowMat.value[i].multiplyMatrices(c.worldMat, camera.matrixWorld);
      u.uShadowInfo.value[i].set(c.radius * 2, c.range, c.texel, c.valid ? 1 : 0);
    }
    const d = this.dyn;
    u.uShadowDynMat.value.multiplyMatrices(d.worldMat, camera.matrixWorld);
    u.uShadowDynInfo.value.set(d.radius * 2, d.range, d.texel, d.on ? 1 : 0);
  }
}

/**
 * Top-down height field of the solid city (buildings, bridges) around the focus point. The ambient pass marches it to
 * find how much sky each surface can see, which is what makes a lane darker than a square.
 * Objects take part when they are on layer 1 of the shadow scene.
 */
export class HeightField {
  constructor(renderer, size = 1024) {
    this.renderer = renderer; this.size = size;
    this.reversed = renderer.capabilities.reversedDepthBuffer === true;
    const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;      // depth formats are not filterable without a compare mode
    this.target = new THREE.WebGLRenderTarget(size, size, { depthTexture: depth, depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.texture = depth;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 1000);
    this.camera.matrixAutoUpdate = false;
    this.camera._reversedDepth = this.reversed;
    this.camera.layers.set(1);
    this.rect = new THREE.Vector4(0, 0, 1, 0);
    this.conv = new THREE.Vector2(0, 1);
    this.valid = false; this.dirty = true; this.lastFrame = -1e9;
    this.cx = 1e12; this.cz = 1e12; this.extent = 0;
    renderer.setRenderTarget(this.target); renderer.clear(true, true, false); renderer.setRenderTarget(null);
  }

  update(scene, focus, extent, frame) {
    const moved = Math.max(Math.abs(focus.x - this.cx), Math.abs(focus.z - this.cz));
    const need = !this.valid || Math.abs(extent - this.extent) > this.extent * 0.25 || moved > this.extent * 0.14 || (this.dirty && frame - this.lastFrame > 20);
    if (!need) return;
    const texel = extent / this.size;
    const cx = Math.round(focus.x / texel) * texel, cz = Math.round(focus.z / texel) * texel;
    const top = 700, range = 760, half = extent / 2;
    const cam = this.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 0.5; cam.far = range + 0.5;
    cam.updateProjectionMatrix();
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
    m.setPosition(cx, top, cz);
    cam.matrix.copy(m); cam.matrixWorld.copy(m); cam.matrixWorldInverse.copy(m).invert();
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.clear(false, true, false);
    r.render(scene, cam);
    r.setRenderTarget(null);
    this.rect.set(cx - half, cz + half, 1 / extent, 1);
    if (this.reversed) this.conv.set(top - cam.far, cam.far - cam.near); else this.conv.set(top - cam.near, -(cam.far - cam.near));
    this.cx = cx; this.cz = cz; this.extent = extent; this.valid = true; this.dirty = false; this.lastFrame = frame;
  }
}
