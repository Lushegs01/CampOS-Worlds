// Combat Arena audio: renders scripts/assets/arena-audio/recipes.mjs from real recordings into sound banks.
//
//   node scripts/assets/build-arena-audio.mjs            build every bank
//   node scripts/assets/build-arena-audio.mjs w.vanguard  build some banks (by name or prefix: w., steps., voice.)
//
// Pipeline: masters (downloaded once into .asset-cache/arena-audio/, never committed) → edits (cut at the attack,
// declipped where the master's peaks are flat-topped, filtered, faded, level-matched) → one sprite per bank
// (mono, and a stereo sprite where first-person weapon sounds need width) → MP3 at 48 kHz (VBR) →
// public/assets/arena/audio/<bank>.mp3 and manifest.json. Every clip is then decoded back from the MP3 the game
// will play and measured (docs/audio/qc.json); docs/audio/LICENSES.md lists the recordings actually used.
//
// A sprite starts with a one-sample marker at 50 ms: whatever delay a browser's MP3 decoder adds, the game finds
// the marker and offsets every clip by it, so cuts stay sample-accurate on every browser.
// Needs ffmpeg on the PATH, and 7z (or Python with py7zr) for the 7z archives.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CACHE, OUT, ROOT, ensureDir } from './common.mjs';
import * as D from './arena-audio/dsp.mjs';
import { PACKS, BSB } from './arena-audio/sources.mjs';
import { BANKS, FIREARMS, WEAPON_MECH, SURFACE_SOURCES, LANDINGS, AMBIENCE, VOICES, BREATH } from './arena-audio/recipes.mjs';

const RATE = D.RATE, MARKER = .05, LEAD = .25, GAP = .06;
const SRC = ensureDir(path.join(CACHE, 'arena-audio')), DEST = ensureDir(path.join(OUT, 'arena', 'audio')), DOCS = ensureDir(path.join(ROOT, 'docs', 'audio'));
const only = process.argv.slice(2);
const used = new Map(); // source ref → { pack, bank set }

