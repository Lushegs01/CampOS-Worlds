import * as THREE from 'three';

// Small things campus characters carry in the documents-holding pose (the Rocketbox `documents_idle`
// capture the avatar already uses for holding). Built from a few boxes and cylinders whose geometries and
// materials are shared by every character: nothing is downloaded, and nothing is created per frame.
type Part = [geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number]];
let parts: Record<string, Part[]> | null = null;
function build() {
  const m = (color: string, roughness = .7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const dark = m('#1d2124', .35, .4), screen = m('#2d4c5a', .2, .1), board = m('#8a5a35', .8), paper = m('#f1ede2', .9), cup = m('#f4efe6', .6), sleeve = m('#9a6a3e', .85), lid = m('#2a2523', .5), cover = m('#7b2f2a', .75);
  return {
    // Held flat in front, screen up, tipped towards the holder (the group's rotation does the tipping).
    tablet: [[new THREE.BoxGeometry(.26, .012, .19), dark, [0, 0, 0]], [new THREE.BoxGeometry(.235, .002, .165), screen, [0, .007, 0]]],
    clipboard: [[new THREE.BoxGeometry(.23, .008, .31), board, [0, 0, 0]], [new THREE.BoxGeometry(.2, .002, .26), paper, [0, .005, .015]], [new THREE.BoxGeometry(.08, .014, .03), dark, [0, .008, -.135]]],
    book: [[new THREE.BoxGeometry(.17, .035, .24), cover, [0, 0, 0]], [new THREE.BoxGeometry(.16, .03, .23), paper, [.006, 0, 0]]],
    // A takeaway cup stands upright between the hands.
    cup: [[new THREE.CylinderGeometry(.04, .032, .11, 14), cup, [0, .03, 0]], [new THREE.CylinderGeometry(.041, .037, .045, 14), sleeve, [0, .03, 0]], [new THREE.CylinderGeometry(.043, .043, .012, 14), lid, [0, .09, 0]]],
  } satisfies Record<string, Part[]>;
}
/** A new group for a prop (its meshes share geometry and materials with every other copy). */
export function makeProp(kind: string): THREE.Group {
  parts ??= build();
  const g = new THREE.Group(); g.name = `npc-prop:${kind}`; g.visible = false; g.userData.upright = kind === 'cup';
  for (const [geometry, material, [x, y, z]] of parts[kind] ?? []) { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); }
  return g;
}
