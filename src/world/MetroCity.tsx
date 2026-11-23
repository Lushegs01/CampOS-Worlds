// Metropolitan City: building architecture, the entrance gantry, expressway infrastructure and street dressing.
//
// Every building in shared/metro.mjs is drawn twice: a merged low-detail shell per 160 m cell (always present
// south of the campus, so the skyline reads from the expressway) and full architecture built when the player
// comes within range. Detail is built incrementally over frames (Kit.buildSteps), one cell at a time, and released
// on departure; collision never depends on it (the shared colliders are boxes). Roads, kerbs, sidewalks and street
// lights come from the shared road network (src/world/Expansion.tsx); the freight yard and Harbour Exchange have
// their own renderers.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { METRO_BUILDINGS, METRO_PARKED, METRO_PLANTERS, METRO_ROWS, METRO_COLS, EXPRESSWAY, SAFEHOUSE_PLOT, inMetro } from '../../shared/metro.mjs';
import { player, useGame } from '../state';
import { Kit, rng, windowUnit, hipRoof, flatRoof, waterTank, acUnit, door, railing, downpipe, wall, type V3 } from './architecture/kit';
import { sign } from './architecture/signage';
import { buildVehicleModel } from './vehicleModels';
import type { Materials, MaterialKey } from './materials';

type B = typeof METRO_BUILDINGS[number];
const CELL = 160;
const cellOf = (x: number, z: number) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
const CELLS = (() => {
  const m = new Map<string, { key: string; x: number; z: number; buildings: B[] }>();
  for (const b of METRO_BUILDINGS) {
    const key = cellOf(b.x, b.z);
    if (!m.has(key)) { const [i, k] = key.split(',').map(Number); m.set(key, { key, x: (i + .5) * CELL, z: (k + .5) * CELL, buildings: [] }); }
    m.get(key)!.buildings.push(b);
  }
  return [...m.values()];
})();

// Facade palettes (multiplied over the stucco scan through vertex colour). A warm West African city palette:
// sandstone, laterite terracotta, ochre and limestone downtown with the odd sage or slate accent; pastel stucco in
// the residential streets; crisp whites and civic blues in the Security District. Colour comes from the materials
// themselves, never from saturated paint on everything.
const WALLS: Record<string, string[]> = {
  downtown: ['#dccdb4', '#c99470', '#e4d7bf', '#b9c3bd', '#d9ad74', '#a9b7c4', '#cfb79a', '#e8e0cf'],
  residential: ['#efe1c8', '#e7c9a5', '#d9e0d0', '#f1d9cf', '#e8dcc0', '#cfd8db', '#f0cfa8', '#dbe6dc'],
  security: ['#e6e8e7', '#c9d3da', '#e4e1da'],
  entrance: ['#e2ddd2', '#d7b48a', '#c9c2b4', '#bfcdc2'],
  outskirts: ['#d6cdb9', '#c9a983', '#c3b8a2'],
};
// Curtain-wall tints: blue-green, bronze, silver-blue and deep teal, not one grey-black.
const GLASS = ['#1f3a44', '#3a3128', '#3d5266', '#18393a', '#2c3f52', '#42484c'];
const ACCENT = ['#2f4b6e', '#9a3f2a', '#2f5a46', '#5b4a7a', '#b0762a', '#1f6b6b'];

/** Runs `fn` in each facade frame of a building: facade along +X (length L), outer face at z = 0. */
function faces(kit: Kit, b: { x: number; z: number; w: number; d: number }, fn: (L: number, side: 'front' | 'back' | 'left' | 'right') => void, front = 1) {
  const sides: [V3, number, number, 'front' | 'back' | 'left' | 'right'][] = [
    [[b.x, 0, b.z + b.d / 2], 0, b.w, front > 0 ? 'front' : 'back'], [[b.x, 0, b.z - b.d / 2], Math.PI, b.w, front > 0 ? 'back' : 'front'],
    [[b.x + b.w / 2, 0, b.z], Math.PI / 2, b.d, 'right'], [[b.x - b.w / 2, 0, b.z], -Math.PI / 2, b.d, 'left'],
  ];
  for (const [p, r, L, side] of sides) kit.within(p, r, () => fn(L, side));
}

/** Curtain wall / punched grid: recessed glazing behind floor spandrels and piers. */
function grid(kit: Kit, L: number, y0: number, y1: number, o: { floor: number; bay: number; pier: MaterialKey; pierW: number; band: number; color?: string; glass?: string; depth?: number; seed: number }) {
  const r = rng(o.seed), depth = o.depth ?? .34;
  const bays = Math.max(1, Math.round(L / o.bay)), bw = L / bays, floors = Math.max(1, Math.round((y1 - y0) / o.floor)), fh = (y1 - y0) / floors;
  // Glazing one plane per floor (blinds, lit offices and reflections vary floor to floor).
  for (let f = 0; f < floors; f++) {
    const shade = r() < .12 ? '#b8a78a' : o.glass ?? GLASS[Math.floor(r() * GLASS.length)];
    kit.add('glass', new THREE.PlaneGeometry(L, fh), { matrix: new THREE.Matrix4().makeTranslation(0, y0 + fh * (f + .5), -depth), color: shade, shadow: false });
    kit.box(o.pier, [0, y0 + fh * f + o.band / 2, -depth / 2], [L, o.band, depth], { color: o.color });
  }
  kit.box(o.pier, [0, y1 - o.band / 4, -depth / 2], [L, o.band / 2, depth], { color: o.color });
  for (let i = 0; i <= bays; i++) kit.box(o.pier, [-L / 2 + i * bw, (y0 + y1) / 2, -depth / 2], [i === 0 || i === bays ? o.pierW * 1.6 : o.pierW, y1 - y0, depth + .02], { color: o.color });
}

