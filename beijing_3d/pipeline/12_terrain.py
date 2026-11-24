"""Terrain: turn the Copernicus GLO-30 DSM into a clean 'hills above the plain' height field.

Beijing's plain is treated as y = 0. We subtract a fitted plain trend, remove the bumps the DSM
picks up from buildings / tree canopy, and keep only real relief (Western Hills, Jundu range,
Jingshan, Longevity Hill, Yuquan Hill ...).

Outputs (work dir):
  terrain_fine.npy    float32 [ny, nx], 40 m cells over the building grid (+ margin)
  terrain_coarse.npy  float32 [ny, nx], 250 m cells over the wider region
  terrain_meta.json

usage: 12_terrain.py <dem_dir> <work_dir>
"""
import sys, os, glob, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio import features
from affine import Affine
from scipy import ndimage
import geopandas as gpd
import shapely
from common import *

DEM_DIR, WORK = sys.argv[1:3]
T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


srcs = [rasterio.open(p) for p in sorted(glob.glob(os.path.join(DEM_DIR, "*.tif")))]
mosaic, tf = merge(srcs)
dem = mosaic[0].astype(np.float32)
log("mosaic", dem.shape, tf, "range", float(dem.min()), float(dem.max()))


def sample_grid(x0, y0, nx, ny, cell):
    """Bilinear-sample the DEM at the centres of a local-metre grid (row 0 = south)."""
    xs = x0 + (np.arange(nx) + 0.5) * cell
    ys = y0 + (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xs, ys)
    lon, lat = to_lonlat(X.ravel(), Y.ravel())
    col = (lon - tf.c) / tf.a - 0.5
    row = (lat - tf.f) / tf.e - 0.5
    v = ndimage.map_coordinates(dem, [row, col], order=1, mode="nearest")
    return v.reshape(ny, nx)


# ---- grids
FINE = dict(x0=GRID_X0 - 2000.0, y0=GRID_Y0 - 2000.0, cell=40.0)
FINE["nx"] = int((GRID_NX * TILE + 4000) / FINE["cell"]); FINE["ny"] = int((GRID_NY * TILE + 4000) / FINE["cell"])
COARSE = dict(x0=-112000.0, y0=-76000.0, cell=250.0, nx=int(204000 / 250), ny=int(196000 / 250))
fine = sample_grid(**FINE)
coarse = sample_grid(**COARSE)
log("fine", fine.shape, "coarse", coarse.shape)

# ---- plain trend: robust plane through flat low pixels of the coarse grid
cx = COARSE["x0"] + (np.arange(COARSE["nx"]) + 0.5) * COARSE["cell"]
cy = COARSE["y0"] + (np.arange(COARSE["ny"]) + 0.5) * COARSE["cell"]
CXg, CYg = np.meshgrid(cx, cy)
rough = ndimage.generic_filter(coarse, np.std, size=5)
flat = (rough < 2.5) & (coarse < 75) & (coarse > 5)
A = np.column_stack([CXg[flat], CYg[flat], np.ones(flat.sum())])
coef, *_ = np.linalg.lstsq(A, coarse[flat], rcond=None)
for _ in range(3):  # trim outliers
    res = coarse[flat] - A @ coef
    keep = np.abs(res) < 6
    coef, *_ = np.linalg.lstsq(A[keep], coarse[flat][keep], rcond=None)
log("plain trend: dz/dx=%.2f m/km dz/dy=%.2f m/km z0=%.1f m" % (coef[0] * 1000, coef[1] * 1000, coef[2]))


def trend(x0, y0, nx, ny, cell):
    xs = x0 + (np.arange(nx) + 0.5) * cell
    ys = y0 + (np.arange(ny) + 0.5) * cell
    X, Y = np.meshgrid(xs, ys)
    # never let the extrapolated plane dive below 8 m or climb above 70 m (the plain itself stays in that band)
    return np.clip(coef[0] * X + coef[1] * Y + coef[2], 8, 70)


def baseline(z, plane, cell):
    """Ground level to subtract: the fitted plain, allowed to follow gentle alluvial fans (<= 60 m above the plane)
    so that built-up foothill districts stay flat, while real mountains keep (almost) their full height."""
    k = int(3000 / cell) | 1
    zs = ndimage.gaussian_filter(z, 1.0)
    op = ndimage.grey_opening(zs, size=(k, k))
    op = ndimage.gaussian_filter(op, 1000.0 / cell)
    return np.clip(op, plane, plane + 60.0)


pl_f = trend(**{k: FINE[k] for k in ("x0", "y0", "nx", "ny", "cell")})
pl_c = trend(**{k: COARSE[k] for k in ("x0", "y0", "nx", "ny", "cell")})
rel_f = fine - baseline(fine, pl_f, FINE["cell"])
rel_c = coarse - baseline(coarse, pl_c, COARSE["cell"])

