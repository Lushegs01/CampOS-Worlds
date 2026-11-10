// Combat Arena rules: game modes, scoring, experience, levels, unlocks and loadout validation. Used by
// the arena server (which scores matches), the client (which explains the rules and previews
// unlocks) and mirrored in the database (supabase/migrations/*_combat_arena.sql recomputes
// experience from the validated statistics; tests keep the two formulas identical).

import { WEAPONS, WEAPON_BY_ID, LETHALS, TACTICALS, PERKS, PERK_BY_ID, STREAKS, SKINS, SKIN_BY_ID, EMBLEMS, EQUIPMENT_BY_ID, weaponOwned, damageAt, isFirearm } from './weapons.mjs';
import { MAP_BY_ID } from './maps.mjs';

/**
 * Game modes. Team modes put players on two teams. New modes (free-for-all, search and destroy,
 * hardpoint) add an entry here and a scoring hook in server/arena/match.mjs (`MODE_LOGIC`).
 */
export const MODES = [
 {id:'tdm',name:'Team Deathmatch',short:'TDM',text:'Two teams. Every elimination scores a point for your team. First to the target, or most when time runs out, wins.',
  timeMs:10*60000,respawnMs:4000,scoreLimit:teamSize=>Math.max(20,Math.min(75,teamSize*10)),killPoints:1},
 {id:'dom',name:'Domination',short:'DOM',text:'Hold the three zones A, B and C. Each zone your team holds scores a point every 2 seconds. Stand in a zone to capture it.',
  timeMs:10*60000,respawnMs:5000,scoreLimit:()=>150,captureMs:9000,tickMs:2000,killPoints:0},
];
export const MODE_BY_ID = new Map(MODES.map(m=>[m.id,m]));

export const MATCH = {
 maxPerTeam:6, minToStart:2, countdownMs:10000, fillWaitMs:15000, loadWaitMs:20000, resultsMs:20000,
 /** Players who drop keep their place this long (reconnect with the match key). */
 reconnectMs:60000,
 /** A team with nobody connected for this long forfeits. */
 abandonMs:45000,
 /** Join in progress until this fraction of the time or score is used. */
 joinUntil:.75,
 regenDelayMs:5000, regenMendMs:3000, regenPerSecond:30, maxHealth:100,
 spawnProtectMs:1500, assistWindowMs:10000, assistMinDamage:20,
 /** How far back hit registration looks to match what a shooter saw (lag compensation cap). */
 maxRewindMs:300,
 /** Commands a client may bank beyond real time (absorbs jitter; bounds speed exploits). */
 commandBurst:24,
 /** A player killed this recently can still trade: their shots already in flight count. */
 tradeMs:140,
 snapshotHz:20, tickHz:30,
};

// ---------------------------------------------------------------- experience and levels
export const XP = {kill:100,headshot:25,assist:40,capture:150,neutralize:60,defend:50,win:600,draw:400,loss:250,perMatchCap:20000};
export const MAX_LEVEL = 30;
/** Experience needed to reach `level` (level 1 needs 0): each level costs 800 + 200 × the previous level. */
export function xpForLevel(level){let t=0;for(let k=1;k<Math.min(level,MAX_LEVEL);k++)t+=800+200*k;return t;}
export function levelFor(xp){let l=1;while(l<MAX_LEVEL&&xp>=xpForLevel(l+1))l++;return l;}
/** Experience for one player's validated match statistics (identical to arena_match_xp() in SQL). */
export function matchXp({kills=0,headshots=0,assists=0,captures=0,neutralizes=0,defends=0,result='loss',completed=false}){
 const outcome=!completed?0:result==='win'?XP.win:result==='draw'?XP.draw:XP.loss;
 return Math.min(XP.perMatchCap,kills*XP.kill+headshots*XP.headshot+assists*XP.assist+captures*XP.capture+neutralizes*XP.neutralize+defends*XP.defend+outcome);
}
/** Weapon level from eliminations with it: every 5 eliminations (headshots count as 1¼) is a level, up to 10. */
export const weaponXp=(kills,headshots)=>kills*100+headshots*25;
export const weaponLevel=xp=>Math.min(10,1+Math.floor(xp/500));

