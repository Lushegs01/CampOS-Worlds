// The open world's sky, sun, moon, fill light, fog, reflection probe and night street lighting, all driven by the
// environment controller (./environment.ts, shared/environment.mjs): time of day and weather.
//
// The sky is an analytic model (zenith/horizon gradient anchored on the sun's elevation, Mie glow around the sun, an
// HDR sun disc, a parallax cloud layer lit from the sun's side, stars and a moon at night, a flat grey dome under
// overcast). The same shader, without the sun disc, is rendered into a small cube and prefiltered (PMREM) as the
// scene's image-based light whenever the sky has changed perceptibly, so reflections and ambient light always match
// the sky the player sees. It replaces the fixed photographic golden-hour sky (Poly Haven Kloofendal), whose baked
// sun position could not move; the Combat Arena still uses that photograph.
import { inDistrict } from '../../shared/getaway.mjs';
import { campusBudget } from './rendering';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { QualityProfile } from './quality';
import { player, useGame } from '../state';
import { hideMovingCasters } from './shadows';
import { env, updateEnvironment, updateLamps } from './environment';
import { LIGHTS } from './roads';
import { QA_HOOKS } from '../qa';
import { TIMES, WEATHER } from '../../shared/environment.mjs';

/** Tone-mapping exposure at the start (the environment controller adapts it every frame). */
export const LIGHTING = { exposure: 1.0, fogNear: 140, fogFar: 950 };

const SKY_VERTEX = /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`;
const SKY_FRAGMENT = /* glsl */`
uniform vec3 uSun, uMoon, uZenith, uHorizon, uGround, uGlow, uDisc, uCloudLit, uCloudShade, uOvercastColor;
uniform float uCloud, uOvercast, uNight, uTime, uFlash, uWind;
varying vec3 vDir;
float sHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(sHash(i), sHash(i + vec2(1, 0)), f.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), f.x), f.y); }
float sFbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < CLOUD_OCTAVES; i++) { s += a * sNoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= .5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.), cs = dot(d, uSun);
  vec3 sky = mix(uHorizon, uZenith, pow(h, .42));
  // Forward scattering around the sun (a wide and a tight lobe) and the warm band along the horizon on its side.
  float fw = max(cs, 0.);
  sky += uGlow * (pow(fw, 6.) * .22 + pow(fw, 48.) * .7 + pow(fw, 2.) * .35 * exp(-h * 7.));
  // Below the horizon: the haze the distant ground disappears into.
  sky = mix(sky, uGround, smoothstep(0., -.06, d.y));
  float cover = 0.;
  #if CLOUD_OCTAVES > 0
  if (d.y > 0.) {
    // A cloud deck: project onto a plane, drift with the wind, and threshold the noise by the cover.
    vec2 p = d.xz / (d.y + .1) * .55 + vec2(uTime * .004, uTime * .0015) * (.4 + uWind);
    float n = sFbm(p * 1.4), m = sFbm(p * 1.4 + vec2(.21, .13) * normalize(uSun.xz + 1e-4)); // offset toward the sun: self-shadow
    cover = smoothstep(1. - uCloud * .95, 1.18 - uCloud * .95, n + .18) * smoothstep(0., .1, d.y);
    float lit = clamp(.55 + (n - m) * 4.5, 0., 1.);
    vec3 cloud = mix(uCloudShade, uCloudLit, lit);
    cloud += uGlow * pow(fw, 10.) * .6 * (1. - cover * .5); // silver lining toward the sun
    sky = mix(sky, cloud, cover * (1. - uOvercast * .4));
  }
  #endif
  // Overcast: a flat, slightly brighter-overhead grey with soft darker billows.
  float billow = sNoise(d.xz / (d.y + .2) * 2. + uTime * .01);
  sky = mix(sky, uOvercastColor * (.82 + .25 * h) * (.88 + .24 * billow), uOvercast * smoothstep(-.03, .04, d.y));
  // Night: stars (fading toward the hazy horizon and behind cloud) and the moon.
  if (uNight > .01) {
    vec2 q = vec2(atan(d.z, d.x) * 180., d.y * 340.);
    vec2 c = floor(q); float r = sHash(c);
    float star = step(.9965, r) * smoothstep(.4, .05, length(fract(q) - .5)) * (.6 + .4 * sin(uTime * 3. + r * 60.));
    sky += vec3(.9, .95, 1.) * star * 1.4 * uNight * smoothstep(.05, .3, d.y) * (1. - cover) * (1. - uOvercast);
    float md = dot(d, uMoon);
    sky += vec3(.75, .8, .9) * (smoothstep(.99955, .9997, md) * 2.4 + pow(max(md, 0.), 200.) * .12) * uNight * (1. - uOvercast * .85);
  }
  #ifndef ENV_PASS
  sky += uDisc * smoothstep(.99988, .99995, cs) * (1. - cover * .9) * (1. - uOvercast) * (1. - uOvercast);
  #endif
  sky += vec3(.55, .6, .78) * uFlash * (.4 + cover);
  gl_FragColor = vec4(max(sky, 0.), 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function skyUniforms() {
  return {
    uSun: { value: env.sun }, uMoon: { value: env.moon }, uZenith: { value: env.zenith }, uHorizon: { value: env.horizon }, uGround: { value: env.ground },
    uGlow: { value: env.sunGlow }, uDisc: { value: env.sunDisc }, uCloudLit: { value: env.cloudLit }, uCloudShade: { value: env.cloudShade }, uOvercastColor: { value: env.overcastColor },
    uCloud: { value: 0 }, uOvercast: { value: 0 }, uNight: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 }, uWind: { value: 0 },
  };
}
type SkyUniforms = ReturnType<typeof skyUniforms>;
function skyMaterial(uniforms: SkyUniforms, octaves: number, envPass = false) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, defines: { CLOUD_OCTAVES: octaves, ...(envPass ? { ENV_PASS: 1 } : {}) },
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: true,
  });
}
function syncSky(u: SkyUniforms, time: number) {
  u.uCloud.value = env.params.cloud; u.uOvercast.value = env.params.overcast; u.uNight.value = env.night; u.uTime.value = time; u.uFlash.value = env.lightning; u.uWind.value = env.wind;
}

