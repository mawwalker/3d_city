"""Individual trees from the 1 m canopy-height map (Meta / WRI, CC BY 4.0).

Tree tops are local maxima of the smoothed canopy height; each gets a height, a crown radius and a species chosen from
its surroundings (street / waterside / park / housing estate / countryside). Crowns that overhang a carriageway are moved
to the nearest kerb side, crowns on roofs or water are dropped.

Tile section:  u32 n | u16 x[n] | u16 y[n] (dm from the SW corner) | u8 h[n] (0.25 m) | u8 r[n] (0.1 m) | u8 species[n] | u8 seed[n]
usage: 32_trees.py <work_dir> <canopy_dir> [i0 j0 i1 j1]
"""
import sys, os, json, time, struct, glob, gc
# Memory: GDAL's raster block cache defaults to 5 % of the machine's RAM *per process*; with a dozen workers each holding the
# canopy rasters open that alone was half the machine, and this step once took the whole desktop down. Cap it.
os.environ.setdefault("GDAL_CACHEMAX", "128")           # MB per process
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
import rasterio, rasterio.features, rasterio.warp
from rasterio.transform import from_origin
from scipy import ndimage
from multiprocessing import get_context
from common import *
from tilefmt import pad4

WORK, CANOPY = sys.argv[1:3]
RANGE = [int(v) for v in sys.argv[3:7]] if len(sys.argv) >= 7 else [0, 0, GRID_NX, GRID_NY]
T0 = time.time()
SP = dict(plane=0, camphor=1, ginkgo=2, metasequoia=3, willow=4, magnolia=5, cedar=6, osmanthus=7, poplar=8, bamboo=9, palm=10, cherry=11, broadleaf=12)


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["geometry", "height"])
B_GEOM = b.geometry.values
B_TREE = shapely.STRtree(B_GEOM)
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"), columns=["geometry", "highway", "osm_id"])
rsel = np.isin(roads.highway.values, ["primary", "secondary", "tertiary", "residential", "unclassified", "trunk", "living_street"])
R_GEOM = project_geoms(roads.geometry.values[rsel]); R_ID = roads.osm_id.values[rsel]
R_TREE = shapely.STRtree(R_GEOM)
rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring")
INNER = rings.geometry[1]; shapely.prepare(INNER)
OUTER = rings.geometry[3].buffer(1500); shapely.prepare(OUTER)
FILES = sorted(glob.glob(os.path.join(CANOPY, "*.tif")))
DS = None
os.makedirs(os.path.join(WORK, "sections", "trees"), exist_ok=True)
log("buildings", len(b), "roads", len(R_GEOM), "canopy files", len(FILES))


def read_ground(i, j):
    """Rasterise the tile's ground classes at 1 m: returns class map (0 where block)."""
    p = os.path.join(WORK, "sections", "ground", f"{i}_{j}.bin")
    out = np.zeros((1000, 1000), np.uint8)
    if not os.path.exists(p):
        return out
    buf = open(p, "rb").read()
    np_, nr, nv = struct.unpack_from("<III", buf, 0)
    o = 12
    cls = np.frombuffer(buf, np.uint8, np_, o); nrings = np.frombuffer(buf, np.uint8, np_, o + np_); o += (np_ * 2 + 3) & ~3
    ringsize = np.frombuffer(buf, "<u2", nr, o); o += (nr * 2 + 3) & ~3
    xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.int64)
    vi = ri = 0
    shapes = []
    for k in range(np_):
        rr = []; prev = np.zeros(2, np.int64)
        for _ in range(nrings[k]):
            n = ringsize[ri]; ri += 1
            pts = np.cumsum(np.vstack([prev, xy[vi:vi + n]]), axis=0)[1:]; vi += n; prev = pts[-1]
            rr.append(pts * 0.1)
        if cls[k] != 20 and len(rr[0]) >= 3:
            shapes.append((shapely.Polygon(rr[0], rr[1:]), int(cls[k])))
    if shapes:
        out = rasterio.features.rasterize(shapes, out_shape=(1000, 1000), transform=from_origin(0, 1000, 1, 1), fill=0, dtype="uint8")
    return out


