import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';

const root = new URL('../public/assets/getaway/', import.meta.url);
const textured = new Set(['aggregate', 'asphalt', 'patch', 'slab', 'concrete', 'corrugation', 'roofing', 'wood']);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

test('district GLBs decode with metric UVs, exact triangle counts and bounded transfers', async () => {
  const manifest = JSON.parse(await readFile(new URL('district.json', root), 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['bay04Fittings', 'bay04Shell', 'freightDepots', 'freightFixtures', 'freightGround']);
  let bytes = 0;
  let tris = 0;
  for (const [key, record] of Object.entries(manifest)) {
    assert.equal(record.file, key + '.glb');
    const contents = await readFile(new URL(record.file, root));
    assert.equal(contents.length, record.bytes, record.file);
    bytes += contents.length;
    const model = (await io.readBinary(contents)).getRoot();
    assert.ok(model.listExtensionsRequired().some(extension => extension.extensionName === 'EXT_meshopt_compression'), key);
    assert.equal(model.listTextures().length, 0, 'surface textures are shared at runtime');

    let triangles = 0;
    for (const mesh of model.listMeshes()) for (const primitive of mesh.listPrimitives()) {
      triangles += primitive.getIndices().getCount() / 3;
      const name = primitive.getMaterial().getName();
      if (!textured.has(name)) continue;
      const uv = primitive.getAttribute('TEXCOORD_0');
      assert.ok(uv, `${key} ${name} will receive a tiled PBR texture at runtime`);
      assert.equal(uv.getCount(), primitive.getAttribute('POSITION').getCount());
      assert.ok(Math.max(...uv.getMaxNormalized([])) - Math.min(...uv.getMinNormalized([])) > 1, `${key} ${name} has metric UVs`);
    }
    assert.equal(triangles, record.triangles, key);
    tris += triangles;

    if (key === 'freightGround') {
      const asphaltNode = model.listNodes().find(node => node.getMesh()?.listPrimitives().some(p => p.getMaterial().getName() === 'asphalt'));
      const asphalt = asphaltNode.getMesh().listPrimitives().find(p => p.getMaterial().getName() === 'asphalt');
      const matrix = new Matrix4().fromArray(asphaltNode.getWorldMatrix());
      const corner = new Vector3().fromArray(asphalt.getAttribute('POSITION').getMaxNormalized([])).applyMatrix4(matrix);
      assert.ok(corner.y > .006 && corner.y < .02, 'the asphalt finishes above the meadow and beneath the slab');
    }
  }
  assert.ok(bytes < 390_000, `${bytes} bytes across the five authored shells and surfaces`);
  assert.ok(tris < 33_000, `${tris} authored triangles`);
});
