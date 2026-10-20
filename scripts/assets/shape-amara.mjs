// Amara's clothed adult proportions, baked into her mesh without changing the shared skeleton.
// Included by build-characters.mjs; also upgrades an existing optimized asset in place:
//   node scripts/assets/shape-amara.mjs [input.glb] [output.glb]
import { Matrix3, Matrix4, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { pathToFileURL } from 'node:url';

const VERSION = 'amara-proportions-v1';
const bell = (v, centre, radius) => Math.pow(Math.max(0, 1 - Math.pow((v - centre) / radius, 2)), 3);
const smooth = (lo, hi, v) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

/** Rest-pose coordinates in metres, Y up; the source adult model faces +Z. */
function shape(p, out) {
  // Broad, smooth profiles suit the hoodie and denim rather than making isolated pointed bulges.
  const chest = smooth(1.13, 1.25, p.y) * (1 - smooth(1.34, 1.48, p.y)) * bell(p.x, 0, .34);
  const hips = bell(p.y, .94, .25) * bell(p.x, 0, .38);
  const rear = smooth(.69, .84, p.y) * (1 - smooth(1.00, 1.16, p.y)) * bell(p.x, 0, .32);
  return out.set(
    p.x * (1 + .30 * hips),
    p.y,
    p.z + .07 * chest * smooth(.01, .09, p.z) - .08 * rear * smooth(.015, .11, -p.z),
  );
}

export function shapeAmara(doc) {
  if (doc.getRoot().getExtras().bodyShape === VERSION) return false;
  const p = new Vector3(), target = new Vector3(), plus = new Vector3(), minus = new Vector3();
  const blend = new Matrix4(), inv = new Matrix4(), deform = new Matrix4(), jacobian = new Matrix4();
  const n = new Vector3(), normalMatrix = new Matrix3(), epsilon = 1e-4;
  let changed = 0;
  for (const node of doc.getRoot().listNodes()) {
    const skin = node.getSkin(), mesh = node.getMesh(); if (!skin || !mesh) continue;
    const inverseBind = skin.getInverseBindMatrices();
    const bones = skin.listJoints().map((joint, i) => new Matrix4().fromArray(joint.getWorldMatrix())
      .multiply(new Matrix4().fromArray(inverseBind.getElement(i, []))));
    for (const primitive of mesh.listPrimitives()) {
      if (!/body$/.test(primitive.getMaterial()?.getName() ?? '')) continue;
      const position = primitive.getAttribute('POSITION'), normal = primitive.getAttribute('NORMAL');
      const joints = primitive.getAttribute('JOINTS_0'), weights = primitive.getAttribute('WEIGHTS_0');
      for (let i = 0; i < position.getCount(); i++) {
        const indices = joints.getElement(i, []), influence = weights.getElement(i, []);
        blend.elements.fill(0);
        for (let j = 0; j < 4; j++) for (let k = 0; k < 16; k++) blend.elements[k] += bones[indices[j]].elements[k] * influence[j];
        p.fromArray(position.getElement(i, [])).applyMatrix4(blend);
        shape(p, target); if (p.distanceToSquared(target) < 1e-14) continue;
        inv.copy(blend).invert(); position.setElement(i, target.applyMatrix4(inv).toArray());
        // Transform the existing smooth normals through the deformation's Jacobian. This preserves
        // fabric shading and UV seams, unlike flattening or re-smoothing the entire character.
        jacobian.identity();
        for (let axis = 0; axis < 3; axis++) {
          plus.copy(p).setComponent(axis, p.getComponent(axis) + epsilon); shape(plus, plus);
          minus.copy(p).setComponent(axis, p.getComponent(axis) - epsilon); shape(minus, minus);
          const derivative = plus.sub(minus).multiplyScalar(.5 / epsilon);
          for (let row = 0; row < 3; row++) jacobian.elements[axis * 4 + row] = derivative.getComponent(row);
        }
        deform.copy(inv).multiply(jacobian).multiply(blend);
        if (normal) { normalMatrix.getNormalMatrix(deform); n.fromArray(normal.getElement(i, [])).applyMatrix3(normalMatrix).normalize(); normal.setElement(i, n.toArray()); }
        const tangent = primitive.getAttribute('TANGENT');
        if (tangent) { const t = tangent.getElement(i, []); n.fromArray(t).transformDirection(deform); tangent.setElement(i, [...n.toArray(), t[3]]); }
        changed++;
      }
    }
  }
  if (!changed) throw new Error('Amara body geometry was not found; refusing to mark an unchanged asset.');
  doc.getRoot().setExtras({ ...doc.getRoot().getExtras(), bodyShape: VERSION });
  console.log(`Amara: shaped ${changed} clothed body vertices; skeleton, weights, head and feet preserved.`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const input = process.argv[2] ?? 'public/assets/characters/amara.glb', output = process.argv[3] ?? input;
  const doc = await io.read(input);
  if (shapeAmara(doc)) { await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' })); await io.write(output, doc); }
  else console.log('Amara already has these proportions.');
}
