import assert from 'node:assert/strict';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const html = await readFile('dist/index.html', 'utf8');
const manifest = JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'));
const canonical = /rel="canonical" href="([^"]+)"/.exec(html)?.[1];
assert.ok(canonical && new URL(canonical).protocol === 'https:', 'absolute HTTPS canonical');
for (const key of ['og:title','og:description','og:type','og:url','og:image','og:image:width','og:image:height','og:image:alt','og:site_name'])
  assert.equal((html.match(new RegExp(`property="${key}"`, 'g')) ?? []).length, 1, `exactly one ${key}`);
for (const key of ['twitter:card','twitter:title','twitter:description','twitter:image'])
  assert.equal((html.match(new RegExp(`name="${key}"`, 'g')) ?? []).length, 1, `exactly one ${key}`);
const image = /property="og:image" content="([^"]+)"/.exec(html)?.[1];
assert.equal(new URL(image).origin, new URL(canonical).origin);
assert.equal(/property="og:url" content="([^"]+)"/.exec(html)?.[1], canonical);
const social = await sharp('dist' + new URL(image).pathname).metadata();
assert.deepEqual([social.width, social.height, social.format], [1200, 630, 'png']);
assert.equal(manifest.name, 'CampOS Worlds');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.id, '/');
for (const icon of manifest.icons) {
  const metadata = await sharp('dist' + icon.src).metadata();
  assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes);
  assert.equal(icon.type, 'image/png');
  if (icon.purpose === 'maskable') assert.equal(metadata.hasAlpha, false, 'maskable background is opaque');
}
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
const worker = await readFile('dist/sw.js', 'utf8');
const urls = [...worker.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map(match => match[1]);
assert.ok(urls.includes('offline.html') && urls.includes('offline.css'), 'offline launch and styling precached');
assert.ok(urls.includes('index.html'), 'application document included');
assert.ok(urls.every(url => !/\.(?:glb|ktx2|hdr|ogg|mp3|wav)(?:\?|$)|(?:^|\/)(?:auth|api|health|shop|admin)(?:\/|$)/.test(url)), 'no world assets or private APIs precached');
const cacheBytes = (await Promise.all(urls.map(async url => (await stat('dist/' + url)).size))).reduce((a,b) => a+b, 0);
assert.ok(cacheBytes < 5 * 1024 * 1024, `bounded precache (${cacheBytes} bytes)`);
for (const file of (await readdir('dist/assets')).filter(file => file.endsWith('.js'))) {
  const code = await readFile('dist/assets/' + file, 'utf8');
  assert.ok(!/__campus(?:Debug|Inspect|Net|Scene|GL|Camera)/.test(code), 'production has no QA hooks: ' + file);
}
const results = { date: new Date().toISOString(), canonical, image, social: { width:social.width,height:social.height },
  precacheEntries: urls.length, precacheBytes: cacheBytes, productionDebugHooks: false, result:'pass' };
await mkdir('docs/release', { recursive:true });
await writeFile('docs/release/artifacts.json', JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