/** Ground-floor shopfront: glazing, a door, a canopy and a fascia band. */
function shopfront(kit: Kit, L: number, h: number, o: { door?: number; canopy?: MaterialKey; frame?: MaterialKey; seed: number }) {
  const frame = o.frame ?? 'darkMetal';
  kit.add('glassClear', new THREE.PlaneGeometry(L - .6, h - .5), { matrix: new THREE.Matrix4().makeTranslation(0, (h - .5) / 2 + .25, -.4), shadow: false });
  for (let x = -L / 2 + .3; x <= L / 2 - .3 + 1e-3; x += Math.max(2.4, (L - .6) / Math.max(1, Math.round((L - .6) / 3)))) kit.box(frame, [x, h / 2, -.36], [.09, h, .1]);
  kit.box(frame, [0, .12, -.36], [L - .5, .24, .14]).box(frame, [0, h - .2, -.36], [L - .5, .12, .12]);
  door(kit, o.door ?? 0, 1.9, 2.5, .42, frame);
  if (o.canopy) { kit.box(o.canopy, [0, h + .12, .9], [L - .4, .14, 1.9]); for (const s of [-1, 1]) kit.box('darkMetal', [s * (L / 2 - .6), h - .2, 1.6], [.06, .7, .06], { rotX: .5 }); }
}

function roofTop(kit: Kit, b: B, y: number, r: () => number) {
  flatRoof(kit, b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, y, { parapet: .9, mat: 'concrete' });
  const top = y + .35;
  // Plant room, condensers and the ubiquitous rooftop water tanks.
  const pw = Math.min(b.w * .4, 9), pd = Math.min(b.d * .4, 7), px = b.x + (r() - .5) * (b.w - pw) * .5, pz = b.z + (r() - .5) * (b.d - pd) * .5;
  kit.box('concrete', [px, top + 1.5, pz], [pw, 3, pd], { color: '#d7d2c8' });
  kit.box('steel', [px, top + 3.05, pz], [pw + .3, .1, pd + .3]);
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) waterTank(kit, b.x + (r() - .5) * (b.w - 3), top, b.z + (r() - .5) * (b.d - 3), ['#2a3a4a', '#2f3b33', '#22313a'][i % 3], .9);
  kit.within([b.x - b.w / 2 + 2, top, b.z + b.d / 2 - 2.5], 0, () => { for (let i = 0; i < Math.min(5, b.w / 4); i++) kit.box('paintWhite', [i * 1.3, .32, 0], [.95, .64, .7]); });
}

function tower(kit: Kit, b: B, signs: THREE.Object3D[]) {
  const r = rng(Math.floor(b.x * 31 + b.z * 17) % 2147483646 + 1);
  const podium = 5.2, styles: { pier: MaterialKey; color?: string; bay: number; pierW: number; band: number; floor: number }[] = [
    { pier: 'brushed', bay: 1.5, pierW: .12, band: .28, floor: 3.6 },           // glass curtain wall
    { pier: 'granite', bay: 3.0, pierW: .7, band: 1.0, floor: 3.6 },            // stone grid, punched glazing
    { pier: 'stuccoTint', color: WALLS.downtown[Math.floor(r() * WALLS.downtown.length)], bay: 2.4, pierW: .5, band: .9, floor: 3.4 }, // concrete frame
    { pier: 'aluminium', bay: 1.2, pierW: .08, band: .55, floor: 3.8 },          // ribbon glazing
  ];
  const s = styles[b.style % styles.length];
  // Tall towers set back above two-thirds of their height (a narrower crown).
  const setback = b.h > 55 ? b.h * .68 : b.h;
  const upper = { x: b.x, z: b.z, w: b.w * .78, d: b.d * .78 };
  faces(kit, b, (L, side) => {
    kit.box('granite', [0, podium / 2, -.25], [L + .02, podium, .5], { shadow: false });
    if (side === 'front') shopfront(kit, L - 2, podium - .9, { canopy: 'brushed', seed: b.x, frame: 'bronzeFrame' });
    else for (let x = -L / 2 + 3; x < L / 2 - 2; x += 6) windowUnit(kit, { x0: x, x1: x + 3.2, y0: 1, y1: 3.8 }, { seed: x, frame: 'darkMetal' });
    grid(kit, L, podium, setback, { ...s, seed: Math.floor(L * 13 + b.x), glass: s.pier === 'brushed' ? GLASS[b.style % GLASS.length] : undefined });
  }, b.front);
  kit.box('concrete', [b.x, podium - .1, b.z], [b.w - .6, .2, b.d - .6], { shadow: false });
  if (setback < b.h) {
    flatRoof(kit, b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, setback, { parapet: 1.1, mat: 'concrete' });
    faces(kit, upper, L => grid(kit, L, setback + .35, b.h, { ...s, seed: Math.floor(L * 7 + b.z) }), b.front);
    roofTop(kit, { ...b, ...upper }, b.h, r);
    kit.cylinder('steel', [b.x, b.h + 3.4, b.z], .12, .25, 9, 8);
    kit.box('emissiveWarm', [b.x, b.h + 12.6, b.z], [.3, .3, .3], { shadow: false });
  } else roofTop(kit, b, b.h, r);
  // Name on the podium fascia, facing the street.
  const board = sign({ text: (b.name ?? 'Tower').toUpperCase(), kind: 'letters', width: Math.min(b.w * .6, 14), height: .9, color: '#e7d8b8', tracking: .1 });
  board.position.set(b.x, podium + .2, b.z + b.front * (b.d / 2 + .06)); board.rotation.y = b.front > 0 ? 0 : Math.PI; signs.push(board);
}

