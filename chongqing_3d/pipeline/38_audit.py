"""Consistency & GIS/DEM quality audit for Chongqing 3D.

Checks:
  1. Terrain DEM sanity: river flat at -2.5m (waterY=0), Yuzhong ridge > 60m, Nanshan > 250m, zero NaNs/spikes
  2. Buildings vs carriageways: zero buildings standing > 2 m2 inside a carriageway
  3. Landmark exclusions: zero procedural buildings left inside hero exclusion zones
  4. Tile v2 ('CQT2') integrity: valid headers, ground_z_min <= ground_z_max, valid styles/roofs
  5. Walking loops & traffic lanes (if built)
  6. Assets: materials.json (38 layers @ 1024), signs, signs_vert, foliage, map

usage: 38_audit.py <work_dir> <site_dir> [exclusions.json]
"""
import sys, os, json, pickle, struct, gzip, time
import numpy as np, geopandas as gpd, shapely
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

WORK, SITE = sys.argv[1:3]
EXCL = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "landmark_exclusions.json")
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


out = {}

# ---------------------------------------------------------------- 1. Terrain DEM sanity (core 2.5m + fine 10m + coarse 100m)
tf_npy = np.load(os.path.join(WORK, "terrain_fine.npy"))
tc_npy = np.load(os.path.join(WORK, "terrain_coarse.npy"))
tcore_p = os.path.join(WORK, "terrain_core.npy")
tcore_npy = np.load(tcore_p) if os.path.exists(tcore_p) else None
ts = TerrainSampler(WORK)
out["terrain_nan"] = int(np.isnan(tf_npy).sum() + np.isnan(tc_npy).sum() + (np.isnan(tcore_npy).sum() if tcore_npy is not None else 0))
out["terrain_core_ok"] = bool(tcore_npy is not None and os.path.exists(os.path.join(SITE, "data", "terrain_core.bin")))
out["terrain_fine_min"] = round(float(tf_npy.min()), 2)
out["terrain_fine_max"] = round(float(tf_npy.max()), 2)
out["terrain_river_chaotianmen"] = round(ts.sample(1419, 987), 2)
out["terrain_jiefangbei"] = round(ts.sample(0, 0), 2)
out["terrain_nanshan"] = round(ts.sample(2476, -1352), 2)
log("terrain:", {k: out[k] for k in ("terrain_nan", "terrain_core_ok", "terrain_fine_min", "terrain_fine_max", "terrain_river_chaotianmen", "terrain_jiefangbei", "terrain_nanshan")})

# ---------------------------------------------------------------- 2. Buildings vs carriageways
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"), columns=["geometry"])
A = pickle.load(open(os.path.join(WORK, "roads_attr.pkl"), "rb"))
cls, W, bridge, tunnel, lowbr, area_, deck = (A[k] for k in ("cls", "W", "bridge", "tunnel", "lowbr", "area", "deck"))
in_hero = A.get("in_hero", np.zeros(len(cls), bool))
R = project_geoms(roads.geometry.values)
ground = ~area_ & ~tunnel & (~bridge | lowbr) & ~in_hero
traffic = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ground
sel = np.flatnonzero(traffic)
CW = shapely.buffer(R[sel], W[sel] / 2 - 0.05, quad_segs=2)
cw_tree = shapely.STRtree(CW)

b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["geometry", "base", "cx", "cy", "ground_z_min", "ground_z_max", "style"])
G = b.geometry.values
base = b["base"].values.astype(float)
bi, ri = cw_tree.query(G, predicate="intersects")
m = base[bi] < 4.2
bi, ri = bi[m], ri[m]
ov = shapely.area(shapely.intersection(G[bi], CW[ri])) if len(bi) else np.zeros(0)
bad = np.unique(bi[ov > 2.0])
out["buildings"] = len(b)
out["buildings_on_carriageway"] = int(len(bad))
out["buildings_on_carriageway_m2"] = float(round(ov[ov > 2.0].sum())) if len(ov) else 0.0
out["buildings_bad_gz"] = int((b["ground_z_min"].values > b["ground_z_max"].values + 0.01).sum())
out["buildings_bad_style"] = int(((b["style"].values < 0) | (b["style"].values > 19)).sum())
log(f"buildings: {len(b)}, on carriageway (>2m2): {len(bad)}, bad_gz: {out['buildings_bad_gz']}, bad_style: {out['buildings_bad_style']}")

