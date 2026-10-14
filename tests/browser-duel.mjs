// Real-browser test of Court Duel against the full local stack: two signed-in players on The
// Courts, challenge and accept in the interface, the live scoreboard, conceding, the recorded rated
// result and the rankings. (Physics scoring itself is covered with real shots in tests/duels.test.mjs;
// here one basket is fed to the room's duel so the scoreboard's live update can be checked.)
// Usage: node tests/browser-duel.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startStack } from './support/stack.mjs';
import { account, launch, open, roomPlayer, signIn } from './support/browser.mjs';

const OUT = 'docs/screenshots/duel';
await mkdir(OUT, { recursive: true });
const stack = await startStack({ name: 'browser-duel', webPort: 5181, roomPort: 3207, supabasePort: 54327 });
const browser = await launch();
const results = [], errors = [];
const pass = label => { results.push(label); console.log('PASS', label); };
const stamp = Date.now().toString(36).slice(-5);
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

let A, B;
try {
  const ada = await account(stack, `ada_${stamp}`, 'Ada', 'ada'), tobi = await account(stack, `tobi_${stamp}`, 'Tobi', 'kelechi');
  A = await open(browser, stack, 'Ada', errors); B = await open(browser, stack, 'Tobi', errors, { viewport: { width: 1100, height: 760 } });
  await signIn(A, ada); await signIn(B, tobi);
  // Both walk onto The Courts (placed by the room, as if they had walked: software rendering is slow).
  Object.assign(roomPlayer(stack, ada.handle), { x: 44, z: 20 }); Object.assign(roomPlayer(stack, tobi.handle), { x: 44, z: 28 });
  await A.locator('.duel-modes').waitFor();
  await shot(A, 'game-modes');
  pass('On the court, the game modes show free shooting and Court Duel with the players present');
  await A.locator('.duel-opponent', { hasText: 'Tobi' }).getByRole('button', { name: 'Challenge' }).click();
  await B.locator('.duel-challenges .party-invite', { hasText: 'Ada' }).getByRole('button', { name: 'Accept' }).click();
  await A.locator('.duel-hud.state-playing').waitFor();
  await B.locator('.duel-hud.state-playing').waitFor();
  await A.waitForFunction(() => window.__campusDebug.state().ui.ball === 'ball-1');
  await B.waitForFunction(() => window.__campusDebug.state().ui.ball === 'ball-2');
  pass('Challenge and accept in the interface; the countdown starts play and each player is handed their own ball');
  const room = stack.room, a = roomPlayer(stack, ada.handle);
  room.duels.onShot(a, 9001, 'ball-1'); room.duels.step([{ type: 'score', by: a.id, ball: 'ball-1', shot: 9001, points: 3 }]);
  await B.waitForFunction(() => document.querySelector('.duel-hud .duel-score strong')?.textContent === '3');
  await shot(B, 'duel-playing');
  pass('The live scoreboard updates for both players');
  await B.locator('.duel-hud').getByRole('button', { name: 'Concede' }).click();
  await B.locator('.duel-hud').getByRole('button', { name: 'Concede' }).click();
  await A.locator('.duel-hud.state-finished', { hasText: 'You win!' }).waitFor();
  await A.locator('.duel-hud', { hasText: 'Recorded · rated · rating 1012 (+12)' }).waitFor({ timeout: 30000 });
  await B.locator('.duel-hud', { hasText: 'rating 988 (-12)' }).waitFor({ timeout: 30000 });
  await shot(A, 'duel-result');
  pass('Conceding ends the duel; the rated result is recorded and both see their new rating');
  const row = (await stack.db.pool.query('select * from public.duel_matches order by recorded_at desc limit 1')).rows[0];
  assert.equal(row.score_a, 3); assert.equal(row.outcome, 'forfeit'); assert.equal(row.rated, true);
  pass('The database holds exactly the result the room computed');
  await A.locator('.duel-hud').getByRole('button', { name: 'Rankings' }).click();
  await A.locator('.leaderboard').getByText('Your recent duels').waitFor();
  await A.locator('.duel-history li', { hasText: 'win' }).waitFor();
  await A.locator('.leaderboard').getByText(/Ranked after 2 more rated/).waitFor();
  await shot(A, 'rankings');
  pass('Rankings show the rules, the player’s record and history; newcomers are not ranked until 3 rated duels');
  await A.getByRole('button', { name: 'Close panel' }).click();
  await A.locator('.duel-hud').getByRole('button', { name: 'Rematch' }).click().catch(() => {});
  assert.deepEqual(errors, []);
} catch (e) {
  console.error(e); process.exitCode = 1;
  for (const [p, n] of [[A, 'failure-a'], [B, 'failure-b']]) if (p && !p.isClosed()) await p.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
} finally {
  await writeFile('docs/duel-results.json', JSON.stringify({ when: new Date().toISOString(), results, errors }, null, 2));
  await browser.close(); await stack.stop();
}
