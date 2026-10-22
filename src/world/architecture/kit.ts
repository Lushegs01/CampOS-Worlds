import * as THREE from 'three';
import type { MaterialKey, Materials } from '../materials';

export type V3 = [number, number, number];
type Opening = { x0: number; x1: number; y0: number; y1: number };

const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), n = new THREE.Vector3();

/** Box-project UVs in the current local frame (metres), choosing the axis per triangle. */
function projectUV(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position') as THREE.BufferAttribute, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    vA.fromBufferAttribute(p, i); vB.fromBufferAttribute(p, i + 1); vC.fromBufferAttribute(p, i + 2);
    n.subVectors(vC, vB).cross(vA.clone().sub(vB)).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? vA : k === 1 ? vB : vC, o = (i + k) * 2;
      if (ay >= ax && ay >= az) { uv[o] = v.x; uv[o + 1] = -v.z * Math.sign(n.y || 1); }
      else if (ax >= az) { uv[o] = -v.z * Math.sign(n.x); uv[o + 1] = v.y; }
      else { uv[o] = v.x * Math.sign(n.z); uv[o + 1] = v.y; }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export interface AddOptions { matrix?: THREE.Matrix4; keepUV?: boolean; color?: THREE.ColorRepresentation; shadow?: boolean }

/**
 * Collects procedural architecture by material and merges it into a handful of draw calls.
 * Authoring happens in a stack of local frames (push/pop) so a facade can be written as
 * "runs along +X, faces +Z" and then placed anywhere on a building.
 */
/** Copies a shaped part's attribute into merged arrays at vertex `at` (plain arrays directly, anything else per element). */
function copyInto(target: Float32Array, a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, at: number) {
  const size = a.itemSize;
  if (!(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && a.array instanceof Float32Array && a.array.length === a.count * size) { target.set(a.array, at * size); return; }
  for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) target[(at + i) * size + c] = a.getComponent(i, c);
}
interface Part { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 | null; frame: THREE.Matrix4; keepUV: boolean; color: THREE.ColorRepresentation }
export class Kit {
  // Parts are recorded as they are added and only shaped when built, so `buildSteps` can spread that work over frames.
  private buckets = new Map<string, { mat: MaterialKey; shadow: boolean; parts: Part[] }>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private color = new THREE.Color();

  push(position: V3, rotationY = 0) {
    const m = new THREE.Matrix4().makeRotationY(rotationY).setPosition(...position);
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m)); return this;
  }
  pop() { this.stack.pop(); return this; }
  within(position: V3, rotationY: number, fn: () => void) { this.push(position, rotationY); fn(); this.pop(); }
  /** World matrix for a point in the current local frame (for signs, props and lights). */
  matrixAt(local: V3, rotationY = 0, scale = 1) {
    return this.stack[this.stack.length - 1].clone().multiply(new THREE.Matrix4().makeRotationY(rotationY).scale(new THREE.Vector3(scale, scale, scale)).setPosition(...local));
  }
  place<T extends THREE.Object3D>(object: T, local: V3, rotationY = 0) {
    object.matrixAutoUpdate = false; object.matrix.copy(this.matrixAt(local, rotationY)); object.matrix.decompose(object.position, object.quaternion, object.scale); return object;
  }

  /** Takes ownership of `geometry` (it may be added again unchanged, as breeze screens do; never changed after). */
  add(mat: MaterialKey, geometry: THREE.BufferGeometry, o: AddOptions = {}) {
    const shadow = o.shadow ?? true, key = `${mat}|${shadow}`;
    let b = this.buckets.get(key); if (!b) { b = { mat, shadow, parts: [] }; this.buckets.set(key, b); }
    // The frame matrices on the stack are never changed in place; a caller's matrix may be (breezeScreen reuses one).
    const color = o.color instanceof THREE.Color ? o.color.clone() : o.color ?? '#ffffff';
    b.parts.push({ geometry, matrix: o.matrix ? o.matrix.clone() : null, frame: this.stack[this.stack.length - 1], keepUV: !!o.keepUV, color });
    return this;
  }
  private shape(p: Part) {
    const geometry = p.geometry;
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (p.matrix) g.applyMatrix4(p.matrix);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!p.keepUV || !g.getAttribute('uv')) projectUV(g);
    const count = g.getAttribute('position').count, col = new Float32Array(count * 3);
    this.color.set(p.color);
    for (let i = 0; i < count; i++) { col[i * 3] = this.color.r; col[i * 3 + 1] = this.color.g; col[i * 3 + 2] = this.color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.applyMatrix4(p.frame);
    return g;
  }

  box(mat: MaterialKey, center: V3, size: V3, o: AddOptions & { rotY?: number; rotX?: number; rotZ?: number } = {}) {
    if (size[0] <= 1e-4 || size[1] <= 1e-4 || size[2] <= 1e-4) return this;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(o.rotX ?? 0, o.rotY ?? 0, o.rotZ ?? 0)).setPosition(...center);
    return this.add(mat, new THREE.BoxGeometry(...size), { ...o, matrix: o.matrix ? o.matrix.clone().multiply(m) : m });
  }

  cylinder(mat: MaterialKey, base: V3, radiusTop: number, radiusBottom: number, height: number, segments = 12, o: AddOptions & { open?: boolean } = {}) {
    const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, o.open ?? false);
    // Wrap UVs around the circumference in metres so textures keep their scale.
    const uv = g.getAttribute('uv') as THREE.BufferAttribute, circ = Math.PI * 2 * Math.max(radiusTop, radiusBottom);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * height);
    const local = new THREE.Matrix4().makeTranslation(base[0], base[1] + height / 2, base[2]);
    return this.add(mat, g, { ...o, keepUV: true, matrix: o.matrix ? o.matrix.clone().multiply(local) : local });
  }

  /** A quad from four corners (counter-clockwise when seen from the front). */
  quad(mat: MaterialKey, a: V3, b: V3, c: V3, d: V3, o: AddOptions & { uv?: [number, number][] } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    if (o.uv) { const [ua, ub, uc, ud] = o.uv; g.setAttribute('uv', new THREE.Float32BufferAttribute([...ua, ...ub, ...uc, ...ua, ...uc, ...ud], 2)); }
    g.computeVertexNormals();
    return this.add(mat, g, { ...o, keepUV: !!o.uv });
  }

  build(lib: Materials, name = 'architecture') {
    const steps = this.buildSteps(lib, name);
    for (;;) { const r = steps.next(); if (r.done) return r.value; }
  }
  /** `build` in small steps (a few dozen parts each): callers that spread the work over frames step it (src/world/Expansion.tsx). */
  *buildSteps(lib: Materials, name = 'architecture'): Generator<void, THREE.Group> {
    const group = new THREE.Group(); group.name = name;
    for (const b of this.buckets.values()) {
      // Every shaped part has the same four attributes: each is copied straight into the merged arrays.
      const total = b.parts.reduce((n, p) => n + (p.geometry.index ?? p.geometry.getAttribute('position')).count, 0);
      if (!total) continue;
      const merged = { position: new Float32Array(total * 3), normal: new Float32Array(total * 3), uv: new Float32Array(total * 2), color: new Float32Array(total * 3) };
      let at = 0;
      for (let i = 0; i < b.parts.length; i++) {
        const g = this.shape(b.parts[i]), n = g.getAttribute('position').count;
        for (const k of ['position', 'normal', 'uv', 'color'] as const) copyInto(merged[k], g.getAttribute(k), at);
        at += n; g.dispose(); b.parts[i].geometry.dispose();
        if (i % 24 === 23) yield;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(merged.position, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(merged.uv, 2)); geometry.setAttribute('color', new THREE.BufferAttribute(merged.color, 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, lib[b.mat]);
      mesh.name = `${name}:${b.mat}`; mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      const m = lib[b.mat] as THREE.MeshStandardMaterial;
      if (m.alphaTest > 0) mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: m.alphaMap, map: m.map, alphaTest: m.alphaTest });
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh); yield;
    }
    this.buckets.clear();
    return group;
  }
}

