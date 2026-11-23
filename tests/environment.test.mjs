import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentAt, hourAt, weatherForSlot, sunDirection, nightAmount, resolveEnvironment, sanitizeTime, sanitizeWeather, WEATHER, WEATHER_NAMES, TIMES, DAY_MINUTES, WEATHER_SLOT_MINUTES } from '../shared/environment.mjs';

test('the environment is a pure function of time: identical on every client', () => {
  const t = Date.UTC(2026, 10, 23, 14, 7, 31);
  assert.deepEqual(environmentAt(t), environmentAt(t));
  for (let s = -50; s < 400; s++) assert.equal(weatherForSlot(s), weatherForSlot(s));
});

test('one day lasts DAY_MINUTES and the hour advances continuously', () => {
  const t = Date.UTC(2026, 0, 1);
  const a = hourAt(t), b = hourAt(t + DAY_MINUTES * 60000);
  assert.ok(Math.abs(a - b) < 1e-6);
  const step = hourAt(t + 60000) - a;
  assert.ok(Math.abs(((step % 24) + 24) % 24 - 24 / DAY_MINUTES) < 1e-6);
});

test('weather visits every state over a long period, mostly fair, never jumps clear to storm', () => {
  const seen = Object.fromEntries(WEATHER_NAMES.map(k => [k, 0]));
  let prev = weatherForSlot(0);
  for (let s = 1; s < 6000; s++) {
    const w = weatherForSlot(s); seen[w]++;
    if (s % 12 !== 0) assert.ok(!(prev === 'clear' && w === 'storm'), `slot ${s}`);
    prev = w;
  }
  for (const k of WEATHER_NAMES) assert.ok(seen[k] > 0, k);
  assert.ok(seen.clear + seen.overcast > 6000 * .45, JSON.stringify(seen));
  assert.ok(seen.storm < 6000 * .08, JSON.stringify(seen));
});

test('weather blends smoothly into each slot and parameters stay in range', () => {
  const slot = WEATHER_SLOT_MINUTES * 60000, base = Math.floor(Date.UTC(2026, 3, 2) / slot) * slot;
  let last = null;
  for (let ms = base - 120000; ms < base + 6 * 60000; ms += 5000) {
    const e = environmentAt(ms);
    for (const [k, v] of Object.entries(e.params)) assert.ok(v >= 0 && v <= (k === 'lightning' ? 5 : 1), `${k}=${v}`);
    if (last) for (const k of Object.keys(e.params)) assert.ok(Math.abs(e.params[k] - last.params[k]) <= (k === 'lightning' ? .3 : .06), `${k} jumps at ${ms - base}`);
    last = e;
  }
});

test('the sun rises in the morning, is high at noon, sets in the evening, and night follows', () => {
  assert.ok(sunDirection(TIMES.midday).elevation > 1.2);
  assert.ok(sunDirection(TIMES.morning).elevation > .2 && sunDirection(TIMES.morning).elevation < .7);
  assert.ok(sunDirection(TIMES.golden).elevation > 0 && sunDirection(TIMES.golden).elevation < .2);
  assert.ok(sunDirection(TIMES.night).elevation < -.5);
  // The afternoon sun stands over +x, the morning sun over -x.
  assert.ok(sunDirection(TIMES.afternoon).x > .3 && sunDirection(TIMES.morning).x < -.3);
  assert.equal(nightAmount(sunDirection(TIMES.midday).elevation), 0);
  assert.equal(nightAmount(sunDirection(TIMES.night).elevation), 1);
  const d = sunDirection(10.3); assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
});

test('settings override the live cycle and invalid saved values fall back to live', () => {
  const t = Date.UTC(2026, 5, 5, 3);
  const r = resolveEnvironment(t, 'night', 'storm');
  assert.equal(r.hour, TIMES.night); assert.equal(r.weather, 'storm'); assert.deepEqual(r.params, WEATHER.storm);
  assert.equal(resolveEnvironment(t, 'live', 'live').hour, environmentAt(t).hour);
  assert.equal(sanitizeTime('teatime'), 'live'); assert.equal(sanitizeWeather({}), 'live'); assert.equal(sanitizeWeather('fog'), 'fog');
  assert.equal(sanitizeTime('__proto__'), 'live');
});
