"""Debug: canopy height for one tile (v1 local files, optional v2 remote) with detected trees. usage: 04_chm.py <i> <j> <out.png> [v2]"""
import sys, os, glob, struct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import numpy as np, rasterio, rasterio.warp, cv2
from rasterio.transform import from_origin
from common import *
i, j, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
ox, oy = GRID_X0 + i * TILE, GRID_Y0 + j * TILE
tr = from_origin(ox, oy + TILE, 1.0, 1.0)
lon0, lat0 = to_lonlat(ox - 40, oy - 40); lon1, lat1 = to_lonlat(ox + TILE + 40, oy + TILE + 40)
xs, ys = rasterio.warp.transform("EPSG:4326", "EPSG:3857", [float(lon0), float(lon1)], [float(lat0), float(lat1)])
def read(files):
    chm = np.zeros((1000, 1000), np.float32)
    for f in files:
        with rasterio.open(f) as ds:
            bb = ds.bounds
            if xs[1] < bb.left or xs[0] > bb.right or ys[1] < bb.bottom or ys[0] > bb.top: continue
            win = rasterio.windows.from_bounds(max(xs[0], bb.left), max(ys[0], bb.bottom), min(xs[1], bb.right), min(ys[1], bb.top), ds.transform).round_offsets().round_lengths()
            src = ds.read(1, window=win).astype(np.float32)
            tmp = np.zeros((1000, 1000), np.float32)
            rasterio.warp.reproject(src, tmp, src_transform=ds.window_transform(win), src_crs=ds.crs, dst_transform=tr, dst_crs=PROJ_LOCAL, resampling=rasterio.warp.Resampling.bilinear)
            chm = np.maximum(chm, tmp)
    return chm
v1 = read(sorted(glob.glob("data/raw/canopy/*.tif")))
print("v1: frac>=3m", round(float((v1 >= 3).mean()), 3), "max", v1.max(), "p95 of canopy", np.percentile(v1[v1 >= 3], 95) if (v1 >= 3).any() else 0)
imgs = [v1]
if len(sys.argv) > 4:
    # v2 zoom-10 quadkey tiles over HTTP
    import math
    def quadkey(lon, lat, z):
        x = int((lon + 180) / 360 * 2 ** z); y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** z)
        q = ""
        for k in range(z, 0, -1):
            d = 0; m = 1 << (k - 1)
            if x & m: d += 1
            if y & m: d += 2
            q += str(d)
        return q
    qks = {quadkey(float(lo), float(la), 10) for lo in (lon0, lon1) for la in (lat0, lat1)}
    v2 = read([f"/vsicurl/https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/{q}.tif" for q in qks])
    print("v2: frac>=3m", round(float((v2 >= 3).mean()), 3), "max", v2.max(), "p95 of canopy", np.percentile(v2[v2 >= 3], 95) if (v2 >= 3).any() else 0, "quadkeys", qks)
    imgs.append(v2)
panel = np.hstack([np.clip(v * 9, 0, 255).astype(np.uint8) for v in imgs])
cv2.imwrite(out, cv2.applyColorMap(panel, cv2.COLORMAP_VIRIDIS))
