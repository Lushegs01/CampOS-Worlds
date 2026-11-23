// The Commercial District hero pedestrian (src/world/heroPedestrian.tsx, heroPedestrianPlan.mjs, the `funmi` character).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pedestrianAt, PERIOD, ROUTE, BENCH_SEAT, SIT, SPEED } from '../src/world/heroPedestrianPlan.mjs';
import { HARBOUR_BUILDINGS, HARBOUR_BLOCKS, HARBOUR_FURNITURE } from '../shared/harbour-local.mjs';
import { MODELS } from '../shared/campus.mjs';

const manifest = JSON.parse(fs.readFileSync('public/assets/characters/manifest.json', 'utf8'));

test('her round is a pure function of the clock and repeats every PERIOD', () => {
  for (const t of [0, 13.7, 61.2, 1e6 + .5]) {
    assert.deepEqual(pedestrianAt(t), pedestrianAt(t));
    const a = pedestrianAt(t), b = pedestrianAt(t + PERIOD);
    assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6 && a.action === b.action);
  }
  assert.ok(PERIOD > 90 && PERIOD < 200, `${PERIOD}`);
});

test('she moves continuously at walking pace (no jumps), and visits the ATM, the bench and her phone', () => {
  const seen = new Set(); let prev = pedestrianAt(0);
  for (let t = .1; t <= PERIOD + .05; t += .1) {
    const p = pedestrianAt(t);
    assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) <= SPEED * .1 + 1e-6, `jump at ${t.toFixed(1)}`);
    seen.add(p.action + (p.phase ? ':' + p.phase : '')); prev = p;
  }
  for (const a of ['walk', 'documents', 'phone', 'sit:down', 'sit:seated', 'sit:up']) assert.ok(seen.has(a), a);
});

test('her route stays on open paving: outside every building, clear of planters, inside the block', () => {
  const block = HARBOUR_BLOCKS.find(b => b.id === 'block-0-1');
  for (let t = 0; t < PERIOD; t += .25) {
    const p = pedestrianAt(t);
    for (const b of HARBOUR_BUILDINGS) assert.ok(!(Math.abs(p.x - b.x) < b.w / 2 + .25 && Math.abs(p.z - b.z) < b.d / 2 + .25), `inside ${b.id} at ${t}`);
    for (const f of HARBOUR_FURNITURE.filter(f => f.h < .4)) assert.ok(!(Math.abs(p.x - f.x) < f.w / 2 + .2 && Math.abs(p.z - f.z) < f.d / 2 + .2), `in a planter at ${t}`);
    assert.ok(Math.abs(p.x - block.x) <= block.w / 2 && Math.abs(p.z - block.z) <= block.d / 2, `off the block at ${t}`);
  }
  // The bench she sits on is a shared bench collider in front of the bank.
  assert.ok(HARBOUR_FURNITURE.some(f => f.h > .5 && Math.abs(f.x - BENCH_SEAT.x) < f.w / 2 && Math.abs(f.z - BENCH_SEAT.z) < f.d / 2 + .1));
  // ...and the ATM stand faces the bank's shopfront from outside its collider.
  const bank = HARBOUR_BUILDINGS.find(b => b.id === 'block-0-1-0');
  assert.ok(ROUTE.ATM.z > bank.z + bank.d / 2 && ROUTE.ATM.z - (bank.z + bank.d / 2) < .6);
  assert.ok(SIT.down > 2 && SIT.up > 2);
});

test('the pedestrian character ships like the cast but is not player-selectable; the new clips are in both libraries', () => {
  const funmi = manifest.characters.find(c => c.id === 'funmi');
  assert.ok(funmi && funmi.npc === true && funmi.body === 'f' && /Rocketbox/.test(funmi.source));
  assert.ok(fs.statSync('public/assets/characters/funmi.glb').size > 100_000);
  assert.ok(!MODELS.includes('funmi'));
  for (const g of ['m', 'f']) for (const clip of ['phone', 'documents', 'walk', 'sitIdle']) assert.ok(clip in manifest.animations[g].speeds, `${g}:${clip}`);
});
