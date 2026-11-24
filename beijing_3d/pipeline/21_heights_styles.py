"""Assign final heights and architectural styles to the fused building set.

Heights:  trusted OSM tags > gradient-boosted model (GBA + 3D-GloBFP height signals + morphology + context),
          trained on OSM-tagged buildings and variance-restored by quantile mapping.
Styles:   OSM tags > heritage-site containment > land-use context > morphology heuristics.

usage: 21_heights_styles.py <work_dir>
"""
import sys, os, re, time
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


# style ids shared with the web app (site/src/styles.js)
ST = dict(generic=0, resi=1, office=2, retail=3, industrial=4, courtyard=5, imperial=6, temple=7, public=8, bigroof=9, canopy=10, tank=11,
          construction=12, village=13, special=14, villa=15)
# roof-palette ids for imperial / temple styles
PAL = dict(yellow=0, green=1, blue=2, grey=3)

fused = gpd.read_parquet(os.path.join(WORK, "fused.parquet"))
n = len(fused)
log("fused", n)
g = fused.geometry.values
c = shapely.centroid(g)
CX = shapely.get_x(c); CY = shapely.get_y(c)
fused["cx"] = CX; fused["cy"] = CY
rp = shapely.point_on_surface(g)

# ------------------------------------------------------------------ geometry features
area = shapely.area(g)
perim = shapely.length(g)
mbr = shapely.minimum_rotated_rectangle(g)
mc = shapely.get_coordinates(shapely.get_exterior_ring(mbr)).reshape(-1, 5, 2) if True else None
e1 = np.hypot(*(mc[:, 1] - mc[:, 0]).T)
e2 = np.hypot(*(mc[:, 2] - mc[:, 1]).T)
mlong = np.maximum(e1, e2); mshort = np.minimum(e1, e2)
# orientation (radians, of the long side) – also used later for roofs
d = np.where((e1 >= e2)[:, None], mc[:, 1] - mc[:, 0], mc[:, 2] - mc[:, 1])
orient = np.arctan2(d[:, 1], d[:, 0])
fill = area / np.maximum(mlong * mshort, 1e-6)
compact = 4 * np.pi * area / np.maximum(perim ** 2, 1e-6)
nv = shapely.get_num_coordinates(g)
nholes = shapely.get_num_interior_rings(g)
fused["area"] = area; fused["mlong"] = mlong; fused["mshort"] = mshort; fused["fill"] = fill; fused["orient"] = orient
dist_c = np.hypot(CX, CY)

# ------------------------------------------------------------------ neighbourhood features on an 80 m grid
CELL = 80.0
x0, y0 = GRID_X0, GRID_Y0
gw, ghh = int(GRID_NX * TILE / CELL), int(GRID_NY * TILE / CELL)
ix = np.clip(((CX - x0) / CELL).astype(int), 0, gw - 1)
iy = np.clip(((CY - y0) / CELL).astype(int), 0, ghh - 1)
flat = iy * gw + ix
gb = fused.gba_h.values.astype(float); gl = fused.globfp_h.values.astype(float)
hsig = np.where(np.isfinite(gb), gb, gl)


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
ring_idx = np.full(n, 7, dtype=np.int8)
for r in (6, 5, 4, 3, 2):
    poly = rings.geometry[r]
    shapely.prepare(poly)
    ring_idx[shapely.contains(poly, c)] = r
fused["ring"] = ring_idx
log("ring counts", dict(zip(*np.unique(ring_idx, return_counts=True))))

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
    ["residential", "commercial", "industrial", "retail", "railway", "military", "construction", "education", "institutional", "brownfield", "farmland", "religious"])].copy()
lu["v"] = lu.kind.str.split("=").str[1]
landuse = contain_join(lu, "v")
am = areas[areas.kinds.str.contains("amenity=(?:university|school|college|hospital)")].copy()
am["v"] = am.kinds.str.extract("amenity=(university|school|college|hospital)")[0].values
campus = contain_join(am, "v")
log("landuse joined", pd.Series(landuse).value_counts().to_dict())

