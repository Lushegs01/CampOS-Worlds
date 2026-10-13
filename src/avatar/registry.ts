import * as THREE from 'three';
/** Live avatars by player id ('local' for this player): where a held ball should be drawn. */
export const avatars = new Map<string, { ball: THREE.Vector3; holding: boolean }>();
