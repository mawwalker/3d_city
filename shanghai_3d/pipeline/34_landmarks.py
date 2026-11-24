"""Placement data for the hand-modelled landmarks, taken from the OSM footprints (true positions), and the list of
footprints they replace.

  site/data/landmarks.json            { id: { x, z, angle (rad, long axis from east, ccw), w, d, h } }
  pipeline/landmark_exclusions.json   circles (local metres, y north) whose buildings are dropped from the tiles

usage: 34_landmarks.py <work_dir> <site_data_dir> <exclusions.json>
"""
import re, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *

WORK, OUT, EXCL = sys.argv[1:4]
b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"))
nm = b["name"].fillna("")
# id, regex, replace the footprint (radius, 0 = keep the building and only dress its roof)
WANT = [
    ("pearl", r"^东方明珠", 74),
    ("tower", r"^上海中心大厦$", 62),
    ("swfc", r"^上海环球金融中心$", 50),
    ("jinmao", r"^金茂大厦$", 44),
    ("customs", r"海关大楼|江海关|^上海海关$", 0),
    ("hsbc", r"浦东发展银行|汇丰银行大楼", 0),
    ("peace", r"^和平饭店$|和平饭店北楼|沙逊大厦", 0),
    ("bankofchina", r"^中国银行大楼$", 0),
    # modelled in heroes.js
    ("artpalace", r"^中华艺术宫$", 60), ("benz", r"^梅赛德斯-奔驰文化中心$", 60), ("museum", r"^上海博物馆$", 70), ("cathedral", r"徐家汇圣依纳爵", 30),
    ("castle", r"^奇幻童话城堡$", 40), ("longhuata", r"^龙华塔$", 12), ("huxinting", r"^湖心亭$", 8),
]
out, circles = {}, []
for lid, pat, r in WANT:
    m = b[nm.str.contains(pat, regex=True)]
    if lid in ("customs", "hsbc", "peace", "bankofchina"):
        m = m[(m["cx"] > 1500) & (m["cx"] < 2000) & (m["cy"] > -200) & (m["cy"] < 1400)]      # the Bund frontage only
    if not len(m):
        print("NOT FOUND", lid); continue
    u = shapely.union_all(m.geometry.values)
    big = max((u.geoms if hasattr(u, "geoms") else [u]), key=lambda p: p.area) if r == 0 else u
    if r == 0:
        m2 = m.assign(a=m.geometry.area).sort_values("a", ascending=False).iloc[0]
        big = m2.geometry
    c = big.centroid
    mrr = big.minimum_rotated_rectangle
    cc = np.asarray(mrr.exterior.coords)
    e1 = cc[1] - cc[0]; e2 = cc[2] - cc[1]
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    ax = e1 if l1 >= l2 else e2
    ang = float(np.arctan2(ax[1], ax[0]))
    h = float(m.height.max() + m.base.max()) if r else float(m.sort_values("area", ascending=False).iloc[0].height)
    out[lid] = dict(x=round(float(c.x), 2), z=round(float(-c.y), 2), angle=round(ang, 4), w=round(float(max(l1, l2)), 1), d=round(float(min(l1, l2)), 1), h=round(h, 1), n=int(len(m)))
    print(lid, out[lid], list(m["name"].unique())[:3])
    if r:
        circles.append(dict(x=float(c.x), y=float(c.y), r=r))
