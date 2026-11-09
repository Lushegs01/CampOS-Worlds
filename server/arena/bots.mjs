// Training bots for Combat Arena. They exist only in Training matches, which are separate from
// matchmaking and labelled as bots everywhere (roster, scoreboard, kill feed): live matches only ever
// contain connected people. A bot plays by the same rules as a person: it produces the same input
// commands, which the match simulates exactly like a player's (no shortcuts, no wall-hacks: it only
// reacts to enemies it can see).
//
// Navigation: a 1 m grid of standable cells on every walkable surface (ground, stairs, platforms),
// built once per map, searched with A*.

import { createWorld, overlaps, lineOfSight } from '../../shared/arena/physics.mjs';
import { B, EYE, wrapAngle, weaponOf } from '../../shared/arena/sim.mjs';

const navCache = new Map();
/** Walkable cells for a map: { nodes:[{x,y,z,links:[i…]}], at(x,y,z) }. Cached per map (immutable). */
export function navigation(map) {
  if (navCache.has(map.id)) return navCache.get(map.id);
  const world = createWorld(map.boxes, map.bounds);
  const [x0, z0, x1, z1] = map.bounds;
  const nodes = [], columns = new Map();
  const key = (i, j) => i * 10000 + j;
  for (let i = 0, x = x0 + .5; x < x1; i++, x += 1) for (let j = 0, z = z0 + .5; z < z1; j++, z += 1) {
    const tops = [0];
    for (const b of world.query(x - .01, z - .01, x + .01, z + .01)) tops.push(b.y1);
    const here = [];
    for (const y of new Set(tops)) if (!overlaps(world, x, y, z, .3, 1.75) && supported(world, x, y, z)) { here.push(nodes.length); nodes.push({ x, y, z, i, j, links: [] }); }
    if (here.length) columns.set(key(i, j), here);
  }
  for (let idx = 0; idx < nodes.length; idx++) for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const n = nodes[idx];
    for (const m of columns.get(key(n.i + di, n.j + dj)) ?? []) {
      const o = nodes[m];
      if (Math.abs(o.y - n.y) > .55) continue;
      const y = Math.max(n.y, o.y);
      if (overlaps(world, (n.x + o.x) / 2, y, (n.z + o.z) / 2, .3, 1.75)) continue;
      if (di && dj && (!(columns.get(key(n.i + di, n.j))?.some(k => Math.abs(nodes[k].y - n.y) <= .55)) || !(columns.get(key(n.i, n.j + dj))?.some(k => Math.abs(nodes[k].y - n.y) <= .55)))) continue;
      n.links.push(m); o.links.push(idx);
    }
  }
  nodes.forEach((n, k) => { n.id = k; });
  const nav = {
    nodes,
    /** The node nearest a position (same column first, then neighbours). */
    near(x, y, z) {
      let best = -1, bd = Infinity;
      const ci = Math.floor(x - x0), cj = Math.floor(z - z0);
      for (let r = 0; r <= 3 && best < 0; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) for (const k of columns.get(key(ci + di, cj + dj)) ?? []) {
        const n = nodes[k], d = Math.hypot(n.x - x, (n.y - y) * 2, n.z - z);
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    },
    /** A* from node a to node b: a list of nodes, or null. */
    path(a, b) {
      if (a < 0 || b < 0) return null;
      const open = new Set([a]), came = new Map(), g = new Map([[a, 0]]), f = new Map([[a, dist(nodes[a], nodes[b])]]);
      for (let guard = 0; open.size && guard < 6000; guard++) {
        let cur = -1, cf = Infinity;
        for (const k of open) { const v = f.get(k); if (v < cf) { cf = v; cur = k; } }
        if (cur === b) { const out = [nodes[b]]; let c = b; while (came.has(c)) { c = came.get(c); out.unshift(nodes[c]); } return out; }
        open.delete(cur);
        for (const m of nodes[cur].links) {
          const t = g.get(cur) + dist(nodes[cur], nodes[m]);
          if (t < (g.get(m) ?? Infinity)) { came.set(m, cur); g.set(m, t); f.set(m, t + dist(nodes[m], nodes[b])); open.add(m); }
        }
      }
      return null;
    },
  };
  navCache.set(map.id, nav);
  return nav;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function supported(world, x, y, z) {
  if (y === 0) return true;
  for (const b of world.query(x - .25, z - .25, x + .25, z + .25)) if (Math.abs(b.y1 - y) < 1e-6) return true;
  return false;
}

export const DIFFICULTY = {
  easy: { reaction: 650, aimError: .09, aimSettle: 1400, turn: 3.2, burst: [250, 700], accuracy: .55 },
  normal: { reaction: 380, aimError: .055, aimSettle: 900, turn: 5, burst: [350, 900], accuracy: .75 },
  hard: { reaction: 220, aimError: .03, aimSettle: 600, turn: 7.5, burst: [500, 1300], accuracy: .9 },
};

/**
 * A bot's brain. `view` gives it what a player would know: its own state and the positions of players
 * it can see (it checks line of sight itself through the match's world).
 */
export function createBrain({ match, player, difficulty = 'normal', random = Math.random }) {
  const d = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  const nav = navigation(match.map);
  let path = null, pathAt = 0, goal = null, target = null, seenAt = 0, lastPos = null, stuckAt = 0, jumpUntil = 0;
  let strafe = 1, strafeUntil = 0, fireUntil = 0, pauseUntil = 0, aimYaw = 0, aimPitch = 0, crouchUntil = 0;
  const seq = { n: 0 };
  function chooseGoal(now) {
    const s = player.sim, map = match.map;
    if (match.mode.id === 'dom') {
      const mine = match.objectives.filter(o => o.owner !== player.team);
      const pool = mine.length ? mine : match.objectives;
      const o = pool.reduce((a, b) => (Math.hypot(a.x - s.x, a.z - s.z) < Math.hypot(b.x - s.x, b.z - s.z) ? a : b));
      return { x: o.x + (random() - .5) * 3, y: 0, z: o.z + (random() - .5) * 3 };
    }
    // Team deathmatch: head toward the last known enemy, else a random point on the far half.
    const enemy = match.players.filter(p => p.team !== player.team && p.alive && p.sim).sort((a, b) => Math.hypot(a.sim.x - s.x, a.sim.z - s.z) - Math.hypot(b.sim.x - s.x, b.sim.z - s.z))[0];
    if (enemy && random() < .7) return { x: enemy.sim.x + (random() - .5) * 8, y: enemy.sim.y, z: enemy.sim.z + (random() - .5) * 8 };
    const n = nav.nodes[Math.floor(random() * nav.nodes.length)];
    void now; void map;
    return { x: n.x, y: n.y, z: n.z };
  }
  function visibleEnemy(now) {
    const s = player.sim, ex = s.x, ey = s.y + EYE[s.stance], ez = s.z;
    let best = null, bd = Infinity;
    for (const p of match.players) {
      if (p.team === player.team || !p.alive || !p.sim) continue;
      const dx = p.sim.x - ex, dz = p.sim.z - ez, dd = Math.hypot(dx, dz);
      if (dd > 60 || dd > bd) continue;
      if (match.smokeBlocks(ex, ey, ez, p.sim.x, p.sim.y + 1.2, p.sim.z)) continue;
      if (!lineOfSight(match.world, ex, ey, ez, p.sim.x, p.sim.y + 1.2, p.sim.z)) continue;
      // Field of view (about 150°), unless very close.
      const facing = Math.cos(wrapAngle(Math.atan2(-dx, -dz) - s.yaw));
      if (dd > 4 && facing < -.25) continue;
      best = p; bd = dd;
    }
    void now;
    return best;
  }
  /** Produce this tick's command (called at the simulation rate). */
  function think(now) {
    const s = player.sim;
    if (!s || !player.alive) return null;
    const blind = player.blindUntil > now;
    let b = 0, mx = 0, mz = 0;
    // ---------------- targeting
    const seen = blind ? null : visibleEnemy(now);
    if (seen !== target) { target = seen; seenAt = now; }
    let wantYaw = s.yaw, wantPitch = 0;
    if (target) {
      const t = target.sim, dx = t.x - s.x, dz = t.z - s.z, horiz = Math.hypot(dx, dz);
      const aimY = t.y + (t.stance === 0 ? 1.25 : .8) - (s.y + EYE[s.stance]);
      const settle = Math.min(1, (now - seenAt) / d.aimSettle);
      const err = d.aimError * (1.2 - settle);
      wantYaw = Math.atan2(-dx, -dz) + Math.sin(now / 170 + player.num) * err;
      wantPitch = Math.atan2(aimY, horiz) + Math.cos(now / 210 + player.num) * err * .6;
      if (now - seenAt > d.reaction && now > pauseUntil) {
        if (now > fireUntil) { fireUntil = now + d.burst[0] + random() * (d.burst[1] - d.burst[0]); pauseUntil = fireUntil + 150 + random() * 400 * (1 - d.accuracy); }
        if (now < fireUntil) b |= B.FIRE;
        if (horiz > 12 && weaponOf(s).category !== 'shotgun') b |= B.ADS;
      }
      if (now > strafeUntil) { strafe = random() < .5 ? -1 : 1; strafeUntil = now + 500 + random() * 900; }
      mx = strafe * .8;
      if (horiz > 18) mz = .6;
      if (now < crouchUntil) b |= B.CROUCH; else if (random() < .003) crouchUntil = now + 900;
      goal = null;
    } else {
      // ---------------- navigation
      if (!goal || now - pathAt > 4000 || !path?.length) {
        goal = chooseGoal(now); pathAt = now;
        path = nav.path(nav.near(s.x, s.y, s.z), nav.near(goal.x, goal.y, goal.z));
      }
      while (path?.length && Math.hypot(path[0].x - s.x, path[0].z - s.z) < .8) path.shift();
      const next = path?.[0];
      if (next) {
        wantYaw = Math.atan2(-(next.x - s.x), -(next.z - s.z));
        mz = 1;
        if (path.length > 6 && Math.abs(wrapAngle(wantYaw - s.yaw)) < .4) b |= B.SPRINT;
      } else goal = null;
      if (weaponOf(s).mag && s.wpn[s.slot].mag < weaponOf(s).mag * .4) b |= B.RELOAD;
    }
    // ---------------- stuck: jump, then pick a new route
    if (!lastPos || Math.hypot(lastPos.x - s.x, lastPos.z - s.z) > .5) { lastPos = { x: s.x, z: s.z }; stuckAt = now; }
    else if ((mx || mz) && now - stuckAt > 900) { jumpUntil = now + 120; if (now - stuckAt > 2200) { goal = null; stuckAt = now; strafe = -strafe; } }
    if (now < jumpUntil) b |= B.JUMP;
    // ---------------- turn toward the wanted view at a limited rate
    const maxTurn = d.turn / 60;
    aimYaw = s.yaw + Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(wantYaw - s.yaw)));
    aimPitch = s.pitch + Math.max(-maxTurn, Math.min(maxTurn, wantPitch - s.pitch));
    return { seq: ++seq.n, b, mx, mz, yaw: aimYaw, pitch: aimPitch };
  }
  return { think, reset() { path = null; goal = null; target = null; seq.n = player.lastSeq; } };
}
