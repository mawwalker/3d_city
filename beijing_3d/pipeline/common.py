"""Shared constants and helpers for the Beijing 3D data pipeline.

World frame (shared with the web app):
  origin  = Tiananmen gate tower (116.39126 E, 39.90736 N, true WGS-84 from OSM -- NOT the GCJ-02 value 116.3975)
  x       = metres east
  y       = metres north   (the web app maps north to -Z)
A local transverse-Mercator projection keeps distortion < 1e-4 within ~80 km.
"""
import numpy as np
import shapely
from pyproj import Transformer

LON0, LAT0 = 116.39126, 39.90736
PROJ_LOCAL = f"+proj=tmerc +lat_0={LAT0} +lon_0={LON0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
_fwd = Transformer.from_crs("EPSG:4326", PROJ_LOCAL, always_xy=True)
_inv = Transformer.from_crs(PROJ_LOCAL, "EPSG:4326", always_xy=True)

# Data bbox (lon/lat) fetched from the building datasets: roughly 6th-ring Beijing.
BBOX_LL = (116.02, 39.60, 116.78, 40.22)

# Tile grid (metres). Tile (i, j) covers x in [X0 + i*T, X0 + (i+1)*T), y likewise.
TILE = 2000.0
GRID_X0, GRID_Y0 = -32000.0, -34000.0
GRID_NX, GRID_NY = 32, 34  # 64 km x 68 km


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
