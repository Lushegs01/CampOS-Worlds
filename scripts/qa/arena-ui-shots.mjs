// Screenshots of the Combat Arena interface on the production QA bundle at several screen sizes: lobby, training tab,
// settings, the deployment screen (on a throttled connection so its stages are visible), the in-match HUD, and the
// post-match screen. Also checks there is no horizontal page scroll on any of them.
// Usage: VITE_QA=1 npx vite build --outDir dist-qa && OUT=docs/screenshots/arena/premium node scripts/qa/arena-ui-shots.mjs
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { startProduction } from '../../tests/support/production.mjs';

const OUT = process.env.OUT || 'docs/screenshots/arena/premium', ROOT = process.env.ROOT || 'dist-qa';
await mkdir(OUT, { recursive: true });
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || [chromium.executablePath(), '/opt/pw-browsers/chromium'].find(p => existsSync(p));
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const host = await startProduction({ root: ROOT, arena: { rules: { countdownMs: 1000 } } });
const SIZES = (process.env.SIZES || 'desktop:1440x900,laptop:1280x720,tablet:1024x768,phone-landscape:844x390,phone-portrait:390x844').split(',').map(s => { const [name, wh] = s.split(':'); const [w, h] = wh.split('x').map(Number); return { name, w, h, touch: name.startsWith('phone') || name === 'tablet' }; });
const report = [];
async function open(size) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, hasTouch: size.touch, isMobile: size.touch && size.name.startsWith('phone'), deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Kestrel One', reducedMotion: true }, version: 0 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: false, showFps: false })); localStorage.setItem('campos-arena-qa-scale', '0.35'); });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  await page.goto(host.url + '/?qa-scale=0.3', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor();
  await page.getByRole('button', { name: /Combat Arena/ }).click();
  await page.waitForFunction(() => window.__arena?.state().status === 'ready');
  await page.waitForTimeout(500);
  return { ctx, page };
}
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('.ar-root').scrollWidth <= innerWidth + 1);
for (const size of SIZES) {
  const { ctx, page } = await open(size);
  await page.screenshot({ path: `${OUT}/lobby-${size.name}.png` });
  report.push({ size: size.name, screen: 'lobby', noHorizontalScroll: await noScroll(page) });
  if (size.name === 'desktop' || size.name === 'phone-landscape') {
    await page.getByRole('tab', { name: 'Training' }).click(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/training-${size.name}.png` });
    await page.getByRole('button', { name: 'Arena settings' }).click(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/settings-${size.name}.png` });
    await page.getByRole('button', { name: 'Close settings' }).click();
    // Deployment on a slow connection, so its stages are on screen.
    const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 4e6 / 8, uploadThroughput: 1e6 / 8 });
    await page.getByLabel('Bots').selectOption('3');
    await page.getByRole('button', { name: 'Start training' }).click();
    await page.waitForSelector('[data-deploy-overlay][data-stage="preparing"]');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/deploy-${size.name}.png` });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed', null, { timeout: 180000 });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/hud-${size.name}.png` });
    report.push({ size: size.name, screen: 'hud', noHorizontalScroll: await noScroll(page) });
    // End the match server-side and show the post-match screen.
    const id = await page.evaluate(() => window.__arena.state().match.id), you = await page.evaluate(() => window.__arena.state().you.team);
    host.room.arena.matches.get(id).finish(you, 'score');
    await page.waitForFunction(() => window.__arena.state().phase === 'results', null, { timeout: 20000 }); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/results-${size.name}.png` });
    report.push({ size: size.name, screen: 'results', noHorizontalScroll: await noScroll(page) });
  }
  await ctx.close();
}
console.log(JSON.stringify(report));
await browser.close(); await host.stop(); process.exit(0);
