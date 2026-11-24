"""Assign final heights, Chongqing 20 architectural styles (0..19), roof hints (0..10),
DEM terrain elevation bounds (ground_z_min, ground_z_max), podium_h, balcony_mask, and subtype.

usage: 21_heights_styles.py <work_dir>
"""
import sys, os, re, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from scipy import ndimage
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold
from common import *

WORK = sys.argv[1]
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


fused = gpd.read_parquet(os.path.join(WORK, "fused.parquet"))
n = len(fused)
log("fused", n)
g = fused.geometry.values
c = shapely.centroid(g)
CX = shapely.get_x(c)
CY = shapely.get_y(c)
rp = shapely.point_on_surface(g)

# ------------------------------------------------------------------ DEM sampling per building
terrain = TerrainSampler(WORK)
# Sample DEM at centroid + exterior ring vertices for exact min/max foundation range!
ext = shapely.get_exterior_ring(g)
ext_xy = shapely.get_coordinates(ext)
ext_n = shapely.get_num_coordinates(ext)
z_all = terrain.sample(ext_xy[:, 0], ext_xy[:, 1])
z_c = terrain.sample(CX, CY)
# Vectorized min/max per polygon via reduceat
starts = np.concatenate([[0], np.cumsum(ext_n)[:-1]])
gz_min = np.minimum(np.minimum.reduceat(z_all, starts), z_c)
gz_max = np.maximum(np.maximum.reduceat(z_all, starts), z_c)
# Clamp buildings accidentally sitting on bank edge to dry land >= 0.5m
gz_min = np.maximum(gz_min, -1.5)
gz_max = np.maximum(gz_max, np.maximum(gz_min, 0.5))
slope_drop = gz_max - gz_min
log(f"DEM sampled: ground_z_max median={np.median(gz_max):.1f}m, max={gz_max.max():.1f}m; slope_drop >=4m: {int((slope_drop >= 4.0).sum())} ({(slope_drop >= 4.0).mean()*100:.1f}%)")

# ------------------------------------------------------------------ geometry features
area = shapely.area(g)
perim = shapely.length(g)
mbr = shapely.minimum_rotated_rectangle(g)
mc = shapely.get_coordinates(shapely.get_exterior_ring(mbr)).reshape(-1, 5, 2)
e1 = np.hypot(*(mc[:, 1] - mc[:, 0]).T)
e2 = np.hypot(*(mc[:, 2] - mc[:, 1]).T)
mlong = np.maximum(e1, e2)
mshort = np.minimum(e1, e2)
d = np.where((e1 >= e2)[:, None], mc[:, 1] - mc[:, 0], mc[:, 2] - mc[:, 1])
orient = np.arctan2(d[:, 1], d[:, 0])
fill = area / np.maximum(mlong * mshort, 1e-6)
compact = 4 * np.pi * area / np.maximum(perim ** 2, 1e-6)
nv = shapely.get_num_coordinates(g)
nholes = shapely.get_num_interior_rings(g)
dist_c = np.hypot(CX, CY)

# ------------------------------------------------------------------ neighbourhood features (80 m grid)
CELL = 80.0
gw, ghh = int((X_MAX - X_MIN) / CELL), int((Y_MAX - Y_MIN) / CELL)
ix = np.clip(((CX - X_MIN) / CELL).astype(int), 0, gw - 1)
iy = np.clip(((CY - Y_MIN) / CELL).astype(int), 0, ghh - 1)
flat = iy * gw + ix
gb = fused.gba_h.values.astype(float)
ovh = fused.ov_h.values.astype(float) if "ov_h" in fused.columns else np.full(n, np.nan)
hsig = np.where(np.isfinite(gb), gb, ovh)


def grid_sum(w):
    return np.bincount(flat, weights=w, minlength=gw * ghh).reshape(ghh, gw)


