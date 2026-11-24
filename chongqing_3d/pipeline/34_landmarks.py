"""Exact WGS-84 -> local (x, z, terrainY) placement for ALL Chongqing hero landmarks,
cross-river bridges, Liziba CRT Station + Line 2 monorail spline, and Yangtze River Cableway,
plus landmark_exclusions.json (so procedural buildings NEVER clip heroes) and hero_bridges.json
(so procedural deckGeom is suppressed over hero bridge corridors).

Outputs:
  site/data/landmarks.json
  pipeline/landmark_exclusions.json
  data/work/hero_bridges.json

usage: 34_landmarks.py <work_dir> <site_data_dir> <exclusions.json>
"""
import re, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *

WORK, OUT, EXCL = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)

terrain = TerrainSampler(WORK)
b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"))
nm = b["name"].fillna("")
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"))
rt = [json.loads(t) for t in roads["tags"].values]
r_names = np.array([(t.get("bridge:name") or t.get("name") or "") for t in rt], dtype=object)
rg = project_geoms(roads.geometry.values)
rails = gpd.read_parquet(os.path.join(WORK, "osm_rails.parquet"))
rlt = [json.loads(t) for t in rails["tags"].values]
rlg = project_geoms(rails.geometry.values)
barriers = gpd.read_parquet(os.path.join(WORK, "osm_barriers.parquet"))
brg = project_geoms(barriers.geometry.values)
areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
ag = shapely.make_valid(project_geoms(areas.geometry.values))
two_rivers = shapely.from_wkt(json.load(open(os.path.join(WORK, "two_rivers.json"))))
shapely.prepare(two_rivers)


def mrr_info(poly):
    c = poly.centroid
    mrr = poly.minimum_rotated_rectangle
    cc = np.asarray(mrr.exterior.coords)
    e1 = cc[1] - cc[0]
    e2 = cc[2] - cc[1]
    l1, l2 = float(np.hypot(*e1)), float(np.hypot(*e2))
    ax = e1 if l1 >= l2 else e2
    ang = float(np.arctan2(ax[1], ax[0]))
    return float(c.x), float(c.y), ang, max(l1, l2), min(l1, l2)


def make_hero_entry(hid, name, lon, lat, x, y, angle, w, d, h, extra=None):
    ty = float(terrain.sample(x, y))
    rec = dict(
        id=hid, name=name,
        lon=round(float(lon), 6), lat=round(float(lat), 6),
        x=round(float(x), 2), z=round(float(-y), 2),
        baseY=round(ty, 2), terrainY=round(ty, 2),
        angle=round(float(angle), 4),
        w=round(float(w), 1), d=round(float(d), 1), h=round(float(h), 1),
    )
    if extra:
        rec.update(extra)
    return rec


out = dict(datum_asl=float(WATER_Y_ASL), waterY=0.0, riverY=0.0)
circles = []
polys = []
osm_ids = []

# ================================================================ 1. Yuzhong / Jiangbeizui / Nanshan Hero Landmarks
# Helper to look up OSM building or use exact verified WGS-84 fallback
HERO_SPECS = [
    # id, display_name, osm_regex, fallback_(lon, lat), fallback_(angle, w, d, h), excl_radius, search_box_xy
    ("jiefangbei", "人民解放纪念碑", r"人民解放纪念碑|抗战胜利纪功碑", (106.573357, 29.560101), (0.0, 20.0, 20.0, 27.5), 26.0, (-80, -80, 80, 80)),
    ("guotai", "重庆国泰艺术中心", r"国泰艺术中心", (106.573486, 29.562870), (0.28, 118.0, 68.0, 38.0), 68.0, (-300, 100, 300, 500)),
    ("wfc", "重庆环球金融中心", r"环球金融中心", (106.574200, 29.561909), (0.26, 56.0, 44.0, 339.0), 54.0, (-200, 50, 300, 350)),
    ("chongqing100", "陆海国际中心", r"^陆海国际中心$", (106.513228, 29.553432), (0.35, 72.0, 56.0, 458.2), 75.0, (-6200, -1100, -5400, -300)),
    ("grand_theatre", "重庆大剧院", r"^重庆大剧院$", (106.577520, 29.572730), (0.58, 210.0, 105.0, 64.0), 118.0, (0, 1000, 900, 1800)),
    ("great_hall", "重庆市人民大礼堂", r"人民大礼堂", (106.550174, 29.564360), (-0.42, 130.0, 100.0, 65.0), 92.0, (-2600, 200, -1900, 750)),
    ("science_museum", "重庆科技馆", r"^重庆科技馆$", (106.574015, 29.573788), (-0.48, 145.0, 88.0, 48.0), 86.0, (-300, 1200, 500, 1900)),
    ("baixiangju", "白象居", r"^白象居$", (106.581418, 29.558533), (-0.44, 115.0, 28.0, 76.0), 64.0, (550, -350, 1050, 50)),
    ("nanshan_pavilion", "南山一棵树观景台", r"一棵树观景台", (106.598864, 29.547947), (-0.75, 44.0, 28.0, 28.0), 42.0, (2100, -1700, 2900, -1000)),
]

