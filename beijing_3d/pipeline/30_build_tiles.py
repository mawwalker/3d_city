"""Cut the building set into web tiles.

Layout (2 km tiles, see common.py):
  base layer   – every building that still matters from afar (large footprint or tall). Always loaded.
  mass layer   – small buildings melted into low block masses; stands in for them until detail arrives.
  detail layer – the small buildings themselves, one file per tile, streamed in near the camera.

Binary tile blob (little endian, SoA so gzip can bite):
  u32 nb, u32 nr, u32 nv
  u16 height[nb]   decimetres (roof/eave height above the building's own base)
  u16 base[nb]     decimetres (min_height: floating parts)
  u16 elev[nb]     decimetres (terrain elevation under the building)
  u8  style[nb], u8 pal[nb], u8 roof[nb], u8 seed[nb], u8 nrings[nb]   (+pad to 2)
  u16 ringsize[nr]
  i16 xy[2*nv]     decimetres; first vertex of a building relative to the tile's SW corner, then deltas

usage: 30_build_tiles.py <work_dir> <site_data_dir> [landmark_exclusions.json]
"""
import sys, os, json, gzip, time, struct, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from scipy import ndimage
from common import *

WORK, OUT = sys.argv[1:3]
EXCL = sys.argv[3] if len(sys.argv) > 3 else None
T0 = time.time()
os.makedirs(os.path.join(OUT, "detail"), exist_ok=True)


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


ST = dict(generic=0, resi=1, office=2, retail=3, industrial=4, courtyard=5, imperial=6, temple=7, public=8, bigroof=9, canopy=10, tank=11,
          construction=12, village=13, special=14, villa=15)
ROOF = dict(flat=0, gable=1, hip=2, pyramid=3, hip2=4, shed=8, dome=7, round=9)

b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"))
n0 = len(b)

# ---------------------------------------------------------------- landmark exclusions (hand-modelled heroes replace these footprints)
if EXCL and os.path.exists(EXCL):
    ex = json.load(open(EXCL))
    kill = np.zeros(len(b), bool)
    ids = set(ex.get("osm_ids", []))
    if ids:
        kill |= b["osm_id"].isin(ids).values | b["outline_id"].isin(ids).values
    X = b["cx"].values; Y = b["cy"].values
    for c in ex.get("circles", []):
        x, y = to_local(c["lon"], c["lat"])
        kill |= np.hypot(X - x, Y - y) < c["r"]
    for p in ex.get("polygons", []):
        xs, ys = to_local([q[0] for q in p], [q[1] for q in p])
        poly = shapely.Polygon(np.column_stack([xs, ys]))
        shapely.prepare(poly)
        kill |= shapely.contains(poly, shapely.points(X, Y))
    b = b[~kill].reset_index(drop=True)
    log("landmark exclusions removed", int(kill.sum()))

g = b.geometry.values
area = b["area"].values; height = b["height"].values.astype(float); style = b["style"].values; ring = b["ring"].values
CX = b["cx"].values; CY = b["cy"].values
fill = b["fill"].values; mlong = b["mlong"].values; mshort = b["mshort"].values

# ---------------------------------------------------------------- terrain elevation under each building
tm = json.load(open(os.path.join(WORK, "terrain_meta.json")))["fine"]
terr = np.load(os.path.join(WORK, "terrain_fine.npy"))
fi = (CX - tm["x0"]) / tm["cell"] - 0.5; fj = (CY - tm["y0"]) / tm["cell"] - 0.5
elev = ndimage.map_coordinates(terr, [fj, fi], order=1, mode="nearest")
elev = np.where(elev < 0.3, 0.0, elev)
log("buildings on terrain:", int((elev > 0).sum()))

