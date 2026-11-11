// Renders every Combat Arena sound design offline (the same code the game runs, src/arena/sound/designs.ts) and
// measures it: peak level (headroom, no clipping), loudness (RMS), length, brightness (spectral centroid), low-end
// share, and how different each weapon is from every other (spectral distance) and its variants from each other.
// Optionally writes 16-bit WAV previews to listen to (WAV=dir).
// Usage: node scripts/qa/arena-sounds.mjs [> docs/performance/arena-sounds.json]   WAV=/tmp/previews node scripts/qa/arena-sounds.mjs
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'arena-sounds-')), out = join(dir, 'designs.mjs');
await build({ entryPoints: ['src/arena/sound/designs.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { render, GUNS } = await import(out);
const SR = 48000;

function spectrum(x) {
  // Energy in 24 log-spaced bands (40 Hz – 16 kHz) by Goertzel over 2048-sample frames.
  const bands = Array.from({ length: 24 }, (_, i) => 40 * Math.pow(16000 / 40, i / 23)), e = new Array(24).fill(0);
  for (let s = 0; s + 2048 <= Math.max(x.length, 2048); s += 1024) for (let b = 0; b < 24; b++) {
    const w = 2 * Math.PI * bands[b] / SR, c = 2 * Math.cos(w); let p = 0, q = 0;
    for (let i = 0; i < 2048; i++) { const v = (x[s + i] ?? 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / 2047)); const n = v + c * p - q; q = p; p = n; }
    e[b] += p * p + q * q - c * p * q;
  }
  const total = e.reduce((a, b) => a + b, 0) || 1;
  return { bands, e: e.map(v => v / total) };
}
function measure(x) {
  let peak = 0, sum = 0, nan = false; for (const v of x) { if (!Number.isFinite(v)) nan = true; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  const { bands, e } = spectrum(x), centroid = bands.reduce((a, f, i) => a + f * e[i], 0), low = e.slice(0, 7).reduce((a, b) => a + b, 0);
  return { ms: Math.round(x.length / SR * 1000), peakDb: +(20 * Math.log10(peak || 1e-9)).toFixed(1), rmsDb: +(10 * Math.log10(sum / x.length || 1e-12)).toFixed(1), centroidHz: Math.round(centroid), lowShare: +low.toFixed(2), nan, e };
}
const distance = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (Math.sqrt(v) - Math.sqrt(b[i])) ** 2, 0)); // Hellinger
const corr = (a, b) => { const n = Math.min(a.length, b.length); let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb || 1); };
const report = { sampleRate: SR, weapons: {}, distinct: {}, variants: {}, others: {} };
const nears = {};
for (const id of Object.keys(GUNS)) {
  const v = [0, 1, 2, 3].map(k => render(`gun:${id}:near:${k}`, SR).channels[0]), far = render(`gun:${id}:far:0`, SR).channels[0], tail = render(`gun:${id}:tail:0`, SR).channels;
  const m = measure(v[0]); nears[id] = m.e;
  report.weapons[id] = { near: { ...m, e: undefined }, far: { ...measure(far), e: undefined }, tail: { ...measure(tail[0]), e: undefined, stereo: +corr(tail[0], tail[1]).toFixed(2) } };
  // Variants: same character (close spectra), different waveforms (low sample correlation).
  report.variants[id] = { waveformCorrelation: +Math.max(corr(v[0], v[1]), corr(v[1], v[2]), corr(v[2], v[3])).toFixed(2), spectralDistance: +Math.max(distance(measure(v[0]).e, measure(v[1]).e), distance(measure(v[2]).e, measure(v[3]).e)).toFixed(3) };
  if (process.env.WAV) for (const [name, x] of [['near', v[0]], ['far', far]]) wav(join(process.env.WAV, `${id}-${name}.wav`), x);
}
const ids = Object.keys(nears);
for (const a of ids) { let nearest = null, nd = Infinity; for (const b of ids) if (a !== b) { const d = distance(nears[a], nears[b]); if (d < nd) { nd = d; nearest = b; } } report.distinct[a] = { closest: nearest, spectralDistance: +nd.toFixed(3) }; }
for (const name of ['impact:concrete:0', 'impact:metal:0', 'impact:wood:0', 'impact:dirt:0', 'impact:flesh:0', 'boom:near:0', 'boom:far:0', 'flyby:snap:0', 'flyby:whiz:0', 'mech:rifle:magout', 'mech:rifle:magin', 'mech:rifle:charge', 'mech:pump:pump', 'mech:bolt:boltaction', 'mech:pistol:dry', 'metalstep:0', 'gear:0', 'land:0', 'casing:0', 'whoosh:0']) {
  const r = render(name, SR).channels[0]; report.others[name] = { ...measure(r), e: undefined };
  if (process.env.WAV) wav(join(process.env.WAV, name.replace(/:/g, '-') + '.wav'), r);
}
const all = [...Object.values(report.weapons).flatMap(w => [w.near, w.far, w.tail]), ...Object.values(report.others)];
report.summary = { sounds: all.length, maxPeakDb: Math.max(...all.map(m => m.peakDb)), anyNaN: all.some(m => m.nan), minWeaponDistance: Math.min(...Object.values(report.distinct).map(d => d.spectralDistance)), maxVariantCorrelation: Math.max(...Object.values(report.variants).map(v => v.waveformCorrelation)) };
console.log(JSON.stringify(report, null, 1));
function wav(file, x) {
  mkdirSync(process.env.WAV, { recursive: true });
  const b = Buffer.alloc(44 + x.length * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  writeFileSync(file, b);
}
