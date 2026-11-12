// Combat Arena sound: what each game event sounds like. Every sound is a real recording in a sound bank
// (public/assets/arena/audio, built by scripts/assets/build-arena-audio.mjs from scripts/assets/arena-audio/recipes.mjs),
// played by the arena engine (src/arena/sound/engine.ts) through the event definitions in src/arena/sound/events.ts.
//
// Sounds are driven by what the game actually does, never by a key press: shots by the simulation's shot events
// (predicted for the player, the server's for everyone else), reload parts by the reload's own timer at the moments
// the first-person animation moves the parts (src/arena/sound/reloads.mjs), footsteps by the gait phase that also
// moves the camera, landings by the simulation's landing, hit reactions by the server's damage and health, respawns
// by the server's spawn. Cancelled actions stop their remaining sounds.
import { ear, audio } from '../audio/mixer';
import * as engine from './sound/engine';
import { EV, type EventName } from './sound/events';
import { reloadPlan, SHELL, CYCLES, crossed } from './sound/reloads.mjs';
import { createReactions, voiceFor, bodyPart } from './sound/reactions.mjs';
import { mapSurfaces } from './sound/surfaces.mjs';
import { WEAPON_BY_ID } from '../../shared/arena/weapons.mjs';
import { QA_HOOKS } from '../qa';

export type V = [number, number, number];
export type StepSurface = 'concrete' | 'asphalt' | 'gravel' | 'dirt' | 'grass' | 'sand' | 'metal' | 'container' | 'wood' | 'stone';
export type ImpactSurface = 'concrete' | 'brick' | 'metal' | 'sheet' | 'wood' | 'dirt' | 'sand' | 'foliage' | 'glass';
export type Gait = 'soft' | 'walk' | 'run';
export { engine };

const dist = (at: V) => Math.hypot(at[0] - ear.x, at[1] - ear.y, at[2] - ear.z);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const fire = (sound: string, ev: EventName, o: Partial<engine.PlayOptions> = {}) => engine.play(sound, { ...EV[ev], ...o, gain: (o.gain ?? 1) * (EV[ev].gain ?? 1) });
const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const SOFT_GROUND = new Set<StepSurface>(['dirt', 'gravel', 'grass', 'sand']);

// ---------------------------------------------------------------- which banks, when
let ownVoice = 'mA';
/**
 * Deployment: everything the player needs to hear the match (their weapons, the map's surfaces, movement, impacts),
 * then what can follow (the other weapon, explosives, announcer, voices, ambience). Never blocks deployment.
 */
export function prepareMatch(mapId: string, map: { boxes: { mat: string }[]; ambience?: string }, loadout: string[], ownNum: number, ownModel: string) {
  ownVoice = voiceFor(ownNum, ownModel);
  const guns = loadout.filter(id => WEAPON_BY_ID.get(id)?.fire !== 'melee');
  // The painted ground is everywhere; the surfaces of boxes (steel, timber, sandbags…) load as the player nears them.
  const ground = mapSurfaces(map).filter(s => s === 'asphalt' || s === 'gravel' || s === 'dirt').map(s => 'steps.' + s);
  const body = ownVoice === 'fA' ? 'breath.f' : 'breath.m';
  engine.pin([...guns.map(id => 'w.' + id), 'voice.' + ownVoice, 'steps.concrete', ...ground, body]);
  void engine.want(['ui', ...guns.slice(0, 1).map(id => 'w.' + id), 'steps.concrete', 'movement', 'handling', 'impacts'], 1);
  void engine.want([...guns.slice(1).map(id => 'w.' + id), ...ground, 'voice.' + ownVoice, body, 'explosives', 'vo'], 2);
  void engine.want(['amb.' + (map.ambience ?? mapId)], 3);
}
/** The arena opened: its interface sounds. */
export function prepareInterface() { void engine.want(['ui'], 1); }
const seen = new Set<string>();
/** Another player was seen holding `id`: load its bank (phones keep only a few weapon banks). */
export function prepareWeapon(id: string) {
  if (seen.has(id) || WEAPON_BY_ID.get(id)?.fire === 'melee') return; seen.add(id);
  void engine.want(['w.' + id], 3);
}
/** Another player's soldier: their voice. */
export function prepareVoice(num: number, model: string) { const v = voiceFor(num, model); if (!seen.has('v' + v)) { seen.add('v' + v); void engine.want(['voice.' + v], 3); } }
/** Keep the loaded weapon banks within budget (the player's own two always stay). */
export function trimBanks(loadout: string[]) {
  const keep = isPhone() ? 4 : 8;
  engine.release('w.', keep, loadout.map(id => 'w.' + id)); engine.release('voice.', isPhone() ? 4 : 6, ['voice.' + ownVoice]);
}
export function forgetPrepared() { seen.clear(); }
/** Surfaces near the player (boxes within reach): their footstep banks, before anyone steps on them. */
export function nearSurfaces(list: StepSurface[]) { void engine.want(list.map(s => 'steps.' + s), 2); }
const has = (sound: string) => engine.variants(sound) > 0;
const meta = (id: string) => (engine.bankMeta('w.' + id) ?? {}) as { tailAt?: number; casing?: string | null };

