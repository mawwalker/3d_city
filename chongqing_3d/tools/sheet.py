"""Contact sheet generator for Chongqing 3D screenshots.
Usage:
  python3 sheet.py out.jpg name1 name2 ... [--w 960] [--cols 1] [--label]
"""
import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "shots")

args = sys.argv[1:]
w = 960
cols = 1
label = False
while True:
    if "--w" in args:
        k = args.index("--w"); w = int(args[k + 1]); del args[k:k + 2]
    elif "--cols" in args:
        k = args.index("--cols"); cols = int(args[k + 1]); del args[k:k + 2]
    elif "--label" in args:
        label = True; args.remove("--label")
    else:
        break

out_arg, names = args[0], args[1:]
out = out_arg if os.path.isabs(out_arg) else os.path.join(SHOTS, out_arg)

ims = []
for n in names:
    p = n if os.path.exists(n) else os.path.join(SHOTS, n if n.endswith((".png", ".jpg")) else f"{n}.png")
    im = Image.open(p).convert("RGB")
    im = im.resize((w, round(im.height * w / im.width)), Image.Resampling.LANCZOS)
    if label:
        draw = ImageDraw.Draw(im)
        tag = os.path.basename(n)
        draw.rectangle([8, 8, 16 + len(tag) * 8, 30], fill=(0, 0, 0))
        draw.text((12, 12), tag, fill=(255, 255, 255))
    ims.append(im)

rows = (len(ims) + cols - 1) // cols
cell_h = max(im.height for im in ims)
sheet = Image.new("RGB", (w * cols, cell_h * rows), (12, 12, 16))
for idx, im in enumerate(ims):
    r, c = divmod(idx, cols)
    sheet.paste(im, (c * w, r * cell_h))

os.makedirs(os.path.dirname(out), exist_ok=True)
sheet.save(out, quality=90)
print(f"Wrote {out} ({sheet.width}x{sheet.height}, {len(ims)} frames)")
