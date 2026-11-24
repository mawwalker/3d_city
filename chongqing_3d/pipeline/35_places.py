"""Chongqing teleport places (places.json) & crisp shaded-relief minimap (site/assets/map.jpg + map.json).

usage: 35_places.py <work_dir> <site_dir>
"""
import sys, os, json, struct, gzip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, geopandas as gpd, shapely, cv2
from common import *

WORK, SITE = sys.argv[1:3]
os.makedirs(os.path.join(SITE, "data"), exist_ok=True)
os.makedirs(os.path.join(SITE, "assets"), exist_ok=True)

lm = json.load(open(os.path.join(SITE, "data", "landmarks.json")))
terrain = TerrainSampler(WORK)


def pt_place(pid, name, en, x, z, y=None, kind="hero"):
    yy = float(y) if y is not None else float(terrain.sample(x, -z))
    return dict(id=pid, name=name, en=en, x=round(float(x), 1), z=round(float(z), 1), y=round(yy, 1), kind=kind)


# Curated 1-9 primary teleports + wider Chongqing landmarks & districts!
out = [
    pt_place("hongyadong", "洪崖洞", "Hongyadong", lm["hongyadong"]["x"], lm["hongyadong"]["z"], lm["hongyadong"]["lowY"]),
    pt_place("jiefangbei", "解放碑", "Jiefangbei", lm["jiefangbei"]["x"], lm["jiefangbei"]["z"], lm["jiefangbei"]["baseY"]),
    pt_place("raffles", "来福士·朝天门", "Raffles City / Chaotianmen", lm["raffles"]["x"], lm["raffles"]["z"], lm["raffles"]["baseY"]),
    pt_place("qiansimen", "千厮门大桥", "Qiansimen Bridge", lm["bridgesById"]["qiansimen"]["x"], lm["bridgesById"]["qiansimen"]["z"], lm["bridgesById"]["qiansimen"]["deckY"]),
    pt_place("liziba", "李子坝轻轨穿楼", "Liziba CRT Station", lm["liziba"]["viewpoint"]["x"], lm["liziba"]["viewpoint"]["z"], lm["liziba"]["viewpoint"]["y"]),
    pt_place("cableway", "长江索道", "Yangtze Cableway", lm["cableway"]["north"]["x"], lm["cableway"]["north"]["z"], lm["cableway"]["north"]["baseY"]),
    pt_place("great_hall", "人民大礼堂", "Great Hall of the People", lm["great_hall"]["x"], lm["great_hall"]["z"], lm["great_hall"]["baseY"]),
    pt_place("grand_theatre", "重庆大剧院", "Grand Theatre", lm["grand_theatre"]["x"], lm["grand_theatre"]["z"], lm["grand_theatre"]["baseY"]),
    pt_place("nanshan", "南山一棵树", "Nanshan Viewpoint", lm["nanshan_pavilion"]["x"], lm["nanshan_pavilion"]["z"], lm["nanshan_pavilion"]["baseY"]),
    pt_place("guotai", "国泰艺术中心", "Guotai Arts Center", lm["guotai"]["x"], lm["guotai"]["z"], lm["guotai"]["baseY"]),
    pt_place("dongshuimen", "东水门大桥", "Dongshuimen Bridge", lm["bridgesById"]["dongshuimen"]["x"], lm["bridgesById"]["dongshuimen"]["z"], lm["bridgesById"]["dongshuimen"]["deckY"]),
    pt_place("chaotianmen_br", "朝天门大桥", "Chaotianmen Bridge", lm["bridgesById"]["chaotianmen"]["x"], lm["bridgesById"]["chaotianmen"]["z"], lm["bridgesById"]["chaotianmen"]["deckY"]),
    pt_place("chongqing100", "陆海国际中心", "Chongqing 100", lm["chongqing100"]["x"], lm["chongqing100"]["z"], lm["chongqing100"]["baseY"]),
    pt_place("baixiangju", "白象居", "Baixiangju", lm["baixiangju"]["x"], lm["baixiangju"]["z"], lm["baixiangju"]["baseY"]),
    pt_place("kuixinglou", "魁星楼", "Kuixinglou", lm["kuixinglou"]["x"], lm["kuixinglou"]["z"], lm["kuixinglou"]["plazaY"]),
    pt_place("shibati", "十八梯", "Shibati", lm["shibati"]["x"], lm["shibati"]["z"], lm["shibati"]["upperY"]),
    pt_place("sujiaba", "苏家坝立交", "Sujiaba Overpass", lm["bridgesById"]["sujiaba"]["x"], lm["bridgesById"]["sujiaba"]["z"], lm["bridgesById"]["sujiaba"]["deckY"]),
]