/** What a player level unlocks (weapons, equipment, perks, streaks, emblems). */
export function unlocksAt(level){
 // Premium Armory weapons are bought, not unlocked by level.
 const items=[...WEAPONS.filter(w=>w.access!=='premium'),...LETHALS,...TACTICALS,...PERKS,...STREAKS].filter(i=>i.unlock===level).map(i=>i.id);
 return [...items,...EMBLEMS.filter(e=>e.level===level).map(e=>'emblem:'+e.id)];
}
export const unlocked=(item,level)=>(WEAPON_BY_ID.get(item)??EQUIPMENT_BY_ID.get(item)??PERK_BY_ID.get(item)??STREAKS.find(s=>s.id===item))?.unlock<=level;

// ---------------------------------------------------------------- loadouts
export const LOADOUT_SLOTS = 5;
/** Starting loadouts: free weapons only, so every player (and every guest) can use them. */
export const PRESETS = [
 {name:'Assault',primary:'vanguard',secondary:'knife',lethal:'frag',tactical:'flash',perks:['fleet','steady']},
 {name:'Close quarters',primary:'wasp',secondary:'knife',lethal:'frag',tactical:'flash',perks:['fleet','steady']},
 {name:'Rifleman',primary:'vanguard',secondary:'knife',lethal:'frag',tactical:'flash',perks:['steady','fleet']},
 {name:'Skirmisher',primary:'wasp',secondary:'knife',lethal:'frag',tactical:'flash',perks:['steady','fleet']},
 {name:'Custom',primary:'vanguard',secondary:'knife',lethal:'frag',tactical:'flash',perks:['fleet','steady']},
];
/** Training bots (SIM units, server-side only) carry the whole catalogue so practice covers every matchup. */
export const BOT_PRESETS = [
 {name:'Assault',primary:'vanguard',secondary:'sparrow',lethal:'frag',tactical:'flash',perks:['fleet','steady']},
 {name:'Close quarters',primary:'wasp',secondary:'knife',lethal:'frag',tactical:'flash',perks:['fleet','steady']},
 {name:'Marksman',primary:'longbow',secondary:'sparrow',lethal:'frag',tactical:'flash',perks:['steady','fleet']},
 {name:'Suppressor',primary:'anvil',secondary:'sparrow',lethal:'frag',tactical:'flash',perks:['steady','fleet']},
 {name:'Breacher',primary:'bastion',secondary:'knife',lethal:'frag',tactical:'flash',perks:['fleet','steady']},
];
/**
 * Check a loadout against the catalogue and what `level` has unlocked; weapon finishes against
 * `weaponLevels` ({ weapon: level }); premium Armory weapons against `owned` (the account's store items,
 * e.g. ['weapon-halcyon']; nothing for guests). Returns { ok, loadout } with a normalised copy, or
 * { ok:false, reason }. The arena server and the database both apply it: a client cannot equip a weapon
 * it does not own, whatever it sends.
 */
export function validateLoadout(l,level=1,weaponLevels={},owned=[]){
 if(!l||typeof l!=='object')return {ok:false,reason:'Choose a loadout.'};
 const p=WEAPON_BY_ID.get(l.primary),s=WEAPON_BY_ID.get(l.secondary),le=EQUIPMENT_BY_ID.get(l.lethal),ta=EQUIPMENT_BY_ID.get(l.tactical);
 if(!p||p.slot!=='primary')return {ok:false,reason:'Choose a primary weapon.'};
 if(!s||s.slot!=='secondary')return {ok:false,reason:'Choose a secondary weapon.'};
 if(!le||le.kind!=='lethal')return {ok:false,reason:'Choose lethal equipment.'};
 if(!ta||ta.kind!=='tactical')return {ok:false,reason:'Choose tactical equipment.'};
 const perks=Array.isArray(l.perks)?l.perks.filter(x=>typeof x==='string'):[];
 if(perks.length!==2||perks[0]===perks[1]||!perks.every(x=>PERK_BY_ID.has(x)))return {ok:false,reason:'Choose two different perks.'};
 for(const w of [p,s])if(!weaponOwned(w.id,owned))return {ok:false,reason:`${w.name} is in the Armory. Buy it to use it.`,locked:w.id};
 for(const item of [p,s,le,ta,...perks.map(x=>PERK_BY_ID.get(x))])if(item.unlock>level)return {ok:false,reason:`${item.name} unlocks at level ${item.unlock}.`};
 const skins=/** @type {Record<string,string>} */ ({});
 if(l.skins&&typeof l.skins==='object'&&!Array.isArray(l.skins))for(const [weapon,skin] of Object.entries(l.skins)){
  if(weapon!==p.id&&weapon!==s.id)continue;
  const def=SKIN_BY_ID.get(skin);if(!def)return {ok:false,reason:'Unknown weapon finish.'};
  if(def.weaponLevel>(weaponLevels[weapon]??1))return {ok:false,reason:`${def.name} needs weapon level ${def.weaponLevel}.`};
  if(def.id!=='standard')skins[weapon]=def.id;
 }
 const name=typeof l.name==='string'?l.name.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,24):'';
 return {ok:true,loadout:{name:name||'Custom',primary:p.id,secondary:s.id,lethal:le.id,tactical:ta.id,perks,skins}};
}

