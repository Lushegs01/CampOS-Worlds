// Combat Arena environment art. The map's boxes stay the collision world (shared/arena/maps.mjs);
// this module decides how each one LOOKS: brick walls with plinths and coping, precast perimeter panels
// with razor wire, ribbed shipping containers with frames and door gear, photoscanned crates and
// jersey barriers fitted to their volumes, stacked hessian sandbags, tubular railings, steel stairs,
// trussed roofs and window frames. Geometry with the same material is merged (a handful of draw calls),
// repeated props are instanced, and every surface uses a PBR set with world-space texture mapping.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { surface, type Library, type SurfaceKey, type PropKey } from './library';
import type { ArenaQuality } from './world';

type Box = { min: number[]; max: number[]; mat: string; thin?: boolean; kind?: string; alongZ?: boolean };
type Map3 = { id: string; boxes: Box[]; deco?: Box[]; bounds: number[]; objectives: { x: number; z: number; r: number }[]; palette: Record<string, unknown> };

/** Deterministic noise so the same map always looks the same. */
export const hash = (a: number, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/** World-space UVs (triplanar by face normal), so textures keep their real-world scale on any shape. */
export function worldUV(g: THREE.BufferGeometry, scale: number, rotate = false) {
  const p = g.attributes.position, n = g.attributes.normal; if (!n) g.computeVertexNormals();
  const nn = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i)), az = Math.abs(nn.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    if (rotate) [u, v] = [v, u];
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export class Builder {
  // material → chunk → geometries. A chunk is a region of the map drawn (and culled) as one mesh.
  private groups = new Map<THREE.Material, Map<number, THREE.BufferGeometry[]>>();
  private centre = new THREE.Vector3();
  /** `chunkOf` splits each material's geometry into regions (by the centre of every piece added). */
  constructor(private lib: Library, private chunkOf?: (centre: THREE.Vector3) => number) {}
  /** `keepUV`: the geometry's own texture coordinates are kept (signs, decals) instead of world-space mapping. */
  add(geo: THREE.BufferGeometry, material: THREE.Material, scale: number, matrix?: THREE.Matrix4, rotateUV = false, keepUV = false, chunk?: number) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUV && k === 'uv') && k !== 'aWin') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!keepUV || !g.attributes.uv) worldUV(g, scale, rotateUV);
    g.clearGroups(); g.morphAttributes = {};
    let id = chunk ?? 0;
    if (chunk === undefined && this.chunkOf) { g.computeBoundingBox(); id = this.chunkOf(g.boundingBox!.getCenter(this.centre)); }
    let byChunk = this.groups.get(material); if (!byChunk) this.groups.set(material, byChunk = new Map());
    const list = byChunk.get(id) ?? []; list.push(g); byChunk.set(id, list);
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: THREE.Material, scale = 2) {
    const g = new THREE.BoxGeometry(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0));
    this.add(g, material, scale, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)); g.dispose();
  }
  cyl(a: THREE.Vector3, b: THREE.Vector3, r: number, material: THREE.Material, seg = 8, scale = 1) {
    const len = a.distanceTo(b), g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1));
    this.add(g, material, scale, m); g.dispose();
  }
  /** One mesh per material and chunk (`userData.chunk`). */
  meshes(shadows: boolean) {
    const out: THREE.Mesh[] = [];
    for (const [material, byChunk] of this.groups) for (const [chunk, list] of byChunk) {
      const merged = mergeGeometries(list, false); list.forEach(g => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material); mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.userData.chunk = chunk;
      out.push(mesh);
    }
    this.groups.clear();
    return out;
  }
  get library() { return this.lib; }
}

