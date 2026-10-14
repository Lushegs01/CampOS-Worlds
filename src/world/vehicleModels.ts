import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { VEHICLE_TYPES } from '../../shared/vehicles.mjs';
import { sign } from './architecture/signage';

// Procedural campus fleet. Bodies are lofted from cross-sections sampled along the length, so the
// bonnet, windscreen rake, roof and tail read as one continuous shell; each quad of the shell is
// assigned a material (paint, glass, trim) from where it sits, which gives pillars, door seams and
// window frames without separate meshes. Units are metres; the vehicle faces +z and +x is its left
// (driver) side. Wheel arches are cut out of the shell and lined so the tyres sit inside them.

export type VehicleType = keyof typeof VEHICLE_TYPES;
type Slot = 'paint' | 'accent' | 'glass' | 'trim' | 'chrome' | 'skip';
type Kind = 'under' | 'side' | 'belt' | 'window' | 'top';
interface Section { y0: number; belt: number; top: number; side: number; roof: number; bottom: number; crown: number }
interface Profile { length: number; section: (z: number) => Section; slot: (z: number, kind: Kind, side: number, y: number) => Slot; arches: { z: number; y: number; r: number }[]; stations: number[] }

/** Catmull-Rom through [z, value] keys (z ascending), clamped at the ends. */
function curve(keys: [number, number][]) {
  return (z: number) => {
    if (z <= keys[0][0]) return keys[0][1];
    const n = keys.length; if (z >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0; while (keys[i + 1][0] < z) i++;
    const p0 = keys[Math.max(0, i - 1)][1], p1 = keys[i][1], p2 = keys[i + 1][1], p3 = keys[Math.min(n - 1, i + 2)][1];
    const t = (z - keys[i][0]) / (keys[i + 1][0] - keys[i][0]), t2 = t * t, t3 = t2 * t;
    return .5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
}
const between = (z: number, a: number, b: number) => z > a && z < b;

/** Half cross-section from the bottom centre round the right side to the top centre. */
function halfSection(s: Section): { p: [number, number][]; k: Kind[] } {
  const p: [number, number][] = [], k: Kind[] = [];
  const push = (x: number, y: number, kind: Kind) => { p.push([x, y]); k.push(kind); };
  push(0, s.y0, 'under'); push(s.bottom, s.y0, 'side');
  const rows = 7, lowest = s.y0 + .1;
  for (let i = 0; i <= rows; i++) { const t = i / rows, y = lowest + (s.belt - lowest) * t; push(s.side - (1 - Math.sin(t * Math.PI / 2)) * .035 - (i === 0 ? .03 : 0), y, i === rows ? 'belt' : 'side'); }
  const glassTop = Math.max(s.belt + .01, s.top - .07), tumble = s.side - s.roof, base = Math.min(glassTop, s.belt + .035);
  push(s.side - .012, base, 'window');
  // The last glass row point opens the roof rail segment, so it is tagged 'top'.
  for (let i = 1; i <= 4; i++) { const t = i / 4; push(s.side - .012 - tumble * t * (.75 + .25 * t), base + (glassTop - base) * t, i === 4 ? 'top' : 'window'); }
  push(s.roof - .05, s.top - .012, 'top'); push(s.roof * .55, s.top + s.crown * .8, 'top'); push(0, s.top + s.crown, 'top');
  return { p, k };
}

function loft(profile: Profile) {
  const zs = [...profile.stations].sort((a, b) => a - b);
  const positions: number[] = [], rings: { z: number; xs: number[]; ys: number[] }[] = [];
  let segments: Kind[] = [];
  for (const z of zs) {
    const { p, k } = halfSection(profile.section(z)), m = p.length;
    // Full loop: right half bottom→top, then the left half top→bottom (centre points shared).
    // Segment q runs from loop vertex q to q+1 and takes the kind of its lower end.
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < m; i++) { xs.push(p[i][0]); ys.push(p[i][1]); }
    for (let i = m - 2; i >= 1; i--) { xs.push(-p[i][0]); ys.push(p[i][1]); }
    segments = xs.map((_, q) => q <= m - 2 ? k[q] : k[2 * m - 3 - q]);
    // Snap shell vertices near a wheel arch onto its circle, so the cut-out reads as a clean arc.
    for (let i = 0; i < xs.length; i++) {
      if (ys[i] > profile.section(z).belt - .05) continue;
      for (const a of profile.arches) { const d = Math.hypot(z - a.z, ys[i] - a.y); if (ys[i] > a.y && d > a.r - .07 && d < a.r + .06 && Math.abs(xs[i]) > .3) { const f = a.r / Math.max(d, 1e-4); ys[i] = a.y + (ys[i] - a.y) * f; } }
    }
    rings.push({ z, xs, ys });
    for (let i = 0; i < xs.length; i++) positions.push(xs[i], ys[i], z);
  }
  const n = rings[0].xs.length, groups = new Map<Slot, number[]>();
  const tri = (slot: Slot, a: number, b: number, c: number) => { if (slot === 'skip') return; let g = groups.get(slot); if (!g) groups.set(slot, g = []); g.push(a, b, c); };
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1], zMid = (A.z + B.z) / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, kind = segments[i], side = A.xs[i] + A.xs[j] >= 0 ? 1 : -1;
      const yMid = (A.ys[i] + A.ys[j] + B.ys[i] + B.ys[j]) / 4, xMid = Math.abs(A.xs[i] + A.xs[j]) / 2;
      let slot = profile.slot(zMid, kind, side, yMid);
      if ((kind === 'side' || kind === 'under') && xMid > .3 && profile.arches.some(a => Math.hypot(zMid - a.z, yMid - a.y) < a.r)) slot = 'skip';
      const a = r * n + i, b = r * n + j, c = (r + 1) * n + j, d = (r + 1) * n + i;
      // Rings advance along +z and the loop climbs the +x side first: this winding faces outward.
      tri(slot, a, b, c); tri(slot, a, c, d);
    }
  }
  // End caps: fans from the ring centroids.
  for (const [r, front] of [[0, false], [rings.length - 1, true]] as const) {
    const ring = rings[r], cx = 0, cy = ring.ys.reduce((s, y) => s + y, 0) / n, centre = positions.length / 3;
    positions.push(cx, cy, ring.z);
    for (let i = 0; i < n; i++) { const a = r * n + i, b = r * n + (i + 1) % n; if (front) tri('paint', centre, a, b); else tri('paint', centre, b, a); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const index: number[] = [];
  for (const [slot, list] of groups) { geometry.addGroup(index.length, list.length, SLOTS.indexOf(slot)); index.push(...list); }
  geometry.setIndex(index); geometry.computeVertexNormals();
  // Planar UVs (metres) are enough for the flat paint and glass shading.
  const pos = geometry.getAttribute('position'), uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getZ(i); uv[i * 2 + 1] = pos.getY(i); }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
const SLOTS: Slot[] = ['paint', 'accent', 'glass', 'trim', 'chrome'];

// ------------------------------------------------------------------ shared materials
const shared = {
  glass: new THREE.MeshPhysicalMaterial({ name: 'vehicleGlass', color: '#1d2a2e', roughness: .04, metalness: 0, transparent: true, opacity: .5, depthWrite: false, envMapIntensity: 1.8, side: THREE.DoubleSide }),
  trim: new THREE.MeshStandardMaterial({ name: 'vehicleTrim', color: '#141617', roughness: .62, metalness: .05 }),
  chrome: new THREE.MeshStandardMaterial({ name: 'vehicleChrome', color: '#d9dcdd', roughness: .12, metalness: 1 }),
  rubber: new THREE.MeshStandardMaterial({ name: 'tyre', color: '#1a1b1c', roughness: .92, side: THREE.DoubleSide }),
  tread: new THREE.MeshStandardMaterial({ name: 'tyreWall', color: '#232526', roughness: .85, side: THREE.DoubleSide }),
  alloy: new THREE.MeshStandardMaterial({ name: 'alloy', color: '#c4c8cb', roughness: .28, metalness: 1 }),
  steelWheel: new THREE.MeshStandardMaterial({ name: 'steelWheel', color: '#3a3d40', roughness: .5, metalness: .7 }),
  liner: new THREE.MeshStandardMaterial({ name: 'archLiner', color: '#0b0c0c', roughness: 1, side: THREE.DoubleSide }),
  cabin: new THREE.MeshStandardMaterial({ name: 'cabin', color: '#2b2e30', roughness: .9 }),
  fabric: new THREE.MeshStandardMaterial({ name: 'seatFabric', color: '#3a3f44', roughness: .95 }),
  head: new THREE.MeshStandardMaterial({ name: 'headlamp', color: '#f4f1e8', emissive: '#fff6df', emissiveIntensity: .35, roughness: .08, metalness: .2 }),
  amber: new THREE.MeshStandardMaterial({ name: 'indicator', color: '#e39a34', emissive: '#a35a00', emissiveIntensity: .2, roughness: .2 }),
  canopy: new THREE.MeshStandardMaterial({ name: 'canopy', color: '#f1eee6', roughness: .55 }),
};
const LIVERIES: Record<string, { paint: string; accent: string; metallic: number }> = {
  'courtyard-car': { paint: '#eceeed', accent: '#1f5a43', metallic: .15 },
  car0: { paint: '#9ea3a8', accent: '#25292c', metallic: .75 }, car1: { paint: '#1f3a5c', accent: '#25292c', metallic: .65 }, car2: { paint: '#7d1f22', accent: '#25292c', metallic: .6 },
  shuttle: { paint: '#f2f1ec', accent: '#1f5a43', metallic: .1 }, cart0: { paint: '#1f5a43', accent: '#e8e2d2', metallic: .2 }, cart1: { paint: '#e9e4d6', accent: '#1f5a43', metallic: .1 },
};
function livery(id: string, type: VehicleType) {
  if (LIVERIES[id]) return LIVERIES[id];
  const h = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return type === 'shuttle' ? LIVERIES.shuttle : LIVERIES[`${type}${h % (type === 'car' ? 3 : 2)}`];
}
const paints = new Map<string, THREE.MeshPhysicalMaterial>();
function paint(color: string, metallic: number) {
  const key = color + metallic; let m = paints.get(key);
  if (!m) paints.set(key, m = new THREE.MeshPhysicalMaterial({ name: 'paint', color, metalness: metallic, roughness: .3 + (1 - metallic) * .08, clearcoat: 1, clearcoatRoughness: .06, envMapIntensity: 1.1 }));
  return m;
}

// ------------------------------------------------------------------ geometry helpers
const geometryCache = new Map<string, THREE.BufferGeometry>();
function clean(g: THREE.BufferGeometry) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (!out.getAttribute('uv')) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  return out;
}
/** Collects parts by material and merges each bucket into one mesh (one draw call per material). */
class Parts {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(material: THREE.Material, geometry: THREE.BufferGeometry, position: [number, number, number] = [0, 0, 0], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale));
    const g = clean(geometry).applyMatrix4(m); geometry.dispose();
    let list = this.buckets.get(material); if (!list) this.buckets.set(material, list = []); list.push(g); return this;
  }
  box(material: THREE.Material, size: [number, number, number], position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], radius = .02) {
    const r = Math.min(radius, size[0] / 2.01, size[1] / 2.01, size[2] / 2.01);
    return this.add(material, r > .004 ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, r) : new THREE.BoxGeometry(...size), position, rotation);
  }
  cylinder(material: THREE.Material, radius: number, length: number, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], segments = 16) {
    return this.add(material, new THREE.CylinderGeometry(radius, radius, length, segments), position, rotation);
  }
  build(group: THREE.Group, shadow = true) {
    for (const [material, list] of this.buckets) {
      const merged = mergeGeometries(list, false); list.forEach(g => g.dispose()); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material); mesh.castShadow = shadow && !(material as THREE.Material).transparent; mesh.receiveShadow = true; group.add(mesh);
    }
    this.buckets.clear();
  }
}

