// Adapt the already-authored M7 PCM design to the recorded-bank audio engine introduced by PR #31.
// No replacement recordings: src/arena/m7Audio.ts remains the source of the M7's distinct sound.
import { readFileSync, writeFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync('src/arena/m7Audio.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { m7Buffer } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const rate = 48000, ctx = { sampleRate: rate, createBuffer: (_, n) => { const data = new Float32Array(n); return { getChannelData: () => data }; } };
const names = { shot: 'm7-suppressed', mid: 'm7-suppressed', far: 'm7-suppressed', tail: 'm7-suppressed', magRelease: 'm7-release', magOut: 'm7-out', magIn: 'm7-insert', magSeat: 'm7-ready', boltRelease: 'm7-action', dry: 'm7-dry', raise: 'm7-switch' };
const parts = [new Float32Array(rate / 4)], sounds = {}; parts[0][Math.round(.05 * rate)] = .8;
let offset = .25;
for (const [cue, name] of Object.entries(names)) {
  let pcm = m7Buffer(ctx, name).getChannelData(0).slice();
  if (cue === 'tail') pcm = pcm.slice(Math.round(.11 * rate));
  const gain = cue === 'far' ? .35 : cue === 'mid' ? .65 : 1;
  pcm = pcm.map(x => x * gain);
  // Fade the tail cut independently so it never clicks when layered after the shot.
  for (let i = 0; i < Math.min(240, pcm.length); i++) pcm[i] *= i / 240;
  sounds[cue] = [[0, offset, pcm.length / rate, 0]];
  parts.push(pcm, new Float32Array(.06 * rate)); offset += pcm.length / rate + .06;
}
const pcm = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
for (const p of parts) { pcm.set(p, at); at += p.length; }
const dir = mkdtempSync(join(tmpdir(), 'campos-m7-audio-'));
try {
  const raw = join(dir, 'm7.f32'); writeFileSync(raw, Buffer.from(pcm.buffer));
  const out = 'public/assets/arena/audio/w.m7.mp3';
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', raw, '-codec:a', 'libmp3lame', '-q:a', '3', out]);
  const path = 'public/assets/arena/audio/manifest.json', manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.banks['w.m7'] = { files: [{ file: 'w.m7.mp3', ch: 1, rate, bytes: statSync(out).size, seconds: Math.ceil(offset * 100) / 100 }], sounds, meta: { tailAt: .11, name: 'M7 original PCM design', casing: 'large' } };
  writeFileSync(path, JSON.stringify(manifest) + '\n');
} finally { rmSync(dir, { recursive: true, force: true }); }
