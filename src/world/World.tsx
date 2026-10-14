import { occupiedAnchor } from '../vehicles/client';
import Expansion from './Expansion';
import Vehicles from './Vehicles';
import { QA_HOOKS } from '../qa';
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import Player from '../game/Player';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { input, livePeers, peerTracks, player, useGame, type Peer, type SitState } from '../state';
import { INTERP_DELAY } from '../network/interpolation.mjs';
import { SEAT_BY_ID } from '../../shared/interactions.mjs';
import { peerRelease } from '../interaction/controller';
import { Doors, Chairs, Balls, Computers } from './Interactive';
import { useKeepsakes } from '../account/store';
import { Label } from './Primitives';
import { useSocial, bond } from '../social/store';
import { parsePoint } from '../social/places';
import { ACHIEVEMENT_BY_ID } from '../../shared/achievements.mjs';
import { LOCATIONS, TOKENS } from '../../shared/campus.mjs';
import { cached, initLoaders, suspend } from './assets';
import { QUALITY, type QualityProfile } from './quality';
import { createResolution, STALL } from './resolution.mjs';
import { loadSurfaces, createMaterials, type Materials } from './materials';
import { SkyDome, Lighting, LIGHTING, loadSkyInfo } from './Sky';
import { Ground } from './Ground';
import { buildCampus, Props, Flags, Water, DistanceCull } from './Campus';
import { Vegetation, setSunDirection } from './Vegetation';
import { signFontsReady } from './architecture/signage';
import { surfaceHeight } from './layout';
import { registerMovingCaster } from './shadows';
const PostFX = lazy(() => import('./PostFX'));

const LIBRARY_CENTRE: [number, number, number] = [-30, 2, -15];

// Name tags: party members gold, friends blue, everyone else green. Signed-in players carry a ✓,
// which guests cannot type (the room strips it from guest names).
const TAG = { party: '#8a6424', friend: '#2e5a6e', none: '#203c33' };
function PeerAvatar({ peer: initial }: { peer: Peer }) {
  const peer = livePeers.get(initial.id) ?? initial;
  const kind = useSocial(s => bond(s, initial.id, initial.handle)) ?? 'none';
  const group = useRef<THREE.Group>(null!), tag = useRef<THREE.Group>(null!), shown = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0 }), []);
  // Someone already seated when we arrive is shown seated, not sitting down again.
  const motion = useRef<AvatarMotion & { last: THREE.Vector3; yaw: number }>({ speed: 0, y: 0, vy: 0, turn: 0, last: new THREE.Vector3(peer.x, 0, peer.z), yaw: peer.yaw, sit: peer.seat ? { seat: peer.seat, phase: 'seated', t: 0 } : null });
  useFrame(({ camera }, raw) => {
    const peer = livePeers.get(initial.id) ?? initial;
    const dt = Math.min(raw, .05), g = group.current, m = motion.current;
    // Seat state is replicated; the sit-down / stand-up motion itself plays locally.
    if (peer.seat && m.sit?.seat !== peer.seat) m.sit = { seat: peer.seat, phase: 'down', t: 0 } as SitState;
    else if (!peer.seat && m.sit && (m.sit.phase === 'down' || m.sit.phase === 'seated')) m.sit.phase = 'up';
    if (m.sit?.phase === 'done') { m.sit = null; g.position.set(peer.x, peer.y + surfaceHeight(peer.x, peer.z), peer.z); m.last.copy(g.position); }
    const anchor=peer.vehicle?occupiedAnchor(peer.vehicle,peer.vehicleSeat??0):null;
    m.vehicleSeatHeight=anchor?.y??null;
    if(anchor){g.position.set(anchor.x,.025,anchor.z);g.rotation.y=anchor.yaw;m.speed=0;m.y=0;m.vy=0;m.turn=0;m.last.copy(g.position);tag.current.position.y=anchor.y+1.4;tag.current.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion);return;}
    const seat = m.sit ? SEAT_BY_ID.get(m.sit.seat) : undefined;
    // Drawn slightly in the past, between the two snapshots around that moment: steady speed (./network/interpolation.mjs).
    const at = peerTracks.get(initial.id)?.sample(performance.now() - INTERP_DELAY, shown) ? shown : peer;
    if (seat) { g.position.set(seat.x, surfaceHeight(seat.x, seat.z), seat.z); g.rotation.y = seat.yaw; }
    else g.position.set(at.x, at.y + surfaceHeight(at.x, at.z), at.z);
    let d = at.yaw - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); if (!seat) g.rotation.y += d * (1 - Math.exp(-dt * 14));
    m.holding = !!peer.ball; m.release = peerRelease.get(initial.id) ?? 0;
    // Derive gait speed from the interpolated motion so remote avatars animate like the local one.
    const moved = Math.hypot(g.position.x - m.last.x, g.position.z - m.last.z) / Math.max(dt, 1e-4); m.last.copy(g.position);
    m.speed = seat ? 0 : THREE.MathUtils.damp(m.speed, peer.moving ? moved : 0, 8, dt); m.y = peer.y; m.vy = peer.y > .05 ? 1 : 0; m.turn = d * 4;
    m.emote = peer.emote; m.emoteUntil = peer.emoteAt + 3000;
    tag.current.quaternion.copy(g.quaternion).invert().multiply(camera.quaternion);
    tag.current.position.y = THREE.MathUtils.damp(tag.current.position.y, seat ? 1.8 : 2.25, 4, dt);
    const tagDistance = g.position.distanceToSquared(camera.position);
    tag.current.visible = tagDistance > 9 && tagDistance < 900;
  });
  return <group ref={group} position={[peer.x, peer.y, peer.z]}><AvatarBoundary accent={peer.avatar.accent}><Suspense fallback={null}><Avatar id={initial.id} config={peer.avatar} motion={() => motion.current} /></Suspense></AvatarBoundary><group ref={tag} position={[0, 2.25, 0]} name={`tag:${initial.id}`}
    // Click a name tag to see who it is: their profile card, or the People list for guests. A drag
    // that started on the tag (looking around) does not count.
    onClick={e => { if (e.delta > 6) return; e.stopPropagation(); const p = livePeers.get(initial.id) ?? initial; useGame.getState().set({ panel: p.handle ? `player:${p.handle}` : 'players' }); document.exitPointerLock?.(); }}
    onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}><Label text={initial.name + (initial.verified ? ' ✓' : '')} p={[0, 0, 0]} width={2.4} height={.36} background={TAG[kind]} />{initial.title && ACHIEVEMENT_BY_ID.get(initial.title) && <Label text={ACHIEVEMENT_BY_ID.get(initial.title)!.title} p={[0, -.3, 0]} width={1.8} height={.22} color="#f2d69a" background="#1b2f28" />}</group></group>;
}

