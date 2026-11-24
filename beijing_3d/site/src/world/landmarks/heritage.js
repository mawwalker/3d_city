// Gates, towers, pagodas and garden landmarks outside the Forbidden City.
//
// Heights follow the published figures; plan sizes come from the real footprints (data/landmarks.json).
// Local frames: +x east, +z south (see site()).

import { Kit, MAT } from '../landmarkKit.js';

const YELLOW = '#dba02b';      // imperial glazed tile
const GREEN = '#3d7b56';       // green glazed tile
const BLUE = '#24418a';        // blue glazed tile
const GREY = '#6c6c6f';        // grey tile
const RED = '#a3352a';         // palace timber
const WALL_RED = '#9a3027';    // plastered masonry
const BRICK = '#8a847b';       // city-wall brick
const STONE = '#dcd7cb';       // white marble
const GOLD = '#d9a520';
const DARK = '#1c1512';        // gateways, arrow windows
const DECK = '#6b2a22';        // balcony railings
const GRANITE = '#d3cdbf';     // pale granite

// ------------------------------------------------------------------ helpers

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rect = (hx, hz, cx = 0, cz = 0) => [[cx - hx, cz + hz], [cx + hx, cz + hz], [cx + hx, cz - hz], [cx - hx, cz - hz]];     // SW, SE, NE, NW
const shade = (hex, k) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');

// Local frame of a landmark with +x east-ish and +z south-ish, whichever way the footprint's long axis runs.
// fn gets the record plus ex / ez: the half extents of the footprint along local x and z.
function site(kit, lm, fn, angle) {
  let a = angle ?? lm.angle ?? 0, ex = lm.hl, ez = lm.hw;
  if (angle === undefined) {
    if (a > 45) { a -= 90; [ex, ez] = [ez, ex]; } else if (a < -45) { a += 90; [ex, ez] = [ez, ex]; }
  }
  kit.at(lm, () => fn({ ...lm, ex, ez }), { angle: a });
}

// Offset a plan ring (ccw from above) outwards by d (inwards when negative), with mitred corners.
function offsetRing(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    let n1x = -(p[1] - a[1]), n1z = p[0] - a[0], n2x = -(b[1] - p[1]), n2z = b[0] - p[0];
    const l1 = Math.hypot(n1x, n1z) || 1, l2 = Math.hypot(n2x, n2z) || 1;
    n1x /= l1; n1z /= l1; n2x /= l2; n2z /= l2;
    const k = d / (1 + n1x * n2x + n1z * n2z);
    return [p[0] + (n1x + n2x) * k, p[1] + (n1z + n2z) * k];
  });
}

// Rectangle with its four corners notched in (the "begonia" plan of imperial terraces and sumeru bases). ccw from above.
const notched = (a, b, nx, nz = nx) => [[-a + nx, b], [a - nx, b], [a - nx, b - nz], [a, b - nz], [a, -b + nz], [a - nx, -b + nz], [a - nx, -b], [-a + nx, -b], [-a + nx, -b + nz], [-a, -b + nz], [-a, b - nz], [-a + nx, b - nz]];

// A (possibly battered) wall as a drawing surface. Corners as seen from outside: bottom-left, bottom-right, top-right, top-left.
// Returns P(u, v, d): the point u metres right of the wall's centre line, v metres above its foot and d metres proud of it.
function wallFace(bl, br, tr, tl) {
  const ux = br[0] - bl[0], uy = br[1] - bl[1], uz = br[2] - bl[2], vx = tl[0] - bl[0], vy = tl[1] - bl[1], vz = tl[2] - bl[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const H = tl[1] - bl[1];
  const P = (u, v, d = 0.14) => {
    const t = v / H, a = lerp3(bl, tl, t), b = lerp3(br, tr, t);
    const w = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    const p = lerp3(a, b, 0.5 + u / w);
    return [p[0] + nx * d, p[1] + ny * d, p[2] + nz * d];
  };
  P.width = Math.hypot(ux, uz); P.height = H;
  return P;
}

// Tapered box (kit.box) that also hands back its four wall surfaces { S, E, N, W } for gateways and windows.
function block(kit, L, H, W, y0 = 0, opts = {}) {
  kit.box(L, H, W, y0, opts);
  const t = opts.taper ?? 1, tx = Array.isArray(t) ? t[0] : t, tz = Array.isArray(t) ? t[1] : t;
  const { cx = 0, cz = 0 } = opts, x = L / 2, z = W / 2, y1 = y0 + H;
  const b = [[cx - x, y0, cz + z], [cx + x, y0, cz + z], [cx + x, y0, cz - z], [cx - x, y0, cz - z]];
  const tp = [[cx - x * tx, y1, cz + z * tz], [cx + x * tx, y1, cz + z * tz], [cx + x * tx, y1, cz - z * tz], [cx - x * tx, y1, cz - z * tz]];
  const f = (i) => wallFace(b[i], b[(i + 1) % 4], tp[(i + 1) % 4], tp[i]);
  return { S: f(0), E: f(1), N: f(2), W: f(3) };
}

// Side of a regular n-gon tower as a drawing surface. facing: 0 = +x (east), 90 = north, 180 = west, 270 = south.
function ngonFace(n, r0, r1, y0, y1, facing) {
  const h = Math.PI / n, t = facing * Math.PI / 180;
  const p = (r, a, y) => [r * Math.cos(a), y, -r * Math.sin(a)];
  return wallFace(p(r0, t - h, y0), p(r0, t + h, y0), p(r1, t + h, y1), p(r1, t - h, y1));
}

// Round-headed opening drawn on a wall surface: a surround with the dark void inside it.
function arch(kit, P, u, w, h, { v0 = 0, surround = STONE, rim = 0.5, d = 0.16 } = {}) {
  const shape = (w, h, d) => {
    const r = w / 2, pts = [P(u - r, v0, d), P(u + r, v0, d)];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push(P(u + r * Math.cos(a), v0 + h - r + r * Math.sin(a), d)); }
    return pts;
  };
  if (surround) { kit.paint(surround, MAT.matte); kit.face(shape(w + 2 * rim, h + rim, d * 0.5)); }
  kit.paint(DARK, MAT.matte); kit.face(shape(w, h, d));
}

// Rows of small dark windows on a wall surface: cols per row spread over span metres, one row per entry of vs (sill heights).
function windows(kit, P, cols, span, vs, { w = 0.95, h = 1.35, hood = null } = {}) {
  const q = (u0, u1, v0, v1, d) => kit.face([P(u0, v0, d), P(u1, v0, d), P(u1, v1, d), P(u0, v1, d)]);
  kit.paint(DARK, MAT.matte);
  for (const v of vs) for (let i = 0; i < cols; i++) { const u = cols > 1 ? (i / (cols - 1) - 0.5) * span : 0; q(u - w / 2, u + w / 2, v, v + h, 0.12); }
  if (!hood) return;
  kit.paint(hood, MAT.matte);
  for (const v of vs) for (let i = 0; i < cols; i++) { const u = cols > 1 ? (i / (cols - 1) - 0.5) * span : 0; q(u - w * 0.85, u + w * 0.85, v + h + 0.05, v + h + 0.45, 0.2); }
}

// Marble balustrade as a thin wall around an L x W rectangle at height y; gaps { S, E, N, W } (metres, centred) leave room for stairs.
function balustrade(kit, L, W, y, { h = 1.1, gaps = {}, col = STONE, cx = 0, cz = 0 } = {}) {
  kit.paint(col, MAT.marble, { p0: h });
  const c = rect(L / 2, W / 2, cx, cz);
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], len = i % 2 ? W : L, g = gaps['SENW'[i]] || 0;
    const seg = (s0, s1) => {
      const p = [a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0], q = [a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1];
      kit.face([[p[0], y, p[1]], [q[0], y, q[1]], [q[0], y + h, q[1]], [p[0], y + h, p[1]]], [[s0 * len, 0], [s1 * len, 0], [s1 * len, h], [s0 * len, h]]);
    };
    if (g > 0) { seg(0, 0.5 - g / len / 2); seg(0.5 + g / len / 2, 1); } else seg(0, 1);
  }
}

