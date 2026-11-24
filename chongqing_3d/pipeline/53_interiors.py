"""Generate a photorealistic 2048x2048 (4x4 grid = 16 rooms @ 512x512) perspective-box interior atlas
for Chongqing 3D interior box-parallax mapping.

Canonical projection (perspective_box_v1):
  Room space: x in [-1, 1], y in [-1, 1] (+y up), z in [0, -1] (window at z=0, back wall at z=-1).
  Projection to cell UV (u in [0,1] left->right, v in [0,1] top->bottom):
    s = 1.0 / (1.0 - z)
    u = 0.5 + 0.5 * x * s
    v = 0.5 - 0.5 * y * s
  Back wall (z=-1) occupies exact [0.25..0.75] x [0.25..0.75].

Outputs:
  site/assets/interiors.webp   2048x2048 sRGB (4x4 grid)
  site/assets/interiors.json   metadata & group indices
  data/debug/interiors_preview.jpg

usage: 53_interiors.py <site_assets_dir>
"""
import sys, os, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, "..", "..", "data", "debug"), exist_ok=True)

CELL = 512
SS = 2
S = CELL * SS

FONTS = [p for p in [
    "/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Bold.otf",
    "/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Heavy.otf",
    "/usr/share/fonts/TTF/IBMPlexSansSC-Bold.ttf",
] if os.path.exists(p)]
FONT_PATH = FONTS[0] if FONTS else None


def proj(x, y, z):
    sc = 1.0 / max(1.0 - z, 0.15)
    u = 0.5 + 0.5 * x * sc
    v = 0.5 - 0.5 * y * sc
    return (u * S, v * S)


def clamp_rgb(c):
    return tuple(int(max(0, min(255, round(v)))) for v in c)


def mul_rgb(c, k):
    return clamp_rgb((c[0] * k, c[1] * k, c[2] * k))


