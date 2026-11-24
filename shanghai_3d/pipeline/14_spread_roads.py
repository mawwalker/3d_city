"""Carriageways mapped too close together are moved apart, as far as their lanes need.

The map draws the two directions of a divided road as two lines, and often draws them closer together than the road is wide:
two carriageways of four lanes each seven metres apart, a street hugging the ramp of the underpass beside it. Built as
mapped the two would lie on top of each other, and the earlier way out (each carriageway narrowed to the room it had, lanes
given up until what was left fitted) made one-lane roads of four-lane ones: a quarter of the streets with a lanes tag had
fewer lanes than the map says, and queues stood where four lanes ran into one.

Here the lines move instead. Every way that carries traffic is walked in stations 10 m apart; where a station has another
way abreast of it, running the same or the opposite way at the same level, and nearer than the two carriageways need for
their lanes at 3 m each, both are pushed apart by half of what is missing. The displacement is smoothed along the roads (so
a line leaves its mapped course and comes back to it over some tens of metres), vertices shared between ways move as one
(junctions stay junctions; the streets, footways and service roads that meet a moved vertex follow it), and nothing moves
more than 12 m. Slip roads near the point where they leave or join their road are left alone: there the two belong together.

Reads work/osm_roads.parquet as 12_flyovers.py wrote it (kept as work/osm_roads_unspread.parquet the first time), writes it
back with the moved geometry and a `spread` column (metres the way moved at most).

usage: 14_spread_roads.py <work_dir> [--dry]
"""
import sys, os, json, time, shutil
import numpy as np, pandas as pd, geopandas as gpd, shapely
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from lanes import road_lanes, num

WORK = sys.argv[1]
DRY = "--dry" in sys.argv
T0 = time.time()
DS = 10.0            # stations
GAP = 1.2            # between two carriageways (kerbs, a fence, the paint)
TAPER = 60.0        # two ways that meet: left alone this far from the point where they do
UMAX = 12.0          # no vertex moves further than this
LVL = 2.4            # two ways within this height of each other are on the same ground


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


cur, keep = os.path.join(WORK, "osm_roads.parquet"), os.path.join(WORK, "osm_roads_unspread.parquet")
roads = gpd.read_parquet(cur)
if "spread" in roads.columns:
    roads = gpd.read_parquet(keep)             # already processed once: start again from the table as 12_flyovers.py left it
elif not DRY:
    shutil.copyfile(cur, keep)
roads = roads.reset_index(drop=True)
rt = [json.loads(t) for t in roads["tags"].values]
hw = roads.highway.values
LM = road_lanes(hw, rt)
cls, oneway, nfl, nbl = LM["cls"], LM["oneway"], LM["nf"], LM["nb"]
bridge = np.array([t.get("bridge") not in (None, "no") for t in rt])
layer = np.nan_to_num(np.array([num(t.get("layer")) for t in rt]), nan=0).astype(int)
tunnel = np.array([t.get("tunnel") in ("yes", "culvert", "flooded", "avalanche_protector") or t.get("indoor") == "yes" or t.get("location") == "underground" for t in rt]) | ((layer < 0) & ~bridge)
is_area = np.array([t.get("area") == "yes" for t in rt])
ring = np.array([t.get("junction") in ("roundabout", "circular") for t in rt])
DRV = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~is_area
# half of the least carriageway that carries the way's lanes (back streets: one lane each way, narrow)
wneed = np.where(cls == 5, np.where(oneway, 3.6, 6.0), LM["wneed"])
HN = wneed / 2
LL = roads.geometry.values
R = project_geoms(LL)
vkey = lambda c: (np.round(c[:, 0] * 20).astype(np.int64) + 4_000_000) * 8_000_000 + (np.round(c[:, 1] * 20).astype(np.int64) + 4_000_000)

# ---------------------------------------------------------------- vertices (of every way: what shares one moves with it)
allw = np.flatnonzero((cls >= 0) & ~is_area)
C = {}; nvert = np.zeros(len(roads), np.int64)
for i in allw:
    C[i] = shapely.get_coordinates(R[i]); nvert[i] = len(C[i])
off = np.zeros(len(roads) + 1, np.int64); off[1:] = np.cumsum(nvert)
keys = np.concatenate([vkey(C[i]) for i in allw])
ukeys, vid_all = np.unique(keys, return_inverse=True)
NV = len(ukeys)
VID = {}
p = 0
for i in allw:
    VID[i] = vid_all[p:p + nvert[i]]; p += nvert[i]
