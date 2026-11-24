"""Named places for teleporting and labels, located from OSM (true WGS-84), plus the mini-map image.

  site/data/places.json   [{ id, name, en, x, z (world metres, z south), kind }]
  site/assets/map.jpg     north-up map of the whole model (16 m / px) drawn from the far land cover, water and roads

usage: 35_places.py <work_dir> <site_dir>
"""
import sys, os, json, struct, gzip, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely, cv2
from common import *

WORK, SITE = sys.argv[1:3]
pts = gpd.read_parquet(os.path.join(WORK, "osm_points.parquet"))
areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
blds = pd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["name", "cx", "cy", "area", "height"])

# id, display name, English, regex on OSM names, preferred source order
WANT = [
    ("bund", "外滩", "The Bund", r"^陈毅广场$|^外滩$", "pa"),
    ("lujiazui", "陆家嘴", "Lujiazui", r"^陆家嘴$|^陆家嘴中心绿地$", "pa"),
    ("pearl", "东方明珠", "Oriental Pearl", r"^东方明珠", "bpa"),
    ("tower", "上海中心", "Shanghai Tower", r"^上海中心大厦$", "bpa"),
    ("nanjing", "南京路步行街", "Nanjing Road", r"^南京路步行街$|^世纪广场$", "pa"),
    ("renmin", "人民广场", "People's Square", r"^人民广场$", "ap"),
    ("yuyuan", "豫园", "Yu Garden", r"^豫园$|^城隍庙$", "ap"),
    ("jingan", "静安寺", "Jing'an Temple", r"^静安寺$", "abp"),
    ("xintiandi", "新天地", "Xintiandi", r"^新天地$|^上海新天地$", "ap"),
    ("wukang", "武康大楼", "Wukang Mansion", r"^武康大楼$", "bpa"),
    ("xujiahui", "徐家汇", "Xujiahui", r"^徐家汇$|^徐家汇天主堂$|^港汇恒隆广场$", "pab"),
    ("tianzifang", "田子坊", "Tianzifang", r"^田子坊$", "ap"),
    ("expo", "中华艺术宫", "China Art Museum", r"^中华艺术宫$", "abp"),
    ("station", "上海站", "Shanghai Railway Station", r"^上海站$|^上海火车站$", "abp"),
    ("hongqiao", "虹桥枢纽", "Hongqiao Hub", r"^上海虹桥站$|^虹桥火车站$", "abp"),
    ("century", "世纪公园", "Century Park", r"^世纪公园$", "ap"),
    ("wujiaochang", "五角场", "Wujiaochang", r"^五角场$", "pa"),
    ("disney", "迪士尼", "Disneyland", r"^上海迪士尼乐园$|奇幻童话城堡", "abp"),
    ("pvg", "浦东机场", "Pudong Airport", r"^上海浦东国际机场$", "ap"),
    ("longhua", "龙华寺", "Longhua Temple", r"^龙华寺$|^龙华塔$", "abp"),
    ("zhongshan", "中山公园", "Zhongshan Park", r"^中山公园$", "ap"),
    ("qiantan", "前滩", "Qiantan", r"^前滩$|^前滩太古里$|^前灘中心$", "pab"),
]
out = []
for pid, name, en, pat, order in WANT:
    found = None
    for src in order:
        if src == "p":
            m = pts[pts["name"].fillna("").str.contains(pat, regex=True)]
            if len(m):
                g = m.geometry.iloc[0]; x, y = to_local(g.x, g.y); found = (float(x), float(y), "p")
        elif src == "a":
            m = areas[areas["name"].fillna("").str.contains(pat, regex=True)]
            if len(m):
                m = m.assign(a=m.geometry.area).sort_values("a", ascending=False)
                c = m.geometry.iloc[0].representative_point(); x, y = to_local(c.x, c.y); found = (float(x), float(y), "a")
        else:
            m = blds[blds["name"].fillna("").str.contains(pat, regex=True)]
            if len(m):
                r = m.sort_values("area", ascending=False).iloc[0]; found = (float(r.cx), float(r.cy), "b")
        if found:
            break
    if found:
        out.append(dict(id=pid, name=name, en=en, x=round(found[0], 1), z=round(-found[1], 1), kind=found[2]))
        print(f"{name:<8} {found[2]}  x={found[0]:8.0f} z={-found[1]:8.0f}")
    else:
        print("NOT FOUND", name)
os.makedirs(os.path.join(SITE, "data"), exist_ok=True)
json.dump(out, open(os.path.join(SITE, "data", "places.json"), "w"), ensure_ascii=False, separators=(",", ":"))

# ---------------------------------------------------------------- mini-map
raw = gzip.decompress(open(os.path.join(SITE, "data", "far_land.bin"), "rb").read())
w, h, x0, y0, mpp = struct.unpack_from("<IIfff", raw, 0)
land = np.frombuffer(raw, np.uint8, w * h, 20).reshape(h, w)[::-1]          # row 0 = north
cover = land & 15
PAL = {0: (226, 224, 220), 1: (188, 214, 170), 2: (150, 190, 140), 3: (170, 204, 158), 4: (206, 220, 180), 5: (214, 204, 186), 6: (160, 196, 222), 7: (176, 206, 200), 8: (160, 210, 170), 9: (232, 220, 190)}
img = np.zeros((h, w, 3), np.uint8)
for k, c in PAL.items():
    img[cover == k] = c[::-1]
MPP = 16.0
W2, H2 = int(w * mpp / MPP), int(h * mpp / MPP)
img = cv2.resize(img, (W2, H2), interpolation=cv2.INTER_LINEAR)
to_px = lambda xy: np.column_stack([(xy[:, 0] - x0) / MPP, H2 - (xy[:, 1] - y0) / MPP]).astype(np.int32)
water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
for g in shapely.make_valid(project_geoms(water.geometry.values)):
    for p in (g.geoms if hasattr(g, "geoms") else [g]):
        if p.geom_type == "Polygon" and p.area > 800:
            cv2.fillPoly(img, [to_px(np.asarray(p.exterior.coords))], (222, 196, 160), lineType=cv2.LINE_AA)
roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"), columns=["geometry", "highway"])
rg = project_geoms(roads.geometry.values); hw = roads.highway.values
for cls, col, th in ((("residential", "unclassified", "tertiary"), (255, 255, 255), 1), (("secondary", "primary"), (255, 255, 255), 2), (("trunk", "motorway"), (150, 200, 250), 2)):
    for g in rg[np.isin(hw, cls)]:
        cv2.polylines(img, [to_px(np.asarray(g.coords))], False, col, th, lineType=cv2.LINE_AA)
cv2.imwrite(os.path.join(SITE, "assets", "map.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 82])
json.dump(dict(w=W2, h=H2, x0=x0, y0=y0, mpp=MPP), open(os.path.join(SITE, "assets", "map.json"), "w"))
print("map.jpg", W2, H2, os.path.getsize(os.path.join(SITE, "assets", "map.jpg")) // 1024, "KB")
