"""City-wide ground layers that are always loaded: water polygons, road ribbons, and a coarse land-cover map.

  site/data/far_ground.bin   gzip: u32 magic 'SHG2', u32 nchunks, chunk size (m) f32, then per chunk (u16 ci, u16 cj, u32 waterOff, u32 waterLen, u32 roadOff, u32 roadLen,
                             u32 deckOff, u32 deckLen), then payloads
                             water = polygon set (tilefmt.encode_polys, class 4); roads = line set with attrs (class, width*4, flags);
                             decks = elevated ways as 3D lines (tilefmt.encode_lines_z; attrs class | 64 when hung from towers, width*4), heights from 31_build_ground.py
  site/data/far_land.bin     gzip: u32 w, u32 h, f32 x0, y0 (SW corner), f32 metres per pixel, then w*h bytes (row 0 = south): cover | landuse << 4

usage: 33_far_ground.py <work_dir> <site_data_dir>
"""
import sys, os, json, gzip, struct, time, re, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *
from tilefmt import encode_polys, encode_lines, encode_lines_z, clip_line_box

WORK, OUT = sys.argv[1:3]
T0 = time.time()
CH = 2000.0
NCX, NCY = int((X_MAX - X_MIN) / CH), int((Y_MAX - Y_MIN) / CH)
EXTENT = shapely.box(X_MIN, Y_MIN, X_MAX, Y_MAX)


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
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon" and not p.is_empty]


# ---------------------------------------------------------------- water
water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
wt = [json.loads(t) for t in water["tags"].values]
wm = np.array([not (t.get("tunnel") not in (None, "no") or t.get("covered") == "yes" or t.get("intermittent") == "yes") for t in wt])
wg = list(shapely.make_valid(project_geoms(water.geometry.values[wm])))
wl = gpd.read_parquet(os.path.join(WORK, "osm_waterlines.parquet"))
wlt = [json.loads(t) for t in wl["tags"].values]
wlk = np.array([not (t.get("tunnel") not in (None, "no") or t.get("intermittent") == "yes") for t in wlt]) & np.isin(wl.waterway.values, ["river", "canal", "stream", "drain", "ditch"])
ww = np.array([num(t.get("width")) for t in wlt])
dflt = pd.Series(wl.waterway.values).map({"river": 22.0, "canal": 12.0, "stream": 5.0, "drain": 3.0, "ditch": 2.0}).values
wlw = np.where(np.isfinite(ww) & (ww > 0.5) & (ww < 300), ww, dflt)[wlk] / 2
wg += list(shapely.buffer(project_geoms(wl.geometry.values[wlk]), wlw, cap_style="flat", quad_segs=2))
WG = np.array([g for g in wg if g is not None and not g.is_empty], dtype=object)
WTREE = shapely.STRtree(WG)
log("water geoms", len(WG))

# ---------------------------------------------------------------- roads
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
rt = [json.loads(t) for t in roads["tags"].values]
hw = roads.highway.values
RC = dict(motorway=0, trunk=1, primary=2, secondary=3, tertiary=4, residential=5, unclassified=5, living_street=6, busway=4)
cls = np.full(len(roads), -1)
for k, v in RC.items():
    cls[hw == k] = v
