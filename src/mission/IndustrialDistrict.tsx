import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CONTACT, INDUSTRIAL_SOLIDS, inDistrict } from '../../shared/getaway.mjs';
import { player, useGame } from '../state';
import { sign } from '../world/architecture/signage';
import { weather, type Materials } from '../world/materials';
import { MeshAsset, type XYZ } from './meshAsset';

const ORIGIN: XYZ = [191, 0, 12.5];
const SHADOW = { castShadow: true, receiveShadow: true };
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_FLOOR = new THREE.PlaneGeometry(1, 1);
const FALLBACK_STEEL = new THREE.MeshStandardMaterial({ color: '#586665', roughness: .74, metalness: .18 });
const FALLBACK_BOX = new THREE.MeshStandardMaterial({ color: '#77674f', roughness: .87 });

function FallbackBox({ at, size, material }: { at: XYZ; size: XYZ; material: THREE.Material }) {
  return <mesh position={at} scale={size} geometry={UNIT_BOX} material={material} dispose={null} {...SHADOW}/>;
}

function WarehouseFallback() {
  return <>
    {INDUSTRIAL_SOLIDS.filter(b => b.kind === 'wall' || b.kind === 'front').map(b =>
      <FallbackBox key={b.x + ':' + b.z} at={[b.x - ORIGIN[0], b.h / 2, b.z - ORIGIN[2]]}
        size={[b.w, b.h, b.d]} material={FALLBACK_STEEL}/>)}
    <FallbackBox at={[0, 7.05, 0]} size={[29.5, .18, 24]} material={FALLBACK_STEEL}/>
  </>;
}

function FreightSigns() {
  const boards = useMemo(() => {
    const put = (position: XYZ, text: string, lines: string[], width: number, height: number, background: string, yaw = 0) => {
      const mesh = sign({ text, lines, width, height, kind: 'panel', color: '#eadfc5', background, roughness: .79, tracking: .065 });
      mesh.position.set(...position);
      mesh.rotation.y = yaw;
      return mesh;
    };
    return [
      put([191, 5.83, 24.606], 'Orisun Freight', ['ORISUN FREIGHT', 'BAY 04  /  RECEIVING'], 8.37, .76, '#203430'),
      put([136.5, 1.68, 44.69], 'West gate', ['ORISUN FREIGHT', 'WEST GATE  /  STAFF ACCESS'], 3.22, .58, '#263732'),
      put([193.7, 3.45, 1.34], 'Sorting and dispatch', ['SORTING', 'DISPATCH  /  01–02'], 3.15, .59, '#313733'),
      put([196.62, 1.7, 24.35], 'Loading notice', ['CAUTION', 'LOADING AREA'], 1.15, .51, '#6d4a26'),
      put([217.4, 2.15, 30.62], 'Motor pool', ['MOTOR POOL', 'STAFF PARKING'], 1.44, .55, '#263734'),
      put([275.91, 3.2, -35], 'Maintenance', ['MAINTENANCE', 'SERVICE ACCESS'], 3.9, .63, '#303b39', -Math.PI / 2),
    ];
  }, []);
  useEffect(() => () => boards.forEach(board => { board.geometry.dispose(); board.material.dispose(); }), [boards]);
  return <>{boards.map(board => <primitive key={board.name} object={board}/>)}</>;
}

function useDistance(enabled: (x: number, z: number, active: boolean) => boolean) {
  const [active, setActive] = useState(false);
  const last = useRef(false);
  useFrame(() => {
    const next = enabled(player.x, player.z, last.current);
    if (next !== last.current) {
      last.current = next;
      setActive(next);
    }
  });
  return active;
}
const districtRange = (x: number, z: number, active: boolean) => inDistrict(x, z, active ? 110 : 92);
const lightingRange = (x: number, z: number, active: boolean) => Math.abs(x - 191) < (active ? 25 : 22) && z > -5 && z < (active ? 36 : 32);

// Two unshadowed practicals below the exported housings. Their finite reach keeps the loading apron daylight-lit.
function WarehouseLights({ detailed, low }: { detailed: boolean; low: boolean }) {
  const nearby = useDistance(lightingRange);
  if (!nearby || low) return null;
  return <>
    <pointLight position={[191, 5.65, 8]} color="#fff0d6" intensity={detailed ? 64 : 51} distance={11.6} decay={2}/>
    {detailed && <pointLight position={[191, 5.65, 17]} color="#ffe6c4" intensity={49} distance={10.8} decay={2}/>}
    <pointLight position={[182.9,4.2,3.3]} color="#cce0ed" intensity={33} distance={8} decay={2}/>
    <pointLight position={[199.1,3.55,2.45]} color="#ffd7a3" intensity={34} distance={7.4} decay={2}/>
  </>;
}

