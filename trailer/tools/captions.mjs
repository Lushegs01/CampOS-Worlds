// Caption files from the edit (so they cannot drift from the picture):
//   on-screen-text.srt  every word the film shows, as it shows it (accessibility, alt text, platform captions)
//   voiceover.srt       the brief's voiceover script on the cut, for when a voice is recorded
//
//   node trailer/tools/captions.mjs [out dir]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const out = process.argv[2] ?? 'trailer/deliverables/captions';
const edit = JSON.parse(await readFile('trailer/edit/edit.json', 'utf8')), vo = JSON.parse(await readFile('trailer/edit/voiceover.json', 'utf8'));
const stamp = s => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const srt = cues => cues.map((c, i) => `${i + 1}\n${stamp(c.at)} --> ${stamp(c.to)}\n${c.text}\n`).join('\n');
const b = edit.brand;
const screen = [
  ...edit.titles.map(t => ({ at: t.at, to: t.to, text: t.text })),
  { at: b.logo, to: b.tagline, text: b.name_text },
  { at: b.tagline, to: b.end, text: b.tagline_text },
];
await mkdir(out, { recursive: true });
await writeFile(join(out, 'on-screen-text.srt'), srt(screen));
await writeFile(join(out, 'voiceover.srt'), srt(vo.lines));
console.log('captions in', out);
