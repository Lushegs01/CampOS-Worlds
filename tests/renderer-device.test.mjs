import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/arena/device.ts', import.meta.url), 'utf8');
test('Arena recommendation reuses observed capabilities without a probe, preserving GPU tiers', async () => {
  const names = ['window', 'document', 'navigator', 'matchMedia'];
  const original = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: {} },
    document: { configurable: true, value: { createElement: () => { throw new Error('Hidden GPU probe forbidden'); } } },
    navigator: { configurable: true, value: { hardwareConcurrency: 8, deviceMemory: 8 } },
    matchMedia: { configurable: true, value: () => ({ matches: false }) },
  });
  try {
    for (const [gpu, quality] of [['Intel(R) UHD Graphics 620', 'low'], ['NVIDIA GeForce RTX 4060', 'high'], ['AMD Radeon Graphics', 'medium']]) {
      const code = ts.transpile(source.replace("import { graphicsCapabilities } from '../graphics/capabilities';", `const graphicsCapabilities = () => (${JSON.stringify({ gpu, maxTexture: 16384 })});`), { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
      const { recommendQuality } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
      const report = recommendQuality();
      assert.equal(report.gpu, gpu); assert.equal(report.quality, quality);
      assert.ok(!report.reasons.includes('GPU not readable'));
    }
  } finally {
    names.forEach((name, i) => { if (original[i]) Object.defineProperty(globalThis, name, original[i]); else delete globalThis[name]; });
  }
});
