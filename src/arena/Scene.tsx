// Combat Arena 3D view. Rendering is imperative inside one frame loop for speed: the map is a dozen
// merged meshes, players come from a fixed pool of mannequins, and every effect (tracers, impacts,
// flashes, explosions, smoke) comes from a small preallocated pool, so a firefight allocates nothing.
// The first-person weapon is drawn in a second pass over a cleared depth buffer, so it never clips
// into walls.
import { memo, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MAP_BY_ID } from '../../shared/arena/maps.mjs';
import { WEAPONS, WEAPON_BY_ID, EQUIPMENT_BY_ID } from '../../shared/arena/weapons.mjs';
import { weaponOf } from '../../shared/arena/sim.mjs';
import { setListener } from '../audio/mixer';
import { useArena } from './store';
import { live, onFx, tickInput, eye, type Fx } from './net';
import { controls, pollGamepad, attachDesktop } from './input';
import { useStreak } from './net';
import { ARENA_QUALITY, buildMap, groundMaterial, softTexture, labelTexture, TEAM_COLORS, type ArenaQuality } from './scene/world';
import { weaponModel, armsModel, mannequin } from './scene/models';
import { sfx } from './audio';

const EQUIP_IDS = [...EQUIPMENT_BY_ID.keys()];
// First-person models are built life-size and drawn at this scale, so they frame the lower right of the view.
const VM_SCALE = .5;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

