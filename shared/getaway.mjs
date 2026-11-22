// The Getaway's Industrial District (Orisun Freight) in Metropolitan City. Coordinates were authored in a local
// frame beside the old campus hub; `at` places them in the city (METRO_SHIFT). Renderers that draw the authored
// GLBs use the *_LOCAL data inside a group at METRO_SHIFT.
import { METRO_SHIFT, SAFEHOUSE_PLOT } from './metro.mjs';
const at = (x, z, extra = {}) => ({ x: x + METRO_SHIFT.x, z: z + METRO_SHIFT.z, ...extra });
/** Sade's meeting point: outside Saltworks Café in the Commercial District (Harbour Exchange). */
export const CONTACT = { x: -27, z: 1690.8, yaw: 0 };
/** The freight yard's staff gate (where Sade used to wait). */
export const FREIGHT_GATE = at(136, 48, { yaw: Math.PI });
export const WAREHOUSE = at(191, 21);
export const PACKAGE = at(191, 5);
export const EXIT = at(191, 39);
/** The lock-up on Baobab Close (Residential District), where the case is handed over. */
export const SAFEHOUSE = { x: -225, z: 2011.5 };
export const SAFEHOUSE_LOT = SAFEHOUSE_PLOT;
export const BARREL = at(198, 32);
export const VEHICLE_BAY = at(215, 44);
export const DISTRICT = at(211, 14, { w: 166, d: 105 });
export const INDUSTRIAL_LOCATION = { id: 'industrial-contact', name: 'The Getaway · Contact', type: 'Shadow Protocol', ...CONTACT, icon: 'compass', description: 'Meet Sade outside Saltworks Café, Harbour Exchange, Metropolitan City.' };
/** @type {{id:string,type:'car'|'shuttle'|'cart',x:number,z:number,yaw:number}[]} */
export const GETAWAY_CARS = [
  at(209, 46, { id: 'getaway-compact', type: 'car', yaw: 0 }),
  at(215, 46, { id: 'getaway-suv', type: 'suv', yaw: 0 }),
  at(221, 46, { id: 'getaway-sports', type: 'sports', yaw: 0 }),
];
const piece = (kind, x, z, w, d, h) => ({ kind, x, z, w, d, h });
/** Authored local frame (renderers). */
export const INDUSTRIAL_SOLIDS_LOCAL = [
  piece('wall', 191, 1, 29, .6, 7), piece('wall', 177, 12.5, .6, 23, 7),
  piece('wall', 205, 12.5, .6, 23, 7),
  piece('front', 181.6, 24, 9.2, .6, 7), piece('front', 200.4, 24, 9.2, .6, 7),
  piece('crate', 183, 10, 3.8, 2.2, 1.2), piece('crate', 196, 8, 4.8, 2.4, 1.5),
  piece('crate', 197.5, 16, 4.5, 2, 1.35), piece('crate', 183, 18, 3.8, 2, 1.15),
  piece('container', 174, 34, 5.8, 2.6, 2.65), piece('container', 181, 43, 2.6, 8.6, 2.65),
  piece('container', 209, 31, 8.6, 2.6, 2.65), piece('container', 227, 29, 2.6, 8.6, 2.65),
  piece('depot', 234, 9, 31, 16, 8), piece('depot', 235, -11, 34, 13, 7),
  piece('depot', 165, 3, 13, 23, 6.5), piece('depot', 177, -35, 23, 13, 7),
  piece('safehouse', 280, -37, 8, 12, 4.7), piece('depot', 250, -37, 20, 13, 6),
  piece('container', 272, -8, 2.6, 8, 2.65),
  // Simple footprint proxies for the new freight-side equipment and fixtures.
  piece('fence', 136.475, 44.62, 13.95, .18, 2.08),
  piece('fence', 240.7, 45.23, 18.2, .18, 2.08),
  ...[257,270].flatMap(x=>[12,26].map(z=>piece('equipment',x,z,1.28,1.25,7.3))),
  piece('equipment', 213, 24.1, 2.5, 1.3, 2.1),
  piece('equipment', 182.1, 1.74, 5.78, .92, 3.35),
  piece('equipment', 199.45, 1.74, 5.78, .92, 3.35),
];
export const INDUSTRIAL_SOLIDS = [
  ...INDUSTRIAL_SOLIDS_LOCAL.map(b => ({ ...b, ...at(b.x, b.z) })),
  { kind: 'safehouse', ...SAFEHOUSE_LOT },
];
export const INDUSTRIAL_NODES = [
  at(151, 55.55, { id: 'freight-west' }), at(265, 55.55, { id: 'freight-east' }),
  at(151, -24, { id: 'freight-north' }), at(265, -24, { id: 'freight-service' }),
];
export const INDUSTRIAL_LINKS = [
  ['freight-west', 'freight-east'],
  ['freight-west', 'freight-north'], ['freight-north', 'freight-service'], ['freight-service', 'freight-east'],
];
export const OBJECTIVES = [
  ['Meet the contact', 'Drive out through the South Gate to Metropolitan City. Sade waits outside Saltworks Café, Harbour Exchange.'],
  ['Reach the warehouse', 'Orisun Freight, Industrial District. Use the open loading doors at Bay 04.'],
  ['Survive the encounter', 'Clear the guards and the tactical operative. Use the cargo stacks for cover.'],
  ['Secure the package', 'Pick up the marked case inside the warehouse.'],
  ['Survive the ambush', 'Deal with the reinforcements at the loading yard. The fuel drum is unstable.'],
  ['Find a getaway vehicle', 'Take the wheel of a vehicle in the east motor pool.'],
  ['Lose the police', 'Break line of sight, get out of the search area and stay hidden until the search is called off.'],
  ['Reach the safehouse', 'Head for the lock-up on Baobab Close in the Residential District.'],
  ['Deliver the package', 'Stop, get out, and hand the case to Sade.'],
  ['Complete the mission', 'Commit the delivery and open the debrief.'],
];
export const O = { contact: 0, warehouse: 1, combat: 2, package: 3, ambush: 4, vehicle: 5, pursuit: 6, safehouse: 7, deliver: 8, commit: 9, complete: 10 };
export const LOADOUT = ['sparrow', 'vanguard', 'bastion'];
export const REWARD = { xp: 500, credits: 250, milestone: 'Loose ends', unlock: 'Shadow Protocol • Next contact' };
export const isGetawayVehicle = id => typeof id === 'string' && id.startsWith('getaway-');
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const inDistrict = (x, z, pad = 0) => Math.abs(x - DISTRICT.x) < DISTRICT.w / 2 + pad && Math.abs(z - DISTRICT.z) < DISTRICT.d / 2 + pad;
