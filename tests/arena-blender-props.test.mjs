// Blender-authored Metropolis props (blender/build.py → scripts/assets/build-blender-props.mjs): every prop the city
// loads is built, in both tiers, decodes, matches the collision box it dresses, stays inside its budget and is
// recorded with its source file and licence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { MAPS } from '../shared/arena/maps.mjs';

const HERO = { roofTank: 'tank', roofAC: 'ac', roofVent: 'vent', utilityCabinet: 'utility', wasteBin: 'bin', forklift: 'forklift' };
const lib = readFileSync('src/arena/scene/library.ts', 'utf8');
const manifest = JSON.parse(readFileSync('public/assets/arena/blender.json', 'utf8'));

test('the library loads exactly the props the Blender manifest records', () => {
  const m = lib.match(/HERO_PROPS: HeroPropKey\[\] = \[([^\]]+)\]/);
  assert.ok(m, 'HERO_PROPS declared');
  const keys = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(keys.sort(), Object.keys(HERO).sort());
  assert.deepEqual(Object.keys(manifest.props).sort(), Object.keys(HERO).sort());
});

test('each Blender prop dresses a collision box type the Metropolis map really has', () => {
  const mats = new Set(MAPS.find(m => m.id === 'metropolis').boxes.map(b => b.mat));
  for (const mat of Object.values(HERO)) assert.ok(mats.has(mat), mat);
});

test('each Blender prop decodes in both tiers, fits its box, and stays within budget', async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const [key, entry] of Object.entries(manifest.props)) {
    assert.ok(existsSync(entry.source), `${key}: source ${entry.source}`);
    assert.ok(entry.license && entry.author, `${key}: licence recorded`);
    for (const tier of ['', 'mobile/']) {
      const file = `public/assets/arena/${tier}props/${key}.glb`;
      assert.ok(existsSync(file), file);
      const doc = await io.read(file), root = doc.getRoot();
      let tris = 0; for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += p.getIndices().getCount() / 3;
      assert.ok(tris > 500 && tris <= 8000, `${key}: ${tris} triangles`);
      assert.equal(root.listMaterials().length, 1, `${key}: one material (one draw call per instance batch)`);
      for (const t of root.listTextures()) assert.equal(t.getMimeType(), 'image/ktx2', `${key}: KTX2 texture`);
      const { min, max } = getBounds(root.listScenes()[0]);
      const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
      // glTF axes: x = length, y = height, z = depth (Blender's x, z, y).
      const [bx, by, bz] = entry.collisionBox;
      for (const [got, want, axis] of [[size[0], bx, 'length'], [size[1], bz, 'height'], [size[2], by, 'depth']]) assert.ok(Math.abs(got / want - 1) < .1, `${key} ${axis}: ${got.toFixed(2)} vs box ${want}`);
      assert.ok(Math.abs(min[1]) < .01, `${key}: base on the ground (min y ${min[1]})`);
    }
  }
});
