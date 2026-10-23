// Exact raster variants of the existing favicon mark; the social lockup uses the game's bundled font.
// Run once when branding changes. Generated assets are committed; normal builds need no browser.
import sharp from 'sharp';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { launch } from '../../tests/support/browser.mjs';

const source = await readFile('public/favicon.svg');
await mkdir('public/icons', { recursive: true });
await mkdir('public/brand', { recursive: true });
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180], ['favicon-32', 32]]) {
  await sharp(source).resize(size, size).flatten({ background: '#29483c' }).png().toFile(`public/icons/${name}.png`);
}
const mark = await sharp(source).resize(384, 384).png().toBuffer();
const maskable = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#29483c' } })
  .composite([{ input: mark, left: 64, top: 64 }]).png().toBuffer();
await sharp(maskable).removeAlpha().png().toFile('public/icons/maskable-512.png');
const font = await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2');
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face{font-family:Manrope;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:200 800}
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#19382f;color:#f4f0e6;font-family:Manrope,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:100px}
    .lockup{display:flex;align-items:center;gap:28px}.mark{width:128px;height:128px}.mark svg{width:100%;height:100%}
    .name{font-size:82px;font-weight:650;letter-spacing:-4px}.worlds{font-size:26px;font-weight:450;letter-spacing:10px;margin-left:24px;padding-left:28px;border-left:1px solid #efc57b66}
    p{font-size:35px;font-weight:450;margin:48px 0 0 4px;letter-spacing:-.7px;color:#efc57b}
    .line{height:1px;width:96px;background:#efc57b;margin:40px 0 0 4px}
  </style></head><body><div class="lockup"><span class="mark">${source.toString()}</span><span class="name">CampOS</span><span class="worlds">WORLDS</span></div><p>Find your people. Find your place.</p><div class="line"></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot();
  await sharp(png).png({ compressionLevel: 9 }).toFile('public/brand/campos-worlds-social.png');
  await writeFile('public/brand/README.txt', 'Source mark: public/favicon.svg (existing CampOS logo). Wordmark: bundled Manrope. Regenerate: npm run assets:brand.\n');
} finally { await browser.close(); }
console.log('Generated authentic CampOS icons and 1200 × 630 social preview.');
