export type ServiceId = 'scanmark'|'unireg'|'clearr'|'nada'|'haloft';
export const services:{id:ServiceId;name:string;category:string;description:string}[]=[
 {id:'scanmark',name:'ScanMark',category:'Attendance',description:'Open authorized attendance tools through your institution. Exploring this world never records attendance.'},
 {id:'unireg',name:'UniReg',category:'Academics',description:'Course registration and academic administration stay in your authenticated CampOS workspace.'},
 {id:'clearr',name:'Clearr',category:'Finance & clearance',description:'View authorized finance and clearance information in Core. This demo does not show balances or take payments.'},
 {id:'nada',name:'NADA',category:'Community',description:'Find student conversations and communities in your institution’s authorized NADA workspace.'},
 {id:'haloft',name:'Haloft',category:'Student living',description:'Explore housing listings and property tours when your institution has connected Haloft.'},
];
export interface ServiceAdapter {mode:'demo'|'core'; launch(id:ServiceId):Promise<{kind:'demo';message:string}|{kind:'authorized-navigation';url:string}>;}
// A real adapter must obtain allowlisted launch URLs from an authenticated Worlds
// backend after Core tenant/entitlement checks. Never construct guessed SSO URLs here.
export const serviceAdapter:ServiceAdapter={mode:'demo',async launch(id){return {kind:'demo',message:services.find(s=>s.id===id)!.description+' No production connection is configured.'};}};
