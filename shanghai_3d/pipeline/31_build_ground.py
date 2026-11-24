"""Street-level ground for every tile.

Vector polygons (crisp kerbs):   1 roadway  2 sidewalk  3 median / traffic island  4 water  5 pedestrian paving (plazas, promenades, paths)
                                 8 rail bed  20 block interior (everything else)
Land-cover raster, 2 m:          low nibble = cover (0 paved, 1 grass, 2 under trees, 3 shrubs, 4 crops, 5 bare soil, 6 water, 7 wetland, 8 pitch, 9 sand)
                                 high nibble = land use (0 none, 1 park, 2 residential, 3 commercial, 4 industrial, 5 campus, 6 farmland, 7 forest,
                                               8 construction, 9 railway, 10 sport, 11 cemetery, 12 golf, 13 parking, 14 airfield, 15 plaza)
Road centre lines with attributes, for markings and traffic.

Writes work/sections/{ground,landcover,roads}/<i>_<j>.bin and work/ground_stats.json.
usage: 31_build_ground.py <work_dir> <sinolc.tif> [i0 j0 i1 j1]
"""
import sys, os, json, time, struct, re, gzip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
os.environ.setdefault("GDAL_CACHEMAX", "256")          # MB of raster block cache per process (the default is 5 % of the machine each)
import rasterio, rasterio.features, rasterio.warp
from rasterio.transform import from_origin
from multiprocessing import get_context
from common import *
from tilefmt import encode_polys, encode_lines, encode_lines_z, clip_line_box, pad4

