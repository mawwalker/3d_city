"""Fuse OSM + GlobalBuildingAtlas + 3D-GloBFP footprints into one de-duplicated building set.

Priority: current OSM (best geometry + tags) > GBA > 3D-GloBFP v4 (gap filler).
Output: work/fused.parquet in local metres with raw height signals attached
(final heights and styles are assigned in the next stage).

usage: 20_fuse_buildings.py <work_dir> <gba.parquet>
"""
import sys, os, re, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *

WORK, GBA_PQ = sys.argv[1:3]
T0 = time.time()


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


# ---------------------------------------------------------------- OSM
osm = gpd.read_parquet(os.path.join(WORK, "osm_buildings.parquet"))
log("osm raw", len(osm))
b = osm["building"].fillna("")
part = osm["building:part"].fillna("")
mm = osm["man_made"].fillna("")
layer = osm["layer"].map(num).fillna(0)
drop = (
    mm.isin(["bridge", "pier", "tunnel", "works", "wastewater_plant", "water_well", "street_cabinet", "pumping_station", "telescope", "observatory"]) & (b == "") & (part == "")
) | (osm["location"].fillna("") == "underground") | (layer < 0) | b.isin(["wall", "no", "bridge", "fence"]) | (osm["tunnel"].notna() if "tunnel" in osm else False)
osm = osm[~drop].copy()
osm["geometry"] = shapely.make_valid(project_geoms(osm.geometry.values))
osm = osm.set_crs(PROJ_LOCAL, allow_override=True)
# explode multipolygons (keep tags), keep polygons only
osm = osm.explode(index_parts=False)
osm = osm[osm.geom_type == "Polygon"].copy()
osm["area"] = osm.geometry.area
osm = osm[osm.area >= 6].reset_index(drop=True)
osm["is_part"] = (osm["building:part"].fillna("no") != "no") & (osm["building"].isna())
osm["h_tag"] = osm["height"].map(num)
if "building:height" in osm:
    osm["h_tag"] = osm["h_tag"].fillna(osm["building:height"].map(num))
osm["lv_tag"] = osm["building:levels"].map(num)
osm["minh_tag"] = osm["min_height"].map(num)
if "building:min_level" in osm:
    osm["minh_tag"] = osm["minh_tag"].fillna(osm["building:min_level"].map(num) * 3.5)
log("osm kept polygons", len(osm), "parts", int(osm.is_part.sum()))

# Simple-3D-buildings rule: an outline whose area is mostly covered by parts is replaced by its parts.
parts = osm[osm.is_part]
outl = osm[~osm.is_part]
if len(parts):
    pg = parts.geometry.values
    ptree = shapely.STRtree(pg)
    frac, _, _, _ = overlap_frac(outl.geometry.values, pg, ptree)
    replaced = frac > 0.6
    log("outlines replaced by parts:", int(replaced.sum()))
    # parts inherit name / building tag from the outline that contains them
    og = outl.geometry.values
    otree = shapely.STRtree(og)
    qi, ti = otree.query(shapely.point_on_surface(pg), predicate="within")
    inherit = pd.DataFrame({"pi": parts.index.values[qi], "oi": outl.index.values[ti]}).drop_duplicates("pi").set_index("pi")
    for col in ("name", "building", "amenity", "tourism", "historic", "office", "h_tag", "lv_tag"):
        if col in osm:
            src = osm.loc[inherit.oi.values, col].values
            cur = osm.loc[inherit.index, col]
            osm.loc[inherit.index, col] = cur.where(cur.notna(), pd.Series(src, index=inherit.index))
    osm["outline_id"] = None
    osm.loc[inherit.index, "outline_id"] = osm.loc[inherit.oi.values, "osm_id"].values
    osm = osm.drop(index=outl.index[replaced]).reset_index(drop=True)
    # parts that do not belong to a kept/replaced outline but float alone are still fine to keep
log("osm after parts logic", len(osm))

# ---------------------------------------------------------------- GBA
gba = pd.read_parquet(GBA_PQ)
gg = shapely.make_valid(project_geoms(shapely.from_wkb(gba.wkb.values)))
gdf = gpd.GeoDataFrame({"src": gba.source.values, "gba_h": gba.height.values}, geometry=gg, crs=PROJ_LOCAL).explode(index_parts=False)
gdf = gdf[gdf.geom_type == "Polygon"]
gdf["area"] = gdf.geometry.area
gdf = gdf[gdf.area >= 12].reset_index(drop=True)
gdf.loc[gdf.gba_h < 0, "gba_h"] = np.nan
log("gba polygons", len(gdf))

og = osm.geometry.values
otree = shapely.STRtree(og)
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

