"""The film's music: a light piece for piano, strings, harp and a few colours, written here note by note and played by
fluidsynth through a General MIDI soundfont. 72 beats a minute, four to the bar: a bar is 100 frames of the film, a beat 25,
so the sections below are the film's (see shots.mjs):

  bars  1- 4  the city from six kilometres up       single notes of the piano over a held chord; plucked strings as the title comes
  bars  5-17  the scale of it                       the theme: strings over flowing piano; then again, shorter, lifted
  bars 18-34  walking in                            lighter: plucked strings and harp; four bars of rain, hushed; the theme returns
  bars 35-39  the day goes                          broad, slow strings
  bars 40-42  the lights come on                    quieter strings, lights twinkling high up
  bars 43-46  night on the river                    the opening again: single notes of the piano
  bars 47-49  night                                 a hush: celesta over a soft chord
  bars 50-55  up and away                           the theme once more, full; the last chord left to ring

usage: music.py <out.wav> [soundfont]      (writes <out>.mid beside it)
"""
import sys, os, struct, random, subprocess

OUT = sys.argv[1]
SF = sys.argv[2] if len(sys.argv) > 2 else "/usr/share/minuet/soundfonts/GeneralUser-v1.47.sf2"
BPM, PPQ = 72, 480
random.seed(7)
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def n(name):
    """'F#5' -> MIDI number (C4 = 60)."""
    p = NOTE[name[0]]; i = 1
    if name[i] == "#": p += 1; i += 1
    elif name[i] == "b": p -= 1; i += 1
    return p + 12 * (int(name[i:]) + 1)


class Track:
    def __init__(self, ch, prog, vol=100, pan=64, rev=100, cho=0):
        self.ch, self.ev = ch, []
        self.ev += [(0, 0, bytes([0xC0 | ch, prog])), (0, 0, bytes([0xB0 | ch, 7, vol])), (0, 0, bytes([0xB0 | ch, 10, pan])),
                    (0, 0, bytes([0xB0 | ch, 91, rev])), (0, 0, bytes([0xB0 | ch, 93, cho])), (0, 0, bytes([0xB0 | ch, 11, 127]))]

    def note(self, beat, dur, pitch, vel, human=0.012):
        if isinstance(pitch, str): pitch = n(pitch)
        t0 = max(0.0, beat + random.uniform(-human, human)); v = max(1, min(127, int(vel + random.uniform(-4, 4))))
        self.ev.append((t0, 1, bytes([0x90 | self.ch, pitch, v]))); self.ev.append((t0 + max(dur, 0.05), 0, bytes([0x80 | self.ch, pitch, 0])))

    def cc(self, beat, num, val):
        self.ev.append((max(0.0, beat), 0, bytes([0xB0 | self.ch, num, max(0, min(127, int(val)))])))

    def ramp(self, b0, b1, num, v0, v1, steps=None):
        steps = steps or max(2, int((b1 - b0) * 4))
        for k in range(steps + 1):
            self.cc(b0 + (b1 - b0) * k / steps, num, v0 + (v1 - v0) * k / steps)

    def data(self):
        out, last = b"", 0
        for t, _, msg in sorted(self.ev, key=lambda e: (round(e[0] * PPQ), e[1])):
            tick = round(t * PPQ); d = tick - last; last = tick
            vl = [d & 0x7F]; d >>= 7
            while d: vl.append((d & 0x7F) | 0x80); d >>= 7
            out += bytes(reversed(vl)) + msg
        return out + b"\x00\xff\x2f\x00"


bar = lambda b, beat=1.0: (b - 1) * 4 + (beat - 1)          # bar and beat (both from 1) -> beats from the start

