// Combat Arena shared simulation (shared/arena): movement, the weapon state machine, damage, physics,
// maps and rules. The same code runs on the server (authority) and the client (prediction), so these
// tests cover both. All deterministic: no network, no timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, WEAPON_BY_ID, damageAt, CATEGORIES, TICK_RATE, STREAKS, CATALOG } from '../shared/arena/weapons.mjs';
import { MAPS, MAP_BY_ID } from '../shared/arena/maps.mjs';
import { createWorld, overlaps, raycast, lineOfSight } from '../shared/arena/physics.mjs';
import { step, spawnState, packState, unpackState, cloneState, quantize, encodeCommand, decodeCommand, B, RADIUS, HEIGHT, SPEED, weaponOf, spreadOf, hitbox } from '../shared/arena/sim.mjs';
import { validateLoadout, PRESETS, xpForLevel, levelFor, matchXp, balanceTeam, MODES } from '../shared/arena/rules.mjs';
import { raySphere, rayBox } from '../shared/arena/physics.mjs';

const quad = MAP_BY_ID.get('quad'), foundry = MAP_BY_ID.get('foundry');
const qWorld = createWorld(quad.boxes, quad.bounds), fWorld = createWorld(foundry.boxes, foundry.bounds);
const loadout = (primary, secondary = 'sparrow', perks = ['fleet', 'steady']) => ({ name: 't', primary, secondary, lethal: 'frag', tactical: 'flash', perks });
const ctx = (world = qWorld, perks = new Set()) => ({ world, seed: 12345, num: 1, perks });
const cmd = (b = 0, extra = {}) => quantize({ seq: 0, b, mx: 0, mz: 0, yaw: -Math.PI / 2, pitch: 0, ...extra });
/** Run `n` ticks with the same command; returns all events. */
function run(s, n, c, cx = ctx()) { const out = []; for (let i = 0; i < n; i++) out.push(...step(s, { ...c, seq: i + 1 }, cx)); return out; }
/** A player standing in open ground on Sim Quad with a weapon raised and ready. */
function ready(primary, secondary) { const s = spawnState({ x: -20, z: -6, yaw: -Math.PI / 2 }, loadout(primary, secondary)); run(s, 80, cmd()); assert.equal(s.phase, 'ready'); return s; }
const shots = events => events.filter(e => e.kind === 'shot').length;

test('every weapon category plays differently: fire mode, rate, damage profile, range and handling', () => {
  for (const cat of Object.keys(CATEGORIES)) assert.ok(WEAPONS.some(w => w.category === cat), `a ${cat} exists`);
  const ttk = w => { const per = damageAt(w, 8) * (w.pellets || 1); if (w.fire === 'melee') return 0; return (Math.ceil(100 / per) - 1) * 60000 / w.rpm; };
  const byCat = cat => WEAPONS.find(w => w.category === cat && w.unlock === 1);
  const ar = byCat('ar'), smg = byCat('smg'), sg = byCat('shotgun'), sn = byCat('sniper'), lmg = byCat('lmg'), pistol = byCat('pistol');
  assert.ok(smg.rpm > ar.rpm && ar.rpm > lmg.rpm - 200, 'SMGs fire fastest');
  assert.ok(ttk(smg) < ttk(ar) && damageAt(smg, 30) < damageAt(ar, 30), 'SMGs win close, rifles hold up at range');
  assert.ok(damageAt(sg, 2) * sg.pellets >= 100 && damageAt(sg, 20) * sg.pellets < 60, 'shotguns are devastating close and weak far');
  assert.ok(damageAt(sn, 50) >= 95 && damageAt(sn, 50) * sn.head >= 100 && sn.fire === 'bolt', 'the sniper is one shot to the head at long range');
  assert.ok(lmg.mag >= 75 && lmg.penetration > ar.penetration && lmg.moveMul < ar.moveMul && lmg.reload > ar.reload, 'LMGs trade mobility and reload time for sustained fire and penetration');
  assert.equal(pistol.slot, 'secondary'); assert.ok(pistol.moveMul > ar.moveMul && pistol.swap < ar.swap, 'pistols are quick to draw and move with');
  assert.ok(WEAPON_BY_ID.get('knife').damage[0][1] >= 100 && WEAPON_BY_ID.get('knife').range < 3, 'melee is lethal only within reach');
  const keys = w => JSON.stringify([w.rpm, w.mag, w.damage, w.range, w.reload, w.spread, w.recoil, w.ads, w.moveMul, w.head, w.pellets, w.fire]);
  assert.equal(new Set(WEAPONS.map(keys)).size, WEAPONS.length, 'no two weapons share the same numbers');
});

