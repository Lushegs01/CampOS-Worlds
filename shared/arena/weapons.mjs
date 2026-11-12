// Combat Arena catalogue: weapons, equipment, perks and scorestreaks. One definition shared by the
// arena server (which decides every outcome), the client (which predicts its own weapon and draws the
// interface) and the database (the `arena_catalog` table mirrors ids, kinds and unlock levels; tests
// keep them in step).
//
// Fictional weapon names and all game balance numbers are original. The M7 names its real reference platform. Times are in simulation ticks at 60 per second (TICK_RATE), so
// a weapon behaves identically on the server and in the client's prediction whatever the frame rate.
//
// Adding a weapon is adding an entry here (plus a row in the migration's catalogue insert): the
// simulation (shared/arena/sim.mjs) and the server read only these fields.

export const TICK_RATE = 60;
const s = seconds => Math.round(seconds * TICK_RATE);
const CATEGORIES_FALLBACK = 'Weapon';

/**
 * Damage at distance: `damage` is a list of [fromMetres, damage] steps (the first starts at 0). Beyond
 * `range` (the longest distance a round can travel) nothing is hit.
 * Multipliers: head, legs (body is 1). `pellets` > 1 fires several independent rays (shotguns).
 * `penetration`: fraction of damage kept after passing through thin cover (0 = none).
 * Spread is a cone half-angle in radians: `hip` from the hip, `ads` aimed; `bloom` is added per shot
 * while firing continuously (capped by `bloomMax`, recovering at `bloomRecover` per tick).
 * Recoil: `kick` is the vertical climb per shot (radians), `drift` the largest sideways movement per
 * shot; `pattern` picks a fixed, learnable sequence of sideways directions. ADS multiplies recoil by
 * `adsRecoil`. The climb recovers at `recover` radians per tick once the trigger is released.
 * `fire`: 'auto', 'semi', 'burst' (with `burst` rounds), 'bolt' (semi with a long rechamber), 'melee'.
 * `moveMul` scales movement speed while the weapon is held; `adsMoveMul` while aiming.
 */