for hid, name, pat, (flon, flat), (fang, fw, fd, fh), er, sbox in HERO_SPECS:
    m = b[nm.str.contains(pat, regex=True) & (b["cx"] >= sbox[0]) & (b["cx"] <= sbox[2]) & (b["cy"] >= sbox[1]) & (b["cy"] <= sbox[3])]
    if len(m):
        u = shapely.union_all(m.geometry.values)
        big = max(u.geoms, key=lambda p: p.area) if hasattr(u, "geoms") else u
        x, y, ang, w_, d_ = mrr_info(big)
        lon, lat = to_lonlat(x, y)
        h_ = max(fh, float(m.height.max())) if hid in ("wfc", "chongqing100") else fh
        w_ = max(w_, fw * 0.75)
        d_ = max(d_, fd * 0.75)
        for oid in m["osm_id"].dropna().unique():
            osm_ids.append(str(oid))
    else:
        x, y = to_local(flon, flat)
        lon, lat, ang, w_, d_, h_ = flon, flat, fang, fw, fd, fh
    out[hid] = make_hero_entry(hid, name, lon, lat, x, y, ang, w_, d_, h_)
    circles.append(dict(x=round(float(x), 1), y=round(float(y), 1), r=float(er), name=hid))
    if hid == "great_hall":
        # Exact People's Square stone terrace box from civic.js (160x170m, offset +10m along +Z local, +4m margin)
        cg_, sg_ = np.cos(ang), np.sin(ang)
        gh_poly = []
        for lx, lz in ((-86.0, -80.0), (86.0, -80.0), (86.0, 102.0), (-86.0, 102.0), (-86.0, -80.0)):
            wx = x + cg_ * lx + sg_ * lz
            wz = -y - sg_ * lx + cg_ * lz
            gh_poly.append([round(float(wx), 1), round(float(-wz), 1)])
        polys.append(gh_poly)
    print(f"HERO {hid:<18} x={out[hid]['x']:8.1f} z={out[hid]['z']:8.1f} baseY={out[hid]['baseY']:5.1f} w={w_:.0f} d={d_:.0f} h={h_:.0f}")

# --- Hongyadong (洪崖洞): cliffside 11F diaojiaolou between Jialing Binjiang Rd (north, low) and Cangbai Rd (south, high)
# Exact verified OSM location right west of Qiansimen Bridge south abutment: lon ~106.5736..106.5754, lat ~29.5641..29.5651
hy_lon, hy_lat = 106.57445, 29.56468
hy_x, hy_y = to_local(hy_lon, hy_lat)
# Sample lower Jialing Binjiang frontage (north of center, right beside the river road) and upper Cangbai Rd plaza (south)
hy_ang = 0.24  # riverfront axis tilted ~14 deg N of E along Jialing Binjiang Rd
nx_r, ny_r = -np.sin(hy_ang), np.cos(hy_ang)  # points NNW toward Jialing River
low_samples = [float(terrain.sample(hy_x + nx_r * d_, hy_y + ny_r * d_)) for d_ in (42, 55, 68)]
low_y = min(v for v in low_samples if v > 8.0) if any(v > 8.0 for v in low_samples) else 24.0
high_y = max(float(terrain.sample(hy_x - nx_r * d_, hy_y - ny_r * d_)) for d_ in (45, 65, 85))
high_y = max(high_y, low_y + 52.0)
hy_h = round(max(72.0, high_y - low_y + 10.0), 1)
out["hongyadong"] = make_hero_entry(
    "hongyadong", "洪崖洞民俗风貌区", hy_lon, hy_lat, hy_x, hy_y, hy_ang, 200.0, 72.0, hy_h,
    extra=dict(
        baseY=round(low_y, 2), terrainY=round(low_y, 2),
        lowY=round(low_y, 2), highY=round(high_y, 2), topY=round(low_y + hy_h, 2),
        riverFacing=[round(float(nx_r), 4), round(float(-ny_r), 4)],  # WebGL (x, z) pointing toward Jialing River
    ),
)
# Rectangular exclusion box rotated along Hongyadong cliff footprint
c_, s_ = np.cos(hy_ang), np.sin(hy_ang)
hy_poly = [[round(float(hy_x + u * c_ - v * s_), 1), round(float(hy_y + u * s_ + v * c_), 1)]
           for u, v in ((-112, -46), (112, -46), (112, 46), (-112, 46), (-112, -46))]