/** Instanced photoscanned props, each copy fitted (position, heading, scale) to a slot. */
export class Props {
  private slots = new Map<PropKey, THREE.Matrix4[]>();
  place(key: PropKey, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) {
    const list = this.slots.get(key) ?? []; this.slots.set(key, list);
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz)));
  }
  /** Fill an axis-aligned volume with one prop scaled to it (long side along the volume's long side). */
  fit(lib: Library, key: PropKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const s = lib.props[key]!.size, w = x1 - x0, d = z1 - z0, h = y1 - y0, alongX = w >= d;
    const L = alongX ? w : d, D = alongX ? d : w;
    const long = s.x >= s.z ? s.x : s.z, short = s.x >= s.z ? s.z : s.x, propAlongX = s.x >= s.z;
    const yaw = alongX === propAlongX ? 0 : Math.PI / 2;
    const sxLocal = (propAlongX ? L / long : D / short), szLocal = (propAlongX ? D / short : L / long);
    this.place(key, (x0 + x1) / 2, y0, (z0 + z1) / 2, yaw, sxLocal, h / s.y, szLocal);
  }
  /** Instanced meshes for the placed props whose models are in the library (all, or those `only` accepts). */
  meshes(lib: Library, shadows: boolean, only?: (key: PropKey) => boolean) {
    const out: THREE.Object3D[] = [];
    for (const [key, list] of this.slots) {
      const src = lib.props[key]; if (!src || (only && !only(key))) continue;
      const root = src.scene; root.updateMatrixWorld(true);
      root.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        const inst = new THREE.InstancedMesh(m.geometry, m.material, list.length);
        list.forEach((M, i) => inst.setMatrixAt(i, M.clone().multiply(m.matrixWorld)));
        inst.castShadow = shadows; inst.receiveShadow = true; inst.computeBoundingSphere(); inst.name = 'prop:' + key;
        out.push(inst);
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------- materials by role
const CONTAINER_TINT: Record<string, string> = { 'container-red': '#a8483a', 'container-blue': '#44709a', 'container-yellow': '#c9a03a', 'container-stack': '#5f6d4b', 'container-green': '#4f7d5c' };
export function materials(lib: Library) {
  // Worn concrete tinted as paint stands in for painted steel (smooth, stained, chipped); the rusted red
  // panel set is a real container side, so red containers use it as it is.
  const painted = (tint: string, gain = 1, rough = .62) => surface(lib, 'concreteFloor', { tint, gain, rough, normalScale: .5 });
  return {
    brick: surface(lib, 'brick', { tint: '#ffffff', gain: 1.7 }), concrete: surface(lib, 'concreteWall'), precast: surface(lib, 'concreteWall', { tint: '#e6e0d4', gain: 1.15 }),
    floor: surface(lib, 'concreteFloor'), plaster: surface(lib, 'plaster', { tint: '#d6cdbd' }),
    roof: surface(lib, 'rustyCorrugated', { tint: '#c9c3b8' }), steel: painted('#8e949b', 1.1), darkSteel: painted('#565b61'), yellow: painted('#e3ab22', 1.5), plate: surface(lib, 'metalPlate', { metal: .5, gain: 1.3 }),
    sandbag: surface(lib, 'sandbag', { tint: '#d6c49a', gain: 1.2, normalScale: 1.4 }), planks: surface(lib, 'planks'), stone: surface(lib, 'concreteWall', { tint: '#ecd9b2', gain: 1.25 }),
    hedge: surface(lib, 'dirt', { tint: '#4a6a34', rough: 1 }), bronze: painted('#9a7642', 1.2, .4),
    machine: painted('#5e858c', 1.2), wire: new THREE.MeshStandardMaterial({ color: '#8a8d91', metalness: .8, roughness: .4 }),
    glow: new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff4dc', emissiveIntensity: 3, roughness: .4 }),
    container: (key: string) => key === 'container-red' ? surface(lib, 'paintedMetal', { gain: 1.25 }) : surface(lib, 'corrugated', { tint: CONTAINER_TINT[key] ?? '#8a7a62', gain: 1.5 }),
    containerFrame: (key: string) => painted(new THREE.Color(CONTAINER_TINT[key] ?? '#8a7a62').multiplyScalar(.8).getStyle(), 1.3),
  };
}
export type Mats = ReturnType<typeof materials>;

// ---------------------------------------------------------------- element builders
/** A shipping container fitted to a box: corrugated walls (real geometry), frame, castings and door gear. */
export function container(b: Builder, m: Pick<Mats, 'container' | 'containerFrame' | 'darkSteel'>, box: Box) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, alongX = x1 - x0 >= z1 - z0;
  const skin = m.container(box.mat), frame = m.containerFrame(box.mat);
  const L = alongX ? x1 - x0 : z1 - z0, W = alongX ? z1 - z0 : x1 - x0, H = y1 - y0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const toWorld = new THREE.Matrix4().compose(new THREE.Vector3(cx, y0, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? 0 : Math.PI / 2), new THREE.Vector3(1, 1, 1));
  const P = (g: THREE.BufferGeometry, mat: THREE.Material, mx: THREE.Matrix4, s = 1.4) => b.add(g, mat, s, toWorld.clone().multiply(mx));
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  // Corrugated side walls: a trapezoid wave profile extruded vertically.
  const rib = .28, n = Math.max(4, Math.round((L - .3) / rib)), shape = new THREE.Shape();
  shape.moveTo(-L / 2 + .15, 0);
  for (let i = 0; i < n; i++) { const a = -L / 2 + .15 + i * (L - .3) / n, s = (L - .3) / n; shape.lineTo(a + s * .2, .045); shape.lineTo(a + s * .55, .045); shape.lineTo(a + s * .75, 0); shape.lineTo(a + s, 0); }
  shape.lineTo(L / 2 - .15, -.02); shape.lineTo(-L / 2 + .15, -.02);
  const wall = new THREE.ExtrudeGeometry(shape, { depth: H - .25, bevelEnabled: false }); wall.rotateX(-Math.PI / 2);
  P(wall, skin, T(0, .12, W / 2 - .045)); P(wall, skin, new THREE.Matrix4().makeRotationY(Math.PI).premultiply(T(0, .12, -W / 2 + .045)));
  wall.dispose();
  // Roof and floor plates, end walls with doors.
  P(new THREE.BoxGeometry(L - .2, .06, W - .1), skin, T(0, H - .09, 0));
  const endWall = new THREE.BoxGeometry(.06, H - .25, W - .2);
  P(endWall, skin, T(-L / 2 + .07, H / 2, 0));
  P(endWall, frame, T(L / 2 - .07, H / 2, 0));
  for (const s of [-1, 1]) for (const k of [-.3, .3]) P(new THREE.CylinderGeometry(.018, .018, H - .4, 6), m.darkSteel, T(L / 2 - .01, H / 2, s * (W / 4) + k * W / 6));
  P(new THREE.BoxGeometry(.02, H - .3, .015), m.darkSteel, T(L / 2 - .02, H / 2, 0));
  // Frame: rails, posts and corner castings.
  for (const y of [.06, H - .06]) for (const z of [-W / 2 + .07, W / 2 - .07]) P(new THREE.BoxGeometry(L, .12, .14), frame, T(0, y, z));
  for (const x of [-L / 2 + .07, L / 2 - .07]) { for (const z of [-W / 2 + .07, W / 2 - .07]) P(new THREE.BoxGeometry(.14, H, .14), frame, T(x, H / 2, z)); P(new THREE.BoxGeometry(.12, .12, W), frame, T(x, H - .06, 0)); P(new THREE.BoxGeometry(.12, .12, W), frame, T(x, .06, 0)); }
  for (const x of [-L / 2 + .09, L / 2 - .09]) for (const y of [.09, H - .09]) for (const z of [-W / 2 + .09, W / 2 - .09]) P(new THREE.BoxGeometry(.18, .18, .18), m.darkSteel, T(x, y, z));
}

/** Stacked hessian sandbags filling a box, brick-bonded, each bag slightly different. */
function sandbags(geo: THREE.BufferGeometry, box: Box, list: THREE.Matrix4[]) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, alongX = x1 - x0 >= z1 - z0;
  const L = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0, H = y1 - y0;
  const bagL = .56, bagD = .34, bagH = .16, rows = Math.max(1, Math.round(D / bagD)), layers = Math.max(1, Math.round(H / bagH)), per = Math.max(1, Math.round(L / bagL));
  let seed = x0 * 13 + z0 * 7;
  for (let l = 0; l < layers; l++) for (let r = 0; r < rows; r++) for (let i = 0; i < per + (l % 2 ? -1 : 0); i++) {
    const t = -L / 2 + (i + .5 + (l % 2) * .5) * (L / per), d = -D / 2 + (r + .5) * (D / rows), y = y0 + (l + .5) * (H / layers);
    const j = hash(seed += 1.37);
    const m = new THREE.Matrix4().compose(
      alongX ? new THREE.Vector3((x0 + x1) / 2 + t, y, (z0 + z1) / 2 + d) : new THREE.Vector3((x0 + x1) / 2 + d, y, (z0 + z1) / 2 + t),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((j - .5) * .06, (alongX ? 0 : Math.PI / 2) + (j - .5) * .12, (hash(seed) - .5) * .05)),
      new THREE.Vector3((L / per) / bagL * (.96 + j * .06), (H / layers) / bagH, (D / rows) / bagD * .98));
    list.push(m);
  }
  void geo;
}
/** A soft, pillowy bag: a rounded box with its faces puffed outward. */
export function bagGeometry(detail: number) {
  const g: THREE.BufferGeometry = detail ? new RoundedBoxGeometry(.56, .16, .34, 1, .06) : new THREE.BoxGeometry(.56, .16, .34, 2, 1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 - Math.min(1, (x * x) / .08); p.setY(i, y * (1 + .18 * k)); p.setZ(i, z * (1 + .05 * k)); }
  g.computeVertexNormals(); worldUV(g, .6); return g;
}

