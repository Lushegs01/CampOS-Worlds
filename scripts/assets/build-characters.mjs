// Converts Microsoft Rocketbox avatars (MIT) into compact game-ready GLBs:
//   public/assets/characters/<id>.glb     skinned mesh, KTX2 textures, meshopt geometry
//   public/assets/characters/anim-<m|f>.glb  shared Biped animation library per body type
//   public/assets/characters/manifest.json   skin reference colours, clip speeds, heights
// Run: node scripts/assets/build-characters.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { prune, dedup, resample, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { shapeAmara } from './shape-amara.mjs';
import { CACHE, OUT, ROOT, ensureDir, fetchCached, decodeTGA, encodeKTX2Batch, writeJSON, kb } from './common.mjs';

const RB = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master';
const RB_CACHE = path.join(CACHE, 'rocketbox');
const OUT_DIR = ensureDir(path.join(OUT, 'characters'));
const FBX2GLTF = path.join(ROOT, 'node_modules', 'fbx2gltf', 'bin', process.platform === 'win32' ? 'Windows_NT' : process.platform === 'darwin' ? 'Darwin' : 'Linux', process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF');

// A diverse cast of everyday students. Names are fictional; `skin` is the default tone.
export const CAST = [
  { id: 'tunde', name: 'Tunde', src: 'Adults/Male_Adult_12', body: 'm', style: 'Denim jacket' },
  { id: 'chidi', name: 'Chidi', src: 'Adults/Male_Adult_18', body: 'm', style: 'Knit hoodie' },
  { id: 'kelechi', name: 'Kelechi', src: 'Adults/Male_Adult_04', body: 'm', style: 'Leather jacket' },
  { id: 'ibrahim', name: 'Ibrahim', src: 'Adults/Male_Adult_17', body: 'm', style: 'Track jacket' },
  { id: 'ngozi', name: 'Ngozi', src: 'Professions/Business_Female_01', body: 'f', style: 'Smart blazer' },
  { id: 'amara', name: 'Amara', src: 'Adults/Female_Adult_12', body: 'f', style: 'Zip hoodie' },
  { id: 'zainab', name: 'Zainab', src: 'Adults/Female_Adult_06', body: 'f', style: 'Hijab & abaya' },
  { id: 'ada', name: 'Ada', src: 'Adults/Female_Adult_08', body: 'f', style: 'Graphic tee' },
  // Female_Adult_11 stands left of centre in Rocketbox's preview render: `portrait` moves the picker crop (default .41).
  { id: 'mel', name: 'Mel', src: 'Adults/Female_Adult_11', body: 'f', style: 'Sweater dress & boots', portrait: .383 },
];

// Motion-captured clips. `xy` clips have horizontal root motion we measure, then remove.
const CLIPS = {
  idle: 'static/{g}_idle_neutral_01', look: 'static/{g}_idle_look_around_01', walk: 'xy/{g}_walk_neutral_01', jog: 'xy/{g}_run_slow_01',
  run: 'xy/{g}_run_fast_01', wave: 'static/{g}_wave_01', dance: 'static/{g}_dancing_neutral', cheer: 'static/{g}_cheer_01',
  // Seating: motion-captured transitions keep their root motion so seat alignment can be computed.
  sitDown: 'xyz/{g}_sit_down_chair_01', standUp: 'xyz/{g}_sit_stand_up_chair_01', sitDownTable: 'xyz/{g}_sit_down_table_left', standUpTable: 'xyz/{g}_sit_stand_up_table_left',
  sitIdle: 'static/{g}_sit_chair_idle_neutral_01', sitLook: 'static/{g}_sit_chair_idle_look_around', sitTable: 'static/{g}_sit_table_idle_neutral_01',
  // Doors, picking things up and holding an object in front of the body.
  doorPush: 'static/{g}_try_door_inwards', doorPull: 'static/{g}_try_door_outwards', crouch: 'static/{g}_crouch_idle', holdFront: 'static/{g}_documents_idle',
};
const KEEP_ROOT = new Set(['sitDown', 'standUp', 'sitDownTable', 'standUpTable']);

function fbx2glb(fbx, outBase) {
  if (!fs.existsSync(outBase + '.glb')) execFileSync(FBX2GLTF, ['--binary', '--anim-framerate', 'bake30', '--input', fbx, '--output', outBase], { stdio: 'pipe' });
  return outBase + '.glb';
}

const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const lin = (c) => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
function lab(r, g, b) { // sRGB 0..255 -> CIE Lab (D65)
  const R = lin(r), G = lin(g), B = lin(b);
  let X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722, Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883;
  const f = (t) => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

/** Estimate the dominant skin colour from the head texture: median of warm, mid-saturation texels. */
function skinReference(head) {
  const samples = [];
  for (let i = 0; i < head.width * head.height; i += 7) {
    const r = head.data[i * 4], g = head.data[i * 4 + 1], b = head.data[i * 4 + 2];
    const [L, A, B] = lab(r, g, b); const hue = Math.atan2(B, A) * 57.3, chroma = Math.hypot(A, B);
    if (L > 18 && L < 85 && hue > 20 && hue < 80 && chroma > 8 && chroma < 45) samples.push([L, A, B, r, g, b]);
  }
  const med = (k) => samples.map(s => s[k]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  return { L: med(0), A: med(1), B: med(2), srgb: [med(3), med(4), med(5)] };
}

/** Soft skin mask: closeness to the reference in chroma, with a generous lightness window. */
function skinMask(img, ref) {
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) {
    const [L, A, B] = lab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    const dc = Math.hypot(A - ref.A, B - ref.B), dl = Math.abs(L - ref.L);
    const wc = 1 - Math.min(1, Math.max(0, (dc - 7) / 9)), wl = 1 - Math.min(1, Math.max(0, (dl - 22) / 14));
    m[i] = Math.round(255 * wc * wl);
  }
  return m;
}

async function rawToPng(rgba, width, height, size) {
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
}

async function buildCharacter(c, tree) {
  const dir = ensureDir(path.join(RB_CACHE, path.basename(c.src)));
  const base = path.basename(c.src);
  const files = tree.filter(t => t.path.startsWith(`Assets/Avatars/${c.src}/`));
  const fbx = await fetchCached(`${RB}/Assets/Avatars/${c.src}/Export/${base}.fbx`, path.join(dir, `${base}.fbx`));
  const textures = {};
  for (const t of files.filter(t => t.path.endsWith('.tga'))) {
    const name = path.basename(t.path), key = name.replace(/^[mf]\d+_/, '').replace('.tga', '');
    textures[key] = await fetchCached(`${RB}/${t.path}`, path.join(dir, 'Textures', name));
  }
  const glb = fbx2glb(fbx, path.join(dir, 'raw'));
  const doc = await io().read(glb);
  if (c.id === 'amara') shapeAmara(doc);
  const head = decodeTGA(fs.readFileSync(textures.head_color));
  const ref = skinReference(head);

  // Pre-bake every texture variant, then encode all to KTX2 in parallel.
  const tmp = ensureDir(path.join(dir, 'baked'));
  const jobs = [];
  const bake = async (part) => {
    const color = decodeTGA(fs.readFileSync(textures[`${part}_color`]));
    const spec = decodeTGA(fs.readFileSync(textures[`${part}_specular`]));
    const mask = skinMask(color, ref);
    const packed = new Uint8Array(color.width * color.height * 4);
    for (let i = 0; i < mask.length; i++) {
      const s = spec.data[i * 4] / 255, skin = mask[i] / 255;
      // Rocketbox specular is a Blinn-Phong intensity map; skin reads best near 0.5 roughness.
      const rough = skin > .5 ? .62 - s * .25 : .93 - s * .45;
      packed[i * 4] = mask[i]; packed[i * 4 + 1] = Math.round(Math.min(.97, Math.max(.3, rough)) * 255); packed[i * 4 + 2] = 0; packed[i * 4 + 3] = 255;
    }
    const size = 1024;
    fs.writeFileSync(path.join(tmp, `${part}_color.png`), await rawToPng(color.data, color.width, color.height, size));
    fs.writeFileSync(path.join(tmp, `${part}_mr.png`), await rawToPng(packed, color.width, color.height, 512));
    const normal = decodeTGA(fs.readFileSync(textures[`${part}_normal`]));
    fs.writeFileSync(path.join(tmp, `${part}_normal.png`), await rawToPng(normal.data, normal.width, normal.height, size));
    // Mask previews let a human verify the classifier on each texture.
    await sharp(Buffer.from(mask), { raw: { width: color.width, height: color.height, channels: 1 } }).resize(512, 512).png().toFile(path.join(tmp, `${part}_mask_preview.png`));
    jobs.push({ in: path.join(tmp, `${part}_color.png`), out: path.join(tmp, `${part}_color.ktx2`), kind: 'color', quality: 220 });
    jobs.push({ in: path.join(tmp, `${part}_mr.png`), out: path.join(tmp, `${part}_mr.ktx2`), kind: 'linear', quality: 160 });
    jobs.push({ in: path.join(tmp, `${part}_normal.png`), out: path.join(tmp, `${part}_normal.ktx2`), kind: 'normal', quality: 230 });
  };
  await bake('body'); await bake('head');
  if (textures.opacity_color) {
    const op = decodeTGA(fs.readFileSync(textures.opacity_color));
    fs.writeFileSync(path.join(tmp, 'opacity_color.png'), await rawToPng(op.data, op.width, op.height, 512));
    jobs.push({ in: path.join(tmp, 'opacity_color.png'), out: path.join(tmp, 'opacity_color.ktx2'), kind: 'color', quality: 220 });
  }
  await encodeKTX2Batch(jobs);

  const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);
  const tex = (file, name) => doc.createTexture(name).setImage(new Uint8Array(fs.readFileSync(path.join(tmp, file)))).setMimeType('image/ktx2').setURI(name + '.ktx2');
  const shared = {};
  for (const mat of doc.getRoot().listMaterials()) {
    const part = mat.getName().endsWith('_head') ? 'head' : mat.getName().endsWith('_opacity') ? 'opacity' : 'body';
    mat.setName(part);
    if (part === 'opacity') {
      mat.setBaseColorTexture(shared.op ??= tex('opacity_color.ktx2', `${c.id}-hair`)).setAlphaMode('MASK').setAlphaCutoff(.35).setDoubleSided(true).setRoughnessFactor(.7).setMetallicFactor(0);
      continue;
    }
    mat.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(tex(`${part}_color.ktx2`, `${c.id}-${part}-color`))
      .setNormalTexture(tex(`${part}_normal.ktx2`, `${c.id}-${part}-normal`))
      .setMetallicRoughnessTexture(tex(`${part}_mr.ktx2`, `${c.id}-${part}-mr`)).setRoughnessFactor(1).setMetallicFactor(1)
      .setAlphaMode('OPAQUE').setDoubleSided(false);
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('COLOR_0', null);
  for (const anim of doc.getRoot().listAnimations()) anim.dispose();
  for (const img of doc.getRoot().listTextures()) if (!img.getMimeType().includes('ktx2')) img.dispose();
  void basisu;
  // Measure before quantization: standing height (mesh is Z-up in bind space) and hip height.
  const bip = doc.getRoot().listNodes().find(n => n.getName() === 'Bip01');
  let top = 0; for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) top = Math.max(top, prim.getAttribute('POSITION').getMax([0, 0, 0])[2]);
  await doc.transform(dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT_DIR, `${c.id}.glb`);
  await io().write(out, doc);

  const linRef = ref.srgb.map(v => +lin(v).toFixed(4));
  // Portrait for the character picker, cropped from Rocketbox's own preview render.
  const preview = await fetchCached(`${RB}/Assets/Avatars/${c.src}/${base}.png`, path.join(dir, `${base}.png`));
  const meta = await sharp(preview).metadata();
  await sharp(preview).extract({ left: Math.round(meta.width * (c.portrait ?? .41)), top: Math.round(meta.height * .02), width: Math.round(meta.width * .18), height: Math.round(meta.height * .3) }).resize(160, 200).flatten({ background: '#22352d' }).webp({ quality: 80 }).toFile(path.join(OUT_DIR, `${c.id}.webp`));
  console.log(`  ${c.id}: ${kb(out)} skin ${ref.srgb} height ${top.toFixed(2)}m hip ${bip.getTranslation()[1].toFixed(3)}`);
  return { id: c.id, name: c.name, body: c.body, style: c.style, source: `${RB.replace('raw.githubusercontent.com', 'github.com').replace('/master', '/tree/master')}/Assets/Avatars/${c.src}`, skinRef: linRef, height: +top.toFixed(3), hip: +bip.getTranslation()[1].toFixed(4) };
}

/** Merge the clips for one body type into a single animation library GLB. */
async function buildAnimations(g) {
  const dir = ensureDir(path.join(RB_CACHE, 'anims'));
  const speeds = {}, offsets = {};
  let master = null, masterNodes = null;
  for (const [name, spec] of Object.entries(CLIPS)) {
    const [folder, file] = spec.replace('{g}', g).split('/');
    const fbx = await fetchCached(`${RB}/Assets/Animations/all_animations_max_motextr_${folder}/${file}.max.fbx`, path.join(dir, `${file}.fbx`));
    const doc = await io().read(fbx2glb(fbx, path.join(dir, file)));
    const anim = doc.getRoot().listAnimations()[0];
    // Keep bone rotations plus root translation; per-bone offsets belong to each model's own proportions.
    let rootSampler = null;
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode(), keep = ch.getTargetPath() === 'rotation' ? node.getName() !== 'Bip01 Footsteps' : node.getName() === 'Bip01' && ch.getTargetPath() === 'translation';
      if (!keep) { ch.dispose(); continue; }
      if (node.getName() === 'Bip01' && ch.getTargetPath() === 'translation') rootSampler = ch.getSampler();
    }
    if (rootSampler) {
      const input = rootSampler.getInput().getArray(), out = rootSampler.getOutput(), arr = out.getArray().slice(), n = input.length, dur = input[n - 1] - input[0];
      const x0 = arr[0], z0 = arr[2], dx = arr[(n - 1) * 3] - x0, dz = arr[(n - 1) * 3 + 2] - z0;
      if (KEEP_ROOT.has(name)) {
        // Transitions start at the origin and keep their travel (e.g. backing onto a seat).
        for (let i = 0; i < n; i++) { arr[i * 3] -= x0; arr[i * 3 + 2] -= z0; }
        offsets[name] = { start: [0, +arr[1].toFixed(4), 0], end: [+dx.toFixed(4), +arr[(n - 1) * 3 + 1].toFixed(4), +dz.toFixed(4)], duration: +dur.toFixed(3) };
      } else {
        speeds[name] = +(Math.hypot(dx, dz) / dur).toFixed(3);
        for (let i = 0; i < n; i++) { const t = (input[i] - input[0]) / dur; arr[i * 3] -= x0 + dx * t; arr[i * 3 + 2] -= z0 + dz * t; }
      }
      out.setArray(arr);
    }
    anim.setName(name);
    if (!master) { master = doc; masterNodes = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n])); continue; }
    // Copy this clip's channels into the master document, retargeting by bone name.
    const target = master.createAnimation(name), buffer = master.getRoot().listBuffers()[0];
    for (const ch of anim.listChannels()) {
      const s = ch.getSampler(), node = masterNodes.get(ch.getTargetNode().getName()); if (!node) continue;
      const input = master.createAccessor().setArray(s.getInput().getArray().slice()).setType('SCALAR').setBuffer(buffer);
      const output = master.createAccessor().setArray(s.getOutput().getArray().slice()).setType(s.getOutput().getType()).setBuffer(buffer);
      const sampler = master.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
      target.addSampler(sampler).addChannel(master.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    }
  }
  for (const mesh of master.getRoot().listMeshes()) mesh.dispose();
  await master.transform(resample({ tolerance: 1e-4 }), prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT_DIR, `anim-${g}.glb`);
  await io().write(out, master);
  const idleRoot = masterNodes.get('Bip01').getTranslation()[1];
  console.log(`  anim-${g}: ${kb(out)} speeds ${JSON.stringify(speeds)} offsets ${JSON.stringify(offsets)}`);
  return { speeds, offsets, rootHeight: +idleRoot.toFixed(4) };
}

await MeshoptEncoder.ready;
const tree = JSON.parse(fs.readFileSync(await fetchCached('https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1', path.join(RB_CACHE, 'api', 'tree.json')), 'utf8')).tree;
const filter = process.argv[2];
const characters = [];
for (const c of CAST) { if (filter && filter !== 'anims' && c.id !== filter) continue; if (filter === 'anims') break; characters.push(await buildCharacter(c, tree)); }
const animations = (!filter || filter === 'anims') ? { m: await buildAnimations('m'), f: await buildAnimations('f') } : null;
const manifestFile = path.join(OUT_DIR, 'manifest.json');
const prev = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { characters: [], animations: {} };
const merged = { licence: 'Microsoft Rocketbox Avatar Library, MIT License (Copyright (c) 2020 Microsoft)', characters: CAST.map(c => characters.find(x => x.id === c.id) || prev.characters.find(x => x.id === c.id)).filter(Boolean), animations: animations || prev.animations };
writeJSON(manifestFile, merged);
console.log('done');
