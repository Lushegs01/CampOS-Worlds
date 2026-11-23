// Commercial District hero slice (blender/hero_slice.py → scripts/assets/build-hero-slice.mjs → public/assets/
// harbour/hero/): Coastal Bank on Harbour Exchange block-0-1, the street dressing in front of it, and the
// production car used for the district's drivable compact (`harbour-compact`).
//
// * The assets carry named material slots, not textures. Library names (plaster, brick, granite, glass …) bind to
//   the shared PBR scans of src/world/materials.ts, so they reuse textures already on the GPU and inherit the
//   weathering and environment layers (rain darkening, puddles, lit rooms at night). Hero-only slots are made here.
// * Streaming and LOD: the light LOD1 (7.6k triangles) loads as soon as the block is drawn; LOD0 (16k, with the
//   banking hall, balustrades and roof clutter) is fetched only when the player comes within STREAM_RANGE, and the
//   two switch by camera distance with hysteresis. Until LOD1 arrives, or if it cannot load, the bank is drawn as its
//   collision box, exactly as before.
// * Collision is unchanged: the bank fills its 20 x 30 m box at street level (canopy and balconies project only above
//   3.5 m); the street furniture dresses the existing shared colliders (HARBOUR_FURNITURE), which had no visuals.
import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HARBOUR_BLOCKS, HARBOUR_BUILDINGS } from '../../shared/harbour-local.mjs';
import { METRO_SHIFT } from '../../shared/metro.mjs';
import { player } from '../state';
import { loadModel } from './assets';
import { freeze } from './rendering';
import { sign } from './architecture/signage';
import { environmentLayer } from './environment';
import type { Materials } from './materials';
import type { VehicleModel } from './vehicleModels';

export const HERO_BLOCK = 'block-0-1';
export const HERO_BUILDING = 'block-0-1-0';
export const HERO_CAR_ID = 'harbour-compact';
const FILES = { bank: 'harbour/hero/hero-bank.glb', bankLod1: 'harbour/hero/hero-bank-lod1.glb', street: 'harbour/hero/hero-street.glb', car: 'harbour/hero/hero-car.glb' };
const FETCH = { priority: 2 as const, retries: 2, stallMs: 12000, timeoutMs: 45000 };
/** LOD0 is requested within this distance (m) of the bank and kept once loaded (the model cache owns it). */
const STREAM_RANGE = 150;
/** Camera distance (m) at which LOD0 hands over to LOD1. */
const LOD_SWITCH = 85;

const block = HARBOUR_BLOCKS.find(b => b.id === HERO_BLOCK)!;
export const heroBuilding = HARBOUR_BUILDINGS.find(b => b.id === HERO_BUILDING)!;

/**
 * The region of block-0-1's batched GLB that the procedural Coastal Bank occupied (block-local frame), cut out of
 * the batch when it loads (./Harbour.tsx): the footprint plus its projecting shopfront and canopy, above the paving.
 */
export const HERO_CLIP = { min: [heroBuilding.x - 10.05, .13, heroBuilding.z - 16.9], max: [heroBuilding.x + 10.05, 60, heroBuilding.z + 16.9] } as const;

// ------------------------------------------------------------------------------------------------ hero materials
let heroMaterials: Record<string, THREE.Material> | null = null;
function heroOnly() {
  if (heroMaterials) return heroMaterials;
  const std = (name: string, p: THREE.MeshStandardMaterialParameters, porosity = .3) => environmentLayer(new THREE.MeshStandardMaterial({ name, ...p }), { porosity });
  heroMaterials = {
    roofMembrane: std('roofMembrane', { color: '#2a2c2e', roughness: .82 }, .8),
    solar: std('solar', { color: '#0b1730', roughness: .08, metalness: .35, envMapIntensity: 1.3 }, .1),
    screen: new THREE.MeshStandardMaterial({ name: 'screen', color: '#0b2c38', emissive: '#4fc4e0', emissiveIntensity: .7, roughness: .2 }),
    tank: std('tank', { color: '#1d2a38', roughness: .55 }, .2),
    brand: std('brand', { color: '#0d5560', roughness: .5 }, .2),
    artwork: std('artwork', { color: '#9a6a3c', roughness: .7 }, 0),
    leaf: std('leaf', { color: '#2f5a22', roughness: .7, side: THREE.DoubleSide }, .3),
    leafLight: std('leafLight', { color: '#4d7a2c', roughness: .7, side: THREE.DoubleSide }, .3),
    bark: std('bark', { color: '#4a3a2c', roughness: .9 }, .7),
    castIron: std('castIron', { color: '#141617', roughness: .55, metalness: .6 }, .2),
  };
  return heroMaterials;
}
function bindMaterials(root: THREE.Object3D, lib: Materials, cast: boolean) {
  const own = heroOnly(), library = lib as unknown as Record<string, THREE.Material>;
  root.traverse(o => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.material = library[name] ?? own[name] ?? mesh.material;
    // Glazing and emissive panels do not cast; everything else does (except on Low, as for the district).
    mesh.castShadow = cast && !/^glass|emissive|screen/.test(name);
    mesh.receiveShadow = true;
    mesh.name = 'hero:' + name;
  });
  return freeze(root);
}

