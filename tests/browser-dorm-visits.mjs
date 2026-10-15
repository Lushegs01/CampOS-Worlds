// Visits to a friend's room in real browsers, against the full local stack (PostgreSQL + Supabase
// stand-in + room server + Vite): two signed-in friends. Ada walks to her room and invites Tobi, who
// goes straight in from the invitation; they see each other there and nobody else. Ada shows him out,
// lets friends drop in, Tobi visits from his friends list, and Ada leaving sends him out.
// Usage: node tests/browser-dorm-visits.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { startStack } from './support/stack.mjs';
import { launch, QUERY } from './support/browser.mjs';
import { DORM_OUTSIDE, inDormRoom } from '../shared/dorm.mjs';

const OUT = 'docs/screenshots/dorm';
await mkdir(OUT, { recursive: true });
const stack = await startStack({ name: 'browser-visits', webPort: 5181, roomPort: 3207, supabasePort: 54327 });
const browser = await launch(), results = [], errors = [];
const pass = label => { results.push(label); console.log('PASS', label); };
const stamp = Date.now().toString(36).slice(-5);

async function account(handle, name) {
  const sb = createClient(stack.supa.url, stack.supa.anonKey, { auth: { persistSession: false } });
  const email = `${handle}@example.test`;
  assert.equal((await sb.auth.signUp({ email, password: 'correct horse battery' })).error, null);
  assert.equal((await sb.rpc('save_profile', { p_handle: handle, p_display_name: name, p_bio: '', p_avatar: { model: name === 'Ada' ? 'ada' : 'tunde' } })).error, null);
  return { sb, email, handle, name };
}
async function open(label) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  await ctx.addInitScript(n => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n, reducedMotion: true }, version: 0 })); }, label);
  const page = await ctx.newPage(); page.setDefaultTimeout(45000);
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  await page.goto(stack.url + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.waitForFunction(() => window.__campusInspect?.().status === 'connected', null, { timeout: 60000 });
  return page;
}
async function signIn(page, who) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email').fill(who.email); await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: /^Sign in/ }).last().click();
  await page.getByRole('button', { name: /Edit profile/ }).waitFor();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: `Your profile, @${who.handle}` }).waitFor();
}
async function walk(p, x, z) {
  await p.evaluate(([x, z]) => window.__campusDebug.walkTo(x, z), [x, z]);
  await p.waitForFunction(() => !window.__campusDebug.walking(), null, { timeout: 130000 });
  await p.waitForFunction(() => { const s = window.__campusDebug.state(); return Math.hypot(s.room.x - s.x, s.room.z - s.z) < 1; }, null, { timeout: 60000 });
}
const state = p => p.evaluate(() => window.__campusDebug.state());
const drawn = (p, id) => p.evaluate(id => { const tag = window.__campusScene.getObjectByName(`tag:${id}`); return !!tag && tag.parent.visible; }, id);
const hud = p => p.locator('.dorm-hud');

