import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BARREL, O, inDistrict, isGetawayVehicle } from '../../shared/getaway.mjs';
import { localPoint, VEHICLE_TYPES } from '../../shared/vehicles.mjs';
import { Effects } from '../arena/scene/fx';
import { currentVehicle, driving, missionVehicleInfo } from '../vehicles/client';
import { useGame } from '../state';
import { surfaceHeight } from '../world/layout';
import { onMissionEvent, useGetaway } from './client';
import { missionSound, stopMissionSound, tickMissionSound } from './sound';

function groundAt(x: number, _y: number, z: number) {
  return Math.max(inDistrict(x, z) ? .022 : 0, surfaceHeight(x, z));
}

function skidTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, c.width, 0);
  for (const [at, alpha] of [[0, 0], [.14, .55], [.38, .84], [.64, .76], [.87, .47], [1, 0]]) {
    grad.addColorStop(at, `rgba(255,255,255,${alpha})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  ctx.globalCompositeOperation = 'destination-in';
  const cap = ctx.createLinearGradient(0, 0, 0, 64);
  for (const [at, alpha] of [[0, 0], [.18, 1], [.82, 1], [1, 0]]) cap.addColorStop(at, `rgba(255,255,255,${alpha})`);
  ctx.fillStyle = cap;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class Skids {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private cursor = 0;
  private drawn = 0;
  private dummy = new THREE.Object3D();
  constructor(private size: number) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: '#242323', transparent: true, opacity: .48, map: skidTexture(),
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
    this.mesh = new THREE.InstancedMesh(geometry, material, size);
    this.mesh.name = 'getaway:tyre-tracks';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  add(x: number, z: number, yaw: number, width: number, length: number) {
    const centre = this.dummy;
    centre.position.set(x, groundAt(x, 0, z) + .011, z);
    centre.rotation.y = yaw;
    centre.scale.set(width, 1, length);
    centre.updateMatrix();
    this.mesh.setMatrixAt(this.cursor, centre.matrix);
    this.cursor = (this.cursor + 1) % this.size;
    this.drawn = Math.min(this.drawn + 1, this.size);
    this.mesh.count = this.drawn;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.map?.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

function ActiveEffects() {
  const low = useGame(s => s.quality === 'low');
  const reduced = useGame(s => s.reducedMotion);
  const fx = useMemo(() => new Effects(low ? .36 : .75, low ? 12 : 36, {
    smoke: low ? 64 : 118, glow: low ? 36 : 72, tracers: low ? 6 : 12,
    light: !low && !reduced, groundAt,
  }), [low, reduced]);
  const skids = useMemo(() => new Skids(low ? 28 : 64), [low]);
  const at = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);
  const vector = useMemo(() => new THREE.Vector3(), []);
  const motion = useRef({ id: '', speed: 0, x: 0, z: 0, next: 0, smokeAt: 0, fireAt: -Infinity, fireNext: 0 });
  useEffect(() => {
    fx.group.name = 'getaway:effects';
    fx.setAmbient(.9);
    return () => fx.dispose();
  }, [fx]);
  useEffect(() => () => skids.dispose(), [skids]);
  useEffect(() => onMissionEvent(e => {
    const now = performance.now() / 1000;
    at.set(e.x, e.y, e.z);
    if (e.end) {
      end.fromArray(e.end);
      vector.subVectors(end, at).normalize();
      const hostile = e.kind === 'enemyShot';
      if (hostile) fx.muzzle(at, vector);
      if (!reduced && (hostile || e.weapon !== 'sparrow' || e.id % 3 === 0)) {
        at.addScaledVector(vector, .4);
        fx.tracer(at, end);
      }
      if (e.impact && e.surface !== 'actor') {
        if (e.normal) vector.fromArray(e.normal).normalize();
        else vector.negate();
        if (vector.y > .9 && end.y < .04) end.y = groundAt(end.x, end.y, end.z);
        fx.impact(end, vector, e.surface ?? 'concrete');
      }
    } else if (e.kind === 'blast') {
      fx.explosion(at, 3.4);
      motion.current.fireAt = now;
      motion.current.fireNext = now;
    } else if (e.kind === 'crash' && !reduced) {
      fx.impact(at.setY(groundAt(e.x, e.y, e.z) + .34), vector.set(0, 1, 0), 'metal');
    }
  }), [at, end, fx, reduced, vector]);

  useFrame((_, raw) => {
    const dt = Math.min(.11, raw);
    const now = performance.now() / 1000;
    const m = motion.current, v = currentVehicle();
    if (now - m.fireAt < 6.4 && now >= m.fireNext) {
      m.fireNext = now + (low ? .34 : .17);
      fx.exhaust(at.set(BARREL.x + Math.sin(now * 3) * .19, .1, BARREL.z), !reduced && now - m.fireAt < 4.4);
    }
    if (v && isGetawayVehicle(v.id)) {
      if (m.id !== v.id) {
        m.id = v.id;
        m.speed = v.speed;
        m.x = v.x;
        m.z = v.z;
      }
      const speed = Math.abs(v.speed), previous = Math.abs(m.speed);
      const travel = Math.hypot(v.x - m.x, v.z - m.z);
      const braking = driving.brake && previous - speed > .13;
      const sliding = speed * Math.abs(v.steering) > 3.5;
      if ((braking || sliding) && Math.max(speed, previous) > 6 && travel > .12 && travel < 4 && now >= m.next) {
        m.next = now + (low ? .095 : .055);
        const t = VEHICLE_TYPES[v.type], heading = Math.atan2(v.x - m.x, v.z - m.z);
        const length = Math.min(2.4, Math.max(.24, travel * 1.45));
        for (const side of [-1, 1]) {
          const tyre = localPoint(v, side * t.width * .424, -t.wheelbase / 2);
          skids.add(tyre.x, tyre.z, heading, t.width * .116, length);
          if (!reduced) fx.tyreSmoke(at.set(tyre.x, groundAt(tyre.x, 0, tyre.z) + .09, tyre.z), vector.set(-Math.sin(heading), 0, -Math.cos(heading)));
        }
      }
      const condition = missionVehicleInfo(v.id)?.condition ?? 100;
      if (condition < 46 && now >= m.smokeAt) {
        m.smokeAt = now + (low ? .35 : .16);
        const hood = localPoint(v, 0, VEHICLE_TYPES[v.type].length * .34);
        fx.exhaust(at.set(hood.x, groundAt(hood.x, 0, hood.z) + VEHICLE_TYPES[v.type].height * .53, hood.z), condition < 13 && !reduced);
      }
      m.speed = v.speed;
      m.x = v.x;
      m.z = v.z;
    } else m.id = '';
    fx.update(dt);
  });
  return <><primitive object={fx.group}/><primitive object={skids.mesh}/></>;
}

export default function GetawayEffects({ stage }: { stage: number | null }) {
  useEffect(() => {
    const unsubscribe = onMissionEvent(missionSound);
    return () => { unsubscribe(); stopMissionSound(); };
  }, []);
  useFrame(() => tickMissionSound(useGetaway.getState().mission));
  return stage !== null && stage < O.complete ? <ActiveEffects/> : null;
}