// ---------------------------------------------------------------- facade elements
// Facade frame convention: the facade runs along +X, its outer face is the plane z = 0 and the
// wall body sits behind it (negative z). y = 0 is finished ground level.

export function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Solid wall with rectangular openings; piers, sills and lintels fall out of the subdivision. */
export function wall(kit: Kit, mat: MaterialKey, x0: number, x1: number, y0: number, y1: number, t: number, openings: Opening[] = []) {
  const xs = [...new Set([x0, x1, ...openings.flatMap(o => [Math.max(x0, Math.min(x1, o.x0)), Math.max(x0, Math.min(x1, o.x1))])])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1]; if (b - a < 1e-3) continue;
    const mid = (a + b) / 2, holes = openings.filter(o => o.x0 < mid && o.x1 > mid).map(o => [Math.max(y0, o.y0), Math.min(y1, o.y1)]).sort((p, q) => p[0] - q[0]);
    let y = y0;
    for (const [h0, h1] of [...holes, [y1, y1]]) { if (h0 - y > 1e-3) kit.box(mat, [mid, (y + h0) / 2, -t / 2], [b - a, h0 - y, t]); y = Math.max(y, h1); }
  }
}

export interface WindowStyle { frame?: MaterialKey; recess?: number; sill?: MaterialKey | null; mullion?: number; transom?: number; seed?: number; tint?: 'reflective' | 'clear' }
const PANES = ['#1a2830', '#22363f', '#283f47', '#1e2c2f', '#b9a78a', '#8d9a9c', '#2c3d44', '#d8cdb5'];