// ---------------------------------------------------------------- action timelines (reloads, bolts, pumps)
/**
 * A timeline of cues fired as its progress (0–1) passes them, a little early by each sound's lead so the sound's
 * loudest moment (a magazine latching) lands on the cue. Driven by a progress value, so it is exactly as far along
 * as the animation, and cancelled (with its playing sounds) when the action stops.
 */
interface Timeline { cues: [number, string][]; total: number; k: number; fired: Set<number>; weapon: string; tag: string; at: (() => V | null) | null; own: boolean; done: boolean }
function timeline(cues: [number, string][], total: number, weapon: string, tag: string, own: boolean, at: (() => V | null) | null = null): Timeline {
  return { cues, total, k: 0, fired: new Set(), weapon, tag, at, own, done: false };
}
function advance(t: Timeline, k: number) {
  if (t.done) return;
  t.k = Math.max(t.k, k);
  const nowT = engine.now();
  t.cues.forEach(([at, cue], i) => {
    if (t.fired.has(i)) return;
    const sound = cueSound(t.weapon, cue), lead = sound ? Math.min(.25, engine.leadOf(sound)) : 0;
    if (at - lead / t.total > t.k + .012) return;
    t.fired.add(i);
    if (!sound) return;
    playCue(t, cue, sound, nowT + Math.max(0, (at - t.k) * t.total));
  });
  if (t.fired.size === t.cues.length) t.done = true;
}
function cancel(t: Timeline | null) { if (t && !t.done) { t.done = true; engine.stopTag(t.tag, .04); } }
/** The sound for a cue: the weapon's own part, else the shared handling Foley. */
function cueSound(weapon: string, cue: string): string | null {
  if (cue === 'magDrop' || cue === 'cases' || cue === 'case') return 'impacts/magDrop';
  if (cue === 'raise' && WEAPON_BY_ID.get(weapon)?.fire === 'melee') return 'handling/drawBlade';
  const own = `w.${weapon}/${cue}`; if (has(own)) return own;
  const shared = cue === 'shellGrab' ? 'handling/grab' : cue === 'belt' ? 'handling/settle' : `handling/${cue}`;
  return has(shared) ? shared : null;
}
let ownFeet: () => StepSurface = () => 'concrete';
function playCue(t: Timeline, cue: string, sound: string, peakAt: number) {
  const at = t.at?.() ?? undefined, ev: EventName = t.own ? (sound.startsWith('handling') ? 'handlingOwn' : 'mechOwn') : 'mechRemote';
  if (cue === 'magDrop') { surfaceDrop(at, t.own ? ownFeet() : 'concrete', t.tag); return; }
  if (cue === 'cases' || cue === 'case') { casings(t.weapon, at, t.own, cue === 'cases' ? 4 : 1); return; }
  fire(sound, ev, { at, peakAt, tag: t.tag, emitter: t.tag, perEmitter: 3, gain: cue === 'shellGrab' ? .6 : 1 });
}
function surfaceDrop(at: V | undefined, surface: StepSurface, tag: string) {
  const soft = SOFT_GROUND.has(surface);
  // The magazine leaves the hand at chest height: about 0.4 s to the ground.
  fire(soft ? 'impacts/magDropSoft' : 'impacts/magDrop', 'magDrop', { at: at ?? feet(), delay: .38, tag, direct: !at, rate: surface === 'metal' || surface === 'container' ? .92 : 1 });
}
const feet = (): V => [ear.x, ear.y - 1.5, ear.z];
function casings(weapon: string, at: V | undefined, own: boolean, n: number) {
  const kind = meta(weapon).casing ?? (weapon === 'thorn' ? 'large' : null); if (!kind && n === 1) return;
  const surface = own ? ownFeet() : 'concrete', soft = SOFT_GROUND.has(surface);
  const sound = soft ? 'impacts/caseSoft' : kind === 'pistol' ? 'impacts/casePistol' : kind === 'rifle' ? 'impacts/caseRifle' : kind === 'shell' ? 'impacts/caseShell' : 'impacts/caseLarge';
  for (let i = 0; i < n; i++) fire(sound, own ? 'casingOwn' : 'casing', { at: own ? undefined : at, delay: .32 + Math.random() * .14 + i * .05, rate: surface === 'metal' || surface === 'container' ? .95 : 1, gain: soft ? .8 : surface === 'metal' ? 1.2 : 1 });
}

