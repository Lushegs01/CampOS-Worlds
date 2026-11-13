// Operation: Metropolis — the Port of Okun Bay: shipping containers as they really are (deep trapezoid corrugation
// facing out, door ends with locking bars, painted line logos and owner codes that follow the ribs, weathering), and
// the working port beyond the quay: lattice ship-to-shore cranes with hazard-striped legs, a far terminal stacked
// with boxes under rubber-tyred gantries, and floodlight masts.
//
// Everything here is presentation. Containers are drawn inside their collision boxes; the cranes, terminal and masts
// stand beyond the site's south edge where no player can go. All brands and codes are fictional.
import * as THREE from 'three';
import { surface, type Library } from '../library';
import { addLayers } from './surfaces';
import { CityBuilder, T, RY, hash, CHUNK_FAR, type Box } from './kit';
import type { CityMats } from './materials';

/** Fictional shipping lines (no real carrier's name, mark or colours). */
const BRANDS = ['OKUN BAY LINES', 'IROKO MARINE', 'TIDEMARK', 'VESPERA', 'CAMPOS FREIGHT', 'HARMATTAN'] as const;
const OWNER = ['OKBU', 'IRKU', 'TDMU', 'VSPU', 'CMPU', 'HRMU'];
type Rect = [number, number, number, number];

export interface PortArt {
  /** Line logos (white, and a dark version for pale boxes) and owner codes, alpha-tested decals. */
  light: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial;
  logo: Rect[]; code: Rect[];
  hazard: THREE.MeshStandardMaterial; craneBlue: THREE.MeshStandardMaterial; craneGrey: THREE.MeshStandardMaterial;
  dispose: () => void;
}

/** The decal atlas: six logos (1024 × 128 each) over sixteen owner-code plates (256 × 64). */
function decalAtlas(size: number) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d')!, k = size / 1024;
  g.scale(k, k);
  const logo: Rect[] = [], code: Rect[] = [];
  const font = (w: number, px: number) => `${w} ${px}px "Manrope Variable", system-ui, sans-serif`;
  BRANDS.forEach((name, i) => {
    const y = i * 128, h = 128, m = 104, my = y + (h - m) / 2;
    g.save(); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    // A simple mark at the left of each logo.
    const cx = 12 + m / 2, cy = my + m / 2;
    if (i === 0) { g.lineWidth = 11; for (let r = 0; r < 3; r++) { g.beginPath(); for (let t = 0; t <= 1.0001; t += .05) { const x = 14 + t * (m - 4), yy = cy - 26 + r * 26 + Math.sin(t * 6.283) * 9; if (t === 0) g.moveTo(x, yy); else g.lineTo(x, yy); } g.stroke(); } }
    else if (i === 1) { g.beginPath(); g.moveTo(cx, my + 4); g.lineTo(cx + 42, my + m - 22); g.lineTo(cx - 42, my + m - 22); g.closePath(); g.fill(); g.fillRect(cx - 6, my + m - 26, 12, 26); }
    else if (i === 2) { for (let s = 0; s < 3; s++) { g.beginPath(); g.moveTo(16 + s * 30, my + m); g.lineTo(46 + s * 30, my); g.lineTo(62 + s * 30, my); g.lineTo(32 + s * 30, my + m); g.closePath(); g.fill(); } }
    else if (i === 3) { g.beginPath(); for (let s = 0; s < 8; s++) { const a = s / 8 * 6.283 - 1.571, r = s % 2 ? 16 : 50; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); g.fill(); }
    else if (i === 4) { g.lineWidth = 13; g.beginPath(); g.arc(cx, cy, 40, 0, 6.283); g.stroke(); g.beginPath(); g.arc(cx, cy, 15, 0, 6.283); g.fill(); }
    else { g.beginPath(); g.arc(cx, cy + 16, 34, Math.PI, 0); g.closePath(); g.fill(); g.lineWidth = 9; for (let s = 0; s < 7; s++) { const a = Math.PI + s / 6 * Math.PI; g.beginPath(); g.moveTo(cx + Math.cos(a) * 44, cy + 16 + Math.sin(a) * 44); g.lineTo(cx + Math.cos(a) * 60, cy + 16 + Math.sin(a) * 60); g.stroke(); } }
    // The line's name, spaced like stencilled lettering, fitted to the rest of the slot.
    const left = m + 34, room = 1024 - left - 14;
    let px = 80; g.font = font(800, px); (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '8px';
    const tw = g.measureText(name).width; if (tw > room) { px *= room / tw; g.font = font(800, px); }
    g.textBaseline = 'middle'; g.fillText(name, left, y + h / 2 + 4);
    g.restore();
    logo.push([0, 1 - (y + h) / 1024, 1, 1 - y / 1024]);
  });
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * 256, y = 768 + Math.floor(i / 4) * 64, owner = OWNER[i % OWNER.length], serial = String(100000 + Math.floor(hash(i, 3) * 899999)), check = Math.floor(hash(i, 5) * 10);
    g.save(); g.fillStyle = '#fff'; g.textBaseline = 'top'; g.font = font(700, 26); (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '3px';
    g.fillText(`${owner} ${serial}`, x + 10, y + 4); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(x + 214, y + 3, 30, 30); g.fillText(String(check), x + 221, y + 4);
    g.font = font(700, 20); g.fillText(i % 3 ? '22G1' : '45G1', x + 10, y + 36); g.restore();
    code.push([x / 1024, 1 - (y + 64) / 1024, (x + 256) / 1024, 1 - y / 1024]);
  }
  // Wear: paint lost in specks and scrapes, so the lettering reads as painted steel, not a sticker.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) { const x = hash(i, 11) * 1024, y = hash(i, 13) * 1024, r = .6 + hash(i, 17) * 2.4; g.globalAlpha = .4 + hash(i, 19) * .6; g.beginPath(); g.ellipse(x, y, r * (1 + hash(i, 23) * 3), r, hash(i, 29) * 3, 0, 6.283); g.fill(); }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
  return { tex, logo, code };
}

