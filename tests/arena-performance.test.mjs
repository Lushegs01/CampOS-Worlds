// Combat Arena performance logic that runs without a GPU: the adaptive renderer (shared/arena/adaptive.mjs)
// and the asset-loading budget (what a match must download before it can be played).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdaptive, frameTarget } from '../shared/arena/adaptive.mjs';
import { FREE_FIREARMS, WEAPONS } from '../shared/arena/weapons.mjs';

test('adaptive rendering: lowers resolution first, then asks for a lighter profile, and recovers with headroom', () => {
  assert.equal(frameTarget(true), 30); assert.equal(frameTarget(false), 55);
  const a = createAdaptive({ target: 30, min: .6 });
  let r; for (let i = 0; i < 3; i++) r = a.sample(30); assert.equal(r.scale, 1, 'on target: nothing changes');
  const scales = [], steps = [];
  for (let i = 0; i < 40; i++) { r = a.sample(18); scales.push(r.scale); if (r.stepDown) steps.push(i); }
  assert.ok(scales.at(-1) >= .6 && scales.at(-1) < 1, 'resolution dropped, never below the floor');
  assert.ok(scales.every((s, i) => i === 0 || s <= scales[i - 1]), 'monotonic while slow');
  assert.ok(steps.length >= 1, 'a profile step-down is requested once resolution alone is not enough');
  assert.ok(steps[0] > scales.findIndex(s => s === .6), 'only after reaching the resolution floor');
  // Plenty of headroom for a while: resolution comes back.
  for (let i = 0; i < 60; i++) r = a.sample(60);
  assert.equal(r.scale, 1);
  // Noise does not cause oscillation: alternating slightly-slow and fine seconds change nothing.
  const b = createAdaptive({ target: 30 }); let changes = 0;
  for (let i = 0; i < 60; i++) if (b.sample(i % 2 ? 26 : 32).changed) changes++;
  assert.equal(changes, 0);
  for (const bad of [NaN, 0, -5, Infinity]) assert.equal(createAdaptive().sample(bad).changed, false);
});

test('asset budget: a match preloads only the free weapons’ third-person models; the rest stream on demand', () => {
  const soldiers = readFileSync('src/arena/scene/soldiers.ts', 'utf8');
  assert.match(soldiers, /\[\.\.\.FREE_FIREARMS, 'knife'\]\.map\(id => preloadWeapon\(id, true\)/);
  assert.doesNotMatch(soldiers, /WEAPONS as \{ id: string \}\[\]\)\.map\(w => preloadWeapon\(w\.id, true\)\.catch\(\(\) => null\)\)\)/, 'no longer every LOD before play');
  const manifest = JSON.parse(readFileSync('public/assets/arena/manifest.json', 'utf8'));
  const lod = id => manifest.weapons.find(w => w.id === id)?.lodBytes ?? 0;
  const before = WEAPONS.reduce((n, w) => n + lod(w.id), 0), after = [...FREE_FIREARMS, 'knife'].reduce((n, id) => n + lod(id), 0);
  assert.ok(after < before / 3, `third-person weapon download before play: ${(after / 1024).toFixed(0)} KB instead of ${(before / 1024).toFixed(0)} KB`);
  // The Armory and the HUD studio are separate chunks, fetched only when opened.
  const app = readFileSync('src/arena/ArenaApp.tsx', 'utf8');
  assert.match(app, /lazy\(\(\) => import\('\.\/HudEditor'\)\)/); assert.match(app, /lazy\(\(\) => import\('\.\/Armory'\)\)/);
});
