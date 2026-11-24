"""Original light background music for the introduction film, synthesised from scratch (no samples, no soundfonts).

A plucked-string voice (Karplus-Strong with a fractional-delay all-pass, so it sounds a bit like a guzheng), a soft pad,
a low string bass and a few bell tones, in D major pentatonic at 72 bpm, with a synthetic hall reverb.
Sections follow the film: an opening, the daytime tour, a night section, a return of the theme.

usage: music.py <out.wav> [seconds]
"""
import sys
import numpy as np
from scipy.signal import lfilter, fftconvolve, butter, sosfilt

SR = 44100
OUT = sys.argv[1]
LENGTH = float(sys.argv[2]) if len(sys.argv) > 2 else 94.0
BPM = 72.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)
N = int((LENGTH + 6) * SR)
mixL = np.zeros(N); mixR = np.zeros(N)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    mixL[i:i + len(sig)] += sig * l
    mixR[i:i + len(sig)] += sig * r


def pluck(m, dur=3.2, bright=0.55, decay=0.996):
    """Karplus-Strong string with a fractional delay (all-pass) for exact tuning."""
    f = hz(m)
    period = SR / f - 0.5                      # the two-point average adds half a sample
    Nd = int(np.floor(period)); d = period - Nd
    if d < 0.1:
        Nd -= 1; d += 1.0
    c = (1 - d) / (1 + d)
    n = int(dur * SR)
    burst = rng.standard_normal(Nd + 2)
    # brightness: low-pass the excitation; pluck position comb for a woody tone
    k = max(1, int(round((1 - bright) * 6)))
    burst = np.convolve(burst, np.ones(k) / k, mode="same")
    burst -= burst.mean()
    x = np.zeros(n); x[: len(burst)] = burst
    g = decay ** (440.0 / f) ** 0.35 if f > 440 else decay
    a = np.zeros(Nd + 3); a[0] = 1; a[1] = c
    a[Nd] += -g / 2 * c; a[Nd + 1] += -g / 2 * (1 + c); a[Nd + 2] += -g / 2
    y = lfilter([1, c], a, x)
    # gentle attack click removal and a soft release
    env = np.ones(n); r = int(0.25 * SR); env[-r:] = np.linspace(1, 0, r) ** 2
    env[:64] = np.linspace(0, 1, 64)
    y *= env
    return y / (np.abs(y).max() + 1e-9)


def pad(notes, dur, attack=1.6, release=2.2):
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for m in notes:
        f = hz(m)
        for det in (-0.07, 0.0, 0.06):
            ph = rng.uniform(0, 2 * np.pi)
            ff = f * 2 ** (det / 12)
            # soft triangle-ish timbre: odd harmonics, quickly falling
            s += np.sin(2 * np.pi * ff * t + ph) + 0.12 * np.sin(2 * np.pi * 3 * ff * t + ph) + 0.03 * np.sin(2 * np.pi * 5 * ff * t)
    env = np.minimum(1, t / attack) * np.where(t < dur, 1, np.exp(-(t - dur) / (release / 3)))
    env *= 1 + 0.06 * np.sin(2 * np.pi * 0.23 * t)
    s *= env
    sos = butter(2, 1800, "low", fs=SR, output="sos")
    s = sosfilt(sos, s)
    return s / (np.abs(s).max() + 1e-9)


def bass(m, dur):
    n = int((dur + 1.5) * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t * 2.5) + 0.1 * np.sin(6 * np.pi * f * t) * np.exp(-t * 4)
    env = np.minimum(1, t / 0.04) * np.exp(-t * 0.9)
    return s * env


def bell(m, dur=4.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = np.zeros(n)
    for ratio, amp, dec in ((1, 1, 1.2), (2.76, 0.35, 2.5), (5.4, 0.18, 4.0), (8.93, 0.08, 6.0)):
        s += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t * dec)
    s *= np.minimum(1, t / 0.003)
    return s / np.abs(s).max()


