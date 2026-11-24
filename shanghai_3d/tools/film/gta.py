"""A parody opening and closing in the manner of the trailers of a well-known crime game series: "Grand Tour Auto 7 · 魔都"
(暇道览车手 7：魔都). Everything is drawn here: a parody studio ident (not the real one), a cover-art grid of comic panels made
from the film's own frames, the logo, a parody rating box; the URL of the site at the end, with a line saying that this is a
parody and has nothing to do with the real publisher.

  gta.py stills     a few stills of the intro and the outro to judge the look  -> shots/gta_*.jpg
  gta.py render     the intro (video/gta_intro.mp4, 12.5 s) and the outro (video/gta_outro.mp4, 10 s), 3840x2160, 30 fps

Fonts: Pricedown (Typodermic, free desktop licence: rendered audiovisual content allowed), Noto Sans CJK Black (SIL OFL).
"""
import sys, os, math, subprocess
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageChops

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
V = os.path.join(ROOT, "video")
W, H, FPS = 3840, 2160, 30
PRICE = os.path.join(V, "fonts", "Pricedown Bl.otf")
BLACK = "/usr/share/fonts/noto-cjk/NotoSansCJK-Black.ttc"           # index 2: SC
YELLOW = (252, 175, 23)
URL = "shanghai.smartdeng.com"
INTRO_S, OUTRO_S = 12.5, 10.0
BEAT = 60 / 96                                                       # the groove of the intro (intro_music.py)


def font(path, size, idx=0):
    return ImageFont.truetype(path, size, index=idx)


def cjk(size):
    return ImageFont.truetype(BLACK, size, index=2)


