"""Where trees grow, per tile. The client scatters instanced trees from these primitives:

  zone A  dense canopy (forest, wood, scrub)            -> polygons, class 1
  zone B  parkland with scattered groves                -> polygons, class 2
  zone C  old cypress groves of the altars and temples  -> polygons, class 3
  yards   planted strips beside housing blocks          -> polygons, class 4 (also written to site/data/yards.bin as lawn)
  rows    street-tree lines along both sides of streets -> polylines
  points  individual trees in hutong courtyards         -> points

Everything is clipped to its tile and has buildings, water and carriageways subtracted, so the
client can scatter blindly.

Blob (little endian, decimetres relative to the tile's SW corner):
  u32 nPoly, nRing, nVert, nLine, nLineVert, nPoint
  u8 polyClass[nPoly], u8 polyRings[nPoly], pad4
  u16 ringSize[nRing], pad4
  i16 polyXY[2*nVert]      (delta coded per polygon)
  u16 linePts[nLine], pad4
  i16 lineXY[2*nLineVert]  (delta coded per line), pad4
  u16 pointXY[2*nPoint]

usage: 32_tree_zones.py <work_dir> [site_data_dir]     -> work/tree_tiles.pkl (+ site/data/yards.bin, listed in ground.json)
"""
import sys, os, time, pickle, struct, gzip, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from concurrent.futures import ProcessPoolExecutor
from common import *

WORK = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else None
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def pad4(b):
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        out = []
        for p in g.geoms:
            out += polys_of(p)
        return out
    return []


def lines_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    if hasattr(g, "geoms"):
        out = []
        for p in g.geoms:
            out += lines_of(p)
        return out
    return []


G = pickle.load(open(os.path.join(WORK, "ground_layers.pkl"), "rb"))
b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["geometry", "style", "area", "ring"])
BG = b.geometry.values
BSTYLE = b["style"].values
BAREA = b["area"].values
BTREE = shapely.STRtree(BG)
WATER = np.asarray(G["water"], dtype=object)
WTREE = shapely.STRtree(WATER)
L = G["layers"]


def mk(names):
    arr = []
    for n in names:
        arr += L.get(n, [])
    arr = np.asarray(arr, dtype=object)
    return arr, (shapely.STRtree(arr) if len(arr) else None)


DENSE, DENSE_T = mk(["forest", "scrub"])
PARK, PARK_T = mk(["park", "cemetery", "golf", "heritage", "campus"])
HARD, HARD_T = mk(["pitch", "track", "plaza", "parking", "apron", "runway", "taxiway", "stadium"])
CYP, CYP_T = mk(["cypress"])
RL = np.asarray(G["road_lines"], dtype=object)
RC = np.asarray(G["road_cls"]); RW = np.asarray(G["road_w"]); RF = np.asarray(G["road_flags"])
road_ok = RC <= 9
RL_all, RC_all, RW_all, RF_all = RL[road_ok], RC[road_ok], RW[road_ok], RF[road_ok]
RTREE = shapely.STRtree(RL_all)
rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring")
R6 = rings.geometry[6]
shapely.prepare(R6)
R5 = rings.geometry[5].buffer(600)
shapely.prepare(R5)
log("layers ready: dense", len(DENSE), "park", len(PARK), "hard", len(HARD), "roads", len(RL_all))


def q(tree, arr, box):
    if tree is None:
        return []
    idx = tree.query(box, predicate="intersects")
    return list(arr[idx])


def union(geoms):
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return shapely.Polygon()
    return shapely.union_all(np.asarray(geoms, dtype=object))


