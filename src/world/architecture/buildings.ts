import * as THREE from 'three';
import { Kit, wall, windowUnit, fins, sunshade, breezeScreen, railing, hipRoof, flatRoof, waterTank, acUnit, downpipe, door, rng, wasteBin, type V3 } from './kit';
import { sign } from './signage';
import type { Placements } from '../placements';
import type { MaterialKey } from '../materials';
import { LIBRARY_COMPUTERS, CAFE_INTERIOR_TABLES, CLASSROOM, BENCHES } from '../../../shared/interactions.mjs';
import { LOW_SHELVES } from '../../../shared/campus.mjs';

// The campus buildings, modelled in the idiom of West African tropical modernism: deep overhangs,
// brise-soleil, breeze-block screens, open galleries and long-span roofs. Footprints match the
// shared colliders in shared/campus.mjs.

type Side = 's' | 'n' | 'e' | 'w';
type Opening = { x0: number; x1: number; y0: number; y1: number };
export interface BuildContext {
  kit: Kit; signs: THREE.Object3D[]; props: Placements; lights: { position: V3; intensity: number; distance: number }[]; books: { matrix: THREE.Matrix4; color: THREE.Color }[];
  chainLink: { x0: number; z0: number; x1: number; z1: number; height: number }[]; hoopNets: { x: number; z: number }[]; goalNets: { x: number; z: number; dir: number }[];
}

const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

function facade(kit: Kit, X0: number, X1: number, Z0: number, Z1: number, side: Side, fn: (length: number) => void) {
  if (side === 's') kit.within([X0, 0, Z1], 0, () => fn(X1 - X0));
  else if (side === 'n') kit.within([X1, 0, Z0], Math.PI, () => fn(X1 - X0));
  else if (side === 'e') kit.within([X1, 0, Z1], Math.PI / 2, () => fn(Z1 - Z0));
  else kit.within([X0, 0, Z0], -Math.PI / 2, () => fn(Z1 - Z0));
}
const windowsOf = (kit: Kit, ops: Opening[], seed: number, style: Parameters<typeof windowUnit>[2] = {}) => ops.forEach((o, i) => windowUnit(kit, o, { seed: seed + i, ...style }));

