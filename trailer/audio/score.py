"""Original score and sound design for the CampOS Worlds reveal, synthesised from scratch (no samples
except the game's own CC0 recordings: engine, birds, wind, fountain). Deterministic: the same file
renders the same audio.

    python3 trailer/audio/score.py [out_dir]   ->  stems/*.wav, mix.wav (48 kHz, 24-bit stereo)

Timing comes from trailer/edit/edit.json and trailer/edit/cues.json (events measured from the plates,
such as the gate pass and the ball dropping through the net), so music and picture stay locked.

Arrangement (120 BPM, bar = 2 s, key of D major / B minor):
  bars 1-2   0-4 s    impact from darkness, drone, riser into the gate rush, first pulse
  bars 3-8   4-16 s   the world: pulse bass, arpeggio, kick; claps and stabs build; snare roll
  bars 9-12  16-24 s  drop: full drums, driving bass, chord stabs; half-time during the slow motion
  bars 13-16 24-32 s  breathe: pads, soft plucks, ambience; the beat creeps back in
  bars 17-18 32-36 s  final build and a breath of silence
  bars 19-21 36-42 s  logo impact, resolving D major chord, end card chime
"""
import json, os, sys, subprocess
import numpy as np
from scipy import signal

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDIT = json.load(open(os.path.join(ROOT, 'edit', 'edit.json')))
CUES = json.load(open(os.path.join(ROOT, 'edit', 'cues.json'))) if os.path.exists(os.path.join(ROOT, 'edit', 'cues.json')) else {}
DUR = EDIT['duration']
N = int(DUR * SR)
BEAT = 60 / EDIT['bpm']
BAR = 4 * BEAT
rng = np.random.default_rng(20261019)


# ------------------------------------------------------------------ primitives
def secs(n): return np.arange(n) / SR
def note(name):
    """'F#4' -> Hz."""
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[n] + 12 * (o + 1) - 69) / 12)

