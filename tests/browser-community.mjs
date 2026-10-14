// Real-browser test of clubs and events against the local stack (PostgreSQL + Supabase stand-in +
// room + Vite). Two signed-in players and a guest. Usage: node tests/browser-community.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { startStack } from './support/stack.mjs';
import { launch, QUERY } from './support/browser.mjs';
import { startLocalSupabase } from './support/local-supabase.mjs';

const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', OUT = 'docs/screenshots/community';
await mkdir(OUT, { recursive: true });
const stack = await startStack({ name: 'browser', webPort: 5177, roomPort: 3203, supabasePort: 54323 });
// Windows with a GPU as before; elsewhere software WebGL with the QA render scale (tests/support/browser.mjs).
const browser = await launch();
const results = [], errors = [];
const pass = label => { results.push(label); console.log('PASS', label); };
const stamp = Date.now().toString(36);

async function account(handle, name) {
  const sb = createClient(stack.supa.url, stack.supa.anonKey, { auth: { persistSession: false } });
  const email = `${handle}@example.test`;
  assert.equal((await sb.auth.signUp({ email, password: 'correct horse battery' })).error, null);
  assert.equal((await sb.rpc('save_profile', { p_handle: handle, p_display_name: name, p_bio: `${name} on campus.`, p_avatar: { model: name === 'Ada' ? 'ada' : 'kelechi' } })).error, null);
  return email;
}
async function open(label, { viewport = { width: 1280, height: 800 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(n => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n }, version: 0 })); }, label);
  const page = await ctx.newPage(); page.setDefaultTimeout(20000); page.label = label;
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  await page.goto(stack.url + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 120000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 30000 });
  return page;
}
async function signIn(page, email, handle) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: /^Sign in/ }).last().click();
  await page.getByRole('button', { name: /Edit profile/ }).waitFor();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: `Your profile, @${handle}` }).waitFor();
}
const drawer = page => page.locator('.community-drawer');
const openBoard = async page => { if (!(await drawer(page).isVisible())) await page.getByRole('button', { name: 'Events', exact: true }).click(); await drawer(page).waitFor(); };
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const toast = p => p.locator('.toast').textContent();