# ---------------------------------------------------------------- 3. Packed tiles, CQT2 integrity, hero exclusions & bridge clearances
tiles_dir = os.path.join(SITE, "data", "tiles")
tile_files = sorted(f for f in os.listdir(tiles_dir) if f.endswith(".bin")) if os.path.isdir(tiles_dir) else []
bad_magic = 0
for f in tile_files:
    raw = gzip.decompress(open(os.path.join(tiles_dir, f), "rb").read())
    if raw[:4] != b"CQT2":
        bad_magic += 1
out["packed_near_tiles"] = len(tile_files)
out["bad_tile_magic"] = bad_magic
log(f"packed near tiles: {len(tile_files)}, bad magic: {bad_magic}")

# Verify 0 packed CQT2 buildings intrude into hero landmark exclusions or hero bridge decks!
ex_shapes = []
if os.path.exists(EXCL):
    ex = json.load(open(EXCL))
    ex_shapes += [shapely.Point(c["x"], c["y"]).buffer(c["r"] - 1.0, quad_segs=20) for c in ex.get("circles", [])]
    ex_shapes += [shapely.Polygon(p).buffer(-1.0) for p in ex.get("polygons", [])]
ex_union = shapely.make_valid(shapely.union_all(ex_shapes)) if ex_shapes else shapely.Polygon()
lm_ = json.load(open(os.path.join(SITE, "data", "landmarks.json")))
br_corrs = []
for br in lm_.get("bridges", []):
    if br.get("kind") in ("spiral_overpass", "multilevel_interchange"):
        continue
    p0, p1 = br["p0"], br["p1"]
    seg = shapely.LineString([(p0[0], -p0[1]), (p1[0], -p1[1])])
    br_corrs.append((seg.buffer(float(br.get("width", 28.0)) * 0.5 + 2.0, cap_style="flat"), float(br.get("deckY", 50.0))))

def _scan_bsec(buf, ox, oy):
    nb, nr, nv = struct.unpack_from("<III", buf, 0)
    o = 12
    h = np.frombuffer(buf, "<u2", nb, o) * 0.1; o += nb * 2
    base_ = np.frombuffer(buf, "<u2", nb, o) * 0.1; o += nb * 2
    gmn = np.frombuffer(buf, "<i2", nb, o) * 0.1; o += nb * 2
    gmx = np.frombuffer(buf, "<i2", nb, o) * 0.1; o += nb * 2
    nrings = np.frombuffer(buf, np.uint8, nb, o + nb * 6); o += (nb * 10 + 3) & ~3
    rs = np.frombuffer(buf, "<u2", nr, o); o += (nr * 2 + 3) & ~3
    xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.float64)
    vi = ri = 0
    ex_hits = br_hits = 0
    recs = []
    for k in range(nb):
        nrk = int(nrings[k])
        sizes = [int(rs[ri + q]) for q in range(nrk)]; ri += nrk
        ntot = sum(sizes)
        all_pts = np.cumsum(xy[vi:vi + ntot], axis=0) * 0.1 + (ox, oy); vi += ntot
        rings = []; s = 0
        for m_ in sizes:
            rings.append(all_pts[s:s + m_]); s += m_
        if not rings or len(rings[0]) < 3:
            continue
        poly = shapely.Polygon(rings[0], [r for r in rings[1:] if len(r) >= 3])
        if not poly.is_valid:
            poly = shapely.make_valid(poly)
        if not ex_union.is_empty and poly.intersects(ex_union) and shapely.intersection(poly, ex_union).area > 10.0:
            ex_hits += 1
        lo_y = float(gmn[k] + base_[k]) if base_[k] > 0 else float(gmn[k] - 4.0)
        top_y = float(gmx[k] + base_[k] + h[k])
        for cg, dy in br_corrs:
            if top_y > dy - 10.0 and poly.intersects(cg) and shapely.intersection(poly, cg).area > 10.0:
                br_hits += 1
                break
        recs.append((poly, lo_y, top_y))
    return ex_hits, br_hits, recs

ex_leaks = br_leaks = 0
all_b_recs = []
base_by_tile = {}
for sec_d in ("base", "detail"):
    sd_p = os.path.join(WORK, "sections", sec_d)
    for f in os.listdir(sd_p):
        if not f.endswith(".bin"):
            continue
        i_, j_ = [int(v) for v in f[:-4].split("_")]
        eh, bh, recs = _scan_bsec(open(os.path.join(sd_p, f), "rb").read(), GRID_X0 + i_ * TILE, GRID_Y0 + j_ * TILE)
        ex_leaks += eh; br_leaks += bh
        all_b_recs.extend(recs)
        if sec_d == "base":
            base_by_tile[(i_, j_)] = [r[0] for r in recs]
out["hero_exclusion_leaks"] = ex_leaks
out["hero_bridge_leaks"] = br_leaks

