// Gameplay analytics, built to answer one question: do players enjoy CampOS Worlds enough to come
// back? (Definitions of every metric: docs/ANALYTICS.md; computed by scripts/analytics/report.mjs.)
//
// Privacy by construction:
// * Off unless the operator enables it (ANALYTICS_ENABLED=1 with an ANALYTICS_SALT), and recorded
//   only for players who opted in from Settings. Without consent nothing about them is written.
// * Only the lifecycle events below, each with a fixed list of small properties. No names, handles,
//   chat or private messages, positions, IP addresses or user agents are ever recorded.
// * Subjects are pseudonymous: an HMAC of the account id (or of a random per-browser id for guests)
//   with a server secret, so the files cannot be joined back to accounts without that secret.
// * Stored locally as one JSON Lines file per UTC day, deleted after the retention period
//   (90 days by default). Nothing is sent to any third party.
import { createHmac } from 'node:crypto';
import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Event name → the properties it may carry (anything else is dropped), with allowed values. */
export const EVENTS = {
  session_start: { guest: 'boolean' },
  session_end: { seconds: 'number', reason: ['closed', 'removed'] },
  account_linked: {},
  tutorial_completed: {},
  friend_connected: {},
  party_created: {},
  party_joined: { size: 'number' },
  duel_started: {},
  duel_completed: { outcome: ['time', 'forfeit'], rated: 'boolean' },
  event_checkin: {},
  achievement_earned: { achievement: 'string' },
  challenge_completed: { challenge: 'string' },
  shop_checkout: { item: 'string' },
  connection_failures: { count: 'number' },
};
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
function clean(name, props = {}) {
  const spec = EVENTS[name]; if (!spec) return null;
  const out = {};
  for (const [k, type] of Object.entries(spec)) {
    const v = props[k];
    if (Array.isArray(type) ? type.includes(v) : type === 'number' ? Number.isFinite(v) && v >= 0 && v < 1e7 : type === 'boolean' ? typeof v === 'boolean' : typeof v === 'string' && ID.test(v)) out[k] = type === 'number' ? Math.round(v) : v;
  }
  return out;
}
const day = t => new Date(t).toISOString().slice(0, 10);

/**
 * @param {{ enabled?: boolean, salt?: string, dir?: string, retentionDays?: number, now?: () => number, log?: { warn?: Function } }} options
 */
export function createAnalytics({ enabled = false, salt = '', dir = 'server/data/analytics', retentionDays = 90, now = () => Date.now(), log = console } = {}) {
  const on = enabled && salt.length >= 16;
  if (enabled && !on) log.warn?.('Analytics disabled: ANALYTICS_SALT must be a secret of at least 16 characters.');
  let queue = Promise.resolve(), pruned = '';
  const pseudonym = (kind, id) => createHmac('sha256', salt).update(`${kind}:${id}`).digest('base64url').slice(0, 22);
  async function prune() {
    const cutoff = day(now() - retentionDays * 86400000);
    for (const f of await readdir(dir).catch(() => [])) { const m = /^analytics-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f); if (m && m[1] < cutoff) await unlink(join(dir, f)).catch(() => {}); }
  }
  return {
    enabled: on,
    /** The pseudonymous subject for a connection, or null when it has not consented. */
    subject(c) {
      if (!on || !c.analytics?.consent) return null;
      if (c.account?.id) return pseudonym('account', c.account.id);
      return typeof c.analytics.install === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(c.analytics.install) ? pseudonym('install', c.analytics.install) : null;
    },
    /** Record one allowlisted event for a consenting connection. Never throws. */
    track(c, name, props) {
      const subject = this.subject(c), clean_ = subject && clean(name, props);
      if (!clean_) return;
      const t = now(), line = JSON.stringify({ at: new Date(t).toISOString(), subject, event: name, ...clean_ }) + '\n';
      queue = queue.then(async () => {
        await mkdir(dir, { recursive: true });
        if (pruned !== day(t)) { pruned = day(t); await prune(); }
        await appendFile(join(dir, `analytics-${day(t)}.jsonl`), line);
      }).catch(() => log.warn?.('Analytics event could not be written.'));
    },
    flush: () => queue,
  };
}
