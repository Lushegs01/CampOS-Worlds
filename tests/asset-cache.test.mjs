// The service worker's runtime cache rules (src/world/assetCache.ts): only immutable static files are kept, never
// private or live paths, and a newer revision of a file replaces the older one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isArenaCode, isStaticAsset, supersededBy, groupOf } from '../src/world/assetCache.ts';

const u = s => new URL(s, 'https://campos.example');
test('revisioned world assets and hashed arena chunks are cacheable', () => {
  for (const p of ['/assets/arena/weapons/vanguard.glb?v=0a1b2c3d4e5f', '/assets/arena/characters/soldier-m1-body-b.ktx2?v=0a1b2c3d4e5f', '/assets/arena/audio/rifle.ogg?v=abc123', '/assets/basis/basis_transcoder.wasm?v=abc123'])
    assert.ok(isStaticAsset(u(p)), p);
  for (const p of ['/assets/arena-ArenaApp-Bx7c9DkQ.js', '/assets/arena-arena-D1f2G3h4.css']) assert.ok(isArenaCode(p), p);
});
test('private, live and unversioned requests are never cached', () => {
  for (const p of ['/api/me', '/auth/session', '/arena', '/ws', '/shop/checkout', '/health', '/assets/arena/weapons/vanguard.glb', '/assets/arena/weapons/vanguard.glb?v=x&token=1', '/assets/arena/x.glb?v=../..', '/api/assets/a.glb?v=abc123', '/index.html?v=abc123'])
    assert.ok(!isStaticAsset(u(p)), p);
  for (const p of ['/assets/index-Bx7c9DkQ.js', '/api/arena-x-12345678.js', '/assets/arena-x.js']) assert.ok(!isArenaCode(p), p);
});
test('a new revision supersedes the old copy of the same file only', () => {
  assert.ok(supersededBy('https://h/assets/a.glb?v=old111', 'https://h/assets/a.glb?v=new222'));
  assert.ok(!supersededBy('https://h/assets/a.glb?v=same11', 'https://h/assets/a.glb?v=same11'));
  assert.ok(!supersededBy('https://h/assets/b.glb?v=old111', 'https://h/assets/a.glb?v=new222'));
});
test('the asset manager groups cached files', () => {
  assert.equal(groupOf('/assets/arena/weapons/m7.glb'), 'Weapons');
  assert.equal(groupOf('/assets/arena/characters/soldier-f1.glb'), 'Soldiers');
  assert.equal(groupOf('/assets/arena/audio/rifle.ogg'), 'Audio');
  assert.equal(groupOf('/assets/arena/metropolis/props.glb'), 'Maps');
});
test('the worker routes only through these rules (no other runtime routes)', () => {
  const sw = readFileSync('src/sw.ts', 'utf8'), routes = sw.match(/registerRoute\(/g).length;
  assert.equal(routes, 3, 'navigation + arena code + static assets');
  assert.match(sw, /isArenaCode\(url\.pathname\)/); assert.match(sw, /isStaticAsset\(url\)/);
});
