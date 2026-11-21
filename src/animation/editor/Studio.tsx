import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ArrowLeft, Download, Pause, Play, RotateCcw, Upload } from 'lucide-react';
import Avatar, { type AvatarMotion } from '../../avatar/Avatar';
import { AvatarBoundary } from '../../avatar/AvatarBoundary';
import { initLoaders, loadModel, suspend } from '../../world/assets';
import { MODELS, displayAvatar } from '../../../shared/campus.mjs';
import { DOORS, DOOR_BY_ID, SEATS, SEAT_BY_ID } from '../../../shared/interactions.mjs';
import { PRIMITIVES, doorHandle } from '../../../shared/character-actions.mjs';
import { CALIBRATION_LIMITS, fixtureCalibration, parseCalibration } from '../../../shared/primitive-calibration.mjs';
import './studio.css';

type Calibration=ReturnType<typeof fixtureCalibration>;
type Operation='sit'|'stand'|'door-push'|'door-pull';
type Draft={version:1;fixture:string;calibration:Calibration};
const finished=DOORS.filter(d=>!d.locked);
const key='campos-primitive-studio-v1';
const fields:[keyof Calibration,string][]=[
  ['x','Side offset'],['y','Height offset'],['z','Depth offset'],['yaw','Seat yaw'],['approach','Approach clearance'],
];
const seatFor=(id:string)=>SEAT_BY_ID.get(id);
const doorFor=(id:string)=>finished.find(d=>d.id===id);
const isDoor=(op:Operation)=>op==='door-push'||op==='door-pull';
function draftFrom(raw:unknown):Draft|null{
  if(!raw||typeof raw!=='object')return null;
  const v=raw as Partial<Draft>;
  if(v.version!==1||typeof v.fixture!=='string'||(!seatFor(v.fixture)&&!doorFor(v.fixture)))return null;
  const calibration=parseCalibration(v.calibration);
  return calibration&&(!doorFor(v.fixture)||calibration.yaw===0)?{version:1,fixture:v.fixture,calibration}:null;
}
function loadDraft():Draft {
  try{
    const saved=draftFrom(JSON.parse(localStorage.getItem(key)??'null'));
    if(saved)return saved;
  }catch{/* Browser storage is optional. */}
  const fixture=SEATS[0].id;
  return {version:1,fixture,calibration:{...fixtureCalibration(fixture)}};
}
function Box({ size, at, color }: {size:[number,number,number];at:[number,number,number];color:string}) {
  return <mesh position={at} castShadow receiveShadow>
    <boxGeometry args={size}/><meshStandardMaterial color={color} roughness={.63}/>
  </mesh>;
}
function Marker({ at, color }: {at:[number,number,number]; color:string}) {
  return <group position={at}>
    <mesh><sphereGeometry args={[.034,16,10]}/><meshBasicMaterial color={color}/></mesh>
    <mesh rotation-x={Math.PI/2}><torusGeometry args={[.082,.008,8,28]}/><meshBasicMaterial color={color}/></mesh>
  </group>;
}
function Chair({ model }: {model:string}) {
  const asset=suspend(loadModel(`props/${model}.glb`));
  // This canvas has a single chair and its own lifetime.
  return <primitive object={asset.scene}/>;
}
function PreviewReady({ selection,onReady }: {selection:string;onReady:(selection:string)=>void}) {
  useEffect(()=>onReady(selection),[selection,onReady]);
  return null;
}
function Preview({ draft, operation, model, progress, angle, selection, onReady }: {
  draft:Draft;operation:Operation;model:string;progress:number;angle:number;
  selection:string;onReady:(selection:string)=>void;
}) {
  const {gl,camera,invalidate}=useThree();
  initLoaders(gl,4);
  const calibration=draft.calibration, door=DOOR_BY_ID.get(draft.fixture),seat=seatFor(draft.fixture);
  const avatar=displayAvatar({model,accessory:'none'});
  const distance=4.4;
  useLayoutEffect(()=>{
    camera.position.set(Math.sin(angle)*distance,2.12,Math.cos(angle)*distance);
    camera.lookAt(0,1,0);
    invalidate();
  },[angle,camera,invalidate]);
  useLayoutEffect(()=>invalidate(),[draft,operation,progress,model,invalidate]);
  let actor:[number,number,number]=[0,0,0],yaw=0;
  let contact:[number,number,number]=[0,0,0],approach:[number,number,number]=[0,.025,0];
  const motion:AvatarMotion={speed:0,y:0,vy:0,authoring:{progress,calibration}};
  let props;
  if(door&&isDoor(operation)){
    const leaf=door.leaves[0], handle=doorHandle(door,leaf,calibration), spec=PRIMITIVES[operation as 'door-push'|'door-pull'];
    const time=progress*spec.seconds, t=THREE.MathUtils.smoothstep(time,spec.commitMs/1000,spec.commitMs/1000+.75);
    const swing=leaf.dir*1.3*(operation==='door-push'?t:1-t);
    const hinge=-leaf.dir*leaf.len*.5;
    contact=[hinge+handle.x*Math.cos(swing)+handle.z*Math.sin(swing),handle.y,-handle.x*Math.sin(swing)+handle.z*Math.cos(swing)];
    const clearance=.73+calibration.approach;
    actor=[hinge+handle.x,0,clearance];approach=[actor[0],.025,actor[2]];yaw=Math.PI;
    motion.gesture={kind:operation as 'door-push'|'door-pull',start:0,point:{x:contact[0],y:contact[1]-.11,z:contact[2]}};
    props=<>
      <Box size={[.105,door.height,.14]} at={[hinge,door.height*.5,0]} color="#667478"/>
      <group position-x={hinge} rotation-y={swing}>
        <Box size={[leaf.len,door.height,.055]} at={[leaf.dir*leaf.len*.5,door.height*.5,0]} color={door.glass?'#49666a':'#3d5750'}/>
        <Box size={[door.glass?leaf.len*.7:.14,.035,.035]} at={[handle.x,handle.y,handle.z]} color="#cbd6cc"/>
      </group>
    </>;
  }else if(seat){
    motion.authoring!.seat={...seat,x:0,z:0,pull:seat.pull??0};
    motion.sit={seat:seat.id,phase:operation==='stand'?'up':'down',t:0,exit:{x:0,z:.42-(seat.pull??0)}};
    approach=[0,.025,.45-(seat.pull??0)+calibration.approach];
    contact=[calibration.x,seat.y+calibration.y+.025,calibration.z-(seat.pull??0)];
    props=<group position-z={-(seat.pull??0)}>
      {seat.model?<Suspense fallback={<Box size={[.55,seat.y,.55]} at={[0,seat.y*.5,0]} color="#625440"/>}><Chair model={seat.model}/></Suspense>
        :<>
          <Box size={[1.7,.09,.48]} at={[0,seat.y-.045,0]} color="#927254"/>
          <Box size={[1.7,.28,.08]} at={[0,seat.y+.3,-.22]} color="#7c604a"/>
          {[-.66,.66].map(x=><Box key={x} size={[.09,seat.y,.4]} at={[x,seat.y*.5,-.02]} color="#444b47"/>)}
        </>}
    </group>;
  }
  return <>
    {props}
    <Marker at={contact} color="#f6c477"/><Marker at={approach} color="#96ddd1"/>
    <AvatarBoundary key={selection} accent={avatar.accent}><Suspense fallback={null}>
      <group position={actor} rotation-y={yaw}><Avatar config={avatar} motion={()=>motion}/></group>
      <PreviewReady selection={selection} onReady={onReady}/>
    </Suspense></AvatarBoundary>
  </>;
}