/** The analytic sky on a dome that follows the camera. */
export function SkyDome({ quality }: { quality: QualityProfile }) {
  const uniforms = useMemo(skyUniforms, []);
  const material = useMemo(() => skyMaterial(uniforms, quality.materialDetail ? 5 : 3), [uniforms, quality.materialDetail]);
  useEffect(() => () => material.dispose(), [material]);
  // Centred on the camera: the world reaches Metropolitan City, ~2 km from the campus origin, outside a fixed dome.
  const dome = useRef<THREE.Mesh>(null!);
  useFrame(({ camera, clock }) => { dome.current?.position.set(camera.position.x, camera.position.y, camera.position.z); syncSky(uniforms, clock.elapsedTime); });
  return <mesh ref={dome} name="sky" material={material} renderOrder={-1000} frustumCulled={false} scale={1000}><sphereGeometry args={[1, 48, 24]} /></mesh>;
}

/** Street-lamp pools at night: a fixed number of point lights (so no shader recompiles) moved to the lamps nearest the camera. */
const POOL: Record<string, number> = { low: 0, medium: 4, high: 8, ultra: 10 };
function lampHead(l: { x: number; z: number; yaw: number }) { return new THREE.Vector3(l.x + Math.sin(l.yaw) * 1.55, 7.55, l.z + Math.cos(l.yaw) * 1.55); }

