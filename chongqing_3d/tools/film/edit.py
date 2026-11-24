"""Assemble the Chongqing 3D Cinema Film (1920x1080 @ 30fps, H.264 High + AAC 256k).

Pass 1: Join the 13 rendered clips from tools/film.mjs on exact 72 BPM bar boundaries
        using smooth cross-dissolves -> video/master_clean.mp4
Pass 2: Subtle filmic contrast/saturation polish, opening title, bilingual location
        lower-thirds, dimmed end title card, and original FluidSynth orchestral score
        -> video/chongqing_1080p.mp4

Usage (from chongqing_3d/):
  python3 tools/film/edit.py [--pass 1|2]
"""

import os
import subprocess
import sys

V = "video"
FPS, BAR, TAIL = 30, 100, 36

# (clip_name, editorial_bars, dissolve_frames_into_clip)
SHOTS = [
    ("s01_chaotianmen_raffles", 3, 0),
    ("s02_street_macro",        2, 24),
    ("s03_jiefangbei_cbd",      2, 22),
    ("s04_qiansimen_bridge",    2, 22),
    ("s05_liziba_monorail",     3, 24),
    ("s06_yangtze_cableway",    2, 24),
    ("s07a_sujiaba_spiral",     2, 22),
    ("s07b_shihuang_tunnels",   2, 20),
    ("s08a_greathall_dusk",     2, 26),
    ("s08b_grandtheatre_blue",  2, 28),
    ("s09_hongyadong_night",    3, 32),
    ("s10_rainy_cyber_walk",    2, 30),
    ("s11_nanshan_finale",      4, 34),
]

NB = sum(b for _, b, _ in SHOTS)          # 31 bars
PICTURE = (NB * BAR + TAIL) / FPS         # 104.533 s
TOTAL = NB * BAR / FPS + 3.667            # 107.000 s (matches music.py cleanly)
sec = lambda bar, beat=1.0: ((bar - 1) * 4.0 + (beat - 1.0)) * 60.0 / 72.0

only = sys.argv[sys.argv.index("--pass") + 1] if "--pass" in sys.argv else None


def run(cmd):
    print("running:", " ".join(cmd[:8]), "...", flush=True)
    subprocess.run(cmd, check=True)


if only in (None, "1"):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-stats"]
    for name, _, _ in SHOTS:
        cmd += ["-i", f"{V}/clips/{name}.mp4"]
    fc, start, prev = [], 0, "[0:v]"
    for k, (name, bars, d) in enumerate(SHOTS):
        if k:
            fc.append(f"{prev}[{k}:v]xfade=transition=fade:duration={d / FPS:.6f}:offset={start / FPS:.6f}[x{k}]")
            prev = f"[x{k}]"
        start += bars * BAR
    cmd += [
        "-filter_complex", ";".join(fc),
        "-map", prev,
        "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "constqp", "-qp", "14", "-bf", "0",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        f"{V}/master_clean.mp4",
    ]
    run(cmd)

if only in (None, "2"):
    # (title_png_name, t_in_sec, t_out_sec)
    TEXT = [
        ("title",         sec(1, 1.8),  sec(3, 3.6)),
        ("lt_street",     sec(4, 1.5),  sec(5, 4.2)),
        ("lt_jiefangbei", sec(6, 1.5),  sec(7, 4.2)),
        ("lt_qiansimen",  sec(8, 1.5),  sec(9, 4.2)),
        ("lt_liziba",     sec(10, 1.6), sec(12, 3.8)),
        ("lt_cableway",   sec(13, 1.5), sec(14, 4.2)),
        ("lt_infra",      sec(15, 1.6), sec(18, 3.8)),
        ("lt_dusk",       sec(19, 1.6), sec(22, 3.8)),
        ("lt_hongyadong", sec(23, 1.6), sec(25, 4.0)),
        ("lt_rain",       sec(26, 1.5), sec(27, 4.2)),
        ("end",           sec(29, 3.2), TOTAL),
    ]

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-stats", "-i", f"{V}/master_clean.mp4", "-i", f"{V}/music.wav"]
    NIN = 2
    for name, t0, t1 in TEXT:
        cmd += ["-loop", "1", "-framerate", str(FPS), "-t", f"{t1 - t0:.3f}", "-i", f"{V}/titles/{name}.png"]

    end0 = TEXT[-1][1]
    pad_dur = max(0.2, TOTAL - PICTURE + 0.3)
    fc = [
        f"[0:v]tpad=stop_mode=clone:stop_duration={pad_dur:.3f},"
        f"eq=contrast=1.04:saturation=1.08,"
        f"drawbox=x=0:y=0:w=iw:h=ih:color=black@0.28:t=fill:enable='between(t,{end0 - 0.2:.3f},{end0 + 0.9:.3f})',"
        f"drawbox=x=0:y=0:w=iw:h=ih:color=black@0.54:t=fill:enable='gte(t,{end0 + 0.9:.3f})'[base]"
    ]
    prev = "[base]"
    for k, (name, t0, t1) in enumerate(TEXT):
        is_first = (k == 0)
        is_last = (k == len(TEXT) - 1)
        fin = 1.2 if (is_first or is_last) else 0.65
        fout = "" if is_last else f",fade=t=out:st={t1 - t0 - 0.70:.3f}:d=0.70:alpha=1"
        drift = 0 if is_last else 2.2
        fc.append(
            f"[{k + NIN}:v]format=rgba,fade=t=in:st=0:d={fin:.2f}:alpha=1{fout},setpts=PTS+{t0:.3f}/TB[t{k}]"
        )
        fc.append(f"{prev}[t{k}]overlay=x=0:y='-(t-{t0:.3f})*{drift}':eof_action=pass[o{k}]")
        prev = f"[o{k}]"

    fc.append(
        f"{prev}fade=t=in:st=0:d=1.0,fade=t=out:st={TOTAL - 1.8:.3f}:d=1.8,"
        f"trim=0:{TOTAL:.3f},setpts=PTS-STARTPTS,format=yuv420p,fps={FPS}[vout]"
    )
    fc.append(f"[1:a]apad,atrim=0:{TOTAL:.3f},asetpts=PTS-STARTPTS[aout]")

    tags = ["-color_range", "tv", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart"]
    cmd += [
        "-filter_complex", ";".join(fc),
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-maxrate", "6800k", "-bufsize", "13600k",
        "-profile:v", "high", "-pix_fmt", "yuv420p", *tags,
        "-c:a", "aac", "-b:a", "192k",
        f"{V}/chongqing_1080p.mp4",
    ]
    run(cmd)

print(f"Done: {NB} bars, picture {PICTURE:.2f}s, total {TOTAL:.2f}s")