/** A tyre on its axle (x axis) with a rim face; built once per type and shared by every wheel. */
function wheelParts(radius: number, width: number, rimRadius: number, style: 'alloy' | 'steel' | 'cart') {
  const key = `wheel:${radius}:${width}:${style}`, cached = geometryCache.get(key + ':tyre');
  if (cached) return { tyre: cached, wall: geometryCache.get(key + ':wall')!, rim: geometryCache.get(key + ':rim')!, face: geometryCache.get(key + ':face')! };
  const w = width / 2, profile = [[rimRadius - .005, -w + .02], [radius - .045, -w], [radius - .012, -w + .025], [radius, -w + .05], [radius, w - .05], [radius - .012, w - .025], [radius - .045, w], [rimRadius - .005, w - .02]];
  const tread = new THREE.LatheGeometry(profile.slice(2, 6).map(([r, y]) => new THREE.Vector2(r, y)), 32).rotateZ(Math.PI / 2);
  const walls = mergeGeometries([new THREE.LatheGeometry(profile.slice(0, 3).map(([r, y]) => new THREE.Vector2(r, y)), 32), new THREE.LatheGeometry(profile.slice(5).map(([r, y]) => new THREE.Vector2(r, y)), 32)].map(clean))!.rotateZ(Math.PI / 2);
  const rimParts: THREE.BufferGeometry[] = [], faceParts: THREE.BufferGeometry[] = [];
  const at = (g: THREE.BufferGeometry, x: number, rotX = 0) => g.rotateX(rotX).translate(x, 0, 0);
  // Barrel and outer lip, both faces (wheels on the right side are the same parts mirrored).
  rimParts.push(clean(new THREE.CylinderGeometry(rimRadius, rimRadius, width - .04, 24, 1, true).rotateZ(Math.PI / 2)));
  for (const s of [-1, 1]) {
    rimParts.push(clean(at(new THREE.TorusGeometry(rimRadius - .008, .012, 6, 28).rotateY(Math.PI / 2), s * (w - .03))));
    faceParts.push(clean(at(new THREE.CircleGeometry(rimRadius - .015, 24).rotateY(s * Math.PI / 2), s * (w - .06))));
    rimParts.push(clean(at(new THREE.CylinderGeometry(rimRadius * .22, rimRadius * .26, .05, 16).rotateZ(Math.PI / 2), s * (w - .045))));
    const spokes = style === 'alloy' ? 5 : style === 'steel' ? 0 : 4;
    for (let i = 0; i < spokes; i++) {
      const a = i / spokes * Math.PI * 2, spoke = new THREE.BoxGeometry(.03, rimRadius * .78, rimRadius * .2).translate(0, rimRadius * .5, 0).rotateX(a);
      rimParts.push(clean(at(spoke, s * (w - .05))));
    }
    if (style === 'steel') for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; rimParts.push(clean(at(new THREE.CylinderGeometry(.018, .018, .02, 8).rotateZ(Math.PI / 2).translate(0, Math.cos(a) * rimRadius * .62, Math.sin(a) * rimRadius * .62), s * (w - .05)))); }
  }
  const rim = mergeGeometries(rimParts)!, face = mergeGeometries(faceParts)!;
  const tyre = clean(tread), wall = clean(walls);
  for (const g of [tyre, wall, rim, face]) g.name = 'shared-wheel';
  geometryCache.set(key + ':tyre', tyre); geometryCache.set(key + ':wall', wall); geometryCache.set(key + ':rim', rim); geometryCache.set(key + ':face', face);
  return { tyre, wall, rim, face };
}