# ---------------------------------------------------------------- gardens and temples: every building inside becomes a hall with a tiled roof
# style: 0 Jiangnan garden (white walls, dark timber, black tiles), 1 Jing'an (teak and gold), 2 monastery (ochre walls, grey tiles), 3 Confucian temple (red walls)
SITES = [(0, ["豫园", "豫园商城", "上海城隍庙", "上海城隍庙广场"]), (1, ["静安寺"]), (2, ["龙华寺", "玉佛禅寺"]), (3, ["文庙上海文庙"])]
_ar = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
_an = _ar["name"].fillna("").values; _ak = _ar["kinds"].fillna("").values
halls, polys = [], []
X_, Y_ = b["cx"].values, b["cy"].values
for style, names in SITES:
    for nme in names:
        sel = [k for k in range(len(_ar)) if _an[k] == nme and "railway" not in _ak[k] and "highway" not in _ak[k]]
        for k in sel:
            g = shapely.make_valid(project_geoms(_ar.geometry.values[k:k + 1])[0])
            for poly in (g.geoms if hasattr(g, "geoms") else [g]):
                if poly.geom_type != "Polygon" or poly.area < 200:
                    continue
                shapely.prepare(poly)
                inside = np.flatnonzero(shapely.contains(poly, shapely.points(X_, Y_)))
                polys.append([[round(float(x), 1), round(float(y), 1)] for x, y in np.asarray(poly.exterior.coords)])
                for i in inside:
                    f = b.geometry.values[i]
                    if f.area < 28 or re.search("湖心亭|龙华塔", nm.values[i]):
                        continue
                    cc = np.asarray(f.minimum_rotated_rectangle.exterior.coords)
                    e1, e2 = cc[1] - cc[0], cc[2] - cc[1]
                    l1, l2 = np.hypot(*e1), np.hypot(*e2)
                    ax = e1 if l1 >= l2 else e2
                    k_ = np.sqrt(min(1.0, f.area / max(l1 * l2, 1e-6)))          # an L or a U is not as big as its bounding rectangle
                    c = cc[:4].mean(axis=0)
                    halls += [round(float(c[0]), 1), round(float(-c[1]), 1), round(float(np.arctan2(ax[1], ax[0])), 3), round(float(max(l1, l2) * k_), 1), round(float(min(l1, l2) * k_), 1),
                              round(float(min(b["height"].values[i], 26.0)), 1), style]
    print("halls: style", style, names, "->", len(halls) // 7, "so far")
out["halls"] = halls
# the Garden Bridge (外白渡桥): two steel camelback spans across the mouth of Suzhou Creek
_roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
_rn = np.array([json.loads(t).get("name") or "" for t in _roads["tags"].values])
_w = np.flatnonzero(_rn == "外白渡桥")
if len(_w):
    gl = shapely.line_merge(shapely.union_all(project_geoms(_roads.geometry.values[_w])))
    gl = max(gl.geoms, key=lambda q: q.length) if hasattr(gl, "geoms") else gl
    c0, c1 = np.asarray(gl.coords)[0][:2], np.asarray(gl.coords)[-1][:2]
    u = (c1 - c0) / np.hypot(*(c1 - c0)); cm = (c0 + c1) / 2
    out["waibaidu"] = dict(x=round(float(cm[0]), 1), z=round(float(-cm[1]), 1), ux=round(float(u[0]), 4), uz=round(float(-u[1]), 4), len=round(float(gl.length), 1))
    print("waibaidu", out["waibaidu"])
json.dump(out, open(os.path.join(OUT, "landmarks.json"), "w"), separators=(",", ":"))
json.dump(dict(circles=circles, polygons=polys), open(EXCL, "w"), indent=1)

# ---------------------------------------------------------------- the Huangpu bridges
# OSM has the river as a chain of mostly unnamed polygons: take the ones the named centre line runs through.
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
rt = [json.loads(t) for t in roads["tags"].values]
rbr = np.array([t.get("bridge") not in (None, "no") for t in rt]) & np.isin(roads.highway.values, ["motorway", "trunk", "primary", "secondary", "tertiary"])
water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
wg = shapely.make_valid(project_geoms(water.geometry.values))
wl = gpd.read_parquet(os.path.join(WORK, "osm_waterlines.parquet"))
hl = shapely.union_all(project_geoms(wl.geometry.values)[np.array(["黄浦江" in (json.loads(t).get("name") or "") for t in wl["tags"].values])])
hu = shapely.union_all(wg[(shapely.length(shapely.intersection(wg, hl)) > 300) & (shapely.area(wg) > 0.2e6)])
shapely.prepare(hu)
json.dump(shapely.to_wkt(shapely.simplify(hu, 2.0), rounding_precision=1), open(os.path.join(WORK, "huangpu.json"), "w"))
rg = project_geoms(roads.geometry.values)
cand = np.where(rbr & shapely.intersects(hu, rg))[0]
cross = []
for i in cand:
    c_ = shapely.intersection(rg[i], hu)
    parts = [p for p in (c_.geoms if hasattr(c_, "geoms") else [c_]) if p.geom_type == "LineString" and p.length > 150]
    if parts:
        part = max(parts, key=lambda p: p.length)
        cc = np.asarray(part.coords)[:, :2]
        t = rt[i]
        cross.append(dict(i=int(i), a=cc[0], b=cc[-1], mid=(cc[0] + cc[-1]) / 2, name=t.get("bridge:name") or t.get("name") or "", hw=roads.highway.values[i], layer=t.get("layer")))
# group the carriageways of one bridge
groups = []
for c_ in cross:
    for g in groups:
        if np.hypot(*(g[0]["mid"] - c_["mid"])) < 220:
            g.append(c_); break
    else:
        groups.append([c_])
# name (any of the tags found on the crossing ways) -> label, kind, main span, side spans (hung from the towers too), tower height, deck height
KNOWN = {
    "南浦大桥": ("南浦大桥", "cable_h", 423, 171, 150, 50), "杨浦大桥": ("杨浦大桥", "cable_y", 602, 243, 208, 52), "南北高架路": ("卢浦大桥", "arch", 550, 100, 100, 50),
    "卢浦大桥": ("卢浦大桥", "arch", 550, 100, 100, 50), "外环高速": ("徐浦大桥", "cable_a", 590, 242, 217, 50), "徐浦大桥": ("徐浦大桥", "cable_a", 590, 242, 217, 50),
    "闵浦大桥": ("闵浦大桥", "cable_h", 708, 252, 210, 54), "闵浦二桥": ("闵浦二桥", "cable_1", 0, 147, 148, 34), "闵浦三桥": ("闵浦三桥", "beam", 0, 0, 0, 32),
    "奉浦大桥": ("奉浦大桥", "girder", 0, 0, 0, 30), "沪金高速": ("奉浦大桥", "girder", 0, 0, 0, 30),
}
def num(v, d):
    m = re.match(r"\s*([0-9]+(\.[0-9]+)?)", v) if isinstance(v, str) else None
    return float(m.group(1)) if m else d


def carriageway(i):
    # the same widths as 31_build_ground.py
    t, h = rt[i], roads.highway.values[i]
    ln = num(t.get("lanes"), 3)
    return ln * 3.75 + 1.5 if h == "motorway" else ln * 3.5 + 1.2 if h == "trunk" else ln * 3.3 + 3.2


bridges, zones = [], []
for g in groups:
    names = [c_["name"] for c_ in g]
    key = next((n for n in names if n in KNOWN), None)
    label, kind, span, side, tower, deck = KNOWN[key] if key else (max(set(names), key=names.count) or "桥", "beam", 0, 0, 0, 22)
    ref = g[0]["b"] - g[0]["a"]
    A = np.mean([c_["a"] if (c_["b"] - c_["a"]) @ ref > 0 else c_["b"] for c_ in g], axis=0)
    Bp = np.mean([c_["b"] if (c_["b"] - c_["a"]) @ ref > 0 else c_["a"] for c_ in g], axis=0)
    if kind == "cable_1" and A[1] > Bp[1]:
        A, Bp = Bp, A                              # single tower: on the south bank (A)
    axis = (Bp - A) / np.hypot(*(Bp - A)); nrm = np.array([-axis[1], axis[0]])
    C = (A + Bp) / 2
    wat = float(np.hypot(*(Bp - A)))
    if kind == "cable_1":
        span = round(wat + 12)
    # the stretch at full height, along the axis from the middle of the river: s0 .. s1
    if kind == "girder":
        s0, s1 = -545.3 / 2 - 6, 545.3 / 2 + 6          # Fengpu: five spans, 85 + 3 x 125 + 85 m
    elif kind == "beam":
        s0, s1 = -wat / 2 - 30, wat / 2 + 30
    elif kind == "cable_1":
        s0, s1 = -span / 2 - side, span / 2
    else:
        s0, s1 = -span / 2 - side, span / 2 + side
    # a double-decker (Minpu): the local road runs under the expressway
    double = kind not in ("beam", "girder") and len(g) > 2
    levels = {c_["hw"]: (deck - 10 if double and c_["hw"] not in ("motorway", "trunk") else deck) for c_ in g}
    edge = 0.0
    for c_ in g:
        cc = np.asarray(rg[c_["i"]].coords)[:, :2] - C
        sv, tv = cc @ axis, cc @ nrm
        m = (sv > s0) & (sv < s1)
        if m.any():
            edge = max(edge, float(np.abs(tv[m]).max()) + carriageway(c_["i"]) / 2 + 0.45)
    zones.append(dict(name=label, cx=float(C[0]), cy=float(C[1]), ux=float(axis[0]), uy=float(axis[1]), s0=float(s0), s1=float(s1), half=22.0, levels=levels, hung=kind != "beam"))
    # outline of the roadway along the axis (top deck): [s, centre, half width] every 20 m, in the frame of the site model
    # (z across = -t). The girder and the stay anchors follow it: the carriageways are not everywhere the same distance apart.
    top = [h for h, v in levels.items() if v == deck]
    near = np.where(rbr & np.isin(roads.highway.values, top) & shapely.intersects(rg, shapely.Point(C).buffer(max(abs(s0), abs(s1)) + 50)))[0]
    bins = {}
    for i in near:
        ln_ = rg[i]
        d = np.array([np.asarray(ln_.interpolate(v).coords)[0][:2] for v in np.arange(0, ln_.length + 2.5, 5.0)])
        if len(d) < 2:
            continue
        dr = np.gradient(d, axis=0); dr /= np.maximum(np.hypot(*dr.T), 1e-9)[:, None]
        sv, tv = (d - C) @ axis, (d - C) @ nrm
        hwid = carriageway(i) / 2 + 0.45
        if len(g) > 1 and np.median(np.abs(tv)) > 2:
            hwid = min(hwid, float(np.median(np.abs(tv))))          # two carriageways side by side cannot be wider than the room they have (31_build_ground.py narrows them too)
        for s_, t_ in zip(sv[(np.abs(tv) < 22) & (np.abs(dr @ axis) > 0.94)], tv[(np.abs(tv) < 22) & (np.abs(dr @ axis) > 0.94)]):
            if s0 - 10 <= s_ <= s1 + 10:
                b_ = bins.setdefault(int(round((s_ - s0) / 20.0)), [1e9, -1e9])
                b_[0] = min(b_[0], t_ - hwid); b_[1] = max(b_[1], t_ + hwid)
    prof = [[round(s0 + k * 20.0, 1), round(-(lo + hi) / 2, 2), round((hi - lo) / 2, 2)] for k, (lo, hi) in sorted(bins.items())]
    if kind == "beam":
        print("beam bridge", label, [round(float(v)) for v in C], "deck", deck, "ways", len(g)); continue
    # world frame of the site: x east, z south
    bridges.append(dict(name=label, kind=kind, tower=tower, deck=deck, span=span, side=side, edge=round(edge, 1), water=round(wat, 1), double=double, prof=prof,
                        x=round(float(C[0]), 1), z=round(float(-C[1]), 1), ux=round(float(axis[0]), 5), uz=round(float(-axis[1]), 5)))
    print("bridge", {k: v for k, v in bridges[-1].items() if k != "prof"}, "ways", len(g), "outline", len(prof), "half", min(p[2] for p in prof), max(p[2] for p in prof), "centre", min(p[1] for p in prof), max(p[1] for p in prof))
out["bridges"] = bridges
json.dump(out, open(os.path.join(OUT, "landmarks.json"), "w"), ensure_ascii=False, separators=(",", ":"))
json.dump(dict(zones=zones), open(os.path.join(WORK, "huangpu_bridges.json"), "w"), ensure_ascii=False)
