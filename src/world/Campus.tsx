import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Kit } from './architecture/kit';
import { buildBuildings, type BuildContext } from './architecture/buildings';
import { buildHardscape } from './architecture/hardscape';
import { Placements, PROP_FILES, DETAIL_PROPS, type PropFile } from './placements';
import { NOISE_GLSL, type Materials } from './materials';
import { loadModel } from './assets';
import { PLAZA, SURFACE_Y } from './layout';
import type { QualityProfile } from './quality';
import { freeze, prepare } from './rendering';

function wireTexture(cell: number, line: number, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
  x.strokeStyle = color; x.lineWidth = line; x.lineCap = 'round';
  for (let i = -64; i <= 128; i += cell) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

function strip(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, repeat: number) {
  const len = Math.hypot(x1 - x0, z1 - z0), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len / repeat, 0, len / repeat, (y1 - y0) / repeat, 0, 0, len / repeat, (y1 - y0) / repeat, 0, (y1 - y0) / repeat], 2));
  g.computeVertexNormals(); return g;
}

export function buildCampus(lib: Materials) {
  const c: BuildContext = { kit: new Kit(), signs: [], props: new Placements(), lights: [], books: [], chainLink: [], hoopNets: [], goalNets: [] };
  buildBuildings(c); buildHardscape(c);
  const group = c.kit.build(lib, 'campus');
  for (const s of c.signs) group.add(s);
  // Thousands of book spines in one instanced draw call.
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: .78, envMapIntensity: .45 }), c.books.length);
  c.books.forEach((b, i) => { books.setMatrixAt(i, b.matrix); books.setColorAt(i, b.color); });
  books.receiveShadow = true; books.computeBoundingSphere(); books.name = 'books'; group.add(books);
  // Chain-link fencing and sports nets: alpha-tested wire textures.
  const chain = new THREE.MeshStandardMaterial({ color: '#9aa0a2', metalness: .7, roughness: .45, alphaMap: wireTexture(21, 1.2), alphaTest: .5, side: THREE.DoubleSide });
  const fence = c.chainLink.map(f => strip(f.x0, f.z0, f.x1, f.z1, .05, f.height, .1));
  if (fence.length) { const mesh = new THREE.Mesh(mergeAll(fence), chain); mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: chain.alphaMap, alphaTest: .45 }); group.add(mesh); }
  const netMat = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: .9, alphaMap: wireTexture(21, 2.2), alphaTest: .45, side: THREE.DoubleSide });
  const nets: THREE.BufferGeometry[] = [];
  for (const h of c.hoopNets) nets.push(new THREE.CylinderGeometry(.225, .16, .42, 16, 1, true).translate(h.x, 2.84, h.z));
  for (const g of c.goalNets) {
    const back = g.z + g.dir * .9;
    nets.push(strip(g.x - 2.5, back, g.x + 2.5, back, 0, 2, .12), strip(g.x - 2.5, g.z, g.x - 2.5, back, 0, 2, .12), strip(g.x + 2.5, g.z, g.x + 2.5, back, 0, 2, .12));
    const top = new THREE.PlaneGeometry(5, .9).rotateX(-Math.PI / 2).translate(g.x, 2, (g.z + back) / 2); const uv = top.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40, uv.getY(i) * 7.5); nets.push(top);
  }
  if (nets.length) group.add(new THREE.Mesh(mergeAll(nets), netMat));
  return { group: freeze(group), context: c, books };
}

/** Hide fine interior detail (thousands of book spines) unless the camera is near. */
export function DistanceCull({ object, centre, distance }: { object: THREE.Object3D; centre: [number, number, number]; distance: number }) {
  const c = useMemo(() => new THREE.Vector3(...centre), [centre]);
  useFrame(({ camera }) => { object.visible = camera.position.distanceTo(c) < distance; });
  return null;
}

