import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadModel } from '../world/assets';
import { freeze } from '../world/rendering';

export type XYZ = [number, number, number];
type Materials = Readonly<Partial<Record<string, THREE.Material>>>;
const OPTIONS = { priority: 2 as const, retries: 2, stallMs: 12000, timeoutMs: 45000 };

/** Triangles whose centroid lies inside `clip` (the asset's own frame) are left out: used to cut a building that a
 *  dedicated model replaces out of a block-batched asset (src/world/heroSlice.tsx). */
export interface Clip { min: readonly [number, number, number]; max: readonly [number, number, number] }
function clipped(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, clip: Clip) {
  const pos = geometry.getAttribute('position'), index = geometry.index, n = index ? index.count : pos.count, keep: number[] = [];
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, index ? index.getX(t + k) : t + k));
    c.multiplyScalar(1 / 3).applyMatrix4(matrix);
    const inside = c.x > clip.min[0] && c.x < clip.max[0] && c.y > clip.min[1] && c.y < clip.max[1] && c.z > clip.min[2] && c.z < clip.max[2];
    if (!inside) for (let k = 0; k < 3; k++) keep.push(index ? index.getX(t + k) : t + k);
  }
  if (keep.length === n) return geometry;
  const g = geometry.clone(); g.setIndex(keep); g.name = 'clipped'; return g;
}

export function MeshAsset({ file, fit, cast = true, children, surfaces, clip }: {
  file: string; fit?: XYZ; cast?: boolean; children?: ReactNode; surfaces?: Materials; clip?: Clip;
}) {
  const [model, setModel] = useState<{ file: string; source: THREE.Group } | null>(null);
  const { gl, scene } = useThree();
  useEffect(() => {
    let current = true;
    void loadModel(file, OPTIONS).then(gltf => {
      if (current) setModel({ file, source: gltf.scene });
    }).catch(() => {}); // The fallback already dresses the associated collision volume.
    return () => { current = false; };
  }, [file]);

  const instance = useMemo(() => {
    if (model?.file !== file) return null;
    const object = model.source.clone(true);
    if (clip) object.updateMatrixWorld(true);
    object.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (clip) mesh.geometry = clipped(mesh.geometry, mesh.matrixWorld, clip);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.name = file.startsWith('getaway/') ? 'getaway:' + node.name : node.name;
      const bind = (material: THREE.Material) => surfaces?.[material.name] ?? material;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(bind) : bind(mesh.material);
    });
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    return { object: freeze(object), size };
  }, [model, file, cast, surfaces, clip]);

  // Static maps on Performance need a refresh when streamed silhouettes replace collision proxies.
  useLayoutEffect(() => {
    if (!instance || !cast) return;
    gl.shadowMap.needsUpdate = true;
    scene.traverse(o => {
      const light = o as THREE.DirectionalLight;
      if (light.isDirectionalLight && light.castShadow) light.shadow.needsUpdate = true;
    });
  }, [instance, cast, gl, scene]);

  if (!instance) return children;
  const { object, size } = instance;
  const scale: XYZ = fit ? [fit[0] / size.x, fit[1] / size.y, fit[2] / size.z] : [1, 1, 1];
  return <group scale={scale}><primitive object={object}/></group>;
}
