"""Assemble the web-ready tile set from the per-tile sections written by the builders.

  site/data/far_<s>.bin      shells of always-loaded data (base buildings + block masses), city centre first
  site/data/tiles/<i>_<j>.bin  everything that streams in near the camera (detail buildings, ground, trees, props ...)
  site/data/city.json        manifest

usage: 39_pack_tiles.py <work_dir> <site_data_dir>
"""
import sys, os, json, gzip, time, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from tilefmt import pack_tile

WORK, OUT = sys.argv[1:3]
T0 = time.time()
os.makedirs(os.path.join(OUT, "tiles"), exist_ok=True)
for f in glob.glob(os.path.join(OUT, "tiles", "*.bin")):
    os.remove(f)
SECT = os.path.join(WORK, "sections")
# section directory name -> (tile section name, far?)
FAR = {"base": "buildings", "mass": "masses"}
NEAR = {"detail": "buildings", "roads": "roads", "ground": "ground", "landcover": "landcover", "trees": "trees", "props": "props", "barriers": "barriers", "signs": "signs", "bridges": "bridges", "traffic": "traffic", "walks": "walks"}


def read(d, name):
    p = os.path.join(SECT, d, name)
    return open(p, "rb").read() if os.path.exists(p) else b""


names = set()
for d in list(FAR) + list(NEAR):
    if os.path.isdir(os.path.join(SECT, d)):
        names |= {f for f in os.listdir(os.path.join(SECT, d)) if f.endswith(".bin")}
bt = json.load(open(os.path.join(WORK, "tiles_buildings.json")))["tiles"]
ci, cj = int((0 - GRID_X0) // TILE), int((0 - GRID_Y0) // TILE)
def pack_one(nm):
    i, j = [int(v) for v in nm[:-4].split("_")]
    info = dict(i=i, j=j, **{k: v for k, v in bt.get(nm[:-4], {}).items() if k in ("nb", "nm", "nd", "hmax")})
    far = pack_tile({sec: read(d, nm) for d, sec in FAR.items()})
    near = pack_tile({sec: read(d, nm) for d, sec in NEAR.items()})
    info["_far"] = far if len(far) > 8 else b""
    if len(near) > 8:
        z = gzip.compress(near, 9)
        open(os.path.join(OUT, "tiles", nm), "wb").write(z)
        info["db"] = len(z)
    return (i, j), info


from multiprocessing import get_context
with get_context("fork").Pool(PROCS) as pool:
    tiles = dict(pool.map(pack_one, sorted(names), chunksize=16))

SHELLS = [3, 6, 10, 16, 99]
files = []
for s, lim in enumerate(SHELLS):
    lo = SHELLS[s - 1] if s else -1
    keys = [k for k in tiles if lo < max(abs(k[0] - ci), abs(k[1] - cj)) <= lim and tiles[k]["_far"]]
    keys.sort(key=lambda k: (max(abs(k[0] - ci), abs(k[1] - cj)), k))
    buf = bytearray()
    for k in keys:
        t = tiles[k]
        t["f"] = s; t["o"] = len(buf); t["l"] = len(t["_far"]); buf += t["_far"]
    z = gzip.compress(bytes(buf), 9)
    name = f"far_{s}.bin"
    open(os.path.join(OUT, name), "wb").write(z)
    files.append(dict(name=name, bytes=len(z), raw=len(buf), tiles=len(keys)))
    print(f"  shell {s} {name}: {len(z) / 1e6:.2f} MB gz ({len(buf) / 1e6:.2f} raw), tiles {len(keys)}")
for t in tiles.values():
    t.pop("_far", None)
manifest = dict(version=1, origin=dict(lon=LON0, lat=LAT0, note="x east, y north, metres; local transverse Mercator centred on the Park Hotel"),
                grid=dict(x0=GRID_X0, y0=GRID_Y0, tile=TILE, nx=GRID_NX, ny=GRID_NY), farFiles=files, tiles=sorted(tiles.values(), key=lambda t: (t.get("f", 9), t.get("o", 0))))
json.dump(manifest, open(os.path.join(OUT, "city.json"), "w"), separators=(",", ":"))
tot = sum(t.get("db", 0) for t in tiles.values())
print(f"manifest: {len(tiles)} tiles; far {sum(f['bytes'] for f in files) / 1e6:.1f} MB, near {tot / 1e6:.1f} MB; {time.time() - T0:.0f}s")
