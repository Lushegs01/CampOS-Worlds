// Harbour Exchange (Metropolitan City's Commercial District) in world coordinates: the authored local frame
// (shared/harbour-local.mjs) shifted into the city by METRO_SHIFT.
import * as L from './harbour-local.mjs';
import { METRO_SHIFT as S } from './metro.mjs';
const p = o => ({ ...o, x: o.x + S.x, z: o.z + S.z });
export const HARBOUR_LOCAL = L;
export const HARBOUR = { x0: L.HARBOUR.x0 + S.x, x1: L.HARBOUR.x1 + S.x, z0: L.HARBOUR.z0 + S.z, z1: L.HARBOUR.z1 + S.z };
export const HARBOUR_LOCATION = p(L.HARBOUR_LOCATION);
export const HARBOUR_NODES = L.HARBOUR_NODES.map(p);
// The east column of the Exchange grid is the city's boulevard; the old link back to the campus is gone.
export const HARBOUR_LINKS = L.HARBOUR_LINKS.filter(([, b]) => b !== 'e');
export const HARBOUR_BLOCKS = L.HARBOUR_BLOCKS.map(p);
export const HARBOUR_FURNITURE = L.HARBOUR_FURNITURE.map(p);
export const HARBOUR_BUILDINGS = L.HARBOUR_BUILDINGS.map(p);
/** @type {{id:string,type:'car'|'shuttle',x:number,z:number,yaw:number}[]} */
export const HARBOUR_PARKING = L.HARBOUR_PARKING.map(p);
/** @type {{id:string,type:'car'|'shuttle',x:number,z:number,yaw:number,route:number[][]}[]} */
export const HARBOUR_TRAFFIC = L.HARBOUR_TRAFFIC.map(v => ({ ...p(v), route: v.route.map(([x, z]) => [x + S.x, z + S.z]) }));
export const isHarbourTraffic = L.isHarbourTraffic;
export const inHarbour = (x, z, margin = 0) => L.inHarbour(x - S.x, z - S.z, margin);
export const onHarbourBlock = (x, z, margin = 0) => L.onHarbourBlock(x - S.x, z - S.z, margin);
const routes = new Map(HARBOUR_TRAFFIC.map(v => [v.id, v.route]));
export function harbourTrafficInput(v, routeIndex) {
  const route = routes.get(v.id);
  if (!route) return null;
  // (The local frame's steering law, on world routes.)
  return L.harbourTrafficInput({ ...v, id: v.id, x: v.x - S.x, z: v.z - S.z }, routeIndex);
}