test('damage falls off in steps by distance; head and leg multipliers apply; nothing beyond range', () => {
  const ar = WEAPON_BY_ID.get('vanguard');
  assert.equal(damageAt(ar, 0), 28); assert.equal(damageAt(ar, 23.9), 28); assert.equal(damageAt(ar, 24), 23); assert.equal(damageAt(ar, 60), 19); assert.equal(damageAt(ar, ar.range + 1), 0);
  assert.ok(ar.head > 1 && ar.legs < 1);
  const hb = hitbox(0, 0, -10, HEIGHT[0]);
  assert.ok(raySphere(0, hb.hy, 0, 0, 0, -1, hb.hx, hb.hy, hb.hz, hb.hr, 50) > 0, 'a ray at head height hits the head sphere');
  assert.ok(rayBox(0, 1, 0, 0, 0, -1, hb.x0, hb.y0, hb.z0, hb.x1, hb.y1, hb.z1, 50) > 0, 'a ray at chest height hits the body');
  assert.ok(.3 < hb.legs && hb.legs < 1, 'the lower part of the body counts as legs');
});

test('fire rate is exact and enforced by the simulation; holding fire never exceeds it', () => {
  const s = ready('vanguard'), w = weaponOf(s), ticks = 120;
  const n = shots(run(s, ticks, cmd(B.FIRE)));
  const expected = Math.floor(ticks * w.rpm / (60 * TICK_RATE)) + 1;
  assert.ok(Math.abs(n - expected) <= 1, `${n} shots in ${ticks} ticks at ${w.rpm} rpm (expected about ${expected})`);
  assert.equal(s.wpn[0].mag, w.mag - n);
});

test('semi-automatic weapons need the trigger released; burst rifles fire exactly one burst per pull', () => {
  const p = ready('vanguard', 'sparrow');
  run(p, 60, cmd(B.SLOT2));
  assert.equal(shots(run(p, 90, cmd(B.FIRE))), 1, 'holding the trigger fires a semi-automatic once');
  run(p, 5, cmd());
  let n = 0; for (let i = 0; i < 6; i++) { n += shots(run(p, 10, cmd(B.FIRE))); n += shots(run(p, 10, cmd())); }
  assert.equal(n, 6, 'each pull fires once');
  const br = ready('halcyon');
  assert.equal(shots(run(br, 40, cmd(B.FIRE))), 3, 'one burst per pull, even when held');
  run(br, 10, cmd());
  assert.equal(shots(run(br, 4, cmd(B.FIRE))) + shots(run(br, 30, cmd())), 3, 'a tap still completes the burst');
});

test('ammunition and reloading: reload refills from reserve exactly, takes its time, and auto-starts when empty', () => {
  const s = ready('vanguard'), w = weaponOf(s);
  run(s, 30, cmd(B.FIRE)); const left = s.wpn[0].mag, reserve = s.wpn[0].reserve;
  const ev = run(s, 1, cmd(B.RELOAD)); assert.ok(ev.some(e => e.kind === 'reload')); assert.equal(s.phase, 'reload');
  assert.equal(shots(run(s, w.reload - 2, cmd(B.FIRE))), 0, 'cannot fire while reloading');
  run(s, 3, cmd());
  assert.equal(s.phase, 'ready'); assert.equal(s.wpn[0].mag, w.mag); assert.equal(s.wpn[0].reserve, reserve - (w.mag - left));
  // Empty the magazine: the next trigger pull starts an empty (longer) reload.
  while (s.wpn[0].mag > 0) run(s, 1, cmd(B.FIRE));
  run(s, 5, cmd()); const e2 = run(s, 1, cmd(B.FIRE));
  assert.ok(e2.some(e => e.kind === 'reload' && e.empty)); assert.ok(s.pt >= w.reloadEmpty - 2);
  // No reserve: dry fire, no reload.
  const d = ready('vanguard'); d.wpn[0].reserve = 0; d.wpn[0].mag = 0;
  assert.ok(run(d, 2, cmd(B.FIRE)).some(e => e.kind === 'dry')); assert.equal(d.phase, 'ready');
});

