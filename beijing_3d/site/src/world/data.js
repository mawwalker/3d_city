// Data access: fetch (with progress), gunzip, and decoders for the binary layer formats written by the pipeline.

export const DATA_ROOT = new URL('../../data/', import.meta.url).href;

async function gunzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 2 || u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;        // already plain
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

/** Fetch a (possibly gzipped) binary file. onProgress(loadedBytes, totalBytes|0) */
export async function fetchBin(name, onProgress) {
  const res = await fetch(DATA_ROOT + name);
  if (!res.ok) throw new Error(`fetch ${name}: ${res.status}`);
  let buf;
  if (onProgress && res.body) {
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader();
    const chunks = []; let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.length; onProgress(loaded, total);
    }
    const all = new Uint8Array(loaded); let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    buf = all.buffer;
  } else buf = await res.arrayBuffer();
  return gunzip(buf);
}

export async function fetchJSON(name) {
  const res = await fetch(DATA_ROOT + name);
  if (!res.ok) throw new Error(`fetch ${name}: ${res.status}`);
  return res.json();
}

const pad4 = (o) => (o + 3) & ~3;

/** Polygon set -> { n, cls: Uint8Array, rings: [[Float64Array(x,y)...], ...] } with coordinates in metres (x east, y north). */
export function decodePolygons(buf, byteOffset = 0) {
  const dv = new DataView(buf, byteOffset);
  const np = dv.getUint32(0, true), nr = dv.getUint32(4, true), nv = dv.getUint32(8, true);
  let o = byteOffset + 12;
  const cls = new Uint8Array(buf, o, np); o += np;
  const nrings = new Uint8Array(buf, o, np); o += np; o = byteOffset + pad4(o - byteOffset);
  const ringsize = new Uint16Array(buf.slice(o, o + nr * 2)); o += nr * 2; o = byteOffset + pad4(o - byteOffset);
  const x0 = new Int32Array(buf.slice(o, o + np * 4)); o += np * 4;
  const y0 = new Int32Array(buf.slice(o, o + np * 4)); o += np * 4;
  const d = new Int16Array(buf.slice(o, o + (nv - np) * 4));
  const polys = new Array(np);
  let ri = 0, di = 0;
  for (let p = 0; p < np; p++) {
    let x = x0[p], y = y0[p];
    const rings = [];
    let first = true;
    for (let r = 0; r < nrings[p]; r++) {
      const n = ringsize[ri++];
      const ring = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        if (!first) { x += d[di++]; y += d[di++]; }
        first = false;
        ring[2 * i] = x * 0.1; ring[2 * i + 1] = y * 0.1;
      }
      rings.push(ring);
    }
    polys[p] = rings;
  }
  return { n: np, cls: new Uint8Array(cls), polys };
}

/** Line set -> { n, cls, flags, width (m), aux, e0/eH/e1 (deck heights, 0.25 m), lines: [Float64Array(x,y...)] } */
export function decodeLines(buf, byteOffset = 0) {
  const dv = new DataView(buf, byteOffset);
  const nl = dv.getUint32(0, true), nv = dv.getUint32(4, true);
  let o = byteOffset + 8;
  const cls = new Uint8Array(buf.slice(o, o + nl)); o += nl;
  const flags = new Uint8Array(buf.slice(o, o + nl)); o += nl;
  const w4 = new Uint8Array(buf.slice(o, o + nl)); o += nl;
  const aux = new Uint8Array(buf.slice(o, o + nl)); o += nl;
  // deck heights (start, plateau, end) for bridges, 0.25 m units
  const e0 = new Uint8Array(buf.slice(o, o + nl)); o += nl;
  const eH = new Uint8Array(buf.slice(o, o + nl)); o += nl;
  const e1 = new Uint8Array(buf.slice(o, o + nl)); o += nl; o = byteOffset + pad4(o - byteOffset);
  const npts = new Uint16Array(buf.slice(o, o + nl * 2)); o += nl * 2; o = byteOffset + pad4(o - byteOffset);
  const x0 = new Int32Array(buf.slice(o, o + nl * 4)); o += nl * 4;
  const y0 = new Int32Array(buf.slice(o, o + nl * 4)); o += nl * 4;
  const d = new Int16Array(buf.slice(o, o + (nv - nl) * 4));
  const lines = new Array(nl);
  const width = new Float32Array(nl);
  let di = 0;
  for (let l = 0; l < nl; l++) {
    const n = npts[l];
    const a = new Float64Array(n * 2);
    let x = x0[l], y = y0[l];
    a[0] = x * 0.1; a[1] = y * 0.1;
    for (let i = 1; i < n; i++) { x += d[di++]; y += d[di++]; a[2 * i] = x * 0.1; a[2 * i + 1] = y * 0.1; }
    lines[l] = a; width[l] = w4[l] / 4;
  }
  return { n: nl, cls, flags, width, aux, e0, eH, e1, lines };
}
