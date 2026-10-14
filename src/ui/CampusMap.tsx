import { useEffect, useState } from 'react';
import { ArrowUpRight, Navigation } from 'lucide-react';
import { LOCATIONS } from '../../shared/campus.mjs';
import { BUILDINGS, DISTRICTS, ROADS, PARKING, STOPS, roadRoute, EXPANSION_PATHS, COURTYARD_PARKING } from '../../shared/expansion.mjs';
import { livePeers, player, useGame } from '../state';
import { bond, useSocial } from '../social/store';
import { useVehicle, vehicleVisuals } from '../vehicles/client';
export function MapGraphic({mini=false,overview=false}:{mini?:boolean;overview?:boolean}){
 const [,refresh]=useState(0);useEffect(()=>{const t=setInterval(()=>refresh(n=>n+1),300);return()=>clearInterval(t);},[]);
 const destination=useGame(s=>s.destination),vehicle=useVehicle(s=>s.id),party=useSocial(s=>s.party),friends=useSocial(s=>s.overview),wide=overview;
 // A followed player (a friend or party member) is a moving destination.
 const follow=destination?.startsWith('peer:')?livePeers.get(destination.slice(5)):null,loc=follow?{x:follow.x,z:follow.z}:LOCATIONS.find(l=>l.id===destination);
 const span=mini?(vehicle?300:120):wide?2900:220,cx=wide?0:player.x,cz=wide?0:player.z,scale=span/144;
 const route=loc&&(Math.abs(player.x)>75||Math.abs(player.z)>65||Math.abs(loc.x)>75||Math.abs(loc.z)>65)?roadRoute(player,loc):null;
 return <svg viewBox={`${cx-span/2} ${cz-span/2} ${span} ${span}`} role="img" aria-label="Campus map with your position" className="map-graphic">
 <rect x={-1500} y={-1500} width={3000} height={3000} fill="#dce1c8"/>
 {DISTRICTS.map(d=><g key={d.id}><circle cx={d.x} cy={d.z-30} r={100} fill={d.color} opacity=".22"/>{wide&&<text className="map-district" x={d.x} y={d.z-120} textAnchor="middle">{d.name}</text>}</g>)}
 {ROADS.map(r=><path key={r.id} d={`M${r.a.x} ${r.a.z}L${r.b.x} ${r.b.z}`} fill="none" stroke="#9aab97" strokeWidth={wide?Math.max(r.width,12):r.width} strokeLinecap="square"/>)}
 {[...PARKING,{...COURTYARD_PARKING,id:'courtyard'}].map(p=><g key={p.id}><rect x={p.x-p.w/2} y={p.z-p.d/2} width={p.w} height={p.d} fill="#9aab97"/><text x={p.x} y={p.z+2} fontSize={wide?18:5} fill="#304f40">P</text></g>)}
 {STOPS.map(p=><circle key={p.id} cx={p.x} cy={p.z} r={wide?8:2} fill="#4b7298"/>)}
 {EXPANSION_PATHS.map((p,i)=><rect key={i} x={p.x-p.w/2} y={p.z-p.d/2} width={p.w} height={p.d} fill="#f3ecd8"/>)}
 <path d="M0 50V11M0 -11V-33M-49 10H32M-30 0H30M-30 26H0" stroke="#f3ecd8" strokeWidth="7" fill="none"/><circle r="12" fill="#eee4cb"/><circle r="5" fill="#a7c4b0"/>
 <g fill="#829989" stroke="#f4efdd" strokeWidth=".6"><rect x="-42" y="-26" width="24" height="22"/><rect x="18" y="-20" width="25" height="18"/><rect x="-16" y="-51" width="32" height="17"/><rect x="-62" y="-54" width="20" height="17"/><rect x="31" y="-52" width="22" height="18"/><rect x="33" y="9" width="22" height="30" fill="#b18b6d"/>{BUILDINGS.map(b=><rect key={b.id} x={b.x-b.w/2} y={b.z-b.d/2} width={b.w} height={b.d}/>)}</g>
 {route&&<polyline points={route.points.map(p=>`${p.x},${p.z}`).join(' ')} fill="none" stroke="#bb7b32" strokeWidth={Math.max(1,scale*1.4)} strokeDasharray={`${scale*3} ${scale*2}`}/>}
 {[...vehicleVisuals.values()].map(v=><rect key={v.id} x={v.x-1.2*scale} y={v.z-1.8*scale} width={2.4*scale} height={3.6*scale} rx={.4*scale} fill={vehicle===v.id?'#cd8636':'#496d7d'} transform={`rotate(${-v.yaw*180/Math.PI},${v.x},${v.z})`}/>)}
 {LOCATIONS.map((l,i)=><g key={l.id} onClick={()=>!mini&&useGame.getState().set({destination:l.id})} className={!mini?'map-pin':''}><circle cx={l.x} cy={l.z} r={(destination===l.id?3:2)*scale} fill={destination===l.id?'#ba7c3d':'#304f40'} stroke="#f7efd9" strokeWidth={scale*.6}/>{!mini&&!wide&&<text x={l.x} y={l.z+scale} textAnchor="middle" fill="white" fontSize={2.5*scale}>{i+1}</text>}</g>)}
 {[...livePeers.values()].map(p=>{const k=bond({party,overview:friends},p.id,p.handle);return k?<circle key={p.id} cx={p.x} cy={p.z} r={(k==='party'?2.4:2)*scale} fill={k==='party'?'#d9a441':'#4d8aa3'} stroke="#fff8e6" strokeWidth={scale*.5}><title>{p.name}</title></circle>:null;})}
 <g transform={`translate(${player.x},${player.z}) rotate(${180-player.yaw*180/Math.PI}) scale(${scale})`}><circle r="4" fill="#f5c571" opacity=".45"/><path d="M0 -3L2 2L0 1L-2 2Z" fill="#f8b64c" stroke="#614929" strokeWidth=".5"/></g></svg>;
}
export default function CampusMap(){const {destination,discovered,set}=useGame(),[overview,show]=useState(true),loc=LOCATIONS.find(l=>l.id===destination);const route=loc?roadRoute(player,loc):null;return <><div className="map-options"><button onClick={()=>show(true)}>University</button><button onClick={()=>show(false)}>Nearby streets</button></div>{loc&&route&&<p className="navigation-distance">{loc.name} · {Math.round(Math.hypot(loc.x-player.x,loc.z-player.z))} m away · {Math.round(route.distance)} m along highlighted roads. Walk from the nearest stop to the entrance.</p>}<div className="map-layout"><div className="large-map"><MapGraphic overview={overview}/><span className="map-north">N ↑</span><div className="map-legend">Gold: you / selected place · Amber dots: your party · Teal dots: friends · Blue: shuttle stops · P: parking</div></div><div className="location-list">{LOCATIONS.map((l,i)=><button key={l.id} className={destination===l.id?'selected':''} onClick={()=>{set({destination:l.id,panel:null});useGame.getState().notify('Destination: '+l.name+'. Follow campus roads on the map.');}}><span className="location-number">{i+1}</span><span><b>{l.name}</b><small>{l.type}{discovered.includes(l.id)?' · Discovered':''}</small></span>{destination===l.id?<Navigation size={17}/>:<ArrowUpRight size={17}/>}</button>)}</div></div></>;}