A = grid_sum(area)
Cn = grid_sum(np.ones(n))
ok = np.isfinite(hsig)
AH = grid_sum(np.where(ok, hsig * area, 0))
AW = grid_sum(np.where(ok, area, 0))
mx = np.zeros(gw * ghh)
np.maximum.at(mx, flat[ok], hsig[ok])
mx = mx.reshape(ghh, gw)
feats_n = {}
for r, name in ((1, "n1"), (3, "n3")):
    k = 2 * r + 1
    a_ = ndimage.uniform_filter(A, k, mode="constant") * k * k
    c_ = ndimage.uniform_filter(Cn, k, mode="constant") * k * k
    ah = ndimage.uniform_filter(AH, k, mode="constant") * k * k
    aw = ndimage.uniform_filter(AW, k, mode="constant") * k * k
    feats_n[name + "_cov"] = (a_ / (k * k * CELL * CELL))[iy, ix]
    feats_n[name + "_cnt"] = c_[iy, ix]
    feats_n[name + "_hmean"] = (ah / np.maximum(aw, 1))[iy, ix]
    feats_n[name + "_hmax"] = ndimage.maximum_filter(mx, k)[iy, ix]
    feats_n[name + "_amean"] = (a_ / np.maximum(c_, 1))[iy, ix]

# ------------------------------------------------------------------ context layers
rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring")
ring_idx = np.full(n, 4, dtype=np.int8)
for r in (3, 2, 1):
    if r in rings.index:
        poly = rings.geometry[r]
        shapely.prepare(poly)
        ring_idx[shapely.contains(poly, c)] = r
log("ring counts", dict(zip(*np.unique(ring_idx, return_counts=True))))

areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
areas["geometry"] = shapely.make_valid(project_geoms(areas.geometry.values))
areas = areas.set_crs(PROJ_LOCAL, allow_override=True)
areas["a"] = areas.geometry.area


def contain_join(sub, value_col):
    out = np.full(n, None, dtype=object)
    if len(sub) == 0:
        return out
    sg = sub.geometry.values
    tree = shapely.STRtree(sg)
    qi, ti = tree.query(rp, predicate="within")
    if not len(qi):
        return out
    df = pd.DataFrame({"qi": qi, "a": sub.a.values[ti], "v": sub[value_col].values[ti]}).sort_values("a").drop_duplicates("qi")
    out[df.qi.values] = df.v.values
    return out


lu = areas[areas.kind.str.startswith("landuse=") & areas.kind.str.split("=").str[1].isin(
    ["residential", "commercial", "industrial", "retail", "railway", "military", "construction", "education", "institutional", "brownfield", "farmland", "religious", "port", "harbour"]
)].copy()
lu["v"] = lu.kind.str.split("=").str[1]
landuse = contain_join(lu, "v")

am = areas[areas.kinds.str.contains("amenity=(?:university|school|college|hospital|kindergarten)")].copy()
am["v"] = am.kinds.str.extract("amenity=(university|school|college|hospital|kindergarten)")[0].values
campus = contain_join(am, "v")

comp = areas[areas.kind.isin(["landuse=residential"]) & (areas.a < 1.5e6)].copy().reset_index(drop=True)
comp["cid"] = np.arange(len(comp))
compound = contain_join(comp, "cid")

# Traditional / Bayu historic precincts in Chongqing
TRAD = r"十八梯|磁器口|山城巷|下浩里|龙门浩|弹子石老街|湖广会馆|罗汉寺|慈云寺|涂山寺|老君洞|华岩寺|通远门|东水门城墙|金刚碑"
named = areas[areas["name"].notna() & (areas.a > 200)].copy()
sub = named[named["name"].str.contains(TRAD, regex=True)]
sub = sub[~sub.kind.isin(["landuse=residential", "landuse=industrial", "amenity=hospital", "amenity=school", "amenity=parking"])]
trad_zone = np.zeros(n, bool)
if len(sub):
    u = shapely.union_all(sub.geometry.values)
    shapely.prepare(u)
    trad_zone = shapely.contains(u, rp)
# Also add spatial zones for key Chongqing historic/Bayu hillsides (Ciqikou, Xiahaoli/Longmenhao, Shanchengxiang)
BAYU_CENTERS = [
    (-12050, 2250, 420),   # Ciqikou Ancient Town
    (-370, -680, 260),     # Shanchengxiang / Shibati slopes
    (1650, -350, 320),     # Longmenhao / Xiahaoli old street (Nanbin)
    (2550, 1450, 300),     # Danzishi Old Street
    (1180, 330, 200),      # Huguang Guild Hall area
]
bayu_zone = trad_zone.copy()
for bx, by, br in BAYU_CENTERS:
    bayu_zone |= np.hypot(CX - bx, CY - by) < br

