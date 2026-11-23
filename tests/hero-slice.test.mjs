// Commercial District hero slice (blender/hero_slice.py → public/assets/harbour/hero/, src/world/heroSlice.tsx):
// the shipped assets decode, stay within their budgets, fit the shared collision they dress, carry the rig the
// vehicle renderer drives, and only use material slots the game binds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { HARBOUR_BUILDINGS, HARBOUR_BLOCKS, HARBOUR_FURNITURE } from '../shared/harbour-local.mjs';
import { VEHICLE_TYPES } from '../shared/vehicles.mjs';

const DIR = 'public/assets/harbour/hero';
const manifest = JSON.parse(fs.readFileSync(`${DIR}/manifest.json`, 'utf8'));
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const read = async key => io.read(`${DIR}/${key}.glb`);
const triangles = doc => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
const BUDGET = { 'hero-bank': 25000, 'hero-bank-lod1': 10000, 'hero-car': 20000, 'hero-street': 8000 };

test('every hero asset is in the manifest, decodes, has no textures and stays within its triangle budget', async () => {
  assert.deepEqual(Object.keys(manifest.assets).sort(), Object.keys(BUDGET).sort());
  for (const [key, info] of Object.entries(manifest.assets)) {
    assert.equal(fs.statSync(`public/assets/${info.file}`).size, info.bytes, key);
    const doc = await read(key), tris = triangles(doc);
    assert.equal(tris, info.triangles, key);
    assert.ok(tris <= BUDGET[key], `${key}: ${tris} > ${BUDGET[key]}`);
    assert.equal(doc.getRoot().listTextures().length, 0, `${key} ships textures`);
    assert.ok(info.bytes < 400_000, `${key} is ${info.bytes} bytes`);
  }
  // The detailed level is really the detailed one.
  assert.ok(manifest.assets['hero-bank-lod1'].triangles < manifest.assets['hero-bank'].triangles * .6);
});

test('Coastal Bank fills its collision box at street level and projects only above head height', async () => {
  const b = HARBOUR_BUILDINGS.find(x => x.id === 'block-0-1-0');
  for (const key of ['hero-bank', 'hero-bank-lod1']) {
    const doc = await read(key), box = getBounds(doc.getRoot().listScenes()[0]);
    assert.ok(box.min[0] >= -b.w / 2 - .3 && box.max[0] <= b.w / 2 + .3, `${key} width`);
    assert.ok(box.min[2] >= -b.d / 2 - .3, `${key} rear (cornice overhang only)`);
    assert.ok(box.max[2] <= b.d / 2 + 1.8, `${key} canopy/balconies reach ${box.max[2]}`);
    assert.ok(box.max[1] < 18.5 && box.min[1] > -.1, `${key} height`);
    // Below 3.5 m nothing stands outside the footprint (players walk the plaza freely).
    const doc2 = doc, low = [];
    for (const mesh of doc2.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), v = [];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); if (v[1] < 3.5 && (Math.abs(v[0]) > b.w / 2 + .3 || v[2] > b.d / 2 + .3)) low.push(v.slice()); }
    }
    assert.equal(low.length, 0, `${key}: ${low.length} vertices outside the footprint below 3.5 m, e.g. ${JSON.stringify(low[0])}`);
  }
});

test('the production car matches the drivable compact: wheelbase, track, wheel radius, steering on the driver side', async () => {
  const doc = await read('hero-car'), nodes = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n]));
  for (const name of ['body', 'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'steering']) assert.ok(nodes.has(name), name);
  const t = VEHICLE_TYPES.car, at = name => nodes.get(name).getTranslation();
  assert.ok(Math.abs(at('wheel_fl')[2] - at('wheel_rl')[2] - t.wheelbase) < .02, 'wheelbase');
  assert.ok(at('wheel_fl')[2] > 0, 'nose towards +z');
  assert.ok(Math.abs(at('wheel_fl')[1] - t.wheelRadius) < .01, 'hub height = wheel radius');
  assert.ok(Math.abs(at('wheel_fl')[0] + at('wheel_fr')[0]) < .01, 'symmetric track');
  assert.ok(at('steering')[0] > .2 && Math.abs(at('steering')[0] - t.seats[0][0]) < .05, 'steering wheel at the driver seat');
  const box = getBounds(doc.getRoot().listScenes()[0]);
  assert.ok(box.max[2] - box.min[2] <= t.length + .05 && box.max[0] - box.min[0] <= t.width + .2, 'body within the vehicle footprint (mirrors may overhang)');
  assert.ok(box.max[1] <= t.height + .18, 'height (roof 1.53 m; the aerial tip reaches 1.64 m)');
});

test('street dressing sits on block-0-1\'s shared furniture colliders', async () => {
  const block = HARBOUR_BLOCKS.find(b => b.id === 'block-0-1');
  const front = HARBOUR_FURNITURE.filter(f => Math.abs(f.z - (block.z + block.d / 2)) < 2 && Math.abs(f.x - block.x) < block.w / 2);
  assert.equal(front.length, 4);
  const doc = await read('hero-street');
  const box = getBounds(doc.getRoot().listScenes()[0]);
  // In the street frame x is relative to the block centre and +z points out of the block toward the road.
  for (const f of front) { const lx = f.x - block.x; assert.ok(lx >= box.min[0] - .1 && lx <= box.max[0] + .1); }
  assert.ok(box.max[1] < 4.5, 'the planter trees stay low');
});

test('every material slot binds to the game library or a hero material', async () => {
  const library = fs.readFileSync('src/world/materials.ts', 'utf8'), hero = fs.readFileSync('src/world/heroSlice.tsx', 'utf8');
  for (const key of Object.keys(manifest.assets)) for (const m of (await read(key)).getRoot().listMaterials()) {
    const name = m.getName();
    const bound = new RegExp(`\\b${name}: (pbr|paint|new THREE)`).test(library) || new RegExp(`\\b${name}: `).test(hero);
    assert.ok(bound, `${key}: material slot "${name}" has no binding`);
  }
});
