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
import { step, spawnState, unpackState, quantize, encodeCommand, DT, B, eyeOf, weaponOf, fireModeOf, spreadOf, direction } from '../../shared/arena/sim.mjs';
import { WEAPONS, WEAPON_BY_ID, STREAK_BY_ID } from '../../shared/arena/weapons.mjs';
import { MEDALS, MODE_BY_ID } from '../../shared/arena/rules.mjs';
import { createPlayback, createTrack } from '../network/interpolation.mjs';
import { accountAccess } from '../network/client';
import { useGame } from '../state';
import { useArena, useBanners, emptyHud, inputPaused, type Loadout, type MatchView, type Progress } from './store';
import { autoFireDecision } from '../../shared/arena/autofire.mjs';
import { syncFromAccount } from './hudLayout';
import { controls, buttons, axes } from './input';
import { sfx, actions, remoteActions, announcer, countdown, ground } from './audio';
import { soldierModelFor } from './models';
import { QA_HOOKS } from '../qa';
import * as deploy from './deploy';

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
  | { type: 'land'; speed: number } | { type: 'jump' }
  | { type: 'glass'; i: number; reset?: boolean };

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
  kick: 0, shake: 0, firedAt: 0, reloadStart: 0, reloadTotal: 0, reloadEmpty: false, rtt: 0, loadout: null as Loadout | null, perks: new Set<string>(),
  /** Auto-fire is holding the trigger this tick (and why not, for the QA hooks). */
  autoFiring: false, autoReason: '',
  /** The scene for the current match has what it needs to draw and play (sent to the server as 'loaded'). */
  sceneReady: false, loadedSent: '', haveState: false, syncRetries: 0,
  /** Glass panes the server has broken (Metropolis). */
  broken: new Set<number>(),
  /** The match clock as last heard: `elapsed` ms since the match started (−1 when not being played), at local time `at`. */
  clock: { elapsed: -1, at: 0 },
};
/** Milliseconds since the match started, or −1 when it is not being played (drives the station's train). */
export const matchElapsed = () => (live.clock.elapsed < 0 ? -1 : live.clock.elapsed + (performance.now() - live.clock.at));
const fxListeners = new Set<(f: Fx) => void>();
export function onFx(fn: (f: Fx) => void) { fxListeners.add(fn); return () => { fxListeners.delete(fn); }; }
const fx = (f: Fx) => { for (const l of fxListeners) l(f); };
const banner = useBanners.getState().push;

let socket: WebSocket | null = null, stopped = true, retry = 0, retryTimer: ReturnType<typeof setTimeout> | undefined, pingTimer: ReturnType<typeof setInterval> | undefined;
let helloTimer: ReturnType<typeof setTimeout> | undefined, watchTimer: ReturnType<typeof setInterval> | undefined;
/** What the client supports: the server holds it out of live combat until its scene has loaded, and takes its deployment timings. */
const CAPS = ['loadgate', 'diag'];
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
  clearInterval(watchTimer); watchTimer = setInterval(deploy.watchdog, 1000);
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
    ws.send(JSON.stringify({ t: 'hello', name: g.name, avatar: g.avatar, caps: CAPS, ...(access ? { access } : {}) }));
    // No answer to hello (a stuck server, a half-open connection): close and reconnect rather than wait forever.
    clearTimeout(helloTimer);
    helloTimer = setTimeout(() => { if (socket === ws && useArena.getState().status === 'connecting') { useArena.getState().set({ error: 'The arena is taking a while to answer. Reconnecting…' }); ws.close(); } }, 12000);
  };
  ws.onmessage = e => { if (socket !== ws) return; let m; try { m = JSON.parse(e.data); } catch { return; } receive(m); };
  ws.onclose = e => {
    if (socket !== ws) return;
    socket = null; clearInterval(pingTimer); clearTimeout(helloTimer);
    deploy.lost();
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
  stopped = true; clearTimeout(retryTimer); clearInterval(pingTimer); clearTimeout(helloTimer); clearInterval(watchTimer);
  deploy.reset();
  if (socket) { raw({ t: 'leave' }); socket.close(); socket = null; }
  resetMatch(); useArena.getState().set({ status: 'idle' });
}
export function pendingRejoin(): { match: string; key: string } | null {
  try { const v = JSON.parse(sessionStorage.getItem(REJOIN) ?? 'null'); return v && Date.now() - v.at < 55000 ? v : null; } catch { return null; }
}
function saveRejoin(match: string | null, key = '') { try { if (match) sessionStorage.setItem(REJOIN, JSON.stringify({ match, key, at: Date.now() })); else sessionStorage.removeItem(REJOIN); } catch { /* storage denied */ } }