type Solid = typeof INDUSTRIAL_SOLIDS[number];
function FreightContainer({ solid, low, red }: { solid: Solid; low: boolean; red: boolean }) {
  const surfaces = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      color: red ? new THREE.Color(2.65, .72, .42) : new THREE.Color(.8, 1, 1.02),
      vertexColors: true, metalness: .29, roughness: .68,
    });
    return { 'Industrial coated surfaces': weather(material, { grime: .28, streaks: .55, macro: .2 }) };
  }, [red]);
  useEffect(() => () => surfaces['Industrial coated surfaces'].dispose(), [surfaces]);
  const { w, d, h } = solid, long = w >= d;
  const fit: XYZ = [Math.max(w, d), h, Math.min(w, d)];
  return <group rotation-y={long ? 0 : Math.PI / 2}>
    <MeshAsset file={`getaway/freightContainer${low ? 'Low' : ''}.glb`} fit={fit} surfaces={surfaces}>
      <FallbackBox at={[0, h / 2, 0]} size={fit} material={FALLBACK_STEEL}/>
    </MeshAsset>
  </group>;
}

const DRESSING: { file: string; at: XYZ; yaw?: number; fine?: boolean }[] = [
  {file: 'forklift', at: [213, 0, 24.1], yaw: .12},
  {file: 'utilityCabinet', at: [204, 0, 25.13], yaw: Math.PI / 2},
  {file: 'wasteBin', at: [229.4, 0, 33.62], yaw: -.3},
  {file: 'jersey', at: [141.85, 0, 45.94], yaw: .06},
  {file: 'jersey', at: [235.4, 0, 46.05], yaw: -.09},
  {file: 'generator', at: [184.1, 1.2, 10.35], yaw: .46, fine: true},
  {file: 'tyre', at: [231.95, .014, 44.34], yaw: 1.15, fine: true},
  {file: 'cardboard', at: [182.2, 1.2, 10.18], yaw: -.2, fine: true},
  {file: 'plasticCrate', at: [198.21, 1.35, 16.07], yaw: -.12, fine: true},
  {file: 'handTruck', at: [186.7, 0, 1.88], yaw: -Math.PI / 2, fine: true},
  {file: 'powerBox', at: [187.55, 1.08, 1.74], yaw: 0},
  {file: 'roofVent', at: [235, 8, 10.15], yaw: Math.PI / 2, fine: true},
];

