// Exploration and travel challenges: ordered checkpoints with a time limit, checked by the room
// server against its own record of where the player is (never the client's word). A new challenge
// is one entry here (and its id in the database's challenge list); no game logic is copied.
//
//   mode 'foot'  → must stay on foot (leaving to drive ends the run)
//   mode 'drive' → must be the driver of a vehicle the whole way
//   minMs        → faster than this is physically implausible and is rejected as invalid
import { STOPS } from './expansion.mjs';
import { LOCATIONS } from './campus.mjs';

const stop = id => { const s = STOPS.find(s => s.id === id); return { id: s.id, name: s.name, x: s.x, z: s.z }; };
const place = id => { const l = LOCATIONS.find(l => l.id === id); return { id: l.id, name: l.name, x: l.x, z: l.z }; };

export const CHALLENGES = [
 {id:'courtyard-circuit',name:'Courtyard Circuit',mode:'foot',radius:6,timeLimitMs:180_000,minMs:20_000,
  description:'On foot, visit six courtyard landmarks in order in under 3 minutes. Sprint where you can.',
  checkpoints:['landmark','library','lecture','student','sports','orientation'].map(place)},
 {id:'campus-loop',name:'Campus Loop',mode:'drive',radius:16,timeLimitMs:720_000,minMs:120_000,achievement:'road-tripper',
  description:'As the driver, pass every district’s shuttle stop in order in under 12 minutes: a tour of the whole university by road.',
  checkpoints:['learning','academic','residential','recreation','gateway','student-life'].map(stop)},
];
export const CHALLENGE_BY_ID = new Map(CHALLENGES.map(c=>[c.id,c]));
