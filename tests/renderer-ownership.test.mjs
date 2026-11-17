import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/graphics/ownership.ts', import.meta.url), 'utf8');
const { acquireRenderer, pixelRatio, drawingBufferBudget } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })).toString('base64'));
test('renderer acquisition waits for confirmed teardown and serializes rapid transitions', async () => {
  const releaseCampus = await acquireRenderer();
  let arenaStarted = false, nextCampusStarted = false;
  const arena = acquireRenderer().then(release => { arenaStarted = true; return release; });
  const campus = acquireRenderer().then(release => { nextCampusStarted = true; return release; });
  await Promise.resolve();
  assert.equal(arenaStarted, false);
  releaseCampus(); const releaseArena = await arena;
  assert.equal(arenaStarted, true); assert.equal(nextCampusStarted, false);
  releaseArena(); const releaseNextCampus = await campus;
  assert.equal(nextCampusStarted, true); releaseNextCampus();
});
test('DPR budget bounds Retina targets and respects GPU limits without lowering ordinary profiles', () => {
  assert.equal(pixelRatio(1280, 720, 1.5), 1.5);
  const dpr = pixelRatio(3840, 2160, 2);
  assert.equal(dpr, 1);
  assert.ok(3840 * 2160 * dpr * dpr <= 3840 * 2160);
  assert.equal(pixelRatio(4000, 2000, 2, 2048), 2048 / 4000);
  assert.ok(Number.isFinite(pixelRatio(0, 0, 2)));
});

test('an unconfirmed context release blocks subsequent renderer creation explicitly', async () => {
  const release = await acquireRenderer();
  release('context release failed');
  await assert.rejects(acquireRenderer(), /context release failed/);
  await assert.rejects(acquireRenderer(), /context release failed/);
});


test('post buffers follow memory/profile budgets without reducing ordinary landscape phone density', () => {
  assert.equal(drawingBufferBudget(2, 'ultra'), 1920 * 1080);
  assert.equal(drawingBufferBudget(4, 'ultra'), 2560 * 1440);
  assert.equal(drawingBufferBudget(8, 'ultra'), 3840 * 2160);
  assert.equal(pixelRatio(844, 390, 1.5, 4096, drawingBufferBudget(2, 'low')), 1.5);
  for (const memory of [2, 4, 8]) {
    const budget = drawingBufferBudget(memory, 'ultra'), dpr = pixelRatio(3840, 2160, 2, 16384, budget);
    assert.ok(3840 * 2160 * dpr * dpr <= budget + 1e-6);
  }
});
