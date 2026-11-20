// Compact the Blender GLBs with the same Meshopt codec used by campus and Arena.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const dir = new URL('../../public/assets/getaway/', import.meta.url);
const manifest = new URL('models.json', dir);
const assets = JSON.parse(await readFile(manifest, 'utf8'));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
for (const model of Object.values(assets)) {
  const file = new URL(model.file, dir);
  const document = await io.read(file.pathname);
  await document.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file.pathname, document);
  model.bytes = (await stat(file)).size;
  console.log(model.file, model.triangles, 'triangles', model.bytes, 'bytes');
}
await writeFile(manifest, JSON.stringify(assets, null, 2)+'\n');
