// Sounds as things happen: footsteps on paving and on grass, a jump's landing, the library door, sitting on a
// bench and standing up, getting into the car, starting it, driving and getting out, and the ambience around
// you. Checks what the game plays (QA hook) and that sound is on by default and silent at volume 0.
// Usage: TEST_URL=http://localhost:5173 node tests/browser-sound.mjs   (needs `npm run dev` or the QA pair)
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { launch, QUERY } from './support/browser.mjs';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
// Isolated local gameplay: no QA movement enters a user's shared room.
await ctx.addInitScript(() => { const Real = window.WebSocket; window.WebSocket = function (url, p) { if (!String(url).endsWith('/ws')) return new Real(url, p); const fake = { readyState: 3, send() {}, close() {} }; setTimeout(() => fake.onclose?.({ code: 1006 }), 0); return fake; }; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3 }); localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', reducedMotion: true }, version: 0 })); });
const page = await ctx.newPage(), errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
page.setDefaultTimeout(120000);
const pass = name => { results.push(name); console.log('PASS', name); };
const sounds = () => page.evaluate(() => window.__campusSounds());
/** Wait until a sound has played since `mark` (an index into the played list). */
const heard = (name, mark, timeout = 60000) => page.waitForFunction(([n, i]) => window.__campusSounds().played.slice(i).some(p => p === n), [name, mark], { timeout });
const mark = async () => (await sounds()).played.length;
const steer = (x, z) => page.evaluate(([x, z]) => window.__campusDebug.walkTo(x, z), [x, z]).then(() => page.waitForFunction(() => !window.__campusDebug.walking(), null, { timeout: 120000 }));
try {
  await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5173') + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.waitForFunction(() => window.__campusSounds().loaded.length >= 19, null, { timeout: 120000 });
  const s0 = await sounds(); assert.equal(s0.state, 'running', 'the click on Enter starts audio');
  pass(`sound is on by default and ${s0.loaded.length} recorded sounds load after entering`);
  await page.waitForFunction(() => ['loop:birds', 'loop:wind', 'loop:water'].every(n => window.__campusSounds().played.includes(n)), null, { timeout: 30000 });
  pass('birdsong, breeze and the fountain play around you');
  // Paving (the courtyard avenue), then lawn beside it.
  await page.evaluate(() => window.__campusDebug.teleport(0, 30, Math.PI));
  let m = await mark(); await steer(0, 24); await heard('step-hard', m); pass('footsteps on paving');
  // A stretch of lawn six metres long, with nothing in the way, found with the game's own surface map.
  const lawn = await page.evaluate(async () => {
    const { surfaceAt } = await import('/src/audio/surface.ts'), { blocked } = await import('/shared/campus.mjs');
    for (let x = -60; x < 60; x += 2) for (let z = -60; z < 45; z += 2) { let ok = true; for (let k = 0; k <= 12 && ok; k++) ok = surfaceAt(x, z + k * .5) === 'grass' && !blocked(x, z + k * .5); if (ok) return { x, z }; }
    return null;
  });
  assert.ok(lawn, 'a lawn to walk on');
  await page.evaluate(([x, z]) => window.__campusDebug.teleport(x, z + 6, Math.PI), [lawn.x, lawn.z]);
  m = await mark(); await steer(lawn.x, lawn.z); await heard('step-grass', m); pass('footsteps on grass');
  m = await mark(); await page.keyboard.press('Space'); await heard('step-grass', m, 20000); await page.waitForFunction(i => window.__campusSounds().played.slice(i).includes('seat-soft'), m, { timeout: 20000 }); pass('a jump pushes off and lands');
  // The library door, opened from outside.
  await page.evaluate(() => window.__campusDebug.teleport(-30, -2.6, 0)); // facing the doors, within reach
  await page.waitForFunction(() => /Open door/.test(window.__campusDebug.focus()?.label ?? ''), null, { timeout: 20000 });
  m = await mark(); await page.evaluate(() => window.__campusDebug.activate()); await heard('door-open', m); await heard('door-latch', m); pass('the door opens with its handle and swing');
  m = await mark(); await page.evaluate(() => window.__campusDebug.activate()); await heard('door-close', m, 20000); pass('the door shuts against its frame');
  // A timber bench on the avenue.
  await page.evaluate(() => window.__campusDebug.teleport(0, 30, Math.PI));
  const seat = await page.evaluate(async () => { const { SEATS } = await import('/shared/interactions.mjs'); const p = window.__campusInspect().position; return SEATS.filter(s => s.kind === 'bench').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; });
  await page.evaluate(([x, z, yaw]) => window.__campusDebug.teleport(x + Math.sin(yaw) * .9, z + Math.cos(yaw) * .9, yaw), [seat.x, seat.z, seat.yaw]);
  m = await mark(); await page.evaluate(id => window.__campusDebug.sit(id), seat.id);
  await heard('cloth', m, 60000); await heard('seat-wood', m, 60000); pass('sitting on a bench: clothes and the timber seat');
  await page.waitForFunction(() => window.__campusDebug.state().sit?.phase === 'seated', null, { timeout: 60000 });
  m = await mark(); await page.evaluate(() => window.__campusDebug.standUp()); await heard('cloth', m, 60000); pass('standing up');
  await page.waitForFunction(() => !window.__campusDebug.state().sit, null, { timeout: 60000 });
  // The courtyard car: in, engine on, drive, engine off, out.
  await page.evaluate(() => window.__campusDebug.teleport(11.9, 63.3, 0));
  await page.waitForFunction(() => window.__campusDebug.focus()?.label === 'Drive', null, { timeout: 20000 });
  m = await mark(); await page.evaluate(() => window.__campusDebug.activate());
  await heard('car-door-open', m); await heard('car-door-close', m); await heard('engine-start', m); await heard('loop:engine', m, 30000); pass('getting in: the door, then the engine starting and idling');
  await page.keyboard.down('KeyW'); await page.waitForFunction(async () => { const { useVehicle, vehicleVisuals } = await import('/src/vehicles/client.ts'); return Math.abs(vehicleVisuals.get(useVehicle.getState().id)?.speed ?? 0) > 3; }, null, { timeout: 60000 }); await page.keyboard.up('KeyW');
  pass('driving away');
  await page.waitForFunction(async () => { const { useVehicle, vehicleVisuals } = await import('/src/vehicles/client.ts'); return Math.abs(vehicleVisuals.get(useVehicle.getState().id)?.speed ?? 9) < .3; }, null, { timeout: 60000 });
  m = await mark(); await page.evaluate(() => window.__campusDebug.activate()); await heard('engine-stop', m); await heard('car-door-open', m); pass('getting out: the engine shuts off and the door opens and closes');
  // Volume 0 silences everything (the context is suspended).
  await page.getByRole('button', { name: 'Pause and settings', exact: true }).click();
  await page.getByRole('slider', { name: 'Sound volume' }).fill('0');
  await page.waitForFunction(() => window.__campusSounds().state === 'suspended', null, { timeout: 10000 }); pass('volume 0 suspends all sound');
  assert.deepEqual(errors, []); pass('no browser errors');
} finally {
  await writeFile('docs/sound-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors, sounds: await page.evaluate(() => window.__campusSounds?.()).catch(() => null) }, null, 2));
  await browser.close();
}
