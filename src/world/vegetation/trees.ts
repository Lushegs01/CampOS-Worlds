import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../architecture/kit';

// Procedural tropical trees. Wood is generated as tapered tubes with UVs in metres (for the bark
// texture); foliage is alpha-tested cards cut from photo-scanned leaf atlases (2×2 cells).

export type Species = 'terminalia' | 'flamboyant' | 'mango' | 'neem' | 'royal' | 'coconut';
export interface TreeGeometry { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; atlas: 'broad' | 'pinnate' | 'frond'; height: number; canopy: number }

interface Branch { start: THREE.Vector3; dir: THREE.Vector3; length: number; radius: number; level: number }
interface Profile {
  levels: number; trunkHeight: number; trunkRadius: number; trunkLean: number;
  children: (level: number, r: () => number) => number; childStart: number;
  angle: (level: number, r: () => number) => number; lengthRatio: number[]; radiusRatio: number;
  gravity: number[]; upward: number[]; gnarl: number;
  leafLevel: number; leavesPerBranch: number; leafSize: [number, number]; leafCells: number[]; leafFacing: number; atlas: 'broad' | 'pinnate';
  whorls?: { count: number; perWhorl: number; from: number; to: number; spread: number[] };
}

const PROFILES: Record<'terminalia' | 'flamboyant' | 'mango' | 'neem', Profile> = {
  // Madagascar almond: a straight leader with flat whorled tiers — the classic campus "umbrella tree".
  terminalia: {
    levels: 3, trunkHeight: 9.5, trunkRadius: .2, trunkLean: .02, children: () => 3, childStart: .25,
    angle: (l, r) => l === 1 ? 1.15 + r() * .3 : .7 + r() * .4, lengthRatio: [1, .5, .35], radiusRatio: .5,
    gravity: [0, .08, .02], upward: [0, .02, .06], gnarl: .05, leafLevel: 2, leavesPerBranch: 5, leafSize: [.9, 1.3], leafCells: [0, 1, 2, 3], leafFacing: .85, atlas: 'broad',
    whorls: { count: 6, perWhorl: 5, from: .32, to: .96, spread: [5.2, 1.4] },
  },
  // Flame tree: short trunk, wide spreading limbs and a flat umbrella crown with scarlet blossom.
  flamboyant: {
    levels: 4, trunkHeight: 2.8, trunkRadius: .3, trunkLean: .06, children: l => l === 1 ? 4 : l === 2 ? 4 : 5, childStart: .35,
    angle: (l, r) => l === 1 ? .85 + r() * .3 : .6 + r() * .4, lengthRatio: [1, 2.2, .55, .45], radiusRatio: .6,
    gravity: [0, -.05, .05, .08], upward: [0, .02, .08, .1], gnarl: .16, leafLevel: 3, leavesPerBranch: 6, leafSize: [1.5, 2.1], leafCells: [0, 1, 2, 3, 2, 3], leafFacing: .8, atlas: 'pinnate',
  },
  // Mango: dense, dark dome on a short, branching trunk.
  mango: {
    levels: 4, trunkHeight: 2.2, trunkRadius: .3, trunkLean: .04, children: l => l === 1 ? 5 : l === 2 ? 4 : 4, childStart: .3,
    angle: (l, r) => l === 1 ? .55 + r() * .35 : .55 + r() * .45, lengthRatio: [1, 2.2, .55, .5], radiusRatio: .58,
    gravity: [0, -.02, .04, .06], upward: [0, .06, .1, .12], gnarl: .14, leafLevel: 3, leavesPerBranch: 9, leafSize: [1.1, 1.5], leafCells: [0, 1, 3], leafFacing: .35, atlas: 'broad',
  },
  // Neem: upright oval crown of fine pinnate foliage.
  neem: {
    levels: 4, trunkHeight: 3.6, trunkRadius: .24, trunkLean: .05, children: l => l === 1 ? 5 : 4, childStart: .35,
    angle: (l, r) => l === 1 ? .45 + r() * .3 : .5 + r() * .4, lengthRatio: [1, 1.6, .55, .45], radiusRatio: .58,
    gravity: [0, 0, .03, .05], upward: [0, .1, .12, .1], gnarl: .12, leafLevel: 3, leavesPerBranch: 7, leafSize: [1.2, 1.6], leafCells: [0, 1], leafFacing: .45, atlas: 'pinnate',
  },
};