// ---------------------------------------------------------------- Adunni Learning Commons
function library(c: BuildContext) {
  const { kit } = c, X0 = -42.1, X1 = -17.9, Z0 = -26.1, Z1 = -4.0, H = 10, t = .6;
  facade(kit, X0, X1, Z0, Z1, 's', L => {
    kit.box('stucco', [.3, H / 2, -t / 2], [.6, H, t]).box('stucco', [L - .3, H / 2, -t / 2], [.6, H, t]);
    for (const [a, b] of [[.6, 10.1], [14.1, L - .6]]) {
      kit.box('granite', [(a + b) / 2, .225, -t / 2], [b - a, .45, t]);
      windowUnit(kit, { x0: a, x1: b, y0: .45, y1: 4.4 }, { frame: 'bronzeFrame', recess: .3, sill: null, mullion: 1.55, transom: 3.25, tint: 'clear', seed: 1 });
    }
    // Entrance: a bronze door frame and glass transom; the hinged glass leaves are interactive (Doors).
    kit.box('bronzeFrame', [10.1, 2.2, -.32], [.12, 4.4, .14]).box('bronzeFrame', [14.1, 2.2, -.32], [.12, 4.4, .14]).box('bronzeFrame', [12.1, 3.3, -.32], [4, .12, .14]);
    kit.add('glassClear', new THREE.PlaneGeometry(4, 1.05), { matrix: at(12.1, 3.86, -.32), shadow: false });
    kit.box('granite', [12.1, .012, -.32], [4, .024, .3]);
    // Upper storey: slot windows behind a rhythm of concrete fins.
    const slots: Opening[] = []; for (let x = 1.5; x < L - 1; x += 1.2) slots.push({ x0: x - .28, x1: x + .28, y0: 5.3, y1: 8.9 });
    wall(kit, 'stucco', .6, L - .6, 4.4, H, t, slots); windowsOf(kit, slots, 2, { recess: .22, sill: null, mullion: 5 });
    for (let x = .9; x <= L - .8; x += 1.2) kit.box('concrete', [x, 7.25, .3], [.16, 5, .6]);
    kit.box('concrete', [L / 2, 9.8, .04], [L + .1, .4, .08]);
    // Portico: cantilevered canopy on round columns with a lettered upstand.
    kit.box('concrete', [L / 2, 4.6, 1.45], [L + 1.2, .36, 3.5]);
    kit.box('stucco', [L / 2, 5.12, 3.12], [L + 1.2, .7, .16]);
    for (const x of [1.4, 6.2, 10.1 - .9, 14.1 + .9, 18, 22.8]) kit.cylinder('stucco', [x, 0, 2.75], .21, .21, 4.42, 18);
    for (let x = 1.6; x < L; x += 2.6) kit.cylinder('emissiveWarm', [x, 4.405, 1.3], .1, .1, .02, 12, { shadow: false });
    c.signs.push(kit.place(sign({ text: 'ADUNNI LEARNING COMMONS', kind: 'letters', width: 12.5, height: .5, color: '#b88a50' }), [L / 2, 5.12, 3.215]));
    downpipe(kit, .75, H); downpipe(kit, L - .75, H);
  });
  for (const side of ['e', 'w'] as const) facade(kit, X0, X1, Z0, Z1, side, L => {
    const ops: Opening[] = []; for (let x = 3.2; x < L - 2; x += 3.5) ops.push({ x0: x - .9, x1: x + .9, y0: 1.1, y1: 3.5 }, { x0: x - 1.1, x1: x + 1.1, y0: 5.6, y1: 8.7 });
    wall(kit, 'stucco', 0, L, 0, H, t, ops); windowsOf(kit, ops, side === 'e' ? 10 : 30);
    kit.box('granite', [L / 2, .225, .02], [L, .45, .04]).box('concrete', [L / 2, 9.7, .03], [L, .6, .06]);
    for (const o of ops.filter(o => o.y0 < 2)) kit.box('concrete', [(o.x0 + o.x1) / 2, 3.75, .25], [o.x1 - o.x0 + .5, .12, .5]);
    if (side === 'e') [4.95, 8.45, 15.45].forEach(x => acUnit(kit, x, 2.4));
    downpipe(kit, L - .5, H);
  });
  facade(kit, X0, X1, Z0, Z1, 'n', L => {
    const ops: Opening[] = []; for (let x = 2.2; x < L - 1.5; x += 3.3) ops.push({ x0: x - .8, x1: x + .8, y0: 1.1, y1: 3.4 }, { x0: x - .8, x1: x + .8, y0: 5.6, y1: 8.7 });
    const service = { x0: 16.45, x1: 17.65, y0: 0, y1: 2.3 };
    wall(kit, 'stucco', 0, L, 0, H, t, [...ops, service]); windowsOf(kit, ops, 50);
    kit.box('wood', [17.05, 1.15, -.22], [1.2, 2.3, .06]).box('paintDark', [17.05, 2.42, .12], [1.8, .08, .7]);
    kit.box('granite', [L / 2, .225, .02], [L, .45, .04]).box('concrete', [L / 2, 9.7, .03], [L, .6, .06]);
    [3.85, 10.45, 20.35].forEach(x => acUnit(kit, x, 4.5)); downpipe(kit, .5, H); downpipe(kit, L - .5, H);
  });
  flatRoof(kit, X0, X1, Z0, Z1, H, { eave: 1.3, slab: .4, mat: 'concrete' });
  kit.box('concrete', [-24, H + 1.6, -21], [4.5, 2.4, 3.5]); waterTank(kit, -37, H + .4, -22); waterTank(kit, -34.6, H + .4, -22, '#1d2a38');
  // Interior: terrazzo reading hall with a timber dado, light coffers and shelving bays.
  const IX0 = X0 + t, IX1 = X1 - t, IZ0 = Z0 + t, IZ1 = Z1 - t;
  kit.box('terrazzo', [(IX0 + IX1) / 2, .012, (IZ0 + IZ1) / 2], [IX1 - IX0, .024, IZ1 - IZ0]);
  kit.box('plaster', [(IX0 + IX1) / 2, 7.5, (IZ0 + IZ1) / 2], [IX1 - IX0, .2, IZ1 - IZ0], { shadow: false });
  for (let x = IX0 + 2.5; x < IX1 - 1; x += 4) for (let z = IZ0 + 2.5; z < IZ1 - 1; z += 4) kit.box('emissiveWarm', [x, 7.39, z], [1.6, .03, .6], { shadow: false });
  kit.box('wood', [IX0 + .015, .5, (IZ0 + IZ1) / 2], [.03, 1, IZ1 - IZ0]).box('wood', [IX1 - .015, .5, (IZ0 + IZ1) / 2], [.03, 1, IZ1 - IZ0]).box('wood', [(IX0 + IX1) / 2, .5, IZ0 + .015], [IX1 - IX0, 1, .03]);
  const bookRand = rng(17), palette = ['#7a2e2a', '#2f4a6b', '#c9a24a', '#3f5e3a', '#e7e0cf', '#5a3d2b', '#9b5b2a', '#253238', '#b84a3a', '#6c7d8c', '#d8c39a', '#41324a'].map(h => new THREE.Color(h));
  const shelfBooks = (x0: number, x1: number, y: number, z: number, facing: 1 | -1) => {
    for (let x = x0; x < x1;) {
      const w = .025 + bookRand() * .04, h = .2 + bookRand() * .13, d = .16 + bookRand() * .06, gap = bookRand() < .06 ? .05 : .002;
      if (x + w > x1) break;
      const lean = bookRand() < .05 ? (bookRand() - .5) * .5 : 0;
      c.books.push({ matrix: new THREE.Matrix4().compose(new THREE.Vector3(x + w / 2, y + h / 2, z - facing * d / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, lean)), new THREE.Vector3(w, h, d)), color: palette[Math.floor(bookRand() * palette.length)].clone().multiplyScalar(.75 + bookRand() * .4) });
      x += w + gap;
    }
  };
  for (const cx of [-39.6, -20.4]) for (const cz of [-23.6, -19, -14.4]) {
    const x0 = cx - 1.1, x1 = cx + 1.1;
    kit.box('wood', [cx, 1.2, cz], [2.2, 2.4, .04]).box('wood', [x0 + .02, 1.2, cz], [.04, 2.4, 1.2]).box('wood', [x1 - .02, 1.2, cz], [.04, 2.4, 1.2]).box('wood', [cx, 2.38, cz], [2.2, .04, 1.2]).box('paintDark', [cx, .05, cz], [2.2, .1, 1.2]);
    for (const y of [.1, .55, 1.0, 1.45, 1.9]) { kit.box('wood', [cx, y, cz], [2.14, .025, 1.18], { shadow: false }); shelfBooks(x0 + .05, x1 - .05, y + .013, cz + .58, 1); shelfBooks(x0 + .05, x1 - .05, y + .013, cz - .58, -1); }
  }
  // Low shelves under the north windows, a reading-room motto and the issue desk.
  // (The run leaves a gap in front of the staff-room door; see LOW_SHELVES in shared/campus.mjs.)
  for (const s of LOW_SHELVES) { kit.box('wood', [s.x, .5, s.z], [s.w, 1, s.d]); for (const y of [.08, .52]) shelfBooks(s.x - 1.05, s.x + 1.05, y, IZ0 + .39, 1); }
  c.signs.push(kit.place(sign({ text: 'A world of ideas awaits.', kind: 'letters', width: 7, height: .7, color: '#2f4b40', metalness: .1, roughness: .7, weight: 600, tracking: .01 }), [-30, 4.45, IZ0 + .02]));
  kit.box('wood', [-22.5, .52, -7.5], [3, 1.04, .9]).box('granite', [-22.5, 1.06, -7.5], [3.15, .05, 1.05]).box('wood', [-20.95, .52, -8.4], [.9, 1.04, 1.9]);
  for (const x of [-34.2, -25.8]) for (const z of [-19.5, -10.5]) {
    kit.box('wood', [x, .74, z], [2.4, .05, 1.1]);
    for (const [dx, dz] of [[-1.1, -.45], [1.1, -.45], [1.1, .45], [-1.1, .45]]) kit.box('steel', [x + dx, .36, z + dz], [.05, .72, .05]);
    for (const dx of [-.6, .6]) { kit.box('steel', [x + dx, .95, z], [.02, .4, .02]); kit.cylinder('paintGreen', [x + dx, 1.12, z + .08], .07, .13, .14, 12); kit.cylinder('emissiveWarm', [x + dx, 1.115, z + .08], .11, .11, .01, 12, { shadow: false }); }
  }
  // Catalogue computers against the west wall (screens are drawn by Computers; chairs by Chairs).
  for (const pc of LIBRARY_COMPUTERS) {
    kit.box('wood', [pc.x, .74, pc.z], [.7, .04, 1.4]).box('wood', [pc.x - .3, .37, pc.z], [.04, .72, 1.36]);
    for (const dz of [-.66, .66]) kit.box('steel', [pc.x + .3, .36, pc.z + dz], [.04, .72, .04]);
    kit.box('darkMetal', [pc.x - .18, 1.03, pc.z], [.035, .36, .56]).box('darkMetal', [pc.x - .2, .84, pc.z], [.06, .16, .06]).box('darkMetal', [pc.x - .2, .765, pc.z], [.2, .015, .24]);
    kit.box('paintDark', [pc.x + .08, .772, pc.z], [.16, .015, .44]).box('paintDark', [pc.x + .1, .772, pc.z - .34], [.1, .02, .06]);
    kit.box('darkMetal', [pc.x - .05, .26, pc.z + .48], [.4, .44, .2]);
  }
  // New-arrivals display: a sloped timber stand with covers facing the reading room.
  kit.box('wood', [-30, .45, -23.2], [2.2, .9, .7]).box('wood', [-30, .93, -23.2], [2.25, .06, .76], { rotX: -.28 });
  for (let i = 0; i < 7; i++) {
    const bx = -30.9 + i * .3, h = .26 + (i % 3) * .03;
    c.books.push({ matrix: new THREE.Matrix4().compose(new THREE.Vector3(bx, 1.0 + h / 2 * Math.cos(.28), -23.1 + h / 2 * Math.sin(.28)), new THREE.Quaternion().setFromEuler(new THREE.Euler(-.28, 0, 0)), new THREE.Vector3(.2, h, .03)), color: new THREE.Color(['#b84a3a', '#2f4a6b', '#c9a24a', '#3f5e3a', '#e7e0cf', '#41324a', '#9b5b2a'][i]) });
  }
  c.signs.push(kit.place(sign({ text: 'NEW ARRIVALS', kind: 'panel', width: 1.1, height: .22, background: '#2f4b40', color: '#f1e2be' }), [-30, .62, -22.84]));
  // Information totem beside the entrance.
  kit.box('granite', [-24.5, .06, -1.6], [.9, .12, .5]).box('darkMetal', [-24.5, 1.05, -1.6], [.7, 1.9, .14]);
  c.signs.push(kit.place(sign({ text: 'LEARNING COMMONS', kind: 'panel', width: .62, height: 1.2, background: '#22382f', color: '#efd394', lines: ['LEARNING COMMONS', 'Open 8:00 – 22:00', 'Push the doors to enter'] }), [-24.5, 1.25, -1.525]));
  c.props.add('pottedPalm', at(-32.6, 0, -5.6)); c.props.add('pottedPalm', at(-27.4, 0, -5.6)); c.props.add('pottedPlant', at(-40.8, 0, -24.8)); c.props.add('pottedPlant', at(-19.2, 0, -24.8));
  c.props.add('wetFloor', new THREE.Matrix4().makeRotationY(.6).setPosition(-27.6, 0, -7.2));
  for (const z of [-8, -15, -22]) c.lights.push({ position: [-30, 6.6, z], intensity: 90, distance: 16 });
}

