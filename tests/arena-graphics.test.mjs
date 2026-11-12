// Combat Arena graphics settings: the four profiles and the resolution scale are real, validated settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITIES, parseArenaSettings, defaultArenaSettings, SYNCED_SETTINGS } from '../shared/arena/settings.mjs';

test('graphics profiles: low, medium, high and ultra are accepted; anything else falls back', () => {
  assert.deepEqual(QUALITIES, ['low', 'medium', 'high', 'ultra']);
  assert.equal(parseArenaSettings({ quality: 'ultra' }).quality, 'ultra');
  assert.equal(parseArenaSettings({ quality: 'cinematic' }, 'low').quality, 'low');
  assert.equal(defaultArenaSettings('ultra').quality, 'ultra');
});

test('resolution scale is clamped to 50–100 % and stays on the device', () => {
  assert.equal(defaultArenaSettings().renderScale, 1);
  assert.equal(parseArenaSettings({ renderScale: .75 }).renderScale, .75);
  assert.equal(parseArenaSettings({ renderScale: .1 }).renderScale, .5);
  assert.equal(parseArenaSettings({ renderScale: 4 }).renderScale, 1);
  assert.equal(parseArenaSettings({ renderScale: 'max' }).renderScale, 1);
  assert.ok(!SYNCED_SETTINGS.includes('renderScale') && !SYNCED_SETTINGS.includes('quality'), 'device-specific settings are not synced to the account');
});
