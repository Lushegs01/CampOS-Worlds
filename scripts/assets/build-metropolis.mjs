// Operation: Metropolis asset pack: the surfaces and street props the city map adds to the Combat Arena pack.
// Written beside the arena's own (public/assets/arena/textures/<key>, props/<key>.glb), so the phone tier
// (build-arena-mobile.mjs) and the arena loader treat them like any other arena asset.
//   textures/<key>/{color,normal,arm}.ktx2   Poly Haven PBR sets (CC0), 1k, Basis KTX2
//   props/<key>.glb                          Poly Haven models (CC0), simplified, KTX2 textures, meshopt
//   metropolis.json                          what was built: sources, authors, triangles, bytes
// Run: node scripts/assets/build-metropolis.mjs [textures|props]   then   node scripts/assets/build-arena-mobile.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, meshopt, center } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { CACHE, OUT, ensureDir, fetchCached, fetchJson, encodeKTX2Batch, writeJSON, kb } from './common.mjs';

const ARENA = ensureDir(path.join(OUT, 'arena'));
const PH = path.join(CACHE, 'polyhaven');
const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

/** key → [Poly Haven id, what it is used for]. */
export const CITY_SURFACES = {
  cityAsphalt: ['asphalt_02', 'Marina Avenue, Harbour Road, Broad Street'],
  sidewalk: ['concrete_pavement', 'pavements and the deployment strips'],
  pavers: ['interlocking_concrete_pavers', 'lanes and the Balogun passage'],
  plazaStone: ['granite_tile', 'the Central Plaza, the tower arcade'],
  floorTile: ['floor_tiles_06', 'shop and restaurant floors'],
  marble: ['marble_01', 'the Okun Trust banking hall'],
  subwayTile: ['long_white_tiles', 'Plaza Station walls'],
  facadePanel: ['concrete_tile_facade', 'the Balogun Arcade, panel facades'],
  cladding: ['exterior_wall_cladding', 'Okun Tower podium, the terminal'],
  blockWall: ['concrete_block_wall_02', 'the substation, yard walls, street walls'],
  shutter: ['painted_metal_shutter', 'roller shutters'],
  woodFloor: ['wood_floor', 'upper floors'],
  ceiling: ['ceiling_interior', 'ceilings'],
};
/** key → [Poly Haven id, target triangles, texture size, what it is]. */
export const CITY_PROPS = {
  streetLamp: ['street_lamp_01', 1400, 512, 'street lighting'],
  aircon: ['exterior_aircon_unit', 900, 512, 'split-unit condensers on facades and roofs'],
  trashCan: ['metal_trash_can', 700, 512, 'bins'],
  parkBench: ['painted_wooden_bench', 900, 512, 'plaza and platform seating'],
  manhole: ['water_manhole_cover', 300, 512, 'road ironwork'],
  tubeLight: ['mounted_fluorescent_lights', 500, 256, 'station, car park and warehouse lighting'],
  shelves: ['steel_frame_shelves_01', 1500, 512, 'warehouse racking, shop shelving'],
  plasticCrate: ['plastic_crate_01', 700, 512, 'market and warehouse crates'],
  cardboard: ['cardboard_box_01', 300, 512, 'stock'],
  cement: ['cement_bag', 500, 512, 'warehouse stock'],
  handTruck: ['hand_truck', 1200, 512, 'warehouse and delivery trolleys'],
  officeDesk: ['metal_office_desk', 900, 512, 'offices'],
  planterBox: ['planter_box_01', 500, 512, 'street planters'],
  cafeSet: ['outdoor_table_chair_set_01', 2400, 512, 'the Atlantic Grill terrace'],
  trashbag: ['trashbag', 500, 512, 'alleys'],
  sofa: ['sofa_03', 1400, 512, 'the banking hall, the gallery'],
  camera: ['security_camera_01', 600, 256, 'CCTV'],
  monobloc: ['plastic_monobloc_chair_01', 900, 512, 'kiosk and terminal seating'],
};

