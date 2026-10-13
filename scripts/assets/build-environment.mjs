// Builds environment assets: PBR surface sets, sky/HDRI lighting and foliage card atlases.
// All sources are Poly Haven (CC0). Run: node scripts/assets/build-environment.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CACHE, OUT, ensureDir, fetchCached, fetchJson, decodeHDR, encodeHDR, encodeKTX2Batch, writeJSON, kb } from './common.mjs';

const PH = path.join(CACHE, 'polyhaven');
const TEX_OUT = ensureDir(path.join(OUT, 'textures'));
const ledger = [];

// key -> Poly Haven id. Keys are what the runtime material library refers to.
export const SURFACES = {
  grass: 'leafy_grass', grass2: 'sparse_grass', laterite: 'red_laterite_soil_stones',
  pavers: 'interlocking_concrete_pavers', paversGrey: 'patterned_concrete_pavers', hexPaving: 'hexagonal_concrete_paving',
  stucco: 'white_stucco', plaster: 'plastered_wall_04', concrete: 'concrete_wall_008', ribbed: 'ribbed_concrete_wall',
  brushed: 'brushed_concrete', brick: 'large_red_bricks', roof: 'box_profile_metal_sheet', terrazzo: 'terrazzo_tiles',
  granite: 'granite_tile', palmBark: 'palm_tree_bark', asphalt: 'asphalt_02', track: 'rubberized_track', wood: 'wood_table_worn',
};