polys.append(hy_poly)
print(f"HERO {'hongyadong':<18} x={out['hongyadong']['x']:8.1f} z={out['hongyadong']['z']:8.1f} lowY={low_y:5.1f} highY={high_y:5.1f}")

# --- Raffles City Chongqing (来福士广场 & 朝天门广场)
m_rf = b[nm.str.contains(r"来福士", regex=True)]
if len(m_rf):
    u = shapely.union_all(m_rf.geometry.values)
    big = max(u.geoms, key=lambda p: p.area) if hasattr(u, "geoms") else u
    rx, ry, rang, rw, rd = mrr_info(big)
    rlon, rlat = to_lonlat(rx, ry)
    for oid in m_rf["osm_id"].dropna().unique():
        osm_ids.append(str(oid))
else:
    rlon, rlat = 106.583483, 29.567763
    rx, ry = to_local(rlon, rlat)
    rang, rw, rd = 0.62, 340.0, 195.0
tip_x, tip_y = to_local(106.5856, 29.5702)  # Chaotianmen confluence tip
rf_base = float(terrain.sample(rx, ry))
out["raffles"] = make_hero_entry(
    "raffles", "重庆来福士广场", rlon, rlat, rx, ry, rang, max(rw, 320.0), max(rd, 185.0), 354.5,
    extra=dict(
        tipX=round(float(tip_x), 1), tipZ=round(float(-tip_y), 1),
        bowAngle=round(float(np.arctan2(tip_y - ry, tip_x - rx)), 4),
        podiumH=28.0, crystalY=round(rf_base + 250.0, 1),
    ),
)
circles.append(dict(x=round(float(rx), 1), y=round(float(ry), 1), r=210.0, name="raffles"))
print(f"HERO {'raffles':<18} x={out['raffles']['x']:8.1f} z={out['raffles']['z']:8.1f} baseY={rf_base:5.1f} tip=({tip_x:.0f},{-tip_y:.0f})")

# --- Kuixinglou (魁星楼 — iconic 22F plaza + twin skybridges near Linjiangmen)
kx_lon, kx_lat = 106.57045, 29.56325
kx_x, kx_y = to_local(kx_lon, kx_lat)
kx_low = float(terrain.sample(kx_x, kx_y + 42))
kx_high = float(terrain.sample(kx_x, kx_y - 38))
out["kuixinglou"] = make_hero_entry(
    "kuixinglou", "魁星楼", kx_lon, kx_lat, kx_x, kx_y, 0.15, 95.0, 65.0, 72.0,
    extra=dict(lowY=round(min(kx_low, kx_high), 2), plazaY=round(max(kx_low, kx_high, min(kx_low, kx_high) + 28.0), 2)),
)
circles.append(dict(x=round(float(kx_x), 1), y=round(float(kx_y), 1), r=58.0, name="kuixinglou"))
print(f"HERO {'kuixinglou':<18} x={out['kuixinglou']['x']:8.1f} z={out['kuixinglou']['z']:8.1f} baseY={out['kuixinglou']['baseY']:5.1f}")

# --- Shibati Traditional District (十八梯传统风貌区)
m_sb = areas[areas["name"].fillna("").str.contains(r"十八梯传统风貌区", regex=True)]
if len(m_sb):
    g_sb = ag[m_sb.index[0]]
    sx, sy, sang, sw, sd = mrr_info(g_sb)
    slon, slat = to_lonlat(sx, sy)
else:
    slon, slat = 106.569428, 29.553888
    sx, sy = to_local(slon, slat)
    sang, sw, sd = -1.35, 240.0, 140.0
sb_up = float(terrain.sample(sx, sy + 100))
sb_lo = float(terrain.sample(sx, sy - 100))
out["shibati"] = make_hero_entry(
    "shibati", "十八梯传统风貌区", slon, slat, sx, sy, sang, min(sw, 220.0), min(sd, 130.0), 24.0,
    extra=dict(upperY=round(max(sb_up, sb_lo), 2), lowerY=round(min(sb_up, sb_lo), 2)),
)
circles.append(dict(x=round(float(sx), 1), y=round(float(sy), 1), r=85.0, name="shibati"))
print(f"HERO {'shibati':<18} x={out['shibati']['x']:8.1f} z={out['shibati']['z']:8.1f} upperY={max(sb_up,sb_lo):5.1f} lowerY={min(sb_up,sb_lo):5.1f}")