def stereo(x, pan=0.0):
    """Mono -> stereo with constant-power pan (-1 left .. 1 right)."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])

def place(bus, x, t):
    """Add a stereo (2, n) or mono signal into bus at time t (seconds)."""
    if x.ndim == 1: x = stereo(x)
    i = int(round(t * SR))
    if i >= bus.shape[1]: return
    j0 = max(0, -i); i = max(0, i)
    n = min(x.shape[1] - j0, bus.shape[1] - i)
    if n > 0: bus[:, i:i + n] += x[:, j0:j0 + n]

def saw(freq, n, phase=None, detune_cents=0.0):
    """Band-limited sawtooth (polyBLEP). freq: Hz, scalar or per-sample array."""
    f = np.broadcast_to(np.asarray(freq, float), (n,)) * 2 ** (detune_cents / 1200)
    dt = f / SR
    ph = (np.cumsum(dt) + (rng.random() if phase is None else phase)) % 1.0
    y = 2 * ph - 1
    m = ph < dt; tt = ph[m] / dt[m]; y[m] -= tt + tt - tt * tt - 1
    m = ph > 1 - dt; tt = (ph[m] - 1) / dt[m]; y[m] -= tt * tt + tt + tt + 1
    return y

def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    return np.sin(2 * np.pi * (np.cumsum(f) / SR) + phase)

def noise(n): return rng.standard_normal(n)

def env(n, a=0.005, d=0.1, s=0.0, r=0.05, hold=None):
    """ADSR over n samples; `hold` (s) is the gate length (defaults to fill n minus release)."""
    t = secs(n)
    hold = (n / SR - r) if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = t > hold
    if rel.any():
        level = e[np.argmax(rel)] if rel.any() else s
        e = np.where(rel, level * np.exp(-(t - hold) / max(r / 4, 1e-6)), e)
    return e

def decay(n, tau, attack=0.002):
    t = secs(n)
    return np.minimum(1, t / attack) * np.exp(-t / tau)

def sos(kind, f, order=2):
    nyq = SR / 2
    if kind == 'band': return signal.butter(order, [f[0] / nyq, min(f[1] / nyq, .99)], 'bandpass', output='sos')
    return signal.butter(order, min(f / nyq, .99), kind, output='sos')

def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x, axis=-1)

def sweep(x, kind, cutoff, block=256, order=2):
    """Time-varying filter: cutoff(t_seconds) evaluated per block."""
    y = np.zeros_like(x); zi = None
    for i in range(0, x.shape[-1], block):
        c = cutoff((i + block / 2) / SR)
        s = sos(kind, c, order)
        if zi is None: zi = np.zeros((s.shape[0], 2) if x.ndim == 1 else (s.shape[0], x.shape[0], 2))
        if x.ndim == 1: y[i:i + block], zi = signal.sosfilt(s, x[i:i + block], zi=zi)
        else:
            out = np.zeros_like(x[:, i:i + block])
            for ch in range(x.shape[0]):
                out[ch], zi[:, ch] = signal.sosfilt(s, x[ch, i:i + block], zi=zi[:, ch])
            y[:, i:i + block] = out
    return y

def soft(x, drive=1.0): return np.tanh(x * drive) / np.tanh(drive)

def reverb_ir(seconds=2.4, predelay=0.02, damp=6000, seed=3):
    r = np.random.default_rng(seed)
    n = int(seconds * SR); t = secs(n)
    ir = r.standard_normal((2, n)) * np.exp(-t * 6.9 / seconds)
    ir = filt(ir, 'low', damp)
    # Early reflections.
    for k, (dt, g) in enumerate([(0.011, .5), (0.017, .4), (0.023, .35), (0.031, .3), (0.041, .25)]):
        ir[k % 2, int(dt * SR)] += g
    ir = np.concatenate([np.zeros((2, int(predelay * SR))), ir], axis=1)
    return ir / np.sqrt((ir ** 2).sum() / 2)

def convolve(x, ir):
    return np.stack([signal.fftconvolve(x[0], ir[0])[:x.shape[1]], signal.fftconvolve(x[1], ir[1])[:x.shape[1]]])

def pingpong(x, delay, feedback=0.4, repeats=6, tone=3500):
    y = np.zeros_like(x); d = int(delay * SR); src = x.copy()
    for k in range(1, repeats + 1):
        src = filt(src, 'low', tone) * feedback
        shifted = np.zeros_like(x); shifted[:, d * k:] = src[:, :x.shape[1] - d * k]
        if k % 2: shifted = shifted[::-1]
        y += shifted
    return y

def bus(): return np.zeros((2, N))

def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


# ------------------------------------------------------------------ harmony
CHORDS = {
    'Bm': ['B3', 'D4', 'F#4', 'B4'], 'G': ['G3', 'B3', 'D4', 'A4'], 'D': ['D4', 'F#4', 'A4', 'D5'], 'A': ['A3', 'C#4', 'E4', 'A4'],
    'Dadd9': ['D4', 'F#4', 'A4', 'E5'],
}
ROOTS = {'Bm': 'B1', 'G': 'G1', 'D': 'D2', 'A': 'A1', 'Dadd9': 'D2'}
# One chord per bar (bar index from 0 at t = 0).
PROGRESSION = ['Bm', 'Bm', 'Bm', 'G', 'D', 'A', 'Bm', 'G', 'D', 'A', 'Bm', 'G', 'D', 'A', 'Bm', 'G', 'Bm', 'G', 'Dadd9', 'Dadd9', 'Dadd9']
def chord_at(t): return PROGRESSION[min(int(t // BAR), len(PROGRESSION) - 1)]


# ------------------------------------------------------------------ instruments
def kick(level=1.0, punch=1.0):
    n = int(0.55 * SR); t = secs(n)
    f = 46 + 120 * np.exp(-t * 32) * punch + 30 * np.exp(-t * 9)
    body = sine(f, n) * decay(n, 0.22, 0.001)
    click = filt(noise(int(0.004 * SR)), 'high', 3000) * 0.35
    body[:click.size] += click
    return soft(body * 1.5, 1.6) * level

def clap(level=1.0):
    n = int(0.35 * SR); x = np.zeros(n)
    for k, dt in enumerate([0, 0.008, 0.017, 0.026]):
        m = int(0.02 * SR); i = int(dt * SR)
        x[i:i + m] += noise(m) * decay(m, 0.006 if k < 3 else 0.012, 0.0005)
    x += noise(n) * decay(n, 0.09, 0.03) * 0.5
    return filt(x, 'band', (900, 4500)) * level * 1.6

def snare(level=1.0):
    n = int(0.3 * SR)
    x = filt(noise(n), 'band', (1400, 7000)) * decay(n, 0.11) + sine(185, n) * decay(n, 0.05) * 0.8
    return x * level

def hat(open_=False, level=1.0):
    n = int((0.35 if open_ else 0.06) * SR)
    metal = sum(np.sign(sine(f, n)) for f in (3140, 4520, 6280, 8020, 9310)) * 0.12
    x = filt(noise(n) + metal, 'high', 7200) * decay(n, 0.11 if open_ else 0.022, 0.0008)
    return x * level

def crash(level=1.0, length=2.4):
    n = int(length * SR)
    metal = sum(sine(f, n, rng.random() * 6) for f in (3320, 4970, 5530, 7210, 8840, 10500)) * 0.2
    x = filt(noise(n) + metal, 'high', 3800) * decay(n, length / 4, 0.002)
    return np.stack([x, filt(noise(n), 'high', 4200) * decay(n, length / 4.2, 0.002) * .9 + metal * decay(n, length / 4) * .5]) * level * 0.55

def sub_impact(level=1.0, f0=58, f1=29, length=3.2):
    """A cinematic boom: a falling sub sine, a low thump and a dark noise bloom; harmonics so phones hear it."""
    n = int(length * SR); t = secs(n)
    f = f1 + (f0 - f1) * np.exp(-t * 2.6)
    boom = sine(f, n) * decay(n, length / 3.2, 0.003)
    thump = sine(95 * np.exp(-t * 8) + 40, n) * decay(n, 0.18, 0.001)
    bloom = filt(noise(n), 'low', 380) * decay(n, 0.5, 0.004) * 0.9
    x = boom * 1.1 + thump * 0.9 + bloom
    # Upper harmonics of the boom, so the hit survives a phone speaker.
    harm = filt(soft(boom * 3, 2.5), 'band', (110, 900)) * 0.28
    return soft(x + harm, 1.3) * level

def riser(length, level=1.0, f0=250, f1=7000):
    n = int(length * SR); t = secs(n); k = t / length
    x = noise(n)
    x = sweep(x, 'low', lambda s: f0 * (f1 / f0) ** (s / length), order=2)
    tone = saw(110 * 2 ** (3 * k), n) * 0.18 + saw(110 * 2 ** (3 * k) * 1.5, n) * 0.1
    tone = filt(tone, 'low', 3000)
    amp = k ** 2.2
    return np.stack([(x + tone) * amp, (np.roll(x, 37) + tone) * amp]) * level * 0.5

def reverse_cymbal(length, level=1.0):
    c = crash(1.0, length)[:, ::-1]
    return c * level

def whoosh(length=0.55, level=1.0, f0=500, f1=3800, pan0=-.7, pan1=.7):
    n = int(length * SR); t = secs(n); k = t / length
    bell = np.sin(np.pi * k) ** 1.6
    x = sweep(noise(n), 'band', lambda s: (max(60, f0 + (f1 - f0) * np.sin(np.pi * s / length) * 0.9), max(200, f0 + (f1 - f0) * np.sin(np.pi * s / length)) * 1.9), order=1) * bell
    pans = pan0 + (pan1 - pan0) * k
    a = (pans + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)]) * level * 1.4

def title_hit(level=1.0, pitch=1.0):
    """The crisp hit under each word: transient, tuned thump, a short metallic ring."""
    n = int(0.9 * SR); t = secs(n)
    tick = filt(noise(int(0.003 * SR)), 'high', 4000)
    thump = sine((70 + 90 * np.exp(-t * 30)) * pitch, n) * decay(n, 0.16, 0.001)
    ring = (sine(1320 * pitch, n) * 0.25 + sine(1980 * pitch, n) * 0.12) * decay(n, 0.12, 0.001)
    x = thump + ring * 0.6
    x[:tick.size] += tick * 0.8
    return soft(x, 1.2) * level

def supersaw(freq, n, voices=7, spread=18, cutoff=4000, width=0.8):
    out = np.zeros((2, n))
    for v in range(voices):
        c = (v - (voices - 1) / 2) / ((voices - 1) / 2) * spread
        x = saw(freq, n, detune_cents=c)
        pan = (v - (voices - 1) / 2) / ((voices - 1) / 2) * width
        out += stereo(x, pan)
    return filt(out / voices * 1.6, 'low', cutoff)

def pad(chord, length, level=1.0, cutoff=2400, attack=0.6, release=0.8):
    n = int((length + release) * SR)
    x = sum(supersaw(note(nm), n, voices=5, spread=14, cutoff=cutoff) for nm in CHORDS[chord])
    return x * env(n, attack, 1.0, 1.0, release, hold=length) * level * 0.22

def stab(chord, level=1.0, length=0.32, cutoff=5200):
    n = int(length * SR)
    x = sum(supersaw(note(nm), n, voices=7, spread=22, cutoff=cutoff) for nm in CHORDS[chord] + [CHORDS[chord][0][:-1] + str(int(CHORDS[chord][0][-1]) + 1)])
    return x * decay(n, length / 3.2, 0.002) * level * 0.22

def pluck(freq, level=1.0, length=0.28, bright=1.0):
    n = int(length * SR); t = secs(n)
    x = saw(freq, n) * 0.6 + saw(freq * 2.003, n) * 0.25
    x = sweep(x, 'low', lambda s: 600 + 5200 * bright * np.exp(-s * 18), block=128)
    return x * decay(n, length / 3, 0.001) * level

def bell(freq, level=1.0, length=3.0):
    """FM bell for the logo shimmer."""
    n = int(length * SR); t = secs(n)
    idx = 3.2 * np.exp(-t * 2.2)
    mod = np.sin(2 * np.pi * freq * 3.5 * t) * idx
    x = np.sin(2 * np.pi * freq * t + mod) * decay(n, length / 3.5, 0.002)
    return x * level

def bass_note(freq, length, level=1.0, cutoff=900):
    n = int(length * SR)
    # The sub voice sits between 40 and 80 Hz for every root, so no chord's low end falls out of reach.
    sub = freq
    while sub >= 80: sub /= 2
    x = saw(freq, n) * 0.7 + saw(freq * 1.005, n) * 0.4 + sine(sub, n) * 0.9
    x = sweep(x, 'low', lambda s: 180 + cutoff * np.exp(-s * 9), block=128)
    return soft(x * env(n, 0.003, 0.25, 0.55, 0.05, hold=length - 0.03) * 1.2, 1.4) * level

def load_audio(name, seconds=None):
    """Decode one of the game's recordings to mono 48 kHz float."""
    path = os.path.join(ROOT, '..', 'public', 'assets', 'audio', name)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).astype(float)
    if seconds:
        reps = int(np.ceil(seconds * SR / x.size)) + 1
        x = np.tile(x, reps)[:int(seconds * SR)]
    return x


