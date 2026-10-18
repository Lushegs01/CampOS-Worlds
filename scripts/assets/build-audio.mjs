// Sound effects and ambience (all CC0) for public/assets/audio: mono MP3 (decoded by every browser,
// iOS Safari included), trimmed, level-matched per family. Loops are crossfaded so they repeat without a
// seam and padded on both sides, so the game can loop inside the padding whatever delay a browser's MP3
// decoder adds. Needs ffmpeg and unzip on the PATH. Run: node scripts/assets/build-audio.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CACHE, OUT, ensureDir, fetchCached, writeJSON } from './common.mjs';
const kb = (bytes) => (bytes / 1024).toFixed(1) + ' KB';

const SRC = ensureDir(path.join(CACHE, 'audio')), OUT_DIR = ensureDir(path.join(OUT, 'audio'));
const KENNEY = {
  impact: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
  rpg: 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
};
const OGA = 'https://opengameart.org/sites/default/files/';
/** Seconds of padding either side of a loop; the game loops between PAD and PAD + length. */
export const LOOP_PAD = .15;

async function kenney(pack) {
  const zip = await fetchCached(KENNEY[pack], path.join(SRC, `kenney-${pack}.zip`)), dir = path.join(SRC, `kenney-${pack}`);
  if (!fs.existsSync(dir)) execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  const files = new Map(); const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.set(e.name, p); } }; walk(dir);
  return name => { const p = files.get(name); if (!p) throw new Error(`${pack}: ${name} missing`); return p; };
}

/** Decode any input to mono float PCM. */
function decode(file, rate, from = 0, duration = 0) {
  const args = ['-v', 'error', ...(from ? ['-ss', String(from)] : []), ...(duration ? ['-t', String(duration)] : []), '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'];
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}
function encode(samples, rate, kbps, name) {
  const out = path.join(OUT_DIR, name + '.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', `${kbps}k`, out], { input: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength) });
  return fs.statSync(out).size;
}
const peak = s => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
/** Cut the silence before the sound (keeping 4 ms) and after it (keeping a 60 ms tail, faded out). */
function trim(s, rate, floor = .01) {
  let a = 0, b = s.length - 1; const p = peak(s), t = p * floor;
  while (a < b && Math.abs(s[a]) < t) a++; while (b > a && Math.abs(s[b]) < t) b--;
  a = Math.max(0, a - Math.round(rate * .004)); b = Math.min(s.length, b + Math.round(rate * .06));
  const out = s.slice(a, b), fade = Math.min(out.length, Math.round(rate * .02));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}
/** Make `length` seconds starting at `from` repeat seamlessly (the end crossfades into the start), padded with LOOP_PAD of its own wrap-around each side. */
function loop(s, rate, length, crossfade) {
  const L = Math.round(length * rate), X = Math.round(crossfade * rate), P = Math.round(LOOP_PAD * rate);
  if (s.length < L + X) throw new Error('loop source too short');
  const one = new Float32Array(L);
  for (let i = 0; i < L; i++) one[i] = i < X ? s[i] * Math.sin(i / X * Math.PI / 2) + s[L + i] * Math.cos(i / X * Math.PI / 2) : s[i];
  const out = new Float32Array(L + 2 * P);
  for (let i = 0; i < out.length; i++) out[i] = one[((i - P) % L + L) % L];
  return out;
}
const scale = (s, k) => { for (let i = 0; i < s.length; i++) s[i] *= k; return s; };
const db = v => 10 ** (v / 20);

const manifest = { pad: LOOP_PAD, sounds: {} }, ledger = [];
/** A family of one-shot variants, peak-matched together so their relative loudness is kept. */
function family(name, files, { gain = -3, rate = 44100, kbps = 64 } = {}) {
  const decoded = files.map(f => trim(decode(f, rate), rate)), top = Math.max(...decoded.map(peak));
  let bytes = 0; decoded.forEach((s, i) => { bytes += encode(scale(s, db(gain) / top), rate, kbps, `${name}-${i}`); });
  manifest.sounds[name] = { variants: decoded.length };
  ledger.push(`${name}: ${decoded.length} × ${(decoded.reduce((a, s) => a + s.length, 0) / decoded.length / rate).toFixed(2)} s, ${kb(bytes)}`);
}
function looped(name, file, { from = 0, length, crossfade, gain = -6, rate = 22050, kbps = 40 }) {
  const raw = decode(file, rate, from, length + crossfade + .5), s = loop(raw, rate, length, crossfade);
  scale(s, db(gain) / peak(s));
  const bytes = encode(s, rate, kbps, name);
  manifest.sounds[name] = { variants: 1, loop: [LOOP_PAD, LOOP_PAD + length] };
  ledger.push(`${name}: ${length} s loop, ${kb(bytes)}`);
}

const impact = await kenney('impact'), rpg = await kenney('rpg');
const oga = async f => fetchCached(OGA + f, path.join(SRC, 'oga-' + f));
const n5 = (f, k = 5) => Array.from({ length: k }, (_, i) => f(i));

// Footsteps by surface (Kenney Impact Sounds).
family('step-hard', n5(i => impact(`footstep_concrete_00${i}.ogg`)));
family('step-grass', n5(i => impact(`footstep_grass_00${i}.ogg`)));
family('step-wood', n5(i => impact(`footstep_wood_00${i}.ogg`)));
// Doors, sitting and standing (Kenney RPG Audio, Impact Sounds).
family('door-open', [rpg('doorOpen_1.ogg'), rpg('doorOpen_2.ogg')]);
family('door-close', n5(i => rpg(`doorClose_${i + 1}.ogg`), 4));
family('door-latch', [rpg('metalLatch.ogg'), rpg('metalClick.ogg')]);
family('glass', [impact('impactGlass_light_000.ogg'), impact('impactGlass_light_001.ogg'), impact('impactGlass_light_002.ogg')], { gain: -9 });
family('cloth', n5(i => rpg(`cloth${i + 1}.ogg`), 4));
family('seat-soft', n5(i => impact(`impactSoft_medium_00${i}.ogg`), 3));
family('seat-wood', n5(i => impact(`impactWood_light_00${i}.ogg`), 3));
family('seat-plastic', n5(i => impact(`impactPlate_light_00${i}.ogg`), 3), { gain: -8 });
// Vehicles (GGBotNet, "Car Sound Effects Pack", CC0).
const carZip = await oga('car_sound_effects_pack.zip'), carDir = path.join(SRC, 'oga-car');
if (!fs.existsSync(carDir)) execFileSync('unzip', ['-q', '-o', carZip, '-d', carDir]);
const car = f => path.join(carDir, f);
family('car-door-open', [car('Car_Door_Open.ogg')]); family('car-door-close', [car('Car_Door_Close.ogg')]);
family('engine-start', [car('Car_Engine_Start_Up.ogg')]); family('engine-stop', [car('Car_Engine_Turning_Off.ogg')]);
looped('engine', car('Car_Engine_Loop.ogg'), { from: .1, length: 2.3, crossfade: .4, gain: -3, rate: 32000, kbps: 64 });
// Ambience (Thimras, "Park ambiences", CC0): birdsong and breeze outdoors, running water at the fountain.
looped('birds', await oga('park_ambience_birds.wav'), { from: 100, length: 30, crossfade: 2 });
looped('wind', await oga('park_ambience_wind.wav'), { from: 40, length: 20, crossfade: 2, kbps: 32 });
looped('water', await oga('park_ambience_river.wav'), { from: 20, length: 12, crossfade: 1.5 });

writeJSON(path.join(OUT_DIR, 'manifest.json'), manifest);
console.log(ledger.join('\n'));
