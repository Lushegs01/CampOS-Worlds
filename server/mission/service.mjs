import { createGetaway, atContact, combatInput, missionStep, missionInteract, getSpawn, viewMission, O } from './getaway.mjs';
import { isGetawayVehicle } from '../../shared/getaway.mjs';

const clock=()=>Date.now()/1000;
const accountOf=c=>c.account?.id??null;
const principal=c=>accountOf(c)??c.token;
export function createMissionService({ accounts, send, place, fleet, release, time=clock }) {
  const suspended = new Map(), writes = new Map(), pendingRewards = new Map();
  const rawSend=(c,data)=>send(c,{type:'getaway',...data});
  const notify=(c,reason)=>rawSend(c,{reason});
  const publish=(c,now=time())=>{if(c.getaway)rawSend(c,{mission:viewMission(c.getaway,now),at:Math.round(now*1000)});};
  const releasePrivate=c=>{if(isGetawayVehicle(c.vehicle))c.getaway?.fleet.release(c);};
  const clear=c=>{releasePrivate(c);c.getaway=null;rawSend(c,{mission:null});};
  const put=(id,task)=>{
    const job=(writes.get(id)??Promise.resolve()).catch(()=>{}).then(task);
    writes.set(id,job);
    const done=()=>{if(writes.get(id)===job)writes.delete(id);};
    void job.then(done,done);
    return job;
  };
  function save(c,m) {
    const id=accountOf(c);
    if(!id||!accounts.saveGetaway)return;
    const cp=m.stage>=O.commit?null:{stage:m.checkpoint,stats:m.checkpointStats??null};
    void put(id,()=>accounts.saveGetaway(id,cp)).catch(()=>notify(c,'Checkpoint is available for this room session. Account sync failed.'));
  }
  function activate(c,cp=O.warehouse,stats=null,respawn=false) {
    release(c);
    const m=createGetaway({now:time(),checkpoint:cp,stats,externalVehicles:()=>fleet.vehicles});
    c.getaway=m;
    if(respawn){place(c,getSpawn(cp));send(c,{type:'getawayPosition',x:c.x,z:c.z,yaw:c.yaw});}
    publish(c);
  }
  function depart(c) {
    const m=c.getaway;
    if(m){
      if(m.stage<O.commit||m.saveError||m.saving) suspended.set(principal(c),{
        at:time(),checkpoint:m.checkpoint,stats:m.checkpointStats, pending:m.stage===O.commit?m:null,
      });
      releasePrivate(c);
      c.getaway=null;
    }
  }
  function identity(c) {
    depart(c);
    c.getawayBrief=null;c.getawayHistory=null;c.getawayResume=null;c.getawayLoaded=false;c.getawayLoading=null;
    rawSend(c,{mission:null,brief:false,history:null,resume:null});
  }
  async function load(c) {
    const key=principal(c),id=accountOf(c);
    if(c.getawayLoaded===key)return;
    let record=null;
    c.getawayLoading=key;
    if(id&&accounts.getaway){
      await writes.get(id)?.catch(()=>{});
      try{record=await accounts.getaway(id);}
      catch{
        if(c.joined&&principal(c)===key){c.getawayLoading=null;notify(c,'Campaign progress could not be loaded. Open the journal to retry.');}
        return;
      }
    }
    if(!c.joined||principal(c)!==key||c.getawayLoading!==key)return;
    c.getawayLoaded=key;c.getawayLoading=null;c.getawayHistory=record?.completion??null;
    const local=suspended.get(key);
    const remembered=(local?.pending?.stage===O.complete?null:local)??(record?.checkpoint?{checkpoint:record.checkpoint.stage,stats:record.checkpoint.stats}:null);
    c.getawayResume=remembered;
    rawSend(c,{history:c.getawayHistory,resume:remembered?.checkpoint??null});
  }
  function commit(c,m) {
    if(m.saving||m.stage!==O.commit)return;
    const id=accountOf(c);
    if(!id||!accounts.finishGetaway){m.stage=O.complete;m.reward={saved:false};publish(c);return;}
    m.saving=true;m.saveError=false;publish(c);
    const job=put(id,()=>accounts.finishGetaway(id,m.report));pendingRewards.set(id,job);
    void job.then(result=>{
      m.saving=false;m.stage=O.complete;m.reward={saved:true,...result};suspended.delete(id);
      if(accountOf(c)===id){
        c.getawayHistory=result.completion;c.getawayResume=null;
        rawSend(c,{history:c.getawayHistory,resume:null});publish(c);
      }
    },()=>{
      m.saving=false;m.saveError=true;
      if(accountOf(c)===id)publish(c);
    }).finally(()=>{if(pendingRewards.get(id)===job)pendingRewards.delete(id);});
  }
  function handle(c,command) {
    const m=c.getaway,now=time(),a=command.action;
    if(a==='status'){if(c.getawayLoading!==principal(c))void load(c);return;}
    if(a==='brief'&&!m&&atContact(c)){
      c.getawayBrief=now;rawSend(c,{brief:true});if(!c.getawayLoading)void load(c);return;
    }
    if(a==='closeBrief'){c.getawayBrief=null;rawSend(c,{brief:false});return;}
    if(a==='accept'){
      if(m||c.duel||c.run||c.y>.1||!atContact(c)||c.getawayBrief==null||now-c.getawayBrief>180)return notify(c,'Talk to Sade at the freight gate to begin.');
      if(pendingRewards.has(accountOf(c)))return notify(c,'Your last delivery is still saving.');
      c.getawayBrief=null;c.getawayResume=null; suspended.delete(principal(c));
      rawSend(c,{brief:false,resume:null});activate(c);save(c,c.getaway);return;
    }
    if(a==='resume'&&!m&&c.getawayResume){
      if(c.vehicle||c.seat||c.dorm||c.ball||c.duel||c.y>.05)return notify(c,'Stand on campus before resuming.');
      const {checkpoint,stats,pending}=c.getawayResume;
      c.getawayResume=null;suspended.delete(principal(c));rawSend(c,{resume:null});
      if(pending){c.getaway=pending;commit(c,pending);publish(c);}
      else activate(c,checkpoint,stats,true);
      return;
    }
    if(!m)return;
    if(a==='fire'||a==='equip'||a==='reload'){
      combatInput(m,c,a,command,now);return;
    }
    if(a==='pickup'||a==='deliver'){
      const cp=m.checkpoint;
      if(!missionInteract(m,c,a==='pickup'?'package':'deliver',now))return notify(c,'Move closer to the objective and try again.');
      if(cp!==m.checkpoint)save(c,m);
      if(m.stage===O.commit)commit(c,m);
    }else if(a==='pause'&&m.stage<O.commit&&!m.failed){
      m.paused=!m.paused;
      if(m.paused)m.pauseAt=now;
      else {
        const delta=now-m.pauseAt;m.started+=delta;
        for(const key of ['reloadAt','blastAt','lastFire','nextShot','lostAt','policeAt','vitalsAt','damageAt'])
          if(m[key]!=null)m[key]+=delta;
        for(const actor of m.actors)for(const key of ['nextShot','decision','seen','searchUntil','routeAt','hitAt'])actor[key]+=delta;
        for(const unit of m.police)for(const key of ['plan','lastSeen','age','reverseUntil','stuckAt'])if(unit[key]!=null)unit[key]+=delta;
        m.pauseAt=null;
      }
    }else if(a==='retry'&&m.stage<O.commit){
      activate(c,m.checkpoint,m.checkpointStats,true);return;
    }else if(a==='save'&&m.saveError)commit(c,m);
    else if((a==='leave'&&m.stage===O.complete)||(a==='abandon'&&m.stage<O.commit)){
      const id=accountOf(c);suspended.delete(principal(c));
      if(a==='abandon'&&id&&accounts.saveGetaway)void put(id,()=>accounts.saveGetaway(id,null)).catch(()=>notify(c,'Could not clear the saved account checkpoint.'));
      if(isGetawayVehicle(c.vehicle)){
        m.fleet.release(c);place(c,getSpawn(m.checkpoint));send(c,{type:'getawayPosition',x:c.x,z:c.z,yaw:c.yaw});
      }
      clear(c);return;
    }
    publish(c);
  }
  function step(c,dt) {
    const m=c.getaway;
    if(!m)return;
    const now=time(),cp=m.checkpoint;
    m.now=now;
    if(m.paused||m.failed){
      const v=m.fleet.find(c.vehicle);
      if(v){v.speed=0;v.input={throttle:0,steer:0,brake:true};}
    }else{
      m.fleet.step(dt,[c],now*1000);
      missionStep(m,c,dt,now);
      if(cp!==m.checkpoint)save(c,m);
    }
    if(now>=m.nextPush&&(m.stage<O.commit||m.events.length)){m.nextPush=now+(m.paused||m.failed?0.5:0.09);publish(c,now);}
  }
  function expire() {
    const threshold=time()-3600;
    for(const [id,s] of suspended)if(s.at<threshold)suspended.delete(id);
  }
  return {handle,step,depart,identity,load,expire,
    privateFleet:c=>c.getaway?.fleet??null,
    frozen:c=>!!(c.getaway?.paused||c.getaway?.failed||c.getaway?.stage===O.commit),
    canEnter(c,id,seat){
      const m=c.getaway;
      if(!isGetawayVehicle(id))return !m||m.stage>=O.safehouse;
      return !!m&&m.stage>=O.vehicle&&m.stage<=O.deliver&&seat===0&&!!m.fleet.find(id)?.condition;
    },
    async drain(){await Promise.allSettled([...writes.values()]);},
  };
}
