// Three-panel validation sheets for the daylight-fidelity pass: a frame of the owner's reference footage, then the same
// Metropolis viewpoint before and after (captures from scripts/qa/metropolis-shots.mjs).
// Usage: REF=<dir of reference frames> BEFORE=cod-before AFTER=cod-after node scripts/qa/metropolis-reference-sheets.mjs
//   PAIRS=street:f_04,avenue:f_01 (view:reference frame; the frame name without .jpg)
// The reference is footage of another studio's game: its frames are never committed. With REF set, sheets that include
// it go to OUT (default: a directory outside the repository you name); without REF, two-panel before/after sheets go to
// docs/screenshots/metropolis-photoreal/compare-reference/. Either way a tonal summary (mean/median/5th/95th percentile
// luminance, mean saturation of the central region) is written as JSON next to the sheets.
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const ROOT = 'docs/screenshots/metropolis-photoreal/', OUT = (process.env.OUT || ROOT + 'compare-reference').replace(/\/?$/, '/');
if (process.env.REF && !process.env.OUT) throw new Error('REF is set: name an OUT directory outside the repository (reference frames are not committed).');
const REF = process.env.REF, BEFORE = process.env.BEFORE || 'cod-before', AFTER = process.env.AFTER || 'cod-after';
const PAIRS = Object.fromEntries((process.env.PAIRS || '').split(',').filter(Boolean).map(p => p.split(':')));
await mkdir(OUT, { recursive: true });
const W = 640, H = 360, PAD = 6, LABEL = 30;
const label = text => Buffer.from(`<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/><text x="10" y="21" font-family="sans-serif" font-size="16" fill="#eee">${text}</text></svg>`);

/** Tonal statistics of the central region (the HUD's edges excluded), display-referred. */
async function stats(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.floor(info.width * .18), x1 = Math.floor(info.width * .82), y0 = Math.floor(info.height * .12), y1 = Math.floor(info.height * .78);
  const ys = []; let sat = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * info.width + x) * 3, r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    ys.push(.2126 * r + .7152 * g + .0722 * b); sat += mx > 0 ? (mx - mn) / mx : 0;
  }
  ys.sort((a, b) => a - b); const q = p => +ys[Math.floor(p * (ys.length - 1))].toFixed(3);
  return { mean: +(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(3), median: q(.5), p5: q(.05), p95: q(.95), saturation: +(sat / ys.length).toFixed(3) };
}

const summary = {};
for (const file of (await readdir(ROOT + AFTER)).filter(f => f.endsWith('.jpg') && !f.startsWith('failure'))) {
  const before = ROOT + BEFORE + '/' + file; if (!existsSync(before)) continue;
  const view = file.split('-')[1], ref = REF && PAIRS[view] ? `${REF}/${PAIRS[view]}.jpg` : null;
  const panels = [...(ref && existsSync(ref) ? [[ref, 'REFERENCE (owner footage, other game)']] : []), [before, 'BEFORE  ·  ' + file.replace('.jpg', '')], [ROOT + AFTER + '/' + file, 'AFTER  ·  ' + file.replace('.jpg', '')]];
  const bufs = await Promise.all(panels.map(([p]) => sharp(p).resize(W, H).toBuffer()));
  await sharp({ create: { width: W * panels.length + PAD * (panels.length - 1), height: H + LABEL, channels: 3, background: '#111' } })
    .composite(panels.flatMap(([, t], i) => [{ input: label(t), left: i * (W + PAD), top: 0 }, { input: bufs[i], left: i * (W + PAD), top: LABEL }]))
    .jpeg({ quality: 84 }).toFile(OUT + file);
  summary[file] = { before: await stats(before), after: await stats(ROOT + AFTER + '/' + file), ...(ref ? { reference: await stats(ref) } : {}) };
}
if (REF) { summary.referenceFrames = {}; for (const f of (await readdir(REF)).filter(f => f.endsWith('.jpg'))) summary.referenceFrames[f] = await stats(`${REF}/${f}`); }
await writeFile(OUT + 'tonal-summary.json', JSON.stringify(summary, null, 2) + '\n');
console.log(`${Object.keys(summary).length} sheets / summaries in ${OUT}`);
