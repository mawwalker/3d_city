// 3D Chongqing Mountain Tunnel Portals (隧道洞口):
// Loads site/data/tunnels.json ([{ x, z, y, dx, dz, width, cls }], (dx, dz) pointing INTO tunnel)
// and builds realistic arched concrete/sandstone portals with flared hillside wing walls,
// deep pitch-black interior vaults, sodium ceiling lights, hazard chevrons & glowing green lane arrows!

import * as THREE from 'three';
import { fetchJSON } from './data.js';
import { kitMaterial, depthMaterial } from '../engine/materials.js';
import { Kit } from './kit.js';

function addPortal(k, p, terrain, clearance, colOut = null) {
  const x = p.x, z = p.z;
  const wy = terrain ? (terrain.waterY ?? 0.0) : 0.0;
  const demY = (terrain && terrain.ready) ? (Math.max(terrain.sample(x, z), wy + 0.15) + 0.04) : 0.04;
  const baseY = (typeof p.y === 'number' && Number.isFinite(p.y)) ? Math.max(demY, p.y) : demY;
  const len = Math.hypot(p.dx || 0, p.dz || 0);
  if (len < 1e-4) return;
  // Right-handed local frame (det = +1): +Z points INTO tunnel, +Y is up, +X = Y x Z = (fzZ, 0, -fzX)
  const fzX = p.dx / len, fzZ = p.dz / len;
  const rxX = fzZ, rxZ = -fzX;
  const W = Math.max(6.2, Math.min(22.0, p.width || 9.0));
  const hw = W * 0.5 + 0.35; // clear portal opening half-width
  const archH = Math.max(5.8, Math.min(7.8, 5.2 + W * 0.12));
  const wallT = 1.25; // concrete portal ring thickness

  // Probe hillside DEM inside the tunnel mouth so the pitch-black seal curtain ALWAYS sits IN FRONT OF any rising cliff slope!
  let zSeal = 4.2;
  if (terrain && terrain.ready) {
    for (const d of [0.8, 1.4, 2.0, 2.8, 3.6, 4.4]) {
      const cx = x + fzX * d, cz = z + fzZ * d;
      const hC = terrain.sample(cx, cz);
      const hL = terrain.sample(cx - rxX * hw * 0.55, cz - rxZ * hw * 0.55);
      const hR = terrain.sample(cx + rxX * hw * 0.55, cz + rxZ * hw * 0.55);
      if (Math.max(hC, hL, hR) > baseY + 0.45) {
        zSeal = Math.max(0.75, d - 0.35);
        break;
      }
    }
  }
  const vaultD = Math.max(zSeal + 0.8, 5.5);

  // Respect twin-bore neighboring tunnel clearance so piers/wing walls NEVER block an adjacent bore!
  const availPos = clearance ? clearance.pos : 99;
  const availNeg = clearance ? clearance.neg : 99;
  const pierPos = Math.max(0.32, Math.min(1.45, availPos));
  const pierNeg = Math.max(0.32, Math.min(1.45, availNeg));
  const wantWingPos = availPos >= 3.2;
  const wantWingNeg = availNeg >= 3.2;

  // Register solid collision prisms for left pier, right pier, wing walls & back seal curtain (leaving bore open!)
  if (colOut) {
    const pushBox = (lx0, lx1, lz0, lz1, y0, y1) => {
      const s = colOut.xz.length / 2;
      for (const [lx, lz] of [[lx0, lz0], [lx1, lz0], [lx1, lz1], [lx0, lz1]]) {
        colOut.xz.push(x + rxX * lx + fzX * lz, z + rxZ * lx + fzZ * lz);
      }
      colOut.start.push(s); colOut.count.push(4);
      colOut.base.push(y0); colOut.top.push(y1);
    };
    const yBot = baseY - 12.0, yTop = baseY + archH + 2.2;
    // Left & right portal piers (extending into throat wall)
    pushBox(-hw - pierNeg, -hw, -0.30, zSeal + 0.5, yBot, yTop);
    pushBox(hw, hw + pierPos, -0.30, zSeal + 0.5, yBot, yTop);
    // Back optical seal wall (stops player walking into dark void behind mountain!)
    pushBox(-hw - pierNeg, hw + pierPos, zSeal - 0.25, zSeal + 1.0, yBot, yTop);
    // Flared wing walls
    for (const sg of [-1, 1]) {
      const want = sg > 0 ? wantWingPos : wantWingNeg;
      if (!want) continue;
      const pw = sg > 0 ? pierPos : pierNeg;
      const ox0 = sg * (hw + pw);
      const ox1 = sg * (hw + pw + 4.0);
      pushBox(Math.min(ox0, ox1), Math.max(ox0, ox1), -1.8, 0.5, yBot, baseY + archH * 0.85);
    }
  }

  const M = new THREE.Matrix4().set(
    rxX, 0, fzX, x,
    0,   1, 0,   baseY,
    rxZ, 0, fzZ, z,
    0,   0, 0,   1,
  );
  k.transform(M);

  // 1. Pitch-black interior tunnel vault & terrain-guarded seal plane (NEVER pierced by rising mountain DEM!)
  k.color(0.003, 0.004, 0.006).material(0.98, 0, 0, 0.02);
  // Pitch-black optical seal plane placed strictly BEFORE terrain rises inside the mouth
  k.box(0, archH * 0.5, zSeal, hw * 2 + 0.5, archH + 0.8, 0.24);
  // Dark inner side walls & ceiling liner
  k.box(-hw - 0.14, archH * 0.5, zSeal * 0.55, 0.30, archH + 0.4, zSeal + 0.6);
  k.box( hw + 0.14, archH * 0.5, zSeal * 0.55, 0.30, archH + 0.4, zSeal + 0.6);
  k.box(0, archH + 0.15, zSeal * 0.55, hw * 2 + 0.6, 0.35, zSeal + 0.6);
  // Clean dark shadowed asphalt threshold floor covering the mouth seam
  k.color(0.028, 0.030, 0.034).material(0.86, 0, 0, 0.18);
  k.box(0, 0.04, zSeal * 0.35 - 0.3, hw * 1.98, 0.10, zSeal + 1.4);

  // Receding warm sodium tunnel ceiling lamps strictly in front of the seal curtain
  k.color(1.0, 0.76, 0.38).material(0.25, 0, -6.5);
  for (const lz of [0.55, 1.85, 3.2]) {
    if (lz >= zSeal - 0.25) break;
    k.box(-hw * 0.38, archH - 0.18, lz, 0.55, 0.08, 0.32);
    k.box( hw * 0.38, archH - 0.18, lz, 0.55, 0.08, 0.32);
  }

  // 2. Architectural Chongqing weathered concrete portal headwall & deep piers (anchored -6m into slope!)
  const topH = 2.05;
  const xMin = -hw - pierNeg, xMax = hw + pierPos;
  const fullW = xMax - xMin, fullCx = (xMin + xMax) * 0.5;
  k.color(0.27, 0.265, 0.25).material(0.86, 0.03);
  // Left (-X) & right (+X) portal piers
  k.box(-hw - pierNeg * 0.5, (archH + topH - 6.0) * 0.5, 0.35, pierNeg, archH + topH + 6.0, wallT);
  k.box( hw + pierPos * 0.5, (archH + topH - 6.0) * 0.5, 0.35, pierPos, archH + topH + 6.0, wallT);
  // Overhead concrete lintel headwall & roof hood extending back into mountain slope
  k.box(fullCx, archH + topH * 0.5, 0.35, fullW, topH, wallT);
  k.box(fullCx, archH + topH * 0.65, vaultD * 0.42, fullW + 0.4, topH * 0.85, vaultD * 0.85);
  // Subtle recessed architectural frieze trim + weathered dark basalt cornice cap
  k.color(0.18, 0.18, 0.175).material(0.88, 0.04);
  k.box(fullCx, archH + 0.08, -0.28, fullW - 0.2, 0.18, 0.12);
  k.color(0.36, 0.35, 0.32).material(0.82, 0.04);
  k.box(fullCx, archH + topH + 0.16, 0.12, fullW + 0.45, 0.36, wallT + 0.44);
  // Chamfered haunch brackets inside upper arch corners (signature Chongqing tunnel portal look!)
  k.color(0.24, 0.235, 0.22).material(0.86, 0.03);
  for (const sg of [-1, 1]) {
    k.box(sg * (hw - 0.38), archH - 0.38, 0.35, 0.88, 0.88, wallT * 0.96);
  }

  // 3. Stepped tapering basalt-sandstone hillside wing buttresses (堡坎阶梯翼墙, omitted on twin-bore inner sides!)
  const tiers = [
    { off: 0.75, len: 1.5, h: archH * 0.84 },
    { off: 2.25, len: 1.5, h: archH * 0.64 },
    { off: 3.65, len: 1.3, h: archH * 0.46 },
  ];
  for (const sg of [-1, 1]) {
    const want = sg > 0 ? wantWingPos : wantWingNeg;
    if (!want) continue;
    const pierW = sg > 0 ? pierPos : pierNeg;
    const a = sg * 0.42; // ~24 deg outward flare toward approaching road (-Z)
    const wm = M.clone().multiply(new THREE.Matrix4().makeTranslation(sg * (hw + pierW + 0.02), 0, 0.22))
      .multiply(new THREE.Matrix4().makeRotationY(a));
    k.transform(wm);
    for (const tr of tiers) {
      k.color(0.25, 0.235, 0.205).material(0.88, 0.02);
      k.box(sg * tr.off, (tr.h - 5.5) * 0.5, -0.32, tr.len + 0.04, tr.h + 5.5, 0.82);
      // Darker weathered basalt coping lip atop each wing tier
      k.color(0.35, 0.33, 0.29).material(0.82, 0.02);
      k.box(sg * tr.off, tr.h + 0.11, -0.32, tr.len + 0.14, 0.22, 0.96);
    }
  }
  k.transform(M);

  // 4. Reflective yellow/black portal clearance stripes on left & right jambs
  for (const sg of [-1, 1]) {
    const pierW = sg > 0 ? pierPos : pierNeg;
    const sw = Math.min(0.36, pierW * 0.72);
    for (let s = 0; s < 5; s++) {
      const sy = 0.55 + s * 0.72;
      if (s & 1) k.color(0.06, 0.06, 0.07).material(0.55, 0.1);
      else k.color(0.88, 0.66, 0.06).material(0.30, 0.2, -0.5);
      k.box(sg * (hw + sw * 0.65), sy, -0.25, sw, 0.36, 0.06);
    }
  }

  // 5. Overhead glowing green lane-open indicators + tunnel fascia trim bar
  const nLanes = Math.max(1, Math.min(4, Math.round(W / 3.5)));
  const laneStep = (hw * 1.55) / nLanes;
  for (let l = 0; l < nLanes; l++) {
    const lx = -hw * 0.775 + (l + 0.5) * laneStep;
    k.color(0.08, 0.09, 0.10).material(0.48, 0.45);
    k.box(lx, archH + 0.62, -0.28, 0.72, 0.72, 0.14);
    k.color(0.10, 0.95, 0.38).material(0.22, 0, -5.5);
    k.box(lx, archH + 0.62, -0.36, 0.38, 0.42, 0.04);
  }
  // Subtle dark-blue Chongqing tunnel name plaque centered above lane lights
  k.color(0.08, 0.26, 0.56).material(0.36, 0.15, -0.4);
  k.box(0, archH + 1.44, -0.26, Math.min(hw * 1.35, 6.2), 0.58, 0.08);

  k.transform(null);
}

