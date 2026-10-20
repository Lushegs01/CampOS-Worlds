// Location scouting: stills of the real campus from given viewpoints, to plan camera moves.
//
//   node trailer/tools/survey.mjs <out dir> <WxH> '<json [{name,pos:[x,y,z],look:[x,y,z],fov}]>'
import { chromium } from '@playwright/test';
import { resolve, join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

const [out, size, json] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number), views = JSON.parse(json);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript({ path: resolve('trailer/rig/clock.js') });
await ctx.addInitScript(() => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'high', volume: 0 }, version: 1 })));
const page = await ctx.newPage(); page.setDefaultTimeout(600000);
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5180/?qa-scale=1');
await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 600000 });
await page.addStyleTag({ content: '.app > :not(.world){display:none!important}' });
await page.evaluate(async () => { window.__clock.manual(); await import('/trailer/rig/cinema.ts'); window.__cinema.load('survey'); });
for (let i = 0; i < 15; i++) await page.evaluate(() => window.__cinema.warm());
const cdp = await ctx.newCDPSession(page);
for (const v of views) {
  await page.evaluate(v => { const r = window.__cinema.rig, V = r.camera.position.constructor; r.memory.pose = { pos: new V(...v.pos), look: new V(...v.look), fov: v.fov ?? 50 }; }, v);
  // Two frames: distance-culled detail and the shadow map catch up with the new viewpoint.
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__cinema.warm());
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  await writeFile(join(out, `${v.name}.jpg`), Buffer.from(data, 'base64'));
  console.log('saved', v.name);
}
await browser.close();