# ================================================================ 2. Iconic Cross-River Bridges & 8D Overpasses
# Each bridge uses real OSM bridge endpoints + true engineering dimensions & DEM abutment heights!
# (id, name, kind, osm_pat, fallback_p0_ll, fallback_p1_ll, mainSpan, sideSpan, width, deckY, railY, towerH, doubleDeck, suppressHalf)
BRIDGE_SPECS = [
    ("qiansimen", "千厮门嘉陵江大桥", "cable_shuttle_1", r"千厮门大桥|千厮门嘉陵江大桥",
     (106.57642, 29.56538), (106.57318, 29.57262), 312.0, 88.0, 24.0, 56.0, 44.0, 189.0, True, 34.0),
    ("dongshuimen", "东水门长江大桥", "cable_shuttle_2", r"东水门大桥|东水门长江大桥",
     (106.58375, 29.56160), (106.59130, 29.55958), 445.0, 222.5, 24.0, 56.0, 44.0, 172.0, True, 34.0),
    ("chaotianmen", "朝天门长江大桥", "arch_truss_red", r"朝天门大桥|朝天门长江大桥",
     (106.56920, 29.58805), (106.58440, 29.58875), 552.0, 190.0, 36.5, 64.0, 52.0, 142.0, True, 40.0),
    ("caiyuanba", "菜园坝长江大桥", "arch_y_frame", r"菜园坝长江大桥",
     (106.54820, 29.55150), (106.54780, 29.53820), 420.0, 102.0, 30.5, 58.0, 46.0, 114.0, True, 36.0),
    ("shibanpo", "石板坡长江大桥", "box_girder", r"石板坡长江大桥|长江大桥",
     (106.56120, 29.55220), (106.56460, 29.54140), 330.0, 138.0, 34.0, 52.0, 0.0, 0.0, False, 36.0),
    ("jialing", "嘉陵江大桥", "arch_concrete", r"^嘉陵江大桥$",
     (106.53953, 29.56412), (106.53419, 29.56641), 150.0, 110.0, 21.5, 42.0, 0.0, 0.0, False, 26.0),
    ("yuao", "渝澳大桥", "box_girder", r"^渝澳大桥$",
     (106.53878, 29.56219), (106.53381, 29.56464), 160.0, 110.0, 24.0, 44.0, 34.0, 0.0, True, 26.0),
    ("huanghuayuan", "黄花园嘉陵江大桥", "box_girder", r"黄花园大桥|黄花园嘉陵江大桥",
     (106.56245, 29.56590), (106.56360, 29.57505), 250.0, 145.0, 31.0, 50.0, 0.0, 0.0, False, 34.0),
]

bridges = []
bridges_by_id = {}
hero_bridge_zones = []  # For 31_build_ground.py to suppress procedural decks along hero bridges

