"""Traffic graph for the street-level tiles: the drivable roads cut at their junctions into edges with lanes, heights,
junction control (signals, priority) and stop lines; and the circuits pedestrians walk.

  sections/traffic/<i>_<j>.bin   edges whose middle lies in the tile + the approaches of the junctions inside it
  sections/walks/<i>_<j>.bin     closed walking loops (pavements around blocks, pedestrian streets, park paths)

usage: 37_traffic.py <work_dir> [i0 j0 i1 j1]      (run after 31_build_ground.py, before 39_pack_tiles.py)

Traffic section:  u32 ne, nv, na
  edge[ne] (40 bytes): u32 nodeA, nodeB | u8 cls, flags, nf, nb | u8 lw*20, i8 shift*10, u8 W*4, u8 km/h | u8 trimA*2, trimB*2, stopA*2, stopB*2 |
                       u8 ctrlA, ctrlB, u16 npts | u16 phaseA, phaseB | u32 reachA, reachB | u8 subA, subB, u16 0
     a node may stand for several nodes of the map merged into one junction: sub is the edge end's own one among them, reach the
     set of them (bits) that traffic arriving at that end can get to; a turn is possible if the exit's sub is in the approach's reach
     flags: 1 one way (A -> B), 2 deck, 4 tunnel, 8 cars park on the left kerb (else right), 16 kerb parking, 32 roundabout
     ctrl (traffic arriving at that end): bits 0-1: 0 free, 1 signal, 2 give way | bit 2 signal group | bits 3-5 rank (0 = most major) | bit 6 zebra | bit 7 inside a junction
     lanes: nf with the line, nb against it; lane l (0 = leftmost) is centred at  shift - (l + 0.5) lw  (two-way, with the line; mirrored against it)
            or  shift + (nf / 2 - l - 0.5) lw  (one way); offsets are to the left of the line
  i16 xy[nv] decimetres from the tile's SW corner, per edge: first vertex absolute, then deltas;   i16 z[nv] in 0.05 m
  approach[na] (12 bytes): i16 x, y (node) | u8 bearing (256 = full turn, clockwise from north, pointing away from the node) | u8 ctrl | u16 phase |
                           u8 trim*2, stop*2 | u8 cls | u8 flags (1: traffic arrives along it, 2: traffic leaves along it)
  u32 npaint, nvp     the lanes as they are to be painted: every stretch of lane that runs through the tile (cut at its edge),
  paint[npaint] (12 bytes): u8 flags (1 one way, 2 deck) | u8 nf, nb | u8 lw*20 | i8 shift*10 | u8 cls | u8 W*4 | u8 0 | u16 npts | u16 0
  i16 x, y (dm from the SW corner), z (0.05 m) for each of the nvp vertices
"""
import sys, os, json, pickle, struct, time
import numpy as np, geopandas as gpd, shapely
from multiprocessing import get_context
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from tilefmt import pad4

WORK = sys.argv[1]
RANGE = [int(v) for v in sys.argv[2:6]] if len(sys.argv) >= 6 else [0, 0, GRID_NX, GRID_NY]
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


jsround = lambda v: np.floor(np.asarray(v, float) + 0.5)          # Math.round

roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
A = pickle.load(open(os.path.join(WORK, "roads_attr.pkl"), "rb"))
cls, W0, WD, lanes, oneway, tunnel, lowbr, deck, area, rev = (A[k] for k in ("cls", "W", "WD", "lanes", "oneway", "tunnel", "lowbr", "deck", "area", "rev"))
NLF, NLB, LTAG = A["nlf"], A["nlb"], A["ltag"]            # the lanes of each way as the map has them (lanes.py); 0 where they follow from the width
R_GEOM = project_geoms(roads.geometry.values)
rt = [json.loads(t) for t in roads["tags"].values]
dug = tunnel.copy()                                                    # really under the ground (31_build_ground.py decides; a covered street is not)
in_hero = A.get("in_hero", np.zeros(len(cls), bool))
DRIVE = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~area & ~in_hero
deck_parts = {}
for p in pickle.load(open(os.path.join(WORK, "decks.pkl"), "rb")):
    deck_parts.setdefault(p["i"], []).append(p["xyz"].astype(float))
vkey = lambda c: (np.round(c[:, 0] * 20).astype(np.int64) + 4_000_000) * 8_000_000 + (np.round(c[:, 1] * 20).astype(np.int64) + 4_000_000)
# the low stretches of the decks (a ramp coming down to the street is a wall until it is high enough to walk under)
_lowd, _loww = [], []
for _k, _parts in deck_parts.items():
    for _p in _parts:
        _low = _p[:, 2] < 2.6
        _st = None
        for _q in range(len(_p) + 1):
            if _q < len(_p) and _low[_q]:
                _st = _q if _st is None else _st
            elif _st is not None:
                if _q - _st >= 2:
                    _lowd.append(shapely.LineString(_p[_st:_q, :2])); _loww.append(float(WD[_k]))
                _st = None
LOWD_G = np.array(_lowd, dtype=object); LOWD_W = np.array(_loww)
LOWD_TREE = shapely.STRtree(LOWD_G) if len(LOWD_G) else None

# ================================================================ ways -> vertices with heights
ways = np.flatnonzero(DRIVE)
XYZ = {}
for k in ways:
    c = shapely.get_coordinates(R_GEOM[k])
    z = np.zeros(len(c))
    extra = None
    if deck[k] and k in deck_parts:
        # the deck solver's polyline is this way densified (sometimes in pieces): take its heights by distance along the way
        d = np.vstack(deck_parts[k])
        keep = np.concatenate([[True], np.hypot(*np.diff(d[:, :2], axis=0).T) > 1e-3])
        d = d[keep]
        sd = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(d[:, :2], axis=0).T))])
        s0 = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))])
        if sd[-1] > 1 and abs(sd[-1] - s0[-1]) < max(2.0, 0.02 * s0[-1]):
            sc = s0 * (sd[-1] / max(s0[-1], 1e-6))
            z = np.interp(sc, sd, d[:, 2])
            extra = (sd, d)                      # densified stations, merged in below
    XYZ[k] = (c, z, extra)
log("drivable ways", len(ways))

# junction nodes: vertices shared by ways, and way ends
def tunnel_depth(d):
    """How far under the street a tunnel is, `d` metres in from its portal.
    Phase 4: drops rapidly inside the 6m dark 3D portal vault (`tunnels.js` / `tunnels.json`) so cars drop past
    cl=-1.0m by d=1.2m and cl=-2.6m by d=3.0m — ZERO cars ghost-driving 14.5m over hillsides/grass!"""
    d = np.asarray(d, float)
    return np.minimum(0.88 * np.minimum(d, 3.5) + 0.14 * np.maximum(d - 3.5, 0.0), 6.5)


# how deep a tunnel runs: by the distance to its nearest portal, as for the edges further down (near the portal it is
# beside the street, not under it, and its lanes need their room like any other)
_tw = [k for k in ways if dug[k] and not (deck[k] and k in deck_parts)]
_open = set(np.concatenate([vkey(XYZ[k][0]) for k in ways if not dug[k]]).tolist())
_ends = {k: [int(v) for v in vkey(XYZ[k][0][[0, -1]])] for k in _tw}
_use = {}
for k in _tw:
    for v in _ends[k]:
        _use[v] = _use.get(v, 0) + 1
PD = {v: (0.0 if (v in _open or n_ == 1) else np.inf) for v, n_ in _use.items()}        # (a tunnel that ends in nothing counts as a portal too)
_len = {k: float(np.hypot(*np.diff(XYZ[k][0], axis=0).T).sum()) for k in _tw}
for _ in range(60):
    ch = False
    for k in _tw:
        a_, b_ = _ends[k]
        if PD[b_] + _len[k] < PD[a_] - 1e-6:
            PD[a_] = PD[b_] + _len[k]; ch = True
        if PD[a_] + _len[k] < PD[b_] - 1e-6:
            PD[b_] = PD[a_] + _len[k]; ch = True
    if not ch:
        break

# ================================================================ roads that cross without a junction
# Two ways that cross on the map without a vertex in common are a bridge over a road or a tunnel under one. Where this model
# has both at one level all the same (a short bridge that cannot rise within its length, a tunnel still near the surface by
# its portal), the cars would drive through each other. Such a crossing is made a junction: a vertex is put into both ways
# (a hand's breadth apart, so that they stay two nodes), and further down the two nodes are joined into one give-way junction
# at which each road only carries straight on.
allk = np.concatenate([vkey(XYZ[k][0]) for k in ways])
endk = np.concatenate([vkey(XYZ[k][0][[0, -1]]) for k in ways])
uk, cnt = np.unique(allk, return_counts=True)
NODEK = np.union1d(uk[cnt >= 2], endk)
_wc = {}


def _way(k):
    """(distance along the way at its vertices, the distances of its junction vertices)"""
    r = _wc.get(k)
    if r is None:
        c = XYZ[k][0]
        sc = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))])
        kk = vkey(c)
        isn = NODEK[np.minimum(np.searchsorted(NODEK, kk), len(NODEK) - 1)] == kk
        isn[0] = isn[-1] = True
        r = _wc[k] = (sc, sc[isn])
    return r


def zprof(k, sc):
    """Heights along way k as (distance, height): a deck's own stations where it has them (a bridge that rises and comes down
    again between two vertices on the ground is not flat), else the way's vertices."""
    c, z, extra = XYZ[k]
    if extra is not None:
        sd, d = extra
        return sd * (sc[-1] / max(sd[-1], 1e-6)), d[:, 2]
    return sc, z


def _way_z(k, s_, sc):
    if dug[k] and not (deck[k] and k in deck_parts):
        a_, b_ = _ends[k]
        da_, db_ = (PD[a_] if np.isfinite(PD[a_]) else 80.0), (PD[b_] if np.isfinite(PD[b_]) else 80.0)
        return -float(tunnel_depth(min(da_ + s_, db_ + sc[-1] - s_)))
    sx, zx = zprof(k, sc)
    return float(np.interp(s_, sx, zx))


_G = np.array([shapely.LineString(XYZ[k][0]) if len(XYZ[k][0]) >= 2 else None for k in ways], dtype=object)
_ta, _tb = shapely.STRtree(_G).query(_G, predicate="crosses")
_xkind = lambda k_: "deck" if (deck[k_] and k_ in deck_parts) else "tunnel" if dug[k_] else "low bridge" if lowbr[k_] else "street"
XKINDS = {}
INS = {}          # way -> [(distance along it, x, y)]
XP = []           # the two vertices of a crossing (as coordinates)
NEARX = []        # crossings right next to a junction: (way, where it is crossed, where its junction is, the other road's half width)
for i, j in zip(_ta[_ta < _tb], _tb[_ta < _tb]):
    ka, kb = int(ways[i]), int(ways[j])
    inter = shapely.intersection(_G[i], _G[j])
    for g in getattr(inter, "geoms", [inter]):
        if g.geom_type != "Point":
            continue
        (sca, ja), (scb, jb) = _way(ka), _way(kb)
        sa, sb = float(shapely.line_locate_point(_G[i], g)), float(shapely.line_locate_point(_G[j], g))
        da_, db_ = np.abs(ja - sa), np.abs(jb - sb)
        if da_.min() < 0.3 or db_.min() < 0.3:
            continue                                 # a junction
        za, zb = _way_z(ka, sa, sca), _way_z(kb, sb, scb)
        # (a tunnel by its portal: the cars take its depth from the two ends of a piece of road, which is shallower than the
        #  ramp really is there, so a little more counts as one level)
        if abs(za - zb) >= (2.6 if dug[ka] or dug[kb] else 1.8) or min(za, zb) < -2.7:
            continue                                 # one passes over the other
        ca, cb = XYZ[ka][0], XYZ[kb][0]
        ia, ib = min(np.searchsorted(sca, sa, side="right") - 1, len(ca) - 2), min(np.searchsorted(scb, sb, side="right") - 1, len(cb) - 2)
        ta = (ca[ia + 1] - ca[ia]) / max(np.hypot(*(ca[ia + 1] - ca[ia])), 1e-9); tb = (cb[ib + 1] - cb[ib]) / max(np.hypot(*(cb[ib + 1] - cb[ib])), 1e-9)
        if abs(ta @ tb) > 0.94:
            continue                                 # (two lines running along each other, not a crossing)
        if da_.min() < 12.0 or db_.min() < 12.0:
            # too near a junction to be one of its own: the lanes of the road whose junction it is end before the crossing
            # instead (so that nobody waits at that junction's stop line standing on the other road), and its cars cross the
            # other road as part of their way through the junction
            if da_.min() < 12.0:
                NEARX.append((ka, sa, float(ja[np.argmin(da_)]), float(W0[kb]) / 2))
            if db_.min() < 12.0:
                NEARX.append((kb, sb, float(jb[np.argmin(db_)]), float(W0[ka]) / 2))
            continue
        pa = np.array([g.x, g.y]); pb = pa + 0.15 * tb
        INS.setdefault(ka, []).append((sa, pa[0], pa[1])); INS.setdefault(kb, []).append((sb + 0.15, pb[0], pb[1]))
        XP.append((pa, pb))
        _kd = " x ".join(sorted(_xkind(k_) for k_ in (ka, kb))); XKINDS[_kd] = XKINDS.get(_kd, 0) + 1
for k, lst in INS.items():
    c, z, extra = XYZ[k]
    sc = _way(k)[0]
    lst.sort()
    pos = np.searchsorted(sc, [t[0] for t in lst], side="right")
    XYZ[k] = (np.insert(c, pos, np.array([[t[1], t[2]] for t in lst]), axis=0), np.insert(z, pos, np.interp([t[0] for t in lst], sc, z)), extra)
XK = np.array([int(vkey(np.array([q]))[0]) for pr in XP for q in pr], np.int64).reshape(-1, 2) if XP else np.zeros((0, 2), np.int64)
log("roads crossing at one level without a junction:", len(XP), "; and right beside a junction:", len(NEARX), "; what crosses what:", dict(sorted(XKINDS.items(), key=lambda kv: -kv[1])))
del _G, _wc

# junction nodes: vertices shared by ways, way ends, and the crossings just made
allk = np.concatenate([vkey(XYZ[k][0]) for k in ways])
endk = np.concatenate([vkey(XYZ[k][0][[0, -1]]) for k in ways])
uk, cnt = np.unique(allk, return_counts=True)
NODEK = np.union1d(np.union1d(uk[cnt >= 2], endk), XK.ravel())
log("junction vertices", len(NODEK))

# ================================================================ lanes of a way
DECKK = np.array(sorted(deck_parts.keys()), np.int64)
SPEED = {0: 70, 1: 60, 2: 50, 3: 45, 4: 38, 5: 25, 11: 40}
RANK = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 11: 6}


