// Before/after sheets for the Storm Break report (docs/PHOTOREALISM.md §6): Harmattan Noon on the original code (what Quick Play showed) beside
// Storm Break on the new code, same viewpoint and profile. Run from the repository root:
//   node scripts/qa/metropolis-storm-sheets.mjs <before dir> <after dir> <out dir> port,yard,street,south
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const [before, after, out, views] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const W = 960, H = 540, PAD = 8, LABEL = 34;
const label = text => Buffer.from(`<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/><text x="12" y="23" font-family="sans-serif" font-size="18" fill="#eee">${text}</text></svg>`);
for (const view of views.split(',')) {
  const b = `${before}/day-${view}-high.jpg`, a = `${after}/storm-${view}-high.jpg`;
  if (!existsSync(b) || !existsSync(a)) { console.log('skip', view); continue; }
  const [bi, ai] = await Promise.all([b, a].map(p => sharp(p).resize(W, H).toBuffer()));
  await sharp({ create: { width: W * 2 + PAD, height: H + LABEL, channels: 3, background: '#111' } })
    .composite([{ input: label(`BEFORE · Harmattan Noon (previous Quick Play) · ${view} · High`), left: 0, top: 0 }, { input: label(`AFTER · Storm Break (Quick Play) · ${view} · High`), left: W + PAD, top: 0 }, { input: bi, left: 0, top: LABEL }, { input: ai, left: W + PAD, top: LABEL }])
    .jpeg({ quality: 84 }).toFile(`${out}/storm-break-${view}-high.jpg`);
  console.log('sheet', view);
}