// ------------------------------------------------------------------ body profiles
function carProfile(): Profile {
  const L = VEHICLE_TYPES.car.length, h = L / 2, wb = VEHICLE_TYPES.car.wheelbase / 2, r = VEHICLE_TYPES.car.wheelRadius;
  const top = curve([[-h, .74], [-h + .05, .92], [-h + .16, 1.0], [-1.86, 1.06], [-1.66, 1.33], [-1.42, 1.45], [-1.0, 1.49], [-.2, 1.5], [.08, 1.46], [.5, 1.2], [.92, .98], [1.2, .95], [1.7, .89], [1.98, .8], [h - .05, .68], [h, .54]]);
  const belt = curve([[-h, .7], [-1.9, .98], [-1.2, .97], [0, .94], [.9, .92]]);
  const y0 = curve([[-h, .36], [-h + .15, .25], [-1.6, .2], [1.6, .2], [h - .15, .24], [h, .3]]);
  const side = curve([[-h, .74], [-h + .06, .84], [-h + .2, .88], [0, .89], [h - .25, .88], [h - .07, .83], [h, .72]]);
  const roof = curve([[-1.9, .78], [-1.4, .68], [0, .66], [.4, .7], [.95, .8]]);
  const stations: number[] = [];
  for (let z = -h; z <= h + 1e-6; z += .045) stations.push(+z.toFixed(4));
  for (const s of [-1.27, -.38, .86]) stations.push(s - .008, s + .008);
  for (const e of [-h + .02, -h + .035, h - .02, h - .035]) stations.push(e);
  return {
    length: L, stations,
    section: z => { const t = top(z), b = Math.min(belt(z), t - .04), cabin = between(z, -1.9, .95); return { y0: y0(z), belt: b, top: t, side: side(z), roof: cabin ? Math.min(roof(z), side(z) - .05) : side(z) - .04, bottom: side(z) - .07, crown: cabin ? .025 : .015 }; },
    slot: (z, kind, s, y) => {
      if (kind === 'under') return 'trim';
      if (kind === 'side' || kind === 'belt') {
        if (y < .34 && !between(z, -1.85, 1.85)) return 'trim'; // bumper lower valance
        if (between(z, -1.88, 1.7) && y < .3) return 'trim'; // sill / side skirt
        for (const seam of [-1.27, -.38, .86]) if (Math.abs(z - seam) < .009 && y > .3) return 'trim';
        return kind === 'belt' && between(z, -1.9, .95) ? 'chrome' : 'paint';
      }
      if (kind === 'window') {
        if (!between(z, -1.9, .95)) return 'paint';
        if (y < (between(z, -1.85, .9) ? 1.01 : 0)) return 'trim';
        if (between(z, -.43, -.31)) return 'trim'; // B pillar
        if (between(z, -1.38, .8)) return 'glass';
        return 'paint';
      }
      if (between(z, .1, .93) || between(z, -1.84, -1.4)) return 'glass';
      return 'paint';
    },
    arches: [-wb, wb].map(z => ({ z, y: r, r: r + .055 })),
  };
}

