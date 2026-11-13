// Building blocks for the city: a builder that knows where each piece is (outdoors, in a shop, in a hall, under the
// street) and lights it accordingly; faces of solid buildings that get real window geometry; a sign atlas; baked
// vehicles. Everything ends up in a few merged meshes per region.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Builder, hash } from '../environment';
import type { Library } from '../library';
import { inside, type CityMats, type Where } from './materials';
import { paneGeometry, WINDOW_ROOM, WINDOW_SHOP } from './windows';

export type Box = { min: number[]; max: number[]; mat: string; thin?: boolean; stair?: boolean };
export type Deco = Box & { kind: string; alongZ: boolean; wall: string; east?: boolean };
export type Building = { id: string; name: string; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; enter: boolean; fill: string; east?: boolean };
export type CityMap = {
  id: string; boxes: Box[]; deco: Deco[]; glass: { min: number[]; max: number[]; alongZ: boolean; i: number }[]; bounds: number[]; street: number;
  station: { spaces: (number | string | boolean)[][] }; buildings: Building[]; objectives: { id: string; x: number; y: number; z: number; r: number }[];
  train: { z0: number; z1: number; top: number; length: number; speed: number; from: number; to: number; periodMs: number; firstMs: number; warnMs: number };
};

/**
 * Street lighting and palms: drawn, not collided with (slim, and kept to verges and planters so no lane changes).
 * West half listed; the east half mirrors it.
 */
export function streetExtras(street: number): Box[] {
  const L = street, out: Box[] = [];
  const B = (x: number, z: number, w: number, h: number, y: number, mat: string) => out.push({ min: [x - w / 2, y, z - w / 2], max: [x + w / 2, y + h, z + w / 2], mat }, { min: [-x - w / 2, y, z - w / 2], max: [-x + w / 2, y + h, z + w / 2], mat });
  for (const [x, z] of [[-42, -29.3], [-27, -29.3], [-12, -29.3], [-35, -20.7], [-10, -20.7], [-42, 17.3], [-16, 17.3], [-20.6, -4.6], [-7.5, 7.2], [-44.6, 0], [-47, 39.6], [-26, 40.4]]) B(x, z, .22, 6, L, 'lamppost');
  for (const x of [-22.5, -18, -13.5]) B(x, -25, .42, 6.5, L + .85, 'palm');
  B(-6, -9.4, .42, 6.5, L + .9, 'palm'); B(-57.6, -13.5, .42, 6.5, L, 'palm'); B(-57.6, 14, .42, 6.5, L, 'palm');
  return out;
}

/** Regions drawn and culled together: 0 the station, 1–9 a 3 × 3 grid of the street level, 10 beyond the site. */
export const CHUNK_STATION = 0, CHUNK_FAR = 10;
export function chunkOf(street: number, coarse = false) {
  // Coarse (Low, phones): the street level in two halves. Most of the 3 × 3 grid is in view from anywhere on the street,
  // so the finer split mostly multiplies draw calls (one per material per region), which is what a phone's CPU pays for.
  if (coarse) return (c: THREE.Vector3) => (c.y < street - .3 ? CHUNK_STATION : c.x < 0 ? 4 : 6);
  return (c: THREE.Vector3) => (c.y < street - .3 ? CHUNK_STATION : 1 + (c.x < -20 ? 0 : c.x < 20 ? 1 : 2) + 3 * (c.z < -18 ? 0 : c.z < 11 ? 1 : 2));
}

/** Where a point is, for lighting: under the street, inside a building (shop or hall), or outdoors. */
export function placeFinder(map: CityMap) {
  const halls = new Set(['warehouse', 'terminal', 'substation']);
  return (x: number, y: number, z: number): Where => {
    if (y < map.street - .3) return 'ug';
    for (const b of map.buildings) if (b.enter && x > b.x0 + .45 && x < b.x1 - .45 && z > b.z0 + .45 && z < b.z1 - .45 && y < b.y1 - .05 && y >= b.y0 - .1) return halls.has(b.id.replace(/-e$/, '')) ? 'hall' : 'shop';
    return 'out';
  };
}