export const WEAPONS = [
 // ---------------------------------------------------------------- assault rifles: balanced mid-range
 {id:'vanguard',name:'Vanguard AR-7',category:'ar',slot:'primary',unlock:1,fire:'auto',rpm:740,mag:30,reserve:120,reload:s(2.1),reloadEmpty:s(2.6),reloadMode:'mag',
  damage:[[0,28],[24,23],[45,19]],range:120,head:1.45,legs:.9,pellets:1,penetration:.35,
  spread:{hip:.042,ads:.0035,move:1.6,air:2.4,bloom:.0016,bloomMax:.02,bloomRecover:.0009},recoil:{kick:.0072,drift:.0042,pattern:1,adsRecoil:.72,recover:.0016,max:.11},
  ads:s(.24),swap:s(.62),sprintOut:s(.2),moveMul:.97,adsMoveMul:.58,tracer:'#ffd27a',sound:'rifle'},
 {id:'halcyon',name:'Halcyon BR-3',category:'ar',slot:'primary',unlock:1,fire:'burst',burst:3,burstRpm:960,rpm:340,mag:24,reserve:96,reload:s(2.2),reloadEmpty:s(2.7),reloadMode:'mag',
  damage:[[0,30],[30,27],[55,23]],range:130,head:1.4,legs:.9,pellets:1,penetration:.35,
  spread:{hip:.04,ads:.0026,move:1.6,air:2.4,bloom:.0012,bloomMax:.012,bloomRecover:.001},recoil:{kick:.009,drift:.003,pattern:2,adsRecoil:.66,recover:.0022,max:.09},
  ads:s(.26),swap:s(.64),sprintOut:s(.22),moveMul:.96,adsMoveMul:.56,tracer:'#ffe2a0',sound:'burst'},
 // ---------------------------------------------------------------- SMGs: fast close-range
 {id:'wasp',name:'Wasp SMG-9',category:'smg',slot:'primary',unlock:1,fire:'auto',rpm:930,mag:32,reserve:160,reload:s(1.8),reloadEmpty:s(2.2),reloadMode:'mag',
  damage:[[0,26],[11,19],[22,14]],range:70,head:1.3,legs:.92,pellets:1,penetration:.2,
  spread:{hip:.03,ads:.009,move:1.25,air:1.8,bloom:.0012,bloomMax:.016,bloomRecover:.0012},recoil:{kick:.0058,drift:.0058,pattern:3,adsRecoil:.8,recover:.0018,max:.09},
  ads:s(.17),swap:s(.5),sprintOut:s(.12),moveMul:1.04,adsMoveMul:.72,tracer:'#ffcf8a',sound:'smg'},
 {id:'kestrel',name:'Kestrel K-45',category:'smg',slot:'primary',unlock:1,fire:'auto',rpm:690,mag:25,reserve:125,reload:s(1.9),reloadEmpty:s(2.3),reloadMode:'mag',
  damage:[[0,34],[12,24],[24,17]],range:70,head:1.3,legs:.92,pellets:1,penetration:.2,
  spread:{hip:.028,ads:.007,move:1.25,air:1.8,bloom:.0014,bloomMax:.016,bloomRecover:.0012},recoil:{kick:.0075,drift:.0048,pattern:4,adsRecoil:.78,recover:.0018,max:.1},
  ads:s(.18),swap:s(.52),sprintOut:s(.13),moveMul:1.03,adsMoveMul:.7,tracer:'#ffc275',sound:'smg'},
 // ---------------------------------------------------------------- shotguns: devastating up close
 {id:'bastion',name:'Bastion 12G',category:'shotgun',slot:'primary',unlock:1,fire:'semi',rpm:72,mag:6,reserve:30,reload:s(.55),reloadEmpty:s(.55),reloadMode:'shell',reloadStart:s(.35),
  damage:[[0,22],[7,13],[13,6]],range:28,head:1.2,legs:.95,pellets:8,penetration:0,
  spread:{hip:.075,ads:.062,move:1.1,air:1.3,bloom:0,bloomMax:0,bloomRecover:0},recoil:{kick:.05,drift:.012,pattern:5,adsRecoil:.85,recover:.004,max:.12},
  ads:s(.22),swap:s(.58),sprintOut:s(.16),moveMul:.97,adsMoveMul:.65,tracer:'#ffb36a',sound:'shotgun'},
 {id:'rampart',name:'Rampart Auto',category:'shotgun',slot:'primary',unlock:1,fire:'semi',rpm:210,mag:8,reserve:32,reload:s(2.4),reloadEmpty:s(2.9),reloadMode:'mag',
  damage:[[0,16],[6,10],[11,5]],range:24,head:1.2,legs:.95,pellets:7,penetration:0,
  spread:{hip:.07,ads:.058,move:1.1,air:1.3,bloom:.004,bloomMax:.02,bloomRecover:.0015},recoil:{kick:.03,drift:.012,pattern:6,adsRecoil:.85,recover:.0035,max:.12},
  ads:s(.24),swap:s(.6),sprintOut:s(.17),moveMul:.96,adsMoveMul:.62,tracer:'#ffb36a',sound:'shotgun'},
 // ---------------------------------------------------------------- sniper rifles: precision at range
 {id:'longbow',name:'Longbow SR',category:'sniper',slot:'primary',unlock:1,fire:'bolt',rpm:46,mag:5,reserve:25,reload:s(2.9),reloadEmpty:s(3.4),reloadMode:'mag',
  damage:[[0,110],[60,98]],range:220,head:2,legs:.82,pellets:1,penetration:.6,
  spread:{hip:.11,ads:0,move:1.7,air:3,bloom:0,bloomMax:0,bloomRecover:0},recoil:{kick:.055,drift:.01,pattern:7,adsRecoil:1,recover:.003,max:.1},
  ads:s(.42),swap:s(.78),sprintOut:s(.3),moveMul:.9,adsMoveMul:.45,zoom:3.2,tracer:'#fff4c8',sound:'sniper'},
 {id:'talon',name:'Talon DMR',category:'sniper',slot:'primary',unlock:1,fire:'semi',rpm:270,mag:12,reserve:60,reload:s(2.4),reloadEmpty:s(2.9),reloadMode:'mag',
  damage:[[0,49],[40,44],[70,40]],range:180,head:1.8,legs:.86,pellets:1,penetration:.5,
  spread:{hip:.07,ads:.0012,move:1.6,air:2.6,bloom:.002,bloomMax:.012,bloomRecover:.0012},recoil:{kick:.022,drift:.006,pattern:8,adsRecoil:.75,recover:.0028,max:.1},
  ads:s(.32),swap:s(.68),sprintOut:s(.24),moveMul:.93,adsMoveMul:.5,zoom:2.2,tracer:'#fff0b8',sound:'dmr'},
 // ---------------------------------------------------------------- LMGs: sustained fire and area control
 {id:'anvil',name:'Anvil LMG',category:'lmg',slot:'primary',unlock:1,fire:'auto',rpm:640,mag:75,reserve:150,reload:s(4.6),reloadEmpty:s(5.2),reloadMode:'mag',
  damage:[[0,30],[30,26],[55,22]],range:140,head:1.35,legs:.9,pellets:1,penetration:.55,
  spread:{hip:.055,ads:.005,move:1.8,air:2.8,bloom:.0011,bloomMax:.018,bloomRecover:.0006},recoil:{kick:.0066,drift:.0052,pattern:9,adsRecoil:.62,recover:.0012,max:.12},
  ads:s(.38),swap:s(.86),sprintOut:s(.32),moveMul:.86,adsMoveMul:.42,tracer:'#ffd890',sound:'lmg'},
 // ---------------------------------------------------------------- pistols: secondary weapons
 {id:'sparrow',name:'Sparrow P9',category:'pistol',slot:'secondary',unlock:1,fire:'semi',rpm:420,mag:12,reserve:48,reload:s(1.4),reloadEmpty:s(1.7),reloadMode:'mag',
  damage:[[0,28],[12,21],[25,16]],range:60,head:1.4,legs:.92,pellets:1,penetration:.1,
  spread:{hip:.022,ads:.006,move:1.2,air:1.6,bloom:.003,bloomMax:.02,bloomRecover:.0016},recoil:{kick:.012,drift:.004,pattern:10,adsRecoil:.8,recover:.0035,max:.08},
  ads:s(.15),swap:s(.38),sprintOut:s(.1),moveMul:1.05,adsMoveMul:.78,tracer:'#ffd9a0',sound:'pistol'},
 {id:'thorn',name:'Thorn .44',category:'pistol',slot:'secondary',unlock:1,fire:'semi',rpm:150,mag:6,reserve:30,reload:s(2.3),reloadEmpty:s(2.3),reloadMode:'mag',
  damage:[[0,58],[15,46],[30,36]],range:70,head:1.5,legs:.9,pellets:1,penetration:.25,
  spread:{hip:.03,ads:.004,move:1.3,air:1.8,bloom:.006,bloomMax:.02,bloomRecover:.002},recoil:{kick:.04,drift:.01,pattern:11,adsRecoil:.8,recover:.004,max:.1},
  ads:s(.2),swap:s(.45),sprintOut:s(.13),moveMul:1.03,adsMoveMul:.72,tracer:'#ffc98a',sound:'magnum'},
 // ---------------------------------------------------------------- melee: close-range emergency combat
 {id:'knife',name:'Combat Knife',category:'melee',slot:'secondary',unlock:1,fire:'melee',swing:s(.45),reach:2.3,damage:[[0,150]],range:2.3,head:1,legs:1,pellets:0,penetration:0,
  ads:s(.1),swap:s(.3),sprintOut:s(.05),moveMul:1.08,adsMoveMul:1,sound:'knife'},
 {id:'hammer',name:'Breach Axe',category:'melee',slot:'secondary',unlock:7,fire:'melee',swing:s(.7),reach:2.9,damage:[[0,150]],range:2.9,head:1,legs:1,pellets:0,penetration:0,
  ads:s(.1),swap:s(.4),sprintOut:s(.08),moveMul:1.02,adsMoveMul:1,sound:'hammer'},
 // Append only: existing multiplayer weapon indices and saved catalogue ids remain stable.
 {id:'m7',name:'SIG Sauer M7',category:'battle',slot:'primary',unlock:1,fire:'auto',fireModes:['auto','semi'],rpm:600,mag:20,reserve:80,reload:s(2.75),reloadEmpty:s(3.25),reloadMode:'mag',
  designation:'XM7',platform:'SIG Sauer MCX SPEAR',cartridge:'6.8×51mm hybrid-case military ammunition',configuration:'Suppressed · 2× magnified optic',
  damage:[[0,36],[32,32],[65,27]],range:170,head:1.5,legs:.86,pellets:1,penetration:.55,
  spread:{hip:.055,ads:.0018,move:1.75,air:2.8,bloom:.0022,bloomMax:.024,bloomRecover:.0011},recoil:{kick:.017,drift:.0055,pattern:12,adsRecoil:.72,recover:.0021,max:.14},
  ads:s(.34),swap:s(.76),sprintOut:s(.28),moveMul:.91,adsMoveMul:.48,zoom:2,tracer:'#ffe4ad',sound:'m7-suppressed',inspect:s(2.4)},

];

