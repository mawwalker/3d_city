"""Build Chongqing 3D mountain terrain with Phase 4 high-res Voronoi road-corridor benching!

Solves sideways-tilted hillside roads (`路面歪的`) and riverbank cliff cuts at the single-source-of-truth DEM level:
  1. Bare-earth 10 m DEM from Copernicus GLO-30 DSM with skyscraper DSM stripping (preserving true cliffs).
  2. Smooth, junction-continuous longitudinal road profiles z_road(s) for all at-grade roads (protected from river carving!).
  3. High-res 2.5 m urban-core DEM (`terrain_core.npy`, 11.5 x 8.5 km) with exact Voronoi nearest-road flat benching
     across `W/2 + SW + 2.6 m` (guaranteeing ~0 deg transverse cross-slope on EVERY carriageway & sidewalk!) and crisp
     retaining escarpments strictly OUTSIDE sidewalks, plus clean river carving outside road edges.
  4. Full-city 10 m DEM (`terrain_fine.npy`, 25 x 23 km) road-benched in outer suburbs and synced to `terrain_core`
     inside the urban core (4x4 block average + seamless 60 m boundary feather).
  5. 100 m backdrop DEM (`terrain_coarse.npy`, 64 x 64 km) seamlessly feathered to `terrain_fine`.

Outputs (work dir):
  terrain_core.npy    float32 [3400, 4600], 2.5 m cells over [-6500..+5000] x [-4000..+4500] (row 0 = south)
  terrain_fine.npy    float32 [2300, 2500], 10 m cells over [-14500..+10500] x [-10500..+12500]
  terrain_coarse.npy  float32 [640, 640],   100 m cells over [-34000..+30000] x [-32000..+32000]
  terrain_meta.json
  two_rivers.json

usage: 13_terrain.py <dem_dir> <work_dir>
"""
import sys, os, glob, json, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
import rasterio
from rasterio.merge import merge
from rasterio import features
from affine import Affine
from scipy import ndimage
from scipy.spatial import cKDTree
import geopandas as gpd
import shapely
from common import *
from lanes import road_lanes

