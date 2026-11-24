"""Ground layers for the web app: roads, rail, water, land-cover / land-use areas.

Outputs (site/data):
  roads.bin   chunked polylines (4 km cells x {major, minor, fine, rail})
  areas.bin   classified polygons (parks, woods, farmland, pitches, land-use tints, plazas, aprons ...)
  water.bin   dissolved water polygons
  ground.json manifest (class tables, chunk index)
Also writes work/ground_layers.pkl for the tree-zone stage.

Polygon-set blob:  u32 np, nr, nv | u8 class[np] | u8 nrings[np] | pad4 | u16 ringsize[nr] | pad4 | i32 x0[np], y0[np] | i16 dxy[2*(nv-np)]
Line-set blob:     u32 nl, nv     | u8 class[nl] | u8 flags[nl] | u8 width4[nl] | u8 aux[nl] | u8 e0[nl], eH[nl], e1[nl] (deck height at start / plateau / end, 0.25 m) | pad4
                   | u16 npts[nl] | pad4 | i32 x0[nl], y0[nl] | i16 dxy[2*(nv-nl)]
All coordinates in decimetres, world frame.

usage: 31_build_ground.py <work_dir> <site_data_dir>
"""
import sys, os, json, gzip, time, struct, pickle, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *

WORK, OUT = sys.argv[1:3]
T0 = time.time()
XMIN, YMIN = GRID_X0, GRID_Y0
XMAX, YMAX = GRID_X0 + GRID_NX * TILE, GRID_Y0 + GRID_NY * TILE
EXTENT = shapely.box(XMIN, YMIN, XMAX, YMAX)


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def num(s):
    if not isinstance(s, str):
        return np.nan
    m = re.match(r"\s*(-?[0-9]+(\.[0-9]+)?)", s)
    return float(m.group(1)) if m else np.nan


def pad4(b):
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def split_big(p, max_rings=240, depth=0):
    """Polygons with hundreds of holes (a lake system joined by canals, a forest full of clearings) are cut into quadrants
    until every piece fits the one-byte ring count of the file format."""
    x0, y0, x1, y1 = p.bounds
    # coordinates are delta coded as int16 decimetres, also across rings: keep every piece within ~3 km corner to corner
    small = max(x1 - x0, y1 - y0) <= 2200.0
    if (len(p.interiors) + 1 <= max_rings and small) or depth > 10:
        return [p]
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    out = []
    for bx in ((x0, y0, xm, ym), (xm, y0, x1, ym), (x0, ym, xm, y1), (xm, ym, x1, y1)):
        piece = shapely.intersection(p, shapely.box(*bx))
        for q in polys_of([piece]):
            if q.area > 1.0:
                out += split_big(shapely.geometry.polygon.orient(q), max_rings, depth + 1)
    return out