async function surfaces() {
  const jobs = [];
  for (const [key, id] of Object.entries(SURFACES)) {
    const files = await fetchJson(`https://api.polyhaven.com/files/${id}`, path.join(PH, 'api', `files_${id}.json`));
    const pick = (k) => files[k]?.['1k']?.jpg?.url;
    const maps = { color: pick('Diffuse'), normal: pick('nor_gl'), arm: pick('arm') };
    for (const [slot, url] of Object.entries(maps)) {
      if (!url) throw new Error(`${id} missing ${slot}`);
      const src = await fetchCached(url, path.join(PH, 'textures', id, path.basename(url)));
      jobs.push({ in: src, out: path.join(TEX_OUT, key, `${slot}.ktx2`), kind: slot === 'color' ? 'color' : slot === 'normal' ? 'normal' : 'linear', flipY: true });
    }
    ledger.push({ asset: `textures/${key}`, source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0', author: 'Poly Haven' });
  }
  // Bark for broadleaf trees comes from the island tree scan's branch material.
  const tree = await fetchJson('https://api.polyhaven.com/files/island_tree_01', path.join(PH, 'api', 'files_island_tree_01.json'));
  const inc = tree.gltf['1k'].gltf.include;
  for (const [slot, suffix, kind] of [['color', 'branches_diff_1k.jpg', 'color'], ['normal', 'branches_nor_gl_1k.jpg', 'normal'], ['arm', 'branches_arm_1k.jpg', 'linear']]) {
    const entry = Object.entries(inc).find(([k]) => k.endsWith(suffix))[1];
    const src = await fetchCached(entry.url, path.join(PH, 'models', 'island_tree_01', suffix));
    jobs.push({ in: src, out: path.join(TEX_OUT, 'bark', `${slot}.ktx2`), kind, flipY: true });
  }
  ledger.push({ asset: 'textures/bark', source: 'https://polyhaven.com/a/island_tree_01 (branch material)', license: 'CC0 1.0', author: 'Poly Haven' });
  await encodeKTX2Batch(jobs);
}

// ---------------------------------------------------------------- sky + lighting
async function sky() {
  const id = 'kloofendal_48d_partly_cloudy_puresky';
  const hdrFile = await fetchCached(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${id}_2k.hdr`, path.join(PH, 'hdri', `${id}_2k.hdr`));
  const hdr = decodeHDR(fs.readFileSync(hdrFile));
  const { width: W, height: H, data } = hdr;
  // Locate the sun: luminance-weighted centroid of the brightest pixels.
  let max = 0; for (let i = 0; i < W * H; i++) { const l = data[i * 3] * .2126 + data[i * 3 + 1] * .7152 + data[i * 3 + 2] * .0722; if (l > max) max = l; }
  let sx = 0, sy = 0, sw = 0, sunEnergy = [0, 0, 0];
  const isSun = (l) => l > max * 0.02;
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3, l = data[o] * .2126 + data[o + 1] * .7152 + data[o + 2] * .0722;
    if (isSun(l)) { sx += x * l; sy += y * l; sw += l; const solid = Math.cos((y + .5) / H * Math.PI - Math.PI / 2) * (2 * Math.PI / W) * (Math.PI / H); for (let c = 0; c < 3; c++) sunEnergy[c] += data[o + c] * solid; }
  }
  sx /= sw; sy /= sw;
  const u = (sx + .5) / W, v = (sy + .5) / H, phi = u * 2 * Math.PI, theta = v * Math.PI;
  // Matches three.js equirect mapping (u = atan(dir.z, dir.x)/2π + .5, v = asin(dir.y)/π + .5 with flipY).
  const dirY = Math.cos(theta), r = Math.sin(theta);
  const sunDir = [-Math.cos(phi) * r, dirY, -Math.sin(phi) * r].map(n => +n.toFixed(4));
  // Remove the sun disc from the lighting map (a directional light provides it) and replace the
  // mirrored lower hemisphere with warm ground bounce so walls receive realistic fill from below.
  const env = new Float32Array(data);
  let horizon = [0, 0, 0], hn = 0;
  for (let x = 0; x < W; x++) { const o = (Math.floor(H * .49) * W + x) * 3; for (let c = 0; c < 3; c++) horizon[c] += data[o + c]; hn++; }
  horizon = horizon.map(c => c / hn);
  const ground = [0.33, 0.30, 0.2].map((a, c) => a * 1.6); // sunlit grass/laterite average radiance (linear)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3, l = data[o] * .2126 + data[o + 1] * .7152 + data[o + 2] * .0722;
    if (y < H / 2 && isSun(l * 4)) { const k = Math.min(1, (max * 0.005) / l); for (let c = 0; c < 3; c++) env[o + c] = Math.min(data[o + c], data[o + c] * k); }
    if (y >= H / 2) { const t = Math.min(1, (y - H / 2) / (H * 0.06)); for (let c = 0; c < 3; c++) env[o + c] = horizon[c] * (1 - t) + ground[c] * t; }
  }
  // Light-probe map at 1k (the PMREM blurs it anyway).
  const small = downsampleHDR({ width: W, height: H, data: env }, 2);
  ensureDir(path.join(OUT, 'sky'));
  fs.writeFileSync(path.join(OUT, 'sky', 'environment.hdr'), encodeHDR(small));
  // Visible sky: upper hemisphere + 8° below the horizon, stored as scaled sRGB so it can be
  // decoded back to linear radiance and tone-mapped consistently with the scene.
  const big = decodeHDR(fs.readFileSync(await fetchCached(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/${id}_4k.hdr`, path.join(PH, 'hdri', `${id}_4k.hdr`))));
  const BW = big.width, bands = Math.round(big.height * (98 / 180)), scale = 4.0, rgba = Buffer.alloc(BW * bands * 3);
  const toSRGB = (x) => { x = Math.max(0, Math.min(1, x)); return x <= .0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - .055; };
  for (let y = 0; y < bands; y++) for (let x = 0; x < BW; x++) { const o = (y * BW + x) * 3; for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(toSRGB(big.data[o + c] / scale) * 255); }
  await sharp(rgba, { raw: { width: BW, height: bands, channels: 3 } }).jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(path.join(OUT, 'sky', 'sky.jpg'));
  await sharp(rgba, { raw: { width: BW, height: bands, channels: 3 } }).resize(2048, Math.round(bands / 2)).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, 'sky', 'sky-low.jpg'));
  const sunLum = sunEnergy[0] * .2126 + sunEnergy[1] * .7152 + sunEnergy[2] * .0722;
  const meta = { source: id, sunDirection: sunDir, sunColor: sunEnergy.map(c => +(c / sunLum).toFixed(4)), sunIrradiance: +sunLum.toFixed(3), skyScale: scale, skyCoverage: 98 / 180, horizon: horizon.map(c => +c.toFixed(4)) };
  writeJSON(path.join(OUT, 'sky', 'sky.json'), meta);
  console.log('  sky', meta, kb(path.join(OUT, 'sky', 'sky.jpg')), kb(path.join(OUT, 'sky', 'environment.hdr')));
  ledger.push({ asset: 'sky/*', source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0', author: 'Greg Zaal, Jarod Guest (Poly Haven)' });
}

function downsampleHDR({ width, height, data }, f) {
  const w = width / f, h = height / f, out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += data[((y * f + j) * width + x * f + i) * 3 + c]; out[(y * w + x) * 3 + c] = s / (f * f); }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------- foliage cards
async function keyedAtlas(file, threshold = 18) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i++) {
    const m = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    data[i * 4 + 3] = m < threshold ? 0 : m < threshold * 2.2 ? Math.round((m - threshold) / (threshold * 1.2) * 255) : 255;
  }
  return { data, width: info.width, height: info.height };
}

