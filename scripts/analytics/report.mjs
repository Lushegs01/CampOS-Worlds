// Retention and engagement report from the room's analytics files (server/analytics.mjs).
//   node scripts/analytics/report.mjs [dir]      (default server/data/analytics)
// Definitions are in docs/ANALYTICS.md; this file implements exactly those.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const dayOf = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Compute every metric from a list of events ({ at, subject, event, ...props }). */
export function report(events, { through } = {}) {
  events = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const last = through ? dayOf(through) : events.length ? dayOf(events[events.length - 1].at) : 0;
  const subjects = new Map();
  for (const e of events) {
    let s = subjects.get(e.subject);
    if (!s) subjects.set(e.subject, s = { first: dayOf(e.at), firstAt: e.at, days: new Set(), sessions: [], events: [] });
    s.events.push(e);
    if (e.event === 'session_start') { s.days.add(dayOf(e.at)); s.sessions.push({ start: e.at, events: [] }); }
    else if (s.sessions.length) s.sessions[s.sessions.length - 1].events.push(e);
  }
  // New players: subjects whose first event is in the data. Activation: the first session includes
  // an introductory activity (the campus tour, a party, a duel or an event check-in).
  const ACTIVATING = new Set(['tutorial_completed', 'party_joined', 'party_created', 'duel_completed', 'event_checkin']);
  const all = [...subjects.values()];
  const activated = all.filter(s => s.sessions[0]?.events.some(e => ACTIVATING.has(e.event))).length;
  const tutorial = all.filter(s => s.sessions[0]?.events.some(e => e.event === 'tutorial_completed')).length;
  // Day-N retention: of the players first seen on day D (UTC), the share with a session on day D+N.
  // A cohort is eligible for day N only if day D+N is inside the data (no partial windows).
  const retention = n => { const eligible = all.filter(s => s.first + n * DAY <= last); return { eligible: eligible.length, retained: eligible.filter(s => s.days.has(s.first + n * DAY)).length, rate: pct(eligible.filter(s => s.days.has(s.first + n * DAY)).length, eligible.length) }; };
  const sessions = all.flatMap(s => s.sessions);
  const durations = events.filter(e => e.event === 'session_end' && Number.isFinite(e.seconds)).map(e => e.seconds);
  const count = name => events.filter(e => e.event === name).length;
  const started = count('duel_started'), completed = events.filter(e => e.event === 'duel_completed');
  const repeat = name => { const per = new Map(); for (const e of events) if (e.event === name) per.set(e.subject, (per.get(e.subject) ?? 0) + 1); const players = [...per.values()]; return { players: players.length, repeat: players.filter(n => n > 1).length, rate: pct(players.filter(n => n > 1).length, players.length) }; };
  return {
    window: events.length ? { from: events[0].at.slice(0, 10), through: new Date(last).toISOString().slice(0, 10) } : null,
    players: all.length,
    activation: { activated, rate: pct(activated, all.length) },
    first_session_tutorial: { completed: tutorial, rate: pct(tutorial, all.length) },
    retention: { d1: retention(1), d7: retention(7), d30: retention(30) },
    sessions: { count: sessions.length, with_party_or_friends: sessions.filter(s => s.events.some(e => e.event === 'party_joined' || e.event === 'party_created' || e.event === 'friend_connected')).length, median_seconds: median(durations) },
    community: { event_checkins: count('event_checkin'), players_checking_in: new Set(events.filter(e => e.event === 'event_checkin').map(e => e.subject)).size },
    duels: { started, completed: completed.length, completion_rate: pct(completed.length, started), forfeits: completed.filter(e => e.outcome === 'forfeit').length },
    repeat_participation: { duels: repeat('duel_completed'), events: repeat('event_checkin') },
    reliability: (() => { const failures = events.filter(e => e.event === 'connection_failures').reduce((n, e) => n + (e.count ?? 0), 0); return { connection_failures: failures, per_100_sessions: pct(failures, sessions.length) }; })(),
  };
}

export async function readEvents(dir) {
  const out = [];
  for (const f of (await readdir(dir).catch(() => [])).filter(f => /^analytics-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort())
    for (const line of (await readFile(join(dir, f), 'utf8')).split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn last line */ } }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'server/data/analytics';
  console.log(JSON.stringify(report(await readEvents(dir)), null, 2));
}
