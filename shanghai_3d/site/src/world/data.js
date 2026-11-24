// Data access: gzip'd binary tiles (see pipeline/tilefmt.py) and their decoders. Used on the main thread and in workers.

export const DATA_URL = new URL('../../data/', import.meta.url).href;
export const SEC = { buildings: 1, roads: 2, ground: 3, landcover: 4, trees: 5, props: 6, barriers: 7, signs: 8, bridges: 9, masses: 10, traffic: 11, walks: 12 };

export async function fetchBinary(name, { gzip = true } = {}) {
  const res = await fetch(DATA_URL + name);
  if (!res.ok) throw new Error(`fetch ${name}: ${res.status}`);
  const buf = await res.arrayBuffer();
  if (!gzip) return buf;
  // the files are stored gzip'd; servers that already send Content-Encoding hand us the plain bytes
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export async function fetchJSON(name) {
  const res = await fetch(DATA_URL + name);
  if (!res.ok) throw new Error(`fetch ${name}: ${res.status}`);
  return res.json();
}

/** Split a tile file into its sections: { id: Uint8Array view }. `offset` lets a tile live inside a larger buffer. */
export function parseTile(buffer, offset = 0, length = buffer.byteLength - offset) {
  const out = {};
  if (length < 8) return out;
  const dv = new DataView(buffer, offset, length);
  if (dv.getUint32(0, true) !== 0x31544853) throw new Error('bad tile magic');      // 'SHT1'
  const n = dv.getUint32(4, true);
  for (let k = 0; k < n; k++) {
    const id = dv.getUint32(8 + k * 12, true), o = dv.getUint32(12 + k * 12, true), l = dv.getUint32(16 + k * 12, true);
    out[id] = { buffer, offset: offset + o, length: l };
  }
  return out;
}

const pad4 = (n) => (n + 3) & ~3;

/** Decode a building section into SoA arrays. Coordinates stay in decimetres relative to the tile's SW corner (x east, y north). */
export function decodeBuildings(sec) {
  const { buffer, offset } = sec;
  const dv = new DataView(buffer, offset, sec.length);
  const nb = dv.getUint32(0, true), nr = dv.getUint32(4, true), nv = dv.getUint32(8, true);
  let o = offset + 12;
  const u16 = (n) => { const a = new Uint16Array(buffer.slice(o, o + n * 2)); o += n * 2; return a; };
  const height = u16(nb), base = u16(nb);
  const bytes = new Uint8Array(buffer, o, nb * 7);
  const levels = bytes.subarray(0, nb), style = bytes.subarray(nb, 2 * nb), roof = bytes.subarray(2 * nb, 3 * nb), seed = bytes.subarray(3 * nb, 4 * nb);
  const pal = bytes.subarray(4 * nb, 5 * nb), flags = bytes.subarray(5 * nb, 6 * nb), nrings = bytes.subarray(6 * nb, 7 * nb);
  o += pad4(nb * 7);
  const ringsize = new Uint16Array(buffer.slice(o, o + nr * 2)); o += pad4(nr * 2);
  const xy = new Int16Array(buffer.slice(o, o + nv * 4)); o += nv * 4;
  const edge = new Uint8Array(buffer, o, nv);
  return { nb, nr, nv, height, base, levels, style, roof, seed, pal, flags, nrings, ringsize, xy, edge };
}

/** Decode a classified polygon set (ground section). */
export function decodePolys(sec) {
  const { buffer, offset } = sec;
  const dv = new DataView(buffer, offset, sec.length);
  const np = dv.getUint32(0, true), nr = dv.getUint32(4, true), nv = dv.getUint32(8, true);
  let o = offset + 12;
  const cls = new Uint8Array(buffer, o, np), nrings = new Uint8Array(buffer, o + np, np); o += pad4(np * 2);
  const ringsize = new Uint16Array(buffer.slice(o, o + nr * 2)); o += pad4(nr * 2);
  const xy = new Int16Array(buffer.slice(o, o + nv * 4));
  return { np, nr, nv, cls, nrings, ringsize, xy };
}

/** Decode a polyline set: attrs is an array of Uint8Array (one per attribute). */
export function decodeLines(sec) {
  const { buffer, offset } = sec;
  const dv = new DataView(buffer, offset, sec.length);
  const nl = dv.getUint32(0, true), nv = dv.getUint32(4, true), na = dv.getUint32(8, true);
  let o = offset + 12;
  const attrs = [];
  for (let k = 0; k < na; k++) attrs.push(new Uint8Array(buffer, o + k * nl, nl));
  o += pad4(na * nl);
  const npts = new Uint16Array(buffer.slice(o, o + nl * 2)); o += pad4(nl * 2);
  const xy = new Int16Array(buffer.slice(o, o + nv * 4));
  return { nl, nv, attrs, npts, xy };
}

/** Decode a traffic section (pipeline/37_traffic.py): road edges with lanes and junction control, and the junction approaches. */
export function decodeTraffic(sec) {
  const dv = new DataView(sec.buffer, sec.offset, sec.length);
  const ne = dv.getUint32(0, true), nv = dv.getUint32(4, true), na = dv.getUint32(8, true);
  let o = 12;
  const E = { n: ne, a: new Uint32Array(ne), b: new Uint32Array(ne), cls: new Uint8Array(ne), flags: new Uint8Array(ne), nf: new Uint8Array(ne), nb: new Uint8Array(ne),
    lw: new Float32Array(ne), shift: new Float32Array(ne), W: new Float32Array(ne), speed: new Float32Array(ne), trim: new Float32Array(ne * 2), stop: new Float32Array(ne * 2),
    ctrl: new Uint8Array(ne * 2), phase: new Uint16Array(ne * 2), start: new Uint32Array(ne + 1), reach: new Uint32Array(ne * 2), sub: new Uint8Array(ne * 2) };
  for (let e = 0; e < ne; e++, o += 40) {
    E.a[e] = dv.getUint32(o, true); E.b[e] = dv.getUint32(o + 4, true);
    E.cls[e] = dv.getUint8(o + 8); E.flags[e] = dv.getUint8(o + 9); E.nf[e] = dv.getUint8(o + 10); E.nb[e] = dv.getUint8(o + 11);
    E.lw[e] = dv.getUint8(o + 12) / 20; E.shift[e] = dv.getInt8(o + 13) / 10; E.W[e] = dv.getUint8(o + 14) / 4; E.speed[e] = dv.getUint8(o + 15) / 3.6;
    E.trim[e * 2] = dv.getUint8(o + 16) / 2; E.trim[e * 2 + 1] = dv.getUint8(o + 17) / 2; E.stop[e * 2] = dv.getUint8(o + 18) / 2; E.stop[e * 2 + 1] = dv.getUint8(o + 19) / 2;
    E.ctrl[e * 2] = dv.getUint8(o + 20); E.ctrl[e * 2 + 1] = dv.getUint8(o + 21);
    E.start[e + 1] = E.start[e] + dv.getUint16(o + 22, true);
    E.phase[e * 2] = dv.getUint16(o + 24, true); E.phase[e * 2 + 1] = dv.getUint16(o + 26, true);
    E.reach[e * 2] = dv.getUint32(o + 28, true); E.reach[e * 2 + 1] = dv.getUint32(o + 32, true); E.sub[e * 2] = dv.getUint8(o + 36); E.sub[e * 2 + 1] = dv.getUint8(o + 37);
  }
  // vertices: x east, y north in metres from the tile's SW corner, z up
  const xyz = new Float32Array(nv * 3), zo = o + nv * 4;
  for (let e = 0; e < ne; e++) {
    let px = 0, py = 0;
    for (let k = E.start[e]; k < E.start[e + 1]; k++) { px += dv.getInt16(o + k * 4, true); py += dv.getInt16(o + k * 4 + 2, true); xyz[k * 3] = px * 0.1; xyz[k * 3 + 1] = py * 0.1; xyz[k * 3 + 2] = dv.getInt16(zo + k * 2, true) * 0.05; }
  }
  o = zo + ((nv * 2 + 3) & ~3);
  // approaches: x, y (node), bearing (rad clockwise from north, away from the node), ctrl, phase, trim, stop, class, flags
  const app = new Float32Array(na * 9);
  for (let k = 0; k < na; k++, o += 12) {
    app[k * 9] = dv.getInt16(o, true) * 0.1; app[k * 9 + 1] = dv.getInt16(o + 2, true) * 0.1; app[k * 9 + 2] = dv.getUint8(o + 4) / 256 * Math.PI * 2;
    app[k * 9 + 3] = dv.getUint8(o + 5); app[k * 9 + 4] = dv.getUint16(o + 6, true); app[k * 9 + 5] = dv.getUint8(o + 8) / 2; app[k * 9 + 6] = dv.getUint8(o + 9) / 2;
    app[k * 9 + 7] = dv.getUint8(o + 10); app[k * 9 + 8] = dv.getUint8(o + 11);
  }
  // the lanes as painted: stretches of lane running through the tile, with what lies across them
  let paint = null;
  if (o + 8 <= sec.length) {
    const np_ = dv.getUint32(o, true), nvp = dv.getUint32(o + 4, true); o += 8;
    paint = { n: np_, flags: new Uint8Array(np_), nf: new Uint8Array(np_), nb: new Uint8Array(np_), lw: new Float32Array(np_), shift: new Float32Array(np_), cls: new Uint8Array(np_), W: new Float32Array(np_),
      start: new Uint32Array(np_ + 1), xyz: new Float32Array(nvp * 3) };
    for (let k = 0; k < np_; k++, o += 12) {
      paint.flags[k] = dv.getUint8(o); paint.nf[k] = dv.getUint8(o + 1); paint.nb[k] = dv.getUint8(o + 2); paint.lw[k] = dv.getUint8(o + 3) / 20; paint.shift[k] = dv.getInt8(o + 4) / 10;
      paint.cls[k] = dv.getUint8(o + 5); paint.W[k] = dv.getUint8(o + 6) / 4; paint.start[k + 1] = paint.start[k] + dv.getUint16(o + 8, true);
    }
    for (let k = 0; k < nvp; k++, o += 6) { paint.xyz[k * 3] = dv.getInt16(o, true) * 0.1; paint.xyz[k * 3 + 1] = dv.getInt16(o + 2, true) * 0.1; paint.xyz[k * 3 + 2] = dv.getInt16(o + 4, true) * 0.05; }
  }
  return { E, xyz, app, na, paint };
}
