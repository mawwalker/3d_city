// PBR material library: two 2D-array textures (base colour, normal + roughness) built from the strips written by
// pipeline/50_textures.py, plus the GLSL to sample them.

import * as THREE from 'three';

const ASSET_URL = new URL('../../assets/', import.meta.url).href;

async function loadStrip(name, size, layers) {
  const res = await fetch(ASSET_URL + name);
  if (!res.ok) throw new Error(`fetch ${name}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size * layers) : Object.assign(document.createElement('canvas'), { width: size, height: size * layers });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  return new Uint8Array(ctx.getImageData(0, 0, size, size * layers).data.buffer);
}

/** Shop-sign lettering: a 2D-array of text masks (see pipeline/52_signs.py). */
async function loadSigns() {
  const meta = await (await fetch(ASSET_URL + 'signs.json')).json();
  const res = await fetch(ASSET_URL + 'signs.png');
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(meta.w, meta.h * meta.layers) : Object.assign(document.createElement('canvas'), { width: meta.w, height: meta.h * meta.layers });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const rgba = ctx.getImageData(0, 0, meta.w, meta.h * meta.layers).data;
  const r = new Uint8Array(meta.w * meta.h * meta.layers);
  for (let i = 0; i < r.length; i++) r[i] = rgba[i * 4];
  const t = new THREE.DataArrayTexture(r, meta.w, meta.h, meta.layers);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.unpackAlignment = 1;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return { texture: t, layers: meta.layers };
}

export async function loadMaterialLibrary(renderer) {
  const meta = await (await fetch(ASSET_URL + 'materials.json')).json();
  const { size, layers } = meta;
  const [alb, nr] = await Promise.all([loadStrip('mat_albedo.webp', size, layers), loadStrip('mat_nr.webp', size, layers)]);
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, size, size, layers);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  };
  const lib = { meta, albedo: mk(alb, true), nr: mk(nr, false), uniforms: null, glsl: '' };
  lib.uniforms = { tMatAlbedo: { value: lib.albedo }, tMatNR: { value: lib.nr } };
  const signs = await loadSigns().catch((e) => { console.warn('signs failed', e); return null; });
  lib.signUniforms = { tSigns: { value: signs ? signs.texture : null }, uSigns: { value: new THREE.Vector2(signs ? signs.layers : 0, 0) } };
  // L_<NAME>: layer index, S_<NAME>: repeats per metre
  let defs = '';
  for (const [name, m] of Object.entries(meta.materials)) {
    const N = name.toUpperCase();
    defs += `#define L_${N} ${m.layer}.0\n#define S_${N} ${(1 / m.metres).toFixed(6)}\n#define C_${N} vec3(${m.mean.map((v) => v.toFixed(4)).join(', ')})\n`;
  }
  lib.glsl = /* glsl */`
uniform sampler2DArray tMatAlbedo, tMatNR;
${defs}
struct MatS { vec3 albedo; vec3 n; float rough; };     // n is in tangent space: x along +u, y along +v
MatS matSample(float layer, vec2 uv) {
  vec3 c = vec3(uv.x, -uv.y, layer);
  vec3 a = texture(tMatAlbedo, c).rgb;
  vec3 r = texture(tMatNR, c).rgb;
  vec2 xy = r.rg * 2.0 - 1.0;
  return MatS(a, vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))), r.b);
}
MatS matMix(MatS a, MatS b, float t) { return MatS(mix(a.albedo, b.albedo, t), mix(a.n, b.n, t), mix(a.rough, b.rough, t)); }
// texture detail around a chosen colour: the set's own mean colour is divided out
MatS matTint(float layer, vec2 uv, vec3 mean, vec3 tint) { MatS m = matSample(layer, uv); m.albedo = clamp(m.albedo / max(mean, vec3(0.02)), 0.0, 2.5) * tint; return m; }
`;
  return lib;
}