# ---------------------------------------------------------------- harmony: the chord of every bar (or of its two halves)
CH = {  # bass (octave 2), tones as pitch classes from low to high
    "D": ("D2", ["D", "F#", "A"]), "A/C#": ("C#2", ["A", "C#", "E"]), "Bm": ("B1", ["B", "D", "F#"]), "G": ("G1", ["G", "B", "D"]),
    "D/F#": ("F#1", ["D", "F#", "A"]), "Em7": ("E2", ["E", "G", "B", "D"]), "A": ("A1", ["A", "C#", "E"]), "Asus": ("A1", ["A", "D", "E"]),
    "D/A": ("A1", ["D", "F#", "A"]), "Gmaj7": ("G1", ["G", "B", "D", "F#"]), "Bm7": ("B1", ["B", "D", "F#", "A"]), "Dadd9": ("D2", ["D", "E", "F#", "A"]),
}
BARS = {
    1: ["Dadd9"], 2: ["Bm7"], 3: ["Gmaj7"], 4: ["Asus", "A"],
    5: ["D"], 6: ["A/C#"], 7: ["Bm"], 8: ["G"], 9: ["D/F#"], 10: ["G"], 11: ["Em7"], 12: ["A"],
    13: ["D"], 14: ["A/C#"], 15: ["Bm"], 16: ["G"], 17: ["Asus", "A"],
    18: ["G"], 19: ["D/F#"], 20: ["Em7"], 21: ["A"], 22: ["Bm"], 23: ["G"],
    24: ["Bm"], 25: ["Gmaj7"], 26: ["Em7"], 27: ["Asus"],
    28: ["D"], 29: ["A/C#"], 30: ["Bm"], 31: ["G"], 32: ["D/F#"], 33: ["Em7"], 34: ["A"],
    35: ["Bm"], 36: ["G"], 37: ["D/A"], 38: ["Asus"], 39: ["A"],
    40: ["G"], 41: ["D/F#"], 42: ["Em7", "A"],
    43: ["Dadd9"], 44: ["Bm7"], 45: ["Gmaj7"], 46: ["Asus", "A"],
    47: ["Dadd9"], 48: ["Bm7"], 49: ["Gmaj7", "A"],
    50: ["D"], 51: ["A/C#"], 52: ["Bm"], 53: ["G"], 54: ["Em7", "A"], 55: ["D"],
}
NB = 55


def tones(ch, lo):
    """The chord's tones upwards from MIDI note `lo` (two octaves of them)."""
    pcs = [NOTE[t[0]] + (1 if "#" in t else 0) for t in CH[ch][1]]
    return [p for p in range(lo, lo + 30) if p % 12 in pcs]


piano = Track(0, 0, vol=104, pan=60, rev=96)
violin = Track(1, 48, vol=96, pan=52, rev=110)           # the tune
pad = Track(2, 49, vol=84, pan=70, rev=118)              # slow strings under everything
harp = Track(3, 46, vol=92, pan=84, rev=104)
celesta = Track(4, 8, vol=96, pan=44, rev=112)
pizz = Track(5, 45, vol=100, pan=74, rev=90)
cello = Track(6, 42, vol=92, pan=64, rev=104)            # the bass line, long
flute = Track(7, 73, vol=78, pan=40, rev=112)
koto = Track(8, 107, vol=98, pan=58, rev=110)
choir = Track(10, 52, vol=62, pan=64, rev=124)
timp = Track(11, 47, vol=88, pan=64, rev=100)
epiano = Track(12, 4, vol=84, pan=64, rev=110, cho=40)
TRACKS = [piano, violin, pad, harp, celesta, pizz, cello, flute, koto, choir, timp, epiano]

SECTION = {}                                           # bar -> section letter
for b in range(1, NB + 1):
    SECTION[b] = ("I" if b <= 4 else "A" if b <= 17 else "R" if 24 <= b <= 27 else "B" if b <= 34 else "C" if b <= 39 else "T" if b <= 42
                  else "Q" if b <= 46 else "N" if b <= 49 else "F")
LIFT, BACK0 = 13, 28                                   # the theme's second, lifted statement begins; the theme returns in the middle section

