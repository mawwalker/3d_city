"""Subset Source Han Serif to exactly the glyphs the site uses (UI copy + place names) -> site/fonts/*.woff2.

Source Han Serif is licensed under the SIL Open Font License 1.1; subsetting and redistribution are permitted
(the subset is renamed in CSS as 'Jing Serif', the font files keep their original name table).

usage: 40_fonts.py <site_dir> [font_dir]
"""
import sys, os, re, glob, json
from fontTools import subset
from fontTools.ttLib import TTFont

SITE = sys.argv[1]
FONT_DIR = sys.argv[2] if len(sys.argv) > 2 else "/usr/share/fonts/adobe-source-han-serif"
SRC = {400: "SourceHanSerifCN-Regular.otf", 600: "SourceHanSerifCN-SemiBold.otf", 900: "SourceHanSerifCN-Heavy.otf"}

text = set()
files = glob.glob(os.path.join(SITE, "src", "**", "*.js"), recursive=True) + [os.path.join(SITE, "index.html")] + glob.glob(os.path.join(SITE, "css", "*.css"))
for f in files:
    text |= set(open(f, encoding="utf-8").read())
for name in ("labels.json", "landmarks.json"):
    p = os.path.join(SITE, "data", name)
    if os.path.exists(p):
        text |= set(json.dumps(json.load(open(p, encoding="utf-8")), ensure_ascii=False))
chars = {c for c in text if ord(c) > 0x2E7F or c in "·—–…“”‘’«»°′″％℃×→←↑↓■□●○"}
chars |= set(map(chr, range(0x20, 0x7F)))
# always keep the digits used by the clock in full-width punctuation context and a few likely label characters
chars |= set("０１２３４５６７８９：，。、；！？（）《》〈〉「」『』【】　")
print("glyphs requested:", len(chars), "CJK:", sum(1 for c in chars if ord(c) > 0x2E7F))
os.makedirs(os.path.join(SITE, "fonts"), exist_ok=True)
for w, fn in SRC.items():
    src = os.path.join(FONT_DIR, fn)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["vert", "vrt2", "kern", "liga", "palt", "locl"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.desubroutinize = True
    font = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(sorted(chars)))
    sub.subset(font)
    out = os.path.join(SITE, "fonts", f"jing-serif-{w}.woff2")
    font.flavor = "woff2"
    font.save(out)
    print(w, fn, "->", out, f"{os.path.getsize(out) / 1024:.0f} KB")
open(os.path.join(SITE, "fonts", "LICENSE.txt"), "w").write(
    "The fonts in this directory are subsets of Source Han Serif (思源宋体) by Adobe, licensed under the SIL Open Font License, Version 1.1.\n"
    "https://github.com/adobe-fonts/source-han-serif\n")