WORK, SINOLC = sys.argv[1:3]
RANGE = [int(v) for v in sys.argv[3:7]] if len(sys.argv) >= 7 else [0, 0, GRID_NX, GRID_NY]
T0 = time.time()
RES = 2.0
NPX = int(TILE / RES)


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def num(s):
    if not isinstance(s, str):
        return np.nan
    m = re.match(r"\s*(-?[0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        return [p for p in g.geoms if p.geom_type == "Polygon" and not p.is_empty]
    return []


# ================================================================ load + classify (parent process; children inherit by fork)
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
rt = [json.loads(t) for t in roads["tags"].values]
hw = roads.highway.values
R_GEOM = project_geoms(roads.geometry.values)
tg = lambda k: np.array([t.get(k) for t in rt], dtype=object)
bridge = np.array([t.get("bridge") not in (None, "no") for t in rt])
layer = np.nan_to_num(np.array([num(t.get("layer")) for t in rt]), nan=0).astype(int)
# under the ground: real tunnels and anything mapped below street level. A passage through a building or a street under a
# roof (tunnel=building_passage, covered=yes) is still a street at street level: it is drawn, and 29_clip_buildings.py opens
# the building over it.
tunnel = np.array([t.get("tunnel") in ("yes", "culvert", "flooded", "avalanche_protector") or t.get("indoor") == "yes" or t.get("location") == "underground" for t in rt]) | ((layer < 0) & ~bridge)
lanes = np.array([num(t.get("lanes")) for t in rt])
width_t = np.array([num(t.get("width")) for t in rt])
oneway = np.array([t.get("oneway") in ("yes", "1", "true", "-1") or t.get("junction") == "roundabout" for t in rt]) | np.isin(hw, ["motorway", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"])
is_area = np.array([t.get("area") == "yes" for t in rt])
footway_kind = tg("footway")
service_kind = tg("service")
RC = dict(motorway=0, trunk=1, primary=2, secondary=3, tertiary=4, residential=5, unclassified=5, living_street=6, service=7, pedestrian=8, footway=9, path=9, cycleway=9, steps=9, track=10, busway=4)
cls = np.full(len(roads), -1)
for k, v in RC.items():
    cls[hw == k] = v
link = pd.Series(hw).str.endswith("_link").values
link_parent = pd.Series(hw).str.replace("_link", "").map({"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}).fillna(-1).astype(int).values
cls[link] = 11
# carriageway width (m)
W = np.zeros(len(roads))
ln = lanes
dfl = lambda a, b: np.where(np.isfinite(ln), ln, np.where(oneway, a, b))
W[cls == 0] = dfl(3, 6)[cls == 0] * 3.75 + 1.5
W[cls == 1] = dfl(3, 6)[cls == 1] * 3.5 + 1.2
W[cls == 2] = np.where(oneway, dfl(3, 3) * 3.3 + 3.2, dfl(4, 4) * 3.3 + 6.0)[cls == 2]
W[cls == 3] = np.where(oneway, dfl(2, 2) * 3.3 + 3.0, dfl(4, 4) * 3.2 + 5.0)[cls == 3]
W[cls == 4] = np.where(oneway, dfl(2, 2) * 3.3 + 2.4, dfl(2, 2) * 3.4 + 4.6)[cls == 4]
W[cls == 5] = np.where(np.isfinite(ln) & (ln >= 2), np.minimum(ln, 4) * 3.2 + 1.0, 6.4)[cls == 5]
W[cls == 6] = 4.6
W[cls == 7] = np.where(np.isin(service_kind, ["driveway", "alley", "parking_aisle"]), 3.4, 4.4)[cls == 7]
W[cls == 8] = 9.0
W[cls == 9] = 2.4
W[cls == 10] = 3.0
W[cls == 11] = np.where(np.isfinite(ln), ln, 1.4)[cls == 11] * 3.6 + 1.6
ok_w = np.isfinite(width_t) & (width_t > 1.5) & (width_t < 60)
W = np.where(ok_w & (cls >= 0), np.clip(width_t, W * 0.5, W * 2.2), W)
# the lanes each way carries (the map's count, else the usual for its class: lanes.py), and the least carriageway that holds
# them. They are not given up for want of room beside a neighbour: 14_spread_roads.py has moved such carriageways apart.
from lanes import road_lanes
_LM = road_lanes(hw, rt)
NLF, NLB, LTAG = _LM["nf"], _LM["nb"], _LM["tagged"]
WNEED = np.where(cls == 5, np.where(oneway, 3.6, 6.0), _LM["wneed"])
W = np.where(_LM["wneed"] > 0, np.maximum(W, _LM["wneed"]), W)          # (a width tag narrower than the lanes of the same way: the lanes count)
WN = W.copy()                                                           # the width before any narrowing beside a neighbour
sidewalk_of = {2: 4.6, 3: 4.0, 4: 3.2, 5: 2.2}
SW = np.array([sidewalk_of.get(c, 0.0) for c in cls])
# the slip lanes and turning roads of ordinary streets have pavements too (those of the expressways do not)
SW = np.where((cls == 11) & np.isin(link_parent, [2, 3, 4]), 3.0, SW)
ped_skip = (cls == 9) & (np.isin(footway_kind, ["sidewalk", "crossing", "traffic_island", "access_aisle"]) | (shapely.length(R_GEOM) < 25))
# short, low bridges (over the creeks and canals) are built as part of the street surface; long or high ones become decks
RLEN = shapely.length(R_GEOM)
def _vkeys(c):
    return (np.round(c[:, 0] * 20).astype(np.int64) + 4_000_000) * 8_000_000 + (np.round(c[:, 1] * 20).astype(np.int64) + 4_000_000)


atgrade = (cls >= 0) & ~bridge & ~tunnel
_gk = np.unique(_vkeys(shapely.get_coordinates(R_GEOM[atgrade])))
_e0 = np.isin(_vkeys(shapely.get_coordinates(shapely.get_point(R_GEOM, 0))), _gk); _e1 = np.isin(_vkeys(shapely.get_coordinates(shapely.get_point(R_GEOM, -1))), _gk)
# (a short piece of a long viaduct is not a low bridge, whatever its layer tag says: both ends must meet a street; nor is a
#  bridge over a road, which 12_flyovers.py has given its approaches: fly 1 the bridge, 2 the ramps up to it)
FLY = roads["fly"].values.astype(int) if "fly" in roads.columns else np.zeros(len(roads), int)
LOWBR = bridge & (layer <= 1) & (RLEN < 260) & ~np.isin(cls, [0, 11]) & ((_e0 & _e1) | ~np.isin(cls, [1, 2, 3, 4, 5])) & (FLY == 0)
VEH = (cls >= 0) & (cls != 8) & (cls != 9) & (~bridge | LOWBR) & ~tunnel & ~is_area
PED = ((cls == 8) | ((cls == 9) & ~ped_skip)) & ~tunnel & ~is_area & (~bridge | LOWBR)
ROAD_TREE = shapely.STRtree(R_GEOM)

# ================================================================ decks: viaducts, flyovers, the big river bridges, elevated metro
# Every deck way gets a plateau height from its layer; where decks meet they share the higher level, where a deck meets a
# street it comes down to the ground at a steady grade.
DECK = bridge & ~LOWBR & np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~tunnel & ~is_area
SLOPE, KMAX = 0.05, 0.08
# (the approach of a flyover comes with its own grade where a side street leaves it less room: 12_flyovers.py)
KW = np.array([num(t.get("sh3d:ramp")) for t in rt])
RAMP = np.isfinite(KW) & (KW > 0)
KW = np.where(RAMP, KW, SLOPE)
Hw = np.where(DECK, 5.6 * np.clip(layer, 1, 5) + 0.6, 0.0)
# the Huangpu crossings (34_landmarks.py): a zone along the axis of each bridge with the real deck height per road class
_hb = os.path.join(WORK, "huangpu_bridges.json")
ZONES = json.load(open(_hb))["zones"] if os.path.exists(_hb) else []


def solve_decks():
    """Heights along every deck way. The ways form a graph on their shared vertices; a vertex shared with a street is on the
    ground. Each way wants the level of its layer, the river crossings their real height; next to a higher deck a way is
    lifted so that nothing steps (a 5 % grade away from the high point, which is how the approaches of the big bridges come
    about); a run that ends on the ground comes down to it, steeper than 5 % only when it is too short to do otherwise, and
    never steeper than KMAX (the approach of a flyover: the grade 12_flyovers.py gave it). A vertex too close to a touch-down
    to reach the level of its layer at that grade stays below it."""
    import heapq
    gk = np.unique(_vkeys(shapely.get_coordinates(R_GEOM[atgrade | LOWBR])))
    node_of, nn = {}, 0
    WN, WC, WS = {}, {}, {}
    eu, ev, el, ew, end_n, end_k, high = [], [], [], [], [], [], []
    WH = {}
    for i in np.where(DECK)[0]:
        c = np.asarray(R_GEOM[i].coords)[:, :2]
        c = c[np.concatenate([[True], np.hypot(*np.diff(c, axis=0).T) > 1e-6])]
        if len(c) < 2:
            continue
        sd = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))])
        keys = _vkeys(c)
        # extra stations: the grade breaks do not fall on OSM vertices
        extra = [np.arange(0, sd[-1], 15.0)] if sd[-1] > 20 else []
        zs = []
        for z in ZONES:
            if hw[i] not in z["levels"]:
                continue
            d = c - (z["cx"], z["cy"])
            sv, tv = d @ (z["ux"], z["uy"]), d @ (-z["uy"], z["ux"])
            if sv.max() < z["s0"] or sv.min() > z["s1"] or np.abs(tv).min() > z["half"]:
                continue
            zs.append(z)
            for lim in (z["s0"], z["s1"]):                      # stations where the way enters and leaves the zone
                k = np.where((sv[:-1] - lim) * (sv[1:] - lim) < 0)[0]
                extra.append(sd[k] + (lim - sv[k]) / (sv[k + 1] - sv[k]) * (sd[k + 1] - sd[k]))
        ss = np.unique(np.concatenate([sd] + extra))
        ids = np.full(len(ss), -1, np.int64)
        for k, o in enumerate(np.searchsorted(ss, sd)):
            nid = node_of.get(int(keys[k]))
            if nid is None:
                nid = node_of[int(keys[k])] = nn; nn += 1
            ids[o] = nid
        for o in np.where(ids < 0)[0]:
            ids[o] = nn; nn += 1
        xy = np.column_stack([np.interp(ss, sd, c[:, 0]), np.interp(ss, sd, c[:, 1])])
        WN[i] = ids; WC[i] = xy
        eu.extend(ids[:-1]); ev.extend(ids[1:]); el.extend(np.diff(ss)); ew.extend([i] * (len(ss) - 1))
        end_n += [ids[0], ids[-1]]; end_k += [keys[0], keys[-1]]
        for z in zs:
            d = xy - (z["cx"], z["cy"])
            sv, tv = d @ (z["ux"], z["uy"]), d @ (-z["uy"], z["ux"])
            dr = np.gradient(xy, axis=0); dr /= np.maximum(np.hypot(*dr.T), 1e-9)[:, None]
            m = (sv >= z["s0"] - 0.01) & (sv <= z["s1"] + 0.01) & (np.abs(tv) < z["half"]) & (np.abs(dr @ (z["ux"], z["uy"])) > 0.94)
            high += [(n_, z["levels"][hw[i]]) for n_ in ids[m]]
            if z["hung"]:
                WH[i] = WH.get(i, np.zeros(len(ss), bool)) | m
    eu, ev, el, ew = np.asarray(eu), np.asarray(ev), np.asarray(el), np.asarray(ew)
    isg = np.zeros(nn, bool)
    isg[np.asarray(end_n)[np.isin(np.asarray(end_k), gk)]] = True
    plat = np.zeros(nn)
    np.maximum.at(plat, eu, Hw[ew]); np.maximum.at(plat, ev, Hw[ew])
    fixed = np.zeros(nn, bool)
    for n_, hgt in high:
        plat[n_] = max(plat[n_], hgt); fixed[n_] = True; isg[n_] = False
    adj = [[] for _ in range(nn)]
    adjw = [[] for _ in range(nn)]                 # the way each of those edges belongs to
    for u, v, l, w_ in zip(eu.tolist(), ev.tolist(), el.tolist(), ew.tolist()):
        adj[u].append((v, l)); adj[v].append((u, l)); adjw[u].append(w_); adjw[v].append(w_)
    # 1. lift: L(n) = max over m of plat(m) - SLOPE * dist(n, m)
    L = plat.copy(); L[isg] = 0.0
    heap = [(-L[n], n) for n in range(nn) if not isg[n]]
    heapq.heapify(heap)
    while heap:
        negl, n = heapq.heappop(heap)
        if -negl < L[n] - 1e-9:
            continue
        for nb, ln in adj[n]:
            cand = L[n] - SLOPE * ln
            if not isg[nb] and cand > L[nb] + 1e-9:
                L[nb] = cand; heapq.heappush(heap, (-cand, nb))
    # 2. nothing climbs faster than it may. U(n): the height that can be reached from the ground along the decks at the
    #    steepest grade allowed on each way (KMAX; the approach of a flyover has its own). A junction of decks a short way
    #    above its touch-down cannot stand at its plateau: it used to be put there all the same, with a cliff below it.
    capw = lambda w_: float(KW[w_]) if RAMP[w_] else KMAX
    U = np.full(nn, np.inf); U[isg] = 0.0
    heap = [(0.0, int(n)) for n in np.where(isg)[0]]
    heapq.heapify(heap)
    while heap:
        u, n = heapq.heappop(heap)
        if u > U[n] + 1e-9:
            continue
        for (nb, ln), w_ in zip(adj[n], adjw[n]):
            cand = u + capw(w_) * ln
            if not fixed[nb] and cand < U[nb] - 1e-9:
                U[nb] = cand; heapq.heappush(heap, (cand, nb))
    H0 = np.where(fixed, L, np.minimum(L, U))
    # 3. runs from the ground: along vertices with two neighbours up to the first junction (or the next ground vertex),
    #    at 5 % where the run is long enough for that, steeper where it is not
    h = H0.copy()
    steep = 0
    for g in np.where(isg)[0]:
        for (nb, ln), w0 in zip(adj[g], adjw[g]):
            kr = float(KW[w0])                     # the grade this run leaves the ground at
            path, dist = [g, nb], [0.0, ln]
            prev, cur = g, nb
            while not isg[cur] and not fixed[cur] and len(adj[cur]) == 2 and cur != g:
                a, b = adj[cur]
                nxt = b if a[0] == prev else a
                if nxt[0] == prev:
                    break
                path.append(nxt[0]); dist.append(dist[-1] + nxt[1]); prev, cur = cur, nxt[0]
            Lc = dist[-1]
            if isg[cur]:
                for n_, d_ in zip(path[1:-1], dist[1:-1]):
                    h[n_] = min(h[n_], kr * d_)
                continue
            top = H0[cur]
            k = max(SLOPE, top / max(Lc, 1e-6))
            steep += k > 0.08
            short = Lc < 2 * top / SLOPE
            for n_, d_ in zip(path[1:-1], dist[1:-1]):
                h[n_] = min(U[n_], max(L[n_], top) if short else L[n_], k * d_)
    # 4. round the grade breaks a little (not over the river: towers and cables are built to the exact level). Each vertex
    #    moves half way towards the straight line between its two neighbours (by distance: vertices are not evenly spaced)
    still = isg | fixed
    deg2 = np.array([len(a) == 2 for a in adj]) & ~still
    n1 = np.array([a[0][0] if len(a) == 2 else 0 for a in adj]); n2 = np.array([a[1][0] if len(a) == 2 else 0 for a in adj])
    l1 = np.array([a[0][1] if len(a) == 2 else 1.0 for a in adj]); l2 = np.array([a[1][1] if len(a) == 2 else 1.0 for a in adj])
    for _ in range(4):
        h = np.where(deg2, 0.5 * h + 0.5 * (h[n1] * l2 + h[n2] * l1) / np.maximum(l1 + l2, 1e-6), h)
    # 5. and once more no step anywhere: no vertex stands higher above a neighbour than the grade of the way between allows
    heap = [(float(h[n]), n) for n in range(nn) if not fixed[n]]
    heapq.heapify(heap)
    while heap:
        u, n = heapq.heappop(heap)
        if u > h[n] + 1e-9:
            continue
        for (nb, ln), w_ in zip(adj[n], adjw[n]):
            cand = u + capw(w_) * 1.03 * ln + 0.02
            if not still[nb] and cand < h[nb] - 1e-9:
                h[nb] = cand; heapq.heappush(heap, (cand, nb))
    # parts: (way, xyz, hung from towers); a way is cut where its hung stretch begins and ends
    parts = []
    for i in WN:
        xyz = np.column_stack([WC[i], h[WN[i]]])
        if i in WH and WH[i].any():
            sh = WH[i][:-1] & WH[i][1:]                          # per segment
            cut = np.concatenate([[0], np.where(sh[1:] != sh[:-1])[0] + 1, [len(sh)]])
            for lo, hi in zip(cut[:-1], cut[1:]):
                parts.append((i, xyz[lo:hi + 1], bool(sh[lo])))
        else:
            parts.append((i, xyz, False))
    log("deck graph", nn, "vertices,", int(isg.sum()), "on the ground,", int(steep), "steep runs")
    return parts


DECK_PARTS = solve_decks()
DECK_GEOM = np.array([shapely.LineString(p[1][:, :2]) for p in DECK_PARTS], dtype=object)


def parallel_widths():
    """Carriageway widths come from lane counts; where two carriageways are mapped closer together than that (the two
    directions of an elevated road, a street and its frontage road), they would overlap: one deck's parapet standing in the
    other's lane, traffic driving through each other. Such ways share out the room they really have: each keeps what its
    lanes need at 3 m apiece (14_spread_roads.py has seen to it that there is that much), and what is left over is shared
    in proportion to what each would have had beyond that."""
    from scipy.spatial import cKDTree
    parts = {}
    for i_, xyz, _ in DECK_PARTS:
        parts.setdefault(i_, []).append(xyz)
    P, T, Z, I = [], [], [], []
    for k in np.flatnonzero(np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~is_area):
        if k in parts:
            segs = parts[k]
        else:
            c = shapely.get_coordinates(R_GEOM[k])
            sl = np.hypot(*np.diff(c, axis=0).T)
            s_ = np.concatenate([[0], np.cumsum(sl)])
            if s_[-1] < 1:
                continue
            st = np.unique(np.concatenate([s_, np.arange(0, s_[-1], 12.0)]))
            segs = [np.column_stack([np.interp(st, s_, c[:, 0]), np.interp(st, s_, c[:, 1]), np.full(len(st), -8.0 if tunnel[k] else 0.0)])]
        for xyz in segs:
            if len(xyz) < 2:
                continue
            d = np.gradient(xyz[:, :2], axis=0); d /= np.maximum(np.hypot(*d.T), 1e-9)[:, None]
            P.append(xyz[:, :2]); T.append(d); Z.append(xyz[:, 2]); I.append(np.full(len(xyz), k))
    P, T, Z, I = np.vstack(P), np.vstack(T), np.concatenate(Z), np.concatenate(I)
    tree = cKDTree(P)
    K = 14
    dd, jj = tree.query(P, k=K, distance_upper_bound=24.0, workers=-1)
    best = np.full(len(P), np.inf)                 # per station: the share of its width that the nearest parallel way leaves it
    a = np.repeat(np.arange(len(P)), K); b = jj.ravel()
    ok = b < len(P)
    a, b = a[ok], b[ok]
    ok = (I[a] != I[b]) & (np.abs(Z[a] - Z[b]) < 2.0) & (np.abs((T[a] * T[b]).sum(1)) > 0.9)
    a, b = a[ok], b[ok]
    d = P[b] - P[a]
    along = np.abs((d * T[a]).sum(1)); across = np.abs(d[:, 0] * -T[a][:, 1] + d[:, 1] * T[a][:, 0])
    ha, hb = W[I[a]] / 2, W[I[b]] / 2
    na, nb_ = np.minimum(WNEED[I[a]], W[I[a]]) / 2, np.minimum(WNEED[I[b]], W[I[b]]) / 2
    room = across - 0.9
    m = (along < 9.0) & (across > 2.5) & (room < ha + hb)
    got = np.where(room >= na + nb_, na + (room - na - nb_) * (ha - na) / np.maximum((ha - na) + (hb - nb_), 1e-6), room * na / np.maximum(na + nb_, 1e-6))
    # two ways that meet are not neighbours near the point where they do (a slip road and the road it joins, the two
    # carriageways where a divided road begins): there they belong together, and the traffic takes the stretch as part of the
    # junction. A short piece of a main road used to be narrowed to nothing by the slip road running into it.
    kk, kw, kx, ky = [], [], [], []
    for k in np.flatnonzero(np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~is_area):
        c = shapely.get_coordinates(R_GEOM[k])
        kk.append(_vkeys(c)); kw.append(np.full(len(c), k)); kx.append(c[:, 0]); ky.append(c[:, 1])
    kk, kw, kx, ky = np.concatenate(kk), np.concatenate(kw), np.concatenate(kx), np.concatenate(ky)
    o = np.argsort(kk, kind="stable"); kk, kw, kx, ky = kk[o], kw[o], kx[o], ky[o]
    cut_ = np.flatnonzero(np.diff(kk)) + 1
    st_ = np.concatenate([[0], cut_]); en_ = np.concatenate([cut_, [len(kk)]])
    meet = {}
    for s0, s1 in zip(st_[en_ - st_ >= 2].tolist(), en_[en_ - st_ >= 2].tolist()):
        ws = np.unique(kw[s0:s1]).tolist()
        if len(ws) >= 2:
            for x in ws:
                for y in ws:
                    if x != y:
                        meet.setdefault((x, y), []).append((kx[s0], ky[s0]))
    am, bm = a[m], b[m]
    pk = I[am].astype(np.int64) * 1_000_000 + I[bm]
    o = np.argsort(pk, kind="stable")
    upk, ust = np.unique(pk[o], return_index=True)
    uen = np.concatenate([ust[1:], [len(o)]])
    apart = np.ones(len(am), bool)
    for u, key in enumerate(upk.tolist()):
        lst = meet.get((key // 1_000_000, key % 1_000_000))
        if lst:
            idx = o[ust[u]:uen[u]]
            for x, y in lst:
                apart[idx] &= np.hypot(P[am[idx], 0] - x, P[am[idx], 1] - y) >= 60.0
    np.minimum.at(best, am[apart], (got / ha)[m][apart])
    # only a way that runs beside another for most of its length (the other carriageway; not a ramp that merges into it)
    WD = W.copy()
    n = 0
    order = np.argsort(I, kind="stable")
    cut = np.flatnonzero(np.diff(I[order])) + 1
    for grp in np.split(order, cut):
        v = best[grp]; f = np.isfinite(v)
        if f.sum() >= 3 and f.mean() >= 0.5:
            i_ = int(I[grp[0]])
            # (never less than its lanes need: where the room is short even of that, the lines were left closer than
            #  14_spread_roads.py wanted, and the lanes are sorted out station by station in 37_traffic.py)
            w = max(min(W[i_], WNEED[i_]), W[i_] * float(np.median(v[f])))
            if w < WD[i_] - 0.2:
                WD[i_] = w; n += 1
    log("carriageways narrowed to fit beside their neighbour:", n)
    return WD


WD = parallel_widths()
W = WD
import pickle
pickle.dump([dict(i=int(i_), xyz=xyz.astype(np.float32), cls=int(cls[i_]), w=float(WD[i_]), main=bool(m)) for i_, xyz, m in DECK_PARTS], open(os.path.join(WORK, "decks.pkl"), "wb"))
# road attributes as classified here, for the traffic graph (37_traffic.py)
pickle.dump(dict(cls=cls, W=W, WD=WD, SW=SW, lanes=lanes, oneway=oneway, bridge=bridge, tunnel=tunnel, lowbr=LOWBR, deck=DECK, area=is_area, layer=layer,
                 Wn=WN, nlf=NLF, nlb=NLB, ltag=LTAG,
                 rev=np.array([t.get("oneway") == "-1" for t in rt])), open(os.path.join(WORK, "roads_attr.pkl"), "wb"))
DECK_TREE = shapely.STRtree(DECK_GEOM) if len(DECK_GEOM) else None
log("decks", len(DECK_PARTS), f"{sum(shapely.length(DECK_GEOM)) / 1e3:.0f} km; hung spans {sum(p[2] for p in DECK_PARTS)}; max height {max((p[1][:, 2].max() for p in DECK_PARTS), default=0):.0f} m")
for i_, xyz, m in DECK_PARTS:
    if m:
        log("  hung span", int(roads.osm_id.values[i_]), hw[i_], f"{np.hypot(*np.diff(xyz[:, :2], axis=0).T).sum():.0f} m at {xyz[:, 2].min():.1f}..{xyz[:, 2].max():.1f}")
log("roads", len(roads), "vehicular at grade", int(VEH.sum()), "bridges", int(bridge.sum()), "tunnels", int(tunnel.sum()))

rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring")
OUTER = rings.geometry[3].buffer(2500); shapely.prepare(OUTER)

water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
wt = [json.loads(t) for t in water["tags"].values]
wm = np.array([not (t.get("tunnel") not in (None, "no") or t.get("covered") == "yes" or t.get("intermittent") == "yes" or t.get("leisure") == "swimming_pool" and False) for t in wt])
WATER_G = shapely.make_valid(project_geoms(water.geometry.values[wm]))
WATER_TREE = shapely.STRtree(WATER_G)
wl = gpd.read_parquet(os.path.join(WORK, "osm_waterlines.parquet"))
wlt = [json.loads(t) for t in wl["tags"].values]
wlk = np.array([not (t.get("tunnel") not in (None, "no") or t.get("intermittent") == "yes") for t in wlt]) & np.isin(wl.waterway.values, ["river", "canal", "stream", "drain", "ditch"])
ww = np.array([num(t.get("width")) for t in wlt])
dflt = pd.Series(wl.waterway.values).map({"river": 22.0, "canal": 12.0, "stream": 5.0, "drain": 3.0, "ditch": 2.0}).values
WL_W = np.where(np.isfinite(ww) & (ww > 0.5) & (ww < 300), ww, dflt)[wlk] / 2
WL_G = project_geoms(wl.geometry.values[wlk])
WL_TREE = shapely.STRtree(WL_G)
log("water polys", len(WATER_G), "water lines", len(WL_G))

rails = gpd.read_parquet(os.path.join(WORK, "osm_rails.parquet"))
rlt = [json.loads(t) for t in rails["tags"].values]
rl_ok = np.isin(rails.railway.values, ["rail", "light_rail", "tram", "narrow_gauge", "subway"]) & np.array(
    [t.get("tunnel") in (None, "no") and t.get("bridge") in (None, "no") and (num(t.get("layer")) if t.get("layer") else 0) >= 0 and t.get("location") != "underground" for t in rlt])
RAIL_G = project_geoms(rails.geometry.values[rl_ok])
RAIL_TREE = shapely.STRtree(RAIL_G)

areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
A_GEOM = shapely.make_valid(project_geoms(areas.geometry.values))
A_KINDS = areas.kinds.values
LU = {  # kind -> land-use code (rasterised in this order: later wins)
    "landuse=farmland": 6, "landuse=orchard": 6, "landuse=allotments": 6, "landuse=plant_nursery": 6, "landuse=greenhouse_horticulture": 6, "landuse=aquaculture": 6,
    "landuse=residential": 2, "landuse=commercial": 3, "landuse=retail": 3, "landuse=industrial": 4, "landuse=port": 4, "landuse=harbour": 4, "landuse=military": 5,
    "landuse=education": 5, "landuse=institutional": 5, "amenity=university": 5, "amenity=school": 5, "amenity=college": 5, "amenity=hospital": 5, "amenity=kindergarten": 5,
    "landuse=construction": 8, "landuse=brownfield": 8, "landuse=landfill": 8, "landuse=railway": 9, "landuse=cemetery": 11,
    "landuse=forest": 7, "natural=wood": 7, "leisure=park": 1, "leisure=garden": 1, "landuse=recreation_ground": 1, "landuse=village_green": 1, "tourism=zoo": 1, "tourism=theme_park": 1,
    "leisure=golf_course": 12, "aeroway=aerodrome": 14, "aeroway=apron": 14, "aeroway=runway": 14, "aeroway=taxiway": 14,
    "amenity=parking": 13, "leisure=stadium": 10, "leisure=sports_centre": 10, "leisure=pitch": 10, "leisure=track": 10, "place=square": 15,
}
LU_ORDER = list(LU)
a_lu = np.zeros(len(areas), np.uint8); a_ord = np.full(len(areas), 999)
for i, ks in enumerate(A_KINDS):
    for k in ks.split(";"):
        if k in LU:
            o = LU_ORDER.index(k)
            if a_ord[i] == 999 or o > a_ord[i]:
                a_ord[i] = o; a_lu[i] = LU[k]
# cover overrides from OSM
COVER_OV = {"landuse=grass": 1, "landuse=meadow": 1, "natural=grassland": 1, "leisure=garden": 0, "landuse=forest": 2, "natural=wood": 2, "natural=scrub": 3, "leisure=pitch": 8, "natural=sand": 9,
            "natural=beach": 9, "natural=wetland": 7, "leisure=golf_course": 1, "landuse=village_green": 1}
a_cov = np.full(len(areas), 255, np.uint8)
for i, ks in enumerate(A_KINDS):
    for k in ks.split(";"):
        if k in COVER_OV and COVER_OV[k]:
            a_cov[i] = COVER_OV[k]
ped_area = np.array([("highway=pedestrian_area" in ks or "highway=footway_area" in ks or "place=square" in ks or "highway=living_street_area" in ks or "highway=service_area" in ks
                      or "highway=residential_area" in ks or "man_made=pier" in ks or "highway=path_area" in ks or "highway=steps_area" in ks) for ks in A_KINDS])
bridge_area = np.array(["man_made=bridge" in ks for ks in A_KINDS])
AREA_TREE = shapely.STRtree(A_GEOM)
log("areas", len(areas), "with land use", int((a_lu > 0).sum()), "pedestrian areas", int(ped_area.sum()))

SINO = None
SINO_MAP = np.zeros(256, np.uint8)   # SinoLC class -> cover
for k, v in {1: 0, 2: 2, 3: 3, 4: 1, 5: 4, 6: 0, 7: 5, 8: 0, 9: 6, 10: 7, 11: 1}.items():
    SINO_MAP[k] = v

for d in ("ground", "landcover", "roads", "bridges"):
    os.makedirs(os.path.join(WORK, "sections", d), exist_ok=True)


def clean(g, box, tol=0.12, min_area=1.5):
    g = shapely.intersection(g, box)
    if g.is_empty:
        return []
    g = shapely.simplify(g, tol, preserve_topology=True)
    out = []
    for p in polys_of(shapely.make_valid(g)):
        if p.area < min_area:
            continue
        holes = [h for h in p.interiors if shapely.Polygon(h).area >= 1.0]
        out.append(shapely.geometry.polygon.orient(shapely.Polygon(p.exterior, holes)))
    return out


def do_tile(ij):
    global SINO
    i, j = ij
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    box = shapely.box(ox, oy, ox + TILE, oy + TILE)
    M = 70.0
    boxm = shapely.box(ox - M, oy - M, ox + TILE + M, oy + TILE + M)
    clipbox = shapely.box(ox - M - 40, oy - M - 40, ox + TILE + M + 40, oy + TILE + M + 40)
    name = f"{i}_{j}.bin"
    stats = {}
    # ---------------- roads
    ridx = ROAD_TREE.query(boxm)
    ridx = ridx[np.argsort(ridx)]
    veh = ridx[VEH[ridx]]
    empty = shapely.Polygon()
    roadway = median = sidewalk = plaza = bridge_deck = empty
    if len(veh):
        lines = shapely.intersection(R_GEOM[veh], clipbox)
        bufs = shapely.buffer(lines, W[veh] / 2, quad_segs=3)
        roadway = shapely.union_all(bufs)
        brm = LOWBR[veh]
        bridge_deck = shapely.union_all(shapely.buffer(lines[brm], W[veh][brm] / 2 + SW[veh][brm] + 0.3, cap_style="flat", quad_segs=2)) if brm.any() else empty
        # corner radii + medians from a morphological closing of the wider roads
        major = cls[veh] <= 5
        if major.any():
            rm = shapely.union_all(bufs[major])
            R = 4.5
            closed = shapely.buffer(shapely.buffer(rm, R, quad_segs=3), -R, quad_segs=3)
            extra = shapely.difference(closed, roadway)
            fil, med = [], []
            for p in polys_of(extra):
                a = p.area
                if a < 0.6:
                    continue
                # long thin gaps between carriageways are medians; compact bits are corner fillets
                (med if a > 55 and p.length > 60 else fil).append(p)
            if fil:
                roadway = shapely.union_all([roadway] + fil)
            if med:
                median = shapely.union_all(med)
        sw = SW[veh].copy()
        inner = shapely.intersects(OUTER, lines)
        sw[(cls[veh] == 5) & ~inner] = 0.0
        if (sw > 0).any():
            sb = shapely.union_all(shapely.buffer(lines[sw > 0], W[veh][sw > 0] / 2 + sw[sw > 0], quad_segs=3))
            sidewalk = shapely.difference(sb, shapely.union_all([roadway, median]))
    # ---------------- water
    wparts = list(shapely.intersection(WATER_G[WATER_TREE.query(boxm)], boxm))
    wi = WL_TREE.query(boxm)
    if len(wi):
        wparts += list(shapely.buffer(shapely.intersection(WL_G[wi], clipbox), WL_W[wi], cap_style="flat", quad_segs=2))
    wparts = [g for g in wparts if not g.is_empty]
    waterp = shapely.union_all(wparts) if wparts else empty
    # low bridges span the water: open the water polygon under their decks
    pedbr = ridx[PED[ridx] & LOWBR[ridx]]
    if len(pedbr):
        pb = shapely.union_all(shapely.buffer(shapely.intersection(R_GEOM[pedbr], clipbox), W[pedbr] / 2 + 0.3, cap_style="flat", quad_segs=2))
        bridge_deck = shapely.union_all([bridge_deck, pb]) if not bridge_deck.is_empty else pb
    if not bridge_deck.is_empty and not waterp.is_empty:
        waterp = shapely.difference(waterp, bridge_deck)
    # ---------------- pedestrian paving
    pparts = []
    ped = ridx[PED[ridx]]
    if len(ped):
        pparts += list(shapely.buffer(shapely.intersection(R_GEOM[ped], clipbox), W[ped] / 2, quad_segs=2))
    aidx = AREA_TREE.query(boxm)
    pa = aidx[ped_area[aidx]]
    if len(pa):
        pparts += list(shapely.intersection(A_GEOM[pa], boxm))
    pparts = [g for g in pparts if not g.is_empty and g.geom_type in ("Polygon", "MultiPolygon")]
    if pparts:
        plaza = shapely.union_all(pparts)
    # ---------------- rail bed
    rli = RAIL_TREE.query(boxm)
    rail = shapely.union_all(shapely.buffer(shapely.intersection(RAIL_G[rli], clipbox), 2.3, cap_style="flat", quad_segs=2)) if len(rli) else empty
    # ---------------- priorities: water > roadway > median > sidewalk > plaza > rail > block
    roadway = shapely.difference(roadway, waterp) if not waterp.is_empty and not roadway.is_empty else roadway
    if not sidewalk.is_empty and not waterp.is_empty:
        sidewalk = shapely.difference(sidewalk, waterp)
    if not median.is_empty and not waterp.is_empty:
        median = shapely.difference(median, waterp)
    taken = shapely.union_all([g for g in (roadway, median, sidewalk, waterp) if not g.is_empty]) if any(not g.is_empty for g in (roadway, median, sidewalk, waterp)) else empty
    if not plaza.is_empty:
        plaza = shapely.difference(plaza, taken) if not taken.is_empty else plaza
        taken = shapely.union_all([taken, plaza]) if not taken.is_empty else plaza
    if not rail.is_empty:
        rail = shapely.difference(rail, taken) if not taken.is_empty else rail
        taken = shapely.union_all([taken, rail]) if not taken.is_empty else rail
    block = shapely.difference(box, taken) if not taken.is_empty else box
    polys, classes = [], []
    for g, c, tol in ((roadway, 1, 0.12), (sidewalk, 2, 0.12), (median, 3, 0.15), (waterp, 4, 0.35), (plaza, 5, 0.15), (rail, 8, 0.3), (block, 20, 0.12)):
        ps = clean(g, box, tol) if not g.is_empty else []
        polys += ps; classes += [c] * len(ps)
        stats[c] = round(sum(p.area for p in ps))
    open(os.path.join(WORK, "sections", "ground", name), "wb").write(encode_polys(polys, classes, ox, oy))

    # ---------------- land-cover raster
    if SINO is None:
        SINO = rasterio.open(SINOLC)
    dst = np.zeros((NPX, NPX), np.uint8)
    tr = from_origin(ox, oy + TILE, RES, RES)
    lon0, lat0 = to_lonlat(ox - 30, oy - 30); lon1, lat1 = to_lonlat(ox + TILE + 30, oy + TILE + 30)
    try:
        win = rasterio.windows.from_bounds(float(lon0), float(lat0), float(lon1), float(lat1), SINO.transform).round_offsets().round_lengths()
        src = SINO.read(1, window=win, boundless=True, fill_value=0)
        rasterio.warp.reproject(src, dst, src_transform=SINO.window_transform(win), src_crs=SINO.crs, dst_transform=tr, dst_crs=PROJ_LOCAL, resampling=rasterio.warp.Resampling.mode)
    except Exception as e:  # outside the raster
        stats["raster_err"] = repr(e)[:80]
    cover = SINO_MAP[dst]
    lu_shapes = sorted([(a_ord[k], A_GEOM[k], int(a_lu[k])) for k in aidx if a_lu[k] > 0], key=lambda t: t[0])
    lu = np.zeros((NPX, NPX), np.uint8)
    if lu_shapes:
        lu = rasterio.features.rasterize([(g, v) for _, g, v in lu_shapes], out_shape=(NPX, NPX), transform=tr, fill=0, dtype="uint8")
    cov_shapes = [(A_GEOM[k], int(a_cov[k])) for k in aidx if a_cov[k] != 255]
    if cov_shapes:
        ov = rasterio.features.rasterize(cov_shapes, out_shape=(NPX, NPX), transform=tr, fill=255, dtype="uint8")
        cover = np.where(ov != 255, ov, cover)
    # tree / shrub pixels inside mapped lawns stay trees; lawns override plain paving only
    raster = (cover & 15) | (lu << 4)
    open(os.path.join(WORK, "sections", "landcover", name), "wb").write(struct.pack("<II", NPX, NPX) + np.ascontiguousarray(raster[::-1]).tobytes())   # row 0 = south
    stats["green"] = float(((cover >= 1) & (cover <= 4)).mean())

    # ---------------- road centre lines (inside the tile) for markings / traffic / bridges
    keep = ridx[(cls[ridx] >= 0) & ~tunnel[ridx] & ~is_area[ridx] & (cls[ridx] != 9)]
    if len(keep):
        segs = shapely.intersection(R_GEOM[keep], box)
        L, a_cls, a_w, a_ln, a_fl, a_ly = [], [], [], [], [], []
        for k, g in zip(keep, segs):
            for part in (g.geoms if hasattr(g, "geoms") else [g]):
                if part.geom_type != "LineString" or part.length < 1.0:
                    continue
                # (the streets keep every vertex: junctions are found where lines share one)
                L.append(part if cls[k] <= 5 or cls[k] == 11 else shapely.simplify(part, 0.15)); a_cls.append(int(cls[k]) if cls[k] != 11 else 11 + 16 * max(0, int(link_parent[k])))
                a_w.append(int(np.clip(round(W[k] * 4), 1, 255)))
                nl = NLF[k] + NLB[k] if NLF[k] > 0 else (lanes[k] if np.isfinite(lanes[k]) else 0)      # (the lanes as the traffic has them)
                a_ln.append(int(np.clip(nl, 0, 15)))
                a_fl.append((1 if oneway[k] else 0) | (2 if bridge[k] else 0) | (4 if SW[k] > 0 else 0) | (8 if k % 2 else 0))   # 8: kerb where cars park
                a_ly.append(int(np.clip(layer[k] + 8, 0, 15)))
        if L:
            open(os.path.join(WORK, "sections", "roads", name), "wb").write(encode_lines(L, [a_cls, a_w, a_ln, a_fl, a_ly], ox, oy, 5))
    # ---------------- decks crossing this tile (3D lines)
    if DECK_TREE is not None:
        di = DECK_TREE.query(box)
        if len(di):
            L3, a_cls, a_w = [], [], []
            for k in di:
                i0, xyz, hung = DECK_PARTS[k]
                for cc in clip_line_box(xyz, ox, oy, ox + TILE, oy + TILE):
                    if np.hypot(*np.diff(cc[:, :2], axis=0).T).sum() < 0.5:
                        continue
                    L3.append(cc); a_cls.append(int(cls[i0]) | (64 if hung else 0) | (0 if oneway[i0] else 128)); a_w.append(int(np.clip(round(WD[i0] * 4), 1, 255)))
            if L3:
                open(os.path.join(WORK, "sections", "bridges", name), "wb").write(encode_lines_z(L3, [a_cls, a_w], ox, oy, 2))
    return ij, stats


if __name__ == "__main__":
    todo = [(i, j) for i in range(RANGE[0], RANGE[2]) for j in range(RANGE[1], RANGE[3])]
    log("tiles", len(todo))
    allstats = {}
    with get_context("fork").Pool(PROCS) as pool:
        for n, (ij, st) in enumerate(pool.imap_unordered(do_tile, todo, chunksize=4)):
            allstats[f"{ij[0]}_{ij[1]}"] = st
            if (n + 1) % 400 == 0:
                log(n + 1, "tiles")
    json.dump(allstats, open(os.path.join(WORK, "ground_stats.json"), "w"))
    tot = {}
    for st in allstats.values():
        for k, v in st.items():
            if isinstance(v, (int, float)) and k != "green":
                tot[k] = tot.get(k, 0) + v
    log("area by class (km2):", {k: round(v / 1e6, 1) for k, v in tot.items()})
