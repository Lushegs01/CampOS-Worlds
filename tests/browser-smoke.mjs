// Quick end-to-end smoke test: welcome, avatar editor, entering, walking, settings and the phone layout.
// Usage: TEST_URL=http://localhost:5173 node tests/browser-smoke.mjs   (needs `npm run dev` or the QA pair)
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch, QUERY } from './support/browser.mjs';
const BASE = (process.env.TEST_URL || 'http://localhost:5173') + QUERY;
const browser = await launch();
const errors = [];
const watch = (page, label) => { page.on('pageerror', e => errors.push(`${label}: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text())) errors.push(`${label}: ${m.text()}`); }); };
const ready = page => page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
await mkdir('docs/screenshots', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }); page.setDefaultTimeout(45000); watch(page, 'desktop');
  await page.addInitScript(() => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low' }, version: 0 })));
  await page.goto(BASE); await ready(page);
  await page.screenshot({ path: 'docs/screenshots/welcome-desktop.png' });
  // The editor's actual controls: skin tones, accent colours and the four accessories (`ACCESSORIES`).
  await page.getByRole('button', { name: 'Make it you' }).click();
  await page.getByRole('textbox', { name: 'What should we call you?' }).fill('Ada');
  await page.getByRole('button', { name: 'Skin tone 3', exact: true }).click();
  await page.getByRole('button', { name: 'headphones', exact: true }).click();
  await page.getByRole('button', { name: 'Accent 2', exact: true }).click();
  const avatar = await page.evaluate(() => window.__campusInspect().avatar);
  assert.deepEqual([avatar.skin, avatar.accessory, avatar.accent], ['#7a4a31', 'headphones', '#537d70']);
  await page.screenshot({ path: 'docs/screenshots/avatar.png' });
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click(); await page.getByRole('button', { name: /online|Exploring/ }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/gameplay-desktop.png' });
  const start = await page.evaluate(() => window.__campusInspect().position);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(z => window.__campusInspect().position.z < z - 2, start.z, { timeout: 20000 }).finally(() => page.keyboard.up('KeyW'));
  await page.waitForFunction(() => window.__campus, null, { timeout: 20000 });
  const metrics = await page.evaluate(() => window.__campus);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: /Lighter on your device/ }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/settings.png' });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); mobile.setDefaultTimeout(45000); watch(mobile, 'phone');
  await mobile.goto(BASE); await ready(mobile); await mobile.screenshot({ path: 'docs/screenshots/welcome-mobile.png' });
  await mobile.getByRole('button', { name: 'Enter campus', exact: true }).click(); await mobile.getByRole('group', { name: 'Movement joystick' }).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390, 'no horizontal overflow on a phone');
  await mobile.screenshot({ path: 'docs/screenshots/gameplay-mobile.png' });
  await writeFile('docs/smoke-results.json', JSON.stringify({ date: new Date().toISOString(), errors, metrics }, null, 2));
  assert.deepEqual(errors, []);
  console.log('PASS smoke: welcome, avatar editor, enter, walk, settings, phone layout');
} finally { await browser.close(); }
