"""Street-level ground, 2m land-cover raster (OSM + DEM mountain vegetation/cliff rock),
road centerlines, and elevated decks (with hero-bridge corridor suppression).

Vector ground polygons:
  1 roadway, 2 sidewalk, 3 median, 4 water, 5 pedestrian paving (plazas/stairs), 8 rail bed, 20 block interior.
Land-cover raster (2 m, row 0 = south):
  low nibble = cover (0 paved, 1 grass, 2 under trees, 3 shrubs, 4 crops, 5 bare soil/cliff, 6 water, 7 wetland, 8 pitch, 9 sand)
  high nibble = land use (0 none, 1 park, 2 residential, 3 commercial, 4 industrial, 5 campus, 6 farmland, 7 forest,
                          8 construction, 9 railway, 10 sport, 11 cemetery, 12 golf, 13 parking, 14 airfield, 15 plaza)

usage: 31_build_ground.py <work_dir> [i0 j0 i1 j1]
"""
import sys, os, json, time, struct, re, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
os.environ.setdefault("GDAL_CACHEMAX", "256")
import rasterio.features
from rasterio.transform import from_origin
from scipy import ndimage
from multiprocessing import get_context
from common import *
from tilefmt import encode_polys, encode_lines, encode_lines_z, clip_line_box
from lanes import road_lanes

WORK = sys.argv[1]
RANGE = [int(v) for v in sys.argv[2:6]] if len(sys.argv) >= 6 else [0, 0, GRID_NX, GRID_NY]
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


# ================================================================ Load & classify roads
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
rt = [json.loads(t) for t in roads["tags"].values]
hw = roads.highway.values
R_GEOM = project_geoms(roads.geometry.values)
tg = lambda k: np.array([t.get(k) for t in rt], dtype=object)
bridge = np.array([t.get("bridge") not in (None, "no") for t in rt])
layer = np.nan_to_num(np.array([num(t.get("layer")) for t in rt]), nan=0).astype(int)
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

W = np.zeros(len(roads))
ln = lanes
dfl = lambda a, b: np.where(np.isfinite(ln), ln, np.where(oneway, a, b))
W[cls == 0] = dfl(3, 6)[cls == 0] * 3.75 + 1.5
W[cls == 1] = dfl(3, 6)[cls == 1] * 3.5 + 1.2
W[cls == 2] = np.where(oneway, dfl(3, 3) * 3.3 + 3.0, dfl(4, 4) * 3.3 + 5.0)[cls == 2]
W[cls == 3] = np.where(oneway, dfl(2, 2) * 3.3 + 2.6, dfl(4, 4) * 3.2 + 4.4)[cls == 3]
W[cls == 4] = np.where(oneway, dfl(2, 2) * 3.2 + 2.2, dfl(2, 2) * 3.3 + 4.0)[cls == 4]
W[cls == 5] = np.where(np.isfinite(ln) & (ln >= 2), np.minimum(ln, 4) * 3.1 + 1.0, 6.0)[cls == 5]
W[cls == 6] = 4.6
W[cls == 7] = np.where(np.isin(service_kind, ["driveway", "alley", "parking_aisle"]), 3.4, 4.4)[cls == 7]
W[cls == 8] = 8.5
W[cls == 9] = np.where(hw == "steps", 3.2, 2.4)[cls == 9]
W[cls == 10] = 3.0
W[cls == 11] = np.where(np.isfinite(ln), ln, 1.4)[cls == 11] * 3.6 + 1.6
ok_w = np.isfinite(width_t) & (width_t > 1.5) & (width_t < 60)
W = np.where(ok_w & (cls >= 0), np.clip(width_t, W * 0.5, W * 2.2), W)

_LM = road_lanes(hw, rt)
NLF, NLB, LTAG = _LM["nf"], _LM["nb"], _LM["tagged"]
WNEED = np.where(cls == 5, np.where(oneway, 3.6, 5.8), _LM["wneed"])
W = np.where(_LM["wneed"] > 0, np.maximum(W, _LM["wneed"]), W)
WN = W.copy()

sidewalk_of = {2: 4.0, 3: 3.6, 4: 3.0, 5: 2.0}
SW = np.array([sidewalk_of.get(c, 0.0) for c in cls])
SW = np.where((cls == 11) & np.isin(link_parent, [2, 3, 4]), 2.6, SW)
ped_skip = (cls == 9) & (np.isin(footway_kind, ["sidewalk", "crossing", "traffic_island", "access_aisle"]) | ((hw != "steps") & (shapely.length(R_GEOM) < 20)))

RLEN = shapely.length(R_GEOM)


def _vkeys(c):
    return (np.round(c[:, 0] * 20).astype(np.int64) + 4_000_000) * 8_000_000 + (np.round(c[:, 1] * 20).astype(np.int64) + 4_000_000)