function mergeAll(list: THREE.BufferGeometry[]) {
  const out = new THREE.BufferGeometry(), keys = ['position', 'normal', 'uv'] as const, arrays: Record<string, number[]> = { position: [], normal: [], uv: [] };
  for (let g of list) { if (g.index) g = g.toNonIndexed(); if (!g.getAttribute('normal')) g.computeVertexNormals(); for (const k of keys) arrays[k].push(...(g.getAttribute(k).array as Float32Array)); }
  out.setAttribute('position', new THREE.Float32BufferAttribute(arrays.position, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.normal, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uv, 2));
  out.computeBoundingSphere(); return out;
}

/** Instanced Poly Haven props, grouped into 20 m cells so fine detail can be distance-culled. */
export function Props({ placements, quality }: { placements: Placements; quality: QualityProfile }) {
  const [models, setModels] = useState<Partial<Record<PropFile, GLTF>>>({});
  const requested = useRef(new Set<string>()), alive = useRef(true), lastLoad = useRef(-10), { gl, scene, camera } = useThree();
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - lastLoad.current < .5) return;
    lastLoad.current = clock.elapsedTime;
    let started = 0;
    for (const [key, list] of placements.map) {
      if (requested.current.has(key) || !(PROP_FILES as readonly string[]).includes(key)) continue;
      const radius = quality.detailDistance + 18;
      if (!list.some(m => Math.hypot(m.elements[12] - camera.position.x, m.elements[14] - camera.position.z) < radius)) continue;
      requested.current.add(key);
      loadModel(`props/${key}.glb`).then(g => { if (alive.current) setModels(m => ({ ...m, [key]: g })); }).catch(e => { console.warn('prop failed', key, e); setTimeout(() => requested.current.delete(key), 6000); }); // a dropped download is tried again
      if (++started === 2) break;
    }
  });
  // Each model's cells are built once, when it arrives; the others are kept (rebuilding every prop's
  // instanced meshes for each newly streamed model re-uploaded them all).
  const built = useRef(new Map<string, Cell[]>());
  const cells = useMemo(() => {
    for (const [key, gltf] of Object.entries(models) as [PropFile, GLTF][]) if (!built.current.has(key)) built.current.set(key, propCells(key, gltf, placements));
    return [...built.current.values()].flat();
  }, [models, placements]);
  useEffect(() => () => { for (const list of built.current.values()) for (const c of list) c.mesh.dispose(); built.current.clear(); }, []);
  // A model's shaders compile before its cells are shown: no hitch as a new kind of prop comes into view.
  const ready = useRef(new Set<string>());
  useEffect(() => {
    const fresh = [...built.current].filter(([key]) => !ready.current.has(key));
    if (fresh.length) void prepare(gl, scene, camera, fresh.flatMap(([, list]) => list.map(c => c.mesh)), quality.post).then(() => { for (const [key] of fresh) ready.current.add(key); });
  }, [cells, gl, scene, camera, quality.post]);
  useFrame(({ camera }) => { for (const c of cells) c.mesh.visible = ready.current.has(c.key) && c.centre.distanceToSquared(camera.position) < (quality.detailDistance + (c.detail ? 10 : 25)) ** 2; });
  return <group matrixAutoUpdate={false}>{cells.map(c => <primitive key={c.mesh.uuid} object={c.mesh} />)}</group>;
}
interface Cell { key: PropFile; mesh: THREE.InstancedMesh; centre: THREE.Vector3; detail: boolean }
function propCells(key: PropFile, gltf: GLTF, placements: Placements) {
  const out: Cell[] = [], list = placements.map.get(key); if (!list) return out;
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.Mesh[] = []; gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh); });
  const buckets = new Map<string, THREE.Matrix4[]>(), p = new THREE.Vector3();
  for (const m of list) { p.setFromMatrixPosition(m); const k = `${Math.floor(p.x / 20)},${Math.floor(p.z / 20)}`; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(m); }
  for (const mats of buckets.values()) for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, mats.length), tmp = new THREE.Matrix4(), centre = new THREE.Vector3();
    mats.forEach((m, i) => { mesh.setMatrixAt(i, tmp.multiplyMatrices(m, part.matrixWorld)); centre.add(p.setFromMatrixPosition(m)); });
    centre.divideScalar(mats.length);
    mesh.castShadow = key !== 'wetFloor'; mesh.receiveShadow = true; mesh.computeBoundingSphere(); mesh.name = `prop:${key}`; mesh.visible = false;
    out.push({ key, mesh: freeze(mesh), centre, detail: DETAIL_PROPS.includes(key) });
  }
  return out;
}

