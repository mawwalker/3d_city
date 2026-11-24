import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *

work, gba_pq = sys.argv[1:3]
osm = gpd.read_parquet(os.path.join(work, "osm_buildings.parquet"))
print("osm cols", [c for c in osm.columns])
print("man_made", osm["man_made"].value_counts().to_dict())
print("building top", osm["building"].value_counts().head(40).to_dict())
print("parts", osm["building:part"].notna().sum(), "min_height", osm["min_height"].notna().sum(), "roof:shape", osm["roof:shape"].value_counts().head(12).to_dict())
print("location", osm["location"].value_counts().to_dict(), "layer", osm["layer"].value_counts().head(8).to_dict())
def num(s):
    if not isinstance(s, str): return np.nan
    m = re.match(r"\s*([0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan
osm["h"] = osm["height"].map(num); osm["lv"] = osm["building:levels"].map(num)
osm["hh"] = osm.h.fillna(osm.lv * 3.4)
rp = osm.geometry.representative_point()
osm["lon"] = rp.x; osm["lat"] = rp.y
pd.set_option("display.width", 250); pd.set_option("display.max_rows", 200); pd.set_option("display.max_colwidth", 40)
tall = osm[osm.hh >= 140].sort_values("hh", ascending=False)
print("tall tagged (>=140m):", len(tall))
print(tall[["osm_id", "name", "h", "lv", "building", "building:part", "min_height", "lon", "lat"]].head(90).to_string())

gba = pd.read_parquet(gba_pq)
gg = shapely.from_wkb(gba.wkb.values)
gf = gpd.read_parquet(os.path.join(work, "globfp_bbox.parquet"))
c = gf.geometry.representative_point()
inner = (c.x > 116.19) & (c.x < 116.56) & (c.y > 39.74) & (c.y < 40.04)
gfi = gf[inner.values]
tree = shapely.STRtree(gg)
pts = shapely.points(c.x.values[inner.values], c.y.values[inner.values])
qi, gi = tree.query(pts, predicate="within")
cov = np.zeros(len(gfi), bool); cov[qi] = True
k = np.cos(np.radians(39.9)) * 111320 * 110540
a = shapely.area(gfi.geometry.values) * k
print("globfp inner:", len(gfi), "covered by GBA:", cov.sum(), " uncovered:", (~cov).sum(), " uncovered area km2:", a[~cov].sum() / 1e6, " total km2", a.sum() / 1e6)
print("uncovered area pct:", np.percentile(a[~cov], [5, 25, 50, 75, 95]).round(0))