function shuttleProfile(): Profile {
  const t = VEHICLE_TYPES.shuttle, h = t.length / 2, wb = t.wheelbase / 2, r = t.wheelRadius, W = t.width / 2;
  const top = curve([[-h, 2.2], [-h + .04, 2.45], [-h + .16, 2.58], [-2.6, 2.62], [2.7, 2.62], [2.95, 2.56], [3.12, 2.2], [h - .06, 1.42], [h, 1.18]]);
  const y0 = curve([[-h, .5], [-h + .2, .38], [h - .3, .38], [h, .45]]);
  const side = curve([[-h, W - .1], [-h + .12, W - .02], [-h + .4, W], [h - .3, W], [h - .06, W - .04], [h, W - .1]]);
  const stations: number[] = [];
  for (let z = -h; z <= h + 1e-6; z += .06) stations.push(+z.toFixed(4));
  for (const e of [-h + .02, h - .02, h - .035]) stations.push(e);
  const posts = [-2.95, -1.75, -.6, .55, 1.7];
  for (const p of posts) stations.push(p - .045, p + .045);
  const door = (z: number, s: number) => s < 0 && between(z, 2.15, 2.95);
  return {
    length: t.length, stations,
    section: z => ({ y0: y0(z), belt: Math.min(1.42, top(z) - .05), top: top(z), side: side(z), roof: side(z) - .07, bottom: side(z) - .08, crown: .04 }),
    slot: (z, kind, s, y) => {
      if (kind === 'under') return 'trim';
      if (door(z, s) && y > .6 && kind !== 'top') return Math.abs(z - 2.55) < .03 ? 'trim' : 'glass';
      if (kind === 'side' || kind === 'belt') {
        if (y < .62) return z > h - .25 || z < -h + .25 ? 'trim' : 'paint';
        if (between(y, .92, 1.17)) return 'accent'; // livery band
        return 'paint';
      }
      if (kind === 'window') {
        if (z > 3.0) return 'glass'; // wraps into the windscreen
        if (z < -3.18) return 'paint';
        if (y < 1.47 || y > 2.42) return 'trim';
        if (posts.some(p => Math.abs(z - p) < .045)) return 'paint';
        return between(z, -3.15, 2.95) ? 'glass' : 'paint';
      }
      if (z > 2.98) return 'glass';
      if (z < -3.2 && y < 2.4) return 'glass';
      return 'paint';
    },
    arches: [-wb, wb].map(z => ({ z, y: r, r: r + .07 })),
  };
}

