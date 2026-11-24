"""Chongqing trees per tile: authentic mountain-city subtropical canopy!

Features Chongqing's iconic 黄葛树 (Ficus virens, species=0) alongside camphor (1), ginkgo (2),
metasequoia (3), willow (4), magnolia (5), mountain cypress/pine (6), osmanthus (7), broadleaf (12).
Synthesized cleanly from:
  - Real OSM mapped trees (natural=tree)
  - Sidewalk street tree rows along urban avenues
  - Lush subtropical woodland on Nanshan, Eling, Gele Mt, parks, and Yuzhong/Nanbin cliff slopes (from 2m landcover + DEM)
Strictly excludes buildings, water, carriageways, and rail beds.

Tile section: u32 n | u16 x[n] | u16 y[n] (dm from SW) | u8 h[n] (0.25m) | u8 r[n] (0.1m) | u8 species[n] | u8 seed[n]
usage: 32_trees.py <work_dir> [i0 j0 i1 j1]
"""
import sys, os, json, time, struct, glob, gc
os.environ.setdefault("GDAL_CACHEMAX", "128")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, geopandas as gpd, shapely
import rasterio.features
from rasterio.transform import from_origin
from scipy import ndimage
from multiprocessing import get_context
from common import *
from tilefmt import pad4

WORK = sys.argv[1]
RANGE = [int(v) for v in sys.argv[2:6]] if len(sys.argv) >= 6 else [0, 0, GRID_NX, GRID_NY]
T0 = time.time()
# 0: ficus_virens (黄葛树 - spreading gnarled canopy!), 1: camphor, 2: ginkgo, 3: metasequoia, 4: willow, 5: magnolia, 6: cedar/pine, 7: osmanthus, 12: broadleaf
SP = dict(ficus=0, camphor=1, ginkgo=2, metasequoia=3, willow=4, magnolia=5, cedar=6, osmanthus=7, poplar=8, bamboo=9, palm=10, cherry=11, broadleaf=12)


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["geometry"])
B_GEOM = b.geometry.values
B_TREE = shapely.STRtree(B_GEOM)
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"), columns=["geometry", "highway", "osm_id"])
rsel = np.isin(roads.highway.values, ["primary", "secondary", "tertiary", "residential", "unclassified", "trunk", "living_street"])
R_GEOM = project_geoms(roads.geometry.values[rsel])
R_ID = roads.osm_id.values[rsel]
R_TREE = shapely.STRtree(R_GEOM)

pts = gpd.read_parquet(os.path.join(WORK, "osm_points.parquet"))
tree_pts = pts[pts["kind"] == "natural=tree"]
OSM_TREE_XY = np.column_stack(to_local(tree_pts.geometry.x.values, tree_pts.geometry.y.values)) if len(tree_pts) else np.zeros((0, 2))

TERR_SAMPLER = TerrainSampler(WORK)
os.makedirs(os.path.join(WORK, "sections", "trees"), exist_ok=True)

# Load hero landmark exclusions & hero bridge corridors/abutments so ZERO trees punch through hero slabs or bridge walls!
HERO_EX_GEOMS = []
_excl_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "landmark_exclusions.json")
if os.path.exists(_excl_p):
    _ex = json.load(open(_excl_p))
    for c_ in _ex.get("circles", []):
        HERO_EX_GEOMS.append(shapely.Point(c_["x"], c_["y"]).buffer(float(c_["r"]) + 4.0, quad_segs=20))
    for p_ in _ex.get("polygons", []):
        HERO_EX_GEOMS.append(shapely.Polygon(p_).buffer(4.0, quad_segs=8))