// The player's own actions, advanced each frame by the scene with the same progress the animation uses.
const own = { reload: null as Timeline | null, shell: null as Timeline | null, lastPt: -1, cycle: null as Timeline | null, raise: null as Timeline | null };
export const actions = {
  /** The simulation started a reload (predicted). `ticks`: its length (for a shell reload, its first shell). */
  reloadStart(weapon: string, empty: boolean, ticks: number) {
    cancel(own.reload); cancel(own.shell); cancel(own.cycle); own.reload = own.shell = own.cycle = null; own.lastPt = -1;
    const w = WEAPON_BY_ID.get(weapon); if (!w) return;
    if (w.reloadMode === 'shell') { own.reload = timeline(SHELL.start as [number, string][], (w.reloadStart ?? 0) / 60, weapon, 'own-reload', true); return; }
    const plan = reloadPlan(weapon, empty); if (!plan) return;
    own.reload = timeline(plan.cues as [number, string][], ticks / 60, weapon, 'own-reload', true);
  },
  /**
   * Each frame: the reload's progress k (0–1, as the animation draws it), or null when no reload is running
   * (a reload that stops before its end was interrupted: its remaining parts are cancelled).
   */
  reloadFrame(weapon: string, k: number | null) {
    const t = own.reload; if (!t || own.shell || WEAPON_BY_ID.get(weapon)?.reloadMode === 'shell') return;
    if (k == null || t.weapon !== weapon) { if (t.k < .97) cancel(t); own.reload = null; return; }
    advance(t, k);
  },
  /**
   * Each frame of a shell-by-shell reload: the phase timer `pt` (ticks) counts down through the lift (the first
   * shell only) and then each shell's `reload` ticks, starting over for every shell; null when the reload ended.
   */
  shellFrame(weapon: string, pt: number | null) {
    const w = WEAPON_BY_ID.get(weapon), each = w?.reload ?? 0; if (!own.reload || !w || !each || own.reload.weapon !== weapon) return;
    if (pt == null) { cancel(own.shell); own.reload = own.shell = null; own.lastPt = -1; return; }
    if (own.lastPt >= 0 && pt > own.lastPt + 1) own.shell = null; // the next shell began
    own.lastPt = pt;
    if (pt > each) { advance(own.reload, 1 - (pt - each) / Math.max(1, w.reloadStart ?? 1)); return; }
    advance(own.reload, 1);
    own.shell ??= timeline(SHELL.each as [number, string][], each / 60, weapon, 'own-reload', true);
    advance(own.shell, 1 - pt / each);
  },
  /** A shot from a weapon whose action is worked between shots (pump, bolt): the stroke's cues follow the cooldown. */
  cycleStart(weapon: string, cooldownTicks: number) {
    const c = CYCLES[weapon as keyof typeof CYCLES]; if (!c) return;
    cancel(own.cycle); own.cycle = timeline(c as [number, string][], cooldownTicks / 60, weapon, 'own-cycle', true);
  },
  cycleFrame(weapon: string, u: number | null) { const t = own.cycle; if (!t) return; if (u == null || t.weapon !== weapon) { if (t.k < .95) cancel(t); own.cycle = null; return; } advance(t, u); },
  /** Weapon switch: cancels the reload; the swing across the body now, the new weapon's grip as it comes up. */
  switchTo(weapon: string, swapTicks: number) {
    cancel(own.reload); cancel(own.shell); cancel(own.cycle); own.reload = own.shell = own.cycle = null;
    fire('handling/swap', 'handlingOwn', { tag: 'own-switch' });
    cancel(own.raise); own.raise = timeline([[.55, 'raise'], [.92, 'settle']], swapTicks / 60, weapon, 'own-switch', true);
  },
  switchFrame(k: number | null) { const t = own.raise; if (!t) return; if (k == null) { own.raise = null; return; } advance(t, k); },
  reset() { for (const t of [own.reload, own.shell, own.cycle, own.raise]) cancel(t); own.reload = own.shell = own.cycle = own.raise = null; for (const t of remote.values()) { cancel(t.reload); cancel(t.cycle); } remote.clear(); },
};

