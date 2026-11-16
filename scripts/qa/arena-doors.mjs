// Doors in a live match (Operation: Metropolis, the real room server and WebSocket protocol): stand in front of a
// Marina Avenue shop door, press E to close it, try to walk through it, press E to open it, walk in. Asserts what the
// server and the client agree on and writes stills to docs/screenshots/arena/doors/. Chromium software WebGL: slow,
// so stills rather than motion; the frame rate is not a measurement.
// Usage: node scripts/qa/arena-doors.mjs
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createRoom } from '../../server/room.mjs';

const OUT = process.env.OUT || 'docs/screenshots/arena/doors/', ROOM_PORT = 3223, WEB_PORT = 5193;
const DOOR = 0, STAND = { x: -40.4, y: 5, z: -30.4 }, YAW = 0; // the shop door at (−40, −32.2), the avenue to its south
const room = createRoom({ port: ROOM_PORT, origins: [`http://127.0.0.1:${WEB_PORT}`], heartbeatMs: 90000, arena: { heartbeatMs: 90000, slowCloseMs: 600000, rules: { countdownMs: 100, spawnProtectMs: 0, reconnectMs: 900000, mode: { timeMs: 3600000, scoreLimit: 9999 } } } });
await room.start(); process.env.ROOM_URL = `127.0.0.1:${ROOM_PORT}`;
const { createServer } = await import('vite');
const web = await createServer({ configFile: 'vite.config.ts', mode: 'development', server: { port: WEB_PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
await web.listen();
const exe = ['/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
await mkdir(OUT, { recursive: true });
const errors = [], log = (...a) => console.log(...a);
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.setDefaultTimeout(300000);
  page.on('pageerror', e => { errors.push(e.message); console.error('pageerror', e.message); });
  await page.addInitScript(() => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Capture', reducedMotion: true }, version: 1 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'medium', qualityChosen: true, adaptive: false, showFps: true, fov: 78 })); });
  await page.goto(`http://127.0.0.1:${WEB_PORT}/?qa-scale=${process.env.SCALE || .6}&qa-static-shadows`);
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /Combat Arena/ }).click();
  await page.waitForFunction(() => window.__arena?.state().status === 'ready');
  await page.getByRole('tab', { name: 'Training', exact: true }).click();
  await page.getByRole('combobox', { name: /^Map/ }).selectOption('metropolis');
  await page.getByRole('combobox', { name: /^Weather/ }).selectOption('day');
  await page.getByRole('button', { name: 'Open the firing range' }).click();
  await page.waitForFunction(() => window.__arena?.state().hud.matchState === 'playing');
  const match = [...room.arena.matches.values()].find(m => m.kind === 'training' && !m.closed), me = match.players.find(p => !p.bot);
  const keep = setInterval(() => { me.protectUntil = Infinity; }, 200);
  await page.waitForFunction(() => document.querySelector('.ar-scene-loading') === null && window.__arenaStats?.calls > 0);
  await page.addStyleTag({ content: '.ar-clickhint{display:none!important}' });
  const still = async name => { await page.waitForTimeout(800); await page.evaluate(() => window.__arenaFreeze?.(true)); await page.waitForTimeout(1500); try { await page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 86, timeout: 300000 }); } finally { await page.evaluate(() => window.__arenaFreeze?.(false)); } log('still', name); };
  const where = () => page.evaluate(() => window.__arena.self());
  const doors = () => page.evaluate(() => window.__arena.doors());
  const key = async (code, ms = 120) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
  // Bots in a Training range would wander into the shot: there are none near the avenue door, and the player is shielded.
  Object.assign(me.sim, { ...STAND, vx: 0, vy: 0, vz: 0, yaw: YAW }); me.history = [];
  await page.waitForFunction(([x, z]) => { const p = window.__arena.self(); return p && Math.hypot(p.x - x, p.z - z) < .2; }, [STAND.x, STAND.z]);
  await page.evaluate(y => window.__arena.look(y, -.05), YAW);
  await page.waitForTimeout(4000);
  let d = await doors();
  assert.equal(d.reach, DOOR, `door ${DOOR} in reach (got ${d.reach})`); assert.equal(d.open[DOOR], true, 'starts open');
  await page.waitForFunction(() => window.__arena.state().hud.door === 1);
  await still('1-open-prompt');
  // Close it (E): the server moves it; the client's world follows.
  await key('KeyE');
  await page.waitForFunction(i => window.__arena.doors().open[i] === false, DOOR, { timeout: 60000 });
  assert.equal(match.world.doorBox[DOOR].off, false, 'shut on the server'); log('closed by the server');
  await page.waitForTimeout(1200); await still('2-closed');
  // Walk into it: the leaf stops the player on both the client and the server.
  // (Movement is held through a QA hook: at this frame rate a held key can begin and end between two frames.)
  const walk = async (until, ms) => { await page.evaluate(() => window.__arena.move(0, 1)); await page.waitForFunction(z => window.__arena.self().z < z, until, { timeout: ms }).catch(() => {}); await page.evaluate(() => window.__arena.move(0, 0)); await page.waitForTimeout(1500); };
  await walk(-32.4, 25000);
  const blocked = await where(); log('pushing against the shut door, z =', blocked.z.toFixed(2), 'server z =', me.sim.z.toFixed(2));
  assert.ok(blocked.z < -31.4, `walked up to the door (z ${blocked.z.toFixed(2)})`);
  assert.ok(blocked.z > -32.2 && me.sim.z > -32.2, 'the shut door stops the player, on the client and the server');
  await still('3-against-the-door');
  // Open it and go in.
  await key('KeyE');
  await page.waitForFunction(i => window.__arena.doors().open[i] === true, DOOR, { timeout: 60000 });
  await page.waitForTimeout(1200); await still('4-opened');
  await walk(-33.4, 60000);
  const inside = await where(); log('through the doorway, z =', inside.z.toFixed(2), 'server z =', me.sim.z.toFixed(2));
  assert.ok(inside.z < -32.6 && me.sim.z < -32.6, 'walked in through the open door, on the client and the server');
  await page.evaluate(() => window.__arena.look(Math.PI, -.05)); await page.waitForTimeout(2500); await still('5-inside-looking-out');
  clearInterval(keep);
  ok = errors.length === 0;
  log(ok ? 'PASS' : 'page errors: ' + errors.join(' | '));
} catch (e) { console.error('FAIL', e.message); }
finally { await browser.close(); await web.close(); await room.stop?.(); process.exit(ok ? 0 : 1); }
