import { COLLIDERS, TREES } from '../../shared/campus.mjs';

// Campus ground plan (metres, +x east, +z south). Paths are axis-aligned slabs so overlaps
// resolve by surface height and kerbs can be clipped against neighbouring paths.
export type PathMaterial = 'pavers' | 'paversGrey' | 'granite' | 'asphalt';
export interface PathRect { mat: PathMaterial; x0: number; x1: number; z0: number; z1: number; kerb?: 'low' | 'road' | 'none' }

export const PATHS: PathRect[] = [
  { mat: 'pavers', x0: -4, x1: 4, z0: 11, z1: 43.5 },
  { mat: 'pavers', x0: -4, x1: 4, z0: -34.5, z1: -11 },
  { mat: 'pavers', x0: -46, x1: 32, z0: 7.5, z1: 12.5 },
  { mat: 'pavers', x0: -42.6, x1: -10.6, z0: -4.0, z1: 3 },
  { mat: 'paversGrey', x0: 10.6, x1: 17.5, z0: -2, z1: 2 },
  { mat: 'paversGrey', x0: 17.5, x1: 42.5, z0: -4.2, z1: 5.5 },
  { mat: 'granite', x0: -18, x1: 18, z0: -34.5, z1: -26 },
  { mat: 'pavers', x0: -55, x1: 55, z0: -31, z1: -27 },
  { mat: 'pavers', x0: -54, x1: -50, z0: -36.5, z1: -31 },
  { mat: 'pavers', x0: 40, x1: 44, z0: -34, z1: -31 },
  { mat: 'pavers', x0: -30, x1: -4, z0: 22.5, z1: 29.5 },
  { mat: 'pavers', x0: -34, x1: -30, z0: 29.5, z1: 38 },
  { mat: 'pavers', x0: -56, x1: -30, z0: 35, z1: 38 },
  { mat: 'pavers', x0: 4, x1: 10, z0: 23.2, z1: 25.8 },
  { mat: 'pavers', x0: 10, x1: 16, z0: 20.8, z1: 24 },
  { mat: 'pavers', x0: 24, x1: 32.6, z0: 17, z1: 28 },
  { mat: 'pavers', x0: 24, x1: 28, z0: 12.5, z1: 17 },
  { mat: 'asphalt', x0: -60, x1: -4, z0: 43.5, z1: 48, kerb: 'road' },
  { mat: 'asphalt', x0: -6.4, x1: 6.4, z0: 43.5, z1: 51.6, kerb: 'road' },
  { mat: 'asphalt', x0: -60, x1: -36, z0: 38, z1: 43.5, kerb: 'road' },
  { mat: 'asphalt', x0: -90, x1: 90, z0: 51.6, z1: 59.5, kerb: 'road' },
];
export const SURFACE_Y: Record<PathMaterial | 'plaza', number> = { asphalt: .025, pavers: .03, paversGrey: .036, granite: .042, plaza: .048 };
export const PLAZA = { x: 0, z: 0, r: 11.4 };
export const PITCH = { x0: -66, x1: -46, z0: -19, z1: 13 };
export const COURT = { x0: 32.6, x1: 55.4, z0: 8.6, z1: 39.4 };
/** Building footprints (no lawn or vegetation inside). */
export const FOOTPRINTS = [
  { x0: -42.6, x1: -17.4, z0: -26.6, z1: -0.6 }, { x0: 17.5, x1: 42.5, z0: -20.5, z1: 5.5 }, { x0: -16.6, x1: 16.6, z0: -52, z1: -34 },
  { x0: -63, x1: -41, z0: -54.5, z1: -35.5 }, { x0: 30, x1: 54, z0: -53, z1: -33 }, { x0: 12.6, x1: 17.4, z0: 44.4, z1: 48.6 },
];

