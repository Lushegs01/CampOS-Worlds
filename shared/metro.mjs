// Metropolitan City: the off-campus world south of Òrìṣun University's South Gate, reached on the Gateway
// Expressway. Same metre coordinates as the campus (+X east, +Z south). Authored data shared by rendering,
// movement, vehicle physics, the room and the mission simulation.
//
// The freight yard (Industrial District, The Getaway) and Harbour Exchange (Commercial District) were authored
// in a local frame next to the old campus hub; METRO_SHIFT places that frame inside the city. Their shared data
// is shifted at the source (shared/getaway.mjs, shared/harbour.mjs); their renderers draw local geometry inside
// a group at METRO_SHIFT.
export const METRO_SHIFT = { x: -525, z: 1700 };
/** Metropolitan City limits (the outskirts ring road runs just inside them). */
export const METRO = { x0: -520, x1: 520, z0: 1510, z1: 2110 };
/** Southern edge of the playable world (the campus square ends at ±1400). */
export const WORLD_SOUTH = 2160;
export const inMetro = (x, z, pad = 0) => x >= METRO.x0 - pad && x <= METRO.x1 + pad && z >= METRO.z0 - pad && z <= METRO.z1 + pad;
/** The expressway between the South Gate and the city (a gradual transition from campus to city). */
export const EXPRESSWAY = { x: 0, z0: 1250, z1: 1540 };
export const onExpressway = (x, z, pad = 0) => Math.abs(x - EXPRESSWAY.x) < 40 + pad && z > EXPRESSWAY.z0 - pad && z < EXPRESSWAY.z1 + pad;
/** Which world region a point belongs to: streaming, sky, ambience and the HUD use it. */
export function regionAt(x, z) {
  if (inMetro(x, z)) return 'metro';
  if (onExpressway(x, z)) return 'expressway';
  return 'campus';
}

// Street grid (two-lane carriageways, 8 m kerb to kerb). Rows run east–west at z, columns north–south at x.
// Harbour Exchange's own grid (x -180…0, rows 1647.55/1701.55/1755.55) and the freight roads join it.
const ROW = { entrance: 1540, north: 1647.55, mid: 1701.55, south: 1755.55, freight: 1676, res1: 1840, res2: 1930, res3: 2020 };
const COL = { west: -470, freight: -374, boulevard: 0, d1: 100, d2: 200, d3: 300, east: 470, r1: -300, r2: -150, r3: 150 };
export const METRO_ROWS = ROW, METRO_COLS = COL;
/** [axis, at, from, to]: 'h' rows at z from x0 to x1; 'v' columns at x from z0 to z1. */
export const METRO_STREETS = [
  ['h', ROW.entrance, COL.west, COL.east],
  ['h', ROW.north, COL.boulevard, COL.east], ['h', ROW.mid, COL.boulevard, COL.east], ['h', ROW.south, COL.boulevard, COL.east],
  ['h', ROW.south, COL.west, COL.freight], ['h', ROW.freight, COL.west, COL.freight],
  ['h', ROW.res1, COL.west, COL.east], ['h', ROW.res2, COL.west, COL.east], ['h', ROW.res3, COL.west, COL.east],
  ['v', COL.boulevard, EXPRESSWAY.z0, ROW.north], ['v', COL.boulevard, ROW.south, ROW.res3],
  ['v', COL.west, ROW.entrance, ROW.res3], ['v', COL.east, ROW.entrance, ROW.res3],
  ['v', COL.d1, ROW.north, ROW.south], ['v', COL.d2, ROW.north, ROW.south], ['v', COL.d3, ROW.north, ROW.res3],
  ['v', COL.r1, ROW.res1, ROW.res3], ['v', COL.r2, ROW.res1, ROW.res3], ['v', COL.r3, ROW.res1, ROW.res3],
];

