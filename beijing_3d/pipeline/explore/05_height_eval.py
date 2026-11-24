"""Evaluate candidate height sources (GBA, 3D-GloBFP, CMAB) against OSM-tagged heights."""
import sys, os, re, glob
import numpy as np
import pandas as pd
import geopandas as gpd
import pyogrio
import shapely
from pyproj import Transformer

work, gba_pq, globfp_dir, cmab_shp = sys.argv[1:5]
W, S, E, N = 116.02, 39.60, 116.78, 40.22

# --- 3D-GloBFP
frames = []
for shp in sorted(glob.glob(os.path.join(globfp_dir, "t*", "*.shp"))):
    info = pyogrio.read_info(shp)
    print(os.path.basename(shp), info["features"], info["crs"], list(zip(info["fields"], info["dtypes"])))
    df = pyogrio.read_dataframe(shp, bbox=(W, S, E, N))
    frames.append(df)
    print("   in bbox", len(df))
gf = pd.concat(frames, ignore_index=True)
gf = gpd.GeoDataFrame(gf, geometry="geometry", crs=frames[0].crs)
print("3D-GloBFP in bbox:", len(gf), gf.columns.tolist())
hcol = [c for c in gf.columns if c.lower() in ("height", "h", "pred_h", "bh")]
print(gf.drop(columns="geometry").describe().T)
gf.to_parquet(os.path.join(work, "globfp_bbox.parquet"))

# --- reference: OSM tags
osm = gpd.read_parquet(os.path.join(work, "osm_buildings.parquet"))
def num(s):
    if not isinstance(s, str): return np.nan
    m = re.match(r"\s*([0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan
osm["h_tag"] = osm["height"].map(num)
osm["lv"] = osm["building:levels"].map(num)
ref = osm[(osm.h_tag > 0) | (osm.lv >= 2)].copy()
ref["ref"] = ref.h_tag.fillna(ref.lv * 3.2)
rp = ref.geometry.representative_point()
pts = shapely.points(rp.x.values, rp.y.values)
ref = ref.reset_index(drop=True)
print("reference buildings:", len(ref), " with explicit height:", (ref.h_tag > 0).sum())

def lookup(geoms, values, name):
    tree = shapely.STRtree(geoms)
    qi, gi = tree.query(pts, predicate="within")
    s = pd.Series(values[gi], index=qi).groupby(level=0).max()
    ref[name] = s
    print(name, "matched", s.notna().sum())

gba = pd.read_parquet(gba_pq)
lookup(shapely.from_wkb(gba.wkb.values), gba.height.values, "gba")
lookup(gf.geometry.values, gf[hcol[0]].values.astype(float), "globfp")
tr = Transformer.from_crs(4326, 3857, always_xy=True)
x0, y0 = tr.transform(W, S); x1, y1 = tr.transform(E, N)
cm = pyogrio.read_dataframe(cmab_shp, bbox=(x0, y0, x1, y1), columns=["Height", "Function"]).to_crs(4326)
cm.to_parquet(os.path.join(work, "cmab_bbox.parquet"))
lookup(cm.geometry.values, cm["Height"].values.astype(float), "cmab")

bins = [0, 8, 15, 25, 40, 60, 80, 120, 200, 1000]
ref["bin"] = pd.cut(ref.ref, bins)
agg = {"n": ("ref", "size"), "ref_med": ("ref", "median")}
for s in ("gba", "globfp", "cmab"):
    agg[s + "_n"] = (s, "count"); agg[s + "_med"] = (s, "median")
pd.set_option("display.width", 250)
print(ref.groupby("bin", observed=True).agg(**agg).round(1))
for s in ("gba", "globfp", "cmab"):
    m = ref[s].notna() & (ref[s] > 0)
    r = ref[m]
    print(s, "n", m.sum(), "pearson", round(np.corrcoef(r.ref, r[s])[0, 1], 3), "spearman", round(r[["ref", s]].corr(method="spearman").iloc[0, 1], 3),
          "MAE", round((r.ref - r[s]).abs().mean(), 1), "bias", round((r[s] - r.ref).mean(), 1))
ref.drop(columns="geometry").to_parquet(os.path.join(work, "height_ref.parquet"))