# heritage zones by name
HERITAGE = [
    (r"^故宫$|^紫禁城$|^故宫博物院$", "imperial", "yellow"),
    (r"^太庙$|劳动人民文化宫", "imperial", "yellow"),
    (r"^社稷坛$|^中山公园$", "imperial", "yellow"),
    (r"^景山公园$", "imperial", "yellow"),
    (r"^北海公园$", "imperial", "green"),
    (r"^天坛公园$|^天坛$", "imperial", "blue"),
    (r"^地坛公园$|^地坛$", "imperial", "yellow"),
    (r"^日坛公园$|^月坛公园$|^先农坛$", "imperial", "green"),
    (r"^雍和宫", "imperial", "yellow"),
    (r"孔庙|国子监", "imperial", "yellow"),
    (r"历代帝王庙", "imperial", "yellow"),
    (r"^颐和园$", "temple", "grey"),
    (r"^恭王府", "temple", "green"),
    (r"^香山公园$|^圆明园遗址公园$|^北京大观园$|^陶然亭公园$|^紫竹院公园$", "temple", "grey"),
    (r"白云观|法源寺|广济寺|智化寺|东岳庙|大钟寺|五塔寺|万寿寺|白塔寺|妙应寺|天宁寺|广化寺|柏林寺|通教寺|火德真君庙|都城隍庙|大高玄殿|寿皇殿|普度寺|嵩祝寺|智珠寺|碧云寺|卧佛寺|大觉寺|潭柘寺|戒台寺|八大处|法海寺|报国寺|长椿寺|护国寺|隆福寺|拈花寺|龙泉寺|红螺寺|云居寺|醇亲王府|宋庆龄|郭沫若|皇史宬|先蚕坛|团城|钟楼|鼓楼|觉生寺|大慧寺|真觉寺|慈寿寺|摩诃庵|西黄寺|东黄寺|黄寺|关帝庙|药王庙|文天祥祠|于谦祠|袁崇焕",
     "temple", "grey"),
]
her_style = np.full(n, -1, dtype=np.int16); her_pal = np.zeros(n, dtype=np.uint8)
named = areas[areas["name"].notna() & (areas.a > 800)].copy()
for pat, st, pal in HERITAGE:
    sub = named[named["name"].str.contains(pat, regex=True)]
    sub = sub[~sub.kind.isin(["landuse=residential", "landuse=commercial", "landuse=construction", "amenity=hospital", "amenity=school", "amenity=parking",
                              "landuse=industrial", "landuse=retail", "amenity=university", "amenity=college", "landuse=farmland", "landuse=brownfield", "landuse=military"])]
    if len(sub) == 0:
        continue
    u = shapely.union_all(sub.geometry.values)
    shapely.prepare(u)
    inside = shapely.contains(u, rp) & (her_style < 0)
    her_style[inside] = ST[st]; her_pal[inside] = PAL[pal]
    log(f"  heritage {pat[:28]:<30} zones={len(sub):3d} buildings={int(inside.sum())}")
# places of worship (Chinese traditions) as areas
pw = areas[areas.kinds.str.contains("amenity=place_of_worship|historic=temple|landuse=religious|historic=palace|historic=castle|historic=city_gate")]
if len(pw):
    u = shapely.union_all(pw.geometry.values); shapely.prepare(u)
    inside = shapely.contains(u, rp) & (her_style < 0) & (area < 4000)
    her_style[inside] = ST["temple"]; her_pal[inside] = PAL["grey"]
    log("  worship/historic areas buildings", int(inside.sum()))

# CMAB function (weak prior for untagged buildings)
cm = gpd.read_parquet(os.path.join(WORK, "cmab_bbox.parquet"))
cg = project_geoms(cm.geometry.values)
ctree = shapely.STRtree(cg)
qi, ti = ctree.query(rp, predicate="within")
cmab_fn = np.full(n, None, dtype=object)
cmab_fn[qi] = cm["Function"].values[ti]
log("cmab function joined", pd.Series(cmab_fn).value_counts().to_dict())

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
incons = h_ok & np.isfinite(lv) & (lv >= 2) & ((ratio < 2.2) | (ratio > 9)) & (h_tag > 120)
h_ok &= ~bogus_tall & ~incons
lv_ok = np.isfinite(lv) & (lv >= 2) & (lv <= 130)
ONE_LV = {"house", "bungalow", "hut", "shed", "garage", "garages", "roof", "carport", "greenhouse", "detached", "kiosk", "toilets", "service", "gatehouse", "pavilion", "cabin", "farm", "barn", "sty", "stable"}
lv1_ok = np.isfinite(lv) & (lv == 1) & (np.isin(b, list(ONE_LV)) | (area < 140))
h_trust = np.where(h_ok, h_tag, np.where(lv_ok, h_lv, np.where(lv1_ok, 3.6, np.nan)))
log("trusted heights:", int(np.isfinite(h_trust).sum()), " from height tag", int(h_ok.sum()), " bogus tall rejected", int(bogus_tall.sum()), " inconsistent", int(incons.sum()))

