import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/graphics/context.ts', import.meta.url), 'utf8');
const { createContext, releaseContext } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })).toString('base64'));

test('a working context is returned without a second allocation', async () => {
  const gl = {}, calls = [];
  const canvas = { getContext(...args) { calls.push(args); return gl; } };
  assert.equal(await createContext(canvas, { antialias: true }, () => true, () => {}), gl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'webgl2');
});
test('rejected MSAA allocation retries once on the same canvas with cheaper attributes', async () => {
  const gl = {}, calls = [];
  const canvas = { getContext(type, attrs) { calls.push(attrs); return attrs.antialias ? null : gl; } };
  assert.equal(await createContext(canvas, { antialias: true, stencil: true, preserveDrawingBuffer: true }, () => true, () => {}), gl);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { antialias: false, stencil: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false });
});
test('full denial fails honestly after two attempts; no WebGL1 or hidden canvas probes', async () => {
  const calls = [];
  await assert.rejects(createContext({ getContext(type) { calls.push(type); return null; } }, {}, () => true, () => {}), /could not start WebGL 2/);
  assert.deepEqual(calls, ['webgl2', 'webgl2']);
});
test('leaving during the fallback delay prevents a stale context allocation', async () => {
  let current = true, calls = 0;
  const pending = createContext({ getContext() { calls++; current = false; return null; } }, {}, () => current, () => {});
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('a native context is releasable even if renderer construction never completed', () => {
  let lost = false, loses = 0;
  const gl = { isContextLost: () => lost, getExtension: () => ({ loseContext() { loses++; lost = true; } }) };
  assert.equal(releaseContext(gl), true);
  assert.equal(releaseContext(gl), true);
  assert.equal(loses, 1);
  assert.equal(releaseContext({ isContextLost: () => false, getExtension: () => null }), false);
  assert.equal(releaseContext({ isContextLost: () => false, getExtension() { throw Error('driver failure'); } }), false);
});