def encode_polys(polys, classes):
    cls, nrings, ringsizes, x0, y0, deltas = [], [], [], [], [], []
    nv = 0
    expanded = []
    for p, c in zip(polys, classes):
        for q in split_big(p):
            expanded.append((q, c))
    dropped = 0
    for p, c in expanded:
        p = shapely.segmentize(p, 2500.0)
        rr = [np.asarray(p.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in p.interiors]
        q = []
        for r in rr:
            r = np.round(r * 10).astype(np.int64)
            d = np.any(np.diff(np.vstack([r, r[:1]]), axis=0) != 0, axis=1)
            r = r[d]
            if len(r) >= 3:
                q.append(r)
        if not q:
            continue
        if len(q) > 255:
            dropped += 1; continue
        allp = np.vstack(q)
        dl = np.diff(allp, axis=0)
        if len(dl) and np.abs(dl).max() > 32767:
            dropped += 1; continue
        cls.append(c); nrings.append(len(q)); ringsizes += [len(r) for r in q]
        x0.append(allp[0, 0]); y0.append(allp[0, 1]); deltas.append(dl); nv += len(allp)
    if dropped:
        print("  WARNING: polygons dropped by the encoder:", dropped)
    n = len(cls)
    blob = struct.pack("<III", n, len(ringsizes), nv)
    blob += pad4(np.asarray(cls, np.uint8).tobytes() + np.asarray(nrings, np.uint8).tobytes())
    blob += pad4(np.asarray(ringsizes, "<u2").tobytes())
    blob += np.asarray(x0, "<i4").tobytes() + np.asarray(y0, "<i4").tobytes()
    blob += (np.vstack(deltas).astype("<i2").tobytes() if deltas and sum(len(d) for d in deltas) else b"")
    return pad4(blob), n, nv


def encode_lines(lines, cls, flags, width, aux, elev):
    C, F, Wd, A, E, npts, x0, y0, deltas = [], [], [], [], [], [], [], [], []
    nv = 0
    for ln, c, f, w, a, ev in zip(lines, cls, flags, width, aux, elev):
        ln = shapely.segmentize(ln, 3000.0)
        r = np.round(np.asarray(ln.coords)[:, :2] * 10).astype(np.int64)
        d = np.any(np.diff(r, axis=0) != 0, axis=1)
        r = r[np.concatenate([[True], d])]
        if len(r) < 2:
            continue
        # split very long lines
        for s in range(0, len(r) - 1, 60000):
            seg = r[s:s + 60001]
            if len(seg) < 2:
                continue
            C.append(c); F.append(f); Wd.append(int(np.clip(round(w * 4), 1, 255))); A.append(a); npts.append(len(seg))
            E.append([int(np.clip(round(v * 4), 0, 255)) for v in ev])
            x0.append(seg[0, 0]); y0.append(seg[0, 1]); deltas.append(np.diff(seg, axis=0)); nv += len(seg)
    n = len(C)
    blob = struct.pack("<II", n, nv)
    blob += np.asarray(C, np.uint8).tobytes() + np.asarray(F, np.uint8).tobytes() + np.asarray(Wd, np.uint8).tobytes() + np.asarray(A, np.uint8).tobytes()
    Ea = np.asarray(E, np.uint8).reshape(-1, 3)
    blob += pad4(Ea[:, 0].tobytes() + Ea[:, 1].tobytes() + Ea[:, 2].tobytes())
    blob += pad4(np.asarray(npts, "<u2").tobytes())
    blob += np.asarray(x0, "<i4").tobytes() + np.asarray(y0, "<i4").tobytes()
    blob += (np.vstack(deltas).astype("<i2").tobytes() if deltas else b"")
    return pad4(blob), n, nv


def polys_of(geoms):
    out = []
    for g in geoms:
        if g is None or g.is_empty:
            continue
        if g.geom_type == "Polygon":
            out.append(g)
        elif hasattr(g, "geoms"):
            out += [p for p in g.geoms if p.geom_type == "Polygon" and not p.is_empty]
    return out


def load(name):
    gdf = gpd.read_parquet(os.path.join(WORK, name + ".parquet"))
    gdf["geometry"] = project_geoms(gdf.geometry.values)
    gdf = gdf.set_crs(PROJ_LOCAL, allow_override=True)
    return gdf[gdf.intersects(EXTENT)].reset_index(drop=True)


# ================================================================ ROADS
RC = dict(motorway=0, trunk=1, primary=2, secondary=3, tertiary=4, minor=5, service=6, pedestrian=7, path=8, link=9, crossing=12, rail=20, subway=21, lightrail=22)
roads = load("osm_roads")
hw = roads.highway.values
tun = roads["tunnel"].fillna("no").isin(["yes", "building_passage", "covered"]).values | roads["covered"].fillna("no").eq("yes").values | roads["indoor"].fillna("no").eq("yes").values
is_area = roads["area"].fillna("no").eq("yes").values
cls = np.full(len(roads), -1)
for k, v in (("motorway", 0), ("trunk", 1), ("primary", 2), ("secondary", 3), ("tertiary", 4), ("unclassified", 5), ("residential", 5), ("living_street", 6), ("service", 6),
             ("pedestrian", 7), ("footway", 8), ("path", 8), ("cycleway", 8), ("track", 8), ("steps", 8)):
    cls[hw == k] = v
link = pd.Series(hw).str.endswith("_link").values
link_parent = pd.Series(hw).str.replace("_link", "").map({"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}).fillna(-1).astype(int).values
cls[link] = 9
keep = (cls >= 0) & ~tun & ~is_area
# paths: only the substantial ones (park promenades) – skip pavements hugging roads
ln_len = roads.geometry.length.values
foot_side = roads.get("surface")
keep &= ~((cls == 8) & (ln_len < 60))
roads = roads[keep].reset_index(drop=True); cls = cls[keep]; link_parent = link_parent[keep]
lanes = roads["lanes"].map(num).values
oneway = roads["oneway"].fillna("").values
is_ow = np.isin(oneway, ["yes", "1", "true", "-1"]) | (roads.highway.values == "motorway") | (roads["junction"].fillna("").values == "roundabout") | (cls == 9)
rev = oneway == "-1"
bridge = roads["bridge"].fillna("no").ne("no").values
layer = np.nan_to_num(roads["layer"].map(num).values, nan=0).astype(int)
layer = np.where(bridge & (layer <= 0), 1, layer)
name = roads["name"].fillna("").values
# visual width in metres (full carriageway of this way)
base_w = {0: 15.0, 1: 14.0, 2: 15.0, 3: 12.0, 4: 9.0, 5: 6.5, 6: 4.2, 7: 6.0, 8: 2.4, 9: 6.5}
w = np.array([base_w[c] for c in cls])
w = np.where((cls <= 3) & is_ow, np.minimum(w, 12.5), w)              # one half of a dual carriageway
lw = np.where(np.isfinite(lanes), lanes * 3.6 + 1.0, np.nan)
w = np.where(np.isfinite(lw) & (cls <= 5), np.clip(lw, w * 0.6, w * 1.9), w)
wt = roads["width"].map(num).values
w = np.where(np.isfinite(wt) & (wt > 1.5) & (wt < 60), wt, w)
# ring-road tagging by name
ring_no = np.zeros(len(roads), int)
for k, ch in enumerate("二三四五六", start=2):
    m = pd.Series(name).str.contains(ch + "环").values & ~pd.Series(name).str.contains("辅路").values & (cls <= 2)
    ring_no[m] = k
changan = pd.Series(name).str.contains("长安街|建国门内大街|建国门外大街|复兴门内大街|复兴门外大街|建国路|复兴路").values & (cls <= 3)
geoms = roads.geometry.values
geoms = np.where(rev, shapely.reverse(geoms), geoms)

# merge consecutive ways with identical attributes into long polylines (direction-preserving for one-way)
df = pd.DataFrame({"cls": cls, "ow": is_ow, "br": bridge, "ly": layer, "w": np.round(w * 2) / 2, "ring": ring_no, "ca": changan, "name": name, "lp": link_parent})
lines, L_cls, L_flags, L_w, L_aux = [], [], [], [], []
for key, idx in df.groupby(["cls", "ow", "br", "ly", "w", "ring", "ca", "name", "lp"]).indices.items():
    c, ow_, br_, ly_, w_, rg_, ca_, nm_, lp_ = key
    ml = shapely.multilinestrings(list(geoms[idx])) if len(idx) > 1 else geoms[idx[0]]
    merged = shapely.line_merge(ml, directed=bool(ow_)) if len(idx) > 1 else ml
    tol = 0.35 if c <= 3 or c == 9 else 0.55
    for part in (merged.geoms if hasattr(merged, "geoms") else [merged]):
        part = shapely.simplify(part, tol, preserve_topology=False)
        if part.is_empty or part.length < 2:
            continue
        lines.append(part); L_cls.append(int(c))
        L_flags.append((1 if ow_ else 0) | (2 if br_ else 0) | (4 if rg_ else 0) | (8 if ca_ else 0) | (16 if (c == 9 and lp_ in (0, 1)) else 0))
        L_w.append(float(w_)); L_aux.append(int(rg_) | (int(np.clip(ly_, 0, 7)) << 4))
log("roads: ways", len(roads), "-> merged lines", len(lines), "points", sum(len(l.coords) for l in lines))

# ---- zebra crossings: where surface streets meet inside the Fifth Ring, every arm gets a crossing just clear of the junction
# (class 12: a short stub of the road's own width; the shader paints the bars)
def zebra_crossings():
    from collections import defaultdict
    r5 = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring").geometry[5].buffer(1500)
    shapely.prepare(r5)
    sel = np.where((cls >= 2) & (cls <= 5) & ~bridge & (layer == 0))[0]
    coords, keys = {}, {}
    node = defaultdict(list)
    for i in sel:
        c = np.asarray(geoms[i].coords)[:, :2]
        if len(c) < 2:
            continue
        kk = [tuple(v) for v in np.round(c * 10).astype(np.int64)]
        coords[i] = c; keys[i] = kk
        for k, key in enumerate(kk):
            node[key].append((i, k))
    arms_at, junction = {}, set()
    for key, lst in node.items():
        if len(lst) < 2:
            continue
        arms = []
        for i, k in lst:
            if k > 0: arms.append((i, k, -1))
            if k < len(coords[i]) - 1: arms.append((i, k, 1))
        arms_at[key] = arms
        if len(arms) >= 3 and len({i for i, _ in lst}) >= 2:
            junction.add(key)

    def advance(i, k, d, need):
        pts = [coords[i][k]]; acc = 0.0
        for _ in range(400):
            c = coords[i]; k2 = k + d
            if k2 < 0 or k2 >= len(c):
                arms = arms_at.get(keys[i][k], [])
                oth = [a for a in arms if a[0] != i]
                if len(arms) != 2 or len(oth) != 1:
                    return None
                i, k, d = oth[0]
                continue
            seg = float(np.hypot(*(c[k2] - c[k])))
            if acc + seg >= need:
                pts.append(c[k] + (c[k2] - c[k]) * ((need - acc) / max(seg, 1e-6)))
                return pts
            acc += seg; k = k2; pts.append(c[k])
            if keys[i][k] in junction:
                return None                      # another junction too close: this is the inside of a crossroads or a median gap
        return None

    out_l, out_w = [], []
    for key in junction:
        arms = arms_at[key]
        if min(cls[i] for i, _, _ in arms) > 4:
            continue
        if not shapely.contains_xy(r5, key[0] / 10, key[1] / 10):
            continue
        dirs = []
        for i, k, d in arms:
            v = coords[i][k + d] - coords[i][k]
            dirs.append(v / max(float(np.hypot(*v)), 1e-6))
        for a, (i, k, d) in enumerate(arms):
            cross = [w[j] for b, (j, _, _) in enumerate(arms) if b != a and abs(float(dirs[a] @ dirs[b])) < 0.8]
            if not cross:
                continue
            d0 = min(max(cross) / 2 + 3.0, 22.0)
            depth = 4.0 if cls[i] >= 4 else 5.0
            path = advance(i, k, d, d0 + depth + 6.0)
            if path is None:
                continue
            ln = shapely.LineString(path)
            seg = shapely.ops.substring(ln, d0, d0 + depth)
            if seg.geom_type != "LineString" or seg.length < depth * 0.8:
                continue
            out_l.append(seg); out_w.append(float(w[i]))
    return out_l, out_w


import shapely.ops
zl, zw = zebra_crossings()
for ln, w_ in zip(zl, zw):
    lines.append(ln); L_cls.append(12); L_flags.append(0); L_w.append(w_); L_aux.append(0)
log("zebra crossings:", len(zl))

# rail
rails = load("osm_rails")
rt = rails["tunnel"].fillna("no").ne("no").values | (rails["location"].fillna("").values == "underground") | (np.nan_to_num(rails["layer"].map(num).values, nan=0) < 0)
rails = rails[~rt].reset_index(drop=True)
rk = rails.railway.map({"rail": 20, "narrow_gauge": 20, "subway": 21, "light_rail": 22, "monorail": 22, "tram": 22}).values
rb = rails["bridge"].fillna("no").ne("no").values
serv = rails["service"].fillna("").values
for c in (20, 21, 22):
    for br_ in (False, True):
        for yard in (False, True):
            m = (rk == c) & (rb == br_) & (np.isin(serv, ["yard", "siding", "spur", "crossover"]) == yard)
            if not m.any():
                continue
            merged = shapely.line_merge(shapely.multilinestrings(list(rails.geometry.values[m])))
            for part in (merged.geoms if hasattr(merged, "geoms") else [merged]):
                part = shapely.simplify(part, 0.5, preserve_topology=False)
                if part.is_empty or part.length < 5:
                    continue
                lines.append(part); L_cls.append(c); L_flags.append((2 if br_ else 0) | (32 if yard else 0)); L_w.append(3.4 if not yard else 2.6); L_aux.append((1 << 4) if br_ else 0)
log("with rail: lines", len(lines))

# ---- flyovers and viaducts: give every bridge a deck height and decide where it ramps down
# A bridge end that meets another bridge stays up (matching that bridge's height); a free end ramps to the ground.
water_q = load("osm_water")
wu_q = shapely.union_all(shapely.make_valid(water_q.geometry.values))
shapely.prepare(wu_q)
LA = np.asarray(lines, dtype=object)
is_br = (np.asarray(L_flags) & 2) != 0
layer_of = (np.asarray(L_aux) >> 4) & 7
length = shapely.length(LA)
H = np.zeros(len(lines))
bi = np.where(is_br)[0]
over_water = shapely.intersects(wu_q, LA[bi])
for k, i in enumerate(bi):
    if L_cls[i] in (6, 7, 8) and length[i] < 120:
        H[i] = 1.2                                       # footbridges / lanes: just a hump
    elif over_water[k] and length[i] < 170:
        H[i] = 1.4                                       # ordinary bridges over canals and moats barely rise
    else:
        H[i] = min(5.6 * max(int(layer_of[i]), 1), 0.9 + 0.075 * length[i])
E0 = H.copy(); E1 = H.copy()
btree = shapely.STRtree(LA[bi])
for k, i in enumerate(bi):
    c = np.asarray(LA[i].coords)
    for which, pt in ((0, c[0]), (1, c[-1])):
        P = shapely.Point(pt[0], pt[1])
        near = [bi[j] for j in btree.query(P.buffer(1.2), predicate="intersects") if bi[j] != i]
        if not near:
            h = 0.0
        else:
            hs = []
            for j in near:
                cj = np.asarray(LA[j].coords)
                end_to_end = min(np.hypot(*(cj[0][:2] - pt[:2])), np.hypot(*(cj[-1][:2] - pt[:2]))) < 1.2
                hs.append((H[i] + H[j]) / 2 if end_to_end else H[j])
            h = float(np.mean(hs))
        if which == 0: E0[i] = h
        else: E1[i] = h
L_elev = np.column_stack([E0, H, E1])
log(f"bridges: {len(bi)} lines, {length[bi].sum() / 1e3:.0f} km; plateau height median {np.median(H[bi]):.1f} m; ends on the ground {int((E0[bi] == 0).sum() + (E1[bi] == 0).sum())}")

GROUP = {0: 0, 1: 0, 2: 0, 3: 0, 9: 0, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 20: 3, 21: 3, 22: 3, 12: 4}      # 4 = road markings drawn over everything at grade
CH = 4000.0
mid = shapely.line_interpolate_point(np.asarray(lines, dtype=object), 0.5, normalized=True)
mx, my = shapely.get_x(mid), shapely.get_y(mid)
ci = np.floor((mx - XMIN) / CH).astype(int); cj = np.floor((my - YMIN) / CH).astype(int)
grp = np.array([GROUP[c] for c in L_cls])
chunks = []
buf = bytearray()
dfl = pd.DataFrame({"ci": ci, "cj": cj, "g": grp})
for (a, b_, g_), idx in dfl.groupby(["ci", "cj", "g"]).indices.items():
    blob, n, nv = encode_lines([lines[i] for i in idx], [L_cls[i] for i in idx], [L_flags[i] for i in idx], [L_w[i] for i in idx], [L_aux[i] for i in idx], [L_elev[i] for i in idx])
    bx = shapely.total_bounds(np.asarray([lines[i] for i in idx], dtype=object))
    chunks.append(dict(ci=int(a), cj=int(b_), g=int(g_), o=len(buf), l=len(blob), n=n, nv=nv, bb=[round(float(v), 1) for v in bx]))
    buf += blob
z = gzip.compress(bytes(buf), 9)
open(os.path.join(OUT, "roads.bin"), "wb").write(z)
log(f"roads.bin {len(z) / 1e6:.2f} MB gz ({len(buf) / 1e6:.2f} raw), chunks {len(chunks)}; points by group:",
    {g_: int(sum(c["nv"] for c in chunks if c["g"] == g_)) for g_ in range(5)})

# ================================================================ WATER
water = load("osm_water")
wm = ~(water["tunnel"].fillna("no").ne("no").values | water["covered"].fillna("no").eq("yes").values | water["intermittent"].fillna("no").eq("yes").values)
wg = list(shapely.make_valid(water.geometry.values[wm]))
wl = load("osm_waterlines")
wl = wl[~wl["tunnel"].fillna("no").ne("no").values & ~wl["intermittent"].fillna("no").eq("yes").values]
ww = wl["width"].map(num).values
default = wl.waterway.map({"river": 9.0, "canal": 7.0, "stream": 2.5, "drain": 1.6, "ditch": 1.2}).values
bw = np.where(np.isfinite(ww) & (ww > 0.5) & (ww < 200), ww, default) / 2
wg += list(shapely.buffer(wl.geometry.values, bw, cap_style="flat"))
u = shapely.union_all(np.asarray(wg, dtype=object))
u = shapely.intersection(u, EXTENT)
u = shapely.simplify(u, 0.9, preserve_topology=True)
wpolys = [p for p in polys_of([u]) if p.area >= 40]
wpolys = [shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area >= 25]) for p in wpolys]
wpolys = [shapely.geometry.polygon.orient(p) for p in wpolys]
blob, n, nv = encode_polys(wpolys, [1] * len(wpolys))
z = gzip.compress(blob, 9)
open(os.path.join(OUT, "water.bin"), "wb").write(z)
log(f"water.bin {len(z) / 1e6:.2f} MB gz, polygons {n}, verts {nv}, area {sum(p.area for p in wpolys) / 1e6:.1f} km2")

# ================================================================ AREAS
AC = dict(park=1, forest=2, grass=3, scrub=4, farmland=5, pitch=6, track=7, cemetery=8, sand=9, wetland=10, golf=11,
          residential=20, commercial=21, industrial=22, construction=23, railway=24, military=25, campus=26, parking=27, plaza=28, apron=29, runway=30, taxiway=31,
          stadium=32, heritage=33)
KIND = {
    "leisure=park": "park", "leisure=garden": "park", "landuse=recreation_ground": "park", "landuse=village_green": "park", "leisure=playground": "park",
    "tourism=zoo": "park", "tourism=theme_park": "park", "leisure=nature_reserve": "forest", "boundary=protected_area": None, "boundary=national_park": None,
    "landuse=forest": "forest", "natural=wood": "forest", "landuse=grass": "grass", "landuse=meadow": "grass", "natural=grassland": "grass", "landuse=greenfield": "grass",
    "natural=scrub": "scrub", "natural=heath": "scrub", "landuse=farmland": "farmland", "landuse=orchard": "farmland", "landuse=vineyard": "farmland",
    "landuse=plant_nursery": "farmland", "landuse=allotments": "farmland", "leisure=pitch": "pitch", "leisure=track": "track", "landuse=cemetery": "cemetery",
    "natural=sand": "sand", "natural=beach": "sand", "natural=bare_rock": "sand", "natural=scree": "sand", "natural=wetland": "wetland", "leisure=golf_course": "golf",
    "landuse=residential": "residential", "landuse=commercial": "commercial", "landuse=retail": "commercial", "landuse=industrial": "industrial",
    "landuse=construction": "construction", "landuse=brownfield": "construction", "landuse=railway": "railway", "landuse=military": "military",
    "landuse=education": "campus", "landuse=institutional": "campus", "landuse=religious": "heritage", "amenity=university": "campus", "amenity=school": "campus",
    "amenity=college": "campus", "amenity=hospital": "campus", "amenity=parking": "parking", "place=square": "plaza", "highway=plaza": "plaza",
    "aeroway=apron": "apron", "aeroway=runway": "runway", "aeroway=taxiway": "taxiway", "aeroway=aerodrome": None, "leisure=stadium": "stadium",
    "leisure=sports_centre": "stadium", "amenity=place_of_worship": "heritage", "historic=palace": "heritage", "historic=castle": "heritage", "historic=temple": "heritage",
    "historic=city_gate": "plaza", "tourism=attraction": None, "tourism=museum": None,
}
ORDER = ["residential", "commercial", "industrial", "military", "campus", "construction", "railway", "parking", "heritage", "park", "golf", "grass", "farmland", "scrub",
         "forest", "cemetery", "sand", "wetland", "plaza", "stadium", "pitch", "track", "apron", "taxiway", "runway"]
areas = load("osm_areas")
areas["geometry"] = shapely.make_valid(areas.geometry.values)
kind = areas.kind.map(KIND)
# imperial compounds get stone-paved 'heritage' ground even though they are tagged tourism=attraction / leisure=park
her = areas["name"].fillna("").str.contains(r"^故宫$|^太庙$|^社稷坛$|^雍和宫|孔庙|国子监|历代帝王庙|^恭王府")
kind = kind.where(~her, "heritage")
areas["k"] = kind
areas = areas[areas.k.notna()].copy()
# name-based fixes: 奥林匹克公园 is mostly paved plaza
areas.loc[areas["name"].fillna("").str.contains("^奥林匹克公园$"), "k"] = "plaza"
min_area = {"pitch": 60, "track": 60, "parking": 250, "plaza": 150}
tol = {"residential": 2.0, "commercial": 2.0, "industrial": 2.0, "military": 2.0, "campus": 2.0, "construction": 2.0, "farmland": 2.0, "forest": 1.6}
polys, classes, kinds_n = [], [], {}
layers = {}
# altar parks and temple precincts are famous for their old cypress groves
cyp = areas[areas["name"].fillna("").str.contains(r"^天坛公园$|^太庙$|^社稷坛$|^中山公园$|^地坛公园$|^日坛公园$|^月坛公园$|孔庙|国子监|^景山公园$|^劳动人民文化宫$|历代帝王庙|^北海公园$") & areas.k.isin(["park", "heritage"])]
layers["cypress"] = [shapely.geometry.polygon.orient(p) for p in polys_of(shapely.simplify(cyp.geometry.values, 1.0, preserve_topology=True)) if p.area > 500]
for k in ORDER:
    sub = areas[areas.k == k]
    gg = shapely.simplify(sub.geometry.values, tol.get(k, 1.0), preserve_topology=True)
    pl = [shapely.geometry.polygon.orient(p) for p in polys_of(gg) if p.area >= min_area.get(k, 120)]
    if k == "track":      # running routes mapped as closed ways are not running tracks
        pl = [p for p in pl if p.area < 30000 and p.area / max(p.minimum_rotated_rectangle.area, 1) > 0.5]
    pl = [shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area >= 30]) for p in pl]
    polys += pl; classes += [AC[k]] * len(pl); kinds_n[k] = len(pl)
    layers[k] = pl
