import sys, os
import geopandas as gpd, pandas as pd, shapely
work = sys.argv[1]; pats = sys.argv[2]
b = gpd.read_parquet(os.path.join(work, "osm_buildings.parquet"))
m = b["name"].fillna("").str.contains(pats)
s = b[m].copy()
c = s.geometry.representative_point()
s["lon"] = c.x.round(5); s["lat"] = c.y.round(5)
s["a"] = (s.geometry.area * 111320 * 110540 * 0.767).round(0)
pd.set_option("display.width", 250); pd.set_option("display.max_rows", 300); pd.set_option("display.max_colwidth", 30)
cols = [k for k in ["osm_id", "name", "building", "height", "building:levels", "roof:shape", "lon", "lat", "a"] if k in s]
print(s.sort_values("a", ascending=False)[cols].head(int(sys.argv[3]) if len(sys.argv) > 3 else 60).to_string())
