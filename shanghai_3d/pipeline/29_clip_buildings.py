"""Buildings may not stand in the street.

Most footprints here are drawn from satellite images (GlobalBuildingAtlas, Overture): roofs shifted by parallax, and now
and then a footbridge, a viaduct or a row of lorries taken for a building. Left alone, traffic drives through them and
people walk through their corners. This step takes every footprint off

  * the carriageways of the roads that carry traffic and the strip of pavement beside them where people walk,
  * the pedestrian streets,
  * elevated decks that the building would stick through,

dropping a footprint altogether when most of it lies in the road (it was never a building), and cutting the others back.
Parts of buildings that start above the ground (bridging a street) are left alone.

Reads work/buildings.parquet (kept as work/buildings_full.parquet the first time), writes work/buildings.parquet with a
`clip` column (1 where a footprint was cut back).

usage: 29_clip_buildings.py <work_dir>        (after 31_build_ground.py: uses its road widths and deck heights)
"""
import sys, os, json, pickle, time, shutil
import numpy as np, pandas as pd, geopandas as gpd, shapely
from multiprocessing import get_context
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

WORK = sys.argv[1]
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


cur, full = os.path.join(WORK, "buildings.parquet"), os.path.join(WORK, "buildings_full.parquet")
b = gpd.read_parquet(cur)
if "clip" in b.columns:
    b = gpd.read_parquet(full)                 # already cut once: start again from the untouched table
else:
    shutil.copyfile(cur, full)
b = b.reset_index(drop=True)
G = b.geometry.values
log("buildings", len(b))

roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
A = pickle.load(open(os.path.join(WORK, "roads_attr.pkl"), "rb"))
cls, W, SW, bridge, tunnel, lowbr, area_ = (A[k] for k in ("cls", "W", "SW", "bridge", "tunnel", "lowbr", "area"))
R = project_geoms(roads.geometry.values)
rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring")
outer = rings.geometry[3].buffer(2500); shapely.prepare(outer)
sw = SW.astype(float).copy()
sw[(cls == 5) & ~shapely.intersects(outer, R)] = 0
ground = ~area_ & ~tunnel & (~bridge | lowbr)
traffic = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ground
ped = (cls == 8) & ground
half = np.where(traffic, W / 2 + 0.3 + np.minimum(sw, 2.7), np.where(ped, np.minimum(W / 2, 4.5), 0.0))
sel = np.flatnonzero(traffic | ped)
BANDS = list(shapely.buffer(R[sel], half[sel], quad_segs=2))
ZB = [np.inf] * len(BANDS)                      # a band at street level cuts everything
# elevated decks, piece by piece with their height
for p in pickle.load(open(os.path.join(WORK, "decks.pkl"), "rb")):
    c = p["xyz"].astype(float)
    for k in range(len(c) - 1):
        if np.hypot(*(c[k + 1, :2] - c[k, :2])) < 0.5:
            continue
        BANDS.append(shapely.buffer(shapely.LineString(c[k:k + 2, :2]), p["w"] / 2 + 0.6, quad_segs=2))
        ZB.append(float(min(c[k, 2], c[k + 1, 2])))
BANDS = np.array(BANDS, dtype=object); ZB = np.array(ZB)
tree = shapely.STRtree(BANDS)
log("road bands", len(sel), "deck pieces", len(BANDS) - len(sel))
bi, ri = tree.query(G, predicate="intersects")
top = (b["base"].values + b["height"].values).astype(float); base = b["base"].values.astype(float)
# a deck piece only matters to a building tall enough to reach it; a part that starts above the street bridges it
ok = (base[bi] < 4.2) & (np.isinf(ZB[ri]) | (top[bi] > ZB[ri] - 1.5))
bi, ri = bi[ok], ri[ok]
order = np.argsort(bi, kind="stable"); bi, ri = bi[order], ri[order]
starts = np.flatnonzero(np.diff(np.concatenate([[-1], bi])))
groups = [(int(bi[s]), ri[s:e]) for s, e in zip(starts, np.concatenate([starts[1:], [len(bi)]]))]
log("footprints touching a band:", len(groups))


def polys(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [q for q in getattr(g, "geoms", []) if q.geom_type == "Polygon"]


def cut(job):
    i, rr = job
    g = G[i]
    band = shapely.union_all(BANDS[rr])
    inter = shapely.intersection(g, band).area
    a0 = g.area
    if inter < 1.0:
        return i, None, 0
    if inter > 0.55 * a0:
        return i, [], 2                                    # mostly in the road: not a building
    rest = shapely.difference(g, shapely.buffer(band, 0.15, quad_segs=2))
    # shave off the slivers a cut leaves behind
    rest = shapely.buffer(shapely.buffer(rest, -0.7, join_style="mitre", mitre_limit=2.5), 0.7, join_style="mitre", mitre_limit=2.5)
    parts = [q for q in polys(rest) if q.area >= max(22.0, 0.12 * a0)]
    if not parts:
        return i, [], 2
    return i, [shapely.simplify(q, 0.05) for q in parts], 1


with get_context("fork").Pool(PROCS) as pool:
    res = pool.map(cut, groups, chunksize=512)
drop = np.zeros(len(b), bool); clip = np.zeros(len(b), np.int8)
extra = []
ncut = ndrop = 0
geom = G.copy()
for i, parts, what in res:
    if what == 2:
        drop[i] = True; ndrop += 1
    elif what == 1:
        geom[i] = parts[0]; clip[i] = 1; ncut += 1
        for q in parts[1:]:
            extra.append((i, q))
b["clip"] = clip
b = b.set_geometry(gpd.GeoSeries(geom, crs=b.crs))
if extra:
    add = b.iloc[[i for i, _ in extra]].copy()
    add = add.set_geometry(gpd.GeoSeries([q for _, q in extra], index=add.index, crs=b.crs))
    b = pd.concat([b[~drop], add], ignore_index=True)
else:
    b = b[~drop].reset_index(drop=True)
# the measures that depend on the outline
m = b["clip"].values == 1
g = b.geometry.values[m]
c = shapely.centroid(g)
b.loc[m, "cx"] = shapely.get_x(c); b.loc[m, "cy"] = shapely.get_y(c)
b.loc[m, "area"] = shapely.area(g)
mrr = shapely.minimum_rotated_rectangle(g)
sides = []
for q in mrr:
    cc = np.asarray(q.exterior.coords) if q.geom_type == "Polygon" else np.zeros((5, 2))
    l1, l2 = np.hypot(*(cc[1] - cc[0])), np.hypot(*(cc[2] - cc[1]))
    sides.append((max(l1, l2), min(l1, l2)))
sides = np.array(sides).reshape(-1, 2)
if "mlong" in b.columns:
    b.loc[m, "mlong"] = sides[:, 0]; b.loc[m, "mshort"] = sides[:, 1]
if "fill" in b.columns:
    b.loc[m, "fill"] = shapely.area(g) / np.maximum(sides[:, 0] * sides[:, 1], 1e-6)
if "nv" in b.columns:
    b.loc[m, "nv"] = shapely.get_num_coordinates(g) - 1
b.to_parquet(cur)
log(f"dropped {ndrop} footprints that lay in the road, cut back {ncut} (+{len(extra)} split-off parts); {len(b)} buildings left")