function useModel(file: string, wanted = true) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted || scene) return;
    let alive = true;
    loadModel(file, FETCH).then(g => { if (alive) setScene(g.scene); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file, wanted, scene]);
  return { scene, failed };
}

// ------------------------------------------------------------------------------------------------ Coastal Bank
const fallbackBox = new THREE.BoxGeometry();
const fallbackMat = new THREE.MeshStandardMaterial({ color: '#9a9180', roughness: .82 });

/** Coastal Bank in the district's local frame (drawn inside the Harbour Exchange group). */
export function HeroBank({ lib, low }: { lib: Materials; low: boolean }) {
  const b = heroBuilding;
  const [near, setNear] = useState(false);
  useFrame(() => {
    const d = Math.hypot(player.x - METRO_SHIFT.x - b.x, player.z - METRO_SHIFT.z - b.z);
    if (!near && d < STREAM_RANGE) setNear(true);
  });
  const lod1 = useModel(FILES.bankLod1), lod0 = useModel(FILES.bank, near);
  const lod = useMemo(() => {
    if (!lod1.scene) return null;
    const l = new THREE.LOD(); l.name = 'hero:bank';
    if (lod0.scene) l.addLevel(bindMaterials(lod0.scene.clone(true), lib, !low), 0);
    l.addLevel(bindMaterials(lod1.scene.clone(true), lib, !low), lod0.scene ? LOD_SWITCH : 0, .1);
    l.position.set(b.x, .125, b.z);
    return l;
  }, [lod1.scene, lod0.scene, lib, low, b]);
  // The name on the fascia: individual letters, lit a little at night like the rest of the shopfront.
  const board = useMemo(() => {
    const s = sign({ text: b.name.toUpperCase(), kind: 'letters', width: 8.4, height: .52, color: '#e9d7a8', tracking: .14 });
    s.position.set(b.x, 4.12, b.z + b.d / 2 + .1); s.name = 'hero:sign';
    return s;
  }, [b]);
  useEffect(() => () => { board.geometry.dispose(); (board.material as THREE.Material).dispose(); }, [board]);
  if (!lod) return <mesh geometry={fallbackBox} material={fallbackMat} position={[b.x, b.h / 2, b.z]} scale={[b.w, b.h, b.d]} castShadow receiveShadow />;
  return <><primitive object={lod} /><primitive object={board} /></>;
}

/** The pavement in front of the bank: planters with shrubs and a tree, benches, kerb gullies, a manhole cover. */
export function HeroStreet({ lib, low }: { lib: Materials; low: boolean }) {
  const { scene } = useModel(FILES.street);
  const object = useMemo(() => {
    if (!scene) return null;
    const o = bindMaterials(scene.clone(true), lib, !low);
    o.position.set(block.x, .125, block.z + block.d / 2); o.updateMatrix(); o.name = 'hero:street';
    return o;
  }, [scene, lib, low]);
  return object ? <primitive object={object} /> : null;
}

// ------------------------------------------------------------------------------------------------ the hero car
let carRequest: Promise<THREE.Group> | null = null;
/** The production car's scene, or null until it has loaded (the procedural compact is drawn meanwhile). */
export function useHeroCar(enabled: boolean) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    carRequest ??= loadModel(FILES.car, FETCH).then(g => g.scene);
    carRequest.then(s => { if (alive) setScene(s); }).catch(() => { carRequest = null; });
    return () => { alive = false; };
  }, [enabled]);
  return scene;
}

export interface HeroVehicleModel extends VehicleModel { steering: THREE.Object3D; dispose(): void }

/**
 * A VehicleModel (src/world/vehicleModels.ts) from the production car: the body (shell, lamps and the full
 * interior) on the suspension group, four wheels on steer pivots with spin groups, and the steering wheel on its
 * column. src/world/Vehicles.tsx drives it exactly like the procedural cars: authoritative position and speed from
 * the room, wheel spin, steering, pitch and roll, brake, reverse and head lamps.
 */