LWSTD = {0: 3.75, 1: 3.5, 11: 3.6}                     # the usual width of a lane (3.3 m on the streets)


def lane_layout(k):
    """The lanes of ways k (indices into the roads table) when each has its whole width to itself: as many as the map says
    (lanes.py), laid out in the carriageway as it is built. Where that is narrower than usual (it had to fit beside a
    neighbour), the cycle lane beside the lanes goes first, then the lanes narrow, and only below 2.8 m apiece is one given
    up. streetGeom.js paints the kerb-side lines by the same rule."""
    k = np.asarray(k)
    c = cls[k]
    isd = deck[k] & np.isin(k, DECKK)
    Wm_ = np.where(isd, WD[k], W0[k])
    ln = lanes[k]
    haslanes = np.isfinite(ln)
    one_ = oneway[k].astype(bool); two = ~one_
    bike = np.where(np.isin(c, [2, 3]), 2.6, np.where(c == 4, 1.6, 0.0))
    park_ = (c == 5) & (Wm_ >= 5.5) & ~isd & ~tunnel[k]
    pside_ = np.where(k % 2 == 1, 1.0, -1.0)                 # +1: parked along the left kerb
    n = len(k)
    nf_ = np.zeros(n, int); nb_ = np.zeros(n, int); lw_ = np.zeros(n); sh_ = np.zeros(n)
    mf, mb = NLF[k].astype(int), NLB[k].astype(int)
    model = mf > 0
    std = np.array([LWSTD.get(int(v), 3.3) for v in c])
    # ---- the roads whose lanes the map (or their class) gives
    # one way: kerb margins of 0.3 m, the cycle lane along the right-hand kerb
    av1 = Wm_ - 0.6
    n1 = np.maximum(mf, 1)
    for _ in range(7):
        n1 = np.where((av1 / n1 < 2.8) & (n1 > 1), n1 - 1, n1)
    bk1 = np.where(isd, 0.0, np.clip(av1 - n1 * std, 0.0, bike))
    g1 = model & one_
    nf_[g1] = n1[g1]; lw_[g1] = ((av1 - bk1) / n1)[g1]; sh_[g1] = (bk1 / 2)[g1]
    # two ways: a cycle lane along each kerb, the two directions either side of the middle of the lanes
    av2 = np.where(isd, Wm_ - 0.6, Wm_)
    f2, b2 = np.maximum(mf, 1), np.maximum(mb, 1)
    for _ in range(14):
        tight = av2 / (f2 + b2) < 2.8
        df = tight & (f2 >= b2) & (f2 > 1); db = tight & ~df & (b2 > 1)
        f2 = np.where(df, f2 - 1, f2); b2 = np.where(db, b2 - 1, b2)
    bk2 = np.where(isd, 0.0, np.clip((av2 - (f2 + b2) * std) / 2, 0.0, bike))
    g2 = model & two
    w2 = (av2 - 2 * bk2) / (f2 + b2)
    nf_[g2] = f2[g2]; nb_[g2] = b2[g2]; lw_[g2] = w2[g2]; sh_[g2] = ((f2 - b2) * w2 / 2)[g2]
    # ---- the back streets: lanes by the width
    carr = Wm_ / 2 - bike
    n2 = np.where(haslanes & (ln >= 2), np.maximum(1, jsround(np.nan_to_num(ln) / 2)), np.maximum(1, jsround(carr / 3.3)))
    carr1 = Wm_ - bike - 0.6
    n1w = np.where(haslanes & (ln >= 1), np.nan_to_num(ln), np.maximum(1, jsround(carr1 / 3.4)))
    fit = lambda n_, c_: np.maximum(1, np.minimum(n_, np.floor(c_ / 2.8)))
    n2 = fit(n2, carr); n1w = fit(n1w, carr1)
    h2 = ~model & two & ~isd; h1 = ~model & one_ & ~isd
    nf_[h2] = n2[h2]; nb_[h2] = n2[h2]; lw_[h2] = (carr / n2)[h2]
    nf_[h1] = n1w[h1]; lw_[h1] = (carr1 / np.maximum(n1w, 1))[h1]; sh_[h1] = (bike / 2)[h1]
    # kerb parking takes 2.05 m off one side
    pk2 = park_ & two
    free = Wm_ - 2.05
    np2 = np.maximum(1, np.minimum(n2, np.floor(free / 2 / 2.6)))
    nf_[pk2] = np2[pk2]; nb_[pk2] = np2[pk2]; lw_[pk2] = (free / 2 / np2)[pk2]; sh_[pk2] = (-pside_ * 1.025)[pk2]
    pk1 = park_ & one_
    np1 = np.maximum(1, np.minimum(n1w, np.floor(free / 2.7)))
    nf_[pk1] = np1[pk1]; lw_[pk1] = (free / np1)[pk1]; sh_[pk1] = (-pside_ * 1.025)[pk1]
    # back streets on decks
    carrd = Wm_ - 0.6
    nd = np.maximum(1, jsround(np.where(two, carrd / 2, carrd) / 3.6))
    d2 = ~model & isd & two; d1 = ~model & isd & one_
    nf_[d2] = nd[d2]; nb_[d2] = nd[d2]; lw_[d2] = (carrd / 2 / nd)[d2]; sh_[d2] = 0
    nf_[d1] = nd[d1]; lw_[d1] = (carrd / nd)[d1]; sh_[d1] = 0
    nf_ = np.clip(nf_, 1, 8); nb_ = np.where(two, np.clip(nb_, 1, 8), 0)
    # on a two-way street too narrow for two lanes the cars still keep 2.4 m between their paths (they use the whole width to pass)
    lw_ = np.clip(lw_, np.where(two & ~park_, 2.4, 2.1), 6.0)
    return dict(c=c, isdeck=isd, Wm=Wm_, one=one_, park=park_, pside=pside_, nf=nf_, nb=nb_, lw=lw_, shift=sh_)


# ================================================================ room between neighbouring carriageways
# Widths and lane counts come from tags and classes, but the lines of two carriageways are often mapped closer together than
# their lanes need (the two directions of an elevated road pinching together, a frontage road hugging its main road). Laid
# out regardless, the lanes of one lie over the lanes of the other: traffic meets head on, or drives through each other side
# by side. So every way is walked in 5 m stations, and at each the room it has towards its neighbours is noted:
#   opposing lanes that face each other share out the room between the two lines, in proportion to what each wanted;
#   lanes going the same way: the lesser road keeps clear of the greater one's lanes, as long as it keeps a lane of its own
#   (in the last stretch of a merge there is no room for that, and the two streams zip together there).
# Ways are cut where the room changes, and each piece lays its lanes out in the room it has (further down, once the
# junctions are known: stations inside a junction do not count).
STEP = 5.0; GAPL = 0.35
LWY = lane_layout(ways)
wpos = np.full(len(cls), -1, np.int64); wpos[ways] = np.arange(len(ways))
lo_w = np.where(LWY["one"], LWY["shift"] - LWY["nf"] * LWY["lw"] / 2, LWY["shift"] - LWY["nf"] * LWY["lw"])
hi_w = np.where(LWY["one"], LWY["shift"] + LWY["nf"] * LWY["lw"] / 2, LWY["shift"] + LWY["nb"] * LWY["lw"])
rank_w = np.array([RANK[int(c)] for c in LWY["c"]])
farL_w = np.maximum(hi_w, LWY["Wm"] / 2 - 0.25); farR_w = np.maximum(-lo_w, LWY["Wm"] / 2 - 0.25)      # as far as lanes squeezed from the other side may move over (into the cycle lane)
SWAY = {}
sP, sT, sZ, sW, sS = [], [], [], [], []
wstart = np.zeros(len(ways) + 1, np.int64)
for q, k in enumerate(ways):
    c, z, _ = XYZ[k]
    seg = np.hypot(*np.diff(c, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    SWAY[k] = s
    wstart[q + 1] = wstart[q]
    if s[-1] < 1.0:
        continue
    st = np.arange(STEP / 2, s[-1], STEP) if s[-1] > STEP else np.array([s[-1] / 2])
    i = np.clip(np.searchsorted(s, st, side="right") - 1, 0, len(seg) - 1)
    f = ((st - s[i]) / np.maximum(seg[i], 1e-9))[:, None]
    sP.append(c[i] + (c[i + 1] - c[i]) * f); sT.append((c[i + 1] - c[i]) / np.maximum(seg[i], 1e-9)[:, None])
    if dug[k] and not LWY["isdeck"][q]:
        a_, b_ = _ends[k]
        da_, db_ = (PD[a_] if np.isfinite(PD[a_]) else 80.0), (PD[b_] if np.isfinite(PD[b_]) else 80.0)
        sZ.append(-tunnel_depth(np.minimum(da_ + st, db_ + s[-1] - st)))
    else:
        sZ.append(np.interp(st, *zprof(k, s)))
    sW.append(np.full(len(st), q)); sS.append(st)
    wstart[q + 1] = wstart[q] + len(st)
sP = np.vstack(sP); sT = np.vstack(sT); sZ = np.concatenate(sZ); sW = np.concatenate(sW); sS = np.concatenate(sS)
NS = len(sP)
HL = hi_w[sW].copy(); RE = (-lo_w[sW]).copy()         # room to the left of the line, and to the right of it
# Two ways that meet (a slip road and the road it joins, a road that divides in two): near the meeting point their lanes run
# into each other by design. Neither gives lanes up there (a road of three lanes used to be whittled down to one before it
# joined another): the whole stretch where the two overlap is shared, and counts as part of the junction.
VMEET = 60.0
_mk = np.concatenate([vkey(XYZ[k][0]) for k in ways]); _mq = np.concatenate([np.full(len(XYZ[k][0]), q) for q, k in enumerate(ways)])
_ms = np.concatenate([SWAY[k] for k in ways])
_o = np.argsort(_mk, kind="stable"); _mk, _mq, _ms = _mk[_o], _mq[_o], _ms[_o]
_cut = np.flatnonzero(np.diff(_mk)) + 1
_st, _en = np.concatenate([[0], _cut]), np.concatenate([_cut, [len(_mk)]])
MEET = {}
for _a, _b in zip(_st[_en - _st >= 2].tolist(), _en[_en - _st >= 2].tolist()):
    for _x in range(_a, _b):
        for _y in range(_a, _b):
            if _mq[_x] != _mq[_y]:
                MEET.setdefault((int(_mq[_x]), int(_mq[_y])), []).append((float(_ms[_x]), float(_ms[_y])))
del _mk, _mq, _ms
TP = np.zeros(NS, bool)                                 # in the last stretch of a merge: lanes of the two roads on the same ground
from scipy.spatial import cKDTree
tree_s = cKDTree(sP)
for c0 in range(0, NS, 300_000):
    c1 = min(NS, c0 + 300_000)
    dd, jj = tree_s.query(sP[c0:c1], k=28, distance_upper_bound=18.0, workers=PROCS)
    a = np.repeat(np.arange(c0, c1), 28); b = jj.ravel()
    ok = b < NS
    a, b = a[ok], b[ok]
    ok = ((sW[a] != sW[b]) | (np.abs(sS[a] - sS[b]) > 40.0)) & (np.abs(sZ[a] - sZ[b]) < 2.4)      # (a way may double back beside itself; 2.4 m: a little more than the 1.8 m the cars take for one level)
    a, b = a[ok], b[ok]
    dot = (sT[a] * sT[b]).sum(1)
    d = sP[b] - sP[a]
    along = (d * sT[a]).sum(1); dl = -d[:, 0] * sT[a][:, 1] + d[:, 1] * sT[a][:, 0]        # how far b lies to the left of a's line
    # (two lines drawn on top of each other: one road mapped in pieces if they run the same way; the two decks of a tunnel if
    #  they run against each other, and then each keeps to its right)
    ok = (np.abs(dot) > 0.85) & (np.abs(along) < STEP / 2 + 0.6) & ((np.abs(dl) > 0.4) | (dot < 0))
    a, b, dot, dl = a[ok], b[ok], dot[ok], dl[ok]
    wa, wb = sW[a], sW[b]
    sg = np.sign(dot)
    coin = np.abs(dl) <= 0.4
    left = (dl > 0) | coin              # b is to the left of a
    aleft = (-sg * dl > 0) | coin       # a is to the left of b
    one_a, one_b = LWY["one"][wa], LWY["one"][wb]
    dir_a = np.where(left & ~one_a, -1.0, 1.0)                 # which way a's lane on that side runs (along a's line: +1)
    dir_b = np.where(aleft & ~one_b, -1.0, 1.0) * sg
    opp = dir_a != dir_b
    ext_a = np.where(left, hi_w[wa], -lo_w[wa]); ext_b = np.where(aleft, hi_w[wb], -lo_w[wb])
    oth_a = np.where(left, farR_w[wa], farL_w[wa])
    room = np.where(coin, 0.0, np.abs(dl)) - GAPL
    tight = ext_a + ext_b > room
    share = room * ext_a / np.maximum(ext_a + ext_b, 1e-6)
    major_a = (rank_w[wa] < rank_w[wb]) | ((rank_w[wa] == rank_w[wb]) & ((ext_a > ext_b) | ((ext_a == ext_b) & (wa < wb))))
    keep = room - ext_b
    lim = np.where(opp, share, keep)
    vm = np.zeros(len(a), bool)                                 # the two meet within 120 m of here
    cand = np.flatnonzero(tight & ~opp)
    if len(cand):
        pk_ = wa[cand].astype(np.int64) * 1_000_000 + wb[cand]
        o_ = np.argsort(pk_, kind="stable")
        upk_, ust_ = np.unique(pk_[o_], return_index=True)
        uen_ = np.concatenate([ust_[1:], [len(o_)]])
        for u_, key_ in enumerate(upk_.tolist()):
            lst_ = MEET.get((key_ // 1_000_000, key_ % 1_000_000))
            if lst_:
                idx_ = cand[o_[ust_[u_]:uen_[u_]]]
                for s1_, s2_ in lst_:
                    vm[idx_] |= (np.abs(sS[a[idx_]] - s1_) < VMEET) & (np.abs(sS[b[idx_]] - s2_) < VMEET)
    use = tight & (opp | (~major_a & ~vm & (keep + oth_a >= 2.6)))
    m = use & left
    np.minimum.at(HL, a[m], lim[m])
    m = use & ~left
    np.minimum.at(RE, a[m], lim[m])
    oth_b = np.where(aleft, farR_w[wb], farL_w[wb])
    tap = tight & ~opp & (vm | np.where(major_a, (room - ext_a) + oth_b < 2.6, keep + oth_a < 2.6))
    TP[np.unique(a[tap])] = True
del tree_s
from scipy.ndimage import maximum_filter1d, minimum_filter1d
full_w = hi_w - lo_w
CUTS = {}
ncut = 0
cutL, cutR = HL < hi_w[sW] - 0.05, RE < -lo_w[sW] - 0.05
avail_s = np.minimum(full_w[sW], HL + RE + np.where(cutL & ~cutR, farR_w[sW] + lo_w[sW], 0.0) + np.where(cutR & ~cutL, farL_w[sW] - hi_w[sW], 0.0))
for q in np.unique(sW[cutL | cutR]):
    i0, i1 = wstart[q], wstart[q + 1]
    if i1 - i0 < 8:
        continue                                    # a short way is one piece anyway
    av = avail_s[i0:i1]
    fitn = np.clip(np.floor(av / (2.8 if LWY["one"][q] else 5.6)), 0, LWY["nf"][q])
    x = np.where(~(cutL[i0:i1] | cutR[i0:i1]), 0, 1 + (LWY["nf"][q] - fitn)).astype(int)   # 0: all its room; 1: moved over; more: lanes lost
    x = minimum_filter1d(maximum_filter1d(x, 9, mode="nearest"), 9, mode="nearest")        # (no pieces shorter than 25 m)
    x = maximum_filter1d(x, 5, mode="nearest")
    ch = np.flatnonzero(np.diff(x) != 0)
    if len(ch):
        CUTS[int(ways[q])] = [float((sS[i0 + i] + sS[i0 + i + 1]) / 2) for i in ch]; ncut += len(ch)
log(f"stations {NS}; pinched by a neighbour {int((cutL | cutR).sum()) * STEP / 1e3:.0f} km of way; cuts where the room changes: {ncut} on {len(CUTS)} ways")

# ================================================================ edges
E_way, E_xyz, E_a, E_b = [], [], [], []
E_d0, E_d1, E_lowA = [], [], []              # the stretch of its way an edge covers (distance along the way), and whether end A is the near one
PSEUDO = [0]
CUTNODES = []


def resample_extra(c, z, extra, i0, i1):
    """Vertices i0..i1 of a way as an (n, 3) polyline; decks take the solver's stations in between."""
    if extra is None:
        return np.column_stack([c[i0:i1 + 1], z[i0:i1 + 1]])
    sd, d = extra
    s0 = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))]) * (sd[-1] / max(np.hypot(*np.diff(c, axis=0).T).sum(), 1e-6))
    a, b = s0[i0], s0[i1]
    m = (sd > a + 0.05) & (sd < b - 0.05)
    s = np.concatenate([[a], sd[m], [b]])
    out = np.column_stack([np.interp(s, sd, d[:, 0]), np.interp(s, sd, d[:, 1]), np.interp(s, sd, d[:, 2])])
    out[0, :2] = c[i0]; out[-1, :2] = c[i1]
    return out


