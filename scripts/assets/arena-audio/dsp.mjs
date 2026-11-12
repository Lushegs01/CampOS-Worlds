// Offline signal processing for the Combat Arena audio pipeline (scripts/assets/build-arena-audio.mjs).
// Recordings are decoded with ffmpeg into float PCM (one Float32Array per channel), edited here (cuts, onsets,
// fades, filters, gain, loudness) and encoded back with ffmpeg. Nothing in this file runs in the game.
import { execFileSync } from 'node:child_process';

export const RATE = 48000;

/** Decode any file (or a region of it) to float PCM channels at `rate`. `channels`: 1 (summed to mono) or 2. */
export function decode(file, { rate = RATE, channels = 1, from = 0, dur = 0 } = {}) {
  const args = ['-v', 'error', ...(from > 0 ? ['-ss', from.toFixed(6)] : []), ...(dur > 0 ? ['-t', dur.toFixed(6)] : []), '-i', file,
    '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', 'pipe:1'];
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = all.length / channels, out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c];
  return out;
}
/** Source properties (sample rate, channels, bit depth, duration, codec). */
export function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,bits_per_sample,bits_per_raw_sample,bit_rate:format=duration,size,bit_rate', '-of', 'json', file]).toString());
  const s = j.streams?.[0] ?? {}, f = j.format ?? {};
  return { codec: s.codec_name, rate: +s.sample_rate, channels: +s.channels, bits: +(s.bits_per_raw_sample || s.bits_per_sample) || null, duration: +f.duration, bytes: +f.size, kbps: Math.round((+s.bit_rate || +f.bit_rate || 0) / 1000) || null };
}
/** Encode channels to MP3 (VBR quality q: 0 best … 9 smallest). */
export function encodeMp3(chs, rate, out, q = 4, outRate = rate) {
  const n = chs[0].length, c = chs.length, inter = new Float32Array(n * c);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) inter[i * c + k] = chs[k][i];
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', String(c), '-i', 'pipe:0', ...(outRate !== rate ? ['-af', `aresample=${outRate}:resampler=soxr:precision=28`] : []), '-codec:a', 'libmp3lame', '-q:a', String(q), ...(c === 2 ? ['-joint_stereo', '1'] : []), out],
    { input: Buffer.from(inter.buffer), maxBuffer: 1 << 30 });
}

// ---------------------------------------------------------------- basics
export const dbToGain = db => 10 ** (db / 20);
export const gainToDb = g => 20 * Math.log10(Math.max(1e-12, g));
export const len = chs => chs[0].length;
export const copy = chs => chs.map(c => c.slice());
export const zeros = (channels, n) => Array.from({ length: channels }, () => new Float32Array(Math.max(0, Math.round(n))));
export function toChannels(chs, channels) {
  if (chs.length === channels) return chs;
  if (channels === 1) { const m = new Float32Array(len(chs)); for (const c of chs) for (let i = 0; i < m.length; i++) m[i] += c[i] / chs.length; return [m]; }
  return [chs[0].slice(), chs[0].slice()];
}
export function cut(chs, rate, start, dur) {
  const a = Math.max(0, Math.round(start * rate)), b = Math.min(len(chs), dur > 0 ? a + Math.round(dur * rate) : len(chs));
  return chs.map(c => c.slice(a, b));
}
export function gain(chs, g) { for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= g; return chs; }
export function peak(chs) { let m = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > m) m = a; } return m; }
/** Mix `src` into `dst` at `at` seconds. */
export function mixInto(dst, src, rate, at = 0, g = 1) {
  const o = Math.round(at * rate);
  for (let k = 0; k < dst.length; k++) { const s = src[Math.min(k, src.length - 1)], d = dst[k]; for (let i = 0; i < s.length && i + o < d.length; i++) if (i + o >= 0) d[i + o] += s[i] * g; }
  return dst;
}
/** Concatenate with a crossfade of `xf` seconds. */
export function concat(a, b, rate, xf = 0) {
  const X = Math.min(Math.round(xf * rate), len(a), len(b)), n = len(a) + len(b) - X;
  return a.map((ca, k) => { const cb = b[k] ?? b[0], out = new Float32Array(n); out.set(ca); for (let i = 0; i < cb.length; i++) { const j = len(a) - X + i; const w = i < X ? Math.sin(i / X * Math.PI / 2) : 1; out[j] = (i < X ? out[j] * Math.cos(i / X * Math.PI / 2) : 0) + cb[i] * w; } return out; });
}

