// The trailer's camera takes, staged in the real Òrìṣun Campus. Coordinates are the game's own metres
// (+x east, +z south; a heading of 0 faces south, π faces north). Every move was planned against the
// campus layout in shared/ and checked for clearance in survey stills and preview renders.
import * as THREE from 'three';
import type { Rig } from '../rig/cinema';
import { type Pose, type V3, orbit, fovFor, vec, path, travel, keyed, ease, seg, mix, shake, jolt, Follow } from '../rig/camera';

/**
 * One continuous camera take. `setup` places the world (it runs twice: before warm-up and again at the
 * start of the take); `act` gives the game its inputs before each frame; `cam` places the camera after the
 * game has moved. `t` is film seconds from the take's edit in-point: the `pre` handle runs from -pre, and
 * `lead` seconds before that are simulated but not captured.
 */
export interface Shot {
  id: string; frames: number; lead?: number; pre?: number;
  setup(r: Rig): void; act?(r: Rig, t: number): void; cam(r: Rig, t: number): Pose;
  /** Game time per film time at `t` (below 1: slow motion). */
  speed?(t: number): number;
  /** Motion-blur sub-frames for the frame at `t`. */
  blur?(t: number): number;
}

/** Edit handles: a take is rendered this much beyond its cut points at each end. */
const H = .2;
const take = (dur: number, pre = H, post = H) => ({ pre, frames: Math.round((pre + dur + post) * 30) });

// ------------------------------------------------------------------ cast (the game's own characters)
type Choice = { model: string; accessory: string; accent: string; skin?: string };
const HERO: Choice = { model: 'ibrahim', accessory: 'headphones', accent: '#e8b95e' };
const CAST: Record<string, [string, Choice]> = {
  ngozi: ['Ngozi', { model: 'ngozi', accessory: 'glasses', accent: '#b05f49' }],
  kelechi: ['Kelechi', { model: 'kelechi', accessory: 'backpack', accent: '#506b96' }],
  amara: ['Amara', { model: 'amara', accessory: 'headphones', accent: '#537d70' }],
  zainab: ['Zainab', { model: 'zainab', accessory: 'backpack', accent: '#eee9df' }],
  tunde: ['Tunde', { model: 'tunde', accessory: 'backpack', accent: '#353c4c' }],
  mel: ['Mel', { model: 'mel', accessory: 'glasses', accent: '#e8b95e' }],
  ada: ['Ada', { model: 'ada', accessory: 'backpack', accent: '#537d70' }],
  chidi: ['Chidi', { model: 'chidi', accessory: 'headphones', accent: '#b05f49' }],
};
const add = (r: Rig, who: string, x: number, z: number, heading: number) => r.addPeer(who, CAST[who][0], CAST[who][1], x, z, heading);
const seat = (r: Rig, who: string, x: number, z: number, id: string) => { add(r, who, x, z, 0).seat = id; };

const N = Math.PI, S = 0, E = Math.PI / 2, W = -Math.PI / 2;
const at = (r: Rig, y = 0) => new THREE.Vector3(r.player.x, y, r.player.z);
const add3 = (a: THREE.Vector3, x: number, y: number, z: number) => a.clone().add(new THREE.Vector3(x, y, z));
const lerpV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);
const pose = (pos: THREE.Vector3, look: THREE.Vector3, fov: number, roll = 0): Pose => ({ pos, look, fov, roll });

/** A follower kept per take (reset by setup), so camera lag repeats exactly. */
const follower = (r: Rig, key: string, stiffness: number) => (r.memory[key] ??= new Follow(stiffness)) as Follow;

// The courtyard road outside the gate: eastbound lane centre, and a straight route along it.
const EAST_LANE = 57.6, ROAD_EAST: [number, number][] = Array.from({ length: 41 }, (_, i) => [-120 + i * 6, EAST_LANE]);
// The basketball shot: from the right of the key, at the south hoop (shared/interactions.mjs HOOPS).
const SHOOT = { x: 45.2, z: 15.7 }, HOOP = { x: 44, y: 3.05, z: 11.575 };

