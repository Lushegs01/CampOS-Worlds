// Combat Arena audio: the logic that decides what plays and when (variation, reload timelines, gait, surfaces,
// reactions) and the contract between the game and its sound banks (every sound the game can ask for exists, the
// banks are within budget, and the built clips passed quality control).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createBag, createBags, prng, jitter } from '../src/arena/sound/variation.mjs';
import { RELOADS, reloadPlan, SHELL, CYCLES, crossed } from '../src/arena/sound/reloads.mjs';
import { createGait, createRemoteGait, gaitOf, STRIDE } from '../src/arena/sound/gait.mjs';
import { STEP_SURFACES, stepSurfaceOf, impactSurfaceOf, groundSurface, mapSurfaces, isStair } from '../src/arena/sound/surfaces.mjs';
import { createReactions, severity, voiceFor, bodyPart, VOICES_MALE } from '../src/arena/sound/reactions.mjs';
import { WEAPONS, WEAPON_BY_ID } from '../shared/arena/weapons.mjs';
import { MAPS, MAP_BY_ID } from '../shared/arena/maps.mjs';

const FIREARMS = WEAPONS.filter(w => w.fire !== 'melee');
const MAG = FIREARMS.filter(w => w.reloadMode === 'mag');

// ---------------------------------------------------------------- variation
test('a shuffle bag never plays the same variant twice in a row and plays each as often as the others', () => {
  for (const n of [2, 3, 5, 8]) {
    const bag = createBag(n, prng(n * 31)), seen = new Array(n).fill(0);
    let last = -1;
    for (let i = 0; i < n * 200; i++) { const v = bag.next(); assert.notEqual(v, last, `n=${n}: repeated ${v}`); seen[v]++; last = v; }
    assert.ok(Math.max(...seen) - Math.min(...seen) <= 1, `n=${n}: uneven ${seen}`);
  }
  assert.equal(createBag(1).next(), 0);
  const bags = createBags(prng(7)); assert.notEqual(bags.next('a', 4), bags.next('a', 4));
});
test('variation stays small and plausible: rate within ±2 %, level within ±1 dB', () => {
  const r = prng(3);
  for (let i = 0; i < 2000; i++) { const j = jitter(r, .02, 1); assert.ok(j.rate >= .98 && j.rate <= 1.02); assert.ok(20 * Math.log10(j.gain) >= -1.0001 && 20 * Math.log10(j.gain) <= 1.0001); }
});

