// Combat feedback the server decides: lead changes (taken, back on top), the shooter's elimination summary (experience,
// medals, eliminations this life), the new medals (wallbang, point blank, buzzkill), and the weapon-level unlock track.
// Driven through a real match with the shared simulation: shots are real commands, hits are the server's own ray casts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_BY_ID } from '../shared/arena/maps.mjs';
import { createMatch } from '../server/arena/match.mjs';
import { encodeCommand, B, EYE } from '../shared/arena/sim.mjs';
import { SKINS, skinsAt, skinsBetween } from '../shared/arena/weapons.mjs';
import { MEDALS, XP } from '../shared/arena/rules.mjs';

const SNIPER = { name: 'Test', primary: 'longbow', secondary: 'knife', lethal: 'frag', tactical: 'flash', perks: ['fleet', 'steady'] };
const map = MAP_BY_ID.get('foundry');

function fixture() {
  let now = 50000; const events = new Map();
  const m = createMatch({ id: 'feedback-test', map, mode: 'tdm', kind: 'private', autoTick: false, clock: () => now,
    rules: { countdownMs: 0, spawnProtectMs: 0, abandonMs: 1e7, mode: { scoreLimit: 1000, timeMs: 3600000 } },
    send: (p, e) => { if (e.t === 'e') { if (!events.has(p.num)) events.set(p.num, []); events.get(p.num).push(...e.l); } }, sendRaw: () => {} });
  const a = m.join({ id: 'a', name: 'Alpha', loadout: SNIPER }), b = m.join({ id: 'b', name: 'Bravo', loadout: SNIPER });
  const advance = (ms = 17) => { now += ms; m.tick(); };
  m.hostStart(a); advance();
  assert.equal(m.state, 'playing');
  assert.notEqual(a.team, b.team);
  return { m, a, b, advance, events, of: (p, k) => (events.get(p.num) ?? []).filter(e => e.k === k), clock: () => now };
}
const place = (p, x, z, yaw = 0) => { Object.assign(p.sim, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0 }); p.history = []; };
/** Feed `n` commands with buttons `b` at a fixed view, a few at a time (as a client would), with time passing. */
function act(f, p, n, b, yaw, pitch) {
  for (let i = 0; i < n; i += 8) {
    const list = [];
    for (let k = 0; k < Math.min(8, n - i); k++) list.push(encodeCommand({ seq: p.lastSeq + 1 + k, b, mx: 0, mz: 0, yaw, pitch }));
    f.advance(140); f.m.commands(p, list, 0);
  }
}
/** Aim at `target` (a point on the victim's body at height `h`), settle into the sights, then fire until they fall. */
function shoot(f, shooter, victim, h = 1.2) {
  const dx = victim.sim.x - shooter.sim.x, dz = victim.sim.z - shooter.sim.z, yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(victim.sim.y + h - (shooter.sim.y + EYE[0]), Math.hypot(dx, dz));
  act(f, shooter, 70, B.ADS, yaw, pitch);
  for (let tries = 0; tries < 6 && victim.alive; tries++) { act(f, shooter, 2, B.ADS | B.FIRE, yaw, pitch); act(f, shooter, 70, B.ADS, yaw, pitch); }
  assert.equal(victim.alive, false, `${shooter.name} should have eliminated ${victim.name}`);
}
/** Bring an eliminated player back (respawn time passes) and stand both where they can see each other. */
function reset(f) {
  f.advance(4200); f.advance(17);
  assert.ok(f.a.alive && f.b.alive);
  place(f.a, -32, 3, -Math.PI / 2); place(f.b, -24, 3, Math.PI / 2);
}