MAXLEN = 520.0
for k in ways:
    c, z, extra = XYZ[k]
    kk = vkey(c)
    isn = NODEK[np.minimum(np.searchsorted(NODEK, kk), len(NODEK) - 1)] == kk
    isn[0] = isn[-1] = True
    cut = np.flatnonzero(isn)
    sw_, cuts_k = SWAY[k], CUTS.get(int(k))
    for a, b in zip(cut[:-1], cut[1:]):
        p = resample_extra(c, z, extra, a, b)
        if rev[k]:
            p = p[::-1]
        seg = np.hypot(*np.diff(p[:, :2], axis=0).T)
        L = seg.sum()
        if L < 0.3:
            continue
        ka, kb = int(vkey(p[:1])[0]), int(vkey(p[-1:])[0])
        da, db = float(sw_[a]), float(sw_[b])
        wd = lambda s_: da + ((1 - s_ / L) if rev[k] else s_ / L) * (db - da)          # distance along the way of a point of the edge
        # break points: where the room beside the way changes, and long runs without a junction (so that every piece is
        # loaded with the tile around its middle)
        marks = [0.0]
        if cuts_k is not None and db - da > 50:
            marks += sorted(((1 - (cd - da) / (db - da)) if rev[k] else (cd - da) / (db - da)) * L for cd in cuts_k if da + 18 < cd < db - 18)
        marks.append(L)
        pts = [0.0]; atcut = []
        for i in range(len(marks) - 1):
            la, lb = marks[i], marks[i + 1]
            n = int(np.ceil((lb - la) / (MAXLEN * 0.8))) if lb - la > MAXLEN else 1
            for q in range(1, n + 1):
                pts.append(la + (lb - la) * q / n); atcut.append(q == n and i < len(marks) - 2)
        if len(pts) == 2:
            E_way.append(k); E_xyz.append(p); E_a.append(ka); E_b.append(kb)
            E_d0.append(min(da, db)); E_d1.append(max(da, db)); E_lowA.append(not rev[k])
            continue
        s = np.concatenate([[0], np.cumsum(seg)])
        prev_key = ka
        for q in range(len(pts) - 1):
            sa, sb = pts[q], pts[q + 1]
            m = (s > sa + 0.05) & (s < sb - 0.05)
            ss = np.concatenate([[sa], s[m], [sb]])
            pp = np.column_stack([np.interp(ss, s, p[:, 0]), np.interp(ss, s, p[:, 1]), np.interp(ss, s, p[:, 2])])
            if q == len(pts) - 2:
                nk = kb
            else:
                PSEUDO[0] += 1; nk = -PSEUDO[0]
                if atcut[q]:
                    CUTNODES.append(nk)
            E_way.append(k); E_xyz.append(pp); E_a.append(prev_key); E_b.append(nk)
            E_d0.append(min(wd(sa), wd(sb))); E_d1.append(max(wd(sa), wd(sb))); E_lowA.append(not rev[k])
            prev_key = nk

E_way = np.array(E_way); E_a = np.array(E_a, np.int64); E_b = np.array(E_b, np.int64)
E_d0 = np.array(E_d0); E_d1 = np.array(E_d1); E_lowA = np.array(E_lowA, bool)
nk_all, inv = np.unique(np.concatenate([E_a, E_b]), return_inverse=True)
NE = len(E_way)
eA, eB = inv[:NE].astype(np.int64), inv[NE:].astype(np.int64)
NN = len(nk_all)
NPOS = np.zeros((NN, 3))
for e in range(NE):
    NPOS[eA[e]] = E_xyz[e][0]; NPOS[eB[e]] = E_xyz[e][-1]
E_len = np.array([np.hypot(*np.diff(p[:, :2], axis=0).T).sum() for p in E_xyz])
one = oneway[E_way].astype(bool)
log("edges", NE, "nodes", NN, f"{E_len.sum() / 1e3:.0f} km")

# the two nodes of each crossing made above
xnode = np.zeros(NN, bool); XPART = {}
for ka_, kb_ in XK:
    ia_, ib_ = int(np.searchsorted(nk_all, ka_)), int(np.searchsorted(nk_all, kb_))
    if ia_ < NN and ib_ < NN and nk_all[ia_] == ka_ and nk_all[ib_] == kb_ and ia_ != ib_:
        XPART[ia_] = ib_; XPART[ib_] = ia_

# ---------------- prune dead ends (cars would have nowhere to go); roads leaving the model stay as portals
portal = (NPOS[:, 0] < X_MIN + 400) | (NPOS[:, 0] > X_MAX - 400) | (NPOS[:, 1] < Y_MIN + 400) | (NPOS[:, 1] > Y_MAX - 400)
alive = np.ones(NE, bool)
for it in range(400):
    deg = np.bincount(eA[alive], minlength=NN) + np.bincount(eB[alive], minlength=NN)
    out = np.bincount(eA[alive], minlength=NN) + np.bincount(eB[alive & ~one], minlength=NN)
    inn = np.bincount(eB[alive], minlength=NN) + np.bincount(eA[alive & ~one], minlength=NN)
    leaf = ((deg[eA] <= 1) & ~portal[eA]) | ((deg[eB] <= 1) & ~portal[eB])
    sink = one & (((out[eB] <= 0) & ~portal[eB]) | ((inn[eA] <= 0) & ~portal[eA]))
    loop = eA == eB
    rm = alive & (leaf | sink | loop)
    if not rm.any():
        break
    alive &= ~rm
log("pruned dead ends:", int((~alive).sum()), "edges in", it, "rounds;", f"{E_len[alive].sum() / 1e3:.0f} km left")

# ================================================================ lanes
ek = E_way
LE = lane_layout(ek)
c_, isdeck, Wm, park, pside = LE["c"], LE["isdeck"], LE["Wm"], LE["park"], LE["pside"]
nf, nb, lw, shift = LE["nf"], LE["nb"], LE["lw"], LE["shift"]
spd = np.array([SPEED[int(c)] for c in c_])
spd = np.where(isdeck & np.isin(c_, [2, 3, 4]), 60, spd)
rank = np.array([RANK[int(c)] for c in c_])

# ================================================================ junctions
ae = np.flatnonzero(alive)
# incidence: (node, edge, end) for alive edges
inc_n = np.concatenate([eA[ae], eB[ae]]); inc_e = np.concatenate([ae, ae]); inc_end = np.concatenate([np.zeros(len(ae), int), np.ones(len(ae), int)])
order = np.argsort(inc_n, kind="stable")
inc_n, inc_e, inc_end = inc_n[order], inc_e[order], inc_end[order]
nstart = np.searchsorted(inc_n, np.arange(NN + 1))
arms = np.diff(nstart)


def bearing_of(e, end, reach=9.0):
    """Unit vector pointing away from the node along the edge (a few metres in, so that a kink at the node does not decide it)."""
    p = E_xyz[e][:, :2] if end == 0 else E_xyz[e][::-1, :2]
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
    r = min(reach, s[-1])
    q = np.array([np.interp(r, s, p[:, 0]), np.interp(r, s, p[:, 1])])
    d = q - p[0]
    return d / max(np.hypot(*d), 1e-9)


BEAR = np.zeros((NE, 2, 2))
for e in ae:
    BEAR[e, 0] = bearing_of(e, 0); BEAR[e, 1] = bearing_of(e, 1)

# clusters: the several nodes of one big junction (dual carriageways crossing) act together
parent = list(range(NN))


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x


ground_e = ~isdeck & ~dug[ek]
# roundabouts are not junction boxes: traffic on the ring has priority, each entry gives way (handled after the clusters)
isRb = np.array([rt[k].get("junction") in ("roundabout", "circular") for k in ek])
rb_node = np.zeros(NN, bool)
rb_node[eA[ae[isRb[ae]]]] = True; rb_node[eB[ae[isRb[ae]]]] = True
# crossings without a junction: both roads must still be there (two arms each)
for n_, p_ in list(XPART.items()):
    if arms[n_] != 2 or arms[p_] != 2:
        XPART.pop(n_, None); XPART.pop(p_, None)
xnode[list(XPART.keys())] = True
for n_, p_ in XPART.items():
    a, b = find(n_), find(p_)
    if a != b:
        parent[b] = a
for e in ae[(E_len[ae] < 38) & xnode[eA[ae]] & xnode[eB[ae]]]:      # (a dual carriageway crossed: the piece between its two crossings)
    a, b = find(eA[e]), find(eB[e])
    if a != b:
        parent[b] = a