// ---------------------------------------------------------------- The Student House
function studentHouse(c: BuildContext) {
  const { kit } = c, X0 = 17.5, X1 = 42.5, Z0 = -20, Z1 = -4.2, H = 8.6;
  facade(kit, X0, X1, Z0, Z1, 's', L => {
    for (const p of [0, 6.1, 12.2, 18.3, 24.4]) kit.box('brick', [p + .3, 2.1, -.25], [.6, 4.2, .5]);
    const bays: [number, number][] = [[.6, 6.1], [6.7, 12.2], [12.8, 18.3], [18.9, 24.4]];
    bays.forEach(([a, b], i) => {
      kit.box('brick', [(a + b) / 2, .15, -.25], [b - a, .3, .5]);
      if (i === 1) {
        windowUnit(kit, { x0: a, x1: 8.45, y0: .3, y1: 3.9 }, { frame: 'bronzeFrame', tint: 'clear', recess: .25, sill: null, mullion: 2, transom: 2.6 });
        windowUnit(kit, { x0: 10.45, x1: b, y0: .3, y1: 3.9 }, { frame: 'bronzeFrame', tint: 'clear', recess: .25, sill: null, mullion: 2, transom: 2.6 });
        kit.box('bronzeFrame', [9.45, 2.64, -.25], [2.1, .08, .08]).box('bronzeFrame', [8.42, 1.3, -.25], [.07, 2.6, .08]).box('bronzeFrame', [10.48, 1.3, -.25], [.07, 2.6, .08]);
        kit.add('glassClear', new THREE.PlaneGeometry(2, 1.3), { matrix: at(9.45, 3.25, -.25), shadow: false });
      } else windowUnit(kit, { x0: a, x1: b, y0: .3, y1: 3.9 }, { frame: 'bronzeFrame', tint: 'clear', recess: .25, sill: null, mullion: 1.4, transom: 2.6, seed: i });
    });
    kit.box('brick', [L / 2, 4.05, -.25], [L, .3, .5]).box('concrete', [L / 2, 4.4, -.15], [L + .1, .4, .5]);
    const ribbon = { x0: .8, x1: L - .8, y0: 5.1, y1: 7.4 };
    wall(kit, 'stucco', 0, L, 4.6, H, .3, [ribbon]); windowUnit(kit, ribbon, { mullion: 1.25, seed: 5 });
    sunshade(kit, 'concrete', -.2, L + .2, 7.8, 1.15, .16);
    for (let x = 0; x <= L + .01; x += 2.5) kit.box('concrete', [x, 6.25, .55], [.12, 3.0, 1.1]);
    // Steel-framed terrace canopy with a long-span roof.
    for (const x of [.3, 6.4, 12.5, 18.6, 24.7]) kit.box('darkMetal', [x, 1.8, 6.0], [.16, 3.6, .16]);
    kit.box('darkMetal', [L / 2, 3.58, 6.0], [L + .4, .22, .14]);
    for (let x = 0; x <= L; x += 3.125) kit.box('darkMetal', [x, 3.6, 2.95], [.08, .16, 6.2]);
    kit.box('roofGreen', [L / 2, 3.74, 2.95], [L + .8, .06, 6.7], { rotX: -.05 });
    kit.box('paintWhite', [L / 2, 3.66, 6.3], [L + .8, .26, .05]);
    for (let x = 3; x < L; x += 6.2) { kit.box('darkMetal', [x, 3.3, 2.8], [.03, .5, .03], { shadow: false }); kit.cylinder('darkMetal', [x, 3.0, 2.8], .07, .07, .12, 10); for (const r of [0, Math.PI / 2]) kit.box('wood', [x, 3.04, 2.8], [1.1, .015, .12], { rotY: r, shadow: false }); }
    c.signs.push(kit.place(sign({ text: 'Courtyard Café', kind: 'panel', width: 2.8, height: .62, background: '#22382f', color: '#efd394', weight: 600, tracking: .02, lines: ['Courtyard Café', 'Coffee · Jollof · Fresh juice'] }), [9.45, 3.17, 6.335]));
    c.signs.push(kit.place(sign({ text: 'THE STUDENT HOUSE', kind: 'letters', width: 9.5, height: .62, color: '#d9dcdc' }), [L / 2, 9.38, .03]));
  });
  for (const side of ['e', 'w'] as const) facade(kit, X0, X1, Z0, Z1, side, L => {
    const low: Opening[] = [], high: Opening[] = []; for (let x = 2.6; x < L - 1.5; x += 3.6) { low.push({ x0: x - .8, x1: x + .8, y0: 1.0, y1: 3.2 }); high.push({ x0: x - 1, x1: x + 1, y0: 5.2, y1: 7.4 }); }
    wall(kit, 'brick', 0, L, 0, 4.2, .5, low); wall(kit, 'stucco', 0, L, 4.6, H, .3, high); windowsOf(kit, [...low, ...high], side === 'e' ? 70 : 90);
    kit.box('concrete', [L / 2, 4.4, -.15], [L, .4, .5]);
    if (side === 'w') [4.4, 8].forEach(x => acUnit(kit, x, 2.2)); downpipe(kit, L - .4, H);
  });
  facade(kit, X0, X1, Z0, Z1, 'n', L => {
    const ops: Opening[] = []; for (let x = 2.4; x < L - 1.5; x += 3.4) ops.push({ x0: x - .7, x1: x + .7, y0: 1.2, y1: 3.0 }, { x0: x - .9, x1: x + .9, y0: 5.2, y1: 7.4 });
    const doorway = { x0: 12, x1: 13.8, y0: 0, y1: 2.4 };
    wall(kit, 'brick', 0, L, 0, 4.2, .5, [...ops.filter(o => o.y0 < 4), doorway]); wall(kit, 'stucco', 0, L, 4.6, H, .3, ops.filter(o => o.y0 > 4)); windowsOf(kit, ops, 110);
    kit.box('concrete', [L / 2, 4.4, -.15], [L, .4, .5]).box('paintDark', [12.9, 1.2, -.2], [1.8, 2.4, .05]);
    [3.1, 6.5, 16.7, 20.1].forEach(x => acUnit(kit, x, 4.0)); downpipe(kit, .5, H); downpipe(kit, L - .5, H);
  });
  flatRoof(kit, X0, X1, Z0, Z1, H, { parapet: .9, slab: .3, mat: 'stucco' });
  // Rooftop solar array, a common sight now on Nigerian campuses.
  for (let row = 0; row < 3; row++) for (let i = 0; i < 9; i++) {
    const x = X0 + 3 + i * 2.2, z = Z0 + 3 + row * 3.2;
    kit.box('glass', [x, H + 1.0, z], [2.0, .04, 1.6], { rotX: -.26, color: '#1c2b52' }).box('aluminium', [x, H + .95, z], [2.04, .05, 1.64], { rotX: -.26 });
    kit.box('steel', [x, H + .6, z + .5], [.05, .6, .05]).box('steel', [x, H + .75, z - .5], [.05, .9, .05]);
  }
  waterTank(kit, 39.5, H + .3, -17.5);
  // Café interior seen through the storefront.
  kit.box('wood', [30, .015, -8.4], [23.8, .03, 7.6]).box('plaster', [30, 4.05, -8.4], [23.8, .15, 7.6], { shadow: false }).box('stuccoCream', [30, 2.0, -12.15], [23.8, 4, .2]);
  kit.box('wood', [26.5, .55, -10.4], [9, 1.1, .8]).box('granite', [26.5, 1.13, -10.4], [9.2, .06, .95]);
  for (let x = 23; x <= 30; x += 3.5) { kit.cylinder('emissiveWarm', [x, 2.85, -10.3], .14, .14, .25, 14, { shadow: false }); kit.box('darkMetal', [x, 3.5, -10.3], [.01, 1, .01], { shadow: false }); }
  kit.box('wood', [26.5, 2.2, -12.02], [8, .04, .3]).box('wood', [26.5, 2.8, -12.02], [8, .04, .3]);
  c.signs.push(kit.place(sign({ text: 'MENU', kind: 'panel', width: 3.4, height: 1.1, background: '#1f2a26', color: '#f1e2be', lines: ['TODAY AT THE CAFÉ', 'Jollof rice · Plantain · Moi moi · Zobo'] }), [33.5, 2.6, -12.04]));
  for (const [x, z] of CAFE_INTERIOR_TABLES) { kit.cylinder('steel', [x, 0, z], .04, .2, .72, 10); kit.cylinder('wood', [x, .72, z], .45, .45, .04, 20); }
  // Counter: espresso machine, cake stand, till (demo only) and an order-here sign.
  kit.box('steel', [24.4, 1.38, -10.55], [.6, .44, .45]).box('darkMetal', [24.4, 1.62, -10.55], [.62, .04, .47]).box('chrome', [24.4, 1.28, -10.3], [.4, .03, .06]);
  kit.cylinder('chrome', [27.6, 1.16, -10.45], .16, .16, .04, 18).cylinder('glassClear', [27.6, 1.2, -10.45], .15, .15, .22, 18, { shadow: false });
  kit.box('paintDark', [29.4, 1.24, -10.5], [.36, .16, .3]).box('darkMetal', [29.4, 1.38, -10.62], [.3, .2, .03]);
  c.signs.push(kit.place(sign({ text: 'ORDER HERE', kind: 'panel', width: .9, height: .24, background: '#d6a648', color: '#1f2a26' }), [26.5, 1.45, -10.12]));
  c.lights.push({ position: [27, 3.4, -8], intensity: 40, distance: 10 }, { position: [36, 3.4, -8], intensity: 30, distance: 10 });
  // Terrace furniture: round tables, monobloc chairs, and brick planters along the edge.
  for (const x of [21.5, 25.5, 33, 37.5]) for (const z of [-1.6, 1.4]) {
    kit.cylinder('steel', [x, 0, z], .04, .22, .72, 10).cylinder('wood', [x, .72, z], .5, .5, .04, 20);
  }
  for (const [a, b] of [[17.7, 26], [32, 42.3]]) { kit.box('brick', [(a + b) / 2, .3, 5.0], [b - a, .6, .8]); kit.box('mulch', [(a + b) / 2, .58, 5.0], [b - a - .2, .04, .6], { shadow: false }); }
  c.props.add('chalkboard', new THREE.Matrix4().makeRotationY(.25).setPosition(31.4, 0, .4));
  for (const x of [18, 42]) wasteBin(kit, x, 3.7);
}

