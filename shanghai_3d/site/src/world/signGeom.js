// Road signs, worker side: reads the tile's sign list (pipeline/37_traffic.py, section 8), lays out the cells of the text
// atlas (painted on the main thread, where a canvas can set type: signs.js) and builds the quads that show them.
//   name plates   two per corner pole, one for each street, parallel to it, both faces; blue for streets running
//                 east-west and green for north-south (the national standard), with the compass points at the ends
//   boards        ahead of signalised junctions on the main streets, on an arm over the kerb-side lanes
//   bus stops     a name sign beside each shelter
// Positions are relative to the tile centre (x east, z south).

export const SIGN = { ATLAS_W: 1024, PLATE: [256, 64], BOARD: [256, 128], STOP: [128, 96] };

export function buildSigns(sec, tile) {
  const text = new TextDecoder().decode(new Uint8Array(sec.buffer, sec.offset, sec.length)).replace(/[\0\s]+$/, '');
  if (!text) return null;
  const d = JSON.parse(text), N = d.n || [], half = tile / 2, W = SIGN.ATLAS_W;
  const cells = [], keys = new Map();
  let cx = 0, cy = 0, rowH = 0;
  const alloc = (k, w, h, fields) => {
    const i = keys.get(k);
    if (i !== undefined) return cells[i];
    if (cx + w > W) { cx = 0; cy += rowH; rowH = 0; }
    if (cy + h > 4096) return cells[0];                      // atlas full: fall back to the blank cell
    const c = { x: cx, y: cy, w, h, ...fields }; cx += w; rowH = Math.max(rowH, h);
    keys.set(k, cells.length); cells.push(c);
    return c;
  };
  alloc('grey', 16, 16, { kind: 'grey' });
  const pos = [], nrm = [], uv = [], idx = [], inst = [];
  let nv = 0;
  const H = () => cy + rowH;
  // a face seen from the side its normal points to: `r` is the viewer's right
  const face = (X, Y, Z, rx, rz, hw, hh, c) => {
    const nx = -rz, nz = rx, ox = nx * 0.014, oz = nz * 0.014;
    for (const [a, b, u, v] of [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]]) {
      pos.push(X + rx * hw * a + ox, Y + hh * b, Z + rz * hw * a + oz); nrm.push(nx, 0, nz);
      uv.push(c.x + c.w * u + (u ? -0.5 : 0.5), c.y + c.h * v + (v ? -0.5 : 0.5));       // in atlas pixels: scaled once the height is known
    }
    idx.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3); nv += 4;
  };
  const vec = (deg) => { const a = deg * Math.PI / 180; return [Math.sin(a), -Math.cos(a)]; };
  // ---- street-name plates
  const P = d.p || [];
  for (let i = 0; i < P.length; i += 6) {
    const X = P[i] - half, Z = -(P[i + 1] - half);
    let any = false;
    for (const [deg, ni, y] of [[P[i + 2], P[i + 3], 3.40], [P[i + 4], P[i + 5], 2.97]]) {
      if (ni < 0 || !N[ni]) continue;
      const [dx, dz] = vec(deg), ew = Math.abs(dx) >= Math.abs(dz);
      for (const sg of [1, -1]) {
        const rx = dx * sg, rz = dz * sg;
        const right = ew ? (rx > 0 ? '东' : '西') : (rz < 0 ? '北' : '南');
        const c = alloc(`p|${ni}|${right}`, SIGN.PLATE[0], SIGN.PLATE[1], { kind: 'plate', zh: N[ni][0], en: N[ni][1], right, ns: !ew });
        face(X + dx * 0.80, y, Z + dz * 0.80, rx, rz, 0.75, 0.1875, c);       // flagged out from the pole along its own street
      }
      any = true;
    }
    if (any) inst.push(X, Z, 0, 0);
  }
  // ---- direction boards
  const B = d.b || [];
  for (let i = 0; i < B.length; i += 8) {
    const X = B[i] - half, Z = -(B[i + 1] - half), [tx, tz] = vec(B[i + 2]);
    const lx = tz, lz = -tx;                                   // towards the middle of the road (left of the traffic)
    const nm = (k) => (k >= 0 && N[k] ? N[k][0] : '');
    const c = alloc(`b|${B[i + 5]}|${B[i + 6]}|${B[i + 7]}`, SIGN.BOARD[0], SIGN.BOARD[1], { kind: 'board', ahead: nm(B[i + 5]), left: nm(B[i + 6]), right: nm(B[i + 7]) });
    const bx = X + lx * 3.0, bz = Z + lz * 3.0;
    face(bx, 6.4, bz, -lx, -lz, 1.8, 0.9, c);                  // faces the oncoming traffic: the kerb is on the reader's right
    face(bx, 6.4, bz, lx, lz, 1.8, 0.9, cells[0]);
    inst.push(X, Z, Math.atan2(-lz, lx), 1);
  }
  // ---- bus stops
  const S = d.s || [];
  for (let i = 0; i < S.length; i += 5) {
    const X = S[i] - half, Z = -(S[i + 1] - half), [fx, fz] = vec(S[i + 2]), yaw = Math.atan2(fx, fz), shelter = S[i + 3] > 0;
    if (shelter) inst.push(X, Z, yaw, 2);
    const rx = fz, rz = -fx;                                   // the shelter's own right (local +x)
    const px = shelter ? X + rx * 2.75 + fx * 0.4 : X, pz = shelter ? Z + rz * 2.75 + fz * 0.4 : Z;
    inst.push(px, pz, yaw, 3);
    if (N[S[i + 4]]) {
      const c = alloc(`s|${S[i + 4]}`, SIGN.STOP[0], SIGN.STOP[1], { kind: 'stop', zh: N[S[i + 4]][0] });
      face(px, 2.42, pz, -rx, -rz, 0.32, 0.24, c);             // read from the road ...
      face(px, 2.42, pz, rx, rz, 0.32, 0.24, c);               // ... and from the pavement
    }
  }
  if (!nv && !inst.length) return null;
  const atlasH = Math.max(16, H());
  const UV = new Float32Array(uv.length);
  for (let i = 0; i < uv.length; i += 2) { UV[i] = uv[i] / W; UV[i + 1] = 1 - uv[i + 1] / atlasH; }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: UV, index: new Uint32Array(idx), cells, atlasW: W, atlasH, inst: new Float32Array(inst) };
}
