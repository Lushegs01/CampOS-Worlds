// Combat Arena sound: what each game event sounds like, on the arena audio engine (src/arena/sound/engine.ts) with
// designs from src/arena/sound/designs.ts. Sounds go through the game's mixer (Settings → Sound sets the master
// volume; 0 turns sound off) and each category has its own level (arena Settings → Sound).
import { loop, loadSounds, play as playRecorded, ear, audio, type Loop } from '../audio/mixer';
import * as engine from './sound/engine';
import { profileOf, GUNS, BY_CLASS, type Surface } from './sound/designs';
import { WEAPON_BY_ID } from '../../shared/arena/weapons.mjs';
import { QA_HOOKS } from '../qa';

export type Ground = 'concrete' | 'metal' | 'wood' | 'sand' | 'brick' | 'dirt' | 'foliage';
type V = [number, number, number];
export { engine };
export const tones = engine.tones;

// ---------------------------------------------------------------- variation without repetition
const turns = new Map<string, number>();
/** Round-robin over `n` variants, never the same one twice in a row. */
function variant(key: string, n: number) { const last = turns.get(key) ?? -1; let v = Math.floor(Math.random() * n); if (v === last) v = (v + 1) % n; turns.set(key, v); return v; }
const jitter = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;
const dist = (at: V) => Math.hypot(at[0] - ear.x, at[1] - ear.y, at[2] - ear.z);
const gunId = (id: string) => (GUNS[id] ? id : BY_CLASS[id] ?? 'vanguard');
const family = (id: string) => (WEAPON_BY_ID.get(id)?.fire === 'melee' ? 'blade' : profileOf(gunId(id)).family);

const prepared = new Set<string>();
/** Another player was seen holding `id`: render its shots in idle time, before the first one is heard. */
export function prepareWeapon(id: string) {
  if (prepared.has(id) || WEAPON_BY_ID.get(id)?.fire === 'melee') return; prepared.add(id);
  const g = gunId(id); engine.prepare([0, 1, 2, 3].map(v => `gun:${g}:near:${v}`).concat(`gun:${g}:far:0`, `gun:${g}:far:1`, `gun:${g}:tail:0`, `gun:${g}:tail:1`));
}
export function forgetPrepared() { prepared.clear(); }
// The sounds the player's own loadout needs, rendered ahead of time (idle slices) at deployment.
export function prepareLoadout(ids: string[]) {
  ids.forEach(id => prepared.add(id));
  const names: string[] = [];
  for (const raw of ids) {
    if (WEAPON_BY_ID.get(raw)?.fire === 'melee') { names.push('whoosh:0', 'whoosh:1'); continue; }
    const id = gunId(raw), f = family(raw);
    for (let v = 0; v < 4; v++) names.push(`gun:${id}:near:${v}`);
    names.push(`gun:${id}:tail:0`, `gun:${id}:tail:1`, `gun:${id}:far:0`, `mech:${f}:magout`, `mech:${f}:magin`, `mech:${f}:charge`, `mech:${f}:dry`, `mech:${f}:draw`);
    if (f === 'pump') names.push('mech:pump:pump', 'mech:pump:shell'); if (f === 'bolt') names.push('mech:bolt:boltaction');
  }
  names.push('impact:concrete:0', 'impact:metal:0', 'impact:flesh:0', 'body:0', 'land:0', 'casing:0');
  engine.prepare(names);
}

// ---------------------------------------------------------------- reload choreography
// Reload sounds follow the first-person animation (Scene.tsx updateViewmodel): magazine out at ~18 % of the reload,
// in at ~60 %, the action at ~84 % (rifles and SMGs after an empty magazine; pistols release the slide).
let reloadTimers: ReturnType<typeof setTimeout>[] = [];
function cancelReload() { reloadTimers.forEach(clearTimeout); reloadTimers = []; }

