// Malformed and hostile messages must never take the room down: an exception thrown while handling a
// WebSocket message is uncaught and would end the process for everyone. Several clients send every
// message type with wrong, missing, huge and nested values; the room must stay up and keep working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createRoom } from '../server/room.mjs';

const TYPES = ['join', 'input', 'settle', 'auth', 'profile', 'chat', 'partyChat', 'party', 'duel', 'challenge', 'checkin', 'meetUp', 'prefs', 'telemetry', 'socialNotify', 'socialRefresh', 'emote', 'interact', 'collect', 'sit', 'stand', 'door', 'pickup', 'drop', 'shoot', 'ballReset', 'report', 'classAction', 'vehicleInput', 'vehicleEnter', 'vehicleExit', 'vehicleRecover', 'nonsense'];
const FIELDS = ['id', 'x', 'z', 'dx', 'dz', 'yaw', 'jump', 'sprint', 'text', 'name', 'avatar', 'token', 'invite', 'action', 'accept', 'party', 'challenge', 'event', 'location', 'seat', 'ball', 'open', 'charge', 'reason', 'context', 'emote', 'room', 'option', 'topic', 'throttle', 'steer', 'brake', 'ref', 'to', 'kind', 'analytics', 'partyInvites', 'failures', 'access', 'm'];
let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
const VALUES = () => [null, undefined, true, false, 0, -1, 1e308, -1e308, NaN, 3.5, '', 'x'.repeat(300), '__proto__', 'constructor', 'library', 'bench-0-l', 'ball-1', 'library-main', 'create', 'invite', 'respond', 'kick', 'start', 'host', 'vote', [], [1, 2], {}, { model: '../x', accent: { a: 1 } }, { toString: 1 }, { __proto__: { polluted: 1 } }, '‮\u0000'];

function message() {
  const m = { type: pick(TYPES) };
  for (const f of FIELDS) if (rnd() < .3) m[f] = pick(VALUES());
  return JSON.stringify(m);
}

test('hundreds of malformed messages of every type leave the room running and usable', async () => {
  const failures = []; const onError = e => failures.push(e); process.on('uncaughtException', onError);
  const room = createRoom({ port: 0 }), address = await room.start(), url = `ws://127.0.0.1:${address.port}/ws`;
  const connect = async name => { const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); }); ws.send(JSON.stringify({ type: 'join', name, avatar: {} })); await new Promise(r => ws.once('message', r)); return ws; };
  try {
    const clients = await Promise.all(Array.from({ length: 8 }, (_, i) => connect('Fuzz ' + i)));
    // Paced under the per-connection limit (75 messages a second), so the room processes them all.
    for (let round = 0; round < 40; round++) {
      for (const ws of clients) if (ws.readyState === WebSocket.OPEN) for (let k = 0; k < 6; k++) ws.send(rnd() < .05 ? '{not json' : message());
      await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 500));
    assert.deepEqual(failures.map(String), [], 'no handler threw');
    const health = await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();
    assert.equal(health.ok, true);
    // Still a working room: a fresh pair can join and talk.
    const a = await connect('After A'), b = await connect('After B');
    const heard = new Promise(r => b.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'chat' && m.text === 'still here') r(m); }));
    a.send(JSON.stringify({ type: 'chat', text: 'still here' }));
    assert.equal((await heard).text, 'still here');
    assert.equal(Object.prototype.polluted, undefined, 'no prototype pollution');
    for (const ws of [...clients, a, b]) ws.close();
  } finally { process.off('uncaughtException', onError); await room.close(); }
});
