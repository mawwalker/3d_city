"""Generate eye-catching video covers for shanghai_3d in two distinct styles and two aspect ratios (16:9 + 3:4):

1. Cinematic Real-Time Render Series Style (aligning with beijing_3d, upgraded with twilight grading & halation):
   - video/cover_16x9_hd.jpg (3840x2160) & video/cover_16x9.jpg (1920x1080)
   - video/cover_3x4_hd.jpg  (2160x2880) & video/cover_3x4.jpg  (1080x1440)

2. GTA Parody Box-Art Style (matching the film's "Grand Tour Auto 7 · 魔都" intro, with slanted comic panels):
   - video/cover_gta_16x9_hd.jpg (3840x2160) & video/cover_gta_16x9.jpg (1920x1080)
   - video/cover_gta_3x4_hd.jpg  (2160x2880) & video/cover_gta_3x4.jpg  (1080x1440)

Usage (from shanghai_3d/):
  .venv/bin/python tools/cover.py
"""
import math
import os
import cv2
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VIDEO = os.path.join(ROOT, "video")
COVER_DIR = os.path.join(VIDEO, "cover")
CLIPS_DIR = os.path.join(VIDEO, "clips")
FONTS_DIR = os.path.join(VIDEO, "fonts")

FD_SERIF = "/usr/share/fonts/adobe-source-han-serif/SourceHanSerifCN-"
FONT_BLACK = "/usr/share/fonts/noto-cjk/NotoSansCJK-Black.ttc"
FONT_PRICE = os.path.join(FONTS_DIR, "Pricedown Bl.otf")


