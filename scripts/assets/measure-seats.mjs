// Measures seat height and facing for chair-like props so seat anchors are data, not guesses.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { getBounds } from '@gltf-transform/functions';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const name of process.argv.slice(2)) {
  const doc = await io.read(`public/assets/props/${name}.glb`), scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene); const pts = [];
  for (const node of doc.getRoot().listNodes()) { const mesh = node.getMesh(); if (!mesh) continue; const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) { const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), v = [0, 0, 0], n = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); nor?.getElement(i, n); const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]; pts.push([x, y, z, n[1]]); } } }
  const H = b.max[1];
  // Seat: most populated band of upward-facing vertices between 30% and 70% of the height.
  const hist = new Map(); for (const [, y, , ny] of pts) if (ny > .7 && y > H * .3 && y < H * .7) { const k = Math.round(y * 50) / 50; hist.set(k, (hist.get(k) ?? 0) + 1); }
  const seatY = [...hist.entries()].sort((a, c) => c[1] - a[1])[0]?.[0];
  // Backrest: centroid of the vertices above the seat; the sitter faces away from it.
  const high = pts.filter(p => p[1] > (seatY ?? H * .5) + .15), cx = high.reduce((s, p) => s + p[0], 0) / high.length, cz = high.reduce((s, p) => s + p[2], 0) / high.length;
  console.log(name.padEnd(12), 'bounds', b.min.map(v => v.toFixed(2)).join(','), '→', b.max.map(v => v.toFixed(2)).join(','), 'seatY', seatY, 'backrest centroid x', cx.toFixed(2), 'z', cz.toFixed(2));
}
