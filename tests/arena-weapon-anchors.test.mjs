// Weapon anchors (src/arena/scene/weaponSpecs.ts) against the catalogue and the models: every selectable weapon has its
// own calibration (no fallback to another weapon's grip), the hold matches its kind, the hands are ordered as on the
// real weapon, and every anchor lies on the model itself. Both the first-person model and the third-person LOD exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../shared/arena/weapons.mjs';
import { SPECS } from '../src/arena/scene/weaponSpecs.ts';
import { weaponAssetRows } from '../scripts/qa/weapon-assets.mjs';

test('every catalogue weapon has its own calibration, and nothing is calibrated that is not in the catalogue', () => {
  const ids = WEAPONS.map(w => w.id);
  assert.deepEqual(ids.filter(id => !SPECS[id]), []);
  assert.deepEqual(Object.keys(SPECS).filter(id => !ids.includes(id)), []);
});

test('every weapon has both models, and its anchors are consistent and on the model', async () => {
  const rows = await weaponAssetRows();
  assert.equal(rows.length, WEAPONS.length);
  for (const r of rows) {
    assert.ok(r.fp, `${r.id}: first-person model missing`);
    assert.ok(r.tp, `${r.id}: third-person LOD missing`);
    assert.ok(r.tp.tris < r.fp.tris, `${r.id}: LOD (${r.tp.tris}) not lighter than the first-person model (${r.fp.tris})`);
    assert.deepEqual(r.problems, [], r.problems.join('\n'));
  }
});

test('melee weapons hold a blade in the firing hand with the support hand in guard (not a firearm hold)', () => {
  for (const w of WEAPONS.filter(w => w.fire === 'melee')) assert.equal(SPECS[w.id].hold, 'blade', w.id);
  for (const w of WEAPONS.filter(w => w.fire !== 'melee')) assert.notEqual(SPECS[w.id].hold, 'blade', w.id);
});
