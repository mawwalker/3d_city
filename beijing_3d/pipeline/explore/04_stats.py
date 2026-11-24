"""Stats to size the tiling/LOD budgets and calibrate GBA heights against OSM tags."""
import sys, os, re
import numpy as np
import pandas as pd
import geopandas as gpd
import shapely

work, gba_pq = sys.argv[1:3]
gba = pd.read_parquet(gba_pq)
g = shapely.from_wkb(gba.wkb.values)
cx = (gba.xmin.values + gba.xmax.values) / 2
cy = (gba.ymin.values + gba.ymax.values) / 2
k = np.cos(np.radians(39.9))
area = shapely.area(g) * (111320 * k) * 110540
nv = shapely.get_num_coordinates(g)
h = gba.height.values
inner = (cx > 116.19) & (cx < 116.56) & (cy > 39.74) & (cy < 40.04)
print("GBA total", len(gba), "inner bbox", inner.sum())
for nm, m in (("inner", inner), ("outer", ~inner)):
    a = area[m]; hh = h[m]
    print(nm, "n", m.sum(), "verts", nv[m].sum(), "area km2", a.sum() / 1e6)
    print("   area pct 5/25/50/75/95/99:", np.percentile(a, [5, 25, 50, 75, 95, 99]).round(0))
    print("   height pct 5/25/50/75/95/99/99.9/max:", np.percentile(hh[hh > 0], [5, 25, 50, 75, 95, 99, 99.9, 100]).round(1), " nodata:", (hh < 0).sum())
    for thr in (60, 100, 150, 200, 300):
        print(f"   area>={thr}: {(a >= thr).sum()}", end=";")
    print()
    big = (a >= 200) | (hh >= 24)
    print("   base-layer candidates (>=200m2 or >=24m):", big.sum(), "verts", nv[m][big].sum(), " small:", (~big).sum(), "verts", nv[m][~big].sum())
print("by source verts/polygon:", pd.DataFrame({"s": gba.source.values, "nv": nv, "a": area}).groupby("s").agg(["mean", "median"]).round(1).to_dict())

# calibration vs OSM
osm = gpd.read_parquet(os.path.join(work, "osm_buildings.parquet"))
def num(s):
    if not isinstance(s, str): return np.nan
    m = re.match(r"\s*([0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan
oh = osm["height"].map(num) if "height" in osm else pd.Series(np.nan, index=osm.index)
ol = osm["building:levels"].map(num)
osm = osm.assign(h_tag=oh, lv=ol)
t = osm[(osm.h_tag.notna()) | (osm.lv.notna())].copy()
rp = t.geometry.representative_point(); px = rp.x.values; py = rp.y.values
tree = shapely.STRtree(g)
pts = shapely.points(px, py)
qi, gi = tree.query(pts, predicate="within")
dfm = pd.DataFrame({"qi": qi, "gh": h[gi], "ga": area[gi], "src": gba.source.values[gi]})
dfm = dfm.groupby("qi").first()
t = t.reset_index(drop=True).join(dfm, how="inner")
t["ref"] = t.h_tag.fillna(t.lv * 3.3)
t = t[(t.gh > 0) & (t.ref > 0)]
print("matched tagged OSM buildings:", len(t))
bins = [0, 8, 15, 25, 40, 60, 80, 120, 200, 1000]
t["bin"] = pd.cut(t.ref, bins)
print(t.groupby("bin", observed=True).agg(n=("ref", "size"), ref_med=("ref", "median"), gba_med=("gh", "median"), gba_p25=("gh", lambda x: x.quantile(.25)), gba_p75=("gh", lambda x: x.quantile(.75))).round(1))
t["gbin"] = pd.cut(t.gh, [0, 5, 10, 15, 20, 30, 40, 60, 80, 200])
print(t.groupby("gbin", observed=True).agg(n=("ref", "size"), gba_med=("gh", "median"), ref_med=("ref", "median"), ref_p25=("ref", lambda x: x.quantile(.25)), ref_p75=("ref", lambda x: x.quantile(.75))).round(1))
print("corr", np.corrcoef(t.ref, t.gh)[0, 1])