/** Validate a queue request's mode and map (map may be 'any'). */
export function validChoice(mode,map){return MODE_BY_ID.has(mode)&&(map==='any'||MAP_BY_ID.has(map));}

/** Team balance: the team a new player should join (smaller team, then the team behind on score). */
export function balanceTeam(counts,scores){
 if(counts[0]!==counts[1])return counts[0]<counts[1]?0:1;
 return scores[0]<=scores[1]?0:1;
}

/** Medal names shown in the interface (the server awards them). */
export const MEDALS={headshot:'Headshot',double:'Double Elimination',triple:'Triple Elimination',first:'First Blood',revenge:'Revenge',longshot:'Longshot',defend:'Defender',capture:'Captured',assist:'Assist',payback:'Payback',streak5:'Five in a Row',streak10:'Unstoppable'};

// ---------------------------------------------------------------- fairness (premium weapons are not stronger)
/** Seconds to eliminate a full-health player at `distance` with body shots that all hit (0 = instant). */
export function timeToKill(w,distance,health=MATCH.maxHealth){
 if(!isFirearm(w))return distance<=w.reach?0:Infinity;
 const per=damageAt(w,distance)*w.pellets;if(per<=0)return Infinity;
 const shots=Math.ceil(health/per);if(shots<=1)return 0;
 if(w.fire==='burst'){let t=0;for(let i=1;i<shots;i++)t+=60/(i%w.burst===0?w.rpm:w.burstRpm);return t;}
 return (shots-1)*60/w.rpm;
}
/**
 * True when `a` is at least as good as `b` in every respect the game measures (time to kill at every
 * distance b can reach, movement, aiming speed, magazine, reload) and better in at least one: a weapon
 * that no player should ever choose `b` over. Used by tests to keep premium weapons from dominating the
 * free ones.
 */
export function dominates(a,b){
 if(!isFirearm(a)||!isFirearm(b))return false;
 const ge=[],gt=[];
 for(let d=0;d<=Math.min(b.range,90);d+=3){const ta=timeToKill(a,d),tb=timeToKill(b,d);ge.push(ta<=tb);gt.push(ta<tb);}
 const handling=[[a.moveMul,b.moveMul,1],[a.adsMoveMul,b.adsMoveMul,1],[a.ads,b.ads,-1],[a.swap,b.swap,-1],[a.mag,b.mag,1],[a.reload,b.reload,-1]];
 for(const [x,y,dir] of handling){ge.push(dir>0?x>=y:x<=y);gt.push(dir>0?x>y:x<y);}
 return ge.every(Boolean)&&gt.some(Boolean);
}

// ---------------------------------------------------------------- auto-fire policy per match kind
/**
 * Auto-fire (a player setting, off by default) is an accessibility aid: it only presses the trigger while
 * the player's own aim is on a visible enemy, and every shot is simulated and validated by the server
 * exactly like a manual one. The policy is public and the same for everyone in a match: `true` allows it.
 * A future ranked playlist adds an entry here (e.g. ranked:false) and the server sends it in the match view.
 */
export const AUTO_FIRE_POLICY = {quick:true,private:true,training:true};
export const autoFireAllowed = kind => AUTO_FIRE_POLICY[kind] === true;