# ---------------------------------------------------------------- the bed: held strings, the bass, the piano's figure
for b in range(1, NB + 1):
    chs = BARS[b]; sec = SECTION[b]
    for h, ch in enumerate(chs):
        t0 = bar(b) + h * (4 / len(chs)); ln = 4 / len(chs)
        lvl = {"I": 46, "A": 62, "B": 50, "R": 42, "C": 76, "T": 60, "Q": 42, "N": 44, "F": 80}[sec]
        if b >= LIFT and sec == "A": lvl = 70
        for p in tones(ch, 50)[:3] + ([tones(ch, 62)[1]] if sec in "ACTF" else []):
            pad.note(t0, ln + 0.3, p, lvl, human=0.03)
        bass = n(CH[ch][0])
        if sec not in "IRNQ" or (sec == "I" and b >= 4):
            cello.note(t0, ln + 0.1, bass + 12, {"I": 50, "A": 66, "B": 56, "C": 78, "T": 58, "F": 82}.get(sec, 50), human=0.02)
        if (sec in "CF" or (sec == "A" and b >= LIFT)) and bass >= 36:
            cello.note(t0, ln + 0.1, bass, 60, human=0.02)
    # the piano's flowing eighths (the theme's bars), broken chords elsewhere
    if sec in "AF" or (sec == "B" and b >= BACK0):
        for h, ch in enumerate(chs):
            t0 = bar(b) + h * (4 / len(chs)); T = tones(ch, 50)
            fig = [T[0], T[2], T[3], T[4], T[5], T[4], T[3], T[2]] if len(chs) == 1 else [T[0], T[2], T[3], T[4]]
            v0 = {"A": 58, "B": 54, "F": 70}[sec] + (6 if b >= LIFT and sec == "A" else 0)
            for k, p in enumerate(fig):
                piano.note(t0 + k * 0.5, 0.9, p, v0 + (8 if k == 0 else 0) - (k % 2) * 4)
            piano.note(t0, 3.6 / len(chs), n(CH[ch][0]) + 12, v0 - 4)
        piano.cc(bar(b), 64, 127); piano.cc(bar(b) + 3.85, 64, 0)
    elif sec in "CT":
        for h, ch in enumerate(chs):
            T = tones(ch, 50); t0 = bar(b) + h * (4 / len(chs))
            fig = [T[0], T[2], T[4], T[5], T[6], T[5], T[4], T[2]] if len(chs) == 1 else [T[0], T[2], T[4], T[5]]
            for k, p in enumerate(fig):
                piano.note(t0 + k * 0.5, 1.0, p, (60 if sec == "C" else 46) - (k % 2) * 5)
        piano.cc(bar(b), 64, 127); piano.cc(bar(b) + 3.85, 64, 0)
    # the light bars: plucked strings and harp keep the pulse
    if sec == "B" and b < 24:
        ch = chs[0]; T = tones(ch, 57)
        for k, (off, i) in enumerate([(0, 0), (0.5, 2), (1, 3), (1.5, 2), (2, 4), (2.5, 3), (3, 2), (3.5, 3)]):
            pizz.note(bar(b) + off, 0.4, T[i], 62 - (k % 2) * 8)
        pizz.note(bar(b), 0.5, n(CH[ch][0]) + 24, 70); pizz.note(bar(b) + 2, 0.5, n(CH[ch][0]) + 24, 60)
        for k in range(4):
            harp.note(bar(b) + k + 0.25, 0.8, tones(ch, 74)[(k * 2) % 4], 46)
    if (sec == "A" and b >= LIFT) or sec == "F" or (sec == "B" and b >= BACK0):
        ch = chs[0]; T = tones(ch, 62)
        for k in range(8):
            harp.note(bar(b) + k * 0.5, 0.9, T[[0, 2, 3, 4, 5, 4, 3, 2][k]], 44 if sec != "F" else 54)

# the swell of the held strings through the piece (expression)
pad.cc(0, 11, 40)
for b0, b1, v0, v1 in [(1, 4, 40, 84), (4, 5, 84, 112), (5, 13, 100, 104), (13, 17, 112, 118), (17, 18, 118, 84), (18, 24, 84, 88), (24, 28, 62, 66),
                       (28, 34, 92, 108), (34, 35, 108, 124), (35, 39, 124, 116), (39, 40, 116, 96), (40, 43, 96, 80), (43, 47, 62, 58),
                       (47, 49.5, 60, 72), (49.5, 50, 72, 122), (50, 55, 124, 124), (55, 56.5, 124, 70)]:
    pad.ramp(bar(b0), bar(b1), 11, v0, v1)

# ---------------------------------------------------------------- the tune
def tune(track, b, notes, vel, octave=0, legato=0.96):
    t = bar(b)
    for dur, p in notes:
        if p: track.note(t, dur * legato, n(p) + 12 * octave, vel, human=0.02)
        t += dur


# single notes of the piano over the held chord: the opening, and again when night comes down on the river
QUIET = [[(2, None), (2, "A5")], [(1.5, "F#5"), (0.5, "E5"), (2, "D5")], [(1, "B4"), (1, "D5"), (2, "F#5")], [(3, "E5"), (1, "A5")]]
for first, vel in ((1, 56), (43, 50)):
    piano.cc(bar(first), 64, 127)
    for k, notes in enumerate(QUIET):
        b = first + k
        tune(piano, b, notes, vel + k * 3, legato=1.6)
        piano.note(bar(b), 3.8, n(CH[BARS[b][0]][0]) + 12, 40)       # a low octave under them, very soft
        piano.cc(bar(b) + 3.9, 64, 0); piano.cc(bar(b + 1) + 0.02, 64, 127)
    piano.cc(bar(first + 4) - 0.05, 64, 0)