// ---------------------------------------------------------------- reloads
test('every magazine-fed firearm has its own tactical and empty reload plan', () => {
  for (const w of MAG) {
    assert.ok(RELOADS[w.id], `${w.id} has no reload plan`);
    for (const empty of [false, true]) {
      const p = reloadPlan(w.id, empty), times = p.cues.map(c => c[0]);
      assert.deepEqual(times, [...times].sort((a, b) => a - b), `${w.id}: cues out of order`);
      assert.ok(times.every(t => t > 0 && t < 1), `${w.id}: cue outside the reload`);
      assert.ok(p.tilt[0] < p.tilt[1] && p.tilt[1] < p.tilt[2] && p.tilt[2] < p.tilt[3], `${w.id}: tilt keys`);
    }
  }
  assert.equal(reloadPlan('bastion', false), null, 'shell-by-shell has its own cycle');
  assert.equal(reloadPlan('knife', false), null);
});
test('tactical reloads keep the round chambered; reloads from empty drop the magazine and work the action', () => {
  const CHAMBER = /boltRelease|charge|bolt(Lift|Back|Fwd|Down)|slideDrop/;
  for (const w of MAG) {
    if (w.id === 'thorn') continue; // a revolver has no chamber to work
    const t = reloadPlan(w.id, false), e = reloadPlan(w.id, true);
    assert.equal(t.rack, null, `${w.id}: a tactical reload should not rack`);
    assert.ok(!t.cues.some(c => CHAMBER.test(c[1])), `${w.id}: tactical reload works the action`);
    assert.ok(t.cues.some(c => c[1] === 'pouch'), `${w.id}: the old magazine goes to a pouch`);
    assert.ok(e.cues.some(c => CHAMBER.test(c[1])), `${w.id}: an empty reload must chamber a round`);
    assert.ok(e.cues.some(c => c[1] === 'magDrop'), `${w.id}: an empty magazine is dropped`);
    // Sound and animation agree: the action is worked inside the animation's rack window; the magazine leaves as the
    // animation pulls it and goes in while the animation inserts it.
    for (const [at, cue] of e.cues.filter(c => CHAMBER.test(c[1]))) assert.ok(at >= e.rack[0] - .02 && at <= e.rack[1] + .02, `${w.id} ${cue} at ${at} outside rack ${e.rack}`);
    for (const p of [t, e]) {
      const out = p.cues.find(c => c[1] === 'magOut')?.[0], inn = p.cues.find(c => c[1] === 'magIn')?.[0], seat = p.cues.find(c => c[1] === 'magSeat')?.[0];
      assert.ok(out >= p.out[0] - .03 && out <= p.out[1], `${w.id}: magOut ${out} vs out ${p.out}`);
      assert.ok(inn >= p.in[0] && inn <= p.in[1] + .02, `${w.id}: magIn ${inn} vs in ${p.in}`);
      assert.ok(Math.abs(seat - p.seat) < .02, `${w.id}: seat sound ${seat} vs tap ${p.seat}`);
    }
  }
  const lmg = reloadPlan('anvil', false).cues.map(c => c[1]);
  assert.ok(lmg.indexOf('coverOpen') < lmg.indexOf('magOut') && lmg.indexOf('belt') < lmg.indexOf('coverClose'), 'belt-fed order');
  const rev = reloadPlan('thorn', true).cues.map(c => c[1]);
  assert.deepEqual(rev.filter(c => /cyl|eject|speedload/.test(c)), ['cylOpen', 'eject', 'speedload', 'cylClose']);
});
test('pump and bolt cycles: back, the case thrown out, forward — inside the animation stroke', () => {
  for (const [id, cues] of Object.entries(CYCLES)) {
    const names = cues.map(c => c[1]), back = names.findIndex(c => /Back/.test(c)), fwd = names.findIndex(c => /Fwd/.test(c));
    assert.ok(back >= 0 && fwd > back && names.indexOf('case') > back && names.indexOf('case') < fwd, id);
    assert.ok(WEAPON_BY_ID.get(id).fire === 'bolt' || WEAPON_BY_ID.get(id).reloadMode === 'shell');
  }
  assert.deepEqual(SHELL.each.map(c => c[1]), ['shellGrab', 'shellIn']);
  assert.deepEqual(crossed([[.2, 'a'], [.5, 'b'], [.8, 'c']], .2, .8).map(c => c[1]), ['b', 'c']);
  assert.deepEqual(crossed([[.2, 'a']], .5, .4), [], 'never backwards');
});

