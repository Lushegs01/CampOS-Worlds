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
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, BloomEffect, VignetteEffect, BrightnessContrastEffect, HueSaturationEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { WEAPONS, EQUIPMENT_BY_ID } from '../../shared/arena/weapons.mjs';
import { weaponOf, eyeOf } from '../../shared/arena/sim.mjs';
import { raycast } from '../../shared/arena/physics.mjs';
import { setListener } from '../audio/mixer';
import { useArena } from './store';
import { live, onFx, tickInput, eye, useStreak, matOf, send, type Fx } from './net';
import { controls, pollGamepad, attachDesktop } from './input';
import { ARENA_QUALITY, softTexture, labelTexture, TEAM_COLORS, type ArenaQuality } from './scene/world';
import { loadLibrary, skyDome, clearMaterialCache, type Library } from './scene/library';
import { buildEnvironment, surfaceOf } from './scene/environment';
import { weaponModel, FirstPersonArms, preloadArms } from './scene/weapons';
import { loadSoldiers, Soldier, soldierModelFor } from './scene/soldiers';
import { Effects, Casings } from './scene/fx';
import { sfx, setIndoor, startAmbience, stopArenaAmbience, type Ground } from './audio';
import { QA_HOOKS } from '../qa';

const EQUIP_IDS = [...EQUIPMENT_BY_ID.keys()];
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), e1 = new THREE.Euler();
const scratch = { t: 0, box: null as { i: number } | null, normal: [0, 0, 0], ground: false };

