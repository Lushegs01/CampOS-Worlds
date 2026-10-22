import { createClasses } from '../shared/classes.mjs';
import { createEconomyService, principalOf } from './economy/service.mjs';
import { createFleet, vehicleContains } from '../shared/vehicles.mjs';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { SPAWN, LOCATIONS, TOKENS, moveWithCollisions, sanitizeAvatar, blocked } from '../shared/campus.mjs';
import { createWorld, packBall } from '../shared/world.mjs';
import { createMotionAuthority, MOTION_VERSION } from '../shared/prediction.mjs';
import { DRIVE_VERSION } from '../shared/driving.mjs';
import { advanceWalker, INPUT_HOLD_MS, MAX_STEP, JUMP_SPEED } from '../shared/movement.mjs';
import { cleanText, guestName } from '../shared/text.mjs';
import { createParties, PARTY_LIMITS } from './parties.mjs';
import { createDuels, DUEL_RULES } from './duels.mjs';
import { createAnalytics } from './analytics.mjs';
import { createChallenges } from './challenges.mjs';
import { TOUR } from '../shared/campus.mjs';
import { DEFAULT_LAYOUT, DORM_CAPACITY, DORM_INVITE_MS, DORM_INSIDE, DORM_OUTSIDE, validateLayout, furnitureAllows, furnitureBlocked, inDormRoom, nearDormDoor } from '../shared/dorm.mjs';
// Messages stay within 2 KB except the account handshake, which carries a Supabase access token.
// Lab experiment plans (bounded parameter objects) get a little more room than ordinary messages.
const MAX_MESSAGE=2048,MAX_LAB_MESSAGE=4096,MAX_AUTH_MESSAGE=6144;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Reading client values: ids and choices must be strings and numbers numbers. Never String() or Number()
 * a client value: JSON like {"toString":1} makes those throw, and a throw while handling a message is
 * uncaught and ends the room for everyone.
 */