log("crossings made junctions:", len(XPART) // 2)
# (a bridge a hand's breadth above the street is street for this purpose)
lowdeck = np.zeros(NE, bool)
for e in ae[isdeck[ae]]:
    lowdeck[e] = float(np.abs(E_xyz[e][:, 2]).max()) < 1.5
gl_e = (~isdeck | lowdeck) & ~dug[ek]
short = ae[(E_len[ae] < 38) & (arms[eA[ae]] >= 3) & (arms[eB[ae]] >= 3) & gl_e[ae] & ~np.isin(c_[ae], [0, 11]) & ~rb_node[eA[ae]] & ~rb_node[eB[ae]]]
for e in short:
    a, b = find(eA[e]), find(eB[e])
    if a != b:
        parent[b] = a
# a link between two junction nodes may come in pieces (the map splits a way wherever its tags change, and so does the cutting
# above): the pieces count as one link, and the joints between them belong to the junction
chain_node = np.zeros(NN, bool)
_cand = np.zeros(NE, bool); _cand[ae] = gl_e[ae] & ~np.isin(c_[ae], [0, 11])
_seen = np.zeros(NE, bool)
nchain = 0
for e0 in ae[_cand[ae] & (E_len[ae] < 38) & ((arms[eA[ae]] == 2) | (arms[eB[ae]] == 2))]:
    if _seen[e0]:
        continue
    es = [int(e0)]; _seen[e0] = True
    ends = []
    for n in (int(eA[e0]), int(eB[e0])):
        pe = int(e0)
        while n >= 0 and arms[n] == 2 and not rb_node[n] and not xnode[n]:
            a1, a2 = int(inc_e[nstart[n]]), int(inc_e[nstart[n] + 1])
            nx = a2 if a1 == pe else a1
            if _seen[nx] or not _cand[nx] or len(es) > 8:
                n = -1; break
            es.append(nx); _seen[nx] = True
            n = int(eB[nx]) if eA[nx] == n else int(eA[nx]); pe = nx
        ends.append(n)
    if min(ends) < 0 or ends[0] == ends[1] or arms[ends[0]] < 3 or arms[ends[1]] < 3 or rb_node[ends[0]] or rb_node[ends[1]] or E_len[es].sum() >= 38:
        continue
    nchain += 1
    for e in es:
        a, b = find(eA[e]), find(eB[e])
        if a != b:
            parent[b] = a
        for n in (eA[e], eB[e]):
            if arms[n] == 2:
                chain_node[n] = True
log("links between junction nodes that come in pieces:", nchain)
root = np.array([find(x) for x in range(NN)])
internal = np.zeros(NE, bool)
internal[ae] = (root[eA[ae]] == root[eB[ae]]) & (E_len[ae] < 60)

# OSM signals -> the junction they stand at
pts = gpd.read_parquet(os.path.join(WORK, "osm_points.parquet"))
sg = pts[pts.kind == "highway=traffic_signals"]
sx, sy = to_local(sg.geometry.x.values, sg.geometry.y.values)
from scipy.spatial import cKDTree
node_ground = np.zeros(NN, bool)
np.logical_or.at(node_ground, eA[ae], ground_e[ae]); np.logical_or.at(node_ground, eB[ae], ground_e[ae])
node_high = np.zeros(NN, bool)
np.logical_or.at(node_high, eA[ae], ~ground_e[ae] | np.isin(c_[ae], [0])); np.logical_or.at(node_high, eB[ae], ~ground_e[ae] | np.isin(c_[ae], [0]))
node_high[xnode] = True                # (no signals at a crossing that is a bridge in the real city: nothing there shows them)
jn = np.flatnonzero((arms >= 3) & node_ground & ~node_high)
tree = cKDTree(NPOS[jn, :2])
dd, ii = tree.query(np.column_stack([sx, sy]), distance_upper_bound=45)
sig_node = np.zeros(NN, bool)
sig_node[jn[ii[np.isfinite(dd)]]] = True
sig_root = np.zeros(NN, bool)
sig_root[root[np.flatnonzero(sig_node)]] = True
log("OSM signals", len(sg), "-> junctions", int(sig_root.sum()))

# per cluster: external approaches, reference axis, groups
members = {}
for n in np.flatnonzero((arms >= 3) | chain_node | xnode):
    members.setdefault(root[n], []).append(n)

# ---------------- a compact junction acts as one node
# The nodes of a junction of dual carriageways are a few metres apart, joined by links too short to hold a car: one waiting
# there stands across the lanes beside it, the next waits for it, and the junction locks. Such a cluster is handed to the
# traffic as a single node (its approaches lead straight to its exits and nothing stops inside); the links are left out.
# A cluster too wide for that (a string of junctions along a boulevard, an interchange at street level) is taken apart into
# compact groups first: its links are joined up shortest first, as long as the group they make stays within 75 m across.
# Which exit can be reached from which approach stays as it was: each edge end carries the number of its node within the
# merged group, and the set of the group's nodes that traffic arriving there can get to along the links (one-way links one way).
MG = np.arange(NN)
SUB = np.zeros(NN, np.uint8); REACH = np.full(NN, 0xFFFFFFFF, np.uint32)
MERGE_D = 75.0
int_by_root = {}
for e in ae[internal[ae]]:
    int_by_root.setdefault(int(root[eA[e]]), []).append(int(e))
nmerge = nsplit = 0
for r, nodes in members.items():
    if len(nodes) < 2:
        continue
    idx = {int(n): i for i, n in enumerate(nodes)}
    P_ = NPOS[nodes, :2]
    grp = list(range(len(nodes)))                # group label per member
    mem = {i: [i] for i in range(len(nodes))}
    links = sorted(int_by_root.get(int(r), []), key=lambda e: E_len[e])
    for n_ in nodes:                             # the two nodes of a crossing are one place (but no way leads from one to the other)
        p_ = XPART.get(int(n_))
        if p_ is not None and p_ in idx and grp[idx[int(n_)]] != grp[idx[p_]]:
            ga, gb = grp[idx[int(n_)]], grp[idx[p_]]
            for i in mem[gb]:
                grp[i] = ga
            mem[ga] = mem[ga] + mem[gb]; del mem[gb]
    for e in links:
        a_, b_ = idx.get(int(eA[e])), idx.get(int(eB[e]))
        if a_ is None or b_ is None or grp[a_] == grp[b_]:
            continue
        ga, gb = grp[a_], grp[b_]
        both = mem[ga] + mem[gb]
        Q = P_[both]
        if len(both) > 24 or float(((Q[:, None] - Q[None]) ** 2).sum(-1).max()) > MERGE_D ** 2:
            continue
        for i in mem[gb]:
            grp[i] = ga
        mem[ga] = both; del mem[gb]
    if len(mem) > 1:
        nsplit += 1
    for g, ii in mem.items():
        if len(ii) > 1:
            MG[[nodes[i] for i in ii]] = nodes[ii[0]]; nmerge += 1
            pos = {i: k for k, i in enumerate(ii)}
            adj = [[] for _ in ii]
            for e in links:
                a_, b_ = idx.get(int(eA[e])), idx.get(int(eB[e]))
                if a_ in pos and b_ in pos:
                    adj[pos[a_]].append(pos[b_])
                    if not one[e]:
                        adj[pos[b_]].append(pos[a_])
            for k, i in enumerate(ii):
                seen = {k}; stack = [k]
                while stack:
                    for w in adj[stack.pop()]:
                        if w not in seen:
                            seen.add(w); stack.append(w)
                SUB[nodes[i]] = k; REACH[nodes[i]] = sum(1 << w for w in seen)
merged_in = np.zeros(NE, bool)
merged_in[ae] = internal[ae] & (MG[eA[ae]] == MG[eB[ae]])
left = ae[internal[ae] & ~merged_in[ae]]
log(f"junction clusters merged into one node: {nmerge} ({int(merged_in.sum())} links inside them left out); clusters taken apart: {nsplit}; "
    f"links left between the parts: {len(left)} (shorter than 10 m: {int((E_len[left] < 10).sum())}, 10-20 m: {int(((E_len[left] >= 10) & (E_len[left] < 20)).sum())}, longer: {int((E_len[left] >= 20).sum())})")


CTRL = np.zeros((NE, 2), np.uint8)       # control byte per edge end (traffic arriving at that end)
PHASE = np.zeros((NE, 2), np.uint16)
TRIM = np.full((NE, 2), 1.5); STOP = np.full((NE, 2), 2.0)
nsig = nprio = 0
SIG_EXT = {}          # signalised cluster -> its approaches (for the direction boards)
for r, nodes in members.items():
    ext = []          # (edge, end)
    # (the approaches: every arm but the links left out inside a merged junction. Where a cluster was taken apart, the links
    #  between its parts are approaches to those parts like any other, under the same lights)
    for n in nodes:
        for q in range(nstart[n], nstart[n + 1]):
            e, end = inc_e[q], inc_end[q]
            if not merged_in[e]:
                ext.append((e, end))
    if not ext:
        continue
    # reference axis: the most major approach
    best = min(ext, key=lambda t: (rank[t[0]], -Wm[t[0]], t[0]))
    ax = BEAR[best[0], best[1]]
    # signal groups are the same all over the city: north-south streets run together, then east-west ones. Neighbouring junctions
    # then show green to the same stream at the same time, and a short block between two of them cannot throttle the flow.
    g0 = 0 if abs(ax[1]) > 0.7071 else 1
    grp = []
    for e, end in ext:
        b = BEAR[e, end]
        cs = abs(b[0] * ax[0] + b[1] * ax[1])
        grp.append(g0 if cs > 0.7071 else 1 - g0)
    c0 = min([rank[e] for (e, end), g in zip(ext, grp) if g == 0], default=9)
    c1 = min([rank[e] for (e, end), g in zip(ext, grp) if g == 1], default=9)
    flat = all(node_ground[n] and not node_high[n] for n in nodes)
    cm, cs_ = min(c0, c1), max(c0, c1)            # the main street's class and the side street's (9: nothing crosses)
    signal = flat and cs_ < 9 and (sig_root[r] or (len(ext) >= 3 and ((cm <= 3 and cs_ <= 3) or (cm <= 2 and cs_ <= 4))))
    # a slow sweep across the map instead of every light changing at the same instant: a green wave for one direction of each street
    ph = int((((NPOS[r, 0] * 0.6 - NPOS[r, 1] * 0.8) / 13.0 / 72.0) % 1.0) * 65536) & 0xFFFF
    for (e, end), g in zip(ext, grp):
        zebra = signal and 2 <= c_[e] <= 5 and E_len[e] >= 22 and not internal[e]
        if not signal and 2 <= c_[e] <= 4 and E_len[e] >= 30 and len(ext) >= 3 and max(c0, c1) <= 5 and flat and not internal[e]:
            zebra = True
        CTRL[e, end] = (1 if signal else 2) | (g << 2) | (int(rank[e]) << 3) | (64 if zebra else 0)
        PHASE[e, end] = ph
    for n in nodes:
        for q in range(nstart[n], nstart[n + 1]):
            e, end = inc_e[q], inc_end[q]
            if merged_in[e]:
                CTRL[e, end] = (0 if signal else 2 | (7 << 3)) | 128
                PHASE[e, end] = ph
    if signal:
        SIG_EXT[int(r)] = ext
        nsig += 1
    else:
        nprio += 1
for n in np.flatnonzero(rb_node):
    for q in range(nstart[n], nstart[n + 1]):
        e, end = inc_e[q], inc_end[q]
        CTRL[e, end] = 2 | ((0 if isRb[e] else 6) << 3) | (0 if isRb[e] else int(CTRL[e, end]) & 64)
log("junction clusters:", nsig, "signalised,", nprio, "give-way; roundabout nodes", int(rb_node.sum()))

# trims (where the lane ends and the junction begins) and stop lines
for n in np.flatnonzero(arms >= 2):
    own = range(nstart[n], nstart[n + 1])
    qs = list(own) + (list(range(nstart[XPART[n]], nstart[XPART[n] + 1])) if n in XPART else [])       # (at a crossing: the other road's arms too)
    for q in own:
        e, end = inc_e[q], inc_end[q]
        b = BEAR[e, end]
        t = 1.5
        for q2 in qs:
            if q2 == q:
                continue
            e2, end2 = inc_e[q2], inc_end[q2]
            b2 = BEAR[e2, end2]
            cs = b[0] * b2[0] + b[1] * b2[1]
            if cs < -0.866:                       # the continuation of this road
                continue
            sn = max(np.sqrt(max(0.0, 1 - cs * cs)), 0.35)
            # (the corner of this road's own carriageway reaches the other road sooner than its centre line does when they
            #  meet at a slant: without the second term a waiting car's nose stands in the cross traffic)
            t = max(t, (Wm[e2] / 2 + 1.0 + Wm[e] / 2 * abs(cs)) / sn if cs > -0.5 else Wm[e2] / 2 * 0.5 + 1.0)
        TRIM[e, end] = min(t, 28.0)
# A junction of several nodes that acts as one: no approach ends its lanes in the middle of it. The trims above were worked
# out node by node; an approach that joins at an inner node of the group, or runs along its flank, would have its cars wait
# between the nodes, in the way of the streams that cross there. Its lanes end where it leaves the hull of the group's nodes
# (looked for along its first 45 m; the edge keeps its share of lane further down, where short edges are shared out).
_cnt = np.bincount(MG, minlength=NN)
_grp = {}
for n in np.flatnonzero(_cnt[MG] >= 2):
    _grp.setdefault(int(MG[n]), []).append(int(n))
nhull = 0; hull_m = []
for ns_ in _grp.values():
    if len(ns_) < 3:
        continue
    H_ = shapely.MultiPoint(NPOS[ns_, :2]).convex_hull.buffer(2.0)
    for n in ns_:
        for q in range(nstart[n], nstart[n + 1]):
            e, end = int(inc_e[q]), int(inc_end[q])
            if merged_in[e] or not ((nf[e] > 0) if end == 1 else (nb[e] > 0)):
                continue                                   # (a link inside the group; or nothing arrives along this arm)
            pl = E_xyz[e][:, :2] if end == 0 else E_xyz[e][::-1, :2]
            sc_ = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pl, axis=0).T))])
            st_ = np.arange(1.0, min(45.0, sc_[-1]), 1.0)
            if not len(st_):
                continue
            ins = shapely.contains_xy(H_, np.interp(st_, sc_, pl[:, 0]), np.interp(st_, sc_, pl[:, 1]))
            if not ins.any():
                continue
            d_ = float(st_[np.flatnonzero(ins)[-1]]) + 1.0
            if d_ > TRIM[e, end] + 3.0:
                hull_m.append(d_ - TRIM[e, end]); TRIM[e, end] = d_; nhull += 1
log(f"approaches whose lanes ended inside a merged junction, now ending where they leave it: {nhull}" + (f" (median {np.median(hull_m):.0f} m further back, most {max(hull_m):.0f} m)" if hull_m else ""))
# a road crossed right beside one of its junctions (see the crossings above): its lanes end before the crossing
_ew = {}
for e in ae:
    _ew.setdefault(int(ek[e]), []).append(int(e))
nnear = 0
for k_, sx_, sj_, hw_ in NEARX:
    lo_, hi_ = min(sx_, sj_), max(sx_, sj_)
    for e in _ew.get(int(k_), []):
        if E_d0[e] - 0.5 <= lo_ and E_d1[e] + 0.5 >= hi_:
            atlow = abs(E_d0[e] - sj_) < abs(E_d1[e] - sj_)
            end = 0 if (atlow == bool(E_lowA[e])) else 1
            need = min(hi_ - lo_ + hw_ + 1.5, 30.0)
            if need > TRIM[e, end]:
                TRIM[e, end] = need; nnear += 1
            break
log("lanes ended before a road that crosses right beside their junction:", nnear)
# The last stretch of a merge (and the first of a fork): the slip road's lane and the main road's nearside lane lie on the same
# ground there. Both roads' lanes end where that stretch begins, and the junction reaches that far: a car waits clear of the
# other stream, and the two streams cross the stretch as one queue (traffic.js). Up to 120 m.
ntap = 0; tapl = []


def _shared_run(e, end):
    """How far the shared stretch reaches into edge e from its end `end` (m), and whether it runs the whole length of it."""
    q = wpos[ek[e]]
    i0, i1 = wstart[q], wstart[q + 1]
    if i1 <= i0:
        return 0.0, False
    S_ = sS[i0:i1]
    j0, j1 = int(np.searchsorted(S_, E_d0[e])), int(np.searchsorted(S_, E_d1[e]))
    if j1 <= j0:
        return 0.0, False
    f = TP[i0 + j0:i0 + j1]
    g = f if ((end == 0) == bool(E_lowA[e])) else f[::-1]              # stations from this end inwards
    m = 0; miss = 0
    for k_, v_ in enumerate(g):
        if v_:
            m = k_ + 1; miss = 0
        else:
            miss += 1
            if miss > (1 if m else 3):       # (right at the node the two lines run into one, and say nothing: a few stations of grace)
                break
    return m * STEP, m >= len(g) - 1 and m > 0


for e0 in ae:
    for end0 in (0, 1):
        if arms[eA[e0] if end0 == 0 else eB[e0]] < 3:
            continue
        e, end, left_ = int(e0), end0, 120.0
        for hop in range(4):
            run, whole = _shared_run(e, end)
            if run <= 0:
                break
            t = min(run + 2.5, left_)
            if t > TRIM[e, end]:
                TRIM[e, end] = t; ntap += 1
                if hop == 0:
                    tapl.append(run)
            left_ -= E_len[e]
            n = int(eB[e] if end == 0 else eA[e])           # the far end: a mere joint in the same road? then the stretch carries on beyond it
            if not whole or left_ < 8 or arms[n] != 2:
                break
            a1, a2 = int(inc_e[nstart[n]]), int(inc_e[nstart[n] + 1])
            e2 = a2 if a1 == e else a1
            e, end = e2, (0 if eA[e2] == n else 1)