export const METRO_DISTRICTS = [
  { id: 'entrance', name: 'Metropolitan Entrance', x: 0, z: 1560, color: '#a7a9a3', fog: '#c9ccc6', blurb: 'City limits, toll plaza and the welcome gantry.' },
  { id: 'commercial', name: 'Commercial District', x: -90, z: 1720, color: '#b49a78', fog: '#cfc6b5', blurb: 'Harbour Exchange: shops, cafés and offices.' },
  { id: 'industrial', name: 'Industrial District', x: -317, z: 1715, color: '#8d7b62', fog: '#b9b1a2', blurb: 'Orisun Freight, depots and the container yard.' },
  { id: 'downtown', name: 'Downtown', x: 150, z: 1700, color: '#7e8d99', fog: '#b9c3cb', blurb: 'Towers, plazas and the financial quarter.' },
  { id: 'security', name: 'Security District', x: 385, z: 1700, color: '#5f6f7d', fog: '#b1bcc5', blurb: 'Metro Police Central and private security.' },
  { id: 'residential', name: 'Residential District', x: 0, z: 1930, color: '#b98f74', fog: '#cdbfb2', blurb: 'Houses, flats and corner shops.' },
  { id: 'outskirts', name: 'Outskirts & Highways', x: 0, z: 1400, color: '#9a9c82', fog: '#ccccbc', blurb: 'The Gateway Expressway and the ring road.' },
];
export function metroDistrictAt(x, z) {
  if (!inMetro(x, z)) return onExpressway(x, z) || (z > 1300 && z < METRO.z0 + 10) ? METRO_DISTRICTS[6] : null;
  if (z < ROW.north - 7) return METRO_DISTRICTS[0];
  if (z > ROW.south + 40) return x < COL.west + 12 || x > COL.east - 12 ? METRO_DISTRICTS[6] : METRO_DISTRICTS[5];
  if (x < -219 + 4) return METRO_DISTRICTS[2];
  if (x < 4) return METRO_DISTRICTS[1];
  if (x > COL.d3 + 4) return METRO_DISTRICTS[4];
  return METRO_DISTRICTS[3];
}

/** The Getaway's safehouse lock-up (Residential District, Baobab Close); kept clear of generated houses. */
export const SAFEHOUSE_PLOT = { x: -225, z: 2002, w: 16, d: 11, h: 5.2 };
// Lots: setback from a street centreline to the building line (half carriageway + sidewalk + verge).
const SET = 7.6;
let seed = 7331;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const r2 = n => Math.round(n * 100) / 100;
/** @typedef {{id:string,district:string,kind:string,name?:string,x:number,z:number,w:number,d:number,h:number,style:number,front:number,yaw?:number}} MetroBuilding */
/** @type {MetroBuilding[]} */
const out = [];
const add = (b) => { out.push({ ...b, x: r2(b.x), z: r2(b.z), w: r2(b.w), d: r2(b.d), h: r2(b.h) }); };

