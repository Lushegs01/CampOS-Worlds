// Compact the Blender GLBs with the same Meshopt codec used by campus and Arena.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const dir = new URL('../../public/assets/getaway/', import.meta.url);
const district = process.argv.includes('--district');
const manifest = new URL(district ? 'district.json' : 'models.json', dir);
const assets = JSON.parse(await readFile(manifest, 'utf8'));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
for (const model of Object.values(assets)) {
  const file = new URL(model.file, dir);
  const document = await io.read(file.pathname);
  // The district's projected UVs are bound to runtime textures. Preserve them even though the
  // GLB does not embed texture images. Use enough position precision for its centimetre-thin paint and asphalt layers.
  await document.transform(dedup(), prune({ keepAttributes: district }), meshopt({
    encoder: MeshoptEncoder, level: 'medium', ...(district ? { quantizePosition: 16 } : {}),
  }));
  await io.write(file.pathname, document);
  model.bytes = (await stat(file)).size;
  console.log(model.file, model.triangles, 'triangles', model.bytes, 'bytes');
}
await writeFile(manifest, JSON.stringify(assets, null, 2)+'\n');
