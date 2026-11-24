"""Original copyright-free cinematic score for Chongqing 3D ("重庆 · 8D山城").

Written note-by-note in Python (A-minor / C-major pentatonic-lydian mountain palette:
A, B, C, D, E, G with warm Dorian/Lydian lifts) and rendered via FluidSynth using the
open GeneralUser GS SoundFont. 100% original, zero copyrighted third-party samples.

Tempo: 72 BPM, 4/4 time -> 1 bar = 100 frames (3.3333 s) at 30 fps.
Matches the 31-bar choreography in tools/film/shots.mjs:

  Bars  1- 3  Chaotianmen & Raffles Golden Reveal   Warm held strings, guzheng pentatonic sweep, solo piano motif
  Bars  4- 5  Hillside Street Macro Dolly           Intimate pizzicato + plucked harp + light piano pulse
  Bars  6- 7  Jiefangbei CBD Push-In -> Tilt-Up     Soaring strings & cello bass rising with the skyscrapers
  Bars  8- 9  Qiansimen Bridge Walkway Glide        Propulsive piano arpeggios + broad horn/string swell
  Bars 10-12  Liziba 8D Monorail Emergence          Energetic syncopated pizzicato, koto accents & lifted theme
  Bars 13-14  Yangtze River Cableway Tracking       Airy floating flute & harp glides high over the river
  Bars 15-18  8D Infra: Sujiaba & Shihuang Tunnels  Driving low cello ostinato + architectural brass/string chords
  Bars 19-22  Great Hall Dusk -> Grand Theatre Blue Golden sunset swell melting into luminous twilight choir/celesta
  Bars 23-25  Hongyadong Spirited-Away Night Climax Lush pentatonic theme in full strings, koto cascades & warm choir
  Bars 26-27  Rainy Cyber-Chongqing Street Walk     Hushed Rhodes/e-piano chords, glistening celesta rain drops
  Bars 28-31  Nanshan Yikeshu Cyber-Night Finale    Grand panoramic full-orchestra theme + resonant final chord ring

Usage:
  python3 tools/film/music.py video/music.wav [soundfont.sf2]
"""

import os
import random
import struct
import subprocess
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "video/music.wav"
SF = sys.argv[2] if len(sys.argv) > 2 else "/usr/share/minuet/soundfonts/GeneralUser-v1.47.sf2"
BPM, PPQ = 72, 480
NB = 31
random.seed(2026)

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def n(name: str) -> int:
    """'F#5' -> MIDI note number (C4 = 60)."""
    p = NOTE[name[0]]
    i = 1
    if name[i] == "#":
        p += 1
        i += 1
    elif name[i] == "b":
        p -= 1
        i += 1
    return p + 12 * (int(name[i:]) + 1)


class Track:
    def __init__(self, ch, prog, vol=100, pan=64, rev=104, cho=0):
        self.ch = ch
        self.ev = [
            (0.0, 0, bytes([0xC0 | ch, prog])),
            (0.0, 0, bytes([0xB0 | ch, 7, vol])),
            (0.0, 0, bytes([0xB0 | ch, 10, pan])),
            (0.0, 0, bytes([0xB0 | ch, 91, rev])),
            (0.0, 0, bytes([0xB0 | ch, 93, cho])),
            (0.0, 0, bytes([0xB0 | ch, 11, 127])),
        ]

    def note(self, beat, dur, pitch, vel, human=0.011):
        if isinstance(pitch, str):
            pitch = n(pitch)
        t0 = max(0.0, beat + random.uniform(-human, human))
        v = max(1, min(127, int(vel + random.uniform(-3.5, 3.5))))
        self.ev.append((t0, 1, bytes([0x90 | self.ch, pitch, v])))
        self.ev.append((t0 + max(dur, 0.05), 0, bytes([0x80 | self.ch, pitch, 0])))

    def cc(self, beat, num, val):
        self.ev.append((max(0.0, beat), 0, bytes([0xB0 | self.ch, num, max(0, min(127, int(val)))])))

    def ramp(self, b0, b1, num, v0, v1, steps=None):
        steps = steps or max(2, int((b1 - b0) * 4))
        for k in range(steps + 1):
            self.cc(b0 + (b1 - b0) * k / steps, num, v0 + (v1 - v0) * k / steps)

    def data(self):
        out = bytearray()
        last = 0
        for t, _, msg in sorted(self.ev, key=lambda e: (round(e[0] * PPQ), e[1])):
            tick = round(t * PPQ)
            d = tick - last
            last = tick
            vl = [d & 0x7F]
            d >>= 7
            while d:
                vl.append((d & 0x7F) | 0x80)
                d >>= 7
            out.extend(reversed(vl))
            out.extend(msg)
        out.extend(b"\x00\xff\x2f\x00")
        return bytes(out)


