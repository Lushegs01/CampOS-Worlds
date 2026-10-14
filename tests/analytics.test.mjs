// Analytics: consent, the allowlist, pseudonymous subjects, retention of files, and the metric
// definitions in docs/ANALYTICS.md (computed on synthetic data with known answers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnalytics } from '../server/analytics.mjs';
import { report, readEvents } from '../scripts/analytics/report.mjs';

const SALT = 'a-test-secret-of-sufficient-length';
test('nothing is recorded without operator enablement and player consent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'campos-analytics-'));
  try {
    const off = createAnalytics({ enabled: false, salt: SALT, dir }), weak = createAnalytics({ enabled: true, salt: 'short', dir, log: {} });
    const player = { analytics: { consent: true, install: 'abcdefghijklmnop1234' } };
    off.track(player, 'session_start', {}); weak.track(player, 'session_start', {});
    const on = createAnalytics({ enabled: true, salt: SALT, dir });
    on.track({ analytics: { consent: false, install: 'abcdefghijklmnop1234' } }, 'session_start', {});
    on.track({ analytics: null }, 'session_start', {});
    await on.flush();
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('only allowlisted events and properties are written, under a pseudonym', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'campos-analytics-'));
  try {
    const a = createAnalytics({ enabled: true, salt: SALT, dir });
    const guest = { analytics: { consent: true, install: 'abcdefghijklmnop1234' } }, member = { analytics: { consent: true, install: 'zzzzzzzzzzzzzzzz9999' }, account: { id: '00000000-0000-4000-8000-000000000001', handle: 'ada' } };
    a.track(guest, 'session_start', { guest: true, name: 'Ada Obi', x: 12 });
    a.track(member, 'duel_completed', { outcome: 'time', rated: true, opponent: 'tobi' });
    a.track(member, 'achievement_earned', { achievement: 'court-champion' });
    a.track(member, 'achievement_earned', { achievement: '<script>' });
    a.track(member, 'chat_message', { text: 'hello' });
    a.track(guest, 'party_joined', { size: 'many' });
    await a.flush();
    const text = await readFile(join(dir, (await readdir(dir))[0]), 'utf8'), rows = text.trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 5, 'unknown events are dropped');
    assert.ok(!/Ada|tobi|ada|hello|00000000|abcdefghij/.test(text), 'no names, handles, ids, install ids or chat');
    assert.deepEqual(Object.keys(rows[0]).sort(), ['at', 'event', 'guest', 'subject']);
    assert.equal(rows[2].achievement, 'court-champion'); assert.equal(rows[3].achievement, undefined, 'malformed values are dropped');
    assert.equal(rows[4].size, undefined);
    assert.equal(rows[1].subject, rows[2].subject, 'a player keeps one pseudonym');
    assert.notEqual(rows[0].subject, rows[1].subject);
    assert.equal(createAnalytics({ enabled: true, salt: SALT + 'x', dir }).subject(member) === rows[1].subject, false, 'pseudonyms depend on the secret');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('files older than the retention period are deleted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'campos-analytics-'));
  try {
    await writeFile(join(dir, 'analytics-2020-01-01.jsonl'), '{}\n'); await writeFile(join(dir, 'notes.txt'), 'keep');
    const a = createAnalytics({ enabled: true, salt: SALT, dir, retentionDays: 30 });
    a.track({ analytics: { consent: true, install: 'abcdefghijklmnop1234' } }, 'session_start', {}); await a.flush();
    const files = await readdir(dir);
    assert.ok(!files.includes('analytics-2020-01-01.jsonl')); assert.ok(files.includes('notes.txt'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('metrics follow their written definitions', async () => {
  const ev = (subject, at, event, extra = {}) => ({ subject, at, event, ...extra });
  const d = n => new Date(Date.UTC(2026, 9, 1 + n, 12)).toISOString();
  const events = [
    // A: first day 0, tour in first session, returns day 1 and day 7.
    ev('A', d(0), 'session_start'), ev('A', d(0), 'tutorial_completed'), ev('A', d(0), 'session_end', { seconds: 600 }),
    ev('A', d(1), 'session_start'), ev('A', d(1), 'party_joined', { size: 2 }), ev('A', d(7), 'session_start'),
    // B: first day 0, no activation, returns day 2 only.
    ev('B', d(0), 'session_start'), ev('B', d(0), 'session_end', { seconds: 120 }), ev('B', d(2), 'session_start'),
    // C: first day 5 (not eligible for D7 when data ends on day 8), duels twice.
    ev('C', d(5), 'session_start'), ev('C', d(5), 'duel_started'), ev('C', d(5), 'duel_completed', { outcome: 'time', rated: false }),
    ev('C', d(6), 'session_start'), ev('C', d(6), 'duel_started'), ev('C', d(6), 'duel_completed', { outcome: 'forfeit', rated: true }), ev('C', d(6), 'duel_started'),
    ev('C', d(6), 'connection_failures', { count: 2 }), ev('A', d(8), 'session_start'),
  ];
  const r = report(events);
  assert.equal(r.players, 3);
  assert.deepEqual(r.activation, { activated: 2, rate: 66.7 }, 'A (tour) and C (duel) activate in their first session');
  assert.deepEqual(r.first_session_tutorial, { completed: 1, rate: 33.3 });
  assert.deepEqual(r.retention.d1, { eligible: 3, retained: 2, rate: 66.7 }, 'A and C return the next day; B does not');
  assert.deepEqual(r.retention.d7, { eligible: 2, retained: 1, rate: 50 }, 'C is not yet eligible for day 7');
  assert.deepEqual(r.retention.d30, { eligible: 0, retained: 0, rate: null });
  assert.equal(r.sessions.count, 8); assert.equal(r.sessions.with_party_or_friends, 1); assert.equal(r.sessions.median_seconds, 360);
  assert.deepEqual(r.duels, { started: 3, completed: 2, completion_rate: 66.7, forfeits: 1 });
  assert.deepEqual(r.repeat_participation.duels, { players: 1, repeat: 1, rate: 100 });
  assert.equal(r.reliability.connection_failures, 2);
  const dir = await mkdtemp(join(tmpdir(), 'campos-analytics-'));
  try { await writeFile(join(dir, 'analytics-2026-10-01.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n{"torn'); assert.equal((await readEvents(dir)).length, events.length); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('a real room records sessions only for players who consented', async () => {
  const { createRoom } = await import('../server/room.mjs'), { WebSocket } = await import('ws');
  const dir = await mkdtemp(join(tmpdir(), 'campos-analytics-'));
  const room = createRoom({ port: 0, analytics: createAnalytics({ enabled: true, salt: SALT, dir }) }), port = (await room.start()).port;
  const connect = async analytics => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://localhost:5173' }); await new Promise(r => ws.once('open', r));
    const welcome = new Promise(r => ws.on('message', raw => { if (JSON.parse(raw).type === 'welcome') r(); }));
    ws.send(JSON.stringify({ type: 'join', name: 'Player', analytics })); await welcome; return ws;
  };
  try {
    const yes = await connect({ consent: true, install: 'consenting-browser-0001' }), no = await connect({ consent: false, install: 'declining-browser-00001' }), silent = await connect(undefined);
    yes.send(JSON.stringify({ type: 'telemetry', failures: 3 }));
    await new Promise(r => setTimeout(r, 150));
    for (const ws of [yes, no, silent]) ws.close();
    await new Promise(r => setTimeout(r, 200)); await room.close();
    const rows = (await readEvents(dir));
    assert.deepEqual(rows.map(r => r.event).sort(), ['connection_failures', 'session_end', 'session_start']);
    assert.equal(new Set(rows.map(r => r.subject)).size, 1, 'only the consenting player');
    assert.equal(rows.find(r => r.event === 'session_start').guest, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