# ------------------------------------------------------------------ height model
X = pd.DataFrame({
    "gba_h": gb, "globfp_h": gl, "area": area, "perim": perim, "mlong": mlong, "mshort": mshort, "fill": fill, "compact": compact, "nv": nv, "nholes": nholes,
    "dist_c": dist_c, "x": CX, "y": CY, "ring": ring_idx.astype(float),
    "lu": pd.Categorical(pd.Series(landuse).fillna("none")).codes.astype(float),
    "cmab": pd.Categorical(pd.Series(cmab_fn).fillna("none")).codes.astype(float),
    "src": pd.Categorical(fused.src).codes.astype(float),
    **feats_n,
})
train = (h_ok | lv_ok) & ~is_part & (her_style < 0) & (h_trust >= 5)
ytr = np.log1p(h_trust[train])
Xtr = X[train]
groups = (np.floor(CX[train] / 1500).astype(int) * 1000 + np.floor(CY[train] / 1500).astype(int))
mono = [1 if col in ("gba_h", "globfp_h") else 0 for col in X.columns]
params = dict(max_iter=500, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=25, l2_regularization=1.0, monotonic_cst=mono, random_state=7)
cv_pred = np.zeros(train.sum())
for tr_i, te_i in GroupKFold(n_splits=5).split(Xtr, ytr, groups):
    m = HistGradientBoostingRegressor(**params).fit(Xtr.iloc[tr_i], ytr[tr_i])
    cv_pred[te_i] = m.predict(Xtr.iloc[te_i])
ref = np.expm1(ytr); cvp = np.expm1(cv_pred)
sp = pd.Series(ref).corr(pd.Series(cvp), method="spearman")
log(f"height model CV: n={train.sum()} spearman={sp:.3f} pearson={np.corrcoef(ref, cvp)[0, 1]:.3f} MAE={np.abs(ref - cvp).mean():.1f}m "
    f"(raw GBA: spearman={pd.Series(ref).corr(pd.Series(gb[train]), method='spearman'):.3f} MAE={np.nanmean(np.abs(ref - gb[train])):.1f}m)")
model = HistGradientBoostingRegressor(**params).fit(Xtr, ytr)
pred = np.expm1(model.predict(X))
# variance restoration: map the CV-prediction distribution onto the reference distribution (monotone), then blend with the raw prediction
qs = np.linspace(0, 1, 201)
q_pred = np.quantile(cvp, qs); q_ref = np.quantile(ref, qs)
q_pred = np.maximum.accumulate(q_pred + np.arange(len(qs)) * 1e-6)
stretched = np.interp(pred, q_pred, q_ref)
h_model = 0.35 * pred + 0.65 * stretched
log("model height pct 5/25/50/75/95/99:", np.percentile(h_model, [5, 25, 50, 75, 95, 99]).round(1), " cv bins:")
bins = [0, 8, 15, 25, 40, 60, 80, 120, 200, 1000]
cvs = np.interp(cvp, q_pred, q_ref) * 0.65 + cvp * 0.35
tb = pd.DataFrame({"ref": ref, "cv": cvp, "cvs": cvs, "bin": pd.cut(ref, bins)}).groupby("bin", observed=True).agg(n=("ref", "size"), ref=("ref", "median"), cv=("cv", "median"), cv_stretched=("cvs", "median"))
print(tb.round(1).to_string())

# ------------------------------------------------------------------ styles
tour = fused["tourism"].fillna("").values; hist = fused["historic"].fillna("").values; amen = fused["amenity"].fillna("").values
relig = fused["religion"].fillna("").values; mmade = fused["man_made"].fillna("").values; roofshape = fused["roof:shape"].fillna("").values
office_t = fused["office"].fillna("").values; shop_t = fused["shop"].fillna("").values; rail = fused["railway"].fillna("").values
leis = fused["leisure"].fillna("").values
style = np.full(n, -1, dtype=np.int16)
pal = np.zeros(n, dtype=np.uint8)