export default memo(function ArenaScene({ mapId }: { mapId: string }) {
  const quality = useArena(s => s.settings.quality), q = ARENA_QUALITY[quality];
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
  const { scene, camera, gl, size } = useThree();
  const map = MAP_BY_ID.get(mapId)!;
  const settings = useArena(s => s.settings);
  const worldAt = useRef(0), loadedFor = useRef('');
  const [lib, setLib] = useState<Library | null>(null), [kits, setKits] = useState<Awaited<ReturnType<typeof loadSoldiers>> | null>(null);
  useEffect(() => {
    let live2 = true;
    useArena.getState().set({ sceneReady: false });
    loadLibrary(gl, q).then(l => { if (live2) setLib(l); })
      .catch(e => { console.error('Arena assets could not load.', e); useArena.getState().set({ error: 'The arena’s graphics could not be downloaded. Check your connection and try again.' }); });
    startAmbience();
    return () => { live2 = false; stopArenaAmbience(); setIndoor(0); };
  }, [gl, q]);
  // Characters load after the world so the map appears first; the kits are cached for the page's lifetime.
  useEffect(() => {
    if (!lib) return;
    let on = true;
    loadSoldiers().then(k => { if (on) setKits(k); }).catch(e => console.error('Arena characters could not load.', e));
    return () => { on = false; };
  }, [lib]);

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
    return { group, sun };
  }, [lib, map, q]);
  useEffect(() => {
    if (!world || !lib) return;
    scene.add(world.group); scene.environment = lib.env; scene.environmentIntensity = 1.5;
    const fog = lib.horizon.clone().multiplyScalar(1.05); scene.fog = new THREE.Fog(fog, 55, q.fogFar * 3.2); scene.background = fog;
    worldAt.current = performance.now();
    return () => {
      scene.remove(world.group); scene.environment = null; scene.fog = null;
      world.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.name.startsWith('prop:')) m.geometry.dispose(); });
      clearMaterialCache();
    };
  }, [scene, world, lib, q]);

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
  const soldiers = useRef(new Map<number, { s: Soldier; tag: THREE.Sprite | null; tagKey: string; flashAt: number; model: string }>());
  useEffect(() => () => { for (const e of soldiers.current.values()) { scene.remove(e.s.root); e.s.dispose(); } soldiers.current.clear(); }, [scene, kits]);

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
  useEffect(() => { let on = true; preloadArms().then(src => { if (on) { vm.armsSrc = src; vm.armsTeam = -1; } }).catch(e => console.error('Arena arms could not load.', e)); return () => { on = false; }; }, [vm]);

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
  useEffect(() => { composer?.c.setSize(size.width, size.height); }, [composer, size]);

  // ---------------------------------------------------------------- input
  useEffect(() => attachDesktop(gl.domElement, {
    streak: id => useStreak(id),
    scoreboard: open => useArena.getState().set({ scoreboard: open }),
    menu: () => { const a = useArena.getState(); a.set({ menu: !a.menu }); },
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
      if (f.flesh) sfx.flesh([at.x, at.y, at.z]); else if (Math.random() < .7) sfx.impact(kind as Ground, [at.x, at.y, at.z]);
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
      if (port && w.fire !== 'bolt' && w.id !== 'bastion' && w.id !== 'thorn') { vm.casings.eject(port.getWorldPosition(v1)); sfx.casing(); }
      const muzzle = vm.gun?.getObjectByName('muzzle');
      if (muzzle) { muzzle.getWorldPosition(v1).applyMatrix4(camera.matrixWorld); camera.getWorldDirection(v2); fx.effects.muzzle(v1, v2); fx.muzzleLight.position.copy(v1); fx.muzzleLight.intensity = 28; }
      if (w.fire === 'bolt' || w.id === 'bastion') sfx.bolt();
    }
  }), [fx, vm, camera, q, objectives]);

  // ---------------------------------------------------------------- the frame
  const fwd = useMemo(() => new THREE.Vector3(), []), eyePos = useMemo(() => ({ x: 0, y: 0, z: 0 }), []), sample = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0 }), []);
  const deathCam = useRef<{ x: number; y: number; z: number; at: number } | null>(null), stepDist = useRef(0), fpsRef = useRef({ frames: 0, t: 0 }), frameNo = useRef(0), dustAt = useRef(0);
  useEffect(() => { if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaDebug = () => ({ kits: !!kits, lib: !!lib, soldiers: soldiers.current.size, vm: { gun: vm.gunId, holder: vm.holder.visible, arms: !!vm.arms, armsSrc: !!vm.armsSrc, pos: vm.holder.position.toArray().map(n => +n.toFixed(3)) }, bodies: [...soldiers.current.values()].map(e => { const b = new THREE.Box3().setFromObject(e.s.root); return { vis: e.s.root.visible, at: e.s.root.position.toArray().map(n => +n.toFixed(2)), min: b.min.toArray().map(n => +n.toFixed(2)), max: b.max.toArray().map(n => +n.toFixed(2)) }; }), remotes: [...live.remotes.values()].map(r => ({ num: r.num, team: r.team, flags: r.flags, seen: Math.round(performance.now() - r.seenAt), dead: r.deadAt })) }); }, [kits, lib]);
  useEffect(() => { gl.info.autoReset = false; if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaGL = gl; return () => { gl.info.autoReset = true; }; }, [gl]);
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
      cam.position.set(eyePos.x + (Math.random() - .5) * shake, eyePos.y + Math.sin(vm.bob * 2) * .012 * bobK + vm.land * .08 + (Math.random() - .5) * shake, eyePos.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = controls.yaw + s.ry;
      cam.rotation.x = controls.pitch + s.rp + live.kick * .006 + vm.land * .03;
      cam.rotation.z = (s.stance === 2 ? -.07 : 0) + Math.sin(vm.bob) * .004 * bobK + (s.sprint ? Math.sin(vm.bob) * .006 : 0);
      const zoom = 1 + (zoomOf() - 1) * s.ads * s.ads, fov = settings.fov / zoom * (s.sprint ? 1.05 : 1);
      if (Math.abs(cam.fov - fov) > .01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 14); cam.updateProjectionMatrix(); }
      // Footsteps on whatever is underfoot.
      if (s.grounded && s.stance !== 2) {
        stepDist.current += speed * dt;
        if (stepDist.current > (s.sprint ? 2.1 : 1.7)) { stepDist.current = 0; sfx.step(undefined, s.stance === 1 ? .1 : s.sprint ? .26 : .2, groundAt(s.x, s.y, s.z)); }
      }
    } else if (s) {
      const d = deathCam.current ??= { x: s.x, y: s.y + 1.4, z: s.z, at: now };
      const k = Math.min(1, (now - d.at) / 700), killer = a.killedBy?.num != null ? live.remotes.get(a.killedBy.num) : null;
      cam.position.set(d.x, d.y - k * 1.05, d.z); cam.rotation.order = 'YXZ';
      if (killer && killer.seenAt) { const want = Math.atan2(-(killer.pos.x - d.x), -(killer.pos.z - d.z)); cam.rotation.y += Math.atan2(Math.sin(want - cam.rotation.y), Math.cos(want - cam.rotation.y)) * Math.min(1, dt * 3); }
      cam.rotation.z = k * .4; cam.rotation.x = -k * .1;
      if (Math.abs(cam.fov - settings.fov) > .01) { cam.fov = settings.fov; cam.updateProjectionMatrix(); }
    }
    cam.updateMatrixWorld();
    cam.getWorldDirection(fwd); setListener(cam.position, fwd);
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
    // Where everyone is comes from the network, whether or not their soldier model has downloaded yet.
    if (t != null) for (const r of live.remotes.values()) if (!r.deadAt) { r.track.sample(t, sample); r.pos.x = sample.x; r.pos.y = sample.y; r.pos.z = sample.z; r.pos.yaw = sample.yaw; }
    if (kits && lib) for (const r of live.remotes.values()) {
      const dead = !!r.deadAt, visible = ((r.flags & 1) && r.seenAt && now - r.seenAt < 3000) || (dead && now - r.deadAt < 2600);
      let e = soldiers.current.get(r.num);
      const model = soldierModelFor(r.num);
      if (e && (e.s.team !== r.team || e.model !== model)) { scene.remove(e.s.root); e.s.dispose(); soldiers.current.delete(r.num); e = undefined; }
      if (!e) { if (!visible || r.team < 0) continue; e = { s: new Soldier(kits[model], r.team, lib, softTexture()), tag: null, tagKey: '', flashAt: 0, model }; soldiers.current.set(r.num, e); scene.add(e.s.root); }
      seenNums.add(r.num);
      e.s.root.visible = !!visible; if (!visible) continue;
      if (t != null && !dead) r.track.sample(t, sample); // (for the footstep cadence below)
      const w = WEAPONS[r.weapon]; if (w) e.s.setWeapon(w.id);
      const far = Math.hypot(r.pos.x - cam.position.x, r.pos.z - cam.position.z);
      e.s.update(dt, v1.set(r.pos.x, r.pos.y, r.pos.z), r.pos.yaw, r.pitch, r.flags, dead, now - e.flashAt < 55, q.ik && far < 45);
      // Footsteps of others within earshot.
      if (!dead && (r.flags & 256) && !(r.flags & 2) && far < 24) { const sp = (r.flags & 8) ? 300 : 430; if (now - r.stepAt > sp && Math.hypot(sample.x - (e.s.root.userData.lx ?? sample.x), sample.z - (e.s.root.userData.lz ?? sample.z)) / Math.max(dt, 1e-3) > 1.4) { r.stepAt = now; sfx.step([r.pos.x, r.pos.y, r.pos.z], .3, groundAt(r.pos.x, r.pos.y, r.pos.z)); } }
      e.s.root.userData.lx = sample.x; e.s.root.userData.lz = sample.z;
      // Identification: teammates carry a blue name; enemies a small red marker (hidden behind cover).
      const info = a.match?.players.find(p => p.num === r.num), friend = r.team === live.team;
      const key = dead ? '' : friend ? (info ? info.name + (info.bot ? ' · SIM' : '') : '') : '◆';
      if (e.tagKey !== key) {
        e.tagKey = key;
        if (e.tag) { e.s.root.remove(e.tag); (e.tag.material as THREE.SpriteMaterial).map?.dispose(); e.tag.material.dispose(); e.tag = null; }
        if (key) { const { texture, aspect } = labelTexture(key, friend ? TEAM_COLORS.friend : TEAM_COLORS.enemy, 44, false); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: !friend, transparent: true, toneMapped: false, opacity: friend ? 1 : .9 })); const h = friend ? .3 : .16; sp.scale.set(h * aspect, h, 1); sp.position.y = 2.12; sp.renderOrder = 9; e.s.root.add(sp); e.tag = sp; }
      }
    }
    for (const [num, e] of soldiers.current) if (!seenNums.has(num)) { if (!live.remotes.has(num)) { scene.remove(e.s.root); e.s.dispose(); soldiers.current.delete(num); } else e.s.root.visible = false; }
    // ---- effects
    fx.effects.update(dt); vm.casings.update(dt);
    if (fx.muzzleLight.intensity > 0) fx.muzzleLight.intensity = Math.max(0, fx.muzzleLight.intensity - dt * 600);
    if (q.detail && s && now - dustAt.current > 260) { dustAt.current = now; fx.effects.mote(v1.set(cam.position.x + (Math.random() - .5) * 14, .2 + Math.random() * 2.2, cam.position.z + (Math.random() - .5) * 14)); }
    let gi = 0; for (const gr of live.grenades.values()) { const m = fx.grenades[gi++]; if (!m) break; m.visible = true; m.position.set(gr.x, gr.y, gr.z); (m.material as THREE.MeshStandardMaterial).color.set(EQUIP_IDS[gr.kind] === 'flash' ? '#b9bcc0' : EQUIP_IDS[gr.kind] === 'smoke' ? '#5f6c78' : '#3f4a34'); }
    for (; gi < fx.grenades.length; gi++) fx.grenades[gi].visible = false;
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
    // The match is shown once the player's weapon, arms and the soldiers can be drawn (or after 15 s regardless).
    if (!a.sceneReady && worldAt.current && ((kits && vm.gun && vm.arms) || now - worldAt.current > 15000)) a.set({ sceneReady: true });
    // Tell the server once per match that this player can see and play (Training waits for it).
    if (a.sceneReady && a.match && loadedFor.current !== a.match.id && send({ t: 'loaded' })) loadedFor.current = a.match.id;
    const f = fpsRef.current; f.frames++; if (now - f.t > 1000) { const fps = Math.round(f.frames * 1000 / (now - f.t)); f.frames = 0; f.t = now; if (a.hud.fps !== fps) a.set({ hud: { ...useArena.getState().hud, fps } }); }
  }, -1);

  /** What a boot lands on: the box underfoot, or the yard's concrete, gravel margins and dirt. */
  function groundAt(x: number, y: number, z: number): Ground {
    if (live.world) { const hit = raycast(live.world, x, y + .3, z, 0, -1, 0, .8, null, scratch); if (hit && hit.box) return surfaceOf(matOf(hit.box)) as Ground; }
    const [bx0, bz0, bx1, bz1] = map.bounds;
    return x < bx0 + 6 || x > bx1 - 6 || z < bz0 + 1.5 || z > bz1 - 1.5 ? 'dirt' : 'concrete';
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
    const speed = Math.hypot(s.vx, s.vz); vm.bob += speed * dt * (s.sprint ? 1.45 : 1.75); vm.breath += dt;
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
    rest(mag); rest(bolt); rest(pump); rest(slide);
    if (s.phase === 'reload') {
      const k = THREE.MathUtils.clamp(1 - s.pt / Math.max(1, live.reloadTotal), 0, 1);
      if (w.reloadMode === 'shell') { const c = (k * 3) % 1; rx += .3; rz -= .35; y -= .03; leftOff = Math.sin(c * Math.PI) * .12; leftToMag = .0; }
      else {
        const tilt = THREE.MathUtils.smoothstep(k, 0, .14) * (1 - THREE.MathUtils.smoothstep(k, .86, 1));
        rx += .22 * tilt; rz -= .42 * tilt; ry += .12 * tilt; y -= .035 * tilt; x -= .02 * tilt;
        const out = THREE.MathUtils.smoothstep(k, .14, .34), back = THREE.MathUtils.smoothstep(k, .46, .68), drop = out * (1 - back);
        if (mag) { mag.position.y -= drop * .34; mag.position.z += drop * .05; mag.visible = !(out > .98 && back < .02); }
        leftToMag = THREE.MathUtils.smoothstep(k, .08, .2) * (1 - THREE.MathUtils.smoothstep(k, .7, .8));
        // Seat the magazine with a tap, then run the action.
        y += Math.sin(THREE.MathUtils.clamp((k - .66) / .06, 0, 1) * Math.PI) * .012;
        const rack = Math.sin(THREE.MathUtils.clamp((k - .8) / .14, 0, 1) * Math.PI);
        if (bolt) bolt.position.z += rack * .05; if (slide) slide.position.z += rack * .035; rightToBolt = w.category === 'sniper' ? 0 : 0; z += rack * .012;
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
  useFrame(({ gl: r }, dt) => {
    r.info.reset();
    if (composer) { composer.weapon.enabled = vm.holder.visible; composer.c.render(dt); }
    else { r.autoClear = true; r.render(scene, camera); passes.world = r.info.render.triangles; if (vm.holder.visible) { r.autoClear = false; r.clearDepth(); r.render(vm.vmScene, vm.vmCam); r.autoClear = true; } }
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaBreakdown = () => { const out: Record<string, number> = {}; scene.traverse(o => { const m = o as THREE.InstancedMesh; if (!m.isMesh || !m.visible) return; const n = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); const k = m.name || (m.material as THREE.Material).name || m.type; out[k] = (out[k] ?? 0) + Math.round(n); }); return out; };
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__arenaStats = { world: passes.world, calls: r.info.render.calls, triangles: r.info.render.triangles, textures: r.info.memory.textures, geometries: r.info.memory.geometries };
  }, 1);
  void eyeOf;
  return null;
}