for bid, bname, bkind, pat, p0_ll, p1_ll, mspan, sspan, bw, deckY, railY, towerH, ddeck, shalf in BRIDGE_SPECS:
    # Try to refine endpoints from OSM road bridge ways crossing the river
    bmask = np.array([bool(re.search(pat, str(n_))) and (t.get("bridge") not in (None, "no")) for n_, t in zip(r_names, rt)])
    bmask &= np.isin(roads.highway.values, ["motorway", "trunk", "primary", "secondary"])
    # Restrict to core area near fallback so we don't pick distant bridges with similar names
    fx0, fy0 = to_local(*p0_ll)
    fx1, fy1 = to_local(*p1_ll)
    fmid = np.array([(fx0 + fx1) / 2, (fy0 + fy1) / 2])
    cand = np.flatnonzero(bmask)
    good = []
    for idx in cand:
        c_ = rg[idx].centroid
        if np.hypot(c_.x - fmid[0], c_.y - fmid[1]) < 900.0 and rg[idx].length > 180.0:
            good.append(idx)
    if good:
        # Collect ALL vertices from bridge segments crossing the river and take the TRUE outermost bank-to-bank span!
        ref_dir = np.array([fx1 - fx0, fy1 - fy0])
        ref_len = max(np.hypot(*ref_dir), 1e-6)
        ref_dir /= ref_len
        ref_nrm = np.array([-ref_dir[1], ref_dir[0]])
        all_pts = []
        for idx in good:
            cc = np.asarray(rg[idx].coords)[:, :2]
            # Keep segments well aligned with the bridge corridor (skip perpendicular ramps)
            d_seg = cc[-1] - cc[0]
            l_seg = np.hypot(*d_seg)
            if l_seg < 40 or abs((d_seg / l_seg) @ ref_dir) < 0.85:
                continue
            # Also require segment close to main centerline
            lat_off = abs(((cc.mean(axis=0) - fmid) @ ref_nrm))
            if lat_off > 60.0:
                continue
            all_pts.append(cc)
        if all_pts:
            pts = np.vstack(all_pts)
            rel = pts - fmid
            s_proj = rel @ ref_dir
            t_proj = rel @ ref_nrm
            s_min, s_max = float(s_proj.min()), float(s_proj.max())
            t_mid = float(np.median(t_proj))
            # Extend each end slightly onto dry riverbank if an OSM bridge way stops right at the waterline
            pa = fmid + ref_dir * s_min + ref_nrm * t_mid
            pb = fmid + ref_dir * s_max + ref_nrm * t_mid
            for _ in range(18):
                if float(terrain.sample(pa[0], pa[1])) < 12.0:
                    pa = pa - ref_dir * 25.0
                else:
                    break
            for _ in range(18):
                if float(terrain.sample(pb[0], pb[1])) < 12.0:
                    pb = pb + ref_dir * 25.0
                else:
                    break
            if np.hypot(*(pb - pa)) > 350.0:
                fx0, fy0 = float(pa[0]), float(pa[1])
                fx1, fy1 = float(pb[0]), float(pb[1])
    else:
        # Ensure fallback endpoints sit solidly on dry banks too
        ref_dir = np.array([fx1 - fx0, fy1 - fy0])
        ref_dir /= max(np.hypot(*ref_dir), 1e-6)
        pa, pb = np.array([fx0, fy0]), np.array([fx1, fy1])
        for _ in range(12):
            if float(terrain.sample(pa[0], pa[1])) < 12.0:
                pa = pa - ref_dir * 25.0
            else:
                break
        for _ in range(12):
            if float(terrain.sample(pb[0], pb[1])) < 12.0:
                pb = pb + ref_dir * 25.0
            else:
                break
        fx0, fy0, fx1, fy1 = float(pa[0]), float(pa[1]), float(pb[0]), float(pb[1])

    # Compute axis, length, water span, and bank terrain heights
    dx, dy = fx1 - fx0, fy1 - fy0
    L = float(np.hypot(dx, dy))
    ux, uy = dx / max(L, 1e-6), dy / max(L, 1e-6)
    cx, cy = (fx0 + fx1) / 2.0, (fy0 + fy1) / 2.0
    line_s = shapely.LineString([(fx0, fy0), (fx1, fy1)])
    w_inter = shapely.intersection(line_s, two_rivers)
    wspan = float(w_inter.length) if not w_inter.is_empty else min(L * 0.72, mspan)
    bank0Y = max(float(terrain.sample(fx0, fy0)), 8.0)
    bank1Y = max(float(terrain.sample(fx1, fy1)), 8.0)
    # Ensure bridge deck clears BOTH river clearance AND bank abutments cleanly!
    eff_deckY = max(deckY, min(bank0Y, bank1Y) + 8.0)
    eff_railY = eff_deckY - 12.0 if ddeck else 0.0
    # Sample 17 centerline stations in WebGL (x, z)
    ts = np.linspace(0.0, 1.0, 17)
    centerline = [[round(float(fx0 + t * dx), 1), round(float(-(fy0 + t * dy)), 1)] for t in ts]

    brec = dict(
        id=bid, name=bname, kind=bkind,
        x=round(cx, 1), z=round(-cy, 1),
        ux=round(ux, 5), uz=round(-uy, 5),
        p0=[round(fx0, 1), round(-fy0, 1)],
        p1=[round(fx1, 1), round(-fy1, 1)],
        centerline=centerline,
        length=round(L, 1),
        waterSpan=round(wspan, 1),
        mainSpan=round(mspan, 1),
        sideSpan=round(sspan, 1),
        width=round(bw, 1),
        deckY=round(eff_deckY, 1),
        railY=round(eff_railY, 1),
        towerH=round(towerH, 1),
        bank0Y=round(bank0Y, 1),
        bank1Y=round(bank1Y, 1),
        waterY=0.0,
        doubleDeck=bool(ddeck),
    )
    bridges.append(brec)
    bridges_by_id[bid] = brec
    # Register corridor for procedural deck suppression (with unit axis ux, uy so perpendicular Binjiang viaducts underneath are NEVER suppressed!)
    hero_bridge_zones.append(dict(id=bid, name=bname, x0=fx0, y0=fy0, x1=fx1, y1=fy1, ux=float(ux), uy=float(uy), half=shalf))
    print(f"BRIDGE {bid:<14} L={L:6.0f}m water={wspan:5.0f}m deckY={eff_deckY:5.1f} banks=({bank0Y:.1f},{bank1Y:.1f}) p0=({fx0:.0f},{-fy0:.0f}) p1=({fx1:.0f},{-fy1:.0f})")

