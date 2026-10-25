// Real-browser test of the campus characters (shared/npcs.mjs, src/npc) against the running app and room.
// Usage: node tests/browser-npcs.mjs   (requires `npm run dev`, or TEST_URL for another web + room pair;
// ONLY=offline,phone,online to select). Screenshots and results go to docs/screenshots/npcs/.
//
// Offline parts keep the page away from the room (the same rules then run in the browser), so the QA hook
// may place the player and change a building's completion; online parts use the room and normal movement.
import { launch, QUERY } from './support/browser.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TEST_URL || 'http://localhost:5173', OUT = 'docs/screenshots/npcs';
const only = (process.env.ONLY || '').split(',').filter(Boolean), want = s => !only.length || only.includes(s);
await mkdir(OUT, { recursive: true });
const browser = await launch(), results = [], errors = [], metrics = {};
const pass = label => { results.push(label); console.log('PASS', label); };

async function open(name, { mobile = false, offline = false, viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 } } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });
  await ctx.addInitScript(n => localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n }, version: 1 })), name);
  const page = await ctx.newPage(); page.setDefaultTimeout(60000); page.label = name;
  if (offline) await page.routeWebSocket(/\/ws/, ws => ws.close());
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(base + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  if (!offline) await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  return page;
}
const until = (p, fn, arg, timeout = 30000) => p.waitForFunction(fn, arg, { timeout });
const st = p => p.evaluate(() => window.__campusDebug.state());
const focus = p => p.evaluate(() => window.__campusDebug.focus());
const npc = (p, id) => p.evaluate(i => window.__campusNpcs.list().find(n => n.id === i) ?? null, id);
const shot = async (p, name) => writeFile(`${OUT}/${name}.png`, await p.screenshot());
const place = (p, x, z, yaw = 0) => p.evaluate(([x, z, yaw]) => window.__campusDebug.teleport(x, z, yaw, .15, 4.6), [x, z, yaw]);
/** Wait for a character's model to be in the scene (it loads on first approach). */
const drawn = (p, id) => until(p, i => { let n = 0; window.__campusScene.traverse(o => { if (o.name === 'npc:' + i && o.children.length >= 3) n++; }); return n === 1; }, id, 120000);
const groups = (p, id) => p.evaluate(i => { let n = 0; window.__campusScene.traverse(o => { if (o.name === 'npc:' + i) n++; }); return n; }, id);
const gpu = p => p.evaluate(() => ({ ...window.__campusGL.info.memory, programs: window.__campusGL.info.programs?.length ?? 0 }));
const noOverflow = async p => { const o = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, modal: (m => m ? m.scrollWidth - m.clientWidth : 0)(document.querySelector('.modal-body')) })); assert.ok(o.doc <= 0 && o.modal <= 0, `${p.label}: horizontal overflow ${JSON.stringify(o)}`); };
/** Stand facing a character and wait for its prompt while it is waiting at a stop (not about to walk off). */
async function approach(p, id, x, z, yaw, label) {
  await place(p, x, z, yaw);
  await until(p, ([i, l]) => { const n = window.__campusNpcs.list().find(c => c.id === i); return window.__campusDebug.focus()?.label === l && n && n.state !== 'walking' && n.state !== 'returning'; }, [id, label], 120000);
}
async function closeDialog(p) { await p.getByRole('button', { name: 'Close panel' }).click(); await until(p, () => !window.__campusInspect().panel && !window.__campusNpcs.talking()); }
/** The character's body turns to the player who is talking to it. */
async function facing(p, id) {
  return until(p, i => { let g; window.__campusScene.traverse(o => { if (o.name === 'npc:' + i) g = o; }); const me = window.__campusDebug.state(); const want = Math.atan2(me.x - g.position.x, me.z - g.position.z), d = Math.atan2(Math.sin(want - g.rotation.y), Math.cos(want - g.rotation.y)); return Math.abs(d) < .3; }, id, 8000);
}

