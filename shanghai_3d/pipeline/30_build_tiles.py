"""Cut the building set into per-tile sections.

  base    every building that still matters from afar (large footprint or tall): always loaded
  mass    small buildings melted into low block masses: stand in for them until the detail arrives
  detail  the small buildings themselves, streamed in near the camera

Every wall edge carries flags: 1 = faces a street (shop fronts, entrances), 2 = party wall (touches a neighbour: no windows).
Writes work/sections/{base,mass,detail}/<i>_<j>.bin (see tilefmt.py) and work/tiles_buildings.json.

usage: 30_build_tiles.py <work_dir> [landmark_exclusions.json]
"""
import sys, os, json, time, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *
from tilefmt import encode_buildings

WORK = sys.argv[1]
EXCL = sys.argv[2] if len(sys.argv) > 2 else None
T0 = time.time()
for d in ("base", "mass", "detail"):
    os.makedirs(os.path.join(WORK, "sections", d), exist_ok=True)
    for f in os.listdir(os.path.join(WORK, "sections", d)):
        os.remove(os.path.join(WORK, "sections", d, f))


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


ST = dict(generic=0, resi_slab=1, resi_tower=2, lilong=3, villa=4, office_glass=5, office_grid=6, retail=7, industrial=8, public=9,
          heritage=10, temple=11, bigroof=12, canopy=13, tank=14, construction=15, village=16, hotel=17, parking=18, special=19)
ROOF = dict(flat=0, gable=1, hip=2, pyramid=3, xieshan=4, mansard=5, dome=7, shed=8, round=9, sawtooth=10)

b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"))
# vessels on the river that the satellite footprints took for buildings (36_boats.py): they become boats
_bm = os.path.join(WORK, "boat_buildings.npy")
if os.path.exists(_bm):
    _m = np.load(_bm)
    if len(_m) == len(b):
        b = b[~_m].reset_index(drop=True)
        log("boats taken out of the buildings", int(_m.sum()))

# ---------------------------------------------------------------- landmark exclusions (hand-modelled heroes replace these footprints)
if EXCL and os.path.exists(EXCL):
    ex = json.load(open(EXCL))
    kill = np.zeros(len(b), bool)
    ids = set(ex.get("osm_ids", []))
    if ids:
        kill |= b["osm_id"].isin(ids).values | b["outline_id"].isin(ids).values
    X = b["cx"].values; Y = b["cy"].values
    for c in ex.get("circles", []):
        kill |= np.hypot(X - c["x"], Y - c["y"]) < c["r"]
    for p in ex.get("polygons", []):
        poly = shapely.Polygon(p); shapely.prepare(poly)
        kill |= shapely.contains(poly, shapely.points(X, Y))
    b = b[~kill].reset_index(drop=True)
    log("landmark exclusions removed", int(kill.sum()))

# ---------------------------------------------------------------- very large footprints are cut along the tile grid
# (the client stores vertices as 16-bit offsets from the tile centre: anything reaching more than ~800 m from it would wrap)
bb = shapely.bounds(b.geometry.values)
tcx = GRID_X0 + (np.floor((b["cx"].values - GRID_X0) / TILE) + 0.5) * TILE
tcy = GRID_Y0 + (np.floor((b["cy"].values - GRID_Y0) / TILE) + 0.5) * TILE
REACH = 760.0
bigm = (bb[:, 0] < tcx - REACH) | (bb[:, 2] > tcx + REACH) | (bb[:, 1] < tcy - REACH) | (bb[:, 3] > tcy + REACH)
b["split"] = False
if bigm.any():
    rows = []
    for idx in np.where(bigm)[0]:
        r = b.iloc[idx]
        x0, y0, x1, y1 = bb[idx]
        for i in range(int(np.floor((x0 - GRID_X0) / TILE)), int(np.floor((x1 - GRID_X0) / TILE)) + 1):
            for j in range(int(np.floor((y0 - GRID_Y0) / TILE)), int(np.floor((y1 - GRID_Y0) / TILE)) + 1):
                piece = shapely.intersection(r.geometry, shapely.box(GRID_X0 + i * TILE, GRID_Y0 + j * TILE, GRID_X0 + (i + 1) * TILE, GRID_Y0 + (j + 1) * TILE))
                for q in (piece.geoms if hasattr(piece, "geoms") else [piece]):
                    if q.geom_type == "Polygon" and q.area >= 8:
                        rr = r.copy(); rr["geometry"] = q; c_ = q.representative_point(); rr["cx"] = c_.x; rr["cy"] = c_.y; rr["area"] = q.area; rr["split"] = True
                        rows.append(rr)
    b = pd.concat([b[~bigm], gpd.GeoDataFrame(rows, geometry="geometry", crs=b.crs)], ignore_index=True)
    b = gpd.GeoDataFrame(b, geometry="geometry")
    log("oversized footprints cut along the tile grid:", int(bigm.sum()), "->", len(rows), "pieces")

