// Combat Arena memory investigation with V8 heap snapshots (production QA bundle, Chromium).
//   N=8 node scripts/qa/arena-heap.mjs          snapshots after match 2 and match N; growth by object type
//   RETAIN=1 N=3 node scripts/qa/arena-heap.mjs  retaining paths of the WebGL contexts still alive after N matches
//   LEAVE=1 node scripts/qa/arena-heap.mjs       campus after a first and a second visit to the arena (two matches
//                                                each): what leaving the arena does not release
// This is how the per-match WebGL context leak (three.js dispose listeners) and the closure that kept the last
// match's renderer alive were found; see docs/ARENA-DEPLOYMENT-AUDIO-UI-REPORT.md.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { startProduction } from '../../tests/support/production.mjs';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || [chromium.executablePath(), '/opt/pw-browsers/chromium'].find(p => existsSync(p)), args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const host = await startProduction({ root: process.env.ROOT || 'dist-qa', arena: { rules: { countdownMs: 800 } } });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Heap', reducedMotion: true, volume: .6 }, version: 0 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'low', qualityChosen: true, adaptive: false })); localStorage.setItem('campos-arena-qa-scale', '0.25'); });
const page = await ctx.newPage(); page.setDefaultTimeout(180000);
const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
async function snapshot() {
  await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(300); await cdp.send('HeapProfiler.collectGarbage');
  const chunks = []; const h = d => chunks.push(d.chunk); cdp.on('HeapProfiler.addHeapSnapshotChunk', h);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); cdp.off('HeapProfiler.addHeapSnapshotChunk', h);
  const snap = JSON.parse(chunks.join('')), m = snap.snapshot.meta, F = m.node_fields.length, nf = m.node_fields, types = m.node_types[0];
  const iType = nf.indexOf('type'), iName = nf.indexOf('name'), iSize = nf.indexOf('self_size');
  const agg = new Map();
  for (let i = 0; i < snap.nodes.length; i += F) { const t = types[snap.nodes[i + iType]]; if (t === 'hidden' || t === 'synthetic') continue; const name = t === 'object' || t === 'closure' || t === 'native' ? `${t}:${snap.strings[snap.nodes[i + iName]]}` : t; const a = agg.get(name) ?? { n: 0, size: 0 }; a.n++; a.size += snap.nodes[i + iSize]; agg.set(name, a); }
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const dom = await page.evaluate(() => document.querySelectorAll('*').length);
  return { agg, heapMB: metrics.JSHeapUsedSize / 1048576, nodes: metrics.Nodes, dom };
}
async function holders(target, limit, big = false) {
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks = []; const h = d => chunks.push(d.chunk); cdp.on('HeapProfiler.addHeapSnapshotChunk', h);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); cdp.off('HeapProfiler.addHeapSnapshotChunk', h);
  const snap = JSON.parse(chunks.join('')), m = snap.snapshot.meta, F = m.node_fields.length, E = m.edge_fields.length, nf = m.node_fields, ef = m.edge_fields;
  const nTypes = m.node_types[0], eTypes = m.edge_types[0], iT = nf.indexOf('type'), iN = nf.indexOf('name'), iE = nf.indexOf('edge_count'), iS = nf.indexOf('retained_size') >= 0 ? nf.indexOf('retained_size') : nf.indexOf('self_size'), eT = ef.indexOf('type'), eN = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node');
  const count = snap.nodes.length / F, rev = Array.from({ length: count }, () => []);
  let e = 0;
  for (let n = 0; n < count; n++) { const ec = snap.nodes[n * F + iE]; for (let k = 0; k < ec; k++, e += E) { const t = eTypes[snap.edges[e + eT]]; if (t === 'weak') continue; const to = snap.edges[e + eTo] / F; const nm = t === 'element' || t === 'hidden' ? '[' + snap.edges[e + eN] + ']' : snap.strings[snap.edges[e + eN]]; rev[to].push([n, t + ':' + nm]); } }
  const name = n => nTypes[snap.nodes[n * F + iT]] + ':' + String(snap.strings[snap.nodes[n * F + iN]]).slice(0, 70);
  let list = []; for (let n = 0; n < count; n++) if (snap.strings[snap.nodes[n * F + iN]] === target && nTypes[snap.nodes[n * F + iT]] !== 'code') list.push(n);
  if (big) list = list.sort((a, b) => snap.nodes[b * F + nf.indexOf('self_size')] - snap.nodes[a * F + nf.indexOf('self_size')]);
  console.log(target, 'count', list.length);
  for (const c of list.slice(0, limit)) {
    const prev = new Map([[c, null]]), q = [c]; let found = null;
    while (q.length && !found) { const n = q.shift(); for (const [p, label] of rev[n]) { if (prev.has(p)) continue; prev.set(p, [n, label]); if (p === 0) { found = p; break; } q.push(p); } }
    const path = []; let cur = found; while (cur != null && cur !== c) { const [next, label] = prev.get(cur); path.push(name(cur) + ' --' + label + '-->'); cur = next; }
    console.log('---', target, c); for (const s of path.slice(0, 16)) console.log('   ', s.slice(0, 170));
  }
}
async function retainers() {
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks = []; const h = d => chunks.push(d.chunk); cdp.on('HeapProfiler.addHeapSnapshotChunk', h);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); cdp.off('HeapProfiler.addHeapSnapshotChunk', h);
  const snap = JSON.parse(chunks.join('')), m = snap.snapshot.meta, F = m.node_fields.length, E = m.edge_fields.length, nf = m.node_fields, ef = m.edge_fields;
  const nTypes = m.node_types[0], eTypes = m.edge_types[0], iT = nf.indexOf('type'), iN = nf.indexOf('name'), iE = nf.indexOf('edge_count'), eT = ef.indexOf('type'), eN = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node');
  const count = snap.nodes.length / F, rev = Array.from({ length: count }, () => []);
  let e = 0;
  for (let n = 0; n < count; n++) { const ec = snap.nodes[n * F + iE]; for (let k = 0; k < ec; k++, e += E) { const t = eTypes[snap.edges[e + eT]]; if (t === 'weak') continue; const to = snap.edges[e + eTo] / F; const nm = t === 'element' || t === 'hidden' ? '[' + snap.edges[e + eN] + ']' : snap.strings[snap.edges[e + eN]]; rev[to].push([n, t + ':' + nm]); } }
  const name = n => nTypes[snap.nodes[n * F + iT]] + ':' + String(snap.strings[snap.nodes[n * F + iN]]).slice(0, 60);
  const ctxs = []; for (let n = 0; n < count; n++) if (snap.strings[snap.nodes[n * F + iN]] === 'WebGL2RenderingContext') ctxs.push(n);
  console.log('contexts', ctxs.length);
  for (const c of ctxs.slice(0, 4)) {
    // Shortest retaining path to the synthetic root (node 0).
    const prev = new Map([[c, null]]), q = [c]; let found = null;
    while (q.length && !found) { const n = q.shift(); for (const [p, label] of rev[n]) { if (prev.has(p)) continue; prev.set(p, [n, label]); if (p === 0) { found = p; break; } q.push(p); } }
    const path = []; let cur = found; while (cur != null && cur !== c) { const [next, label] = prev.get(cur); path.push(name(cur) + ' --' + label + '-->'); cur = next; }
    console.log('--- context', c); for (const s of path.slice(-14)) console.log('   ', s.slice(0, 160));
  }
}
await page.goto(host.url + '/?qa-scale=0.2', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
await page.getByRole('button', { name: 'Enter campus', exact: true }).click(); await page.getByRole('button', { name: /online/ }).waitFor();
await page.getByRole('button', { name: /Combat Arena/ }).click(); await page.waitForFunction(() => window.__arena?.state().status === 'ready');
const snaps = {};
if (process.env.LEAVE) {
  // Two visits to the arena (two Training matches each), back on the campus after each: anything the arena keeps
  // after leaving would grow from the first visit to the second.
  const visit = async () => {
    await page.getByRole('button', { name: /Combat Arena/ }).click(); await page.waitForFunction(() => window.__arena?.state().status === 'ready');
    for (let i = 0; i < 2; i++) {
      await page.getByRole('tab', { name: 'Training' }).click(); await page.getByLabel('Bots').selectOption('3');
      await page.getByRole('button', { name: 'Start training' }).click(); await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed', null, { timeout: 180000 });
      await page.waitForTimeout(4000); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Leave match' }).click(); await page.waitForFunction(() => window.__arena.state().phase === 'lobby');
    }
    await page.getByRole('button', { name: 'Return to campus' }).click(); await page.getByRole('button', { name: /online/ }).waitFor(); await page.waitForTimeout(4000);
  };
  await page.getByRole('button', { name: 'Return to campus' }).click(); await page.getByRole('button', { name: /online/ }).waitFor(); await page.waitForTimeout(15000);
  const s0 = await snapshot(); console.log('campus before the arena', s0.heapMB.toFixed(1), 'buffers MB', ((s0.agg.get('native:system / JSArrayBufferData')?.size ?? 0) / 1e6).toFixed(1));
  await visit(); const s1 = await snapshot(); console.log('campus after visit 1', s1.heapMB.toFixed(1), 'buffers MB', ((s1.agg.get('native:system / JSArrayBufferData')?.size ?? 0) / 1e6).toFixed(1));
  await visit(); const s2 = await snapshot(); console.log('campus after visit 2', s2.heapMB.toFixed(1), 'buffers MB', ((s2.agg.get('native:system / JSArrayBufferData')?.size ?? 0) / 1e6).toFixed(1));
  const rows = []; for (const [k, v] of s2.agg) { const o = s1.agg.get(k) ?? { n: 0, size: 0 }; if (Math.abs(v.size - o.size) > 30000) rows.push([k, v.n - o.n, v.size - o.size]); }
  rows.sort((x, y) => y[2] - x[2]); console.log('visit 1 -> visit 2'); for (const r of rows.slice(0, 12)) console.log(r[0].slice(0, 90).padEnd(90), r[1], r[2]);
  await holders('WebGL2RenderingContext', 6);
  await browser.close(); await host.stop(); process.exit(0);
}
for (let i = 1; i <= Number(process.env.N || 8); i++) {
  await page.getByRole('tab', { name: 'Training' }).click(); await page.getByLabel('Bots').selectOption('3');
  await page.getByRole('button', { name: 'Start training' }).click();
  await page.waitForFunction(() => window.__arenaDeploy?.().stage === 'deployed', null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Leave match' }).click(); await page.waitForFunction(() => window.__arena.state().phase === 'lobby');
  await page.waitForTimeout(1500);
  if (i === 2 || i === Number(process.env.N || 8)) { snaps[i] = await snapshot(); console.log('match', i, 'heap', snaps[i].heapMB.toFixed(1), 'nodes', snaps[i].nodes, 'attached', snaps[i].dom); }
  else { const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value])); console.log('match', i, 'heap(noGC)', (m.JSHeapUsedSize / 1048576).toFixed(1), 'nodes', m.Nodes); }
}
if (process.env.RETAIN) { await retainers(); await browser.close(); await host.stop(); process.exit(0); }
const a = snaps[2].agg, b = snaps[Number(process.env.N || 8)].agg, rows = [];
for (const [k, v] of b) { const o = a.get(k) ?? { n: 0, size: 0 }; if (v.n - o.n !== 0 || v.size - o.size > 20000) rows.push([k, v.n - o.n, v.size - o.size]); }
rows.sort((x, y) => y[2] - x[2]); console.log('top growth by size'); for (const r of rows.slice(0, 30)) console.log(r[0].slice(0, 80).padEnd(80), 'count', r[1], 'bytes', r[2]);
await browser.close(); await host.stop(); process.exit(0);
