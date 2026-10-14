import { createClasses } from '../shared/classes.mjs';
import { createFleet, vehicleContains } from '../shared/vehicles.mjs';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { SPAWN, LOCATIONS, TOKENS, moveWithCollisions, sanitizeAvatar, blocked } from '../shared/campus.mjs';
import { createWorld, packBall } from '../shared/world.mjs';
// Messages stay within 2 KB except the account handshake, which carries a Supabase access token.
const MAX_MESSAGE=2048,MAX_AUTH_MESSAGE=6144;
export function createRoom({port=3001,host='127.0.0.1',origins=['http://localhost:5173','http://127.0.0.1:5173'],capacity=24,adminToken='',invite='',reportDir='server/data',accounts={enabled:false}}={}){
 const clients=new Map(),bans=new Set();let reportQueue=Promise.resolve();
 // Seats, doors and basketballs are authoritative here; clients send requests, never outcomes.
 const fleet=createFleet(),classes=createClasses();
 const world=createWorld();let worldRevision=world.revision;
 const joined=()=>[...clients.values()].filter(c=>c.joined);
 const worldState=()=>{const w=world.snapshot();return {type:'world',doors:w.doors,seats:w.seats};};
 const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<65536)ws.send(JSON.stringify(data));};
 const broadcast=data=>clients.forEach(c=>{if(c.joined)send(c.ws,data);});
 const http=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  if(req.url==='/health'){res.end(JSON.stringify({ok:true,players:[...clients.values()].filter(c=>c.joined).length,capacity}));return;}
  if(req.url==='/admin/kick'&&req.method==='POST'){
   const expected=Buffer.from('Bearer '+adminToken),actual=Buffer.from(req.headers.authorization??'');
   if(!adminToken||expected.length!==actual.length||!timingSafeEqual(expected,actual)){res.writeHead(403);res.end('{}');return;}
   let body='';try{for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('size');}const {id}=JSON.parse(body);const c=clients.get(id);if(c){bans.add(c.token);c.ws.close(4003,'Removed by room moderator');}res.end(JSON.stringify({removed:!!c}));}catch{res.writeHead(400);res.end('{}');}return;
  }res.writeHead(404);res.end('{}');
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:MAX_AUTH_MESSAGE,perMessageDeflate:false});
 // ---- accounts: verified identity, profile projection and server-validated progression
 async function authenticate(c,token){
  const seq=++c.authSeq,live=()=>seq===c.authSeq&&clients.get(c.id)===c,reply=data=>{if(live())send(c.ws,{type:'auth',...data});};
  if(!accounts.enabled){reply({ok:false,code:'unavailable',reason:'Accounts are not set up on this room. You are exploring as a guest.'});return;}
  const who=await accounts.verify(token);if(!live())return;
  if(who.error){reply({ok:false,code:who.error==='unavailable'?'unavailable':'expired',reason:who.error==='unavailable'?'Your account could not be checked right now. You are exploring as a guest.':'Your session has expired. Please sign in again.'});return;}
  let snap;try{snap=await accounts.snapshot(who.id);}catch{reply({ok:false,code:'unavailable',reason:'Your profile could not be loaded right now. You are exploring as a guest.'});return;}
  if(!live())return;
  if(!snap){reply({ok:false,code:'no-profile',reason:'Create your profile to appear on campus with it.'});return;}
  // One account appears once: the newest verified window takes over (a reload or a second tab);
  // the older connection carries on as a guest and is told why.
  const prior=[...clients.values()].find(o=>o!==c&&o.account?.id===who.id);
  if(prior){prior.authSeq++;prior.account=null;prior.hoops=[];prior.name='Explorer';send(prior.ws,{type:'auth',ok:false,code:'replaced',reason:'You opened campus with this account in another window, so this one continues as a guest.'});}
  bindAccount(c,who.id,snap);reply({ok:true,account:{handle:snap.handle,display_name:snap.display_name}});
 }
 function bindAccount(c,id,snap){c.account={id,handle:snap.handle};c.name=clean(snap.display_name,32)||'Explorer';c.avatar=sanitizeAvatar(snap.avatar??{});for(const k of snap.progress?.keepsakes??[])c.collected.add(k);c.visited=new Set(snap.progress?.landmarks??[]);c.hoops=[];}
 async function refreshAccount(c){
  if(!c.account||Date.now()-c.profileAt<2000)return;c.profileAt=Date.now();const id=c.account.id;
  try{const snap=await accounts.snapshot(id);if(c.account?.id!==id||!snap)return;c.account.handle=snap.handle;c.name=clean(snap.display_name,32)||'Explorer';c.avatar=sanitizeAvatar(snap.avatar??{});}catch{}
 }
 function record(c,kind,item){
  if(!c.account||!accounts.enabled)return;const id=c.account.id;
  accounts.recordProgress(id,kind,item).then(r=>{if(c.account?.id===id)send(c.ws,{type:'progress',kind,item,awarded:Array.isArray(r?.awarded)?r.awarded:[]});})
   .catch(()=>{if(c.account?.id===id)send(c.ws,{type:'notice',text:'That could not be saved to your profile right now. It still counts on this device.'});});
 }
 // Basketball rounds of five shots, scored by the room's own physics, for signed-in players.
 function settleHoops(c,now){
  if(!c.account||c.hoops.length<5)return;const round=c.hoops.slice(0,5);if(!round.every(s=>s.done||now-s.at>4500))return;c.hoops.splice(0,5);
  const points=round.reduce((a,s)=>a+s.points,0),made=round.filter(s=>s.points>0).length,id=c.account.id;
  accounts.recordHoopsRound(id,points,made).then(r=>{if(c.account?.id===id)send(c.ws,{type:'progress',kind:'hoops',item:String(points),best:r?.best??points,awarded:Array.isArray(r?.awarded)?r.awarded:[]});}).catch(()=>{});
 }
 http.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/ws'||!origins.includes(req.headers.origin)||clients.size>=capacity){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
 });
 wss.on('connection',ws=>{
  const id=randomUUID(),now=Date.now();const c={id,ws,joined:false,token:'',name:'',avatar:sanitizeAvatar(),account:null,authSeq:0,profileAt:0,visited:new Set(),hoops:[],...SPAWN,yaw:Math.PI,moving:false,sprinting:false,emote:'',emoteAt:0,vy:0,vx:0,vz:0,seat:null,ball:null,input:{dx:0,dz:0,sprint:false,jump:false},lastInput:now,alive:true,joinedAt:now,limits:{},collected:new Set()};clients.set(id,c);
  ws.on('pong',()=>{c.alive=true;});
  const rate=(key,max,window=1000)=>{const t=Date.now();const r=c.limits[key]??{at:t,n:0};if(t-r.at>=window){r.at=t;r.n=0;}c.limits[key]=r;return ++r.n<=max;};
  ws.on('message',data=>{
   if(!rate('all',75)){ws.close(4008,'Too many requests');return;}
   const raw=data.toString();let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
   if(raw.length>MAX_MESSAGE&&m.type!=='auth'&&m.type!=='join')return;
   if(m.type==='join'&&!c.joined){
    if(invite&&m.invite!==invite){ws.close(4001,'Invitation required');return;}
    const token=typeof m.token==='string'&&/^[a-f0-9]{48}$/.test(m.token)?m.token:randomBytes(24).toString('hex');
    if(bans.has(token)){ws.close(4003,'Removed by room moderator');return;}
    if([...clients.values()].some(v=>v!==c&&v.token===token&&v.joined)){ws.close(4004,'Session already connected');return;}
    c.token=token;c.name=clean(m.name,24)||'Explorer';c.avatar=sanitizeAvatar(m.avatar??{});c.joined=true;send(ws,{type:'welcome',id,token,position:SPAWN,world:world.snapshot(),vehicles:fleet.snapshot(),classes:classes.snapshot(),accounts:!!accounts.enabled});
    // A signed-in player joins as a guest and is upgraded once the room has verified the token.
    if(typeof m.access==='string'&&rate('auth',4,60000))authenticate(c,m.access);return;
   }if(!c.joined)return;
   if(m.type==='classAction'&&rate('classAction',5)){const r=classes.action(c,m);if(!r.ok)send(ws,{type:'notice',text:r.reason});broadcast({type:'classes',sessions:classes.snapshot()});
   }else if(m.type==='vehicleInput'&&rate('vehicleInput',35)){fleet.control(c,m);
   }else if(['vehicleEnter','vehicleExit','vehicleRecover'].includes(m.type)&&rate('vehicleAction',5)){
    const r=m.type==='vehicleEnter'?fleet.enter(c,String(m.id),m.seat??0):m.type==='vehicleExit'?fleet.exit(c,joined()):fleet.recover(c,joined());
    send(ws,{type:'vehicleResult',...r,vehicle:c.vehicle,vehicleSeat:c.vehicleSeat,x:c.x,z:c.z});broadcast({type:'vehicles',vehicles:fleet.snapshot()});
   }else if(m.type==='input'&&rate('input',35)){
    if(c.vehicle)return;
    if(![m.dx,m.dz,m.yaw].every(Number.isFinite))return;
    const length=Math.max(1,Math.hypot(m.dx,m.dz));c.input={dx:m.dx/length,dz:m.dz/length,sprint:m.sprint===true,jump:c.input.jump||m.jump===true};c.yaw=m.yaw%(Math.PI*2);c.lastInput=Date.now();
   }else if(m.type==='settle'&&rate('settle',3,1000)){
    // A standing player's client may nudge its server position to where it sees itself (small, walkable
    // corrections only), so range checks for seats, doors and balls agree with what the player sees.
    const x=Number(m.x),z=Number(m.z);if(!Number.isFinite(x)||!Number.isFinite(z)||c.seat||c.vehicle||Math.hypot(c.vx,c.vz)>.25||Date.now()-c.lastInput<350&&Math.hypot(c.input.dx,c.input.dz)>.01)return;
    if(Math.hypot(x-c.x,z-c.z)<=.9&&!blocked(x,z))Object.assign(c,{x,z});
   }else if(m.type==='auth'&&rate('auth',4,60000)){
    if(typeof m.token==='string')authenticate(c,m.token);
    else{c.authSeq++;if(c.account){c.account=null;c.hoops=[];c.name=clean(m.name,24)||'Explorer';c.avatar=sanitizeAvatar(m.avatar??{});}send(ws,{type:'auth',ok:true,account:null});}
   }else if(m.type==='profile'&&rate('profile',4,1000)){
    // Signed-in names and appearance come from the saved profile, never from the message.
    if(c.account)refreshAccount(c);else{c.name=clean(m.name,24)||'Explorer';c.avatar=sanitizeAvatar(m.avatar??{});}
   }else if(m.type==='chat'&&rate('chat',4,8000)){const message=clean(m.text,240);if(message)broadcast({type:'chat',id,name:c.name,text:message,at:Date.now()});
   }else if(m.type==='emote'&&rate('emote',2,3000)&&['wave','dance','cheer'].includes(m.emote)){c.emote=m.emote;c.emoteAt=Date.now();
   }else if(m.type==='interact'&&rate('interact',4,1000)){const loc=LOCATIONS.find(l=>l.id===m.id);if(loc&&Math.hypot(c.x-loc.x,c.z-loc.z)<6){send(ws,{type:'interaction',id:loc.id});if(c.account&&!c.visited.has(loc.id)){c.visited.add(loc.id);record(c,'landmark',loc.id);}}
   }else if(m.type==='collect'&&rate('collect',6,1000)){const token=TOKENS.find(t=>t.id===m.id);if(token&&!c.collected.has(token.id)&&Math.hypot(c.x-token.x,c.z-token.z)<2.2){c.collected.add(token.id);send(ws,{type:'collected',id:token.id});record(c,'keepsake',token.id);}
   }else if(['sit','stand','door','pickup','drop','shoot','ballReset'].includes(m.type)&&rate('world',8,1000)){
    if(c.vehicle)return;
    // Physical interactions: validated against server-side position, possession and occupancy.
    const r=m.type==='sit'?world.sit(c,String(m.seat)):m.type==='stand'?world.stand(c):m.type==='door'?world.door(c,String(m.id),m.open===true,joined().filter(p=>p!==c)):m.type==='pickup'?world.pickup(c,String(m.ball)):m.type==='drop'?world.drop(c):m.type==='shoot'?world.shoot(c,Number(m.yaw),Number(m.charge)):world.resetBall(c,String(m.ball));
    send(ws,{type:'result',action:m.type,ref:m.ref,...r,seat:c.seat,ball:c.ball,x:c.x,z:c.z});
    if(r.ok&&m.type==='shoot'){broadcast({type:'events',list:[{type:'shot',by:id,shot:r.shot,hoop:r.hoop}]});if(c.account)c.hoops.push({id:r.shot,at:Date.now(),points:0,done:false});}
   }else if(m.type==='report'&&rate('report',3,60000)&&clients.has(m.id)&&m.id!==id){
    const record={at:new Date().toISOString(),reporter:id,target:m.id,reason:clean(m.reason,300)||'Inappropriate behaviour'};
    reportQueue=reportQueue.then(async()=>{await mkdir(reportDir,{recursive:true});await appendFile(reportDir+'/reports.jsonl',JSON.stringify(record)+'\n');send(ws,{type:'notice',text:'Report saved for the room operator. You can also mute this player.'});}).catch(()=>send(ws,{type:'notice',text:'Report could not be saved. Please contact the room operator.'}));
   }
  });
  ws.on('close',()=>{fleet.release(c);classes.release(c);world.release(c);clients.delete(id);broadcast({type:'left',id});});ws.on('error',()=>ws.close());
 });
 let last=performance.now(),tick=0;
 const simulation=setInterval(()=>{const now=performance.now(),dt=Math.min((now-last)/1000,.25),steps=Math.ceil(dt/.05),h=dt/steps;last=now;
  for(const c of clients.values()){if(!c.joined){if(Date.now()-c.joinedAt>10000)c.ws.close();continue;}
   if(c.seat||c.vehicle){c.vx=c.vz=0;c.moving=false;c.input.jump=false;continue;}
   const active=Date.now()-c.lastInput<350,i=c.input;const speed=i.sprint?8:4.5,blend=1-Math.exp(-12*h);
   if(i.jump&&c.y===0)c.vy=7;i.jump=false;
   for(let k=0;k<steps;k++){c.vx+=((active?i.dx*speed:0)-c.vx)*blend;c.vz+=((active?i.dz*speed:0)-c.vz)*blend;
    const q=moveWithCollisions(c.x,c.z,c.vx*h,c.vz*h);if(!fleet.vehicles.some(v=>vehicleContains(v,q.x,q.z)))Object.assign(c,q);c.vy-=19*h;c.y=Math.max(0,c.y+c.vy*h);if(c.y===0)c.vy=0;}
   c.moving=Math.hypot(c.vx,c.vz)>.2;c.sprinting=i.sprint;if(Date.now()-c.emoteAt>3000)c.emote='';
  }
  fleet.step(dt,joined());classes.step(joined());
  const events=world.step(dt,joined());
  if(events.length)broadcast({type:'events',list:events});
  for(const e of events)if(e.type==='score'){const shot=clients.get(e.by)?.hoops.find(s=>s.id===e.shot);if(shot){shot.points=e.points;shot.done=true;}}
  if(tick%15===0){const t=Date.now();for(const c of clients.values())settleHoops(c,t);}
  if(world.revision!==worldRevision){worldRevision=world.revision;broadcast(worldState());}
  if(++tick%2===0)broadcast({type:'state',players:joined().map(({id,name,avatar,x,y,z,yaw,moving,sprinting,emote,emoteAt,seat,ball,vehicle,vehicleSeat,account})=>({id,name,avatar,x,y,z,yaw,moving,sprinting,emote,emoteAt,seat,ball,vehicle,vehicleSeat,handle:account?.handle??null})),balls:world.balls.map(packBall),vehicles:fleet.snapshot(),classes:classes.snapshot()});
 },1000/30);
 const heartbeat=setInterval(()=>clients.forEach(c=>{if(!c.alive)c.ws.terminate();else{c.alive=false;c.ws.ping();}}),10000);
 return {http,wss,clients,fleet,start:()=>new Promise(resolve=>http.listen(port,host,()=>resolve(http.address()))),close:()=>new Promise(resolve=>{clearInterval(simulation);clearInterval(heartbeat);clients.forEach(c=>c.ws.terminate());wss.close();http.close(resolve);})};
}
function clean(value,max){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,max):'';}
