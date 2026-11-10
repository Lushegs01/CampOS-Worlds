// Combat Arena asset pack: everything the arena draws that the campus does not need, written to
// public/assets/arena/ and loaded only when a player opens the arena.
//   textures/<key>/{color,normal,arm}.ktx2   Poly Haven PBR sets (CC0), 1k, Basis KTX2
//   props/<key>.glb                          Poly Haven photoscanned props (CC0), simplified, KTX2, meshopt
//   characters/<id>.glb + <id>-<part>-b.ktx2 Microsoft Rocketbox military avatars (MIT): body, head, tactical
//                                            equipment and helmet, in two team camouflage colourways
//   manifest.json                            what was built, sizes, heights, licences
//   weapons/<id>.glb + <id>-lod.glb          first-person weapons and their third-person LODs (Sketchfab CC BY 4.0
//                                            via the Objaverse mirror, Poly Haven CC0), normalised: muzzle at the
//                                            origin, bore along −z, metres; named parts (body, mag, …) for animation
//   weapons/arms.glb                         rigged first-person arms (CC BY 4.0)
// Run: node scripts/assets/build-arena.mjs [textures|props|characters|weapons]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, meshopt, center, flatten, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { CACHE, OUT, ROOT, ensureDir, fetchCached, fetchJson, decodeTGA, encodeKTX2Batch, writeJSON, kb } from './common.mjs';

const ARENA = ensureDir(path.join(OUT, 'arena'));
const PH = path.join(CACHE, 'polyhaven');
const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const ledger = [];

