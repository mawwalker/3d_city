"""Video cover: a rendered still with a red seal and a vertical serif title (the site's own label style).

usage: cover.py <still.png> <out.jpg> [landscape|portrait]
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC, OUT = sys.argv[1:3]
MODE = sys.argv[3] if len(sys.argv) > 3 else "landscape"
FD = "/usr/share/fonts/adobe-source-han-serif/SourceHanSerifCN-"
img = Image.open(SRC).convert("RGB")
W, H = img.size
u = W / 3840 if MODE == "landscape" else W / 2160          # layout unit scale

# ---- shade the title side so white type reads over the city
y, x = np.mgrid[0:H, 0:W].astype(np.float32)
if MODE == "landscape":
    a = np.clip(1 - x / (W * 0.42), 0, 1) ** 1.7 * 0.66 + np.clip((y - H * 0.78) / (H * 0.22), 0, 1) ** 1.5 * 0.40
else:
    a = np.clip(1 - np.hypot(x / (W * 0.80), y / (H * 0.56)), 0, 1) ** 1.4 * 0.70 + np.clip((y - H * 0.86) / (H * 0.14), 0, 1) ** 1.5 * 0.45
a = np.clip(a, 0, 0.78)
base = np.asarray(img).astype(np.float32)
shade = np.array([14, 10, 8], np.float32)
img = Image.fromarray((base * (1 - a[..., None]) + shade * a[..., None]).astype(np.uint8))

layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
d = ImageDraw.Draw(layer)


def vertical(text, font, x0, y0, step, fill):
    for i, ch in enumerate(text):
        bb = d.textbbox((0, 0), ch, font=font)
        cw = bb[2] - bb[0]
        d.text((x0 - cw / 2 - bb[0], y0 + i * step - bb[1]), ch, font=font, fill=fill)
    return y0 + len(text) * step


heavy = lambda s: ImageFont.truetype(FD + "Heavy.otf", int(s * u))
semi = lambda s: ImageFont.truetype(FD + "SemiBold.otf", int(s * u))
reg = lambda s: ImageFont.truetype(FD + "Regular.otf", int(s * u))

if MODE == "landscape":
    cx, top = 420 * u, 250 * u
    big, sub = 360, 92
    sub_x, sub_y = 760 * u, 560 * u
else:
    cx, top = 400 * u, 230 * u
    big, sub = 380, 96
    sub_x, sub_y = 760 * u, 560 * u

# red seal with 京, the site's masthead mark
s = 190 * u
sx, sy = cx - s / 2, top
d.rounded_rectangle((sx, sy, sx + s, sy + s), radius=10 * u, fill=(178, 38, 30, 245))
d.rounded_rectangle((sx + 9 * u, sy + 9 * u, sx + s - 9 * u, sy + s - 9 * u), radius=6 * u, outline=(245, 220, 200, 160), width=max(2, int(3 * u)))
f = semi(132)
bb = d.textbbox((0, 0), "京", font=f)
d.text((sx + (s - (bb[2] - bb[0])) / 2 - bb[0], sy + (s - (bb[3] - bb[1])) / 2 - bb[1]), "京", font=f, fill=(250, 238, 222, 255))

# title: 北京 large, then the subtitle in a second, lower column (read right to left like an inscription)
end = vertical("北京", heavy(big), cx, top + s + 70 * u, big * 1.04 * u, (250, 244, 232, 255))
vertical("五环之内", semi(sub * 1.25), sub_x, sub_y, sub * 1.38 * u, (250, 244, 232, 245))
vertical("的三维城市", reg(sub * 0.82), sub_x + 165 * u, sub_y + sub * 1.38 * u * 1.5, sub * 1.05 * u, (240, 232, 218, 225))

# footer
if MODE == "landscape":
    d.text((cx - 95 * u, H - 250 * u), "近百万栋真实建筑，在浏览器里漫游", font=reg(64), fill=(244, 236, 222, 235))
    f = reg(56); t = "beijing.smartdeng.com"; bb = d.textbbox((0, 0), t, font=f)
    d.text((W - 200 * u - (bb[2] - bb[0]), H - 244 * u), t, font=f, fill=(244, 236, 222, 220))
else:
    d.text((cx - 95 * u, H - 330 * u), "近百万栋真实建筑", font=reg(76), fill=(244, 236, 222, 235))
    d.text((cx - 95 * u, H - 220 * u), "在浏览器里漫游", font=reg(76), fill=(244, 236, 222, 235))
    f = reg(58); t = "beijing.smartdeng.com"; bb = d.textbbox((0, 0), t, font=f)
    d.text((W - 160 * u - (bb[2] - bb[0]), H - 210 * u), t, font=f, fill=(244, 236, 222, 215))

# soft drop shadow under all type
sh = layer.split()[3].filter(ImageFilter.GaussianBlur(10 * u))
shadow = Image.new("RGBA", img.size, (0, 0, 0, 0)); shadow.putalpha(sh.point(lambda v: int(v * 0.45)))
out = img.convert("RGBA")
out.alpha_composite(shadow, (int(2 * u), int(5 * u)))
out.alpha_composite(layer)
out = out.convert("RGB")
out.save(OUT, quality=93, subsampling=0)
small = out.resize((out.width // 2, out.height // 2), Image.LANCZOS)
small.save(OUT.replace(".jpg", "_small.jpg"), quality=90)
print(OUT, out.size, "and", small.size)
