import { useVehicle, vehicleInteract, vehicleAction } from '../vehicles/client';
import { useEffect, useRef } from 'react';
import { ArrowUp } from 'lucide-react';
import { input, useGame } from '../state';
import { TouchInteract } from './Interaction';
import { useInteraction } from '../interaction/world';

export default function TouchControls() {
  const vehicle=useVehicle(s=>s.id),nearVehicle=useVehicle(s=>s.near);
  const held=useRef(new Set<string>());
  const drive=(key:string,on:boolean)=>{if(on)held.current.add(key);else held.current.delete(key);input.x=Number(held.current.has('right'))-Number(held.current.has('left'));input.z=Number(held.current.has('reverse'))-Number(held.current.has('accelerate'));};
  const phase = useGame(s => s.phase), panel = useGame(s => s.panel);
  const ball = useInteraction(v => v.ball), seated = useInteraction(v => v.seat);
  const knob = useRef<HTMLSpanElement>(null), origin = useRef({ x: 0, y: 0 }), camera = useRef({ x: 0, y: 0 });
  const movePointer = useRef<number | null>(null), lookPointer = useRef<number | null>(null);
  const release = () => { input.x = input.z = 0; movePointer.current = null; if (knob.current) knob.current.style.transform = 'translate(0, 0)'; };
  useEffect(() => {
    const reset = () => { held.current.clear(); release(); input.jump = false; lookPointer.current = null; };
    window.addEventListener('blur', reset); document.addEventListener('visibilitychange', reset);
    reset();
    return () => { reset(); window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', reset); };
  }, [phase, panel, vehicle]);
  if (phase !== 'playing' || panel) return null;
  return <div className="touch-controls">
    <div className="touch-look" aria-label="Drag to look around"
      onPointerDown={e => { if (lookPointer.current !== null) return; lookPointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); camera.current = { x: e.clientX, y: e.clientY }; }}
      onPointerMove={e => { if (lookPointer.current !== e.pointerId) return; input.yaw -= (e.clientX - camera.current.x) * .006; input.pitch = Math.max(-.12, Math.min(.95, input.pitch + (e.clientY - camera.current.y) * .004)); camera.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={() => { lookPointer.current = null; }} onPointerCancel={() => { lookPointer.current = null; }} onLostPointerCapture={() => { lookPointer.current = null; }} />
    {vehicle?<div className="driving-touch">{[['left','Steer left','←'],['right','Steer right','→'],['reverse','Brake and reverse','Brake / R'],['accelerate','Accelerate','Go']].map(([key,label,text])=><button key={key} aria-label={label} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drive(key,true);}} onPointerUp={()=>drive(key,false)} onPointerCancel={()=>drive(key,false)} onLostPointerCapture={()=>drive(key,false)}>{text}</button>)}</div>:<div className="joystick" role="group" aria-label="Movement joystick"
      onPointerDown={e => { if (movePointer.current !== null) return; movePointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); origin.current = { x: e.clientX, y: e.clientY }; }}
      onPointerMove={e => {
        if (movePointer.current !== e.pointerId) return;
        const x = e.clientX - origin.current.x, y = e.clientY - origin.current.y, length = Math.hypot(x, y), d = Math.max(1, length / 35);
        input.x = length < 4 ? 0 : x / d / 35; input.z = length < 4 ? 0 : y / d / 35;
        // Pointer events bypass React reconciliation while steering.
        if (knob.current) knob.current.style.transform = `translate(${x / d}px, ${y / d}px)`;
      }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}><span ref={knob} /></div>}
    <div className="touch-actions">{vehicle||nearVehicle?<button onClick={vehicleInteract} aria-label={vehicle?'Exit vehicle':'Enter vehicle'}>{vehicle?'Exit':'Enter'}</button>:<TouchInteract />}{vehicle&&<button onClick={()=>vehicleAction('vehicleRecover')}>Recover</button>}{!vehicle && !ball && !seated && <button aria-label="Jump" onPointerDown={() => { input.jump = true; }}><ArrowUp size={20} /><span>Jump</span></button>}</div>
  </div>;
}
