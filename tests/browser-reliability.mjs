// Real-browser checks for failure paths: a character that cannot be downloaded, a connection lost the
// way a phone loses it (the room still holds the old socket), and a session opened in a second tab.
// Usage: TEST_URL=http://localhost:5173 node tests/browser-reliability.mjs   (needs `npm run dev` or the QA pair)
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { launch, QUERY } from './support/browser.mjs';
import { SPAWN } from '../shared/campus.mjs';
import { SEAT_BY_ID, seatApproach, STAND_EXIT } from '../shared/interactions.mjs';

const base = process.env.TEST_URL || 'http://localhost:5173';
const browser = await launch(), results = [], errors = [], sockets = [];
const pass = label => { results.push(label); console.log('PASS', label); };
async function open(name, { context, route } = {}) {
  const ctx = context ?? await browser.newContext({ viewport: { width: 900, height: 600 } });
  if (!context) await ctx.addInitScript(n => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n }, version: 0 })); }, name);
  const page = await ctx.newPage(); page.setDefaultTimeout(45000);
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  if (route) await page.route(route, r => r.abort());
  await page.goto(base + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.waitForFunction(() => window.__campusInspect?.().status === 'connected', null, { timeout: 60000 });
  return page;
}
const debug = (p, fn, arg) => p.evaluate(fn, arg);
const health = async () => (await (await fetch(base + '/health')).json()).players;