// ---------------------------------------------------------------- sources
async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  ensureDir(path.dirname(dest));
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); fs.writeFileSync(dest + '.part', Buffer.from(await r.arrayBuffer())); fs.renameSync(dest + '.part', dest); return dest; }
    catch (e) { if (i === 3) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
}
function extract(archive, dir) {
  if (fs.existsSync(dir)) return;
  const tmp = dir + '.tmp'; fs.rmSync(tmp, { recursive: true, force: true }); ensureDir(tmp);
  if (archive.endsWith('.zip')) execFileSync('unzip', ['-q', '-o', archive, '-d', tmp]);
  else {
    try { execFileSync('7z', ['x', '-y', `-o${tmp}`, archive], { stdio: 'ignore' }); }
    catch { execFileSync('python3', ['-I', '-c', 'import py7zr,sys; py7zr.SevenZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, tmp]); }
  }
  fs.renameSync(tmp, dir);
}
const resolved = new Map();
/** Local path of '<pack>/<path>' (downloading and extracting the pack on first use). */
async function source(ref) {
  if (resolved.has(ref)) return resolved.get(ref);
  const i = ref.indexOf('/'), pack = ref.slice(0, i), rest = ref.slice(i + 1), P = PACKS[pack];
  if (!P) throw new Error('unknown pack ' + ref);
  let file;
  if (pack === 'bsb') { if (!BSB[rest]) throw new Error(`BigSoundBank ${rest} is not in the catalogue`); file = await download(P.file(rest), path.join(SRC, 'bsb', rest + '.ogg')); }
  else if (P.files) { const url = P.files[rest]; if (!url) throw new Error('not in pack: ' + ref); file = await download(url, path.join(SRC, pack, rest)); }
  else {
    const name = decodeURIComponent(P.archive.split('/').pop()), archive = await download(P.archive, path.join(SRC, pack, name)), dir = path.join(SRC, pack, 'x');
    extract(archive, dir); file = path.join(dir, P.root, rest);
  }
  if (!fs.existsSync(file)) throw new Error('missing ' + ref + ' → ' + file);
  resolved.set(ref, file); return file;
}
const decoded = new Map();
/** Decoded master at 48 kHz (declipped first when the pack's masters need it), cached per run. */
async function master(ref, ch) {
  const key = ref + '|' + ch; if (decoded.has(key)) return decoded.get(key);
  const file = await source(ref), p = D.probe(file);
  let x;
  if (ref.startsWith('ffsl/')) {
    // Repair flat-topped peaks at the native rate (adeclip), then resample.
    const tmp = path.join(SRC, 'declip', ref.replace(/[^a-z0-9]+/gi, '_') + '.wav');
    if (!fs.existsSync(tmp)) { ensureDir(path.dirname(tmp)); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-af', 'adeclip=w=55:o=75:a=8:t=10', '-c:a', 'pcm_f32le', tmp]); }
    x = D.decode(tmp, { rate: RATE, channels: ch });
  } else x = D.decode(file, { rate: RATE, channels: ch });
  const v = { x, info: p, file }; decoded.set(key, v); return v;
}
const onsetCache = new Map();
async function onsetsOf(ref, ch = 1, o = {}) {
  const k = ref + JSON.stringify(o); if (onsetCache.has(k)) return onsetCache.get(k);
  const { x } = await master(ref, ch), t = D.onsets(x, RATE, { rel: -32, rise: 10, gap: .12, ...o }); onsetCache.set(k, t); return t;
}

// ---------------------------------------------------------------- rendering a variant
/** One edited clip from a variant spec. Returns channels at RATE. */
async function render(v, ch, bank) {
  if (v.layers) {
    const parts = [];
    for (const { offset = 0, gain = 0, ...l } of v.layers) parts.push({ x: await render(l, ch, bank), offset, gain });
    const n = Math.max(...parts.map(p => D.len(p.x) + Math.round(p.offset * RATE))), out = D.zeros(ch, n);
    for (const p of parts) D.mixInto(out, p.x, RATE, p.offset, D.dbToGain(p.gain));
    D.softClip(out, .9);
    return finishClip(out, v);
  }
  note(v.src, bank);
  const { x } = await master(v.src, ch);
  let at = v.at ?? 0;
  if (typeof at === 'string' && at.startsWith('#')) { const k = +at.slice(1), t = await onsetsOf(v.src); if (t[k] == null) throw new Error(`${v.src} has no onset ${at} (${t.length})`); at = t[k]; }
  if (at > 0 && v.onset !== false) at = D.refineOnset(x, RATE, at, { window: .03, rel: -20 });
  const pre = v.pre ?? (v.onset === false ? 0 : .003);
  let y = D.cut(x, RATE, Math.max(0, at - pre), v.dur > 0 ? v.dur + pre : 0);
  if (v.trimHead) { y = D.trimHead(y, RATE, { floorDb: v.headDb ?? -30, pre: v.headPre ?? .006 }); D.fadeIn(y, RATE, .004); }
  return finishClip(y, v);
}
function finishClip(y, v) {
  if (v.rate && v.rate !== 1) y = D.varispeed(y, v.rate);
  y = D.filter(y, RATE, [...(v.hp ? [['hp', v.hp, .7]] : []), ...(v.lp ? [['lp', v.lp, .7]] : []), ...(v.eq ?? [])]);
  if (v.gain) D.gain(y, D.dbToGain(v.gain));
  if (v.rev) y = D.reverse(y);
  if (!v.keepLength) y = D.trimTail(y, RATE, { floorDb: v.floor ?? -54, keep: .02, fade: v.fo ?? .04 });
  else D.fadeOut(y, RATE, v.fo ?? .04);
  D.fadeIn(y, RATE, v.fi ?? .001);
  return D.dcBlock(y, RATE, 18);
}
function note(ref, bank) { if (!ref) return; const u = used.get(ref) ?? { banks: new Set() }; u.banks.add(bank); used.set(ref, u); }
function level(clips, norm) {
  for (const c of clips) {
    if (norm?.peak != null) D.normalizePeak(c.x, norm.peak);
    else D.normalizeShort(c.x, RATE, norm?.short ?? -20, norm?.ceiling ?? -2);
  }
}

// ---------------------------------------------------------------- generated banks
/** A firearm: shot bodies (stereo), tails (stereo, the bodies' own gains), mid and far layers, mechanics. */
async function firearmBank(id) {
  const f = FIREARMS[id], bank = 'w.' + id, out = {}, bodies = [], tails = [], body = f.body, xf = .04, tailLen = f.tail ?? 1.35;
  // Every shot attack in the near recordings.
  const shots = [];
  for (const s of f.near) {
    note(s.file, bank);
    if (s.burst) { const t = (await onsetsOf(s.file, 2, { rel: -10, rise: 10, gap: .05 })).filter(x => x >= s.burst[0] && x <= s.burst[1]); t.forEach((at, i) => shots.push({ file: s.file, at, next: t[i + 1] ?? null })); }
    else shots.push({ file: s.file, at: s.at, next: null });
  }
  for (const s of shots.slice(0, f.maxBodies ?? 99)) {
    const { x } = await master(s.file, 2), at = D.refineOnset(x, RATE, s.at, { window: .02, rel: -14 }), len = Math.min(body, s.next ? s.next - s.at - .004 : body);
    const b = D.cut(x, RATE, at - .0015, len + .0015); D.fadeIn(b, RATE, .0005); D.fadeOut(b, RATE, Math.min(xf, len * .4));
    const fb = D.filter(b, RATE, f.eq), g = D.dbToGain(-1.5) / D.peak(fb); D.gain(fb, g);
    bodies.push({ x: D.dcBlock(fb, RATE, 18), from: `${s.file} @ ${at.toFixed(3)} s` });
    if (!s.next && tails.length < 3) {
      const t = D.cut(x, RATE, at + len - Math.min(xf, len * .4), tailLen); D.fadeIn(t, RATE, Math.min(xf, len * .4));
      const ft = D.filter(t, RATE, f.eq); D.gain(ft, g); D.fadeOut(ft, RATE, tailLen * .35);
      tails.push({ x: D.dcBlock(ft, RATE, 18), from: `${s.file} @ ${(at + len).toFixed(3)} s` });
    }
  }
  // Weapons with few recorded shots get small, physically plausible differences (±3 % rate: a slightly different
  // charge; ±1 dB) so automatic fire never repeats one waveform.
  const real = bodies.length;
  (f.spice ?? []).forEach(([rate, db], i) => { const src = bodies[i % real], y = D.varispeed(D.copy(src.x), rate); D.normalizePeak(y, -1.5 + Math.min(0, db)); bodies.push({ x: y, from: src.from + ` (variant: rate ${rate})` }); });
  out.shot = { ch: 2, clips: bodies, pre: true };
  out.tail = { ch: 2, clips: tails, pre: true };
  // Mid-distance microphone (3rd person, 25 m and beyond) and its far version (air absorption, longer decay).
  const mids = [], fars = [];
  for (const s of f.mid) {
    note(s.file, bank);
    const list = s.burst ? (await onsetsOf(s.file, 1, { rel: -10, rise: 10, gap: .05 })).filter(x => x >= s.burst[0] && x <= s.burst[1]).slice(-1) : [s.at];
    for (const a of list) {
      const { x } = await master(s.file, 1), at = D.refineOnset(x, RATE, a, { window: .02, rel: -14 });
      const m = D.filter(D.cut(x, RATE, at - .002, 1.5), RATE, [['hp', 60], ...f.eq.filter(e => e[0] !== 'hp')]); D.fadeIn(m, RATE, .0005); D.fadeOut(m, RATE, .5);
      D.normalizeShort(m, RATE, -14, -2); mids.push({ x: D.dcBlock(m, RATE), from: `${s.file} @ ${at.toFixed(3)} s` });
      let fa = D.cut(x, RATE, at - .002, 2.2); fa = D.filter(D.sweepLowpass(fa, RATE, 2600, 900, .25), RATE, [['hp', 70]]); D.fadeIn(fa, RATE, .002); D.fadeOut(fa, RATE, .8);
      D.normalizeShort(fa, RATE, -16, -2); fars.push({ x: D.dcBlock(fa, RATE), from: `${s.file} @ ${at.toFixed(3)} s (air absorption)` });
    }
  }
  out.mid = { ch: 1, clips: mids, pre: true }; out.far = { ch: 1, clips: fars, pre: true };
  // Mechanics.
  for (const [cue, variants] of Object.entries(WEAPON_MECH[id] ?? {})) out[cue] = { ch: 1, norm: { short: cue === 'dry' ? -24 : -22 }, variants };
  return { sounds: out, q: 3, rate: 32000, rateStereo: 48000, max: .7, meta: { tailAt: +(body - xf).toFixed(3), name: f.name, casing: f.casing } };
}

/** Footsteps on one surface: walk, run and soft (crouch) sets cut from takes, scuffs, landings and stairs. */
async function stepsBank(surface) {
  const s = SURFACE_SOURCES[surface], bank = 'steps.' + surface, pool = [];
  for (const t of s.takes ?? []) pool.push(...await autoSlice(t, bank, s.eq));
  for (const v of s.extra ?? []) { const x = await render({ ...v, eq: [...(v.eq ?? []), ...(s.eq ?? [])] }, 1, bank); pool.push({ x, z: 0, dur: D.len(x) / RATE, from: v.src }); }
  if (s.designed) {
    // Boots on steel: the step with a steel plate ringing under it (a sheet-steel bar, BigSoundBank, low and short).
    const ring = await render({ src: 'bsb/1771', at: 0, dur: 0, onset: false, trimHead: true, lp: s.designed === 'container' ? 900 : 2600, hp: 120, fo: .15 }, 1, bank);
    for (const p of pool.slice()) { const y = D.copy(p.x); D.mixInto(y, ring, RATE, .002, D.peak(p.x) / D.peak(ring) * (s.designed === 'container' ? .45 : .28)); pool.push({ x: D.trimTail(y, RATE, { floorDb: -50 }), z: p.z + .5, dur: p.dur, from: p.from + ' + steel ring (designed)' }); }
  }
  if (!pool.length) throw new Error('no steps for ' + surface);
  // Split by how hard each step was struck within its own take: the softest third for crouching, the firmest for running.
  const byZ = [...pool].sort((a, b) => a.z - b.z), n = byZ.length;
  const soft = byZ.slice(0, Math.max(3, Math.round(n * .3))), run = byZ.slice(Math.round(n * .55)), walk = byZ.slice(Math.round(n * .15), Math.round(n * .8));
  const pick = (list, k) => list.length <= k ? list : Array.from({ length: k }, (_, i) => list[Math.floor(i * list.length / k)]);
  const sounds = {
    walk: { ch: 1, norm: { short: -21 }, clips: pick(walk, 8) }, run: { ch: 1, norm: { short: -17 }, clips: pick(run, 8) },
    soft: { ch: 1, norm: { short: -27 }, clips: pick(soft, 5).map(c => ({ ...c, x: D.filter(D.copy(c.x), RATE, [['hs', 3500, .7, -4]]) })) },
  };
  // Scuffs (stopping, turning on the spot): the longest, most frictional steps, shortened and faded.
  const scuff = [...pool].sort((a, b) => b.dur - a.dur).slice(0, 3).map(c => ({ ...c, x: D.fadeOut(D.cut(D.copy(c.x), RATE, 0, .28), RATE, .12) }));
  sounds.scuff = { ch: 1, norm: { short: -24 }, clips: scuff };
  if (s.stairs) { const st = []; for (const t of s.stairs) st.push(...await autoSlice(t, bank, s.eq)); sounds.stairs = { ch: 1, norm: { short: -18 }, clips: pick(st, 8) }; }
  // Landing: recorded two-footed jumps where they exist; otherwise two firm steps 35 ms apart (feet arriving together).
  if (LANDINGS[surface]) sounds.land = { ch: 1, norm: { short: -15 }, variants: LANDINGS[surface] };
  else {
    const two = []; for (let i = 0; i + 1 < Math.min(run.length, 8); i += 2) { const a = run[i].x, b = run[i + 1].x, y = D.zeros(1, D.len(a) + Math.round(.035 * RATE) + D.len(b)); D.mixInto(y, a, RATE, 0, 1); D.mixInto(y, b, RATE, .035, .85); two.push({ x: D.trimTail(y, RATE, { floorDb: -50 }), from: `${run[i].from} + ${run[i + 1].from} (two feet)` }); }
    sounds.land = { ch: 1, norm: { short: -15 }, clips: two };
  }
  return { sounds, q: 5, rate: 32000, max: .36 };
}
/** Cut every usable step out of a take: one attack to just before the next, isolated, unclipped, typical in level. */
async function autoSlice(t, bank, eq = []) {
  note(t.src, bank);
  const { x } = await master(t.src, 1), on = await onsetsOf(t.src, 1, { rel: -30, rise: 10, gap: .18 }), out = [];
  for (let i = 0; i < on.length; i++) {
    const a = on[i], next = on[i + 1] ?? a + .5, len = Math.min(.42, next - a - .02);
    if (len < .12) continue;
    let y = D.cut(x, RATE, Math.max(0, a - .004), len + .004);
    if (D.peak(y) > .985) continue; // a step that hit full scale in the master
    y = D.filter(y, RATE, [['hp', 60, .7], ...eq]);
    const st = D.stats(y, RATE);
    out.push({ y, st, at: a, i });
  }
  if (!out.length) return [];
  const sorted = out.map(o => o.st.shortDb).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const good = out.filter(o => o.st.shortDb > med - 9 && o.st.shortDb < med + 6 && o.st.floorDb < o.st.shortDb - 14).slice(t.skip ?? 0);
  const k = Math.min(t.max ?? 12, good.length), chosen = Array.from({ length: k }, (_, j) => good[Math.floor(j * good.length / k)]);
  return chosen.map(o => { let y = D.trimTail(o.y, RATE, { floorDb: -46, keep: .02, fade: .04 }); D.fadeIn(y, RATE, .001); return { x: y, z: o.st.shortDb - med, dur: D.len(y) / RATE, from: `${t.src} @ ${o.at.toFixed(3)} s` }; });
}

/** A character's voice: hurt (light: the first part of a grunt), heavy, severe, death, effort. */
async function voiceBank(id) {
  const v = VOICES[id], bank = 'voice.' + id, sounds = {};
  const one = async (ref, o = {}) => render({ src: ref, at: 0, dur: 0, onset: false, trimHead: true, headDb: -34, headPre: .03, hp: 110, floor: -50, fo: .08, ...o }, 1, bank);
  const cut = async (k, o = {}) => { const t = v.cuts[k], end = v.cuts[k + 1] ?? t + 1.4; return render({ src: v.take, at: t, dur: Math.min(1.4, end - t - .05), pre: .03, hp: 110, floor: -38, fo: .12, ...o }, 1, bank); };
  const make = async (list, o) => Promise.all(list.map(r => (v.take ? cut(r, o) : one(r, o))));
  const light = async list => (await make(list)).map(x => D.fadeOut(D.cut(x, RATE, 0, Math.min(.34, D.len(x) / RATE)), RATE, .1));
  sounds.hurt = { ch: 1, norm: { short: -19 }, clips: (await light(v.hurt)).map(x => ({ x })) };
  sounds.heavy = { ch: 1, norm: { short: -17 }, clips: (await make(v.heavy)).map(x => ({ x: D.fadeOut(D.cut(x, RATE, 0, Math.min(.75, D.len(x) / RATE)), RATE, .15) })) };
  sounds.severe = { ch: 1, norm: { short: -18 }, clips: (await make(v.severe)).map(x => ({ x: D.fadeOut(D.cut(x, RATE, 0, Math.min(1.1, D.len(x) / RATE)), RATE, .25) })) };
  sounds.death = { ch: 1, norm: { short: -17 }, clips: (await make(v.death)).map(x => ({ x: D.fadeOut(D.cut(x, RATE, 0, Math.min(1.3, D.len(x) / RATE)), RATE, .3) })) };
  sounds.effort = { ch: 1, norm: { short: -24 }, clips: (await light(v.effort)).map(x => ({ x })) };
  return { sounds, q: 5, rate: 24000, meta: { who: v.who } };
}

/** A map's ambience: seamless loops and occasional one-shots. */
async function ambienceBank(map) {
  const a = AMBIENCE[map], bank = 'amb.' + map, sounds = {};
  for (const [k, l] of Object.entries(a)) {
    if (k === 'oneshots') continue;
    note(l.src, bank);
    const { x } = await master(l.src, 1);
    let y = D.filter(D.cut(x, RATE, l.at, l.loop + l.xf + .1), RATE, [['hp', l.hp, .7], ['lp', l.lp, .7]]);
    y = D.seamlessLoop(y, RATE, l.loop, l.xf); D.normalizeShort(y, RATE, l.short, -6);
    sounds[k] = { ch: 1, loop: true, clips: [{ x: y, from: `${l.src} @ ${l.at} s, ${l.loop} s loop` }] };
  }
  for (const [k, list] of Object.entries(a.oneshots)) sounds[k] = { ch: 1, norm: { short: k === 'flag' ? -32 : -28 }, variants: list };
  return { sounds, q: 6, rate: 16000, max: 1.6 };
}

/** Exertion breathing, one bank per body (only the player's own is loaded). */
async function breathBank(k) {
  const b = BREATH[k], bank = 'breath.' + k; note(b.src, bank); const { x } = await master(b.src, 1);
  let y = D.filter(D.cut(x, RATE, b.at, b.loop + b.xf + .1), RATE, [['hp', 140, .7], ['lp', 9000, .7]]); y = D.seamlessLoop(y, RATE, b.loop, b.xf); D.normalizeShort(y, RATE, -26, -6);
  return { sounds: { loop: { ch: 1, loop: true, clips: [{ x: y, from: `${b.src} @ ${b.at} s` }] } }, q: 6, rate: 24000 };
}

// ---------------------------------------------------------------- sprite assembly
/** Render a bank's sounds to clips, then lay them out in a mono and/or stereo sprite. */
async function buildBank(name, def) {
  const rendered = {};
  for (const [sname, sd] of Object.entries(def.sounds)) {
    const ch = sd.ch ?? 1;
    let clips = sd.clips;
    if (!clips) { clips = []; for (const v of sd.variants) clips.push({ x: await render(sd.loop ? { ...v, keepLength: true, fo: 0, fi: 0 } : v, ch, name), from: describe(v) }); }
    clips = clips.map(c => ({ ...c, x: D.toChannels(c.x, ch) }));
    const max = sd.max ?? def.max;
    if (max && !sd.loop) clips = clips.map(c => (D.len(c.x) / RATE > max ? { ...c, x: D.fadeOut(D.cut(c.x, RATE, 0, max), RATE, Math.min(.12, max * .3)) } : c));
    if (sd.loop && !sd.clips) clips = clips.map(c => ({ ...c, x: D.seamlessLoop(c.x, RATE, D.len(c.x) / RATE - (sd.loop.xf ?? .4) - .01, sd.loop.xf ?? .4) }));
    if (sd.norm) level(clips, sd.norm);
    // Every one-shot starts and ends at silence, whatever filtering or levelling came last.
    if (!sd.loop) for (const c of clips) { D.fadeIn(c.x, RATE, .0008); D.fadeOut(c.x, RATE, .008); }
    rendered[sname] = { ch, loop: !!sd.loop, clips };
  }
  const files = [], sounds = {};
  for (const ch of [1, 2]) {
    const list = Object.entries(rendered).filter(([, r]) => r.ch === ch); if (!list.length) continue;
    let total = Math.round((MARKER + LEAD) * RATE);
    const place = [];
    for (const [sname, r] of list) for (const c of r.clips) {
      const padN = r.loop ? Math.round(.05 * RATE) : 0, n = D.len(c.x) + 2 * padN;
      place.push({ sname, c, at: total, padN, loop: r.loop }); total += n + Math.round(GAP * RATE);
    }
    const sprite = D.zeros(ch, total);
    for (const k of sprite) k[Math.round(MARKER * RATE)] = .9;
    for (const p of place) {
      const n = D.len(p.c.x);
      for (let k = 0; k < ch; k++) for (let i = -p.padN; i < n + p.padN; i++) sprite[k][p.at + p.padN + i] = p.c.x[k][((i % n) + n) % n];
    }
    const file = `${name}${ch === 2 ? '.st' : ''}.mp3`, out = path.join(DEST, file), rate = ch === 2 ? (def.rateStereo ?? 48000) : (def.rate ?? 32000);
    D.encodeMp3(sprite, RATE, out, def.q ?? 4, rate);
    const fi = files.length; files.push({ file, ch, rate, bytes: fs.statSync(out).size, seconds: +(total / RATE).toFixed(2) });
    for (const p of place) {
      const start = (p.at + p.padN) / RATE - MARKER, dur = D.len(p.c.x) / RATE;
      // The clip's loudest moment (5 ms resolution): the game aligns it to the animation (a magazine's latch click).
      const env = D.envelope(p.c.x, RATE, .005); let pk = 0; for (let i = 1; i < env.length; i++) if (env[i] > env[pk]) pk = i;
      (sounds[p.sname] ??= []).push([fi, +start.toFixed(5), +dur.toFixed(5), +(pk * .005).toFixed(3), ...(p.loop ? [1] : [])]);
      p.manifest = { fi, start, dur };
    }
    files[fi].place = place;
  }
  return { files, sounds, meta: def.meta };
}
const describe = v => v.layers ? 'layers: ' + v.layers.map(describe).join(' + ') : `${v.src}${typeof v.at === 'string' ? ' ' + v.at : v.at ? ' @ ' + v.at + ' s' : ''}${v.rate && v.rate !== 1 ? ` rate ${+v.rate.toFixed(3)}` : ''}`;

// ---------------------------------------------------------------- QC: decode what the game will play and measure it
function qcBank(name, b) {
  const rows = [];
  for (const f of b.files) {
    const y = D.decode(path.join(DEST, f.file), { rate: RATE, channels: f.ch }); // (back to 48 kHz for measuring)
    // Find the marker as the game does.
    let m = 0, mi = 0; for (let i = 0; i < Math.round(LEAD * RATE); i++) { const a = Math.abs(y[0][i]); if (a > m) { m = a; mi = i; } }
    const delay = mi / RATE - MARKER;
    for (const p of f.place) {
      const s = p.manifest, clip = D.cut(y, RATE, s.start + MARKER + delay, s.dur), st = D.stats(clip, RATE);
      const env = D.envelope(clip, RATE, .002), top = Math.max(...env), headMs = env.findIndex(e => e > top * .1) * 2, endDb = D.gainToDb(env[env.length - 1] / top);
      // flags: defects. notes: characteristics that are by design (a magazine's slide before its latch — the game aligns
      // the latch to the animation; a voice's breath before the grunt; a buzzer that is a continuous tone).
      const flags = [], notes = [];
      if (st.peakDb > -.5) flags.push(`peak ${st.peakDb} dBFS`);
      if (!p.loop && endDb > -30) flags.push(`abrupt end (${endDb.toFixed(0)} dB)`);
      const swell = /tail|whoosh|swing|swap|throw|grab|flag|creak|chain|hum|wind|drawBlade|debris/.test(p.sname) || name.startsWith('amb.');
      const aligned = (name.startsWith('w.') && !/^(shot|tail|mid|far)$/.test(p.sname)) || name.startsWith('voice.') || name === 'vo' || name === 'handling' || name.startsWith('steps.');
      if (!p.loop && !swell && headMs > 40) (aligned ? notes : flags).push(`${aligned ? 'peak-aligned at play: ' : 'late start '}(${headMs} ms to its attack)`);
      if (!p.loop && p.sname !== 'tail' && st.seconds > .5 && st.floorDb > st.peakDb - 36) (name === 'vo' || name.startsWith('voice.') || p.sname === 'alarm' || st.floorDb < st.peakDb - 30 ? notes : flags).push(`quiet part ${st.floorDb} dB (peak ${st.peakDb})`);
      if (Math.abs(st.dc) > .002) flags.push('DC offset');
      rows.push({ bank: name, sound: p.sname, file: f.file, seconds: st.seconds, peakDb: st.peakDb, shortDb: st.shortDb, floorDb: st.floorDb, decay40: st.decay40, from: p.c.from ?? '', flags, notes, delayMs: +(delay * 1000).toFixed(2) });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- main
const banks = {};
for (const [n, d] of Object.entries(BANKS)) banks[n] = async () => d;
for (const k of Object.keys(BREATH)) banks['breath.' + k] = () => breathBank(k);
for (const id of Object.keys(FIREARMS)) banks['w.' + id] = () => firearmBank(id);
for (const s of Object.keys(SURFACE_SOURCES)) banks['steps.' + s] = () => stepsBank(s);
for (const v of Object.keys(VOICES)) banks['voice.' + v] = () => voiceBank(v);
for (const m of Object.keys(AMBIENCE)) banks['amb.' + m] = () => ambienceBank(m);

const manifestPath = path.join(DEST, 'manifest.json'), qcPath = path.join(DOCS, 'qc.json');
const manifest = fs.existsSync(manifestPath) && only.length ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, rate: RATE, marker: MARKER, banks: {} };
const qc = fs.existsSync(qcPath) && only.length ? JSON.parse(fs.readFileSync(qcPath, 'utf8')) : { clips: [] };
const t0 = Date.now();
for (const [name, make] of Object.entries(banks)) {
  if (only.length && !only.some(o => name === o || (o.endsWith('.') && name.startsWith(o)))) continue;
  const def = await make(), b = await buildBank(name, def);
  manifest.banks[name] = { files: b.files.map(({ place, ...f }) => f), sounds: b.sounds, ...(b.meta ? { meta: b.meta } : {}) };
  qc.clips = qc.clips.filter(r => r.bank !== name).concat(qcBank(name, b));
  const bytes = b.files.reduce((a, f) => a + f.bytes, 0), secs = b.files.reduce((a, f) => a + f.seconds * f.ch, 0);
  console.log(`${name.padEnd(18)} ${Object.keys(b.sounds).length} sounds, ${Object.values(b.sounds).reduce((a, s) => a + s.length, 0)} clips, ${(bytes / 1024).toFixed(0)} KB, ${secs.toFixed(1)} s audio`);
}
// Manifest: banks sorted, totals for the loader's progress.
manifest.banks = Object.fromEntries(Object.entries(manifest.banks).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
const flagged = qc.clips.filter(r => r.flags.length);
qc.summary = { built: new Date().toISOString(), banks: Object.keys(manifest.banks).length, clips: qc.clips.length, flagged: flagged.length, bytes: Object.values(manifest.banks).reduce((a, b) => a + b.files.reduce((x, f) => x + f.bytes, 0), 0) };
fs.writeFileSync(qcPath, JSON.stringify(qc, null, 1));
if (!only.length) writeLicences();
console.log(`${qc.summary.clips} clips in ${qc.summary.banks} banks, ${(qc.summary.bytes / 1048576).toFixed(2)} MB; ${flagged.length} flagged; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const r of flagged.slice(0, 40)) console.log('  ⚠', r.bank, r.sound, r.flags.join(', '), '—', r.from);

function writeLicences() {
  const byPack = new Map();
  for (const [ref, u] of used) { const pack = ref.slice(0, ref.indexOf('/')); (byPack.get(pack) ?? byPack.set(pack, []).get(pack)).push([ref.slice(pack.length + 1), [...u.banks]]); }
  let md = '# Combat Arena audio: sources and licences\n\nGenerated by `scripts/assets/build-arena-audio.mjs` from `scripts/assets/arena-audio/sources.mjs`. Every recording listed here is used by at least one runtime sound bank in `public/assets/arena/audio/`; the banks are edits of these recordings (cuts, filters, level, pitch for a part\'s size, layers).\n\n';
  md += 'CC BY and CC BY-SA works require attribution; CC BY-SA also requires that the derived sounds (the edited clips inside the banks that use them) are shared under the same licence. Those banks are listed per source, so the obligation is clear: the game code is not a derivative of the sounds.\n\n';
  for (const [pack, refs] of [...byPack].sort()) {
    const P = PACKS[pack];
    md += `## ${P.title}\n\n- Author: ${P.author}\n- Licence: ${P.licence}\n- Source: ${P.page}\n${P.notes ? `- Notes: ${P.notes}\n` : ''}- Recordings used (${refs.length}):\n`;
    for (const [r, b] of refs.sort()) md += `  - ${pack === 'bsb' ? `[${r} — ${BSB[r]}](${P.itemPage(r)})` : '`' + r + '`'} → ${b.join(', ')}\n`;
    md += '\n';
  }
  fs.writeFileSync(path.join(DOCS, 'LICENSES.md'), md);
}