// ---------------------------------------------------------------- gait
test('the player\'s footsteps follow the gait: cadence from speed, nothing standing or airborne', () => {
  const run = (speed, seconds, o = {}) => { const g = createGait(); let n = 0; for (let t = 0; t < seconds; t += 1 / 60) if (g.update(1 / 60, speed, 0, o.grounded ?? true, !!o.sprint, !!o.crouch, false).step) n++; return n; };
  const walk = run(4.6, 2), expect = 2 * 4.6 * 1.75 / Math.PI;
  assert.ok(Math.abs(walk - expect) <= 1, `walking ${walk} vs ${expect.toFixed(1)}`);
  assert.equal(run(0, 3), 0, 'standing still: no steps');
  assert.equal(run(5, 2, { grounded: false }), 0, 'airborne: no steps');
  const sprint = run(6.8, 2, { sprint: true }); assert.ok(sprint >= 5 && sprint <= 7, `sprint ${sprint}`);
  assert.equal(gaitOf(2, {}), 'soft'); assert.equal(gaitOf(4.5, {}), 'walk'); assert.equal(gaitOf(6.5, { sprint: true }), 'run'); assert.equal(gaitOf(4, { crouch: true }), 'soft');
});
test('a hard stop and a sharp turn make their scuff once', () => {
  const g = createGait(); let stops = 0, turns = 0;
  for (let i = 0; i < 60; i++) g.update(1 / 60, 6, 0, true, true, false, false);
  for (let i = 0; i < 30; i++) { const e = g.update(1 / 60, 0, 0, true, false, false, false); if (e.stop) stops++; }
  assert.equal(stops, 1);
  for (let i = 0; i < 60; i++) g.update(1 / 60, 5, 0, true, false, false, false);
  for (let i = 0; i < 30; i++) { const e = g.update(1 / 60, -5, 0, true, false, false, false); if (e.turn) turns++; }
  assert.equal(turns, 1);
});
test('other players step once per stride of the gait their soldier animates', () => {
  const g = createRemoteGait(); let n = 0, x = 0;
  for (let t = 0; t < 3; t += 1 / 60) { x += 4 / 60; if (g.update(x, 0, 1 / 60, 1 | 256).step) n++; }
  assert.ok(Math.abs(n - 12 / STRIDE.jog) <= 1.5, `jog ${n} vs ${(12 / STRIDE.jog).toFixed(1)}`);
  const air = createRemoteGait(); let m = 0, y = 0;
  for (let t = 0; t < 1; t += 1 / 60) { y += 5 / 60; if (air.update(y, 0, 1 / 60, 1).step) m++; }
  assert.equal(m, 0, 'not grounded: no steps');
  const tp = createRemoteGait(); tp.update(0, 0, 1 / 60, 257); assert.equal(tp.update(30, 0, 1 / 60, 257).step, null, 'teleport');
});

// ---------------------------------------------------------------- surfaces
test('surfaces come from the map: painted ground zones and box materials', () => {
  const f = MAP_BY_ID.get('foundry'), [x0, z0, x1, z1] = f.bounds;
  assert.equal(groundSurface(f.bounds, 0, z1 - 8), 'asphalt'); assert.equal(groundSurface(f.bounds, 0, z0 + 8), 'asphalt');
  const edge = []; for (let z = z0 + 16; z < z1 - 16; z += 1) edge.push(groundSurface(f.bounds, x0 + 3, z), groundSurface(f.bounds, x1 - 3, z));
  assert.deepEqual([...new Set(edge)].sort(), ['dirt', 'gravel'], 'the margins are gravel, with the dirt patches drawn over parts of it');
  const kinds = new Set(); for (let x = x0 + 8; x < x1 - 8; x += 1) for (let z = z0 + 16; z < z1 - 16; z += 1) kinds.add(groundSurface(f.bounds, x, z));
  assert.deepEqual([...kinds].sort(), ['concrete', 'dirt']);
  assert.ok(mapSurfaces(f).includes('metal') && mapSurfaces(f).includes('container') && mapSurfaces(f).includes('wood') && mapSurfaces(f).includes('sand'));
  assert.ok(mapSurfaces(MAP_BY_ID.get('quad')).includes('stone') && mapSurfaces(MAP_BY_ID.get('quad')).includes('wood'));
  for (const m of MAPS) for (const b of m.boxes) assert.ok(STEP_SURFACES.includes(stepSurfaceOf(b.mat)), b.mat);
  assert.equal(impactSurfaceOf('container-red'), 'sheet'); assert.equal(impactSurfaceOf('brick'), 'brick'); assert.equal(impactSurfaceOf('hedge'), 'foliage'); assert.equal(impactSurfaceOf(undefined), 'dirt');
  const stairs = MAPS.flatMap(m => m.boxes).filter(isStair); assert.ok(stairs.length >= 20, `stairs ${stairs.length}`);
  assert.ok(!isStair({ min: [0, 0, 0], max: [10, 3, .5] }), 'a wall is not a stair');
});