atgrade = (cls >= 0) & ~bridge & ~tunnel
_gk = np.unique(_vkeys(shapely.get_coordinates(R_GEOM[atgrade])))
_e0 = np.isin(_vkeys(shapely.get_coordinates(shapely.get_point(R_GEOM, 0))), _gk)
_e1 = np.isin(_vkeys(shapely.get_coordinates(shapely.get_point(R_GEOM, -1))), _gk)
FLY = roads["fly"].values.astype(int) if "fly" in roads.columns else np.zeros(len(roads), int)
LOWBR = bridge & (layer <= 1) & (RLEN < 180) & ~np.isin(cls, [0, 11]) & ((_e0 & _e1) | ~np.isin(cls, [1, 2, 3, 4, 5])) & (FLY == 0)

# Hero bridge corridor suppression: suppress ONLY aligned procedural bridge ways inside hero bridge corridors
# (so perpendicular Binjiang viaducts passing UNDER a hero bridge are NEVER suppressed, while circular interchanges suppress all!)
_hb_path = os.path.join(WORK, "hero_bridges.json")
HERO_ZONES = []
if os.path.exists(_hb_path):
    for z in json.load(open(_hb_path)).get("zones", []):
        if z.get("kind") == "circle":
            HERO_ZONES.append(("circle", shapely.Point(z["x"], z["y"]).buffer(float(z["r"]), quad_segs=24), None))
        else:
            p0 = np.array([z["x0"], z["y0"]], dtype=float)
            p1 = np.array([z["x1"], z["y1"]], dtype=float)
            dv = p1 - p0
            L_ = max(float(np.hypot(*dv)), 1e-6)
            u_ = np.array([z.get("ux", dv[0] / L_), z.get("uy", dv[1] / L_)], dtype=float)
            seg = shapely.LineString([tuple(p0 - u_ * 20.0), tuple(p1 + u_ * 20.0)])
            HERO_ZONES.append(("corridor", seg.buffer(float(z["half"]), cap_style="flat"), u_))

in_hero_bridge = np.zeros(len(roads), bool)
if HERO_ZONES:
    b_idx = np.flatnonzero(bridge)
    for idx in b_idx:
        g_ = R_GEOM[idx]
        if g_ is None or g_.is_empty:
            continue
        mp = shapely.line_interpolate_point(g_, 0.5, normalized=True)
        cc = shapely.get_coordinates(g_)
        d_ = cc[-1] - cc[0]
        l_ = float(np.hypot(*d_))
        wdir = d_ / max(l_, 1e-6)
        for zkind, zgeom, zu in HERO_ZONES:
            if not zgeom.contains(mp):
                continue
            if zkind == "circle" or abs(float(wdir @ zu)) >= 0.60:
                in_hero_bridge[idx] = True
                break
log("bridge ways suppressed for hero bridges:", int(in_hero_bridge.sum()))

# Shibati Traditional District: convert narrow residential alley (花街子街) crossing central pedestrian stairs to pedestrian (cls=8)
sb_pt = shapely.Point(-380.8, -688.6)
in_shibati_ped = np.array([(cls[k] == 5) and (not bridge[k]) and (not tunnel[k]) and (R_GEOM[k].distance(sb_pt) < 35.0) for k in range(len(roads))])
if in_shibati_ped.any():
    cls[in_shibati_ped] = 8
    SW[in_shibati_ped] = 0.0
    log("Shibati central pedestrian alley converted from vehicular cls=5 to pedestrian cls=8:", int(in_shibati_ped.sum()))

# Raffles City Chaotianmen podium underpass (陕西路 running underneath podium without OSM tunnel=yes tag -> mark tunnel=True!)
rf_x, rf_y = to_local(106.583483, 29.567763)
rf_pt = shapely.Point(rf_x, rf_y)
in_raffles_tun = np.array([(cls[k] == 4) and (not bridge[k]) and (R_GEOM[k].distance(rf_pt) < 85.0) for k in range(len(roads))])
if in_raffles_tun.any():
    tunnel = tunnel | in_raffles_tun
    log("Raffles City podium underpass ways flagged as tunnel:", int(in_raffles_tun.sum()))

# Suppress elevated deck ramps slicing directly across Hongyadong's lower riverfront facade
# (Jialing Binjiang Rd ways tagged bridge=yes right in front of Hongyadong should sit cleanly at grade!)
hy_box = shapely.box(-40.0, 445.0, 295.0, 645.0)
in_hy_front = np.zeros(len(roads), bool)
b_cand = np.flatnonzero(bridge & ~in_hero_bridge)
if len(b_cand):
    mids_b = shapely.line_interpolate_point(R_GEOM[b_cand], 0.5, normalized=True)
    in_hy_front[b_cand] = shapely.contains(hy_box, mids_b)
if in_hy_front.any():
    LOWBR = LOWBR | in_hy_front
    log("bridge ways flattened to at-grade at Hongyadong frontage:", int(in_hy_front.sum()))

