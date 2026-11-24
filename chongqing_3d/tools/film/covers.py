"""Generate unified, museum-grade 1600x900 GitHub README cover posters for all 3 cities:
  - 3d_city/docs/covers/chongqing_cover.jpg  (渝 · 重庆 · 8D魔幻山城)
  - 3d_city/docs/covers/shanghai_cover.jpg   (沪 · 上海 · 三维魔都)
  - 3d_city/docs/covers/beijing_cover.jpg    (京 · 北京 · 五环之内)

Uses strictly SIL OFL fonts (Source Han Serif CN & IBM Plex Sans SC). Zero proprietary fonts
or third-party trademarks.

Usage:
  python3 tools/film/covers.py <chongqing_raw.png> [out_dir]
"""

import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FD_SERIF = "/usr/share/fonts/adobe-source-han-serif/SourceHanSerifCN-"
OUT_W, OUT_H = 1600, 900


def grade_cinematic(img: Image.Image, mood: str = "twilight") -> Image.Image:
    """Subtle filmic contrast, highlight roll-off, and warm city-light bloom."""
    rgb = np.asarray(img).astype(np.float32) / 255.0
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

    if mood == "twilight":
        shadow_w = np.clip(1.0 - lum / 0.50, 0.0, 1.0) ** 1.4
        warm_w = np.clip((rgb[..., 0] - rgb[..., 2] + 0.06) * 2.6, 0.0, 1.0) * np.clip(lum * 2.2, 0.0, 1.0)
        g = np.empty_like(rgb)
        g[..., 0] = rgb[..., 0] * (1.0 - 0.10 * shadow_w + 0.13 * warm_w)
        g[..., 1] = rgb[..., 1] * (1.0 - 0.06 * shadow_w + 0.05 * warm_w)
        g[..., 2] = rgb[..., 2] * (1.0 + 0.14 * shadow_w - 0.03 * warm_w)
        g = np.clip((g - 0.36) * 1.13 + 0.37, 0.0, 1.0)
        g = g / (1.0 + 0.14 * (g ** 3)) * 1.09
    elif mood == "night":
        warm_w = np.clip((rgb[..., 0] - rgb[..., 2] + 0.08) * 2.2, 0.0, 1.0) * np.clip(lum * 2.4, 0.0, 1.0)
        g = np.empty_like(rgb)
        g[..., 0] = rgb[..., 0] * (1.0 + 0.09 * warm_w)
        g[..., 1] = rgb[..., 1] * (1.0 + 0.03 * warm_w)
        g[..., 2] = rgb[..., 2] * (1.0 + 0.04 * (1.0 - warm_w))
        g = np.clip((g - 0.30) * 1.08 + 0.31, 0.0, 1.0)
    else:  # warm golden day (Beijing)
        g = np.clip((rgb - 0.42) * 1.06 + 0.43, 0.0, 1.0)

    g = np.clip(g, 0.0, 1.0)

    # Soft photographic halation on bright city lights (PIL blur -> zero OpenCV dependency)
    if mood in ("twilight", "night"):
        bright = np.clip((g - 0.62) / 0.38, 0.0, 1.0) ** 1.5
        b_im = Image.fromarray((bright * 255.0).astype(np.uint8))
        b1 = np.asarray(b_im.filter(ImageFilter.GaussianBlur(radius=6)), dtype=np.float32) / 255.0
        b2 = np.asarray(b_im.filter(ImageFilter.GaussianBlur(radius=18)), dtype=np.float32) / 255.0
        tint = np.array([1.08, 0.92, 0.80], dtype=np.float32)
        bloom = (b1 * 0.20 + b2 * 0.14) * tint[None, None, :]
        g = 1.0 - (1.0 - g) * np.clip(1.0 - bloom, 0.0, 1.0)

    out = Image.fromarray(np.clip(g * 255.0, 0, 255).astype(np.uint8))
    # Subtle micro-sharpen at output size
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=65, threshold=3))


