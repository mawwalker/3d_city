"""Binary encoders shared by the Chongqing 3D tile builders (Tile Format v2, magic 'CQT2').

Tile file (gzip):
  u32 magic 'CQT2' (0x32545143), u32 nsections,
  then nsections x (u32 id, u32 offset, u32 length),
  then 4-byte aligned section payloads.

Section ids:
  1 buildings, 2 road lines, 3 ground polygons, 4 land-cover raster, 5 trees, 6 props,
  7 barriers, 8 labels/signs, 9 bridges, 10 mass blocks, 11 traffic graph, 12 walking loops.

Building section v2 layout (sections 1 and 10):
  u32 nb, u32 nr, u32 nv
  u16 height[nb]       (0.1 m above ground_z_max / base)
  u16 base[nb]         (0.1 m min_height for elevated parts)
  i16 ground_z_min[nb] (0.1 m world Y, waterY = 0)
  i16 ground_z_max[nb] (0.1 m world Y, waterY = 0)
  u8  levels[nb], style[nb], roof[nb], seed[nb], pal[nb], flags[nb], nrings[nb],
      podium_h[nb] (0.25 m), balcony_mask[nb], subtype[nb]  -> pad4(10 * nb)
  u16 ringsize[nr]     -> pad4(2 * nr)
  i16 xy[2 * nv]       (0.1 m deltas relative to tile SW corner)
  u8  edge[nv]         -> pad4(nv) (bit0: street-front, bit1: party wall)
"""
import struct
import numpy as np

SEC = dict(
    buildings=1, roads=2, ground=3, landcover=4, trees=5, props=6,
    barriers=7, signs=8, bridges=9, masses=10, traffic=11, walks=12,
)


def pad4(b):
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def pack_tile(sections):
    """sections: dict name -> bytes (empty ones are skipped)."""
    items = [(SEC[k], v) for k, v in sections.items() if v]
    head = 8 + 12 * len(items)
    table = b""
    body = b""
    for sid, payload in items:
        payload = pad4(payload)
        table += struct.pack("<III", sid, head + len(body), len(payload))
        body += payload
    return b"CQT2" + struct.pack("<I", len(items)) + table + body


