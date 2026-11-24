"""Frames of rendered clips at even intervals, a row per clip, for checking a camera move over time.
usage: strip.py <clips dir> <out prefix> <frames per clip> <rows per sheet> [clip names...]"""
import sys, os, subprocess, io
from PIL import Image, ImageDraw
d, out, n, per = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
names = sys.argv[5:] or sorted(f[:-4] for f in os.listdir(d) if f.endswith(".mp4"))
CW, CH = 320, 180
def frames(path):
    nf = int(subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip().strip(","))
    ims = []
    for k in range(n):
        f = round(k * (nf - 1) / (n - 1))
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"select=eq(n\\,{f}),scale={CW}:{CH}", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"], capture_output=True).stdout
        ims.append(Image.open(io.BytesIO(raw)).convert("RGB"))
    return ims
for s in range(0, len(names), per):
    grp = names[s:s + per]
    sheet = Image.new("RGB", (CW * n, CH * len(grp)), "black")
    dr = ImageDraw.Draw(sheet)
    for r, name in enumerate(grp):
        for c, im in enumerate(frames(os.path.join(d, name + ".mp4"))):
            sheet.paste(im, (c * CW, r * CH))
        dr.text((5, r * CH + 3), name, fill=(255, 255, 0))
    sheet.save(f"{out}{s // per + 1}.jpg", quality=85)
    print(f"{out}{s // per + 1}.jpg", sheet.size)
