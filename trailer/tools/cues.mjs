// Film-time sync points for the score, from the marks each take recorded while rendering (meta.json):
// the camera passing under the gate, the ball dropping through the net.
//
//   node trailer/tools/cues.mjs [plates dir]   ->  trailer/edit/cues.json
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const plates = process.argv[2] ?? 'trailer/out/plates/9x16';
const edit = JSON.parse(await readFile('trailer/edit/edit.json', 'utf8')), cues = {};
for (const cut of edit.cuts) {
  const file = join(plates, cut.shot, 'meta.json'); if (!existsSync(file)) continue;
  for (const m of JSON.parse(await readFile(file, 'utf8')).marks ?? []) {
    const at = cut.at + m.t - (cut.from ?? 0);
    if (at >= cut.at - .3 && at <= cut.to + .3) cues[m.name] = Math.round(at * 1000) / 1000;
  }
}
await writeFile('trailer/edit/cues.json', JSON.stringify(cues, null, 2) + '\n');
console.log(cues);