try {
  const ada = await account(`ada_${stamp}`, 'Ada'), tobi = await account(`tobi_${stamp}`, 'Tobi');
  assert.equal((await ada.sb.rpc('send_friend_request', { p_handle: tobi.handle })).error, null);
  const req = (await tobi.sb.rpc('social_overview')).data.incoming[0];
  assert.equal((await tobi.sb.rpc('respond_friend_request', { p_request: req.id, p_accept: true })).error, null);

  // ---- Ada, signed in, walks to her room.
  const A = await open('Ada'); await signIn(A, ada);
  for (const [x, z] of [[0, 57], [200, 57], [420, 57], [648, 57], [648, 30], [648, 20], [651, 17], [651, 1.6], [DORM_OUTSIDE.x, DORM_OUTSIDE.z]]) await walk(A, x, z);
  await A.evaluate(() => window.__campusDebug.face(Math.PI));
  await A.waitForFunction(() => window.__campusDebug.focus()?.label === 'Go to your room', null, { timeout: 20000 });
  await A.keyboard.press('KeyE'); await hud(A).waitFor({ timeout: 30000 });
  const adaId = await A.evaluate(() => window.__campusNet.id());
  pass('Ada, signed in, is in her room');

  // ---- Tobi, out on campus, is invited and goes straight in from the invitation.
  const B = await open('Tobi'); await signIn(B, tobi);
  const tobiId = await B.evaluate(() => window.__campusNet.id());
  await hud(A).getByRole('button', { name: 'Invite' }).click();
  const guests = A.locator('.dorm-guests');
  await guests.getByText('Friends on campus').waitFor();
  const row = guests.locator('.person-row', { hasText: 'Tobi' });
  await row.getByRole('button', { name: 'Invite' }).click({ timeout: 30000 });
  await row.getByRole('button', { name: 'Invited' }).waitFor();
  await A.getByRole('button', { name: 'Close panel' }).click();
  const card = B.getByRole('alertdialog', { name: 'Room invitation from Ada' });
  await card.waitFor({ timeout: 30000 });
  await B.screenshot({ path: `${OUT}/6-invitation.png` });
  await card.getByRole('button', { name: 'Go' }).click();
  await hud(B).getByText('Ada’s room').waitFor({ timeout: 30000 });
  let s = await state(B);
  assert.ok(inDormRoom(s.x, s.z), 'Tobi travelled into the room');
  assert.equal(await B.locator('.location-hud h3').textContent(), 'Ada’s room');
  await hud(A).getByText(/Visiting: Tobi/).waitFor({ timeout: 20000 });
  await B.waitForFunction(id => window.__campusScene.getObjectByName(`tag:${id}`)?.parent.visible === true, adaId, { timeout: 20000 });
  await A.waitForFunction(id => window.__campusScene.getObjectByName(`tag:${id}`)?.parent.visible === true, tobiId, { timeout: 20000 });
  assert.equal(await hud(B).getByRole('button', { name: /Arrange/ }).count(), 0, 'a visitor can’t rearrange the room');
  assert.ok(await B.evaluate(() => (window.__campusScene.getObjectByName('dorm-furniture')?.children.length ?? 0) > 3), 'the visitor sees Ada’s furniture');
  await B.waitForTimeout(3000); await B.screenshot({ path: `${OUT}/7-visiting.png` });
  pass('an invited friend goes straight in, sees the room and its resident, and can’t rearrange it');

  // ---- Ada shows Tobi out.
  await hud(A).getByRole('button', { name: 'Invite' }).click();
  await A.locator('.dorm-guests .person-row', { hasText: 'Tobi' }).getByRole('button', { name: 'Show out' }).click();
  await hud(B).waitFor({ state: 'detached', timeout: 30000 });
  s = await state(B); assert.ok(!inDormRoom(s.x, s.z));
  assert.equal(await drawn(A, tobiId), false);
  pass('the resident can show a visitor out');

  // ---- Ada lets friends drop in; Tobi visits from his friends list.
  await A.getByRole('radio', { name: 'Any friend, while you’re in' }).check();
  await A.waitForFunction(async () => (await import('/src/social/store.ts')).useSocial.getState().overview?.settings.room_visits === 'friends', null, { timeout: 20000 });
  await A.getByRole('button', { name: 'Close panel' }).click();
  await B.getByRole('button', { name: /^Friends, messages and party/ }).click();
  await B.locator('.social-drawer').getByRole('tab', { name: /^Friends/ }).click();
  const visit = B.getByRole('button', { name: 'Visit Ada’s room' });
  await visit.waitFor({ timeout: 30000 });
  assert.ok(await B.locator('.friend-row', { hasText: 'Ada' }).getByText('In their room · Palm House').isVisible());
  await visit.click();
  await hud(B).getByText('Ada’s room').waitFor({ timeout: 30000 });
  pass('with drop-in visits on, a friend visits from their friends list');

  // ---- Ada leaving sends Tobi out, with a message.
  await hud(A).getByRole('button', { name: 'Leave' }).click();
  await hud(B).waitFor({ state: 'detached', timeout: 30000 });
  await B.locator('.toast', { hasText: 'has left their room' }).waitFor({ timeout: 10000 });
  s = await state(B); assert.ok(!inDormRoom(s.x, s.z) && Math.hypot(s.x - DORM_OUTSIDE.x, s.z - DORM_OUTSIDE.z) < 1);
  pass('the resident leaving shows visitors back to the common room');

  await writeFile('docs/dorm-visits-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log('ALL PASSED', results.length);
} catch (e) {
  console.error('FAILED', e); await writeFile('docs/dorm-visits-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors, failure: String(e) }, null, 2)); process.exitCode = 1;
} finally { await browser.close(); await stack.stop(); }
