"""Shared constants and helpers for the Shanghai 3D data pipeline.

World frame (shared with the web app):
  origin  = Park Hotel (国际饭店, the city's official geodetic origin), 121.467172 E, 31.235419 N
            -- true WGS-84 from OSM, NOT the GCJ-02 value that Chinese map sites show (off by ~500 m here)
  x       = metres east
  y       = metres north   (the web app maps north to -Z)
A local transverse-Mercator projection keeps distortion < 1e-4 within ~80 km.
"""
import os
import numpy as np
import shapely
from pyproj import Transformer

# Worker processes for the per-tile steps. Kept modest on purpose: every forked worker ends up with its own copy of much of
# the parent's data, and a run that eats the machine's memory takes the whole desktop down with it (it has happened).
# Set SH3D_PROCS to change it; run the heavy steps through pipeline/capped.sh so that a runaway job is killed on its own.
PROCS = max(1, min(int(os.environ.get("SH3D_PROCS", "8")), os.cpu_count() or 4))

LON0, LAT0 = 121.467172, 31.235419
PROJ_LOCAL = f"+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
_fwd = Transformer.from_crs("EPSG:4326", PROJ_LOCAL, always_xy=True)
_inv = Transformer.from_crs(PROJ_LOCAL, "EPSG:4326", always_xy=True)

# Model extent in metres: Sheshan / Hongqiao in the west to Pudong airport and the sea in the east,
# the Yangtze mouth in the north to Minhang / Fengxian in the south.
X_MIN, X_MAX = -31000.0, 43000.0
Y_MIN, Y_MAX = -27000.0, 25000.0
# lon/lat bbox used when fetching source data (a little larger than the model extent)
BBOX_LL = (121.12, 30.97, 121.94, 31.48)

# Tile grid (metres). Tile (i, j) covers x in [GRID_X0 + i*TILE, ...), y likewise.
TILE = 1000.0
GRID_X0, GRID_Y0 = X_MIN, Y_MIN
GRID_NX, GRID_NY = int((X_MAX - X_MIN) / TILE), int((Y_MAX - Y_MIN) / TILE)


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
