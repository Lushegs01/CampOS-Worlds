import * as THREE from 'three';

/** Recovery only: retain geometry, base textures and cutouts while avoiding PBR shader variants. */
export function installCompatibilityMaterials(renderer: THREE.WebGLRenderer) {
  const replacements = new Map<THREE.Material, THREE.MeshLambertMaterial>();
  const simplify = (material: THREE.Material) => {
    if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
    let simple = replacements.get(material);
    if (!simple) {
      const source = material as THREE.MeshStandardMaterial;
      simple = new THREE.MeshLambertMaterial({
        name: `${source.name} (compatibility)`, color: source.color, map: source.map,
        emissive: source.emissive, emissiveMap: source.emissiveMap, emissiveIntensity: source.emissiveIntensity,
        alphaMap: source.alphaMap, alphaTest: source.alphaTest, opacity: source.opacity,
        transparent: source.transparent, side: source.side, vertexColors: source.vertexColors,
        depthTest: source.depthTest, depthWrite: source.depthWrite, blending: source.blending,
        flatShading: source.flatShading, fog: source.fog, toneMapped: source.toneMapped,
        colorWrite: source.colorWrite, depthFunc: source.depthFunc,
        polygonOffset: source.polygonOffset, polygonOffsetFactor: source.polygonOffsetFactor, polygonOffsetUnits: source.polygonOffsetUnits,
      });
      replacements.set(material, simple);
    }
    // Fade/flash animation still belongs to the source material shared by the game logic.
    const source = material as THREE.MeshStandardMaterial;
    simple.color.copy(source.color); simple.emissive.copy(source.emissive);
    simple.opacity = source.opacity; simple.visible = source.visible;
    return simple;
  };
  const prepare = (scene: THREE.Object3D) => {
    const restore: (() => void)[] = [];
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const original = mesh.material;
      mesh.material = Array.isArray(original) ? original.map(simplify) : simplify(original);
      restore.push(() => { mesh.material = original; });
    });
    return () => { for (const reset of restore) reset(); };
  };
  const render = renderer.render.bind(renderer), compile = renderer.compile.bind(renderer);
  renderer.render = (scene, camera) => {
    const restore = prepare(scene);
    try { render(scene, camera); } finally { restore(); }
  };
  renderer.compile = (scene, camera, target) => {
    const restore = prepare(scene), restoreTarget = target && target !== scene ? prepare(target) : undefined;
    try { return compile(scene, camera, target); } finally { restoreTarget?.(); restore(); }
  };
  return () => { for (const material of replacements.values()) material.dispose(); replacements.clear(); };
}