class RoomRenderer:
    def __init__(self, seed, ceiling_c, floor_c, back_c, side_c, light_c=(255, 225, 175), light_strength=1.0, floor_wood=False, floor_tile=False):
        self.rng = np.random.RandomState(seed)
        self.light_c = np.array(light_c, np.float32)
        self.light_strength = light_strength
        yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
        u = (xx + 0.5) / S
        v = (yy + 0.5) / S
        rx = u * 2.0 - 1.0
        ry = 1.0 - v * 2.0
        eps = 1e-6
        tx = np.where(np.abs(rx) > eps, 1.0 / np.maximum(np.abs(rx), eps), 1e6)
        ty = np.where(np.abs(ry) > eps, 1.0 / np.maximum(np.abs(ry), eps), 1e6)
        tz = np.full_like(rx, 2.0)
        t = np.minimum(np.minimum(tx, ty), tz)
        hx = rx * t
        hy = ry * t
        hz = 1.0 - t

        is_back = (tz <= tx) & (tz <= ty)
        is_ceil = ~is_back & (ty <= tx) & (ry > 0)
        is_floor = ~is_back & (ty <= tx) & (ry <= 0)
        is_left = ~is_back & ~is_ceil & ~is_floor & (rx < 0)
        is_right = ~is_back & ~is_ceil & ~is_floor & (rx >= 0)

        col = np.zeros((S, S, 3), np.float32)
        col[is_back] = np.array(back_c, np.float32)
        col[is_left] = np.array(side_c, np.float32) * 0.88
        col[is_right] = np.array(side_c, np.float32) * 0.82
        col[is_ceil] = np.array(ceiling_c, np.float32)
        col[is_floor] = np.array(floor_c, np.float32)

        if floor_wood:
            plank_seam = (np.abs(np.sin(hx * np.pi * 8.0)) < 0.06) | (np.abs(np.sin(hz * np.pi * 3.5 + np.floor(hx * 8.0) * 1.3)) < 0.03)
            plank_var = 0.88 + 0.20 * np.sin(np.floor(hx * 8.0) * 2.7 + 0.5)
            col[is_floor] *= plank_var[is_floor, None] * np.where(plank_seam[is_floor, None], 0.66, 1.0)
        elif floor_tile:
            tile_seam = (np.abs(np.sin(hx * np.pi * 5.0)) < 0.05) | (np.abs(np.sin(hz * np.pi * 5.0)) < 0.05)
            col[is_floor] *= np.where(tile_seam[is_floor, None], 0.72, 1.0)

        # Ceiling/wall baseboard molding in 3D room space!
        baseboard = (is_back | is_left | is_right) & (hy < -0.90)
        crown_m = (is_back | is_left | is_right) & (hy > 0.93)
        col[baseboard] *= 0.68
        col[crown_m] *= 0.92

        dx = hx
        dy = hy - 0.94
        dz = hz + 0.52
        dist2 = dx * dx + dy * dy + dz * dz
        illum = 0.44 + 0.90 * light_strength / (0.42 + dist2 * 1.2)
        illum = np.where(is_floor, illum * 0.78, illum)
        illum = np.where(is_ceil, 0.52 + 0.95 * np.exp(-((hx * hx + (hz + 0.52) ** 2) * 3.4)) * light_strength, illum)

        # Strong realistic 3D crevice/corner AO
        dx_e = 1.0 - np.abs(hx)
        dy_e = 1.0 - np.abs(hy)
        dz_e = np.abs(hz + 1.0)
        d0 = np.minimum(dx_e, dy_e)
        d1 = np.maximum(dx_e, dy_e)
        d_corner = np.minimum(d1, dz_e) + d0
        ao = 0.45 + 0.55 * np.clip(d_corner / 0.36, 0.0, 1.0) ** 0.68
        ao *= 0.80 + 0.20 * np.clip(-hz / 0.18, 0.0, 1.0)

        noise = self.rng.normal(0.0, 3.8, (S // 2, S // 2, 1)).astype(np.float32)
        noise = np.repeat(np.repeat(noise, 2, axis=0), 2, axis=1)
        tint = 0.70 + 0.30 * (self.light_c / 255.0)
        col = col * illum[:, :, None] * ao[:, :, None] * tint[None, None, :] + noise
        self.img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), "RGB")
        self.draw = ImageDraw.Draw(self.img, "RGBA")
        self.glow = Image.new("RGB", (S, S), (0, 0, 0))
        self.gdraw = ImageDraw.Draw(self.glow)

    def quad3(self, pts3, fill, outline=None, width=1):
        pts2 = [proj(*p) for p in pts3]
        self.draw.polygon(pts2, fill=fill)
        if outline is not None:
            self.draw.line(pts2 + [pts2[0]], fill=outline, width=max(1, width * SS))

    def glow_quad3(self, pts3, color):
        pts2 = [proj(*p) for p in pts3]
        self.gdraw.polygon(pts2, fill=color)
        self.draw.polygon(pts2, fill=color)

    def floor_rug(self, x0, z0, x1, z1, col, border_col):
        self.quad3([(x0, -0.996, z0), (x1, -0.996, z0), (x1, -0.996, z1), (x0, -0.996, z1)], border_col)
        m = 0.06
        self.quad3([(x0 + m, -0.995, z0 + m), (x1 - m, -0.995, z0 + m), (x1 - m, -0.995, z1 - m), (x0 + m, -0.995, z1 - m)], col)

    def box3(self, x0, y0, z0, x1, y1, z1, col, front_k=1.0, top_k=1.14, side_k=0.70, bot_k=0.50, outline=None):
        # Soft contact shadow on floor if sitting on y0 == -1.0
        if y0 <= -0.98:
            sh = 0.05
            self.quad3([(x0 - sh, -0.997, z0 - sh), (x1 + sh, -0.997, z0 - sh), (x1 + sh, -0.997, z1 + sh), (x0 - sh, -0.997, z1 + sh)], (18, 14, 12, 95))
        if x0 > 0:
            self.quad3([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], mul_rgb(col, side_k), outline)
        if x1 < 0:
            self.quad3([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], mul_rgb(col, side_k), outline)
        if y1 < 0.05:
            self.quad3([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], mul_rgb(col, top_k), outline)
        if y0 > -0.05:
            self.quad3([(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)], mul_rgb(col, bot_k), outline)
        self.quad3([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mul_rgb(col, front_k), outline)

    def cabinet(self, x0, y0, z0, x1, y1, z1, col, doors=3, handle_col=(188, 184, 174)):
        """Detailed cabinet/console with recessed drawer/door panels & metal handles."""
        self.box3(x0, y0, z0, x1, y1, z1, col, outline=mul_rgb(col, 0.50))
        w = (x1 - x0) / doors
        for d in range(doors):
            dx0 = x0 + d * w + 0.025
            dx1 = x0 + (d + 1) * w - 0.025
            self.quad3([(dx0, y0 + 0.03, z1 + 0.004), (dx1, y0 + 0.03, z1 + 0.004), (dx1, y1 - 0.03, z1 + 0.004), (dx0, y1 - 0.03, z1 + 0.004)],
                       mul_rgb(col, 0.92), outline=mul_rgb(col, 0.55))
            # Metal handle bar
            hx = (dx0 + dx1) * 0.5
            hy = y1 - 0.07
            self.quad3([(hx - 0.03, hy - 0.012, z1 + 0.008), (hx + 0.03, hy - 0.012, z1 + 0.008),
                        (hx + 0.03, hy + 0.012, z1 + 0.008), (hx - 0.03, hy + 0.012, z1 + 0.008)], handle_col)

    def table_legged(self, x0, z0, x1, z1, top_y=-0.52, col=(142, 98, 62), leg_col=None):
        """Realistic legged dining/study/coffee table (NO solid brown block!)."""
        lc = leg_col or mul_rgb(col, 0.68)
        lw = 0.05
        # Floor shadow under table
        self.quad3([(x0 - 0.04, -0.996, z0 - 0.04), (x1 + 0.04, -0.996, z0 - 0.04), (x1 + 0.04, -0.996, z1 + 0.04), (x0 - 0.04, -0.996, z1 + 0.04)], (16, 12, 10, 85))
        # Back legs first, then front legs, then tabletop!
        for lx in (x0 + 0.02, x1 - 0.02 - lw):
            self.box3(lx, -1.0, z0 + 0.02, lx + lw, top_y - 0.04, z0 + 0.02 + lw, lc)
        for lx in (x0 + 0.02, x1 - 0.02 - lw):
            self.box3(lx, -1.0, z1 - 0.02 - lw, lx + lw, top_y - 0.04, z1 - 0.02, lc)
        # Apron & tabletop
        self.box3(x0, top_y - 0.055, z0, x1, top_y, z1, col, outline=mul_rgb(col, 0.52))

    def sofa(self, x0, z0, x1, z1, col=(162, 138, 114), pillow_cols=((196, 104, 78), (222, 206, 178))):
        """Detailed multi-cushion sofa with backrest, armrests, legs & accent throw pillows."""
        # Legs
        for lx in (x0 + 0.04, x1 - 0.09):
            self.box3(lx, -1.0, z1 - 0.08, lx + 0.05, -0.88, z1 - 0.03, (52, 38, 28))
        # Backrest
        self.box3(x0 + 0.06, -0.88, z0, x1 - 0.06, -0.34, z0 + 0.14, mul_rgb(col, 0.90), outline=mul_rgb(col, 0.52))
        # Seat base + 3 separate seat cushions
        self.box3(x0, -0.88, z0 + 0.04, x1, -0.70, z1, mul_rgb(col, 0.80), outline=mul_rgb(col, 0.52))
        cw = (x1 - x0 - 0.20) / 3.0
        for ci in range(3):
            cx0 = x0 + 0.10 + ci * cw + 0.01
            cx1 = x0 + 0.10 + (ci + 1) * cw - 0.01
            self.box3(cx0, -0.70, z0 + 0.10, cx1, -0.56, z1 - 0.01, mul_rgb(col, 1.04), outline=mul_rgb(col, 0.58))
        # Left & right armrests
        self.box3(x0, -0.88, z0 + 0.02, x0 + 0.11, -0.46, z1, mul_rgb(col, 0.94), outline=mul_rgb(col, 0.52))
        self.box3(x1 - 0.11, -0.88, z0 + 0.02, x1, -0.46, z1, mul_rgb(col, 0.94), outline=mul_rgb(col, 0.52))
        # Accent throw pillows
        self.box3(x0 + 0.13, -0.56, z0 + 0.12, x0 + 0.28, -0.38, z0 + 0.22, pillow_cols[0], outline=mul_rgb(pillow_cols[0], 0.55))
        self.box3(x1 - 0.28, -0.56, z0 + 0.12, x1 - 0.13, -0.38, z0 + 0.22, pillow_cols[1], outline=mul_rgb(pillow_cols[1], 0.55))

    def wall_rect_back(self, x0, y0, x1, y1, fill, z=-0.995, outline=None):
        self.quad3([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], fill, outline)

    def wall_rect_left(self, z0, y0, z1, y1, fill, x=-0.995, outline=None):
        self.quad3([(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)], fill, outline)

    def wall_art(self, x0, y0, x1, y1, frame_col=(54, 44, 36), art_col=(72, 108, 122), accent=(214, 152, 78)):
        self.wall_rect_back(x0, y0, x1, y1, frame_col, z=-0.99)
        m = 0.03
        self.wall_rect_back(x0 + m, y0 + m, x1 - m, y1 - m, (236, 230, 218), z=-0.986)
        m2 = 0.06
        self.wall_rect_back(x0 + m2, y0 + m2, x1 - m2, y1 - m2, art_col, z=-0.982)
        # Abstract mountain/horizon painting stroke inside frame
        self.wall_rect_back(x0 + m2, y0 + m2, x1 - m2, y0 + (y1 - y0) * 0.45, accent, z=-0.980)

    def ceiling_light(self, x0, z0, x1, z1, col=(255, 245, 225), frame=(92, 92, 90)):
        self.quad3([(x0 - 0.025, 0.996, z0 - 0.025), (x1 + 0.025, 0.996, z0 - 0.025), (x1 + 0.025, 0.996, z1 + 0.025), (x0 - 0.025, 0.996, z1 + 0.025)], frame)
        self.glow_quad3([(x0, 0.991, z0), (x1, 0.991, z0), (x1, 0.991, z1), (x0, 0.991, z1)], col)

    def pendant_lamp(self, x, z, y_drop=0.52, rad=0.13, shade_col=(210, 155, 85), glow_col=(255, 220, 140), cord=True):
        if cord:
            p0 = proj(x, 1.0, z)
            p1 = proj(x, y_drop + 0.06, z)
            self.draw.line([p0, p1], fill=(45, 40, 36), width=2 * SS)
        cx, cy = proj(x, y_drop, z)
        px_r = abs(proj(x + rad, y_drop, z)[0] - cx)
        py_r = max(px_r * 0.68, 6)
        self.draw.ellipse([cx - px_r, cy - py_r, cx + px_r, cy + py_r], fill=shade_col, outline=mul_rgb(shade_col, 0.55), width=SS)
        self.gdraw.ellipse([cx - px_r * 0.80, cy - py_r * 0.55, cx + px_r * 0.80, cy + py_r * 0.80], fill=glow_col)
        self.draw.ellipse([cx - px_r * 0.50, cy - py_r * 0.30, cx + px_r * 0.50, cy + py_r * 0.50], fill=glow_col)

    def table_lamp(self, x, base_y, z, h=0.28, rad=0.095, shade_col=(244, 206, 132), glow_col=(255, 200, 108)):
        # Stem + base
        p0 = proj(x, base_y, z)
        p1 = proj(x, base_y + h * 0.68, z)
        self.draw.line([p0, p1], fill=(78, 62, 42), width=3 * SS)
        self.pendant_lamp(x, z, y_drop=base_y + h, rad=rad, shade_col=shade_col, glow_col=glow_col, cord=False)

    def lantern(self, x, z, y=0.58, r=0.13, col=(226, 36, 18), glow=(255, 132, 42)):
        p0 = proj(x, 1.0, z)
        p1 = proj(x, y + 0.10, z)
        self.draw.line([p0, p1], fill=(55, 25, 18), width=2 * SS)
        cx, cy = proj(x, y, z)
        rx = abs(proj(x + r, y, z)[0] - cx)
        ry = rx * 1.15
        self.gdraw.ellipse([cx - rx * 1.15, cy - ry * 1.15, cx + rx * 1.15, cy + ry * 1.15], fill=glow)
        self.draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=col, outline=(120, 18, 12), width=SS)
        self.draw.ellipse([cx - rx * 0.55, cy - ry * 0.65, cx + rx * 0.55, cy + ry * 0.65], fill=(255, 174, 68))
        self.draw.rectangle([cx - rx * 0.35, cy - ry - 3, cx + rx * 0.35, cy - ry + 3], fill=(214, 168, 48))
        self.draw.rectangle([cx - rx * 0.35, cy + ry - 3, cx + rx * 0.35, cy + ry + 3], fill=(214, 168, 48))
        self.draw.line([(cx, cy + ry + 3), (cx, cy + ry + rx * 0.85)], fill=(210, 45, 24), width=2 * SS)

    def curtains(self, left_w=0.22, right_w=0.22, col=(225, 215, 198), sheer=True):
        alpha = 182 if sheer else 242
        for side, w in ((-1, left_w), (1, right_w)):
            if w <= 0.01:
                continue
            folds = 6
            for f in range(folds):
                t0, t1 = f / folds, (f + 1) / folds
                x0 = (-1.0 + w * t0) if side < 0 else (1.0 - w * t1)
                x1 = (-1.0 + w * t1) if side < 0 else (1.0 - w * t0)
                k = 0.74 + 0.28 * math.sin((f + 0.5) * math.pi * 0.88)
                self.quad3([(x0, -1.0, -0.05), (x1, -1.0, -0.05), (x1, 1.0, -0.05), (x0, 1.0, -0.05)], mul_rgb(col, k) + (alpha,))

    def blinds(self, drop=0.40, col=(192, 188, 182)):
        n_slats = int(drop * 22)
        for i in range(n_slats):
            y1 = 1.0 - i * (2.0 * drop / max(n_slats, 1))
            y0 = y1 - (1.45 * drop / max(n_slats, 1))
            k = 0.80 + 0.18 * (i % 2)
            self.quad3([(-1.0, y0, -0.05), (1.0, y0, -0.05), (1.0, y1, -0.05), (-1.0, y1, -0.05)], mul_rgb(col, k) + (212,))

    def ac_unit(self, x0=-0.92, y0=0.62, z=-0.95):
        self.box3(x0, y0, -0.99, x0 + 0.54, y0 + 0.19, z + 0.10, (232, 232, 228), outline=(145, 145, 140))
        self.quad3([(x0 + 0.04, y0 + 0.03, z + 0.105), (x0 + 0.50, y0 + 0.03, z + 0.105), (x0 + 0.50, y0 + 0.07, z + 0.105), (x0 + 0.04, y0 + 0.07, z + 0.105)], (70, 74, 80))

    def plant(self, x, z, h=0.80, r=0.17):
        # Ceramic pot + dark soil + organic layered palm/monstera leaves
        self.box3(x - r * 0.44, -1.0, z - r * 0.44, x + r * 0.44, -1.0 + h * 0.30, z + r * 0.44, (162, 128, 96), outline=(92, 70, 50))
        cx, cy = proj(x, -1.0 + h * 0.68, z)
        px_r = max(10, abs(proj(x + r, -1.0 + h * 0.68, z)[0] - cx))
        for _ in range(18):
            ox = self.rng.uniform(-px_r * 0.95, px_r * 0.95)
            oy = self.rng.uniform(-px_r * 0.85, px_r * 0.65)
            rr = self.rng.uniform(px_r * 0.24, px_r * 0.48)
            g = self.rng.randint(68, 134)
            self.draw.ellipse([cx + ox - rr, cy + oy - rr * 0.7, cx + ox + rr, cy + oy + rr * 0.7], fill=(int(g * 0.44), g, int(g * 0.36), 240))

    def bookshelf(self, x0, y0, x1, y1, z=-0.98, d=0.20, wood=(104, 72, 46), rows=5):
        self.box3(x0, y0, z, x1, y1, z + d, wood, outline=mul_rgb(wood, 0.52))
        rh = (y1 - y0 - 0.08) / rows
        palette = [(165, 50, 42), (46, 82, 126), (194, 150, 64), (58, 110, 72), (210, 200, 182), (122, 66, 94), (66, 70, 78)]
        for r in range(rows):
            sy0 = y0 + 0.04 + r * rh
            sy1 = sy0 + rh * 0.80
            self.quad3([(x0 + 0.035, sy0, z + d + 0.005), (x1 - 0.035, sy0, z + d + 0.005), (x1 - 0.035, sy1, z + d + 0.005), (x0 + 0.035, sy1, z + d + 0.005)], (36, 26, 18))
            bx = x0 + 0.05
            while bx < x1 - 0.09:
                bw = float(self.rng.uniform(0.032, 0.075))
                bh = float(self.rng.uniform(0.58, 0.92)) * (sy1 - sy0)
                if self.rng.random() > 0.14:
                    c = palette[self.rng.randint(len(palette))]
                    self.quad3([(bx, sy0, z + d + 0.01), (min(bx + bw, x1 - 0.045), sy0, z + d + 0.01),
                                (min(bx + bw, x1 - 0.045), sy0 + bh, z + d + 0.01), (bx, sy0 + bh, z + d + 0.01)], c)
                bx += bw + 0.008

    def banner_text(self, x0, y0, x1, y1, text, bg=(145, 24, 18), fg=(255, 222, 130), z=-0.985):
        p0 = proj(x0, y1, z)
        p1 = proj(x1, y0, z)
        self.glow_quad3([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], bg)
        self.draw.rectangle([p0[0], p0[1], p1[0], p1[1]], outline=fg, width=2 * SS)
        if FONT_PATH and text:
            bw, bh = int(p1[0] - p0[0]), int(p1[1] - p0[1])
            fs = max(14, int(bh * 0.56))
            font = ImageFont.truetype(FONT_PATH, fs)
            bb = font.getbbox(text)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            while tw > bw - 16 and fs > 12:
                fs -= 2
                font = ImageFont.truetype(FONT_PATH, fs)
                bb = font.getbbox(text)
                tw, th = bb[2] - bb[0], bb[3] - bb[1]
            tx = p0[0] + (bw - tw) / 2 - bb[0]
            ty = p0[1] + (bh - th) / 2 - bb[1]
            self.draw.text((tx, ty), text, font=font, fill=fg)
            self.gdraw.text((tx, ty), text, font=font, fill=fg)

    def finish(self):
        gl = self.glow.filter(ImageFilter.GaussianBlur(radius=22 * SS))
        gl_tight = self.glow.filter(ImageFilter.GaussianBlur(radius=6 * SS))
        a = np.asarray(self.img, np.float32)
        out = np.clip(a + np.asarray(gl, np.float32) * 0.34 + np.asarray(gl_tight, np.float32) * 0.28, 0, 255).astype(np.uint8)
        return Image.fromarray(out, "RGB").resize((CELL, CELL), Image.LANCZOS)


