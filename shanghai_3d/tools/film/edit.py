"""The cut: the shots joined with dissolves on the bar lines, graded, letterboxed, lettered, set to the music.

  pass 1   the clips of film.mjs (each runs 40 frames past its length) dissolved into one another  -> video/master_clean.mp4
  pass 2   grade, the end dimmed under the last title, black bars (2.35:1), the lettering, fades, the music
           -> video/上海_4K.mp4 and video/上海_1080p.mp4

usage (from the project root): python3 tools/film/edit.py [--pass 1|2] [--preview]     (--preview: a quick 1080p pass 2 only)
"""
import sys, os, subprocess

V = "video"
FPS, BAR = 30, 100
SHOTS = [("s03_map", 4, 0), ("s04_roofs", 2, 24), ("s11_bund", 2, 18), ("s05_towers", 2, 18), ("s06a_lupu", 2, 18), ("s06_bridge", 3, 18), ("s07_interchange", 2, 24),
         ("s08_dive", 4, 30), ("s09_trees", 2, 24), ("s14a_umbrellas", 2, 30), ("s14b_promenade", 2, 24), ("s10b_jingan", 2, 30), ("s10_garden", 2, 20), ("s12_drive", 3, 20),
         ("s13_dusk", 5, 36), ("s17_twilight", 3, 40), ("s18_nightfall", 4, 40), ("s15_night", 3, 40), ("s16_away", 6, 40)]   # (clip, bars, frames of dissolve into it)
NB = sum(b for _, b, _ in SHOTS)
PICTURE = NB * BAR / FPS + 40 / FPS              # the pictures end here (the last clip's tail included)
TOTAL = NB * BAR / FPS + 10.0                    # ...and the film here, on the last chord
OUTRO = NB * BAR / FPS                           # the parody outro (gta.py) lands on the last chord
INTRO = 12.5                                     # and the parody intro runs before it all
sec = lambda bar, beat=1.0: ((bar - 1) * 4 + (beat - 1)) * 60 / 72
only = sys.argv[sys.argv.index("--pass") + 1] if "--pass" in sys.argv else None
preview = "--preview" in sys.argv


def run(cmd):
    print(" ".join(cmd[:6]), "...", flush=True)
    subprocess.run(cmd, check=True)


if only in (None, "1") and not preview:
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-stats"]
    for name, _, _ in SHOTS:
        cmd += ["-i", f"{V}/clips/{name}.mp4"]
    fc, start, prev = [], 0, "[0:v]"
    for k, (name, bars, d) in enumerate(SHOTS):
        if k:
            fc.append(f"{prev}[{k}:v]xfade=transition=fade:duration={d / FPS:.6f}:offset={start / FPS:.6f}[x{k}]"); prev = f"[x{k}]"
        start += bars * BAR
    cmd += ["-filter_complex", ";".join(fc), "-map", prev, "-c:v", "h264_nvenc", "-preset", "p5", "-rc", "constqp", "-qp", "13", "-bf", "0", "-pix_fmt", "yuv420p", "-r", str(FPS), f"{V}/master_clean.mp4"]
    run(cmd)

