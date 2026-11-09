// Combat Arena player simulation: one fixed 60 Hz step of movement and weapon handling from one input
// command. The server runs it authoritatively for every player; the client runs the same code to
// predict its own player and replays unacknowledged commands when the server's state arrives
// (rewind and replay reconciliation). Same inputs give the same state on both sides.
//
// The server never accepts a position, a hit, an ammunition count or a fire time from a client: it
// only accepts these commands (buttons, movement axes and view angles, quantised) at no more than
// TICK_RATE per second, and decides what they do here.

import { TICK_RATE, WEAPON_BY_ID, QUICK_MELEE, EQUIPMENT_BY_ID } from './weapons.mjs';
import { moveBody, overlaps } from './physics.mjs';

export const DT = 1 / TICK_RATE;
export const RADIUS = .35, STEP = .55;
export const HEIGHT = [1.8, 1.25, 1.0]; // stand, crouch, slide
export const EYE = [1.62, 1.07, .84];
export const SPEED = { walk: 4.7, sprint: 6.8, crouch: 2.3 };
const ACCEL = 55, FRICTION = 42, AIR_ACCEL = 11, GRAVITY = 19.6, JUMP = 6.2;
const SLIDE = { boost: 8.8, friction: 6.2, ticks: 50, cooldown: 72, fleetCooldown: 46, minSpeed: 5.2, endSpeed: 2.6 };
export const PITCH_LIMIT = 1.45;

/** Input buttons (bit flags in each command). */
export const B = { FIRE: 1, ADS: 2, JUMP: 4, CROUCH: 8, SPRINT: 16, RELOAD: 32, SWAP: 64, MELEE: 128, LETHAL: 256, TACTICAL: 512, SLOT1: 1024, SLOT2: 2048 };
export const PHASES = ['ready', 'reload', 'switch', 'melee', 'throw'];
const THROW_TICKS = 22;

/** Quantise a command exactly as it travels, so prediction uses the values the server will use. */
export function quantize(cmd) {
  cmd.mx = Math.round(Math.max(-1, Math.min(1, cmd.mx)) * 127) / 127;
  cmd.mz = Math.round(Math.max(-1, Math.min(1, cmd.mz)) * 127) / 127;
  cmd.yaw = Math.round(wrapAngle(cmd.yaw) * 10000) / 10000;
  cmd.pitch = Math.round(Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cmd.pitch)) * 10000) / 10000;
  cmd.b = cmd.b & 4095;
  return cmd;
}
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
/** Command on the wire: [seq, buttons, mx·127, mz·127, yaw·1e4, pitch·1e4]. */
export const encodeCommand = c => [c.seq, c.b, Math.round(c.mx * 127), Math.round(c.mz * 127), Math.round(c.yaw * 10000), Math.round(c.pitch * 10000)];
export function decodeCommand(a) {
  if (!Array.isArray(a) || a.length !== 6 || !a.every(Number.isInteger)) return null;
  const [seq, b, mx, mz, yaw, pitch] = a;
  if (seq < 0 || b < 0 || b > 4095 || Math.abs(mx) > 127 || Math.abs(mz) > 127 || Math.abs(yaw) > 31416 || Math.abs(pitch) > PITCH_LIMIT * 10000 + 1) return null;
  return { seq, b, mx: mx / 127, mz: mz / 127, yaw: yaw / 10000, pitch: pitch / 10000 };
}

/** A fresh player at a spawn point, holding a loadout's weapons and equipment. */
export function spawnState(spawn, loadout, perks = new Set()) {
  const p = WEAPON_BY_ID.get(loadout.primary), s = WEAPON_BY_ID.get(loadout.secondary);
  const extra = perks.has('pockets') ? 1 : 0;
  const slot = w => ({ id: w.id, mag: w.mag ?? 0, reserve: (w.reserve ?? 0) + (w.mag ?? 0) * extra });
  const lethal = EQUIPMENT_BY_ID.get(loadout.lethal), tactical = EQUIPMENT_BY_ID.get(loadout.tactical);
  return {
    x: spawn.x, y: spawn.y ?? 0, z: spawn.z, vx: 0, vy: 0, vz: 0, yaw: spawn.yaw ?? 0, pitch: 0,
    grounded: true, stance: 0, slideT: 0, slideCd: 0, sprint: false, pb: 0,
    slot: 0, wpn: [slot(p), slot(s)], phase: 'switch', pt: p.swap, cool: 0, burstLeft: 0, trig: true,
    ads: 0, bloom: 0, rp: 0, ry: 0, shots: 0, sprintOut: 0,
    lethal: lethal ? lethal.count + extra : 0, tactical: tactical ? tactical.count : 0,
  };
}

