"""Short bridges over roads get their approaches.

On the map a flyover is a bridge way a few dozen metres long between two ordinary ways: the span is tagged as a bridge, the
ramps up to it are not. Built as mapped, the span has nowhere to rise (both its ends meet a street on the ground), and the
road it crosses runs through it at one level. This step finds the bridges that cross a road at grade and gives each the
approach it has in the real city: the stretch of the adjoining street next to the bridge becomes part of the bridge (a
ramp), long enough to climb to clearance over the crossing at 5 % (steeper, up to 9 %, where a junction leaves less room).
The ways concerned are cut where the ramp starts; the ramp pieces are marked bridge=yes with the bridge's layer, and
31_build_ground.py builds them as decks like any other.

Where the road under the bridge is far enough from the bridge's end, the bridge climbs by itself. Where a junction stands
too close to the bridge for any ramp, the junction goes up with it (a bridge head on its hump): every street that meets
there gets a ramp, and what else touches the lifted vertex on the ground (a footway, a service road) ends short of it.

A bridge for which none of that can be had stays as it was: level with the road below, and the traffic treats the crossing
as a junction (37_traffic.py).

Reads work/osm_roads.parquet as 10_extract_osm.py wrote it (kept as work/osm_roads_raw.parquet the first time), writes
work/osm_roads.parquet with a `fly` column: 0 untouched, 1 a bridge that got its height, 2 a ramp (or a stretch of footway
or service road taken off the ground beside one).

usage: 12_flyovers.py <work_dir> [--dry] [-v]
"""
import sys, os, json, time, shutil
import numpy as np, pandas as pd, geopandas as gpd, shapely
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

WORK = sys.argv[1]
DRY = "--dry" in sys.argv
T0 = time.time()
CLEAR, CLEAR_MIN = 5.6, 4.6          # height of the deck over the road it crosses: aimed at, and the least worth building
K0, K1 = 0.05, 0.09                  # grade of an approach: normal, and the steepest


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def num(s):
    try:
        return float(str(s).split(";")[0])
    except Exception:
        return np.nan


cur, raw = os.path.join(WORK, "osm_roads.parquet"), os.path.join(WORK, "osm_roads_raw.parquet")
roads = gpd.read_parquet(cur)
if "fly" in roads.columns:
    roads = gpd.read_parquet(raw)              # already processed once: start again from the table as extracted
elif not DRY:
    shutil.copyfile(cur, raw)
roads = roads.reset_index(drop=True)
rt = [json.loads(t) for t in roads["tags"].values]
hw = roads.highway.values
# the same reading of the tags as 31_build_ground.py
bridge = np.array([t.get("bridge") not in (None, "no") for t in rt])
layer = np.nan_to_num(np.array([num(t.get("layer")) for t in rt]), nan=0).astype(int)
tunnel = np.array([t.get("tunnel") in ("yes", "culvert", "flooded", "avalanche_protector") or t.get("indoor") == "yes" or t.get("location") == "underground" for t in rt]) | ((layer < 0) & ~bridge)
is_area = np.array([t.get("area") == "yes" for t in rt])
RC = dict(motorway=0, trunk=1, primary=2, secondary=3, tertiary=4, residential=5, unclassified=5, living_street=6, service=7, pedestrian=8, footway=9, path=9, cycleway=9, steps=9, track=10, busway=4)
cls = np.full(len(roads), -1)
for k, v in RC.items():
    cls[hw == k] = v
cls[pd.Series(hw).str.endswith("_link").values] = 11
DRV = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ~is_area
atgrade = DRV & ~bridge & ~tunnel
anyground = (cls >= 0) & ~bridge & ~tunnel                 # (what 31 takes for "on the ground" at a bridge end)
R = project_geoms(roads.geometry.values)
LL = roads.geometry.values
C = {}                                                     # way -> local coordinates (drivable ways)
for i in np.flatnonzero(DRV):
    C[i] = shapely.get_coordinates(R[i])
