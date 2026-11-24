"""Contact sheet of screenshots: sheet.py out.jpg name1 name2 ... [--w 960]"""
import sys
from PIL import Image
args = sys.argv[1:]
w = 960
if "--w" in args:
    k = args.index("--w"); w = int(args[k + 1]); del args[k:k + 2]
out, names = args[0], args[1:]
ims = [Image.open(f"shots/{n}.png").convert("RGB") for n in names]
ims = [im.resize((w, round(im.height * w / im.width))) for im in ims]
sheet = Image.new("RGB", (w, sum(im.height for im in ims)))
y = 0
for im in ims:
    sheet.paste(im, (0, y)); y += im.height
sheet.save(out, quality=88)