log("ways", len(allw), "vertices", len(keys), "distinct", NV, "; carrying traffic", int(DRV.sum()))

# ---------------------------------------------------------------- stations along the ways that carry traffic
drv = np.flatnonzero(DRV & ~ring)
sP, sW, sS, sV, sK = [], [], [], [], []          # position, way, distance along it, displacement slot, index of the vertex before it (or -1 - index: is that vertex)
wst = {}
nslot = NV
tot = 0
for i in drv:
    c = C[i]
    seg = np.hypot(*np.diff(c, axis=0).T)
    if len(c) < 2 or seg.sum() < 1.0:
        continue
    npc = np.maximum(1, np.ceil(seg / DS).astype(int))                       # pieces per segment
    m = int(npc.sum()) + 1
    P = np.empty((m, 2)); V = np.empty(m, np.int64); K = np.empty(m, np.int64)
    o = np.concatenate([[0], np.cumsum(npc)])
    P[o] = c; V[o] = VID[i]; K[o] = -1 - np.arange(len(c))
    for k in np.flatnonzero(npc > 1):
        f = np.arange(1, npc[k]) / npc[k]
        j = o[k] + np.arange(1, npc[k])
        P[j] = c[k] + (c[k + 1] - c[k]) * f[:, None]; K[j] = k
        V[j] = nslot + np.arange(len(j)); nslot += len(j)
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
    wst[i] = (tot, tot + m)
    sP.append(P); sW.append(np.full(m, i)); sS.append(s); sV.append(V); sK.append(K)
    tot += m
sP = np.vstack(sP); sW = np.concatenate(sW); sS = np.concatenate(sS); sV = np.concatenate(sV); sK = np.concatenate(sK)
NS = len(sP)
first = np.zeros(NS, bool); last = np.zeros(NS, bool)
for a, b in wst.values():
    first[a] = True; last[b - 1] = True
prv = np.where(first, np.arange(NS), np.arange(NS) - 1); nxt = np.where(last, np.arange(NS), np.arange(NS) + 1)
log("stations", NS, "displacement slots", nslot)

# ---------------------------------------------------------------- the level each station is on
# ground 0; a deck its layer's height, less near the point where it comes down to the ground; a tunnel far below, but level
# with the street for its first metres (the ramp down into it)
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
ground_w = (cls >= 0) & ~bridge & ~tunnel
on_ground = np.zeros(nslot, bool)
for i in np.flatnonzero(ground_w & ~is_area):
    on_ground[VID[i]] = True
seg_len = np.hypot(*(sP[nxt] - sP).T)
z = np.zeros(NS)
for kind, sel, lim in (("deck", bridge & ~tunnel, 60.0), ("tunnel", tunnel, 40.0)):
    m = sel[sW] & ~last
    g = coo_matrix((np.maximum(seg_len[m], 1e-3), (sV[m], sV[nxt[m]])), shape=(nslot, nslot)).tocsr()
    src = np.unique(sV[sel[sW] & on_ground[sV]])
    d = dijkstra(g, directed=False, indices=src, limit=lim, min_only=True) if len(src) else np.full(nslot, np.inf)
    ds = d[sV]
    if kind == "deck":
        z = np.where(sel[sW], np.minimum(5.6 * np.clip(layer[sW], 1, 5) + 0.6, 0.05 * ds), z)
    else:
        z = np.where(sel[sW], np.where(ds < 30.0, 0.0, -8.0), z)          # (whatever its layer: the traffic has every tunnel at one depth, so the two decks of a double-deck tunnel lie side by side)
del g

# ---------------------------------------------------------------- pairs of stations abreast of each other
from scipy.spatial import cKDTree


def tangents(P):
    t = P[nxt] - P[prv]
    return t / np.maximum(np.hypot(*t.T), 1e-9)[:, None]


T = tangents(sP)
tree = cKDTree(sP)
PA, PB = [], []
RAD = float(HN.max() * 2 + GAP + 2 * UMAX)
for c0 in range(0, NS, 200_000):
    c1 = min(NS, c0 + 200_000)
    dd, jj = tree.query(sP[c0:c1], k=40, distance_upper_bound=min(RAD, 46.0), workers=PROCS)
    a = np.repeat(np.arange(c0, c1), 40); b = jj.ravel()
    ok = b < NS
    a, b = a[ok], b[ok]
    ok = (sW[a] != sW[b]) & (np.abs(z[a] - z[b]) < LVL) & (np.abs((T[a] * T[b]).sum(1)) > 0.85)
    a, b = a[ok], b[ok]
    d = sP[b] - sP[a]
    along = (d * T[a]).sum(1); dl = -d[:, 0] * T[a][:, 1] + d[:, 1] * T[a][:, 0]
    ok = (np.abs(along) < DS / 2 + 1.5) & (np.abs(dl) < HN[sW[a]] + HN[sW[b]] + GAP + 2 * UMAX)
    PA.append(a[ok]); PB.append(b[ok])
