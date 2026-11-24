"""Vessels & Two-Rivers Cruise Ships (两江游轮) on the Yangtze and Jialing Rivers.

Extracts moored/underway vessels from satellite footprints sitting on the two rivers,
plus synthesizes Chongqing's iconic illuminated Two-Rivers sightseeing cruise ships (kind=4)
cruising past Hongyadong, Chaotianmen/Raffles City, Grand Theatre, and Nanbin Rd, plus river ferries.

Outputs:
  site/data/boats.json          { stride: 9, boats: [...], river: [...], jialing: [...], ferries: [...] }
                                kind: 0 small craft, 1 barge, 2 cargo ship, 3 pontoon, 4 two-rivers cruise ship
  data/work/boat_buildings.npy  mask of water-sitting ML footprints to drop from buildings

usage: 36_boats.py <work_dir> <site_data_dir>
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, geopandas as gpd, shapely
from common import *

WORK, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"))
riv = shapely.from_wkt(json.load(open(os.path.join(WORK, "two_rivers.json"))))
shapely.prepare(riv)
g = b.geometry.values
cand = np.where(shapely.contains(riv, shapely.points(b["cx"].values, b["cy"].values)) & (b["src"].astype(str) != "osm").values)[0]
if len(cand):
    frac = shapely.area(shapely.intersection(g[cand], riv)) / np.maximum(shapely.area(g[cand]), 1e-6)
    cand = cand[frac > 0.80]
mask = np.zeros(len(b), bool)
mask[cand] = True
np.save(os.path.join(WORK, "boat_buildings.npy"), mask)

# Extract Yangtze (长江) and Jialing (嘉陵江) river centerlines from OSM waterlines
wl = gpd.read_parquet(os.path.join(WORK, "osm_waterlines.parquet"))
nm = np.array([json.loads(t).get("name") or "" for t in wl["tags"].values], dtype=object)


def river_centerline(pattern, fallback_pts):
    m = np.array([pattern in s for s in nm])
    if m.any():
        merged = shapely.line_merge(shapely.union_all(project_geoms(wl.geometry.values[m])))
        parts = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
        parts = [p for p in parts if p.geom_type == "LineString" and p.length > 500]
        if parts:
            cl = max(parts, key=lambda q: q.length).simplify(6.0)
            cc = np.asarray(cl.coords)[:, :2]
            if cc[0, 0] > cc[-1, 0]:
                cc = cc[::-1]
            return shapely.LineString(cc), cc
    cc = np.array(fallback_pts, float)
    return shapely.LineString(cc), cc


# Fallback approximate Yangtze & Jialing centerlines (only if OSM names split)
yz_cl, yz_cc = river_centerline("长江", [(-6000, -7000), (-3000, -2500), (-1500, -1000), (500, -500), (1450, 950), (1200, 2200), (350, 3100), (3500, 4800), (8000, 7500)])
jl_cl, jl_cc = river_centerline("嘉陵江", [(-12000, 3500), (-7500, 1200), (-3800, 20), (-1800, 900), (-600, 1050), (160, 980), (950, 1180), (1450, 950)])

bank = riv.boundary
boats = []
rng = np.random.default_rng(2026)

# Convert detected river vessels (barges/ships/pontoons)
for i in cand:
    r = np.asarray(shapely.minimum_rotated_rectangle(g[i]).exterior.coords)[:4, :2]
    e1, e2 = r[1] - r[0], r[2] - r[1]
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    L, W, ax = (l1, l2, e1 / l1) if l1 >= l2 else (l2, l1, e2 / l2)
    if L < 9 or W < 3:
        continue
    L = min(L, 140.0)
    c = r.mean(axis=0)
    if rng.random() < 0.5:
        ax = -ax
    head = float(np.arctan2(ax[1], ax[0]))
    if L < 22:
        beam, kind = (W, 3) if (L / W < 1.6 and L >= 14) else (min(W, L / 2.7), 0)
    elif L < 60:
        beam, kind = min(W, L / 3.6), 1
    else:
        beam, kind = min(W, L / 5.0), 2
    pt = shapely.Point(c)
    sd = yz_cl.project(pt)
    q0 = yz_cl.interpolate(sd)
    q1 = yz_cl.interpolate(min(sd + 5, yz_cl.length))
    tx, ty = q1.x - q0.x, q1.y - q0.y
    off = float(np.sign(tx * (c[1] - q0.y) - ty * (c[0] - q0.x)) * pt.distance(q0)) if (tx or ty) else 0.0
    way = int(kind != 3 and abs(off) < 160 and bank.distance(pt) > 45 and rng.random() < 0.75)
    boats += [round(float(c[0]), 1), round(float(-c[1]), 1), round(float(L), 1), round(float(beam), 1), round(head, 3), kind, way, round(float(sd), 1), round(off, 1)]

# Add iconic illuminated Chongqing Two-Rivers Cruise Ships (两江游轮, kind=4) along Yangtze & Jialing core!
# Place 8 golden multi-deck sightseeing cruise ships cruising visibly near Chaotianmen, Hongyadong, Dongshuimen, Nanbin Rd!
for cl_use, fracs, offs in (
    (yz_cl, [0.22, 0.34, 0.44, 0.52, 0.62, 0.72], [-40.0, 45.0, -30.0, 50.0, -45.0, 35.0]),
    (jl_cl, [0.76, 0.88], [-25.0, 28.0]),
):
    L_tot = cl_use.length
    for f_, off_ in zip(fracs, offs):
        sd = L_tot * f_
        q0 = cl_use.interpolate(sd)
        q1 = cl_use.interpolate(min(sd + 10.0, L_tot))
        tx, ty = q1.x - q0.x, q1.y - q0.y
        ln = max(np.hypot(tx, ty), 1e-6)
        ux, uy = tx / ln, ty / ln
        px = q0.x - uy * off_
        py = q0.y + ux * off_
        if not shapely.contains(riv, shapely.Point(px, py)):
            px, py, off_ = q0.x, q0.y, 0.0
        head = float(np.arctan2(uy, ux))
        # kind=4: illuminated golden multi-deck Two-Rivers sightseeing cruise ship (68-82m x 16-18m)
        boats += [round(float(px), 1), round(float(-py), 1), round(float(rng.uniform(64.0, 82.0)), 1), round(float(rng.uniform(15.0, 18.0)), 1),
                  round(head, 3), 4, 1, round(float(sd), 1), round(float(off_), 1)]

# Add a few authentic Yangtze cargo barges underway along the Yangtze fairway
for f_ in [0.16, 0.28, 0.39, 0.57, 0.67, 0.80]:
    sd = yz_cl.length * f_
    q0 = yz_cl.interpolate(sd)
    q1 = yz_cl.interpolate(min(sd + 10.0, yz_cl.length))
    tx, ty = q1.x - q0.x, q1.y - q0.y
    head = float(np.arctan2(ty, tx))
    boats += [round(float(q0.x), 1), round(float(-q0.y), 1), round(float(rng.uniform(55.0, 88.0)), 1), round(float(rng.uniform(11.0, 15.0)), 1),
              round(head, 3), 1, 1, round(float(sd), 1), round(float(rng.uniform(-55.0, 55.0)), 1)]

# Ferries from OSM + classic Chongqing cross-river ferry (Hongyadong <-> Danzishi / Jiangbeizui)
br = gpd.read_parquet(os.path.join(WORK, "osm_barriers.parquet"))
ferries = []
if len(br) and "kind" in br.columns:
    for gline in project_geoms(br.geometry.values[br.kind.values == "route=ferry"]):
        part = shapely.intersection(gline, riv)
        parts = [q for q in getattr(part, "geoms", [part]) if q.geom_type == "LineString" and q.length > 150]
        if not parts:
            continue
        q = max(parts, key=lambda t: t.length)
        c0, c1 = np.asarray(q.coords)[0], np.asarray(q.coords)[-1]
        d = (c1 - c0)[:2]
        L_ = float(np.hypot(*d))
        if L_ > 2200:
            continue
        u = d / L_
        a_, b_ = c0[:2] + u * 22, c1[:2] - u * 22
        ferries.append([round(float(a_[0]), 1), round(float(-a_[1]), 1), round(float(b_[0]), 1), round(float(-b_[1]), 1)])
if not ferries:
    # Classic Chaotianmen <-> Jiangbeizui / Danzishi ferry crossings
    ferries.append([1180.0, -760.0, 1780.0, -520.0])
    ferries.append([-20.0, -640.0, 200.0, -1240.0])

json.dump(dict(
    stride=9,
    waterY=0.0,
    boats=boats,
    river=[round(float(v), 1) for xy in yz_cc for v in (xy[0], -xy[1])],
    jialing=[round(float(v), 1) for xy in jl_cc for v in (xy[0], -xy[1])],
    ferries=ferries,
), open(os.path.join(OUT, "boats.json"), "w"), separators=(",", ":"))
print(f"boats.json: {len(boats) // 9} vessels (incl. 8 Two-Rivers cruise ships), Yangtze {yz_cl.length/1e3:.1f}km, Jialing {jl_cl.length/1e3:.1f}km, {len(ferries)} ferries")
