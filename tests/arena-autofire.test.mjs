// Combat Arena auto-fire (shared/arena/autofire.mjs): it presses the trigger only while the player's own aim
// is on a valid, visible enemy with a clear line of fire, and the shared simulation still enforces fire rate,
// ammunition and reloads exactly as for manual fire. Also the setting itself: off by default, persisted, and
// a public per-playlist policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoFireDecision, rayHitsPlayer } from '../shared/arena/autofire.mjs';
import { step, spawnState, B, quantize } from '../shared/arena/sim.mjs';
import { createWorld } from '../shared/arena/physics.mjs';
import { WEAPON_BY_ID } from '../shared/arena/weapons.mjs';
import { PRESETS, AUTO_FIRE_POLICY, autoFireAllowed } from '../shared/arena/rules.mjs';
import { defaultArenaSettings, parseArenaSettings, DEFAULT_AUTO_FIRE, syncedSettings } from '../shared/arena/settings.mjs';

const BOUNDS = [-60, -60, 60, 60];
const open = createWorld([], BOUNDS);
// A wall across the line of fire, 8 m ahead (yaw 0 faces −z).
const walled = createWorld([{ min: [-3, 0, -9], max: [3, 3, -8] }], BOUNDS);
const LOADOUT = { ...PRESETS[0] }; // Vanguard AR-7 (automatic)
function player(loadout = LOADOUT) {
  const s = spawnState({ x: 0, z: 0, yaw: 0 }, loadout, new Set());
  const ctx = { world: open, perks: new Set(), seed: 7, num: 1 };
  for (let i = 0; i < 60; i++) step(s, quantize({ seq: i, b: 0, mx: 0, mz: 0, yaw: 0, pitch: 0 }), ctx); // finish drawing the weapon
  return { s, ctx };
}
const enemy = (z, extra = {}) => ({ team: 1, alive: true, visible: true, x: 0, y: 0, z, flags: 1, ...extra });
const decide = (s, targets, extra = {}) => autoFireDecision({ sim: s, view: { yaw: 0, pitch: 0 }, targets, world: open, team: 0, ...extra });

test('the setting: off by default, kept when saved, and a public, uniform policy per playlist', () => {
  assert.equal(DEFAULT_AUTO_FIRE, false); assert.equal(defaultArenaSettings().autoFire, false);
  assert.equal(parseArenaSettings(JSON.parse(JSON.stringify({ ...defaultArenaSettings(), autoFire: true }))).autoFire, true);
  assert.equal(parseArenaSettings({ autoFire: 'yes' }).autoFire, false, 'only a real boolean turns it on');
  assert.equal(syncedSettings({ ...defaultArenaSettings(), autoFire: true }).autoFire, true, 'synchronised with the account');
  assert.deepEqual(AUTO_FIRE_POLICY, { quick: true, private: true, training: true });
  assert.equal(autoFireAllowed('ranked'), false, 'an unlisted playlist does not allow it');
});

test('fires only at a valid, visible enemy under the player’s own aim, never at teammates or through walls', () => {
  const { s } = player();
  assert.equal(decide(s, [enemy(-20)]).fire, true);
  assert.equal(decide(s, [enemy(-20, { x: 3 })]).fire, false, 'aim is the player’s: an enemy beside the crosshair is not a target');
  assert.equal(decide(s, [enemy(-20)], { view: { yaw: .5, pitch: 0 } }).fire, false, 'looking elsewhere: no fire, and the view is never turned');
  assert.equal(decide(s, [enemy(-20, { team: 0 })]).fire, false, 'teammate');
  assert.equal(decide(s, [enemy(-12, { team: 0 }), enemy(-20)]).reason, 'teammate in the line of fire');
  assert.equal(decide(s, [enemy(-20, { alive: false })]).fire, false, 'eliminated');
  assert.equal(decide(s, [enemy(-20, { visible: false })]).fire, false, 'not currently visible');
  assert.equal(decide(s, [enemy(-20)], { world: walled }).reason, 'obstructed', 'no shooting through walls');
  assert.equal(decide(s, [enemy(-6)], { world: walled }).fire, true, 'an enemy in front of the wall is fine');
  assert.equal(decide(s, [enemy(-200)]).reason, 'out of range');
  assert.equal(decide(s, [enemy(-20, { flags: 1 | 2 })]).fire, false, 'a crouching enemy is lower than a standing aim at head height… ');
  assert.equal(decide(s, [enemy(-20, { flags: 1 | 2 })], { view: { yaw: 0, pitch: -.03 } }).fire, true, '…until the player aims at them');
  assert.ok(rayHitsPlayer(0, 1.62, 0, 0, 0, -1, 0, 0, -10, 1.8) < 10);
});