# ---------------------------------------------------------------- comic panels from the film's frames
def comic(path, size):
    """A frame of the film as a painted comic panel: flattened colour, warm and saturated, inked outlines."""
    w, h = size
    im = cv2.imread(path)
    ih, iw = im.shape[:2]
    # fill the panel (cover crop)
    s = max(w / iw, h / ih)
    im = cv2.resize(im, (int(iw * s + 1), int(ih * s + 1)), interpolation=cv2.INTER_AREA)
    y0, x0 = (im.shape[0] - h) // 2, (im.shape[1] - w) // 2
    im = im[y0:y0 + h, x0:x0 + w]
    small = cv2.resize(im, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    for _ in range(5):
        small = cv2.bilateralFilter(small, 9, 40, 9)
    flat = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    # posterise in a perceptual space (fewer, bolder tones)
    lab = cv2.cvtColor(flat, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[..., 0] = np.round(lab[..., 0] / 22) * 22
    lab[..., 1:] = np.round((lab[..., 1:] - 128) * 1.35 / 9) * 9 + 128
    flat = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    # ink: edges of the smoothed picture, thickened a little
    g = cv2.cvtColor(cv2.medianBlur(im, 7), cv2.COLOR_BGR2GRAY)
    e = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 11, 5)
    e = cv2.erode(e, np.ones((2, 2), np.uint8))
    out = cv2.bitwise_and(flat, flat, mask=e)
    pil = Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
    pil = ImageEnhance.Color(pil).enhance(1.25)
    # warm print: lift the shadows towards a deep blue-violet, the lights towards cream
    a = np.asarray(pil).astype(np.float32) / 255
    a = a * np.array([1.04, 1.0, 0.94]) + (1 - a) * np.array([0.02, 0.0, 0.05])
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


# the cover grid: (source frame, x0, y0, x1, y1); the middle one sits under the logo
G = 26
PANELS = [("s08_dive", 0, 0, 1300, 760), ("s18_nightfall", 1300, 0, 2420, 760), ("s14a_umbrellas", 2420, 0, 3840, 760),
          ("s09_trees", 0, 760, 980, 1400), ("s13_dusk", 980, 760, 2860, 1400), ("s06a_lupu", 2860, 760, 3840, 1400),
          ("s12_drive", 0, 1400, 1520, 2160), ("s10b_jingan", 1520, 1400, 2620, 2160), ("s17_twilight", 2620, 1400, 3840, 2160)]
ORDER = [0, 4 + 4, 2, 6, 1, 5, 3, 7, 4]                              # the order they appear in (the middle one last)
ORDER = [0, 8, 2, 6, 1, 5, 3, 7, 4]


def panel_images():
    out = []
    for name, x0, y0, x1, y1 in PANELS:
        r = (x0 + G // 2, y0 + G // 2, x1 - G // 2, y1 - G // 2)
        out.append((comic(os.path.join(V, "gta", f"src_{name}.png"), (r[2] - r[0], r[3] - r[1])), r))
    return out


# ---------------------------------------------------------------- lettering
def outlined(text, fnt, fill, stroke, sw, extra_shadow=0):
    """Text as an RGBA image: fill, a heavy outline, optionally a drop shadow."""
    d0 = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bb = d0.textbbox((0, 0), text, font=fnt, stroke_width=sw)
    pad = sw + extra_shadow + 8
    im = Image.new("RGBA", (bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    o = (pad - bb[0], pad - bb[1])
    if extra_shadow:
        d.text((o[0] + extra_shadow, o[1] + extra_shadow), text, font=fnt, fill=(0, 0, 0, 255), stroke_width=sw, stroke_fill=(0, 0, 0, 255))
    d.text(o, text, font=fnt, fill=fill, stroke_width=sw, stroke_fill=stroke)
    return im


def gradient_text(text, fnt, top, bottom, sw):
    """Text filled with a vertical gradient, black outline round it."""
    base = outlined(text, fnt, (255, 255, 255, 255), (0, 0, 0, 255), sw)
    mask = outlined(text, fnt, (255, 255, 255, 255), (0, 0, 0, 0), sw).split()[3]       # the fill only
    w, h = base.size
    g = np.linspace(0, 1, h)[:, None]
    col = (np.array(top)[None, None, :] * (1 - g[..., None]) + np.array(bottom)[None, None, :] * g[..., None]).repeat(w, 1)
    grad = Image.fromarray(col.astype(np.uint8), "RGB").convert("RGBA")
    out = base.copy()
    out.paste(grad, (0, 0), mask)
    return out


def logo():
    """grand / tour / auto stacked, a big 7, 魔都 under it, the Chinese name on a black band."""
    words = [outlined(w_, font(PRICE, 205), (255, 255, 255, 255), (0, 0, 0, 255), 13) for w_ in ("grand", "tour", "auto")]
    seven = gradient_text("7", font(PRICE, 960), (255, 72, 140), (255, 176, 46), 26)
    modu = outlined("魔都", cjk(330), (255, 255, 255, 255), (0, 0, 0, 255), 18, extra_shadow=10)
    lh = 150
    stack_w = max(w_.size[0] for w_ in words)
    Wl = stack_w + seven.size[0] - 60
    Hl = max(lh * 3 + 60, seven.size[1]) + modu.size[1] + 260
    im = Image.new("RGBA", (Wl + 40, Hl), (0, 0, 0, 0))
    top = 40
    for k, w_ in enumerate(words):
        im.alpha_composite(w_, (stack_w - w_.size[0], top + 150 + k * lh))
    im.alpha_composite(seven, (stack_w - 70, 0))
    my = max(top + 150 + 2 * lh + words[2].size[1] - 30, seven.size[1] - 120)       # (below the stack, not over 'auto')
    im.alpha_composite(modu, ((Wl - modu.size[0]) // 2 + 10, my))
    # the Chinese name on a black band, a little tilted like a sticker
    band_t = "暇道览车手 7：魔都"
    f = cjk(86)
    d0 = ImageDraw.Draw(im)
    tw = d0.textlength(band_t, font=f)
    band = Image.new("RGBA", (int(tw + 120), 140), (0, 0, 0, 0))
    db = ImageDraw.Draw(band)
    db.rectangle([0, 0, band.size[0] - 1, band.size[1] - 1], fill=(12, 12, 14, 240))
    db.text((60, 16), band_t, font=f, fill=(255, 255, 255, 255))
    band = band.rotate(-2.2, expand=True, resample=Image.BICUBIC)
    im.alpha_composite(band, ((Wl - band.size[0]) // 2 + 10, my + modu.size[1] - 40))
    return im


def ident():
    """The parody studio ident: a yellow square, 沪 in black with a star — and a line of shine across it."""
    S = 820
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=40, fill=YELLOW + (255,))
    f = cjk(560)
    bb = d.textbbox((0, 0), "沪", font=f)
    d.text(((S - (bb[2] - bb[0])) / 2 - bb[0] - 40, (S - (bb[3] - bb[1])) / 2 - bb[1] - 20), "沪", font=f, fill=(0, 0, 0, 255))
    # the star
    cx, cy, R, r = S - 170, S - 160, 120, 50
    pts = [(cx + (R if k % 2 == 0 else r) * math.sin(k * math.pi / 5), cy - (R if k % 2 == 0 else r) * math.cos(k * math.pi / 5)) for k in range(10)]
    d.polygon(pts, fill=(0, 0, 0, 255))
    return im


def rating_box():
    """A parody age-rating box: 'E · 人人可逛'."""
    w, h = 300, 400
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w - 1, h - 1], fill=(255, 255, 255, 255))
    d.rectangle([10, 10, w - 11, h - 11], fill=(0, 0, 0, 255))
    d.rectangle([22, 22, w - 23, 270], fill=(255, 255, 255, 255))
    f = font(PRICE, 230)
    bb = d.textbbox((0, 0), "E", font=f)
    d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], 140 - (bb[3] - bb[1]) / 2 - bb[1]), "E", font=f, fill=(0, 0, 0, 255))
    f2 = cjk(56)
    t = "人人可逛"
    d.text(((w - d.textlength(t, font=f2)) / 2, 284), t, font=f2, fill=(255, 255, 255, 255))
    f3 = cjk(24)
    t = "走路也算  飞也行"
    d.text(((w - d.textlength(t, font=f3)) / 2, 352), t, font=f3, fill=(220, 220, 220, 255))
    return im


# ---------------------------------------------------------------- composition helpers
def scaled(im, s):
    return im.resize((max(1, int(im.size[0] * s)), max(1, int(im.size[1] * s))), Image.LANCZOS if s < 1 else Image.BICUBIC)


def place(canvas, im, cx, cy, alpha=1.0):
    if alpha <= 0:
        return
    if alpha < 1:
        im = im.copy(); im.putalpha(im.split()[3].point(lambda v: int(v * alpha)))
    canvas.alpha_composite(im, (int(cx - im.size[0] / 2), int(cy - im.size[1] / 2)))


ease_out = lambda t: 1 - (1 - min(max(t, 0), 1)) ** 3
smooth = lambda t: (lambda x: x * x * (3 - 2 * x))(min(max(t, 0), 1))


class Assets:
    def __init__(self):
        self.panels = panel_images()
        self.logo = logo()
        self.ident = ident()
        self.rating = rating_box()
        grid = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        for im, r in self.panels:
            grid.paste(im, r[:2])
        self.grid = grid


def grid_frame(A, shown, pops, push):
    """The cover grid with the panels shown so far; pops: {panel: age in s}; push: slow zoom factor."""
    c = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    d = ImageDraw.Draw(c)
    for k in shown:
        im, r = A.panels[k]
        age = pops.get(k, 9)
        s = 1 + 0.10 * (1 - ease_out(age / 0.22))
        pim = im if s == 1 else scaled(im, s)
        cx, cy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
        c.alpha_composite(pim.convert("RGBA"), (int(cx - pim.size[0] / 2), int(cy - pim.size[1] / 2)))
        if age < 0.12:                                               # a white flash as it lands
            fl = Image.new("RGBA", (r[2] - r[0], r[3] - r[1]), (255, 255, 255, int(200 * (1 - age / 0.12))))
            c.alpha_composite(fl, r[:2])
    # the gutters: white lines between the panels (redrawn over any panel still popping)
    for _, x0, y0, x1, y1 in PANELS:
        d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(245, 242, 235, 255), width=G // 2)
    if push != 1:
        c = scaled(c, push)
        ox, oy = (c.size[0] - W) // 2, (c.size[1] - H) // 2
        c = c.crop((ox, oy, ox + W, oy + H))
    return c


def vignette(strength):
    y, x = np.mgrid[0:H:8, 0:W:8]
    r = np.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2))
    a = np.clip((r - 0.35) / 0.9, 0, 1) ** 1.6 * strength
    v = Image.fromarray((a * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0)); out.putalpha(v)
    return out


