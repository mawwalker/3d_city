"""Export the terrain height fields for the web app (uint16 decimetres, row 0 = south, gzipped)."""
import sys, os, json, gzip
import numpy as np

WORK, OUT = sys.argv[1:3]
meta = json.load(open(os.path.join(WORK, "terrain_meta.json")))
out = {}
for name in ("fine", "coarse"):
    a = np.load(os.path.join(WORK, f"terrain_{name}.npy"))
    q = np.clip(np.round(a * 10), 0, 65535).astype("<u2")
    z = gzip.compress(q.tobytes(), 9)
    fn = f"terrain_{name}.bin"
    open(os.path.join(OUT, fn), "wb").write(z)
    m = meta[name]
    out[name] = dict(file=fn, x0=m["x0"], y0=m["y0"], cell=m["cell"], nx=int(a.shape[1]), ny=int(a.shape[0]), max=float(a.max()))
    print(name, a.shape, f"{len(z) / 1e6:.2f} MB gz", "nonzero", float((a > 0).mean()))
json.dump(out, open(os.path.join(OUT, "terrain.json"), "w"))
