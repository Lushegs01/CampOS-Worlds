// The first-person animator (src/arena/scene/viewmodel.ts) against the simulation's state: the reload follows the
// shared reload timeline (the same keys that time the sounds), a cancelled reload leaves nothing behind, the sights end
// up exactly on the camera axis, recoil settles, and the animator never writes to the simulation state.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ViewmodelAnimator } from '../src/arena/scene/viewmodel.ts';
import { reloadPlan } from '../src/arena/sound/reloads.mjs';
import { WEAPON_BY_ID } from '../shared/arena/weapons.mjs';

/** A stand-in weapon with the anchors and part pivots weapons.ts gives a real model (the Vanguard's layout). */
function mockGun() {
  const g = new THREE.Group();
  const add = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); g.add(o); return o; };
  add('muzzle', 0, 0, -.495); add('gripR', 0, -.09, .085); add('gripL', 0, -.035, -.195); add('charge', -.022, -.012, -.065);
  const mag = add('mag', 0, -.03, -.115); mag.userData.rest = mag.position.clone();
  g.userData = { sightY: .0685, adsZ: -.26 - (.41 - .495), hold: 'rifle' };
  return g;
}
const sim = (o = {}) => ({ phase: 'ready', pt: 0, cool: 0, ads: 0, sprint: false, stance: 0, grounded: true, vx: 0, vy: 0, vz: 0, shots: 0, ...o });
const W = WEAPON_BY_ID.get('vanguard');
function rig() { const holder = new THREE.Group(), gun = mockGun(); holder.add(gun); return { holder, gun, anim: new ViewmodelAnimator() }; }
const step = (r, s, extra = {}) => r.anim.update({ dt: 1 / 60, sim: s, weapon: W, reloadTotal: extra.total ?? W.reload, reloadEmpty: !!extra.empty, mag: extra.mag ?? 20, dyaw: 0, dpitch: 0, bob: 0 }, r.gun, r.holder);

test('an empty reload drops the magazine, fetches one from below the frame and seats it on the timeline', () => {
  const r = rig(), total = W.reloadEmpty, plan = reloadPlan('vanguard', true), mag = r.gun.getObjectByName('mag'), rest = mag.userData.rest;
  const s = sim({ phase: 'reload', pt: total });
  const at = {};
  for (let t = 0; t < total; t++) {
    s.pt = total - t; const k = 1 - s.pt / total, o = step(r, s, { total, empty: true, mag: 0 });
    for (const [name, key] of [['beforeOut', plan.out[0] - .03], ['falling', plan.out[0] + .08], ['atPouch', (plan.out[1] + plan.in[0]) / 2], ['seated', plan.in[1] + .02]]) if (!at[name] && k >= key) at[name] = { pos: mag.position.clone(), visible: mag.visible, hand: o.handL.clone(), reach: o.reachL };
  }
  assert.ok(at.beforeOut.pos.distanceTo(rest) < 1e-6, 'in the well until the release');
  assert.ok(at.falling.pos.y < rest.y - .05, `falling away (y ${at.falling.pos.y.toFixed(3)})`);
  assert.ok(at.atPouch.hand.y < -.35, `support hand down at the pouch (y ${at.atPouch.hand.y.toFixed(2)})`);
  assert.ok(at.atPouch.reach > .5, 'hand turned to hold a magazine');
  assert.ok(at.seated.pos.distanceTo(rest) < 1e-6 && at.seated.visible, 'new magazine seated when the timeline says');
});

test('a cancelled reload leaves the magazine in the well and the hands on the weapon', () => {
  const r = rig(), total = W.reload, plan = reloadPlan('vanguard', false), mag = r.gun.getObjectByName('mag');
  const s = sim({ phase: 'reload', pt: total });
  for (let t = 0; t < Math.round(total * (plan.out[1] + .05)); t++) { s.pt = total - t; step(r, s, { total }); }
  assert.ok(mag.position.distanceTo(mag.userData.rest) > .05, 'mid-reload the magazine is out');
  s.phase = 'switch'; s.pt = 10; step(r, s);
  assert.ok(mag.position.distanceTo(mag.userData.rest) < 1e-6 && mag.visible, 'back in place the frame the reload ends');
});

test('on the sights the sight line is the camera axis; the field of view narrows', () => {
  const r = rig(), s = sim({ ads: 1 });
  let o; for (let t = 0; t < 120; t++) o = step(r, s);
  const sight = r.gun.localToWorld(new THREE.Vector3(0, r.gun.userData.sightY, -.2));
  assert.ok(Math.abs(sight.x) < .004 && Math.abs(sight.y) < .004, `sight at (${sight.x.toFixed(4)}, ${sight.y.toFixed(4)})`);
  assert.ok(o.vfov < 40, `ADS viewmodel FOV ${o.vfov}`);
  const h = rig(); let oh; for (let t = 0; t < 120; t++) oh = step(h, sim());
  assert.ok(oh.vfov >= 48 && h.holder.position.x > .08 && h.holder.position.y < -.1, 'hip: low and to the right');
});

test('recoil kicks and settles; the animator never changes the simulation state', () => {
  const r = rig(), s = sim({ ads: 1 });
  for (let t = 0; t < 120; t++) step(r, s);
  const rest = r.holder.rotation.x, frozen = JSON.stringify(s);
  r.anim.shot(W, 1); step(r, s);
  let peak = 0; for (let t = 0; t < 8; t++) { step(r, s); peak = Math.max(peak, r.holder.rotation.x - rest); }
  assert.ok(peak > .02, `muzzle climbs on the shot (${peak.toFixed(3)} rad)`);
  for (let t = 0; t < 60; t++) step(r, s);
  assert.ok(Math.abs(r.holder.rotation.x - rest) < .003, 'settles back within a second');
  assert.equal(JSON.stringify(s), frozen);
});
