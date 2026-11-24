"""Shared constants and helpers for the Chongqing 3D data pipeline.

World frame (shared with the web app):
  origin  = Jiefangbei Monument (抗战胜利纪功碑暨人民解放纪念碑, OSM way 589752618),
            106.573357 E, 29.560101 N (true WGS-84, NEVER GCJ-02).
  x       = metres east
  y       = metres north (the web app maps north to -Z, up to +Y)
  datum   = WATER_Y_ASL = 168.0 m (world y = elevation_ASL - 168.0, so Yangtze/Jialing river surface is y = 0.0)
"""
import os
import numpy as np
import shapely
from pyproj import Transformer

PROCS = max(1, min(int(os.environ.get("CQ3D_PROCS", "8")), os.cpu_count() or 4))

# True WGS-84 origin: Jiefangbei Monument (OSM way 589752618)
LON0, LAT0 = 106.573357, 29.560101
WATER_Y_ASL = 168.0
TERRAIN_SCALE = 0.1
TERRAIN_CORE_SCALE = 0.02
TERRAIN_OFFSET = -20.0

PROJ_LOCAL = f"+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
_fwd = Transformer.from_crs("EPSG:4326", PROJ_LOCAL, always_xy=True)
_inv = Transformer.from_crs(PROJ_LOCAL, "EPSG:4326", always_xy=True)

# Model extent in metres (24 km E-W x 22 km N-S):
# West: Shapingba / Ciqikou (-12.6 km), Hualongqiao / Chongqing 100 (-5.8 km), Yangjiaping (-6.1 km)
# East: Nan'an / Nanshan (+1.5..+5 km), Huangjuewan (+4.3 km), Cuntan (+7 km)
# South: Nanping / Banan (-10 km) to North: Jiangbeizui / Guanyinqiao / Chaotianmen Br / CQ North / Zhaomushan (+12 km)
X_MIN, X_MAX = -14000.0, 10000.0
Y_MIN, Y_MAX = -10000.0, 12000.0

# lon/lat bbox used when fetching source data (with margin)
BBOX_LL = (106.40, 29.44, 106.72, 29.70)

# Tile grid (metres). Tile (i, j) covers x in [GRID_X0 + i*TILE, ...), y likewise.
TILE = 1000.0
GRID_X0, GRID_Y0 = X_MIN, Y_MIN
GRID_NX, GRID_NY = int((X_MAX - X_MIN) / TILE), int((Y_MAX - Y_MIN) / TILE)

# Phase 1 Fast Core tile index bounds [i0, j0, i1, j1) -> x in [-6000, +4000], y in [-3000, +4000]
CORE_RANGE = (8, 7, 18, 14)

# Shared Chongqing Building Style IDs (0..19) aligned with site/src/world/styles.js
ST = dict(
    generic=0,
    cbd_supertall=1,
    office_glass=2,
    office_grid=3,
    resi_modern=4,
    resi_old_highrise=5,
    resi_walkup=6,
    bayu_vernacular=7,
    historic_masonry=8,
    commercial_mall=9,
    hotel=10,
    civic=11,
    campus=12,
    industrial=13,
    temple=14,
    bigroof=15,
    canopy=16,
    tank=17,
    parking=18,
    construction=19,
)

# Shared Roof Type IDs (0..10) aligned with site/src/world/styles.js
ROOF = dict(
    flat=0,
    gable=1,
    hip=2,
    pyramid=3,
    xieshan=4,
    mansard=5,
    stepped_crown=6,
    dome=7,
    shed=8,
    round=9,
    sawtooth=10,
)


def to_local(lon, lat):
    x, y = _fwd.transform(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
    return x, y


def to_lonlat(x, y):
    lon, lat = _inv.transform(np.asarray(x, dtype=float), np.asarray(y, dtype=float))
    return lon, lat


def project_geoms(geoms):
    """Project an array of shapely geometries from lon/lat to local metres."""
    def f(c):
        x, y = _fwd.transform(c[:, 0], c[:, 1])
        return np.column_stack([x, y])
    return shapely.transform(geoms, f)


def unproject_geoms(geoms):
    def f(c):
        x, y = _inv.transform(c[:, 0], c[:, 1])
        return np.column_stack([x, y])
    return shapely.transform(geoms, f)


def explode_polys(geoms):
    """Yield (index, Polygon) for Polygon / MultiPolygon arrays."""
    for i, g in enumerate(geoms):
        if g is None or g.is_empty:
            continue
        t = g.geom_type
        if t == "Polygon":
            yield i, g
        elif t in ("MultiPolygon", "GeometryCollection"):
            for p in g.geoms:
                if p.geom_type == "Polygon" and not p.is_empty:
                    yield i, p


class TerrainSampler:
    """Fast bilinear terrain elevation sampler (core 2.5m -> fine 10m -> coarse 100m; world Y in metres, waterY = 0)."""
    def __init__(self, work_dir):
        import json
        meta = json.load(open(os.path.join(work_dir, "terrain_meta.json")))
        core_p = os.path.join(work_dir, "terrain_core.npy")
        if "core" in meta and os.path.exists(core_p):
            self.core = np.load(core_p)
            self.core_m = meta["core"]
        else:
            self.core = None
            self.core_m = None
        self.fine = np.load(os.path.join(work_dir, "terrain_fine.npy"))
        self.fm = meta["fine"]
        self.coarse = np.load(os.path.join(work_dir, "terrain_coarse.npy"))
        self.cm = meta["coarse"]

    def sample(self, x, y):
        """Sample world Y at local (x east, y north). Works for scalars or arrays."""
        scalar = np.ndim(x) == 0 and np.ndim(y) == 0
        xa = np.atleast_1d(np.asarray(x, dtype=np.float64))
        ya = np.atleast_1d(np.asarray(y, dtype=np.float64))
        if self.core is not None:
            out = self._sample_grid(xa, ya, self.core, self.core_m)
            bad = ~np.isfinite(out)
            if bad.any():
                out[bad] = self._sample_grid(xa[bad], ya[bad], self.fine, self.fm)
        else:
            out = self._sample_grid(xa, ya, self.fine, self.fm)
        bad = ~np.isfinite(out)
        if bad.any():
            out[bad] = self._sample_grid(xa[bad], ya[bad], self.coarse, self.cm, clamp=True)
        return float(out[0]) if scalar else out

    @staticmethod
    def _sample_grid(x, y, arr, m, clamp=False):
        fx = (x - m["x0"]) / m["cell"] - 0.5
        fy = (y - m["y0"]) / m["cell"] - 0.5
        ny, nx = arr.shape
        if clamp:
            fx = np.clip(fx, 0.0, nx - 1.0001)
            fy = np.clip(fy, 0.0, ny - 1.0001)
        i = np.floor(fx).astype(np.int64)
        j = np.floor(fy).astype(np.int64)
        ok = (i >= 0) & (j >= 0) & (i < nx - 1) & (j < ny - 1)
        out = np.full(len(x), np.nan, dtype=np.float64)
        if not ok.any():
            return out
        ii = i[ok]; jj = j[ok]
        tx = fx[ok] - ii; ty = fy[ok] - jj
        v00 = arr[jj, ii]; v10 = arr[jj, ii + 1]
        v01 = arr[jj + 1, ii]; v11 = arr[jj + 1, ii + 1]
        out[ok] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
        return out