# District teleports from exact WGS-84
for pid, name, en, lon, lat in [
    ("guanyinqiao", "观音桥", "Guanyinqiao", 106.5289, 29.5761),
    ("daping", "大坪", "Daping", 106.5154, 29.5433),
    ("yangjiaping", "杨家坪", "Yangjiaping", 106.5101, 29.5106),
    ("ciqikou", "磁器口古镇", "Ciqikou", 106.4507, 29.5782),
    ("huangjuewan", "黄桷湾立交", "Huangjuewan", 106.6174, 29.5748),
]:
    x_, y_ = to_local(lon, lat)
    out.append(pt_place(pid, name, en, x_, -y_, kind="district"))

json.dump(out, open(os.path.join(SITE, "data", "places.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print("places.json:", len(out), "places")

# ---------------------------------------------------------------- Minimap with subtle DEM mountain shading + two rivers + roads!
raw = gzip.decompress(open(os.path.join(SITE, "data", "far_land.bin"), "rb").read())
w, h, x0, y0, mpp = struct.unpack_from("<IIfff", raw, 0)
land = np.frombuffer(raw, np.uint8, w * h, 20).reshape(h, w)[::-1]  # row 0 = north
cover = land & 15
PAL = {
    0: (224, 222, 218), 1: (184, 210, 166), 2: (146, 186, 136), 3: (166, 200, 152),
    4: (202, 216, 176), 5: (196, 188, 174), 6: (150, 190, 218), 7: (170, 202, 196),
    8: (158, 208, 168), 9: (228, 216, 188),
}
img = np.zeros((h, w, 3), np.uint8)
for k, c in PAL.items():
    img[cover == k] = c[::-1]  # BGR for cv2

MPP = 12.0
W2, H2 = int(round(w * mpp / MPP)), int(round(h * mpp / MPP))
img = cv2.resize(img, (W2, H2), interpolation=cv2.INTER_LINEAR).astype(np.float32)

# Subtle topographic hillshade from DEM so Chongqing's mountain ridges read crisply on the minimap!
xs = x0 + (np.arange(W2) + 0.5) * MPP
ys = y0 + (h * mpp) - (np.arange(H2) + 0.5) * MPP
Xg, Yg = np.meshgrid(xs, ys)
el = terrain.sample(Xg.ravel(), Yg.ravel()).reshape(H2, W2)
gy, gx = np.gradient(el, MPP)
shade = np.clip(0.92 + 0.16 * (-gx * 0.7 - gy * 0.7) / np.sqrt(1.0 + gx * gx + gy * gy), 0.72, 1.08)
img = np.clip(img * shade[:, :, None], 0, 255).astype(np.uint8)

to_px = lambda xy: np.column_stack([(xy[:, 0] - x0) / MPP, H2 - (xy[:, 1] - y0) / MPP]).astype(np.int32)
water = gpd.read_parquet(os.path.join(WORK, "osm_water.parquet"))
for g in shapely.make_valid(project_geoms(water.geometry.values)):
    for p in (g.geoms if hasattr(g, "geoms") else [g]):
        if p.geom_type == "Polygon" and p.area > 1200:
            cv2.fillPoly(img, [to_px(np.asarray(p.exterior.coords))], (216, 186, 146), lineType=cv2.LINE_AA)

roads = gpd.read_parquet(os.path.join(WORK, "osm_roads.parquet"), columns=["geometry", "highway"])
rg = project_geoms(roads.geometry.values)
hw = roads.highway.values
for cls_set, col, th in (
    (("residential", "unclassified", "tertiary"), (252, 252, 252), 1),
    (("secondary", "primary"), (255, 255, 255), 2),
    (("trunk", "motorway"), (145, 198, 250), 2),
):
    for g in rg[np.isin(hw, cls_set)]:
        cv2.polylines(img, [to_px(np.asarray(g.coords))], False, col, th, lineType=cv2.LINE_AA)

cv2.imwrite(os.path.join(SITE, "assets", "map.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 84])
json.dump(dict(w=W2, h=H2, x0=x0, y0=y0, mpp=MPP), open(os.path.join(SITE, "assets", "map.json"), "w"))
print("map.jpg", W2, H2, os.path.getsize(os.path.join(SITE, "assets", "map.jpg")) // 1024, "KB")
