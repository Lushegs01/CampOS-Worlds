import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { SPAWN, LOCATIONS, TOKENS, moveWithCollisions, sanitizeAvatar, blocked } from '../shared/campus.mjs';
import { createWorld, packBall } from '../shared/world.mjs';
export function createRoom({port=3001,host='127.0.0.1',origins=['http://localhost:5173','http://127.0.0.1:5173'],capacity=24,adminToken='',invite='',reportDir='server/data'}={}){
 const clients=new Map(),bans=new Set();let reportQueue=Promise.resolve();
 // Seats, doors and basketballs are authoritative here; clients send requests, never outcomes.
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
 const wss=new WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:false});
 http.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/ws'||!origins.includes(req.headers.origin)||clients.size>=capacity){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
 });
 wss.on('connection',ws=>{
  const id=randomUUID(),now=Date.now();const c={id,ws,joined:false,token:'',name:'',avatar:sanitizeAvatar(),...SPAWN,yaw:Math.PI,moving:false,sprinting:false,emote:'',emoteAt:0,vy:0,vx:0,vz:0,seat:null,ball:null,input:{dx:0,dz:0,sprint:false,jump:false},lastInput:now,alive:true,joinedAt:now,limits:{},collected:new Set()};clients.set(id,c);
  ws.on('pong',()=>{c.alive=true;});
  const rate=(key,max,window=1000)=>{const t=Date.now();const r=c.limits[key]??{at:t,n:0};if(t-r.at>=window){r.at=t;r.n=0;}c.limits[key]=r;return ++r.n<=max;};
  ws.on('message',data=>{
   if(!rate('all',75)){ws.close(4008,'Too many requests');return;}
   let m;try{m=JSON.parse(data.toString());}catch{return;}if(!m||typeof m!=='object')return;
   if(m.type==='join'&&!c.joined){
    if(invite&&m.invite!==invite){ws.close(4001,'Invitation required');return;}
    const token=typeof m.token==='string'&&/^[a-f0-9]{48}$/.test(m.token)?m.token:randomBytes(24).toString('hex');
    if(bans.has(token)){ws.close(4003,'Removed by room moderator');return;}
    if([...clients.values()].some(v=>v!==c&&v.token===token&&v.joined)){ws.close(4004,'Session already connected');return;}
    c.token=token;c.name=clean(m.name,24)||'Explorer';c.avatar=sanitizeAvatar(m.avatar??{});c.joined=true;send(ws,{type:'welcome',id,token,position:SPAWN,world:world.snapshot()});return;
   }if(!c.joined)return;
   if(m.type==='input'&&rate('input',35)){
    if(![m.dx,m.dz,m.yaw].every(Number.isFinite))return;
    const length=Math.max(1,Math.hypot(m.dx,m.dz));c.input={dx:m.dx/length,dz:m.dz/length,sprint:m.sprint===true,jump:c.input.jump||m.jump===true};c.yaw=m.yaw%(Math.PI*2);c.lastInput=Date.now();
   }else if(m.type==='settle'&&rate('settle',3,1000)){
    // A standing player's client may nudge its server position to where it sees itself (small, walkable
    // corrections only), so range checks for seats, doors and balls agree with what the player sees.
    const x=Number(m.x),z=Number(m.z);if(!Number.isFinite(x)||!Number.isFinite(z)||c.seat||Math.hypot(c.vx,c.vz)>.25||Date.now()-c.lastInput<350&&Math.hypot(c.input.dx,c.input.dz)>.01)return;
    if(Math.hypot(x-c.x,z-c.z)<=.9&&!blocked(x,z))Object.assign(c,{x,z});
   }else if(m.type==='profile'&&rate('profile',4,1000)){c.name=clean(m.name,24)||'Explorer';c.avatar=sanitizeAvatar(m.avatar??{});
   }else if(m.type==='chat'&&rate('chat',4,8000)){const message=clean(m.text,240);if(message)broadcast({type:'chat',id,name:c.name,text:message,at:Date.now()});
   }else if(m.type==='emote'&&rate('emote',2,3000)&&['wave','dance','cheer'].includes(m.emote)){c.emote=m.emote;c.emoteAt=Date.now();
   }else if(m.type==='interact'&&rate('interact',4,1000)){const loc=LOCATIONS.find(l=>l.id===m.id);if(loc&&Math.hypot(c.x-loc.x,c.z-loc.z)<6)send(ws,{type:'interaction',id:loc.id});
   }else if(m.type==='collect'&&rate('collect',6,1000)){const token=TOKENS.find(t=>t.id===m.id);if(token&&!c.collected.has(token.id)&&Math.hypot(c.x-token.x,c.z-token.z)<2.2){c.collected.add(token.id);send(ws,{type:'collected',id:token.id});}
   }else if(['sit','stand','door','pickup','drop','shoot','ballReset'].includes(m.type)&&rate('world',8,1000)){
    // Physical interactions: validated against server-side position, possession and occupancy.
    const r=m.type==='sit'?world.sit(c,String(m.seat)):m.type==='stand'?world.stand(c):m.type==='door'?world.door(c,String(m.id),m.open===true,joined().filter(p=>p!==c)):m.type==='pickup'?world.pickup(c,String(m.ball)):m.type==='drop'?world.drop(c):m.type==='shoot'?world.shoot(c,Number(m.yaw),Number(m.charge)):world.resetBall(c,String(m.ball));
    send(ws,{type:'result',action:m.type,ref:m.ref,...r,seat:c.seat,ball:c.ball,x:c.x,z:c.z});
    if(r.ok&&m.type==='shoot')broadcast({type:'events',list:[{type:'shot',by:id,shot:r.shot,hoop:r.hoop}]});
   }else if(m.type==='report'&&rate('report',3,60000)&&clients.has(m.id)&&m.id!==id){
    const record={at:new Date().toISOString(),reporter:id,target:m.id,reason:clean(m.reason,300)||'Inappropriate behaviour'};
    reportQueue=reportQueue.then(async()=>{await mkdir(reportDir,{recursive:true});await appendFile(reportDir+'/reports.jsonl',JSON.stringify(record)+'\n');send(ws,{type:'notice',text:'Report saved for the room operator. You can also mute this player.'});}).catch(()=>send(ws,{type:'notice',text:'Report could not be saved. Please contact the room operator.'}));
   }
  });
  ws.on('close',()=>{world.release(c);clients.delete(id);broadcast({type:'left',id});});ws.on('error',()=>ws.close());
 });
 let last=performance.now(),tick=0;
 const simulation=setInterval(()=>{const now=performance.now(),dt=Math.min((now-last)/1000,.08);last=now;
  for(const c of clients.values()){if(!c.joined){if(Date.now()-c.joinedAt>10000)c.ws.close();continue;}
   if(c.seat){c.vx=c.vz=0;c.moving=false;c.input.jump=false;continue;}
   const active=Date.now()-c.lastInput<350,i=c.input;const speed=i.sprint?8:4.5,blend=1-Math.exp(-12*dt);
   c.vx+=((active?i.dx*speed:0)-c.vx)*blend;c.vz+=((active?i.dz*speed:0)-c.vz)*blend;
   Object.assign(c,moveWithCollisions(c.x,c.z,c.vx*dt,c.vz*dt));if(i.jump&&c.y===0)c.vy=7;i.jump=false;c.vy-=19*dt;c.y=Math.max(0,c.y+c.vy*dt);if(c.y===0)c.vy=0;
   c.moving=Math.hypot(c.vx,c.vz)>.2;c.sprinting=i.sprint;if(Date.now()-c.emoteAt>3000)c.emote='';
  }
  const events=world.step(dt,joined());
  if(events.length)broadcast({type:'events',list:events});
  if(world.revision!==worldRevision){worldRevision=world.revision;broadcast(worldState());}
  if(++tick%2===0)broadcast({type:'state',players:joined().map(({id,name,avatar,x,y,z,yaw,moving,sprinting,emote,emoteAt,seat,ball})=>({id,name,avatar,x,y,z,yaw,moving,sprinting,emote,emoteAt,seat,ball})),balls:world.balls.map(packBall)});
 },1000/30);
 const heartbeat=setInterval(()=>clients.forEach(c=>{if(!c.alive)c.ws.terminate();else{c.alive=false;c.ws.ping();}}),10000);
 return {http,wss,clients,start:()=>new Promise(resolve=>http.listen(port,host,()=>resolve(http.address()))),close:()=>new Promise(resolve=>{clearInterval(simulation);clearInterval(heartbeat);clients.forEach(c=>c.ws.terminate());wss.close();http.close(resolve);})};
}
function clean(value,max){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,max):'';}
