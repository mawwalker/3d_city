"""Build ring-road polygons (2nd..6th) from OSM route relations / named ways.

usage: 11_rings.py <pbf> <work_dir>
Writes work/rings.parquet with one polygon per ring in local metres, plus ring centre-lines.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely, osmium
from shapely.ops import polygonize, unary_union, linemerge
from common import *

PBF, WORK = sys.argv[1:3]
REL = {295094: 2, 295097: 3, 18649348: 4, 295957: 5}


class R(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.members = {}
        self.named = []

    def relation(self, r):
        if r.id in REL:
            self.members[REL[r.id]] = [m.ref for m in r.members if m.type == "w"]
        t = r.tags
        if t.get("type") == "route" and t.get("route") == "road" and ("六环" in t.get("name", "") or t.get("ref") == "G4501"):
            self.named.append((r.id, t.get("name"), t.get("ref"), [m.ref for m in r.members if m.type == "w"]))


h = R()
h.apply_file(PBF)
print({k: len(v) for k, v in h.members.items()}, [(a, b, c, len(d)) for a, b, c, d in h.named])
if h.named:
    h.members[6] = max(h.named, key=lambda t: len(t[3]))[3]

roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
roads = roads.set_index("osm_id")
out = []
for ring, ids in sorted(h.members.items()):
    ids = [i for i in ids if i in roads.index]
    g = project_geoms(roads.loc[ids].geometry.values)
    u = unary_union(list(g))
    # the two carriageways bound a thin sliver; buffer->fill gives a robust enclosed polygon
    polys = list(polygonize(u))
    if not polys:
        print("ring", ring, "no polygon; trying buffered closure")
        b = u.buffer(60)
        polys = [shapely.Polygon(p.exterior) for p in (b.geoms if b.geom_type == "MultiPolygon" else [b])]
    big = max(polys, key=lambda p: p.area)
    hull = unary_union([p for p in polys]).buffer(30).buffer(-30)
    if hull.geom_type == "MultiPolygon":
        hull = max(hull.geoms, key=lambda p: p.area)
    poly = shapely.Polygon(hull.exterior)
    print(f"ring {ring}: ways {len(ids)}, area {poly.area / 1e6:.1f} km2, perimeter {poly.exterior.length / 1e3:.1f} km, bounds {[round(v / 1e3, 2) for v in poly.bounds]}")
    out.append({"ring": ring, "geometry": poly, "length_km": poly.exterior.length / 1e3})
gdf = gpd.GeoDataFrame(out, geometry="geometry", crs=PROJ_LOCAL)
gdf.to_parquet(os.path.join(WORK, "rings.parquet"))