pw = areas[areas.kinds.str.contains("amenity=place_of_worship|landuse=religious")]
worship_zone = np.zeros(n, bool)
if len(pw):
    u = shapely.union_all(pw.geometry.values)
    shapely.prepare(u)
    worship_zone = shapely.contains(u, rp)

# Key Chongqing CBD zones (for CBD supertall & modern commercial weighting)
# Jiefangbei CBD, Jiangbeizui CBD, Guanyinqiao CBD, Nanping CBD, Hualongqiao CBD, Yangjiaping CBD
CBD_ZONES = [
    (0.0, 100.0, 950.0),        # Jiefangbei / Yuzhong core
    (400.0, 1650.0, 900.0),     # Jiangbeizui Financial CBD
    (-4300.0, 1780.0, 850.0),   # Guanyinqiao CBD
    (-1600.0, -3100.0, 750.0),  # Nanping CBD
    (-5700.0, -700.0, 650.0),   # Hualongqiao CBD
    (-6100.0, -5400.0, 700.0),  # Yangjiaping CBD
]
in_cbd = np.zeros(n, bool)
for zx, zy, zr in CBD_ZONES:
    in_cbd |= np.hypot(CX - zx, CY - zy) < zr

# ------------------------------------------------------------------ trusted heights from OSM tags
b = fused["building"].fillna("").values
h_tag = fused.h_tag.values.astype(float)
lv = fused.lv_tag.values.astype(float)
has_name = fused["name"].notna().values
is_part = fused.is_part.values
RESI = {"apartments", "residential", "house", "dormitory", "detached", "semidetached_house", "terrace", "bungalow"}
COMM = {"office", "commercial", "retail", "hotel", "hospital", "civic", "government", "public", "university", "college", "school"}
per_lv = np.where(np.isin(b, list(RESI)), 3.05, np.where(np.isin(b, list(COMM)), 4.0, 3.3))
h_lv = lv * per_lv + 1.5
ratio = h_tag / np.maximum(lv, 0.1)
h_ok = np.isfinite(h_tag) & (h_tag >= 2) & (h_tag <= 600)
bogus_tall = h_ok & (h_tag > 150) & ~has_name & ~is_part & ~(np.isfinite(lv) & (ratio > 2.4) & (ratio < 7.5))
incons = h_ok & np.isfinite(lv) & (lv >= 2) & ((ratio < 2.2) | (ratio > 9)) & (h_tag > 150) & ~is_part
h_ok &= ~bogus_tall & ~incons
lv_ok = np.isfinite(lv) & (lv >= 2) & (lv <= 120)
ONE_LV = {"house", "bungalow", "hut", "shed", "garage", "garages", "roof", "carport", "greenhouse", "detached", "kiosk", "toilets", "service", "gatehouse", "pavilion", "cabin", "farm", "barn"}
lv1_ok = np.isfinite(lv) & (lv == 1) & (np.isin(b, list(ONE_LV)) | (area < 140))
h_trust = np.where(h_ok, h_tag, np.where(lv_ok, h_lv, np.where(lv1_ok, 3.8, np.nan)))
log("trusted OSM heights:", int(np.isfinite(h_trust).sum()), "tag:", int(h_ok.sum()), "levels:", int(lv_ok.sum()))