/** Recessed window: aluminium frame, mullions/transom, sill and varied glazing (some with blinds). */
export function windowUnit(kit: Kit, o: Opening, s: WindowStyle = {}) {
  const r = s.recess ?? .16, f = .05, fd = .07, w = o.x1 - o.x0, h = o.y1 - o.y0, cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, frame = s.frame ?? 'aluminium';
  const rand = rng(Math.floor((s.seed ?? 1) * 7919 + o.x0 * 131 + o.y0 * 977) % 2147483646 + 1);
  const mullions = Math.max(0, Math.round(w / (s.mullion ?? 1.25)) - 1), transom = s.transom ?? (h > 1.9 ? o.y0 + h * .72 : 0);
  // Glazing: one pane per bay so blinds vary realistically.
  const bays = mullions + 1, bw = w / bays;
  for (let i = 0; i < bays; i++) {
    const pane = rand() < .22 ? PANES[4 + Math.floor(rand() * 2)] : PANES[Math.floor(rand() * 4)];
    kit.add(s.tint === 'clear' ? 'glassClear' : 'glass', new THREE.PlaneGeometry(bw, h), { matrix: new THREE.Matrix4().makeTranslation(o.x0 + bw * (i + .5), cy, -r - .01), color: pane, shadow: false });
  }
  kit.box(frame, [cx, o.y1 - f / 2, -r + fd / 2 - .03], [w, f, fd]).box(frame, [cx, o.y0 + f / 2, -r + fd / 2 - .03], [w, f, fd]);
  kit.box(frame, [o.x0 + f / 2, cy, -r + fd / 2 - .03], [f, h, fd]).box(frame, [o.x1 - f / 2, cy, -r + fd / 2 - .03], [f, h, fd]);
  for (let i = 1; i <= mullions; i++) kit.box(frame, [o.x0 + bw * i, cy, -r + fd / 2 - .03], [f * .8, h, fd]);
  if (transom) kit.box(frame, [cx, transom, -r + fd / 2 - .03], [w, f * .8, fd]);
  if (s.sill !== null) kit.box(s.sill ?? 'brushed', [cx, o.y0 - .03, -r / 2 + .04], [w + .14, .06, r + .1]);
}