const PACK = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'stance', 'slideT', 'slideCd', 'pb', 'slot', 'pt', 'cool', 'burstLeft', 'ads', 'bloom', 'rp', 'ry', 'shots', 'sprintOut', 'lethal', 'tactical'];
/** Full state for reconciliation (numbers survive JSON exactly). */
export function packState(s) {
  const out = PACK.map(k => s[k]);
  out.push(s.grounded ? 1 : 0, s.sprint ? 1 : 0, s.trig ? 1 : 0, PHASES.indexOf(s.phase), s.wpn[0].mag, s.wpn[0].reserve, s.wpn[1].mag, s.wpn[1].reserve);
  return out;
}
export function unpackState(a, s) {
  PACK.forEach((k, i) => { s[k] = a[i]; });
  let i = PACK.length;
  s.grounded = a[i++] === 1; s.sprint = a[i++] === 1; s.trig = a[i++] === 1; s.phase = PHASES[a[i++]] ?? 'ready';
  s.wpn[0].mag = a[i++]; s.wpn[0].reserve = a[i++]; s.wpn[1].mag = a[i++]; s.wpn[1].reserve = a[i++];
  return s;
}
export function cloneState(s) { return { ...s, wpn: s.wpn.map(w => ({ ...w })) }; }

/** The weapon in the player's hands (every slot holds a catalogue id). */
export const weaponOf = s => /** @type {typeof import('./weapons.mjs').WEAPONS[number]} */ (WEAPON_BY_ID.get(s.wpn[s.slot].id));
export const heightOf = s => HEIGHT[s.stance];
export const eyeOf = s => s.y + EYE[s.stance];

/** View direction from yaw/pitch (yaw 0 faces −z). */
export function direction(yaw, pitch, out = [0, 0, 0]) {
  const c = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * c; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * c;
  return out;
}

/** Deterministic hash → [0, 1). */
export function rand(a, b, c, d) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, -2048144777) ^ Math.imul(d | 0, -1028477379);
  h = Math.imul(h ^ (h >>> 15), -2048144777); h = Math.imul(h ^ (h >>> 13), -1028477379); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** A weapon's fixed, learnable sideways recoil for shot i: mostly one way with a rhythmic wobble. */
export function recoilPattern(pattern, i) {
  const bias = ((pattern * 7919) % 5 - 2) / 2.5;
  return Math.max(-1, Math.min(1, .55 * bias + .6 * Math.sin(i * .83 + pattern * 1.7)));
}

/** The current spread cone half-angle (radians). */
export function spreadOf(s, w, perks) {
  if (!w.spread) return 0;
  const sp = w.spread, hip = sp.hip * (perks?.has('steady') ? .75 : 1);
  const a = s.ads * s.ads;
  let cone = hip + (sp.ads - hip) * a;
  const speed = Math.hypot(s.vx, s.vz);
  cone *= 1 + (sp.move - 1) * Math.min(1, speed / SPEED.walk) * (1 - a * .75);
  if (!s.grounded) cone *= sp.air;
  else if (s.stance === 1) cone *= .85;
  return cone + s.bloom;
}

const out = { grounded: false, hitX: false, hitZ: false, hitCeiling: false };
const fwd = [0, 0, 0];

/**
 * Advance one tick. `ctx` = { world, perks:Set, seed, num } (num: this player's small id, for spread
 * randomness). Returns a list of events (shots, melee, throws, dry fire, reloads) or an empty array.
 * The command's yaw and pitch are the player's view; recoil is added on top by the simulation, so the
 * server applies it too (removing recoil on the client changes nothing).
 */