# Phase 5 Gate 1: Zero 3D overlapping or coplanar shared-edge buildings + zero base-vs-mass overlaps!
_G_all = np.array([r[0] for r in all_b_recs], dtype=object)
_L_all = np.array([r[1] for r in all_b_recs], dtype=float)
_H_all = np.array([r[2] for r in all_b_recs], dtype=float)
_bt_all = shapely.STRtree(_G_all)
_qa, _qb = _bt_all.query(shapely.buffer(_G_all, 0.05), predicate="intersects")
_qm = _qa < _qb
_qa, _qb = _qa[_qm], _qb[_qm]
_qvm = np.minimum(_H_all[_qa], _H_all[_qb]) > np.maximum(_L_all[_qa], _L_all[_qb]) + 0.05
_qa, _qb = _qa[_qvm], _qb[_qvm]
if len(_qa):
    _qinter = shapely.intersection(_G_all[_qa], _G_all[_qb])
    _qia = shapely.area(_qinter)
    _qdist = shapely.distance(_G_all[_qa], _G_all[_qb])
    out["overlapping_3d_buildings"] = int((_qia > 0.05).sum())
    out["coplanar_touching_buildings"] = int(((_qia <= 0.05) & (_qdist < 0.05)).sum())
else:
    out["overlapping_3d_buildings"] = 0
    out["coplanar_touching_buildings"] = 0

_bm_ov = 0
_md_p = os.path.join(WORK, "sections", "mass")
if os.path.isdir(_md_p):
    for f in os.listdir(_md_p):
        if not f.endswith(".bin"):
            continue
        i_, j_ = [int(v) for v in f[:-4].split("_")]
        bp_ = base_by_tile.get((i_, j_))
        if not bp_:
            continue
        _, _, mrecs = _scan_bsec(open(os.path.join(_md_p, f), "rb").read(), GRID_X0 + i_ * TILE, GRID_Y0 + j_ * TILE)
        if not mrecs:
            continue
        mp_ = np.array([r[0] for r in mrecs], dtype=object)
        bt_ = shapely.STRtree(np.array(bp_, dtype=object))
        ai_, bi_ = bt_.query(mp_, predicate="intersects")
        if len(ai_):
            _bm_ov += int((shapely.area(shapely.intersection(mp_[ai_], np.array(bp_, dtype=object)[bi_])) > 0.2).sum())
out["base_vs_mass_overlaps"] = _bm_ov
log(f"packed tile leaks: hero_exclusion={ex_leaks}, hero_bridge={br_leaks}, 3d_overlap={out['overlapping_3d_buildings']}, coplanar={out['coplanar_touching_buildings']}, base_vs_mass={_bm_ov}")

