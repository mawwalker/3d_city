"""Cut Chongqing buildings into per-tile v2 ('CQT2') sections: base / mass / detail.

Includes per-building DEM ground_z_min, ground_z_max, podium_h, balcony_mask, subtype,
and per-edge flags (1 = street-facing, 2 = party wall).

usage: 30_build_tiles.py <work_dir> [landmark_exclusions.json] [i0 j0 i1 j1]
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *
from tilefmt import encode_buildings

WORK = sys.argv[1]
EXCL = sys.argv[2] if len(sys.argv) > 2 else None
RANGE = [int(v) for v in sys.argv[3:7]] if len(sys.argv) >= 7 else [0, 0, GRID_NX, GRID_NY]
T0 = time.time()

for d in ("base", "mass", "detail"):
    os.makedirs(os.path.join(WORK, "sections", d), exist_ok=True)
    if RANGE == [0, 0, GRID_NX, GRID_NY]:
        for f in os.listdir(os.path.join(WORK, "sections", d)):
            os.remove(os.path.join(WORK, "sections", d, f))


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"))
_bm = os.path.join(WORK, "boat_buildings.npy")
if os.path.exists(_bm):
    _m = np.load(_bm)
    if len(_m) == len(b):
        b = b[~_m].reset_index(drop=True)
        log("boats removed from buildings:", int(_m.sum()))

# Also remove any stray ML building polygon sitting inside the Yangtze / Jialing main rivers!
_tr_path = os.path.join(WORK, "two_rivers.json")
if os.path.exists(_tr_path):
    two_rivers = shapely.from_wkt(json.load(open(_tr_path)))
    shapely.prepare(two_rivers)
    in_w = shapely.contains(two_rivers, shapely.points(b["cx"].values, b["cy"].values))
    if in_w.any():
        b = b[~in_w].reset_index(drop=True)
        log("stray water footprints removed:", int(in_w.sum()))

# Landmark exclusions (exact polygon intersection + difference-clip so ZERO m² intrudes into heroes!)
def _largest_poly(g_, min_a=16.0):
    if g_ is None or g_.is_empty:
        return None
    if g_.geom_type == "Polygon":
        return g_ if g_.area >= min_a else None
    parts = [p for p in getattr(g_, "geoms", []) if p.geom_type == "Polygon" and p.area >= min_a]
    return max(parts, key=lambda p: p.area) if parts else None


if EXCL and os.path.exists(EXCL):
    ex = json.load(open(EXCL))
    kill = np.zeros(len(b), bool)
    ids = set(ex.get("osm_ids", []))
    if ids:
        kill |= b["osm_id"].isin(ids).values | b["outline_id"].isin(ids).values
    excl_shapes = []
    for c in ex.get("circles", []):
        excl_shapes.append(shapely.Point(c["x"], c["y"]).buffer(c["r"], quad_segs=24))
    for p in ex.get("polygons", []):
        excl_shapes.append(shapely.Polygon(p))
    if excl_shapes:
        excl_union = shapely.make_valid(shapely.union_all(excl_shapes))
        excl_tree = shapely.STRtree([excl_union])
        bgeoms = b.geometry.values.copy()
        hits = excl_tree.query(bgeoms, predicate="intersects")
        hit_idx = hits[0] if hits.ndim == 2 else hits
        n_clip = 0
        for idx in np.unique(hit_idx):
            if kill[idx]:
                continue
            g0 = bgeoms[idx]
            a0 = max(g0.area, 1e-6)
            inter_a = shapely.intersection(g0, excl_union).area
            if inter_a <= 0.1:
                continue
            # Drop if centroid inside OR >= 18% of footprint overlaps hero exclusion
            if inter_a / a0 >= 0.18 or excl_union.contains(g0.centroid):
                kill[idx] = True
            else:
                # Difference-clip partial edge intrusion cleanly while preserving neighboring tower
                rem = _largest_poly(shapely.difference(g0, excl_union.buffer(0.5)))
                if rem is None:
                    kill[idx] = True
                else:
                    bgeoms[idx] = rem
                    n_clip += 1
        b = b.set_geometry(gpd.GeoSeries(bgeoms, index=b.index, crs=b.crs))
        if n_clip:
            c_new = shapely.centroid(b.geometry.values)
            b["cx"] = shapely.get_x(c_new)
            b["cy"] = shapely.get_y(c_new)
            b["area"] = shapely.area(b.geometry.values)
        log(f"landmark exclusions: dropped {int(kill.sum())}, edge-clipped {n_clip}")
    b = b[~kill].reset_index(drop=True)

# Hero bridge corridor clearance: clear/clip buildings poking through hero bridge decks, trusses & bridge-head approaches!
_lm_stage = os.path.join(WORK, "..", "..", "site", "data_stage", "landmarks.json")
_lm_path = _lm_stage if os.path.exists(_lm_stage) else os.path.join(WORK, "..", "..", "site", "data", "landmarks.json")
if os.path.exists(_lm_path):
    _lm = json.load(open(_lm_path))
    br_corrs = []
    for br in _lm.get("bridges", []):
        if br.get("kind") in ("spiral_overpass", "multilevel_interchange"):
            continue
        p0 = np.array([br["p0"][0], -br["p0"][1]], dtype=float)  # WebGL (x, z) -> pipeline (x, -z)
        p1 = np.array([br["p1"][0], -br["p1"][1]], dtype=float)
        dv = p1 - p0
        L_ = max(float(np.hypot(*dv)), 1e-6)
        u_ = dv / L_
        # Extend +-55 m past p0 & p1 along bridge axis so approach spans & abutments (e.g. Dongshuimen t12!) never crash into towers!
        seg = shapely.LineString([tuple(p0 - u_ * 55.0), tuple(p1 + u_ * 55.0)])
        hw = float(br.get("width", 28.0)) * 0.5 + 8.5
        br_corrs.append((seg.buffer(hw, cap_style="flat"), float(br.get("deckY", 50.0))))
    if br_corrs:
        corr_geoms = np.array([c[0] for c in br_corrs], dtype=object)
        corr_deck = np.array([c[1] for c in br_corrs], dtype=float)
        ctree = shapely.STRtree(corr_geoms)
        bgeoms = b.geometry.values.copy()
        bi, ci = ctree.query(bgeoms, predicate="intersects")
        topY = b["ground_z_max"].values.astype(float) + b["height"].values.astype(float)
        kill_b = np.zeros(len(b), bool)
        n_bclip = 0
        # Group corridors per building
        by_b = {}
        for i_, j_ in zip(bi.tolist(), ci.tolist()):
            if topY[i_] > corr_deck[j_] - 14.0:
                by_b.setdefault(i_, []).append(corr_geoms[j_])
        for i_, cg_list in by_b.items():
            u_c = shapely.union_all(cg_list)
            g0 = bgeoms[i_]
            a0 = max(g0.area, 1e-6)
            inter_a = shapely.intersection(g0, u_c).area
            if inter_a <= 0.1:
                continue
            if inter_a / a0 >= 0.22:
                kill_b[i_] = True
            else:
                rem = _largest_poly(shapely.difference(g0, u_c.buffer(0.8)))
                if rem is None:
                    kill_b[i_] = True
                else:
                    bgeoms[i_] = rem
                    n_bclip += 1
        if kill_b.any() or n_bclip:
            b = b.set_geometry(gpd.GeoSeries(bgeoms, index=b.index, crs=b.crs))
            b = b[~kill_b].reset_index(drop=True)
            c_new = shapely.centroid(b.geometry.values)
            b["cx"] = shapely.get_x(c_new)
            b["cy"] = shapely.get_y(c_new)
            b["area"] = shapely.area(b.geometry.values)
        log(f"hero bridge corridor clearance: dropped {int(kill_b.sum())}, edge-clipped {n_bclip}")

# Procedural elevated viaduct/deck clearance: clear/clip procedural buildings crashing into elevated `decks.pkl` viaducts (fixes q06!)
_dk_path = os.path.join(WORK, "decks.pkl")
if os.path.exists(_dk_path):
    import pickle
    _ts_dk = TerrainSampler(WORK)
    dk_corrs, dk_ys = [], []
    for dk in pickle.load(open(_dk_path, "rb")):
        xyz = dk["xyz"]
        hw_ = float(dk["w"]) * 0.5 + 2.5
        for a_, b_ in zip(xyz[:-1], xyz[1:]):
            cl_m = 0.5 * (float(a_[2]) + float(b_[2]))
            if cl_m < 1.5:
                continue
            seg_l = float(np.hypot(b_[0] - a_[0], b_[1] - a_[1]))
            if seg_l < 0.5:
                continue
            seg = shapely.LineString([(float(a_[0]), float(a_[1])), (float(b_[0]), float(b_[1]))])
            mx, my = 0.5 * (float(a_[0]) + float(b_[0])), 0.5 * (float(a_[1]) + float(b_[1]))
            dy_w = max(_ts_dk.sample(mx, my), 0.0) + cl_m
            dk_corrs.append(seg.buffer(hw_, cap_style="flat", quad_segs=2))
            dk_ys.append(dy_w)
    if dk_corrs:
        dk_arr = np.array(dk_corrs, dtype=object)
        dk_y_arr = np.array(dk_ys, dtype=float)
        dktree = shapely.STRtree(dk_arr)
        bgeoms = b.geometry.values.copy()
        bi, di = dktree.query(bgeoms, predicate="intersects")
        # Quick terrain height check for vertical overlap between building [botY, topY] and viaduct [deckY - 3.5, deckY + 5.5]
        gz_c = _ts_dk.sample(b["cx"].values, b["cy"].values)
        bv_dk = b["base"].values.astype(float)
        botY_b = np.where(bv_dk > 0, gz_c + bv_dk, np.minimum(gz_c, b["ground_z_min"].values.astype(float)) - 4.0)
        topY_b = np.maximum(gz_c, b["ground_z_max"].values.astype(float)) + bv_dk + b["height"].values.astype(float)
        by_b = {}
        for i_, j_ in zip(bi.tolist(), di.tolist()):
            if topY_b[i_] > dk_y_arr[j_] - 3.5 and botY_b[i_] < dk_y_arr[j_] + 5.5:
                by_b.setdefault(i_, []).append(dk_arr[j_])
        kill_dk = np.zeros(len(b), bool)
        n_dkclip = 0
        for i_, cg_list in by_b.items():
            u_c = shapely.union_all(cg_list)
            g0 = bgeoms[i_]
            a0 = max(g0.area, 1e-6)
            inter_a = shapely.intersection(g0, u_c).area
            if inter_a <= 0.5:
                continue
            if inter_a / a0 >= 0.18:
                kill_dk[i_] = True
            else:
                rem = _largest_poly(shapely.difference(g0, u_c.buffer(1.4)))
                if rem is None:
                    kill_dk[i_] = True
                else:
                    bgeoms[i_] = rem
                    n_dkclip += 1
        if kill_dk.any() or n_dkclip:
            b = b.set_geometry(gpd.GeoSeries(bgeoms, index=b.index, crs=b.crs))
            b = b[~kill_dk].reset_index(drop=True)
            c_new = shapely.centroid(b.geometry.values)
            b["cx"] = shapely.get_x(c_new)
            b["cy"] = shapely.get_y(c_new)
            b["area"] = shapely.area(b.geometry.values)
        log(f"procedural elevated deck building clearance: dropped {int(kill_dk.sum())}, edge-clipped {n_dkclip}")

# Filter to requested tile range (with small margin for split pieces)
rx0 = GRID_X0 + RANGE[0] * TILE - 100.0
ry0 = GRID_Y0 + RANGE[1] * TILE - 100.0
rx1 = GRID_X0 + RANGE[2] * TILE + 100.0
ry1 = GRID_Y0 + RANGE[3] * TILE + 100.0
in_rng = (b["cx"].values >= rx0) & (b["cx"].values <= rx1) & (b["cy"].values >= ry0) & (b["cy"].values <= ry1)
b = b[in_rng].reset_index(drop=True)
log("buildings in tile range", RANGE, ":", len(b))

# Cut oversized footprints along tile boundaries
bb = shapely.bounds(b.geometry.values)
tcx = GRID_X0 + (np.floor((b["cx"].values - GRID_X0) / TILE) + 0.5) * TILE
tcy = GRID_Y0 + (np.floor((b["cy"].values - GRID_Y0) / TILE) + 0.5) * TILE
REACH = 760.0
bigm = (bb[:, 0] < tcx - REACH) | (bb[:, 2] > tcx + REACH) | (bb[:, 1] < tcy - REACH) | (bb[:, 3] > tcy + REACH)
b["split"] = False
if bigm.any():
    rows = []
    for idx in np.where(bigm)[0]:
        r = b.iloc[idx]
        x0, y0, x1, y1 = bb[idx]
        for i in range(int(np.floor((x0 - GRID_X0) / TILE)), int(np.floor((x1 - GRID_X0) / TILE)) + 1):
            for j in range(int(np.floor((y0 - GRID_Y0) / TILE)), int(np.floor((y1 - GRID_Y0) / TILE)) + 1):
                piece = shapely.intersection(r.geometry, shapely.box(GRID_X0 + i * TILE, GRID_Y0 + j * TILE, GRID_X0 + (i + 1) * TILE, GRID_Y0 + (j + 1) * TILE))
                for q in (piece.geoms if hasattr(piece, "geoms") else [piece]):
                    if q.geom_type == "Polygon" and q.area >= 8:
                        rr = r.copy(); rr["geometry"] = q; c_ = q.representative_point()
                        rr["cx"] = c_.x; rr["cy"] = c_.y; rr["area"] = q.area; rr["split"] = True
                        rows.append(rr)
    b = pd.concat([b[~bigm], gpd.GeoDataFrame(rows, geometry="geometry", crs=b.crs)], ignore_index=True)
    b = gpd.GeoDataFrame(b, geometry="geometry")

g = b.geometry.values
area = b["area"].values.copy()
height = b["height"].values.astype(float)
basev = b["base"].values.astype(float)
# Resample ground_z_min / ground_z_max directly from the current TerrainSampler (2.5m road-benched terrain_core!)
_ts = TerrainSampler(WORK)
_ext_rings = shapely.get_exterior_ring(g)
_ext_xy = shapely.get_coordinates(_ext_rings)
_ext_n = shapely.get_num_coordinates(_ext_rings)
_ext_z = _ts.sample(_ext_xy[:, 0], _ext_xy[:, 1])
_c_z = _ts.sample(b["cx"].values, b["cy"].values)
_starts = np.concatenate([[0], np.cumsum(_ext_n[:-1])])
gz_min = np.minimum(_c_z, np.minimum.reduceat(_ext_z, _starts))
gz_max = np.maximum(_c_z, np.maximum.reduceat(_ext_z, _starts))
gz_min = np.maximum(gz_min, 0.2)
gz_max = np.maximum(gz_max, gz_min)
log(f"resampled building ground_z from TerrainSampler (core+fine): min={gz_min.min():.1f}m max={gz_max.max():.1f}m")
style = b["style"].values.astype(np.uint8)
roof = b["roof_code"].values.astype(np.uint8)
podium_h = b["podium_h"].values.astype(float)
bmask = b["balcony_mask"].values.astype(np.uint8)
subtype = b["subtype"].values.astype(np.uint8)
pal = b["pal"].values.astype(np.uint8)
seed = b["seed"].values.astype(np.uint8)
levels = b["levels"].values.astype(int)
CX = b["cx"].values.copy()
CY = b["cy"].values.copy()
roof[b["split"].values.astype(bool)] = ROOF["flat"]

# Simplify & orient
tol = np.where(b["src"].values == "osm", 0.25, 0.50)
gs = g.copy()
for t in np.unique(tol):
    m = tol == t
    gs[m] = shapely.simplify(g[m], t, preserve_topology=True)
gs = shapely.make_valid(gs)
for i in np.where(shapely.get_type_id(gs) == 6)[0]:
    parts = [p for p in gs[i].geoms if p.geom_type == "Polygon"]
    if parts:
        gs[i] = max(parts, key=lambda p: p.area)
nh = shapely.get_num_interior_rings(gs)
for i in np.where(nh > 0)[0]:
    p = gs[i]
    if p.geom_type == "Polygon":
        keep = [r for r in p.interiors if shapely.Polygon(r).area >= 20.0]
        if len(keep) != len(p.interiors):
            gs[i] = shapely.Polygon(p.exterior, keep)
ok = (shapely.get_type_id(gs) == 3) & (shapely.area(gs) >= 8.0) & ~shapely.is_empty(gs)
gs = shapely.orient_polygons(gs)
ti_ = np.floor((CX - GRID_X0) / TILE).astype(int)
tj_ = np.floor((CY - GRID_Y0) / TILE).astype(int)
ok &= (ti_ >= RANGE[0]) & (ti_ < RANGE[2]) & (tj_ >= RANGE[1]) & (tj_ < RANGE[3])
log("valid polygons before 3D de-overlap:", int(ok.sum()))

# ---------------------------------------------------------------- Phase 5: ZERO 3D overlap & ZERO coplanar walls!
# Eliminates all OSM/GBA/Overture overlapping duplicates, parallax-shifted overlaps, stacked building:part bands,
# and 0.00m coplanar touching walls (surviving tilefmt 0.1m decimetre quantization!) BEFORE party-wall edge probing.
def _quantize_poly_dm(p):
    """Snap polygon coordinates to exact 0.1m decimetre grid matching tilefmt.py so no new overlaps appear at pack time."""
    if p is None or p.is_empty or p.geom_type != "Polygon":
        return None
    ext_c = np.round(np.asarray(p.exterior.coords, dtype=np.float64) * 10.0) * 0.1
    if len(ext_c) < 4:
        return None
    holes = []
    for r in p.interiors:
        hc = np.round(np.asarray(r.coords, dtype=np.float64) * 10.0) * 0.1
        if len(hc) >= 4:
            hp = shapely.Polygon(hc)
            if hp.is_valid and hp.area >= 20.0:
                holes.append(hc)
    q = shapely.Polygon(ext_c, holes)
    if not q.is_valid:
        q = shapely.make_valid(q)
    q = _largest_poly(q, min_a=8.0)
    return shapely.geometry.polygon.orient(q) if q is not None else None


_src_arr = b["src"].values.astype(str)
_isp_arr = b["is_part"].values.astype(bool)
_src_rank = np.where(_src_arr == "osm", 3, np.where(_src_arr == "gba_osm", 2, np.where(_src_arr == "ovml", 0, 1)))
# Within OSM, detailed building:parts win over leftover unreplaced outlines; taller/larger buildings win ties.
_prio = _src_rank * 1e9 + np.where((_src_arr == "osm") & _isp_arr, 2e8, 0.0) + height * 1e4 + np.minimum(area, 9999.0)

# Step 5A: Clean vertical stack separation for OSM building:part pairs sharing >= 50% footprint with <= 3.0m band overlap
_act = np.flatnonzero(ok)
_part_idx = _act[_isp_arr[_act]]
if len(_part_idx) >= 2:
    _ptree = shapely.STRtree(gs[_part_idx])
    _pa, _pb = _ptree.query(gs[_part_idx], predicate="intersects")
    _pm = _pa < _pb
    _n_vsep = 0
    for _u, _v in zip(_part_idx[_pa[_pm]].tolist(), _part_idx[_pb[_pm]].tolist()):
        # Ensure _u is the lower piece (smaller top height) and _v is the upper piece
        if height[_u] > height[_v]:
            _u, _v = _v, _u
        if basev[_v] <= basev[_u] + 0.5:
            continue
        _ov_z = height[_u] - basev[_v]
        if 0.0 <= _ov_z <= 3.5:
            _ia = shapely.intersection(gs[_u], gs[_v]).area
            _mina = max(min(gs[_u].area, gs[_v].area), 1e-6)
            if _ia / _mina >= 0.45 and (height[_v] - (height[_u] + 0.15)) >= 1.5:
                basev[_v] = height[_u] + 0.15
                _n_vsep += 1
    if _n_vsep:
        log(f"3D de-overlap step 5A: separated {_n_vsep} stacked building:part vertical bands")


def _deoverlap_pass(pass_num, pad_m, min_dist_m):
    """Priority-ordered 3D non-overlap + anti-coplanar-wall clipping pass."""
    act = np.flatnonzero(ok)
    if len(act) < 2:
        return 0, 0
    # Match buildingGeom.js vertical extents conservatively (plinths descend 4m below gz_min when base==0)
    lo_z = np.where(basev > 0.05, gz_min + basev - 0.3, gz_min - 4.0)
    hi_z = gz_max + height + 0.3
    G_act = gs[act]
    # Query pairs within min_dist_m (catches BOTH intersections AND coplanar/near-coplanar touching walls!)
    tree_a = shapely.STRtree(G_act)
    ai, bi = tree_a.query(shapely.buffer(G_act, min_dist_m, join_style="mitre", mitre_limit=2.0), predicate="intersects")
    m = ai < bi
    ai, bi = ai[m], bi[m]
    if not len(ai):
        return 0, 0
    ga, gb = act[ai], act[bi]
    # Keep only vertically overlapping pairs
    vm = np.minimum(hi_z[ga], hi_z[gb]) > np.maximum(lo_z[ga], lo_z[gb])
    ga, gb = ga[vm], gb[vm]
    if not len(ga):
        return 0, 0
    # Group higher-priority blockers per lower-priority building
    blockers = {}
    for u, v in zip(ga.tolist(), gb.tolist()):
        if _prio[u] > _prio[v] or (_prio[u] == _prio[v] and u < v):
            hi_i, lo_i = u, v
        else:
            hi_i, lo_i = v, u
        blockers.setdefault(lo_i, []).append(hi_i)
    # Process in descending priority order so surviving higher-priority geometry is finalized first
    n_drop = 0
    n_clip = 0
    for lo_i in sorted(blockers.keys(), key=lambda idx: -_prio[idx]):
        if not ok[lo_i]:
            continue
        hi_list = [h_ for h_ in blockers[lo_i] if ok[h_]]
        if not hi_list:
            continue
        g0 = gs[lo_i]
        a0 = max(g0.area, 1e-6)
        hi_geoms = [gs[h_] for h_ in hi_list]
        u_hi = shapely.union_all(hi_geoms) if len(hi_geoms) > 1 else hi_geoms[0]
        # Exact overlap check
        inter = shapely.intersection(g0, u_hi)
        ov_a = inter.area
        dist_m = 0.0 if ov_a > 0.0 else float(shapely.distance(g0, u_hi))
        if ov_a <= 0.0 and dist_m >= min_dist_m:
            continue
        if ov_a / a0 >= 0.45:
            ok[lo_i] = False
            n_drop += 1
            continue
        # Clip with anti-Z-fighting gap pad_m (survives 0.1m tilefmt quantization while staying < 0.7m party-wall probe!)
        # Use round join on pass >= 2 so acute mitre-limit corners never leave <0.06m slivers!
        if pass_num >= 2:
            cutter = shapely.buffer(u_hi, pad_m, quad_segs=3)
        else:
            cutter = shapely.buffer(u_hi, pad_m, join_style="mitre", mitre_limit=2.0)
        rem = _largest_poly(shapely.difference(g0, cutter), min_a=8.0)
        if rem is None:
            ok[lo_i] = False
            n_drop += 1
        else:
            rem_q = _quantize_poly_dm(rem) if pass_num >= 2 else shapely.geometry.polygon.orient(rem)
            if rem_q is None:
                ok[lo_i] = False
                n_drop += 1
            else:
                # If quantization pulled rem_q back within min_dist_m of u_hi, erode slightly more and re-quantize
                if pass_num >= 2 and (shapely.intersects(rem_q, u_hi) or float(shapely.distance(rem_q, u_hi)) < min_dist_m):
                    rem2 = _largest_poly(shapely.difference(g0, shapely.buffer(u_hi, pad_m + 0.14, quad_segs=3)), min_a=8.0)
                    rem_q = _quantize_poly_dm(rem2) if rem2 is not None else None
                if rem_q is None:
                    ok[lo_i] = False
                    n_drop += 1
                else:
                    gs[lo_i] = rem_q
                    n_clip += 1
    return n_drop, n_clip


_d1, _c1 = _deoverlap_pass(1, pad_m=0.22, min_dist_m=0.14)
log(f"3D de-overlap pass 1 (pad=0.22m): dropped {_d1}, clipped {_c1}")

# Snap ALL surviving polygons to exact 0.1m decimetre grid matching tilefmt.py!
_n_qdrop = 0
for _idx in np.flatnonzero(ok):
    _q = _quantize_poly_dm(gs[_idx])
    if _q is None:
        ok[_idx] = False
        _n_qdrop += 1
    else:
        gs[_idx] = _q
if _n_qdrop:
    log(f"decimetre quantization dropped {_n_qdrop} degenerate slivers")

# Pass 2..4 on ALREADY 0.1m-quantized polygons -> GUARANTEES 0 overlaps & 0 coplanar walls in packed CQT2 tiles!
for _pn in (2, 3, 4):
    _dn, _cn = _deoverlap_pass(_pn, pad_m=0.26, min_dist_m=0.06)
    log(f"3D de-overlap pass {_pn} (post-quantization): dropped {_dn}, clipped {_cn}")
    if _dn == 0 and _cn == 0:
        break

# Update centroids, areas, and tile indices for any clipped polygons
_act_fin = np.flatnonzero(ok)
_c_fin = shapely.centroid(gs[_act_fin])
CX[_act_fin] = shapely.get_x(_c_fin)
CY[_act_fin] = shapely.get_y(_c_fin)
area[_act_fin] = shapely.area(gs[_act_fin])
ti_ = np.floor((CX - GRID_X0) / TILE).astype(int)
tj_ = np.floor((CY - GRID_Y0) / TILE).astype(int)
ok &= (ti_ >= RANGE[0]) & (ti_ < RANGE[2]) & (tj_ >= RANGE[1]) & (tj_ < RANGE[3])
log("valid non-overlapping polygons after Phase 5 3D de-overlap:", int(ok.sum()))

# Ensure no tall building (>28m) ever gets assigned a windowless/generic fallback style
tall_gen = (height >= 28.0) & np.isin(style, [ST["generic"], ST["canopy"], ST["parking"], ST["construction"]])
if tall_gen.any():
    style = style.copy()
    style[tall_gen] = np.where(area[tall_gen] > 2600, ST["office_grid"], ST["resi_modern"]).astype(np.uint8)
    log("upgraded tall generic/fallback buildings to windowed styles:", int(tall_gen.sum()))

# ---------------------------------------------------------------- edge flags (party wall + street frontage)
idx_ok = np.where(ok)[0]
ext = shapely.get_exterior_ring(gs[idx_ok])
ext_xy = shapely.get_coordinates(ext)
ext_n = shapely.get_num_coordinates(ext)
starts = np.concatenate([[0], np.cumsum(ext_n)])
p0 = ext_xy[:-1]
p1 = ext_xy[1:]
valid_edge = np.ones(len(ext_xy) - 1, bool)
valid_edge[starts[1:-1] - 1] = False
bld_of_edge = np.repeat(np.arange(len(idx_ok)), ext_n)[:-1]
e = p1 - p0
elen = np.hypot(e[:, 0], e[:, 1])
nrm = np.column_stack([e[:, 1], -e[:, 0]]) / np.maximum(elen, 1e-6)[:, None]
mid = (p0 + p1) / 2
flags = np.zeros(len(e), np.uint8)
use = valid_edge & (elen > 0.8)
tree = shapely.STRtree(gs[idx_ok])
probe = shapely.points(mid[use] + nrm[use] * 0.7)
qi, tj2 = tree.query(probe, predicate="within")
ue = np.where(use)[0]
bi_self = bld_of_edge[ue[qi]]
# A touching building only makes a wall a windowless party wall if it overlaps VERTICALLY and reaches >= 65% of this building's height!
# (Prevents tall towers sitting atop low-rise podiums like 庆隆海客瀛洲 from getting all walls falsely marked party_wall!)
top_ok = gz_max[idx_ok] + height[idx_ok]
bot_ok = gz_max[idx_ok] + basev[idx_ok]
span_self = np.maximum(top_ok[bi_self] - bot_ok[bi_self], 1.0)
other = (tj2 != bi_self) & (top_ok[tj2] > bot_ok[bi_self] + 2.0) & (top_ok[tj2] >= bot_ok[bi_self] + 0.65 * span_self)
party = np.zeros(len(e), bool)
party[ue[qi[other]]] = True
flags[party] |= 2

roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
rt = [json.loads(t) for t in roads["tags"].values]
hw = roads.highway.values
FRONT = {"primary": 16, "secondary": 13, "tertiary": 11, "residential": 8, "unclassified": 8, "pedestrian": 9, "living_street": 6, "trunk": 18, "steps": 6}
sel = np.isin(hw, list(FRONT)) & np.array([not (t.get("bridge") not in (None, "no") or t.get("tunnel") not in (None, "no")) for t in rt])
rg = project_geoms(roads.geometry.values[sel])
rhw = hw[sel]
rtree = shapely.STRtree(rg)
cand = ue[~party[ue]]
pts = shapely.points(mid[cand])
qi, ri = rtree.query_nearest(pts, max_distance=30.0, all_matches=False)
sl = shapely.shortest_line(pts[qi], rg[ri])
sc = shapely.get_coordinates(sl).reshape(-1, 2, 2)
v = sc[:, 1] - sc[:, 0]
dist = np.hypot(v[:, 0], v[:, 1])
facing = (v * nrm[cand[qi]]).sum(1) / np.maximum(dist, 1e-6)
reach = np.array([FRONT[h] for h in rhw[ri]]) + 9.0
front = (facing > 0.55) & (dist < reach) & (elen[cand[qi]] >= 3.0)
flags[cand[qi[front]]] |= 1
has_front = np.zeros(len(idx_ok), bool)
np.logical_or.at(has_front, bld_of_edge[cand[qi[front]]], True)
log("edges", int(use.sum()), "party walls", int(party.sum()), "street-front", int(front.sum()))

edge_lists = {}
for k, i in enumerate(idx_ok):
    edge_lists[i] = [flags[starts[k]:starts[k + 1] - 1]]

# Building flags: b0 is_part, b1 named, b2 street_front, b3 osm, b4 steep_slope (>=4m), b5 commercial_ground
bflags = np.zeros(len(b), np.uint8)
bflags[b["is_part"].values] |= 1
bflags[b["name"].notna().values] |= 2
bflags[idx_ok[has_front]] |= 4
bflags[b["src"].values == "osm"] |= 8
bflags[(gz_max - gz_min) >= 4.0] |= 16
comm_ground = np.isin(style, [
    ST["commercial_mall"], ST["office_grid"], ST["office_glass"], ST["cbd_supertall"],
    ST["hotel"], ST["resi_old_highrise"], ST["bayu_vernacular"],
]) & ((bflags & 4) > 0)
bflags[comm_ground] |= 32

is_base = (area >= 220) | (height >= 22) | ((style == ST["tank"]) & (height > 25)) | (style == ST["temple"]) | (style == ST["historic_masonry"])
log("base", int((is_base & ok).sum()), "detail", int((~is_base & ok).sum()))


def make_masses(polys, hgt, gmn, gmx, sty, pl, base_polys=None):
    empty = ([], np.zeros(0), np.zeros(0), np.zeros(0), np.zeros(0, np.uint8), np.zeros(0, np.uint8))
    if len(polys) == 0:
        return empty
    r = 3.0
    arr = np.asarray(polys, dtype=object)
    u = shapely.union_all(shapely.buffer(arr, r, join_style="mitre", mitre_limit=2.0))
    u = shapely.buffer(u, -r, join_style="mitre", mitre_limit=2.0)
    u = shapely.simplify(u, 1.2, preserve_topology=True)
    # Phase 5: subtract tile's base buildings (+0.35m gap) AFTER simplify so FAR/MID mass blobs NEVER overlap base towers!
    if base_polys:
        bu = shapely.union_all(shapely.buffer(np.asarray(base_polys, dtype=object), 0.35, join_style="mitre", mitre_limit=2.0))
        u = shapely.difference(u, bu)
    parts = [p for p in (u.geoms if hasattr(u, "geoms") else [u]) if p.geom_type == "Polygon" and p.area >= 60]
    if not parts:
        return empty
    parts = [shapely.Polygon(p.exterior, [h_ for h_ in p.interiors if shapely.Polygon(h_).area >= 120]) for p in parts]
    parts = [shapely.geometry.polygon.orient(p) for p in parts]
    ptree = shapely.STRtree(np.asarray(parts, dtype=object))
    pts = shapely.point_on_surface(arr)
    qi, ti = ptree.query(pts, predicate="within")
    a = shapely.area(arr)
    mh = np.zeros(len(parts)); mw = np.zeros(len(parts))
    mgmn = np.full(len(parts), 1e9); mgmx = np.full(len(parts), -1e9)
    np.add.at(mh, ti, hgt[qi] * a[qi]); np.add.at(mw, ti, a[qi])
    np.minimum.at(mgmn, ti, gmn[qi]); np.maximum.at(mgmx, ti, gmx[qi])
    ms = np.zeros(len(parts), np.uint8); mp = np.zeros(len(parts), np.uint8)
    df = pd.DataFrame({"t": ti, "s": sty[qi], "p": pl[qi], "a": a[qi]})
    top = df.groupby(["t", "s"]).a.sum().reset_index().sort_values("a").drop_duplicates("t", keep="last")
    ms[top.t.values] = top.s.values
    topp = df.sort_values("a").drop_duplicates("t", keep="last")
    mp[topp.t.values] = topp.p.values
    good = mw > 0
    hh = np.where(good, mh / np.maximum(mw, 1e-6), 4.0) * 0.95
    idx = np.where(good)[0]
    idx = idx[np.argsort([-parts[i].area for i in idx])]
    return [parts[i] for i in idx], hh[idx], mgmn[idx], mgmx[idx], ms[idx], mp[idx]


key = ti_ * 1000 + tj_
groups = pd.Series(idx_ok).groupby(key[idx_ok]).apply(lambda s: s.values)
tiles_p = os.path.join(WORK, "tiles_buildings.json")
tiles = json.load(open(tiles_p))["tiles"] if os.path.exists(tiles_p) and RANGE != [0, 0, GRID_NX, GRID_NY] else {}
tot = dict(base=0, mass=0, detail=0)
for kk, idx in groups.items():
    i, j = int(kk // 1000), int(kk % 1000)
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    ib = idx[is_base[idx]]
    idt = idx[~is_base[idx]]
    ib = ib[np.argsort(-height[ib] * np.sqrt(area[ib]))]

    def enc(sel):
        attrs = dict(
            height=height[sel] - basev[sel], base=basev[sel],
            ground_z_min=gz_min[sel], ground_z_max=gz_max[sel],
            levels=levels[sel], style=style[sel], roof=roof[sel],
            seed=seed[sel], pal=pal[sel], flags=bflags[sel],
            podium_h=podium_h[sel], balcony_mask=bmask[sel], subtype=subtype[sel],
        )
        return encode_buildings(list(gs[sel]), attrs, ox, oy, [edge_lists[s] for s in sel])

    bb, kb = enc(ib)
    db, kd = enc(idt)
    mp_, mh_, mgmn_, mgmx_, ms_, mpal_ = make_masses(list(gs[idt]), height[idt], gz_min[idt], gz_max[idt], style[idt], pal[idt], base_polys=list(gs[ib]))
    z = np.zeros(len(mp_))
    mb, km = encode_buildings(mp_, dict(
        height=mh_, base=z, ground_z_min=mgmn_, ground_z_max=mgmx_,
        levels=z + 2, style=ms_, roof=z, seed=z, pal=mpal_, flags=z, podium_h=z, balcony_mask=z, subtype=z,
    ), ox, oy)
    name = f"{i}_{j}.bin"
    if len(kb):
        open(os.path.join(WORK, "sections", "base", name), "wb").write(bb)
    if len(km):
        open(os.path.join(WORK, "sections", "mass", name), "wb").write(mb)
    if len(kd):
        open(os.path.join(WORK, "sections", "detail", name), "wb").write(db)
    hmax = float(max(np.max(height[idx] + gz_max[idx]) if len(idx) else 0, 1))
    tiles[f"{i}_{j}"] = dict(i=i, j=j, nb=int(len(kb)), nm=int(len(km)), nd=int(len(kd)), hmax=round(hmax, 1))
    tot["base"] += len(kb)
    tot["mass"] += len(km)
    tot["detail"] += len(kd)
log("tiles", len(tiles), tot)
json.dump(dict(tiles=tiles, totals=tot), open(tiles_p, "w"))
if RANGE == [0, 0, GRID_NX, GRID_NY]:
    gpd.GeoDataFrame(
        dict(height=height[idx_ok], base=basev[idx_ok], ground_z_min=gz_min[idx_ok], ground_z_max=gz_max[idx_ok]),
        geometry=gs[idx_ok],
    ).to_parquet(os.path.join(WORK, "buildings_packed.parquet"))
    log("saved buildings_packed.parquet:", len(idx_ok))
log("done")