const only = process.argv[2];
const manifestFile = path.join(ARENA, 'metropolis.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { textures: [], props: [] };

async function textures() {
  const jobs = []; manifest.textures = [];
  for (const [key, [id, use]] of Object.entries(CITY_SURFACES)) {
    const files = await fetchJson(`https://api.polyhaven.com/files/${id}`, path.join(PH, 'api', `files_${id}.json`));
    const info = await fetchJson(`https://api.polyhaven.com/info/${id}`, path.join(PH, 'api', `info_${id}.json`));
    const pick = k => files[k]?.['1k']?.jpg?.url;
    const maps = { color: pick('Diffuse'), normal: pick('nor_gl'), arm: pick('arm') };
    ensureDir(path.join(ARENA, 'textures', key));
    for (const [slot, url] of Object.entries(maps)) {
      if (!url) throw new Error(`${id} has no ${slot} map`);
      const src = await fetchCached(url, path.join(PH, 'textures', id, path.basename(url)));
      jobs.push({ in: src, out: path.join(ARENA, 'textures', key, `${slot}.ktx2`), kind: slot === 'color' ? 'color' : slot === 'normal' ? 'normal' : 'linear', flipY: true });
    }
    manifest.textures.push({ key, id, source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0', author: Object.keys(info.authors || {}).join(', '), use });
  }
  await encodeKTX2Batch(jobs);
  for (const t of manifest.textures) t.bytes = ['color', 'normal', 'arm'].reduce((n, s) => n + fs.statSync(path.join(ARENA, 'textures', t.key, `${s}.ktx2`)).size, 0);
}

async function prop(key, [id, targetTris, size, use]) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`, path.join(PH, 'api', `files_${id}.json`));
  const gltf = files.gltf['1k'].gltf, dir = ensureDir(path.join(PH, 'models', id));
  const main = await fetchCached(gltf.url, path.join(dir, path.basename(gltf.url)));
  for (const [rel, f] of Object.entries(gltf.include)) await fetchCached(f.url, path.join(dir, rel));
  const doc = await io().read(main), root = doc.getRoot();
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const ratio = Math.min(1, targetTris / tris);
  await doc.transform(dedup(), weld(), ...(ratio < .98 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: .01, lockBorder: false })] : []), prune());
  const kinds = new Map();
  for (const mat of root.listMaterials()) {
    if (mat.getBaseColorTexture()) kinds.set(mat.getBaseColorTexture(), 'color');
    if (mat.getNormalTexture()) kinds.set(mat.getNormalTexture(), 'normal');
    for (const t of [mat.getMetallicRoughnessTexture(), mat.getOcclusionTexture()]) if (t && !kinds.has(t)) kinds.set(t, 'linear');
  }
  const tmp = ensureDir(path.join(dir, 'baked-city')), jobs = [], list = root.listTextures();
  for (const [i, tex] of list.entries()) {
    const png = path.join(tmp, `${i}.png`), kind = kinds.get(tex) ?? 'linear';
    let img = sharp(Buffer.from(tex.getImage())).resize(size, size, { fit: 'fill' });
    if (kind !== 'color') img = img.removeAlpha();
    fs.writeFileSync(png, await img.png().toBuffer());
    jobs.push({ in: png, out: path.join(tmp, `${i}.ktx2`), kind, quality: kind === 'normal' ? 220 : 170, force: true });
  }
  await encodeKTX2Batch(jobs);
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const [i, tex] of list.entries()) tex.setImage(new Uint8Array(fs.readFileSync(path.join(tmp, `${i}.ktx2`)))).setMimeType('image/ktx2').setURI(`${key}-${i}.ktx2`);
  await doc.transform(center({ pivot: 'below' }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(ensureDir(path.join(ARENA, 'props')), `${key}.glb`);
  await io().write(out, doc);
  let after = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) after += p.getIndices().getCount() / 3;
  const info = await fetchJson(`https://api.polyhaven.com/info/${id}`, path.join(PH, 'api', `info_${id}.json`));
  console.log(`  ${key.padEnd(14)} ${Math.round(tris)} -> ${after} tris, ${kb(out)}`);
  return { key, id, source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0', author: Object.keys(info.authors || {}).join(', '), use, triangles: after, bytes: fs.statSync(out).size };
}

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
if (!only || only === 'textures') await textures();
if (!only || only === 'props') { manifest.props = []; for (const [k, spec] of Object.entries(CITY_PROPS)) manifest.props.push(await prop(k, spec)); }
manifest.licence = 'Every file listed here is from Poly Haven (polyhaven.com), CC0 1.0.';
writeJSON(manifestFile, manifest);
console.log(`textures ${(manifest.textures.reduce((n, t) => n + (t.bytes ?? 0), 0) / 1e6).toFixed(2)} MB, props ${(manifest.props.reduce((n, t) => n + t.bytes, 0) / 1e6).toFixed(2)} MB`);