def yard_strip(g):
    """The planted strip in front of a housing block: a rectangle along the side of its bounding box that faces the sun."""
    mrr = g.minimum_rotated_rectangle
    if mrr.geom_type != "Polygon":
        return None
    c = np.asarray(mrr.exterior.coords)[:4, :2]
    ctr = c.mean(axis=0)
    best = None
    for k in range(4):
        p0, p1 = c[k], c[(k + 1) % 4]
        e = p1 - p0; L = float(np.hypot(*e))
        if L < 9.0:
            continue
        t = e / L
        n = np.array([t[1], -t[0]])
        m = (p0 + p1) / 2
        if (m - ctr) @ n < 0:
            n = -n
        # prefer the long side when it looks anywhere near south; a block running north-south gets its strip at the south end
        score = -n[1] + 0.25 * (L / (np.hypot(*(c[(k + 2) % 4] - c[(k + 1) % 4])) + L))
        if best is None or score > best[0]:
            best = (score, m, t, n, L)
    if best is None or best[3][1] > -0.25:
        return None
    _, m, t, n, L = best
    gap, depth = 2.4, min(8.0, max(5.0, L * 0.16))
    hl = L / 2 - 1.5
    a, b_ = m + n * gap, m + n * (gap + depth)
    return shapely.Polygon([a - t * hl, a + t * hl, b_ + t * hl, b_ - t * hl])


