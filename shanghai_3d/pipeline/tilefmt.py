"""Binary encoders shared by the tile builders.

Tile file (gzip):   u32 magic 'SHT1', u32 nsections, then nsections x (u32 id, u32 offset, u32 length), then payloads (4-byte aligned).
Section ids:        1 buildings, 2 road lines, 3 ground polygons, 4 land-cover raster, 5 trees, 6 props, 7 barriers, 8 labels/signs, 9 bridges, 10 mass blocks,
                    11 traffic graph, 12 walking loops (37_traffic.py)
All coordinates are int16 decimetres relative to the tile's south-west corner unless noted.
"""
import struct
import numpy as np

SEC = dict(buildings=1, roads=2, ground=3, landcover=4, trees=5, props=6, barriers=7, signs=8, bridges=9, masses=10, traffic=11, walks=12)


def pad4(b):
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def pack_tile(sections):
    """sections: dict name -> bytes (empty ones are skipped)."""
    items = [(SEC[k], v) for k, v in sections.items() if v]
    head = 8 + 12 * len(items)
    table = b""; body = b""
    for sid, payload in items:
        payload = pad4(payload)
        table += struct.pack("<III", sid, head + len(body), len(payload))
        body += payload
    return b"SHT1" + struct.pack("<I", len(items)) + table + body


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
    """polys: list of shapely Polygons; attrs: dict of per-building arrays (height, base in metres; levels, style, roof, seed, pal, flags);
    edge_flags: optional list (per building) of lists (per ring) of uint8 arrays aligned with the quantised ring vertices.
    Returns (blob, kept_index_array)."""
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
                ok = False; break
            cs.append(dlt); prev = r[-1]
        if not ok:
            continue
        keep.append(k); nrings.append(len(q)); ringsizes += [len(r) for r in q]; coords += cs
        if edge_flags is not None:
            ef = edge_flags[k]
            for ri, r in enumerate(q):
                e = ef[ri] if ri < len(ef) and len(ef[ri]) == len(r) else np.zeros(len(r), np.uint8)
                eflags.append(np.asarray(e, np.uint8))
    keep = np.asarray(keep, dtype=np.int64)
    nb = len(keep)
    xy = np.vstack(coords).astype("<i2") if coords else np.zeros((0, 2), "<i2")
    nr, nv = len(ringsizes), len(xy)
    a = {k: np.asarray(v)[keep] if nb else np.zeros(0) for k, v in attrs.items()}
    u8 = lambda v: np.clip(np.round(v), 0, 255).astype(np.uint8).tobytes()
    blob = struct.pack("<III", nb, nr, nv)
    blob += np.clip(np.round(a["height"] * 10), 0, 65535).astype("<u2").tobytes() + np.clip(np.round(a["base"] * 10), 0, 65535).astype("<u2").tobytes()
    blob += pad4(u8(a["levels"]) + u8(a["style"]) + u8(a["roof"]) + u8(a["seed"]) + u8(a["pal"]) + u8(a["flags"]) + np.asarray(nrings, np.uint8).tobytes())
    blob += pad4(np.asarray(ringsizes, "<u2").tobytes())
    blob += xy.tobytes()
    ef = np.concatenate(eflags).astype(np.uint8).tobytes() if eflags else bytes(nv)
    blob += pad4(ef)
    return blob, keep


def encode_polys(polys, classes, ox, oy):
    """Classified polygon set: u32 np, nr, nv | u8 class[np] | u8 nrings[np] | pad | u16 ringsize[nr] | pad | i16 xy deltas (per polygon, first vertex absolute)."""
    cls, nrings, ringsizes, coords = [], [], [], []
    for p, c in zip(polys, classes):
        q = quantise_rings(p, ox, oy)
        if not q or len(q) > 255:
            continue
        prev = np.zeros(2, np.int64); cs = []; ok = True
        for r in q:
            dlt = np.diff(np.vstack([prev, r]), axis=0)
            if np.abs(dlt).max() > 32767 or len(r) > 65535:
                ok = False; break
            cs.append(dlt); prev = r[-1]
        if not ok:
            continue
        cls.append(c); nrings.append(len(q)); ringsizes += [len(r) for r in q]; coords += cs
    xy = np.vstack(coords).astype("<i2") if coords else np.zeros((0, 2), "<i2")
    blob = struct.pack("<III", len(cls), len(ringsizes), len(xy))
    blob += pad4(np.asarray(cls, np.uint8).tobytes() + np.asarray(nrings, np.uint8).tobytes())
    blob += pad4(np.asarray(ringsizes, "<u2").tobytes())
    blob += xy.tobytes()
    return pad4(blob)


def encode_lines(lines, attrs, ox, oy, nattr):
    """Polyline set: u32 nl, nv, nattr | u8 attr[nattr][nl] | pad | u16 npts[nl] | pad | i16 xy deltas (per line, first vertex absolute).
    attrs: list of nattr arrays of uint8, one value per line."""
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
        keep.append(k); npts.append(len(r)); coords.append(dlt)
    xy = np.vstack(coords).astype("<i2") if coords else np.zeros((0, 2), "<i2")
    blob = struct.pack("<III", len(keep), len(xy), nattr)
    ab = b"".join(np.asarray(a, np.uint8)[keep].tobytes() if len(keep) else b"" for a in attrs)
    blob += pad4(ab) + pad4(np.asarray(npts, "<u2").tobytes()) + xy.tobytes()
    return pad4(blob)


def encode_lines_z(lines, attrs, ox, oy, nattr):
    """Polyline set with a height per vertex: like encode_lines, followed by u8 z[nv] in 0.25 m. `lines` are (N, 3) arrays (x, y, z)."""
    keep, npts, coords, zs = [], [], [], []
    for k, c in enumerate(lines):
        c = np.asarray(c, float)
        r = np.round((c[:, :2] - (ox, oy)) * 10).astype(np.int64)
        d = np.any(np.diff(r, axis=0) != 0, axis=1)
        m = np.concatenate([[True], d])
        r = r[m]; z = c[m, 2]
        if len(r) < 2 or len(r) > 65535:
            continue
        dlt = np.diff(np.vstack([np.zeros(2, np.int64), r]), axis=0)
        if np.abs(dlt).max() > 32767:
            continue
        keep.append(k); npts.append(len(r)); coords.append(dlt); zs.append(np.clip(np.round(z * 4), 0, 255).astype(np.uint8))
    xy = np.vstack(coords).astype("<i2") if coords else np.zeros((0, 2), "<i2")
    blob = struct.pack("<III", len(keep), len(xy), nattr)
    ab = b"".join(np.asarray(a, np.uint8)[keep].tobytes() if len(keep) else b"" for a in attrs)
    blob += pad4(ab) + pad4(np.asarray(npts, "<u2").tobytes()) + xy.tobytes()
    blob += pad4(np.concatenate(zs).tobytes() if zs else b"")
    return pad4(blob)


def clip_line_box(c, x0, y0, x1, y1):
    """Clip a polyline (N, >= 2 columns: x, y, then anything that interpolates linearly, e.g. a height) to a box.
    Returns the pieces inside. Unlike a GEOS overlay this keeps the extra columns exact and never merges the turns of a spiral."""
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
                    ok = False; break
            else:
                ta, tb = (lo - pv) / dv, (hi - pv) / dv
                if ta > tb:
                    ta, tb = tb, ta
                t0, t1 = max(t0, ta), min(t1, tb)
                if t0 > t1:
                    ok = False; break
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
