"""Burn a crisp @marcus_s_deng watermark into a rendered video while keeping original audio untouched.

Places the watermark at the bottom-right of the active 2.35:1 picture area (just above the bottom letterbox bar),
avoiding all intro/outro badges and vertical film captions.

Usage (from shanghai_3d/):
  .venv/bin/python tools/watermark.py [input.mp4] [output.mp4] [@marcus_s_deng]
"""
import os
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "video", "上海_1080p.mp4")
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "video", "上海_1080p_wm.mp4")
TEXT = sys.argv[3] if len(sys.argv) > 3 else "@marcus_s_deng"

FONT_CANDIDATES = [
    "/usr/share/fonts/TTF/IBMPlexSansSC-Medium.ttf",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Medium.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
]


def probe_size(video_path: str) -> tuple[int, int]:
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", video_path,
        ],
        text=True,
    ).strip()
    w, h = out.split("x")
    return int(w), int(h)


def build_overlay(w: int, h: int, text: str) -> Image.Image:
    u = w / 1920.0
    s = 2  # 2x supersampling for crisp anti-aliased edges
    W2, H2 = w * s, h * s

    fp = next(p for p in FONT_CANDIDATES if os.path.exists(p))
    fnt = ImageFont.truetype(fp, int(round(33 * u * s)), index=2 if fp.endswith(".ttc") else 0)

    txt_layer = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    dt = ImageDraw.Draw(txt_layer)
    bb = dt.textbbox((0, 0), text, font=fnt)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]

    # Active 2.35:1 bottom edge is 1897/2160 * h (= 948.5 at 1080p)
    bar_top = (1897.0 / 2160.0) * h
    x_right = (w - 44 * u) * s
    y_bottom = (bar_top - 22.5 * u) * s
    tx = x_right - tw - bb[0]
    ty = y_bottom - th - bb[1]

    dt.text((tx, ty), text, font=fnt, fill=(255, 255, 255, 228))

    alpha = txt_layer.split()[3]
    halo = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    halo.putalpha(
        alpha.filter(ImageFilter.MaxFilter(max(3, int(round(5 * u)))))
        .filter(ImageFilter.GaussianBlur(7 * u * s))
        .point(lambda v: int(min(255, v * 0.55)))
    )
    drop = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    drop.putalpha(
        alpha.filter(ImageFilter.GaussianBlur(2 * u * s))
        .point(lambda v: int(min(255, v * 0.72)))
    )

    out2 = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    out2.alpha_composite(halo)
    out2.alpha_composite(drop, (int(round(2 * u * s)), int(round(2 * u * s))))
    out2.alpha_composite(txt_layer)
    return out2.resize((w, h), Image.LANCZOS)


def main():
    w, h = probe_size(SRC)
    overlay = build_overlay(w, h, TEXT)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        wm_png = tmp.name
    try:
        overlay.save(wm_png)
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error", "-stats",
            "-i", SRC,
            "-i", wm_png,
            "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]",
            "-map", "[v]", "-map", "0:a",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
            "-c:a", "copy",
            "-movflags", "+faststart",
            DST,
        ]
        subprocess.run(cmd, check=True)
        sz_mb = os.path.getsize(DST) / (1024 * 1024)
        print(f"Saved {DST} ({w}x{h}, {sz_mb:.1f} MB) with watermark '{TEXT}'")
    finally:
        if os.path.exists(wm_png):
            os.remove(wm_png)


if __name__ == "__main__":
    main()