# the title: a run of plucked strings up the five-note scale
for k, p in enumerate(["D4", "E4", "F#4", "A4", "B4", "D5", "E5", "F#5", "A5", "B5", "D6"]):
    koto.note(bar(1, 2.2) + k * 0.085, 2.4, p, 58 + k * 3, human=0.004)
for k, p in enumerate(["A5", "F#5", "E5", "D5"]):
    koto.note(bar(2, 3) + k * 0.5, 1.6, p, 54, human=0.01)

THEME = {  # the theme's eight bars as (beats, note)
    0: [(1, "A4"), (1, "D5"), (2, "F#5")], 1: [(3, "E5"), (1, "C#5")], 2: [(1, "D5"), (1, "F#5"), (2, "B5")], 3: [(3, "A5"), (1, "F#5")],
    4: [(1, "F#5"), (1, "A5"), (2, "D6")], 5: [(3, "B5"), (1, "A5")], 6: [(2, "G5"), (1, "F#5"), (1, "E5")], 7: [(3, "E5"), (1, "A5")],
}
for k in range(8):                                      # bars 5-12: strings alone
    tune(violin, 5 + k, THEME[k], 74)
for k in range(4):                                      # bars 13-16: its first half again, the flute an octave above, the violins doubled
    tune(violin, 13 + k, THEME[k], 84); tune(violin, 13 + k, THEME[k], 60, octave=-1)
    tune(flute, 13 + k, [(d, p if p and n(p) + 12 <= n("A6") else None) for d, p in THEME[k]], 66, octave=1)
tune(violin, 17, [(2, "A5"), (2, "E5")], 76); tune(violin, 17, [(2, "A4"), (2, "E4")], 58); tune(flute, 17, [(2, "A5"), (2, "E6")], 58)
violin.cc(0, 11, 100)
for b0, b1, v0, v1 in [(5, 9, 92, 108), (9, 13, 104, 112), (13, 16, 114, 124), (16, 18, 124, 100)]:
    violin.ramp(bar(b0), bar(b1), 11, v0, v1)

# walking in: the piano has the tune, lightly
LIGHT = {18: [(1.5, "B5"), (0.5, "D6"), (1, "B5"), (1, "G5")], 19: [(1.5, "A5"), (0.5, "F#5"), (2, "D5")], 20: [(1, "G5"), (1, "B5"), (1.5, "E6"), (0.5, "D6")],
         21: [(2, "C#6"), (1, "A5"), (1, "E5")], 22: [(1.5, "D6"), (0.5, "C#6"), (1, "B5"), (1, "F#5")], 23: [(1, "G5"), (1, "B5"), (2, "D6")]}
for b, notes in LIGHT.items():
    tune(piano, b, notes, 78, legato=0.9); tune(celesta, b, notes, 44, octave=1, legato=0.6)
    piano.note(bar(b), 1.8, n(CH[BARS[b][0]][0]) + 24, 52); piano.note(bar(b) + 2, 1.8, tones(BARS[b][0], 50)[2], 46)
# rain: a few notes, and drops high up
RAIN = {24: [(2, "F#5"), (2, "B5")], 25: [(3, "A5"), (1, "F#5")], 26: [(2, "G5"), (2, "E5")], 27: [(3, "D5"), (1, "E5")]}
piano.cc(bar(24), 64, 127)
for b, notes in RAIN.items():
    tune(piano, b, notes, 56, legato=1.5)
    T = tones(BARS[b][0], 47)
    for k, i in enumerate([0, 2, 3, 4]):
        piano.note(bar(b) + k, 3.0, T[i], 40)
    piano.cc(bar(b) + 3.9, 64, 0); piano.cc(bar(b + 1) + 0.02, 64, 127)
    for k in range(7):                                   # the drops
        celesta.note(bar(b) + random.choice([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]) + random.uniform(-0.05, 0.05), 0.5,
                     random.choice(tones(BARS[b][0], 84)[:6]), random.randint(26, 44), human=0.0)