export default memo(function ArenaScene({ mapId }: { mapId: string }) {
  const quality = useArena(s => s.settings.quality), q = ARENA_QUALITY[quality];
  const dpr = Math.min(q.dpr, window.devicePixelRatio || 1);
  return <Canvas key={quality} className="ar-canvas" dpr={[Math.min(1, dpr), dpr]} shadows={q.shadows ? { type: THREE.PCFSoftShadowMap } : false}
    gl={{ antialias: q.antialias, powerPreference: 'high-performance', stencil: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
    camera={{ fov: 78, near: .05, far: 400, position: [0, 2, 0] }}
    onCreated={({ scene }) => { scene.matrixAutoUpdate = true; }}>
    <World mapId={mapId} q={q} />
  </Canvas>;
});

function World({ mapId, q }: { mapId: string; q: ArenaQuality }) {
  const { scene, camera, gl, size } = useThree();
  const map = MAP_BY_ID.get(mapId)!;
  const settings = useArena(s => s.settings);
  // ---------------------------------------------------------------- static world
  const statics = useMemo(() => {
    const group = new THREE.Group();
    for (const m of buildMap(map.boxes, q)) group.add(m);
    const [x0, z0, x1, z1] = map.bounds, w = x1 - x0 + 40, d = z1 - z0 + 40;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), groundMaterial(map.palette.ground, q, Math.max(w, d)));
    ground.rotation.x = -Math.PI / 2; ground.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); ground.receiveShadow = q.shadows; group.add(ground);
    // Sky: a gradient dome.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(map.palette.sky) }, bottom: { value: new THREE.Color(map.palette.horizon) } },
      vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 p; void main(){ float h = clamp(normalize(p).y*1.6+.1,0.,1.); gl_FragColor = vec4(mix(bottom, top, h),1.); }',
    }));
    group.add(sky);
    const hemi = new THREE.HemisphereLight(map.palette.ambient, '#6b665a', q.textures ? 2.1 : 2.6);
    const sun = new THREE.DirectionalLight(map.palette.sun, q.textures ? 2.8 : 2.2);
    const [sx, sy, sz] = map.palette.sunDir; sun.position.set(sx * 60, sy * 60, sz * 60);
    if (q.shadows) {
      sun.castShadow = true; sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const c = sun.shadow.camera; c.left = -50; c.right = 50; c.top = 50; c.bottom = -50; c.near = 1; c.far = 160; sun.shadow.bias = -.0005; sun.shadow.normalBias = .03;
    }
    group.add(hemi, sun, sun.target);
    return { group, sky };
  }, [map, q]);
  useEffect(() => {
    scene.add(statics.group);
    scene.fog = new THREE.Fog(map.palette.fog, 30, q.fogFar);
    scene.background = new THREE.Color(map.palette.horizon);
    return () => {
      scene.remove(statics.group);
      statics.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose()); } });
    };
  }, [scene, statics, map, q]);

  // ---------------------------------------------------------------- objectives (Domination)
  const objectives = useMemo(() => {
    const g = new THREE.Group();
    const items = map.objectives.map((o: { id: string; x: number; y: number; z: number; r: number }) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(o.r - .18, o.r, 48), new THREE.MeshBasicMaterial({ color: TEAM_COLORS.neutral, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(o.x, o.y + .04, o.z);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(o.r - .18, 48), new THREE.MeshBasicMaterial({ color: TEAM_COLORS.neutral, transparent: true, opacity: .12, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.set(o.x, o.y + .03, o.z);
      const { texture, aspect } = labelTexture(o.id, '#ffffff', 96);
      const letter = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, color: TEAM_COLORS.neutral }));
      letter.scale.set(.9 * aspect, .9, 1); letter.position.set(o.x, o.y + 3.2, o.z); letter.renderOrder = 10;
      g.add(ring, fill, letter);
      return { ring, fill, letter };
    });
    return { g, items };
  }, [map]);
  useEffect(() => { const show = useArena.getState().match?.mode === 'dom'; objectives.g.visible = show; scene.add(objectives.g); return () => { scene.remove(objectives.g); }; }, [scene, objectives]);

  // ---------------------------------------------------------------- players (a fixed pool)
  const pool = useMemo(() => Array.from({ length: 12 }, () => { const m = mannequin(); m.visible = false; return { m, num: 0, rel: '', tag: null as THREE.Sprite | null, tagKey: '', walk: 0, fall: 0, flashAt: 0 }; }), []);
  useEffect(() => { for (const p of pool) { p.m.traverse(o => { o.castShadow = q.shadows; }); scene.add(p.m); } return () => { for (const p of pool) scene.remove(p.m); }; }, [scene, pool, q]);

  // ---------------------------------------------------------------- effects pools
  const fx = useMemo(() => {
    const g = new THREE.Group();
    const n = Math.round(24 * q.effects) + 8;
    const tracerGeo = new THREE.BoxGeometry(.02, .02, 1); tracerGeo.translate(0, 0, -.5);
    const tracers = Array.from({ length: n }, () => { const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); m.visible = false; g.add(m); return { m, at: 0 }; });
    const sparks = Array.from({ length: n + 8 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: '#ffd9a0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.visible = false; g.add(s); return { s, at: 0, flesh: false }; });
    const booms = Array.from({ length: 4 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: '#ffb35a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: '#3b3836', depthWrite: false, transparent: true })); s.visible = smoke.visible = false; g.add(s, smoke); return { s, smoke, at: 0, r: 5 }; });
    const smokes = Array.from({ length: 4 }, () => { const puffs = Array.from({ length: 7 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: '#c9c7c2', depthWrite: false, transparent: true, opacity: 0 })); s.visible = false; g.add(s); return s; }); return { puffs, at: 0, until: 0, x: 0, y: 0, z: 0, r: 5 }; });
    const grenades = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), new THREE.MeshStandardMaterial({ color: '#4a5a3a', roughness: .6 })); m.visible = false; g.add(m); return m; });
    const crates = Array.from({ length: 4 }, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(.9, .6, .9), new THREE.MeshStandardMaterial({ color: '#5f6a4c', emissive: '#4fb3ff', emissiveIntensity: .25, roughness: .6 })); m.visible = false; g.add(m); return m; });
    const strikes = Array.from({ length: 3 }, () => { const ring = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 48), new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; const beam = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, 40, 8), new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false })); ring.visible = beam.visible = false; g.add(ring, beam); return { ring, beam }; });
    return { g, tracers, sparks, booms, smokes, grenades, crates, strikes, ti: 0, si: 0, bi: 0, mi: 0 };
  }, [q]);
  useEffect(() => { scene.add(fx.g); return () => { scene.remove(fx.g); }; }, [scene, fx]);

  // ---------------------------------------------------------------- first-person weapon (second pass)
  const vm = useMemo(() => {
    const vmScene = new THREE.Scene(), vmCam = new THREE.PerspectiveCamera(58, 1, .01, 10);
    vmScene.add(new THREE.HemisphereLight('#f2ecdf', '#5a5a62', 3));
    const key = new THREE.DirectionalLight('#ffe6c0', 2.4); key.position.set(.5, 1, .3); vmScene.add(key);
    const holder = new THREE.Group(); holder.scale.setScalar(VM_SCALE); vmScene.add(holder);
    return { vmScene, vmCam, holder, gun: null as THREE.Group | null, gunId: '', skin: '', arms: null as THREE.Group | null, armsTeam: -1, bob: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, slideT: 0 };
  }, []);

  // ---------------------------------------------------------------- input attach
  useEffect(() => {
    const detach = attachDesktop(gl.domElement, {
      streak: id => useStreak(id),
      scoreboard: open => useArena.getState().set({ scoreboard: open }),
      menu: () => { const a = useArena.getState(); a.set({ menu: !a.menu }); },
    }, () => ({ ads: live.sim?.ads ?? 0, zoom: zoomOf() }));
    return detach;
  }, [gl]);
  // Effects arrive from the network layer.
  useEffect(() => onFx((f: Fx) => spawnFx(f)), [fx]);
  function spawnFx(f: Fx) {
    const now = performance.now();
    if (f.type === 'tracer') {
      if (!f.local && Math.random() > q.effects + .3) return;
      const t = fx.tracers[fx.ti++ % fx.tracers.length];
      const from = tmp.fromArray(f.from), to = tmp2.fromArray(f.to);
      if (f.local) { const muzzle = vm.gun?.getObjectByName('muzzle'); if (muzzle) { muzzle.getWorldPosition(from); vm.vmCam.updateMatrixWorld(); from.applyMatrix4(vm.vmCam.matrixWorldInverse); from.applyMatrix4(camera.matrixWorld); } }
      const len = from.distanceTo(to); if (len < .5) return;
      t.m.position.copy(from); t.m.lookAt(to); t.m.scale.set(1, 1, len); t.m.visible = true; t.at = now;
    } else if (f.type === 'impact') {
      const s = fx.sparks[fx.si++ % fx.sparks.length];
      s.s.position.fromArray(f.at).addScaledVector(tmp.fromArray(f.normal), .05); s.s.visible = true; s.at = now; s.flesh = f.flesh;
      (s.s.material as THREE.SpriteMaterial).color.set(f.flesh ? '#ff4b3a' : '#ffd9a0');
    } else if (f.type === 'boom') {
      const b = fx.booms[fx.bi++ % fx.booms.length]; b.s.position.fromArray(f.at); b.smoke.position.fromArray(f.at); b.at = now; b.r = f.r; b.s.visible = b.smoke.visible = true;
    } else if (f.type === 'smoke') {
      const c = fx.smokes.find(x => now > x.until) ?? fx.smokes[0]; Object.assign(c, { at: now, until: now + f.ms, x: f.at[0], y: f.at[1], z: f.at[2], r: f.r });
      c.puffs.forEach((p, i) => { const a = i / c.puffs.length * Math.PI * 2; p.position.set(c.x + Math.cos(a) * f.r * .45 * (i % 2 ? 1 : .5), c.y + 1 + (i % 3) * .7, c.z + Math.sin(a) * f.r * .45); p.visible = true; });
    } else if (f.type === 'muzzle') {
      const p = pool.find(x => x.num === f.num); if (p) p.flashAt = now;
    } else if (f.type === 'flash') {
      const b = fx.booms[fx.bi++ % fx.booms.length]; b.s.position.fromArray(f.at); b.at = now; b.r = 2; b.s.visible = true; (b.s.material as THREE.SpriteMaterial).color.set('#ffffff');
    }
  }
  const zoomOf = () => { const s = live.sim; if (!s) return 1; const w = weaponOf(s); return w.zoom ?? (w.category === 'melee' ? 1 : 1.35); };

  // ---------------------------------------------------------------- the frame
  const fwd = useMemo(() => new THREE.Vector3(), []), eyePos = useMemo(() => ({ x: 0, y: 0, z: 0 }), []), sample = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0 }), []);
  const deathCam = useRef<{ x: number; y: number; z: number; yaw: number; at: number } | null>(null), stepDist = useRef(0), fpsRef = useRef({ frames: 0, t: 0 });
  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, .1), now = performance.now(), a = useArena.getState();
    const cam = camera as THREE.PerspectiveCamera;
    // Input and prediction (fixed 60 Hz steps inside).
    pollGamepad(dt, live.sim?.ads ?? 0, zoomOf());
    tickInput(dt);
    const s = live.sim;
    // ---- camera
    const decay = Math.exp(-dt * 14); live.smooth.x *= decay; live.smooth.y *= decay; live.smooth.z *= decay;
    live.kick *= Math.exp(-dt * 16); live.shake *= Math.exp(-dt * 5);
    if (s && live.alive) {
      deathCam.current = null;
      eye(eyePos);
      const shake = live.shake * .03;
      cam.position.set(eyePos.x + (Math.random() - .5) * shake, eyePos.y + (Math.random() - .5) * shake, eyePos.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = controls.yaw + s.ry; cam.rotation.x = controls.pitch + s.rp + live.kick * .008; cam.rotation.z = s.stance === 2 ? -.06 : 0;
      const zoom = 1 + (zoomOf() - 1) * s.ads * s.ads;
      const fov = settings.fov / zoom * (s.sprint ? 1.04 : 1);
      if (Math.abs(cam.fov - fov) > .01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 18); cam.updateProjectionMatrix(); }
      // Footsteps.
      if (s.grounded && s.stance !== 2) { stepDist.current += Math.hypot(s.vx, s.vz) * dt; if (stepDist.current > (s.sprint ? 2.1 : 1.7)) { stepDist.current = 0; sfx.step(undefined, s.stance === 1 ? .1 : .2); } }
    } else if (s) {
      // Death camera: drop and tilt where we fell, turned toward the eliminating player.
      const d = deathCam.current ??= { x: s.x, y: s.y + 1.4, z: s.z, yaw: controls.yaw, at: now };
      const k = Math.min(1, (now - d.at) / 700);
      const killer = a.killedBy?.num != null ? live.remotes.get(a.killedBy.num) : null;
      cam.position.set(d.x, d.y - k * .9, d.z);
      cam.rotation.order = 'YXZ';
      if (killer && killer.seenAt) { const want = Math.atan2(-(killer.pos.x - d.x), -(killer.pos.z - d.z)); cam.rotation.y += Math.atan2(Math.sin(want - cam.rotation.y), Math.cos(want - cam.rotation.y)) * Math.min(1, dt * 3); }
      cam.rotation.z = k * .35; cam.rotation.x = -k * .15;
      if (Math.abs(cam.fov - settings.fov) > .01) { cam.fov = settings.fov; cam.updateProjectionMatrix(); }
    }
    cam.getWorldDirection(fwd); setListener(cam.position, fwd);
    // ---- remote players
    const t = live.playback.time(now);
    const assigned = new Set<number>();
    for (const r of live.remotes.values()) {
      let slot = pool.find(p => p.num === r.num) ?? pool.find(p => !p.num || !live.remotes.has(p.num));
      if (!slot) continue;
      if (slot.num !== r.num) { slot.num = r.num; slot.tagKey = ''; slot.fall = 0; }
      assigned.add(slot.num);
      const m = slot.m, u = m.userData;
      const dead = !!r.deadAt, visible = (r.flags & 1) && r.seenAt && now - r.seenAt < 1000 || dead && now - r.deadAt < 1600;
      m.visible = !!visible; if (!visible) continue;
      if (t != null && !dead) { r.track.sample(t, sample); r.pos.x = sample.x; r.pos.y = sample.y; r.pos.z = sample.z; r.pos.yaw = sample.yaw; }
      m.position.set(r.pos.x, r.pos.y, r.pos.z); m.rotation.y = r.pos.yaw;
      const rel = r.team === live.team ? 'friend' : 'enemy';
      if (slot.rel !== rel) { slot.rel = rel; const c = TEAM_COLORS[rel]; u.accent.color.set(c); u.accent.emissive.set(c); u.visor.emissive.set(c); }
      // Pose: walk cycle from interpolated speed, crouch and slide postures, pitch on the upper body.
      const crouch = r.flags & 2, slide = r.flags & 4, sprint = r.flags & 8;
      const speed = Math.min(8, Math.hypot(sample.x - (u.lx ?? sample.x), sample.z - (u.lz ?? sample.z)) / Math.max(dt, 1e-3)); u.lx = sample.x; u.lz = sample.z;
      slot.walk += speed * dt * (sprint ? 1.9 : 2.4);
      const swing = Math.sin(slot.walk) * Math.min(1, speed / 3) * (crouch ? .4 : .7);
      u.legL.rotation.x = slide ? -1.3 : crouch ? -1.1 + swing * .4 : swing; u.legR.rotation.x = slide ? -1.1 : crouch ? .2 - swing * .4 : -swing;
      u.body.position.y = slide ? -.55 : crouch ? -.42 : Math.abs(Math.cos(slot.walk)) * .03 * Math.min(1, speed / 3);
      u.upper.rotation.x = Math.max(-.8, Math.min(.8, r.pitch)) * .7 + (slide ? -.35 : 0) + (sprint ? .25 : 0);
      if (dead) { slot.fall = Math.min(1, slot.fall + dt * 2.6); m.rotation.x = -slot.fall * 1.45; m.position.y = r.pos.y + slot.fall * .1; }
      else { slot.fall = 0; m.rotation.x = 0; }
      u.flash.visible = now - slot.flashAt < 50; if (u.flash.visible) u.flash.material.rotation = Math.random() * 6;
      // Remote footsteps within earshot.
      if (!dead && speed > 1.5 && (r.flags & 256) && !crouch && Math.hypot(r.pos.x - cam.position.x, r.pos.z - cam.position.z) < 22 && now - r.stepAt > (sprint ? 300 : 420)) { r.stepAt = now; sfx.step([r.pos.x, r.pos.y, r.pos.z], .3); }
      // Name tags over teammates.
      const name = a.match?.players.find(p => p.num === r.num);
      const key = rel === 'friend' && name ? name.name + (name.bot ? ' · SIM' : '') : '';
      if (slot.tagKey !== key) {
        slot.tagKey = key;
        if (slot.tag) { m.remove(slot.tag); (slot.tag.material as THREE.SpriteMaterial).map?.dispose(); slot.tag.material.dispose(); slot.tag = null; }
        if (key) { const { texture, aspect } = labelTexture(key, TEAM_COLORS.friend, 44, false); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })); sp.scale.set(.32 * aspect, .32, 1); sp.position.y = 2.15; sp.renderOrder = 9; m.add(sp); slot.tag = sp; }
      }
    }
    for (const p of pool) if (!assigned.has(p.num)) { p.m.visible = false; p.num = 0; }
    // ---- effects
    for (const tr of fx.tracers) if (tr.m.visible) { const k = (now - tr.at) / 70; if (k >= 1) tr.m.visible = false; else (tr.m.material as THREE.MeshBasicMaterial).opacity = 1 - k; }
    for (const sp of fx.sparks) if (sp.s.visible) { const k = (now - sp.at) / 260; if (k >= 1) sp.s.visible = false; else { sp.s.scale.setScalar((sp.flesh ? .35 : .18) * (1 + k)); sp.s.material.opacity = 1 - k; } }
    for (const b of fx.booms) {
      if (!b.s.visible && !b.smoke.visible) continue;
      const k = (now - b.at) / 650;
      if (k >= 1) { b.s.visible = false; (b.s.material as THREE.SpriteMaterial).color.set('#ffb35a'); }
      else { b.s.scale.setScalar(b.r * (.4 + k * 1.2)); b.s.material.opacity = 1 - k; }
      const ks = (now - b.at) / 2200;
      if (ks >= 1) b.smoke.visible = false; else { b.smoke.scale.setScalar(b.r * (.6 + ks)); b.smoke.material.opacity = .55 * (1 - ks); b.smoke.position.y += dt * .6; }
    }
    for (const c of fx.smokes) {
      const on = now < c.until; const fade = Math.min(1, (now - c.at) / 1200) * Math.min(1, (c.until - now) / 1500);
      for (const p of c.puffs) { p.visible = on; if (on) { p.material.opacity = .82 * fade; p.scale.setScalar(c.r * 1.25 * (.6 + .4 * Math.min(1, (now - c.at) / 1500))); } }
    }
    let gi = 0; for (const gr of live.grenades.values()) { const m = fx.grenades[gi++]; if (!m) break; m.visible = true; m.position.set(gr.x, gr.y, gr.z); (m.material as THREE.MeshStandardMaterial).color.set(EQUIP_IDS[gr.kind] === 'flash' ? '#c9c9c9' : EQUIP_IDS[gr.kind] === 'smoke' ? '#6d7a86' : '#4a5a3a'); }
    for (; gi < fx.grenades.length; gi++) fx.grenades[gi].visible = false;
    live.supplies = live.supplies.filter(c => now < c.until);
    fx.crates.forEach((m, i) => { const c = live.supplies[i]; m.visible = !!c; if (c) { m.position.set(c.x, c.y + .3, c.z); (m.material as THREE.MeshStandardMaterial).emissive.set(c.team === live.team ? TEAM_COLORS.friend : TEAM_COLORS.enemy); } });
    live.strikes = live.strikes.filter(s2 => now < s2.at + 400);
    fx.strikes.forEach((st, i) => { const s2 = live.strikes[i]; st.ring.visible = st.beam.visible = !!s2; if (s2) { const pulse = 1 + .08 * Math.sin(now / 90); st.ring.position.set(s2.x, s2.y + .06, s2.z); st.ring.scale.setScalar(s2.r * pulse); st.beam.position.set(s2.x, s2.y + 20, s2.z); } });
    // ---- objectives
    if (a.match?.mode === 'dom') {
      objectives.g.visible = true;
      a.hud.objectives.forEach(([owner, progress, capTeam, contested], i) => {
        const item = objectives.items[i]; if (!item) return;
        const color = owner < 0 ? TEAM_COLORS.neutral : owner === live.team ? TEAM_COLORS.friend : TEAM_COLORS.enemy;
        const cap = capTeam < 0 ? null : capTeam === live.team ? TEAM_COLORS.friend : TEAM_COLORS.enemy;
        (item.ring.material as THREE.MeshBasicMaterial).color.set(contested ? '#ffd166' : color);
        (item.fill.material as THREE.MeshBasicMaterial).color.set(cap ?? color); (item.fill.material as THREE.MeshBasicMaterial).opacity = .1 + (cap ? progress / 100 * .35 : 0);
        (item.letter.material as THREE.SpriteMaterial).color.set(color);
        item.letter.position.y = 3.2 + Math.sin(now / 600 + i) * .08;
      });
    } else objectives.g.visible = false;
    // ---- first-person weapon
    updateViewmodel(dt, now);
    // ---- frame rate readout
    const f = fpsRef.current; f.frames++; if (now - f.t > 1000) { const fps = Math.round(f.frames * 1000 / (now - f.t)); f.frames = 0; f.t = now; if (a.hud.fps !== fps) a.set({ hud: { ...useArena.getState().hud, fps } }); }
    void state;
  }, -1);
  function updateViewmodel(dt: number, now: number) {
    const s = live.sim;
    const sniperScope = !!s && weaponOf(s).category === 'sniper' && s.ads > .85;
    vm.holder.visible = !!s && live.alive && !sniperScope;
    if (!s || !live.alive) return;
    const w = weaponOf(s), skin = live.loadout?.skins?.[w.id] ?? 'standard';
    if (vm.gunId !== w.id || vm.skin !== skin) {
      if (vm.gun) vm.holder.remove(vm.gun);
      vm.gun = weaponModel(w.id, skin); vm.holder.add(vm.gun); vm.gunId = w.id; vm.skin = skin;
    }
    if (vm.armsTeam !== live.team) { if (vm.arms) vm.holder.remove(vm.arms); vm.arms = armsModel(live.team === 0 ? '#3b5b78' : '#6a4a3a'); vm.holder.add(vm.arms); vm.armsTeam = live.team; }
    // Sway lags the view; bob follows the steps; recoil kicks back; reload, switch and sprint have poses.
    const dyaw = controls.yaw - vm.lastYaw, dpitch = controls.pitch - vm.lastPitch; vm.lastYaw = controls.yaw; vm.lastPitch = controls.pitch;
    vm.swayX += (Math.max(-.06, Math.min(.06, dyaw * .6)) - vm.swayX) * Math.min(1, dt * 10); vm.swayY += (Math.max(-.05, Math.min(.05, -dpitch * .6)) - vm.swayY) * Math.min(1, dt * 10);
    const speed = Math.hypot(s.vx, s.vz); vm.bob += speed * dt * (s.sprint ? 1.6 : 2.1);
    const bobAmt = s.grounded ? Math.min(1, speed / 5) * (1 - s.ads * .85) : 0;
    const ads = s.ads * s.ads, hip = { x: .12, y: -.12, z: -.34 }, aim = { x: 0, y: -.07 * VM_SCALE, z: -.25 };
    let x = hip.x + (aim.x - hip.x) * ads + vm.swayX + Math.cos(vm.bob) * .012 * bobAmt;
    let y = hip.y + (aim.y - hip.y) * ads + vm.swayY - Math.abs(Math.sin(vm.bob)) * .014 * bobAmt;
    let z = hip.z + (aim.z - hip.z) * ads + live.kick * .045;
    let rx = live.kick * .07, ry = 0, rz = 0;
    if (s.sprint) { x -= .04; y -= .05; rx -= .35; ry += .55; rz += .2; }
    if (s.phase === 'reload') { const k = 1 - s.pt / Math.max(1, live.reloadTotal); rx += Math.sin(Math.min(1, k) * Math.PI) * .45; rz -= Math.sin(Math.min(1, k) * Math.PI) * .3; const mag = vm.gun?.getObjectByName('mag'); if (mag) { mag.userData.y0 ??= mag.position.y; mag.position.y = mag.userData.y0 - Math.sin(Math.min(1, k * 1.6) * Math.PI) * .18; } }
    else { const mag = vm.gun?.getObjectByName('mag'); if (mag && mag.userData.y0 !== undefined) mag.position.y = mag.userData.y0; }
    if (s.phase === 'switch') { const k = s.pt / Math.max(1, w.swap); y -= k * .3; rx -= k * .6; }
    if (s.phase === 'melee') { const total = w.fire === 'melee' ? w.swing ?? 30 : 30, k = 1 - s.pt / total; z -= Math.sin(k * Math.PI) * .22; ry += Math.sin(k * Math.PI) * (w.fire === 'melee' ? .2 : .6); rx += Math.sin(k * Math.PI) * .25; }
    if (s.phase === 'throw') { const k = 1 - s.pt / 22; y -= Math.sin(k * Math.PI) * .25; rx -= Math.sin(k * Math.PI) * .5; }
    if (s.stance === 2) rz += .15;
    vm.holder.position.set(x, y, z); vm.holder.rotation.set(rx, ry, rz);
    const flash = vm.gun?.getObjectByName('flash') as THREE.Sprite | undefined;
    if (flash) { flash.visible = now - live.firedAt < 45 && w.fire !== 'melee'; if (flash.visible) { flash.material.rotation = Math.random() * 6; flash.scale.setScalar(.16 + Math.random() * .1); } }
    vm.vmCam.aspect = size.width / size.height; vm.vmCam.fov = 58 - ads * 8; vm.vmCam.updateProjectionMatrix();
  }
  // Two passes: the world, then the weapon over a cleared depth buffer.
  useFrame(({ gl: r }) => {
    r.autoClear = true; r.render(scene, camera);
    if (vm.holder.visible) { r.autoClear = false; r.clearDepth(); r.render(vm.vmScene, vm.vmCam); r.autoClear = true; }
  }, 1);
  void WEAPONS; void WEAPON_BY_ID; void up;
  return null;
}