ROOMS = []


def add_room(idx, name, group, night_tint, gain, im):
    ROOMS.append((idx, name, group, night_tint, gain, np.asarray(im)))


# ---------------- 0..5: RESIDENTIAL (strict back-to-front painter's order!) ----------------
# 0: resi_living_warm
R = RoomRenderer(100, (236, 222, 196), (154, 112, 74), (220, 200, 172), (204, 184, 156), (255, 214, 150), 1.15, floor_wood=True)
R.floor_rug(-0.76, -0.70, 0.72, -0.14, (186, 166, 138), (144, 118, 92))
R.wall_rect_back(-0.52, -0.22, 0.52, 0.56, (176, 142, 108), outline=(112, 84, 58))
R.wall_rect_back(-0.36, -0.02, 0.36, 0.42, (26, 32, 42), z=-0.98, outline=(16, 18, 22))
R.glow_quad3([(-0.33, 0.01, -0.975), (0.33, 0.01, -0.975), (0.33, 0.39, -0.975), (-0.33, 0.39, -0.975)], (78, 102, 138))
R.cabinet(-0.62, -1.0, -0.98, 0.58, -0.60, -0.72, (112, 76, 48), doors=3)
R.plant(-0.82, -0.82, h=0.84, r=0.17)
R.cabinet(0.60, -1.0, -0.92, 0.92, -0.58, -0.64, (132, 92, 60), doors=1)
R.table_lamp(0.76, -0.58, -0.76, h=0.28, rad=0.10)
R.sofa(-0.78, -0.54, 0.44, -0.18, col=(166, 140, 116))
R.pendant_lamp(0.0, -0.56, y_drop=0.60, rad=0.17, shade_col=(244, 224, 178), glow_col=(255, 232, 168))
R.ac_unit(-0.92, 0.64)
R.curtains(0.22, 0.20, (236, 224, 202), sheer=True)
add_room(0, "resi_living_warm", "residential", [1.0, 0.88, 0.70], 1.15, R.finish())

