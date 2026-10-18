import * as THREE from 'three';
import { useGame } from '../state';

/** The post-processing stack while one is active (High): the frame is drawn through it (./PostFX). */
export const postStack: { composer: { render(dt: number): void } | null } = { composer: null };

// On a touch screen an open menu covers the view, so the world behind it is drawn ten times a second
// instead of every frame: the menu stays responsive and the phone does not heat up (and slow down) while
// someone reads or types. The world itself keeps running: other players, the ball and the room carry on.
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const MENU_FRAME = .1;
export function behindMenu() { return coarse && !!useGame.getState().panel; }

/**
 * Static scenery: compose each local matrix once and stop three.js recomposing (and re-multiplying) it every
 * frame. Matrices set by hand (matrixAutoUpdate already off) are kept; the first frame after the object is
 * added computes its world matrix once.
 */
export function freeze<T extends THREE.Object3D>(root: T): T {
  root.traverse(o => { if (o.matrixAutoUpdate) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
  root.matrixWorldNeedsUpdate = true;
  return root;
}

/**
 * Compile the shader programs of objects that arrive after the campus opened (props, chairs, characters)
 * before they are drawn. Compiled on first draw instead, each new material froze the frame it came into
 * view: a visible hitch on a phone. Programs are prepared for the target the frame is drawn into (the post
 * stack's half-float buffer on High), so the first draw reuses them.
 */
export function prepare(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, objects: THREE.Object3D[], post: boolean): Promise<void> {
  const target = post ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }) : null, previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  const pending = Promise.all(objects.map(o => gl.compileAsync(o, camera, scene)));
  gl.setRenderTarget(previous);
  return pending.then(() => { target?.dispose(); }, () => { target?.dispose(); });
}