function components(img, minArea) {
  const { width: W, height: H, data } = img, step = 4, w = Math.ceil(W / step), h = Math.ceil(H / step), seen = new Uint8Array(w * h), boxes = [];
  const solid = (x, y) => data[((y * step) * W + x * step) * 4 + 3] > 128;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (seen[y * w + x] || !solid(x, y)) continue;
    let minX = x, maxX = x, minY = y, maxY = y, n = 0; const stack = [[x, y]]; seen[y * w + x] = 1;
    while (stack.length) { const [cx, cy] = stack.pop(); n++; minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !solid(nx, ny)) continue; seen[ny * w + nx] = 1; stack.push([nx, ny]); } }
    if (n * step * step >= minArea) boxes.push({ left: Math.max(0, minX * step - 4), top: Math.max(0, minY * step - 4), width: Math.min(W, (maxX + 1) * step + 4) - Math.max(0, minX * step - 4), height: Math.min(H, (maxY + 1) * step + 4) - Math.max(0, minY * step - 4) });
  }
  return boxes;
}

async function crop(img, box) {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).extract(box).png().toBuffer();
}

// Place a sprite so that its anchor (ax, ay in 0..1) lands at (px, py), rotated by deg clockwise.
async function placed(png, deg, scale, px, py, ax = .5, ay = 1, tint) {
  let s = sharp(png); const m = await s.metadata();
  const w = Math.max(2, Math.round(m.width * scale)), h = Math.max(2, Math.round(m.height * scale));
  let img = sharp(png).resize(w, h);
  if (tint) img = img.modulate(tint);
  const rotated = await sharp(await img.png().toBuffer()).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const rm = await sharp(rotated).metadata();
  const a = deg * Math.PI / 180, vx = (ax - .5) * w, vy = (ay - .5) * h;
  const rx = vx * Math.cos(a) - vy * Math.sin(a), ry = vx * Math.sin(a) + vy * Math.cos(a);
  return { input: rotated, left: Math.round(px - (rm.width / 2 + rx)), top: Math.round(py - (rm.height / 2 + ry)) };
}

function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

