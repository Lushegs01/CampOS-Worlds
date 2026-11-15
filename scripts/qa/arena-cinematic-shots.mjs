// Captures of the cinematic presentation on Operation: Metropolis: real eliminations decided by the server (the
// elimination card, experience popup with medals, the count this life, lead taken / lost / back on top), a staged
// mid-match unlock notice, and the after-action unlock report staged from a saved result.
// Usage: node scripts/qa/arena-cinematic-shots.mjs   (VARIANT=storm SCALE=.5)
// Writes docs/screenshots/arena/cinematic/*.jpg. Software rendering (SwiftShader): frame rates are not representative.
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createRoom } from '../../server/room.mjs';

const OUT = 'docs/screenshots/arena/cinematic/', VARIANT = process.env.VARIANT || 'storm';
const ROOM_PORT = 3231, WEB_PORT = 5196;
const room = createRoom({ port: ROOM_PORT, origins: [`http://127.0.0.1:${WEB_PORT}`], heartbeatMs: 90000, arena: { heartbeatMs: 90000, slowCloseMs: 600000, rules: { countdownMs: 100, spawnProtectMs: 0, reconnectMs: 900000, mode: { timeMs: 3600000, scoreLimit: 9999 } } } });
await room.start();
process.env.ROOM_URL = `127.0.0.1:${ROOM_PORT}`;
const { createServer } = await import('vite');
const web = await createServer({ configFile: 'vite.config.ts', mode: 'development', server: { port: WEB_PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
await web.listen();
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
await mkdir(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 88 });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.setDefaultTimeout(180000);
  page.on('pageerror', e => console.error('pageerror', e.message));
  await page.addInitScript(() => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Capture', reducedMotion: false }, version: 1 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: 'high', qualityChosen: true, adaptive: false, fov: 78 })); });
  await page.goto(`http://127.0.0.1:${WEB_PORT}/?qa-scale=${process.env.SCALE || .5}&qa-static-shadows`);
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 240000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /Combat Arena/ }).click();
  await page.waitForFunction(() => window.__arena?.state().status === 'ready');
  await page.getByRole('tab', { name: 'Training', exact: true }).click();
  await page.locator('.ar-training label', { hasText: 'Map' }).locator('select').selectOption('metropolis');
  await page.getByRole('combobox', { name: /^Weather/ }).selectOption(VARIANT);
  await page.getByLabel('Bots').selectOption('1');
  await page.getByRole('button', { name: 'Start training' }).click();
  await page.waitForFunction(() => window.__arena?.state().hud.matchState === 'playing', null, { timeout: 180000 });
  const match = [...room.arena.matches.values()].find(m => m.kind === 'training' && !m.closed);
  const me = match.players.find(p => !p.bot), bot = match.players.find(p => p.bot);
  const think = bot.brain.think; bot.brain.think = () => null;
  const shield = () => { me.protectUntil = Infinity; }; shield(); let keep = setInterval(shield, 200);
  await page.waitForFunction(() => document.querySelector('.ar-scene-loading') === null && window.__arenaStats?.calls > 0, null, { timeout: 400000 });
  await page.waitForFunction(() => { const d = window.__arenaDebug?.(); return !d || d.vm.gun; }, null, { timeout: 240000 });
  // Soldiers stream in behind the map; software rendering can take minutes (a stand-in is drawn until then).
  await page.waitForFunction(() => { const d = window.__arenaDebug?.(); return !d || d.kits; }, null, { timeout: 600000 }).catch(() => console.warn('soldier models still loading: the unit is drawn as a stand-in'));
  await page.addStyleTag({ content: '.ar-clickhint{display:none!important}' });
  // A frame takes about a second here: keep the feedback up long enough for the screenshot to catch it.
  await page.evaluate(() => window.__arena.holdFeedback(6));
  await page.waitForTimeout(6000);

  await page.locator('.ar-canvas canvas').click({ position: { x: 640, y: 360 } }); // captures the pointer
  await page.waitForFunction(() => document.pointerLockElement !== null, null, { timeout: 5000 }).catch(() => console.warn('no pointer lock'));
  const place = (p, x, y, z, yaw) => { Object.assign(p.sim, { x, y, z, vx: 0, vy: 0, vz: 0, yaw }); p.history = []; };
  const stage = async () => {
    // On the avenue, the unit 8 m ahead facing us.
    place(me, -44, 5, -25.5, -Math.PI / 2); place(bot, -36, 5, -25.5, Math.PI / 2);
    await page.waitForFunction(() => { const s = window.__arena.self(); return s && Math.abs(s.x + 44) < .05; });
    await page.evaluate(() => window.__arena.look(-Math.PI / 2, -.05));
    await page.waitForTimeout(1500);
  };
  const kill = async () => {
    bot.hp = 1; bot.lastDamageAt = Date.now(); bot.protectUntil = 0;
    const before = me.stats.kills;
    // (The pointer is locked: moving the mouse would turn the view. Aim comes from the QA look hook only.)
    await page.mouse.down({ button: 'right' }); await page.waitForTimeout(2200);
    await page.mouse.down({ button: 'left' }); await page.waitForTimeout(150); await page.mouse.up({ button: 'left' });
    for (let i = 0; i < 40 && me.stats.kills === before; i++) await page.waitForTimeout(100);
    await page.mouse.up({ button: 'right' });
    assert.ok(me.stats.kills > before, 'the server eliminated the unit');
  };
  const respawned = async () => { for (let i = 0; i < 80 && !(me.alive && bot.alive); i++) await page.waitForTimeout(250); assert.ok(me.alive && bot.alive); };

  // 1–0: taken the lead.
  await stage(); await kill(); await page.waitForTimeout(450); await shot(page, 'elimination-lead-taken');
  // The enemy goes ahead: level the score on the server, then let the unit win a fight (1–2): lead lost.
  await respawned(); await stage();
  match.scores[bot.team] = 1;
  clearInterval(keep); me.protectUntil = 0; me.hp = 1; me.lastDamageAt = Date.now(); bot.protectUntil = Infinity; bot.brain.think = think;
  for (let i = 0; i < 120 && me.alive; i++) await page.waitForTimeout(250);
  bot.brain.think = () => null; bot.protectUntil = 0; keep = setInterval(shield, 200);
  assert.equal(me.alive, false, 'the unit eliminated the player');
  await page.waitForTimeout(600); await shot(page, 'lead-lost');
  // Back: 2–2, then 3–2 with a second elimination this life ending the unit's run of three.
  await respawned(); await stage(); await kill();
  await respawned(); await stage(); bot.streak = 3; await kill(); await page.waitForTimeout(450); await shot(page, 'back-on-top');
  // A mid-match unlock (staged: Training does not record progress).
  await page.evaluate(() => window.__arena.feedback().clear());
  await page.evaluate(() => window.__arena.feedback().unlocked({ title: 'Cobalt finish unlocked', sub: 'SIG Sauer M7 · weapon level 8', colors: ['#3d62ad', '#1a2a55'] }));
  await page.waitForTimeout(700); await shot(page, 'unlock-notice');
  clearInterval(keep);

  // After-action report, staged from a saved result.
  await page.evaluate(() => {
    const s = window.__arena.state(), you = s.you, row = { num: you.num, name: 'Capture', team: you.team, bot: false, account: 'x', result: 'win', completed: true, kills: 18, deaths: 7, assists: 4, headshots: 6, captures: 0, neutralizes: 0, defends: 0, score: 2310, damage: 2400, bestStreak: 6, xp: 2870, weapons: { m7: { kills: 12, headshots: 4, shots: 210, hits: 96 }, vanguard: { kills: 6, headshots: 2, shots: 120, hits: 50 } } };
    window.__arena.stage({
      result: { id: 'aar-capture', mode: 'tdm', map: 'metropolis', kind: 'quick', winner: you.team, outcome: 'score', scores: you.team === 0 ? [75, 61] : [61, 75], startedAt: 0, endedAt: 1, players: [row, { ...row, num: 99, name: 'Opponent', team: 1 - you.team, result: 'loss', kills: 9 }] },
      progress: { xp: 2870, total_xp: 9400, level_before: 4, level: 5, unlocked: ['hardline'], weapon_levels: [{ weapon: 'm7', before: 3, level: 5 }, { weapon: 'vanguard', before: 1, level: 2 }] },
      record: { state: 'saved', reason: null }, phase: 'results',
    });
  });
  await page.waitForSelector('.ar-aar');
  await page.waitForTimeout(1350); await shot(page, 'aar-weapon-reveal');
  await page.waitForTimeout(1600); await shot(page, 'aar-weapon');
  await page.keyboard.press('Space'); await page.waitForTimeout(2600); await shot(page, 'aar-weapon-2');
  await page.keyboard.press('Space'); await page.waitForTimeout(2600); await shot(page, 'aar-level');
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(600); await shot(page, 'aar-level-phone');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'no horizontal scroll on a phone');
  const next = await page.locator('.ar-aar-foot .ar-primary').boundingBox();
  assert.ok(next && next.y >= 0 && next.y + next.height <= 390, 'the report\'s buttons fit a landscape phone without scrolling');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  assert.equal(await page.locator('.ar-aar').count(), 0, 'Skip closes the report');
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(500); await shot(page, 'results-after-report');
  console.log('cinematic captures written to', OUT);
} finally {
  await browser.close(); await web.close(); await room.close();
}
