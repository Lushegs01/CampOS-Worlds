// Account verification and progression for the room server, backed by Supabase.
//
// The room never trusts an account id, name, badge or role sent by a client. A signed-in client
// sends its Supabase access token over the open WebSocket (never in a URL); the room asks Supabase
// Auth who the token belongs to, then loads that account's public profile with its own server-side
// key. Progress and badges are recorded only from actions the room itself has validated.
//
// Configuration (server only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or a `sb_secret_…` key),
// and optionally SUPABASE_ANON_KEY (public) for the token check. Tokens and keys are never logged.

const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

export function createAccounts({ url = '', serviceKey = '', anonKey = '', timeoutMs = 5000, fetchImpl = globalThis.fetch, log = console } = {}) {
  const base = url.replace(/\/+$/, '');
  if (!base || !serviceKey) return { enabled: false };
  // Legacy keys are JWTs and go in both headers; new `sb_secret_` / `sb_publishable_` keys go only in apikey.
  const keyHeaders = key => (key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` });
  const call = async (path, init) => {
    const response = await fetchImpl(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: response.status, ok: response.ok, body };
  };
  const service = async (fn, args) => {
    const r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...keyHeaders(serviceKey), 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) throw Object.assign(new Error(`Account service ${fn} failed (${r.status})`), { status: r.status });
    return r.body;
  };

  return {
    enabled: true,
    /**
     * Resolve an access token to `{ id, email }`, or `{ error }` when it is malformed, expired,
     * revoked or the service is unreachable. Supabase Auth makes the decision.
     */
    async verify(token) {
      if (typeof token !== 'string' || token.length > 4096 || !JWT.test(token)) return { error: 'invalid' };
      try {
        const r = await call('/auth/v1/user', { method: 'GET', headers: { apikey: anonKey || serviceKey, Authorization: `Bearer ${token}` } });
        if (r.ok && typeof r.body?.id === 'string') return { id: r.body.id };
        return { error: r.status >= 500 ? 'unavailable' : 'invalid' };
      } catch (e) {
        log.warn?.(`Account check unavailable: ${e.name === 'TimeoutError' ? 'timed out' : 'network error'}`);
        return { error: 'unavailable' };
      }
    },
    /** Public profile plus the progress the room uses, or null when the account has no profile yet. */
    snapshot: id => service('account_snapshot', { p_user: id }),
    /** Friends, blocked players and privacy settings (refreshed after social changes). */
    socialSnapshot: id => service('social_snapshot', { p_user: id }),
    recordProgress: (id, kind, item) => service('record_progress', { p_user: id, p_kind: kind, p_item: item }),
    recordHoopsRound: (id, points, made) => service('record_hoops_round', { p_user: id, p_points: points, p_made: made }),
  };
}