def setst(mask, s, only_unset=True):
    m = mask & (style < 0) if only_unset else mask
    style[m] = ST[s]
    return int(m.sum())


# explicit OSM tags first
setst(np.isin(mmade, ["storage_tank", "gasometer", "silo", "cooling_tower", "chimney", "water_tower"]), "tank")
setst(np.isin(b, ["roof", "carport", "greenhouse", "canopy"]) | (fused["leisure"].fillna("") == "bandstand").values, "canopy")
setst(np.isin(b, ["construction"]), "construction")
trad_tag = np.isin(b, ["temple", "pavilion", "pagoda", "shrine", "monastery", "gate", "gatehouse_traditional", "palace", "tower_traditional"]) | \
    ((amen == "place_of_worship") & np.isin(relig, ["buddhist", "taoist", "confucian", "chinese_folk", ""]) & (area < 3000)) | np.isin(hist, ["city_gate", "temple", "palace", "pagoda"])
her = her_style >= 0
# inside heritage zones: only traditional-looking footprints become palace/temple halls (big modern blocks inside parks stay generic)
trad_shape = (area < 5200) & (h_trust < 40) | ~np.isfinite(h_trust) & (area < 5200)
m = her & trad_shape & (style < 0)
style[m] = her_style[m]; pal[m] = her_pal[m]
m = trad_tag & (style < 0)
style[m] = ST["temple"]; pal[m] = PAL["grey"]
log("imperial", int((style == ST["imperial"]).sum()), "temple", int((style == ST["temple"]).sum()))

setst(np.isin(b, ["train_station", "transportation", "stadium", "grandstand", "hangar", "sports_hall", "sports_centre"]) | (rail == "station") | np.isin(leis, ["stadium", "sports_centre", "sports_hall"]), "bigroof")
setst(np.isin(b, ["industrial", "warehouse", "manufacture", "factory", "storage", "depot"]), "industrial")
setst(np.isin(b, ["office", "commercial"]) | (office_t != ""), "office")
setst(np.isin(b, ["retail", "supermarket", "mall", "shop", "kiosk"]) | (shop_t != ""), "retail")
setst(np.isin(b, ["hotel"]) | (tour == "hotel"), "office")
setst(np.isin(b, ["school", "university", "college", "kindergarten", "hospital", "public", "civic", "government", "church", "mosque", "cathedral", "museum", "library", "theatre"]) |
      np.isin(amen, ["school", "university", "college", "hospital", "library", "theatre", "townhall", "courthouse", "police", "fire_station", "arts_centre", "community_centre"]) | (tour == "museum"), "public")
setst(np.isin(b, ["apartments", "residential", "dormitory", "terrace"]), "resi")
setst(np.isin(b, ["villa", "detached", "semidetached_house"]), "villa")

# final height (pre-style heuristics need it)
h_final = np.where(np.isfinite(h_trust), h_trust, h_model)

# courtyard houses: small low buildings inside the old city (2nd ring), plus bungalow/house tags there
small_low = (area < 260) & (h_final < 9.5)
old = ring_idx <= 2
setst(old & small_low & (np.isin(b, ["", "yes", "house", "bungalow", "residential", "hut", "shed"]) | pd.isna(fused["building"]).values), "courtyard")
# hutong-like fabric just outside the 2nd ring / old villages: dense clusters of small low buildings
dense_small = (feats_n["n1_cnt"] > 55) & (feats_n["n1_amean"] < 170)
setst(~old & small_low & dense_small & (ring_idx <= 3), "courtyard")
setst(~old & small_low & (area < 320) & (feats_n["n3_amean"] < 260) & (feats_n["n1_cnt"] > 18), "village")
setst(np.isin(b, ["house", "bungalow", "hut", "shed", "farm", "barn", "cabin", "garage", "garages"]), "village")

# land-use / campus context
lu_s = pd.Series(landuse).fillna("").values
setst((lu_s == "industrial") & (area > 500) & (h_final < 30), "industrial")
setst((lu_s == "industrial"), "generic")
setst(np.isin(lu_s, ["commercial", "retail"]) & (h_final >= 28), "office")
setst(np.isin(lu_s, ["commercial", "retail"]) & (area > 2500), "retail")
setst(np.isin(lu_s, ["commercial", "retail"]), "office")
setst(pd.Series(campus).notna().values, "public")
setst((lu_s == "railway") & (area > 3000), "bigroof")