# Compute short 4.0m asphalt apron stubs entering every drivable tunnel mouth so asphalt runs cleanly inside 3D tunnel portals!
# Also record portal coordinates so `solve_decks()` keeps entering ramps FLUSH AT GRADE inside 24m of a tunnel mouth (fixes p01!).
TUNNEL_APRONS = []
PORTAL_XY = []
drv_open = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~tunnel & ~is_area & ~in_hero_bridge & (~bridge | LOWBR)
open_vk = set(np.unique(_vkeys(shapely.get_coordinates(R_GEOM[drv_open]))).tolist()) if drv_open.any() else set()
for k in np.flatnonzero(np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & tunnel & ~is_area):
    c_ = shapely.get_coordinates(R_GEOM[k])
    if len(c_) < 2:
        continue
    for end_i, nxt_i in ((0, 1), (-1, -2)):
        if int(_vkeys(c_[[end_i]])[0]) in open_vk:
            p0 = c_[end_i]
            PORTAL_XY.append((float(p0[0]), float(p0[1])))
            dv = c_[nxt_i] - p0
            L_ = float(np.hypot(*dv))
            if L_ > 0.2:
                p1 = p0 + (dv / L_) * min(4.2, L_)
                TUNNEL_APRONS.append((shapely.LineString([tuple(p0), tuple(p1)]).buffer(float(W[k]) * 0.5, cap_style="flat", quad_segs=2)))
PORTAL_XY = np.asarray(PORTAL_XY, dtype=np.float64) if PORTAL_XY else np.zeros((0, 2), dtype=np.float64)
TUNNEL_APRON_ARR = np.array(TUNNEL_APRONS, dtype=object) if TUNNEL_APRONS else np.zeros(0, dtype=object)
TUNNEL_APRON_TREE = shapely.STRtree(TUNNEL_APRON_ARR) if len(TUNNEL_APRON_ARR) else None
log("tunnel portal asphalt aprons:", len(TUNNEL_APRON_ARR))

VEH = (cls >= 0) & (cls != 8) & (cls != 9) & (~bridge | LOWBR) & ~tunnel & ~is_area & ~in_hero_bridge
PED = ((cls == 8) | ((cls == 9) & ~ped_skip)) & ~tunnel & ~is_area & (~bridge | LOWBR) & ~in_hero_bridge
ROAD_TREE = shapely.STRtree(R_GEOM)

# ================================================================ Elevated decks (TRUE 3D world-Y mountain solver!)
DECK = bridge & ~LOWBR & np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~tunnel & ~is_area & ~in_hero_bridge & ~in_hy_front
SLOPE, KMAX = 0.055, 0.095
KW = np.array([num(t.get("sh3d:ramp")) for t in rt])
RAMP = np.isfinite(KW) & (KW > 0)
KW = np.where(RAMP, KW, SLOPE)
Hw = np.where(DECK, 5.6 * np.clip(layer, 1, 5) + 0.6, 0.0)
TERR_S = TerrainSampler(WORK)


