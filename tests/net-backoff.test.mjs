// Server-side adaptation to a congested connection (server/arena/match.mjs snapshot back-off): a client whose socket is
// backed up is sent fewer snapshots (down to one in three) while everyone else keeps the full rate, and recovers once the
// congestion clears. Events are sent separately and are never skipped; the simulation is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_BY_ID } from '../shared/arena/maps.mjs';
import { createMatch } from '../server/arena/match.mjs';

test('a backed-up client gets fewer snapshots, the others none fewer, and it recovers', () => {
  let now = 100000, congested = false; const tries = new Map(), events = new Map();
  const m = createMatch({ id: 'net', map: MAP_BY_ID.get('foundry'), mode: 'tdm', kind: 'private', autoTick: false, clock: () => now,
    rules: { countdownMs: 0, spawnProtectMs: 0, abandonMs: 1e7, mode: { scoreLimit: 10000, timeMs: 600000 } },
    send: (p, e) => events.set(p.num, (events.get(p.num) ?? 0) + 1),
    sendRaw: (p, raw, transient) => { if (!transient) return 'sent'; tries.set(p.num, (tries.get(p.num) ?? 0) + 1); return congested && p.num === a.num ? 'dropped' : 'sent'; } });
  const a = m.join({ id: 'a', name: 'A' }), b = m.join({ id: 'b', name: 'B' });
  m.hostStart(a);
  const run = ms => { tries.clear(); const end = now + ms; while (now < end) { now += 1000 / 30; m.tick(); } return { a: tries.get(a.num) ?? 0, b: tries.get(b.num) ?? 0 }; };
  const calm = run(2000);
  assert.ok(Math.abs(calm.a - calm.b) <= 1 && calm.b >= 38, `both at the full rate: ${JSON.stringify(calm)}`);
  congested = true; run(1000); const backed = run(3000);
  assert.ok(backed.b >= 58, `the healthy client keeps its rate: ${backed.b}`);
  assert.ok(backed.a <= backed.b / 3 + 2, `the congested client is sent about a third: ${backed.a} of ${backed.b}`);
  const evA = events.get(a.num) ?? 0; m.flush?.(); void evA;
  congested = false; run(10000); const after = run(2000);
  assert.ok(Math.abs(after.a - after.b) <= 1, `recovered to the full rate: ${JSON.stringify(after)}`);
  m.close?.('test');
});