_hb_p = os.path.join(WORK, "hero_bridges.json")
if os.path.exists(_hb_p):
    for z_ in json.load(open(_hb_p)).get("zones", []):
        if z_.get("kind") == "circle":
            HERO_EX_GEOMS.append(shapely.Point(z_["x"], z_["y"]).buffer(float(z_["r"]) + 4.0, quad_segs=20))
        else:
            p0 = np.array([z_["x0"], z_["y0"]], dtype=float)
            p1 = np.array([z_["x1"], z_["y1"]], dtype=float)
            dv = p1 - p0
            L_ = max(float(np.hypot(*dv)), 1e-6)
            u_ = dv / L_
            # Clear bridge deck corridor AND +45m abutment pads at both ends!
            HERO_EX_GEOMS.append(shapely.LineString([tuple(p0 - u_ * 45.0), tuple(p1 + u_ * 45.0)]).buffer(float(z_.get("half", 32.0)) * 0.85, cap_style="flat"))
            HERO_EX_GEOMS.append(shapely.Point(p0[0], p0[1]).buffer(38.0, quad_segs=16))
            HERO_EX_GEOMS.append(shapely.Point(p1[0], p1[1]).buffer(38.0, quad_segs=16))
# Extended Hongyadong 1F riverfront frontage box (clears stray tree in front of waterfall & red bridge in q08!)
_hy_c, _hy_s = np.cos(0.24), np.sin(0.24)
HERO_EX_GEOMS.append(shapely.Polygon([(105.92 + u * _hy_c - v * _hy_s, 507.56 + u * _hy_s + v * _hy_c)
                                      for u, v in ((-125, -48), (125, -48), (125, 76), (-125, 76), (-125, -48))]))
# Tunnel portal approach exclusion boxes (clears trees & overhanging branches blocking p01 / p02 tunnel mouths!)
_tun_p = os.path.join(WORK, "..", "..", "site", "data", "tunnels.json")
if os.path.exists(_tun_p):
    for tp_ in json.load(open(_tun_p)):
        px_, py_ = float(tp_["x"]), -float(tp_["z"])
        ux_, uy_ = float(tp_["dx"]), -float(tp_["dz"])  # points INTO tunnel
        # 26m wide corridor extending 24m IN FRONT of portal (-u) and 12m INTO portal (+u)
        seg_ = shapely.LineString([(px_ - ux_ * 24.0, py_ - uy_ * 24.0), (px_ + ux_ * 12.0, py_ + uy_ * 12.0)])
        HERO_EX_GEOMS.append(seg_.buffer(max(float(tp_.get("width", 10.0)) * 0.5 + 8.0, 14.0), cap_style="flat", quad_segs=2))
# Procedural elevated viaduct footprints (clears pine/ficus canopies poking straight through viaduct decks in q03!)
_dk_p = os.path.join(WORK, "decks.pkl")
if os.path.exists(_dk_p):
    import pickle
    for dk_ in pickle.load(open(_dk_p, "rb")):
        xyz_ = dk_["xyz"]
        hw_ = float(dk_["w"]) * 0.5 + 4.8
        # Collect contiguous elevated stretches (cl >= 1.5m)
        elev_m = xyz_[:, 2] >= 1.5
        st_ = None
        for qi_ in range(len(xyz_) + 1):
            if qi_ < len(xyz_) and elev_m[qi_]:
                st_ = qi_ if st_ is None else st_
            elif st_ is not None:
                if qi_ - st_ >= 2:
                    HERO_EX_GEOMS.append(shapely.LineString(xyz_[st_:qi_, :2]).buffer(hw_, cap_style="flat", quad_segs=2))
                st_ = None
HERO_EX_ARR = np.array(HERO_EX_GEOMS, dtype=object) if HERO_EX_GEOMS else np.zeros(0, dtype=object)
HERO_EX_TREE = shapely.STRtree(HERO_EX_ARR) if len(HERO_EX_ARR) else None
log("buildings", len(b), "roads", len(R_GEOM), "osm trees", len(OSM_TREE_XY), "hero excl shapes", len(HERO_EX_ARR))