test('shotguns reload shell by shell and firing interrupts the reload', () => {
  const s = ready('bastion'), w = weaponOf(s);
  run(s, 1, cmd(B.FIRE)); run(s, 70, cmd()); run(s, 1, cmd(B.FIRE)); run(s, 70, cmd());
  assert.equal(s.wpn[0].mag, w.mag - 2);
  run(s, 1, cmd(B.RELOAD)); run(s, w.reloadStart + w.reload + 1, cmd());
  assert.equal(s.wpn[0].mag, w.mag - 1, 'one shell after the first interval');
  const ev = run(s, 2, cmd(B.FIRE));
  assert.equal(shots(ev), 1, 'firing interrupts the reload'); assert.equal(s.phase, 'ready');
});

test('weapon switching takes time, cancels a reload and blocks firing until raised', () => {
  const s = ready('anvil', 'sparrow'), anvil = weaponOf(s);
  run(s, 10, cmd(B.FIRE)); run(s, 1, cmd(B.RELOAD)); assert.equal(s.phase, 'reload');
  const ev = run(s, 1, cmd(B.SWAP)); assert.ok(ev.some(e => e.kind === 'switch' && e.weapon === 'sparrow'));
  assert.equal(s.slot, 1); assert.equal(s.phase, 'switch');
  const pistol = weaponOf(s);
  assert.equal(shots(run(s, pistol.swap - 2, cmd(B.FIRE))), 0, 'no shots while raising');
  run(s, 3, cmd()); assert.equal(s.phase, 'ready');
  assert.ok(s.wpn[0].mag < anvil.mag, 'the cancelled reload did not refill');
  run(s, 1, cmd(B.SLOT1)); assert.equal(s.slot, 0);
});

test('movement: walk, sprint, crouch and aiming speeds; sliding; jumping; walls stop players', () => {
  const s = ready('vanguard'), fwd = { mz: 1 };
  run(s, 60, cmd(0, fwd)); const walk = Math.hypot(s.vx, s.vz);
  assert.ok(Math.abs(walk - SPEED.walk * .97) < .05, `walk ${walk}`);
  run(s, 60, cmd(B.SPRINT, fwd)); const sprint = Math.hypot(s.vx, s.vz);
  assert.ok(sprint > walk * 1.3 && s.sprint);
  const ev = run(s, 1, cmd(B.SPRINT | B.CROUCH, fwd));
  assert.ok(ev.some(e => e.kind === 'slide')); assert.equal(s.stance, 2); assert.ok(Math.hypot(s.vx, s.vz) > sprint);
  run(s, 70, cmd(B.CROUCH, fwd)); assert.equal(s.stance, 1); assert.ok(s.slideCd > 0, 'slides have a cooldown');
  assert.ok(!run(s, 1, cmd(B.SPRINT | B.CROUCH, fwd)).some(e => e.kind === 'slide'), 'no slide while cooling down');
  run(s, 60, cmd(B.CROUCH, fwd)); assert.ok(Math.hypot(s.vx, s.vz) < SPEED.crouch + .01);
  const a = ready('longbow'); run(a, 60, cmd(B.ADS, fwd)); assert.ok(Math.hypot(a.vx, a.vz) < SPEED.walk * .5, 'aiming a sniper is slow');
  // Jump height ~1 m, then land.
  const j = ready('vanguard'); let top = 0; run(j, 1, cmd(B.JUMP)); for (let i = 0; i < 80; i++) { run(j, 1, cmd()); top = Math.max(top, j.y); }
  assert.ok(top > .85 && top < 1.1 && j.y === 0 && j.grounded);
  // Walls: run into the quad's west gate wall and never pass it.
  const w = spawnState({ x: -28, z: 7, yaw: Math.PI / 2 }, loadout('vanguard'));
  run(w, 240, cmd(B.SPRINT, { mz: 1, yaw: Math.PI / 2 }));
  assert.ok(w.x > -30 + .25 - RADIUS - 1e-6 && !overlaps(qWorld, w.x, w.y, w.z, RADIUS, HEIGHT[w.stance]), `stopped at ${w.x}`);
});