# ------------------------------------------------------------------ arrangement
def build():
    drums, bass, music, fx, amb = bus(), bus(), bus(), bus(), bus()
    kicks = []  # kick times, for sidechain
    cue = lambda k, default: CUES.get(k, default)
    gate = cue('gate', 1.55)              # the camera passes under the gate beam
    swish = cue('swish', 20.55)           # the ball drops through the net
    slow0, slow1 = 19.25, cue('swish', 20.55) + 0.2

    # ---------------- scene 01: darkness, impact, the rush
    place(fx, sub_impact(1.0, 64, 36, 3.6), 0.0)
    place(fx, crash(0.25, 3.0), 0.0)
    drone_n = int(6.0 * SR)
    drone = supersaw(note('B1'), drone_n, voices=5, spread=9, cutoff=900) + supersaw(note('F#2'), drone_n, voices=5, spread=9, cutoff=900) * .7
    drone = sweep(drone, 'low', lambda s: 300 + 2600 * min(1, s / 2.2) ** 2, order=2) * env(drone_n, 0.05, 1, 1, 1.6, hold=4.3)
    place(music, drone * 0.3, 0.0)
    place(fx, riser(gate - 0.15, 0.85), 0.15)
    place(fx, whoosh(0.7, 1.1, 300, 4200, -.2, .2), gate - 0.4)
    place(fx, sub_impact(0.55, 72, 40, 1.6), gate)
    place(fx, crash(0.35, 2.2), gate)
    # The first pulse: filtered bass eighths on B from the burst.
    t = 2.0
    while t < 4.0 - 1e-6:
        place(bass, bass_note(note('B1'), BEAT / 2 * 0.9, 0.55, cutoff=500), t); t += BEAT / 2
    place(fx, title_hit(0.75, 1.0), 2.0)
    place(fx, reverse_cymbal(1.2, 0.35), 4.0 - 1.2)

    # ---------------- scenes 02-03: the world (bars 3-8)
    for bar in range(2, 8):
        b0 = bar * BAR; ch = chord_at(b0 + .01); root = note(ROOTS[ch])
        progress = (bar - 2) / 6
        for k in range(4):  # kick on quarters
            tk = b0 + k * BEAT
            place(drums, kick(0.6 + 0.25 * progress), tk); kicks.append(tk)
        for k in range(8):  # pulse bass eighths, octave bounce
            place(bass, bass_note(root * (2 if k % 2 else 1), BEAT / 2 * 0.85, 0.5, cutoff=500 + 900 * progress), b0 + k * BEAT / 2)
        if bar >= 3:
            for k in range(4): place(drums, stereo(hat(False, 0.35 + 0.2 * progress), .25), b0 + k * BEAT + BEAT / 2)
        if bar >= 5:
            for k in (1, 3): place(drums, stereo(clap(0.55 + 0.2 * progress), -.05), b0 + k * BEAT)
            for k in range(16):
                if k % 4 != 2: place(drums, stereo(hat(False, 0.12 + 0.1 * progress), -.3), b0 + k * BEAT / 4)
        # Arpeggio: 16ths over the chord, opening up as the world builds.
        tones = [note(nm) * 2 for nm in CHORDS[ch]]
        order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2]
        for k in range(16):
            place(music, stereo(pluck(tones[order[k]], 0.26 + 0.14 * progress, 0.22, 0.35 + 0.6 * progress), np.sin(k * 0.9) * .4), b0 + k * BEAT / 4)
        if bar >= 5: place(music, pad(ch, BAR, 0.6 + 0.3 * progress, cutoff=1400 + 1600 * progress), b0)
    place(fx, title_hit(0.8, 0.95), 5.0)
    place(fx, whoosh(0.5, 0.9, 600, 5000, -.8, .8), 9.55)        # whip pan into scene 03
    place(fx, title_hit(0.8, 1.06), 10.5)                         # CONNECT.
    for k, tk in enumerate((12.0, 12.5, 13.0, 13.5)):             # MAKE / IT / YOURS. and the four looks
        place(music, stab(['Bm', 'G', 'D', 'A'][k], 0.75), tk)
        place(fx, title_hit(0.55, [1.0, 1.12, 1.26, 1.33][k]), tk)
    # Build into the drop: snare roll, riser, filtered noise lift.
    roll = np.concatenate([np.arange(14.0, 15.0, BEAT / 2), np.arange(15.0, 15.5, BEAT / 4), np.arange(15.5, 16.0 - 1e-6, BEAT / 8)])
    for i, tk in enumerate(roll): place(drums, stereo(snare(0.25 + 0.55 * i / len(roll)), 0.05), tk)
    place(fx, riser(2.0, 0.9), 14.0)
    place(fx, whoosh(0.45, 1.0, 700, 5200, .8, -.8), 15.6)       # whip into the drive

    # ---------------- scene 04: the drop (bars 9-12), half time through the slow motion
    stab_rhythm = [0, 0.75, 1.5, 2.5, 3.0, 3.5]  # beats within a bar
    for bar in range(8, 12):
        b0 = bar * BAR; ch = chord_at(b0 + .01); root = note(ROOTS[ch])
        for k in range(4):
            tk = b0 + k * BEAT
            half = slow0 <= tk < slow1
            if half and k % 2: continue
            place(drums, kick(1.0 if not half else 0.85), tk); kicks.append(tk)
            if not half:
                place(drums, stereo(hat(True, 0.22), .3), tk + BEAT / 2)
        for k in (1, 3):
            tk = b0 + k * BEAT
            if slow0 <= tk < slow1:
                if k == 3: place(drums, convolve(stereo(clap(0.9)), reverb_ir(1.6, seed=9)) * 0.5 + stereo(clap(0.6)), tk)
                continue
            place(drums, stereo(clap(0.95), -.05), tk); place(drums, stereo(snare(0.35), .05), tk)
        for k in range(16):
            tk = b0 + k * BEAT / 4
            if not (slow0 <= tk < slow1): place(drums, stereo(hat(False, 0.2 if k % 2 else 0.32), -.25), tk)
        for k in range(16):  # driving bass sixteenths with an octave on the offbeats
            tk = b0 + k * BEAT / 4
            if slow0 <= tk < slow1:
                if k % 8 == 0: place(bass, bass_note(root, BEAT * 2 * 0.95, 0.8, cutoff=500), tk)
                continue
            place(bass, bass_note(root * (2 if k % 4 == 2 else 1), BEAT / 4 * 0.9, 0.62, cutoff=1500), tk)
        for s in stab_rhythm:
            tk = b0 + s * BEAT
            if slow0 <= tk < slow1: continue
            place(music, stab(ch, 1.0), tk)
        # A pumping pad bed under the drop (the sidechain shapes it), out during the slow motion.
        if not (slow0 <= b0 < slow1 - BAR): place(music, pad(ch, min(BAR, max(0.3, slow0 - b0)) if b0 < slow0 < b0 + BAR else BAR, 0.7, cutoff=3000, attack=0.02, release=0.3), b0 if not (b0 < slow1 <= b0 + BAR) else slow1)
        tones = [note(nm) * 2 for nm in CHORDS[ch]]
        for k in range(16):
            tk = b0 + k * BEAT / 4
            if not (slow0 <= tk < slow1): place(music, stereo(pluck(tones[(k * 3) % 4] * (2 if k % 8 == 7 else 1), 0.2, 0.18, 1.0), np.sin(k) * .5), tk)
    # The hook of the drop: a short line of chord tones (D, A, Bm, G), resting through the slow motion.
    motif = [(16.0, 'F#5'), (16.75, 'A5'), (17.5, 'D6'), (18.5, 'A5'), (18.0, 'E5'), (18.75, 'A5'), (19.0, 'C#6'),
             (21.0, 'B5'), (21.5, 'F#5'), (21.75, 'D6'), (22.0, 'G5'), (22.75, 'B5'), (23.5, 'D6')]
    for tk, nm in motif:
        if slow0 <= tk < slow1: continue
        place(music, stereo(pluck(note(nm), 0.2, 0.42, 0.6), 0.15), tk); place(music, stereo(bell(note(nm), 0.06, 0.6), -0.1), tk)
    place(drums, crash(0.9), 16.0)
    place(fx, sub_impact(0.9, 68, 38, 2.4), 16.0)
    place(fx, title_hit(0.7, 1.0), 16.0)                          # EXPLORE.
    place(fx, whoosh(0.5, 0.55, 400, 2600, -.6, .6), 18.0)        # into the courts
    place(fx, title_hit(0.75, 0.9), 19.0)                         # COMPETE.
    # The slow motion: everything ducks into a held, reverberant chord; the net brings the beat back.
    hold_n = int((slow1 - slow0 + 1.0) * SR)
    held = pad('A', slow1 - slow0, 0.9, cutoff=1800, attack=0.25, release=1.0)
    place(music, held, slow0)
    place(fx, reverse_cymbal(slow1 - slow0 - 0.05, 0.55), slow0 + 0.05)
    place(drums, crash(0.8), swish + 0.02)
    place(fx, sub_impact(0.6, 72, 40, 1.4), swish + 0.02)
    place(fx, title_hit(0.75, 1.18), 22.0)                        # DISCOVER.
    place(music, stereo(bell(note('A5'), 0.22, 2.0), .3), 22.0); place(music, stereo(bell(note('E6'), 0.14, 2.0), -.3), 22.06)
    place(fx, whoosh(0.7, 0.9, 300, 3600, -.5, .5), 23.3)         # overhead whirl
    place(fx, reverse_cymbal(0.75, 0.4), 23.25)

    # ---------------- scene 05: breathe (bars 13-16)
    for bar in range(12, 16):
        b0 = bar * BAR; ch = chord_at(b0 + .01); root = note(ROOTS[ch])
        place(music, pad(ch, BAR, 0.5, cutoff=1500, attack=0.4, release=1.2), b0)
        n_ = int((BAR + .35) * SR)  # overlapping, so the sub never dips between bars
        place(bass, stereo(sine(root, n_) * env(n_, 0.25, 1, 1, 0.5, hold=BAR - .1) * 0.55), b0)
        tones = [note(nm) * 2 for nm in CHORDS[ch]]
        melody = [0, 2, 3, 2, 1, 2, 0, 1]
        for k in range(8):
            place(music, stereo(pluck(tones[melody[k]], 0.16, 0.5, 0.25), np.sin(k * 1.3) * .35), b0 + k * BEAT / 2)
        if bar >= 14:  # the beat creeps back
            for k in range(4):
                tk = b0 + k * BEAT
                place(drums, kick(0.45 + 0.25 * (bar - 14)), tk); kicks.append(tk)
            for k in range(4): place(drums, stereo(hat(False, 0.18), .25), b0 + k * BEAT + BEAT / 2)
    place(fx, title_hit(0.6, 0.85), 25.0)                         # YOUR CAMPUS.
    for i, tk in enumerate((24.15, 24.3, 24.45, 24.6)):            # the four location labels pinning on
        place(fx, stereo(bell(note(['A6', 'C#7', 'E7', 'F#7'][i]), 0.035, 0.7), [-.5, .3, -.2, .5][i]), tk)
    place(fx, title_hit(0.6, 0.95), 27.0)                         # YOUR STORIES.
    place(fx, riser(2.0, 0.6), 30.0)

    # ---------------- scene 06: final build, a breath, the logo
    for bar in range(16, 18):
        b0 = bar * BAR; ch = chord_at(b0 + .01); root = note(ROOTS[ch])
        for k in range(4):
            tk = b0 + k * BEAT
            if tk >= 35.5: continue
            place(drums, kick(1.0), tk); kicks.append(tk)
        for k in (1, 3):
            if b0 + k * BEAT < 35.5: place(drums, stereo(clap(0.9)), b0 + k * BEAT)
        for k in range(16):
            tk = b0 + k * BEAT / 4
            if tk >= 35.5: continue
            place(drums, stereo(hat(False, 0.24), -.25), tk)
            place(bass, bass_note(root * (2 if k % 4 == 2 else 1), BEAT / 4 * 0.9, 0.6, cutoff=1300 + 900 * (bar - 16)), tk)
        place(music, pad(ch, BAR if b0 + BAR <= 35.5 else 35.5 - b0, 0.9, cutoff=2600 + 1800 * (bar - 16), attack=0.15, release=0.15), b0)
    roll = np.concatenate([np.arange(34.0, 35.0, BEAT / 4), np.arange(35.0, 35.45, BEAT / 8)])
    for i, tk in enumerate(roll): place(drums, stereo(snare(0.3 + 0.6 * i / len(roll))), tk)
    place(fx, riser(3.4, 1.0, 200, 9000), 32.05)
    place(fx, reverse_cymbal(1.4, 0.7), 34.55)
    logo = EDIT['brand']['logo']
    # The logo: the biggest hit of the film, a resolving D major chord and a bell shimmer.
    place(fx, sub_impact(1.15, 62, 34, 5.0), logo)
    place(drums, crash(1.0, 4.0), logo)
    place(drums, kick(1.1, 1.3), logo)
    place(music, pad('Dadd9', DUR - logo - 0.6, 1.25, cutoff=3200, attack=0.03, release=0.6), logo)
    place(bass, stereo(sine(note('D2'), int((DUR - logo) * SR)) * env(int((DUR - logo) * SR), 0.01, 1.0, 0.8, 1.0, hold=DUR - logo - 1.2) * 0.8), logo)
    for i, nm in enumerate(['D5', 'A5', 'F#5', 'E6', 'D6']):
        place(music, stereo(bell(note(nm), 0.2, 4.0), [-.5, .4, -.2, .6, 0][i]), logo + 0.04 + i * 0.09)
    place(fx, title_hit(0.45, 1.5), EDIT['brand']['name'])
    for i, nm in enumerate(['A5', 'D6']):                          # end card chime
        place(music, stereo(bell(note(nm), 0.16, 3.0), [-.3, .3][i]), EDIT['brand']['tagline'] + i * 0.12)
    # A soft pulse under the end card so it never goes dead.
    for k in range(int((DUR - 0.8 - (logo + 2.0)) / (BEAT / 2))):
        tk = logo + 2.0 + k * BEAT / 2
        place(music, stereo(pluck(note(CHORDS['Dadd9'][k % 4]) * 2, 0.09 * (1 - k / 22), 0.3, 0.3), np.sin(k) * .4), tk)

    # ---------------- picture-synced foley (the game's own sounds)
    engine = load_audio('engine.mp3', 3.6)
    eng = filt(engine, 'high', 60) * np.hanning(engine.size) ** 0.25
    place(amb, stereo(eng * 0.55, -0.1), 15.85)                   # wheel shot: close, low
    road = filt(noise(int(2.4 * SR)), 'band', (90, 900)) * env(int(2.4 * SR), 0.15, 1, 1, 0.3)
    place(amb, stereo(road * 0.15), 16.0)
    pass_n = int(1.6 * SR); pk = np.exp(-((secs(pass_n) - 0.8) / 0.38) ** 2)
    rate = 1.12  # a touch of doppler as it passes
    eng2 = np.interp(np.arange(pass_n) * rate, np.arange(engine.size), engine)
    pans = np.linspace(-0.8, 0.8, pass_n); a = (pans + 1) * np.pi / 4
    place(amb, np.stack([eng2 * pk * np.cos(a), eng2 * pk * np.sin(a)]) * 0.75, 17.0)
    # Basketball, from the game's own recipes (src/interaction/sound.ts): bounce and swish.
    def bounce(level):
        n = int(0.2 * SR); t = secs(n)
        return (sine(150 * np.exp(-t * 6) + 55 * (1 - np.exp(-t * 6)), n) * decay(n, 0.05) * .9 + filt(noise(n), 'low', 900) * decay(n, 0.02) * .25) * level
    for tk, lv in ((18.35, .35), (18.62, .3), (18.9, .3)):
        place(amb, stereo(bounce(lv), .2), tk)
    place(amb, stereo(filt(noise(int(0.5 * SR)), 'band', (2800, 6000)) * decay(int(0.5 * SR), 0.14, 0.01) * 0.9, .1), swish)
    place(amb, stereo(filt(noise(int(0.6 * SR)), 'band', (300, 1800)) * np.sin(np.linspace(0, np.pi, int(0.6 * SR))) * 0.25), 19.05)  # release
    # Courtyard ambience: birds, a breeze, the Confluence fountain under scene 05.
    birds = load_audio('birds.mp3', DUR); wind = load_audio('wind.mp3', DUR); water = load_audio('water.mp3', 12.0)
    fade = lambda n, a, r: np.minimum(1, np.minimum(np.arange(n) / (a * SR), (n - np.arange(n)) / (r * SR)))
    seg_ = lambda x, t0, t1: x[int(t0 * SR):int(t1 * SR)] * fade(int(t1 * SR) - int(t0 * SR), 0.8, 0.8)
    place(amb, stereo(seg_(birds, 4.0, 15.0) * 0.18, .3), 4.0)
    place(amb, stereo(seg_(birds, 23.6, 32.5) * 0.3, -.2), 23.6)
    place(amb, stereo(seg_(wind, 0.0, 4.5) * 0.25), 0.0)
    place(amb, stereo(seg_(wind, 24.0, 32.0) * 0.18, .2), 24.0)
    place(amb, stereo(water[:int(3.2 * SR)] * fade(int(3.2 * SR), 0.6, 1.0) * 0.35, -.15), 24.0)

    return dict(drums=drums, bass=bass, music=music, fx=fx, amb=amb, kicks=np.array(sorted(kicks)))