piano.cc(bar(28) - 0.05, 64, 0)
# the theme returns (bars 28-34): strings, the piano's figure under them
BACK = {28: [(1, "F#5"), (1, "A5"), (2, "D6")], 29: [(3, "E6"), (1, "C#6")], 30: [(1, "D6"), (1, "F#6"), (2, "B5")], 31: [(3, "A5"), (1, "B5")],
        32: [(1, "A5"), (1, "D6"), (2, "F#6")], 33: [(2, "G6"), (1, "F#6"), (1, "E6")], 34: [(2, "E6"), (1, "A5"), (1, "C#6")]}
for b, notes in BACK.items():
    tune(violin, b, notes, 78 + (b - 28) * 2); tune(violin, b, notes, 56, octave=-1)
    if b >= 32: tune(flute, b, notes, 60)
violin.ramp(bar(28), bar(34), 11, 96, 116); violin.ramp(bar(34), bar(35), 11, 116, 127)
# the day goes: broad
DUSK = {35: [(2, "D6"), (2, "B5")], 36: [(2, "B5"), (2, "D6")], 37: [(3, "F#6"), (1, "E6")], 38: [(4, "D6")], 39: [(2, "C#6"), (2, "E6")]}
for b, notes in DUSK.items():
    tune(violin, b, notes, 92, legato=1.0); tune(violin, b, notes, 74, octave=-1, legato=1.0); tune(flute, b, notes, 54)
    for p in tones(BARS[b][0], 55)[:4]:
        choir.note(bar(b), 4.1, p, 50, human=0.03)
violin.ramp(bar(35), bar(38), 11, 124, 127); violin.ramp(bar(38), bar(40), 11, 127, 92)
choir.cc(0, 11, 90); choir.ramp(bar(35), bar(39), 11, 80, 110); choir.ramp(bar(39), bar(40), 11, 110, 64)
# the lights come on: the strings quieter, lights twinkling high up
GLOW = {40: [(2, "B5"), (2, "D6")], 41: [(3, "A5"), (1, "F#5")], 42: [(2, "G5"), (2, "E5")]}
for b, notes in GLOW.items():
    tune(violin, b, notes, 72, legato=1.0); tune(flute, b, notes, 50, octave=1)
    for p in tones(BARS[b][0], 55)[:3]:
        choir.note(bar(b), 4.1, p, 44, human=0.03)
    for k in range(6 + (b - 40) * 3):                    # more and more of them
        celesta.note(bar(b) + random.choice([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) + random.uniform(-0.04, 0.04), 0.6,
                     random.choice(tones(BARS[b][0], 86)[:6]), random.randint(30, 46), human=0.0)
violin.ramp(bar(40), bar(43), 11, 92, 56); choir.ramp(bar(40), bar(43), 11, 64, 30)
# night: celesta over the soft piano
NIGHT = {47: [(1, "A5"), (1, "D6"), (2, "E6")], 48: [(2, "F#6"), (2, "D6")], 49: [(2, "B5"), (1, "A5"), (1, "C#6")]}
for b, notes in NIGHT.items():
    tune(celesta, b, notes, 62, legato=0.8)
    for h, ch in enumerate(BARS[b]):
        ln = 4 / len(BARS[b])
        for k, p in enumerate(tones(ch, 50)[:4]):
            epiano.note(bar(b) + h * ln + k * 0.06, ln, p, 50, human=0.01)
# up and away: the theme, everyone
FINAL = {50: [(1, "A5"), (1, "D6"), (2, "F#6")], 51: [(3, "E6"), (1, "C#6")], 52: [(1, "D6"), (1, "F#6"), (2, "B6")], 53: [(3, "A6"), (1, "F#6")], 54: [(2, "G6"), (1, "E6"), (1, "C#6")]}
for b, notes in FINAL.items():
    tune(violin, b, notes, 96, legato=1.0); tune(violin, b, notes, 80, octave=-1, legato=1.0); tune(flute, b, notes, 62)
    for p in tones(BARS[b][0], 55)[:4]:
        choir.note(bar(b), 4.1, p, 56, human=0.03)
violin.ramp(bar(49.5), bar(50), 11, 80, 127); violin.cc(bar(50), 11, 127)
choir.ramp(bar(49.5), bar(50), 11, 50, 112)
# the last chord: held, the piano climbing through it, slower and slower
END = bar(55)
for p in ["D5", "A5", "D6"]:
    violin.note(END, 7.0, p, 84, human=0.02)
for p in tones("D", 50)[:4]:
    choir.note(END, 7.0, p, 50, human=0.03); pad.note(END, 7.5, p, 78, human=0.03)
cello.note(END, 7.5, "D2", 70); cello.note(END, 7.5, "D3", 66)
violin.ramp(END + 1.5, END + 7.0, 11, 127, 20); choir.ramp(END + 1.5, END + 7.0, 11, 112, 16)
piano.cc(END, 64, 127)
t = END
for k, p in enumerate(["D3", "A3", "D4", "F#4", "A4", "D5", "F#5", "A5", "D6"]):
    piano.note(t, 8.0, p, 70 - k * 2, human=0.004); t += 0.34 + k * 0.045
piano.note(t + 0.5, 6.0, "F#6", 46, human=0.0); celesta.note(t + 0.5, 3.0, "D7", 40, human=0.0)
piano.cc(END + 8.5, 64, 0)

# ---------------------------------------------------------------- colour at the joints: harp runs, a soft roll of the drum
def gliss(track, t_end, dur, lo, hi, vel0, vel1):
    scale = [p for p in range(n(lo), n(hi) + 1) if p % 12 in (2, 4, 6, 9, 11)]          # D E F# A B
    for k, p in enumerate(scale):
        track.note(t_end - dur + dur * k / len(scale), 1.2, p, vel0 + (vel1 - vel0) * k / len(scale), human=0.003)


gliss(harp, bar(5), 1.6, "A3", "D7", 44, 74)
gliss(harp, bar(13), 1.0, "D4", "A6", 40, 64)
gliss(harp, bar(28), 1.2, "D4", "F#6", 36, 60)
gliss(harp, bar(35), 1.8, "B3", "D7", 46, 78)
gliss(harp, bar(50), 1.8, "A3", "D7", 46, 80)
for t_end, dur, pitch, v in [(bar(5), 1.5, "D3", 52), (bar(35), 2.0, "B2", 60), (bar(50), 2.0, "D3", 62)]:      # rolls
    k, m = 0, int(dur * 9)
    for k in range(m):
        timp.note(t_end - dur + dur * k / m, 0.2, pitch, v * (0.45 + 0.55 * k / m), human=0.004)
    timp.note(t_end, 2.0, pitch, v + 14)
for b, p in [(13, "D3"), (18, "G2"), (28, "D3")]:
    timp.note(bar(b), 2.0, p, 52)

# ---------------------------------------------------------------- write, play
tempo = struct.pack(">I", round(60_000_000 / BPM))[1:]
tracks = [b"\x00\xff\x51\x03" + tempo + b"\x00\xff\x58\x04\x04\x02\x18\x08" + b"\x00\xff\x2f\x00"] + [t.data() for t in TRACKS]
mid = os.path.splitext(OUT)[0] + ".mid"
with open(mid, "wb") as f:
    f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), PPQ))
    for d in tracks:
        f.write(b"MTrk" + struct.pack(">I", len(d)) + d)