/** Vertical brise-soleil fins standing proud of a facade. */
export function fins(kit: Kit, mat: MaterialKey, x0: number, x1: number, spacing: number, depth: number, width: number, y0: number, y1: number) {
  const count = Math.round((x1 - x0) / spacing);
  for (let i = 0; i <= count; i++) kit.box(mat, [x0 + i * (x1 - x0) / count, (y0 + y1) / 2, depth / 2], [width, y1 - y0, depth]);
}

/** Horizontal sunshade / floor-edge slab projecting from the facade. */
export function sunshade(kit: Kit, mat: MaterialKey, x0: number, x1: number, y: number, depth: number, thickness = .18) {
  kit.box(mat, [(x0 + x1) / 2, y, depth / 2], [x1 - x0, thickness, depth]);
}

let breezeBlock: THREE.BufferGeometry | null = null;
/** The porthole breeze block common in West African tropical modernism (0.4 m module). */
function breezeGeometry() {
  if (breezeBlock) return breezeBlock;
  const s = .19, shape = new THREE.Shape([new THREE.Vector2(-s, -s), new THREE.Vector2(s, -s), new THREE.Vector2(s, s), new THREE.Vector2(-s, s)]);
  const hole = new THREE.Path(); hole.absarc(0, 0, .13, 0, Math.PI * 2, true); shape.holes.push(hole);
  breezeBlock = new THREE.ExtrudeGeometry(shape, { depth: .14, bevelEnabled: false, curveSegments: 3 });
  breezeBlock.translate(0, 0, -.07);
  return breezeBlock;
}
export function breezeScreen(kit: Kit, mat: MaterialKey, x0: number, x1: number, y0: number, y1: number, z = -.07) {
  const g = breezeGeometry(), cols = Math.max(1, Math.round((x1 - x0) / .4)), rows = Math.max(1, Math.round((y1 - y0) / .4)), sx = (x1 - x0) / cols, sy = (y1 - y0) / rows;
  const m = new THREE.Matrix4();
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) kit.add(mat, g, { matrix: m.makeScale(sx / .4, sy / .4, 1).setPosition(x0 + sx * (i + .5), y0 + sy * (j + .5), z) });
}

/** Steel balustrade along a straight run (in the current frame, along +X at z). */
export function railing(kit: Kit, x0: number, x1: number, y: number, z: number, height = 1.05, mat: MaterialKey = 'paintDark') {
  const posts = Math.max(1, Math.round((x1 - x0) / 1.6));
  for (let i = 0; i <= posts; i++) kit.box(mat, [x0 + (x1 - x0) * i / posts, y + height / 2, z], [.05, height, .05]);
  kit.box(mat, [(x0 + x1) / 2, y + height, z], [x1 - x0 + .05, .06, .08]);
  for (const k of [.35, .65]) kit.box(mat, [(x0 + x1) / 2, y + height * k, z], [x1 - x0, .025, .025]);
  const bars = Math.round((x1 - x0) / .14);
  for (let i = 1; i < bars; i++) kit.box(mat, [x0 + (x1 - x0) * i / bars, y + height * .5, z], [.016, height * .3, .016], { shadow: false });
}

/** Straight flight of steps rising along +X. */
export function steps(kit: Kit, mat: MaterialKey, x0: number, z0: number, z1: number, count: number, rise = .15, tread = .3) {
  for (let i = 0; i < count; i++) kit.box(mat, [x0 + tread * (i + .5), rise * (i + .5), (z0 + z1) / 2], [tread, rise * (i + 1), z1 - z0]);
}