/** Diagonal yellow and black hazard bands, scuffed (world-mapped, one repeat per metre). */
function hazardTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = '#d9a21b'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#16171a';
  for (let s = -2; s < 3; s++) { g.beginPath(); g.moveTo(s * 64, 128); g.lineTo(s * 64 + 32, 128); g.lineTo(s * 64 + 160, 0); g.lineTo(s * 64 + 128, 0); g.closePath(); g.fill(); }
  for (let i = 0; i < 240; i++) { g.fillStyle = hash(i, 2) > .5 ? 'rgba(60,52,44,.35)' : 'rgba(200,190,170,.25)'; g.fillRect(hash(i, 3) * 128, hash(i, 5) * 128, 1 + hash(i, 7) * 6, 1 + hash(i, 9) * 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function portArt(lib: Library, m: CityMats, detail: number): PortArt {
  const atlas = decalAtlas(detail ? 1024 : 512), hz = hazardTexture();
  const decal = (color: string) => addLayers(new THREE.MeshStandardMaterial({ name: 'container-decal', map: atlas.tex, color, roughness: .5, metalness: 0, alphaTest: .45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'wet');
  const light = decal('#efece6'), dark = decal('#20262d');
  const hazard = addLayers(new THREE.MeshStandardMaterial({ name: 'hazard', map: hz, roughness: .62, metalness: 0 }), 'macro', 'wet');
  const paint = (tint: string, gain: number) => addLayers(surface(lib, 'concreteFloor', { tint, gain, rough: .55, normalScale: .45 }), 'macro', 'wet');
  // Containers weather like everything else in the street: grime at the foot, rain runs down them, they get wet.
  for (const key of ['container-red', 'container-blue', 'container-green', 'container-yellow']) addLayers(m.container(key), 'macro', 'grime', 'wet');
  return {
    light, dark, logo: atlas.logo, code: atlas.code, hazard, craneBlue: paint('#30506f', 1.15), craneGrey: paint('#9da3a8', 1.15),
    dispose: () => { atlas.tex.dispose(); hz.dispose(); light.dispose(); dark.dispose(); hazard.dispose(); },
  };
}

// ====================================================================================== containers
/** The side corrugation of a container `L` long: points [along, out] of its outer face (trapezoid ribs). */
function ribs(L: number): [number, number][] {
  const a0 = -L / 2 + .16, a1 = L / 2 - .16, n = Math.max(4, Math.round((a1 - a0) / .28)), s = (a1 - a0) / n, d = .036, pts: [number, number][] = [[a0, 0]];
  for (let i = 0; i < n; i++) { const a = a0 + i * s; pts.push([a + s * .18, d], [a + s * .5, d], [a + s * .68, 0], [a + s, 0]); }
  return pts;
}
const outAt = (pts: [number, number][], u: number) => {
  for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const [ua, oa] = pts[i - 1], [ub, ob] = pts[i]; return oa + (ob - oa) * ((u - ua) / Math.max(1e-6, ub - ua)); }
  return pts[pts.length - 1][1];
};
/** A strip of decal following the ribs between `u0` and `u1` (and `y0`…`y1`), `lift` off the paint. */
function ribDecal(pts: [number, number][], u0: number, u1: number, y0: number, y1: number, lift: number, uv: Rect) {
  const us = [u0, ...pts.map(p => p[0]).filter(u => u > u0 + 1e-4 && u < u1 - 1e-4), u1], pos: number[] = [], tex: number[] = [];
  const U = (u: number) => uv[0] + (u - u0) / (u1 - u0) * (uv[2] - uv[0]);
  for (let i = 0; i < us.length - 1; i++) {
    const ua = us[i], ub = us[i + 1], za = outAt(pts, ua) + lift, zb = outAt(pts, ub) + lift;
    pos.push(ua, y0, za, ub, y0, zb, ub, y1, zb, ua, y0, za, ub, y1, zb, ua, y1, za);
    tex.push(U(ua), uv[1], U(ub), uv[1], U(ub), uv[3], U(ua), uv[1], U(ub), uv[3], U(ua), uv[3]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(tex, 2)); g.computeVertexNormals();
  return g;
}
/** A flat decal facing +z, `w` × `h`, showing `uv`. */
function plate(w: number, h: number, uv: Rect) {
  const g = new THREE.PlaneGeometry(w, h), a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  return g;
}

/**
 * A shipping container fitted to its collision box: corrugated sides with the ribs facing out, a corrugated front
 * end, a door end with two leaves, four locking bars with their cam keepers and handles, roof, rails, corner posts and
 * castings; a line's logo along both sides and its owner code on the doors and a top corner.
 */
export function portContainer(b: CityBuilder, m: CityMats, art: PortArt, box: Box) {
  const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, alongX = x1 - x0 >= z1 - z0;
  const L = alongX ? x1 - x0 : z1 - z0, W = alongX ? z1 - z0 : x1 - x0, H = y1 - y0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const seed = hash(cx * 1.7 + y0 * 3.1, cz * 2.3), skin = m.container(box.mat), frame = m.containerFrame(box.mat), steel = m.darkSteel;
  // Which end the doors are at, from the box's own seed (stacks and rows do not all face one way).
  const toWorld = T(cx, y0, cz).multiply(RY((alongX ? 0 : Math.PI / 2) + (seed > .5 ? Math.PI : 0)));
  const P = (g: THREE.BufferGeometry, mat: THREE.Material, local: THREE.Matrix4, scale = 1.4, keepUV = false) => { b.add(g, mat, scale, toWorld.clone().multiply(local), false, keepUV); g.dispose(); };
  const B = (u0: number, v0: number, w0: number, u1: number, v1: number, w1: number, mat: THREE.Material, scale = 1) => P(new THREE.BoxGeometry(Math.max(1e-3, u1 - u0), Math.max(1e-3, v1 - v0), Math.max(1e-3, w1 - w0)), mat, T((u0 + u1) / 2, (v0 + v1) / 2, (w0 + w1) / 2), scale);
  // ---- sides: the rib profile extruded up the wall (rotated so the ribs face out), one per side.
  const pts = ribs(L), D = H - .26, shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]); for (const [u, o] of pts.slice(1)) shape.lineTo(u, o); shape.lineTo(L / 2 - .16, -.012); shape.lineTo(-L / 2 + .16, -.012);
  const side = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 1 }); side.rotateX(Math.PI / 2);
  const face = W / 2 - .045;
  for (const s of [1, -1]) P(side.clone(), skin, (s > 0 ? new THREE.Matrix4() : RY(Math.PI)).multiply(T(0, .13 + D, face)));
  side.dispose();
  // ---- front end (corrugated across), roof, floor edge.
  for (let k = 0; k < Math.max(3, Math.round((W - .3) / .3)); k++) { const w0 = -W / 2 + .15 + k * (W - .3) / Math.max(3, Math.round((W - .3) / .3)); B(-L / 2 + .03, .13, w0, -L / 2 + .07, H - .13, w0 + .14, skin, 1.4); }
  B(-L / 2 + .06, .13, -W / 2 + .1, -L / 2 + .09, H - .13, W / 2 - .1, skin, 1.4);
  B(-L / 2 + .1, H - .1, -W / 2 + .08, L / 2 - .1, H - .04, W / 2 - .08, skin, 1.4);
  // ---- door end: two leaves with stiffeners, four locking bars with cam keepers and handles, hinges.
  for (const s of [-1, 1]) {
    B(L / 2 - .07, .14, s > 0 ? .006 : -W / 2 + .09, L / 2 - .03, H - .14, s > 0 ? W / 2 - .09 : -.006, frame, 1.4);
    for (const v of [.55, 1.2, H - 1.1, H - .5]) B(L / 2 - .03, v, s > 0 ? .02 : -W / 2 + .1, L / 2 - .01, v + .05, s > 0 ? W / 2 - .1 : -.02, frame, 1);
    for (const v of [.4, H * .5, H - .4]) B(L / 2 - .05, v - .08, s * (W / 2 - .07) - .03, L / 2, v + .08, s * (W / 2 - .07) + .03, steel, 1);
    for (const w of [W * .13, W * .37]) {
      const z = s * w;
      P(new THREE.CylinderGeometry(.021, .021, H - .42, 8), steel, T(L / 2 + .02, H / 2, z), 1);
      for (const v of [.24, H - .24]) B(L / 2 - .01, v - .07, z - .05, L / 2 + .05, v + .07, z + .05, steel, 1);
      B(L / 2 + .01, H * .45, z - .02, L / 2 + .07, H * .45 + .05, z + .14 * s, steel, 1);
    }
  }
  // ---- frame: rails, posts, end beams and corner castings.
  for (const v of [.065, H - .065]) for (const w of [-W / 2 + .07, W / 2 - .07]) B(-L / 2, v - .065, w - .07, L / 2, v + .065, w + .07, frame, 1);
  // (Corner posts are wide enough to close over the ends of the corrugated sides.)
  for (const u of [-L / 2 + .09, L / 2 - .09]) for (const w of [-W / 2 + .07, W / 2 - .07]) B(u - .09, 0, w - .07, u + .09, H, w + .07, frame, 1);
  for (const u of [-L / 2 + .07, L / 2 - .07]) { for (const v of [.065, H - .065]) B(u - .06, v - .065, -W / 2, u + .06, v + .065, W / 2, frame, 1); }
  for (const u of [-L / 2 + .09, L / 2 - .09]) for (const v of [.09, H - .09]) for (const w of [-W / 2 + .09, W / 2 - .09]) B(u - .09, v - .09, w - .09, u + .09, v + .09, w + .09, steel, 1);
  // ---- markings: most boxes carry their line's logo along both sides; every box has its owner code.
  const pale = box.mat === 'container-yellow', ink = pale ? art.dark : art.light, brand = Math.floor(hash(seed, 7) * BRANDS.length), code = art.code[Math.floor(hash(seed, 9) * art.code.length)];
  if (hash(seed, 3) > .18) {
    const lw = Math.min(L * .62, 5.6), lh = lw / 8 * 1.05, v0 = H * (.42 + hash(seed, 4) * .12);
    for (const s of [1, -1]) P(ribDecal(pts, -lw / 2, lw / 2, v0, v0 + lh, .003, art.logo[brand]), ink, (s > 0 ? new THREE.Matrix4() : RY(Math.PI)).multiply(T(0, 0, face)), 1, true);
  }
  for (const s of [1, -1]) P(plate(.95, .24, code), ink, (s > 0 ? new THREE.Matrix4() : RY(Math.PI)).multiply(T(L / 2 - .78, H - .42, face + .04)), 1, true);
  P(plate(.95, .24, code), ink, T(L / 2 - .025, H - .8, -W / 4).multiply(RY(Math.PI / 2)), 1, true);
}

