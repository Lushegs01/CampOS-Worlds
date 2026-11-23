// Rain for the open world: streaks animated entirely on the GPU in a box that travels with the camera (the drops
// stay fixed in the world and wrap around the box, so walking or driving through the rain reads correctly). The
// share of drops drawn follows the weather's rain intensity; wind slants them. Under a roof (src/audio/surface.ts:
// campus buildings, district interiors, your room) the rain stops and surfaces read dry: a deliberate simplification
// of true occlusion (rain seen through a window from indoors is not drawn).
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { env } from './environment';
import { indoors } from '../audio/surface';
import { player } from '../state';
import { tickRain } from '../audio/ambience';
import type { QualityProfile } from './quality';

const VERTEX = /* glsl */`
uniform float uTime, uRain, uBox, uHeight, uSpeed; uniform vec3 uCam; uniform vec2 uWind;
attribute vec4 aDrop; attribute vec3 aCorner;
varying float vFade;
void main(){
  // aCorner: x = side (-1/1), y = along the streak (0 tail, 1 head), z = the drop's rank (0..1) for the density cut.
  if (aCorner.z > uRain) { gl_Position = vec4(2., 2., 2., 1.); vFade = 0.; return; }
  vec3 base;
  base.xz = uCam.xz + (fract((aDrop.xy * uBox - uCam.xz) / uBox) - .5) * uBox;
  float fall = fract(aDrop.z - uTime * uSpeed / uHeight);
  base.y = uCam.y - uHeight * .4 + fall * uHeight;
  vec3 dir = normalize(vec3(uWind.x, -1., uWind.y));
  float len = .28 + aDrop.w * .32;
  vec3 p = base - dir * aCorner.y * len;
  vec3 side = normalize(cross(dir, p - cameraPosition)) * .0035 * (1. + aDrop.w);
  p += side * aCorner.x;
  // Fade near the box edges (no popping as drops wrap) and very close to the lens.
  vec2 e = abs(base.xz - uCam.xz) / (uBox * .5);
  vFade = (1. - smoothstep(.75, 1., max(e.x, e.y))) * smoothstep(.6, 2.2, distance(p, cameraPosition));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
const FRAGMENT = /* glsl */`
uniform vec3 uColor; uniform float uAlpha; varying float vFade;
void main(){
  gl_FragColor = vec4(uColor, uAlpha * vFade);
  #include <colorspace_fragment>
}`;

const COUNT: Record<string, number> = { low: 1800, medium: 4500, high: 9000, ultra: 12000 };

export default function Weather({ quality, reduced }: { quality: QualityProfile; reduced: boolean }) {
  const count = quality.post ? (quality.shadowMode === 'every-frame' ? COUNT.ultra : COUNT.high) : quality.materialDetail ? COUNT.medium : COUNT.low;
  const mesh = useMemo(() => {
    const g = new THREE.BufferGeometry(), drops = new Float32Array(count * 4 * 4), corners = new Float32Array(count * 4 * 3), index = new Uint32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const d = [Math.random(), Math.random(), Math.random(), Math.random()], rank = Math.random();
      for (let k = 0; k < 4; k++) {
        drops.set(d, (i * 4 + k) * 4);
        corners.set([k % 2 ? 1 : -1, k < 2 ? 0 : 1, rank], (i * 4 + k) * 3);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3));
    g.setAttribute('aDrop', new THREE.BufferAttribute(drops, 4)); g.setAttribute('aCorner', new THREE.BufferAttribute(corners, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uRain: { value: 0 }, uBox: { value: 34 }, uHeight: { value: 22 }, uSpeed: { value: 9.5 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() }, uAlpha: { value: .3 } },
    });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.name = 'rain'; mesh.renderOrder = 10; mesh.visible = false;
    return mesh;
  }, [count]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }, [mesh]);
  useFrame(({ camera }, raw) => {
    const dt = Math.min(raw, .1), u = (mesh.material as THREE.ShaderMaterial).uniforms;
    // Shelter is eased so stepping through a door does not snap the street from wet to dry.
    const sheltered = indoors(player.x, player.z) ? 1 : 0;
    env.shelter += (sheltered - env.shelter) * (1 - Math.exp(-dt * 3));
    const rain = env.rain * (1 - env.shelter);
    tickRain(rain);
    mesh.visible = rain > .01;
    if (!mesh.visible) return;
    u.uTime.value += reduced ? dt * .35 : dt;
    u.uRain.value = rain; u.uCam.value.copy(camera.position);
    const gust = reduced ? 0 : Math.sin(u.uTime.value * .7) * .08;
    u.uWind.value.set(.12 + env.wind * .35 + gust, .05 + env.wind * .12);
    // Lit by the sky: pale grey by day, picking up the lamps and lightning at night.
    u.uColor.value.setRGB(env.horizon.x, env.horizon.y, env.horizon.z).multiplyScalar(.9).addScalar(.02 + env.lights * .08 + env.lightning * .8);
    u.uAlpha.value = .08 + .12 * rain;
  });
  return <primitive object={mesh} />;
}
