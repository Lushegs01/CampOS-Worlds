import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadModel } from '../world/assets';
import { freeze } from '../world/rendering';

export type XYZ = [number, number, number];
type Materials = Readonly<Partial<Record<string, THREE.Material>>>;
const OPTIONS = { priority: 2 as const, retries: 2, stallMs: 12000, timeoutMs: 45000 };

export function MeshAsset({ file, fit, cast = true, children, surfaces }: {
  file: string; fit?: XYZ; cast?: boolean; children?: ReactNode; surfaces?: Materials;
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
    object.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.name = file.startsWith('getaway/') ? 'getaway:' + node.name : node.name;
      const bind = (material: THREE.Material) => surfaces?.[material.name] ?? material;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(bind) : bind(mesh.material);
    });
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    return { object: freeze(object), size };
  }, [model, file, cast, surfaces]);

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