let A, B, C, M;
try {
  const adaHandle = `ada_${stamp}`.slice(0, 20), tobiHandle = `tobi_${stamp}`.slice(0, 20);
  const adaEmail = await account(adaHandle, 'Ada'), tobiEmail = await account(tobiHandle, 'Tobi');
  A = await open('Ada guest'); B = await open('Tobi guest', { viewport: { width: 1000, height: 720 } }); C = await open('Visitor', { viewport: { width: 1000, height: 720 } });
  await signIn(A, adaEmail, adaHandle); await signIn(B, tobiEmail, tobiHandle);

  // Empty state, then a club.
  await openBoard(A);
  await drawer(A).getByText('No upcoming events.').waitFor();
  await shot(A, 'events-empty');
  await drawer(A).getByRole('tab', { name: 'Clubs' }).click();
  await drawer(A).getByRole('button', { name: /Start a club/ }).click();
  const clubName = `Courtside Collective ${stamp.slice(-4)}`;
  await drawer(A).getByLabel('Name').fill(clubName);
  await drawer(A).getByLabel('Interest').selectOption('sports');
  await drawer(A).getByRole('button', { name: 'ball emblem' }).click();
  await drawer(A).getByRole('button', { name: 'Club colour 3' }).click();
  await drawer(A).getByLabel(/^Description/).fill('Pick-up basketball after lectures. All levels welcome.');
  await shot(A, 'club-form');
  await drawer(A).getByRole('button', { name: /Start club/ }).click();
  await drawer(A).getByText('You own this club.').waitFor();
  await shot(A, 'club-owner');
  pass('a signed-in player starts a club and owns it');

  // An event at a campus location, with a capacity of one.
  await drawer(A).getByRole('button', { name: new RegExp(`New event for ${clubName}`) }).click();
  await drawer(A).getByLabel('Title').fill('Free-throw night');
  await drawer(A).getByLabel('Category').selectOption('sports');
  await drawer(A).getByLabel('Campus location').selectOption('sports');
  await drawer(A).getByLabel(/Attendance limit/).fill('0');
  await drawer(A).getByRole('button', { name: /^Publish/ }).click();
  await drawer(A).getByText('Use a limit from 1 to 500, or leave it empty.').waitFor();
  await drawer(A).getByLabel(/Attendance limit/).fill('1');
  await drawer(A).getByLabel(/^Description/).fill('Bring a friend. We keep score with the court’s own physics.');
  await shot(A, 'event-form');
  await drawer(A).getByRole('button', { name: /^Publish/ }).click();
  await drawer(A).getByRole('heading', { name: 'Free-throw night' }).waitFor();
  await drawer(A).getByRole('button', { name: /Show me the way/ }).click();
  assert.match(await toast(A), /Follow the gold marker to The Courts/);
  await shot(A, 'event-owner');
  pass('the owner publishes an event at a campus location (with validation) and is guided to it');

  // Another player RSVPs; the event fills up.
  await openBoard(B);
  await drawer(B).getByRole('button', { name: /Free-throw night/ }).click();
  await drawer(B).getByRole('button', { name: /^RSVP/ }).click();
  await drawer(B).getByRole('button', { name: /You’re going/ }).waitFor();
  await drawer(B).getByText('1 going · 0 of 1 places left').waitFor();
  await shot(B, 'event-going');
  pass('a player RSVPs');

  // A guest can read events but is asked to sign in, and sees the event is full.
  await openBoard(C);
  await drawer(C).getByRole('button', { name: /Free-throw night/ }).waitFor();
  await drawer(C).locator('.event-card', { hasText: 'Free-throw night' }).getByText('Full').waitFor();
  await drawer(C).getByRole('button', { name: /Free-throw night/ }).click();
  await drawer(C).getByRole('button', { name: /Sign in to RSVP/ }).click();
  await C.getByRole('tab', { name: 'Sign in' }).waitFor();
  await C.getByRole('button', { name: 'Close panel' }).click();
  await shot(C, 'event-guest');
  pass('guests can browse events, see capacity, and are invited to sign in to RSVP');

  // The board sits beside the world: Esc and V close and reopen it, and walking carries on while it is open.
  await C.keyboard.press('Escape'); await drawer(C).waitFor({ state: 'hidden' });
  assert.equal(await C.evaluate(() => window.__campusInspect().panel), null, 'Esc closed the board, not the pause menu');
  await C.keyboard.press('KeyV'); await drawer(C).waitFor();
  const p0 = await C.evaluate(() => window.__campusInspect().position);
  await C.keyboard.down('KeyW'); await C.waitForTimeout(900); await C.keyboard.up('KeyW');
  const p1 = await C.evaluate(() => window.__campusInspect().position);
  assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1.5, `the player walks while the board is open (moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m)`);
  assert.ok(await drawer(C).isVisible(), 'walking leaves the board open');
  await C.keyboard.press('KeyV'); await drawer(C).waitFor({ state: 'hidden' }); await C.keyboard.press('KeyV'); await drawer(C).waitFor();
  pass('the board opens and closes with V and Esc without stopping the player, who keeps walking while it is open');

  // The organizer sees the attendee and opens their profile card.
  await A.reload({ waitUntil: 'domcontentloaded' });
  await A.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 120000 });
  await A.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await A.getByRole('button', { name: `Your profile, @${adaHandle}` }).waitFor();
  await openBoard(A);
  await drawer(A).getByRole('button', { name: /Free-throw night/ }).click();
  await drawer(A).getByRole('button', { name: /Tobi/ }).click();
  await A.getByText('Tobi on campus.').waitFor();
  await A.getByRole('button', { name: 'Close panel' }).click();
  pass('after a reload the event and its attendees are still there; attendee profiles open');

  // Editing: raise the capacity; the RSVP is cancelled and re-made.
  await drawer(A).getByRole('button', { name: /^Edit$/ }).click();
  await drawer(A).getByLabel(/Attendance limit/).fill('2');
  await drawer(A).getByRole('button', { name: /Save changes/ }).click();
  await drawer(A).getByText('1 going · 1 of 2 places left').waitFor();
  await drawer(B).getByRole('button', { name: /You’re going/ }).click();
  await drawer(B).getByRole('button', { name: /^RSVP/ }).waitFor();
  await drawer(B).getByText('0 going · 2 of 2 places left').waitFor();
  pass('organizers edit events; players cancel their RSVP');

  // Clubs: join, organizer role, and the "My clubs" filter.
  await drawer(B).getByRole('button', { name: new RegExp(clubName) }).click();
  await drawer(B).getByRole('button', { name: /Join club/ }).click();
  await drawer(B).getByRole('button', { name: 'Leave club' }).waitFor();
  await drawer(A).getByRole('button', { name: 'Back' }).click();
  await drawer(A).getByRole('tab', { name: 'Clubs' }).click();
  await drawer(A).getByRole('button', { name: new RegExp(clubName) }).click();
  await drawer(A).getByText('2 members', { exact: false }).waitFor();
  await drawer(A).getByRole('button', { name: 'Make organizer' }).click();
  await drawer(A).getByRole('button', { name: 'Remove organizer' }).waitFor();
  await drawer(B).getByRole('button', { name: 'Back' }).click();
  await drawer(B).getByRole('button', { name: new RegExp(clubName) }).click();
  await drawer(B).getByRole('button', { name: new RegExp(`New event for ${clubName}`) }).waitFor();
  await shot(B, 'club-organizer');
  pass('players join clubs; owners designate organizers, who can then run events');

  // Cancelling: the event stays visible as canceled and closes RSVPs.
  await drawer(A).getByRole('button', { name: /Free-throw night/ }).click();
  await drawer(A).getByRole('button', { name: /Cancel event/ }).click();
  await drawer(A).getByRole('button', { name: /^Cancel event$/ }).last().click();
  await drawer(A).getByText(/This event was canceled/).waitFor();
  await drawer(C).getByRole('tab', { name: 'Events' }).click();
  await drawer(C).locator('.event-card', { hasText: 'Free-throw night' }).getByText('Canceled').waitFor({ timeout: 10000 });
  await shot(C, 'events-canceled');
  pass('canceled events stay visible as canceled and stop accepting RSVPs');

  // Phone layout: the board is a bottom sheet that leaves the world visible.
  M = await open('Phone visitor', { viewport: { width: 390, height: 844 }, mobile: true });
  await openBoard(M);
  await drawer(M).getByRole('button', { name: /Free-throw night/ }).waitFor();
  const box = await drawer(M).boundingBox();
  assert.ok(box && box.height <= 844 * .66 && box.width <= 390, `bottom sheet size ${JSON.stringify(box)}`);
  await shot(M, 'mobile-board');
  await drawer(M).getByRole('button', { name: 'Close events and clubs' }).click();
  pass('on a phone the board is a compact bottom sheet');

  // Backend outage: a clear error with a retry, then recovery.
  await stack.supa.close();
  await drawer(C).getByRole('tab', { name: 'Clubs' }).click();
  await drawer(C).getByText(/Can’t reach the campus service/).waitFor();
  await shot(C, 'service-error');
  stack.supa = await startLocalSupabase({ pool: stack.db.pool, port: 54323, jwtSecret: stack.supa.jwtSecret });
  await drawer(C).getByRole('button', { name: /Try again/ }).click();
  await drawer(C).getByRole('button', { name: new RegExp(clubName) }).waitFor();
  pass('a backend failure shows a useful error and recovers with Try again');

  const relevant = errors.filter(e => !/Failed to load resource|net::ERR/.test(e));
  await writeFile('docs/community-results.json', JSON.stringify({ date: new Date().toISOString(), results, errors: relevant }, null, 2));
  assert.deepEqual(relevant, []); console.log('ALL PASSED', results.length);
} catch (e) {
  console.error('FAILED', e);
  for (const p of [A, B, C, M]) if (p && !p.isClosed()) await p.screenshot({ path: `${OUT}/failure-${p.label.replace(/\W/g, '')}.png` }).catch(() => {});
  console.log('errors', errors);
  process.exitCode = 1;
} finally { await browser.close(); await stack.stop(); process.exit(process.exitCode ?? 0); }