function house(kit: Kit, b: B, signs: THREE.Object3D[]) {
  const r = rng(Math.floor(b.x * 13 + b.z * 7) % 2147483646 + 1), color = WALLS.residential[Math.floor(r() * WALLS.residential.length)], storeys = b.h > 7 ? 2 : 1, top = storeys * 2.9 + .4;
  const shop = b.kind === 'shop';
  faces(kit, b, (L, side) => {
    const front = side === 'front', openings: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (let f = 0; f < storeys; f++) for (let x = -L / 2 + 1.4; x < L / 2 - 2.2; x += 3.1) {
      if (front && f === 0 && Math.abs(x + 1) < 2.2) continue;
      if (r() < .25 && !front) continue;
      openings.push({ x0: x, x1: x + 1.3, y0: .95 + f * 2.9, y1: 2.25 + f * 2.9 });
    }
    if (front) openings.push(shop ? { x0: -L / 2 + .6, x1: L / 2 - .6, y0: 0, y1: 2.9 } : { x0: -1.6, x1: -.5, y0: 0, y1: 2.2 });
    wall(kit, 'stuccoTint', -L / 2, L / 2, 0, top, .22, openings);
    for (const o of openings) {
      if (o.y0 === 0 && !shop) { kit.box('wood', [(o.x0 + o.x1) / 2, 1.1, -.12], [o.x1 - o.x0, 2.2, .06], { color: '#6a4a33' }); continue; }
      if (o.y0 === 0) continue;
      windowUnit(kit, o, { seed: o.x0 + b.x, frame: r() < .5 ? 'aluminium' : 'paintWhite', recess: .1 });
      // Burglar-proof bars over ground-floor windows.
      if (o.y0 < 2) for (let x = o.x0 + .15; x < o.x1; x += .22) kit.box('darkMetal', [x, (o.y0 + o.y1) / 2, .04], [.02, o.y1 - o.y0, .02], { shadow: false });
    }
    if (shop && front) {
      shopfront(kit, L - 1.2, 2.9, { seed: b.x, door: 1, canopy: 'fabricShade' });
      const board = sign({ text: ['MAMA T PROVISIONS', 'CORNER CHEMIST', 'QUICK PRINT', 'BLESSED BARBERS', 'FRESH BREAD', 'MOBILE REPAIRS'][Math.floor(r() * 6)], kind: 'panel', width: Math.min(L - 1.6, 6), height: .55, background: ACCENT[Math.floor(r() * ACCENT.length)], color: '#f6eedc', tracking: .06 });
      signs.push(kit.place(board, [0, 3.35, .06]));
    }
    if (front && !shop) {
      kit.box('concrete', [-1.05, .08, .9], [2.6, .16, 1.6]);
      for (const x of [-2.2, .1]) kit.box('paintWhite', [x, 1.35, 1.5], [.18, 2.6, .18]);
      kit.box('concrete', [-1.05, 2.72, .9], [3, .16, 2]);
    }
    if (r() < .5) acUnit(kit, L / 2 - 1.4, 2.2);
    downpipe(kit, -L / 2 + .25, top);
  }, b.front);
  kit.box('stuccoTint', [b.x, top / 2, b.z], [b.w - .5, top - .2, b.d - .5], { color, shadow: false });
  if (r() < .7) hipRoof(kit, r() < .5 ? 'roofRed' : 'roofGreen', b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, top, .3 + r() * .12, .6);
  else { flatRoof(kit, b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, top, { parapet: .6, mat: 'concrete' }); waterTank(kit, b.x + 1, top + .35, b.z - 1); }
  // Compound wall and gate along the frontage.
  kit.within([b.x, 0, b.z + b.front * (b.d / 2 + 3.2)], b.front > 0 ? 0 : Math.PI, () => {
    for (const s of [-1, 1]) kit.box('stuccoTint', [s * (b.w / 2 + .6), .55, 0], [b.w / 2 - 1.6, 1.1, .2], { color });
    kit.box('darkMetal', [b.w / 4, .9, 0], [2.8, 1.8, .06], { color: '#2b3330' });
  });
  void color;
  return color;
}

