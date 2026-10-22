// Executes one validated plan away from the room's game loop. Only plain data crosses the boundary.
import {parentPort,workerData} from 'node:worker_threads';
import {executePlan} from './engine.mjs';
try{parentPort.postMessage({ok:true,...executePlan(workerData.plan)});}
catch(e){parentPort.postMessage({ok:false,reason:'error',error:String(e?.message??e).slice(0,240)});}