let A, B;
try {
  if (want('offline')) {
    A = await open('Ada QA', { offline: true });
    assert.equal((await A.evaluate(() => window.__campusNpcs.list())).length, 10, 'the whole cast is on duty by default');

    // ---- Studio D1: the teacher (80 %).
    await approach(A, 'teacher', 35.05, -40.3, 0, 'Talk to teacher'); await drawn(A, 'teacher');
    await A.keyboard.press('KeyE');
    await A.getByRole('heading', { name: 'Ms Ifeoma Okafor' }).waitFor();
    assert.equal((await npc(A, 'teacher')).state, 'interacting'); await facing(A, 'teacher');
    await A.getByRole('button', { name: 'What’s today’s design challenge?' }).click();
    await A.getByRole('heading', { name: 'Make one corner of campus more welcoming.' }).waitFor();
    await shot(A, 'teacher-dialogue'); pass('teacher: prompt, conversation, turns to the player, design brief');
    await A.keyboard.press('Escape'); await until(A, () => !window.__campusInspect().panel && !window.__campusNpcs.talking());
    assert.equal((await npc(A, 'teacher')).mode, 'routine', 'the conversation ends with the dialogue');
    const s0 = await st(A); await A.keyboard.down('KeyS'); await A.waitForTimeout(600); await A.keyboard.up('KeyS');
    const s1 = await st(A); assert.ok(Math.hypot(s1.x - s0.x, s1.z - s0.z) > .5, 'moving again after closing'); assert.equal(s1.activity, 'free');
    pass('closing the dialogue restores movement');
    // Below 80 % the teacher is not in the classroom; at exactly 80 % she is, and only once. GPU resources are
    // read after each return: a leak would grow them every cycle.
    await A.waitForTimeout(3000); const memory = [await gpu(A)];
    for (let i = 0; i < 6; i++) {
      assert.equal((await A.evaluate(() => window.__campusNpcs.setBuilding('studio-d1', 79))).left.join(), 'teacher');
      await until(A, () => !window.__campusNpcs.list().some(n => n.id === 'teacher')); await A.waitForTimeout(300);
      assert.equal(await groups(A, 'teacher'), 0, 'no teacher in the scene below 80%');
      assert.notEqual((await focus(A))?.id, 'npc:teacher');
      assert.equal((await A.evaluate(() => window.__campusNpcs.setBuilding('studio-d1', 80))).arrived.join(), 'teacher');
      await drawn(A, 'teacher'); await A.waitForTimeout(1500); memory.push(await gpu(A));
    }
    assert.equal(await groups(A, 'teacher'), 1);
    metrics.teacherCycles = memory;
    const [first, second, last] = [memory[0], memory[1], memory[memory.length - 1]];
    assert.ok(last.geometries <= Math.max(first.geometries, second.geometries) + 2 && last.textures <= Math.max(first.textures, second.textures) + 2 && last.programs <= Math.max(first.programs, second.programs) + 1, `GPU resources settle over 6 arrivals: ${JSON.stringify(memory)}`);
    pass('teacher appears at exactly 80% and not at 79%, once, without leaking GPU resources over 6 cycles');
    // Mid-conversation, the classroom drops below 80 %: the dialogue closes and says why.
    await approach(A, 'teacher', 35.05, -40.3, 0, 'Talk to teacher'); await A.keyboard.press('KeyE'); await A.getByRole('heading', { name: 'Ms Ifeoma Okafor' }).waitFor();
    await A.evaluate(() => window.__campusNpcs.setBuilding('studio-d1', 60));
    await until(A, () => !window.__campusInspect().panel); await A.getByText(/stepped away.*60% complete/).waitFor();
    await A.evaluate(() => window.__campusNpcs.setBuilding('studio-d1', 85)); pass('a character leaving duty closes its dialogue with an explanation');
    // The classroom's own fixtures still work beside her.
    await place(A, 33.5, -38.2, Math.PI); await until(A, () => window.__campusDebug.focus()?.label === 'Sit'); await A.keyboard.press('KeyE');
    await until(A, () => window.__campusDebug.state().sit?.phase === 'seated', null, 30000); await A.keyboard.press('KeyE');
    await until(A, () => !window.__campusDebug.state().sit, null, 30000); pass('classroom desks still work with the teacher on duty');

    // ---- Courtyard Café: the vendor (40 %) and the existing counter.
    await A.evaluate(() => window.__campusNpcs.setBuilding('courtyard-cafe', 60));
    // At the counter the familiar prompt is unchanged, and the vendor serves it: her conversation opens at the order form.
    await approach(A, 'vendor', 26.5, -9.3, 0, 'Order at the counter'); await drawn(A, 'vendor');
    assert.match((await focus(A)).hint, /Tolu/);
    await A.keyboard.press('KeyE'); await A.getByRole('heading', { name: 'Tolu' }).waitFor();
    await A.getByRole('button', { name: /Jollof rice bowl/ }).click(); await A.getByRole('button', { name: /Zobo/ }).click();
    await A.getByRole('button', { name: /Place demo order/ }).click(); await A.getByText(/is being prepared/).waitFor();
    await A.getByText(/Tolu is getting it ready/).waitFor();
    assert.equal(await A.evaluate(() => window.__campusNpcs.list().find(n => n.id === 'vendor').mode), 'engaged');
    await shot(A, 'vendor-order'); await closeDialog(A);
    await approach(A, 'vendor', 28.9, -9.5, 0, 'Talk to vendor'); await A.keyboard.press('KeyE'); await A.getByRole('heading', { name: 'Tolu' }).waitFor();
    await A.getByRole('button', { name: 'What’s on the menu?' }).click(); await A.getByText('Single origin from the Mambilla Plateau').waitFor(); await closeDialog(A);
    pass('vendor: serves the counter’s own demo ordering, and talks about the menu');
    await A.evaluate(() => window.__campusNpcs.setBuilding('courtyard-cafe', 39)); await until(A, () => !window.__campusNpcs.list().some(n => n.id === 'vendor'));
    assert.equal(await groups(A, 'vendor'), 0, 'no vendor below 40%');
    await place(A, 26.5, -9.3, 0); await until(A, () => window.__campusDebug.focus()?.label === 'Order at the counter'); await A.keyboard.press('KeyE');
    await A.getByRole('heading', { name: 'What can we get you?' }).waitFor();
    await A.getByRole('button', { name: /Moi moi/ }).click(); await A.getByRole('button', { name: /Place demo order/ }).click(); await A.getByText(/is being prepared/).waitFor();
    assert.equal(await A.getByText(/Tolu is getting it ready/).count(), 0, 'nobody serves below 40%');
    await closeDialog(A);
    await A.evaluate(() => window.__campusNpcs.setBuilding('courtyard-cafe', 40)); await drawn(A, 'vendor'); pass('vendor absent at 39%, present at exactly 40%; the counter keeps working without her');

    // ---- Adunni Learning Commons: the librarian and the catalogue.
    await approach(A, 'librarian', -22.6, -6.6, 0, 'Ask librarian'); await drawn(A, 'librarian');
    await A.keyboard.press('KeyE'); await A.getByRole('heading', { name: 'Mrs Hauwa Musa' }).waitFor();
    await A.getByRole('button', { name: 'Find a book or subject' }).click();
    await A.getByPlaceholder('Title, author or subject').fill('river'); await A.getByText('Rivers of the Delta').waitFor();
    await A.getByText(/fictional collection/).waitFor();
    await A.getByRole('button', { name: 'How do the catalogue computers work?' }).click();
    await A.getByRole('button', { name: 'Show me the computers' }).click();
    await until(A, () => !window.__campusInspect().panel);
    await A.getByText('Follow the gold marker to Catalogue computers.').waitFor();
    pass('librarian: catalogue search (labelled fictional) and directions with the map marker');
    await place(A, -30, -21.7, 0); await until(A, () => window.__campusDebug.focus()?.label === 'Browse new arrivals'); await A.keyboard.press('KeyE');
    await A.getByText('Design for Everyday Belonging').waitFor(); await A.keyboard.press('Escape'); pass('the New Arrivals display still works');

    // ---- The Courts: no conversation while holding a ball.
    await A.evaluate(() => window.__campusDebug.drop());
    await place(A, 33.6, 21.3, Math.PI); await until(A, () => window.__campusDebug.focus()?.label === 'Pick up basketball'); await A.keyboard.press('KeyE');
    await until(A, () => window.__campusDebug.state().holding);
    for (let i = 0; i < 5; i++) { assert.notEqual((await focus(A))?.id, 'npc:coach', 'no coach prompt while holding a ball'); await A.waitForTimeout(150); }
    await A.keyboard.press('KeyQ'); await until(A, () => !window.__campusDebug.state().holding);
    await approach(A, 'coach', 31.4, 19.8, -Math.PI / 2 - .3, 'Talk to coach'); await A.keyboard.press('KeyE');
    await A.getByRole('heading', { name: 'Coach Dayo' }).waitFor(); await A.getByRole('button', { name: 'How do I shoot?' }).click(); await A.getByText(/gold band/).first().waitFor();
    await closeDialog(A); pass('coach: no prompt while holding a ball; afterwards a conversation about shooting');

    // ---- Graphics quality: the cast survives the scene being rebuilt.
    await A.keyboard.press('Escape'); await A.getByRole('button', { name: /^medium/i }).click(); await A.getByRole('button', { name: /Back to campus/ }).click();
    await approach(A, 'librarian', -22.6, -6.6, 0, 'Ask librarian'); await drawn(A, 'librarian');
    await A.keyboard.press('KeyE'); await A.getByRole('heading', { name: 'Mrs Hauwa Musa' }).waitFor(); await closeDialog(A);
    pass('after switching graphics quality, characters are drawn and talk as before');
    metrics.offline = await A.evaluate(() => ({ spawns: window.__campusNpcs.spawns(), drawCalls: window.__campus?.drawCalls }));
    await A.context().close(); A = null;
  }

  if (want('phone')) {
    B = await open('Tobi QA', { mobile: true, offline: true });
    await approach(B, 'services-officer', -19.9, 25.5, 0, 'Ask about services'); await drawn(B, 'services-officer');
    await B.locator('.touch-action').tap(); await B.getByRole('heading', { name: 'Mr Chinedu Eze' }).waitFor();
    await B.getByRole('button', { name: 'Who’s working on campus today?' }).tap();
    await B.getByText('On duty at Studio D1').waitFor(); await B.getByText('On duty at Courtyard Café').waitFor();
    await noOverflow(B); await shot(B, 'phone-staff');
    await B.getByRole('button', { name: 'Give me directions' }).tap(); await noOverflow(B);
    await B.getByRole('button', { name: /Adunni Learning Commons/ }).tap(); await until(B, () => !window.__campusInspect().panel);
    assert.equal(await B.evaluate(() => window.__campusNpcs.talking()), null);
    await place(B, -22.6, -6.6, 0); await until(B, () => window.__campusDebug.focus()?.label === 'Ask librarian', null, 90000);
    await B.locator('.touch-action').tap(); await B.getByRole('heading', { name: 'Mrs Hauwa Musa' }).waitFor();
    await B.getByRole('button', { name: 'What facilities are here?' }).tap(); await noOverflow(B); await shot(B, 'phone-librarian');
    await closeDialog(B); pass('phone: touch Interact opens conversations; dialogues fit a 390 px screen without sideways scrolling');
    await B.context().close(); B = null;
  }

  if (want('online')) {
    A = await open('Ada QA'); B = await open('Tobi QA', { mobile: true });
    // Both browsers draw the same character in the same place (from the room's state and clock).
    const [la, lb] = await Promise.all([A.evaluate(() => window.__campusNpcs.list()), B.evaluate(() => window.__campusNpcs.list())]);
    assert.deepEqual(la.map(n => n.id), lb.map(n => n.id));
    for (const n of la) { const m = lb.find(x => x.id === n.id); assert.equal(m.mode, n.mode); assert.ok(Math.hypot(m.x - n.x, m.z - n.z) < .6, `${n.id} is in the same place in both browsers`); }
    assert.deepEqual((await A.evaluate(() => window.__campusInspect())).peers.map(p => p.name), ['Tobi QA'], 'only the other human is a peer');
    assert.deepEqual((await B.evaluate(() => window.__campusInspect())).peers.map(p => p.name), ['Ada QA']);
    await A.getByRole('button', { name: /online/ }).click(); await A.getByText('IN THE COURTYARD · 2').waitFor();
    assert.equal(await A.locator('.people-row').count(), 1, 'the People list has only the other player'); await A.keyboard.press('Escape');
    pass('two browsers: same cast, same places; characters are not in the People list or the online count');
    // A walks to the services officer (normal movement, validated by the room) and talks to them.
    for (const [x, z] of [[-6, 31], [-19.9, 25.6]]) { await A.evaluate(([x, z]) => window.__campusDebug.walkTo(x, z), [x, z]); await until(A, () => !window.__campusDebug.walking(), null, 60000); }
    await A.evaluate(() => window.__campusDebug.face(Math.PI)); await drawn(A, 'services-officer');
    await until(A, () => window.__campusDebug.focus()?.label === 'Ask about services', null, 60000); await A.keyboard.press('KeyE');
    await A.getByRole('heading', { name: 'Mr Chinedu Eze' }).waitFor();
    await until(B, () => window.__campusNpcs.list().find(n => n.id === 'services-officer')?.mode === 'engaged', null, 10000);
    assert.equal((await npc(B, 'services-officer')).by.length, 1, 'the other browser sees the officer talking to one player');
    await facing(A, 'services-officer'); await shot(A, 'online-officer');
    await closeDialog(A);
    await until(B, () => window.__campusNpcs.list().find(n => n.id === 'services-officer')?.mode === 'routine', null, 10000);
    pass('online: the room starts and ends the conversation; the other browser sees both');
    metrics.online = await A.evaluate(() => window.__campus);
  }
  assert.deepEqual(errors, [], 'no runtime errors or unhandled rejections');
  console.log(`\n${results.length} checks passed`);
} catch (e) {
  console.error('FAILED', e.message); for (const p of [A, B]) if (p) await shot(p, `failure-${p.label.replace(/\s/g, '')}`).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), base, passed: results, errors, metrics, failed: process.exitCode === 1 }, null, 2));
  await browser.close();
}