// ------------------------------------------------------------------ assembly
export interface VehicleModel { root: THREE.Group; body: THREE.Group; wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean }[]; tail: THREE.MeshStandardMaterial; reverse: THREE.MeshStandardMaterial; radius: number }

function addWheels(model: VehicleModel, type: VehicleType, track: number, style: 'alloy' | 'steel' | 'cart', width: number, rimRadius: number) {
  const t = VEHICLE_TYPES[type], parts = wheelParts(t.wheelRadius, width, rimRadius, style);
  const rim = style === 'alloy' ? shared.alloy : style === 'cart' ? shared.chrome : shared.steelWheel;
  for (const z of [-t.wheelbase / 2, t.wheelbase / 2]) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.position.set(s * track, t.wheelRadius, z); pivot.add(spin);
    for (const [g, m] of [[parts.tyre, shared.rubber], [parts.wall, shared.tread], [parts.rim, rim], [parts.face, shared.trim]] as const) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; spin.add(mesh); }
    model.root.add(pivot); model.wheels.push({ pivot, spin, front: z > 0 });
  }
}
function lights() {
  return {
    tail: new THREE.MeshStandardMaterial({ name: 'taillamp', color: '#7a0f12', emissive: '#ff1a12', emissiveIntensity: .25, roughness: .15 }),
    reverse: new THREE.MeshStandardMaterial({ name: 'reverseLamp', color: '#dcdcdc', emissive: '#ffffff', emissiveIntensity: 0, roughness: .15 }),
  };
}
function plate(text: string, w = .52, h = .12) { return sign({ text, kind: 'panel', width: w, height: h, background: '#f3f4ef', color: '#1b6a3c' }); }
function liner(parts: Parts, z: number, r: number, x0: number, x1: number) {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(x1 - x0), 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2);
  parts.add(shared.liner, g, [(x0 + x1) / 2, 0, z]);
}