vkey = lambda c: (np.round(c[:, 0] * 20).astype(np.int64) + 4_000_000) * 8_000_000 + (np.round(c[:, 1] * 20).astype(np.int64) + 4_000_000)
KEYS = {i: vkey(c) for i, c in C.items()}
at = {}                                                    # vertex -> [(way, vertex index)] over the drivable ways
for i, kk in KEYS.items():
    for j, k in enumerate(kk.tolist()):
        at.setdefault(k, []).append((i, j))
ground_keys = set(np.unique(vkey(shapely.get_coordinates(R[anyground]))).tolist())
log("roads", len(roads), "drivable", int(DRV.sum()), "bridges among them", int((DRV & bridge & ~tunnel).sum()))


def out_dir(i, j, towards_end):
    """Unit direction along way i at vertex j, pointing towards its end (or its start)."""
    c = C[i]
    a, b = (j, min(j + 1, len(c) - 1)) if towards_end else (j, max(j - 1, 0))
    k = b
    while 0 < k < len(c) - 1 and np.hypot(*(c[k] - c[a])) < 3.0:      # (a few metres in: a kink at the vertex does not decide it)
        k += 1 if towards_end else -1
    d = c[k] - c[a]
    return d / max(np.hypot(*d), 1e-9)


# ---------------------------------------------------------------- the bridges that cross a road at grade, and where
tree = shapely.STRtree(R[atgrade])
ag = np.flatnonzero(atgrade)
bridges = np.flatnonzero(DRV & bridge & ~tunnel)
bi, ai = tree.query(R[bridges], predicate="crosses")
cross = {}                                                 # bridge way -> distances along it at which a road passes under
for b_, a_ in zip(bridges[bi], ag[ai]):
    inter = shapely.intersection(R[b_], R[a_])
    kb, ka = set(KEYS[b_].tolist()), set(KEYS[a_].tolist())
    for g in getattr(inter, "geoms", [inter]):
        if g.geom_type != "Point":
            continue
        k = int(vkey(np.array([[g.x, g.y]]))[0])
        if k in kb and k in ka:
            continue                                       # they share a vertex there: a junction as mapped
        cross.setdefault(int(b_), []).append(float(shapely.line_locate_point(R[b_], g)))
log("bridges crossing a road at grade without a junction:", len(cross))


def others_at(k, *mine):
    """Drivable ways with a vertex at k, other than `mine`: [(way, vertex index)]."""
    return [(i, j) for i, j in at.get(k, []) if i not in mine]


def to_ground(b, end):
    """From end `end` of bridge b outwards along any further bridge ways: (way, its end that is on the ground, distance walked
    through those ways) or None if the bridge carries on as a viaduct (no ground within reach)."""
    w, e, dist = b, end, 0.0
    for _ in range(12):
        k = int(KEYS[w][-1 if e else 0])
        if k in ground_keys:
            return w, e, dist
        nxt = [(i, j) for i, j in others_at(k, w) if bridge[i] and not tunnel[i] and j in (0, len(C[i]) - 1)]
        if len(nxt) != 1 or len(others_at(k, w)) != 1:
            return None                                    # a fork of decks (or nothing): part of a viaduct
        i, j = nxt[0]
        dist += float(R[i].length)
        if dist > CLEAR / K0 + 20:
            return None
        w, e = i, (0 if j else 1)                          # carry on to its far end
    return None


MINOR = (cls >= 0) & ~DRV & ~bridge & ~tunnel & ~is_area                 # on the ground too, but not for traffic: footways, service roads
mat = {}                                                    # vertex -> [(minor way, vertex index)]
for i in np.flatnonzero(MINOR):
    for j, k in enumerate(vkey(shapely.get_coordinates(R[i])).tolist()):
        mat.setdefault(k, []).append((int(i), j))
_ar = (cls >= 0) & is_area & ~bridge & ~tunnel
area_keys = set(np.unique(vkey(shapely.get_coordinates(R[_ar]))).tolist()) if _ar.any() else set()
SC = {}


def stations(i):
    """Distance along drivable way i at each of its vertices."""
    s = SC.get(i)
    if s is None:
        s = SC[i] = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(C[i], axis=0).T))])
    return s