export function buildHeroCar(source: THREE.Group, paint = '#7e1b16'): HeroVehicleModel {
  const scene = source.clone(true), root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const made: THREE.Material[] = [];
  const mk = <T extends THREE.Material>(m: T) => { made.push(m); return m; };
  const coat = mk(environmentLayer(new THREE.MeshPhysicalMaterial({ name: 'paint', color: paint, metalness: .25, roughness: .32, clearcoat: 1, clearcoatRoughness: .07, envMapIntensity: 1.1 }), { porosity: .15 }));
  const head = mk(new THREE.MeshStandardMaterial({ name: 'headlamp', color: '#eceae2', emissive: '#fff6df', emissiveIntensity: .23, roughness: .06, metalness: .3 }));
  const tail = mk(new THREE.MeshStandardMaterial({ name: 'taillamp', color: '#6a0c10', emissive: '#ff1a12', emissiveIntensity: .25, roughness: .12 }));
  const reverse = mk(new THREE.MeshStandardMaterial({ name: 'reverseLamp', color: '#dcdcdc', emissive: '#ffffff', emissiveIntensity: 0, roughness: .12 }));
  const std = (name: string, p: THREE.MeshStandardMaterialParameters) => mk(new THREE.MeshStandardMaterial({ name, ...p }));
  const mats: Record<string, THREE.Material> = {
    paint: coat, headlamp: head, taillamp: tail, reverseLamp: reverse,
    carGlass: mk(new THREE.MeshPhysicalMaterial({ name: 'carGlass', color: '#1d272b', roughness: .04, metalness: 0, transparent: true, opacity: .36, depthWrite: false, envMapIntensity: 1.5 })),
    trim: std('trim', { color: '#0e0f10', roughness: .6 }), chrome: std('chrome', { color: '#d4d6d8', roughness: .12, metalness: 1 }),
    rubber: std('rubber', { color: '#141414', roughness: .88 }), tread: std('tread', { color: '#0d0d0d', roughness: .92 }),
    rim: std('rim', { color: '#9ea2a6', roughness: .28, metalness: .9 }), indicator: std('indicator', { color: '#c9741a', emissive: '#a35a00', emissiveIntensity: .15, roughness: .12 }),
    plate: std('plate', { color: '#e6e4dc', roughness: .5 }), chassis: std('chassis', { color: '#101010', roughness: .8 }),
    seatFabric: std('seatFabric', { color: '#26272b', roughness: .95 }), dash: std('dash', { color: '#121316', roughness: .65 }),
    cabin: std('cabin', { color: '#45423e', roughness: .85 }), carpet: std('carpet', { color: '#111111', roughness: .98 }),
    mirrorGlass: std('mirrorGlass', { color: '#c8ccd0', roughness: .03, metalness: 1 }),
    instrument: std('instrument', { color: '#0e2a30', emissive: '#3fa5b3', emissiveIntensity: .55, roughness: .3 }),
  };
  const casts = new Set(['paint', 'chassis', 'rubber']);
  scene.traverse(o => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.material = mats[name] ?? mesh.material;
    mesh.castShadow = casts.has(name); mesh.receiveShadow = true;
    mesh.geometry.name ||= 'hero-car'; // shared with the model cache: Vehicles' cleanup must not dispose it
  });
  const model: HeroVehicleModel = { root, body, wheels: [], tail, reverse, head, radius: .31, steering: new THREE.Group(), dispose: () => made.forEach(m => m.dispose()) };
  const shell = scene.getObjectByName('body');
  if (shell) body.add(shell);
  for (const key of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const node = scene.getObjectByName(key); if (!node) continue;
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.position.copy(node.position); node.position.set(0, 0, 0); spin.add(node); pivot.add(spin); root.add(pivot);
    model.wheels.push({ pivot, spin, front: key[6] === 'f' });
  }
  const wheel = scene.getObjectByName('steering');
  if (wheel) {
    // Tilt on the column (the node's own transform), then turn about the column axis (local +Y after export).
    const column = new THREE.Group(); column.position.copy(wheel.position); column.quaternion.copy(wheel.quaternion);
    wheel.position.set(0, 0, 0); wheel.quaternion.identity(); model.steering.add(wheel); column.add(model.steering); body.add(column);
  }
  root.name = 'vehicle-model:hero-car';
  return model;
}