# ---------------------------------------------------------------- score
D, E, Fs, G, A, B = 62, 64, 66, 67, 69, 71       # D4 ... B4 (G only appears in chords)
CH = {"D": [50, 57, 62, 66, 69], "Bm": [47, 54, 59, 62, 66], "G": [43, 50, 55, 59, 62, 69], "A": [45, 52, 57, 61, 64],
      "Em": [40, 52, 55, 59, 64], "Dsus": [50, 57, 62, 64, 69]}
PROG = ["D", "Bm", "G", "A"]

MOTIF_A = [(0, A, 1.5), (1.5, B, .5), (2, D + 12, 2), (4, E + 12, 2), (6, D + 12, 1), (7, B, 1)]
MOTIF_A2 = [(0, A, 1), (1, B, .5), (1.5, A, .5), (2, Fs, 2), (4, E, 4)]
MOTIF_B = [(0, D + 12, 1), (1, E + 12, 1), (2, Fs + 12, 2), (4, E + 12, 1), (5, D + 12, 1), (6, B, 1), (7, A, 1)]
MOTIF_B2 = [(0, B, 1), (1, D + 12, 1), (2, E + 12, 1.5), (3.5, D + 12, .5), (4, D + 12 - 12, 4)]
NIGHT = [(0, Fs + 12, 2), (2, E + 12, 1), (3, D + 12, 1), (4, B, 3), (8, A, 1), (9, B, 1), (10, D + 12, 2), (12, A, 4)]


def melody(motif, bar, octave=0, gain=0.55, pan=0.15, bright=0.6):
    for b, m, d in motif:
        place(pluck(m + octave, dur=max(2.2, d * BEAT + 1.6), bright=bright), bar * BAR + b * BEAT + rng.uniform(0, 0.012), pan + rng.uniform(-0.05, 0.05), gain)


def arp(chord, bar, gain=0.20, pattern=(0, 2, 3, 2, 1, 2, 3, 4), pan=-0.35):
    notes = CH[chord]
    for i, idx in enumerate(pattern):
        m = notes[min(idx, len(notes) - 1)]
        place(pluck(m + (12 if m < 50 else 0), dur=2.4, bright=0.4), bar * BAR + i * 0.5 * BEAT + rng.uniform(0, 0.01), pan, gain * (1.0 if i % 2 == 0 else 0.8))


def harmony(chord, bar, bars=1, gain=0.16):
    place(pad(CH[chord][1:], bars * BAR), bar * BAR, 0.0, gain)


def low(chord, bar, gain=0.22):
    place(bass(CH[chord][0], BAR), bar * BAR, -0.05, gain)


# opening: pad and a few distant high notes (0 - 10 s)
for i, c in enumerate(["D", "Dsus", "D"]):
    harmony(c, i, gain=0.13 + 0.02 * i)
place(pluck(A + 12, 4, bright=0.7), 0.6, 0.4, 0.30)
place(pluck(Fs + 12, 4, bright=0.7), 2.2 * BEAT + 0.6, -0.3, 0.24)
place(pluck(E + 12, 4, bright=0.7), 5 * BEAT, 0.3, 0.24)
place(pluck(D + 12, 5, bright=0.7), 7.5 * BEAT, -0.2, 0.26)
place(bell(D + 24, 5), 9 * BEAT, 0.5, 0.06)

# daytime tour, first pass (bars 3 - 10)
order = [MOTIF_A, MOTIF_A2, MOTIF_B, MOTIF_B2]
for k in range(8):
    bar = 3 + k
    c = PROG[k % 4]
    harmony(c, bar, gain=0.13); arp(c, bar)
    if k >= 2: low(c, bar, 0.16)
for j, mo in enumerate(order):
    melody(mo, 3 + 2 * j)

# second pass, fuller: octave doubling, bass, a counter line (bars 11 - 18)
for k in range(8):
    bar = 11 + k
    c = PROG[k % 4]
    harmony(c, bar, gain=0.15); arp(c, bar, gain=0.22); low(c, bar, 0.22)
