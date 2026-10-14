// Real-browser test of friends, private messages, parties and blocking against the full local stack
// (PostgreSQL + Supabase stand-in + room server + Vite). Two signed-in players in independent
// browser contexts, plus a third account that tries to read their conversation.
// Usage: node tests/browser-social-accounts.mjs   (PLAYWRIGHT_CHROMIUM_EXECUTABLE to pick a browser)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { startStack } from './support/stack.mjs';

const OUT = 'docs/screenshots/social';
await mkdir(OUT, { recursive: true });
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/opt/pw-browsers/chromium');
// Without a GPU (Linux CI, containers) Chromium falls back to software WebGL; `qa-scale` renders the
// 3D view at low resolution there so the interface stays responsive (QA builds only).
const gpu = process.platform === 'win32', args = gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'];
const QUERY = gpu ? '' : '/?qa-scale=0.2';
const stack = await startStack({ name: 'browser-social', webPort: 5179, roomPort: 3205, supabasePort: 54325 });
const browser = await chromium.launch({ headless: true, executablePath: exe, args });
const results = [], errors = [];
const pass = label => { results.push(label); console.log('PASS', label); };
const stamp = Date.now().toString(36).slice(-5);

async function account(handle, name, model) {
  const sb = createClient(stack.supa.url, stack.supa.anonKey, { auth: { persistSession: false } });
  const email = `${handle}@example.test`;
  assert.equal((await sb.auth.signUp({ email, password: 'correct horse battery' })).error, null);
  assert.equal((await sb.rpc('save_profile', { p_handle: handle, p_display_name: name, p_bio: '', p_avatar: { model } })).error, null);
  return { sb, email, handle, name };
}
async function open(label, { viewport = { width: 1280, height: 800 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(n => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n, reducedMotion: true }, version: 0 })); }, label);
  const page = await ctx.newPage(); page.setDefaultTimeout(45000);
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource|GPU stall|WebGL/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  await page.goto(stack.url + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 60000 });
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
const drawer = p => p.locator('.social-drawer');
async function social(p, tab) {
  if (!(await drawer(p).isVisible())) await p.getByRole('button', { name: /^Friends, messages and party/ }).click();
  await drawer(p).getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const where = p => p.evaluate(() => window.__campusInspect().position);

let A, B;
try {
  const ada = await account(`ada_${stamp}`, 'Ada', 'ada'), tobi = await account(`tobi_${stamp}`, 'Tobi', 'kelechi'), eve = await account(`eve_${stamp}`, 'Eve', 'zainab');
  A = await open('Ada'); B = await open('Tobi', { viewport: { width: 1100, height: 760 } });
  await signIn(A, ada); await signIn(B, tobi);
  await A.waitForFunction(h => window.__campusInspect().peers.some(p => p.handle === h), tobi.handle);
  pass('Two signed-in players in independent browser contexts see each other’s verified presence');

  // ---- a profile from the world: click Tobi's name tag, six metres in front of Ada
  const inRoom = h => [...stack.room.clients.values()].find(c => c.account?.handle === h);
  Object.assign(inRoom(ada.handle), { x: 0, z: 36 }); Object.assign(inRoom(tobi.handle), { x: 0, z: 30 });
  await A.waitForFunction(h => { const p = window.__campusInspect().peers.find(p => p.handle === h); return p && Math.abs(p.z - 30) < .5; }, tobi.handle);
  await A.evaluate(() => window.__campusDebug.face(Math.PI));
  await A.waitForTimeout(1500);
  const spot = await A.evaluate(h => {
    const id = window.__campusInspect().peers.find(p => p.handle === h).id, tag = window.__campusScene.getObjectByName('tag:' + id), v = tag.getWorldPosition(new tag.position.constructor());
    v.project(window.__campusCamera); const r = window.__campusGL.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, visible: tag.visible };
  }, tobi.handle);
  assert.ok(spot.visible, 'the name tag is shown at this distance');
  await A.mouse.click(spot.x, spot.y);
  await A.locator('.modal').getByRole('heading', { name: '@' + tobi.handle }).waitFor();
  await shot(A, 'profile-from-world');
  await A.getByRole('button', { name: 'Close panel' }).click();
  pass('Clicking a player’s name tag in the world opens their profile card');

  // ---- friend request by handle, live notification, accept
  await social(A, 'Friends');
  await drawer(A).getByPlaceholder('Add a friend by @handle').fill('@' + tobi.handle);
  // Notifications are brief (4.5 s): watch for Tobi's from the moment Ada sends.
  const tobiNotified = B.locator('.toast', { hasText: `@${ada.handle}) sent you a friend request` }).waitFor({ timeout: 30000 });
  await drawer(A).locator('.result-list .person-row', { hasText: tobi.handle }).getByRole('button', { name: 'Add' }).click();
  await A.locator('.toast', { hasText: 'Friend request sent' }).waitFor();
  await drawer(A).locator('.result-list').getByText('Requested').waitFor();
  await shot(A, 'friend-search');
  pass('Search by handle and send a friend request');
  await tobiNotified;
  await B.locator('.game-dock .count-badge').waitFor();
  pass('The recipient is notified at once (room nudge) with a badge on the dock');
  await social(B, 'Requests');
  await drawer(B).locator('.person-row', { hasText: 'Ada' }).getByRole('button', { name: 'Accept' }).click();
  await B.locator('.toast', { hasText: 'You and Ada are now friends' }).waitFor();
  await social(B, 'Friends');
  await drawer(B).getByText('On campus now · 1').waitFor();
  await A.waitForFunction(() => document.querySelector('.social-drawer')?.textContent?.includes('On campus now · 1'), null, { timeout: 30000 });
  await shot(B, 'friends-online');
  pass('Accepting makes the friendship consistent for both players, with live presence and place');

  // ---- private messages
  await drawer(A).getByRole('button', { name: 'Message Tobi' }).click();
  await drawer(A).getByRole('textbox', { name: 'Private message' }).fill('Meet at the courts?');
  const tobiMessaged = B.locator('.toast', { hasText: 'New private message from Ada' }).waitFor({ timeout: 30000 });
  await drawer(A).getByRole('textbox', { name: 'Private message' }).press('Enter');
  await drawer(A).locator('.bubble.mine', { hasText: 'Meet at the courts?' }).waitFor();
  await A.waitForFunction(() => !document.querySelector('.bubble.mine small')?.textContent?.includes('Sending'));
  pass('A private message sends and shows its delivery state');
  await tobiMessaged;
  assert.equal(await B.locator('.toast').textContent().then(t => t.includes('courts')).catch(() => false), false, 'notifications never show message text');
  await social(B, 'Messages');
  await drawer(B).locator('.conversation-row', { hasText: 'Ada' }).click();
  await drawer(B).locator('.bubble', { hasText: 'Meet at the courts?' }).waitFor();
  await drawer(B).getByRole('textbox', { name: 'Private message' }).fill('On my way!');
  await drawer(B).getByRole('button', { name: 'Send private message' }).click();
  await drawer(A).locator('.bubble:not(.mine)', { hasText: 'On my way!' }).waitFor({ timeout: 30000 });
  await shot(B, 'private-messages');
  pass('The friend receives it in real time, replies, and the reply arrives');
  const conv = (await stack.db.pool.query('select c.id from public.conversations c join public.profiles p on p.id in (c.user_a, c.user_b) where p.handle = $1', [ada.handle])).rows[0].id;
  await eve.sb.auth.signInWithPassword({ email: eve.email, password: 'correct horse battery' });
  const peek = await eve.sb.rpc('list_messages', { p_conversation: conv });
  assert.match(peek.error?.message ?? '', /isn’t available/, 'a third account cannot read the conversation by id');
  pass('A third account cannot read the conversation even with its id');

  // ---- party: invite, accept, party chat, meet up
  await social(A, 'Party');
  await drawer(A).locator('.person-row', { hasText: 'Tobi' }).getByRole('button', { name: /Invite/ }).click();
  await B.locator('.party-invite', { hasText: 'Ada' }).getByRole('button', { name: 'Join' }).click();
  await A.locator('.party-hud', { hasText: 'Tobi' }).waitFor();
  await B.locator('.party-hud', { hasText: 'Ada' }).waitFor();
  pass('Party invitation accepted; both players see the party HUD');
  await B.keyboard.press('Escape');
  await B.getByRole('button', { name: 'Chat', exact: true }).click();
  await B.getByRole('tab', { name: 'Party chat' }).click();
  await B.getByRole('textbox', { name: 'Party chat message' }).fill('Party here');
  await B.getByRole('button', { name: 'Send message' }).click();
  await A.keyboard.press('Escape');
  await A.getByRole('button', { name: 'Chat', exact: true }).click();
  await A.getByRole('tab', { name: 'Room chat' }).click();
  assert.equal(await A.locator('.messages').getByText('Party here').count(), 0, 'party messages are not in room chat');
  await A.getByRole('tab', { name: 'Party chat' }).click();
  await A.locator('.messages').getByText('Party here').waitFor();
  await shot(A, 'party-chat');
  pass('Party chat is a separate, labelled channel');
  await A.getByRole('button', { name: 'Close panel' }).click(); await B.getByRole('button', { name: 'Close panel' }).click();
  // Tobi is across campus, inside the library (placed by the room, as if he had walked there:
  // software rendering in CI is too slow to walk 60 m in reasonable time). Ada meets up.
  Object.assign([...stack.room.clients.values()].find(c => c.account?.handle === tobi.handle), { x: -30, z: -12 });
  await B.waitForFunction(() => Math.hypot(window.__campusInspect().position.x + 30, window.__campusInspect().position.z + 12) < 1);
  const before = await where(A);
  await social(A, 'Party');
  await drawer(A).getByRole('button', { name: 'Travel to Tobi' }).click();
  await A.waitForFunction(b => { const p = window.__campusInspect().position; return Math.hypot(p.x - b.x, p.z - b.z) > 3; }, before);
  const [pa, pb] = [await where(A), await where(B)];
  assert.ok(Math.hypot(pa.x - pb.x, pa.z - pb.z) < 6, `meet-up lands beside the party member (${JSON.stringify(pa)} vs ${JSON.stringify(pb)})`);
  assert.ok(pa.z < -4.3 && pa.x > -41.8 && pa.x < -18.2, 'inside the library with him, not outside the wall');
  await A.waitForTimeout(1500);
  const settled = await where(A);
  assert.ok(Math.hypot(settled.x - pa.x, settled.z - pa.z) < 1, 'the client and the room agree on the new position');
  await shot(A, 'meet-up');
  pass('Meet up travels to a party member');

  // ---- block: friendship ends, room chat stops both ways
  await social(B, 'Friends');
  await drawer(B).getByRole('button', { name: 'More for Ada' }).click();
  await drawer(B).getByRole('button', { name: 'Block' }).click();
  await drawer(B).getByRole('alertdialog').getByRole('button', { name: 'Block' }).click();
  await drawer(B).getByText('No friends yet.').waitFor();
  await A.waitForTimeout(800);
  await A.keyboard.press('Escape');
  await A.getByRole('button', { name: 'Chat', exact: true }).click(); await A.getByRole('tab', { name: 'Room chat' }).click();
  await A.getByRole('textbox', { name: 'Room chat message' }).fill('Anyone around?');
  await A.getByRole('button', { name: 'Send message' }).click();
  await B.keyboard.press('Escape');
  await B.getByRole('button', { name: 'Chat', exact: true }).click(); await B.getByRole('tab', { name: 'Room chat' }).click();
  await B.waitForTimeout(1500);
  assert.equal(await B.locator('.messages').getByText('Anyone around?').count(), 0, 'the blocker no longer receives the blocked player’s chat');
  pass('Blocking ends the friendship and stops room chat');

  // ---- phone layout (the desktop pages close first: software WebGL shares a few CPU cores)
  await A.context().close(); await B.context().close();
  const M = await open('Phone', { viewport: { width: 390, height: 844 }, mobile: true });
  await M.getByRole('button', { name: /^Friends, messages and party/ }).click();
  await drawer(M).waitFor();
  await shot(M, 'mobile-drawer');
  assert.equal(await M.evaluate(() => document.documentElement.scrollWidth), 390, 'no horizontal overflow on a phone');
  await drawer(M).getByRole('tab', { name: /^Party/ }).click();
  await drawer(M).getByText('Invite from the room').waitFor();
  pass('Phone viewport: the drawer opens as a bottom sheet with no overflow; guests can use parties');
  assert.deepEqual(errors, []);
} catch (e) {
  console.error(e); process.exitCode = 1;
  for (const [p, n] of [[A, 'failure-a'], [B, 'failure-b']]) if (p && !p.isClosed()) await p.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
  console.log('results so far:', results.length);
} finally {
  await writeFile('docs/social-accounts-results.json', JSON.stringify({ when: new Date().toISOString(), results, errors }, null, 2));
  await browser.close(); await stack.stop();
}
