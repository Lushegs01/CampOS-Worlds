// QA production bundle. Browser emulation and mocked refusal cover the fallback; never a physical phone test.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch } from './support/browser.mjs';
import { startProduction } from './support/production.mjs';

const host = await startProduction({ root: process.env.ROOT || 'dist-qa', arena: { rules: { countdownMs: 500 } } });
const browser = await launch(), errors = [], checks = [];
const report = { environment: 'Linux Chromium / SwiftShader; touch and viewport emulation. Fullscreen refusal is injected. No physical orientation or phone FPS validation.', checks };
const pass = label => { checks.push(label); console.log('PASS', label); };
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Performance QA', reducedMotion: true, volume: 0 }, version: 1 }));
    localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: true }));
    Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: async () => { throw Error('Simulated unsupported orientation lock'); } });
    Element.prototype.requestFullscreen = async () => { throw Error('Simulated fullscreen refusal'); };
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(180000);
  page.on('pageerror', e => errors.push(e.message));
  let silence = false, injected = 0;
  await page.routeWebSocket(/\/arena$/, ws => {
    const server = ws.connectToServer();
    server.onMessage(data => {
      if (silence) return;
      ws.send(data);
      const message = JSON.parse(String(data));
      if (message.t === 's' && message.me) {
        // Reordered state must not resurrect an old life or overwrite the current HUD.
        message.at -= 10000; message.me.life -= 1; message.me.hp = 777; message.me.alive = false;
        ws.send(JSON.stringify(message)); injected++;
      }
    });
  });
  await page.goto(host.url + '/?qa-scale=0.12&qa-norender=1');
  await page.waitForFunction(() => document.querySelector('.enter-button') && !document.querySelector('.enter-button').disabled);
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('dialog', { name: 'Turn your phone to explore.' }).waitFor();
  const origin = await page.evaluate(() => window.__campusInspect().position);
  await page.keyboard.down('w'); await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(() => window.__campusInspect().position), origin);
  await mkdir('docs/screenshots/performance', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/performance/mandate-orientation.png' });
  pass('refused fullscreen shows the branded portrait overlay and blocks campus movement');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('dialog', { name: 'Turn your phone to explore.' }).waitFor({ state: 'hidden' });
  await page.waitForTimeout(1000); await page.keyboard.up('w');
  assert.deepEqual(await page.evaluate(() => window.__campusInspect().position), origin);
  pass('rotation clears held input and resumes landscape without stale movement');
  const joystick = await page.getByRole('group', { name: 'Movement joystick' }).boundingBox();
  const dock = await page.getByRole('navigation', { name: 'Game menu' }).boundingBox();
  assert.ok(joystick.x >= 0 && joystick.y >= 0 && joystick.y + joystick.height <= 390);
  assert.ok(dock.x >= joystick.x + joystick.width && dock.x + dock.width <= 844 - 120, JSON.stringify({ joystick, dock }));
  pass('landscape joystick and menu fit the viewport without overlapping');

  await page.getByRole('button', { name: 'Pause and settings' }).click();
  await page.getByRole('button', { name: /All the little details/ }).click();
  await page.waitForFunction(() => !!window.__campusComposer);
  await page.evaluate(() => window.__campusSetDpr(.08));
  await page.waitForFunction(() => window.__campusComposer.inputBuffer.width === document.querySelector('canvas[data-graphics-owner]').width);
  const post = await page.evaluate(() => ({ width: window.__campusComposer.inputBuffer.width, canvas: document.querySelector('canvas[data-graphics-owner]').width }));
  assert.ok(post.width <= 68, JSON.stringify(post));
  pass('campus post-processing targets resize with adaptive drawing density');
  await page.getByRole('button', { name: /Lighter on your device/ }).click();
  await page.getByRole('button', { name: 'Back to campus', exact: false }).click();

  await page.getByRole('button', { name: /Combat Arena:/ }).click();
  await page.getByRole('tab', { name: 'Training' }).click();
  await page.getByRole('button', { name: 'Start training' }).click();
  await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed' && window.__arena?.self()?.alive);
  await page.waitForTimeout(1000);
  assert.ok(injected > 0);
  assert.ok(await page.evaluate(() => window.__arena.state().hud.hp <= 100));
  assert.equal(await page.evaluate(() => window.__arena.self().alive), true);
  pass('injected reordered snapshots cannot replace current life or HUD health');
  const settingsBefore = await page.evaluate(() => localStorage.getItem('campos-arena-settings'));
  silence = true;
  await page.evaluate(() => window.__arena.move(0, 1));
  await page.waitForTimeout(3500);
  const stalled = await page.evaluate(() => window.__arena.self());
  assert.ok(stalled.pending > 0 && stalled.pending <= 120, JSON.stringify(stalled));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__arena.self().pending), stalled.pending);
  assert.equal(await page.evaluate(() => localStorage.getItem('campos-arena-settings')), settingsBefore);
  pass('silent server bounds pending commands without changing saved graphics preferences');
  await page.evaluate(() => window.__arena.move(0, 0)); silence = false;
  await page.waitForFunction(() => window.__arena.self()?.pending < 20);
  pass('acknowledgements recover prediction after the silent interval');
  const matchId = await page.evaluate(() => window.__arena.state().match.id);
  silence = true;
  await page.waitForFunction(() => window.__arena.state().status === 'offline', null, { timeout: 15000 });
  silence = false;
  await page.waitForFunction(id => window.__arena.state().status === 'ready' && window.__arena.state().match?.id === id, matchId);
  pass('silent-connection watchdog reconnects and restores the same authoritative match');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('dialog', { name: 'Turn your phone to explore.' }).waitFor();
  await page.evaluate(() => window.__arena.move(0, 1));
  await page.waitForTimeout(1000);
  const at = await page.evaluate(() => window.__arena.self());
  await page.waitForTimeout(500);
  const paused = await page.evaluate(() => window.__arena.self());
  assert.ok(Math.hypot(at.x - paused.x, at.z - paused.z) < .2);
  pass('portrait mode also blocks Arena simulation input');
  report.browser = browser.version(); report.stalledPending = stalled.pending;
  report.graphics = await page.evaluate(() => window.__graphics());
  assert.deepEqual(errors, []);
} finally {
  report.errors = errors;
  await mkdir('docs/performance', { recursive: true });
  await writeFile('docs/performance/mandate-browser.json', JSON.stringify(report, null, 2));
  await browser.close(); await host.stop();
}