/** Sun/moon, sky fill, fog and the reflection probe, advanced from the environment controller every frame. */
export function Lighting({ quality }: { quality: QualityProfile }) {
  const { gl, scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null!), hemi = useRef<THREE.HemisphereLight>(null!);
  const frame = useRef(0);
  const time = useGame(s => s.timeOfDay), weather = useGame(s => s.weather), reduced = useGame(s => s.reducedMotion);
  const qualityKey = useGame(s => s.quality);
  const settings = useRef({ time, weather, reduced }); settings.current = { time, weather, reduced };
  // Advance once before the first frame so the first compile and shadow render already see the right sky.
  useMemo(() => updateEnvironment(Date.now(), 0, time, weather, reduced), [time, weather, reduced]);

  // ---- reflection probe: the sky shader without the sun disc, rendered into a cube and prefiltered.
  const probe = useMemo(() => {
    const uniforms = skyUniforms(), s = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(uniforms, quality.materialDetail ? 4 : 2, true));
    mesh.frustumCulled = false; s.add(mesh);
    return { scene: s, mesh, uniforms, pmrem: new THREE.PMREMGenerator(gl), target: null as THREE.WebGLRenderTarget | null, revision: -1, at: -1e9 };
  }, [gl, quality.materialDetail]);
  const probeSize = quality.materialDetail ? (quality.post ? 256 : 128) : 64;
  const minInterval = quality.post ? 1.5 : quality.materialDetail ? 3 : 8;
  const regenerate = useMemo(() => (now: number) => {
    syncSky(probe.uniforms, now); probe.uniforms.uFlash.value = 0;
    const previous = probe.target;
    probe.target = probe.pmrem.fromScene(probe.scene, 0, .1, 1000, { size: probeSize });
    scene.environment = probe.target.texture;
    previous?.dispose();
    probe.revision = env.revision; probe.at = now;
  }, [probe, scene, probeSize]);
  useEffect(() => {
    scene.fog = new THREE.Fog(env.fogColor.clone(), env.fogNear, env.fogFar);
    regenerate(performance.now() / 1000);
    if (QA_HOOKS) Object.assign(window, { __campusEnvironment: (o?: { preset?: string; time?: string; weather?: string }) => {
      const g = useGame.getState();
      // 'night', 'storm' or 'night:storm': a time, a weather, or both.
      if (o?.preset) for (const part of o.preset.split(':')) {
        if (part in WEATHER) g.set({ weather: part as never }); else if (part in TIMES || part === 'live') g.set({ timeOfDay: part as never });
      }
      if (o?.time) g.set({ timeOfDay: o.time as never });
      if (o?.weather) g.set({ weather: o.weather as never });
      return { hour: +env.hour.toFixed(2), weather: env.weather, night: +env.night.toFixed(2), lights: +env.lights.toFixed(2), wet: +env.wet.toFixed(2), exposure: +env.exposure.toFixed(2), keyIntensity: +env.keyIntensity.toFixed(2), probeRevision: probe.revision };
    } });
    return () => {
      scene.environment = null; scene.fog = null; probe.target?.dispose(); probe.target = null; probe.pmrem.dispose(); probe.mesh.geometry.dispose(); (probe.mesh.material as THREE.Material).dispose();
      if (QA_HOOKS) delete (window as unknown as Record<string, unknown>).__campusEnvironment;
    };
  }, [scene, probe, regenerate]);

  // ---- shadows: the frustum is fitted, in light space, around the region to cover.
  const region = useRef(''), lastKey = useRef(new THREE.Vector3());
  const box = useMemo(() => ({ corners: [-78, 78, -72, 66] as [number, number, number, number] }), []);
  const fit = useMemo(() => (corners: [number, number, number, number]) => {
    const light = sun.current, s = light.shadow, cam = s.camera, centre = new THREE.Vector3((corners[0] + corners[1]) / 2, 0, (corners[2] + corners[3]) / 2);
    // Keep the light out of the ground: a low sun is clamped to ~6° for the shadow frustum (shadows stay long).
    const dir = lastKey.current.copy(env.key); if (dir.y < .1) { dir.y = .1; dir.normalize(); }
    light.position.copy(centre).addScaledVector(dir, 160); light.target.position.copy(centre); light.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(light.position, centre, new THREE.Vector3(0, 1, 0));
    const inv = view.clone().invert(), bounds = new THREE.Box3();
    for (const x of [corners[0], corners[1]]) for (const z of [corners[2], corners[3]]) for (const y of [0, 22]) bounds.expandByPoint(new THREE.Vector3(x, y, z).sub(light.position).applyMatrix4(inv));
    cam.left = bounds.min.x; cam.right = bounds.max.x; cam.top = bounds.max.y; cam.bottom = bounds.min.y;
    cam.near = Math.max(.5, -bounds.max.z - 30); cam.far = -bounds.min.z + 30;
    cam.updateProjectionMatrix(); s.needsUpdate = true;
  }, []);
  useEffect(() => {
    const s = sun.current.shadow;
    region.current = '';
    s.mapSize.set(quality.shadowSize, quality.shadowSize); s.radius = quality.shadowRadius; s.bias = -.00025; s.normalBias = .035;
    s.map?.dispose(); s.map = null;
    s.autoUpdate = quality.shadowMode !== 'static'; s.needsUpdate = true;
    if (quality.shadowMode === 'static') { const t = [800, 2500, 6000].map(ms => setTimeout(() => { s.needsUpdate = true; }, ms)); return () => t.forEach(clearTimeout); }
  }, [quality]);
  // A static (render-once) map must not freeze anything that moves into it: see ./shadows.
  useEffect(() => {
    if (quality.shadowMode !== 'static') return;
    const light = sun.current, before = scene.onBeforeRender, after = scene.onAfterRender; let restore: (() => void) | null = null;
    scene.onBeforeRender = (...args) => { before.apply(scene, args); if (light.shadow.needsUpdate && !light.shadow.autoUpdate) restore = hideMovingCasters(); };
    scene.onAfterRender = (...args) => { restore?.(); restore = null; after.apply(scene, args); };
    return () => { restore?.(); scene.onBeforeRender = before; scene.onAfterRender = after; };
  }, [scene, quality]);

  // ---- night lamp pool
  const poolSize = POOL[qualityKey] ?? 0;
  const pool = useMemo(() => Array.from({ length: poolSize }, () => { const l = new THREE.PointLight('#ffc98a', 0, 24, 2); l.name = 'street-lamp-light'; return l; }), [poolSize]);
  const poolState = useRef({ at: 0 });

  useFrame(({ camera, clock }, raw) => {
    const s = settings.current, now = clock.elapsedTime;
    updateEnvironment(Date.now(), Math.min(raw, .5), s.time, s.weather, s.reduced);
    updateLamps();
    const light = sun.current;
    light.color.copy(env.keyColor); light.intensity = env.keyIntensity;
    hemi.current.color.copy(env.hemiSky); hemi.current.groundColor.copy(env.hemiGround); hemi.current.intensity = env.hemiIntensity + env.lightning * 2.5;
    scene.environmentIntensity = .92 * (1 + env.lightning * 1.5);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(env.fogColor);
    // Tone-mapping exposure without the post stack (with it, PostFX applies env.exposure).
    gl.toneMappingExposure = env.exposure;
    if (env.revision !== probe.revision && now - probe.at > minInterval) regenerate(now);

    const inside = Math.abs(player.x) < 85 && player.z > -78 && player.z < 70, step = 24;
    const industrial = inDistrict(player.x, player.z), cityStreets = player.z > 1500;
    const key = inside ? 'campus' : `${industrial ? 'freight:' : ''}${Math.round(player.x / step)},${Math.round(player.z / step)}`;
    // The key light moves with the sun: refit (and, for static maps, re-render) once it has turned ~0.6°.
    const turned = lastKey.current.angleTo(env.key.y < .1 ? new THREE.Vector3(env.key.x, .1, env.key.z).normalize() : env.key) > .01;
    if (key !== region.current || turned) {
      const moved = key !== region.current; region.current = key;
      const shadow = light.shadow;
      const size = industrial && quality.shadowMode === 'every-2nd-frame' ? Math.min(3072, quality.shadowSize) : quality.shadowSize;
      if (shadow.mapSize.x !== size) { shadow.mapSize.set(size, size); shadow.map?.dispose(); shadow.map = null; }
      if (inside) box.corners = [-78, 78, -72, 66];
      else { const cx = Math.round(player.x / step) * step, cz = Math.round(player.z / step) * step, radius = industrial || cityStreets ? 52 : 70; box.corners = [cx - radius, cx + radius, cz - radius, cz + radius]; }
      fit(box.corners);
      if (moved || turned) shadow.needsUpdate = true;
    }
    if (scene.fog instanceof THREE.Fog) {
      const k = industrial ? .9 : 1;
      scene.fog.near = env.fogNear * (industrial ? .73 : 1); scene.fog.far = env.fogFar * k * (industrial ? .89 : 1);
    }
    if (quality.shadowMode !== 'static') { const sh = light.shadow, interval = (quality.shadowMode === 'every-2nd-frame' ? 2 : 1) * (campusBudget.level >= 2 ? 3 : 1); sh.autoUpdate = false; sh.needsUpdate = sh.needsUpdate || frame.current++ % interval === 0; }

    // Lamp pool: every half second, the lamps nearest a point a little ahead of the camera.
    if (pool.length) {
      const on = env.lights;
      if (now - poolState.current.at > .5) {
        poolState.current.at = now;
        const ahead = new THREE.Vector3(); camera.getWorldDirection(ahead); ahead.y = 0; ahead.normalize().multiplyScalar(14).add(camera.position);
        const near = on > .01 ? LIGHTS.map(l => ({ l, d: (l.x - ahead.x) ** 2 + (l.z - ahead.z) ** 2 })).filter(o => o.d < 90 * 90).sort((a, b) => a.d - b.d).slice(0, pool.length) : [];
        pool.forEach((p, i) => { const n = near[i]; if (n) { p.position.copy(lampHead(n.l)); p.userData.on = 1; } else p.userData.on = 0; });
      }
      for (const p of pool) p.intensity = p.userData.on ? 140 * on : 0;
    }
  });
  return <>
    <directionalLight ref={sun} color={env.keyColor} intensity={env.keyIntensity} castShadow />
    <hemisphereLight ref={hemi} args={[env.hemiSky, env.hemiGround, env.hemiIntensity]} />
    {pool.map((l, i) => <primitive key={i} object={l} />)}
  </>;
}