# 1: resi_living_modern
R = RoomRenderer(101, (238, 238, 234), (174, 148, 120), (216, 212, 204), (200, 196, 188), (255, 234, 202), 1.18, floor_wood=True)
R.floor_rug(-0.82, -0.76, 0.62, -0.10, (192, 190, 184), (154, 152, 146))
for k in range(11):
    x_ = -0.96 + k * 0.068
    R.wall_rect_back(x_, -1.0, x_ + 0.042, 0.96, (128, 88, 56))
R.bookshelf(0.26, -1.0, 0.94, 0.78, z=-0.98, d=0.20, wood=(86, 68, 52), rows=5)
R.wall_art(-0.18, 0.06, 0.20, 0.66, art_col=(68, 102, 116), accent=(206, 156, 86))
R.plant(-0.82, -0.84, h=0.92, r=0.18)
R.sofa(-0.84, -0.68, 0.26, -0.34, col=(92, 102, 112), pillow_cols=((212, 164, 78), (222, 220, 214)))
R.table_legged(-0.46, -0.28, 0.22, -0.08, top_y=-0.72, col=(208, 200, 188), leg_col=(48, 48, 52))
R.ceiling_light(-0.68, -0.82, 0.68, -0.72, (255, 244, 218))
R.ceiling_light(-0.22, -0.45, 0.22, -0.35, (255, 246, 224))
R.curtains(0.18, 0.26, (224, 224, 220), sheer=True)
add_room(1, "resi_living_modern", "residential", [1.0, 0.94, 0.84], 1.05, R.finish())