/** A tubular safety railing along a thin rail box. */
function railing(b: Builder, m: Mats, box: Box) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, alongX = x1 - x0 >= z1 - z0, L = alongX ? x1 - x0 : z1 - z0;
  const c = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2, at = (t: number, y: number) => alongX ? new THREE.Vector3(x0 + t, y, c) : new THREE.Vector3(c, y, z0 + t);
  const posts = Math.max(1, Math.ceil(L / 1.2));
  for (let i = 0; i <= posts; i++) b.cyl(at(i * L / posts, y0), at(i * L / posts, y1), .024, m.yellow, 8);
  b.cyl(at(0, y1 - .02), at(L, y1 - .02), .028, m.yellow, 10); b.cyl(at(0, y0 + (y1 - y0) * .5), at(L, y0 + (y1 - y0) * .5), .02, m.yellow, 8);
  b.box(alongX ? x0 : c - .05, y0, alongX ? c - .05 : z0, alongX ? x1 : c + .05, y0 + .1, alongX ? c + .05 : z1, m.yellow, 1);
}

/** Precast perimeter panels with joints, a cap, and razor wire coiled along the top. */
function perimeter(b: Builder, m: Mats, box: Box, wireQuality: number) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, alongX = x1 - x0 >= z1 - z0, L = alongX ? x1 - x0 : z1 - z0, panels = Math.max(1, Math.round(L / 4));
  for (let i = 0; i < panels; i++) {
    const a = (alongX ? x0 : z0) + i * L / panels + .015, e = (alongX ? x0 : z0) + (i + 1) * L / panels - .015;
    if (alongX) b.box(a, y0, z0, e, y1 - .25, z1, m.precast, 3); else b.box(x0, y0, a, x1, y1 - .25, e, m.precast, 3);
  }
  b.box(x0 - .04, y1 - .25, z0 - .04, x1 + .04, y1, z1 + .04, m.concrete, 2);
  if (!wireQuality) return;
  const c = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2, pts: THREE.Vector3[] = [], turns = Math.round(L / .35);
  for (let i = 0; i <= turns * 6; i++) { const t = i / 6, a = t * Math.PI * 2, along = (t / turns) * L; const r = .28; pts.push(alongX ? new THREE.Vector3(x0 + along, y1 + .32 + Math.sin(a) * r, c + Math.cos(a) * r) : new THREE.Vector3(c + Math.cos(a) * r, y1 + .32 + Math.sin(a) * r, z0 + along)); }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, .012, 3, false);
  b.add(tube, m.wire, 1); tube.dispose();
}

/** Brick or stone walls: the main face plus a concrete plinth and coping where they meet ground and sky. */
function masonry(b: Builder, m: Mats, box: Box, face: THREE.Material) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
  b.box(x0, y0, z0, x1, y1, z1, face, face === m.brick ? 2.4 : 3);
  if (y0 < .05) b.box(x0 - .03, 0, z0 - .03, x1 + .03, Math.min(.55, y1), z1 + .03, m.concrete, 2);
  if (y1 > 6.8 || (y1 > 3 && y1 - y0 > 2.5)) b.box(x0 - .05, y1 - .18, z0 - .05, x1 + .05, y1 + .02, z1 + .05, m.concrete, 2);
}