export function step(s, cmd, ctx) {
  const events = [];
  const b = cmd.b, pressed = b & ~s.pb;
  const perks = ctx.perks ?? EMPTY;
  s.yaw = cmd.yaw; s.pitch = cmd.pitch;
  let w = weaponOf(s);
  // ---------------------------------------------------------------- stance, sprint, slide
  const wantAds = (b & B.ADS) !== 0 && w.fire !== 'melee' && s.phase !== 'switch' && s.phase !== 'melee' && s.phase !== 'throw' && s.phase !== 'reload';
  const forwardInput = cmd.mz > .3;
  let wantSprint = (b & B.SPRINT) !== 0 && forwardInput && !wantAds && s.stance !== 2;
  if ((b & B.FIRE) && w.fire !== 'melee' && s.phase === 'ready') wantSprint = false;
  if (s.slideCd > 0) s.slideCd--;
  const speedNow = Math.hypot(s.vx, s.vz);
  if ((pressed & B.CROUCH) && s.sprint && s.grounded && s.slideCd === 0 && s.stance === 0 && speedNow > SLIDE.minSpeed) {
    s.stance = 2; s.slideT = SLIDE.ticks;
    const k = Math.max(SLIDE.boost, speedNow) / (speedNow || 1);
    s.vx *= k; s.vz *= k; wantSprint = false;
    events.push({ kind: 'slide' });
  } else if (s.stance === 2) {
    s.slideT--;
    if (s.slideT <= 0 || Math.hypot(s.vx, s.vz) < SLIDE.endSpeed || !s.grounded) endSlide(s, ctx, b, perks);
    wantSprint = false;
  } else if (b & B.CROUCH) { if (s.stance === 0) s.stance = 1; wantSprint = false; }
  else if (s.stance === 1 && !overlaps(ctx.world, s.x, s.y, s.z, RADIUS, HEIGHT[0])) s.stance = 0;
  s.sprint = wantSprint && s.stance === 0;
  if (s.sprint) s.sprintOut = w.sprintOut; else if (s.sprintOut > 0) s.sprintOut--;
  // ---------------------------------------------------------------- horizontal movement
  const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
  let wx = -sin * cmd.mz + cos * cmd.mx, wz = -cos * cmd.mz - sin * cmd.mx;
  const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
  let top = s.sprint ? SPEED.sprint * (perks.has('fleet') ? 1.08 : 1) : s.stance === 1 ? SPEED.crouch : SPEED.walk;
  top *= w.moveMul * (1 - (1 - w.adsMoveMul) * s.ads);
  if (s.stance === 2) {
    // Sliding: momentum with friction, a little steering.
    const sp = Math.hypot(s.vx, s.vz), ns = Math.max(0, sp - SLIDE.friction * DT);
    if (sp > 0) { s.vx *= ns / sp; s.vz *= ns / sp; }
    s.vx += wx * 2 * DT; s.vz += wz * 2 * DT;
  } else if (s.grounded) {
    const tx = wx * top, tz = wz * top, dx = tx - s.vx, dz = tz - s.vz, dl = Math.hypot(dx, dz);
    const rate = (wl > .01 ? ACCEL : FRICTION) * DT;
    if (dl <= rate) { s.vx = tx; s.vz = tz; } else { s.vx += dx / dl * rate; s.vz += dz / dl * rate; }
  } else {
    s.vx += wx * AIR_ACCEL * DT; s.vz += wz * AIR_ACCEL * DT;
    const sp = Math.hypot(s.vx, s.vz), cap = Math.max(top, SPEED.sprint * 1.1);
    if (sp > cap) { s.vx *= cap / sp; s.vz *= cap / sp; }
  }
  // ---------------------------------------------------------------- jump and gravity
  if ((pressed & B.JUMP) && s.grounded) {
    if (s.stance === 2) endSlide(s, ctx, 0, perks);
    if (s.stance === 1 && !overlaps(ctx.world, s.x, s.y, s.z, RADIUS, HEIGHT[0])) s.stance = 0;
    if (s.stance === 0) { s.vy = JUMP; s.grounded = false; events.push({ kind: 'jump' }); }
  }
  s.vy -= GRAVITY * DT;
  const wasGrounded = s.grounded, fall = s.vy;
  moveBody(ctx.world, s, s.vx * DT, s.vy * DT, s.vz * DT, RADIUS, HEIGHT[s.stance], wasGrounded ? STEP : .2, out);
  if (out.grounded && s.vy <= 0) { if (!wasGrounded && fall < -6) events.push({ kind: 'land', speed: -fall }); s.vy = 0; s.grounded = true; } else s.grounded = false;
  if (out.hitCeiling && s.vy > 0) s.vy = 0;
  if (out.hitX) s.vx = 0; if (out.hitZ) s.vz = 0;
  // ---------------------------------------------------------------- weapon
  const steady = perks.has('steady') ? 1.15 : 1;
  if (wantAds && !s.sprint) s.ads = Math.min(1, s.ads + steady / Math.max(1, w.ads)); else s.ads = Math.max(0, s.ads - 1.25 / Math.max(1, w.ads));
  let fired = false;
  if (s.cool > 0) s.cool -= 1;
  // Phase timers.
  if (s.phase !== 'ready') {
    s.pt--;
    if (s.phase === 'reload' && w.reloadMode === 'shell' && (b & B.FIRE) && s.wpn[s.slot].mag > 0 && (pressed & B.FIRE)) { s.phase = 'ready'; s.pt = 0; s.trig = false; }
    else if (s.pt <= 0) {
      if (s.phase === 'reload') {
        const cur = s.wpn[s.slot];
        if (w.reloadMode === 'shell') {
          if (cur.reserve > 0 && cur.mag < w.mag) { cur.mag++; cur.reserve--; }
          if (cur.reserve > 0 && cur.mag < w.mag) s.pt = w.reload; else s.phase = 'ready';
        } else { const take = Math.min(w.mag - cur.mag, cur.reserve); cur.mag += take; cur.reserve -= take; s.phase = 'ready'; events.push({ kind: 'reloaded' }); }
      } else s.phase = 'ready';
    }
  }
  // Switching weapons (cancels a reload).
  const target = (pressed & B.SLOT1) ? 0 : (pressed & B.SLOT2) ? 1 : (pressed & B.SWAP) ? 1 - s.slot : s.slot;
  if (target !== s.slot && s.phase !== 'melee' && s.phase !== 'throw') {
    s.slot = target; w = weaponOf(s); s.phase = 'switch'; s.pt = w.swap; s.burstLeft = 0; s.ads = 0; s.bloom = 0; s.trig = true;
    events.push({ kind: 'switch', weapon: w.id });
  }
  const cur = s.wpn[s.slot];
  // Quick melee, lethal and tactical interrupt a reload but not a switch.
  if ((pressed & B.MELEE) && (s.phase === 'ready' || s.phase === 'reload')) {
    s.phase = 'melee'; s.pt = w.fire === 'melee' ? w.swing : QUICK_MELEE.ticks; s.ads = 0; s.burstLeft = 0;
    events.push({ kind: 'melee', weapon: w.id, quick: w.fire !== 'melee', ...origin(s) });
  } else if ((pressed & (B.LETHAL | B.TACTICAL)) && (s.phase === 'ready' || s.phase === 'reload')) {
    const kind = (pressed & B.LETHAL) ? 'lethal' : 'tactical';
    if (s[kind] > 0) {
      s[kind]--; s.phase = 'throw'; s.pt = THROW_TICKS; s.ads = 0; s.burstLeft = 0;
      events.push({ kind: 'throw', slot: kind, ...origin(s), yaw: s.yaw, pitch: s.pitch });
    }
  } else if (w.fire === 'melee') {
    if ((b & B.FIRE) && s.phase === 'ready' && s.sprintOut <= 0 && s.cool <= 0) {
      s.phase = 'melee'; s.pt = w.swing; s.cool = w.swing;
      events.push({ kind: 'melee', weapon: w.id, quick: false, ...origin(s) });
    }
  } else {
    const reloadable = cur.mag < w.mag && cur.reserve > 0;
    if (s.phase === 'ready' && reloadable && ((pressed & B.RELOAD) || (cur.mag === 0 && (b & B.FIRE) && s.burstLeft === 0))) {
      s.phase = 'reload'; s.ads = 0; s.burstLeft = 0;
      s.pt = w.reloadMode === 'shell' ? (w.reloadStart ?? 0) + w.reload : cur.mag === 0 ? w.reloadEmpty : w.reload;
      events.push({ kind: 'reload', empty: cur.mag === 0 });
    } else if (s.phase === 'ready' && s.sprintOut <= 0) {
      const held = (b & B.FIRE) !== 0;
      if (w.fire === 'burst' && held && !s.trig && s.burstLeft === 0 && s.cool <= 0 && cur.mag > 0) { s.burstLeft = w.burst; s.trig = true; }
      while (s.cool <= 0 && cur.mag > 0) {
        const go = w.fire === 'auto' ? held : w.fire === 'burst' ? s.burstLeft > 0 : held && !s.trig;
        if (!go) break;
        shoot(s, w, cur, ctx, perks, events); fired = true;
        if (w.fire === 'burst') { s.burstLeft--; s.cool += 3600 / (s.burstLeft > 0 ? w.burstRpm : w.rpm); }
        else { s.cool += 3600 / w.rpm; if (w.fire !== 'auto') s.trig = true; }
      }
      if (held && cur.mag === 0 && (pressed & B.FIRE) && cur.reserve === 0) events.push({ kind: 'dry' });
    }
  }
  if (!(b & B.FIRE)) s.trig = false;
  if (!fired && s.cool < 0) s.cool = 0;
  // Spread bloom and recoil recover only once sustained fire stops (not between automatic shots).
  const sustained = (b & B.FIRE) !== 0 && s.phase === 'ready' && s.wpn[s.slot].mag > 0 && (w.fire === 'auto' || s.burstLeft > 0);
  if (!fired && !sustained) {
    if (w.spread) s.bloom = Math.max(0, s.bloom - w.spread.bloomRecover);
    if (w.recoil) { s.rp = Math.max(0, s.rp - w.recoil.recover); s.ry *= .9; if (Math.abs(s.ry) < 1e-5) s.ry = 0; }
  }
  s.pb = b;
  return events;
}
const EMPTY = new Set();