# ------------------------------------------------------------------ height model (Chongqing vertical density!)
ov_sub = fused["ov_subtype"].fillna("none").astype(str).values if "ov_subtype" in fused.columns else np.full(n, "none")
ov_cls = fused["ov_class"].fillna("none").astype(str).values if "ov_class" in fused.columns else np.full(n, "none")
X = pd.DataFrame({
    "gba_h": gb, "ov_h": ovh, "area": area, "perim": perim, "mlong": mlong, "mshort": mshort,
    "fill": fill, "compact": compact, "nv": nv, "nholes": nholes,
    "dist_c": dist_c, "x": CX, "y": CY, "ring": ring_idx.astype(float), "in_cbd": in_cbd.astype(float),
    "gz_max": gz_max, "slope_drop": slope_drop,
    "lu": pd.Categorical(pd.Series(landuse).fillna("none")).codes.astype(float),
    "ov_sub": pd.Categorical(ov_sub).codes.astype(float),
    "src": pd.Categorical(fused.src).codes.astype(float),
    **feats_n,
})
train = (h_ok | lv_ok) & ~is_part & (h_trust >= 5) & ~trad_zone
if train.sum() >= 250:
    ytr = np.log1p(h_trust[train])
    Xtr = X[train]
    groups = (np.floor(CX[train] / 1200).astype(int) * 1000 + np.floor(CY[train] / 1200).astype(int))
    mono = [1 if col in ("gba_h", "ov_h") else 0 for col in X.columns]
    params = dict(max_iter=450, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=20, l2_regularization=1.0, monotonic_cst=mono, random_state=7)
    cv_pred = np.zeros(train.sum())
    n_splits = min(5, len(np.unique(groups)))
    if n_splits >= 2:
        for tr_i, te_i in GroupKFold(n_splits=n_splits).split(Xtr, ytr, groups):
            m = HistGradientBoostingRegressor(**params).fit(Xtr.iloc[tr_i], ytr[tr_i])
            cv_pred[te_i] = m.predict(Xtr.iloc[te_i])
    else:
        cv_pred = HistGradientBoostingRegressor(**params).fit(Xtr, ytr).predict(Xtr)
    ref = np.expm1(ytr)
    cvp = np.expm1(cv_pred)
    sp = pd.Series(ref).corr(pd.Series(cvp), method="spearman")
    log(f"height model CV: n={train.sum()} spearman={sp:.3f} MAE={np.abs(ref - cvp).mean():.1f}m")
    model = HistGradientBoostingRegressor(**params).fit(Xtr, ytr)
    pred = np.expm1(model.predict(X))
    # Quantile variance restoration (remote-sensing GBA saturates below Chongqing's real 30-50F towers!)
    qs = np.linspace(0, 1, 201)
    q_pred = np.quantile(cvp, qs)
    q_ref = np.quantile(ref, qs)
    q_pred = np.maximum.accumulate(q_pred + np.arange(len(qs)) * 1e-6)
    stretched = np.interp(pred, q_pred, q_ref)
    h_model = 0.40 * pred + 0.60 * stretched
else:
    log("few OSM height samples, falling back to calibrated GBA + Overture")
    h_model = np.where(np.isfinite(gb), gb * 1.25, np.where(np.isfinite(ovh), ovh * 1.15, np.where(in_cbd, 48.0, 22.0)))

# Chongqing is famously vertical (30-45F towers throughout Yuzhong/Jiangbei/Nan'an): keep GBA strong signal when OSM missing
h_final = np.where(np.isfinite(h_trust), h_trust, h_model)
# Boost obviously-tall GBA towers in CBD/core if model under-predicted slightly
tall_boost = ~np.isfinite(h_trust) & np.isfinite(gb) & (gb > 35) & (ring_idx <= 2)
h_final = np.where(tall_boost, np.maximum(h_final, gb * 1.25), h_final)
h_final = np.clip(h_final, 3.0, 500.0)

# ------------------------------------------------------------------ 20 Chongqing Architectural Styles (0..19)
col = lambda k: fused[k].fillna("").values if k in fused.columns else np.full(n, "", dtype=object)
tour, hist, amen, relig, mmade, roofshape = col("tourism"), col("historic"), col("amenity"), col("religion"), col("man_made"), col("roof:shape")
office_t, shop_t, rail, leis, herit, aero = col("office"), col("shop"), col("railway"), col("leisure"), col("heritage"), col("aeroway")
sd = pd.to_numeric(fused["start_date"].astype(str).str.extract(r"(\d{4})")[0], errors="coerce").values
lu_s = pd.Series(landuse).fillna("").values
ov_s = pd.Series(ov_sub).fillna("").values
ov_c = pd.Series(ov_cls).fillna("").values

style = np.full(n, -1, dtype=np.int16)


