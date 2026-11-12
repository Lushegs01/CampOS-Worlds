// What a boot lands on and what a round strikes, from the map itself — the same data the renderer draws:
//   * standing on a box: its material (shared/arena/maps.mjs `mat`);
//   * on the ground: the painted zones of the ground shader (src/arena/scene/environment.ts splatTexture): asphalt
//     road lanes north and south, gravel along the walls and in the spawns, dirt patches scattered by the same hash,
//     concrete elsewhere — with the shader's precedence (road over gravel; dirt over both, except on the road).

/** Operation: Metropolis materials (shared/arena/metropolis.mjs): what a boot and a round make of each. */
const CITY_STEP = {
  'st-asphalt': 'asphalt', 'st-sidewalk': 'concrete', 'st-pavers': 'stone', 'st-plaza': 'stone', 'st-grass': 'grass', 'st-yard': 'concrete', 'st-tile': 'stone', 'st-marble': 'stone', 'st-screed': 'concrete',
  'ug-tile': 'stone', 'ug-track': 'gravel', 'ug-concrete': 'concrete', 'stair-stone': 'stone', 'stair-concrete': 'concrete', 'stair-steel': 'metal', 'floor-timber': 'wood', 'roof-deck': 'gravel', 'roof-sheet': 'container',
  'brt-platform': 'stone', 'brt-roof': 'container', canopy: 'container', plinth: 'stone', 'fountain-wall': 'stone', planter: 'stone', hedge: 'grass', bus: 'container', van: 'container', car: 'container', truck: 'container', pickup: 'container',
  tank: 'container', ac: 'metal', vent: 'metal', plant: 'metal', counter: 'wood', desk: 'wood', table: 'wood', bench: 'wood', shelf: 'wood', cabinet: 'metal', rack: 'metal', forklift: 'metal', kiosk: 'container', shelter: 'container',
};
const CITY_IMPACT = {
  'st-asphalt': 'concrete', 'st-grass': 'dirt', 'ug-track': 'dirt', 'stair-steel': 'metal', 'floor-timber': 'wood', 'roof-sheet': 'sheet', 'roof-deck': 'concrete', hedge: 'foliage', planter: 'concrete', tree: 'wood',
  bus: 'sheet', van: 'sheet', car: 'sheet', truck: 'sheet', pickup: 'sheet', tank: 'sheet', ac: 'sheet', vent: 'sheet', plant: 'sheet', kiosk: 'sheet', shelter: 'sheet', canopy: 'sheet', 'brt-roof': 'sheet', 'brt-screen': 'glass', hoarding: 'sheet', 'yard-wall': 'sheet',
  counter: 'wood', desk: 'wood', table: 'wood', bench: 'wood', shelf: 'wood', sofa: 'wood', partition: 'wood', 'partition-wall': 'wood', cabinet: 'metal', rack: 'metal', forklift: 'metal', bollard: 'metal', column: 'concrete', 'ug-column': 'concrete',
  vending: 'metal', atm: 'metal', faregate: 'metal', switchgear: 'metal', utility: 'metal', bin: 'metal', spire: 'metal', frame: 'glass',
};
/** Footstep surfaces (each has its own footstep bank, src/arena/sound/engine.ts). */
export const STEP_SURFACES = ['concrete', 'asphalt', 'gravel', 'dirt', 'grass', 'sand', 'metal', 'container', 'wood', 'stone'];

/** The surface a boot meets on a box of material `mat`. */
export function stepSurfaceOf(mat) {
  if (!mat) return 'concrete';
  const city = CITY_STEP[mat]; if (city) return city;
  if (mat.startsWith('container') || mat === 'roof') return 'container';
  if (['metal', 'grate', 'rail', 'machine', 'pillar', 'bronze'].includes(mat)) return 'metal';
  if (mat === 'timber' || mat === 'crate') return 'wood';
  if (mat === 'sandbag') return 'sand';
  if (mat === 'hedge') return 'grass';
  if (mat === 'stone') return 'stone';
  return 'concrete';
}
/** The impact sound for a round striking a box of material `mat` (src/arena/sound/engine.ts impacts bank). */
export function impactSurfaceOf(mat) {
  if (!mat) return 'dirt';
  const city = CITY_IMPACT[mat]; if (city) return city;
  if (mat.startsWith('bld-')) return mat === 'bld-brick' || mat === 'bld-brick-upper' || mat === 'bld-block' ? 'brick' : mat === 'bld-sheet' || mat === 'bld-terminal' ? 'sheet' : 'concrete';
  if (mat.startsWith('container') || mat === 'roof') return 'sheet';
  if (['metal', 'grate', 'rail', 'machine', 'pillar', 'bronze'].includes(mat)) return 'metal';
  if (mat === 'timber' || mat === 'crate') return 'wood';
  if (mat === 'sandbag') return 'sand';
  if (mat === 'hedge') return 'foliage';
  if (mat === 'brick') return 'brick';
  if (mat === 'glass' || mat === 'window') return 'glass';
  return 'concrete';
}

const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
/** The painted ground at (x, z) of a map with bounds [x0, z0, x1, z1]. */
export function groundSurface(bounds, x, z) {
  const [bx0, bz0, bx1, bz1] = bounds;
  // Road lanes (and the access roads beyond the side walls) — the ground shader's strongest layer.
  const road = (z >= bz1 - 15 && z <= bz1 - 1) || (z >= bz0 + 1 && z <= bz0 + 15) || (Math.abs(z) <= 3.5 && (x <= bx0 - 2 || x >= bx1 + 2));
  if (road) return 'asphalt';
  // Dirt patches: 40 ellipses placed by the same hash as the splat map (radius 1.5–5.5 m, 1.4 : 1, rotated).
  for (let i = 0; i < 40; i++) {
    const px = bx0 + hash(i, 1) * (bx1 - bx0), pz = bz0 + hash(i, 2) * (bz1 - bz0), r = (1.5 + hash(i, 3) * 4) * .85, a = hash(i, 4) * 3;
    // The splat is drawn on a canvas whose y axis is z: the ellipse's rotation is in that plane.
    const dx = x - px, dz = z - pz, c = Math.cos(a), s = Math.sin(a), u = dx * c + dz * s, v = -dx * s + dz * c;
    if ((u / (r * 1.4)) ** 2 + (v / r) ** 2 <= 1) return 'dirt';
  }
  if (z < bz0 + 1.5 || z > bz1 - 1.5 || x < bx0 + 7 || x > bx1 - 7) return 'gravel';
  return 'concrete';
}

/** Every footstep surface a map can put under a player (for loading the right footstep banks with the map). */
export function mapSurfaces(map) {
  const set = new Set(['concrete', 'asphalt', 'gravel', 'dirt']);
  for (const b of map.boxes) set.add(stepSurfaceOf(b.mat));
  return STEP_SURFACES.filter(s => set.has(s));
}

/**
 * A stair step: a box that is a short riser (0.25 m steps, 0.5 m deep, built by maps.mjs `stairs`). Footsteps on
 * stairs use the stair recordings where a surface has them.
 */
export function isStair(box) {
  if (box.stair) return true;
  const dy = box.max[1] - box.min[1], dx = box.max[0] - box.min[0], dz = box.max[2] - box.min[2];
  return Math.min(dx, dz) <= .55 && Math.max(dx, dz) <= 2.2 && Math.abs((box.max[1] / .25) - Math.round(box.max[1] / .25)) < .02 && dy <= 4.1 && box.max[1] <= 4.1;
}
