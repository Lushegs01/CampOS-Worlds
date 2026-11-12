// Combat Arena 3D view.
//
// Rendering: physically based materials lit by the HDR sky (image-based lighting) and a shadow-casting
// sun, drawn into a half-float buffer and finished by a post stack (ambient occlusion, restrained bloom,
// filmic tone mapping, a light grade and SMAA). The first-person weapon is its own pass over a cleared
// depth buffer, so it never clips into walls and still receives the same grade. Low quality keeps the
// same assets and lighting and skips the post stack.
//
// Everything in the frame loop is imperative and pooled: the environment is a few merged meshes and
// instanced props, soldiers are created once per player, and effects come from fixed particle pools.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, BloomEffect, VignetteEffect, BrightnessContrastEffect, HueSaturationEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { WEAPONS, EQUIPMENT_BY_ID } from '../../shared/arena/weapons.mjs';
import { weaponOf, eyeOf } from '../../shared/arena/sim.mjs';
import { raycast } from '../../shared/arena/physics.mjs';
import { setListener } from '../audio/mixer';
import { useArena, useBanners } from './store';
import { live, onFx, tickInput, eye, useStreak, matOf, toggleAutoFire, sceneLoaded, onRetryAssets, type Fx } from './net';
import * as deploy from './deploy';
import { deadline } from '../world/fetcher';
import { controls, pollGamepad, attachDesktop } from './input';
import { ARENA_QUALITY, softTexture, labelTexture, TEAM_COLORS, type ArenaQuality } from './scene/world';
import { loadLibrary, loadDecor, skyDome, clearMaterialCache, P1, P2, type Library } from './scene/library';
import { buildEnvironment, surfaceOf } from './scene/environment';
import { weaponModel, FirstPersonArms, preloadArms, preloadWeapon, releaseWeapons, weaponResources } from './scene/weapons';
import { loadSoldiers, Soldier, StandInSoldier, soldierModelFor, prefetchRemainingWeapons, releaseSoldiers, standInResources, type SoldierLike } from './scene/soldiers';
import { forgetAssets, cachedAssets } from '../world/assets';
import { trackDisposeListeners } from './scene/gpuListeners';
import { createAdaptive, frameTarget } from '../../shared/arena/adaptive.mjs';

import { Effects, Casings } from './scene/fx';
import { sfx, setIndoor, startAmbience, stopArenaAmbience, stopMatchSounds, prepareMatch, prepareWeapon, prepareVoice, forgetPrepared, trimBanks, nearSurfaces, actions, remoteActions, breathing, ambienceFrame, setGroundProvider, engine as soundEngine, type StepSurface, type ImpactSurface } from './audio';
import { reloadPlan } from './sound/reloads.mjs';
import { stepSurfaceOf, impactSurfaceOf, groundSurface, isStair } from './sound/surfaces.mjs';
import { createGait, createRemoteGait } from './sound/gait.mjs';
import { QA_HOOKS } from '../qa';

const EQUIP_IDS = [...EQUIPMENT_BY_ID.keys()];
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), e1 = new THREE.Euler();
const scratch = { t: 0, box: null as { i: number } | null, normal: [0, 0, 0], ground: false };
const frustum = new THREE.Frustum(), cullM = new THREE.Matrix4(), cullS = new THREE.Sphere();

/** Leaving the arena: let go of its parsed models and textures (the HTTP cache keeps the files for next time). */
export function releaseArena() { releaseWeapons(); releaseSoldiers(); forgetAssets('arena/'); clearMaterialCache(); soundEngine.shutdown(); soundEngine.setProbe(null); forgetPrepared(); }

/** Free the GPU side of every geometry, material and texture under these roots (see the world clean-up). */
function releaseGpu(...roots: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const texturesOf = (m: THREE.Material) => {
    for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
    const u = (m as THREE.ShaderMaterial).uniforms; if (u) for (const x of Object.values(u)) if (x?.value && (x.value as THREE.Texture).isTexture) textures.add(x.value as THREE.Texture);
  };
  for (const root of roots) root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.geometry) geometries.add(m.geometry);
    if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) { materials.add(x); texturesOf(x); }
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton?.dispose();
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}

// Module-level (not created inside the scene): a long-lived callback made inside the component would keep its whole
// closure context — renderer and scene included — alive after the match.

/** Where the map's machines hum (machine boxes) and its lamps buzz (under the roofs), for the ambience. */
function ambientEmitters(map: { boxes: { min: number[]; max: number[]; mat: string }[] }) {
  const out: { at: [number, number, number]; kind: 'machine' | 'hum' }[] = [];
  for (const b of map.boxes) {
    const c: [number, number, number] = [(b.min[0] + b.max[0]) / 2, b.mat === 'roof' ? b.min[1] - .4 : b.max[1], (b.min[2] + b.max[2]) / 2];
    if (b.mat === 'machine') out.push({ at: c, kind: 'machine' }); else if (b.mat === 'roof') out.push({ at: c, kind: 'hum' });
  }
  return out;
}

/** The texture tier is chosen once per match: an adaptive drop to Low mid-match keeps the textures already loaded. */
const matchTier = { id: '', mobile: false };
function tierFor(matchId: string, mobile: boolean) { if (matchTier.id !== matchId) { matchTier.id = matchId; matchTier.mobile = mobile; } return matchTier.mobile; }

export default memo(function ArenaScene({ mapId }: { mapId: string }) {
  const quality = useArena(s => s.settings.quality), matchId = useArena(s => s.match?.id ?? '');
  const q = useMemo(() => { const base = ARENA_QUALITY[quality]; const mobile = tierFor(matchId, base.mobileAssets); return mobile === base.mobileAssets ? base : { ...base, mobileAssets: mobile }; }, [quality, matchId]);
  // Old renderers must not stay reachable through three.js's shared objects (see scene/gpuListeners.ts).
  useLayoutEffect(() => trackDisposeListeners(), []);
  const dpr = Math.min(q.dpr, window.devicePixelRatio || 1);
  // QA builds only: `?qa-scale=0.25` renders at a fixed low resolution so machines without a GPU stay responsive.
  // (or localStorage 'campos-arena-qa-scale', for suites that open pages through shared helpers).
  const qa = QA_HOOKS ? Math.min(1, Math.max(0, Number(new URLSearchParams(location.search).get('qa-scale') ?? (() => { try { return localStorage.getItem('campos-arena-qa-scale'); } catch { return null; } })()) || 0)) : 0;
  return <Canvas key={quality} className="ar-canvas" dpr={qa || [Math.min(1, dpr), dpr]} shadows={q.shadows ? { type: THREE.PCFShadowMap } : false}
    gl={{ antialias: !q.post, powerPreference: 'high-performance', stencil: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: .82 }}
    camera={{ fov: 78, near: .06, far: 1200, position: [0, 2, 0] }}>
    <World mapId={mapId} q={q} />
  </Canvas>;
});

