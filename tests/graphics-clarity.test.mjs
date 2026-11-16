// Low stays clear: it draws at more than one pixel per CSS pixel where the screen has them, filters textures at 4×,
// keeps anti-aliasing, and the adaptive scaler never takes a phone below the clarity floor however slow the frames.
// First-person weapons and hands use the same full-detail files on every profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARENA_QUALITY } from '../src/arena/scene/world.ts';
import { createAdaptive } from '../shared/arena/adaptive.mjs';

test('Low is a clear image: 1.5× density, 4× filtering, anti-aliased', () => {
  const low = ARENA_QUALITY.low;
  assert.ok(low.dpr >= 1.5 && low.anisotropy >= 4 && low.antialias, JSON.stringify({ dpr: low.dpr, anisotropy: low.anisotropy, antialias: low.antialias }));
  for (const [id, q] of Object.entries(ARENA_QUALITY)) assert.ok(q.dpr >= low.dpr && q.anisotropy >= low.anisotropy, `${id} is at least as sharp as Low`);
});
test('the adaptive scaler stops at the clarity floor on a phone that cannot keep up', () => {
  const src = readFileSync('src/arena/Scene.tsx', 'utf8'), floor = Number(/CLARITY_FLOOR = touchDevice \? ([\d.]+)/.exec(src)[1]);
  assert.ok(floor >= .85);
  const base = Math.min(ARENA_QUALITY.low.dpr, 2), a = createAdaptive({ target: 30, min: Math.min(1, Math.max(.5, floor / base)) });
  for (let i = 0; i < 120; i++) a.sample(12);
  assert.ok(base * a.scale >= floor - 1e-9, `drawn density ${base * a.scale}`);
});
test('first-person weapons and arms are never the reduced phone tier', () => {
  const w = readFileSync('src/arena/scene/weapons.ts', 'utf8');
  assert.match(w, /loadModel\(`arena\/weapons\/\$\{file\}\.glb`/); assert.match(w, /loadModel\('arena\/weapons\/arms\.glb'/);
  assert.doesNotMatch(w, /arenaPath\(/);
});
