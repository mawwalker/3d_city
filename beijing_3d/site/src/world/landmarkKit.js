// A tiny procedural modelling kit for the hand-built landmarks.
//
// Frame: x east, y up, z SOUTH (so north is -z), metres. Everything a Kit emits ends up in one merged mesh.
// Per vertex: position, normal, colour (linear rgb), material kind, uv (metres: u along the surface, v up), 2 free params.
//
// Typical use:
//   kit.at(lm, () => {                 // lm from data/landmarks.json: local frame = footprint centre, +x along its long axis
//     kit.paint('#d8d4c8', MAT.marble);
//     kit.box(60, 4, 30);              // length (x), height, width (z); base at y = 0 of the current frame
//     kit.move(0, 4, 0);
//     kit.paint('#b23a2e', MAT.timber, { p0: 9 });   // p0 = wall height for the timber pattern
//     kit.box(50, 9, 20);
//     kit.paint('#dba02b', MAT.tile);
//     kit.roof(50, 20, 9, 7, { overhang: 2.4 });
//   });

import * as THREE from 'three';

export const MAT = {
  matte: 0,     // plaster, concrete, stone
  tile: 1,      // glazed roof tile: glossy, ribbed down the slope
  glass: 2,     // curtain wall: sky reflections, mullion grid from uv (p0 = floor height m, default 4), night lighting (p1 = lit share 0..1)
  metal: 3,     // brushed metal / titanium: broad specular
  glow: 4,      // self-lit at night (p0 = night intensity), matte by day
  marble: 5,    // white stone terraces, faint sheen, balustrade shading near the top edge (p0 = terrace height)
  timber: 6,    // vermilion palace wall with column rhythm, lattice doors and a painted beam band (p0 = wall height m)
  lattice: 7,   // open steel lattice (Bird's Nest): procedural criss-cross members over a dark void
  bubble: 8,    // ETFE cushions (Water Cube): cellular pattern, glows blue at night
  brick: 9,     // grey city-wall brick with courses
  water: 10,    // still water (reflecting pools)
};

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

// Triangulate a plan polygon ([[x, z], ...]); triangles come back counter-clockwise seen from above.
function capTris(pts) {
  const tri = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], -p[1])), []);
  return tri.map((t) => {
    const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
    const cr = (b[0] - a[0]) * (-(c[1] - a[1])) - (-(b[1] - a[1])) * (c[0] - a[0]);
    return cr >= 0 ? t : [t[0], t[2], t[1]];
  });
}

