// Where a captured frame's time goes under software WebGL: the full High frame, then with one stage
// switched off at a time (sun shadows, the post stack, instanced vegetation). Diagnostic only.
//
//   node trailer/tools/profile.mjs [1080x1920] [high|medium|low]
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const [W, H] = (process.argv[2] ?? '1080x1920').split('x').map(Number), quality = process.argv[3] ?? 'high';
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript({ path: resolve('trailer/rig/clock.js') });
await ctx.addInitScript(q => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: q, volume: 0 }, version: 1 })), quality);
const page = await ctx.newPage(); page.setDefaultTimeout(600000);
await page.goto('http://127.0.0.1:5180/?qa-scale=1');
await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 600000 });
await page.addStyleTag({ content: '.app > :not(.world){display:none!important}' });
await page.evaluate(async () => { window.__clock.manual(); await import('/trailer/rig/cinema.ts'); window.__cinema.load('survey'); });
for (let i = 0; i < 25; i++) await page.evaluate(() => window.__cinema.warm());

const time = async name => { const t = Date.now(); for (let i = 0; i < 4; i++) await page.evaluate(() => window.__cinema.frame()); console.log(name.padEnd(26), ((Date.now() - t) / 4).toFixed(0).padStart(6), 'ms'); };
await time(`${quality} ${W}x${H}`);
await page.evaluate(() => { window.__sun = []; window.__cinema.rig.scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) { o.castShadow = false; window.__sun.push(o); } }); });
await time('  without sun shadows');
await page.evaluate(() => window.__sun.forEach(o => { o.castShadow = true; }));
await page.evaluate(async () => { const m = await import('/src/world/rendering.ts'); window.__post = m.postStack.composer; m.postStack.composer = null; });
await time('  without post (AO, SMAA)');
await page.evaluate(async () => { const m = await import('/src/world/rendering.ts'); m.postStack.composer = window.__post; });
await page.evaluate(() => { window.__veg = []; window.__cinema.rig.scene.traverse(o => { if (o.isInstancedMesh && o.visible) { o.visible = false; window.__veg.push(o); } }); });
await time('  without instanced meshes');
await browser.close();
