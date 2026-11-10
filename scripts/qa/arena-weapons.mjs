// Renders the Combat Arena weapon set for review: measurement sheets and first-person poses.
// Usage: node scripts/qa/arena-weapons.mjs sheet vanguard,halcyon out.png
//        node scripts/qa/arena-weapons.mjs fp [ids] [poses]      → docs/screenshots/arena/visual/weapon-<id>-<pose>.png
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const [mode = 'fp', idsArg, third] = process.argv.slice(2);
const ALL = ['vanguard', 'halcyon', 'wasp', 'kestrel', 'bastion', 'rampart', 'longbow', 'talon', 'anvil', 'sparrow', 'thorn', 'knife', 'hammer'];
const ids = idsArg && idsArg !== 'all' ? idsArg.split(',') : ALL;
const page0 = { name: 'arena-weapons-page', configureServer(server) { server.middlewares.use('/__arena_weapons.html', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body style="background:#111"><script type="module" src="/@vite/client"></script><script type="module" src="/scripts/qa/arena-weapons-page.ts"></script></body></html>'); }); } };
const web = await createServer({ configFile: 'vite.config.ts', mode: 'development', plugins: [page0], server: { port: 5187, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
await web.listen();
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['/opt/pw-browsers/chromium', chromium.executablePath()].find(p => p && existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'] });
try {
  if (mode === 'sheet') {
    const page = await browser.newPage({ viewport: { width: 1400, height: 520 * ids.length } }); page.setDefaultTimeout(+process.env.TIMEOUT || 180000);
    page.on('pageerror', e => console.error('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error') console.error(m.text().slice(0, 300)); });
    page.on('requestfailed', r => console.error('failed', r.url().slice(-80)));
    await page.goto(`http://127.0.0.1:5187/__arena_weapons.html?mode=sheet&ids=${ids.join(',')}`);
    await page.waitForFunction(() => document.title === 'done');
    await page.screenshot({ path: third || 'weapon-sheet.png' });
  } else {
    const poses = (third || 'hip,ads,reload,sprint').split(','), out = 'docs/screenshots/arena/visual/';
    await mkdir(out, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.setDefaultTimeout(180000);
    page.on('pageerror', e => console.error('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error') console.error(m.text().slice(0, 300)); });
    for (const id of ids) for (const pose of poses) {
      await page.goto(`http://127.0.0.1:5187/__arena_weapons.html?mode=fp&id=${id}&pose=${pose}`);
      await page.waitForFunction(() => document.title === 'done');
      await page.screenshot({ path: `${process.env.OUT || out}weapon-${id}-${pose}.png` });
      console.log(id, pose);
    }
  }
} finally { await browser.close(); await web.close(); }
