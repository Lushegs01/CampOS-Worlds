// Debug helper: summarize a GLB (nodes with skins, meshes, materials, animations).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(process.argv[2]);
const r = doc.getRoot();
console.log('skins', r.listSkins().map(s => s.listJoints().length), 'nodes', r.listNodes().length);
for (const n of r.listNodes()) if (n.getMesh()) console.log('mesh node', n.getName(), 'skin?', !!n.getSkin(), 'scale', n.getScale(), 'prims', n.getMesh().listPrimitives().map(p => p.getMaterial()?.getName() + ':' + Object.keys(Object.fromEntries(p.listSemantics().map(s => [s, 1]))).join('/')));
console.log('materials', r.listMaterials().map(m => m.getName()), 'textures', r.listTextures().map(t => t.getMimeType() + ' ' + (t.getImage()?.byteLength / 1024 | 0) + 'KB'));
console.log('anims', r.listAnimations().map(a => a.getName() + ':' + a.listChannels().length));
