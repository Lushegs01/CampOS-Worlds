// Operation: Metropolis — the street's reflection in the rain (High and Ultra).
//
// The street is one plane (y = street level) over most of the site, so wet asphalt and standing water can show a
// true mirror image: the scene is drawn once more from the camera mirrored in that plane, at reduced resolution,
// with an oblique near plane so nothing below the street leaks in, and only what is worth seeing in a puddle
// (buildings, the sky, lamps and their glow: layer REFLECTED). Ground materials with the 'reflect' layer read it
// through their rippled normals, weighted by wetness, standing water, roughness and Fresnel (surfaces.ts); where
// it is off they keep the image-based sky reflection.
import * as THREE from 'three';
import { cityWeather } from './surfaces';

/** Objects drawn in the reflection. */
export const REFLECTED = 2;

export function createStreetReflection(street: number, scale: number) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
  target.texture.minFilter = THREE.LinearFilter; target.texture.generateMipmaps = false;
  const virtual = new THREE.PerspectiveCamera(); virtual.layers.set(REFLECTED);
  const plane = new THREE.Plane(), normal = new THREE.Vector3(0, 1, 0), point = new THREE.Vector3(0, street, 0), clipAt = new THREE.Vector3(0, street + .04, 0);
  const view = new THREE.Vector3(), lookAt = new THREE.Vector3(), target3 = new THREE.Vector3(), rot = new THREE.Matrix4(), camPos = new THREE.Vector3(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
  const size = new THREE.Vector2();
  cityWeather.uReflectMap.value = target.texture;

  /** Draw the reflection for this camera. Returns false (and turns the effect off) when the eye is below the street. */
  const render = (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]) => {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < street + .2) { cityWeather.uReflect.value = 0; return false; }
    gl.getDrawingBufferSize(size);
    const w = Math.max(64, Math.round(size.x * scale)), h = Math.max(64, Math.round(size.y * scale));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    // Mirror the camera in the plane (as three's Reflector does).
    view.copy(point).sub(camPos).reflect(normal).negate().add(point);
    rot.extractRotation(camera.matrixWorld); lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target3.copy(point).sub(lookAt).reflect(normal).negate().add(point);
    virtual.position.copy(view); virtual.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal); virtual.lookAt(target3);
    virtual.far = camera.far; virtual.near = camera.near; virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    cityWeather.uReflectMatrix.value.copy(bias).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);
    // Oblique near plane: clip everything below the street.
    // (A few centimetres above the street, so the pavement's own top faces are not drawn into its reflection.)
    plane.setFromNormalAndCoplanarPoint(normal, clipAt).applyMatrix4(virtual.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = virtual.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
    virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
    // Draw (without reading itself, without re-drawing shadows, without the rain).
    const map = cityWeather.uReflectMap.value, strength = cityWeather.uReflect.value;
    cityWeather.uReflectMap.value = null; cityWeather.uReflect.value = 0;
    const shadows = gl.shadowMap.autoUpdate, before = gl.getRenderTarget(), seen = hide.map(o => o.visible);
    hide.forEach(o => { o.visible = false; });
    gl.shadowMap.autoUpdate = false; gl.setRenderTarget(target); gl.state.buffers.depth.setMask(true); gl.clear();
    gl.render(scene, virtual);
    gl.setRenderTarget(before); gl.shadowMap.autoUpdate = shadows;
    hide.forEach((o, i) => { o.visible = seen[i]; });
    cityWeather.uReflectMap.value = map; cityWeather.uReflect.value = strength || 1;
    return true;
  };
  const dispose = () => { target.dispose(); cityWeather.uReflectMap.value = null; cityWeather.uReflect.value = 0; };
  return { render, dispose, target };
}