# ---- remove what buildings explain (fine grid only; that is where the city is)
b = gpd.read_parquet(os.path.join(WORK, "buildings.parquet"), columns=["geometry", "height"])
order = np.argsort(b.height.values)
tfm = Affine(FINE["cell"], 0, FINE["x0"], 0, FINE["cell"], FINE["y0"])  # row 0 = south (we keep arrays south-up)
bh = features.rasterize(((g, float(h)) for g, h in zip(b.geometry.values[order], b.height.values[order])), out_shape=(FINE["ny"], FINE["nx"]),
                        transform=tfm, fill=0, all_touched=True, dtype="float32")
bh = ndimage.maximum_filter(bh, size=7)          # DSM building blobs smear over neighbouring cells
log("building raster done; covered cells", float((bh > 0).mean()))
corr = np.clip(rel_f - bh, 0, None)
corr = ndimage.median_filter(corr, size=3)

# whitelisted small hills in the old city: trust the DSM inside these parks (pavilions must not cancel the hill)
areas = gpd.read_parquet(os.path.join(WORK, "osm_areas.parquet"))
WL = {"景山公园": 45.7, "北海公园": 32.6}
wl_mask = np.zeros(rel_f.shape, bool)
wl_polys = {}
for nm in WL:
    sub = areas[(areas["name"] == nm) & areas.kind.isin(["leisure=park"])]
    if len(sub):
        poly = project_geoms(sub.geometry.values)[0]
        wl_polys[nm] = poly
        m = features.rasterize([(poly, 1)], out_shape=rel_f.shape, transform=tfm, fill=0, dtype="uint8").astype(bool)
        m &= ndimage.median_filter(np.clip(rel_f, 0, None), size=3) > 9
        lab_w, n_w = ndimage.label(m)
        if n_w:
            sz = ndimage.sum(m, lab_w, index=np.arange(1, n_w + 1))
            m = lab_w == (1 + int(np.argmax(sz)))   # the hill itself, not scattered tree/roof bumps
        wl_mask |= m
        corr[m] = np.maximum(corr[m], rel_f[m])

# tree canopy / low mounds are not terrain: seeds must clear 18 m after correction
seed = (corr > 18) | wl_mask
grow = (corr > 6) | wl_mask
lab, nlab = ndimage.label(grow)
keep_ids = np.unique(lab[seed])
keep_ids = keep_ids[keep_ids > 0]
sizes = ndimage.sum(np.ones_like(lab), lab, index=keep_ids)
wl_ids = np.unique(lab[wl_mask])
keep_ids = keep_ids[(sizes >= 10) | np.isin(keep_ids, wl_ids)]
mask = np.isin(lab, keep_ids)
mask = ndimage.binary_closing(mask, iterations=1) | mask
mask = ndimage.binary_fill_holes(mask)
big = ndimage.sum(mask, ndimage.label(mask)[0], index=ndimage.label(mask)[0]) if False else None
feather = np.clip(ndimage.distance_transform_edt(mask) / 2.5, 0, 1)   # 0..1 over ~100 m
smooth = ndimage.gaussian_filter(np.where(mask, np.clip(rel_f, 0, None), 0), 0.6)
hill_f = np.clip(smooth - 2.0, 0, None) * feather
# rescale whitelisted hills to their surveyed heights
for nm, poly in wl_polys.items():
    m = features.rasterize([(poly, 1)], out_shape=rel_f.shape, transform=tfm, fill=0, dtype="uint8").astype(bool)
    if hill_f[m].max() > 1:
        s_ = WL[nm] / hill_f[m].max()
        hill_f[m] *= s_
        log(f"  whitelist {nm}: scaled x{s_:.2f} -> {hill_f[m].max():.1f} m")
