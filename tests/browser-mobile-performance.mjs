// Repeatable mobile-viewport benchmark; this is desktop GPU emulation, not a phone claim.
// TEST_URL=... PERF_LABEL=before|after node tests/browser-mobile-performance.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const label = process.env.PERF_LABEL || 'after';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if(m.type()==='error' && !/WebSocket|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
page.setDefaultTimeout(120000);
try {
  await page.goto(process.env.TEST_URL || 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  const entryMs = await page.evaluate(() => performance.now());
  await page.waitForTimeout(10000);
  const renderer = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  const sample = async name => {
    const result = await page.evaluate(() => new Promise(resolve => {
      const times = [], start = performance.now(); let last = start;
      function frame(now) { times.push(now - last); last = now; if(now - start < 6000) return requestAnimationFrame(frame); times.sort((a,b)=>a-b); const canvas=document.querySelector('canvas');resolve({ fps: times.length * 1000 / (now-start), medianMs: times[Math.floor(times.length*.5)], p95Ms: times[Math.floor(times.length*.95)], telemetry: window.__campus, dpr: canvas.width/canvas.clientWidth }); }
      requestAnimationFrame(frame);
    }));
    console.log(name, JSON.stringify(result)); return { name, ...result };
  };
  const samples = [await sample('entry')];
  const scene = await page.evaluate(() => window.__campusStats?.());
  if(process.env.PERF_DIAGNOSE === '1') for(const prefix of ['chairs:', 'prop:', 'trees:', 'ground', 'campus:']) {
    await page.evaluate(p=>window.__campusHide(p, true),prefix);
    await page.waitForTimeout(500); samples.push(await sample('without-'+prefix));
    await page.evaluate(p=>window.__campusHide(p, false),prefix);
  }
  await mkdir('docs/screenshots/performance', {recursive:true});
  await page.screenshot({ path: `docs/screenshots/performance/mobile-${label}.png` });
  const resources = await page.evaluate(()=>{ const r=performance.getEntriesByType('resource'); return {requests:r.length, transferredBytes:r.reduce((n,x)=>n+x.transferSize,0), decodedBytes:r.reduce((n,x)=>n+x.decodedBodySize,0)}; });
  if (process.env.ASSERT_MOBILE_OPTIMIZED === '1') {
    const urls = await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));
    assert.ok(!urls.some(u=>/textures\/[^/]+\/(normal|arm)\.ktx2|\/PostFX-/.test(u)), 'Low fetched high-detail maps or post-processing');
    assert.ok(urls.some(u=>/basis_transcoder\.wasm\?v=/.test(u)), 'Decoder cache URL is not versioned');
    console.log('PASS production mobile downloads and versioned decoder');
  }
  const report = { date: new Date().toISOString(), browser: browser.version(), renderer, viewport: {width:390,height:844,deviceScaleFactor:3}, environment:'Desktop Chrome with mobile viewport/touch emulation; no CPU or network throttling. Not physical phone FPS.', entryMs, resources, samples, scene, errors };
  await writeFile(`docs/mobile-performance-${label}.json`, JSON.stringify(report,null,2));
  if(errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