g = b.geometry.values
area = b["area"].values; height = b["height"].values.astype(float); style = b["style"].values; ring = b["ring"].values
CX = b["cx"].values; CY = b["cy"].values
fill = b["fill"].values; mlong = b["mlong"].values; mshort = b["mshort"].values
levels = b["levels"].values

# ---------------------------------------------------------------- seeds, compound palettes
hsh = (np.floor(CX * 3.1).astype(np.int64) * 73856093) ^ (np.floor(CY * 3.1).astype(np.int64) * 19349663)
seed = (hsh & 0xFF).astype(np.uint8)
cid = pd.to_numeric(b["compound"], errors="coerce").values
grid_c = (np.floor(CX / 180).astype(np.int64) * 9176 + np.floor(CY / 180).astype(np.int64)) + 1000003
cidv = np.where(np.isfinite(cid), np.nan_to_num(cid).astype(np.int64), grid_c)
pal = (((cidv * 2654435761) >> 7) & 0xFF).astype(np.uint8)

# ---------------------------------------------------------------- roof hints
rs = b["roof:shape"].fillna("").values
roof = np.zeros(len(b), np.uint8)
quad = fill >= 0.74
slender = mlong / np.maximum(mshort, 0.1)
roof[(style == ST["lilong"]) & (fill >= 0.62) & (mshort <= 16)] = ROOF["gable"]
roof[(style == ST["village"]) & (fill >= 0.66) & (mshort <= 15) & (area <= 420)] = ROOF["gable"]
roof[(style == ST["villa"]) & (fill >= 0.6)] = ROOF["hip"]
# "flat-to-pitched" retrofits: whole estates of walk-up slabs got tiled roofs
pitched_estate = ((pal.astype(int) * 37) % 100) < 42
roof[(style == ST["resi_slab"]) & pitched_estate & quad & (mshort <= 17) & (height <= 24)] = ROOF["hip"]
roof[(style == ST["temple"]) & quad] = ROOF["xieshan"]
roof[(style == ST["temple"]) & quad & (slender < 1.3) & (area < 160)] = ROOF["pyramid"]
roof[(style == ST["industrial"]) & (area > 600) & (fill > 0.78) & (mshort < 80)] = ROOF["shed"]
roof[(style == ST["industrial"]) & (area > 4000) & (fill > 0.8) & (seed < 70)] = ROOF["sawtooth"]
roof[(style == ST["tank"])] = ROOF["dome"]
roof[(style == ST["heritage"]) & quad & (height < 22) & (area < 900) & (seed < 120)] = ROOF["hip"]
for tag, code in (("gabled", "gable"), ("hipped", "hip"), ("pyramidal", "pyramid"), ("hipped-and-gabled", "xieshan"), ("dome", "dome"), ("round", "round"), ("skillion", "flat"), ("flat", "flat"),
                  ("mansard", "mansard"), ("onion", "dome")):
    m = (rs == tag) & (quad | (code in ("dome", "flat")))
    roof[m] = ROOF[code]
roof[b["split"].values.astype(bool)] = ROOF["flat"]
log("roof hints", {k: int((roof == v).sum()) for k, v in ROOF.items()})

# ---------------------------------------------------------------- simplify
tol = np.where(b["src"].values == "osm", 0.30, 0.55)
gs = g.copy()
for t in np.unique(tol):
    m = tol == t
    gs[m] = shapely.simplify(g[m], t, preserve_topology=True)
gs = shapely.make_valid(gs)
for i in np.where(shapely.get_type_id(gs) == 6)[0]:
    parts = [p for p in gs[i].geoms if p.geom_type == "Polygon"]
    if parts:
        gs[i] = max(parts, key=lambda p: p.area)
nh = shapely.get_num_interior_rings(gs)
for i in np.where(nh > 0)[0]:
    p = gs[i]
    if p.geom_type == "Polygon":
        keep = [r for r in p.interiors if shapely.Polygon(r).area >= 20.0]
        if len(keep) != len(p.interiors):
            gs[i] = shapely.Polygon(p.exterior, keep)
