// Token stays in the environment and Authorization header, never argv or a URL.
const [base,action,...args]=process.argv.slice(2),token=process.env.ADMIN_TOKEN;
const usage='Usage: ADMIN_TOKEN=<secret> node scripts/ops/admin.mjs <private-room-origin> status|bans|kick|ban|unban|buildings|building [player-id|account:<uuid>|ban-key|building-id] [reason|completion 0-100|open|closed] [hours]';
if(!base||!token||!['status','bans','kick','ban','unban','buildings','building'].includes(action)){console.error(usage);process.exit(1);}
const url=new URL(base);
if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Use a plain room origin.');
if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Use HTTPS or an SSH tunnel to localhost.');
let body;
if(action==='unban')body={key:args[0]};
// Building completion for campus characters (docs/NPCS.md): `building studio-d1 80`, `building courtyard-cafe closed`.
if(action==='building')body={building:args[0],...(args[1]==='open'||args[1]==='closed'?{available:args[1]==='open'}:{completion:Number(args[1])})};
if(action==='kick'||action==='ban')body={...(args[0]?.startsWith('account:')?{account:args[0].slice(8)}:{id:args[0]}),reason:args[1]||'Room moderator removal',hours:args[2]?Number(args[2]):24};
try{
 const response=await fetch(new URL('/admin/'+(action==='building'?'buildings':action),url),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000),redirect:'error'});
 const text=await response.text();if(!response.ok)throw Error(`Admin request failed (${response.status}): ${text.slice(0,300)}`);console.log(text);
}catch(error){console.error(error.message);process.exitCode=1;}
