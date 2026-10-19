// Authored once for the renderer, contextual prompts and trusted room proximity checks.
export const LAB = Object.freeze({ id:'economic-lab', name:'Economic Simulation Lab', x:-55, z:22, w:18, d:10, h:6, doorX:-57, doorZ:27 });
export const LAB_LOCATION = {id:LAB.id,name:LAB.name,type:'Research & simulation',x:-57,z:29.5,icon:'grid',description:'Walk inside to explore six working stations. Campus Logistics Economy uses simulation units only.'};
export const LAB_DOOR = {id:'economic-lab-main',label:'Economic Simulation Lab entrance',x:-57,z:27,leaves:[{hx:-58.2,hz:27,dir:1,len:1.2},{hx:-55.8,hz:27,dir:-1,len:1.2}],swing:-1,double:true,height:3.1,glass:true,locked:undefined,collider:{x:-57,z:27,w:2.4,d:.3}};
export const LAB_STATIONS = [
 {id:'control',letter:'A',name:'Simulation Control',x:-61,z:18.8},
 {id:'market',letter:'B',name:'Market Operations',x:-55,z:18.8},
 {id:'tasks',letter:'C',name:'Tasks and Logistics',x:-49,z:18.8},
 {id:'agents',letter:'D',name:'AI Agent Operations',x:-61,z:23},
 {id:'verification',letter:'E',name:'Verification and Evidence',x:-49,z:23},
 {id:'research',letter:'F',name:'Research and Results',x:-49,z:25.4},
].map(s=>({...s,point:{x:s.x,z:s.z+1},range:1.35}));
export const LAB_WALLS = [
 {x:-64,z:22,w:.3,d:10,h:6},{x:-46,z:22,w:.3,d:10,h:6},{x:-55,z:17,w:18,d:.3,h:6},
 {x:(-64-58.2)/2,z:27,w:5.8,d:.3,h:6},{x:(-55.8-46)/2,z:27,w:9.8,d:.3,h:6},
 ...LAB_STATIONS.map(s=>({x:s.x,z:s.z,w:2.2,d:.75,h:1.25})),
];
export const LAB_PATH = {x0:-59,x1:-55,z0:27,z1:38};
export const LOGISTICS_SITES = [
 {id:'stores',name:'Lab Stores · simulation dispatch',x:-57,z:31.5},
 {id:'commons',name:'Learning Commons · simulation receiver',x:-30,z:-1.2},
 {id:'student',name:'Student House · simulation receiver',x:29,z:3.5},
 {id:'welcome',name:'Welcome Pavilion · simulation receiver',x:-12,z:25},
 {id:'courts',name:'Courts west gate · simulation receiver',x:30,z:24},
];
export const LAB_AGENT = Object.freeze({id:'dispatch-v1',name:'Dispatch / 01',kind:'deterministic',execution:'Server-side logistics model; no navigating character',capabilities:['read eligible tasks','claim assigned task','model pickup and transit','submit for independent server verification'],budget:{tasksPerCommand:1,actionsPerTask:4},forbidden:['change permissions','create stock','write balances','verify or accept work','award recognition']});
export const SCENARIO = Object.freeze({id:'campus-logistics',name:'Campus Logistics Economy',version:1,ruleVersion:'delivery/1',contributionRule:'local-recognition/1',stock:12,price:20,initialBalances:{business:500,customers:2000,logistics:0},maxOrders:12,maxAttempts:3,deadlineSeconds:600,recognitionPerDelivery:10});
export const POLICIES = [{id:'fixed',name:'Fixed campus circuit',description:'Dispatch in creation order via the main avenue circuit.'},{id:'demand-aware',name:'Demand-aware dispatch',description:'Choose the shortest feasible delivery, using the direct pedestrian network.'}];
export const insideLab = (x,z) => x>-63.5&&x<-46.5&&z>17.5&&z<26.6;
export const siteById = id => LOGISTICS_SITES.find(s=>s.id===id);