// Other players' reloads and actions, timed from the server's events (their soldiers do not animate reloads).
const remote = new Map<number, { reload: Timeline | null; cycle: Timeline | null; started: number; cycleStarted: number }>();
export const remoteActions = {
  reload(num: number, weapon: string, empty: boolean, at: () => V | null) {
    const w = WEAPON_BY_ID.get(weapon); if (!w) return;
    const r = remote.get(num) ?? { reload: null, cycle: null, started: 0, cycleStarted: 0 }; remote.set(num, r);
    cancel(r.reload);
    const each = w.reload ?? 30, ticks = w.reloadMode === 'shell' ? (w.reloadStart ?? 0) + each * 3 : (empty ? w.reloadEmpty : w.reload) ?? 60;
    const cues = w.reloadMode === 'shell' ? [[.1, 'grab'], ...[0, 1, 2].map(i => [((w.reloadStart ?? 0) + each * (i + .55)) / ticks, 'shellIn'])] as [number, string][] : (reloadPlan(weapon, empty)?.cues ?? []) as [number, string][];
    r.reload = timeline(cues, ticks / 60, weapon, 'r' + num, false, at); r.started = performance.now();
  },
  cycle(num: number, weapon: string, at: () => V | null) {
    const c = CYCLES[weapon as keyof typeof CYCLES], w = WEAPON_BY_ID.get(weapon); if (!c || !w?.rpm) return;
    const r = remote.get(num) ?? { reload: null, cycle: null, started: 0, cycleStarted: 0 }; remote.set(num, r);
    cancel(r.cycle); r.cycle = timeline(c as [number, string][], 60 / w.rpm, weapon, 'rc' + num, false, at); r.cycleStarted = performance.now();
  },
  /** Each frame: advance by elapsed time; `reloading` is the reload flag from the latest snapshot. */
  frame(num: number, reloading: boolean, alive: boolean) {
    const r = remote.get(num); if (!r) return;
    const now = performance.now();
    if (r.reload) { const k = (now - r.started) / 1000 / r.reload.total; if (!alive || (!reloading && k > .2 && k < .95)) { cancel(r.reload); r.reload = null; } else { advance(r.reload, k); if (r.reload.done) r.reload = null; } }
    if (r.cycle) { const k = (now - r.cycleStarted) / 1000 / r.cycle.total; if (!alive) { cancel(r.cycle); r.cycle = null; } else { advance(r.cycle, k); if (r.cycle.done) r.cycle = null; } }
  },
  /** The player fired, switched or left: whatever they were doing stops. */
  interrupt(num: number) { const r = remote.get(num); if (r) { cancel(r.reload); r.reload = null; } },
  forget(num: number) { const r = remote.get(num); if (r) { cancel(r.reload); cancel(r.cycle); } remote.delete(num); },
};

// ---------------------------------------------------------------- weapons
let shotsBy = new Map<number, number>();
/** A decoded weapon bank to stand in for `weapon` (same class first). */
function standIn(weapon: string): string | null {
  const cat = WEAPON_BY_ID.get(weapon)?.category, ids = [...WEAPON_BY_ID.values()].filter(w => w.fire !== 'melee' && engine.ready('w.' + w.id));
  const pick = ids.find(w => w.category === cat) ?? ids[0];
  return pick ? 'w.' + pick.id : null;
}
/** What is underfoot at a point (set by the scene from the map: the box's material or the painted ground). */
let groundOf: (x: number, y: number, z: number) => { surface: StepSurface; stairs: boolean } = () => ({ surface: 'concrete', stairs: false });
export function setGroundProvider(fn: typeof groundOf, feetOfPlayer: () => StepSurface) { groundOf = fn; ownFeet = feetOfPlayer; }
export const ground = (x: number, y: number, z: number) => groundOf(x, y, z);