def setst(mask, s, only_unset=True):
    m = mask & (style < 0) if only_unset else mask
    style[m] = ST[s]
    return int(m.sum())


# Deterministic spatial hash for organic neighborhood era mix (old 1990s highrises vs contemporary towers)
hsh = (np.floor(CX * 3.1).astype(np.int64) * 73856093) ^ (np.floor(CY * 3.1).astype(np.int64) * 19349663)
seed = (hsh & 0xFF).astype(np.uint8)
cid = np.asarray(pd.to_numeric(compound, errors="coerce"), dtype=float)
grid_c = (np.floor(CX / 160).astype(np.int64) * 9176 + np.floor(CY / 160).astype(np.int64)) + 1000003
cidv = np.where(np.isfinite(cid), np.nan_to_num(cid).astype(np.int64), grid_c)
pal = (((cidv * 2654435761) >> 7) & 0xFF).astype(np.uint8)

# Special / utility types first
setst(np.isin(mmade, ["storage_tank", "gasometer", "silo", "cooling_tower", "chimney", "water_tower"]) | np.isin(b, ["storage_tank", "silo"]), "tank")
setst(np.isin(b, ["roof", "carport", "greenhouse", "canopy"]) | (leis == "bandstand"), "canopy")
setst(np.isin(b, ["construction"]), "construction")
setst(np.isin(b, ["parking", "garages"]) | (amen == "parking"), "parking")

# Temples & traditional shrines
trad_tag = np.isin(b, ["temple", "pavilion", "pagoda", "shrine", "monastery", "gate", "palace"]) | \
    ((amen == "place_of_worship") & np.isin(relig, ["buddhist", "taoist", "confucian", "chinese_folk"]) & (area < 3500)) | \
    np.isin(hist, ["city_gate", "temple", "palace", "pagoda"])
setst(trad_tag, "temple")
setst(worship_zone & np.isin(relig, ["", "buddhist", "taoist", "confucian", "chinese_folk"]) & (area < 2500) & (h_final < 24) & ~np.isin(b, ["church", "cathedral", "mosque", "chapel"]), "temple")

# Bayu Vernacular (巴渝传统吊脚楼 / 山城老街民居) — inside Bayu historic precincts OR steep hillside small low-rise!
setst(bayu_zone & (h_final < 22) & (area < 1600), "bayu_vernacular")
setst((slope_drop >= 5.5) & (h_final < 16) & (area < 480) & (ring_idx <= 2) & ((pal % 10) < 5), "bayu_vernacular")

# Historic Republican / Mountain-City Masonry (民国/开埠石砌建筑)
old = np.isfinite(sd) & (sd < 1955)
setst(((herit != "") | (hist != "") | old | np.isin(b, ["church", "cathedral", "chapel"])) & (h_final < 65) & ~np.isin(hist, ["memorial", "monument", "ruins"]), "historic_masonry")
# Yuzhong old town (Jiefangbei/Zhongshan Rd/Shancheng) occasional historic masonry mid-rises
yuzhong_core = (CX > -2800) & (CX < 1200) & (CY > -700) & (CY < 900)
setst(yuzhong_core & (h_final >= 10) & (h_final < 26) & (area > 220) & (area < 1400) & ((pal % 17) == 0), "historic_masonry")

# Big roof / stadiums / stations / industrial
setst(np.isin(b, ["train_station", "transportation", "stadium", "grandstand", "hangar", "sports_hall", "sports_centre", "terminal"]) | (rail == "station") | np.isin(leis, ["stadium", "sports_centre", "sports_hall"]) | (aero != ""), "bigroof")
setst(np.isin(b, ["industrial", "warehouse", "manufacture", "factory", "storage", "depot"]) | (ov_s == "industrial"), "industrial")

# Hotels
setst(np.isin(b, ["hotel"]) | (tour == "hotel"), "hotel")

# Civic & Campus (universities, schools, hospitals, museums, civic halls)
setst(np.isin(b, ["school", "university", "college", "kindergarten", "hospital"]) | np.isin(amen, ["school", "university", "college", "hospital", "kindergarten"]) | pd.Series(campus).notna().values | (ov_s == "education") | (ov_s == "medical"), "campus")
setst(np.isin(b, ["public", "civic", "government", "museum", "library", "theatre"]) | np.isin(amen, ["library", "theatre", "townhall", "courthouse", "police", "fire_station", "arts_centre", "community_centre"]) | (tour == "museum") | (ov_s == "civic"), "civic")