# 2: resi_bedroom_warm
R = RoomRenderer(102, (226, 210, 188), (142, 104, 72), (206, 184, 160), (190, 170, 146), (255, 198, 128), 0.95, floor_wood=True)
R.floor_rug(-0.84, -0.86, 0.84, -0.14, (176, 156, 136), (138, 116, 98))
R.wall_rect_left(-0.96, -1.0, -0.30, 0.78, (124, 92, 64), outline=(68, 48, 32))
R.wall_art(-0.30, 0.04, 0.30, 0.54, art_col=(186, 136, 98), accent=(122, 76, 56))
R.box3(-0.56, -0.96, -0.98, 0.56, -0.18, -0.86, (104, 72, 50), outline=(58, 38, 24))
for sx in (-0.76, 0.76):
    R.cabinet(sx - 0.16, -1.0, -0.96, sx + 0.16, -0.62, -0.72, (112, 78, 52), doors=1)
    R.table_lamp(sx, -0.62, -0.82, h=0.25, rad=0.10, shade_col=(246, 196, 112), glow_col=(255, 188, 90))
R.box3(-0.54, -1.0, -0.86, 0.54, -0.52, -0.18, (228, 216, 200), outline=(142, 130, 116))
R.box3(-0.54, -0.68, -0.54, 0.54, -0.50, -0.18, (152, 92, 72))
R.box3(-0.46, -0.52, -0.84, -0.04, -0.34, -0.66, (244, 238, 228), outline=(176, 168, 158))
R.box3(0.04, -0.52, -0.84, 0.46, -0.34, -0.66, (244, 238, 228), outline=(176, 168, 158))
R.pendant_lamp(0.0, -0.52, y_drop=0.64, rad=0.15, shade_col=(242, 214, 168), glow_col=(255, 222, 156))
R.curtains(0.28, 0.28, (158, 128, 106), sheer=False)
add_room(2, "resi_bedroom_warm", "residential", [1.0, 0.82, 0.58], 0.92, R.finish())

# 3: resi_study_books
R = RoomRenderer(103, (230, 220, 202), (136, 100, 68), (204, 192, 172), (188, 176, 158), (255, 222, 168), 1.05, floor_wood=True)
R.bookshelf(-0.94, -1.0, 0.36, 0.84, z=-0.98, d=0.20, wood=(94, 64, 40), rows=5)
R.plant(0.74, -0.82, h=0.88, r=0.18)
R.table_legged(-0.40, -0.58, 0.86, -0.22, top_y=-0.46, col=(136, 98, 62))
R.box3(0.06, -0.46, -0.52, 0.62, -0.04, -0.44, (30, 34, 42))
R.glow_quad3([(0.09, -0.42, -0.43), (0.59, -0.42, -0.43), (0.59, -0.07, -0.43), (0.09, -0.07, -0.43)], (146, 198, 248))
R.table_lamp(-0.22, -0.46, -0.44, h=0.28, rad=0.095, shade_col=(224, 178, 92), glow_col=(255, 216, 120))
R.box3(0.18, -0.92, -0.20, 0.48, -0.34, -0.14, (56, 58, 66))  # chair back
R.pendant_lamp(0.0, -0.55, y_drop=0.68, rad=0.14, shade_col=(236, 224, 198), glow_col=(255, 232, 185))
R.blinds(0.30, (206, 196, 178))
add_room(3, "resi_study_books", "residential", [1.0, 0.88, 0.68], 1.05, R.finish())

# 4: resi_old_apt
R = RoomRenderer(104, (224, 222, 212), (164, 158, 146), (216, 208, 190), (200, 192, 176), (242, 244, 216), 1.0, floor_tile=True)
R.wall_rect_back(-0.99, -1.0, 0.99, -0.22, (186, 192, 184))
R.wall_rect_back(-0.99, -0.24, 0.99, -0.20, (128, 98, 70))
R.wall_rect_back(0.28, -1.0, 0.82, 0.56, (122, 76, 44), outline=(68, 40, 22))
R.wall_rect_back(0.34, -0.10, 0.76, 0.48, (112, 68, 38), outline=(72, 42, 24))
R.cabinet(-0.88, -1.0, -0.96, 0.14, -0.34, -0.68, (134, 90, 54), doors=3)
R.wall_rect_back(-0.74, -0.02, -0.18, 0.44, (192, 46, 36), outline=(218, 176, 86))
R.table_legged(-0.52, -0.50, 0.42, -0.16, top_y=-0.54, col=(152, 108, 70))
for cx in (-0.36, 0.24):
    R.box3(cx - 0.10, -0.94, -0.56, cx + 0.10, -0.36, -0.50, (112, 76, 46))  # wooden dining chairs
R.ceiling_light(-0.48, -0.58, 0.48, -0.46, (246, 252, 232))
R.ac_unit(-0.88, 0.58)
R.curtains(0.24, 0.22, (194, 170, 144), sheer=True)
add_room(4, "resi_old_apt", "residential", [0.96, 0.95, 0.82], 1.0, R.finish())

# 5: resi_kitchen_dining
R = RoomRenderer(105, (238, 234, 224), (172, 166, 156), (222, 218, 210), (206, 200, 190), (255, 232, 192), 1.15, floor_tile=True)
R.cabinet(-0.96, 0.18, -0.98, 0.64, 0.84, -0.74, (226, 216, 198), doors=4, handle_col=(118, 114, 108))
R.cabinet(-0.96, -1.0, -0.98, 0.64, -0.34, -0.66, (174, 140, 106), doors=4)
R.wall_rect_back(-0.96, -0.34, 0.64, 0.18, (236, 234, 228))
R.glow_quad3([(-0.92, 0.10, -0.97), (0.60, 0.10, -0.97), (0.60, 0.17, -0.97), (-0.92, 0.17, -0.97)], (255, 238, 190))
R.cabinet(0.66, -1.0, -0.98, 0.98, 0.68, -0.62, (194, 200, 206), doors=1, handle_col=(88, 92, 98))
R.table_legged(-0.56, -0.44, 0.38, -0.14, top_y=-0.56, col=(162, 124, 86))
R.pendant_lamp(-0.18, -0.34, y_drop=0.46, rad=0.11, shade_col=(236, 188, 108), glow_col=(255, 222, 145))
R.pendant_lamp(0.18, -0.34, y_drop=0.46, rad=0.11, shade_col=(236, 188, 108), glow_col=(255, 222, 145))
R.curtains(0.14, 0.14, (236, 232, 224), sheer=True)
add_room(5, "resi_kitchen_dining", "residential", [1.0, 0.90, 0.72], 1.12, R.finish())

