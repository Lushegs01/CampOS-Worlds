// Independent context accounting, including WEBGL_lose_context. Run against a QA production build:
// VITE_QA=1 npm run build && node tests/browser-renderer-lifecycle.mjs
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { launch } from './support/browser.mjs';
import { startProduction } from './support/production.mjs';
const host = process.env.URL ? { url: process.env.URL, stop: async () => {} } : await startProduction();
const browser = await launch();
const report = { renderer: 'Software WebGL; physical laptop validation outstanding', checks: [], samples: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.stack || e.message));
  await page.addInitScript(() => {
    localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Renderer QA', reducedMotion: true }, version: 0 }));
    // Exercise automatic GPU recommendation as well: it must not create a hidden probe context.
    localStorage.removeItem('campos-arena-settings');
    const get = HTMLCanvasElement.prototype.getContext;
    window.__contexts = [];
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const result = get.apply(this, args);
      if (/^webgl2?$/.test(args[0]) && result && !window.__contexts.includes(result)) {
        window.__contexts.push(result);
        const live = window.__contexts.filter(gl => !gl.isContextLost()).length;
        window.__maxContexts = Math.max(window.__maxContexts || 0, live);
      }
      return result;
    };
  });
  const check = name => { report.checks.push(name); console.log('✓', name); };
  const sample = async name => {
    const data = await page.evaluate(() => ({ diagnostics: window.__graphics(), live: window.__contexts.filter(gl => !gl.isContextLost()).length, max: window.__maxContexts, canvases: document.querySelectorAll('canvas[data-graphics-owner]').length }));
    assert.ok(data.live <= 1, `${name}: ${data.live} live contexts`);
    assert.equal(data.max, 1, 'no overlapping contexts, including during transitions');
    report.samples.push({ name, live: data.live, max: data.max, canvases: data.canvases, active: data.diagnostics.active, current: data.diagnostics.current, lastEvent: data.diagnostics.events.at(-1) }); return data;
  };
  const ready = async owner => {
    await page.waitForFunction(owner => window.__graphics?.().active?.owner === owner, owner);
    if (owner === 'campus') await page.waitForFunction(() => !!window.__campusDebug && !!window.__campusInspect && window.__campusGL?.info.memory.geometries > 100);
    else await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed' && window.__arena?.state().sceneReady && window.__arenaGL?.info.memory.geometries > 20);
    assert.equal((await sample(owner)).live, 1);
  };
  await page.goto(host.url + '/?qa-scale=0.15');
  await page.waitForFunction(() => document.querySelector('.enter-button') && !document.querySelector('.enter-button').disabled);
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click(); await ready('campus');
  check('campus starts with one context');
  await page.evaluate(() => window.__campusDebug.teleport(10, 12, 1.2, .2, 7));
  const state = await page.evaluate(() => window.__campusInspect());
  for (let cycle = 0; cycle < Number(process.env.CYCLES || 3); cycle++) {
    await page.getByRole('button', { name: /Combat Arena/ }).click();
    await page.getByRole('tab', { name: 'Training' }).click();
    await page.evaluate(() => window.__arena.settings({ quality: 'low', adaptive: false }));
    await page.waitForFunction(() => window.__graphics().active === null);
    await sample('arena lobby');
    await page.getByRole('button', { name: 'Start training' }).click(); await ready('arena');
    if (!cycle) {
      const initial = await page.evaluate(() => window.__graphics().active.id);
      for (const quality of ['medium', 'high', 'ultra', 'low']) {
        await page.evaluate(quality => window.__arena.settings({ quality, adaptive: false }), quality);
        await page.waitForTimeout(1500);
        assert.equal(await page.evaluate(() => window.__graphics().active.id), initial);
        await sample(`quality ${quality}`);
      }
      check('all four quality profiles keep the same context');
      const matchBeforeLoss = await page.evaluate(() => window.__arena.state().match.id);
      await page.evaluate(() => window.__arenaGL.getContext().getExtension('WEBGL_lose_context').loseContext());
      await page.getByRole('button', { name: 'Rebuild arena graphics' }).waitFor();
      const diag = await page.evaluate(() => window.__graphics());
      assert.equal(diag.lastContextLoss.owner, 'arena');
      await page.getByRole('button', { name: 'Rebuild arena graphics' }).click(); await ready('arena');
      assert.equal(await page.evaluate(() => window.__arena.state().match.id), matchBeforeLoss);
      check('injected Arena loss attributed and recovered without leaving match');
    }
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Return to campus', exact: true }).click();
    await ready('campus');
    const restored = await page.evaluate(() => window.__campusInspect());
    assert.ok(Math.abs(state.position.x - restored.position.x) < .1 && Math.abs(state.position.z - restored.position.z) < .1);
    assert.ok(Math.abs(restored.yaw - state.yaw) < .01);
    for (const key of ['discovered', 'avatar', 'tokens', 'tourStep']) assert.deepEqual(restored[key], state[key]);
    check(`cycle ${cycle + 1}: exclusive teardown, return and campus state preserved`);
  }
  for (const owner of ['campus', 'arena']) {
    const memories = report.samples.filter(s => s.name === owner).map(s => s.current.memory);
    // Compare warmed cycles: campus streams detail after entry, and Arena streams soldiers/decor.
    const baseline = memories.at(-2) ?? memories[0];
    assert.ok(memories.at(-1).textures <= baseline.textures + 32, `${owner}: textures bounded across transitions`);
    assert.ok(memories.at(-1).geometries <= baseline.geometries + 32, `${owner}: geometries bounded across transitions`);
  }
  check('renderer resource counts remain bounded across repeated transitions');
  await page.evaluate(() => window.__campusGL.getContext().getExtension('WEBGL_lose_context').loseContext());
  await page.getByRole('button', { name: 'Rebuild campus graphics' }).click(); await ready('campus');
  const diag = await page.evaluate(() => window.__graphics());
  assert.equal(diag.lastContextLoss.owner, 'campus');
  const recovered = await page.evaluate(() => window.__campusInspect());
  assert.deepEqual(recovered.discovered, state.discovered);
  assert.ok(Math.abs(recovered.position.x - state.position.x) < .1 && Math.abs(recovered.position.z - state.position.z) < .1);
  check('injected campus loss attributed and recovered');
  assert.deepEqual(errors, []);
  report.events = diag.events;
  report.lastContextLoss = diag.lastContextLoss;
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.stack; process.exitCode = 1; console.error(error); }
finally {
  await writeFile('docs/performance/renderer-lifecycle.json', JSON.stringify(report, null, 2));
  await browser.close(); await host.stop();
}
