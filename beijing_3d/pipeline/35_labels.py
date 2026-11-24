"""Place-name labels (districts, parks, waters, stations) with positions looked up in OSM.

usage: 35_labels.py <work_dir> <site_data_dir>
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *

WORK, OUT = sys.argv[1:3]
areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
pois = gpd.read_parquet(os.path.join(WORK, "osm_pois.parquet"))
for df in (areas, water, pois):
    df["geometry"] = project_geoms(df.geometry.values)

# label -> (kind, rank, [names to try in OSM], optional height above ground for the anchor)
WANT = [
    ("什刹海", "water", 2, ["什刹海", "后海", "前海"]), ("北海", "water", 2, ["北海公园"]), ("中南海", "water", 3, ["中南海", "中海", "南海"]),
    ("昆明湖", "water", 2, ["昆明湖"]), ("玉渊潭", "water", 3, ["玉渊潭公园", "玉渊潭"]), ("龙潭湖", "water", 3, ["龙潭公园", "龙潭湖"]),
    ("景山", "park", 3, ["景山公园"]), ("颐和园", "park", 1, ["颐和园"]), ("圆明园", "park", 2, ["圆明园遗址公园"]), ("天坛", "park", 3, ["天坛公园"]),
    ("地坛", "park", 3, ["地坛公园"]), ("日坛", "park", 3, ["日坛公园"]), ("月坛", "park", 3, ["月坛公园"]), ("朝阳公园", "park", 2, ["朝阳公园"]),
    ("奥林匹克森林公园", "park", 2, ["奥林匹克森林公园"]), ("陶然亭", "park", 3, ["陶然亭公园"]), ("紫竹院", "park", 3, ["紫竹院公园"]),
    ("北京动物园", "park", 3, ["北京动物园"]), ("香山", "hill", 2, ["香山公园"]), ("玉泉山", "hill", 3, ["玉泉山"]), ("八大处", "hill", 3, ["八大处公园"]),
    ("清华大学", "campus", 3, ["清华大学"]), ("北京大学", "campus", 3, ["北京大学"]),
    ("天安门广场", "square", 2, ["天安门广场"]), ("北京站", "station", 3, ["北京站"]), ("北京西站", "station", 3, ["北京西站"]), ("北京南站", "station", 2, ["北京南站"]),
    ("北京朝阳站", "station", 3, ["北京朝阳站"]), ("丰台站", "station", 3, ["丰台站"]), ("首都机场", "station", 2, ["北京首都国际机场", "首都国际机场", "首都机场"]),
    ("王府井", "district", 2, ["王府井"]), ("西单", "district", 3, ["西单"]), ("三里屯", "district", 2, ["三里屯"]), ("中关村", "district", 2, ["中关村"]),
    ("望京", "district", 2, ["望京"]), ("金融街", "district", 2, ["金融街"]), ("国贸", "district", 2, ["国贸", "建外"]), ("南锣鼓巷", "district", 3, ["南锣鼓巷"]),
    ("前门大街", "district", 3, ["前门大街", "前门"]), ("五道口", "district", 3, ["五道口"]), ("亚运村", "district", 3, ["亚运村"]), ("亦庄", "district", 3, ["亦庄"]),
    ("丽泽商务区", "district", 3, ["丽泽", "丽泽商务区"]), ("798艺术区", "district", 3, ["798艺术区", "798"]), ("首钢园", "district", 3, ["首钢园", "首钢"]),
]
# positions we know well enough when OSM has no named feature (true WGS-84)
FALLBACK = {"国贸": (116.4575, 39.9085), "中关村": (116.3105, 39.9835), "望京": (116.4745, 39.9960), "五道口": (116.3320, 39.9925), "金融街": (116.3555, 39.9155),
            "西单": (116.3685, 39.9095), "王府井": (116.4044, 39.9145), "三里屯": (116.4490, 39.9335), "亚运村": (116.4010, 39.9890), "亦庄": (116.4990, 39.7950),
            "丽泽商务区": (116.3180, 39.8640), "798艺术区": (116.4890, 39.9830), "首钢园": (116.1530, 39.9090), "南锣鼓巷": (116.3970, 39.9370), "前门大街": (116.3916, 39.8940)}
# OSM "place" nodes for these are railway / metro stations some way off the district itself: use the hand-checked position
PREFER_FALLBACK = {"望京", "王府井", "亦庄"}
out = []
for label, kind, rank, names in WANT:
    pos = None
    if label in PREFER_FALLBACK:
        x, y = to_local(*FALLBACK[label]); pos = (float(x), float(y), "fallback (preferred)")
    for nm in ([] if pos else names):
        src = water if kind == "water" else areas
        m = src[src["name"] == nm]
        if len(m) == 0 and kind == "water":
            m = areas[areas["name"] == nm]
        if len(m):
            g = m.geometry.values[np.argmax(shapely.area(m.geometry.values))]
            p = g.representative_point() if kind != "water" else shapely.centroid(g)
            if kind == "water" and not g.contains(p):
                p = g.representative_point()
            pos = (p.x, p.y, "area:" + nm)
            break
        m = pois[(pois["name"] == nm)]
        if len(m):
            p = m.geometry.values[0]
            pos = (p.x, p.y, "poi:" + nm)
            break
    if pos is None and label in FALLBACK:
        x, y = to_local(*FALLBACK[label]); pos = (float(x), float(y), "fallback")
    if pos is None:
        print("MISSING", label); continue
    out.append(dict(name=label, kind=kind, rank=rank, x=round(float(pos[0]), 1), y=round(float(pos[1]), 1)))
    print(f"{label:<10} {kind:<9} rank {rank}  x={pos[0]:>9.0f} y={pos[1]:>9.0f}  {pos[2]}")
json.dump(out, open(os.path.join(OUT, "labels.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "labels")
