// Road signs: street-name plates at the corners, direction boards ahead of the big junctions, bus-stop shelters and
// their name signs. The lettering is set with the browser's own CJK type on a canvas, one atlas per street-level tile
// (laid out by signGeom.js in the worker). Names come from OpenStreetMap; the board layout follows the usual Chinese
// junction-ahead sign in outline.

import * as THREE from 'three';
import { PRECISION, NOISE, GBUFFER_ENCODE } from '../engine/glsl.js';
import { gbufferMaterial, kitMaterial, depthMaterial } from '../engine/materials.js';
import { Kit } from './kit.js';

const VERT = /* glsl */`${PRECISION}
in vec3 position; in vec3 normal; in vec2 uv;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vNormal; out vec2 vUv;
void main() { vNormal = normal; vUv = uv; gl_Position = projectionMatrix * (viewMatrix * (modelMatrix * vec4(position, 1.0))); }`;
const FRAG = /* glsl */`${PRECISION}
${NOISE}
${GBUFFER_ENCODE}
uniform sampler2D tSign; uniform vec4 uNight;
in vec3 vNormal; in vec2 vUv;
void main() {
  vec3 c = texture(tSign, vUv).rgb; c *= c;
  Surface s = defaultSurface();
  s.albedo = c; s.normal = normalize(vNormal); s.roughness = 0.5; s.reflectance = 0.5;
  s.emissive = c * (0.02 + 0.3 * uNight.y);          // reflective sheeting: it stays readable under the street lamps
  writeGBuffer(s);
}`;

const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC","WenQuanYi Micro Hei",sans-serif';
const LATIN = { 东: 'E', 西: 'W', 南: 'S', 北: 'N' }, OPP = { 东: '西', 西: '东', 南: '北', 北: '南' };
const english = (s) => s.toUpperCase().replace(/\bROAD\b/g, 'RD').replace(/\bSTREET\b/g, 'ST').replace(/\bAVENUE\b/g, 'AVE').replace(/\bELEVATED\b/g, 'ELEV.');

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
/** text centred at (x, y), shrunk to fit `maxW` */
function fit(ctx, text, x, y, size, maxW, weight = 700, family = FONT) {
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = `${weight} ${Math.max(6, size * maxW / w)}px ${family}`;
  ctx.fillText(text, x, y);
}

function paint(ctx, c) {
  const { w, h } = c;
  ctx.save(); ctx.translate(c.x, c.y); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (c.kind === 'grey') { ctx.fillStyle = '#6f7275'; ctx.fillRect(0, 0, w, h); }
  else if (c.kind === 'plate') {
    ctx.fillStyle = c.ns ? '#17703c' : '#17479a'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f4f4f0'; ctx.lineWidth = 2; rr(ctx, 4, 4, w - 8, h - 8, 5); ctx.stroke();
    ctx.fillStyle = '#f7f7f3';
    fit(ctx, c.zh, w / 2, c.en ? 25 : 32, 30, 148);
    if (c.en) fit(ctx, english(c.en), w / 2, 48, 10.5, 150, 600, 'Arial, Helvetica, sans-serif');
    for (const [t, x] of [[OPP[c.right], 24], [c.right, w - 24]]) { fit(ctx, t, x, 26, 16, 22); fit(ctx, LATIN[t], x, 45, 9.5, 20, 600, 'Arial, Helvetica, sans-serif'); }
  } else if (c.kind === 'board') {
    ctx.fillStyle = '#16438f'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f4f4f0'; ctx.lineWidth = 3; rr(ctx, 5, 5, w - 10, h - 10, 8); ctx.stroke();
    ctx.fillStyle = '#f7f7f3'; ctx.strokeStyle = '#f7f7f3'; ctx.lineWidth = 7; ctx.lineCap = 'butt';
    const tip = (x, y, dx, dy) => { ctx.beginPath(); ctx.moveTo(x + dx * 12, y + dy * 12); ctx.lineTo(x - dy * 9, y + dx * 9); ctx.lineTo(x + dy * 9, y - dx * 9); ctx.closePath(); ctx.fill(); };
    ctx.beginPath(); ctx.moveTo(w / 2, h - 12); ctx.lineTo(w / 2, 46); ctx.stroke(); tip(w / 2, 46, 0, -1);
    if (c.left) { ctx.beginPath(); ctx.moveTo(w / 2, 84); ctx.lineTo(36, 84); ctx.stroke(); tip(36, 84, -1, 0); fit(ctx, c.left, 68, 64, 19, 104); }
    if (c.right) { ctx.beginPath(); ctx.moveTo(w / 2, 84); ctx.lineTo(w - 36, 84); ctx.stroke(); tip(w - 36, 84, 1, 0); fit(ctx, c.right, w - 68, 64, 19, 104); }
    if (c.ahead) fit(ctx, c.ahead, w / 2, 21, 20, 200);
  } else if (c.kind === 'stop') {
    ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c21f2f'; ctx.fillRect(0, 0, w, 26);
    ctx.fillStyle = '#ffffff'; fit(ctx, '公交车站', w / 2, 14, 14, 100);
    ctx.fillStyle = '#15171a';
    const ch = [...c.zh];
    if (ch.length > 6) { const k = Math.ceil(ch.length / 2); fit(ctx, ch.slice(0, k).join(''), w / 2, 47, 18, 116); fit(ctx, ch.slice(k).join(''), w / 2, 72, 18, 116); }
    else fit(ctx, c.zh, w / 2, 60, 20, 116);
  }
  ctx.restore();
}

