// Frame orchestration:
//   shadows + height field  ->  G-buffer (opaque, then decals)  ->  GTAO  ->  deferred lighting (+ sky, aerial perspective)
//   ->  local lights  ->  forward (transparent) pass  ->  TAA  ->  bloom / exposure  ->  tone map and grade to the canvas.

import * as THREE from 'three';
import { FS_VERT } from './glsl.js';
import { Atmosphere } from './atmosphere.js';
import { CascadedShadows, HeightField } from './shadows.js';
import { LightingPass, setProjUniforms } from './lighting.js';
import { GTAO_FRAG, AO_BLUR_FRAG, AO_UPSAMPLE_FRAG, TAA_FRAG, DOWN_FRAG, UP_FRAG, LUMA_FRAG, ADAPT_FRAG, FINAL_FRAG } from './post.js';

function fsMaterial(frag, uniforms, extra = {}) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
}
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export class Pipeline {
  constructor(canvas, quality) {
    this.q = quality;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: false, reversedDepthBuffer: true });
    r.autoClear = false;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;      // the final pass encodes
    r.info.autoReset = false;
    r.sortObjects = true;
    this.reversed = r.capabilities.reversedDepthBuffer === true;
    this.atmosphere = new Atmosphere(r);
    this.shadows = new CascadedShadows(r, quality.shadow);
    this.lighting = new LightingPass(this.atmosphere, this.shadows);
    this.frame = 0;
    this.width = this.height = 0; this.pixelRatio = 1;
    this.levels = 6;
    this.debugView = 0;
    this.taaOn = quality.taa !== false;
    this.aoOn = quality.ao !== false;
    this.fsScene = new THREE.Scene();
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fsMesh = new THREE.Mesh(tri, null); this.fsMesh.frustumCulled = false;
    this.fsScene.add(this.fsMesh);

    // uniforms shared by every pass that reconstructs position from depth
    const L = this.lighting.uniforms;
    this.gb = { tAlbedo: L.tAlbedo, tNormal: L.tNormal, tMaterial: L.tMaterial, tEmissive: L.tEmissive, tDepth: L.tDepth, uProj: L.uProj, uProjOff: L.uProjOff };
    const ao = quality.aoQuality || [3, 5];
    this.aoMat = fsMaterial(GTAO_FRAG(ao[0], ao[1]), { ...this.gb, uViewRot: { value: new THREE.Matrix3() }, uAoParams: { value: new THREE.Vector4(1.6, 0.028, 0, 1.25) }, uRes: { value: new THREE.Vector2() } });
    this.aoBlurMat = fsMaterial(AO_BLUR_FRAG, { tAo: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.aoUpMat = fsMaterial(AO_UPSAMPLE_FRAG, { ...this.gb, tAo: { value: null }, uAoRes: { value: new THREE.Vector2() }, tHeight: { value: null }, uCamRot: L.uCamRot, uCamPos: L.uCamPos,
      uHeightRect: { value: new THREE.Vector4(0, 0, 1, 0) }, uHeightConv: { value: new THREE.Vector2(0, 1) }, uFrameN: { value: 0 } });
    this.taaMat = fsMaterial(TAA_FRAG, { ...this.gb, tCurrent: { value: null }, tHistory: { value: null }, uReproject: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2() },
      uTaa: { value: new THREE.Vector4(0.9, 0, 0, 0) } });
    this.downMat = fsMaterial(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.0 } });
    this.upMat = fsMaterial(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.lumaMat = fsMaterial(LUMA_FRAG, { tSrc: { value: null } });
    this.adaptMat = fsMaterial(ADAPT_FRAG, { tLuma: { value: null }, tPrev: { value: null }, uAdapt: { value: new THREE.Vector4(0.016, 1, 2.2, 1.1) } });
    this.finalMat = fsMaterial(FINAL_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tExposure: { value: null },
      uGrade: { value: new THREE.Vector4(1, 0.06, 0.22, 0.010) }, uGrade2: { value: new THREE.Vector4(1.04, quality.sharpen ?? 0.55, 1, 0) },
      uExpo: { value: new THREE.Vector4(0.16, 0.02, 60, 1) }, uTint: { value: new THREE.Vector3(1.015, 1.0, 0.985) }, uRes: { value: new THREE.Vector2(1, 1) },
    });
    // exposure metering targets (fixed size)
    const hf = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, colorSpace: THREE.LinearSRGBColorSpace };
    this.lumaRT = new THREE.WebGLRenderTarget(64, 64, { ...hf, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    this.adaptRT = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { ...hf, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }));
    this.adaptIdx = 0; this.adaptReset = true;
    this.prevViewProj = new THREE.Matrix4(); this.hasPrev = false;
    this.historyIdx = 0; this.historyValid = false;
    this.exposure = { key: 0.16, min: 0.03, max: 40, manual: 1, bloom: 0.06, bloomThreshold: 1.2 };
    this.jitter = new THREE.Vector2();
    this.heightField = new HeightField(r, quality.heightField || 1024);
    this.onLights = null;            // optional callback(renderer, hdrTarget, camera): additive local lights
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
    const near = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace };
    const lin = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, colorSpace: THREE.LinearSRGBColorSpace };
    const depth = new THREE.DepthTexture(W, H, THREE.FloatType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    const g = new THREE.WebGLRenderTarget(W, H, { count: 4, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false, depthTexture: depth, ...near });
    const em = g.textures[3];
    em.format = THREE.RGBFormat; em.type = THREE.UnsignedInt101111Type;
    const hdrOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, stencilBuffer: false };
    const hdr = new THREE.WebGLRenderTarget(W, H, { ...hdrOpts, depthBuffer: false, ...lin });
    const history = [0, 1].map(() => new THREE.WebGLRenderTarget(W, H, { ...hdrOpts, depthBuffer: false, ...lin }));
    const aw = Math.max(2, Math.round(W * 0.5)), ah = Math.max(2, Math.round(H * 0.5));
    const aoHalf = [0, 1].map(() => new THREE.WebGLRenderTarget(aw, ah, { ...hdrOpts, depthBuffer: false, ...near }));
    const aoFull = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, ...near });
    const mips = [];
    let mw = W, mh = H;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      mips.push(new THREE.WebGLRenderTarget(mw, mh, { ...hdrOpts, depthBuffer: false, ...lin }));
    }
    this.targets = { g, depth, hdr, history, aoHalf, aoFull, mips };
    const L = this.lighting.uniforms;
    L.tAlbedo.value = g.textures[0]; L.tNormal.value = g.textures[1]; L.tMaterial.value = g.textures[2]; L.tEmissive.value = g.textures[3]; L.tDepth.value = depth;
    L.uRes.value.set(W, H);
    this.finalMat.uniforms.uRes.value.set(W, H);
    this.taaMat.uniforms.uRes.value.set(W, H);
    this.historyValid = false;
  }

  dispose() {
    const t = this.targets;
    if (!t) return;
    t.depth.dispose(); t.g.dispose(); t.hdr.dispose();
    for (const x of [...t.history, ...t.aoHalf, t.aoFull, ...t.mips]) x.dispose();
    this.targets = null;
  }

  pass(material, target) {
    this.fsMesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  /** Apply this frame's sub-pixel jitter to the camera (call before culling / rendering). */
  beginFrame(camera) {
    this.frame++;
    camera._reversedDepth = this.reversed;
    if (this.taaOn) {
      const i = (this.frame % 16) + 1;
      this.jitter.set(halton(i, 2) - 0.5, halton(i, 3) - 0.5);
      camera.setViewOffset(this.width, this.height, this.jitter.x, this.jitter.y, this.width, this.height);
    } else {
      this.jitter.set(0, 0);
      if (camera.view) camera.clearViewOffset(); else camera.updateProjectionMatrix();
    }
  }

  /**
   * scenes: { opaque, decals?, shadow?, forward? }   env: Environment   view: { focus: Vector3, shadowScale: number }
   */
  render(scenes, camera, env, time, dt, view = {}) {
    const r = this.renderer, t = this.targets, L = this.lighting.uniforms;
    r.info.reset();
    camera.updateMatrixWorld();
    const camY = camera.position.y;

    // ---- environment-dependent look-up tables
    this.atmosphere.update(camY, dt);

    // ---- shadows
    if (scenes.shadow) {
      this.shadows.render(scenes.shadow, view.focus || camera.position, view.shadowScale || 1, env.lightDir, env.shadowStrength, this.frame, scenes.moving);
      this.shadows.updateUniforms(camera);
      this.heightField.update(scenes.shadow, view.focus || camera.position, view.heightExtent || 640, this.frame);
    }

    // ---- G-buffer
    r.setRenderTarget(t.g);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scenes.opaque, camera);
    if (scenes.decals) r.render(scenes.decals, camera);

    // ---- shared reconstruction uniforms
    setProjUniforms(camera, this.reversed, L.uProj.value, L.uProjOff.value);
    L.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    L.uCamPos.value.copy(camera.position);
    L.uLightDir.value.copy(env.lightDir);
    L.uLightColor.value.copy(env.lightColor);
    L.uFrame.value.set(this.taaOn ? this.frame : 0, this.debugView, this.aoOn ? 1 : 0, 0);
    L.uWet.value.set(env.weather.wet, Math.min(1, env.weather.wet * 1.2), env.lights, 1);

    // ---- ambient occlusion
    if (this.aoOn) {
      const a = this.aoMat.uniforms;
      a.uViewRot.value.setFromMatrix4(camera.matrixWorldInverse);
      a.uRes.value.set(t.aoHalf[0].width, t.aoHalf[0].height);
      a.uAoParams.value.z = this.taaOn ? this.frame : 0;
      this.pass(this.aoMat, t.aoHalf[0]);
      const b = this.aoBlurMat.uniforms;
      b.tAo.value = t.aoHalf[0].texture; b.uDir.value.set(1 / t.aoHalf[0].width, 0); this.pass(this.aoBlurMat, t.aoHalf[1]);
      b.tAo.value = t.aoHalf[1].texture; b.uDir.value.set(0, 1 / t.aoHalf[0].height); this.pass(this.aoBlurMat, t.aoHalf[0]);
      const u = this.aoUpMat.uniforms;
      u.tAo.value = t.aoHalf[0].texture; u.uAoRes.value.set(t.aoHalf[0].width, t.aoHalf[0].height);
      u.uFrameN.value = this.taaOn ? this.frame : 0;
      if (this.heightField && this.heightField.valid) { u.tHeight.value = this.heightField.texture; u.uHeightRect.value.copy(this.heightField.rect); u.uHeightConv.value.copy(this.heightField.conv); }
      else u.uHeightRect.value.w = 0;
      this.pass(this.aoUpMat, t.aoFull);
      L.tAO.value = t.aoFull.texture;
    }

    // ---- lighting
    L.tPrev.value = t.history[1 - this.historyIdx].texture; L.uPrevValid.value = this.taaOn && this.historyValid ? 1 : 0;
    this.pass(this.lighting.material, t.hdr);
    if (this.onLights) this.onLights(r, t.hdr, camera);
    if (scenes.forward) { r.setRenderTarget(t.hdr); r.render(scenes.forward, camera); }

    // ---- temporal anti-aliasing
    let resolved = t.hdr;
    const viewProj = new THREE.Matrix4();
    // un-jittered view-projection of this frame, for next frame's reprojection
    const pj = camera.projectionMatrix.clone();
    if (this.taaOn) {
      // remove the jitter: projection is P[2][0] / P[2][1] offset by 2 * jitter / size
      pj.elements[8] -= 2 * this.jitter.x / this.width;
      pj.elements[9] += 2 * this.jitter.y / this.height;
    }
    viewProj.multiplyMatrices(pj, camera.matrixWorldInverse);
    if (this.taaOn) {
      const u = this.taaMat.uniforms;
      const cur = this.historyIdx, prev = 1 - cur;
      u.tCurrent.value = t.hdr.texture; u.tHistory.value = t.history[prev].texture;
      u.uReproject.value.multiplyMatrices(this.prevViewProj, camera.matrixWorld);
      u.uTaa.value.set(view.cut ? 0 : 0.92, this.historyValid && this.hasPrev && !view.cut ? 1 : 0, -this.jitter.x / this.width, this.jitter.y / this.height);
      this.pass(this.taaMat, t.history[cur]);
      resolved = t.history[cur];
      this.historyIdx = prev; this.historyValid = true;
    }
    this.prevViewProj.copy(viewProj); this.hasPrev = true;

    // ---- bloom pyramid
    let src = resolved;
    for (let i = 0; i < t.mips.length; i++) {
      const u = this.downMat.uniforms;
      u.tSrc.value = src.texture; u.uTexel.value.set(1 / src.width, 1 / src.height); u.uFirst.value = i === 0 ? 1 : 0;
      u.uThreshold.value = this.exposure.bloomThreshold;
      this.pass(this.downMat, t.mips[i]);
      src = t.mips[i];
    }
    for (let i = t.mips.length - 1; i > 0; i--) {
      const u = this.upMat.uniforms;
      u.tSrc.value = t.mips[i].texture; u.uTexel.value.set(1 / t.mips[i].width, 1 / t.mips[i].height);
      this.pass(this.upMat, t.mips[i - 1]);
    }

    // ---- exposure metering
    this.lumaMat.uniforms.tSrc.value = resolved.texture;
    this.pass(this.lumaMat, this.lumaRT);
    const ad = this.adaptMat.uniforms;
    const ai = this.adaptIdx;
    ad.tLuma.value = this.lumaRT.texture; ad.tPrev.value = this.adaptRT[1 - ai].texture;
    ad.uAdapt.value.set(dt, this.adaptReset || view.cut ? 1 : 0, 2.4, 1.2);
    this.pass(this.adaptMat, this.adaptRT[ai]);
    this.adaptIdx = 1 - ai; this.adaptReset = false;

    // ---- final
    const f = this.finalMat.uniforms;
    f.tScene.value = resolved.texture; f.tBloom.value = t.mips[0].texture; f.tExposure.value = this.adaptRT[ai].texture;
    f.uGrade.value.x = this.exposure.manual; f.uGrade.value.y = this.exposure.bloom;
    f.uExpo.value.set(this.exposure.key, this.exposure.min, this.exposure.max, this.debugView ? 0 : 1);
    if (this.debugView) f.uGrade.value.x = 1;
    f.uGrade2.value.w = time;
    this.pass(this.finalMat, null);
  }
}