log(f"merges and forks whose lanes end before the shared stretch: {ntap} edge ends; stretch median {np.median(tapl) if tapl else 0:.0f} m, 90% under {np.percentile(tapl, 90) if tapl else 0:.0f} m, longer than 110 m: {int((np.array(tapl) > 110).sum())}")
# a short edge shares its length out between its two ends by what each wants (a fork at a narrow angle wants a long way back
# from the junction, the joint with the next piece of the same road next to nothing), keeping three metres of lane
for e in ae:
    w = TRIM[e, 0] + TRIM[e, 1]
    room = max(E_len[e] - 3.0, 0.6 * E_len[e])
    if w > room:
        TRIM[e] *= room / w
    for end in (0, 1):
        t = TRIM[e, end]
        zw = 4.5 if c_[e] <= 3 else 3.5
        if CTRL[e, end] & 64:
            if t + zw + 1.7 + 3 > 0.48 * E_len[e]:
                CTRL[e, end] &= ~np.uint8(64)
        STOP[e, end] = t + (zw + 1.7 if CTRL[e, end] & 64 else 0.6)

if os.environ.get("SH3D_DUMPJ"):                           # (debugging: the junctions nearest the given x,z points, as the traffic gets them)
    for _t in os.environ["SH3D_DUMPJ"].split(";"):
        _x, _z = [float(v) for v in _t.split(",")]
        _jn = np.flatnonzero(arms >= 3)
        _n = int(_jn[np.argmin(np.hypot(NPOS[_jn, 0] - _x, NPOS[_jn, 1] + _z))])
        _ns = np.flatnonzero(MG == MG[_n])
        _H = shapely.MultiPoint(NPOS[_ns, :2]).convex_hull
        print(f"--- junction at ({_x:.0f}, {_z:.0f}): node {_n}, merged group of {len(_ns)} nodes, cluster root {root[_n]} with {len(members.get(root[_n], []))} members; hull area {_H.area:.0f} m2")
        for _m in _ns:
            print(f"    node {_m} at ({NPOS[_m, 0]:.0f}, {-NPOS[_m, 1]:.0f}) arms {arms[_m]} sub {SUB[_m]}")
            for q in range(nstart[_m], nstart[_m + 1]):
                e, end = int(inc_e[q]), int(inc_end[q])
                pl = E_xyz[e][:, :2] if end == 0 else E_xyz[e][::-1, :2]
                sc_ = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pl, axis=0).T))])
                t_ = TRIM[e, end]
                pt = np.array([np.interp(t_, sc_, pl[:, 0]), np.interp(t_, sc_, pl[:, 1])])
                far = np.array([np.interp(min(40, sc_[-1]), sc_, pl[:, 0]), np.interp(min(40, sc_[-1]), sc_, pl[:, 1])])
                ins = shapely.intersection(shapely.LineString(pl), _H.buffer(2.0))
                dins = max((shapely.line_locate_point(shapely.LineString(pl), shapely.Point(c)) for c in shapely.get_coordinates(ins)), default=0.0) if not ins.is_empty else 0.0
                print(f"       edge {e} end {end} {'INSIDE ' if merged_in[e] else ''}cls {c_[e]} W {Wm[e]:.1f} lanes {nf[e]}+{nb[e]} len {E_len[e]:.0f} trim {t_:.1f} stop {STOP[e, end]:.1f} ctrl {CTRL[e, end]} "
                      f"heads to ({far[0]:.0f}, {-far[1]:.0f}); lane end {_H.distance(shapely.Point(pt)):.1f} m from the hull; inside the hull+2 for {dins:.1f} m")
# where a way was cut because the room beside it changes, the lanes shift over: a longer run between the two layouts
if CUTNODES:
    for n in np.flatnonzero(np.isin(nk_all, np.array(CUTNODES, np.int64))):
        for q in range(nstart[n], nstart[n + 1]):
            e, end = inc_e[q], inc_end[q]
            TRIM[e, end] = min(7.0, 0.3 * E_len[e]); STOP[e, end] = TRIM[e, end] + 0.6

# ---------------- lanes laid out in the room each piece has (see "room between neighbouring carriageways")
nrefit = nres = 0
km0 = float((E_len[ae] * (nf[ae] + nb[ae])).sum() / 1e3)
for e in ae:
    q = wpos[ek[e]]
    i0, i1 = wstart[q], wstart[q + 1]
    if i1 <= i0:
        continue
    S_ = sS[i0:i1]
    tlo, thi = (TRIM[e, 0], TRIM[e, 1]) if E_lowA[e] else (TRIM[e, 1], TRIM[e, 0])
    j0, j1 = int(np.searchsorted(S_, E_d0[e] + tlo)), int(np.searchsorted(S_, E_d1[e] - thi))
    if j1 <= j0:                                 # a piece that is all junction: its middle counts
        j0 = int(np.clip(np.searchsorted(S_, (E_d0[e] + E_d1[e]) / 2), 0, len(S_) - 1)); j1 = j0 + 1
    hl, re = float(HL[i0 + j0:i0 + j1].min()), float(RE[i0 + j0:i0 + j1].min())
    hi0 = shift[e] + (nf[e] * lw[e] / 2 if one[e] else nb[e] * lw[e]); lo0 = shift[e] - (nf[e] * lw[e] / 2 if one[e] else nf[e] * lw[e])
    cl, cr = hl < hi0 - 0.05, re < -lo0 - 0.05
    if not cl and not cr:
        continue
    # squeezed from one side the lanes move over to the other as far as the carriageway goes, and only then lose width
    full = hi0 - lo0
    fl, fr = farL_w[q], farR_w[q]
    hi1 = hl if cl else (min(fl, max(hi0, -re + full)) if cr else hi0)
    lo1 = -re if cr else (max(-fr, min(lo0, hl - full)) if cl else lo0)
    av = hi1 - lo1
    nrefit += 1
    if one[e]:
        if av >= 2.6:
            n = int(max(1, min(nf[e], np.floor(av / 2.8))))
            nf[e] = n; lw[e] = min(lw[e], av / n); shift[e] = (hi1 + lo1) / 2
        else:
            nf[e] = 1; lw[e] = 2.6; nres += 1           # no room for a lane: one is kept, on the far side of its carriageway
            shift[e] = max(hi1 - 1.3, -fr + 1.3) if cl and not cr else min(lo1 + 1.3, fl - 1.3) if cr and not cl else (hi0 + lo0) / 2
    else:
        n = int(max(1, min(nf[e], np.floor(av / 5.6))))
        w = min(lw[e], av / (2 * n))
        if w < 2.4:
            w = 2.4; nres += 1
        nf[e] = nb[e] = n; lw[e] = w
        shift[e] = (hi1 + lo1) / 2 if av >= 4.8 else (max(hi1 - 2.4, -fr + 2.4) if cl and not cr else min(lo1 + 2.4, fl - 2.4) if cr and not cl else (hi0 + lo0) / 2)
log(f"lanes fitted beside a neighbour on {nrefit} edges ({nres} with no room for a lane); lane-km {km0:.0f} -> {float((E_len[ae] * (nf[ae] + nb[ae])).sum() / 1e3):.0f}")

# ---------------- the lanes against the map: where a way carries a lanes tag, does the traffic have that many?
def _lanes_vs_map():
    k_ = ek[ae]
    want = (NLF[k_] + NLB[k_]).astype(float)
    got = (nf[ae] + nb[ae]).astype(float)
    L_ = E_len[ae]
    kind = np.where(isdeck[ae], "deck", np.where(dug[k_], "tunnel", "street"))
    out = {}
    for name in ("street", "deck", "tunnel"):
        for lab, sel in (("tagged", LTAG[k_]), ("usual", ~LTAG[k_] & (want > 0))):
            m = sel & (kind == name)
            fewer = m & (got < want)
            out[f"{name}_{lab}"] = dict(km=round(float(L_[m].sum() / 1e3), 1), fewer_km=round(float(L_[fewer].sum() / 1e3), 1),
                                        lane_km_short=round(float((L_ * (want - got))[fewer].sum() / 1e3), 1), more_km=round(float(L_[m & (got > want)].sum() / 1e3), 1))
    return out, (LTAG[k_] & (got < want), want - got)


_lv, (_short, _by) = _lanes_vs_map()
log("lanes against the map (tagged: the map gives the count; usual: the count for the class of road). km of road; km with fewer lanes; lane-km short; km with more:",
    {k_: tuple(v.values()) for k_, v in _lv.items()})
json.dump(_lv, open(os.path.join(WORK, "lanes_vs_map.json"), "w"), indent=1)
if os.environ.get("SH3D_LANEDUMP"):
    _e = ae[_short]; _o = np.argsort(-(E_len[_e] * _by[_short]))
    _rad = float(os.environ.get("SH3D_LANEDUMP_R", "1e9")); _nd = 0
    for e in _e[_o]:
        m_ = E_xyz[e][len(E_xyz[e]) // 2]
        if max(abs(m_[0]), abs(m_[1])) > _rad or (os.environ.get("SH3D_LANEDUMP_KIND") and os.environ["SH3D_LANEDUMP_KIND"] != ("deck" if isdeck[e] else "tunnel" if dug[ek[e]] else "street")):
            continue
        _nd += 1
        if _nd > int(os.environ["SH3D_LANEDUMP"]):
            break
        print(f"    short: at ({m_[0]:.0f}, {-m_[1]:.0f}) cls {c_[e]} {'deck' if isdeck[e] else 'tunnel' if dug[ek[e]] else 'street'} len {E_len[e]:.0f} should have {NLF[ek[e]]}+{NLB[ek[e]]} {'one-way' if one[e] else 'two-way'} has {nf[e]}+{nb[e]} W {Wm[e]:.1f} name {rt[ek[e]].get('name')}")

# ---------------- where a road carries on with its lanes laid out differently (a lane more, the group moved over), the cars
# need a run to move across: three metres between the two layouts would be a swerve into the neighbouring lane
def _lats(e, towards_b):
    """Lanes of edge e for traffic running A->B (or B->A): how far each lies to the left of the direction of travel."""
    if towards_b:
        return [shift[e] + (nf[e] / 2 - l - 0.5) * lw[e] if one[e] else shift[e] - (l + 0.5) * lw[e] for l in range(nf[e])]
    return [-(shift[e] + (l + 0.5) * lw[e]) for l in range(nb[e])]


nlong = 0
for n in np.flatnonzero(arms == 2):
    (e1, end1), (e2, end2) = [(inc_e[q], inc_end[q]) for q in range(nstart[n], nstart[n + 1])]
    if BEAR[e1, end1] @ BEAR[e2, end2] > -0.8:
        continue                                    # (a bend: not one road carrying on)
    mx = 0.0
    for (ea_, enda), (eb_, endb) in (((e1, end1), (e2, end2)), ((e2, end2), (e1, end1))):
        la, lb = _lats(ea_, enda == 1), _lats(eb_, endb == 0)       # arriving at the node along ea_, leaving along eb_
        if la and lb:
            mx = max(mx, max(abs(lb[min(l, len(lb) - 1)] - la[l]) for l in range(len(la))))
    if mx > 0.4:
        for e, end in ((e1, end1), (e2, end2)):
            t = min(max(TRIM[e, end], min(4.0 * mx, 12.0)), 0.3 * E_len[e])
            if t > TRIM[e, end]:
                STOP[e, end] += t - TRIM[e, end]; TRIM[e, end] = t
        nlong += 1
log("joints where the lanes move over, given a longer run:", nlong)
for e in ae:
    w = TRIM[e, 0] + TRIM[e, 1]
    room = max(E_len[e] - 2.0, 0.7 * E_len[e])
    if w > room:
        k_ = room / w
        for end in (0, 1):
            STOP[e, end] -= TRIM[e, end] * (1 - k_); TRIM[e, end] *= k_

# ---------------- tunnels dip under the ground: depth from the distance to the nearest portal
te = ae[dug[ek[ae]] & ~isdeck[ae]]
if len(te):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    tn = np.zeros(NN, bool); tn[eA[te]] = True; tn[eB[te]] = True
    og = np.zeros(NN, bool)
    oe = ae[~dug[ek[ae]]]
    og[eA[oe]] = True; og[eB[oe]] = True
    src = np.flatnonzero(tn & (og | portal | (arms <= 1)))
    g = coo_matrix((np.concatenate([E_len[te], E_len[te]]), (np.concatenate([eA[te], eB[te]]), np.concatenate([eB[te], eA[te]]))), shape=(NN, NN)).tocsr()
    dist = dijkstra(g, directed=False, indices=src, min_only=True) if len(src) else np.full(NN, 0.0)
    dist[~np.isfinite(dist)] = 80.0
    for e in te:
        p = E_xyz[e]
        s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p[:, :2], axis=0).T))])
        # stations every 12 m so that the ramp is followed
        ss = np.unique(np.concatenate([s, np.arange(0, s[-1], 12.0)]))
        pp = np.column_stack([np.interp(ss, s, p[:, 0]), np.interp(ss, s, p[:, 1]), np.zeros(len(ss))])
        d = np.minimum(dist[eA[e]] + ss, dist[eB[e]] + s[-1] - ss)
        pp[:, 2] = -tunnel_depth(d)
        E_xyz[e] = pp
    log("tunnel edges", len(te), f"{E_len[te].sum() / 1e3:.0f} km")


def simplify3(p, tol=0.3):
    """Douglas-Peucker in 3D; keeps the ends."""
    n = len(p)
    if n <= 2:
        return p
    keep = np.zeros(n, bool); keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ab = p[b] - p[a]; L2 = float(ab @ ab)
        q = p[a + 1:b] - p[a]
        if L2 < 1e-12:
            d2 = (q * q).sum(1)
        else:
            t = np.clip(q @ ab / L2, 0, 1)
            r = q - t[:, None] * ab
            d2 = (r * r).sum(1)
        k = int(np.argmax(d2))
        if d2[k] > tol * tol:
            m = a + 1 + k
            keep[m] = True; stack.append((a, m)); stack.append((m, b))
    return p[keep]


for e in ae:
    E_xyz[e] = simplify3(E_xyz[e])

# ================================================================ per-tile sections
mid = np.zeros((NE, 2))
for e in ae:
    p = E_xyz[e]
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p[:, :2], axis=0).T))])
    mid[e] = [np.interp(s[-1] / 2, s, p[:, 0]), np.interp(s[-1] / 2, s, p[:, 1])]
ti = np.floor((mid[:, 0] - GRID_X0) / TILE).astype(int); tj = np.floor((mid[:, 1] - GRID_Y0) / TILE).astype(int)
tile_edges = {}
for e in ae:
    if 0 <= ti[e] < GRID_NX and 0 <= tj[e] < GRID_NY and not merged_in[e]:
        tile_edges.setdefault((int(ti[e]), int(tj[e])), []).append(int(e))
