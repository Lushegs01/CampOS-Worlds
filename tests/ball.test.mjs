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

test('a ball wedged between rim and backboard, or resting on the arm, returns to the rack', () => {
  const spots = { gap: { x: south.x, y: south.rimY + .15, z: (south.board.z + south.board.d / 2 + south.z - south.rimR) / 2 + .02 }, arm: { x: south.x, y: south.arm.y1 + BALL_R + .001, z: south.arm.z } };
  for (const [name, spot] of Object.entries(spots)) {
    const b = Object.assign(newBall(BALLS[0]), spot, { vx: 0, vy: 0, vz: 0, state: 'free' }), events = [];
    for (let t = 0; t < 2.5; t += 1 / 30) stepBall(b, 1 / 30, events);
    assert.ok(b.y > 2.5, `${name}: the ball really does get stuck up there`);
    for (let t = 0; t < 2; t += 1 / 30) stepBall(b, 1 / 30, events);
    assert.ok(events.some(e => e.type === 'respawn'), `${name}: an unreachable ball is returned`);
    assert.ok(b.y < 1.7, `${name}: and ends within reach`);
    // Then it drops onto the rack spot and stays put, even when stepped at a high frame rate.
    const after = events.length;
    for (let t = 0; t < 3; t += 1 / 144) stepBall(b, 1 / 144, events);
    assert.equal(events.slice(after).filter(e => e.type === 'respawn').length, 0, `${name}: respawns once, not in a loop`);
    assert.ok(Math.abs(b.y - (floorAt(b.x, b.z) + BALL_R)) < .005, `${name}: and rests on the ground`);
  }
});

test('a ball left at rest away from the court returns to the rack instead of sleeping there forever', () => {
  // Carried across campus and dropped on the lawn by the café: it rolls to rest and goes to sleep.
  const b = Object.assign(newBall(BALLS[0]), { x: 20, y: 1, z: 6, vx: .8, vy: .5, vz: 0, state: 'free' }), events = [];
  for (let t = 0; t < 6; t += 1 / 30) stepBall(b, 1 / 30, events);
  assert.ok(b.rest > .5, 'the ball is asleep on the ground');
  assert.equal(events.filter(e => e.type === 'respawn').length, 0, 'not straight away');
  for (let t = 0; t < 21; t += 1 / 30) stepBall(b, 1 / 30, events);
  assert.ok(events.some(e => e.type === 'respawn'), 'an idle ball far from the court respawns');
  const spec = BALLS.find(s => s.id === b.id);
  assert.ok(Math.hypot(b.x - spec.x, b.z - spec.z) < .01, 'back on the rack');
});

test('a ball at rest on the court stays where it is', () => {
  const b = Object.assign(newBall(BALLS[0]), { x: 44, y: .3, z: 20, vx: 0, vy: 0, vz: 0, state: 'free' }), events = [];
  for (let t = 0; t < 40; t += 1 / 30) stepBall(b, 1 / 30, events);
  assert.equal(events.filter(e => e.type === 'respawn').length, 0);
  assert.ok(Math.hypot(b.x - 44, b.z - 20) < .05);
});
