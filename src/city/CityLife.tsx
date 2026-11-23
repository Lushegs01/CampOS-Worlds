// Metropolitan City's living population: the traffic and pedestrian simulations (shared/city) stepped every frame
// while anyone is in or near the city, fed with what is really there (you, your car, other players and their cars,
// the room's fleet, the Getaway's police units and its gunfire and explosions), and drawn with instanced models:
// one body and one glass mesh per vehicle class, shared wheels and contact shadows, four pedestrian meshes, and the
// signal lamps. Draw distances, update tiers and population budgets follow the graphics profile.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createTraffic, stepTraffic, trafficIncident, trafficSummary } from '../../shared/city/traffic.mjs';
import { createPeople, stepPeople, peopleIncident, peopleOnRoad, peopleSummary } from '../../shared/city/pedestrians.mjs';
import { CITY_CLASSES, CLASS_NAMES } from '../../shared/city/vehicles.mjs';
import { NETWORK_STATS } from '../../shared/city/network.mjs';
import { VEHICLE_TYPES } from '../../shared/vehicles.mjs';
import { inMetro, onExpressway } from '../../shared/metro.mjs';
import { player, useGame, livePeers } from '../state';
import { vehicleVisuals, useVehicle, missionVehicleInfo } from '../vehicles/client';
import { onMissionEvent } from '../mission/client';
import { roadsideHeight } from '../world/roads';
import { QA_HOOKS } from '../qa';
import { buildClassModel, buildWheel, vehicleMaterial } from './vehicleKit';
import { BODY_GEOMETRY, peopleMaterial, blobTexture, POSE } from './people';
import { buildStreetKit } from './streetKit';
import { cityHour, nightFactor } from './clock';
import { cityAudio } from './sound';

type Profile = 'low' | 'medium' | 'high' | 'ultra';
const DRAW = { low: { cars: 190, people: 85, wheels: 70 }, medium: { cars: 280, people: 125, wheels: 110 }, high: { cars: 380, people: 160, wheels: 150 }, ultra: { cars: 460, people: 200, wheels: 190 } };
const CAP = 200, PCAP = 260;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ'), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), sphere = new THREE.Sphere(), frustum = new THREE.Frustum(), projScreen = new THREE.Matrix4();
const colour = new THREE.Color();
const active = (x: number, z: number) => inMetro(x, z, 160) || onExpressway(x, z, 60);

/** Live handle for QA tools and the cinematic director (what the city is doing right now). */
export const cityLive: { traffic: ReturnType<typeof createTraffic> | null; people: ReturnType<typeof createPeople> | null } = { traffic: null, people: null };