# ---------------------------------------------------------------- the intro, frame by frame
T_PANEL0 = 6 * BEAT                       # first panel (beat 6 of the groove)
T_SLAM = 15 * BEAT                        # the logo lands


def intro_frame(A, t, cache):
    if t < 3.4:                                                       # the ident
        c = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        a = smooth((t - 0.9) / 0.35) * (1 - smooth((t - 2.9) / 0.5))
        if a > 0:
            s = 0.78 + 0.05 * ease_out((t - 0.9) / 2.0)
            im = scaled(A.ident, s)
            # the shine: a soft bright bar sweeping across the square
            sh = Image.new("L", im.size, 0)
            ds = ImageDraw.Draw(sh)
            p = (t - 1.25) / 1.0 * (im.size[0] * 2) - im.size[0] * 0.5
            ds.polygon([(p, 0), (p + 90, 0), (p - 90 + 0, im.size[1]), (p - 180, im.size[1])], fill=150)
            sh = sh.filter(ImageFilter.GaussianBlur(30))
            sh = ImageChops.multiply(sh, im.split()[3])
            glow = Image.new("RGBA", im.size, (255, 255, 255, 0)); glow.putalpha(sh)
            im = im.copy(); im.alpha_composite(glow)
            place(c, im, W / 2, H / 2, a)
        return c
    # the grid
    shown, pops = [], {}
    for n, k in enumerate(ORDER):
        tk = T_PANEL0 + n * BEAT
        if t >= tk:
            shown.append(k); pops[k] = t - tk
    push = 1.0 + 0.045 * smooth((t - T_PANEL0) / (INTRO_S - T_PANEL0))
    if t >= T_SLAM:                                                   # shake for a moment after the slam
        sh = max(0, 1 - (t - T_SLAM) / 0.35)
        push += 0.012 * sh
    c = grid_frame(A, shown, pops, push)
    if t < 3.4 + 0.4:
        c.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, int(255 * (1 - (t - 3.4) / 0.4)))))
    if t >= T_SLAM - 0.05:
        k = (t - T_SLAM)
        c.alpha_composite(cache.setdefault("vig", vignette(0.85)))
        c.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, int(110 * smooth(k / 0.3)))))
        s = 1.0 + 0.55 * (1 - ease_out(k / 0.18)) if k < 0.18 else 1.0 + 0.012 * smooth((k - 0.18) / 3)
        lg = cache.get(("logo", round(s, 3)))
        if lg is None:
            lg = scaled(A.logo, 0.96 * s); cache[("logo", round(s, 3))] = lg
        dx = (math.sin(k * 90) * 18 * max(0, 1 - k / 0.3)) if k > 0 else 0
        place(c, lg, W / 2 + dx, H / 2 - 20, min(1, max(0, k + 0.05) / 0.06))
        if k < 0.25:                                                  # the flash of the hit
            c.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, int(235 * (1 - k / 0.25)))))
        a = smooth((k - 0.6) / 0.4)                                    # the small print comes after
        if a > 0:
            place(c, scaled(A.rating, 0.85), 260, H - 280, a)
            place(c, cache.setdefault("plat", outlined("浏览器  ·  电脑  ·  手机", cjk(58), (255, 255, 255, 255), (0, 0, 0, 255), 6)), W - 620, H - 150, a)
    if t > INTRO_S - 0.5:                                             # into the film: to black
        c.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, int(255 * smooth((t - (INTRO_S - 0.5)) / 0.5)))))
    return c


