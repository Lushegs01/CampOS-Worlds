// Public free-roam district. Buildings, pavements and the road graph use the same metre coordinates.
export const HARBOUR = { x0: 323, x1: 546, z0: -72, z1: 109 };
export const HARBOUR_LOCATION = {
  id: 'harbour-exchange', name: 'Harbour Exchange', type: 'Metropolitan district',
  x: 405, z: 55.55, icon: 'grid', description: 'A commercial district east of the Industrial District, reached via the freight road.',
};
const xs = [345, 405, 465, 525], zs = [-52.45, 1.55, 55.55];
const node = (column, row) => 'harbour-' + column + '-' + row;
export const HARBOUR_NODES = zs.flatMap((z, row) => xs.map((x, column) => ({ id: node(column, row), x, z })));
export const HARBOUR_LINKS = [
  ['freight-east', node(0, 2)], [node(3, 2), 'e'],
  ...zs.flatMap((_, row) => xs.slice(1).map((_, index) => [node(index, row), node(index + 1, row)])),
  ...xs.flatMap((_, column) => zs.slice(1).map((_, index) => [node(column, index), node(column, index + 1)])),
];
export const HARBOUR_BLOCKS = [
  ...zs.slice(1).flatMap((z, row) => xs.slice(1).map((x, column) => ({ id: 'block-' + row + '-' + column, x: x - 30, z: z - 27, w: 48, d: 42, row, column }))),
  ...xs.slice(1).map((x, column) => ({ id: 'block-2-' + column, x: x - 30, z: 81, w: 48, d: 38, row: 2, column })),
];
export const HARBOUR_FURNITURE = HARBOUR_BLOCKS.flatMap(b => [
  ...[-1,1].map(side=>({x:b.x+side*16,z:b.z+b.d/2-1.3,w:1.65,d:1.42,h:.34})),
  ...[-1,1].flatMap(side=>[-10,10].map(step=>({x:b.x+step,z:b.z+side*(b.d/2-1.02),w:1.9,d:.78,h:.58}))),
]);
const names = [
  ['Anchor Market', 'Meridian House'], ['Coastal Bank', 'Bridge Pharmacy'], ['Palm Arcade', 'Saltworks Café'],
  ['Marina Hotel', 'New Harbour Books'], ['Exchange Tower', 'Juniper Kitchen'], ['Union Insurance', 'Broad Street Tailors'],
  ['City Market', 'Meridian News'], ['Harbour Clinic', 'Transit House'], ['Exchange Garage', 'Avenue Stores'],
];
export const HARBOUR_BUILDINGS = HARBOUR_BLOCKS.flatMap((block, index) => [-1, 1].map((side, place) => ({
  id: block.id + '-' + place, name: names[index][place], block: block.id, x: block.x + side * 11.6,
  z: block.z - 2.1, w: 20, d: 30, h: [13, 19, 16, 10, 22, 13, 10, 16, 28][(index * 2 + place) % 9],
  style: (index + place * 2) % 3, front: block.row === 2 ? -1 : 1,
})));
/** @type {{id:string,type:'car'|'shuttle',x:number,z:number,yaw:number}[]} */
export const HARBOUR_PARKING = [
  { id: 'harbour-compact', type: 'car', x: 375, z: 65.8, yaw: Math.PI },
  { id: 'harbour-shuttle', type: 'shuttle', x: 435, z: 65.8, yaw: Math.PI },
];
export const inHarbour = (x, z, margin = 0) => x >= HARBOUR.x0 - margin && x <= HARBOUR.x1 + margin
  && z >= HARBOUR.z0 - margin && z <= HARBOUR.z1 + margin;
export const onHarbourBlock = (x, z, margin = 0) => HARBOUR_BLOCKS.some(b =>
  Math.abs(x - b.x) <= b.w / 2 + margin && Math.abs(z - b.z) <= b.d / 2 + margin);

// Two room-driven ambient vehicles follow separate one-way loops and yield to real players.
/** @type {{id:string,type:'car'|'shuttle',x:number,z:number,yaw:number,route:number[][]}[]} */
export const HARBOUR_TRAFFIC = [
  { id: 'harbour-traffic-west', type: 'car', x: 357, z: 57.55, yaw: Math.PI / 2,
    route: [[403, 57.55], [403, -.45], [347, -.45], [347, 57.55]] },
  { id: 'harbour-traffic-east', type: 'shuttle', x: 481, z: -50.45, yaw: Math.PI / 2,
    route: [[523, -50.45], [523, -.45], [467, -.45], [467, -50.45]] },
];
const traffic = new Map(HARBOUR_TRAFFIC.map(v => [v.id, v.route]));
export const isHarbourTraffic = id => traffic.has(id);
export function harbourTrafficInput(v, routeIndex) {
  const route = traffic.get(v.id);
  if (!route) return null;
  let index = routeIndex;
  if (Math.hypot(v.x-route[index][0], v.z-route[index][1]) < 4.5) index = (index+1) % route.length;
  const [x,z] = route[index];
  const heading = Math.atan2(x-v.x,z-v.z)-v.yaw;
  const turn = Math.atan2(Math.sin(heading),Math.cos(heading));
  const speed = Math.max(3.1, 7-Math.abs(turn)*3.8);
  return { index, throttle: v.speed<speed ? .88 : 0, steer: Math.max(-1,Math.min(1,turn*2.2)), brake: v.speed>speed+1 };
}