bar = lambda b, beat=1.0: (b - 1) * 4.0 + (beat - 1.0)

# Warm cinematic mountain-city chord dictionary (C major / A minor / F Lydian)
CH = {
    "Cadd9": ("C2", ["C", "D", "E", "G"]),
    "G/B":   ("B1", ["G", "B", "D"]),
    "Am7":   ("A1", ["A", "C", "E", "G"]),
    "Am9":   ("A1", ["A", "B", "C", "E", "G"]),
    "Fmaj7": ("F1", ["F", "A", "C", "E"]),
    "Fadd9": ("F1", ["F", "G", "A", "C"]),
    "Dm7":   ("D2", ["D", "F", "A", "C"]),
    "Em7":   ("E2", ["E", "G", "B", "D"]),
    "G":     ("G1", ["G", "B", "D"]),
    "Gsus4": ("G1", ["G", "C", "D"]),
    "C":     ("C2", ["C", "E", "G"]),
    "C/E":   ("E2", ["C", "E", "G"]),
}

BARS = {
    # S1: Chaotianmen & Raffles Golden Reveal (1-3)
    1: ["Cadd9"], 2: ["Am9"], 3: ["Fmaj7", "Gsus4"],
    # S2: Street Macro Dolly (4-5)
    4: ["Cadd9"], 5: ["Em7"],
    # S3: Jiefangbei CBD Push-In -> Tilt-Up (6-7)
    6: ["Fmaj7"], 7: ["G"],
    # S4: Qiansimen Bridge Walkway Glide (8-9)
    8: ["Am7"], 9: ["Fadd9"],
    # S5: Liziba 8D Monorail Emergence (10-12)
    10: ["C"], 11: ["G/B"], 12: ["Am7", "G"],
    # S6: Yangtze River Cableway Tracking (13-14)
    13: ["Fmaj7"], 14: ["C/E"],
    # S7a: Sujiaba 72m Spiral (15-16)
    15: ["Dm7"], 16: ["Am7"],
    # S7b: Shihuang Twin Tunnel Portals (17-18)
    17: ["Fadd9"], 18: ["Gsus4", "G"],
    # S8a: Great Hall Sunset Dusk (19-20)
    19: ["Am9"], 20: ["Fmaj7"],
    # S8b: Grand Theatre Blue Hour (21-22)
    21: ["Cadd9"], 22: ["Em7", "G"],
    # S9: Hongyadong Spirited-Away Night Climax (23-25)
    23: ["Am7"], 24: ["Fmaj7"], 25: ["Dm7", "G"],
    # S10: Rainy Cyber-Chongqing Walk (26-27)
    26: ["Am9"], 27: ["Fmaj7", "Em7"],
    # S11: Nanshan Yikeshu Cyber-Night Grand Finale (28-31)
    28: ["Cadd9"], 29: ["G/B"], 30: ["Fmaj7", "G"], 31: ["Cadd9"],
}


def tones(ch, lo):
    pcs = []
    for t in CH[ch][1]:
        pc = NOTE[t[0]]
        if len(t) > 1 and t[1] == "#":
            pc = (pc + 1) % 12
        elif len(t) > 1 and t[1] == "b":
            pc = (pc - 1) % 12
        pcs.append(pc)
    return [p for p in range(lo, lo + 30) if p % 12 in pcs]