function apartment(kit: Kit, b: B, signs: THREE.Object3D[]) {
  const r = rng(Math.floor(b.x * 5 + b.z * 3) % 2147483646 + 1), color = WALLS.residential[Math.floor(r() * 6)];
  faces(kit, b, (L, side) => {
    grid(kit, L, 0, b.h, { pier: 'stuccoTint', color, bay: 3.2, pierW: 1.3, band: 1.5, floor: 3.2, seed: Math.floor(L * 9 + b.x), depth: .3 });
    if (side === 'front') for (let y = 3.2; y < b.h - 1; y += 3.2) for (let x = -L / 2 + 3; x < L / 2 - 3; x += 6.4) {
      kit.box('concrete', [x + 1.6, y, .6], [3.4, .16, 1.2]); railing(kit, x, x + 3.2, y + .08, 1.15, 1, 'paintDark');
    }
  }, b.front);
  kit.box('stuccoTint', [b.x, b.h / 2, b.z], [b.w - .7, b.h - .2, b.d - .7], { color, shadow: false });
  roofTop(kit, b, b.h, r);
  const board = sign({ text: (b.name ?? 'Court').toUpperCase(), kind: 'panel', width: 5, height: .6, background: '#2e3a36', color: '#efe6d2', tracking: .07 });
  board.position.set(b.x, 3.3, b.z + b.front * (b.d / 2 + .05)); board.rotation.y = b.front > 0 ? 0 : Math.PI; signs.push(board);
}

function shed(kit: Kit, b: B, signs: THREE.Object3D[]) {
  const r = rng(Math.floor(b.x * 3 + b.z) % 2147483646 + 1), color = (WALLS[b.district] ?? WALLS.entrance)[Math.floor(r() * 2)];
  const hotel = b.name?.includes('Motel');
  faces(kit, b, (L, side) => {
    if (side === 'front') {
      const openings: { x0: number; x1: number; y0: number; y1: number }[] = [];
      if (hotel) for (let x = -L / 2 + 1.5; x < L / 2 - 2; x += 3.6) openings.push({ x0: x, x1: x + 1.3, y0: .9, y1: 2.2 }, { x0: x + 1.7, x1: x + 2.7, y0: 0, y1: 2.2 });
      else { for (let x = -L / 2 + 3; x < L / 2 - 6; x += 9) openings.push({ x0: x, x1: x + 5, y0: 0, y1: Math.min(5, b.h - 2) }); openings.push({ x0: L / 2 - 4, x1: L / 2 - 2.2, y0: 0, y1: 2.3 }); }
      wall(kit, hotel ? 'stuccoTint' : 'ribbed', -L / 2, L / 2, 0, b.h, .25, openings);
      for (const o of openings) {
        if (o.y0 > 0) { windowUnit(kit, o, { seed: o.x0, recess: .1 }); continue; }
        if (o.x1 - o.x0 > 3) { kit.box('ribbed', [(o.x0 + o.x1) / 2, (o.y1) / 2, -.2], [o.x1 - o.x0, o.y1, .08], { color: '#7d8a8c' }); kit.box('darkMetal', [(o.x0 + o.x1) / 2, o.y1 + .2, -.05], [o.x1 - o.x0 + .3, .4, .3]); }
        else kit.box('paintDark', [(o.x0 + o.x1) / 2, o.y1 / 2, -.15], [o.x1 - o.x0, o.y1, .06]);
      }
      if (hotel) { kit.box('concrete', [0, 2.95, 1.2], [L, .16, 2.4]); railing(kit, -L / 2, L / 2, 3.03, 2.35, 1); }
    } else wall(kit, hotel ? 'stuccoTint' : 'ribbed', -L / 2, L / 2, 0, b.h, .25, []);
  }, b.front);
  kit.box('stuccoTint', [b.x, b.h / 2, b.z], [b.w - .6, b.h - .1, b.d - .6], { color, shadow: false });
  hipRoof(kit, 'roofGreen', b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, b.h, .12, .5, 'paintDark');
  const board = sign({ text: (b.name ?? 'Depot').toUpperCase(), kind: 'panel', width: Math.min(b.w * .5, 10), height: .9, background: ACCENT[b.style % 4], color: '#f3ead6', tracking: .08 });
  board.position.set(b.x, Math.min(b.h - 1, 6.2), b.z + b.front * (b.d / 2 + .08)); board.rotation.y = b.front > 0 ? 0 : Math.PI; signs.push(board);
}