log("fine: kept regions", len(keep_ids), "nonzero frac", float((hill_f > 0).mean()), "max", float(hill_f.max()))
# report isolated regions (possible false positives) inside the 6th ring
lab2, n2 = ndimage.label(hill_f > 0)
objs = ndimage.find_objects(lab2)
rows = []
for i, sl in enumerate(objs):
    cnt = int((lab2[sl] == i + 1).sum())
    if cnt > 40000:
        continue
    jj, ii = ndimage.center_of_mass(lab2 == i + 1) if cnt < 3000 else ((sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2)
    x = FINE["x0"] + ii * FINE["cell"]; y = FINE["y0"] + jj * FINE["cell"]
    lon, lat = to_lonlat(x, y)
    rows.append((cnt, float(hill_f[sl].max()), round(float(lon), 4), round(float(lat), 4), round(x / 1e3, 1), round(y / 1e3, 1)))
rows.sort(key=lambda r: -r[0])
print("  isolated hill regions (cells, max m, lon, lat, x km, y km):")
for r in rows[:40]:
    print("   ", r)

# ---- coarse: mountains. No building data out there, a plain threshold is enough.
corr_c = ndimage.median_filter(np.clip(rel_c, 0, None), size=3)
seed = corr_c > 45
grow = corr_c > 14
lab, nlab = ndimage.label(grow)
keep_ids = np.unique(lab[seed]); keep_ids = keep_ids[keep_ids > 0]
sizes = ndimage.sum(np.ones_like(lab), lab, index=keep_ids)
keep_ids = keep_ids[sizes >= 12]
mask_c = ndimage.binary_fill_holes(np.isin(lab, keep_ids))
feather_c = np.clip(ndimage.distance_transform_edt(mask_c) / 3.0, 0, 1)
hill_c = np.clip(ndimage.gaussian_filter(np.where(mask_c, np.clip(rel_c, 0, None), 0), 0.7) - 6.0, 0, None) * feather_c
# inside the fine window the coarse grid must agree with the fine one (it is replaced there, but keep the seam consistent)
fx0, fy0 = FINE["x0"], FINE["y0"]
fx1, fy1 = fx0 + FINE["nx"] * FINE["cell"], fy0 + FINE["ny"] * FINE["cell"]
k = int(COARSE["cell"] / FINE["cell"] + 0.5)
ds = ndimage.zoom(ndimage.uniform_filter(hill_f, size=k), FINE["cell"] / COARSE["cell"], order=1)
i0 = int(round((fx0 - COARSE["x0"]) / COARSE["cell"])); j0 = int(round((fy0 - COARSE["y0"]) / COARSE["cell"]))
hh, ww = ds.shape
hill_c[j0:j0 + hh, i0:i0 + ww] = ds
log("coarse: nonzero frac", float((hill_c > 0).mean()), "max", float(hill_c.max()))

np.save(os.path.join(WORK, "terrain_fine.npy"), hill_f.astype(np.float32))
np.save(os.path.join(WORK, "terrain_coarse.npy"), hill_c.astype(np.float32))
json.dump({"fine": FINE, "coarse": COARSE, "plane": [float(c) for c in coef]}, open(os.path.join(WORK, "terrain_meta.json"), "w"), indent=1)

# ---- report known hills
KNOWN = {"景山万春亭": (116.39049, 39.92352), "琼华岛白塔": (116.38302, 39.92442), "万寿山佛香阁": (116.26798, 39.99783), "玉泉山": (116.2358, 39.9917), "香山": (116.1718, 39.9877),
         "百望山": (116.2518, 40.0307), "八宝山": (116.2298, 39.9067), "老山": (116.2138, 39.9117), "仰山(奥森)": (116.3848, 40.0257), "CBD中国尊(应为0)": (116.46024, 39.91150),
         "金融街(应为0)": (116.3538, 39.9137), "望京(应为0)": (116.4738, 39.9937), "妙峰山": (116.0240, 40.0590), "八达岭": (116.0040, 40.3590)}
for name, (lon, lat) in KNOWN.items():
    x, y = to_local(lon, lat)
    i = int((x - FINE["x0"]) / FINE["cell"]); j = int((y - FINE["y0"]) / FINE["cell"])
    if 0 <= i < FINE["nx"] and 0 <= j < FINE["ny"]:
        win = hill_f[max(0, j - 6):j + 7, max(0, i - 6):i + 7]
        raw = rel_f[max(0, j - 6):j + 7, max(0, i - 6):i + 7]
        print(f"  {name:<12} fine max={win.max():6.1f}  (raw rel max {raw.max():6.1f})")
    else:
        i = int((x - COARSE["x0"]) / COARSE["cell"]); j = int((y - COARSE["y0"]) / COARSE["cell"])
        win = hill_c[max(0, j - 3):j + 4, max(0, i - 3):i + 4]
        print(f"  {name:<12} coarse max={win.max():6.1f}")

# debug picture
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axs = plt.subplots(1, 2, figsize=(20, 10))
    axs[0].imshow(hill_c, origin="lower", cmap="terrain", vmin=0, vmax=1500, extent=[COARSE["x0"] / 1e3, (COARSE["x0"] + COARSE["nx"] * COARSE["cell"]) / 1e3, COARSE["y0"] / 1e3, (COARSE["y0"] + COARSE["ny"] * COARSE["cell"]) / 1e3])
    axs[0].add_patch(plt.Rectangle((GRID_X0 / 1e3, GRID_Y0 / 1e3), GRID_NX * 2, GRID_NY * 2, fill=False, color="red"))
    axs[0].set_title("coarse terrain (m above plain)")
    axs[1].imshow(hill_f, origin="lower", cmap="terrain", vmin=0, vmax=300, extent=[FINE["x0"] / 1e3, fx1 / 1e3, FINE["y0"] / 1e3, fy1 / 1e3])
    rings = gpd.read_parquet(os.path.join(WORK, "rings.parquet"))
    for geom in rings.geometry:
        xy = np.asarray(geom.exterior.coords) / 1e3
        axs[1].plot(xy[:, 0], xy[:, 1], color="red", lw=0.6)
    axs[1].set_title("fine terrain (m above plain) + ring roads")
    plt.tight_layout(); fig.savefig(os.path.join(WORK, "..", "debug", "terrain.jpg"), dpi=60)
except Exception as e:
    print("plot failed", e)
log("done")
