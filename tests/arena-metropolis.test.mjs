import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MAP_BY_ID } from '../shared/arena/maps.mjs';
import { TRAIN, trainAt, districtAt } from '../shared/arena/metropolis.mjs';
import { createWorld, overlaps } from '../shared/arena/physics.mjs';
import { spawnState, step, quantize, encodeCommand, B } from '../shared/arena/sim.mjs';
import { PRESETS } from '../shared/arena/rules.mjs';
import { navigation } from '../server/arena/bots.mjs';
import { createMatch } from '../server/arena/match.mjs';
const map = MAP_BY_ID.get('metropolis');
const world = createWorld(map.boxes, map.bounds);
function fixture({ kind = 'private', mode = 'tdm', variant = 'night', start = true } = {}) {
  let now = 100000; const events = [];
  const m = createMatch({ id: 'metro-test', map, mode, kind, variant, autoTick: false, clock: () => now,
    rules: { countdownMs: 0, spawnProtectMs: 0, abandonMs: 1000000, mode: { scoreLimit: 10000, timeMs: 600000, captureMs: 100 } },
    send: (p, e) => { if (p.num === 1 && e.t === 'e') events.push(...e.l); }, sendRaw: () => {} });
  const p = m.join({ id: 'p', name: 'Player' }); const other = m.join({ id: 'q', name: 'Other' });
  const advance = (ms = 17) => { now += ms; m.tick(); };
  if (kind === 'private' && start) { m.hostStart(p); advance(); }
  return { m, p, other, events, advance, now: () => now };
}
test('Metropolis geometry and spawns are valid, symmetric, and remain at street level under simulation', () => {
  const key = b => JSON.stringify([b.min, b.max, b.mat]); const all = new Set(map.boxes.map(key));
  for (const b of map.boxes) {
    assert.ok(b.min.every((v, i) => Number.isFinite(v) && v < b.max[i]), b.mat);
    assert.ok(all.has(key({ min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]], mat: b.mat })), `mirror: ${key(b)}`);
  }
  for (const sp of map.spawns) {
    assert.equal(overlaps(world, sp.x, sp.y, sp.z, .3, 1.75), false);
    const s = spawnState(sp, PRESETS[0]);
    for (let i = 0; i < 90; i++) step(s, quantize({ seq: i + 1, b: 0, mx: 0, mz: 0, yaw: sp.yaw, pitch: 0 }), { world, seed: 4, num: 1, perks: new Set() });
    assert.ok(Math.abs(s.y - 5) < .01, `spawn ${JSON.stringify(sp)} fell to ${s.y}`);
  }
});
test('both teams can navigate to objectives, rooftops, station and warehouse mezzanine', () => {
  const nav = navigation(map);
  for (const side of [-1, 1]) {
    const start = nav.near(side * 56.5, 5, -27);
    for (const p of [[0, 5, -34.4], [0, 5, 2.4], [0, 5, 31], [side * 40, 12, -35], [side * 20, 1, 0], [side * 32, 8.5, 35]]) {
      const path = nav.path(start, nav.near(...p)); assert.ok(path?.length, `no route to ${p}`);
      assert.ok(path.every(n => !overlaps(world, n.x, n.y, n.z, .3, 1.75)));
    }
  }
  assert.deepEqual([districtAt(0,5,-25),districtAt(-40,12,-35),districtAt(0,1,0),districtAt(0,5,31),districtAt(0,5,2)], ['downtown','rooftops','underground','industrial','plaza']);
});
test('the train warns first, crosses in alternating directions, then leaves', () => {
  assert.equal(trainAt(TRAIN.firstMs - TRAIN.warnMs - 1), null);
  assert.equal(trainAt(TRAIN.firstMs - TRAIN.warnMs).warning, true);
  const t = trainAt(TRAIN.firstMs + 7000); assert.equal(t.warning, false); assert.equal(t.x1 - t.x0, TRAIN.length);
  assert.equal(trainAt(TRAIN.firstMs + TRAIN.periodMs + 7000).dir, -1);
  assert.equal(trainAt(TRAIN.firstMs + 30000), null);
});
test('Quick Play enforces daylight while private matches validate weather and preserve elevated spawn events', () => {
  for (const [kind, variant, expected] of [['quick','night','day'],['private','night','night'],['private','invalid','day']]) {
    const f = fixture({kind,variant});
    assert.equal(f.m.view().variant, expected);
    f.m.flush(); assert.ok(f.events.filter(e => e.k === 'spawn').every(e => e.y === 5));
    f.m.close();
  }
});
test('server shots break glass once and reconnect views carry its state', () => {
  const f = fixture(); const g = map.glass.find(g => !g.alongZ && g.min[2] < -32 && g.min[1] < 6);
  assert.ok(g);
  const fire = () => {
    Object.assign(f.p.sim, { x: (g.min[0]+g.max[0])/2, y: 5, z: -30, yaw: 0, pitch: 0, phase: 'ready', pt: 0, rp: 0, ry: 0 });
    f.m.commands(f.p, [encodeCommand(quantize({seq: f.p.lastSeq+1,b:B.FIRE,mx:0,mz:0,yaw:0,pitch:0}))]);
  };
  fire(); assert.ok(f.m.broken.has(g.i)); assert.ok(f.m.view().broken.includes(g.i));
  f.advance(200); fire(); assert.equal(f.events.filter(e=>e.k==='glass' && e.i===g.i).length,1);
  f.m.close();
});
test('the train kills a player on the track, leaves the platform and street safe, and announces once per pass', () => {
  const f = fixture();
  Object.assign(f.p.sim, { x: 0, y: 0, z: 3.5 }); Object.assign(f.other.sim, { x: 0, y: 1, z: 0 });
  f.advance(TRAIN.firstMs - TRAIN.warnMs); assert.equal(f.events.filter(e=>e.k==='train').length,1);
  assert.equal(f.p.alive,true);
  f.advance(TRAIN.warnMs + 7000); assert.equal(f.p.alive,false); assert.equal(f.other.alive,true);
  assert.equal(f.events.filter(e=>e.k==='train').length,1); assert.ok(f.m.trainBox(f.now()));
  f.m.close();
});
test('Domination cannot be captured from the station directly below a street objective', () => {
  const f = fixture({ mode:'dom' });
  Object.assign(f.p.sim, {x:0,y:1,z:0});
  for(let i=0;i<30;i++) f.advance();
  assert.equal(f.m.objectives[1].owner,-1);
  Object.assign(f.p.sim, {x:0,y:5,z:2.4});
  for(let i=0;i<30;i++) f.advance();
  assert.equal(f.m.objectives[1].owner,f.p.team); f.m.close();
});
test('all city manifest assets have full and mobile files with source attribution', () => {
  const m = JSON.parse(readFileSync('public/assets/arena/metropolis.json','utf8'));
  for (const a of [...m.textures, ...m.props]) { assert.ok(a.source.startsWith('https://polyhaven.com/a/')); assert.ok(a.author); assert.equal(a.license, 'CC0 1.0'); }
  for(const {key} of m.textures) for(const tier of ['', 'mobile/']) for(const slot of ['color','normal','arm']) assert.ok(existsSync(`public/assets/arena/${tier}textures/${key}/${slot}.ktx2`));
  for(const {key} of m.props) for(const tier of ['', 'mobile/']) assert.ok(existsSync(`public/assets/arena/${tier}props/${key}.glb`));
});