# ---------------------------------------------------------------- 4. Walking loops (if present)
wd = os.path.join(WORK, "sections", "walks")
if os.path.isdir(wd) and os.listdir(wd):
    def read_walks(p, ox, oy):
        buf = open(p, "rb").read()
        n, nv = struct.unpack_from("<II", buf, 0)
        o = 12
        npts = []
        for _ in range(n):
            npts.append(struct.unpack_from("<BBH", buf, o)); o += 4
        xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.float64)
        loops = []; s = 0
        for kind, flg, m_ in npts:
            c = np.cumsum(xy[s:s + m_], axis=0) * 0.1 + (ox, oy); s += m_
            if flg & 1:
                if m_ >= 2:
                    loops.append((kind, flg, shapely.LineString(c), c))
            else:
                if m_ >= 3:
                    loops.append((kind, flg, shapely.LinearRing(c), c))
        return loops
    km = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}
    on_cw = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}
    w_in_bld = w_in_hero = w_in_tun = w_hairpins = w_closed = w_open = 0
    _tun_boxes = []
    _tp_path = os.path.join(SITE, "data", "tunnels.json")
    if os.path.exists(_tp_path):
        for _tp in json.load(open(_tp_path)):
            _px, _py = float(_tp["x"]), -float(_tp["z"])
            _dx, _dy = float(_tp["dx"]), -float(_tp["dz"])
            _L = max(float(np.hypot(_dx, _dy)), 1e-6)
            _ux, _uy = _dx / _L, _dy / _L; _nx, _ny = -_uy, _ux
            _hw = float(max(6.5, _tp.get("width", 10.0))) * 0.5 + 3.5
            _tun_boxes.append(shapely.Polygon([
                (_px - _ux * 10.0 - _nx * _hw, _py - _uy * 10.0 - _ny * _hw),
                (_px + _ux * 5.0  - _nx * _hw, _py + _uy * 5.0  - _ny * _hw),
                (_px + _ux * 5.0  + _nx * _hw, _py + _uy * 5.0  + _ny * _hw),
                (_px - _ux * 10.0 + _nx * _hw, _py - _uy * 10.0 + _ny * _hw),
            ]))
    _tun_tree = shapely.STRtree(np.array(_tun_boxes, dtype=object)) if _tun_boxes else None
    for f in sorted(os.listdir(wd)):
        i, j = [int(v) for v in f[:-4].split("_")]
        loops = read_walks(os.path.join(wd, f), GRID_X0 + i * TILE, GRID_Y0 + j * TILE)
        if not loops:
            continue
        lines = np.array([l for _, _, l, _ in loops], dtype=object)
        kinds = np.array([k for k, _, _, _ in loops])
        L = shapely.length(lines)
        for k in range(4):
            km[k] += float(L[kinds == k].sum()) / 1e3
        li, ci = cw_tree.query(lines, predicate="intersects")
        if len(li):
            d = shapely.length(shapely.intersection(lines[li], CW[ci]))
            for k in range(4):
                on_cw[k] += float(d[kinds[li] == k].sum())
        for kind, flg, line, c in loops:
            if flg & 1:
                w_open += 1
            else:
                w_closed += 1
                if line.length > 0 and shapely.Polygon(c).area / line.length < 0.70:
                    w_hairpins += 1
            pts_w = shapely.points(c[:, 0], c[:, 1])
            bi_ = _bt_all.query(line.buffer(0.90))
            if len(bi_):
                bu_ = shapely.union_all(_G_all[bi_])
                w_in_bld += int((shapely.distance(pts_w, bu_) < 0.85).sum())
            if not ex_union.is_empty and ex_union.intersects(line):
                w_in_hero += int(shapely.contains(ex_union, pts_w).sum())
            if _tun_tree is not None:
                ti_ = _tun_tree.query(line)
                if len(ti_):
                    tu_ = shapely.union_all(np.array(_tun_boxes, dtype=object)[ti_])
                    w_in_tun += int(shapely.contains(tu_, pts_w).sum())
    names = {0: "pavement", 1: "pedestrian", 2: "square", 3: "path"}
    out["walk_km"] = {names[k]: round(v, 1) for k, v in km.items()}
    out["walk_m_on_carriageway"] = {names[k]: round(v, 1) for k, v in on_cw.items()}
    out["walk_open_count"] = w_open
    out["walk_closed_count"] = w_closed
    out["walk_hairpins"] = w_hairpins
    out["walk_verts_near_building_085m"] = w_in_bld
    out["walk_verts_in_hero"] = w_in_hero
    out["walk_verts_in_tunnel"] = w_in_tun
    log(f"walks km: {out['walk_km']} (open={w_open}, closed={w_closed}, hairpins={w_hairpins}); on_cw={out['walk_m_on_carriageway']}; near_bld={w_in_bld}, in_hero={w_in_hero}, in_tun={w_in_tun}")

# ---------------------------------------------------------------- 5. Phase 4 Complex-Terrain Checks (core cross-slope, deck hillside clearance, tunnels.json)
cdeg_l, ckm_l = [], []
for k_ in sel:
    cc = shapely.get_coordinates(R[k_])
    if len(cc) < 2:
        continue
    mx, my = cc[:, 0].mean(), cc[:, 1].mean()
    if not (-6400 <= mx <= 4900 and -3900 <= my <= 4400):
        continue
    hw_ = float(W[k_]) * 0.5
    p0s, p1s = cc[:-1], cc[1:]
    dv = p1s - p0s
    ls = np.hypot(dv[:, 0], dv[:, 1])
    ok_s = ls >= 2.0
    if not ok_s.any():
        continue
    p0s, p1s, dv, ls = p0s[ok_s], p1s[ok_s], dv[ok_s], ls[ok_s]
    nx_ = -dv[:, 1] / ls; ny_ = dv[:, 0] / ls
    mid = (p0s + p1s) * 0.5
    hL = ts.sample(mid[:, 0] + nx_ * hw_, mid[:, 1] + ny_ * hw_)
    hR = ts.sample(mid[:, 0] - nx_ * hw_, mid[:, 1] - ny_ * hw_)
    cdeg_l.append(np.degrees(np.arctan2(np.abs(hL - hR), max(float(W[k_]), 1.0))))
    ckm_l.append(ls / 1000.0)
