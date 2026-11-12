// One Combat Arena match: an isolated, authoritative simulation with its own players, teams, clock,
// projectiles, objectives and tick loop. Nothing here is shared with any other match or with the
// campus room, so any number of matches run side by side (server/arena/service.mjs creates them).
//
// Authority: clients send input commands only (shared/arena/sim.mjs). This match simulates them,
// decides every shot, hit, elimination, respawn, score, capture and reward, and tells clients what
// happened. Hit registration rewinds other players to the moment the shooter saw (the client's
// interpolation time, capped at MATCH.maxRewindMs), using the same snapshot positions the client drew.

import { randomBytes } from 'node:crypto';
import { createWorld, raycast, rayBox, raySphere, lineOfSight } from '../../shared/arena/physics.mjs';
import { step, spawnState, packState, decodeCommand, hitbox, eyeOf, heightOf, direction, RADIUS, B } from '../../shared/arena/sim.mjs';
import { WEAPON_BY_ID, WEAPON_INDEX, EQUIPMENT_BY_ID, STREAK_BY_ID, STREAKS, QUICK_MELEE, damageAt, TICK_RATE } from '../../shared/arena/weapons.mjs';
import { MATCH, MODE_BY_ID, balanceTeam, matchXp, PRESETS, BOT_PRESETS, autoFireAllowed } from '../../shared/arena/rules.mjs';
import { createBrain } from './bots.mjs';

const cm = v => Math.round(v * 100), mr = v => Math.round(v * 1000);
const EQUIP_INDEX = new Map([...EQUIPMENT_BY_ID.keys()].map((k, i) => [k, i]));
export const FLAG = { alive: 1, crouch: 2, slide: 4, sprint: 8, ads: 16, reload: 32, firing: 64, protected: 128, grounded: 256, switching: 512, bot: 1024 };

/**
 * kind: 'quick' (matchmaking, recorded), 'private' (invite code, not recorded) or 'training' (bots,
 * not recorded). `send(player, object)` and `sendRaw(player, string, transient)` reach a connected player.
 */