function civic(kit: Kit, b: B, signs: THREE.Object3D[], kind: string) {
  const r = rng(Math.floor(b.x * 11 + b.z * 2) % 2147483646 + 1);
  const police = kind === 'police', mall = kind === 'mall', carpark = kind === 'carpark', security = kind === 'security';
  const color = police || security ? WALLS.security[Math.floor(r() * 3)] : '#ddd6c8';
  if (carpark) {
    for (let y = 0; y <= b.h; y += 3) {
      kit.box('concrete', [b.x, y + .15, b.z], [b.w, .3, b.d], { color: '#cfcac0' });
      if (y > 0) faces(kit, b, L => kit.box('concrete', [0, y + .65, -.15], [L, .7, .3]));
    }
    for (let x = b.x - b.w / 2 + 1; x <= b.x + b.w / 2 - 1; x += 7.5) for (const z of [b.z - b.d / 2 + 1, b.z, b.z + b.d / 2 - 1]) kit.box('concrete', [x, b.h / 2, z], [.6, b.h, .6]);
    kit.box('stuccoTint', [b.x + b.w / 2 - 4, b.h / 2 + 1, b.z - b.d / 2 + 4], [6, b.h + 2, 6], { color: '#b8b1a4' });
  } else {
    faces(kit, b, (L, side) => {
      const front = side === 'front';
      if (mall && front) { kit.add('glass', new THREE.PlaneGeometry(L - 2, b.h - 1.5), { matrix: new THREE.Matrix4().makeTranslation(0, (b.h - 1.5) / 2 + .2, -.5), color: '#3a5058', shadow: false }); for (let x = -L / 2 + 1; x <= L / 2 - 1; x += 4) kit.box('brushed', [x, b.h / 2, -.3], [.25, b.h, .4]); shopfront(kit, 16, 4.2, { canopy: 'brushed', seed: 3 }); return; }
      grid(kit, L, front ? 4.5 : 0, b.h, { pier: police || security ? 'stuccoTint' : 'granite', color, bay: 3.4, pierW: 1.1, band: 1.2, floor: 3.6, seed: Math.floor(L * 3 + b.z) });
      if (front) {
        kit.box(police || security ? 'stuccoTint' : 'granite', [0, 2.25, -.25], [L, 4.5, .5], { color, shadow: false });
        shopfront(kit, Math.min(L - 4, 14), 3.6, { canopy: 'brushed', seed: 7, frame: 'aluminium' });
        if (police) kit.box('stuccoTint', [0, 4.7, .05], [L + .1, .55, .2], { color: '#28487a' });
        if (kind === 'civic') for (let x = -L / 2 + 2; x <= L / 2 - 2; x += 3.2) kit.cylinder('granite', [x, 0, 2.2], .45, .5, b.h - 2, 14);
      }
    }, b.front);
    kit.box('stuccoTint', [b.x, b.h / 2, b.z], [b.w - .8, b.h - .2, b.d - .8], { color, shadow: false });
    roofTop(kit, b, b.h, r);
    if (kind === 'civic') kit.box('granite', [b.x, b.h - 1, b.z + b.front * (b.d / 2 + 2.2)], [b.w - 2, 1.6, 4.6]);
  }
  if (police) {
    // Flagpoles, a radio mast and the forecourt bollards.
    for (const s of [-1, 1]) for (const k of [0, 1.6]) kit.cylinder('aluminium', [b.x + s * (b.w / 2 + 2.5 + k), 0, b.z + b.front * (b.d / 2 + 3)], .05, .07, 9, 8);
    kit.cylinder('steel', [b.x + b.w / 2 - 4, b.h, b.z - b.d / 2 + 4], .15, .4, 18, 6);
    // Marked bays of the motor pool in front of the station.
    for (let i = 0; i <= 6; i++) kit.box('lineWhite', [b.x - 33.6 + i * 11.2, .1, b.z + b.front * (b.d / 2 + 6.6)], [.12, .02, 5], { shadow: false });
  }
  if (security) {
    // Perimeter fence with a guard booth.
    kit.within([b.x, 0, b.z + b.front * (b.d / 2 + 6)], b.front > 0 ? 0 : Math.PI, () => {
      for (let x = -b.w / 2 - 4; x <= b.w / 2 + 4; x += 2.5) kit.box('steel', [x, 1.2, 0], [.06, 2.4, .06]);
      kit.box('steel', [0, 2.35, 0], [b.w + 8, .05, .05]).box('steel', [0, 1.2, 0], [b.w + 8, .04, .04]);
      kit.box('stuccoTint', [b.w / 2 + 2, 1.3, 1.6], [2.4, 2.6, 2.4], { color: '#e5e2da' });
    });
  }
  const board = sign({ text: (b.name ?? '').toUpperCase(), kind: police ? 'panel' : 'letters', width: Math.min(b.w * .55, 16), height: police ? 1 : .95, background: '#1f3559', color: police ? '#ffffff' : '#e8d9b8', tracking: .1 });
  board.position.set(b.x, police ? 5.5 : carpark ? b.h - 1 : Math.min(b.h - 1.2, 5.6), b.z + b.front * (b.d / 2 + .12)); board.rotation.y = b.front > 0 ? 0 : Math.PI; signs.push(board);
}

