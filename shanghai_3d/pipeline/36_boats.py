"""Ships on the Huangpu. The satellite-derived building footprints include every vessel that lay in the river when the
image was taken: barges moored three abreast, coasters, ferries, pontoons. As buildings they are wrong (houses standing in
the water); as boats they are exactly what the river looks like. This takes them out of the buildings and writes them as boats.

  site/data/boats.json            [x, z, length, beam, heading, kind] * n  (site frame: x east, z south; heading: rotation about y, radians;
                                  kind 0 small craft, 1 barge, 2 ship, 3 pontoon)
  <work>/boat_buildings.npy       mask over buildings.parquet: rows 30_build_tiles.py leaves out

usage: 36_boats.py <work_dir> <site_data_dir>
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, geopandas as gpd, shapely
from common import *

WORK, OUT = sys.argv[1:3]
b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"))
hu = shapely.from_wkt(json.load(open(os.path.join(WORK, "huangpu.json"))))
shapely.prepare(hu)
g = b.geometry.values
cand = np.where(shapely.contains(hu, shapely.points(b["cx"].values, b["cy"].values)) & b["src"].astype(str).str.startswith("gba").values)[0]
frac = shapely.area(shapely.intersection(g[cand], hu)) / np.maximum(shapely.area(g[cand]), 1e-6)
cand = cand[frac > 0.85]
mask = np.zeros(len(b), bool)
mask[cand] = True
# the river's centre line, from the head of the tide to the mouth (north): vessels under way follow it
wl = gpd.read_parquet(os.path.join(WORK, "osm_waterlines.parquet"))
nm = np.array([json.loads(t).get("name") for t in wl["tags"].values], dtype=object)
cl = shapely.line_merge(shapely.union_all(project_geoms(wl.geometry.values[nm == "黄浦江"])))
if cl.geom_type != "LineString":
    cl = max(cl.geoms, key=lambda q: q.length)
cc = np.asarray(cl.coords)[:, :2]
if cc[0, 1] > cc[-1, 1]:
    cc = cc[::-1]
cl = shapely.LineString(cc).simplify(4.0)
cc = np.asarray(cl.coords)
bank = hu.boundary
boats = []          # x, z, length, beam, heading, kind (0 small craft, 1 barge, 2 ship, 3 pontoon), under way (0 / 1), distance along the river, offset to its left
rng = np.random.default_rng(7)
for i in cand:
    r = np.asarray(shapely.minimum_rotated_rectangle(g[i]).exterior.coords)[:4, :2]
    e1, e2 = r[1] - r[0], r[2] - r[1]
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    L, W, ax = (l1, l2, e1 / l1) if l1 >= l2 else (l2, l1, e2 / l2)
    if L < 9 or W < 3:
        continue                                    # specks: dropped as buildings, not worth a hull
    L = min(L, 190.0)
    c = r.mean(axis=0); nr = np.array([-ax[1], ax[0]])
    if rng.random() < 0.5:
        ax = -ax                                    # which end is the bow is anyone's guess
    # heading in the site frame (x east, z south): the rotation about y that takes local +x to the long axis
    head = float(np.arctan2(ax[1], ax[0]))
    if L < 22:
        # one small craft, or a pontoon when the blob is nearly square
        if L / W < 1.6 and L >= 14:
            n, beam, kind = 1, W, 3
        else:
            n, beam, kind = 1, min(W, L / 2.7), 0
    elif L < 60:
        # barges lie moored side by side: a wide blob is several of them
        n = max(1, int(round(W / max(5.5, L / 5.0)))); beam, kind = min(W / n - 0.5, L / 3.6), 1
    else:
        n = max(1, int(round(W / max(11.0, L / 6.0)))); beam, kind = min(W / n - 1.0, L / 5.5), 2
    for k in range(n):
        p = c + nr * (k - (n - 1) / 2) * (W / n)
        pt = shapely.Point(p)
        sd = cl.project(pt); q0 = cl.interpolate(sd); q1 = cl.interpolate(min(sd + 5, cl.length))
        tx, ty = q1.x - q0.x, q1.y - q0.y
        off = float(np.sign(tx * (p[1] - q0.y) - ty * (p[0] - q0.x)) * pt.distance(q0)) if tx or ty else 0.0
        # alone in the fairway, clear of the banks: most such vessels are under way
        way = int(n == 1 and kind != 3 and abs(off) < 135 and bank.distance(pt) > 55 and rng.random() < 0.8)
        boats += [round(float(p[0]), 1), round(float(-p[1]), 1), round(float(L * (1 if n == 1 else rng.uniform(0.88, 1.0))), 1), round(float(beam), 1), round(head, 3), kind, way, round(float(sd), 1), round(off, 1)]
np.save(os.path.join(WORK, "boat_buildings.npy"), mask)
# ferries: the crossings mapped in OSM, each as the straight run between its two landings
br = gpd.read_parquet(os.path.join(WORK, "osm_barriers.parquet"))
ferries = []
for gline in project_geoms(br.geometry.values[br.kind.values == "route=ferry"]):
    part = shapely.intersection(gline, hu)
    parts = [q for q in getattr(part, "geoms", [part]) if q.geom_type == "LineString" and q.length > 150]
    if not parts:
        continue
    q = max(parts, key=lambda t: t.length)
    c0, c1 = np.asarray(q.coords)[0], np.asarray(q.coords)[-1]
    d = (c1 - c0)[:2]; L_ = float(np.hypot(*d))
    if L_ > 1800:
        continue                                     # a river cruise, not a crossing
    u = d / L_
    a_, b_ = c0[:2] + u * 22, c1[:2] - u * 22        # stop short of the bank: the landing stage
    ferries.append([round(float(a_[0]), 1), round(float(-a_[1]), 1), round(float(b_[0]), 1), round(float(-b_[1]), 1)])
json.dump(dict(stride=9, boats=boats, river=[round(float(v), 1) for xy in cc for v in (xy[0], -xy[1])], ferries=ferries), open(os.path.join(OUT, "boats.json"), "w"), separators=(",", ":"))
print("river centre line", round(cl.length / 1e3, 1), "km; under way", int(sum(boats[6::9])), "; ferry crossings", len(ferries))
Ls = np.array(boats[2::9]); Ws = np.array(boats[3::9]); Ks = np.array(boats[5::9])
print(f"boats: {len(boats) // 9} from {len(cand)} footprints; small craft {int((Ks == 0).sum())}, barges {int((Ks == 1).sum())}, ships {int((Ks == 2).sum())}, pontoons {int((Ks == 3).sum())}; length median {np.median(Ls):.0f} m (max {Ls.max():.0f})")
