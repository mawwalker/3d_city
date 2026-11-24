"""Procedural foliage cards for Chongqing: one atlas of leaf clusters (RGBA, straight alpha), 4 x 2 cells @ 512 px.

Cells:
  0 ficus_virens (黄葛树 - spreading glossy deep-green oval leaves)
  1 camphor (香樟 - elliptic, glossy subtropical)
  2 ginkgo (银杏 - golden/green fan leaves)
  3 metasequoia (水杉 - feathery sprays)
  4 willow (垂柳 - hanging riverside strands)
  5 magnolia (广玉兰 - large glossy obovate)
  6 osmanthus (桂花 / subtropical shrubs - dense small leaves)
  7 cypress / pine (柏树 / 马尾松 - Nanshan mountain needle tufts)
usage: 51_foliage.py <site_assets_dir>
"""
import sys, os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, "..", "..", "data", "debug"), exist_ok=True)
S = 512
SS = 2


def leaf_poly(kind, L, W):
    pts = []
    if kind == "elliptic":
        for i in range(25):
            t = i / 24
            x = t * L
            w = W * 0.5 * math.sin(math.pi * t ** 0.75) * (1 - 0.25 * t)
            pts.append((x, w))
        pts += [(x, -w) for x, w in reversed(pts)]
    elif kind == "ficus":
        # Huangge / Ficus virens: broad ovate-elliptic with drip tip
        for i in range(29):
            t = i / 28
            x = t * L
            w = W * 0.52 * math.sin(math.pi * t ** 0.72) * (1 - 0.18 * t)
            if t > 0.85:
                w *= (1.0 - (t - 0.85) / 0.15) * 0.6
            pts.append((x, w))
        pts += [(x, -w) for x, w in reversed(pts)]
    elif kind == "lanceolate":
        for i in range(17):
            t = i / 16
            pts.append((t * L, W * 0.5 * math.sin(math.pi * t) ** 0.8))
        pts += [(x, -w) for x, w in reversed(pts)]
    elif kind == "obovate":
        for i in range(25):
            t = i / 24
            pts.append((t * L, W * 0.5 * math.sin(math.pi * t ** 1.5) ** 0.7))
        pts += [(x, -w) for x, w in reversed(pts)]
    elif kind == "fan":
        n = 30
        for i in range(n + 1):
            a = -0.95 + 1.9 * i / n
            r = L * (1.0 - 0.10 * abs(math.sin(a * 6))) * (1 - 0.12 * math.exp(-(a / 0.12) ** 2))
            pts.append((r * math.cos(a), r * math.sin(a)))
        pts.append((0, 0))
    return pts


def draw_leaf(d, cx, cy, ang, pts, col, vein):
    ca, sa = math.cos(ang), math.sin(ang)
    q = [(cx + (x * ca - y * sa) * SS, cy + (x * sa + y * ca) * SS) for x, y in pts]
    d.polygon(q, fill=col)
    half = [(x, y) for x, y in pts if y >= 0]
    if len(half) >= 3:
        L0 = max(x for x, _ in pts)
        hq = [(cx + (x * ca - y * sa) * SS, cy + (x * sa + y * ca) * SS) for x, y in ([(0, 0)] + half + [(L0, 0)])]
        d.polygon(hq, fill=tuple(int(min(255, v * 1.16 + 6)) for v in col[:3]) + (255,))
    if vein:
        L = max(x for x, _ in pts)
        d.line([(cx, cy), (cx + L * ca * SS * 0.92, cy + L * sa * SS * 0.92)], fill=vein, width=max(1, SS))


def shade(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c) + (255,)