// ---------------------------------------------------------------- the Armory: who may use what
// Three firearms are free (FREE_FIREARMS), including the M7. Every other firearm is a premium Armory weapon, bought
// once with real money through the campus store (shared/shop.mjs item `weapon-<id>`, server/shop.mjs) and
// owned by the account on every device. Premium weapons are not stronger: each trades something away (see
// `tradeoff`), tests/arena-armory.test.mjs checks that none dominates a free weapon, and the server
// simulates every weapon with the same rules. Melee weapons are not firearms: the Combat Knife is free and
// the Breach Axe is earned at level 7.
/** @type {Record<string,{access:'free'|'premium'|'earned',armory:string,role:string,tradeoff:string}>} */
const ARMORY={
 m7:{access:'free',armory:'Battle rifle',role:'MCX SPEAR platform, formerly XM7. A hard-hitting, select-fire battle rifle with a 20-round magazine, suppressor and 2× optic. Free for every player.',tradeoff:'Strong recoil and bloom in automatic fire, heavy handling, slower movement and deliberate reloads. Semi-auto rewards controlled follow-up shots.'},
 vanguard:{access:'free',armory:'Assault rifle',role:'Balanced damage, moderate recoil and a 30-round magazine: reliable at any range the maps offer.',tradeoff:'No single strength: out-ranged by marksman rifles, out-paced by SMGs up close.'},
 wasp:{access:'free',armory:'Submachine gun',role:'Very high fire rate and fast handling for aggressive, close-range movement.',tradeoff:'Damage falls off quickly past 11 m and recoil builds under sustained fire.'},
 halcyon:{access:'premium',armory:'Advanced assault rifle',role:'Three-round bursts with tight aimed spread for disciplined mid-range fights.',tradeoff:'Burst-only fire punishes misses, slower aiming and a smaller 24-round magazine.'},
 kestrel:{access:'premium',armory:'Heavy SMG',role:'Hard-hitting rounds up close with steadier recoil than other SMGs.',tradeoff:'Slower fire rate and a 25-round magazine: misses cost more than with the Wasp.'},
 bastion:{access:'premium',armory:'Pump shotgun',role:'Eight-pellet blasts that end close fights in one shot.',tradeoff:'Useless past 13 m, shell-by-shell reloads and a slow pump between shots.'},
 rampart:{access:'premium',armory:'Semi-automatic shotgun',role:'Rapid follow-up shots inside rooms and stairwells.',tradeoff:'Weaker pellets than the Bastion and almost no reach beyond 11 m.'},
 longbow:{access:'premium',armory:'Sniper rifle',role:'One body shot at any distance; built for long sightlines.',tradeoff:'Bolt action, very slow aiming and movement, no hip-fire accuracy.'},
 talon:{access:'premium',armory:'Precision rifle',role:'Semi-automatic marksman rifle that rewards accurate follow-up shots at range.',tradeoff:'Needs two to three hits, heavy recoil per shot and slow handling up close.'},
 anvil:{access:'premium',armory:'Light machine gun',role:'A 75-round belt for holding lanes and suppressing cover.',tradeoff:'Slowest movement and aiming, a 4.6-second reload, wide hip-fire.'},
 sparrow:{access:'premium',armory:'Sidearm',role:'Fast-drawing 9 mm pistol for when the primary runs dry.',tradeoff:'Low damage past 12 m; a backup, not a main weapon.'},
 thorn:{access:'premium',armory:'Heavy sidearm',role:'Six-shot revolver with heavy single hits.',tradeoff:'Strong recoil, slow cylinder reload and only six rounds.'},
 knife:{access:'free',armory:'Melee',role:'One hit eliminates at arm’s length; fastest movement.',tradeoff:'2.3 m reach.'},
 hammer:{access:'earned',armory:'Melee',role:'Longer reach than the knife.',tradeoff:'Slower swing; earned at level 7.'},
};
for(const w of WEAPONS)Object.assign(w,ARMORY[w.id]??{access:'premium',armory:CATEGORIES_FALLBACK,role:'',tradeoff:''});
export const WEAPON_BY_ID = new Map(WEAPONS.map(w=>[w.id,w]));
/** Small stable index of every weapon (snapshots name a weapon by index). */
export const WEAPON_INDEX = new Map(WEAPONS.map((w,i)=>[w.id,i]));
export const CATEGORIES = {battle:'Battle rifle',ar:'Assault rifle',smg:'SMG',shotgun:'Shotgun',sniper:'Sniper rifle',lmg:'LMG',pistol:'Pistol',melee:'Melee'};
/** A gun (not a melee weapon). */
export const isFirearm = w => !!w && w.fire !== 'melee';
/** The firearms every player has, free. */
export const FREE_FIREARMS = WEAPONS.filter(w => isFirearm(w) && w.access === 'free').map(w => w.id);
/** Firearms bought in the Armory. */
export const PREMIUM_WEAPONS = WEAPONS.filter(w => w.access === 'premium').map(w => w.id);
/** The campus store item that grants a premium weapon (shared/shop.mjs, shop_items). */
export const weaponItem = id => `weapon-${id}`;
/** Whether an account owning `owned` (store item ids, e.g. from account_snapshot) may use weapon `id`. */
export function weaponOwned(id, owned) {
 const w = WEAPON_BY_ID.get(id); if (!w) return false;
 if (w.access !== 'premium') return true;
 const item = weaponItem(id);
 return owned instanceof Set ? owned.has(item) : Array.isArray(owned) && owned.includes(item);
}