# ---------------- 6..10: MODERN CBD OFFICES ----------------
# 6: office_open_cool
R = RoomRenderer(106, (226, 232, 240), (112, 118, 128), (204, 212, 220), (188, 196, 206), (225, 238, 255), 1.25, floor_tile=True)
for x_ in (-0.6, -0.2, 0.2, 0.6):
    R.quad3([(x_ - 0.008, 0.996, -1.0), (x_ + 0.008, 0.996, -1.0), (x_ + 0.008, 0.996, 0.0), (x_ - 0.008, 0.996, 0.0)], (156, 164, 174))
for z_ in (-0.84, -0.54, -0.24):
    R.ceiling_light(-0.78, z_ - 0.07, -0.16, z_ + 0.07, (238, 248, 255))
    R.ceiling_light(0.16, z_ - 0.07, 0.78, z_ + 0.07, (238, 248, 255))
R.wall_rect_back(-0.92, -1.0, 0.92, 0.88, (152, 178, 198), outline=(68, 78, 88))
for x_ in (-0.46, 0.0, 0.46):
    R.wall_rect_back(x_ - 0.02, -1.0, x_ + 0.02, 0.88, (60, 68, 78))
for z_ in (-0.72, -0.34):
    R.table_legged(-0.88, z_ - 0.12, 0.88, z_ + 0.12, top_y=-0.52, col=(220, 224, 228), leg_col=(92, 98, 106))
    for mx in (-0.68, -0.24, 0.22, 0.64):
        R.box3(mx - 0.14, -0.52, z_ - 0.04, mx + 0.14, -0.20, z_ + 0.02, (34, 40, 50))
        R.glow_quad3([(mx - 0.12, -0.49, z_ + 0.025), (mx + 0.12, -0.49, z_ + 0.025), (mx + 0.12, -0.23, z_ + 0.025), (mx - 0.12, -0.23, z_ + 0.025)], (156, 204, 250))
        R.box3(mx - 0.08, -0.84, z_ + 0.12, mx + 0.08, -0.36, z_ + 0.18, (46, 50, 56))
add_room(6, "office_open_cool", "office", [0.88, 0.95, 1.0], 1.2, R.finish())

# 7: office_exec_warm
R = RoomRenderer(107, (232, 226, 214), (104, 98, 92), (134, 98, 68), (184, 176, 164), (255, 232, 195), 1.15, floor_wood=True)
R.bookshelf(-0.94, -1.0, -0.26, 0.80, z=-0.98, d=0.20, wood=(82, 56, 36), rows=5)
R.wall_rect_back(0.05, -0.10, 0.78, 0.54, (34, 40, 50), outline=(182, 158, 124))
R.glow_quad3([(0.09, -0.06, -0.975), (0.74, -0.06, -0.975), (0.74, 0.50, -0.975), (0.09, 0.50, -0.975)], (118, 158, 198))
R.plant(0.84, -0.82, h=0.94, r=0.17)
for cx in (-0.42, 0.0, 0.42):
    R.box3(cx - 0.09, -0.88, -0.68, cx + 0.09, -0.32, -0.60, (50, 48, 46))
R.table_legged(-0.64, -0.58, 0.64, -0.14, top_y=-0.52, col=(116, 80, 50), leg_col=(48, 36, 26))
R.ceiling_light(-0.62, -0.64, 0.62, -0.54, (255, 240, 206))
R.ceiling_light(-0.62, -0.32, 0.62, -0.22, (255, 240, 206))
R.blinds(0.24, (182, 174, 160))
add_room(7, "office_exec_warm", "office", [1.0, 0.90, 0.74], 1.12, R.finish())

# 8: office_bright_grid
R = RoomRenderer(108, (240, 242, 246), (134, 138, 144), (220, 224, 230), (206, 210, 216), (242, 246, 255), 1.32, floor_tile=True)
for z_ in (-0.86, -0.62, -0.38, -0.16):
    for x0_, x1_ in ((-0.86, -0.36), (-0.22, 0.22), (0.36, 0.86)):
        R.ceiling_light(x0_, z_ - 0.055, x1_, z_ + 0.055, (248, 252, 255))
R.box3(-0.14, -1.0, -0.78, 0.14, 1.0, -0.56, (214, 218, 224), outline=(144, 150, 158))
R.table_legged(-0.92, -0.52, -0.20, -0.18, top_y=-0.52, col=(226, 228, 232), leg_col=(106, 112, 120))
R.table_legged(0.20, -0.52, 0.92, -0.18, top_y=-0.52, col=(226, 228, 232), leg_col=(106, 112, 120))
for mx in (-0.72, -0.40, 0.40, 0.72):
    R.box3(mx - 0.11, -0.52, -0.38, mx + 0.11, -0.22, -0.32, (40, 44, 52))
    R.glow_quad3([(mx - 0.09, -0.49, -0.315), (mx + 0.09, -0.49, -0.315), (mx + 0.09, -0.24, -0.315), (mx - 0.09, -0.24, -0.315)], (184, 218, 252))
add_room(8, "office_bright_grid", "office", [0.94, 0.97, 1.0], 1.25, R.finish())

# 9: office_lounge_atrium
R = RoomRenderer(109, (144, 108, 74), (122, 118, 112), (190, 184, 176), (174, 168, 160), (255, 222, 174), 1.15, floor_wood=True)
R.floor_rug(-0.84, -0.68, 0.56, -0.12, (158, 152, 144), (118, 112, 106))
for x_ in np.linspace(-0.92, 0.92, 11):
    R.quad3([(x_ - 0.024, 0.99, -1.0), (x_ + 0.024, 0.99, -1.0), (x_ + 0.024, 0.99, 0.0), (x_ - 0.024, 0.99, 0.0)], (92, 64, 42))
R.wall_art(-0.84, -0.06, 0.22, 0.62, frame_col=(42, 46, 54), art_col=(56, 86, 108), accent=(214, 160, 82))
R.plant(0.68, -0.82, h=1.02, r=0.22)
R.sofa(-0.80, -0.58, 0.44, -0.20, col=(148, 96, 62), pillow_cols=((226, 206, 172), (76, 98, 112)))
for lx in (-0.52, 0.0, 0.52):
    R.pendant_lamp(lx, -0.50, y_drop=0.62, rad=0.11, shade_col=(50, 52, 56), glow_col=(255, 220, 148))
add_room(9, "office_lounge_atrium", "office", [1.0, 0.88, 0.68], 1.1, R.finish())

