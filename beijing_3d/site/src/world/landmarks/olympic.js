// Olympic Green and other contemporary icons.
import { Kit, MAT } from '../landmarkKit.js';

// Skin a grid of points with smooth normals. rows[k][i] = [x, y, z]; every row is closed and runs counter-clockwise
// seen from above; rows follow each other up a wall (or inwards across a roof). uv(k, i) gives the texture
// coordinates in metres, i = 0..n with n the seam. (kit.loft only takes level rings and measures u along each ring.)
function skin(kit, rows, uv) {
  const K = rows.length, n = rows[0].length, w = n + 1;
  const i0 = kit.n;
  for (let k = 0; k < K; k++) {
    const R = rows[k], Rm = rows[Math.max(0, k - 1)], Rp = rows[Math.min(K - 1, k + 1)];
    for (let i = 0; i <= n; i++) {
      const p = R[i % n], a = R[(i + n - 1) % n], b = R[(i + 1) % n], c = Rm[i % n], d = Rp[i % n];
      const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const sx = d[0] - c[0], sy = d[1] - c[1], sz = d[2] - c[2];
      const [u, v] = uv(k, i);
      kit.vert(p[0], p[1], p[2], ty * sz - tz * sy, tz * sx - tx * sz, tx * sy - ty * sx, u, v);
    }
  }
  for (let k = 0; k < K - 1; k++) for (let i = 0; i < n; i++) {
    const a = i0 + k * w + i, b = a + w;
    kit.tri(a, a + 1, b + 1); kit.tri(a, b + 1, b);
  }
}

