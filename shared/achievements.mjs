// Achievements: one catalogue shared by the interface, the room server and the database (the
// `achievement_catalog` table mirrors it; tests check they match). Every achievement is awarded only
// by the room server or by a database function from validated actions, never by a client.
//
// Each entry states exactly what earns it (`rule`), who can earn it, and what it unlocks: a title a
// player can show under their name, and sometimes an accent colour for their avatar. Achievements
// are gameplay records for CampOS Worlds only. They never imply attendance, grades, credit or any
// official university record.
export const ACHIEVEMENTS = [
 {id:'campus-compass',name:'Campus Compass',category:'exploration',rule:'Visit all five stops of the campus tour: the Welcome Pavilion, The Confluence, Adunni Learning Commons, The Student House and Horizon Auditorium.',title:'Campus Compass'},
 {id:'curious-mind',name:'Curious Mind',category:'exploration',rule:'Find all six golden campus keepsakes.',title:'Curious Mind'},
 {id:'campus-explorer',name:'Campus Explorer',category:'exploration',rule:'Discover 12 different campus destinations (press E at each one).',title:'Campus Explorer',accent:'#3f7f8c'},
 {id:'courtside',name:'Courtside',category:'basketball',rule:'Score 6 or more points in one round of five shots at The Courts.',title:'Courtside'},
 {id:'good-game',name:'Good Game',category:'basketball',rule:'Finish a Court Duel against another signed-in player, win, lose or draw.',title:'Good Game'},
 {id:'court-champion',name:'Court Champion',category:'basketball',rule:'Win 3 rated Court Duels, against at least 2 different opponents.',title:'Court Champion',accent:'#c9a24a'},
 {id:'good-company',name:'Good Company',category:'social',rule:'Make your first friend: a friend request that is accepted.',title:'Good Company'},
 {id:'better-together',name:'Better Together',category:'social',rule:'Spend 10 minutes on campus in a party of three or more.',title:'Better Together'},
 {id:'regular',name:'Regular',category:'community',rule:'Check in at 3 different campus events, in the game, while they are happening.',title:'Regular'},
 {id:'community-builder',name:'Community Builder',category:'community',rule:'Organise an event where at least 3 other players check in.',title:'Community Builder',accent:'#7a4f9a'},
 {id:'road-tripper',name:'Road Tripper',category:'travel',rule:'Drive the Campus Loop: visit every district’s stop in order as the driver, in under 10 minutes.',title:'Road Tripper',accent:'#9b5b2a'},
];
export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map(a=>[a.id,a]));
/** Accent colours that are earned rather than chosen freely: colour → achievement that unlocks it. */
export const LOCKED_ACCENTS = Object.fromEntries(ACHIEVEMENTS.filter(a=>a.accent).map(a=>[a.accent,a.id]));