async function cell(size, parts) {
  const visible = parts.filter(p => p.left > -size && p.top > -size && p.left < size && p.top < size);
  // sharp cannot composite outside the canvas, so pad, composite, then crop back.
  const pad = size;
  const shifted = visible.map(p => ({ ...p, left: p.left + pad, top: p.top + pad }));
  const big = await sharp({ create: { width: size * 3, height: size * 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(shifted).png().toBuffer();
  return sharp(big).extract({ left: pad, top: pad, width: size, height: size }).png().toBuffer();
}

function svgFlowers(size, count, colors, seed, radius) {
  const r = rng(seed); let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`;
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius, cx = size / 2 + Math.cos(a) * d, cy = size * .45 + Math.sin(a) * d * .8, col = colors[Math.floor(r() * colors.length)], pr = 7 + r() * 9;
    for (let k = 0; k < 5; k++) { const pa = k / 5 * Math.PI * 2 + r(); s += `<ellipse cx="${cx + Math.cos(pa) * pr * .7}" cy="${cy + Math.sin(pa) * pr * .7}" rx="${pr * .62}" ry="${pr * .36}" transform="rotate(${pa * 57.3} ${cx + Math.cos(pa) * pr * .7} ${cy + Math.sin(pa) * pr * .7})" fill="${col}" opacity="${.85 + r() * .15}"/>`; }
    s += `<circle cx="${cx}" cy="${cy}" r="${pr * .22}" fill="#f2d36b"/>`;
  }
  return Buffer.from(s + '</svg>');
}

async function foliage() {
  const tree = await fetchJson('https://api.polyhaven.com/files/island_tree_01', path.join(PH, 'api', 'files_island_tree_01.json'));
  const jac = await fetchJson('https://api.polyhaven.com/files/jacaranda_tree', path.join(PH, 'api', 'files_jacaranda_tree.json'));
  const small = await fetchJson('https://api.polyhaven.com/files/tree_small_02', path.join(PH, 'api', 'files_tree_small_02.json'));
  const get = async (files, id, suffix) => { const e = Object.entries(files.gltf['1k'].gltf.include).find(([k]) => k.endsWith(suffix))[1]; return fetchCached(e.url, path.join(PH, 'models', id, suffix)); };
  const broadAtlas = await keyedAtlas(await get(tree, 'island_tree_01', 'leaves_diff_1k.jpg'));
  const pinnateAtlas = await keyedAtlas(await get(jac, 'jacaranda_tree', 'leaves_diff_1k.jpg'));
  const smallAtlas = await keyedAtlas(await get(small, 'tree_small_02', 'leaves_diff_1k.jpg'));
  ledger.push({ asset: 'foliage/* (leaf silhouettes and colour)', source: 'https://polyhaven.com/a/island_tree_01, https://polyhaven.com/a/jacaranda_tree, https://polyhaven.com/a/tree_small_02', license: 'CC0 1.0', author: 'Poly Haven; cards composed by scripts/assets/build-environment.mjs' });
  const broad = await Promise.all(components(broadAtlas, 6000).map(b => crop(broadAtlas, b)));
  const pinnate = await Promise.all(components(pinnateAtlas, 12000).map(b => crop(pinnateAtlas, b)));
  console.log(`  leaves: ${broad.length} broad, ${pinnate.length} pinnate`);
  const S = 512, out = ensureDir(path.join(OUT, 'foliage'));
  void smallAtlas;
  // Work out which end of each scanned leaf is the stem, so it can be rotated to point outwards.
  const describe = async (png) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true }); const W = info.width, H = info.height;
    const mass = (x0, x1, y0, y1) => { let m = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m += data[(y * W + x) * 4 + 3]; return m; };
    const wide = W > H, k = .14;
    if (wide) { const a = mass(0, Math.round(W * k), 0, H), b = mass(Math.round(W * (1 - k)), W, 0, H); return a < b ? { png, ax: .02, ay: .5, base: 0, len: W } : { png, ax: .98, ay: .5, base: 180, len: W }; }
    const a = mass(0, W, 0, Math.round(H * k)), b = mass(0, W, Math.round(H * (1 - k)), H); return a < b ? { png, ax: .5, ay: .02, base: 90, len: H } : { png, ax: .5, ay: .98, base: -90, len: H };
  };
  const broadD = await Promise.all(broad.map(describe)), pinnD = await Promise.all(pinnate.map(describe));
  const radial = (d, dirDeg, length, px, py, tint) => placed(d.png, dirDeg - d.base, length / d.len, px, py, d.ax, d.ay, tint);

  // Broadleaf rosettes (Terminalia / almond / mango): leaves radiate from a twig tip.
  const broadCells = [];
  for (let v = 0; v < 4; v++) {
    const r = rng(11 + v * 7), parts = [];
    parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><path d="M${S / 2} ${S * .97} Q ${S / 2 + 14} ${S * .75} ${S / 2} ${S * .52}" stroke="#5b4a35" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`), left: 0, top: 0 });
    const n = v === 3 ? 10 : 12 + v * 2;
    for (let i = 0; i < n; i++) {
      const d = broadD[Math.floor(r() * broadD.length)], dir = -90 + ((i / n) * 330 - 165) + (r() - .5) * 22;
      const tint = v === 2 ? { brightness: .9 + r() * .2, saturation: .85, hue: -6 } : { brightness: .78 + r() * .32, saturation: .95 + r() * .2 };
      parts.push(await radial(d, dir, S * (.36 + r() * .08), S / 2, S * .5, tint));
    }
    broadCells.push(await cell(S, parts));
  }
  // Pinnate sprays (flamboyant, neem, rain tree), two with Delonix flame flowers.
  const pinnCells = [];
  for (let v = 0; v < 4; v++) {
    const r = rng(29 + v * 13), parts = [], n = 8;
    for (let i = 0; i < n; i++) parts.push(await radial(pinnD[Math.floor(r() * pinnD.length)], (i / n) * 360 + (r() - .5) * 30, S * (.4 + r() * .06), S / 2, S / 2, { brightness: .85 + r() * .25, saturation: 1.05 }));
    if (v >= 2) parts.push({ input: svgFlowers(S, 30, ['#e2471f', '#f0602a', '#c9341b', '#f39a2e'], 3 + v, S * .3), left: 0, top: 0 });
    pinnCells.push(await cell(S, parts));
  }
  // Hedge / shrub cells: dense clusters of small glossy leaves (Ixora, Duranta, Croton), two in flower.
  const hedgeCells = [];
  for (let v = 0; v < 4; v++) {
    const r = rng(47 + v * 5), parts = [];
    for (let i = 0; i < 90; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * .33; parts.push(await radial(broadD[Math.floor(r() * broadD.length)], r() * 360, S * (.1 + r() * .05), S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, { brightness: .55 + r() * .4, saturation: 1.1 + r() * .2, hue: v === 1 ? 8 : 0 })); }
    if (v === 2) parts.push({ input: svgFlowers(S, 40, ['#d8232a', '#e8402e', '#c81d3a'], 9, S * .34), left: 0, top: 0 });
    if (v === 3) parts.push({ input: svgFlowers(S, 26, ['#f2b630', '#f7d046', '#ffffff', '#e86aa6'], 15, S * .34), left: 0, top: 0 });
    hedgeCells.push(await cell(S, parts));
  }
  const atlas = async (cells, file) => {
    const png = await sharp({ create: { width: S * 2, height: S * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(cells.map((c, i) => ({ input: c, left: (i % 2) * S, top: Math.floor(i / 2) * S }))).png().toBuffer();
    // Bleed colour into transparent texels so mip levels don't fringe dark.
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const blurred = await sharp(png).flatten({ background: '#3c4a2a' }).blur(6).raw().toBuffer();
    for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] < 8) { data[i * 4] = blurred[i * 3]; data[i * 4 + 1] = blurred[i * 3 + 1]; data[i * 4 + 2] = blurred[i * 3 + 2]; }
    fs.writeFileSync(path.join(CACHE, file + '.png'), await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
    return { raw: { data: new Uint8Array(data), width: info.width, height: info.height }, out: path.join(out, file + '.ktx2'), kind: 'color', flipY: true, quality: 200, force: true };
  };
  const frond = await palmFrond();
  const jobs = [await atlas(broadCells, 'leaf-broad'), await atlas(pinnCells, 'leaf-pinnate'), await atlas(hedgeCells, 'leaf-hedge'), frond];
  await encodeKTX2Batch(jobs);
}

// Palm fronds are authored procedurally: a tapered rachis with drooping, overlapping leaflets
// whose surface detail is sampled from the scanned jacaranda leaflet colour.
async function palmFrond() {
  const W = 1024, H = 256, r = rng(5);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  const n = 96;
  for (let i = 0; i < n; i++) {
    const t = i / n, x = 26 + t * (W - 44), L = H * .47 * Math.pow(Math.sin(Math.PI * (.06 + t * .94)), .65) * (.86 + r() * .22), w = 2.6 + 2.4 * (1 - t);
    for (const side of [-1, 1]) {
      const a = (50 + r() * 16) * Math.PI / 180, tx = x + Math.cos(a) * L, ty = H / 2 + side * Math.sin(a) * L;
      const mx = x + Math.cos(a) * L * .5, my = H / 2 + side * Math.sin(a) * L * .5, nx = -Math.sin(a) * side, ny = Math.cos(a);
      const g = Math.floor(r() * 4), col = ['#4b6b24', '#58782b', '#668632', '#73903a'][g], tip = ['#6d8a35', '#7b963c', '#869d45', '#91a650'][g];
      s += `<defs><linearGradient id="l${i}${side}" x1="${x}" y1="${H / 2}" x2="${tx}" y2="${ty}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="${tip}"/></linearGradient></defs>`;
      s += `<path d="M${x - 1.5} ${H / 2} Q ${mx + nx * w} ${my + ny * w * side} ${tx} ${ty} Q ${mx - nx * w} ${my - ny * w * side} ${x + 1.5} ${H / 2} Z" fill="url(#l${i}${side})"/>`;
      s += `<path d="M${x} ${H / 2} L ${tx} ${ty}" stroke="#3f5c1d" stroke-width=".7" opacity=".55"/>`;
    }
  }
  s += `<path d="M0 ${H / 2} L ${W} ${H / 2}" stroke="#8b8a4a" stroke-width="6" stroke-linecap="round"/><path d="M0 ${H / 2 - 1} L ${W} ${H / 2 - 1}" stroke="#b3b06a" stroke-width="2"/></svg>`;
  const base = await sharp(Buffer.from(s)).png().toBuffer();
  const { data, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r2 = rng(17); for (let i = 0; i < info.width * info.height; i++) { const n = .88 + r2() * .2; for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.min(255, data[i * 4 + c] * n); if (data[i * 4 + 3] < 8) { data[i * 4] = 70; data[i * 4 + 1] = 90; data[i * 4 + 2] = 40; } }
  fs.writeFileSync(path.join(CACHE, 'palm-frond.png'), await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer());
  return { raw: { data: new Uint8Array(data), width: info.width, height: info.height }, out: path.join(OUT, 'foliage', 'palm-frond.ktx2'), kind: 'color', flipY: true, quality: 200, force: true };
}

const only = process.argv[2];
if (!only || only === 'surfaces') { console.log('surfaces'); await surfaces(); }
if (!only || only === 'sky') { console.log('sky'); await sky(); }
if (!only || only === 'foliage') { console.log('foliage'); await foliage(); }
const ledgerFile = path.join(CACHE, 'ledger-environment.json');
const prior = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : [];
const merged = [...prior.filter(p => !ledger.some(l => l.asset === p.asset)), ...ledger];
writeJSON(ledgerFile, merged);
console.log('done');
