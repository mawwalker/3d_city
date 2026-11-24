// Traffic for Chongqing 3D: vehicles driving the 3D mountain-city road graph.
//
// Upgrades over flat-city traffic:
//   - Full 3D DEM terrain & elevated deck elevation (H = terrain + clearance; tracks clearance CL separately so tunnels
//     cutting through Chongqing mountains are detected by CL < -2.6, never by world Y!).
//   - Smoothly clamped pitch slopes for steep mountain avenues & hillside switchbacks.
//   - Iconic Chongqing Yellow Taxis ("黄色法拉利") prominently mixed into urban traffic.
//   - Height-above-terrain (AGL) LOD and shadow radius so mountain roads at 200-500m elevation stay crisp.

import * as THREE from 'three';
import { kitMaterial, depthMaterial } from '../engine/materials.js';
import { KINDS } from './vehicles.js';

export const CYCLE = 72;
/** 0 green, 1 amber, 2 red — the same clock as the signal heads (street.js). */
export function signalState(phase, group, time) {
  const u = (time + phase / 65536 * CYCLE) % CYCLE;
  if (group === 0) return u < 31 ? 0 : u < 34 ? 1 : 2;
  return u >= 36 && u < 67 ? 0 : u >= 67 && u < 70 ? 1 : 2;
}

function sinceGreen(phase, group, time) {
  const u = (time + phase / 65536 * CYCLE) % CYCLE;
  return (u - (group === 0 ? 31 : 67) + CYCLE) % CYCLE;
}

// Vehicles per metre of lane by road class (daytime), and mix [sedan, SUV, MPV, hatch, Chongqing yellow taxi, bus, lorry]
const RHO = { 0: 1 / 62, 1: 1 / 62, 2: 1 / 128, 3: 1 / 145, 4: 1 / 155, 5: 1 / 235, 11: 1 / 125 };
const MIX = {
  0: [31, 25, 8, 6, 17, 2, 11],
  1: [30, 24, 8, 6, 19, 3, 10],
  2: [27, 22, 7, 8, 27, 4, 5],
  3: [26, 22, 7, 8, 28, 4, 5],
  4: [29, 23, 7, 9, 25, 3, 4],
  5: [33, 25, 7, 13, 19, 1, 2],
  11: [31, 24, 8, 6, 19, 3, 9],
};

const hourFactor = (h) => {
  h = ((h % 24) + 24) % 24;
  // Chongqing has famously lively evening/night traffic around Yuzhong/Hongyadong/Jiefangbei
  const P = [[0, 0.28], [5, 0.22], [6.5, 0.68], [8, 1.08], [10, 0.94], [16, 1.0], [18, 1.12], [20.5, 0.96], [22.5, 0.68], [24, 0.28]];
  for (let i = 0; i + 1 < P.length; i++) if (h <= P[i + 1][0]) return P[i][1] + (P[i + 1][1] - P[i][1]) * (h - P[i][0]) / (P[i + 1][0] - P[i][0]);
  return 0.28;
};

function boxesMeet(px, pz, hx, hz, a, b, qx, qz, gx, gz, c, d) {
  const dx = qx - px, dz = qz - pz, cs = Math.abs(hx * gx + hz * gz), sn = Math.abs(hx * gz - hz * gx);
  return Math.abs(dx * hx + dz * hz) < a + c * cs + d * sn && Math.abs(dx * hz - dz * hx) < b + c * sn + d * cs
    && Math.abs(dx * gx + dz * gz) < c + a * cs + b * sn && Math.abs(dx * gz - dz * gx) < d + a * sn + b * cs;
}

function boxPen(px, pz, hx, hz, a, b, qx, qz, gx, gz, c, d) {
  const dx = qx - px, dz = qz - pz, cs = Math.abs(hx * gx + hz * gz), sn = Math.abs(hx * gz - hz * gx);
  return Math.min(a + c * cs + d * sn - Math.abs(dx * hx + dz * hz), b + c * sn + d * cs - Math.abs(dx * hz - dz * hx),
    c + a * cs + b * sn - Math.abs(dx * gx + dz * gz), d + a * sn + b * cs - Math.abs(dx * gz - dz * gx));
}

const TURN_PRI = { S: 0, R: 1, L: 2 };
let CONN_ID = 1;
const HI_RANGE = 115;
const CELL = 16, GMASK = 16383;
const MAX_SLOPE = 0.36;

