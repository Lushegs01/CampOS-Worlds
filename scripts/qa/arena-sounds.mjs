// Measures the Combat Arena's built sound banks (public/assets/arena/audio) as the game plays them: every clip decoded
// from its MP3 sprite, then per weapon its reports' level, crest factor, brightness (spectral centroid), low-end share
// and decay; how different each firearm sounds from every other (spectral distance between their averaged reports),
// how different its own variants are from each other (natural variation, not one waveform repeated); and the same for
// the footstep surfaces. Output: docs/performance/arena-sounds.json.
// Usage: node scripts/qa/arena-sounds.mjs   (needs ffmpeg)
import { readFileSync, writeFileSync } from 'node:fs';
import { decode, cut, stats, gainToDb } from '../assets/arena-audio/dsp.mjs';

const DIR = 'public/assets/arena/audio/', RATE = 48000, m = JSON.parse(readFileSync(DIR + 'manifest.json', 'utf8'));
const files = new Map();
const pcm = (bank, fi) => { const f = m.banks[bank].files[fi], k = f.file; if (!files.has(k)) files.set(k, decode(DIR + k, { rate: RATE, channels: f.ch })); return files.get(k); };
const clips = (bank, sound) => (m.banks[bank]?.sounds[sound] ?? []).map(([fi, start, dur]) => cut(pcm(bank, fi), RATE, start + m.marker, dur));

/** Energy in 24 log-spaced bands (40 Hz – 16 kHz), normalised, by Goertzel over 2048-sample frames. */
function spectrum(x) {
  const bands = Array.from({ length: 24 }, (_, i) => 40 * Math.pow(16000 / 40, i / 23)), e = new Array(24).fill(0);
  for (let s = 0; s + 2048 <= Math.max(x.length, 2048); s += 1024) for (let b = 0; b < 24; b++) {
    const w = 2 * Math.PI * bands[b] / RATE, c = 2 * Math.cos(w); let p = 0, q = 0;
    for (let i = 0; i < 2048; i++) { const v = (x[s + i] ?? 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / 2047)); const n = v + c * p - q; q = p; p = n; }
    e[b] += p * p + q * q - c * p * q;
  }
  const total = e.reduce((a, b) => a + b, 0) || 1;
  return { bands, e: e.map(v => v / total) };
}
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (Math.log10(v + 1e-6) - Math.log10(b[i] + 1e-6)) ** 2, 0) / a.length);
const avg = list => list[0].map((_, i) => list.reduce((s, e) => s + e[i], 0) / list.length);
function describe(list) {
  // Spectra of the first channel; levels over every channel as played (peaks are not inflated by a downmix).
  const specs = list.map(x => spectrum(x[0])), st = list.map(x => stats(x, RATE));
  const centroid = specs.map(s => s.bands.reduce((a, f, i) => a + f * s.e[i], 0)), low = specs.map(s => s.e.slice(0, 7).reduce((a, b) => a + b, 0));
  const within = []; for (let i = 0; i < specs.length; i++) for (let j = i + 1; j < specs.length; j++) within.push(dist(specs[i].e, specs[j].e));
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return { variants: list.length, ms: Math.round(mean(st.map(s => s.seconds)) * 1000), peakDb: +Math.max(...st.map(s => s.peakDb)).toFixed(1), shortDb: +mean(st.map(s => s.shortDb)).toFixed(1),
    crestDb: +mean(st.map(s => s.peakDb - s.rmsDb)).toFixed(1), centroidHz: Math.round(mean(centroid)), lowShare: +mean(low).toFixed(2), decay40ms: Math.round(mean(st.map(s => s.decay40)) * 1000),
    variantDistance: +mean(within).toFixed(3), spectrum: avg(specs.map(s => s.e)) };
}
const out = { measured: new Date().toISOString(), weapons: {}, distinctness: {}, footsteps: {}, footstepDistinctness: {} };
const guns = Object.keys(m.banks).filter(b => b.startsWith('w.')).map(b => b.slice(2));
for (const g of guns) out.weapons[g] = { name: m.banks['w.' + g].meta?.name, shot: describe(clips('w.' + g, 'shot')), mid: describe(clips('w.' + g, 'mid')), far: describe(clips('w.' + g, 'far')) };
for (const a of guns) { out.distinctness[a] = {}; for (const b of guns) if (a !== b) out.distinctness[a][b] = +dist(out.weapons[a].shot.spectrum, out.weapons[b].shot.spectrum).toFixed(3); }
const surfaces = Object.keys(m.banks).filter(b => b.startsWith('steps.')).map(b => b.slice(6));
for (const s of surfaces) out.footsteps[s] = { walk: describe(clips('steps.' + s, 'walk')), run: describe(clips('steps.' + s, 'run')) };
for (const a of surfaces) { out.footstepDistinctness[a] = {}; for (const b of surfaces) if (a !== b) out.footstepDistinctness[a][b] = +dist(out.footsteps[a].walk.spectrum, out.footsteps[b].walk.spectrum).toFixed(3); }
// Summary: the closest pair of firearms, and each weapon's variants versus the gap to its nearest neighbour.
const pairs = guns.flatMap(a => guns.filter(b => b > a).map(b => [a, b, out.distinctness[a][b]])).sort((x, y) => x[2] - y[2]);
out.summary = { closestWeapons: pairs.slice(0, 3), mostDistinct: pairs.slice(-3), weaponsPeakMaxDb: Math.max(...guns.map(g => out.weapons[g].shot.peakDb)) };
for (const g of guns) { delete out.weapons[g].shot.spectrum; delete out.weapons[g].mid.spectrum; delete out.weapons[g].far.spectrum; }
for (const s of surfaces) { delete out.footsteps[s].walk.spectrum; delete out.footsteps[s].run.spectrum; }
writeFileSync('docs/performance/arena-sounds.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary));
for (const g of guns) { const w = out.weapons[g], near = Math.min(...Object.values(out.distinctness[g])); console.log(g.padEnd(9), (w.name ?? '').padEnd(48), `${w.shot.variants} reports, centroid ${w.shot.centroidHz} Hz, low ${w.shot.lowShare}, crest ${w.shot.crestDb} dB, nearest other weapon ${near.toFixed(3)} vs its own variants ${w.shot.variantDistance}`); }
