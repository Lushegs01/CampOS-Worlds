// Overhead services: the low-voltage distribution that hangs over every street of a real West African city and gives
// the reference footage much of its depth (poles, crossarms, pin insulators, pole-mounted transformers, cables
// sagging in catenaries, service drops to the buildings, bundles strung across the street from wall to wall).
//
// Nothing here is collidable or standing where a player can walk: the conductors hang from the existing lamp columns
// (already solid in the shared collision map) and from brackets on building walls, at 5–7 m above the street.
// Everything is merged into the city's regional geometry like the rest of the static art: no new draw calls per
// cable, only one per material per region.
import * as THREE from 'three';
import { hash } from '../environment';
import type { CityBuilder, CityMap, Box } from './kit';
import type { CityMats } from './materials';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The angle one drawn pixel subtends (radians), set every frame by the city: cables never get thinner than this. */
export const cablePixel = { value: 1 / 720 };
/**
 * Overhead cable material: a few millimetres of sheathed cable is far under a pixel beyond ~15 m, and a sub-pixel tube
 * rasterises as a broken dashed line. Each vertex is pushed out along its (radial) normal so the cable is never
 * narrower than about one pixel on screen; close up the true radius is kept. Opaque, so no sorting or blending cost.
 */
export function cableMaterial(base: THREE.MeshStandardMaterial) {
  const m = base.clone(); m.name = 'cable'; m.userData = { ...base.userData, fixed: true };
  m.onBeforeCompile = s => {
    s.uniforms.uCablePixel = cablePixel;
    s.vertexShader = 'uniform float uCablePixel;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 cw = modelMatrix * vec4(transformed, 1.); float dist = length(cw.xyz - cameraPosition);
        transformed += normalize(objectNormal) * max(0., dist * uCablePixel * .6 - .012); }`);
  };
  m.customProgramCacheKey = () => 'city-cable';
  return m;
}

export function buildUtilities(b: CityBuilder, m: CityMats, map: CityMap, detail: number) {
  const L = map.street, sides = detail ? 5 : 3, segs = detail ? 14 : 8, wire = cableMaterial(m.cable as THREE.MeshStandardMaterial);
  // What a cable can meet: whole building footprints (their walls are broken up by window bands at cable height, so a
  // ray against the wall boxes slips through a window into the room) and solid blocks.
  const walls: Box[] = [
    ...map.buildings.map(g => ({ min: [g.x0, g.y0, g.z0], max: [g.x1, g.y1, g.z1], mat: 'building' })),
    ...map.boxes.filter(x => /^bld-/.test(x.mat) && x.max[1] > L + 4 && Math.min(x.max[0] - x.min[0], x.max[2] - x.min[2]) > .8),
  ];
  const inside = (x: number, y: number, z: number) => walls.some(w => x > w.min[0] && x < w.max[0] && y > w.min[1] && y < w.max[1] && z > w.min[2] && z < w.max[2]);
  /** Distance along ±x or ±z from (x, y, z) to the first building wall, or Infinity. */
  const cast = (x: number, y: number, z: number, axis: 'x' | 'z', dir: 1 | -1, max: number) => {
    let best = Infinity;
    for (const w of walls) {
      if (y < w.min[1] || y > w.max[1]) continue;
      if (axis === 'x') { if (z < w.min[2] || z > w.max[2]) continue; const t = ((dir > 0 ? w.min[0] : w.max[0]) - x) * dir; if (t > .05 && t < best) best = t; }
      else { if (x < w.min[0] || x > w.max[0]) continue; const t = ((dir > 0 ? w.min[2] : w.max[2]) - z) * dir; if (t > .05 && t < best) best = t; }
    }
    return best <= max ? best : Infinity;
  };
  /** A cable hanging between two points (a catenary approximated by a parabola: the sag is a few % of the span). */
  const cable = (a: THREE.Vector3, c: THREE.Vector3, sag: number, r = .014) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) { const t = i / segs; pts.push(a.clone().lerp(c, t).add(V(0, -4 * sag * t * (1 - t), 0))); }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, sides, false);
    b.add(g, wire, 1); g.dispose();
  };
  /** A wall bracket with an insulator, where a cable meets a building (n: the wall's outward normal). */
  const bracket = (p: THREE.Vector3, n: THREE.Vector3) => {
    const base = p.clone().addScaledVector(n, -.22);
    b.cyl(base, p, .014, m.darkSteel, 5); b.cyl(p.clone().add(V(0, -.07, 0)), p.clone().add(V(0, .05, 0)), .035, m.insulator, 8);
  };
  b.force = 'out';

  // ------------------------------------------------------------ the lamp columns carry the distribution line
  type Pole = { x: number; z: number; top: number; arm: 'x' | 'z'; id: number };
  const poles: Pole[] = map.boxes.filter(x => x.mat === 'lamppost').map((x, id) => {
    const cx = (x.min[0] + x.max[0]) / 2, cz = (x.min[2] + x.max[2]) / 2;
    // The lantern arm reaches over the carriageway (as props.ts places it): the conductors run along the street.
    const armZ = Math.abs(cz + 25) < 6 || Math.abs(cz - 14) < 5;
    return { x: cx, z: cz, top: x.max[1], arm: armZ ? 'z' : 'x', id };
  });
  const armY = (p: Pole) => p.top + .55, spread = [-.62, 0, .62];
  const pin = (p: Pole, k: number) => p.arm === 'z' ? V(p.x, armY(p) + .13, p.z + spread[k]) : V(p.x + spread[k], armY(p) + .13, p.z);
  for (const p of poles) {
    // Crossarm (creosoted timber) with two braces and three pin insulators.
    const along = p.arm === 'z' ? V(0, 0, 1) : V(1, 0, 0), y = armY(p), c = V(p.x, y, p.z);
    const e0 = c.clone().addScaledVector(along, -.8), e1 = c.clone().addScaledVector(along, .8);
    if (p.arm === 'z') b.box(p.x - .05, y - .05, p.z - .8, p.x + .05, y + .05, p.z + .8, m.timber, 1); else b.box(p.x - .8, y - .05, p.z - .05, p.x + .8, y + .05, p.z + .05, m.timber, 1);
    b.cyl(c.clone().add(V(0, -.55, 0)), e0.clone().addScaledVector(along, .3), .016, m.darkSteel, 4); b.cyl(c.clone().add(V(0, -.55, 0)), e1.clone().addScaledVector(along, -.3), .016, m.darkSteel, 4);
    for (let k = 0; k < 3; k++) { const q = pin(p, k); b.cyl(q.clone().add(V(0, -.13, 0)), q.clone().add(V(0, -.04, 0)), .012, m.steel, 4); b.cyl(q.clone().add(V(0, -.05, 0)), q.clone().add(V(0, .03, 0)), .045, m.insulator, 8); }
    // Every third column carries a transformer drum on a bracket, with its bushings and a fuse arm.
    if (p.id % 3 === 1) {
      const side = p.arm === 'z' ? V(hash(p.x, 3) > .5 ? 1 : -1, 0, 0) : V(0, 0, hash(p.z, 3) > .5 ? 1 : -1), t = V(p.x, p.top - .9, p.z).addScaledVector(side, .42);
      b.cyl(V(p.x, p.top - .55, p.z), t.clone().add(V(0, .35, 0)), .03, m.darkSteel, 5); b.cyl(V(p.x, p.top - 1.25, p.z), t.clone().add(V(0, -.35, 0)), .03, m.darkSteel, 5);
      b.post(t.x, t.z, t.y - .42, t.y + .38, .28, m.steel, detail ? 14 : 8); b.post(t.x, t.z, t.y + .38, t.y + .44, .3, m.darkSteel, detail ? 14 : 8);
      if (detail) for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.box(t.x + Math.cos(a) * .27 - .015, t.y - .35, t.z + Math.sin(a) * .27 - .015, t.x + Math.cos(a) * .27 + .015, t.y + .3, t.z + Math.sin(a) * .27 + .015, m.steel, 1); }
      for (const d of [-.12, .12]) { const q = t.clone().add(V(0, .44, 0)).add(p.arm === 'z' ? V(0, 0, d) : V(d, 0, 0)); b.cyl(q, q.clone().add(V(0, .2, 0)), .03, m.insulator, 8); cable(q.clone().add(V(0, .2, 0)), pin(p, d < 0 ? 0 : 2), .05, .01); }
    }
  }
  // Conductors from column to column along each street (three phases, slightly different sags), and a lower
  // bundle of telephone/data cable (the black bundles that sag furthest).
  const linked = new Set<string>();
  for (const p of poles) {
    const best = poles.filter(o => o !== p && o.arm === p.arm).map(o => ({ o, d: Math.hypot(o.x - p.x, o.z - p.z), perp: p.arm === 'z' ? Math.abs(o.z - p.z) : Math.abs(o.x - p.x) }))
      .filter(c => c.perp < 1.2 && c.d > 4 && c.d < 27).sort((a, c) => a.d - c.d);
    // Each column links to its nearest neighbour on each side along the street.
    for (const dir of [-1, 1]) {
      const hit = best.find(c => (p.arm === 'z' ? c.o.x - p.x : c.o.z - p.z) * dir > 0); if (!hit) continue;
      const key = [Math.min(p.id, hit.o.id), Math.max(p.id, hit.o.id)].join(); if (linked.has(key)) continue; linked.add(key);
      // Never through a building: the span must be clear at conductor height.
      const mid = (k: number) => V((p.x + hit.o.x) / 2, armY(p) + .1 - k, (p.z + hit.o.z) / 2);
      if (inside(mid(0).x, mid(0).y, mid(0).z) || inside(mid(.6).x, mid(.6).y, mid(.6).z)) continue;
      for (let k = 0; k < 3; k++) cable(pin(p, k), pin(hit.o, k), hit.d * (.022 + k * .004));
      const low = (o: Pole) => V(o.x, o.top - .35, o.z);
      cable(low(p), low(hit.o), hit.d * .04, .022);
      for (const o of [p, hit.o]) b.cyl(low(o).add(V(0, -.05, 0)), low(o).add(V(0, .05, 0)), .09, m.darkSteel, 6);
    }
    // A service drop from the column to the nearest building across the pavement.
    for (const dir of [-1, 1] as const) {
      const y = armY(p) - .9, d = cast(p.x, y, p.z, p.arm, dir, 11); if (!isFinite(d)) continue;
      const n = p.arm === 'z' ? V(0, 0, -dir) : V(-dir, 0, 0), at = (p.arm === 'z' ? V(p.x + (hash(p.id, dir) - .5) * 2.4, y - .5, p.z + dir * (d - .24)) : V(p.x + dir * (d - .24), y - .5, p.z + (hash(p.id, dir) - .5) * 2.4));
      if (inside(at.x + n.x * .3, at.y, at.z + n.z * .3)) continue;
      cable(pin(p, dir > 0 ? 2 : 0), at, d * .06, .011); bracket(at, n);
      break;
    }
  }

  // ------------------------------------------------------------ bundles strung across the street, wall to wall
  // Sampled along every street: where both kerb lines are fronted by buildings within reach, a bundle of two to four
  // cables crosses at 5.5–7 m between wall brackets (some with a junction box on the wall).
  const streets = map.boxes.filter(x => x.mat === 'st-asphalt' && x.max[1] > L - .3 && Math.min(x.max[0] - x.min[0], x.max[2] - x.min[2]) >= 4);
  let spans = 0;
  for (const s of streets) {
    const along: 'x' | 'z' = s.max[0] - s.min[0] >= s.max[2] - s.min[2] ? 'x' : 'z', across: 'x' | 'z' = along === 'x' ? 'z' : 'x';
    const a0 = along === 'x' ? s.min[0] : s.min[2], a1 = along === 'x' ? s.max[0] : s.max[2], mid = across === 'z' ? (s.min[2] + s.max[2]) / 2 : (s.min[0] + s.max[0]) / 2;
    for (let a = a0 + 3; a < a1 - 3; a += 6.5) {
      if (hash(a, mid) < .42) continue;
      const y = L + 5.4 + hash(a, mid + 1) * 1.4, px = along === 'x' ? a : mid, pz = along === 'x' ? mid : a;
      if (inside(px, y, pz)) continue;
      const dn = cast(px, y, pz, across, -1, 16), dp = cast(px, y, pz, across, 1, 16); if (!isFinite(dn) || !isFinite(dp) || dn + dp < 6) continue;
      const skew = (hash(a, 7) - .5) * 3, pa = along === 'x' ? V(px + skew, y, pz - dn + .24) : V(px - dn + .24, y, pz + skew), pb = along === 'x' ? V(px - skew, y - hash(a, 9) * .8, pz + dp - .24) : V(px + dp - .24, y - hash(a, 9) * .8, pz - skew);
      const na = across === 'z' ? V(0, 0, 1) : V(1, 0, 0), nb = na.clone().negate();
      const n = 2 + Math.floor(hash(a, 11) * 3), span = pa.distanceTo(pb);
      for (let k = 0; k < n; k++) { const o = V(0, -k * .09, 0).add(along === 'x' ? V(k * .07, 0, 0) : V(0, 0, k * .07)); cable(pa.clone().add(o), pb.clone().add(o), span * (.035 + k * .012 + hash(a, k) * .015), k === 0 ? .016 : .012); }
      bracket(pa, na); bracket(pb, nb);
      if (detail && hash(a, 13) > .5) { const j = pa.clone().add(V(0, -.6, 0)); b.box(j.x - (across === 'x' ? .02 : .16), j.y - .2, j.z - (across === 'z' ? .02 : .16), j.x + (across === 'x' ? .1 : .16), j.y + .2, j.z + (across === 'z' ? .1 : .16), m.plasticGrey, 1); cable(pa.clone().add(V(0, -.05, 0)), j.clone().add(V(0, .2, 0)), .02, .01); }
      spans++;
    }
  }
  b.force = null;
  return { poles: poles.length, links: linked.size, spans };
}
