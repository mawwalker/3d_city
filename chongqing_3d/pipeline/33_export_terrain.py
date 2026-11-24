"""Export Chongqing terrain height fields for the web app (row 0 = south, gzipped uint16).

Grids exported into site/data/terrain.json:
  core    2.5 m road-benched urban core (scale=0.02 m -> 2 cm precision, offset=-20.0 m)
  fine    10 m  full-city road-graded DEM (scale=0.1 m, offset=-20.0 m)
  coarse  100 m 64x64 km backdrop mountain range (scale=0.1 m, offset=-20.0 m)

Decode formula in client (terrain.js):
  y_world = u16 * scale + offset    (waterY = 0.0 m, datum_asl = 168.0 m)

usage: 33_export_terrain.py <work_dir> <site_data_dir>
"""
import sys, os, json, gzip
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WATER_Y_ASL, TERRAIN_SCALE, TERRAIN_CORE_SCALE, TERRAIN_OFFSET

WORK, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
meta = json.load(open(os.path.join(WORK, "terrain_meta.json")))
out = dict(datum_asl=float(WATER_Y_ASL), waterY=0.0)

for name, scale in (("core", TERRAIN_CORE_SCALE), ("fine", TERRAIN_SCALE), ("coarse", TERRAIN_SCALE)):
    p = os.path.join(WORK, f"terrain_{name}.npy")
    if name not in meta or not os.path.exists(p):
        continue
    a = np.load(p)
    q = np.clip(np.round((a - TERRAIN_OFFSET) / scale), 0, 65535).astype("<u2")
    z = gzip.compress(q.tobytes(), 9)
    fn = f"terrain_{name}.bin"
    open(os.path.join(OUT, fn), "wb").write(z)
    m = meta[name]
    out[name] = dict(
        file=fn,
        x0=m["x0"],
        y0=m["y0"],
        cell=m["cell"],
        nx=int(a.shape[1]),
        ny=int(a.shape[0]),
        scale=float(scale),
        offset=float(TERRAIN_OFFSET),
        min=round(float(a.min()), 2),
        max=round(float(a.max()), 2),
    )
    print(name, a.shape, f"cell={m['cell']}m scale={scale}m {len(z) / 1e6:.2f} MB gz", f"range [{a.min():.1f}, {a.max():.1f}] m")

json.dump(out, open(os.path.join(OUT, "terrain.json"), "w"), indent=1)
