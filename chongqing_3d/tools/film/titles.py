"""Clean bilingual titles & architectural lower-thirds for Chongqing 3D (1920x1080 RGBA PNGs).

Uses strictly open SIL OFL fonts (Source Han Serif CN & IBM Plex Sans SC — zero proprietary
or trademarked fonts!).

Usage:
  python3 tools/film/titles.py video/titles
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "video/titles"
os.makedirs(OUT, exist_ok=True)

W, H = 1920, 1080
SERIF_H = "/usr/share/fonts/adobe-source-han-serif/SourceHanSerifCN-Heavy.otf"
SERIF_B = "/usr/share/fonts/adobe-source-han-serif/SourceHanSerifCN-Bold.otf"
SERIF_M = "/usr/share/fonts/adobe-source-han-serif/SourceHanSerifCN-Medium.otf"
SANS_SB = "/usr/share/fonts/TTF/IBMPlexSansSC-SemiBold.ttf"
SANS_L  = "/usr/share/fonts/TTF/IBMPlexSansSC-Light.ttf"

INK = (252, 248, 240)
GOLD = (248, 210, 132)
SUB = (232, 228, 218)
RED = (186, 38, 30)


def canvas():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def shadowed(layer, blur=14, strength=0.62, spread=1):
    a = layer.split()[3]
    halo = a.filter(ImageFilter.MaxFilter(spread * 2 + 1)).filter(ImageFilter.GaussianBlur(blur)).point(
        lambda v: int(min(255, v * strength * 1.55))
    )
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    out.putalpha(halo)
    return Image.alpha_composite(out, layer)


def spaced(d, xy, text, font, fill, track=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + track
    return x - xy[0] - track


def text_w(d, text, font, track=0):
    if not text:
        return 0
    return sum(d.textlength(ch, font=font) for ch in text) + track * (len(text) - 1)


def draw_seal(im, cx, cy, size, char="渝"):
    s = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=max(6, size // 10), fill=RED + (242,))
    d.rounded_rectangle(
        [5, 5, size - 6, size - 6],
        radius=max(4, size // 14),
        outline=(252, 234, 214, 185),
        width=2,
    )
    f = ImageFont.truetype(SERIF_B, int(size * 0.66))
    bb = d.textbbox((0, 0), char, font=f)
    d.text(
        ((size - (bb[2] - bb[0])) / 2 - bb[0], (size - (bb[3] - bb[1])) / 2 - bb[1]),
        char,
        font=f,
        fill=(254, 246, 236, 255),
    )
    im.alpha_composite(s, (int(cx - size / 2), int(cy - size / 2)))


def lower_third(name, zh, en, side="left"):
    """Minimal, cinema-grade bilingual lower-third tucked neatly in the lower corner."""
    im = canvas()
    d = ImageDraw.Draw(im)
    f_zh = ImageFont.truetype(SERIF_B, 42)
    f_en = ImageFont.truetype(SANS_L, 21)

    y_zh = H - 142
    y_en = H - 88
    bar_w = 5

    if side == "left":
        x0 = 96
        d.rounded_rectangle([x0 - 20, y_zh + 4, x0 - 20 + bar_w, y_en + 26], radius=2, fill=GOLD + (235,))
        spaced(d, (x0, y_zh), zh, f_zh, INK + (252,), track=4)
        spaced(d, (x0 + 2, y_en), en, f_en, SUB + (225,), track=2)
    else:
        w_zh = text_w(d, zh, f_zh, track=4)
        w_en = text_w(d, en, f_en, track=2)
        x_r = W - 96
        d.rounded_rectangle([x_r + 15, y_zh + 4, x_r + 15 + bar_w, y_en + 26], radius=2, fill=GOLD + (235,))
        spaced(d, (x_r - w_zh, y_zh), zh, f_zh, INK + (252,), track=4)
        spaced(d, (x_r - w_en, y_en), en, f_en, SUB + (225,), track=2)

    shadowed(im, blur=12, strength=0.68, spread=1).save(os.path.join(OUT, name + ".png"))


# 1. Opening Title Card (upper-left clean golden sky space over Chaotianmen & Raffles)
im = canvas()
d = ImageDraw.Draw(im)
f_big = ImageFont.truetype(SERIF_H, 168)
f_sub = ImageFont.truetype(SERIF_M, 38)
f_en  = ImageFont.truetype(SANS_L, 22)
x0, y0 = 112, 136
spaced(d, (x0, y0), "重庆", f_big, INK + (255,), track=18)
draw_seal(im, x0 + 412, y0 + 132, 74, "渝")
spaced(d, (x0 + 6, y0 + 218), "一座可以走进去的 8D 魔幻山城", f_sub, GOLD + (248,), track=7)
spaced(d, (x0 + 8, y0 + 278), "CHONGQING 3D  ·  REAL-TIME WEBGL2 MOUNTAIN CITY", f_en, SUB + (225,), track=3)
shadowed(im, blur=18, strength=0.58, spread=1).save(os.path.join(OUT, "title.png"))

# 2. Subtle Location Lower-Thirds
lower_third("lt_street",     "山城街巷 · 真实建筑肌理",  "HILLSIDE STREET  ·  3D BALCONIES, SHOPFRONTS & RETAINING WALLS", "left")
lower_third("lt_jiefangbei", "解放碑 · 渝中天际线",      "JIEFANGBEI CBD  ·  WFC & GUOTAI ARTS CENTER", "right")
lower_third("lt_qiansimen",  "千厮门嘉陵江大桥",         "QIANSIMEN CABLE-STAYED BRIDGE  ·  JIALING RIVER", "left")
lower_third("lt_liziba",     "李子坝轻轨穿楼",           "LIZIBA CRT LINE 2  ·  MONORAIL THROUGH 19-STORY TOWER", "left")
lower_third("lt_cableway",   "长江索道 · 空中走廊",      "YANGTZE RIVER CABLEWAY  ·  1,175 M SPAN", "right")
lower_third("lt_infra",      "8D 立体交通 · 立交与穿山隧道", "SUJIABA 72 M SPIRAL OVERPASS & 904 MOUNTAIN TUNNEL PORTALS", "left")
lower_third("lt_dusk",       "人民大礼堂 · 重庆大剧院",   "GREAT HALL OF THE PEOPLE  &  CHONGQING GRAND THEATRE", "right")
lower_third("lt_hongyadong", "洪崖洞 · 十一层吊脚楼夜景", "HONGYADONG  ·  11-TIER CLIFFSIDE DIAOJIAOLOU AT NIGHT", "left")
lower_third("lt_rain",       "雨夜山城",                 "RAINY CYBER-CHONGQING  ·  WET PAVEMENT REFLECTIONS", "right")

# 3. Clean End Title Card (centered over dimmed Nanshan Yikeshu Cyber-Night panorama)
im = canvas()
d = ImageDraw.Draw(im)
f_end_big = ImageFont.truetype(SERIF_H, 128)
f_end_sub = ImageFont.truetype(SERIF_M, 36)
f_end_stat = ImageFont.truetype(SANS_SB, 24)
f_end_url = ImageFont.truetype(SANS_L, 26)

title_end = "重庆 · 8D山城 3D"
w_main = text_w(d, title_end, f_end_big, track=12)
y_end = 330
x_main = (W - w_main) / 2 - 42
spaced(d, (x_main, y_end), title_end, f_end_big, INK + (255,), track=12)
draw_seal(im, x_main + w_main + 64, y_end + 86, 68, "渝")

sub_line = "528 平方公里真实地形  ·  14.1 万栋建筑  ·  91 万棵树  ·  904 座穿山隧道"
w_sub = text_w(d, sub_line, f_end_stat, track=3)
spaced(d, ((W - w_sub) / 2, y_end + 178), sub_line, f_end_stat, GOLD + (248,), track=3)

tag_line = "打开浏览器，走进真实的 3D 重庆"
w_tag = text_w(d, tag_line, f_end_sub, track=8)
spaced(d, ((W - w_tag) / 2, y_end + 236), tag_line, f_end_sub, INK + (242,), track=8)

# Subtle horizontal hairline divider
d.line([(W * 0.34, y_end + 314), (W * 0.66, y_end + 314)], fill=GOLD + (140,), width=2)

url_line = "github.com/mawwalker/3d_city"
w_url = text_w(d, url_line, f_end_url, track=4)
spaced(d, ((W - w_url) / 2, y_end + 340), url_line, f_end_url, SUB + (245,), track=4)

shadowed(im, blur=18, strength=0.62, spread=1).save(os.path.join(OUT, "end.png"))
print(f"titles written to {OUT}: {', '.join(sorted(os.listdir(OUT)))}")