/** A roof: corrugated sheeting with steel trusses and fluorescent fittings underneath. */
function roof(b: Builder, m: Mats, box: Box, lights: THREE.Vector3[]) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
  b.box(x0, y0, z0, x1, y1, z1, m.roof, 1.2);
  if (x1 - x0 < 6 || z1 - z0 < 6) return;
  const alongX = x1 - x0 >= z1 - z0;
  for (let t = (alongX ? x0 : z0) + 2.5; t < (alongX ? x1 : z1) - 1; t += 3.2) {
    const s0 = alongX ? z0 + .3 : x0 + .3, s1 = alongX ? z1 - .3 : x1 - .3;
    const bx = (a: number, ya: number, c: number, yb: number, w: number) => alongX ? b.box(t - w, ya, a, t + w, yb, c, m.steel, 1) : b.box(a, ya, t - w, c, yb, t + w, m.steel, 1);
    bx(s0, y0 - .42, s1, y0 - .38, .09); bx(s0, y0 - .38, s1, y0 - .04, .012); bx(s0, y0 - .04, s1, y0, .09);
    const mid = (s0 + s1) / 2;
    for (const off of [-3, 3]) { const p = alongX ? new THREE.Vector3(t, y0 - .5, mid + off) : new THREE.Vector3(mid + off, y0 - .5, t); lights.push(p); }
  }
  for (const p of lights) b.box(p.x - .65, p.y - .04, p.z - .08, p.x + .65, p.y, p.z + .08, m.glow, 1);
}

/** Steel stairs: concrete body with a diamond-plate tread and a yellow nosing on every step. */
function step(b: Builder, m: Mats, box: Box) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
  b.box(x0, y0, z0, x1, y1 - .04, z1, m.concrete, 2);
  b.box(x0, y1 - .04, z0, x1, y1, z1, m.plate, .8);
}

/** An industrial press machine within its box. */
function machine(b: Builder, m: Mats, box: Box) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  if (y0 < .1) {
    b.box(x0, y0, z0, x1, y0 + .2, z1, m.darkSteel, 1);
    b.box(x0 + .1, y0 + .2, z0 + .1, x1 - .1, y1 - .15, z1 - .1, m.machine, 1.2);
    b.box(x0 + .05, y1 - .15, z0 + .05, x1 - .05, y1, z1 - .05, m.darkSteel, 1);
    for (const sx of [-1, 1]) b.box(cx + sx * (w / 2 - .02) - .01, y0 + .3, cz - d / 2 + .2, cx + sx * (w / 2 - .02) + .01, y0 + .45, cz + d / 2 - .2, m.yellow, .5);
  } else {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(new THREE.Vector3(cx + sx * w * .3, y0, cz + sz * d * .3), new THREE.Vector3(cx + sx * w * .3, y1, cz + sz * d * .3), .06, m.steel, 10);
    b.box(cx - w / 2 + .05, y1 - .25, cz - d / 2 + .05, cx + w / 2 - .05, y1, cz + d / 2 - .05, m.machine, 1);
    b.cyl(new THREE.Vector3(cx, y0, cz), new THREE.Vector3(cx, y1 - .25, cz), Math.min(w, d) * .22, m.darkSteel, 16);
  }
}

/** A steel H-section column. */
function column(b: Builder, m: Mats, box: Box) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = (x1 - x0) / 2;
  b.box(x0, y0, z0, x1, y0 + .03, z1, m.darkSteel, 1);
  b.box(x0, y0, z0, x1, y1, z0 + .04, m.steel, 1); b.box(x0, y0, z1 - .04, x1, y1, z1, m.steel, 1); b.box(cx - .02, y0, z0, cx + .02, y1, z1, m.steel, 1);
  void cz; void w;
}

/** A T-wall blast barrier section (tall barriers). */
function tWall(b: Builder, m: Mats, box: Box) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, alongX = x1 - x0 >= z1 - z0, L = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0, H = y1 - y0;
  const profile = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(D / 2, .35), new THREE.Vector2(D * .18, .5), new THREE.Vector2(D * .14, H), new THREE.Vector2(-D * .14, H), new THREE.Vector2(-D * .18, .5), new THREE.Vector2(-D / 2, .35)]);
  const n = Math.max(1, Math.round(L / 1.5));
  for (let i = 0; i < n; i++) {
    const g = new THREE.ExtrudeGeometry(profile, { depth: L / n - .03, bevelEnabled: true, bevelSize: .015, bevelThickness: .015, bevelSegments: 1 });
    const t = (alongX ? x0 : z0) + i * L / n + .015, c = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
    const mx = alongX ? new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(t, y0, c)) : new THREE.Matrix4().makeTranslation(c, y0, t);
    b.add(g, m.precast, 2.5, mx); g.dispose();
  }
}

