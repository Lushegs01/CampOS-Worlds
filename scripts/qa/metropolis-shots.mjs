// Fixed-camera captures of Operation: Metropolis for before/after visual comparison and renderer statistics.
// Starts its own room and Vite dev server, opens the firing range on Metropolis in each weather, and photographs
// the same views (street, rooftop, interior, station, skyline, the weapon aimed) at each graphics quality.
//
// Usage: LABEL=before node scripts/qa/metropolis-shots.mjs
//   QUALITIES=low,high   VARIANTS=day,overcast,night   VIEWS=street,rooftop   SCALE=1 (QA render scale)
// Writes docs/screenshots/metropolis-photoreal/<label>/<variant>-<view>-<quality>.jpg and
// docs/performance/metropolis-<label>.json (draw calls, triangles, GPU textures/geometries, software-renderer FPS).
//
// Rendering here is Chromium's software WebGL (SwiftShader): frame rates are NOT representative of any real device.
// Draw calls, triangles and resident textures/geometries are exact and are what the comparison is for.
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createRoom } from '../../server/room.mjs';

const LABEL = process.env.LABEL || 'after';
const QUALITIES = (process.env.QUALITIES || 'low,high').split(',');
const VARIANTS = (process.env.VARIANTS || 'day,overcast,night').split(',');
const ONLY = process.env.VIEWS?.split(',');
const WIDTH = Number(process.env.WIDTH || 1280), HEIGHT = Number(process.env.HEIGHT || 720);
const OUT = `${process.env.OUT_ROOT || ''}docs/screenshots/metropolis-photoreal/${LABEL}/`;
// [x, y, z] is where the player stands (y: the feet); yaw 0 looks north (−z), −π/2 east (+x); pitch up is positive.
const VIEWS = [
  { id: 'street', at: [-44, 5, -25.5], yaw: -Math.PI / 2 + .08, pitch: .02 },          // Marina Avenue, eye level, looking east
  { id: 'avenue', at: [-30, 5, -22.2], yaw: -Math.PI / 2 - .5, pitch: .05 },          // the shop fronts of the north block
  { id: 'rooftop', at: [-40, 12, -35], yaw: -Math.PI / 2 + .45, pitch: -.12 },         // over the avenue from the roofs
  { id: 'skyline', at: [-40, 12, -35], yaw: -Math.PI / 2 - .1, pitch: .1 },             // the towers beyond the site, from the roofs
  { id: 'plaza', at: [-22, 5, 2], yaw: -Math.PI / 2, pitch: .06 },                     // the Okun Spire and fountain
  { id: 'interior', at: [37, 5, -37], yaw: Math.PI / 2, pitch: -.04 },                 // inside a shop on the avenue
  { id: 'station', at: [-20, 1, 0], yaw: -Math.PI / 2, pitch: 0 },                     // Plaza Station
  { id: 'industrial', at: [-12, 5, 31], yaw: -Math.PI / 2, pitch: .02 },               // Harbour Road and the yard
];
const ROOM_PORT = Number(process.env.ROOM_PORT || 3216), WEB_PORT = Number(process.env.WEB_PORT || 5182);
const room = createRoom({ port: ROOM_PORT, origins: [`http://127.0.0.1:${WEB_PORT}`], heartbeatMs: 90000, arena: { heartbeatMs: 90000, slowCloseMs: 600000, rules: { countdownMs: 100, spawnProtectMs: 0, reconnectMs: 900000, mode: { timeMs: 3600000, scoreLimit: 9999 } } } });
await room.start();
process.env.ROOM_URL = `127.0.0.1:${ROOM_PORT}`;
const { createServer } = await import('vite');
const web = await createServer({ configFile: 'vite.config.ts', mode: 'development', server: { port: WEB_PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
await web.listen();
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
const results = { label: LABEL, when: new Date().toISOString(), viewport: [WIDTH, HEIGHT], renderer: 'SwiftShader (software WebGL, no GPU): FPS is NOT representative of real devices; draw calls, triangles and resident GPU objects are exact', views: {}, errors: [] };
await mkdir(OUT, { recursive: true });
try {
  // Software rendering can stall long enough for the session to drop; a view that fails is retried on a fresh page.
  const deployPage = async (quality, variant) => {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } }); page.setDefaultTimeout(120000);
    page.on('pageerror', e => { results.errors.push(`${variant}/${quality} pageerror ${e.message}`); console.error('pageerror', e.message); });
    page.on('console', m => { if (process.env.VERBOSE) console.log('console', m.type(), m.text().slice(0, 400)); if ((m.type() === 'error' && !/WebSocket|ERR_CONN|Failed to load resource/.test(m.text())) || /Sign atlas full/.test(m.text())) { results.errors.push(`${variant}/${quality} console ${m.text().slice(0, 300)}`); console.error('console', m.text().slice(0, 300)); } });
    await page.addInitScript(q => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Capture', reducedMotion: true }, version: 1 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: q, qualityChosen: true, adaptive: false, showFps: true, fov: 78 })); }, quality);
    await page.goto(`http://127.0.0.1:${WEB_PORT}/?qa-scale=${process.env.SCALE || 1}&qa-static-shadows`);
    await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 240000 });
    await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
    await page.getByRole('button', { name: /Combat Arena/ }).click();
    await page.waitForFunction(() => window.__arena?.state().status === 'ready');
    await page.getByRole('tab', { name: 'Training', exact: true }).click();
    await page.getByRole('combobox', { name: /^Map/ }).selectOption('metropolis');
    await page.getByRole('combobox', { name: /^Weather/ }).selectOption(variant);
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Open the firing range' }).click();
    await page.waitForFunction(() => window.__arena?.state().hud.matchState === 'playing', null, { timeout: 120000 });
    const match = [...room.arena.matches.values()].find(m => m.kind === 'training' && !m.closed);
    const me = match.players.find(p => !p.bot);
    const shield = () => { me.protectUntil = Infinity; }; shield(); const keep = setInterval(shield, 200);
    await page.waitForFunction(() => document.querySelector('.ar-scene-loading') === null && window.__arenaStats?.calls > 0, null, { timeout: Number(process.env.LOAD_MS || 300000) }).catch(async e => {
      console.error('scene did not load:', JSON.stringify(await page.evaluate(() => window.__arenaDeploy?.()).catch(() => null)));
      await page.screenshot({ path: `${OUT}failure-${variant}-${quality}.jpg`, type: 'jpeg' }).catch(() => {}); clearInterval(keep); throw e;
    });
    await page.waitForFunction(() => { const d = window.__arenaDebug?.(); return !d || d.vm.gun; }, null, { timeout: 180000 });
    const deployMs = Date.now() - t0;
    await page.addStyleTag({ content: '.ar-clickhint{display:none!important}' });
    // Let streamed set dressing and relief maps arrive.
    await page.waitForTimeout(Number(process.env.SETTLE || 9000));
    return { page, me, keep, deployMs, close: async () => { clearInterval(keep); await page.close().catch(() => {}); for (const m of [...room.arena.matches.values()]) m.close('capture'); } };
  };
  for (const quality of QUALITIES) for (const variant of VARIANTS) {
    let s = await deployPage(quality, variant);
    for (const view of VIEWS.filter(v => !ONLY || ONLY.includes(v.id))) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { page, me } = s;
          Object.assign(me.sim, { x: view.at[0], y: view.at[1], z: view.at[2], vx: 0, vy: 0, vz: 0, yaw: view.yaw }); me.history = [];
          await page.waitForFunction(([x, y, z]) => { const p = window.__arena.self(); return p && Math.hypot(p.x - x, p.y - y, p.z - z) < .1 && window.__arenaStats?.calls > 0; }, view.at, { timeout: 400000 });
          await page.evaluate(([y, p]) => window.__arena.look(y, p), [view.yaw, view.pitch]);
          await page.waitForTimeout(Number(process.env.HOLD || 2500));
          const stats = await page.evaluate(() => ({ ...(window.__arenaStats ?? {}), fps: window.__arena.state().hud.fps, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
          if (!stats.calls) throw new Error('the scene is not mounted');
          await page.screenshot({ path: `${OUT}${variant}-${view.id}-${quality}.jpg`, type: 'jpeg', quality: 88 });
          results.views[`${variant}-${view.id}-${quality}`] = { ...stats, deployMs: s.deployMs };
          console.log(LABEL, variant, view.id, quality, JSON.stringify(stats));
          await writeFile(`${process.env.OUT_ROOT || ''}docs/performance/metropolis-${LABEL}${process.env.PART ? '-' + process.env.PART : ''}.json`, JSON.stringify(results, null, 2) + '\n').catch(() => {});
          break;
        } catch (e) {
          const state = await s.page.evaluate(() => ({ self: window.__arena?.self?.(), stats: window.__arenaStats, deploy: window.__arenaDeploy?.().stage })).catch(err => String(err).slice(0, 120));
          console.error(`view ${variant}/${view.id}/${quality} failed (attempt ${attempt + 1}):`, String(e.message ?? e).slice(0, 200), JSON.stringify(state).slice(0, 300));
          results.errors.push(`${variant}/${view.id}/${quality} attempt ${attempt + 1}: ${String(e.message ?? e).slice(0, 160)}`);
          await s.close(); s = await deployPage(quality, variant);
        }
      }
    }
    await s.close();
  }
} finally {
  await mkdir('docs/performance', { recursive: true });
  await writeFile(`${process.env.OUT_ROOT || ''}docs/performance/metropolis-${LABEL}${process.env.PART ? '-' + process.env.PART : ''}.json`, JSON.stringify(results, null, 2) + '\n');
  await browser.close(); await web.close(); await room.close();
}
