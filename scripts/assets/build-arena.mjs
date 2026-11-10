// Combat Arena asset pack: everything the arena draws that the campus does not need, written to
// public/assets/arena/ and loaded only when a player opens the arena.
//   textures/<key>/{color,normal,arm}.ktx2   Poly Haven PBR sets (CC0), 1k, Basis KTX2
//   props/<key>.glb                          Poly Haven photoscanned props (CC0), simplified, KTX2, meshopt
//   characters/<id>.glb + <id>-<part>-b.ktx2 Microsoft Rocketbox military avatars (MIT): body, head, tactical
//                                            equipment and helmet, in two team camouflage colourways
//   manifest.json                            what was built, sizes, heights, licences
// Run: node scripts/assets/build-arena.mjs [textures|props|characters]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, meshopt, center } from '@gltf-transform/functions';
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

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const only = process.argv[2];
const manifestFile = path.join(ARENA, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
if (!only || only === 'textures') { await textures(); manifest.textures = Object.keys(SURFACES); }
if (!only || only === 'props') { manifest.props = []; for (const [k, spec] of Object.entries(PROPS)) manifest.props.push(await prop(k, spec)); }
if (!only || only === 'characters') { manifest.characters = []; for (const c of SOLDIERS) manifest.characters.push(await soldier(c)); }
manifest.licence = 'Textures and props: Poly Haven, CC0 1.0. Characters: Microsoft Rocketbox Avatar Library, MIT License (Copyright (c) 2020 Microsoft).';
writeJSON(manifestFile, manifest);
const ledgerFile = path.join(CACHE, 'ledger-arena.json');
const prev = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : [];
writeJSON(ledgerFile, [...prev.filter(p => !ledger.some(l => l.asset === p.asset)), ...ledger]);
console.log('done');
