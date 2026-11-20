import test from 'node:test';
import assert from 'node:assert/strict';
import { portraitBlocked, enterLandscape } from '../src/mobile/orientation.ts';

async function environment({ coarse = true, portrait = true, installed = false, fullscreen = false, lock, request } = {}, run) {
  const globals = { matchMedia: q => ({ matches: q.includes('portrait') ? coarse && portrait : q.includes('standalone') ? installed : coarse }),
    screen: { orientation: { lock } }, document: { fullscreenElement: fullscreen ? {} : null, documentElement: { requestFullscreen: request } }, navigator: {} };
  const previous = Object.fromEntries(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
    await run();
  } finally {
    for (const key of Object.keys(globals)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  }
}

test('landscape fullscreen is requested before locking, and duplicate gestures share one attempt', async () => {
  const calls = [];
  await environment({ request: async () => { calls.push('fullscreen'); }, lock: async mode => { calls.push(mode); } }, async () => {
    assert.equal(portraitBlocked(), true);
    const first = enterLandscape(), second = enterLandscape(); assert.equal(first, second);
    await first; assert.deepEqual(calls, ['fullscreen', 'landscape']);
  });
});

test('installed and fullscreen applications lock without requesting fullscreen again', async () => {
  for (const mode of [{ installed: true }, { fullscreen: true }]) {
    const calls = [];
    await environment({ ...mode, lock: async x => calls.push(x), request: () => { throw Error('unnecessary fullscreen'); } }, async () => {
      await enterLandscape(); assert.deepEqual(calls, ['landscape']);
    });
  }
});

test('unsupported APIs and refused locks/fullscreen safely retain the portrait fallback', async () => {
  for (const mode of [{}, { request: async () => {}, lock: async () => { throw Error('not supported'); } },
    { request: async () => { throw Error('refused'); }, lock: async () => { throw Error('must not call'); } }]) {
    await environment(mode, async () => { await assert.doesNotReject(enterLandscape()); assert.equal(portraitBlocked(), true); });
  }
});

test('desktop portrait windows and touch landscape viewports are never blocked', async () => {
  await environment({ coarse: false }, async () => { assert.equal(portraitBlocked(), false); await enterLandscape(); });
  await environment({ portrait: false }, async () => assert.equal(portraitBlocked(), false));
});
