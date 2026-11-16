// Split a moving part out of a weapon model whose source fused it into one mesh (the Wasp's and Kestrel's
// magazines, the Bastion's pump, the Thorn's cylinder). Triangles whose centroid lies inside a side-view polygon (z back from the muzzle, y up from the bore, in
// the normalised model's metres) and within |x| < halfWidth move into a new node with that name, so the viewmodel can
// drop, carry and insert it. Positions are baked to model space; the viewmodel re-pivots every part on its own top.
// Usage: node scripts/assets/split-weapon-part.mjs [id ...]   (idempotent: skips a model that already has the part)
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** id → part, polygon [[z, y] …] (side view) and half-width. Measured from `arena-weapons.mjs sheet`. */
export const SPLITS = {
  wasp: { part: 'mag', poly: [[.168, -.046], [.218, -.046], [.152, -.232], [.106, -.222]], half: .025 },
  kestrel: { part: 'mag', poly: [[.412, -.034], [.478, -.034], [.452, -.196], [.38, -.186]], half: .028 },
  // The Bastion's ribbed pump forend under the barrel (it slides back and forward to cycle each shell).
  bastion: { part: 'pump', poly: [[.175, -.0045], [.366, -.0045], [.366, -.043], [.175, -.043]], half: .03 },
  // The Thorn's cylinder, between the frame's top strap and the crane (it turns one chamber per shot).
  thorn: { part: 'cylinder', poly: [[.096, .0065], [.146, .0065], [.146, -.031], [.096, -.031]], half: .023 },
};
const inside = (poly, z, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [zi, yi] = poly[i], [zj, yj] = poly[j]; if ((yi > y) !== (yj > y) && z < (zj - zi) * (y - yi) / (yj - yi) + zi) c = !c; } return c; };

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SPLITS);
for (const id of ids) {
  const spec = SPLITS[id], file = `public/assets/arena/weapons/${id}.glb`;
  const doc = await io.read(file), root = doc.getRoot(), scene = root.listScenes()[0];
  if (root.listNodes().some(n => n.getName() === spec.part)) { console.log(`${id}: already has '${spec.part}'`); continue; }
  const partMesh = doc.createMesh(spec.part); let moved = 0, kept = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(); if (!idx) continue;
      const world = i => { const p = pos.getElement(i, []); return [W[0] * p[0] + W[4] * p[1] + W[8] * p[2] + W[12], W[1] * p[0] + W[5] * p[1] + W[9] * p[2] + W[13], W[2] * p[0] + W[6] * p[1] + W[10] * p[2] + W[14]]; };
      const keep = [], take = [];
      for (let t = 0; t < idx.getCount(); t += 3) {
        const tri = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)], c = [0, 0, 0];
        for (const v of tri) { const p = world(v); c[0] += p[0] / 3; c[1] += p[1] / 3; c[2] += p[2] / 3; }
        (Math.abs(c[0]) < spec.half && inside(spec.poly, c[2], c[1]) ? take : keep).push(...tri);
      }
      if (!take.length) continue;
      // The part: its own copy of the referenced vertices, baked to model space.
      const map = new Map(), order = []; for (const v of take) if (!map.has(v)) { map.set(v, order.length); order.push(v); }
      const np = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
      const N = new Float32Array(16); N.set(W); // normals: the weapons are only rotated + uniformly scaled
      for (const sem of prim.listSemantics()) {
        const a = prim.getAttribute(sem), size = a.getElementSize(), out = new Float32Array(order.length * size), el = [];
        order.forEach((v, i) => {
          a.getElement(v, el);
          if (sem === 'POSITION') el.splice(0, 3, ...world(v));
          else if (sem === 'NORMAL' || sem === 'TANGENT') { const [x, y, z] = el, n = [W[0] * x + W[4] * y + W[8] * z, W[1] * x + W[5] * y + W[9] * z, W[2] * x + W[6] * y + W[10] * z], l = Math.hypot(...n) || 1; el.splice(0, 3, n[0] / l, n[1] / l, n[2] / l); }
          out.set(el.slice(0, size), i * size);
        });
        np.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(out));
      }
      np.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(take.map(v => map.get(v)))));
      partMesh.addPrimitive(np);
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)));
      moved += take.length / 3; kept += keep.length / 3;
    }
  }
  if (!moved) { console.log(`${id}: nothing inside the region`); continue; }
  scene.addChild(doc.createNode(spec.part).setMesh(partMesh));
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(file, doc);
  console.log(`${id}: '${spec.part}' ${moved} triangles split from ${moved + kept}; ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