def quantise_rings(p, ox, oy):
    """Polygon -> list of int64 rings in decimetres (closing vertex dropped, consecutive duplicates removed)."""
    rr = [np.asarray(p.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in p.interiors]
    out = []
    for r in rr:
        q = np.round((r[:, :2] - (ox, oy)) * 10).astype(np.int64)
        d = np.any(np.diff(np.vstack([q, q[:1]]), axis=0) != 0, axis=1)
        q = q[d]
        if len(q) >= 3:
            out.append(q)
    return out


def encode_buildings(polys, attrs, ox, oy, edge_flags=None):
    """Encode building polygons & v2 architectural metadata.
    attrs keys: height, base, ground_z_min, ground_z_max (metres);
                levels, style, roof, seed, pal, flags, podium_h (metres), balcony_mask, subtype.
    Returns (blob, kept_index_array).
    """
    nrings, ringsizes, coords, eflags, keep = [], [], [], [], []
    for k, p in enumerate(polys):
        q = quantise_rings(p, ox, oy)
        if not q or len(q) > 255 or max(len(r) for r in q) > 65535:
            continue
        ok = True
        prev = np.zeros(2, np.int64)
        cs = []
        for r in q:
            dlt = np.diff(np.vstack([prev, r]), axis=0)
            if np.abs(dlt).max() > 32767:
                ok = False
                break
            cs.append(dlt)
            prev = r[-1]
        if not ok:
            continue
        keep.append(k)
        nrings.append(len(q))
        ringsizes += [len(r) for r in q]
        coords += cs
        if edge_flags is not None:
            ef = edge_flags[k]
            for ri, r in enumerate(q):
                e = ef[ri] if ri < len(ef) and len(ef[ri]) == len(r) else np.zeros(len(r), np.uint8)
                eflags.append(np.asarray(e, np.uint8))
    keep = np.asarray(keep, dtype=np.int64)
    nb = len(keep)
    xy = np.vstack(coords).astype("<i2") if coords else np.zeros((0, 2), "<i2")
    nr, nv = len(ringsizes), len(xy)

    def arr(key, default=0.0):
        if not nb:
            return np.zeros(0)
        if key in attrs:
            return np.asarray(attrs[key])[keep]
        return np.full(nb, default)

    u8 = lambda v: np.clip(np.round(v), 0, 255).astype(np.uint8).tobytes()
    u16 = lambda v: np.clip(np.round(v), 0, 65535).astype("<u2").tobytes()
    i16 = lambda v: np.clip(np.round(v), -32768, 32767).astype("<i2").tobytes()

    blob = struct.pack("<III", nb, nr, nv)
    blob += u16(arr("height") * 10.0)
    blob += u16(arr("base") * 10.0)
    blob += i16(arr("ground_z_min") * 10.0)
    blob += i16(arr("ground_z_max") * 10.0)
    blob += pad4(
        u8(arr("levels", 1))
        + u8(arr("style", 0))
        + u8(arr("roof", 0))
        + u8(arr("seed", 0))
        + u8(arr("pal", 0))
        + u8(arr("flags", 0))
        + np.asarray(nrings, np.uint8).tobytes()
        + u8(arr("podium_h", 0.0) * 4.0)
        + u8(arr("balcony_mask", 0))
        + u8(arr("subtype", 0))
    )
    blob += pad4(np.asarray(ringsizes, "<u2").tobytes())
    blob += xy.tobytes()
    ef = np.concatenate(eflags).astype(np.uint8).tobytes() if eflags else bytes(nv)
    blob += pad4(ef)
    return blob, keep


def encode_polys(polys, classes, ox, oy):
    """Classified polygon set: u32 np, nr, nv | u8 class[np] | u8 nrings[np] | pad | u16 ringsize[nr] | pad | i16 xy deltas."""
    cls, nrings, ringsizes, coords = [], [], [], []
    for p, c in zip(polys, classes):
        q = quantise_rings(p, ox, oy)
        if not q or len(q) > 255:
            continue
        prev = np.zeros(2, np.int64)
        cs = []
        ok = True
        for r in q:
            dlt = np.diff(np.vstack([prev, r]), axis=0)
            if np.abs(dlt).max() > 32767 or len(r) > 65535:
                ok = False
                break
            cs.append(dlt)
            prev = r[-1]
        if not ok:
            continue
        cls.append(c)
        nrings.append(len(q))
        ringsizes += [len(r) for r in q]
        coords += cs
    xy = np.vstack(coords).astype("<i2") if coords else np.zeros((0, 2), "<i2")
    blob = struct.pack("<III", len(cls), len(ringsizes), len(xy))
    blob += pad4(np.asarray(cls, np.uint8).tobytes() + np.asarray(nrings, np.uint8).tobytes())
    blob += pad4(np.asarray(ringsizes, "<u2").tobytes())
    blob += xy.tobytes()
    return pad4(blob)


def encode_lines(lines, attrs, ox, oy, nattr):
    """Polyline set: u32 nl, nv, nattr | u8 attr[nattr][nl] | pad | u16 npts[nl] | pad | i16 xy deltas."""
    keep, npts, coords = [], [], []
    for k, ln in enumerate(lines):
        r = np.round((np.asarray(ln.coords)[:, :2] - (ox, oy)) * 10).astype(np.int64)
        d = np.any(np.diff(r, axis=0) != 0, axis=1)
        r = r[np.concatenate([[True], d])]
        if len(r) < 2 or len(r) > 65535:
            continue
        dlt = np.diff(np.vstack([np.zeros(2, np.int64), r]), axis=0)
        if np.abs(dlt).max() > 32767:
            continue
        keep.append(k)
        npts.append(len(r))
        coords.append(dlt)
    xy = np.vstack(coords).astype("<i2") if coords else np.zeros((0, 2), "<i2")
    blob = struct.pack("<III", len(keep), len(xy), nattr)
    ab = b"".join(np.asarray(a, np.uint8)[keep].tobytes() if len(keep) else b"" for a in attrs)
    blob += pad4(ab) + pad4(np.asarray(npts, "<u2").tobytes()) + xy.tobytes()
    return pad4(blob)


def encode_lines_z(lines, attrs, ox, oy, nattr):
    """Polyline set with clearance height per vertex (u8 z[nv] in 0.25 m above max(terrain, 0))."""
    keep, npts, coords, zs = [], [], [], []
    for k, c in enumerate(lines):
        c = np.asarray(c, float)
        r = np.round((c[:, :2] - (ox, oy)) * 10).astype(np.int64)
        d = np.any(np.diff(r, axis=0) != 0, axis=1)
        m = np.concatenate([[True], d])
        r = r[m]
        z = c[m, 2]
        if len(r) < 2 or len(r) > 65535:
            continue
        dlt = np.diff(np.vstack([np.zeros(2, np.int64), r]), axis=0)
        if np.abs(dlt).max() > 32767:
            continue
        keep.append(k)
        npts.append(len(r))
        coords.append(dlt)
        zs.append(np.clip(np.round(z * 4), 0, 255).astype(np.uint8))
    xy = np.vstack(coords).astype("<i2") if coords else np.zeros((0, 2), "<i2")
    blob = struct.pack("<III", len(keep), len(xy), nattr)
    ab = b"".join(np.asarray(a, np.uint8)[keep].tobytes() if len(keep) else b"" for a in attrs)
    blob += pad4(ab) + pad4(np.asarray(npts, "<u2").tobytes()) + xy.tobytes()
    blob += pad4(np.concatenate(zs).tobytes() if zs else b"")
    return pad4(blob)


def clip_line_box(c, x0, y0, x1, y1):
    """Clip a polyline (N, >=2 columns: x, y, ...) to a box, interpolating extra columns linearly."""
    c = np.asarray(c, float)
    if len(c) < 2:
        return []
    if c[:, 0].min() >= x0 and c[:, 0].max() <= x1 and c[:, 1].min() >= y0 and c[:, 1].max() <= y1:
        return [c]
    out, cur = [], []
    for k in range(len(c) - 1):
        p, q = c[k], c[k + 1]
        d = q - p
        t0, t1, ok = 0.0, 1.0, True
        for pv, dv, lo, hi in ((p[0], d[0], x0, x1), (p[1], d[1], y0, y1)):
            if abs(dv) < 1e-12:
                if pv < lo or pv > hi:
                    ok = False
                    break
            else:
                ta, tb = (lo - pv) / dv, (hi - pv) / dv
                if ta > tb:
                    ta, tb = tb, ta
                t0, t1 = max(t0, ta), min(t1, tb)
                if t0 > t1:
                    ok = False
                    break
        if not ok:
            if len(cur) > 1:
                out.append(np.array(cur))
            cur = []
            continue
        if t0 > 0 or not cur:
            if len(cur) > 1:
                out.append(np.array(cur))
            cur = [p + d * t0]
        cur.append(p + d * t1)
        if t1 < 1:
            if len(cur) > 1:
                out.append(np.array(cur))
            cur = []
    if len(cur) > 1:
        out.append(np.array(cur))
    return out
