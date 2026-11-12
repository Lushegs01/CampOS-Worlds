// City presentation follows the shared collision map. No decorative wall closes a playable opening.
import * as THREE from 'three';
import { metropolis, trainAt, TRAIN, STREET } from '../../../shared/arena/metropolis.mjs';
import { Builder, Props, container } from './environment';
import { surface, type Library, type SurfaceKey, type PropKey } from './library';
import { labelTexture, type ArenaQuality } from './world';

type City = ReturnType<typeof metropolis>;
export const CITY_LIGHT = {
  day: { sky: '#b7ccda', fog: '#d8d4c6', sun: '#ffe9c4', strength: 3.2, fill: 1.2, env: 1.1, dir: [-.38, .82, .42] },
  overcast: { sky: '#899ba8', fog: '#9faeb5', sun: '#d7e4ef', strength: 1, fill: 1.5, env: .8, dir: [-.38, .82, .42] },
  sunset: { sky: '#d7a58c', fog: '#d9b6a1', sun: '#ffb568', strength: 2.7, fill: .9, env: .8, dir: [-.85, .32, .3] },
  night: { sky: '#172b46', fog: '#253a50', sun: '#9fbce5', strength: .65, fill: .8, env: .5, dir: [-.38, .82, .42] },
};
export type CityVariant = keyof typeof CITY_LIGHT;

const SURFACES: Record<string, SurfaceKey> = {
  'st-asphalt': 'cityAsphalt', 'st-sidewalk': 'sidewalk', 'st-pavers': 'pavers', 'st-plaza': 'plazaStone', 'st-tile': 'floorTile', 'st-marble': 'marble',
  'st-screed': 'concreteFloor', 'st-yard': 'concreteFloor', 'ug-tile': 'subwayTile', 'ug-concrete': 'concreteFloor', 'ug-track': 'gravel',
  'bld-render': 'plaster', 'bld-brick': 'brick', 'bld-brick-upper': 'brick', 'bld-panel': 'facadePanel', 'bld-stone': 'marble', 'bld-block': 'blockWall',
  'bld-sheet': 'cladding', 'bld-back': 'facadePanel', 'bld-terminal': 'cladding', 'partition-wall': 'plaster', 'ug-wall': 'subwayTile', 'ug-room': 'subwayTile',
  'floor-timber': 'woodFloor', 'roof-deck': 'gravel', 'roof-sheet': 'corrugated', 'stair-stone': 'plazaStone', 'stair-concrete': 'concreteFloor', 'stair-steel': 'metalPlate',
  'brt-platform': 'pavers', 'fountain-wall': 'marble', 'stone-wall': 'plazaStone', plinth: 'marble', planter: 'concreteWall', parapet: 'concreteWall', quay: 'blockWall',
  counter: 'woodFloor', desk: 'woodFloor', table: 'woodFloor', bench: 'planks', shelf: 'planks', partition: 'planks', crate: 'planks',
};
const METAL = new Set(['rail', 'grate', 'tank', 'ac', 'vent', 'plant', 'kiosk', 'shelter', 'canopy', 'brt-roof', 'hoarding', 'yard-wall', 'cabinet', 'rack', 'forklift', 'bollard', 'vending', 'atm', 'faregate', 'switchgear', 'utility', 'bin', 'spire', 'guardhouse']);
const PROP_FOR: Record<string, PropKey> = { ac: 'aircon', bin: 'trashCan', bench: 'parkBench', desk: 'officeDesk', shelf: 'shelves', rack: 'shelves', sofa: 'sofa', table: 'cafeSet', planter: 'planterBox' };
export const CITY_DECOR: PropKey[] = [...new Set([...Object.values(PROP_FOR), 'streetLamp', 'manhole'] as PropKey[])];
const VEHICLES = new Set(['bus', 'van', 'car', 'truck', 'pickup']);
const TINTS: Record<string, string> = { 'container-red': '#a94f3b', 'container-blue': '#38768e', 'container-yellow': '#e0b354', 'container-green': '#588372' };

