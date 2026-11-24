"""Sound of the parody intro (gta.py): a whoosh and a thud for the ident, then a 96-bpm groove whose kicks land with the
comic panels, and a slam (orchestra hit, crash, brass, sub drop) when the logo comes; a held chord carries into the film.
usage: intro_music.py <out.wav>
"""
import sys, os, struct, subprocess, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
random.seed(3)
OUT = sys.argv[1]
SF = "/usr/share/minuet/soundfonts/GeneralUser-v1.47.sf2"
BPM, PPQ, LEN = 96, 480, 12.5
SEC = 60 / BPM                                   # a beat in seconds; times below are in beats
T_PANEL0, T_SLAM = 6, 15


class Tr:
    def __init__(s, ch, prog=None, vol=110, rev=60):
        s.ch, s.ev = ch, []
        if prog is not None: s.ev.append((0, 0, bytes([0xC0 | ch, prog])))
        s.ev += [(0, 0, bytes([0xB0 | ch, 7, vol])), (0, 0, bytes([0xB0 | ch, 91, rev]))]
    def n(s, t, d, p, v):
        s.ev.append((t, 1, bytes([0x90 | s.ch, p, max(1, min(127, int(v)))]))); s.ev.append((t + d, 0, bytes([0x80 | s.ch, p, 0])))
    def data(s):
        out, last = b"", 0
        for t, _, m in sorted(s.ev, key=lambda e: (round(e[0] * PPQ), e[1])):
            tk = round(t * PPQ); d = tk - last; last = tk
            vl = [d & 0x7F]; d >>= 7
            while d: vl.append((d & 0x7F) | 0x80); d >>= 7
            out += bytes(reversed(vl)) + m
        return out + b"\x00\xff\x2f\x00"


dr = Tr(9, vol=118, rev=40)
bass = Tr(0, 38, vol=112, rev=20)           # synth bass
hit = Tr(1, 55, vol=120, rev=90)            # orchestra hit
brass = Tr(2, 61, vol=108, rev=80)          # brass section
pad = Tr(3, 89, vol=96, rev=110)            # warm pad
timp = Tr(4, 47, vol=110, rev=80)
KICK, SNARE, HAT, OHAT, CRASH, CLAP, LTOM = 36, 38, 42, 46, 49, 39, 45

# the ident: a soft low thud under the shine (the whoosh is added as filtered noise below)
t_id = 1.25 / SEC
dr.n(t_id, 0.5, KICK, 118); timp.n(t_id, 2.0, 38, 100); dr.n(t_id, 2, CRASH, 50)
# the groove under the panels (beats 6..14): kick on the beat (one per panel), snare on 2 and 4, sixteenth hats
for b in range(T_PANEL0, T_SLAM):
    dr.n(b, 0.2, KICK, 112 if (b - T_PANEL0) % 2 == 0 else 100)
    if (b - T_PANEL0) % 2 == 1: dr.n(b, 0.2, SNARE, 104); dr.n(b, 0.2, CLAP, 70)
    for k in range(4):
        dr.n(b + k * 0.25, 0.1, OHAT if k == 2 else HAT, 62 + (12 if k == 0 else 0) + random.randint(-5, 5))
    if (b - T_PANEL0) % 4 == 3: dr.n(b + 0.75, 0.2, KICK, 90)
# a funky minor bass line (D dorian), two bars long, then the fill into the slam
line = [(0, 38, 0.4), (0.75, 38, 0.2), (1, 41, 0.4), (1.5, 43, 0.3), (2, 38, 0.4), (2.75, 45, 0.2), (3, 43, 0.4), (3.5, 41, 0.3)]
for bar in (T_PANEL0, T_PANEL0 + 4):
    for o, p, d in line:
        if bar + o < T_SLAM - 0.5: bass.n(bar + o, d, p, 104)
for k, p in enumerate([LTOM, LTOM, 47, 48]):          # the fill
    dr.n(T_SLAM - 1 + k * 0.25, 0.2, p, 96 + k * 6)
# the slam: everything at once on D, then a bright held chord into the film
for p in (50, 57, 62, 66, 69):
    hit.n(T_SLAM, 1.5, p, 124)
for p in (62, 66, 69, 74):
    brass.n(T_SLAM, 2.6, p, 110)
dr.n(T_SLAM, 0.5, KICK, 127); dr.n(T_SLAM, 3, CRASH, 120); dr.n(T_SLAM, 3, 57, 100); timp.n(T_SLAM, 2.5, 38, 124)
bass.n(T_SLAM, 3.0, 26, 120)
for p in (50, 57, 62, 66, 69, 74):
    pad.n(T_SLAM + 0.5, LEN / SEC - T_SLAM - 0.5, p, 70)

tempo = struct.pack(">I", round(60_000_000 / BPM))[1:]
tracks = [b"\x00\xff\x51\x03" + tempo + b"\x00\xff\x2f\x00"] + [t.data() for t in (dr, bass, hit, brass, pad, timp)]
mid = os.path.splitext(OUT)[0] + ".mid"
with open(mid, "wb") as f:
    f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), PPQ))
    for d in tracks: f.write(b"MTrk" + struct.pack(">I", len(d)) + d)
raw = os.path.splitext(OUT)[0] + "_raw.wav"
subprocess.run(["fluidsynth", "-ni", "-q", "-g", "0.7", "-r", "48000", "-F", raw, "-o", "synth.reverb.active=1", "-o", "synth.reverb.room-size=0.6", SF, mid], check=True, stderr=subprocess.DEVNULL)
slam = T_SLAM * SEC
# the whoosh of the ident (noise swept up through a band-pass) and the sub drop of the slam (a falling sine)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                "-f", "lavfi", "-t", "1.6", "-i", "anoisesrc=color=pink:amplitude=0.5:r=48000",
                "-f", "lavfi", "-t", "2.4", "-i", f"aevalsrc='0.9*sin(2*PI*(70*t-12*t*t))*exp(-1.6*t)':s=48000",
                "-filter_complex",
                "[1]highpass=f=300,lowpass=f=5000,afade=t=in:d=1.2:curve=exp,afade=t=out:st=1.2:d=0.4,volume=0.55,adelay=0|0,aformat=channel_layouts=stereo[wh];"
                f"[2]aformat=channel_layouts=stereo,adelay={int(slam * 1000)}|{int(slam * 1000)}[sub];"
                f"[0][wh][sub]amix=inputs=3:normalize=0:duration=first,atrim=0:{LEN},afade=t=out:st={LEN - 1.2}:d=1.2,"
                "alimiter=limit=0.89:level=disabled,volume=1.0[a]",
                "-map", "[a]", "-ar", "48000", "-c:a", "pcm_s16le", OUT], check=True)
os.remove(raw)
m = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", OUT, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
print(OUT, [l.strip() for l in m.splitlines() if l.strip().startswith("I:")][-1])
