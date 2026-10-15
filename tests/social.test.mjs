// Database tests for friends, blocks, privacy settings, private messages and reports, against a real
// PostgreSQL 17 prepared like a Supabase project. Every call runs as the API role a real request
// would use (see tests/support/postgres.mjs), so RLS, grants and the functions are exercised.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startDatabase, rpc, asRole } from './support/postgres.mjs';

let db;
before(async () => { db = await startDatabase({ name: 'social' }); }, { timeout: 180000 });
after(async () => { await db?.stop(); });

let seq = 0;
const unique = prefix => `${prefix}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
async function player(prefix = 'p_') {
  const handle = unique(prefix);
  const { rows } = await db.pool.query(`insert into auth.users (email, encrypted_password) values ($1, 'x') returning id`, [`${handle}@example.test`]);
  const claims = { sub: rows[0].id, role: 'authenticated', handle };
  await rpc(db.pool, 'save_profile', { p_handle: handle, p_display_name: handle, p_bio: '', p_avatar: {} }, claims);
  return claims;
}
const call = (fn, args, who) => rpc(db.pool, fn, args, who);
const SERVICE = { role: 'service_role' };
const rejects = (promise, pattern) => assert.rejects(promise, e => { assert.match(e.message, pattern); return true; });
async function friends(a, b) {
  await call('send_friend_request', { p_handle: b.handle }, a);
  const req = (await call('social_overview', {}, b)).incoming.find(r => r.player.id === a.sub);
  await call('respond_friend_request', { p_request: req.id, p_accept: true }, b);
}
const pairRows = async (a, b) => (await db.pool.query('select * from public.friendships where user_a = least($1::uuid, $2::uuid) and user_b = greatest($1::uuid, $2::uuid)', [a.sub, b.sub])).rowCount;

// ---------------------------------------------------------------- friends
test('a friend request is sent, seen, accepted and leaves one consistent friendship for both players', async () => {
  const ada = await player('ada_'), tobi = await player('tobi_');
  const sent = await call('send_friend_request', { p_handle: '@' + tobi.handle.toUpperCase() }, ada);
  assert.equal(sent.relationship, 'outgoing'); assert.equal(sent.handle, tobi.handle);
  assert.equal((await call('send_friend_request', { p_handle: tobi.handle }, ada)).relationship, 'outgoing', 'sending twice is idempotent');
  assert.equal((await db.pool.query('select count(*)::int as n from public.friend_requests where sender = $1', [ada.sub])).rows[0].n, 1);
  const inbox = await call('social_overview', {}, tobi);
  assert.equal(inbox.incoming.length, 1); assert.equal(inbox.incoming[0].player.handle, ada.handle);
  assert.equal((await call('unread_summary', {}, tobi)).requests, 1);
  assert.equal((await call('social_overview', {}, ada)).outgoing[0].player.id, tobi.sub);
  await rejects(call('respond_friend_request', { p_request: inbox.incoming[0].id, p_accept: true }, ada), /no longer available/, 'only the recipient answers');
  const accepted = await call('respond_friend_request', { p_request: inbox.incoming[0].id, p_accept: true }, tobi);
  assert.equal(accepted.relationship, 'friends');
  for (const [me, other] of [[ada, tobi], [tobi, ada]]) {
    const o = await call('social_overview', {}, me);
    assert.deepEqual(o.friends.map(f => f.id), [other.sub]); assert.equal(o.incoming.length + o.outgoing.length, 0);
    assert.equal((await call('get_profile', { p_handle: other.handle }, me)).relationship, 'friends');
  }
  assert.equal(await pairRows(ada, tobi), 1, 'one row represents the friendship');
  assert.equal((await call('respond_friend_request', { p_request: inbox.incoming[0].id, p_accept: true }, tobi)).relationship, 'friends', 'a repeated accept is harmless');
  assert.equal((await call('get_profile', { p_handle: ada.handle })).relationship, 'none', 'anonymous viewers have no relationship');
});

test('self-friendship, unknown handles and guests are refused', async () => {
  const p = await player();
  await rejects(call('send_friend_request', { p_handle: p.handle }, p), /yourself/);
  await rejects(call('send_friend_request', { p_handle: 'nobody_has_this' }, p), /No player/);
  await rejects(call('send_friend_request', { p_handle: p.handle }), /permission denied|Sign in/);
  const noProfile = { sub: (await db.pool.query(`insert into auth.users (email, encrypted_password) values ($1, 'x') returning id`, [`np-${Date.now()}@example.test`])).rows[0].id, role: 'authenticated' };
  await rejects(call('send_friend_request', { p_handle: p.handle }, noProfile), /Create your profile/);
  await rejects(db.pool.query('insert into public.friendships (user_a, user_b) values ($1, $1)', [p.sub]), /friendships_ordered/);
});

test('two players adding each other at the same moment become friends exactly once', async () => {
  for (let round = 0; round < 5; round++) {
    const a = await player('race_'), b = await player('race_');
    const results = await Promise.all([call('send_friend_request', { p_handle: b.handle }, a), call('send_friend_request', { p_handle: a.handle }, b)]);
    assert.ok(results.some(r => r.relationship === 'friends'), 'the second request completes the friendship');
    assert.equal(await pairRows(a, b), 1);
    assert.equal((await db.pool.query("select count(*)::int as n from public.friend_requests where sender in ($1, $2) and status = 'pending'", [a.sub, b.sub])).rows[0].n, 0, 'no dangling requests');
  }
});

test('declining, cancelling, removing, privacy and request limits', async () => {
  const a = await player(), b = await player(), c = await player();
  await call('send_friend_request', { p_handle: b.handle }, a);
  const req = (await call('social_overview', {}, b)).incoming[0];
  assert.equal((await call('respond_friend_request', { p_request: req.id, p_accept: false }, b)).relationship, 'none');
  assert.equal((await call('social_overview', {}, a)).outgoing.length, 0, 'a declined request leaves the sender’s list');
  await rejects(call('send_friend_request', { p_handle: b.handle }, a), /another request later/);
  await db.pool.query(`update public.friend_requests set responded_at = now() - interval '25 hours' where sender = $1`, [a.sub]);
  assert.equal((await call('send_friend_request', { p_handle: b.handle }, a)).relationship, 'outgoing', 'after a day a new request may be sent');
  assert.equal((await call('cancel_friend_request', { p_user: b.sub }, a)).relationship, 'none');
  assert.equal((await call('social_overview', {}, b)).incoming.length, 0);
  await friends(a, c);
  assert.equal((await call('remove_friend', { p_user: c.sub }, a)).relationship, 'none');
  assert.equal(await pairRows(a, c), 0);
  assert.equal((await call('remove_friend', { p_user: c.sub }, a)).relationship, 'none', 'removing twice is harmless');
  // Privacy.
  const closed = await player();
  await call('save_social_settings', { p_friend_requests: 'nobody', p_direct_messages: 'friends', p_party_invites: 'nobody', p_appear_offline: true }, closed);
  await rejects(call('send_friend_request', { p_handle: closed.handle }, a), /isn’t accepting friend requests/);
  await rejects(call('save_social_settings', { p_friend_requests: 'all', p_direct_messages: 'friends', p_party_invites: 'friends', p_appear_offline: false }, closed), /listed privacy options/);
  assert.deepEqual((await call('social_overview', {}, closed)).settings, { friend_requests: 'nobody', direct_messages: 'friends', party_invites: 'nobody', appear_offline: true, profile_visibility: 'public', room_visits: 'invite' });
  // Rate limit: 20 requests an hour.
  const spammer = await player('spam_'), targets = [];
  for (let i = 0; i < 21; i++) targets.push(await player('t_'));
  for (let i = 0; i < 20; i++) await call('send_friend_request', { p_handle: targets[i].handle }, spammer);
  await rejects(call('send_friend_request', { p_handle: targets[20].handle }, spammer), /a lot of friend requests/);
});

test('blocking ends the friendship, stops requests and messages, hides the blocker from search and stays private', async () => {
  const a = await player('blk_'), b = await player('blk_');
  await friends(a, b);
  const conv = await call('open_conversation', { p_user: b.sub }, a);
  await call('send_direct_message', { p_conversation: conv.id, p_body: 'hi', p_client_id: randomUUID() }, a);
  assert.equal((await call('block_player', { p_user: b.sub }, a)).relationship, 'blocked');
  assert.equal(await pairRows(a, b), 0, 'friendship ended');
  await rejects(call('send_friend_request', { p_handle: a.handle }, b), /can’t send a friend request/);
  await rejects(call('send_friend_request', { p_handle: b.handle }, a), /Unblock this player/);
  await rejects(call('send_direct_message', { p_conversation: conv.id, p_body: 'still there?', p_client_id: randomUUID() }, b), /can’t message this player/);
  await rejects(call('send_direct_message', { p_conversation: conv.id, p_body: 'hello?', p_client_id: randomUUID() }, a), /You blocked this player/);
  assert.equal((await call('list_messages', { p_conversation: conv.id }, b)).messages.length, 1, 'history stays readable');
  assert.deepEqual(await call('search_players', { p_query: a.handle }, b), [], 'the blocked player cannot find the blocker');
  assert.equal((await call('search_players', { p_query: b.handle }, a))[0].relationship, 'blocked');
  assert.equal((await call('social_overview', {}, a)).blocked[0].id, b.sub);
  assert.equal((await asRole(db.pool, b, 'select * from public.blocks where blocked = $1', [b.sub])).rowCount, 0, 'nobody can see who blocked them');
  await rejects(call('block_player', { p_user: a.sub }, a), /yourself/);
  assert.equal((await call('unblock_player', { p_user: b.sub }, a)).relationship, 'none');
  assert.equal((await call('send_friend_request', { p_handle: a.handle }, b)).relationship, 'outgoing');
});

test('search finds players by handle prefix, ranks exact matches first and escapes wildcards', async () => {
  const me = await player(), base = unique('srch');
  for (const s of ['', '_x', 'zz']) await db.pool.query(`insert into auth.users (email, encrypted_password) values ($1, 'x')`, [`${base}${s}@example.test`]).then(async () => {
    const id = (await db.pool.query('select id from auth.users where email = $1', [`${base}${s}@example.test`])).rows[0].id;
    await rpc(db.pool, 'save_profile', { p_handle: base + s, p_display_name: 'S' }, { sub: id, role: 'authenticated' });
  });
  const found = await call('search_players', { p_query: base }, me);
  assert.equal(found[0].handle, base); assert.equal(found.length, 3);
  assert.deepEqual((await call('search_players', { p_query: base + '_' }, me)).map(p => p.handle), [base + '_x'], 'underscore matches only an underscore');
  assert.deepEqual(await call('search_players', { p_query: "x' or 1=1 --" }, me), []);
  assert.ok(!(await call('search_players', { p_query: me.handle }, me)).some(p => p.id === me.sub), 'you are not in your own results');
});

// ---------------------------------------------------------------- private messages
test('friends exchange private messages; outsiders can read or write nothing, by any route', async () => {
  const a = await player('dm_'), b = await player('dm_'), eve = await player('eve_');
  await rejects(call('open_conversation', { p_user: b.sub }, a), /friends only/);
  await friends(a, b);
  const conv = await call('open_conversation', { p_user: b.sub }, a);
  assert.equal(conv.other.id, b.sub); assert.equal(conv.block_reason, null);
  assert.equal((await call('open_conversation', { p_user: a.sub }, b)).id, conv.id, 'one conversation per pair');
  const id = randomUUID();
  const first = await call('send_direct_message', { p_conversation: conv.id, p_body: '  Meet at the courts?\r\nBring a ball. ‮', p_client_id: id }, a);
  assert.equal(first.body, 'Meet at the courts?\nBring a ball.', 'trimmed, line endings normalised, bidi overrides stripped');
  const retry = await call('send_direct_message', { p_conversation: conv.id, p_body: 'Meet at the courts?', p_client_id: id }, a);
  assert.equal(retry.id, first.id); assert.equal(retry.duplicate, true, 'a retried send returns the stored message');
  const summary = await call('unread_summary', {}, b);
  assert.equal(summary.messages, 1); assert.equal(summary.conversations, 1);
  const page = await call('list_messages', { p_conversation: conv.id }, b);
  assert.equal(page.messages.length, 1); assert.equal(page.messages[0].mine, false); assert.equal(page.conversation.unread, 1);
  assert.equal((await call('mark_conversation_read', { p_conversation: conv.id, p_up_to: first.id }, b)).messages, 0);
  assert.equal((await call('list_conversations', {}, b))[0].last_message.preview, 'Meet at the courts?\nBring a ball.');
  // Outsiders: functions refuse with the same message as for a conversation that does not exist.
  for (const fn of [
    () => call('list_messages', { p_conversation: conv.id }, eve),
    () => call('send_direct_message', { p_conversation: conv.id, p_body: 'let me in', p_client_id: randomUUID() }, eve),
    () => call('mark_conversation_read', { p_conversation: conv.id, p_up_to: 999999 }, eve),
    () => call('list_messages', { p_conversation: randomUUID() }, a),
  ]) await rejects(fn(), /conversation isn’t available/);
  assert.equal((await asRole(db.pool, eve, 'select * from public.direct_messages where conversation_id = $1', [conv.id])).rowCount, 0, 'RLS hides other people’s messages');
  assert.equal((await asRole(db.pool, eve, 'select * from public.conversations where id = $1', [conv.id])).rowCount, 0);
  assert.deepEqual(await call('list_conversations', {}, eve), []);
  await rejects(asRole(db.pool, a, `insert into public.direct_messages (conversation_id, sender, body, client_id) values ($1, $2, 'forged', $3)`, [conv.id, b.sub, randomUUID()]), /permission denied/);
  await rejects(asRole(db.pool, a, `update public.conversations set b_read_id = 0 where id = $1`, [conv.id]), /permission denied/);
  await rejects(call('list_messages', { p_conversation: conv.id }), /permission denied|Sign in/);
  const echo = await call('send_direct_message', { p_conversation: conv.id, p_body: 'x', p_client_id: id }, b);
  assert.notEqual(echo.id, first.id, 'message ids are scoped to their sender, so reusing someone else’s id cannot touch their message');
});

test('message validation, rate limits, privacy and the end of a friendship', async () => {
  const a = await player('val_'), b = await player('val_');
  await friends(a, b);
  const conv = await call('open_conversation', { p_user: b.sub }, a), send = (body, who = a) => call('send_direct_message', { p_conversation: conv.id, p_body: body, p_client_id: randomUUID() }, who);
  await rejects(send('   '), /Write a message/);
  await rejects(send('x'.repeat(1001)), /1,000/);
  await rejects(send('bell\u0007'), /can’t be sent/);
  for (let i = 0; i < 5; i++) await send(`quick ${i}`);
  await rejects(send('one too many'), /quickly/);
  await db.pool.query(`update public.rate_events set at = at - interval '10 seconds' where user_id = $1`, [a.sub]);
  await send('after a pause');
  await call('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'nobody', p_party_invites: 'friends', p_appear_offline: false }, b);
  await rejects(send('are you there?'), /turned off private messages/);
  await rejects(send('reply', b), /You have turned off private messages/);
  await call('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'friends', p_appear_offline: false }, b);
  await call('remove_friend', { p_user: a.sub }, b);
  await rejects(send('wait'), /friends only/);
  const history = await call('list_messages', { p_conversation: conv.id }, a);
  assert.equal(history.messages.length, 6); assert.match(history.conversation.block_reason, /friends only/);
});

test('message history pages backwards without gaps or repeats', async () => {
  const a = await player('pg_'), b = await player('pg_');
  await friends(a, b);
  const conv = await call('open_conversation', { p_user: b.sub }, a);
  for (let i = 0; i < 12; i++) { await call('send_direct_message', { p_conversation: conv.id, p_body: `m${i}`, p_client_id: randomUUID() }, i % 2 ? b : a); await db.pool.query('delete from public.rate_events'); }
  const seen = []; let before = null, more = true;
  while (more) {
    const page = await call('list_messages', { p_conversation: conv.id, p_before: before, p_limit: 5 }, a);
    seen.unshift(...page.messages.map(m => m.body)); more = page.has_more; before = page.messages[0]?.id;
    assert.ok(page.messages.length <= 5);
  }
  assert.deepEqual(seen, Array.from({ length: 12 }, (_, i) => `m${i}`));
});

test('simultaneous retries of one message store it once', async () => {
  const a = await player('dup_'), b = await player('dup_');
  await friends(a, b);
  const conv = await call('open_conversation', { p_user: b.sub }, a), id = randomUUID();
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => call('send_direct_message', { p_conversation: conv.id, p_body: 'once', p_client_id: id }, a)));
  assert.ok(results.every(r => r.status === 'fulfilled'), JSON.stringify(results.find(r => r.status === 'rejected')?.reason?.message));
  assert.equal(new Set(results.map(r => r.value.id)).size, 1);
  assert.equal((await db.pool.query('select count(*)::int as n from public.direct_messages where conversation_id = $1', [conv.id])).rows[0].n, 1);
});

// ---------------------------------------------------------------- reports and the room's view
test('reports quote only the reported player’s message and are never readable by players', async () => {
  const a = await player('rep_'), b = await player('rep_'), c = await player('rep_');
  await friends(a, b);
  const conv = await call('open_conversation', { p_user: b.sub }, a);
  const mine = await call('send_direct_message', { p_conversation: conv.id, p_body: 'my own words', p_client_id: randomUUID() }, a);
  const theirs = await call('send_direct_message', { p_conversation: conv.id, p_body: 'something unkind', p_client_id: randomUUID() }, b);
  await rejects(call('report_player', { p_user: b.sub, p_reason: 'harassment', p_context: 'direct-message', p_message: mine.id }, a), /can’t be reported/);
  await rejects(call('report_player', { p_user: b.sub, p_reason: 'harassment', p_context: 'direct-message', p_message: theirs.id }, c), /can’t be reported/, 'outsiders cannot quote a conversation');
  await rejects(call('report_player', { p_user: b.sub, p_reason: 'because', p_context: 'direct-message' }, a), /reason/);
  assert.equal((await call('report_player', { p_user: b.sub, p_reason: 'harassment', p_context: 'direct-message', p_details: 'Started after the match.', p_message: theirs.id }, a)).reported, true);
  const row = (await db.pool.query('select * from public.player_reports where target = $1', [b.sub])).rows[0];
  assert.equal(row.evidence, 'something unkind'); assert.equal(row.reporter, a.sub);
  await rejects(asRole(db.pool, a, 'select * from public.player_reports'), /permission denied/);
  await rejects(call('report_player', { p_user: a.sub, p_reason: 'spam', p_context: 'profile' }, a), /isn’t available/);
});

test('the room server reads friends, blocks and privacy; players cannot', async () => {
  const a = await player('room_'), b = await player('room_'), c = await player('room_');
  await friends(a, b); await call('block_player', { p_user: c.sub }, a);
  await call('save_social_settings', { p_friend_requests: 'everyone', p_direct_messages: 'friends', p_party_invites: 'everyone', p_appear_offline: true }, a);
  const snap = await call('account_snapshot', { p_user: a.sub }, SERVICE);
  assert.deepEqual(snap.social.friends, [b.sub]); assert.deepEqual(snap.social.blocked, [c.sub]);
  assert.equal(snap.social.settings.party_invites, 'everyone'); assert.equal(snap.social.settings.appear_offline, true);
  assert.deepEqual((await call('social_snapshot', { p_user: b.sub }, SERVICE)).friends, [a.sub]);
  await rejects(call('social_snapshot', { p_user: a.sub }, b), /permission denied/);
  await rejects(call('relationship', { p_me: a.sub, p_other: c.sub }, b), /permission denied/, 'nobody can ask how two other players relate');
  await rejects(asRole(db.pool, b, 'insert into public.friendships (user_a, user_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))', [b.sub, c.sub]), /permission denied/);
  assert.equal((await asRole(db.pool, c, 'select * from public.friendships where $1::uuid in (user_a, user_b)', [a.sub])).rowCount, 0, 'friend lists are private');
});
