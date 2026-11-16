// Merge a Blender-modelled moving part into a licensed weapon model, for parts the source model fused into the frame
// and that cannot be split out because they are hidden inside it (a pistol's magazine inside its grip).
// Input: .asset-cache/blender/<part>.glb from `python blender/build.py <part> --size 256` (baked PBR, one material).
// The part's textures are compressed to KTX2 like the rest of the pack; its node is named for the animator
// (`mag`, `bolt` …) and placed in the weapon's own frame (metres, bore along z with the muzzle at z = 0, y up).
// Usage: node scripts/assets/add-weapon-part.mjs [weapon ...]   (idempotent: skips a weapon that already has the part)
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { mergeDocuments, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { CACHE, ensureDir, encodeKTX2Batch } from './common.mjs';

/**
 * weapon → part: the staged Blender asset, the node name the animator looks for, where its baseplate's underside
 * centre sits in the weapon's frame, and its tilt about x (radians; negative leans the top toward the muzzle, as a
 * grip that rakes back does). The part is modelled with its front at Blender +Y, which is the weapon's −z.
 * Measured from `node scripts/qa/arena-weapons.mjs sheet <weapon>`.
 */
export const PARTS = {
  // The Sparrow's magazine: up its grip, the baseplate flush with the grip's base (10 cm below the bore, 16.2 cm back
  // from the muzzle), leaning back with the grip.
  sparrow: { asset: 'sparrowMag', name: 'mag', at: [0, -.1, .162], tilt: -.1 },
};

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const STAGE = path.join(CACHE, 'blender');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PARTS);
for (const id of ids) {
  const spec = PARTS[id], file = `public/assets/arena/weapons/${id}.glb`;
  const doc = await io.read(file), root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (root.listNodes().some(n => n.getName() === spec.name)) { console.log(`${id}: already has '${spec.name}'`); continue; }
  const part = await io.read(path.join(STAGE, `${spec.asset}.glb`));
  // Part textures → KTX2 (colour, normal, ORM), as scripts/assets/build-blender-props.mjs does for props.
  const proot = part.getRoot(), kinds = new Map();
  for (const mat of proot.listMaterials()) {
    if (mat.getBaseColorTexture()) kinds.set(mat.getBaseColorTexture(), 'color');
    if (mat.getNormalTexture()) kinds.set(mat.getNormalTexture(), 'normal');
    for (const t of [mat.getMetallicRoughnessTexture(), mat.getOcclusionTexture()]) if (t && !kinds.has(t)) kinds.set(t, 'linear');
  }
  const tmp = ensureDir(path.join(STAGE, 'ktx2')), jobs = [], texs = proot.listTextures();
  for (const [i, tex] of texs.entries()) {
    const png = path.join(tmp, `${spec.asset}-${i}.png`), kind = kinds.get(tex) ?? 'linear';
    fs.writeFileSync(png, Buffer.from(tex.getImage()));
    jobs.push({ in: png, out: path.join(tmp, `${spec.asset}-${i}.ktx2`), kind, quality: kind === 'normal' ? 220 : 170, force: true });
  }
  await encodeKTX2Batch(jobs);
  for (const [i, tex] of texs.entries()) tex.setImage(new Uint8Array(fs.readFileSync(path.join(tmp, `${spec.asset}-${i}.ktx2`)))).setMimeType('image/ktx2').setURI(`${spec.asset}-${i}.ktx2`);
  // Merge, then move the part's node into the weapon's scene, named and placed.
  const map = mergeDocuments(doc, part);
  const pscene = map.get(part.getRoot().listScenes()[0]);
  for (const n of [...pscene.listChildren()]) {
    pscene.removeChild(n);
    const holder = doc.createNode(spec.name).setTranslation(spec.at).setRotation([Math.sin(spec.tilt / 2), 0, 0, Math.cos(spec.tilt / 2)]);
    n.setName(`${spec.name}Mesh`); holder.addChild(n); scene.addChild(holder);
  }
  pscene.dispose();
  if (!root.listExtensionsUsed().some(e => e.extensionName === 'KHR_texture_basisu')) doc.createExtension(KHRTextureBasisu).setRequired(true);
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, doc);
  console.log(`${id}: added '${spec.name}' from ${spec.asset} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}
