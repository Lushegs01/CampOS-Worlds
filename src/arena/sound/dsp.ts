// Offline signal processing for the arena's sound design (src/arena/sound/designs.ts): seeded noise, RBJ biquad
// filters, envelopes, modal resonators and level control, rendered into AudioBuffers once and then only played.
// Nothing here runs per shot: a sound is rendered the first time it is needed (a handful of milliseconds).

/** Seeded white noise in [-1, 1] (xorshift32): the same seed always renders the same variant. */
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2147483648 - 1; };
}

export type FilterType = 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf';
/** A biquad section (RBJ Audio EQ Cookbook), direct form I, with its own state. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private sr: number, type: FilterType, f: number, q = .707, gainDb = 0) { this.set(type, f, q, gainDb); }
  set(type: FilterType, f: number, q = .707, gainDb = 0) {
    const w = 2 * Math.PI * Math.min(f, this.sr * .45) / this.sr, cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * q), A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peak': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      default: { const s = 2 * Math.sqrt(A) * alpha; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  process(buf: Float32Array) { for (let i = 0; i < buf.length; i++) buf[i] = this.run(buf[i]); return buf; }
}

/** Attack (linear) then exponential decay with time constant `decay`. */
export const ad = (t: number, attack: number, decay: number) => (t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/** A filtered noise burst: `shape(t)` is the amplitude envelope; filters run in order. */
export function noiseBurst(sr: number, seconds: number, seed: number, shape: (t: number) => number, filters: Biquad[] = []) {
  const n = Math.max(1, Math.round(sr * seconds)), out = new Float32Array(n), r = rng(seed);
  for (let i = 0; i < n; i++) { let x = r() * shape(i / sr); for (const f of filters) x = f.run(x); out[i] = x; }
  return out;
}
/** A lowpass whose cutoff glides from f0 to f1 (exponentially, time constant tau): the crack-to-boom of a report. */
export function sweepLowpass(buf: Float32Array, sr: number, f0: number, f1: number, tau: number, q = .8) {
  const f = new Biquad(sr, 'lp', f0, q);
  for (let i = 0; i < buf.length; i++) { if ((i & 31) === 0) f.set('lp', f1 + (f0 - f1) * Math.exp(-i / sr / tau), q); buf[i] = f.run(buf[i]); }
  return buf;
}
/** A sine whose pitch falls from f0 to f1 (time constant tau): the low "thump" of a muzzle blast or blast wave. */
export function thump(sr: number, seconds: number, f0: number, f1: number, tau: number, decay: number, drive = 1.6) {
  const n = Math.round(sr * seconds), out = new Float32Array(n), norm = Math.tanh(drive);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, f = f1 + (f0 - f1) * Math.exp(-t / tau); ph += 2 * Math.PI * f / sr; out[i] = Math.tanh(drive * Math.sin(ph) * ad(t, .0015, decay)) / norm; }
  return out;
}
/** Damped resonant modes (struck metal): frequencies, relative gains and a decay per mode. */
export function modes(sr: number, seconds: number, freqs: number[], gains: number[], decays: number[], seed = 1) {
  const n = Math.round(sr * seconds), out = new Float32Array(n), r = rng(seed);
  freqs.forEach((f, k) => { const ph0 = (r() + 1) * Math.PI, g = gains[k] ?? gains[gains.length - 1], d = decays[k] ?? decays[decays.length - 1];
    for (let i = 0; i < n; i++) { const t = i / sr; out[i] += g * Math.sin(ph0 + 2 * Math.PI * f * t) * Math.exp(-t / d) * Math.min(1, t / .0004); } });
  return out;
}
/** Add `src` into `dst` at `offset` seconds with gain. */
export function mixInto(dst: Float32Array, src: Float32Array, sr: number, offset = 0, gain = 1) {
  const o = Math.round(offset * sr);
  for (let i = 0; i < src.length && i + o < dst.length; i++) if (i + o >= 0) dst[i + o] += src[i] * gain;
  return dst;
}
/** Scale to a peak level and fade the last few milliseconds (no clicks at the end of a buffer). */
export function finish(buf: Float32Array, sr: number, peak = .89) {
  // Remove any DC offset the low layers left behind, then set the peak (so the result never exceeds `peak`).
  new Biquad(sr, 'hp', 22, .6).process(buf);
  let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  const k = m > 0 ? peak / m : 1, fade = Math.min(buf.length, Math.round(sr * .008));
  for (let i = 0; i < buf.length; i++) buf[i] *= k * (i >= buf.length - fade ? (buf.length - i) / fade : 1);
  return buf;
}
/** Trim trailing near-silence (shorter buffers, less work for the mixer). */
export function trim(buf: Float32Array, sr: number, floor = .0012) {
  let end = buf.length; while (end > sr * .03 && Math.abs(buf[end - 1]) < floor) end--;
  return end < buf.length ? buf.slice(0, Math.min(buf.length, end + Math.round(sr * .004))) : buf;
}