for j, mo in enumerate(order):
    melody(mo, 11 + 2 * j, gain=0.55)
    melody(mo, 11 + 2 * j, octave=-12, gain=0.18, pan=-0.2, bright=0.35)
for k in range(0, 8, 2):
    place(bell(CH[PROG[k % 4]][-1] + 12, 4), (11 + k) * BAR + 2 * BEAT, 0.45, 0.05)

# night (bars 19 - 23): sparser, lower, bells
nprog = ["Bm", "G", "D", "A", "Bm"]
for k, c in enumerate(nprog):
    bar = 19 + k
    harmony(c, bar, gain=0.17); low(c, bar, 0.18)
    arp(c, bar, gain=0.13, pattern=(0, 2, 4, 2))
    place(bell(CH[c][-1] + 12, 5), bar * BAR + BEAT * 1.5, 0.5 - 0.25 * (k % 2), 0.07)
melody(NIGHT, 19, gain=0.5, bright=0.5)
melody(NIGHT[:4], 23, octave=0, gain=0.4, bright=0.5)

# return of the theme (bars 24 - 26) and a long final chord (bar 27, ~90 s)
for k, c in enumerate(["D", "Bm", "G"]):
    bar = 24 + k
    harmony(c, bar, gain=0.14); arp(c, bar, gain=0.17); low(c, bar, 0.18)
place(pad(CH["A"][1:], BAR * 0.5), 26.5 * BAR, 0.0, 0.12)
melody(MOTIF_A, 24, gain=0.5)
melody([(0, Fs + 12, 1), (1, E + 12, 1), (2, D + 12, 1), (3, B, 1)], 26, gain=0.48)
FIN = 27
harmony("D", FIN, bars=1.6, gain=0.15)
place(bass(50, BAR * 1.5), FIN * BAR, -0.05, 0.2)
place(pluck(D + 12, 7, bright=0.6), FIN * BAR, 0.1, 0.45)
place(pluck(A, 7, bright=0.5), FIN * BAR + 0.04, -0.2, 0.3)
place(pluck(Fs, 7, bright=0.5), FIN * BAR + 0.08, 0.25, 0.22)
place(pluck(D, 7, bright=0.45), FIN * BAR + 0.12, -0.3, 0.3)
place(bell(D + 24, 7), FIN * BAR + 0.6, 0.4, 0.06)

# ---------------------------------------------------------------- reverb, master
def hall(seconds=2.9, pre=0.02, seed=1):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-t * 6.9 / seconds)
    ir = sosfilt(butter(1, 5200, "low", fs=SR, output="sos"), ir)
    ir[: int(pre * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum())


dryL, dryR = mixL.copy(), mixR.copy()
wetL = fftconvolve(dryL, hall(seed=1))[:N]
wetR = fftconvolve(dryR, hall(seed=2))[:N]
L = dryL * 0.78 + wetL * 0.55
R = dryR * 0.78 + wetR * 0.55
hp = butter(2, 40, "high", fs=SR, output="sos")
soft = butter(1, 3800, "low", fs=SR, output="sos")          # take the edge off the string attacks
L, R = sosfilt(soft, sosfilt(hp, L)), sosfilt(soft, sosfilt(hp, R))
n = int(LENGTH * SR)
L, R = L[:n], R[:n]
# fades
fi, fo = int(1.0 * SR), int(3.5 * SR)
for x in (L, R):
    x[:fi] *= np.linspace(0, 1, fi)
    x[-fo:] *= np.linspace(1, 0, fo) ** 1.5
# soft-knee limiter, then normalise to about -16 LUFS-ish RMS with peaks under -1 dBFS
st = np.stack([L, R], 1)
st = np.tanh(st * 1.2) / 1.2
rms = np.sqrt((st ** 2).mean())
st *= 0.12 / rms
peak = np.abs(st).max()
if peak > 0.89:
    st *= 0.89 / peak
import wave
with wave.open(OUT, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
print(f"{OUT}: {LENGTH:.1f} s, rms {np.sqrt((st ** 2).mean()):.3f}, peak {np.abs(st).max():.3f}")