def enc_tile(args):
    i, j = args
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    box = shapely.box(ox, oy, ox + TILE, oy + TILE)
    qbox = box.buffer(30.0, join_style="mitre")
    bi = BTREE.query(qbox, predicate="intersects")
    bl = BG[bi]
    bu = union(list(shapely.buffer(bl, 1.6))) if len(bl) else shapely.Polygon()
    wu = union(q(WTREE, WATER, qbox))
    ri = RTREE.query(qbox, predicate="intersects")
    rl, rc, rw, rf = RL_all[ri], RC_all[ri], RW_all[ri], RF_all[ri]
    car = union(list(shapely.buffer(rl, rw / 2 + 0.8, cap_style="flat"))) if len(rl) else shapely.Polygon()
    block = union([bu, wu, car])
    dense = shapely.intersection(union(q(DENSE_T, DENSE, box)), box)
    A = shapely.difference(dense, block) if not dense.is_empty else dense
    park = shapely.intersection(union(q(PARK_T, PARK, box)), box)
    if not park.is_empty:
        hard = union(q(HARD_T, HARD, box))
        Bz = shapely.difference(park, union([block, hard, dense]))
    else:
        Bz = park
    # cypress precincts (class 3) take precedence over ordinary parkland
    cyp = shapely.intersection(union(q(CYP_T, CYP, box)), box)
    Cz = shapely.Polygon()
    if not cyp.is_empty:
        Cz = shapely.intersection(cyp, union([Bz, A])) if not (Bz.is_empty and A.is_empty) else shapely.Polygon()
        if not Cz.is_empty:
            Bz = shapely.difference(Bz, Cz) if not Bz.is_empty else Bz
            A = shapely.difference(A, Cz) if not A.is_empty else A
    polys, classes = [], []
    for geom, c, mn in ((A, 1, 60.0), (Bz, 2, 120.0), (Cz, 3, 80.0)):
        if geom.is_empty:
            continue
        geom = shapely.simplify(shapely.buffer(geom, -0.8), 2.2, preserve_topology=True)
        for p in polys_of(geom):
            if p.area < mn:
                continue
            p = shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area >= 40])
            polys.append(shapely.geometry.polygon.orient(p)); classes.append(c)
    # ---- housing compounds: lawn and trees along the sunny side of each block (owned by the tile holding the block's centroid)
    yards = []
    if len(bl) and R5.intersects(box):
        hm = (BSTYLE[bi] == 1) & (BAREA[bi] >= 150)
        if hm.any():
            cen = shapely.centroid(bl[hm])
            own = shapely.contains_xy(box, shapely.get_x(cen), shapely.get_y(cen)) & shapely.contains_xy(R5, shapely.get_x(cen), shapely.get_y(cen))
            strips = [yard_strip(g) for g in bl[hm][own]]
            strips = [g for g in strips if g is not None]
            if strips:
                hard_all = union(q(HARD_T, HARD, qbox))
                green = union([union(q(DENSE_T, DENSE, qbox)), union(q(PARK_T, PARK, qbox))])
                bu2 = union(list(shapely.buffer(bl, 2.2)))
                yz = shapely.difference(union(strips), union([bu2, wu, car, hard_all, green]))
                yz = shapely.buffer(shapely.buffer(yz, -0.7), 0.7, join_style="mitre")
                for p in polys_of(shapely.simplify(yz, 0.4, preserve_topology=True)):
                    if p.area < 45:
                        continue
                    p = shapely.geometry.polygon.orient(shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area >= 12]))
                    yards.append(p)
                    for piece in polys_of(shapely.intersection(p, box)):
                        if piece.area >= 30:
                            polys.append(shapely.geometry.polygon.orient(piece)); classes.append(4)
    # street-tree rows (not on expressways, bridges, tiny service lanes)
    rows = []
    inside6 = R6.intersects(box)
    if inside6 and len(rl):
        m = np.isin(rc, [1, 2, 3, 4, 5]) & ((rf & 2) == 0)
        keep_out = union([bu, wu, car])
        for ln, w, c in zip(rl[m], rw[m], rc[m]):
            if ln.length < 25:
                continue
            for sgn in (1, -1):
                try:
                    off = shapely.offset_curve(ln, sgn * (w / 2 + 2.2), join_style="mitre")
                except Exception:
                    continue
                off = shapely.intersection(off, box)
                if off.is_empty:
                    continue
                off = shapely.difference(off, keep_out)
                for part in lines_of(off):
                    if part.length >= 14:
                        rows.append(shapely.simplify(part, 0.8))
    # courtyard trees in hutong fabric
    pts = np.zeros((0, 2))
    cm = BSTYLE[bi] == 5
    if cm.sum() > 40:
        cg = bl[cm]
        # open ground within a few metres of courtyard houses, minus buildings and lanes = the courtyards
        near = shapely.buffer(union(list(cg)), 8.0)
        yard = shapely.intersection(shapely.difference(near, union([union(list(shapely.buffer(bl, 1.0))), car, wu])), box)
        if not yard.is_empty and yard.area > 200:
            rng = np.random.default_rng(i * 1000 + j)
            n = int(yard.area / 230)
            x0, y0, x1, y1 = yard.bounds
            cand = np.column_stack([rng.uniform(x0, x1, n * 8), rng.uniform(y0, y1, n * 8)])
            shapely.prepare(yard)
            ok = shapely.contains_xy(yard, cand[:, 0], cand[:, 1])
            pts = cand[ok][:n]
    # ---- encode
    cls, nrings, ringsizes, coords = [], [], [], []
    for p, c in zip(polys, classes):
        rr = [np.asarray(p.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in p.interiors]
        qq = []
        for r in rr:
            r = np.round((r - (ox, oy)) * 10).astype(np.int64)
            d = np.any(np.diff(np.vstack([r, r[:1]]), axis=0) != 0, axis=1)
            r = r[d]
            if len(r) >= 3:
                qq.append(r)
        if not qq or len(qq) > 255:
            continue
        allp = np.vstack(qq)
        dl = np.diff(np.vstack([[0, 0], allp]), axis=0)
        if np.abs(dl).max() > 32767:
            continue
        cls.append(c); nrings.append(len(qq)); ringsizes += [len(r) for r in qq]; coords.append(dl)
    lpts, lcoords = [], []
    for ln in rows:
        r = np.round((np.asarray(ln.coords)[:, :2] - (ox, oy)) * 10).astype(np.int64)
        d = np.any(np.diff(r, axis=0) != 0, axis=1)
        r = r[np.concatenate([[True], d])]
        if len(r) < 2 or len(r) > 65535:
            continue
        dl = np.diff(np.vstack([[0, 0], r]), axis=0)
        if np.abs(dl).max() > 32767:
            continue
        lpts.append(len(r)); lcoords.append(dl)
    P = np.clip(np.round((pts - (ox, oy)) * 10), 0, 65535).astype("<u2") if len(pts) else np.zeros((0, 2), "<u2")
    nv = sum(len(c) for c in coords); nlv = sum(len(c) for c in lcoords)
    if not cls and not lpts and not len(P):
        return (i, j), b"", (0, 0, 0), yards
    blob = struct.pack("<IIIIII", len(cls), len(ringsizes), nv, len(lpts), nlv, len(P))
    blob += pad4(np.asarray(cls, np.uint8).tobytes() + np.asarray(nrings, np.uint8).tobytes())
    blob += pad4(np.asarray(ringsizes, "<u2").tobytes())
    blob += pad4((np.vstack(coords).astype("<i2").tobytes() if coords else b""))
    blob += pad4(np.asarray(lpts, "<u2").tobytes())
    blob += pad4((np.vstack(lcoords).astype("<i2").tobytes() if lcoords else b""))
    blob += pad4(P.tobytes())
    area = float(sum(p.area for p in polys))
    return (i, j), blob, (area, float(sum(l.length for l in rows)), len(P)), yards


if __name__ == "__main__":
    jobs = [(i, j) for i in range(GRID_NX) for j in range(GRID_NY)]
    out = {}
    tot = np.zeros(3); nbytes = 0
    yards = []
    with ProcessPoolExecutor(max_workers=24) as ex:
        for k, (key, blob, st, yd) in enumerate(ex.map(enc_tile, jobs, chunksize=4)):
            if blob:
                out[key] = blob; nbytes += len(blob); tot += st
            yards += yd
            if k % 200 == 0:
                log("tile", k, "/", len(jobs))
    pickle.dump(out, open(os.path.join(WORK, "tree_tiles.pkl"), "wb"))
    log(f"tiles with trees {len(out)}, raw {nbytes / 1e6:.1f} MB; zone area {tot[0] / 1e6:.1f} km2, street rows {tot[1] / 1e3:.0f} km, courtyard trees {int(tot[2])}")
    log(f"housing yards {len(yards)}, {sum(p.area for p in yards) / 1e6:.2f} km2")
    if OUT:
        # same polygon layout as areas.bin (see 31_build_ground.py), class 12 = planted yard
        cls, nrings, ringsizes, x0, y0, deltas = [], [], [], [], [], []
        nv = 0
        for p in yards:
            rr = [np.asarray(p.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in p.interiors]
            qq = []
            for r in rr:
                r = np.round(r * 10).astype(np.int64)
                d = np.any(np.diff(np.vstack([r, r[:1]]), axis=0) != 0, axis=1)
                r = r[d]
                if len(r) >= 3:
                    qq.append(r)
            if not qq or len(qq) > 255:
                continue
            allp = np.vstack(qq)
            dl = np.diff(allp, axis=0)
            if len(dl) and np.abs(dl).max() > 32767:
                continue
            cls.append(12); nrings.append(len(qq)); ringsizes += [len(r) for r in qq]
            x0.append(allp[0, 0]); y0.append(allp[0, 1]); deltas.append(dl); nv += len(allp)
        blob = struct.pack("<III", len(cls), len(ringsizes), nv)
        blob += pad4(np.asarray(cls, np.uint8).tobytes() + np.asarray(nrings, np.uint8).tobytes())
        blob += pad4(np.asarray(ringsizes, "<u2").tobytes())
        blob += np.asarray(x0, "<i4").tobytes() + np.asarray(y0, "<i4").tobytes()
        blob += (np.vstack(deltas).astype("<i2").tobytes() if deltas else b"")
        z = gzip.compress(pad4(blob), 9)
        open(os.path.join(OUT, "yards.bin"), "wb").write(z)
        mf = os.path.join(OUT, "ground.json")
        man = json.load(open(mf))
        man["files"]["yards"] = "yards.bin"
        json.dump(man, open(mf, "w"), separators=(",", ":"))
        log(f"yards.bin {len(z) / 1e6:.2f} MB gz, polygons {len(cls)}, verts {nv}")
