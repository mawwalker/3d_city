// Street dressing computed in worker for 3D terrain-draped Chongqing streets:
//   - Lane markings, stop lines & zebra crossings draped smoothly along DEM slopes (+0.058m above road surface)
//   - Street lamps (5 floats: x, z, yaw, tall, y)
//   - Traffic signals (7 floats: x, z, yaw, arm, phase, group, y)
//   - Parked cars (6 floats: x, z, yaw, kind, y, slope) — strictly gated off steep slopes & junction corners
//   - Chongqing 3D Street Clutter (Phase 3 Photorealism):
//       * rails     (6 floats: x, z, yaw, kind, y, slope)  — kind 0: Chinese white/gold arterial guardrail; kind 1: hillside drop railing
//       * furniture (5 floats: x, z, yaw, kind, y)         — kind 0: granite sidewalk bollard; kind 1: twin trash bin; kind 2: utility cabinet
//       * shelters  (5 floats: x, z, yaw, y, slope)        — modern glass & steel Chongqing bus shelters with glowing night panels

const Y_OFF = 0.058;

export function buildStreet(d, tile = 1000, decks = null, traffic = null, opts = {}) {
  const half = tile / 2;
  const cx = opts.cx || 0, cz = opts.cz || 0, terrain = opts.terrain || null;
  const inHero = opts.inHero || null;
  const inTunnel = opts.inTunnel || null;
  const isBlocked = (lx, ln) => !!((inHero && inHero(cx + lx, cz - ln)) || (inTunnel && inTunnel(cx + lx, cz - ln)));
  const waterY = terrain ? (terrain.waterY ?? 0.0) : 0.0;
  const roadY = (lx, ln) => (terrain ? Math.max(terrain.sample(cx + lx, cz - ln), waterY + 0.15) : 0) + 0.04;
  const kerbY = (lx, ln) => (terrain ? Math.max(terrain.sample(cx + lx, cz - ln), waterY + 0.15) : 0) + 0.19;
  const nTmp = [0, 1, 0];
  const slopeNy = (lx, ln) => {
    if (!terrain || !terrain.ready) return 1.0;
    terrain.sampleNormal(cx + lx, cz - ln, nTmp);
    return nTmp[1];
  };

  const cls = d.attrs[0], wid = d.attrs[1], lanesA = d.attrs[2], flags = d.attrs[3];
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

  const key = (x, y) => Math.round(x * 2) * 100003 + Math.round(y * 2);
  const nodes = new Map(), orig = lines.slice();
  lines.forEach((L, li) => { for (let k = 0; k < L.n; k++) { const kk = key(L.x[k], L.y[k]); let a = nodes.get(kk); if (!a) nodes.set(kk, a = []); a.push(li); } });
  const edge = (x, y) => Math.abs(Math.abs(x) - half) < 0.3 || Math.abs(Math.abs(y) - half) < 0.3;
  const A = traffic ? traffic.app : null, appAt = new Map();
  if (A) for (let i = 0; i < traffic.na; i++) { const kk = key(A[i * 9] - half, A[i * 9 + 1] - half); let a = appAt.get(kk); if (!a) appAt.set(kk, a = []); a.push(i); }

  const approach = (L, atStart) => {
    const k0 = atStart ? 0 : L.n - 1, list = appAt.get(key(L.x[k0], L.y[k0]));
    if (!list) return null;
    let k = k0, acc = 0; const st = atStart ? 1 : -1;
    while (k + st >= 0 && k + st < L.n && acc < 9) { acc += Math.hypot(L.x[k + st] - L.x[k], L.y[k + st] - L.y[k]); k += st; }
    let px = L.x[k], py = L.y[k];
    if (acc > 9) { const t = (acc - 9) / Math.hypot(L.x[k] - L.x[k - st], L.y[k] - L.y[k - st]); px += (L.x[k - st] - px) * t; py += (L.y[k - st] - py) * t; }
    const brg = Math.atan2(px - L.x[k0], py - L.y[k0]);
    let best = -1, bd = 0.75;
    for (const i of list) { let dd = Math.abs(A[i * 9 + 2] - brg) % (Math.PI * 2); if (dd > Math.PI) dd = Math.PI * 2 - dd; if (dd < bd) { bd = dd; best = i; } }
    return best < 0 ? null : { ctrl: A[best * 9 + 3], phase: A[best * 9 + 4], trim: A[best * 9 + 5], stop: A[best * 9 + 6], flags: A[best * 9 + 8], arms: list.length };
  };

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
  const lamps = [], signals = [], cars = [], rails = [], furniture = [], shelters = [];
  let rs = 12345;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };

  // Terrain-draped decal ribbon (subdivides spans > 7m so paint hugs steep mountain road curves!)
  const ribbon = (L, cum, s0, s1, off, hw, type) => {
    if (s1 - s0 < 0.5) return;
    let first = true, base = 0, count = 0;
    const H = L.h;
    const emit = (px, py, dx, dy, s, hh = null) => {
      const nx = -dy, ny = dx;
      const lx = px + nx * (off + hw), ln = py + ny * (off + hw);
      const rx = px + nx * (off - hw), rn = py + ny * (off - hw);
      const yL = hh !== null ? hh + 0.035 : roadY(lx, ln) + Y_OFF;
      const yR = hh !== null ? hh + 0.035 : roadY(rx, rn) + Y_OFF;
      pos.push(lx, yL, -ln, rx, yR, -rn);
      uv.push(hw, s, type, -hw, s, type);
      if (first) { base = nv; first = false; }
      nv += 2; count++;
    };
    const emitSpan = (ax, ay, ah, sa, bx, by, bh, sb) => {
      const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey) || 1;
      const dx = ex / el, dy = ey / el;
      const steps = terrain ? Math.max(1, Math.min(18, Math.ceil(el / 7.0))) : 1;
      for (let i = 0; i <= steps; i++) {
        if (i === 0 && !first) continue;
        const t = i / steps;
        emit(ax + ex * t, ay + ey * t, dx, dy, sa + (sb - sa) * t, ah !== null ? ah + (bh - ah) * t : null);
      }
    };
    for (let k = 0; k + 1 < L.n; k++) {
      const sa = cum[k], sb = cum[k + 1];
      if (sb < s0 || sa > s1 || sb - sa < 1e-4) continue;
      const ta = Math.max(0, (s0 - sa) / (sb - sa));
      const tb = Math.min(1, (s1 - sa) / (sb - sa));
      if (tb <= ta) continue;
      const ax = L.x[k] + (L.x[k + 1] - L.x[k]) * ta, ay = L.y[k] + (L.y[k + 1] - L.y[k]) * ta;
      const bx = L.x[k] + (L.x[k + 1] - L.x[k]) * tb, by = L.y[k] + (L.y[k + 1] - L.y[k]) * tb;
      const ah = H ? H[k] + (H[k + 1] - H[k]) * ta : null;
      const bh = H ? H[k] + (H[k + 1] - H[k]) * tb : null;
      emitSpan(ax, ay, ah, sa + (sb - sa) * ta, bx, by, bh, sa + (sb - sa) * tb);
    }
    for (let k = 0; k + 1 < count; k++) { const i = base + k * 2; idx.push(i, i + 1, i + 3, i, i + 3, i + 2); }
  };

  const pointAt = (L, cum, s) => {
    let k = 0; while (k + 2 < L.n && cum[k + 1] < s) k++;
    const t = Math.min(1, Math.max(0, (s - cum[k]) / Math.max(cum[k + 1] - cum[k], 1e-3)));
    const ex = L.x[k + 1] - L.x[k], ey = L.y[k + 1] - L.y[k], el = Math.hypot(ex, ey) || 1;
    const px = L.x[k] + ex * t, py = L.y[k] + ey * t;
    const hh = L.h ? L.h[k] + (L.h[k + 1] - L.h[k]) * t : roadY(px, py);
    return [px, py, ex / el, ey / el, hh];
  };

  const P = traffic && traffic.paint ? traffic.paint : null, cover = new Set(), plines = [];
  const deckAt = new Map();
  for (const D of decks || []) for (let i = 0; i + 1 < D.n; i++) {
    const m = Math.max(1, Math.ceil(Math.hypot(D.x[i + 1] - D.x[i], D.y[i + 1] - D.y[i]) / 3));
    for (let j = 0; j <= m; j++) {
      const px = D.x[i] + (D.x[i + 1] - D.x[i]) * j / m, py = D.y[i] + (D.y[i + 1] - D.y[i]) * j / m;
      const kk = Math.floor(px / 4) * 100003 + Math.floor(py / 4);
      let a = deckAt.get(kk); if (!a) deckAt.set(kk, a = []);
      a.push(px, py, D.h[i] + (D.h[i + 1] - D.h[i]) * j / m);
    }
  }
  const deckHeight = (px, py, fallback) => {
    let best = 64, h = fallback; const cx0 = Math.floor(px / 4), cy0 = Math.floor(py / 4);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const c = deckAt.get((cx0 + a) * 100003 + cy0 + b);
      if (c) for (let i = 0; i < c.length; i += 3) { const dd = (c[i] - px) ** 2 + (c[i + 1] - py) ** 2; if (dd < best) { best = dd; h = c[i + 2]; } }
    }
    return h;
  };
  if (P) for (let k = 0; k < P.n; k++) {
    const i0 = P.start[k], n0 = P.start[k + 1] - i0;
    if (n0 < 2) continue;
    let x, y, h = null, n = n0;
    if (P.flags[k] & 2) {
      const X = [], Yv = [], H = [];
      for (let i = 0; i + 1 < n0; i++) {
        const ax = P.xyz[(i0 + i) * 3] - half, ay = P.xyz[(i0 + i) * 3 + 1] - half, az = P.xyz[(i0 + i) * 3 + 2];
        const bx = P.xyz[(i0 + i + 1) * 3] - half, by = P.xyz[(i0 + i + 1) * 3 + 1] - half, bz = P.xyz[(i0 + i + 1) * 3 + 2];
        const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 5));
        for (let j = i ? 1 : 0; j <= m; j++) {
          const px = ax + (bx - ax) * j / m, py = ay + (by - ay) * j / m;
          const cl = az + (bz - az) * j / m;
          const base = terrain ? Math.max(terrain.sample(cx + px, cz - py), waterY) : waterY;
          X.push(px); Yv.push(py); H.push(deckHeight(px, py, base + cl));
        }
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
  const covered = (L, cum, s0, s1) => {
    if (!P || s1 - s0 < 4) return false;
    let hit = 0, tot = 0;
    for (let s = s0 + 2; s < s1 - 1; s += 5) {
      const q = pointAt(L, cum, s), cx0 = Math.floor(q[0] / 3), cy0 = Math.floor(q[1] / 3);
      let f = false;
      for (let a = -1; a <= 1 && !f; a++) for (let b = -1; b <= 1; b++) if (cover.has((cx0 + a) * 100003 + cy0 + b)) { f = true; break; }
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
    const bike0 = (c === 2 || c === 3) ? 2.4 : (c === 4 ? 1.5 : 0), std = c === 0 ? 3.75 : c === 1 ? 3.5 : c === 11 ? 3.6 : 3.3;
    const model = L.lanes > 0 && c !== 5;
    let nl = model ? (twoWay ? Math.max(1, Math.round(L.lanes / 2)) : L.lanes) : 0;
    if (model) { const av = twoWay ? W / 2 : W - 0.6; while (nl > 1 && av / nl < 2.8) nl--; }
    const bike = !model ? bike0 : Math.max(0, Math.min(bike0, twoWay ? W / 2 - nl * std : W - 0.6 - nl * std));
    let t0 = 0, t1 = 0;
    const cross = (ap, atStart) => {
      if (!ap || !(ap.ctrl & 64)) return 0;
      const d0 = ap.trim, zw = c <= 3 ? 4.5 : 3.5;
      const sA = atStart ? d0 : len - d0 - zw, sB = sA + zw;
      if (sA < 0 || sB > len) return 0;
      ribbon(L, cum, sA, sB, 0, W / 2 - 0.2, 4);
      if (!(ap.flags & 1)) return d0 + zw + 0.6;
      const sStop = atStart ? sB + 1.3 : sA - 1.7;
      if (twoWay) { const hwid = (W / 2 - bike) / 2; ribbon(L, cum, sStop, sStop + 0.4, atStart ? hwid : -hwid, hwid, 5); }
      else ribbon(L, cum, sStop, sStop + 0.4, 0, W / 2 - bike * 0.5, 5);
      if ((ap.ctrl & 3) === 1) {
        const [px, py, dx, dy] = pointAt(L, cum, atStart ? sStop + 0.8 : sStop - 0.4);
        const side = atStart ? 1 : -1;
        const sx = px + -dy * side * (W / 2 + 0.7), sy = py + dx * side * (W / 2 + 0.7);
        signals.push(sx, -sy, Math.atan2(-dx * side, dy * side), Math.min(W / 2 - bike * 0.5 + 0.7, 7.5), ap.phase / 65536, (ap.ctrl >> 2) & 1, kerbY(sx, sy));
      }
      return d0 + zw + 2.2;
    };
    t0 = cross(a0, true); t1 = cross(a1, false);
    if (!t0) t0 = a0 && a0.arms >= 3 ? Math.min(len * 0.45, a0.trim) : j0 ? Math.min(len * 0.4, j0.w / 2 + 1.5) : 0;
    if (!t1) t1 = a1 && a1.arms >= 3 ? Math.min(len * 0.45, a1.trim) : j1 ? Math.min(len * 0.4, j1.w / 2 + 1.5) : 0;
    const s0 = t0, s1 = len - t1;
    if (s1 - s0 > 6) {
      const lw = 3.3, own = !covered(L, cum, s0, s1);
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

    // Parked cars along one kerb of flatter residential streets (full 4-wheel pitch+roll plane fit -> ZERO wheel burial!)
    // stride 7: [x, z, yaw, kind, y, pitch, roll]
    if (s1 - s0 > 24 && c === 5 && W >= 6.0) {
      const side = L.pside;
      for (let s = s0 + 10 + rnd() * 6; s < s1 - 10; s += 6.8 + rnd() * 2.2) {
        if (rnd() < 0.28) {
          const [px, py, dx, dy] = pointAt(L, cum, s);
          const off = side * (W / 2 - 1.35), fwd = side > 0 ? -1 : 1;
          const cx0 = px + -dy * off, cy0 = py + dx * off;
          if (isBlocked(cx0, cy0) || slopeNy(cx0, cy0) < 0.94) continue;
          const fx = dx * fwd, fn = dy * fwd; // forward unit in (lx, ln)
          const rx = fn, rn = -fx;            // local +Z right unit in (lx, ln): world (+fn, +fx) = (-hz, hx)
          const hl = 1.65, hw = 0.86;
          const yC  = roadY(cx0, cy0);
          const yFR = roadY(cx0 + fx * hl + rx * hw, cy0 + fn * hl + rn * hw);
          const yFL = roadY(cx0 + fx * hl - rx * hw, cy0 + fn * hl - rn * hw);
          const yRR = roadY(cx0 - fx * hl + rx * hw, cy0 - fn * hl + rn * hw);
          const yRL = roadY(cx0 - fx * hl - rx * hw, cy0 - fn * hl - rn * hw);
          const sl = ((yFR + yFL) - (yRR + yRL)) / (4 * hl);
          const rl = ((yFR + yRR) - (yFL + yRL)) / (4 * hw);
          if (Math.abs(sl) > 0.16 || Math.abs(rl) > 0.14) continue;
          const yAvg = 0.25 * (yFR + yFL + yRR + yRL);
          const dFR = hl * sl + hw * rl, dFL = hl * sl - hw * rl, dRR = -hl * sl + hw * rl, dRL = -hl * sl - hw * rl;
          const pen = Math.max(0, yFR - (yAvg + dFR), yFL - (yAvg + dFL), yRR - (yAvg + dRR), yRL - (yAvg + dRL), yC - yAvg);
          const cyVal = yAvg + Math.min(pen, 0.20) + 0.02;
          cars.push(cx0, -cy0, Math.atan2(fn, fx), 0, cyVal, sl, rl);
        } else s += rnd() * 14;
      }
    }

    // ---- Phase 3 Chongqing Street Clutter: guardrails, hillside railings, bollards, twin bins, cabinets & bus shelters ----
    const segLen = s1 - s0;
    let shelterS = -1e9, shelterSide = 1;

    // 1. Modern Chongqing Bus Shelter on wider flat arterial / collector streets (strictly clear of heroes & steep cliffs!)
    if (c >= 2 && c <= 4 && W >= 8.0 && segLen > 52 && rnd() < 0.52) {
      const shS = s0 + segLen * (0.32 + 0.36 * rnd());
      const shSide = rnd() < 0.5 ? 1 : -1;
      const [px, py, dx, dy] = pointAt(L, cum, shS);
      const bx = px + -dy * shSide * (W / 2 + 1.85), by = py + dx * shSide * (W / 2 + 1.85);
      if (!isBlocked(bx, by) && slopeNy(bx, by) >= 0.96) {
        const y0 = kerbY(bx, by);
        const sl = (kerbY(bx + dx * 2.5, by + dy * 2.5) - kerbY(bx - dx * 2.5, by - dy * 2.5)) / 5.0;
        if (Math.abs(sl) < 0.065) {
          // Shelter local +Z faces into the street; +X runs along the kerb
          const fwd = shSide > 0 ? 1 : -1;
          const yaw = Math.atan2(dy * fwd, dx * fwd);
          shelters.push(bx, -by, yaw, y0, sl * fwd);
          shelterS = shS; shelterSide = shSide;
        }
      }
    }

    // 2. Chinese White/Gold Arterial Road Guardrails (kind 0) + Hillside Drop Railings (kind 1)
    if (c >= 1 && c <= 5 && segLen > 16) {
      const BAY = 3.0;
      const railStart = s0 + 5.0, railEnd = s1 - 5.0;
      // Central white/gold road divider guardrail on wide two-way urban arterials (cls 2..3, W >= 13.5m)
      if ((c === 2 || c === 3) && twoWay && W >= 13.5 && railEnd - railStart > 14) {
        for (let s = railStart + 3.0; s <= railEnd - 3.0; s += BAY) {
          const [px, py, dx, dy] = pointAt(L, cum, s);
          if (isBlocked(px, py)) continue;
          const yC = roadY(px, py);
          const sl = (roadY(px + dx * 1.5, py + dy * 1.5) - roadY(px - dx * 1.5, py - dy * 1.5)) / 3.0;
          if (Math.abs(sl) < 0.25) rails.push(px, -py, Math.atan2(dy, dx), 0, yC, sl);
        }
      }
      // Kerbside guardrails (white/gold on cls 2..3 urban roads; dark bronze safety railings on steep hillside drops!)
      const isArterial = (c === 2 || c === 3) && W >= 9.0;
      for (const side of [1, -1]) {
        const off = W / 2 + 0.32;
        for (let s = railStart; s <= railEnd - BAY * 0.5; s += BAY) {
          // Leave clean opening around bus shelters and periodic pedestrian curb access gaps
          if (side === shelterSide && Math.abs(s - shelterS) < 6.5) continue;
          const [px, py, dx, dy] = pointAt(L, cum, s);
          const rx = px + -dy * side * off, ry = py + dx * side * off;
          if (isBlocked(rx, ry) || slopeNy(rx, ry) < 0.90) continue;
          // Check if outer sidewalk side drops steeply downhill (Chongqing 8D cliff railing!)
          const outerX = px + -dy * side * (W / 2 + 3.0), outerY = py + dx * side * (W / 2 + 3.0);
          const dropM = kerbY(rx, ry) - kerbY(outerX, outerY);
          const steepDrop = dropM > 0.85 || slopeNy(outerX, outerY) < 0.88;
          if (!isArterial && !steepDrop) continue;
          // On flat arterials, leave clean 6m pedestrian access breaks every ~36m
          if (isArterial && !steepDrop && ((s - railStart) % 36) > 29) continue;
          const rk = steepDrop ? 1 : 0;
          const yR = kerbY(rx, ry);
          const sl = (kerbY(rx + dx * 1.5, ry + dy * 1.5) - kerbY(rx - dx * 1.5, ry - dy * 1.5)) / 3.0;
          if (Math.abs(sl) < 0.30) rails.push(rx, -ry, Math.atan2(dy, dx), rk, yR, sl);
        }
      }
    }

    // 3. Granite Sidewalk Bollards at junction approaches (kind 0) + Twin Trash Bins (kind 1) + Utility Cabinets (kind 2)
    if (c >= 2 && c <= 5 && segLen > 12) {
      // Corner bollards guarding sidewalk edges right near crosswalks/corners
      for (const endS of [s0 + 1.8, s1 - 1.8]) {
        if (endS < s0 + 0.6 || endS > s1 - 0.6) continue;
        for (const side of [1, -1]) {
          for (let b = 0; b < 3; b++) {
            const bs = endS + (endS === s0 + 1.8 ? b * 1.45 : -b * 1.45);
            if (bs <= s0 || bs >= s1) continue;
            const [px, py, dx, dy] = pointAt(L, cum, bs);
            const bx = px + -dy * side * (W / 2 + 0.45), by = py + dx * side * (W / 2 + 0.45);
            if (!isBlocked(bx, by) && slopeNy(bx, by) >= 0.90) furniture.push(bx, -by, Math.atan2(dy, dx), 0, kerbY(bx, by));
          }
        }
      }
      // Twin classification trash bins every ~55m on urban sidewalks (cls 2..4)
      if (c <= 4 && segLen > 28) {
        const binSide = (li & 1) ? 1 : -1;
        for (let s = s0 + 14 + rnd() * 14; s < s1 - 12; s += 56 + rnd() * 22) {
          if (binSide === shelterSide && Math.abs(s - shelterS) < 5.5) continue;
          const [px, py, dx, dy] = pointAt(L, cum, s);
          const bx = px + -dy * binSide * (W / 2 + 1.15), by = py + dx * binSide * (W / 2 + 1.15);
          if (!isBlocked(bx, by) && slopeNy(bx, by) >= 0.95) {
            const fwd = binSide > 0 ? 1 : -1;
            furniture.push(bx, -by, Math.atan2(dy * fwd, dx * fwd), 1, kerbY(bx, by));
          }
        }
      }
      // Occasional street utility / traffic control cabinet tucked at sidewalk edge
      if (c <= 4 && segLen > 40 && rnd() < 0.24) {
        const cs = s0 + 10 + rnd() * (segLen - 20);
        const cSide = rnd() < 0.5 ? 1 : -1;
        if (!(cSide === shelterSide && Math.abs(cs - shelterS) < 6)) {
          const [px, py, dx, dy] = pointAt(L, cum, cs);
          const bx = px + -dy * cSide * (W / 2 + 1.45), by = py + dx * cSide * (W / 2 + 1.45);
          if (!isBlocked(bx, by) && slopeNy(bx, by) >= 0.94) {
            const fwd = cSide > 0 ? 1 : -1;
            furniture.push(bx, -by, Math.atan2(dy * fwd, dx * fwd), 2, kerbY(bx, by));
          }
        }
      }
    }

    // Street lamps on exact DEM terrain (clear of hero structures)
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
          const lx = px + -dy * side * off, ly = py + dx * side * off;
          if (!isBlocked(lx, ly)) lamps.push(lx, -ly, Math.atan2(-dx * side, dy * side), tall, kerbY(lx, ly));
        }
      }
    }
  });

  // Elevated decks: lane lines and lamps at deck elevation
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
    if (!covered(L, cum, 0, len)) {
      if (L.twoWay) {
        ribbon(L, cum, 0, len, 0, W >= 11 ? 0.26 : 0.075, W >= 11 ? 2 : 3);
        for (let k = 1; k < nl; k++) { ribbon(L, cum, 0, len, k * lw, 0.075, 1); ribbon(L, cum, 0, len, -k * lw, 0.075, 1); }
      } else for (let k = 1; k < nl; k++) ribbon(L, cum, 0, len, left - k * lw, 0.075, 1);
    }
    if (c <= 5 && len > 20) {
      const n = Math.max(1, Math.floor(len / 36));
      for (let k = 0; k < n; k++) {
        const side = k % 2 ? 1 : -1;
        const [px, py, dx, dy, hh] = pointAt(L, cum, (k + 0.5) / n * len);
        const off = W / 2 + 0.25;
        const lx = px + -dy * side * off, ly = py + dx * side * off;
        if (!isBlocked(lx, ly)) lamps.push(lx, -ly, Math.atan2(-dx * side, dy * side), 1, hh);
      }
    }
  }

  return {
    decals: nv ? { pos: new Float32Array(pos), uv: new Float32Array(uv), index: new Uint32Array(idx) } : null,
    lamps: new Float32Array(lamps),
    signals: new Float32Array(signals),
    cars: new Float32Array(cars),
    rails: new Float32Array(rails),
    furniture: new Float32Array(furniture),
    shelters: new Float32Array(shelters),
  };
}