ok = (shapely.get_type_id(gs) == 3) & (shapely.area(gs) >= 8.0) & ~shapely.is_empty(gs)
gs = shapely.orient_polygons(gs)
ti_ = np.floor((CX - GRID_X0) / TILE).astype(int); tj_ = np.floor((CY - GRID_Y0) / TILE).astype(int)
ok &= (ti_ >= 0) & (ti_ < GRID_NX) & (tj_ >= 0) & (tj_ < GRID_NY)
log("valid polygons", int(ok.sum()), "of", len(gs))

# ---------------------------------------------------------------- edge flags
idx_ok = np.where(ok)[0]
coords, off = shapely.get_coordinates(gs[idx_ok], return_index=False), None
# ring structure: iterate rings explicitly (vectorised per ring would need ragged arrays; rings are short, so batch through numpy)
rings_xy, ring_bld = [], []
ext = shapely.get_exterior_ring(gs[idx_ok])
ext_xy = shapely.get_coordinates(ext); ext_n = shapely.get_num_coordinates(ext)
starts = np.concatenate([[0], np.cumsum(ext_n)])
# exterior edges only (courtyard walls keep default flags)
p0 = ext_xy[:-1]; p1 = ext_xy[1:]
valid_edge = np.ones(len(ext_xy) - 1, bool); valid_edge[starts[1:-1] - 1] = False       # no edge across ring boundaries
bld_of_edge = np.repeat(np.arange(len(idx_ok)), ext_n)[:-1]
e = p1 - p0
elen = np.hypot(e[:, 0], e[:, 1])
nrm = np.column_stack([e[:, 1], -e[:, 0]]) / np.maximum(elen, 1e-6)[:, None]              # outward for CCW rings
mid = (p0 + p1) / 2
flags = np.zeros(len(e), np.uint8)
use = valid_edge & (elen > 0.8)
tree = shapely.STRtree(gs[idx_ok])
probe = shapely.points(mid[use] + nrm[use] * 0.7)
qi, tj2 = tree.query(probe, predicate="within")
ue = np.where(use)[0]
other = tj2 != bld_of_edge[ue[qi]]
party = np.zeros(len(e), bool); party[ue[qi[other]]] = True
flags[party] |= 2
log("edges", int(use.sum()), "party walls", int(party.sum()))

# street frontage: nearest carriageway within reach, in front of the wall
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
rt = [json.loads(t) for t in roads["tags"].values]
hw = roads.highway.values
FRONT = {"primary": 16, "secondary": 13, "tertiary": 11, "residential": 8, "unclassified": 8, "pedestrian": 9, "living_street": 6, "trunk": 18}
sel = np.isin(hw, list(FRONT)) & np.array([not (t.get("bridge") not in (None, "no") or t.get("tunnel") not in (None, "no")) for t in rt])
rg = project_geoms(roads.geometry.values[sel]); rhw = hw[sel]
rtree = shapely.STRtree(rg)
cand = ue[~party[ue]]
pts = shapely.points(mid[cand])
qi, ri = rtree.query_nearest(pts, max_distance=30.0, all_matches=False)
sl = shapely.shortest_line(pts[qi], rg[ri])
sc = shapely.get_coordinates(sl).reshape(-1, 2, 2)
v = sc[:, 1] - sc[:, 0]
dist = np.hypot(v[:, 0], v[:, 1])
facing = (v * nrm[cand[qi]]).sum(1) / np.maximum(dist, 1e-6)
reach = np.array([FRONT[h] for h in rhw[ri]]) + 9.0
front = (facing > 0.55) & (dist < reach) & (elen[cand[qi]] >= 3.0)
flags[cand[qi[front]]] |= 1
log("street-front edges", int(front.sum()))
# does the building have any street frontage at all?
has_front = np.zeros(len(idx_ok), bool)
np.logical_or.at(has_front, bld_of_edge[cand[qi[front]]], True)

# per-building list of exterior-ring flags (aligned with ring vertices; the closing vertex is dropped by the encoder)
edge_lists = {}
for k, i in enumerate(idx_ok):
    edge_lists[i] = [flags[starts[k]:starts[k + 1] - 1]]

bflags = np.zeros(len(b), np.uint8)
bflags[b["is_part"].values] |= 1
bflags[b["name"].notna().values] |= 2
bflags[idx_ok[has_front]] |= 4
bflags[b["src"].values == "osm"] |= 8