// ---------------------------------------------------------------- Horizon Auditorium
function auditorium(c: BuildContext) {
  const { kit } = c, X0 = -16, X1 = 16, Z0 = -51.5, Z1 = -34.5, H = 12.5;
  facade(kit, X0, X1, Z0, Z1, 's', L => {
    kit.within([0, 0, -2.0], 0, () => {
      windowUnit(kit, { x0: .6, x1: L - .6, y0: 0, y1: 9 }, { frame: 'bronzeFrame', tint: 'clear', recess: .05, sill: null, mullion: 2, transom: 3.2, seed: 7 });
      kit.box('bronzeFrame', [L / 2, 6.4, -.03], [L - 1.2, .06, .08]);
      for (const x of [13, 16, 19]) door(kit, x, 1.9, 2.7, .02);
    });
    // Lobby seen through the glass: granite floor, timber-panelled wall, pendant lights.
    kit.box('granite', [L / 2, .015, -6], [L - 1.2, .03, 8]).box('wood', [L / 2, 4.5, -10.05], [L - 1.2, 9, .1]).box('plaster', [L / 2, 9.05, -6], [L - 1.2, .1, 8], { shadow: false });
    for (let x = 4; x < L; x += 4) for (const z of [-4.5, -7.5]) kit.cylinder('emissiveWarm', [x, 6.2, z], .35, .35, .08, 16, { shadow: false });
    for (let i = 0; i <= 16; i++) kit.box('stuccoOchre', [i * 2, 6.1, -.95], [.36, 12.2, 1.9]);
    kit.box('concrete', [L / 2, 10.75, -1.0], [L + .4, 3.5, 2.4]);
    kit.box('concrete', [16, 4.62, 1.5], [14, .42, 7.0]);
    for (let x = 10; x <= 22; x += 3) kit.cylinder('emissiveWarm', [x, 4.405, 2.6], .12, .12, .02, 12, { shadow: false });
    for (const x of [10.2, 21.8]) kit.cylinder('concrete', [x, 0, 4.4], .22, .32, 4.42, 18);
    c.signs.push(kit.place(sign({ text: 'HORIZON AUDITORIUM', kind: 'letters', width: 17, height: 1.05, color: '#d6d8d9' }), [L / 2, 10.9, .22]));
  });
  for (const side of ['e', 'w'] as const) facade(kit, X0, X1, Z0, Z1, side, L => {
    const ops: Opening[] = [3, 6, 14].map(x => ({ x0: x - .25, x1: x + .25, y0: 1, y1: 10.2 }));
    const exit = { x0: 9.4, x1: 11.2, y0: 0, y1: 2.5 };
    wall(kit, 'ribbed', 0, L, 0, H, .5, [...ops, exit]); windowsOf(kit, ops, side === 'e' ? 140 : 160, { mullion: 5, transom: 0 });
    kit.box('paintGreen', [10.3, 1.25, -.3], [1.8, 2.5, .06]).box('concrete', [10.3, 2.8, .6], [2.8, .14, 1.2]);
    c.signs.push(kit.place(sign({ text: 'EXIT', kind: 'panel', width: .6, height: .22, background: '#1f7a43', color: '#ffffff' }), [10.3, 2.62, .02]));
    downpipe(kit, .6, H);
  });
  facade(kit, X0, X1, Z0, Z1, 'n', L => {
    wall(kit, 'ribbed', 0, L, 0, H, .5, [{ x0: 4, x1: 6.4, y0: 0, y1: 3 }]);
    kit.box('paintDark', [5.2, 1.5, -.3], [2.4, 3, .06]).box('concrete', [16, H + 2, -3.6], [16, 4, 7.2]);
    [9, 12, 20, 23].forEach(x => acUnit(kit, x, 1.2));
  });
  // Folded-plate concrete roof.
  for (let x = X0; x < X1 - .01; x += 4) {
    const zA = Z0, zB = Z1 - 2.2, y0 = H, y1 = H + 1.2;
    kit.quad('concrete', [x, y0, zB], [x + 2, y1, zB], [x + 2, y1, zA], [x, y0, zA]);
    kit.quad('concrete', [x + 2, y1, zB], [x + 4, y0, zB], [x + 4, y0, zA], [x + 2, y1, zA]);
    kit.quad('concrete', [x, y0, zB], [x + 4, y0, zB], [x + 2, y1, zB], [x + 2, y1, zB]);
    kit.quad('concrete', [x + 4, y0, zA], [x, y0, zA], [x + 2, y1, zA], [x + 2, y1, zA]);
  }
  // Flagpoles and forecourt planters.
  for (const [x, flag] of [[-13.2, 'ng'], [-11.4, 'uni']] as const) {
    kit.cylinder('chrome', [x, 0, -28.4], .05, .07, 9, 10).cylinder('granite', [x, 0, -28.4], .35, .4, .3, 16);
    c.props.add(flag === 'ng' ? 'flagNG' : 'flagUni', at(x + .05, 8.9, -28.4));
  }
  for (const x of [-15, 15]) { kit.box('granite', [x, .3, -30.5], [3.2, .6, 3.2]); kit.box('mulch', [x, .58, -30.5], [2.9, .04, 2.9], { shadow: false }); }
}