def do_tile(ij):
    global DS
    i, j = ij
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    if DS is None:
        DS = [rasterio.open(f) for f in FILES]
    M = 6
    N = 1000 + 2 * M
    tr = from_origin(ox - M, oy + TILE + M, 1.0, 1.0)
    chm = np.zeros((N, N), np.float32)
    lon0, lat0 = to_lonlat(ox - 40, oy - 40); lon1, lat1 = to_lonlat(ox + TILE + 40, oy + TILE + 40)
    xs, ys = rasterio.warp.transform("EPSG:4326", "EPSG:3857", [float(lon0), float(lon1)], [float(lat0), float(lat1)])
    for ds in DS:
        bb = ds.bounds
        if xs[1] < bb.left or xs[0] > bb.right or ys[1] < bb.bottom or ys[0] > bb.top:
            continue
        win = rasterio.windows.from_bounds(max(xs[0], bb.left), max(ys[0], bb.bottom), min(xs[1], bb.right), min(ys[1], bb.top), ds.transform).round_offsets().round_lengths()
        if win.width < 2 or win.height < 2:
            continue
        src = ds.read(1, window=win).astype(np.float32)
        tmp = np.zeros((N, N), np.float32)
        rasterio.warp.reproject(src, tmp, src_transform=ds.window_transform(win), src_crs=ds.crs, dst_transform=tr, dst_crs=PROJ_LOCAL, resampling=rasterio.warp.Resampling.bilinear)
        chm = np.maximum(chm, tmp)
    name = f"{i}_{j}.bin"
    if chm.max() < 3:
        return ij, 0
    sm = ndimage.gaussian_filter(chm, 1.1)[M:-M, M:-M]
    hmax = ndimage.maximum_filter(chm, size=5)[M:-M, M:-M]
    can = sm >= 3.2
    if not can.any():
        return ij, 0
    rng = np.random.default_rng(i * 7919 + j * 104729 + 17)
    # masks at 1 m (row 0 = north)
    ground = read_ground(i, j)
    box = shapely.box(ox - 2, oy - 2, ox + TILE + 2, oy + TILE + 2)
    bi = B_TREE.query(box)
    bmask = np.zeros((1000, 1000), np.uint8)
    if len(bi):
        bmask = rasterio.features.rasterize([(g, 1) for g in shapely.buffer(B_GEOM[bi], 0.8)], out_shape=(1000, 1000), transform=from_origin(ox, oy + TILE, 1, 1), fill=0, dtype="uint8")
    blocked = (bmask > 0) | (ground == 1) | (ground == 4) | (ground == 8)
    # The canopy map resolves crowns as clumps, not single trees: seed candidates on a jittered grid inside the canopy
    # and thin them with a height-dependent spacing (tall trees stand further apart).
    sp0 = 3.0
    gy, gx = np.mgrid[0:int(1000 / sp0), 0:int(1000 / sp0)]
    cy = np.clip((gy * sp0 + sp0 / 2 + (rng.random(gy.shape) - 0.5) * 2.0).astype(int).ravel(), 0, 999)
    cx = np.clip((gx * sp0 + sp0 / 2 + (rng.random(gx.shape) - 0.5) * 2.0 + (gy % 2) * sp0 / 2).astype(int).ravel(), 0, 999)
    ok = can[cy, cx] & (bmask[cy, cx] == 0) & (ground[cy, cx] != 4)
    yy, xx = cy[ok], cx[ok]
    if len(xx) == 0:
        return ij, 0
    h = np.maximum(hmax[yy, xx], sm[yy, xx])
    # crowns over the carriageway belong to trunks at the kerb
    onr = (ground[yy, xx] == 1) | (ground[yy, xx] == 8)
    keep = np.ones(len(xx), bool)
    if onr.any():
        dist, (iy, ix) = ndimage.distance_transform_edt(blocked, return_indices=True)
        d = dist[yy, xx]
        mv = onr & (d <= 7.5)
        ny, nx = iy[yy, xx], ix[yy, xx]
        vy = ny - yy; vx = nx - xx; l = np.maximum(np.hypot(vx, vy), 1e-3)
        ty = np.clip(np.round(ny + vy / l * 0.9), 0, 999).astype(int); tx = np.clip(np.round(nx + vx / l * 0.9), 0, 999).astype(int)
        good = mv & ~blocked[ty, tx]
        yy = np.where(good, ty, yy); xx = np.where(good, tx, xx)
        keep &= ~onr | good
    yy, xx, h = yy[keep], xx[keep], h[keep]
    if len(xx) == 0:
        return ij, 0
    g0 = ground[yy, xx]
    is_street = (g0 == 2) | (g0 == 3)
    # spacing: street trees 6.5 m; others by height. Sparser outside the outer ring to keep the countryside light.
    dens = 1.0 if shapely.intersects(OUTER, box) else 1.5
    need = np.where(is_street, 6.5, np.clip(0.36 * h + 2.4, 3.6, 10.0) * dens) * (0.9 + 0.2 * rng.random(len(h)))
    order = np.argsort(-(h + rng.random(len(h)) * 2.0 + is_street * 100.0))      # street trees first, then tall ones
    CELL = 5.0
    gridh = {}
    acc = []
    for k in order:
        x, y, dk = xx[k], yy[k], need[k]
        cx0, cy0 = int(x // CELL), int(y // CELL)
        rad = int(dk // CELL) + 1
        ok2 = True
        for a_ in range(cx0 - rad, cx0 + rad + 1):
            for b_ in range(cy0 - rad, cy0 + rad + 1):
                for (x2, y2, d2) in gridh.get((a_, b_), ()):
                    dd = max(dk, d2) if not (is_street[k]) else dk
                    if (x - x2) ** 2 + (y - y2) ** 2 < dd * dd:
                        ok2 = False; break
                if not ok2: break
            if not ok2: break
        if ok2:
            gridh.setdefault((cx0, cy0), []).append((x, y, dk)); acc.append(k)
    acc = np.asarray(acc, int)
    yy, xx, h, need = yy[acc], xx[acc], h[acc], need[acc]
    n = len(xx)
    wx = ox + xx + 0.5; wy = oy + TILE - yy - 0.5
    g = ground[yy, xx]
    street = (g == 2) | (g == 3)
    # waterside: water within 9 m
    wd = ndimage.distance_transform_edt(ground != 4) if (ground == 4).any() else np.full((1000, 1000), 99.0)
    waterside = wd[yy, xx] < 9
    # land use from the land-cover raster (2 m, row 0 = south)
    lcp = os.path.join(WORK, "sections", "landcover", name)
    lu = np.zeros(n, np.uint8)
    if os.path.exists(lcp):
        raw = open(lcp, "rb").read()
        w_, h_ = struct.unpack_from("<II", raw, 0)
        lc = np.frombuffer(raw, np.uint8, w_ * h_, 8).reshape(h_, w_)
        lu = lc[np.clip(((wy - oy) / 2).astype(int), 0, h_ - 1), np.clip(((wx - ox) / 2).astype(int), 0, w_ - 1)] >> 4
    u = rng.random(n)
    sp = np.full(n, SP["broadleaf"], np.uint8)
    inner = shapely.contains_xy(INNER, wx, wy) & (wx < 2600)

    def pick(mask, table):
        names = list(table); p = np.array([table[k] for k in names], float); p /= p.sum()
        c = np.cumsum(p)
        idx = np.searchsorted(c, u[mask])
        sp[mask] = np.array([SP[k] for k in names], np.uint8)[np.minimum(idx, len(names) - 1)]

    park = (lu == 1) | (lu == 7) | (lu == 12) | (lu == 11)
    resi = (lu == 2) | (lu == 5) | (lu == 3)
    rural = (lu == 6) | (lu == 0) & ~inner
    pick(park, dict(camphor=30, metasequoia=14, ginkgo=10, cedar=10, magnolia=8, cherry=8, broadleaf=14, willow=3, osmanthus=3))
    pick(resi, dict(camphor=40, osmanthus=14, magnolia=12, cherry=8, broadleaf=16, palm=3, ginkgo=4, cedar=3))
    pick(rural & ~park & ~resi, dict(camphor=30, poplar=18, metasequoia=20, broadleaf=24, willow=8))
    pick((lu == 4) | (lu == 9) | (lu == 8) | (lu == 13) | (lu == 14) | (lu == 15) | (lu == 10), dict(camphor=45, broadleaf=30, poplar=10, cedar=8, ginkgo=7))
    # small trees are ornamentals, very tall ones are the fast growers
    small = h < 5.5
    pick(small & ~street, dict(osmanthus=40, cherry=25, magnolia=15, camphor=20))
    tall = h > 21
    pick(tall & ~street, dict(metasequoia=40, poplar=20, camphor=25, plane=15))
    pick(waterside & ~street, dict(willow=55, metasequoia=15, camphor=20, broadleaf=10))
    # streets: one species per street
    if street.any():
        pts = shapely.points(wx[street], wy[street])
        qi, ri_ = R_TREE.query_nearest(pts, max_distance=40.0, all_matches=False)
        rid = np.zeros(int(street.sum()), np.int64)
        rid[qi] = R_ID[ri_]
        hsh = ((rid * 2654435761) >> 11) % 100
        inn = inner[street]
        s_sp = np.where(inn, np.where(hsh < 68, SP["plane"], np.where(hsh < 90, SP["camphor"], SP["ginkgo"])),
                        np.where(hsh < 52, SP["camphor"], np.where(hsh < 66, SP["plane"], np.where(hsh < 78, SP["ginkgo"], np.where(hsh < 88, SP["metasequoia"], np.where(hsh < 95, SP["magnolia"], SP["broadleaf"]))))))
        sp[street] = s_sp.astype(np.uint8)
    # crown radius from height (allometry, species-shaped later in the client), with scatter
    r = np.clip(need * 0.6, 1.2, 8.5) * (0.9 + 0.25 * rng.random(n))
    blob = struct.pack("<I", n) + np.clip(np.round((wx - ox) * 10), 0, 9999).astype("<u2").tobytes() + np.clip(np.round((wy - oy) * 10), 0, 9999).astype("<u2").tobytes()
    blob += np.clip(np.round(h * 4), 1, 255).astype(np.uint8).tobytes() + np.clip(np.round(r * 10), 1, 255).astype(np.uint8).tobytes() + sp.tobytes() + rng.integers(0, 256, n, dtype=np.uint8).tobytes()
    open(os.path.join(WORK, "sections", "trees", name), "wb").write(pad4(blob))
    return ij, n


if __name__ == "__main__":
    for f in glob.glob(os.path.join(WORK, "sections", "trees", "*.bin")):
        os.remove(f)
    todo = [(i, j) for i in range(RANGE[0], RANGE[2]) for j in range(RANGE[1], RANGE[3])]
    log("tiles", len(todo))
    counts = {}
    # few workers, recycled often: each forked worker gradually takes its own copy of the parent's million building outlines
    gc.collect(); gc.freeze()
    with get_context("fork").Pool(min(PROCS, 6), maxtasksperchild=30) as pool:
        for n, (ij, c) in enumerate(pool.imap_unordered(do_tile, todo, chunksize=2)):
            counts[f"{ij[0]}_{ij[1]}"] = c
            if (n + 1) % 400 == 0:
                log(n + 1, "tiles;", sum(counts.values()), "trees")
    json.dump(counts, open(os.path.join(WORK, "tree_counts.json"), "w"))
    v = np.array(list(counts.values()))
    log("trees total", int(v.sum()), "per tile median", int(np.median(v)), "max", int(v.max()))
