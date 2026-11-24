"""The film's lettering, as transparent 3840x2160 pictures (the picture itself is 3840x1634 between two black bars).

The title in a brush hand (Ma Shan Zheng), the lines in ZCOOL XiaoWei set upright as on a scroll, a seal in vermilion; the
credits small, in IBM Plex Sans. All three are open fonts (SIL OFL).  usage: titles.py <out dir>
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
W, H, TOP, BOT = 3840, 2160, 263, 1897
F = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "video", "fonts")
BRUSH = os.path.join(F, "MaShanZheng-Regular.ttf"); SONG = os.path.join(F, "ZCOOLXiaoWei-Regular.ttf")
PLEX = "/usr/share/fonts/TTF/IBMPlexSansSC-Light.ttf"; PLEXT = "/usr/share/fonts/TTF/IBMPlexSansSC-ExtraLight.ttf"
INK = (250, 246, 238); RED = (176, 38, 30)


def canvas():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def shadowed(layer, blur=22, strength=0.55, spread=2):
    """The lettering over a soft dark halo of itself, so that it reads on a bright sky and on a dark street alike."""
    a = layer.split()[3]
    halo = a.filter(ImageFilter.MaxFilter(spread * 2 + 1)).filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(min(255, v * strength * 1.6)))
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    out.putalpha(halo)
    return Image.alpha_composite(out, layer)


def spaced(d, xy, text, font, fill, track):
    """Horizontal text with `track` pixels between the characters; returns the width."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + track
    return x - xy[0] - track


def width(d, text, font, track):
    return sum(d.textlength(ch, font=font) for ch in text) + track * (len(text) - 1)


def upright(d, x, y, text, font, fill, step):
    """Text set downwards, one character under the other (centred on x); returns the height."""
    for k, ch in enumerate(text):
        if ch == "，":
            d.text((x + font.size * 0.18, y + k * step - font.size * 0.42), "，", font=font, fill=fill); continue
        w = d.textlength(ch, font=font)
        d.text((x - w / 2, y + k * step), ch, font=font, fill=fill)
    return (len(text) - 1) * step + font.size


def seal(im, cx, cy, size, text, font_path):
    """A square seal: vermilion, the character left in the colour of the paper."""
    s = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 9, fill=RED + (235,))
    f = ImageFont.truetype(font_path, int(size * 0.74))
    bb = d.textbbox((0, 0), text, font=f)
    d.text(((size - (bb[2] - bb[0])) / 2 - bb[0], (size - (bb[3] - bb[1])) / 2 - bb[1]), text, font=f, fill=(250, 244, 232, 255))
    im.alpha_composite(s, (int(cx - size / 2), int(cy - size / 2)))


def caption(name, text, side, top=560, size=118, brush=False):
    """A line set upright near one edge of the picture, a hairline beside it and a small seal under it."""
    im = canvas(); d = ImageDraw.Draw(im)
    f = ImageFont.truetype(BRUSH if brush else SONG, size)
    step = int(size * (1.16 if brush else 1.34))
    x = 470 if side == "left" else W - 470
    h = upright(d, x, top, text, f, INK + (255,), step)
    lx = x + (size * 0.86 if side == "left" else -size * 0.86)
    d.line([(lx, top + 6), (lx, top + h - 2)], fill=INK + (150,), width=3)
    d.rounded_rectangle([x - 15, top + h + 46, x + 15, top + h + 76], radius=5, fill=RED + (235,))
    shadowed(im).save(os.path.join(OUT, name + ".png"))


# ---- the title: 上海, a line under it, a seal
im = canvas(); d = ImageDraw.Draw(im)
f = ImageFont.truetype(BRUSH, 560)
x0, y0 = 360, 520
d.text((x0, y0), "上", font=f, fill=INK + (255,)); d.text((x0 + 520, y0 + 10), "海", font=f, fill=INK + (255,))
seal(im, x0 + 1190, y0 + 500, 150, "沪", BRUSH)
f2 = ImageFont.truetype(SONG, 96)
spaced(d, (x0 + 34, y0 + 700), "一座可以走进去的城市", f2, INK + (245,), 44)
shadowed(im, blur=30, strength=0.5).save(os.path.join(OUT, "title.png"))

# ---- the lines
caption("t_area", "三千八百平方公里", "right", top=520)
caption("t_buildings", "一百万栋楼宇", "left", top=560)
caption("t_roads", "两万八千公里道路", "right", top=520)
caption("t_walk", "走进去", "left", top=640, size=250, brush=True)
caption("t_trees", "三百一十七万棵树", "right", top=500)
caption("t_rain", "有晴，也有雨", "left", top=520)
caption("t_lights", "华灯初上", "left", top=600)

# ---- the end: the name again, what it is, where its data comes from
im = canvas(); d = ImageDraw.Draw(im)
f = ImageFont.truetype(BRUSH, 430)
tw = 2 * 430 + 20
x0 = (W - tw) // 2 - 40; y0 = 640
d.text((x0, y0), "上", font=f, fill=INK + (255,)); d.text((x0 + 440, y0 + 8), "海", font=f, fill=INK + (255,))
seal(im, x0 + tw + 110, y0 + 380, 118, "沪", BRUSH)
f2 = ImageFont.truetype(SONG, 92)
line = "一座城，装进浏览器"
spaced(d, ((W - width(d, line, f2, 40)) / 2, y0 + 560), line, f2, INK + (245,), 40)
shadowed(im, blur=28, strength=0.5).save(os.path.join(OUT, "end.png"))
print("lettering written to", OUT, ":", ", ".join(sorted(os.listdir(OUT))))