export const sfx = {
  /** A gunshot: the player's own (no position) or another player's, layered by distance. */
  gun(weapon: string, at?: V, shooter = 0) {
    const bank = 'w.' + weapon, tailAt = meta(weapon).tailAt ?? .1, indoor = engine.indoorAmount();
    if (!at) {
      fire(bank + '/shot', 'shotOwn', { emitter: 'own' });
      // The outdoor reflections are what tells you how open the space is; under a roof the room's reverb takes over.
      fire(bank + '/tail', 'tailOwn', { emitter: 'own', delay: tailAt, gain: 1 - indoor * .45 });
      engine.duck(.6, .22);
      return;
    }
    const d = dist(at), em = 's' + shooter;
    remoteActions.interrupt(shooter);
    // Never silent: until this weapon's bank is decoded (first sighting, or reloaded after the memory budget let it go),
    // a loaded weapon of the same class stands in.
    let b = bank;
    if (!engine.ready(bank)) { prepareWeapon(weapon); seen.delete(weapon); b = standIn(weapon) ?? bank; }
    // Near (shot and tail) fades out between 20 and 60 m; the mid-distance microphone fades in from 12 m and gives way
    // to the far version from 70 m; air absorption and the speed of sound are applied by the engine.
    const near = 1 - clamp01((d - 20) / 40), mid = clamp01((d - 12) / 23) * (1 - clamp01((d - 70) / 60)), far = clamp01((d - 70) / 60);
    if (near > 0) { fire(b + '/shot', 'shotNear', { at, gain: near, emitter: em }); fire(b + '/tail', 'tailNear', { at, gain: near * (1 - indoor * .3), emitter: em, delay: tailAt }); }
    if (mid > 0 || far > 0) {
      // A busy distant automatic weapon: one report per ~70 ms is enough (the rest would only smear).
      const last = shotsBy.get(shooter) ?? 0, t = performance.now();
      if (d > 40 && t - last < 70) return;
      shotsBy.set(shooter, t); if (shotsBy.size > 64) shotsBy = new Map([...shotsBy].slice(-32));
      if (mid > 0) fire(b + '/mid', 'shotMid', { at, gain: mid, emitter: em });
      if (far > 0) fire(b + '/far', 'shotFar', { at, gain: far, emitter: em });
    }
  },
  /** A round passing close by: a supersonic snap (rifles) or a whiz (pistol and SMG rounds). */
  flyby(weapon: string, from: V, to: V) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], len = Math.hypot(dx, dy, dz) || 1;
    const t = Math.max(0, Math.min(1, ((ear.x - from[0]) * dx + (ear.y - from[1]) * dy + (ear.z - from[2]) * dz) / (len * len)));
    const px = from[0] + dx * t, py = from[1] + dy * t, pz = from[2] + dz * t, miss = Math.hypot(px - ear.x, py - ear.y, pz - ear.z);
    if (miss > 3.2 || t <= 0 || t >= 1) return;
    const w = WEAPON_BY_ID.get(weapon), subsonic = w?.category === 'smg' || w?.category === 'pistol' || w?.category === 'shotgun';
    fire(subsonic ? 'impacts/whiz' : 'impacts/snap', 'flyby', { at: [px, py, pz], gain: 1 - miss / 3.2 });
  },
  /** The player's own shot: the spent case (if this weapon ejects one now) lands on what is underfoot. */
  ejected(weapon: string) { casings(weapon, undefined, true, 1); },
  dry(weapon: string) { fire(`w.${weapon}/dry`, 'dryOwn'); },
  ads() { fire('handling/ads', 'handlingOwn', { gain: .7 }); },
  /** Melee: a knife, an axe, or a rifle butt (quick melee) through the air; its strike when it connects. */
  swing(kind: 'knife' | 'axe' | 'butt', at?: V) {
    lastSwing = { kind, at: performance.now() };
    const sound = kind === 'knife' ? 'handling/swingKnife' : kind === 'axe' ? 'handling/swingHeavy' : 'handling/swingRifle';
    if (at) fire(sound, 'mechRemote', { at, gain: .9 }); else fire(sound, 'handlingOwn', { gain: 1.2 });
  },
  /** A round (or a blade) striking a surface, heard from where it struck. */
  impact(surface: ImpactSurface, at: V) {
    fire('impacts/' + surface, 'impact', { at, key: 'imp' + surface });
    if ((surface === 'metal' || surface === 'sheet') && Math.random() < .22) fire('impacts/ricochet', 'ricochet', { at, delay: .01 });
  },
  /**
   * A round stopped by a soldier, by where it struck (helmet, plate carrier, cloth). `own`: the player was hit —
   * the sound is placed a little toward the attacker, so the hit itself says where it came from.
   */
  bodyHit(part: 'helmet' | 'armour' | 'flesh', at: V, own = false) {
    fire('impacts/' + part, own ? 'bodyHitOwn' : 'bodyHit', { at, key: own ? undefined : 'body', direct: own });
  },
  /** Where on a standing (or crouching) soldier at `feetY` a point at height `y` is. */
  partAt: (y: number, feetY: number, crouch = false) => bodyPart(y - feetY, crouch ? 1.25 : 1.8) as 'helmet' | 'armour' | 'flesh',
  /** A melee hit landing (the player's own swing that the server confirmed). */
  meleeHit(at: V) { const k = lastSwing.kind; fire(k === 'knife' ? 'handling/stab' : k === 'axe' ? 'handling/chop' : 'handling/butt', 'bodyHit', { at }); },
  // ---------------------------------------------------------------- movement
  /** A footstep on a surface (with clothing and equipment under it). `at` is undefined for the player. */
  step(surface: StepSurface, gait: Gait, opts: { at?: V; enemy?: boolean; stairs?: boolean } = {}) {
    const bank = 'steps.' + surface, s = engine.ready(bank) ? bank : 'steps.concrete';
    if (s !== bank) void engine.want([bank], 2);
    const sound = opts.stairs && has(s + '/stairs') && gait !== 'soft' ? s + '/stairs' : `${s}/${gait}`;
    const ev: EventName = !opts.at ? 'stepOwn' : opts.enemy ? 'stepEnemy' : 'stepFriend';
    const g = gait === 'soft' ? .62 : gait === 'run' ? 1.05 : 1, near = !opts.at || dist(opts.at) < 11;
    fire(sound, ev, { at: opts.at, gain: g, emitter: opts.at ? undefined : 'own-step' });
    if (!near) return;
    // Clothing on most steps, equipment on harder ones — quiet under the step, never a rattle on every footfall.
    const fev: EventName = opts.at ? 'foleyRemote' : 'foleyOwn';
    if (Math.random() < (gait === 'run' ? .6 : gait === 'walk' ? .35 : .2)) fire(Math.random() < .7 ? 'movement/cloth' : 'movement/leather', fev, { at: opts.at, delay: .01 + Math.random() * .03, gain: gait === 'run' ? 1 : .7 });
    if (gait === 'run' && Math.random() < .45) fire('movement/gearLight', fev, { at: opts.at, delay: .03 + Math.random() * .04, gain: .8 });
  },
  /** A sudden stop or a turn on the spot: the soles scuff, the clothing swings. */
  scuff(surface: StepSurface, at?: V, turn = false) {
    const bank = engine.ready('steps.' + surface) ? 'steps.' + surface : 'steps.concrete';
    fire(bank + '/scuff', at ? 'foleyRemote' : 'foleyOwn', { at, gain: 1.1 });
    if (turn) fire('movement/whoosh', at ? 'foleyRemote' : 'foleyOwn', { at, gain: .55 });
  },
  jump(surface: StepSurface, at?: V, sprinting = false) {
    sfx.scuff(surface, at);
    fire('movement/whoosh', at ? 'foleyRemote' : 'foleyOwn', { at, gain: .7, delay: .03 });
    if (!at && sprinting && Math.random() < .3) sfx.voice(null, 'effort');
  },
  /** Landing: louder and heavier the faster the fall; a hard landing shakes the equipment (and the breath out). */
  land(surface: StepSurface, speed: number, at?: V) {
    const k = clamp01((speed - 5) / 8), bank = engine.ready('steps.' + surface) ? 'steps.' + surface : 'steps.concrete';
    fire(bank + '/land', at ? 'landRemote' : 'landOwn', { at, gain: .55 + .45 * k });
    if (k > .45) fire('movement/gearHeavy', at ? 'foleyRemote' : 'foleyOwn', { at, gain: .5 + .5 * k, delay: .02 });
    if (!at && k > .7 && Math.random() < .5) sfx.voice(null, 'effort');
  },
  /** Falling fast: the air past the ears (once per fall). */
  falling() { fire('movement/whoosh', 'foleyOwn', { gain: .55, rate: .8 }); },
  slide(surface: StepSurface, at?: V) {
    fire(SOFT_GROUND.has(surface) ? 'movement/slideSoft' : 'movement/slideHard', at ? 'slideRemote' : 'slideOwn', { at });
    fire('movement/whoosh', at ? 'foleyRemote' : 'foleyOwn', { at, gain: .6 });
  },
  spawn(at?: V) { fire('movement/spawn', at ? 'foleyRemote' : 'foleyOwn', { at, gain: at ? .6 : .8 }); breath.reset(); },
  // ---------------------------------------------------------------- characters
  /** A soldier's vocal reaction (`num` null: the player). */
  voice(num: number | null, kind: 'hurt' | 'heavy' | 'severe' | 'death' | 'effort', at?: V, model = '') {
    const v = num == null ? ownVoice : voiceFor(num, model);
    fire(`voice.${v}/${kind}`, num == null ? 'voiceOwn' : 'voiceRemote', { at: num == null ? undefined : at, emitter: 'v' + (num ?? 'own'), perEmitter: 1, gain: kind === 'effort' ? .7 : 1 });
  },
  /** An eliminated soldier: the reaction, then the body and equipment hitting the ground as the fall ends. */
  death(num: number | null, at: V | undefined, model = '', life = 0) {
    if (!reactions.death(num ?? 'own', life, performance.now() / 1000)) return;
    sfx.voice(num, 'death', at, model);
    fire('movement/bodyfall', 'bodyfall', { at: at ? [at[0], at[1] - .9, at[2]] : feet(), delay: num == null ? .6 : .42, direct: !at });
    fire('movement/gearHeavy', at ? 'foleyRemote' : 'foleyOwn', { at, delay: num == null ? .64 : .46, gain: .7 });
  },
  /** Validated damage to a soldier: one reaction for the combined severity of hits arriving together. */
  hurt(num: number | null, damage: number, hpAfter: number, at?: V, model = '') {
    // Hits arriving within 0.1 s are one reaction, at their combined severity (and about a human's reaction time late).
    const key = num ?? 'own', p = pendingHits.get(key);
    if (p) { p.damage += damage; p.hp = hpAfter; p.at = at ?? p.at; return; }
    const hit = { damage, hp: hpAfter, at };
    pendingHits.set(key, hit);
    setTimeout(() => {
      pendingHits.delete(key);
      if (hit.hp <= 0) return; // the elimination is its own reaction
      const kind = reactions.hit(key, hit.damage, hit.hp, performance.now() / 1000);
      if (kind) sfx.voice(num, kind, hit.at, model);
    }, 100);
  },
  // ---------------------------------------------------------------- equipment and explosives
  throw(kind: string) {
    fire('handling/pin', 'throwOwn'); if (kind === 'frag' || kind === 'tack') fire('handling/spoon', 'throwOwn', { delay: .16 });
    fire('handling/throwArm', 'throwOwn', { delay: .22 });
    if (kind === 'frag' && Math.random() < .5) announcer.say(ownVoice === 'fA' ? 'grenadeF' : 'grenade', { gain: .7, radio: false });
  },
  bounce(at: V, surface: StepSurface, energy = 1) { fire(SOFT_GROUND.has(surface) ? 'explosives/bounceSoft' : 'explosives/bounce', 'bounce', { at, gain: .4 + .6 * clamp01(energy) }); },
  stick(at: V) { fire('explosives/stick', 'gadget', { at }); },
  armed(at: V) { fire('explosives/beep', 'gadget', { at, gain: .8 }); },
  boom(at: V) {
    const d = dist(at), mid = clamp01((d - 22) / 30), far = clamp01((d - 60) / 50);
    if (mid < 1) fire('explosives/blastNear', 'blastNear', { at, gain: 1 - mid });
    if (mid > 0 && far < 1) fire('explosives/blastMid', 'blastMid', { at, gain: mid * (1 - far) });
    if (far > 0) fire('explosives/blastFar', 'blastFar', { at, gain: far });
    if (d < 35) fire('explosives/debris', 'debris', { at, delay: .22 + Math.random() * .1 });
    if (d < 25) { engine.duck(.35, .7); engine.duck(.75, .5, 'footsteps'); }
  },
  flash(at: V) { fire('explosives/flashBang', 'flashBang', { at }); },
  deafen: (ms: number) => engine.deafen(ms),
  smoke(at: V, ms: number) {
    fire('explosives/smokePop', 'gadget', { at });
    const l = engine.loop('explosives/smokeHiss', { cat: 'explosions', at, gain: .55, ref: 3, rolloff: 1.1, fade: .4 });
    if (l) setTimeout(() => l.stop(1.5), Math.max(1000, Math.min(ms, 9000) - 1500));
  },
  crate(at: V) { fire('explosives/crate', 'gadget', { at, gain: 1.2 }); },
  strikeWarning(at: V) { fire('explosives/alarm', 'gadget', { at, gain: .9 }); },
  resupplied() { fire('handling/resupply', 'handlingOwn', { gain: 1.2 }); },
  /** Another player switching weapons: the sling and the weapon swung across, quietly, from where they are. */
  remoteSwap(at: V) { fire('handling/swap', 'mechRemote', { at, gain: .6 }); },
  // ---------------------------------------------------------------- interface (UI bus)
  ui(name: 'click' | 'hover' | 'confirm' | 'select' | 'back' | 'toggle' | 'tick' | 'error' | 'purchase' | 'equip' | 'medal' | 'streak' | 'countdown' | 'notify' | 'ping') { fire('ui/' + name, 'ui', { gain: name === 'hover' ? .7 : 1 }); },
  hit() { fire('ui/hit', 'hitMarker'); },
  headshot() { fire('ui/headshot', 'hitMarker'); },
  kill() { fire('ui/kill', 'hitMarker'); },
};
let lastSwing = { kind: 'knife' as 'knife' | 'axe' | 'butt', at: 0 };
const pendingHits = new Map<number | string, { damage: number; hp: number; at?: V }>();
const reactions = createReactions();
export const recentSwing = () => lastSwing;