def grow(w, e, D0, jmax):
    """The ramps beyond the ground end `e` of bridge way w, the road that passes under the bridge being D0 metres back along
    it. The streets beyond that end are walked outwards, as far as it takes to come down from clearance at 5 %. A junction on
    the way is where the ramp has to be down, unless it is lifted with it (at most `jmax` of them): then every street that
    meets there gets a ramp of its own, down to the same distance. A bridge met on the way is part of the ramp (and becomes a
    deck if it was a low one); a viaduct met on the way keeps the ramp up.

    Returns None and why, or a plan: (grade, metres of ramp beyond the end, arms [(way, vertex it starts at, direction,
    distance of that vertex, metres)], vertices lifted [(key, distance)], junctions lifted)."""
    import heapq
    ext0 = CLEAR / K0 - D0
    arms, verts, fronts = [], [], []
    seen = set()
    st = dict(obst=np.inf, why="", nj=0)

    def start(i, j, d):
        for dr in (1, -1):
            v = j + dr
            if 0 <= v < len(C[i]):
                arms.append([i, j, dr, d, 0.0])
                heapq.heappush(fronts, (d + abs(float(stations(i)[v] - stations(i)[j])), len(arms) - 1, v))

    def block(d, why_):
        if d < st["obst"]:
            st["obst"] = d; st["why"] = why_

    def arrive(k, d, i, is_end):
        """At vertex k, `d` metres out, having come along way i. True if the walk along i carries on beyond it."""
        oth = others_at(k, i)
        if not oth:
            if is_end:
                block(d, "the road ends")
            return not is_end
        if k in seen:
            return False                                   # (two branches meet)
        if any(tunnel[i2] for i2, _ in oth) or k in area_keys:
            block(d, "a tunnel mouth" if k not in area_keys else "a square")
            return False
        joint = is_end and len(oth) == 1 and oth[0][1] in (0, len(C[oth[0][0]]) - 1)
        if not joint:
            if k not in ground_keys:
                return False                               # a fork of decks: the ramp has joined a viaduct, and stays up
            st["nj"] += 1
            if st["nj"] > jmax:
                block(d, "a junction")
                return False
        seen.add(k)
        if k in ground_keys:
            verts.append((k, d, not joint))
        for i2, j2 in oth:
            start(i2, j2, d)
        return not is_end

    k0 = int(KEYS[w][-1 if e else 0])
    arrive(k0, 0.0, w, True)
    while fronts:
        d, a, v = heapq.heappop(fronts)
        i, _, dr, d0, _ = arms[a]
        arms[a][4] = d - d0
        if d >= min(ext0, st["obst"]):
            continue
        if arrive(int(KEYS[i][v]), d, i, v in (0, len(C[i]) - 1)):
            heapq.heappush(fronts, (d + abs(float(stations(i)[v + dr] - stations(i)[v])), a, v + dr))
    ext = min(ext0, st["obst"])
    while True:                                            # (a ramp does not end a few metres beyond a vertex of the tree: it ends at it)
        near = [d for k, d, _ in verts if ext - 12.0 < d < ext - 1e-6]
        if not near:
            break
        ext = min(near)
    if ext < 12.0:
        ext = 0.0                                          # (a stub is no ramp: the bridge climbs by itself, if it can)
    if D0 + ext < CLEAR_MIN / K1 - 1e-6:
        return None, st["why"] or "the road ends"
    K = float(np.clip(CLEAR / (D0 + ext), K0, K1))
    out = [(i, j, dr, d0, min(m, ext - d0)) for i, j, dr, d0, m in arms if min(m, ext - d0) > 0.05]
    vv = [(k, d) for k, d, _ in verts if d < ext - 0.05]
    return K, ext, out, vv, sum(1 for k, d, jn in verts if jn and d < ext - 0.05)