def vertical_type(draw: ImageDraw.ImageDraw, text, fnt, x0: float, y0: float, step: float, fill):
    items = list(text) if isinstance(text, str) else text
    for i, ch in enumerate(items):
        bb = draw.textbbox((0, 0), ch, font=fnt)
        cw = bb[2] - bb[0]
        draw.text((x0 - cw / 2.0 - bb[0], y0 + i * step - bb[1]), ch, font=fnt, fill=fill)
    return y0 + len(items) * step


def make_poster(src_path: str, out_path: str, *, seal_char: str, title: str,
                sub1: str, sub2: str, hook1: str, hook2: str,
                mood: str = "twilight", scrim_rgb=(10, 11, 24)):
    raw = Image.open(src_path).convert("RGB")
    if raw.size != (OUT_W, OUT_H):
        raw = raw.resize((OUT_W, OUT_H), Image.LANCZOS)
    W, H = raw.size
    u = W / 3840.0  # identical layout proportions to 4K master

    img = grade_cinematic(raw, mood=mood)
    base = np.asarray(img).astype(np.float32) / 255.0

    # Directional velvet scrim strictly under left calligraphy & bottom hook bar
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    left_scrim = (
        np.clip(1.0 - x / (W * 0.37), 0.0, 1.0) ** 1.65
        * np.clip(1.0 - (y - H * 0.56) / (H * 0.36), 0.30, 1.0)
        * 0.66
    )
    bot_scrim = (
        np.clip((y - H * 0.74) / (H * 0.26), 0.0, 1.0) ** 1.45
        * np.clip(1.0 - (x - W * 0.54) / (W * 0.34), 0.0, 1.0)
        * 0.70
    )
    a = np.clip(left_scrim + bot_scrim, 0.0, 0.76)
    shade = np.array([scrim_rgb[0] / 255.0, scrim_rgb[1] / 255.0, scrim_rgb[2] / 255.0], dtype=np.float32)
    comp = (base * (1.0 - a[..., None]) + shade * a[..., None]) * 255.0
    img = Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8))

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    heavy = lambda s: ImageFont.truetype(FD_SERIF + "Heavy.otf", max(10, int(round(s * u))))
    bold = lambda s: ImageFont.truetype(FD_SERIF + "Bold.otf", max(10, int(round(s * u))))
    semi = lambda s: ImageFont.truetype(FD_SERIF + "SemiBold.otf", max(10, int(round(s * u))))
    med = lambda s: ImageFont.truetype(FD_SERIF + "Medium.otf", max(10, int(round(s * u))))

    cx, top = 365 * u, 165 * u
    seal_s = 172 * u
    big_sz, sub1_sz, sub2_sz = 345, 98, 76
    sub1_x, sub1_y = 690 * u, 415 * u
    sub2_x, sub2_y = 845 * u, 540 * u

    # 1. Vermilion Cinnabar Seal
    sx, sy = cx - seal_s / 2.0, top
    d.rounded_rectangle((sx, sy, sx + seal_s, sy + seal_s), radius=12 * u, fill=(188, 38, 30, 248))
    d.rounded_rectangle(
        (sx + 9 * u, sy + 9 * u, sx + seal_s - 9 * u, sy + seal_s - 9 * u),
        radius=7 * u,
        outline=(252, 232, 212, 185),
        width=max(2, int(round(3.4 * u))),
    )
    f_seal = bold(118)
    bb = d.textbbox((0, 0), seal_char, font=f_seal)
    d.text(
        (sx + (seal_s - (bb[2] - bb[0])) / 2.0 - bb[0], sy + (seal_s - (bb[3] - bb[1])) / 2.0 - bb[1]),
        seal_char,
        font=f_seal,
        fill=(254, 244, 230, 255),
    )

    # 2. Monumental Vertical Title + Twin Subtitle Columns
    vertical_type(d, title, heavy(big_sz), cx, top + seal_s + 56 * u, big_sz * 1.04 * u, (254, 248, 238, 255))
    vertical_type(d, sub1, bold(sub1_sz), sub1_x, sub1_y, sub1_sz * 1.25 * u, (252, 214, 136, 252))
    vertical_type(d, sub2, med(sub2_sz), sub2_x, sub2_y, sub2_sz * 1.22 * u, (246, 238, 226, 240))

    # 3. Bottom-Left Hook Bar (clean open-source GitHub repo credit)
    fx = cx - 105 * u
    fy1 = H - 256 * u
    fy2 = H - 146 * u
    d.rounded_rectangle((fx - 32 * u, fy1 + 8 * u, fx - 21 * u, fy2 + 60 * u), radius=4 * u, fill=(250, 204, 116, 245))
    d.text((fx, fy1), hook1, font=bold(72), fill=(254, 248, 238, 252))
    d.text((fx, fy2), hook2, font=semi(50), fill=(250, 216, 146, 242))

    # Dual drop-shadow for crisp contrast at thumbnail and full-HD size
    alpha = layer.split()[3]
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    halo.putalpha(alpha.filter(ImageFilter.GaussianBlur(18 * u)).point(lambda v: int(min(255, v * 0.58))))
    tight = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tight.putalpha(alpha.filter(ImageFilter.GaussianBlur(4.5 * u)).point(lambda v: int(min(255, v * 0.68))))

    out = img.convert("RGBA")
    out.alpha_composite(halo, (0, int(round(4 * u))))
    out.alpha_composite(tight, (int(round(2 * u)), int(round(5 * u))))
    out.alpha_composite(layer)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    out.convert("RGB").save(out_path, quality=92, subsampling=0)
    kb = os.path.getsize(out_path) / 1024.0
    print(f"wrote {out_path} ({W}x{H}, {kb:.0f} KB)")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    cq_root = os.path.abspath(os.path.join(here, "..", ".."))
    parent_root = os.path.abspath(os.path.join(cq_root, ".."))
    cq_raw = sys.argv[1] if len(sys.argv) > 1 else os.path.join(cq_root, "video", "cover_cand_a.png")
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(parent_root, "docs", "covers")
    cq_mood = sys.argv[3] if len(sys.argv) > 3 else "twilight"

    make_poster(
        cq_raw,
        os.path.join(out_dir, "chongqing_cover.jpg"),
        seal_char="渝",
        title="重庆",
        sub1="可以走进去",
        sub2=["的", "8D", "魔", "幻", "山", "城"],
        hook1="528 km² 真实山地 · 14.1 万栋 3D 建筑 · 904 座隧道",
        hook2="洪崖洞 · 来福士 · 李子坝穿楼 · github.com/mawwalker/3d_city",
        mood=cq_mood,
        scrim_rgb=(10, 12, 24),
    )

    sh_raw = os.path.join(parent_root, "shanghai_3d", "video", "cover", "master_twilight_16x9.png")
    if os.path.exists(sh_raw):
        make_poster(
            sh_raw,
            os.path.join(out_dir, "shanghai_cover.jpg"),
            seal_char="沪",
            title="上海",
            sub1="可以走进去",
            sub2="的三维魔都",
            hook1="100 万栋真实建筑 · 317 万棵树 · 装进浏览器",
            hook2="高空俯瞰与第一人称街头漫游 · github.com/mawwalker/3d_city",
            mood="twilight",
            scrim_rgb=(10, 11, 24),
        )

    bj_raw = os.path.join(parent_root, "beijing_3d", "video", "cover", "b_1.png")
    if os.path.exists(bj_raw):
        make_poster(
            bj_raw,
            os.path.join(out_dir, "beijing_cover.jpg"),
            seal_char="京",
            title="北京",
            sub1="五环之内",
            sub2="的三维城市",
            hook1="98 万栋真实建筑 · 故宫中轴线与西山地形",
            hook2="实时 WebGL 2 全景漫游 · github.com/mawwalker/3d_city",
            mood="day",
            scrim_rgb=(14, 10, 8),
        )


if __name__ == "__main__":
    main()