DEM_DIR, WORK = sys.argv[1:3]
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def _num(s):
    if not isinstance(s, str):
        return np.nan
    m = re.match(r"\s*(-?[0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan


def _vkeys(c):
    return (np.round(c[:, 0] * 20).astype(np.int64) + 4_000_000) * 8_000_000 + (np.round(c[:, 1] * 20).astype(np.int64) + 4_000_000)


# ================================================================ 0. Load Copernicus GLO-30 DEM
srcs = [rasterio.open(p) for p in sorted(glob.glob(os.path.join(DEM_DIR, "*.tif")))]
mosaic, tf = merge(srcs)
dem = mosaic[0].astype(np.float32) - float(WATER_Y_ASL)
log("DEM loaded", dem.shape, "world_y range:", round(float(dem.min()), 1), "..", round(float(dem.max()), 1))


def sample_grid(x0, y0, nx, ny, cell):
    xs = x0 + (np.arange(nx) + 0.5) * cell
    ys = y0 + (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xs, ys)
    lon, lat = to_lonlat(X.ravel(), Y.ravel())
    col = (lon - tf.c) / tf.a - 0.5
    row = (lat - tf.f) / tf.e - 0.5
    v = ndimage.map_coordinates(dem, [row, col], order=1, mode="nearest")
    return v.reshape(ny, nx).astype(np.float32)


FINE = dict(x0=-14500.0, y0=-10500.0, cell=10.0, nx=2500, ny=2300)
CORE = dict(x0=-6500.0, y0=-4000.0, cell=2.5, nx=4600, ny=3400)
COARSE = dict(x0=-34000.0, y0=-32000.0, cell=100.0, nx=640, ny=640)

raw_f = sample_grid(**FINE)
raw_c = sample_grid(**COARSE)
log("sampled fine", raw_f.shape, "coarse", raw_c.shape)

# ================================================================ 1. Extract Yangtze + Jialing main river polygon
water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
wt = [json.loads(t) for t in water["tags"].values]
wm = np.array([not (t.get("tunnel") not in (None, "no") or t.get("covered") == "yes" or t.get("intermittent") == "yes") for t in wt])
wg = shapely.make_valid(project_geoms(water.geometry.values[wm]))
tfm_f = Affine(FINE["cell"], 0, FINE["x0"], 0, FINE["cell"], FINE["y0"])
w_all = features.rasterize(
    [(g, 1) for g in wg if g is not None and not g.is_empty and g.area > 4000],
    out_shape=(FINE["ny"], FINE["nx"]), transform=tfm_f, fill=0, dtype="uint8",
).astype(bool)
low_water = w_all & (raw_f < 28.0)
lab_w, nw = ndimage.label(ndimage.binary_dilation(low_water, iterations=1))
ci = int((1400.0 - FINE["x0"]) / FINE["cell"])
cj = int((1000.0 - FINE["y0"]) / FINE["cell"])
seed_lbl = int(lab_w[cj, ci])
if seed_lbl == 0:
    win = lab_w[cj - 20:cj + 20, ci - 20:ci + 20]
    nz = win[win > 0]
    seed_lbl = int(np.bincount(nz).argmax()) if len(nz) else 0
main_river = (lab_w == seed_lbl) & low_water if seed_lbl > 0 else low_water
main_river = ndimage.binary_closing(main_river, iterations=2) & (raw_f < 32.0)
log("main river pixels:", int(main_river.sum()), f"({main_river.sum() * 100 / 1e6:.2f} km2)")

river_polys = [g for g in wg if g is not None and not g.is_empty and g.area > 50000]
cx_p = shapely.get_x(shapely.point_on_surface(river_polys))
cy_p = shapely.get_y(shapely.point_on_surface(river_polys))
keep_rp = []
for g, xp, yp in zip(river_polys, cx_p, cy_p):
    ii = int(np.clip((xp - FINE["x0"]) / FINE["cell"], 0, FINE["nx"] - 1))
    jj = int(np.clip((yp - FINE["y0"]) / FINE["cell"], 0, FINE["ny"] - 1))
    if main_river[jj, ii] or raw_f[jj, ii] < 18.0:
        keep_rp.append(g)
two_rivers = shapely.union_all(keep_rp) if keep_rp else shapely.Polygon()
json.dump(shapely.to_wkt(shapely.simplify(two_rivers, 2.0), rounding_precision=1), open(os.path.join(WORK, "two_rivers.json"), "w"))
log("two_rivers.json saved, area:", round(two_rivers.area / 1e6, 2), "km2")

# ================================================================ 2. Strip building DSM bumps (preserve real cliffs!)
b = gpd.read_parquet(os.path.join(WORK, "fused.parquet"), columns=["geometry", "h_tag", "lv_tag", "gba_h", "ov_h"])
bh_est = np.nan_to_num(b["h_tag"].values.astype(float), nan=np.nan)
lv_est = b["lv_tag"].values.astype(float) * 3.1
gb_est = b["gba_h"].values.astype(float)
ov_est = b["ov_h"].values.astype(float)
h_any = np.where(np.isfinite(bh_est), bh_est, np.where(np.isfinite(lv_est), lv_est, np.where(np.isfinite(gb_est), gb_est, np.where(np.isfinite(ov_est), ov_est, 12.0))))
h_any = np.clip(h_any, 3.0, 200.0)

b_cov = features.rasterize(((g, 1.0) for g in b.geometry.values), out_shape=(FINE["ny"], FINE["nx"]), transform=tfm_f, fill=0.0, dtype="float32")
order = np.argsort(h_any)
b_h = features.rasterize(((g, float(h)) for g, h in zip(b.geometry.values[order], h_any[order])), out_shape=(FINE["ny"], FINE["nx"]), transform=tfm_f, fill=0.0, dtype="float32")

roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
rt = [json.loads(t) for t in roads["tags"].values]
hw = roads.highway.values
R_GEOM = project_geoms(roads.geometry.values)
bridge = np.array([t.get("bridge") not in (None, "no") for t in rt])
layer = np.nan_to_num(np.array([_num(t.get("layer")) for t in rt]), nan=0).astype(int)
tunnel = np.array([t.get("tunnel") in ("yes", "culvert", "flooded", "avalanche_protector") or t.get("indoor") == "yes" or t.get("location") == "underground" for t in rt]) | ((layer < 0) & ~bridge)
is_area = np.array([t.get("area") == "yes" for t in rt])
oneway = np.array([t.get("oneway") in ("yes", "1", "true", "-1") or t.get("junction") == "roundabout" for t in rt]) | np.isin(hw, ["motorway", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"])
lanes = np.array([_num(t.get("lanes")) for t in rt])
width_t = np.array([_num(t.get("width")) for t in rt])
service_kind = np.array([t.get("service") for t in rt], dtype=object)
footway_kind = np.array([t.get("footway") for t in rt], dtype=object)

RC = dict(motorway=0, trunk=1, primary=2, secondary=3, tertiary=4, residential=5, unclassified=5, living_street=6, service=7, pedestrian=8, footway=9, path=9, cycleway=9, steps=9, track=10, busway=4)
cls = np.full(len(roads), -1)
for k, v in RC.items():
    cls[hw == k] = v
link = pd.Series(hw).str.endswith("_link").values
link_parent = pd.Series(hw).str.replace("_link", "").map({"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}).fillna(-1).astype(int).values
cls[link] = 11

# Same width & sidewalk rules as 31_build_ground.py
W = np.zeros(len(roads))
dfl = lambda a, b_: np.where(np.isfinite(lanes), lanes, np.where(oneway, a, b_))
W[cls == 0] = dfl(3, 6)[cls == 0] * 3.75 + 1.5
W[cls == 1] = dfl(3, 6)[cls == 1] * 3.5 + 1.2
W[cls == 2] = np.where(oneway, dfl(3, 3) * 3.3 + 3.0, dfl(4, 4) * 3.3 + 5.0)[cls == 2]
W[cls == 3] = np.where(oneway, dfl(2, 2) * 3.3 + 2.6, dfl(4, 4) * 3.2 + 4.4)[cls == 3]
W[cls == 4] = np.where(oneway, dfl(2, 2) * 3.2 + 2.2, dfl(2, 2) * 3.3 + 4.0)[cls == 4]
W[cls == 5] = np.where(np.isfinite(lanes) & (lanes >= 2), np.minimum(lanes, 4) * 3.1 + 1.0, 6.0)[cls == 5]
W[cls == 6] = 4.6
W[cls == 7] = np.where(np.isin(service_kind, ["driveway", "alley", "parking_aisle"]), 3.4, 4.4)[cls == 7]
W[cls == 8] = 8.5
W[cls == 9] = np.where(hw == "steps", 3.2, 2.4)[cls == 9]
W[cls == 10] = 3.0
W[cls == 11] = np.where(np.isfinite(lanes), lanes, 1.4)[cls == 11] * 3.6 + 1.6
ok_w = np.isfinite(width_t) & (width_t > 1.5) & (width_t < 60)
W = np.where(ok_w & (cls >= 0), np.clip(width_t, W * 0.5, W * 2.2), W)
_LM = road_lanes(hw, rt)
W = np.where(_LM["wneed"] > 0, np.maximum(W, _LM["wneed"]), W)

sidewalk_of = {2: 4.0, 3: 3.6, 4: 3.0, 5: 2.0}
SW = np.array([sidewalk_of.get(c, 0.0) for c in cls])
SW = np.where((cls == 11) & np.isin(link_parent, [2, 3, 4]), 2.6, SW)

# Match 31_build_ground.py LOWBR + Hongyadong frontage + Raffles underpass exclusion
RLEN = shapely.length(R_GEOM)
atgrade_raw = (cls >= 0) & ~bridge & ~tunnel
_gk = np.unique(_vkeys(shapely.get_coordinates(R_GEOM[atgrade_raw])))
_e0 = np.isin(_vkeys(shapely.get_coordinates(shapely.get_point(R_GEOM, 0))), _gk)
_e1 = np.isin(_vkeys(shapely.get_coordinates(shapely.get_point(R_GEOM, -1))), _gk)
FLY = roads["fly"].values.astype(int) if "fly" in roads.columns else np.zeros(len(roads), int)
LOWBR = bridge & (layer <= 1) & (RLEN < 180) & ~np.isin(cls, [0, 11]) & ((_e0 & _e1) | ~np.isin(cls, [1, 2, 3, 4, 5])) & (FLY == 0)
hy_box = shapely.box(-40.0, 445.0, 295.0, 645.0)
b_cand = np.flatnonzero(bridge)
if len(b_cand):
    mids_b = shapely.line_interpolate_point(R_GEOM[b_cand], 0.5, normalized=True)
    LOWBR[b_cand[shapely.contains(hy_box, mids_b)]] = True

# Raffles City Chaotianmen podium underpass (陕西路 running underneath podium) -> treat as tunnel so never benches podium!
rf_x, rf_y = to_local(106.583483, 29.567763)
rf_pt = shapely.Point(rf_x, rf_y)
in_raffles = np.array([(cls[k] == 4) and (not bridge[k]) and (R_GEOM[k].distance(rf_pt) < 85.0) for k in range(len(roads))])
tunnel = tunnel | in_raffles

at_grade_veh = np.isin(cls, [0, 1, 2, 3, 4, 5, 6, 7, 8, 11]) & (~bridge | LOWBR) & ~tunnel & ~is_area
r_mask = features.rasterize(
    [(g, 1) for g in R_GEOM[at_grade_veh] if g is not None and not g.is_empty],
    out_shape=(FINE["ny"], FINE["nx"]), transform=tfm_f, fill=0, all_touched=True, dtype="uint8",
).astype(bool)

dist_r, (ri_y, ri_x) = ndimage.distance_transform_edt(main_river, return_indices=True)
land_fill = raw_f[ri_y, ri_x]
bh_sm = ndimage.gaussian_filter(b_h, sigma=1.8)
bcov_sm = ndimage.gaussian_filter(b_cov, sigma=2.2)
opened = ndimage.grey_opening(land_fill, size=(9, 9))
opened = ndimage.gaussian_filter(opened, sigma=1.6)
b_bias = np.clip((land_fill - opened) * np.clip(bcov_sm * 1.8, 0.0, 1.0) * np.clip(bh_sm / 25.0, 0.0, 1.0), 0.0, 42.0)
b_bias = np.where(r_mask, b_bias * 0.45, b_bias)
bare_f = land_fill - b_bias
bare_f = ndimage.gaussian_filter(bare_f, sigma=1.15)
bare_f = np.where(bcov_sm > 0.05, ndimage.gaussian_filter(bare_f, sigma=1.2), bare_f)
land_bare_f = np.maximum(bare_f, 2.2).astype(np.float32)

# ================================================================ 3. Smooth, junction-continuous longitudinal road profiles!
log("solving smooth junction-continuous longitudinal road profiles...")


def _sample_bare_f(xa, ya):
    fx = np.clip((xa - FINE["x0"]) / FINE["cell"] - 0.5, 0.0, FINE["nx"] - 1.0001)
    fy = np.clip((ya - FINE["y0"]) / FINE["cell"] - 0.5, 0.0, FINE["ny"] - 1.0001)
    i = np.floor(fx).astype(np.int64)
    j = np.floor(fy).astype(np.int64)
    tx, ty = fx - i, fy - j
    return ((land_bare_f[j, i] * (1 - tx) + land_bare_f[j, i + 1] * tx) * (1 - ty)
            + (land_bare_f[j + 1, i] * (1 - tx) + land_bare_f[j + 1, i + 1] * tx) * ty)


# Exclude roads strictly inside the middle of the river (untagged river bridges)
d_in_f = ndimage.distance_transform_edt(main_river) * FINE["cell"]
d_out_f = ndimage.distance_transform_edt(~main_river) * FINE["cell"]
shapely.prepare(two_rivers)

bench_ways = np.flatnonzero(at_grade_veh)
# Build road vertex graph with 4.5 m densification
node_of = {}
node_xy = []
way_nodes = {}
eu_l, ev_l, el_l = [], [], []
for k in bench_ways:
    g = R_GEOM[k]
    if g is None or g.is_empty or g.length < 1.0:
        continue
    # Skip ways whose midpoint lies >12m inside main river (missing bridge=yes tag)
    mp = shapely.line_interpolate_point(g, 0.5, normalized=True)
    ii_m = int(np.clip((mp.x - FINE["x0"]) / FINE["cell"], 0, FINE["nx"] - 1))
    jj_m = int(np.clip((mp.y - FINE["y0"]) / FINE["cell"], 0, FINE["ny"] - 1))
    if d_in_f[jj_m, ii_m] > 12.0:
        continue
    c = shapely.get_coordinates(g)
    keep = np.concatenate([[True], np.hypot(*np.diff(c, axis=0).T) > 0.05])
    c = c[keep]
    if len(c) < 2:
        continue
    sd = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))])
    L_ = sd[-1]
    extra = [np.arange(4.5, L_, 4.5)] if L_ > 6.0 else []
    ss = np.unique(np.concatenate([sd] + extra))
    xy = np.column_stack([np.interp(ss, sd, c[:, 0]), np.interp(ss, sd, c[:, 1])])
    keys = _vkeys(c)
    orig_pos = np.searchsorted(ss, sd)
    ids = np.full(len(ss), -1, np.int64)
    for o, kk in zip(orig_pos, keys):
        nid = node_of.get(int(kk))
        if nid is None:
            nid = node_of[int(kk)] = len(node_xy)
            node_xy.append(xy[o])
        ids[o] = nid
    for o in np.flatnonzero(ids < 0):
        ids[o] = len(node_xy)
        node_xy.append(xy[o])
    way_nodes[int(k)] = (ids, ss, xy)
    eu_l.append(ids[:-1])
    ev_l.append(ids[1:])
    el_l.append(np.maximum(np.diff(ss), 0.2))

node_xy = np.asarray(node_xy, dtype=np.float64)
eu = np.concatenate(eu_l)
ev = np.concatenate(ev_l)
el = np.concatenate(el_l)
nv_r = len(node_xy)

# Compute per-node road way ID and unit tangent so we can tie parallel divided carriageways (e.g. Binjiang dual boulevards!)
# to a single smooth cross-leveled boulevard elevation instead of letting raw DEM cliffs create a 7m step down the median!
node_way = np.full(nv_r, -1, np.int64)
node_tx = np.zeros(nv_r, np.float64)
node_ty = np.zeros(nv_r, np.float64)
for k, (ids, ss, xy) in way_nodes.items():
    dv = np.gradient(xy, axis=0)
    dl = np.maximum(np.hypot(dv[:, 0], dv[:, 1]), 1e-6)
    node_way[ids] = k
    node_tx[ids] = dv[:, 0] / dl
    node_ty[ids] = dv[:, 1] / dl

# Initial elevation from bare-earth DEM; protect riverbank roads from low water pull
z0 = _sample_bare_f(node_xy[:, 0], node_xy[:, 1])
ni_ = np.clip(((node_xy[:, 0] - FINE["x0"]) / FINE["cell"]).astype(int), 0, FINE["nx"] - 1)
nj_ = np.clip(((node_xy[:, 1] - FINE["y0"]) / FINE["cell"]).astype(int), 0, FINE["ny"] - 1)
near_riv = d_out_f[nj_, ni_] < 18.0
z0 = np.where(near_riv, np.maximum(z0, 4.5), np.maximum(z0, 2.5))

# Fix Hongyadong 1F Jialing Binjiang Rd DSM shadow: Copernicus GLO-30 smeared Hongyadong's 60m building cliff onto the
# south carriageway (lifting it +12m above the north carriageway right beside it!). Clamp both lanes to true flat riverfront grade!
way_names = np.array([(t.get("name") or "") for t in rt], dtype=object)
hy_jb_mask = (node_way >= 0) & (way_names[np.maximum(node_way, 0)] == "嘉陵江滨江路") & (node_xy[:, 0] >= -150.0) & (node_xy[:, 0] <= 290.0) & (node_xy[:, 1] >= 490.0) & (node_xy[:, 1] <= 640.0)
if hy_jb_mask.any():
    # True Hongyadong 1F riverfront grade: smoothly descends from ~42m at x=-150 to ~25.5m at x=-10..150 to ~21m at x=290
    hx_ = node_xy[hy_jb_mask, 0]
    hy_grade = np.interp(hx_, [-150.0, -50.0, 20.0, 160.0, 290.0], [44.0, 29.0, 25.5, 24.5, 20.5])
    z0[hy_jb_mask] = hy_grade
    log(f"clamped Hongyadong 1F Jialing Binjiang Rd DSM shadow on {int(hy_jb_mask.sum())} nodes")

# Find close parallel dual-carriageway node pairs (dist < 18m, parallel |dot| > 0.84, |dz0| < 18m) and strongly tie them
# so BOTH halves of every divided hillside boulevard converge to the EXACT same cross-leveled elevation!
ntree = cKDTree(node_xy)
dd_p, jj_p = ntree.query(node_xy, k=8, distance_upper_bound=18.0, workers=PROCS)
tu_a = np.repeat(np.arange(nv_r, dtype=np.int64), 8)
tv_a = jj_p.ravel()
ok_p = (tv_a < nv_r) & (tu_a < tv_a)
tu_a, tv_a = tu_a[ok_p], tv_a[ok_p]
ok_p = (node_way[tu_a] != node_way[tv_a]) & (np.abs(node_tx[tu_a] * node_tx[tv_a] + node_ty[tu_a] * node_ty[tv_a]) > 0.84) & (np.abs(z0[tu_a] - z0[tv_a]) < 18.0)
tu_a, tv_a = tu_a[ok_p], tv_a[ok_p]
ddx = node_xy[tv_a, 0] - node_xy[tu_a, 0]
ddy = node_xy[tv_a, 1] - node_xy[tu_a, 1]
along_p = np.abs(ddx * node_tx[tu_a] + ddy * node_ty[tu_a])
ok_p = along_p < 4.5
tu_a, tv_a = tu_a[ok_p], tv_a[ok_p]
has_tie = np.zeros(nv_r, bool)
if len(tu_a):
    has_tie[tu_a] = True
    has_tie[tv_a] = True
log(f"dual-carriageway parallel leveling ties: {len(tu_a)}")

deg = np.bincount(eu, minlength=nv_r) + np.bincount(ev, minlength=nv_r)
is_junc = deg >= 3
w_edge = 1.0 / np.maximum(el, 0.5)
w_tie = np.full(len(tu_a), 2.2, dtype=np.float64)
w_sum = np.zeros(nv_r, dtype=np.float64)
np.add.at(w_sum, eu, w_edge)
np.add.at(w_sum, ev, w_edge)
if len(tu_a):
    np.add.at(w_sum, tu_a, w_tie)
    np.add.at(w_sum, tv_a, w_tie)
w_sum = np.maximum(w_sum, 1e-6)

z = z0.copy()
max_drift = np.where(has_tie, 13.5, np.where(is_junc, 4.5, 6.8))
for it in range(56):
    acc = np.zeros(nv_r, dtype=np.float64)
    np.add.at(acc, eu, w_edge * z[ev])
    np.add.at(acc, ev, w_edge * z[eu])
    if len(tu_a):
        np.add.at(acc, tu_a, w_tie * z[tv_a])
        np.add.at(acc, tv_a, w_tie * z[tu_a])
    avg = acc / w_sum
    alpha = np.where(is_junc & ~has_tie, 0.42, 0.72)
    z = (1.0 - alpha) * z + alpha * avg
    dz = z[ev] - z[eu]
    lim = 0.14 * el + 0.06
    ex = np.abs(dz) - lim
    over = ex > 0
    if over.any():
        corr = np.sign(dz[over]) * ex[over] * 0.35
        np.add.at(z, eu[over], corr)
        np.add.at(z, ev[over], -corr)
    z = np.clip(z, np.maximum(z0 - max_drift, 2.5), z0 + max_drift)
    if hy_jb_mask.any():
        # Keep Hongyadong 1F Binjiang Rd locked smoothly to its flat riverfront elevation (never pulled up by cliff!)
        z[hy_jb_mask] = np.clip(z[hy_jb_mask], hy_grade - 2.0, hy_grade + 1.5)
log(f"road profile graph smoothed: {nv_r} vertices, {len(way_nodes)} ways, max |dz|={np.abs(z - z0).max():.2f}m")

# ================================================================ 4. Build dense 3.0 m Voronoi stations & bench CORE + FINE!
# Tier 1: vehicular carriageways + pedestrian streets (cls in 0..5, 8, 11); Tier 2: service/living_street (cls 6, 7).
# Each station stores BOTH carriageway core half-width `hc` and total flat-bench half-width `bhw`, so a wide motorway's
# sidewalk shelf can NEVER steal pixels inside an adjacent narrow ramp's carriageway!
st_t1_xy, st_t1_z, st_t1_hc, st_t1_hw = [], [], [], []
st_t2_xy, st_t2_z, st_t2_hw = [], [], []
t1_geoms, t2_geoms = [], []
road_protect_geoms = []

for k, (ids, ss, xy) in way_nodes.items():
    zk = z[ids]
    c_ = int(cls[k])
    L_ = ss[-1]
    st_s = np.arange(0.0, L_ + 0.01, 3.0) if L_ > 3.0 else np.array([0.0, L_ * 0.5, L_])
    if st_s[-1] < L_ - 0.5:
        st_s = np.append(st_s, L_)
    sxy = np.column_stack([np.interp(st_s, ss, xy[:, 0]), np.interp(st_s, ss, xy[:, 1])])
    sz = np.interp(st_s, ss, zk)
    if c_ in (0, 1, 2, 3, 4, 5, 8, 11):
        hc = float(W[k]) * 0.5 + 1.4
        # Generous 3.4m guard shelf past outer sidewalk edge (and +5.5m along riverfront Hongyadong promenade!)
        extra_sw = 5.5 if (way_names[k] == "嘉陵江滨江路" and -160 <= xy[:, 0].mean() <= 290) else 3.4
        bhw = float(W[k]) * 0.5 + float(SW[k]) + extra_sw
        st_t1_xy.append(sxy); st_t1_z.append(sz)
        st_t1_hc.append(np.full(len(st_s), hc, np.float32))
        st_t1_hw.append(np.full(len(st_s), bhw, np.float32))
        t1_geoms.append((R_GEOM[k].buffer(bhw + 13.0, quad_segs=2), 1))
        road_protect_geoms.append((R_GEOM[k].buffer(float(W[k]) * 0.5 + float(SW[k]) + extra_sw - 0.5, quad_segs=2), 1))
    else:
        bhw = float(W[k]) * 0.5 + 1.8
        st_t2_xy.append(sxy); st_t2_z.append(sz)
        st_t2_hw.append(np.full(len(st_s), bhw, np.float32))
        t2_geoms.append((R_GEOM[k].buffer(bhw + 9.0, quad_segs=2), 1))
        road_protect_geoms.append((R_GEOM[k].buffer(float(W[k]) * 0.5 + 1.0, quad_segs=2), 1))

t1_xy = np.vstack(st_t1_xy).astype(np.float32)
t1_z = np.concatenate(st_t1_z).astype(np.float32)
t1_hc = np.concatenate(st_t1_hc).astype(np.float32)
t1_hw = np.concatenate(st_t1_hw).astype(np.float32)

t2_xy = np.vstack(st_t2_xy).astype(np.float32) if st_t2_xy else np.zeros((0, 2), np.float32)
t2_z = np.concatenate(st_t2_z).astype(np.float32) if st_t2_z else np.zeros(0, np.float32)
t2_hw = np.concatenate(st_t2_hw).astype(np.float32) if st_t2_hw else np.zeros(0, np.float32)
log(f"Voronoi road stations: Tier1={len(t1_xy)}, Tier2={len(t2_xy)}")


def bench_grid(base_arr, gmeta, is_core=True):
    """Apply exact 3-tier Voronoi nearest-road flat benching onto `base_arr` (ny, nx) float32."""
    ny, nx, cell, x0, y0 = gmeta["ny"], gmeta["nx"], gmeta["cell"], gmeta["x0"], gmeta["y0"]
    x1, y1 = x0 + nx * cell, y0 + ny * cell
    tfm = Affine(cell, 0, x0, 0, cell, y0)
    out = base_arr.copy()
    in_t1_flat = np.zeros((ny, nx), dtype=bool)
    # Subset KDTree strictly to this grid's bbox (+60m margin) for 5-10x speed!
    m1 = (t1_xy[:, 0] >= x0 - 60) & (t1_xy[:, 0] <= x1 + 60) & (t1_xy[:, 1] >= y0 - 60) & (t1_xy[:, 1] <= y1 + 60)
    s1_xy, s1_z, s1_hc, s1_hw = t1_xy[m1], t1_z[m1], t1_hc[m1], t1_hw[m1]
    tree1 = cKDTree(s1_xy) if len(s1_xy) else None

    mask1 = features.rasterize(t1_geoms, out_shape=(ny, nx), transform=tfm, fill=0, dtype="uint8").astype(bool)
    jj, ii = np.nonzero(mask1)
    if tree1 is not None and len(ii):
        px = (x0 + (ii + 0.5) * cell).astype(np.float32)
        py = (y0 + (jj + 0.5) * cell).astype(np.float32)
        K1 = 24
        CH = 500_000
        for s0 in range(0, len(ii), CH):
            s1 = min(len(ii), s0 + CH)
            pts = np.column_stack([px[s0:s1], py[s0:s1]])
            dd, idx = tree1.query(pts, k=K1, distance_upper_bound=42.0, workers=PROCS)
            valid = idx < len(s1_xy)
            idx_s = np.where(valid, idx, 0)
            hc = s1_hc[idx_s]; hw = s1_hw[idx_s]
            de = np.where(valid, dd - hw, 1e9)
            # 3-tier strict ownership:
            #   Tier A (dd <= hc, inside carriageway): score in [-10..-9], strictly closest normalized carriageway wins!
            #   Tier B (hc < dd <= hw, sidewalk/guard): score in [-5..-4], NEVER steals a Tier A pixel!
            #   Tier C (dd > hw, outer ramp): score = de >= 0!
            score = np.where(
                ~valid, 1e9,
                np.where(dd <= hc, dd / np.maximum(hc, 1.0) - 10.0,
                         np.where(dd <= hw, (dd - hc) / np.maximum(hw - hc, 0.5) - 5.0, de))
            )
            best_k = np.argmin(score, axis=1)
            rows_ = np.arange(s1 - s0)
            best_i = idx_s[rows_, best_k]
            best_de = de[rows_, best_k]
            ok = best_de < 13.0
            if not ok.any():
                continue
            ji = jj[s0:s1][ok]; xi = ii[s0:s1][ok]
            bde = best_de[ok]
            rz = s1_z[best_i[ok]]
            dz_ = np.abs(rz - out[ji, xi])
            ramp = np.clip(dz_ * 0.85 + 3.5, 4.5, 11.5) if is_core else np.clip(dz_ * 0.8 + 8.0, 10.0, 18.0)
            t_ = np.clip(bde / ramp, 0.0, 1.0)
            w = 1.0 - (3.0 * t_ * t_ - 2.0 * t_ * t_ * t_)
            out[ji, xi] = w * rz + (1.0 - w) * out[ji, xi]
            in_t1_flat[ji, xi] |= (bde <= 0.5)

    # Tier 2 (service roads / living streets) strictly outside Tier-1 flat benches
    m2 = (t2_xy[:, 0] >= x0 - 40) & (t2_xy[:, 0] <= x1 + 40) & (t2_xy[:, 1] >= y0 - 40) & (t2_xy[:, 1] <= y1 + 40) if len(t2_xy) else np.zeros(0, bool)
    if m2.any() and t2_geoms:
        s2_xy, s2_z, s2_hw = t2_xy[m2], t2_z[m2], t2_hw[m2]
        tree2 = cKDTree(s2_xy)
        mask2 = features.rasterize(t2_geoms, out_shape=(ny, nx), transform=tfm, fill=0, dtype="uint8").astype(bool) & ~in_t1_flat
        jj2, ii2 = np.nonzero(mask2)
        if len(ii2):
            px = (x0 + (ii2 + 0.5) * cell).astype(np.float32)
            py = (y0 + (jj2 + 0.5) * cell).astype(np.float32)
            K2 = 12
            CH = 500_000
            for s0 in range(0, len(ii2), CH):
                s1 = min(len(ii2), s0 + CH)
                pts = np.column_stack([px[s0:s1], py[s0:s1]])
                dd, idx = tree2.query(pts, k=K2, distance_upper_bound=24.0, workers=PROCS)
                valid = idx < len(s2_xy)
                idx_s = np.where(valid, idx, 0)
                de = np.where(valid, dd - s2_hw[idx_s], 1e9)
                best_k = np.argmin(de, axis=1)
                rows_ = np.arange(s1 - s0)
                best_i = idx_s[rows_, best_k]
                best_de = de[rows_, best_k]
                ok = best_de < 9.0
                if not ok.any():
                    continue
                ji = jj2[s0:s1][ok]; xi = ii2[s0:s1][ok]
                bde = best_de[ok]
                rz = s2_z[best_i[ok]]
                dz_ = np.abs(rz - out[ji, xi])
                ramp = np.clip(dz_ * 0.8 + 3.0, 4.0, 8.5) if is_core else 10.0
                t_ = np.clip(bde / ramp, 0.0, 1.0)
                w = 1.0 - (3.0 * t_ * t_ - 2.0 * t_ * t_ * t_)
                out[ji, xi] = w * rz + (1.0 - w) * out[ji, xi]
    return out


# ---------------- 4a. Build 2.5 m CORE grid (bicubic upsample bare_f -> Voronoi bench -> plaza polish -> river carve!)
cx_ = CORE["x0"] + (np.arange(CORE["nx"]) + 0.5) * CORE["cell"]
cy_ = CORE["y0"] + (np.arange(CORE["ny"]) + 0.5) * CORE["cell"]
# Map core cell centers onto fine grid coordinates (order=3 bicubic gives silky smooth natural mountain slopes)
col_cf = (cx_ - FINE["x0"]) / FINE["cell"] - 0.5
row_cf = (cy_ - FINE["y0"]) / FINE["cell"] - 0.5
CC, RR = np.meshgrid(col_cf, row_cf)
core_base = ndimage.map_coordinates(land_bare_f, [RR, CC], order=3, mode="nearest").astype(np.float32)
core_base = np.maximum(core_base, 2.2)
del CC, RR
log("upsampled bare-earth to 2.5m CORE", core_base.shape)

core_benched = bench_grid(core_base, CORE, is_core=True)
log("benched 2.5m CORE roads")

# Gentle polish on paved pedestrian squares/plazas (place=square / pedestrian_area) so plaza ground never crumples!
areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
ped_sq = np.array([("place=square" in ks or "highway=pedestrian_area" in ks) for ks in areas.kinds.values])
if ped_sq.any():
    sq_geoms = shapely.make_valid(project_geoms(areas.geometry.values[ped_sq]))
    tfm_c = Affine(CORE["cell"], 0, CORE["x0"], 0, CORE["cell"], CORE["y0"])
    sq_mask = features.rasterize([(g, 1) for g in sq_geoms if g is not None and not g.is_empty and g.area > 120],
                                 out_shape=(CORE["ny"], CORE["nx"]), transform=tfm_c, fill=0, dtype="uint8").astype(bool)
    if sq_mask.any():
        core_sm = ndimage.gaussian_filter(core_benched, sigma=2.0)
        core_benched = np.where(sq_mask, 0.35 * core_benched + 0.65 * core_sm, core_benched)

# River carving on 2.5 m CORE — strictly PROTECTED under road benches so Binjiang roads NEVER tilt into the river!
tfm_c = Affine(CORE["cell"], 0, CORE["x0"], 0, CORE["cell"], CORE["y0"])
prot_c = features.rasterize(road_protect_geoms, out_shape=(CORE["ny"], CORE["nx"]), transform=tfm_c, fill=0, dtype="uint8").astype(bool)
riv_c = features.rasterize([(two_rivers, 1)], out_shape=(CORE["ny"], CORE["nx"]), transform=tfm_c, fill=0, dtype="uint8").astype(bool) if not two_rivers.is_empty else np.zeros((CORE["ny"], CORE["nx"]), bool)
riv_c &= ~prot_c
d_in_c = ndimage.distance_transform_edt(riv_c) * CORE["cell"]
wt_c = np.clip(d_in_c / 8.0, 0.0, 1.0)
wt_c = wt_c * wt_c * (3.0 - 2.0 * wt_c)
core_out = np.where(riv_c, core_benched * (1.0 - wt_c) + (-2.5) * wt_c, np.maximum(core_benched, 1.8))
core_out = np.where(d_in_c >= 7.5, -2.5, core_out).astype(np.float32)
log("carved 2.5m CORE rivers (road-protected); range:", round(float(core_out.min()), 2), "..", round(float(core_out.max()), 2))

# ---------------- 4b. Build 10 m FINE grid (road-benched outside core + exact 4x4 core sync + seamless 60m feather!)
fine_benched = bench_grid(land_bare_f, FINE, is_core=False)
prot_f = features.rasterize(road_protect_geoms, out_shape=(FINE["ny"], FINE["nx"]), transform=tfm_f, fill=0, dtype="uint8").astype(bool)
riv_f = main_river & ~prot_f
d_in_f2 = ndimage.distance_transform_edt(riv_f) * FINE["cell"]
wt_f = np.clip(d_in_f2 / 12.0, 0.0, 1.0)
wt_f = wt_f * wt_f * (3.0 - 2.0 * wt_f)
fine_out = np.where(riv_f, fine_benched * (1.0 - wt_f) + (-2.5) * wt_f, fine_benched)
fine_out = np.where(d_in_f2 >= 10.0, -2.5, fine_out)
fine_out = np.where(~riv_f & ~w_all, np.maximum(fine_out, 1.5), fine_out).astype(np.float32)

# Feather CORE outer 60 m edge smoothly to FINE so transitioning off terrain_core has ZERO step seam!
wy_c = np.minimum(np.arange(CORE["ny"]), CORE["ny"] - 1 - np.arange(CORE["ny"])) * CORE["cell"]
wx_c = np.minimum(np.arange(CORE["nx"]), CORE["nx"] - 1 - np.arange(CORE["nx"])) * CORE["cell"]
w_edge = np.clip(np.minimum(wy_c[:, None], wx_c[None, :]) / 60.0, 0.0, 1.0).astype(np.float32)
if (w_edge < 1.0).any():
    col_cf2 = (cx_ - FINE["x0"]) / FINE["cell"] - 0.5
    row_cf2 = (cy_ - FINE["y0"]) / FINE["cell"] - 0.5
    CC2, RR2 = np.meshgrid(col_cf2, row_cf2)
    fine_at_core = ndimage.map_coordinates(fine_out, [RR2, CC2], order=1, mode="nearest").astype(np.float32)
    core_out = core_out * w_edge + fine_at_core * (1.0 - w_edge)
    del CC2, RR2, fine_at_core

# Replace FINE interior with 4x4 block average of CORE so farTerrain/fine match CORE seamlessly
k_cf = int(round(FINE["cell"] / CORE["cell"]))  # 4
ds_core = core_out.reshape(CORE["ny"] // k_cf, k_cf, CORE["nx"] // k_cf, k_cf).mean(axis=(1, 3))
ic0 = int(round((CORE["x0"] - FINE["x0"]) / FINE["cell"]))
jc0 = int(round((CORE["y0"] - FINE["y0"]) / FINE["cell"]))
fine_out[jc0:jc0 + ds_core.shape[0], ic0:ic0 + ds_core.shape[1]] = ds_core

# ---------------- 5. Coarse terrain (100m, seamless with fine window)
coarse_out = ndimage.gaussian_filter(raw_c, sigma=0.8).astype(np.float32)
coarse_out = np.maximum(coarse_out, -3.0)
fx0, fy0 = FINE["x0"], FINE["y0"]
k = int(round(COARSE["cell"] / FINE["cell"]))  # 10
ds_fine = fine_out.reshape(FINE["ny"] // k, k, FINE["nx"] // k, k).mean(axis=(1, 3))
i0 = int(round((fx0 - COARSE["x0"]) / COARSE["cell"]))
j0 = int(round((fy0 - COARSE["y0"]) / COARSE["cell"]))
hh, ww = ds_fine.shape
wy = np.minimum(np.arange(hh), hh - 1 - np.arange(hh))
wx = np.minimum(np.arange(ww), ww - 1 - np.arange(ww))
w_seam = np.clip(np.minimum(wy[:, None], wx[None, :]) / 6.0, 0.0, 1.0)
coarse_out[j0:j0 + hh, i0:i0 + ww] = coarse_out[j0:j0 + hh, i0:i0 + ww] * (1.0 - w_seam) + ds_fine * w_seam

np.save(os.path.join(WORK, "terrain_core.npy"), core_out)
np.save(os.path.join(WORK, "terrain_fine.npy"), fine_out)
np.save(os.path.join(WORK, "terrain_coarse.npy"), coarse_out)
meta = dict(
    datum_asl=float(WATER_Y_ASL),
    waterY=0.0,
    core={**CORE, "scale": float(TERRAIN_CORE_SCALE), "offset": float(TERRAIN_OFFSET), "min": round(float(core_out.min()), 2), "max": round(float(core_out.max()), 2)},
    fine={**FINE, "scale": float(TERRAIN_SCALE), "offset": float(TERRAIN_OFFSET), "min": round(float(fine_out.min()), 2), "max": round(float(fine_out.max()), 2)},
    coarse={**COARSE, "scale": float(TERRAIN_SCALE), "offset": float(TERRAIN_OFFSET), "min": round(float(coarse_out.min()), 2), "max": round(float(coarse_out.max()), 2)},
)
json.dump(meta, open(os.path.join(WORK, "terrain_meta.json"), "w"), indent=1)
log("saved terrain_core/fine/coarse:", core_out.shape, fine_out.shape, coarse_out.shape)

# ---------------- 6. Quick cross-slope verification inside CORE!
ts = TerrainSampler(WORK)
cdeg, ckm = [], []
for k in bench_ways:
    if cls[k] not in (0, 1, 2, 3, 4, 5, 11):
        continue
    c = shapely.get_coordinates(R_GEOM[k])
    if len(c) < 2:
        continue
    mx, my = c[:, 0].mean(), c[:, 1].mean()
    if not (CORE["x0"] + 100 <= mx <= CORE["x0"] + CORE["nx"] * CORE["cell"] - 100 and CORE["y0"] + 100 <= my <= CORE["y0"] + CORE["ny"] * CORE["cell"] - 100):
        continue
    hw_ = float(W[k]) * 0.5
    p0s, p1s = c[:-1], c[1:]
    dv = p1s - p0s
    ls = np.hypot(dv[:, 0], dv[:, 1])
    ok = ls >= 2.0
    if not ok.any():
        continue
    p0s, p1s, dv, ls = p0s[ok], p1s[ok], dv[ok], ls[ok]
    nx_ = -dv[:, 1] / ls; ny_ = dv[:, 0] / ls
    mid = (p0s + p1s) * 0.5
    hL = ts.sample(mid[:, 0] + nx_ * hw_, mid[:, 1] + ny_ * hw_)
    hR = ts.sample(mid[:, 0] - nx_ * hw_, mid[:, 1] - ny_ * hw_)
    deg_ = np.degrees(np.arctan2(np.abs(hL - hR), max(float(W[k]), 1.0)))
    cdeg.append(deg_); ckm.append(ls / 1000.0)
cdeg = np.concatenate(cdeg); ckm = np.concatenate(ckm)
tot_km = ckm.sum()
log(f"CORE benched carriageway cross-slope ({tot_km:.1f} km): >3°={ckm[cdeg>3].sum():.1f}km ({100*ckm[cdeg>3].sum()/tot_km:.1f}%), "
    f">5°={ckm[cdeg>5].sum():.1f}km ({100*ckm[cdeg>5].sum()/tot_km:.1f}%), "
    f">10°={ckm[cdeg>10].sum():.1f}km ({100*ckm[cdeg>10].sum()/tot_km:.1f}%), max={cdeg.max():.1f}°")
log("done")