/** Damage a round does at `distance` metres, before hit-location multipliers. */
export function damageAt(weapon,distance){
 if(distance>weapon.range)return 0;
 let d=weapon.damage[0][1];for(const [from,value] of weapon.damage)if(distance>=from)d=value;return d;
}

/** Quick melee with any gun (V): two hits to eliminate a healthy player. */
export const QUICK_MELEE={damage:55,reach:1.9,ticks:s(.5)};

// ---------------------------------------------------------------- equipment
// Lethal and tactical equipment are thrown and simulated by the server (fuse, bounces, effect).
export const LETHALS=[
 {id:'frag',name:'Frag Grenade',kind:'lethal',unlock:1,count:1,fuse:s(2.4),radius:6.5,damage:120,minDamage:20,bounce:.42,stick:false,speed:17},
 {id:'tack',name:'Tack Charge',kind:'lethal',unlock:3,count:1,fuse:s(1.5),radius:4.5,damage:130,minDamage:25,bounce:0,stick:true,speed:16},
];
export const TACTICALS=[
 {id:'flash',name:'Flash Pulse',kind:'tactical',unlock:1,count:2,fuse:s(1.3),radius:13,blindMs:2600,bounce:.38,stick:false,speed:16},
 {id:'smoke',name:'Smoke Canister',kind:'tactical',unlock:2,count:1,fuse:s(1),radius:5.5,durationMs:11000,bounce:.3,stick:false,speed:14},
];
export const EQUIPMENT_BY_ID=new Map([...LETHALS,...TACTICALS].map(e=>[e.id,e]));