// ---------------------------------------------------------------- Academic blocks
function academic(c: BuildContext, X0: number, X1: number, Z0: number, Z1: number, o: { roof: MaterialKey; wallMat: MaterialKey; balustrade: 'breeze' | 'rail'; name: string; seed: number; monument: V3; classroom?: boolean }) {
  const { kit } = c, F = 3.6, H = 10.8, G = 2.4;
  facade(kit, X0, X1, Z0, Z1, 's', L => {
    kit.within([0, 0, -G], 0, () => {
      const doors: Opening[] = [], wins: Opening[] = [];
      for (let f = 0; f < 3; f++) for (let x = 1.2; x < L - 4.6; x += 6) {
        doors.push({ x0: x, x1: x + 1, y0: f * F + .16, y1: f * F + 2.4 });
        wins.push({ x0: x + 1.7, x1: x + 3.2, y0: f * F + 1.0, y1: f * F + 2.5 }, { x0: x + 3.7, x1: x + 5.2, y0: f * F + 1.0, y1: f * F + 2.5 });
      }
      wall(kit, o.wallMat, 0, L, 0, H, .3, [...doors, ...wins]);
      windowsOf(kit, wins, o.seed, { mullion: .75, transom: 0, recess: .1 });
      for (const d of wins) for (let y = d.y0 + .25; y < d.y1 - .1; y += .25) kit.box('aluminium', [(d.x0 + d.x1) / 2, y, -.08], [d.x1 - d.x0 - .1, .012, .09], { shadow: false });
      doors.forEach((d, i) => { if (!(o.classroom && i === 0)) kit.box(i % 3 === 0 ? 'paintGreen' : 'wood', [(d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, -.2], [1, d.y1 - d.y0, .05]); });
    });
    kit.box('brushed', [L / 2, .08, -G / 2], [L, .16, G]);
    for (const f of [1, 2]) kit.box('concrete', [L / 2, f * F, -G / 2], [L + .1, .25, G + .12]);
    kit.box('concrete', [L / 2, H, -G / 2], [L + .1, .3, G + .12]);
    const bays = Math.round(L / 4);
    for (let i = 0; i <= bays; i++) kit.box('stucco', [i * L / bays, H / 2, -.2], [.35, H, .35]);
    for (const f of [1, 2]) for (let i = 0; i < bays; i++) {
      const a = i * L / bays + .2, b = (i + 1) * L / bays - .2;
      if (b > L - 3.6) continue;
      if (o.balustrade === 'breeze') { breezeScreen(kit, 'stucco', a, b, f * F + .13, f * F + 1.05, -.18); kit.box('concrete', [(a + b) / 2, f * F + 1.1, -.18], [b - a, .1, .22]); }
      else railing(kit, a, b, f * F + .13, -.15, 1.05, 'paintGreen');
    }
    breezeScreen(kit, 'stucco', L - 3.6, L - .2, .3, H - .2, -.18);
    for (let f = 0; f < 3; f++) for (let x = 2.2; x < L - 4; x += 6) kit.cylinder('emissiveWarm', [x, (f + 1) * F - .14, -1.2], .12, .12, .02, 10, { shadow: false });
  });
  for (const side of ['e', 'w'] as const) facade(kit, X0, X1, Z0, Z1, side, L => {
    const ops: Opening[] = [];
    for (let f = 0; f < 3; f++) { ops.push({ x0: .4, x1: G - .3, y0: f * F + 1.15, y1: f * F + 3.3 }); for (const x of [G + 2.5, G + 6.5, G + 10.5]) if (x + 1 < L - .5) ops.push({ x0: x - .8, x1: x + .8, y0: f * F + 1.0, y1: f * F + 2.5 }); }
    wall(kit, o.wallMat, 0, L, 0, H, .3, ops); windowsOf(kit, ops.filter(p => p.x0 > 1), o.seed + 40, { mullion: .8 });
    kit.box('granite', [L / 2, .2, .02], [L, .4, .04]);
    if (side === 'w') [G + 4.5, G + 8.5].forEach(x => acUnit(kit, x, 5.4)); downpipe(kit, L - .4, H);
  });
  facade(kit, X0, X1, Z0, Z1, 'n', L => {
    const ops: Opening[] = []; for (let f = 0; f < 3; f++) for (let x = 2; x < L - 1.2; x += 3) ops.push({ x0: x - .75, x1: x + .75, y0: f * F + 1.0, y1: f * F + 2.5 });
    wall(kit, o.wallMat, 0, L, 0, H, .3, ops); windowsOf(kit, ops, o.seed + 80, { mullion: .75 });
    for (const x of [3.5, 9.5, 15.5]) for (const f of [0, 1, 2]) if (x < L - 1) acUnit(kit, x, f * F + 3.0);
    kit.box('granite', [L / 2, .2, .02], [L, .4, .04]); downpipe(kit, .5, H); downpipe(kit, L - .5, H);
  });
  hipRoof(kit, o.roof, X0, X1, Z0, Z1, H + .15, .3, 1.0);
  if (o.classroom) classroom(c);
  // Elevated water tanks beside the block.
  const tx = X1 + 3.2, tz = Z0 + 4;
  for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) kit.box('steel', [tx + dx, 3.5, tz + dz], [.12, 7, .12]);
  for (const y of [2.4, 4.8]) { kit.box('steel', [tx, y, tz - 1.2], [2.5, .06, .06]).box('steel', [tx, y, tz + 1.2], [2.5, .06, .06]).box('steel', [tx - 1.2, y, tz], [.06, .06, 2.5]).box('steel', [tx + 1.2, y, tz], [.06, .06, 2.5]); }
  kit.box('steel', [tx, 7, tz], [2.8, .12, 2.8]); waterTank(kit, tx - .6, 7.06, tz, '#2a3a4a', .1); waterTank(kit, tx + .7, 7.06, tz, '#3d3a32', .1);
  // Monument sign at the entrance lawn.
  const [mx, my, mz] = o.monument;
  kit.box('granite', [mx, .5, mz], [6.2, 1, .7]).box('brick', [mx, 1.15, mz], [5.8, .3, .5]);
  c.signs.push(kit.place(sign({ text: o.name, kind: 'letters', width: 5.4, height: .42, color: '#b88a50' }), [mx, .55, mz + .36]));
}