gkeep = gdf[keep_gba].reset_index(drop=True)
# GBA polygons that partially overlap OSM buildings: cut the overlap away so nothing z-fights
pf = frac[keep_gba]
touch = np.where(pf > 0.02)[0]
if len(touch):
    tg = gkeep.geometry.values[touch]
    q2, t2 = otree.query(tg, predicate="intersects")
    cut = pd.Series(list(og[t2])).groupby(q2).apply(lambda s: shapely.union_all(np.array(list(s), dtype=object)))
    newg = shapely.difference(tg[cut.index.values], shapely.buffer(np.array(list(cut.values), dtype=object), 0.3))
    arr = gkeep.geometry.values.copy()
    arr[touch[cut.index.values]] = newg
    gkeep["geometry"] = arr
    gkeep = gkeep.explode(index_parts=False)
    gkeep = gkeep[(gkeep.geom_type == "Polygon")]
    gkeep["area"] = gkeep.geometry.area
    gkeep = gkeep[gkeep.area >= 12].reset_index(drop=True)
log("gba kept after trimming", len(gkeep))

# ---------------------------------------------------------------- 3D-GloBFP v4 as gap filler + height signal
gf = gpd.read_parquet(os.path.join(WORK, "globfp_bbox.parquet"))
fg = shapely.make_valid(project_geoms(gf.geometry.values))
fdf = gpd.GeoDataFrame({"globfp_h": gf["Height"].values.astype(float)}, geometry=fg, crs=PROJ_LOCAL).explode(index_parts=False)
fdf = fdf[fdf.geom_type == "Polygon"]
fdf["area"] = fdf.geometry.area
fdf = fdf[fdf.area >= 12].reset_index(drop=True)
log("globfp polygons", len(fdf))
ftree = shapely.STRtree(fdf.geometry.values)


def attach_globfp(df):
    g = df.geometry.values
    qi, ti = ftree.query(g, predicate="intersects")
    inter = shapely.area(shapely.intersection(g[qi], fdf.geometry.values[ti]))
    hw = np.zeros(len(df)); ww = np.zeros(len(df))
    np.add.at(hw, qi, fdf.globfp_h.values[ti] * inter)
    np.add.at(ww, qi, inter)
    df["globfp_h"] = np.where(ww > 0, hw / np.maximum(ww, 1e-9), np.nan)


attach_globfp(osm)
attach_globfp(gkeep)

base_geoms = np.concatenate([osm.geometry.values, gkeep.geometry.values])
btree = shapely.STRtree(base_geoms)
ffrac, _, _, _ = overlap_frac(fdf.geometry.values, base_geoms, btree)
add = (ffrac < 0.12) & (fdf.area.values >= 25)
fadd = fdf[add].reset_index(drop=True)
log("globfp gap fillers added:", len(fadd), f"area {fadd.area.sum() / 1e6:.1f} km2")
# attach GBA height (if any GBA polygon overlapped it at all it would have been mostly dropped; so leave NaN)
fadd["gba_h"] = np.nan

# ---------------------------------------------------------------- concat
cols_osm = ["osm_id", "geometry", "area", "building", "building:part", "is_part", "outline_id", "name", "name:en", "amenity", "tourism", "historic", "office", "shop", "leisure",
            "man_made", "tower:type", "religion", "railway", "public_transport", "roof:shape", "roof:colour", "roof:height", "building:colour", "building:material",
            "h_tag", "lv_tag", "minh_tag", "gba_h", "globfp_h", "start_date", "wikidata"]
for c in cols_osm:
    if c not in osm:
        osm[c] = None
A = osm[cols_osm].copy(); A["src"] = "osm"
B = gkeep[["geometry", "area", "gba_h", "globfp_h", "src"]].copy(); B["src"] = "gba_" + B["src"].astype(str)
C = fadd[["geometry", "area", "gba_h", "globfp_h"]].copy(); C["src"] = "globfp"
fused = pd.concat([A, B, C], ignore_index=True)
fused = gpd.GeoDataFrame(fused, geometry="geometry", crs=PROJ_LOCAL)
fused["is_part"] = fused["is_part"].fillna(False).astype(bool)
# clip to processing extent (drop anything whose centroid is outside)
c = fused.geometry.centroid
xmin, ymin = GRID_X0, GRID_Y0
xmax, ymax = GRID_X0 + GRID_NX * TILE, GRID_Y0 + GRID_NY * TILE
inside = (c.x >= xmin) & (c.x < xmax) & (c.y >= ymin) & (c.y < ymax)
fused = fused[inside.values].reset_index(drop=True)
log("fused total", len(fused), fused.src.value_counts().to_dict(), f"footprint {fused.area.sum() / 1e6:.1f} km2")
fused.to_parquet(os.path.join(WORK, "fused.parquet"))
log("saved")
