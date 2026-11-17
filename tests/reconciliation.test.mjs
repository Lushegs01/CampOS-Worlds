import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainCorrection } from '../src/arena/reconciliation.mjs';
import { createWorld } from '../shared/arena/physics.mjs';

test('small unobstructed camera errors smooth; accumulated large errors snap', () => {
  const world = createWorld([], [-10, -10, 10, 10]), sim = { x: 0, y: 0, z: 0, stance: 0 };
  assert.deepEqual(constrainCorrection(world, sim, { x: .2, y: .1, z: 0 }), { x: .2, y: .1, z: 0 });
  for (const x of [.8, Infinity, NaN]) assert.deepEqual(constrainCorrection(world, sim, { x, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
});
test('camera correction cannot cross a wall or peek through its edge', () => {
  const world = createWorld([{ min: [.3, 0, -2], max: [.4, 3, 2] }], [-10, -10, 10, 10]);
  const sim = { x: 0, y: 0, z: 0, stance: 0 };
  assert.deepEqual(constrainCorrection(world, sim, { x: .6, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
  assert.deepEqual(constrainCorrection(world, sim, { x: .25, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
  assert.deepEqual(constrainCorrection(world, sim, { x: -.2, y: 0, z: 0 }), { x: -.2, y: 0, z: 0 });
});