// Crenellated brick parapet on the chosen sides ('SENW') of an L x W rectangle at height y.
function battlements(kit, L, W, y, { sides = 'SENW', h = 1.0, mh = 0.8, pitch = 2.6, col = BRICK, cx = 0, cz = 0 } = {}) {
  kit.paint(col, MAT.brick);
  const t = 0.6;
  const run = (len, place) => {
    place(len, h, 0, y);
    const n = Math.max(2, Math.round(len / pitch));
    for (let i = 0; i < n; i++) place((len / n) * 0.56, mh, ((i + 0.5) / n - 0.5) * len, y + h);
  };
  if (sides.includes('S')) run(L, (l, hh, o, yy) => kit.box(l, hh, t, yy, { cx: cx + o, cz: cz + W / 2 - t / 2 }));
  if (sides.includes('N')) run(L, (l, hh, o, yy) => kit.box(l, hh, t, yy, { cx: cx + o, cz: cz - W / 2 + t / 2 }));
  if (sides.includes('E')) run(W, (l, hh, o, yy) => kit.box(t, hh, l, yy, { cx: cx + L / 2 - t / 2, cz: cz + o }));
  if (sides.includes('W')) run(W, (l, hh, o, yy) => kit.box(t, hh, l, yy, { cx: cx - L / 2 + t / 2, cz: cz + o }));
}

// Flight of steps as a plain ramp: w wide, rising h over a run d; the top edge lies on the local x axis, the foot towards +z.
function steps(kit, w, h, d, y0 = 0) {
  const x = w / 2;
  kit.face([[-x, y0, d], [x, y0, d], [x, y0 + h, 0], [-x, y0 + h, 0]]);
  kit.face([[x, y0, d], [x, y0, 0], [x, y0 + h, 0]]);
  kit.face([[-x, y0, 0], [-x, y0, d], [-x, y0 + h, 0]]);
}

// The same flight placed on one side of a platform: dir 0 = south, 90 = east, 180 = north, 270 = west; dist = platform edge.
function stepsAt(kit, dir, dist, w, h, d, y0 = 0) {
  kit.save(); kit.turn(dir); kit.move(0, 0, dist); steps(kit, w, h, d, y0); kit.restore();
}

// A rib (ridge or hip beam) of w x h section riding on the line p -> q.
function rib(kit, p, q, w, h) {
  const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz);
  if (l < 1e-3) return;
  const rx = (-dz / l) * w / 2, rz = (dx / l) * w / 2;                 // to the right of the direction of travel
  const pr = [p[0] + rx, p[1], p[2] + rz], pl = [p[0] - rx, p[1], p[2] - rz], qr = [q[0] + rx, q[1], q[2] + rz], ql = [q[0] - rx, q[1], q[2] - rz];
  const up = (a) => [a[0], a[1] + h, a[2]];
  kit.face([pr, qr, up(qr), up(pr)]); kit.face([ql, pl, up(pl), up(ql)]);
  kit.face([up(pr), up(qr), up(ql), up(pl)]);
  kit.face([qr, ql, up(ql), up(qr)]); kit.face([pl, pr, up(pr), up(pl)]);
}

/**
 * One tier of tiled slope between an eave polygon and a smaller polygon above it (plan rings [[x, z], ...], same count, ccw).
 * The eave corners flick up by `up` (number or one per corner); `trim` paints a band of another glaze along the eave (剪边).
 */
function tier(kit, eave, top, eaveY, topY, { tile = GREY, trim = null, band = 0.3, up = 0 } = {}) {
  const n = eave.length, upAt = (i) => (Array.isArray(up) ? up[i] : up);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ea = [eave[i][0], eaveY + upAt(i), eave[i][1]], eb = [eave[j][0], eaveY + upAt(j), eave[j][1]];
    const em = [(eave[i][0] + eave[j][0]) / 2, eaveY, (eave[i][1] + eave[j][1]) / 2];
    const ma = [top[i][0], topY, top[i][1]], mb = [top[j][0], topY, top[j][1]];
    if (trim) {
      const a1 = lerp3(ea, ma, band), m1 = lerp3(em, ma, band), m2 = lerp3(em, mb, band), b1 = lerp3(eb, mb, band);
      kit.paint(trim, MAT.tile);
      kit.face([ea, em, m1, a1]); kit.face([em, m2, m1]); kit.face([em, eb, b1, m2]);
      kit.paint(tile, MAT.tile);
      kit.face([a1, m1, ma]); kit.face([m1, m2, mb, ma]); kit.face([m2, b1, mb]);
    } else {
      kit.paint(tile, MAT.tile);
      kit.face([ea, em, ma]); kit.face([em, mb, ma]); kit.face([em, eb, mb]);
    }
  }
}

/**
 * Chinese roof over an L x W plan with the ridge along x: the same sagging, corner-flicked form as kit.roof, plus an optional
 * glazed edging band (trim), hip and ridge ribs, and three forms: 'hip' (庑殿), 'gable' (歇山) and 'pyramid' (攒尖).
 * Returns the height of the top of the roof.
 */
function roofX(kit, L, W, eaveY, rise, o = {}) {
  const { tile = GREY, trim = null, form = 'hip', sag = 0.34, band = 0.3, gable = WALL_RED } = o;
  const overhang = o.overhang ?? Math.min(3.2, Math.max(0.5, W * 0.13));
  const hl = L / 2 + overhang, hw = W / 2 + overhang;
  const up = o.upturn ?? Math.min(1.3, Math.max(0.25, hw * 0.075));
  const d1 = hw * 0.52, ml = hl - d1, mw = hw - d1;
  const y1 = eaveY + rise * sag, y2 = eaveY + rise;
  const lr = form === 'pyramid' ? 0 : form === 'gable' ? ml : Math.max(0, hl - hw * (o.ridge ?? 0.9));
  const E = rect(hl, hw), M = rect(ml, mw);
  tier(kit, E, M, eaveY, y1, { tile, trim, band, up });
  const e3 = E.map((p) => [p[0], eaveY + up, p[1]]), m3 = M.map((p) => [p[0], y1, p[1]]);
  const ends = [[-lr, y2, 0], [lr, y2, 0], [lr, y2, 0], [-lr, y2, 0]];            // ridge end above each corner (SW, SE, NE, NW)
  kit.paint(tile, MAT.tile);
  if (lr > 0.3) {
    kit.face([m3[0], m3[1], ends[1], ends[0]]); kit.face([m3[2], m3[3], ends[3], ends[2]]);
    if (form === 'gable') kit.paint(gable, MAT.matte);
    kit.face([m3[1], m3[2], ends[1]]); kit.face([m3[3], m3[0], ends[0]]);
  } else for (let i = 0; i < 4; i++) kit.face([m3[i], m3[(i + 1) % 4], ends[0]]);
  // ribs along the hips and the ridge, in the edging glaze
  const s = Math.min(0.62, Math.max(0.26, hw * 0.05));
  kit.paint(trim ?? shade(tile, 0.84), MAT.tile);
  for (let i = 0; i < 4; i++) { rib(kit, e3[i], m3[i], s, s); rib(kit, m3[i], ends[i], s, s); }
  if (lr > 0.3) {
    kit.box(2 * lr + s, s * 1.5, s * 1.1, y2 - 0.1);
    for (const sx of [-1, 1]) kit.box(s * 1.3, s * 3.0, s * 1.1, y2 - 0.1, { cx: sx * lr });           // ridge-end ornaments
    return y2 + s * 2.9;
  }
  return y2;
}

/** Skirt roof (the lower eave of a multi-eave building) with the same options as roofX. */
function skirtX(kit, L, W, eaveY, rise, o = {}) {
  const { tile = GREY, trim = null, band = 0.34 } = o;
  const overhang = o.overhang ?? Math.min(3.2, Math.max(0.5, W * 0.13)), inset = o.inset ?? W * 0.16;
  const hl = L / 2 + overhang, hw = W / 2 + overhang;
  const up = o.upturn ?? Math.min(1.2, Math.max(0.2, hw * 0.07));
  const E = rect(hl, hw), M = rect(L / 2 - inset, W / 2 - inset);
  tier(kit, E, M, eaveY, eaveY + rise, { tile, trim, band, up });
  const s = Math.min(0.55, Math.max(0.24, hw * 0.045));
  kit.paint(trim ?? shade(tile, 0.84), MAT.tile);
  for (let i = 0; i < 4; i++) rib(kit, [E[i][0], eaveY + up, E[i][1]], [M[i][0], eaveY + rise, M[i][1]], s, s);
}

