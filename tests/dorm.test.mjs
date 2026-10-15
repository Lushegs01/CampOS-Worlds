// Personal rooms (shared/dorm.mjs): the wing's walls, layout validation and furniture collision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DORM_ROOM, DORM_INSIDE, DORM_OUTSIDE, DORM_W, DORM_D, DEFAULT_LAYOUT, FURNITURE, MAX_ITEMS, validateLayout, furnitureBlocked, furnitureAllows, footprint, inDormRoom, nearDormDoor } from '../shared/dorm.mjs';
import { blocked, moveWithCollisions } from '../shared/campus.mjs';
import { stepWalker } from '../shared/movement.mjs';

test('the wing is closed: nobody walks in from the common room or from outside, nobody walks out', () => {
  assert.ok(!blocked(DORM_INSIDE.x, DORM_INSIDE.z) && !blocked(DORM_OUTSIDE.x, DORM_OUTSIDE.z));
  assert.ok(inDormRoom(DORM_INSIDE.x, DORM_INSIDE.z) && !inDormRoom(DORM_OUTSIDE.x, DORM_OUTSIDE.z));
  // From the common room through the back wall, from the north, east and west: stopped at the walls.
  const tries = [[DORM_OUTSIDE.x, DORM_OUTSIDE.z, 0, -8], [655, -12, 0, 10], [DORM_ROOM.x0 - 3, -4, 6, 0], [DORM_ROOM.x1 + 3, -4, -6, 0]];
  for (const [x, z, dx, dz] of tries) assert.ok(!inDormRoom(moveWithCollisions(x, z, dx, dz).x, moveWithCollisions(x, z, dx, dz).z), `walked in from ${x}, ${z}`);
  for (const [dx, dz] of [[0, 9], [0, -9], [9, 0], [-9, 0]]) { const q = moveWithCollisions(DORM_INSIDE.x, DORM_INSIDE.z, dx, dz); assert.ok(inDormRoom(q.x, q.z), `walked out towards ${dx}, ${dz}`); }
  assert.ok(nearDormDoor(DORM_OUTSIDE.x, DORM_OUTSIDE.z, false) && nearDormDoor(DORM_INSIDE.x, DORM_ROOM.z1 - .9, true));
});

test('the default room is a valid layout', () => {
  const r = validateLayout(DEFAULT_LAYOUT);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.layout, DEFAULT_LAYOUT);
});

test('layouts from players are checked and cleaned, never trusted', () => {
  const ok = items => validateLayout({ items });
  assert.equal(validateLayout(null).ok, false);
  assert.equal(validateLayout({ items: 'bed' }).ok, false);
  assert.equal(ok([{ t: 'piano', x: 2, z: 2 }]).ok, false, 'not in the catalogue');
  assert.equal(ok([{ t: 'toString', x: 2, z: 2 }]).ok, false, 'prototype names are not furniture');
  assert.equal(ok([{ t: 'plant', x: '2', z: 2 }]).ok, false, 'numbers only');
  assert.equal(ok([{ t: 'plant', x: 2.03, z: 2 }]).ok, false, 'positions on the 5 cm grid');
  assert.equal(ok([{ t: 'plant', x: 2, z: 2, r: 4 }]).ok, false);
  assert.equal(ok([{ t: 'plant', x: 2, z: 2, r: 1.5 }]).ok, false);
  assert.equal(ok([{ t: 'rug', x: 2, z: 2, c: 9 }]).ok, false);
  assert.equal(ok([{ t: 'plant', x: .1, z: 2 }]).ok, false, 'outside the west wall');
  assert.equal(ok([{ t: 'bed', x: DORM_W - .9, z: 2 }]).ok, false, 'through the east wall');
  assert.equal(ok([{ t: 'bed', x: 2, z: 2 }, { t: 'bed', x: 2, z: 4 }]).ok, false, 'one bed');
  assert.equal(ok([{ t: 'desk', x: 2, z: 2 }, { t: 'chair', x: 2, z: 2.2 }]).ok, false, 'solid pieces do not overlap');
  assert.equal(ok([{ t: 'rug', x: 2, z: 2 }, { t: 'chair', x: 2, z: 2 }]).ok, true, 'a chair can stand on a rug');
  assert.equal(ok([{ t: 'rug', x: 2, z: 2 }, { t: 'rug', x: 2.5, z: 2.5 }]).ok, false, 'rugs do not overlap rugs');
  assert.equal(ok([{ t: 'wardrobe', x: DORM_INSIDE.x - DORM_ROOM.x0, z: DORM_D - .4 }]).ok, false, 'the door stays clear');
  assert.equal(ok([{ t: 'rug', x: DORM_INSIDE.x - DORM_ROOM.x0, z: DORM_D - .7 }]).ok, true, 'a rug may lie inside the door');
  assert.equal(ok(Array.from({ length: MAX_ITEMS + 1 }, () => ({ t: 'plant', x: 1, z: 1 }))).ok, false);
  // Quarter turns swap width and depth: a bed turned along the west wall fits where it would not unturned.
  assert.equal(ok([{ t: 'bed', x: .5, z: 1.5, r: 1 }]).ok, true);
  assert.equal(ok([{ t: 'bed', x: .5, z: 1.5, r: 0 }]).ok, false);
  const clean = ok([{ t: 'plant', x: 1.0000000001, z: 2, r: 2, c: 3, extra: 'x', __proto__: { t: 'bed' } }]);
  assert.deepEqual(clean.layout, { items: [{ t: 'plant', x: 1, z: 2, r: 2, c: 0 }] }, 'unknown fields dropped, colour only where it applies');
});

test('furniture is solid to walk into, never a trap, and only inside the room', () => {
  const layout = { items: [{ t: 'wardrobe', x: 3, z: 2, r: 0, c: 0 }] }, box = footprint(layout.items[0]);
  const cx = DORM_ROOM.x0 + 3, cz = DORM_ROOM.z0 + 2;
  assert.ok(furnitureBlocked(layout, cx, cz) && furnitureBlocked(layout, cx, DORM_ROOM.z0 + box.z1 + .2));
  assert.ok(!furnitureBlocked(layout, cx, DORM_ROOM.z0 + box.z1 + .3));
  assert.ok(!furnitureBlocked({ items: [{ t: 'rug', x: 3, z: 2, r: 0, c: 0 }] }, cx, cz), 'rugs are walkable');
  assert.ok(!furnitureBlocked(layout, cx - DORM_ROOM.x0, cz), 'the same spot outside the room is not furnished');
  // Walking north into the wardrobe stops in front of it; standing inside one (placed on you), you walk out.
  const w = { x: cx, z: DORM_ROOM.z0 + 4, y: 0, vx: 0, vz: 0, vy: 0 };
  stepWalker(w, 0, -4.5, 1.5, (x, z, fx, fz) => furnitureAllows(layout, x, z, fx, fz));
  assert.ok(w.z > DORM_ROOM.z0 + box.z1 + .2 && w.z < DORM_ROOM.z0 + box.z1 + .45, `stopped at ${w.z - DORM_ROOM.z0}`);
  const trapped = { x: cx, z: cz, y: 0, vx: 0, vz: 0, vy: 0 };
  stepWalker(trapped, 0, 4.5, 1.5, (x, z, fx, fz) => furnitureAllows(layout, x, z, fx, fz));
  assert.ok(!furnitureBlocked(layout, trapped.x, trapped.z), 'walked out of a piece placed on them');
  assert.ok(Object.values(FURNITURE).every(f => f.w > 0 && f.d > 0 && f.max >= 1));
});
