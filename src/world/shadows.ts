import type * as THREE from 'three';

/**
 * Things that move (people, vehicles, doors, balls, chairs). On Low the sun's shadow map is rendered
 * once and reused, so anything moving that was drawn into it left a "ghost" shadow where it happened to
 * be: a parked car's shadow after it drove off, a door's shadow shut while it stood open. Those objects
 * register here and are left out of that one-off render; on Low avatars and balls keep their contact
 * shadows. Medium and High re-render the map continuously and are unaffected.
 */
export const movingCasters = new Set<THREE.Object3D>();

export function registerMovingCaster(object: THREE.Object3D) {
  movingCasters.add(object);
  return () => { movingCasters.delete(object); };
}

/** Switch moving objects' shadow casting off around a static shadow render; returns the restore step. */
export function hideMovingCasters(): () => void {
  const hidden: THREE.Object3D[] = [];
  for (const root of movingCasters) root.traverse(o => { if (o.castShadow) { o.castShadow = false; hidden.push(o); } });
  return () => { for (const o of hidden) o.castShadow = true; };
}