/** Window and door frames on openings. */
function frame(b: Builder, m: Mats, d: Box) {
  const [x0, y0, z0] = d.min, [x1, y1, z1] = d.max, f = .07;
  const along = d.alongZ ? 'z' : 'x';
  if (along === 'x') {
    b.box(x0, y0, z0 - .02, x0 + f, y1, z1 + .02, m.darkSteel, 1); b.box(x1 - f, y0, z0 - .02, x1, y1, z1 + .02, m.darkSteel, 1);
    b.box(x0, y1 - f, z0 - .02, x1, y1, z1 + .02, m.darkSteel, 1);
    if (d.kind === 'window') { b.box(x0 - .05, y0 - .06, z0 - .06, x1 + .05, y0, z1 + .06, m.concrete, 1); b.box((x0 + x1) / 2 - .025, y0, (z0 + z1) / 2 - .02, (x0 + x1) / 2 + .025, y1, (z0 + z1) / 2 + .02, m.darkSteel, 1); }
  } else {
    b.box(x0 - .02, y0, z0, x1 + .02, y1, z0 + f, m.darkSteel, 1); b.box(x0 - .02, y0, z1 - f, x1 + .02, y1, z1, m.darkSteel, 1);
    b.box(x0 - .02, y1 - f, z0, x1 + .02, y1, z1, m.darkSteel, 1);
    if (d.kind === 'window') { b.box(x0 - .06, y0 - .06, z0 - .05, x1 + .06, y0, z1 + .05, m.concrete, 1); b.box((x0 + x1) / 2 - .02, y0, (z0 + z1) / 2 - .025, (x0 + x1) / 2 + .02, y1, (z0 + z1) / 2 + .025, m.darkSteel, 1); }
  }
}

// ---------------------------------------------------------------- ground
/** A splat map painted per map: road lanes, gravel margins, dirt patches and yellow line markings. */
function splatTexture(map: Map3) {
  const [bx0, bz0, bx1, bz1] = map.bounds, pad = 60, W = bx1 - bx0 + pad * 2, D = bz1 - bz0 + pad * 2, res = 4;
  const c = document.createElement('canvas'); c.width = Math.round(W * res); c.height = Math.round(D * res);
  const g = c.getContext('2d')!; g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, c.width, c.height);
  const P = (x: number, z: number) => [(x - bx0 + pad) * res, (z - bz0 + pad) * res];
  const layer = (channel: 'r' | 'g' | 'b' | 'a', draw: (ctx: CanvasRenderingContext2D) => void, blur = 6) => {
    const l = document.createElement('canvas'); l.width = c.width; l.height = c.height; const x = l.getContext('2d')!;
    x.filter = `blur(${blur}px)`; x.fillStyle = '#fff'; x.strokeStyle = '#fff'; draw(x); return { l, channel };
  };
  const rect = (x: CanvasRenderingContext2D, ax: number, az: number, bxx: number, bzz: number) => { const [a, b] = P(ax, az), [e, f] = P(bxx, bzz); x.fillRect(a, b, e - a, f - b); };
  const layers = [
    // R: asphalt road lanes north and south (and the access roads beyond the walls).
    layer('r', x => { for (const s of [-1, 1]) rect(x, bx0 - pad, s > 0 ? bz1 - 15 : bz0 + 1, bx1 + pad, s > 0 ? bz1 - 1 : bz0 + 15); rect(x, bx0 - pad, -3.5, bx0 - 2, 3.5); rect(x, bx1 + 2, -3.5, bx1 + pad, 3.5); }, 10),
    // G: gravel along walls, in spawns and outside the perimeter.
    layer('g', x => { rect(x, bx0 - pad, bz0 - pad, bx1 + pad, bz0 + 1.5); rect(x, bx0 - pad, bz1 - 1.5, bx1 + pad, bz1 + pad); rect(x, bx0 - pad, bz0 - pad, bx0 + 7, bz1 + pad); rect(x, bx1 - 7, bz0 - pad, bx1 + pad, bz1 + pad); }, 18),
    // B: dirt patches (noise blobs).
    layer('b', x => { for (let i = 0; i < 40; i++) { const px = bx0 + hash(i, 1) * (bx1 - bx0), pz = bz0 + hash(i, 2) * (bz1 - bz0), r = (1.5 + hash(i, 3) * 4) * res; const [a, b] = P(px, pz); x.beginPath(); x.ellipse(a, b, r * 1.4, r, hash(i, 4) * 3, 0, 6.3); x.fill(); } }, 14),
    // A: painted lines (lane edges, bay markings, zone rings), worn.
    layer('a', x => {
      x.lineWidth = .14 * res; x.setLineDash([3 * res, 1.6 * res]);
      for (const s of [-1, 1]) { const z = s > 0 ? bz1 - 8 : bz0 + 8; const [a, b] = P(bx0 + 2, z), [e] = P(bx1 - 2, z); x.beginPath(); x.moveTo(a, b); x.lineTo(e, b); x.stroke(); }
      x.setLineDash([]); x.lineWidth = .1 * res;
      for (const o of map.objectives) { const [a, b] = P(o.x, o.z); x.beginPath(); x.arc(a, b, o.r * res, 0, 6.3); x.stroke(); }
      for (const s of [-1, 1]) for (let i = 0; i < 6; i++) { const z = -10 + i * 4; const [a, b] = P(s * (bx1 - 5), z), [e, f] = P(s * (bx1 - 2), z + 2.6); x.strokeRect(Math.min(a, e), b, Math.abs(e - a), f - b); }
    }, 1),
  ];
  const data = g.createImageData(c.width, c.height);
  for (const { l, channel } of layers) {
    const src = l.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, k = { r: 0, g: 1, b: 2, a: 3 }[channel];
    for (let i = 0; i < src.length; i += 4) {
      let v = src[i + 3];
      if (channel === 'a') { const px = (i / 4) % c.width, py = Math.floor(i / 4 / c.width); v = v * (hash(Math.floor(px / 3), Math.floor(py / 3)) > .22 ? 1 : .2); }
      data.data[i + k] = v;
    }
  }
  const tex = new THREE.DataTexture(data.data, c.width, c.height, THREE.RGBAFormat);
  tex.flipY = false; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  return { tex, origin: new THREE.Vector2(bx0 - pad, bz0 - pad), size: new THREE.Vector2(W, D) };
}