// ------------------------------------------------------------------ scene 01 — the hook
// From far down the south avenue, a rush through the gate (opening |x| < 6.4 m, beam underside 5.95 m)
// and over the palm avenue, rising into the aerial over the courtyard.
const HOOK_PATH = path([[0, 2.4, 178], [0, 2.6, 120], [0, 2.9, 78], [0, 3.3, 51], [0, 6.2, 39], [0, 14.5, 31], [0, 26, 25.5], [0, 37, 22.5]]);
// Creep while the line of light opens, rush, burst under the gate on the 2.0 s downbeat, then brake hard.
const HOOK_SPEED: [number, number][] = [[0, .04], [.45, .07], [.8, .6], [1.3, 1], [2.0, .9], [2.4, .25], [3.1, .1], [4.2, .03]];
const hookPos = (t: number) => HOOK_PATH(travel(t, HOOK_SPEED));
// When the camera passes under the gate beam (for the impact jolt), found once.
const GATE_T = (() => { let a = 0, b = 4.2; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (hookPos(m).z > 50) a = m; else b = m; } return a; })();

// ------------------------------------------------------------------ the takes
export const SHOTS: Shot[] = [
  // Location scouting (tools/survey.mjs): the camera goes wherever it is told.
  {
    id: 'survey', frames: 1,
    setup: r => { r.avatar(HERO); r.place(0, 22, N); r.memory.pose ??= pose(vec([0, 200, 1]), vec([0, 0, 0]), 50); },
    cam: r => r.memory.pose as Pose,
  },

  {
    id: '01-hook', ...take(4.0, 0, H),
    setup: r => {
      r.tags = false; r.avatar(HERO); r.place(.8, 31, N);
      add(r, 'amara', -2.4, 20, N); add(r, 'kelechi', -1.3, 22.5, N); add(r, 'tunde', 14, 10.2, W);
      seat(r, 'ngozi', 7, 5.9, 'bench-16-l'); seat(r, 'zainab', 7, 5.9, 'bench-16-r');
    },
    act: r => {
      r.walk(N, false, .72);
      r.peerAlong('amara', [[-2.4, 20], [-2.4, 12.5], [-6, 10], [-16, 10]], 2.7);
      r.peerAlong('kelechi', [[-1.3, 22.5], [-1.3, 12.5], [-5, 10.6], [-15, 10.6]], 2.7);
      r.peerAlong('tunde', [[14, 10.2], [-4, 10.2]], 3.1);
    },
    cam: (r, t) => {
      const p = hookPos(t), w = ease.smoother(seg(t, 1.55, 3.5));
      const ahead = new THREE.Vector3(p.x, p.y + .5, p.z - 60), down = vec([0, 1, -17]);
      const look = lerpV(ahead, down, w);
      const rush = seg(t, .7, 1.4) * (1 - seg(t, 2.1, 3.2));
      if (p.z < 50) r.mark('gate');
      p.add(jolt(t, 0, .05)).add(jolt(t, GATE_T, .1, 7)).add(shake(t, .035 * rush, 6, 1));
      const fov = r.aspect < 1 ? keyed(t, [[0, 46], [.7, 48], [1.55, 70], [2.3, 64], [4.2, 60]]) : keyed(t, [[0, 28], [.7, 30], [1.55, 46], [2.3, 41], [4.2, 38]]);
      return pose(p, look, fov, keyed(t, [[1.8, 0], [3, -.025], [4.2, -.03]]));
    },
    blur: t => t > .8 && t < 2.5 ? 3 : 1,
  },

  // ------------------------------------------------------------------ scene 02 — enter the world
  // High orbit over the courtyard, a crane down past the Confluence into a low tracking shot behind the
  // player walking the north walk towards Horizon Auditorium.
  {
    id: '02-descend', ...take(3.0), lead: .3,
    setup: r => {
      r.tags = false; r.avatar(HERO); r.place(-1, -6.9, N);
      seat(r, 'ngozi', -7, 5.9, 'bench-17-l'); seat(r, 'zainab', -7, 5.9, 'bench-17-r');
      add(r, 'tunde', 9, -27.8, W); add(r, 'mel', -14, -28.6, E);
    },
    act: r => {
      r.walk(N, false, .8);
      r.peerAlong('tunde', [[9, -27.8], [1.6, -28.2], [1.6, -36]], 2.2);
      r.peerAlong('mel', [[-14, -28.6], [-3, -28.8]], 2.4);
    },
    cam: (r, t) => {
      const C = vec([0, 0, -13]), k = ease.inOut(seg(t, -.2, 2.6));
      const o = orbit(C, mix(46, 9, k), mix(.78, .26, k), mix(34, 3.5, k));
      const hero = at(r), f = add3(hero, .62, .62, 2.7);
      const w = ease.smoother(seg(t, 1.0, 2.75));
      const look = lerpV(add3(C, 0, 2.5, 0), add3(hero, -.25, 1.85, -8), w);
      return pose(lerpV(o, f, w).add(shake(t, .02, 2, 2)), look, fovFor(r.aspect, mix(54, 64, w)));
    },
  },
  // Lateral tracking shot: the player sprints west along the cross walk past the plaza; the avenue palm at
  // (-7.6, 16) sweeps through the foreground. It stops short of the flamboyant's low crown at (-18, 16).
  {
    id: '02-lateral', ...take(1.5), lead: .5,
    setup: r => { r.shadowsEveryFrame = true; r.tags = false; r.avatar(HERO); r.place(6.5, 10.2, W); },
    act: r => r.walk(W, true),
    cam: (r, t) => {
      const fl = follower(r, 'f', 9), hero = fl.update(at(r), r.dt);
      return pose(vec([Math.max(-11, hero.x + .8), 1.25, 17.6]).add(shake(t, .025, 4, 3)), vec([hero.x - .6, 1.05, hero.z - 2]), fovFor(r.aspect, 50));
    },
    blur: () => 2,
  },
  // Over the shoulder towards the library entrance, ending in a whip pan.
  {
    id: '02-shoulder', ...take(1.5), lead: .4,
    setup: r => { r.shadowsEveryFrame = true; r.tags = false; r.avatar(HERO); r.place(-30.4, 10.6, N); r.door('library-main', -1); },
    act: r => r.walk(N, true, .8),
    cam: (r, t) => {
      const hero = at(r), whip = ease.inExpo(seg(t, 1.15, 1.7));
      const pos = add3(hero, .55, 1.8, 2.4).add(shake(t, .03, 5, 4));
      const yaw = N + whip * 1.9, look = add3(pos, Math.sin(yaw) * 10 - 1.6 * (1 - whip), -1.2, Math.cos(yaw) * 10);
      return pose(pos, look, fovFor(r.aspect, 58), whip * .08);
    },
    blur: t => t > 1.1 ? 5 : 2,
  },

  // ------------------------------------------------------------------ scene 03 — make it yours
  // Two players meet on the palm avenue: a friend walks up and waves, the player waves back. Low-angle
  // 180° orbit; name tags are the game's own.
  {
    id: '03-connect', ...take(2.0), lead: .2,
    setup: r => { r.avatar(HERO); r.place(.4, 13.2, S); add(r, 'ngozi', -.6, 19.5, N); },
    act: r => {
      r.peerAlong('ngozi', [[-.6, 19.5], [-.5, 14.4]], 3.2);
      if (r.memory.waved !== true && r.sim > .95) { r.peerEmote('ngozi', 'wave'); r.memory.waved = true; }
      if (r.memory.back !== true && r.sim > 1.25) { r.emote('wave'); r.memory.back = true; }
    },
    cam: (r, t) => {
      const M = vec([-.05, 0, 13.85]), a = mix(.35, .35 + Math.PI * .95, ease.inOut(seg(t, -.2, 2.2)));
      return pose(orbit(M, 6.0, a, .6), vec([-.05, 1.55, 13.85]), fovFor(r.aspect, 46));
    },
  },
  // "Make it yours": the same continuous orbit, a different look on every beat (four takes, cut on beats).
  ...([['tunde', 'backpack', '#e8b95e', 'wave'], ['zainab', 'glasses', '#506b96', ''], ['amara', 'headphones', '#b05f49', 'dance'], [HERO.model, HERO.accessory, HERO.accent, '']] as const).map(([model, accessory, accent, emote], i): Shot => ({
    id: `03-style-${i + 1}`, ...take(.5, .15, .15), lead: .8,
    setup: r => { r.tags = false; r.avatar({ model, accessory, accent }); r.place(0, 31, S); },
    act: r => { if (emote && r.memory.e !== true && r.sim > -.75) { r.emote(emote); r.memory.e = true; } },
    cam: (r, t) => {
      const T = i * .5 + t, a = mix(-.55, .55, T / 2);
      return pose(orbit([0, 0, 31], 3.4, a, .34), vec([0, 1.18, 31]), fovFor(r.aspect, 48));
    },
  })),
  // Through the library's open double doors (opening x -32..-28) behind two players.
  {
    id: '03-doorway', ...take(1.25), lead: .3,
    setup: r => { r.tags = false; r.avatar(HERO); r.place(-30.75, 2.4, N); add(r, 'kelechi', -29.25, 1.9, N); r.door('library-main', -1); },
    act: r => { r.walk(N, false, .66); r.peerAlong('kelechi', [[-29.25, 1.9], [-29.3, -14]], 2.95); },
    cam: (r, t) => {
      const fl = follower(r, 'f', 5), hero = fl.update(at(r), r.dt);
      return pose(vec([-30, 1.62, hero.z + 3.1]).add(shake(t, .012, 2, 5)), vec([-30.1, 1.45, hero.z - 8]), fovFor(r.aspect, 60));
    },
  },
  // Three friends sprint east along the cross walk towards The Courts; the camera leads them, low.
  {
    id: '03-together', ...take(.75), lead: .5,
    setup: r => { r.shadowsEveryFrame = true; r.tags = false; r.avatar(HERO); r.place(4.5, 11.3, E); add(r, 'amara', 4.0, 10.1, E); add(r, 'kelechi', 3.2, 12.2, E); },
    // The friends run from the take's first simulated frame, alongside the player.
    act: r => { r.walk(E, true); r.peerAlong('amara', [[4.0, 10.1], [40, 10.1]], 7.4, -.7); r.peerAlong('kelechi', [[3.2, 12.2], [40, 12.2]], 7.6, -.7); },
    cam: (r, t) => {
      const hero = at(r), whip = ease.inExpo(seg(t, .55, 1.0));
      const pos = vec([hero.x + 4.2, .85, 8.2]).add(shake(t, .03, 6, 6));
      const look = lerpV(vec([hero.x - .5, 1.15, 11.1]), vec([hero.x + 14, 1.5, 22]), whip);
      return pose(pos, look, fovFor(r.aspect, 56), -whip * .06);
    },
    blur: t => t > .5 ? 4 : 2,
  },

  // ------------------------------------------------------------------ scene 04 — live the moment
  // The Campus Compact, wheel height, eastbound on the courtyard road (driver: the player; a friend aboard).
  {
    id: '04-wheel', ...take(1.0), lead: 2.6,
    setup: r => { r.shadowsEveryFrame = true;
      r.tags = false; r.avatar(HERO); r.placeVehicle('courtyard-car', -78, EAST_LANE, E); r.board('courtyard-car', 0);
      const p = add(r, 'ngozi', -78, EAST_LANE, E); p.vehicle = 'courtyard-car'; p.vehicleSeat = 1;
    },
    act: r => { r.driveAlong('courtyard-car', ROAD_EAST, 15); },
    cam: (r, t) => {
      const v = r.vehicle('courtyard-car'), c = Math.cos(v.yaw), s = Math.sin(v.yaw);
      const local = (x: number, y: number, z: number) => new THREE.Vector3(v.x + x * c + z * s, y, v.z - x * s + z * c);
      const slide = ease.inOut(seg(t, -.2, 1.2));
      return pose(local(1.62, .3, mix(2.6, 1.7, slide)).add(shake(t, .012, 9, 7)), local(.55, .36, mix(.2, -.6, slide)), fovFor(r.aspect, 62));
    },
    blur: () => 3,
  },
  // Wide: the car passes the gate (ÒRÌṢUN UNIVERSITY), the camera trucking along the car park side.
  {
    id: '04-drive-wide', ...take(1.25), lead: 6.6,
    setup: r => { r.shadowsEveryFrame = true;
      r.tags = false; r.avatar(HERO); r.placeVehicle('courtyard-car', -96, EAST_LANE, E); r.board('courtyard-car', 0);
      const p = add(r, 'ngozi', -96, EAST_LANE, E); p.vehicle = 'courtyard-car'; p.vehicleSeat = 1;
    },
    act: r => { r.driveAlong('courtyard-car', ROAD_EAST, 15); },
    cam: (r, t) => {
      const v = r.vehicle('courtyard-car');
      const k = ease.sine(seg(t, -.2, 1.45));
      return pose(vec([v.x + mix(9, 2, k), 2.1, 68]).add(shake(t, .015, 3, 8)), vec([v.x + mix(-2, 1.5, k), 1.5, 54]), fovFor(r.aspect, 52));
    },
    blur: () => 2,
  },
  // Fast lateral slide along the south fence of The Courts, through the chain link.
  {
    id: '04-court-slide', ...take(.75), lead: .6,
    setup: r => { r.shadowsEveryFrame = true;
      // Dribbling into the shooting spot of the next take, a friend guarding; seen through the south fence
      // (z 8.6) on a long lens, so the chain link sweeps past in the foreground.
      r.tags = false; r.avatar(HERO); r.place(SHOOT.x - 1.2, 20.4, N);
      Object.assign(r.ball('ball-1'), { x: SHOOT.x - .9, z: 20.0 }); void r.pickUp('ball-1');
      add(r, 'kelechi', 43.2, 13.6, S); add(r, 'amara', 38.6, 19.5, E);
    },
    act: r => { r.walkTo(SHOOT.x, SHOOT.z, false, .1); r.peerAlong('kelechi', [[43.2, 13.6], [44.2, 14.0]], 1.2); },
    cam: (r, t) => {
      const x = mix(37.5, 44.2, ease.sine(seg(t, -.2, .95))), hero = at(r);
      return pose(vec([x, 1.45, 7.5]), vec([mix(x + 2, hero.x, .7), 1.15, hero.z]), fovFor(r.aspect, 40));
    },
    blur: () => 3,
  },
  // The jump shot in slow motion: the camera rides with the ball to the south hoop.
  {
    id: '04-swish', ...take(2.25), lead: .4,
    setup: r => { r.shadowsEveryFrame = true;
      r.tags = false; r.avatar(HERO); r.place(SHOOT.x, SHOOT.z, Math.atan2(HOOP.x - SHOOT.x, HOOP.z - SHOOT.z));
      Object.assign(r.ball('ball-1'), { x: SHOOT.x + .3, z: SHOOT.z - .35 }); void r.pickUp('ball-1');
      add(r, 'kelechi', 42.4, 14.6, Math.atan2(SHOOT.x - 42.4, SHOOT.z - 14.6));
    },
    act: r => {
      if (r.memory.shot !== true && r.sim > -.45) { r.memory.shot = true; r.shoot(); }
      if ((r.ball('ball-1').shot as { scored?: boolean } | null)?.scored) r.mark('swish');
    },
    speed: t => keyed(t, [[.05, 1], [.5, .5], [1.5, .5], [1.85, 1]]),
    cam: (r, t) => {
      const b = r.ball('ball-1'), ball = new THREE.Vector3(b.x, b.y, b.z), fl = follower(r, 'b', 7);
      const target = fl.update(ball, r.dt).clone(), hoop = vec([HOOP.x, HOOP.y, HOOP.z]);
      const toHoop = vec([HOOP.x - SHOOT.x, 0, HOOP.z - SHOOT.z]).normalize(), side = new THREE.Vector3(-toHoop.z, 0, toHoop.x);
      // The ball's path, but never closer to the hoop than the rim's own front, nor below the rim once through.
      target.y = Math.max(target.y, b.z < HOOP.z + .6 ? 2.7 : 0);
      const pos = target.clone().addScaledVector(toHoop, -2.6).addScaledVector(side, -1.3).add(vec([0, .55, 0]));
      const along = pos.clone().sub(vec([SHOOT.x, 0, SHOOT.z])).dot(toHoop), limit = vec([HOOP.x, 0, HOOP.z]).sub(vec([SHOOT.x, 0, SHOOT.z])).length() - 2.2;
      if (along > limit) pos.addScaledVector(toHoop, limit - along);
      pos.y = Math.max(1.2, pos.y);
      return pose(pos, lerpV(target, hoop, .35), fovFor(r.aspect, 52));
    },
  },
  // Score: an orbit around the celebration, a friend waving.
  {
    id: '04-celebrate', ...take(.75), lead: .4,
    setup: r => { r.shadowsEveryFrame = true; r.tags = false; r.avatar(HERO); r.place(45, 16.4, N); add(r, 'kelechi', 43.4, 17.0, E); },
    // The game's cheer only plays the quiet opening of a long capture, so the celebration is a real jump
    // (Space) from the player and a wave from the friend.
    act: r => { if (r.memory.c !== true) { r.memory.c = true; r.jump(); r.peerEmote('kelechi', 'wave'); } },
    cam: (r, t) => {
      const a = mix(.2, 1.35, ease.out(seg(t, -.2, 1.0)));
      // The camera tilts up with the jump (the game's jump peaks about 2.5 m up).
      return pose(orbit([44.4, 0, 16.6], 3.9, a, 1.0), vec([44.4, 1.35 + r.player.y * .55, 16.6]), fovFor(r.aspect, 62), .03);
    },
    blur: () => 2,
  },
  // Discover: a golden keepsake in the library reading room; the player walks up to it.
  {
    id: '04-keepsake', ...take(1.25), lead: .2,
    // Keepsake t2 floats at (-30, -14) between the reading tables. The player walks in from the stacks and
    // stops just beyond collecting range (1.65 m), so it stays in shot.
    setup: r => { r.tags = false; r.avatar(HERO); r.place(-31, -21, S); },
    act: r => r.walkTo(-29.2, -15.7, false, .05),
    cam: (r, t) => {
      const push = ease.out(seg(t, -.2, 1.45));
      return pose(vec([-30.45, .95, mix(-10.4, -10.9, push)]), vec([-29.85, 1.3, -18]), fovFor(r.aspect, 48));
    },
  },
  // Overhead whirl above the Confluence ring: transition into scene 05.
  {
    id: '04-overhead', ...take(.75), lead: .2,
    setup: r => { r.tags = false; r.avatar(HERO); r.place(2.5, 9.6, N); seat(r, 'ngozi', 7, 5.9, 'bench-16-l'); add(r, 'amara', -9, 3, E); },
    act: r => { r.walk(N + .5, false, .7); r.peerAlong('amara', [[-9, 3], [-9, -8]], 2.6); },
    cam: (r, t) => {
      const k = seg(t, -.2, .95), spin = mix(0, 1.2, ease.in(k)), h = mix(24, 15, ease.in(k)), pos = vec([0, h, 0]);
      return pose(pos, add3(pos, Math.sin(spin) * .02, -1, Math.cos(spin) * .02), fovFor(r.aspect, 60, 50));
    },
    blur: () => 3,
  },

  // ------------------------------------------------------------------ scene 05 — your campus, your stories
  // A slow sweeping orbit around The Confluence; friends on its benches, others crossing the plaza.
  {
    id: '05-landmark', ...take(2.75), lead: .3,
    setup: r => {
      r.tags = false; r.avatar(HERO); r.place(-6.5, 10.4, E);
      seat(r, 'ngozi', 7, 5.9, 'bench-16-l'); seat(r, 'zainab', 7, 5.9, 'bench-16-r'); seat(r, 'tunde', -7, -5.9, 'bench-18-r');
      add(r, 'amara', 9.6, -5, W); add(r, 'kelechi', 10.4, -4, W); add(r, 'mel', -3, -14, N);
    },
    act: r => {
      r.walk(E - .25, false, .55);
      r.peerAlong('amara', [[9.6, -5], [7.4, -8.6], [0, -9.6], [-7.4, -8.4]], 1.9);
      r.peerAlong('kelechi', [[10.4, -4], [8.4, -8], [0, -10.6], [-7.6, -9.6]], 1.9);
      r.peerAlong('mel', [[-3, -14], [-3, -24]], 2.6);
    },
    cam: (r, t) => {
      const a = mix(.62, -.18, ease.sine(seg(t, -.2, 2.95)));
      // Inside the avenue's palm line (x ±7.6, z ≥ 16), so no trunk crosses the frame.
      return pose(orbit([0, 0, 0], 14, a, mix(5.2, 6.2, seg(t, -.2, 2.95))), vec([0, 4.4, -5]), fovFor(r.aspect, 64));
    },
  },
  // Crane down to friends on the Horizon Auditorium forecourt benches as the player walks up to them.
  {
    id: '05-crane', ...take(2.0), lead: .4,
    setup: r => {
      r.tags = false; r.avatar(HERO); r.place(-1.4, -21.4, N);
      seat(r, 'amara', -6.6, -29.6, 'bench-12-l'); seat(r, 'zainab', -6.6, -29.6, 'bench-12-r');
    },
    act: r => { r.walkTo(-4.3, -28.9, false, .1); }, // beside the bench, clear of the canopy column behind
    cam: (r, t) => {
      const k = ease.inOut(seg(t, -.2, 2.2));
      const pos = vec([mix(3.6, 2.7, k), mix(15, 1.45, k), mix(-18.6, -24.4, k)]);
      return pose(pos, vec([mix(-4.2, -5.0, k), mix(.4, 1.05, k), mix(-28.2, -30.3, k)]), fovFor(r.aspect, mix(50, 46, k)));
    },
  },
  // Dolly through the gap between two avenue palms (x 7.6, z 28 and 34) at walking height, players passing.
  {
    id: '05-dolly', ...take(1.5), lead: .3,
    setup: r => {
      r.tags = false; r.avatar(HERO); r.place(1.6, 25.5, N);
      add(r, 'chidi', -1.8, 15.5, S); add(r, 'ada', -2.6, 16.2, S); add(r, 'mel', 2.6, 34, N);
    },
    act: r => {
      r.walk(N, false, .6);
      r.peerAlong('chidi', [[-1.8, 15.5], [-1.8, 40]], 2.3); r.peerAlong('ada', [[-2.6, 16.2], [-2.6, 40]], 2.3);
      r.peerAlong('mel', [[2.6, 34], [2.6, 14]], 2.5);
    },
    cam: (r, t) => {
      const k = ease.sine(seg(t, -.2, 1.6));
      return pose(vec([mix(13, 4.4, k), 1.5, mix(31.3, 30.7, k)]), vec([mix(2.5, -.5, k), 1.55, mix(21, 17, k)]), fovFor(r.aspect, 54));
    },
  },
  // Controlled pull-back from the plaza: up and back over the avenue to the whole campus.
  {
    id: '05-pullback', ...take(1.75), lead: .3,
    setup: r => {
      r.tags = false; r.avatar(HERO); r.place(0, 11.8, N);
      seat(r, 'ngozi', 7, 5.9, 'bench-16-l'); seat(r, 'zainab', -7, 5.9, 'bench-17-r'); add(r, 'amara', -1.4, 12.6, N);
    },
    act: r => { r.peerAlong('amara', [[-1.4, 12.6], [-1.4, 12.2]], .5); },
    cam: (r, t) => {
      const k = ease.inOut(seg(t, -.2, 1.95));
      const pos = vec([0, mix(1.7, 30, k), mix(14.4, 50, k)]);
      return pose(pos, vec([0, mix(1.9, 0, k), mix(6, -8, k)]), fovFor(r.aspect, mix(48, 58, k)));
    },
  },

  // ------------------------------------------------------------------ scene 06 — the signature reveal
  // From the road, players walk in through the gate; the camera rises past the lettered beam into the
  // symmetrical aerial (gate, palm avenue, the Confluence, Horizon Auditorium), then drifts on under the
  // logo and end card.
  {
    id: '06-rise', ...take(10.0, H, .1), lead: .3,
    setup: r => {
      r.tags = false; r.avatar(HERO); r.place(.9, 56.5, N);
      add(r, 'ngozi', -1.1, 57.4, N); add(r, 'kelechi', 2.4, 58.4, N); add(r, 'amara', -2.6, 59.6, N); add(r, 'zainab', .2, 60.3, N);
    },
    act: r => {
      r.walk(N, false, .6);
      r.peerAlong('ngozi', [[-1.1, 57.4], [-1.1, 20]], 2.6); r.peerAlong('kelechi', [[2.4, 58.4], [2.4, 20]], 2.65);
      r.peerAlong('amara', [[-2.6, 59.6], [-2.6, 20]], 2.55); r.peerAlong('zainab', [[.2, 60.3], [.2, 20]], 2.5);
    },
    cam: (r, t) => {
      const k = ease.inOut(seg(t, -.2, 4.2)), drift = seg(t, 3.9, 10.2);
      const pos = vec([0, mix(1.55, 31, k) + drift * 3, mix(64.5, 82, k) + drift * 6]);
      const look = vec([0, mix(4.2, 0, k), mix(30, -6, k) - drift * 2]);
      return pose(pos, look, fovFor(r.aspect, mix(56, 52, k), mix(34, 31, k)));
    },
  },
];