function makeSurfaces(lib: Materials) {
  // Reuse the campus mipmapped KTX2 inputs and metric UV scale. These are material clones only.
  function tint(base: THREE.MeshStandardMaterial, color: string, macro = .3, grime = .36, streaks = .5) {
    const material = base.clone();
    material.color.set(color);
    material.vertexColors = false;
    return weather(material, { macro, grime, streaks });
  }
  const asphalt = tint(lib.asphalt, '#aea99d', .57, 0, 0);
  const weatherAsphalt = asphalt.onBeforeCompile;
  asphalt.onBeforeCompile = (shader, renderer) => {
    weatherAsphalt(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec3 road = texture2D(map, vMapUv).rgb;
        vec2 offset = mat2(.824, .566, -.566, .824) * vMapUv * .704 + vec2(.31, .71);
        vec3 rotated = texture2D(map, offset).rgb;
        float variation = smoothstep(.16, .84, cNoise(vWorldPos.xz * .048));
        diffuseColor.rgb *= mix(road, rotated, .31 + .28 * variation);
      #endif`);
  };
  asphalt.customProgramCacheKey = () => 'getaway-asphalt';
  return {
    asphalt,
    aggregate: tint(lib.asphalt, '#a4947d', .61, 0, 0),
    patch: tint(lib.asphalt, '#7e7b72', .41, 0, 0),
    slab: tint(lib.concrete, '#c3b9a9', .43, 0, 0),
    concrete: tint(lib.concrete, '#bdb4a3', .44, .66, .52),
    corrugation: tint(lib.roofGreen, '#9cae9f', .24, .47, .55),
    roofing: tint(lib.roofGreen, '#7a8a84', .32, 0, 0),
    wood: tint(lib.wood, '#a08466', .35, 0, 0),
    glass: new THREE.MeshPhysicalMaterial({ color: '#4e6669', roughness: .19, metalness: .14, clearcoat: .72 }),
  };
}

export default memo(function IndustrialDistrict({ lib }: { lib: Materials }) {
  const quality = useGame(s => s.quality);
  const low = quality === 'low', detailed = quality === 'high' || quality === 'ultra';
  const active = useDistance(districtRange);
  const surfaces = useMemo(() => makeSurfaces(lib), [lib]);
  useEffect(() => () => Object.values(surfaces).forEach(material => material.dispose()), [surfaces]);
  if (!active) return null;
  return <group name="industrial:yard">
    <group position={ORIGIN}>
      <MeshAsset file="getaway/freightGround.glb" cast={false} surfaces={surfaces}>
        <mesh position={[16.995, .014, 3.39]}
          scale={[104.65, 70.38, 1]} rotation-x={-Math.PI / 2} geometry={UNIT_FLOOR} material={FALLBACK_STEEL} dispose={null} receiveShadow/>
      </MeshAsset>
      <MeshAsset file="getaway/bay04Shell.glb" surfaces={surfaces}><WarehouseFallback/></MeshAsset>
      <MeshAsset file="getaway/bay04Fittings.glb" cast={false} surfaces={surfaces}/>
      <MeshAsset file="getaway/freightFixtures.glb" surfaces={surfaces}/>
      <MeshAsset file="getaway/freightDepots.glb" surfaces={surfaces}>
        {INDUSTRIAL_SOLIDS.filter(b => b.kind === 'depot' || b.kind === 'safehouse').map(b =>
          <FallbackBox key={b.x + ':' + b.z} at={[b.x - ORIGIN[0], b.h / 2, b.z - ORIGIN[2]]}
            size={[b.w, b.h, b.d]} material={surfaces.concrete}/>)}
      </MeshAsset>
    </group>
    <FreightSigns/>
    <MeshAsset file="harbour/freight-gantry.glb" cast={!low}
      surfaces={{yellowPaint:lib.paintYellow,darkSteel:lib.darkMetal,concrete:surfaces.concrete}}/>
    <WarehouseLights detailed={detailed} low={low}/>
    <group name="getaway:maintenance-walkway">
      <mesh geometry={UNIT_BOX} material={lib.darkMetal} position={[191,4.23,2.51]} scale={[26.5,.16,1.52]} dispose={null} castShadow receiveShadow/>
      {[4.7,5.19].map(y=><mesh key={y} geometry={UNIT_BOX} material={lib.paintYellow} position={[191,y,3.22]} scale={[26.5,.048,.048]} dispose={null} castShadow/> )}
      {[178,181.25,184.5,187.75,191,194.25,197.5,200.75,204].map(x=><group key={x}>
        <mesh geometry={UNIT_BOX} material={lib.paintYellow} position={[x,4.69,3.22]} scale={[.052,.95,.052]} dispose={null} castShadow/>
        <mesh geometry={UNIT_BOX} material={lib.darkMetal} position={[x,4.05,2.48]} scale={[.13,.21,1.67]} dispose={null} castShadow/>
      </group>)}
    </group>
    {[4, 10, 17, 23].map(z => <group key={z} position={[191, 6.2, z]}><MeshAsset file="getaway/warehouseTruss.glb"/></group>)}
    {INDUSTRIAL_SOLIDS.map((solid, index) => {
      const { kind, x, z, w, d, h } = solid;
      if (kind !== 'container' && kind !== 'crate') return null;
      return <group key={`${x}:${z}`} position={[x, 0, z]}>
        {kind === 'container' ? <FreightContainer solid={solid} low={low} red={index % 2 === 0}/> :
          <MeshAsset file={`arena/${low ? 'mobile/' : ''}props/milCrate.glb`} fit={[w, h, d]}>
            <FallbackBox at={[0, h / 2, 0]} size={[w, h, d]} material={FALLBACK_BOX}/>
          </MeshAsset>}
      </group>;
    })}
    {DRESSING.filter(asset => !asset.fine || detailed).map(({ file, at, yaw }) =>
      <group key={file + at.join(',')} position={at} rotation-y={yaw ?? 0}>
        <MeshAsset file={`arena/${low ? 'mobile/' : ''}props/${file}.glb`} cast={!low}/>
      </group>)}
  </group>;
});
