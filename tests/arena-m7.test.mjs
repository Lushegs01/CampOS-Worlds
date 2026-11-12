import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { WEAPON_BY_ID, WEAPON_INDEX, FREE_FIREARMS, weaponOwned, damageAt } from '../shared/arena/weapons.mjs';
import { SHOP_BY_ID } from '../shared/shop.mjs';
import { PRESETS, validateLoadout, timeToKill } from '../shared/arena/rules.mjs';
import { createWorld } from '../shared/arena/physics.mjs';
import { step, spawnState, packState, unpackState, cloneState, B, fireModeOf, encodeCommand, decodeCommand, quantize } from '../shared/arena/sim.mjs';
import { autoFireDecision } from '../shared/arena/autofire.mjs';
const w = WEAPON_BY_ID.get('m7'), cx = { world:createWorld([],[-100,-100,100,100]),seed:7,num:1,perks:new Set() };
const command = b => quantize({seq:1,b,mx:0,mz:0,yaw:0,pitch:0});
function run(s,ticks,b=0) { return Array.from({length:ticks},()=>step(s,command(b),cx)).flat(); }
const shots = events => events.filter(e=>e.kind==='shot');
function ready() { const s=spawnState({x:0,z:0},{...PRESETS[0],primary:'m7'});run(s,60);return s; }

test('M7 is free for guests at level one, unsold, appended without renumbering existing weapons',()=>{
  assert.deepEqual(FREE_FIREARMS,['vanguard','wasp','m7']);assert.equal(w.access,'free');assert.equal(w.category,'battle');assert.equal(w.mag,20);
  assert.equal(weaponOwned('m7',[]),true);assert.equal(SHOP_BY_ID.has('weapon-m7'),false);
  assert.equal(validateLoadout({...PRESETS[0],primary:'m7'},1,{},[]).ok,true);
  assert.equal(WEAPON_INDEX.get('vanguard'),0);assert.equal(WEAPON_INDEX.get('hammer'),12);assert.equal(WEAPON_INDEX.get('m7'),13);
  assert.equal(timeToKill(w,5),.2);assert.ok(w.recoil.kick>WEAPON_BY_ID.get('vanguard').recoil.kick*2);
  assert.equal(damageAt(w,170),27);assert.equal(damageAt(w,171),0);
});
test('M7 selector obeys cooldown, semi trigger reset, auto cadence and snapshot reconciliation',()=>{
  const s=ready();assert.equal(shots(run(s,60,B.FIRE)).length,10);assert.equal(s.wpn[0].mag,10);
  run(s,1);run(s,1,B.MODE);assert.equal(fireModeOf(s),'semi');run(s,10);
  assert.equal(shots(run(s,60,B.FIRE)).length,1);run(s,1);
  assert.equal(shots(run(s,8,B.FIRE)).length,1);
  const clone=ready();unpackState(packState(s),clone);assert.deepEqual(packState(clone),packState(s));assert.equal(fireModeOf(clone),'semi');
  run(s,1);run(s,1,B.SLOT2);run(s,60);run(s,1,B.SLOT1);run(s,60);assert.equal(fireModeOf(s),'semi');
  // Changing mode never resets the rate limit or ammunition, even when spammed.
  const fast=ready();let n=0;for(let i=0;i<60;i++) n+=shots(run(fast,1,B.FIRE|(i%2?B.MODE:0))).length;assert.ok(n<=10);
  assert.equal(decodeCommand(encodeCommand(command(B.MODE|B.INSPECT))).b,B.MODE|B.INSPECT);
});
test('inspection cancels immediately for firing; reload transfers ammunition only at completion and cancels on swap',()=>{
  const s=ready();run(s,1,B.INSPECT);assert.equal(s.phase,'inspect');assert.equal(shots(run(s,1,B.FIRE)).length,1);assert.equal(s.phase,'ready');
  run(s,10);run(s,1,B.RELOAD);assert.equal(s.pt,w.reload);const mag=s.wpn[0].mag;
  run(s,w.reload-1);assert.equal(s.wpn[0].mag,mag);run(s,1);assert.equal(s.wpn[0].mag,20);assert.equal(s.wpn[0].reserve,79);
  s.wpn[0].mag=0;run(s,1,B.RELOAD);assert.equal(s.pt,w.reloadEmpty);run(s,30);run(s,1,B.SLOT2);run(s,w.reloadEmpty);assert.equal(s.wpn[0].mag,0);
  const noSelector=spawnState({x:0,z:0},PRESETS[0]);run(noSelector,60);run(noSelector,1,B.MODE|B.INSPECT);assert.equal(noSelector.phase,'ready');assert.equal(fireModeOf(noSelector),'auto');
});
test('auto-fire releases the trigger between semi shots; prediction replay is deterministic',()=>{
  const s=ready();run(s,1,B.MODE);run(s,1);run(s,1,B.FIRE);
  assert.equal(autoFireDecision({sim:s,view:{yaw:0,pitch:0},targets:[],world:cx.world,team:0}).reason,'trigger reset');
  const a=ready(),b=cloneState(a);
  for(let i=0;i<600;i++){const c=command(i%100===0?B.MODE:i%61===0?B.RELOAD:i%2?B.FIRE:0);step(a,c,cx);step(b,c,cx);assert.deepEqual(packState(a),packState(b));}
});
test('M7 production assets decode with their own movable parts, PBR textures and a smaller LOD',async()=>{
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
  const [fp,tp]=await Promise.all(['m7','m7-lod'].map(id=>io.read(`public/assets/arena/weapons/${id}.glb`)));
  for(const doc of [fp,tp]){
    const names=doc.getRoot().listNodes().map(n=>n.getName());for(const part of ['body','mag','bolt'])assert.ok(names.includes(part));
    assert.ok(doc.getRoot().listTextures().every(t=>t.getMimeType()==='image/ktx2'));
    assert.ok(doc.getRoot().listMaterials().some(m=>m.getNormalTexture()&&m.getMetallicRoughnessTexture()));
  }
  const m=JSON.parse(readFileSync('public/assets/arena/manifest.json')).weapons.find(w=>w.id==='m7');
  assert.ok(m.triangles>5000&&m.lodTriangles<m.triangles/2);assert.ok(m.bytes<200000&&m.lodBytes<100000);
});

