import test from 'node:test';
import assert from 'node:assert/strict';
import { preferences } from '../src/preferences.mjs';
import { sanitizeAvatar, TOKENS, LOCATIONS, TOUR } from '../shared/campus.mjs';

const defaults = { name: 'Explorer', avatar: sanitizeAvatar(), quality: 'medium', volume: .7, ambience: 1, steering: .6,
  reducedMotion: false, discovered: [], tokens: [], muted: [], tour: false, tourStep: 0, bestScore: 0 };
test('corrupt saved preferences cannot replace methods or crash rendering with invalid types', () => {
  const p = preferences({ quality: 'ultra', tokens: null, discovered: 7, muted: {}, volume: 'loud', ambience: 'quiet', steering: null, tourStep: Infinity,
    set: null, notify: 'broken', status: 'connected', phase: 'playing', name: {}, avatar: null }, defaults);
  assert.deepEqual(p, defaults);
  assert.deepEqual(preferences(null, defaults), defaults);
  assert.deepEqual(preferences('old schema', defaults), defaults);
});
test('valid progress survives hydration while invalid IDs, duplicates and out-of-range values are removed', () => {
  const p = preferences({ name: ' Ada ', quality: 'low', volume: 2, tokens: [TOKENS[0].id, TOKENS[0].id, 'forged', null],
    discovered: [LOCATIONS[0].id, 'missing'], tourStep: 1000, bestScore: -50, muted: ['h:ada', 4], reducedMotion: true }, defaults);
  assert.equal(p.name, 'Ada'); assert.equal(p.quality, 'low'); assert.equal(p.volume, 1);
  assert.equal(preferences({ ambience: -1, steering: 5 }, defaults).ambience, 0); assert.equal(preferences({ ambience: .3, steering: 5 }, defaults).steering, 1);
  assert.equal(preferences({ ambience: .3, steering: 0 }, defaults).steering, .2); assert.equal(preferences({ ambience: .3 }, defaults).ambience, .3);
  assert.deepEqual(p.tokens, [TOKENS[0].id]); assert.deepEqual(p.discovered, [LOCATIONS[0].id]);
  assert.equal(p.tourStep, TOUR.length); assert.equal(p.bestScore, 0); assert.deepEqual(p.muted, ['h:ada']);
});