def save_pair(im_hd: Image.Image, out_hd: str, out_std: str):
    im_hd = im_hd.convert("RGB")
    im_hd.save(out_hd, quality=94, subsampling=0)
    im_std = im_hd.resize((im_hd.width // 2, im_hd.height // 2), Image.LANCZOS)
    im_std.save(out_std, quality=92, subsampling=0)
    print(f"Saved {os.path.relpath(out_hd, ROOT)} {im_hd.size} & {os.path.relpath(out_std, ROOT)} {im_std.size}")


# ==============================================================================
# PART 1: CINEMATIC REAL-TIME RENDER BLOCKBUSTER COVER
# ==============================================================================

def grade_twilight(img: Image.Image, u: float) -> Image.Image:
    """Enhance twilight sky depth, warm horizon & window gold, and add subtle photographic lens bloom."""
    rgb = np.asarray(img).astype(np.float32) / 255.0
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

    # S-curve + shadow richness: deepen dusty mauve mid-shadows into royal twilight indigo-sapphire,
    # while lifting warm city lights and sunset horizon glow.
    shadow_w = np.clip(1.0 - lum / 0.52, 0.0, 1.0) ** 1.4
    warm_w = np.clip((rgb[..., 0] - rgb[..., 2] + 0.06) * 2.8, 0.0, 1.0) * np.clip(lum * 2.2, 0.0, 1.0)

    graded = np.empty_like(rgb)
    graded[..., 0] = rgb[..., 0] * (1.0 - 0.12 * shadow_w + 0.14 * warm_w)
    graded[..., 1] = rgb[..., 1] * (1.0 - 0.07 * shadow_w + 0.06 * warm_w)
    graded[..., 2] = rgb[..., 2] * (1.0 + 0.16 * shadow_w - 0.04 * warm_w)

    # Contrast curve with smooth highlight roll-off (prevents Oriental Pearl from clipping flat white)
    graded = np.clip(graded, 0.0, 1.0)
    graded = np.clip(((graded - 0.36) * 1.16 + 0.37), 0.0, 1.0)
    graded = graded / (1.0 + 0.16 * (graded ** 3)) * 1.12
    # Give ultra-bright emissive rose/white surfaces (Oriental Pearl) subtle warm rose-pearl tone
    pearl_w = np.clip((lum - 0.84) / 0.15, 0.0, 1.0) * np.clip((rgb[..., 0] - rgb[..., 1]) * 8.0 + 0.5, 0.0, 1.0)
    graded[..., 1] *= (1.0 - 0.07 * pearl_w)
    graded[..., 2] *= (1.0 - 0.04 * pearl_w)
    graded = np.clip(graded, 0.0, 1.0)

    # Photographic halation / bloom around bright city windows, towers, and river reflections
    bright = np.clip((graded - 0.62) / 0.38, 0.0, 1.0) ** 1.5
    sig1 = max(2.0, 14.0 * u)
    sig2 = max(4.0, 38.0 * u)
    bloom1 = cv2.GaussianBlur(bright, (0, 0), sig1)
    bloom2 = cv2.GaussianBlur(bright, (0, 0), sig2)
    tint = np.array([1.08, 0.92, 0.82], dtype=np.float32)
    bloom = (bloom1 * 0.22 + bloom2 * 0.16) * tint[None, None, :]
    graded = 1.0 - (1.0 - graded) * np.clip(1.0 - bloom, 0.0, 1.0)

    # Crisp micro-contrast for architectural windows (stands out at 320px thumbnail width)
    blur_small = cv2.GaussianBlur(graded, (0, 0), max(1.0, 2.2 * u))
    graded = np.clip(graded + (graded - blur_small) * 0.38, 0.0, 1.0)

    return Image.fromarray((graded * 255.0).astype(np.uint8))


def vertical_type(draw: ImageDraw.ImageDraw, text: str, fnt, x0: float, y0: float, step: float, fill):
    for i, ch in enumerate(text):
        bb = draw.textbbox((0, 0), ch, font=fnt)
        cw = bb[2] - bb[0]
        draw.text((x0 - cw / 2.0 - bb[0], y0 + i * step - bb[1]), ch, font=fnt, fill=fill)
    return y0 + len(text) * step


def build_cinematic_cover(src_path: str, mode: str) -> Image.Image:
    raw = Image.open(src_path).convert("RGB")
    W, H = raw.size
    u = W / 3840.0 if mode == "landscape" else W / 2160.0

    img = grade_twilight(raw, u)
    base = np.asarray(img).astype(np.float32) / 255.0

    # Directional velvet twilight scrim ONLY under typography zones (leaves Lujiazui 100% untouched)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    if mode == "landscape":
        left_scrim = (
            np.clip(1.0 - x / (W * 0.38), 0.0, 1.0) ** 1.65
            * np.clip(1.0 - (y - H * 0.56) / (H * 0.36), 0.30, 1.0)
            * 0.66
        )
        bot_scrim = (
            np.clip((y - H * 0.75) / (H * 0.25), 0.0, 1.0) ** 1.45
            * np.clip(1.0 - (x - W * 0.46) / (W * 0.30), 0.0, 1.0)
            * 0.68
        )
        a = np.clip(left_scrim + bot_scrim, 0.0, 0.76)
    else:
        top_scrim = (
            np.clip(1.0 - np.hypot(x / (W * 0.72), y / (H * 0.40)), 0.0, 1.0) ** 1.45 * 0.68
        )
        bot_scrim = (
            np.clip((y - H * 0.78) / (H * 0.22), 0.0, 1.0) ** 1.4
            * np.clip(1.0 - (x - W * 0.55) / (W * 0.42), 0.15, 1.0)
            * 0.70
        )
        a = np.clip(top_scrim + bot_scrim, 0.0, 0.76)

    shade = np.array([10.0 / 255.0, 11.0 / 255.0, 24.0 / 255.0], dtype=np.float32)
    comp = (base * (1.0 - a[..., None]) + shade * a[..., None]) * 255.0
    img = Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8))

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    heavy = lambda s: ImageFont.truetype(FD_SERIF + "Heavy.otf", int(round(s * u)))
    bold = lambda s: ImageFont.truetype(FD_SERIF + "Bold.otf", int(round(s * u)))
    semi = lambda s: ImageFont.truetype(FD_SERIF + "SemiBold.otf", int(round(s * u)))
    med = lambda s: ImageFont.truetype(FD_SERIF + "Medium.otf", int(round(s * u)))

    if mode == "landscape":
        cx, top = 365 * u, 165 * u
        seal_s = 172 * u
        big_sz, sub1_sz, sub2_sz = 345, 98, 76
        sub1_x, sub1_y = 690 * u, 415 * u
        sub2_x, sub2_y = 845 * u, 540 * u
    else:
        cx, top = 340 * u, 112 * u
        seal_s = 142 * u
        big_sz, sub1_sz, sub2_sz = 276, 84, 66
        sub1_x, sub1_y = 615 * u, 310 * u
        sub2_x, sub2_y = 755 * u, 415 * u

    # 1. Vermilion Cinnabar Seal ("沪")
    sx, sy = cx - seal_s / 2.0, top
    d.rounded_rectangle(
        (sx, sy, sx + seal_s, sy + seal_s),
        radius=12 * u,
        fill=(188, 38, 30, 248),
    )
    d.rounded_rectangle(
        (sx + 9 * u, sy + 9 * u, sx + seal_s - 9 * u, sy + seal_s - 9 * u),
        radius=7 * u,
        outline=(252, 232, 212, 185),
        width=max(2, int(round(3.2 * u))),
    )
    f_seal = bold(int(round(118 * (seal_s / (172 * u)))))
    bb = d.textbbox((0, 0), "沪", font=f_seal)
    d.text(
        (
            sx + (seal_s - (bb[2] - bb[0])) / 2.0 - bb[0],
            sy + (seal_s - (bb[3] - bb[1])) / 2.0 - bb[1],
        ),
        "沪",
        font=f_seal,
        fill=(254, 244, 230, 255),
    )

    # 2. Monumental Vertical Title ("上海") + Twin Vertical Subtitle Columns
    gap_y = 56 * u if mode == "landscape" else 44 * u
    vertical_type(
        d,
        "上海",
        heavy(big_sz),
        cx,
        top + seal_s + gap_y,
        big_sz * 1.04 * u,
        (254, 248, 238, 255),
    )
    vertical_type(
        d,
        "可以走进去",
        bold(sub1_sz),
        sub1_x,
        sub1_y,
        sub1_sz * 1.25 * u,
        (252, 214, 136, 252),
    )
    vertical_type(
        d,
        "的三维魔都",
        med(sub2_sz),
        sub2_x,
        sub2_y,
        sub2_sz * 1.22 * u,
        (246, 238, 226, 238),
    )

    # 3. Bottom-Left High-CTR Hook Bar (keeps bottom-right timestamp corner 100% clear)
    if mode == "landscape":
        fx = cx - 105 * u
        fy1 = H - 256 * u
        fy2 = H - 146 * u
        d.rounded_rectangle(
            (fx - 32 * u, fy1 + 8 * u, fx - 21 * u, fy2 + 60 * u),
            radius=4 * u,
            fill=(250, 204, 116, 245),
        )
        d.text(
            (fx, fy1),
            "100 万栋真实建筑 · 317 万棵树 · 装进浏览器",
            font=bold(72),
            fill=(254, 248, 238, 252),
        )
        d.text(
            (fx, fy2),
            "高空俯瞰与第一人称街头漫游  ·  shanghai.smartdeng.com",
            font=semi(50),
            fill=(250, 216, 146, 240),
        )
    else:
        fx = cx - 115 * u
        fy1 = H - 310 * u
        fy2 = H - 200 * u
        d.rounded_rectangle(
            (fx - 28 * u, fy1 + 8 * u, fx - 18 * u, fy2 + 60 * u),
            radius=4 * u,
            fill=(250, 204, 116, 245),
        )
        d.text(
            (fx, fy1),
            "100 万栋真实建筑 · 317 万棵树",
            font=bold(68),
            fill=(254, 248, 238, 252),
        )
        d.text(
            (fx, fy2),
            "打开网页走进去 · shanghai.smartdeng.com",
            font=semi(48),
            fill=(250, 216, 146, 240),
        )

    # Dual drop-shadow (wide atmospheric halo + crisp contact shadow)
    alpha = layer.split()[3]
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    halo.putalpha(alpha.filter(ImageFilter.GaussianBlur(18 * u)).point(lambda v: int(min(255, v * 0.55))))
    tight = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tight.putalpha(alpha.filter(ImageFilter.GaussianBlur(4.5 * u)).point(lambda v: int(min(255, v * 0.65))))

    out = img.convert("RGBA")
    out.alpha_composite(halo, (0, int(round(4 * u))))
    out.alpha_composite(tight, (int(round(2 * u)), int(round(5 * u))))
    out.alpha_composite(layer)
    return out.convert("RGB")