def solve_decks():
    """Solve elevated deck elevations in TRUE 3D WORLD-Y so:
    1) Viaducts bridge smoothly across valleys instead of diving into terrain dips;
    2) Uphill hillside terrain across +-W/2 NEVER pierces through a horizontal deck or ramp!
    3) Densified <= 8m stations prevent chord errors between deckGeom.js & traffic.js.
    Encoded output z is clearance cl = max(0, Y_world - max(terrain(x,y), 0)) in metres."""
    import heapq
    gk = np.unique(_vkeys(shapely.get_coordinates(R_GEOM[atgrade | LOWBR])))
    node_of, nn = {}, 0
    WN_, WC_, WEDGE_MAX_ = {}, {}, {}
    eu, ev, el, ew, end_n, end_k = [], [], [], [], [], []
    for i in np.where(DECK)[0]:
        c = np.asarray(R_GEOM[i].coords)[:, :2]
        c = c[np.concatenate([[True], np.hypot(*np.diff(c, axis=0).T) > 1e-6])]
        if len(c) < 2:
            continue
        sd = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))])
        keys = _vkeys(c)
        # Tight 6m stations so deckGeom.js and traffic.js agree to the centimeter over steep terrain!
        extra = [np.arange(0, sd[-1], 6.0)] if sd[-1] > 8.0 else []
        ss = np.unique(np.concatenate([sd] + extra))
        ids = np.full(len(ss), -1, np.int64)
        for k, o in enumerate(np.searchsorted(ss, sd)):
            nid = node_of.get(int(keys[k]))
            if nid is None:
                nid = node_of[int(keys[k])] = nn
                nn += 1
            ids[o] = nid
        for o in np.where(ids < 0)[0]:
            ids[o] = nn
            nn += 1
        xy = np.column_stack([np.interp(ss, sd, c[:, 0]), np.interp(ss, sd, c[:, 1])])
        # Transverse terrain max across deck full width (+-hw) at BOTH vertices AND segment midpoints so uphill cliff NEVER pierces deck!
        hw_i = float(W[i]) * 0.5 + 0.85
        tang = np.gradient(xy, axis=0)
        tl = np.maximum(np.hypot(tang[:, 0], tang[:, 1]), 1e-6)
        nx_ = -tang[:, 1] / tl; ny_ = tang[:, 0] / tl
        g_max = np.maximum(TERR_S.sample(xy[:, 0], xy[:, 1]), 0.0)
        for f_ in (-1.0, -0.5, 0.5, 1.0):
            g_s = np.maximum(TERR_S.sample(xy[:, 0] + nx_ * hw_i * f_, xy[:, 1] + ny_ * hw_i * f_), 0.0)
            g_max = np.maximum(g_max, g_s)
        if len(xy) >= 2:
            mxy = (xy[:-1] + xy[1:]) * 0.5
            mnx = (nx_[:-1] + nx_[1:]) * 0.5; mny = (ny_[:-1] + ny_[1:]) * 0.5
            ml = np.maximum(np.hypot(mnx, mny), 1e-6); mnx /= ml; mny /= ml
            gm_mid = np.maximum(TERR_S.sample(mxy[:, 0], mxy[:, 1]), 0.0)
            for f_ in (-1.0, -0.5, 0.5, 1.0):
                gm_mid = np.maximum(gm_mid, np.maximum(TERR_S.sample(mxy[:, 0] + mnx * hw_i * f_, mxy[:, 1] + mny * hw_i * f_), 0.0))
            g_max[:-1] = np.maximum(g_max[:-1], gm_mid)
            g_max[1:] = np.maximum(g_max[1:], gm_mid)
        WN_[i] = ids
        WC_[i] = xy
        WEDGE_MAX_[i] = g_max
        eu.extend(ids[:-1])
        ev.extend(ids[1:])
        el.extend(np.diff(ss))
        ew.extend([i] * (len(ss) - 1))
        end_n += [ids[0], ids[-1]]
        end_k += [keys[0], keys[-1]]
    if nn == 0:
        return []
    eu, ev, el, ew = np.asarray(eu), np.asarray(ev), np.asarray(el), np.asarray(ew)
    node_xy = np.zeros((nn, 2), np.float64)
    node_gmax = np.zeros(nn, np.float64)
    for i in WN_:
        ids = WN_[i]; xy = WC_[i]; gm = WEDGE_MAX_[i]
        node_xy[ids] = xy
        np.maximum.at(node_gmax, ids, gm)
    node_gc = np.maximum(TERR_S.sample(node_xy[:, 0], node_xy[:, 1]), 0.0)
    node_gmax = np.maximum(node_gmax, node_gc)

    isg = np.zeros(nn, bool)
    isg[np.asarray(end_n)[np.isin(np.asarray(end_k), gk)]] = True
    # Keep deck ramp toes entering a tunnel portal strictly AT GRADE (cl=0) within 26m of the portal mouth
    # so concrete/sandstone ramp abutment wedges NEVER slice across tunnel bores (e.g. Shihuang Tunnel p01 way 38631)!
    if len(PORTAL_XY):
        from scipy.spatial import cKDTree
        ptree = cKDTree(PORTAL_XY)
        dp_all, _ = ptree.query(node_xy, distance_upper_bound=26.0)
        # First measure distance from any existing ground node
        d_tmp = np.full(nn, np.inf)
        d_tmp[isg] = 0.0
        adj_tmp = [[] for _ in range(nn)]
        for u_, v_, l_ in zip(eu.tolist(), ev.tolist(), el.tolist()):
            adj_tmp[u_].append((v_, l_)); adj_tmp[v_].append((u_, l_))
        hq0 = [(0.0, int(n_)) for n_ in np.where(isg)[0]]
        heapq.heapify(hq0)
        while hq0:
            dd_, nn_ = heapq.heappop(hq0)
            if dd_ > d_tmp[nn_] + 1e-9 or dd_ > 32.0:
                continue
            for nb_, ln_ in adj_tmp[nn_]:
                if dd_ + ln_ < d_tmp[nb_] - 1e-9:
                    d_tmp[nb_] = dd_ + ln_
                    heapq.heappush(hq0, (dd_ + ln_, nb_))
        near_portal_ramp = (dp_all < 24.0) & (d_tmp < 26.0)
        if near_portal_ramp.any():
            isg |= near_portal_ramp
            log(f"flattened {int(near_portal_ramp.sum())} deck ramp vertices at tunnel portal mouths to at-grade")
    plat_cl = np.zeros(nn)
    np.maximum.at(plat_cl, eu, Hw[ew])
    np.maximum.at(plat_cl, ev, Hw[ew])

    adj = [[] for _ in range(nn)]
    adjw = [[] for _ in range(nn)]
    for u, v, l, w_ in zip(eu.tolist(), ev.tolist(), el.tolist(), ew.tolist()):
        adj[u].append((v, l))
        adj[v].append((u, l))
        adjw[u].append(w_)
        adjw[v].append(w_)

    # Distance along deck graph from nearest ground connection `isg` (for clean ramp transition into ground)
    dist_g = np.full(nn, np.inf)
    dist_g[isg] = 0.0
    hq = [(0.0, int(n)) for n in np.where(isg)[0]]
    heapq.heapify(hq)
    while hq:
        d_, n = heapq.heappop(hq)
        if d_ > dist_g[n] + 1e-9:
            continue
        for nb, ln_ in adj[n]:
            cand = d_ + ln_
            if cand < dist_g[nb] - 1e-9:
                dist_g[nb] = cand
                heapq.heappush(hq, (cand, nb))

    # True 3D world-Y floor:
    #  - Ground endpoints sit flush at node_gc
    #  - Elevated nodes clear BOTH crossed roads (node_gc + plat_cl) AND uphill hillside edges (node_gmax + 1.8m)
    ramp_t = np.clip(dist_g / 14.0, 0.0, 1.0)
    Y_hill = np.where(isg, node_gc, node_gmax + 0.85 + 1.05 * ramp_t)
    Y_target = np.where(isg, node_gc, np.maximum(Y_hill, node_gc + plat_cl * np.clip(dist_g / 45.0, 0.25, 1.0)))
    # Upper grade envelope from ground endpoints (so ramps climb realistically from ground without giant vertical steps!)
    capw = lambda w_: max(float(KW[w_]) if RAMP[w_] else KMAX, 0.11)
    U = np.full(nn, np.inf)
    U[isg] = node_gc[isg]
    heap = [(float(U[n]), int(n)) for n in np.where(isg)[0]]
    heapq.heapify(heap)
    while heap:
        u_y, n = heapq.heappop(heap)
        if u_y > U[n] + 1e-9:
            continue
        for (nb, ln_), w_ in zip(adj[n], adjw[n]):
            cand = u_y + capw(w_) * ln_
            if cand < U[nb] - 1e-9:
                U[nb] = cand
                heapq.heappush(heap, (cand, nb))

    # Lower smooth-bridge envelope in TRUE world-Y: prevents viaducts from diving down into valleys!
    L = np.where(isg, node_gc, np.minimum(Y_target, U))
    # Guarantee uphill hillside clearance EVERYWHERE off ground!
    L = np.where(isg, node_gc, np.maximum(L, Y_hill))
    heap = [(-float(L[n]), n) for n in range(nn) if not isg[n]]
    heapq.heapify(heap)
    while heap:
        negl, n = heapq.heappop(heap)
        if -negl < L[n] - 1e-9:
            continue
        for nb, ln_ in adj[n]:
            cand = L[n] - SLOPE * ln_
            if not isg[nb] and cand > L[nb] + 1e-9:
                L[nb] = cand
                heapq.heappush(heap, (-cand, nb))

    Y = np.where(isg, node_gc, np.maximum(np.minimum(L, np.maximum(U, Y_hill)), Y_hill))
    # Smooth degree-2 interior vertices in TRUE 3D WORLD-Y (never violating uphill hillside clearance!)
    deg2 = np.array([len(a) == 2 for a in adj]) & ~isg
    n1 = np.array([a[0][0] if len(a) == 2 else 0 for a in adj])
    n2 = np.array([a[1][0] if len(a) == 2 else 0 for a in adj])
    l1 = np.array([a[0][1] if len(a) == 2 else 1.0 for a in adj])
    l2 = np.array([a[1][1] if len(a) == 2 else 1.0 for a in adj])
    for _ in range(8):
        Y_sm = np.where(deg2, 0.5 * Y + 0.5 * (Y[n1] * l2 + Y[n2] * l1) / np.maximum(l1 + l2, 1e-6), Y)
        Y = np.where(isg, node_gc, np.maximum(Y_sm, Y_hill))

    # Convert back to clearance above terrain center (u8 * 0.25m supports up to 63.75m!)
    h = np.clip(Y - node_gc, 0.0, 62.5)
    parts = [(i, np.column_stack([WC_[i], h[WN_[i]]]), False) for i in WN_]
    log(f"3D deck graph: {nn} vertices, {len(parts)} ways, max clearance={h.max():.1f}m")
    return parts


