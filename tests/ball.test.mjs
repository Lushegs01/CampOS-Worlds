import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepBall, planShot, newBall, BALL_R, floorAt } from '../shared/ball.mjs';
import { HOOPS, BALLS } from '../shared/interactions.mjs';

const south = HOOPS.find(h => h.id === 'south');
function shoot(x, z, charge, seconds = 4) {
  const yaw = Math.atan2(south.x - x, south.z - z), b = newBall(BALLS[0]), launch = planShot(x, z, yaw, charge);
  Object.assign(b, launch, { state: 'flight', shot: { id: 1, by: 'p', from: [x, z], scored: false }, rest: 0 });
  const events = []; for (let t = 0; t < seconds; t += 1 / 30) stepBall(b, 1 / 30, events);
  return { b, events, scores: events.filter(e => e.type === 'score') };
}
test('an ideal free throw scores exactly once, for two points', () => {
  const { scores } = shoot(south.x, south.z + 4.6, .5);
  assert.equal(scores.length, 1); assert.equal(scores[0].points, 2);
});
test('a shot from beyond the arc is worth three', () => {
  const { scores } = shoot(south.x + 2, south.z + 7.1, .5);
  assert.equal(scores.length, 1); assert.equal(scores[0].points, 3);
});
test('under- and over-charged shots miss', () => {
  assert.equal(shoot(south.x, south.z + 4.6, 0).scores.length, 0);
  assert.equal(shoot(south.x, south.z + 4.6, 1).scores.length, 0);
});
test('a ball rising up through the ring never counts', () => {
  const b = newBall(BALLS[0]); Object.assign(b, { x: south.x, y: south.rimY - .6, z: south.z, vx: 0, vy: 6, vz: 0, state: 'flight', shot: { id: 2, by: 'p', from: [south.x, south.z + 2], scored: false } });
  const events = []; for (let i = 0; i < 12; i++) stepBall(b, 1 / 60, events); // up through the rim plane only
  assert.equal(events.filter(e => e.type === 'score').length, 0);
});
test('a fast throw at the backboard rebounds instead of tunnelling', () => {
  const b = newBall(BALLS[0]); Object.assign(b, { x: south.x + .3, y: south.board.y, z: south.board.z + 3, vx: 0, vy: 2.2, vz: -25, state: 'flight', shot: null });
  const events = []; for (let i = 0; i < 20; i++) stepBall(b, 1 / 30, events);
  assert.ok(b.z > south.board.z, `ball ended behind the board at z=${b.z.toFixed(2)}`);
  assert.ok(events.some(e => e.type === 'board'));
});
test('a resting ball settles on the court surface', () => {
  const b = newBall(BALLS[0]); for (let i = 0; i < 300; i++) stepBall(b, 1 / 30);
  assert.ok(Math.abs(b.y - (floorAt(b.x, b.z) + BALL_R)) < .005 && b.rest > .5);
});