is_base = (area >= 240) | (height >= 21) | ((style == ST["tank"]) & (height > 30)) | (style == ST["temple"]) & (area > 60) | (style == ST["heritage"])
log("base", int((is_base & ok).sum()), "detail", int((~is_base & ok).sum()))
basev = b["base"].values.astype(float)


def make_masses(polys, hgt, sty, pl):
    """Melt small buildings into block masses (morphological closing)."""
    empty = ([], np.zeros(0), np.zeros(0, np.uint8), np.zeros(0, np.uint8))
    if len(polys) == 0:
        return empty
    r = 3.0
    arr = np.asarray(polys, dtype=object)
    u = shapely.union_all(shapely.buffer(arr, r, join_style="mitre", mitre_limit=2.0))
    u = shapely.buffer(u, -r, join_style="mitre", mitre_limit=2.0)
    u = shapely.simplify(u, 1.2, preserve_topology=True)
    parts = [p for p in (u.geoms if hasattr(u, "geoms") else [u]) if p.geom_type == "Polygon" and p.area >= 60]
    if not parts:
        return empty
    parts = [shapely.Polygon(p.exterior, [h_ for h_ in p.interiors if shapely.Polygon(h_).area >= 120]) for p in parts]
    parts = [shapely.geometry.polygon.orient(p) for p in parts]
    ptree = shapely.STRtree(np.asarray(parts, dtype=object))
    pts = shapely.point_on_surface(arr)
    qi, ti = ptree.query(pts, predicate="within")
    a = shapely.area(arr)
    mh = np.zeros(len(parts)); mw = np.zeros(len(parts))
    np.add.at(mh, ti, hgt[qi] * a[qi]); np.add.at(mw, ti, a[qi])
    ms = np.zeros(len(parts), np.uint8); mp = np.zeros(len(parts), np.uint8)
    df = pd.DataFrame({"t": ti, "s": sty[qi], "p": pl[qi], "a": a[qi]})
    top = df.groupby(["t", "s"]).a.sum().reset_index().sort_values("a").drop_duplicates("t", keep="last")
    ms[top.t.values] = top.s.values
    topp = df.sort_values("a").drop_duplicates("t", keep="last")
    mp[topp.t.values] = topp.p.values
    good = mw > 0
    hh = np.where(good, mh / np.maximum(mw, 1e-6), 4.0) * 0.95
    idx = np.where(good)[0]
    idx = idx[np.argsort([-parts[i].area for i in idx])]
    return [parts[i] for i in idx], hh[idx], ms[idx], mp[idx]


key = ti_ * 1000 + tj_
groups = pd.Series(idx_ok).groupby(key[idx_ok]).apply(lambda s: s.values)
tiles = {}
tot = dict(base=0, mass=0, detail=0)
for kk, idx in groups.items():
    i, j = int(kk // 1000), int(kk % 1000)
    ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
    ib = idx[is_base[idx]]; idt = idx[~is_base[idx]]
    ib = ib[np.argsort(-height[ib] * np.sqrt(area[ib]))]

    def enc(sel):
        attrs = dict(height=height[sel] - basev[sel], base=basev[sel], levels=levels[sel], style=style[sel], roof=roof[sel], seed=seed[sel], pal=pal[sel], flags=bflags[sel])
        return encode_buildings(list(gs[sel]), attrs, ox, oy, [edge_lists[s] for s in sel])
    bb, kb = enc(ib)
    db, kd = enc(idt)
    mp_, mh_, ms_, mpal_ = make_masses(list(gs[idt]), height[idt], style[idt], pal[idt])
    z = np.zeros(len(mp_))
    mb, km = encode_buildings(mp_, dict(height=mh_, base=z, levels=z + 1, style=ms_, roof=z, seed=z, pal=mpal_, flags=z), ox, oy)
    name = f"{i}_{j}.bin"
    if len(kb): open(os.path.join(WORK, "sections", "base", name), "wb").write(bb)
    if len(km): open(os.path.join(WORK, "sections", "mass", name), "wb").write(mb)
    if len(kd): open(os.path.join(WORK, "sections", "detail", name), "wb").write(db)
    hmax = float(max(np.max(height[idx]) if len(idx) else 0, 1))
    tiles[f"{i}_{j}"] = dict(i=i, j=j, nb=int(len(kb)), nm=int(len(km)), nd=int(len(kd)), hmax=round(hmax, 1))
    tot["base"] += len(kb); tot["mass"] += len(km); tot["detail"] += len(kd)
log("tiles", len(tiles), tot)
json.dump(dict(tiles=tiles, totals=tot), open(os.path.join(WORK, "tiles_buildings.json"), "w"))
log("done")