def read_ground(i, j):
    p = os.path.join(WORK, "sections", "ground", f"{i}_{j}.bin")
    out = np.zeros((500, 500), np.uint8)
    if not os.path.exists(p):
        return out
    buf = open(p, "rb").read()
    np_, nr, nv = struct.unpack_from("<III", buf, 0)
    o = 12
    cls = np.frombuffer(buf, np.uint8, np_, o)
    nrings = np.frombuffer(buf, np.uint8, np_, o + np_)
    o += (np_ * 2 + 3) & ~3
    ringsize = np.frombuffer(buf, "<u2", nr, o)
    o += (nr * 2 + 3) & ~3
    xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.int64)
    vi = ri = 0
    shapes = []
    for k in range(np_):
        rr = []
        prev = np.zeros(2, np.int64)
        for _ in range(nrings[k]):
            n = ringsize[ri]; ri += 1
            pts_ = np.cumsum(np.vstack([prev, xy[vi:vi + n]]), axis=0)[1:]; vi += n; prev = pts_[-1]
            rr.append(pts_ * 0.1)
        if cls[k] != 20 and len(rr[0]) >= 3:
            shapes.append((shapely.Polygon(rr[0], rr[1:]), int(cls[k])))
    if shapes:
        out = rasterio.features.rasterize(shapes, out_shape=(500, 500), transform=from_origin(0, 1000, 2, 2), fill=0, dtype="uint8")
    return out