# CBD Supertalls (>= 120m in CBD/core, or >= 150m anywhere) & Glass / Grid Offices
setst((h_final >= 135) & (in_cbd | np.isin(b, ["office", "commercial"]) | (office_t != "") | (ov_s == "commercial")), "cbd_supertall")
setst((h_final >= 165), "cbd_supertall")
setst((np.isin(b, ["office", "commercial"]) | (office_t != "") | np.isin(lu_s, ["commercial", "retail"]) | (ov_s == "commercial")) & (h_final >= 65), "office_glass")
setst((np.isin(b, ["retail", "supermarket", "mall", "shop", "kiosk"]) | (shop_t != "") | ((lu_s == "retail") & (h_final < 42)) | (in_cbd & (area > 1800) & (h_final < 36))), "commercial_mall")
setst(np.isin(b, ["office", "commercial"]) | (office_t != "") | np.isin(lu_s, ["commercial", "retail"]) | (ov_s == "commercial"), "office_grid")

# Industrial landuse
setst((lu_s == "industrial") & (area > 400) & (h_final < 32), "industrial")
setst((lu_s == "railway") & (area > 2000), "bigroof")

# Chongqing Residential Archetypes (the heart of Chongqing's skyline & streetscapes!)
# 1) Contemporary Residential High-Rise (30-45F towers, > 50m or modern compounds)
# 2) Classic 1990s-2000s Chongqing High-Rise / Slab Tower (老高层/筒子楼: 26..65m in inner urban core, ceramic mosaic / balconies / AC cages!)
# 3) Old Multi-Story Walk-Up Residential (老小区 6-8F: 12..26m)
resi_hint = np.isin(b, list(RESI)) | (lu_s == "residential") | (ov_s == "residential")
old_era = ((pal.astype(int) * 29) % 100) < np.where(yuzhong_core, 62, np.where(ring_idx == 1, 48, 32))

# Tall commercial / glass in CBD even if untagged
setst(in_cbd & (h_final >= 95), "office_glass")
setst(in_cbd & (h_final >= 42) & (area > 900) & ((pal % 3) != 0), "office_grid")
setst(in_cbd & (h_final < 28) & (area > 450), "commercial_mall")

# Residential high-rise split: modern vs classic 1990s Chongqing old high-rise
setst((h_final >= 68) & (area < 3200), "resi_modern")
setst((h_final >= 28) & old_era & (area < 2600), "resi_old_highrise")
setst((h_final >= 28) & (area < 2800), "resi_modern")
setst((h_final >= 11.5) & (h_final < 28) & (resi_hint | (area < 2400)), "resi_walkup")

# Low-rise urban/hillside fabric
setst((area > 3000) & (h_final < 24) & (ring_idx >= 3), "industrial")
setst((area > 2600) & (h_final < 24), "commercial_mall")
setst((h_final < 11.5) & (slope_drop >= 3.2) & (area < 550), "bayu_vernacular")
setst((h_final < 11.5) & (ring_idx <= 2) & (area < 450) & ((pal % 5) < 2), "bayu_vernacular")
setst((h_final < 11.5) & (area < 650), "resi_walkup")
setst(np.ones(n, bool), "generic")

log("styles:", {k: int((style == v).sum()) for k, v in ST.items()})

# Style-specific height sanity (only for modelled heights)
hm = ~np.isfinite(h_trust)
for s_, lo, hi in (("bayu_vernacular", 5.5, 16.0), ("resi_walkup", 9.0, 25.0), ("industrial", 6.0, 26.0), ("temple", 4.5, 15.0)):
    m = (style == ST[s_]) & hm
    h_final[m] = np.clip(h_final[m], lo, hi)
h_final[(style == ST["canopy"]) & hm] = 5.5
h_final = np.clip(h_final, 3.0, 500.0)

base = np.nan_to_num(fused.minh_tag.values.astype(float), nan=0.0)
base = np.where(base >= h_final - 0.5, 0.0, base)

