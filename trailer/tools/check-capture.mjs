// Confirms Chrome's screenshot path returns the frame just drawn (not the previous one): each frame is
// read both from the canvas in the same task it was drawn and through the DevTools protocol.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const out = process.argv[2];
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 } });
await ctx.addInitScript({ path: resolve('trailer/rig/clock.js') });
await ctx.addInitScript(() => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'high', volume: 0 }, version: 1 })));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5180/?qa-scale=1');
await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 600000 });
await page.addStyleTag({ content: '.app > :not(.world){display:none!important}' });
await page.evaluate(async () => { window.__clock.manual(); await import('/trailer/rig/cinema.ts'); window.__cinema.load('survey'); });
for (let i = 0; i < 25; i++) await page.evaluate(() => window.__cinema.warm());
const cdp = await ctx.newCDPSession(page);
for (let i = 0; i < 3; i++) {
  const direct = await page.evaluate(() => window.__cinema.frame(true, 'image/png'));
  const shot = (await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data;
  await writeFile(`${out}/direct-${i}.png`, Buffer.from(direct.split(',')[1], 'base64'));
  await writeFile(`${out}/cdp-${i}.png`, Buffer.from(shot, 'base64'));
}
await browser.close();