// ---------------------------------------------------------------- breathing (the player's exertion)
const breath = (() => {
  let level = 0, handle: engine.LoopHandle | null = null, sprintT = 0;
  return {
    /** Each frame: sprinting raises the breath over a few seconds, rest lets it settle; little health keeps it strained. */
    frame(dt: number, sprinting: boolean, hp: number, alive: boolean) {
      sprintT = sprinting ? Math.min(6, sprintT + dt) : Math.max(0, sprintT - dt * .9);
      const want = alive ? Math.max(clamp01((sprintT - 1.2) / 3.5), hp < 35 ? .55 : 0) : 0;
      level += (want - level) * Math.min(1, dt * (want > level ? .8 : .35));
      if (level > .06 && !handle) handle = engine.loop(ownVoice === 'fA' ? 'breath.f/loop' : 'breath.m/loop', { cat: 'character', gain: 0, fade: 1 });
      if (handle) { handle.setGain(.5 * level, .3); if (level < .03) { handle.stop(.8); handle = null; } }
    },
    reset() { sprintT = 0; level = 0; handle?.stop(.5); handle = null; },
  };
})();
export const breathing = breath;

// ---------------------------------------------------------------- announcer (one line at a time)
export const announcer = (() => {
  const queue: { line: string; gain: number }[] = []; let busyUntil = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const lastSaid = new Map<string, number>();
  const next = () => {
    timer = undefined; const item = queue.shift(); if (!item) return;
    const t = performance.now(), sound = 'vo/' + item.line, len = Math.max(.6, engine.leadOf(sound) * 2 + .5);
    if (fire(sound, 'announcer', { gain: item.gain })) { engine.duck(.55, len, 'environment'); busyUntil = t + len * 1000 + 250; }
    if (queue.length) timer = setTimeout(next, Math.max(50, busyUntil - performance.now()));
  };
  return {
    /** Say a line (dropped if the same line was said in the last `gap` seconds; queued behind one that is playing). */
    say(line: string, o: { gain?: number; gap?: number; radio?: boolean } = {}) {
      const t = performance.now(); if (t - (lastSaid.get(line) ?? -1e9) < (o.gap ?? 4) * 1000) return; lastSaid.set(line, t);
      if (queue.length > 2) queue.shift();
      queue.push({ line, gain: o.gain ?? 1 });
      if (!timer) timer = setTimeout(next, Math.max(0, busyUntil - t));
    },
    clear() { queue.length = 0; clearTimeout(timer); timer = undefined; busyUntil = 0; },
  };
})();
/** The match countdown, read out over its last three seconds. */
export function countdown(ms: number) {
  const s = Math.floor(ms / 1000);
  for (const [n, line] of [[3, 'three'], [2, 'two'], [1, 'one']] as const) if (s >= n) setTimeout(() => { announcer.say(line, { gap: .5 }); sfx.ui('countdown'); }, ms - n * 1000);
}

