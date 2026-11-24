"""Side-by-side plots of OSM / CMAB / GBA building footprints for a few sample windows."""
import sys, os
import numpy as np
import geopandas as gpd
import pandas as pd
import pyogrio
import shapely
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from pyproj import Transformer

work, cmab_shp, gba_pq, outdir = sys.argv[1:5]
SAMPLES = {
    "cbd": (116.4585, 39.9110), "hutong": (116.4030, 39.9370), "wangjing": (116.4800, 39.9950), "gugong": (116.3972, 39.9180),
    "zgc": (116.3150, 39.9830), "fengtai": (116.3000, 39.8300), "tiantan": (116.4100, 39.8830), "yizhuang_edge": (116.5000, 39.8000),
}
half_m = 800.0
tr = Transformer.from_crs(4326, 3857, always_xy=True)

osm = gpd.read_parquet(os.path.join(work, "osm_buildings.parquet"))
gba = pd.read_parquet(gba_pq)


def draw(ax, geoms, heights, lon0, lat0, title):
    k = np.cos(np.radians(lat0))
    polys, cols = [], []
    for g, h in zip(geoms, heights):
        parts = g.geoms if g.geom_type == "MultiPolygon" else [g]
        for p in parts:
            xy = np.asarray(p.exterior.coords)
            x = (xy[:, 0] - lon0) * 111320 * k
            y = (xy[:, 1] - lat0) * 110540
            polys.append(np.c_[x, y])
            cols.append(h)
    cols = np.array(cols, dtype=float)
    pc = PolyCollection(polys, array=np.clip(np.nan_to_num(cols, nan=0), 0, 120), cmap="viridis", edgecolors="k", linewidths=0.2)
    pc.set_clim(0, 120)
    ax.add_collection(pc)
    ax.set_xlim(-half_m, half_m); ax.set_ylim(-half_m, half_m); ax.set_aspect("equal")
    ax.set_title(f"{title}  n={len(polys)}  hmax={np.nanmax(cols) if len(cols) else 0:.0f}", fontsize=9)
    ax.set_xticks([]); ax.set_yticks([])


for name, (lon0, lat0) in SAMPLES.items():
    dlon = half_m / (111320 * np.cos(np.radians(lat0))); dlat = half_m / 110540
    box = (lon0 - dlon, lat0 - dlat, lon0 + dlon, lat0 + dlat)
    fig, axs = plt.subplots(1, 3, figsize=(21, 7.4))
    # OSM
    o = osm.cx[box[0]:box[2], box[1]:box[3]]
    def oh(r):
        try:
            if isinstance(r.get("height"), str): return float(r["height"].replace("m", "").strip())
        except Exception: pass
        try:
            if isinstance(r.get("building:levels"), str): return float(r["building:levels"]) * 3.2
        except Exception: pass
        return np.nan
    draw(axs[0], o.geometry.values, [oh(r) for _, r in o.iterrows()], lon0, lat0, f"OSM {name}")
    # CMAB (3857)
    x0, y0 = tr.transform(box[0], box[1]); x1, y1 = tr.transform(box[2], box[3])
    c = pyogrio.read_dataframe(cmab_shp, bbox=(x0, y0, x1, y1)).to_crs(4326)
    draw(axs[1], c.geometry.values, c["Height"].values, lon0, lat0, f"CMAB {name}")
    # GBA
    m = (gba.xmax >= box[0]) & (gba.xmin <= box[2]) & (gba.ymax >= box[1]) & (gba.ymin <= box[3])
    g = gba[m]
    geoms = shapely.from_wkb(g.wkb.values)
    draw(axs[2], geoms, g.height.values, lon0, lat0, f"GBA {name} src={g.source.value_counts().to_dict()}")
    # overlay OSM outline in red on the other two to check registration
    for ax in axs[1:]:
        k = np.cos(np.radians(lat0))
        for gg in o.geometry.values[:4000]:
            parts = gg.geoms if gg.geom_type == "MultiPolygon" else [gg]
            for p in parts:
                xy = np.asarray(p.exterior.coords)
                ax.plot((xy[:, 0] - lon0) * 111320 * k, (xy[:, 1] - lat0) * 110540, color="red", lw=0.35, alpha=0.8)
    plt.tight_layout()
    fig.savefig(os.path.join(outdir, f"cmp_{name}.png"), dpi=70)
    plt.close(fig)
    print(name, len(o), len(c), len(g))