# --- Sujiaba 72m Spiral Overpass (苏家坝立交 — right at south end of Caiyuanba Bridge!)
sj_lon, sj_lat = 106.548095, 29.536331
sj_x, sj_y = to_local(sj_lon, sj_lat)
sj_base = float(terrain.sample(sj_x, sj_y))
sj_low = float(terrain.sample(sj_x, sj_y + 110))  # downhill towards Yangtze
sj_rec = dict(
    id="sujiaba", name="苏家坝立交", kind="spiral_overpass",
    x=round(float(sj_x), 1), z=round(float(-sj_y), 1),
    ux=1.0, uz=0.0,
    p0=[round(float(sj_x), 1), round(float(-(sj_y + 90)), 1)],
    p1=[round(float(sj_x), 1), round(float(-(sj_y - 90)), 1)],
    centerline=[[round(float(sj_x), 1), round(float(-sj_y), 1)]],
    length=380.0, waterSpan=0.0, mainSpan=90.0, sideSpan=45.0, width=14.0,
    deckY=round(sj_low + 72.0, 1), railY=0.0, towerH=72.0,
    bank0Y=round(sj_low, 1), bank1Y=round(sj_base, 1), waterY=0.0, doubleDeck=False,
    radius=56.0, turns=1.35, pierH=72.0, baseY=round(sj_low, 1), topY=round(sj_low + 72.0, 1),
)
bridges.append(sj_rec)
bridges_by_id["sujiaba"] = sj_rec
# Enlarged to r=122m to clear the 115m residential tower at dist=89.7m that Sujiaba's upper ramp collided with in t08!
circles.append(dict(x=round(float(sj_x), 1), y=round(float(sj_y), 1), r=122.0, name="sujiaba"))
hero_bridge_zones.append(dict(id="sujiaba", name="苏家坝立交", kind="circle", x=float(sj_x), y=float(sj_y), r=110.0, x0=sj_x - 95, y0=sj_y, x1=sj_x + 95, y1=sj_y, half=100.0))
print(f"BRIDGE {'sujiaba':<14} x={sj_x:.0f} z={-sj_y:.0f} lowY={sj_low:.1f} topY={sj_low + 72.0:.1f}")

# --- Huangjuewan 5-level Interchange (黄桷湾立交 / 盘龙立交 in Nan'an)
hj_lon, hj_lat = 106.61740, 29.57480
hj_x, hj_y = to_local(hj_lon, hj_lat)
hj_base = float(terrain.sample(hj_x, hj_y))
hj_rec = dict(
    id="huangjuewan", name="黄桷湾立交", kind="multilevel_interchange",
    x=round(float(hj_x), 1), z=round(float(-hj_y), 1),
    ux=1.0, uz=0.0,
    p0=[round(float(hj_x - 220), 1), round(float(-hj_y), 1)],
    p1=[round(float(hj_x + 220), 1), round(float(-hj_y), 1)],
    centerline=[[round(float(hj_x), 1), round(float(-hj_y), 1)]],
    length=440.0, waterSpan=0.0, mainSpan=160.0, sideSpan=80.0, width=16.0,
    deckY=round(hj_base + 37.0, 1), railY=0.0, towerH=37.0,
    bank0Y=round(hj_base, 1), bank1Y=round(hj_base, 1), waterY=0.0, doubleDeck=False,
    baseY=round(hj_base, 1), levels=5,
)
bridges.append(hj_rec)
bridges_by_id["huangjuewan"] = hj_rec
# Exclude procedural buildings, trees & overlapping procedural decks inside Huangjuewan's 5-level interchange footprint!
circles.append(dict(x=round(float(hj_x), 1), y=round(float(hj_y), 1), r=245.0, name="huangjuewan"))
hero_bridge_zones.append(dict(id="huangjuewan", name="黄桷湾立交", kind="circle", x=float(hj_x), y=float(hj_y), r=240.0, x0=hj_x - 230, y0=hj_y, x1=hj_x + 230, y1=hj_y, half=230.0))

# Exact hero-bridge approach & ramp exclusion polygons (aligned with hero-bridges #89, WebGL (x,z) -> pipeline (x,-z)):
def _corr_poly(ax, ay, bx, by, hw):
    g_ = shapely.LineString([(ax, ay), (bx, by)]).buffer(hw, cap_style="flat", quad_segs=4)
    return [[round(float(px), 1), round(float(py), 1)] for px, py in g_.exterior.coords]

