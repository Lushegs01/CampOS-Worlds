import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const folder = new URL('../../public/assets/harbour/', import.meta.url);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
for (const name of (await readdir(folder)).filter(name => name.endsWith('.glb')).sort()) {
  const file = fileURLToPath(new URL(name, folder));
  const document = await io.read(file);
  await document.transform(dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16 }));
  await io.write(file, document);
  console.log(name, (await stat(file)).size);
}