function poleGeometry() { const k = new Kit(); k.color(0.36, 0.37, 0.38).material(0.45, 0.8); k.tube([0, 0, 0], [0, 3.62, 0], 0.045, 0.04, 8, true); k.tube([0, 0, 0], [0, 0.3, 0], 0.08, 0.06, 8, false); return k.geometry(); }
function gantryGeometry() {
  const k = new Kit(); k.color(0.40, 0.41, 0.42).material(0.45, 0.8);
  k.tube([0, 0, 0], [0, 7.55, 0], 0.16, 0.12, 12, true); k.tube([0, 0, 0], [0, 0.5, 0], 0.26, 0.2, 12, false);
  for (const y of [7.22, 5.58]) k.tube([0, y, 0], [4.9, y, 0], 0.07, 0.06, 8, true);
  for (const x of [1.35, 4.65]) k.tube([x, 5.5, 0], [x, 7.3, 0], 0.04, 0.04, 6, false);
  return k.geometry();
}
function shelterGeometry() {
  // x along the kerb, +z towards the road; 1.3 m deep, standing at the kerb so that people pass behind it
  const k = new Kit();
  k.color(0.20, 0.21, 0.22).material(0.5, 0.6); k.box(0, 2.62, 0.1, 4.4, 0.08, 1.3); k.box(0, 2.54, 0.73, 4.4, 0.14, 0.05);
  for (const x of [-1.9, 1.9]) k.tube([x, 0, -0.48], [x, 2.6, -0.48], 0.05, 0.05, 8, false);
  k.color(0.10, 0.13, 0.15).material(0.08, 0, 0, 0.9); k.box(0, 1.4, -0.5, 3.6, 1.7, 0.03);
  k.color(0.85, 0.88, 0.92).material(0.4, 0, -2.4); k.box(-2.08, 1.32, 0.08, 0.10, 1.72, 0.95);        // the lit advertising panel at one end
  k.color(0.20, 0.21, 0.22).material(0.5, 0.6); k.box(-2.08, 1.32, 0.08, 0.14, 1.86, 1.08);
  k.color(0.45, 0.33, 0.20).material(0.7, 0); k.box(0.5, 0.46, -0.28, 2.2, 0.05, 0.34);
  k.color(0.20, 0.21, 0.22).material(0.5, 0.6); for (const x of [-0.4, 1.4]) k.box(x, 0.22, -0.28, 0.06, 0.44, 0.28);
  return k.geometry();
}
function stopPoleGeometry() { const k = new Kit(); k.color(0.36, 0.37, 0.38).material(0.45, 0.8); k.tube([0, 0, 0], [0, 2.7, 0], 0.04, 0.04, 8, true); return k.geometry(); }

export class SignLayer {
  constructor({ scenes, env, quality }) {
    this.scenes = scenes; this.env = env;
    this.scale = !quality ? 0.75 : quality.name === 'low' ? 0.5 : quality.name === 'ultra' ? 1 : 0.75;      // atlas resolution (a dozen tiles' worth of lettering is held at once)
    this.kitMat = kitMaterial(env, { instanced: true }); this.depth = depthMaterial({ instanced: true });
    this.geo = [poleGeometry(), gantryGeometry(), shelterGeometry(), stopPoleGeometry()];
    this.tiles = new Map();
  }

  addTile(key, t, d) {
    if (!d || this.tiles.has(key)) return;
    const o = { objs: [] };
    if (d.index.length) {
      const k = this.scale, cv = document.createElement('canvas');
      cv.width = Math.round(d.atlasW * k); cv.height = Math.max(8, Math.round(d.atlasH * k));
      const ctx = cv.getContext('2d'); ctx.scale(k, k);
      ctx.fillStyle = '#6f7275'; ctx.fillRect(0, 0, d.atlasW, d.atlasH);
      for (const c of d.cells) paint(ctx, c);
      const tex = new THREE.CanvasTexture(cv);
      tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
      g.setIndex(new THREE.BufferAttribute(d.index, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 760);
      const mat = gbufferMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { tSign: { value: tex }, uNight: this.env.uniforms.uNight }, name: 'signs' });
      const m = new THREE.Mesh(g, mat); m.position.set(t.x, 0, t.z); m.matrixAutoUpdate = false; m.updateMatrix(); m.updateMatrixWorld(true);
      this.scenes.opaque.add(m);
      o.mesh = m; o.tex = tex; o.mat = mat;
    }
    // poles, gantries, shelters
    const I = d.inst, M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let kind = 0; kind < 4; kind++) {
      const sel = []; for (let i = 0; i < I.length; i += 4) if (I[i + 3] === kind) sel.push(i);
      if (!sel.length) continue;
      const im = new THREE.InstancedMesh(this.geo[kind], this.kitMat, sel.length), sh = new THREE.InstancedMesh(this.geo[kind], this.depth, sel.length);
      sel.forEach((i, n) => { q.setFromAxisAngle(up, I[i + 2]); p.set(t.x + I[i], 0.15, t.z + I[i + 1]); M.compose(p, q, one); im.setMatrixAt(n, M); sh.setMatrixAt(n, M); });
      im.instanceMatrix.needsUpdate = true; sh.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); sh.computeBoundingSphere();
      this.scenes.opaque.add(im); this.scenes.shadow.add(sh); o.objs.push(im, sh);
    }
    this.tiles.set(key, o);
  }

  removeTile(key) {
    const o = this.tiles.get(key);
    if (!o) return;
    if (o.mesh) { this.scenes.opaque.remove(o.mesh); o.mesh.geometry.dispose(); o.mat.dispose(); o.tex.dispose(); }
    for (const m of o.objs) { m.parent && m.parent.remove(m); m.dispose && m.dispose(); }
    this.tiles.delete(key);
  }
}