# Instruments (avoid channel 9 percussion)
piano   = Track(0,  0,  vol=102, pan=58, rev=96)
strings = Track(1,  48, vol=98,  pan=50, rev=112)
pad     = Track(2,  49, vol=86,  pan=72, rev=118)
harp    = Track(3,  46, vol=90,  pan=86, rev=108)
celesta = Track(4,  8,  vol=92,  pan=42, rev=116)
pizz    = Track(5,  45, vol=98,  pan=76, rev=88)
cello   = Track(6,  42, vol=94,  pan=64, rev=104)
flute   = Track(7,  73, vol=80,  pan=38, rev=114)
koto    = Track(8,  107,vol=100, pan=54, rev=112)   # Guzheng / plucked zither colour
choir   = Track(10, 52, vol=66,  pan=64, rev=124)
timp    = Track(11, 47, vol=86,  pan=64, rev=100)
epiano  = Track(12, 4,  vol=88,  pan=66, rev=112, cho=42)
horn    = Track(13, 60, vol=78,  pan=46, rev=112)

TRACKS = [piano, strings, pad, harp, celesta, pizz, cello, flute, koto, choir, timp, epiano, horn]


def section(b):
    if b <= 3:   return "OPEN"
    if b <= 5:   return "STREET"
    if b <= 9:   return "RISE"
    if b <= 12:  return "LIZIBA"
    if b <= 14:  return "CABLE"
    if b <= 18:  return "INFRA"
    if b <= 22:  return "DUSK"
    if b <= 25:  return "HONGYA"
    if b <= 27:  return "RAIN"
    return "FINALE"


def tune(track, b, notes, vel, octave=0, legato=0.95):
    t = bar(b)
    for dur, p in notes:
        if p:
            track.note(t, dur * legato, n(p) + 12 * octave, vel, human=0.018)
        t += dur


def pent_gliss(track, t_end, dur, lo, hi, vel0, vel1):
    scale = [p for p in range(n(lo), n(hi) + 1) if p % 12 in (0, 2, 4, 7, 9)]  # C D E G A
    for k, p in enumerate(scale):
        track.note(t_end - dur + dur * k / len(scale), 1.5, p, vel0 + (vel1 - vel0) * k / len(scale), human=0.003)


# ---- 1. Harmonic bed (strings pad, cello bass, flowing piano / pizzicato pulse)
PAD_LVL = {"OPEN": 54, "STREET": 46, "RISE": 66, "LIZIBA": 68, "CABLE": 58, "INFRA": 72, "DUSK": 70, "HONGYA": 80, "RAIN": 46, "FINALE": 84}
CEL_LVL = {"OPEN": 52, "STREET": 48, "RISE": 70, "LIZIBA": 74, "CABLE": 60, "INFRA": 78, "DUSK": 70, "HONGYA": 84, "RAIN": 44, "FINALE": 86}

