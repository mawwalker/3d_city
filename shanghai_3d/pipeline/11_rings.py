"""Ring-road polygons for Shanghai (inner / middle / outer / G1503) from named OSM ways.

A ring is the hole of the buffered union of its ways; river crossings carry other names (bridges, tunnels), so those
are added by name and the buffer is widened until the loop closes.

usage: 11_rings.py <work_dir>      -> work/rings.parquet   (ring: 1 inner, 2 middle, 3 outer, 4 G1503)
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *

WORK = sys.argv[1]
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
tags = [json.loads(t) for t in roads["tags"].values]
name = pd.Series([t.get("name", "") or "" for t in tags])
ref = pd.Series([t.get("ref", "") or "" for t in tags])
hw = roads.highway.values
big = np.isin(hw, ["motorway", "trunk", "primary", "motorway_link", "trunk_link"])
SPEC = {
    1: dict(pat=r"内环高架|内环路|^南浦大桥$|^杨浦大桥$|罗山路高架|龙阳路高架|^中山[东南西北]?[一二]?路$", ref=None),
    2: dict(pat=r"中环路|^中环$|军工路隧道|上中路隧道|翔殷路隧道|^华夏中路$|^申江路$|中环线", ref=None),
    3: dict(pat=r"外环高速|外环隧道|^外环路$|外环线|上海绕城高速.*S20", ref=r"(^|;)S20($|;)"),
    4: dict(pat=r"上海绕城高速|郊环", ref=r"(^|;)G1503($|;)"),
}
out = []
g_all = project_geoms(roads.geometry.values)
for ring, sp in SPEC.items():
    m = name.str.contains(sp["pat"], regex=True).values & big
    if sp["ref"]:
        m |= ref.str.contains(sp["ref"], regex=True).values
    geoms = g_all[m]
    poly = None
    for buf in (120, 250, 450, 800, 1400):
        u = shapely.union_all(shapely.buffer(geoms, buf))
        holes = []
        for p in (u.geoms if hasattr(u, "geoms") else [u]):
            holes += [shapely.Polygon(r) for r in p.interiors]
        holes = [h for h in holes if h.area > 4e7 and h.contains(shapely.Point(0, 0))]
        if holes:
            poly = max(holes, key=lambda h: h.area).buffer(buf)
            break
    if poly is None:
        print(f"ring {ring}: NOT CLOSED (ways {int(m.sum())})")
        continue
    print(f"ring {ring}: ways {int(m.sum())}, closed with buffer {buf} m, area {poly.area / 1e6:.0f} km2, bounds {[round(v / 1e3, 1) for v in poly.bounds]}")
    out.append({"ring": ring, "geometry": poly})
gpd.GeoDataFrame(out, geometry="geometry", crs=PROJ_LOCAL).to_parquet(os.path.join(WORK, "rings.parquet"))