// ---------------------------------------------------------------- envelopes and analysis
/** Peak envelope (max |x| over all channels) in hops of `hop` seconds. */
export function envelope(chs, rate, hop = .002) {
  const h = Math.max(1, Math.round(hop * rate)), n = Math.ceil(len(chs) / h), env = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]), j = (i / h) | 0; if (a > env[j]) env[j] = a; }
  return env;
}
/** RMS in windows of `win` seconds (no overlap), in dBFS. */
export function rmsWindows(chs, rate, win = .05) {
  const w = Math.max(1, Math.round(win * rate)), n = Math.floor(len(chs) / w), out = new Float32Array(n);
  for (let j = 0; j < n; j++) { let s = 0; for (const c of chs) for (let i = j * w; i < (j + 1) * w; i++) s += c[i] * c[i]; out[j] = 10 * Math.log10(s / (w * chs.length) + 1e-20); }
  return out;
}
/**
 * Transient onsets: a hop whose peak rises `rise` dB above the previous 20 ms and lies within `rel` dB of the file's
 * peak; onsets closer than `gap` seconds merge. Returns seconds.
 */
export function onsets(chs, rate, { rel = -30, rise = 12, gap = .06, hop = .002 } = {}) {
  const env = envelope(chs, rate, hop), top = gainToDb(peak(chs)), back = Math.round(.02 / hop), out = [];
  let last = -1e9;
  for (let i = back; i < env.length; i++) {
    let prev = 0; for (let k = i - back; k < i; k++) if (env[k] > prev) prev = env[k];
    const d = gainToDb(env[i]);
    if (d > top + rel && d - gainToDb(prev) > rise && i * hop - last > gap) { out.push(i * hop); last = i * hop; }
  }
  return out;
}
/** The first sample within ±window of `near` whose level reaches `rel` dB below that region's peak (a precise attack). */
export function refineOnset(chs, rate, near, { window = .03, rel = -20 } = {}) {
  const a = Math.max(0, Math.round((near - window) * rate)), b = Math.min(len(chs), Math.round((near + window) * rate));
  let top = 0; for (const c of chs) for (let i = a; i < b; i++) top = Math.max(top, Math.abs(c[i]));
  const t = top * dbToGain(rel);
  for (let i = a; i < b; i++) for (const c of chs) if (Math.abs(c[i]) >= t) return i / rate;
  return near;
}
/**
 * Measurements for quality control: duration, peak, RMS, the loudest 50 ms (short-term level), an estimate of
 * the noise floor (quietest 50 ms windows), clipped samples (|x| ≥ 0.999), DC offset and how long the sound
 * takes to fall 40 dB from its loudest point.
 */
export function stats(chs, rate) {
  const n = len(chs), p = peak(chs);
  let sum = 0, dc = 0, clipped = 0;
  for (const c of chs) for (let i = 0; i < n; i++) { const x = c[i]; sum += x * x; dc += x; if (Math.abs(x) >= .999) clipped++; }
  const w = rmsWindows(chs, rate, .05), sorted = [...w].sort((a, b) => a - b);
  const env = envelope(chs, rate, .005); let at = 0; for (let i = 0; i < env.length; i++) if (env[i] > env[at]) at = i;
  let decay = env.length; for (let i = at; i < env.length; i++) if (env[i] < env[at] * .01) { decay = i; break; }
  return {
    seconds: +(n / rate).toFixed(3), peakDb: +gainToDb(p).toFixed(2), rmsDb: +(10 * Math.log10(sum / Math.max(1, n * chs.length) + 1e-20)).toFixed(2),
    shortDb: +(sorted.length ? sorted[sorted.length - 1] : gainToDb(p)).toFixed(2), floorDb: +(sorted.length > 4 ? sorted[Math.floor(sorted.length * .1)] : -120).toFixed(1),
    clipped, dc: +(dc / Math.max(1, n * chs.length)).toFixed(5), decay40: +((decay - at) * .005).toFixed(3),
  };
}