# Storeys
FH = {
    ST["cbd_supertall"]: 4.2, ST["office_glass"]: 4.0, ST["office_grid"]: 3.7,
    ST["resi_modern"]: 3.0, ST["resi_old_highrise"]: 2.95, ST["resi_walkup"]: 2.9,
    ST["bayu_vernacular"]: 3.2, ST["historic_masonry"]: 3.8, ST["commercial_mall"]: 4.8,
    ST["hotel"]: 3.4, ST["civic"]: 4.0, ST["campus"]: 3.6, ST["industrial"]: 5.8,
    ST["temple"]: 3.6, ST["bigroof"]: 7.0, ST["parking"]: 3.0,
}
fh = np.array([FH.get(int(s_), 3.3) for s_ in style])
levels = np.where(lv_ok & ~is_part, lv, np.maximum(1, np.round((h_final - base) / fh)))
levels = np.clip(levels, 1, 150).astype(np.int16)

# ------------------------------------------------------------------ Roof Types (0..10)
rs = fused["roof:shape"].fillna("").values
roof = np.zeros(n, np.uint8)
quad = fill >= 0.70
slender = mlong / np.maximum(mshort, 0.1)

roof[(style == ST["bayu_vernacular"]) & (fill >= 0.55) & (mshort <= 22)] = ROOF["gable"]
roof[(style == ST["bayu_vernacular"]) & (fill >= 0.55) & (mshort <= 22) & ((seed % 3) == 0)] = ROOF["xieshan"]
roof[(style == ST["temple"]) & quad] = ROOF["xieshan"]
roof[(style == ST["temple"]) & quad & (slender < 1.35) & (area < 200)] = ROOF["pyramid"]
roof[(style == ST["historic_masonry"]) & quad & (h_final < 28)] = np.where((seed[(style == ST["historic_masonry"]) & quad & (h_final < 28)] % 2) == 0, ROOF["hip"], ROOF["mansard"])
# Pitched retrofits on walk-up residential estates
pitched_estate = ((pal.astype(int) * 37) % 100) < 38
roof[(style == ST["resi_walkup"]) & pitched_estate & quad & (mshort <= 18) & (h_final <= 24)] = ROOF["hip"]
roof[(style == ST["industrial"]) & (area > 500) & (fill > 0.74) & (mshort < 80)] = ROOF["shed"]
roof[(style == ST["industrial"]) & (area > 3500) & (fill > 0.78) & (seed < 80)] = ROOF["sawtooth"]
roof[(style == ST["tank"])] = ROOF["dome"]
# Stepped architectural crowns on CBD supertalls & tall offices/hotels
roof[(style == ST["cbd_supertall"]) & (h_final >= 110)] = ROOF["stepped_crown"]
roof[np.isin(style, [ST["office_glass"], ST["hotel"]]) & (h_final >= 75) & ((seed % 3) == 0)] = ROOF["stepped_crown"]

for tag, code in (("gabled", "gable"), ("hipped", "hip"), ("pyramidal", "pyramid"), ("hipped-and-gabled", "xieshan"),
                  ("dome", "dome"), ("round", "round"), ("flat", "flat"), ("mansard", "mansard"), ("onion", "dome")):
    m = (rs == tag) & (quad | (code in ("dome", "flat")))
    roof[m] = ROOF[code]

# ------------------------------------------------------------------ Architectural Metadata v2: podium_h, balcony_mask, subtype
# Podium height (metres): distinct 2-4F podium for tall towers & commercial buildings
podium_h = np.zeros(n, np.float32)
tall_podium = (h_final >= 28) & ~is_part & np.isin(style, [
    ST["cbd_supertall"], ST["office_glass"], ST["office_grid"], ST["hotel"],
    ST["resi_modern"], ST["resi_old_highrise"], ST["commercial_mall"],
])
podium_floors = np.where(np.isin(style, [ST["cbd_supertall"], ST["office_glass"], ST["commercial_mall"]]), 3 + (seed % 3), 2 + (seed % 2))
podium_h = np.where(tall_podium, np.minimum(podium_floors * 4.2, h_final * 0.35), 0.0)
podium_h = np.where((style == ST["resi_walkup"]) & (h_final >= 14) & (ring_idx <= 2) & ((pal % 3) == 0), 4.0, podium_h)
podium_h = np.clip(podium_h, 0.0, 48.0).astype(np.float32)