for b in range(1, NB + 1):
    sec = section(b)
    chs = BARS[b]
    for h, ch in enumerate(chs):
        t0 = bar(b) + h * (4.0 / len(chs))
        ln = 4.0 / len(chs)
        T = tones(ch, 48)
        for p in T[:3] + ([tones(ch, 60)[1]] if sec in ("RISE", "INFRA", "DUSK", "HONGYA", "FINALE") else []):
            pad.note(t0, ln + 0.35, p, PAD_LVL[sec], human=0.025)
        bass = n(CH[ch][0])
        if sec != "RAIN" or b == 27:
            cello.note(t0, ln + 0.15, bass + 12, CEL_LVL[sec], human=0.02)
        if sec in ("INFRA", "HONGYA", "FINALE") and bass >= 33:
            cello.note(t0, ln + 0.15, bass, 62, human=0.02)

    # Flowing piano arpeggio in sweeping sections
    if sec in ("RISE", "LIZIBA", "DUSK", "HONGYA", "FINALE"):
        for h, ch in enumerate(chs):
            t0 = bar(b) + h * (4.0 / len(chs))
            T = tones(ch, 48)
            fig = [T[0], T[2], T[3], T[4], T[5], T[4], T[3], T[2]] if len(chs) == 1 else [T[0], T[2], T[3], T[4]]
            v0 = {"RISE": 60, "LIZIBA": 64, "DUSK": 54, "HONGYA": 68, "FINALE": 72}[sec]
            for k, p in enumerate(fig):
                piano.note(t0 + k * 0.5, 0.95, p, v0 + (7 if k == 0 else 0) - (k % 2) * 4)
            piano.note(t0, 3.6 / len(chs), n(CH[ch][0]) + 12, v0 - 6)
        piano.cc(bar(b), 64, 127)
        piano.cc(bar(b) + 3.85, 64, 0)

    # Street-level pizzicato + delicate harp pulse
    if sec in ("STREET", "LIZIBA"):
        ch = chs[0]
        T = tones(ch, 55)
        pat = [(0, 0), (0.5, 2), (1, 3), (1.5, 2), (2, 4), (2.5, 3), (3, 2), (3.5, 3)]
        for k, (off, idx) in enumerate(pat):
            pizz.note(bar(b) + off, 0.42, T[idx], (64 if sec == "STREET" else 70) - (k % 2) * 8)
        pizz.note(bar(b), 0.5, n(CH[ch][0]) + 24, 72)
        pizz.note(bar(b) + 2, 0.5, n(CH[ch][0]) + 24, 62)

    # Cableway floating harp arpeggios
    if sec in ("CABLE", "HONGYA", "FINALE"):
        ch = chs[0]
        T = tones(ch, 60)
        for k in range(8):
            harp.note(bar(b) + k * 0.5, 1.0, T[[0, 2, 3, 4, 5, 4, 3, 2][k]], 50 if sec != "FINALE" else 58)

    # 8D Infrastructure rhythmic cello/horn pulse
    if sec == "INFRA":
        ch = chs[0]
        bass = n(CH[ch][0]) + 12
        for k in range(8):
            cello.note(bar(b) + k * 0.5, 0.45, bass + (7 if k in (3, 7) else 0), 62 + (8 if k % 2 == 0 else 0))
        T = tones(ch, 53)
        horn.note(bar(b), 3.8, T[0], 62, human=0.02)
        horn.note(bar(b), 3.8, T[2], 56, human=0.02)

# Pad expression swell curve across the whole film
pad.cc(0, 11, 48)
for b0, b1, v0, v1 in [
    (1, 3, 48, 92), (3, 4, 92, 68), (4, 6, 68, 86), (6, 10, 86, 112),
    (10, 13, 106, 116), (13, 15, 92, 84), (15, 19, 98, 118),
    (19, 22.5, 104, 116), (22.5, 23, 116, 126), (23, 25.5, 126, 114),
    (25.5, 26, 114, 58), (26, 27.5, 58, 74), (27.5, 28, 74, 124),
    (28, 31, 124, 124), (31, 32.5, 124, 64),
]:
    pad.ramp(bar(b0), bar(b1), 11, v0, v1)