try {
  // ---- 1. A character that fails to download: a stand-in figure, not a crashed campus.
  {
    const page = await open('Avatar QA', { route: /characters\/zainab\.glb/ });
    let requests = 0; page.on('request', r => { if (/characters\/zainab\.glb/.test(r.url())) requests++; });
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { origin: new URL(base).origin }); sockets.push(ws);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    ws.send(JSON.stringify({ type: 'join', name: 'Zainab Bot', avatar: { model: 'zainab' } }));
    await page.waitForFunction(() => window.__campusInspect().peers.some(p => p.name === 'Zainab Bot'));
    await page.waitForFunction(() => !!window.__campusScene?.getObjectByName('avatar-stand-in'), null, { timeout: 30000 });
    assert.equal(await page.locator('.graphics-error').count(), 0, 'the campus is still running');
    await page.waitForTimeout(6000);
    assert.ok(requests <= 3, `retries are spaced out, not a request storm (${requests} requests)`);
    pass('a character that cannot be downloaded shows a stand-in; the campus keeps running');
    // The renderer reports the caught failure (reportError); that one expected message is not a defect.
    for (let i = errors.length - 1; i >= 0; i--) if (/^Avatar QA: Failed to fetch$/.test(errors[i])) errors.splice(i, 1);
    ws.close(); await page.context().close();
  }

  // ---- 2. Seated when the connection silently drops: reconnect, stand up where you were, sit again.
  {
    const page = await open('Seat QA'), seat = SEAT_BY_ID.get('bench-0-l'), stand = seatApproach(seat), exit = seatApproach(seat, STAND_EXIT);
    await debug(page, ([x, z]) => window.__campusDebug.walkTo(x, z), [stand.x, stand.z + .6]);
    await page.waitForFunction(() => !window.__campusDebug.walking(), null, { timeout: 90000 });
    await debug(page, id => window.__campusDebug.sit(id), seat.id);
    await page.waitForFunction(id => window.__campusDebug.state().activity === 'seated' && !!window.__campusDebug.state().world.seats[id], seat.id, { timeout: 60000 });
    const before = await debug(page, () => window.__campusNet.id());
    // The phone changes networks: the page loses its socket, the room still holds the old one.
    await debug(page, () => window.__campusNet.abandon());
    await page.waitForFunction(old => window.__campusInspect().status === 'connected' && window.__campusNet.id() && window.__campusNet.id() !== old, before, { timeout: 60000 });
    // It used to stay "session in use" for good, or start again at the gate, still seated locally.
    await page.waitForFunction(() => window.__campusDebug.state().activity === 'free', null, { timeout: 20000 });
    const s = await debug(page, () => window.__campusDebug.state());
    assert.ok(Math.hypot(s.x - exit.x, s.z - exit.z) < 1, `stood up at the bench (${s.x.toFixed(2)}, ${s.z.toFixed(2)}), not elsewhere`);
    assert.ok(Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z) > 5, 'not sent back to the gate');
    assert.equal(Object.values(s.world.seats).length, 0, 'the room freed the seat');
    assert.equal(await health(), 1, 'one player in the room, not a ghost of the old connection');
    pass('a silently dropped connection while seated reconnects in place, standing, with one session');
    await debug(page, id => window.__campusDebug.sit(id), seat.id);
    await page.waitForFunction(() => window.__campusDebug.state().activity === 'seated', null, { timeout: 60000 });
    await debug(page, () => window.__campusDebug.standUp());
    await page.waitForFunction(() => window.__campusDebug.state().activity === 'free', null, { timeout: 60000 });
    pass('after reconnecting, sitting and standing work again');

    // ---- 3. The same session opened in a second tab (a duplicated tab copies it): the newer tab takes over.
    const token = await debug(page, () => sessionStorage.getItem('campus-session'));
    const ctx = page.context();
    await ctx.addInitScript(t => { if (!sessionStorage.getItem('campus-session')) sessionStorage.setItem('campus-session', t); }, token);
    const twin = await open('Seat QA', { context: ctx });
    await page.waitForFunction(() => window.__campusInspect().status === 'session in use', null, { timeout: 30000 });
    assert.equal(await health(), 1);
    await page.waitForTimeout(3000);
    assert.equal(await debug(page, () => window.__campusInspect().status), 'session in use', 'the older tab does not fight back');
    assert.equal(await debug(twin, () => window.__campusInspect().status), 'connected');
    pass('a duplicated tab takes the session over; the older tab stops and says why');
    await ctx.close();
  }
  // ---- 4. On Low the sun's shadow map is rendered once: nothing that moves may be drawn into it.
  {
    const page = await open('Shadow QA');
    const r = await page.evaluate(async () => {
      const { movingCasters } = await import('/src/world/shadows.ts');
      const gl = window.__campusGL, scene = window.__campusScene; let light = null;
      scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) light = o; });
      const seen = [], render = gl.shadowMap.render;
      gl.shadowMap.render = function (...args) { if (light.shadow.needsUpdate) { let casting = 0, meshes = 0; for (const root of movingCasters) root.traverse(o => { if (o.isMesh) { meshes++; if (o.castShadow) casting++; } }); seen.push({ casting, meshes }); } return render.apply(this, args); };
      light.shadow.needsUpdate = true;
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      gl.shadowMap.render = render;
      let after = 0; for (const root of movingCasters) root.traverse(o => { if (o.isMesh && o.castShadow) after++; });
      return { static: !light.shadow.autoUpdate, seen, after, roots: movingCasters.size };
    });
    assert.equal(r.static, true, 'Low renders the sun shadow once');
    assert.ok(r.seen.length >= 1 && r.seen[0].meshes > 0, `the static render ran with moving objects present (${JSON.stringify(r)})`);
    assert.equal(r.seen[0].casting, 0, 'no moving object drawn into the static shadow');
    assert.ok(r.after > 0, 'their shadow casting is restored afterwards');
    pass(`Low's render-once shadow leaves out ${r.roots} moving objects (vehicles, doors, balls, people) and restores them`);
    await page.context().close();
  }
  // ---- 5. A backgrounded tab (frozen by the browser) comes back connected, in place and playable.
  {
    const page = await open('Freeze QA'), cdp = await page.context().newCDPSession(page);
    const before = await debug(page, () => window.__campusInspect().position);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }); await new Promise(r => setTimeout(r, 6000));
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await page.waitForFunction(() => window.__campusInspect().status === 'connected', null, { timeout: 30000 });
    const after = await debug(page, () => window.__campusInspect().position);
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 1, `stayed put while frozen (moved ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(2)} m)`);
    await page.keyboard.down('KeyW');
    await page.waitForFunction(z => window.__campusInspect().position.z < z - 1, after.z, { timeout: 20000 }).finally(() => page.keyboard.up('KeyW'));
    pass('a frozen (backgrounded) tab resumes connected, in place, and playable');
    await page.context().close();
  }
  // ---- 6. The GPU drops the WebGL context (memory pressure on a phone): a way back, not a dead canvas.
  {
    const page = await open('Context QA');
    await debug(page, () => { window.__lost = window.__campusGL.getContext().getExtension('WEBGL_lose_context'); window.__lost.loseContext(); });
    await page.waitForFunction(() => window.__campusInspect().panel === 'recovery', null, { timeout: 20000 });
    await page.getByRole('button', { name: 'Reload campus' }).waitFor();
    pass('a lost WebGL context offers a reload on Low instead of leaving a dead canvas');
    await debug(page, () => window.__lost.restoreContext());
    await page.context().close();
  }
  // ---- 7. Someone arriving behind the camera is ready before you turn round: their character's
  //         textures are on the GPU while they are still out of view (uploading them on first sight
  //         was a long frame on a phone).
  {
    const page = await open('Upload QA');
    await debug(page, () => window.__campusDebug.walkTo(0, 24));
    await page.waitForFunction(() => !window.__campusDebug.walking(), null, { timeout: 90000 });
    const mine = await debug(page, () => window.__campusInspect().avatar.model);
    const model = ['ibrahim', 'ada', 'tunde'].find(m => m !== mine);
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws', { origin: new URL(base).origin }); sockets.push(ws);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    ws.send(JSON.stringify({ type: 'join', name: 'Behind You', avatar: { model } }));
    // Their figure is out of view (culled), and every texture of it has a GPU texture.
    const state = () => page.evaluate(() => {
      const gl = window.__campusGL, textures = new Set(); let hidden = 0;
      window.__campusScene.traverse(o => {
        if (!o.isSkinnedMesh) return; let shown = true; for (let p = o; p; p = p.parent) shown &&= p.visible; if (shown) return;
        hidden++; for (const v of Object.values(o.material)) if (v?.isTexture) textures.add(v);
      });
      const uploaded = [...textures].filter(t => gl.properties.get(t).__webglTexture).length;
      return { hidden, textures: textures.size, uploaded };
    });
    await page.waitForFunction(() => window.__campusInspect().peers.some(p => p.name === 'Behind You'));
    await page.waitForFunction(() => { let n = 0; window.__campusScene.traverse(o => { if (o.isSkinnedMesh) { let shown = true; for (let p = o; p; p = p.parent) shown &&= p.visible; if (!shown) n++; } }); return n > 0; }, null, { timeout: 30000 });
    await page.waitForTimeout(8000);
    const r = await state();
    assert.ok(r.hidden > 0 && r.textures > 0, `the newcomer is out of view (${JSON.stringify(r)})`);
    assert.equal(r.uploaded, r.textures, `all of the newcomer's textures are uploaded before they are seen (${JSON.stringify(r)})`);
    pass(`a newcomer behind the camera has all ${r.textures} character textures on the GPU before coming into view`);
    ws.close(); await page.context().close();
  }
  await writeFile('docs/reliability-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log('ALL PASSED', results.length);
} catch (e) {
  console.error('FAILED', e); await writeFile('docs/reliability-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors, failure: String(e) }, null, 2)); process.exitCode = 1;
} finally { sockets.forEach(ws => ws.terminate()); await browser.close(); }
