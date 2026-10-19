import {useLab} from './client';
import {useGame} from '../state';
import {LOGISTICS_SITES} from '../../shared/economic-lab.mjs';
/** Only a player who has chosen to claim lab work sees this compact delivery reminder. */
export function LabHud() {
 const view=useLab(s=>s.view),panel=useGame(s=>s.panel),run=view?.current;
 const task=run?.tasks.find(t=>t.worker?.id===view?.principal&&['claimed','in_progress','revision'].includes(t.status));
 if(!task||panel)return null;
 const site=LOGISTICS_SITES.find(s=>s.id===(task.delivery?'':task.pickup?task.outputs.destination:task.inputs.origin));
 return <aside className="lab-delivery-hud" aria-label="Active simulation delivery"><b>Lab delivery · {task.inputs.quantity} packs</b><span>{task.delivery?'Return to station C to submit':`${task.pickup?'Deliver':'Collect'} · ${site?.name}`}</span><small>Use E / Interact at the fixture · {run?.status}</small>{site&&<button className="text-button" onClick={()=>useGame.getState().set({destination:`pt:${site.x}:${site.z}:${site.name}`})}>Show destination</button>}</aside>;
}
