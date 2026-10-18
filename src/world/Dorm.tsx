// The residents' wing behind Palm House (shared/dorm.mjs) and the furniture in your room.
// The wing is ordinary campus architecture, seen by everyone. The furniture is drawn only while you are
// in your room, from the layout the room server gave you.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Kit, wall, windowUnit } from './architecture/kit';
import { sign, place } from './architecture/signage';
import { DORM_ROOM, DORM_DOOR, DORM_W, DORM_D, FURNITURE, TONES } from '../../shared/dorm.mjs';
import { useDorm, type DormLayout } from '../dorm/client';
import type { Materials } from './materials';
import { freeze } from './rendering';

const H = 3, OUTER = 3.4, cx = (DORM_ROOM.x0 + DORM_ROOM.x1) / 2, cz = (DORM_ROOM.z0 + DORM_ROOM.z1) / 2;
/** The window in the north wall, room-relative x (from the west wall). */
const WINDOW = { x0: 3.1, x1: 4.7, y0: 1.05, y1: 2.35 };

/** Walls, roof and window of the wing, the room's inner surfaces, and the door on both sides. Returns the signs. */
export function residentsWing(kit: Kit): THREE.Object3D[] {
  // Outer walls on the shared colliders (the fourth side is Palm House's back wall).
  for (const s of [-1, 1]) kit.box('stucco', [s < 0 ? DORM_ROOM.x0 - .15 : DORM_ROOM.x1 + .15, OUTER / 2, (DORM_ROOM.z0 - .3 + DORM_ROOM.z1 + .2) / 2], [.3, OUTER, DORM_D + .5]);
  // North wall with the window: a facade running west to east seen from the north (rotated half a turn).
  kit.within([cx, 0, DORM_ROOM.z0 - .3], Math.PI, () => {
    const o = { x0: DORM_W / 2 - WINDOW.x1, x1: DORM_W / 2 - WINDOW.x0, y0: WINDOW.y0, y1: WINDOW.y1 };
    wall(kit, 'stucco', -DORM_W / 2 - .3, DORM_W / 2 + .3, 0, OUTER, .3, [o]);
    windowUnit(kit, o, { mullion: .8, frame: 'aluminium', seed: 7, tint: 'clear' });
    kit.box('concrete', [0, .2, .04], [DORM_W + .7, .4, .08]);
  });
  // Roof: no shadow from it, as if lit by roof lights, so the room is not left in the dark.
  kit.box('concrete', [cx, OUTER + .1, (DORM_ROOM.z0 - .3 + DORM_ROOM.z1 + .2) / 2], [DORM_W + .9, .2, DORM_D + .8], { shadow: false });
  kit.box('paintWhite', [cx, OUTER + .35, DORM_ROOM.z0 - .35], [DORM_W + .9, .3, .12], { shadow: false });
  // Inside: timber floor, painted walls and ceiling, a ceiling light, and blinds behind Palm House's back windows.
  kit.box('wood', [cx, .01, cz], [DORM_W, .02, DORM_D], { shadow: false });
  kit.box('paintWhite', [cx, H + .01, cz], [DORM_W, .02, DORM_D], { shadow: false });
  kit.box('emissiveWarm', [cx, H - .01, cz], [1.2, .02, 1.2], { shadow: false });
  kit.box('plaster', [DORM_ROOM.x0 + .01, H / 2, cz], [.02, H, DORM_D], { shadow: false });
  kit.box('plaster', [DORM_ROOM.x1 - .01, H / 2, cz], [.02, H, DORM_D], { shadow: false });
  for (const [a, b] of [[0, WINDOW.x0], [WINDOW.x1, DORM_W]]) kit.box('plaster', [DORM_ROOM.x0 + (a + b) / 2, H / 2, DORM_ROOM.z0 + .01], [b - a, H, .02], { shadow: false });
  kit.box('plaster', [DORM_ROOM.x0 + (WINDOW.x0 + WINDOW.x1) / 2, WINDOW.y0 / 2, DORM_ROOM.z0 + .01], [WINDOW.x1 - WINDOW.x0, WINDOW.y0, .02], { shadow: false });
  kit.box('plaster', [DORM_ROOM.x0 + (WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y1 + H) / 2, DORM_ROOM.z0 + .01], [WINDOW.x1 - WINDOW.x0, H - WINDOW.y1, .02], { shadow: false });
  // Palm House's back facade faces into the wing (its plinth and sills stand 8–9 cm proud); its lower
  // windows reach 3.5 m, so the blinds behind them run up to the roof.
  kit.box('fabricShade', [cx, OUTER / 2, DORM_ROOM.z1 - .01], [DORM_W, OUTER, .02], { shadow: false });
  // The door, drawn on both faces of the back wall: from the common room and from inside the room.
  for (const [z, facing] of [[DORM_DOOR.outsideFace + .02, 1], [DORM_DOOR.insideFace - .11, -1]] as const) {
    kit.box('wood', [DORM_DOOR.x, 1.05, z], [1, 2.1, .05]);
    kit.box('darkMetal', [DORM_DOOR.x, 2.14, z], [1.12, .08, .07]);
    for (const dx of [-.54, .54]) kit.box('darkMetal', [DORM_DOOR.x + dx, 1.07, z], [.06, 2.14, .07]);
    kit.box('chrome', [DORM_DOOR.x + .36, 1.02, z + facing * .05], [.14, .03, .04]);
  }
  return [
    place(sign({ text: 'RESIDENTS’ ROOMS', kind: 'panel', width: 1.5, height: .26, background: '#233e34', color: '#f7ead2' }), [DORM_DOOR.x, 2.5, DORM_DOOR.outsideFace + .05]),
    place(sign({ text: 'COMMON ROOM', kind: 'panel', width: 1.3, height: .24, background: '#233e34', color: '#f7ead2' }), [DORM_DOOR.x, 2.45, DORM_DOOR.insideFace - .15], Math.PI),
  ];
}

