// Combat Arena service: the WebSocket endpoint (/arena), player identity, matchmaking, private and
// training matches, reconnection and result recording. It shares the room server's HTTP listener and
// account verification (server/accounts.mjs), so a player keeps one identity, profile and session,
// but nothing of the campus room's state: combat never touches campus gameplay.
//
// Every match is an independent object (server/arena/match.mjs) with its own clock and tick loop;
// this service only routes connections to them. Many run side by side, and because a match holds no
// shared state, more arena processes can be added behind a load balancer that keeps each client on
// the node that hosts its match (docs/COMBAT-ARENA.md, "Scaling").

import { randomUUID, randomBytes } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createMatch } from './match.mjs';
import { MAPS, MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { MODES, MODE_BY_ID, MATCH, validateLoadout, validChoice, PRESETS, levelFor, weaponLevel, weaponXp } from '../../shared/arena/rules.mjs';
import { EMBLEMS } from '../../shared/arena/weapons.mjs';
import { guestName, cleanText } from '../../shared/text.mjs';

const MAX_MESSAGE = 1536, MAX_HELLO = 6144;
const str = v => (typeof v === 'string' ? v : '');
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
/** Store item ids an account owns, as sent by account_snapshot (anything malformed is dropped). */
const ownedList = v => (Array.isArray(v) ? [...new Set(v.filter(i => typeof i === 'string' && /^[a-z0-9-]{1,32}$/.test(i)))].slice(0, 200) : []);

export function createArena({ accounts = { enabled: false }, capacity = 400, maxMatches = 60, rules = {}, logDir = null, log = console, clock = () => Date.now(), minRecordMs = 60000, autoTick = true, slowCloseMs = 6000, identifyMs = 9000, deployLog = false } = {}) {
  const connections = new Map(), matches = new Map(), codes = new Map();
  const metrics = { matchesCreated: 0, matchesFinished: 0, recorded: 0, recordFailures: 0, rejected: 0, identifyDegraded: 0 };
  const deploys = createDeployTraces({ clock, log, enabled: deployLog });
  let closing = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_HELLO, perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 1, memLevel: 7 }, clientNoContextTakeover: true } });

  // ---------------------------------------------------------------- sending
  const slowSince = new WeakMap();
  function sendRaw(c, raw, transient = false) {
    const ws = c?.ws; if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount >= 65536) {
      const since = slowSince.get(ws) ?? Date.now(); slowSince.set(ws, since);
      if (ws.bufferedAmount >= 262144 * (slowCloseMs / 6000) || Date.now() - since > slowCloseMs) { ws.close(1013, 'Connection too slow; reconnect'); return; }
      if (transient) return; // a newer snapshot replaces this one; events are never dropped
    } else slowSince.delete(ws);
    ws.send(raw, { compress: raw.length >= 512 });
  }
  const send = (c, m) => sendRaw(c, JSON.stringify(m));
  // Matches address players; players carry their current connection.
  const toPlayer = (p, m) => send(p.conn, m), rawToPlayer = (p, raw, transient) => sendRaw(p.conn, raw, transient);

  // ---------------------------------------------------------------- matches
  function newMatch({ kind, mode, map, maxPerTeam, bots = 0, difficulty = 'normal', variant = null }) {
    const id = randomUUID();
    let code = null;
    if (kind === 'private') { do code = Array.from(randomBytes(6), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); while (codes.has(code)); }
    const m = createMatch({
      id, kind, code, mode, map: MAP_BY_ID.get(map), maxPerTeam: maxPerTeam ?? MATCH.maxPerTeam, bots, difficulty, clock, autoTick, variant,
      rules: { ...rules, ...(kind === 'training' ? { countdownMs: Math.min(rules.countdownMs ?? MATCH.countdownMs, 5000) } : {}) },
      send: toPlayer, sendRaw: rawToPlayer,
      onFinish: (match, result) => { metrics.matchesFinished++; persist(match, result); writeLog(match); },
      onClose: match => { matches.delete(match.id); if (match.code) codes.delete(match.code); for (const p of match.players) if (p.conn?.match === match) { p.conn.match = null; p.conn.player = null; } },
      log: () => {},
    });
    matches.set(id, m); if (code) codes.set(code, m); metrics.matchesCreated++;
    return m;
  }
  /** A host's choice of lighting variant, if that map has it (Quick Play ignores it: see createMatch). */
  const variantOf = (mapId, v) => (typeof v === 'string' && MAP_BY_ID.get(mapId)?.variants?.some(x => x.id === v) ? v : null);
  function enter(c, m) {
    // Clients that report when their scene has loaded (caps 'loadgate') are not put into live combat before then.
    const p = m.join({ id: c.id, name: c.name, account: c.account?.id ?? null, handle: c.account?.handle ?? null, level: c.level, emblem: c.emblem, conn: c, loadout: c.loadout, gated: !!c.caps?.loadgate });
    if (p.error) return { ok: false, reason: p.error };
    c.match = m; c.player = p;
    deploys.step(c, 'assigned', { match: m.id, kind: m.kind, state: m.state, held: !p.alive });
    send(c, { t: 'match', match: m.view(), you: { num: p.num, team: p.team, key: p.key }, loadout: p.loadout });
    m.flush();
    return { ok: true };
  }
  /** Quick Play: join the fullest open match of this mode (and map), or open a new one. */
  function quickPlay(c, modeId, mapId) {
    const open = [...matches.values()].filter(m => m.kind === 'quick' && !m.closed && m.mode.id === modeId && (mapId === 'any' || m.map.id === mapId) &&
      m.state !== 'ended' && m.players.length < m.rules.maxPerTeam * 2);
    open.sort((a, b) => b.connected().length - a.connected().length);
    for (const m of open) { const r = enter(c, m); if (r.ok) return r; }
    if (matches.size >= maxMatches) return { ok: false, reason: 'Every arena is busy right now. Try again in a minute.' };
    const map = mapId === 'any' ? MAPS[Math.floor(Math.random() * MAPS.length)].id : mapId;
    return enter(c, newMatch({ kind: 'quick', mode: modeId, map }));
  }
  function leaveMatch(c) {
    const m = c.match; if (!m) return;
    if (c.player) m.leave(c.player);
    c.match = null; c.player = null;
  }

  // ---------------------------------------------------------------- results
  /** Record a finished Quick Play match for signed-in players. Idempotent on the match id. */
  function persist(m, result) {
    const people = result.players.filter(r => !r.bot);
    const rows = people.filter(r => r.account);
    const duration = result.endedAt - result.startedAt;
    const reason = m.kind !== 'quick' ? (m.kind === 'training' ? 'Training matches are not recorded.' : 'Private matches are not recorded.')
      : result.outcome === 'abandoned' ? 'This match was abandoned, so it was not recorded.'
      : people.length < 2 || duration < minRecordMs ? 'Matches count once they last a minute with at least two players.'
      : !accounts.enabled ? 'Sign in to keep arena progress.' : null;
    for (const p of m.players) if (!p.bot && p.conn) send(p.conn, { t: 'record', state: reason ? 'skipped' : p.account ? 'saving' : 'guest', reason: reason ?? (p.account ? null : 'Sign in to keep arena progress and statistics.') });
    if (reason || !rows.length) return;
    const record = {
      id: m.id, mode: result.mode, map: result.map, startedAt: result.startedAt, endedAt: result.endedAt, winner: result.winner, scores: result.scores, outcome: result.outcome,
      players: rows.map(r => ({ user: r.account, team: r.team, kills: r.kills, deaths: r.deaths, assists: r.assists, headshots: r.headshots, captures: r.captures, neutralizes: r.neutralizes,
        defends: r.defends, score: r.score, damage: Math.round(r.damage), result: r.result, completed: r.completed, best_streak: r.bestStreak, weapons: r.weapons })),
    };
    const attempt = n => accounts.recordArenaMatch(record).then(reply => {
      metrics.recorded++;
      const byUser = new Map((Array.isArray(reply?.players) ? reply.players : []).map(x => [x.user, x]));
      for (const p of m.players) {
        if (!p.account || !p.conn) continue;
        const r = byUser.get(p.account);
        if (r) { send(p.conn, { t: 'progress', match: m.id, ...r }); if (p.conn.account?.id === p.account) { p.conn.level = r.level ?? p.conn.level; p.conn.xp = r.total_xp ?? p.conn.xp; } }
      }
    }).catch(e => {
      if (n < 3 && !closing) setTimeout(() => attempt(n + 1), 1500 * 2 ** n);
      else { metrics.recordFailures++; log.warn?.(`Arena result ${m.id} could not be recorded: ${e?.message ?? e}`); for (const p of m.players) if (p.account && p.conn) send(p.conn, { t: 'record', state: 'failed', reason: 'Your match result could not be saved right now.' }); }
    });
    attempt(0);
  }
  async function writeLog(m) {
    if (!logDir) return;
    try { await mkdir(logDir, { recursive: true }); await appendFile(joinPath(logDir, `${m.id}.jsonl`), m.combatLog.map(e => JSON.stringify(e)).join('\n') + '\n'); }
    catch (e) { log.warn?.(`Arena combat log for ${m.id} could not be written: ${e?.message ?? e}`); }
  }

  // ---------------------------------------------------------------- identity
  /** Resolve within `ms`, or settle as `fallback` (a slow account service must not hold a player at the door). */
  const within = (p, ms, fallback) => Promise.race([p, new Promise(r => { const t = setTimeout(() => r(fallback), ms); t.unref?.(); })]);
  async function identify(c, m) {
    c.name = guestName(m.name); c.account = null; c.level = 1; c.xp = 0; c.weaponLevels = {}; c.loadouts = []; c.owned = [];
    c.caps = Object.fromEntries((Array.isArray(m.caps) ? m.caps : []).filter(x => typeof x === 'string' && x.length < 24).slice(0, 8).map(x => [x, true]));
    let notice = null;
    const started = clock();
    if (typeof m.access === 'string' && accounts.enabled) {
      const who = await within(accounts.verify(m.access), identifyMs, { error: 'unavailable' });
      if (who.error === 'unavailable') notice = 'accounts-unavailable';
      if (!who.error) {
        try {
          // Profile and arena progress are independent: ask for both at once, within what is left of the deadline.
          const left = Math.max(1000, identifyMs - (clock() - started));
          const [snap, arena] = await within(Promise.all([accounts.snapshot(who.id), accounts.arenaSnapshot(who.id).catch(() => null)]), left, [undefined, null]);
          if (snap === undefined) notice = 'accounts-unavailable';
          if (snap) {
            c.account = { id: who.id, handle: snap.handle };
            c.name = cleanText(snap.display_name, 32) || 'Explorer';
            c.xp = arena?.xp ?? 0; c.level = levelFor(c.xp);
            // Premium weapons the account owns (store items granted only from verified payments).
            c.owned = ownedList(snap.owned);
            for (const w of arena?.weapons ?? []) c.weaponLevels[w.weapon] = weaponLevel(weaponXp(w.kills, w.headshots));
            c.loadouts = (arena?.loadouts ?? []).map(l => validateLoadout(l, c.level, c.weaponLevels, c.owned)).filter(r => r.ok).map(r => r.loadout);
            c.emblem = typeof arena?.emblem === 'string' ? arena.emblem : 'recruit';
          }
        } catch { notice = 'accounts-unavailable'; /* keep playing as a guest */ }
      }
    }
    if (notice) metrics.identifyDegraded++;
    ready(c, notice);
  }
  /** Tell the client who it is (always: even when identification failed it can play as a guest). */
  function ready(c, notice = null) {
    if (c.ready || c.ws.readyState !== WebSocket.OPEN) return;
    // Another arena window of the same account replaces the older connection.
    if (c.account) for (const o of connections.values()) if (o !== c && o.account?.id === c.account.id && o.ready) { send(o, { t: 'replaced' }); o.ws.close(4004, 'Opened in another window'); }
    const emblem = EMBLEMS.filter(e => e.level <= c.level).find(e => e.id === c.emblem) ?? EMBLEMS[0];
    c.emblem = emblem.id;
    c.loadout = c.loadouts?.[0] ?? PRESETS[0];
    c.ready = true;
    send(c, { t: 'ready', id: c.id, name: c.name, verified: !!c.account, handle: c.account?.handle ?? null, level: c.level, xp: c.xp, weaponLevels: c.weaponLevels ?? {}, emblem: c.emblem, owned: c.owned ?? [],
      loadout: c.loadout, loadouts: c.loadouts ?? [], modes: MODES.map(({ id, name, text }) => ({ id, name, text })), maps: MAPS.map(({ id, name, blurb }) => ({ id, name, blurb })),
      online: [...connections.values()].filter(o => o.ready).length, matches: matches.size, ...(notice ? { notice } : {}) });
  }

  // ---------------------------------------------------------------- connections
  function handleUpgrade(req, socket, head) {
    if (closing || connections.size >= capacity) { metrics.rejected++; socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\nContent-Length: 0\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  }
  wss.on('connection', ws => {
    const c = { id: randomUUID(), ws, ready: false, match: null, player: null, limits: {}, alive: true, openedAt: Date.now(), name: 'Explorer', level: 1 };
    connections.set(c.id, c);
    const rate = (key, max, windowMs = 1000) => { const t = Date.now(); const r = c.limits[key] ?? { at: t, n: 0 }; if (t - r.at >= windowMs) { r.at = t; r.n = 0; } c.limits[key] = r; return ++r.n <= max; };
    ws.on('pong', () => { c.alive = true; });
    // Oversized or invalid frames make ws close the connection with an error event; without a listener
    // that error would be thrown and stop the whole server.
    ws.on('error', () => { try { ws.terminate(); } catch { /* already closed */ } });
    ws.on('message', data => {
      if (closing) return;
      // Commands arrive ~30 times a second; everything else is occasional.
      if (!rate('all', 90)) { ws.close(4008, 'Too many requests'); return; }
      const raw = data.toString(); let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      if (raw.length > MAX_MESSAGE && m.t !== 'hello') return;
      try { handle(c, m, rate); } catch (e) { log.warn?.(`Arena message failed: ${e?.message ?? e}`); }
    });
    ws.on('close', () => {
      connections.delete(c.id);
      // The player keeps their place in the match for MATCH.reconnectMs (rejoin with the key).
      if (c.match && c.player) { const m = c.match; if (c.player.conn === c) m.disconnect(c.player); m.flush(); }
    });
  });
  function handle(c, m, rate) {
    if (m.t === 'hello') { if (!c.ready && !c.helloSent && rate('hello', 2, 10000)) { c.helloSent = true; identify(c, m).catch(e => { log.warn?.(`Arena identify failed: ${e?.message ?? e}`); metrics.identifyDegraded++; ready(c, 'accounts-unavailable'); }); } return; }
    if (!c.ready) return;
    const reply = (ref, data) => { if (data?.ok === false && c.deploy) deploys.step(c, 'refused', { reason: String(data.reason ?? '').slice(0, 60) }); send(c, { t: 'reply', ref: Number.isInteger(ref) ? ref : null, ...data }); };
    switch (m.t) {
      case 'c': if (c.match && c.player?.conn === c) c.match.commands(c.player, m.c, typeof m.rt === 'number' ? m.rt : NaN); return;
      case 'ping': if (rate('ping', 4)) send(c, { t: 'pong', n: m.n, at: clock() }); return;
      case 'loaded': if (c.match && c.player?.conn === c && rate('loaded', 2)) { const spawned = c.match.loaded(c.player); deploys.step(c, 'loaded', { spawned }); } return;
      // The client's own measurements of a deployment (stage timings, bytes): aggregated for operators, never stored per player.
      case 'diag': if (rate('diag', 2, 10000)) deploys.report(c, m.d); return;
      case 'streak': if (c.match && c.player && rate('streak', 4)) c.match.useStreak(c.player, str(m.id)); return;
      case 'loadout': {
        if (!rate('loadout', 6, 5000)) return reply(m.ref, { ok: false, reason: 'Wait a moment before changing your loadout again.' });
        const r = validateLoadout(m.loadout, c.level, c.weaponLevels, c.owned);
        if (!r.ok) return reply(m.ref, { ok: false, reason: r.reason, locked: r.locked ?? null });
        c.loadout = r.loadout;
        if (c.match && c.player) c.match.setLoadout(c.player, r.loadout);
        return reply(m.ref, { ok: true, loadout: r.loadout, next: c.match?.state === 'playing' ? 'spawn' : 'now' });
      }
      case 'queue': {
        if (!rate('queue', 4, 5000)) return reply(m.ref, { ok: false, reason: 'Wait a moment.' });
        deploys.begin(c, m.cid, m.t);
        if (!validChoice(str(m.mode), str(m.map) || 'any')) return reply(m.ref, { ok: false, reason: 'Choose a mode and map.' });
        leaveMatch(c);
        return reply(m.ref, quickPlay(c, m.mode, str(m.map) || 'any'));
      }
      case 'private': {
        if (!rate('private', 4, 5000)) return reply(m.ref, { ok: false, reason: 'Wait a moment.' });
        if (m.action !== 'start') deploys.begin(c, m.cid, m.t);
        if (m.action === 'create') {
          const mode = str(m.mode), map = str(m.map);
          if (!MODE_BY_ID.has(mode) || !MAP_BY_ID.has(map)) return reply(m.ref, { ok: false, reason: 'Choose a mode and map.' });
          const size = Number.isInteger(m.size) && m.size >= 1 && m.size <= MATCH.maxPerTeam ? m.size : MATCH.maxPerTeam;
          if (matches.size >= maxMatches) return reply(m.ref, { ok: false, reason: 'Every arena is busy right now.' });
          leaveMatch(c);
          const match = newMatch({ kind: 'private', mode, map, maxPerTeam: size, variant: variantOf(map, m.variant) });
          return reply(m.ref, { ...enter(c, match), code: match.code });
        }
        if (m.action === 'join') {
          const code = str(m.code).toUpperCase().trim(), match = CODE.test(code) ? codes.get(code) : null;
          if (!match || match.closed) return reply(m.ref, { ok: false, reason: 'No open match has that code.' });
          leaveMatch(c);
          return reply(m.ref, enter(c, match));
        }
        if (m.action === 'start') return reply(m.ref, c.match && c.player ? c.match.hostStart(c.player) : { ok: false, reason: 'You are not in a match.' });
        return;
      }
      case 'training': {
        if (!rate('training', 3, 5000)) return reply(m.ref, { ok: false, reason: 'Wait a moment.' });
        deploys.begin(c, m.cid, m.t);
        // 0 bots is the firing range: the player's own loadout and HUD on a real map, nobody shooting back.
        const mode = str(m.mode), map = str(m.map), bots = Number.isInteger(m.bots) ? Math.max(0, Math.min(9, m.bots)) : 5;
        const difficulty = ['easy', 'normal', 'hard'].includes(m.difficulty) ? m.difficulty : 'normal';
        if (!MODE_BY_ID.has(mode) || !MAP_BY_ID.has(map)) return reply(m.ref, { ok: false, reason: 'Choose a mode and map.' });
        if (matches.size >= maxMatches) return reply(m.ref, { ok: false, reason: 'Every arena is busy right now.' });
        leaveMatch(c);
        return reply(m.ref, enter(c, newMatch({ kind: 'training', mode, map, bots, difficulty, maxPerTeam: 5, variant: variantOf(map, m.variant) })));
      }
      case 'rejoin': {
        if (!rate('rejoin', 3, 5000)) return;
        const match = matches.get(str(m.match)), key = str(m.key);
        const p = match && /^[a-f0-9]{36}$/.test(key) ? match.rejoin(key, c) : null;
        deploys.begin(c, m.cid, 'rejoin');
        if (!p) return reply(m.ref, { ok: false, reason: 'That match is no longer running.' });
        // The match holds the player's identity: the account must match the one that joined it.
        if (p.account && p.account !== c.account?.id) { match.disconnect(p); return reply(m.ref, { ok: false, reason: 'Sign in with the account you played with.' }); }
        leaveMatchKeep(c, match); c.match = match; c.player = p; p.conn = c;
        deploys.step(c, 'assigned', { match: match.id, kind: match.kind, state: match.state, held: !p.alive });
        send(c, { t: 'match', match: match.view(), you: { num: p.num, team: p.team, key: p.key }, loadout: p.loadout, rejoined: true });
        match.flush();
        return reply(m.ref, { ok: true });
      }
      case 'leave': leaveMatch(c); return reply(m.ref, { ok: true });
      case 'owned': {
        // Re-read what the account owns (after a purchase confirmed on another server process, or a refund).
        if (!rate('owned', 3, 10000) || !c.account || !accounts.enabled) return reply(m.ref, { ok: !!c.account, owned: c.owned });
        const id = c.account.id;
        accounts.snapshot(id).then(snap => { if (c.account?.id !== id) return; setOwned(id, ownedList(snap?.owned)); reply(m.ref, { ok: true, owned: c.owned }); }, () => reply(m.ref, { ok: false, reason: 'Your purchases could not be checked right now.', owned: c.owned }));
        return;
      }
    }
  }
  function leaveMatchKeep(c, keep) { if (c.match && c.match !== keep) leaveMatch(c); }

  // ---------------------------------------------------------------- Armory entitlements
  /**
   * The room calls these when a verified payment grants a store item, or an operator reverses one. Every
   * arena connection of that account learns at once. A loadout that uses a weapon no longer owned falls
   * back to a free one from the player's next deployment: a purchase or refund never interrupts a life.
   */
  function setOwned(accountId, list) {
    for (const c of connections.values()) {
      if (c.account?.id !== accountId) continue;
      c.owned = list;
      c.loadouts = c.loadouts.filter(l => validateLoadout(l, c.level, c.weaponLevels, c.owned).ok);
      if (!validateLoadout(c.loadout, c.level, c.weaponLevels, c.owned).ok) {
        c.loadout = c.loadouts[0] ?? PRESETS[0];
        if (c.match && c.player) c.match.setLoadout(c.player, c.loadout);
        send(c, { t: 'loadoutReset', loadout: c.loadout });
      }
      send(c, { t: 'owned', owned: c.owned });
    }
  }
  const granted = (accountId, item) => { for (const c of connections.values()) if (c.account?.id === accountId && !c.owned.includes(item)) { setOwned(accountId, ownedList([...c.owned, item])); return; } };
  const revoked = (accountId, item) => { for (const c of connections.values()) if (c.account?.id === accountId) { setOwned(accountId, c.owned.filter(i => i !== item)); return; } };

  const heartbeat = setInterval(() => { for (const c of connections.values()) { if (!c.alive) c.ws.terminate(); else { c.alive = false; c.ws.ping(); } if (!c.ready && !c.helloSent && Date.now() - c.openedAt > 15000) c.ws.close(4000, 'Say hello'); } }, 10000);
  heartbeat.unref?.();
  function status() {
    return { connections: connections.size, capacity, matches: [...matches.values()].map(m => m.summary()), ...metrics, deployments: deploys.summary() };
  }
  async function close() {
    if (closing) return; closing = true; clearInterval(heartbeat);
    for (const m of [...matches.values()]) m.close('shutdown');
    for (const c of connections.values()) c.ws.close(1001, 'Arena restarting; reconnect shortly');
    await new Promise(r => setTimeout(r, 50));
    for (const c of connections.values()) c.ws.terminate();
    await new Promise(r => wss.close(() => r()));
  }
  return { handleUpgrade, status, close, matches, connections, wss, metrics, granted, revoked, deploys };
}

