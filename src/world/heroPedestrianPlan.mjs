// The Commercial District hero pedestrian's daily round outside Coastal Bank (Harbour Exchange block-0-1), as a pure
// function of time: every client computes the same position and action from the room's clock, so two players see
// her in the same place doing the same thing, with no network traffic (like the district's other walkers). Coordinates
// are Harbour Exchange's local frame (shared/harbour-local.mjs). Presentation only: she is not a collider and the
// room's simulation never reads this.
//
// The round (about 2 minutes): walk in from the west end of the block, step up to the bank's ATM and check the
// receipt, cross to the bench and sit for a while, get up, walk to the east end and text on her phone, walk back.
import { HARBOUR_BLOCKS, HARBOUR_BUILDINGS } from '../../shared/harbour-local.mjs';

const block = HARBOUR_BLOCKS.find(b => b.id === 'block-0-1');
const bank = HARBOUR_BUILDINGS.find(b => b.id === 'block-0-1-0');
const edge = block.z + block.d / 2;               // the block's street edge (kerb line)
const facade = bank.z + bank.d / 2;               // the bank's shopfront plane
const LANE = edge - 4.6;                          // her walking line (the district walker uses edge - 3.05)
export const SPEED = 1.15;                        // m/s: an unhurried walk (the clip's natural pace is 1.21)
export const ATM = { x: bank.x + 4.2, z: facade + .35 };
/** The right-hand place on the bench in front of the bank (blender/hero_slice.py `street()`), facing the road. */
export const BENCH_SEAT = { id: 'hero-bench', x: block.x - 10 + .45, z: edge - 1.0, y: .47, yaw: 0, table: false, pull: 0, kind: 'bench' };
const APPROACH = { x: BENCH_SEAT.x, z: BENCH_SEAT.z + .55 };
const WEST = { x: block.x - 21, z: LANE }, EAST = { x: block.x + 21, z: LANE };
/** Sit-down and stand-up transitions (seconds): the avatar plays the captured clips within these windows. */
export const SIT = { down: 3.2, seated: 26, up: 2.8 };

const walk = (...pts) => ({ kind: 'walk', pts });
const act = (action, seconds, at, yaw) => ({ kind: 'act', action, seconds, at, yaw });
const ROUND = [
  walk(WEST, { x: ATM.x, z: LANE }, ATM),
  act('documents', 9, ATM, Math.PI),                      // facing the ATM (north, -z)
  walk(ATM, { x: APPROACH.x, z: LANE }, APPROACH),
  { kind: 'sit', seconds: SIT.down + SIT.seated + SIT.up, at: APPROACH },
  walk(APPROACH, { x: APPROACH.x, z: LANE }, EAST),
  act('phone', 11, EAST, -Math.PI / 2),                   // turned back toward the bank while texting
  walk(EAST, WEST),
  act('idle', 4, WEST, Math.PI / 2),
];
const length = pts => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - pts[i].x, p.z - pts[i].z), 0);
for (const s of ROUND) s.seconds ??= length(s.pts) / SPEED;
export const PERIOD = ROUND.reduce((n, s) => n + s.seconds, 0);

/**
 * Where she is at time `t` (seconds, any origin): position, facing (radians, 0 = +z), walking speed, the action
 * ('walk', 'idle', 'documents', 'phone', 'sit') and for 'sit' the phase ('down' | 'seated' | 'up') and its start.
 */
export function pedestrianAt(t) {
  let u = ((t % PERIOD) + PERIOD) % PERIOD;
  for (const s of ROUND) {
    if (u >= s.seconds) { u -= s.seconds; continue; }
    if (s.kind === 'walk') {
      let d = u * SPEED;
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1], b = s.pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
        if (d <= len || i === s.pts.length - 1) {
          const k = len ? Math.min(1, d / len) : 1;
          return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(b.x - a.x, b.z - a.z), speed: SPEED, action: 'walk' };
        }
        d -= len;
      }
    }
    if (s.kind === 'sit') {
      const phase = u < SIT.down ? 'down' : u < SIT.down + SIT.seated ? 'seated' : 'up';
      return { x: s.at.x, z: s.at.z, yaw: BENCH_SEAT.yaw, speed: 0, action: 'sit', phase, since: t - u };
    }
    return { x: s.at.x, z: s.at.z, yaw: s.yaw, speed: 0, action: s.action };
  }
  return { x: WEST.x, z: WEST.z, yaw: Math.PI / 2, speed: 0, action: 'idle' };
}

/** The round's waypoints (tests check they stay clear of the bank and other colliders). */
export const ROUTE = { WEST, EAST, ATM, APPROACH, LANE };