export class Kit {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.par = []; this.idx = [];
    this.n = 0;
    this.m = new THREE.Matrix4();
    this.stack = [];
    this._rgb = [1, 1, 1]; this._mat = MAT.matte; this._p0 = 0; this._p1 = 0; this._flood = 0;
    this.heightAt = () => 0;
  }

  // ------------------------------------------------------------------ style
  /** Set the current colour / material. opts: p0, p1 (material params), flood (0..1 night flood-lighting). */
  paint(hex, mat = MAT.matte, opts = {}) {
    _c.set(hex);
    this._rgb = [_c.r, _c.g, _c.b];
    this._mat = mat; this._p0 = opts.p0 ?? 0; this._p1 = opts.p1 ?? 0; this._flood = opts.flood ?? this._floodDefault ?? 0;
    return this;
  }

  /** Default night flood-lighting for everything painted afterwards (heritage buildings glow softly at night). */
  flood(v) { this._floodDefault = v; this._flood = v; return this; }

  // ------------------------------------------------------------------ transform stack
  save() { this.stack.push(this.m.clone()); return this; }
  restore() { this.m.copy(this.stack.pop()); return this; }
  move(x, y, z) { this.m.multiply(new THREE.Matrix4().makeTranslation(x, y, z)); return this; }
  /** Rotate about the vertical axis; positive = counter-clockwise seen from above (turns +x towards north). */
  turn(deg) { this.m.multiply(new THREE.Matrix4().makeRotationY(deg * Math.PI / 180)); return this; }
  tiltX(deg) { this.m.multiply(new THREE.Matrix4().makeRotationX(deg * Math.PI / 180)); return this; }
  tiltZ(deg) { this.m.multiply(new THREE.Matrix4().makeRotationZ(deg * Math.PI / 180)); return this; }
  scale(sx, sy = sx, sz = sx) { this.m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz)); return this; }

  /** Run fn in the local frame of a landmark record {x, y(north), angle}: origin on the ground at the footprint centre. */
  at(lm, fn, { angle = lm.angle, ground = true } = {}) {
    this.save();
    const y = ground ? this.heightAt(lm.x, -lm.y) : 0;
    this.m.identity().multiply(new THREE.Matrix4().makeTranslation(lm.x, y, -lm.y)).multiply(new THREE.Matrix4().makeRotationY((angle || 0) * Math.PI / 180));
    this._floodDefault = 0;
    fn(lm);
    this.restore();
    return this;
  }

  /** Register a label anchor at height h above the current frame origin (used by the label layer). */
  mark(name, h = 0, extra = {}) {
    _v.set(0, h, 0).applyMatrix4(this.m);
    (this.labels || (this.labels = [])).push({ name, x: _v.x, y: _v.y, z: _v.z, ...extra });
    return this;
  }

  // ------------------------------------------------------------------ low level
  vert(x, y, z, nx, ny, nz, u = 0, v = 0) {
    _v.set(x, y, z).applyMatrix4(this.m);
    _m3.getNormalMatrix(this.m);
    _n.set(nx, ny, nz).applyMatrix3(_m3).normalize();
    this.pos.push(_v.x, _v.y, _v.z); this.nrm.push(_n.x, _n.y, _n.z);
    this.col.push(this._rgb[0], this._rgb[1], this._rgb[2], this._mat);
    this.uv.push(u, v); this.par.push(this._p0, this._p1, this._flood);
    return this.n++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }

  /** Flat polygon (convex, counter-clockwise seen from its front). pts: [[x,y,z],...]; uvs optional [[u,v],...]. */
  face(pts, uvs) {
    const a = pts[0], b = pts[1], c = pts[2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i0 = this.n;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const uv = uvs ? uvs[i] : [Math.abs(ny) > 0.9 ? p[0] : (p[0] * (Math.abs(nz) > Math.abs(nx) ? 1 : 0) + p[2] * (Math.abs(nz) > Math.abs(nx) ? 0 : 1)), Math.abs(ny) > 0.9 ? p[2] : p[1]];
      this.vert(p[0], p[1], p[2], nx, ny, nz, uv[0], uv[1]);
    }
    for (let i = 1; i < pts.length - 1; i++) this.tri(i0, i0 + i, i0 + i + 1);
    return this;
  }

  // ------------------------------------------------------------------ primitives
  /**
   * Box centred on the frame origin in plan, standing on y0. L along x, W along z.
   * opts: top (true), bottom (false), taper (scale of the top relative to the base, number or [tx, tz]), cx, cz (plan offset)
   */
  box(L, H, W, y0 = 0, opts = {}) {
    const { top = true, bottom = false, cx = 0, cz = 0 } = opts;
    const t = opts.taper ?? 1; const tx = Array.isArray(t) ? t[0] : t, tz = Array.isArray(t) ? t[1] : t;
    const x = L / 2, z = W / 2, y1 = y0 + H;
    const b = [[cx - x, y0, cz + z], [cx + x, y0, cz + z], [cx + x, y0, cz - z], [cx - x, y0, cz - z]];             // base ccw from above: SW, SE, NE, NW
    const tp = [[cx - x * tx, y1, cz + z * tz], [cx + x * tx, y1, cz + z * tz], [cx + x * tx, y1, cz - z * tz], [cx - x * tx, y1, cz - z * tz]];
    let u = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const w = Math.hypot(b[j][0] - b[i][0], b[j][2] - b[i][2]);
      this.face([b[i], b[j], tp[j], tp[i]], [[u, 0], [u + w, 0], [u + w, H], [u, H]]);
      u += w;
    }
    if (top) this.face([tp[0], tp[1], tp[2], tp[3]]);
    if (bottom) this.face([b[3], b[2], b[1], b[0]]);
    return this;
  }

  /**
   * Extruded polygon. pts: [[x, z], ...] counter-clockwise seen from above. opts: top (true), bottom (false), smooth (false: faceted walls)
   */
  prism(pts, y0, y1, opts = {}) {
    const { top = true, bottom = false, smooth = false } = opts;
    const n = pts.length;
    let u = 0;
    if (!smooth) {
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
        this.face([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], [[u, 0], [u + w, 0], [u + w, y1 - y0], [u, y1 - y0]]);
        u += w;
      }
    } else {
      const i0 = this.n;
      for (let i = 0; i <= n; i++) {
        const p = pts[i % n], q = pts[(i + n - 1) % n], r = pts[(i + 1) % n];
        // outward normal for a ccw ring (seen from above, z south): right of the travel direction
        let nx = -(r[1] - q[1]), nz = (r[0] - q[0]);
        const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        this.vert(p[0], y0, p[1], nx, 0, nz, u, 0); this.vert(p[0], y1, p[1], nx, 0, nz, u, y1 - y0);
        if (i < n) u += Math.hypot(r[0] - p[0], r[1] - p[1]);
      }
      for (let i = 0; i < n; i++) { const a = i0 + 2 * i; this.tri(a, a + 2, a + 3); this.tri(a, a + 3, a + 1); }
    }
    if (top || bottom) {
      const tri = capTris(pts);
      if (top) { const i0 = this.n; for (const p of pts) this.vert(p[0], y1, p[1], 0, 1, 0, p[0], p[1]); for (const t of tri) this.tri(i0 + t[0], i0 + t[1], i0 + t[2]); }
      if (bottom) { const i0 = this.n; for (const p of pts) this.vert(p[0], y0, p[1], 0, -1, 0, p[0], p[1]); for (const t of tri) this.tri(i0 + t[0], i0 + t[2], i0 + t[1]); }
    }
    return this;
  }

  /** Regular polygon ring helper: n points, circum-radius r, rotated by rot degrees. Counter-clockwise from above. */
  static ngon(n, r, rot = 0, cx = 0, cz = 0) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = rot * Math.PI / 180 + (i / n) * Math.PI * 2; out.push([cx + r * Math.cos(a), cz - r * Math.sin(a)]); }
    return out;
  }

  /** Rounded rectangle ring (plan), counter-clockwise from above. L along x, W along z, corner radius r, seg points per corner. */
  static roundRect(L, W, r, seg = 5) {
    const out = [];
    const cx = L / 2 - r, cz = W / 2 - r;
    const corners = [[cx, cz, 270], [cx, -cz, 0], [-cx, -cz, 90], [-cx, cz, 180]];     // SE, NE, NW, SW (z south)
    for (const [x, z, a0] of corners) for (let i = 0; i <= seg; i++) { const a = (a0 + (90 * i) / seg) * Math.PI / 180; out.push([x + r * Math.cos(a), z - r * Math.sin(a)]); }
    return out;
  }

  /**
   * Surface of revolution about the vertical axis. profile: [[radius, y], ...] from bottom to top.
   * opts: seg (32), smooth (true: round; false: faceted like an octagonal pagoda), capTop, capBottom, arc ([a0, a1] degrees)
   */
  lathe(profile, opts = {}) {
    const { seg = 32, smooth = true, capTop = false, capBottom = false, arc = [0, 360] } = opts;
    const a0 = arc[0] * Math.PI / 180, da = (arc[1] - arc[0]) * Math.PI / 180 / seg;
    const np = profile.length;
    // cumulative length along the profile for v
    const vl = [0]; for (let j = 1; j < np; j++) vl.push(vl[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
    if (smooth) {
      const i0 = this.n;
      for (let i = 0; i <= seg; i++) {
        const a = a0 + i * da, ca = Math.cos(a), sa = Math.sin(a);
        for (let j = 0; j < np; j++) {
          const [r, y] = profile[j];
          const p = profile[Math.max(0, j - 1)], q = profile[Math.min(np - 1, j + 1)];
          let dr = q[0] - p[0], dy = q[1] - p[1];
          const l = Math.hypot(dr, dy) || 1; dr /= l; dy /= l;
          // profile tangent (dr, dy) -> outward normal (dy, -dr)
          this.vert(r * ca, y, -r * sa, dy * ca, -dr, -dy * sa, r * a, vl[j]);
        }
      }
      for (let i = 0; i < seg; i++) for (let j = 0; j < np - 1; j++) {
        const a = i0 + i * np + j, b = a + np;
        this.tri(a, b, b + 1); this.tri(a, b + 1, a + 1);
      }
    } else {
      for (let i = 0; i < seg; i++) {
        const a = a0 + i * da, b = a + da;
        for (let j = 0; j < np - 1; j++) {
          const [r0, y0] = profile[j], [r1, y1] = profile[j + 1];
          const w0 = 2 * r0 * Math.sin(da / 2), w1 = 2 * r1 * Math.sin(da / 2);
          const pts = [[r0 * Math.cos(a), y0, -r0 * Math.sin(a)], [r0 * Math.cos(b), y0, -r0 * Math.sin(b)], [r1 * Math.cos(b), y1, -r1 * Math.sin(b)], [r1 * Math.cos(a), y1, -r1 * Math.sin(a)]];
          if (r0 < 1e-4) this.face([pts[0], pts[2], pts[3]], [[0, vl[j]], [w1, vl[j + 1]], [0, vl[j + 1]]]);
          else if (r1 < 1e-4) this.face([pts[0], pts[1], pts[2]], [[0, vl[j]], [w0, vl[j]], [0, vl[j + 1]]]);
          else this.face(pts, [[i * w0, vl[j]], [(i + 1) * w0, vl[j]], [(i + 1) * w1, vl[j + 1]], [i * w1, vl[j + 1]]]);
        }
      }
    }
    const cap = (r, y, up) => {
      if (r < 1e-4) return;
      const i0 = this.n;
      this.vert(0, y, 0, 0, up ? 1 : -1, 0, 0, 0);
      for (let i = 0; i <= seg; i++) { const a = a0 + i * da; this.vert(r * Math.cos(a), y, -r * Math.sin(a), 0, up ? 1 : -1, 0, r * Math.cos(a), r * Math.sin(a)); }
      for (let i = 0; i < seg; i++) up ? this.tri(i0, i0 + 1 + i, i0 + 2 + i) : this.tri(i0, i0 + 2 + i, i0 + 1 + i);
    };
    if (capTop) cap(profile[np - 1][0], profile[np - 1][1], true);
    if (capBottom) cap(profile[0][0], profile[0][1], false);
    return this;
  }

  /**
   * Skin a stack of cross-sections. rings: [{ y, pts: [[x, z], ...] }, ...] bottom to top, all with the same vertex count,
   * counter-clockwise from above. opts: smooth (true), capTop (true), capBottom (false)
   */
  loft(rings, opts = {}) {
    const { smooth = true, capTop = true, capBottom = false } = opts;
    const n = rings[0].pts.length;
    if (smooth) {
      const i0 = this.n;
      for (let k = 0; k < rings.length; k++) {
        const R = rings[k], Rm = rings[Math.max(0, k - 1)], Rp = rings[Math.min(rings.length - 1, k + 1)];
        let u = 0;
        for (let i = 0; i <= n; i++) {
          const p = R.pts[i % n], q = R.pts[(i + n - 1) % n], r = R.pts[(i + 1) % n];
          // horizontal outward normal from the ring tangent, tilted by how the section grows / shrinks with height
          let nx = -(r[1] - q[1]), nz = r[0] - q[0];
          const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
          const a = Rm.pts[i % n], b = Rp.pts[i % n];
          const dOut = (b[0] - a[0]) * nx + (b[1] - a[1]) * nz, dy = (Rp.y - Rm.y) || 1;
          const ny = -dOut / dy;
          this.vert(p[0], R.y, p[1], nx, ny, nz, u, R.y);
          if (i < n) u += Math.hypot(r[0] - p[0], r[1] - p[1]);
        }
      }
      const w = n + 1;
      for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < n; i++) {
        const a = i0 + k * w + i, b = a + w;
        this.tri(a, a + 1, b + 1); this.tri(a, b + 1, b);
      }
    } else {
      for (let k = 0; k < rings.length - 1; k++) {
        const A = rings[k], B = rings[k + 1];
        let u = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const w = Math.hypot(A.pts[j][0] - A.pts[i][0], A.pts[j][1] - A.pts[i][1]);
          this.face([[A.pts[i][0], A.y, A.pts[i][1]], [A.pts[j][0], A.y, A.pts[j][1]], [B.pts[j][0], B.y, B.pts[j][1]], [B.pts[i][0], B.y, B.pts[i][1]]],
            [[u, A.y], [u + w, A.y], [u + w, B.y], [u, B.y]]);
          u += w;
        }
      }
    }
    const cap = (R, up) => {
      const tri = capTris(R.pts);
      const i0 = this.n;
      for (const p of R.pts) this.vert(p[0], R.y, p[1], 0, up ? 1 : -1, 0, p[0], p[1]);
      for (const t of tri) up ? this.tri(i0 + t[0], i0 + t[1], i0 + t[2]) : this.tri(i0 + t[0], i0 + t[2], i0 + t[1]);
    };
    if (capTop) cap(rings[rings.length - 1], true);
    if (capBottom) cap(rings[0], false);
    return this;
  }

  // ------------------------------------------------------------------ Chinese roofs
  /**
   * Hip roof with sagging slopes and upturned corners, centred on the origin. L along x (ridge direction), W along z.
   * eaveY: height of the eaves; rise: ridge height above the eaves.
   * opts: overhang (m beyond L x W), ridge (0.9: 1 = true hip, <1 longer ridge, 0 = full gable length), upturn (auto), sag (0.34), ridgeBeam (true), finial (false)
   */
  roof(L, W, eaveY, rise, opts = {}) {
    const { overhang = Math.min(3.2, Math.max(0.5, W * 0.13)), ridge = 0.9, sag = 0.34, ridgeBeam = true, finial = false } = opts;
    const hl = L / 2 + overhang, hw = W / 2 + overhang;
    const up = opts.upturn ?? Math.min(1.3, Math.max(0.25, hw * 0.075));
    const lr = Math.max(0, hl - hw * ridge);
    const d1 = hw * 0.52;
    const y1 = eaveY + rise * sag, y2 = eaveY + rise;
    const E = [[-hl, eaveY + up, hw], [0, eaveY, hw], [hl, eaveY + up, hw], [hl, eaveY, 0], [hl, eaveY + up, -hw], [0, eaveY, -hw], [-hl, eaveY + up, -hw], [-hl, eaveY, 0]];
    const ml = hl - d1, mw = hw - d1;
    const M = [[-ml, y1, mw], [ml, y1, mw], [ml, y1, -mw], [-ml, y1, -mw]];
    const RA = [-lr, y2, 0], RB = [lr, y2, 0];
    const side = (ea, em, eb, ma, mb) => { this.face([ea, em, ma]); this.face([em, mb, ma]); this.face([em, eb, mb]); };
    side(E[0], E[1], E[2], M[0], M[1]);       // south slope
    side(E[2], E[3], E[4], M[1], M[2]);       // east
    side(E[4], E[5], E[6], M[2], M[3]);       // north
    side(E[6], E[7], E[0], M[3], M[0]);       // west
    if (lr > 0.3) {
      this.face([M[0], M[1], RB, RA]); this.face([M[2], M[3], RA, RB]);
      this.face([M[1], M[2], RB]); this.face([M[3], M[0], RA]);
      if (ridgeBeam) { const keep = [this._rgb, this._mat]; this._rgb = this._rgb.map((c) => c * 0.72); this.box(lr * 2 + 0.6, 0.65, 0.5, y2 - 0.2); [this._rgb, this._mat] = keep; }
    } else {
      const A = [0, y2, 0];
      this.face([M[0], M[1], A]); this.face([M[1], M[2], A]); this.face([M[2], M[3], A]); this.face([M[3], M[0], A]);
      if (finial) { const keep = [this._rgb, this._mat, this._p0]; this.paint('#d9a520', MAT.metal); const s = Math.max(0.35, hw * 0.06); this.lathe([[0.01, y2 - 0.2], [s, y2 + s * 0.6], [s * 1.25, y2 + s * 1.6], [s * 0.5, y2 + s * 2.6], [0.01, y2 + s * 3.6]], { seg: 10 }); [this._rgb, this._mat, this._p0] = keep; }
    }
    return this;
  }

  /** Skirt roof (lower eave of a double-eave hall): ring from the overhanging eave up to the wall of the upper storey. */
  skirt(L, W, eaveY, rise, opts = {}) {
    const { overhang = Math.min(3.2, Math.max(0.5, W * 0.13)), inset = W * 0.16 } = opts;
    const hl = L / 2 + overhang, hw = W / 2 + overhang, il = L / 2 - inset, iw = W / 2 - inset;
    const up = opts.upturn ?? Math.min(1.2, Math.max(0.2, hw * 0.07));
    const E = [[-hl, eaveY + up, hw], [0, eaveY, hw], [hl, eaveY + up, hw], [hl, eaveY, 0], [hl, eaveY + up, -hw], [0, eaveY, -hw], [-hl, eaveY + up, -hw], [-hl, eaveY, 0]];
    const y = eaveY + rise;
    const M = [[-il, y, iw], [il, y, iw], [il, y, -iw], [-il, y, -iw]];
    const side = (ea, em, eb, ma, mb) => { this.face([ea, em, ma]); this.face([em, mb, ma]); this.face([em, eb, mb]); };
    side(E[0], E[1], E[2], M[0], M[1]); side(E[2], E[3], E[4], M[1], M[2]); side(E[4], E[5], E[6], M[2], M[3]); side(E[6], E[7], E[0], M[3], M[0]);
    return this;
  }

  /**
   * Conical / polygonal tented roof (circular halls, pavilions). r: eave radius, eaveY, rise.
   * opts: seg (32), sag (0.3), topR (0: pointed), smooth (true), up (eave flick)
   */
  coneRoof(r, eaveY, rise, opts = {}) {
    const { seg = 32, sag = 0.3, topR = 0.01, smooth = true } = opts;
    const prof = [[r, eaveY], [r * 0.56, eaveY + rise * sag], [r * 0.24, eaveY + rise * 0.68], [topR, eaveY + rise]];
    return this.lathe(prof, { seg, smooth });
  }

  /**
   * A complete traditional hall: stone platform, timber walls, hip roof (single or double eave).
   * spec: { L, W, wallH, platformH (1.2), platformMargin (auto), eaves (1|2), rise (auto), tile ('#dba02b'), wall ('#a3352a'), stone ('#dcd7cb'), pyramid (false), flood }
   * Stands on y = 0 of the current frame; returns the total height.
   */
  hall(spec) {
    const { L, W, wallH = Math.min(12.5, 0.30 * W + 1.6), eaves = 1, tile = '#dba02b', wall = '#a3352a', stone = '#dcd7cb', pyramid = false } = spec;
    const ph = spec.platformH ?? Math.min(2.6, Math.max(0.3, W * 0.07));
    const pm = spec.platformMargin ?? Math.min(4, Math.max(0.5, W * 0.09));
    const rise = spec.rise ?? Math.min(9.5, Math.max(1.2, W * 0.36 + 0.4));
    const overhang = Math.min(3.4, Math.max(0.5, W * 0.13));
    if (ph > 0) { this.paint(stone, MAT.marble, { p0: ph }); this.box(L + 2 * pm, ph, W + 2 * pm); }
    let y = ph;
    if (eaves >= 2) {
      const h1 = wallH * 0.56, inset = Math.min(4.5, Math.max(0.8, W * 0.16)), sr = rise * 0.3;
      this.paint(wall, MAT.timber, { p0: h1 }); this.box(L, h1, W, y, { top: false });
      this.paint(tile, MAT.tile); this.skirt(L, W, y + h1 - 0.15, sr, { overhang, inset });
      const yu = y + h1 + sr - 0.2, h2 = wallH * 0.46;
      this.paint(wall, MAT.timber, { p0: h2 }); this.box(L - 2 * inset, h2, W - 2 * inset, yu, { top: false });
      this.paint(tile, MAT.tile); this.roof(L - 2 * inset, W - 2 * inset, yu + h2 - 0.15, rise, { overhang, ridge: pyramid ? 1 : 0.86, finial: pyramid });
      return yu + h2 + rise;
    }
    this.paint(wall, MAT.timber, { p0: wallH }); this.box(L, wallH, W, y, { top: false });
    this.paint(tile, MAT.tile); this.roof(L, W, y + wallH - 0.15, pyramid ? rise * 1.15 : rise, { overhang, ridge: pyramid ? 1 : 0.9, finial: pyramid });
    return y + wallH + rise;
  }

  // ------------------------------------------------------------------ output
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    geo.setAttribute('aNormal', new THREE.BufferAttribute(new Float32Array(this.nrm), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(this.col), 4));
    geo.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    geo.setAttribute('aPar', new THREE.BufferAttribute(new Float32Array(this.par), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    geo.computeBoundingSphere();
    return geo;
  }
}