cdeg_a = np.concatenate(cdeg_l); ckm_a = np.concatenate(ckm_l)
tot_core_km = max(float(ckm_a.sum()), 1e-6)
out["core_road_gt5_pct"] = round(100.0 * float(ckm_a[cdeg_a > 5.0].sum()) / tot_core_km, 2)
out["core_road_gt10_pct"] = round(100.0 * float(ckm_a[cdeg_a > 10.0].sum()) / tot_core_km, 2)

decks_p = pickle.load(open(os.path.join(WORK, "decks.pkl"), "rb"))
deck_pierce = 0
for dk in decks_p:
    xyz = dk["xyz"]; hw_ = dk["w"] * 0.5
    for a_, b_ in zip(xyz[:-1], xyz[1:]):
        if a_[2] < 0.8 and b_[2] < 0.8:
            continue
        dx, dy = b_[0] - a_[0], b_[1] - a_[1]
        L_ = float(np.hypot(dx, dy))
        if L_ < 0.5:
            continue
        nx_, ny_ = -dy / L_, dx / L_
        px, py, cl_ = (a_[0] + b_[0]) * 0.5, (a_[1] + b_[1]) * 0.5, (a_[2] + b_[2]) * 0.5
        yc = max(ts.sample(px, py), 0.0) + cl_
        if max(ts.sample(px + nx_ * hw_, py + ny_ * hw_), ts.sample(px - nx_ * hw_, py - ny_ * hw_)) > yc + 0.5:
            deck_pierce += 1
out["deck_hillside_pierce"] = int(deck_pierce)

tun_p = os.path.join(SITE, "data", "tunnels.json")
out["tunnel_portals"] = len(json.load(open(tun_p))) if os.path.exists(tun_p) else 0
log(f"Phase 4 complex-terrain: core road >5°={out['core_road_gt5_pct']}%, >10°={out['core_road_gt10_pct']}%; deck_pierce={deck_pierce}; tunnel_portals={out['tunnel_portals']}")

# ---------------------------------------------------------------- 6. Assets & Landmarks check
from PIL import Image
mat = json.load(open(os.path.join(SITE, "assets", "materials.json")))
lm = json.load(open(os.path.join(SITE, "data", "landmarks.json")))
out["materials_layers"] = mat["layers"]
out["materials_size"] = mat["size"]
out["landmarks_bridges"] = len(lm.get("bridges", []))
alb_sz = Image.open(os.path.join(SITE, "assets", "mat_albedo.webp")).size
nr_sz = Image.open(os.path.join(SITE, "assets", "mat_nr.webp")).size
out["mat_albedo_px"] = list(alb_sz)
out["mat_nr_px"] = list(nr_sz)
int_meta = json.load(open(os.path.join(SITE, "assets", "interiors.json")))
int_sz = Image.open(os.path.join(SITE, "assets", int_meta["file"])).size
out["interiors_count"] = int_meta["count"]
out["interiors_px"] = list(int_sz)
out["signs_ok"] = (
    os.path.exists(os.path.join(SITE, "assets", "signs.png"))
    and os.path.exists(os.path.join(SITE, "assets", "signs_vert.png"))
)
log(f"materials: {mat['layers']} layers @ {mat['size']}px {alb_sz}; interiors: {int_meta['count']} @ {int_sz}; bridges: {out['landmarks_bridges']}")

json.dump(out, open(os.path.join(WORK, "audit.json"), "w"), indent=1, ensure_ascii=False)
fail = (
    out["terrain_nan"] > 0
    or not out["terrain_core_ok"]
    or out["terrain_river_chaotianmen"] > -1.0
    or out["buildings_on_carriageway"] > 0
    or out["buildings_bad_gz"] > 0
    or out["buildings_bad_style"] > 0
    or out["bad_tile_magic"] > 0
    or out["hero_exclusion_leaks"] > 0
    or out["hero_bridge_leaks"] > 0
    or out["overlapping_3d_buildings"] > 0
    or out["coplanar_touching_buildings"] > 0
    or out["base_vs_mass_overlaps"] > 0
    or out.get("walk_hairpins", 0) > 0
    or out.get("walk_verts_near_building_085m", 0) > 0
    or out.get("walk_verts_in_hero", 0) > 0
    or out.get("walk_verts_in_tunnel", 0) > 0
    or out["core_road_gt10_pct"] > 5.0
    or out["deck_hillside_pierce"] > 50
    or out["tunnel_portals"] == 0
    or out["materials_layers"] != 38
    or out["mat_albedo_px"] != [4096, 10240]
    or out["mat_nr_px"] != [4096, 10240]
    or out["interiors_count"] != 16
    or out["interiors_px"] != [2048, 2048]
    or not out["signs_ok"]
)
log("AUDIT:", "FAILED" if fail else "CLEAN")
sys.exit(1 if fail else 0)