# ---------------------------------------------------------------- roof hints
rs = b["roof:shape"].fillna("").values
roof = np.zeros(len(b), np.uint8)
quad = fill >= 0.76
hall = np.isin(style, [ST["imperial"], ST["temple"]])
roof[hall & quad] = ROOF["hip"]
roof[hall & quad & (mlong / np.maximum(mshort, 0.1) < 1.3) & (area < 420)] = ROOF["pyramid"]
roof[hall & quad & (area >= 1000) & (style == ST["imperial"])] = ROOF["hip2"]
low = np.isin(style, [ST["courtyard"], ST["village"]])
roof[low & (fill >= 0.70) & (mshort <= 14) & (area <= 460)] = ROOF["gable"]
roof[(style == ST["industrial"]) & (area > 700) & (fill > 0.8) & (mshort < 70)] = ROOF["shed"]
roof[(style == ST["tank"])] = ROOF["dome"]
for tag, code in (("gabled", "gable"), ("hipped", "hip"), ("pyramidal", "pyramid"), ("hipped-and-gabled", "hip"), ("dome", "dome"), ("round", "round"), ("skillion", "flat"), ("flat", "flat")):
    m = (rs == tag) & (quad | (code in ("dome", "flat")))
    roof[m] = ROOF[code]
# seeds + compound palette (buildings of one housing estate share a facade colour)
h = (np.floor(CX * 3.1).astype(np.int64) * 73856093) ^ (np.floor(CY * 3.1).astype(np.int64) * 19349663)
seed = (h & 0xFF).astype(np.uint8)
areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
comp = areas[areas.kind.isin(["landuse=residential", "landuse=commercial", "landuse=retail", "landuse=industrial", "amenity=university", "amenity=school", "amenity=hospital", "amenity=college"])].copy()
comp["geometry"] = shapely.make_valid(project_geoms(comp.geometry.values))
comp["a"] = shapely.area(comp.geometry.values)
comp = comp[comp.a < 1.2e6].reset_index(drop=True)
tree = shapely.STRtree(comp.geometry.values)
qi, ti = tree.query(shapely.points(CX, CY), predicate="within")
cid = np.full(len(b), -1, dtype=np.int64)
dfc = pd.DataFrame({"qi": qi, "ti": ti, "a": comp.a.values[ti]}).sort_values("a").drop_duplicates("qi")
cid[dfc.qi.values] = dfc.ti.values
grid_c = (np.floor(CX / 240).astype(np.int64) * 9176 + np.floor(CY / 240).astype(np.int64)) + 1000003
cid = np.where(cid >= 0, cid, grid_c)
pal = np.where(hall, b["pal"].values, ((cid * 2654435761) >> 7) & 0xFF).astype(np.uint8)
# low-rise fabric: bit 7 = colourful roofs allowed (suburban villages); the old city stays grey-tiled
lowrise = np.isin(style, [ST["courtyard"], ST["village"]])
pal = np.where(lowrise, (pal & 0x7F) | np.where(ring >= 4, 0x80, 0), pal).astype(np.uint8)
log("roof hints", {k: int((roof == v).sum()) for k, v in ROOF.items()})

# ---------------------------------------------------------------- simplify
far = ring >= 7
tol = np.where(far, 0.9, 0.45)
gs = g.copy()
for t in np.unique(tol):
    m = tol == t
    gs[m] = shapely.simplify(g[m], t, preserve_topology=True)
gs = shapely.make_valid(gs)
# drop tiny holes
def drop_small_holes(geoms, min_area):
    out = geoms.copy()
    nh = shapely.get_num_interior_rings(geoms)
    for i in np.where(nh > 0)[0]:
        p = geoms[i]
        if p.geom_type != "Polygon":
            continue
        keep = [r for r in p.interiors if shapely.Polygon(r).area >= min_area]
        if len(keep) != len(p.interiors):
            out[i] = shapely.Polygon(p.exterior, keep)
    return out
gs = drop_small_holes(gs, 30.0)
ok = (shapely.get_type_id(gs) == 3) & (shapely.area(gs) >= 9.0) & ~shapely.is_empty(gs)
log("valid simple polygons", int(ok.sum()), "of", len(gs), "(multi after simplify:", int((shapely.get_type_id(gs) == 6).sum()), ")")
# multi-polygons after make_valid: keep the largest part
for i in np.where(shapely.get_type_id(gs) == 6)[0]:
    parts = [p for p in gs[i].geoms if p.geom_type == "Polygon"]
    if parts:
        gs[i] = max(parts, key=lambda p: p.area)