function fuel(kit: Kit, b: B, signs: THREE.Object3D[]) {
  kit.box('stuccoTint', [b.x, b.h / 2, b.z], [b.w, b.h, b.d], { color: '#e8e3d8' });
  faces(kit, b, (L, side) => { if (side === 'front') shopfront(kit, L - 2, 3.4, { seed: 2 }); });
  flatRoof(kit, b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, b.h, { parapet: .5 });
  const cz = b.z + b.front * (b.d / 2 + 9);
  kit.box('paintWhite', [b.x, 5.4, cz], [22, .7, 11]);
  kit.box('stuccoTint', [b.x, 5.05, cz], [22.2, .22, 11.2], { color: '#c8402e' });
  for (const dx of [-7, 0, 7]) { kit.cylinder('paintWhite', [b.x + dx, 0, cz], .25, .25, 5.1, 10); kit.box('concrete', [b.x + dx, .1, cz], [1.4, .2, 3.6]); kit.box('paintDark', [b.x + dx, .9, cz + 1], [.7, 1.6, .5]); kit.box('paintDark', [b.x + dx, .9, cz - 1], [.7, 1.6, .5]); }
  const board = sign({ text: 'SUNLINE FUEL', kind: 'panel', width: 6, height: .7, background: '#c8402e', color: '#fff6e5', tracking: .08 });
  board.position.set(b.x, 5.4, cz + 5.62); signs.push(board);
}

function safehouse(kit: Kit, signs: THREE.Object3D[]) {
  const b = { ...SAFEHOUSE_PLOT, front: 1 } as B;
  faces(kit, b, (L, side) => {
    const openings = side === 'front' ? [{ x0: -L / 2 + 1.2, x1: -L / 2 + 6.2, y0: 0, y1: 3.4 }, { x0: L / 2 - 2.4, x1: L / 2 - 1.3, y0: 0, y1: 2.2 }] : [];
    wall(kit, 'stuccoTint', -L / 2, L / 2, 0, b.h, .22, openings);
    if (side === 'front') {
      // A roller shutter half open over the lock-up (the handover point is in front of it).
      kit.box('ribbed', [-L / 2 + 3.7, 2.6, -.15], [5, 1.6, .08], { color: '#6f7a78' });
      kit.box('paintDark', [L / 2 - 1.85, 1.1, -.12], [1.1, 2.2, .06]);
      kit.box('emissiveWarm', [-L / 2 + 3.7, 3.55, .12], [.5, .12, .2], { shadow: false });
    }
  }, 1);
  kit.box('stuccoTint', [b.x, b.h / 2, b.z], [b.w - .5, b.h - .1, b.d - .5], { color: '#b9ae9c', shadow: false });
  flatRoof(kit, b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, b.h, { parapet: .5 });
  kit.box('concrete', [b.x, .05, b.z + b.d / 2 + 3.4], [b.w, .1, 6.6]);
  const board = sign({ text: '14 BAOBAB CLOSE', kind: 'panel', width: 2.6, height: .4, background: '#2c2f2c', color: '#efe7d3', tracking: .05 });
  board.position.set(b.x + b.w / 2 - 1.85, 2.6, b.z + b.d / 2 + .05); signs.push(board);
}

/** Paving, plazas, planters and lawns within the cell. */
function grounds(kit: Kit, list: B[]) {
  for (const b of list) {
    if (b.district === 'downtown' || b.district === 'security' || b.kind === 'mall') {
      kit.box('paversGrey', [b.x, .045, b.z + b.front * 2], [b.w + 8, .09, b.d + 6], { shadow: false });
      // Planters with street trees in the gaps between buildings (the trees themselves are shared vegetation).
      for (const p of METRO_PLANTERS) if (Math.abs(p.x - b.x) < b.w / 2 + 2.2 && Math.abs(p.z - b.z) < b.d / 2 + 1) {
        kit.box('concrete', [p.x, .3, p.z], [1.7, .5, 1.7], { color: '#cfc6b6' }); kit.box('soil', [p.x, .56, p.z], [1.4, .04, 1.4], { shadow: false });
      }
    } else if (b.kind === 'house' || b.kind === 'shop') {
      kit.box('concrete', [b.x + b.w / 2 + 1.6, .03, b.z + b.front * (b.d / 2 + 1.5)], [2.8, .06, 3.2], { shadow: false });
    } else if (b.kind === 'shed' || b.kind === 'fuel' || b.kind === 'apartment') {
      kit.box('asphalt', [b.x, .025, b.z + b.front * (b.d / 2 + 6)], [b.w + 10, .05, 12], { shadow: false });
    }
  }
}