function Peers() {
  const peers = useGame(s => s.peers);
  return <>{peers.map(peer => <PeerAvatar key={peer.id + JSON.stringify(peer.avatar)} peer={peer} />)}</>;
}

function Collectibles() {
  const tokens = useKeepsakes(), reduced = useGame(s => s.reducedMotion), group = useRef<THREE.Group>(null!);
  const gold = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e7b85c', metalness: 1, roughness: .22, emissive: '#7a4a12', emissiveIntensity: .35 }), []);
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd37a', transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  useEffect(() => registerMovingCaster(group.current), []);
  useFrame(({ clock }) => { group.current.children.forEach((child, i) => { const gem = child.children[0]; gem.rotation.y = reduced ? 0 : clock.elapsedTime * .8; gem.position.y = 1.15 + (reduced ? 0 : Math.sin(clock.elapsedTime * 2 + i) * .12); }); });
  return <group ref={group}>{TOKENS.filter(t => !tokens.includes(t.id)).map(t => <group key={t.id} position={[t.x, surfaceHeight(t.x, t.z), t.z]}>
    <group><mesh castShadow material={gold}><octahedronGeometry args={[.3, 0]} /></mesh><mesh material={gold} rotation-x={Math.PI / 2}><torusGeometry args={[.46, .014, 8, 48]} /></mesh></group>
    <mesh rotation-x={-Math.PI / 2} position-y={.02} material={glow}><circleGeometry args={[.7, 32]} /></mesh>
  </group>)}</group>;
}

function Waypoint() {
  const id = useGame(s => s.destination), beam = useRef<THREE.Mesh>(null!), marker = useRef<THREE.Group>(null!);
  // "peer:<id>" follows a player (a friend or party member) until you reach them or they leave.
  const follow = id?.startsWith('peer:') ? id.slice(5) : null, start = follow ? livePeers.get(follow) : null;
  const loc = follow ? (start ? { x: start.x, z: start.z } : null) : parsePoint(id) ?? LOCATIONS.find(l => l.id === id);
  useFrame(({ clock }) => {
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = .16 + Math.sin(clock.elapsedTime * 2) * .04;
    if (!follow) return;
    const p = livePeers.get(follow), g = useGame.getState();
    if (!p) { if (g.destination === id) { g.set({ destination: null }); g.notify('They left the room, so the marker is gone.'); } return; }
    if (marker.current) marker.current.position.set(p.x, surfaceHeight(p.x, p.z) + .02, p.z);
    if (Math.hypot(p.x - player.x, p.z - player.z) < 3.5 && g.destination === id) { g.set({ destination: null }); g.notify(`You found ${p.name}.`); }
  });
  return loc ? <group ref={marker} position={[loc.x, surfaceHeight(loc.x, loc.z) + .02, loc.z]}>
    <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[1, 1.15, 48]} /><meshBasicMaterial color="#f6c872" transparent opacity={.85} depthWrite={false} /></mesh>
    <mesh ref={beam} position-y={6}><cylinderGeometry args={[.5, .9, 12, 24, 1, true]} /><meshBasicMaterial color="#ffd27a" transparent opacity={.18} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} /></mesh>
    <mesh position={[0, 3.6, 0]} rotation-z={Math.PI}><coneGeometry args={[.24, .5, 4]} /><meshStandardMaterial color="#f6c872" emissive="#c98a2a" emissiveIntensity={.6} /></mesh>
  </group> : null;
}