const tmpBox = new THREE.Box3(), tmpC = new THREE.Vector3();
export class CityBuilder extends Builder {
  /** Force the lighting of what is added next (null: decide from its position). */
  force: Where | null = null;
  constructor(lib: Library, street: number, private where: (x: number, y: number, z: number) => Where, coarse = false) { super(lib, chunkOf(street, coarse)); }
  add(geo: THREE.BufferGeometry, material: THREE.Material, scale: number, matrix?: THREE.Matrix4, rotateUV = false, keepUV = false, chunk?: number) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    tmpBox.copy(geo.boundingBox!); if (matrix) tmpBox.applyMatrix4(matrix); tmpBox.getCenter(tmpC);
    super.add(geo, inside(material, this.force ?? this.where(tmpC.x, tmpC.y, tmpC.z)), scale, matrix, rotateUV, keepUV, chunk);
  }
  /** A rounded box (vehicle bodies, furniture). */
  rbox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: THREE.Material, r = .08, scale = 1) {
    const g = new RoundedBoxGeometry(x1 - x0, y1 - y0, z1 - z0, 2, Math.min(r, (x1 - x0) / 2.1, (y1 - y0) / 2.1, (z1 - z0) / 2.1));
    this.add(g, material, scale, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)); g.dispose();
  }
  /** A vertical cylinder. */
  post(x: number, z: number, y0: number, y1: number, r: number, material: THREE.Material, seg = 10, r1 = r) {
    const g = new THREE.CylinderGeometry(r1, r, y1 - y0, seg); this.add(g, material, 1, new THREE.Matrix4().makeTranslation(x, (y0 + y1) / 2, z)); g.dispose();
  }
  /** Every mesh under `root` (multi-material meshes included), placed by `M`, merged with the rest. */
  bake(root: THREE.Object3D, M: THREE.Matrix4, remap?: (m: THREE.Material) => THREE.Material | null) {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const g0 = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry, count = g0.attributes.position.count;
      const groups = g0.groups.length && mats.length > 1 ? g0.groups : [{ start: 0, count, materialIndex: 0 }];
      for (const gr of groups) {
        const src = mats[gr.materialIndex ?? 0]; if (!src || gr.count <= 0) continue;
        const mat = remap ? remap(src) : src; if (!mat) continue;
        const sub = new THREE.BufferGeometry(), n = Math.min(gr.count, count - gr.start);
        for (const name of ['position', 'normal', 'uv']) { const a = g0.attributes[name]; if (a) sub.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(gr.start * a.itemSize, (gr.start + n) * a.itemSize), a.itemSize)); }
        this.add(sub, mat, 1, M.clone().multiply(mesh.matrixWorld), false, !!(mat as THREE.MeshStandardMaterial).map); sub.dispose();
      }
      if (g0 !== mesh.geometry) g0.dispose();
    });
  }
}

/**
 * One face of a solid building, addressed in its own coordinates: u along the wall, v up, w out of the wall.
 * `box(u0, v0, u1, v1, w0, w1)` places a box in those coordinates.
 */
export class Face {
  private M = new THREE.Matrix4();
  constructor(private b: CityBuilder, origin: THREE.Vector3, along: THREE.Vector3, out: THREE.Vector3, readonly length: number, readonly height: number) {
    this.M.makeBasis(along, new THREE.Vector3(0, 1, 0), out).setPosition(origin);
  }
  box(u0: number, v0: number, u1: number, v1: number, w0: number, w1: number, material: THREE.Material, scale = 2) {
    const g = new THREE.BoxGeometry(Math.max(1e-3, u1 - u0), Math.max(1e-3, v1 - v0), Math.max(1e-3, w1 - w0));
    this.b.add(g, material, scale, this.M.clone().multiply(new THREE.Matrix4().makeTranslation((u0 + u1) / 2, (v0 + v1) / 2, (w0 + w1) / 2))); g.dispose();
  }
  /** A window pane (interior-mapped: see windows.ts) from (u0, v0) to (u1, v1), at depth w, facing out. */
  pane(u0: number, v0: number, u1: number, v1: number, w: number, material: THREE.Material, seed: number, kind: number) {
    if (u1 - u0 < .05 || v1 - v0 < .05) return;
    const g = paneGeometry(u1 - u0, v1 - v0, seed, kind);
    this.b.add(g, material, 1, this.M.clone().multiply(new THREE.Matrix4().makeTranslation(u0, v0, w)), false, true); g.dispose();
  }
  matrix() { return this.M; }
}

export type FacadeStyle = { wall: THREE.Material; bay: number; floor: number; ground: 'shops' | 'plain' | 'none'; balcony: number; trim: THREE.Material; seed: number };
/**
 * Dress a solid face as a building front: a ground floor of shuttered shop units under a fascia, then storeys of
 * recessed windows (reveal, lit-or-dark room behind, frame, glass, sill), some with a balcony or a condenser, a
 * cornice at the top. All real geometry, a few dozen triangles a window.
 */