# morphology heuristics for the rest
big_low = (area > 3500) & (h_final < 22)
setst(big_low & (ring_idx >= 5), "industrial")
setst(big_low & (pd.Series(cmab_fn).fillna("").values == "Industry"), "industrial")
setst(big_low, "retail")
cm_s = pd.Series(cmab_fn).fillna("").values
setst((cm_s == "Office") & (h_final >= 30) & (fill > 0.72) & (mshort > 22), "office")
setst((cm_s == "Business") & (area > 1200), "retail")
setst((cm_s == "Public service") & (area > 900) & (h_final < 40), "public")
slab = (mlong / np.maximum(mshort, 1) > 2.3) & (mshort > 8) & (mshort < 22)
setst(slab & (h_final >= 9), "resi")
tower = (h_final >= 34) & (area > 250) & (area < 1600)
setst(tower & (lu_s != "commercial"), "resi")
setst((h_final >= 45) & (area >= 1600), "office")
setst((area < 300) & (h_final < 10), "village")
setst((lu_s == "residential"), "resi")
setst((h_final >= 12), "resi")
setst(np.ones(n, bool), "generic")
log("styles:", {k: int((style == v).sum()) for k, v in ST.items()})

# style-specific height sanity
cy_ = style == ST["courtyard"]
h_final[cy_] = np.clip(np.where(np.isfinite(h_trust[cy_]), h_trust[cy_], 2.9 + 0.045 * np.sqrt(area[cy_]) * 2.2), 2.8, 6.2)
vil = style == ST["village"]
h_final[vil & ~np.isfinite(h_trust)] = np.clip(h_final[vil & ~np.isfinite(h_trust)], 3.0, 9.0)
can = style == ST["canopy"]
h_final[can & ~np.isfinite(h_trust)] = 5.5
tk = style == ST["tank"]
h_final[tk & ~np.isfinite(h_trust)] = np.where(mmade[tk & ~np.isfinite(h_trust)] == "chimney", 90, np.where(mmade[tk & ~np.isfinite(h_trust)] == "cooling_tower", 75, 14))
# halls: store the *body* (eave) height; the roof is generated on top of it in the client
hall = np.isin(style, [ST["imperial"], ST["temple"]])
body = np.clip(0.30 * mshort + 1.6, 3.0, 12.5)
h_final[hall] = body[hall]
ind = style == ST["industrial"]
h_final[ind & ~np.isfinite(h_trust)] = np.clip(h_final[ind & ~np.isfinite(h_trust)], 5.0, 26.0)
# old-city height control: untagged buildings inside the 2nd ring rarely exceed ~45 m
cap = old & ~np.isfinite(h_trust)
h_final[cap] = np.minimum(h_final[cap], 46.0)
h_final = np.clip(h_final, 2.6, 700)

base = np.nan_to_num(fused.minh_tag.values.astype(float), nan=0.0)
base = np.where(base >= h_final - 0.5, 0.0, base)

out = fused[["geometry", "osm_id", "name", "name:en", "src", "is_part", "outline_id", "building", "man_made", "roof:shape", "roof:colour", "building:colour", "cx", "cy", "area", "mlong", "mshort", "fill", "orient", "ring"]].copy()
out["height"] = h_final.astype(np.float32)
out["base"] = base.astype(np.float32)
out["h_src"] = np.where(h_ok, "tag", np.where(lv_ok | lv1_ok, "levels", "model"))
out["style"] = style.astype(np.uint8)
out["pal"] = pal
out["landuse"] = landuse
out["nv"] = nv
out.to_parquet(os.path.join(WORK, "buildings.parquet"))
log("saved buildings.parquet")
inner = ring_idx <= 5
for nm, m in (("inside 5th ring", inner), ("outside", ~inner)):
    hh = h_final[m]; aa = area[m]
    log(f"{nm}: n={m.sum()} footprint={aa.sum() / 1e6:.1f}km2 height pct5/25/50/75/95/99/max={np.percentile(hh, [5, 25, 50, 75, 95, 99, 100]).round(1)} area-weighted mean={np.average(hh, weights=aa):.1f}m  >=100m: {(hh >= 100).sum()}  >=60m: {(hh >= 60).sum()}")
