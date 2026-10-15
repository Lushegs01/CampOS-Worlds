// The selectable characters are listed in three places that must agree: MODELS (shared/campus.mjs, used
// by the room server and the client), the built assets and their manifest (scripts/assets/build-characters.mjs),
// and the database's valid_avatar() allowlist (the newest migration that defines it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { MODELS, sanitizeAvatar } from '../shared/campus.mjs';

const dir = 'public/assets/characters', manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));

test('every selectable character has its model, portrait and manifest entry, and nothing else is listed', () => {
  for (const id of MODELS) {
    assert.ok(manifest.characters.some(c => c.id === id), `${id} is in the manifest`);
    assert.ok(existsSync(`${dir}/${id}.glb`) && existsSync(`${dir}/${id}.webp`), `${id}.glb and ${id}.webp exist`);
  }
  assert.deepEqual(manifest.characters.map(c => c.id).sort(), [...MODELS].sort());
  for (const c of manifest.characters) assert.ok(/^https:\/\/github\.com\/microsoft\/Microsoft-Rocketbox\//.test(c.source), `${c.id} is a Rocketbox (MIT) character`);
});

test('the database accepts exactly the same characters (newest valid_avatar definition)', () => {
  const files = readdirSync('supabase/migrations').sort().map(f => readFileSync(`supabase/migrations/${f}`, 'utf8'));
  const latest = files.filter(s => s.includes('function public.valid_avatar')).at(-1);
  const list = latest.match(/a ->> 'model', 'tunde'\) in \(([^)]*)\)/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(list.sort(), [...MODELS].sort());
});

test('Mel can be chosen', () => {
  assert.equal(sanitizeAvatar({ model: 'mel' }).model, 'mel');
});
