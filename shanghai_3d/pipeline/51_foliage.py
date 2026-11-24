"""Procedural foliage cards: one atlas of leaf clusters (RGBA, straight alpha), one cell per leaf type.

Cells (4 x 2, 512 px each):  0 plane (lobed)  1 camphor (elliptic, glossy)  2 ginkgo (fan)  3 metasequoia (feathery sprays)
                             4 willow (hanging strands)  5 magnolia (large)  6 small-leaved (osmanthus, hedges)  7 cedar (needle tufts)
usage: 51_foliage.py <site_assets_dir>
"""
import sys, os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
S = 512
SS = 2          # supersampling


def leaf_poly(kind, L, W):
    """Leaf outline in local coords: base at (0, 0), tip towards +x. L length, W width."""
    pts = []
    if kind == "elliptic":
        for i in range(25):
            t = i / 24
            x = t * L
            w = W * 0.5 * math.sin(math.pi * t ** 0.75) * (1 - 0.25 * t)
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
    elif kind == "lobed":
        # palmate, five lobes
        n = 60
        for i in range(n + 1):
            a = -math.pi * 0.86 + 2 * math.pi * 0.86 * i / n
            lobe = abs(math.cos(a * 2.5)) ** 0.7
            r = L * (0.38 + 0.62 * lobe) * (0.75 + 0.25 * math.cos(a))
            pts.append((L * 0.35 + r * math.cos(a) * 0.65, r * math.sin(a) * 0.62))
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
    # two-tone blade: the half that catches the light is brighter, which keeps a leaf from reading as a flat cut-out
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


def make_card(seed, kind, base, tip_col, L, W, n_twigs, per_twig, twig_col=(70, 52, 38), hang=False, needles=False, spread=1.0, vein=True):
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
            rr = S * SS * 0.20 * math.sqrt(rnd.random()); ra = rnd.uniform(0, 2 * math.pi)
            sx, sy = cx0 + math.cos(ra) * rr, cy0 + math.sin(ra) * rr
        depth = rnd.random()
        ex, ey = sx + math.cos(ang) * length, sy + math.sin(ang) * length
        items.append((depth - 0.5, "twig", (sx, sy, ex, ey)))
        for k in range(per_twig):
            f = (k + rnd.random()) / per_twig
            f = 0.12 + 0.88 * f
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
    # soft light / shade mottling across the cluster
    rs = np.random.RandomState(seed)
    mott = np.asarray(Image.fromarray((rs.rand(16, 16) * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)).astype(np.float32) / 255
    arr = np.asarray(im).astype(np.float32)
    arr[:, :, :3] *= (0.82 + 0.34 * mott)[:, :, None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    # bleed colour into the transparent surround so mip-maps do not pick up black fringes
    a = np.asarray(im).astype(np.float32)
    alpha = a[:, :, 3:4] / 255
    rgb = a[:, :, :3] * alpha
    blur_rgb = np.asarray(Image.fromarray(rgb.astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32)
    blur_a = np.asarray(Image.fromarray((alpha[:, :, 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32)[:, :, None] / 255
    fill = np.where(blur_a > 0.01, blur_rgb / np.maximum(blur_a, 0.01), np.array(base, np.float32))
    out = np.where(alpha > 0.02, a[:, :, :3], fill)
    return np.dstack([np.clip(out, 0, 255), a[:, :, 3]]).astype(np.uint8)


cards = [
    make_card(1, "lobed", (88, 112, 44), (150, 142, 58), 72, 72, 16, 7, spread=1.0),
    make_card(2, "elliptic", (52, 88, 40), (96, 128, 52), 58, 24, 22, 10, spread=1.0),
    make_card(3, "fan", (132, 150, 52), (196, 180, 58), 36, 36, 20, 11, spread=1.0, vein=False),
    make_card(4, "lanceolate", (74, 106, 46), (128, 120, 60), 22, 4.5, 26, 46, needles=True, spread=1.05, vein=False),
    make_card(5, "lanceolate", (96, 130, 54), (140, 156, 70), 46, 10, 22, 24, hang=True),
    make_card(6, "obovate", (62, 96, 42), (104, 128, 56), 84, 38, 14, 7, spread=0.95),
    make_card(7, "elliptic", (46, 78, 36), (84, 112, 48), 30, 15, 30, 18, spread=1.0, vein=False),
    make_card(8, "lanceolate", (62, 92, 78), (96, 122, 104), 20, 3.6, 28, 52, needles=True, spread=1.0, vein=False),
]
atlas = np.zeros((S * 2, S * 4, 4), np.uint8)
for k, c in enumerate(cards):
    atlas[(k // 4) * S:(k // 4 + 1) * S, (k % 4) * S:(k % 4 + 1) * S] = c
    print(k, "coverage", round(float((c[:, :, 3] > 128).mean()), 3))
Image.fromarray(atlas, "RGBA").save(os.path.join(OUT, "foliage.webp"), quality=92, method=6, exact=True)
Image.fromarray(atlas, "RGBA").save(os.path.join(OUT, "..", "..", "data", "debug", "foliage_preview.png"))
print("foliage.webp", os.path.getsize(os.path.join(OUT, "foliage.webp")) // 1024, "KB")
