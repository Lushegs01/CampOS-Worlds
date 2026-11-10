// Combat Arena physics: a static world of axis-aligned boxes, a uniform grid to find nearby boxes,
// swept player movement with stepping, and ray casts. Shared by the server (authoritative movement,
// hit registration, line of sight) and the client (prediction, camera, impact effects), so both
// compute the same results from the same inputs. No three.js and no allocation in the hot paths.

const CELL = 4;

/**
 * Build a collision world. Each box is { min:[x,y,z], max:[x,y,z], thin?:boolean } (thin cover can be
 * shot through by penetrating rounds). `bounds` is [minX, minZ, maxX, maxZ]: the playable area.
 */
export function createWorld(boxes, bounds) {
  const list = boxes.map((b, i) => ({ i, x0: b.min[0], y0: b.min[1], z0: b.min[2], x1: b.max[0], y1: b.max[1], z1: b.max[2], thin: !!b.thin, stamp: 0 }));
  const [bx0, bz0, bx1, bz1] = bounds;
  const cols = Math.ceil((bx1 - bx0) / CELL) + 2, rows = Math.ceil((bz1 - bz0) / CELL) + 2;
  const cells = Array.from({ length: cols * rows }, () => []);
  const cx = x => Math.max(0, Math.min(cols - 1, Math.floor((x - bx0) / CELL) + 1));
  const cz = z => Math.max(0, Math.min(rows - 1, Math.floor((z - bz0) / CELL) + 1));
  for (const b of list) for (let i = cx(b.x0); i <= cx(b.x1); i++) for (let j = cz(b.z0); j <= cz(b.z1); j++) cells[j * cols + i].push(b);
  let stamp = 0;
  const found = [];
  /** Boxes overlapping the XZ rectangle (each once). Returns a shared array: copy it to keep it. */
  function query(x0, z0, x1, z1) {
    found.length = 0; stamp++;
    for (let i = cx(x0); i <= cx(x1); i++) for (let j = cz(z0); j <= cz(z1); j++) for (const b of cells[j * cols + i]) {
      if (b.stamp === stamp) continue; b.stamp = stamp;
      if (b.x1 > x0 && b.x0 < x1 && b.z1 > z0 && b.z0 < z1) found.push(b);
    }
    return found;
  }
  return { boxes: list, bounds, query, cols, rows, cell: CELL, cx, cz, cells, nextStamp: () => ++stamp };
}

const EPS = 1e-4;
/** Does a player box (centre x/z, half-width r, feet y, height h) overlap any world box? */
export function overlaps(world, x, y, z, r, h) {
  for (const b of world.query(x - r, z - r, x + r, z + r)) if (b.y1 > y + EPS && b.y0 < y + h - EPS) return true;
  return false;
}

/** Highest box top under a player footprint at or below `y + reach` (0 is the ground). */
export function groundBelow(world, x, y, z, r, reach = 0) {
  let top = 0;
  for (const b of world.query(x - r + EPS, z - r + EPS, x + r - EPS, z + r - EPS)) if (b.y1 <= y + reach + EPS && b.y1 > top) top = b.y1;
  return top;
}

/**
 * Move a player body by (dx, dy, dz), resolving collisions one axis at a time. Horizontal moves onto
 * a ledge no higher than `step` lift the player onto it when grounded. Returns flags in `out`:
 * grounded (landed or standing), hitX/hitZ (blocked sideways), hitCeiling.
 */
export function moveBody(world, body, dx, dy, dz, r, h, step, out) {
  out.grounded = false; out.hitX = false; out.hitZ = false; out.hitCeiling = false;
  const len = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const n = Math.max(1, Math.ceil(len / 0.25));
  const sx = dx / n, sy = dy / n, sz = dz / n;
  for (let k = 0; k < n; k++) {
    // vertical
    if (sy !== 0) {
      const ny = body.y + sy;
      let y = ny;
      for (const b of world.query(body.x - r + EPS, body.z - r + EPS, body.x + r - EPS, body.z + r - EPS)) {
        if (b.y1 > ny + EPS && b.y0 < ny + h - EPS) {
          if (sy < 0 && b.y1 <= body.y + EPS) { if (b.y1 > y) { y = b.y1; out.grounded = true; } }
          else if (sy > 0 && b.y0 >= body.y + h - EPS) { if (b.y0 - h < y) { y = b.y0 - h; out.hitCeiling = true; } }
        }
      }
      if (y < 0) { y = 0; out.grounded = true; }
      body.y = y;
    }
    // horizontal, X then Z, with stepping
    horizontal(world, body, sx, 0, r, h, step, out);
    horizontal(world, body, 0, sz, r, h, step, out);
  }
  const [bx0, bz0, bx1, bz1] = world.bounds;
  if (body.x < bx0 + r) { body.x = bx0 + r; out.hitX = true; } if (body.x > bx1 - r) { body.x = bx1 - r; out.hitX = true; }
  if (body.z < bz0 + r) { body.z = bz0 + r; out.hitZ = true; } if (body.z > bz1 - r) { body.z = bz1 - r; out.hitZ = true; }
  if (body.y <= EPS) { body.y = 0; }
  return out;
}