export default function Studio() {
  const [draft,setDraft]=useState(loadDraft);
  const [operation,setOperation]=useState<Operation>(()=>doorFor(draft.fixture)?'door-push':'sit');
  const [model,setModel]=useState<(typeof MODELS)[number]>('tunde');
  const [progress,setProgress]=useState(0),[playing,setPlaying]=useState(false),[angle,setAngle]=useState(.88),[status,setStatus]=useState('');
  const [ready,setReady]=useState('');
  const selection=`${model}:${draft.fixture}:${operation}`;
  const input=useRef<HTMLInputElement>(null);
  const fileSequence=useRef(0);
  const door=!!doorFor(draft.fixture);
  useEffect(()=>{
    if(!playing)return;
    const start=performance.now()-progress*PRIMITIVES[operation].seconds*1000;
    let frame=0;
    const advance=(now:number)=>{
      const phase=Math.min(1,(now-start)/(PRIMITIVES[operation].seconds*1000));
      setProgress(phase);
      if(phase===1)setPlaying(false);else frame=requestAnimationFrame(advance);
    };
    frame=requestAnimationFrame(advance);
    return ()=>cancelAnimationFrame(frame);
    // Start a timeline from the position at the instant Play was pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[playing,operation]);
  const replace=(next:Draft)=>{
    setDraft(next);setOperation(doorFor(next.fixture)?'door-push':'sit');setPlaying(false);setProgress(0);
  };
  const save=()=>{
    try{localStorage.setItem(key,JSON.stringify(draft));setStatus('Draft saved on this device.');}
    catch{setStatus('Browser storage is unavailable. Export JSON to keep this draft.');}
  };
  const download=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`primitive-${draft.fixture}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus('Calibration JSON exported.');
  };
  const importFile=async(file?:File)=>{
    if(!file)return;
    const sequence=++fileSequence.current;
    try{
      if(file.size>8192)throw Error('File exceeds 8 KB.');
      const candidate=draftFrom(JSON.parse(await file.text()));
      if(!candidate)throw Error('Expected a supported fixture and bounded calibration values.');
      if(sequence!==fileSequence.current)return;
      replace(candidate);setStatus('Draft loaded.');
    }catch(error){if(sequence===fileSequence.current)setStatus(error instanceof Error?error.message:'Could not load this draft.');}
  };
  return <main className="primitive-studio">
    <header className="studio-header"><a href="/" aria-label="Return to CampOS Worlds"><ArrowLeft size={17}/> CampOS Worlds</a><h1>Primitive Studio</h1>
      <div><button onClick={()=>input.current?.click()}><Upload size={15}/> Import JSON</button><button onClick={download}><Download size={15}/> Export JSON</button></div>
      <input ref={input} type="file" aria-label="Import calibration file" accept="application/json,.json" hidden onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/>
    </header>
    <div className="studio-workspace">
      <section className="studio-preview" aria-label="3D animation preview">
        <Canvas dpr={1} frameloop="demand" camera={{fov:42,position:[3.2,2.12,3],near:.05,far:36}} gl={{antialias:true}}>
          <color attach="background" args={['#182724']}/>
          <hemisphereLight args={['#fff1db','#637d76',2]}/>
          <directionalLight position={[4,5,3]} intensity={3}/>
          <gridHelper args={[12,24,'#59756c','#31463f']}/>
          <Preview draft={draft} operation={operation} model={model} progress={progress} angle={angle} selection={selection} onReady={setReady}/>
        </Canvas>
        <div className="studio-legend"><span><i/> Approach</span><span><i/> Contact</span>{ready!==selection&&<span>Loading character…</span>}</div>
        <div className="studio-timeline">
          <button aria-label={playing?'Pause preview':'Play preview'} onClick={()=>{if(!playing&&progress===1)setProgress(0);setPlaying(!playing);}}>{playing?<Pause size={17}/>:<Play size={17}/>}</button>
          <input aria-label="Preview progress" type="range" min={0} max={1} step={.005} value={progress} onChange={e=>{setPlaying(false);setProgress(+e.target.value);}}/>
          <output>{Math.round(progress*100)}%</output>
        </div>
      </section>
      <aside className="studio-controls" aria-label="Fixture calibration">
        <label>Fixture<select aria-label="Fixture" value={draft.fixture} onChange={e=>{const fixture=e.target.value;replace({version:1,fixture,calibration:{...fixtureCalibration(fixture)}});}}>
          <optgroup label="Doors">{finished.map(d=><option value={d.id} key={d.id}>{d.label}</option>)}</optgroup>
          <optgroup label="Seats">{SEATS.map(s=><option value={s.id} key={s.id}>{s.id}</option>)}</optgroup>
        </select></label>
        <label>Action<select aria-label="Action" value={operation} onChange={e=>{setOperation(e.target.value as Operation);setProgress(0);setPlaying(false);}}>
          {door?<><option value="door-push">Push open</option><option value="door-pull">Pull closed</option></>:<><option value="sit">Sit down</option><option value="stand">Stand up</option></>}
        </select></label>
        <label>Character<select aria-label="Character" value={model} onChange={e=>setModel(e.target.value as typeof model)}>{MODELS.map(id=><option key={id} value={id}>{id}</option>)}</select></label>
        <label className="studio-angle">View angle<input aria-label="View angle" type="range" min={-Math.PI} max={Math.PI} step={.01} value={angle} onChange={e=>setAngle(+e.target.value)}/></label>
        <fieldset><legend>{door?'Handle and approach':'Contact pose and approach'}</legend>
          {fields.filter(([id])=>!door||id!=='yaw').map(([id,label])=>{
            const max=CALIBRATION_LIMITS[id],value=draft.calibration[id];
            return <label key={id}><span>{label}<output>{value.toFixed(id==='yaw'?0:2)} {id==='yaw'?'°':'m'}</output></span>
              <input aria-label={label} type="range" min={-max} max={max} step={id==='yaw'?1:.01} value={value} onChange={e=>{
                const n=+e.target.value;
                setDraft(d=>({...d,calibration:{...d.calibration,[id]:n}}));
              }}/></label>;
          })}
        </fieldset>
        <div className="studio-actions"><button className="primary" onClick={save}>Save draft</button><button onClick={()=>{setDraft(d=>({...d,calibration:{...fixtureCalibration(d.fixture)}}));setStatus('Project calibration restored.');}}><RotateCcw size={15}/> Reset</button></div>
        <p role="status">{status}</p>
      </aside>
    </div>
  </main>;
}