function endSlide(s, ctx, b, perks) {
  s.slideT = 0; s.slideCd = perks.has('fleet') ? SLIDE.fleetCooldown : SLIDE.cooldown;
  s.stance = (b & B.CROUCH) || overlaps(ctx.world, s.x, s.y, s.z, RADIUS, HEIGHT[0]) ? 1 : 0;
  if (s.stance === 1 && overlaps(ctx.world, s.x, s.y, s.z, RADIUS, HEIGHT[1])) s.stance = 2;
}

const origin = s => ({ ox: s.x, oy: eyeOf(s), oz: s.z });

function shoot(s, w, cur, ctx, perks, events) {
  cur.mag--; s.shots++;
  const cone = spreadOf(s, w, perks);
  const yaw = s.yaw + s.ry, pitch = s.pitch + s.rp;
  direction(yaw, pitch, fwd);
  // Right and up vectors of the aimed view.
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const ux = Math.sin(yaw) * Math.sin(pitch), uy = Math.cos(pitch), uz = Math.cos(yaw) * Math.sin(pitch);
  const dirs = [];
  for (let p = 0; p < w.pellets; p++) {
    const a = rand(ctx.seed, ctx.num, s.shots, p * 2) * Math.PI * 2, r = Math.tan(cone * Math.sqrt(rand(ctx.seed, ctx.num, s.shots, p * 2 + 1)));
    const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    let dx = fwd[0] + rx * ox + ux * oy, dy = fwd[1] + uy * oy, dz = fwd[2] + rz * ox + uz * oy;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    dirs.push([dx, dy, dz]);
  }
  events.push({ kind: 'shot', weapon: w.id, shot: s.shots, ...origin(s), dirs });
  const kick = 1 - s.ads * (1 - w.recoil.adsRecoil);
  s.rp = Math.min(w.recoil.max, s.rp + w.recoil.kick * kick);
  s.ry += w.recoil.drift * recoilPattern(w.recoil.pattern, s.shots) * kick;
  s.ry = Math.max(-w.recoil.max, Math.min(w.recoil.max, s.ry));
  s.bloom = Math.min(w.spread.bloomMax, s.bloom + w.spread.bloom);
}

// ---------------------------------------------------------------- hitboxes
/** Head sphere centre/radius and body box of a player standing at (x, y, z) with height h. */
export function hitbox(x, y, z, h) {
  return { hx: x, hy: y + h - .17, hz: z, hr: .18, x0: x - .3, y0: y, z0: z - .3, x1: x + .3, y1: y + h - .32, z1: z + .3, legs: y + h * .42 };
}