// Downtown: three columns × two rows of blocks, two or three towers each with a plaza.
const TOWER_NAMES = ['Meridian Tower', 'Okun Trust', 'Atlas House', 'Lagoon Plaza', 'Kola Exchange', 'Ivory Court', 'Sentinel Bank', 'Halcyon One', 'Ridgeway Centre', 'Union Spire', 'Coral Point', 'Eko Heights', 'Mosaic House', 'Pinnacle Life', 'Delta Finance', 'Aurora Hotel'];
let tn = 0;
for (const [xa, xb] of [[COL.boulevard, COL.d1], [COL.d1, COL.d2], [COL.d2, COL.d3]]) {
  for (const [za, zb] of [[ROW.north, ROW.mid], [ROW.mid, ROW.south]]) {
    const x0 = xa + SET, x1 = xb - SET, z0 = za + SET, z1 = zb - SET, n = rand() < .45 ? 2 : 3, span = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const front = i % 2 ? 1 : -1, w = span - 4 - rand() * 4, d = (z1 - z0) - 4 - rand() * 6;
      const h = 26 + Math.pow(rand(), 1.4) * 72 + (xa === COL.d1 ? 18 : 0);
      add({ id: `dt-${xa}-${za}-${i}`, district: 'downtown', kind: 'tower', name: TOWER_NAMES[tn++ % TOWER_NAMES.length], x: x0 + span * (i + .5), z: (z0 + z1) / 2 + (front > 0 ? 1.2 : -1.2), w, d, h, style: Math.floor(rand() * 4), front });
    }
  }
}
// Downtown south: a mall, a multi-storey car park and a civic hall facing the south row.
add({ id: 'dt-mall', district: 'downtown', kind: 'mall', name: 'Lagoon Galleria', x: 70, z: 1791, w: 104, d: 36, h: 14, style: 1, front: -1 });
add({ id: 'dt-carpark', district: 'downtown', kind: 'carpark', name: 'Central Car Park', x: 175, z: 1792, w: 46, d: 34, h: 15, style: 0, front: -1 });
add({ id: 'dt-hall', district: 'downtown', kind: 'civic', name: 'Metropolitan Hall', x: 252, z: 1795, w: 44, d: 30, h: 18, style: 2, front: -1 });
add({ id: 'dt-hotel', district: 'downtown', kind: 'tower', name: 'Harbourline Hotel', x: 385, z: 1797, w: 40, d: 26, h: 44, style: 3, front: -1 });
// Security District: Metro Police Central, its motor pool and a private security compound.
add({ id: 'sec-hq', district: 'security', kind: 'police', name: 'Metro Police Central', x: 385, z: 1671, w: 64, d: 32, h: 16, style: 0, front: 1 });
add({ id: 'sec-ops', district: 'security', kind: 'police', name: 'Tactical Operations', x: 352, z: 1735, w: 30, d: 26, h: 10, style: 1, front: -1 });
add({ id: 'sec-guard', district: 'security', kind: 'security', name: 'Sentry Guard Services', x: 433, z: 1738, w: 26, d: 22, h: 9, style: 2, front: -1 });
// Entrance: toll plaza buildings, a hotel and a dealership beside the entrance road; a fuel station on the west.
add({ id: 'en-hotel', district: 'entrance', kind: 'tower', name: 'Gateway Inn', x: 120, z: 1595, w: 34, d: 28, h: 24, style: 2, front: -1 });
add({ id: 'en-dealer', district: 'entrance', kind: 'shed', name: 'Coastline Motors', x: 230, z: 1592, w: 52, d: 24, h: 8, style: 1, front: -1 });
add({ id: 'en-office', district: 'entrance', kind: 'tower', name: 'Visitor & Permits Office', x: 360, z: 1596, w: 40, d: 30, h: 16, style: 0, front: -1 });
add({ id: 'en-fuel', district: 'entrance', kind: 'fuel', name: 'Sunline Fuel', x: -90, z: 1566, w: 14, d: 10, h: 4.6, style: 0, front: -1 });
add({ id: 'en-depot', district: 'entrance', kind: 'shed', name: 'Westway Haulage', x: -300, z: 1592, w: 60, d: 30, h: 10, style: 2, front: -1 });
add({ id: 'en-store', district: 'entrance', kind: 'shed', name: 'Bulk Mart', x: -170, z: 1596, w: 44, d: 28, h: 9, style: 0, front: -1 });
// Residential: terraces of houses facing the rows, an apartment block at each corner, a corner shop.
const STREET_NAMES = ['Palmgrove', 'Ikoyi', 'Marigold', 'Baobab', 'Hibiscus', 'Acacia'];
let hn = 0;
for (const [xa, xb] of [[COL.west, COL.r1], [COL.r1, COL.r2], [COL.r2, COL.boulevard], [COL.boulevard, COL.r3], [COL.r3, COL.d3], [COL.d3, COL.east]]) {
  for (const [za, zb, row] of [[ROW.res1, ROW.res2, 0], [ROW.res2, ROW.res3, 1]]) {
    const x0 = xa + SET + 1, x1 = xb - SET - 1, z0 = za + SET + 1, z1 = zb - SET - 1;
    // Apartment block at the west end of the block, then houses along both frontages.
    const flat = (hn++ % 2 === 0);
    let x = x0;
    if (flat) { add({ id: `res-flat-${xa}-${za}`, district: 'residential', kind: 'apartment', name: `${STREET_NAMES[(hn + row) % 6]} Court`, x: x0 + 13, z: (z0 + z1) / 2, w: 24, d: z1 - z0 - 8, h: 12 + Math.floor(rand() * 3) * 3.2, style: Math.floor(rand() * 3), front: -1 }); x = x0 + 30; }
    for (; x + 10 < x1; x += 15 + rand() * 3) {
      for (const front of [-1, 1]) {
        if (rand() < .12) continue; // empty plot / garden
        const w = 9 + rand() * 3, d = 9 + rand() * 3, z = front < 0 ? z0 + 4 + d / 2 : z1 - 4 - d / 2;
        if (Math.abs(x + w / 2 - SAFEHOUSE_PLOT.x) < w / 2 + SAFEHOUSE_PLOT.w / 2 + 2 && Math.abs(z - SAFEHOUSE_PLOT.z) < d / 2 + SAFEHOUSE_PLOT.d / 2 + 2) continue;
        add({ id: `res-${Math.round(x)}-${za}-${front}`, district: 'residential', kind: rand() < .09 ? 'shop' : 'house', x: x + w / 2, z, w, d, h: 5.6 + (rand() < .4 ? 3 : 0), style: Math.floor(rand() * 4), front });
      }
    }
  }
}
// Outskirts: a roadside motel and warehouses along the west ring, a billboard yard on the expressway.
add({ id: 'out-motel', district: 'outskirts', kind: 'shed', name: 'Lakeside Motel', x: -432, z: 1590, w: 30, d: 40, h: 7, style: 1, front: 1, yaw: 0 });
add({ id: 'out-store-1', district: 'outskirts', kind: 'shed', name: 'Ringway Storage', x: 432, z: 1600, w: 30, d: 48, h: 9, style: 2, front: 1 });
export const METRO_BUILDINGS = out;
/** Street trees in planters along the building line of Downtown and the Security District (between buildings,
 *  clear of the sidewalk): shared, so their trunks collide on clients and the room alike. */