link = pd.Series(hw).str.endswith("_link").values
cls[link] = 11
tunnel = np.array([t.get("tunnel") not in (None, "no") or t.get("covered") == "yes" for t in rt])
bridge = np.array([t.get("bridge") not in (None, "no") for t in rt])
lanes = np.array([num(t.get("lanes")) for t in rt])
oneway = np.array([t.get("oneway") in ("yes", "1", "true", "-1") or t.get("junction") == "roundabout" for t in rt]) | (hw == "motorway") | link
is_area = np.array([t.get("area") == "yes" for t in rt])
dfl = lambda a, b: np.where(np.isfinite(lanes), lanes, np.where(oneway, a, b))
W = np.full(len(roads), 6.0)
W[cls == 0] = dfl(3, 6)[cls == 0] * 3.75 + 1.5
W[cls == 1] = dfl(3, 6)[cls == 1] * 3.5 + 1.2
W[cls == 2] = np.where(oneway, dfl(3, 3) * 3.3 + 3.2, dfl(4, 4) * 3.3 + 6.0)[cls == 2]
W[cls == 3] = np.where(oneway, dfl(2, 2) * 3.3 + 3.0, dfl(4, 4) * 3.2 + 5.0)[cls == 3]
W[cls == 4] = np.where(oneway, dfl(2, 2) * 3.3 + 2.4, dfl(2, 2) * 3.4 + 4.6)[cls == 4]
W[cls == 5] = 6.4
W[cls == 6] = 4.6
W[cls == 11] = np.where(np.isfinite(lanes), lanes, 1.4)[cls == 11] * 3.6 + 1.6
keep = (cls >= 0) & ~tunnel & ~is_area
# elevated ways are drawn at their height (below), not as ribbons on the ground
def simplify3d(c, tol):
    n = len(c)
    if n <= 2:
        return c
    kp = np.zeros(n, bool); kp[0] = kp[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p0, d = c[a], c[b] - c[a]
        seg = c[a + 1:b] - p0
        l2 = d @ d
        dist = np.linalg.norm(seg - np.clip(seg @ d / l2, 0, 1)[:, None] * d, axis=1) if l2 > 1e-12 else np.linalg.norm(seg, axis=1)
        k = int(dist.argmax())
        if dist[k] > tol:
            k += a + 1; kp[k] = True; stack += [(a, k), (k, b)]
    return c[kp]


DECKS = []
_dp = os.path.join(WORK, "decks.pkl")
if os.path.exists(_dp):
    for d in pickle.load(open(_dp, "rb")):
        keep[d["i"]] = False
        DECKS.append((simplify3d(d["xyz"].astype(float), 0.6), d["cls"] | (64 if d["main"] else 0), d["w"]))
DTREE = shapely.STRtree([shapely.LineString(d[0][:, :2]) for d in DECKS]) if DECKS else None
log("decks", len(DECKS), "vertices", sum(len(d[0]) for d in DECKS))
RG = project_geoms(roads.geometry.values[keep]); RCLS = cls[keep]; RW = W[keep]; RBR = bridge[keep]
RG = shapely.simplify(RG, 0.6)
RTREE = shapely.STRtree(RG)
log("roads", len(RG))

chunks = []
body = bytearray()
for ci in range(NCX):
    for cj in range(NCY):
        ox, oy = X_MIN + ci * CH, Y_MIN + cj * CH
        box = shapely.box(ox, oy, ox + CH, oy + CH)
        wi = WTREE.query(box)
        wb = b""
        if len(wi):
            # a little wider than the real banks, so the surface always reaches under the embankment walls of the street-level tiles
            u = shapely.intersection(shapely.buffer(shapely.union_all(shapely.intersection(WG[wi], box.buffer(3))), 1.3, quad_segs=2), box)
            u = shapely.simplify(u, 0.6, preserve_topology=True)
            ps = [shapely.geometry.polygon.orient(shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area > 30])) for p in polys_of(shapely.make_valid(u)) if p.area > 25]
            if ps:
                wb = encode_polys(ps, [4] * len(ps), ox, oy)
        ri = RTREE.query(box)
        rb = b""
        if len(ri):
            segs = shapely.intersection(RG[ri], box)
            L, a_c, a_w, a_f = [], [], [], []
            for k, g in zip(ri, segs):
                for part in (g.geoms if hasattr(g, "geoms") else [g]):
                    if part.geom_type == "LineString" and part.length > 2:
                        L.append(part); a_c.append(int(RCLS[k])); a_w.append(int(np.clip(round(RW[k] * 4), 1, 255))); a_f.append(2 if RBR[k] else 0)
            if L:
                rb = encode_lines(L, [a_c, a_w, a_f], ox, oy, 3)
        db = b""
        if DTREE is not None:
            L3, a_c, a_w = [], [], []
            for k in DTREE.query(box):
                xyz, c_, w_ = DECKS[k]
                for cc in clip_line_box(xyz, ox, oy, ox + CH, oy + CH):
                    if np.hypot(*np.diff(cc[:, :2], axis=0).T).sum() > 1.0 and cc[:, 2].max() > 0.4:
                        L3.append(cc); a_c.append(c_); a_w.append(int(np.clip(round(w_ * 4), 1, 255)))
            if L3:
                db = encode_lines_z(L3, [a_c, a_w], ox, oy, 2)
        if wb or rb or db:
            chunks.append((ci, cj, len(body), len(wb), len(body) + len(wb), len(rb), len(body) + len(wb) + len(rb), len(db)))
            body += wb + rb + db
head = b"SHG2" + struct.pack("<If", len(chunks), CH)
table = b"".join(struct.pack("<HHIIIIII", *c) for c in chunks)
base = len(head) + len(table)
table = b"".join(struct.pack("<HHIIIIII", c[0], c[1], c[2] + base, c[3], c[4] + base, c[5], c[6] + base, c[7]) for c in chunks)
z = gzip.compress(head + table + bytes(body), 9)
open(os.path.join(OUT, "far_ground.bin"), "wb").write(z)
log(f"far_ground.bin {len(z) / 1e6:.2f} MB gz ({(len(body) + base) / 1e6:.2f} raw), chunks {len(chunks)}")

# ---------------------------------------------------------------- coarse land cover (20 m)
PXM = 20.0
F = int(PXM / 2.0)
NPX = int(TILE / 2.0)
tw = NPX // F
Wd, Hd = GRID_NX * tw, GRID_NY * tw
land = np.zeros((Hd, Wd), np.uint8)
for i in range(GRID_NX):
    for j in range(GRID_NY):
        p = os.path.join(WORK, "sections", "landcover", f"{i}_{j}.bin")
        if not os.path.exists(p):
            continue
        raw = open(p, "rb").read()
        r = np.frombuffer(raw, np.uint8, NPX * NPX, 8).reshape(NPX, NPX)
        blk = r.reshape(tw, F, tw, F).transpose(0, 2, 1, 3).reshape(tw, tw, F * F)
        cov = blk & 15
        # majority cover in the block; land use from the block centre
        counts = np.stack([(cov == c).sum(-1) for c in range(10)], -1)
        maj = counts.argmax(-1).astype(np.uint8)
        # green share nudges mixed blocks towards "under trees" so leafy districts read as green from afar
        green = counts[:, :, 1] + counts[:, :, 2] + counts[:, :, 3]
        maj = np.where((maj == 0) & (green > F * F * 0.38), 2, maj).astype(np.uint8)
        lu = (blk[:, :, (F * F) // 2 + F // 2] >> 4).astype(np.uint8)
        land[j * tw:(j + 1) * tw, i * tw:(i + 1) * tw] = maj | (lu << 4)
z = gzip.compress(struct.pack("<IIfff", Wd, Hd, X_MIN, Y_MIN, PXM) + land.tobytes(), 9)
open(os.path.join(OUT, "far_land.bin"), "wb").write(z)
log(f"far_land.bin {Wd}x{Hd}, {len(z) / 1e6:.2f} MB gz")
