// First-person body awareness in a live match (Operation: Metropolis, the real room server): stand on Marina Avenue,
// look ahead (no body drawn), look down and steeply down (vest, legs and boots under the camera), walk forward and
// crouch while looking down. Asserts the body is the player's own soldier, drawn only when looking down, standing on
// the ground under the camera, and writes stills to docs/screenshots/arena/body/. Chromium software WebGL: stills,
// not frame rates.
// Usage: node scripts/qa/arena-body.mjs
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createRoom } from '../../server/room.mjs';

const OUT = process.env.OUT || 'docs/screenshots/arena/body/', ROOM_PORT = 3224, WEB_PORT = 5194;
const STAND = { x: -40.4, y: 5, z: -27.5 }, YAW = Math.PI; // on the avenue, facing away from the shops
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.setDefaultTimeout(+process.env.TIMEOUT || 300000);
  page.on('pageerror', e => { errors.push(e.message); console.error('pageerror', e.message); });
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) console.error('console', m.type(), m.text().slice(0, 300)); });
  page.on('requestfailed', r => console.error('requestfailed', r.url().replace(/^.*\/assets\//, ''), r.failure()?.errorText));
  page.on('response', r => { if (r.status() >= 400 && /\/assets\//.test(r.url())) console.error('http', r.status(), r.url().replace(/^.*\/assets\//, '')); });
  await page.addInitScript(q => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Capture', reducedMotion: true }, version: 1 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: q, qualityChosen: true, adaptive: false, showFps: true, fov: 78 })); }, process.env.QUALITY || 'medium');
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
  log('playing');
  const match = [...room.arena.matches.values()].find(m => m.kind === 'training' && !m.closed), me = match.players.find(p => !p.bot);
  const keep = setInterval(() => { me.protectUntil = Infinity; }, 200);
  await page.waitForFunction(() => document.querySelector('.ar-scene-loading') === null && window.__arenaStats?.calls > 0);
  log('scene loaded', JSON.stringify(await page.evaluate(() => { const d = window.__arenaDebug?.(); return d && { kits: d.kits, lib: d.lib }; })));
  // The body is the soldier model: wait for the soldiers to stream in (priority 2).
  // (Software WebGL draws on every core and starves the decoder threads: drawing is paused while they decode.)
  await page.evaluate(() => window.__arenaFreeze?.(true));
  await page.waitForFunction(() => window.__arenaDebug?.().kits === true, null, { timeout: 1200000, polling: 2000 });
  await page.evaluate(() => window.__arenaFreeze?.(false)); log('soldiers loaded');
  await page.addStyleTag({ content: '.ar-clickhint{display:none!important}' });
  const still = async name => { await page.waitForTimeout(800); await page.evaluate(() => window.__arenaFreeze?.(true)); await page.waitForTimeout(1500); try { await page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 86, timeout: 300000 }); } finally { await page.evaluate(() => window.__arenaFreeze?.(false)); } log('still', name); };
  const body = () => page.evaluate(() => window.__arenaDebug().body);
  const self = () => page.evaluate(() => window.__arena.self());
  Object.assign(me.sim, { ...STAND, vx: 0, vy: 0, vz: 0, yaw: YAW }); me.history = [];
  await page.waitForFunction(([x, z]) => { const p = window.__arena.self(); return p && Math.hypot(p.x - x, p.z - z) < .2; }, [STAND.x, STAND.z]);
  // Ahead: not drawn (it would be out of view).
  await page.evaluate(y => window.__arena.look(y, -.05), YAW); await page.waitForTimeout(2500);
  let b = await body(); assert.ok(b, 'the first-person body exists'); assert.equal(b.vis, false, 'not drawn while looking ahead');
  await still('1-ahead');
  // Down: drawn, standing on the ground under the eye, and not reaching up into the camera.
  for (const [name, pitch] of [['2-look-down', -.85], ['3-look-steeply-down', -1.35]]) {
    await page.evaluate(([y, p]) => window.__arena.look(y, p), [YAW, pitch]); await page.waitForTimeout(2500);
    b = await body(); const p = await self(); log(name, JSON.stringify(b), 'player', JSON.stringify(p));
    assert.equal(b.vis, true, `${name}: drawn`);
    assert.ok(Math.abs(b.min[1] - p.y) < .15, `${name}: feet on the ground (body ${b.min[1]}, ground ${p.y.toFixed(2)})`);
    assert.ok(b.max[1] < p.y + 1.62 - .05, `${name}: nothing reaches the eye (top ${b.max[1]}, eye ${(p.y + 1.62).toFixed(2)})`);
    await still(name);
  }
  // Walking while looking down: the legs step (the walk clip), the body keeps up with the camera.
  await page.evaluate(([y]) => window.__arena.look(y, -1.0), [YAW]);
  await page.evaluate(() => window.__arena.move(0, 1)); await page.waitForTimeout(2500);
  b = await body(); const p = await self(); log('walking', JSON.stringify(b), JSON.stringify(p));
  assert.ok(Math.hypot(b.at[0] - p.x, b.at[2] - p.z) < .6, 'the body keeps up with the player while walking');
  await still('4-walking-look-down');
  await page.evaluate(() => window.__arena.move(0, 0)); await page.waitForTimeout(1200);
  // Crouched.
  await page.evaluate(() => window.__arena.buttons(['CROUCH'], true)); await page.waitForTimeout(2500);
  b = await body(); log('crouched', JSON.stringify(b));
  assert.ok(b.max[1] < (await self()).y + 1.07, 'crouched: the body stays below the crouched eye');
  await still('5-crouched-look-down');
  await page.evaluate(() => window.__arena.buttons(['CROUCH'], false));
  clearInterval(keep);
  ok = errors.length === 0;
  log(ok ? 'PASS' : 'page errors: ' + errors.join(' | '));
} catch (e) { console.error('FAIL', e.message); try { const pg = browser.contexts()[0]?.pages()[0]; if (pg) { console.error(JSON.stringify(await pg.evaluate(() => ({ deploy: window.__arenaDeploy?.(), dbg: (() => { try { const d = window.__arenaDebug?.(); return d && { kits: d.kits, lib: d.lib, vm: d.vm }; } catch (x) { return String(x); } })(), stats: window.__arenaStats })))); await pg.screenshot({ path: OUT + 'fail.jpg', type: 'jpeg' }); } } catch (x) { console.error(x.message); } }
finally { await browser.close(); await web.close(); await room.stop?.(); process.exit(ok ? 0 : 1); }