function resetMatch() {
  Object.assign(live, { sim: null, ctx: null, alive: false, life: 0, num: 0, pending: [], outgoing: [], acc: 0, radar: [], reconUntil: 0, enemyReconUntil: 0, blindUntil: 0, sceneReady: false, loadedSent: '', haveState: false, syncRetries: 0 });
  live.remotes.clear(); live.grenades.clear(); live.smokes = []; live.supplies = []; live.strikes = []; live.playback.reset();
  useArena.getState().set({ match: null, you: null, feed: [], board: {}, hud: emptyHud(), killedBy: null, scoreboard: false });
}

// ---------------------------------------------------------------- incoming
function receive(m: Record<string, any>) {
  const a = useArena.getState();
  switch (m.t) {
    case 'ready': {
      retry = 0; clearTimeout(helloTimer);
      a.set({ notice: m.notice === 'accounts-unavailable' ? 'Your account could not be checked just now, so you are playing as a guest: progress from these matches is not saved. Reopen the arena to try again.' : '', error: a.error.startsWith('The arena is taking') ? '' : a.error });
      a.set({ status: 'ready', me: { name: m.name, verified: m.verified, handle: m.handle, level: m.level, xp: m.xp, emblem: m.emblem, weaponLevels: m.weaponLevels ?? {} }, online: m.online, owned: Array.isArray(m.owned) ? m.owned : [] });
      if (m.verified) void syncFromAccount();
      if (m.verified && Array.isArray(m.loadouts) && m.loadouts.length) a.set({ loadouts: m.loadouts, loadout: m.loadout });
      else raw({ t: 'loadout', loadout: a.loadout, ref: ++ref });
      clearInterval(pingTimer); pingTimer = setInterval(() => raw({ t: 'ping', n: performance.now() }), 2000);
      // Back after a dropped connection (or a reload) during a match: take our place again.
      const back = a.match ? { match: a.match.id, key: a.you!.key } : pendingRejoin();
      if (back) {
        const cid = deploy.useDeploy.getState().stage === 'recovering' ? deploy.useDeploy.getState().cid : null;
        void request({ t: 'rejoin', ...back, ...(cid ? { cid } : {}) }).then(r => {
          if (!r.ok) { saveRejoin(null); deploy.reset(); if (useArena.getState().phase === 'match') { resetMatch(); useArena.getState().set({ phase: 'lobby', error: String(r.reason ?? '') }); } }
          else banner({ text: 'Reconnected', tone: 'good', ms: 1800 });
        });
      } else if (deploy.useDeploy.getState().stage === 'recovering') deploy.fail('The connection dropped before the match could start.', 'request');
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
    case 'match': enterMatch(m.match, m.you, m.loadout, !!m.rejoined); if (live.sceneReady) sceneLoaded(true); return;
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
  const same = rejoined && a.match?.id === view.id;
  if (!same) { resetMatch(); a.set({ result: null, progress: null, record: null }); }
  // Deployment: assigned to a match. After a reconnect to the same match, carry on from where it stood.
  if (same && deploy.useDeploy.getState().stage === 'recovering') deploy.resumed(); else if (!same || deploy.useDeploy.getState().stage !== 'deployed') deploy.assigned();
  live.loadedSent = ''; live.haveState = false; live.syncRetries = 0;
  const map = MAP_BY_ID.get(view.map)!;
  live.world = createWorld(map.boxes, map.bounds); live.mapId = view.map; live.num = you.num; live.team = you.team;
  live.loadout = loadout; live.perks = new Set(loadout.perks);
  live.broken = new Set(view.broken ?? []); live.clock = { elapsed: view.state === 'playing' ? view.elapsed ?? -1 : -1, at: performance.now() };
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
    // Sound from the server's own state: a drop in a living player's health is a validated hit (their reaction);
    // alive again after an elimination is a respawn.
    const at: [number, number, number] = [x / 100, y / 100 + 1.5, z / 100];
    if ((r.flags & 1) && !r.deadAt && (flags & 1) && hp < r.hp) sfx.hurt(num, r.hp - hp, hp, at, soldierModelFor(num));
    if (!(flags & 1)) { if (!r.deadAt) r.deadAt = now; } else if (r.deadAt && now - r.deadAt > 300) { r.deadAt = 0; r.track = createTrack(10); sfx.spawn([x / 100, y / 100 + .2, z / 100]); }
    r.track.push(m.at, x / 100, y / 100, z / 100, yaw / 1000); r.pitch = pitch / 1000; r.flags = flags; r.weapon = weapon; r.hp = hp; r.seenAt = now; r.team = teamOf(num);
  }
  for (const [num, r] of live.remotes) if (!seen.has(num) && !r.deadAt) { r.flags &= ~1; r.seenAt = 0; }
  live.radar = m.r ?? [];
  contested(m.o); progress(m.tl, m.sc);
  live.clock = { elapsed: m.st === 'playing' && a.match ? a.match.timeMs - m.tl : -1, at: now };
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
    live.haveState = true;
  }
  // Deployed: the scene is ready and the server has given us our own state (spawned, or dead and waiting to respawn).
  if (live.sceneReady && live.haveState && live.sim) deploy.deployed();
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
/** Where another player is now (their chest), for sounds that follow them (a reload, a bolt worked). */
const posOf = (num: number): [number, number, number] | null => { const r = live.remotes.get(num); return r && r.seenAt && !r.deadAt ? [r.pos.x, r.pos.y + 1.2, r.pos.z] : null; };
/** The living player a round's end point lies on (within the hitbox), if any. */
function victimNear(p: number[]) {
  let best: Remote | null = null, bd = .9;
  for (const r of live.remotes.values()) { if (r.deadAt) continue; const d = Math.hypot(r.pos.x - p[0], r.pos.z - p[2]); if (d < bd && p[1] > r.pos.y - .1 && p[1] < r.pos.y + 2) { bd = d; best = r; } }
  return best;
}
/** Match progress: a notice with a minute left, and the radio when the enemy nears the score limit ahead of us. */
let lastTimeLeft = Infinity;
function progress(timeLeft: number | undefined, scores: number[] | undefined) {
  const a = useArena.getState(); if (a.match?.state !== 'playing') { lastTimeLeft = Infinity; return; }
  if (typeof timeLeft === 'number') { if (lastTimeLeft > 60000 && timeLeft <= 60000 && timeLeft > 0) sfx.ui('notify'); lastTimeLeft = timeLeft; }
  const limit = a.match.scoreLimit, ours = scores?.[live.team] ?? 0, theirs = scores?.[1 - live.team] ?? 0;
  if (limit && theirs >= limit * .8 && theirs > ours) announcer.say('losing', { gap: 60 });
}
/** Domination: one of our objectives coming under enemy capture is announced (not more than every 15 s). */
let lastObjectives: number[][] = [];
function contested(o: number[][] | undefined) {
  if (!Array.isArray(o)) return;
  o.forEach((x, i) => { const [owner, , cap] = x, was = lastObjectives[i]; if (owner === live.team && cap >= 0 && cap !== live.team && !(was && was[2] === cap)) announcer.say('contested', { gap: 15 }); });
  lastObjectives = o.map(x => [...x]);
}
const nameOf = (num: number | null) => (num == null ? 'The arena' : useArena.getState().match?.players.find(p => p.num === num)?.name ?? 'A player');
function hudWeapon(s: Sim, w: ReturnType<typeof weaponOf>) {
  const cur = s.wpn[s.slot];
  return { weapon: w.id, fireMode: fireModeOf(s), slot: s.slot, mag: cur.mag, reserve: cur.reserve, magSize: w.mag ?? 0, phase: s.phase, ads: Math.round(s.ads * 10) / 10, lethal: s.lethal, tactical: s.tactical, sprint: s.sprint, stance: s.stance,
    reloadProgress: s.phase === 'reload' ? Math.round((1 - s.pt / Math.max(1, live.reloadTotal)) * 10) / 10 : 0 };
}

function event(ev: Record<string, any>) {
  const a = useArena.getState(), now = performance.now(), mine = (n: number | null) => n === live.num, team = (n: number | null) => teamOf(n ?? -1);
  switch (ev.k) {
    case 'spawn': {
      live.haveState = true;
      live.loadout = ev.loadout; live.perks = new Set(ev.loadout.perks); if (live.ctx) live.ctx.perks = live.perks;
      live.sim = spawnState({ x: ev.x, y: ev.y ?? 0, z: ev.z, yaw: ev.yaw }, ev.loadout, live.perks); live.life = ev.life; live.alive = true; sfx.spawn();
      live.pending = []; live.smooth = { x: 0, y: 0, z: 0 }; live.prev = { x: ev.x, y: eyeOf(live.sim), z: ev.z }; controls.yaw = ev.yaw; controls.pitch = 0;
      a.set({ killedBy: null, loadout: ev.loadout });
      return;
    }
    case 'roster': if (a.match) a.set({ match: { ...a.match, players: ev.players } }); for (const r of live.remotes.values()) r.team = teamOf(r.num); { const me = ev.players.find((p: { num: number }) => p.num === live.num); if (me && a.you && me.team !== a.you.team) { a.set({ you: { ...a.you, team: me.team } }); live.team = me.team; } } return;
    case 'balanced': banner({ text: 'Teams balanced', sub: 'You moved to the other team.', tone: 'info', ms: 3000 }); sfx.ui('notify'); return;
    case 'state': {
      if (a.match) a.set({ match: { ...a.match, state: ev.state } });
      if (ev.state === 'countdown') { banner({ text: 'Match starting', sub: 'Get ready', tone: 'big', ms: 2500 }); countdown(ev.countdownMs || 3000); }
      if (ev.state === 'playing') { banner({ text: 'Fight', sub: MODE_BY_ID.get(a.match?.mode ?? '')?.text, tone: 'big', ms: 3000 }); announcer.say('go', { gap: 2 }); }
      if (ev.state === 'waiting') banner({ text: 'Waiting for players', tone: 'info', ms: 2500 });
      return;
    }
    case 'glass': if (ev.reset) { live.broken.clear(); fx({ type: 'glass', i: -1, reset: true }); } else if (!live.broken.has(ev.i)) { live.broken.add(ev.i); fx({ type: 'glass', i: ev.i }); } return;
    case 'train': banner({ text: 'Train approaching', sub: 'Plaza Station · keep off the track', tone: 'info', ms: 3200 }); sfx.ui('notify'); return;
    case 'left': live.remotes.delete(ev.num); remoteActions.forget(ev.num); return;
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
        // A round that stopped in a player: the helmet, the plate carrier or cloth, by where on them it struck.
        if (e[3]) { const v = victimNear(to); if (v) sfx.bodyHit(sfx.partAt(to[1], v.pos.y, !!(v.flags & 2)), to as [number, number, number]); }
      }
      fx({ type: 'muzzle', num: ev.num });
      if (w) {
        sfx.gun(w.id, [from[0], from[1], from[2]], ev.num);
        // The pump or bolt worked after the shot, from where they are.
        if (w.id === 'bastion' || w.fire === 'bolt') remoteActions.cycle(ev.num, w.id, () => posOf(ev.num));
        // A round from the other team passing close: the snap or whiz that tells you you are being shot at.
        if (team(ev.num) !== live.team && ev.e[0]) sfx.flyby(w.id, from as [number, number, number], [ev.e[0][0] / 100, ev.e[0][1] / 100, ev.e[0][2] / 100]);
      }
      return;
    }
    case 'act': {
      const r = live.remotes.get(ev.num), at: [number, number, number] | undefined = r ? [r.pos.x, r.pos.y + 1.2, r.pos.z] : undefined;
      if (ev.a === 'melee') sfx.swing(ev.w === 'knife' ? 'knife' : ev.w === 'hammer' ? 'axe' : 'butt', at);
      else if (ev.a === 'reload' && r) { const w = WEAPONS[r.weapon]; if (w) remoteActions.reload(ev.num, w.id, !!ev.e, () => posOf(ev.num)); }
      else if (ev.a === 'switch') { remoteActions.interrupt(ev.num); if (at) sfx.remoteSwap(at); }
      else if (ev.a === 'slide' && r) sfx.slide(ground(r.pos.x, r.pos.y, r.pos.z).surface, [r.pos.x, r.pos.y + .2, r.pos.z]);
      return;
    }
    case 'hit': {
      live.hit = { at: now, kill: ev.kill, head: ev.hs };
      if (ev.kill) sfx.kill(); else if (ev.hs) sfx.headshot(); else if (!ev.flash) sfx.hit();
      // Our round (or blade) striking them, heard from them: helmet, plate carrier or cloth, as the server judged it.
      const r = live.remotes.get(ev.num);
      if (r && !ev.flash && ev.dmg > 0) { const at: [number, number, number] = [r.pos.x, r.pos.y + (ev.hs ? 1.62 : ev.lg ? .55 : 1.2), r.pos.z]; if (ev.c === 'm') sfx.meleeHit(at); else if (ev.c !== 'x') sfx.bodyHit(ev.hs ? 'helmet' : ev.lg ? 'flesh' : 'armour', at); }
      return;
    }
    case 'dmg': {
      if (ev.from && live.sim) {
        const dx = ev.from[0] / 100 - live.sim.x, dz = ev.from[1] / 100 - live.sim.z;
        live.damage.push({ angle: Math.atan2(-dx, -dz) - controls.yaw, at: now }); live.damage = live.damage.filter(d => now - d.at < 1500);
      }
      live.hurtAt = now; live.shake = Math.min(1, live.shake + ev.dmg / 80);
      sfx.hurt(null, ev.dmg, ev.hp);
      // The impact on us, placed a little toward the attacker: the hit itself says where it came from.
      if (ev.c !== 'x' && live.sim) {
        const ey = eyeOf(live.sim); let at: [number, number, number] = [live.sim.x, ey - .35, live.sim.z];
        if (ev.from) { const dx = ev.from[0] / 100 - live.sim.x, dz = ev.from[1] / 100 - live.sim.z, l = Math.hypot(dx, dz) || 1; at = [live.sim.x + dx / l * 1.2, ey - .35, live.sim.z + dz / l * 1.2]; }
        sfx.bodyHit(ev.hs ? 'helmet' : ev.lg ? 'flesh' : 'armour', at, true);
      }
      a.set({ hud: { ...a.hud, hp: ev.hp } });
      return;
    }
    case 'kill': {
      a.set({ feed: [...a.feed.slice(-5), { id: now + Math.random(), killer: ev.a, victim: ev.v, weapon: ev.w, head: ev.hs, at: now }] });
      const r = live.remotes.get(ev.v); if (r) { r.deadAt = now; r.flags &= ~1; fx({ type: 'death', num: ev.v }); sfx.death(ev.v, [r.pos.x, r.pos.y + 1.5, r.pos.z], soldierModelFor(ev.v), r.deadAt); remoteActions.forget(ev.v); }
      else if (mine(ev.v)) sfx.death(null, undefined, '', live.life);
      if (mine(ev.a) && !mine(ev.v)) banner({ text: `Eliminated ${nameOf(ev.v)}`, sub: ev.hs ? 'Headshot · +125' : '+100', tone: 'good', ms: 1800 });
      if (ev.as?.includes(live.num)) banner({ text: 'Assist', sub: `${nameOf(ev.v)} · +40`, tone: 'medal', ms: 1500 });
      return;
    }
    case 'died': {
      live.alive = false; a.set({ killedBy: { num: ev.by, weapon: ev.w }, scoreboard: false, hud: { ...a.hud, alive: false, hp: 0 } });
      return;
    }
    case 'medal': if (ev.id !== 'assist') { banner({ text: MEDALS[ev.id as keyof typeof MEDALS] ?? ev.id, tone: 'medal', ms: 1600 }); sfx.ui('medal'); } return;
    case 'earned': { const s = STREAK_BY_ID.get(ev.id); banner({ text: `${s?.name ?? 'Reward'} ready`, sub: `Press ${ev.id === 'recon' ? 3 : ev.id === 'supply' ? 4 : 5} (or its button) to use it`, tone: 'good', ms: 2600 }); sfx.ui('streak'); return; }
    case 'streakResult': if (!ev.ok) banner({ text: ev.reason, tone: 'bad', ms: 2200 }); return;
    case 'recon': {
      if (ev.team === live.team) { live.reconUntil = now + ev.until; banner({ text: 'Recon Pulse active', sub: `${nameOf(ev.by)} revealed the enemy team`, tone: 'good', ms: 2200 }); }
      else { live.enemyReconUntil = now + ev.until; banner({ text: 'Enemy Recon Pulse', sub: 'Your positions are revealed', tone: 'bad', ms: 2200 }); }
      if (ev.team === live.team) sfx.ui('ping'); else announcer.say('uav', { gap: 10 });
      return;
    }
    case 'supply': live.supplies.push({ id: ev.id, team: ev.team, x: ev.x / 100, y: ev.y / 100, z: ev.z / 100, until: now + ev.ms }); if (ev.team === live.team) { banner({ text: 'Supply Drop', sub: 'Walk over the crate to refill ammunition and equipment', tone: 'good', ms: 2400 }); announcer.say('supply'); } sfx.crate([ev.x / 100, ev.y / 100 + .3, ev.z / 100]); return;
    case 'resupplied': banner({ text: 'Resupplied', tone: 'good', ms: 1400 }); sfx.resupplied(); return;
    case 'strike': {
      live.strikes.push({ x: ev.x / 100, y: ev.y / 100, z: ev.z / 100, r: ev.r, at: now + ev.ms, team: ev.team });
      banner({ text: ev.team === live.team ? 'Tactical Strike inbound' : 'Enemy Tactical Strike!', sub: ev.team === live.team ? 'Marked target' : 'Get clear of the red zone', tone: ev.team === live.team ? 'good' : 'bad', ms: 2600 });
      announcer.say(ev.team === live.team ? 'strikeOurs' : 'strikeTheirs'); sfx.strikeWarning([ev.x / 100, ev.y / 100 + .5, ev.z / 100]); return;
    }
    case 'boom': {
      const at = [ev.x / 100, ev.y / 100, ev.z / 100]; fx({ type: 'boom', at, r: ev.r }); sfx.boom(at as [number, number, number]);
      if (live.sim) live.shake = Math.min(1.2, live.shake + Math.max(0, 1 - Math.hypot(at[0] - live.sim.x, at[2] - live.sim.z) / 25));
      live.strikes = live.strikes.filter(s => now < s.at - 200);
      return;
    }
    case 'smoke': { const at = [ev.x / 100, ev.y / 100, ev.z / 100]; live.smokes.push({ x: at[0], y: at[1], z: at[2], r: ev.r, until: now + ev.ms }); fx({ type: 'smoke', at, r: ev.r, ms: ev.ms }); sfx.smoke(at as [number, number, number], ev.ms); return; }
    case 'flashbang': { const at = [ev.x / 100, ev.y / 100, ev.z / 100]; fx({ type: 'flash', at }); sfx.flash(at as [number, number, number]); return; }
    case 'blind': live.blindUntil = now + ev.ms; live.blindMs = ev.ms; sfx.deafen(ev.ms); return;
    case 'capture': case 'neutral': {
      const ours = ev.team === live.team, inIt = ev.by?.includes(live.num);
      banner({ text: ev.k === 'capture' ? `${ours ? 'We' : 'Enemy'} captured ${ev.id}` : `${ev.id} ${ours ? 'neutralised' : 'lost'}`, sub: inIt ? '+150' : undefined, tone: ours ? 'good' : 'bad', ms: 2200 });
      // Radio: ours secured; ours neutralised by them, lost; theirs captured, losing ground.
      if (ev.k === 'capture') announcer.say(ours ? 'secured' : 'losing', { gap: 6 }); else if (!ours) announcer.say('lost', { gap: 6 });
      sfx.ui(ours ? 'confirm' : 'notify');
      if (ev.k === 'capture') fx({ type: 'capture', id: ev.id, team: ev.team }); return;
    }
    case 'end': {
      const result = ev.result, won = result.winner === live.team, draw = result.winner === null;
      saveRejoin(null);
      banner({ text: draw ? 'Draw' : won ? 'Victory' : 'Defeat', sub: result.outcome === 'forfeit' ? 'The other team left' : result.outcome === 'abandoned' ? 'Match abandoned' : undefined, tone: 'big', ms: 3200 });
      announcer.say(draw ? 'draw' : won ? 'win' : 'lose', { gap: 0 });
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
      const adsBefore = live.sim.ads;
      const events = step(live.sim, cmd, live.ctx);
      for (const ev of events) local(ev);
      // Raising the sights (the simulation has no event for it): cloth and grip.
      const wNow = weaponOf(live.sim);
      if (adsBefore === 0 && live.sim.ads > 0 && wNow.fire !== 'melee') sfx.ads();
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
    sfx.gun(w.id);
    // A pump or bolt worked after the shot: its cues follow the cooldown, as the animation does.
    if (w.id === 'bastion' || w.fire === 'bolt') actions.cycleStart(w.id, s.cool);
  } else if (ev.kind === 'reload') { const w = weaponOf(s); live.reloadStart = performance.now(); live.reloadTotal = s.pt; live.reloadEmpty = !!ev.empty; actions.reloadStart(w.id, !!ev.empty, s.pt); }
  else if (ev.kind === 'switch') actions.switchTo(ev.weapon, WEAPON_BY_ID.get(ev.weapon)?.swap ?? 30);
  else if (ev.kind === 'dry') sfx.dry(weaponOf(s).id);
  else if (ev.kind === 'melee') { const w = WEAPON_BY_ID.get(ev.weapon); sfx.swing(ev.quick || w?.fire !== 'melee' ? 'butt' : w.id === 'knife' ? 'knife' : 'axe'); }
  else if (ev.kind === 'land') { sfx.land(ground(s.x, s.y, s.z).surface, ev.speed); fx({ type: 'land', speed: ev.speed }); }
  else if (ev.kind === 'jump') { sfx.jump(ground(s.x, s.y, s.z).surface, undefined, s.sprint); fx({ type: 'jump' }); }
  else if (ev.kind === 'slide') sfx.slide(ground(s.x, s.y, s.z).surface);
  else if (ev.kind === 'throw') sfx.throw(ev.slot === 'lethal' ? live.loadout?.lethal ?? 'frag' : live.loadout?.tactical ?? 'flash');
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

// ---------------------------------------------------------------- deployment
/** Enter a match (Quick Play, a private match, Training). Duplicate presses while one is running are ignored. */
let lastRequest: Record<string, unknown> | null = null;
export async function deployTo(kind: 'queue' | 'private' | 'training', data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cid = deploy.begin(kind);
  if (!cid) return { ok: false, reason: '', busy: true };
  lastRequest = { ...data };
  const r = await request({ ...data, cid }, 12000);
  if (!r.ok) {
    // A refusal (full, wrong code) goes back to the lobby with its reason; no answer is a failure to retry.
    if (String(r.reason ?? '').startsWith('The arena did not answer')) deploy.fail(String(r.reason), 'request'); else deploy.reset();
  } else if (deploy.useDeploy.getState().stage === 'requesting') deploy.assigned();
  return r;
}
/** The deployment screen's Retry. */
export function retryDeploy() {
  const f = deploy.useDeploy.getState().failure;
  if (f?.retry === 'request' && lastRequest) { deploy.reset(); useArena.getState().set({ phase: 'lobby' }); const d = lastRequest; void deployTo(d.t === 'queue' ? 'queue' : d.t === 'private' ? 'private' : 'training', d); return; }
  if (f?.retry === 'rejoin') { const a = useArena.getState(); deploy.reset(); deploy.begin('rejoin', true); deploy.assigned(); if (a.match && a.you) void request({ t: 'rejoin', match: a.match.id, key: a.you.key }).then(r => { if (!r.ok) { deploy.reset(); resetMatch(); useArena.getState().set({ phase: 'lobby', error: String(r.reason ?? '') }); } }); else connect(); return; }
  if (f?.retry === 'assets') { const s = deploy.useDeploy.getState(); useDeploy_retryAssets(); deploy.useDeploy.setState({ ...s, stage: 'loading-code', failure: null, slow: false }); deploy.enter('preparing'); }
}
const assetRetries = new Set<() => void>();
/** The scene registers how to re-attempt its failed downloads. */
export function onRetryAssets(fn: () => void) { assetRetries.add(fn); return () => { assetRetries.delete(fn); }; }
function useDeploy_retryAssets() { assetRetries.forEach(f => f()); }
/** Leave a match that is still deploying (or playing). */
export async function leaveMatch() { deploy.reset(); await request({ t: 'leave' }, 4000); saveRejoin(null); resetMatch(); useArena.getState().set({ phase: 'lobby', menu: false, match: null, result: null }); }
/** The scene can draw and play: tell the server (it brings a held player into the match) once per match and connection. */
export function sceneLoaded(ready: boolean) {
  live.sceneReady = ready;
  const id = useArena.getState().match?.id;
  if (!ready || !id) return;
  if (live.loadedSent !== id && raw({ t: 'loaded' })) { live.loadedSent = id; deploy.enter('synchronizing'); }
  if (live.haveState && live.sim) deploy.deployed();
}
deploy.onStageTimeout(stage => {
  if (stage === 'requesting') deploy.fail('The arena did not answer. Check your connection and try again.', 'request');
  else if (stage === 'loading-code') deploy.fail('The arena’s 3D code could not be downloaded.', 'assets');
  else if (stage === 'preparing') deploy.fail('The download stopped. Your connection may have dropped.', 'assets');
  else if (stage === 'synchronizing') {
    // Once: ask the server again (rejoin re-sends our state); then give up with a way to retry.
    const a = useArena.getState();
    if (live.syncRetries++ < 1 && a.match && a.you) { live.loadedSent = ''; void request({ t: 'rejoin', match: a.match.id, key: a.you.key }).then(() => sceneLoaded(live.sceneReady)); deploy.useDeploy.setState({ stageAt: performance.now(), slow: true }); }
    else deploy.fail('The match did not confirm your arrival.', 'rejoin');
  } else if (stage === 'recovering') deploy.fail('The connection to the arena was lost.', 'rejoin');
});
deploy.onReport(t => raw({ t: 'diag', d: { cid: t.cid, ok: t.ok, total: t.total, bytes: t.bytes, retries: t.retries, tier: t.tier, failed: t.ok ? null : t.stage, stages: t.stages } }));
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
if (QA_HOOKS && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__arenaDeploy = () => { const d = deploy.useDeploy.getState(); return { stage: d.stage, marks: d.marks, files: d.files, bytes: d.bytes, retries: d.retries, slow: d.slow, failure: d.failure, pending: d.pending }; };
if (QA_HOOKS && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__arena = {
  state: () => { const a = useArena.getState(); return { phase: a.phase, status: a.status, match: a.match && { id: a.match.id, kind: a.match.kind, code: a.match.code, state: a.match.state, players: a.match.players.length }, you: a.you, hud: a.hud }; },
  remotes: () => [...live.remotes.values()].filter(r => (r.flags & 1) && r.seenAt).map(r => ({ num: r.num, team: r.team, x: r.pos.x, z: r.pos.z })),
  /** Re-read what the account owns (as the Armory does after a purchase). */
  refreshOwned: async () => { const r = await request({ t: 'owned' }); if (Array.isArray(r.owned)) useArena.getState().set({ owned: r.owned as string[] }); return r.owned; },
  /** Point the view (QA only: lets the browser suite aim without synthesising mouse movement). */
  look: (yaw: number, pitch: number) => { controls.yaw = yaw; controls.pitch = pitch; },
  deploy: () => ({ ...deploy.useDeploy.getState(), recent: deploy.recentDeployments() }),
  /** Ask for a match as the lobby does (QA: start Training on a chosen map and variant). */
  start: (kind: 'queue' | 'private' | 'training', data: Record<string, unknown>) => deployTo(kind, data),
  clock: () => matchElapsed(), broken: () => [...live.broken],
  /** Change arena settings (QA: the audio suite sets category volumes). */
  settings: (v: Record<string, unknown>) => { useArena.getState().setSettings(v); return useArena.getState().settings; },
  self: () => (live.sim ? { x: live.sim.x, y: live.sim.y, z: live.sim.z, alive: live.alive, ammo: live.sim.wpn[live.sim.slot].mag, reserve: live.sim.wpn[live.sim.slot].reserve, slot: live.sim.slot, weapon: weaponOf(live.sim).id, phase: live.sim.phase, pt: live.sim.pt, reloadStart: live.reloadStart, reloadTotal: live.reloadTotal, reloadEmpty: live.reloadEmpty, pending: live.pending.length, autoFiring: live.autoFiring, autoReason: live.autoReason } : null),
};