// ---------------------------------------------------------------- gateway, walls and small structures
function boundary(c: BuildContext) {
  const { kit } = c;
  // Gateway pylons and lettered beam.
  for (const x of [-7.6, 7.6]) {
    kit.box('granite', [x, .6, 50], [2.5, 1.2, 3.3]).box('stuccoOchre', [x, 4.1, 50], [2.4, 5.8, 3.2]).box('concrete', [x, 7.25, 50], [2.8, .5, 3.6]);
    for (const dz of [-1.0, 0, 1.0]) kit.box('concrete', [x + Math.sign(-x) * 1.22, 4.1, 50 + dz], [.06, 5.2, .18]);
  }
  kit.box('concrete', [0, 6.6, 50], [12.8, 1.3, 1.5]).box('bronze', [0, 6.0, 50], [12.8, .06, 1.52]);
  c.signs.push(kit.place(sign({ text: 'ÒRÌṢUN UNIVERSITY', kind: 'letters', width: 9.8, height: .78, color: '#c19256' }), [0, 6.68, 50.76]));
  c.signs.push(kit.place(sign({ text: 'FIND YOUR PEOPLE · FIND YOUR PLACE', kind: 'letters', width: 9.6, height: .42, color: '#c19256', weight: 600 }), [0, 6.68, 49.24], Math.PI));
  // Perimeter walls: plastered block panels, pillars, breeze-block band and terracotta coping.
  const run = (x0: number, z0: number, x1: number, z1: number, breeze: boolean) => {
    const len = Math.hypot(x1 - x0, z1 - z0), rot = -Math.atan2(z1 - z0, x1 - x0);
    kit.within([x0, 0, z0], rot, () => {
      const n = Math.max(1, Math.round(len / 3.2)), seg = len / n;
      for (let i = 0; i <= n; i++) kit.box('stuccoCream', [i * seg, 1.35, 0], [.45, 2.7, .45]).box('paintTerracotta', [i * seg, 2.74, 0], [.55, .08, .55]);
      for (let i = 0; i < n; i++) {
        const a = i * seg + .22, b = (i + 1) * seg - .22, mid = (a + b) / 2;
        kit.box('stuccoCream', [mid, .75, 0], [b - a, 1.5, .22]);
        if (breeze) { for (const z of [-.07, .07]) kit.add('breezePanel', new THREE.PlaneGeometry(b - a, .6), { matrix: at(mid, 1.8, z) }); kit.box('stuccoCream', [mid, 2.25, 0], [b - a, .3, .22]); }
        else kit.box('stuccoCream', [mid, 1.95, 0], [b - a, .9, .22]);
        kit.box('paintTerracotta', [mid, 2.43, 0], [b - a + .02, .06, .3]);
      }
    });
  };
  run(-69.6, 50, -8.8, 50, true); run(8.8, 50, 69.6, 50, true);
  run(-69.6, -64.6, 69.6, -64.6, false); run(-69.6, 50, -69.6, -64.6, false); run(69.6, -64.6, 69.6, 50, false);
  // Security gatehouse and a raised boom barrier.
  kit.within([13.3, 0, 48], 0, () => {
    const W = 3.4, D = 3;
    for (const [side, len] of [[0, W], [1, D], [2, W], [3, D]] as const) kit.within(side === 0 ? [0, 0, 0] : side === 1 ? [W, 0, 0] : side === 2 ? [W, 0, -D] : [0, 0, -D], -side * Math.PI / 2, () => {
      const ops = side === 3 ? [{ x0: .9, x1: 1.9, y0: 0, y1: 2.2 }] : [{ x0: .6, x1: len - .6, y0: 1.0, y1: 2.2 }];
      wall(kit, 'stuccoCream', 0, len, 0, 2.8, .2, ops); if (side !== 3) windowUnit(kit, ops[0], { mullion: .8, seed: 200 + side });
    });
    kit.box('concrete', [W / 2, 2.95, -D / 2], [W + 1.2, .25, D + 1.2]).box('paintDark', [0, 1.1, -1.4], [.05, 2.2, .9]);
    c.signs.push(kit.place(sign({ text: 'SECURITY', kind: 'panel', width: 1.6, height: .32, background: '#22382f', color: '#efd394' }), [W / 2, 2.6, .02]));
  });
  kit.box('paintWhite', [6.6, .55, 47.8], [.3, 1.1, .3]).box('darkMetal', [6.6, 1.15, 47.8], [.45, .2, .45]);
  for (let i = 0; i < 8; i++) kit.box(i % 2 ? 'paintWhite' : 'paintTerracotta', [6.6 - Math.cos(1.2) * (.35 + i * .7), 1.2 + Math.sin(1.2) * (.35 + i * .7), 47.8], [.7, .09, .09], { rotZ: -1.2 });
}