export class Traffic {
  constructor({ scenes, env, terrain = null, collision = null }) {
    this.scenes = scenes; this.env = env; this.terrain = terrain; this.collision = collision;
    this.nodes = new Map(); this.tiles = new Map();
    this.lanes = []; this.lanesDirty = true;
    this.count = 0; this.time = 0; this.factor = 1; this.dynShadows = true;
    this.cleared = 0; this.unknotted = 0; this.backed = 0; this.rerouted = 0; this.rings = 0;
    this.avgV = 6; this.jam = 0; this.demand = 1; this.camX = 0; this.camZ = 0;
    this.player = null;
    this._ctl = 0; this._seed = 9871;
    this.beams = new Float32Array(120 * 7); this.nBeams = 0;
    this._cand = []; this._Q = {}; this._kill = [];
    this.all = []; this.gridHead = new Int32Array(GMASK + 1); this.gridNext = new Int32Array(4096);
    const mat = kitMaterial(env, { instanced: true, instanceColor: true, moving: true });
    const dep = depthMaterial({ instanced: true });
    const mk = (geo, cap, m, scene, color) => {
      const im = new THREE.InstancedMesh(geo, m, cap); im.count = 0; im.frustumCulled = false; im.matrixAutoUpdate = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (color) { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); im.instanceColor.setUsage(THREE.DynamicDrawUsage); }
      scene.add(im); return im;
    };
    this.kinds = KINDS.map((K) => {
      const big = K.len > 5.5;
      const hi = mk(K.make(true, 0), big ? 260 : 750, mat, scenes.opaque, true);
      const lo = mk(K.make(true, 1), big ? 1400 : 3800, mat, scenes.opaque, true);
      const sh = mk(lo.geometry, big ? 260 : 750, dep, scenes.moving, false);
      return { K, hi, lo, sh };
    });
    this._rnd = () => { this._seed = (this._seed * 1664525 + 1013904223) >>> 0; return this._seed / 4294967296; };
  }

  // ------------------------------------------------------------------------------------------------ graph
  /** data: decodeTraffic() output; ox, oy: tile's south-west corner in world metres (x east, y north). */
  addTile(key, data, ox, oy) {
    if (!data || this.tiles.has(key)) return;
    const { E, xyz } = data, edges = [];
    const T = this.terrain;
    const waterY = T ? (T.waterY ?? 0.0) : 0.0;
    for (let e = 0; e < E.n; e++) {
      const k0 = E.start[e], n = E.start[e + 1] - k0;
      if (n < 2) continue;
      const X = new Float32Array(n), Z = new Float32Array(n), H = new Float32Array(n), CL = new Float32Array(n), cum = new Float32Array(n);
      const deck = (E.flags[e] & 2) !== 0;
      for (let k = 0; k < n; k++) {
        const wx = ox + xyz[(k0 + k) * 3];
        const wz = -(oy + xyz[(k0 + k) * 3 + 1]);
        const cl = xyz[(k0 + k) * 3 + 2];
        X[k] = wx; Z[k] = wz; CL[k] = cl;
        if (T && T.ready) {
          const ty = T.sample(wx, wz);
          if (deck) H[k] = Math.max(ty, waterY) + Math.max(cl, 0.24);
          else if (cl < -1.1) H[k] = ty + cl; // mountain tunnel
          else H[k] = Math.max(ty, waterY) + Math.max(cl, 0.045);
        } else {
          H[k] = deck ? Math.max(cl, 0.24) : cl;
        }
        if (k) cum[k] = cum[k - 1] + Math.hypot(X[k] - X[k - 1], Z[k] - Z[k - 1]);
      }
      const len = cum[n - 1];
      if (len < 0.5) continue;
      const ed = {
        key, a: E.a[e], b: E.b[e], cls: E.cls[e], flags: E.flags[e], isDeck: deck, nf: E.nf[e], nb: E.nb[e],
        lw: E.lw[e], shift: E.shift[e], W: E.W[e], speed: E.speed[e],
        n, X, Z, H, CL, cum, len, lanes: [[], []],
        dirs: [{ moves: null, ver: -1, feed: 1 }, { moves: null, ver: -1, feed: 1 }],
        sub: [E.sub[e * 2], E.sub[e * 2 + 1]], reach: [E.reach[e * 2], E.reach[e * 2 + 1]],
      };
      const one = (ed.flags & 1) !== 0;
      for (let d = 0; d < 2; d++) {
        const nl = d ? ed.nb : ed.nf;
        const tIn = E.trim[e * 2 + d], tOut = E.trim[e * 2 + 1 - d], stop = E.stop[e * 2 + 1 - d];
        for (let l = 0; l < nl; l++) {
          const off = d ? ed.shift + (l + 0.5) * ed.lw : one ? ed.shift + (ed.nf / 2 - l - 0.5) * ed.lw : ed.shift - (l + 0.5) * ed.lw;
          const fit = tIn + tOut > len - 1 ? Math.max(0, len - 1) / (tIn + tOut) : 1, s0 = tIn * fit, s1 = len - tOut * fit;
          ed.lanes[d].push({
            edge: ed, d, idx: l, off, veh: [], s0, s1,
            sStop: Math.min(s1, Math.max(s0 + 0.2, len - stop)),
            entry: d ? ed.b : ed.a, exit: d ? ed.a : ed.b,
            ctrl: E.ctrl[e * 2 + 1 - d], phase: E.phase[e * 2 + 1 - d],
            conns: new Map(), spawnT: this._rnd() * 8, source: false, far: 1, fresh: true, acc: 0,
          });
        }
      }
      for (const [id, end] of [[ed.a, 0], [ed.b, 1]]) {
        let nd = this.nodes.get(id);
        if (!nd) this.nodes.set(id, nd = { id, x: end ? X[n - 1] : X[0], z: end ? Z[n - 1] : Z[0], arms: [], box: [], ver: 0, inLanes: null, inVer: -1 });
        nd.arms.push({ edge: ed, end }); nd.ver++;
      }
      edges.push(ed);
    }
    this.tiles.set(key, edges);
    this.lanesDirty = true;
    for (const ed of edges) for (let d = 0; d < 2; d++) for (const lane of ed.lanes[d]) {
      const rho = RHO[ed.cls] || RHO[4];
      const gap = 1 / (rho * this.factor);
      for (let s = lane.s0 + this._rnd() * gap; s < lane.s1 - 4; s += gap * (0.35 + 1.3 * this._rnd())) this._spawn(lane, s, ed.speed * 0.7);
    }
  }

  removeTile(key) {
    const edges = this.tiles.get(key);
    if (!edges) return;
    for (const ed of edges) {
      ed.dead = true;
      for (let d = 0; d < 2; d++) for (const lane of ed.lanes[d]) {
        for (const v of lane.veh) { this._leaveBox(v); v.dead = true; this.count--; }
        lane.veh.length = 0;
      }
      for (const id of [ed.a, ed.b]) {
        const nd = this.nodes.get(id);
        if (!nd) continue;
        nd.arms = nd.arms.filter((a) => a.edge !== ed); nd.ver++;
        nd.box = nd.box.filter((v) => !v.dead);
        if (!nd.arms.length) this.nodes.delete(id);
      }
    }
    this.tiles.delete(key);
    this.lanesDirty = true;
  }

  _rebuild() {
    this.lanes.length = 0;
    for (const edges of this.tiles.values()) for (const ed of edges) for (let d = 0; d < 2; d++) for (const lane of ed.lanes[d]) {
      this.lanes.push(lane);
      const nd = this.nodes.get(lane.entry);
      lane.source = !!nd && nd.arms.length === 1;
      const v = lane.veh;
      for (let i = 0; i < v.length; i++) {
        v[i].noMove = false;
        if (v[i].next && v[i].next.edge.dead) { v[i].move = null; v[i].next = null; v[i].conn = null; }
      }
    }
    this.lanesDirty = false;
    this._feed();
  }

  // ------------------------------------------------------------------------------------------------ geometry
  /** Exact road or rendered deck elevation at (x, z) matching groundGeom, deckGeom & hero bridges.js! */
  _surfaceAt(x, z, isDeck, cl, approxY) {
    const T = this.terrain;
    const wy = T ? (T.waterY ?? 0.0) : 0.0;
    const ty = T && T.ready ? Math.max(T.sample(x, z), wy + 0.15) : wy + 0.15;
    if (isDeck || cl > 0.25) {
      if (this.collision) {
        const dk = this.collision.deckSurfaceAt(x, z, approxY, 14.0);
        if (dk === dk) return Math.max(dk + 0.02, ty + 0.045);
      }
      if (cl < 1.2) return ty + 0.045;
      return Math.max(approxY, ty + 0.045);
    }
    return ty + 0.045;
  }

  _lanePoint(lane, s, lat, out) {
    const ed = lane.edge, sa = lane.d ? ed.len - s : s, c = ed.cum;
    let lo = 0, hi = ed.n - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m] <= sa) lo = m; else hi = m - 1; }
    const seg = c[lo + 1] - c[lo] || 1e-6, t = Math.min(1, Math.max(0, (sa - c[lo]) / seg));
    let dx = (ed.X[lo + 1] - ed.X[lo]) / seg, dz = (ed.Z[lo + 1] - ed.Z[lo]) / seg;
    const B = 3.0;
    if (sa - c[lo] < B && lo > 0) { const sp = c[lo] - c[lo - 1] || 1e-6, w = 0.5 - 0.5 * (sa - c[lo]) / B; dx += ((ed.X[lo] - ed.X[lo - 1]) / sp - dx) * w; dz += ((ed.Z[lo] - ed.Z[lo - 1]) / sp - dz) * w; }
    else if (c[lo + 1] - sa < B && lo + 2 < ed.n) { const sn = c[lo + 2] - c[lo + 1] || 1e-6, w = 0.5 - 0.5 * (c[lo + 1] - sa) / B; dx += ((ed.X[lo + 2] - ed.X[lo + 1]) / sn - dx) * w; dz += ((ed.Z[lo + 2] - ed.Z[lo + 1]) / sn - dz) * w; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    out.x = ed.X[lo] + (ed.X[lo + 1] - ed.X[lo]) * t + dz * lat;
    out.z = ed.Z[lo] + (ed.Z[lo + 1] - ed.Z[lo]) * t - dx * lat;
    out.cl = ed.CL[lo] + (ed.CL[lo + 1] - ed.CL[lo]) * t;
    out.isDeck = ed.isDeck;
    const hdx = lane.d ? -dx : dx, hdz = lane.d ? -dz : dz;
    out.dx = hdx; out.dz = hdz;
    const hApprox = ed.H[lo] + (ed.H[lo + 1] - ed.H[lo]) * t;
    if (out.cl >= -1.1 && this.terrain && this.terrain.ready) {
      out.y = this._surfaceAt(out.x, out.z, ed.isDeck, out.cl, hApprox);
      const yF = this._surfaceAt(out.x + hdx * 2.0, out.z + hdz * 2.0, ed.isDeck, out.cl, hApprox);
      const yB = this._surfaceAt(out.x - hdx * 2.0, out.z - hdz * 2.0, ed.isDeck, out.cl, hApprox);
      let sl = (yF - yB) * 0.25;
      if (sl > MAX_SLOPE) sl = MAX_SLOPE; else if (sl < -MAX_SLOPE) sl = -MAX_SLOPE;
      out.sl = sl;
    } else {
      out.y = hApprox;
      let sl = (ed.H[lo + 1] - ed.H[lo]) / seg;
      if (sl > MAX_SLOPE) sl = MAX_SLOPE; else if (sl < -MAX_SLOPE) sl = -MAX_SLOPE;
      out.sl = lane.d ? -sl : sl;
    }
    return out;
  }

  _connector(a, b) {
    let c = a.conns.get(b);
    if (c) return c;
    const P = this._lanePoint(a, a.s1, a.off, {}), Q = this._lanePoint(b, b.s0, b.off, {});
    const d = Math.hypot(Q.x - P.x, Q.z - P.z), k = d * 0.38, N = 8;
    const pts = new Float32Array((N + 1) * 3), cum = new Float32Array(N + 1);
    const c0x = P.x + P.dx * k, c0z = P.z + P.dz * k, c1x = Q.x - Q.dx * k, c1z = Q.z - Q.dz * k;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      pts[i * 3] = b0 * P.x + b1 * c0x + b2 * c1x + b3 * Q.x;
      pts[i * 3 + 1] = b0 * P.z + b1 * c0z + b2 * c1z + b3 * Q.z;
      pts[i * 3 + 2] = P.y + (Q.y - P.y) * t;
      if (i) cum[i] = cum[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
    }
    c = { id: CONN_ID++, pts, cum, len: Math.max(cum[N], 0.1), cl0: P.cl, cl1: Q.cl, isDeck: !!(a.edge.isDeck || b.edge.isDeck), from: a, to: b, conf: new Map() };
    a.conns.set(b, c);
    return c;
  }

  _connPoint(c, u, out) {
    const cum = c.cum, n = cum.length;
    let i = 0; while (i + 2 < n && cum[i + 1] < u) i++;
    const seg = cum[i + 1] - cum[i] || 1e-6, t = Math.min(1, Math.max(0, (u - cum[i]) / seg)), p = c.pts;
    out.x = p[i * 3] + (p[i * 3 + 3] - p[i * 3]) * t;
    out.z = p[i * 3 + 1] + (p[i * 3 + 4] - p[i * 3 + 1]) * t;
    const f = Math.min(1, Math.max(0, u / c.len));
    out.cl = c.cl0 + (c.cl1 - c.cl0) * f;
    const i0 = Math.max(0, t < 0.5 ? i - 1 : i), i1 = Math.min(n - 1, i0 + 2);
    let dx = p[i1 * 3] - p[i0 * 3], dz = p[i1 * 3 + 1] - p[i0 * 3 + 1]; const l = Math.hypot(dx, dz) || 1;
    out.dx = dx / l; out.dz = dz / l;
    const hApprox = p[i * 3 + 2] + (p[i * 3 + 5] - p[i * 3 + 2]) * t;
    out.isDeck = c.isDeck;
    if (out.cl >= -1.1 && this.terrain && this.terrain.ready) {
      out.y = this._surfaceAt(out.x, out.z, c.isDeck, out.cl, hApprox);
      const yF = this._surfaceAt(out.x + out.dx * 2.0, out.z + out.dz * 2.0, c.isDeck, out.cl, hApprox);
      const yB = this._surfaceAt(out.x - out.dx * 2.0, out.z - out.dz * 2.0, c.isDeck, out.cl, hApprox);
      let sl = (yF - yB) * 0.25;
      if (sl > MAX_SLOPE) sl = MAX_SLOPE; else if (sl < -MAX_SLOPE) sl = -MAX_SLOPE;
      out.sl = sl;
    } else {
      out.y = hApprox;
      let sl = (p[i * 3 + 5] - p[i * 3 + 2]) / seg;
      if (sl > MAX_SLOPE) sl = MAX_SLOPE; else if (sl < -MAX_SLOPE) sl = -MAX_SLOPE;
      out.sl = sl;
    }
    return out;
  }

  _merge(a, b) {
    if (a.to !== b.to) return false;
    const p = a.pts, q = b.pts, ax = p[3] - p[0], az = p[4] - p[1], bx = q[3] - q[0], bz = q[4] - q[1];
    return ax * bx + az * bz > 0.82 * Math.hypot(ax, az) * Math.hypot(bx, bz);
  }

  _conflict(a, b) {
    if (a === b || a.from === b.from) return false;
    if (a.to === b.to) return !this._merge(a, b);
    let r = a.conf.get(b.id);
    if (r !== undefined) return r;
    r = false;
    const p = a.pts, q = b.pts, n = a.cum.length, m = b.cum.length;
    for (let i = 0; i + 1 < n && !r; i++) {
      const ax = p[i * 3], az = p[i * 3 + 1], bx = p[i * 3 + 3], bz = p[i * 3 + 4];
      for (let j = 0; j + 1 < m; j++) {
        const cx = q[j * 3], cz = q[j * 3 + 1], dx = q[j * 3 + 3], dz = q[j * 3 + 4];
        const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
        const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
        if (d1 * d2 < 0 && d3 * d4 < 0) { r = true; break; }
      }
    }
    if (!r && a.from.edge !== b.from.edge && a.to.edge !== b.to.edge) r = this._near(p, n, q, m, 4.84) || this._near(q, m, p, n, 4.84);
    a.conf.set(b.id, r); b.conf.set(a.id, r);
    return r;
  }

  _near(p, n, q, m, d2) {
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], z = p[i * 3 + 1];
      for (let j = 0; j + 1 < m; j++) {
        const ax = q[j * 3], az = q[j * 3 + 1], ux = q[j * 3 + 3] - ax, uz = q[j * 3 + 4] - az, l2 = ux * ux + uz * uz;
        const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2)) : 0, ex = x - ax - ux * t, ez = z - az - uz * t;
        if (ex * ex + ez * ez < d2) return true;
      }
    }
    return false;
  }

  _feed() {
    for (const edges of this.tiles.values()) for (const ed of edges) { ed.dirs[0].feed = ed.dirs[1].feed = 1; ed.dirs[0].fnew = ed.dirs[1].fnew = 1; }
    for (let pass = 0; pass < 3; pass++) {
      for (const nd of this.nodes.values()) {
        const ins = [];
        for (const a of nd.arms) {
          const d = a.end === 1 ? 0 : 1, L = a.edge.lanes[d];
          if (L.length) { const mv = this._moves(L[0]); let W = 0; for (const m of mv) W += m.w; if (W > 0) ins.push({ dir: a.edge.dirs[d], n: L.length, mv, W }); }
        }
        if (!ins.length) continue;
        const want = new Map();
        for (const A of ins) for (const m of A.mv) { const k = m.edge.dirs[m.d]; want.set(k, (want.get(k) || 0) + A.n * m.w / A.W); }
        for (const A of ins) {
          let f = 0;
          for (const m of A.mv) { const k = m.edge.dirs[m.d]; f += m.w / A.W * Math.min(1, m.neff * k.feed / Math.max(want.get(k), 1e-6)); }
          A.dir.fnew = Math.max(0.3, f);
        }
      }
      for (const edges of this.tiles.values()) for (const ed of edges) { ed.dirs[0].feed = ed.dirs[0].fnew; ed.dirs[1].feed = ed.dirs[1].fnew; }
    }
  }

  // ------------------------------------------------------------------------------------------------ routing
  _moves(lane) {
    const ed = lane.edge, dir = ed.dirs[lane.d], nd = this.nodes.get(lane.exit);
    if (!nd) return [];
    if (dir.ver === nd.ver && dir.moves) return dir.moves;
    const nIn = ed.lanes[lane.d].length;
    const P = this._lanePoint(lane, Math.max(lane.s0, ed.len - 9), 0, {});
    const moves = [], reach = ed.reach[lane.d ? 0 : 1];
    for (const arm of nd.arms) {
      const e2 = arm.edge;
      if (e2 === ed || !((reach >>> e2.sub[arm.end]) & 1)) continue;
      const d2 = arm.end === 0 ? 0 : 1, L2 = e2.lanes[d2];
      if (!L2.length) continue;
      const Q = this._lanePoint(L2[0], Math.min(L2[0].s1, 9), 0, {});
      const cos = P.dx * Q.dx + P.dz * Q.dz, sin = P.dz * Q.dx - P.dx * Q.dz;
      if (cos < -0.92) continue;
      const turn = cos > 0.766 ? 'S' : sin > 0 ? 'L' : 'R';
      let w = turn === 'S' ? 1.0 : turn === 'L' ? 0.2 : 0.26;
      if (turn === 'S' && e2.cls === ed.cls) w *= 1.6;
      if (e2.cls === 11 && ed.cls <= 1) w *= 0.22;
      if (e2.cls === 5 && ed.cls < 5) w *= 0.35;
      let nEff = L2.length;
      for (let e3 = e2, d3 = d2, run = e2.len, hop = 0; hop < 6 && run < 260; hop++) {
        const far = this.nodes.get(d3 === 0 ? e3.b : e3.a);
        if (!far || far.arms.length !== 2) break;
        const o = far.arms[0].edge === e3 ? far.arms[1] : far.arms[0];
        if (o.edge === e3) break;
        const dn = o.end === 0 ? 0 : 1, Ln = o.edge.lanes[dn];
        if (!Ln.length) break;
        if (Ln.length < nEff) nEff = Ln.length;
        e3 = o.edge; d3 = dn; run += e3.len;
      }
      w *= 0.6 + 0.4 * nEff;
      let right = false;
      if (turn === 'S') for (const o of nd.arms) {
        if (o.edge === ed || o.edge === e2) continue;
        const d3 = o.end === 1 ? 0 : 1, L3 = o.edge.lanes[d3];
        if (!L3.length) continue;
        const R = this._lanePoint(L3[0], Math.max(L3[0].s0, o.edge.len - 9), 0, {});
        if (R.dx * Q.dx + R.dz * Q.dz > 0.766 && R.dz * Q.dx - R.dx * Q.dz > sin) right = true;
      }
      moves.push({ edge: e2, d: d2, n2: L2.length, neff: nEff, turn, w, sin, cos, right, lmin: 0, lmax: nIn - 1 });
    }
    const S = moves.filter((m) => m.turn === 'S').sort((a, b) => b.sin - a.sin);
    for (const m of moves) {
      if (m.turn === 'S') {
        if (S.length > 1 && m === S[S.length - 1]) { m.right = true; m.lmin = Math.max(0, nIn - m.n2); }
        else if (S.length > 1 && m === S[0]) m.lmax = Math.min(nIn, m.n2) - 1;
      } else if (m.turn === 'L') { m.lmax = S.length ? 0 : Math.max(0, Math.ceil(nIn / 2) - 1); }
      else { m.right = true; m.lmin = S.length ? nIn - 1 : Math.floor(nIn / 2); }
    }
    dir.moves = moves; dir.ver = nd.ver;
    return moves;
  }

  _outLane(lane, m) {
    const nIn = lane.edge.lanes[lane.d].length, L2 = m.edge.lanes[m.d];
    const i = m.right ? m.n2 - (nIn - lane.idx) : lane.idx;
    return L2[Math.max(0, Math.min(m.n2 - 1, i))];
  }

  _chooseMove(v, lane, here, avoid = null) {
    let moves = this._moves(lane);
    if (avoid) { const alt = moves.filter((m) => m !== avoid && lane.idx >= m.lmin && lane.idx <= m.lmax); if (alt.length) moves = alt; }
    if (v.kind >= 5) { let wide = moves.filter((m) => m.edge.lw >= 3.0 && m.edge.cls !== 5); if (!wide.length) wide = moves.filter((m) => m.edge.lw >= 3.0); if (wide.length) moves = wide; }
    v.move = null; v.next = null; v.conn = null;
    let tot = 0;
    for (const m of moves) if (!here || (lane.idx >= m.lmin && lane.idx <= m.lmax)) tot += m.w;
    if (tot <= 0) { if (here && moves.length) { let b = moves[0]; for (const m of moves) if (m.w > b.w) b = m; v.move = b; } }
    else {
      let r = this._rnd() * tot;
      for (const m of moves) if (!here || (lane.idx >= m.lmin && lane.idx <= m.lmax)) { r -= m.w; if (r <= 0) { v.move = m; break; } }
    }
    if (v.move && (here || (lane.idx >= v.move.lmin && lane.idx <= v.move.lmax))) { v.next = this._outLane(lane, v.move); v.conn = this._connector(lane, v.next); this._plan(v); }
    v.noMove = !v.move;
  }

  _plan(v) {
    let X = v.next; const plan = [];
    for (let depth = 0; depth < 5 && (X.ctrl & 128); depth++) {
      const moves = this._moves(X);
      let tot = 0, pick = null;
      for (const m of moves) if (X.idx >= m.lmin && X.idx <= m.lmax) tot += m.w;
      if (tot > 0) { let r = this._rnd() * tot; for (const m of moves) if (X.idx >= m.lmin && X.idx <= m.lmax) { r -= m.w; if (r <= 0) { pick = m; break; } } }
      else for (const m of moves) if (!pick || m.w > pick.w) pick = m;
      if (!pick) break;
      const Y = this._outLane(X, pick);
      plan.push({ move: pick, lane: Y }); X = Y;
    }
    v.plan = plan.length ? plan : null; v.exit = X;
  }

  // ------------------------------------------------------------------------------------------------ vehicles
  _spawn(lane, s, speed, check = false) {
    const vs = lane.veh, ed = lane.edge;
    const mix = MIX[ed.cls] || MIX[4];
    let r = this._rnd() * 100, kind = 0;
    for (let k = 0; k < mix.length; k++) { r -= mix[k]; if (r <= 0) { kind = k; break; } }
    if (kind >= 5 && ed.lw < 3.0) kind = 0;
    const K = KINDS[kind];
    let i = 0; while (i < vs.length && vs[i].s < s) i++;
    const need = K.len + 5;
    if ((i < vs.length && vs[i].s - s < need) || (i > 0 && s - vs[i - 1].s < need)) return null;
    const P0 = this._lanePoint(lane, s, lane.off, this._P0 || (this._P0 = {}));
    if (check && this._occupied(P0, K.len * 0.5 + 1.5, K.wid * 0.5 + 0.2)) return null;
    const pal = K.colors, col = pal[Math.floor(this._rnd() * pal.length)];
    const heavy = kind >= 5;
    const v = {
      lane, s, v: speed, kind, len: K.len, wid: K.wid, col,
      f0: (heavy ? 0.82 : 0.9) + this._rnd() * 0.22, amax: heavy ? 1.1 : 1.5 + this._rnd() * 0.7,
      move: null, next: null, conn: null, cur: null, from: null,
      box: null, committed: false, wait: 0, nobox: false, noroom: false, dodge: 0, dodgeT: 0, still: 0,
      blk: null, bw: null, pb: null, cy: this._rnd() * 3, pt: this._rnd() * 0.07, pg: 1e9, pd: 0,
      plan: null, exit: null, id: this._vid = (this._vid || 0) + 1, lat: lane.off, chk: this._rnd() * 0.3,
      go: false, lc: 1 + this._rnd() * 3, noMove: false, dead: false,
      x: P0.x, y: P0.y, z: P0.z, cl: P0.cl, hx: P0.dx, hz: P0.dz, sl: P0.sl, lx: 0, nc: 0, back: 0, backW: 0, backs: 0,
    };
    vs.splice(i, 0, v);
    this.count++;
    return v;
  }

  _ahead(X, v) {
    const xs = X.veh, se = X.s0 - v.conn.len - v.len * 0.5;
    for (let j = 0; j < xs.length && j < 4; j++) if (xs[j].s + xs[j].len * 0.5 > se) return xs[j];
    return null;
  }

  _aheadIn(X, v, sv) {
    const xs = X.veh;
    for (let j = 0; j < xs.length && j < 6; j++) if (xs[j].s > sv || (xs[j].s === sv && xs[j].id < v.id)) return xs[j];
    return null;
  }

  _inbound(X, nd, v, sv) {
    let g = 1e9; this._vl = null;
    if (!nd) return g;
    for (const b of nd.box) {
      if (b === v || !b.committed || b.next !== X || b.lane === v.lane || !b.conn) continue;
      const sb = X.s0 - b.conn.len - (b.lane.s1 - b.s);
      if (sb < sv || (sb === sv && b.id > v.id)) continue;
      const gb = sb - sv - (b.len + v.len) * 0.5;
      if (gb < g) { g = gb; this._vl = b; }
    }
    return g;
  }

  _leaveBox(v) { if (v.box) { const b = v.box.box, i = b.indexOf(v); if (i >= 0) b.splice(i, 1); v.box = null; } }

  _inLanes(nd) {
    if (nd.inVer === nd.ver && nd.inLanes) return nd.inLanes;
    const out = [];
    for (const a of nd.arms) for (const l of a.edge.lanes[a.end === 1 ? 0 : 1]) out.push(l);
    nd.inLanes = out; nd.inVer = nd.ver;
    return out;
  }

  _beyond(Y, need) {
    let acc = Y.s1 - Y.s0, L = Y;
    for (let hop = 0; hop < 3 && acc < need + 6; hop++) {
      const nd = this.nodes.get(L.exit);
      if (!nd || nd.arms.length !== 2) return null;
      const mv = this._moves(L); if (mv.length !== 1) return null;
      const Z = this._outLane(L, mv[0]); if (!Z || Z.edge.dead) return null;
      const c = this._connector(L, Z);
      if (Z.veh.length) {
        const q = Z.veh[0];
        return acc + c.len + (q.s - q.len * 0.5 - Z.s0) < need && q.v <= 2.5 ? q : null;
      }
      acc += c.len + (Z.s1 - Z.s0); L = Z;
    }
    return null;
  }

  _canGo(v, lane, nd, dStop) {
    const X = v.next, conn = v.conn, t = this.time;
    if (!v.noroom && nd.arms.length > 2 && !((lane.edge.flags & 32) && (X.edge.flags & 32))) {
      const Y = v.exit && !v.exit.edge.dead ? v.exit : X, inside = (lane.ctrl & 128) !== 0;
      let need = v.len + 1.0;
      if (Y !== X) {
        for (let q = X, k = 0; q && q !== Y; q = v.plan && k < v.plan.length ? v.plan[k++].lane : null) {
          for (const o of q.veh) { need += o.len + 1.5; if (!inside && o.still > 2.5) { v.why = 1; v.bw = o; return false; } }
        }
        if (X.veh.length) { const o = X.veh[0]; if (o.v < 0.5 && o.s - o.len * 0.5 - X.s0 < v.len + 0.5) { v.why = 1; v.bw = o; return false; } }
      }
      let q = null;
      if (Y.veh.length) {
        q = Y.veh[0];
        if (Y === X) { const sv = X.s0 - conn.len - (lane.s1 - v.s); let j = 0; while (j < Y.veh.length && Y.veh[j].s < sv) j++; q = Y.veh[j]; }
      }
      if (q) {
        const free = q.s - q.len * 0.5 - Y.s0;
        if (free < need && !(q.v > 2.5 && (Y !== X || q.s - q.len * 0.5 - (X.s0 - conn.len) > v.len + 2.0))) { v.why = 1; v.bw = q; return false; }
      } else if (Y.s1 - Y.s0 < need + 6) {
        const o = this._beyond(Y, need); if (o) { v.why = 1; v.bw = o; return false; }
      }
    }
    {
      const sv = X.s0 - conn.len - (lane.s1 - v.s), xs = X.veh;
      for (let j = 0; j < xs.length && j < 6; j++) {
        const q = xs[j]; if (!q.cur || q.from === lane) continue;
        const d = sv - q.s, hl = (q.len + v.len) * 0.5;
        if (d > -hl && d < hl + 0.2 + Math.max(0, q.v - v.v) * 1.2 && !this._into(q, v)) { v.why = 3; v.bw = q; return false; }
      }
      for (const b of nd.box) {
        if (b === v || !b.committed || b.next !== X || b.lane === lane || !b.conn) continue;
        const d = sv - (X.s0 - b.conn.len - (b.lane.s1 - b.s)), hl = (b.len + v.len) * 0.5;
        if (d > -hl && d < hl + 0.2 + Math.max(0, b.v - v.v) * 1.2 && !this._into(b, v)) { v.why = 3; v.bw = b; return false; }
      }
    }
    { const w = nd.starve; if (w && w !== v && t - nd.starveT < 1 && !w.dead && w.conn && w.lane.edge !== lane.edge && this._conflict(conn, w.conn)) { v.why = 3; v.bw = w; return false; } }
    const type = lane.ctrl & 3;
    let mode = null;
    v.bw = null;
    if (type === 1) {
      const st = signalState(lane.phase, (lane.ctrl >> 2) & 1, t);
      const sneak = v.move.turn === 'L' && v.wait > 3 && dStop < 3;
      if (st === 2) {
        if (v.move.turn === 'R' && v.v < 2.0 && dStop < 3) mode = 'all';
        else if (sneak && sinceGreen(lane.phase, (lane.ctrl >> 2) & 1, t) < 5.0) mode = 'L';
        else { v.why = 2; return false; }
      } else if (st === 1) { if (sneak) mode = 'L'; else if (dStop > v.v * v.v / 5.6 + 1.0) { v.why = 2; return false; } }
      else if (v.move.turn === 'L') mode = 'L';
    } else if (type === 2) mode = 'rank';
    else if (lane.ctrl & 128) mode = 'in';
    if (v.wait < 9) {
      const r1 = (lane.ctrl >> 3) & 7, t1 = (lane.s1 - v.s + conn.len * 0.5) / Math.max(v.v, 3);
      for (const l2 of this._inLanes(nd)) {
        if (l2.edge === lane.edge) continue;
        const vs = l2.veh, h = vs.length ? vs[vs.length - 1] : null;
        if (!h || !h.conn || h.cur || h.conn.to !== X || !this._merge(conn, h.conn)) continue;
        const t2 = (l2.s1 - h.s + h.conn.len * 0.5) / Math.max(h.v, 3);
        if (Math.abs(t1 - t2) > 1.7) continue;
        const r2 = (l2.ctrl >> 3) & 7;
        if ((r2 < r1 || (r2 === r1 && (t2 < t1 || (t2 === t1 && h.id < v.id)))) && !this._into(h, v)) { v.why = 3; v.bw = h; return false; }
      }
    }
    if (mode && v.wait < (mode === 'L' ? 9 : 28)) {
      for (const l2 of this._inLanes(nd)) {
        if (l2.edge === lane.edge) continue;
        const vs = l2.veh; let h = null;
        for (let i = vs.length - 1; i >= 0; i--) if (!vs[i].committed) { h = vs[i]; break; }
        if (!h || !h.conn || h.cur) continue;
        const d2 = l2.sStop - h.s;
        if (d2 > 60 || (d2 > 8 && d2 / Math.max(h.v, 3) > (mode === 'L' ? 3.3 : 4.5))) continue;
        const c2 = l2.ctrl & 3;
        if (c2 === 1 && signalState(l2.phase, (l2.ctrl >> 2) & 1, t) === 2) continue;
        let pri;
        if (mode === 'all') pri = true;
        else if (mode === 'in') pri = c2 === 1;
        else if (mode === 'L') pri = c2 === 1 && (h.move.turn !== 'L' || h.id < v.id);
        else { const r2 = (l2.ctrl >> 3) & 7, r1 = (lane.ctrl >> 3) & 7, pv = TURN_PRI[v.move.turn], ph = TURN_PRI[h.move.turn]; pri = r2 < r1 || (r2 === r1 && (ph < pv || (ph === pv && h.id < v.id))); }
        if (!pri || (h.v < 0.3 && h.wait > 1.5 && mode !== 'all')) continue;
        if (this._conflict(conn, h.conn)) { v.why = 3; return false; }
      }
    }
    if (!v.nobox && !((lane.edge.flags & 32) && (X.edge.flags & 32))) for (const b of nd.box) {
      if (b === v || b.from === lane || (b.lane === lane)) continue;
      const cb = b.committed ? b.conn : b.cur;
      if (cb && cb.from.edge !== lane.edge && this._conflict(conn, cb)) {
        v.why = 4; v.bw = b;
        if (v.wait > 30 && (!nd.starve || nd.starve === v || nd.starve.dead || t - nd.starveT > 1 || t - nd.starve0 > 20)) { if (nd.starve !== v) nd.starve0 = t; nd.starve = v; nd.starveT = t; }
        return false;
      }
    }
    if (!v.nobox && dStop < 8) { const o = this._standingAcross(v, lane); if (o) { v.why = 4; v.bw = o; return false; } }
    v.why = 0;
    return true;
  }

  _standingAcross(v, lane) {
    const c = v.conn, X = v.next, P = this._S || (this._S = {}), a = v.len * 0.5, b = v.wid * 0.5;
    const all = this.all, head = this.gridHead, next = this.gridNext;
    for (let u = 1.0; u < c.len + 3.0; u += 2.0) {
      if (u < c.len) this._connPoint(c, u, P); else this._lanePoint(X, Math.min(X.s0 + (u - c.len), X.s1), X.off, P);
      const ix = Math.floor(P.x / CELL - 0.5), iz = Math.floor(P.z / CELL - 0.5);
      for (let q = 0; q < 4; q++) {
        for (let j = head[((ix + (q & 1)) * 73856093 ^ (iz + (q >> 1)) * 19349663) & GMASK]; j >= 0; j = next[j]) {
          const o = all[j];
          if (o === v || o.dead || o.v > 0.8 || o.lane === X || o.lane.edge === lane.edge || (o.committed && o.next === X) || Math.abs(o.y - P.y) > 1.8) continue;
          if (boxesMeet(P.x, P.z, P.dx, P.dz, a, b, o.x, o.z, o.hx, o.hz, o.len * 0.5, o.wid * 0.5)) return o;
        }
      }
    }
    return null;
  }

  _step(lane, dt) {
    const vs = lane.veh, ed = lane.edge;
    let n = vs.length;
    const nd = this.nodes.get(lane.exit);
    const pl = this.player;
    let ndIn;
    for (let i = n - 1; i >= 0; i--) {
      const v = vs[i];
      if (v.back > 0 || v.backW > 0) {
        v.v = 0; v.blk = null; v.bk = 0; v.still = 0;
        if (v.back > 0) {
          const d = Math.min(v.back, 1.5 * dt), f = i > 0 ? vs[i - 1] : null;
          let ok = v.s - d >= (v.cur ? lane.s0 - v.cur.len + 0.3 : lane.s0 + 0.3) && (!f || v.s - d - f.s - (f.len + v.len) * 0.5 > 0.5);
          if (ok && this._bodyBlock(v, lane, -d)) ok = false;
          if (ok) { const P = this._H; v.s -= d; v.back -= d; v.x = P.x; v.y = P.y; v.z = P.z; v.cl = P.cl; v.hx = P.dx; v.hz = P.dz; v.sl = P.sl; } else v.back = 0;
          if (v.back <= 0) { v.back = 0; v.backW = 2.5; }
        } else v.backW = Math.max(0, v.backW - dt);
        continue;
      }
      let gap = 1e9, dv = 0, v0 = ed.speed * v.f0;
      const lead = i < n - 1 ? vs[i + 1] : null;
      let blk = null, bk = 0;
      if (lead) { gap = lead.s - v.s - (lead.len + v.len) * 0.5; dv = v.v - lead.v; if (gap < 3.5) { blk = lead; bk = 1; } }
      if (v.committed) {
        const X = v.next;
        if (X && !X.edge.dead) {
          const sv = X.s0 - v.conn.len - (lane.s1 - v.s);
          if (X.veh.length) { const q = this._aheadIn(X, v, sv); if (q) { const g = q.s - sv - (q.len + v.len) * 0.5; if (g < gap) { gap = g; dv = v.v - q.v; blk = q; bk = 2; } } }
          if (nd && nd.box.length > 1) { const g = this._inbound(X, nd, v, sv); if (g < gap) { gap = g; dv = v.v - this._vl.v; blk = this._vl; bk = 5; } }
          if (v.move.turn !== 'S') { const dd = Math.max(0, lane.s1 - v.s); v0 = Math.min(v0, Math.sqrt(30 + 2.6 * dd)); }
        }
      } else if ((!lead || lead.committed) && v.s >= lane.s0 - 0.01) {
        if (!v.move && !v.noMove) this._chooseMove(v, lane, false);
        const dStop = lane.sStop - v.s - v.len * 0.5 - 0.6;
        if (v.move && !v.next) { if (dStop < 38) this._chooseMove(v, lane, true); }
        if (v.next && (v.next.edge.dead || !nd)) { v.move = null; v.next = null; v.conn = null; }
        if (v.next) {
          if (dStop < -2.5) { this._leaveBox(v); v.committed = true; v.box = nd; nd.box.push(v); }
          else if (dStop < v.v * v.v / 4.4 + 30) {
            v.chk -= dt;
            if (v.chk <= 0 || (dStop < 2 && v.v > 0.5)) { v.go = this._canGo(v, lane, nd, dStop); v.chk = 0.22; }
            else if (v.go && dStop < 0.6) { v.go = this._canGo(v, lane, nd, dStop); v.chk = 0.22; }
            if (!v.go) { const g = dStop + 2.0; if (g < gap) { gap = Math.max(g, 0.05); dv = v.v; blk = v.bw; bk = 3; } if (v.v < 0.4) v.wait += dt; if (v.why !== 2) { v.wg = v.why; v.wgb = v.bw; } }
            else if (dStop < 0.6) { this._leaveBox(v); v.committed = true; v.box = nd; nd.box.push(v); v.wait = 0; }
          }
          if (v.committed || v.go) {
            const X = v.next;
            if (X.veh.length) { const q = this._ahead(X, v); if (q) { const g = (lane.s1 - v.s) + v.conn.len + (q.s - X.s0) - (q.len + v.len) * 0.5; if (g < gap) { gap = g; dv = v.v - q.v; blk = q; bk = 2; } } }
          }
          if (v.move.turn !== 'S') { const dd = Math.max(0, lane.s1 - v.s); v0 = Math.min(v0, Math.sqrt(30 + 2.6 * dd)); }
        } else if (v.move && !v.next) {
          // waiting for lane change
        } else {
          if (v.s > lane.s1 - 1) { vs.splice(i, 1); n--; this._leaveBox(v); v.dead = true; this.count--; continue; }
        }
      }
      if (v.cur) {
        v0 = Math.min(v0, v.cur.turnV || 99);
        if (ndIn === undefined) ndIn = this.nodes.get(lane.entry) || null;
        if (ndIn && ndIn.box.length > 1) { const g = this._inbound(lane, ndIn, v, v.s); if (g < gap) { gap = g; dv = v.v - this._vl.v; blk = this._vl; bk = 5; } }
      }
      if (pl && Math.abs(v.x - pl.x) < 30 && Math.abs(v.z - pl.z) < 30 && Math.abs(v.y - pl.y) < 3) {
        const fx = pl.x - v.x, fz = pl.z - v.z, al = fx * v.hx + fz * v.hz, la = Math.abs(fx * v.hz - fz * v.hx);
        if (al > 0 && al < 28 && la < v.wid * 0.5 + 0.7) { const g = al - v.len * 0.5 - 0.5; if (g < gap) { gap = Math.max(g, 0.05); dv = v.v; } }
      }
      v.pt -= dt;
      if (v.pt <= 0 && v.cl > -2) this._probe(v, lane);
      if (v.pg < gap) { gap = v.pg; dv = v.pd; blk = v.pb; bk = 4; }
      const a = v.amax, ss = 2.0 + Math.max(0, v.v * 1.15 + v.v * dv / (2 * Math.sqrt(a * 2.4)));
      const r = v.v / Math.max(v0, 0.5), q = ss / Math.max(gap, 0.1);
      let acc = a * (1 - r * r * r * r - q * q);
      if (acc < -8) acc = -8;
      v.v = Math.max(0, v.v + acc * dt);
      if (gap < 0.25) v.v = 0;
      let ds = v.v * dt;
      if (lead) { const m = lead.s - (lead.len + v.len) * 0.5 - 0.1; if (v.s + ds > m) { ds = Math.max(0, m - v.s); v.v = Math.min(v.v, lead.v); } }
      if (ds > 0 && v.cl > -2) {
        const o = v.nc && !this.noBodyCheck ? this._bodyBlock(v, lane, ds) : null;
        if (o) { ds = 0; v.v = 0; blk = o; bk = 6; }
        else { const P = v.nc && !this.noBodyCheck ? this._H : this._pathAt(v, lane, ds, this._H || (this._H = {})); v.x = P.x; v.y = P.y; v.z = P.z; v.cl = P.cl; v.hx = P.dx; v.hz = P.dz; v.sl = P.sl; }
      }
      v.s += ds;
      v.blk = blk; v.bk = bk;
      if (v.v > 0.3) v.still = 0;
      else {
        v.still += dt;
        if (v.still > 6) {
          v.cy -= dt;
          if (v.cy <= 0) {
            v.cy = 2 + this._rnd() * 2;
            const r2 = this._ring(v, lane);
            if (r2 && r2 !== true && (v.still > 35 || (v.x - this.camX) ** 2 + (v.z - this.camZ) ** 2 > 160 * 160)) {
              if (r2 === 'stuck') { vs.splice(i, 1); n--; this._leaveBox(v); v.dead = true; this.count--; this.unknotted++; continue; }
              this._kill.push(r2);
            }
          }
        }
        if (v.still > 150 && (v.still > 300 || (v.x - this.camX) ** 2 + (v.z - this.camZ) ** 2 > 160 * 160)) {
          vs.splice(i, 1); n--; this._leaveBox(v); v.dead = true; this.count--; this.cleared++; continue;
        }
      }
      if (v.dodge > 0) { v.dodgeT += dt; if (v.dodgeT > 1.5) v.dodge = Math.max(0, v.dodge - dt * 0.5); }
      const dl = lane.off + (lane.d ? v.dodge : -v.dodge) - v.lat;
      if (dl !== 0) { const m = 1.3 * dt; v.lx = Math.abs(dl) <= m ? 0 : Math.sign(dl) * 1.3; v.lat = Math.abs(dl) <= m ? v.lat + dl : v.lat + Math.sign(dl) * m; } else v.lx = 0;
      if (v.cur && v.s >= lane.s0) { v.cur = null; }
      if (v.box && !v.committed && v.s >= lane.s0 + v.len * 0.5) this._leaveBox(v);
      if (!v.cur && !v.committed && v.move && !v.next) {
        v.lc -= dt;
        if (v.lc <= 0) { v.lc = 0.6 + this._rnd() * 0.8; const want = lane.idx < v.move.lmin ? lane.idx + 1 : lane.idx - 1; if (this._changeLane(v, lane, i, want)) { n--; continue; } }
      } else if (lead && !v.cur && !v.committed && !v.move && v.v < 1.5 && v.still > 3) {
        v.lc -= dt;
        if (v.lc <= 0) {
          v.lc = 2 + this._rnd() * 2;
          const L = ed.lanes[lane.d];
          let want = -1, fewest = n - 1 - i - 2;
          for (let di = -1; di <= 1; di += 2) {
            const T = L[lane.idx + di]; if (!T) continue;
            let m = 0; for (let j = T.veh.length - 1; j >= 0 && T.veh[j].s > v.s; j--) m++;
            if (m <= fewest) { fewest = m; want = lane.idx + di; }
          }
          if (want >= 0 && this._changeLane(v, lane, i, want)) { n--; continue; }
        }
      }
      if (v.s >= lane.s1) {
        if (v.committed && v.next && !v.next.edge.dead) {
          const X = v.next, c = v.conn;
          vs.splice(i, 1); n--;
          v.cur = c; v.from = lane; v.s = X.s0 - c.len + (v.s - lane.s1); v.lane = X; v.committed = false; v.go = false;
          v.move = null; v.next = null; v.conn = null; v.wait = 0; v.lat = X.off; v.noMove = false;
          v.wasNobox = v.nobox; v.nobox = false; v.noroom = false; v.dodge = 0; v.backs = 0; v.pt = 0; v.nc = 1;
          if (v.plan) { const st = v.plan.shift(); if (st && !st.lane.edge.dead && st.lane.entry === X.exit) { v.move = st.move; v.next = st.lane; v.conn = this._connector(X, st.lane); } if (!st || !v.plan.length) v.plan = null; }
          if (c.turnV === undefined) {
            const P = c.pts, m = c.cum.length - 1, x0 = P[3] - P[0], z0 = P[4] - P[1], x1 = P[m * 3] - P[m * 3 - 3], z1 = P[m * 3 + 1] - P[m * 3 - 2];
            const cs = (x0 * x1 + z0 * z1) / ((Math.hypot(x0, z0) || 1) * (Math.hypot(x1, z1) || 1));
            c.turnV = cs > 0.8 ? 99 : Math.max(3.5, Math.sqrt(2.2 * c.len / Math.max(0.3, Math.acos(Math.max(-1, Math.min(1, cs))))));
          }
          const xs = X.veh; let j = 0; while (j < xs.length && xs[j].s < v.s) j++; xs.splice(j, 0, v);
        } else if (v.noMove || !v.move) { vs.splice(i, 1); n--; this._leaveBox(v); v.dead = true; this.count--; }
        else { v.s = lane.s1 - 0.01; v.v = 0; }
      }
    }
  }

  _ring(v, lane) {
    const key = (o) => ((!o.committed && o.next && !o.go && (o.why === 1 || o.why === 4)) ? 0 : (o.committed || o.go || o.cur) ? 1e9 : 2e9) + o.id;
    let o = v.blk, best = v, bk = key(v), n = 0;
    for (; o && o !== v && n < 500; n++) {
      if (o.dead || o.still < 2) return false;
      const k = key(o); if (k < bk) { bk = k; best = o; }
      o = o.blk;
    }
    if (o !== v) return false;
    if (bk >= 1e9 && v.backs < 2) { const room = this._backRoom(v, lane); if (room > 0) { v.back = room; v.backs++; this.backed++; return true; } }
    if (best !== v) return false;
    this.rings++;
    if (bk < 1e9) {
      if (v.why === 1) { const m = v.move; this._chooseMove(v, lane, true, m); if (v.move === m || !v.next) v.noroom = true; else this.rerouted++; v.chk = 0; }
      else if (v.blk && !v.blk.dead && v.blk !== v) {
        if (v.backs < 2) { const room = this._backRoom(v, lane); if (room > 0) { v.back = room; v.backs++; this.backed++; return true; } }
        if (v.blk.blk === v && (v.blk.bk === 4 || v.blk.bk === 6) && !v.nobox) { v.nobox = true; v.chk = 0; return true; }
        return v.blk;
      } else v.nobox = true;
    } else return 'stuck';
    return true;
  }

  _pathAt(v, lane, d, out) {
    const s = v.s + d;
    if (v.cur) { const u = s - (lane.s0 - v.cur.len); return u < v.cur.len ? this._connPoint(v.cur, Math.max(0, u), out) : this._lanePoint(lane, Math.min(s, lane.s1), lane.off, out); }
    if (s <= lane.s1 || !v.conn || !v.next || v.next.edge.dead) return this._lanePoint(lane, Math.min(s, lane.edge.len - 0.01), v.lat, out);
    const u = s - lane.s1;
    if (u < v.conn.len) return this._connPoint(v.conn, u, out);
    return this._lanePoint(v.next, Math.min(v.next.s0 + (u - v.conn.len), v.next.s1), v.next.off, out);
  }

  _probe(v, lane) {
    v.pt = 0.09; v.pg = 1e9; v.pd = 0; v.pb = null;
    const a = v.len * 0.5 + 0.06, b = v.wid * 0.5 + 0.05;
    const look = Math.min(16, 2.6 + v.v * 1.25);
    const mid = look * 0.5, mx = v.x + v.hx * mid, mz = v.z + v.hz * mid, reach = (mid + a + 7.5) ** 2;
    const ix = Math.floor(mx / CELL - 0.5), iz = Math.floor(mz / CELL - 0.5), all = this.all, head = this.gridHead, next = this.gridNext, cand = this._cand;
    let nc = 0;
    for (let c = 0; c < 4; c++) {
      for (let j = head[((ix + (c & 1)) * 73856093 ^ (iz + (c >> 1)) * 19349663) & GMASK]; j >= 0; j = next[j]) {
        const o = all[j];
        if (o === v || o.dead || !this._level(v, lane, o)) continue;
        if (o.lane === lane && (v.cur === o.cur || o.s < v.s || (o.s === v.s && o.id > v.id))) continue;
        if ((o.x - mx) ** 2 + (o.z - mz) ** 2 > reach) continue;
        cand[nc++] = o;
      }
    }
    v.nc = nc;
    if (!nc) return;
    const P = this._Q;
    const cl = this._cl || (this._cl = new Float32Array(16 * 6 * 4)), cn = this._cn || (this._cn = new Uint8Array(16)), Q = this._R || (this._R = {});
    const myKey = v.cur ? 0 : v.committed ? 1 : 2, Xv = v.committed && v.conn ? v.next : null;
    for (let c = 0; c < nc && c < 16; c++) {
      const o = cand[c]; cn[c] = 0;
      if (o.lane === lane) continue;
      const Xo = o.committed && o.conn ? o.next : null;
      let first;
      if (Xv && o.lane === Xv) { const sv = Xv.s0 - v.conn.len - (lane.s1 - v.s); first = o.s > sv || (o.s === sv && o.id < v.id); }
      else if (Xo && Xo === lane) { const so = lane.s0 - o.conn.len - (o.lane.s1 - o.s); first = so > v.s || (so === v.s && o.id < v.id); }
      else if (Xv && Xo === Xv) { const sv = Xv.s0 - v.conn.len - (lane.s1 - v.s), so = Xv.s0 - o.conn.len - (o.lane.s1 - o.s); first = so > sv || (so === sv && o.id < v.id); }
      else if (v.hx * o.hx + v.hz * o.hz > 0.85) { const al = (o.x - v.x) * (v.hx + o.hx) + (o.z - v.z) * (v.hz + o.hz); first = al > 0 || (al === 0 && o.id < v.id); }
      else {
        if (o.v < 0.5 && !(o.cur && myKey > 0)) continue;
        const oKey = o.cur ? 0 : o.committed ? 1 : 2;
        first = !(oKey > myKey || (oKey === myKey && o.id > v.id));
      }
      if (!first) continue;
      let L = Math.min(16, Math.max(3, o.v * 1.2 + o.v * o.v / 8));
      if (o.cur) L = Math.max(L, Math.min(30, o.lane.s0 - o.s + 2));
      if (!o.cur && !o.committed && !o.go) L = Math.min(L, Math.max(0, (o.next ? o.lane.sStop : o.lane.s1) - o.s - o.len * 0.5));
      const n = Math.min(6, Math.ceil(L / 2.2)), oa = o.len * 0.5, ob = o.wid * 0.5;
      let k = 0;
      for (; k < n; k++) {
        this._pathAt(o, o.lane, L * (k + 1) / n, Q);
        if (boxesMeet(v.x, v.z, v.hx, v.hz, a, b, Q.x, Q.z, Q.dx, Q.dz, oa, ob)) break;
        const q = (c * 6 + k) * 4; cl[q] = Q.x; cl[q + 1] = Q.z; cl[q + 2] = Q.dx; cl[q + 3] = Q.dz;
      }
      cn[c] = k < n ? 0 : n;
    }
    let prev = 0;
    for (let d = 0.7; d <= look; d += d < 6 ? 1.0 : 1.6) {
      this._pathAt(v, lane, d, P);
      const hx = P.dx, hz = P.dz;
      for (let c = 0; c < nc; c++) {
        const o = cand[c], dx = o.x - P.x, dz = o.z - P.z, ol = o.len * 0.5;
        const dp = hx * o.hx + hz * o.hz, cs = Math.abs(dp), sn = Math.abs(hx * o.hz - hz * o.hx), tk = dp < -0.5 ? 0.2 : 0, bb = b - tk, ow = o.wid * 0.5 - tk;
        if (Math.abs(dx * hx + dz * hz) >= a + ol * cs + ow * sn || Math.abs(dx * hz - dz * hx) >= bb + ol * sn + ow * cs
          || Math.abs(dx * o.hx + dz * o.hz) >= ol + a * cs + bb * sn || Math.abs(dx * o.hz - dz * o.hx) >= ow + a * sn + bb * cs) {
          if (c < 16) for (let k = cn[c] - 1; k >= 0; k--) {
            const q = (c * 6 + k) * 4;
            if (boxesMeet(P.x, P.z, hx, hz, a, b, cl[q], cl[q + 1], cl[q + 2], cl[q + 3], ol, o.wid * 0.5)) { v.pg = Math.max(0.05, prev - 0.25); v.pb = o; v.pd = v.v; return; }
          }
          continue;
        }
        const dot = v.hx * o.hx + v.hz * o.hz;
        if (o.lane !== lane) {
          const X = v.committed && v.conn ? v.next : null, Xo = o.committed && o.conn ? o.next : null;
          let sv = 0, so = 0, queue = false;
          if (X && o.lane === X) { queue = true; sv = X.s0 - v.conn.len - (lane.s1 - v.s); so = o.s; }
          else if (Xo && Xo === lane) { queue = true; sv = v.s; so = lane.s0 - o.conn.len - (o.lane.s1 - o.s); }
          else if (X && Xo === X) { queue = true; sv = X.s0 - v.conn.len - (lane.s1 - v.s); so = X.s0 - o.conn.len - (o.lane.s1 - o.s); }
          if (queue) { if (so < sv || (so === sv && o.id > v.id)) continue; }
          else if (dot > 0) {
            const al = (o.x - v.x) * (v.hx + o.hx) + (o.z - v.z) * (v.hz + o.hz);
            if ((al < 0 || (al === 0 && v.id < o.id)) && this._into(o, v)) continue;
          } else if (dot < -0.5 && !v.cur && lane.idx === lane.edge.lanes[lane.d].length - 1) {
            v.dodge = Math.min(0.75, v.dodge + 0.25); v.dodgeT = 0;
          }
        }
        v.pg = Math.max(0.05, prev - 0.25); v.pb = o; v.pd = v.v - Math.max(0, o.v * dot);
        return;
      }
      prev = d;
    }
  }

  _level(v, lane, o) {
    const dy = Math.abs(o.y - v.y);
    if (dy <= 1.8) return true;
    if (dy > 4.5) return false;
    const ol = o.lane, a1 = v.cur ? lane.entry : -1, a2 = lane.s1 - v.s < 40 ? lane.exit : -1, b1 = o.cur ? ol.entry : -1, b2 = ol.s1 - o.s < 40 ? ol.exit : -1;
    return (a1 >= 0 && (a1 === b1 || a1 === b2)) || (a2 >= 0 && (a2 === b1 || a2 === b2));
  }

  _occupied(P, a, b) {
    const all = this.all, head = this.gridHead, next = this.gridNext, ix = Math.floor(P.x / CELL - 0.5), iz = Math.floor(P.z / CELL - 0.5);
    for (let c = 0; c < 4; c++) for (let j = head[((ix + (c & 1)) * 73856093 ^ (iz + (c >> 1)) * 19349663) & GMASK]; j >= 0 && j < all.length; j = next[j]) {
      const o = all[j];
      if (!o.dead && Math.abs(o.y - P.y) <= 1.8 && boxesMeet(P.x, P.z, P.dx, P.dz, a, b, o.x, o.z, o.hx, o.hz, o.len * 0.5, o.wid * 0.5)) return true;
    }
    return false;
  }

  _bodyBlock(v, lane, d) {
    const P = this._H || (this._H = {});
    this._pathAt(v, lane, d, P);
    const a = v.len * 0.5, b = v.wid * 0.5, all = this.all, head = this.gridHead, next = this.gridNext;
    const ix = Math.floor(P.x / CELL - 0.5), iz = Math.floor(P.z / CELL - 0.5);
    for (let c = 0; c < 4; c++) {
      for (let j = head[((ix + (c & 1)) * 73856093 ^ (iz + (c >> 1)) * 19349663) & GMASK]; j >= 0; j = next[j]) {
        const o = all[j];
        if (o === v || o.dead || (o.lane === lane && o.cur === v.cur) || !this._level(v, lane, o)) continue;
        const tk = P.dx * o.hx + P.dz * o.hz < -0.5 ? 0.2 : 0, oa = o.len * 0.5, ob = o.wid * 0.5 - tk;
        const pn = boxPen(P.x, P.z, P.dx, P.dz, a, b - tk, o.x, o.z, o.hx, o.hz, oa, ob);
        if (pn <= 0) continue;
        const p0 = boxPen(v.x, v.z, v.hx, v.hz, a, b - tk, o.x, o.z, o.hx, o.hz, oa, ob);
        if (p0 > 0 && pn <= p0 + 0.002) continue;
        return o;
      }
    }
    return null;
  }

  _backRoom(v, lane) {
    const vs = lane.veh, i = vs.indexOf(v), f = i > 0 ? vs[i - 1] : null;
    let room = v.s - (v.cur ? lane.s0 - v.cur.len + 0.3 : lane.s0 + 0.3);
    if (f) room = Math.min(room, v.s - f.s - (f.len + v.len) * 0.5 - 0.6);
    return room >= 2.5 ? Math.min(room, 6) : 0;
  }

  _into(o, v) {
    const P = this._R || (this._R = {}), a = o.len * 0.5 + 0.1, b = o.wid * 0.5 + 0.1, ol = v.len * 0.5, ow = v.wid * 0.5;
    for (let d = 0.7; d < 4.2; d += 1.0) {
      this._pathAt(o, o.lane, d, P);
      const dx = v.x - P.x, dz = v.z - P.z, cs = Math.abs(P.dx * v.hx + P.dz * v.hz), sn = Math.abs(P.dx * v.hz - P.dz * v.hx);
      if (Math.abs(dx * P.dx + dz * P.dz) < a + ol * cs + ow * sn && Math.abs(dx * P.dz - dz * P.dx) < b + ol * sn + ow * cs
        && Math.abs(dx * v.hx + dz * v.hz) < ol + a * cs + b * sn && Math.abs(dx * v.hz - dz * v.hx) < ow + a * sn + b * cs) return true;
    }
    return false;
  }

  _changeLane(v, lane, i, want) {
    const L = lane.edge.lanes[lane.d];
    if (want < 0 || want >= L.length || v.s > lane.sStop - 22 || v.s < lane.s0 + 2) return false;
    const T = L[want], ts = T.veh;
    let j = 0; while (j < ts.length && ts[j].s < v.s) j++;
    const ah = ts[j], bh = ts[j - 1];
    if (ah && ah.s - v.s < (ah.len + v.len) * 0.5 + 2.5 + Math.max(0, (v.v - ah.v) * 1.2)) return false;
    if (bh && v.s - bh.s < (bh.len + v.len) * 0.5 + 3.0 + Math.max(0, (bh.v - v.v) * 1.6)) return false;
    lane.veh.splice(i, 1); ts.splice(j, 0, v); v.lane = T; v.pt = 0; v.nc = 1;
    if (v.move && T.idx >= v.move.lmin && T.idx <= v.move.lmax) { v.next = this._outLane(T, v.move); v.conn = this._connector(T, v.next); }
    return true;
  }

  // ------------------------------------------------------------------------------------------------ frame
  update(dt, time, camera, hour) {
    this.time = time; this.camX = camera.position.x; this.camZ = camera.position.z;
    if (this.lanesDirty) this._rebuild();
    this.factor = hourFactor(hour);
    dt = Math.min(dt, 0.1);
    const lanes = this.lanes;
    const all = this.all; all.length = 0;
    for (let i = 0; i < lanes.length; i++) { const vs = lanes[i].veh; for (let j = 0; j < vs.length; j++) all.push(vs[j]); }
    if (this.gridNext.length < all.length) this.gridNext = new Int32Array(all.length * 2);
    const head = this.gridHead, next = this.gridNext; head.fill(-1);
    for (let i = 0; i < all.length; i++) { const v = all[i], h = (Math.floor(v.x / CELL) * 73856093 ^ Math.floor(v.z / CELL) * 19349663) & GMASK; next[i] = head[h]; head[h] = i; }
    const fr = (this._frame = (this._frame || 0) + 1);
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      lane.acc += dt;
      if (lane.far > 1 && ((fr + i) & (lane.far - 1))) { lane.fresh = false; continue; }
      lane.fresh = true;
      if (lane.veh.length) this._step(lane, Math.min(lane.acc, 0.12));
      lane.acc = 0;
    }
    if (this._kill.length) {
      for (const o of this._kill) { if (o.dead) continue; const ls = o.lane.veh, j = ls.indexOf(o); if (j >= 0) ls.splice(j, 1); this._leaveBox(o); o.dead = true; this.count--; this.unknotted++; }
      this._kill.length = 0;
    }
    const cx = camera.position.x, cz = camera.position.z;
    const groundY = this.terrain ? this.terrain.surfaceY(cx, cz) : 0;
    const agl = Math.max(0, camera.position.y - groundY);
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      if (!lane.source) continue;
      lane.spawnT -= dt;
      if (lane.spawnT > 0) continue;
      const ed = lane.edge, rho = RHO[ed.cls] || RHO[4];
      const flow = rho * this.factor * this.demand * ed.speed * 0.85 * ed.dirs[lane.d].feed;
      lane.spawnT = -Math.log(1 - this._rnd() * 0.999) / Math.max(flow, 1e-4);
      const vs = lane.veh;
      if (!vs.length || vs[0].s - lane.s0 > 14) this._spawn(lane, lane.s0 + 0.5, ed.speed * 0.8, true);
    }
    this._ctl -= dt;
    if (this._ctl <= 0 && lanes.length) {
      this._ctl = 0.5;
      let target = 0;
      const alt2 = (agl * 2.5) ** 2;
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i], ed = lane.edge, m = ed.n >> 1, rho = RHO[ed.cls] || RHO[4];
        target += (lane.s1 - lane.s0) * rho * ed.dirs[lane.d].feed;
        const d2 = (ed.X[m] - cx) ** 2 + (ed.Z[m] - cz) ** 2 + alt2;
        lane.far = d2 > 700 * 700 ? 4 : d2 > 300 * 300 ? 2 : 1;
      }
      let sv = 0, nv = 0, nj = 0;
      for (let i = 0; i < all.length; i++) { const c = all[i].lane.edge.cls; if (c >= 2) { sv += all[i].v; nv++; if (all[i].still > 45) nj++; } }
      if (nv > 20) { this.avgV += (sv / nv - this.avgV) * 0.1; this.jam += (nj / nv - this.jam) * 0.1; }
      this.demand = Math.max(0.3, Math.min(1, 1 - (this.jam - 0.03) / 0.09));
      target *= this.factor * this.demand; this.target = target;
      const far2 = 220 * 220;
      if (this.count > target * 1.15) {
        let kill = Math.ceil((this.count - target) * 0.08);
        for (let tries = 0; tries < kill * 20 && kill > 0; tries++) {
          const lane = lanes[Math.floor(this._rnd() * lanes.length)], vs = lane.veh;
          if (!vs.length || this._rnd() < lane.edge.dirs[lane.d].feed - 0.25) continue;
          const j = Math.floor(this._rnd() * vs.length), v = vs[j];
          if (v.committed || v.cur || v.box || (v.x - cx) ** 2 + (v.z - cz) ** 2 < far2) continue;
          vs.splice(j, 1); v.dead = true; this.count--; kill--;
        }
      } else if (this.count < target * 0.8) {
        let add = Math.ceil((target - this.count) * 0.08);
        const P = {};
        for (let tries = 0; tries < add * 6 && add > 0; tries++) {
          const lane = lanes[Math.floor(this._rnd() * lanes.length)];
          const rho = RHO[lane.edge.cls] || RHO[4];
          if (lane.s1 - lane.s0 < 12 || this._rnd() > rho * 62 * lane.edge.dirs[lane.d].feed) continue;
          const s = lane.s0 + 2 + this._rnd() * (lane.s1 - lane.s0 - 8);
          this._lanePoint(lane, s, lane.off, P);
          if ((P.x - cx) ** 2 + (P.z - cz) ** 2 < far2) continue;
          if (this._spawn(lane, s, lane.edge.speed * 0.6, true)) add--;
        }
      }
    }
    this._draw(camera, agl);
  }

  _draw(camera, agl) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const e = camera.matrixWorld.elements, fx = -e[8], fy = -e[9], fz = -e[10];
    const hi2 = HI_RANGE * HI_RANGE;
    const shR = this.dynShadows ? Math.min(115 * Math.max(1, agl / 20), 310) : 0, sh2 = shR * shR;
    const cosHalf = Math.cos(Math.min(1.5, (camera.fov * Math.PI / 360) * Math.max(1, camera.aspect) + 0.35));
    const kinds = this.kinds;
    for (const k of kinds) { k.nh = 0; k.nl = 0; k.ns = 0; }
    const beams = this.beams; let nb = 0; const lit = this.env.lights > 0.3;
    const P = this._P || (this._P = {});
    const lanes = this.lanes;
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li], vs = lane.veh;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        let hx, hz;
        if (lane.fresh || v.x === 0) {
          if (v.cur) this._connPoint(v.cur, v.s - (lane.s0 - v.cur.len), P); else this._lanePoint(lane, v.s, v.lat, P);
          v.x = P.x; v.y = P.y; v.z = P.z; v.cl = P.cl; v.sl = P.sl;
          hx = P.dx; hz = P.dz;
          if (v.lx !== 0 && v.v > 1) { const a = v.lx / Math.max(v.v, 4); hx += P.dz * a; hz -= P.dx * a; const l = Math.hypot(hx, hz); hx /= l; hz /= l; }
          v.hx = hx; v.hz = hz;
        } else { P.x = v.x; P.y = v.y; P.z = v.z; P.cl = v.cl; P.sl = v.sl; hx = v.hx; hz = v.hz; }
        if (P.cl < -1.1) continue; // cleanly hidden inside dark tunnel portal throat!
        const dx = P.x - cx, dy = P.y - cy, dz = P.z - cz, d2 = dx * dx + dy * dy + dz * dz;
        const k = kinds[v.kind];
        const shadow = d2 < sh2;
        const seen = d2 < 900 || (dx * fx + dy * fy + dz * fz) > cosHalf * Math.sqrt(d2);
        if (!seen && !shadow) continue;

        // Exact 4-wheel plane fit (pitch + roll + corner penetration guard) so ZERO tires or bumpers ever sink underground!
        const isDk = v.cur ? v.cur.isDeck : lane.edge.isDeck;
        let py = P.y, sl = P.sl, rl = 0;
        if (this.terrain && this.terrain.ready) {
          const hl = v.len * 0.34, hw = v.wid * 0.43;
          const rx = -hz, rz = hx; // local +Z = right of vehicle
          const yC  = this._surfaceAt(P.x, P.z, isDk, P.cl, P.y);
          let yFR = this._surfaceAt(P.x + hx * hl + rx * hw, P.z + hz * hl + rz * hw, isDk, P.cl, yC);
          let yFL = this._surfaceAt(P.x + hx * hl - rx * hw, P.z + hz * hl - rz * hw, isDk, P.cl, yC);
          let yRR = this._surfaceAt(P.x - hx * hl + rx * hw, P.z - hz * hl + rz * hw, isDk, P.cl, yC);
          let yRL = this._surfaceAt(P.x - hx * hl - rx * hw, P.z - hz * hl - rz * hw, isDk, P.cl, yC);
          // Guard against a single outer wheel momentarily stepping off a narrow elevated viaduct ramp onto terrain far below
          if (Math.abs(yFR - yC) > 1.5) yFR = yC;
          if (Math.abs(yFL - yC) > 1.5) yFL = yC;
          if (Math.abs(yRR - yC) > 1.5) yRR = yC;
          if (Math.abs(yRL - yC) > 1.5) yRL = yC;
          sl = ((yFR + yFL) - (yRR + yRL)) / (4 * hl);
          if (sl > MAX_SLOPE) sl = MAX_SLOPE; else if (sl < -MAX_SLOPE) sl = -MAX_SLOPE;
          rl = ((yFR + yRR) - (yFL + yRL)) / (4 * hw);
          if (rl > 0.38) rl = 0.38; else if (rl < -0.38) rl = -0.38;
          const yAvg = 0.25 * (yFR + yFL + yRR + yRL);
          const dFR = hl * sl + hw * rl, dFL = hl * sl - hw * rl, dRR = -hl * sl + hw * rl, dRL = -hl * sl - hw * rl;
          const pen = Math.max(0, yFR - (yAvg + dFR), yFL - (yAvg + dFL), yRR - (yAvg + dRR), yRL - (yAvg + dRL), yC - yAvg);
          py = yAvg + Math.min(pen, 0.24) + 0.015;
          v.y = py;
        }
        // Orthonormal right-handed vehicle frame [X (forward), Y (surface normal), Z (right with lateral roll)]
        const il = 1 / Math.sqrt(1 + sl * sl), Xx = hx * il, Xy = sl * il, Xz = hz * il;
        const Z0x = -hz, Z0y = rl, Z0z = hx;
        let Yx = Z0y * Xz - Z0z * Xy, Yy = Z0z * Xx - Z0x * Xz, Yz = Z0x * Xy - Z0y * Xx;
        const yl = 1 / (Math.hypot(Yx, Yy, Yz) || 1); Yx *= yl; Yy *= yl; Yz *= yl;
        const Zx = Xy * Yz - Xz * Yy, Zy = Xz * Yx - Xx * Yz, Zz = Xx * Yy - Xy * Yx;
        for (let pass = 0; pass < 2; pass++) {
          let im, n;
          if (pass === 0) {
            if (!seen) continue;
            const near = d2 < hi2; im = near ? k.hi : k.lo; n = near ? k.nh : k.nl;
            if (n >= im.instanceMatrix.count) continue;
            if (near) k.nh++; else k.nl++;
            const c = im.instanceColor.array; c[n * 3] = v.col[0]; c[n * 3 + 1] = v.col[1]; c[n * 3 + 2] = v.col[2];
          } else {
            if (!shadow || k.ns >= k.sh.instanceMatrix.count) continue;
            im = k.sh; n = k.ns++;
          }
          if (pass === 0 && lit && d2 < 145 * 145 && nb < 120) {
            const o = nb * 7;
            beams[o] = P.x + hx * (v.len * 0.5 + 5.5); beams[o + 1] = py + 1.6; beams[o + 2] = P.z + hz * (v.len * 0.5 + 5.5);
            beams[o + 3] = 12; beams[o + 4] = 165; beams[o + 5] = 152; beams[o + 6] = 125;
            nb++;
          }
          const m = im.instanceMatrix.array, o = n * 16;
          m[o] = Xx; m[o + 1] = Xy; m[o + 2] = Xz; m[o + 3] = 0;
          m[o + 4] = Yx; m[o + 5] = Yy; m[o + 6] = Yz; m[o + 7] = 0;
          m[o + 8] = Zx; m[o + 9] = Zy; m[o + 10] = Zz; m[o + 11] = 0;
          m[o + 12] = P.x; m[o + 13] = py; m[o + 14] = P.z; m[o + 15] = 1;
        }
      }
    }
    this.nBeams = nb;
    for (const k of kinds) {
      k.hi.count = k.nh; k.lo.count = k.nl; k.sh.count = k.ns;
      for (const [im, n] of [[k.hi, k.nh], [k.lo, k.nl], [k.sh, k.ns]]) {
        if (!n) continue;
        const a = im.instanceMatrix; a.clearUpdateRanges(); a.addUpdateRange(0, n * 16); a.needsUpdate = true;
        const c = im.instanceColor; if (c) { c.clearUpdateRanges(); c.addUpdateRange(0, n * 3); c.needsUpdate = true; }
      }
      k.hi.visible = k.nh > 0; k.lo.visible = k.nl > 0; k.sh.visible = k.ns > 0;
    }
  }
}