# ---------------------------------------------------------------- the outro
def outro_frame(A, t, cache):
    base = cache.get("obase")
    if base is None:
        g = A.grid.filter(ImageFilter.GaussianBlur(14))
        g = ImageEnhance.Brightness(g).enhance(0.42)
        g.alpha_composite(vignette(0.9))
        cache["obase"] = base = g
    c = base.copy()
    s = 0.74 + 0.01 * smooth(t / OUTRO_S)
    lg = cache.get(("ologo", round(s, 3)))
    if lg is None:
        lg = scaled(A.logo, s); cache[("ologo", round(s, 3))] = lg
    place(c, lg, W / 2, 800)
    a = smooth((t - 0.5) / 0.6)
    if a > 0:
        u = cache.setdefault("url", outlined(URL, font(PRICE, 190), (255, 255, 255, 255), (0, 0, 0, 255), 12, extra_shadow=8))
        place(c, u, W / 2, 1640, a)
        n = cache.setdefault("now", outlined("现已上线  ·  打开浏览器即玩", cjk(70), (255, 214, 92, 255), (0, 0, 0, 255), 7))
        place(c, n, W / 2, 1800, a)
    a2 = smooth((t - 1.2) / 0.6)
    if a2 > 0:
        place(c, scaled(A.rating, 0.7), 230, H - 250, a2)
        fp = cache.setdefault("fine", outlined("本片为戏仿致敬，与 Rockstar Games、Take-Two Interactive 无任何关系。画面均为网站实时渲染。"
                                                "  数据 © OpenStreetMap 贡献者 · GlobalBuildingAtlas · Overture Maps · CBMF · SinoLC-1 · Meta / WRI",
                                                cjk(30), (210, 210, 210, 255), (0, 0, 0, 200), 2))
        place(c, fp, W / 2, H - 70, a2)
    a0 = 1 - smooth(t / 0.25)                                          # in on the downbeat: a white flash
    if a0 > 0:
        c.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, int(220 * a0))))
    if t > OUTRO_S - 2.2:
        c.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, int(255 * smooth((t - (OUTRO_S - 2.2)) / 2.2)))))
    return c


