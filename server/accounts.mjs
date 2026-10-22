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
    // Our database functions raise short, player-facing messages for refusals (bad time, wrong place);
    // keep those so the room can pass them on. Anything else stays generic.
    if (!r.ok) throw Object.assign(new Error(`Account service ${fn} failed (${r.status})`), { status: r.status, code: r.body?.code, reason: ['22023', 'P0002', '42501'].includes(r.body?.code) && typeof r.body?.message === 'string' ? r.body.message.slice(0, 200) : null });
    return r.body;
  };

  return {
    enabled: true,
    /**
     * Resolve an access token to `{ id, email }` (the email only pre-fills a store checkout), or `{ error }` when it is malformed, expired,
     * revoked or the service is unreachable. Supabase Auth makes the decision.
     */
    async verify(token) {
      if (typeof token !== 'string' || token.length > 4096 || !JWT.test(token)) return { error: 'invalid' };
      try {
        const r = await call('/auth/v1/user', { method: 'GET', headers: { apikey: anonKey || serviceKey, Authorization: `Bearer ${token}` } });
        if (r.ok && typeof r.body?.id === 'string') return { id: r.body.id, email: typeof r.body.email === 'string' ? r.body.email : '' };
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
    /** In-game event attendance: the room has checked the player is at the event's location. */
    checkin: (id, event, location) => service('record_event_checkin', { p_user: id, p_event: event, p_location: location }),
    /** A challenge completed in `ms`, timed by the room. */
    recordChallenge: (id, challenge, ms, run) => service('record_challenge', { p_user: id, p_challenge: challenge, p_ms: ms, p_run: run }),
    /** An achievement the room measured itself (time in a party of three or more). */
    recordRoomAchievement: (id, achievement) => service('record_room_achievement', { p_user: id, p_achievement: achievement }),
    /** The store (server/shop.mjs): open an order, record its Bachs checkout, fulfil it from a verified webhook. */
    createOrder: (id, item, amount, currency) => service('shop_create_order', { p_user: id, p_item: item, p_amount: amount, p_currency: currency }),
    openOrder: (order, checkout) => service('shop_open_order', { p_order: order, p_checkout: checkout }),
    fulfilOrder: f => service('shop_fulfil', { p_event: f.event, p_type: f.type, p_order: f.order, p_checkout: f.checkout, p_amount: f.amount, p_currency: f.currency, p_charge: f.charge }),
    /** The saved layout of the player's room in Palm House (null until they first arrange it). */
    dormLayout: id => service('dorm_layout', { p_user: id }),
    /** Save a room layout the room server has validated (shared/dorm.mjs). */
    saveDorm: (id, layout) => service('save_dorm_layout', { p_user: id, p_layout: layout }),
    /** A finished Court Duel between two signed-in players. Idempotent on the match id, so retries are safe. */
    recordDuel: m => service('record_duel', { p_match: m.id, p_player_a: m.a, p_player_b: m.b, p_score_a: m.scoreA, p_score_b: m.scoreB, p_outcome: m.outcome, p_forfeit_by: m.forfeitBy, p_started_at: new Date(m.startedAt).toISOString(), p_ended_at: new Date(m.endedAt).toISOString() }),
  };
}
