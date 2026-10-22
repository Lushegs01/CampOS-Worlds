import { player } from '../state';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VEHICLE_SPAWNS, VEHICLE_TYPES } from '../../shared/vehicles.mjs';
import { vehicleVisuals, vehicleLift, tickVehicles } from '../vehicles/client';
import { surfaceHeight } from './layout';
import { buildVehicleModel, type VehicleType } from './vehicleModels';
import { registerMovingCaster } from './shadows';
import { freeze } from './rendering';
import { silenceVehicle, vehicleSound } from '../audio/vehicles';

function VehicleModel({ id, type }: { id: string; type: VehicleType }) {
  // Every part is static until it moves: a parked vehicle's forty-odd parts were re-composed every frame
  // (fourteen vehicles, over half the scene). Moving parts are updated below only when they change.
  const model = useMemo(() => { const m = buildVehicleModel(id, type); freeze(m.root); return m; }, [id, type]), group = useRef<THREE.Group>(null!);
  const motion = useRef({ speed: 0, accel: 0, yaw: 0, yawRate: 0, pitch: 0, roll: 0, brake: 0, x: NaN, z: NaN, placedYaw: NaN, lift: 0, placedLift: NaN, under: 0, liftX: NaN, liftZ: NaN, liftYaw: NaN });
  useEffect(() => () => model.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.geometry.name) m.geometry.dispose(); }), [model]);
  useEffect(() => registerMovingCaster(model.root), [model]);
  useEffect(() => () => silenceVehicle(id), [id]);
  useFrame((_, raw) => {
    const v = vehicleVisuals.get(id); if (!v) return;
    const dt = Math.min(Math.max(raw, 1e-3), .1), m = motion.current;
    const visible = Math.hypot(v.x - player.x, v.z - player.z) < 320, g = group.current; g.visible = visible;
    // Off the road a vehicle crosses paving, sidewalks and kerbs: it rides on the highest surface under its wheels.
    // Measured again only when the vehicle has moved, without allocating: fourteen vehicles, every frame.
    if (visible) {
      if (v.x !== m.liftX || v.z !== m.liftZ || v.yaw !== m.liftYaw) {
        const t = VEHICLE_TYPES[type], c = Math.cos(v.yaw), sn = Math.sin(v.yaw); let under = -Infinity;
        for (let s = -1; s <= 1; s += 2) for (let f = -1; f <= 1; f += 2) { const x = s * t.width * .4, z = f * t.wheelbase / 2; under = Math.max(under, surfaceHeight(v.x + x * c + z * sn, v.z - x * sn + z * c)); }
        m.under = under; m.liftX = v.x; m.liftZ = v.z; m.liftYaw = v.yaw;
      }
      if (m.lift !== m.under) { m.lift = Math.abs(m.under - m.lift) < 1e-4 ? m.under : THREE.MathUtils.damp(m.lift, m.under, 14, dt); vehicleLift.set(id, m.lift); }
    }
    if (v.x !== m.x || v.z !== m.z || v.yaw !== m.placedYaw || Math.abs(m.lift - m.placedLift) > 1e-3) { m.x = v.x; m.z = v.z; m.placedYaw = v.yaw; m.placedLift = m.lift; g.position.set(v.x, m.lift, v.z); g.rotation.y = v.yaw; g.updateMatrix(); }
    vehicleSound(id, type, v, m.accel * Math.sign(v.speed || 1), v.occupants);
    if (!visible) { m.speed = v.speed; m.yaw = v.yaw; return; }
    // Body motion on the suspension: squat and dive under acceleration, lean into turns.
    const accel = (v.speed - m.speed) / dt, yawRate = Math.atan2(Math.sin(v.yaw - m.yaw), Math.cos(v.yaw - m.yaw)) / dt;
    m.accel = THREE.MathUtils.damp(m.accel, THREE.MathUtils.clamp(accel, -12, 12), 6, dt); m.yawRate = THREE.MathUtils.damp(m.yawRate, yawRate, 6, dt);
    m.speed = v.speed; m.yaw = v.yaw;
    const soft = type === 'shuttle' ? 1.4 : type === 'cart' ? .7 : 1;
    m.pitch = THREE.MathUtils.damp(m.pitch, THREE.MathUtils.clamp(-m.accel * .0045 * soft, -.03, .03), 5, dt);
    m.roll = THREE.MathUtils.damp(m.roll, THREE.MathUtils.clamp(-v.speed * m.yawRate * .006 * soft, -.045, .045), 5, dt);
    turn(model.body, 'x', m.pitch); turn(model.body, 'z', m.roll);
    for (const w of model.wheels) { turn(w.pivot, 'y', w.front ? v.steering : 0); turn(w.spin, 'x', v.wheel * .32 / model.radius); }
    // Brake lamps light while slowing (or held stationary with a driver aboard); reverse lamps while backing.
    const driven = !!v.occupants[0], braking = (m.accel * Math.sign(v.speed) < -1.2 && Math.abs(v.speed) > .2) || (driven && Math.abs(v.speed) < .05);
    m.brake = THREE.MathUtils.damp(m.brake, braking ? 1 : 0, 14, dt);
    model.tail.emissiveIntensity = .25 + m.brake * 2.4; model.reverse.emissiveIntensity = v.speed < -.1 ? 1.6 : 0;
  });
  return <group ref={group} name={`vehicle:${id}`} matrixAutoUpdate={false}><primitive object={model.root} /></group>;
}
/** Rotate a part only when the angle visibly changed (its matrix is composed by hand: see above); the damped
 * suspension otherwise kept creeping towards rest for minutes. */
function turn(o: THREE.Object3D, axis: 'x' | 'y' | 'z', angle: number) { if (Math.abs(o.rotation[axis] - angle) > 1e-5) { o.rotation[axis] = angle; o.updateMatrix(); } }

export default function Vehicles() {
  useFrame((_, raw) => tickVehicles(Math.min(raw, .25)), -2);
  return <>{VEHICLE_SPAWNS.map(v => <VehicleModel key={v.id} id={v.id} type={v.type as VehicleType} />)}</>;
}