def do_tile(ij):
    i, j = ij
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    name = f"{i}_{j}.bin"
    lcp = os.path.join(WORK, "sections", "landcover", name)
    if not os.path.exists(lcp):
        return ij, 0
    raw = open(lcp, "rb").read()
    w_, h_ = struct.unpack_from("<II", raw, 0)
    lc = np.frombuffer(raw, np.uint8, w_ * h_, 8).reshape(h_, w_)[::-1]  # row 0 = north
    cov = lc & 15
    lu = lc >> 4

    ground = read_ground(i, j)
    box = shapely.box(ox - 2, oy - 2, ox + TILE + 2, oy + TILE + 2)
    bi = B_TREE.query(box)
    bmask = np.zeros((500, 500), np.uint8)
    if len(bi):
        bmask = rasterio.features.rasterize([(g, 1) for g in shapely.buffer(B_GEOM[bi], 1.2)], out_shape=(500, 500), transform=from_origin(ox, oy + TILE, 2, 2), fill=0, dtype="uint8")
    hmask = np.zeros((500, 500), np.uint8)
    if HERO_EX_TREE is not None:
        hi = HERO_EX_TREE.query(box)
        if len(hi):
            hmask = rasterio.features.rasterize([(g, 1) for g in HERO_EX_ARR[hi]], out_shape=(500, 500), transform=from_origin(ox, oy + TILE, 2, 2), fill=0, dtype="uint8")
    blocked = (bmask > 0) | (hmask > 0) | (ground == 1) | (ground == 4) | (ground == 8)

    rng = np.random.default_rng(i * 7919 + j * 104729 + 31)
    # Candidate locations on 2m grid:
    # 1) Wooded hillsides, parks, forests (cov == 2 or cov == 3)
    # 2) Sidewalk kerbs (ground == 2 or 3, next to roadway ground == 1)
    # 3) Residential estate courtyards (lu == 2 & cov == 1)
    road_adj = ndimage.binary_dilation(ground == 1, iterations=2) & ((ground == 2) | (ground == 3)) & ~blocked
    wooded = ((cov == 2) | (cov == 3) | (lu == 1) | (lu == 7)) & ~blocked & (ground != 5)
    courtyard = ((cov == 1) | (lu == 2) | (lu == 5)) & ~blocked & ~wooded & (ground == 0)

    cand_x, cand_y, cand_kind = [], [], []  # kind: 0 street, 1 park/forest, 2 courtyard, 3 osm
    # Street trees (every ~12m along sidewalk edges)
    sy, sx = np.where(road_adj[::4, ::4])
    if len(sx):
        sy = sy * 4 + rng.integers(0, 4, len(sy))
        sx = sx * 4 + rng.integers(0, 4, len(sx))
        sy = np.clip(sy, 0, 499); sx = np.clip(sx, 0, 499)
        ok = road_adj[sy, sx]
        cand_x.append(sx[ok]); cand_y.append(sy[ok]); cand_kind.append(np.zeros(int(ok.sum()), np.uint8))

    # Forest / hillside / park trees (spacing ~9-12m -> lush green Nanshan & cliffs without blowing GPU budget!)
    fy, fx = np.where(wooded[::5, ::5])
    if len(fx):
        fy = np.clip(fy * 5 + rng.integers(0, 5, len(fy)), 0, 499)
        fx = np.clip(fx * 5 + rng.integers(0, 5, len(fx)), 0, 499)
        ok = wooded[fy, fx] & (rng.random(len(fx)) < 0.72)
        cand_x.append(fx[ok]); cand_y.append(fy[ok]); cand_kind.append(np.ones(int(ok.sum()), np.uint8))

    # Courtyard / residential trees (sparse)
    cy, cx = np.where(courtyard[::7, ::7])
    if len(cx):
        cy = np.clip(cy * 7 + rng.integers(0, 7, len(cy)), 0, 499)
        cx = np.clip(cx * 7 + rng.integers(0, 7, len(cx)), 0, 499)
        ok = courtyard[cy, cx] & (rng.random(len(cx)) < 0.35)
        cand_x.append(cx[ok]); cand_y.append(cy[ok]); cand_kind.append(np.full(int(ok.sum()), 2, np.uint8))

    # Real OSM trees
    if len(OSM_TREE_XY):
        om = (OSM_TREE_XY[:, 0] >= ox + 1) & (OSM_TREE_XY[:, 0] < ox + TILE - 1) & (OSM_TREE_XY[:, 1] >= oy + 1) & (OSM_TREE_XY[:, 1] < oy + TILE - 1)
        if om.any():
            ox_ = np.clip(((OSM_TREE_XY[om, 0] - ox) / 2).astype(int), 0, 499)
            oy_ = np.clip(((oy + TILE - OSM_TREE_XY[om, 1]) / 2).astype(int), 0, 499)
            ok = ~blocked[oy_, ox_]
            cand_x.append(ox_[ok]); cand_y.append(oy_[ok]); cand_kind.append(np.full(int(ok.sum()), 3, np.uint8))

    if not cand_x:
        return ij, 0
    xx = np.concatenate(cand_x)
    yy = np.concatenate(cand_y)
    kk = np.concatenate(cand_kind)

    # Spatial thinning (street trees 11m, forest trees 9.5m, courtyard 12m)
    need_px = np.where(kk == 0, 5.5, np.where(kk == 1, 4.8, 6.0))  # in 2m pixels
    order = np.argsort(np.where(kk == 3, -10.0, np.where(kk == 0, -5.0, rng.random(len(xx)))))
    CELL = 6
    gridh = {}
    acc = []
    for idx in order:
        x_, y_, dk = int(xx[idx]), int(yy[idx]), float(need_px[idx])
        cx0, cy0 = x_ // CELL, y_ // CELL
        ok2 = True
        for a_ in range(cx0 - 1, cx0 + 2):
            for b_ in range(cy0 - 1, cy0 + 2):
                for (x2, y2, d2) in gridh.get((a_, b_), ()):
                    dd = max(dk, d2)
                    if (x_ - x2) ** 2 + (y_ - y2) ** 2 < dd * dd:
                        ok2 = False
                        break
                if not ok2:
                    break
            if not ok2:
                break
        if ok2:
            gridh.setdefault((cx0, cy0), []).append((x_, y_, dk))
            acc.append(idx)
            if len(acc) >= 4200:  # cap per 1km tile so dense forest tiles stay super fast
                break

    acc = np.asarray(acc, int)
    xx, yy, kk = xx[acc], yy[acc], kk[acc]
    n = len(xx)
    if n == 0:
        return ij, 0
    wx = ox + xx * 2.0 + rng.uniform(0.2, 1.8, n)
    wy = oy + TILE - yy * 2.0 - rng.uniform(0.2, 1.8, n)

    # Sample terrain elevation from TerrainSampler (2.5m core + 10m fine)
    elev = TERR_SAMPLER.sample(wx, wy)
    # Drop any tree accidentally below waterline
    dry = elev > 1.5
    wx, wy, xx, yy, kk, elev = wx[dry], wy[dry], xx[dry], yy[dry], kk[dry], elev[dry]
    n = len(wx)
    if n == 0:
        return ij, 0

    wd = ndimage.distance_transform_edt(ground != 4) if (ground == 4).any() else np.full((500, 500), 99.0)
    waterside = wd[yy, xx] < 6

    u = rng.random(n)
    sp = np.full(n, SP["camphor"], np.uint8)
    h = rng.uniform(7.5, 16.0, n)

    def pick(mask, table):
        if not mask.any():
            return
        names = list(table)
        p = np.array([table[k] for k in names], float); p /= p.sum()
        c = np.cumsum(p)
        idx = np.searchsorted(c, u[mask])
        sp[mask] = np.array([SP[k] for k in names], np.uint8)[np.minimum(idx, len(names) - 1)]

    # Mountain forest (Nanshan / hills): camphor, ficus, mountain pine/cypress, broadleaf
    high_hill = (kk == 1) & (elev > 140.0)
    low_hill = (kk == 1) & ~high_hill
    pick(high_hill, dict(cedar=38, camphor=32, ficus=12, broadleaf=14, ginkgo=4))
    pick(low_hill, dict(ficus=32, camphor=34, broadleaf=16, cedar=10, ginkgo=4, magnolia=4))
    pick(kk == 2, dict(ficus=30, camphor=30, osmanthus=16, magnolia=12, ginkgo=8, cherry=4))
    pick(waterside & (kk != 0), dict(willow=45, ficus=30, camphor=15, metasequoia=10))

    # Street trees: one species per road (Chongqing streets are famously lined with spreading 黄葛树 Ficus virens, camphor & ginkgo!)
    st = (kk == 0)
    if st.any():
        pts_s = shapely.points(wx[st], wy[st])
        qi, ri_ = R_TREE.query_nearest(pts_s, max_distance=40.0, all_matches=False)
        rid = np.zeros(int(st.sum()), np.int64)
        rid[qi] = R_ID[ri_]
        hsh = ((rid * 2654435761) >> 11) % 100
        sp[st] = np.where(hsh < 52, SP["ficus"], np.where(hsh < 80, SP["camphor"], np.where(hsh < 92, SP["ginkgo"], SP["magnolia"]))).astype(np.uint8)
        h[st] = rng.uniform(8.5, 14.5, int(st.sum()))

    # Ficus virens (黄葛树) has an extra-broad spreading canopy!
    h = np.where(sp == SP["ficus"], rng.uniform(9.5, 16.5, n), h)
    h = np.where(sp == SP["cedar"], rng.uniform(10.0, 19.0, n), h)
    r = np.where(sp == SP["ficus"], h * rng.uniform(0.46, 0.60, n), h * rng.uniform(0.32, 0.44, n))
    r = np.clip(r, 2.2, 9.5)

    blob = struct.pack("<I", n)
    blob += np.clip(np.round((wx - ox) * 10), 0, 9999).astype("<u2").tobytes()
    blob += np.clip(np.round((wy - oy) * 10), 0, 9999).astype("<u2").tobytes()
    blob += np.clip(np.round(h * 4), 1, 255).astype(np.uint8).tobytes()
    blob += np.clip(np.round(r * 10), 1, 255).astype(np.uint8).tobytes()
    blob += sp.tobytes()
    blob += rng.integers(0, 256, n, dtype=np.uint8).tobytes()
    open(os.path.join(WORK, "sections", "trees", name), "wb").write(pad4(blob))
    return ij, n


if __name__ == "__main__":
    if RANGE == [0, 0, GRID_NX, GRID_NY]:
        for f in glob.glob(os.path.join(WORK, "sections", "trees", "*.bin")):
            os.remove(f)
    todo = [(i, j) for i in range(RANGE[0], RANGE[2]) for j in range(RANGE[1], RANGE[3])]
    log("tiles", len(todo), "range", RANGE)
    counts = {}
    gc.collect(); gc.freeze()
    with get_context("fork").Pool(min(PROCS, 6), maxtasksperchild=40) as pool:
        for n, (ij, c) in enumerate(pool.imap_unordered(do_tile, todo, chunksize=2)):
            counts[f"{ij[0]}_{ij[1]}"] = c
            if (n + 1) % 100 == 0:
                log(n + 1, "tiles;", sum(counts.values()), "trees")
    json.dump(counts, open(os.path.join(WORK, "tree_counts.json"), "w"))
    v = np.array(list(counts.values())) if counts else np.array([0])
    log("trees total", int(v.sum()), "per tile median", int(np.median(v)), "max", int(v.max()))