J_MAX = 3                            # junctions lifted with one end of a bridge, at most
plans = {}        # bridge -> [plan of grow()] for its ends
grade = {}        # bridge way -> the grade it leaves the ground at, where that is steeper than usual
why = {}
ramp_m, lifted, alone = [], [], 0
left_ex = []
for b, xs in cross.items():
    L = float(R[b].length)
    ok, todo, own = True, [], {}
    for end in (0, 1):
        s_e = (L - max(xs)) if end else min(xs)
        g = to_ground(b, end)
        if g is None:
            continue                                       # carries on as a viaduct: nothing to do at this end
        w, e, through = g
        s_e += through
        if CLEAR / K0 - s_e <= 0:
            continue                                       # far enough from its end to climb by itself
        for jmax in range(J_MAX + 1):                      # (rather a steeper ramp than a junction in the air)
            res = grow(w, e, s_e, jmax)
            if res[0] is not None:
                break
        if res[0] is None:
            ok = False; why[res[1]] = why.get(res[1], 0) + 1
            kk = C[w][-1 if e else 0]
            left_ex.append((round(float(kk[0])), round(float(-kk[1])), round(s_e), res[1]))
            break
        todo.append(res)
        if res[0] > K0 + 1e-6:
            own[int(b)] = max(own.get(int(b), 0.0), res[0]); own[int(w)] = max(own.get(int(w), 0.0), res[0])
    if not ok:
        continue
    plans[b] = todo
    for i, k in own.items():
        grade[i] = max(grade.get(i, 0.0), k)
    for K, ext, arms, vv, nj in todo:
        if ext > 0:
            ramp_m.append(ext)
        else:
            alone += 1
        if nj:
            lifted.append(nj)
nfly = len(plans)
log(f"bridges that get their height: {nfly} ({sum(1 for p in plans.values() if p)} with something done at an end); left level: {len(cross) - nfly} {why}")
log(f"ends with a ramp: {len(ramp_m)}, median {np.median(ramp_m):.0f} m; ends where the bridge climbs alone: {alone}; steeper than 5 %: {sum(1 for p in plans.values() for q in p if q[0] > K0 + 1e-6)}; "
    f"ends with junctions lifted: {len(lifted)} ({sum(lifted)} junctions; by number {dict(zip(*np.unique(lifted, return_counts=True))) if lifted else {} })")
left_cls = {}
for b in cross:
    if b not in plans:
        left_cls[int(cls[b])] = left_cls.get(int(cls[b]), 0) + 1
log("left level, by class of the bridge:", dict(sorted(left_cls.items())))
if "-v" in sys.argv:
    for t in left_ex:
        print("   left level (x, z, metres from the road under it to this end, why):", t)
    for b, todo in plans.items():
        for K, ext, arms, vv, nj in todo:
            if nj:
                for k, d in vv:
                    i, j = at[k][0]
                    print(f"   lifted: bridge {b} cls {cls[b]} grade {K:.3f} ramp {ext:.0f} m, vertex at ({C[i][j][0]:.0f}, {-C[i][j][1]:.0f}) {d:.0f} m out, {K * (ext - d):.1f} m up")
if DRY:
    sys.exit(0)

# ---------------------------------------------------------------- cut the ways, mark the pieces
iv = {}           # way -> [(from, to, slope)] along it
force = set()     # bridges that the ramps run over: decks now, whatever they were
for b, todo in plans.items():
    for K, ext, arms, vv, nj in todo:
        for i, j, dr, d0, m in arms:
            if bridge[i]:
                force.add(int(i))
                if K > K0 + 1e-6:
                    grade[int(i)] = max(grade.get(int(i), 0.0), K)
                continue
            s = float(stations(i)[j])
            a_, b_ = (s, s + m) if dr > 0 else (s - m, s)
            iv.setdefault(int(i), []).append((max(a_, 0.0), min(b_, float(stations(i)[-1])), K))
        # what else stands on the ground at a vertex that goes up (a service road, a footway) ends short of it
        for k, d in vv:
            for i, j in mat.get(k, []):
                c = shapely.get_coordinates(R[i])
                sc = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))])
                m = max(ext - d, 8.0)
                iv.setdefault(int(i), []).append((max(float(sc[j]) - m, 0.0), min(float(sc[j]) + m, float(sc[-1])), K0))