function buildCar(id: string): VehicleModel {
  const t = VEHICLE_TYPES.car, L = t.length, h = L / 2, look = livery(id, 'car'), { tail, reverse } = lights();
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const model: VehicleModel = { root, body, wheels: [], tail, reverse, radius: t.wheelRadius };
  const shell = new THREE.Mesh(loft(carProfile()), [paint(look.paint, look.metallic), shared.trim, shared.glass, shared.trim, shared.chrome]);
  shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const p = new Parts(), wb = t.wheelbase / 2, W = .89;
  for (const z of [-wb, wb]) for (const s of [-1, 1]) liner(p, z, t.wheelRadius + .06, s * (W - .02), s * (W - .42));
  // Lamps, grille and bumpers.
  for (const s of [-1, 1]) {
    p.box(shared.head, [.34, .1, .08], [s * .6, .74, h - .07], [-.25, s * .32, 0], .03);
    p.box(shared.trim, [.36, .12, .06], [s * .6, .74, h - .09], [-.25, s * .32, 0], .03);
    p.box(shared.amber, [.06, .05, .06], [s * .78, .72, h - .13], [0, s * .6, 0], .02);
    p.box(tail, [.32, .11, .07], [s * .62, .96, -h + .1], [.15, -s * .35, 0], .03);
    p.box(reverse, [.1, .05, .05], [s * .3, .52, -h + .03], [0, 0, 0], .015);
    p.box(shared.trim, [.05, .12, .2], [s * (W + .07), 1.02, .72], [0, 0, 0], .02); // mirror arm + housing
    p.box(paint(look.paint, look.metallic), [.07, .13, .2], [s * (W + .1), 1.05, .7], [0, 0, 0], .03);
    p.box(shared.chrome, [.14, .025, .02], [s * (W + .005), .86, .22], [0, 0, 0], .008); // door handles
    p.box(shared.chrome, [.14, .025, .02], [s * (W + .002), .88, -.75], [0, 0, 0], .008);
  }
  p.box(shared.trim, [.82, .16, .05], [0, .62, h - .03], [0, 0, 0], .03); // grille
  p.box(shared.chrome, [.84, .02, .055], [0, .7, h - .025]);
  p.box(shared.trim, [1.2, .1, .05], [0, .38, h - .02], [0, 0, 0], .03); // lower intake
  p.box(shared.trim, [.9, .08, .04], [0, 1.0, -h + .1], [.6, 0, 0], .02); // spoiler lip
  for (const s of [-1, 1]) p.box(shared.trim, [.55, .015, .02], [s * .28, .99, .9], [0, s * .12, 0], .006); // wipers
  // Cabin: dashboard, steering wheel on the left (LHD), seats and rear bench.
  p.box(shared.cabin, [1.5, .22, .45], [0, .86, .62], [-.25, 0, 0], .05);
  p.add(shared.trim, new THREE.TorusGeometry(.18, .022, 8, 28), [t.seats[0][0], .98, .38], [-1.15, 0, 0]);
  p.cylinder(shared.trim, .025, .3, [t.seats[0][0], .92, .48], [1.0, 0, 0], 8);
  for (const [x, z] of t.seats.slice(0, 2)) { p.box(shared.fabric, [.48, .12, .5], [x, t.seatHeight - .06, z + .03], [0, 0, 0], .05); p.box(shared.fabric, [.48, .62, .12], [x, t.seatHeight + .3, z - .27], [-.18, 0, 0], .05); p.box(shared.fabric, [.26, .16, .1], [x, t.seatHeight + .7, z - .33], [-.1, 0, 0], .04); }
  p.box(shared.fabric, [1.3, .12, .5], [0, t.seatHeight - .06, t.seats[2][1] + .04], [0, 0, 0], .05); p.box(shared.fabric, [1.3, .58, .12], [0, t.seatHeight + .28, t.seats[2][1] - .27], [-.2, 0, 0], .05);
  p.box(shared.cabin, [1.55, .05, 3.0], [0, .3, -.35], [0, 0, 0], .02); // floor pan
  p.build(body);
  const front = plate('OR 214 CMP'); front.position.set(0, .43, h + .006); body.add(front);
  const rear = plate('OR 214 CMP'); rear.rotation.y = Math.PI; rear.position.set(0, .62, -h - .006); body.add(rear);
  addWheels(model, 'car', W - .085, 'alloy', .2, .2);
  return model;
}