# Dongshuimen Yuzhong head (t12: clears the 2 colliding 4F towers at WebGL (826, -220))
polys.append(_corr_poly(780.0, 234.0, 855.0, 210.0, 22.0))
# Caiyuanba North descending approach ramp (t09: clears tree & ramp corridor)
polys.append(_corr_poly(-2457.0, -940.0, -2463.0, -1100.0, 22.0))
# Shibanpo North cliff-connection viaduct (#87 #18: ramps cleanly into Yuzhong cliffside)
polys.append(_corr_poly(-1218.0, -728.0, -1170.0, -895.0, 24.0))
# Sujiaba ESE entry ramp (-2335, 2655) & NNW exit ramp (-2551, 2548) (aligned with hero-bridges #92!)
polys.append(_corr_poly(float(sj_x), float(sj_y), -2335.0, -2655.0, 18.0))
polys.append(_corr_poly(float(sj_x), float(sj_y), -2551.0, -2548.0, 18.0))

out["bridges"] = bridges
out["bridgesById"] = bridges_by_id

# ================================================================ 3. Liziba CRT Station + Line 2 Monorail Spline
lz_lon, lz_lat = 106.53389, 29.55566
lz_x, lz_y = to_local(lz_lon, lz_lat)
vp_lon, vp_lat = 106.53441, 29.556673  # Real OSM tourism=viewpoint 李子坝站观景平台!
vp_x, vp_y = to_local(vp_lon, vp_lat)
lz_base = float(terrain.sample(lz_x, lz_y + 22))  # street side (Jialing Binjiang Rd)
vp_y_elev = float(terrain.sample(vp_x, vp_y))

# Extract real OSM CRT Line 2 monorail track segments within 800m of Liziba!
mono_m = (rails.railway.values == "monorail")
mono_near = []
for idx in np.flatnonzero(mono_m):
    g_ = rlg[idx]
    if g_.distance(shapely.Point(lz_x, lz_y)) < 850.0:
        # Exclude underground Line 3 / tunnels
        t_ = rlt[idx]
        if t_.get("tunnel") in ("yes", "building_passage") and t_.get("name", "").startswith("3"):
            continue
        if "3号线" in (t_.get("name") or ""):
            continue
        mono_near.append(g_)

spline_pts = []
portal_y = max(lz_base + 21.0, vp_y_elev + 24.0)  # 6th-7th floor portal height (~21m above street base!)
lz_ang = 0.84  # ~48 deg NE along Jialing Binjiang Rd (matches OSM W 584178334: (-3862,-540)->(-3784,-446)!)
if mono_near:
    # Build ordered spline through Liziba along Jialing Binjiang Rd
    # Compute local tangent from way closest to Liziba station
    closest = min(mono_near, key=lambda q: q.distance(shapely.Point(lz_x, lz_y)))
    cc = np.asarray(closest.coords)[:, :2]
    if cc[-1, 0] < cc[0, 0]:
        cc = cc[::-1]
    dv = cc[-1] - cc[0]
    if np.hypot(*dv) > 5.0:
        lz_ang = float(np.arctan2(dv[1], dv[0]))

# Generate crisp smooth 1.4 km Line 2 monorail viaduct spline following the riverfront bend straight through Liziba 6-8F portal!
# Follow real OSM Line 2 points around Liziba (from Fotuguan west -> Liziba -> Niujiaotuo east)
# Sample real OSM monorail vertices, sort by arc distance along Jialing riverbank, smooth gently, and lock station point EXACTLY at (lz_x, portal_y, -lz_y)
c_a, s_a = np.cos(lz_ang), np.sin(lz_ang)
# Smooth 1.3 km S-curve hugging the Jialing riverfront slope, strictly straight for +-70m right through the 19-story building portal!
s_vals = np.linspace(-650.0, 650.0, 65)
spline_pts = []
for sv in s_vals:
    # Straight through the building (-90..+90m), then gentle scenic riverfront curve along Jialing Binjiang Rd
    bend = 0.0
    if abs(sv) > 90.0:
        excess = (abs(sv) - 90.0) / 560.0
        bend = (38.0 * excess * excess) * (1.0 if sv > 0 else -0.65)
    px = lz_x + sv * c_a - bend * s_a
    py = lz_y + sv * s_a + bend * c_a
    # Viaduct deck height: level through station (-120..+120m at portal_y), then smoothly clears terrain by >=11m
    ty = float(terrain.sample(px, py))
    if abs(sv) <= 120.0:
        wy = portal_y
    else:
        t_bl = min(1.0, (abs(sv) - 120.0) / 250.0)
        target = max(ty + 12.0, portal_y - 4.0 * t_bl)
        wy = portal_y * (1.0 - t_bl) + target * t_bl
    spline_pts.append([round(float(px), 2), round(float(wy), 2), round(float(-py), 2)])