/** Lowers the render scale when frames run long and restores it when there is headroom (policy: ./resolution.mjs). */
function AdaptiveResolution({ max, min }: { max: number; min: number }) {
  const setDpr = useThree(s => s.setDpr), control = useMemo(() => createResolution(max, min), [max, min]);
  useEffect(() => { setDpr(max); }, [control, max, setDpr]);
  useFrame((_, dt) => { const next = control.frame(dt); if (next != null) setDpr(next); });
  return null;
}

function Telemetry() {
  const { gl, scene, camera } = useThree(), frames = useRef(0), elapsed = useRef(0), sample = useRef({ calls: 0, triangles: 0 });
  // The post stack renders several passes per frame; accumulate them all and sample per frame.
  useEffect(() => { gl.info.autoReset = false; return () => { gl.info.autoReset = true; }; }, [gl]);
  useFrame(() => { sample.current = { calls: gl.info.render.calls, triangles: gl.info.render.triangles }; gl.info.reset(); }, -100);
  useEffect(() => {
    if (QA_HOOKS) Object.assign(window, { __campusGL: gl, __campusScene: scene, __campusCamera: camera });
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__campusHide = (prefix: string, hide = true) => { let n = 0; scene.traverse(o => { if (o.name.startsWith(prefix)) { o.visible = !hide; n++; } }); return n; };
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__campusStats = () => {
      const by: Record<string, number> = {};
      scene.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh || !m.geometry) return; const g = m.geometry, tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3 * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : (g as THREE.InstancedBufferGeometry).isInstancedBufferGeometry ? (g as THREE.InstancedBufferGeometry).instanceCount : 1); const k = (m.name || m.type).split(':').slice(0, 2).join(':'); by[k] = (by[k] ?? 0) + Math.round(tris); });
      return Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 30);
    };
    if (QA_HOOKS) (window as unknown as Record<string, unknown>).__campusInspect = () => { const s = useGame.getState(); return { position: { x: player.x, y: player.y, z: player.z }, yaw: input.yaw, panel: s.panel, nearby: s.nearby, status: s.status, discovered: s.discovered, tourStep: s.tourStep, tokens: s.tokens, bestScore: s.bestScore, peers: s.peers.map(p => ({ ...p, ...livePeers.get(p.id) })), avatar: s.avatar, quality: s.quality }; };
    const lost = (e: Event) => { e.preventDefault(); useGame.getState().set({ panel: 'recovery' }); };
    gl.domElement.addEventListener('webglcontextlost', lost); return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl, scene]);
  useFrame((_, dt) => {
    if (dt > STALL) { frames.current = 0; elapsed.current = 0; return; }
    frames.current++; elapsed.current += dt;
    if (elapsed.current >= 2) {
      const fps = Math.round(frames.current / elapsed.current); useGame.getState().set({ fps });
      (window as unknown as Record<string, unknown>).__campus = { position: { x: player.x, y: player.y, z: player.z }, fps, drawCalls: sample.current.calls, triangles: sample.current.triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries, quality: useGame.getState().quality, peers: [...livePeers.values()].map(p => ({ id: p.id, x: p.x, z: p.z })), tokens: useGame.getState().tokens };
      frames.current = 0; elapsed.current = 0;
    }
  });
  return null;
}

/**
 * Keeps its children hidden while their shaders compile in parallel (KHR_parallel_shader_compile),
 * then reveals them, so a slow driver compile never freezes the page. Programs are prepared with
 * the same output target type the post stack renders into, so the first frame reuses them.
 */