test('round start resets warm-up glass for connected clients', () => {
  const f = fixture({start:false}), g = map.glass.find(g=>!g.alongZ&&g.min[2]<-32&&g.min[1]<6);
  Object.assign(f.p.sim,{x:(g.min[0]+g.max[0])/2,y:5,z:-30,yaw:0,pitch:0,phase:'ready',pt:0});
  f.m.commands(f.p,[encodeCommand(quantize({seq:1,b:B.FIRE,mx:0,mz:0,yaw:0,pitch:0}))]);
  assert.ok(f.m.broken.size>0); f.m.hostStart(f.p); f.advance();
  assert.equal(f.m.broken.size,0); assert.ok(f.events.some(e=>e.k==='glass'&&e.reset===1)); f.m.close();
});
test('a passing train blocks authoritative gunfire between platforms', () => {
  const f = fixture(); f.advance(TRAIN.firstMs + 7000);
  Object.assign(f.p.sim,{x:5,y:1,z:0,yaw:Math.PI,pitch:0,phase:'ready',pt:0});
  Object.assign(f.other.sim,{x:5,y:1,z:7,yaw:0,pitch:0,phase:'ready',pt:0}); f.other.history=[];
  for(let i=0;i<4;i++) { f.m.commands(f.p,[encodeCommand(quantize({seq:i+1,b:B.FIRE,mx:0,mz:0,yaw:Math.PI,pitch:0}))]); f.advance(120); }
  assert.ok(f.p.stats.shots>0); assert.equal(f.other.hp,100); f.m.close();
});