function buildShuttle(id: string): VehicleModel {
  const t = VEHICLE_TYPES.shuttle, h = t.length / 2, look = livery(id, 'shuttle'), { tail, reverse } = lights(), W = t.width / 2;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const model: VehicleModel = { root, body, wheels: [], tail, reverse, radius: t.wheelRadius };
  const shell = new THREE.Mesh(loft(shuttleProfile()), [paint(look.paint, look.metallic), paint(look.accent, .3), shared.glass, shared.trim, shared.chrome]);
  shell.castShadow = true; shell.receiveShadow = true; body.add(shell);
  const p = new Parts(), wb = t.wheelbase / 2;
  for (const z of [-wb, wb]) for (const s of [-1, 1]) liner(p, z, t.wheelRadius + .08, s * (W - .02), s * (W - .45));
  for (const s of [-1, 1]) {
    p.box(shared.head, [.3, .16, .06], [s * .72, .86, h - .01], [0, 0, 0], .04); p.box(shared.trim, [.36, .22, .04], [s * .72, .86, h - .025], [0, 0, 0], .04);
    p.box(shared.amber, [.1, .08, .05], [s * .95, .86, h - .03], [0, 0, 0], .02);
    p.box(tail, [.14, .34, .06], [s * .92, 1.05, -h + .01], [0, 0, 0], .03); p.box(reverse, [.12, .08, .05], [s * .92, .8, -h + .01], [0, 0, 0], .02);
    p.box(shared.trim, [.05, .05, .5], [s * (W + .05), 2.0, h - .3], [0, s * -.2, 0], .02); // mirror arms reach forward
    p.box(shared.trim, [.08, .38, .16], [s * (W + .12), 1.78, h + .02], [0, 0, 0], .03);
  }
  p.box(shared.trim, [1.0, .3, .05], [0, .78, h - .015], [0, 0, 0], .04); // grille
  p.box(shared.trim, [2.05, .22, .1], [0, .5, h + .01], [0, 0, 0], .05); p.box(shared.trim, [2.05, .22, .1], [0, .5, -h - .01], [0, 0, 0], .05); // bumpers
  p.box(shared.trim, [1.1, .02, .02], [0, 1.48, h + .005], [0, 0, 0], .008);
  p.box(paint(look.paint, look.metallic), [1.0, .26, 1.4], [0, 2.75, -.6], [0, 0, 0], .08); // roof air-conditioning pod
  p.box(shared.trim, [.9, .2, .5], [0, 2.69, 2.3], [0, 0, 0], .05); // destination box
  for (const s of [-1, 1]) p.box(shared.chrome, [.04, .04, 5.2], [s * (W - .25), 2.66, -.3], [0, 0, 0], .015); // roof rails
  // Cabin: floor, driver's dash and wheel (left), and paired passenger seats behind.
  p.box(shared.cabin, [2.0, .06, 6.0], [0, .62, 0], [0, 0, 0], .02);
  p.box(shared.cabin, [2.0, .55, .4], [0, 1.2, 2.95], [0, 0, 0], .05);
  p.add(shared.trim, new THREE.TorusGeometry(.22, .025, 8, 28), [t.seats[0][0], 1.55, 2.68], [-1.0, 0, 0]);
  for (const z of [2.3, 1.2, .1, -1, -2.1]) for (const s of [-1, 1]) {
    if (z === 2.3 && s < 0) continue;
    p.box(shared.fabric, [.46, .12, .46], [s * .55, t.seatHeight - .06, z + .03], [0, 0, 0], .05); p.box(shared.fabric, [.46, .66, .1], [s * .55, t.seatHeight + .32, z - .24], [-.12, 0, 0], .05);
  }
  p.build(body);
  for (const s of [-1, 1]) {
    const label = sign({ text: 'ÒRÌṢUN UNIVERSITY · CAMPUS SHUTTLE', kind: 'panel', width: 3.4, height: .2, background: look.accent, color: '#f6efd9' });
    label.position.set(s * (W + .004), 1.045, -.4); label.rotation.y = s * Math.PI / 2; body.add(label);
  }
  const dest = sign({ text: 'CAMPUS LOOP', kind: 'panel', width: .82, height: .15, background: '#101213', color: '#ffb547' }); dest.position.set(0, 2.69, 2.556); body.add(dest);
  const front = plate('OR 102 SHT'); front.position.set(0, .66, h + .07); body.add(front);
  const rear = plate('OR 102 SHT'); rear.rotation.y = Math.PI; rear.position.set(0, .72, -h - .02); body.add(rear);
  addWheels(model, 'shuttle', W - .17, 'steel', .25, .25);
  return model;
}

