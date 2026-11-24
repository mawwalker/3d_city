"""Fuse OSM + GlobalBuildingAtlas + Overture (Shi et al.) footprints into one de-duplicated building set.

Priority: current OSM (best geometry + tags) > GBA (carries a height for every polygon) > Overture ML (gap filler).
The ML footprints trace roofs in off-nadir imagery, so tall buildings are displaced; the shift per metre of height is
estimated from pairs that exist in both OSM and ML and removed from the ML-only buildings.
Output: work/fused.parquet in local metres with raw height signals attached.

usage: 20_fuse_buildings.py <work_dir> <gba.parquet> <overture_buildings.parquet>
"""
import sys, os, re, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely, shapely.affinity
from common import *

WORK, GBA_PQ, OV_PQ = sys.argv[1:4]
T0 = time.time()
XMIN, YMIN, XMAX, YMAX = X_MIN, Y_MIN, X_MAX, Y_MAX


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def num(s):
    if not isinstance(s, str):
        return np.nan
    m = re.match(r"\s*([0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan


def overlap_frac(a, tree_geoms, tree):
    """Fraction of each geometry in `a` covered by geometries in the tree (sum of pairwise intersections, capped at 1)."""
    qi, ti = tree.query(a, predicate="intersects")
    inter = shapely.area(shapely.intersection(a[qi], tree_geoms[ti]))
    s = np.zeros(len(a))
    np.add.at(s, qi, inter)
    ar = shapely.area(a)
    return np.minimum(1.0, s / np.maximum(ar, 1e-9)), qi, ti, inter


KEEP = ["building", "building:part", "height", "building:height", "min_height", "building:levels", "building:min_level", "roof:shape", "roof:height", "roof:levels",
        "roof:colour", "roof:material", "building:colour", "building:material", "name", "name:zh", "name:en", "amenity", "tourism", "historic", "shop", "office", "leisure", "layer",
        "location", "man_made", "railway", "public_transport", "religion", "tower:type", "start_date", "architect", "wikidata", "tunnel", "building:architecture", "heritage",
        "roof:orientation", "roof:direction", "building:use", "bridge:structure", "aeroway", "military", "power"]

# ---------------------------------------------------------------- OSM
osm = gpd.read_parquet(os.path.join(WORK, "osm_buildings.parquet"))
tags = [json.loads(t) for t in osm["tags"].values]
for k in KEEP:
    osm[k] = [t.get(k) for t in tags]
osm = osm.drop(columns=["tags"])
log("osm raw", len(osm))
b = osm["building"].fillna("")
part = osm["building:part"].fillna("")
mm = osm["man_made"].fillna("")
layer = osm["layer"].map(num).fillna(0)
drop = (
    mm.isin(["bridge", "pier", "tunnel", "works", "wastewater_plant", "water_well", "street_cabinet", "pumping_station", "telescope", "observatory"]) & (b == "") & (part == "")
) | (osm["location"].fillna("") == "underground") | (layer < 0) | b.isin(["wall", "no", "bridge", "fence"]) | osm["tunnel"].notna()
osm = osm[~drop].copy()
osm["geometry"] = shapely.make_valid(project_geoms(osm.geometry.values))
osm = osm.set_crs(PROJ_LOCAL, allow_override=True)
osm = osm.explode(index_parts=False)
osm = osm[osm.geom_type == "Polygon"].copy()
osm["area"] = osm.geometry.area
osm = osm[osm.area >= 6].reset_index(drop=True)
osm["is_part"] = (osm["building:part"].fillna("no") != "no") & (osm["building"].isna())
osm["h_tag"] = osm["height"].map(num)
osm["h_tag"] = osm["h_tag"].fillna(osm["building:height"].map(num))
osm["lv_tag"] = osm["building:levels"].map(num)
osm["minh_tag"] = osm["min_height"].map(num)
osm["minh_tag"] = osm["minh_tag"].fillna(osm["building:min_level"].map(num) * 3.5)
log("osm kept polygons", len(osm), "parts", int(osm.is_part.sum()))

# Simple-3D-buildings rule: an outline whose area is mostly covered by parts is replaced by its parts.
parts = osm[osm.is_part]
outl = osm[~osm.is_part]
osm["outline_id"] = None
if len(parts):
    pg = parts.geometry.values
    ptree = shapely.STRtree(pg)
    frac, _, _, _ = overlap_frac(outl.geometry.values, pg, ptree)
    replaced = frac > 0.6
    log("outlines replaced by parts:", int(replaced.sum()))
    og = outl.geometry.values
    otree = shapely.STRtree(og)
    qi, ti = otree.query(shapely.point_on_surface(pg), predicate="within")
    inherit = pd.DataFrame({"pi": parts.index.values[qi], "oi": outl.index.values[ti]}).drop_duplicates("pi").set_index("pi")
    for col in ("name", "building", "amenity", "tourism", "historic", "office", "h_tag", "lv_tag", "wikidata", "building:material", "building:colour"):
        src = osm.loc[inherit.oi.values, col].values
        cur = osm.loc[inherit.index, col]
        osm.loc[inherit.index, col] = cur.where(cur.notna(), pd.Series(src, index=inherit.index))
    osm.loc[inherit.index, "outline_id"] = osm.loc[inherit.oi.values, "osm_id"].values
    osm = osm.drop(index=outl.index[replaced]).reset_index(drop=True)
log("osm after parts logic", len(osm))

# ---------------------------------------------------------------- GBA (heights for everything, ML footprints)
gba = pd.read_parquet(GBA_PQ)
gg = shapely.make_valid(project_geoms(shapely.from_wkb(gba.wkb.values)))
gdf = gpd.GeoDataFrame({"src": gba.source.values, "gba_h": gba.height.values.astype(float)}, geometry=gg, crs=PROJ_LOCAL).explode(index_parts=False)
gdf = gdf[gdf.geom_type == "Polygon"]
gdf["area"] = gdf.geometry.area
gdf = gdf[gdf.area >= 12].reset_index(drop=True)
gdf.loc[gdf.gba_h <= 0, "gba_h"] = np.nan
log("gba polygons", len(gdf), gdf.src.value_counts().to_dict())

og = osm.geometry.values
otree = shapely.STRtree(og)

# ---- parallax: ML roof outlines vs OSM footprints of the same building --------------------------------------------
ml = gdf[gdf.src != "osm"]
mg = ml.geometry.values
mc = shapely.centroid(mg)
qi, ti = otree.query(mc, predicate="within")
pair = pd.DataFrame({"m": qi, "o": ti})
pair["ma"] = shapely.area(mg[pair.m.values]); pair["oa"] = shapely.area(og[pair.o.values])
pair = pair[(pair.ma / pair.oa).between(0.6, 1.6)]
oc = shapely.centroid(og[pair.o.values])
dx = shapely.get_x(mc[pair.m.values]) - shapely.get_x(oc); dy = shapely.get_y(mc[pair.m.values]) - shapely.get_y(oc)
# true height of the OSM building where tagged, else the GBA value of the ML polygon
ht = osm.h_tag.values[pair.o.values]
ht = np.where(np.isfinite(ht), ht, osm.lv_tag.values[pair.o.values] * 3.2)
ok = np.isfinite(ht) & (ht > 20) & (np.hypot(dx, dy) < 60)
PX = PY = 0.0
if ok.sum() > 200:
    # least squares through the origin: shift = k * height
    PX = float((dx[ok] * ht[ok]).sum() / (ht[ok] ** 2).sum()); PY = float((dy[ok] * ht[ok]).sum() / (ht[ok] ** 2).sum())
    res = np.hypot(dx[ok] - PX * ht[ok], dy[ok] - PY * ht[ok])
    log(f"parallax from {int(ok.sum())} tall pairs: shift per metre of height = ({PX:.3f}, {PY:.3f}); residual median {np.median(res):.1f} m (raw offset median {np.median(np.hypot(dx[ok], dy[ok])):.1f} m)")
else:
    log("parallax: not enough pairs", int(ok.sum()))

frac, qi, ti, inter = overlap_frac(gdf.geometry.values, og, otree)
keep_gba = frac < 0.30
log("gba dropped (covered by current OSM):", int((~keep_gba).sum()), " kept:", int(keep_gba.sum()))
# transfer GBA height to OSM buildings: area-weighted mean of overlapping GBA polygons
gh = gdf.gba_h.values
w = inter * np.isfinite(gh[qi])
hw = np.zeros(len(osm)); ww = np.zeros(len(osm))
np.add.at(hw, ti, np.nan_to_num(gh[qi]) * w)
np.add.at(ww, ti, w)
osm["gba_h"] = np.where(ww > 0, hw / np.maximum(ww, 1e-9), np.nan)
log("osm with gba height:", int(np.isfinite(osm.gba_h).sum()))


def trim_against(df, base_geoms, base_tree, frac_arr, min_area=12):
    """Cut away the parts of df polygons that overlap the base set, so nothing z-fights."""
    touch = np.where(frac_arr > 0.02)[0]
    if not len(touch):
        return df
    tg = df.geometry.values[touch]
    q2, t2 = base_tree.query(tg, predicate="intersects")
    cut = pd.Series(list(base_geoms[t2])).groupby(q2).apply(lambda s: shapely.union_all(np.array(list(s), dtype=object)))
    newg = shapely.difference(tg[cut.index.values], shapely.buffer(np.array(list(cut.values), dtype=object), 0.3))
    arr = df.geometry.values.copy()
    arr[touch[cut.index.values]] = newg
    df = df.copy()
    df["geometry"] = arr
    df = df.explode(index_parts=False)
    df = df[(df.geom_type == "Polygon")].copy()
    df["area"] = df.geometry.area
    return df[df.area >= min_area].reset_index(drop=True)


gkeep = gdf[keep_gba].reset_index(drop=True)
gkeep = trim_against(gkeep, og, otree, frac[keep_gba])
log("gba kept after trimming", len(gkeep))

# ---------------------------------------------------------------- Overture ML footprints as gap filler
ov = pd.read_parquet(OV_PQ)
ov = ov[ov.src != "OpenStreetMap"]
vg = shapely.make_valid(project_geoms(shapely.from_wkb(ov.wkb.values)))
vdf = gpd.GeoDataFrame({"gba_h": np.full(len(ov), np.nan)}, geometry=vg, crs=PROJ_LOCAL).explode(index_parts=False)
vdf = vdf[vdf.geom_type == "Polygon"]
vdf["area"] = vdf.geometry.area
vdf = vdf[vdf.area >= 25].reset_index(drop=True)
base_geoms = np.concatenate([osm.geometry.values, gkeep.geometry.values])
btree = shapely.STRtree(base_geoms)
vfrac, _, _, _ = overlap_frac(vdf.geometry.values, base_geoms, btree)
vadd = vdf[vfrac < 0.12].reset_index(drop=True)
log("overture ML gap fillers added:", len(vadd), f"of {len(vdf)}; area {vadd.area.sum() / 1e6:.1f} km2")

# ---------------------------------------------------------------- undo the parallax on ML-only footprints
if PX or PY:
    for df in (gkeep, vadd):
        h = np.nan_to_num(df.gba_h.values, nan=12.0)
        m = h > 15
        sx = -PX * h; sy = -PY * h
        g = df.geometry.values.copy()
        idx = np.where(m)[0]
        g[idx] = [shapely.affinity.translate(g[i], sx[i], sy[i]) for i in idx]
        df["geometry"] = g

# ---------------------------------------------------------------- concat
cols_osm = ["osm_id", "geometry", "area", "building", "building:part", "is_part", "outline_id", "name", "name:en", "amenity", "tourism", "historic", "office", "shop", "leisure",
            "man_made", "tower:type", "religion", "railway", "public_transport", "roof:shape", "roof:colour", "roof:height", "roof:material", "building:colour", "building:material",
            "h_tag", "lv_tag", "minh_tag", "gba_h", "start_date", "wikidata", "building:architecture", "heritage", "aeroway"]
A = osm[cols_osm].copy(); A["src"] = "osm"
B = gkeep[["geometry", "area", "gba_h", "src"]].copy(); B["src"] = "gba_" + B["src"].astype(str)
C = vadd[["geometry", "area", "gba_h"]].copy(); C["src"] = "ovml"
fused = pd.concat([A, B, C], ignore_index=True)
fused = gpd.GeoDataFrame(fused, geometry="geometry", crs=PROJ_LOCAL)
fused["is_part"] = fused["is_part"].fillna(False).astype(bool)
c = fused.geometry.centroid
inside = (c.x >= XMIN) & (c.x < XMAX) & (c.y >= YMIN) & (c.y < YMAX)
fused = fused[inside.values].reset_index(drop=True)
log("fused total", len(fused), fused.src.value_counts().to_dict(), f"footprint {fused.area.sum() / 1e6:.1f} km2")
fused.to_parquet(os.path.join(WORK, "fused.parquet"))
log("saved")