PA = np.concatenate(PA); PB = np.concatenate(PB)
del tree
# two ways that meet (a slip road and its road, the two carriageways where a divided road begins): not near the meeting point
wa, wb = sW[PA], sW[PB]
tk_w, tk_v, tk_s = [], [], []
for i in drv:
    if i in wst:
        a, b = wst[i]
        v = np.flatnonzero(sK[a:b] < 0)
        tk_w.append(np.full(len(v), i)); tk_v.append(sV[a:b][v]); tk_s.append(sS[a:b][v])
tk_w = np.concatenate(tk_w); tk_v = np.concatenate(tk_v); tk_s = np.concatenate(tk_s)
o = np.argsort(tk_v, kind="stable"); tk_w, tk_v, tk_s = tk_w[o], tk_v[o], tk_s[o]
cut = np.flatnonzero(np.diff(tk_v)) + 1
st_ = np.concatenate([[0], cut]); en_ = np.concatenate([cut, [len(tk_v)]])
touch = {}                                        # (way, way) -> [(distance along the first, along the second)]
for a, b in zip(st_[en_ - st_ >= 2], en_[en_ - st_ >= 2]):
    for x in range(a, b):
        for y in range(a, b):
            if tk_w[x] != tk_w[y]:
                touch.setdefault((int(tk_w[x]), int(tk_w[y])), []).append((float(tk_s[x]), float(tk_s[y])))
