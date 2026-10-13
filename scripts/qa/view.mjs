// Visual spot checks: open the app offline (no room connection, so local rules apply), teleport to
// viewpoints and screenshot them. Usage: node scripts/qa/view.mjs <out-dir> "name:x,z,yaw,pitch,zoom[;js]" ...
// Optional ";js" runs in the page after the teleport (e.g. QA hooks to sit or pick up a ball).
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const [out = 'docs/screenshots/qa', ...views] = process.argv.slice(2);
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base = process.env.TEST_URL || 'http://localhost:5173', quality = process.env.QUALITY || 'medium';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 800) } });
page.on('pageerror', e => console.log('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_/.test(m.text())) console.log('console', m.text()); });
// Stay offline: a socket that never connects (page.route cannot intercept WebSockets).
await page.addInitScript(() => { const Real = window.WebSocket; window.WebSocket = function (url, p) { if (!String(url).endsWith('/ws')) return new Real(url, p); const fake = { readyState: 3, send() {}, close() {} }; setTimeout(() => fake.onclose?.({ code: 1006 }), 0); return fake; }; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3 }); });
await page.addInitScript(q => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: q, name: 'QA' }, version: 0 })), quality);
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 120000 });
await page.getByRole('button', { name: 'Enter campus', exact: true }).click(); await page.waitForTimeout(2500);
for (const spec of views) {
  const [name, rest] = spec.split(':'), [nums, js] = rest.split(';'), v = nums.split(',').map(Number);
  await page.evaluate(a => window.__campusDebug.teleport(...a), v); await page.waitForTimeout(1500);
  if (js) { await page.evaluate(js); }
  await page.waitForTimeout(Number(process.env.WAIT || 2200));
  await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name);
}
await browser.close();
