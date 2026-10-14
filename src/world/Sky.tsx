import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { assetUrl, cached, loadHDR, loadImage, suspend } from './assets';
import type { QualityProfile } from './quality';
import { player } from '../state';

export interface SkyInfo { sunDirection: [number, number, number]; sunColor: [number, number, number]; sunIrradiance: number; skyScale: number; skyCoverage: number; horizon: [number, number, number] }
let skyInfo: Promise<SkyInfo> | null = null;
export const loadSkyInfo = (): Promise<SkyInfo> => skyInfo ??= fetch(assetUrl('sky/sky.json')).then(r => r.json());

// Art direction: the HDRI's sun is warmed slightly towards a 4 pm tropical afternoon.
export const LIGHTING = { exposure: 1.0, sunTint: new THREE.Color(1, .93, .82), sunScale: 1.0, envIntensity: .92, fogNear: 140, fogFar: 950 };

/** Photographic sky (Poly Haven, CC0) on a dome, decoded back to linear radiance and tone-mapped with the scene. */
export function SkyDome({ quality }: { quality: QualityProfile }) {
  const info = suspend(loadSkyInfo());
  const texture = suspend(cached(`sky:${quality.skyTexture}`, () => loadImage(`sky/${quality.skyTexture}`).then(t => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t; })));
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uSky: { value: texture }, uScale: { value: info.skyScale }, uCoverage: { value: info.skyCoverage }, uHorizon: { value: new THREE.Vector3(...info.horizon) } },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uSky; uniform float uScale, uCoverage; uniform vec3 uHorizon; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float u = atan(d.z, d.x) / 6.2831853 + .5, polar = acos(clamp(d.y, -1., 1.)) / 3.14159265;
        vec3 sky = texture2D(uSky, vec2(u, 1. - polar / uCoverage)).rgb * uScale;
        // Below the photographed horizon fade into haze; the terrain and tree line cover it.
        sky = mix(sky, uHorizon, smoothstep(uCoverage - .07, uCoverage, polar));
        gl_FragColor = vec4(sky, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
  }), [texture, info]);
  return <mesh material={material} renderOrder={-1000} frustumCulled={false} scale={1000}><sphereGeometry args={[1, 48, 24]} /></mesh>;
}

/** Image-based lighting from the sun-removed HDRI plus a matching directional sun. */
export function Lighting({ quality }: { quality: QualityProfile }) {
  const info = suspend(loadSkyInfo());
  const { gl, scene } = useThree();
  const hdr = suspend(cached('sky:hdr', () => loadHDR('sky/environment.hdr')));
  const sun = useRef<THREE.DirectionalLight>(null!);
  const frame = useRef(0);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(hdr).texture;
    scene.environment = env; scene.environmentIntensity = LIGHTING.envIntensity;
    const fogColor = new THREE.Color().setRGB(...info.horizon, THREE.LinearSRGBColorSpace).multiplyScalar(1.05);
    scene.fog = new THREE.Fog(fogColor, LIGHTING.fogNear, LIGHTING.fogFar);
    pmrem.dispose();
    return () => { scene.environment = null; scene.fog = null; env.dispose(); };
  }, [gl, scene, hdr, info]);

  const dir = useMemo(() => new THREE.Vector3(...info.sunDirection).normalize(), [info]);
  const color = useMemo(() => new THREE.Color().setRGB(...info.sunColor, THREE.LinearSRGBColorSpace).multiply(LIGHTING.sunTint), [info]);
  // In the courtyard one stable shadow frustum covers the whole campus: no swimming as the player
  // moves, and the static map can be rendered once on Low. Out in the open world the frustum
  // follows the player in coarse steps (re-rendered on each step) so vehicles, people and
  // district buildings cast shadows there too.
  const region = useRef('');
  // The light itself never moves (its direction is the sun's): only the orthographic shadow
  // frustum is refitted, in light space, around the region to cover.
  const fit = useMemo(() => (corners: [number, number, number, number]) => {
    const light = sun.current, s = light.shadow, cam = s.camera, centre = new THREE.Vector3(0, 0, -6);
    light.position.copy(centre).addScaledVector(dir, 160); light.target.position.copy(centre); light.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(light.position, centre, new THREE.Vector3(0, 1, 0));
    const inv = view.clone().invert(), box = new THREE.Box3();
    for (const x of [corners[0], corners[1]]) for (const z of [corners[2], corners[3]]) for (const y of [0, 22]) box.expandByPoint(new THREE.Vector3(x, y, z).sub(light.position).applyMatrix4(inv));
    cam.left = box.min.x; cam.right = box.max.x; cam.top = box.max.y; cam.bottom = box.min.y;
    // Light space looks down -z: depth runs from -max.z to -min.z (plus room for tall trees).
    cam.near = Math.max(.5, -box.max.z - 30); cam.far = -box.min.z + 30;
    cam.updateProjectionMatrix(); s.needsUpdate = true;
  }, [dir]);
  useEffect(() => {
    const s = sun.current.shadow;
    region.current = '';
    s.mapSize.set(quality.shadowSize, quality.shadowSize); s.radius = quality.shadowRadius; s.bias = -.00025; s.normalBias = .035;
    s.map?.dispose(); s.map = null;
    s.autoUpdate = quality.shadowMode !== 'static'; s.needsUpdate = true;
    // Static shadows wait for late-loading geometry before the single render.
    if (quality.shadowMode === 'static') { const t = [800, 2500, 6000].map(ms => setTimeout(() => { s.needsUpdate = true; }, ms)); return () => t.forEach(clearTimeout); }
  }, [dir, quality]);
  useFrame(() => {
    const inside = Math.abs(player.x) < 85 && player.z > -78 && player.z < 70, step = 24;
    const key = inside ? 'campus' : `${Math.round(player.x / step)},${Math.round(player.z / step)}`;
    if (key !== region.current) {
      region.current = key;
      if (inside) fit([-78, 78, -72, 66]);
      else { const cx = Math.round(player.x / step) * step, cz = Math.round(player.z / step) * step; fit([cx - 70, cx + 70, cz - 70, cz + 70]); }
    }
    if (quality.shadowMode === 'every-2nd-frame') { const s = sun.current.shadow; s.autoUpdate = false; s.needsUpdate = s.needsUpdate || (frame.current++ & 1) === 0; }
  });
  return <directionalLight ref={sun} color={color} intensity={info.sunIrradiance * LIGHTING.sunScale} castShadow />;
}