function pavilions(c: BuildContext) {
  const { kit } = c;
  // Welcome Pavilion: a white slab roof on slender steel columns with a timber-slat ceiling.
  kit.within([-12, 0, 26], 0, () => {
    kit.box('paintWhite', [0, 3.25, 0], [7.8, .26, 5.6]);
    for (let x = -3.6; x <= 3.6; x += .3) kit.box('wood', [x, 3.08, 0], [.08, .06, 5.2], { shadow: false });
    for (const [x, z] of [[-3.4, -2.3], [3.4, -2.3], [3.4, 2.3], [-3.4, 2.3]]) kit.cylinder('darkMetal', [x, 0, z], .06, .06, 3.12, 10);
    kit.box('paintDark', [0, 1.15, -2.0], [4.6, 1.9, .12]).box('darkMetal', [-2.1, .5, -2.0], [.08, 1, .08]).box('darkMetal', [2.1, .5, -2.0], [.08, 1, .08]);
    c.signs.push(kit.place(sign({ text: 'WELCOME, EXPLORER', kind: 'panel', width: 4.3, height: 1.7, background: '#22382f', color: '#f4e7c8', lines: ['WELCOME, EXPLORER', 'Start the five-stop campus tour here'] }), [0, 1.3, -1.93]));
    c.props.add('pottedPlant', at(-3.4, 0, -1.6)); c.props.add('pottedPlant', at(3.4, 0, -1.6));
  });
  // CampOS Connect service kiosk.
  kit.within([-23, 0, 22], 0, () => {
    kit.box('aluminium', [0, 1.3, 0], [3.8, 2.6, 1.8]).box('paintGreen', [0, .1, 0], [3.9, .2, 1.9]).box('paintWhite', [0, 3.05, .2], [5, .18, 3]);
    for (const x of [-2.3, 2.3]) kit.cylinder('darkMetal', [x, 0, 1.45], .05, .05, 2.96, 8);
    c.signs.push(kit.place(sign({ text: 'CampOS CONNECT', kind: 'panel', width: 2.8, height: 1.05, background: '#14261f', color: '#e9c46a', lines: ['CampOS CONNECT', 'Student services · Tap to begin'] }), [0, 1.45, .915]));
    c.signs.push(kit.place(sign({ text: 'CampOS CONNECT', kind: 'letters', width: 3.6, height: .3, color: '#2f4b40', metalness: .2 }), [0, 2.95, 1.71]));
  });
  // Campus noticeboard with layered event posters.
  kit.within([13, 0, 20.2], 0, () => {
    for (const x of [-1.95, 1.95]) kit.box('wood', [x, 1.4, 0], [.14, 2.8, .14]);
    kit.box('wood', [0, 2.0, 0], [4.1, 1.8, .1]).box('roofGreen', [0, 3.0, .05], [4.6, .05, .8], { rotX: -.25 });
    c.signs.push(kit.place(sign({ text: 'WHAT’S ON', kind: 'panel', width: 3.8, height: 1.55, background: '#c9a979', color: '#22382f', lines: ['WHAT’S ON THIS WEEK', 'Coding circle · Photo walk · Free throws'] }), [0, 2.0, .056]));
  });
  // Shuttle shelter facing the bus bay.
  kit.within([-48, 0, 36], 0, () => {
    for (const x of [-4.2, 4.2]) for (const z of [-1.6, .9]) kit.box('darkMetal', [x, 1.4, z], [.1, 2.8, .1]);
    kit.box('glassClear', [0, 1.45, -1.62], [8.4, 2.2, .03], { shadow: false }).box('paintGreen', [0, 2.9, -.35], [9, .08, 3], { rotX: .08 });
    kit.box('paintDark', [0, 2.6, -1.62], [8.4, .4, .06]);
    c.signs.push(kit.place(sign({ text: 'CAMPUS SHUTTLE', kind: 'panel', width: 4.4, height: .4, background: '#22382f', color: '#efd394' }), [0, 2.6, -1.58]));
    kit.cylinder('steel', [4.8, 0, 1.4], .04, .04, 2.6, 8).box('paintYellow', [4.8, 2.4, 1.4], [.6, .6, .04]);
  });
  // Covered walkways linking the courtyard with the library portico and café terrace.
  for (const [x0, x1] of [[-17.4, -10.6], [10.6, 17.5]]) {
    for (let x = x0 + .3; x <= x1; x += (x1 - x0 - .6) / 2) for (const z of [-1.55, 1.55]) kit.box('darkMetal', [x, 1.5, z], [.1, 3, .1]);
    kit.box('darkMetal', [(x0 + x1) / 2, 3.0, -1.55], [x1 - x0, .14, .08]).box('darkMetal', [(x0 + x1) / 2, 3.0, 1.55], [x1 - x0, .14, .08]);
    kit.box('roofRed', [(x0 + x1) / 2, 3.12, 0], [x1 - x0 + .4, .05, 3.8]).box('paintWhite', [(x0 + x1) / 2, 3.08, 1.92], [x1 - x0 + .4, .16, .04]).box('paintWhite', [(x0 + x1) / 2, 3.08, -1.92], [x1 - x0 + .4, .16, .04]);
  }
}

