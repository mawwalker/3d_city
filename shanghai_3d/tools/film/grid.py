"""Contact sheets of the film's preview stills: one row per shot. usage: grid.py <out prefix> <per sheet> shot1 shot2 ..."""
import sys
from PIL import Image, ImageDraw
out, per, names = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
CW, CH = 520, 292
for s in range(0, len(names), per):
    grp = names[s:s + per]
    cols = 0
    rows = []
    for n in grp:
        ims = []
        k = 0
        while True:
            try:
                ims.append(Image.open(f"shots/film_{n}_{k}.jpg").convert("RGB").resize((CW, CH), Image.LANCZOS)); k += 1
            except FileNotFoundError:
                break
        rows.append((n, ims)); cols = max(cols, len(ims))
    sheet = Image.new("RGB", (CW * cols, CH * len(rows)), "black")
    d = ImageDraw.Draw(sheet)
    for r, (n, ims) in enumerate(rows):
        for c, im in enumerate(ims):
            sheet.paste(im, (c * CW, r * CH))
        d.text((6, r * CH + 4), n, fill=(255, 255, 0))
    sheet.save(f"{out}{s // per + 1}.jpg", quality=86)
    print(f"{out}{s // per + 1}.jpg", sheet.size)