fly = np.zeros(len(roads), np.int8)
fly[list(plans.keys())] = 1
fly[list(force)] = 1
rows = []         # (index of the row it comes from, lon/lat coordinates, fly value, slope)
drop = np.zeros(len(roads), bool)
for i, lst in iv.items():
    c = C[i] if i in C else shapely.get_coordinates(R[i]); ll = shapely.get_coordinates(LL[i])
    sc = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(c, axis=0).T))])
    Li = float(sc[-1])
    lst = sorted(lst)
    merged = [list(lst[0])]
    for a_, b_, k in lst[1:]:
        if a_ <= merged[-1][1] + 25.0:                     # (no stretch of street shorter than 25 m between two ramps)
            merged[-1][1] = max(merged[-1][1], b_); merged[-1][2] = max(merged[-1][2], k)
        else:
            merged.append([a_, b_, k])
    for m in merged:                                       # (nor a stub of street at the end of the way)
        if m[0] < 12.0:
            m[0] = 0.0
        if m[1] > Li - 12.0:
            m[1] = Li
    cuts = sorted({0.0, Li} | {v for m in merged for v in m[:2]})
    drop[i] = True
    for a_, b_ in zip(cuts[:-1], cuts[1:]):
        if b_ - a_ < 0.05:
            continue
        inside = (sc > a_ + 0.02) & (sc < b_ - 0.02)
        ss = np.concatenate([[a_], sc[inside], [b_]])
        # (existing vertices keep their coordinates to the last digit; a cut gets one new vertex, the same on both sides)
        pts = np.column_stack([np.interp(ss, sc, ll[:, 0]), np.interp(ss, sc, ll[:, 1])])
        k = next((m[2] for m in merged if m[0] - 0.01 <= a_ and b_ <= m[1] + 0.01), None)
        rows.append((i, pts, 2 if k is not None else 0, k))
tags_all = roads["tags"].values.copy()
for i, k in grade.items():                                 # a bridge that has to climb faster than usual from its own end
    d = json.loads(tags_all[i]); d["sh3d:ramp"] = f"{k:.3f}"
    tags_all[i] = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
roads["tags"] = tags_all
keep = roads[~drop].copy()
keep["fly"] = fly[~drop]
add = roads.iloc[[r[0] for r in rows]].copy()
add = add.set_geometry(gpd.GeoSeries([shapely.LineString(r[1]) for r in rows], index=add.index, crs=roads.crs))
tags = []
for (i, pts, f, k), t in zip(rows, add["tags"].values):
    if f == 2:
        d = json.loads(t)
        # the bridge it leads up to decides the level
        d["bridge"] = "yes"; d["layer"] = str(max(1, int(layer[i]) if layer[i] > 0 else 1)); d["sh3d:ramp"] = f"{k:.3f}"
        d.pop("tunnel", None)
        t = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    tags.append(t)
add["tags"] = tags
add["fly"] = np.array([r[2] for r in rows], np.int8)
out = pd.concat([keep, add], ignore_index=True)
out = gpd.GeoDataFrame(out, geometry="geometry", crs=roads.crs)
out.to_parquet(cur)
oc = np.array([RC.get(h_, -1) for h_ in out.highway.values]); oc[pd.Series(out.highway.values).str.endswith("_link").values] = 11
rm = (out.fly.values == 2)
drv_o = np.isin(oc, [0, 1, 2, 3, 4, 5, 11])
log(f"ways cut: {int(drop.sum())} -> {len(rows)} pieces ({int((rm & drv_o).sum())} ramps, {shapely.length(project_geoms(out.geometry.values[rm & drv_o])).sum() / 1e3:.1f} km; "
    f"{int((rm & ~drv_o).sum())} stretches of footway and service road taken off the ground at lifted vertices, {shapely.length(project_geoms(out.geometry.values[rm & ~drv_o])).sum() / 1e3:.1f} km); "
    f"low bridges made decks: {len(force)}; bridges with a grade of their own: {len(grade)}; {len(out)} roads written")