// Timber-framed storey: four walls with a whole number of bays on every side, so that the column rhythm is symmetrical.
function timberBox(kit, L, h, W, y, col = RED) {
  kit.paint(col, MAT.timber, { p0: h });
  const c = rect(L / 2, W / 2);
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], u = Math.max(1, Math.round((i % 2 ? W : L) / 4.4)) * 4.4;
    kit.face([[a[0], y, a[1]], [b[0], y, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]]], [[0, 0], [u, 0], [u, h], [0, h]]);
  }
}

/**
 * Stacked timber storeys under Chinese roofs: every storey is a wall box; all but the last carry a skirt eave that climbs to the
 * (smaller) storey above, the last one carries the main roof. Returns the height of the top of the roof.
 * storeys: [{ h, inset (plan shrink above this storey), rise (of its eave), overhang, deck (height of a balcony at its foot), col }]
 */
function tiers(kit, y, L, W, storeys, roof) {
  storeys.forEach((s, i) => {
    if (s.deck) { kit.paint(DECK, MAT.matte); kit.box(L + 2 * (s.deckOut ?? 0.9), s.deck + 0.6, W + 2 * (s.deckOut ?? 0.9), y - 0.6); }
    timberBox(kit, L, s.h, W, y, s.col);
    y += s.h;
    if (i < storeys.length - 1) {
      skirtX(kit, L, W, y - 0.15, s.rise, { tile: roof.tile, trim: roof.trim, overhang: s.overhang, inset: s.inset });
      y += s.rise - 0.2; L -= 2 * s.inset; W -= 2 * s.inset;
    }
  });
  return roofX(kit, L, W, y - 0.15, roof.rise, roof);
}

// Gilded finial (宝顶) of size s standing at height y.
function finial(kit, y, s, col = GOLD) {
  kit.paint(col, MAT.metal);
  kit.lathe([[s * 0.55, y - 0.4 * s], [s * 0.62, y + 0.25 * s], [s * 0.3, y + 0.6 * s], [s, y + 1.3 * s], [s * 1.12, y + 2.0 * s], [s * 0.7, y + 2.9 * s], [s * 0.16, y + 3.7 * s], [0.02, y + 4.4 * s]], { seg: 12 });
  return y + 4.4 * s;
}

// Walls of a regular polygon in the timber material, each side a whole number of bays so that columns stand on the corners.
function polyWall(kit, n, r, y, h, { rot = 0, col = RED, mat = MAT.timber, bays } = {}) {
  const pts = Kit.ngon(n, r, rot), nb = bays ?? Math.max(1, Math.round(2 * r * Math.sin(Math.PI / n) / 4.4));
  kit.paint(col, mat, { p0: h });
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    kit.face([[a[0], y, a[1]], [b[0], y, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]]], [[0, 0], [nb * 4.4, 0], [nb * 4.4, h], [0, h]]);
  }
}

// Skirt eave on a regular polygon: from the eave (corner radius r) up to the wall above (corner radius ri).
function polySkirt(kit, n, r, ri, eaveY, rise, o = {}) {
  const { rot = 0, tile = GREY, trim = null, band = 0.34, up = Math.min(0.8, r * 0.06) } = o;
  const E = Kit.ngon(n, r, rot), M = Kit.ngon(n, ri, rot);
  tier(kit, E, M, eaveY, eaveY + rise, { tile, trim, band, up });
  const s = Math.min(0.5, Math.max(0.2, r * 0.035));
  kit.paint(trim ?? shade(tile, 0.84), MAT.tile);
  for (let i = 0; i < n; i++) rib(kit, [E[i][0], eaveY + up, E[i][1]], [M[i][0], eaveY + rise, M[i][1]], s, s);
}

// Tented roof on a regular polygon (octagonal pavilions and towers): sagging slopes, flicked corners, ribs on the hips.
function polyRoof(kit, n, r, eaveY, rise, o = {}) {
  const { rot = 0, tile = GREY, trim = null, sag = 0.32, band = 0.3, up = Math.min(0.9, r * 0.07), topR = 0 } = o;
  const E = Kit.ngon(n, r, rot), M = Kit.ngon(n, r * 0.5, rot), T = Kit.ngon(n, topR, rot);
  const y1 = eaveY + rise * sag, y2 = eaveY + rise;
  tier(kit, E, M, eaveY, y1, { tile, trim, band, up });
  kit.paint(tile, MAT.tile);
  for (let i = 0; i < n; i++) {
    const a = M[i], b = M[(i + 1) % n], c = T[(i + 1) % n], d = T[i];
    if (topR > 0.05) kit.face([[a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y2, c[1]], [d[0], y2, d[1]]]);
    else kit.face([[a[0], y1, a[1]], [b[0], y1, b[1]], [0, y2, 0]]);
  }
  const s = Math.min(0.5, Math.max(0.2, r * 0.04));
  kit.paint(trim ?? shade(tile, 0.84), MAT.tile);
  for (let i = 0; i < n; i++) { rib(kit, [E[i][0], eaveY + up, E[i][1]], [M[i][0], y1, M[i][1]], s, s); rib(kit, [M[i][0], y1, M[i][1]], [T[i][0], y2, T[i][1]], s, s); }
  return y2;
}

// ------------------------------------------------------------------ Jingshan: the five pavilions on the ridge

// A double-eave garden pavilion on a regular polygon (n = 8) or a circle (n = 0); R = eave radius, H = overall height.
function pavilion(kit, { n, R, H, tile, trim }) {
  const round = !n, seg = round ? 32 : n, rot = round ? 0 : 180 / n;
  const ring = (r, y0, y1, o) => kit.lathe([[r, y0], [r, y1]], { seg, smooth: round, arc: [rot, rot + 360], ...o });
  kit.paint('#8a8576', MAT.matte); kit.lathe([[R * 1.12, -6], [R * 1.0, 0.1]], { seg, smooth: round, arc: [rot, rot + 360] });   // footing down the slope
  kit.paint(STONE, MAT.marble, { p0: 0.9 }); ring(R * 0.98, 0, 0.9, { capTop: true });
  const h1 = 0.30 * H, r1 = R * 0.74, r2 = R * 0.50, e1 = 0.9 + h1 - 0.15, s1 = 0.11 * H;
  const h2 = 0.13 * H, y2 = e1 + s1 - 0.05, e2 = y2 + h2 - 0.12, s2 = 0.30 * H;
  if (round) {
    kit.paint(RED, MAT.timber, { p0: h1 }); ring(r1, 0.9, 0.9 + h1);
    kit.paint(trim, MAT.tile); kit.lathe([[R, e1], [R * 0.87, e1 + s1 * 0.22]], { seg });
    kit.paint(tile, MAT.tile); kit.lathe([[R * 0.87, e1 + s1 * 0.22], [R * 0.68, e1 + s1 * 0.62], [r2, e1 + s1]], { seg });
    kit.paint(RED, MAT.timber, { p0: h2 }); ring(r2 * 0.97, y2, y2 + h2);
    const r3 = R * 0.72;
    kit.paint(trim, MAT.tile); kit.lathe([[r3, e2], [r3 * 0.85, e2 + s2 * 0.1]], { seg });
    kit.paint(tile, MAT.tile); kit.lathe([[r3 * 0.85, e2 + s2 * 0.1], [r3 * 0.56, e2 + s2 * 0.3], [r3 * 0.24, e2 + s2 * 0.68], [0.3, e2 + s2]], { seg });
  } else {
    polyWall(kit, n, r1, 0.9, h1, { rot, bays: 1 });
    polySkirt(kit, n, R, r2, e1, s1, { rot, tile, trim });
    polyWall(kit, n, r2 * 0.97, y2, h2, { rot, bays: 1 });
    polyRoof(kit, n, R * 0.72, e2, s2, { rot, tile, trim });
  }
  return finial(kit, e2 + s2, 0.026 * H);
}