export function facade(f: Face, m: CityMats, s: FacadeStyle, detail: number, aircon?: (M: THREE.Matrix4) => void) {
  // The visible wall stands D proud of the collision face, built as piers and bands around the openings, so every
  // window sits in a real reveal.
  const L = f.length, H = f.height, D = .14, bays = Math.max(1, Math.round(L / s.bay)), bw = L / bays;
  const wall = (u0: number, v0: number, u1: number, v1: number) => { if (u1 - u0 > .01 && v1 - v0 > .01) f.box(u0, v0, u1, v1, 0, D, s.wall, 2.4); };
  let v = 0;
  if (s.ground === 'shops') {
    for (let i = 0; i < bays; i++) {
      const u0 = i * bw + .35, u1 = (i + 1) * bw - .35, open = hash(s.seed, i) > .55;
      if (open) f.pane(u0, .12, u1, 2.9, .03, m.window, s.seed * 3.7 + i * 17.3, WINDOW_SHOP); else f.box(u0, .12, u1, 2.9, 0, .03, m.shutter, 1.6);
      wall(i * bw, 0, u0, 2.98); wall(u1, 0, (i + 1) * bw, 2.98); wall(u0, 0, u1, .12);
      f.box(u0 - .06, .12, u0, 2.9, .03, D + .03, m.frame, 1); f.box(u1, .12, u1 + .06, 2.9, .03, D + .03, m.frame, 1);
    }
    f.box(0, 2.9, L, 3.55, 0, D + .12, s.trim, 2); v = 3.55;
  } else if (s.ground === 'plain') { f.box(0, 0, L, .6, 0, D + .05, s.trim, 2); v = .6; }
  const floors = Math.max(0, Math.floor((H - v - .5) / s.floor));
  for (let k = 0; k < floors; k++) {
    const base = v + k * s.floor, v0 = base + .95, v1 = v0 + 1.55;
    wall(0, base, L, v0); wall(0, v1, L, base + s.floor);
    for (let i = 0; i < bays; i++) {
      const u0 = i * bw + bw * .22, u1 = (i + 1) * bw - bw * .22, r = hash(s.seed + k * 7.3, i * 3.1);
      wall(i * bw, v0, u0, v1); wall(u1, v0, (i + 1) * bw, v1);
      f.pane(u0, v0, u1, v1, .02, m.window, s.seed * 1.93 + k * 41.7 + i * 7.31, WINDOW_ROOM);              // the pane, and the room behind it
      f.box(u0, v0, u0 + .06, v1, .02, .07, m.frame, 1); f.box(u1 - .06, v0, u1, v1, .02, .07, m.frame, 1);
      f.box(u0, v1 - .06, u1, v1, .02, .07, m.frame, 1); f.box(u0, v0, u1, v0 + .06, .02, .07, m.frame, 1);
      if (detail) { f.box((u0 + u1) / 2 - .025, v0, (u0 + u1) / 2 + .025, v1, .02, .06, m.frame, 1); f.box(u0 - .08, v0 - .08, u1 + .08, v0, 0, D + .1, s.trim, 1); }
      if (r < s.balcony) {
        // A shallow balcony: slab with a drip edge, a low upstand, a steel balustrade of bars under a handrail.
        const b0 = u0 - .3, b1 = u1 + .3, y = v0 - .88, front = D + .84;
        f.box(b0, v0 - 1.02, b1, y, D, D + .88, s.trim, 1); f.box(b0, v0 - 1.06, b1, v0 - 1.02, D + .8, D + .88, s.trim, 1);
        f.box(b0, y, b1, y + .12, front - .06, front, s.trim, 1);
        f.box(b0, y + .98, b1, y + 1.03, front - .05, front, m.frame, 1); f.box(b0, y + .12, b0 + .04, y + .98, D, front, m.frame, 1); f.box(b1 - .04, y + .12, b1, y + .98, D, front, m.frame, 1);
        if (detail) for (let x = b0 + .14; x < b1 - .1; x += .14) f.box(x - .01, y + .12, x + .01, y + .98, front - .035, front - .015, m.frame, 1);
        else f.box(b0, y + .12, b1, y + .98, front - .03, front - .02, m.frame, 1);
      } else if (aircon && r > .4 && r < .62) aircon(f.matrix().clone().multiply(new THREE.Matrix4().makeTranslation(u1 + .1, v0 - .75, D)));
    }
  }
  wall(0, v + floors * s.floor, L, H);
  for (let k = 1; k <= floors && detail; k++) f.box(0, v + k * s.floor - .08, L, v + k * s.floor + .06, D, D + .05, s.trim, 2);
  f.box(-.06, H - .28, L + .06, H, 0, D + .18, s.trim, 2);
}

