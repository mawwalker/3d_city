"""Debug plot of one tile's ground section + land-cover raster.  usage: 03_plot_ground.py <i> <j> <out.png>"""
import sys, os, struct
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import numpy as np, cv2
i, j, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
S = 1.6; PX = int(1000 * S)
buf = open(f"data/work/sections/ground/{i}_{j}.bin", "rb").read()
np_, nr, nv = struct.unpack_from("<III", buf, 0)
o = 12
cls = np.frombuffer(buf, np.uint8, np_, o); nrings = np.frombuffer(buf, np.uint8, np_, o + np_); o += (np_ * 2 + 3) & ~3
ringsize = np.frombuffer(buf, "<u2", nr, o); o += (nr * 2 + 3) & ~3
xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.int64)
lc = open(f"data/work/sections/landcover/{i}_{j}.bin", "rb").read()
w, h = struct.unpack_from("<II", lc, 0)
r = np.frombuffer(lc, np.uint8, w * h, 8).reshape(h, w)[::-1]
cover = r & 15; lu = r >> 4
COV = {0: (150, 150, 150), 1: (120, 200, 120), 2: (60, 140, 60), 3: (90, 170, 110), 4: (120, 200, 200), 5: (130, 160, 190), 6: (220, 170, 110), 7: (200, 190, 120), 8: (90, 200, 160), 9: (150, 210, 230)}
img = np.zeros((h, w, 3), np.uint8)
for k, c in COV.items(): img[cover == k] = c
tint = {1: (0, 20, 0), 2: (10, 0, 10), 3: (0, 0, 25), 4: (25, 10, 0), 5: (20, 20, 0)}
img = cv2.resize(img, (PX, PX), interpolation=cv2.INTER_NEAREST)
COL = {1: (70, 70, 70), 2: (200, 200, 215), 3: (80, 180, 140), 4: (230, 160, 90), 5: (180, 215, 235), 8: (60, 80, 110)}
vi = 0; ri = 0
for p in range(np_):
    rings = []
    prev = np.zeros(2, np.int64)
    for _ in range(nrings[p]):
        n = ringsize[ri]; ri += 1
        pts = np.cumsum(np.vstack([prev, xy[vi:vi + n]]), axis=0)[1:]; vi += n; prev = pts[-1]
        rings.append(np.column_stack([pts[:, 0] * 0.1 * S, PX - pts[:, 1] * 0.1 * S]).astype(np.int32))
    if cls[p] in COL:
        cv2.fillPoly(img, rings, COL[cls[p]], lineType=cv2.LINE_AA)
    else:
        cv2.polylines(img, rings, True, (0, 0, 0), 1, lineType=cv2.LINE_AA)
cv2.imwrite(out, img)
print("polys", np_, "verts", nv, {int(c): int((cls == c).sum()) for c in np.unique(cls)})