DECK_PARTS = solve_decks()
DECK_GEOM = np.array([shapely.LineString(p[1][:, :2]) for p in DECK_PARTS], dtype=object)


def parallel_widths():
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
            d = np.gradient(xyz[:, :2], axis=0)
            d /= np.maximum(np.hypot(*d.T), 1e-9)[:, None]
            P.append(xyz[:, :2]); T.append(d); Z.append(xyz[:, 2]); I.append(np.full(len(xyz), k))
    P, T, Z, I = np.vstack(P), np.vstack(T), np.concatenate(Z), np.concatenate(I)
    tree = cKDTree(P)
    K = 14
    dd, jj = tree.query(P, k=K, distance_upper_bound=24.0, workers=-1)
    best = np.full(len(P), np.inf)
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
    np.minimum.at(best, a[m], (got / ha)[m])
    WD = W.copy()
    n_nar = 0
    order = np.argsort(I, kind="stable")
    cut = np.flatnonzero(np.diff(I[order])) + 1
    for grp in np.split(order, cut):
        v = best[grp]; f = np.isfinite(v)
        if f.sum() >= 3 and f.mean() >= 0.5:
            i_ = int(I[grp[0]])
            w = max(min(W[i_], WNEED[i_]), W[i_] * float(np.median(v[f])))
            if w < WD[i_] - 0.2:
                WD[i_] = w; n_nar += 1
    log("carriageways narrowed beside neighbour:", n_nar)
    return WD