# ==============================================================================
# PART 2: GTA PARODY BOX-ART COVER ("Grand Tour Auto 7 · 魔都")
# ==============================================================================

CLIP_PICKS = {
    "s07_interchange": 0.55,
    "s06_bridge": 0.62,
    "s17_twilight": 0.75,
    "s09_trees": 0.50,
    "s10b_jingan": 0.55,
    "s12_drive": 0.55,
    "s11_bund": 0.50,
    "s08_dive": 0.78,
    "s14a_umbrellas": 0.50,
}


def ensure_clip_frame(name: str) -> str:
    cache_dir = os.path.join(COVER_DIR, "gta_frames")
    os.makedirs(cache_dir, exist_ok=True)
    dst = os.path.join(cache_dir, f"{name}.png")
    if os.path.exists(dst):
        return dst
    cap = cv2.VideoCapture(os.path.join(CLIPS_DIR, f"{name}.mp4"))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * CLIP_PICKS[name]))
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise RuntimeError(f"Failed to read frame from {name}.mp4")
    cv2.imwrite(dst, frame)
    return dst


def gta_illustrate(path: str, bbox_wh: tuple[int, int], grade: str = "warm", focus=(0.5, 0.5)) -> Image.Image:
    """Vibrant Rockstar-style cel-painted illustration with crisp structural ink lines."""
    w, h = bbox_wh
    im = cv2.imread(path)
    ih, iw = im.shape[:2]
    s = max(w / iw, h / ih)
    rw, rh = int(iw * s + 2), int(ih * s + 2)
    im = cv2.resize(im, (rw, rh), interpolation=cv2.INTER_AREA)
    x0 = int(np.clip(focus[0] * rw - w / 2, 0, max(0, rw - w)))
    y0 = int(np.clip(focus[1] * rh - h / 2, 0, max(0, rh - h)))
    im = im[y0:y0 + h, x0:x0 + w]

    f = im.astype(np.float32) / 255.0
    if grade == "night":
        f = np.clip((f ** 0.70) * 1.24, 0, 1)
        f[..., 2] = np.clip(f[..., 2] * 1.14 + 0.02, 0, 1)  # R
        f[..., 0] = np.clip(f[..., 0] * 1.10 + 0.03, 0, 1)  # B
    elif grade == "sunset":
        f = np.clip((f ** 0.80) * 1.14, 0, 1)
        f[..., 2] = np.clip(f[..., 2] * 1.16, 0, 1)
        f[..., 1] = np.clip(f[..., 1] * 1.04, 0, 1)
    elif grade == "rain":
        f = np.clip((f ** 0.78) * 1.16, 0, 1)
        f[..., 0] = np.clip(f[..., 0] * 1.14 + 0.02, 0, 1)  # electric blue-cyan rain mood
        f[..., 1] = np.clip(f[..., 1] * 1.05, 0, 1)
    else:
        f = np.clip((f ** 0.82) * 1.12, 0, 1)
    im_bright = (f * 255).astype(np.uint8)

    small = cv2.resize(im_bright, (max(1, w // 2), max(1, h // 2)), interpolation=cv2.INTER_AREA)
    for _ in range(4):
        small = cv2.bilateralFilter(small, 9, 42, 9)
    flat = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)

    lab = cv2.cvtColor(flat, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[..., 0] = np.clip(np.round(lab[..., 0] / 14.0) * 14.0 * 0.68 + lab[..., 0] * 0.32, 0, 255)
    lab[..., 1:] = (lab[..., 1:] - 128.0) * 1.50 + 128.0
    painted = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)

    gray = cv2.cvtColor(im_bright, cv2.COLOR_BGR2GRAY).astype(np.float32)
    dog = cv2.GaussianBlur(gray, (3, 3), 0.8) - cv2.GaussianBlur(gray, (9, 9), 2.4)
    ink = np.clip((-dog - 3.2) / 9.0, 0.0, 1.0)
    ink = cv2.dilate(ink, np.ones((2, 2), np.uint8)) * 0.84

    out = painted.astype(np.float32) * (1.0 - ink[..., None]) + np.array([14, 12, 18], np.float32) * ink[..., None]
    pil = Image.fromarray(cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB))
    return ImageEnhance.Contrast(pil).enhance(1.10)


def shrink_polygon(pts: list[tuple[float, float]], inset: float) -> list[tuple[float, float]]:
    """Inset a convex polygon uniformly along each edge's inward normal so gutters have exact constant width."""
    n = len(pts)
    lines = []
    # Check winding (screen coords: y down -> clockwise has positive shoelace if standard, let's test centroid)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        # Ensure normal points toward centroid
        if nx * (cx - x1) + ny * (cy - y1) < 0:
            nx, ny = -nx, -ny
        lines.append((x1 + nx * inset, y1 + ny * inset, dx, dy))

    out = []
    for i in range(n):
        px1, py1, dx1, dy1 = lines[i - 1]
        px2, py2, dx2, dy2 = lines[i]
        det = dx1 * dy2 - dy1 * dx2
        if abs(det) < 1e-6:
            out.append((px2, py2))
        else:
            t = ((px2 - px1) * dy2 - (py2 - py1) * dx2) / det
            out.append((px1 + t * dx1, py1 + t * dy1))
    return out


def cjk_black(size: int):
    return ImageFont.truetype(FONT_BLACK, size, index=2)


def pricedown(size: int):
    return ImageFont.truetype(FONT_PRICE, size)


def outlined_text(text: str, fnt, fill, stroke, sw: int, shadow: int = 0) -> Image.Image:
    d0 = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bb = d0.textbbox((0, 0), text, font=fnt, stroke_width=sw)
    pad = sw + shadow + 12
    im = Image.new("RGBA", (bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox, oy = pad - bb[0], pad - bb[1]
    if shadow:
        d.text((ox + shadow, oy + shadow), text, font=fnt, fill=(0, 0, 0, 255), stroke_width=sw, stroke_fill=(0, 0, 0, 255))
    d.text((ox, oy), text, font=fnt, fill=fill, stroke_width=sw, stroke_fill=stroke)
    return im


def gradient_glyph(text: str, fnt, top_rgb, mid_rgb, bot_rgb, sw: int, shadow: int = 12) -> Image.Image:
    base = outlined_text(text, fnt, (255, 255, 255, 255), (0, 0, 0, 255), sw, shadow=shadow)
    # Match exact offset for fill mask
    d0 = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bb = d0.textbbox((0, 0), text, font=fnt, stroke_width=sw)
    pad = sw + shadow + 12
    mask_im = Image.new("L", base.size, 0)
    dm = ImageDraw.Draw(mask_im)
    dm.text((pad - bb[0], pad - bb[1]), text, font=fnt, fill=255)

    w, h = base.size
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    top_a = np.array(top_rgb, np.float32)[None, None, :]
    mid_a = np.array(mid_rgb, np.float32)[None, None, :]
    bot_a = np.array(bot_rgb, np.float32)[None, None, :]
    col = np.where(
        t < 0.52,
        top_a * (1.0 - t / 0.52) + mid_a * (t / 0.52),
        mid_a * (1.0 - (t - 0.52) / 0.48) + bot_a * ((t - 0.52) / 0.48),
    )
    grad = Image.fromarray(np.clip(np.repeat(col, w, axis=1), 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    # Add crisp white inner highlight rim inside the black stroke for glossy GTA emblem feel
    rim_outer = mask_im.filter(ImageFilter.MaxFilter(5))
    rim_only = ImageChops.subtract(rim_outer, mask_im)
    out = base.copy()
    out.paste(grad, (0, 0), mask_im)
    white_rim = Image.new("RGBA", base.size, (255, 245, 230, 0))
    white_rim.putalpha(rim_only.point(lambda v: int(v * 0.55)))
    out.alpha_composite(white_rim)
    return out


def make_gta_logo(scale: float = 1.0) -> Image.Image:
    s = scale
    words = [
        outlined_text(w, pricedown(int(210 * s)), (255, 255, 255, 255), (0, 0, 0, 255), int(15 * s), shadow=int(8 * s))
        for w in ("grand", "tour", "auto")
    ]
    seven = gradient_glyph(
        "7",
        pricedown(int(980 * s)),
        (255, 58, 146),   # hot Vice-City neon magenta-pink
        (255, 126, 62),   # electric sunset coral-orange
        (255, 212, 54),   # warm golden yellow
        sw=int(28 * s),
        shadow=int(14 * s),
    )
    modu = outlined_text("魔都", cjk_black(int(336 * s)), (255, 255, 255, 255), (0, 0, 0, 255), int(20 * s), shadow=int(12 * s))

    lh = int(152 * s)
    stack_w = max(w.size[0] for w in words)
    Wl = stack_w + seven.size[0] - int(62 * s)
    Hl = max(lh * 3 + int(60 * s), seven.size[1]) + modu.size[1] + int(230 * s)
    im = Image.new("RGBA", (Wl + int(60 * s), Hl), (0, 0, 0, 0))

    top = int(30 * s)
    for k, w in enumerate(words):
        im.alpha_composite(w, (stack_w - w.size[0] + int(20 * s), top + int(148 * s) + k * lh))
    im.alpha_composite(seven, (stack_w - int(52 * s), 0))

    my = max(top + int(148 * s) + 2 * lh + words[2].size[1] - int(28 * s), seven.size[1] - int(128 * s))
    im.alpha_composite(modu, ((im.size[0] - modu.size[0]) // 2, my))

    # Tilted sticker banner: "暇道览车手 7：魔都" with crisp white border
    band_t = "暇道览车手 7：魔都"
    fb = cjk_black(int(84 * s))
    d0 = ImageDraw.Draw(im)
    tw = d0.textlength(band_t, font=fb)
    bw, bh = int(tw + 116 * s), int(136 * s)
    band = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    db = ImageDraw.Draw(band)
    db.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=int(10 * s), fill=(10, 10, 14, 248), outline=(255, 212, 68, 255), width=max(3, int(6 * s)))
    db.text((int(58 * s), int(14 * s)), band_t, font=fb, fill=(255, 224, 92, 255))
    band = band.rotate(-2.4, expand=True, resample=Image.BICUBIC)
    im.alpha_composite(band, ((im.size[0] - band.size[0]) // 2, my + modu.size[1] - int(36 * s)))
    return im


def make_hu_star_badge(size: int) -> Image.Image:
    """Rockstar-parody '沪★' studio badge with heavy black/white comic border."""
    S = 500
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=58, fill=(255, 255, 255, 255))
    d.rounded_rectangle([12, 12, S - 13, S - 13], radius=48, fill=(10, 10, 14, 255))
    d.rounded_rectangle([26, 26, S - 27, S - 27], radius=36, fill=(252, 178, 24, 255))
    f = cjk_black(315)
    bb = d.textbbox((0, 0), "沪", font=f)
    d.text(((S - (bb[2] - bb[0])) / 2 - bb[0] - 26, (S - (bb[3] - bb[1])) / 2 - bb[1] - 18), "沪", font=f, fill=(10, 10, 14, 255))
    cx, cy, R, r = S - 115, S - 108, 76, 31
    pts = [
        (cx + (R if k % 2 == 0 else r) * math.sin(k * math.pi / 5),
         cy - (R if k % 2 == 0 else r) * math.cos(k * math.pi / 5))
        for k in range(10)
    ]
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(10, 10, 14, 255), width=10)
    return im.resize((size, size), Image.LANCZOS)


def make_rating_badge(height: int) -> Image.Image:
    w, h = 300, 400
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w - 1, h - 1], fill=(255, 255, 255, 255))
    d.rectangle([10, 10, w - 11, h - 11], fill=(0, 0, 0, 255))
    d.rectangle([22, 22, w - 23, 268], fill=(255, 255, 255, 255))
    f = pricedown(226)
    bb = d.textbbox((0, 0), "E", font=f)
    d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], 138 - (bb[3] - bb[1]) / 2 - bb[1]), "E", font=f, fill=(0, 0, 0, 255))
    f2 = cjk_black(56)
    t = "人人可逛"
    d.text(((w - d.textlength(t, font=f2)) / 2, 282), t, font=f2, fill=(255, 255, 255, 255))
    f3 = cjk_black(25)
    t = "走路也算 · 飞也行"
    d.text(((w - d.textlength(t, font=f3)) / 2, 350), t, font=f3, fill=(235, 215, 130, 255))
    nw = int(round(w * (height / h)))
    return im.resize((nw, height), Image.LANCZOS)


def paste_centered(canvas: Image.Image, im: Image.Image, cx: float, cy: float):
    canvas.alpha_composite(im, (int(round(cx - im.size[0] / 2.0)), int(round(cy - im.size[1] / 2.0))))


def draw_slanted_grid(W: int, H: int, cells: list[tuple[list[tuple[float, float]], str, str, tuple[float, float]]], border: float, gutter: float) -> Image.Image:
    """Render angled GTA comic panels with thick solid-black comic gutters and crisp white inner keylines."""
    canvas = Image.new("RGBA", (W, H), (8, 8, 12, 255))
    # Outer frame inset
    for poly, img_path, grade, focus in cells:
        # Intersect/inset from outer canvas bounds as well by clamping before shrink?
        # Even simpler: shrink each cell polygon by gutter/2, and clamp outer border by `border`!
        shrunk = shrink_polygon(poly, gutter / 2.0)
        xs = [p[0] for p in shrunk]
        ys = [p[1] for p in shrunk]
        x0, y0 = max(0, int(math.floor(min(xs)))), max(0, int(math.floor(min(ys))))
        x1, y1 = min(W, int(math.ceil(max(xs)))), min(H, int(math.ceil(max(ys))))
        pw, ph = max(1, x1 - x0), max(1, y1 - y0)

        art = gta_illustrate(img_path, (pw, ph), grade=grade, focus=focus).convert("RGBA")
        # Supersampled AA polygon mask (2x)
        mask2 = Image.new("L", (pw * 2, ph * 2), 0)
        dm = ImageDraw.Draw(mask2)
        local_pts2 = [((px - x0) * 2.0, (py - y0) * 2.0) for px, py in shrunk]
        dm.polygon(local_pts2, fill=255)
        mask = mask2.resize((pw, ph), Image.LANCZOS)

        panel_layer = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        panel_layer.paste(art, (0, 0), mask)

        # Subtle crisp cream-white comic keyline inside each black gutter so dark night panels still show dynamic slanted cuts!
        key2 = Image.new("RGBA", (pw * 2, ph * 2), (0, 0, 0, 0))
        dk = ImageDraw.Draw(key2)
        dk.polygon(local_pts2, outline=(248, 244, 234, 230), width=max(4, int(round(gutter * 0.24))))
        panel_layer.alpha_composite(key2.resize((pw, ph), Image.LANCZOS))

        canvas.alpha_composite(panel_layer, (x0, y0))

    # Crisp outer black frame so outer edges match gutter thickness
    d_out = ImageDraw.Draw(canvas)
    b = int(round(border))
    d_out.rectangle([0, 0, W - 1, H - 1], outline=(8, 8, 12, 255), width=b)
    d_out.rectangle([b, b, W - 1 - b, H - 1 - b], outline=(248, 244, 234, 225), width=max(2, int(round(gutter * 0.12))))
    return canvas


def build_gta_cover(mode: str) -> Image.Image:
    f_inter = ensure_clip_frame("s07_interchange")
    f_bridge = ensure_clip_frame("s06_bridge")
    f_twilight = os.path.join(COVER_DIR, "master_twilight_16x9.png")
    f_twilight_p = os.path.join(COVER_DIR, "master_twilight_3x4.png")
    f_sunset = os.path.join(COVER_DIR, "master_sunset_16x9.png")
    f_trees = ensure_clip_frame("s09_trees")
    f_jingan = ensure_clip_frame("s10b_jingan")
    f_drive = ensure_clip_frame("s12_drive")
    f_bund = ensure_clip_frame("s11_bund")
    f_rain = ensure_clip_frame("s14a_umbrellas")

    if mode == "landscape":
        W, H = 3840, 2160
        # 9 dynamic slanted polygons:
        # Row 1-2 split line: y(x) = 745 - 50 * (x / W)   (745 on left -> 695 on right)
        # Row 2-3 split line: y(x) = 1415 + 55 * (x / W)  (1415 on left -> 1470 on right)
        y1 = lambda x: 745.0 - 50.0 * (x / W)
        y2 = lambda x: 1415.0 + 55.0 * (x / W)

        r1_a0, r1_a1 = 1260.0, 1190.0
        r1_b0, r1_b1 = 2390.0, 2460.0
        r2_a0, r2_a1 = 1060.0, 1130.0
        r2_b0, r2_b1 = 2760.0, 2690.0
        r3_a0, r3_a1 = 1360.0, 1290.0
        r3_b0, r3_b1 = 2590.0, 2660.0

        M = 14.0  # outer inset base
        cells = [
            # Row 1: Helicopter Interchange | Nanpu Bridge Cables | Lujiazui Neon Skyline (Hero!)
            ([(M, M), (r1_a0, M), (r1_a1, y1(r1_a1)), (M, y1(M))], f_inter, "warm", (0.5, 0.5)),
            ([(r1_a0, M), (r1_b0, M), (r1_b1, y1(r1_b1)), (r1_a1, y1(r1_a1))], f_bridge, "warm", (0.48, 0.45)),
            ([(r1_b0, M), (W - M, M), (W - M, y1(W - M)), (r1_b1, y1(r1_b1))], f_twilight, "night", (0.66, 0.42)),
            # Row 2: Plane Trees Boulevard | Blazing Golden Sunset (under logo) | Jing'an Golden Roofs
            ([(M, y1(M)), (r2_a0, y1(r2_a0)), (r2_a1, y2(r2_a1)), (M, y2(M))], f_trees, "warm", (0.55, 0.5)),
            ([(r2_a0, y1(r2_a0)), (r2_b0, y1(r2_b0)), (r2_b1, y2(r2_b1)), (r2_a1, y2(r2_a1))], f_sunset, "sunset", (0.5, 0.45)),
            ([(r2_b0, y1(r2_b0)), (W - M, y1(W - M)), (W - M, y2(W - M)), (r2_b1, y2(r2_b1))], f_jingan, "sunset", (0.58, 0.52)),
            # Row 3: Yan'an Elevated Driving | The Bund Heritage Frontage | Nanjing Rd Rainy Umbrellas
            ([(M, y2(M)), (r3_a0, y2(r3_a0)), (r3_a1, H - M), (M, H - M)], f_drive, "sunset", (0.5, 0.58)),
            ([(r3_a0, y2(r3_a0)), (r3_b0, y2(r3_b0)), (r3_b1, H - M), (r3_a1, H - M)], f_bund, "sunset", (0.52, 0.50)),
            ([(r3_b0, y2(r3_b0)), (W - M, y2(W - M)), (W - M, H - M), (r3_b1, H - M)], f_rain, "rain", (0.52, 0.55)),
        ]
        canvas = draw_slanted_grid(W, H, cells, border=26, gutter=28)

        # Localized radial dark cushion ONLY under center logo + bottom hook (keeps outer panels 100% vivid!)
        yy, xx = np.mgrid[0:H:4, 0:W:4].astype(np.float32)
        r_logo = np.hypot((xx - W * 0.50) / (W * 0.25), (yy - H * 0.46) / (H * 0.34))
        a_logo = np.clip(1.0 - r_logo, 0.0, 1.0) ** 1.45 * 0.58
        r_hook = np.hypot((xx - W * 0.50) / (W * 0.32), (yy - H * 0.91) / (H * 0.14))
        a_hook = np.clip(1.0 - r_hook, 0.0, 1.0) ** 1.35 * 0.65
        cushion_a = Image.fromarray((np.clip(a_logo + a_hook, 0.0, 0.72) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
        cushion = Image.new("RGBA", (W, H), (6, 6, 12, 0))
        cushion.putalpha(cushion_a)
        canvas.alpha_composite(cushion)

        # Center GTA Logo
        lg = make_gta_logo(scale=0.92)
        paste_centered(canvas, lg, W * 0.50, H * 0.445)

        # High-CTR Hook Headline below logo (safe from bottom-right 03:26 duration pill!)
        hook = outlined_text(
            "100万栋真实建筑 · 打开浏览器即玩",
            cjk_black(86),
            (255, 255, 255, 255),
            (0, 0, 0, 255),
            12,
            shadow=7,
        )
        paste_centered(canvas, hook, W * 0.50, H - 178)

        url_im = outlined_text(
            "shanghai.smartdeng.com",
            pricedown(96),
            (255, 214, 72, 255),
            (0, 0, 0, 255),
            9,
            shadow=5,
        )
        paste_centered(canvas, url_im, W * 0.50, H - 76)

        # Top-Left "沪★" Studio Badge & Bottom-Left "E 人人可逛" Rating Badge
        hu_badge = make_hu_star_badge(210)
        canvas.alpha_composite(hu_badge, (66, 62))
        rating = make_rating_badge(300)
        canvas.alpha_composite(rating, (66, H - 62 - rating.size[1]))

        return canvas.convert("RGB")

    else:
        # 3:4 Portrait Game-Box Art (2160 x 2880) — authentic GTA physical box-art proportions!
        W, H = 2160, 2880
        y1 = lambda x: 730.0 - 42.0 * (x / W)
        y2 = lambda x: 1435.0 + 44.0 * (x / W)
        y3 = lambda x: 2150.0 - 38.0 * (x / W)

        M = 14.0
        s1_0, s1_1 = 980.0, 920.0
        s2_0, s2_1 = 1140.0, 1205.0
        s3_0, s3_1 = 1090.0, 1025.0
        s4_0, s4_1 = 1040.0, 1105.0

        cells = [
            # Row 1: Helicopter Interchange (Top-Left!) | Lujiazui Neon Quartet (Top-Right Hero!)
            ([(M, M), (s1_0, M), (s1_1, y1(s1_1)), (M, y1(M))], f_inter, "warm", (0.5, 0.5)),
            ([(s1_0, M), (W - M, M), (W - M, y1(W - M)), (s1_1, y1(s1_1))], f_twilight_p, "night", (0.52, 0.45)),
            # Row 2: Plane Trees Boulevard | Nanpu Bridge Cables
            ([(M, y1(M)), (s2_0, y1(s2_0)), (s2_1, y2(s2_1)), (M, y2(M))], f_trees, "warm", (0.56, 0.5)),
            ([(s2_0, y1(s2_0)), (W - M, y1(W - M)), (W - M, y2(W - M)), (s2_1, y2(s2_1))], f_bridge, "warm", (0.42, 0.48)),
            # Row 3: Yan'an Elevated Driving | Jing'an Golden Temple
            ([(M, y2(M)), (s3_0, y2(s3_0)), (s3_1, y3(s3_1)), (M, y3(M))], f_drive, "sunset", (0.5, 0.58)),
            ([(s3_0, y2(s3_0)), (W - M, y2(W - M)), (W - M, y3(W - M)), (s3_1, y3(s3_1))], f_jingan, "sunset", (0.58, 0.52)),
            # Row 4: The Bund Heritage Frontage | Nanjing Rd Rainy Umbrellas
            ([(M, y3(M)), (s4_0, y3(s4_0)), (s4_1, H - M), (M, H - M)], f_bund, "sunset", (0.52, 0.48)),
            ([(s4_0, y3(s4_0)), (W - M, y3(W - M)), (W - M, H - M), (s4_1, H - M)], f_rain, "rain", (0.52, 0.55)),
        ]
        canvas = draw_slanted_grid(W, H, cells, border=24, gutter=26)

        # Localized radial cushion behind central logo + bottom bar
        yy, xx = np.mgrid[0:H:4, 0:W:4].astype(np.float32)
        r_logo = np.hypot((xx - W * 0.50) / (W * 0.40), (yy - H * 0.46) / (H * 0.22))
        a_logo = np.clip(1.0 - r_logo, 0.0, 1.0) ** 1.45 * 0.58
        r_hook = np.hypot((xx - W * 0.50) / (W * 0.44), (yy - H * 0.90) / (H * 0.12))
        a_hook = np.clip(1.0 - r_hook, 0.0, 1.0) ** 1.35 * 0.68
        cushion_a = Image.fromarray((np.clip(a_logo + a_hook, 0.0, 0.74) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
        cushion = Image.new("RGBA", (W, H), (6, 6, 12, 0))
        cushion.putalpha(cushion_a)
        canvas.alpha_composite(cushion)

        # Center GTA Box-Art Logo
        lg = make_gta_logo(scale=0.80)
        paste_centered(canvas, lg, W * 0.50, H * 0.46)

        # Bottom Game-Box Hook + URL + Official-style Corner Badges (just like physical GTA box art!)
        hook1 = outlined_text(
            "100万栋真实建筑",
            cjk_black(80),
            (255, 255, 255, 255),
            (0, 0, 0, 255),
            12,
            shadow=6,
        )
        hook2 = outlined_text(
            "打开浏览器即玩",
            cjk_black(76),
            (255, 218, 76, 255),
            (0, 0, 0, 255),
            11,
            shadow=6,
        )
        url_im = outlined_text(
            "shanghai.smartdeng.com",
            pricedown(82),
            (255, 255, 255, 255),
            (0, 0, 0, 255),
            8,
            shadow=5,
        )
        paste_centered(canvas, hook1, W * 0.50, H - 310)
        paste_centered(canvas, hook2, W * 0.50, H - 208)
        paste_centered(canvas, url_im, W * 0.50, H - 102)

        # Bottom-Left [E 人人可逛] & Bottom-Right [沪★] — classic Rockstar physical box-art symmetry!
        rating = make_rating_badge(280)
        canvas.alpha_composite(rating, (56, H - 56 - rating.size[1]))
        hu_badge = make_hu_star_badge(205)
        canvas.alpha_composite(hu_badge, (W - 56 - hu_badge.size[0], H - 56 - hu_badge.size[1]))

        return canvas.convert("RGB")


def main():
    # 1. Cinematic Real-Time Render Covers
    c16 = build_cinematic_cover(os.path.join(COVER_DIR, "master_twilight_16x9.png"), "landscape")
    save_pair(c16, os.path.join(VIDEO, "cover_16x9_hd.jpg"), os.path.join(VIDEO, "cover_16x9.jpg"))

    c34 = build_cinematic_cover(os.path.join(COVER_DIR, "master_twilight_3x4.png"), "portrait")
    save_pair(c34, os.path.join(VIDEO, "cover_3x4_hd.jpg"), os.path.join(VIDEO, "cover_3x4.jpg"))

    # 2. GTA Parody Box-Art Covers
    g16 = build_gta_cover("landscape")
    save_pair(g16, os.path.join(VIDEO, "cover_gta_16x9_hd.jpg"), os.path.join(VIDEO, "cover_gta_16x9.jpg"))

    g34 = build_gta_cover("portrait")
    save_pair(g34, os.path.join(VIDEO, "cover_gta_3x4_hd.jpg"), os.path.join(VIDEO, "cover_gta_3x4.jpg"))


if __name__ == "__main__":
    main()