// ---------------------------------------------------------------- surroundings
/**
 * The map's ambience: beds (wind outside, the district beyond the walls, a room tone under roofs), machines and
 * electrical hum heard from where they are, and occasional distant activity. Indoors the outside is muffled.
 */
const amb = { map: '', beds: {} as Record<string, engine.LoopHandle | null>, spots: [] as { at: V; kind: 'machine' | 'hum'; h: engine.LoopHandle | null }[], next: 0, indoor: 0, env: 1 };
export function startAmbience(mapId: string, emitters: { at: V; kind: 'machine' | 'hum' }[]) {
  stopArenaAmbience(); amb.map = mapId === 'metropolis' ? 'foundry' : mapId; amb.spots = emitters.map(e => ({ ...e, h: null })); amb.next = performance.now() + 4000;
}
/** Each frame (cheap): start beds when their bank is ready, keep the nearest machines playing, place one-shots. */
export function ambienceFrame(listener: V) {
  if (!amb.map || !audio()) return;
  const bank = 'amb.' + amb.map; if (!engine.ready(bank)) return;
  for (const k of ['wind', 'district', 'interior'] as const) if (!amb.beds[k]) amb.beds[k] = engine.loop(`${bank}/${k}`, { cat: 'environment', gain: 0, fade: 2 });
  applyIndoor();
  // The three nearest machine or hum emitters within earshot play; the others are stopped.
  const ranked = amb.spots.map(s => ({ s, d: Math.hypot(s.at[0] - listener[0], s.at[2] - listener[2]) })).sort((a, b) => a.d - b.d);
  ranked.forEach(({ s, d }, i) => {
    const on = i < 3 && d < (s.kind === 'machine' ? 30 : 14);
    if (on && !s.h) s.h = engine.loop(`${bank}/${s.kind}`, { cat: 'environment', at: s.at, gain: s.kind === 'machine' ? .55 : .3, ref: s.kind === 'machine' ? 3 : 1.5, rolloff: 1.2, fade: 1.5 });
    else if (!on && s.h) { s.h.stop(1); s.h = null; }
  });
  const t = performance.now();
  if (t > amb.next) {
    amb.next = t + 7000 + Math.random() * 9000;
    // Distant activity: a creak, a clank, a chain, a flag — somewhere 15–40 m off, never on top of the player.
    const kinds = ['creak', 'clank', 'chain', 'flag'], kind = kinds[Math.floor(Math.random() * kinds.length)], a = Math.random() * Math.PI * 2, r = 15 + Math.random() * 25;
    fire(`${bank}/${kind}`, 'ambientOneShot', { at: [listener[0] + Math.cos(a) * r, listener[1] + 1 + Math.random() * 3, listener[2] + Math.sin(a) * r], gain: kind === 'flag' ? .6 : 1 });
  }
}
function applyIndoor() {
  const i = amb.indoor, b = amb.beds;
  b.wind?.setGain((1 - .7 * i) * .9, .5); b.wind?.setLowpass(i > .5 ? 900 : 20000, .4);
  b.district?.setGain((1 - .5 * i) * .8, .5); b.district?.setLowpass(i > .5 ? 700 : 20000, .4);
  b.interior?.setGain(.2 + .8 * i, .5);
}
/** 0 outdoors … 1 under a roof: the listener's share of reverb, the outside muffled. */
export function setIndoor(amount: number) { engine.setListenerIndoor(amount); if (amount !== amb.indoor) { amb.indoor = amount; applyIndoor(); } }
export function stopArenaAmbience() { for (const h of Object.values(amb.beds)) h?.stop(.8); amb.beds = {}; for (const s of amb.spots) s.h?.stop(.5); amb.spots = []; amb.map = ''; }
/** The match's sounds end with it (scheduled reload parts and loops included). */
export function stopMatchSounds() { actions.reset(); announcer.clear(); breath.reset(); reactions.clear(); engine.stopAll(); }

// QA builds only: the sound API for the browser audio suite (tests/browser-arena-audio.mjs).
if (QA_HOOKS && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__arenaSfx = { ...sfx, announcer, actions, remoteActions, prepareWeapon, prepareVoice, voiceFor };
