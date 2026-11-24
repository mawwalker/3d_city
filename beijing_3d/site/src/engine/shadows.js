// Sun shadow map fitted to what the camera is looking at.
// One orthographic depth map; its footprint follows the camera target and scales with the zoom level,
// so resolution is spent where the viewer looks. At low sun the frustum is squashed to the thin slab
// that the ground + buildings actually occupy in light space (big resolution win at golden hour).

import * as THREE from 'three';

export class SunShadow {
  constructor(renderer, env, size = 4096) {
    this.renderer = renderer; this.env = env; this.size = size;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
    this.camera.matrixAutoUpdate = false;
    this.target = null;
    this.setSize(size);
    this._key = '';
    this._m = new THREE.Matrix4();
    this._bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.maxCasterHeight = 620;
    this.renders = 0;
  }

  setSize(size) {
    this.size = size;
    if (this.target) { this.target.depthTexture.dispose(); this.target.dispose(); }
    const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = THREE.LinearFilter; depth.magFilter = THREE.LinearFilter;
    this.target = new THREE.WebGLRenderTarget(size, size, { depthTexture: depth, depthBuffer: true, stencilBuffer: false, generateMipmaps: false });
    this.env.uniforms.uShadowMap.value = depth;
    // allocate now: a shadow sampler bound to a never-rendered target is a GL error at dusk, when the map is not drawn
    this.renderer.setRenderTarget(this.target); this.renderer.clear(true, true, false); this.renderer.setRenderTarget(null);
    this._key = '';
  }

  /**
   * center: THREE.Vector3 ground point to cover; radius: metres of ground to cover around it.
   * Returns true when the map has to be redrawn.
   */
  fit(center, radius) {
    const u = this.env.uniforms;
    const L = u.uSunDir.value;                       // towards the light
    const strength = this.env.shadowStrength;
    u.uShadowParams.value.y = strength;
    if (strength <= 0.001) return false;
    const el = Math.asin(THREE.MathUtils.clamp(L.y, 0.02, 1));
    // light-space basis
    const right = new THREE.Vector3(L.z, 0, -L.x);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(L, right).normalize();   // points away from the ground on the far side
    const H = this.maxCasterHeight;
    const halfW = radius;
    const yLo = -radius * Math.sin(el) - 30;
    const yHi = radius * Math.sin(el) + H * Math.cos(el) + 30;
    const halfH = (yHi - yLo) / 2;
    const yMid = (yHi + yLo) / 2;
    const tx = (2 * halfW) / this.size, ty = (2 * halfH) / this.size;
    // snap the centre to the texel grid (in light space) so shadows do not crawl when panning
    let cx = center.dot(right), cy = center.dot(up), cz = center.dot(L);
    cx = Math.round(cx / tx) * tx; cy = Math.round(cy / ty) * ty;
    const snapped = new THREE.Vector3().addScaledVector(right, cx).addScaledVector(up, cy + yMid).addScaledVector(L, cz);
    // along the light: receivers spread +-radius, casters sit up to H / sin(el) closer to the sun than their shadow
    const dist = radius * 1.05 + H / Math.max(Math.sin(el), 0.035) + 500;
    const depthRange = 2 * dist;
    const cam = this.camera;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH; cam.near = 1; cam.far = depthRange;
    cam.updateProjectionMatrix();
    const pos = snapped.clone().addScaledVector(L, dist);
    const m = new THREE.Matrix4().makeBasis(right, up, L);
    m.setPosition(pos);
    cam.matrix.copy(m); cam.matrixWorld.copy(m); cam.matrixWorldInverse.copy(m).invert();
    this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    u.uShadowMatrix.value.multiplyMatrices(this._bias, this._m);
    const texel = Math.max(tx, ty);
    u.uShadowParams.value.set(1 / this.size, strength, texel, (texel * 1.6) / depthRange);
    const key = [cx.toFixed(1), cy.toFixed(1), cz.toFixed(0), radius.toFixed(0), L.x.toFixed(4), L.y.toFixed(4), L.z.toFixed(4)].join('|');
    if (key !== this._key) { this._key = key; return true; }
    return false;
  }

  render(scene) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.clear(true, true, false);
    r.render(scene, this.camera);
    r.setRenderTarget(null);
    this.renders++;
  }
}