function jingshan(kit, L) {
  // 万春亭: square, triple eaves, pyramidal roof, 17.4 m; yellow tile with green edging
  site(kit, L.wanchunting, (lm) => {
    kit.flood(0.8);
    const S = Math.max(2 * lm.hl, 14);
    kit.paint(STONE, MAT.marble, { p0: 6.4 }); kit.box(S + 5, 6.4, S + 5, -5);
    const y = tiers(kit, 1.4, S, S, [{ h: 4.4, inset: 1.9, rise: 1.5, overhang: 1.9 }, { h: 2.0, inset: 1.6, rise: 1.4, overhang: 1.8 }, { h: 1.9 }],
      { tile: YELLOW, trim: GREEN, form: 'pyramid', rise: 4.8, overhang: 1.7 });
    const top = finial(kit, y, 0.42);
    kit.mark(lm.name, top + 6, { rank: 2 });
  });
  // the flanking pairs: octagonal with green tile (inner), round with blue tile (outer)
  for (const key of ['guanmiaoting', 'jifangting']) site(kit, L[key], () => { kit.flood(0.4); pavilion(kit, { n: 8, R: 6.0, H: 12, tile: GREEN, trim: YELLOW }); }, 0);
  for (const key of ['zhoushangting', 'fulanting']) site(kit, L[key], () => { kit.flood(0.4); pavilion(kit, { n: 0, R: 5.2, H: 11, tile: BLUE, trim: '#5d4a86' }); }, 0);
}

// ------------------------------------------------------------------ Drum Tower and Bell Tower

function gulou(kit, L) {
  site(kit, L.gulou, (lm) => {
    kit.flood(0.8);
    const BL = 2 * lm.ex, BW = 2 * lm.ez, BH = 4;                       // brick terrace, 53 x 35 m
    kit.paint(BRICK, MAT.brick); kit.box(BL, BH, BW, 0, { taper: [0.99, 0.985] });
    kit.paint('#b9b3a6', MAT.marble);
    for (const dir of [0, 180]) stepsAt(kit, dir, BW / 2 - 0.3, 16, BH, 7);
    balustrade(kit, BL * 0.99, BW * 0.985, BH, { h: 1.0, gaps: { S: 16, N: 16 }, col: '#b9b3a6' });
    // lower storey: red plastered masonry, three gateways north and south, one east and west
    const L1 = BL - 6.4, W1 = BW - 6.4, H1 = 15.2;
    kit.paint(WALL_RED, MAT.matte);
    const f = block(kit, L1, H1, W1, BH, { taper: [0.975, 0.96], top: false });
    for (const P of [f.S, f.N]) for (const u of [-13.5, 0, 13.5]) arch(kit, P, u, u ? 4.4 : 5.2, u ? 7.8 : 8.8, { surround: '#b4aca0', rim: 0.4 });
    for (const P of [f.E, f.W]) arch(kit, P, 0, 4.4, 7.8, { surround: '#b4aca0', rim: 0.4 });
    kit.paint('#a59e92', MAT.matte); kit.box(L1 + 0.5, 1.5, W1 + 0.5, BH, { top: false, taper: [0.998, 0.996] });      // stone plinth course
    // first eave, balcony, timber drum hall, double-eave hip-and-gable roof
    const La = L1 * 0.975, Wa = W1 * 0.96, y1 = BH + H1, roof = { tile: GREY, trim: GREEN, form: 'gable', rise: 9.4, overhang: 2.8 };
    skirtX(kit, La, Wa, y1 - 0.2, 2.2, { ...roof, overhang: 2.6, inset: 2.4 });
    const top = tiers(kit, y1 + 2.0, La - 4.8, Wa - 4.8, [{ h: 8.3, inset: 2.6, rise: 2.2, overhang: 2.8, deck: 1.2 }, { h: 2.6 }], roof);
    kit.mark(lm.name, top + 6, { rank: 1 });
  });
}

function zhonglou(kit, L) {
  site(kit, L.zhonglou, (lm) => {
    kit.flood(0.7);
    const TILE = '#2f4f41', GBRICK = '#8d8880';
    kit.paint('#aaa59a', MAT.marble, { p0: 1.4 }); kit.box(2 * lm.ex, 1.4, 2 * lm.ez);
    // base storey: a brick fortress with a vaulted gateway on each side
    const S1 = 2 * Math.min(lm.ex, lm.ez) - 1.8, H1 = 18.6, y1 = 1.4 + H1;
    kit.paint(GBRICK, MAT.brick);
    const f = block(kit, S1, H1, S1, 1.4, { taper: 0.94 });
    for (const P of [f.S, f.E, f.N, f.W]) arch(kit, P, 0, 6.0, 10.2, { rim: 0.7 });
    const S1t = S1 * 0.94;
    kit.paint('#c9c4b8', MAT.matte); kit.box(S1t + 0.9, 0.6, S1t + 0.9, y1 - 0.6, { top: false });                     // cornice
    balustrade(kit, S1t + 0.5, S1t + 0.5, y1, { h: 1.15 });
    // upper storey on a marble sumeru plinth
    const S2 = 20.4, H2 = 10.4, y2 = y1 + 1.8;
    kit.paint(STONE, MAT.marble, { p0: 1.8 }); kit.box(S2 + 2.4, 1.8, S2 + 2.4, y1);
    kit.paint(GBRICK, MAT.brick);
    const g = block(kit, S2, H2, S2, y2, { taper: 0.975, top: false });
    for (const P of [g.S, g.E, g.N, g.W]) {
      arch(kit, P, 0, 3.6, 6.6, { rim: 0.5 });
      for (const u of [-6.2, 6.2]) arch(kit, P, u, 2.0, 3.4, { v0: 2.2, rim: 0.4 });
    }
    // double-eave hip-and-gable roof in dark glazed tile with green edging
    const roof = { tile: TILE, trim: GREEN, form: 'gable', rise: 9.3, overhang: 2.5, gable: GBRICK };
    const S2t = S2 * 0.975, y3 = y2 + H2;
    skirtX(kit, S2t, S2t, y3 - 0.15, 2.2, { ...roof, overhang: 2.4, inset: 1.8 });
    const S3 = S2t - 3.6, y4 = y3 + 2.0;
    kit.paint(GBRICK, MAT.brick); kit.box(S3, 2.8, S3, y4, { top: false });
    const top = roofX(kit, S3, S3, y4 + 2.8 - 0.15, roof.rise, roof);
    kit.mark(lm.name, top + 6, { rank: 2 });
  });
}

// ------------------------------------------------------------------ city gates

function zhengyangmen(kit, L) {
  site(kit, L.zhengyangmen, (lm) => {
    kit.flood(0.9);
    // 城台: the footprint is only the tower's own plan; the brick base is 31.5 m deep and battered
    const BL = 2 * lm.ex, BW = 31.5, BH = 13.2, tz = 0.9, tx = 0.985;
    kit.paint(BRICK, MAT.brick);
    const f = block(kit, BL, BH, BW, 0, { taper: [tx, tz] });
    arch(kit, f.S, 0, 7.0, 9.6, { rim: 0.6 }); arch(kit, f.N, 0, 7.0, 9.6, { rim: 0.6 });
    battlements(kit, BL * tx, BW * tz, BH, { sides: 'SEW' });
    kit.paint(BRICK, MAT.brick); kit.box(BL * tx, 1.2, 0.6, BH, { cz: -BW * tz / 2 + 0.3 });
    // gate tower: two storeys, three eaves, grey tile edged in green
    kit.paint(STONE, MAT.marble, { p0: 0.8 }); kit.box(43, 0.8, 23, BH);
    const top = tiers(kit, BH + 0.8, 39.6, 19.8, [{ h: 7.2, inset: 1.2, rise: 2.0, overhang: 2.4 }, { h: 6.3, inset: 2.6, rise: 2.2, overhang: 2.5, deck: 1.3 }, { h: 2.3 }],
      { tile: GREY, trim: GREEN, form: 'gable', rise: 7.6, overhang: 2.6 });
    kit.mark(lm.name, top + 6, { rank: 1 });
  });
}

