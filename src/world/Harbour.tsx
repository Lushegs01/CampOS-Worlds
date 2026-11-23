import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HARBOUR, HARBOUR_BLOCKS, HARBOUR_BUILDINGS, HARBOUR_NODES, HARBOUR_PARKING, inHarbour } from '../../shared/harbour-local.mjs';
import { METRO_SHIFT } from '../../shared/metro.mjs';
import { player, roomPlayback, useGame } from '../state';
import Avatar, { type AvatarMotion } from '../avatar/Avatar';
import { AvatarBoundary } from '../avatar/AvatarBoundary';
import { MeshAsset } from '../mission/meshAsset';
import { Kit } from './architecture/kit';
import { sign } from './architecture/signage';
import type { Materials } from './materials';
import { HERO_BLOCK, HERO_BUILDING, HERO_CLIP, HeroBank, HeroStreet } from './heroSlice';

const box = new THREE.BoxGeometry();
const fallback = new THREE.MeshStandardMaterial({ color: '#9a9180', roughness: .82 });
const glass = new THREE.MeshStandardMaterial({ color: '#253941', roughness: .17, metalness: .28, envMapIntensity: 1.1 });
const shopGlass = new THREE.MeshPhysicalMaterial({color:'#a0bec0',roughness:.19,metalness:.18,transparent:true,opacity:.36,depthWrite:false,clearcoat:.55,envMapIntensity:1.3});
const glow = new THREE.MeshStandardMaterial({ color: '#bc925a', emissive: '#af7332', emissiveIntensity: .48, roughness: .62 });
const signal = {
  red: new THREE.MeshStandardMaterial({ color: '#602c27', emissive: '#ff3b27', emissiveIntensity: .95 }),
  green: new THREE.MeshStandardMaterial({ color: '#315c45', emissive: '#39ed8e', emissiveIntensity: .95 }),
  off: new THREE.MeshStandardMaterial({ color: '#182522', roughness: .6 }),
};
const storefronts = ['#244c41', '#672f24', '#24394d'];
const cast = ['amara', 'tunde', 'ngozi', 'kelechi', 'zainab', 'ibrahim', 'ada', 'chidi', 'mel'];

function Parcel({ data, lib, low }: { data: typeof HARBOUR_BLOCKS[number]; lib: Materials; low: boolean }) {
  // The Commercial District hero slice replaces one building of block-0-1 with its own model (./heroSlice.tsx).
  const hero = data.id === HERO_BLOCK;
  const buildings = HARBOUR_BUILDINGS.filter(b => b.block === data.id && b.id !== HERO_BUILDING);
  const surfaces = useMemo(() => ({
    paversGrey: lib.paversGrey, concrete: lib.concrete, stucco: lib.stuccoCream, brick: lib.brick,
    roof: lib.roofGreen, glass, shopGlass, aluminium: lib.aluminium, darkSteel: lib.darkMetal, shopGlow: glow,
  }), [lib]);
  const signs = useMemo(() => buildings.map(b => {
    const board = sign({ text: b.name.toUpperCase(), kind: 'panel', width: 6.5, height: .39, background: storefronts[b.style], color: '#f5eddb', tracking: .065 });
    board.position.set(b.x, 3.6, b.z + b.front * (b.d / 2 + .2));
    board.rotation.y = b.front === 1 ? 0 : Math.PI;
    return board;
  // Changes to the shared layout require a new application revision.
  }), [data]);
  useEffect(() => () => signs.forEach(o => { o.geometry.dispose(); o.material.dispose(); }), [signs]);
  return <group name={'harbour:' + data.id}>
    <MeshAsset file={`harbour/${data.id}.glb`} surfaces={surfaces} cast={!low} clip={hero ? HERO_CLIP : undefined}>
      <mesh geometry={box} material={lib.paversGrey} position={[data.x,.063,data.z]} scale={[data.w,.124,data.d]} dispose={null} receiveShadow/>
      {buildings.map(b => <mesh key={b.id} geometry={box} material={fallback} position={[b.x,b.h/2,b.z]} scale={[b.w,b.h,b.d]} dispose={null} castShadow receiveShadow/>)}
    </MeshAsset>
    {signs.map(o => <primitive key={o.name} object={o}/>)}
    {hero && <><HeroBank lib={lib} low={low}/><HeroStreet lib={lib} low={low}/></>}
  </group>;
}

