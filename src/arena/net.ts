// Combat Arena connection: the /arena WebSocket, local prediction with server reconciliation, remote
// player interpolation and match events.
//
// Prediction: every 60 Hz tick the client builds an input command, simulates it immediately with the
// shared simulation (shared/arena/sim.mjs) and sends it. Each snapshot carries the server's state for
// this player and the last command it applied (`ack`); the client takes that state, replays the
// commands the server has not applied yet, and smooths any small visual difference away. Remote
// players are drawn ~100 ms in the past, interpolated between snapshots, and every batch of commands
// says which moment that is (`rt`) so the server can check shots against what the player saw.
import { createWorld, raycast } from '../../shared/arena/physics.mjs';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { step, spawnState, unpackState, quantize, encodeCommand, DT, B, eyeOf, weaponOf, spreadOf, direction } from '../../shared/arena/sim.mjs';
import { WEAPONS, WEAPON_BY_ID, STREAK_BY_ID } from '../../shared/arena/weapons.mjs';
import { MEDALS, MODE_BY_ID } from '../../shared/arena/rules.mjs';
import { createPlayback, createTrack } from '../network/interpolation.mjs';
import { accountAccess } from '../network/client';
import { useGame } from '../state';
import { useArena, useBanners, emptyHud, inputPaused, type Loadout, type MatchView, type Progress } from './store';
import { autoFireDecision } from '../../shared/arena/autofire.mjs';
import { syncFromAccount } from './hudLayout';
import { controls, buttons, axes } from './input';
import { sfx } from './audio';
import { QA_HOOKS } from '../qa';

type Sim = ReturnType<typeof spawnState>;
type Cmd = { seq: number; b: number; mx: number; mz: number; yaw: number; pitch: number };
export type Remote = { num: number; team: number; track: ReturnType<typeof createTrack>; pitch: number; flags: number; weapon: number; hp: number; seenAt: number; deadAt: number; pos: { x: number; y: number; z: number; yaw: number }; stepAt: number };
export type Fx =
  | { type: 'tracer'; from: number[]; to: number[]; local: boolean }
  | { type: 'impact'; at: number[]; normal: number[]; flesh: boolean; mat?: string }
  | { type: 'capture'; id: string; team: number }
  | { type: 'muzzle'; num: number }
  | { type: 'boom'; at: number[]; r: number }
  | { type: 'smoke'; at: number[]; r: number; ms: number }
  | { type: 'flash'; at: number[] }
  | { type: 'death'; num: number }
  | { type: 'shot'; weapon: string }
  | { type: 'land'; speed: number } | { type: 'jump' };

/** Everything that changes every frame, outside React. */
export const live = {
  sim: null as Sim | null, ctx: null as { world: ReturnType<typeof createWorld>; seed: number; num: number; perks: Set<string> } | null,
  world: null as ReturnType<typeof createWorld> | null, mapId: '', alive: false, life: 0, num: 0, team: 0,
  pending: [] as Cmd[], outgoing: [] as number[][], seq: 0, acc: 0, lastSend: 0,
  smooth: { x: 0, y: 0, z: 0 }, prev: { x: 0, y: 0, z: 0 }, remotes: new Map<number, Remote>(), playback: createPlayback(100),
  grenades: new Map<number, { kind: number; x: number; y: number; z: number; at: number }>(),
  smokes: [] as { x: number; y: number; z: number; r: number; until: number }[],
  supplies: [] as { id: number; team: number; x: number; y: number; z: number; until: number }[],
  strikes: [] as { x: number; y: number; z: number; r: number; at: number; team: number }[],
  radar: [] as number[][], reconUntil: 0, enemyReconUntil: 0,
  hit: { at: 0, kill: false, head: false }, damage: [] as { angle: number; at: number }[], hurtAt: 0, blindUntil: 0, blindMs: 0,
  kick: 0, shake: 0, firedAt: 0, reloadStart: 0, reloadTotal: 0, rtt: 0, loadout: null as Loadout | null, perks: new Set<string>(),
  /** Auto-fire is holding the trigger this tick (and why not, for the QA hooks). */
  autoFiring: false, autoReason: '',
};
const fxListeners = new Set<(f: Fx) => void>();
export function onFx(fn: (f: Fx) => void) { fxListeners.add(fn); return () => { fxListeners.delete(fn); }; }
const fx = (f: Fx) => { for (const l of fxListeners) l(f); };
const banner = useBanners.getState().push;