# the lanes as painted: each edge's stretch between its two junctions, cut at the tile borders (a tile paints what runs through it)
tile_paint = {}
for e in ae:
    if merged_in[e] or (dug[ek[e]] and not isdeck[e]):
        continue
    P = E_xyz[e]
    sg_ = np.hypot(*np.diff(P[:, :2], axis=0).T); sc = np.concatenate([[0], np.cumsum(sg_)]); L_ = sc[-1]
    tA, tB = TRIM[e, 0], TRIM[e, 1]
    fit_ = max(0.0, L_ - 1) / (tA + tB) if tA + tB > L_ - 1 else 1.0
    a_, b_ = tA * fit_, L_ - tB * fit_
    if b_ - a_ < 4.0:
        continue
    m = (sc > a_ + 0.05) & (sc < b_ - 0.05)
    ss = np.concatenate([[a_], sc[m], [b_]])
    Q = np.column_stack([np.interp(ss, sc, P[:, 0]), np.interp(ss, sc, P[:, 1]), np.interp(ss, sc, P[:, 2])])
    # cut at the grid lines
    ppts = [Q[0]]
    for u, v in zip(Q[:-1], Q[1:]):
        ts = []
        for ax, g0 in ((0, GRID_X0), (1, GRID_Y0)):
            lo, hi = (u[ax], v[ax]) if u[ax] < v[ax] else (v[ax], u[ax])
            for k in range(int(np.ceil((lo - g0) / TILE)), int(np.floor((hi - g0) / TILE)) + 1):
                g = g0 + k * TILE
                if lo < g < hi:
                    ts.append((g - u[ax]) / (v[ax] - u[ax]))
        for t in sorted(ts):
            ppts.append(u + (v - u) * t)
        ppts.append(v)
    ppts = np.array(ppts)
    mid = (ppts[:-1] + ppts[1:]) / 2
    ti_ = np.floor((mid[:, 0] - GRID_X0) / TILE).astype(int); tj_ = np.floor((mid[:, 1] - GRID_Y0) / TILE).astype(int)
    st = 0
    for k in range(1, len(mid) + 1):
        if k == len(mid) or ti_[k] != ti_[st] or tj_[k] != tj_[st]:
            if 0 <= ti_[st] < GRID_NX and 0 <= tj_[st] < GRID_NY:
                tile_paint.setdefault((int(ti_[st]), int(tj_[st])), []).append((int(e), ppts[st:k + 1]))
            st = k
tile_app = {}
for n in np.flatnonzero(arms >= 2):
    i, j = int((NPOS[n, 0] - GRID_X0) // TILE), int((NPOS[n, 1] - GRID_Y0) // TILE)
    if 0 <= i < GRID_NX and 0 <= j < GRID_NY:
        tile_app.setdefault((i, j), []).append(int(n))
# ================================================================ signs: street-name plates, direction boards, bus stops
#   signs section: UTF-8 JSON  { n: [[name, English name], ...],
#     p: name-plate poles at street corners, 6 numbers each: x, y, bearing of street A, its name, bearing of street B, its name
#     b: direction boards ahead of signalised junctions, 8 each: x, y (kerb), bearing of travel, distance to the middle of the road, two-way?, names ahead / left / right
#     s: bus stops, 5 each: x, y, bearing the shelter faces (towards the road), shelter (1) or just a pole (0), name }
#   x east, y north in metres from the tile's SW corner; bearings in degrees clockwise from north; names index n, -1 for none.
SW_ = A["SW"]
NAME = np.array([rt[k].get("name") or "" for k in ek], dtype=object)
NAME_EN = np.array([rt[k].get("name:en") or "" for k in ek], dtype=object)
deg_of = lambda v: float(np.degrees(np.arctan2(v[0], v[1])) % 360)
tile_signs = {}


def _tile_of(x, y):
    i, j = int((x - GRID_X0) // TILE), int((y - GRID_Y0) // TILE)
    return (i, j) if 0 <= i < GRID_NX and 0 <= j < GRID_NY else None


def _sg(t):
    return tile_signs.setdefault(t, dict(names={}, p=[], b=[], s=[]))


def _nm(g, e):
    key = (NAME[e], NAME_EN[e])
    if not key[0]:
        return -1
    return g["names"].setdefault(key, len(g["names"]))


# a sign may not stand in a carriageway or inside a building (corners worked out from road widths do not always fall on pavement)
_tr = np.flatnonzero(np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~area & ~tunnel & (~A["bridge"] | lowbr))
# (nor inside a ramp: the low stretch of a deck is a solid block)
_CW = shapely.STRtree(np.concatenate([shapely.buffer(R_GEOM[_tr], W0[_tr] / 2 + 0.25, quad_segs=2), shapely.buffer(LOWD_G, LOWD_W / 2 + 0.8, cap_style="flat", quad_segs=2) if len(LOWD_G) else np.array([], dtype=object)]))
_SB = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["geometry"]).geometry.values
_excl_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "landmark_exclusions.json")
_hero_blk = []
if os.path.exists(_excl_p):
    _ex = json.load(open(_excl_p))
    for _cc in _ex.get("circles", []):
        _hero_blk.append(shapely.Point(_cc["x"], _cc["y"]).buffer(float(_cc["r"]) + 2.0, quad_segs=16))
    for _pp in _ex.get("polygons", []):
        _hero_blk.append(shapely.Polygon(_pp).buffer(2.0, quad_segs=6))
# Also block street signs/poles within 22m ahead of every tunnel portal mouth (fixes p02 sign/pole blocking portal!)
for _kt in _tw:
    _ct = XYZ[_kt][0]
    if len(_ct) < 2:
        continue
    for _ei, _ni in ((0, 1), (-1, -2)):
        if int(vkey(_ct[[_ei]])[0]) in _open:
            _p0 = _ct[_ei]; _dv = _ct[_ni] - _p0; _ll = float(np.hypot(*_dv))
            if _ll > 0.2:
                _u = _dv / _ll
                _hero_blk.append(shapely.LineString([tuple(_p0 - _u * 22.0), tuple(_p0 + _u * 8.0)]).buffer(max(float(W0[_kt]) * 0.5 + 6.0, 12.0), cap_style="flat", quad_segs=2))
_SBT = shapely.STRtree(np.concatenate([_SB, np.array(_hero_blk, dtype=object)]) if _hero_blk else _SB)
n_blocked = [0]


def _blocked(pos, r=0.0):
    g = shapely.Point(float(pos[0]), float(pos[1]))
    if r:
        g = g.buffer(r, quad_segs=2)
    if len(_CW.query(g, predicate="intersects")) or len(_SBT.query(g, predicate="intersects")):
        n_blocked[0] += 1
        return True
    return False


