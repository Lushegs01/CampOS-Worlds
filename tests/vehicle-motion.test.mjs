import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleMotion } from '../src/network/vehicle-motion.mjs';
import { createFleet } from '../shared/vehicles.mjs';

test('each car stops extrapolating after its own last update, even when other cars keep updating', () => {
  const motion = createVehicleMotion(), [a, b] = createFleet().snapshot(), out = {};
  Object.assign(a, { x: 0, z: 0, yaw: 0, speed: 8, steering: 0, wheel: 0 });
  motion.receive(a, 0); motion.sample(a.id, 125, out); assert.equal(out.z, 1);
  for (let t = 0; t < 10000; t += 66) motion.receive(b, t);
  motion.sample(a.id, 10000, out); assert.equal(out.z, 2); assert.equal(out.wheel, 2 / .32);
  assert.equal(a.z, 0, 'sampling does not mutate the authoritative snapshot');
});

test('a turning car samples the same arc at any render frame rate', () => {
  const motion = createVehicleMotion(), v = { ...createFleet().snapshot()[0], speed: 8, steering: .3 }, a = {}, b = {};
  motion.receive(v, 1000); motion.sample(v.id, 1250, a);
  for (let t = 1000; t <= 1250; t += 10) motion.sample(v.id, t, b);
  assert.deepEqual(a, b); motion.sample(v.id, 10000, b); assert.deepEqual(a, b);
  motion.receive({ ...v, x: 40, z: 50, speed: 0 }, 10100); motion.sample(v.id, 10200, b);
  assert.equal(b.x, 40); assert.equal(b.z, 50);
});