/** Hipped long-span roof over the rectangle [x0,x1]×[z0,z1] at eave height y. */
export function hipRoof(kit: Kit, mat: MaterialKey, x0: number, x1: number, z0: number, z1: number, y: number, pitch = .32, overhang = 1, fascia: MaterialKey = 'paintWhite') {
  x0 -= overhang; x1 += overhang; z0 -= overhang; z1 += overhang;
  const halfD = (z1 - z0) / 2, rise = halfD * pitch, ridgeY = y + rise, inset = halfD;
  const rx0 = Math.min(x0 + inset, (x0 + x1) / 2), rx1 = Math.max(x1 - inset, (x0 + x1) / 2), zm = (z0 + z1) / 2;
  const slope = Math.hypot(halfD, rise);
  // Front and back trapezoids, then the hip ends; UVs run down-slope so the ribs follow the fall.
  kit.quad(mat, [x0, y, z1], [x1, y, z1], [rx1, ridgeY, zm], [rx0, ridgeY, zm], { uv: [[x0, 0], [x1, 0], [rx1, slope], [rx0, slope]] });
  kit.quad(mat, [x1, y, z0], [x0, y, z0], [rx0, ridgeY, zm], [rx1, ridgeY, zm], { uv: [[-x1, 0], [-x0, 0], [-rx0, slope], [-rx1, slope]] });
  const endSlope = Math.hypot(rx0 - x0, rise);
  kit.quad(mat, [x0, y, z0], [x0, y, z1], [rx0, ridgeY, zm], [rx0, ridgeY, zm], { uv: [[z0, 0], [z1, 0], [zm, endSlope], [zm, endSlope]] });
  kit.quad(mat, [x1, y, z1], [x1, y, z0], [rx1, ridgeY, zm], [rx1, ridgeY, zm], { uv: [[-z1, 0], [-z0, 0], [-zm, endSlope], [-zm, endSlope]] });
  // Soffit, fascia board and ridge cap.
  kit.box('paintWhite', [(x0 + x1) / 2, y - .02, (z0 + z1) / 2], [x1 - x0, .03, z1 - z0], { shadow: false });
  kit.box(fascia, [(x0 + x1) / 2, y - .1, z1], [x1 - x0, .24, .04]).box(fascia, [(x0 + x1) / 2, y - .1, z0], [x1 - x0, .24, .04]);
  kit.box(fascia, [x0, y - .1, (z0 + z1) / 2], [.04, .24, z1 - z0]).box(fascia, [x1, y - .1, (z0 + z1) / 2], [.04, .24, z1 - z0]);
  kit.box('steel', [(rx0 + rx1) / 2, ridgeY + .04, zm], [rx1 - rx0 + .2, .08, .3]);
}

/** Flat roof with parapet and coping, optionally with a projecting eave slab. */
export function flatRoof(kit: Kit, x0: number, x1: number, z0: number, z1: number, y: number, o: { parapet?: number; eave?: number; mat?: MaterialKey; slab?: number } = {}) {
  const e = o.eave ?? 0, slab = o.slab ?? .35, mat = o.mat ?? 'concrete';
  kit.box(mat, [(x0 + x1) / 2, y + slab / 2, (z0 + z1) / 2], [x1 - x0 + 2 * e, slab, z1 - z0 + 2 * e]);
  const p = o.parapet ?? 0;
  if (p > 0) {
    const X0 = x0 - e, X1 = x1 + e, Z0 = z0 - e, Z1 = z1 + e, t = .2, top = y + slab;
    kit.box(mat, [(X0 + X1) / 2, top + p / 2, Z0 + t / 2], [X1 - X0, p, t]).box(mat, [(X0 + X1) / 2, top + p / 2, Z1 - t / 2], [X1 - X0, p, t]);
    kit.box(mat, [X0 + t / 2, top + p / 2, (Z0 + Z1) / 2], [t, p, Z1 - Z0]).box(mat, [X1 - t / 2, top + p / 2, (Z0 + Z1) / 2], [t, p, Z1 - Z0]);
    kit.box('brushed', [(X0 + X1) / 2, top + p + .03, Z0 + t / 2], [X1 - X0 + .06, .06, t + .08]).box('brushed', [(X0 + X1) / 2, top + p + .03, Z1 - t / 2], [X1 - X0 + .06, .06, t + .08]);
    kit.box('brushed', [X0 + t / 2, top + p + .03, (Z0 + Z1) / 2], [t + .08, .06, Z1 - Z0]).box('brushed', [X1 - t / 2, top + p + .03, (Z0 + Z1) / 2], [t + .08, .06, Z1 - Z0]);
  }
}

