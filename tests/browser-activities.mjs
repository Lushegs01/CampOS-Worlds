// Real-browser test of in-game event check-in, a challenge run, earned titles and accent colours,
// and friends-only profiles, against the full local stack. Usage: node tests/browser-activities.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { account, launch, open, roomPlayer, signIn } from './support/browser.mjs';
import { CHALLENGE_BY_ID } from '../shared/challenges.mjs';

const OUT = 'docs/screenshots/activities';
await mkdir(OUT, { recursive: true });
const stack = await startStack({ name: 'browser-activities', webPort: 5183, roomPort: 3209, supabasePort: 54329 });
const browser = await launch();
const results = [], errors = [];
const pass = label => { results.push(label); console.log('PASS', label); };
const stamp = Date.now().toString(36).slice(-5);
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

let A, T;
try {
  const ada = await account(stack, `ada_${stamp}`, 'Ada', 'ada'), tobi = await account(stack, `tobi_${stamp}`, 'Tobi', 'kelechi');
  // Ada's club runs an event at The Courts that is on right now.
  await ada.sb.auth.signInWithPassword({ email: ada.email, password: 'correct horse battery' });
  const club = (await ada.sb.rpc('create_club', { p_name: `Hoops ${stamp}`, p_description: 'Pick-up basketball.', p_category: 'sports' })).data;
  const ev = (await ada.sb.rpc('create_event', { p_club: club.id, p_title: 'Pick-up games', p_description: 'Come and play.', p_category: 'sports', p_location: 'sports', p_starts_at: new Date(Date.now() + 600000).toISOString(), p_ends_at: new Date(Date.now() + 7200000).toISOString(), p_publish: true, p_template: 'basketball-tournament' })).data;
  await stack.db.pool.query(`update public.events set starts_at = now() - interval '5 minutes' where id = $1`, [ev.id]);

  T = await open(browser, stack, 'Tobi', errors); await signIn(T, tobi);
  // ---- in-game check-in
  await T.getByRole('button', { name: 'Events', exact: true }).click();
  await T.locator('.community-drawer .event-card', { hasText: 'Pick-up games' }).click();
  await T.locator('.activity-hint', { hasText: 'Basketball tournament night' }).waitFor();
  const checkInButton = T.getByRole('button', { name: /Check in at The Courts/ });
  await checkInButton.click();
  await T.locator('.community-drawer .form-error', { hasText: 'Go to The Courts to check in.' }).waitFor();
  pass('Away from the event, check-in is refused with directions');
  Object.assign(roomPlayer(stack, tobi.handle), { x: 40, z: 24 });
  await T.waitForTimeout(800);
  await checkInButton.click();
  await T.locator('.banner.going', { hasText: 'You’re checked in' }).waitFor();
  await shot(T, 'event-checkin');
  assert.equal((await stack.db.pool.query('select count(*)::int as n from public.event_checkins where event_id = $1', [ev.id])).rows[0].n, 1);
  pass('At The Courts while the event is on, check-in is recorded as in-game attendance');

  // ---- a challenge run with its HUD and checkpoint marker
  await T.getByRole('tab', { name: 'Challenges' }).click();
  const circuit = CHALLENGE_BY_ID.get('courtyard-circuit');
  await T.getByRole('button', { name: 'Start Courtyard Circuit' }).click();
  await T.locator('.challenge-hud', { hasText: `COURTYARD CIRCUIT · 0/${circuit.checkpoints.length}` }).waitFor();
  await T.locator('.challenge-hud b', { hasText: circuit.checkpoints[0].name }).waitFor();
  Object.assign(roomPlayer(stack, tobi.handle), { x: circuit.checkpoints[0].x, z: circuit.checkpoints[0].z });
  await T.locator('.challenge-hud', { hasText: `1/${circuit.checkpoints.length}` }).waitFor();
  await T.locator('.challenge-hud b', { hasText: circuit.checkpoints[1].name }).waitFor();
  await shot(T, 'challenge-run');
  assert.equal(await T.locator('.community-drawer').count(), 0, 'starting a run closes the drawer so the player can move');
  await T.locator('.challenge-hud').getByRole('button', { name: 'Cancel' }).click();
  await T.locator('.challenge-hud').waitFor({ state: 'detached' });
  pass('A challenge run shows progress and the next checkpoint, advances when the room sees the player there, and can be cancelled');

  // ---- earned title and accent
  await stack.db.pool.query(`insert into public.achievements (user_id, achievement) select id, 'court-champion' from public.profiles where handle = $1`, [tobi.handle]);
  await T.getByRole('button', { name: `Your profile, @${tobi.handle}` }).click();
  await T.getByRole('button', { name: /Edit profile/ }).click();
  await T.locator('option[value="court-champion"]').waitFor({ state: 'attached' });
  await T.getByLabel('Title under your name').selectOption('court-champion');
  assert.equal(await T.getByRole('button', { name: 'Road Tripper colour, locked: Drive the Campus Loop: pass every district’s shuttle stop in order as the driver, in under 12 minutes.' }).isDisabled(), true, 'unearned colours stay locked');
  await T.getByRole('button', { name: 'Court Champion colour', exact: true }).click();
  await T.getByRole('button', { name: 'basketball' }).click();
  await T.getByRole('button', { name: 'Save profile' }).click();
  await T.locator('.profile-title', { hasText: 'Court Champion' }).waitFor();
  await shot(T, 'profile-title');
  const saved = (await stack.db.pool.query('select title, avatar, interests from public.profiles where handle = $1', [tobi.handle])).rows[0];
  assert.equal(saved.title, 'court-champion'); assert.equal(saved.avatar.accent, '#c9a24a'); assert.deepEqual(saved.interests, ['basketball']);
  pass('An earned badge unlocks its title and accent colour; both are saved with interests');

  // ---- friends-only profile, seen by someone who is not a friend
  await T.getByRole('button', { name: 'Close panel' }).click();
  await T.getByRole('button', { name: /^Friends, messages and party/ }).click();
  await T.locator('.social-drawer').getByRole('tab', { name: /^Privacy/ }).click();
  await T.locator('.social-drawer').getByText('Friends only', { exact: true }).click();
  await T.locator('.social-drawer').getByRole('button', { name: 'Save privacy settings' }).click();
  await T.locator('.social-drawer .field-ok', { hasText: 'Saved' }).waitFor();
  A = await open(browser, stack, 'Ada', errors, { viewport: { width: 1100, height: 760 } }); await signIn(A, ada);
  await A.waitForFunction(h => window.__campusInspect().peers.some(p => p.handle === h && p.title === 'court-champion'), tobi.handle);
  pass('Other players see the title (the room takes it from the verified profile)');
  await A.getByRole('button', { name: 'People', exact: true }).click();
  await A.getByRole('button', { name: "View Tobi's profile" }).click();
  await A.getByText('Tobi shares their bio and interests with friends only.').waitFor();
  await shot(A, 'friends-only-profile');
  pass('A friends-only profile shows non-friends no bio or interests, but keeps the public card');
  // ---- phone: the challenges board and a run HUD fit without overflow
  await A.context().close(); await T.context().close();
  const M = await open(browser, stack, 'Phone', errors, { viewport: { width: 390, height: 844 }, mobile: true });
  await M.getByRole('button', { name: 'Events', exact: true }).click();
  await M.getByRole('tab', { name: 'Challenges' }).click();
  await M.getByRole('button', { name: 'Start Courtyard Circuit' }).click();
  await M.locator('.challenge-hud').waitFor();
  await shot(M, 'mobile-challenge');
  assert.equal(await M.evaluate(() => document.documentElement.scrollWidth), 390, 'no horizontal overflow on a phone');
  const hud = await M.locator('.challenge-hud').boundingBox(), stick = await M.locator('.joystick').boundingBox().catch(() => null);
  assert.ok(!stick || hud.y + hud.height <= stick.y || hud.x >= stick.x + stick.width, 'the run HUD does not cover the movement joystick');
  pass('Phone: guests can start a challenge; the board and HUD fit the screen without covering the controls');
  assert.deepEqual(errors, []);
} catch (e) {
  console.error(e); process.exitCode = 1;
  for (const [p, n] of [[T, 'failure-t'], [A, 'failure-a']]) if (p && !p.isClosed()) await p.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
} finally {
  await writeFile('docs/activities-results.json', JSON.stringify({ when: new Date().toISOString(), results, errors }, null, 2));
  await browser.close(); await stack.stop();
}