/**
 * Body of an archery tower (箭楼): a battered brick block with rows of arrow windows on the front (+z) and both ends, a skirt
 * eave three quarters of the way up, a hip-and-gable roof and a lower annex (抱厦) against the rear. Stands on y = 0, the main
 * block centred on the origin. Returns its height.
 */
function arrowTower(kit, { L, W, wallH, upperH, rise, cols, endCols, hood = null, annex }) {
  const tx = 0.985, tz = 0.955, roof = { tile: GREY, trim: GREEN, form: 'gable', rise, overhang: 2.1, gable: BRICK };
  kit.paint(BRICK, MAT.brick);
  const f = block(kit, L, wallH, W, 0, { taper: [tx, tz], top: false });
  const rows = [wallH * 0.13, wallH * 0.41, wallH * 0.69];
  windows(kit, f.S, cols, L * 0.86, rows, { hood });
  for (const P of [f.E, f.W]) windows(kit, P, endCols, W * 0.62, rows, { hood });
  const L1 = L * tx, W1 = W * tz;
  skirtX(kit, L1, W1, wallH - 0.15, 1.7, { ...roof, overhang: 1.9, inset: 1.3 });
  const L2 = L1 - 2.6, W2 = W1 - 2.6, y2 = wallH + 1.5;
  kit.paint(BRICK, MAT.brick);
  const g = block(kit, L2, upperH, W2, y2, { top: false });
  windows(kit, g.S, cols, L * 0.86, [upperH * 0.28], { hood });
  for (const P of [g.E, g.W]) windows(kit, P, endCols, W * 0.62, [upperH * 0.28], { hood });
  const top = roofX(kit, L2, W2, y2 + upperH - 0.15, rise, roof);
  if (annex) {
    const { L: aL, W: aW, H: aH, rise: aR } = annex, cz = -(W / 2 + aW / 2) + 0.4;
    kit.paint(BRICK, MAT.brick);
    const a = block(kit, aL, aH, aW, 0, { cz, top: false });
    kit.paint(RED, MAT.timber, { p0: aH * 0.72 });
    const u = aL * 0.36, v0 = 0.3, v1 = 0.3 + aH * 0.72, nb = Math.max(3, Math.round(2 * u / 4.4)) * 4.4;
    kit.face([a.N(-u, v0), a.N(u, v0), a.N(u, v1), a.N(-u, v1)], [[0, 0], [nb, 0], [nb, v1 - v0], [0, v1 - v0]]);
    kit.save(); kit.move(0, 0, cz);
    roofX(kit, aL, aW + 1.2, aH - 0.15, aR, { ...roof, rise: aR, overhang: 1.7 });
    kit.restore();
  }
  return top;
}

function jianlou(kit, L) {
  site(kit, L.jianlou, (lm) => {
    kit.flood(0.8);
    const BL = 2 * lm.ex, BW = 2 * lm.ez, BH = 12, tx = 0.96, tz = 0.93;
    kit.paint(BRICK, MAT.brick);
    const f = block(kit, BL, BH, BW, 0, { taper: [tx, tz] });
    arch(kit, f.S, 0, 6.6, 9.3, { rim: 0.6 }); arch(kit, f.N, 0, 6.6, 9.3, { rim: 0.6 });
    balustrade(kit, BL * tx, BW * tz, BH, { h: 1.15 });                 // the white balustrades of the 1915 remodelling
    kit.save(); kit.move(0, BH, BW * tz / 2 - 2.6 - 9);
    const top = arrowTower(kit, { L: 51, W: 18, wallH: 12.6, upperH: 3.2, rise: 5.5, cols: 13, endCols: 4, hood: STONE, annex: { L: 38, W: 10.5, H: 7.4, rise: 3.4 } });
    kit.restore();
    kit.mark(lm.name, BH + top + 5, { rank: 2 });
  });
}

function deshengmen(kit, L) {
  site(kit, L.deshengmen, (lm) => {
    kit.flood(0.7);
    // the tower faces north (out of the city); its base carried the barbican walls and has no gateway
    const BL = 2 * lm.ex + 14, BW = 2 * lm.ez + 12, BH = 12.6;
    kit.paint(BRICK, MAT.brick);
    kit.box(BL, BH, BW, 0, { cz: 2, taper: [0.95, 0.93] });
    battlements(kit, BL * 0.95, BW * 0.93, BH, { sides: 'NEW', cz: 2 });
    kit.paint(BRICK, MAT.brick); kit.box(BL * 0.95, 1.2, 0.6, BH, { cz: 2 + BW * 0.93 / 2 - 0.3 });
    kit.save(); kit.move(0, BH, -lm.ez + 5.5); kit.turn(180);
    const top = arrowTower(kit, { L: 2 * lm.ex, W: 11, wallH: 10.2, upperH: 2.7, rise: 4.2, cols: 12, endCols: 4, annex: { L: 2 * lm.ex - 4, W: 7.4, H: 6.2, rise: 2.8 } });
    kit.restore();
    kit.mark(lm.name, BH + top + 5, { rank: 2 });
  });
}

function yongdingmen(kit, L) {
  site(kit, L.yongdingmen, (lm) => {
    kit.flood(0.7);
    const BH = 8, PL = 29.6, PW = 2 * lm.ez, tx = 0.97, tz = 0.9;
    // stubs of the outer city wall either side of the gate platform
    kit.paint(BRICK, MAT.brick);
    kit.box(2 * lm.ex, 6.8, 10.4, 0, { cz: 0.8, taper: [1, 0.9] });
    battlements(kit, 2 * lm.ex, 10.4 * 0.9, 6.8, { sides: 'S', cz: 0.8, h: 0.8, mh: 0.7 });
    kit.paint(BRICK, MAT.brick); kit.box(2 * lm.ex, 0.9, 0.5, 6.8, { cz: 0.8 - 10.4 * 0.45 + 0.25 });
    const f = block(kit, PL, BH, PW, 0, { taper: [tx, tz] });
    arch(kit, f.S, 0, 5.4, 6.4, { rim: 0.5 }); arch(kit, f.N, 0, 5.4, 6.4, { rim: 0.5 });
    battlements(kit, PL * tx, PW * tz, BH, { sides: 'SEW', h: 0.9, mh: 0.7 });
    kit.paint(BRICK, MAT.brick); kit.box(PL * tx, 1.0, 0.5, BH, { cz: -PW * tz / 2 + 0.25 });
    kit.paint(STONE, MAT.marble, { p0: 0.5 }); kit.box(24.6, 0.5, 12.6, BH);
    const top = tiers(kit, BH + 0.5, 22.4, 10.4, [{ h: 4.3, inset: 0.8, rise: 1.3, overhang: 1.6 }, { h: 3.7, inset: 1.2, rise: 1.3, overhang: 1.6, deck: 0.8, deckOut: 0.6 }, { h: 1.4 }],
      { tile: GREY, trim: GREEN, form: 'gable', rise: 4.3, overhang: 1.7 });
    kit.mark(lm.name, top + 5, { rank: 2 });
  });
}