export const inRect = (x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
export function onPath(x: number, z: number, pad = 0) {
  return Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + pad || PATHS.some(p => inRect(x, z, p, pad));
}
export function onStructure(x: number, z: number, pad = 0) {
  return FOOTPRINTS.some(f => inRect(x, z, f, pad)) || inRect(x, z, COURT, pad) || COLLIDERS.some(b => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad);
}
/** Open lawn where grass, shrubs and flowers may grow. */
export function isLawn(x: number, z: number, pad = 0) {
  return Math.abs(x) < 69.3 && z > -64.3 && z < 49.7 && !onPath(x, z, pad) && !onStructure(x, z, pad) && !inRect(x, z, PITCH, pad);
}
export const nearTree = (x: number, z: number, r: number) => TREES.some(t => Math.hypot(t.x - x, t.z - z) < r);

// Planting: hedges are polylines, beds are areas filled with flowering ground cover.
export interface Hedge { points: [number, number][]; height: number; width: number; flowers: 0 | 1 | 2 }
export const HEDGES: Hedge[] = [
  // Ixora borders lining the avenue lawns between the palms.
  ...[-1, 1].flatMap(s => [{ points: [[s * 5.4, 42.6], [s * 5.4, 13.6]] as [number, number][], height: .7, width: .8, flowers: 1 as const }]),
  // Clipped hedges in front of the academic blocks and the library.
  { points: [[-61, -35.2], [-55, -35.2]], height: .9, width: .9, flowers: 0 }, { points: [[-49, -35.2], [-43, -35.2]], height: .9, width: .9, flowers: 0 },
  { points: [[31.5, -32.7], [39, -32.7]], height: .9, width: .9, flowers: 2 }, { points: [[45, -32.7], [52.5, -32.7]], height: .9, width: .9, flowers: 2 },
  { points: [[-42.2, 3.8], [-42.2, -3.2]], height: .8, width: .8, flowers: 1 },
  // Duranta hedge screening the service road and bus bay.
  { points: [[-60, 37.6], [-57, 37.6]], height: 1.1, width: 1, flowers: 0 }, { points: [[-3.6, 42.8], [-29.5, 42.8]], height: 1.0, width: .9, flowers: 0 },
  // Courtyard ring segments are generated from PLAZA.
];
export interface Bed { x: number; z: number; r0: number; r1: number; a0?: number; a1?: number; palette: 'hot' | 'cool' | 'gold' }
export const BEDS: Bed[] = [
  { x: 0, z: 0, r0: 11.7, r1: 12.9, palette: 'hot' },
  { x: -18, z: 16, r0: 0, r1: 2.6, palette: 'gold' }, { x: 19, z: 15, r0: 0, r1: 2.4, palette: 'cool' },
  { x: -12, z: 19.6, r0: 0, r1: 2.0, palette: 'hot' },
  { x: -46, z: -33.4, r0: 0, r1: 2.2, palette: 'gold' }, { x: 47.5, z: -32.4, r0: 0, r1: 2.2, palette: 'hot' },
  { x: -15, z: -30.5, r0: 0, r1: 1.3, palette: 'cool' }, { x: 15, z: -30.5, r0: 0, r1: 1.3, palette: 'cool' },
  { x: 10.4, z: 44.2, r0: 0, r1: 1.8, palette: 'hot' }, { x: -14, z: 38.5, r0: 0, r1: 2.2, palette: 'gold' },
];

/** Finished-surface height under a point, so feet rest on paving rather than sinking into it. */
const GALLERIES = [{ x0: 31, x1: 53, z0: -36.55, z1: -34 }, { x0: 31.3, x1: 37.5, z0: -43, z1: -36.4 }, { x0: -62, x1: -42, z0: -38.9, z1: -36.5 }];
export function surfaceHeight(x: number, z: number) {
  let y = Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r ? SURFACE_Y.plaza : 0;
  for (const p of PATHS) if (inRect(x, z, p)) y = Math.max(y, SURFACE_Y[p.mat]);
  if (inRect(x, z, { x0: -41.5, x1: -18.5, z0: -25.5, z1: -4.6 })) y = Math.max(y, .024);
  // Café floor, and the raised ground-floor galleries (plus Studio D1) of the academic blocks.
  if (inRect(x, z, { x0: 18.1, x1: 41.9, z0: -12.3, z1: -4.45 })) y = Math.max(y, .03);
  for (const r of GALLERIES) if (inRect(x, z, r)) y = Math.max(y, .16);
  return y;
}
