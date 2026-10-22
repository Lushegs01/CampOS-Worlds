import test from 'node:test';
import assert from 'node:assert/strict';
import { STEERING, steerToward, steerAuthority, lockSeconds, steeringSensitivity } from '../src/vehicles/steering.mjs';
import { preferences } from '../src/preferences.mjs';
import { sanitizeAvatar } from '../shared/campus.mjs';

const hold = (s, target, seconds, from = 0) => { let w = from; for (let t = 0; t < seconds; t += 1 / 60) w = steerToward(w, target, s, 1 / 60); return w; };
test('sensitivity 1 is the original direct steering; the default is lower', () => {
  assert.ok(STEERING.default < 1);
  assert.equal(steerToward(0, 1, 1, 1 / 60), 1); assert.equal(steerToward(.4, -1, 1, 1 / 60), -1);
  assert.equal(steerAuthority(1, 23), 1); assert.equal(lockSeconds(1), 0);
});
test('lower sensitivity turns the wheel in gradually, centres twice as fast and still reaches full lock', () => {
  const s = STEERING.default, lock = lockSeconds(s);
  const tap = hold(s, 1, .1); assert.ok(tap > 0 && tap < .3, `a short tap is a small correction (${tap})`);
  assert.ok(Math.abs(hold(s, 1, lock * 1.05) - 1) < 1e-9, 'holding reaches full lock');
  assert.ok(Math.abs(hold(s, 0, lock / 2 * 1.05, 1)) < 1e-9, 'releasing centres in half the time');
  assert.ok(hold(STEERING.min, 1, .3) < hold(s, 1, .3), 'the lowest setting is gentler still');
  assert.ok(hold(s, -1, .1, .5) < .5, 'reversing direction passes through centre at the faster rate');
});
test('at speed lower sensitivity gives less steering; slow manoeuvres keep full lock', () => {
  const s = STEERING.default;
  assert.equal(steerAuthority(s, 0), 1); assert.equal(steerAuthority(s, -3), 1 - (1 - s) * .25);
  assert.ok(Math.abs(steerAuthority(s, 12) - s) < 1e-9); assert.ok(Math.abs(steerAuthority(s, 23) - s) < 1e-9);
  assert.ok(steerAuthority(STEERING.min, 20) < steerAuthority(s, 20));
});
test('invalid inputs are bounded and preferences hydrate safely', () => {
  assert.equal(steeringSensitivity(Number.NaN), STEERING.default); assert.equal(steeringSensitivity(9), 1); assert.equal(steeringSensitivity(-1), STEERING.min);
  assert.equal(steerToward(0, 7, .6, 1), 1); assert.equal(steerToward(.2, Number.NaN, 1, 1 / 60), 0); assert.equal(steerToward(.2, 1, .6, -1), .2);
  const current = { name: 'E', avatar: sanitizeAvatar(), quality: 'low', volume: .7, ambience: 1, steering: STEERING.default, reducedMotion: false, discovered: [], tokens: [], muted: [], tour: false, tourStep: 0, bestScore: 0 };
  assert.equal(preferences({}, current).steering, STEERING.default, 'saved settings from before this option get the new, lower default');
  assert.equal(preferences({ steering: .3, ambience: .25 }, current).steering, .3); assert.equal(preferences({ steering: .3, ambience: .25 }, current).ambience, .25);
});
