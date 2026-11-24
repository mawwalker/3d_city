"""Placement data for the hand-modelled landmarks.

For each landmark we take the real footprint from OSM (centroid, oriented bounding box, outline) so the
procedural hero model lands exactly where the surveyed building is. The matching footprints are then
excluded from the generic building tiles (pipeline/landmark_exclusions.json).

usage: 34_landmarks.py <work_dir> <site_data_dir> <exclusions.json>
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *

WORK, OUT, EXCL = sys.argv[1:4]
osm = gpd.read_parquet(os.path.join(WORK, "osm_buildings.parquet"))
osm["geometry"] = shapely.make_valid(project_geoms(osm.geometry.values))
osm = osm.set_crs(PROJ_LOCAL, allow_override=True)
by_id = osm.set_index("osm_id")
areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
areas["geometry"] = shapely.make_valid(project_geoms(areas.geometry.values))
areas_by_id = areas.set_index("osm_id")

# key -> spec.  ids: OSM footprints that the model replaces.  r: extra clearance radius (m) around the centre.
#               at: (lon, lat) when there is no usable footprint.  keep: do not exclude the footprint (placement only).
LM = {
    # ---- central axis / imperial
    "tiananmen": dict(ids=["r8847697"], name="天安门"),
    "duanmen": dict(ids=["w25097188"], name="端门"),
    "wumen": dict(ids=["w638156366"], name="午门", r=95),
    "taihemen": dict(ids=["w638308745"], name="太和门"),
    "taihedian": dict(ids=["w638449347"], name="太和殿", r=40),
    "zhonghedian": dict(ids=["r8854349"], name="中和殿"),
    "baohedian": dict(ids=["w638473398"], name="保和殿"),
    "qianqingmen": dict(ids=["w638807674"], name="乾清门", keep=True),
    "qianqinggong": dict(ids=["w638981317"], name="乾清宫", keep=True),
    "shenwumen": dict(ids=["w638741722"], name="神武门"),
    "donghuamen": dict(ids=["w40343947"], name="东华门"),
    "xihuamen": dict(ids=["w40343948"], name="西华门"),
    "gugong": dict(area="r9511883", name="故宫", keep=True),
    "wanchunting": dict(ids=["w26390235"], name="万春亭", r=14),
    "guanmiaoting": dict(ids=["w189309372"], name="观妙亭"),
    "zhoushangting": dict(ids=["w189309369"], name="周赏亭"),
    "jifangting": dict(ids=["w189309374"], name="辑芳亭"),
    "fulanting": dict(ids=["w189309373"], name="富览亭"),
    "shouhuangdian": dict(ids=["w26390117"], name="寿皇殿", keep=True),
    "gulou": dict(ids=["w267371087"], name="鼓楼"),
    "zhonglou": dict(ids=["w425993664"], name="钟楼"),
    "zhengyangmen": dict(ids=["w25109960"], name="正阳门"),
    "jianlou": dict(ids=["w439956436"], name="正阳门箭楼"),
    "yongdingmen": dict(ids=["w228041535"], name="永定门"),
    "deshengmen": dict(ids=["w1571880510"], name="德胜门箭楼", r=30),
    "dongnanjiaolou": dict(ids=["w488647832"], name="东南角楼"),
    "monument": dict(ids=["r8847722"], name="人民英雄纪念碑"),
    "mausoleum": dict(ids=["r8848142"], name="毛主席纪念堂"),
    "greathall": dict(ids=["r8848388"], name="人民大会堂", keep=True),
    "museum": dict(ids=["r8607825"], name="中国国家博物馆", keep=True),
    "ncpa": dict(ids=["w4974233"], name="国家大剧院"),
    # ---- altars, pagodas, gardens
    "qiniandian": dict(ids=["w43921139"], name="祈年殿", r=50),
    "huangqiongyu": dict(ids=["w43921121"], name="皇穹宇", r=12),
    "yuanqiu": dict(at=(116.40693, 39.87553), name="圜丘"),
    "baita": dict(ids=["w561193504"], name="北海白塔", r=14),
    "tianningsi": dict(ids=["w532863319"], name="天宁寺塔"),
    "yufengta": dict(ids=["w942237399"], name="玉峰塔", r=10),
    "foxiangge": dict(ids=["w43977851"], name="佛香阁", r=16),
    # ---- modern
    "zun": dict(ids=["w599547918"], name="中国尊"),
    "cctv": dict(ids=["r7820447"], name="中央电视台总部大楼", r=115),
    "guomao3a": dict(ids=["w116944490"], name="国贸三期A"),
    "guomao3b": dict(ids=["w916885302"], name="国贸三期B"),
    "tvtower": dict(ids=["w403383764"], name="中央广播电视塔", r=45),
    "olympictower": dict(ids=["w962658730"], name="奥林匹克塔", r=40),
    "watercube": dict(ids=["w29201257"], name="水立方"),
    "birdsnest": dict(area="w152301551", name="鸟巢", r=175),
    "nationalgym": dict(ids=["w55883993"], name="国家体育馆", keep=True),
    "southstation": dict(ids=["w43045237"], name="北京南站", keep=True),
    "galaxysoho": dict(ids=["r6096147"], name="银河SOHO", keep=True),
}

out = {}
ex_ids, ex_circles = [], []
for key, spec in LM.items():
    geom = None
    if "ids" in spec:
        parts = [by_id.geometry[i] for i in spec["ids"] if i in by_id.index]
        if not parts:
            print("MISSING", key, spec["ids"]); continue
        geom = shapely.union_all(np.asarray([g for gg in parts for g in (list(gg) if hasattr(gg, "__iter__") else [gg])], dtype=object))
    elif "area" in spec:
        if spec["area"] not in areas_by_id.index:
            print("MISSING AREA", key); continue
        g = areas_by_id.geometry[spec["area"]]
        geom = g.iloc[0] if hasattr(g, "iloc") else g
    if geom is not None:
        if geom.geom_type != "Polygon":
            polys = [p for p in getattr(geom, "geoms", [geom]) if p.geom_type == "Polygon"]
            geom = max(polys, key=lambda p: p.area) if key != "cctv" else shapely.union_all(np.asarray(polys, dtype=object)).convex_hull
        mrr = geom.minimum_rotated_rectangle
        c = np.asarray(mrr.exterior.coords)[:4]
        e1, e2 = c[1] - c[0], c[2] - c[1]
        l1, l2 = np.hypot(*e1), np.hypot(*e2)
        long_e, hl, hw = (e1, l1 / 2, l2 / 2) if l1 >= l2 else (e2, l2 / 2, l1 / 2)
        ang = float(np.degrees(np.arctan2(long_e[1], long_e[0])))
        ang = (ang + 90) % 180 - 90            # keep the long axis within +-90 deg of east
        cen = mrr.centroid
        ring = np.asarray(shapely.simplify(geom, 0.6).exterior.coords)[:-1]
        rec = dict(name=spec["name"], x=round(cen.x, 2), y=round(cen.y, 2), angle=round(ang, 2), hl=round(float(hl), 2), hw=round(float(hw), 2),
                   area=round(geom.area, 1), ring=[[round(float(px), 2), round(float(py), 2)] for px, py in ring])
        h = by_id["height"].get(spec.get("ids", [None])[0]) if "ids" in spec else None
        if isinstance(h, str):
            try: rec["height"] = float(h.split()[0])
            except Exception: pass
    else:
        x, y = to_local(*spec["at"])
        rec = dict(name=spec["name"], x=round(float(x), 2), y=round(float(y), 2), angle=0.0, hl=0, hw=0)
    lon, lat = to_lonlat(rec["x"], rec["y"])
    rec["lon"], rec["lat"] = round(float(lon), 6), round(float(lat), 6)
    out[key] = rec
    if not spec.get("keep"):
        ex_ids += spec.get("ids", [])
        if spec.get("r"):
            ex_circles.append(dict(lon=rec["lon"], lat=rec["lat"], r=spec["r"], key=key))
    print(f"{key:<16} {spec['name']:<12} x={rec['x']:>9.1f} y={rec['y']:>9.1f} angle={rec['angle']:>6.1f} L={2 * rec['hl']:>6.1f} W={2 * rec['hw']:>6.1f} h={rec.get('height', '-')}")

# footprints that are not buildings at all: the three-tier terrace under the great halls (part of the hand-made model),
# an underground station box on the central axis, and a remote-sensing false positive on the square south of Yongdingmen
ex_ids += ["r8854307", "r8854308", "r8854309", "w638449448", "w175226706"]
for x, y, r, key in ((170.0, -4105.0, 20, "yongdingmen-square"),):
    lon, lat = to_lonlat(x, y)
    ex_circles.append(dict(lon=round(float(lon), 6), lat=round(float(lat), 6), r=r, key=key))
json.dump(out, open(os.path.join(OUT, "landmarks.json"), "w"), ensure_ascii=False, separators=(",", ":"))
json.dump(dict(osm_ids=sorted(set(ex_ids)), circles=ex_circles), open(EXCL, "w"), ensure_ascii=False, indent=1)
print("landmarks", len(out), "excluded ids", len(set(ex_ids)), "circles", len(ex_circles))
