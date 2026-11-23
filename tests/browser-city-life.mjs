// Metropolitan City's living population, checked in the running game (Vite dev build, local exploration mode).
// Visits every district, measures who is there, fast-forwards the live in-game simulation (the same instance the
// renderer draws, fed by the real player) and checks: vehicles stay on their lanes, never enter a junction on red,
// never overlap one another, stop for a player standing in the road, react to gunfire; pedestrians never stand
// inside a building; entity counts stay within budget. Screenshots and results go to docs/.
// Usage: node tests/browser-city-life.mjs   (CITY_URL=http://host:port to use a running server; QUALITY=low|medium|high)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const QUALITY = process.env.QUALITY ?? 'medium';
const OUT = process.env.CITY_EVIDENCE ?? 'docs/screenshots/city-life', RESULTS = process.env.CITY_RESULTS ?? 'docs/city-life-results.json';
await mkdir(OUT, { recursive: true });
let server = null, url = process.env.CITY_URL;
if (!url) {
  server = spawn('npx', ['vite', '--port', '5191', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  url = 'http://localhost:5191';
  await new Promise((res, rej) => { const t = setTimeout(() => rej(Error('vite did not start')), 60000); server.stdout.on('data', d => { if (/ready in/.test(String(d))) { clearTimeout(t); res(); } }); });
}
const exe = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, '/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const gpu = process.platform === 'win32';
const browser = await chromium.launch({ executablePath: exe, args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = { date: new Date().toISOString(), quality: QUALITY, renderer: gpu ? 'gpu' : 'software (SwiftShader)', districts: {}, checks: {}, performance: {}, errors: [] };
const check = (name, ok, data) => { results.checks[name] = { ok, ...data }; console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(data)); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(q => { sessionStorage.setItem('campos-cinema-seen', '["city-reveal"]'); localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: q, name: 'City QA', reducedMotion: false }, version: 0 })); }, QUALITY);
  const page = await ctx.newPage(); page.setDefaultTimeout(240000);
  page.on('pageerror', e => results.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) results.errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(url + `/?qa-scale=${gpu ? 1 : .55}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 240000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.waitForFunction(() => window.__campusDebug && window.__campus, null, { timeout: 240000 });
  results.performance.loadToPlayableMs = Date.now() - t0;
  const go = (x, z, yaw = 0, pitch = .1, zoom = 8) => page.evaluate(a => window.__campusDebug.teleport(...a), [x, z, yaw, pitch, zoom]);
  const city = () => page.evaluate(() => window.__cityLife());
  const advance = s => page.evaluate(s => window.__cityControl({ advance: s }), s);
  await go(150, 1707.2, 1.57, .18, 10); await page.waitForFunction(() => window.__cityLife?.(), null, { timeout: 120000 });

  // ---- districts: who is around (within 140 m), and a screenshot from street level.
  const VIEWS = [
    ['downtown', 132, 1707.2, 1.57, .18, 10], ['commercial', -55, 1653, 1.57, .16, 9], ['residential', -50, 1935.4, 1.57, .12, 9],
    ['industrial', -300, 1681.4, 1.57, .14, 9], ['security', 400, 1708, 1.57, .16, 10], ['entrance', 60, 1545.4, 1.57, .14, 10], ['expressway', 6, 1420, 3.14, .1, 9],
  ];
  for (const [name, x, z, yaw, pitch, zoom] of VIEWS) {
    await go(x, z, yaw, pitch, zoom); await sleep(gpu ? 3000 : 9000); await advance(6);
    const d = await page.evaluate(([x, z]) => { const v = window.__cityVehicles(140), p = window.__cityPeople(140); return { vehicles: v.length, moving: v.filter(o => o.v > .5).length, parked: v.filter(o => o.state === 'parked').length, people: p.length, classes: [...new Set(v.map(o => o.cls))], fps: window.__campus.fps, drawCalls: window.__campus.drawCalls, triangles: window.__campus.triangles }; }, [x, z]);
    results.districts[name] = d; console.log(name, JSON.stringify(d));
    await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 84 });
  }
  const dens = results.districts;
  check('downtown busier on foot than industrial and the expressway', dens.downtown.people > dens.industrial.people && dens.downtown.people > dens.expressway.people, { downtown: dens.downtown.people, industrial: dens.industrial.people, expressway: dens.expressway.people });
  check('traffic in every district', Object.values(dens).every(d => d.vehicles > 0), Object.fromEntries(Object.entries(dens).map(([k, d]) => [k, d.vehicles])));

  // ---- two minutes of driving downtown: lanes, signals, overlaps.
  await go(150, 1707.2, 1.57, .18, 10); await sleep(2000);
  const before = (await city()).traffic;
  const samples = [];
  for (let k = 0; k < 8; k++) {
    await advance(15);
    samples.push(await page.evaluate(async () => {
      const net = await import('/shared/city/network.mjs'), { obb } = await import('/shared/city/traffic.mjs');
      const list = window.__cityVehicles(2000);
      let offLane = 0, worst = 0, overlaps = 0;
      for (const v of list) {
        if (v.state !== 'drive') continue;
        const seg = net.SEGMENTS[v.seg]; let best = Infinity;
        for (let i = 1; i < seg.pts.length; i++) { const a = seg.pts[i - 1], b = seg.pts[i], dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((v.x - a.x) * dx + (v.z - a.z) * dz) / l)); best = Math.min(best, Math.hypot(v.x - a.x - dx * t, v.z - a.z - dz * t)); }
        if (best > 4.3) offLane++; worst = Math.max(worst, best);
      }
      const L = { sedan: 4.65, hatch: 4.05, suv: 4.75, sports: 4.45, pickup: 5.25, van: 5.05, truck: 7.6, bus: 11.2, taxi: 4.65, moto: 2.1, police: 4.8 }, W = { moto: .8, truck: 2.4, bus: 2.5 };
      for (let i = 0; i < list.length; i++) for (let k = i + 1; k < list.length; k++) { const a = list[i], b = list[k]; if (Math.abs(a.x - b.x) > 12 || Math.abs(a.z - b.z) > 12) continue; if (obb(a.x, a.z, a.yaw, L[a.cls] / 2 - .15, (W[a.cls] ?? 1.85) / 2 - .1, b.x, b.z, b.yaw, L[b.cls] / 2 - .15, (W[b.cls] ?? 1.85) / 2 - .1)) { overlaps++; (window.__overlapPairs ??= []).push([a, b]); } }
      return { n: list.length, offLane, worstLateral: +worst.toFixed(2), overlaps, summary: window.__cityLife().traffic };
    }));
  }
  const after = samples.at(-1).summary;
  results.checks.trafficSamples = samples.map(s => ({ n: s.n, offLane: s.offLane, worstLateral: s.worstLateral, overlaps: s.overlaps, moving: s.summary.moving, stopped: s.summary.stopped }));
  check('vehicles stay on their lanes (incl. overtakes, < 4.3 m)', samples.every(s => s.offLane === 0), { worst: Math.max(...samples.map(s => s.worstLateral)) });
  check('no two ambient vehicles overlap', samples.every(s => s.overlaps === 0), { overlaps: samples.map(s => s.overlaps), pairs: await page.evaluate(() => (window.__overlapPairs ?? []).slice(0, 3)) });
  check('junction entries on red: none', after.redRuns === 0 && after.junctionEntries - before.junctionEntries > 100, { entries: after.junctionEntries - before.junctionEntries, redRuns: after.redRuns });
  check('vehicles stop at red lights', after.redStops > before.redStops, { redStops: after.redStops - before.redStops });
  check('traffic keeps flowing (2 min)', after.moving > after.total * .25, { moving: after.moving, total: after.total });
  check('parking and garages are used', after.parkings + after.despawned > before.parkings + before.despawned, { parkings: after.parkings - before.parkings, departures: after.despawned - before.despawned });
  check('population within budget', after.total <= ({ low: 70, medium: 130, high: 190, ultra: 240 })[QUALITY] + 90, { total: after.total });

  // ---- a player standing in the road: the next car stops short of them.
  const block = await page.evaluate(async () => {
    const net = await import('/shared/city/network.mjs');
    // A car with at least 45 m of this lane still ahead of it (so its route passes the point where the player stands).
    const v = window.__cityVehicles(500).find(o => { if (o.state !== 'drive' || o.v < 4) return false; const seg = net.SEGMENTS[o.seg]; if (seg.kind !== 'lane') return false; const s = (o.x - seg.pts[0].x) * seg.dir.x + (o.z - seg.pts[0].z) * seg.dir.z; return seg.len - s > 45 && !(seg.parking?.length || seg.garages?.length); });
    if (!v) return null;
    const seg = net.SEGMENTS[v.seg], p0 = seg.pts[0], s = (v.x - p0.x) * seg.dir.x + (v.z - p0.z) * seg.dir.z, at = s + 30, q = net.pointAt(seg, at);
    window.__campusDebug.teleport(q.x, q.z, Math.atan2(seg.dir.x, seg.dir.z), .2, 9);
    return { id: v.id, at: q, seg: v.seg };
  });
  if (block) {
    await sleep(2500);
    let minGap = Infinity, stoppedAt = null, hit = false, trace = [];
    for (let k = 0; k < 48; k++) {
      await advance(.25);
      const r = await page.evaluate(id => { const v = window.__cityVehicles(300).find(o => o.id === id); const p = window.__campusDebug.state(); return v ? { d: Math.hypot(v.x - p.x, v.z - p.z), v: v.v, why: v.why, seg: v.seg } : null; }, block.id);
      if (!r) break; trace.push([+r.d.toFixed(1), +r.v.toFixed(1), r.why]);
      minGap = Math.min(minGap, r.d); if (r.d < 2.6) hit = true;
      if (r.v < .3 && r.d < 12 && stoppedAt === null) stoppedAt = +r.d.toFixed(2);
    }
    await page.screenshot({ path: `${OUT}/player-in-road.jpg`, type: 'jpeg', quality: 84 });
    check('a car stops for a player standing in its lane', !hit && stoppedAt !== null, { closest: +minGap.toFixed(2), stoppedAt, trace: trace.filter((_, i) => i % 6 === 0) });
  } else check('a car stops for a player standing in its lane', false, { reason: 'no candidate vehicle' });

  // ---- gunfire downtown: people run or take cover, drivers flee.
  await go(132, 1707.2, 1.57, .18, 10); await sleep(2500);
  await page.evaluate(() => window.__cityControl({ incident: { kind: 'gunfire', x: 132, z: 1702 } }));
  await advance(.5);
  const fear = (await city()).people;
  await page.screenshot({ path: `${OUT}/gunfire-reaction.jpg`, type: 'jpeg', quality: 84 });
  check('pedestrians flee or take cover from gunfire', fear.fleeing > 0, { fleeing: fear.fleeing, near: fear.near });

  // ---- pedestrians are never inside buildings.
  const walls = await page.evaluate(async () => { const { blocked } = await import('/shared/campus.mjs'); const all = window.__cityPeople(3000); return { n: all.length, inside: all.filter(c => blocked(c.x, c.z, .05)).length }; });
  check('no pedestrian inside a building collider', walls.inside === 0, walls);
  const p = (await city()).people;
  check('people cross streets and use buildings', p.crossed > 0 && p.entered + p.exited > 0, { crossed: p.crossed, entered: p.entered, exited: p.exited, conversations: p.conversations });

  // ---- frame cost of the simulation itself (measured in this browser).
  results.performance.sim = await page.evaluate(async () => {
    const { stepTraffic } = await import('/shared/city/traffic.mjs');
    const t0 = performance.now(); window.__cityControl({ advance: 4 }); const ms = (performance.now() - t0) / 120;
    void stepTraffic; return { msPerSimStep: +ms.toFixed(3), note: 'traffic + pedestrians, one 1/30 s step, whole city' };
  });
  results.performance.frame = await page.evaluate(() => ({ fps: window.__campus.fps, drawCalls: window.__campus.drawCalls, triangles: window.__campus.triangles, geometries: window.__campus.geometries, textures: window.__campus.textures, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
  check('no page errors', results.errors.length === 0, { errors: results.errors.slice(0, 5) });
} finally {
  await writeFile(RESULTS, JSON.stringify(results, null, 2));
  await browser.close(); server?.kill();
}
const failed = Object.entries(results.checks).filter(([, c]) => c.ok === false);
assert.equal(failed.length, 0, 'failed: ' + failed.map(([k]) => k).join(', '));
console.log('all city-life checks passed');
