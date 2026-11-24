// Compact modelling kit for street furniture, vehicles, boats and lamps (position, normal, color, aMat).
import * as THREE from 'three';

export class Kit {
  constructor() { this.p = []; this.n = []; this.c = []; this.m = []; this.i = []; this.nv = 0; this.mat = [0.6, 0, 0, 0.5]; this.col = [0.5, 0.5, 0.5]; this.xf = null; }
  color(r, g, b) { this.col = [r, g, b]; return this; }
  material(rough, metal = 0, emissive = 0, refl = 0.5) { this.mat = [rough, metal, emissive, refl]; return this; }
  transform(m) { this.xf = m; return this; }
  v(x, y, z, nx, ny, nz) {
    if (this.xf) {
      const e = this.xf.elements;
      const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      const NX = e[0] * nx + e[4] * ny + e[8] * nz, NY = e[1] * nx + e[5] * ny + e[9] * nz, NZ = e[2] * nx + e[6] * ny + e[10] * nz;
      x = X; y = Y; z = Z;
      const l = Math.hypot(NX, NY, NZ) || 1;
      nx = NX / l; ny = NY / l; nz = NZ / l;
    }
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.c.push(...this.col); this.m.push(...this.mat);
    return this.nv++;
  }
  quad(a, b, c, d) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i = this.v(...a, nx, ny, nz); this.v(...b, nx, ny, nz); this.v(...c, nx, ny, nz); this.v(...d, nx, ny, nz);
    this.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
    return this;
  }
  box(cx, cy, cz, sx, sy, sz) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    return this;
  }
  tube(A, B, r0, r1, sides = 10, cap = true) {
    const d = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]); const L = d.length() || 1; d.normalize();
    const up = Math.abs(d.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const a = new THREE.Vector3().crossVectors(up, d).normalize(), b = new THREE.Vector3().crossVectors(d, a);
    const base = this.nv; const slope = (r0 - r1) / L;
    for (let k = 0; k <= sides; k++) {
      const t = k / sides * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      const nx = a.x * c + b.x * s + d.x * slope, ny = a.y * c + b.y * s + d.y * slope, nz = a.z * c + b.z * s + d.z * slope;
      this.v(A[0] + (a.x * c + b.x * s) * r0, A[1] + (a.y * c + b.y * s) * r0, A[2] + (a.z * c + b.z * s) * r0, nx, ny, nz);
      this.v(B[0] + (a.x * c + b.x * s) * r1, B[1] + (a.y * c + b.y * s) * r1, B[2] + (a.z * c + b.z * s) * r1, nx, ny, nz);
    }
    for (let k = 0; k < sides; k++) { const i = base + k * 2; this.i.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
    if (cap && r1 > 0.001) {
      const c0 = this.v(B[0], B[1], B[2], d.x, d.y, d.z);
      for (let k = 0; k < sides; k++) {
        const t0 = k / sides * 6.2832, t1 = (k + 1) / sides * 6.2832;
        const i0 = this.v(B[0] + (a.x * Math.cos(t0) + b.x * Math.sin(t0)) * r1, B[1] + (a.y * Math.cos(t0) + b.y * Math.sin(t0)) * r1, B[2] + (a.z * Math.cos(t0) + b.z * Math.sin(t0)) * r1, d.x, d.y, d.z);
        const i1 = this.v(B[0] + (a.x * Math.cos(t1) + b.x * Math.sin(t1)) * r1, B[1] + (a.y * Math.cos(t1) + b.y * Math.sin(t1)) * r1, B[2] + (a.z * Math.cos(t1) + b.z * Math.sin(t1)) * r1, d.x, d.y, d.z);
        this.i.push(c0, i0, i1);
      }
    }
    return this;
  }
  lathe(profile, sides = 24, cx = 0, cz = 0) {
    const base = this.nv, n = profile.length;
    for (let j = 0; j < n; j++) {
      const [r, y] = profile[j];
      const p0 = profile[Math.max(0, j - 1)], p1 = profile[Math.min(n - 1, j + 1)];
      let dr = p1[0] - p0[0], dy = p1[1] - p0[1]; const l = Math.hypot(dr, dy) || 1; const nr = dy / l, ny = -dr / l;
      for (let k = 0; k <= sides; k++) { const t = k / sides * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); this.v(cx + c * r, y, cz + s * r, c * nr, ny, s * nr); }
    }
    for (let j = 0; j < n - 1; j++) for (let k = 0; k < sides; k++) { const a = base + j * (sides + 1) + k, b = a + sides + 1; this.i.push(a, b, a + 1, a + 1, b, b + 1); }
    return this;
  }
  sphere(cx, cy, cz, r, sides = 20, rings = 12) {
    const prof = []; for (let j = 0; j <= rings; j++) { const t = -Math.PI / 2 + j / rings * Math.PI; prof.push([Math.cos(t) * r, cy + Math.sin(t) * r]); }
    return this.lathe(prof, sides, cx, cz);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(this.m), 4));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.i), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
