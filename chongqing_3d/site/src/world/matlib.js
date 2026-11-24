// PBR Material Library, Chongqing Sign Atlases (horizontal + vertical neon blade signs),
// and Photorealistic Room Interior Parallax Atlas (tInteriors / tInteriorsArr / uInteriors).
// Safely extracts slices via DOM 2D canvas sequentially so 1024px 38-layer grids stay light on GPU memory.

import * as THREE from 'three';

const ASSET_URL = new URL('../../assets/', import.meta.url).href;

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }
  return new OffscreenCanvas(w, h);
}

/** Load a stacked vertical strip OR tiled grid image into a tightly packed Uint8Array [layers * h * w * (1|4)]. */
async function loadLayerImage(name, w, h, layers, cols = 1, redOnly = false) {
  const res = await fetch(ASSET_URL + name);
  if (!res.ok) throw new Error(`fetch ${name}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const inferredCols = cols > 1 ? cols : Math.max(1, Math.round(bmp.width / w));
  const out = new Uint8Array(w * h * layers * (redOnly ? 1 : 4));
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const layerBytes = w * h * (redOnly ? 1 : 4);
  for (let i = 0; i < layers; i++) {
    const cx = (i % inferredCols) * w;
    const cy = Math.floor(i / inferredCols) * h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bmp, cx, cy, w, h, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    if (redOnly) {
      const dstOff = i * layerBytes;
      for (let p = 0; p < w * h; p++) out[dstOff + p] = rgba[p * 4];
    } else {
      out.set(rgba, i * layerBytes);
    }
  }
  bmp.close && bmp.close();
  return out;
}

async function loadSignAtlas(jsonName, imgName) {
  const meta = await (await fetch(ASSET_URL + jsonName)).json();
  const r = await loadLayerImage(imgName, meta.w, meta.h, meta.layers, meta.cols || 1, true);
  const t = new THREE.DataArrayTexture(r, meta.w, meta.h, meta.layers);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.unpackAlignment = 1;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return { texture: t, layers: meta.layers, w: meta.w, h: meta.h };
}

/**
 * Load photorealistic interior room atlas (site/assets/interiors.webp + interiors.json).
 * Exposes BOTH a mipmapped 2D Texture (tInteriors, 2048x2048 4x4 grid) AND a zero-bleed DataArrayTexture
 * (tInteriorsArr, cellSize x cellSize x count) so shaders can use whichever fits best!
 */
async function loadInteriorsAtlas(renderer) {
  const metaRes = await fetch(ASSET_URL + 'interiors.json');
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  const imgFile = meta.file || meta.image || 'interiors.webp';
  const res = await fetch(ASSET_URL + imgFile);
  if (!res.ok) return null;
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cols = meta.cols || 4;
  const rows = meta.rows || 4;
  const count = meta.count || meta.layers || (cols * rows);
  const cellW = meta.cellW || meta.cell || Math.floor(bmp.width / cols);
  const cellH = meta.cellH || meta.cell || Math.floor(bmp.height / rows);

  // Slice into zero-bleed DataArrayTexture (flipY=false: row 0 = top of cell)
  const arrData = new Uint8Array(cellW * cellH * count * 4);
  const cv = makeCanvas(cellW, cellH);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const sliceBytes = cellW * cellH * 4;
  for (let i = 0; i < count; i++) {
    const cx = (i % cols) * cellW;
    const cy = Math.floor(i / cols) * cellH;
    ctx.clearRect(0, 0, cellW, cellH);
    ctx.drawImage(bmp, cx, cy, cellW, cellH, 0, 0, cellW, cellH);
    arrData.set(ctx.getImageData(0, 0, cellW, cellH).data, i * sliceBytes);
  }

  // Copy 2D atlas to compact 1024x1024 canvas and close ImageBitmap immediately to prevent GPU driver resets
  const cv2 = makeCanvas(Math.min(1024, bmp.width), Math.min(1024, bmp.height));
  cv2.getContext('2d').drawImage(bmp, 0, 0, cv2.width, cv2.height);
  bmp.close && bmp.close();

  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex2d = new THREE.CanvasTexture(cv2);
  tex2d.flipY = false;
  tex2d.colorSpace = THREE.SRGBColorSpace;
  tex2d.wrapS = tex2d.wrapT = THREE.ClampToEdgeWrapping;
  tex2d.minFilter = THREE.LinearMipmapLinearFilter;
  tex2d.magFilter = THREE.LinearFilter;
  tex2d.generateMipmaps = true;
  tex2d.anisotropy = maxAniso;
  tex2d.needsUpdate = true;

  const texArr = new THREE.DataArrayTexture(arrData, cellW, cellH, count);
  texArr.format = THREE.RGBAFormat; texArr.type = THREE.UnsignedByteType;
  texArr.colorSpace = THREE.SRGBColorSpace;
  texArr.wrapS = texArr.wrapT = THREE.ClampToEdgeWrapping;
  texArr.minFilter = THREE.LinearMipmapLinearFilter;
  texArr.magFilter = THREE.LinearFilter;
  texArr.generateMipmaps = true;
  texArr.anisotropy = maxAniso;
  texArr.needsUpdate = true;

  return { texture: tex2d, arrayTexture: texArr, cols, rows, count, cellW, cellH, meta };
}

function makeDummy2D() {
  const t = new THREE.DataTexture(new Uint8Array([32, 28, 22, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

function makeDummyArray(val = 32) {
  const t = new THREE.DataArrayTexture(new Uint8Array([val, val, val, 255]), 1, 1, 1);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

function makeDummyRedArray() {
  const t = new THREE.DataArrayTexture(new Uint8Array([0]), 1, 1, 1);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

export async function loadMaterialLibrary(renderer) {
  const meta = await (await fetch(ASSET_URL + 'materials.json')).json();
  const { size, layers } = meta;
  const cols = meta.cols || 1;
  const albFile = meta.albedo || 'mat_albedo.webp';
  const nrFile = meta.nr || 'mat_nr.webp';
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
  // Decode sequentially with main-thread yields to keep peak GPU/Skia memory compact (zero CONTEXT_LOST_WEBGL!)
  const alb = await loadLayerImage(albFile, size, size, layers, cols, false);
  await yieldFrame();
  const nr = await loadLayerImage(nrFile, size, size, layers, cols, false);
  await yieldFrame();
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

  const signs = await loadSignAtlas('signs.json', 'signs.png').catch((e) => { console.warn('[matlib] signs failed', e); return null; });
  await yieldFrame();
  const signsVert = await loadSignAtlas('signs_vert.json', 'signs_vert.png').catch((e) => { console.warn('[matlib] signs_vert failed', e); return null; });
  await yieldFrame();
  const interiors = await loadInteriorsAtlas(renderer).catch((e) => { console.warn('[matlib] interiors not available yet:', e?.message || e); return null; });

  lib.interiors = interiors ? interiors.texture : makeDummy2D();
  lib.interiorsArr = interiors ? interiors.arrayTexture : makeDummyArray(32);
  lib.interiorsMeta = interiors ? interiors.meta : null;
  lib.hasInteriors = !!interiors;

  lib.interiorUniforms = {
    tInteriors: { value: lib.interiors },
    tInteriorsArr: { value: lib.interiorsArr },
    uInteriors: { value: new THREE.Vector4(interiors ? interiors.cols : 4, interiors ? interiors.rows : 4, interiors ? interiors.count : 0, interiors ? 1 : 0) },
  };

  lib.uniforms = {
    tMatAlbedo: { value: lib.albedo },
    tMatNR: { value: lib.nr },
    ...lib.interiorUniforms,
  };

  lib.signUniforms = {
    tSigns: { value: signs ? signs.texture : makeDummyRedArray() },
    uSigns: { value: new THREE.Vector2(signs ? signs.layers : 0, signsVert ? signsVert.layers : 0) },
    tSignsVert: { value: signsVert ? signsVert.texture : makeDummyRedArray() },
    uSignsVert: { value: new THREE.Vector2(signsVert ? signsVert.layers : 0, 0) },
  };

  let defs = '';
  for (const [name, m] of Object.entries(meta.materials)) {
    const N = name.toUpperCase();
    defs += `#define L_${N} ${m.layer}.0\n#define S_${N} ${(1 / m.metres).toFixed(6)}\n#define C_${N} vec3(${m.mean.map((v) => v.toFixed(4)).join(', ')})\n`;
  }
  lib.glsl = /* glsl */`
uniform sampler2DArray tMatAlbedo, tMatNR;
${defs}
struct MatS { vec3 albedo; vec3 n; float rough; };
MatS matSample(float layer, vec2 uv) {
  vec3 c = vec3(uv.x, -uv.y, layer);
  vec3 a = texture(tMatAlbedo, c).rgb;
  vec3 r = texture(tMatNR, c).rgb;
  vec2 xy = r.rg * 2.0 - 1.0;
  return MatS(a, vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))), r.b);
}
MatS matMix(MatS a, MatS b, float t) { return MatS(mix(a.albedo, b.albedo, t), mix(a.n, b.n, t), mix(a.rough, b.rough, t)); }
MatS matTint(float layer, vec2 uv, vec3 mean, vec3 tint) { MatS m = matSample(layer, uv); m.albedo = clamp(m.albedo / max(mean, vec3(0.02)), 0.0, 2.5) * tint; return m; }
`;
  return lib;
}