// ---------------------------------------------------------------- reactions
test('hit reactions follow validated damage: severity, merging, no stammer, no duplicates, one death per life', () => {
  assert.equal(severity(2, 90), null); assert.equal(severity(20, 70), 'hurt'); assert.equal(severity(40, 50), 'heavy'); assert.equal(severity(25, 20), 'severe');
  const r = createReactions();
  assert.equal(r.hit(7, 22, 78, 0), 'hurt');
  assert.equal(r.hit(7, 22, 56, .2), null, 'another light hit soon after does not grunt again…');
  assert.equal(r.hit(7, 44, 34, .25), 'heavy', '…but a heavier one does');
  assert.equal(r.hit(7, 44, 34, .26), null, 'the same report twice');
  assert.equal(r.hit(7, 12, 12, .5), 'severe', 'low health interrupts');
  assert.equal(r.hit(8, 30, 0, .2), null, 'an elimination is its own reaction');
  assert.equal(r.death(8, 1, .2), 'death'); assert.equal(r.death(8, 1, .3), null); assert.equal(r.death(8, 2, 9), 'death');
  assert.equal(voiceFor(5, 'soldier-f1'), 'fA'); assert.equal(voiceFor(4, 'soldier-m2'), voiceFor(4, 'soldier-m2'));
  assert.ok(new Set(Array.from({ length: 40 }, (_, i) => voiceFor(i, 'soldier-m1'))).size >= 3, 'male voices vary between players');
  assert.ok(VOICES_MALE.includes(voiceFor(1, 'soldier-m1')));
  assert.equal(bodyPart(1.7), 'helmet'); assert.equal(bodyPart(1.2), 'armour'); assert.equal(bodyPart(.6), 'flesh');
});