function buildCell(list: B[], lib: Materials, withSafehouse: boolean) {
  const kit = new Kit(), signs: THREE.Object3D[] = [];
  grounds(kit, list);
  for (const b of list) {
    if (b.kind === 'tower') tower(kit, b, signs);
    else if (b.kind === 'house' || b.kind === 'shop') house(kit, b, signs);
    else if (b.kind === 'apartment') apartment(kit, b, signs);
    else if (b.kind === 'shed') shed(kit, b, signs);
    else if (b.kind === 'fuel') fuel(kit, b, signs);
    else civic(kit, b, signs, b.kind);
  }
  if (withSafehouse) safehouse(kit, signs);
  return { steps: kit.buildSteps(lib, 'metro:detail'), signs };
}

function buildFar(lib: Materials) {
  const groups = new Map<string, THREE.Group>();
  for (const c of CELLS) {
    const kit = new Kit();
    for (const b of c.buildings) {
      const tall = b.kind === 'tower', wall = (WALLS[b.district] ?? WALLS.entrance)[(b.style + Math.round(b.x)) % (WALLS[b.district] ?? WALLS.entrance).length];
      kit.box(tall ? 'glass' : 'stuccoTint', [b.x, b.h / 2, b.z], [b.w, b.h, b.d], { color: tall ? GLASS[(b.style + Math.round(b.z)) % GLASS.length] : wall, shadow: false });
      if (tall) {
        // Stone podium, floor spandrels every few storeys and a crown: the skyline reads as architecture.
        kit.box('granite', [b.x, 2.6, b.z], [b.w + .3, 5.2, b.d + .3], { color: wall, shadow: false });
        for (let y = 9; y < b.h - 2; y += b.style % 2 ? 7.2 : 10.8) kit.box('concrete', [b.x, y, b.z], [b.w + .12, .45, b.d + .12], { color: '#d8d2c6', shadow: false });
        kit.box('concrete', [b.x, b.h + .6, b.z], [b.w + .2, 1.2, b.d + .2], { color: '#cfc8bb', shadow: false });
      } else if (b.kind !== 'house') kit.box('concrete', [b.x, b.h + .3, b.z], [b.w + .15, .6, b.d + .15], { color: '#cbc3b4', shadow: false });
      if (b.kind === 'house') hipRoof(kit, 'roofRed', b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, b.h, .3, .3);
    }
    const g = kit.build(lib, 'metro:far:' + c.key); g.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
    groups.set(c.key, g);
  }
  return groups;
}

/** City-limit gantry, billboards, power lines and the toll plaza canopy on the Gateway Expressway. */
function buildGateway(lib: Materials) {
  const kit = new Kit(), signs: THREE.Object3D[] = [];
  const gz = METRO_ROWS.entrance - 18;
  // Gantry spanning the expressway at the city limits.
  for (const s of [-1, 1]) { kit.box('concrete', [s * 9, 4.2, gz], [1.4, 8.4, 1.4]); kit.box('brushed', [s * 9, 8.5, gz], [1.6, .2, 1.6]); }
  kit.box('darkMetal', [0, 8.0, gz], [19.4, 1.2, .8]); kit.box('steel', [0, 7.1, gz], [19.4, .12, .5]);
  const welcome = sign({ text: 'METROPOLITAN CITY', lines: ['METROPOLITAN CITY', 'DOWNTOWN • HARBOUR EXCHANGE • INDUSTRIAL'], kind: 'panel', width: 13, height: 1.9, background: '#1d4e3a', color: '#f4f1e6', tracking: .07 });
  welcome.position.set(0, 9.6, gz - .5); welcome.rotation.y = Math.PI; signs.push(welcome);
  const back = sign({ text: 'ORISUN UNIVERSITY', lines: ['ÒRÌṢUN UNIVERSITY', 'SOUTH GATE 0.3 KM'], kind: 'panel', width: 9, height: 1.6, background: '#1d4e3a', color: '#f4f1e6', tracking: .06 });
  back.position.set(0, 9.6, gz + .5); signs.push(back);
  kit.box('darkMetal', [0, 9.6, gz], [13.4, 2.1, .6]);
  // Billboards and power lines along the expressway: the campus palms give way to the city's infrastructure.
  const r = rng(77);
  for (let z = EXPRESSWAY.z0 + 70, i = 0; z < METRO_ROWS.entrance - 40; z += 64, i++) {
    const s = i % 2 ? 1 : -1, x = s * 22;
    kit.cylinder('steel', [x, 0, z], .25, .3, 7, 8); kit.cylinder('steel', [x + s * 3, 0, z], .25, .3, 7, 8);
    kit.box('darkMetal', [x + s * 1.5, 9.2, z], [9, 4.4, .3]);
    const ad = sign({ text: 'ad', lines: [['LAGOON GALLERIA', 'OPEN EVERY DAY'], ['SUNLINE FUEL', 'NEXT EXIT'], ['ATLAS HOUSE', 'OFFICES TO LET'], ['COASTLINE MOTORS', 'DRIVE AWAY TODAY']][i % 4], kind: 'panel', width: 8.6, height: 4, background: ACCENT[i % 4], color: '#fbf6ea', tracking: .05 });
    ad.position.set(x + s * 1.5, 9.2, z + (s > 0 ? -.17 : .17)); ad.rotation.y = s > 0 ? Math.PI : 0; signs.push(ad);
    void r;
  }
  // Wooden power poles every 45 m on the west verge, with three conductors between them.
  let last: number | null = null;
  for (let z = EXPRESSWAY.z0 + 30; z < METRO_ROWS.entrance + 200; z += 45) {
    const x = -13;
    kit.cylinder('wood', [x, 0, z], .14, .18, 10, 8, { color: '#6b513c' }); kit.box('wood', [x, 9.4, z], [2.6, .16, .16], { color: '#6b513c' });
    if (last !== null) for (const dx of [-1.1, 0, 1.1]) kit.box('darkMetal', [x + dx, 9.25, (z + last) / 2], [.025, .025, z - last], { shadow: false });
    last = z;
  }
  return { group: kit.build(lib, 'metro:gateway'), signs };
}