# 10: office_night_partial
R = RoomRenderer(110, (108, 118, 134), (66, 70, 80), (104, 114, 128), (92, 100, 114), (185, 212, 245), 0.55, floor_tile=True)
R.ceiling_light(0.18, -0.68, 0.74, -0.54, (226, 242, 255))
R.table_legged(-0.88, -0.64, 0.88, -0.26, top_y=-0.52, col=(112, 118, 126), leg_col=(54, 58, 66))
R.box3(0.24, -0.52, -0.48, 0.68, -0.18, -0.42, (26, 32, 40))
R.glow_quad3([(0.27, -0.49, -0.415), (0.65, -0.49, -0.415), (0.65, -0.21, -0.415), (0.27, -0.21, -0.415)], (132, 192, 255))
R.table_lamp(-0.48, -0.52, -0.44, h=0.30, rad=0.095, shade_col=(60, 62, 68), glow_col=(255, 208, 128))
R.blinds(0.42, (118, 124, 134))
add_room(10, "office_night_partial", "office", [0.85, 0.92, 1.0], 0.82, R.finish())

# ---------------- 11..15: CHONGQING GROUND-FLOOR SHOPFRONTS ----------------
# 11: shop_hotpot
R = RoomRenderer(111, (108, 60, 42), (114, 88, 70), (160, 108, 72), (142, 94, 62), (255, 176, 84), 1.32, floor_tile=True)
R.wall_rect_back(-0.99, -1.0, 0.99, -0.18, (86, 46, 28))
for x_ in (-0.88, -0.32, 0.32, 0.88):
    R.wall_rect_back(x_ - 0.04, -1.0, x_ + 0.04, 0.98, (72, 36, 20))
R.banner_text(-0.76, 0.14, 0.76, 0.64, "九宫格老火锅 · 小面", bg=(158, 22, 16), fg=(255, 226, 132))
R.cabinet(-0.92, -1.0, -0.96, 0.92, -0.38, -0.68, (104, 58, 34), doors=4)
for tx in (-0.50, 0.46):
    # Wooden dining booth benches behind table
    R.box3(tx - 0.34, -0.96, -0.60, tx + 0.34, -0.40, -0.52, (98, 52, 28), outline=(54, 28, 14))
    R.table_legged(tx - 0.32, -0.48, tx + 0.32, -0.16, top_y=-0.52, col=(136, 78, 44))
    cx, cy = proj(tx, -0.48, -0.32)
    R.draw.ellipse([cx - 24 * SS, cy - 10 * SS, cx + 24 * SS, cy + 10 * SS], fill=(208, 56, 22), outline=(196, 148, 64), width=2 * SS)
    R.gdraw.ellipse([cx - 18 * SS, cy - 7 * SS, cx + 18 * SS, cy + 7 * SS], fill=(255, 136, 48))
for lx, lz in ((-0.58, -0.42), (0.0, -0.54), (0.58, -0.42)):
    R.lantern(lx, lz, y=0.62, r=0.13, col=(226, 36, 18), glow=(255, 134, 40))
add_room(11, "shop_hotpot", "shop", [1.0, 0.78, 0.48], 1.45, R.finish())

# 12: shop_convenience — Richly stocked 24h convenience store with dark chiller mullions & vivid beverage rows!
R = RoomRenderer(112, (236, 240, 246), (186, 188, 194), (222, 228, 236), (208, 214, 222), (242, 250, 255), 1.35, floor_tile=True)
for z_ in (-0.82, -0.46, -0.16):
    R.ceiling_light(-0.82, z_ - 0.055, -0.12, z_ + 0.055, (246, 252, 255))
    R.ceiling_light(0.12, z_ - 0.055, 0.82, z_ + 0.055, (246, 252, 255))
for ci, cx0 in enumerate((-0.90, -0.44, 0.02, 0.48)):
    # Black steel beverage cooler frame
    R.box3(cx0, -0.96, -0.98, cx0 + 0.42, 0.76, -0.78, (46, 52, 60), outline=(24, 28, 34))
    R.glow_quad3([(cx0 + 0.035, -0.78, -0.77), (cx0 + 0.385, -0.78, -0.77), (cx0 + 0.385, 0.68, -0.77), (cx0 + 0.035, 0.68, -0.77)], (178, 212, 232))
    c_rows = [(198, 34, 28), (32, 118, 198), (228, 158, 26), (42, 152, 64), (168, 48, 134)]
    for rr in range(5):
        ry0 = -0.70 + rr * 0.27
        # Shelf rail + individual beverage bottles!
        R.quad3([(cx0 + 0.04, ry0 - 0.025, -0.762), (cx0 + 0.38, ry0 - 0.025, -0.762), (cx0 + 0.38, ry0, -0.762), (cx0 + 0.04, ry0, -0.762)], (62, 68, 76))
        bc = c_rows[(rr + ci) % len(c_rows)]
        for bi in range(5):
            bx0 = cx0 + 0.055 + bi * 0.064
            R.quad3([(bx0, ry0, -0.758), (bx0 + 0.048, ry0, -0.758), (bx0 + 0.048, ry0 + 0.16, -0.758), (bx0, ry0 + 0.16, -0.758)], bc)
# Foreground snack gondola with shelf rails + rows of colorful snack packs + green checkout counter + POS monitor
R.box3(-0.84, -1.0, -0.52, -0.16, -0.24, -0.22, (74, 78, 86), outline=(42, 46, 52))
snack_cols = [(208, 62, 34), (226, 174, 42), (48, 132, 198), (64, 162, 78), (218, 118, 38), (168, 56, 134)]
for rr in range(3):
    ry0 = -0.84 + rr * 0.20
    R.quad3([(-0.82, ry0 - 0.025, -0.212), (-0.18, ry0 - 0.025, -0.212), (-0.18, ry0, -0.212), (-0.82, ry0, -0.212)], (214, 218, 222))
    for si in range(6):
        sx0 = -0.80 + si * 0.102
        sc = snack_cols[(rr * 2 + si) % len(snack_cols)]
        R.quad3([(sx0, ry0, -0.208), (sx0 + 0.082, ry0, -0.208), (sx0 + 0.082, ry0 + 0.13, -0.208), (sx0, ry0 + 0.13, -0.208)], sc)
R.cabinet(0.24, -1.0, -0.44, 0.90, -0.48, -0.16, (44, 128, 80), doors=2)
R.box3(0.46, -0.48, -0.34, 0.72, -0.28, -0.28, (32, 36, 44))  # POS screen
add_room(12, "shop_convenience", "shop", [0.92, 0.98, 1.0], 1.38, R.finish())

