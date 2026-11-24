"""Urban ring polygons for Chongqing (1 core peninsula/two-rivers, 2 inner urban belt, 3 inner ring expressway).

Used by height/style heuristics, sidewalk clipping, and tree density rules.
usage: 11_rings.py <work_dir>
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geopandas as gpd
import shapely
from common import *

WORK = sys.argv[1]

# Ring 1: Core Chongqing urban heart (Yuzhong, Jiangbeizui, Nanbin/Nanping north, Guanyinqiao, Daping)
r1 = shapely.Point(-1200.0, 200.0).buffer(5200.0, quad_segs=32)
# Ring 2: Main built-up metro core (Shapingba, Jiulongpo/Yangjiaping, Nan'an/Nanshan, Jiangbei, Yubei south)
r2 = shapely.Point(-2000.0, 500.0).buffer(9500.0, quad_segs=32)
# Ring 3: Outer urban extent inside Inner Ring Expressway / suburban edge
r3 = shapely.Point(-2000.0, 1000.0).buffer(14000.0, quad_segs=32)

out = [
    {"ring": 1, "geometry": r1},
    {"ring": 2, "geometry": r2},
    {"ring": 3, "geometry": r3},
]
gpd.GeoDataFrame(out, geometry="geometry", crs=PROJ_LOCAL).to_parquet(os.path.join(WORK, "rings.parquet"))
print("rings.parquet written (3 Chongqing urban zones)")
