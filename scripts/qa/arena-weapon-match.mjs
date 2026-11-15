// Real-time footage of the first-person weapon in a live training match (Foundry Yard, the real room server and
// WebSocket protocol): idle, aim, a full magazine on the sights, an empty reload, hip fire, a tactical reload, sprint.
// Playwright records the page as it renders (Chromium software WebGL here, so the frame rate is low and is NOT a
// device measurement; the motion is driven by the simulation clock and stays correct in time).
// Usage: node scripts/qa/arena-weapon-match.mjs   → docs/screenshots/arena/visual/motion/match-<weapon>.webm + stills
import { mkdir, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createRoom } from '../../server/room.mjs';

const OUT = process.env.OUT || 'docs/screenshots/arena/visual/motion/', ROOM_PORT = 3221, WEB_PORT = 5191, Wd = 1280, Hd = 720;
const room = createRoom({ port: ROOM_PORT, origins: [`http://127.0.0.1:${WEB_PORT}`], heartbeatMs: 90000, arena: { heartbeatMs: 90000, slowCloseMs: 600000, rules: { countdownMs: 100, spawnProtectMs: 0, reconnectMs: 900000, mode: { timeMs: 3600000, scoreLimit: 9999 } } } });
await room.start(); process.env.ROOM_URL = `127.0.0.1:${ROOM_PORT}`;
const { createServer } = await import('vite');
const web = await createServer({ configFile: 'vite.config.ts', mode: 'development', server: { port: WEB_PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
await web.listen();
const exe = ['/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
await mkdir(OUT, { recursive: true });
const errors = [];
try {
  const vidDir = OUT + '.raw/'; await mkdir(vidDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: Wd, height: Hd }, recordVideo: { dir: vidDir, size: { width: Wd, height: Hd } } });
  const page = await ctx.newPage(); page.setDefaultTimeout(240000);
  page.on('pageerror', e => { errors.push(e.message); console.error('pageerror', e.message); });
  await page.addInitScript(() => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Capture', reducedMotion: false }, version: 1 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'medium', qualityChosen: true, adaptive: false, showFps: true, fov: 78 })); });
  await page.goto(`http://127.0.0.1:${WEB_PORT}/?qa-scale=${process.env.SCALE || .7}`);
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /Combat Arena/ }).click();
  await page.waitForFunction(() => window.__arena?.state().status === 'ready');
  await page.getByRole('tab', { name: 'Training', exact: true }).click();
  await page.getByRole('combobox', { name: /^Map/ }).selectOption('foundry');
  await page.getByRole('button', { name: 'Open the firing range' }).click();
  await page.waitForFunction(() => window.__arena?.state().hud.matchState === 'playing');
  const match = [...room.arena.matches.values()].find(m => m.kind === 'training' && !m.closed), me = match.players.find(p => !p.bot);
  const keep = setInterval(() => { me.protectUntil = Infinity; }, 200);
  await page.waitForFunction(() => document.querySelector('.ar-scene-loading') === null && window.__arenaStats?.calls > 0 && !!window.__arenaDebug?.()?.vm?.gun);
  await page.addStyleTag({ content: '.ar-clickhint{display:none!important}' });
  await page.waitForTimeout(6000);
  const weapon = await page.evaluate(() => window.__arena.self().weapon);
  const b = (names, on) => page.evaluate(([n, o]) => window.__arena.buttons(n, o), [names, on]);
  const still = async name => { await page.screenshot({ path: `${OUT}match-${weapon}-${name}.jpg`, type: 'jpeg', quality: 88 }); };
  const waitPhase = (want, ms = 30000) => page.waitForFunction(w => window.__arena.self()?.phase === w, want, { timeout: ms }).catch(() => {});
  // Idle → on the sights → a full magazine → empty reload (stills at its keys) → hip fire → tactical reload → sprint.
  await page.waitForTimeout(2500); await still('hip');
  await b(['ADS'], true); await page.waitForTimeout(1500); await still('ads');
  await b(['FIRE'], true);
  await page.waitForFunction(() => window.__arena.self().ammo <= 12, null, { timeout: 60000 }).catch(() => {}); await still('ads-firing');
  await page.waitForFunction(() => window.__arena.self().ammo === 0, null, { timeout: 60000 }).catch(() => {});
  await b(['FIRE', 'ADS'], false); await page.waitForTimeout(400); await b(['RELOAD'], true); await page.waitForTimeout(100); await b(['RELOAD'], false);
  await waitPhase('reload');
  for (const [k, name] of [[.25, 'reload-empty-drop'], [.5, 'reload-empty-fetch'], [.64, 'reload-empty-insert'], [.86, 'reload-empty-chamber']]) {
    await page.waitForFunction(k => { const s = window.__arena.self(); return s.phase !== 'reload' || 1 - s.pt / s.reloadTotal >= k; }, k, { timeout: 60000 }).catch(() => {}); await still(name);
  }
  await waitPhase('ready'); await page.waitForTimeout(800);
  await b(['FIRE'], true); await page.waitForTimeout(900); await still('hip-firing'); await page.waitForTimeout(600); await b(['FIRE'], false);
  await page.waitForTimeout(500); await still('barrel-smoke');
  await b(['RELOAD'], true); await page.waitForTimeout(100); await b(['RELOAD'], false); await waitPhase('reload');
  await page.waitForFunction(() => { const s = window.__arena.self(); return s.phase !== 'reload' || 1 - s.pt / s.reloadTotal >= .25; }, null, { timeout: 60000 }).catch(() => {}); await still('reload-tactical-out');
  await waitPhase('ready'); await page.waitForTimeout(1000);
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(1600); await still('sprint'); await page.waitForTimeout(800);
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); await page.waitForTimeout(1500);
  clearInterval(keep);
  const video = page.video(); await page.close(); await ctx.close();
  const raw = await video.path(); await rename(raw, `${OUT}match-${weapon}.webm`);
  console.log('weapon', weapon, 'errors', errors.length, (await readdir(OUT)).filter(f => f.startsWith('match-')).join(' '));
} finally { await browser.close(); await web.close(); await room.stop?.(); process.exit(errors.length ? 1 : 0); }
