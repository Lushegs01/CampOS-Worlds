import { BUILDINGS } from './expansion.mjs';
export const CLASSROOMS=[{id:'classroom-d1',name:'Studio D1',x:34.4,z:-39.5,w:6,d:6},...BUILDINGS.filter(b=>b.district==='academic'||b.district==='learning').map(b=>({...b}))];
export const LESSON=[
 {title:'Designing a walkable university',text:'A short route is only useful if people can use it safely. Compare a shaded pedestrian path with a road shared by fast vehicles.'},
 {title:'Make a choice together',text:'Where should a campus invest first: shaded walking routes, frequent shuttles, or accessible entrances? Vote and discuss the trade-offs in room chat.'},
 {title:'Take the idea outside',text:'Travel to another district together. Look at its entrance, parking and pedestrian approach. Share one improvement with your group.'},
];
export function classroomAt(p){return CLASSROOMS.find(b=>Math.abs(p.x-b.x)<b.w/2-.4&&Math.abs(p.z-b.z)<b.d/2-.4);}
export function createClasses(){const sessions=new Map();return {sessions,snapshot:()=>[...sessions.values()].map(s=>({...s,votes:{...s.votes}})),
 action(p,m){const room=classroomAt(p);if(!room||room.id!==m.room||p.vehicle)return {ok:false,reason:'Enter this classroom on foot first.'};let s=sessions.get(room.id);
 if(m.action==='host'){if(s?.host&&s.host!==p.id)return {ok:false,reason:'A host is already leading this session.'};const topic=typeof m.topic==='string'?m.topic.replace(/[\x00-\x1f]/g,'').trim().slice(0,120):'';s={room:room.id,host:p.id,hostName:p.name||'Local explorer',topic:topic||LESSON[0].title,slide:0,votes:{},demo:true};sessions.set(room.id,s);return {ok:true};}
 if(!s)return {ok:false,reason:'Start a demonstration session first.'};
 if(m.action==='vote'){if(!p.seat)return {ok:false,reason:'Take a seat to join the poll.'};if(!Number.isInteger(m.option)||m.option<0||m.option>2)return {ok:false,reason:'Invalid poll choice.'};s.votes[p.id]=m.option;return {ok:true};}
 if(s.host!==p.id)return {ok:false,reason:'Only the host can change this session.'};
 if(m.action==='next')s.slide=(s.slide+1)%LESSON.length;else if(m.action==='end')sessions.delete(room.id);else return {ok:false,reason:'Unknown class action.'};return {ok:true};},
 release(p){for(const s of sessions.values()){delete s.votes[p.id];if(s.host===p.id){s.host=null;s.hostName='Host disconnected';}}},
 step(players){for(const s of sessions.values()){const host=players.find(p=>p.id===s.host);if(s.host&&(!host||classroomAt(host)?.id!==s.room)){s.host=null;s.hostName='Host left the classroom';}}},
};}