def sidechain(kicks, depth=0.55, release=0.16):
    g = np.ones(N); t = secs(N)
    for tk in kicks:
        i = int(tk * SR); n = int(0.45 * SR)
        if i >= N: continue
        seg_t = t[i:i + n] - tk
        g[i:i + n] = np.minimum(g[i:i + n], 1 - depth * np.exp(-seg_t / release) * np.minimum(1, seg_t / 0.004 + 0.4))
    return g


def limiter(x, ceiling=0.89, lookahead=0.004, release=0.08):
    """Peak limiter: the gain follows the loudest sample within the look-ahead window either side (so it
    is already down when a transient arrives) and recovers smoothly."""
    from scipy.ndimage import maximum_filter1d
    peak = maximum_filter1d(np.abs(x).max(axis=0), int(lookahead * SR) * 2 + 1)
    g = np.minimum(1, ceiling / np.maximum(peak, 1e-9))
    a = np.exp(-1 / (release * SR))
    g = np.minimum(g, signal.lfilter([1 - a], [1, -a], g))
    return x * g[None, :]


def write_wav(path, x):
    import wave
    pcm = (np.clip(x, -1, 1).T * (2 ** 23 - 1)).astype('<i4')
    data = np.zeros((pcm.shape[0], 6), np.uint8)
    for ch in range(2):
        v = pcm[:, ch].astype('<i4').view(np.uint8).reshape(-1, 4)
        data[:, ch * 3:ch * 3 + 3] = v[:, :3]
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(3); w.setframerate(SR); w.writeframes(data.tobytes())


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'out', 'audio')
    os.makedirs(os.path.join(out, 'stems'), exist_ok=True)
    s = build()
    duck = sidechain(s['kicks'])
    # Space: one shared hall for music and effects, a shorter room for the drums.
    hall, room = reverb_ir(2.6, 0.025, 5200, 1), reverb_ir(0.9, 0.01, 7000, 2)
    music = s['music'] * duck * 0.9 + convolve(s['music'], hall) * 0.32 + pingpong(s['music'], BEAT * 0.75, 0.3, 4) * 0.12
    bass = filt(s['bass'], 'high', 28) * duck
    drums = s['drums'] + convolve(filt(s['drums'], 'high', 400), room) * 0.12
    fx = s['fx'] + convolve(filt(s['fx'], 'high', 150), hall) * 0.25
    amb = s['amb']
    # Stem balance (set by measurement: in the drop, drums, bass and music sit within a few dB).
    stems = dict(music=music * MIX['music'], bass=bass * MIX['bass'], drums=drums * MIX['drums'], fx=fx * MIX['fx'], ambience=amb * MIX['ambience'])
    mix = sum(stems.values())
    # Master bus: a gentle tilt for phone speakers (less low-mid mud, a little presence), light glue.
    mix = mix - filt(filt(mix, 'band', (180, 420)), 'low', 600) * 0.18 + filt(mix, 'band', (2500, 6000)) * 0.08
    mix = soft(mix, 1.05)
    # Nothing below 30 Hz (no speaker plays it; it only costs headroom), a little less below 50 Hz.
    mix = filt(mix, 'high', 30, order=4)
    mix = mix - filt(mix, 'low', 50) * 0.3
    # Loudness for social platforms (they normalise to about -14 LUFS): gain to the target, then a peak
    # limiter catches only the impacts, so the quiet sections stay quiet and the hits still land.
    gain = 10 ** ((TARGET_LUFS - lufs(mix)) / 20)
    mix = limiter(mix * gain, ceiling=10 ** (-2.0 / 20))
    for k, v in stems.items():
        write_wav(os.path.join(out, 'stems', f'{k}.wav'), v * gain * 0.7)
        print(f'{k:9s} {rms_db(v * gain):6.1f} dB RMS')
    write_wav(os.path.join(out, 'mix.wav'), mix)
    print(f'mix {lufs(mix):.1f} LUFS integrated, sample peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS')


MIX = dict(music=2.2, bass=0.8, drums=0.55, fx=0.75, ambience=1.6)
TARGET_LUFS = -14.0


def lufs(x):
    """Integrated loudness (EBU R128) via ffmpeg."""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.wav') as f:
        write_wav(f.name, x / max(1.0, np.abs(x).max()))
        log = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', f.name, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    value = float(log.rsplit('I:', 1)[1].split('LUFS')[0])
    return value + 20 * np.log10(max(1.0, np.abs(x).max()))


if __name__ == '__main__':
    main()