raw = os.path.splitext(OUT)[0] + "_raw.wav"
subprocess.run(["fluidsynth", "-ni", "-q", "-g", "0.55", "-r", "48000", "-F", raw, "-o", "synth.polyphony=512",
                "-o", "synth.reverb.active=1", "-o", "synth.reverb.room-size=0.82", "-o", "synth.reverb.damp=0.25", "-o", "synth.reverb.width=1.0", "-o", "synth.reverb.level=0.85",
                "-o", "synth.chorus.active=1", SF, mid], check=True)
total = NB * 4 * 60 / BPM
# The quiet passages are lifted a little (a gentle 2:1 above -30 dB: on a phone the dawn must still be heard) but stay quiet;
# then one gain for the whole piece, set so that it sits at -16 LUFS; a limiter for the few peaks above -1.5 dB; the end dies away.
comp = "highpass=f=28,acompressor=threshold=0.032:ratio=2:attack=80:release=900:makeup=1:knee=6"
m = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", raw, "-af", comp + ",ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
loud = float([l for l in m.splitlines() if l.strip().startswith("I:")][-1].split()[1])
gain = -16.0 - loud
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af",
                f"{comp},volume={gain:.2f}dB,alimiter=limit=0.84:attack=8:release=120:level=disabled,afade=t=in:d=1.2,afade=t=out:st={total + 4.8}:d=5.2",
                "-t", f"{total + 10}", "-ar", "48000", "-c:a", "pcm_s16le", OUT], check=True)
os.remove(raw)
print(f"{OUT}: {NB} bars, {total:.1f} s of music + the last chord; {sum(len(t.ev) for t in TRACKS) // 2} notes and controller changes")
