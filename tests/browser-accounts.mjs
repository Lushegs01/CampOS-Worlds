// Real-browser test of accounts and profiles against the local stack (PostgreSQL + Supabase stand-in
// + room with account verification + Vite). Usage: node tests/browser-accounts.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { startStack } from './support/stack.mjs';
import { gpu, launch, QUERY } from './support/browser.mjs';

const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', OUT = 'docs/screenshots/accounts';
await mkdir(OUT, { recursive: true });
const stack = await startStack({ name: 'browser', webPort: 5176, roomPort: 3202, supabasePort: 54322 });
// Windows with a GPU as before; elsewhere software WebGL with the QA render scale (tests/support/browser.mjs).
const browser = await launch();
const results = [], errors = [], urls = [];
const pass = label => { results.push(label); console.log('PASS', label); };
const stamp = Date.now().toString(36);

async function open(name, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(n => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n }, version: 0 })); }, name);
  const page = await ctx.newPage(); page.setDefaultTimeout(gpu ? 20000 : 45000); page.label = name;
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|status of 4\d\d/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  page.on('request', r => urls.push(r.url()));
  await enter(page);
  return page;
}
async function enter(page) {
  await page.goto(stack.url + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 120000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 30000 });
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const closePanel = p => p.getByRole('button', { name: 'Close panel' }).click();