function horizontal(world, body, dx, dz, r, h, step, out) {
  if (dx === 0 && dz === 0) return;
  const nx = body.x + dx, nz = body.z + dz;
  let blocked = false, lift = 0;
  for (const b of world.query(nx - r + EPS, nz - r + EPS, nx + r - EPS, nz + r - EPS)) {
    if (!(b.y1 > body.y + EPS && b.y0 < body.y + h - EPS)) continue;
    // A ledge low enough to step onto (only from the ground or a surface).
    if (step > 0 && b.y1 - body.y <= step && b.y0 <= body.y + step) { lift = Math.max(lift, b.y1 - body.y); continue; }
    blocked = true; break;
  }
  if (!blocked && lift > 0 && overlaps(world, nx, body.y + lift, nz, r, h)) blocked = true;
  if (blocked) {
    // Slide flush against the face we hit.
    for (const b of world.query(nx - r + EPS, nz - r + EPS, nx + r - EPS, nz + r - EPS)) {
      if (!(b.y1 > body.y + EPS && b.y0 < body.y + h - EPS)) continue;
      if (dx > 0 && body.x + r <= b.x0 + EPS) body.x = Math.min(body.x + dx, b.x0 - r);
      else if (dx < 0 && body.x - r >= b.x1 - EPS) body.x = Math.max(body.x + dx, b.x1 + r);
      if (dz > 0 && body.z + r <= b.z0 + EPS) body.z = Math.min(body.z + dz, b.z0 - r);
      else if (dz < 0 && body.z - r >= b.z1 - EPS) body.z = Math.max(body.z + dz, b.z1 + r);
    }
    if (dx) out.hitX = true; if (dz) out.hitZ = true;
    return;
  }
  body.x = nx; body.z = nz; if (lift > 0) { body.y += lift; out.grounded = true; out.stepped = true; }
}

/**
 * Ray against a box (slab method). Returns the entry distance in [0, maxT] or -1. `normal` (optional
 * array of 3) receives the face normal of the entry point.
 */
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxT, normal) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz;
    const lo = a === 0 ? x0 : a === 1 ? y0 : z0, hi = a === 0 ? x1 : a === 1 ? y1 : z1;
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return -1; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (normal) { normal[0] = normal[1] = normal[2] = 0; if (axis >= 0) normal[axis] = sign; }
  return tmin;
}

/** Ray against a sphere; entry distance or -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz, tc = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tc * tc;
  if (d2 > r * r) return -1;
  const th = Math.sqrt(r * r - d2), t = tc - th >= 0 ? tc - th : tc + th;
  return t >= 0 && t <= maxT ? t : -1;
}

/**
 * Cast a ray (unit direction) through the world. Walks the grid cells along the ray (DDA) so only
 * nearby boxes are tested. Returns { t, box, normal } for the first solid hit within maxT, or null.
 * Thin boxes are reported like any other; the caller decides about penetration via `skip`.
 */
export function raycast(world, ox, oy, oz, dx, dy, dz, maxT, skip = null, out = /** @type {{ t: number, box: any, normal: number[], ground?: boolean }} */ ({ t: 0, box: null, normal: [0, 0, 0] })) {
  const [bx0, bz0] = world.bounds, cell = world.cell, cols = world.cols, rows = world.rows;
  const stamp = world.nextStamp();
  let best = maxT, hit = null; const n = [0, 0, 0];
  // Ground plane.
  if (dy < -1e-9) { const t = -oy / dy; if (t >= 0 && t < best) { best = t; hit = 'ground'; out.normal[0] = 0; out.normal[1] = 1; out.normal[2] = 0; } }
  let i = world.cx(ox), j = world.cz(oz);
  const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
  const edgeX = bx0 + (i - 1 + (dx > 0 ? 1 : 0)) * cell, edgeZ = bz0 + (j - 1 + (dz > 0 ? 1 : 0)) * cell;
  let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : (edgeX - ox) / dx, tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : (edgeZ - oz) / dz;
  const tDX = Math.abs(dx) < 1e-9 ? Infinity : cell / Math.abs(dx), tDZ = Math.abs(dz) < 1e-9 ? Infinity : cell / Math.abs(dz);
  let tCell = 0;
  for (let guard = 0; guard < 400; guard++) {
    if (i < 0 || j < 0 || i >= cols || j >= rows || tCell > best) break;
    for (const b of world.cells[j * cols + i]) {
      if (b.stamp === stamp) continue; b.stamp = stamp;
      if (skip && skip(b)) continue;
      const t = rayBox(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, best, n);
      if (t >= 0 && t < best) { best = t; hit = b; out.normal[0] = n[0]; out.normal[1] = n[1]; out.normal[2] = n[2]; }
    }
    if (tMaxX < tMaxZ) { tCell = tMaxX; tMaxX += tDX; i += stepI; } else { tCell = tMaxZ; tMaxZ += tDZ; j += stepJ; }
  }
  if (!hit) return null;
  out.t = best; out.box = hit === 'ground' ? null : hit; out.ground = hit === 'ground';
  return out;
}

/** True when nothing solid lies between two points. */
export function lineOfSight(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return !raycast(world, ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, null, scratch);
}
const scratch = { t: 0, box: null, normal: [0, 0, 0] };
