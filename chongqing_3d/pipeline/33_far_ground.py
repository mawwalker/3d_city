"""City-wide far ground layers for Chongqing: water polygons, road ribbons, non-hero elevated decks, and 20m coarse land cover.

  site/data/far_ground.bin   gzip 'SHG2' (water polygons, road ribbons, deck 3D clearance lines)
  site/data/far_land.bin     gzip u32 w, h | f32 x0, y0, mpp | u8[w*h] (row 0 = south)

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


# ---------------------------------------------------------------- water (Yangtze + Jialing + lakes)
water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
wt = [json.loads(t) for t in water["tags"].values]
wm = np.array([not (t.get("tunnel") not in (None, "no") or t.get("covered") == "yes" or t.get("intermittent") == "yes") for t in wt])
wg = list(shapely.make_valid(project_geoms(water.geometry.values[wm])))
wl = gpd.read_parquet(os.path.join(WORK, "osm_waterlines.parquet"))
wlt = [json.loads(t) for t in wl["tags"].values]
wlk = np.array([not (t.get("tunnel") not in (None, "no") or t.get("intermittent") == "yes") for t in wlt]) & np.isin(wl.waterway.values, ["river", "canal", "stream"])
ww = np.array([num(t.get("width")) for t in wlt])
dflt = pd.Series(wl.waterway.values).map({"river": 22.0, "canal": 12.0, "stream": 5.0}).values
wlw = np.where(np.isfinite(ww) & (ww > 0.5) & (ww < 300), ww, dflt)[wlk] / 2
wg += list(shapely.buffer(project_geoms(wl.geometry.values[wlk]), wlw, cap_style="flat", quad_segs=2))
# Only draw water polygons at river level (< 15m world Y) in far_ground flat water plane so hillside lakes don't sink to y=0!
terrain = TerrainSampler(WORK)
wg_low = []
for g_ in wg:
    if g_ is None or g_.is_empty or g_.area < 200:
        continue
    pt = g_.representative_point()
    if terrain.sample(pt.x, pt.y) < 16.0 or g_.area > 1e5:
        wg_low.append(g_)
WG = np.array(wg_low, dtype=object)
WTREE = shapely.STRtree(WG)
log("water geoms (river plane):", len(WG))

# ---------------------------------------------------------------- roads & decks
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
A = pickle.load(open(os.path.join(WORK, "roads_attr.pkl"), "rb"))
cls = A["cls"]
W = A["W"]
bridge = A["bridge"]
tunnel = A["tunnel"]
is_area = A["area"]
in_hero = A.get("in_hero", np.zeros(len(cls), bool))
keep = np.isin(cls, [0, 1, 2, 3, 4, 5, 6, 11]) & ~tunnel & ~is_area & ~in_hero


def simplify3d(c, tol):
    n = len(c)
    if n <= 2:
        return c
    kp = np.zeros(n, bool)
    kp[0] = kp[-1] = True
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
            k += a + 1
            kp[k] = True
            stack += [(a, k), (k, b)]
    return c[kp]


DECKS = []
_dp = os.path.join(WORK, "decks.pkl")
if os.path.exists(_dp):
    for d in pickle.load(open(_dp, "rb")):
        keep[d["i"]] = False
        DECKS.append((simplify3d(d["xyz"].astype(float), 0.6), d["cls"] | (64 if d["main"] else 0), d["w"]))
DTREE = shapely.STRtree([shapely.LineString(d[0][:, :2]) for d in DECKS]) if DECKS else None
RG = shapely.simplify(project_geoms(roads.geometry.values[keep]), 0.6)
RCLS = cls[keep]
RW = W[keep]
RBR = bridge[keep]
RTREE = shapely.STRtree(RG)
log("roads", len(RG), "decks", len(DECKS))

chunks = []
body = bytearray()
for ci in range(NCX):
    for cj in range(NCY):
        ox, oy = X_MIN + ci * CH, Y_MIN + cj * CH
        box = shapely.box(ox, oy, ox + CH, oy + CH)
        wi = WTREE.query(box)
        wb = b""
        if len(wi):
            u = shapely.intersection(shapely.buffer(shapely.union_all(shapely.intersection(WG[wi], box.buffer(3))), 1.5, quad_segs=2), box)
            u = shapely.simplify(u, 0.8, preserve_topology=True)
            ps = [shapely.geometry.polygon.orient(shapely.Polygon(p.exterior, [h for h in p.interiors if shapely.Polygon(h).area > 30]))
                  for p in polys_of(shapely.make_valid(u)) if p.area > 25]
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
                        L.append(part)
                        a_c.append(int(RCLS[k]))
                        a_w.append(int(np.clip(round(RW[k] * 4), 1, 255)))
                        a_f.append(2 if RBR[k] else 0)
            if L:
                rb = encode_lines(L, [a_c, a_w, a_f], ox, oy, 3)
        db = b""
        if DTREE is not None:
            L3, a_c, a_w = [], [], []
            for k in DTREE.query(box):
                xyz, c_, w_ = DECKS[k]
                for cc in clip_line_box(xyz, ox, oy, ox + CH, oy + CH):
                    if np.hypot(*np.diff(cc[:, :2], axis=0).T).sum() > 1.0 and cc[:, 2].max() > 0.4:
                        L3.append(cc)
                        a_c.append(c_)
                        a_w.append(int(np.clip(round(w_ * 4), 1, 255)))
            if L3:
                db = encode_lines_z(L3, [a_c, a_w], ox, oy, 2)
        if wb or rb or db:
            chunks.append((ci, cj, len(body), len(wb), len(body) + len(wb), len(rb), len(body) + len(wb) + len(rb), len(db)))
            body += wb + rb + db

head = b"SHG2" + struct.pack("<If", len(chunks), CH)
base = len(head) + len(chunks) * 28
table = b"".join(struct.pack("<HHIIIIII", c[0], c[1], c[2] + base, c[3], c[4] + base, c[5], c[6] + base, c[7]) for c in chunks)
z = gzip.compress(head + table + bytes(body), 9)
open(os.path.join(OUT, "far_ground.bin"), "wb").write(z)
log(f"far_ground.bin {len(z) / 1e6:.2f} MB gz, chunks {len(chunks)}")

# ---------------------------------------------------------------- coarse land cover (20 m)
# Uses built tiles where available, and fills unbuilt outer tiles cleanly from DEM elevation & rivers (for Phase 1!)
PXM = 20.0
F = int(PXM / 2.0)
NPX = int(TILE / 2.0)
tw = NPX // F
Wd, Hd = GRID_NX * tw, GRID_NY * tw
# Default far land cover from DEM (hills -> subtropical green forest=2, river -> water=6, valley -> urban=0)
xs = X_MIN + (np.arange(Wd) + 0.5) * PXM
ys = Y_MIN + (np.arange(Hd) + 0.5) * PXM
Xg, Yg = np.meshgrid(xs, ys)
el = terrain.sample(Xg.ravel(), Yg.ravel()).reshape(Hd, Wd)
land = np.where(el < -0.5, 6, np.where(el > 105.0, 2 | (7 << 4), np.where(el > 55.0, 1, 0))).astype(np.uint8)

for i in range(GRID_NX):
    for j in range(GRID_NY):
        p = os.path.join(WORK, "sections", "landcover", f"{i}_{j}.bin")
        if not os.path.exists(p):
            continue
        raw = open(p, "rb").read()
        r = np.frombuffer(raw, np.uint8, NPX * NPX, 8).reshape(NPX, NPX)
        blk = r.reshape(tw, F, tw, F).transpose(0, 2, 1, 3).reshape(tw, tw, F * F)
        cov = blk & 15
        counts = np.stack([(cov == c).sum(-1) for c in range(10)], -1)
        maj = counts.argmax(-1).astype(np.uint8)
        green = counts[:, :, 1] + counts[:, :, 2] + counts[:, :, 3]
        maj = np.where((maj == 0) & (green > F * F * 0.35), 2, maj).astype(np.uint8)
        lu = (blk[:, :, (F * F) // 2 + F // 2] >> 4).astype(np.uint8)
        land[j * tw:(j + 1) * tw, i * tw:(i + 1) * tw] = maj | (lu << 4)

z = gzip.compress(struct.pack("<IIfff", Wd, Hd, X_MIN, Y_MIN, PXM) + land.tobytes(), 9)
open(os.path.join(OUT, "far_land.bin"), "wb").write(z)
log(f"far_land.bin {Wd}x{Hd}, {len(z) / 1e6:.2f} MB gz")