let A, B;
try {
  // A taken handle, created directly through the API (as another player would have).
  const other = createClient(stack.supa.url, stack.supa.anonKey, { auth: { persistSession: false } });
  const taken = `taken_${stamp}`.slice(0, 20);
  const { error: e1 } = await other.auth.signUp({ email: `other-${stamp}@example.test`, password: 'correct horse battery' }); assert.equal(e1, null);
  assert.equal((await other.rpc('save_profile', { p_handle: taken, p_display_name: 'Someone Else' })).error, null);

  A = await open('Guest Ada'); B = await open('Guest Tobi', { width: 900, height: 640 });
  await A.getByRole('button', { name: '2 online' }).waitFor();
  pass('guests enter and play without an account');

  // Registration validation and account creation.
  await A.getByRole('button', { name: 'Sign in', exact: true }).click();
  await A.getByRole('tab', { name: 'Create account' }).click();
  await A.getByLabel('Email').fill('not-an-email'); await A.getByLabel('Password').fill('short');
  await A.getByRole('button', { name: /^Create account/ }).last().click();
  await A.getByText('Enter a valid email address.').waitFor(); await A.getByText('Use at least 8 characters.').waitFor();
  await shot(A, 'register-validation');
  const email = `ada-${stamp}@example.test`, handle = `ada_${stamp}`.slice(0, 20);
  await A.getByLabel('Email').fill(email); await A.getByLabel('Password').fill('correct horse battery');
  await A.getByRole('button', { name: /^Create account/ }).last().click();
  await A.getByRole('button', { name: /Create profile/ }).waitFor();
  pass('registration validates input and creates an account');

  // Profile creation: a taken handle is refused before saving; then a unique one.
  await A.getByLabel('Handle').fill(taken);
  await A.getByText('That handle is taken.').waitFor();
  await A.getByLabel('Handle').fill(handle);
  await A.getByText('Available').waitFor();
  await A.getByLabel('Display name').fill('Ada Obi');
  await A.getByLabel(/^Bio/).fill('Architecture student. Always up for hoops.');
  await A.getByRole('button', { name: 'Accent 4' }).click();
  await shot(A, 'profile-create');
  await A.getByRole('button', { name: /Create profile/ }).click();
  await A.getByText('Architecture student. Always up for hoops.').waitFor();
  await A.getByRole('button', { name: `Your profile, @${handle}` }).waitFor();
  assert.equal(await A.evaluate(() => window.__campusInspect().avatar.accent), '#506b96', 'the saved appearance is applied in the world');
  await shot(A, 'profile-own');
  pass('profile creation with live handle check, preview and save');

  // The other player sees the verified identity, and can open the profile card.
  await closePanel(A);
  await B.getByRole('button', { name: 'People' }).click();
  await B.getByText(`@${handle}`).waitFor();
  await B.getByRole('button', { name: "View Ada Obi's profile" }).click();
  await B.getByText('Architecture student. Always up for hoops.').waitFor();
  await shot(B, 'player-card');
  await closePanel(B);
  pass('another player sees the verified name and handle, and the public profile card');

  // Persistence: reload (a new page session) and the account and profile come back.
  await A.reload({ waitUntil: 'domcontentloaded' });
  await A.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 120000 });
  await A.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await A.getByRole('button', { name: `Your profile, @${handle}` }).waitFor();
  pass('the session and profile persist after reload');

  // Editing with a preview; the change reaches the other player without a reload.
  await A.getByRole('button', { name: `Your profile, @${handle}` }).click();
  await A.getByRole('button', { name: 'Edit profile' }).click();
  await A.getByLabel('Display name').fill('Ada O.');
  await A.getByRole('button', { name: 'Save profile' }).click();
  await A.getByRole('heading', { name: 'Ada O.' }).waitFor();
  await closePanel(A);
  await B.getByRole('button', { name: 'People' }).click();
  await B.locator('.player-row', { hasText: 'Ada O.' }).waitFor({ timeout: 10000 });
  await closePanel(B);
  pass('profile edits save and propagate to other players live');

  // Sign out: back to the guest identity; sign in again with a wrong, then a right password.
  await A.getByRole('button', { name: `Your profile, @${handle}` }).click();
  await A.getByRole('button', { name: /Sign out/ }).click();
  await A.getByRole('heading', { name: 'Guest Ada' }).waitFor();
  await closePanel(A);
  await B.getByRole('button', { name: 'People' }).click(); await B.locator('.player-row', { hasText: 'Guest Ada' }).waitFor({ timeout: 10000 }); await closePanel(B);
  // Walk away from the spawn point first, so a position reset on sign-in would show.
  const start = await A.evaluate(() => window.__campusInspect().position);
  // Hold W until the player has covered the distance rather than for a fixed time: with software
  // WebGL the frame rate (and so the distance per second) varies a lot with machine load.
  const walkStarted = Date.now();
  await A.keyboard.down('KeyW');
  await A.waitForFunction(s => { const p = window.__campusInspect().position; return Math.hypot(p.x - s.x, p.z - s.z) > 3; }, start, { timeout: 20000 }).catch(() => {});
  await A.keyboard.up('KeyW');
  // Wait until the player has stopped and the room agrees where they are, so that any later movement
  // can only come from signing in (on slow frames the room's position trails and is reconciled here).
  await A.waitForFunction(() => { const s = window.__campusDebug.state(); return Math.hypot(s.x - s.room.x, s.z - s.room.z) < .3; }, null, { timeout: 20000 });
  await A.waitForTimeout(600);
  console.log(`walked for ${Date.now() - walkStarted} ms`);
  const before = await A.evaluate(() => { window.__qaCanvas = document.querySelector('canvas'); return window.__campusInspect().position; });
  assert.ok(Math.hypot(before.x - start.x, before.z - start.z) > 2, 'the player walked away from where they were');
  await A.getByRole('button', { name: 'Sign in', exact: true }).click();
  await A.getByLabel('Email').fill(email); await A.getByLabel('Password').fill('wrong password');
  await A.getByRole('button', { name: /^Sign in/ }).last().click();
  await A.getByText('That email and password don’t match an account.').waitFor();
  await shot(A, 'sign-in-error');
  await A.getByLabel('Password').fill('correct horse battery');
  await A.getByRole('button', { name: /^Sign in/ }).last().click();
  await A.getByRole('heading', { name: 'Ada O.' }).waitFor();
  await closePanel(A);
  await A.getByRole('button', { name: `Your profile, @${handle}` }).waitFor(); await A.waitForTimeout(1000);
  const after = await A.evaluate(() => ({ p: window.__campusInspect().position, scene: !!window.__qaCanvas?.isConnected }));
  assert.ok(after.scene, 'signing in did not remount the 3D scene');
  assert.ok(Math.hypot(after.p.x - before.x, after.p.z - before.z) < .6, `signing in kept the player in place (moved ${Math.hypot(after.p.x - before.x, after.p.z - before.z).toFixed(2)} m)`);
  pass('sign-out restores the guest identity; wrong passwords are refused; sign-in restores the profile in place, without reloading the world');

  // A profile request already in flight must never restore the old identity after sign-out.
  let releaseProfile, profileReached;
  const heldProfile = new Promise(resolve => { releaseProfile = resolve; });
  const reachedProfile = new Promise(resolve => { profileReached = resolve; });
  await A.route('**/rest/v1/rpc/my_profile', async route => {
    const response = await route.fetch(); profileReached(); await heldProfile; await route.fulfill({ response });
  });
  await A.evaluate(async () => { const account = await import('/src/account/store.ts'); window.__pendingProfile = account.reloadProfile(); });
  await reachedProfile;
  await A.evaluate(async () => { await (await import('/src/account/store.ts')).signOut(); });
  releaseProfile(); await A.evaluate(() => window.__pendingProfile);
  assert.deepEqual(await A.evaluate(async () => { const s=(await import('/src/account/store.ts')).useAccount.getState(); return {status:s.status,profile:s.profile,name:window.__campusInspect().avatar.model&&document.querySelector('.account-chip')?.textContent}; }),
    {status:'guest',profile:null,name:'Sign in'});
  assert.equal(await A.evaluate(async () => (await import('/src/state.ts')).useGame.getState().name),'Guest Ada');
  await A.unroute('**/rest/v1/rpc/my_profile');
  await A.evaluate(async ({email}) => { await (await import('/src/account/store.ts')).signIn(email,'correct horse battery'); }, {email});
  await A.getByRole('button', { name: `Your profile, @${handle}` }).waitFor();
  pass('a delayed profile response after sign-out cannot restore the old account identity');

  // An expired, unrefreshable session is handled safely: back to guest, with an explanation.
  await A.evaluate(() => { const raw = localStorage.getItem('campos-worlds-auth'); const s = JSON.parse(raw); s.expires_at = 1; s.access_token = s.access_token.slice(0, -6) + 'AAAAAA'; s.refresh_token = 'revoked'; localStorage.setItem('campos-worlds-auth', JSON.stringify(s)); });
  await A.reload({ waitUntil: 'domcontentloaded' });
  await A.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 120000 });
  await A.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await A.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ timeout: 15000 });
  pass('an expired session falls back to guest mode safely');

  // Token values (JWTs) or token parameters must never appear in a URL. (Supabase's refresh endpoint is
  // /auth/v1/token?grant_type=refresh_token: that names the grant; the token itself is in the POST body.)
  for (const u of urls) assert.ok(!/eyJ[A-Za-z0-9_-]{10,}|[?&#](access_token|refresh_token)=/.test(u), `token in URL: ${u.slice(0, 80)}`);
  pass('no account token appears in any request URL');
  const relevant = errors.filter(e => !/Failed to load resource/.test(e));
  await writeFile('docs/accounts-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors: relevant }, null, 2));
  assert.deepEqual(relevant, []); console.log('ALL PASSED', results.length);
} catch (e) {
  console.error('FAILED', e);
  for (const p of [A, B]) if (p && !p.isClosed()) await p.screenshot({ path: `${OUT}/failure-${p.label.replace(/\W/g, '')}.png` }).catch(() => {});
  console.log('errors', errors);
  process.exitCode = 1;
} finally { await browser.close(); await stack.stop(); process.exit(process.exitCode ?? 0); }