function flagTexture(kind: 'flagNG' | 'flagUni') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d')!;
  if (kind === 'flagNG') { x.fillStyle = '#008751'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#ffffff'; x.fillRect(85, 0, 86, 128); }
  else { x.fillStyle = '#1f3d32'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#d6a648'; x.font = '700 30px "Manrope Variable", sans-serif'; x.textAlign = 'center'; x.fillText('ÒRÌṢUN', 128, 74); x.fillRect(40, 92, 176, 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function Flags({ placements, reduced }: { placements: Placements; reduced: boolean }) {
  const time = useRef({ value: 0 });
  const flags = useMemo(() => (['flagNG', 'flagUni'] as const).flatMap(kind => (placements.map.get(kind) ?? []).map(m => {
    const material = new THREE.MeshStandardMaterial({ map: flagTexture(kind), roughness: .85, side: THREE.DoubleSide });
    material.onBeforeCompile = s => { s.uniforms.uTime = time.current; s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float k = uv.x; transformed.z += sin(uv.x * 7. - uTime * 3.4) * .12 * k + sin(uv.x * 13. + uv.y * 3. - uTime * 5.1) * .03 * k; transformed.y -= k * k * .08;`); };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .9, 24, 8).translate(.9, -.45, 0), material);
    mesh.applyMatrix4(m); mesh.castShadow = true; return freeze(mesh);
  })), [placements]);
  useFrame((_, dt) => { if (!reduced) time.current.value += dt; });
  return <>{flags.map((f, i) => <primitive key={i} object={f} />)}</>;
}

/** Fountain water: procedural ripples perturb the normal so the sky reflection moves. */
export function Water({ reduced }: { reduced: boolean }) {
  const uniforms = useRef({ uTime: { value: 0 } });
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#1d4a4f', roughness: .06, metalness: 0, envMapIntensity: 1.3, transparent: true, opacity: .9 });
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, uniforms.current);
      s.vertexShader = 'varying vec3 vWP;\n' + s.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP=(modelMatrix*vec4(transformed,1.)).xyz;');
      s.fragmentShader = `uniform float uTime; varying vec3 vWP;\n${NOISE_GLSL}\n` + s.fragmentShader.replace('#include <normal_fragment_maps>', `
        vec2 q = vWP.xz * 1.7; float e = .06;
        float h0 = cNoise(q + uTime * .6) + cNoise(q * 2.3 - uTime * .9) * .5;
        float hx = cNoise(q + vec2(e, 0.) + uTime * .6) + cNoise((q + vec2(e, 0.)) * 2.3 - uTime * .9) * .5;
        float hz = cNoise(q + vec2(0., e) + uTime * .6) + cNoise((q + vec2(0., e)) * 2.3 - uTime * .9) * .5;
        vec3 wn = normalize(vec3((h0 - hx) * 2.2, 1., (h0 - hz) * 2.2));
        normal = normalize((viewMatrix * vec4(wn, 0.)).xyz);`);
    };
    return m;
  }, []);
  useFrame((_, dt) => { if (!reduced) uniforms.current.uTime.value += dt; });
  return <mesh material={material} position={[PLAZA.x, SURFACE_Y.plaza + .37, PLAZA.z]} rotation-x={-Math.PI / 2} receiveShadow><ringGeometry args={[2.98, 5.86, 96, 1]} /></mesh>;
}

export function InteriorLights({ lights }: { lights: BuildContext['lights'] }) {
  return <>{lights.map((l, i) => <pointLight key={i} position={l.position} intensity={l.intensity} distance={l.distance} decay={2} color="#ffd8a6" />)}</>;
}
