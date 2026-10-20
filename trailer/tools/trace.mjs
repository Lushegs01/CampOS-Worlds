// Runs a take without capturing (Low quality, tiny viewport) and prints what happens each frame: the
// player, the first ball and any score. For timing staged action (the jump shot) against the edit.
//
//   node trailer/tools/trace.mjs <shot id> [every] [extra JS expression over r (the rig), e.g. "r.player.emote"]
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const [id, every = '3', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 180, height: 320 } });
await ctx.addInitScript({ path: resolve('trailer/rig/clock.js') });
await ctx.addInitScript(() => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', volume: 0 }, version: 1 })));
const page = await ctx.newPage(); page.setDefaultTimeout(600000);
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5180/?qa-scale=1');
await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 600000 });
await page.evaluate(async () => { window.__clock.manual(); await import('/trailer/rig/cinema.ts'); });
const info = await page.evaluate(id => { const s = window.__cinema.shots().find(s => s.id === id); window.__cinema.load(id); return s; }, id);
let warm = 0; while (!(await page.evaluate(() => window.__cinema.warm())) && warm++ < 300) await page.waitForTimeout(100);
await page.evaluate(() => window.__cinema.start());
for (let i = 0; i < Math.round(info.lead * 30); i++) await page.evaluate(() => window.__cinema.frame());
for (let f = 0; f < info.frames; f++) {
  await page.evaluate(() => window.__cinema.frame());
  if (f % Number(every)) continue;
  console.log(await page.evaluate(([f, extra]) => { const r = window.__cinema.rig, b = r.ball('ball-1'), p = r.player; return `f${String(f).padStart(3)} t=${r.t.toFixed(2)} sim=${r.sim.toFixed(2)} player=(${p.x.toFixed(1)},${p.z.toFixed(1)}) ball=${b.state} (${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)})${b.shot?.scored ? ' SCORED' : ''}${extra ? ' | ' + JSON.stringify(Function('r', `return (${extra})`)(r)) : ''}`; }, [f, extra]));
}
await browser.close();
