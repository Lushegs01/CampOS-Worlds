// Fixed-camera captures of Combat Arena for visual before/after comparison and renderer statistics.
// Starts its own room and Vite dev server, opens Training on Foundry Yard with bots frozen at fixed
// spots, and photographs the same views at each graphics quality.
// Usage: LABEL=before node scripts/qa/arena-shots.mjs   (QUALITIES=low,medium,high)
// Writes docs/screenshots/arena/visual/<label>-<view>-<quality>.png and docs/performance/arena-visual-<label>.json.
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createRoom } from '../../server/room.mjs';

const LABEL = process.env.LABEL || 'after', QUALITIES = (process.env.QUALITIES || 'low,medium,high').split(','), ONLY = process.env.VIEWS?.split(',');
const OUT = 'docs/screenshots/arena/visual/';
const VIEWS = [
  { id: 'yard', at: [-30, 3], yaw: -Math.PI / 2, pitch: -.02, bots: [[-19, -1, Math.PI / 2], [-15, 5.5, Math.PI / 2.4]] },
  { id: 'interior', at: [-8.6, 6.8], yaw: -2.35, pitch: .12, bots: [[-2, -5.6, 2.6], [3, 3, -2.2]] },
  { id: 'lane', at: [-27, -15], yaw: -1.35, pitch: .04, bots: [[-12, -19.5, 1.7], [-3, -21, 1.3]] },
];
const room = createRoom({ port: 3215, origins: ['http://127.0.0.1:5181'], arena: { slowCloseMs: 600000, rules: { countdownMs: 300, snapshotHz: 10, mode: { timeMs: 3600000, scoreLimit: 9999 } } } });
await room.start();
process.env.ROOM_URL = '127.0.0.1:3215';
const { createServer } = await import('vite');
const web = await createServer({ configFile: 'vite.config.ts', mode: 'development', server: { port: 5181, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
await web.listen();
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
const results = { label: LABEL, when: new Date().toISOString(), renderer: 'SwiftShader (software WebGL, no GPU): frame rates are NOT representative of real devices', views: {} };
await mkdir(OUT, { recursive: true });
try {
  for (const quality of QUALITIES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.setDefaultTimeout(90000);
    page.on('pageerror', e => console.error('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONN|Failed to load resource/.test(m.text())) console.error('console', m.text().slice(0, 300)); });
    await page.addInitScript(q => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Capture', reducedMotion: true }, version: 1 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: q, showFps: true, fov: 78 })); }, quality);
    await page.goto(`http://127.0.0.1:5181/?qa-scale=${process.env.SCALE || 1}`);
    await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 240000 });
    await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
    await page.getByRole('button', { name: /Combat Arena/ }).click();
    await page.waitForFunction(() => window.__arena?.state().status === 'ready');
    await page.getByRole('tab', { name: 'Training' }).click();
    await page.getByLabel('Bots').selectOption('3');
    await page.getByRole('button', { name: 'Start training' }).click();
    await page.waitForFunction(() => window.__arena?.state().hud.matchState === 'playing', null, { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('.ar-scene-loading') === null && window.__arenaStats?.calls > 0, null, { timeout: 240000 });
    await page.waitForTimeout(4000);
    const match = [...room.arena.matches.values()].find(m => m.kind === 'training' && !m.closed);
    const me = match.players.find(p => !p.bot), bots = match.players.filter(p => p.bot);
    for (const b of bots) b.brain.think = () => null; // hold still for the photograph
    me.protectUntil = Infinity; for (const b of bots) b.protectUntil = Infinity;
    for (const view of VIEWS.filter(v => !ONLY || ONLY.includes(v.id))) {
      const place = (p, x, z, yaw) => { Object.assign(p.sim, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw }); p.history = []; };
      place(me, view.at[0], view.at[1], view.yaw);
      bots.forEach((b, i) => { const s = view.bots[i]; if (s) place(b, s[0], s[1], s[2]); else place(b, 36, 24, 0); });
      await page.waitForFunction(([x, z]) => { const s = window.__arena.self(); return s && Math.abs(s.x - x) < .05 && Math.abs(s.z - z) < .05; }, view.at);
      await page.evaluate(([y, p]) => window.__arena.look(y, p), [view.yaw, view.pitch]);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}${LABEL}-${view.id}-${quality}.png` });
      const stats = await page.evaluate(() => ({ ...(window.__arenaStats ?? {}), fps: window.__arena.state().hud.fps }));
      if (process.env.BREAKDOWN) console.log(JSON.stringify(await page.evaluate(() => window.__arenaBreakdown?.())));
      results.views[`${view.id}-${quality}`] = stats; console.log(LABEL, view.id, quality, JSON.stringify(stats));
    }
    // ADS on the yard view: the weapon's sights.
    const v = VIEWS[0];
    await page.evaluate(([y, p]) => window.__arena.look(y, p), [v.yaw, v.pitch]);
    Object.assign(me.sim, { x: v.at[0], z: v.at[1] }); me.history = [];
    await page.locator('.ar-canvas canvas').click({ position: { x: 640, y: 360 } }).catch(() => {});
    await page.mouse.down({ button: 'right' }); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}${LABEL}-ads-${quality}.png` }); await page.mouse.up({ button: 'right' });
    await page.close();
    for (const m of [...room.arena.matches.values()]) m.close('capture');
  }
} finally {
  await mkdir('docs/performance', { recursive: true });
  await writeFile(`docs/performance/arena-visual-${LABEL}.json`, JSON.stringify(results, null, 2) + '\n');
  await browser.close(); await web.close(); await room.close();
}
