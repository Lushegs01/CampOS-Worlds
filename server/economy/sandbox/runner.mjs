import {Worker} from 'node:worker_threads';
import {SANDBOX_LIMITS} from '../../../shared/economic-sandbox.mjs';

const MESSAGES={timeout:'The experiment exceeded its execution time budget and was stopped. Nothing was saved.',memory:'The experiment exceeded its memory budget and was stopped. Nothing was saved.',error:'The experiment could not be executed. Nothing was saved.',exit:'The experiment worker stopped unexpectedly. Nothing was saved.'};
/**
 * Runs a plan in a worker thread with a hard wall-clock limit and a V8 heap limit, so an experiment cannot
 * stall the room's simulation tick or grow without bound. The worker is always terminated afterwards.
 */
export function runIsolated(plan,{timeoutMs=SANDBOX_LIMITS.timeoutMs,memoryMb=SANDBOX_LIMITS.memoryMb,entry=new URL('./worker.mjs',import.meta.url)}={}) {
 return new Promise(resolve=>{
  const started=performance.now();let settled=false,timer=null,worker;
  const done=r=>{if(settled)return;settled=true;clearTimeout(timer);worker?.terminate().catch(()=>{});resolve({...r,message:r.ok?'':MESSAGES[r.reason]??MESSAGES.error,durationMs:Math.round(performance.now()-started)});};
  try{worker=new Worker(entry,{workerData:{plan},resourceLimits:{maxOldGenerationSizeMb:memoryMb,maxYoungGenerationSizeMb:16,stackSizeMb:4}});}
  catch(e){done({ok:false,reason:'error',error:String(e?.message??e).slice(0,240)});return;}
  timer=setTimeout(()=>done({ok:false,reason:'timeout'}),timeoutMs);
  worker.once('message',m=>done(m));
  worker.once('error',e=>done({ok:false,reason:e?.code==='ERR_WORKER_OUT_OF_MEMORY'?'memory':'error',error:String(e?.message??e).slice(0,240)}));
  worker.once('exit',code=>done({ok:false,reason:'exit',error:`Worker exited with code ${code}`}));
 });
}