/** Tapered tube along a polyline of points with per-point radius; UVs in metres. */
function tube(points: THREE.Vector3[], radii: number[], sides: number) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    t.copy(points[Math.min(i + 1, points.length - 1)]).sub(points[Math.max(i - 1, 0)]).normalize();
    n.copy(Math.abs(t.y) > .95 ? new THREE.Vector3(1, 0, 0) : up).cross(t).normalize(); b.crossVectors(t, n);
    if (i > 0) along += points[i].distanceTo(points[i - 1]);
    const circ = Math.PI * 2 * radii[0];
    for (let s = 0; s <= sides; s++) {
      const a = s / sides * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      const nx = n.x * dx + b.x * dy, ny = n.y * dx + b.y * dy, nz = n.z * dx + b.z * dy;
      pos.push(points[i].x + nx * radii[i], points[i].y + ny * radii[i], points[i].z + nz * radii[i]); nor.push(nx, ny, nz); uv.push(s / sides * Math.max(.35, circ), along);
    }
  }
  for (let i = 0; i < points.length - 1; i++) for (let s = 0; s < sides; s++) { const a = i * (sides + 1) + s, c = a + sides + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

interface Card { center: THREE.Vector3; normal: THREE.Vector3; right: THREE.Vector3; size: number; cell: number; tint: number }

function cardsGeometry(cards: Card[], canopyCenter: THREE.Vector3, canopyScale: THREE.Vector3, wrap = .65) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], wind: number[] = [];
  const up = new THREE.Vector3(), hull = new THREE.Vector3(), nn = new THREE.Vector3();
  for (const c of cards) {
    up.crossVectors(c.normal, c.right).normalize();
    // Bend shading normals towards the canopy hull so the crown lights as a volume.
    hull.copy(c.center).sub(canopyCenter).divide(canopyScale).normalize();
    nn.copy(c.normal).multiplyScalar(1 - wrap).addScaledVector(hull, wrap).normalize();
    const h = c.size / 2, u0 = (c.cell % 2) * .5, v0 = c.cell < 2 ? .5 : 0;
    const corners = [[-h, -h, u0, v0], [h, -h, u0 + .5, v0], [h, h, u0 + .5, v0 + .5], [-h, h, u0, v0 + .5]];
    const phase = (c.center.x * 1.7 + c.center.z * 2.3) % 6.283;
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [a, bb, cu, cv] = corners[k];
      pos.push(c.center.x + c.right.x * a + up.x * bb, c.center.y + c.right.y * a + up.y * bb, c.center.z + c.right.z * a + up.z * bb);
      nor.push(nn.x, nn.y, nn.z); uv.push(cu, cv); col.push(c.tint, c.tint, c.tint); wind.push(phase, k === 0 || k === 1 || k === 3 && false ? .3 : 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
  g.computeBoundingSphere(); return g;
}

/** `lite` trees (the distant belt) keep only trunk and main limbs as geometry. */
export function growTree(species: keyof typeof PROFILES, seed: number, density = 1, lite = false): TreeGeometry {
  const P = PROFILES[species], r = rng(seed * 7919 + 13), woods: THREE.BufferGeometry[] = [], cards: Card[] = [];
  const queue: Branch[] = [{ start: new THREE.Vector3(0, -.3, 0), dir: new THREE.Vector3((r() - .5) * P.trunkLean, 1, (r() - .5) * P.trunkLean).normalize(), length: P.trunkHeight + .3, radius: P.trunkRadius, level: 0 }];
  const spawn = (b: Branch, path: THREE.Vector3[], radii: number[]) => {
    const level = b.level + 1;
    if (P.whorls && b.level === 0) {
      // Tiered whorls along the leader, each tier shorter towards the crown.
      const { count, perWhorl, from, to, spread } = P.whorls;
      for (let w = 0; w < count; w++) {
        const t = from + (to - from) * w / (count - 1), k = Math.floor(t * (path.length - 1)), len = spread[0] + (spread[1] - spread[0]) * (w / (count - 1));
        for (let i = 0; i < perWhorl; i++) {
          const az = (i / perWhorl) * Math.PI * 2 + w * 1.1 + r() * .4, tilt = P.angle(1, r);
          const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)).normalize();
          queue.push({ start: path[k].clone(), dir, length: len * (.85 + r() * .3), radius: Math.max(.03, radii[k] * .45), level: 1 });
        }
      }
      return;
    }
    if (level >= P.levels) return;
    const n = Math.max(1, Math.round(P.children(level, r) * (level >= P.levels - 1 ? Math.max(.5, density) : 1)));
    for (let i = 0; i < n; i++) {
      const t = P.childStart + (1 - P.childStart) * (n === 1 ? .8 : i / (n - 1)) * .92 + r() * .04, k = Math.min(path.length - 1, Math.floor(t * (path.length - 1)));
      const az = i * 2.39996 + r() * .5, tilt = P.angle(level, r);
      const axis = new THREE.Vector3(Math.cos(az), 0, Math.sin(az)).cross(b.dir).normalize();
      if (axis.lengthSq() < .01) axis.set(1, 0, 0);
      const dir = b.dir.clone().applyAxisAngle(axis, tilt).applyAxisAngle(b.dir, az);
      const len = b.length * P.lengthRatio[level] * (.75 + r() * .45) * (1 - t * .35 * (level > 1 ? 1 : .2));
      queue.push({ start: path[k].clone(), dir: dir.normalize(), length: len, radius: Math.max(.012, radii[k] * P.radiusRatio), level });
    }
  };
  while (queue.length) {
    const b = queue.shift()!;
    const segs = b.level === 0 ? 8 : b.level === 1 ? 5 : 3, step = b.length / segs, path = [b.start.clone()], radii = [b.radius];
    const dir = b.dir.clone(), p = b.start.clone();
    for (let i = 1; i <= segs; i++) {
      dir.y -= P.gravity[b.level] ?? 0; dir.y += P.upward[b.level] ?? 0;
      dir.x += (r() - .5) * P.gnarl; dir.z += (r() - .5) * P.gnarl; dir.normalize();
      p.addScaledVector(dir, step); path.push(p.clone());
      radii.push(b.radius * (1 - i / segs * .72) + (b.level === 0 && i === 1 ? .0 : 0));
    }
    if (b.level === 0) radii[0] *= 1.45;
    // Fine twigs are hidden by the leaf cards; only limbs that read at a distance get geometry.
    if (b.radius > .028 && b.level <= (lite ? 0 : 2)) woods.push(tube(path, radii, b.level === 0 ? 8 : b.level === 1 ? 6 : b.level === 2 ? 4 : 3));
    spawn(b, path, radii);
    if (b.level >= P.leafLevel || (P.whorls && b.level >= 1)) {
      const n = Math.max(1, Math.round(P.leavesPerBranch * density * (b.level >= P.leafLevel ? 1 : .5)));
      for (let i = 0; i < n; i++) {
        const t = .35 + .65 * (i + r()) / n, k = Math.min(path.length - 1, Math.round(t * (path.length - 1)));
        const center = path[k].clone().add(new THREE.Vector3((r() - .5) * .6, (r() - .2) * .4, (r() - .5) * .6));
        const facing = new THREE.Vector3((r() - .5) * 2, 0, (r() - .5) * 2);
        const normal = facing.multiplyScalar(1 - P.leafFacing).add(new THREE.Vector3(0, P.leafFacing + r() * .3, 0)).normalize();
        const right = new THREE.Vector3(r() - .5, 0, r() - .5).cross(normal).normalize();
        if (right.lengthSq() < .01) right.set(1, 0, 0);
        cards.push({ center, normal, right, size: P.leafSize[0] + r() * (P.leafSize[1] - P.leafSize[0]), cell: P.leafCells[Math.floor(r() * P.leafCells.length)], tint: .82 + r() * .3 });
      }
    }
  }
  const box = new THREE.Box3(); for (const c of cards) box.expandByPoint(c.center);
  const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).multiplyScalar(.5).max(new THREE.Vector3(.5, .5, .5));
  const wood = mergeGeometries(woods, false)!; woods.forEach(w => w.dispose());
  return { wood, leaves: cardsGeometry(cards, centre, size), atlas: P.atlas, height: box.max.y, canopy: Math.max(size.x, size.z) };
}

