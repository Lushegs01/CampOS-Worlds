// Side-by-side before/after sheets from scripts/qa/metropolis-shots.mjs captures (same view, same profile).
// Usage: node scripts/qa/metropolis-compare.mjs  → docs/screenshots/metropolis-photoreal/compare/<variant>-<view>-<quality>.jpg
import { readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const ROOT = 'docs/screenshots/metropolis-photoreal/', OUT = ROOT + 'compare/';
await mkdir(OUT, { recursive: true });
const W = 960, H = 540, PAD = 8, LABEL = 34;
const label = text => Buffer.from(`<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/><text x="12" y="23" font-family="sans-serif" font-size="18" fill="#eee">${text}</text></svg>`);
let n = 0;
for (const file of (await readdir(ROOT + 'after')).filter(f => f.endsWith('.jpg') && !f.startsWith('failure'))) {
  const before = ROOT + 'before/' + file; if (!existsSync(before)) continue;
  const [b, a] = await Promise.all([before, ROOT + 'after/' + file].map(p => sharp(p).resize(W, H).toBuffer()));
  const name = file.replace('.jpg', '');
  await sharp({ create: { width: W * 2 + PAD, height: H + LABEL, channels: 3, background: '#111' } })
    .composite([{ input: label(`BEFORE  ·  ${name}`), left: 0, top: 0 }, { input: label(`AFTER  ·  ${name}`), left: W + PAD, top: 0 }, { input: b, left: 0, top: LABEL }, { input: a, left: W + PAD, top: LABEL }])
    .jpeg({ quality: 84 }).toFile(OUT + file);
  n++;
}
console.log(`${n} comparison sheets in ${OUT}`);
