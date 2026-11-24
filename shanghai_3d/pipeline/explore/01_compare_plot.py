"""Debug plot: OSM buildings vs GBA buildings (by source) for a window of the model.
usage: 01_compare_plot.py <cx> <cy> <half_size_m> <out.png> [px]
"""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import numpy as np, pandas as pd, geopandas as gpd, shapely, cv2
from common import *

cx, cy, half = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
out = sys.argv[4]; PX = int(sys.argv[5]) if len(sys.argv) > 5 else 2400
W = "data/work"
box = shapely.box(cx - half, cy - half, cx + half, cy + half)
lon0, lat0 = to_lonlat(cx - half, cy - half); lon1, lat1 = to_lonlat(cx + half, cy + half)
img = np.full((PX, PX, 3), 255, np.uint8)
s = PX / (2 * half)

def draw(geoms, color, fill=True, thick=1):
    for g in geoms:
        if g is None or g.is_empty: continue
        for p in (g.geoms if hasattr(g, "geoms") else [g]):
            if p.geom_type == "Polygon":
                c = np.asarray(p.exterior.coords)
                pts = np.column_stack([(c[:, 0] - (cx - half)) * s, PX - (c[:, 1] - (cy - half)) * s]).astype(np.int32)
                if fill: cv2.fillPoly(img, [pts], color, lineType=cv2.LINE_AA)
                else: cv2.polylines(img, [pts], True, color, thick, lineType=cv2.LINE_AA)
            elif p.geom_type == "LineString":
                c = np.asarray(p.coords)
                pts = np.column_stack([(c[:, 0] - (cx - half)) * s, PX - (c[:, 1] - (cy - half)) * s]).astype(np.int32)
                cv2.polylines(img, [pts], False, color, thick, lineType=cv2.LINE_AA)

def rd(name):
    g = gpd.read_parquet(f"{W}/{name}.parquet")
    return g[g.intersects(shapely.box(lon0, lat0, lon1, lat1))]
wat = rd("osm_water")
draw(project_geoms(wat.geometry.values), (240, 210, 170))
roads = rd("osm_roads")
draw(project_geoms(roads.geometry.values), (170, 170, 170), thick=1)
gba = pd.read_parquet("data/raw/gba/gba_shanghai.parquet")
m = (gba.xmax >= lon0) & (gba.xmin <= lon1) & (gba.ymax >= lat0) & (gba.ymin <= lat1)
gba = gba[m]
gg = project_geoms(shapely.from_wkb(gba.wkb.values))
col = {"3dglobfp": (60, 60, 230), "ours2": (40, 160, 240), "osm": (60, 180, 60)}
for src in ("3dglobfp", "ours2", "osm"):
    draw(gg[gba.source.values == src], col[src])
ob = rd("osm_buildings")
draw(project_geoms(ob.geometry.values), (120, 40, 20), fill=False, thick=1)
cv2.imwrite(out, img)
print("gba in window", len(gba), dict(gba.source.value_counts()), "osm buildings", len(ob))
