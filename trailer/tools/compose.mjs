// Composites the film: edit, grade, type, graphics and logo over the rendered plates, one PNG per frame.
//
//   node trailer/tools/compose.mjs --aspect 9x16 [--plates trailer/out/plates/9x16] [--every 1]
//                                  [--size 1080x1920] [--from 0] [--to 1260] [--name master]
//
// Frames land in trailer/out/frames/<name>/00000.png; tools/encode.sh makes the video.
import { chromium } from '@playwright/test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? a.push([v.slice(2), all[i + 1] === undefined || all[i + 1].startsWith('--') ? 'true' : all[i + 1]]) : 0, a), []));
const aspect = args.aspect ?? '9x16';
const [W, H] = (args.size ?? { '9x16': '1080x1920', '16x9': '1920x1080' }[aspect]).split('x').map(Number);
const plates = resolve(args.plates ?? `trailer/out/plates/${aspect}`), name = args.name ?? `${aspect}-${W}x${H}`;
const out = resolve('trailer/out/frames', name), every = Number(args.every ?? 1);
const edit = JSON.parse(await readFile('trailer/edit/edit.json', 'utf8'));
const first = Number(args.from ?? 0), last = Math.min(Number(args.to ?? Math.round(edit.duration * edit.fps)), Math.round(edit.duration * edit.fps));

// What the page needs to know about each take: how it maps to film time, its camera, its frames on disk.
const shots = {};
for (const id of new Set(edit.cuts.map(c => c.shot))) {
  const dir = join(plates, id);
  // A take not rendered yet plays as black (handy for checking the edit while plates render).
  if (!existsSync(dir) || !(await readdir(dir)).some(f => f.endsWith('.png'))) { console.warn(`no plates yet for ${id}`); shots[id] = null; continue; }
  const files = (await readdir(dir)).filter(f => f.endsWith('.png')).map(f => Number(f.slice(0, -4))).sort((a, b) => a - b);
  const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
    : { fps: 30, pre: id === '01-hook' ? 0 : id.startsWith('03-style') ? .15 : .2, frames: files.at(-1) + 1 };
  const camera = existsSync(join(dir, 'camera.json')) ? JSON.parse(await readFile(join(dir, 'camera.json'), 'utf8')) : [];
  shots[id] = { meta, camera, files, base: `/plates/${id}` };
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.hdr': 'application/octet-stream', '.json': 'application/json' };
// A private origin served straight from disk: the compositor, three.js and fonts from the repository,
// plates from the render output.
await ctx.route('http://compose.local/**', async route => {
  const path = decodeURIComponent(new URL(route.request().url()).pathname);
  const file = path.startsWith('/plates/') ? join(plates, path.slice(8)) : resolve('.' + path);
  if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ status: 200, headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }, body: await readFile(file) });
});
const page = await ctx.newPage(); page.setDefaultTimeout(600000);
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
await page.goto('http://compose.local/trailer/compose/compose.html');
await page.waitForFunction(() => window.compose);
await page.evaluate(cfg => window.compose.init(cfg), { width: W, height: H, fps: edit.fps, edit, shots });
const cdp = await ctx.newCDPSession(page);
await mkdir(out, { recursive: true });
const t0 = Date.now();
for (let i = first; i < last; i += every) {
  await page.evaluate(i => window.compose.frame(i), i);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  await writeFile(join(out, `${String(i).padStart(5, '0')}.png`), Buffer.from(data, 'base64'));
  if ((i - first) % (60 * every) === 0) console.log(`frame ${i}/${last}  ${((Date.now() - t0) / ((i - first) / every + 1) / 1000).toFixed(2)} s/frame`);
}
await browser.close();
console.log('frames in', out);