def make_card(seed, kind, base, tip_col, L, W, n_twigs, per_twig, twig_col=(66, 50, 36), hang=False, needles=False, spread=1.0, vein=True):
    rnd = random.Random(seed)
    im = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx0, cy0 = S * SS * 0.5, S * SS * (0.10 if hang else 0.5)
    items = []
    for t in range(n_twigs):
        if hang:
            x = S * SS * (0.12 + 0.76 * (t + rnd.random() * 0.6) / n_twigs)
            ang = math.pi / 2 + rnd.uniform(-0.10, 0.10)
            length = S * SS * rnd.uniform(0.55, 0.86)
            sx, sy = x, S * SS * rnd.uniform(0.02, 0.12)
        else:
            ang = rnd.uniform(0, 2 * math.pi)
            length = S * SS * rnd.uniform(0.16, 0.30) * spread
            rr = S * SS * 0.20 * math.sqrt(rnd.random())
            ra = rnd.uniform(0, 2 * math.pi)
            sx, sy = cx0 + math.cos(ra) * rr, cy0 + math.sin(ra) * rr
        depth = rnd.random()
        ex, ey = sx + math.cos(ang) * length, sy + math.sin(ang) * length
        items.append((depth - 0.5, "twig", (sx, sy, ex, ey)))
        for k in range(per_twig):
            f = 0.12 + 0.88 * (k + rnd.random()) / per_twig
            px, py = sx + (ex - sx) * f, sy + (ey - sy) * f
            side = 1 if k % 2 else -1
            if needles:
                la = ang + side * rnd.uniform(0.9, 1.25)
            elif hang:
                la = ang + side * rnd.uniform(0.25, 0.7)
            else:
                la = ang + side * rnd.uniform(0.35, 1.25)
            sc = rnd.uniform(0.7, 1.15) * (1.0 if not needles else (1.0 - 0.5 * f))
            lum = 0.62 + 0.5 * depth + rnd.uniform(-0.08, 0.08)
            mix = rnd.random() ** 2
            col = tuple(base[i] * (1 - mix) + tip_col[i] * mix for i in range(3))
            items.append((depth + rnd.uniform(-0.05, 0.05), "leaf", (px, py, la, sc, shade(col, lum))))
    items.sort(key=lambda it: it[0])
    polys = {}
    for depth, typ, v in items:
        if typ == "twig":
            sx, sy, ex, ey = v
            d.line([(sx, sy), (ex, ey)], fill=shade(twig_col, 0.8 + 0.4 * (depth + 0.5)), width=max(1, int(1.6 * SS)))
        else:
            px, py, la, sc, col = v
            key = round(sc, 1)
            if key not in polys:
                polys[key] = leaf_poly(kind, L * key, W * key)
            vc = shade(col[:3], 0.82) if vein else None
            draw_leaf(d, px, py, la, polys[key], col, vc)
    im = im.resize((S, S), Image.LANCZOS)
    rs = np.random.RandomState(seed)
    mott = np.asarray(Image.fromarray((rs.rand(16, 16) * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)).astype(np.float32) / 255
    arr = np.asarray(im).astype(np.float32)
    arr[:, :, :3] *= (0.82 + 0.34 * mott)[:, :, None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    a = np.asarray(im).astype(np.float32)
    alpha = a[:, :, 3:4] / 255
    rgb = a[:, :, :3] * alpha
    blur_rgb = np.asarray(Image.fromarray(rgb.astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32)
    blur_a = np.asarray(Image.fromarray((alpha[:, :, 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32)[:, :, None] / 255
    fill = np.where(blur_a > 0.01, blur_rgb / np.maximum(blur_a, 0.01), np.array(base, np.float32))
    out = np.where(alpha > 0.02, a[:, :, :3], fill)
    return np.dstack([np.clip(out, 0, 255), a[:, :, 3]]).astype(np.uint8)


cards = [
    make_card(11, "ficus", (46, 86, 38), (112, 146, 54), 64, 34, 20, 9, spread=1.05),      # 0 Ficus virens (黄葛树)
    make_card(12, "elliptic", (48, 84, 40), (96, 126, 52), 56, 24, 22, 10, spread=1.0),   # 1 Camphor (香樟)
    make_card(13, "fan", (138, 152, 50), (206, 184, 54), 36, 36, 20, 11, spread=1.0, vein=False),  # 2 Ginkgo
    make_card(14, "lanceolate", (72, 104, 46), (126, 120, 58), 22, 4.5, 26, 46, needles=True, spread=1.05, vein=False),  # 3 Metasequoia
    make_card(15, "lanceolate", (92, 128, 52), (138, 154, 68), 46, 10, 22, 24, hang=True),  # 4 Willow
    make_card(16, "obovate", (58, 94, 42), (104, 128, 56), 82, 38, 14, 7, spread=0.95),   # 5 Magnolia
    make_card(17, "elliptic", (44, 78, 36), (86, 114, 48), 30, 15, 30, 18, spread=1.0, vein=False),  # 6 Osmanthus / evergreen shrub
    make_card(18, "lanceolate", (48, 82, 58), (82, 112, 80), 20, 3.6, 28, 52, needles=True, spread=1.0, vein=False),  # 7 Nanshan pine/cypress
]
atlas = np.zeros((S * 2, S * 4, 4), np.uint8)
for k, c in enumerate(cards):
    atlas[(k // 4) * S:(k // 4 + 1) * S, (k % 4) * S:(k % 4 + 1) * S] = c
    print(k, "coverage", round(float((c[:, :, 3] > 128).mean()), 3))
Image.fromarray(atlas, "RGBA").save(os.path.join(OUT, "foliage.webp"), quality=92, method=6, exact=True)
Image.fromarray(atlas, "RGBA").save(os.path.join(OUT, "..", "..", "data", "debug", "foliage_preview.png"))
print("foliage.webp", os.path.getsize(os.path.join(OUT, "foliage.webp")) // 1024, "KB")