if only in (None, "2") or preview:
    # the lettering: (picture, in, out) in seconds; each fades in and out over 0.9 s and drifts a hair upwards
    TEXT = [("title", sec(1, 2.2), sec(2, 3.9)), ("t_area", sec(3, 1.6), sec(4, 3.7)), ("t_buildings", sec(5, 2.0), sec(6, 3.7)),
            ("t_roads", sec(16, 2.0), sec(17, 3.7)), ("t_walk", sec(20, 3.6), sec(21, 3.8)), ("t_trees", sec(22, 2.0), sec(23, 3.7)),
            ("t_rain", sec(26, 2.0), sec(27, 3.7)), ("t_lights", sec(41, 1.0), sec(42, 3.7)), ("end", sec(53, 3.0), OUTRO + 0.4)]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-stats", "-i", f"{V}/master_clean.mp4", "-i", f"{V}/music.wav", "-i", f"{V}/gta_intro.mp4", "-i", f"{V}/intro.wav", "-i", f"{V}/gta_outro.mp4"]
    NIN = 5
    for name, t0, t1 in TEXT:
        cmd += ["-loop", "1", "-framerate", str(FPS), "-t", f"{t1 - t0:.3f}", "-i", f"{V}/titles/{name}.png"]
    end0 = TEXT[-1][1]
    fc = [f"[0:v]tpad=stop_mode=clone:stop_duration={TOTAL - PICTURE + 0.2:.3f},"
          # a little more contrast and colour than the renderer gives; the last picture dimmed under the end title
          f"eq=contrast=1.05:saturation=1.10,"
          f"drawbox=x=0:y=0:w=iw:h=ih:color=black@0.5:t=fill:enable='gte(t,{end0 + 1.6:.3f})',"
          f"drawbox=x=0:y=0:w=iw:h=ih:color=black@0.25:t=fill:enable='between(t,{end0 + 0.6:.3f},{end0 + 1.6:.3f})',"
          f"drawbox=x=0:y=0:w=iw:h=263:color=black:t=fill,drawbox=x=0:y=1897:w=iw:h=263:color=black:t=fill[base]"]
    prev = "[base]"
    for k, (name, t0, t1) in enumerate(TEXT):
        last = k == len(TEXT) - 1
        out = "" if last else f",fade=t=out:st={t1 - t0 - 0.9:.3f}:d=0.9:alpha=1"
        fc.append(f"[{k + NIN}:v]format=rgba,fade=t=in:st=0:d={1.4 if k in (0, len(TEXT) - 1) else 0.9}:alpha=1{out},setpts=PTS+{t0:.3f}/TB[t{k}]")
        fc.append(f"{prev}[t{k}]overlay=x=0:y='-(t-{t0:.3f})*{0 if last else 3}':eof_action=pass[o{k}]"); prev = f"[o{k}]"
    # the outro over the last chord (it carries its own flash in and fade out), then the intro in front of everything
    fc.append(f"[4:v]setpts=PTS+{OUTRO:.3f}/TB[out]")
    fc.append(f"{prev}fade=t=in:st=0:d=1.6[film0];[film0][out]overlay=eof_action=pass,trim=0:{TOTAL:.3f},setpts=PTS-STARTPTS,format=yuv420p,fps={FPS}[film]")
    fc.append(f"[1:a]apad,atrim=0:{TOTAL:.3f},asetpts=PTS-STARTPTS[fa];[2:v]format=yuv420p,fps={FPS}[iv];[3:a]aformat=sample_rates=48000:channel_layouts=stereo[ia]")
    fc.append("[iv][ia][film][fa]concat=n=2:v=1:a=1[v4k][aout]")
    if preview:
        fc.append("[v4k]scale=1920:1080:flags=lanczos[v]")
        cmd += ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[aout]", "-c:v", "h264_nvenc", "-preset", "p4", "-rc", "constqp", "-qp", "22",
                "-c:a", "aac", "-b:a", "192k", f"{V}/preview_cut.mp4"]
        run(cmd)
    else:
        fc.append("[v4k]split[a4][b4];[b4]scale=1920:1080:flags=lanczos[b2];[aout]asplit[aa][ab]")
        tags = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart"]
        cmd += ["-filter_complex", ";".join(fc),
                "-map", "[a4]", "-map", "[aa]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", *tags, "-c:a", "aac", "-b:a", "256k", f"{V}/上海_4K.mp4",
                "-map", "[b2]", "-map", "[ab]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", *tags, "-c:a", "aac", "-b:a", "256k", f"{V}/上海_1080p.mp4"]
        run(cmd)
print(f"{NB} bars; pictures to {PICTURE:.2f} s, film {TOTAL:.2f} s")