test('M7 sound bank is original, bounded, cached, unclipped and distinct for every mechanical cue',async()=>{
  const {transpileModule,ModuleKind}=await import('typescript');
  const source=transpileModule(readFileSync('src/arena/m7Audio.ts','utf8'),{compilerOptions:{module:ModuleKind.ESNext}}).outputText;
  const {m7Buffer}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const ctx={sampleRate:48000,createBuffer:(_,n,rate)=>{const data=new Float32Array(n);return {duration:n/rate,getChannelData:()=>data};}};
  const signatures=[];let bytes=0;
  for(const name of ['suppressed','release','out','insert','action','ready','dry','switch','inspect']){
    const buffer=m7Buffer(ctx,'m7-'+name),samples=buffer.getChannelData(0);bytes+=samples.byteLength;
    assert.equal(m7Buffer(ctx,'m7-'+name),buffer,'cached within the active audio context');
    assert.ok(samples.every(v=>Number.isFinite(v)&&Math.abs(v)<.99),'no clipping or invalid PCM');
    assert.ok(samples.some(v=>Math.abs(v)>.01),'audible, nonempty samples');
    signatures.push(Buffer.from(samples.buffer).subarray(0,4096).toString('base64'));
  }
  assert.equal(new Set(signatures).size,signatures.length,'distinct firing and mechanical sounds');
  assert.ok(bytes<300000,'less than 300 KB decoded mono PCM for the whole bank');
});