export function createMatch({ id, mode: modeId, map, kind = 'quick', code = null, maxPerTeam = MATCH.maxPerTeam, rules = {}, clock = () => Date.now(),
  send, sendRaw, onFinish = () => {}, onClose = () => {}, log = () => {}, bots = 0, difficulty = 'normal', autoTick = true, random = Math.random }) {
  const R = { ...MATCH, ...rules };
  const mode = { ...MODE_BY_ID.get(modeId), ...(rules.mode ?? {}) };
  const world = createWorld(map.boxes, map.bounds);
  const seed = randomBytes(4).readInt32LE(0);
  const players = [];
  let nextNum = 1, state = 'waiting', stateAt = clock(), startedAt = 0, endedAt = 0, result = null, closed = false;
  let tickCount = 0, snapAcc = 1, lastTick = clock(), scoreTickAt = 0, emptySince = null;
  const teamGone = [null, null];
  const scores = [0, 0];
  const objectives = mode.id === 'dom' ? map.objectives.map(o => ({ ...o, owner: -1, progress: 0, capTeam: -1, contested: false })) : [];
  const projectiles = [], smokes = [], supplies = [], strikes = [], reveals = [0, 0];
  const teamStreakCd = [{}, {}];
  let nextProjectile = 1, firstBlood = false;
  const combatLog = [];
  const record = entry => { combatLog.push({ at: clock(), ...entry }); if (combatLog.length > 2000) combatLog.shift(); log(entry); };
  const scoreLimit = typeof mode.scoreLimit === 'function' ? mode.scoreLimit(maxPerTeam) : mode.scoreLimit;
  const humans = () => players.filter(p => !p.bot);
  const connected = () => players.filter(p => !p.bot && p.connected);
  const byNum = n => players.find(p => p.num === n);

  // ---------------------------------------------------------------- messaging
  const queues = new Map();
  function emit(p, ev) { if (p.bot || !p.connected) return; let q = queues.get(p); if (!q) queues.set(p, q = []); q.push(ev); }
  const emitAll = (ev, filter = () => true) => { for (const p of players) if (filter(p)) emit(p, ev); };
  function flush() {
    for (const [p, list] of queues) if (list.length && p.connected) send(p, { t: 'e', l: list });
    queues.clear();
  }
  const describe = p => ({ num: p.num, name: p.name, team: p.team, verified: !!p.account, handle: p.handle ?? null, bot: !!p.bot, connected: p.bot || p.connected, level: p.level ?? 1, emblem: p.emblem ?? 'recruit' });
  const roster = () => players.map(describe);
  const view = () => ({ id, mode: mode.id, map: map.id, kind, code, state, autoFire: autoFireAllowed(kind), maxPerTeam, scoreLimit, timeMs: mode.timeMs, seed, scores: [...scores], players: roster(), objectives: objectives.map(o => ({ id: o.id, x: o.x, z: o.z, r: o.r })) });
  function announceRoster() { emitAll({ k: 'roster', players: roster() }); }

  // ---------------------------------------------------------------- joining, leaving, reconnecting
  /** Add a person (or a bot). Returns the player, or { error } when the match cannot take them. */
  function join(who) {
    if (closed || state === 'ended') return { error: 'This match has ended.' };
    if (!who.bot && players.some(p => !p.bot && who.account && p.account === who.account)) return { error: 'You are already in this match.' };
    const counts = [0, 1].map(t => players.filter(p => p.team === t).length);
    if (counts[0] + counts[1] >= maxPerTeam * 2) return { error: 'This match is full.' };
    if (state === 'playing' && !canJoinInProgress()) return { error: 'This match is nearly over.' };
    const team = balanceTeam(counts, scores);
    const p = {
      id: who.id, num: nextNum++, name: who.name, account: who.account ?? null, handle: who.handle ?? null, level: who.level ?? 1, emblem: who.emblem ?? 'recruit',
      bot: who.bot ?? false, conn: who.conn ?? null, connected: !who.bot, team, key: randomBytes(18).toString('hex'),
      loadout: who.loadout ?? PRESETS[0], pendingLoadout: null, perks: new Set((who.loadout ?? PRESETS[0]).perks),
      sim: null, alive: false, hp: R.maxHealth, respawnAt: 0, diedAt: 0, life: 0, lastSeq: who.lastSeq ?? 0,
      tokens: R.commandBurst, tokensAt: clock(), rt: 0, history: [], damageLog: [], lastDamageAt: 0, protectUntil: 0, blindUntil: 0, firedAt: 0,
      // A gated client (one that reports when its scene has loaded) is loaded only once it says so; others are taken as loaded.
      streak: 0, streakPts: 0, earned: new Set(), streakUsedAt: {}, recentKills: [], lastKiller: null, joinedAt: clock(), leftAt: 0, loaded: !!who.bot || !who.gated, gated: !!who.gated, sceneReady: !!who.bot, held: false, seen: new Map(),
      stats: freshStats(), weaponKills: {},
    };
    players.push(p);
    if (p.bot) p.brain = createBrain({ match: api, player: p, difficulty, random });
    record({ type: 'join', player: p.num, name: p.name, team: p.team, bot: p.bot, account: p.account });
    // Players are in the map at once: before the match starts they can warm up (no damage until it does). Joining a
    // match in progress, a player still loading is held out of combat until their scene is ready (or loadWaitMs).
    if (state === 'playing' && !p.loaded) hold(p); else spawn(p);
    announceRoster();
    lifecycle();
    return p;
  }
  const freshStats = () => ({ kills: 0, deaths: 0, assists: 0, headshots: 0, captures: 0, neutralizes: 0, defends: 0, score: 0, damage: 0, shots: 0, hits: 0, bestStreak: 0, weapons: {} });
  function canJoinInProgress() {
    const elapsed = clock() - startedAt;
    return elapsed < mode.timeMs * R.joinUntil && Math.max(...scores) < scoreLimit * R.joinUntil;
  }
  /** A connection dropped: the player keeps their place for R.reconnectMs. */
  function disconnect(p) {
    if (!p || p.bot || !p.connected) return;
    p.connected = false; p.conn = null; p.leftAt = clock();
    if (p.alive) { p.alive = false; p.respawnAt = Infinity; }
    record({ type: 'disconnect', player: p.num });
    announceRoster(); lifecycle();
  }
  /** The same person comes back with their match key: same team, statistics and place. */
  function rejoin(key, conn) {
    const p = players.find(x => !x.bot && x.key === key);
    if (!p || state === 'ended' || closed) return null;
    p.conn = conn; p.connected = true; p.leftAt = 0; p.tokens = R.commandBurst; p.tokensAt = clock();
    if (!p.alive) { p.respawnAt = clock() + 500; }
    // A gated client reconnecting may have reloaded the page: it reports again when its scene is ready.
    if (p.gated && conn?.caps?.loadgate) { p.loaded = false; p.sceneReady = false; p.joinedAt = clock(); if (!p.alive && state === 'playing') hold(p); }
    record({ type: 'reconnect', player: p.num });
    announceRoster(); lifecycle();
    return p;
  }
  /** Leave for good (returning to campus). */
  function leave(p) {
    const i = players.indexOf(p); if (i < 0) return;
    players.splice(i, 1);
    record({ type: 'leave', player: p.num });
    emitAll({ k: 'left', num: p.num });
    announceRoster(); lifecycle();
  }

  // ---------------------------------------------------------------- lifecycle
  function setState(next) {
    state = next; stateAt = clock();
    emitAll({ k: 'state', state, at: stateAt, countdownMs: next === 'countdown' ? R.countdownMs : 0 });
    record({ type: 'state', state });
  }
  function lifecycle() {
    const now = clock(), present = connected().length;
    if (state === 'waiting') {
      // Training waits for its player's scene to load (or loadWaitMs), so the bots never open fire on a loading screen.
      const enough = kind === 'training' ? connected().some(p => p.sceneReady || now - p.joinedAt >= R.loadWaitMs) : present >= R.minToStart;
      const full = players.length >= maxPerTeam * 2;
      if (kind === 'private') return; // the host starts a private match
      if (enough && (full || kind === 'training' || now - (api.enoughAt ??= now) >= R.fillWaitMs)) setState('countdown');
      else if (!enough) api.enoughAt = null;
    } else if (state === 'countdown') {
      const enough = kind === 'training' ? present >= 1 : present >= (kind === 'private' ? 1 : R.minToStart);
      if (!enough && kind !== 'private') { api.enoughAt = null; setState('waiting'); }
      else if (now - stateAt >= R.countdownMs) begin();
    } else if (state === 'playing') {
      if (now - startedAt >= mode.timeMs) finish(scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1, 'time');
      else if (scores[0] >= scoreLimit || scores[1] >= scoreLimit) finish(scores[0] >= scoreLimit ? 0 : 1, 'score');
      else if (kind !== 'training') {
        for (const t of [0, 1]) {
          const here = players.some(p => p.team === t && !p.bot && p.connected);
          if (here) teamGone[t] = null; else teamGone[t] ??= now;
        }
        if (teamGone[0] !== null && teamGone[1] !== null && now - Math.min(teamGone[0], teamGone[1]) >= R.abandonMs) finish(null, 'abandoned');
        else for (const t of [0, 1]) if (teamGone[t] !== null && teamGone[1 - t] === null && now - teamGone[t] >= R.abandonMs) { finish(1 - t, 'forfeit'); break; }
      }
    }
    if (state !== 'ended' && !connected().length) { emptySince ??= now; if (now - emptySince > (state === 'playing' ? R.abandonMs : 5000)) close('empty'); }
    else emptySince = null;
    // Players who dropped and did not come back in time leave the match.
    for (const p of [...players]) if (!p.bot && !p.connected && p.leftAt && now - p.leftAt > R.reconnectMs) leave(p);
  }
  /** Start: everyone respawns fresh, scores and statistics reset. */
  function begin() {
    startedAt = clock(); scores[0] = scores[1] = 0; firstBlood = false; scoreTickAt = startedAt;
    projectiles.length = smokes.length = supplies.length = strikes.length = 0;
    for (const o of objectives) Object.assign(o, { owner: -1, progress: 0, capTeam: -1, contested: false });
    for (const p of players) {
      p.stats = freshStats(); p.streak = p.streakPts = 0; p.earned.clear(); p.weaponKills = {};
      if (p.bot || (p.connected && p.loaded)) spawn(p); else if (p.connected) hold(p);
      p.joinedAt = startedAt;
    }
    setState('playing');
  }
  function finish(winner, outcome) {
    if (state === 'ended') return;
    endedAt = clock();
    const ended = state === 'playing';
    setState('ended');
    for (const p of players) { p.alive = false; p.respawnAt = Infinity; }
    const rows = players.map(p => {
      const res = winner === null ? 'draw' : p.team === winner ? 'win' : 'loss';
      const completed = ended && (p.bot || p.connected);
      return { num: p.num, name: p.name, team: p.team, bot: !!p.bot, account: p.account, result: res, completed, ...p.stats, xp: matchXp({ ...p.stats, result: res, completed }) };
    });
    result = { id, mode: mode.id, map: map.id, kind, winner, outcome, scores: [...scores], startedAt, endedAt, players: rows };
    record({ type: 'end', winner, outcome, scores: [...scores] });
    emitAll({ k: 'end', result });
    flush();
    onFinish(api, result);
    if (autoTick) later(() => close('finished'), R.resultsMs);
  }
  const timers = new Set();
  function later(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); }
  function close(reason) {
    if (closed) return; closed = true;
    clearInterval(interval); timers.forEach(clearTimeout);
    if (state !== 'ended') { state = 'ended'; }
    record({ type: 'close', reason });
    onClose(api, reason);
  }

  // ---------------------------------------------------------------- spawning
  /** Out of combat until the player's scene has loaded; spawned by loaded(), or by the respawn loop at the cap. */
  function hold(p) {
    p.alive = false; p.held = true; p.respawnAt = Math.max(clock() + 250, p.joinedAt + R.loadWaitMs);
    record({ type: 'hold', player: p.num });
  }
  function spawn(p) {
    if (p.pendingLoadout) { p.loadout = p.pendingLoadout; p.pendingLoadout = null; p.perks = new Set(p.loadout.perks); }
    const at = pickSpawn(p);
    p.sim = spawnState(at, p.loadout, p.perks);
    p.alive = true; p.held = false; p.hp = R.maxHealth; p.life++; p.damageLog = []; p.lastDamageAt = 0;
    p.protectUntil = clock() + R.spawnProtectMs; p.history = []; p.respawnAt = 0;
    p.brain?.reset();
    remember(p, clock());
    emit(p, { k: 'spawn', life: p.life, x: at.x, z: at.z, yaw: at.yaw, loadout: p.loadout });
    record({ type: 'spawn', player: p.num, x: +at.x.toFixed(2), z: +at.z.toFixed(2) });
  }
  /** The safest spawn for p's team: far from living enemies, out of their sight, near teammates. */
  function pickSpawn(p) {
    const held = new Set(objectives.filter(o => o.owner === p.team).map(o => o.id));
    const options = map.spawns.filter(s => s.team === p.team && (!s.forward || (mode.id === 'dom' ? held.size > 0 && nearHeld(s, held) : true)));
    const enemies = players.filter(o => o.team !== p.team && o.alive && o.sim), friends = players.filter(o => o !== p && o.team === p.team && o.alive && o.sim);
    let best = options[0], bestScore = -Infinity;
    for (const s of options) {
      let score = random() * 4;
      let nearest = 80;
      for (const e of enemies) {
        const d = Math.hypot(e.sim.x - s.x, e.sim.z - s.z); nearest = Math.min(nearest, d);
        if (d < 45 && lineOfSight(world, e.sim.x, eyeOf(e.sim), e.sim.z, s.x, 1.5, s.z)) score -= 60;
      }
      score += Math.min(nearest, 40) * 1.5;
      if (s.forward && nearest < 14) score -= 50;
      for (const f of friends) { const d = Math.hypot(f.sim.x - s.x, f.sim.z - s.z); if (d < 1.2) score -= 100; else if (d < 15) score += 3; }
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }
  function nearHeld(s, held) {
    let nearest = null, nd = Infinity;
    for (const o of objectives) { const d = Math.hypot(o.x - s.x, o.z - s.z); if (d < nd) { nd = d; nearest = o; } }
    return nearest && held.has(nearest.id);
  }

  // ---------------------------------------------------------------- lag compensation history
  /** Positions as clients saw them: recorded with every snapshot (and at spawn), kept for one second. */
  function remember(p, at) {
    const s = p.sim; if (!s) return;
    p.history.push({ t: at, x: s.x, y: s.y, z: s.z, h: heightOf(s), alive: p.alive });
    while (p.history.length > 2 && at - p.history[0].t > 1000) p.history.shift();
  }
  /** Where p was at time t (interpolated between snapshots; their live position for times after the last one). */
  function positionAt(p, t, out) {
    const h = p.history, s = p.sim;
    if (!h.length || t >= h[h.length - 1].t) { out.x = s.x; out.y = s.y; out.z = s.z; out.h = heightOf(s); out.alive = p.alive; return out; }
    if (t <= h[0].t) { Object.assign(out, h[0]); return out; }
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (t >= a.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k; out.h = k < .5 ? a.h : b.h; out.alive = a.alive && b.alive;
        return out;
      }
    }
    return Object.assign(out, h[0]);
  }

  // ---------------------------------------------------------------- input commands
  /** Commands from a connected client: [[seq, buttons, mx, mz, yaw, pitch], …], with its render time `rt`. */
  function commands(p, list, rt) {
    if (closed || !Array.isArray(list) || list.length > 12) return;
    const now = clock();
    if (Number.isFinite(rt)) p.rt = rt;
    // Token bucket: at most TICK_RATE commands per second plus a small burst, so a client cannot move
    // or fire faster by sending more commands (speed and fire-rate exploits).
    p.tokens = Math.min(R.commandBurst, p.tokens + (now - p.tokensAt) * TICK_RATE / 1000); p.tokensAt = now;
    for (const raw of list) {
      const cmd = decodeCommand(raw);
      if (!cmd || cmd.seq <= p.lastSeq) continue; // malformed, duplicated or replayed
      if (cmd.seq > p.lastSeq + 600) { p.lastSeq = cmd.seq; continue; } // a gap this large is not a live stream
      p.lastSeq = cmd.seq;
      if (p.tokens < 1) { record({ type: 'throttled', player: p.num }); continue; }
      p.tokens -= 1;
      simulate(p, cmd, now);
    }
    flush();
  }
  function simulate(p, cmd, now) {
    if (state === 'ended' || !p.sim) return;
    if (state === 'countdown') { cmd.b &= B.ADS; cmd.mx = cmd.mz = 0; }
    if (!p.alive) {
      // Trades: shots a player fired before they learned of their own elimination still count.
      if (state === 'playing' && now - p.diedAt <= R.tradeMs && p.respawnAt !== Infinity) {
        const events = step(p.sim, cmd, ctx(p));
        for (const ev of events) if (ev.kind === 'shot') resolveShot(p, ev, now, true);
      }
      return;
    }
    const events = step(p.sim, cmd, ctx(p));
    for (const ev of events) {
      if (ev.kind === 'shot') resolveShot(p, ev, now, false);
      else if (ev.kind === 'melee') resolveMelee(p, ev, now);
      else if (ev.kind === 'throw') throwEquipment(p, ev);
      // `e`: a reload from an empty magazine (others hear the action worked as well).
      else if (ev.kind === 'reload' || ev.kind === 'switch' || ev.kind === 'slide') emitAll({ k: 'act', num: p.num, a: ev.kind, w: ev.weapon ?? null, ...(ev.kind === 'reload' && ev.empty ? { e: 1 } : {}) }, o => o !== p);
    }
    if (supplies.length) touchSupplies(p, now);
  }
  const ctxCache = new WeakMap();
  function ctx(p) { let c = ctxCache.get(p); if (!c) ctxCache.set(p, c = { world, seed, num: p.num, perks: p.perks }); c.perks = p.perks; return c; }

  // ---------------------------------------------------------------- hit registration
  const rewound = { x: 0, y: 0, z: 0, h: 0, alive: false }, rayHit = { t: 0, box: null, normal: [0, 0, 0] };
  function resolveShot(p, ev, now, trade) {
    const w = WEAPON_BY_ID.get(ev.weapon);
    p.stats.shots++; (p.stats.weapons[w.id] ??= { kills: 0, headshots: 0, shots: 0, hits: 0 }).shots++;
    if (!p.perks.has('ghost')) p.firedAt = now;
    if (now < p.protectUntil) p.protectUntil = 0;
    const t = Math.max(now - R.maxRewindMs, Math.min(now, p.rt || now));
    const damage = new Map(), ends = [];
    for (const [dx, dy, dz] of ev.dirs) {
      // The world: the first solid box, or through thin cover for penetrating rounds.
      let wallT = w.range, keep = 1;
      const first = raycast(world, ev.ox, ev.oy, ev.oz, dx, dy, dz, w.range, null, rayHit);
      if (first) {
        wallT = first.t;
        if (first.box?.thin && w.penetration > 0) {
          const thin = first.box, second = raycast(world, ev.ox, ev.oy, ev.oz, dx, dy, dz, w.range, b => b === thin, { t: 0, box: null, normal: [0, 0, 0] });
          wallT = second ? second.t : w.range; keep = w.penetration;
        }
      }
      // Players, where the shooter saw them.
      let hit = null, hitT = wallT, head = false, legs = false;
      for (const o of players) {
        if (o === p || o.team === p.team || !o.sim) continue;
        positionAt(o, t, rewound);
        if (!rewound.alive || !o.alive) continue;
        const hb = hitbox(rewound.x, rewound.y, rewound.z, rewound.h);
        const th = raySphere(ev.ox, ev.oy, ev.oz, dx, dy, dz, hb.hx, hb.hy, hb.hz, hb.hr, hitT);
        const tb = rayBox(ev.ox, ev.oy, ev.oz, dx, dy, dz, hb.x0, hb.y0, hb.z0, hb.x1, hb.y1, hb.z1, hitT);
        if (th >= 0 && (tb < 0 || th <= tb)) { hit = o; hitT = th; head = true; legs = false; }
        else if (tb >= 0) { hit = o; hitT = tb; head = false; legs = ev.oy + dy * tb < hb.legs; }
      }
      // Through-cover hits only count if the player is beyond the thin box.
      const penetrated = first?.box?.thin && hit && hitT > first.t;
      ends.push([cm(ev.ox + dx * hitT), cm(ev.oy + dy * hitT), cm(ev.oz + dz * hitT), hit ? 1 : 0]);
      if (!hit) continue;
      const base = damageAt(w, hitT) * (head ? w.head : legs ? w.legs : 1) * (penetrated ? keep : 1);
      const d = damage.get(hit) ?? { amount: 0, head: false, legs: true, dist: hitT };
      d.amount += base; d.head ||= head; d.legs &&= legs; damage.set(hit, d);
    }
    emitAll({ k: 'shot', num: p.num, w: WEAPON_INDEX.get(w.id), o: [cm(ev.ox), cm(ev.oy), cm(ev.oz)], e: ends.slice(0, 4) }, o => o !== p);
    for (const [o, d] of damage) {
      p.stats.hits++; p.stats.weapons[w.id].hits++;
      hurt(o, Math.round(d.amount), p, { weapon: w.id, head: d.head, legs: d.legs && !d.head, dist: d.dist, trade });
    }
  }
  function resolveMelee(p, ev, now) {
    const w = WEAPON_BY_ID.get(ev.weapon), quick = ev.quick, reach = quick ? QUICK_MELEE.reach : w.reach;
    const f = direction(p.sim.yaw, 0);
    let best = null, bd = Infinity;
    for (const o of players) {
      if (o === p || o.team === p.team || !o.alive || !o.sim) continue;
      const pos = positionAt(o, Math.max(now - R.maxRewindMs, Math.min(now, p.rt || now)), rewound);
      const dx = pos.x - ev.ox, dz = pos.z - ev.oz, d = Math.hypot(dx, dz) - RADIUS;
      if (d > reach || d > bd || Math.abs(pos.y - p.sim.y) > 1.6) continue;
      if (d > .4 && (dx * f[0] + dz * f[2]) / Math.max(1e-6, Math.hypot(dx, dz)) < .6) continue;
      if (!lineOfSight(world, ev.ox, ev.oy, ev.oz, pos.x, pos.y + 1.1, pos.z)) continue;
      best = o; bd = d;
    }
    if (now < p.protectUntil) p.protectUntil = 0;
    emitAll({ k: 'act', num: p.num, a: 'melee', w: w.id }, o => o !== p);
    if (best) hurt(best, quick ? QUICK_MELEE.damage : w.damage[0][1], p, { weapon: quick ? 'melee' : w.id, head: false, dist: bd });
  }

  // ---------------------------------------------------------------- damage and eliminations
  function hurt(o, amount, by, cause) {
    const now = clock();
    if (state !== 'playing' || !o.alive || amount <= 0) return;
    if (o !== by && now < o.protectUntil) return;
    if (o !== by && by && o.team === by.team) return; // no friendly fire
    o.hp -= amount; o.lastDamageAt = now;
    if (by && by !== o) { o.damageLog.push({ from: by, amount, at: now }); by.stats.damage += amount; }
    record({ type: 'damage', from: by?.num ?? null, to: o.num, amount, cause: cause.weapon ?? cause.equipment ?? cause.streak, head: !!cause.head });
    const kill = o.hp <= 0;
    // For sound: where it struck (head, legs) and what it was (a round, a blade or butt, an explosion).
    const c = cause.equipment || cause.streak ? 'x' : cause.weapon === 'melee' || WEAPON_BY_ID.get(cause.weapon)?.fire === 'melee' ? 'm' : 'b';
    if (by && by !== o) emit(by, { k: 'hit', num: o.num, dmg: amount, hs: !!cause.head, kill, ...(cause.legs ? { lg: 1 } : {}), c });
    const from = by?.sim ? [cm(by.sim.x), cm(by.sim.z)] : cause.at ?? null;
    emit(o, { k: 'dmg', dmg: amount, hp: Math.max(0, o.hp), from, ...(cause.head ? { hs: 1 } : {}), ...(cause.legs ? { lg: 1 } : {}), c });
    if (kill) eliminate(o, by, cause);
  }
  function eliminate(v, k, cause) {
    const now = clock();
    v.alive = false; v.hp = 0; v.diedAt = now; v.respawnAt = now + mode.respawnMs;
    v.stats.deaths++; v.streak = 0; v.streakPts = 0;
    remember(v, now);
    const medals = [];
    const killer = k && k !== v ? k : null;
    if (killer) {
      killer.stats.kills++; killer.streak++; killer.stats.bestStreak = Math.max(killer.stats.bestStreak, killer.streak);
      const wid = cause.weapon && WEAPON_BY_ID.has(cause.weapon) ? cause.weapon : null;
      if (wid) killer.stats.weapons[wid].kills++;
      if (cause.head) { killer.stats.headshots++; if (wid) killer.stats.weapons[wid].headshots++; medals.push('headshot'); }
      killer.stats.score += 100 + (cause.head ? 25 : 0);
      if (!firstBlood) { firstBlood = true; medals.push('first'); }
      killer.recentKills = killer.recentKills.filter(t => now - t < 4000); killer.recentKills.push(now);
      if (killer.recentKills.length === 2) medals.push('double'); else if (killer.recentKills.length >= 3) medals.push('triple');
      if (killer.lastKiller === v.num) { medals.push('revenge'); killer.lastKiller = null; }
      if (cause.dist > 40 && WEAPON_BY_ID.get(cause.weapon)?.category !== 'shotgun') medals.push('longshot');
      if (cause.trade) medals.push('payback');
      if (killer.streak === 5) medals.push('streak5'); else if (killer.streak === 10) medals.push('streak10');
      if (mode.id === 'dom' && objectives.some(o => o.owner === killer.team && (inZone(o, v.sim) || inZone(o, killer.sim)))) { killer.stats.defends++; killer.stats.score += 50; medals.push('defend'); }
      if (mode.killPoints) scores[killer.team] += mode.killPoints;
      if (!cause.streak) addStreakPoints(killer, 1);
      v.lastKiller = killer.num;
    }
    // Assists: others who did meaningful damage recently.
    const assisted = new Set();
    for (const d of v.damageLog) {
      if (d.from === killer || now - d.at > R.assistWindowMs || assisted.has(d.from) || !players.includes(d.from)) continue;
      const total = v.damageLog.filter(e => e.from === d.from && now - e.at <= R.assistWindowMs).reduce((a, e) => a + e.amount, 0);
      if (total >= R.assistMinDamage) { assisted.add(d.from); d.from.stats.assists++; d.from.stats.score += 40; emit(d.from, { k: 'medal', id: 'assist' }); }
    }
    emitAll({ k: 'kill', a: killer?.num ?? null, v: v.num, w: cause.weapon ?? cause.equipment ?? cause.streak ?? null, hs: !!cause.head, as: [...assisted].map(a => a.num) });
    if (killer) for (const m of medals) emit(killer, { k: 'medal', id: m });
    emit(v, { k: 'died', by: killer?.num ?? null, respawnMs: mode.respawnMs, w: cause.weapon ?? cause.equipment ?? cause.streak ?? null });
    record({ type: 'elimination', killer: killer?.num ?? null, victim: v.num, cause: cause.weapon ?? cause.equipment ?? cause.streak, head: !!cause.head, medals });
    lifecycle();
  }
  const inZone = (o, s) => s && Math.hypot(s.x - o.x, s.z - o.z) <= o.r && Math.abs(s.y - o.y) < 2.5;

  // ---------------------------------------------------------------- scorestreaks
  const streakCost = (p, s) => Math.max(1, s.cost - (p.perks.has('hardline') ? 1 : 0));
  function addStreakPoints(p, n) {
    p.streakPts += n;
    for (const s of STREAKS) if (p.streakPts >= streakCost(p, s) && p.streakPts - n < streakCost(p, s) && !p.earned.has(s.id) && s.unlock <= (p.level ?? 1)) {
      p.earned.add(s.id); emit(p, { k: 'earned', id: s.id }); record({ type: 'streak-earned', player: p.num, streak: s.id });
    }
  }
  /** Use an earned reward. Validated here: earned, alive, match running, team cooldown. */
  function useStreak(p, idValue) {
    const s = STREAK_BY_ID.get(idValue), now = clock();
    const fail = reason => { emit(p, { k: 'streakResult', id: idValue, ok: false, reason }); flush(); return false; };
    if (!s) return fail('Unknown reward.');
    if (state !== 'playing') return fail('The match is not running.');
    if (!p.alive) return fail('You can use rewards while alive.');
    if (!p.earned.has(s.id)) return fail(`Earn ${s.name} first.`);
    const cd = teamStreakCd[p.team][s.id] ?? 0;
    if (now < cd) return fail(`${s.name} is recharging for your team (${Math.ceil((cd - now) / 1000)} s).`);
    p.earned.delete(s.id); teamStreakCd[p.team][s.id] = now + s.cooldownMs;
    if (s.id === 'recon') { reveals[p.team] = now + s.durationMs; emitAll({ k: 'recon', team: p.team, until: s.durationMs, by: p.num }); }
    if (s.id === 'supply') {
      const crate = { id: nextProjectile++, team: p.team, x: p.sim.x, y: p.sim.y, z: p.sim.z, until: now + s.durationMs, used: new Set() };
      supplies.push(crate); emitAll({ k: 'supply', id: crate.id, team: p.team, x: cm(crate.x), y: cm(crate.y), z: cm(crate.z), ms: s.durationMs, by: p.num });
      touchSupplies(p, now);
    }
    if (s.id === 'strike') {
      const d = direction(p.sim.yaw + p.sim.ry, p.sim.pitch + p.sim.rp);
      const hit = raycast(world, p.sim.x, eyeOf(p.sim), p.sim.z, d[0], d[1], d[2], s.range, null, { t: 0, box: null, normal: [0, 0, 0] });
      const t = hit ? hit.t : Math.min(s.range, 30);
      const x = p.sim.x + d[0] * t, z = p.sim.z + d[2] * t, y = hit ? eyeOf(p.sim) + d[1] * t : 0;
      strikes.push({ owner: p, team: p.team, x, y: Math.max(0, y), z, at: now + s.delayMs });
      emitAll({ k: 'strike', team: p.team, x: cm(x), y: cm(Math.max(0, y)), z: cm(z), ms: s.delayMs, r: s.radius, by: p.num });
    }
    emit(p, { k: 'streakResult', id: s.id, ok: true });
    record({ type: 'streak-used', player: p.num, streak: s.id });
    flush();
    return true;
  }
  function touchSupplies(p, now) {
    for (const c of supplies) {
      if (c.team !== p.team || c.used.has(p.num) || now > c.until || !p.alive) continue;
      if (Math.hypot(p.sim.x - c.x, p.sim.z - c.z) > 1.8 || Math.abs(p.sim.y - c.y) > 1.5) continue;
      c.used.add(p.num);
      const extra = p.perks.has('pockets') ? 1 : 0;
      for (const slot of p.sim.wpn) { const w = WEAPON_BY_ID.get(slot.id); if (w.mag) { slot.mag = w.mag; slot.reserve = w.reserve + w.mag * extra; } }
      const le = EQUIPMENT_BY_ID.get(p.loadout.lethal), ta = EQUIPMENT_BY_ID.get(p.loadout.tactical);
      p.sim.lethal = (le?.count ?? 0) + extra; p.sim.tactical = ta?.count ?? 0;
      p.hp = R.maxHealth;
      emit(p, { k: 'resupplied' });
    }
  }

  // ---------------------------------------------------------------- equipment
  function throwEquipment(p, ev) {
    const id = ev.slot === 'lethal' ? p.loadout.lethal : p.loadout.tactical, e = EQUIPMENT_BY_ID.get(id);
    if (!e) return;
    const d = direction(ev.yaw, Math.min(1.2, ev.pitch + .12));
    projectiles.push({ id: nextProjectile++, e, owner: p, team: p.team, x: ev.ox + d[0] * .5, y: ev.oy - .1 + d[1] * .5, z: ev.oz + d[2] * .5,
      vx: d[0] * e.speed + p.sim.vx * .5, vy: d[1] * e.speed + 2, vz: d[2] * e.speed + p.sim.vz * .5, fuse: e.fuse / TICK_RATE * 1000, stuck: false });
    record({ type: 'throw', player: p.num, item: e.id });
  }
  const pHit = { t: 0, box: null, normal: [0, 0, 0] };
  function stepProjectiles(dt, now) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const g = projectiles[i];
      if (!g.stuck) {
        g.vy -= 19.6 * dt;
        const len = Math.hypot(g.vx, g.vy, g.vz) * dt;
        if (len > 0) {
          const dx = g.vx * dt / len, dy = g.vy * dt / len, dz = g.vz * dt / len;
          const hit = raycast(world, g.x, g.y, g.z, dx, dy, dz, len + .08, null, pHit);
          if (hit) {
            g.x += dx * Math.max(0, hit.t - .08); g.y += dy * Math.max(0, hit.t - .08); g.z += dz * Math.max(0, hit.t - .08);
            if (g.e.stick) { g.stuck = true; g.vx = g.vy = g.vz = 0; }
            else {
              const [nx, ny, nz] = hit.normal, dot = g.vx * nx + g.vy * ny + g.vz * nz;
              g.vx = (g.vx - 2 * dot * nx) * g.e.bounce; g.vy = (g.vy - 2 * dot * ny) * g.e.bounce; g.vz = (g.vz - 2 * dot * nz) * g.e.bounce;
              if (Math.hypot(g.vx, g.vy, g.vz) < .6) { g.vx = g.vy = g.vz = 0; g.stuck = true; }
            }
          } else { g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt; }
        }
        g.y = Math.max(.05, g.y);
      }
      g.fuse -= dt * 1000;
      if (g.fuse <= 0) { projectiles.splice(i, 1); detonate(g, now); }
    }
    for (let i = smokes.length - 1; i >= 0; i--) if (now > smokes[i].until) smokes.splice(i, 1);
    for (let i = supplies.length - 1; i >= 0; i--) if (now > supplies[i].until) supplies.splice(i, 1);
    for (let i = strikes.length - 1; i >= 0; i--) if (now >= strikes[i].at) { const s = strikes.splice(i, 1)[0]; explode(s.owner, s.x, s.y + .3, s.z, STREAK_BY_ID.get('strike'), { streak: 'strike' }); }
  }
  function detonate(g, now) {
    const e = g.e;
    if (e.id === 'smoke') { smokes.push({ x: g.x, y: g.y + 1, z: g.z, r: e.radius, until: now + e.durationMs }); emitAll({ k: 'smoke', x: cm(g.x), y: cm(g.y), z: cm(g.z), r: e.radius, ms: e.durationMs }); return; }
    if (e.id === 'flash') {
      emitAll({ k: 'flashbang', x: cm(g.x), y: cm(g.y), z: cm(g.z) });
      for (const o of players) {
        if (!o.alive || !o.sim || (o.team === g.team && o !== g.owner)) continue;
        const ex = o.sim.x, ey = eyeOf(o.sim), ez = o.sim.z, dx = g.x - ex, dy = g.y - ey, dz = g.z - ez, d = Math.hypot(dx, dy, dz);
        if (d > e.radius || !lineOfSight(world, ex, ey, ez, g.x, g.y + .1, g.z)) continue;
        const f = direction(o.sim.yaw, o.sim.pitch), facing = (dx * f[0] + dy * f[1] + dz * f[2]) / Math.max(d, 1e-6);
        const ms = Math.round(e.blindMs * (1 - d / e.radius * .5) * (facing > .3 ? 1 : .35));
        o.blindUntil = now + ms; emit(o, { k: 'blind', ms });
        if (g.owner && g.owner !== o) emit(g.owner, { k: 'hit', num: o.num, dmg: 0, hs: false, kill: false, flash: true });
      }
      return;
    }
    explode(g.owner, g.x, g.y, g.z, e, { equipment: e.id });
  }
  function explode(owner, x, y, z, e, cause) {
    emitAll({ k: 'boom', x: cm(x), y: cm(y), z: cm(z), r: e.radius, kind: cause.equipment ?? cause.streak });
    for (const o of players) {
      if (!o.alive || !o.sim) continue;
      if (owner && o !== owner && o.team === owner.team) continue;
      const d = Math.hypot(o.sim.x - x, o.sim.y + .9 - y, o.sim.z - z);
      if (d > e.radius) continue;
      if (!lineOfSight(world, x, y + .2, z, o.sim.x, o.sim.y + .9, o.sim.z) && !lineOfSight(world, x, y + .2, z, o.sim.x, eyeOf(o.sim), o.sim.z)) continue;
      let dmg = e.damage - (e.damage - e.minDamage) * (d / e.radius);
      if (o === owner) dmg *= .5;
      hurt(o, Math.round(dmg), owner && players.includes(owner) ? owner : null, { ...cause, dist: d, at: [cm(x), cm(z)] });
    }
  }
  /** Does any active smoke cloud block the line between two points? (Bots cannot see through smoke.) */
  function smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of smokes) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1;
      if (raySphere(ax, ay, az, dx / len, dy / len, dz / len, s.x, s.y, s.z, s.r, len) >= 0) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- objectives (Domination)
  function stepObjectives(dt, now) {
    for (const o of objectives) {
      const n = [0, 0];
      for (const p of players) if (p.alive && inZone(o, p.sim)) n[p.team]++;
      o.contested = n[0] > 0 && n[1] > 0;
      if (o.contested) continue;
      const t = n[0] ? 0 : n[1] ? 1 : -1;
      if (t === -1) { if (o.capTeam !== -1) { o.progress -= dt * 1000 / mode.captureMs * .5; if (o.progress <= 0) { o.progress = 0; o.capTeam = -1; } } continue; }
      if (o.owner === t) { o.progress = Math.max(0, o.progress - dt * 1000 / mode.captureMs); if (!o.progress) o.capTeam = -1; continue; }
      const rate = dt * 1000 * Math.min(3, n[t]) / mode.captureMs;
      if (o.capTeam !== t && o.capTeam !== -1) { o.progress -= rate; if (o.progress <= 0) { o.progress = 0; o.capTeam = t; } continue; }
      o.capTeam = t;
      const before = o.progress; o.progress = Math.min(1, o.progress + rate);
      if (o.owner === 1 - t && before < .5 && o.progress >= .5) {
        o.owner = -1;
        for (const p of players) if (p.alive && p.team === t && inZone(o, p.sim)) { p.stats.neutralizes++; p.stats.score += 60; }
        emitAll({ k: 'neutral', id: o.id, team: t }); record({ type: 'neutralize', objective: o.id, team: t });
      }
      if (o.progress >= 1) {
        o.owner = t; o.progress = 0; o.capTeam = -1;
        const by = [];
        for (const p of players) if (p.alive && p.team === t && inZone(o, p.sim)) { p.stats.captures++; p.stats.score += 150; addStreakPoints(p, 1); emit(p, { k: 'medal', id: 'capture' }); by.push(p.num); }
        emitAll({ k: 'capture', id: o.id, team: t, by }); record({ type: 'capture', objective: o.id, team: t, by });
      }
    }
    if (now - scoreTickAt >= mode.tickMs) {
      scoreTickAt += mode.tickMs;
      for (const o of objectives) if (o.owner >= 0) scores[o.owner]++;
    }
  }

  // ---------------------------------------------------------------- the tick
  function tick() {
    if (closed) return;
    const now = clock(), dt = Math.min(.1, (now - lastTick) / 1000); lastTick = now; tickCount++;
    // Bots: the same commands a player's client would send, at the simulation rate.
    const steps = Math.max(1, Math.round(dt * TICK_RATE));
    for (const p of players) if (p.bot && p.alive && p.sim) for (let i = 0; i < steps; i++) { const c = p.brain.think(now); if (c) { p.lastSeq = c.seq; simulate(p, c, now); } }
    for (const p of players) {
      if (!p.alive && p.respawnAt && now >= p.respawnAt && state !== 'ended' && (p.bot || p.connected)) { balance(p); spawn(p); }
      // Health recovers after a pause without damage.
      if (p.alive && state === 'playing' && p.hp < R.maxHealth && now - p.lastDamageAt >= (p.perks.has('mend') ? R.regenMendMs : R.regenDelayMs)) p.hp = Math.min(R.maxHealth, p.hp + R.regenPerSecond * dt);
      if (p.alive && p.sim && p.sim.y < -5) hurt(p, 1000, p, { equipment: 'fall' });
    }
    if (state === 'playing') { stepProjectiles(dt, now); if (mode.id === 'dom') stepObjectives(dt, now); }
    // Scoreboard statistics once a second (eliminations, deaths, assists, score, objective play).
    if (tickCount % R.tickHz === 0) emitAll({ k: 'board', rows: players.map(p => [p.num, p.stats.kills, p.stats.deaths, p.stats.assists, p.stats.score, p.stats.captures + p.stats.defends]) });
    snapAcc += R.snapshotHz / R.tickHz;
    // Events first: a snapshot must never overtake the spawn or elimination it reflects.
    if (snapAcc >= 1) { snapAcc -= 1; flush(); snapshot(now); }
    lifecycle();
    flush();
  }
  /** Move a waiting-to-respawn player to the smaller team when teams are uneven by two or more. */
  function balance(p) {
    if (kind === 'training') return;
    const counts = [0, 1].map(t => players.filter(o => o.team === t && (o.bot || o.connected)).length);
    if (counts[p.team] - counts[1 - p.team] >= 2) {
      p.team = 1 - p.team; emit(p, { k: 'balanced', team: p.team }); announceRoster(); record({ type: 'balance', player: p.num, team: p.team });
    }
  }

  // ---------------------------------------------------------------- snapshots
  function flags(p, now) {
    const s = p.sim; if (!s) return 0;
    return (p.alive ? FLAG.alive : 0) | (s.stance === 1 ? FLAG.crouch : 0) | (s.stance === 2 ? FLAG.slide : 0) | (s.sprint ? FLAG.sprint : 0) | (s.ads > .5 ? FLAG.ads : 0) |
      (s.phase === 'reload' ? FLAG.reload : 0) | (now - p.firedAt < 200 ? FLAG.firing : 0) | (now < p.protectUntil ? FLAG.protected : 0) | (s.grounded ? FLAG.grounded : 0) | (s.phase === 'switch' ? FLAG.switching : 0) | (p.bot ? FLAG.bot : 0);
  }
  /**
   * Interest management: an enemy is sent to a player only if they could plausibly see or hear them
   * (line of sight, close by, or recently visible), so a modified client cannot reveal enemies behind
   * walls, and fewer bytes go to each phone. Teammates are always sent.
   */
  function relevant(r, o, now) {
    if (r.team === o.team || !r.sim || !o.sim) return true;
    if (!o.alive) return false;
    const ex = r.sim.x, ey = eyeOf(r.sim), ez = r.sim.z, d = Math.hypot(o.sim.x - ex, o.sim.z - ez);
    let seen = d < 14 || state !== 'playing';
    if (!seen) for (const h of [heightOf(o.sim) - .15, heightOf(o.sim) * .5]) if (lineOfSight(world, ex, ey, ez, o.sim.x, o.sim.y + h, o.sim.z)) { seen = true; break; }
    if (!seen) for (const [ox, oz] of [[.6, 0], [-.6, 0], [0, .6], [0, -.6]]) if (lineOfSight(world, ex, ey, ez, o.sim.x + ox, o.sim.y + 1.2, o.sim.z + oz)) { seen = true; break; }
    if (seen) { r.seen.set(o.num, now); return true; }
    return now - (r.seen.get(o.num) ?? -1e9) < 600;
  }
  function snapshot(now) {
    for (const p of players) if (p.alive) remember(p, now);
    const timeLeft = state === 'playing' ? Math.max(0, mode.timeMs - (now - startedAt)) : state === 'countdown' ? Math.max(0, R.countdownMs - (now - stateAt)) : 0;
    const obj = objectives.map(o => [o.owner, Math.round(o.progress * 100), o.capTeam, o.contested ? 1 : 0]);
    const grenades = projectiles.map(g => [g.id, EQUIP_INDEX.get(g.e.id), cm(g.x), cm(g.y), cm(g.z)]);
    const entries = new Map(players.filter(p => p.sim).map(p => [p, [p.num, cm(p.sim.x), cm(p.sim.y), cm(p.sim.z), mr(p.sim.yaw), mr(p.sim.pitch + p.sim.rp), flags(p, now), WEAPON_INDEX.get(p.sim.wpn[p.sim.slot].id), Math.round(p.hp)]]));
    for (const r of players) {
      if (r.bot || !r.connected) continue;
      const list = [], radar = [];
      for (const [o, e] of entries) {
        if (o === r) continue;
        if (relevant(r, o, now)) list.push(o.team === r.team ? e : [...e.slice(0, 8), -1]);
        else if (o.alive && (reveals[r.team] > now && !o.perks.has('ghost') || now - o.firedAt < 1500)) radar.push([o.num, cm(o.sim.x), cm(o.sim.z)]);
      }
      // Revealed enemies that are also visible appear on the radar too.
      if (reveals[r.team] > now) for (const [o] of entries) if (o.team !== r.team && o.alive && !o.perks.has('ghost') && !radar.some(x => x[0] === o.num)) radar.push([o.num, cm(o.sim.x), cm(o.sim.z)]);
      const me = r.sim ? { ack: r.lastSeq, life: r.life, s: packState(r.sim), hp: Math.round(r.hp), alive: r.alive, respawn: r.alive ? 0 : Math.max(0, r.respawnAt === Infinity ? 0 : r.respawnAt - now), earned: [...r.earned], pts: r.streakPts, streak: r.streak } : null;
      const msg = { t: 's', at: now, st: state, tl: timeLeft, sc: scores, me, p: list, o: obj, g: grenades, r: radar };
      sendRaw(r, JSON.stringify(msg), true);
    }
  }

  // ---------------------------------------------------------------- private match control
  function hostStart(p) {
    if (kind !== 'private' || state !== 'waiting') return { ok: false, reason: 'This match has already started.' };
    if (players[0] !== p) return { ok: false, reason: 'Only the host can start the match.' };
    if (connected().length < 2) return { ok: false, reason: 'Wait for at least one more player.' };
    setState('countdown'); return { ok: true };
  }
  /** The client has its scene drawn and can play. */
  /** The player's scene is ready. Returns true when that brought them into the match now. */
  function loaded(p) {
    if (!p || p.bot) return false;
    p.sceneReady = true; p.loaded = true;
    if (p.held && p.connected && state !== 'ended' && !closed) { balance(p); spawn(p); lifecycle(); flush(); return true; }
    lifecycle();
    return false;
  }
  function setLoadout(p, loadout) { p.pendingLoadout = loadout; if (state !== 'playing' && p.alive) spawn(p); }

  const interval = autoTick ? setInterval(tick, 1000 / R.tickHz) : null;
  const api = {
    id, kind, code, map, mode, world, players, objectives, scores, seed, rules: R,
    get state() { return state; }, get result() { return result; }, get closed() { return closed; }, get startedAt() { return startedAt; },
    get combatLog() { return combatLog; }, enoughAt: null,
    join, leave, disconnect, rejoin, commands, useStreak, hostStart, setLoadout, loaded, view, roster, tick, close, finish, flush, smokeBlocks, byNum,
    humans, connected, summary: () => ({ id, kind, mode: mode.id, map: map.id, state, players: humans().length, connected: connected().length, bots: players.filter(p => p.bot).length, scores: [...scores], startedAt }),
  };
  for (let i = 0; i < bots; i++) join({ id: `bot-${i + 1}`, name: `SIM-Unit ${String(i + 1).padStart(2, '0')}`, bot: true, loadout: BOT_PRESETS[Math.floor(random() * BOT_PRESETS.length)] });
  return api;
}