// ---------------------------------------------------------------- perks (choose two)
export const PERKS=[
 {id:'fleet',name:'Fleet Foot',unlock:1,text:'Sprint 8% faster and slide again sooner.'},
 {id:'steady',name:'Steady Hands',unlock:1,text:'25% tighter hip-fire spread and 15% faster aiming.'},
 {id:'pockets',name:'Deep Pockets',unlock:2,text:'One extra magazine for each weapon and one extra lethal.'},
 {id:'mend',name:'Quick Mend',unlock:3,text:'Health starts to recover after 3 seconds instead of 5.'},
 {id:'hardline',name:'Hardline',unlock:5,text:'Every scorestreak needs one point fewer.'},
 {id:'ghost',name:'Ghost',unlock:9,text:'Hidden from Recon Pulse, and firing never shows you on enemy maps.'},
];
export const PERK_BY_ID=new Map(PERKS.map(p=>[p.id,p]));

// ---------------------------------------------------------------- scorestreaks
// Streak points: +1 per elimination and +1 per objective capture, kept until death. A reward earned
// stays available until used (or the match ends). Eliminations by a reward never earn streak points,
// so rewards cannot chain into one another.
export const STREAKS=[
 {id:'recon',name:'Recon Pulse',cost:3,unlock:1,durationMs:9000,cooldownMs:15000,text:'Reveals every enemy on your team’s map for 9 seconds.'},
 {id:'supply',name:'Supply Drop',cost:5,unlock:1,durationMs:25000,cooldownMs:15000,text:'Drops a crate at your feet: you and teammates who touch it refill ammunition and equipment.'},
 {id:'strike',name:'Tactical Strike',cost:7,unlock:4,delayMs:2800,radius:7.5,damage:150,minDamage:30,range:70,cooldownMs:30000,text:'Marks where you aim. After a 2.8-second warning everyone can see, the area is hit.'},
];
export const STREAK_BY_ID=new Map(STREAKS.map(s=>[s.id,s]));