function buildCart(id: string): VehicleModel {
  const t = VEHICLE_TYPES.cart, h = t.length / 2, look = livery(id, 'cart'), { tail, reverse } = lights(), W = t.width / 2;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const model: VehicleModel = { root, body, wheels: [], tail, reverse, radius: t.wheelRadius };
  const p = new Parts(), coat = paint(look.paint, look.metallic), seatZ = t.seats[0][1];
  p.box(shared.trim, [W * 2 - .2, .1, t.length - .25], [0, .3, 0], [0, 0, 0], .03); // chassis
  p.box(shared.cabin, [W * 2 - .12, .04, 1.5], [0, .37, .25], [0, 0, 0], .015); // floor mat
  // Front cowl and nose, rear body under the seat, fenders.
  p.box(coat, [W * 2 - .06, .42, .55], [0, .58, h - .32], [-.15, 0, 0], .12);
  p.box(coat, [W * 2 - .2, .22, .3], [0, .4, h - .1], [0, 0, 0], .08);
  p.box(coat, [W * 2 - .04, .3, .85], [0, .44, seatZ - .2], [0, 0, 0], .08);
  for (const s of [-1, 1]) for (const z of [-t.wheelbase / 2, t.wheelbase / 2]) p.add(coat, new THREE.CylinderGeometry(t.wheelRadius + .06, t.wheelRadius + .06, .2, 16, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), [s * (W - .02), t.wheelRadius, z]);
  p.box(shared.trim, [W * 2 + .04, .08, .1], [0, .34, h + .02], [0, 0, 0], .04); p.box(shared.trim, [W * 2 + .04, .08, .1], [0, .34, -h - .02], [0, 0, 0], .04);
  // Bench seat and backrest, canopy on four posts, windscreen, cargo basket.
  p.box(shared.fabric, [W * 2 - .12, .12, .5], [0, t.seatHeight - .06, seatZ + .02], [0, 0, 0], .05);
  p.box(shared.fabric, [W * 2 - .12, .45, .1], [0, t.seatHeight + .3, seatZ - .27], [-.15, 0, 0], .05);
  for (const s of [-1, 1]) for (const z of [h - .55, seatZ - .38]) p.cylinder(shared.chrome, .022, t.height - .45, [s * (W - .08), .45 + (t.height - .45) / 2, z], [0, 0, 0], 8);
  p.box(shared.canopy, [W * 2 + .08, .06, t.length - .55], [0, t.height - .02, -.12], [0, 0, 0], .03);
  p.add(shared.glass, new THREE.PlaneGeometry(W * 2 - .2, .62), [0, 1.18, h - .53], [-.12, 0, 0]);
  p.box(shared.trim, [W * 2 - .15, .03, .03], [0, .86, h - .5], [0, 0, 0], .01);
  p.box(shared.steelWheel, [W * 2 - .2, .32, .55], [0, .62, -h + .3], [0, 0, 0], .02);
  p.box(shared.cabin, [W * 2 - .24, .02, .5], [0, .78, -h + .3], [0, 0, 0], .005);
  // Steering on the left, dash and lamps.
  p.cylinder(shared.trim, .02, .55, [t.seats[0][0], .85, seatZ + .48], [.75, 0, 0], 8);
  p.add(shared.trim, new THREE.TorusGeometry(.17, .02, 8, 24), [t.seats[0][0], 1.04, seatZ + .38], [-.85, 0, 0]);
  for (const s of [-1, 1]) { p.box(shared.head, [.16, .08, .05], [s * .38, .66, h - .06], [-.15, 0, 0], .03); p.box(tail, [.1, .08, .04], [s * .45, .5, -h + .01], [0, 0, 0], .02); p.box(reverse, [.06, .04, .03], [s * .3, .48, -h + .01], [0, 0, 0], .01); }
  p.build(body);
  addWheels(model, 'cart', W - .11, 'cart', .19, .14);
  return model;
}

export function buildVehicleModel(id: string, type: VehicleType): VehicleModel {
  const model = type === 'shuttle' ? buildShuttle(id) : type === 'cart' ? buildCart(id) : buildCar(id);
  model.root.name = `vehicle-model:${type}`;
  return model;
}
