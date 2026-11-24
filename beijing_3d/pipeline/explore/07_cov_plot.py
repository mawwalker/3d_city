"""QA: overlay GBA (blue) and 3D-GloBFP-only (red) footprints on satellite imagery for a few windows."""
import sys, os, io, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, geopandas as gpd, shapely, requests
from PIL import Image
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

work, gba_pq, outdir = sys.argv[1:4]
gba = pd.read_parquet(gba_pq)
gg = shapely.from_wkb(gba.wkb.values)
gf = gpd.read_parquet(os.path.join(work, "globfp_bbox.parquet"))
fg = gf.geometry.values
c = shapely.centroid(fg)
tree = shapely.STRtree(gg)
qi, gi = tree.query(shapely.point_on_surface(fg), predicate="within")
cov = np.zeros(len(fg), bool); cov[qi] = True
cx, cy = shapely.get_x(c), shapely.get_y(c)
# density grid of uncovered polygons
H, xe, ye = np.histogram2d(cx[~cov], cy[~cov], bins=[76, 62], range=[[116.02, 116.78], [39.60, 40.22]])
idx = np.dstack(np.unravel_index(np.argsort(-H.ravel())[:6], H.shape))[0]
print("densest uncovered cells:", [(round(xe[i] + .005, 3), round(ye[j] + .005, 3), int(H[i, j])) for i, j in idx])

def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def fetch(lon0, lat0, z=17, r=2):
    x, y = tile_xy(lon0, lat0, z)
    xi, yi = int(x), int(y)
    im = Image.new("RGB", (256 * (2 * r + 1), 256 * (2 * r + 1)))
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            u = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{yi + dy}/{xi + dx}"
            try:
                t = Image.open(io.BytesIO(requests.get(u, timeout=30).content))
                im.paste(t, ((dx + r) * 256, (dy + r) * 256))
            except Exception as e:
                print("tile fail", e)
    return im, (xi - r, yi - r, z)

def to_px(lon, lat, org):
    x0, y0, z = org
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n
    return (x - x0) * 256, (y - y0) * 256

wins = {"hutong": (116.4030, 39.9370), "cbd": (116.4585, 39.9110), "wangjing": (116.48, 39.995), "fengtai": (116.30, 39.83), "tiantongyuan": (116.42, 40.065), "shijingshan": (116.21, 39.905)}
for k, (i, j) in enumerate(idx[:2]):
    wins[f"dense{k}"] = (xe[i] + .005, ye[j] + .005)
for name, (lon0, lat0) in wins.items():
    im, org = fetch(lon0, lat0)
    fig, axs = plt.subplots(1, 2, figsize=(22, 11))
    for ax in axs:
        ax.imshow(im); ax.set_xticks([]); ax.set_yticks([])
    d = 0.006
    m = (gba.xmax.values > lon0 - d) & (gba.xmin.values < lon0 + d) & (gba.ymax.values > lat0 - d) & (gba.ymin.values < lat0 + d)
    for g in gg[m]:
        for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
            xy = np.asarray(p.exterior.coords); px, py = to_px(xy[:, 0], xy[:, 1], org)
            axs[0].plot(px, py, color="#33ccff", lw=0.9)
    m2 = (np.abs(cx - lon0) < d) & (np.abs(cy - lat0) < d)
    for g, cv in zip(fg[m2], cov[m2]):
        for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
            xy = np.asarray(p.exterior.coords); px, py = to_px(xy[:, 0], xy[:, 1], org)
            axs[1].plot(px, py, color=("#33ccff" if cv else "#ff3355"), lw=0.9)
    axs[0].set_title(f"GBA {name} n={m.sum()}"); axs[1].set_title(f"3D-GloBFP v4 {name} n={m2.sum()} (red = not in GBA: {(~cov[m2]).sum()})")
    for ax in axs:
        ax.set_xlim(0, im.size[0]); ax.set_ylim(im.size[1], 0)
    plt.tight_layout(); fig.savefig(os.path.join(outdir, f"cov_{name}.jpg"), dpi=60); plt.close(fig)
    print(name, "ok")
