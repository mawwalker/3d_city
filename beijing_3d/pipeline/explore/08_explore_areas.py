import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely
from common import *
work = sys.argv[1]
ar = gpd.read_parquet(os.path.join(work, "osm_areas.parquet"))
print(len(ar), ar.kind.value_counts().to_dict())
ar["geometry"] = project_geoms(ar.geometry.values); ar = ar.set_crs(PROJ_LOCAL, allow_override=True)
ar["a"] = ar.geometry.area
c = ar.geometry.representative_point(); ar["x"] = c.x; ar["y"] = c.y
pat = "故宫|紫禁|太庙|文化宫|社稷|中山公园|景山|北海|天坛|地坛|日坛|月坛|先农|雍和|孔庙|国子监|帝王庙|颐和园|圆明园|中南海|钟楼|鼓楼|皇史|恭王府|白塔寺|妙应|天宁寺|白云观|法源寺|广济寺|智化寺|东岳庙|大钟寺|五塔寺|万寿寺|香山|碧云寺|卧佛寺|八大处|潭柘|戒台|大觉寺|天安门|人民大会堂|国家博物馆|纪念堂|毛主席|国家大剧院|鸟巢|国家体育场|水立方|游泳中心|奥林匹克|世纪坛|军事博物馆|动物园|玉渊潭|陶然亭|龙潭|朝阳公园|紫竹院|什刹海|后海|前海|西海|玉泉山|万寿山|昆明湖|钓鱼台|大观园|正阳门|前门|德胜门|永定门|东便门|角楼|古观象台|清华|北京大学|北京站|北京西站|北京南站|北京北站|北京朝阳站|丰台站"
m = ar["name"].fillna("").str.contains(pat)
pd.set_option("display.width", 250); pd.set_option("display.max_rows", 400); pd.set_option("display.max_colwidth", 46)
sel = ar[m & (ar.a > 3000)].sort_values("a", ascending=False)
print(sel[["osm_id", "name", "kinds", "a", "x", "y"]].head(170).to_string())