def encode(path, frames_fn, seconds, A):
    n = int(round(seconds * FPS))
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "constqp", "-qp", "12", "-bf", "0", "-pix_fmt", "yuv420p", path], stdin=subprocess.PIPE)
    cache = {}
    for f in range(n):
        ff.stdin.write(frames_fn(A, f / FPS, cache).convert("RGB").tobytes())
        if len(cache) > 400:
            cache = {k: v for k, v in cache.items() if not isinstance(k, tuple)}
    ff.stdin.close(); ff.wait()
    print(path, n, "frames")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "stills"
    A = Assets()
    if mode == "stills":
        cache = {}
        for name, fn, t in [("ident", intro_frame, 1.6), ("panels", intro_frame, T_PANEL0 + 4.4 * BEAT), ("slam", intro_frame, T_SLAM + 0.1), ("logo", intro_frame, T_SLAM + 1.5),
                            ("outro", outro_frame, 3.0)]:
            fn(A, t, cache).convert("RGB").resize((1920, 1080), Image.LANCZOS).save(os.path.join(ROOT, "shots", f"gta_{name}.jpg"), quality=90)
            print("still", name)
    else:
        encode(os.path.join(V, "gta_intro.mp4"), intro_frame, INTRO_S, A)
        encode(os.path.join(V, "gta_outro.mp4"), outro_frame, OUTRO_S, A)
