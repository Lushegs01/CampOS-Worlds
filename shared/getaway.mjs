// The campus scene, movement and the mission simulation share these coordinates.
export const CONTACT = { x: 136, z: 48, yaw: Math.PI };
export const WAREHOUSE = { x: 191, z: 21 };
export const PACKAGE = { x: 191, z: 5 };
export const EXIT = { x: 191, z: 39 };
export const SAFEHOUSE = { x: 274, z: -35 };
export const BARREL = { x: 198, z: 32 };
export const VEHICLE_BAY = { x: 215, z: 44 };
export const DISTRICT = { x: 211, z: 14, w: 166, d: 105 };
export const INDUSTRIAL_LOCATION = { id: 'industrial-contact', name: 'Industrial District', type: 'Shadow Protocol', ...CONTACT, icon: 'compass', description: 'Meet Sade at the west freight gate.' };
/** @type {{id:string,type:'car'|'shuttle'|'cart',x:number,z:number,yaw:number}[]} */
export const GETAWAY_CARS = [
  { id: 'getaway-compact', type: 'car', x: 209, z: 46, yaw: 0 },
  { id: 'getaway-shuttle', type: 'shuttle', x: 215, z: 45, yaw: 0 },
  { id: 'getaway-cart', type: 'cart', x: 221, z: 46, yaw: 0 },
];
const piece = (kind, x, z, w, d, h) => ({ kind, x, z, w, d, h });
export const INDUSTRIAL_SOLIDS = [
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
];
export const INDUSTRIAL_NODES = [
  { id: 'freight-west', x: 151, z: 55.55 }, { id: 'freight-east', x: 265, z: 55.55 },
  { id: 'freight-north', x: 151, z: -24 }, { id: 'freight-service', x: 265, z: -24 },
];
export const INDUSTRIAL_LINKS = [
  ['freight-west', 'freight-east'], ['freight-east', 'e'],
  ['freight-west', 'freight-north'], ['freight-north', 'freight-service'], ['freight-service', 'freight-east'],
];
export const OBJECTIVES = [
  ['Meet the contact', 'Talk to Sade at the west freight gate and accept the job.'],
  ['Reach the warehouse', 'Use the open loading doors at Bay 04.'],
  ['Survive the encounter', 'Clear the guards and the tactical operative. Use the cargo stacks for cover.'],
  ['Secure the package', 'Pick up the marked case inside the warehouse.'],
  ['Survive the ambush', 'Deal with the reinforcements at the loading yard. The fuel drum is unstable.'],
  ['Find a getaway vehicle', 'Take the wheel of a vehicle in the east motor pool.'],
  ['Escape the police', 'Break line of sight and maintain your distance. The north service road gives you another route.'],
  ['Reach the safehouse', 'Head for the shuttered maintenance office off the north service road.'],
  ['Deliver the package', 'Stop, get out, and hand the case to Sade.'],
  ['Complete the mission', 'Commit the delivery and open the debrief.'],
];
export const O = { contact: 0, warehouse: 1, combat: 2, package: 3, ambush: 4, vehicle: 5, pursuit: 6, safehouse: 7, deliver: 8, commit: 9, complete: 10 };
export const LOADOUT = ['sparrow', 'vanguard', 'bastion'];
export const REWARD = { xp: 500, credits: 250, milestone: 'Loose ends', unlock: 'Shadow Protocol • Next contact' };
export const isGetawayVehicle = id => typeof id === 'string' && id.startsWith('getaway-');
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const inDistrict = (x, z, pad = 0) => Math.abs(x - DISTRICT.x) < DISTRICT.w / 2 + pad && Math.abs(z - DISTRICT.z) < DISTRICT.d / 2 + pad;