# 13: shop_teahouse
R = RoomRenderer(113, (112, 78, 50), (122, 94, 68), (172, 142, 108), (152, 122, 92), (255, 204, 124), 1.2, floor_wood=True)
R.wall_rect_back(-0.92, -0.20, -0.34, 0.78, (108, 64, 36), outline=(62, 36, 20))
R.wall_rect_back(0.34, -0.20, 0.92, 0.78, (108, 64, 36), outline=(62, 36, 20))
for bx in (-0.78, -0.62, -0.48, 0.48, 0.62, 0.78):
    R.wall_rect_back(bx - 0.015, -0.20, bx + 0.015, 0.78, (60, 34, 18))
for by in (0.0, 0.24, 0.48):
    R.wall_rect_back(-0.92, by - 0.015, -0.34, by + 0.015, (60, 34, 18))
    R.wall_rect_back(0.34, by - 0.015, 0.92, by + 0.015, (60, 34, 18))
R.banner_text(-0.28, -0.05, 0.28, 0.72, "巴渝老茶馆", bg=(218, 194, 152), fg=(54, 28, 16))
R.bookshelf(-0.92, -1.0, 0.92, -0.24, z=-0.98, d=0.20, wood=(88, 54, 30), rows=2)
R.plant(-0.82, -0.68, h=0.88, r=0.18)
R.table_legged(-0.54, -0.48, 0.54, -0.16, top_y=-0.52, col=(132, 84, 46))
for lx in (-0.52, 0.0, 0.52):
    R.pendant_lamp(lx, -0.44, y_drop=0.56, rad=0.13, shade_col=(244, 192, 108), glow_col=(255, 212, 122))
add_room(13, "shop_teahouse", "shop", [1.0, 0.84, 0.56], 1.35, R.finish())

# 14: shop_bakery_pharm
R = RoomRenderer(114, (240, 230, 212), (172, 158, 142), (226, 212, 192), (210, 196, 178), (255, 224, 174), 1.28, floor_tile=True)
R.bookshelf(-0.94, -0.22, 0.94, 0.70, z=-0.98, d=0.22, wood=(144, 104, 68), rows=4)
R.banner_text(-0.62, 0.73, 0.62, 0.94, "山城手作烘焙", bg=(72, 48, 32), fg=(255, 228, 168))
R.cabinet(-0.88, -1.0, -0.50, 0.88, -0.66, -0.16, (164, 124, 86), doors=4)
R.box3(-0.88, -0.66, -0.50, 0.88, -0.32, -0.16, (94, 82, 72), outline=(48, 42, 36))
R.glow_quad3([(-0.83, -0.63, -0.15), (0.83, -0.63, -0.15), (0.83, -0.35, -0.15), (-0.83, -0.35, -0.15)], (255, 234, 186))
for bx in np.linspace(-0.72, 0.72, 8):
    R.quad3([(bx - 0.055, -0.60, -0.145), (bx + 0.055, -0.60, -0.145), (bx + 0.055, -0.47, -0.145), (bx - 0.055, -0.47, -0.145)], (196, 122, 48))
for lx in (-0.56, 0.0, 0.56):
    R.pendant_lamp(lx, -0.36, y_drop=0.46, rad=0.11, shade_col=(234, 182, 102), glow_col=(255, 226, 152))
add_room(14, "shop_bakery_pharm", "shop", [1.0, 0.89, 0.70], 1.35, R.finish())

# 15: shop_cafe_boutique — Non-overlapping pendant bulbs, warm brick, backlit bar & espresso counter!
R = RoomRenderer(115, (82, 74, 68), (114, 104, 92), (142, 88, 64), (164, 152, 138), (255, 206, 144), 1.25, floor_wood=True)
for by in np.linspace(-0.8, 0.9, 14):
    R.wall_rect_back(-0.98, by, 0.98, by + 0.015, (104, 62, 44))
R.banner_text(-0.62, 0.36, 0.62, 0.68, "COFFEE · 渝城咖啡", bg=(30, 28, 26), fg=(255, 220, 148))
R.glow_quad3([(-0.86, -0.22, -0.975), (0.86, -0.22, -0.975), (0.86, 0.24, -0.975), (-0.86, 0.24, -0.975)], (232, 172, 98))
for sy in (-0.08, 0.08):
    R.wall_rect_back(-0.86, sy, 0.86, sy + 0.03, (52, 38, 28), z=-0.96)
R.plant(0.76, -0.78, h=0.88, r=0.17)
R.cabinet(-0.84, -1.0, -0.58, 0.84, -0.44, -0.20, (60, 52, 46), doors=4, handle_col=(186, 156, 104))
R.box3(-0.36, -0.44, -0.48, 0.26, -0.14, -0.32, (192, 196, 202), outline=(88, 92, 98))
for lx in (-0.64, 0.64):
    R.pendant_lamp(lx, -0.36, y_drop=0.46, rad=0.09, shade_col=(42, 38, 36), glow_col=(255, 204, 118))
R.pendant_lamp(0.0, -0.34, y_drop=0.76, rad=0.08, shade_col=(42, 38, 36), glow_col=(255, 204, 118))
add_room(15, "shop_cafe_boutique", "shop", [1.0, 0.84, 0.58], 1.35, R.finish())

COLS, ROWS = 4, 4
atlas = np.zeros((ROWS * CELL, COLS * CELL, 3), np.uint8)
meta_rooms = []
groups = {"residential": [], "office": [], "shop": []}
for idx, name, grp, ntint, gain, arr in ROOMS:
    r_, c_ = divmod(idx, COLS)
    atlas[r_ * CELL:(r_ + 1) * CELL, c_ * CELL:(c_ + 1) * CELL] = arr
    groups[grp].append(idx)
    meta_rooms.append(dict(index=idx, name=name, group=grp, nightTint=ntint, emissiveGain=gain))

im_atlas = Image.fromarray(atlas, "RGB")
im_atlas.save(os.path.join(OUT, "interiors.webp"), quality=90, method=5)
im_atlas.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, "..", "..", "data", "debug", "interiors_preview.jpg"), quality=88)
meta = dict(
    file="interiors.webp",
    size=CELL,
    cellW=CELL,
    cellH=CELL,
    layers=len(ROOMS),
    count=len(ROOMS),
    cols=COLS,
    rows=ROWS,
    projection="perspective_box_v1",
    backWallInset=0.25,
    depth=1.0,
    vOrigin="top",
    groups=groups,
    rooms=meta_rooms,
)
json.dump(meta, open(os.path.join(OUT, "interiors.json"), "w"), indent=1)
print("interiors.webp:", im_atlas.size, os.path.getsize(os.path.join(OUT, "interiors.webp")) // 1024, "KB;", len(ROOMS), "rooms")