function StreetDetail({ lib }: { lib: Materials }) {
  const detail = useMemo(() => {
    const kit = new Kit();
    kit.box('asphalt', [(HARBOUR.x0 + HARBOUR.x1)/2, .006, (HARBOUR.z0 + HARBOUR.z1)/2],
      [HARBOUR.x1-HARBOUR.x0, .017, HARBOUR.z1-HARBOUR.z0], {shadow:false});
    for (const {x,z} of HARBOUR_NODES.filter(n => n.z > -50)) {
      for (let stripe = -3.1; stripe < 3.3; stripe += .93) {
        for (const end of [-1,1]) {
          kit.box('lineWhite',[x+stripe,.045,z+end*7.5],[.51,.005,2.5],{shadow:false});
          kit.box('lineWhite',[x+end*7.5,.045,z+stripe],[2.5,.005,.51],{shadow:false});
        }
      }
    }
    for (const b of HARBOUR_BLOCKS) {
      for(const side of [-1,1]){
        const x=b.x+(side<0?-16:16),z=b.z+b.d/2-1.3;
        kit.box('concrete',[x,.23,z],[1.65,.215,1.42]);
        kit.box('soil',[x,.343,z],[1.38,.018,1.18],{shadow:false});
      }
      for (const side of [-1,1]) for (const step of [-10,10]) {
        const x = b.x+step, z = b.z+side*(b.d/2-1.02);
        kit.box('concrete',[x,.35,z],[1.9,.44,.78]);
        kit.box('soil',[x,.577,z],[1.75,.032,.63],{shadow:false});
        kit.box('paintDark',[x,.96,z],[1.48,.62,.16]);
        kit.box('paintDark',[x,.685,z+side*.11],[1.48,.09,.37]);
      }
      for (let x=b.x-17; x<b.x+20; x+=11) {
        const z=b.z+b.d/2+.51;
        kit.box('darkMetal',[x,.045,z],[.68,.018,.39],{shadow:false});
        for(let strip=-2;strip<=2;strip++)kit.box('steel',[x+strip*.1,.054,z],[.035,.012,.34],{shadow:false});
      }
    }
    for (const v of HARBOUR_PARKING) {
      for (const side of [-1,1])kit.box('lineWhite',[v.x+side*1.6,.131,v.z],[.09,.007,5.6],{shadow:false});
      kit.box('lineWhite',[v.x,.131,v.z+2.79],[3.2,.007,.09],{shadow:false});
    }
    return kit.build(lib,'harbour:street-markings');
  }, [lib]);
  useEffect(() => () => detail.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }), [detail]);
  return <primitive object={detail}/>;
}

function Signal({ x, z, heading }: { x: number; z: number; heading: number }) {
  const red = useRef<THREE.Mesh>(null!), green = useRef<THREE.Mesh>(null!);
  useFrame(({clock}) => {
    const go = Math.floor(clock.elapsedTime/13+heading)%2 === 0;
    red.current.material = go ? signal.off : signal.red;
    green.current.material = go ? signal.green : signal.off;
  });
  return <group position={[x,.125,z]} rotation-y={heading} dispose={null}>
    <mesh geometry={box} material={fallback} position={[0,1.62,0]} scale={[.13,3.24,.13]} castShadow/>
    <mesh geometry={box} material={signal.off} position={[0,2.99,.12]} scale={[.3,.64,.25]}/>
    <mesh ref={red} geometry={box} material={signal.red} position={[0,3.13,.255]} scale={[.14,.14,.04]}/>
    <mesh ref={green} geometry={box} material={signal.off} position={[0,2.83,.255]} scale={[.14,.14,.04]}/>
  </group>;
}

function Pedestrian({ block, index }: { block: typeof HARBOUR_BLOCKS[number]; index: number }) {
  const root = useRef<THREE.Group>(null!);
  const motion = useRef<AvatarMotion>({ speed: 0, y: 0, vy: 0, turn: 0 });
  const config = useMemo(() => ({model: cast[index], skin:'natural',accent:['#505b55','#6f5c49','#495978'][index%3],accessory:'none'}),[index]);
  useFrame(() => {
    const now = performance.now();
    const phase = ((roomPlayback.time(now) ?? now)/1000 + index*7.3) % 74;
    const from = block.x - 18, split = 36;
    const step = phase <= 36 ? phase : phase < 38 ? 36 : Math.max(0, 74-phase);
    const facing = phase <= 37 ? Math.PI/2 : -Math.PI/2;
    root.current.position.set(from + step, .125, block.z + block.d/2 - 3.05);
    root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, facing, .16);
    motion.current.speed = phase > split && phase < 38 ? 0 : 1;
  });
  return <group ref={root} name={`harbour:pedestrian:${index}`}><AvatarBoundary accent={config.accent}>
    <Suspense fallback={null}><Avatar config={config} id={`harbour-pedestrian-${index}`} motion={() => motion.current}/></Suspense>
  </AvatarBoundary></group>;
}

export default function HarbourDistrict({ lib }: { lib: Materials }) {
  const quality = useGame(s => s.quality);
  const [visible, setVisible] = useState(-1);
  const active = useRef(-1), check = useRef(0);
  useFrame((_,dt) => {
    check.current -= dt;
    if (check.current > 0) return;
    check.current = .3;
    // (Local frame: the Exchange was authored beside the old campus hub and is drawn shifted into the city.)
    const x = player.x - METRO_SHIFT.x, z = player.z - METRO_SHIFT.z;
    const range = quality === 'low' ? 100 : 175;
    const bits = inHarbour(x,z,range) ? HARBOUR_BLOCKS.reduce((mask,b,i) =>
      Math.hypot(b.x-x,b.z-z) < range + ((active.current & (1<<i)) ? 20 : 0) ? mask | 1<<i : mask, 0) : 0;
    if (bits !== active.current) { active.current = bits; setVisible(bits); }
  });
  if (visible <= 0) return null;
  return <group name="harbour:district" position={[METRO_SHIFT.x, 0, METRO_SHIFT.z]}>
    <StreetDetail lib={lib}/>
    {HARBOUR_BLOCKS.map((b,i) => (visible & (1<<i)) ? <Parcel key={b.id} data={b} lib={lib} low={quality === 'low'}/> : null)}
    {HARBOUR_NODES.filter(n => n.z > -1).map(n => <Signal key={n.id} x={n.x+5.2} z={n.z-5.2} heading={n.z > 10 ? Math.PI/2 : 0}/>)}
    {HARBOUR_BLOCKS.map((b,i) => (visible & (1<<i)) && (quality !== 'low' || i%3===1) ? <Pedestrian key={b.id} block={b} index={i}/> : null)}
  </group>;
}