export default function CityLife() {
  const quality = useGame(s => s.quality) as Profile;
  const camera = useThree(s => s.camera);
  const root = useRef<THREE.Group>(null!);
  const kit = useMemo(() => {
    const body = vehicleMaterial('body'), glass = vehicleMaterial('glass');
    const classes = CLASS_NAMES.map(cls => {
      const { body: bg, glass: gg } = buildClassModel(cls);
      const paint = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3), lamps = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
      paint.setUsage(THREE.DynamicDrawUsage); lamps.setUsage(THREE.DynamicDrawUsage);
      for (const g of [bg, gg]) { g.setAttribute('iPaint', paint); g.setAttribute('iLamps', lamps); }
      const bm = new THREE.InstancedMesh(bg, body.material, CAP), gm = new THREE.InstancedMesh(gg, glass.material, CAP);
      for (const m of [bm, gm]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
      bm.name = 'city:vehicles:' + cls; gm.name = 'city:glass:' + cls; bm.castShadow = false; bm.receiveShadow = true;
      return { cls, bm, gm, paint, lamps, spec: CITY_CLASSES[cls as keyof typeof CITY_CLASSES] };
    });
    const wheels = new THREE.InstancedMesh(buildWheel(), body.material, CAP * 4);
    { const n = wheels.geometry.attributes.position.count; wheels.geometry.setAttribute('iPaint', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4 * 3).fill(1), 3)); wheels.geometry.setAttribute('iLamps', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4 * 4), 4)); void n; }
    wheels.count = 0; wheels.frustumCulled = false; wheels.name = 'city:wheels'; wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const blobTex = blobTexture();
    const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
    const blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), CAP + PCAP);
    blobs.count = 0; blobs.frustumCulled = false; blobs.name = 'city:contact-shadows'; blobs.renderOrder = 1;
    const pm = peopleMaterial(), bodies = BODY_GEOMETRY();
    const people = Object.entries(bodies).map(([kind, g]) => {
      const attr = (size: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(PCAP * size), size); a.setUsage(THREE.DynamicDrawUsage); return a; };
      const a = { iSkin: attr(3), iTop: attr(3), iBottom: attr(3), iHair: attr(3), iShoe: attr(4), iAccent: attr(3), iAnim: attr(4) };
      for (const [k, v] of Object.entries(a)) g.setAttribute(k, v);
      const mesh = new THREE.InstancedMesh(g, pm.material, PCAP); mesh.count = 0; mesh.frustumCulled = false; mesh.name = 'city:people:' + kind; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return { kind, mesh, a };
    });
    const street = buildStreetKit();
    return { classes, wheels, blobs, people, street, uniforms: [body.uniforms, glass.uniforms, street.uniforms], pm };
  }, []);
  useEffect(() => () => {
    for (const c of kit.classes) { c.bm.geometry.dispose(); c.gm.geometry.dispose(); }
    kit.wheels.geometry.dispose(); kit.blobs.geometry.dispose(); for (const p of kit.people) p.mesh.geometry.dispose();
    kit.street.stat.geometry.dispose(); kit.street.marks.geometry.dispose(); kit.street.lampMesh.geometry.dispose();
  }, [kit]);

  // Simulations (created the first time anyone approaches the city; kept while the world is loaded).
  const sim = useRef<{ t: ReturnType<typeof createTraffic>; p: ReturnType<typeof createPeople> } | null>(null);
  const pending = useRef<{ kind: string; at: { x: number; z: number }; strength: number }[]>([]);
  useEffect(() => onMissionEvent(e => {
    const kind = e.kind === 'shot' || e.kind === 'enemyShot' ? 'gunfire' : e.kind === 'blast' || e.kind === 'explosion' ? 'explosion' : e.kind === 'crash' ? 'crash' : e.kind === 'horn' ? 'horn' : null;
    if (kind) pending.current.push({ kind, at: { x: e.x, z: e.z }, strength: 1 });
  }), []);
  useEffect(() => { if (sim.current) { sim.current.t.quality = quality; sim.current.p.quality = quality; } }, [quality]);
  const lastShot = useRef(0);
  useEffect(() => {
    if (!QA_HOOKS) return;
    const w = window as unknown as Record<string, unknown>;
    w.__cityLife = () => sim.current ? { traffic: trafficSummary(sim.current.t), people: peopleSummary(sim.current.p), hour: sim.current.t.hour, network: NETWORK_STATS, time: sim.current.t.time } : null;
    w.__cityControl = (o: { hour?: number; freeze?: boolean; incident?: { kind: string; x: number; z: number } }) => {
      const s = sim.current; if (!s) return false;
      if (o.hour != null) { s.t.hour = s.p.hour = o.hour; cityHour.override = o.hour; }
      if (o.freeze != null) s.t.frozen = s.p.frozen = o.freeze;
      if (o.incident) pending.current.push({ kind: o.incident.kind, at: o.incident, strength: 1 });
      return true;
    };
    w.__cityVehicles = (r = 80) => sim.current?.t.list.filter(v => Math.hypot(v.x - player.x, v.z - player.z) < r).map(v => ({ id: v.id, cls: v.cls, x: +v.x.toFixed(2), z: +v.z.toFixed(2), yaw: +v.yaw.toFixed(3), v: +v.v.toFixed(2), state: v.state, why: v.why, seg: v.seg, brake: v.brake, ind: v.ind }));
    w.__cityPeople = (r = 60) => sim.current?.p.list.filter(c => Math.hypot(c.x - player.x, c.z - player.z) < r).map(c => ({ id: c.id, x: +c.x.toFixed(2), z: +c.z.toFixed(2), state: c.state, v: +c.v.toFixed(2), body: c.look.body }));
    return () => { for (const k of ['__cityLife', '__cityControl', '__cityVehicles', '__cityPeople']) delete w[k]; };
  }, []);

  const audio = useMemo(() => cityAudio(), []);
  useEffect(() => () => audio.stop(), [audio]);

  useFrame((state, raw) => {
    const g = root.current; if (!g) return;
    const here = active(player.x, player.z);
    g.visible = here || player.z > 1150;
    if (!g.visible) { audio.quiet(); return; }
    const dt = Math.min(raw, .1), hour = cityHour.now(), night = nightFactor(hour);
    if (!sim.current) { sim.current = { t: createTraffic({ seed: 1709, quality, hour }), p: createPeople({ seed: 4021, quality, hour }) }; cityLive.traffic = sim.current.t; cityLive.people = sim.current.p; }
    const { t, p } = sim.current;
    t.hour = p.hour = hour;
    // ---- what the simulations see
    const myCar = useVehicle.getState().id, view = Math.atan2(state.camera.position.x - player.x, state.camera.position.z - player.z) + Math.PI;
    const players = [{ x: player.x, z: player.z, yaw: player.yaw, view }];
    for (const peer of livePeers.values()) if (Number.isFinite(peer.x)) players.push({ x: peer.x, z: peer.z, yaw: peer.yaw ?? 0, view: peer.yaw ?? 0 });
    const obstacles: { x: number; z: number; r: number; v: number; yaw: number; len: number; wid: number; kind: string; id: string }[] = [];
    const sirens: { x: number; z: number }[] = [], fast: { x: number; z: number; yaw: number; v: number }[] = [];
    for (const v of vehicleVisuals.values()) {
      if (Math.abs(v.x - player.x) > 420 || Math.abs(v.z - player.z) > 420) continue;
      const spec = VEHICLE_TYPES[v.type as keyof typeof VEHICLE_TYPES] ?? VEHICLE_TYPES.car, info = missionVehicleInfo(v.id);
      const speed = Math.abs(v.speed ?? 0);
      // A car is a row of three circles along its length (for the drivers' path checks).
      for (const k of [-1, 0, 1]) obstacles.push({ x: v.x + Math.sin(v.yaw) * k * spec.length * .33, z: v.z + Math.cos(v.yaw) * k * spec.length * .33, r: spec.width * .55, v: speed, yaw: v.yaw, len: spec.length, wid: spec.width, kind: 'part', id: v.id });
      obstacles.push({ x: v.x, z: v.z, r: 0, v: speed, yaw: v.yaw, len: spec.length, wid: spec.width, kind: 'vehicle', id: v.id });
      if (info?.siren) sirens.push({ x: v.x, z: v.z });
      if (speed > 4) fast.push({ x: v.x, z: v.z, yaw: v.yaw + (v.speed < 0 ? Math.PI : 0), v: speed });
    }
    const walkersExt: { x: number; z: number }[] = [];
    if (!myCar) { obstacles.push({ x: player.x, z: player.z, r: .45, v: 0, yaw: 0, len: 0, wid: 0, kind: 'person', id: 'me' }); walkersExt.push({ x: player.x, z: player.z }); }
    for (const peer of livePeers.values()) if (!peer.vehicle && Number.isFinite(peer.x)) { obstacles.push({ x: peer.x, z: peer.z, r: .45, v: 0, yaw: 0, len: 0, wid: 0, kind: 'person', id: peer.id }); walkersExt.push({ x: peer.x, z: peer.z }); }
    // People on the road (crossing, fleeing) are obstacles for the drivers.
    const onRoad = peopleOnRoad(p);
    for (const c of onRoad) obstacles.push({ x: c.x, z: c.z, r: .4, v: c.v, yaw: c.yaw, len: 0, wid: 0, kind: 'person', id: c.id });
    // Incidents: the mission's gunfire and blasts, and the city's own crashes and horns.
    for (const e of pending.current.splice(0)) { trafficIncident(t, e.kind, e.at, e.strength); peopleIncident(p, e.kind, e.at, e.strength); }
    if (sirens.length && t.time - lastShot.current > 1.5) { lastShot.current = t.time; for (const s of sirens) peopleIncident(p, 'siren', s, .5); }
    // ---- step
    if (here) {
      stepTraffic(t, dt, { players, obstacles, sirens, walkers: onRoad });
      const moving: { x: number; z: number; yaw: number; v: number }[] = [], buses: { x: number; z: number; stop: number }[] = [];
      for (const v of t.list) { if (v.v > .3 && v.tier === 0) moving.push(v); if (v.cls === 'bus' && v.dwell != null) buses.push({ x: v.x, z: v.z, stop: v.dwell }); }
      stepPeople(p, dt, { players, vehicles: moving, fast: [...fast, ...t.list.filter(v => v.tier === 0 && v.v > 6)], walkersExt, buses });
      for (const e of t.events.splice(0)) {
        if (e.kind === 'horn') { audio.horn(e); peopleIncident(p, 'horn', e, .3); }
        if (e.kind === 'crash') { peopleIncident(p, 'crash', e, e.strength ?? .6); audio.crash(e); }
        if (e.kind === 'bail') { /* the driver of an abandoned car runs: a person leaves the driver's door */ peopleIncident(p, 'explosion', e, .2); }
      }
    }
    // ---- draw
    for (const u of kit.uniforms) { u.uTime.value = state.clock.elapsedTime; u.uNight.value = night; }
    kit.pm.uniforms.uTime.value = state.clock.elapsedTime;
    kit.street.update(t.time);
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projScreen);
    const D = DRAW[quality] ?? DRAW.medium;
    const counts = new Map<string, number>(); let wheels = 0, blobs = 0;
    const byClass = new Map(kit.classes.map(c => [c.cls, c]));
    const near: typeof t.list = [];
    for (const v of t.list) {
      const dx = v.x - player.x, dz = v.z - player.z, d = Math.hypot(dx, dz);
      if (d > D.cars) continue;
      sphere.center.set(v.x, 1, v.z); sphere.radius = v.len * .6 + 1;
      if (!frustum.intersectsSphere(sphere)) continue;
      const c = byClass.get(v.cls)!; const i = counts.get(v.cls) ?? 0; if (i >= CAP) continue; counts.set(v.cls, i + 1);
      // Body: pitch under braking and acceleration, roll in corners (visual only).
      const pitch = THREE.MathUtils.clamp(-(v.accel ?? 0) * .006, -.035, .035), roll = THREE.MathUtils.clamp(v.steer * v.v * .004, -.04, .04);
      tmpE.set(pitch, v.yaw, v.cls === 'moto' ? -v.steer * Math.min(1, v.v / 6) * .5 : roll); tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP.set(v.x, 0, v.z), tmpQ, tmpS.set(1, 1, 1));
      c.bm.setMatrixAt(i, tmpM); c.gm.setMatrixAt(i, tmpM);
      colour.set(v.paint).convertSRGBToLinear(); c.paint.setXYZ(i, colour.r, colour.g, colour.b);
      c.lamps.setXYZW(i, v.brake ? 1 : 0, v.hazard ? 2 : v.ind, v.cls === 'police' && (v.siren || v.flee) ? 1 : 0, v.reverse ? 1 : 0);
      if (d < D.wheels) {
        const spec = c.spec, r = spec.wheel, spin = (v.spin = ((v.spin ?? 0) + v.v * dt / r * (v.reverse ? -1 : 1)) % (Math.PI * 2));
        const axles = v.cls === 'moto' ? [[0, spec.wheelbase / 2, 1], [0, -spec.wheelbase / 2, 0]] : [[1, spec.wheelbase / 2, 1], [-1, spec.wheelbase / 2, 1], [1, -spec.wheelbase / 2, 0], [-1, -spec.wheelbase / 2, 0]];
        for (const [s, z, steer] of axles) {
          if (wheels >= CAP * 4) break;
          const wW = v.cls === 'moto' ? .12 : v.cls === 'truck' || v.cls === 'bus' ? .3 : .22, lx = s * (spec.width / 2 - wW / 2 + .012), wx = v.x + Math.cos(v.yaw) * lx + Math.sin(v.yaw) * z, wz = v.z - Math.sin(v.yaw) * lx + Math.cos(v.yaw) * z;
          tmpE.set(spin, v.yaw + (steer ? v.steer : 0), 0, 'YXZ'); tmpQ.setFromEuler(tmpE); tmpE.order = 'YXZ';
          tmpM.compose(tmpP.set(wx, r, wz), tmpQ, tmpS.set(wW, r, r));
          kit.wheels.setMatrixAt(wheels++, tmpM);
        }
      }
      if (blobs < CAP + PCAP) { tmpE.set(0, v.yaw, 0); tmpQ.setFromEuler(tmpE); tmpM.compose(tmpP.set(v.x, .04, v.z), tmpQ, tmpS.set(v.wid * 1.35, 1, v.len * 1.15)); kit.blobs.setMatrixAt(blobs++, tmpM); }
      if (d < 70) near.push(v);
    }
    for (const c of kit.classes) {
      const n = counts.get(c.cls) ?? 0; c.bm.count = c.gm.count = n;
      if (n) { c.bm.instanceMatrix.needsUpdate = c.gm.instanceMatrix.needsUpdate = true; c.paint.needsUpdate = c.lamps.needsUpdate = true; c.bm.instanceMatrix.clearUpdateRanges(); }
    }
    kit.wheels.count = wheels; kit.wheels.instanceMatrix.needsUpdate = true;
    // People.
    const pc = new Map<string, number>();
    const byKind = new Map(kit.people.map(x => [x.kind, x]));
    for (const c of p.list) {
      const x = c.x + (c.ox ?? 0), z = c.z + (c.oz ?? 0), d = Math.hypot(x - player.x, z - player.z);
      if (d > D.people) continue;
      sphere.center.set(x, 1, z); sphere.radius = 1.2; if (!frustum.intersectsSphere(sphere)) continue;
      const k = byKind.get(c.look.body)!, i = pc.get(c.look.body) ?? 0; if (i >= PCAP) continue; pc.set(c.look.body, i + 1);
      const y = d < 60 ? roadsideHeight(x, z) : .1;
      tmpE.set(0, c.yaw, 0); tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(c.look.build, c.look.height, c.look.build * .98));
      k.mesh.setMatrixAt(i, tmpM);
      const set = (a: THREE.InstancedBufferAttribute, hex: string) => { colour.set(hex).convertSRGBToLinear(); a.setXYZ(i, colour.r, colour.g, colour.b); };
      set(k.a.iSkin, c.look.skin); set(k.a.iTop, c.look.top); set(k.a.iBottom, c.look.bottom); set(k.a.iHair, c.look.hair); set(k.a.iAccent, c.look.accent);
      colour.set(c.look.shoes).convertSRGBToLinear(); k.a.iShoe.setXYZW(i, colour.r, colour.g, colour.b, Math.max(0, Math.min(1, c.fade)));
      const moving = c.state === 'walk' || c.state === 'flee' || c.state === 'exit' || c.state === 'enter' || c.state === 'board' || !!c.dodge;
      const pose = c.state === 'sit' || c.state === 'wait' ? (c.place?.kind === 'busstop' && c.seat >= 2 ? POSE.idle : POSE.sit) : c.state === 'cower' ? POSE.cower : c.state === 'talk' ? POSE.talk : moving && c.v > .15 ? POSE.walk : POSE.idle;
      const amp = pose === POSE.walk ? Math.min(1.5, .55 + c.v * .36) : 0;
      k.a.iAnim.setXYZW(i, c.phase * 3.1, amp, pose, (c.look.bag ? 1 : 0) + (c.look.headwear ? 2 : 0));
      if (blobs < CAP + PCAP && d < 70) { tmpQ.identity(); tmpM.compose(tmpP.set(x, y + .02, z), tmpQ, tmpS.set(.75, 1, .75)); kit.blobs.setMatrixAt(blobs++, tmpM); }
    }
    for (const k of kit.people) {
      const n = pc.get(k.kind) ?? 0; k.mesh.count = n;
      if (n) { k.mesh.instanceMatrix.needsUpdate = true; for (const a of Object.values(k.a)) a.needsUpdate = true; }
    }
    kit.blobs.count = blobs; kit.blobs.instanceMatrix.needsUpdate = true;
    audio.update(near, p.list, player, here);
  });

  return <group ref={root} name="city:life" visible={false}>
    {kit.classes.map(c => <group key={c.cls}><primitive object={c.bm}/><primitive object={c.gm}/></group>)}
    <primitive object={kit.wheels}/><primitive object={kit.blobs}/>
    {kit.people.map(p => <primitive key={p.kind} object={p.mesh}/>)}
    <primitive object={kit.street.stat}/><primitive object={kit.street.marks}/><primitive object={kit.street.lampMesh}/>
  </group>;
}
