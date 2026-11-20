import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../src/arena/deploy.ts', import.meta.url), 'utf8'))
  .replace("from 'zustand'", `from '${import.meta.resolve('zustand')}'`)
  .replace("import { traffic, resetTraffic, onTraffic } from '../world/fetcher';", "const traffic = { active: 0, critical: { started: 0, finished: 0 }, failures: [] }; const resetTraffic = () => {}; const onTraffic = () => {};");
const code = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const deploy = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
test('graphics interruption reopens readiness after deployment, independently of a healthy socket', () => {
  deploy.begin('training'); deploy.enter('preparing'); deploy.deployed();
  assert.equal(deploy.useDeploy.getState().stage, 'deployed');
  deploy.graphicsInterrupted();
  assert.equal(deploy.useDeploy.getState().stage, 'recovering');
  assert.equal(deploy.useDeploy.getState().resumeStage, 'preparing');
  deploy.enter('preparing');
  assert.equal(deploy.useDeploy.getState().stage, 'preparing');
  deploy.deployed(); assert.equal(deploy.useDeploy.getState().stage, 'deployed');
  deploy.reset();
});
