// Renders gameplay plates: for each shot, opens the game in headless Chromium on the capture server, lets
// the shot stage the world, then steps the game one 1/30 s frame at a time and saves every frame.
//
//   node trailer/tools/render.mjs --aspect 9x16 [--shots id,id] [--workers 2] [--scale 0.5] [--every 1] [--quality low]
//
// Final plates use the game's High profile. Blocking previews use Low: about a tenth of the time, since
// most of a software-WebGL frame is vegetation and shadow geometry whatever the resolution.
//
// Frames land in <out>/<aspect>/<shot>/00000.png. A shot already complete on disk is skipped. Software
// WebGL leaves about half the CPU idle, so shots render in parallel, one browser (and GPU process) each.
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? a.push([v.slice(2), all[i + 1] === undefined || all[i + 1].startsWith('--') ? 'true' : all[i + 1]]) : 0, a), []));
const aspect = args.aspect ?? '9x16', [W, H] = { '9x16': [1080, 1920], '16x9': [1920, 1080] }[aspect] ?? aspect.split('x').map(Number);
const quality = args.quality ?? 'high', scale = Number(args.scale ?? 1), base = args.url ?? 'http://127.0.0.1:5180';
const out = resolve(args.out ?? 'trailer/out/plates', aspect + (scale === 1 ? '' : `@${scale}`) + (quality === 'high' ? '' : `-${quality}`));
const only = args.shots ? args.shots.split(',') : null, every = Number(args.every ?? 1), limit = Number(args.limit ?? Infinity), workers = Number(args.workers ?? 2);

async function openPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: Math.round(W * scale), height: Math.round(H * scale) }, deviceScaleFactor: 1 });
  await ctx.addInitScript({ path: resolve('trailer/rig/clock.js') });
  await ctx.addInitScript(q => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: q, name: 'Explorer', reducedMotion: false, volume: 0, tour: false }, version: 1 })); }, quality);
  const page = await ctx.newPage(); page.setDefaultTimeout(900000);
  page.on('pageerror', e => console.error('  [pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GPU stall|WebGL|Failed to load resource/.test(m.text())) console.error('  [console]', m.text().slice(0, 300)); });
  await page.goto(`${base}/?qa-scale=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 900000 });
  // The film is the world alone: every interface layer is hidden.
  await page.addStyleTag({ content: '.app > :not(.world){display:none!important}' });
  await page.evaluate(async () => { window.__clock.manual(); await import('/trailer/rig/cinema.ts'); });
  return { ctx, page, cdp: await ctx.newCDPSession(page) };
}

const launch = () => chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });

async function renderShot(browser, shot) {
  const dir = join(out, shot.id), frames = Math.min(shot.frames, limit);
  await mkdir(dir, { recursive: true });
  const t0 = Date.now(), { ctx, page, cdp } = await openPage(browser);
  await page.evaluate(id => window.__cinema.load(id), shot.id);
  // Warm up with time held: characters load and upload, then a fixed settle so takes repeat exactly.
  let warm = 0; while (!(await page.evaluate(() => window.__cinema.warm())) && warm < 400) { warm++; await page.waitForTimeout(150); }
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.__cinema.warm());
  await page.evaluate(() => window.__cinema.start());
  for (let i = 0; i < Math.round(shot.lead * 30); i++) await page.evaluate(() => window.__cinema.frame());
  const tStart = Date.now(), poses = [];
  // Chrome's own screenshot of the canvas just drawn (checked identical to an in-task read-back, and
  // much faster than encoding in the page): tools/check-capture.mjs.
  const grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data, 'base64');
  for (let f = 0; f < frames; f++) {
    const n = await page.evaluate(() => window.__cinema.samples()), keep = f % every === 0, file = join(dir, `${String(f).padStart(5, '0')}.png`);
    // Motion blur: the frame's time is drawn as n sub-frames and averaged (a 360° shutter).
    let sum = null, raw = null;
    for (let s = 0; s < n; s++) {
      await page.evaluate(of => window.__cinema.frame(false, 'image/png', of), n);
      if (s === 0) poses.push(await page.evaluate(() => window.__cinema.pose()));
      if (!keep) continue;
      const png = await grab();
      if (n === 1) { await writeFile(file, png); continue; }
      raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      sum ??= new Float32Array(raw.data.length);
      for (let k = 0; k < sum.length; k++) sum[k] += raw.data[k];
    }
    if (keep && n > 1) { const px = Buffer.alloc(sum.length); for (let k = 0; k < sum.length; k++) px[k] = Math.round(sum[k] / n); await sharp(px, { raw: raw.info }).png({ compressionLevel: 3 }).toFile(file); }
    if (f % 30 === 29) console.log(`  ${shot.id} ${f + 1}/${frames}  ${((Date.now() - tStart) / (f + 1) / 1000).toFixed(2)} s/frame`);
  }
  // The camera of every frame (for graphics tracked to the world) and how the take maps to film time.
  await writeFile(join(dir, 'camera.json'), JSON.stringify(poses));
  const marks = await page.evaluate(() => window.__cinema.marks());
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ fps: 30, pre: shot.pre, lead: shot.lead, frames, every, scale, quality, width: Math.round(W * scale), height: Math.round(H * scale), marks }));
  console.log(`${shot.id}: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s (warm ${warm})`, JSON.stringify(await page.evaluate(() => window.__cinema.state())));
  await ctx.close();
}

const probe = await launch();
const list = await (async () => { const { ctx, page } = await openPage(probe); const l = await page.evaluate(() => window.__cinema.shots()); await ctx.close(); return l; })();
await probe.close();
const todo = [];
for (const shot of list) {
  if (only && !only.includes(shot.id)) continue;
  const dir = join(out, shot.id), frames = Math.min(shot.frames, limit);
  if (existsSync(dir) && (await readdir(dir)).filter(f => f.endsWith('.png')).length >= Math.ceil(frames / every)) { console.log(`${shot.id}: done`); continue; }
  todo.push(shot);
}
// Longest shots first, so the pool finishes together.
todo.sort((a, b) => b.frames - a.frames);
await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, async () => {
  const browser = await launch();
  for (let shot; (shot = todo.shift());) {
    try { await renderShot(browser, shot); } catch (e) { console.error(`${shot.id}: FAILED`, e.message); }
  }
  await browser.close();
}));
