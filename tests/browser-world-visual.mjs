// Open-world visual evidence: the same camera views of the campus and Metropolitan City, captured with renderer
// statistics, optionally under several environment presets (time of day and weather). Used for before/after
// comparisons of the open-world renderer. Frame rates under software WebGL are not meaningful and are recorded
// only as context; draw calls, triangles and resident textures/geometries are exact.
//
// Usage: node tests/browser-world-visual.mjs
//   VISUAL_LABEL=before|after       output folder name (docs/screenshots/world-visual/<label>/)
//   QUALITY=low|medium|high|ultra   graphics profile
//   PRESETS=golden,night,rain       environment presets to capture (ignored when the build has no environment hook)
//   VIEWS=commercial,downtown       subset of the views below
//   CITY_URL=http://host:port       use a running dev server instead of starting one
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const QUALITY = process.env.QUALITY ?? 'high', LABEL = process.env.VISUAL_LABEL ?? 'after';
const OUT = `docs/screenshots/world-visual/${LABEL}`;
const PRESETS = (process.env.PRESETS ?? 'default').split(',');
await mkdir(OUT, { recursive: true });
const ALL_VIEWS = {
  commercial: [-55, 1653, 1.57, .16, 9],
  'commercial-street': [-120, 1701.55, 1.57, .08, 6],
  downtown: [132, 1707.2, 1.57, .18, 10],
  'downtown-avenue': [150, 1652, -1.57, .1, 7],
  residential: [-50, 1935.4, 1.57, .12, 9],
  industrial: [-300, 1681.4, 1.57, .14, 9],
  campus: [0, 30, 3.14, .2, 10],
};
const VIEWS = (process.env.VIEWS ? process.env.VIEWS.split(',') : Object.keys(ALL_VIEWS)).map(k => [k, ...ALL_VIEWS[k]]);

let server = null, url = process.env.CITY_URL;
if (!url) {
  server = spawn('npx', ['vite', '--port', '5193', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  url = 'http://localhost:5193';
  await new Promise((res, rej) => { const t = setTimeout(() => rej(Error('vite did not start')), 60000); server.stdout.on('data', d => { if (/ready in/.test(String(d))) { clearTimeout(t); res(); } }); });
}
const exe = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, '/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = { date: new Date().toISOString(), label: LABEL, quality: QUALITY, renderer: 'software (SwiftShader), 1280x720, qa-scale 0.6', views: {}, errors: [] };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(q => { sessionStorage.setItem('campos-cinema-seen', '["city-reveal"]'); localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: q, name: 'Visual QA', reducedMotion: true }, version: 0 })); }, QUALITY);
  const page = await ctx.newPage(); page.setDefaultTimeout(300000);
  page.on('pageerror', e => results.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) results.errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(url + '/?qa-scale=.6', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 300000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.waitForFunction(() => window.__campusDebug && window.__campus, null, { timeout: 300000 });
  results.loadToPlayableMs = Date.now() - t0;
  const hasEnv = await page.evaluate(() => typeof window.__campusEnvironment === 'function');
  results.environmentHook = hasEnv;
  for (const [name, x, z, yaw, pitch, zoom] of VIEWS) {
    await page.evaluate(a => window.__campusDebug.teleport(...a), [x, z, yaw, pitch, zoom]);
    for (const preset of hasEnv ? PRESETS : ['default']) {
      if (hasEnv && preset !== 'default') await page.evaluate(p => window.__campusEnvironment({ preset: p }), preset);
      // Wait for detail streaming and (in this software renderer) a few frames.
      await sleep(name === VIEWS[0][0] && preset === PRESETS[0] ? 20000 : 9000);
      await page.waitForFunction(() => !window.__campusLoads || window.__campusLoads() === 0, null, { timeout: 60000 }).catch(() => {});
      await sleep(2500);
      // Telemetry refreshes every 2 s from the last frame; shadow maps and the reflection probe are not drawn every
      // frame, so record the range over several samples rather than one arbitrary frame.
      const samples = [];
      for (let i = 0; i < 5; i++) { samples.push(await page.evaluate(() => ({ ...window.__campus }))); await sleep(2200); }
      const env = await page.evaluate(() => window.__campusEnvironment?.() ?? null);
      const range = k => [Math.min(...samples.map(s => s[k])), Math.max(...samples.map(s => s[k]))];
      const last = samples.at(-1);
      const key = `${name}${preset === 'default' ? '' : '-' + preset}`;
      results.views[key] = { drawCalls: range('drawCalls'), triangles: range('triangles'), textures: last.textures, geometries: last.geometries, fps: range('fps'), env };
      console.log(key, JSON.stringify(results.views[key]));
      await page.screenshot({ path: `${OUT}/${key}-${QUALITY}.jpg`, type: 'jpeg', quality: 86 });
    }
  }
} catch (e) { results.errors.push(String(e?.stack ?? e)); console.error(e); }
finally {
  await writeFile(`${OUT}/results-${QUALITY}.json`, JSON.stringify(results, null, 2));
  await browser.close(); server?.kill();
}
console.log('errors', results.errors.length, results.errors.slice(0, 5));
