"""Clip the auxiliary building datasets to the working bbox and store them as GeoParquet.

  3D-GloBFP v4 tiles  -> work/globfp_bbox.parquet   (footprints + heights: gap filler and a height signal)
  CMAB Beijing        -> work/cmab_bbox.parquet     (only 'Function' is used later, as a weak prior for building style)

usage: 15_prepare_sources.py <work_dir> <globfp_dir> <cmab_main.shp>
"""
import sys, os, glob
import pandas as pd, geopandas as gpd, pyogrio
from pyproj import Transformer

WORK, GLOBFP_DIR, CMAB_SHP = sys.argv[1:4]
W, S, E, N = 116.02, 39.60, 116.78, 40.22
frames = [pyogrio.read_dataframe(shp, bbox=(W, S, E, N)) for shp in sorted(glob.glob(os.path.join(GLOBFP_DIR, "t*", "*.shp")))]
gf = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs=frames[0].crs)
gf.to_parquet(os.path.join(WORK, "globfp_bbox.parquet"))
print("3D-GloBFP polygons in bbox:", len(gf))
tr = Transformer.from_crs(4326, 3857, always_xy=True)
x0, y0 = tr.transform(W, S); x1, y1 = tr.transform(E, N)
cm = pyogrio.read_dataframe(CMAB_SHP, bbox=(x0, y0, x1, y1), columns=["Height", "Function"]).to_crs(4326)
cm.to_parquet(os.path.join(WORK, "cmab_bbox.parquet"))
print("CMAB polygons in bbox:", len(cm))