function World({ mapId, q }: { mapId: string; q: ArenaQuality }) {
  const { scene, camera, gl, size } = useThree(), setDpr = useThree(s => s.setDpr), dprNow = useThree(s => s.viewport.dpr);
  const map = MAP_BY_ID.get(mapId)!;
  const settings = useArena(s => s.settings);
  const [lib, setLib] = useState<Library | null>(null), [kits, setKits] = useState<Awaited<ReturnType<typeof loadSoldiers>> | null>(null);
  const [gunReady, setGunReady] = useState(false), [compiled, setCompiled] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => onRetryAssets(() => setAttempt(n => n + 1)), []);
  // ---------------------------------------------------------------- staged loading
  // Priority 1 (needed to play): every environment surface, the props that are cover, the sky and its light, the
  // player's own weapon and arms. Priority 2, in parallel but behind them in the download queue: the soldiers (other
  // players are drawn as stand-ins until they arrive), the second weapon. Set dressing waits until the match is on
  // screen. A failure of something needed to play stops the deployment with the reason and a Retry; anything else
  // falls back and carries on.
  useEffect(() => {
    let on = true; const ctrl = new AbortController();
    useArena.getState().set({ sceneReady: false }); sceneLoaded(false); setCompiled(false);
    deploy.enter('preparing'); deploy.setTier(q.mobileAssets ? 'mobile' : 'full');
    const what = (e: unknown) => String((e as Error)?.message ?? e).replace(/^.*\/assets\//, '').slice(0, 160);
    const primary = live.loadout?.primary ?? 'vanguard', secondary = live.loadout?.secondary;
    // The player's own weapon is queued first: it is one file with a dozen textures to transcode.
    preloadWeapon(primary, false, P1).then(() => { if (on) setGunReady(true); }).catch(e => { console.error('Arena weapon could not load.', e); if (on) deploy.fail('Your weapon could not be downloaded.', 'assets', what(e)); });
    loadLibrary(gl, q).then(l => { if (on) setLib(l); }).catch(e => { console.error('Arena assets could not load.', e); if (on) deploy.fail('The training ground could not be downloaded.', 'assets', what(e)); });
    if (secondary && secondary !== primary) void preloadWeapon(secondary, false, P2).catch(() => null);
    // Sound: phones get fewer voices, plain panning and a rumble filter; the sound banks the player needs first (their
    // weapons, the map's surfaces) are queued now, behind nothing the deployment waits for.
    soundEngine.configure({ voices: q.mobileAssets ? 20 : 32, hrtf: !q.mobileAssets, phone: q.mobileAssets });
    prepareMatch(mapId, map, [primary, ...(secondary ? [secondary] : [])], live.num, soldierModelFor(live.num));
    // Soldiers: stand-ins until they arrive; a failure is retried quietly in the background.
    const soldiers = (n: number): void => { loadSoldiers(q.mobileAssets, ctrl.signal).then(k => { if (on) setKits(k); }).catch(e => { if (!on || (e as Error).name === 'AbortError') return; console.warn('Arena soldiers deferred:', what(e)); if (n < 4) setTimeout(() => on && soldiers(n + 1), 8000 * (n + 1)); }); };
    soldiers(0);
    startAmbience(mapId, ambientEmitters(map));
    return () => { on = false; ctrl.abort(); stopArenaAmbience(); stopMatchSounds(); setIndoor(0); };
  }, [gl, q, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { deploy.pending([...(lib ? [] : ['environment']), ...(gunReady ? [] : ['weapon']), ...(kits ? [] : ['soldiers'])]); }, [lib, gunReady, kits]);

  // ---------------------------------------------------------------- environment, sky and lighting
  const world = useMemo(() => {
    if (!lib) return null;
    const group = new THREE.Group(), env = buildEnvironment(lib, map, q);
    for (const o of env.objects) group.add(o);
    group.add(skyDome(lib));
    const [bx0, bz0, bx1, bz1] = map.bounds, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, half = Math.max(bx1 - bx0, bz1 - bz0) / 2 + 8;
    const sun = new THREE.DirectionalLight(lib.sun.color.clone().multiply(new THREE.Color(1, .95, .86)), lib.sun.irradiance * .95);
    sun.position.set(cx, 0, cz).addScaledVector(lib.sun.dir, 110); sun.target.position.set(cx, 0, cz);
    if (q.shadows) {
      sun.castShadow = true; sun.shadow.mapSize.set(q.shadowSize, q.shadowSize); sun.shadow.radius = q.shadowSize >= 2048 ? 3 : 2;
      const c = sun.shadow.camera; c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 10; c.far = 240; c.updateProjectionMatrix();
      sun.shadow.bias = -.0004; sun.shadow.normalBias = .04; sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
    }
    const fill = new THREE.HemisphereLight('#cfdcec', '#8a7c62', 1.1);
    group.add(sun, sun.target, fill);
    // Warm fittings under roofs (unshadowed point lights), nearest the middle of the map first.
    const lamps = [...env.lights].filter(p => p.y < 9).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, q.lights).map(p => { const l = new THREE.PointLight('#ffe2b4', 55, 15, 2); l.position.copy(p).y -= .2; group.add(l); return l; });
    void lamps;
    return { group, sun, decor: env.decor };
  }, [lib, map, q]);
  useEffect(() => {
    if (!world || !lib) return;
    scene.add(world.group); scene.environment = lib.env; scene.environmentIntensity = 1.5;
    const fog = lib.horizon.clone().multiplyScalar(1.05); scene.fog = new THREE.Fog(fog, 55, q.fogFar * 3.2); scene.background = fog;
    // Compile every shader before the player sees the match, so the first seconds of play do not stutter.
    let on = true;
    deadline((gl as THREE.WebGLRenderer & { compileAsync: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> }).compileAsync(scene, camera), 8000, 'shader compile').catch(() => null).then(() => { if (on) setCompiled(true); });
    // Set dressing streams in once the match is playable (priority 2); a static sun shadow is redrawn once for it.
    const ctrl = new AbortController();
    const decorate = () => loadDecor(lib, ctrl.signal).then(keys => { if (!on || !keys.length) return; for (const m of world.decor(keys)) world.group.add(m); world.sun.shadow.needsUpdate = true; });
    const waitPlayable = () => { if (!on) return; if (useArena.getState().sceneReady) void decorate(); else setTimeout(waitPlayable, 500); };
    waitPlayable();
    return () => {
      on = false; ctrl.abort();
      // Release everything this renderer uploaded, shared cached assets included: three.js keeps a 'dispose' listener
      // on every texture, geometry and material a renderer has used, and those listeners would keep this renderer
      // (and its WebGL context) alive for as long as the cached assets live. Cached objects stay usable: the next
      // match's renderer uploads them again.
      const shared = cachedAssets('arena/'), weapons = weaponResources();
      releaseGpu(scene, vm.vmScene, world.group, ...shared.scenes, ...weapons.scenes, ...Object.values(lib.props).map(p => p!.scene));
      for (const t of [lib.env, lib.sky, lib.hdr, softTexture(), ...shared.textures]) t.dispose();
      for (const r of standInResources()) { r.geometry.dispose(); r.material.dispose(); }
      for (const m of weapons.materials) m.dispose();
      scene.remove(world.group); scene.environment = null; scene.fog = null; vm.vmScene.environment = null;
      clearMaterialCache();
    };
  }, [scene, world, lib, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- sound levels and the acoustic probe
  useEffect(() => {
    const apply = (st: typeof settings) => soundEngine.setVolumes({ weapons: st.volWeapons, explosions: st.volExplosions, environment: st.volEnvironment, footsteps: st.volFootsteps, character: st.volCharacter, ui: st.volUi, voice: st.volVoice });
    apply(useArena.getState().settings);
    return useArena.subscribe((a, b) => { if (a.settings !== b.settings) apply(a.settings); });
  }, []);
  // What is underfoot, for the sound of every footstep, landing, casing and dropped magazine.
  useEffect(() => {
    setGroundProvider((x, y, z) => groundAt(x, y, z), () => (live.sim ? groundAt(live.sim.x, live.sim.y, live.sim.z).surface : 'concrete'));
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaGround = (x: number, y: number, z: number) => groundAt(x, y, z);
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  // Is a sound behind a wall from the listener, and is its source under a roof? (Two ray casts in the collision world.)
  useEffect(() => {
    const probeHit = { t: 0, box: null as { i: number } | null, normal: [0, 0, 0], ground: false };
    soundEngine.setProbe(at => {
      const w = live.world; if (!w) return { occluded: false, indoor: 0 };
      const c = camera.position, dx = at[0] - c.x, dy = at[1] + .2 - c.y, dz = at[2] - c.z, len = Math.hypot(dx, dy, dz) || 1;
      const block = raycast(w, c.x, c.y, c.z, dx / len, dy / len, dz / len, len - .4, null, probeHit);
      const occluded = !!(block && block.box && block.t < len - .6);
      const up = raycast(w, at[0], at[1] + .5, at[2], 0, 1, 0, 12, null, probeHit);
      return { occluded, indoor: up && up.box ? 1 : 0 };
    });
    return () => soundEngine.setProbe(null);
  }, [camera]);

  // ---------------------------------------------------------------- objectives (Domination)
  const objectives = useMemo(() => {
    const g = new THREE.Group();
    const items = map.objectives.map((o: { id: string; x: number; y: number; z: number; r: number }) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(o.r - .12, o.r, 64), new THREE.MeshBasicMaterial({ color: TEAM_COLORS.neutral, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(o.x, o.y + .03, o.z);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, 1.2, 48, 1, true), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color(TEAM_COLORS.neutral) }, uFill: { value: 0 } },
        vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
        fragmentShader: 'uniform vec3 uColor; uniform float uFill; varying float vY; void main(){ float a = pow(1.0 - vY, 2.5) * (.16 + uFill * .3); gl_FragColor = vec4(uColor, a); }',
      }));
      wall.position.set(o.x, o.y + .6, o.z);
      const { texture, aspect } = labelTexture(o.id, '#ffffff', 96);
      const letter = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, color: TEAM_COLORS.neutral, toneMapped: false }));
      letter.scale.set(.8 * aspect, .8, 1); letter.position.set(o.x, o.y + 3.4, o.z); letter.renderOrder = 10;
      g.add(ring, wall, letter);
      return { ring, wall, letter, o };
    });
    return { g, items };
  }, [map]);
  useEffect(() => { scene.add(objectives.g); return () => { scene.remove(objectives.g); }; }, [scene, objectives]);

  // ---------------------------------------------------------------- effects
  const fx = useMemo(() => {
    const effects = new Effects(q.effects, q.decals);
    const grenades = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(.06, 12, 8), new THREE.MeshStandardMaterial({ color: '#3f4a34', roughness: .55, metalness: .5 })); m.visible = false; m.castShadow = true; effects.group.add(m); return m; });
    const crates = Array.from({ length: 4 }, () => { const g = new THREE.Group(); g.visible = false; effects.group.add(g); return g; });
    const strikes = Array.from({ length: 3 }, () => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(.94, 1, 64), new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })); ring.rotation.x = -Math.PI / 2;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 60, 8), new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      ring.visible = beam.visible = false; effects.group.add(ring, beam); return { ring, beam };
    });
    const muzzleLight = new THREE.PointLight('#ffc27a', 0, 9, 2); if (q.lights) effects.group.add(muzzleLight);
    return { effects, grenades, crates, strikes, muzzleLight, smokes: new Set<number>() };
  }, [q]);
  useEffect(() => { scene.add(fx.effects.group); return () => { scene.remove(fx.effects.group); }; }, [scene, fx]);
  // Supply crates use the photoscanned military crate.
  useEffect(() => { if (!lib) return; for (const g of fx.crates) { g.clear(); const c = lib.props.milCrate.scene.clone(); c.scale.setScalar(.8); g.add(c); } }, [lib, fx]);

  // ---------------------------------------------------------------- players
  const soldiers = useRef(new Map<number, { s: SoldierLike; tag: THREE.Sprite | null; tagKey: string; flashAt: number; model: string; standIn: boolean; animDt?: number }>());
  const dropSoldier = (e: { s: SoldierLike; tag: THREE.Sprite | null }) => { if (e.tag) { (e.tag.material as THREE.SpriteMaterial).map?.dispose(); e.tag.material.dispose(); e.tag = null; } scene.remove(e.s.root); e.s.dispose(); };
  useEffect(() => () => { for (const e of soldiers.current.values()) dropSoldier(e); soldiers.current.clear(); }, [scene, kits]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- first-person weapon
  const vm = useMemo(() => {
    const vmScene = new THREE.Scene(), vmCam = new THREE.PerspectiveCamera(56, 1, .01, 6);
    const sun = new THREE.DirectionalLight('#fff0d8', 3.2), fill = new THREE.HemisphereLight('#cdd9e8', '#5a5348', .5);
    vmScene.add(sun, sun.target, fill);
    const holder = new THREE.Group(); vmScene.add(holder);
    const flash = new THREE.Group(); flash.visible = false; vmScene.add(flash);
    const fm = new THREE.MeshBasicMaterial({ map: softTexture(), color: new THREE.Color(7, 4.2, 1.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(.16, .5), fm); p.rotation.set(-Math.PI / 2, 0, i * Math.PI / 3); p.position.z = -.14; flash.add(p); }
    const core = new THREE.Mesh(new THREE.PlaneGeometry(.2, .2), fm); flash.add(core);
    const casings = new Casings(q.casings); vmScene.add(casings.mesh);
    return {
      vmScene, vmCam, holder, sun, flash, casings, gun: null as THREE.Group | null, gunId: '', skin: '', arms: null as FirstPersonArms | null, armsSrc: null as THREE.Group | null, armsTeam: -1,
      bob: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, kickZ: 0, kickPitch: 0, kickRoll: 0, land: 0, landV: 0, flashAt: 0, sunSeen: 1, indoor: 0, probeAt: 0, breath: 0, cyl: 0, slideKick: 0,
      handR: new THREE.Vector3(.2, -.3, .1), handL: new THREE.Vector3(-.2, -.3, .1),
    };
  }, [q]);
  useEffect(() => { if (lib) { vm.vmScene.environment = lib.env; vm.vmScene.environmentIntensity = .9; vm.gunId = ''; } }, [lib, vm]);
  // The arms are drawn with the weapon; if they cannot be downloaded the weapon is drawn on its own (retried on Retry).
  useEffect(() => { let on = true; preloadArms(P1).then(src => { if (on) { vm.armsSrc = src; vm.armsTeam = -1; } }).catch(e => console.warn('Arena arms could not load.', e?.message ?? e)); return () => { on = false; }; }, [vm, attempt]);

  // ---------------------------------------------------------------- post-processing
  const composer = useMemo(() => {
    if (!q.post) return null;
    const c = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    c.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      const ao = new N8AOPostPass(scene, camera, size.width, size.height);
      Object.assign(ao.configuration, { aoRadius: 1.4, distanceFalloff: .7, intensity: 2.4, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false, color: new THREE.Color('#0a0908') });
      ao.setQualityMode('Medium'); c.addPass(ao);
    }
    const weapon = new RenderPass(vm.vmScene, vm.vmCam); weapon.clearPass.color = false; weapon.clearPass.depth = true; weapon.skipShadowMapUpdate = true; c.addPass(weapon);
    const fxs = [
      ...(q.bloom ? [new BloomEffect({ luminanceThreshold: 2.6, luminanceSmoothing: .5, intensity: .42, mipmapBlur: true, radius: .62 })] : []),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      new BrightnessContrastEffect({ brightness: -.012, contrast: .06 }), new HueSaturationEffect({ saturation: -.06 }),
      new VignetteEffect({ darkness: .42, offset: .28 }),
    ];
    c.addPass(new EffectPass(camera, ...fxs));
    c.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    return { c, weapon };
  }, [gl, scene, camera, q, vm]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!composer) { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = .82; return; }
    const before = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping; gl.toneMappingExposure = .82;
    return () => { composer.c.dispose(); gl.toneMapping = before; };
  }, [composer, gl]);
  useEffect(() => { composer?.c.setSize(size.width, size.height); }, [composer, size, dprNow]);
  // ---------------------------------------------------------------- adaptive performance
  // Hold the frame rate (30 on touch devices, 55 elsewhere): fewer pixels first, then a lighter profile.
  // The simulation, input and network run at fixed rates whatever the frame rate.
  const touchDevice = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const baseDpr = useMemo(() => Math.min(q.dpr, window.devicePixelRatio || 1), [q]);
  const adaptive = useMemo(() => createAdaptive({ target: frameTarget(touchDevice), min: Math.max(.5, .6 / Math.max(1, baseDpr)) }), [q, baseDpr, touchDevice]); // eslint-disable-line react-hooks/exhaustive-deps
  const adaptFps = (fps: number) => {
    const st = useArena.getState().settings; if (!st.adaptive || QA_HOOKS && new URLSearchParams(location.search).has('qa-scale')) return;
    const r = adaptive.sample(fps);
    if (r.changed) setDpr(Math.max(.5, baseDpr * r.scale));
    if (r.stepDown && st.quality !== 'low') {
      const lower = st.quality === 'high' ? 'medium' : 'low';
      useArena.getState().setSettings({ quality: lower, qualityChosen: false });
      useBanners.getState().push({ text: 'Graphics lowered to keep the game smooth', sub: `Now ${lower[0].toUpperCase() + lower.slice(1)} · change it in Settings`, tone: 'info', ms: 3600 });
    }
  };

  // ---------------------------------------------------------------- input
  useEffect(() => attachDesktop(gl.domElement, {
    streak: id => useStreak(id),
    scoreboard: open => useArena.getState().set({ scoreboard: open }),
    menu: () => { const a = useArena.getState(); a.set({ menu: !a.menu }); },
    autoFire: () => toggleAutoFire(),
  }, () => ({ ads: live.sim?.ads ?? 0, zoom: zoomOf() })), [gl]);
  const zoomOf = () => { const s = live.sim; if (!s) return 1; const w = weaponOf(s); return w.zoom ?? (w.category === 'melee' ? 1 : 1.3); };

  // ---------------------------------------------------------------- events from the network layer
  useEffect(() => onFx((f: Fx) => {
    const now = performance.now();
    if (f.type === 'tracer') {
      const from = v1.fromArray(f.from), to = v2.fromArray(f.to);
      if (f.local) { const muzzle = vm.gun?.getObjectByName('muzzle'); if (muzzle) { muzzle.getWorldPosition(from); from.applyMatrix4(camera.matrixWorld); } }
      if (f.local || Math.random() < .5 + q.effects * .5) fx.effects.tracer(from, to);
    } else if (f.type === 'impact') {
      const at = v1.fromArray(f.at), n = v2.fromArray(f.normal), kind = surfaceOf(f.mat);
      fx.effects.impact(at, n, kind, f.flesh);
      // (A round stopped by a player is heard from the network layer, where the server says who and where.)
      if (!f.flesh) sfx.impact(impactSurfaceOf(f.mat) as ImpactSurface, [at.x, at.y, at.z]);
    } else if (f.type === 'boom') fx.effects.explosion(v1.fromArray(f.at), f.r);
    else if (f.type === 'smoke') fx.effects.smokeCloud(v1.fromArray(f.at), f.r, f.ms / 1000);
    else if (f.type === 'flash') fx.effects.flashbang(v1.fromArray(f.at));
    else if (f.type === 'muzzle') { const e = soldiers.current.get(f.num); if (e) e.flashAt = now; }
    else if (f.type === 'capture') { const o = objectives.items.find(i => i.o.id === f.id); if (o) fx.effects.capture(v1.set(o.o.x, 0, o.o.z), new THREE.Color(f.team === live.team ? TEAM_COLORS.friend : TEAM_COLORS.enemy), o.o.r); }
    else if (f.type === 'land') vm.landV -= Math.min(1.2, f.speed * .09);
    else if (f.type === 'shot') {
      // Our own shot: flash, kick, a casing and a wisp of smoke.
      const w = WEAPONS.find(x => x.id === f.weapon)!, heavy = w.category === 'sniper' || w.category === 'shotgun' ? 1 : w.category === 'lmg' ? .55 : w.category === 'pistol' ? .5 : .38, ads = live.sim?.ads ?? 0;
      vm.flashAt = now; vm.kickZ += .028 * heavy * (1 - ads * .35) + .008; vm.kickPitch += .05 * heavy * (1 - ads * .5) + .008; vm.kickRoll += (Math.random() - .5) * .03 * heavy; vm.slideKick = 1;
      const port = vm.gun?.getObjectByName('ejection');
      if (port && w.fire !== 'bolt' && w.id !== 'bastion' && w.id !== 'thorn') { vm.casings.eject(port.getWorldPosition(v1)); sfx.ejected(w.id); }
      const muzzle = vm.gun?.getObjectByName('muzzle');
      if (muzzle) { muzzle.getWorldPosition(v1).applyMatrix4(camera.matrixWorld); camera.getWorldDirection(v2); fx.effects.muzzle(v1, v2); fx.muzzleLight.position.copy(v1); fx.muzzleLight.intensity = 28; }
    }
  }), [fx, vm, camera, q, objectives]);

  // ---------------------------------------------------------------- the frame
  const fwd = useMemo(() => new THREE.Vector3(), []), eyePos = useMemo(() => ({ x: 0, y: 0, z: 0 }), []), sample = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0 }), []);
  const gait = useMemo(() => createGait(), []), remoteGaits = useMemo(() => new Map<number, ReturnType<typeof createRemoteGait>>(), []), grenadeSounds = useMemo(() => new Map<number, { x: number; y: number; z: number; vy: number; at: number; moving: number; stuck: boolean; beepAt: number }>(), []), falling = useRef(false);
  const deathCam = useRef<{ x: number; y: number; z: number; at: number } | null>(null), fpsRef = useRef({ frames: 0, t: 0 }), frameNo = useRef(0), dustAt = useRef(0);
  useEffect(() => { if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaDebug = () => ({ kits: !!kits, lib: !!lib, soldiers: soldiers.current.size, vm: { gun: vm.gunId, holder: vm.holder.visible, arms: !!vm.arms, armsSrc: !!vm.armsSrc, pos: vm.holder.position.toArray().map(n => +n.toFixed(3)) }, bodies: [...soldiers.current.values()].map(e => { const b = new THREE.Box3().setFromObject(e.s.root); return { vis: e.s.root.visible, at: e.s.root.position.toArray().map(n => +n.toFixed(2)), min: b.min.toArray().map(n => +n.toFixed(2)), max: b.max.toArray().map(n => +n.toFixed(2)) }; }), remotes: [...live.remotes.values()].map(r => ({ num: r.num, team: r.team, flags: r.flags, seen: Math.round(performance.now() - r.seenAt), dead: r.deadAt })) }); }, [kits, lib]);
  useEffect(() => { gl.info.autoReset = false; if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaGL = gl; return () => { gl.info.autoReset = true; }; }, [gl]);
  // QA builds: the inspection hooks hold this match's renderer, scene and assets; drop them with the scene.
  useEffect(() => () => { if (QA_HOOKS) for (const k of ['__arenaGL', '__arenaDebug', '__arenaBreakdown', '__arenaStats', '__arenaGround']) delete (window as unknown as Record<string, unknown>)[k]; }, []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, .1), now = performance.now(), a = useArena.getState(), cam = camera as THREE.PerspectiveCamera;
    frameNo.current++;
    pollGamepad(dt, live.sim?.ads ?? 0, zoomOf());
    tickInput(dt);
    const s = live.sim;
    // ---- camera
    const decay = Math.exp(-dt * 14); live.smooth.x *= decay; live.smooth.y *= decay; live.smooth.z *= decay;
    live.kick *= Math.exp(-dt * 16); live.shake *= Math.exp(-dt * 5);
    if (s && live.alive) {
      deathCam.current = null;
      eye(eyePos);
      const speed = Math.hypot(s.vx, s.vz), moving = s.grounded ? Math.min(1, speed / 5) : 0;
      // Head bob: small and smooth, stronger when sprinting, gone when aiming.
      const bobK = moving * (1 - s.ads * .85) * (s.sprint ? 1.5 : 1), shake = live.shake * .025;
      // The view dips as each foot lands (cos 2φ is lowest at φ = π/2 + nπ, the gait's footfalls).
      cam.position.set(eyePos.x + (Math.random() - .5) * shake, eyePos.y + Math.cos(vm.bob * 2) * .012 * bobK + vm.land * .08 + (Math.random() - .5) * shake, eyePos.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = controls.yaw + s.ry;
      cam.rotation.x = controls.pitch + s.rp + live.kick * .006 + vm.land * .03;
      cam.rotation.z = (s.stance === 2 ? -.07 : 0) + Math.sin(vm.bob) * .004 * bobK + (s.sprint ? Math.sin(vm.bob) * .006 : 0);
      const zoom = 1 + (zoomOf() - 1) * s.ads * s.ads, fov = settings.fov / zoom * (s.sprint ? 1.05 : 1);
      if (Math.abs(cam.fov - fov) > .01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 14); cam.updateProjectionMatrix(); }
      // One gait phase moves the camera, the weapon and the feet: footsteps on whatever is underfoot, a scuff when
      // stopping hard or turning sharply, the air rushing past in a long fall, breath that follows the effort.
      const g = gait.update(dt, s.vx, s.vz, s.grounded, s.sprint, s.stance === 1, s.stance === 2); vm.bob = gait.phase;
      if (g.step || g.stop || g.turn) { const gi = groundAt(s.x, s.y, s.z); if (g.step) sfx.step(gi.surface, g.step, { stairs: gi.stairs }); if (g.stop || g.turn) sfx.scuff(gi.surface, undefined, g.turn); }
      if (!s.grounded && s.vy < -9 && !falling.current) { falling.current = true; sfx.falling(); } else if (s.grounded) falling.current = false;
      breathing.frame(dt, s.sprint && s.grounded && speed > 3, a.hud.hp, true);
      ownActions(s);
    } else if (s) {
      breathing.frame(dt, false, 100, false); ownActions(null);
      const d = deathCam.current ??= { x: s.x, y: s.y + 1.4, z: s.z, at: now };
      const k = Math.min(1, (now - d.at) / 700), killer = a.killedBy?.num != null ? live.remotes.get(a.killedBy.num) : null;
      cam.position.set(d.x, d.y - k * 1.05, d.z); cam.rotation.order = 'YXZ';
      if (killer && killer.seenAt) { const want = Math.atan2(-(killer.pos.x - d.x), -(killer.pos.z - d.z)); cam.rotation.y += Math.atan2(Math.sin(want - cam.rotation.y), Math.cos(want - cam.rotation.y)) * Math.min(1, dt * 3); }
      cam.rotation.z = k * .4; cam.rotation.x = -k * .1;
      if (Math.abs(cam.fov - settings.fov) > .01) { cam.fov = settings.fov; cam.updateProjectionMatrix(); }
    }
    cam.updateMatrixWorld();
    cam.getWorldDirection(fwd); setListener(cam.position, fwd);
    ambienceFrame([cam.position.x, cam.position.y, cam.position.z]);
    if (frameNo.current % 600 === 0 && live.loadout) trimBanks([live.loadout.primary, live.loadout.secondary]);
    // Every two seconds: the footstep banks of the boxes within 16 m (their surfaces are heard before they are reached).
    if (frameNo.current % 120 === 30) {
      const near = new Set<StepSurface>(), cx = cam.position.x, cz = cam.position.z;
      for (const b of map.boxes) { const dx = Math.max(b.min[0] - cx, 0, cx - b.max[0]), dz = Math.max(b.min[2] - cz, 0, cz - b.max[2]); if (dx * dx + dz * dz < 256) near.add(stepSurfaceOf(b.mat) as StepSurface); }
      nearSurfaces([...near]);
    }
    // ---- surroundings: are we under a roof, and can the sun reach the weapon?
    if (lib && live.world && now - vm.probeAt > 220) {
      vm.probeAt = now;
      const up = raycast(live.world, cam.position.x, cam.position.y, cam.position.z, 0, 1, 0, 14, null, scratch);
      vm.indoor = up && up.box ? 1 : 0;
      const d = lib.sun.dir, sunHit = raycast(live.world, cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z, 80, null, scratch);
      vm.sunSeen = sunHit && sunHit.box ? 0 : 1;
      setIndoor(vm.indoor);
    }
    // ---- shadows: static on phones, refreshed at the profile's rate otherwise
    if (world && q.shadows && q.shadowEvery && frameNo.current % q.shadowEvery === 0) world.sun.shadow.needsUpdate = true;
    // ---- players
    const t = live.playback.time(now), seenNums = new Set<number>();
    // Soldiers are skinned meshes with culling off (their bones move them outside their bounds), so cull them here:
    // a sphere around each soldier against the view frustum (wider when sun shadows are drawn live, so a shadow cast
    // into view from just outside it stays).
    cullM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(cullM);
    const cullR = q.shadows && q.shadowEvery ? 3.2 : 1.4;
    // Where everyone is comes from the network, whether or not their soldier model has downloaded yet.
    if (t != null) for (const r of live.remotes.values()) if (!r.deadAt) { r.track.sample(t, sample); r.pos.x = sample.x; r.pos.y = sample.y; r.pos.z = sample.z; r.pos.yaw = sample.yaw; }
    if (lib) for (const r of live.remotes.values()) {
      const dead = !!r.deadAt, visible = ((r.flags & 1) && r.seenAt && now - r.seenAt < 3000) || (dead && now - r.deadAt < 2600);
      let e = soldiers.current.get(r.num);
      const model = soldierModelFor(r.num);
      // Until the soldier models arrive a player is drawn as a stand-in, never left invisible.
      if (e && (e.s.team !== r.team || e.model !== model || (e.standIn && kits))) { dropSoldier(e); soldiers.current.delete(r.num); e = undefined; }
      if (!e) { if (!visible || r.team < 0) continue; e = { s: kits ? new Soldier(kits[model], r.team, lib, softTexture()) : new StandInSoldier(r.team), tag: null, tagKey: '', flashAt: 0, model, standIn: !kits }; soldiers.current.set(r.num, e); scene.add(e.s.root); }
      seenNums.add(r.num);
      e.s.root.visible = !!visible; if (!visible) continue;
      const inView = frustum.intersectsSphere(cullS.set(v3.set(r.pos.x, r.pos.y + .95, r.pos.z), cullR));
      if (t != null && !dead) r.track.sample(t, sample); // (for the footstep cadence below)
      const w = WEAPONS[r.weapon]; if (w) { e.s.setWeapon(w.id); prepareWeapon(w.id); }
      const far = Math.hypot(r.pos.x - cam.position.x, r.pos.z - cam.position.z);
      // Out of view: placed but not posed or drawn. Far away: posed at a lower rate (every 2nd frame beyond 25 m, every
      // 3rd beyond 50 m on Low), with the skipped time carried into the next pose so animation speed is unchanged.
      e.s.root.visible = inView;
      const every = !inView ? 0 : far > 50 ? (q.mobileAssets ? 3 : 2) : far > 25 ? 2 : 1;
      e.animDt = (e.animDt ?? 0) + dt;
      if (every && (frameNo.current + r.num) % every === 0) { e.s.update(e.animDt, v1.set(r.pos.x, r.pos.y, r.pos.z), r.pos.yaw, r.pitch, r.flags, dead, now - e.flashAt < 55, q.ik && far < 45); e.animDt = 0; }
      else e.s.place(v1.set(r.pos.x, r.pos.y, r.pos.z), r.pos.yaw);
      // Identification: teammates carry a blue name; enemies a small red marker (hidden behind cover).
      const info = a.match?.players.find(p => p.num === r.num), friend = r.team === live.team;
      const key = dead ? '' : friend ? (info ? info.name + (info.bot ? ' · SIM' : '') : '') : '◆';
      if (e.tagKey !== key) {
        e.tagKey = key;
        if (e.tag) { e.s.root.remove(e.tag); (e.tag.material as THREE.SpriteMaterial).map?.dispose(); e.tag.material.dispose(); e.tag = null; }
        if (key) { const { texture, aspect } = labelTexture(key, friend ? TEAM_COLORS.friend : TEAM_COLORS.enemy, 44, false); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: !friend, transparent: true, toneMapped: false, opacity: friend ? 1 : .9 })); const h = friend ? .3 : .16; sp.scale.set(h * aspect, h, 1); sp.position.y = 2.12; sp.renderOrder = 9; e.s.root.add(sp); e.tag = sp; }
      }
    }
    remoteSounds(dt, now);
    for (const [num, e] of soldiers.current) if (!seenNums.has(num)) { if (!live.remotes.has(num)) { dropSoldier(e); soldiers.current.delete(num); } else e.s.root.visible = false; }
    // ---- effects
    fx.effects.update(dt); vm.casings.update(dt);
    if (fx.muzzleLight.intensity > 0) fx.muzzleLight.intensity = Math.max(0, fx.muzzleLight.intensity - dt * 600);
    if (q.detail && s && now - dustAt.current > 260) { dustAt.current = now; fx.effects.mote(v1.set(cam.position.x + (Math.random() - .5) * 14, .2 + Math.random() * 2.2, cam.position.z + (Math.random() - .5) * 14)); }
    let gi = 0; for (const gr of live.grenades.values()) { const m = fx.grenades[gi++]; if (!m) break; m.visible = true; m.position.set(gr.x, gr.y, gr.z); (m.material as THREE.MeshStandardMaterial).color.set(EQUIP_IDS[gr.kind] === 'flash' ? '#b9bcc0' : EQUIP_IDS[gr.kind] === 'smoke' ? '#5f6c78' : '#3f4a34'); }
    for (; gi < fx.grenades.length; gi++) fx.grenades[gi].visible = false;
    grenadeAudio(now);
    live.supplies = live.supplies.filter(c => now < c.until);
    fx.crates.forEach((g, i) => { const c = live.supplies[i]; g.visible = !!c; if (c) g.position.set(c.x, c.y, c.z); });
    live.strikes = live.strikes.filter(x => now < x.at + 400);
    fx.strikes.forEach((st, i) => { const x = live.strikes[i]; st.ring.visible = st.beam.visible = !!x; if (x) { const pulse = 1 + .06 * Math.sin(now / 90); st.ring.position.set(x.x, x.y + .06, x.z); st.ring.scale.setScalar(x.r * pulse); st.beam.position.set(x.x, x.y + 30, x.z); } });
    // ---- objectives
    if (a.match?.mode === 'dom') {
      objectives.g.visible = true;
      a.hud.objectives.forEach(([owner, progress, capTeam, contested], i) => {
        const item = objectives.items[i]; if (!item) return;
        const color = contested ? '#ffd166' : owner < 0 ? TEAM_COLORS.neutral : owner === live.team ? TEAM_COLORS.friend : TEAM_COLORS.enemy;
        const cap = capTeam < 0 ? null : capTeam === live.team ? TEAM_COLORS.friend : TEAM_COLORS.enemy;
        (item.ring.material as THREE.MeshBasicMaterial).color.set(color);
        const u = (item.wall.material as THREE.ShaderMaterial).uniforms; u.uColor.value.set(cap ?? color); u.uFill.value = cap ? progress / 100 : 0;
        (item.letter.material as THREE.SpriteMaterial).color.set(color); item.letter.position.y = 3.4 + Math.sin(now / 600 + i) * .06;
      });
    } else objectives.g.visible = false;
    updateViewmodel(dt, now);
    // Playable once the world is built and its shaders compiled and the player's own weapon is here. Then the server
    // is told (it brings a held player into the match), and the remaining weapons stream in idle time.
    if (!a.sceneReady && world && compiled && gunReady) {
      a.set({ sceneReady: true }); sceneLoaded(true);
      const saveData = !!(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
      prefetchRemainingWeapons(q.detail > 0 && !saveData);
    } else if (a.sceneReady && a.match && live.loadedSent !== a.match.id) sceneLoaded(true);
    const f = fpsRef.current; f.frames++; if (now - f.t > 1000) { const fps = Math.round(f.frames * 1000 / (now - f.t)); f.frames = 0; f.t = now; if (a.hud.fps !== fps) a.set({ hud: { ...useArena.getState().hud, fps } }); if (a.sceneReady && !document.hidden) adaptFps(fps); }
  }, -1);

  /** What a boot lands on: the box underfoot (its material; a stair riser), or the ground as it is painted. */
  function groundAt(x: number, y: number, z: number): { surface: StepSurface; stairs: boolean } {
    if (live.world) { const hit = raycast(live.world, x, y + .3, z, 0, -1, 0, .8, null, scratch); if (hit && hit.box) { const box = map.boxes[hit.box.i]; return { surface: stepSurfaceOf(box?.mat) as StepSurface, stairs: !!box && isStair(box) }; } }
    return { surface: groundSurface(map.bounds, x, z) as StepSurface, stairs: false };
  }
  /** The player's reload, action and weapon raise, advanced with the same progress the animation draws. */
  function ownActions(s: typeof live.sim) {
    if (!s) { actions.reloadFrame('', null); actions.cycleFrame('', null); actions.switchFrame(null); return; }
    const w = weaponOf(s);
    if (w.reloadMode === 'shell') actions.shellFrame(w.id, s.phase === 'reload' ? s.pt : null);
    else actions.reloadFrame(w.id, s.phase === 'reload' ? THREE.MathUtils.clamp(1 - s.pt / Math.max(1, live.reloadTotal), 0, 1) : null);
    actions.cycleFrame(w.id, w.rpm && s.phase === 'ready' && s.cool > 0 ? 1 - s.cool / (3600 / w.rpm) : s.phase === 'ready' ? 1 : null);
    actions.switchFrame(s.phase === 'switch' ? 1 - s.pt / Math.max(1, w.swap) : null);
  }
  /**
   * Everyone else: footsteps at their soldiers' stride (in earshot, whether drawn or not), landings, their reloads and
   * bolts (cancelled when the server's reload flag clears early), and their voices loaded as they appear.
   */
  function remoteSounds(dt: number, now: number) {
    for (const r of live.remotes.values()) {
      const alive = !r.deadAt && (r.flags & 1) !== 0 && !!r.seenAt && now - r.seenAt < 600;
      remoteActions.frame(r.num, (r.flags & 32) !== 0, alive);
      if (!alive) { remoteGaits.delete(r.num); continue; }
      prepareVoice(r.num, soldierModelFor(r.num));
      let g = remoteGaits.get(r.num); if (!g) remoteGaits.set(r.num, g = createRemoteGait());
      const ev = g.update(r.pos.x, r.pos.z, dt, r.flags), enemy = r.team !== live.team;
      if (!ev.step && !ev.land) continue;
      const d = Math.hypot(r.pos.x - camera.position.x, r.pos.z - camera.position.z); if (d > (enemy ? 34 : 24)) continue;
      const gi = groundAt(r.pos.x, r.pos.y, r.pos.z), at: [number, number, number] = [r.pos.x, r.pos.y + .05, r.pos.z];
      if (ev.step) sfx.step(gi.surface, ev.step, { at, enemy, stairs: gi.stairs });
      if (ev.land) sfx.land(gi.surface, 9, at);
    }
  }
  /** Grenades in flight: bounces on what they strike; a Tack Charge sticking, then arming. */
  function grenadeAudio(now: number) {
    for (const [id, gr] of live.grenades) {
      let st = grenadeSounds.get(id);
      if (!st) { grenadeSounds.set(id, { x: gr.x, y: gr.y, z: gr.z, vy: 0, at: gr.at, moving: 0, stuck: false, beepAt: 0 }); continue; }
      if (gr.at !== st.at) {
        const dt = Math.max(.016, (gr.at - st.at) / 1000), vy = (gr.y - st.y) / dt, sp = Math.hypot(gr.x - st.x, gr.z - st.z) / dt, kind = EQUIP_IDS[gr.kind];
        // A bounce: falling, then rising (or stopping) on the next update.
        if (st.vy < -1.5 && vy > -.2 && !st.stuck) sfx.bounce([gr.x, gr.y, gr.z], groundAt(gr.x, gr.y, gr.z).surface, Math.min(1, -st.vy / 9));
        if (kind === 'tack' && !st.stuck && st.moving > 0 && sp < .05 && Math.abs(vy) < .05) { st.stuck = true; sfx.stick([gr.x, gr.y, gr.z]); st.beepAt = now + 250; }
        st.moving = sp + Math.abs(vy); st.vy = vy; st.x = gr.x; st.y = gr.y; st.z = gr.z; st.at = gr.at;
      }
      if (st.stuck && now > st.beepAt) { st.beepAt = now + 420; sfx.armed([gr.x, gr.y, gr.z]); }
    }
    for (const id of grenadeSounds.keys()) if (!live.grenades.has(id)) grenadeSounds.delete(id);
  }

  /** First-person weapon: pose from the simulation's real state, so what you see is what the weapon is doing. */
  function updateViewmodel(dt: number, now: number) {
    const s = live.sim, scoped = !!s && weaponOf(s).category === 'sniper' && s.ads > .85;
    const show = !!s && live.alive && !scoped && !!lib;
    vm.holder.visible = show; vm.flash.visible = false; if (vm.arms) vm.arms.visible = show;
    if (!s || !lib) return;
    const w = weaponOf(s), skin = live.loadout?.skins?.[w.id] ?? 'standard';
    if (vm.gunId !== w.id || vm.skin !== skin) {
      // The model streams in on first use; until then nothing is drawn (the weapon is still raising).
      const next = weaponModel(w.id, skin);
      if (vm.gun) vm.holder.remove(vm.gun);
      vm.gun = next; if (next) { vm.holder.add(next); vm.gunId = w.id; vm.skin = skin; vm.cyl = 0; } else vm.gunId = '';
    }
    if (vm.armsSrc && (vm.armsTeam !== live.team || !vm.arms)) { if (vm.arms) { vm.vmScene.remove(vm.arms.root); vm.arms.dispose(); } vm.arms = new FirstPersonArms(vm.armsSrc, live.team); vm.vmScene.add(vm.arms.root); vm.armsTeam = live.team; }
    if (!vm.gun) { vm.holder.visible = false; if (vm.arms) vm.arms.visible = false; return; }
    const gun = vm.gun, sightY = (gun.userData.sightY as number) ?? .09, melee = w.fire === 'melee', sidearm = w.category === 'pistol';
    // Springs: recoil, landing, look sway.
    vm.kickZ *= Math.exp(-dt * 13); vm.kickPitch *= Math.exp(-dt * 11); vm.kickRoll *= Math.exp(-dt * 9); vm.slideKick *= Math.exp(-dt * 26);
    vm.landV += (-vm.land * 90 - vm.landV * 13) * dt; vm.land += vm.landV * dt;
    const dyaw = controls.yaw - vm.lastYaw, dpitch = controls.pitch - vm.lastPitch; vm.lastYaw = controls.yaw; vm.lastPitch = controls.pitch;
    vm.swayX += (THREE.MathUtils.clamp(dyaw * .9, -.05, .05) - vm.swayX) * Math.min(1, dt * 9); vm.swayY += (THREE.MathUtils.clamp(-dpitch * .9, -.04, .04) - vm.swayY) * Math.min(1, dt * 9);
    const speed = Math.hypot(s.vx, s.vz); vm.breath += dt; // (vm.bob: the gait's phase, set in the frame)
    const moving = s.grounded ? Math.min(1, speed / 5) : 0, ads = s.ads * s.ads * (3 - 2 * s.ads), hipK = 1 - ads;
    // Base pose: hip, blended to the sights when aiming.
    const hip = melee ? v1.set(.15, -.17, -.42) : sidearm ? v1.set(.085, -sightY - .07, -.5) : v1.set(.1, -sightY - .068, -.4);
    const aim = v2.set(0, -sightY, (gun.userData.adsZ as number) ?? -.28);
    let x = hip.x + (aim.x - hip.x) * ads, y = hip.y + (aim.y - hip.y) * ads, z = hip.z + (aim.z - hip.z) * ads;
    let rx = melee ? .22 : 0, ry = (melee ? .14 : .035) * hipK, rz = melee ? -.25 : 0;
    // Idle breathing, look sway, walk bob.
    x += vm.swayX + Math.cos(vm.bob) * .0065 * moving * (hipK * .9 + .1) + Math.sin(vm.breath * .9) * .0012 * hipK;
    y += vm.swayY - Math.abs(Math.sin(vm.bob)) * .008 * moving * (hipK * .9 + .1) + Math.sin(vm.breath * 1.3) * .0016 * (hipK * .8 + .2) - vm.land * .05;
    rz += -vm.swayX * 1.4 + Math.sin(vm.bob) * .012 * moving * hipK; rx += vm.swayY * .8;
    // Sprint: high-ready, canted across the body, with a heavier bob.
    const sp = (vm as unknown as { sprintK?: number }); sp.sprintK = (sp.sprintK ?? 0) + ((s.sprint ? 1 : 0) - (sp.sprintK ?? 0)) * Math.min(1, dt * 9); const sk = sp.sprintK;
    if (!melee) { x -= .025 * sk; y += (-.055 + Math.sin(vm.bob * 2) * .012) * sk; z += .03 * sk; rx += -.5 * sk; ry += .58 * sk; rz += .22 * sk; } else { y += Math.sin(vm.bob * 2) * .015 * sk; rx -= .2 * sk; }
    // Airborne and sliding.
    if (!s.grounded) { y += THREE.MathUtils.clamp(-s.vy * .004, -.03, .03); rx += THREE.MathUtils.clamp(s.vy * .008, -.06, .06); }
    if (s.stance === 2) { rz += .26; y -= .02; x += .02; }
    // Recoil.
    z += vm.kickZ; rx += vm.kickPitch; rz += vm.kickRoll; y += vm.kickPitch * .08;
    // Phase animations, driven by the simulation's own timers.
    let leftToMag = 0, rightToBolt = 0, leftOff = 0;
    const mag = gun.getObjectByName('mag'), bolt = gun.getObjectByName('bolt'), pump = gun.getObjectByName('pump'), slide = gun.getObjectByName('slide'), cyl = gun.getObjectByName('cylinder');
    const rest = (o: THREE.Object3D | undefined) => { if (o && o.userData.rest) o.position.copy(o.userData.rest as THREE.Vector3); };
    rest(mag); rest(bolt); rest(pump); rest(slide); rest(cyl);
    if (s.phase === 'reload') {
      // The reload plan (src/arena/sound/reloads.mjs) times both this animation and the sound of each part.
      const k = THREE.MathUtils.clamp(1 - s.pt / Math.max(1, live.reloadTotal), 0, 1), plan = reloadPlan(w.id, live.reloadEmpty), ss = THREE.MathUtils.smoothstep;
      if (w.reloadMode === 'shell' || !plan) {
        // Shell by shell: the support hand goes to the loading port and pushes each shell in (its cue at 0.55).
        const u = s.pt <= (w.reload ?? 1) ? 1 - s.pt / Math.max(1, w.reload ?? 1) : 0; rx += .3; rz -= .35; y -= .03; leftOff = Math.sin(u * Math.PI) * .12;
      } else {
        const tilt = ss(k, plan.tilt[0], plan.tilt[1]) * (1 - ss(k, plan.tilt[2], plan.tilt[3]));
        rx += .22 * tilt; rz -= .42 * tilt; ry += .12 * tilt; y -= .035 * tilt; x -= .02 * tilt;
        if (plan.out && plan.in) {
          const out = ss(k, plan.out[0], plan.out[1]), back = ss(k, plan.in[0], plan.in[1]), drop = out * (1 - back);
          if (mag) { mag.position.y -= drop * .34; mag.position.z += drop * .05; mag.visible = !(out > .98 && back < .02); }
        }
        leftToMag = ss(k, plan.hand[0], plan.hand[1]) * (1 - ss(k, plan.hand[2], plan.hand[3]));
        // Seat the magazine with a tap; from empty, work the action (a tactical reload keeps its chambered round).
        if (plan.seat != null) y += Math.sin(THREE.MathUtils.clamp((k - plan.seat) / .06, 0, 1) * Math.PI) * .012;
        if (plan.rack) { const rack = Math.sin(THREE.MathUtils.clamp((k - plan.rack[0]) / (plan.rack[1] - plan.rack[0]), 0, 1) * Math.PI); if (bolt) bolt.position.z += rack * .05; if (slide) slide.position.z += rack * .035; z += rack * .012; }
        // A revolver's cylinder swings out for the ejector and the speed-loader, then closes.
        if (plan.cyl && cyl) { const open = ss(k, plan.cyl[0], plan.cyl[0] + .08) * (1 - ss(k, plan.cyl[1] - .05, plan.cyl[1])); cyl.position.x -= open * .028; rz -= open * .22; }
      }
    } else if (mag) mag.visible = true;
    if (s.phase === 'switch') { const k = s.pt / Math.max(1, w.swap), e = k * k; y -= e * .42; rx -= e * 1.0; rz += e * .3; }
    if (s.phase === 'melee') { const total = melee ? w.swing ?? 30 : 30, k = 1 - s.pt / total, sw = Math.sin(Math.min(1, k * 1.25) * Math.PI); if (melee) { x -= sw * .16; z -= sw * .18; ry += sw * .9; rz += sw * .5; } else { z -= sw * .2; ry += sw * .75; rx += sw * .25; x -= sw * .08; } }
    if (s.phase === 'throw') { const k = 1 - s.pt / 22, sw = Math.sin(k * Math.PI); y -= sw * .32; rx -= sw * .7; }
    // Actions that cycle between shots: pump, bolt, slide, cylinder.
    if (w.rpm && s.cool > 0 && s.phase === 'ready') {
      const u = 1 - s.cool / (3600 / w.rpm);
      if (pump) { const c = Math.sin(THREE.MathUtils.clamp((u - .12) / .5, 0, 1) * Math.PI); pump.position.z += c * .085; leftOff = c * .085; }
      if (bolt && w.fire === 'bolt') { const c = Math.sin(THREE.MathUtils.clamp((u - .15) / .55, 0, 1) * Math.PI); bolt.position.z += c * .075; bolt.position.y += Math.min(1, c * 2) * .012; rightToBolt = Math.min(1, c * 1.6); rz -= c * .1; }
    }
    if (slide) slide.position.z += vm.slideKick * .028;
    if (bolt && w.fire !== 'bolt') bolt.position.z += vm.slideKick * .0;
    if (cyl) { vm.cyl += (s.shots * Math.PI / 3 - vm.cyl) * Math.min(1, dt * 18); cyl.rotation.z = vm.cyl; }
    vm.holder.position.set(x, y, z); vm.holder.rotation.set(rx, ry, rz); vm.holder.updateMatrixWorld(true);
    const reticle = gun.getObjectByName('reticle'); if (reticle) reticle.visible = ads > .55 && s.phase !== 'reload';
    // Muzzle flash: two frames of a star flash at the barrel.
    const muzzle = gun.getObjectByName('muzzle');
    if (muzzle && !melee && now - vm.flashAt < 42 && show) { vm.flash.visible = true; muzzle.getWorldPosition(vm.flash.position); vm.flash.quaternion.copy(vm.holder.quaternion); vm.flash.rotateZ(Math.random() * 6.28); const sc = (.5 + Math.random() * .5) * (w.category === 'shotgun' || w.category === 'sniper' ? 1.5 : w.category === 'pistol' ? .7 : 1) * (1 - ads * .45); vm.flash.scale.setScalar(sc); }
    // Arms: two-bone IK from the shoulders to the weapon's grips (or to the magazine, the bolt).
    if (vm.arms && show) {
      const gR = gun.getObjectByName('gripR'), gL = gun.getObjectByName('gripL');
      if (gR && gL) {
        gR.getWorldPosition(v1); if (rightToBolt && bolt) v1.lerp(bolt.getWorldPosition(v3), rightToBolt * .85); vm.handR.copy(v1);
        gL.getWorldPosition(v1); v1.z += leftOff;
        const well = mag ?? gun.getObjectByName('magwell'); if (leftToMag && well) { well.getWorldPosition(v3); if (mag) v3.y -= .07; v1.lerp(v3, leftToMag); }
        if (s.phase === 'throw' || (s.phase === 'melee' && !melee)) v1.lerp(v3.set(-.25, -.5, .1), .9);
        vm.handL.lerp(v1, Math.min(1, dt * 30));
        vm.arms.pose(gun.userData.hold ?? 'rifle', vm.handR, vm.handL, vm.holder.quaternion, leftToMag);
      }
    }
    // Light on the weapon follows the world: the sun in camera space, dimmed in shade.
    if (lib) {
      v1.copy(lib.sun.dir).transformDirection(camera.matrixWorldInverse);
      vm.sun.position.copy(v1).multiplyScalar(3); vm.sun.target.position.set(0, 0, 0);
      const want = lib.sun.irradiance * .8 * (vm.sunSeen ? 1 : .08) + (now - vm.flashAt < 60 ? 2.5 : 0);
      vm.sun.intensity += (want - vm.sun.intensity) * Math.min(1, dt * 8);
      vm.vmScene.environmentIntensity = .95 - vm.indoor * .35;
      vm.vmScene.environmentRotation.setFromQuaternion(q1.copy(camera.quaternion).invert());
    }
    vm.vmCam.aspect = size.width / size.height; const vfov = 56 - ads * 14; if (vm.vmCam.fov !== vfov) { vm.vmCam.fov = vfov; } vm.vmCam.updateProjectionMatrix();
  }

  const passes = useMemo(() => ({ world: 0 }), []);
  // The world, then the weapon over a cleared depth buffer (through the post stack when it is on).
  // QA builds only: `?qa-norender` keeps the frame loop (simulation, animation, sound) but draws nothing, so timing
  // checks run at a realistic frame rate on machines that render in software.
  const noRender = QA_HOOKS && new URLSearchParams(location.search).has('qa-norender');
  useFrame(({ gl: r }, dt) => {
    if (noRender) return;
    r.info.reset();
    if (composer) { composer.weapon.enabled = vm.holder.visible; composer.c.render(dt); }
    else { r.autoClear = true; r.render(scene, camera); passes.world = r.info.render.triangles; if (vm.holder.visible) { r.autoClear = false; r.clearDepth(); r.render(vm.vmScene, vm.vmCam); r.autoClear = true; } }
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaBreakdown = () => { const out: Record<string, number> = {}; scene.traverse(o => { const m = o as THREE.InstancedMesh; if (!m.isMesh || !m.visible) return; const n = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); const k = m.name || (m.material as THREE.Material).name || m.type; out[k] = (out[k] ?? 0) + Math.round(n); }); return out; };
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaStats = { world: passes.world, calls: r.info.render.calls, triangles: r.info.render.triangles, textures: r.info.memory.textures, geometries: r.info.memory.geometries };
  }, 1);
  void eyeOf;
  return null;
}
