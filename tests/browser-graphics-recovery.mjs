// Real WebGL lifecycle regression, with controlled creation/draw failures and native lose/restore.
// VITE_QA=1 npx vite build --outDir dist-recovery-qa && node tests/browser-graphics-recovery.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launch } from './support/browser.mjs';
import { startProduction } from './support/production.mjs';

const host = await startProduction({ root: process.env.ROOT || 'dist-recovery-qa', arena: { rules: { countdownMs: 500 } } });
const browser = await launch();
const report = { environment: 'Linux Chromium, SwiftShader software WebGL, emulated touch. Context loss/restoration uses WEBGL_lose_context; constructor/draw failures are injected.', checks: [], samples: [] };
const out = process.env.REPORT || 'docs/reliability/graphics-recovery.json';
const errors = [];
let page;
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Graphics recovery', reducedMotion: true, volume: 0 }, version: 1 }));
    localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: false }));
    const get = HTMLCanvasElement.prototype.getContext, add = HTMLCanvasElement.prototype.addEventListener;
    const failed = new WeakSet();
    window.__contexts = []; window.__oldCallbacks = []; window.__injectCreationNotice = true;
    HTMLCanvasElement.prototype.addEventListener = function (type, fn, options) {
      if (this.dataset.graphicsOwner === 'arena' && /^webglcontext/.test(type) && !window.__oldCallbacks.some(c => c.canvas === this && c.type === type)) window.__oldCallbacks.push({ canvas: this, type, fn });
      return add.call(this, type, fn, options);
    };
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const arena = this.dataset.graphicsOwner === 'arena' && /^webgl2?$/.test(type);
      if (arena && window.__failNextArenaCreation) { window.__failNextArenaCreation = false; failed.add(this); }
      if (arena && failed.has(this)) return null;
      const gl = get.call(this, type, ...args);
      if (/^webgl2?$/.test(type) && gl && !window.__contexts.includes(gl)) {
        window.__contexts.push(gl);
        window.__maxContexts = Math.max(window.__maxContexts || 0, window.__contexts.filter(c => !c.isContextLost()).length);
        // A creation event from an unsuccessful attempt is not proof the returned context failed.
        if (arena && window.__injectCreationNotice) {
          window.__injectCreationNotice = false; window.__healthyCreationContext = !gl.isContextLost();
          gl.enable(0xffffffff); // An obsolete optional/probe error must not contaminate frame validation.
          this.dispatchEvent(new WebGLContextEvent('webglcontextcreationerror', { statusMessage: 'Injected earlier creation-attempt notice' }));
        }
      }
      return gl;
    };
  });
  page = await ctx.newPage(); page.setDefaultTimeout(180000);
  page.on('pageerror', error => errors.push(error.message));
  const overlay = page.locator('[data-graphics-recovery="arena"]');
  const pass = name => { report.checks.push(name); console.log('PASS', name); };
  const snapshot = async name => {
    const value = await page.evaluate(() => {
      const arena = window.__arena?.state();
      if (arena?.you) arena.you = { num: arena.you.num, team: arena.you.team };
      return { graphics: window.__graphics(), arena, live: window.__contexts.filter(c => !c.isContextLost()).length, max: window.__maxContexts,
        overlays: document.querySelectorAll('[data-graphics-recovery="arena"]').length };
    });
    assert.ok(value.live <= 1); assert.equal(value.max, 1, 'one live context throughout recovery');
    report.samples.push({ name, ...value }); return value;
  };
  const ready = async () => {
    await page.waitForFunction(() => window.__graphics?.().current?.lifecycle?.phase === 'READY' && window.__arena?.state().sceneReady && window.__arenaDeploy?.().stage === 'deployed');
    assert.equal(await overlay.count(), 0, 'READY removes the overlay from the tree');
    assert.equal(await page.getByRole('button', { name: 'Rebuild arena graphics', exact: true }).count(), 0);
    const value = await snapshot('ready');
    assert.equal(value.graphics.current.lifecycle.resourcesReady, true);
    assert.equal(value.graphics.active.owner, 'arena');
    assert.equal(value.graphics.current.lifecycle.rendererId, value.graphics.active.id);
    return value.graphics.active.id;
  };
  const lose = async () => {
    await page.evaluate(() => {
      const gl = window.__arenaGL;
      window.__lostCanvas = gl.domElement;
      window.__lostExtension = gl.getContext().getExtension('WEBGL_lose_context');
      window.__lostExtension.loseContext();
    });
    await page.waitForFunction(() => window.__graphics().current.lifecycle.phase === 'CONTEXT_LOST');
    assert.equal(await overlay.count(), 1);
    assert.equal(await page.evaluate(() => window.__arena.state().sceneReady), false);
    assert.equal(await page.locator('canvas[data-graphics-owner="arena"]').count(), 1, 'lost canvas retains its native restore listener');
  };

  await page.goto(host.url + '/?qa-scale=0.12');
  await page.waitForFunction(() => document.querySelector('.enter-button') && !document.querySelector('.enter-button').disabled);
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /Combat Arena:/ }).click();
  await page.getByRole('tab', { name: 'Training' }).click();
  await page.getByRole('button', { name: 'Open the firing range' }).click();
  // This assertion reproduces the pre-fix startup bug promptly rather than waiting for a loading timeout.
  await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed' || document.body.innerText.includes('Arena graphics were interrupted.'));
  assert.equal(await page.evaluate(() => !!window.__healthyCreationContext), true);
  assert.equal(await page.getByRole('button', { name: 'Rebuild arena graphics', exact: true }).count(), 0, 'a usable constructor result must not retain a stale interruption screen');
  let id = await ready();
  pass('normal campus-to-Arena startup rejects an obsolete creation notice and validates the first frame');
  const match = await page.evaluate(() => ({ id: window.__arena.state().match.id, you: window.__arena.state().you }));

  await lose(); await page.waitForTimeout(1200);
  assert.equal(await overlay.count(), 1, 'no timeout hides a genuinely lost context');
  await page.evaluate(() => window.__lostExtension.restoreContext());
  assert.notEqual(await ready(), id); id = await page.evaluate(() => window.__graphics().active.id);
  pass('native context restoration rebuilds resources and automatically removes the recovery overlay');

  await lose();
  const generation = await page.evaluate(() => window.__graphics().current.lifecycle.generation);
  await page.getByRole('button', { name: 'Rebuild arena graphics', exact: true }).evaluate(button => { for (let i = 0; i < 6; i++) button.click(); });
  assert.notEqual(await ready(), id);
  assert.equal(await page.evaluate(() => window.__graphics().current.lifecycle.generation), generation + 1);
  await page.evaluate(() => {
    for (const { canvas, type, fn } of window.__oldCallbacks) if (canvas === window.__lostCanvas) {
      const event = new WebGLContextEvent(type, { cancelable: true });
      if (typeof fn === 'function') fn.call(canvas, event); else fn.handleEvent(event);
    }
  });
  await ready();
  pass('manual rebuild is single-flight and captured retired-renderer callbacks cannot restore the overlay');

  await page.evaluate(() => { const r = window.__arenaGL, render = r.render; r.render = function (...args) { r.render = render; throw Error('Injected frame failure'); }; });
  await page.waitForFunction(() => window.__graphics().current.lifecycle.phase === 'RECOVERY_FAILED');
  assert.equal(await overlay.count(), 1);
  assert.equal(await page.evaluate(() => window.__arena.state().sceneReady), false);
  await page.getByRole('button', { name: 'Rebuild arena graphics', exact: true }).click(); await ready();
  pass('a failed draw suspends readiness and a successful validated retry clears its error');

  await lose(); await page.evaluate(() => { window.__failNextArenaCreation = true; });
  await page.evaluate(() => window.__lostExtension.restoreContext());
  await page.waitForFunction(() => document.querySelector('[data-graphics-phase="RECOVERY_FAILED"]'));
  assert.equal(await overlay.count(), 1);
  assert.equal(await page.evaluate(() => window.__arena.state().sceneReady), false);
  await snapshot('failed creation');
  await page.getByRole('button', { name: 'Rebuild arena graphics', exact: true }).click(); await ready();
  pass('failed automatic restoration stays actionable without a page reload; retry creates one valid renderer');

  let start = await page.evaluate(() => window.__arena.self());
  let moved = false;
  for (const key of ['w', 's']) {
    await page.keyboard.down(key); await page.waitForTimeout(1500); await page.keyboard.up(key);
    const end = await page.evaluate(() => window.__arena.self());
    moved ||= Math.hypot(end.x - start.x, end.z - start.z) > .02; start = end;
  }
  assert.ok(moved, 'keyboard movement responds after recovery');
  const stick = await page.locator('.ar-stick').boundingBox(); assert.ok(stick);
  const cdp = await ctx.newCDPSession(page), x = stick.x + stick.width / 2, y = stick.y + stick.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 35, y, id: 1 }] });
  await page.waitForTimeout(1500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const end = await page.evaluate(() => window.__arena.self());
  assert.ok(Math.hypot(end.x - start.x, end.z - start.z) > .02, 'touch movement responds after recovery');
  assert.deepEqual(await page.evaluate(() => ({ id: window.__arena.state().match.id, you: window.__arena.state().you })), match);
  pass('keyboard and touch input resume with the same match, player and team');

  await lose();
  // Hold the old lease while the replacement awaits acquisition, then dispose that attempt.
  await overlay.evaluate(async root => {
    const force = window.__arenaGL.forceContextLoss.bind(window.__arenaGL);
    window.__arenaGL.forceContextLoss = () => { setTimeout(force, 500); };
    const buttons = [...root.querySelectorAll('button')];
    buttons.find(b => b.textContent === 'Rebuild arena graphics').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const exit = [...document.querySelectorAll('[data-graphics-recovery="arena"] button')].find(b => b.textContent === 'Return to campus');
    assertExit(exit);
    function assertExit(button) { if (!button) throw Error('Recovery must still be waiting for its renderer lease'); button.click(); }
  });
  await page.waitForFunction(() => window.__graphics().active?.owner === 'campus' && window.__graphics().current.lifecycle.phase === 'READY');
  assert.equal(await overlay.count(), 0);
  await snapshot('rapid exit');
  await page.getByRole('button', { name: /Combat Arena:/ }).click();
  await page.getByRole('tab', { name: 'Training' }).click();
  await page.getByRole('button', { name: 'Open the firing range' }).click(); await ready();
  pass('exit during rebuilding and re-entry leave no orphaned renderer or overlay');
  assert.deepEqual(errors, [], 'no uncaught errors during recovery');
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.stack; process.exitCode = 1; console.error(error); }
finally {
  report.errors = errors;
  if (page) {
    report.diagnostics = await page.evaluate(() => window.__graphics?.()).catch(() => null);
    await mkdir('docs/screenshots/reliability', { recursive: true });
    await page.screenshot({ path: process.env.SCREENSHOT || 'docs/screenshots/reliability/graphics-recovery.png' }).catch(() => {});
  }
  await mkdir(out.slice(0, out.lastIndexOf('/')), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  await browser.close(); await host.stop();
}
