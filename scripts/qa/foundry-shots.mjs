// Foundry Yard night-shift captures: fixed views of the industrial look for before/after comparison, plus the lens
// effects in action (a reload for the depth of field, a sprint for the motion blur), with console errors counted.
// Starts its own room and Vite dev server (like arena-shots.mjs) and opens Training on Foundry Yard with bots frozen.
// Usage: LABEL=after node scripts/qa/foundry-shots.mjs   (QUALITIES=high,low  LOOK=day for the daylight look  SCALE=0.6)
// Writes docs/screenshots/arena/foundry/<label>-<view>-<quality>.jpg and docs/performance/foundry-<label>.json.
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createRoom } from '../../server/room.mjs';

const LABEL = process.env.LABEL || 'after', QUALITIES = (process.env.QUALITIES || 'high').split(','), ONLY = process.env.VIEWS?.split(',');
const OUT = 'docs/screenshots/arena/foundry/', LOOK = process.env.LOOK === 'day' ? '&foundry-look=day' : '';
const VIEWS = [
  { id: 'yard', at: [-30, 3], yaw: -Math.PI / 2, pitch: -.06, bots: [[-19, -1, Math.PI / 2], [-15, 5.5, Math.PI / 2.4]] },
  { id: 'interior', at: [-8.6, 6.8], yaw: -2.35, pitch: .02, bots: [[-2, -5.6, 2.6], [3, 3, -2.2]] },
  // Under the warehouse roof, looking down the bays: the alternating fittings, their cones and the wet floor.
  { id: 'hall', at: [-10, 5.5], yaw: -Math.PI / 2 + .3, pitch: .14, bots: [[-2, 1, 1.9], [4, -4, 2.2]] },
  { id: 'lane', at: [-27, -15], yaw: -1.35, pitch: -.04, bots: [[-12, -19.5, 1.7], [-3, -21, 1.3]] },
  { id: 'floor', at: [-24, 12], yaw: -2.2, pitch: -.32, bots: [[-16, 4, 1]] },
  { id: 'squad', at: [-24.5, 2.2], yaw: -Math.PI / 2, pitch: -.04, bots: [[-19.6, 1.1, Math.PI / 2 - .25], [-19.2, 3.6, Math.PI / 2 + .35], [-20.8, -.6, Math.PI / 2 + .05]] },
];
const room = createRoom({ port: 3216, origins: ['http://127.0.0.1:5182'], arena: { slowCloseMs: 600000, rules: { countdownMs: 300, snapshotHz: 10, mode: { timeMs: 3600000, scoreLimit: 9999 } } } });
await room.start();
process.env.ROOM_URL = '127.0.0.1:3216';
const { createServer } = await import('vite');
const web = await createServer({ configFile: 'vite.config.ts', mode: 'development', server: { port: 5182, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await web.listen();
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
const results = { label: LABEL, look: LOOK ? 'day' : 'night', when: new Date().toISOString(), renderer: 'SwiftShader (software WebGL, no GPU): frame rates are NOT representative of real devices', errors: [], views: {} };
await mkdir(OUT, { recursive: true });
const ignorable = t => /WebSocket|ERR_CONN|Failed to load resource|net::|ECONNRESET/.test(t);
try {
  for (const quality of QUALITIES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.setDefaultTimeout(120000);
    page.on('pageerror', e => { results.errors.push(`pageerror: ${e.message}`); console.error('pageerror', e.message); });
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !ignorable(t)) { results.errors.push(t.slice(0, 2000)); console.error('console', t.slice(0, 2000)); } });
    await page.addInitScript(q => { localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: 'Capture', reducedMotion: false }, version: 1 })); localStorage.setItem('campos-arena-settings', JSON.stringify({ quality: q, qualityChosen: true, showFps: true, fov: 78, adaptive: false })); }, quality);
    await page.goto(`http://127.0.0.1:5182/?qa-scale=${process.env.SCALE || .6}${LOOK}`);
    await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 240000 });
    await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
    await page.getByRole('button', { name: /Combat Arena/ }).click();
    await page.waitForFunction(() => window.__arena?.state().status === 'ready');
    await page.getByRole('tab', { name: 'Training' }).click();
    await page.getByLabel('Bots').selectOption('3');
    await page.getByRole('button', { name: 'Start training' }).click();
    await page.waitForFunction(() => window.__arena?.state().hud.matchState === 'playing', null, { timeout: 120000 });
    const match = [...room.arena.matches.values()].find(m => m.kind === 'training' && !m.closed);
    const me = match.players.find(p => !p.bot), bots = match.players.filter(p => p.bot);
    for (const b of bots) b.brain.think = () => null;
    const shield = () => { me.protectUntil = Infinity; for (const b of bots) b.protectUntil = Infinity; };
    shield(); const keepShielded = setInterval(shield, 200);
    await page.waitForFunction(() => document.querySelector('.ar-scene-loading') === null && window.__arenaStats?.calls > 0, null, { timeout: 300000 }).catch(async e => {
      // Say why before giving up: the deployment stage, the graphics session and what was last drawn.
      console.error('not ready:', JSON.stringify(await page.evaluate(() => ({ deploy: window.__arenaDeploy?.(), graphics: window.__graphics?.(), stats: window.__arenaStats ?? null, debug: window.__arenaDebug?.() }))).slice(0, 3000));
      // Programs that failed to link: their shader logs (and the offending source lines).
      console.error('failed programs:', await page.evaluate(() => {
        const r = window.__arenaGL; if (!r) return 'no renderer'; const gl = r.getContext();
        return (r.info.programs ?? []).filter(p => p.program && !gl.getProgramParameter(p.program, gl.LINK_STATUS)).map(p => {
          const logs = gl.getAttachedShaders(p.program).map(sh => { const log = gl.getShaderInfoLog(sh) || '', src = (gl.getShaderSource(sh) || '').split('\n'); const lines = [...log.matchAll(/0:(\d+)/g)].map(m => +m[1]); return log + lines.slice(0, 3).map(n => `\n  ${n}: ${src[n - 1]}`).join(''); });
          return `${p.name}: ${gl.getProgramInfoLog(p.program)} ${logs.join(' | ')}`;
        }).join('\n');
      }));
      await page.screenshot({ path: `${OUT}${LABEL}-not-ready-${quality}.jpg`, type: 'jpeg' }); throw e;
    });
    await page.waitForFunction(() => { const d = window.__arenaDebug?.(); return !d || (d.kits && d.vm.gun); }, null, { timeout: 180000 });
    await page.waitForTimeout(4000);
    const place = (p, x, z, yaw) => { Object.assign(p.sim, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw }); p.history = []; };
    const shot = async (id, extra = {}) => {
      const file = `${OUT}${LABEL}-${id}-${quality}.jpg`;
      await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
      const stats = await page.evaluate(() => ({ ...(window.__arenaStats ?? {}), fps: window.__arena.state().hud.fps }));
      results.views[`${id}-${quality}`] = { ...stats, ...extra }; console.log(LABEL, id, quality, JSON.stringify(stats));
    };
    for (const view of VIEWS.filter(v => !ONLY || ONLY.includes(v.id))) {
      place(me, view.at[0], view.at[1], view.yaw);
      bots.forEach((b, i) => { const s = view.bots[i]; if (s) place(b, s[0], s[1], s[2]); else place(b, 36, 24, 0); });
      await page.waitForFunction(([x, z]) => { const s = window.__arena.self(); return s && Math.abs(s.x - x) < .05 && Math.abs(s.z - z) < .05; }, view.at);
      await page.evaluate(([y, p]) => window.__arena.look(y, p), [view.yaw, view.pitch]);
      await page.waitForTimeout(2500);
      await shot(view.id);
    }
    if (!ONLY || ONLY.includes('reload')) {
      // Depth of field: reload on the yard view and photograph mid-reload (the world behind the weapon soft).
      const v = VIEWS[0]; place(me, v.at[0], v.at[1], v.yaw); await page.evaluate(([y, p]) => window.__arena.look(y, p), [v.yaw, v.pitch]);
      me.sim.wpn[me.sim.slot].mag = 3; await page.waitForTimeout(1200);
      await page.evaluate(() => window.__arena.buttons(['RELOAD'], true)); await page.waitForTimeout(250); await page.evaluate(() => window.__arena.buttons(['RELOAD'], false));
      await page.waitForFunction(() => window.__arena.self()?.phase === 'reload', null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(900);
      await shot('reload', { phase: await page.evaluate(() => window.__arena.self()?.phase) });
      // (The same, with the focus pull held fully open: at software-rendering frame rates the reload can end first.)
      await page.evaluate(() => window.__arenaLens({ focus: 1 })); await page.waitForTimeout(1500);
      await shot('focus', { lens: await page.evaluate(() => window.__arenaLensProbe?.()) }); console.log('lens', JSON.stringify(await page.evaluate(() => window.__arenaLensProbe?.())));
      await page.evaluate(() => window.__arenaLens({}));
    }
    if (!ONLY || ONLY.includes('sprint')) {
      // Motion blur: sprint forward while turning (software rendering draws few frames, so the blur per frame is large).
      const v = VIEWS[2]; place(me, v.at[0], v.at[1], v.yaw); await page.evaluate(([y, p]) => window.__arena.look(y, p), [v.yaw, v.pitch]);
      await page.waitForTimeout(1500);
      // Raw blur: over the whole frame-to-frame motion (a 1 fps software render would otherwise blur 1/60 of it).
      await page.evaluate(() => window.__arenaLens({ motion: .6, raw: true }));
      await page.evaluate(() => { window.__arena.move(0, -1); window.__arena.buttons(['SPRINT'], true); });
      await page.waitForTimeout(1500);
      await page.evaluate(([y, p]) => { let t = 0; const id = setInterval(() => { window.__arena.look(y + (t += .02), p); if (t > .6) clearInterval(id); }, 16); }, [v.yaw, v.pitch]);
      await page.waitForTimeout(500);
      await shot('sprint');
      await page.evaluate(() => { window.__arena.move(0, 0); window.__arena.buttons(['SPRINT'], false); window.__arenaLens({}); });
    }
    clearInterval(keepShielded);
    await page.close();
    for (const m of [...room.arena.matches.values()]) m.close('capture');
  }
} finally {
  await mkdir('docs/performance', { recursive: true });
  // (Merged into an earlier run's file, so a partial re-capture (VIEWS=…) keeps the other views' results.)
  const file = `docs/performance/foundry-${LABEL}.json`;
  const old = await import('node:fs/promises').then(f => f.readFile(file, 'utf8')).then(JSON.parse).catch(() => null);
  if (old && process.env.VIEWS) results.views = { ...old.views, ...results.views };
  await writeFile(file, JSON.stringify(results, null, 2) + '\n');
  console.log('console errors:', results.errors.length);
  await browser.close(); await web.close(); await room.close();
}