export const METRO_PLANTERS = (() => {
  const list = [];
  for (const b of out) {
    if (!(b.district === 'downtown' || b.district === 'security' || b.kind === 'mall')) continue;
    for (const s of [-1, 1]) {
      const x = r2(b.x + s * (b.w / 2 + 1.7)), z = r2(b.z + b.front * (b.d / 2 - .4));
      // Only in a real gap between buildings, and not twice in the same gap.
      if (out.some(o => o !== b && Math.abs(o.x - x) < o.w / 2 + 1.2 && Math.abs(o.z - z) < o.d / 2 + 1.2)) continue;
      if (list.some(p => Math.hypot(p.x - x, p.z - z) < 3)) continue;
      list.push({ x, z, species: list.length % 3 === 0 ? 'neem' : 'terminalia', s: .62 });
    }
  }
  return list;
})();
export const METRO_LOCATIONS = [
  { id: 'metro-entrance', name: 'Metropolitan City', type: 'City limits', x: 0, z: 1548, icon: 'compass', description: 'The Gateway Expressway enters the city here.' },
  { id: 'metro-downtown', name: 'Downtown', type: 'Metropolitan district', x: 150, z: 1701.55, icon: 'grid', description: 'Towers, plazas and the financial quarter.' },
  { id: 'metro-police', name: 'Metro Police Central', type: 'Security District', x: 385, z: 1690, icon: 'grid', description: 'Police headquarters and motor pool.' },
  { id: 'metro-residential', name: 'Residential District', type: 'Metropolitan district', x: 0, z: 1930, icon: 'grid', description: 'Houses, flats and corner shops.' },
];
/** Police motor pool bays in front of Metro Police Central: responding units leave from here. */
export const POLICE_BAYS = [0, 1, 2, 3, 4, 5].map(i => ({ id: 'metro-police-' + (i + 1), x: 357 + i * 11.2, z: 1693.6, yaw: 0 }));
/** Parked cars around the city: in residential side drives and outside the dealership and the car park. */
export const METRO_PARKED = (() => {
  const list = [];
  const houses = out.filter(b => b.kind === 'house');
  houses.forEach((b, i) => {
    const h = Math.sin(b.x * 12.9898 + b.z * 78.233) * 43758.5453, f = h - Math.floor(h);
    if (f < .4) return;
    const x = b.x + b.w / 2 + 1.6, z = b.z + b.front * (b.d / 2 - 2.3);
    if (out.some(o => o !== b && Math.abs(o.x - x) < o.w / 2 + 1.3 && Math.abs(o.z - z) < o.d / 2 + 2.6)) return;
    list.push({ id: 'metro-parked-' + i, x, z, yaw: b.front > 0 ? 0 : Math.PI, tint: Math.floor(f * 97) % 6 });
  });
  for (let i = 0; i < 6; i++) list.push({ id: 'metro-dealer-' + i, x: 212 + i * 7, z: 1611, yaw: Math.PI, tint: i });
  return list;
})();
export const METRO_PARKED_SOLIDS = METRO_PARKED.map(p => ({ x: p.x, z: p.z, w: 4.3, d: 1.8, h: 1.5, kind: 'parked' }));
/** Building colliders (walls are full blocks; interiors are not enterable except the authored districts). */
export const METRO_SOLIDS = METRO_BUILDINGS.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, kind: 'metro' }));
