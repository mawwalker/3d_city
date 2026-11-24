"""Real lines of the model for the film's camera to follow: streets by name, the deck of an elevated road with its heights.
Writes tools/film/paths.json: { name: [[x, y (up), z], ...] } in the web app's frame (x east, z south), a point every 5 m.
usage (from the project root): .venv/bin/python -I tools/film/paths.py
"""
import sys, json, pickle, numpy as np, geopandas as gpd, shapely
from scipy.spatial import cKDTree
sys.path.insert(0, "pipeline")
from common import *

r = gpd.read_parquet("data/work/osm_roads.parquet")
R = project_geoms(r.geometry.values)
rt = [json.loads(t) for t in r.tags.values]
names = np.array([t.get("name") or "" for t in rt], dtype=object)
hw = r.highway.values
bridge = np.array([t.get("bridge") not in (None, "no") for t in rt])
decks = {}
for p in pickle.load(open("data/work/decks.pkl", "rb")):
    decks.setdefault(p["i"], []).append(p["xyz"].astype(float))


def merged(name, only_bridge=None, classes=None):
    m = names == name
    if only_bridge is not None:
        m &= bridge == only_bridge
    if classes:
        m &= np.isin(hw, classes)
    idx = np.flatnonzero(m)
    g = shapely.line_merge(shapely.MultiLineString(list(R[idx])))
    lines = list(g.geoms) if hasattr(g, "geoms") else [g]
    return sorted(lines, key=lambda l: -l.length), idx


def sample(line, step=5.0, height=None):
    s = np.arange(0, line.length, step)
    pts = np.array([[p.x, p.y] for p in (line.interpolate(v) for v in s)])
    h = np.zeros(len(pts)) if height is None else height(pts)
    return [[round(float(x), 2), round(float(hh), 2), round(float(-y), 2)] for (x, y), hh in zip(pts, h)]


out = {}
info = []
for key, name, kw in [("nanjing_e", "南京东路", dict(classes=["pedestrian"])), ("hengshan", "衡山路", {}), ("wukang", "武康路", {}), ("sinan", "思南路", {}),
                      ("huaihai", "淮海中路", {}), ("bund", "中山东一路", {}), ("nanjing_w", "南京西路", {}), ("fuxing_w", "复兴西路", {}), ("shaanxi_s", "陕西南路", {})]:
    lines, idx = merged(name, **kw)
    for k, l in enumerate(lines[:2]):
        c = np.asarray(l.coords)
        out[f"{key}{k}"] = sample(l)
        info.append(f"{key}{k}: {l.length:.0f} m from ({c[0][0]:.0f}, {-c[0][1]:.0f}) to ({c[-1][0]:.0f}, {-c[-1][1]:.0f})")
# the elevated roads: 2D line of the bridge ways, heights from the deck solver's stations
for key, name in [("yanan", "延安高架路"), ("nanbei", "南北高架路")]:
    lines, idx = merged(name, only_bridge=True)
    P = np.vstack([np.vstack(decks[i]) for i in idx if i in decks])
    tree = cKDTree(P[:, :2])
    hfun = lambda pts: P[tree.query(pts)[1], 2]
    for k, l in enumerate(lines[:2]):
        c = np.asarray(l.coords)
        out[f"{key}{k}"] = sample(l, height=hfun)
        hs = [p[1] for p in out[f"{key}{k}"]]
        info.append(f"{key}{k}: {l.length:.0f} m from ({c[0][0]:.0f}, {-c[0][1]:.0f}) to ({c[-1][0]:.0f}, {-c[-1][1]:.0f}), deck height {min(hs):.1f}..{max(hs):.1f}")
# where the two elevated roads cross
a, _ = merged("延安高架路", only_bridge=True); b, _ = merged("南北高架路", only_bridge=True)
x = shapely.intersection(shapely.MultiLineString(a[:4]), shapely.MultiLineString(b[:4]))
pts = [g for g in getattr(x, "geoms", [x]) if g.geom_type == "Point"]
if pts:
    cx, cy = np.mean([[p.x, p.y] for p in pts], axis=0)
    out["interchange"] = [[round(float(cx), 1), 0, round(float(-cy), 1)]]
    info.append(f"interchange of the two elevated roads at ({cx:.0f}, {-cy:.0f}) ({len(pts)} crossings)")
json.dump(out, open("tools/film/paths.json", "w"))
print("\n".join(info))