const PARKED = METRO_PARKED;
/** The nearest parked cars, as full vehicle models (others are part of the far shells' absence: they are small). */
function ParkedCars() {
  const root = useRef<THREE.Group>(null!), cache = useRef(new Map<string, THREE.Group>()), check = useRef(0);
  useFrame((_, dt) => {
    check.current -= dt; if (check.current > 0) return; check.current = .8;
    const near = inMetro(player.x, player.z, 120) ? PARKED.filter(p => Math.hypot(p.x - player.x, p.z - player.z) < 110).slice(0, 14) : [];
    const keep = new Set(near.map(p => p.id));
    for (const [id, g] of cache.current) if (!keep.has(id)) { root.current.remove(g); g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.geometry.name) m.geometry.dispose(); }); cache.current.delete(id); }
    for (const p of near) if (!cache.current.has(p.id)) {
      const model = buildVehicleModel(p.id, 'car').root;
      model.position.set(p.x, 0, p.z); model.rotation.y = p.yaw; model.updateMatrixWorld(true);
      model.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); });
      cache.current.set(p.id, model); root.current.add(model);
    }
  });
  return <group ref={root} name="metro:parked"/>;
}

const disposeTree = (o: THREE.Object3D) => o.traverse(c => { const m = c as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); if (m.name.startsWith('sign:')) (m.material as THREE.Material).dispose(); } });

export default function MetroCity({ lib }: { lib: Materials }) {
  const quality = useGame(s => s.quality);
  const root = useRef<THREE.Group>(null!);
  const far = useMemo(() => buildFar(lib), [lib]);
  const gateway = useMemo(() => buildGateway(lib), [lib]);
  const state = useRef({ check: 0, detail: new Map<string, THREE.Group>(), job: null as null | { key: string; steps: Generator<void, THREE.Group>; signs: THREE.Object3D[] } });
  useEffect(() => () => { for (const g of far.values()) disposeTree(g); disposeTree(gateway.group); gateway.signs.forEach(disposeTree); for (const g of state.current.detail.values()) disposeTree(g); state.current.detail.clear(); }, [far, gateway]);
  useFrame((_, dt) => {
    const s = state.current, g = root.current; if (!g) return;
    // (South of the campus districts only: the skyline is never drawn behind the courtyard.)
    g.visible = player.z > 700;
    if (!g.visible) return;
    // Continue the cell being built for up to ~4 ms this frame.
    if (s.job) {
      const t0 = performance.now();
      for (;;) { const r = s.job.steps.next(); if (r.done) { const grp = r.value; s.job.signs.forEach(o => grp.add(o)); s.detail.set(s.job.key, grp); g.add(grp); const f = far.get(s.job.key); if (f) f.visible = false; s.job = null; break; } if (performance.now() - t0 > 4) break; }
    }
    s.check -= dt; if (s.check > 0) return; s.check = .35;
    const range = quality === 'low' ? 170 : quality === 'medium' ? 230 : 290;
    for (const c of CELLS) {
      const d = Math.max(0, Math.abs(player.x - c.x) - CELL / 2, Math.abs(player.z - c.z) - CELL / 2);
      const has = s.detail.has(c.key) || s.job?.key === c.key;
      if (has && d > range + 40 && s.job?.key !== c.key) { const grp = s.detail.get(c.key)!; g.remove(grp); disposeTree(grp); s.detail.delete(c.key); const f = far.get(c.key); if (f) f.visible = true; }
      else if (!has && d < range && !s.job) {
        const withSafehouse = cellOf(SAFEHOUSE_PLOT.x, SAFEHOUSE_PLOT.z) === c.key;
        const { steps, signs } = buildCell(c.buildings, lib, withSafehouse); s.job = { key: c.key, steps, signs };
      }
    }
  });
  return <group ref={root} name="metro:city" visible={false}>
    {[...far.values()].map(g => <primitive key={g.name} object={g}/>)}
    <primitive object={gateway.group}/>
    {gateway.signs.map((o, i) => <primitive key={i} object={o}/>)}
    {quality !== 'low' && <ParkedCars/>}
  </group>;
}
void METRO_COLS;