test('stairs lead to elevated positions on both maps', () => {
  const f = spawnState({ x: -0.8, z: -5.6, yaw: Math.PI / 2 }, loadout('vanguard'));
  run(f, 95, cmd(0, { mz: 1, yaw: Math.PI / 2 }), ctx(fWorld));
  run(f, 40, cmd(0, { mz: 1, yaw: 0 }), ctx(fWorld));
  assert.ok(Math.abs(f.y - 3.5) < .01 && f.z < -6.4, `on the Foundry catwalk (${f.x.toFixed(2)}, ${f.y}, ${f.z.toFixed(2)})`);
  const q = spawnState({ x: -10.3, z: -23.4, yaw: Math.PI / 2 }, loadout('vanguard'));
  run(q, 120, cmd(0, { mz: 1, yaw: Math.PI / 2 }));
  assert.ok(Math.abs(q.y - 4) < .01, 'on the teaching block upper floor');
});

test('the simulation is deterministic and reconciliation reproduces the server state exactly', () => {
  const inputs = Array.from({ length: 300 }, (_, i) => quantize({ seq: i + 1, b: (i % 40 < 25 ? B.FIRE : 0) | (i % 90 > 60 ? B.SPRINT : 0) | (i === 100 ? B.JUMP : 0) | (i === 150 ? B.RELOAD : 0) | (i === 200 ? B.SWAP : 0),
    mx: Math.sin(i / 17), mz: Math.cos(i / 23), yaw: -Math.PI / 2 + Math.sin(i / 50), pitch: Math.sin(i / 70) * .3 }));
  const server = spawnState({ x: -20, z: -6, yaw: 0 }, loadout('wasp')), client = spawnState({ x: -20, z: -6, yaw: 0 }, loadout('wasp'));
  const evS = [], evC = [];
  for (const c of inputs) { evS.push(...step(server, c, ctx())); evC.push(...step(client, c, ctx())); }
  assert.deepEqual(packState(client), packState(server)); assert.deepEqual(evC, evS, 'same shots, same spread, same recoil');
  // Client prediction: the server acknowledged command 180; the client takes that state and replays 181–300.
  const at180 = spawnState({ x: -20, z: -6, yaw: 0 }, loadout('wasp')); for (const c of inputs.slice(0, 180)) step(at180, c, ctx());
  const wire = JSON.parse(JSON.stringify(packState(at180)));
  const predicted = unpackState(wire, cloneState(client)); for (const c of inputs.slice(180)) step(predicted, c, ctx());
  assert.deepEqual(packState(predicted), packState(server));
});

test('commands are quantised identically on both sides, and malformed commands are rejected', () => {
  const c = quantize({ seq: 7, b: B.FIRE | B.ADS, mx: .333333, mz: -1.7, yaw: 7, pitch: 3 });
  assert.deepEqual(decodeCommand(JSON.parse(JSON.stringify(encodeCommand(c)))), c);
  for (const bad of [null, [], [1, 2, 3], [1, 2, 3, 4, 5, 'x'], [1, 99999, 0, 0, 0, 0], [1, 0, 500, 0, 0, 0], [1, 0, 0, 0, 99999, 0], [1, 0, 0, 0, 0, 99999], [-1, 0, 0, 0, 0, 0], [1.5, 0, 0, 0, 0, 0], { toString: 1 }])
    assert.equal(decodeCommand(bad), null, JSON.stringify(bad));
});

test('spread and recoil come from the simulation: aiming tightens spread, recoil climbs and recovers', () => {
  const s = ready('vanguard'), w = weaponOf(s);
  const hip = spreadOf(s, w); run(s, 30, cmd(B.ADS)); const aimed = spreadOf(s, w);
  assert.ok(aimed < hip / 5, 'aiming down sights is far tighter');
  const ev = run(s, 20, cmd(B.ADS | B.FIRE));
  assert.ok(s.rp > 0, 'recoil climbs while firing');
  const dirs = ev.filter(e => e.kind === 'shot').map(e => e.dirs[0]);
  assert.ok(new Set(dirs.map(d => d.join())).size > 1);
  const climb = s.rp; run(s, 60, cmd(B.ADS)); assert.ok(s.rp < climb, 'and recovers after release');
});

