// Combat Arena Armory rules without a database: exactly two free firearms, every other firearm premium and
// fully implemented, premium weapons locked in loadout validation, store items and prices in step with the
// catalogue, and fair: no premium weapon is better than a free one in every respect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, WEAPON_BY_ID, FREE_FIREARMS, PREMIUM_WEAPONS, isFirearm, weaponItem, weaponOwned, damageAt, CATALOG } from '../shared/arena/weapons.mjs';
import { validateLoadout, PRESETS, BOT_PRESETS, timeToKill, dominates, unlocksAt } from '../shared/arena/rules.mjs';
import { SHOP_ITEMS, SHOP_BY_ID, priceOf, DEFAULT_PRICES } from '../shared/shop.mjs';
import { readFileSync } from 'node:fs';

test('exactly two free firearms (an assault rifle and an SMG); every other firearm is premium', () => {
  assert.deepEqual(FREE_FIREARMS, ['vanguard', 'wasp']);
  assert.equal(WEAPON_BY_ID.get('vanguard').category, 'ar'); assert.equal(WEAPON_BY_ID.get('wasp').category, 'smg');
  const firearms = WEAPONS.filter(isFirearm);
  assert.equal(firearms.filter(w => w.access === 'free').length, 2);
  assert.deepEqual(firearms.filter(w => w.access !== 'free').map(w => w.id).sort(), [...PREMIUM_WEAPONS].sort());
  assert.ok(firearms.every(w => w.access === 'free' || w.access === 'premium'), 'no firearm is merely level-locked');
  // Every premium weapon is a real, independently configured weapon with its own model and sound profile.
  const manifest = JSON.parse(readFileSync('public/assets/arena/manifest.json', 'utf8'));
  for (const id of PREMIUM_WEAPONS) {
    const w = WEAPON_BY_ID.get(id);
    assert.ok(w.role && w.tradeoff && w.armory, `${id} is described`);
    assert.ok(w.rpm > 0 && w.mag > 0 && w.damage.length && w.recoil && w.spread && w.sound, `${id} is fully configured`);
    assert.ok(manifest.weapons.some(m => m.id === id && m.triangles > 1000 && m.lodTriangles > 0), `${id} has its own model and LOD`);
  }
  assert.equal(new Set(PREMIUM_WEAPONS.map(id => JSON.stringify(WEAPON_BY_ID.get(id).damage) + WEAPON_BY_ID.get(id).rpm)).size, PREMIUM_WEAPONS.length, 'no duplicated stat blocks');
  // Premium weapons are bought, never handed out by levelling up.
  for (let l = 1; l <= 30; l++) for (const id of unlocksAt(l)) assert.ok(!PREMIUM_WEAPONS.includes(id), `${id} at level ${l}`);
});

test('starting loadouts use free weapons only; premium weapons are locked unless owned', () => {
  for (const p of PRESETS) { assert.equal(validateLoadout(p, 1, {}, []).ok, true, p.name); assert.ok(weaponOwned(p.primary, []) && weaponOwned(p.secondary, [])); }
  for (const id of PREMIUM_WEAPONS) {
    const slot = WEAPON_BY_ID.get(id).slot, l = { ...PRESETS[0], [slot]: id };
    const refused = validateLoadout(l, 30, {}, []);
    assert.equal(refused.ok, false); assert.match(refused.reason, /Armory/); assert.equal(refused.locked, id);
    assert.equal(validateLoadout(l, 30, {}, undefined).ok, false, 'no ownership list means nothing owned');
    assert.equal(validateLoadout(l, 30, {}, ['weapon-other']).ok, false);
    assert.equal(validateLoadout(l, 1, {}, [weaponItem(id)]).ok, true, `${id} owned: usable at any level`);
    assert.equal(validateLoadout(l, 1, {}, new Set([weaponItem(id)])).ok, true);
  }
  assert.ok(BOT_PRESETS.some(p => PREMIUM_WEAPONS.includes(p.primary)), 'training bots still cover premium matchups');
});

test('every premium weapon is a store item at the weapon price, mirrored in the database catalogue', () => {
  for (const id of PREMIUM_WEAPONS) {
    const item = SHOP_BY_ID.get(weaponItem(id));
    assert.ok(item, id); assert.equal(item.kind, 'weapon'); assert.equal(item.weapon, id); assert.equal(item.name, WEAPON_BY_ID.get(id).name);
    assert.equal(priceOf(item.id), DEFAULT_PRICES.weapon);
  }
  assert.equal(SHOP_ITEMS.filter(i => i.kind === 'weapon').length, PREMIUM_WEAPONS.length);
  for (const id of FREE_FIREARMS) assert.equal(SHOP_BY_ID.get(weaponItem(id)), undefined, 'free weapons are never sold');
  const sql = readFileSync('supabase/migrations/20261110120000_arena_armory_and_preferences.sql', 'utf8');
  const premium = sql.match(/update public\.arena_catalog set premium = true, unlock_level = 1\s+where id in \(([^)]+)\)/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(premium.sort(), [...PREMIUM_WEAPONS].sort());
  assert.deepEqual(CATALOG.filter(c => c.premium).map(c => c.id).sort(), [...PREMIUM_WEAPONS].sort());
});

test('fair: no premium weapon dominates a free one, and the free weapons stay competitive at their ranges', () => {
  for (const p of PREMIUM_WEAPONS) for (const f of FREE_FIREARMS) assert.equal(dominates(WEAPON_BY_ID.get(p), WEAPON_BY_ID.get(f)), false, `${p} must not dominate ${f}`);
  // Sanity of the check itself: a copy of the Vanguard with more damage would dominate it.
  const v = WEAPON_BY_ID.get('vanguard'); assert.equal(dominates({ ...v, damage: v.damage.map(([d, x]) => [d, x + 5]) }, v), true);
  // The free SMG wins close-range fights against every premium automatic primary, and the free rifle holds mid range.
  const wasp = WEAPON_BY_ID.get('wasp'), vanguard = WEAPON_BY_ID.get('vanguard');
  for (const id of ['halcyon', 'anvil', 'talon']) assert.ok(timeToKill(wasp, 5) <= timeToKill(WEAPON_BY_ID.get(id), 5), `wasp beats ${id} at 5 m`);
  for (const id of ['kestrel', 'anvil']) assert.ok(timeToKill(vanguard, 30) <= timeToKill(WEAPON_BY_ID.get(id), 30) * 1.2, `vanguard within 20% of ${id} at 30 m`);
  // Every premium weapon pays for its strength: worse handling, capacity or range than at least one free weapon.
  for (const id of PREMIUM_WEAPONS) {
    const w = WEAPON_BY_ID.get(id);
    const tradeoff = FREE_FIREARMS.some(f => { const x = WEAPON_BY_ID.get(f); return w.moveMul < x.moveMul || w.ads > x.ads || w.mag < x.mag || w.range < x.range || damageAt(w, 30) < damageAt(x, 30); });
    assert.ok(tradeoff, `${id} has a trade-off`);
  }
});