/** Design Studio D1: an enterable classroom behind the School of Design's ground-floor gallery. */
function classroom(c: BuildContext) {
  const { kit } = c, { x0, x1, z0, z1 } = CLASSROOM, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, F = .16, CEIL = 3.46;
  kit.box('wood', [cx, F / 2 + .001, cz], [x1 - x0, F, z1 - z0]).box('plaster', [cx, CEIL + .05, cz], [x1 - x0, .1, z1 - z0], { shadow: false });
  kit.box('plaster', [cx, (F + CEIL) / 2, z0 - .05], [x1 - x0, CEIL - F, .1]).box('plaster', [x1 + .05, (F + CEIL) / 2, cz], [.1, CEIL - F, z1 - z0]).box('plaster', [x0 + .02, (F + CEIL) / 2, cz], [.04, CEIL - F, z1 - z0]);
  kit.box('wood', [cx, F + .06, z0 + .01], [x1 - x0, .12, .02]).box('wood', [x1 - .01, F + .06, cz], [.02, .12, z1 - z0]);
  // Whiteboard with a marker tray and today's brief.
  kit.box('aluminium', [cx, 1.65, z0 + .02], [3.3, 1.3, .04]).box('paintWhite', [cx, 1.65, z0 + .045], [3.2, 1.2, .01]).box('aluminium', [cx, 1.0, z0 + .08], [1.4, .03, .08]);
  c.signs.push(kit.place(sign({ text: 'STUDIO D1', kind: 'panel', width: 3.0, height: 1.0, background: '#f7f6f1', color: '#2f4b40', lines: ['STUDIO D1 · DESIGN BRIEF', 'Make one corner of campus more welcoming', 'Observe · Sketch · Test · Share'] }), [cx, 1.68, z0 + .052]));
  // Paired student desks (chairs from Chairs), a teacher's desk and a low cabinet.
  for (const [x, z] of CLASSROOM.desks) {
    kit.box('wood', [x, F + .72, z], [1.6, .035, .6]).box('steel', [x, F + .55, z - .27], [1.5, .03, .03]);
    for (const dx of [-.76, .76]) for (const dz of [-.26, .26]) kit.box('steel', [x + dx, F + .36, z + dz], [.035, .72, .035]);
  }
  kit.box('wood', [x0 + 1.2, F + .74, z0 + 1.3], [1.4, .04, .7]).box('wood', [x0 + 1.2, F + .37, z0 + 1.62], [1.36, .7, .03]).box('paintDark', [x0 + .6, F + .4, z0 + 1.3], [.04, .78, .66]).box('paintDark', [x0 + 1.8, F + .4, z0 + 1.3], [.04, .78, .66]);
  kit.box('wood', [x1 - .3, F + .45, cz - .6], [.5, .9, 2.4]);
  for (let i = 0; i < 2; i++) kit.box('emissiveWarm', [cx, CEIL - .01, z0 + 2 + i * 2.6], [2.4, .02, .5], { shadow: false });
  c.lights.push({ position: [cx, 3.1, cz], intensity: 24, distance: 9 });
}

/** Timber-slat bench on cast concrete legs. */
export function bench(kit: Kit, x: number, z: number, rotY: number, length = 1.9) {
  kit.within([x, 0, z], rotY, () => {
    for (const dx of [-length / 2 + .2, length / 2 - .2]) kit.box('concrete', [dx, .22, 0], [.16, .44, .5]);
    for (const dz of [-.17, 0, .17]) kit.box('wood', [0, .47, dz], [length, .05, .13]);
    for (const dy of [.62, .78]) kit.box('wood', [0, dy, -.3], [length, .11, .04], { rotX: -.12 });
    for (const dx of [-length / 2 + .2, length / 2 - .2]) kit.box('darkMetal', [dx, .62, -.27], [.05, .4, .05], { rotX: -.12 });
  });
}

export function buildBuildings(c: BuildContext) {
  library(c); studentHouse(c); auditorium(c);
  academic(c, -62, -42, -53.5, -36.5, { roof: 'roofRed', wallMat: 'stuccoCream', balustrade: 'breeze', name: 'FACULTY OF SCIENCES', seed: 300, monument: [-46, 0, -33.6] });
  academic(c, 31, 53, -52, -34, { roof: 'roofGreen', wallMat: 'stucco', balustrade: 'rail', name: 'SCHOOL OF DESIGN', seed: 400, monument: [47.5, 0, -32.6], classroom: true });
  boundary(c); pavilions(c);
}
