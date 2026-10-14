import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CarFront } from 'lucide-react';
import { useVehicle, currentVehicle, vehicleInteract, vehicleAction } from '../vehicles/client';
import { VEHICLE_TYPES } from '../../shared/vehicles.mjs';
import { useGame } from '../state';
/** Shown while aboard a vehicle; entering is offered by the normal interaction prompt at a door. */
export default function VehicleHUD(){const s=useVehicle(useShallow(v=>({id:v.id,seat:v.seat}))),panel=useGame(s=>s.panel),[,update]=useState(0);
 // The speed readout refreshes only while aboard (it re-rendered 15 times a second on every vehicle snapshot before).
 useEffect(()=>{if(!s.id)return;const t=setInterval(()=>update(n=>n+1),150);return()=>clearInterval(t);},[s.id]);const v=currentVehicle();if(!v||!s.id||panel)return null;const t=VEHICLE_TYPES[v.type];return <section className="vehicle-hud" aria-label="Vehicle controls"><CarFront size={22}/><div><b>{t.name}</b><small>{`${s.seat===0?'Driver':'Passenger'} · ${v.occupants.filter(Boolean).length}/${v.occupants.length} aboard`}</small></div><strong>{Math.round(Math.abs(v.speed)*3.6)}<small>km/h</small></strong><button onClick={vehicleInteract}><kbd>E</kbd> Exit vehicle</button>{s.seat===0&&<button onClick={()=>vehicleAction('vehicleRecover')} aria-label="Recover vehicle">Recover</button>}<small className="driving-hint">{s.seat===0?'W/S · accelerate & reverse　A/D · steer　Space · brake':'Enjoy the ride · E to get out when stopped'}</small></section>;}