taper = np.zeros(len(PA), bool)
pk = wa.astype(np.int64) * 1_000_000 + wb
o = np.argsort(pk, kind="stable")
upk, ust = np.unique(pk[o], return_index=True)
uen = np.concatenate([ust[1:], [len(o)]])
for u, key in enumerate(upk.tolist()):
    lst = touch.get((key // 1_000_000, key % 1_000_000))
    if lst:
        m = o[ust[u]:uen[u]]
        for s1, s2 in lst:
            taper[m] |= (np.abs(sS[PA[m]] - s1) < TAPER) & (np.abs(sS[PB[m]] - s2) < TAPER)
PA, PB = PA[~taper], PB[~taper]
need = HN[sW[PA]] + HN[sW[PB]] + GAP
log("pairs of stations abreast", len(PA), "; left out near a meeting point", int(taper.sum()))

# ---------------------------------------------------------------- move
U = np.zeros((nslot, 2))
cnt_st = np.bincount(sV, minlength=nslot).astype(float)
# a roundabout stays as it is mapped (its ring is one shape: a vertex of it pushed sideways by the road that enters there
# would fold the ring up); the roads that run into it come back to their mapped line before they reach it
pinned = np.zeros(nslot, bool)
for i in np.flatnonzero(ring & (cls >= 0) & ~is_area):
    pinned[VID[i]] = True
seg0 = sP[nxt] - sP                                # the mapped course from each station to the next
len0 = np.maximum(np.hypot(*seg0.T), 1e-6)


def step(P, T):
    """What each displacement slot should move by for the stations to clear their neighbours (and how much is missing)."""
    d = P[PB] - P[PA]
    ta = T[PA]
    dot = (ta * T[PB]).sum(1)
    dl = -d[:, 0] * ta[:, 1] + d[:, 1] * ta[:, 0]
    along = (d * ta).sum(1)
    coin = np.abs(dl) < 0.5
    live = (np.abs(along) < DS / 2 + 2.5) & ~(coin & (dot > 0))           # (one road mapped twice over: left alone)
    side = np.where(coin, 1.0, np.sign(dl))                               # (two lines on top of each other, opposite ways: each to its right)
    miss = np.where(live, need - np.abs(dl), 0.0)
    m = miss > 0.02
    a = PA[m]
    push = miss[m] * 0.5
    left = side[m] > 0
    cl = np.zeros(NS); cr = np.zeros(NS)
    np.maximum.at(cl, a[left], push[left]); np.maximum.at(cr, a[~left], push[~left])
    c = cr - cl                                                           # along the station's left-hand normal
    w = np.flatnonzero(np.abs(c) > 1e-3)
    nx, ny = -T[w, 1], T[w, 0]
    Mxx = np.bincount(sV[w], nx * nx, nslot) + 0.05; Mxy = np.bincount(sV[w], nx * ny, nslot); Myy = np.bincount(sV[w], ny * ny, nslot) + 0.05
    bx = np.bincount(sV[w], c[w] * nx, nslot); by = np.bincount(sV[w], c[w] * ny, nslot)
    det = Mxx * Myy - Mxy * Mxy
    return np.column_stack([(Myy * bx - Mxy * by) / det, (Mxx * by - Mxy * bx) / det]), miss


def smooth(U, lam):
    nb = (U[sV[prv]] + U[sV[nxt]]) / 2
    out = np.column_stack([np.bincount(sV, (1 - lam) * U[sV, k] + lam * nb[:, k], nslot) for k in (0, 1)])
    out[cnt_st > 0] /= cnt_st[cnt_st > 0][:, None]
    out[cnt_st == 0] = U[cnt_st == 0]
    return out


for it in range(60):
    P = sP + U[sV]
    T = tangents(P)
    dU, miss = step(P, T)
    U += 0.6 * dU
    U = smooth(U, 0.5 if it < 48 else 0.12)
    n = np.hypot(*U.T)
    big = n > UMAX
    U[big] *= (UMAX / n[big])[:, None]
    U[pinned] = 0.0
    # no stretch of a way is folded up or turned round by it: where two stations in a row have been pushed towards each other
    # (the piece between them less than half its mapped length, or pointing the other way), both give way to their mean
    for _ in range(3):
        seg = seg0 + U[sV[nxt]] - U[sV]
        along = (seg * seg0).sum(1) / len0
        bad = np.flatnonzero((along < 0.5 * len0) & ~last & (len0 > 0.5))
        if not len(bad):
            break
        a_, b_ = sV[bad], sV[nxt[bad]]
        mean = (U[a_] + U[b_]) / 2
        U[a_] = mean; U[b_] = mean
        U[pinned] = 0.0
    if it % 10 == 9 or it == 59:
        log(f"  round {it + 1}: stations still short of room {int((miss > 0.3).sum())} pair ends, worst {miss.max():.1f} m; moved more than 0.5 m: {int((np.hypot(*U[sV].T) > 0.5).sum()) * DS / 1e3:.0f} km of way, most {n.max():.1f} m")
seg = seg0 + U[sV[nxt]] - U[sV]
nfold = int((((seg * seg0).sum(1) / len0 < 0.5 * len0) & ~last & (len0 > 0.5)).sum())
P = sP + U[sV]
T = tangents(P)
_, miss = step(P, T)
short_st = np.zeros(NS)
np.maximum.at(short_st, PA, miss)
mv = np.hypot(*U[sV].T)
log(f"moved: {int((mv > 0.5).sum()) * DS / 1e3:.0f} km of way by more than 0.5 m, {int((mv > 2).sum()) * DS / 1e3:.0f} km by more than 2 m, {int((mv > 5).sum()) * DS / 1e3:.0f} km by more than 5 m; "
    f"still short of room by more than 0.5 m: {int((short_st > 0.5).sum()) * DS / 1e3:.0f} km, by more than 2 m: {int((short_st > 2).sum()) * DS / 1e3:.0f} km; pieces of way folded up: {nfold}")
if os.environ.get("SH3D_SPREAD_PLOT"):                     # (debugging: before and after around the given x,z,radius points)
    from PIL import Image, ImageDraw
    spots = [[float(v) for v in t.split(",")] for t in os.environ["SH3D_SPREAD_PLOT"].split(";")]
    SZ = 760
    img = Image.new("RGB", (SZ * len(spots), SZ), "white")
    Tm = tangents(P)
    for q, (x0, z0, rad) in enumerate(spots):
        y0 = -z0
        pane = Image.new("RGB", (SZ, SZ), "white")
        dr = ImageDraw.Draw(pane)
        px = lambda xy: [((x - (x0 - rad)) / (2 * rad) * SZ, (1 - (y - (y0 - rad)) / (2 * rad)) * SZ) for x, y in xy]
        near = np.flatnonzero((np.abs(sP[:, 0] - x0) < rad * 1.3) & (np.abs(sP[:, 1] - y0) < rad * 1.3))
        ws = np.unique(sW[near])
        for i in ws:
            a_, b_ = wst[i]
            dr.line(px(sP[a_:b_]), fill=(185, 185, 185), width=2)
        for i in ws:
            a_, b_ = wst[i]
            col = (40, 90, 220) if bridge[i] else (30, 150, 60) if tunnel[i] else (0, 0, 0)
            Pm = sP[a_:b_] + U[sV[a_:b_]]
            t_ = Tm[a_:b_]
            for sg in (-1, 1):             # the carriageway its lanes need
                dr.line(px(np.column_stack([Pm[:, 0] - sg * t_[:, 1] * HN[i], Pm[:, 1] + sg * t_[:, 0] * HN[i]])), fill=tuple(int(c * 0.45 + 140) for c in col), width=1)
            dr.line(px(Pm), fill=col, width=2)
        dr.rectangle([0, 0, SZ - 1, SZ - 1], outline=(120, 120, 120))
        dr.text((6, 4), f"({x0:.0f}, {z0:.0f}) +-{rad:.0f} m  grey: as mapped  dark: moved (black street, blue deck, green tunnel)  pale: room for its lanes", fill=(200, 0, 0))
        img.paste(pane, (q * SZ, 0))
    img.save(os.environ.get("SH3D_PLOT_OUT", "spread.png"))
if os.environ.get("SH3D_SPREAD_AT"):                       # (debugging: what moved how far around the given x,z points)
    for t in os.environ["SH3D_SPREAD_AT"].split(";"):
        x0, z0 = [float(v) for v in t.split(",")]
        d0 = np.hypot(sP[:, 0] - x0, sP[:, 1] + z0)
        print(f"--- around ({x0:.0f}, {z0:.0f})")
        for i in np.unique(sW[d0 < 40]):
            a_, b_ = wst[i]
            j = a_ + int(np.argmin(d0[a_:b_]))
            u = U[sV[j]]; tl = np.array([-T[j, 1], T[j, 0]])
            print(f"   {hw[i]:14s} {'deck' if bridge[i] else 'tunnel' if tunnel[i] else 'street':6s} z {z[j]:5.1f} lanes {nfl[i]}+{nbl[i]} {'tagged' if LM['tagged'][i] else 'usual '} needs {wneed[i]:.1f} m; {d0[j]:5.1f} m from the point; moved {np.hypot(*u):.1f} m ({u @ tl:+.1f} to its left); still short {short_st[j]:.1f}; name {rt[i].get('name')}")
if DRY:
    sys.exit(0)

# ---------------------------------------------------------------- write the ways back
moved = np.zeros(nslot, bool); moved[np.hypot(*U.T) > 0.03] = True
spread = np.zeros(len(roads))
newgeom = {}
for i in allw:
    v = VID[i]
    if i in wst:
        a, b = wst[i]
        sv = sV[a:b]
        if not moved[sv].any():
            continue
        isv = sK[a:b] < 0
        # every vertex of the way, and the stations in between wherever the line has moved
        segm = np.maximum.accumulate(np.where(isv, np.arange(b - a), 0))          # index of the vertex station before each station
        mvd = moved[sv]
        segmoved = np.zeros(b - a, bool)
        vs = np.flatnonzero(isv)
        for q in range(len(vs) - 1):
            if mvd[vs[q]:vs[q + 1] + 1].any():
                segmoved[vs[q]:vs[q + 1] + 1] = True
        use = isv | segmoved
        loc = sP[a:b][use] + U[sv[use]]
        ll0 = shapely.get_coordinates(LL[i])
        lon, lat = to_lonlat(loc[:, 0], loc[:, 1])
        out = np.column_stack([lon, lat])
        # (a vertex that has not moved keeps its coordinates to the last digit)
        still = isv[use] & ~mvd[use]
        out[still] = ll0[(-1 - sK[a:b][use][still])]
        newgeom[i] = out
        spread[i] = float(np.hypot(*U[sv].T).max())
    else:
        if not moved[v].any():
            continue
        ll0 = shapely.get_coordinates(LL[i])
        loc = C[i] + U[v]
        lon, lat = to_lonlat(loc[:, 0], loc[:, 1])
        out = np.column_stack([lon, lat])
        out[~moved[v]] = ll0[~moved[v]]
        newgeom[i] = out
        spread[i] = float(np.hypot(*U[v].T).max())
geoms = LL.copy()
for i, out in newgeom.items():
    geoms[i] = shapely.LineString(out) if roads.geometry.values[i].geom_type == "LineString" else geoms[i]
roads = roads.set_geometry(gpd.GeoSeries(geoms, index=roads.index, crs=roads.crs))
roads["spread"] = spread.astype(np.float32)
roads.to_parquet(cur)
log(f"ways rewritten: {len(newgeom)} ({int(DRV[list(newgeom.keys())].sum())} of them carry traffic); {len(roads)} roads written")
