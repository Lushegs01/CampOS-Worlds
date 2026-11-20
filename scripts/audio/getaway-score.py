"""Render the original Getaway score as three phase-aligned, loopable stems.

Run from the repository root with Python 3 and ffmpeg.
The stems share an eight-second bar and can crossfade at any point without shifting the beat.
"""
import math
from pathlib import Path
import random
import struct
import subprocess
import wave
from tempfile import TemporaryDirectory

RATE = 24000
DURATION = 8
TAU = 2 * math.pi
DESTINATION = Path('public/assets/getaway')
DESTINATION.mkdir(parents=True, exist_ok=True)


def simple(t, note):
    return math.sin(TAU * note * t)


def drone(t):
    # Periodic amplitude and whole-number frequencies make the loop boundaries continuous.
    return (.048 + .02 * simple(t, .25)) * (simple(t, 55) + .33*simple(t, 82) + .15*simple(t, 109))


def escape(t, noise, pursuit):
    half_beat = t % .5
    note = [55, 55, 49, 65][int(t // 2)]
    attack = min(1, half_beat * 150)
    bass = .135 * attack * math.exp(-half_beat*9) * (simple(half_beat, note)+.3*simple(half_beat, note*2))
    clank_time = (t+.125) % (.25 if pursuit else .5)
    clank = .05 * noise * math.exp(-clank_time*88) * min(1, clank_time*280)
    if not pursuit:
        return bass + clank
    quarter = t % .25
    pitch = [220, 196, 174, 196, 220, 246, 220, 196][int(t*4) % 8]
    motif = .065*min(1, quarter*200)*math.exp(-quarter*19)*(simple(quarter, pitch)+.25*simple(quarter,pitch*2))
    return bass + clank + motif


with TemporaryDirectory(prefix='campos-getaway-score-') as stage:
    for name in ('suspense', 'combat', 'pursuit'):
        rng = random.Random(4682)
        samples = bytearray()
        for i in range(RATE * DURATION):
            t = i / RATE
            value = drone(t)
            if name != 'suspense':
                value += escape(t, rng.uniform(-1, 1), name == 'pursuit')
            samples.extend(struct.pack('<h', round(value * 32000)))
        wav = Path(stage) / f'{name}.wav'
        with wave.open(str(wav), 'wb') as out:
            out.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            out.writeframes(samples)
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                        '-c:a', 'libmp3lame', '-b:a', '40k', str(DESTINATION / f'{name}.mp3')], check=True)