/** Rooftop water storage: ribbed polyethylene tank on a galvanised stand (a Nigerian rooftop staple). */
export function waterTank(kit: Kit, x: number, y: number, z: number, color = '#2a3a4a', stand = 1.2) {
  for (const [dx, dz] of [[-.55, -.55], [.55, -.55], [.55, .55], [-.55, .55]]) kit.box('steel', [x + dx, y + stand / 2, z + dz], [.07, stand, .07]);
  kit.box('steel', [x, y + stand, z], [1.4, .08, 1.4]);
  kit.cylinder('paintDark', [x, y + stand + .04, z], .78, .82, 1.5, 18, { color });
  for (const k of [.4, .8, 1.2]) kit.cylinder('paintDark', [x, y + stand + .04 + k, z], .84, .84, .05, 18, { color });
  kit.cylinder('paintDark', [x, y + stand + 1.54, z], .3, .7, .22, 14, { color });
}

/** Split-unit air-conditioner condenser bracketed to a wall (facade frame). */
export function acUnit(kit: Kit, x: number, y: number) {
  kit.box('paintWhite', [x, y, .2], [.82, .56, .3]);
  kit.cylinder('darkMetal', [0, 0, 0], .19, .19, .02, 16, { matrix: new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x - .12, y, .36) });
  for (const dx of [-.3, .3]) kit.box('steel', [x + dx, y - .3, .2], [.04, .04, .42]);
  kit.box('steel', [x + .34, y - .5, .05], [.03, 1, .03], { shadow: false });
}

/** Rainwater downpipe from roof to ground (facade frame). */
export function downpipe(kit: Kit, x: number, top: number) {
  kit.cylinder('paintWhite', [x, 0, .1], .055, .055, top, 8);
  kit.box('brushed', [x, .03, .3], [.3, .06, .5]);
}

/** Glazed double door with a deep frame (facade frame, centred on x). */
export function door(kit: Kit, x: number, w = 1.8, h = 2.4, recess = .25, frame: MaterialKey = 'bronzeFrame') {
  kit.add('glassClear', new THREE.PlaneGeometry(w, h), { matrix: new THREE.Matrix4().makeTranslation(x, h / 2, -recess), shadow: false });
  kit.box(frame, [x, h + .04, -recess], [w + .1, .08, .08]).box(frame, [x - w / 2, h / 2, -recess], [.07, h, .08]).box(frame, [x + w / 2, h / 2, -recess], [.07, h, .08]).box(frame, [x, h / 2, -recess], [.06, h, .08]);
  for (const dx of [-.12, .12]) kit.box('chrome', [x + dx, 1.05, -recess + .08], [.03, .6, .03]);
}

/** Powder-coated campus litter bin with a domed lid and a recycling band. */
export function wasteBin(kit: Kit, x: number, z: number, rotY = 0) {
  kit.within([x, 0, z], rotY, () => {
    kit.cylinder('brushed', [0, 0, 0], .3, .32, .08, 14);
    kit.cylinder('paintGreen', [0, .08, 0], .26, .23, .78, 14);
    kit.cylinder('paintYellow', [0, .62, 0], .262, .262, .06, 14, { shadow: false });
    kit.cylinder('darkMetal', [0, .86, 0], .27, .27, .05, 14).cylinder('darkMetal', [0, .91, 0], .1, .25, .09, 14);
    kit.box('darkMetal', [0, .8, .22], [.22, .06, .07]);
  });
}