out["liziba"] = dict(
    id="liziba", name="李子坝轻轨穿楼",
    lon=round(lz_lon, 6), lat=round(lz_lat, 6),
    x=round(float(lz_x), 2), z=round(float(-lz_y), 2),
    baseY=round(lz_base, 2), terrainY=round(lz_base, 2),
    portalY=round(portal_y, 2), topY=round(lz_base + 62.0, 2),
    angle=round(lz_ang, 4), w=64.0, d=24.0, h=62.0,
    viewpoint=dict(x=round(float(vp_x), 2), z=round(float(-vp_y), 2), y=round(vp_y_elev, 2)),
    spline=spline_pts,
)
circles.append(dict(x=round(float(lz_x), 1), y=round(float(lz_y), 1), r=52.0, name="liziba"))
print(f"HERO {'liziba':<18} x={lz_x:.1f} z={-lz_y:.1f} baseY={lz_base:.1f} portalY={portal_y:.1f} vp=({vp_x:.1f},{-vp_y:.1f},{vp_y_elev:.1f}) spline={len(spline_pts)}pts")

# ================================================================ 4. Yangtze River Cableway (长江索道)
# Verified exact OSM nodes: North Station (106.579136, 29.560611), South Station (106.589778, 29.555530)
cn_lon, cn_lat = 106.579136, 29.560611
cs_lon, cs_lat = 106.589778, 29.555530
cn_x, cn_y = to_local(cn_lon, cn_lat)
cs_x, cs_y = to_local(cs_lon, cs_lat)
cw_dx, cw_dy = cs_x - cn_x, cs_y - cn_y
cw_span = float(np.hypot(cw_dx, cw_dy))
cw_ang = float(np.arctan2(cw_dy, cw_dx))
cn_base = float(terrain.sample(cn_x, cn_y))
cs_base = float(terrain.sample(cs_x, cs_y))
cn_deck = max(cn_base + 14.0, 72.0)
cs_deck = max(cs_base + 14.0, 56.0)
# Two riverbank steel support towers (one on Yuzhong bank ~24% along span, one on Nan'an bank ~78% along span)
towers = []
for frac, th in ((0.22, 34.0), (0.78, 36.0)):
    tx = cn_x + cw_dx * frac
    ty = cn_y + cw_dy * frac
    tb = max(float(terrain.sample(tx, ty)), 8.0)
    top_y = cn_deck * (1.0 - frac) + cs_deck * frac + 6.0
    towers.append(dict(x=round(float(tx), 1), z=round(float(-ty), 1), baseY=round(tb, 1), topY=round(max(top_y, tb + th), 1)))

out["cableway"] = dict(
    id="cableway", name="长江索道",
    north=dict(name="新华路索道北站", lon=cn_lon, lat=cn_lat, x=round(float(cn_x), 1), z=round(float(-cn_y), 1), baseY=round(cn_base, 1), deckY=round(cn_deck, 1), angle=round(cw_ang, 4)),
    south=dict(name="上新街索道南站", lon=cs_lon, lat=cs_lat, x=round(float(cs_x), 1), z=round(float(-cs_y), 1), baseY=round(cs_base, 1), deckY=round(cs_deck, 1), angle=round(cw_ang + np.pi, 4)),
    span=round(cw_span, 1),
    sag=22.0,
    towers=towers,
)
circles.append(dict(x=round(float(cn_x), 1), y=round(float(cn_y), 1), r=34.0, name="cableway_north"))
circles.append(dict(x=round(float(cs_x), 1), y=round(float(cs_y), 1), r=34.0, name="cableway_south"))
print(f"HERO {'cableway':<18} span={cw_span:.0f}m north=({cn_x:.0f},{-cn_y:.0f},{cn_base:.1f}->{cn_deck:.1f}) south=({cs_x:.0f},{-cs_y:.0f},{cs_base:.1f}->{cs_deck:.1f})")

json.dump(out, open(os.path.join(OUT, "landmarks.json"), "w"), ensure_ascii=False, indent=1)
json.dump(dict(osm_ids=sorted(set(osm_ids)), circles=circles, polygons=polys), open(EXCL, "w"), indent=1)
json.dump(dict(zones=hero_bridge_zones), open(os.path.join(WORK, "hero_bridges.json"), "w"), ensure_ascii=False, indent=1)
print(f"Wrote landmarks.json, {EXCL} ({len(circles)} circles, {len(polys)} polys, {len(osm_ids)} osm_ids), hero_bridges.json ({len(hero_bridge_zones)} zones)")