const str=v=>typeof v==='string'?v:'',num=v=>typeof v==='number'?v:NaN;
/** `id` names this room instance. Parties and presence are scoped to it, so further instances can be added later. */
export function createRoom({port=3001,host='127.0.0.1',origins=['http://localhost:5173','http://127.0.0.1:5173'],capacity=48,adminToken='',invite='',reportDir='server/data',accounts={enabled:false},id:roomId='courtyard',partyLimits=PARTY_LIMITS,meetCooldownMs=20000,duelRules=DUEL_RULES,analytics=createAnalytics(),togetherMs=600000,labFile=null}={}){
 const clients=new Map(),bySocket=new WeakMap(),bans=new Set();let reportQueue=Promise.resolve();
 // ---- social: what others may know about a player, account-level blocks, and parties
 // A player who chose "appear offline" keeps their name and avatar (they are visibly here) but their
 // handle is withheld, so they do not show as online in anyone's friends list.
 const publicHandle=c=>c.account&&!c.account.hidden?c.account.handle:null;
 const describe=c=>({id:c.id,name:c.name,handle:publicHandle(c),verified:!!c.account});
 /** Has either player blocked the other? Blocks are account-level; guests cannot block or be blocked. */
 const blockedBetween=(a,b)=>!!(a.account&&b.account&&(a.social?.blocked.has(b.account.id)||b.social?.blocked.has(a.account.id)));
 const parties=createParties({send:(c,m)=>send(c.ws,m),describe,limits:partyLimits});
 // Seats, doors and basketballs are authoritative here; clients send requests, never outcomes.
 const fleet=createFleet(),classes=createClasses();
 const world=createWorld();let worldRevision=world.revision;
 const economy=createEconomyService({file:labFile});
 // Court Duel: one match at a time on The Courts, scored by the room's own physics.
 const duels=createDuels({world,players:()=>joined(),byId:id=>clients.get(id),send:(c,m)=>send(c.ws,m),broadcast:m=>broadcast(m),describe,rules:duelRules,record:m=>recordDuel(m),
  onStart:d=>d.players.forEach(p=>analytics.track(p,'duel_started')),onFinish:d=>d.players.forEach(p=>analytics.track(p,'duel_completed',{outcome:d.result.outcome}))});
 // Exploration and driving challenges, timed by the room from its own positions.
 const challenges=createChallenges({send:(c,m)=>send(c.ws,m),record:(c,ch,ms)=>{
  analytics.track(c,'challenge_completed',{challenge:ch.id});
  if(!c.account||!accounts.enabled){send(c.ws,{type:'notice',text:'Sign in to keep your challenge times and badges.'});return;}
  const id=c.account.id,run=randomUUID();
  retry(()=>accounts.recordChallenge(id,ch.id,ms,run),r=>{if(c.account?.id!==id)return;const awarded=Array.isArray(r?.awarded)?r.awarded:[];send(c.ws,{type:'progress',kind:'challenge',item:ch.id,awarded,best:r?.best_ms??ms});awarded.forEach(a=>analytics.track(c,'achievement_earned',{achievement:a}));},
   ()=>{if(c.account?.id===id)send(c.ws,{type:'notice',text:'Your challenge time could not be saved right now.'});});
 }});
 /** Retry a recording a few times with backoff; the ids passed make repeats harmless in the database. */
 function retry(call,done,failed,n=0){call().then(done).catch(e=>{if(n<3&&!e?.reason)setTimeout(()=>retry(call,done,failed,n+1),1500*2**n);else failed(e);});}
 /** Persist a duel between two signed-in players, retrying a few times; the match id makes retries safe. */
 function recordDuel(match){
  if(!accounts.enabled)return;
  const attempt=n=>accounts.recordDuel(match).then(r=>{
   duels.recorded(match.id,{ok:true,rated:!!r?.rated});
   for(const c of match.clients){if(clients.get(c.id)!==c||!c.account)continue;const side=c.account.id===match.a?'a':c.account.id===match.b?'b':null;if(!side)continue;
    send(c.ws,{type:'duelRecorded',id:match.id,rated:!!r?.rated,rating:r?.[side]?.rating??null,change:r?.[side]?.change??0});
    const awarded=Array.isArray(r?.['awarded_'+side])?r['awarded_'+side]:[];if(awarded.length)send(c.ws,{type:'progress',kind:'duel',item:match.id,awarded});awarded.forEach(a=>analytics.track(c,'achievement_earned',{achievement:a}));}
  }).catch(()=>{if(n<3)setTimeout(()=>attempt(n+1),1500*2**n);else duels.recorded(match.id,{ok:false});});
  attempt(0);
 }
 const joined=()=>[...clients.values()].filter(c=>c.joined);
 const worldState=()=>{const w=world.snapshot();return {type:'world',doors:w.doors,seats:w.seats};};
 const sendRaw=(ws,raw)=>{if(ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<65536)ws.send(raw);};
 const motionContext=c=>`${c.seat??''}|${c.vehicle??''}|${c.dorm?.host.id??''}`;
 const motionSnapshot=c=>c.motion?.snapshot(motionContext(c),performance.now());
 const send=(ws,data)=>{const c=bySocket.get(ws);const motion=c?.motion&&['welcome','result','dormResult','vehicleResult','meetUpResult','motion'].includes(data.type)?motionSnapshot(c):undefined;sendRaw(ws,JSON.stringify(motion?{...data,motion}:data));};
 // Serialised once for everyone (it used to be stringified again for every recipient).
 const broadcast=data=>{const raw=JSON.stringify(data);clients.forEach(c=>{if(c.joined)sendRaw(c.ws,raw);});};
 const http=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  if(req.url==='/health'){res.end(JSON.stringify({ok:true,players:[...clients.values()].filter(c=>c.joined).length,capacity}));return;}
  if(req.url==='/admin/kick'&&req.method==='POST'){
   const expected=Buffer.from('Bearer '+adminToken),actual=Buffer.from(req.headers.authorization??'');
   if(!adminToken||expected.length!==actual.length||!timingSafeEqual(expected,actual)){res.writeHead(403);res.end('{}');return;}
   let body='';try{for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('size');}const {id}=JSON.parse(body);const c=clients.get(id);if(c){bans.add(c.token);c.ws.close(4003,'Removed by room moderator');}res.end(JSON.stringify({removed:!!c}));}catch{res.writeHead(400);res.end('{}');}return;
  }res.writeHead(404);res.end('{}');
 });
 // Room messages are repetitive JSON (15 state messages a second): compressed, a phone receives a fraction
 // of the bytes (mobile data costs money). Small messages (inputs, chat) are sent as they are; the browser
 // decompresses natively. maxPayload still bounds the decompressed size of what a client sends.
 const wss=new WebSocketServer({noServer:true,maxPayload:MAX_AUTH_MESSAGE,perMessageDeflate:{threshold:512,zlibDeflateOptions:{level:1,memLevel:7},clientNoContextTakeover:true}});
 // ---- accounts: verified identity, profile projection and server-validated progression
 async function authenticate(c,token){
  const seq=++c.authSeq,live=()=>seq===c.authSeq&&clients.get(c.id)===c,reply=data=>{if(live()){send(c.ws,{type:'auth',...data});startSession(c);if(data.ok&&data.account)analytics.track(c,'account_linked');}};
  if(!accounts.enabled){reply({ok:false,code:'unavailable',reason:'Accounts are not set up on this room. You are exploring as a guest.'});return;}
  const who=await accounts.verify(token);if(!live())return;
  if(who.error){reply({ok:false,code:who.error==='unavailable'?'unavailable':'expired',reason:who.error==='unavailable'?'Your account could not be checked right now. You are exploring as a guest.':'Your session has expired. Please sign in again.'});return;}
  let snap;try{snap=await accounts.snapshot(who.id);}catch{reply({ok:false,code:'unavailable',reason:'Your profile could not be loaded right now. You are exploring as a guest.'});return;}
  if(!live())return;
  if(!snap){reply({ok:false,code:'no-profile',reason:'Create your profile to appear on campus with it.'});return;}
  // One account appears once: the newest verified window takes over (a reload or a second tab);
  // the older connection carries on as a guest and is told why.
  const prior=[...clients.values()].find(o=>o!==c&&o.account?.id===who.id);
  if(prior){if(prior.dorm)leaveDorm(prior,'Your account opened in another window, so you’re back in the common room.');prior.authSeq++;prior.account=null;prior.social=null;prior.hoops=[];prior.name='Explorer';parties.touch(prior);send(prior.ws,{type:'auth',ok:false,code:'replaced',reason:'You opened campus with this account in another window, so this one continues as a guest.'});}
  if(c.dorm)leaveDorm(c,'You signed in, so you’re back in the common room. Go to your room again to open it.');
  bindAccount(c,who.id,snap);reply({ok:true,account:{handle:snap.handle,display_name:snap.display_name}});
 }
 // Earned accents and titles are only ever taken from the saved, verified profile.
 const earned=snap=>Array.isArray(snap?.achievements)?snap.achievements.map(a=>a.id):[];
 const titleOf=snap=>typeof snap?.title==='string'&&earned(snap).includes(snap.title)?snap.title:null;
 // Analytics sessions start once we know who the player is (after any sign-in check), so a player keeps one pseudonym.
 function startSession(c){if(c.sessionStarted)return;c.sessionStarted=true;analytics.track(c,'session_start',{guest:!c.account});}
 function bindAccount(c,id,snap){c.account={id,handle:snap.handle,hidden:false,title:titleOf(snap)};c.name=clean(snap.display_name,32)||'Explorer';c.avatar=sanitizeAvatar(snap.avatar??{},earned(snap));for(const k of snap.progress?.keepsakes??[])c.collected.add(k);c.visited=new Set(snap.progress?.landmarks??[]);c.hoops=[];applySocial(c,snap.social);parties.touch(c);}
 function applySocial(c,s){queueMicrotask(()=>{if(c.dorm){checkRoomBlocks(c);for(const o of clients.values())if(o!==c&&o.dorm&&(o.dorm.host===c||c.dorm?.host===o))checkRoomBlocks(o);}});const before=c.social?.friends.size;c.social={friends:new Set(Array.isArray(s?.friends)?s.friends:[]),blocked:new Set(Array.isArray(s?.blocked)?s.blocked:[]),settings:{party_invites:'friends',appear_offline:false,...(s?.settings??{})}};if(c.account)c.account.hidden=c.social.settings.appear_offline===true;if(before!==undefined&&c.social.friends.size>before)analytics.track(c,'friend_connected');}
 /** Re-read friends, blocks and privacy after a change (debounced, so bursts collapse into one read). */
 function refreshSocial(c){
  if(!c.account||!accounts.enabled)return;clearTimeout(c.socialTimer);
  c.socialTimer=setTimeout(async()=>{const id=c.account?.id;if(!id)return;try{const s=await accounts.socialSnapshot(id);if(c.account?.id===id&&s){applySocial(c,s);parties.touch(c);}}catch{}},250);
 }
 async function refreshAccount(c){
  if(!c.account||Date.now()-c.profileAt<2000)return;c.profileAt=Date.now();const id=c.account.id;
  try{const snap=await accounts.snapshot(id);if(c.account?.id!==id||!snap)return;c.account.handle=snap.handle;c.account.title=titleOf(snap);c.name=clean(snap.display_name,32)||'Explorer';c.avatar=sanitizeAvatar(snap.avatar??{},earned(snap));applySocial(c,snap.social);parties.touch(c);}catch{}
 }
 function record(c,kind,item){
  if(!c.account||!accounts.enabled)return;const id=c.account.id;
  accounts.recordProgress(id,kind,item).then(r=>{if(c.account?.id===id){const awarded=Array.isArray(r?.awarded)?r.awarded:[];send(c.ws,{type:'progress',kind,item,awarded});awarded.forEach(a=>analytics.track(c,'achievement_earned',{achievement:a}));}})
   .catch(()=>{if(c.account?.id===id)send(c.ws,{type:'notice',text:'That could not be saved to your profile right now. It still counts on this device.'});});
 }
 // Basketball rounds of five shots, scored by the room's own physics, for signed-in players.
 function settleHoops(c,now){
  if(!c.account||c.hoops.length<5)return;const round=c.hoops.slice(0,5);if(!round.every(s=>s.done||now-s.at>4500))return;c.hoops.splice(0,5);
  const points=round.reduce((a,s)=>a+s.points,0),made=round.filter(s=>s.points>0).length,id=c.account.id;
  accounts.recordHoopsRound(id,points,made).then(r=>{if(c.account?.id===id)send(c.ws,{type:'progress',kind:'hoops',item:String(points),best:r?.best??points,awarded:Array.isArray(r?.awarded)?r.awarded:[]});}).catch(()=>{});
 }
 // Better Together: signed-in players accumulate time while in a party of three or more connected
 // members; at 10 minutes (measured here, never reported by a client) the badge is recorded once.
 let partyClock=Date.now();
 function partyTime(t){
  const dt=Math.min(2000,t-partyClock);partyClock=t;
  for(const p of parties.parties.values()){const here=[...p.members.values()].filter(m=>m.client?.joined);if(here.length<3)continue;
   for(const {client:c} of here){if(!c.account||c.togetherDone)continue;c.together=(c.together??0)+dt;
    if(c.together>=togetherMs&&accounts.enabled){c.togetherDone=true;const id=c.account.id;retry(()=>accounts.recordRoomAchievement(id,'better-together'),r=>{const awarded=Array.isArray(r?.awarded)?r.awarded:[];if(awarded.length&&c.account?.id===id){send(c.ws,{type:'progress',kind:'party',item:'better-together',awarded});analytics.track(c,'achievement_earned',{achievement:'better-together'});}},()=>{c.togetherDone=false;});}}}
 }
 /** The third identical message within 30 s is refused (copy-paste flooding). */
 function repeated(c,text){const t=Date.now(),key=text.toLowerCase().replace(/\s+/g,' ');c.lastTexts=(c.lastTexts??[]).filter(e=>t-e.at<30000);const n=c.lastTexts.filter(e=>e.key===key).length;if(n>=2)return true;c.lastTexts.push({key,at:t});return false;}
 // Who may invite whom: blocks either way stop it; then the invitee's own setting (accounts keep it in
 // their privacy settings, default friends only; guests choose per session, default everyone).
 function inviteToParty(c,t){
  if(!t?.joined||t===c)return {ok:false,reason:'That player isn’t here any more.'};
  if(blockedBetween(c,t))return {ok:false,reason:'You can’t invite this player.'};
  const pref=t.account?(t.social?.settings.party_invites??'friends'):t.guestInvites;
  if(pref==='nobody')return {ok:false,reason:`${t.name} isn’t accepting party invitations.`};
  if(pref==='friends'&&!(c.account&&t.social?.friends.has(c.account.id)))return {ok:false,reason:`${t.name} accepts party invitations from friends only.`};
  return parties.invite(c,t);
 }
 // Blocks may have changed since the invitation was sent: nobody joins a party with someone either has blocked.
 function joinParty(c,id,accept){
  const p=parties.parties.get(id);
  if(accept&&p&&[...p.members.values()].some(m=>m.client&&blockedBetween(c,m.client))){parties.respond(c,id,false);return {ok:false,reason:'You can’t join this party.'};}
  return parties.respond(c,id,accept);
 }
 // Meet up: travel to a party member. Only within your own party (mutual consent), never while
 // seated, driving or holding a ball, and with a cooldown. The room picks the spot, not the client.
 function meetUp(c,t){
  if(!t?.joined||t===c||!parties.sameParty(c,t))return {ok:false,reason:'You can travel only to members of your party.'};
  if(t.dorm)return {ok:false,reason:t.dorm.host===t?`${t.name} is in their room. Meet up when they come out.`:`${t.name} is visiting a room. Meet up when they come out.`};
  if(c.seat||c.vehicle||c.ball)return {ok:false,reason:'Stand up, leave the vehicle and put the ball down first.'};
  if(c.duel)return {ok:false,reason:'Finish your match first.'};
  if(c.run)return {ok:false,reason:'Finish or cancel your challenge first.'};
  const wait=c.meetAt+meetCooldownMs-Date.now();if(wait>0)return {ok:false,reason:`You can travel again in ${Math.ceil(wait/1000)} s.`};
  const spot=spotNear(t);if(!spot)return {ok:false,reason:`There’s no clear space next to ${t.name} right now.`};
  Object.assign(c,spot,{y:0,vy:0,vx:0,vz:0,input:{dx:0,dz:0,sprint:false,jump:false}});c.meetAt=Date.now();vacate(c);
  send(t.ws,{type:'notice',text:`${c.name} came to meet you.`});
  return {ok:true,x:spot.x,z:spot.z,to:t.id};
 }
 /** A clear standing spot beside a player, reachable from them in a straight line (never through a wall). */
 function spotNear(t){
  const others=joined().filter(o=>o!==t&&!o.vehicle);
  for(const r of t.vehicle?[3,4,5.5]:[1.4,2.2,3,4])for(let k=0;k<12;k++){
   const a=(t.yaw??0)+Math.PI+(k%2?1:-1)*Math.ceil(k/2)*Math.PI/6,x=t.x+Math.sin(a)*r,z=t.z+Math.cos(a)*r;
   if(blocked(x,z)||fleet.vehicles.some(v=>vehicleContains(v,x,z,.35))||others.some(o=>Math.hypot(o.x-x,o.z-z)<.7))continue;
   const q=moveWithCollisions(t.x,t.z,x-t.x,z-t.z);if(Math.hypot(q.x-x,q.z-z)<.05)return {x,z};
  }
  return null;
 }
 // ---- personal rooms (shared/dorm.mjs): one physical room behind Palm House. Each resident who goes in
 // hosts their own space; friends they invite (or, if they allow it, any friend) can visit while they are
 // in. Players see only those in the same space, and walk among the host's furniture.
 // c.dorm is { host: c, layout, invites, visitors } for a resident in their room, { host } for a visitor.
 // Guests' rooms last as long as the room server (by session); signed-in players' rooms are saved.
 const guestRooms=new Map(),GUEST_ROOMS=500;
 const place=(c,p)=>Object.assign(c,{x:p.x,z:p.z,y:0,yaw:p.yaw,vy:0,vx:0,vz:0,input:{dx:0,dz:0,sprint:false,jump:false},simAt:Date.now()});
 const hosting=c=>c.dorm?.host===c,layoutOf=c=>c.dorm?.host.dorm?.layout??null,spaceOf=c=>c.dorm?c.dorm.host.id:undefined;
 const blockedReason='You can’t visit this room.';
 /** Why `c` can't go into a room right now (null when they can). */
 function busy(c){
  if(c.seat||c.vehicle||c.ball)return 'Stand up, leave the vehicle and put the ball down first.';
  if(c.duel)return 'Finish your match first.';
  if(c.run)return 'Finish or cancel your challenge first.';
  return null;
 }
 async function enterDorm(c){
  if(hosting(c))return {ok:false,reason:'You’re already in your room.'};
  const why=busy(c);if(why)return {ok:false,reason:why};
  if(!c.dorm&&!nearDormDoor(c.x,c.z,false))return {ok:false,reason:'Go to the residents’ door at the back of Palm House.'};
  const seq=++c.dormSeq,id=c.account?.id;let layout;
  if(id&&accounts.enabled){try{layout=await accounts.dormLayout(id);}catch{return {ok:false,reason:'Your room could not be opened right now. Try again in a moment.'};}}
  else layout=guestRooms.get(c.token);
  if(seq!==c.dormSeq||clients.get(c.id)!==c||c.account?.id!==id||busy(c))return {ok:false,reason:'Try again.'};
  // Visiting someone and going home: from their room to yours (the same physical room, another space).
  if(c.dorm)vacate(c);
  const checked=validateLayout(layout??DEFAULT_LAYOUT);c.dorm={host:c,layout:checked.ok?checked.layout:DEFAULT_LAYOUT,invites:new Map(),visitors:new Set()};
  place(c,DORM_INSIDE);
  return {ok:true,host:c.id,layout:c.dorm.layout,x:c.x,z:c.z,yaw:c.yaw,keeps:id&&accounts.enabled?'account':'session'};
 }
 /** Out of a room without moving: a resident's visitors are shown out first. Returns whether they were in one. */
 function vacate(c){
  const room=c.dorm;if(!room)return false;
  c.dorm=null;c.dormSeq++;
  if(room.host===c)for(const v of room.visitors)leaveDorm(v,`${c.name} has left their room, so you’re back in the common room.`);
  else if(room.host.dorm?.visitors.delete(c)&&clients.get(room.host.id)===room.host)send(room.host.ws,{type:'dormVisitors',visitors:visitorsOf(room.host)});
  return true;
 }
 /** Back to the common room, by the door (also when signing in or out, which changes whose room it is). */
 function leaveDorm(c,reason){if(!vacate(c))return {ok:false,reason:'You’re not in a room.'};place(c,DORM_OUTSIDE);if(reason)send(c.ws,{type:'dormResult',action:'leave',ok:true,x:c.x,z:c.z,yaw:c.yaw,reason});return {ok:true,x:c.x,z:c.z,yaw:c.yaw};}
 const visitorsOf=h=>[...(h.dorm?.visitors??[])].map(v=>describe(v));
 const friends=(a,b)=>!!(a.account&&b.account&&a.social?.friends.has(b.account.id)&&b.social?.friends.has(a.account.id));
 const occupancy=h=>1+(h.dorm?.visitors.size??0);
 /** The resident invites a friend who is on campus (and not hidden: an invitation must not reveal them). */
 function inviteToRoom(c,to){
  if(!hosting(c))return {ok:false,reason:'Go to your room to invite friends.'};
  if(!c.account)return {ok:false,reason:'Sign in to invite friends to your room.'};
  const t=typeof to==='string'&&UUID.test(to)?[...clients.values()].find(o=>o.joined&&o.account?.id===to):null;
  if(!t||t.account.hidden||blockedBetween(c,t))return {ok:false,reason:'That friend isn’t on campus right now.'};
  if(!friends(c,t))return {ok:false,reason:'You can invite friends only.'};
  if(t.dorm?.host===c)return {ok:false,reason:`${t.name} is already here.`};
  if(occupancy(c)>=DORM_CAPACITY)return {ok:false,reason:`Your room is full (${DORM_CAPACITY} people).`};
  const expires=Date.now()+DORM_INVITE_MS;c.dorm.invites.set(t.account.id,expires);
  send(t.ws,{type:'dormInvite',host:c.id,from:describe(c),expires});
  return {ok:true,to:t.name};
 }
 /** A friend goes into a resident's room: invited, or allowed to drop in. Travels straight there. */
 function visitRoom(c,hostId){
  const h=clients.get(hostId);
  if(!c.account)return {ok:false,reason:'Sign in to visit friends’ rooms.'};
  if(!h||!h.joined||!hosting(h)||h===c)return {ok:false,reason:'That room isn’t open right now: its resident isn’t in.'};
  if(blockedBetween(c,h))return {ok:false,reason:blockedReason};
  if(c.dorm?.host===h)return {ok:false,reason:'You’re already there.'};
  const invited=(h.dorm.invites.get(c.account.id)??0)>Date.now(),dropIn=h.social?.settings.room_visits==='friends'&&friends(c,h);
  if(!invited&&!dropIn)return {ok:false,reason:friends(c,h)?`${h.name} welcomes visitors by invitation. Ask them to invite you.`:'You can visit friends’ rooms only.'};
  if(occupancy(h)>=DORM_CAPACITY)return {ok:false,reason:`${h.name}’s room is full.`};
  const why=busy(c);if(why)return {ok:false,reason:why};
  vacate(c);h.dorm.invites.delete(c.account.id);
  c.dorm={host:h};h.dorm.visitors.add(c);place(c,arrival(h));
  send(h.ws,{type:'notice',text:`${c.name} came to visit.`});send(h.ws,{type:'dormVisitors',visitors:visitorsOf(h)});
  return {ok:true,host:h.id,hostName:h.name,layout:h.dorm.layout,x:c.x,z:c.z,yaw:c.yaw};
 }
 /** Where a visitor arrives: inside the door, beside (not on top of) everyone already in the room. */
 function arrival(h){
  const here=[h,...h.dorm.visitors].filter(o=>o.dorm?.host===h);
  for(const [dx,dz] of [[0,0],[.9,0],[-.9,0],[0,.8],[.9,.8],[-.9,.8],[.45,-.8],[-.45,-.8]]){
   const x=DORM_INSIDE.x+dx,z=DORM_INSIDE.z+dz;
   if(!blocked(x,z)&&!furnitureBlocked(h.dorm.layout,x,z)&&here.every(o=>Math.hypot(o.x-x,o.z-z)>.7))return {x,z,yaw:DORM_INSIDE.yaw};
  }
  return DORM_INSIDE;
 }
 /** The resident shows a visitor out. */
 function showOut(c,id){
  const v=clients.get(id);
  if(!hosting(c)||!v||v.dorm?.host!==c)return {ok:false,reason:'That visitor isn’t in your room.'};
  leaveDorm(v,`${c.name} has shown you out, so you’re back in the common room.`);
  return {ok:true,visitors:visitorsOf(c)};
 }
 /** After a block (either way), nobody stays in a room with someone who blocked them or whom they blocked. */
 function checkRoomBlocks(c){
  const room=c.dorm;if(!room)return;
  if(room.host===c){for(const v of room.visitors)if(blockedBetween(c,v))leaveDorm(v,'You’re back in the common room.');}
  else if(blockedBetween(c,room.host))leaveDorm(c,'You’re back in the common room.');
 }
 async function saveDorm(c,raw){
  if(!c.dorm)return {ok:false,reason:'Go to your room to arrange it.'};
  if(!hosting(c))return {ok:false,reason:'Only the resident can arrange this room.'};
  const r=validateLayout(raw);if(!r.ok)return r;
  c.dorm.layout=r.layout;
  for(const v of c.dorm.visitors)send(v.ws,{type:'dormLayout',layout:r.layout});
  const id=c.account?.id;
  if(!id||!accounts.enabled){guestRooms.delete(c.token);guestRooms.set(c.token,r.layout);if(guestRooms.size>GUEST_ROOMS)guestRooms.delete(guestRooms.keys().next().value);return {ok:true,layout:r.layout,saved:'session'};}
  try{await accounts.saveDorm(id,r.layout);return {ok:true,layout:r.layout,saved:'account'};}
  catch(e){return {ok:true,layout:r.layout,saved:'session',reason:e?.reason??'Your room is arranged, but it could not be saved to your account right now.'};}
 }
 // Where recently departed sessions stood (session token -> position), so a reconnect resumes there.
 const recent=new Map();
 /** A connection leaves the room (closed, replaced by a newer one of the same session, or removed). Runs once. */
 function depart(c,code){
  if(c.departed)return;c.departed=true;const was=c.joined;c.joined=false;
  clearTimeout(c.socialTimer);challenges.release(c);
  if(c.sessionStarted)analytics.track(c,'session_end',{seconds:(Date.now()-c.joinedAt)/1000,reason:code===4003?'removed':'closed'});
  const driving=!!c.vehicle;
  duels.release(c);fleet.release(c);classes.release(c);world.release(c);parties.disconnect(c);
  // A resident reconnects outside their room's door: the room is entered (and its layout loaded) only on request.
  const at=c.dorm||inDormRoom(c.x,c.z)?DORM_OUTSIDE:c;vacate(c);
  if(was&&c.token&&!driving)recent.set(c.token,{x:at.x,z:at.z,yaw:at.yaw,at:Date.now()});
  clients.delete(c.id);if(was)broadcast({type:'left',id:c.id});
 }
 http.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/ws'||!origins.includes(req.headers.origin)||clients.size>=capacity){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
 });
 wss.on('connection',ws=>{
  const id=randomUUID(),now=Date.now();const c={id,ws,joined:false,token:'',name:'',avatar:sanitizeAvatar(),account:null,social:null,guestInvites:'everyone',party:null,meetAt:0,recentChat:[],authSeq:0,profileAt:0,visited:new Set(),hoops:[],...SPAWN,yaw:Math.PI,moving:false,sprinting:false,emote:'',emoteAt:0,vy:0,vx:0,vz:0,seat:null,ball:null,dorm:null,dormSeq:0,input:{dx:0,dz:0,sprint:false,jump:false},lastInput:now,alive:true,joinedAt:now,limits:{},collected:new Set()};clients.set(id,c);bySocket.set(ws,c);
  ws.on('pong',()=>{c.alive=true;});
  const rate=(key,max,window=1000)=>{const t=Date.now();const r=c.limits[key]??{at:t,n:0};if(t-r.at>=window){r.at=t;r.n=0;}c.limits[key]=r;return ++r.n<=max;};
  ws.on('message',data=>{
   if(c.departed)return;
   if(!rate('all',75)){ws.close(4008,'Too many requests');return;}
   const raw=data.toString();let m;try{m=JSON.parse(raw);}catch{return;}if(!m||typeof m!=='object')return;
   if(raw.length>(m.type==='lab'?MAX_LAB_MESSAGE:MAX_MESSAGE)&&m.type!=='auth'&&m.type!=='join'){
    // Answer an oversized lab request so its sender is not left waiting for a timeout.
    if(m.type==='lab'&&c.joined)send(ws,{type:'labResult',ref:Number.isInteger(m.ref)?m.ref:null,ok:false,reason:'This lab request is too large. Shorten the label or reduce policies or sensitivity values.'});
    return;
   }
   if(m.type==='join'&&!c.joined){
    if(invite&&m.invite!==invite){ws.close(4001,'Invitation required');return;}
    const token=typeof m.token==='string'&&/^[a-f0-9]{48}$/.test(m.token)?m.token:randomBytes(24).toString('hex');
    if(bans.has(token)){ws.close(4003,'Removed by room moderator');return;}
    // The same session joining again while the room still holds its old connection: a phone that changed
    // networks reconnects before the room notices the old socket is dead (up to 20 s), or a duplicated tab.
    // The newest connection takes over; the older one is told why and does not reconnect.
    const prior=[...clients.values()].find(v=>v!==c&&v.token===token&&v.joined);
    if(prior){depart(prior,4004);prior.ws.close(4004,'Session opened in another window');}
    c.token=token;c.name=guestName(m.name);c.avatar=sanitizeAvatar(m.avatar??{});c.joined=true;
    // A reconnecting session carries on where the room last had it (if that spot is still clear), not at the gate.
    const back=recent.get(token);recent.delete(token);
    if(back&&Date.now()-back.at<partyLimits.graceMs&&!blocked(back.x,back.z)&&!inDormRoom(back.x,back.z)&&!fleet.vehicles.some(v=>vehicleContains(v,back.x,back.z)))Object.assign(c,{x:back.x,z:back.z,y:0,yaw:back.yaw});
    if(m.movement===MOTION_VERSION)c.motion=createMotionAuthority(c,performance.now());
    send(ws,{type:'welcome',id,token,position:{x:c.x,y:c.y,z:c.z},yaw:c.yaw,world:world.snapshot(),vehicles:fleet.snapshot(),drive:DRIVE_VERSION,classes:classes.snapshot(),accounts:!!accounts.enabled,room:{id:roomId,name:'The Courtyard'},party:{size:partyLimits.size},duel:duels.view()});
    // A reload or dropped connection with the same session token takes its party place back.
    parties.reconnect(c);
    c.analytics=m.analytics&&typeof m.analytics==='object'?{consent:m.analytics.consent===true,install:typeof m.analytics.install==='string'?m.analytics.install.slice(0,64):''}:null;
    // A signed-in player joins as a guest and is upgraded once the room has verified the token.
    if(typeof m.access==='string'&&rate('auth',4,60000))authenticate(c,m.access);else startSession(c);return;
   }if(!c.joined)return;
   if(m.type==='lab'){
    if(!rate('lab',12,10000)){send(ws,{type:'labResult',ref:Number.isInteger(m.ref)?m.ref:null,ok:false,reason:'Wait a moment before using this workstation again.'});return;}
    const principal=principalOf(c);
    economy.request(c,m).then(r=>{if(clients.get(id)===c&&c.joined&&principalOf(c)===principal)send(ws,{type:'labResult',ref:Number.isInteger(m.ref)?m.ref:null,...r});});
   }else if(m.type==='classAction'&&rate('classAction',5)){const r=classes.action(c,m);if(!r.ok)send(ws,{type:'notice',text:r.reason});broadcast({type:'classes',sessions:classes.snapshot()});
   }else if(m.type==='vehicleInput'&&rate('vehicleInput',35)){fleet.control(c,m);
   // Sequenced driving commands (shared/driving.mjs), batched about 30 times a second by the client.
   }else if(m.type==='vehicleDrive'&&rate('vehicleDrive',40)){fleet.drive(c,m,Date.now(),joined());
   }else if(['vehicleEnter','vehicleExit','vehicleRecover'].includes(m.type)&&rate('vehicleAction',5)){
    const r=m.type==='vehicleEnter'?fleet.enter(c,str(m.id),m.seat??0):m.type==='vehicleExit'?fleet.exit(c,joined()):fleet.recover(c,joined());
    send(ws,{type:'vehicleResult',...r,vehicle:c.vehicle,vehicleSeat:c.vehicleSeat,x:c.x,z:c.z});broadcast({type:'vehicles',vehicles:fleet.snapshot()});
   }else if(m.type==='move'&&rate('input',105,3000)){
    if(!c.motion)return;
    const accepted=c.motion.receive(m,motionContext(c),performance.now(),(x,z,fx,fz)=>footAllowed(c,x,z,fx,fz),!!(c.seat||c.vehicle));
    c.lastInput=Date.now();if(!accepted)send(ws,{type:'motion'});
   }else if(m.type==='input'&&rate('input',35)){
    if(c.motion||c.vehicle)return;
    if(![m.dx,m.dz,m.yaw].every(Number.isFinite))return;
    // Walk on to this moment with the previous input first: a new input applies from when it arrived.
    const t=Date.now();if(c.seat)c.simAt=t;else walk(c,t);
    const length=Math.max(1,Math.hypot(m.dx,m.dz));c.input={dx:m.dx/length,dz:m.dz/length,sprint:m.sprint===true,jump:c.input.jump||m.jump===true};c.yaw=m.yaw%(Math.PI*2);c.lastInput=t;
   }else if(m.type==='settle'&&rate('settle',3,1000)){
    if(c.motion)return;
    // A standing player's client may nudge its server position to where it sees itself (small, walkable
    // corrections only), so range checks for seats, doors and balls agree with what the player sees.
    const x=num(m.x),z=num(m.z);if(!Number.isFinite(x)||!Number.isFinite(z)||c.seat||c.vehicle||Math.hypot(c.vx,c.vz)>.25||Date.now()-c.lastInput<INPUT_HOLD_MS&&Math.hypot(c.input.dx,c.input.dz)>.01)return;
    if(Math.hypot(x-c.x,z-c.z)>.9||blocked(x,z)||furnitureBlocked(layoutOf(c),x,z))return;
    // Only as far as the player could walk there: never through a wall, a fence or a closed door.
    const q=moveWithCollisions(c.x,c.z,x-c.x,z-c.z);Object.assign(c,Math.hypot(q.x-x,q.z-z)<.05?{x,z}:q);
   }else if(m.type==='auth'&&rate('auth',4,60000)){
    if(typeof m.token==='string')authenticate(c,m.token);
    else{c.authSeq++;if(c.account){if(c.dorm)leaveDorm(c,'You signed out, so you’re back in the common room.');c.account=null;c.social=null;c.hoops=[];c.name=guestName(m.name);c.avatar=sanitizeAvatar(m.avatar??{});parties.touch(c);}send(ws,{type:'auth',ok:true,account:null});}
   }else if(m.type==='profile'&&rate('profile',4,1000)){
    // Signed-in names and appearance come from the saved profile, never from the message.
    if(c.account)refreshAccount(c);else{c.name=guestName(m.name);c.avatar=sanitizeAvatar(m.avatar??{});parties.touch(c);}
   }else if(m.type==='chat'&&rate('chat',4,8000)){
    // Public room chat: everyone present, except where either player has blocked the other.
    const text=cleanText(m.text,240);if(!text)return;
    if(repeated(c,text)){send(ws,{type:'notice',text:'Please don’t repeat the same message.'});return;}
    const out={type:'chat',channel:'room',...describe(c),text,at:Date.now()};c.recentChat=[...c.recentChat,{text,at:out.at}].slice(-5);
    for(const o of clients.values())if(o.joined&&!blockedBetween(c,o))send(o.ws,out);
   }else if(m.type==='partyChat'&&rate('partyChat',5,8000)){
    const p=parties.partyOf(c),text=cleanText(m.text,240);if(!p){send(ws,{type:'notice',text:'Join a party to use party chat.'});return;}if(!text)return;
    if(repeated(c,text)){send(ws,{type:'notice',text:'Please don’t repeat the same message.'});return;}
    const out={type:'chat',channel:'party',party:p.id,...describe(c),text,at:Date.now()};
    for(const mem of p.members.values())if(mem.client&&!blockedBetween(c,mem.client))send(mem.client.ws,out);
   }else if(m.type==='party'&&rate('party',8,5000)){
    const target=typeof m.id==='string'?clients.get(m.id):null;
    const wasIn=!!parties.partyOf(c);
    const r=m.action==='create'?parties.create(c):m.action==='invite'?(rate('partyInvite',6,30000)?inviteToParty(c,target):{ok:false,reason:'You’re sending invitations quickly. Wait a moment.'}):m.action==='respond'?joinParty(c,str(m.party),m.accept===true):m.action==='leave'?parties.leave(c):m.action==='kick'?parties.kick(c,str(m.id)):m.action==='promote'?parties.promote(c,str(m.id)):m.action==='uninvite'?parties.uninvite(c,str(m.id)):{ok:false,reason:'Unknown party action.'};
    send(ws,{type:'partyResult',action:str(m.action).slice(0,16),ref:Number.isInteger(m.ref)?m.ref:null,...r});
    if(r.ok&&!wasIn&&parties.partyOf(c)&&(m.action==='create'||m.action==='invite'))analytics.track(c,'party_created');
    if(r.ok&&r.joined)analytics.track(c,'party_joined',{size:parties.partyOf(c)?.members.size??0});
   }else if(m.type==='duel'&&rate('duel',6,5000)){
    const target=typeof m.id==='string'?clients.get(m.id):null;
    const r=m.action==='challenge'?(target&&blockedBetween(c,target)?{ok:false,reason:'You can’t challenge this player.'}:duels.challenge(c,target)):m.action==='respond'?duels.respond(c,str(m.challenge),m.accept===true):m.action==='concede'?duels.concede(c):{ok:false,reason:'Unknown duel action.'};
    send(ws,{type:'duelResult',action:str(m.action).slice(0,16),ref:Number.isInteger(m.ref)?m.ref:null,...r});
   }else if(m.type==='challenge'){
    const r=!rate('challenge',8,10000)?{ok:false,reason:'Wait a moment and try again.'}:m.action==='start'?challenges.start(c,str(m.id)):m.action==='cancel'?challenges.cancel(c):{ok:false,reason:'Unknown challenge action.'};
    send(ws,{type:'challengeResult',action:str(m.action).slice(0,16),...r});
   }else if(m.type==='checkin'){
    // In-game event attendance: the room checks the player is at the event's place; the database
    // checks the event, its place and its time window. Gameplay attendance only, never academic.
    const loc=LOCATIONS.find(l=>l.id===m.location),reply=r=>send(ws,{type:'checkinResult',event:typeof m.event==='string'?m.event.slice(0,40):null,...r});
    if(!rate('checkin',4,10000)){reply({ok:false,reason:'Wait a moment before checking in again.'});return;}
    if(!c.account||!accounts.enabled){reply({ok:false,reason:'Sign in to check in at events.'});return;}
    if(!loc||typeof m.event!=='string'||!UUID.test(m.event)){reply({ok:false,reason:'That event is not available.'});return;}
    if(Math.hypot(c.x-loc.x,c.z-loc.z)>15){reply({ok:false,reason:`Go to ${loc.name} to check in.`});return;}
    const id=c.account.id;
    accounts.checkin(id,m.event,loc.id).then(r=>{
     if(c.account?.id!==id)return;
     reply({ok:!!r?.checked_in,reason:r?.reason,fresh:!!r?.new,title:r?.event});
     if(r?.new)analytics.track(c,'event_checkin');
     const awarded=Array.isArray(r?.awarded)?r.awarded:[];if(awarded.length){send(ws,{type:'progress',kind:'checkin',item:m.event,awarded});awarded.forEach(a=>analytics.track(c,'achievement_earned',{achievement:a}));}
     // The organiser earns Community Builder when the third other player checks in.
     if(r?.organizer)for(const o of clients.values())if(o.account?.id===r.organizer){send(o.ws,{type:'progress',kind:'checkin',item:m.event,awarded:['community-builder']});analytics.track(o,'achievement_earned',{achievement:'community-builder'});}
    }).catch(e=>reply({ok:false,reason:e?.reason??'Check-in is unavailable right now. Try again in a moment.'}));
   }else if(m.type==='dorm'){
    const action=str(m.action),reply=r=>{if(clients.get(id)===c)send(ws,{type:'dormResult',ref:Number.isSafeInteger(m.ref)?m.ref:null,action:action.slice(0,8),...r});};
    if(!rate('dorm',10,5000)){reply({ok:false,reason:'Wait a moment and try again.'});return;}
    if(c.vehicle&&action!=='leave'){reply({ok:false,reason:'Leave the vehicle first.'});return;}
    if(action==='enter')enterDorm(c).then(reply);
    else if(action==='leave')reply(leaveDorm(c));
    else if(action==='save')saveDorm(c,m.layout).then(reply);
    else if(action==='invite')reply(rate('dormInvite',6,30000)?inviteToRoom(c,m.to):{ok:false,reason:'You’re sending invitations quickly. Wait a moment.'});
    else if(action==='visit')reply(visitRoom(c,str(m.host)));
    else if(action==='showOut')reply(showOut(c,str(m.id)));
    else reply({ok:false,reason:'Unknown room action.'});
   }else if(m.type==='meetUp'){
    const r=rate('meetUp',5,5000)?meetUp(c,clients.get(str(m.id))):{ok:false,reason:'Wait a moment before travelling again.'};send(ws,{type:'meetUpResult',...r});
   }else if(m.type==='prefs'&&rate('prefs',4,5000)){
    // Guests choose who may invite them for this session; accounts keep the setting in their profile.
    if(['everyone','nobody'].includes(m.partyInvites))c.guestInvites=m.partyInvites;
    if(m.analytics&&typeof m.analytics==='object'){c.analytics={consent:m.analytics.consent===true,install:typeof m.analytics.install==='string'?m.analytics.install.slice(0,64):''};startSession(c);}
   }else if(m.type==='telemetry'&&rate('telemetry',1,60000)){
    // How many times this browser failed to reach the room before this session (reliability metric).
    if(Number.isInteger(m.failures)&&m.failures>0)analytics.track(c,'connection_failures',{count:Math.min(m.failures,1000)});
   }else if(m.type==='socialNotify'&&rate('socialNotify',8,10000)){
    // A content-free nudge between signed-in players after a friend or message change, so the other
    // player's client re-reads its (access-controlled) inbox now instead of at its next poll. The
    // room relays no content, so a forged nudge can only cause a harmless refresh.
    if(!c.account||typeof m.to!=='string'||!UUID.test(m.to)||!['friend','message'].includes(m.kind))return;
    for(const o of clients.values())if(o.account?.id===m.to&&!o.social?.blocked.has(c.account.id)){if(m.kind==='friend')refreshSocial(o);send(o.ws,{type:'social',kind:m.kind});}
    if(m.kind==='friend')refreshSocial(c);
   }else if(m.type==='socialRefresh'&&rate('socialRefresh',4,10000)){refreshSocial(c);
   }else if(m.type==='emote'&&rate('emote',2,3000)&&['wave','dance','cheer'].includes(m.emote)){c.emote=m.emote;c.emoteAt=Date.now();
   }else if(m.type==='interact'&&rate('interact',4,1000)){const loc=LOCATIONS.find(l=>l.id===m.id);if(loc&&Math.hypot(c.x-loc.x,c.z-loc.z)<6){send(ws,{type:'interaction',id:loc.id});
     if(TOUR.includes(loc.id)&&!c.toured?.has(loc.id)){(c.toured??=new Set()).add(loc.id);if(TOUR.every(t=>c.toured.has(t)))analytics.track(c,'tutorial_completed');}if(c.account&&!c.visited.has(loc.id)){c.visited.add(loc.id);record(c,'landmark',loc.id);}}
   }else if(m.type==='collect'&&rate('collect',6,1000)){const token=TOKENS.find(t=>t.id===m.id);if(token&&!c.collected.has(token.id)&&Math.hypot(c.x-token.x,c.z-token.z)<2.2){c.collected.add(token.id);send(ws,{type:'collected',id:token.id});record(c,'keepsake',token.id);}
   }else if(['sit','stand','door','pickup','drop','shoot','ballReset'].includes(m.type)&&rate('world',8,1000)){
    if(c.vehicle)return;
    // Physical interactions: validated against server-side position, possession and occupancy.
    const held=c.ball,r=m.type==='sit'?world.sit(c,str(m.seat)):m.type==='stand'?world.stand(c):m.type==='door'?world.door(c,str(m.id),m.open===true,joined().filter(p=>p!==c)):m.type==='pickup'?world.pickup(c,str(m.ball)):m.type==='drop'?world.drop(c):m.type==='shoot'?world.shoot(c,num(m.yaw),num(m.charge)):world.resetBall(c,str(m.ball));
    send(ws,{type:'result',action:m.type,ref:Number.isInteger(m.ref)?m.ref:null,...r,seat:c.seat,ball:c.ball,x:c.x,z:c.z});
    if(r.ok&&m.type==='shoot'){broadcast({type:'events',list:[{type:'shot',by:id,shot:r.shot,hoop:r.hoop}]});duels.onShot(c,r.shot,held);if(c.account&&!c.duel)c.hoops.push({id:r.shot,at:Date.now(),points:0,done:false});}
   }else if(m.type==='report'&&rate('report',3,60000)&&clients.has(m.id)&&m.id!==id){
    // The reported player's last few public chat lines (already seen by everyone present) go with
    // the report as context. Private messages are reported through the account service instead.
    const t=clients.get(m.id),context=['player-list','room-chat','party'].includes(m.context)?m.context:'player-list';
    const record={at:new Date().toISOString(),room:roomId,context,reporter:id,reporterAccount:c.account?.id??null,target:m.id,targetName:t.name,targetAccount:t.account?.id??null,targetHandle:t.account?.handle??null,reason:clean(m.reason,300)||'Inappropriate behaviour',recentChat:t.recentChat};
    reportQueue=reportQueue.then(async()=>{await mkdir(reportDir,{recursive:true});await appendFile(reportDir+'/reports.jsonl',JSON.stringify(record)+'\n');send(ws,{type:'notice',text:'Report saved for the room operator. You can also mute this player.'});}).catch(()=>send(ws,{type:'notice',text:'Report could not be saved. Please contact the room operator.'}));
   }
  });
  ws.on('close',code=>depart(c,code));ws.on('error',()=>ws.close());
 });
 const cm=v=>Math.round(v*100)/100,mrad=v=>Math.round(v*1000)/1000;
 const packVehicle=v=>({...v,x:cm(v.x),z:cm(v.z),yaw:mrad(v.yaw),speed:cm(v.speed),steering:mrad(v.steering),wheel:mrad(v.wheel)});
 const sentVehicles=new Map();
 // `ts`: the room time each changed vehicle's state represents (a driven one can trail the clock; shared/vehicles.mjs).
 function changedVehicles(){const out=[],now=Date.now();for(const v of fleet.snapshot()){const p=packVehicle(v),key=JSON.stringify(p);if(sentVehicles.get(v.id)!==key){sentVehicles.set(v.id,key);out.push({...p,ts:fleet.stateTime(v.id,now)});}}return out;}
 // The last input applies for INPUT_HOLD_MS after it arrived, then the player coasts to a stop
 // (shared/movement.mjs); vehicles block walking into them, never walking out of one's footprint.
 const footAllowed=(c,x,z,fx,fz)=>!fleet.vehicles.some(v=>vehicleContains(v,x,z)&&!vehicleContains(v,fx,fz))&&furnitureAllows(layoutOf(c),x,z,fx,fz);
 const walk=(c,t)=>advanceWalker(c,c.input,c.lastInput,t,(x,z,fx,fz)=>footAllowed(c,x,z,fx,fz));
 let last=performance.now(),tick=0;
 const simulation=setInterval(()=>{const now=performance.now(),dt=Math.min((now-last)/1000,MAX_STEP),wall=Date.now();last=now;
  for(const c of clients.values()){if(!c.joined){if(Date.now()-c.joinedAt>10000)c.ws.close();continue;}
   if(c.motion){if(wall-c.lastInput>INPUT_HOLD_MS)c.moving=false;if(wall-c.emoteAt>3000)c.emote='';continue;}
   if(c.seat||c.vehicle){c.vx=c.vz=0;c.moving=false;c.input.jump=false;c.simAt=wall;continue;}
   const i=c.input;if(i.jump&&c.y===0)c.vy=JUMP_SPEED;i.jump=false;
   walk(c,wall);
   c.moving=Math.hypot(c.vx,c.vz)>.2;c.sprinting=i.sprint;if(Date.now()-c.emoteAt>3000)c.emote='';
  }
  fleet.step(dt,joined());classes.step(joined());
  const events=world.step(dt,joined());
  if(events.length)broadcast({type:'events',list:events});
  duels.step(events);
  for(const e of events)if(e.type==='score'){const shot=clients.get(e.by)?.hoops.find(s=>s.id===e.shot);if(shot){shot.points=e.points;shot.done=true;}}
  if(tick%3===0)challenges.step(joined());
  if(tick%15===0){const t=Date.now();for(const c of clients.values())settleHoops(c,t);parties.step();partyTime(t);for(const [k,r] of recent)if(t-r.at>partyLimits.graceMs)recent.delete(k);}
  if(world.revision!==worldRevision){worldRevision=world.revision;broadcast(worldState());}
  // 15 Hz state: positions to the centimetre and angles to the milliradian (the client interpolates), and
  // only the vehicles that changed since the last broadcast (joining clients get the whole fleet in welcome).
  if(++tick%2===0){const data={type:'state',at:Date.now(),players:joined().map(({id,name,avatar,x,y,z,yaw,moving,sprinting,emote,emoteAt,seat,ball,vehicle,vehicleSeat,account,dorm})=>({id,name,avatar,space:dorm?dorm.host.id:undefined,x:cm(x),y:cm(y),z:cm(z),yaw:mrad(yaw),moving,sprinting,emote,emoteAt,seat,ball,vehicle,vehicleSeat,handle:account&&!account.hidden?account.handle:null,verified:!!account,title:account?.title??null})),balls:world.balls.map(packBall),vehicles:changedVehicles(),classes:classes.snapshot()};
   // Each driver also gets what the room has applied of their driving commands, to reconcile against.
   const raw=JSON.stringify(data);for(const c of clients.values())if(c.joined){const motion=motionSnapshot(c),drive=c.vehicle&&c.vehicleSeat===0?fleet.driveState(c.vehicle):null;
    sendRaw(c.ws,motion||drive?raw.slice(0,-1)+(motion?',"motion":'+JSON.stringify(motion):'')+(drive?',"drive":'+JSON.stringify(drive):'')+'}':raw);}
  }
 },1000/30);
 const heartbeat=setInterval(()=>clients.forEach(c=>{if(!c.alive)c.ws.terminate();else{c.alive=false;c.ws.ping();}}),10000);
 return {http,wss,clients,fleet,parties,duels,challenges,world,economy,start:()=>new Promise(resolve=>http.listen(port,host,()=>resolve(http.address()))),close:async()=>{await economy.close();return new Promise(resolve=>{clearInterval(simulation);clearInterval(heartbeat);clients.forEach(c=>c.ws.terminate());wss.close();http.close(resolve);});}};
}
function clean(value,max){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,max):'';}