n_plate = n_board = 0
FILLET = 4.5
for n in np.flatnonzero((arms >= 3) & node_ground & ~node_high):
    t = _tile_of(NPOS[n, 0], NPOS[n, 1])
    if t is None:
        continue
    A_ = []
    for q in range(nstart[n], nstart[n + 1]):
        e, end = inc_e[q], inc_end[q]
        b = BEAR[e, end]
        A_.append((np.arctan2(b[1], b[0]), e, end))
    A_.sort()
    corners = []
    for k in range(len(A_)):
        (a0, e0, _), (a1, e1, _) = A_[k], A_[(k + 1) % len(A_)]
        d = (a1 - a0) % (2 * np.pi)
        if not (np.radians(50) <= d <= np.radians(135)):
            continue
        if internal[e0] or internal[e1] or not ground_e[e0] or not ground_e[e1] or c_[e0] > 5 or c_[e1] > 5 or c_[e0] < 2 or c_[e1] < 2:
            continue
        if not NAME[e0] or not NAME[e1] or NAME[e0] == NAME[e1]:
            continue
        va, vb = np.array([np.cos(a0), np.sin(a0)]), np.array([np.cos(a1), np.sin(a1)])
        sn = np.sin(d)
        apex = NPOS[n, :2] + va * (Wm[e1] / 2 / sn) + vb * (Wm[e0] / 2 / sn)
        bis = (va + vb) / np.hypot(*(va + vb))
        pos = apex + bis * (FILLET / np.sin(d / 2) - FILLET + 0.9)
        corners.append((k, pos, e0, va, e1, vb))
    if not corners:
        continue
    pick = [corners[0]] + ([corners[len(corners) // 2]] if len(corners) >= 2 else [])
    g = _sg(t)
    for k, pos, e0, va, e1, vb in pick:
        if _blocked(pos, 0.2):
            continue
        g["p"] += [round(float(pos[0] - GRID_X0 - t[0] * TILE), 1), round(float(pos[1] - GRID_Y0 - t[1] * TILE), 1), round(deg_of(va), 1), _nm(g, e0), round(deg_of(vb), 1), _nm(g, e1)]
        n_plate += 1
def approach_line(e, end, need=170.0):
    """A road as it comes into a junction, from the junction outwards: the edge and, where that is short (ways are cut where
    the room beside them changes), the pieces of the same road before it."""
    p = E_xyz[e][:, :2] if end == 0 else E_xyz[e][::-1, :2]
    L = float(E_len[e]); n = int(eB[e] if end == 0 else eA[e]); pe = int(e)
    while L < need and arms[n] == 2:
        a1, a2 = int(inc_e[nstart[n]]), int(inc_e[nstart[n] + 1])
        nx = a2 if a1 == pe else a1
        if c_[nx] != c_[e] or not ground_e[nx]:
            break
        q = E_xyz[nx][:, :2] if eA[nx] == n else E_xyz[nx][::-1, :2]
        p = np.vstack([p, q[1:]]); L += float(E_len[nx]); n = int(eB[nx] if eA[nx] == n else eA[nx]); pe = nx
    return p, L


for r, ext in SIG_EXT.items():
    for e, end in ext:
        if c_[e] > 3 or not ground_e[e] or (one[e] and end == 0):
            continue
        p, L_app = approach_line(e, end)
        if L_app < 110:
            continue
        b = BEAR[e, end]; tdir = -b; left = np.array([-tdir[1], tdir[0]])
        pick = {}
        for e2, end2 in ext:
            if e2 == e:
                continue
            b2 = BEAR[e2, end2]
            kind = "a" if b2 @ tdir > 0.8 else "l" if b2 @ left > 0.6 else "r" if b2 @ -left > 0.6 else None
            if kind and NAME[e2] and (kind not in pick or rank[e2] < rank[pick[kind]]):
                pick[kind] = e2
        if "l" not in pick and "r" not in pick:
            continue
        # 42 m before the stop line, on the kerb to the right of the traffic
        sc = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
        D = STOP[e, end] + 42.0
        if sc[-1] < D + 25:
            continue
        q0 = np.array([np.interp(D, sc, p[:, 0]), np.interp(D, sc, p[:, 1])]); q1 = np.array([np.interp(D + 6, sc, p[:, 0]), np.interp(D + 6, sc, p[:, 1])])
        tl = (q0 - q1) / max(np.hypot(*(q0 - q1)), 1e-6)                 # direction of travel here (towards the junction)
        rgt = np.array([tl[1], -tl[0]])
        halfw = Wm[e] / 2
        pos = q0 + rgt * (halfw + 0.9)
        t = _tile_of(pos[0], pos[1])
        if t is None or _blocked(pos, 0.25):
            continue
        g = _sg(t)
        g["b"] += [round(float(pos[0] - GRID_X0 - t[0] * TILE), 1), round(float(pos[1] - GRID_Y0 - t[1] * TILE), 1), round(deg_of(tl), 1), round(float(halfw + 0.9), 1), 0 if one[e] else 1,
                   _nm(g, pick["a"]) if "a" in pick else _nm(g, e), _nm(g, pick["l"]) if "l" in pick else -1, _nm(g, pick["r"]) if "r" in pick else -1]
        n_board += 1
# bus stops: OSM points beside the streets, moved onto the pavement, facing the road
_bs = pts[(pts.kind == "highway=bus_stop") & pts["name"].notna()]
_bx, _by = to_local(_bs.geometry.x.values, _bs.geometry.y.values)
_street = np.flatnonzero(np.isin(cls, [2, 3, 4, 5]) & ~area & ~A["bridge"] & ~tunnel)
_stree = shapely.STRtree(R_GEOM[_street])
_near = _stree.nearest(shapely.points(_bx, _by))
n_stop = 0
for k, (x, y, nme) in enumerate(zip(_bx, _by, _bs["name"].values)):
    w = _street[_near[k]]
    ln_ = R_GEOM[w]; pt = shapely.Point(x, y)
    if ln_.distance(pt) > 22:
        continue
    sd = ln_.project(pt); q0 = ln_.interpolate(sd); q1 = ln_.interpolate(min(sd + 4, ln_.length)); q2 = ln_.interpolate(max(sd - 4, 0))
    tv = np.array([q1.x - q2.x, q1.y - q2.y]); tv /= max(np.hypot(*tv), 1e-6)
    nv = np.array([-tv[1], tv[0]])
    side = 1.0 if (x - q0.x) * nv[0] + (y - q0.y) * nv[1] >= 0 else -1.0
    if oneway[w] and side > 0:
        side = -1.0                                   # buses run on the right
    roomy = SW_[w] >= 3.0
    pos = np.array([q0.x, q0.y]) + nv * side * (W0[w] / 2 + (1.0 if roomy else 0.6))
    t = _tile_of(pos[0], pos[1])
    if t is None or _blocked(pos, 0.5 if roomy else 0.2):
        continue
    g = _sg(t)
    g["s"] += [round(float(pos[0] - GRID_X0 - t[0] * TILE), 1), round(float(pos[1] - GRID_Y0 - t[1] * TILE), 1), round(deg_of(-nv * side), 1), 1 if roomy else 0, g["names"].setdefault((str(nme), ""), len(g["names"]))]
    n_stop += 1
log("signs: corner poles", n_plate, "direction boards", n_board, "bus stops", n_stop, "in", len(tile_signs), "tiles;", n_blocked[0], "left out (in a carriageway or a building)")
del _SB, _SBT

FLAGS = (one * 1) | (isdeck * 2) | ((dug[ek] & ~isdeck) * 4) | ((pside > 0) * 8) | (park * 16) | (isRb * 32)
u8 = lambda v, s=1.0: int(np.clip(round(float(v) * s), 0, 255))


def write_tile(ij):
    i, j = ij
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    es = tile_edges.get(ij, [])
    rec = b""; xy = []; zz = []
    ne = 0
    for e in es:
        p = E_xyz[e]
        q = np.round((p[:, :2] - (ox, oy)) * 10).astype(np.int64)
        keep = np.concatenate([[True], np.any(np.diff(q, axis=0) != 0, axis=1)])
        q = q[keep]; z = np.round(p[keep, 2] * 20).astype(np.int64)
        if len(q) < 2 or np.abs(q).max() > 32000:
            continue
        dlt = np.diff(np.vstack([np.zeros((1, 2), np.int64), q]), axis=0)
        rec += struct.pack("<IIBBBBBbBBBBBBBBHHHIIBBH", int(MG[eA[e]]), int(MG[eB[e]]), int(c_[e]), int(FLAGS[e]), int(nf[e]), int(nb[e]),
                           u8(lw[e], 20), int(np.clip(round(shift[e] * 10), -127, 127)), u8(Wm[e], 4), int(spd[e]),
                           u8(TRIM[e, 0], 2), u8(TRIM[e, 1], 2), u8(STOP[e, 0], 2), u8(STOP[e, 1], 2), int(CTRL[e, 0]), int(CTRL[e, 1]), len(q), int(PHASE[e, 0]), int(PHASE[e, 1]),
                           int(REACH[eA[e]]), int(REACH[eB[e]]), int(SUB[eA[e]]), int(SUB[eB[e]]), 0)
        xy.append(dlt); zz.append(z); ne += 1
    app = b""; na = 0
    for n in tile_app.get(ij, []):
        for q in range(nstart[n], nstart[n + 1]):
            e, end = inc_e[q], inc_end[q]
            b = BEAR[e, end]
            brg = int(round(np.degrees(np.arctan2(b[0], b[1])) % 360 / 360 * 256)) & 255
            arrives = 1 if (end == 1 or not one[e]) else 0          # traffic reaches this node along the edge
            leaves = 2 if (end == 0 or not one[e]) else 0
            app += struct.pack("<hhBBHBBBB", int(round((NPOS[n, 0] - ox) * 10)), int(round((NPOS[n, 1] - oy) * 10)), brg, int(CTRL[e, end]), int(PHASE[e, end]),
                               u8(TRIM[e, end], 2), u8(STOP[e, end], 2), int(c_[e]), arrives | leaves | (4 if isdeck[e] or (dug[ek[e]]) else 0))
            na += 1
    paint = b""; pv = []
    for e, pts in tile_paint.get(ij, []):
        q = np.column_stack([np.clip(np.round((pts[:, :2] - (ox, oy)) * 10), -32000, 32000), np.clip(np.round(pts[:, 2] * 20), -32000, 32000)]).astype("<i2")
        paint += struct.pack("<BBBBbBBBHH", int(one[e]) | (2 if isdeck[e] else 0), int(nf[e]), int(nb[e]), u8(lw[e], 20), int(np.clip(round(shift[e] * 10), -127, 127)), int(c_[e]), u8(Wm[e], 4), 0, len(q), 0)
        pv.append(q)
    if not ne and not na and not pv:
        return ij, 0, 0
    xy = np.vstack(xy).astype("<i2") if xy else np.zeros((0, 2), "<i2")
    zz = np.concatenate(zz).astype("<i2") if zz else np.zeros(0, "<i2")
    pv = np.vstack(pv) if pv else np.zeros((0, 3), "<i2")
    blob = struct.pack("<III", ne, len(xy), na) + rec + xy.tobytes() + pad4(zz.tobytes()) + app + struct.pack("<II", len(tile_paint.get(ij, [])), len(pv)) + paint + pv.tobytes()
    open(os.path.join(WORK, "sections", "traffic", f"{i}_{j}.bin"), "wb").write(pad4(blob))
    return ij, ne, len(blob)


# ================================================================ walking loops
# Pedestrians walk closed circuits (flags=0) OR open ping-pong centerlines (flags=1, Phase 5 contract — ZERO 0.45m hairpins!):
#   walks section: u32 nloops, nv | u8 activity (0..255: how busy the pavements here are), pad x3 |
#                  per loop: u8 kind (0 pavement, 1 pedestrian street, 2 square, 3 path), u8 flags (bit0=1 open ping-pong, 0 closed ring), u16 npts | i16 xy (dm, first absolute, then deltas)
MW = 320.0
RC = 2.9
import shapely.ops
bridge_ = A["bridge"]
SWk = A["SW"].astype(float).copy()
_rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring")
_outer = _rings.geometry[3].buffer(2500); shapely.prepare(_outer)
SWk[(cls == 5) & ~shapely.intersects(_outer, R_GEOM)] = 0
VEHk = (cls >= 0) & (cls != 8) & (cls != 9) & (~bridge_ | lowbr) & ~tunnel & ~area
SWALK = VEHk & (SWk > 0)
TRAF = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~area & ~tunnel & (~bridge_ | lowbr)      # carriageways with traffic, at street level
RLEN = shapely.length(R_GEOM)
_fk = np.array([t.get("footway") for t in rt], dtype=object)
_hw = roads.highway.values
PSTREET = (cls == 8) & ~tunnel & ~area & (~bridge_ | lowbr)
PPATH = (cls == 9) & np.isin(_hw, ["footway", "path"]) & ~np.isin(_fk, ["sidewalk", "crossing", "traffic_island", "access_aisle"]) & (RLEN >= 25) & ~tunnel & ~area & (~bridge_ | lowbr)
ROAD_TREE = shapely.STRtree(R_GEOM)
_areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
def _at_street_level(tags):
    t = json.loads(tags)
    return not (t.get("layer") not in (None, "0") or t.get("level") not in (None, "0") or t.get("bridge") not in (None, "no") or t.get("tunnel") not in (None, "no")
                or t.get("indoor") not in (None, "no") or t.get("location") in ("underground", "overhead", "roof", "rooftop") or t.get("man_made") == "bridge")


_pa = np.array([("highway=pedestrian_area" in k or "highway=footway_area" in k or "place=square" in k) for k in _areas.kinds.values]) & np.array([_at_street_level(t) for t in _areas.tags.values])
PA_GEOM = shapely.make_valid(project_geoms(_areas.geometry.values[_pa]))
PA_TREE = shapely.STRtree(PA_GEOM)
# how busy: shops, restaurants, metro entrances and floor space around
_pk = pts.kind.values.astype(str)
_px, _py = to_local(pts.geometry.x.values, pts.geometry.y.values)
_com = np.array([k.startswith(("shop=", "amenity=restaurant", "amenity=cafe", "amenity=fast_food", "amenity=bank", "amenity=bar", "railway=subway_entrance", "tourism=hotel", "tourism=attraction", "amenity=marketplace")) for k in _pk])
_act = np.zeros((GRID_NX, GRID_NY)); _fa = np.zeros((GRID_NX, GRID_NY))
_i = ((_px[_com] - GRID_X0) // TILE).astype(int); _j = ((_py[_com] - GRID_Y0) // TILE).astype(int)
_ok = (_i >= 0) & (_i < GRID_NX) & (_j >= 0) & (_j < GRID_NY)
np.add.at(_act, (_i[_ok], _j[_ok]), 1)
# Phase 5: read finalized non-overlapping buildings_packed.parquet (exact match to CQT2 tiles & collision.js!)
_bp_path = os.path.join(WORK, "buildings_packed.parquet")
_b = gpd.read_parquet(_bp_path if os.path.exists(_bp_path) else os.path.join(WORK, "buildings.parquet"), columns=["geometry", "height"])
B_GEOM = _b.geometry.values
B_TREE = shapely.STRtree(B_GEOM)
P_TREE = shapely.STRtree(R_GEOM[PSTREET | PPATH])
_c = shapely.centroid(_b.geometry.values)
_i = ((shapely.get_x(_c) - GRID_X0) // TILE).astype(int); _j = ((shapely.get_y(_c) - GRID_Y0) // TILE).astype(int)
_ok = (_i >= 0) & (_i < GRID_NX) & (_j >= 0) & (_j < GRID_NY)
np.add.at(_fa, (_i[_ok], _j[_ok]), (shapely.area(_b.geometry.values) * np.maximum(_b.height.values, 3.0) / 3.3)[_ok])
from scipy.ndimage import uniform_filter
ACT = np.clip(0.55 * (0.5 * _act + 0.5 * uniform_filter(_act, 3)) / 40.0 + 0.6 * (0.5 * _fa + 0.5 * uniform_filter(_fa, 3)) / 2.2e6, 0, 1)
del _c

# Phase 5: Unified walk obstruction index (hero landmarks + Jiefangbei 48x48m terrace + bridge abutments + ALL 904 tunnel portals + rivers)
_ex_shapes = []
_excl_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "landmark_exclusions.json")
if os.path.exists(_excl_p):
    _ex = json.load(open(_excl_p))
    for _cc2 in _ex.get("circles", []):
        _rr = float(_cc2["r"]) + 2.5
        if _cc2.get("name") == "jiefangbei":
            _rr = max(_rr, 38.0)  # full 48x48m rotated granite terrace retaining wall + planters!
        _ex_shapes.append(shapely.Point(_cc2["x"], _cc2["y"]).buffer(_rr, quad_segs=20))
    for _pp2 in _ex.get("polygons", []):
        _ex_shapes.append(shapely.Polygon(_pp2).buffer(2.5, quad_segs=3))
_lm_p = os.path.join(WORK, "..", "..", "site", "data", "landmarks.json")
if os.path.exists(_lm_p):
    _lm2 = json.load(open(_lm_p))
    for _br in _lm2.get("bridges", []):
        if _br.get("p0"):
            _ex_shapes.append(shapely.Point(_br["p0"][0], -_br["p0"][1]).buffer(28.0, quad_segs=16))
        if _br.get("p1"):
            _ex_shapes.append(shapely.Point(_br["p1"][0], -_br["p1"][1]).buffer(28.0, quad_segs=16))
    for _cw_k in ("north", "south"):
        _cw = (_lm2.get("cableway") or {}).get(_cw_k)
        if _cw:
            _ex_shapes.append(shapely.Point(_cw["x"], -_cw["z"]).buffer(36.0, quad_segs=16))
_tun_p = os.path.join(WORK, "..", "..", "site", "data", "tunnels.json")
if os.path.exists(_tun_p):
    for _tp in json.load(open(_tun_p)):
        _px2, _py2 = float(_tp["x"]), -float(_tp["z"])
        _dx2, _dy2 = float(_tp["dx"]), -float(_tp["dz"])
        _L2 = max(float(np.hypot(_dx2, _dy2)), 1e-6)
        _ux2, _uy2 = _dx2 / _L2, _dy2 / _L2
        _nx2, _ny2 = -_uy2, _ux2
        _hw2 = float(max(6.5, _tp.get("width", 10.0))) * 0.5 + 6.5
        # Oriented box covering -14m inside tunnel mouth to +9m in front of headwall/wing walls
        _ex_shapes.append(shapely.Polygon([
            (_px2 - _ux2 * 14.0 - _nx2 * _hw2, _py2 - _uy2 * 14.0 - _ny2 * _hw2),
            (_px2 + _ux2 * 9.0  - _nx2 * _hw2, _py2 + _uy2 * 9.0  - _ny2 * _hw2),
            (_px2 + _ux2 * 9.0  + _nx2 * _hw2, _py2 + _uy2 * 9.0  + _ny2 * _hw2),
            (_px2 - _ux2 * 14.0 + _nx2 * _hw2, _py2 - _uy2 * 14.0 + _ny2 * _hw2),
        ]))
_riv_p = os.path.join(WORK, "two_rivers.json")
if os.path.exists(_riv_p):
    _ex_shapes.append(shapely.from_wkt(json.load(open(_riv_p))).buffer(2.0, quad_segs=3))
EX_GEOM = np.array([shapely.make_valid(s) for s in _ex_shapes if s is not None and not s.is_empty], dtype=object)
EX_TREE = shapely.STRtree(EX_GEOM) if len(EX_GEOM) else None
TS_WALK = TerrainSampler(WORK)
log("walk activity: mean", float(ACT.mean().round(3)), "max", float(ACT.max().round(2)), "walk exclusions:", len(EX_GEOM))


def _polys(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [q for q in getattr(g, "geoms", []) if q.geom_type == "Polygon"]


def _lines(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    out = []
    for q in getattr(g, "geoms", []):
        out += _lines(q)
    return out


def _trim_steep_line(line, closed):
    """Split a walk polyline wherever DEM terrain slope > 23.5 deg, along-grade > 0.38, or elevation <= 0.30m (water).
    Returns (all_ok_closed_bool, list_of_LineStrings)."""
    L = float(line.length)
    if L < 10.0:
        return False, []
    ds = 1.5
    n = max(4, int(round(L / ds)))
    dists = np.linspace(0.0, L, n, endpoint=not closed)
    pts = shapely.line_interpolate_point(line, dists)
    xy = shapely.get_coordinates(pts)
    x, y = xy[:, 0], xy[:, 1]
    z = TS_WALK.sample(x, y)
    # Central-difference slope magnitude on 1.5m stencil
    gx = (TS_WALK.sample(x + 1.5, y) - TS_WALK.sample(x - 1.5, y)) / 3.0
    gy = (TS_WALK.sample(x, y + 1.5) - TS_WALK.sample(x, y - 1.5)) / 3.0
    grad = np.hypot(gx, gy)
    pt_ok = (z > 0.30) & (grad <= 0.435)
    # Check segment along-path grade
    if closed:
        dz = np.abs(np.roll(z, -1) - z)
        seg_d = np.hypot(np.roll(x, -1) - x, np.roll(y, -1) - y)
        seg_ok = pt_ok & np.roll(pt_ok, -1) & (dz / np.maximum(seg_d, 0.5) <= 0.38)
        if seg_ok.all():
            return True, [line]
        # Extract continuous walkable open runs along broken ring
        runs = []
        cur = []
        for k in range(n):
            if seg_ok[k]:
                if not cur:
                    cur.append(k)
                cur.append((k + 1) % n)
            elif cur:
                runs.append(cur); cur = []
        if cur:
            runs.append(cur)
        if len(runs) > 1 and runs[0][0] == 0 and runs[-1][-1] == 0:
            runs[0] = runs[-1][:-1] + runs[0]
            runs.pop()
        out = []
        for r in runs:
            if len(r) >= 2:
                ls = shapely.LineString(xy[r])
                if ls.length >= 12.0:
                    out.append(ls)
        return False, out
    else:
        dz = np.abs(z[1:] - z[:-1])
        seg_d = np.hypot(x[1:] - x[:-1], y[1:] - y[:-1])
        seg_ok = pt_ok[:-1] & pt_ok[1:] & (dz / np.maximum(seg_d, 0.5) <= 0.38)
        if seg_ok.all():
            return False, [line]
        runs = []
        cur = []
        for k in range(len(seg_ok)):
            if seg_ok[k]:
                if not cur:
                    cur.append(k)
                cur.append(k + 1)
            elif cur:
                runs.append(cur); cur = []
        if cur:
            runs.append(cur)
        out = []
        for r in runs:
            if len(r) >= 2:
                ls = shapely.LineString(xy[r])
                if ls.length >= 12.0:
                    out.append(ls)
        return False, out


def _close_gap_guard(c):
    """Ensure closing chord hypot(c[-1] - c[0]) <= 2.4m so peopleGeom.js (endGap <= 3.0m) ALWAYS detects closed rings!"""
    if len(c) < 3:
        return c
    d = float(np.hypot(c[-1, 0] - c[0, 0], c[-1, 1] - c[0, 1]))
    if d <= 2.4:
        return c
    t = max(0.0, 1.0 - 1.5 / d)
    extra = c[-1] + (c[0] - c[-1]) * t
    return np.vstack([c, extra[None, :]])


def write_walks(ij):
    i, j = ij
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    tile = shapely.box(ox, oy, ox + TILE, oy + TILE)
    win = (ox - MW, oy - MW, ox + TILE + MW, oy + TILE + MW)
    winb = shapely.box(*win)
    clip = shapely.box(win[0] - 40, win[1] - 40, win[2] + 40, win[3] + 40)
    idx = ROAD_TREE.query(winb)
    loops = []       # (kind, flags, coords): flags=0 closed ring, flags=1 open ping-pong centerline
    # Nobody walks in a lane that carries traffic: generous +1.05m past carriageway kerb (closes narrow divided-road medians!)
    tr = idx[TRAF[idx]]
    mask = shapely.union_all(shapely.buffer(shapely.intersection(R_GEOM[tr], clip), np.maximum(W0[tr], WD[tr]) / 2 + 1.05, quad_segs=3)) if len(tr) else None
    if mask is not None and mask.is_empty:
        mask = None
    if LOWD_TREE is not None:
        ld = LOWD_TREE.query(winb)
        if len(ld):
            ramps = shapely.union_all(shapely.buffer(shapely.intersection(LOWD_G[ld], clip), LOWD_W[ld] / 2 + 1.35, cap_style="flat", quad_segs=2))
            if not ramps.is_empty:
                mask = ramps if mask is None else shapely.union(mask, ramps)
    if EX_TREE is not None:
        ek = EX_TREE.query(winb)
        if len(ek):
            ex_u = shapely.union_all(shapely.intersection(EX_GEOM[ek], clip))
            if not ex_u.is_empty:
                mask = ex_u if mask is None else shapely.union(mask, ex_u)
    if mask is not None:
        shapely.prepare(mask)

    def emit(line, kind, closed):
        """A walking path: a 100%-clear closed circuit (flags=0), OR clean open ping-pong centerlines (flags=1, ZERO hairpins!)."""
        was_cut = False
        cut_ = mask if mask is not None and shapely.intersects(mask, line) else None
        # Building clearance +1.40m guarantees >=1.05m wall clearance even at max people.js lateral offset (+0.35m) & 3D facadeKit!
        bk = B_TREE.query(line.buffer(1.45), predicate="intersects")
        if len(bk):
            walls = shapely.buffer(shapely.union_all(B_GEOM[bk]), 1.40, quad_segs=2)
            cut_ = walls if cut_ is None else shapely.union(cut_, walls)
        if cut_ is not None:
            rest = shapely.line_merge(shapely.difference(shapely.LineString(line.coords), cut_))
            # If the cut actually touched or split the line, treat resulting pieces as open ping-pong runs
            if closed and rest.geom_type == "LineString" and rest.is_ring and abs(rest.length - line.length) < 0.5:
                pieces = [rest]
            else:
                was_cut = True
                pieces = []
                for q in _lines(rest):
                    if q.length > 14.0:
                        pieces.append(shapely.ops.substring(q, 0.9, q.length - 0.9))
                    elif q.length >= 12.0:
                        pieces.append(q)
        elif closed:
            pieces = [line] if line.length > 12.0 else []
        else:
            pieces = [line] if line.length >= 12.0 else []

        for q in pieces:
            still_closed = closed and (not was_cut) and q.is_ring
            if still_closed:
                # Reject thin dead-end hairpin strips (area / perimeter < 1.25m) -> break into smooth open ping-pong!
                p_chk = shapely.Polygon(q)
                if p_chk.area / max(q.length, 1e-6) < 1.25:
                    still_closed = False
            ok_closed, sub_lines = _trim_steep_line(q, still_closed)
            if ok_closed and len(sub_lines) == 1:
                c = np.asarray(sub_lines[0].simplify(0.25).coords)[:-1]
                if len(c) >= 3:
                    loops.append((kind, 0, _close_gap_guard(c)))
            else:
                for sl in sub_lines:
                    if sl.length < 12.0:
                        continue
                    c = np.asarray(sl.simplify(0.25).coords)
                    if len(c) >= 2:
                        loops.append((kind, 1, c))

    def take(u, kind, islands=False):
        for p in _polys(u):
            for h, r in enumerate([p.exterior] + list(p.interiors)):
                b = r.bounds
                whole = b[0] > win[0] + 0.5 and b[1] > win[1] + 0.5 and b[2] < win[2] - 0.5 and b[3] < win[3] - 0.5 and max(b[2] - b[0], b[3] - b[1]) <= MW
                if whole:
                    inner = shapely.Polygon(r)
                    c = inner.representative_point() if kind == 0 else r.centroid
                    if not (ox <= c.x < ox + TILE and oy <= c.y < oy + TILE):
                        continue
                    if islands and h > 0 and inner.area < 60000:
                        if not (len(B_TREE.query(inner, predicate="intersects")) or len(P_TREE.query(inner, predicate="intersects")) or len(PA_TREE.query(inner, predicate="intersects"))):
                            continue
                    emit(r, kind, True)
                else:
                    for part in _lines(shapely.line_merge(shapely.intersection(r, tile))):
                        emit(part, kind, False)

    sw = idx[SWALK[idx]]
    if len(sw):
        ln = shapely.intersection(R_GEOM[sw], clip)
        u = shapely.union_all(shapely.buffer(ln, np.maximum(W0[sw], WD[sw]) / 2 + np.clip(SWk[sw] - 1.0, 1.55, 2.35), quad_segs=3))
        u = shapely.buffer(shapely.buffer(u, RC, quad_segs=4), -RC, quad_segs=4)
        take(u, 0, True)
    ps = idx[PSTREET[idx]]
    if len(ps):
        # Wide pedestrian boulevards (>= 6.5m) get comfortable wide loops; narrow lanes emit clean open ping-pong centerlines (ZERO hairpins!)
        wide_m = W0[ps] >= 6.5
        if wide_m.any():
            pw = ps[wide_m]
            ln = shapely.intersection(R_GEOM[pw], clip)
            r1 = np.minimum(1.8, W0[pw] / 2 - 0.8); r2 = np.minimum(3.6, W0[pw] / 2 - 0.8)
            take(shapely.union_all(shapely.buffer(ln, np.maximum(r1, 1.5), quad_segs=3)), 1)
            m2 = r2 - r1 > 1.0
            if m2.any():
                take(shapely.union_all(shapely.buffer(ln[m2], r2[m2], quad_segs=3)), 1)
        if (~wide_m).any():
            pn = ps[~wide_m]
            ln = shapely.line_merge(shapely.intersection(shapely.union_all(R_GEOM[pn]), tile))
            for part in _lines(ln):
                emit(part, 1, False)
    for k in PA_TREE.query(winb):
        g = PA_GEOM[k]
        if g.area < 150:
            continue
        g = shapely.intersection(g, winb)
        if mask is not None:
            g = shapely.difference(g, mask)
        bk = B_TREE.query(g.buffer(1.45), predicate="intersects")
        if len(bk):
            g = shapely.difference(g, shapely.buffer(shapely.union_all(B_GEOM[bk]), 1.45, quad_segs=2))
        for d in (2.5, 6.5, 11.5):
            q = shapely.buffer(g, -d, quad_segs=3)
            if q.is_empty:
                break
            take(q, 2)
    pp = idx[PPATH[idx]]
    if len(pp):
        # Phase 5: emit park/footpaths directly as clean open ping-pong centerlines (flags=1) — ZERO 0.55m hairpin loops!
        ln = shapely.line_merge(shapely.intersection(shapely.union_all(R_GEOM[pp]), tile))
        for part in _lines(ln):
            emit(part, 3, False)
    if not loops:
        return ij, 0, 0, 0.0
    head = b""; xy = []; n = 0; km = 0.0
    for kind, flg, c in loops:
        q = np.round((c[:, :2] - (ox, oy)) * 10).astype(np.int64)
        keep = np.concatenate([[True], np.any(np.diff(q, axis=0) != 0, axis=1)])
        q = q[keep]
        min_v = 2 if (flg & 1) else 3
        if len(q) < min_v or len(q) > 65000 or np.abs(q).max() > 32000:
            continue
        head += struct.pack("<BBH", kind, flg, len(q))
        xy.append(np.diff(np.vstack([np.zeros((1, 2), np.int64), q]), axis=0))
        n += 1
        pts_l = c[:, :2] if (flg & 1) else np.vstack([c[:, :2], c[:1, :2]])
        km += float(np.hypot(*np.diff(pts_l, axis=0).T).sum()) / 1e3
    if not n:
        return ij, 0, 0, 0.0
    xy = np.vstack(xy).astype("<i2")
    blob = struct.pack("<IIBBBB", n, len(xy), int(round(ACT[i, j] * 255)), 0, 0, 0) + head + xy.tobytes()
    open(os.path.join(WORK, "sections", "walks", f"{i}_{j}.bin"), "wb").write(pad4(blob))
    return ij, n, len(blob), km


if __name__ == "__main__":
    todo = [(i, j) for i in range(RANGE[0], RANGE[2]) for j in range(RANGE[1], RANGE[3])]
    if os.environ.get("SH3D_ONLY") != "walks":
        os.makedirs(os.path.join(WORK, "sections", "traffic"), exist_ok=True)
        for f in os.listdir(os.path.join(WORK, "sections", "traffic")):
            os.remove(os.path.join(WORK, "sections", "traffic", f))
        tot = nb_ = 0
        with get_context("fork").Pool(PROCS) as pool:
            for ij, n, b in pool.imap_unordered(write_tile, todo, chunksize=16):
                tot += n; nb_ += b
        log("traffic sections:", tot, "edges,", f"{nb_ / 1e6:.1f} MB raw")
        if os.environ.get("SH3D_ONLY") == "traffic":            # (working on the graph: the signs and the walking loops stay as they are)
            sys.exit(0)
        os.makedirs(os.path.join(WORK, "sections", "signs"), exist_ok=True)
        for f in os.listdir(os.path.join(WORK, "sections", "signs")):
            os.remove(os.path.join(WORK, "sections", "signs", f))
        nb_ = 0
        for (i, j), g in tile_signs.items():
            names = [None] * len(g["names"])
            for key, k in g["names"].items():
                names[k] = list(key)
            blob = json.dumps(dict(n=names, p=g["p"], b=g["b"], s=g["s"]), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            open(os.path.join(WORK, "sections", "signs", f"{i}_{j}.bin"), "wb").write(blob + b" " * ((4 - len(blob) % 4) % 4))      # (padded with spaces: still JSON)
            nb_ += len(blob)
        log("sign sections:", len(tile_signs), "tiles,", f"{nb_ / 1e6:.1f} MB raw")
    os.makedirs(os.path.join(WORK, "sections", "walks"), exist_ok=True)
    for f in os.listdir(os.path.join(WORK, "sections", "walks")):
        os.remove(os.path.join(WORK, "sections", "walks", f))
    tot = nb_ = 0; km = 0.0
    with get_context("fork").Pool(PROCS) as pool:
        for ij, n, b, k_ in pool.imap_unordered(write_walks, todo, chunksize=8):
            tot += n; nb_ += b; km += k_
    log("walk sections:", tot, "loops,", f"{km:.0f} km, {nb_ / 1e6:.1f} MB raw")
    if os.environ.get("SH3D_ONLY") == "walks":
        sys.exit(0)
    # Export 3D tunnel portals (`site/data/tunnels.json`) for tunnels.js: [{ x, z, y, dx, dz, width, cls, name }]
    # (x east, z south in WebGL; (dx, dz) unit vector pointing INTO the tunnel; y sampled from road-benched TerrainSampler)
    _ts_p = TerrainSampler(WORK)
    raw_portals = []
    for k in _tw:
        c = XYZ[k][0]
        if len(c) < 2:
            continue
        for end_i, nxt_i in ((0, 1), (-1, -2)):
            vk = int(vkey(c[[end_i]])[0])
            if vk not in _open:
                continue
            p0 = c[end_i]
            # Look a few metres along tunnel so short entry kinks don't skew portal angle
            seg_d = c[nxt_i] - p0
            s_acc = float(np.hypot(*seg_d))
            step_i = nxt_i
            di = 1 if end_i == 0 else -1
            while s_acc < 8.0 and 0 <= step_i + di < len(c):
                step_i += di
                seg_d = c[step_i] - p0
                s_acc = float(np.hypot(*seg_d))
            if s_acc < 0.3:
                continue
            ux, uy = float(seg_d[0] / s_acc), float(seg_d[1] / s_acc)
            # WebGL frame: x = px, z = -py, dx = ux, dz = -uy (points INTO tunnel!)
            wx, wz = float(p0[0]), float(-p0[1])
            wy = float(_ts_p.sample(p0[0], p0[1]))
            if wy < 1.0 or not (X_MIN <= p0[0] <= X_MAX and Y_MIN <= p0[1] <= Y_MAX):
                continue  # skip underwater or out-of-extent bores
            raw_portals.append((wx, wz, wy, ux, -uy, float(max(W0[k], 6.5)), int(cls[k]), rt[k].get("name") or ""))
    # Deduplicate portal mouths within 4.5m pointing in the same direction (merge overlapping OSM splits, keep dual bores!)
    portals = []
    for wx, wz, wy, dx, dz, pw, pc, pnm in raw_portals:
        merged = False
        for p in portals:
            if (p["x"] - wx) ** 2 + (p["z"] - wz) ** 2 < 20.25 and (p["dx"] * dx + p["dz"] * dz) > 0.65:
                p["width"] = round(max(p["width"], pw), 1)
                merged = True
                break
        if not merged:
            portals.append(dict(
                x=round(wx, 2), z=round(wz, 2), y=round(wy, 2),
                dx=round(dx, 4), dz=round(dz, 4),
                width=round(pw, 1), cls=pc, name=pnm,
            ))
    _site_data = os.path.join(WORK, "..", "..", "site", "data")
    os.makedirs(_site_data, exist_ok=True)
    json.dump(portals, open(os.path.join(_site_data, "tunnels.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    log(f"tunnels.json exported: {len(portals)} deduplicated 3D tunnel portals (from {len(raw_portals)} raw mouths)")
    json.dump(dict(edges=int(alive.sum()), km=float(E_len[alive].sum() / 1e3), signals=nsig, giveway=nprio, portals=len(portals)), open(os.path.join(WORK, "traffic_stats.json"), "w"))