export function buildMetropolis(lib: Library, map: City, q: ArenaQuality, variant: CityVariant) {
  const group = new THREE.Group(); group.name = 'metropolis';
  // Small regional batches let the GPU cull blocks behind the camera, including the underground level.
  const b = new Builder(lib, p => Math.floor((p.x + 80) / 24) * 100 + Math.floor((p.z + 60) / 24) * 2 + (p.y < 4.4 ? 1 : 0));
  const steel = surface(lib, 'paintedMetal', { tint: '#687b80', rough: .6 });
  const dark = surface(lib, 'paintedMetal', { tint: '#233441', rough: .5 });
  const glazing = new THREE.MeshStandardMaterial({ color: '#4f8597', metalness: .45, roughness: .22 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff1b9', emissive: '#ffd891', emissiveIntensity: variant === 'night' ? 2.5 : .5 });
  const palm = new THREE.MeshStandardMaterial({ map: lib.extra['foliage/palm-frond.ktx2'], color: '#729260', alphaTest: .4, side: THREE.DoubleSide, roughness: .9 });
  if (palm.map) palm.map.colorSpace = THREE.SRGBColorSpace;
  const grass = new THREE.MeshStandardMaterial({ color: '#85955b', roughness: 1, map: lib.extra['textures/grass/color.ktx2'] });
  const rubber = new THREE.MeshStandardMaterial({ color: '#20282b', roughness: .95 });
  const vehiclePaint = new THREE.MeshStandardMaterial({ color: '#e0b359', roughness: .48, metalness: .15 });
  const trafficPaint = new THREE.MeshStandardMaterial({ color: '#749194', roughness: .5, metalness: .15 });
  const water = new THREE.MeshStandardMaterial({ color: '#398e9a', metalness: .3, roughness: variant === 'overcast' ? .2 : .35 });
  const surfaceFor = (mat: string) => {
    if (mat === 'void') return dark;
    if (mat === 'hedge' || mat === 'st-grass') return grass;
    if (mat.includes('glass') || mat.includes('shaft') || mat === 'brt-screen') return glazing;
    const key = SURFACES[mat] ?? (METAL.has(mat) ? 'paintedMetal' : 'concreteWall');
    return surface(lib, key, { ...(variant === 'overcast' && mat.startsWith('st-') ? { rough: .42 } : {}), ...(mat === 'spire' ? { tint: '#cfab65', metal: .8 } : {}) });
  };
  const box = (min: number[], max: number[], material: THREE.Material, scale = 2) => b.box(min[0], min[1], min[2], max[0], max[1], max[2], material, scale);
  const fallback = new Map<PropKey, { builder: Builder; meshes: THREE.Mesh[] }>();
  for (const c of map.boxes) {
    const [x0, y0, z0] = c.min, [x1, y1, z1] = c.max;
    if (c.mat === 'tree') {
      const trunk = new THREE.CylinderGeometry(.19, .25, y1 - y0, 7), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      b.add(trunk, surface(lib, 'planks', { tint: '#9b8162' }), 1, new THREE.Matrix4().makeTranslation(cx, (y0 + y1) / 2, cz)); trunk.dispose();
      const frond = new THREE.PlaneGeometry(1.5, 3.8);
      for (let i = 0; i < 8; i++) {
        const yaw = i * Math.PI / 4;
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(cx + Math.sin(yaw) * 1.35, y1 - .2, cz + Math.cos(yaw) * 1.35), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.15, yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
        b.add(frond, palm, 1, matrix, false, true);
      }
      frond.dispose(); continue;
    }
    const propKey = PROP_FOR[c.mat];
    if (propKey) {
      let f = fallback.get(propKey); if (!f) { f = { builder: new Builder(lib), meshes: [] }; fallback.set(propKey, f); }
      f.builder.box(x0, y0, z0, x1, y1, z1, surfaceFor(c.mat));
      continue;
    }
    if (c.mat.startsWith('container-')) {
      container(b, { container: key => surface(lib, 'corrugated', { tint: TINTS[key] ?? '#879484' }), containerFrame: () => steel, darkSteel: dark }, c);
    } else {
      if (!VEHICLES.has(c.mat)) box(c.min, c.max, surfaceFor(c.mat));
      // Vehicle skins sit just outside the collision hull; the hull stays complete, even before detail loads.
      if (VEHICLES.has(c.mat)) {
        const alongX = x1 - x0 > z1 - z0, length = alongX ? x1 - x0 : z1 - z0;
        const h = y1 - y0, width = alongX ? z1 - z0 : x1 - x0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const paint = c.mat === 'bus' ? vehiclePaint : trafficPaint;
        // Chassis, inset cab and tyres read as traffic while fitting the shared collision envelope.
        b.box(x0, y0 + .24, z0, x1, y0 + h * .55, z1, paint);
        const inset = c.mat === 'car' || c.mat === 'pickup' ? length * .21 : .12;
        b.box(x0 + (alongX ? inset : .08), y0 + h * .55, z0 + (alongX ? .08 : inset), x1 - (alongX ? inset : .08), y1, z1 - (alongX ? .08 : inset), paint);
        for (const axle of [-.32, .32]) for (const side of [-1, 1]) {
          const radius = Math.min(.49, h * .23), tire = new THREE.CylinderGeometry(radius, radius, .17, 12);
          const pos = new THREE.Vector3(cx + (alongX ? length * axle : side * (width / 2 - .04)), y0 + radius, cz + (alongX ? side * (width / 2 - .04) : length * axle));
          const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(alongX ? 1 : 0, 0, alongX ? 0 : 1), Math.PI / 2);
          b.add(tire, rubber, 1, new THREE.Matrix4().compose(pos, rotation, new THREE.Vector3(1, 1, 1))); tire.dispose();
        }
        const n = Math.max(2, Math.floor(length / 1.3));
        for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
          const a = (alongX ? x0 : z0) + inset + (i + .15) * (length - 2 * inset) / n, e = a + (length - 2 * inset) / n * .7;
          if (alongX) b.box(a, y0 + (y1 - y0) * .57, side < 0 ? z0 + .06 : z1 - .08, e, y1 - .2, side < 0 ? z0 + .08 : z1 - .06, glazing);
          else b.box(side < 0 ? x0 + .06 : x1 - .08, y0 + (y1 - y0) * .57, a, side < 0 ? x0 + .08 : x1 - .06, y1 - .2, e, glazing);
        }
      }
      if (c.mat.includes('shaft') || c.mat === 'bld-glass-tower' || c.mat === 'bld-brick-upper') {
        for (let y = y0 + .5; y < y1; y += 3.2) {
          b.box(x0 - .03, y, z0 - .03, x1 + .03, y + .12, z1 + .03, steel);
        }
        for (let x = x0 + 1; x < x1; x += 2) b.box(x, y0, z1, x + .07, y1, z1 + .04, steel);
      }
      // Light strips on the actual undersides of slabs make the station readable on every quality tier.
      if (c.mat.startsWith('st-') && y0 === 4.4 && x1 - x0 > 4 && z1 - z0 > 2) b.box(x0 + 1, y0 - .04, (z0 + z1) / 2, x1 - 1, y0, (z0 + z1) / 2 + .14, lamp);
    }
  }
  // Frames preserve all shared door/shop/window openings.
  for (const d of map.deco) {
    const [x0, y0, z0] = d.min, [x1, y1, z1] = d.max;
    if (d.alongZ) {
      b.box(x0 - .02, y0, z0, x1 + .02, y1, z0 + .07, steel); b.box(x0 - .02, y0, z1 - .07, x1 + .02, y1, z1, steel);
    } else {
      b.box(x0, y0, z0 - .02, x0 + .07, y1, z1 + .02, steel); b.box(x1 - .07, y0, z0 - .02, x1, y1, z1 + .02, steel);
    }
    b.box(x0 - .02, y1 - .07, z0 - .02, x1 + .02, y1, z1 + .02, steel);
  }
  // Lane markings, railway and platform edges are visual only.
  for (const z of [-25, 14]) for (let x = -48; x < 48; x += 5) b.box(x, STREET + .012, z, x + 2.5, STREET + .018, z + .1, lamp);
  b.box(-46, -.06, 1.5, 46, 0, 5.5, surface(lib, 'gravel'));
  for (const z of [2.4, 4.6]) b.box(-46, .03, z, 46, .13, z + .08, steel);
  for (let x = -46; x < 46; x += .9) b.box(x, .005, 2.1, x + .15, .035, 5, dark);
  for (const z of [1.25, 5.5]) b.box(-34, 1.01, z, 34, 1.025, z + .2, lamp);
  b.box(-3.9, STREET + .035, -1.5, 3.9, STREET + .05, 6.3, water);
  // Lagoon beyond the quay and a distant skyline, outside the playable bounds.
  b.box(-400, 1, 45, 400, 1.02, 450, water);
  for (let i = -8; i <= 8; i++) b.box(i * 20 - 6, 5, -90, i * 20 + 6, 15 + (Math.abs(i * 7) % 24), -72, surface(lib, 'facadePanel', { tint: '#a0b1b4' }));
  group.add(...b.meshes(q.shadows));
  for (const f of fallback.values()) { f.meshes = f.builder.meshes(q.shadows); group.add(...f.meshes); }

  const sign = (text: string, x: number, y: number, z: number, width: number, yaw = 0) => {
    const { texture, aspect } = labelTexture(text, '#f9edcf', 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / aspect), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, y, z); m.rotation.y = yaw; m.name = 'city-sign'; group.add(m);
  };
  for (const side of [-1, 1]) {
    sign('MARINA HOUSE', side * 36, 8.1, -31.95, 8); sign('ATLANTIC GRILL', side * 14, 8.1, -31.95, 7);
    sign('BALOGUN ARCADE', side * 23, 8.1, -10.95, 10); sign('PORT OF OKUN BAY · WAREHOUSE 4', side * 28, 10, 20.75, 16);
    sign('PLAZA STATION  ↓', side * 26, 6.7, -20.95, 6); sign('PLAZA STATION · KEEP OFF TRACKS', side * 18, 3.4, -8.9, 12);
  }
  sign('OKUN BAY', 0, 20, -37.3, 8);
  const lights: THREE.Vector3[] = [];
  for (const x of [-28, -14, 0, 14, 28]) lights.push(new THREE.Vector3(x, 4.1, -1));
  const decor = (keys: PropKey[]) => {
    const p = new Props();
    for (const c of map.boxes) { const key = PROP_FOR[c.mat]; if (!key || !keys.includes(key)) continue;
      p.fit(lib, key, c.min[0], c.min[1], c.min[2], c.max[0], c.max[1], c.max[2]);
      for (const m of fallback.get(key)?.meshes ?? []) m.visible = false;
    }
    // Dressing stays on verges, outside the circulation lanes. Collision-bearing props retain their shared hulls.
    if (keys.includes('streetLamp')) for (const x of [-43, -24, -5, 5, 24, 43]) for (const z of [-30.8, 18.8]) p.place('streetLamp', x, STREET, z, 0, 1, 1, 1);
    if (keys.includes('manhole')) for (const x of [-40, -10, 10, 40]) p.place('manhole', x, STREET + .02, 14, 0, 1, 1, 1);
    return p.meshes(lib, q.shadows);
  };
  // Panes are one draw call. Server IDs are stable across joins and reconnects.
  const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#a3d5e0', transparent: true, opacity: .26, roughness: .15, metalness: .2, depthWrite: false }), map.glass.length);
  glass.name = 'metropolis-glass'; const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion();
  let glassKey: string | null = null;
  const updateGlass = (broken: Set<number>) => {
    const key = [...broken].join(','); if (key === glassKey) return; glassKey = key;
    map.glass.forEach((g, i) => {
      const min = g.min, max = g.max;
      matrix.compose(new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2), quat,
        broken.has(g.i) ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
      glass.setMatrixAt(i, matrix);
    });
    glass.instanceMatrix.needsUpdate = true; glass.computeBoundingSphere();
  };
  updateGlass(new Set()); group.add(glass);
  const train = new THREE.Group(); train.name = 'metropolis-train';
  const carriage = new Builder(lib);
  carriage.box(-TRAIN.length / 2, 0, -1.6, TRAIN.length / 2, TRAIN.top, 1.6, trafficPaint);
  for (let x = -TRAIN.length / 2 + 1; x < TRAIN.length / 2 - 1; x += 2) for (const z of [-1.62, 1.6]) carriage.box(x, 1.85, z, x + 1.4, 2.95, z + .02, glazing);
  train.add(...carriage.meshes(q.shadows));
  train.visible = false; group.add(train);
  const warning = new THREE.Mesh(new THREE.BoxGeometry(65, .08, .08), new THREE.MeshBasicMaterial({ color: '#ffb93e', toneMapped: false }));
  warning.position.set(0, 3.8, 1.4); warning.visible = false; group.add(warning);
  // Bounded, camera-centred rain, suppressed indoors by the scene's collision probe.
  const count = q.mobileAssets ? 180 : 550, positions = new Float32Array(count * 3);
  for (let i = 0; i < positions.length; i += 3) { positions[i] = Math.random() * 40 - 20; positions[i + 1] = Math.random() * 20; positions[i + 2] = Math.random() * 40 - 20; }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: '#c6d9e4', size: .045, transparent: true, opacity: .65, depthWrite: false }));
  rain.visible = variant === 'overcast'; group.add(rain);
  const update = (elapsed: number, broken: Set<number>, camera: THREE.Vector3, indoor: boolean, dt: number) => {
    updateGlass(broken);
    const t = elapsed >= 0 ? trainAt(elapsed) : null;
    train.visible = !!t && !t.warning; warning.visible = !!t && (t.warning || train.visible) && Math.floor(elapsed / 350) % 2 === 0;
    if (t && !t.warning) train.position.set((t.x0 + t.x1) / 2, 0, (TRAIN.z0 + TRAIN.z1) / 2);
    rain.visible = variant === 'overcast' && !indoor;
    if (rain.visible) { rain.position.set(camera.x, camera.y - 3, camera.z); for (let i = 1; i < positions.length; i += 3) positions[i] = (positions[i] - dt * 13 + 20) % 20; rainGeo.attributes.position.needsUpdate = true; }
  };
  return { objects: [group], lights, decor, update };
}