/** Ground: a standard PBR material whose albedo, normal and roughness blend four surface sets by the splat map. */
/**
 * Where the yard is roofed over: roof and upper-floor footprints at one texel per metre. Sampled with
 * linear filtering it fades over about a metre, and it dims sky and ambient light on covered ground
 * (a cheap, all-profile stand-in for ambient occlusion under the sheds).
 */
function shelterTexture(map: Map3) {
  const [bx0, bz0, bx1, bz1] = map.bounds, pad = 4, w = Math.ceil(bx1 - bx0 + pad * 2), h = Math.ceil(bz1 - bz0 + pad * 2);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
  for (const b of map.boxes as Box[]) {
    const roofed = b.mat === 'roof' || (b.min[1] > 2.2 && b.max[1] - b.min[1] < 1.2 && (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) > 6);
    if (roofed) g.fillRect(b.min[0] - bx0 + pad + .4, b.min[2] - bz0 + pad + .4, b.max[0] - b.min[0] - .8, b.max[2] - b.min[2] - .8);
  }
  const tex = new THREE.CanvasTexture(c); tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, origin: new THREE.Vector2(bx0 - pad, bz0 - pad), size: new THREE.Vector2(w, h) };
}

function ground(lib: Library, map: Map3, q: ArenaQuality) {
  const s = lib.surfaces, splat = splatTexture(map);
  const shelter = shelterTexture(map);
  const m = new THREE.MeshStandardMaterial({ map: s.concreteFloor.color, normalMap: s.concreteFloor.normal, roughnessMap: s.concreteFloor.arm, aoMap: s.concreteFloor.arm, roughness: 1, metalness: 0, envMapIntensity: .7 });
  const uniforms = {
    tSplat: { value: splat.tex }, uOrigin: { value: splat.origin }, uSize: { value: splat.size },
    tShelter: { value: shelter.tex }, uShOrigin: { value: shelter.origin }, uShSize: { value: shelter.size },
    tRoad: { value: s.road.color }, tGravel: { value: s.gravel.color }, tDirt: { value: s.dirt.color },
    nRoad: { value: s.road.normal }, nGravel: { value: s.gravel.normal }, nDirt: { value: s.dirt.normal },
  };
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vGround;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `varying vec3 vGround;
uniform sampler2D tSplat, tRoad, tGravel, tDirt, nRoad, nGravel, nDirt, tShelter; uniform vec2 uOrigin, uSize, uShOrigin, uShSize;
vec4 splatAt() { return texture2D(tSplat, (vGround.xz - uOrigin) / uSize); }
float gnoise(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }
` + shader.fragmentShader
      .replace('#include <map_fragment>', `
vec4 sp = splatAt(); vec2 wuv = vGround.xz;
float macro = mix(.88, 1.08, gnoise(wuv * .05) * .5 + gnoise(wuv * .13) * .5);
vec3 cBase = texture2D(map, wuv / 3.0).rgb * macro;
vec3 cRoad = texture2D(tRoad, wuv / 4.0).rgb, cGravel = texture2D(tGravel, wuv / 2.5).rgb, cDirt = texture2D(tDirt, wuv / 3.0).rgb;
float wR = smoothstep(.15, .85, sp.r), wG = smoothstep(.2, .9, sp.g) * (1.0 - wR), wD = smoothstep(.25, .8, sp.b) * (1.0 - wR * .7);
vec3 albedo = mix(mix(mix(cBase, cRoad, wR), cGravel, wG), cDirt, wD);
albedo = mix(albedo, vec3(.78, .62, .16), sp.a * .85 * (1.0 - wD));
diffuseColor.rgb *= albedo;`)
      .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness * mix(mix(mix(texture2D(roughnessMap, wuv / 3.0).g, .78, wR), .92, wG), .95, wD);
roughnessFactor = mix(roughnessFactor, .55, sp.a * .7);`)
      .replace('#include <normal_fragment_maps>', `
vec3 tn = mix(mix(mix(texture2D(normalMap, wuv / 3.0).xyz, texture2D(nRoad, wuv / 4.0).xyz, wR), texture2D(nGravel, wuv / 2.5).xyz, wG), texture2D(nDirt, wuv / 3.0).xyz, wD) * 2.0 - 1.0;
tn.xy *= 1.15;
normal = normalize((viewMatrix * vec4(normalize(vec3(tn.x, tn.z, tn.y)), 0.0)).xyz);`)
      .replace('#include <aomap_fragment>', `float ambientOcclusion = mix(texture2D(aoMap, wuv / 3.0).r, 1.0, max(wR, wG));
ambientOcclusion *= 1.0 - .74 * texture2D(tShelter, (vGround.xz - uShOrigin) / uShSize).r;
reflectedLight.indirectDiffuse *= ambientOcclusion; reflectedLight.indirectSpecular *= ambientOcclusion;`);
  };
  const [bx0, bz0, bx1, bz1] = map.bounds, size = Math.max(bx1 - bx0, bz1 - bz0) + 260;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m); mesh.position.set((bx0 + bx1) / 2, 0, (bz0 + bz1) / 2); mesh.receiveShadow = true; mesh.name = 'ground';
  void q;
  return mesh;
}

// ---------------------------------------------------------------- beyond the walls
/** Distant industrial skyline, floodlight towers and parked vehicles outside the play area. */
function backdrop(b: Builder, m: Mats, props: Props, map: Map3, lights: THREE.Vector3[]) {
  const [bx0, bz0, bx1, bz1] = map.bounds;
  const shed = (x: number, z: number, w: number, d: number, h: number, wall: THREE.Material) => {
    b.box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, wall, 3);
    b.box(x - w / 2 - .3, h, z - d / 2 - .3, x + w / 2 + .3, h + .35, z + d / 2 + .3, m.roof, 1.2);
  };
  // Warehouses and hangars ringing the yard.
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + .2, r = 85 + hash(i, 9) * 45, x = Math.cos(a) * r * 1.2, z = Math.sin(a) * r;
    if (Math.abs(x) < bx1 + 15 && Math.abs(z) < bz1 + 15) continue;
    shed(x, z, 16 + hash(i, 1) * 20, 12 + hash(i, 2) * 18, 8 + hash(i, 3) * 10, i % 3 ? m.precast : m.brick);
  }
  // Silos and a water tower.
  for (const [x, z, r, h] of [[-95, -70, 4, 22], [-86, -72, 4, 22], [110, 60, 5, 18]]) b.cyl(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h, z), r, m.steel, 20, 3);
  b.cyl(new THREE.Vector3(70, 0, -95), new THREE.Vector3(70, 18, -95), .4, m.steel, 8); b.cyl(new THREE.Vector3(70, 18, -95), new THREE.Vector3(70, 24, -95), 5, m.steel, 20, 3);
  // Floodlight towers at the corners, just outside the walls.
  for (const [x, z] of [[bx0 - 3, bz0 - 3], [bx1 + 3, bz0 - 3], [bx0 - 3, bz1 + 3], [bx1 + 3, bz1 + 3]]) {
    b.cyl(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 15, z), .18, m.steel, 10);
    b.box(x - 1.4, 15, z - .25, x + 1.4, 15.15, z + .25, m.darkSteel, 1);
    for (const o of [-1, -.35, .35, 1]) { b.box(x + o - .22, 15.15, z - .16, x + o + .22, 15.5, z + .16, m.darkSteel, 1); b.box(x + o - .18, 15.2, z + (z > 0 ? -.19 : .16), x + o + .18, 15.45, z + (z > 0 ? -.16 : .19), m.glow, 1); }
    lights.push(new THREE.Vector3(x, 15.2, z));
  }
  // Parked equipment outside the gates.
  props.place('generator', bx0 - 6, 0, -6, .4, 1.2, 1.2, 1.2); props.place('generator', bx1 + 6, 0, 6, -2.6, 1.2, 1.2, 1.2);
  for (let i = 0; i < 6; i++) props.place('barrel', bx0 - 5 + hash(i) * 2, 0, 8 + i * .7, hash(i, 2) * 6, 1, 1, 1);
}

// ---------------------------------------------------------------- dressing inside the map (never in walkable space)
/** Small props against walls and on top of cover: lamps, power boxes, ammo, jerrycans. Purely decorative and flush with existing volumes. */
function dressing(props: Props, map: Map3, detail: number) {
  for (const box of map.boxes) {
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, h = y1 - y0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if ((box.mat === 'crate' || box.mat === 'barrier') && y0 < .1 && h < 1.5 && hash(cx, cz) > (detail ? .45 : .75)) {
      props.place(hash(cz, cx) > .5 ? 'ammo' : 'jerrycan', cx + (hash(cx) - .5) * .5, y1, cz + (hash(cz) - .5) * .3, hash(cx, 7) * 6, 1, 1, 1);
    }
    if (detail && (box.mat === 'brick' || box.mat === 'perimeter') && y1 > 5 && h > 4) {
      const alongX = x1 - x0 >= z1 - z0, L = alongX ? x1 - x0 : z1 - z0;
      for (let t = 5; t < L - 2; t += 16) {
        const inward = alongX ? (cz > 0 ? -1 : 1) : (cx > 0 ? -1 : 1);
        const px = alongX ? x0 + t : (inward > 0 ? x1 : x0), pz = alongX ? (inward > 0 ? z1 : z0) : z0 + t;
        props.place('wallLamp', px, 4.3, pz, alongX ? (inward > 0 ? 0 : Math.PI) : (inward > 0 ? Math.PI / 2 : -Math.PI / 2), 1, 1, 1);
      }
    }
  }
}

/** Build the whole environment. Returns objects to add to the scene and the positions of light fittings. */
export function buildEnvironment(lib: Library, map: Map3, q: ArenaQuality) {
  const b = new Builder(lib), m = materials(lib), props = new Props(), lights: THREE.Vector3[] = [], bags: THREE.Matrix4[] = [];
  for (const box of map.boxes) {
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, h = y1 - y0;
    switch (box.mat) {
      case 'perimeter': perimeter(b, m, box, q.detail); break;
      case 'brick': masonry(b, m, box, m.brick); break;
      case 'stone': masonry(b, m, box, m.stone); break;
      case 'concrete': masonry(b, m, box, m.concrete); break;
      case 'roof': roof(b, m, box, lights); break;
      case 'grate': b.box(x0, y0, z0, x1, y1, z1, m.plate, .9); b.box(x0, y0 - .22, z0, x1, y0, z0 + .12, m.steel, 1); b.box(x0, y0 - .22, z1 - .12, x1, y0, z1, m.steel, 1); break;
      case 'rail': railing(b, m, box); break;
      case 'metal': case 'timber': if (h < 4.1 && (x1 - x0 < 1.7 || z1 - z0 < 1.7) && box.mat === 'metal') step(b, m, box); else b.box(x0, y0, z0, x1, y1, z1, box.mat === 'timber' ? m.planks : m.plate, 1.2); break;
      case 'crate': {
        const layers = Math.max(1, Math.round(h / .75)), alongX = x1 - x0 >= z1 - z0, L = alongX ? x1 - x0 : z1 - z0, cols = Math.max(1, Math.round(L / 1.25));
        for (let l = 0; l < layers; l++) for (let i = 0; i < cols; i++) {
          const a = (alongX ? x0 : z0) + i * L / cols, e = a + L / cols, ya = y0 + l * h / layers, yb = ya + h / layers;
          const key: PropKey = (['crate', 'milCrate', 'oldCrate'] as PropKey[])[Math.floor(hash(a, ya) * 3)];
          if (alongX) props.fit(lib, key, a + .02, ya, z0 + .02, e - .02, yb, z1 - .02); else props.fit(lib, key, x0 + .02, ya, a + .02, x1 - .02, yb, e - .02);
        }
        break;
      }
      case 'barrier': {
        if (h > 1.6) { tWall(b, m, box); break; }
        const alongX = x1 - x0 >= z1 - z0, L = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / 1.6));
        for (let i = 0; i < n; i++) { const a = (alongX ? x0 : z0) + i * L / n, e = a + L / n; if (alongX) props.fit(lib, 'jersey', a, y0, z0, e, y1, z1); else props.fit(lib, 'jersey', x0, y0, a, x1, y1, e); }
        break;
      }
      case 'sandbag': sandbags(null as unknown as THREE.BufferGeometry, box, bags); break;
      case 'container-red': case 'container-blue': case 'container-yellow': container(b, m, box); break;
      case 'container-stack': b.box(x0, y0, z0, x1, y1 - .15, z1, m.precast, 3); b.box(x0 - .05, y1 - .15, z0 - .05, x1 + .05, y1, z1 + .05, m.darkSteel, 1); break;
      case 'machine': machine(b, m, box); break;
      case 'pillar': column(b, m, box); break;
      case 'hedge': b.box(x0, y0, z0, x1, y1, z1, m.hedge, 1); break;
      case 'bronze': b.box(x0, y0, z0, x1, y1, z1, m.bronze, 1); break;
      default: b.box(x0, y0, z0, x1, y1, z1, m.concrete, 2);
    }
  }
  for (const d of map.deco ?? []) frame(b, m, d);
  dressing(props, map, q.detail);
  backdrop(b, m, props, map, lights);
  // Cover props are in the library already; set dressing arrives later and is added by `decor()`.
  const present = new Set(Object.keys(lib.props));
  const objects: THREE.Object3D[] = [...b.meshes(q.shadows), ...props.meshes(lib, q.shadows, k => present.has(k)), ground(lib, map, q)];
  const decor = (keys: PropKey[]) => props.meshes(lib, q.shadows, k => keys.includes(k) && !present.has(k));
  if (bags.length) {
    const inst = new THREE.InstancedMesh(bagGeometry(q.detail), m.sandbag, bags.length);
    bags.forEach((M, i) => inst.setMatrixAt(i, M)); inst.castShadow = q.shadows; inst.receiveShadow = true; inst.computeBoundingSphere(); objects.push(inst);
  }
  return { objects, lights, decor };
}

/** What a bullet hits, by the material of the box (for impact effects and sounds). */
export type SurfaceKind = 'concrete' | 'metal' | 'wood' | 'sand' | 'brick' | 'dirt' | 'foliage';
/** Operation: Metropolis materials (shared/arena/metropolis.mjs) → the dust, sparks or splinters a round throws up. */
const CITY_FX: Record<string, SurfaceKind> = Object.fromEntries([
  ...['bus', 'van', 'car', 'truck', 'pickup', 'tank', 'ac', 'vent', 'plant', 'kiosk', 'shelter', 'canopy', 'brt-roof', 'brt-screen', 'hoarding', 'yard-wall', 'stair-steel', 'roof-sheet', 'cabinet', 'rack', 'forklift', 'bollard', 'vending', 'atm', 'faregate', 'switchgear', 'utility', 'bin', 'spire', 'frame', 'guardhouse', 'lamppost'].map(k => [k, 'metal']),
  ...['floor-timber', 'counter', 'desk', 'table', 'bench', 'shelf', 'sofa', 'partition', 'partition-wall', 'tree', 'palm'].map(k => [k, 'wood']),
  ...['st-grass', 'ug-track'].map(k => [k, 'dirt']), ['hedge', 'foliage'],
] as [string, SurfaceKind][]);
export function surfaceOf(mat: string | undefined): SurfaceKind {
  if (!mat) return 'dirt';
  const city = CITY_FX[mat]; if (city) return city;
  if (mat.startsWith('bld-')) return mat.includes('brick') || mat === 'bld-block' ? 'brick' : mat === 'bld-sheet' || mat === 'bld-terminal' || mat.includes('glass') || mat.includes('shaft') ? 'metal' : 'concrete';
  if (mat.startsWith('container') || ['rail', 'grate', 'metal', 'machine', 'pillar', 'roof', 'bronze'].includes(mat)) return 'metal';
  if (mat === 'crate' || mat === 'timber') return 'wood';
  if (mat === 'sandbag') return 'sand';
  if (mat === 'brick') return 'brick';
  if (mat === 'hedge') return 'foliage';
  return 'concrete';
}
export const _unused: SurfaceKey | undefined = undefined;
