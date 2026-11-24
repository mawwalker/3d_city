// Street dressing computed from the tile's road centre lines (worker): lane markings, stop lines and zebra crossings as
// decal ribbons, plus positions for street lamps, traffic signals and parked cars. Elevated decks (lines with heights) get
// their lane lines and lamps too. Where the traffic graph (37_traffic.py) knows a junction, its approach records decide
// where the lanes end, where the crossing and the stop line lie, and which signal group the head belongs to. The lines between
// lanes are painted from the traffic graph's own lanes (its "paint" stretches): the cars drive what is painted, also where the
// lanes were moved over or narrowed to fit beside a neighbouring carriageway. Roads without traffic keep the layout worked out
// from their width.
// lamps: x, z, yaw, tall, y    signals: x, z, yaw, arm, phase (0..1), group    cars: x, z, yaw, kind (0 parked), y
//
// Decal vertex:  aPos Float32 x3 (tile-centre metres, y up, z south)   aUv Float32 x3 (across m, along m, type)
// Types: 0 white solid, 1 white dashed, 2 double yellow, 3 yellow dashed, 4 zebra, 5 stop line, 6 bike-lane solid

const Y = 0.012;

export function buildStreet(d, tile = 1000, decks = null, traffic = null) {
  const half = tile / 2;
  const cls = d.attrs[0], wid = d.attrs[1], lanesA = d.attrs[2], flags = d.attrs[3];
  // ---- decode lines
  const lines = [];
  let vi = 0;
  for (let l = 0; l < d.nl; l++) {
    const n = d.npts[l];
    let px = 0, py = 0;
    const x = new Float32Array(n), y = new Float32Array(n);
    for (let k = 0; k < n; k++, vi++) { px += d.xy[vi * 2]; py += d.xy[vi * 2 + 1]; x[k] = px * 0.1 - half; y[k] = py * 0.1 - half; }
    const c = cls[l] & 15;
    lines.push({ x, y, n, cls: c, W: wid[l] / 4, lanes: lanesA[l], oneway: (flags[l] & 1) !== 0, bridge: (flags[l] & 2) !== 0, sw: (flags[l] & 4) !== 0, pside: (flags[l] & 8) ? 1 : -1, src: l });
  }
  // ---- junctions: nodes where line ends meet other lines
  const key = (x, y) => Math.round(x * 2) * 100003 + Math.round(y * 2);
  const nodes = new Map(), orig = lines.slice();
  lines.forEach((L, li) => { for (let k = 0; k < L.n; k++) { const kk = key(L.x[k], L.y[k]); let a = nodes.get(kk); if (!a) nodes.set(kk, a = []); a.push(li); } });
  const edge = (x, y) => Math.abs(Math.abs(x) - half) < 0.3 || Math.abs(Math.abs(y) - half) < 0.3;
  // junction approaches of the traffic graph, by node position
  const A = traffic ? traffic.app : null, appAt = new Map();
  if (A) for (let i = 0; i < traffic.na; i++) { const kk = key(A[i * 9] - half, A[i * 9 + 1] - half); let a = appAt.get(kk); if (!a) appAt.set(kk, a = []); a.push(i); }
  /** The approach record for the end of a line (the one whose bearing matches the way the line leaves the node). */
  const approach = (L, atStart) => {
    const k0 = atStart ? 0 : L.n - 1, list = appAt.get(key(L.x[k0], L.y[k0]));
    if (!list) return null;
    // direction away from the node, a few metres in
    let k = k0, acc = 0; const st = atStart ? 1 : -1;
    while (k + st >= 0 && k + st < L.n && acc < 9) { acc += Math.hypot(L.x[k + st] - L.x[k], L.y[k + st] - L.y[k]); k += st; }
    let px = L.x[k], py = L.y[k];
    if (acc > 9) { const t = (acc - 9) / Math.hypot(L.x[k] - L.x[k - st], L.y[k] - L.y[k - st]); px += (L.x[k - st] - px) * t; py += (L.y[k - st] - py) * t; }
    const brg = Math.atan2(px - L.x[k0], py - L.y[k0]);
    let best = -1, bd = 0.75;
    for (const i of list) { let dd = Math.abs(A[i * 9 + 2] - brg) % (Math.PI * 2); if (dd > Math.PI) dd = Math.PI * 2 - dd; if (dd < bd) { bd = dd; best = i; } }
    return best < 0 ? null : { ctrl: A[best * 9 + 3], phase: A[best * 9 + 4], trim: A[best * 9 + 5], stop: A[best * 9 + 6], flags: A[best * 9 + 8], arms: list.length };
  };
  // cut the lines at the junctions they run through: each piece then ends where its lanes end
  if (A) {
    const cut = [];
    for (const L of lines) {
      if (L.n < 3 || L.bridge || !(L.cls <= 5 || L.cls === 11)) { cut.push(L); continue; }
      let a = 0;
      for (let k = 1; k < L.n - 1; k++) {
        const list = appAt.get(key(L.x[k], L.y[k]));
        if (!list || list.length < 3) continue;
        cut.push({ ...L, x: L.x.subarray(a, k + 1), y: L.y.subarray(a, k + 1), n: k + 1 - a }); a = k;
      }
      cut.push(a ? { ...L, x: L.x.subarray(a), y: L.y.subarray(a), n: L.n - a } : L);
    }
    lines.length = 0; lines.push(...cut);
  }
  const junctionAt = (L, k) => {
    const li = L.src;
    if (edge(L.x[k], L.y[k])) return null;
    const a = nodes.get(key(L.x[k], L.y[k]));
    let w = 0, n = 0, minCls = 99;
    for (const o of a) { if (o === li) continue; const M = orig[o]; if (M.cls > 7 && M.cls !== 11) continue; n++; if (M.W > w) w = M.W; if (M.cls < minCls) minCls = M.cls; }
    return n >= 1 ? { w, minCls, n } : null;
  };
  const pos = [], uv = [], idx = [];
  let nv = 0;
  const lamps = [], signals = [], cars = [];
  let rs = 12345;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  // ribbon between along-distances s0..s1 at lateral offset `off` (left positive), half-width hw
  const ribbon = (L, cum, s0, s1, off, hw, type) => {
    if (s1 - s0 < 0.5) return;
    let first = true, base = 0, count = 0;
    const H = L.h;                                // deck lines carry a height per vertex
    const emit = (px, py, dx, dy, s, hh = 0) => {
      const nx = -dy, ny = dx;                    // left of travel in (x east, y north)
      const yy = H ? Math.max(hh, 0.16) + 0.02 : Y;
      pos.push(px + nx * (off + hw), yy, -(py + ny * (off + hw)), px + nx * (off - hw), yy, -(py + ny * (off - hw)));
      uv.push(hw, s, type, -hw, s, type);
      if (first) { base = nv; first = false; }
      nv += 2; count++;
    };
    for (let k = 0; k < L.n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(L.n - 1, k + 1);
      let dx = L.x[b] - L.x[a], dy = L.y[b] - L.y[a]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const s = cum[k];
      const hk = H ? H[k] : 0, hn = H && k + 1 < L.n ? H[k + 1] : hk;
      if (k + 1 < L.n && cum[k + 1] > s0 && s < s0) { const t = (s0 - s) / (cum[k + 1] - s); const ex = L.x[k + 1] - L.x[k], ey = L.y[k + 1] - L.y[k], el = Math.hypot(ex, ey) || 1; emit(L.x[k] + ex * t, L.y[k] + ey * t, ex / el, ey / el, s0, hk + (hn - hk) * t); }
      if (s >= s0 && s <= s1) emit(L.x[k], L.y[k], dx, dy, s, hk);
      if (k + 1 < L.n && cum[k + 1] > s1 && s < s1 && s1 > s0) { const t = (s1 - s) / (cum[k + 1] - s); const ex = L.x[k + 1] - L.x[k], ey = L.y[k + 1] - L.y[k], el = Math.hypot(ex, ey) || 1; emit(L.x[k] + ex * t, L.y[k] + ey * t, ex / el, ey / el, s1, hk + (hn - hk) * t); }
    }
    for (let k = 0; k + 1 < count; k++) { const i = base + k * 2; idx.push(i, i + 1, i + 3, i, i + 3, i + 2); }
  };
  const pointAt = (L, cum, s) => {
    let k = 0; while (k + 2 < L.n && cum[k + 1] < s) k++;
    const t = Math.min(1, Math.max(0, (s - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-3)));
    const ex = L.x[k + 1] - L.x[k], ey = L.y[k + 1] - L.y[k], el = Math.hypot(ex, ey) || 1;
    return [L.x[k] + ex * t, L.y[k] + ey * t, ex / el, ey / el, L.h ? L.h[k] + (L.h[k + 1] - L.h[k]) * t : 0];
  };

  // ---- the lanes of the traffic graph: where they run (3 m cells), so that the roads below know theirs are painted already
  const P = traffic && traffic.paint ? traffic.paint : null, cover = new Set(), plines = [];
  // (on a deck the paint takes its height from the deck's own line, every few metres: the traffic graph's is a simplified one)
  const deckAt = new Map();
  for (const D of decks || []) for (let i = 0; i + 1 < D.n; i++) {
    const m = Math.max(1, Math.ceil(Math.hypot(D.x[i + 1] - D.x[i], D.y[i + 1] - D.y[i]) / 3));
    for (let j = 0; j <= m; j++) { const px = D.x[i] + (D.x[i + 1] - D.x[i]) * j / m, py = D.y[i] + (D.y[i + 1] - D.y[i]) * j / m, kk = Math.floor(px / 4) * 100003 + Math.floor(py / 4); let a = deckAt.get(kk); if (!a) deckAt.set(kk, a = []); a.push(px, py, D.h[i] + (D.h[i + 1] - D.h[i]) * j / m); }
  }
  const deckHeight = (px, py, fallback) => {
    let best = 64, h = fallback; const cx = Math.floor(px / 4), cy = Math.floor(py / 4);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const c = deckAt.get((cx + a) * 100003 + cy + b); if (c) for (let i = 0; i < c.length; i += 3) { const d = (c[i] - px) ** 2 + (c[i + 1] - py) ** 2; if (d < best) { best = d; h = c[i + 2]; } } }
    return h;
  };
  if (P) for (let k = 0; k < P.n; k++) {
    const i0 = P.start[k], n0 = P.start[k + 1] - i0;
    if (n0 < 2) continue;
    let x, y, h = null, n = n0;
    if (P.flags[k] & 2) {
      const X = [], Yv = [], H = [];
      for (let i = 0; i + 1 < n0; i++) {
        const ax = P.xyz[(i0 + i) * 3] - half, ay = P.xyz[(i0 + i) * 3 + 1] - half, az = P.xyz[(i0 + i) * 3 + 2], bx = P.xyz[(i0 + i + 1) * 3] - half, by = P.xyz[(i0 + i + 1) * 3 + 1] - half, bz = P.xyz[(i0 + i + 1) * 3 + 2];
        const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 5));
        for (let j = i ? 1 : 0; j <= m; j++) { const px = ax + (bx - ax) * j / m, py = ay + (by - ay) * j / m; X.push(px); Yv.push(py); H.push(deckHeight(px, py, az + (bz - az) * j / m)); }
      }
      x = Float32Array.from(X); y = Float32Array.from(Yv); h = Float32Array.from(H); n = x.length;
    } else {
      x = new Float32Array(n); y = new Float32Array(n);
      for (let i = 0; i < n; i++) { x[i] = P.xyz[(i0 + i) * 3] - half; y[i] = P.xyz[(i0 + i) * 3 + 1] - half; }
    }
    plines.push({ x, y, n, h, k });
    for (let i = 0; i + 1 < n; i++) {
      const m = Math.max(1, Math.ceil(Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i]) / 2.5));
      for (let j = 0; j <= m; j++) cover.add(Math.floor((x[i] + (x[i + 1] - x[i]) * j / m) / 3) * 100003 + Math.floor((y[i] + (y[i + 1] - y[i]) * j / m) / 3));
    }
  }
  /** Does the traffic graph have lanes along (most of) this stretch of a road line? */
  const covered = (L, cum, s0, s1) => {
    if (!P || s1 - s0 < 4) return false;
    let hit = 0, tot = 0;
    for (let s = s0 + 2; s < s1 - 1; s += 5) {
      const q = pointAt(L, cum, s), cx = Math.floor(q[0] / 3), cy = Math.floor(q[1] / 3);
      let f = false;
      for (let a = -1; a <= 1 && !f; a++) for (let b = -1; b <= 1; b++) if (cover.has((cx + a) * 100003 + cy + b)) { f = true; break; }
      tot++; if (f) hit++;
    }
    return tot > 0 && hit * 2 >= tot;
  };
  for (const L of plines) {
    const k = L.k, n = L.n, cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(L.x[i] - L.x[i - 1], L.y[i] - L.y[i - 1]);
    const len = cum[n - 1], nf = P.nf[k], nb = P.nb[k], lw = P.lw[k], sh = P.shift[k], c = P.cls[k], W = P.W[k];
    if (len < 3) continue;
    if (P.flags[k] & 1) { for (let l = 1; l < nf; l++) ribbon(L, cum, 0, len, sh + (nf / 2 - l) * lw, 0.075, 1); }
    else {
      // the centre line (double yellow on the wide streets), and the lines between the lanes of each direction
      if (c <= 3 && W >= 11) ribbon(L, cum, 0, len, sh, 0.26, 2); else if (W >= 6.2) ribbon(L, cum, 0, len, sh, 0.075, c === 5 ? 1 : 3);
      for (let l = 1; l < nf; l++) ribbon(L, cum, 0, len, sh - l * lw, 0.075, 1);
      for (let l = 1; l < nb; l++) ribbon(L, cum, 0, len, sh + l * lw, 0.075, 1);
    }
  }

  lines.forEach((L, li) => {
    if (L.n < 2 || L.bridge) return;
    const c = L.cls;
    if (!(c <= 5 || c === 11)) return;
    const cum = new Float32Array(L.n);
    for (let k = 1; k < L.n; k++) cum[k] = cum[k - 1] + Math.hypot(L.x[k] - L.x[k - 1], L.y[k] - L.y[k - 1]);
    const len = cum[L.n - 1];
    const j0 = junctionAt(L, 0), j1 = junctionAt(L, L.n - 1);
    const a0 = approach(L, true), a1 = approach(L, false);
    const W = L.W, twoWay = !L.oneway;
    // the cycle lane along the kerb: what is left beside the lanes (37_traffic.py: a carriageway narrowed to fit beside its
    // neighbour gives up the cycle lane before its lanes narrow, and only below 2.8 m apiece does one go)
    const bike0 = (c === 2 || c === 3) ? 2.6 : (c === 4 ? 1.6 : 0), std = c === 0 ? 3.75 : c === 1 ? 3.5 : c === 11 ? 3.6 : 3.3;
    const model = L.lanes > 0 && c !== 5;      // (the lanes as the map has them: both directions together on a two-way road)
    let nl = model ? (twoWay ? Math.max(1, Math.round(L.lanes / 2)) : L.lanes) : 0;
    if (model) { const av = twoWay ? W / 2 : W - 0.6; while (nl > 1 && av / nl < 2.8) nl--; }
    const bike = !model ? bike0 : Math.max(0, Math.min(bike0, twoWay ? W / 2 - nl * std : W - 0.6 - nl * std));
    const major = c <= 4;
    let t0 = 0, t1 = 0;
    // crossings and stop lines
    const cross = (ap, atStart) => {
      if (!ap || !(ap.ctrl & 64)) return 0;
      const d0 = ap.trim, zw = c <= 3 ? 4.5 : 3.5;
      const sA = atStart ? d0 : len - d0 - zw, sB = sA + zw;
      if (sA < 0 || sB > len) return 0;
      ribbon(L, cum, sA, sB, 0, W / 2 - 0.2, 4);
      if (!(ap.flags & 1)) return d0 + zw + 0.6;                   // nothing arrives along a one-way street's far end
      const sStop = atStart ? sB + 1.3 : sA - 1.7;
      // approaching traffic: at the start node it travels against the line (left side), at the end node with it (right side)
      if (twoWay) { const hwid = (W / 2 - bike) / 2; ribbon(L, cum, sStop, sStop + 0.4, atStart ? hwid : -hwid, hwid, 5); }
      else ribbon(L, cum, sStop, sStop + 0.4, 0, W / 2 - bike * 0.5, 5);
      if ((ap.ctrl & 3) === 1) {
        const [px, py, dx, dy] = pointAt(L, cum, atStart ? sStop + 0.8 : sStop - 0.4);
        const side = atStart ? 1 : -1;            // kerb on the approaching side
        signals.push(px + -dy * side * (W / 2 + 0.7), -(py + dx * side * (W / 2 + 0.7)), Math.atan2(-dx * side, dy * side), Math.min(W / 2 - bike * 0.5 + 0.7, 7.5), ap.phase / 65536, (ap.ctrl >> 2) & 1);
      }
      return d0 + zw + 2.2;
    };
    t0 = cross(a0, true); t1 = cross(a1, false);
    if (!t0) t0 = a0 && a0.arms >= 3 ? Math.min(len * 0.45, a0.trim) : j0 ? Math.min(len * 0.4, j0.w / 2 + 1.5) : 0;
    if (!t1) t1 = a1 && a1.arms >= 3 ? Math.min(len * 0.45, a1.trim) : j1 ? Math.min(len * 0.4, j1.w / 2 + 1.5) : 0;
    const s0 = t0, s1 = len - t1;
    if (s1 - s0 > 6) {
      const lw = 3.3, own = !covered(L, cum, s0, s1);         // (no traffic along it: its own layout, by the rule 37_traffic.py starts from)
      if (twoWay) {
        const carr = W / 2 - bike;
        const n = model ? nl : Math.max(1, Math.min(L.lanes >= 2 ? Math.max(1, Math.round(L.lanes / 2)) : Math.max(1, Math.round(carr / lw)), Math.floor(carr / 2.8)));
        const w1 = carr / n;
        if (own) {
          if (c <= 3 && W >= 11) ribbon(L, cum, s0, s1, 0, 0.26, 2);
          else if (W >= 6.2) ribbon(L, cum, s0, s1, 0, 0.075, c === 5 ? 1 : 3);
          for (let k = 1; k < n; k++) { ribbon(L, cum, s0, s1, k * w1, 0.075, 1); ribbon(L, cum, s0, s1, -k * w1, 0.075, 1); }
        }
        if (bike > 0) { ribbon(L, cum, s0, s1, carr, 0.075, 6); ribbon(L, cum, s0, s1, -carr, 0.075, 6); }
      } else {
        const carr = W - bike - 0.6;
        const n = model ? nl : Math.max(1, Math.min(L.lanes >= 1 ? L.lanes : Math.max(1, Math.round(carr / 3.4)), Math.floor(carr / 2.8)));
        const w1 = carr / n, left = W / 2 - 0.3;
        if (own) for (let k = 1; k < n; k++) ribbon(L, cum, s0, s1, left - k * w1, 0.075, 1);
        if (c <= 4 || c === 11) { ribbon(L, cum, s0, s1, left, 0.075, 0); ribbon(L, cum, s0, s1, left - carr, 0.075, bike > 0 ? 6 : 0); }
      }
    }
    // parked cars along one kerb of the residential streets (the moving traffic is simulated: traffic.js): x, z, yaw, kind, y
    if (s1 - s0 > 14 && c === 5 && W >= 5.5) {
      const side = L.pside;
      for (let s = s0 + 4 + rnd() * 6; s < s1 - 4; s += 5.6 + rnd() * 1.2) {
        if (rnd() < 0.42) { const [px, py, dx, dy] = pointAt(L, cum, s), off = side * (W / 2 - 1.15), fwd = side > 0 ? -1 : 1; cars.push(px + -dy * off, -(py + dx * off), Math.atan2(dy * fwd, dx * fwd), 0, 0); }
        else s += rnd() * 12;
      }
    }
    // street lamps: both kerbs on the wide streets, one side on the lanes
    if ((c >= 1 && c <= 5) && len > 14) {
      const sp = c <= 3 ? 34 : 38;
      const tall = c <= 3 ? 1 : 0;
      const n = Math.max(1, Math.floor((s1 - s0) / sp));
      const ph = ((li * 7919) % 100) / 100;
      for (let k = 0; k < n; k++) {
        for (const side of (c <= 4 && twoWay ? [1, -1] : [(li + k) % 2 ? 1 : -1])) {
          const s = s0 + ((k + 0.5 + (side > 0 ? 0 : 0.5) * (c <= 4 ? 1 : 0) + ph * 0.3) / n) * (s1 - s0);
          if (s > s1 - 2 || s < s0 + 2) continue;
          const [px, py, dx, dy] = pointAt(L, cum, s);
          const off = W / 2 + 0.75;
          // yaw: arm points from the kerb towards the centre line
          lamps.push(px + -dy * side * off, -(py + dx * side * off), Math.atan2(-dx * side, dy * side), tall, 0.15);
        }
      }
    }
  });
  // ---- elevated decks: lane lines, edge lines, traffic and lamps at deck level
  for (const L of decks || []) {
    const c = L.cls;
    if (L.n < 2 || !(c <= 5 || c === 11)) continue;
    const cum = new Float32Array(L.n);
    for (let k = 1; k < L.n; k++) cum[k] = cum[k - 1] + Math.hypot(L.x[k] - L.x[k - 1], L.y[k] - L.y[k - 1]);
    const len = cum[L.n - 1], W = L.W;
    if (len < 8) continue;
    const left = W / 2 - 0.3, carr = W - 0.6;
    const nl = Math.max(1, Math.round((L.twoWay ? carr / 2 : carr) / 3.6));
    const lw = (L.twoWay ? carr / 2 : carr) / nl;
    ribbon(L, cum, 0, len, left, 0.075, 0); ribbon(L, cum, 0, len, -left, 0.075, 0);
    if (covered(L, cum, 0, len)) { /* the lines between its lanes are painted from the traffic graph */ }
    else if (L.twoWay) {
      ribbon(L, cum, 0, len, 0, W >= 11 ? 0.26 : 0.075, W >= 11 ? 2 : 3);
      for (let k = 1; k < nl; k++) { ribbon(L, cum, 0, len, k * lw, 0.075, 1); ribbon(L, cum, 0, len, -k * lw, 0.075, 1); }
    } else for (let k = 1; k < nl; k++) ribbon(L, cum, 0, len, left - k * lw, 0.075, 1);
    const up = (hh) => Math.max(hh, 0.16);
    // lamps along the parapets, alternating sides
    if (c <= 5 && len > 20) {
      const n = Math.max(1, Math.floor(len / 36));
      for (let k = 0; k < n; k++) {
        const side = k % 2 ? 1 : -1;
        const [px, py, dx, dy, hh] = pointAt(L, cum, (k + 0.5) / n * len);
        if (hh < 2.5) continue;
        const off = W / 2 + 0.25;
        lamps.push(px + -dy * side * off, -(py + dx * side * off), Math.atan2(-dx * side, dy * side), 1, up(hh));
      }
    }
  }
  return { decals: nv ? { pos: new Float32Array(pos), uv: new Float32Array(uv), index: new Uint32Array(idx) } : null,
    lamps: new Float32Array(lamps), signals: new Float32Array(signals), cars: new Float32Array(cars) };
}