/**
 * Digital clipping as recorded: runs of at least `run` consecutive samples flat at the file's maximum magnitude
 * (within 0.05 %), counted only when that maximum is near full scale. Decode at the native rate for this: resampling
 * smooths flat tops away and adds inter-sample overs that are not clipping.
 */
export function clipRuns(chs, run = 3) {
  const p = peak(chs); if (p < .89) return 0;
  const t = p * .9995; let runs = 0;
  for (const c of chs) { let n = 0; for (let i = 0; i < c.length; i++) { if (Math.abs(c[i]) >= t) { n++; if (n === run) runs++; } else n = 0; } }
  return runs;
}

// ---------------------------------------------------------------- edits
export function fadeIn(chs, rate, sec) { const n = Math.min(len(chs), Math.round(sec * rate)); for (const c of chs) for (let i = 0; i < n; i++) c[i] *= Math.sin(i / n * Math.PI / 2) ** 2; return chs; }
/** Fade the last `sec` seconds out (equal-power curve). */
export function fadeOut(chs, rate, sec) { const n = Math.min(len(chs), Math.round(sec * rate)), L = len(chs); for (const c of chs) for (let i = 0; i < n; i++) c[L - 1 - i] *= Math.sin(i / n * Math.PI / 2) ** 2; return chs; }
/** Cut trailing material below `floorDb` relative to the peak (keeping `keep` seconds after it), then fade. */
export function trimTail(chs, rate, { floorDb = -54, keep = .02, fade = .02, min = .03 } = {}) {
  const env = envelope(chs, rate, .002), t = peak(chs) * dbToGain(floorDb);
  let end = env.length; while (end > 0 && env[end - 1] < t) end--;
  const n = Math.min(len(chs), Math.max(Math.round(min * rate), Math.round((end * .002 + keep) * rate)));
  const out = chs.map(c => c.slice(0, n)); return fadeOut(out, rate, Math.min(fade, n / rate / 2));
}
/** Remove leading silence below `floorDb` relative to the peak, keeping `pre` seconds before the first sound. */
export function trimHead(chs, rate, { floorDb = -40, pre = .002 } = {}) {
  const t = peak(chs) * dbToGain(floorDb); let a = 0;
  outer: for (; a < len(chs); a++) for (const c of chs) if (Math.abs(c[a]) >= t) break outer;
  a = Math.max(0, a - Math.round(pre * rate)); return chs.map(c => c.slice(a));
}
/** Pitch/time by resampling (cubic Hermite): `ratio` > 1 raises pitch and shortens. */
export function varispeed(chs, ratio) {
  if (Math.abs(ratio - 1) < 1e-6) return chs;
  return chs.map(c => {
    const n = Math.floor((c.length - 3) / ratio), out = new Float32Array(Math.max(0, n));
    for (let i = 0; i < n; i++) {
      const x = i * ratio + 1, k = Math.floor(x), t = x - k, y0 = c[k - 1], y1 = c[k], y2 = c[k + 1], y3 = c[k + 2];
      out[i] = y1 + .5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
    }
    return out;
  });
}
export function reverse(chs) { return chs.map(c => c.slice().reverse()); }
/** Remove DC and subsonic rumble (and any DC the edits introduced). */
export function dcBlock(chs, rate, f = 20) { return filter(chs, rate, [['hp', f, .6]]); }

