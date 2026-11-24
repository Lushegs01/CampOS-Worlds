// Run after: VITE_QA=1 npx vite build --outDir dist-qa
import assert from 'node:assert/strict';
import { launch } from './support/browser.mjs';
import { startProduction } from './support/production.mjs';

const browser = await launch();
const host = await startProduction({ root: 'dist-qa', arena: { rules: { countdownMs: 800 } } });
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await context.addInitScript(() => {
    localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Recovery', reducedMotion: true, volume: 0 }, version: 0 }));
    localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: false }));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /context/.test(m.text())) console.log('browser:', m.text().slice(0, 250)); });
  console.log('Opening campus');
  await page.goto(host.url + '/?qa-scale=0.2');
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  console.log('Campus loaded');
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor();
  const enter = async () => {
    await page.getByRole('button', { name: /Combat Arena/ }).click();
    await page.waitForFunction(() => window.__arena?.state().status === 'ready');
    await page.getByRole('tab', { name: 'Training' }).click();
    await page.getByRole('button', { name: 'Open the firing range' }).click();
    await page.waitForFunction(() => window.__arena.state().sceneReady && window.__arenaDeploy?.().stage === 'deployed');
    assert.equal(await page.locator('.ar-graphics-recovery').count(), 0);
  };
  const exitArena = async () => {
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement);
    const back = page.getByRole('button', { name: 'Return to campus', exact: true });
    if (!await back.isVisible()) {
      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      if (await menu.count()) await menu.first().dispatchEvent('click');
      else await page.keyboard.press('Escape');
    }
    await back.click();
  };
  await enter();
  console.log('PASS normal startup from campus');
  const match = await page.evaluate(() => window.__arena.state().match.id);
  const lose = async () => {
    await page.evaluate(() => {
      window.oldArenaGL = window.__arenaGL;
      window.loseArena = window.__arenaGL.getContext().getExtension('WEBGL_lose_context');
      if (!window.loseArena) throw new Error('WEBGL_lose_context unavailable');
      window.loseArena.loseContext();
    });
    await page.locator('[data-graphics-state="CONTEXT_LOST"]').waitFor();
    console.log('PASS context loss suspends gameplay');
    assert.equal(await page.evaluate(() => window.__arena.state().sceneReady), false);
  };
  await lose();
  await page.evaluate(() => window.loseArena.restoreContext());
  await page.waitForFunction(() => window.__arena.state().sceneReady);
  assert.equal(await page.locator('.ar-graphics-recovery').count(), 0);
  assert.ok(await page.evaluate(() => window.oldArenaGL === window.__arenaGL), 'automatic restoration reuses context');
  console.log('PASS context loss and restoration, overlay unmounted');
  // Verify actual keyboard movement after recovery.
  await page.locator('.ar-canvas canvas').click();
  const before = await page.evaluate(() => window.__arena.self());
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  const after = await page.evaluate(() => window.__arena.self());
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > .1, 'keyboard input resumes');
  await page.evaluate(() => document.exitPointerLock());
  console.log('PASS gameplay input resumes');
  await page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
  await page.locator('.ar-touch').waitFor();
  await lose();
  assert.equal(await page.locator('.ar-touch').count(), 0, 'touch controls unmount during loss');
  // Restoration that cannot render must remain a real, retryable failure.
  await page.evaluate(() => {
    window.oldArenaGL.render = () => { throw new Error('Injected restoration render failure'); };
    window.loseArena.restoreContext();
  });
  await page.locator('[data-graphics-state="RECOVERY_FAILED"]').waitFor();
  assert.equal(await page.evaluate(() => window.__arena.state().sceneReady), false);
  console.log('PASS failed restoration remains retryable');
  await page.getByRole('button', { name: 'Rebuild arena graphics', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => window.__arena.state().sceneReady);
  assert.equal(await page.locator('.ar-graphics-recovery').count(), 0);
  assert.ok(await page.evaluate(() => window.oldArenaGL !== window.__arenaGL), 'manual rebuild replaces failed renderer');
  assert.equal(await page.evaluate(() => window.__arena.state().match.id), match);
  // Old canvases must no longer affect this generation.
  await page.evaluate(() => {
    window.oldArenaGL.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    window.oldArenaGL.domElement.dispatchEvent(new Event('webglcontextrestored'));
  });
  assert.equal(await page.locator('.ar-graphics-recovery').count(), 0);
  assert.equal(await page.evaluate(() => window.__arena.state().sceneReady), true);
  assert.equal(await page.locator('.ar-canvas canvas').count(), 1);
  console.log('PASS manual rebuild, duplicate clicks, stale events, session preserved');
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.locator('.ar-touch').waitFor();
  const ground = await page.evaluate(() => window.__arena.self().y);
  await page.getByRole('button', { name: 'Jump', exact: true }).dispatchEvent('pointerdown', { pointerType: 'touch' });
  await page.waitForFunction(y => window.__arena.self().y > y + .1, ground);
  console.log('PASS touch input resumes after recovery');
  await exitArena();
  await enter();
  console.log('PASS exit and re-entry');
  await exitArena();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /Combat Arena/ }).click();
    await page.waitForFunction(() => window.__arena.state().status === 'ready');
    await page.getByRole('tab', { name: 'Training' }).click();
    await page.getByRole('button', { name: 'Open the firing range' }).click();
    await page.waitForFunction(() => window.__arena.state().phase === 'match');
    await exitArena();
    assert.equal(await page.locator('.ar-graphics-recovery').count(), 0);
  }
  await enter();
  console.log('PASS rapid entry/exit while initialization is pending');
  assert.deepEqual(errors, []);
} catch (error) {
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
    console.log((await p.locator('body').innerText().catch(() => '')).slice(-2500));
    await p.screenshot({ path: '/tmp/arena-recovery-failure.png', timeout: 10000 }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close(); await host.stop();
}