test('ray casts and line of sight respect walls; thin cover is marked for penetration', () => {
  const hit = raycast(qWorld, -33, 1.5, 7, 1, 0, 0, 100);
  assert.ok(hit && Math.abs(hit.t - (3 - .25)) < .01 && hit.normal[0] === -1, 'the gate wall stops a ray');
  assert.equal(lineOfSight(qWorld, -33, 1.5, 7, -27, 1.5, 7), false);
  assert.equal(lineOfSight(qWorld, -33, 1.5, 0, -27, 1.5, 0), true, 'through the gate opening');
  assert.ok(quad.boxes.some(b => b.thin) && foundry.boxes.some(b => b.thin));
});

test('maps: playable bounds, clear spawns and zones, both teams’ halves are mirror images', () => {
  assert.ok(MAPS.length >= 2);
  for (const map of MAPS) {
    const world = createWorld(map.boxes, map.bounds);
    for (const sp of map.spawns) assert.ok(!overlaps(world, sp.x, sp.y ?? 0, sp.z, RADIUS, HEIGHT[0]), `${map.id} spawn ${sp.x},${sp.z} is clear`);
    for (const o of map.objectives) assert.ok(!overlaps(world, o.x, o.y ?? 0, o.z, RADIUS, HEIGHT[0]), `${map.id} zone ${o.id} is clear`);
    assert.equal(map.spawns.filter(s => s.team === 0).length, map.spawns.filter(s => s.team === 1).length);
    const key = b => [b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]].map(v => v.toFixed(3)).join();
    const all = new Set(map.boxes.map(key));
    for (const b of map.boxes) assert.ok(all.has(key({ min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] })), `${map.id}: every box has a mirror across x = 0`);
    for (const t of [0, 1]) for (const sp of map.spawns.filter(s => s.team === t)) assert.ok(map.spawns.some(o => o.team === 1 - t && o.x === -sp.x && o.z === sp.z));
    assert.ok(map.boxes.some(b => b.min[1] >= 3), `${map.id} has elevated platforms`);
  }
});

test('rules: loadouts are validated against unlocks; experience and levels; team balance', () => {
  assert.equal(validateLoadout(PRESETS[0], 1).ok, true);
  assert.match(validateLoadout({ ...PRESETS[0], secondary: 'hammer' }, 1).reason, /level 7/);
  assert.equal(validateLoadout({ ...PRESETS[0], secondary: 'hammer' }, 7).ok, true);
  // Premium Armory weapons need the account to own them, whatever its level.
  assert.match(validateLoadout({ ...PRESETS[0], primary: 'talon' }, 30).reason, /Armory/);
  assert.equal(validateLoadout({ ...PRESETS[0], primary: 'talon' }, 1, {}, ['weapon-talon']).ok, true);
  assert.match(validateLoadout({ ...PRESETS[0], primary: 'sparrow' }, 30).reason, /primary/);
  assert.match(validateLoadout({ ...PRESETS[0], perks: ['fleet'] }, 30).reason, /two different perks/);
  assert.match(validateLoadout({ ...PRESETS[0], skins: { vanguard: 'gilded' } }, 30, { vanguard: 3 }).reason, /weapon level 10/);
  assert.deepEqual(validateLoadout({ ...PRESETS[0], skins: { vanguard: 'tidewater' } }, 30, { vanguard: 3 }).loadout.skins, { vanguard: 'tidewater' });
  for (let l = 1; l < 30; l++) { assert.ok(xpForLevel(l + 1) > xpForLevel(l)); assert.equal(levelFor(xpForLevel(l + 1)), l + 1); assert.equal(levelFor(xpForLevel(l + 1) - 1), l); }
  assert.equal(matchXp({ kills: 10, headshots: 2, result: 'win', completed: true }), 1000 + 50 + 600);
  assert.equal(matchXp({ kills: 10, result: 'win', completed: false }), 1000, 'leaving early forfeits the outcome bonus');
  assert.equal(balanceTeam([3, 2], [0, 0]), 1); assert.equal(balanceTeam([2, 2], [5, 1]), 1);
  assert.deepEqual(MODES.map(m => m.id), ['tdm', 'dom']);
  assert.ok(STREAKS.every(s => s.cost >= 3), 'rewards need several points');
  assert.equal(new Set(CATALOG.map(c => c.id)).size, CATALOG.length, 'catalogue ids are unique');
});