// South-east corner tower of the Inner City wall: an L-shaped archery tower on the corner bastion.
function dongnanjiaolou(kit, L) {
  kit.at(L.dongnanjiaolou, (lm) => {
    kit.flood(0.6);
    const X = lm.hl, Z = lm.hw, D = 12.4, BH = 14.8;
    // bastion (城台): it has to swallow the generic wall block of the same height that surrounds the tower
    const x0 = -21.5, x1 = 28, z0 = -24.5, z1 = 20, BL = x1 - x0, BW = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    kit.paint(BRICK, MAT.brick);
    kit.box(BL + 2.6, BH, BW + 2.6, 0, { cx, cz, taper: [BL / (BL + 2.6), BW / (BW + 2.6)] });
    battlements(kit, BL, BW, BH, { sides: 'SE', cx, cz });
    // tower body: two wings meeting at the outer (south-east) corner
    const ring = [[-X, Z], [X, Z], [X, -Z], [X - D, -Z], [X - D, Z - D], [-X, Z - D]];
    const wallH = 9.4, upperH = 2.5, y1 = BH + wallH;
    kit.paint(BRICK, MAT.brick); kit.prism(ring, BH, y1, { top: false });
    const faces = (y0, y1, i) => [
      [wallFace([-X + i, y0, Z - i], [X - i, y0, Z - i], [X - i, y1, Z - i], [-X + i, y1, Z - i]), 14, 2 * X * 0.86],                // south
      [wallFace([X - i, y0, Z - i], [X - i, y0, -Z + i], [X - i, y1, -Z + i], [X - i, y1, Z - i]), 14, 2 * Z * 0.86],                // east
      [wallFace([-X + i, y0, Z - D + i], [-X + i, y0, Z - i], [-X + i, y1, Z - i], [-X + i, y1, Z - D + i]), 4, (D - 2 * i) * 0.62],  // west end
      [wallFace([X - i, y0, -Z + i], [X - D + i, y0, -Z + i], [X - D + i, y1, -Z + i], [X - i, y1, -Z + i]), 4, (D - 2 * i) * 0.62],  // north end
    ];
    for (const [P, cols, span] of faces(BH, y1, 0)) windows(kit, P, cols, span, [wallH * 0.14, wallH * 0.42, wallH * 0.70], { w: 0.85, h: 1.2 });
    // lower eave following the L, then the upper wall and two crossing hip-and-gable roofs
    const roof = { tile: GREY, trim: GREEN, form: 'gable', rise: 3.9, overhang: 1.8, gable: BRICK };
    const eave = offsetRing(ring, 1.7), inner = offsetRing(ring, -1.2);
    tier(kit, eave, inner, y1 - 0.15, y1 + 1.5, { tile: GREY, trim: GREEN, band: 0.34, up: [0.5, 0.5, 0.5, 0.5, 0, 0.5] });
    kit.paint(GREEN, MAT.tile);
    for (let i = 0; i < 6; i++) rib(kit, [eave[i][0], y1 - 0.15 + (i === 4 ? 0 : 0.5), eave[i][1]], [inner[i][0], y1 + 1.5, inner[i][1]], 0.34, 0.34);
    const y2 = y1 + 1.35;
    kit.paint(BRICK, MAT.brick); kit.prism(inner, y2, y2 + upperH, { top: false });
    for (const [P, cols, span] of faces(y2, y2 + upperH, 1.2)) windows(kit, P, cols, span * 0.98, [upperH * 0.25], { w: 0.85, h: 1.2 });
    const ye = y2 + upperH - 0.15, Wr = D - 2.4;
    kit.save(); kit.move(0, 0, Z - D / 2); const top = roofX(kit, 2 * X - 2.4, Wr, ye, roof.rise, roof); kit.restore();
    kit.save(); kit.move(X - D / 2, 0, 0); kit.turn(90); roofX(kit, 2 * Z - 2.4, Wr, ye, roof.rise, roof); kit.restore();
    kit.mark(lm.name, top + 5, { rank: 2 });
  });
}

// ------------------------------------------------------------------ Tiananmen Square

function monument(kit, L) {
  site(kit, L.monument, (lm) => {
    kit.flood(0.8);
    // two balustraded terraces: the lower one "begonia"-shaped (50.4 x 61.5 m), the upper one square
    const a = lm.ex - 3.2, b = lm.ez - 4.25, h1 = 2.2, h2 = 1.8, U = 15.7;
    kit.paint(STONE, MAT.marble, { p0: h1 }); kit.prism(notched(a, b, 6, 5.5), 0, h1);
    kit.paint(STONE, MAT.marble, { p0: h2 }); kit.box(2 * U, h2, 2 * U, h1);
    kit.paint('#cfcabd', MAT.marble);
    stepsAt(kit, 0, b, 16, h1, lm.ez - b); stepsAt(kit, 180, b, 16, h1, lm.ez - b);
    stepsAt(kit, 90, a, 15, h1, lm.ex - a); stepsAt(kit, 270, a, 15, h1, lm.ex - a);
    for (const dir of [0, 90, 180, 270]) stepsAt(kit, dir, U, 12.5, h2, 5, h1);
    // stacked sumeru pedestals (the lower one carries the reliefs), then the shaft
    const sumeru = (hx, hz, y, h, waist) => {
      const k = [[1, 0], [1, 0.12], [0.93, 0.2], [waist, 0.3], [waist, 0.72], [0.93, 0.82], [1, 0.9], [1, 1]];
      kit.loft(k.map(([s, t]) => ({ y: y + t * h, pts: rect(hx * s, hz * s) })), { smooth: false });
    };
    let y = h1 + h2;
    kit.paint(GRANITE, MAT.marble); kit.box(15.2, 0.7, 14.6, y); y += 0.7;
    kit.paint('#e2ded3', MAT.marble); sumeru(6.6, 6.3, y, 3.6, 0.84); y += 3.6;
    kit.paint(GRANITE, MAT.marble); sumeru(4.3, 3.9, y, 3.2, 0.86); y += 3.2;
    const SX = 5.2, SZ = 4.2, SH = 22.2, taper = 0.875;                   // shaft: wide faces north and south
    const f = block(kit, SX, SH, SZ, y, { taper });
    // the heart stone with its gilt inscription on the north face
    kit.paint('#e4e0d6', MAT.marble); kit.face([f.N(-1.45, 3.4, 0.05), f.N(1.45, 3.4, 0.05), f.N(1.45, 18.1, 0.05), f.N(-1.45, 18.1, 0.05)]);
    kit.paint('#c9a13a', MAT.metal);
    for (let i = 0; i < 8; i++) { const v = 4.3 + i * 1.66; kit.face([f.N(-0.62, v, 0.1), f.N(0.62, v, 0.1), f.N(0.62, v + 1.25, 0.1), f.N(-0.62, v + 1.25, 0.1)]); }
    y += SH;
    // cornice and the small hipped stone cap
    kit.paint(GRANITE, MAT.marble);
    kit.box(SX * taper, 0.9, SZ * taper, y, { taper: [1.2, 1.24] }); y += 0.9;
    kit.roof(SX * taper + 0.9, SZ * taper + 0.9, y, 37.94 - y, { overhang: 0.5, upturn: 0.12, ridge: 0.8, ridgeBeam: false });
    kit.mark(lm.name, 44, { rank: 2 });
  });
}

function mausoleum(kit, L) {
  site(kit, L.mausoleum, (lm) => {
    kit.flood(0.5);
    const B = 2 * lm.ex, T2 = B - 11, REDG = '#7d3b33', GRAN = '#d8cfba', H0 = 4;
    // two-tier base faced in dark red granite, white balustrades, broad flights of steps north and south
    kit.paint(REDG, MAT.matte); kit.box(B, 2, B); kit.box(T2, 2, T2, 2);
    balustrade(kit, B - 0.8, B - 0.8, 2, { gaps: { S: 31, N: 31 } });
    balustrade(kit, T2 - 0.8, T2 - 0.8, 4, { gaps: { S: 31, N: 31 } });
    kit.paint('#cdc5b3', MAT.marble);
    for (const dir of [0, 180]) stepsAt(kit, dir, T2 / 2, 30, H0, lm.ez - T2 / 2);
    // hall: 44 granite columns around a square core
    const C = 75, colH = 17.5, n = 12;
    kit.paint(GRAN, MAT.marble); kit.box(C + 4, 0.7, C + 4, H0);
    const yc = H0 + 0.7;
    kit.paint('#c6bca6', MAT.matte);
    const core = block(kit, 62, colH, 62, yc, { top: false });
    kit.paint('#3a2a22', MAT.matte);
    for (const P of [core.S, core.N]) for (const u of [-9, 0, 9]) kit.face([P(u - 2.6, 0), P(u + 2.6, 0), P(u + 2.6, 9), P(u - 2.6, 9)]);
    kit.paint(GRAN, MAT.marble);
    for (let i = 0; i < n; i++) {
      const p = (i / (n - 1) - 0.5) * (C - 1.5), e = (C - 1.5) / 2;
      kit.box(1.5, colH, 1.5, yc, { cx: p, cz: e, top: false }); kit.box(1.5, colH, 1.5, yc, { cx: p, cz: -e, top: false });
      if (i > 0 && i < n - 1) { kit.box(1.5, colH, 1.5, yc, { cx: e, cz: p, top: false }); kit.box(1.5, colH, 1.5, yc, { cx: -e, cz: p, top: false }); }
    }
    // two flat roofs, each with a golden glazed cornice over a granite frieze
    let y = yc + colH;
    const eave = (S, frieze, band) => {
      kit.paint(GRAN, MAT.marble); kit.box(S - 3.4, frieze, S - 3.4, y, { bottom: true }); y += frieze;
      kit.paint(YELLOW, MAT.tile); kit.box(S - 2.6, band, S - 2.6, y, { taper: S / (S - 2.6), bottom: true, top: false }); y += band;
      kit.paint('#8f8a80', MAT.matte); kit.box(S, 0.01, S, y - 0.01);
    };
    eave(84, 1.5, 2.4);
    kit.paint(GRAN, MAT.marble); kit.box(66, 2.9, 66, y, { top: false }); y += 2.9;
    eave(70.5, 1.3, 2.3);
    kit.mark(lm.name, y + 8, { rank: 2 });
  });
}

