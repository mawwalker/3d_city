"""Debug plot: 3D-GloBFP (GBA, red fill) vs Shi et al. (Overture, blue outline) vs OSM (green fill).
usage: 02_compare_ml.py <cx> <cy> <half_size_m> <out.png> [px]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import numpy as np, pandas as pd, shapely, cv2
from common import *
cx, cy, half = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
out = sys.argv[4]; PX = int(sys.argv[5]) if len(sys.argv) > 5 else 2000
lon0, lat0 = to_lonlat(cx - half, cy - half); lon1, lat1 = to_lonlat(cx + half, cy + half)
img = np.full((PX, PX, 3), 255, np.uint8); s = PX / (2 * half)
def draw(geoms, color, fill=True, thick=1):
    for g in geoms:
        if g is None or g.is_empty: continue
        for p in (g.geoms if hasattr(g, "geoms") else [g]):
            if p.geom_type != "Polygon": continue
            c = np.asarray(p.exterior.coords)
            pts = np.column_stack([(c[:, 0] - (cx - half)) * s, PX - (c[:, 1] - (cy - half)) * s]).astype(np.int32)
            if fill: cv2.fillPoly(img, [pts], color, lineType=cv2.LINE_AA)
            else: cv2.polylines(img, [pts], True, color, thick, lineType=cv2.LINE_AA)
def win(df): return df[(df.xmax >= lon0) & (df.xmin <= lon1) & (df.ymax >= lat0) & (df.ymin <= lat1)]
gba = win(pd.read_parquet("data/raw/gba/gba_shanghai.parquet"))
gg = project_geoms(shapely.from_wkb(gba.wkb.values))
draw(gg[gba.source.values != "osm"], (150, 150, 240))
ov = win(pd.read_parquet("data/raw/overture/buildings.parquet"))
og = project_geoms(shapely.from_wkb(ov.wkb.values))
isosm = ov.src.values == "OpenStreetMap"
draw(og[isosm], (120, 200, 120))
draw(og[~isosm], (180, 60, 0), fill=False, thick=2)
cv2.imwrite(out, img)
print("gba ml", int((gba.source.values != "osm").sum()), "overture ml", int((~isosm).sum()), "osm", int(isosm.sum()))
