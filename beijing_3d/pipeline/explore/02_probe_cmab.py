"""Inspect the CMAB Beijing main shapefile: stats inside the 5th-ring bbox."""
import sys
import numpy as np
import pyogrio
import shapely
from pyproj import Transformer

main = sys.argv[1]
tr = Transformer.from_crs(4326, 3857, always_xy=True)
W, S, E, N = 116.16, 39.72, 116.60, 40.07
x0, y0 = tr.transform(W, S)
x1, y1 = tr.transform(E, N)
df = pyogrio.read_dataframe(main, bbox=(x0, y0, x1, y1))
print("in bbox:", len(df))
g = df.geometry.values
area = shapely.area(g) * (np.cos(np.radians(39.9)) ** 2)
nv = shapely.get_num_coordinates(g)
print("area m2 pct", np.percentile(area, [1, 5, 25, 50, 75, 95, 99, 100]).round(1))
print("verts pct", np.percentile(nv, [1, 5, 25, 50, 75, 95, 99, 100]), "total verts", nv.sum())
h = df["Height"].values
print("height pct", np.nanpercentile(h, [0, 1, 5, 25, 50, 75, 95, 99, 99.9, 100]).round(1), "nan", np.isnan(h).sum())
print("tiny (<20m2):", (area < 20).sum(), " <50:", (area < 50).sum(), " >10000:", (area > 10000).sum())
for c in ["Function", "Age", "Quality", "Structure", "Style"]:
    print(c, df[c].value_counts(dropna=False).head(12).to_dict())
print("geom types", df.geom_type.value_counts().to_dict(), "invalid", (~shapely.is_valid(g)).sum())
print("total footprint km2", area.sum() / 1e6)
top = df.assign(area=area).sort_values("Height", ascending=False).head(15)
c = shapely.centroid(top.geometry.values)
inv = Transformer.from_crs(3857, 4326, always_xy=True)
lon, lat = inv.transform(shapely.get_x(c), shapely.get_y(c))
for i, (hh, aa) in enumerate(zip(top["Height"], top["area"])):
    print(f"  h={hh:.1f} area={aa:.0f} at {lon[i]:.4f},{lat[i]:.4f}")