function CompileGate({ children, post, onReady }: { children: ReactNode; post: boolean; onReady?: () => void }) {
  const group = useRef<THREE.Group>(null!), [shown, setShown] = useState(false), { gl, camera, scene } = useThree();
  useEffect(() => {
    let alive = true;
    const target = post ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }) : null, previous = gl.getRenderTarget(), t = performance.now();
    gl.setRenderTarget(target);
    const pending = gl.compileAsync(group.current, camera, scene);
    gl.setRenderTarget(previous);
    pending.then(() => { target?.dispose(); if (!alive) return; gl.shadowMap.needsUpdate = true; scene.traverse(o => { if ((o as THREE.DirectionalLight).isDirectionalLight) (o as THREE.DirectionalLight).shadow.needsUpdate = true; }); if (QA_HOOKS) console.info(`shaders compiled in ${Math.round(performance.now() - t)} ms`); setShown(true); onReady?.(); }).catch(() => { target?.dispose(); if (alive) useGame.getState().set({ panel: 'recovery' }); });
    return () => { alive = false; };
  }, [gl, camera, scene, post, onReady]);
  return <group ref={group} visible={shown}>{children}</group>;
}

/** Everything that depends on loaded textures. Suspends until the material library is ready. */
function Campus({ quality }: { quality: QualityProfile }) {
  const { gl } = useThree();
  initLoaders(gl, quality.anisotropy);
  const reduced = useGame(s => s.reducedMotion);
  suspend(cached('fonts', signFontsReady));
  const surfaces = suspend(cached(`surfaces:${quality.materialDetail}`, () => loadSurfaces(quality.materialDetail).then(s => { if (QA_HOOKS) console.info(`surfaces ready at ${Math.round(performance.now())} ms`); return s; })));
  const info = suspend(loadSkyInfo());
  // Built once per session: this component can re-render many times before it commits.
  const lib: Materials = suspend(cached(`materials:${quality.materialDetail}`, async () => createMaterials(surfaces, quality.materialDetail)));
  const campus = suspend(cached(`campus:${quality.materialDetail}`, async () => { const t = performance.now(); const c = buildCampus(lib); if (QA_HOOKS) console.info(`campus built in ${Math.round(performance.now() - t)} ms (at ${Math.round(performance.now())} ms)`); return c; }));
  useEffect(() => { setSunDirection(new THREE.Vector3(...info.sunDirection)); }, [info]);
  // The welcome screen's "Enter campus" waits for the textured campus, not just a canvas.
  const reveal = useMemo(() => () => { useGame.getState().set({ ready: true }); if (QA_HOOKS) console.info(`campus ready at ${Math.round(performance.now())} ms`); }, []);
  return <>
    <CompileGate post={quality.post} onReady={reveal}>
    <Ground surfaces={surfaces} quality={quality} />
    <primitive object={campus.group} /><Expansion lib={lib} /><Vehicles />
    <Water reduced={reduced} />
    <Flags placements={campus.context.props} reduced={reduced} />
    <Props placements={campus.context.props} quality={quality} />
    <DistanceCull object={campus.books} centre={LIBRARY_CENTRE} distance={Math.min(60, quality.detailDistance)} />
    <Doors lib={lib} distance={quality.detailDistance + 12} /><Chairs distance={quality.detailDistance} /><Computers /><Balls />
    <Collectibles /><Waypoint /><Player /><Peers />
    </CompileGate>
    <Suspense fallback={null}><CompileGate post={quality.post}><Vegetation lib={lib} quality={quality} reduced={reduced} /></CompileGate></Suspense>
  </>;
}

// QA builds only: `?qa-scale=0.25` renders the 3D view at a fixed low resolution, so browser tests
// on machines without a GPU (software WebGL) stay responsive. Interface and gameplay are unchanged.
const QA_SCALE = QA_HOOKS ? Math.min(1, Math.max(0, Number(new URLSearchParams(location.search).get('qa-scale')) || 0)) : 0;
// Memoised: the interface around the canvas re-renders on its own state; that must not reconcile the scene.
export default memo(function World() {
  const qualityKey = useGame(s => s.quality), quality = QUALITY[qualityKey], ceiling = QA_SCALE || Math.min(quality.dpr, window.devicePixelRatio || 1);
  return <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={QA_SCALE || [1, ceiling]} camera={{ position: [46, 30, 62], fov: 52, near: .25, far: 2400 }}
    gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.AgXToneMapping, toneMappingExposure: LIGHTING.exposure, stencil: false }}
    onCreated={({ gl }) => { gl.setClearColor('#b9c8d4'); }}>
    <Suspense fallback={null}>
      <SkyDome quality={quality} />
      <Lighting quality={quality} />
      <Campus quality={quality} />
      {quality.post && <Suspense fallback={null}><PostFX quality={quality} /></Suspense>}
    </Suspense>
    <AdaptiveResolution max={ceiling} min={QA_SCALE || (qualityKey === 'high' ? .75 : .6)} />
    <Telemetry />
  </Canvas>;
});