/** Signs drawn into one texture: shop fascias, street names, station signs, posters. */
export class SignAtlas {
  readonly canvas = document.createElement('canvas'); private g: CanvasRenderingContext2D; private x = 0; private y = 0; private row = 0;
  private texture: THREE.CanvasTexture | null = null;
  constructor(size = 2048) { this.canvas.width = this.canvas.height = size; this.g = this.canvas.getContext('2d')!; this.g.fillStyle = '#000'; this.g.fillRect(0, 0, size, size); }
  /** Draw a sign `w` × `h` pixels with `paint`; returns its UV rectangle. */
  slot(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    const S = this.canvas.width; if (this.x + w > S) { this.x = 0; this.y += this.row + 4; this.row = 0; }
    const x = this.x, y = this.y; this.x += w + 4; this.row = Math.max(this.row, h);
    if (y + h > S) console.warn(`Sign atlas full (${S}²): a sign is drawn over another.`);
    this.g.save(); this.g.translate(x, y); this.g.beginPath(); this.g.rect(0, 0, w, h); this.g.clip(); paint(this.g, w, h); this.g.restore();
    return [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S] as [number, number, number, number];
  }
  private texts = new Map<string, [number, number, number, number]>();
  /** A plain lettered sign (identical signs share one slot). */
  text(text: string, bg: string, fg: string, w = 512, h = 96, sub = '') {
    const key = [text, bg, fg, w, h, sub].join('|'), hit = this.texts.get(key); if (hit) return hit;
    const uv = this.drawText(text, bg, fg, w, h, sub); this.texts.set(key, uv); return uv;
  }
  private drawText(text: string, bg: string, fg: string, w: number, h: number, sub: string) {
    return this.slot(w, h, (g, W, H) => {
      g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = H * (sub ? .46 : .56); g.font = `800 ${size}px "Manrope Variable", system-ui, sans-serif`;
      const tw = g.measureText(text).width; if (tw > W * .9) { size *= W * .9 / tw; g.font = `800 ${size}px "Manrope Variable", system-ui, sans-serif`; }
      g.fillText(text, W / 2, sub ? H * .4 : H / 2 + 2);
      if (sub) { g.font = `600 ${H * .2}px "Manrope Variable", system-ui, sans-serif`; g.globalAlpha = .85; g.fillText(sub, W / 2, H * .78); }
    });
  }
  /** A backlit advertising poster (portrait): a colour field with a soft photographic-style gradient, a headline,
   *  a line of copy and a brand bar. Original fictional brands only. */
  private posters = new Map<string, [number, number, number, number]>();
  poster(head: string, copy: string, brand: string, c0: string, c1: string, fg = '#ffffff') {
    const hit = this.posters.get(head); if (hit) return hit;
    // Drawn at 256 × 384 and scaled into the atlas (an eighth of its width: smaller on Low's 1024² atlas).
    const w = this.canvas.width / 8, uv = this.slot(w, w * 1.5, (g, W) => { g.scale(W / 256, W / 256); paint(g, 256, 384); });
    this.posters.set(head, uv); return uv;
    function paint(g: CanvasRenderingContext2D, W: number, H: number) {
      const grad = g.createLinearGradient(0, 0, W * .4, H); grad.addColorStop(0, c0); grad.addColorStop(1, c1); g.fillStyle = grad; g.fillRect(0, 0, W, H);
      // A large soft shape suggesting a product shot.
      const r = g.createRadialGradient(W * .62, H * .42, 4, W * .62, H * .42, W * .55); r.addColorStop(0, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.beginPath(); g.arc(W * .62, H * .42, W * .55, 0, 6.283); g.fill();
      g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'top';
      let size = 46; g.font = `800 ${size}px "Manrope Variable", system-ui, sans-serif`; const words = head.split(' ');
      words.forEach((w, i) => g.fillText(w, 18, 22 + i * size * 1.02));
      g.font = `600 17px "Manrope Variable", system-ui, sans-serif`; g.globalAlpha = .9; g.fillText(copy, 18, H - 92); g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, H - 52, W, 52); g.fillStyle = fg; g.font = `800 22px "Manrope Variable", system-ui, sans-serif`; g.fillText(brand, 18, H - 38); size = 0;
    }
  }
  map() { if (!this.texture) { this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4; } this.texture.needsUpdate = true; return this.texture; }
}
/** A flat panel showing a rectangle of the sign atlas, facing +z before `M`. */
export function signPanel(b: CityBuilder, material: THREE.Material, uv: [number, number, number, number], w: number, h: number, M: THREE.Matrix4) {
  const g = new THREE.PlaneGeometry(w, h), a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  b.add(g, material, 1, M, false, true); g.dispose();
}
export const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
export const RY = (a: number) => new THREE.Matrix4().makeRotationY(a);
export { hash };
