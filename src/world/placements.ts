import * as THREE from 'three';

/** Optimized Poly Haven props in public/assets/props (see scripts/assets/build-props.mjs). */
export const PROP_FILES = ['monobloc', 'schoolChair', 'schoolDesk', 'pottedPalm', 'pottedPlant', 'fern', 'calathea', 'anthurium', 'shrub', 'chalkboard', 'hydrant', 'picnic', 'wetFloor', 'seating'] as const;
export type PropFile = typeof PROP_FILES[number];
export type PropKey = PropFile | 'flagNG' | 'flagUni';

/** Fine props that are only drawn within the quality profile's detail distance. */
export const DETAIL_PROPS: PropFile[] = ['monobloc', 'schoolChair', 'schoolDesk', 'wetFloor', 'fern', 'calathea', 'anthurium', 'chalkboard', 'pottedPlant'];

export class Placements {
  readonly map = new Map<PropKey, THREE.Matrix4[]>();
  add(key: PropKey, matrix: THREE.Matrix4) { let list = this.map.get(key); if (!list) this.map.set(key, list = []); list.push(matrix); return this; }
  at(key: PropKey, x: number, z: number, rotY = 0, scale = 1, y = 0) { return this.add(key, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale))); }
}