WD = parallel_widths()
W = WD
pickle.dump([dict(i=int(i_), xyz=xyz.astype(np.float32), cls=int(cls[i_]), w=float(WD[i_]), main=bool(m)) for i_, xyz, m in DECK_PARTS], open(os.path.join(WORK, "decks.pkl"), "wb"))
pickle.dump(dict(cls=cls, W=W, WD=WD, SW=SW, lanes=lanes, oneway=oneway, bridge=bridge, tunnel=tunnel, lowbr=LOWBR, deck=DECK, area=is_area, layer=layer,
                 Wn=WN, nlf=NLF, nlb=NLB, ltag=LTAG, in_hero=in_hero_bridge,
                 rev=np.array([t.get("oneway") == "-1" for t in rt])), open(os.path.join(WORK, "roads_attr.pkl"), "wb"))
DECK_TREE = shapely.STRtree(DECK_GEOM) if len(DECK_GEOM) else None

# ================================================================ Water, Rails, Areas, Terrain & Building cover cues
rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring")
OUTER = rings.geometry[3].buffer(1500)
shapely.prepare(OUTER)

water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
wt = [json.loads(t) for t in water["tags"].values]
wm = np.array([not (t.get("tunnel") not in (None, "no") or t.get("covered") == "yes" or t.get("intermittent") == "yes") for t in wt])
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

rails = gpd.read_parquet(os.path.join(WORK, "osm_rails.parquet"))
rlt = [json.loads(t) for t in rails["tags"].values]
rl_ok = np.isin(rails.railway.values, ["rail", "light_rail", "tram", "narrow_gauge", "subway"]) & np.array(
    [t.get("tunnel") in (None, "no") and t.get("bridge") in (None, "no") and (num(t.get("layer")) if t.get("layer") else 0) >= 0 and t.get("location") != "underground" for t in rlt])
RAIL_G = project_geoms(rails.geometry.values[rl_ok])
RAIL_TREE = shapely.STRtree(RAIL_G)

areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
A_GEOM = shapely.make_valid(project_geoms(areas.geometry.values))
A_KINDS = areas.kinds.values
LU = {
    "landuse=farmland": 6, "landuse=orchard": 6, "landuse=allotments": 6, "landuse=plant_nursery": 6,
    "landuse=residential": 2, "landuse=commercial": 3, "landuse=retail": 3, "landuse=industrial": 4, "landuse=port": 4,
    "landuse=education": 5, "landuse=institutional": 5, "amenity=university": 5, "amenity=school": 5, "amenity=college": 5, "amenity=hospital": 5,
    "landuse=construction": 8, "landuse=brownfield": 8, "landuse=railway": 9, "landuse=cemetery": 11,
    "landuse=forest": 7, "natural=wood": 7, "leisure=park": 1, "leisure=garden": 1, "landuse=recreation_ground": 1, "landuse=village_green": 1, "tourism=zoo": 1,
    "leisure=golf_course": 12, "amenity=parking": 13, "leisure=stadium": 10, "leisure=sports_centre": 10, "leisure=pitch": 10, "place=square": 15,
}
LU_ORDER = list(LU)
a_lu = np.zeros(len(areas), np.uint8)
a_ord = np.full(len(areas), 999)
for i, ks in enumerate(A_KINDS):
    for k in ks.split(";"):
        if k in LU:
            o = LU_ORDER.index(k)
            if a_ord[i] == 999 or o > a_ord[i]:
                a_ord[i] = o
                a_lu[i] = LU[k]
COVER_OV = {
    "landuse=grass": 1, "landuse=meadow": 1, "natural=grassland": 1, "landuse=forest": 2, "natural=wood": 2,
    "natural=scrub": 3, "leisure=pitch": 8, "natural=sand": 9, "natural=beach": 9, "natural=wetland": 7,
    "leisure=golf_course": 1, "landuse=village_green": 1, "leisure=park": 2, "leisure=garden": 1,
    "natural=bare_rock": 5, "natural=cliff": 5,
}
a_cov = np.full(len(areas), 255, np.uint8)
for i, ks in enumerate(A_KINDS):
    for k in ks.split(";"):
        if k in COVER_OV:
            a_cov[i] = COVER_OV[k]
ped_area = np.array([
    ("highway=pedestrian_area" in ks or "highway=footway_area" in ks or "place=square" in ks or "highway=living_street_area" in ks
     or "highway=service_area" in ks or "man_made=pier" in ks or "highway=steps_area" in ks)
    for ks in A_KINDS
])
AREA_TREE = shapely.STRtree(A_GEOM)