export class TunnelPortals {
  constructor({ scenes, env, terrain }) {
    this.scenes = scenes;
    this.env = env;
    this.terrain = terrain;
    this.portals = [];
    this.meshes = [];
    this.shadows = [];
  }

  async load() {
    let data = null;
    try {
      data = await fetchJSON('tunnels.json');
    } catch {
      return this; // graceful no-op if tunnels.json not present yet
    }
    const raw = Array.isArray(data) ? data : (data?.portals || data?.tunnels || []);
    // Keep portals within the 25x23km fine DEM city footprint
    const list = raw.filter((p) => p && p.x >= -14500 && p.x <= 10500 && p.z >= -12500 && p.z <= 10500);
    if (!list.length) return this;
    this.portals = list;

    // Precompute twin-bore lateral clearance per portal so side piers/wing walls never block a neighboring bore
    const clearances = list.map((a, idx) => {
      let pos = 99, neg = 99;
      const la = Math.hypot(a.dx || 0, a.dz || 0);
      if (la < 1e-4) return { pos, neg };
      const fzX = a.dx / la, fzZ = a.dz / la;
      const rxX = fzZ, rxZ = -fzX;
      const hwA = Math.max(6.2, Math.min(22.0, a.width || 9.0)) * 0.5 + 0.35;
      for (let j = 0; j < list.length; j++) {
        if (j === idx) continue;
        const b = list[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        if (dx * dx + dz * dz > 625) continue; // > 25m
        const along = dx * fzX + dz * fzZ;
        if (Math.abs(along) > 12) continue;
        const lat = dx * rxX + dz * rxZ;
        const hwB = Math.max(6.2, Math.min(22.0, b.width || 9.0)) * 0.5 + 0.35;
        const gap = Math.abs(lat) - hwA - hwB;
        if (lat > 0) pos = Math.min(pos, Math.max(0.25, gap * 0.5));
        else neg = Math.min(neg, Math.max(0.25, gap * 0.5));
      }
      return { pos, neg };
    });

    // Bucket into 3km x 3km spatial chunks for clean frustum & shadow culling
    const chunks = new Map();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const key = `${Math.floor(p.x / 3000)},${Math.floor(p.z / 3000)}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(i);
    }

    const colAcc = { xz: [], start: [], count: [], base: [], top: [] };
    const mat = kitMaterial(this.env, { instanced: false });
    const dmat = depthMaterial({ instanced: false });
    for (const [key, indices] of chunks) {
      const k = new Kit();
      for (const i of indices) addPortal(k, list[i], this.terrain, clearances[i], colAcc);
      if (!k.nv) continue;
      const geo = k.geometry();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `tunnel-portals-${key}`;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.updateMatrixWorld(true);
      const shadow = new THREE.Mesh(geo, dmat);
      shadow.matrixAutoUpdate = false; shadow.updateMatrix(); shadow.updateMatrixWorld(true);
      this.scenes.opaque.add(mesh);
      this.scenes.shadow.add(shadow);
      this.meshes.push(mesh);
      this.shadows.push(shadow);
    }
    this.colliders = colAcc.start.length ? {
      xz: new Float32Array(colAcc.xz),
      start: new Uint32Array(colAcc.start),
      count: new Uint16Array(colAcc.count),
      base: new Float32Array(colAcc.base),
      top: new Float32Array(colAcc.top),
    } : null;
    return this;
  }
}