// ====================================================================================== the working port
/**
 * The port beyond the quay. `y` is the terminal's surface; returns the floodlight heads (for halos in wet or dark air).
 * Cranes stand on the far side of the basin with their booms out over the ship, so from the yard they read against
 * the low southern sky.
 */
export function buildPort(b: CityBuilder, m: CityMats, art: PortArt, bounds: number[], street: number, detail: number, glow: THREE.Material) {
  const bz1 = bounds[3], heads: THREE.Vector3[] = [];
  const far = (g: THREE.BufferGeometry, mat: THREE.Material, M: THREE.Matrix4, scale = 3, keepUV = false) => { b.add(g, mat, scale, M, false, keepUV, CHUNK_FAR); g.dispose(); };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material, scale = 3) => far(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), scale);
  const bar = (a: THREE.Vector3, c: THREE.Vector3, r: number, mat: THREE.Material, seg = 6) => {
    const len = a.distanceTo(c), g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    far(g, mat, new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1)), 1);
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const y = street - 1.2, zq = bz1 + 54;
  // ---- the far terminal: an apron a metre above the water, from the cranes' rails back to the stacks.
  box(-460, y - 2.4, zq - 4, 460, y, zq + 150, m.concrete, 6);
  // ---- ship-to-shore cranes.
  const crane = (x: number) => {
    const z0 = zq, z1 = zq + 16, top = y + 30.4, deck = top + 3;
    for (const lx of [x - 7.5, x + 7.5]) for (const lz of [z0, z1]) {
      box(lx - .55, y, lz - .55, lx + .55, y + 3.6, lz + .55, art.hazard, 1);                       // striped feet
      box(lx - .55, y + 3.6, lz - .55, lx + .55, top, lz + .55, art.craneBlue, 3);
    }
    for (const lx of [x - 7.5, x + 7.5]) {
      box(lx - .7, y + .9, z0 - 1.6, lx + .7, y + 2.1, z1 + 1.6, art.hazard, 1);                      // sill beams
      for (const lz of [z0, z1]) box(lx - .8, y, lz - 1.5, lx + .8, y + .9, lz + 1.5, m.darkSteel, 2); // bogies
      bar(V(lx, y + 15.6, z0), V(lx, top - 1.2, z1), .22, art.craneBlue); bar(V(lx, y + 15.6, z1), V(lx, top - 1.2, z0), .22, art.craneBlue);
    }
    for (const lz of [z0, z1]) {
      box(x - 8.1, y + 14, lz - .6, x + 8.1, y + 15.6, lz + .6, art.craneBlue, 3);                     // portal beams
      box(x - 8.1, top - 1.4, lz - .6, x + 8.1, top, lz + .6, art.craneBlue, 3);
      bar(V(x - 7.5, y + 15.6, lz), V(x - 2.5, top - 1.4, lz), .2, art.craneBlue); bar(V(x + 7.5, y + 15.6, lz), V(x + 2.5, top - 1.4, lz), .2, art.craneBlue);
    }
    // Boom (over the water, toward the yard) and back reach: two lattice girders.
    const zb0 = z0 - 32, zb1 = z1 + 18, panel = detail ? 3.2 : 6.4;
    for (const gx of [x - 2.1, x + 2.1]) {
      box(gx - .35, top, zb0, gx + .35, top + .7, zb1, art.craneBlue, 3);
      box(gx - .3, deck - .55, zb0 + 1.5, gx + .3, deck, zb1, art.craneBlue, 3);
      for (let z = zb0 + 1.5, k = 0; z < zb1 - .1; z += panel, k++) {
        bar(V(gx, top + .7, z), V(gx, deck - .55, z), .09, art.craneBlue, 5);
        if (detail) bar(V(gx, top + .7, k % 2 ? z : z + panel), V(gx, deck - .55, k % 2 ? z + panel : z), .08, art.craneBlue, 5);
      }
    }
    for (let z = zb0 + 2; z < zb1; z += 6.4) box(x - 2.1, top, z - .2, x + 2.1, top + .35, z + .2, art.craneGrey, 2);
    // A-frame apex and the stays that hold the boom.
    const apex = top + 19;
    for (const gx of [x - 2.1, x + 2.1]) {
      bar(V(gx, deck, z0), V(gx, apex, z0 + 6), .32, art.craneBlue, 8); bar(V(gx, deck, z1), V(gx, apex, z0 + 6), .32, art.craneBlue, 8);
      for (const zt of [zb0 + 2, zb0 + 14, z0 - 6]) bar(V(gx, apex - .4, z0 + 6), V(gx, deck, zt), .07, m.darkSteel, 4);
      bar(V(gx, apex - .4, z0 + 6), V(gx, deck, zb1 - 1), .07, m.darkSteel, 4);
    }
    box(x - 2.6, apex - .6, z0 + 5.2, x + 2.6, apex + .4, z0 + 6.8, art.craneBlue, 3);
    far(new THREE.BoxGeometry(.5, .5, .5), m.beacon, T(x, apex + .7, z0 + 6));
    // Machinery house on the back reach (the line's mark on its flanks), trolley, cab and a spreader on its ropes.
    box(x - 3.3, deck, z1 + 4, x + 3.3, deck + 4.2, z1 + 15, art.craneGrey, 3); box(x - 3.4, deck + 4.2, z1 + 3.8, x + 3.4, deck + 4.5, z1 + 15.2, m.darkSteel, 2);
    for (const s of [-1, 1]) far(plate(9, 1.1, art.logo[0]), art.light, T(x + s * 3.32, deck + 2.6, z1 + 9.5).multiply(RY(s * Math.PI / 2)), 1, true);
    const tz = z0 - 9;
    box(x - 2.8, top + .7, tz - 2, x + 2.8, top + 2.2, tz + 2, m.darkSteel, 2);
    box(x - 1.1, top - 2.6, tz - 1.4, x + 1.1, top, tz + 1.4, art.craneGrey, 2); box(x - 1.12, top - 2.2, tz - 1.42, x + 1.12, top - .6, tz - 1.3, m.glassDark, 2);
    const hook = y + 24 + hash(x, 3) * 3;                                                          // clear of the ship's stacks
    for (const s of [-1, 1]) for (const t of [-1, 1]) bar(V(x + s * .8, top, tz + t * 1.4), V(x + s * 1.1, hook + .5, tz + t * 2.2), .03, m.darkSteel, 4);
    box(x - 1.3, hook - .4, tz - 6, x + 1.3, hook + .5, tz + 6, m.yellow, 2);
    // Floodlights under the girders.
    for (const z of [zb0 + 4, z0 - 16, z0 + 8]) for (const gx of [x - 2.1, x + 2.1]) { box(gx - .3, top - .35, z - .25, gx + .3, top, z + .25, glow, 1); heads.push(V(gx, top - .5, z)); }
  };
  for (const x of [-38, 4, 46]) crane(x);
  // ---- the stacks on the terminal: rows of boxes two to five high, gaps where blocks were taken down, under
  // rubber-tyred gantries.
  const keys = ['container-red', 'container-blue', 'container-green', 'container-yellow', 'container-blue', 'container-red'];
  const zs = zq + 30, rows = 6, gap = 2.75;
  for (let blk = 0; blk < 2; blk++) for (let r = 0; r < rows; r++) for (let i = -13; i <= 13; i++) {
    const xc = i * 12.9 + (blk ? 6 : 0), zc = zs + blk * 24 + r * gap, n = hash(i * 7 + r, blk + 3) < .12 ? 0 : 1 + Math.floor(hash(i, r + blk * 11) * 4);
    for (let k = 0; k < n; k++) box(xc - 6.05, y + k * 2.6, zc - 1.22, xc + 6.05, y + (k + 1) * 2.6 - .03, zc + 1.22, m.container(keys[Math.floor(hash(i * 3 + k, r * 5 + blk) * keys.length)]), 2);
  }
  for (let blk = 0; blk < 2; blk++) for (const gx of [-71, 13, 97]) {
    const za = zs + blk * 24 - 2.4, zb = zs + blk * 24 + (rows - 1) * gap + 2.4, top = y + 18;
    for (const ox of [-3.2, 3.2]) { for (const z of [za, zb]) box(gx + ox - .4, y + 1.1, z - .4, gx + ox + .4, top, z + .4, m.yellow, 2); box(gx + ox - .5, y, za - 1, gx + ox + .5, y + 1.1, zb + 1, art.hazard, 1); }
    for (const z of [za, zb]) box(gx - 3.8, top - 1.2, z - .5, gx + 3.8, top, z + .5, m.yellow, 2);
    box(gx - 3.6, top, za, gx - 2.6, top + .9, zb, m.yellow, 2); box(gx + 2.6, top, za, gx + 3.6, top + .9, zb, m.yellow, 2);
  }
  // ---- floodlight masts: on the quay apron in front of the site and among the stacks.
  const mast = (x: number, z: number, h: number, facing: number) => {
    far(new THREE.CylinderGeometry(.22, .42, h, 10), m.steel, T(x, y + h / 2, z), 2);
    box(x - 1.8, y + h, z - .3, x + 1.8, y + h + .25, z + .3, m.darkSteel, 1);
    for (const o of [-1.4, -.5, .5, 1.4]) { box(x + o - .28, y + h + .25, z - .2, x + o + .28, y + h + .7, z + .2, m.darkSteel, 1); box(x + o - .24, y + h + .3, z + facing * .21, x + o + .24, y + h + .65, z + facing * .23, glow, 1); heads.push(V(x + o, y + h + .45, z + facing * .5)); }
  };
  for (const x of [-56, -30, 30, 56]) mast(x, bz1 + 4.6, 24 + 1.2, -1);
  for (const x of [-120, -64, 64, 120]) mast(x, zq + 22, 30, -1);
  for (let x = -150; x <= 150; x += 50) mast(x, zs + 24 + rows * gap + 6, 30, -1);
  return heads;
}
