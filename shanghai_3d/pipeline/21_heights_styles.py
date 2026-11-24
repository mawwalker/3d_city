"""Assign final heights and architectural styles to the fused building set.

Heights:  trusted OSM tags > gradient-boosted model (GBA + CBMF height signals + morphology + context), trained on
          OSM-tagged buildings and variance-restored by quantile mapping (remote-sensing heights saturate near 100 m).
Styles:   OSM tags > named heritage / traditional precincts > land-use and CBMF function > morphology heuristics.

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


# style ids shared with the web app (site/src/world/styles.js)
ST = dict(generic=0, resi_slab=1, resi_tower=2, lilong=3, villa=4, office_glass=5, office_grid=6, retail=7, industrial=8, public=9,
          heritage=10, temple=11, bigroof=12, canopy=13, tank=14, construction=15, village=16, hotel=17, parking=18, special=19)

fused = gpd.read_parquet(os.path.join(WORK, "fused.parquet"))
n = len(fused)
log("fused", n)
g = fused.geometry.values
c = shapely.centroid(g)
CX = shapely.get_x(c); CY = shapely.get_y(c)
rp = shapely.point_on_surface(g)

# ------------------------------------------------------------------ geometry features
area = shapely.area(g)
perim = shapely.length(g)
mbr = shapely.minimum_rotated_rectangle(g)
mc = shapely.get_coordinates(shapely.get_exterior_ring(mbr)).reshape(-1, 5, 2)
e1 = np.hypot(*(mc[:, 1] - mc[:, 0]).T)
e2 = np.hypot(*(mc[:, 2] - mc[:, 1]).T)
mlong = np.maximum(e1, e2); mshort = np.minimum(e1, e2)
d = np.where((e1 >= e2)[:, None], mc[:, 1] - mc[:, 0], mc[:, 2] - mc[:, 1])
orient = np.arctan2(d[:, 1], d[:, 0])
fill = area / np.maximum(mlong * mshort, 1e-6)
compact = 4 * np.pi * area / np.maximum(perim ** 2, 1e-6)
nv = shapely.get_num_coordinates(g)
nholes = shapely.get_num_interior_rings(g)
dist_c = np.hypot(CX, CY)

# ------------------------------------------------------------------ CBMF: function + second height signal
cm = gpd.read_parquet(os.path.join(WORK, "cbmf_bbox.parquet"))
cg = project_geoms(cm.geometry.values)
ctree = shapely.STRtree(cg)
qi, ti = ctree.query(rp, predicate="within")
cmab_fn = np.full(n, None, dtype=object); cb_h = np.full(n, np.nan)
cmab_fn[qi] = cm["class_pred"].values[ti]; cb_h[qi] = cm["Height"].values[ti].astype(float)
log("cbmf joined", int(np.isfinite(cb_h).sum()), pd.Series(cmab_fn).value_counts().to_dict())

# ------------------------------------------------------------------ neighbourhood features on an 80 m grid
CELL = 80.0
gw, ghh = int((X_MAX - X_MIN) / CELL), int((Y_MAX - Y_MIN) / CELL)
ix = np.clip(((CX - X_MIN) / CELL).astype(int), 0, gw - 1)
iy = np.clip(((CY - Y_MIN) / CELL).astype(int), 0, ghh - 1)
flat = iy * gw + ix
gb = fused.gba_h.values.astype(float)
hsig = np.where(np.isfinite(gb), gb, cb_h)


def grid_sum(w):
    return np.bincount(flat, weights=w, minlength=gw * ghh).reshape(ghh, gw)


A = grid_sum(area)
Cn = grid_sum(np.ones(n))
ok = np.isfinite(hsig)
AH = grid_sum(np.where(ok, hsig * area, 0)); AW = grid_sum(np.where(ok, area, 0))
mx = np.zeros(gw * ghh); np.maximum.at(mx, flat[ok], hsig[ok]); mx = mx.reshape(ghh, gw)
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
# Puxi / Pudong: which side of the Huangpu (used for the old-city fabric rules); approximated by the river's centre line
areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
areas["geometry"] = shapely.make_valid(project_geoms(areas.geometry.values))
areas = areas.set_crs(PROJ_LOCAL, allow_override=True)
areas["a"] = areas.geometry.area


def contain_join(sub, value_col):
    """For each building: value of the smallest polygon in `sub` that contains its interior point."""
    out = np.full(n, None, dtype=object)
    if len(sub) == 0:
        return out
    sg = sub.geometry.values
    tree = shapely.STRtree(sg)
    qi, ti = tree.query(rp, predicate="within")
    df = pd.DataFrame({"qi": qi, "a": sub.a.values[ti], "v": sub[value_col].values[ti]}).sort_values("a").drop_duplicates("qi")
    out[df.qi.values] = df.v.values
    return out


lu = areas[areas.kind.str.startswith("landuse=") & areas.kind.str.split("=").str[1].isin(
    ["residential", "commercial", "industrial", "retail", "railway", "military", "construction", "education", "institutional", "brownfield", "farmland", "religious", "port", "harbour"])].copy()
lu["v"] = lu.kind.str.split("=").str[1]
landuse = contain_join(lu, "v")
am = areas[areas.kinds.str.contains("amenity=(?:university|school|college|hospital|kindergarten)")].copy()
am["v"] = am.kinds.str.extract("amenity=(university|school|college|hospital|kindergarten)")[0].values
campus = contain_join(am, "v")
log("landuse joined", pd.Series(landuse).value_counts().to_dict())
# residential compounds (小区): id + name, later used for shared facade palettes and perimeter walls
comp = areas[areas.kind.isin(["landuse=residential"]) & (areas.a < 1.5e6)].copy().reset_index(drop=True)
comp["cid"] = np.arange(len(comp))
compound = contain_join(comp, "cid")

# traditional Chinese precincts (gardens, temples, old water towns) by name
TRAD = r"^豫园$|城隍庙|^豫园商城$|^静安寺$|玉佛禅寺|^龙华寺$|^文庙$|上海文庙|古猗园|醉白池|秋霞圃|^方塔园$|真如寺|沉香阁|白云观|东林寺|西林禅寺|法华学问寺|七宝古镇|新场古镇|召稼楼|南翔老街|^朱家角|枫泾古镇|^大观园$|^古城公园$|^曲水园$|^汇龙潭|嘉定孔庙|^宝山寺$|^下海庙$|^三元宫"
named = areas[areas["name"].notna() & (areas.a > 400)].copy()
sub = named[named["name"].str.contains(TRAD, regex=True)]
sub = sub[~sub.kind.isin(["landuse=residential", "landuse=commercial", "landuse=construction", "amenity=hospital", "amenity=school", "amenity=parking", "landuse=industrial",
                          "amenity=university", "amenity=college", "landuse=farmland", "landuse=railway"])]
trad_zone = np.zeros(n, bool)
if len(sub):
    u = shapely.union_all(sub.geometry.values); shapely.prepare(u)
    trad_zone = shapely.contains(u, rp)
log("traditional precincts:", len(sub), "areas,", int(trad_zone.sum()), "buildings")
pw = areas[areas.kinds.str.contains("amenity=place_of_worship|landuse=religious")]
worship_zone = np.zeros(n, bool)
if len(pw):
    u = shapely.union_all(pw.geometry.values); shapely.prepare(u)
    worship_zone = shapely.contains(u, rp)

# ------------------------------------------------------------------ trusted heights from OSM tags
b = fused["building"].fillna("").values
h_tag = fused.h_tag.values.astype(float); lv = fused.lv_tag.values.astype(float)
has_name = fused["name"].notna().values
is_part = fused.is_part.values
RESI = {"apartments", "residential", "house", "dormitory", "detached", "semidetached_house", "terrace", "bungalow"}
COMM = {"office", "commercial", "retail", "hotel", "hospital", "civic", "government", "public", "university", "college", "school"}
per_lv = np.where(np.isin(b, list(RESI)), 3.0, np.where(np.isin(b, list(COMM)), 3.9, 3.3))
h_lv = lv * per_lv + 1.2
ratio = h_tag / lv
h_ok = np.isfinite(h_tag) & (h_tag >= 2) & (h_tag <= 700)
bogus_tall = h_ok & (h_tag > 120) & ~has_name & ~is_part & ~(np.isfinite(lv) & (ratio > 2.4) & (ratio < 7.5))
incons = h_ok & np.isfinite(lv) & (lv >= 2) & ((ratio < 2.2) | (ratio > 9)) & (h_tag > 120) & ~is_part
h_ok &= ~bogus_tall & ~incons
lv_ok = np.isfinite(lv) & (lv >= 2) & (lv <= 130)
ONE_LV = {"house", "bungalow", "hut", "shed", "garage", "garages", "roof", "carport", "greenhouse", "detached", "kiosk", "toilets", "service", "gatehouse", "pavilion", "cabin", "farm", "barn", "sty", "stable"}
lv1_ok = np.isfinite(lv) & (lv == 1) & (np.isin(b, list(ONE_LV)) | (area < 140))
h_trust = np.where(h_ok, h_tag, np.where(lv_ok, h_lv, np.where(lv1_ok, 3.6, np.nan)))
log("trusted heights:", int(np.isfinite(h_trust).sum()), " from height tag", int(h_ok.sum()), " bogus tall rejected", int(bogus_tall.sum()), " inconsistent", int(incons.sum()))

# ------------------------------------------------------------------ height model
X = pd.DataFrame({
    "gba_h": gb, "cb_h": cb_h, "area": area, "perim": perim, "mlong": mlong, "mshort": mshort, "fill": fill, "compact": compact, "nv": nv, "nholes": nholes,
    "dist_c": dist_c, "x": CX, "y": CY, "ring": ring_idx.astype(float),
    "lu": pd.Categorical(pd.Series(landuse).fillna("none")).codes.astype(float),
    "cmab": pd.Categorical(pd.Series(cmab_fn).fillna("none")).codes.astype(float),
    "src": pd.Categorical(fused.src).codes.astype(float),
    **feats_n,
})
train = (h_ok | lv_ok) & ~is_part & (h_trust >= 5) & ~trad_zone
ytr = np.log1p(h_trust[train])
Xtr = X[train]
groups = (np.floor(CX[train] / 1500).astype(int) * 1000 + np.floor(CY[train] / 1500).astype(int))
mono = [1 if col in ("gba_h", "cb_h") else 0 for col in X.columns]
params = dict(max_iter=500, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=25, l2_regularization=1.0, monotonic_cst=mono, random_state=7)
cv_pred = np.zeros(train.sum())
for tr_i, te_i in GroupKFold(n_splits=5).split(Xtr, ytr, groups):
    m = HistGradientBoostingRegressor(**params).fit(Xtr.iloc[tr_i], ytr[tr_i])
    cv_pred[te_i] = m.predict(Xtr.iloc[te_i])
ref = np.expm1(ytr); cvp = np.expm1(cv_pred)
sp = pd.Series(ref).corr(pd.Series(cvp), method="spearman")
log(f"height model CV: n={train.sum()} spearman={sp:.3f} pearson={np.corrcoef(ref, cvp)[0, 1]:.3f} MAE={np.abs(ref - cvp).mean():.1f}m "
    f"(raw GBA: spearman={pd.Series(ref).corr(pd.Series(gb[train]), method='spearman'):.3f} MAE={np.nanmean(np.abs(ref - gb[train])):.1f}m; "
    f"raw CBMF: spearman={pd.Series(ref).corr(pd.Series(cb_h[train]), method='spearman'):.3f} MAE={np.nanmean(np.abs(ref - cb_h[train])):.1f}m)")
model = HistGradientBoostingRegressor(**params).fit(Xtr, ytr)
pred = np.expm1(model.predict(X))
qs = np.linspace(0, 1, 201)
q_pred = np.quantile(cvp, qs); q_ref = np.quantile(ref, qs)
q_pred = np.maximum.accumulate(q_pred + np.arange(len(qs)) * 1e-6)
stretched = np.interp(pred, q_pred, q_ref)
h_model = 0.35 * pred + 0.65 * stretched
log("model height pct 5/25/50/75/95/99/99.9:", np.percentile(h_model, [5, 25, 50, 75, 95, 99, 99.9]).round(1), " cv bins:")
bins = [0, 8, 15, 25, 40, 60, 80, 120, 200, 1000]
cvs = np.interp(cvp, q_pred, q_ref) * 0.65 + cvp * 0.35
tb = pd.DataFrame({"ref": ref, "cv": cvp, "cvs": cvs, "bin": pd.cut(ref, bins)}).groupby("bin", observed=True).agg(n=("ref", "size"), ref=("ref", "median"), cv=("cv", "median"), cv_stretched=("cvs", "median"))
print(tb.round(1).to_string())

# ------------------------------------------------------------------ styles
col = lambda k: fused[k].fillna("").values
tour, hist, amen, relig, mmade, roofshape = col("tourism"), col("historic"), col("amenity"), col("religion"), col("man_made"), col("roof:shape")
office_t, shop_t, rail, leis, herit, aero = col("office"), col("shop"), col("railway"), col("leisure"), col("heritage"), col("aeroway")
sd = pd.to_numeric(fused["start_date"].astype(str).str.extract(r"(\d{4})")[0], errors="coerce").values
style = np.full(n, -1, dtype=np.int16)


def setst(mask, s, only_unset=True):
    m = mask & (style < 0) if only_unset else mask
    style[m] = ST[s]
    return int(m.sum())


h_final = np.where(np.isfinite(h_trust), h_trust, h_model)
cm_s = pd.Series(cmab_fn).fillna("").values
lu_s = pd.Series(landuse).fillna("").values

setst(np.isin(mmade, ["storage_tank", "gasometer", "silo", "cooling_tower", "chimney", "water_tower"]) | np.isin(b, ["storage_tank", "silo"]), "tank")
setst(np.isin(b, ["roof", "carport", "greenhouse", "canopy"]) | (leis == "bandstand"), "canopy")
setst(np.isin(b, ["construction"]), "construction")
setst(np.isin(b, ["parking", "garages"]) | (amen == "parking"), "parking")
# Chinese traditional architecture
trad_tag = np.isin(b, ["temple", "pavilion", "pagoda", "shrine", "monastery", "gate", "palace"]) | \
    ((amen == "place_of_worship") & np.isin(relig, ["buddhist", "taoist", "confucian", "chinese_folk"]) & (area < 3500)) | np.isin(hist, ["city_gate", "temple", "palace", "pagoda"])
setst(trad_tag, "temple")
setst(trad_zone & (area < 4500) & (h_final < 30), "temple")
setst(worship_zone & np.isin(relig, ["", "buddhist", "taoist", "confucian", "chinese_folk"]) & (area < 2500) & (h_final < 25) & ~np.isin(b, ["church", "cathedral", "mosque", "chapel"]), "temple")
# Western-style heritage: tagged listings, pre-1950 dates, churches, and the Bund frontage
bund = (CX > 1560) & (CX < 1960) & (CY > -120) & (CY < 1320)
old = np.isfinite(sd) & (sd < 1950)
setst(((herit != "") | (hist != "") | old | np.isin(b, ["church", "cathedral", "chapel", "synagogue"])) & (h_final < 95) & ~np.isin(hist, ["memorial", "monument", "ruins"]), "heritage")
setst(bund & (h_final < 80) & (area > 250) & (fused.src.values == "osm"), "heritage")
log("temple", int((style == ST["temple"]).sum()), "heritage", int((style == ST["heritage"]).sum()))

setst(np.isin(b, ["train_station", "transportation", "stadium", "grandstand", "hangar", "sports_hall", "sports_centre", "terminal"]) | (rail == "station") | np.isin(leis, ["stadium", "sports_centre", "sports_hall"]) | (aero != ""), "bigroof")
setst(np.isin(b, ["industrial", "warehouse", "manufacture", "factory", "storage", "depot"]), "industrial")
setst(np.isin(b, ["hotel"]) | (tour == "hotel"), "hotel")
tall_c = h_final >= 55
setst((np.isin(b, ["office", "commercial"]) | (office_t != "")) & tall_c, "office_glass")
setst(np.isin(b, ["office", "commercial"]) | (office_t != ""), "office_grid")
setst(np.isin(b, ["retail", "supermarket", "mall", "shop", "kiosk"]) | (shop_t != ""), "retail")
setst(np.isin(b, ["school", "university", "college", "kindergarten", "hospital", "public", "civic", "government", "mosque", "museum", "library", "theatre"]) |
      np.isin(amen, ["school", "university", "college", "hospital", "library", "theatre", "townhall", "courthouse", "police", "fire_station", "arts_centre", "community_centre", "kindergarten"]) | (tour == "museum"), "public")
setst(np.isin(b, ["villa", "detached", "semidetached_house"]), "villa")
resi_tag = np.isin(b, ["apartments", "residential", "dormitory", "terrace"])
setst(resi_tag & (h_final >= 27), "resi_tower")
setst(resi_tag & (h_final >= 10.5), "resi_slab")

# old low-rise fabric: lilong inside the inner ring (Puxi side mostly), rural houses outside the outer ring
small_low = (area < 320) & (h_final < 12.5)
inner = ring_idx <= 1
dense_small = (feats_n["n1_cnt"] > 40) & (feats_n["n1_amean"] < 260)
setst(inner & small_low & dense_small & (np.isin(b, ["", "yes", "house", "residential", "terrace", "apartments"])), "lilong")
setst((ring_idx == 2) & small_low & (feats_n["n1_cnt"] > 55) & (feats_n["n1_amean"] < 200), "lilong")
setst(resi_tag, "lilong" if False else "resi_slab")
setst(np.isin(b, ["house", "bungalow", "hut", "shed", "farm", "barn", "cabin"]) & (ring_idx >= 3), "village")
setst(np.isin(b, ["house"]), "villa")

# land-use / function context
setst((lu_s == "industrial") & (area > 500) & (h_final < 30), "industrial")
setst((cm_s == "Industrial") & (area > 600) & (h_final < 28) & (ring_idx >= 2), "industrial")
setst(pd.Series(campus).notna().values | np.isin(cm_s, ["Education", "Medical", "Government"]) & (area > 500), "public")
setst(np.isin(lu_s, ["commercial", "retail"]) & (h_final >= 55), "office_glass")
setst(np.isin(lu_s, ["commercial", "retail"]) & (area > 2500) & (h_final < 40), "retail")
setst(np.isin(lu_s, ["commercial", "retail"]), "office_grid")
setst((lu_s == "railway") & (area > 3000), "bigroof")
setst((cm_s == "Commercial") & (h_final >= 60) & (fill > 0.6), "office_glass")
setst((cm_s == "Commercial") & (area > 3000) & (h_final < 36), "retail")
setst((cm_s == "Commercial") & (h_final >= 24), "office_grid")
setst((cm_s == "Public") & (area > 900) & (h_final < 40), "public")

# morphology heuristics for the rest
big_low = (area > 3500) & (h_final < 22)
setst(big_low & (ring_idx >= 3), "industrial")
setst(big_low, "retail")
setst((h_final >= 27) & (area < 2200), "resi_tower")
setst((h_final >= 60), "office_glass")
slab = (mlong / np.maximum(mshort, 1) > 2.0) & (mshort > 7.5) & (mshort < 24)
setst(slab & (h_final >= 10.5), "resi_slab")
setst(small_low & (ring_idx >= 3) & (feats_n["n1_cov"] < 0.33), "village")
setst(small_low & (ring_idx <= 2), "lilong")
setst((area < 420) & (h_final < 12.5), "village")
setst((lu_s == "residential") | (cm_s == "Residential"), "resi_slab")
setst((h_final >= 12), "resi_slab")
setst(np.ones(n, bool), "generic")
log("styles:", {k: int((style == v).sum()) for k, v in ST.items()})

# style-specific height sanity
hm = ~np.isfinite(h_trust)
for s_, lo, hi in (("lilong", 6.0, 12.5), ("village", 3.2, 11.0), ("villa", 6.0, 13.0), ("industrial", 5.0, 30.0), ("temple", 3.2, 14.0)):
    m = (style == ST[s_]) & hm
    h_final[m] = np.clip(h_final[m], lo, hi)
h_final[(style == ST["canopy"]) & hm] = 5.5
tk = (style == ST["tank"]) & hm
h_final[tk] = np.where(mmade[tk] == "chimney", 90, np.where(mmade[tk] == "cooling_tower", 75, 14))
# halls of temples and gardens: store the eave height; the roof is added on top by the client
hall = style == ST["temple"]
h_final[hall & hm] = np.clip(0.30 * mshort[hall & hm] + 1.8, 3.0, 12.5)
h_final = np.clip(h_final, 2.6, 700)

base = np.nan_to_num(fused.minh_tag.values.astype(float), nan=0.0)
base = np.where(base >= h_final - 0.5, 0.0, base)

# storeys
FH = {ST["resi_slab"]: 2.9, ST["resi_tower"]: 2.95, ST["lilong"]: 3.3, ST["villa"]: 3.3, ST["village"]: 3.2, ST["office_glass"]: 4.1, ST["office_grid"]: 3.7, ST["retail"]: 5.0,
      ST["industrial"]: 6.0, ST["public"]: 3.8, ST["heritage"]: 4.3, ST["hotel"]: 3.4, ST["parking"]: 3.0}
fh = np.array([FH.get(int(s_), 3.4) for s_ in style])
levels = np.where(lv_ok & ~is_part, lv, np.maximum(1, np.round((h_final - base) / fh)))
levels = np.clip(levels, 1, 200).astype(np.int16)

out = fused[["geometry", "osm_id", "name", "name:en", "src", "is_part", "outline_id", "building", "man_made", "roof:shape", "roof:colour", "roof:material", "building:colour", "building:material",
             "start_date", "wikidata", "amenity", "tourism", "shop", "office"]].copy()
out["cx"] = CX; out["cy"] = CY; out["area"] = area; out["mlong"] = mlong; out["mshort"] = mshort; out["fill"] = fill; out["orient"] = orient; out["ring"] = ring_idx
out["height"] = h_final.astype(np.float32)
out["base"] = base.astype(np.float32)
out["levels"] = levels
out["h_src"] = np.where(h_ok, "tag", np.where(lv_ok | lv1_ok, "levels", "model"))
out["style"] = style.astype(np.uint8)
out["landuse"] = landuse
out["fn"] = cmab_fn
out["compound"] = pd.array(compound, dtype="object")
out["nv"] = nv
out["year"] = sd
out.to_parquet(os.path.join(WORK, "buildings.parquet"))
comp[["cid", "name", "geometry", "a"]].to_parquet(os.path.join(WORK, "compounds.parquet"))
log("saved buildings.parquet")
for nm, m in (("inside outer ring", ring_idx <= 3), ("outside", ring_idx > 3)):
    hh = h_final[m]; aa = area[m]
    log(f"{nm}: n={m.sum()} footprint={aa.sum() / 1e6:.1f}km2 height pct5/25/50/75/95/99/max={np.percentile(hh, [5, 25, 50, 75, 95, 99, 100]).round(1)} area-weighted mean={np.average(hh, weights=aa):.1f}m  >=100m: {(hh >= 100).sum()}  >=60m: {(hh >= 60).sum()}")