/** Palms: ringed or smooth trunk, crownshaft and drooping V-section fronds. */
export function growPalm(kind: 'royal' | 'coconut', seed: number, density = 1, lite = false): TreeGeometry {
  const r = rng(seed * 104729 + 7), royal = kind === 'royal', H = royal ? 8.6 + r() * 1.6 : 8.5 + r() * 2.5;
  const lean = royal ? .015 : .1 + r() * .12, az = r() * Math.PI * 2, points: THREE.Vector3[] = [], radii: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, bend = lean * H * t * t * (royal ? 1 : 1.4);
    points.push(new THREE.Vector3(Math.cos(az) * bend, t * H - .2, Math.sin(az) * bend));
    // Royal palms swell at the base and mid-trunk; coconuts taper gently with a flared foot.
    radii.push(royal ? .15 + .1 * Math.exp(-t * 9) + .035 * Math.sin(Math.PI * Math.min(1, t * 1.6)) : .14 + .08 * Math.exp(-t * 10) - .025 * t);
  }
  const colored = (g: THREE.BufferGeometry, c: [number, number, number]) => { const n = g.getAttribute('position').count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const woods = [colored(tube(points, radii, lite ? 6 : 10), [1, 1, 1])];
  const top = points[points.length - 1].clone();
  if (royal) woods.push(colored(tube([top.clone(), top.clone().add(new THREE.Vector3(0, 1.9, 0))], [.16, .13], lite ? 6 : 10), [.42, .62, .3]));
  const crown = royal ? top.clone().add(new THREE.Vector3(0, 1.8, 0)) : top.clone();
  const fronds = Math.round((royal ? 16 : 20) * Math.max(.6, density)), pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], wind: number[] = [];
  for (let f = 0; f < fronds; f++) {
    const ang = f * 2.39996 + r() * .3, elev = royal ? .95 - (f / fronds) * 1.45 : .75 - (f / fronds) * 1.6, len = (royal ? 3.6 : 4.2) * (.85 + r() * .25), dead = !royal && f > fronds - 3;
    const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(elev), Math.sin(elev), Math.sin(ang) * Math.cos(elev));
    const side = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));
    const seg = 10, spine: THREE.Vector3[] = [];
    for (let i = 0; i <= seg; i++) { const t = i / seg, p = crown.clone().addScaledVector(dir, len * t); p.y -= (dead ? 2.4 : 1.25) * t * t * len / 4; spine.push(p); }
    const tint = dead ? .55 : .85 + r() * .25, phase = ang;
    for (let i = 0; i < seg; i++) for (const s of [-1, 1]) {
      // Each half of the frond is a strip angled up into a shallow V.
      const w0 = .62 * Math.sin(Math.PI * (.1 + .9 * i / seg)) + .05, w1 = .62 * Math.sin(Math.PI * (.1 + .9 * (i + 1) / seg)) + .05;
      const a = spine[i], b = spine[i + 1], v0 = s < 0 ? .5 : .5, lift = .35;
      const ea = a.clone().addScaledVector(side, s * w0).add(new THREE.Vector3(0, w0 * lift, 0)), eb = b.clone().addScaledVector(side, s * w1).add(new THREE.Vector3(0, w1 * lift, 0));
      const n = new THREE.Vector3().subVectors(b, a).cross(side).normalize().multiplyScalar(-1);
      if (n.y < 0) n.negate();
      const u0 = i / seg, u1 = (i + 1) / seg, vEdge = s < 0 ? 0 : 1;
      const quad = [[a, u0, v0], [b, u1, v0], [eb, u1, vEdge], [a, u0, v0], [eb, u1, vEdge], [ea, u0, vEdge]] as const;
      for (const [p, u, v] of quad) { pos.push(p.x, p.y, p.z); nor.push(n.x * .5, .85, n.z * .5); uv.push(u, v); col.push(tint * (dead ? 1.25 : 1), tint * (dead ? .95 : 1), tint * (dead ? .55 : 1)); wind.push(phase, u); }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); leaves.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
  leaves.computeBoundingSphere();
  if (!royal && !lite) for (let i = 0; i < 9; i++) { const a = i * 2.4; woods.push(colored(new THREE.SphereGeometry(.13, 8, 6).translate(top.x + Math.cos(a) * .3, top.y - .25 - (i % 3) * .1, top.z + Math.sin(a) * .3), [.55, .42, .2])); }
  const wood = mergeGeometries(woods.map(w => w.index ? w.toNonIndexed() : w), false)!;
  return { wood, leaves, atlas: 'frond', height: crown.y + 1, canopy: 4.5 };
}
