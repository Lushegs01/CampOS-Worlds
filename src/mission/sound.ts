import { audio, heard, noise, output, type At } from '../audio/mixer';
import { loopElevenLabsEffect, playElevenLabsEffect, prepareElevenLabsEffects } from '../audio/elevenlabs';
import { player, useGame } from '../state';
import { assetUrl } from '../world/assetUrl';
import { inDistrict, O } from '../../shared/getaway.mjs';
import type { Mission, MissionEvent } from './client';

type Clip = [file: number, offset: number, length: number];
type Bank = { files: {file:string}[]; sounds: Record<string,Clip[]> };
let banks: Record<string,Bank> | null = null;
let requesting = false;
const samples = new Map<string, AudioBuffer>(), loading = new Set<string>();
function request(path: string) {
  const m = audio();
  if(!m||loading.has(path)||samples.has(path))return;
  loading.add(path);
  void fetch(assetUrl(path)).then(r => {
    if (!r.ok) throw new Error('Audio unavailable');
    return r.arrayBuffer();
  }).then(bytes=>m.ctx.decodeAudioData(bytes)).then(b=>{samples.set(path,b);}).catch(()=>{}).finally(()=>loading.delete(path));
}
const loadBank = (id: string) => { for(const entry of banks?.[id]?.files ?? [])request('arena/audio/'+entry.file); };
export function prepareMissionSound() {
  if (requesting||!useGame.getState().volume) return;
  prepareElevenLabsEffects();
  requesting=true;
  if(!banks)void fetch(assetUrl('arena/audio/manifest.json')).then(r=>r.json()).then(data=>{
    banks=data.banks;
    for(const id of ['amb.foundry','w.sparrow','w.vanguard','w.bastion','explosives','impacts','handling','voice.mC'])loadBank(id);
  }).catch(()=>{requesting=false;});
  for(const stem of ['suspense','combat','pursuit'])request('getaway/'+stem+'.mp3');
}
function sample(id: string, sound: string, volume: number, at?: At, delay=0) {
  const m=audio(), b=banks?.[id], variants=b?.sounds[sound];
  if(!m||!b||!variants?.length||at&&!heard(at,90))return false;
  const [index,offset,length]=variants[Math.floor(Math.random()*variants.length)];
  const buffer=samples.get('arena/audio/'+b.files[index].file);
  if(!buffer)return false;
  const src=m.ctx.createBufferSource(),gain=m.ctx.createGain(),dest=output(m,at,5);
  src.buffer=buffer;gain.gain.value=volume;src.connect(gain).connect(dest);
  src.onended=()=>{src.disconnect();gain.disconnect();if(at)dest.disconnect();};
  src.start(m.ctx.currentTime+delay,offset,length);
  return true;
}
type Bed = {source:AudioBufferSourceNode; gain:GainNode};
const beds = new Map<string,Bed>();
let scoreStart: number | null = null;
function bed(id:string,file:string,level:number,offset=0,loopTime=8) {
  const m=audio(),b=samples.get(file);
  if(!m||!b)return;
  let item=beds.get(id);
  const now=m.ctx.currentTime;
  if(!item){
    const source=m.ctx.createBufferSource(),gain=m.ctx.createGain();
    source.buffer=b;source.loop=true;source.loopStart=offset;source.loopEnd=Math.min(b.duration,offset+loopTime);
    gain.gain.value=0;source.connect(gain).connect(m.ambience);
    const phase=(now-(scoreStart??=now))%loopTime;
    source.start(now,offset+phase);
    item={source,gain};beds.set(id,item);
  }
  item.gain.gain.setTargetAtTime(level,now,.43);
}
function sweep(start: number, end: number, seconds: number, volume: number, at?: At, wave: OscillatorType = 'sine', delay = 0) {
  const m=audio();
  if(!m || at && !heard(at,100))return;
  const t=m.ctx.currentTime+delay, osc=m.ctx.createOscillator(), gain=m.ctx.createGain();
  const destination=output(m,at,4);
  osc.type=wave;osc.frequency.setValueAtTime(start,t);osc.frequency.exponentialRampToValueAtTime(end,t+seconds);
  gain.gain.setValueAtTime(volume,t);gain.gain.exponentialRampToValueAtTime(.001,t+seconds);
  osc.connect(gain).connect(destination);osc.start(t);osc.stop(t+seconds);
  osc.onended=()=>{osc.disconnect();gain.disconnect();if(at)destination.disconnect();};
}
function burst(at: At, ms: number, volume: number, low: number, high: number) {
  const m=audio();
  if(!m||!heard(at,95))return;
  const ctx=m.ctx,t=ctx.currentTime,src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),dest=output(m,at,5);
  src.buffer=noise(ctx);filter.type='lowpass';filter.frequency.setValueAtTime(high,t);filter.frequency.exponentialRampToValueAtTime(low,t+ms);
  gain.gain.setValueAtTime(volume,t);gain.gain.exponentialRampToValueAtTime(.001,t+ms);
  src.connect(filter).connect(gain).connect(dest);src.start(t);src.stop(t+ms);
  src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();dest.disconnect();};
}
export function missionSound(e: MissionEvent) {
  if(e.kind==='shot'||e.kind==='enemyShot'){
    const heavy=e.weapon==='bastion',soft=e.weapon==='sparrow',v=e.kind==='enemyShot'?.26:1;
    const remote=e.kind==='enemyShot',id='w.'+e.weapon;
    const generated = playElevenLabsEffect('shot-' + e.weapon, remote ? .48 : .62, remote ? e : undefined);
    if(!generated&&!sample(id,remote?'mid':'shot',remote?.37:.49,remote?e:undefined)){
      burst(e,heavy?.42:soft?.13:.21,(heavy?.49:.31)*v,heavy?180:450,soft?3600:2200);
      sweep(heavy?121:180,50,.115,.22*v,e,'triangle');
    }
    if(!remote&&!generated)sample(id,'tail',.12,undefined,.09);
    if(e.impact&&e.end){
      const hitAt={x:e.end[0],y:e.end[1],z:e.end[2]};
      const surface = e.surface ?? 'concrete';
      const generatedImpact = surface !== 'actor' && playElevenLabsEffect('impact-' + surface, .42, hitAt);
      if(!generatedImpact&&!sample('impacts',surface==='actor'?'flesh':surface,.29,hitAt))burst(hitAt,.075,.19,420,3700);
    }
  }else if(e.kind==='blast'){
    if(playElevenLabsEffect('fuel-blast', .95, e))return;
    if(!sample('explosives','blastNear',.8,e)){
      burst(e,1.45,.9,100,1300);sweep(84,27,1.18,.5,e,'triangle');
    }
    sample('explosives','debris',.4,e,.18);
  }else if(e.kind==='reload'||e.kind==='equip'){
    if(e.kind==='reload'&&e.weapon!=='bastion'&&playElevenLabsEffect('reload', .52))return;
    const id='w.'+e.weapon;
    const recorded=e.kind==='equip'?sample('handling','swap',.33):e.weapon==='bastion'?
      sample(id,'shellIn',.38):sample(id,'magOut',.38);
    if(!recorded){burst(e,.1,.22,650,4800);sweep(620,240,.12,.055,e,'triangle',.15);}
    else if(e.kind==='reload'&&e.weapon!=='bastion')sample(id,'magIn',.31,undefined,.62);
  }else if(e.kind==='hit'){
    if(!sample('voice.mC','hurt',.24,e))burst(e,.079,.13,220,1800);
  }
  else if(e.kind==='crash'){
    if(!playElevenLabsEffect('crash', .65, e))burst(e,.24,.33,160,1400);
  }
  else if(e.kind==='alarm'||e.kind==='dispatch'){
    if(!playElevenLabsEffect('alarm', .47, e))sweep(415,460,.6,.11,e,'triangle');
  }
  else if(e.kind==='failed')sweep(148,58,.65,.19);
  else if(e.kind==='pickup'||e.kind==='objective'){
    sweep(392,385,.23,.075);
    sweep(e.stage===O.commit?783:523,515,.28,.058,undefined,'sine',.12);
  }
}