test('respects the weapon: reloading, switching, empty magazine, sprinting and melee stop it', () => {
  const { s } = player();
  for (const [patch, reason] of [[{ phase: 'reload' }, 'reload'], [{ phase: 'switch' }, 'switch'], [{ sprint: true }, 'sprinting']]) {
    const copy = { ...s, wpn: s.wpn.map(w => ({ ...w })), ...patch }; assert.equal(decide(copy, [enemy(-20)]).reason, reason);
  }
  const empty = { ...s, wpn: s.wpn.map(w => ({ ...w, mag: 0 })) }; assert.equal(decide(empty, [enemy(-20)]).reason, 'magazine empty');
  assert.equal(decide(s, [enemy(-20)], { held: B.SPRINT }).reason, 'sprinting', 'holding sprint is the player choosing to move');
  const knife = { ...s, slot: 1 }; assert.equal(decide(knife, [enemy(-1.5)]).reason, 'melee weapon');
});

/**
 * Run the real simulation for `ticks`, pressing FIRE when auto-fire says so (plus any manual buttons). The
 * player steers against recoil as a person does (auto-fire never does that for them).
 */
function run(s, ctx, targets, ticks, { manual = 0, auto = true } = {}) {
  let shots = 0, reloads = 0;
  for (let i = 0; i < ticks; i++) {
    const view = { yaw: -s.ry, pitch: -s.rp };
    const want = auto && decide(s, targets, { held: manual, view }).fire;
    const ev = step(s, quantize({ seq: 1000 + i, b: manual | (want ? B.FIRE : 0), mx: 0, mz: 0, ...view }), ctx);
    shots += ev.filter(e => e.kind === 'shot').length; reloads += ev.filter(e => e.kind === 'reload').length;
  }
  return { shots, reloads };
}

test('fire-rate and ammunition limits apply exactly as for manual fire, and it never reloads for the player', () => {
  // One second on target with an automatic rifle: the same number of rounds as holding the trigger.
  const a = player(), m = player();
  const autoShots = run(a.s, a.ctx, [enemy(-20)], 60).shots, manualShots = run(m.s, m.ctx, [], 60, { manual: B.FIRE, auto: false }).shots;
  assert.equal(autoShots, manualShots); assert.ok(autoShots <= Math.ceil(WEAPON_BY_ID.get('vanguard').rpm / 60) + 1);
  // Emptying the magazine: it stops at zero and does not start a reload (that stays the player's call).
  const e = player(); const r = run(e.s, e.ctx, [enemy(-20)], 60 * 5);
  assert.equal(r.shots, WEAPON_BY_ID.get('vanguard').mag); assert.equal(r.reloads, 0); assert.equal(e.s.wpn[0].mag, 0);
  // Semi-automatic weapons: one shot per trigger press, never faster than the weapon's rate.
  const semi = player({ ...PRESETS[0], primary: 'talon' }); const t = run(semi.s, semi.ctx, [enemy(-30)], 60 * 2);
  const rpm = WEAPON_BY_ID.get('talon').rpm; assert.ok(t.shots >= 2 && t.shots <= Math.ceil(rpm / 30) + 1, `${t.shots} shots in 2 s at ${rpm} rpm`);
});

test('recoil is the player’s to control: if they do not pull down, the climbing aim leaves the target and auto-fire stops', () => {
  const p = player(); let shots = 0;
  for (let i = 0; i < 60; i++) { const want = decide(p.s, [enemy(-20)]).fire; shots += step(p.s, quantize({ seq: 2000 + i, b: want ? B.FIRE : 0, mx: 0, mz: 0, yaw: 0, pitch: 0 }), p.ctx).filter(e => e.kind === 'shot').length; }
  const held = player(); let manual = 0;
  for (let i = 0; i < 60; i++) manual += step(held.s, quantize({ seq: 2000 + i, b: B.FIRE, mx: 0, mz: 0, yaw: 0, pitch: 0 }), held.ctx).filter(e => e.kind === 'shot').length;
  assert.ok(shots < manual, `${shots} auto-fired vs ${manual} held: auto-fire does not compensate recoil`);
});

test('stops the moment the target is lost, and manual fire keeps working with it on or off', () => {
  const p = player(); const targets = [enemy(-20)];
  assert.ok(run(p.s, p.ctx, targets, 10).shots > 0);
  targets[0].x = 4; // the enemy steps out of the line of fire
  const before = p.s.wpn[0].mag; assert.equal(run(p.s, p.ctx, targets, 30).shots, 0); assert.equal(p.s.wpn[0].mag, before);
  targets[0].x = 0; targets[0].alive = false; assert.equal(run(p.s, p.ctx, targets, 30).shots, 0, 'eliminated: stop');
  // Manual fire with no target at all still shoots (auto-fire only ever adds the trigger).
  const q = player(); assert.ok(run(q.s, q.ctx, [], 30, { manual: B.FIRE }).shots > 0);
});
