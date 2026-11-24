"""Cut the rendered shots into the introduction film: cross-dissolves, captions, title and end card, music.

usage: film_encode.py <frames_dir> <music.wav> <out.mp4>
Shot order, durations and captions come from film_shots.mjs (parsed loosely, the file is plain data).
"""
import sys, os, re, subprocess, json

FRAMES, MUSIC, OUT = sys.argv[1:4]
HERE = os.path.dirname(os.path.abspath(__file__))
FPS, XF = 30, 1.0
FONT_DIR = "/usr/share/fonts/adobe-source-han-serif"
F_REG = f"{FONT_DIR}/SourceHanSerifCN-Regular.otf"
F_SEMI = f"{FONT_DIR}/SourceHanSerifCN-SemiBold.otf"
URL = "beijing.smartdeng.com"

src = open(os.path.join(HERE, "film_shots.mjs"), encoding="utf-8").read()
shots = []
for m in re.finditer(r"\{ id: '(\w+)', dur: ([\d.]+)(.*?)(?=\n  \{ id:|\n\];)", src, re.S):
    cap = re.search(r"caption: \['([^']*)', '([^']*)'\]", m.group(3))
    shots.append(dict(id=m.group(1), dur=float(m.group(2)), caption=(cap.group(1), cap.group(2)) if cap else None))
# frames actually rendered decide the length of each shot
for s in shots:
    n = len([f for f in os.listdir(os.path.join(FRAMES, s["id"])) if f.endswith(".jpg")])
    s["dur"] = n / FPS
starts, t = [], 0.0
for i, s in enumerate(shots):
    starts.append(t)
    t += s["dur"] - (XF if i < len(shots) - 1 else 0)
TOTAL = t
print("film length %.2f s" % TOTAL, [(s["id"], round(st, 2)) for s, st in zip(shots, starts)])


def esc(text):
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("%", "\\%")


def alpha(a, b, f=0.7):
    return f"if(lt(t,{a:.3f}),0,if(lt(t,{a + f:.3f}),(t-{a:.3f})/{f},if(lt(t,{b - f:.3f}),1,if(lt(t,{b:.3f}),({b:.3f}-t)/{f},0))))"


def text(txt, font, size, x, y, a, b, color="white", f=0.7, extra=""):
    return (f"drawtext=fontfile='{font}':text='{esc(txt)}':fontsize={size}:fontcolor={color}:x={x}:y={y}"
            f":shadowcolor=black@0.55:shadowx=0:shadowy=2:borderw=1:bordercolor=black@0.18:alpha='{alpha(a, b, f)}'{extra}")


inputs, chains = [], []
for i, s in enumerate(shots):
    inputs += ["-framerate", str(FPS), "-i", os.path.join(FRAMES, s["id"], "f%05d.jpg")]
    chains.append(f"[{i}:v]scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p,settb=AVTB,fps={FPS}[s{i}]")
prev = "s0"
for i in range(1, len(shots)):
    off = starts[i]
    chains.append(f"[{prev}][s{i}]xfade=transition=fade:duration={XF}:offset={off:.4f}[x{i}]")
    prev = f"x{i}"

# captions: name above a one-line note, lower left
draws = []
for s, st in zip(shots, starts):
    if not s["caption"]:
        continue
    a, b = st + 1.0, st + s["dur"] - 1.3
    name, line = s["caption"]
    draws.append(text(name, F_SEMI, 60, 120, "h-212", a, b))
    draws.append(text(line, F_REG, 28, 124, "h-126", a + 0.25, b, color="white@0.86"))
# title over the opening, end card over the last shot
o = shots[0]["dur"]
draws.append(text("北京 · 五环之内", F_SEMI, 96, "(w-text_w)/2", "h*0.34", 1.4, o - 1.0, f=1.0))
draws.append(text("一座可以在浏览器里漫游的三维城市", F_REG, 32, "(w-text_w)/2", "h*0.34+132", 2.0, o - 1.0, color="white@0.88", f=1.0))
e0 = starts[-1]
draws.append(text("北京 · 五环之内", F_SEMI, 84, "(w-text_w)/2", "h*0.36", e0 + 1.6, TOTAL - 0.4, f=1.0))
draws.append(text(URL, F_REG, 34, "(w-text_w)/2", "h*0.36+120", e0 + 2.3, TOTAL - 0.4, color="white@0.9", f=1.0))
draws.append(text("数据：OpenStreetMap 贡献者 · GlobalBuildingAtlas · 3D-GloBFP · Copernicus DEM", F_REG, 22, "(w-text_w)/2", "h-72", e0 + 3.0, TOTAL - 0.4, color="white@0.7", f=1.0))
fade = f"fade=t=in:st=0:d=1.2,fade=t=out:st={TOTAL - 2.2:.3f}:d=2.2"
shade_idx = len(shots)
inputs += ["-loop", "1", "-framerate", str(FPS), "-i", os.path.join(HERE, "caption_shade.png")]
# the shade only sits under shots that carry a caption
on = "+".join(f"between(t,{st + 0.6:.3f},{st + s['dur'] - 0.9:.3f})" for s, st in zip(shots, starts) if s["caption"])
chains.append(f"[{shade_idx}:v]format=rgba,trim=duration={TOTAL:.3f},fade=t=in:st=0:d=0.01:alpha=1[shade]")
chains.append(f"[{prev}][shade]overlay=0:0:enable='{on}':shortest=1[shaded]")
chains.append("[shaded]" + ",".join(draws + [fade]) + "[v]")
audio_idx = len(shots) + 1
inputs += ["-i", MUSIC]
chains.append(f"[{audio_idx}:a]atrim=0:{TOTAL:.3f},afade=t=out:st={TOTAL - 3.0:.3f}:d=3.0[a]")
graph = ";\n".join(chains)
open(OUT + ".filter.txt", "w", encoding="utf-8").write(graph)
cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "warning", "-stats", *inputs, "-/filter_complex", OUT + ".filter.txt",
       "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", os.environ.get("CRF", "19"), "-pix_fmt", "yuv420p", "-r", str(FPS),
       "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{TOTAL:.3f}", OUT]
subprocess.run(cmd, check=True)
print("wrote", OUT)