// Length along each column of a grid of points, for the v coordinate.
function columnLengths(rows) {
  const v = [rows[0].map(() => 0)];
  for (let k = 1; k < rows.length; k++) v.push(rows[k].map((p, i) => { const q = rows[k - 1][i]; return v[k - 1][i] + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
  return v;
}

// Surface of revolution whose texture wraps a fixed circumference (kit.lathe maps u = radius x angle, which shears a
// window grid wherever the profile flares). profile: [[radius, y], ...] bottom to top.
function revolve(kit, profile, seg, around) {
  const rows = profile.map(([r, y]) => Array.from({ length: seg }, (_, i) => { const a = (i / seg) * 2 * Math.PI; return [r * Math.cos(a), y, -r * Math.sin(a)]; }));
  const vl = [0];
  for (let j = 1; j < profile.length; j++) vl.push(vl[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  skin(kit, rows, (k, i) => [(i / seg) * around, vl[k]]);
}

// Olympic Tower: five slender shafts of 186 - 246.8 m, each opening into a flat disc like a nail head.
function olympictower(kit, L) {
  kit.at(L.olympictower, () => {
    // shaft centres (x east, z south of the footprint centre), heights and radii from the OSM building:part outlines
    const towers = [
      { x: 0.3, z: 0.5, h: 246.8, r: 7.6, R: 25.8 },
      { x: 12.4, z: 15.2, h: 231, r: 4.9, R: 15.7 },      // south-east
      { x: 12.2, z: -13.1, h: 216, r: 4.9, R: 15.7 },     // north-east
      { x: -13.5, z: -12.0, h: 201, r: 4.9, R: 15.7 },    // north-west
      { x: -12.4, z: 15.7, h: 186, r: 4.9, R: 15.7 },     // south-west
    ];
    const WHITE = '#e6e8ea', GLASS = '#8fa9bd';
    for (const T of towers) {
      const main = T.R > 20;
      const d = main ? 4.4 : 2.8;                  // glazed rim of the disc
      const F = 0.75 * T.R, y0 = T.h - d - F;      // the flare below it
      kit.save(); kit.move(T.x, 0, T.z);
      kit.paint(WHITE, MAT.metal, { flood: 0.3 });
      kit.lathe([[T.r * 1.12, 0], [T.r, 9], [T.r, y0]], { seg: main ? 32 : 24 });
      // flare: glass between steel branches
      const prof = [];
      for (let j = 0; j <= 8; j++) { const s = j / 8; prof.push([T.r + (T.R - T.r) * s ** 2.2, y0 + F * s]); }
      kit.paint(GLASS, MAT.glass, { p0: 3.2, p1: 0.9 });
      revolve(kit, prof, 48, 2 * Math.PI * T.R);
      kit.paint(WHITE, MAT.metal, { flood: 0.3 });
      const ribs = main ? 32 : 20, half = (360 / ribs) * 0.2;
      for (let k = 0; k < ribs; k++) { const a = (k + 0.5) * 360 / ribs; kit.lathe(prof.map(([r, y]) => [r + 0.25, y]), { seg: 1, arc: [a - half, a + half] }); }
      // disc: light ring, glazed deck, parapet
      kit.paint('#eaf3ff', MAT.glow, { p0: 2 });
      kit.lathe([[T.R + 0.2, T.h - d - 0.5], [T.R + 0.2, T.h - d + 0.2]], { seg: 48 });
      kit.paint(GLASS, MAT.glass, { p0: d - 0.9, p1: 0.9 });
      kit.lathe([[T.R, T.h - d], [T.R, T.h - 0.9]], { seg: 48 });
      kit.paint(WHITE, MAT.metal);
      kit.lathe([[T.R + 0.35, T.h - 0.9], [T.R + 0.35, T.h]], { seg: 48, capTop: true, capBottom: true });
      if (main) {
        // roof-top hall of the tallest tower
        kit.paint(GLASS, MAT.glass, { p0: 3.4, p1: 0.9 });
        kit.lathe([[9.6, T.h], [9.6, T.h + 6.8]], { seg: 32 });
        kit.paint(WHITE, MAT.metal);
        kit.lathe([[10.1, T.h + 6.8], [10.1, T.h + 7.5]], { seg: 32, capTop: true });
        kit.paint('#eaf3ff', MAT.glow, { p0: 2 });
        kit.lathe([[10.2, T.h + 6.4], [10.2, T.h + 6.8]], { seg: 32 });
      }
      kit.restore();
    }
    // the two link bridges between the main shaft and the south-east tower (178 m and 214 m)
    const A = towers[0], B = towers[1];
    const dx = B.x - A.x, dz = B.z - A.z, gap = Math.hypot(dx, dz);
    const mid = (A.r + gap - B.r) / 2 / gap;
    kit.paint(WHITE, MAT.metal);
    for (const y of [178, 214]) {
      kit.save();
      kit.move(A.x + dx * mid, y, A.z + dz * mid);
      kit.turn(Math.atan2(-dz, dx) * 180 / Math.PI);
      kit.box(gap - A.r - B.r + 1.6, 3, 3.2, 0, { bottom: true });
      kit.restore();
    }
    kit.mark('奥林匹克塔', 246.8 + 24, { rank: 2 });
  }, { angle: 0 });
}

// National Stadium "Bird's Nest": a saddle-shaped steel basket around a red seating bowl.
function birdsnest(kit, L) {
  kit.at(L.birdsnest, (lm) => {
    const a = lm.hl, b = lm.hw;           // rim half-axes (long axis along x)
    const ai = 92.5, bi = 63.5;           // roof opening, 185 m x 127 m
    const af = 98, bf = 62;               // arena floor
    const N = 96;
    // unit outline: a slightly squared ellipse, counter-clockwise from above
    const dir = [];
    for (let i = 0; i < N; i++) {
      const f = (i / N) * 2 * Math.PI, c = Math.cos(f), s = Math.sin(f);
      dir.push([Math.sign(c) * Math.abs(c) ** (2 / 2.15), -Math.sign(s) * Math.abs(s) ** (2 / 2.15)]);
    }
    // the roof is a saddle: 42 m at the two ends of the long axis, 69 m at the middle of the long sides
    const roofY = (x, z) => 52 - 10 * (x / a) ** 2 + 17 * (z / b) ** 2;
    const rimY = dir.map(([cx, sz]) => roofY(a * cx, b * sz));
    const rows = [];
    // wall: leans out from a footprint 8% smaller than the rim and rolls over a rounded shoulder
    for (const [s, f] of [[0.92, 0], [0.943, 0.3], [0.966, 0.6], [0.986, 0.84], [0.998, 0.95]]) rows.push(dir.map(([cx, sz], i) => [a * s * cx, f * rimY[i], b * s * sz]));
    // roof: from the rim in to the opening, then the inner fascia of the trusses
    for (const t of [0, 0.12, 0.38, 0.68, 1]) {
      rows.push(dir.map(([cx, sz]) => { const x = (0.992 * a + (ai - 0.992 * a) * t) * cx, z = (0.992 * b + (bi - 0.992 * b) * t) * sz; return [x, roofY(x, z), z]; }));
    }
    rows.push(dir.map(([cx, sz]) => [ai * cx, roofY(ai * cx, bi * sz) - 9, bi * sz]));
    const vl = columnLengths(rows);
    // texture at half scale: the woven members read bolder, and 504 m closes the two main member families at the seam
    kit.paint('#b9bcc0', MAT.lattice, { p0: 1 });
    skin(kit, rows, (k, i) => [(i / N) * 504, vl[k][i % N] * 0.5]);
    // seating bowl under the roof, falling to the arena floor
    const bowl = [];
    for (const [t, f] of [[1, 1], [0.66, 0.56], [0.32, 0.21], [0, 0]]) {
      bowl.push(dir.map(([cx, sz], i) => [(af + (0.82 * a - af) * t) * cx, 1.2 + (0.62 * rimY[i] - 1.2) * f, (bf + (0.82 * b - bf) * t) * sz]));
    }
    kit.paint('#8c2a24', MAT.matte, { flood: 0.5 });
    skin(kit, bowl, (k, i) => [i, k]);
    // arena floor, running track, infield and the striped pitch
    kit.paint('#9a948a', MAT.matte, { flood: 0.5 });
    kit.prism(dir.map(([cx, sz]) => [af * cx, bf * sz]), 0, 1.2);
    kit.paint('#b24a3a', MAT.matte, { flood: 0.5 });
    kit.prism(Kit.roundRect(176.9, 92.6, 46.2, 10), 1.2, 1.4);
    kit.paint('#3f7d3a', MAT.matte, { flood: 0.5 });
    kit.prism(Kit.roundRect(157.4, 73.1, 36.45, 10), 1.4, 1.55);
    for (let k = 0; k < 10; k++) {
      kit.paint(k % 2 ? '#4c9144' : '#418039', MAT.matte, { flood: 0.6 });
      kit.box(10.5, 0.1, 68, 1.55, { cx: (k - 4.5) * 10.5 });
    }
    kit.mark('鸟巢', 69 + 18, { rank: 1 });
  });
}

// National Aquatics Centre "Water Cube": a 177 m square box, 31 m high, wrapped in ETFE cushions.
function watercube(kit, L) {
  kit.at(L.watercube, () => {
    kit.paint('#9fc3de', MAT.bubble, { p0: 1 });
    kit.box(177, 31, 177);
    kit.mark('水立方', 31 + 16, { rank: 1 });
  });
}

export const LANDMARKS = { olympictower, birdsnest, watercube };