// ------------------------------------------------------------------ National Centre for the Performing Arts

function ncpa(kit, L) {
  kit.at(L.ncpa, (lm) => {
    // titanium super-ellipsoid shell (the footprint outline fits exponent 2.2) with a glass curtain opening down the middle
    const a = lm.hl, b = lm.hw, c = 46.3, n = 2.2, M = 30, T0 = 0.3;
    const pw = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
    const edge = (psi) => a * (0.07 + 0.25 * Math.pow(1 - Math.sin(psi), 1.5));       // half-width of the glass at arch angle psi
    const X = (t, psi) => {
      const xb = edge(psi), s = Math.abs(t);
      if (s <= T0) return xb * t / T0;
      const ab = Math.asin(xb / a);
      return Math.sign(t) * a * Math.sin(ab + (Math.PI / 2 - ab) * (s - T0) / (1 - T0));
    };
    const patch = (t0, t1, nt) => {
      const i0 = kit.n;
      for (let j = 0; j <= M; j++) {
        const psi = Math.PI * j / M, C = pw(Math.cos(psi), 2 / n), S = pw(Math.sin(psi), 2 / n);
        for (let k = 0; k <= nt; k++) {
          const x = X(t0 + (t1 - t0) * k / nt, psi), rho = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x) / a, n)), 1 / n);
          const z = b * rho * C, y = c * rho * S;
          let nx = pw(x / a, n - 1) / a, ny = pw(y / c, n - 1) / c, nz = pw(z / b, n - 1) / b;
          const l = Math.hypot(nx, ny, nz) || 1;
          kit.vert(x, y, z, nx / l, ny / l, nz / l, x, psi * rho * 60);
        }
      }
      const w = nt + 1;
      for (let j = 0; j < M; j++) for (let k = 0; k < nt; k++) { const p = i0 + j * w + k; kit.tri(p, p + 1, p + w + 1); kit.tri(p, p + w + 1, p + w); }
    };
    kit.paint('#b2b7bb', MAT.metal); patch(-1, -T0, 16); patch(T0, 1, 16);
    kit.paint('#7f99ab', MAT.glass, { p0: 3.6, p1: 0.5 }); patch(-T0, T0, 10);
    kit.mark(lm.name, c + 14, { rank: 1 });
  });
}

// ------------------------------------------------------------------ pagodas and dagobas

function baita(kit, L) {
  site(kit, L.baita, (lm) => {
    kit.flood(0.8);
    const WHITE = '#f2efe6', s = Math.min(lm.ex, lm.ez) + 0.3;
    // brick terrace on the summit of Qionghua island
    kit.paint('#8f887c', MAT.brick); kit.box(27, 7.5, 27, -6, { taper: 0.96 });
    balustrade(kit, 26, 26, 1.5, { h: 1.0 });
    let y = 1.5;
    // 折角须弥座: three tiers with re-entrant corners
    kit.paint(WHITE, MAT.matte);
    for (const [h, dy] of [[s, 2.0], [s - 0.9, 1.7], [s - 1.8, 1.6]]) { kit.prism(notched(h, h, h * 0.2), y, y + dy); y += dy; }
    // 金刚圈 and the bottle-shaped body (覆钵)
    for (const r of [6.9, 6.6, 6.3]) { kit.lathe([[r, y], [r, y + 0.5]], { seg: 40, capTop: true }); y += 0.5; }
    const body = [[6.0, 0], [6.25, 1.8], [6.6, 3.8], [6.95, 5.8], [7.0, 6.8], [6.8, 7.8], [6.2, 8.8], [5.0, 9.7], [3.6, 10.2], [2.9, 10.4]];
    kit.lathe(body.map(([r, h]) => [r, y + h]), { seg: 40 });
    // 眼光门: the red and gold niche on the south face
    const niche = (w, h, d, v0) => [[-w, v0], [w, v0], [w, v0 + h * 0.6], [w * 0.6, v0 + h * 0.84], [0, v0 + h], [-w * 0.6, v0 + h * 0.84], [-w, v0 + h * 0.6]].map(([u, v]) => [u, y + v, 6.25 + (v - 1.8) * 0.175 + d]);
    kit.paint(GOLD, MAT.metal); kit.face(niche(1.75, 4.6, 0.3, 1.9));
    kit.paint(RED, MAT.matte); kit.face(niche(1.35, 3.9, 0.38, 2.2));
    y += 10.4;
    // 塔脖, the thirteen rings (十三天), bronze canopy and gilded finial
    kit.lathe([[3.1, y], [3.1, y + 0.5], [2.6, y + 0.8], [2.6, y + 1.4], [3.1, y + 1.7], [3.1, y + 2.1]], { seg: 24, capTop: true }); y += 2.1;
    for (let i = 0; i < 13; i++) {
      const r = 2.6 - 1.25 * (i / 12), yy = y + i * 0.78;
      kit.lathe([[r, yy], [r - 0.06, yy + 0.6]], { seg: 20 }); kit.lathe([[r - 0.06, yy + 0.6], [r - 0.36, yy + 0.6]], { seg: 20 });
      kit.lathe([[r - 0.36, yy + 0.6], [r - 0.42, yy + 0.78]], { seg: 20 });
    }
    y += 13 * 0.78;
    kit.paint('#6d6440', MAT.metal);
    kit.lathe([[0.9, y], [2.5, y + 0.25], [2.5, y + 0.5], [1.0, y + 0.9], [1.9, y + 1.15], [1.9, y + 1.35], [0.5, y + 1.7]], { seg: 20 });
    kit.paint(GOLD, MAT.metal);
    kit.lathe([[0.5, y + 1.6], [0.95, y + 2.2], [1.0, y + 2.8], [0.6, y + 3.3], [0.3, y + 3.6], [0.55, y + 4.0], [0.3, y + 4.5], [0.02, y + 5.2]], { seg: 14 });
    kit.mark(lm.name, y + 11, { rank: 1 });
  });
}