// ---------------------------------------------------------------- furniture
const toneMaterials = TONES.map((color, i) => new THREE.MeshStandardMaterial({ name: `dorm-tone-${i}`, color, roughness: .92 }));
const leaves = new THREE.MeshStandardMaterial({ name: 'dorm-leaves', color: '#3f6b3a', roughness: .8 });
const BOOKS = ['#7a3b2e', '#2f4f6f', '#c9a14a', '#4b6b4a', '#8a5a7a', '#d8cdb5'];

/** Parts grouped by material and merged: a furnished room is a handful of draw calls. */
class Parts {
  private map = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(material: THREE.Material, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) { const g = geometry.applyMatrix4(matrix); (this.map.get(material) ?? this.map.set(material, []).get(material)!).push(g); }
  build() {
    const group = new THREE.Group(); group.name = 'dorm-furniture';
    for (const [material, list] of this.map) {
      const geometry = mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g), false); list.forEach(g => g.dispose());
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; group.add(mesh);
    }
    return group;
  }
}
const at = (base: THREE.Matrix4, x: number, y: number, z: number) => base.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z));

/** One piece in its own frame: centred on the origin, standing on y = 0, front towards +z. */
function piece(parts: Parts, lib: Materials, t: string, tone: THREE.Material, m: THREE.Matrix4) {
  const box = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => parts.add(mat, new THREE.BoxGeometry(w, h, d), at(m, x, y, z));
  const cyl = (mat: THREE.Material, r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 14) => parts.add(mat, new THREE.CylinderGeometry(r0, r1, h, seg), at(m, x, y, z));
  const f = FURNITURE[t as keyof typeof FURNITURE];
  if (t === 'bed') {
    box(lib.wood, 2, .28, 1, 0, .14, 0); box(lib.fabricShade, 1.9, .18, .92, .02, .37, 0);
    box(tone, 1.3, .06, .96, .3, .47, 0); box(lib.wood, .08, .9, 1, -.98, .45, 0); box(lib.paintWhite, .34, .1, .62, -.7, .5, 0);
  } else if (t === 'nightstand') {
    box(lib.wood, .5, .52, .4, 0, .26, 0); box(lib.darkMetal, .3, .02, .01, 0, .38, .2);
    cyl(lib.darkMetal, .05, .07, .03, .1, .535, -.05); cyl(lib.fabricShade, .07, .1, .14, .1, .62, -.05);
  } else if (t === 'desk') {
    box(lib.wood, 1.25, .04, .6, 0, .74, 0);
    for (const x of [-.58, .58]) for (const z of [-.26, .26]) box(lib.darkMetal, .04, .72, .04, x, .36, z);
    box(lib.wood, .4, .3, .5, .38, .57, 0); box(lib.darkMetal, .45, .3, .03, -.2, .93, -.22); box(lib.paintDark, .42, .26, .01, -.2, .93, -.205);
  } else if (t === 'chair') {
    box(lib.paintDark, .46, .06, .44, 0, .46, 0); box(lib.paintDark, .44, .42, .05, 0, .72, -.2);
    for (const x of [-.19, .19]) for (const z of [-.18, .18]) box(lib.darkMetal, .03, .44, .03, x, .22, z);
  } else if (t === 'wardrobe') {
    box(lib.wood, 1, 1.98, .6, 0, .99, 0); box(lib.darkMetal, .015, 1.8, .01, 0, 1, .301);
    for (const x of [-.07, .07]) box(lib.chrome, .02, .22, .03, x, 1.05, .31);
  } else if (t === 'shelf') {
    for (const x of [-.39, .39]) box(lib.wood, .03, 1.6, .3, x, .8, 0);
    for (const y of [.03, .42, .81, 1.2, 1.585]) box(lib.wood, .78, .03, .3, 0, y, 0);
    let k = 0; for (const y of [.05, .44, .83]) for (let x = -.33; x < .3; x += .075, k++) parts.add(bookMaterial(k), new THREE.BoxGeometry(.06, .26 + (k % 3) * .04, .2), at(m, x, y + .14 + (k % 3) * .02, .02));
  } else if (t === 'beanbag') {
    parts.add(tone, new THREE.SphereGeometry(.4, 16, 10).scale(1, .62, 1), at(m, 0, .27, 0));
  } else if (t === 'lamp') {
    cyl(lib.darkMetal, .14, .15, .03, 0, .015, 0); cyl(lib.darkMetal, .015, .015, 1.4, 0, .72, 0); cyl(lib.emissiveWarm, .1, .16, .22, 0, 1.48, 0);
  } else if (t === 'plant') {
    cyl(lib.paintTerracotta, .17, .13, .32, 0, .16, 0);
    for (const [x, y, z, r] of [[0, .62, 0, .22], [.08, .82, .04, .16], [-.07, .78, -.05, .15], [0, .98, .02, .11]]) parts.add(leaves, new THREE.IcosahedronGeometry(r, 1), at(m, x, y, z));
  } else if (t === 'rug') {
    box(tone, f.w, .012, f.d, 0, .026, 0); box(lib.fabricShade, f.w - .16, .013, f.d - .16, 0, .027, 0); box(tone, f.w - .3, .014, f.d - .3, 0, .028, 0);
  }
}
const bookMaterials = new Map<number, THREE.Material>();
const bookMaterial = (k: number) => { const i = k % BOOKS.length; let mat = bookMaterials.get(i); if (!mat) bookMaterials.set(i, mat = new THREE.MeshStandardMaterial({ color: BOOKS[i], roughness: .8 })); return mat; };

export function buildFurniture(layout: DormLayout, lib: Materials) {
  const parts = new Parts();
  for (const it of layout.items) {
    if (!(it.t in FURNITURE)) continue;
    // A quarter turn r rotates the front (+z) towards +x for r = 1 (shared/dorm.mjs swaps width and depth to match).
    const m = new THREE.Matrix4().makeRotationY(it.r * Math.PI / 2).setPosition(DORM_ROOM.x0 + it.x, 0, DORM_ROOM.z0 + it.z);
    piece(parts, lib, it.t, toneMaterials[it.c] ?? toneMaterials[0], m);
  }
  return parts.build();
}

/** Your furniture, while you are in your room. */
export function DormFurniture({ lib }: { lib: Materials }) {
  const layout = useDorm(s => s.inside ? s.layout : null);
  const group = useMemo(() => layout ? freeze(buildFurniture(layout, lib)) : null, [layout, lib]);
  useEffect(() => () => { group?.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); }, [group]);
  return group ? <primitive object={group} /> : null;
}
