"""Clip auxiliary building datasets to the working bbox and store them as GeoParquet.

  CBMF Shanghai (building main function, Zenodo 18595960)  -> work/cbmf_bbox.parquet  (point on surface + class + height)

usage: 15_prepare_sources.py <work_dir> <cbmf.gdb>
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, pyogrio, shapely
from common import *

WORK, CBMF = sys.argv[1:3]
cm = pyogrio.read_dataframe(CBMF, bbox=BBOX_LL, columns=["Height", "class_pred"])
print("CBMF polygons in bbox:", len(cm))
print(cm.class_pred.value_counts().to_dict())
print("height pct 50/90/99/99.9/max:", np.percentile(cm.Height.values, [50, 90, 99, 99.9, 100]).round(1))
cm.to_parquet(os.path.join(WORK, "cbmf_bbox.parquet"))