// ---------------------------------------------------------------- the banks
const MANIFEST = 'public/assets/arena/audio/manifest.json';
test('every sound the game can ask for exists in the built banks', { skip: !existsSync(MANIFEST) && 'banks not built' }, () => {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8')), has = s => { const i = s.indexOf('/'); return !!m.banks[s.slice(0, i)]?.sounds[s.slice(i + 1)]?.length; };
  const need = [];
  for (const w of FIREARMS) {
    for (const s of ['shot', 'tail', 'mid', 'far', 'dry', 'raise']) need.push(`w.${w.id}/${s}`);
    assert.ok(m.banks['w.' + w.id].meta?.tailAt > 0, `${w.id} tail offset`);
    const cues = [...(reloadPlan(w.id, false)?.cues ?? []), ...(reloadPlan(w.id, true)?.cues ?? []), ...(CYCLES[w.id] ?? []), ...(w.reloadMode === 'shell' ? [...SHELL.start, ...SHELL.each] : [])];
    for (const [, c] of cues) {
      if (['magDrop', 'cases', 'case'].includes(c)) continue;
      const mapped = c === 'shellGrab' ? 'grab' : c === 'belt' ? 'settle' : c;
      assert.ok(has(`w.${w.id}/${c}`) || has(`handling/${mapped}`), `${w.id}: cue ${c} has no sound`);
    }
  }
  for (const s of STEP_SURFACES) for (const g of ['walk', 'run', 'soft', 'scuff', 'land']) need.push(`steps.${s}/${g}`);
  for (const v of [...VOICES_MALE, 'fA']) for (const k of ['hurt', 'heavy', 'severe', 'death', 'effort']) need.push(`voice.${v}/${k}`);
  for (const k of ['concrete', 'brick', 'metal', 'sheet', 'wood', 'dirt', 'sand', 'foliage', 'glass', 'flesh', 'armour', 'helmet', 'ricochet', 'snap', 'whiz', 'casePistol', 'caseRifle', 'caseLarge', 'caseShell', 'caseSoft', 'magDrop', 'magDropSoft']) need.push('impacts/' + k);
  for (const k of ['pouch', 'grab', 'settle', 'ads', 'swap', 'drawBlade', 'swingKnife', 'swingHeavy', 'swingRifle', 'stab', 'chop', 'butt', 'pin', 'spoon', 'throwArm', 'resupply']) need.push('handling/' + k);
  for (const k of ['blastNear', 'blastMid', 'blastFar', 'debris', 'flashBang', 'smokePop', 'smokeHiss', 'bounce', 'bounceSoft', 'stick', 'beep', 'crate', 'alarm']) need.push('explosives/' + k);
  for (const k of ['cloth', 'leather', 'gearLight', 'gearHeavy', 'whoosh', 'slideHard', 'slideSoft', 'bodyfall', 'spawn']) need.push('movement/' + k);
  need.push('breath.m/loop', 'breath.f/loop');
  for (const k of ['click', 'hover', 'confirm', 'select', 'back', 'toggle', 'tick', 'error', 'purchase', 'equip', 'hit', 'headshot', 'kill', 'medal', 'streak', 'countdown', 'notify', 'ping']) need.push('ui/' + k);
  for (const k of ['three', 'two', 'one', 'go', 'win', 'lose', 'draw', 'secured', 'lost', 'contested', 'losing', 'supply', 'strikeOurs', 'strikeTheirs', 'uav', 'grenade', 'grenadeF']) need.push('vo/' + k);
  for (const map of MAPS) for (const k of ['wind', 'district', 'interior', 'machine', 'hum', 'creak', 'clank', 'chain', 'flag']) need.push(`amb.${map.ambience ?? map.id}/${k}`);
  const missing = need.filter(s => !has(s));
  assert.deepEqual(missing, []);
  // Weapons sound like themselves: no two firearms share a recording for their shots.
  const firsts = FIREARMS.map(w => JSON.stringify(m.banks['w.' + w.id].sounds.shot[0]) + w.id);
  assert.equal(new Set(firsts).size, FIREARMS.length);
});
test('the banks are complete on disk, within budget, and every clip is inside its sprite', { skip: !existsSync(MANIFEST) && 'banks not built' }, () => {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  let bytes = 0;
  for (const [name, b] of Object.entries(m.banks)) {
    for (const f of b.files) { const p = 'public/assets/arena/audio/' + f.file; assert.ok(existsSync(p), p); assert.equal(statSync(p).size, f.bytes, p); bytes += f.bytes; }
    for (const [s, list] of Object.entries(b.sounds)) for (const [fi, start, dur, peak] of list) {
      const f = b.files[fi]; assert.ok(f, `${name}/${s}`); assert.ok(start >= 0 && dur > 0 && start + dur <= f.seconds + .001, `${name}/${s} outside its sprite`);
      assert.ok(peak >= 0 && peak <= dur + .005, `${name}/${s} peak time`);
    }
  }
  assert.ok(bytes < 6 * 1048576, `banks total ${(bytes / 1048576).toFixed(2)} MB`);
  // What a typical match downloads (two weapons, the map's ground, movement, impacts, explosives, voices, announcer,
  // interface, ambience) stays small.
  const size = n => m.banks[n].files.reduce((a, f) => a + f.bytes, 0);
  const typical = ['ui', 'vo', 'handling', 'impacts', 'explosives', 'movement', 'w.vanguard', 'w.sparrow', 'steps.concrete', 'steps.asphalt', 'steps.gravel', 'steps.dirt', 'voice.mA', 'voice.mB', 'amb.foundry'].reduce((a, n) => a + size(n), 0);
  assert.ok(typical < 2.2 * 1048576, `typical match ${(typical / 1048576).toFixed(2)} MB`);
});
test('quality control of the built clips: no clipping, no DC, no abrupt endings, no late attacks or noisy clips (by-design traits are notes)', { skip: !existsSync('docs/audio/qc.json') && 'banks not built' }, () => {
  const qc = JSON.parse(readFileSync('docs/audio/qc.json', 'utf8'));
  assert.ok(qc.clips.length > 500);
  const bad = qc.clips.filter(r => r.flags.length);
  assert.deepEqual(bad.map(r => `${r.bank}/${r.sound}: ${r.flags.join(', ')}`), []);
  assert.ok(qc.clips.every(r => r.peakDb <= -.5), 'every clip peaks below −0.5 dBFS after encoding');
});