let socket: WebSocket | null = null, stopped = true, retry = 0, retryTimer: ReturnType<typeof setTimeout> | undefined, pingTimer: ReturnType<typeof setInterval> | undefined;
let ref = 0;
const replies = new Map<number, (m: Record<string, unknown>) => void>();
const REJOIN = 'campos-arena-rejoin';

function url() {
  const explicit = import.meta.env.VITE_ARENA_URL as string | undefined;
  if (explicit) return explicit;
  const ws = import.meta.env.VITE_WS_URL as string | undefined;
  if (ws) return ws.replace(/\/ws$/, '/arena');
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/arena`;
}
function raw(data: unknown) { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(data)); return true; } return false; }
/** Send a request and wait for its reply. */
export function request(data: Record<string, unknown>, timeout = 8000): Promise<Record<string, unknown>> {
  const id = ++ref;
  return new Promise(resolve => {
    if (!raw({ ...data, ref: id })) { resolve({ ok: false, reason: 'You are not connected to the arena.' }); return; }
    const t = setTimeout(() => { replies.delete(id); resolve({ ok: false, reason: 'The arena did not answer. Check your connection.' }); }, timeout);
    replies.set(id, m => { clearTimeout(t); resolve(m); });
  });
}

export function connect() {
  stopped = false; clearTimeout(retryTimer);
  if (socket && socket.readyState < 2) return;
  const a = useArena.getState(); a.set({ status: 'connecting', error: '' });
  let ws: WebSocket;
  try { ws = new WebSocket(url()); } catch { a.set({ status: 'offline', error: 'The arena connection could not start.' }); return; }
  socket = ws;
  ws.onopen = async () => {
    if (socket !== ws) return;
    const access = await accountAccess().catch(() => null);
    if (socket !== ws) return;
    const g = useGame.getState();
    ws.send(JSON.stringify({ t: 'hello', name: g.name, avatar: g.avatar, ...(access ? { access } : {}) }));
  };
  ws.onmessage = e => { if (socket !== ws) return; let m; try { m = JSON.parse(e.data); } catch { return; } receive(m); };
  ws.onclose = e => {
    if (socket !== ws) return;
    socket = null; clearInterval(pingTimer);
    const s = useArena.getState();
    if (e.code === 4004) { s.set({ status: 'replaced', error: 'Combat Arena opened in another window.' }); return; }
    s.set({ status: 'offline' });
    if (stopped) return;
    if (s.phase === 'match') banner({ text: 'Connection lost', sub: 'Reconnecting… your place is kept for a minute.', tone: 'bad', ms: 3000 });
    retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
  ws.onerror = () => {};
}
export function disconnect() {
  stopped = true; clearTimeout(retryTimer); clearInterval(pingTimer);
  if (socket) { raw({ t: 'leave' }); socket.close(); socket = null; }
  resetMatch(); useArena.getState().set({ status: 'idle' });
}
export function pendingRejoin(): { match: string; key: string } | null {
  try { const v = JSON.parse(sessionStorage.getItem(REJOIN) ?? 'null'); return v && Date.now() - v.at < 55000 ? v : null; } catch { return null; }
}
function saveRejoin(match: string | null, key = '') { try { if (match) sessionStorage.setItem(REJOIN, JSON.stringify({ match, key, at: Date.now() })); else sessionStorage.removeItem(REJOIN); } catch { /* storage denied */ } }

function resetMatch() {
  Object.assign(live, { sim: null, ctx: null, alive: false, life: 0, num: 0, pending: [], outgoing: [], acc: 0, radar: [], reconUntil: 0, enemyReconUntil: 0, blindUntil: 0 });
  live.remotes.clear(); live.grenades.clear(); live.smokes = []; live.supplies = []; live.strikes = []; live.playback.reset();
  useArena.getState().set({ match: null, you: null, feed: [], board: {}, hud: emptyHud(), killedBy: null, scoreboard: false });
}

// ---------------------------------------------------------------- incoming
function receive(m: Record<string, any>) {
  const a = useArena.getState();
  switch (m.t) {
    case 'ready': {
      retry = 0;
      a.set({ status: 'ready', me: { name: m.name, verified: m.verified, handle: m.handle, level: m.level, xp: m.xp, emblem: m.emblem, weaponLevels: m.weaponLevels ?? {} }, online: m.online, owned: Array.isArray(m.owned) ? m.owned : [] });
      if (m.verified) void syncFromAccount();
      if (m.verified && Array.isArray(m.loadouts) && m.loadouts.length) a.set({ loadouts: m.loadouts, loadout: m.loadout });
      else raw({ t: 'loadout', loadout: a.loadout, ref: ++ref });
      clearInterval(pingTimer); pingTimer = setInterval(() => raw({ t: 'ping', n: performance.now() }), 2000);
      // Back after a dropped connection (or a reload) during a match: take our place again.
      const back = a.match ? { match: a.match.id, key: a.you!.key } : pendingRejoin();
      if (back) void request({ t: 'rejoin', ...back }).then(r => { if (!r.ok) { saveRejoin(null); if (useArena.getState().phase === 'match') { resetMatch(); useArena.getState().set({ phase: 'lobby', error: String(r.reason ?? '') }); } } else banner({ text: 'Reconnected', tone: 'good', ms: 1800 }); });
      return;
    }
    case 'reply': { const r = replies.get(m.ref); if (r) { replies.delete(m.ref); r(m); } return; }
    case 'replaced': a.set({ status: 'replaced', error: 'Combat Arena opened in another window.' }); stopped = true; return;
    case 'pong': live.rtt = performance.now() - m.n; return;
    // What the account owns changed (a purchase was confirmed, or reversed).
    case 'owned': a.set({ owned: Array.isArray(m.owned) ? m.owned : [] }); return;
    case 'loadoutReset': {
      a.set({ loadout: m.loadout, loadouts: a.loadouts.map(l => (JSON.stringify(l) === JSON.stringify(a.loadout) ? m.loadout : l)) });
      banner({ text: 'Loadout changed', sub: 'A weapon in it is no longer yours; a free loadout is used from your next deployment.', tone: 'info', ms: 4200 });
      return;
    }
    case 'match': return enterMatch(m.match, m.you, m.loadout, !!m.rejoined);
    case 's': return snapshot(m);
    case 'e': for (const ev of m.l) event(ev); return;
    case 'record': a.set({ record: { state: m.state, reason: m.reason ?? null } }); return;
    case 'progress': {
      a.set({ progress: m as unknown as Progress, record: { state: 'saved', reason: null } });
      if (a.me) a.set({ me: { ...a.me, level: m.level, xp: m.total_xp } });
      return;
    }
  }
}

function enterMatch(view: MatchView, you: { num: number; team: number; key: string }, loadout: Loadout, rejoined: boolean) {
  const a = useArena.getState();
  if (!rejoined || a.match?.id !== view.id) { resetMatch(); a.set({ result: null, progress: null, record: null }); }
  const map = MAP_BY_ID.get(view.map)!;
  live.world = createWorld(map.boxes, map.bounds); live.mapId = view.map; live.num = you.num; live.team = you.team;
  live.loadout = loadout; live.perks = new Set(loadout.perks);
  live.ctx = { world: live.world, seed: view.seed, num: you.num, perks: live.perks };
  // Commands continue from the server's count after a reconnect.
  live.pending = []; live.outgoing = [];
  a.set({ phase: 'match', match: view, you, loadout, menu: false, editor: false });
  saveRejoin(view.id, you.key);
  if (!rejoined) {
    const mode = MODE_BY_ID.get(view.mode);
    banner({ text: mode?.name ?? 'Match', sub: view.kind === 'training' ? 'Training · bots are labelled SIM' : view.kind === 'private' ? `Private match · code ${view.code}` : `${map.name} · ${view.state === 'playing' ? 'joining in progress' : 'waiting for players'}`, tone: 'big', ms: 3500 });
  }
}

function snapshot(m: Record<string, any>) {
  const now = performance.now(), a = useArena.getState();
  live.playback.receive(m.at, now);
  // ---- remote players
  const seen = new Set<number>();
  for (const e of m.p as number[][]) {
    const [num, x, y, z, yaw, pitch, flags, weapon, hp] = e;
    seen.add(num);
    let r = live.remotes.get(num);
    if (!r) { r = { num, team: teamOf(num), track: createTrack(10), pitch: 0, flags, weapon, hp, seenAt: now, deadAt: 0, pos: { x: x / 100, y: y / 100, z: z / 100, yaw: yaw / 1000 }, stepAt: 0 }; live.remotes.set(num, r); }
    if (!(flags & 1)) { if (!r.deadAt) r.deadAt = now; } else if (r.deadAt && now - r.deadAt > 300) { r.deadAt = 0; r.track = createTrack(10); }
    r.track.push(m.at, x / 100, y / 100, z / 100, yaw / 1000); r.pitch = pitch / 1000; r.flags = flags; r.weapon = weapon; r.hp = hp; r.seenAt = now; r.team = teamOf(num);
  }
  for (const [num, r] of live.remotes) if (!seen.has(num) && !r.deadAt) { r.flags &= ~1; r.seenAt = 0; }
  live.radar = m.r ?? [];
  // ---- grenades, interpolated lightly between snapshots
  const g = new Set<number>();
  for (const [id, kind, x, y, z] of m.g as number[][]) { g.add(id); live.grenades.set(id, { kind, x: x / 100, y: y / 100, z: z / 100, at: now }); }
  for (const id of live.grenades.keys()) if (!g.has(id)) live.grenades.delete(id);
  // ---- our own state: reconcile
  const me = m.me;
  if (me && live.loadout && live.ctx) {
    if (!live.sim || me.life !== live.life) {
      live.sim = spawnState({ x: 0, z: 0, yaw: 0 }, live.loadout, live.perks); live.life = me.life;
      unpackState(me.s, live.sim); live.pending = live.pending.filter(c => c.seq > me.ack);
      live.smooth = { x: 0, y: 0, z: 0 }; live.prev = { x: live.sim.x, y: eyeOf(live.sim), z: live.sim.z };
      if (me.alive) { controls.yaw = live.sim.yaw; controls.pitch = 0; }
    } else if (me.alive && live.alive) {
      const bx = live.sim.x, by = live.sim.y, bz = live.sim.z;
      unpackState(me.s, live.sim);
      live.pending = live.pending.filter(c => c.seq > me.ack);
      for (const c of live.pending) step(live.sim, c, live.ctx);
      const ex = bx - live.sim.x, ey = by - live.sim.y, ez = bz - live.sim.z;
      if (Math.hypot(ex, ey, ez) < 2) { live.smooth.x += ex; live.smooth.y += ey; live.smooth.z += ez; } else live.smooth = { x: 0, y: 0, z: 0 };
      live.prev.x -= ex; live.prev.y -= ey; live.prev.z -= ez;
    }
    live.alive = me.alive;
  }
  // ---- interface (React) values, only when they change
  const prev = a.hud, s = live.sim;
  const w = s ? weaponOf(s) : null;
  const next = {
    ...prev, hp: me?.hp ?? prev.hp, alive: !!me?.alive, respawnMs: me?.respawn ?? 0, timeLeft: m.tl, scores: m.sc, matchState: m.st, objectives: m.o,
    earned: me?.earned ?? [], streakPts: me?.pts ?? 0, streak: me?.streak ?? 0, ping: Math.round(live.rtt),
    ...(s && w ? hudWeapon(s, w) : {}),
  };
  if (JSON.stringify(next) !== JSON.stringify(prev)) a.set({ hud: next });
  if (a.match && m.st !== a.match.state) a.set({ match: { ...a.match, state: m.st, scores: m.sc } });
}
const teamOf = (num: number) => useArena.getState().match?.players.find(p => p.num === num)?.team ?? -1;
const nameOf = (num: number | null) => (num == null ? 'The arena' : useArena.getState().match?.players.find(p => p.num === num)?.name ?? 'A player');
function hudWeapon(s: Sim, w: ReturnType<typeof weaponOf>) {
  const cur = s.wpn[s.slot];
  return { weapon: w.id, slot: s.slot, mag: cur.mag, reserve: cur.reserve, magSize: w.mag ?? 0, phase: s.phase, ads: Math.round(s.ads * 10) / 10, lethal: s.lethal, tactical: s.tactical, sprint: s.sprint, stance: s.stance,
    reloadProgress: s.phase === 'reload' ? Math.round((1 - s.pt / Math.max(1, live.reloadTotal)) * 10) / 10 : 0 };
}

function event(ev: Record<string, any>) {
  const a = useArena.getState(), now = performance.now(), mine = (n: number | null) => n === live.num, team = (n: number | null) => teamOf(n ?? -1);
  switch (ev.k) {
    case 'spawn': {
      live.loadout = ev.loadout; live.perks = new Set(ev.loadout.perks); if (live.ctx) live.ctx.perks = live.perks;
      live.sim = spawnState({ x: ev.x, z: ev.z, yaw: ev.yaw }, ev.loadout, live.perks); live.life = ev.life; live.alive = true;
      live.pending = []; live.smooth = { x: 0, y: 0, z: 0 }; live.prev = { x: ev.x, y: eyeOf(live.sim), z: ev.z }; controls.yaw = ev.yaw; controls.pitch = 0;
      a.set({ killedBy: null, loadout: ev.loadout });
      return;
    }
    case 'roster': if (a.match) a.set({ match: { ...a.match, players: ev.players } }); for (const r of live.remotes.values()) r.team = teamOf(r.num); { const me = ev.players.find((p: { num: number }) => p.num === live.num); if (me && a.you && me.team !== a.you.team) { a.set({ you: { ...a.you, team: me.team } }); live.team = me.team; } } return;
    case 'balanced': banner({ text: 'Teams balanced', sub: 'You moved to the other team.', tone: 'info', ms: 3000 }); return;
    case 'state': {
      if (a.match) a.set({ match: { ...a.match, state: ev.state } });
      if (ev.state === 'countdown') { banner({ text: 'Match starting', sub: 'Get ready', tone: 'big', ms: 2500 }); sfx.beep(); }
      if (ev.state === 'playing') { banner({ text: 'Fight', sub: MODE_BY_ID.get(a.match?.mode ?? '')?.text, tone: 'big', ms: 3000 }); sfx.beep(true); }
      if (ev.state === 'waiting') banner({ text: 'Waiting for players', tone: 'info', ms: 2500 });
      return;
    }
    case 'left': live.remotes.delete(ev.num); return;
    case 'board': a.set({ board: Object.fromEntries(ev.rows.map((r: number[]) => [r[0], r.slice(1)])) }); return;
    case 'shot': {
      const w = WEAPONS[ev.w]; const r = live.remotes.get(ev.num);
      const from = r && r.seenAt ? [r.pos.x, r.pos.y + (r.flags & 2 ? 1.0 : 1.45), r.pos.z] : ev.o.map((v: number) => v / 100);
      for (const e of ev.e) {
        const to = [e[0] / 100, e[1] / 100, e[2] / 100];
        fx({ type: 'tracer', from, to, local: false });
        // What it struck (for the right dust, sparks and sound): re-cast the same ray against the map.
        let normal = [0, 1, 0], mat: string | undefined;
        const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], len = Math.hypot(dx, dy, dz) || 1;
        const hit = live.world && !e[3] ? raycast(live.world, from[0], from[1], from[2], dx / len, dy / len, dz / len, len + .4, null, hitScratch) : null;
        if (hit && hit.t > len - .6) { normal = [...hit.normal]; mat = hit.box ? matOf(hit.box) : undefined; }
        fx({ type: 'impact', at: to, normal, flesh: !!e[3], mat });
      }
      fx({ type: 'muzzle', num: ev.num });
      if (w) sfx.gun(w.sound, [from[0], from[1], from[2]]);
      return;
    }
    case 'act': {
      const r = live.remotes.get(ev.num), at: [number, number, number] | undefined = r ? [r.pos.x, r.pos.y + 1, r.pos.z] : undefined;
      if (ev.a === 'melee') sfx.swing(at);
      return;
    }
    case 'hit': {
      live.hit = { at: now, kill: ev.kill, head: ev.hs };
      if (ev.kill) sfx.kill(); else if (ev.hs) sfx.headshot(); else if (!ev.flash) sfx.hit();
      return;
    }
    case 'dmg': {
      if (ev.from && live.sim) {
        const dx = ev.from[0] / 100 - live.sim.x, dz = ev.from[1] / 100 - live.sim.z;
        live.damage.push({ angle: Math.atan2(-dx, -dz) - controls.yaw, at: now }); live.damage = live.damage.filter(d => now - d.at < 1500);
      }
      live.hurtAt = now; live.shake = Math.min(1, live.shake + ev.dmg / 80); sfx.hurt();
      a.set({ hud: { ...a.hud, hp: ev.hp } });
      return;
    }
    case 'kill': {
      a.set({ feed: [...a.feed.slice(-5), { id: now + Math.random(), killer: ev.a, victim: ev.v, weapon: ev.w, head: ev.hs, at: now }] });
      const r = live.remotes.get(ev.v); if (r) { r.deadAt = now; r.flags &= ~1; fx({ type: 'death', num: ev.v }); }
      if (mine(ev.a) && !mine(ev.v)) banner({ text: `Eliminated ${nameOf(ev.v)}`, sub: ev.hs ? 'Headshot · +125' : '+100', tone: 'good', ms: 1800 });
      if (ev.as?.includes(live.num)) banner({ text: 'Assist', sub: `${nameOf(ev.v)} · +40`, tone: 'medal', ms: 1500 });
      return;
    }
    case 'died': {
      live.alive = false; a.set({ killedBy: { num: ev.by, weapon: ev.w }, scoreboard: false, hud: { ...a.hud, alive: false, hp: 0 } });
      return;
    }
    case 'medal': if (ev.id !== 'assist') banner({ text: MEDALS[ev.id as keyof typeof MEDALS] ?? ev.id, tone: 'medal', ms: 1600 }); return;
    case 'earned': { const s = STREAK_BY_ID.get(ev.id); banner({ text: `${s?.name ?? 'Reward'} ready`, sub: `Press ${ev.id === 'recon' ? 3 : ev.id === 'supply' ? 4 : 5} (or its button) to use it`, tone: 'good', ms: 2600 }); sfx.streak(); return; }
    case 'streakResult': if (!ev.ok) banner({ text: ev.reason, tone: 'bad', ms: 2200 }); return;
    case 'recon': {
      if (ev.team === live.team) { live.reconUntil = now + ev.until; banner({ text: 'Recon Pulse active', sub: `${nameOf(ev.by)} revealed the enemy team`, tone: 'good', ms: 2200 }); }
      else { live.enemyReconUntil = now + ev.until; banner({ text: 'Enemy Recon Pulse', sub: 'Your positions are revealed', tone: 'bad', ms: 2200 }); }
      sfx.beep(true); return;
    }
    case 'supply': live.supplies.push({ id: ev.id, team: ev.team, x: ev.x / 100, y: ev.y / 100, z: ev.z / 100, until: now + ev.ms }); if (ev.team === live.team) banner({ text: 'Supply Drop', sub: 'Walk over the crate to refill ammunition and equipment', tone: 'good', ms: 2400 }); return;
    case 'resupplied': banner({ text: 'Resupplied', tone: 'good', ms: 1400 }); sfx.reload(); return;
    case 'strike': {
      live.strikes.push({ x: ev.x / 100, y: ev.y / 100, z: ev.z / 100, r: ev.r, at: now + ev.ms, team: ev.team });
      banner({ text: ev.team === live.team ? 'Tactical Strike inbound' : 'Enemy Tactical Strike!', sub: ev.team === live.team ? 'Marked target' : 'Get clear of the red zone', tone: ev.team === live.team ? 'good' : 'bad', ms: 2600 });
      sfx.alarm(); return;
    }
    case 'boom': {
      const at = [ev.x / 100, ev.y / 100, ev.z / 100]; fx({ type: 'boom', at, r: ev.r }); sfx.boom(at as [number, number, number]);
      if (live.sim) live.shake = Math.min(1.2, live.shake + Math.max(0, 1 - Math.hypot(at[0] - live.sim.x, at[2] - live.sim.z) / 25));
      live.strikes = live.strikes.filter(s => now < s.at - 200);
      return;
    }
    case 'smoke': { const at = [ev.x / 100, ev.y / 100, ev.z / 100]; live.smokes.push({ x: at[0], y: at[1], z: at[2], r: ev.r, until: now + ev.ms }); fx({ type: 'smoke', at, r: ev.r, ms: ev.ms }); sfx.smoke(at as [number, number, number]); return; }
    case 'flashbang': { const at = [ev.x / 100, ev.y / 100, ev.z / 100]; fx({ type: 'flash', at }); sfx.flash(at as [number, number, number]); return; }
    case 'blind': live.blindUntil = now + ev.ms; live.blindMs = ev.ms; return;
    case 'capture': case 'neutral': {
      const ours = ev.team === live.team, inIt = ev.by?.includes(live.num);
      banner({ text: ev.k === 'capture' ? `${ours ? 'We' : 'Enemy'} captured ${ev.id}` : `${ev.id} ${ours ? 'neutralised' : 'lost'}`, sub: inIt ? '+150' : undefined, tone: ours ? 'good' : 'bad', ms: 2200 });
      sfx.capture(ours); if (ev.k === 'capture') fx({ type: 'capture', id: ev.id, team: ev.team }); return;
    }
    case 'end': {
      const result = ev.result, won = result.winner === live.team, draw = result.winner === null;
      saveRejoin(null);
      banner({ text: draw ? 'Draw' : won ? 'Victory' : 'Defeat', sub: result.outcome === 'forfeit' ? 'The other team left' : result.outcome === 'abandoned' ? 'Match abandoned' : undefined, tone: 'big', ms: 3200 });
      if (won) sfx.victory(); else sfx.defeat();
      document.exitPointerLock?.();
      a.set({ result, hud: { ...a.hud, alive: false } });
      setTimeout(() => { if (useArena.getState().result?.id === result.id) useArena.getState().set({ phase: 'results', menu: false, scoreboard: false }); }, 2600);
      return;
    }
  }
}

// ---------------------------------------------------------------- outgoing: fixed-rate commands
/** Run the 60 Hz simulation for elapsed frame time: build, predict and queue commands; send at ~30 Hz. */
export function tickInput(dt: number) {
  const a = useArena.getState();
  if (!live.sim || !live.ctx || a.phase !== 'match' || socket?.readyState !== WebSocket.OPEN) { live.acc = 0; return; }
  live.acc = Math.min(live.acc + dt, .25);
  const paused = inputPaused(a) || document.hidden;
  const auto = a.settings.autoFire && a.match?.autoFire !== false;
  while (live.acc >= DT) {
    live.acc -= DT;
    const { mx, mz } = paused ? { mx: 0, mz: 0 } : axes();
    let b = paused ? 0 : buttons();
    // Auto-fire only ever adds the trigger, and only while the player's own aim is on a visible enemy.
    live.autoFiring = false;
    if (auto && !paused && live.alive) {
      const d = autoFireDecision({ sim: live.sim, view: { yaw: controls.yaw, pitch: controls.pitch }, targets: autoTargets(), world: live.world, team: live.team, held: b });
      live.autoFiring = d.fire; live.autoReason = d.reason;
      if (d.fire) b |= B.FIRE;
    }
    if (a.match?.state === 'ended') b = 0;
    const cmd = quantize({ seq: ++live.seq, b, mx, mz, yaw: controls.yaw, pitch: controls.pitch }) as Cmd;
    live.outgoing.push(encodeCommand(cmd));
    if (live.alive) {
      live.prev.x = live.sim.x; live.prev.y = eyeOf(live.sim); live.prev.z = live.sim.z;
      live.pending.push(cmd);
      if (live.pending.length > 240) live.pending.shift();
      const events = step(live.sim, cmd, live.ctx);
      for (const ev of events) local(ev);
    }
  }
  const now = performance.now();
  if (live.outgoing.length && (now - live.lastSend >= 30 || live.outgoing.length >= 4)) {
    const rt = live.playback.time(now);
    raw({ t: 'c', rt: rt == null ? null : Math.round(rt), c: live.outgoing.splice(0, 12) });
    live.lastSend = now;
  }
}
/** Our own predicted events: immediate muzzle flash, tracer, impact and sound. Hits are confirmed by the server. */
const hitScratch: { t: number; box: { i: number } | null; normal: number[]; ground: boolean } = { t: 0, box: null, normal: [0, 0, 0], ground: false };
/** The map material of a collision box (what a round or a boot is touching). */
export const matOf = (box: { i: number }): string | undefined => MAP_BY_ID.get(live.mapId)?.boxes[box.i]?.mat;
function local(ev: Record<string, any>) {
  const s = live.sim!;
  if (ev.kind === 'shot') {
    const w = WEAPON_BY_ID.get(ev.weapon)!;
    live.firedAt = performance.now(); live.kick = Math.min(1.4, live.kick + (w.category === 'sniper' || w.category === 'shotgun' ? 1 : .35));
    for (const [dx, dy, dz] of ev.dirs) {
      const hit = raycast(live.world, ev.ox, ev.oy, ev.oz, dx, dy, dz, w.range, null, hitScratch);
      const t = hit ? hit.t : Math.min(w.range, 120);
      const to = [ev.ox + dx * t, ev.oy + dy * t, ev.oz + dz * t];
      fx({ type: 'tracer', from: [ev.ox, ev.oy, ev.oz], to, local: true });
      if (hit) fx({ type: 'impact', at: to, normal: [...hit.normal], flesh: false, mat: hit.box ? matOf(hit.box) : undefined });
    }
    fx({ type: 'shot', weapon: w.id });
    sfx.gun(w.sound);
  } else if (ev.kind === 'reload') { const w = weaponOf(s); live.reloadStart = performance.now(); live.reloadTotal = s.pt; sfx.reload(ev.empty); void w; }
  else if (ev.kind === 'switch') sfx.switch();
  else if (ev.kind === 'dry') sfx.dry();
  else if (ev.kind === 'melee') sfx.swing();
  else if (ev.kind === 'land') { sfx.land(); fx({ type: 'land', speed: ev.speed }); }
  else if (ev.kind === 'jump') fx({ type: 'jump' });
  else if (ev.kind === 'throw') sfx.swing();
}

/** Other players as they are drawn right now, for auto-fire (only those in the latest snapshots count as visible). */
function autoTargets() {
  const now = performance.now(), out = [];
  for (const r of live.remotes.values()) out.push({ team: r.team, alive: !!(r.flags & 1) && !r.deadAt, visible: !!r.seenAt && now - r.seenAt < 250, x: r.pos.x, y: r.pos.y, z: r.pos.z, flags: r.flags });
  return out;
}
/** Switch auto-fire on or off (the F key, the touch switch, or settings). */
export function toggleAutoFire() {
  const a = useArena.getState(), on = !a.settings.autoFire;
  a.setSettings({ autoFire: on });
  banner({ text: `Auto-fire ${on ? 'on' : 'off'}`, sub: on ? (a.match?.autoFire === false ? 'Not allowed in this playlist' : 'Fires while your aim is on a visible enemy') : undefined, tone: 'info', ms: 1600 });
}
/** Use an earned reward (the server checks it is earned and available). */
export function useStreak(id: string) { if (useArena.getState().hud.earned.includes(id)) raw({ t: 'streak', id }); else banner({ text: `${STREAK_BY_ID.get(id)?.name ?? 'That reward'} is not ready yet`, tone: 'info', ms: 1500 }); }
export const send = raw;
/** The current spread cone for the crosshair. */
export function currentSpread() { const s = live.sim; return s ? spreadOf(s, weaponOf(s), live.perks) : 0; }
/** Where the camera is (eye, plus the decaying correction offset). */
export function eye(out: { x: number; y: number; z: number }) {
  const s = live.sim; if (!s) return out;
  // Between 60 Hz ticks, interpolate from the previous tick's position (smooth on 90/120 Hz screens).
  const k = live.alive ? Math.min(1, live.acc / DT) : 1, ey = eyeOf(s);
  out.x = live.prev.x + (s.x - live.prev.x) * k + live.smooth.x; out.y = live.prev.y + (ey - live.prev.y) * k + live.smooth.y; out.z = live.prev.z + (s.z - live.prev.z) * k + live.smooth.z;
  if (Math.hypot(s.x - live.prev.x, s.z - live.prev.z) > 1.5) { out.x = s.x; out.y = ey; out.z = s.z; }
  return out;
}
export { direction, B };

// QA builds only: read-only inspection for the browser suite (tests/browser-arena.mjs).
if (QA_HOOKS && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__arena = {
  state: () => { const a = useArena.getState(); return { phase: a.phase, status: a.status, match: a.match && { id: a.match.id, kind: a.match.kind, code: a.match.code, state: a.match.state, players: a.match.players.length }, you: a.you, hud: a.hud }; },
  remotes: () => [...live.remotes.values()].filter(r => (r.flags & 1) && r.seenAt).map(r => ({ num: r.num, team: r.team, x: r.pos.x, z: r.pos.z })),
  /** Re-read what the account owns (as the Armory does after a purchase). */
  refreshOwned: async () => { const r = await request({ t: 'owned' }); if (Array.isArray(r.owned)) useArena.getState().set({ owned: r.owned as string[] }); return r.owned; },
  /** Point the view (QA only: lets the browser suite aim without synthesising mouse movement). */
  look: (yaw: number, pitch: number) => { controls.yaw = yaw; controls.pitch = pitch; },
  self: () => (live.sim ? { x: live.sim.x, y: live.sim.y, z: live.sim.z, alive: live.alive, ammo: live.sim.wpn[live.sim.slot].mag, pending: live.pending.length, autoFiring: live.autoFiring, autoReason: live.autoReason } : null),
};