/**
 * Deployment traces: one per request to enter a match, keyed by the client's correlation id (`cid`, random,
 * generated per attempt). Records when the request arrived, when a match was assigned, when the client reported
 * its scene loaded and whether that spawned it. With `enabled`, each finished trace is one JSON log line. The
 * client's own stage timings (`diag`) are kept in a rolling window for percentiles. No names, accounts or
 * addresses are recorded: only the correlation id, a short connection tag, match id and timings.
 */
export function createDeployTraces({ clock = () => Date.now(), log = console, enabled = false, keep = 200 } = {}) {
  const recent = [], client = [], counts = { requests: 0, assigned: 0, refused: 0, loaded: 0, reports: 0 };
  const CID = /^[a-z0-9]{6,24}$/;
  const tag = c => String(c.id).slice(0, 8);
  function begin(c, cid, kind) {
    counts.requests++;
    c.deploy = { cid: typeof cid === 'string' && CID.test(cid) ? cid : null, conn: tag(c), kind, at: clock(), steps: [] };
  }
  function step(c, name, data = {}) {
    const d = c.deploy; if (!d) return;
    if (name in counts) counts[name]++;
    d.steps.push({ s: name, ms: clock() - d.at, ...data });
    if (name === 'refused' || name === 'loaded') { finish(c); }
  }
  function finish(c) {
    const d = c.deploy; if (!d) return; c.deploy = null;
    recent.push(d); if (recent.length > keep) recent.shift();
    if (enabled) log.info?.(JSON.stringify({ evt: 'arena.deploy', ...d }));
  }
  const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 600000 ? Math.round(v) : null);
  function report(c, d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    const stages = {};
    if (d.stages && typeof d.stages === 'object') for (const [k, v] of Object.entries(d.stages).slice(0, 16)) if (/^[a-z-]{2,24}$/.test(k) && num(v) != null) stages[k] = num(v);
    const row = { cid: typeof d.cid === 'string' && CID.test(d.cid) ? d.cid : null, ok: d.ok === true, total: num(d.total), bytes: num(d.bytes / 1000), retries: num(d.retries), tier: d.tier === 'mobile' ? 'mobile' : 'full', failed: typeof d.failed === 'string' ? d.failed.slice(0, 40) : null, stages };
    counts.reports++; client.push(row); if (client.length > keep) client.shift();
    if (enabled) log.info?.(JSON.stringify({ evt: 'arena.deploy.client', conn: tag(c), ...row }));
  }
  const pct = (xs, p) => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] : null; };
  function summary() {
    const ok = client.filter(r => r.ok), totals = ok.map(r => r.total), serverAssign = recent.map(d => d.steps.find(s => s.s === 'assigned')?.ms ?? null);
    const stages = {}; for (const r of ok) for (const [k, v] of Object.entries(r.stages)) (stages[k] ??= []).push(v);
    return { ...counts, samples: ok.length, failures: client.length - ok.length, totalMs: { p50: pct(totals, 50), p95: pct(totals, 95), p99: pct(totals, 99) },
      assignMs: { p50: pct(serverAssign, 50), p95: pct(serverAssign, 95) }, stagesP50: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, pct(v, 50)])), recent: recent.slice(-5) };
  }
  return { begin, step, finish, report, summary, recent, client };
}