# runways / taxiways mapped as lines
aero = load("osm_aero")
for aw_, k, defw in (("taxiway", "taxiway", 23.0), ("runway", "runway", 55.0)):
    sub = aero[aero.aeroway == aw_]
    wv = sub["width"].map(num).values
    bw = np.where(np.isfinite(wv) & (wv > 5), wv, defw) / 2
    gg = shapely.buffer(sub.geometry.values, bw, cap_style="flat")
    pl = [shapely.geometry.polygon.orient(p) for p in polys_of(gg)]
    polys += pl; classes += [AC[k]] * len(pl); kinds_n[k] = kinds_n.get(k, 0) + len(pl)
blob, n, nv = encode_polys(polys, classes)
z = gzip.compress(blob, 9)
open(os.path.join(OUT, "areas.bin"), "wb").write(z)
log(f"areas.bin {len(z) / 1e6:.2f} MB gz, polygons {n}, verts {nv}", kinds_n)

json.dump(dict(roadClasses=RC, areaClasses=AC, roadChunk=CH, roadChunks=chunks, files=dict(roads="roads.bin", areas="areas.bin", water="water.bin"), gzip=True, units="decimetre"),
          open(os.path.join(OUT, "ground.json"), "w"), separators=(",", ":"))
pickle.dump(dict(water=wpolys, layers=layers, road_lines=lines, road_cls=L_cls, road_w=L_w, road_flags=L_flags), open(os.path.join(WORK, "ground_layers.pkl"), "wb"))
log("done")
