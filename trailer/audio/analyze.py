"""Mix check without ears: loudness and stem balance per section, and a spectrogram image.

    python3 trailer/audio/analyze.py [audio_dir]
"""
import os, sys, wave, subprocess
import numpy as np

SR = 48000
d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'out', 'audio')

def load(p):
    w = wave.open(p); n = w.getnframes(); b = np.frombuffer(w.readframes(n), np.uint8).reshape(-1, 6)
    out = np.zeros((2, n))
    for ch in range(2):
        v = np.zeros((n, 4), np.uint8); v[:, 1:] = b[:, ch * 3:ch * 3 + 3]
        out[ch] = v.view('<i4')[:, 0] / 2 ** 31
    return out

SECTIONS = [(0, 2, 'impact'), (2, 4, 'pulse'), (4, 10, 'world'), (10, 14, 'build'), (14, 16, 'roll'), (16, 19, 'drop'), (19, 21, 'slowmo'),
            (21, 24, 'drop2'), (24, 30, 'breathe'), (30, 32, 'rebuild'), (32, 35.5, 'final'), (35.5, 36, 'gap'), (36, 38, 'logo'), (38, 42, 'end')]
stems = {k: load(os.path.join(d, 'stems', f'{k}.wav')) for k in ['music', 'bass', 'drums', 'fx', 'ambience']}
mix = load(os.path.join(d, 'mix.wav'))
# Short-term loudness (3 s windows, EBU) per section, from ffmpeg.
log = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', os.path.join(d, 'mix.wav'), '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
st = [(float(l.split('t:')[1].split()[0]), float(l.split('S:')[1].split()[0])) for l in log.splitlines() if ' S:' in l and 't:' in l]
print(f"{'section':10s} {'S-LUFS':>7s} {'mix':>6s} " + ' '.join(f'{k:>8s}' for k in stems))
for a, b, name in SECTIONS:
    i, j = int(a * SR), int(b * SR)
    r = lambda x: 20 * np.log10(np.sqrt(np.mean(x[:, i:j] ** 2)) + 1e-9)
    s = max([v for t, v in st if a + 0.4 <= t <= b + 0.05] or [float('nan')])
    print(f"{name:10s} {s:7.1f} {r(mix):6.1f} " + ' '.join(f'{r(v):8.1f}' for v in stems.values()))
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', os.path.join(d, 'mix.wav'), '-lavfi', 'showspectrumpic=s=1600x500:legend=1:scale=log:fscale=log', os.path.join(d, 'spectrogram.png')])
print('spectrogram:', os.path.join(d, 'spectrogram.png'))