# balcony_mask bits:
#   b0: has_balconies, b1: has_ac_units, b2: has_sunshades, b3: has_neon_blades,
#   b4: has_stilts_base, b5: has_curtain_fins, b6: has_cornices, b7: has_crown_leds
bmask = np.zeros(n, np.uint8)
is_resi = np.isin(style, [ST["resi_modern"], ST["resi_old_highrise"], ST["resi_walkup"]])
bmask[is_resi | (style == ST["bayu_vernacular"])] |= 1                                                # b0: balconies
bmask[np.isin(style, [ST["resi_old_highrise"], ST["resi_walkup"], ST["resi_modern"], ST["bayu_vernacular"], ST["office_grid"]])] |= 2  # b1: AC units
bmask[np.isin(style, [ST["resi_walkup"], ST["resi_old_highrise"], ST["bayu_vernacular"], ST["commercial_mall"]])] |= 4                 # b2: sunshades/awnings
bmask[(in_cbd | (ring_idx == 1)) & np.isin(style, [ST["commercial_mall"], ST["office_grid"], ST["resi_old_highrise"], ST["resi_walkup"], ST["hotel"], ST["bayu_vernacular"]])] |= 8  # b3: neon blades
bmask[(slope_drop >= 4.5) & np.isin(style, [ST["bayu_vernacular"], ST["resi_old_highrise"], ST["resi_walkup"]])] |= 16               # b4: stilts/diaojiaolou/deep retaining base
bmask[np.isin(style, [ST["cbd_supertall"], ST["office_glass"], ST["hotel"]])] |= 32                   # b5: curtain fins/mullions
bmask[np.isin(style, [ST["historic_masonry"], ST["civic"], ST["office_grid"], ST["resi_old_highrise"], ST["hotel"], ST["commercial_mall"]])] |= 64  # b6: cornices
bmask[(h_final >= 55) & np.isin(style, [ST["cbd_supertall"], ST["office_glass"], ST["hotel"], ST["resi_modern"], ST["commercial_mall"]]) & ((ring_idx <= 2) | in_cbd)] |= 128  # b7: crown LEDs

# subtype (0..7 architectural palette/era variant per style, correlated within compounds)
subtype = ((pal.astype(int) * 7 + (seed.astype(int) >> 5)) & 7).astype(np.uint8)

out = fused[["geometry", "osm_id", "name", "name:en", "src", "is_part", "outline_id", "building", "man_made", "roof:shape", "roof:colour", "roof:material", "building:colour", "building:material",
             "start_date", "wikidata", "amenity", "tourism", "shop", "office"]].copy()
out["cx"] = CX
out["cy"] = CY
out["area"] = area
out["mlong"] = mlong
out["mshort"] = mshort
out["fill"] = fill
out["orient"] = orient
out["ring"] = ring_idx
out["height"] = h_final.astype(np.float32)
out["base"] = base.astype(np.float32)
out["ground_z_min"] = gz_min.astype(np.float32)
out["ground_z_max"] = gz_max.astype(np.float32)
out["levels"] = levels
out["h_src"] = np.where(h_ok, "tag", np.where(lv_ok | lv1_ok, "levels", "model"))
out["style"] = style.astype(np.uint8)
out["roof_code"] = roof
out["podium_h"] = podium_h
out["balcony_mask"] = bmask
out["subtype"] = subtype
out["pal"] = pal
out["seed"] = seed
out["landuse"] = landuse
out["compound"] = pd.array(compound, dtype="object")
out["nv"] = nv
out["year"] = sd
out.to_parquet(os.path.join(WORK, "buildings.parquet"))
comp[["cid", "name", "geometry", "a"]].to_parquet(os.path.join(WORK, "compounds.parquet"))
log(f"saved buildings.parquet ({len(out)} buildings; >=100m: {int((h_final >= 100).sum())}, >=60m: {int((h_final >= 60).sum())}, max: {h_final.max():.1f}m)")
