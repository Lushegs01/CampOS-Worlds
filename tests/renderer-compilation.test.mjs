import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { Material, Scene, PerspectiveCamera } from 'three';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/graphics/compile.ts', import.meta.url), 'utf8');
const { installCompilation } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })).toString('base64'));
function renderer() {
  const material = new Material();
  let ready = false;
  return { material, ready: () => { ready = true; }, compile: () => new Set([material]), properties: { get: () => ({ currentProgram: { isReady: () => ready } }) }, getContext: () => ({ isContextLost: () => false }) };
}
test('shader compilation waits for readiness and detaches listeners', async () => {
  const gl = renderer(), events = []; const cancel = installCompilation(gl, e => events.push(e));
  assert.equal(cancel.pending(), 0);
  const compiled = gl.compileAsync(new Scene(), new PerspectiveCamera());
  assert.equal(cancel.pending(), 1);
  gl.ready(); await compiled;
  assert.equal(cancel.pending(), 0);
  assert.deepEqual(events, ['compile-start', 'compile-end']);
  assert.equal(gl.material._listeners.dispose.length, 0);
});
test('material disposal during quality changes cannot throw from a shader poll', async () => {
  const gl = renderer(); installCompilation(gl, () => {});
  const compiled = gl.compileAsync(new Scene(), new PerspectiveCamera());
  gl.material.dispose(); gl.properties.get = () => ({});
  await compiled;
  assert.equal(gl.material._listeners.dispose.length, 0);
});
test('renderer teardown rejects pending shaders and cancels polling', async () => {
  const gl = renderer(); const cancel = installCompilation(gl, () => {});
  const compiled = gl.compileAsync(new Scene(), new PerspectiveCamera());
  const rejected = assert.rejects(compiled, { name: 'AbortError' });
  cancel(); await rejected;
  assert.equal(gl.material._listeners.dispose.length, 0);
});

test('a completed but failed shader link rejects compilation before drawing', async () => {
  const gl = renderer(), events = [];
  gl.ready();
  gl.properties.get = () => ({ currentProgram: { isReady: () => true, program: {}, name: 'rejected shader' } });
  gl.getContext = () => ({ isContextLost: () => false, LINK_STATUS: 35714, getProgramParameter: () => false, getProgramInfoLog: () => 'D3D11 compiler failure' });
  const cancel = installCompilation(gl, (event, detail) => events.push({ event, detail }));
  await assert.rejects(gl.compileAsync(new Scene(), new PerspectiveCamera()), /could not be linked.*D3D11 compiler failure/);
  assert.equal(cancel.pending(), 0);
  assert.equal(gl.material._listeners.dispose.length, 0);
  assert.equal(events.filter(e => e.event === 'compile-error').length, 1);
});
