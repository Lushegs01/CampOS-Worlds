// Optimizes Poly Haven (CC0) props for real-time use: simplify, 512px KTX2 textures, meshopt.
// Run: node scripts/assets/build-props.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, meshopt, center } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { CACHE, OUT, ensureDir, fetchCached, fetchJson, encodeKTX2Batch, writeJSON, kb } from './common.mjs';

const PH = path.join(CACHE, 'polyhaven', 'models');
const OUT_DIR = ensureDir(path.join(OUT, 'props'));
// id -> [Poly Haven asset, target triangle count, texture size, simplification error budget]
export const PROPS = {
  monobloc: ['plastic_monobloc_chair_01', 900, 512, .03],
  schoolChair: ['SchoolChair_01', 900, 512, .03], schoolDesk: ['SchoolDesk_01', 1200, 512, .02], pottedPalm: ['potted_plant_01', 5000, 512, .03],
  pottedPlant: ['potted_plant_02', 3500, 512, .03], fern: ['fern_02', 4000, 512], calathea: ['calathea_orbifolia_01', 4500, 512],
  anthurium: ['anthurium_botany_01', 4100, 512, .015], shrub: ['shrub_04', 6000, 512], chalkboard: ['standing_chalkboard_01', 2400, 512],
  hydrant: ['fire_hydrant', 1500, 512, .03], picnic: ['wooden_picnic_table', 1500, 512, .02],
  wetFloor: ['WetFloorSign_01', 1200, 256], seating: ['modular_street_seating', 3500, 512, .02],
};

const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const ledger = [];

async function buildProp(key, [id, targetTris, size, errorBudget = .004]) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`, path.join(CACHE, 'polyhaven', 'api', `files_${id}.json`));
  const gltf = files.gltf['1k'].gltf, dir = ensureDir(path.join(PH, id));
  const main = await fetchCached(gltf.url, path.join(dir, path.basename(gltf.url)));
  for (const [rel, f] of Object.entries(gltf.include)) await fetchCached(f.url, path.join(dir, rel));
  const doc = await io().read(main);
  const root = doc.getRoot();
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const ratio = Math.min(1, targetTris / tris);
  await doc.transform(dedup(), weld(), ...(ratio < .98 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: errorBudget, lockBorder: false })] : []), prune());
  // Classify textures by the material slot that uses them, then encode with the right colour space.
  const kinds = new Map();
  for (const mat of root.listMaterials()) {
    if (mat.getBaseColorTexture()) kinds.set(mat.getBaseColorTexture(), 'color');
    if (mat.getEmissiveTexture()) kinds.set(mat.getEmissiveTexture(), 'color');
    if (mat.getNormalTexture()) kinds.set(mat.getNormalTexture(), 'normal');
    for (const t of [mat.getMetallicRoughnessTexture(), mat.getOcclusionTexture()]) if (t && !kinds.has(t)) kinds.set(t, 'linear');
  }
  const tmp = ensureDir(path.join(dir, 'baked')), jobs = [], textures = root.listTextures();
  for (const [i, tex] of textures.entries()) {
    const png = path.join(tmp, `${i}.png`);
    const kind = kinds.get(tex) ?? 'linear';
    let img = sharp(Buffer.from(tex.getImage())).resize(size, size, { fit: 'fill' });
    if (kind !== 'color') img = img.removeAlpha();
    fs.writeFileSync(png, await img.png().toBuffer());
    jobs.push({ in: png, out: path.join(tmp, `${i}.ktx2`), kind, quality: kind === 'normal' ? 220 : 170, force: true });
  }
  await encodeKTX2Batch(jobs);
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const [i, tex] of textures.entries()) tex.setImage(new Uint8Array(fs.readFileSync(path.join(tmp, `${i}.ktx2`)))).setMimeType('image/ktx2').setURI(`${key}-${i}.ktx2`);
  await doc.transform(center({ pivot: 'below' }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT_DIR, `${key}.glb`);
  await io().write(out, doc);
  let after = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) after += p.getIndices().getCount() / 3;
  console.log(`  ${key.padEnd(12)} ${String(Math.round(tris)).padStart(7)} -> ${String(after).padStart(6)} tris, ${kb(out)}`);
  const info = await fetchJson(`https://api.polyhaven.com/info/${id}`, path.join(CACHE, 'polyhaven', 'api', `info_${id}.json`));
  ledger.push({ asset: `props/${key}.glb`, source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0', author: Object.keys(info.authors || {}).join(', ') + ' (Poly Haven)', triangles: after });
}

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const only = process.argv[2];
for (const [key, spec] of Object.entries(PROPS)) if (!only || only === key) await buildProp(key, spec);
writeJSON(path.join(CACHE, 'ledger-props.json'), ledger);
console.log('done');
