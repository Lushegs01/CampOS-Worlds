// Door leaves for every door in a map (shared/arena/doors.mjs): single leaves, or a pair in an opening wider than
// 1.3 m; painted panels with a glazed upper half on tall commercial doors, and a pull handle each side. They swing
// about their hinges toward what the shared world says (the server's state), over the same time the server lets a door
// take to move. Three instanced meshes for all of them (bodies, glass, handles): three draw calls per map.
import * as THREE from 'three';
import { DOOR_SWING_MS, doorLeafPlan, doorOpen } from '../../../shared/arena/doors.mjs';

interface Door { i: number; min: number[]; max: number[]; alongZ: boolean; w: number; h: number; leaves?: { hinge: number; dir: number; w: number; h: number; y0: number; swing: number; angle: number }[] }
interface Leaf { door: number; hinge: number; dir: 1 | -1; w: number; h: number; y0: number; glazed: boolean; basis: THREE.Matrix4; swing: number; angle: number }

const THICK = .05;
const PAINT = ['#3b2a1f', '#2d3a31', '#3a3f45', '#1f2c3d', '#5b4632', '#6d6a63'];
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _s = new THREE.Matrix4(), _c = new THREE.Color();

export function createDoorLeaves(doors: Door[], shadows: boolean) {
  const leaves: Leaf[] = [];
  for (const d of doors) {
    // Wall frame: u along the wall, n across it (right-handed, so no instance is mirrored).
    const basis = new THREE.Matrix4();
    if (d.alongZ) basis.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)).setPosition((d.min[0] + d.max[0]) / 2, 0, 0);
    else basis.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)).setPosition(0, 0, (d.min[2] + d.max[2]) / 2);
    // The same leaves the collision world places (shared/arena/doors.mjs), so what is drawn is what blocks.
    const glazed = d.h > 2.6;
    for (const l of d.leaves ?? doorLeafPlan(d)) leaves.push({ door: d.i, hinge: l.hinge, dir: l.dir as 1 | -1, w: l.w, h: l.h, y0: l.y0, glazed, basis, swing: l.swing, angle: l.angle });
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .58, metalness: .05 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#2a3238', roughness: .08, metalness: .2, envMapIntensity: 1.6 });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#b9bcbd', roughness: .3, metalness: .9 });
  const n = leaves.length, glazedN = leaves.filter(l => l.glazed).length;
  const bodies = new THREE.InstancedMesh(box, bodyMat, Math.max(1, n * 3)), glass = new THREE.InstancedMesh(box, glassMat, Math.max(1, glazedN)), handles = new THREE.InstancedMesh(box, steelMat, Math.max(1, n * 2));
  for (const im of [bodies, glass, handles]) { im.castShadow = shadows; im.receiveShadow = true; im.frustumCulled = false; im.name = 'doors'; }
  // One paint per door (both leaves of a pair match), from a small palette of door colours.
  leaves.forEach((l, k) => { _c.set(PAINT[(l.door * 7 + 3) % PAINT.length]); for (let j = 0; j < 3; j++) bodies.setColorAt(k * 3 + j, _c); });
  const group = new THREE.Group(); group.name = 'doors'; group.add(bodies, glass, handles);
  const state = new Float32Array(doors.length).fill(1), drawn = new Float32Array(doors.length);

  /** Place leaf k at openness t (0 shut … 1 open). */
  const pose = (l: Leaf, k: number, gi: number, t: number) => {
    const e = t * t * (3 - 2 * t), ang = -l.swing * l.dir * l.angle * e;
    // hinge frame: basis · T(hinge, y0, 0) · RY(ang)
    const H = _m.copy(l.basis).multiply(_t.makeTranslation(l.hinge, l.y0, 0)).multiply(_r.makeRotationY(ang));
    const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => H.clone().multiply(_t.makeTranslation(l.dir * x, y, z)).multiply(_s.makeScale(sx, sy, sz));
    if (l.glazed) {
      // Stiles and rails round a glazed upper half, a solid lower panel.
      const gy0 = l.h * .42, gy1 = l.h - .14, frameW = .1;
      bodies.setMatrixAt(k * 3, part(l.w / 2, gy0 / 2, 0, l.w, gy0, THICK));
      bodies.setMatrixAt(k * 3 + 1, part(l.w / 2, gy1 + (l.h - gy1) / 2, 0, l.w, l.h - gy1, THICK));
      bodies.setMatrixAt(k * 3 + 2, part(frameW / 2, (gy0 + gy1) / 2, 0, frameW, gy1 - gy0, THICK)); // hinge stile (the latch stile is the glass edge)
      glass.setMatrixAt(gi, part(frameW + (l.w - frameW - .06) / 2, (gy0 + gy1) / 2, 0, l.w - frameW - .06, gy1 - gy0, .012));
    } else {
      bodies.setMatrixAt(k * 3, part(l.w / 2, l.h / 2, 0, l.w, l.h, THICK));
      // Raised panels each side (a little relief so the leaf reads as a door, not a board).
      bodies.setMatrixAt(k * 3 + 1, part(l.w / 2, l.h * .7, 0, l.w - .22, l.h * .36, THICK + .016));
      bodies.setMatrixAt(k * 3 + 2, part(l.w / 2, l.h * .27, 0, l.w - .22, l.h * .36, THICK + .016));
    }
    // Pull handles on both faces, near the latch edge.
    for (const s of [-1, 1]) handles.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), part(l.w - .1, 1.02, s * (THICK / 2 + .025), .03, .32, .03));
  };
  /** Per frame: swing each door toward the world's state (only what moved is rewritten). */
  const update = (dt: number, world: Parameters<typeof doorOpen>[0] | null) => {
    if (!world) return;
    let dirty = false;
    for (let i = 0; i < doors.length; i++) {
      const want = doorOpen(world, i) ? 1 : 0;
      state[i] += Math.sign(want - state[i]) * Math.min(Math.abs(want - state[i]), dt * 1000 / DOOR_SWING_MS);
    }
    let gi = 0;
    leaves.forEach((l, k) => { if (state[l.door] !== drawn[l.door]) { pose(l, k, gi, state[l.door]); dirty = true; } if (l.glazed) gi++; });
    drawn.set(state);
    if (dirty) { bodies.instanceMatrix.needsUpdate = glass.instanceMatrix.needsUpdate = handles.instanceMatrix.needsUpdate = true; }
    return dirty;
  };
  // Initial pose: every door open (as the world starts).
  { let gi = 0; leaves.forEach((l, k) => { pose(l, k, gi, 1); if (l.glazed) gi++; }); drawn.fill(1); if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true; }
  const dispose = () => { box.dispose(); bodyMat.dispose(); glassMat.dispose(); steelMat.dispose(); };
  return { group, update, dispose, count: leaves.length };
}
