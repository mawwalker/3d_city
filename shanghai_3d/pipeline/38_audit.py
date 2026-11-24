"""Consistency audit of the street level: things that must never overlap, checked over the whole map.

  buildings  x  carriageways (roads with traffic, at street level)          -> 29_clip_buildings.py should leave none
  walking loops  x  carriageways                                            -> 37_traffic.py should leave none
  walking loops  x  buildings
  sign poles, direction-board posts, bus stops  x  carriageways / buildings
  traffic edges at street level that have no road surface under them
  traffic lanes of different roads drawn over each other (opposing: cars would meet head on)   -> 37_traffic.py fits the lanes

Single process, a tile at a time (modest memory). Prints a summary and writes work/audit.json; exits 1 if a check that
should be clean is not.

usage: 38_audit.py <work_dir>
"""
import sys, os, json, pickle, struct, time
import numpy as np, geopandas as gpd, shapely
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

WORK = sys.argv[1]
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"), columns=["geometry"])
A = pickle.load(open(os.path.join(WORK, "roads_attr.pkl"), "rb"))
cls, W, bridge, tunnel, lowbr, area_, deck = (A[k] for k in ("cls", "W", "bridge", "tunnel", "lowbr", "area", "deck"))
R = project_geoms(roads.geometry.values)
ground = ~area_ & ~tunnel & (~bridge | lowbr)
traffic = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ground
sel = np.flatnonzero(traffic)
CW = shapely.buffer(R[sel], W[sel] / 2 - 0.05, quad_segs=2)            # the carriageways proper
cw_tree = shapely.STRtree(CW)
out = {}

# ---------------------------------------------------------------- buildings in the road
b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["geometry", "base"])
G = b.geometry.values; base = b["base"].values.astype(float)
bi, ri = cw_tree.query(G, predicate="intersects")
m = base[bi] < 4.2
bi, ri = bi[m], ri[m]
ov = shapely.area(shapely.intersection(G[bi], CW[ri])) if len(bi) else np.zeros(0)
bad = np.unique(bi[ov > 2.0])
out["buildings"] = len(b)
out["buildings_on_carriageway"] = int(len(bad))
out["buildings_on_carriageway_m2"] = float(round(ov[ov > 2.0].sum()))
log("buildings standing in a carriageway (more than 2 m2 of it):", len(bad), "of", len(b))
b_tree = shapely.STRtree(G)


# ---------------------------------------------------------------- walking loops
def read_walks(p, ox, oy):
    buf = open(p, "rb").read()
    n, nv = struct.unpack_from("<II", buf, 0)
    o = 12
    npts = []
    for _ in range(n):
        npts.append(struct.unpack_from("<BBH", buf, o)); o += 4
    xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.float64)
    loops = []; s = 0
    for kind, _, m_ in npts:
        c = np.cumsum(xy[s:s + m_], axis=0) * 0.1 + (ox, oy); s += m_
        if m_ >= 3:
            loops.append((kind, shapely.LinearRing(c)))
    return loops


km = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}; on_cw = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}; in_b = {0: 0.0, 1: 0.0, 2: 0.0, 3: 0.0}
worst = []
wd = os.path.join(WORK, "sections", "walks")
for f in sorted(os.listdir(wd)):
    i, j = [int(v) for v in f[:-4].split("_")]
    loops = read_walks(os.path.join(wd, f), GRID_X0 + i * TILE, GRID_Y0 + j * TILE)
    if not loops:
        continue
    lines = np.array([l for _, l in loops], dtype=object); kinds = np.array([k for k, _ in loops])
    L = shapely.length(lines)
    for k in range(4):
        km[k] += float(L[kinds == k].sum()) / 1e3
    li, ci = cw_tree.query(lines, predicate="intersects")
    t_cw = 0.0
    if len(li):
        d = shapely.length(shapely.intersection(lines[li], CW[ci]))
        for k in range(4):
            on_cw[k] += float(d[kinds[li] == k].sum())
        t_cw = float(d.sum())
    li, ci = b_tree.query(lines, predicate="intersects")
    if len(li):
        d = shapely.length(shapely.intersection(lines[li], G[ci]))
        for k in range(4):
            in_b[k] += float(d[kinds[li] == k].sum())
    if t_cw > 5:
        worst.append((round(t_cw), f[:-4]))
names = {0: "pavement", 1: "pedestrian street", 2: "square", 3: "path"}
out["walk_km"] = {names[k]: round(v, 1) for k, v in km.items()}
out["walk_m_on_carriageway"] = {names[k]: round(v, 1) for k, v in on_cw.items()}
out["walk_m_in_buildings"] = {names[k]: round(v, 1) for k, v in in_b.items()}
log("walking loops (km):", out["walk_km"])
log("  metres of them on a carriageway:", out["walk_m_on_carriageway"], "worst tiles", sorted(worst, reverse=True)[:5])
log("  metres of them inside buildings:", out["walk_m_in_buildings"])

# ---------------------------------------------------------------- signs
sd = os.path.join(WORK, "sections", "signs")
pts = {"pole": [], "board": [], "stop": []}
if os.path.isdir(sd):
    for f in sorted(os.listdir(sd)):
        i, j = [int(v) for v in f[:-4].split("_")]
        ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
        d = json.loads(open(os.path.join(sd, f), "rb").read().decode())
        for key, stride, name in (("p", 6, "pole"), ("b", 8, "board"), ("s", 5, "stop")):
            v = d.get(key, [])
            for k in range(0, len(v), stride):
                pts[name].append((ox + v[k], oy + v[k + 1]))