function tianningsi(kit, L) {
  kit.at(L.tianningsi, (lm) => {
    kit.flood(0.6);
    const o = { seg: 8, smooth: false, arc: [22.5, 382.5] }, R = (ap) => ap / Math.cos(Math.PI / 8);      // corner radius from the apothem
    const BODY = '#9a9083', EAVE = '#74706b', SOFFIT = '#857b6e';
    kit.paint('#a39c90', MAT.brick); kit.lathe([[R(lm.hl), 0], [R(lm.hl), 1.2]], { ...o, capTop: true });              // octagonal terrace
    // two-tier sumeru base, bracketed balcony and lotus throne
    kit.paint(BODY, MAT.brick);
    kit.lathe([[9.9, 1.2], [9.9, 2.3], [9.3, 2.7], [9.3, 4.5], [9.8, 4.9], [9.8, 5.5], [9.1, 5.5], [9.1, 5.9], [8.6, 6.3], [8.6, 8.0], [9.1, 8.4], [9.1, 9.0],
      [8.3, 9.0], [9.4, 10.0], [9.4, 11.0], [7.6, 11.0], [8.4, 11.8], [8.8, 12.6], [5.9, 12.6]], o);
    // tall first storey with arched doors on the cardinal faces
    kit.lathe([[5.6, 12.6], [5.5, 20.4]], o);
    for (const a of [0, 90, 180, 270]) arch(kit, ngonFace(8, 5.6, 5.5, 12.6, 20.4, a), 0, 1.9, 4.4, { v0: 0.9, surround: '#b3ab9d', rim: 0.35 });
    // thirteen close-set eaves, drawing in with a gentle curve
    let y = 20.4;
    for (let i = 0; i < 13; i++) {
      const t = i / 12, re = 8.1 - 2.9 * Math.pow(t, 1.3), rb = re - 2.3, rn = 8.1 - 2.9 * Math.pow((i + 1) / 12, 1.3) - 2.3, p = 2.3 - 0.25 * t;
      kit.paint(SOFFIT, MAT.brick); kit.lathe([[rb, y], [re - 0.25, y + p * 0.42], [re, y + p * 0.5]], o);
      kit.paint(EAVE, MAT.tile); kit.lathe(i < 12 ? [[re, y + p * 0.5], [rn + 0.3, y + p * 0.97]] : [[re, y + p * 0.5], [re * 0.55, y + p * 0.85], [1.7, y + p * 1.5]], o);
      if (i < 12) { kit.paint(BODY, MAT.brick); kit.lathe([[rn + 0.3, y + p * 0.97], [rn, y + p]], o); }
      y += p;
    }
    y += 1.0;
    // finial: lotus base and jewel
    kit.paint(BODY, MAT.brick); kit.lathe([[1.7, y], [1.7, y + 0.6], [2.5, y + 1.4], [1.5, y + 1.9], [2.2, y + 2.6], [1.3, y + 3.1]], o);
    kit.paint('#8c8477', MAT.matte); kit.lathe([[1.3, y + 3.0], [1.75, y + 3.9], [1.6, y + 4.9], [0.9, y + 5.9], [0.3, y + 6.6], [0.02, y + 7.4]], { seg: 12 });
    kit.mark(lm.name, y + 13, { rank: 2 });
  });
}

function yufengta(kit, L) {
  site(kit, L.yufengta, (lm) => {
    kit.flood(0.4);
    const o = { seg: 8, smooth: false, arc: [22.5, 382.5] }, PALE = '#d9d2c0', EAVE = '#8d8a80';
    kit.paint('#8a8576', MAT.matte); kit.lathe([[9.4, -7], [8.4, 0.2]], o);
    kit.paint('#cfc8b6', MAT.marble, { p0: 1.6 }); kit.lathe([[8.2, 0], [8.2, 1.6]], { ...o, capTop: true });
    let y = 1.6, r = 5.9;
    for (let i = 0; i < 7; i++) {
      const h = 4.5 - 0.25 * i, rt = r - 0.14;
      kit.paint(PALE, MAT.brick); kit.lathe([[r, y], [rt, y + h]], o);
      for (const a of (i % 2 ? [45, 135, 225, 315] : [0, 90, 180, 270])) arch(kit, ngonFace(8, r, rt, y, y + h, a), 0, 1.1, 2.3, { v0: 0.7, surround: null });
      y += h;
      const next = r - 0.36;
      kit.paint(PALE, MAT.brick); kit.lathe([[rt, y - 0.5], [rt + 0.95, y - 0.05]], o);
      kit.paint(EAVE, MAT.tile); kit.lathe(i < 6 ? [[rt + 0.95, y - 0.05], [next, y + 0.55]] : [[rt + 0.95, y - 0.05], [rt * 0.5, y + 1.0], [0.9, y + 2.6]], o);
      if (i < 6) y += 0.55;
      r = next;
    }
    y += 2.6;
    kit.paint('#7d7868', MAT.metal);
    kit.lathe([[0.9, y - 0.1], [0.9, y + 0.5], [0.5, y + 0.8], [0.75, y + 1.5], [0.5, y + 2.1], [0.6, y + 2.7], [0.25, y + 3.3], [0.02, y + 4.4]], { seg: 10 });
    kit.mark(lm.name, y + 10, { rank: 2 });
  }, 0);
}

// ------------------------------------------------------------------ Summer Palace: Tower of Buddhist Incense

function foxiangge(kit, L) {
  kit.at(L.foxiangge, (lm) => {
    kit.flood(0.7);
    // the great stone terrace built into the south slope of Longevity Hill
    const TY = 14, D0 = 24, TL = 54, z0 = -23, z1 = 21, TW = z1 - z0, cz = (z0 + z1) / 2, H = TY + D0, k = 0.93;
    kit.paint('#b3ab9c', MAT.marble, { p0: H });
    const f = block(kit, TL / k, H, TW / k, -D0, { cz, taper: k });
    // the "eight"-shaped double staircase climbing the south face
    kit.paint('#cfc8b8', MAT.marble);
    const fl = (u0, v0, u1, v1) => kit.face([f.S(u0, v0, 0.3), f.S(u0 + Math.sign(u1 - u0) * 2.2, v0, 0.3), f.S(u1 + Math.sign(u1 - u0) * 2.2, v1, 0.3), f.S(u1, v1, 0.3)].sort(() => 0).slice());
    const base = D0 - 12.5, mid = base + (H - base) * 0.5;
    for (const sx of [-1, 1]) {
      const q = (u0, v0, u1, v1) => { const pts = [f.S(sx * u0, v0, 0.3), f.S(sx * u1, v1, 0.3), f.S(sx * u1, v1 + 2.4, 0.3), f.S(sx * u0, v0 + 2.4, 0.3)]; kit.face(sx > 0 ? pts : pts.reverse()); };
      q(2, base, 15, mid); q(15, mid, 3, H - 2.6);
    }
    void fl;
    // octagonal tower: three storeys, four eaves, yellow tile edged in green
    const rot = 22.5, tile = YELLOW, trim = GREEN, R = (ap) => ap / Math.cos(Math.PI / 8);
    let y = TY;
    kit.paint(STONE, MAT.marble, { p0: 1.6 }); kit.lathe([[R(11.6), y], [R(11.6), y + 1.6]], { seg: 8, smooth: false, arc: [rot, rot + 360], capTop: true }); y += 1.6;
    const storeys = [[R(9.1), 6.6, R(11.4), 2.3], [R(7.5), 5.6, R(9.7), 2.1], [R(6.2), 5.0, R(8.3), 1.9]];
    storeys.forEach(([r, h, re, rise], i) => {
      if (i) { kit.paint(DECK, MAT.matte); kit.lathe([[r + 0.9, y - 0.6], [r + 0.9, y + 1.1]], { seg: 8, smooth: false, arc: [rot, rot + 360], capTop: true }); }
      polyWall(kit, 8, r, y, h, { rot, bays: 2 }); y += h;
      const rn = i < 2 ? storeys[i + 1][0] + 0.9 : R(5.2);
      polySkirt(kit, 8, re, rn, y - 0.15, rise, { rot, tile, trim }); y += rise - 0.2;
    });
    polyWall(kit, 8, R(5.2), y, 2.3, { rot, bays: 1 }); y += 2.3;
    y = polyRoof(kit, 8, R(7.2), y - 0.15, 8.4, { rot, tile, trim, sag: 0.3 });
    const top = finial(kit, y, 0.75);
    kit.mark(lm.name, top + 7, { rank: 1 });
  });
}

export const LANDMARKS = { jingshan, gulou, zhonglou, zhengyangmen, jianlou, yongdingmen, deshengmen, dongnanjiaolou, monument, mausoleum, ncpa, baita, tianningsi, yufengta, foxiangge };