let shotsBy = new Map<number, number>();
export const sfx = {
  /** A gunshot: the player's own (no position) or another player's, layered by distance. */
  gun: (weapon: string, at?: V, shooter = 0) => {
    const id = gunId(weapon), g = profileOf(id);
    if (!at) {
      engine.play(`gun:${id}:near:${variant('own' + id, 4)}`, { cat: 'weapons', gain: .7 * g.loud, priority: 100, rate: jitter(.015), direct: true, send: .08, group: 'shot', emitter: 'own', perEmitter: 3 });
      engine.play(`gun:${id}:tail:${variant('ownt' + id, 2)}`, { cat: 'weapons', gain: g.tail.gain * 1.05, priority: 60, direct: true, send: .02, group: 'tail', emitter: 'own', perEmitter: 1 });
      engine.duck(.55, .2);
      return;
    }
    const d = dist(at);
    // Near layer fades out between 25 and 75 m while the distant layer fades in.
    const far = Math.min(1, Math.max(0, (d - 25) / 50));
    const em = 's' + shooter;
    if (far < 1) engine.play(`gun:${id}:near:${variant('n' + shooter, 4)}`, { cat: 'weapons', at, gain: .95 * g.loud * (1 - far), priority: 86, ref: 5, rolloff: .9, rate: jitter(.02), group: 'shot', send: .07, emitter: em, perEmitter: 2 });
    if (far > 0 || d > 15) {
      // A busy distant automatic weapon: one rumble per ~70 ms is enough (the rest would only smear).
      const last = shotsBy.get(shooter) ?? 0, now = performance.now();
      if (far > .3 && now - last < 70) return;
      shotsBy.set(shooter, now); if (shotsBy.size > 64) shotsBy = new Map([...shotsBy].slice(-32));
      // Fades in between 15 and 40 m, then only falls with distance (its own gentle curve: distant fire carries).
      const fadeIn = Math.min(1, Math.max(.2, (d - 15) / 25));
      engine.play(`gun:${id}:far:${variant('f' + shooter, 2)}`, { cat: 'weapons', at, gain: g.far * .75 * fadeIn, priority: 72, ref: 30, rolloff: .5, group: 'far', send: .04, emitter: em, perEmitter: 1 });
    }
    if (d < 60) engine.play(`gun:${id}:tail:${variant('t' + shooter, 2)}`, { cat: 'weapons', at, gain: g.tail.gain * .9, priority: 55, ref: 8, rolloff: .7, group: 'tail', send: .02, emitter: em, perEmitter: 1 });
  },
  /** A round passing close by: a supersonic snap (rifles) or a whiz (pistol and SMG rounds). */
  flyby: (weapon: string, from: V, to: V) => {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], len = Math.hypot(dx, dy, dz) || 1;
    const t = Math.max(0, Math.min(1, ((ear.x - from[0]) * dx + (ear.y - from[1]) * dy + (ear.z - from[2]) * dz) / (len * len)));
    const px = from[0] + dx * t, py = from[1] + dy * t, pz = from[2] + dz * t, miss = Math.hypot(px - ear.x, py - ear.y, pz - ear.z);
    if (miss > 3.2 || t <= 0 || t >= 1) return;
    const g = profileOf(gunId(weapon)), kind = g.crack > .4 ? 'snap' : 'whiz';
    engine.play(`flyby:${kind}:${variant('fly', 3)}`, { cat: 'weapons', at: [px, py, pz], gain: (1 - miss / 3.2) * (kind === 'snap' ? .55 : .45), priority: 90, ref: 1, rolloff: .5, direct: true, group: 'flyby' });
  },
  /** Magazine out, in, and the action, timed to the reload animation. `frames` is the reload's length at 60 Hz. */
  reload: (weapon: string, empty: boolean, frames: number) => {
    cancelReload();
    const f = family(weapon), ms = frames * 1000 / 60, w = WEAPON_BY_ID.get(weapon);
    const at = (k: number, name: string, gain = .55) => reloadTimers.push(setTimeout(() => engine.play(name, { cat: 'character', gain, priority: 65, direct: true, group: 'mech', rate: jitter(.03) }), k * ms));
    if (w?.reloadMode === 'shell') { at(0, `mech:${f}:draw`, .3); return; } // each shell sounds as it goes in
    if (f === 'revolver') { at(.08, `mech:${f}:cylinder`); at(.55, `mech:${f}:magin`, .5); at(.85, `mech:${f}:cylinder`, .5); return; }
    at(.16, `mech:${f}:magout`); at(.6, `mech:${f}:magin`, .7);
    if (empty || f === 'lmg') at(.83, f === 'bolt' ? `mech:${f}:boltaction` : `mech:${f}:charge`, .65);
  },
  /** One shell into a tube magazine. */
  shell: (weapon: string) => engine.play(`mech:${family(weapon)}:shell`, { cat: 'character', gain: .55, priority: 62, direct: true, group: 'mech', rate: jitter(.04) }),
  /** The pump or bolt cycled between shots. */
  cycle: (weapon: string) => { const f = family(weapon); if (f === 'pump' || f === 'bolt') setTimeout(() => engine.play(f === 'pump' ? 'mech:pump:pump' : 'mech:bolt:boltaction', { cat: 'character', gain: .6, priority: 70, direct: true, group: 'mech' }), f === 'pump' ? 180 : 260); },
  switch: (weapon = 'vanguard') => { cancelReload(); engine.play(`mech:${family(weapon)}:draw`, { cat: 'character', gain: .5, priority: 55, direct: true, group: 'mech', rate: jitter(.04) }); },
  dry: (weapon = 'vanguard') => engine.play(`mech:${family(weapon)}:dry`, { cat: 'character', gain: .7, priority: 70, direct: true, group: 'mech' }),
  ads: (weapon = 'vanguard') => engine.play(`mech:${family(weapon)}:ads`, { cat: 'character', gain: .35, priority: 30, direct: true, group: 'character' }),
  swing: (at?: V) => engine.play(`whoosh:${variant('sw', 3)}`, { cat: 'character', at, gain: .6, priority: 60, ref: 2, rolloff: 1.2, range: 25, direct: !at, rate: jitter(.08) }),
  throw: () => { engine.play('pin:0', { cat: 'character', gain: .45, priority: 50, direct: true }); engine.play(`whoosh:${variant('sw', 3)}`, { cat: 'character', gain: .5, priority: 50, direct: true, delay: .12 }); },
  /**
   * A footstep on a surface: the campus' recorded steps (hard, wood, soft) with a ringing plate on steel and gear
   * rattle when running. Enemies' steps are gameplay information: high priority and heard further.
   */
  step: (at?: V, gain = .25, ground: Ground = 'concrete', opts: { run?: boolean; enemy?: boolean } = {}) => {
    const name = ground === 'wood' ? 'step-wood' : ground === 'dirt' || ground === 'sand' || ground === 'foliage' ? 'step-grass' : 'step-hard';
    const range = opts.enemy ? 30 : 24;
    if (at && dist(at) > range) return;
    playRecorded(name, { at: at ? { x: at[0], y: at[1], z: at[2] } : undefined, gain: gain * 2.2 * stepVolume() * (at ? 1.2 : .85), rate: (ground === 'metal' ? 1.15 : ground === 'sand' ? .9 : 1) * jitter(.04), range, ref: at ? 2.5 : 2 });
    if (ground === 'metal') engine.play(`metalstep:${variant('ms', 4)}`, { cat: 'footsteps', at, gain: gain * 1.4, priority: opts.enemy ? 75 : 35, ref: 2, rolloff: 1.4, range, direct: !at, group: 'step', rate: jitter(.05) });
    if (opts.run && Math.random() < .55) engine.play(`gear:${variant('gr', 4)}`, { cat: 'footsteps', at, gain: gain * .9, priority: opts.enemy ? 70 : 20, ref: 2, rolloff: 1.5, range: 18, direct: !at, group: 'step', rate: jitter(.08) });
  },
  slide: () => engine.play(`slide:${variant('sl', 2)}`, { cat: 'footsteps', gain: .5, priority: 45, direct: true, group: 'step' }),
  jump: () => engine.play(`jump:${variant('jp', 2)}`, { cat: 'footsteps', gain: .35, priority: 30, direct: true, group: 'step' }),
  land: (speed = 7) => { const k = Math.min(1, Math.max(.3, (speed - 5) / 8)); engine.play(`land:${variant('ld', 3)}`, { cat: 'footsteps', gain: .45 + .45 * k, priority: 45, direct: true, group: 'step' }); if (k > .5) engine.play(`gear:${variant('gr', 4)}`, { cat: 'footsteps', gain: .5 * k, priority: 20, direct: true, group: 'step', delay: .03 }); },
  /** A round striking a surface, heard from where it landed. */
  impact: (ground: Ground, at: V) => engine.play(`impact:${ground as Surface}:${variant('im' + ground, 4)}`, { cat: 'environment', at, gain: ground === 'metal' ? .7 : .6, priority: 35, ref: 3, rolloff: 1.2, range: 60, group: 'impact', key: 'imp' + ground, rate: jitter(.06) }),
  flesh: (at: V) => engine.play(`impact:flesh:${variant('fl', 4)}`, { cat: 'character', at, gain: .7, priority: 70, ref: 3, rolloff: 1.1, range: 60, group: 'impact', key: 'flesh' }),
  casing: (ground: Ground = 'concrete') => engine.play(`casing:${variant('cs', 4)}`, { cat: 'environment', gain: ground === 'dirt' || ground === 'sand' || ground === 'foliage' ? .06 : .16, priority: 10, direct: true, delay: .3 + Math.random() * .12, group: 'casing', rate: jitter(.12) }),
  bolt: (weapon = 'longbow') => sfx.cycle(weapon),
  hurt: () => engine.play(`body:${variant('bd', 3)}`, { cat: 'character', gain: .75, priority: 92, direct: true, group: 'character' }),
  boom: (at: V) => {
    const d = dist(at), far = Math.min(1, Math.max(0, (d - 20) / 40));
    if (far < 1) engine.play(`boom:near:${variant('bn', 3)}`, { cat: 'explosions', at, gain: 1.15 * (1 - far * .7), priority: 95, ref: 6, rolloff: .8, send: .1 });
    if (far > 0) engine.play(`boom:far:${variant('bf', 2)}`, { cat: 'explosions', at, gain: .9 * far, priority: 88, ref: 20, rolloff: .5 });
    if (d < 25) engine.duck(.35, .6);
  },
  flash: (at: V) => engine.play('flashbang:0', { cat: 'explosions', at, gain: 1, priority: 94, ref: 5, rolloff: .8 }),
  /** Blinded by a flashbang: the world goes dull and rings for a while. */
  deafen: (ms: number) => engine.deafen(ms),
  smoke: (at: V) => engine.play('hiss:0', { cat: 'explosions', at, gain: .55, priority: 40, ref: 3, rolloff: 1 }),
  // ---------------------------------------------------------------- interface and announcements (UI bus)
  hit: () => { engine.tones([[2100, 0, .028]], .07, 'square'); engine.tones([[1050, 0, .04]], .08, 'sine'); },
  headshot: () => { engine.tones([[2900, 0, .05], [3800, .028, .09]], .08, 'square'); engine.tones([[1450, 0, .06]], .07, 'sine'); },
  kill: () => { engine.tones([[880, 0, .06], [1320, .055, .12]], .11); engine.tones([[110, 0, .12]], .14, 'sine'); },
  capture: (good: boolean) => engine.tones(good ? [[523, 0, .14], [659, .09, .14], [784, .18, .3]] : [[392, 0, .18], [311, .13, .32]], .1),
  streak: () => engine.tones([[660, 0, .1], [880, .08, .1], [1175, .16, .28]], .1),
  alarm: () => engine.tones([[740, 0, .12], [740, .25, .12], [740, .5, .12], [740, .75, .12]], .07, 'square'),
  beep: (high = false) => engine.tones([[high ? 1240 : 820, 0, .13]], .1, 'sine'),
  victory: () => { engine.tones([[523, 0, .4], [659, .14, .4], [784, .28, .45], [1047, .44, .9]], .1); engine.tones([[131, 0, 1.1]], .1, 'sine'); },
  defeat: () => { engine.tones([[392, 0, .45], [349, .24, .45], [262, .5, 1]], .09); engine.tones([[98, 0, 1.2]], .1, 'sine'); },
  ui: () => engine.tones([[1150, 0, .03]], .045, 'sine'),
};

// ---------------------------------------------------------------- surroundings
/** 0 outdoors … 1 under a roof: the listener's share of reverb (and quieter wind). */
export function setIndoor(amount: number) { engine.setListenerIndoor(amount); wind?.gain.setTargetAtTime(.2 * (1 - amount * .7) * envVolume(), audioTime(), .4); }
let wind: Loop | null = null, envVolume = () => 1, stepVolume = () => 1;
/** The volumes the recorded footsteps and the wind loop follow (they play through the campus mixer). */
export function setLoopVolumes(env: () => number, steps: () => number) { envVolume = env; stepVolume = steps; wind?.gain.setTargetAtTime(.2 * env(), audioTime(), .2); }
const audioTime = () => audio()?.ctx.currentTime ?? 0;
/** Outdoor wind while a match is open (the campus' recorded loop). */
export function startAmbience() { loadSounds(); wind ??= loop('wind', { gain: .2 * envVolume(), bus: 'ambience' }); }
export function stopArenaAmbience() { wind?.stop(.5); wind = null; }

// QA builds only: the sound API for the browser audio suite (tests/browser-arena-audio.mjs).
if (QA_HOOKS && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__arenaSfx = sfx;