let nextSiren=0,nextBed=0;
let freightAmbience: ReturnType<typeof loopElevenLabsEffect>;
let policeSiren: ReturnType<typeof loopElevenLabsEffect>;
export function tickMissionSound(m: Mission | null) {
  const cfg=useGame.getState(), now=performance.now();
  const inside=inDistrict(player.x,player.z);
  const enabled=cfg.volume>0&&cfg.phase==='playing'&&!cfg.panel&&!document.hidden;
  if(enabled&&inside)prepareMissionSound();
  if(now>=nextBed){
    nextBed=now+230;
    const active=enabled&&!!m&&!m.paused&&!m.failed&&m.stage<O.commit;
    const music=!active?null:m.wanted>=2?'pursuit':m.stage>=O.combat&&m.stage<=O.ambush?'combat':'suspense';
    if(inside||beds.size){
      if(inside&&enabled)freightAmbience??=loopElevenLabsEffect('freight-ambience','ambience',.27);
      else if(freightAmbience){freightAmbience.stop();freightAmbience=undefined;}
      bed('freight-ambience','arena/audio/amb.foundry.mp3',inside && enabled && !freightAmbience ? .31 : 0,10.46,12);
      for(const stem of ['suspense','combat','pursuit'])bed(stem,'getaway/'+stem+'.mp3',music===stem?.48:0);
    }
    if(!inside&&!active&&beds.size)stopBeds();
  }
  const pursuing = enabled && m && !m.paused && !m.failed && m.wanted;
  const car = pursuing ? m.vehicles.reduce<(typeof m.vehicles)[number] | undefined>((nearest, v) => {
    if (!v.police) return nearest;
    return !nearest || Math.hypot(v.x-player.x, v.z-player.z) < Math.hypot(nearest.x-player.x, nearest.z-player.z) ? v : nearest;
  }, undefined) : undefined;
  if (!car || !heard(car, 100)) {
    policeSiren?.stop();
    policeSiren = undefined;
    return;
  }
  const at = { x: car.x, y: 1.7, z: car.z };
  policeSiren ??= loopElevenLabsEffect('police-siren', 'effects', .46, at);
  if (policeSiren) policeSiren.move(at);
  else if (now > nextSiren) {
    nextSiren = now + 910;
    sweep(490,760,.43,.085,at,'triangle');
    sweep(760,470,.42,.085,at,'triangle',.43);
  }
}
function stopBeds() {
  for(const {source,gain} of beds.values()){source.stop();source.disconnect();gain.disconnect();}
  beds.clear();scoreStart=null;
}
export function stopMissionSound() {
  nextSiren=nextBed=0;
  freightAmbience?.stop(); freightAmbience=undefined;
  policeSiren?.stop(); policeSiren=undefined;
  stopBeds();
}