// ---------------------------------------------------------------- filters (RBJ biquads)
export class Biquad {
  constructor(rate, type, f, q = .707, db = 0) {
    const w = 2 * Math.PI * Math.min(f, rate * .45) / rate, cw = Math.cos(w), sw = Math.sin(w), a = sw / (2 * q), A = 10 ** (db / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; break;
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; break;
      case 'bp': b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * cw; a2 = 1 - a; break;
      case 'peak': b0 = 1 + a * A; b1 = -2 * cw; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * cw; a2 = 1 - a / A; break;
      case 'ls': { const s = 2 * Math.sqrt(A) * a; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'hs': { const s = 2 * Math.sqrt(A) * a; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      default: throw new Error('filter ' + type);
    }
    Object.assign(this, { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 });
  }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
/** Apply a chain like [['hp', 120], ['peak', 3500, 1.2, -3], ['lp', 9000]] to every channel. */
export function filter(chs, rate, chain = []) {
  if (!chain.length) return chs;
  return chs.map(c => {
    const fs = chain.map(([t, f, q, db]) => new Biquad(rate, t, f, q ?? (t === 'peak' ? 1 : .707), db ?? 0)), out = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) { let x = c[i]; for (const f of fs) x = f.run(x); out[i] = x; }
    return out;
  });
}
/** A lowpass that closes over time (f0 → f1 with time constant tau): distance air absorption on a far layer. */
export function sweepLowpass(chs, rate, f0, f1, tau) {
  return chs.map(c => {
    const out = new Float32Array(c.length); let f = new Biquad(rate, 'lp', f0, .7);
    for (let i = 0; i < c.length; i++) { if ((i & 63) === 0) { const s = f; f = new Biquad(rate, 'lp', f1 + (f0 - f1) * Math.exp(-i / rate / tau), .7); f.x1 = s.x1; f.x2 = s.x2; f.y1 = s.y1; f.y2 = s.y2; } out[i] = f.run(c[i]); }
    return out;
  });
}

// ---------------------------------------------------------------- level
/** Scale so the loudest 30 ms window (RMS) sits at `db` dBFS, never letting the sample peak exceed `ceiling`. */
export function normalizeShort(chs, rate, db, ceiling = -1) {
  const w = rmsWindows(chs, rate, .03); let top = -120; for (const v of w) if (v > top) top = v;
  if (!w.length) top = gainToDb(peak(chs));
  let g = dbToGain(db - top); const p = peak(chs) * g;
  if (p > dbToGain(ceiling)) g *= dbToGain(ceiling) / p;
  return gain(chs, g);
}
export function normalizePeak(chs, db) { const p = peak(chs); return p > 0 ? gain(chs, dbToGain(db) / p) : chs; }
/** Soft limiting for designed composites (a tanh knee above `threshold`), so layering never clips. */
export function softClip(chs, threshold = .8) {
  const t = threshold, k = 1 - t;
  for (const c of chs) for (let i = 0; i < c.length; i++) { const x = c[i], a = Math.abs(x); if (a > t) c[i] = Math.sign(x) * (t + k * Math.tanh((a - t) / k)); }
  return chs;
}

// ---------------------------------------------------------------- loops
/** Make `seconds` repeat seamlessly: the material after the loop crossfades (equal power) into its start. */
export function seamlessLoop(chs, rate, seconds, xf) {
  const L = Math.round(seconds * rate), X = Math.round(xf * rate);
  if (len(chs) < L + X) throw new Error(`loop source too short (${(len(chs) / rate).toFixed(2)} s < ${seconds + xf} s)`);
  return chs.map(c => { const out = new Float32Array(L); for (let i = 0; i < L; i++) out[i] = i < X ? c[i] * Math.sin(i / X * Math.PI / 2) + c[L + i] * Math.cos(i / X * Math.PI / 2) : c[i]; return out; });
}