// ---------------------------------------------------------------- cosmetics (earned, never bought)
/** Weapon finishes, earned by weapon level (eliminations with that weapon). Purely visual. */
export const SKINS=[
 {id:'standard',name:'Standard',weaponLevel:1,colors:['#4d545c','#2c3136']},
 {id:'tidewater',name:'Tidewater',weaponLevel:3,colors:['#2f6f7a','#1c3f46']},
 {id:'ember',name:'Ember',weaponLevel:5,colors:['#a4482b','#3b1e14']},
 {id:'verdigris',name:'Verdigris',weaponLevel:7,colors:['#4f8a6d','#2a4339']},
 {id:'gilded',name:'Gilded',weaponLevel:10,colors:['#c9a24a','#5a4518']},
];
export const SKIN_BY_ID=new Map(SKINS.map(s=>[s.id,s]));
/** Player emblems shown on the scoreboard and kill feed, earned by player level. */
export const EMBLEMS=[
 {id:'recruit',name:'Recruit',level:1,glyph:'◇',color:'#9fb3a8'},
 {id:'chevron',name:'Chevron',level:3,glyph:'⌃',color:'#efc57b'},
 {id:'sun',name:'Golden Hour',level:6,glyph:'☀',color:'#f0a94a'},
 {id:'compass',name:'Compass',level:10,glyph:'✦',color:'#7fc7d9'},
 {id:'crown',name:'Laurel',level:15,glyph:'❦',color:'#c9a24a'},
 {id:'orisun',name:'Òrìṣun Star',level:25,glyph:'✶',color:'#ff8f6b'},
];
export const EMBLEM_BY_ID=new Map(EMBLEMS.map(e=>[e.id,e]));

/**
 * Everything the database catalogue mirrors: id, kind and unlock level. For weapon finishes ('skin')
 * the unlock is a weapon level; for everything else it is a player level.
 */
export const CATALOG=[
 ...WEAPONS.map(w=>({id:w.id,kind:'weapon',slot:w.slot,category:w.category,unlock:w.unlock,premium:w.access==='premium'})),
 ...LETHALS.map(e=>({id:e.id,kind:'lethal',slot:null,category:null,unlock:e.unlock})),
 ...TACTICALS.map(e=>({id:e.id,kind:'tactical',slot:null,category:null,unlock:e.unlock})),
 ...PERKS.map(p=>({id:p.id,kind:'perk',slot:null,category:null,unlock:p.unlock})),
 ...STREAKS.map(p=>({id:p.id,kind:'streak',slot:null,category:null,unlock:p.unlock})),
 ...SKINS.map(k=>({id:k.id,kind:'skin',slot:null,category:null,unlock:k.weaponLevel})),
 ...EMBLEMS.map(e=>({id:e.id,kind:'emblem',slot:null,category:null,unlock:e.level})),
];
