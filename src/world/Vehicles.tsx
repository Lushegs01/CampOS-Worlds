import { player } from '../state';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { VEHICLE_SPAWNS } from '../../shared/vehicles.mjs';
import { vehicleVisuals, tickVehicles } from '../vehicles/client';
import { buildVehicleModel, type VehicleType } from './vehicleModels';

function VehicleModel({ id, type }: { id: string; type: VehicleType }) {
  const model = useMemo(() => buildVehicleModel(id, type), [id, type]), group = useRef<THREE.Group>(null!);
  const motion = useRef({ speed: 0, accel: 0, yaw: 0, yawRate: 0, pitch: 0, roll: 0, brake: 0 });
  useEffect(() => () => model.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.geometry.name) m.geometry.dispose(); }), [model]);
  useFrame((_, raw) => {
    const v = vehicleVisuals.get(id); if (!v) return;
    const dt = Math.min(Math.max(raw, 1e-3), .1), m = motion.current;
    const visible = Math.hypot(v.x - player.x, v.z - player.z) < 320; group.current.visible = visible;
    group.current.position.set(v.x, 0, v.z); group.current.rotation.y = v.yaw;
    if (!visible) { m.speed = v.speed; m.yaw = v.yaw; return; }
    // Body motion on the suspension: squat and dive under acceleration, lean into turns.
    const accel = (v.speed - m.speed) / dt, yawRate = Math.atan2(Math.sin(v.yaw - m.yaw), Math.cos(v.yaw - m.yaw)) / dt;
    m.accel = THREE.MathUtils.damp(m.accel, THREE.MathUtils.clamp(accel, -12, 12), 6, dt); m.yawRate = THREE.MathUtils.damp(m.yawRate, yawRate, 6, dt);
    m.speed = v.speed; m.yaw = v.yaw;
    const soft = type === 'shuttle' ? 1.4 : type === 'cart' ? .7 : 1;
    m.pitch = THREE.MathUtils.damp(m.pitch, THREE.MathUtils.clamp(-m.accel * .0045 * soft, -.03, .03), 5, dt);
    m.roll = THREE.MathUtils.damp(m.roll, THREE.MathUtils.clamp(-v.speed * m.yawRate * .006 * soft, -.045, .045), 5, dt);
    model.body.rotation.set(m.pitch, 0, m.roll);
    for (const w of model.wheels) { w.pivot.rotation.y = w.front ? v.steering : 0; w.spin.rotation.x = v.wheel * .32 / model.radius; }
    // Brake lamps light while slowing (or held stationary with a driver aboard); reverse lamps while backing.
    const driven = !!v.occupants[0], braking = (m.accel * Math.sign(v.speed) < -1.2 && Math.abs(v.speed) > .2) || (driven && Math.abs(v.speed) < .05);
    m.brake = THREE.MathUtils.damp(m.brake, braking ? 1 : 0, 14, dt);
    model.tail.emissiveIntensity = .25 + m.brake * 2.4; model.reverse.emissiveIntensity = v.speed < -.1 ? 1.6 : 0;
  });
  return <group ref={group} name={`vehicle:${id}`}><primitive object={model.root} /></group>;
}

export default function Vehicles() {
  useFrame((_, raw) => tickVehicles(Math.min(raw, .25)), -2);
  return <>{VEHICLE_SPAWNS.map(v => <VehicleModel key={v.id} id={v.id} type={v.type as VehicleType} />)}</>;
}