for name, pp in pts.items():
    if not pp:
        continue
    P = shapely.points(np.array(pp))
    a = len(np.unique(cw_tree.query(P, predicate="within")[0]))
    c = len(np.unique(b_tree.query(P, predicate="within")[0]))
    out[f"{name}s"] = len(pp); out[f"{name}s_on_carriageway"] = a; out[f"{name}s_in_buildings"] = c
    log(f"{name}s: {len(pp)}; standing in a carriageway {a}, inside a building {c}")

# ---------------------------------------------------------------- traffic without a road under it
stats = os.path.join(WORK, "traffic_stats.json")
drive = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~area_
veh = (cls >= 0) & (cls != 8) & (cls != 9) & (~bridge | lowbr) & ~tunnel & ~area_
nosurf = drive & ~veh & ~deck & ~tunnel
out["traffic_km_without_surface"] = float(round(shapely.length(R[nosurf]).sum() / 1e3, 1))
log("drivable roads that are neither drawn at street level, nor a deck, nor a tunnel (km):", out["traffic_km_without_surface"])

# ---------------------------------------------------------------- lanes of different roads over each other
# Every lane of the traffic graph as a line of points 3 m apart (the stretch between its two junctions only, and not where a
# tunnel has gone under): a point of one edge closer than 2.25 m to a lane of another, at the same level, is a place where
# two cars cannot both be. Going the same way that is a merge (the cars zip together); against each other it is a head-on.
from scipy.spatial import cKDTree
td = os.path.join(WORK, "sections", "traffic")
LP, LD, LZ, LE = [], [], [], []
ne_tot = 0
for f in sorted(os.listdir(td)):
    i, j = [int(v) for v in f[:-4].split("_")]
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    buf = open(os.path.join(td, f), "rb").read()
    ne, nv, na = struct.unpack_from("<III", buf, 0)
    recs = [struct.unpack_from("<IIBBBBBbBBBBBBBBHHH", buf, 12 + 40 * e) for e in range(ne)]
    o = 12 + 40 * ne
    xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(float)
    zz = np.frombuffer(buf, "<i2", nv, o + nv * 4).astype(float) * 0.05
    k = 0
    for a_, b_, c_, flags, nf, nb, lw, shift, W_, kmh, tA, tB, sA, sB, cA, cB, npts, phA, phB in recs:
        lw /= 20; shift /= 10; tA /= 2; tB /= 2
        p = np.cumsum(xy[k:k + npts], axis=0) * 0.1 + (ox, oy); z = zz[k:k + npts]; k += npts
        seg = np.hypot(*np.diff(p, axis=0).T); sc = np.concatenate([[0], np.cumsum(seg)]); L_ = sc[-1]
        eid = ne_tot; ne_tot += 1
        if L_ < 1:
            continue
        fit = max(0.0, L_ - 1) / (tA + tB) if tA + tB > L_ - 1 else 1.0          # (as traffic.js shares a short edge out)
        st = np.arange(tA * fit + 1.0, L_ - tB * fit - 1.0, 3.0)
        if not len(st):
            continue
        idx = np.clip(np.searchsorted(sc, st) - 1, 0, len(seg) - 1)
        d = (p[idx + 1] - p[idx]) / np.maximum(seg[idx], 1e-6)[:, None]
        c0 = np.column_stack([np.interp(st, sc, p[:, 0]), np.interp(st, sc, p[:, 1])]); left = np.column_stack([-d[:, 1], d[:, 0]]); h = np.interp(st, sc, z)
        for dd in range(2):
            for l in range(nb if dd else nf):
                off = shift + (l + 0.5) * lw if dd else (shift + (nf / 2 - l - 0.5) * lw if flags & 1 else shift - (l + 0.5) * lw)
                LP.append(c0 + left * off); LD.append(-d if dd else d); LZ.append(h); LE.append(np.full(len(st), eid))
LP = np.vstack(LP); LD = np.vstack(LD); LZ = np.concatenate(LZ); LE = np.concatenate(LE)
pr = cKDTree(LP).query_pairs(2.25, output_type="ndarray")
a_, b_ = pr[:, 0], pr[:, 1]
ok = (LE[a_] != LE[b_]) & (np.abs(LZ[a_] - LZ[b_]) < 1.8) & (LZ[a_] > -2.5) & (LZ[b_] > -2.5)
a_, b_ = a_[ok], b_[ok]
dot = (LD[a_] * LD[b_]).sum(1)
out["traffic_edges"] = ne_tot; out["lane_km"] = float(round(len(LP) * 3 / 1e3))
for name, m in (("opposing", dot < -0.5), ("same_way", dot > 0.5), ("crossing", np.abs(dot) <= 0.5)):
    pairs = len(np.unique(np.minimum(LE[a_[m]], LE[b_[m]]) * 10_000_000 + np.maximum(LE[a_[m]], LE[b_[m]])))
    metres = len(np.unique(np.concatenate([a_[m], b_[m]]))) * 3 / 2
    out[f"lanes_over_each_other_{name}"] = dict(edge_pairs=int(pairs), km=float(round(metres / 1e3, 1)))
log("lanes of different roads over each other (edge pairs, km of lane), of", out["lane_km"], "km:",
    {k[22:]: (v["edge_pairs"], v["km"]) for k, v in out.items() if k.startswith("lanes_over_each_other_")})
del LP, LD, LZ, LE, pr

json.dump(out, open(os.path.join(WORK, "audit.json"), "w"), indent=1, ensure_ascii=False)
fail = out["buildings_on_carriageway"] > 0 or sum(out["walk_m_on_carriageway"].values()) > 50 or out["lanes_over_each_other_opposing"]["km"] > 5
log("audit", "FAILED" if fail else "clean")
sys.exit(1 if fail else 0)