test('lead changes are announced to everyone: taken, overtaken, and back on top', () => {
  const f = fixture(), { a, b } = f;
  reset(f); shoot(f, a, b);                        // 1–0: Alpha's team takes the lead
  reset(f); shoot(f, b, a);                        // 1–1: level, no announcement
  reset(f); shoot(f, b, a);                        // 1–2: Bravo's team takes the lead (overtaking Alpha's)
  reset(f); shoot(f, a, b);                        // 2–2
  reset(f); shoot(f, a, b);                        // 3–2: Alpha's team is back on top
  const calls = f.of(a, 'lead').map(e => [e.team, e.back]);
  assert.deepEqual(calls, [[a.team, false], [b.team, false], [a.team, true]]);
  assert.deepEqual(f.of(b, 'lead').map(e => [e.team, e.back]), calls, 'both sides hear the same changes');
  assert.ok(f.m.combatLog.some(e => e.type === 'lead' && e.back), 'recorded in the combat log');
});

test('the shooter gets one summary per elimination: experience, medals and eliminations this life', () => {
  const f = fixture(), { a, b } = f;
  reset(f); shoot(f, a, b);
  reset(f); shoot(f, a, b, 1.62);                  // a headshot: 100 + 25
  const elims = f.of(a, 'elim');
  assert.equal(elims.length, 2);
  assert.equal(elims[0].v, b.num); assert.equal(elims[0].w, 'longbow'); assert.equal(elims[0].xp, XP.kill); assert.equal(elims[0].n, 1);
  assert.ok(elims[0].m.includes('first'), 'first blood');
  assert.equal(elims[1].n, 2, 'second elimination this life');
  assert.ok(elims[1].m.includes('headshot')); assert.equal(elims[1].xp, XP.kill + XP.headshot);
  assert.equal(f.of(b, 'elim').length, 0, 'only the shooter receives it');
  assert.equal(f.of(a, 'medal').filter(e => e.id === 'headshot' || e.id === 'first').length, 0, 'elimination medals come with the summary, not separately');
  for (const e of elims) for (const id of e.m) assert.ok(id in MEDALS, `medal ${id} has a name`);
});

test('point blank, buzzkill and wallbang medals', () => {
  const f = fixture(), { a, b } = f;
  // Point blank: under 2.5 m with a gun.
  reset(f); place(a, -26, 3, -Math.PI / 2); place(b, -24.2, 3, Math.PI / 2); shoot(f, a, b);
  assert.ok(f.of(a, 'elim').at(-1).m.includes('pointblank'));
  // Buzzkill: ending a run of three or more.
  reset(f); b.streak = 3; shoot(f, a, b);
  const last = f.of(a, 'elim').at(-1).m;
  assert.ok(last.includes('buzzkill')); assert.ok(!last.includes('pointblank'), '8 m is not point blank');
  // Wallbang: through the sandbag line west of the warehouse (thin cover the sniper rifle penetrates).
  reset(f);
  const bag = map.boxes.find(x => x.thin && x.mat === 'sandbag' && x.min[0] < -13 && x.max[0] > -14.5);
  assert.ok(bag, 'the sandbag line exists');
  place(a, -21, 0, -Math.PI / 2); place(b, -9, 0, Math.PI / 2); b.hp = 25; b.lastDamageAt = f.clock();
  shoot(f, a, b, .45);
  assert.ok(f.of(a, 'elim').at(-1).m.includes('wallbang'), JSON.stringify(f.of(a, 'elim').at(-1)));
});

test('every weapon level from 2 to 10 unlocks exactly one finish', () => {
  assert.equal(SKINS[0].weaponLevel, 1);
  for (let level = 1; level <= 10; level++) assert.equal(skinsAt(level).length, 1, `level ${level}`);
  assert.deepEqual(skinsBetween(2, 5).map(k => k.id), ['tidewater', 'dune', 'ember']);
  assert.deepEqual(skinsBetween(10, 10), []);
  assert.equal(new Set(SKINS.map(k => k.id)).size, SKINS.length);
  for (const k of SKINS) assert.match(k.id, /^[a-z0-9-]{1,24}$/);
});
