// Visual QA: capture real screenshots of the running app from fixed viewpoints.
// Usage: node scripts/qa/shots.mjs <quality> <outDir> [view,view...]   (requires `npm run dev`)
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const [quality = 'high', out = 'docs/screenshots/qa', only = ''] = process.argv.slice(2);
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.TEST_URL || 'http://localhost:5173';
const VIEWS = {
  spawn: null,
  avenue: [0, 30, 0, .02, 5.4], plaza: [-6, 14, .55, .08, 6.5], library: [-30, 8, 0, .1, 7], libraryInside: [-30, -9, 0, .08, 4.2],
  studentHouse: [26, 12, -.35, .06, 7], auditorium: [0, -22, 0, .06, 7], sciences: [-46, -24, -.25, .08, 8], design: [44, -24, .2, .08, 8],
  courts: [28, 22, -1.35, .12, 8], gate: [0, 40, Math.PI, .06, 7], avatarClose: [0, 30, 0, .02, 2.4], pitch: [-40, 2, -1.2, .1, 9],
};
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
await page.addInitScript(q => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: q, name: 'QA' }, version: 0 })), quality);
await page.goto(base, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
await page.getByRole('button', { name: 'Enter campus', exact: true }).waitFor({ timeout: 120000 });
await page.waitForFunction(() => !document.querySelector('.enter-button')?.disabled, null, { timeout: 120000 });
const loadMs = Date.now() - t0;
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/${quality}-welcome.png` });
await page.getByRole('button', { name: 'Make it you', exact: true }).click(); await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/${quality}-avatar-editor.png` });
await page.getByRole('button', { name: 'Close panel', exact: true }).click(); await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
await page.waitForTimeout(4000);
const hideUi = (hide) => page.evaluate(h => document.querySelectorAll('.quest-card,.location-hud,.minimap,.game-dock,.control-hint,.topbar,.toast,.interact-prompt,.vignette').forEach(e => { e.style.visibility = h ? 'hidden' : ''; }), hide);
const metrics = {};
for (const [name, v] of Object.entries(VIEWS)) {
  if (only && !only.split(',').includes(name)) continue;
  if (v) { await page.evaluate(a => window.__campusDebug.teleport(...a), v); await page.waitForTimeout(2600); }
  if (name === 'spawn') await page.screenshot({ path: `${out}/${quality}-${name}-ui.png` });
  await hideUi(true); await page.screenshot({ path: `${out}/${quality}-${name}.png` }); await hideUi(false);
  metrics[name] = await page.evaluate(() => window.__campus);
}
await writeFile(`${out}/${quality}-metrics.json`, JSON.stringify({ quality, loadMs, renderer: await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }), metrics, errors }, null, 2));
console.log(JSON.stringify({ loadMs, errors: errors.slice(0, 10), spawn: metrics.spawn }, null, 1));
await browser.close();