ok = (shapely.get_type_id(gs) == 3) & (shapely.area(gs) >= 9.0) & ~shapely.is_empty(gs)
gs = shapely.orient_polygons(gs) if hasattr(shapely, "orient_polygons") else np.array([shapely.geometry.polygon.orient(p) if p is not None and p.geom_type == "Polygon" else p for p in gs], dtype=object)

ti_ = np.floor((CX - GRID_X0) / TILE).astype(int); tj_ = np.floor((CY - GRID_Y0) / TILE).astype(int)
ok &= (ti_ >= 0) & (ti_ < GRID_NX) & (tj_ >= 0) & (tj_ < GRID_NY)

rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet")).set_index("ring")
r5 = rings.geometry[5].buffer(1500)
is_base = np.where(ring <= 5, (area >= 220) | (height >= 20), np.where(ring == 6, (area >= 300) | (height >= 24), (area >= 420) | (height >= 30)))
is_base |= (style == ST["tank"]) & (height > 30)
log("base", int((is_base & ok).sum()), "detail", int((~is_base & ok).sum()))


# ---------------------------------------------------------------- encoder
def encode(polys, hgt, bas, elv, sty, pl, rf, sd, ox, oy):
    nb = len(polys)
    ringsizes = []; nrings = np.zeros(nb, np.uint8); coords = []
    keep = np.ones(nb, bool)
    for k, p in enumerate(polys):
        rr = [np.asarray(p.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in p.interiors]
        q = [np.round((r - (ox, oy)) * 10).astype(np.int64) for r in rr]
        # drop consecutive duplicates created by quantisation
        q2 = []
        for r in q:
            d = np.any(np.diff(np.vstack([r, r[:1]]), axis=0) != 0, axis=1)
            r = r[d]
            if len(r) >= 3:
                q2.append(r)
        if not q2 or len(q2[0]) < 3 or len(q2) > 255 or max(len(r) for r in q2) > 65535:
            keep[k] = False
            continue
        nrings[k] = len(q2)
        prev = np.zeros(2, np.int64)
        for r in q2:
            ringsizes.append(len(r))
            dlt = np.diff(np.vstack([prev, r]), axis=0)
            if np.abs(dlt).max() > 32767:
                keep[k] = False
            coords.append(dlt)
            prev = r[-1]
    if not keep.all():
        # rare; re-encode without the offenders
        idx = np.where(keep)[0]
        return encode([polys[i] for i in idx], hgt[idx], bas[idx], elv[idx], sty[idx], pl[idx], rf[idx], sd[idx], ox, oy)
    xy = np.vstack(coords).astype(np.int16) if coords else np.zeros((0, 2), np.int16)
    nr = len(ringsizes); nv = len(xy)
    out = [struct.pack("<III", nb, nr, nv),
           np.clip(np.round(hgt * 10), 0, 65535).astype("<u2").tobytes(), np.clip(np.round(bas * 10), 0, 65535).astype("<u2").tobytes(),
           np.clip(np.round(elv * 10), 0, 65535).astype("<u2").tobytes(),
           sty.astype(np.uint8).tobytes(), pl.astype(np.uint8).tobytes(), rf.astype(np.uint8).tobytes(), sd.astype(np.uint8).tobytes(), nrings.tobytes()]
    blob = b"".join(out)
    if len(blob) % 2:
        blob += b"\0"
    blob += np.asarray(ringsizes, "<u2").tobytes() + xy.astype("<i2").tobytes()
    if len(blob) % 4:
        blob += b"\0" * (4 - len(blob) % 4)
    return blob, nb, nv


def make_masses(polys, hgt, sty, pl, elv):
    """Melt small buildings into block masses (morphological closing)."""
    if len(polys) == 0:
        return [], np.zeros(0), np.zeros(0, np.uint8), np.zeros(0, np.uint8), np.zeros(0)
    r = 3.2
    u = shapely.union_all(shapely.buffer(np.asarray(polys, dtype=object), r, join_style="mitre", mitre_limit=2.0))
    u = shapely.buffer(u, -r, join_style="mitre", mitre_limit=2.0)
    u = shapely.simplify(u, 1.3, preserve_topology=True)
    parts = [p for p in (u.geoms if hasattr(u, "geoms") else [u]) if p.geom_type == "Polygon" and p.area >= 70]
    if not parts:
        return [], np.zeros(0), np.zeros(0, np.uint8), np.zeros(0, np.uint8), np.zeros(0)
    parts = [shapely.Polygon(p.exterior, [h_ for h_ in p.interiors if shapely.Polygon(h_).area >= 140]) for p in parts]
    parts = [shapely.geometry.polygon.orient(p) for p in parts]
    tree = shapely.STRtree(np.asarray(parts, dtype=object))
    pts = shapely.point_on_surface(np.asarray(polys, dtype=object))
    qi, ti = tree.query(pts, predicate="within")
    a = shapely.area(np.asarray(polys, dtype=object))
    mh = np.zeros(len(parts)); mw = np.zeros(len(parts)); me = np.zeros(len(parts))
    np.add.at(mh, ti, hgt[qi] * a[qi]); np.add.at(mw, ti, a[qi]); np.add.at(me, ti, elv[qi] * a[qi])
    ms = np.zeros(len(parts), np.uint8); mp = np.zeros(len(parts), np.uint8)
    df = pd.DataFrame({"t": ti, "s": sty[qi], "p": pl[qi], "a": a[qi]})
    top = df.groupby(["t", "s"]).a.sum().reset_index().sort_values("a").drop_duplicates("t", keep="last")
    ms[top.t.values] = top.s.values
    topp = df.sort_values("a").drop_duplicates("t", keep="last")
    mp[topp.t.values] = topp.p.values
    good = mw > 0
    hh = np.where(good, mh / np.maximum(mw, 1e-6), 4.0) * 0.94
    ee = np.where(good, me / np.maximum(mw, 1e-6), 0.0)
    idx = np.where(good)[0]
    idx = idx[np.argsort([-parts[i].area for i in idx])]      # biggest blocks first (LOD draws a prefix)
    return [parts[i] for i in idx], hh[idx], ms[idx], mp[idx], ee[idx]


# ---------------------------------------------------------------- per tile
import pickle
TREES = {}
tp = os.path.join(WORK, "tree_tiles.pkl")
if os.path.exists(tp):
    TREES = pickle.load(open(tp, "rb"))
    log("tree tiles", len(TREES))
order = np.lexsort((tj_, ti_))
key = ti_ * 1000 + tj_
tiles = {}
base_blobs = {}
tot = dict(base=0, mass=0, detail=0, bv=0, mv=0, dv=0, detail_bytes=0)
idx_all = np.where(ok)[0]
groups = pd.Series(idx_all).groupby(key[idx_all]).apply(lambda s: s.values)
basev = np.asarray(b["base"].values, dtype=float)
for kk, idx in groups.items():
    i, j = int(kk // 1000), int(kk % 1000)
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    ib = idx[is_base[idx]]; idt = idx[~is_base[idx]]
    # big first so the worker can stop early for far LODs if ever needed
    ib = ib[np.argsort(-height[ib] * np.sqrt(area[ib]))]
    bb, nbb, nvb = encode(list(gs[ib]), height[ib], basev[ib], elev[ib], style[ib], pal[ib], roof[ib], seed[ib], ox, oy)
    mp_, mh_, ms_, mpal_, me_ = make_masses(list(gs[idt]), height[idt], style[idt], pal[idt], elev[idt])
    mb, nmb, nvm = encode(mp_, mh_, np.zeros(len(mp_)), me_, ms_, mpal_, np.zeros(len(mp_), np.uint8), np.zeros(len(mp_), np.uint8), ox, oy)
    db, ndb, nvd = encode(list(gs[idt]), height[idt], basev[idt], elev[idt], style[idt], pal[idt], roof[idt], seed[idt], ox, oy)
    tb = TREES.pop((i, j), b"")
    has_detail = bool(ndb or tb)
    dz = gzip.compress(struct.pack("<II", len(db), len(tb)) + db + tb, 9) if has_detail else b""
    if has_detail:
        with open(os.path.join(OUT, "detail", f"{i}_{j}.bin"), "wb") as f:
            f.write(dz)
    hmax = float(max(np.max(height[idx] + elev[idx]) if len(idx) else 0, 1))
    tiles[(i, j)] = dict(i=i, j=j, nb=nbb, nm=nmb, nd=ndb, nt=len(tb), hmax=round(hmax, 1), dbytes=len(dz),
                         inner=bool(r5.intersects(shapely.box(ox, oy, ox + TILE, oy + TILE))))
    base_blobs[(i, j)] = (bb, mb)
    tot["base"] += nbb; tot["mass"] += nmb; tot["detail"] += ndb; tot["bv"] += nvb; tot["mv"] += nvm; tot["dv"] += nvd; tot["detail_bytes"] += len(dz)
for (i, j), tb in list(TREES.items()):
    if not (0 <= i < GRID_NX and 0 <= j < GRID_NY):
        continue
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    empty = encode([], np.zeros(0), np.zeros(0), np.zeros(0), np.zeros(0, np.uint8), np.zeros(0, np.uint8), np.zeros(0, np.uint8), np.zeros(0, np.uint8), ox, oy)[0]
    dz = gzip.compress(struct.pack("<II", len(empty), len(tb)) + empty + tb, 9)
    with open(os.path.join(OUT, "detail", f"{i}_{j}.bin"), "wb") as f:
        f.write(dz)
    tiles[(i, j)] = dict(i=i, j=j, nb=0, nm=0, nd=0, nt=len(tb), hmax=30.0, dbytes=len(dz), inner=bool(r5.intersects(shapely.box(ox, oy, ox + TILE, oy + TILE))))
    base_blobs[(i, j)] = (b"", b"")
    tot["detail_bytes"] += len(dz)
log("tiles", len(tiles), tot)

# ---------------------------------------------------------------- pack base shells (centre first)
ci, cj = int((0 - GRID_X0) // TILE), int((0 - GRID_Y0) // TILE)
SHELLS = [2, 4, 6, 9, 13, 99]
files = []
for s, lim in enumerate(SHELLS):
    lo = SHELLS[s - 1] if s else -1
    keys = [k for k in tiles if lo < max(abs(k[0] - ci), abs(k[1] - cj)) <= lim]
    keys.sort(key=lambda k: (max(abs(k[0] - ci), abs(k[1] - cj)), k))
    buf = bytearray()
    for k in keys:
        bb, mb = base_blobs[k]
        t = tiles[k]
        t["file"] = s; t["bo"] = len(buf); t["bl"] = len(bb); buf += bb
        t["mo"] = len(buf); t["ml"] = len(mb); buf += mb
    z = gzip.compress(bytes(buf), 9)
    name = f"base_{s}.bin"
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(z)
    files.append(dict(name=name, bytes=len(z), raw=len(buf), tiles=len(keys)))
    log("  shell", s, name, f"{len(z) / 1e6:.2f} MB gz ({len(buf) / 1e6:.2f} raw) tiles={len(keys)}")

manifest = dict(
    version=1, origin=dict(lon=LON0, lat=LAT0, note="x east, y north, metres; local transverse Mercator"),
    grid=dict(x0=GRID_X0, y0=GRID_Y0, tile=TILE, nx=GRID_NX, ny=GRID_NY), units="decimetre", gzip=True,
    baseFiles=files, tiles=sorted(tiles.values(), key=lambda t: (t["file"], t["bo"])),
    totals=dict(buildings=int(ok.sum()), base=tot["base"], mass=tot["mass"], detail=tot["detail"], detailBytes=tot["detail_bytes"]),
)
json.dump(manifest, open(os.path.join(OUT, "buildings.json"), "w"), separators=(",", ":"))
log("manifest written; base total %.2f MB, detail total %.2f MB" % (sum(f["bytes"] for f in files) / 1e6, tot["detail_bytes"] / 1e6))