# Terrain & building footprint map for natural mountain-city vegetation synthesis (Nanshan, Gele Mt, Yuzhong cliffs!)
TERR_META = json.load(open(os.path.join(WORK, "terrain_meta.json")))["fine"]
TERR_FINE = np.load(os.path.join(WORK, "terrain_fine.npy"))
tgy, tgx = np.gradient(TERR_FINE, TERR_META["cell"])
TERR_SLOPE = np.hypot(tgx, tgy).astype(np.float32)  # rise/run (tan theta)

blds = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["geometry"])
B_GEOM = blds.geometry.values
B_TREE = shapely.STRtree(B_GEOM)

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
        if TUNNEL_APRON_TREE is not None:
            tai = TUNNEL_APRON_TREE.query(boxm)
            if len(tai):
                roadway = shapely.union_all([roadway] + list(TUNNEL_APRON_ARR[tai]))
        brm = LOWBR[veh]
        bridge_deck = shapely.union_all(shapely.buffer(lines[brm], W[veh][brm] / 2 + SW[veh][brm] + 0.3, cap_style="flat", quad_segs=2)) if brm.any() else empty
        major = cls[veh] <= 5
        if major.any():
            rm = shapely.union_all(bufs[major])
            R = 4.2
            closed = shapely.buffer(shapely.buffer(rm, R, quad_segs=3), -R, quad_segs=3)
            extra = shapely.difference(closed, roadway)
            fil, med = [], []
            for p in polys_of(extra):
                a = p.area
                if a < 0.6:
                    continue
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
    pedbr = ridx[PED[ridx] & LOWBR[ridx]]
    if len(pedbr):
        pb = shapely.union_all(shapely.buffer(shapely.intersection(R_GEOM[pedbr], clipbox), W[pedbr] / 2 + 0.3, cap_style="flat", quad_segs=2))
        bridge_deck = shapely.union_all([bridge_deck, pb]) if not bridge_deck.is_empty else pb
    if not bridge_deck.is_empty and not waterp.is_empty:
        waterp = shapely.difference(waterp, bridge_deck)

    # ---------------- pedestrian paving (plazas + mountain stairs)
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
        polys += ps
        classes += [c] * len(ps)
        stats[c] = round(sum(p.area for p in ps))
    open(os.path.join(WORK, "sections", "ground", name), "wb").write(encode_polys(polys, classes, ox, oy))

    # ---------------- 2m land-cover raster (OSM landuse + Chongqing subtropical hillside woodland & cliff rock)
    tr = from_origin(ox, oy + TILE, RES, RES)
    # Sample DEM elevation & slope onto 500x500 (row 0 = north for rasterio)
    gx = ox + (np.arange(NPX) + 0.5) * RES
    gy = oy + TILE - (np.arange(NPX) + 0.5) * RES
    ti_ = np.clip(((gx - TERR_META["x0"]) / TERR_META["cell"]).astype(int), 0, TERR_META["nx"] - 1)
    tj_ = np.clip(((gy - TERR_META["y0"]) / TERR_META["cell"]).astype(int), 0, TERR_META["ny"] - 1)
    elev = TERR_FINE[tj_[:, None], ti_[None, :]]
    slp = TERR_SLOPE[tj_[:, None], ti_[None, :]]

    # Building density (dilated 22m = urban footprint): unbuilt hillsides in Chongqing are lush subtropical green forest!
    bi = B_TREE.query(boxm)
    b_pix = np.zeros((NPX, NPX), np.uint8)
    if len(bi):
        b_pix = rasterio.features.rasterize([(g, 1) for g in B_GEOM[bi]], out_shape=(NPX, NPX), transform=tr, fill=0, dtype="uint8")
    urban_halo = ndimage.binary_dilation(b_pix > 0, iterations=12)  # ~24 m around buildings
    road_pix = np.zeros((NPX, NPX), np.uint8)
    if not roadway.is_empty:
        road_pix = rasterio.features.rasterize([(roadway, 1)], out_shape=(NPX, NPX), transform=tr, fill=0, dtype="uint8")
    urban_halo |= ndimage.binary_dilation(road_pix > 0, iterations=6)

    # Default cover: paved (0) in built-up flat urban zones; subtropical trees (2) / grass (1) on unbuilt hills; cliff rock (5) on very steep unbuilt cliffs!
    cover = np.zeros((NPX, NPX), np.uint8)
    unbuilt = ~urban_halo
    cover[unbuilt & (elev > 15.0)] = 2       # lush subtropical mountain forest (Nanshan, Eling, Gele Mt, Yuzhong cliff greenbelts)
    cover[unbuilt & (slp > 0.22)] = 2        # steep green hillsides
    cover[unbuilt & (slp > 0.65)] = 5        # exposed rocky cliff faces
    cover[unbuilt & (elev <= 15.0) & (elev > 0.5)] = 1  # grassy riverbank terraces
    # Residential green courtyards between buildings
    cover[(b_pix == 0) & (road_pix == 0) & (slp > 0.30)] = 2

    lu_shapes = sorted([(a_ord[k], A_GEOM[k], int(a_lu[k])) for k in aidx if a_lu[k] > 0], key=lambda t: t[0])
    lu = np.zeros((NPX, NPX), np.uint8)
    if lu_shapes:
        lu = rasterio.features.rasterize([(g, v) for _, g, v in lu_shapes], out_shape=(NPX, NPX), transform=tr, fill=0, dtype="uint8")
    # Mountain forest landuse where unbuilt high ground (> 140m above river, e.g. Nanshan)
    lu = np.where((lu == 0) & unbuilt & (elev > 130.0), 7, lu)

    cov_shapes = [(A_GEOM[k], int(a_cov[k])) for k in aidx if a_cov[k] != 255]
    if cov_shapes:
        ov = rasterio.features.rasterize(cov_shapes, out_shape=(NPX, NPX), transform=tr, fill=255, dtype="uint8")
        cover = np.where(ov != 255, ov, cover)
    # Water cover
    if not waterp.is_empty:
        wpix = rasterio.features.rasterize([(waterp, 1)], out_shape=(NPX, NPX), transform=tr, fill=0, dtype="uint8")
        cover = np.where(wpix > 0, 6, cover)
    # Residential estates get subtle lawn/tree mix around buildings
    cover = np.where((lu == 2) & (b_pix == 0) & (road_pix == 0) & (cover == 0) & (slp > 0.14), 1, cover)

    raster = (cover & 15) | (lu << 4)
    open(os.path.join(WORK, "sections", "landcover", name), "wb").write(struct.pack("<II", NPX, NPX) + np.ascontiguousarray(raster[::-1]).tobytes())
    stats["green"] = float(((cover >= 1) & (cover <= 4)).mean())

    # ---------------- road centre lines
    keep = ridx[(cls[ridx] >= 0) & ~tunnel[ridx] & ~is_area[ridx] & (cls[ridx] != 9) & ~in_hero_bridge[ridx]]
    if len(keep):
        segs = shapely.intersection(R_GEOM[keep], box)
        L, a_cls, a_w, a_ln, a_fl, a_ly = [], [], [], [], [], []
        for k, g in zip(keep, segs):
            for part in (g.geoms if hasattr(g, "geoms") else [g]):
                if part.geom_type != "LineString" or part.length < 1.0:
                    continue
                L.append(part if cls[k] <= 5 or cls[k] == 11 else shapely.simplify(part, 0.15))
                a_cls.append(int(cls[k]) if cls[k] != 11 else 11 + 16 * max(0, int(link_parent[k])))
                a_w.append(int(np.clip(round(W[k] * 4), 1, 255)))
                nl = NLF[k] + NLB[k] if NLF[k] > 0 else (lanes[k] if np.isfinite(lanes[k]) else 0)
                a_ln.append(int(np.clip(nl, 0, 15)))
                a_fl.append((1 if oneway[k] else 0) | (2 if DECK[k] else 0) | (4 if SW[k] > 0 else 0) | (8 if k % 2 else 0))
                a_ly.append(int(np.clip(layer[k] + 8, 0, 15)))
        if L:
            open(os.path.join(WORK, "sections", "roads", name), "wb").write(encode_lines(L, [a_cls, a_w, a_ln, a_fl, a_ly], ox, oy, 5))

    # ---------------- decks crossing this tile (3D clearance lines)
    if DECK_TREE is not None:
        di = DECK_TREE.query(box)
        if len(di):
            L3, a_cls, a_w = [], [], []
            for k in di:
                i0, xyz, hung = DECK_PARTS[k]
                for cc in clip_line_box(xyz, ox, oy, ox + TILE, oy + TILE):
                    if np.hypot(*np.diff(cc[:, :2], axis=0).T).sum() < 0.5:
                        continue
                    L3.append(cc)
                    a_cls.append(int(cls[i0]) | (64 if hung else 0) | (0 if oneway[i0] else 128))
                    a_w.append(int(np.clip(round(WD[i0] * 4), 1, 255)))
            if L3:
                open(os.path.join(WORK, "sections", "bridges", name), "wb").write(encode_lines_z(L3, [a_cls, a_w], ox, oy, 2))
    return ij, stats


if __name__ == "__main__":
    todo = [(i, j) for i in range(RANGE[0], RANGE[2]) for j in range(RANGE[1], RANGE[3])]
    log("tiles", len(todo), "range", RANGE)
    allstats = {}
    with get_context("fork").Pool(PROCS) as pool:
        for n, (ij, st) in enumerate(pool.imap_unordered(do_tile, todo, chunksize=4)):
            allstats[f"{ij[0]}_{ij[1]}"] = st
            if (n + 1) % 100 == 0:
                log(n + 1, "tiles")
    json.dump(allstats, open(os.path.join(WORK, "ground_stats.json"), "w"))
    tot = {}
    for st in allstats.values():
        for k, v in st.items():
            if isinstance(v, (int, float)) and k != "green":
                tot[k] = tot.get(k, 0) + v
    log("area by class (km2):", {k: round(v / 1e6, 2) for k, v in tot.items()})