# ---- 2. Opening: Guzheng mountain cascade + spacious solo piano (Bars 1-3)
for k, p in enumerate(["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "A5", "C6"]):
    koto.note(bar(1, 1.4) + k * 0.09, 2.6, p, 58 + k * 3, human=0.004)
for k, p in enumerate(["G5", "E5", "D5", "C5"]):
    koto.note(bar(2, 2.5) + k * 0.45, 1.8, p, 56, human=0.008)

OPEN_MEL = {
    1: [(1.5, None), (1.5, "G5"), (1.0, "A5")],
    2: [(2.0, "E5"), (1.0, "D5"), (1.0, "C5")],
    3: [(1.5, "A4"), (1.5, "C5"), (1.0, "D5")],
}
piano.cc(bar(1), 64, 127)
for b, notes in OPEN_MEL.items():
    tune(piano, b, notes, 62 + b * 3, legato=1.45)
    piano.note(bar(b), 3.7, n(CH[BARS[b][0]][0]) + 12, 46)
    piano.cc(bar(b) + 3.88, 64, 0)
    piano.cc(bar(b + 1) + 0.02, 64, 127)
piano.cc(bar(4) - 0.04, 64, 0)

# ---- 3. Street Macro (Bars 4-5): bright intimate piano + sparkling celesta
STREET_MEL = {
    4: [(1.0, "E5"), (0.5, "G5"), (1.0, "A5"), (1.5, "G5")],
    5: [(1.0, "E5"), (1.0, "D5"), (2.0, "B4")],
}
for b, notes in STREET_MEL.items():
    tune(piano, b, notes, 76, legato=0.9)
    tune(celesta, b, notes, 42, octave=1, legato=0.6)

# ---- 4. CBD Rise & Qiansimen Glide (Bars 6-9): Main Mountain-City Theme
THEME_A = {
    6: [(1.0, "A4"), (1.0, "C5"), (2.0, "E5")],
    7: [(2.5, "D5"), (1.5, "G5")],
    8: [(1.0, "E5"), (1.0, "G5"), (2.0, "A5")],
    9: [(3.0, "G5"), (1.0, "E5")],
}
for b, notes in THEME_A.items():
    tune(strings, b, notes, 78 + (b - 6) * 3)
    if b >= 8:
        tune(strings, b, notes, 58, octave=-1)
        tune(flute, b, notes, 62, octave=1)

# ---- 5. Liziba Monorail (Bars 10-12): buoyant kinetic theme + koto highlights
LIZIBA_MEL = {
    10: [(1.0, "G5"), (0.5, "A5"), (1.0, "C6"), (1.5, "G5")],
    11: [(1.5, "E5"), (0.5, "G5"), (2.0, "D5")],
    12: [(1.0, "C5"), (1.0, "E5"), (1.0, "G5"), (1.0, "A5")],
}
for b, notes in LIZIBA_MEL.items():
    tune(strings, b, notes, 82)
    tune(koto, b, notes, 66, legato=0.85)
    tune(flute, b, notes, 58, octave=1)

# ---- 6. Yangtze Cableway (Bars 13-14): soaring airy flute over harp
CABLE_MEL = {
    13: [(2.0, "C6"), (1.0, "A5"), (1.0, "G5")],
    14: [(2.5, "E5"), (1.5, "G5")],
}
for b, notes in CABLE_MEL.items():
    tune(flute, b, notes, 74, legato=1.05)
    tune(strings, b, notes, 66, legato=1.0)

# ---- 7. 8D Infrastructure: Sujiaba & Shihuang Tunnels (Bars 15-18): bold architectural motif
INFRA_MEL = {
    15: [(1.5, "D5"), (0.5, "F5"), (2.0, "A5")],
    16: [(2.0, "G5"), (2.0, "E5")],
    17: [(1.5, "C5"), (0.5, "F5"), (2.0, "A5")],
    18: [(2.0, "G5"), (2.0, "D6")],
}
for b, notes in INFRA_MEL.items():
    tune(strings, b, notes, 84)
    tune(strings, b, notes, 64, octave=-1)
    tune(horn, b, notes, 68, octave=-1, legato=0.95)

# ---- 8. Great Hall Dusk & Grand Theatre Blue Hour (Bars 19-22): warm twilight choir + celesta stars
DUSK_MEL = {
    19: [(2.0, "E6"), (2.0, "C6")],
    20: [(2.0, "A5"), (2.0, "C6")],
    21: [(3.0, "G5"), (1.0, "E5")],
    22: [(2.0, "B5"), (2.0, "G5")],
}
for b, notes in DUSK_MEL.items():
    tune(strings, b, notes, 78, legato=1.0)
    tune(flute, b, notes, 56, legato=1.0)
    for p in tones(BARS[b][0], 55)[:4]:
        choir.note(bar(b), 4.1, p, 48, human=0.03)
    if b >= 21:
        for k in range(6 + (b - 21) * 3):
            celesta.note(
                bar(b) + random.choice([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) + random.uniform(-0.04, 0.04),
                0.7,
                random.choice(tones(BARS[b][0], 84)[:6]),
                random.randint(30, 46),
                human=0.0,
            )

# ---- 9. Hongyadong Spirited-Away Night Climax (Bars 23-25): lush eastern-cinematic swell!
HONGYA_MEL = {
    23: [(1.0, "E5"), (1.0, "A5"), (2.0, "C6")],
    24: [(1.5, "A5"), (0.5, "G5"), (2.0, "E5")],
    25: [(1.0, "D5"), (1.0, "E5"), (1.0, "G5"), (1.0, "A5")],
}
for b, notes in HONGYA_MEL.items():
    tune(strings, b, notes, 92, legato=1.0)
    tune(strings, b, notes, 74, octave=-1, legato=1.0)
    tune(koto, b, notes, 78, legato=0.95)
    tune(flute, b, notes, 64, octave=1)
    for p in tones(BARS[b][0], 55)[:4]:
        choir.note(bar(b), 4.1, p, 56, human=0.03)
# Iconic cascading guzheng pentatonic flourish on Hongyadong reveal!
pent_gliss(koto, bar(23, 1.2), 1.1, "A3", "E6", 54, 84)
pent_gliss(koto, bar(25, 4.0), 1.2, "D4", "G6", 50, 78)

# ---- 10. Rainy Cyber-Chongqing Walk (Bars 26-27): neon e-piano + shimmering raindrop celesta
RAIN_MEL = {
    26: [(2.0, "E5"), (2.0, "G5")],
    27: [(1.5, "A5"), (0.5, "G5"), (2.0, "E5")],
}
for b, notes in RAIN_MEL.items():
    tune(celesta, b, notes, 64, legato=0.85)
    for h, ch in enumerate(BARS[b]):
        ln = 4.0 / len(BARS[b])
        for k, p in enumerate(tones(ch, 50)[:4]):
            epiano.note(bar(b) + h * ln + k * 0.07, ln + 0.1, p, 54, human=0.01)
    for k in range(9):
        celesta.note(
            bar(b) + random.choice([0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75]) + random.uniform(-0.05, 0.05),
            0.55,
            random.choice(tones(BARS[b][0], 84)[:6]),
            random.randint(28, 46),
            human=0.0,
        )

# ---- 11. Nanshan Cyber-Night Grand Finale (Bars 28-31): soaring full-orchestra return + held final chord
FINALE_MEL = {
    28: [(1.0, "G5"), (1.0, "C6"), (2.0, "E6")],
    29: [(2.5, "D6"), (1.5, "G6")],
    30: [(1.5, "E6"), (0.5, "D6"), (1.0, "C6"), (1.0, "B5")],
}
for b, notes in FINALE_MEL.items():
    tune(strings, b, notes, 96, legato=1.0)
    tune(strings, b, notes, 80, octave=-1, legato=1.0)
    tune(flute, b, notes, 64)
    tune(horn, b, notes, 70, octave=-1)
    for p in tones(BARS[b][0], 55)[:4]:
        choir.note(bar(b), 4.1, p, 58, human=0.03)

# Final bar 31 + coda chord ringing cleanly into the end title card
END = bar(31)
for p in ["C5", "G5", "C6"]:
    strings.note(END, 7.5, p, 86, human=0.02)
for p in tones("Cadd9", 48)[:4]:
    choir.note(END, 7.5, p, 54, human=0.03)
    pad.note(END, 8.0, p, 80, human=0.03)
cello.note(END, 8.0, "C2", 74)
cello.note(END, 8.0, "C3", 68)
strings.ramp(END + 2.0, END + 7.5, 11, 126, 18)
choir.ramp(END + 2.0, END + 7.5, 11, 110, 14)

piano.cc(END, 64, 127)
t = END
for k, p in enumerate(["C3", "G3", "C4", "D4", "E4", "G4", "C5", "E5", "G5"]):
    piano.note(t, 7.5, p, 68 - k * 2, human=0.004)
    t += 0.34 + k * 0.045
piano.note(t + 0.4, 5.5, "C6", 48, human=0.0)
celesta.note(t + 0.4, 3.0, "G6", 42, human=0.0)
piano.cc(END + 8.5, 64, 0)

# ---- 12. Structural transitions: harp swells & soft timpani rolls
pent_gliss(harp, bar(6), 1.4, "C4", "G6", 42, 72)
pent_gliss(harp, bar(10), 1.2, "C4", "C7", 44, 74)
pent_gliss(harp, bar(19), 1.5, "A3", "E6", 44, 72)
pent_gliss(harp, bar(23), 1.8, "A3", "C7", 48, 82)
pent_gliss(harp, bar(28), 1.8, "C4", "C7", 50, 84)

for t_end, dur, pitch, v in [(bar(6), 1.5, "F2", 52), (bar(15), 1.6, "D2", 56), (bar(23), 2.0, "A2", 62), (bar(28), 2.0, "C3", 64)]:
    m = int(dur * 9)
    for k in range(m):
        timp.note(t_end - dur + dur * k / m, 0.2, pitch, v * (0.45 + 0.55 * k / m), human=0.004)
    timp.note(t_end, 2.0, pitch, v + 14)

# ---- Write MIDI & render via FluidSynth + EBU R128 loudness normalization (-16 LUFS)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
tempo = struct.pack(">I", round(60_000_000 / BPM))[1:]
midi_tracks = [b"\x00\xff\x51\x03" + tempo + b"\x00\xff\x58\x04\x04\x02\x18\x08" + b"\x00\xff\x2f\x00"] + [tr.data() for tr in TRACKS]
mid = os.path.splitext(OUT)[0] + ".mid"
with open(mid, "wb") as f:
    f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(midi_tracks), PPQ))
    for d in midi_tracks:
        f.write(b"MTrk" + struct.pack(">I", len(d)) + d)

raw = os.path.splitext(OUT)[0] + "_raw.wav"
subprocess.run(
    [
        "fluidsynth", "-ni", "-q", "-g", "0.55", "-r", "48000", "-F", raw,
        "-o", "synth.polyphony=512",
        "-o", "synth.reverb.active=1", "-o", "synth.reverb.room-size=0.84",
        "-o", "synth.reverb.damp=0.26", "-o", "synth.reverb.width=1.0",
        "-o", "synth.reverb.level=0.86", "-o", "synth.chorus.active=1",
        SF, mid,
    ],
    check=True,
)

total = NB * 4.0 * 60.0 / BPM  # 103.333s
target_dur = total + 3.667     # 107.0s clean film length
comp = "highpass=f=28,acompressor=threshold=0.032:ratio=2:attack=80:release=900:makeup=1:knee=6"
m = subprocess.run(
    ["ffmpeg", "-hide_banner", "-nostats", "-i", raw, "-af", comp + ",ebur128", "-f", "null", "-"],
    capture_output=True, text=True, check=True,
).stderr
loud = float([l for l in m.splitlines() if l.strip().startswith("I:")][-1].split()[1])
gain = -16.0 - loud
subprocess.run(
    [
        "ffmpeg", "-y", "-loglevel", "error", "-i", raw,
        "-af", f"{comp},volume={gain:.2f}dB,alimiter=limit=0.84:attack=8:release=120:level=disabled,afade=t=in:d=1.0,afade=t=out:st={target_dur - 3.6:.3f}:d=3.6",
        "-t", f"{target_dur:.3f}", "-ar", "48000", "-c:a", "pcm_s16le", OUT,
    ],
    check=True,
)
os.remove(raw)
print(f"{OUT}: {NB} bars ({total:.2f}s + coda -> {target_dur:.2f}s), gain={gain:+.2f} dB")
