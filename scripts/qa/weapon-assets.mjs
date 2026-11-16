// Weapon asset completeness, measured from the files (not from documentation): every weapon in the catalogue, its
// first- and third-person models, size, moving parts, calibration and sound profile.
// Usage: node scripts/qa/weapon-assets.mjs            → prints a Markdown table
//        import { weaponAssetRows } from this file    (tests/arena-weapon-anchors.test.mjs)
import { statSync, existsSync } from 'node:fs';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { WEAPONS } from '../../shared/arena/weapons.mjs';
import { SPECS, anchorProblems } from '../../src/arena/scene/weaponSpecs.ts';

const DIR = 'public/assets/arena/weapons/';
let io;
async function read(file) {
  if (!io) { await MeshoptDecoder.ready; io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }); }
  const doc = await io.read(file), root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(), n = i ? i.getCount() : p.getAttribute('POSITION').getCount(); tris += n / 3; }
  return { bounds: getBounds(scene), nodes: root.listNodes().map(n => n.getName()), tris: Math.round(tris), textures: root.listTextures().map(t => t.getMimeType()) };
}
export async function weaponAssetRows() {
  const rows = [];
  for (const w of WEAPONS) {
    const fp = `${DIR}${w.id}.glb`, tp = `${DIR}${w.id}-lod.glb`, row = { id: w.id, name: w.name, category: w.category, fire: w.fire, sound: w.sound ?? w.id };
    row.fp = existsSync(fp) ? { kb: Math.round(statSync(fp).size / 1024), ...(await read(fp)) } : null;
    row.tp = existsSync(tp) ? { kb: Math.round(statSync(tp).size / 1024), ...(await read(tp)) } : null;
    row.spec = SPECS[w.id] ?? null; row.problems = anchorProblems(w);
    // Anchors must lie on the model (within 3 cm of its bounds): a grip floating off the gun is a calibration error.
    if (row.fp && row.spec) {
      const { min, max } = row.fp.bounds, tol = .03;
      const pts = { grip: row.spec.grip, sight: row.spec.sight, ...(w.fire === 'melee' ? {} : { fore: row.spec.fore, mag: row.spec.mag }) };
      for (const [k, [y, z]] of Object.entries(pts)) if (y < min[1] - tol || y > max[1] + tol || z < min[2] - tol || z > max[2] + tol) row.problems.push(`${w.id}: ${k} (${y}, ${z}) off the model (y ${min[1].toFixed(3)}…${max[1].toFixed(3)}, z ${min[2].toFixed(3)}…${max[2].toFixed(3)})`);
    }
    row.parts = row.fp ? ['mag', 'bolt', 'slide', 'pump', 'cylinder'].filter(p => row.fp.nodes.includes(p)) : [];
    rows.push(row);
  }
  return rows;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await weaponAssetRows();
  console.log('| Weapon | Class | First-person (KB, tris, textures) | Third-person LOD (KB, tris) | Moving parts | Hold | Anchor check | Sound |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.name} (\`${r.id}\`) | ${r.category} | ${r.fp ? `${r.fp.kb}, ${r.fp.tris}, ${[...new Set(r.fp.textures)].join('/') || 'none'}` : '**missing**'} | ${r.tp ? `${r.tp.kb}, ${r.tp.tris}` : '**missing**'} | ${r.parts.join(', ') || '—'} | ${r.spec?.hold ?? '**none**'} | ${r.problems.length ? r.problems.join('; ') : 'pass'} | ${r.sound} |`);
}