// ---------------------------------------------------------------- PBR surfaces (key -> Poly Haven id)
export const SURFACES = {
  concreteWall: 'concrete_wall_006', concreteFloor: 'concrete_floor_worn_001', road: 'road_damaged', gravel: 'gravel_concrete_03',
  dirt: 'dry_ground_rocks', brick: 'brick_wall_10', corrugated: 'corrugated_iron_02', rustyCorrugated: 'rusty_corrugated_iron',
  paintedMetal: 'rusty_painted_metal', metalPlate: 'metal_plate', plywood: 'plywood', planks: 'wood_planks_grey',
  plaster: 'painted_plaster_wall', sandbag: 'hessian_230',
};
async function textures() {
  const jobs = [];
  for (const [key, id] of Object.entries(SURFACES)) {
    const files = await fetchJson(`https://api.polyhaven.com/files/${id}`, path.join(PH, 'api', `files_${id}.json`));
    const pick = k => files[k]?.['1k']?.jpg?.url;
    const maps = { color: pick('Diffuse'), normal: pick('nor_gl'), arm: pick('arm') };
    for (const [slot, url] of Object.entries(maps)) {
      if (!url) throw new Error(`${id} missing ${slot}`);
      const src = await fetchCached(url, path.join(PH, 'textures', id, path.basename(url)));
      jobs.push({ in: src, out: path.join(ARENA, 'textures', key, `${slot}.ktx2`), kind: slot === 'color' ? 'color' : slot === 'normal' ? 'normal' : 'linear', flipY: true });
    }
    ensureDir(path.join(ARENA, 'textures', key));
    ledger.push({ asset: `arena/textures/${key}`, source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0', author: 'Poly Haven' });
  }
  await encodeKTX2Batch(jobs);
}

// ---------------------------------------------------------------- props (key -> [id, target triangles, texture size])
export const PROPS = {
  jersey: ['concrete_road_barrier', 1300, 1024], milCrate: ['wooden_military_crate', 1400, 1024], oldCrate: ['old_military_crate', 1200, 1024],
  ammo: ['ammo_box', 900, 512], barrel: ['barrel_03', 1200, 512], jerrycan: ['metal_jerrycan_green', 1200, 512],
  generator: ['portable_generator', 2600, 1024], wallLamp: ['industrial_wall_lamp', 450, 512], securityLight: ['security_light', 700, 512],
  powerBox: ['power_box_01', 2500, 512], utilityBox: ['utility_box_01', 1400, 512], tyre: ['old_tyre', 900, 512],
  propane: ['propane_tank', 1200, 512], crate: ['wooden_crate_02', 800, 1024],
};
async function prop(key, [id, targetTris, size]) {
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
  const tmp = ensureDir(path.join(dir, 'baked')), jobs = [], list = root.listTextures();
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
  console.log(`  ${key.padEnd(14)} ${Math.round(tris)} -> ${after} tris, ${kb(out)}`);
  const info = await fetchJson(`https://api.polyhaven.com/info/${id}`, path.join(PH, 'api', `info_${id}.json`));
  ledger.push({ asset: `arena/props/${key}.glb`, source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0', author: Object.keys(info.authors || {}).join(', ') + ' (Poly Haven)', triangles: after });
  return { key, triangles: after, bytes: fs.statSync(out).size };
}

// ---------------------------------------------------------------- military characters (Rocketbox, MIT)
const RB = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master';
const FBX2GLTF = path.join(ROOT, 'node_modules', 'fbx2gltf', 'bin', process.platform === 'win32' ? 'Windows_NT' : process.platform === 'darwin' ? 'Darwin' : 'Linux', process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');
export const SOLDIERS = [
  { id: 'soldier-m1', src: 'Professions/Military_Male_01', code: 'sm002', body: 'm', parts: ['body', 'head', 'equipment', 'helmet', 'combat_knife'] },
  { id: 'soldier-m2', src: 'Professions/Military_Male_03', code: 'sm004', body: 'm', parts: ['body', 'head', 'equipment', 'helmet', 'pistol'] },
  { id: 'soldier-f1', src: 'Professions/Military_Female_01', code: 'sf003', body: 'f', parts: ['body', 'head', 'equipment', 'helmet'] },
];
// Two team colourways mapped from the ACU pattern's own light and shade, so the camouflage pattern and
// fabric detail survive: woodland (team A) and desert (team B).
const PALETTES = { a: [[34, 42, 28], [74, 86, 56], [126, 134, 98], [172, 170, 136]], b: [[70, 56, 40], [128, 104, 74], [176, 152, 112], [214, 196, 156]] };
const CAMO = new Set(['body', 'equipment', 'helmet']);
const lin = c => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
function lab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  let X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722, Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883;
  const f = t => (t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
function skinRef(head) {
  const s = [];
  for (let i = 0; i < head.width * head.height; i += 7) { const [L, A, B] = lab(head.data[i * 4], head.data[i * 4 + 1], head.data[i * 4 + 2]); const hue = Math.atan2(B, A) * 57.3, ch = Math.hypot(A, B); if (L > 18 && L < 85 && hue > 20 && hue < 80 && ch > 8 && ch < 45) s.push([L, A, B]); }
  const med = k => s.map(x => x[k]).sort((a, b) => a - b)[Math.floor(s.length / 2)];
  return { L: med(0), A: med(1), B: med(2) };
}
/** Recolour a camouflage texture: luminance → team palette, skin and saturated details kept. */
function recolour(img, ref, palette) {
  const out = new Uint8Array(img.data.length);
  const ramp = t => { const x = Math.max(0, Math.min(.999, t)) * (palette.length - 1), i = Math.floor(x), f = x - i; return palette[i].map((c, k) => c + (palette[i + 1][k] - c) * f); };
  for (let i = 0; i < img.width * img.height; i++) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2], [L, A, B] = lab(r, g, b);
    const skin = Math.max(0, 1 - Math.max(0, Math.hypot(A - ref.A, B - ref.B) - 7) / 9) * (Math.abs(L - ref.L) < 30 ? 1 : 0);
    const keep = Math.max(skin, Math.min(1, Math.max(0, (Math.hypot(A, B) - 22) / 10)));
    const c = ramp(L / 100);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(c[k] * (1 - keep) + img.data[i * 4 + k] * keep);
    out[i * 4 + 3] = 255;
  }
  return out;
}
const toPng = (rgba, w, h, size) => sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: w, height: h, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
async function soldier(c) {
  const dir = ensureDir(path.join(CACHE, 'rocketbox', path.basename(c.src))), base = path.basename(c.src);
  const fbx = await fetchCached(`${RB}/Assets/Avatars/${c.src}/Export/${base}.fbx`, path.join(dir, `${base}.fbx`));
  const tga = async name => decodeTGA(fs.readFileSync(await fetchCached(`${RB}/Assets/Avatars/${c.src}/Textures/${name}.tga`, path.join(dir, 'Textures', `${name}.tga`))));
  const raw = path.join(dir, 'raw');
  if (!fs.existsSync(raw + '.glb')) execFileSync(FBX2GLTF, ['--binary', '--input', fbx, '--output', raw], { stdio: 'pipe' });
  const doc = await io().read(raw + '.glb'), root = doc.getRoot();
  const head = await tga(`${c.code}_head_color`).catch(() => tga(`${c.code}_head_color_acu`)), ref = skinRef(head);
  const tmp = ensureDir(path.join(dir, 'arena')), jobs = [];
  for (const part of c.parts) {
    const color = part === 'head' ? head : await tga(`${c.code}_${part}_color${CAMO.has(part) ? '_acu' : ''}`);
    const spec = await tga(`${c.code}_${part}_specular`), normal = await tga(`${c.code}_${part}_normal`);
    const size = part === 'body' || part === 'head' || part === 'equipment' ? 1024 : 512;
    const variants = CAMO.has(part) ? { a: recolour(color, ref, PALETTES.a), b: recolour(color, ref, PALETTES.b) } : { a: color.data };
    for (const [v, data] of Object.entries(variants)) {
      fs.writeFileSync(path.join(tmp, `${part}_color_${v}.png`), await toPng(data, color.width, color.height, size));
      jobs.push({ in: path.join(tmp, `${part}_color_${v}.png`), out: path.join(tmp, `${part}_color_${v}.ktx2`), kind: 'color', quality: 210, force: true });
    }
    const mr = new Uint8Array(spec.width * spec.height * 4);
    for (let i = 0; i < spec.width * spec.height; i++) { const sp = spec.data[i * 4] / 255; mr[i * 4] = 255; mr[i * 4 + 1] = Math.round(Math.min(.95, Math.max(.32, .92 - sp * .5)) * 255); mr[i * 4 + 2] = part === 'pistol' || part === 'combat_knife' ? Math.round(sp * 200) : 0; mr[i * 4 + 3] = 255; }
    fs.writeFileSync(path.join(tmp, `${part}_mr.png`), await toPng(mr, spec.width, spec.height, 512));
    fs.writeFileSync(path.join(tmp, `${part}_normal.png`), await toPng(normal.data, normal.width, normal.height, size));
    jobs.push({ in: path.join(tmp, `${part}_mr.png`), out: path.join(tmp, `${part}_mr.ktx2`), kind: 'linear', quality: 160, force: true });
    jobs.push({ in: path.join(tmp, `${part}_normal.png`), out: path.join(tmp, `${part}_normal.ktx2`), kind: 'normal', quality: 220, force: true });
  }
  await encodeKTX2Batch(jobs);
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const tex = (file, name) => doc.createTexture(name).setImage(new Uint8Array(fs.readFileSync(path.join(tmp, file)))).setMimeType('image/ktx2').setURI(name + '.ktx2');
  const partOf = name => c.parts.slice().sort((x, y) => y.length - x.length).find(p => name.toLowerCase().includes(p)) ?? 'body';
  for (const mat of root.listMaterials()) {
    const part = partOf(mat.getName()); mat.setName(part);
    mat.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(tex(`${part}_color_a.ktx2`, `${c.id}-${part}-color`)).setNormalTexture(tex(`${part}_normal.ktx2`, `${c.id}-${part}-normal`))
      .setMetallicRoughnessTexture(tex(`${part}_mr.ktx2`, `${c.id}-${part}-mr`)).setRoughnessFactor(1).setMetallicFactor(1).setAlphaMode('OPAQUE').setDoubleSided(false);
  }
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('COLOR_0', null);
  for (const anim of root.listAnimations()) anim.dispose();
  for (const t of root.listTextures()) if (!t.getMimeType().includes('ktx2')) t.dispose();
  let top = 0; for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) top = Math.max(top, prim.getAttribute('POSITION').getMax([0, 0, 0])[2]);
  await doc.transform(dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const outDir = ensureDir(path.join(ARENA, 'characters')), out = path.join(outDir, `${c.id}.glb`);
  await io().write(out, doc);
  // Team B colourways ship beside the model and are swapped in at runtime.
  const extra = [];
  for (const part of c.parts.filter(p => CAMO.has(p))) { const f = path.join(outDir, `${c.id}-${part}-b.ktx2`); fs.copyFileSync(path.join(tmp, `${part}_color_b.ktx2`), f); extra.push(path.basename(f)); }
  console.log(`  ${c.id}: ${kb(out)} height ${top.toFixed(2)} m, team-B textures ${extra.length}`);
  ledger.push({ asset: `arena/characters/${c.id}.glb`, source: `${RB.replace('raw.githubusercontent.com', 'github.com').replace('/master', '/tree/master')}/Assets/Avatars/${c.src}`, license: 'MIT, © 2020 Microsoft', author: 'Microsoft Rocketbox (camouflage recoloured by scripts/assets/build-arena.mjs)' });
  return { id: c.id, body: c.body, height: +top.toFixed(3), parts: c.parts, teamB: c.parts.filter(p => CAMO.has(p)) };
}

// ---------------------------------------------------------------- weapons and first-person arms
// Sketchfab models are fetched from the Objaverse mirror on Hugging Face (a public archive of CC-licensed
// Sketchfab models, textures at 1k), so the build needs no account. `forward` is the muzzle direction in
// the source file; `length` the overall length in metres; `parts` splits named nodes out for animation;
// `drop` removes loose props that shipped in the source scene (cartridges, display stands).
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main';
const sf = (uid, dir, title, author) => ({ uid, url: `${OBJAVERSE}/glbs/${dir}/${uid}.glb`, page: `https://sketchfab.com/3d-models/${uid}`, title, author, license: 'CC BY 4.0' });
export const WEAPONS = {
  vanguard: { ...sf('429b6ef8516b46dca8992e78c4bf7a55', '000-105', 'SLR AR-15', 'AlexFinsher'), forward: '+z', length: .80, lens: { y: .0685, z: [.34, .415], r: .017 }, parts: { mag: /None\.003_0/ } },
  halcyon: { ...sf('9084c3bae8224d338103997bc3101480', '000-075', 'AK-74M Assault Rifle', 'FJH'), forward: '-z', length: .94, drop: /(^|\/)(Round|Shell)_/, parts: { mag: /(^|\/)Magazine_/ } },
  wasp: { ...sf('c503d96157614fb78b5953d49e643b78', '000-043', 'HK MP5 (9mm submachine gun)', 'quick_loop'), forward: '-x', length: .68, lens: { y: .071, z: [.238, .287], box: [.024, .05, .097] } },
  kestrel: { ...sf('3d031dfeb2ad45beb19e89977225a631', '000-112', 'Saiga-9mm', 'rwroclav'), forward: '+x', length: .86, pca: true, lens: { y: .122, z: [.395, .47], r: .011 } },
  bastion: { ...sf('eea11de7e9d24b6683962b8388c319eb', '000-091', 'Remington 870 Police Magnum 12 Gauge Shotgun', '8sianDude'), forward: '-z', length: .98, dropMaterial: /12gauge/ },
  rampart: { ...sf('7e472e24152246708cac8b6f1613c7a8', '000-061', 'M4 Super 90 (JW2) Brand-Friendly version', '8sianDude'), forward: '-z', length: 1.01, parts: { bolt: /(^|\/)bolt(\/|$)/ } },
  longbow: { ...sf('e520b234140049e7890db0b6c29d3925', '000-009', 'Sniper rifle GameReady Free', 'pashtetuser'), forward: '-z', length: 1.2, parts: { mag: /LPmagazine_/ } },
  talon: { ...sf('997840668e1e4c1384c7220563323085', '000-007', 'HK G28 Sniper Rifle', 'trolosqlfod'), forward: '+x', length: 1.08, drop: /Bipod_4/, parts: { mag: /Mag_1/ }, glass: /mat0\.00[56]/, finish: { roughness: .62, metalness: .25 } },
  anvil: { ...sf('8c24d7374ea64bdab1c30f49c69d5ed8', '000-129', 'LMG', 'DJMaesen'), forward: '+z', length: 1.04, parts: { mag: /\/(mag|bulletholder\d*|bullet(_\d+)?)(\/|$)/ } },
  sparrow: { ph: 'service_pistol', title: 'Service Pistol', forward: '+x', length: .2, drop: /_b$|magazine|bullet/, parts: { slide: /slide_a/ } },
  thorn: { ...sf('360c6276282e48109fcca66f31004d81', '000-118', 'Revolver .357 Magnum', 'Artem Goyko'), forward: '-x', length: .24, cullAbove: .045 },
  knife: { ...sf('5969d3423b6d42428d2f396441d99243', '000-146', 'Combat Knife', 'Aver1'), forward: '-x', length: .31 },
  hammer: { ph: 'hatchet', title: 'Hatchet', forward: '-z', length: .40, pca: true, axis: [0, -1, 0] },
};
const ARMS = sf('e3c42c05b22944e5839deb8e003f0987', '000-013', 'First Person arms', 'DJMaesen');
async function polyHavenDoc(id) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`, path.join(PH, 'api', `files_${id}.json`));
  const gltf = files.gltf['1k'].gltf, dir = ensureDir(path.join(PH, 'models', id));
  const main = await fetchCached(gltf.url, path.join(dir, path.basename(gltf.url)));
  for (const [rel, f] of Object.entries(gltf.include)) await fetchCached(f.url, path.join(dir, rel));
  return io().read(main);
}
/** Recompress every texture of a document to KTX2 at `size`. */
async function texturesToKtx2(doc, tmp, prefix, size) {
  const root = doc.getRoot(), kinds = new Map();
  for (const mat of root.listMaterials()) {
    for (const t of [mat.getBaseColorTexture(), mat.getEmissiveTexture()]) if (t) kinds.set(t, 'color');
    if (mat.getNormalTexture()) kinds.set(mat.getNormalTexture(), 'normal');
    for (const t of [mat.getMetallicRoughnessTexture(), mat.getOcclusionTexture()]) if (t && !kinds.has(t)) kinds.set(t, 'linear');
  }
  const jobs = [], list = root.listTextures(); ensureDir(tmp);
  for (const [i, tex] of list.entries()) {
    const png = path.join(tmp, `${prefix}-${i}.png`), kind = kinds.get(tex) ?? 'linear', meta = await sharp(Buffer.from(tex.getImage())).metadata();
    const dim = Math.min(size, 2 ** Math.round(Math.log2(Math.max(meta.width, meta.height))));
    let img = sharp(Buffer.from(tex.getImage())).resize(dim, dim, { fit: 'fill' });
    if (kind !== 'color') img = img.removeAlpha();
    fs.writeFileSync(png, await img.png().toBuffer());
    jobs.push({ in: png, out: path.join(tmp, `${prefix}-${i}.ktx2`), kind, quality: kind === 'normal' ? 230 : 190, force: true });
  }
  await encodeKTX2Batch(jobs);
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const [i, tex] of list.entries()) tex.setImage(new Uint8Array(fs.readFileSync(path.join(tmp, `${prefix}-${i}.ktx2`)))).setMimeType('image/ktx2').setURI(`${prefix}-${i}.ktx2`);
}
const mulPoint = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
async function weapon(id, spec, lod) {
  const cache = ensureDir(path.join(CACHE, 'objaverse'));
  const doc = spec.ph ? await polyHavenDoc(spec.ph) : await io().read(await fetchCached(spec.url, path.join(cache, `${spec.uid}.glb`)));
  const root = doc.getRoot(), scene = root.listScenes()[0];
  for (const a of root.listAnimations()) a.dispose();
  // Name every mesh node by its full path so parts can still be recognised after flattening.
  const pathOf = n => { const names = []; for (let c = n; c && c.getName; c = c.getParentNode?.()) names.unshift(c.getName()); return names.join('/'); };
  const meshNodes = root.listNodes().filter(n => n.getMesh());
  for (const n of meshNodes) n.setExtras({ path: pathOf(n) });
  for (const n of meshNodes) {
    if (spec.drop?.test(n.getExtras().path)) { n.setMesh(null); continue; }
    if (spec.dropMaterial) { const mesh = n.getMesh(); for (const p of mesh.listPrimitives()) if (spec.dropMaterial.test(p.getMaterial()?.getName() ?? '')) mesh.removePrimitive(p); if (!mesh.listPrimitives().length) n.setMesh(null); }
  }
  for (const m of root.listMaterials()) {
    const glass = spec.glass?.test(m.getName());
    m.setAlphaMode(glass ? 'BLEND' : 'OPAQUE').setDoubleSided(false);
    if (glass) m.setBaseColorFactor([.12, .16, .2, .45]).setRoughnessFactor(.05).setMetallicFactor(.2);
    else { const c = m.getBaseColorFactor(); m.setBaseColorFactor([c[0], c[1], c[2], 1]); if (spec.finish && !m.getMetallicRoughnessTexture()) m.setRoughnessFactor(spec.finish.roughness).setMetallicFactor(spec.finish.metalness); }
  }
  await doc.transform(flatten());
  // Parts that are a material of a shared mesh (a magazine with its own texture set) get their own node.
  if (!lod) for (const [part, re] of Object.entries(spec.partMaterials ?? {})) for (const n of scene.listChildren().filter(c => c.getMesh())) {
    const mesh = n.getMesh(), hits = mesh.listPrimitives().filter(pr => re.test(pr.getMaterial()?.getName() ?? ''));
    if (!hits.length || hits.length === mesh.listPrimitives().length) continue;
    const split = doc.createMesh(`${part}-mesh`); for (const pr of hits) { mesh.removePrimitive(pr); split.addPrimitive(pr); }
    scene.addChild(doc.createNode(`${part}-split`).setMatrix(n.getMatrix()).setMesh(split).setExtras({ path: `${n.getExtras().path}/__part_${part}` }));
  }
  const live = scene.listChildren().filter(n => n.getMesh());
  // Orientation: muzzle to −z, top to +y. M is a row-major 3×3 rotation applied to source positions.
  const points = function* (M) { for (const n of live) { const m = n.getWorldMatrix(); for (const p of n.getMesh().listPrimitives()) { const a = p.getAttribute('POSITION'), e = []; for (let i = 0; i < a.getCount(); i++) { const w = mulPoint(m, a.getElement(i, e)); yield [M[0] * w[0] + M[1] * w[1] + M[2] * w[2], M[3] * w[0] + M[4] * w[1] + M[5] * w[2], M[6] * w[0] + M[7] * w[1] + M[8] * w[2]]; } } } };
  const yawM = a => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let forward = spec.forward;
  if (forward === '?') { let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of points(I)) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } forward = mx[0] - mn[0] > mx[2] - mn[2] ? (spec.flip ? '+x' : '-x') : (spec.flip ? '+z' : '-z'); }
  let M = yawM({ '-z': 0, '+z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 }[forward] + (spec.yaw ?? 0));
  if (spec.pca) {
    // Principal axes of the vertex cloud: longest → bore (z), next → height (y), shortest → width (x).
    let n = 0; const mean = [0, 0, 0], C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of points(M)) { n++; for (let k = 0; k < 3; k++) mean[k] += p[k]; }
    for (let k = 0; k < 3; k++) mean[k] /= n;
    for (const p of points(M)) { const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] += d[i] * d[j] / n; }
    // Jacobi eigen-decomposition.
    const A = C.slice(), V = I.slice();
    for (let sweep = 0; sweep < 50; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p * 3 + q]) < 1e-14) continue;
      const th = .5 * Math.atan2(2 * A[p * 3 + q], A[q * 3 + q] - A[p * 3 + p]), c = Math.cos(th), sn = Math.sin(th);
      for (let k = 0; k < 3; k++) { const akp = A[k * 3 + p], akq = A[k * 3 + q]; A[k * 3 + p] = c * akp - sn * akq; A[k * 3 + q] = sn * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = A[p * 3 + k], aqk = A[q * 3 + k]; A[p * 3 + k] = c * apk - sn * aqk; A[q * 3 + k] = sn * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k * 3 + p], vkq = V[k * 3 + q]; V[k * 3 + p] = c * vkp - sn * vkq; V[k * 3 + q] = sn * vkp + c * vkq; }
    }
    const order = [0, 1, 2].sort((a, b) => A[b * 4] - A[a * 4]), col = i => [V[i], V[3 + i], V[6 + i]];
    let ez = col(order[0]), ey = col(order[1]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (spec.axis ? dot(ez, spec.axis) < 0 : ez[2] < 0) ez = ez.map(v => -v); // muzzle (or head) toward −z
    if (ey[1] < 0) ey = ey.map(v => -v); // and the top stays up
    const ex = [ey[1] * ez[2] - ey[2] * ez[1], ey[2] * ez[0] - ey[0] * ez[2], ey[0] * ez[1] - ey[1] * ez[0]];
    const P = [...ex, ...ey, ...ez]; // rows: new axes
    M = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => P[r * 3] * M[c] + P[r * 3 + 1] * M[3 + c] + P[r * 3 + 2] * M[6 + c]));
  }
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of points(M)) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  const len = mx[2] - mn[2], scale = spec.length / len;
  // The bore: centre of the foremost 0.6 % of the weapon.
  let bx = 0, by = 0, bn = 0; for (const p of points(M)) if (p[2] < mn[2] + len * .006) { bx += p[0]; by += p[1]; bn++; }
  const c = [bx / bn + (spec.bore?.[0] ?? 0) / scale, by / bn + (spec.bore?.[1] ?? 0) / scale, mn[2]];
  const quat = (() => { const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = M, tr = m00 + m11 + m22; let x, y, z, w;
    if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; w = .25 * S; x = (m21 - m12) / S; y = (m02 - m20) / S; z = (m10 - m01) / S; }
    else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / S; x = .25 * S; y = (m01 + m10) / S; z = (m02 + m20) / S; }
    else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / S; x = (m01 + m10) / S; y = .25 * S; z = (m12 + m21) / S; }
    else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / S; x = (m02 + m20) / S; y = (m12 + m21) / S; z = .25 * S; }
    return [x, y, z, w]; })();
  // Parts.
  const holder = doc.createNode('weapon').setRotation(quat).setScale([scale, scale, scale]);
  // p' = s (R p − c): rotate, then translate by −s c.
  holder.setTranslation([-scale * c[0], -scale * c[1], -scale * c[2]]);
  scene.addChild(holder);
  const partNodes = new Map(), partBounds = {};
  const partOf = n => { if (!lod) { const m = /__part_(\w+)$/.exec(n.getExtras().path ?? ''); if (m) return m[1]; for (const [name, re] of Object.entries(spec.parts ?? {})) if (re.test(n.getExtras().path)) return name; } return 'body'; };
  for (const n of live) {
    const name = partOf(n); let pn = partNodes.get(name); if (!pn) { pn = doc.createNode(name); partNodes.set(name, pn); holder.addChild(pn); }
    pn.addChild(n);
    const b = partBounds[name] ??= { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }, m = n.getMatrix(), e = [];
    for (const p of n.getMesh().listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { const w = mulPoint(m, a.getElement(i, e)), q = [0, 1, 2].map(k => (M[k * 3] * w[0] + M[k * 3 + 1] * w[1] + M[k * 3 + 2] * w[2] - c[k]) * scale); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], q[k]); b.max[k] = Math.max(b.max[k], q[k]); } } }
  }
  if (spec.cullAbove != null || spec.lens) for (const n of live) for (const prim of n.getMesh().listPrimitives()) {
    // Remove loose items baked into a single mesh (a cartridge floating above a revolver) by position.
    const m = n.getMatrix(), pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), e = [], keep = [];
    // Positions in the normalised frame.
    const P = Array.from({ length: pos.getCount() }, (_, i) => { const w = mulPoint(m, pos.getElement(i, e)); return [0, 1, 2].map(k => (M[k * 3] * w[0] + M[k * 3 + 1] * w[1] + M[k * 3 + 2] * w[2] - c[k]) * scale); });
    const count = idx ? idx.getCount() : pos.getCount(), at = i => idx ? idx.getScalar(i) : i;
    // Optic glass: flat faces across the sight line are cut out, so the sights can be looked through.
    const isLens = (a, b, d) => {
      const L = spec.lens; if (!L) return false;
      const u = b.map((v, k) => v - a[k]), w = d.map((v, k) => v - a[k]), nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], len = Math.hypot(...nrm) || 1;
      if (Math.abs(nrm[2] / len) < .9) return false;
      return [a, b, d].every(p => p[2] >= L.z[0] && p[2] <= L.z[1] && (L.box ? Math.abs(p[0]) <= L.box[0] && p[1] >= L.box[1] && p[1] <= L.box[2] : Math.hypot(p[0], p[1] - L.y) <= L.r));
    };
    for (let t = 0; t < count; t += 3) {
      const A = P[at(t)], B = P[at(t + 1)], D = P[at(t + 2)];
      if (spec.cullAbove != null && A[1] > spec.cullAbove && B[1] > spec.cullAbove && D[1] > spec.cullAbove) continue;
      if (isLens(A, B, D)) continue;
      keep.push(at(t), at(t + 1), at(t + 2));
    }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(root.listBuffers()[0]));
  }
  for (const n of root.listNodes()) if (!n.getMesh() && n !== holder && !partNodes.has(n.getName()) && !n.listChildren().length) n.dispose();
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const target = lod ? 2600 : 60000, ratio = Math.min(1, target / tris);
  await doc.transform(dedup(), join({ keepNamed: false }), weld(), ...(ratio < .98 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: lod ? .06 : .002, lockBorder: false })] : []), prune());
  for (const [name, pn] of partNodes) pn.setName(name);
  holder.setName('weapon');
  await texturesToKtx2(doc, path.join(cache, 'baked'), `${id}${lod ? '-lod' : ''}`, lod ? 256 : 1024);
  await doc.transform(prune({ keepExtras: false }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(ensureDir(path.join(ARENA, 'weapons')), `${id}${lod ? '-lod' : ''}.glb`);
  await io().write(out, doc);
  let after = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) after += p.getIndices().getCount() / 3;
  const round = b => ({ min: b.min.map(v => +v.toFixed(4)), max: b.max.map(v => +v.toFixed(4)) });
  if (!lod) {
    console.log(`  ${id.padEnd(10)} ${Math.round(tris)} tris, ${root.listMeshes().length} meshes, ${root.listTextures().length} textures, ${kb(out)}  (${spec.title})`);
    ledger.push({ asset: `arena/weapons/${id}.glb (+ ${id}-lod.glb)`, source: spec.ph ? `https://polyhaven.com/a/${spec.ph}` : spec.page, title: spec.title, license: spec.ph ? 'CC0 1.0' : spec.license, author: spec.ph ? 'Poly Haven' : spec.author, changes: 'Re-oriented and scaled, loose props removed, meshes merged, textures recompressed to KTX2; a simplified LOD was derived.', triangles: after });
  }
  return { id, triangles: after, bytes: fs.statSync(out).size, parts: Object.fromEntries(Object.entries(partBounds).map(([k, b]) => [k, round(b)])) };
}
async function arms() {
  const cache = ensureDir(path.join(CACHE, 'objaverse'));
  const doc = await io().read(await fetchCached(ARMS.url, path.join(cache, `${ARMS.uid}.glb`)));
  for (const m of doc.getRoot().listMaterials()) m.setAlphaMode('OPAQUE').setDoubleSided(false);
  await texturesToKtx2(doc, path.join(cache, 'baked'), 'arms', 1024);
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(ensureDir(path.join(ARENA, 'weapons')), 'arms.glb');
  await io().write(out, doc);
  console.log(`  arms       ${kb(out)}  (${ARMS.title})`);
  ledger.push({ asset: 'arena/weapons/arms.glb', source: ARMS.page, title: ARMS.title, license: ARMS.license, author: ARMS.author, changes: 'Textures recompressed to KTX2; posed at run time by inverse kinematics.' });
}

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const only = process.argv[2];
const manifestFile = path.join(ARENA, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
if (!only || only === 'textures') { await textures(); manifest.textures = Object.keys(SURFACES); }
if (!only || only === 'props') { manifest.props = []; for (const [k, spec] of Object.entries(PROPS)) manifest.props.push(await prop(k, spec)); }
if (!only || only === 'characters') { manifest.characters = []; for (const c of SOLDIERS) manifest.characters.push(await soldier(c)); }
if (!only || only === 'weapons') { manifest.weapons = []; const pick = process.argv[3]?.split(','); for (const [id, spec] of Object.entries(WEAPONS)) { if (pick && !pick.includes(id)) { const old = (JSON.parse(fs.readFileSync(manifestFile, 'utf8')).weapons ?? []).find(w => w.id === id); if (old) manifest.weapons.push(old); continue; } const full = await weapon(id, spec, false), low = await weapon(id, spec, true); manifest.weapons.push({ ...full, lodTriangles: low.triangles, lodBytes: low.bytes }); } await arms(); }
manifest.licence = 'Textures and props: Poly Haven, CC0 1.0. Characters: Microsoft Rocketbox Avatar Library, MIT License (Copyright (c) 2020 Microsoft).';
writeJSON(manifestFile, manifest);
const ledgerFile = path.join(CACHE, 'ledger-arena.json');
const prev = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : [];
writeJSON(ledgerFile, [...prev.filter(p => !ledger.some(l => l.asset === p.asset)), ...ledger]);
console.log('done');
