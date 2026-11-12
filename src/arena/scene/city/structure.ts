// The built fabric of Okun Bay, drawn from the map's collision boxes: streets and pavements, the station under
// them, walls with linings, floors and ceilings, stairs, roofs, and every opening's frame, door, shutter, sill,
// awning and fascia.
import * as THREE from 'three';
import { CityBuilder, Face, facade, SignAtlas, signPanel, T, RY, hash, type Box, type Deco, type CityMap, type Building } from './kit';
import type { CityMats } from './materials';

const SHOPS = ['OKUN MOBILE', 'ADIRE & CO.', 'MARINA PHARMACY', 'BAYSIDE BOOKS', 'KOLA CAFÉ', 'SUNRISE FABRICS', 'HARBOUR ELECTRONICS', 'LAGOON TAILORS', 'ATLANTIC GRILL', 'PALM FORex'.toUpperCase(), 'IROKO FURNITURE', 'BLUE CRANE TRAVEL', 'ZUMA SPORTS', 'CORAL BAKERY'];
const SIGN_COLOURS: [string, string][] = [['#14365c', '#ffffff'], ['#f1ece2', '#1d2a3a'], ['#8c2f2a', '#fff3dc'], ['#1f5d4a', '#f6e7b4'], ['#e0b21c', '#1d1f22'], ['#2b2d30', '#ffb347'], ['#f4f4f0', '#b5402f']];

export interface Fixture { p: THREE.Vector3; where: 'ug' | 'shop' | 'hall' | 'out'; color: string }

export function buildStructure(b: CityBuilder, m: CityMats, map: CityMap, detail: number, signs: SignAtlas, signMat: THREE.Material, fixtures: Fixture[], aircon: (M: THREE.Matrix4) => void) {
  const L = map.street, SLAB = .6;
  const buildingAt = (x: number, z: number, pad = 0): Building | null => { for (const g of map.buildings) if (x > g.x0 + pad && x < g.x1 - pad && z > g.z0 + pad && z < g.z1 - pad) return g; return null; };
  const spaces = map.station.spaces as [number, number, number, number, number, string, boolean][];
  const spaceAt = (x: number, z: number) => { let hit: (typeof spaces)[number] | null = null; for (const s of spaces) if (x > s[0] && x < s[2] && z > s[1] && z < s[3]) hit = s; return hit; };
  const linings = new Map<string, THREE.Material>();
  const liningOf = (g: Building) => { let l = linings.get(g.fill); if (!l) { l = m.plaster.clone(); l.name = 'lining'; (l as THREE.MeshStandardMaterial).color = new THREE.Color(g.fill).multiplyScalar(1.15); l.userData = { ...m.plaster.userData }; linings.set(g.fill, l); } return l; };
  const renderOf = (x: number, z: number) => m.render[Math.floor(hash(Math.round(Math.abs(x) / 9), Math.round(z / 9)) * m.render.length)];

  // ---------------------------------------------------------------- ground, floors and the station's shell
  const groundMat: Record<string, THREE.Material> = { 'st-asphalt': m.asphalt, 'st-sidewalk': m.sidewalk, 'st-pavers': m.pavers, 'st-plaza': m.plaza, 'st-grass': m.grass, 'st-yard': m.yard, 'st-tile': m.tile, 'st-marble': m.marble, 'st-screed': m.screed };
  const groundScale: Record<string, number> = { 'st-asphalt': 5, 'st-sidewalk': 3, 'st-pavers': 2.2, 'st-plaza': 3.2, 'st-grass': 4, 'st-yard': 3.5, 'st-tile': 2.4, 'st-marble': 3, 'st-screed': 4 };
  for (const box of map.boxes) {
    const g = groundMat[box.mat]; if (!g) continue;
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, lift = box.mat === 'st-asphalt' ? 0 : .03;
    b.force = buildingAt((x0 + x1) / 2, (z0 + z1) / 2, .3)?.enter && box.mat !== 'st-asphalt' && box.mat !== 'st-sidewalk' ? null : 'out';
    b.box(x0, y1 - .04, z0, x1, y1 + lift, z1, g, groundScale[box.mat]);
    b.force = null;
    // The underside of the street over the station: a concrete soffit.
    if (y0 > 1) b.box(x0, y0 - .02, z0, x1, y0, z1, m.ugCeil, 3);
  }
  // Station walls: wherever a space meets solid ground. Tiled in the station, painted concrete in corridors and the car park.
  for (const s of spaces) {
    const [x0, z0, x1, z1, floor, kind, sky] = s, top = sky ? L : L - SLAB;
    const tiled = kind === 'ug-tile', wallMat = kind === 'ug-track' ? m.ugCeil : tiled ? m.ugWall : m.ugConcrete;
    const edge = (alongX: boolean, at: number, a0: number, a1: number, out: number) => {
      let run: number | null = null;
      const flush = (end: number) => {
        if (run === null) return;
        const lo = run, hi = end; run = null;
        if (alongX) b.box(lo, floor, at - (out > 0 ? 0 : .03), hi, top, at + (out > 0 ? .03 : 0), wallMat, tiled ? 1.2 : 3);
        else b.box(at - (out > 0 ? 0 : .03), floor, lo, at + (out > 0 ? .03 : 0), top, hi, wallMat, tiled ? 1.2 : 3);
        // A band at hand height: the line's colour in the station, hazard yellow in the car park.
        if (kind !== 'ug-track') { const band = tiled ? m.blue : m.yellow, y = floor + 1.15; if (alongX) b.box(lo, y, at - (out > 0 ? -.03 : .04), hi, y + .16, at + (out > 0 ? .04 : -.03), band, 1); else b.box(at - (out > 0 ? -.03 : .04), y, lo, at + (out > 0 ? .04 : -.03), y + .16, hi, band, 1); }
      };
      for (let a = a0; a < a1 - 1e-6; a += .5) {
        const mid = Math.min(a + .25, a1), px = alongX ? mid : at + out * .08, pz = alongX ? at + out * .08 : mid;
        if (spaceAt(px, pz)) flush(a); else if (run === null) run = a;
      }
      flush(a1);
    };
    b.force = sky ? 'out' : 'ug';
    edge(true, z0, x0, x1, -1); edge(true, z1, x0, x1, 1); edge(false, x0, z0, z1, -1); edge(false, x1, z0, z1, 1);
    b.force = null;
  }
  // Station floors (platforms, corridors) and the track.
  for (const box of map.boxes) {
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
    if (box.mat === 'ug-tile') { b.box(x0, y0, z0, x1, y1, z1, m.ugTile, 2.4); }
    else if (box.mat === 'ug-concrete') b.box(x0, y0, z0, x1, y1, z1, m.screed, 4);
  }
  const track = spaces.filter(s => s[5] === 'ug-track');
  for (const s of track) {
    const [x0, z0, x1, z1] = s, zc = (z0 + z1) / 2;
    b.box(x0, -.05, z0, x1, .02, z1, m.ballast, 2.5);
    for (const dz of [-.72, .72]) b.box(x0, .12, zc + dz - .035, x1, .27, zc + dz + .035, m.rail, 1);
    for (let x = x0 + .3; x < x1; x += .66) b.box(x - .12, .02, zc - 1.25, x + .12, .13, zc + 1.25, m.concrete, 1);
    // The platform edges: a tactile strip and a white line on both platforms.
    for (const [z, d] of [[z0, -1], [z1, 1]] as const) if (Math.abs(x0) < 35 || Math.abs(x1) < 35) { const a = Math.max(x0, -34), e = Math.min(x1, 34); b.box(a, 1.0, z + d * .05, e, 1.012, z + d * .45, m.tactile, .6); b.box(a, 1.0, z + d * .5, e, 1.008, z + d * .58, m.paintWhite, 1); }
  }

  // ---------------------------------------------------------------- walls
  for (const box of map.boxes) {
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2, h = y1 - y0;
    let face: THREE.Material | null = null, scale = 2.6;
    switch (box.mat) {
      case 'bld-render': face = renderOf(cx > 0 ? -cx : cx, -40); break;
      case 'bld-brick': face = m.brick; scale = 2.4; break;
      case 'bld-panel': face = m.panel; scale = 3; break;
      case 'bld-stone': face = m.stone; scale = 3; break;
      case 'bld-sheet': face = m.sheetBlue; scale = 1.6; break;
      case 'bld-block': face = m.blockwork; scale = 1.6; break;
      case 'bld-terminal': face = m.cladding; scale = 3; break;
      case 'partition-wall': face = m.plaster; break;
      case 'ug-wall': face = m.ugConcrete; break;
      case 'parapet': face = renderOf(cx > 0 ? -cx : cx, -40); break;
    }
    if (!face) continue;
    const thinX = x1 - x0 < z1 - z0;
    // Only walls (one thin side) get linings and plinths; solid blocks are dressed as facades below.
    if (Math.min(x1 - x0, z1 - z0) > .8) continue;
    b.force = box.mat === 'parapet' ? 'out' : null;
    if (box.mat === 'bld-sheet') {
      // Profiled sheet above a blockwork plinth.
      const split = Math.min(y1, Math.max(y0, L + 1.1));
      if (y0 < split) b.box(x0, y0, z0, x1, split, z1, m.block, 2.4);
      if (y1 > split) b.box(x0 - (thinX ? .02 : 0), split, z0 - (thinX ? 0 : .02), x1 + (thinX ? .02 : 0), y1, z1 + (thinX ? 0 : .02), face, scale);
    } else b.box(x0, y0, z0, x1, y1, z1, face, scale);
    b.force = null;
    if (box.mat === 'parapet') { b.box(x0 - .05, y1, z0 - .05, x1 + .05, y1 + .07, z1 + .05, m.precast, 2); continue; }
    if (!box.mat.startsWith('bld-')) continue;
    // Interior lining: painted plaster on the faces that look into a room.
    for (const side of [-1, 1]) {
      const px = thinX ? (side < 0 ? x0 - .3 : x1 + .3) : cx, pz = thinX ? cz : (side < 0 ? z0 - .3 : z1 + .3), g = buildingAt(px, pz, .05);
      if (g && g.enter && cy < g.y1 && !['warehouse', 'substation', 'terminal'].includes(g.id.replace(/-e$/, ''))) {
        b.force = 'shop';
        if (thinX) b.box(side < 0 ? x0 - .015 : x1, y0, z0, side < 0 ? x0 : x1 + .015, y1, z1, liningOf(g), 3); else b.box(x0, y0, side < 0 ? z0 - .015 : z1, x1, y1, side < 0 ? z0 : z1 + .015, liningOf(g), 3);
        if (y0 - g.y0 < .1 || Math.abs(y0 - (L + 3.5)) < .1) { if (thinX) b.box(side < 0 ? x0 - .03 : x1, y0, z0, side < 0 ? x0 : x1 + .03, y0 + .1, z1, m.darkWood, 1); else b.box(x0, y0, side < 0 ? z0 - .03 : z1, x1, y0 + .1, side < 0 ? z0 : z1 + .03, m.darkWood, 1); }
        b.force = null;
      } else if (!g && y0 - L < .1 && h > .5) {
        // Outside, at the pavement: a plinth course.
        b.force = 'out';
        if (thinX) b.box(side < 0 ? x0 - .03 : x1, y0, z0, side < 0 ? x0 : x1 + .03, y0 + .45, z1, m.kerb, 2); else b.box(x0, y0, side < 0 ? z0 - .03 : z1, x1, y0 + .45, side < 0 ? z0 : z1 + .03, m.kerb, 2);
        b.force = null;
      }
    }
  }

  // ---------------------------------------------------------------- floors, roofs, stairs, steelwork
  for (const box of map.boxes) {
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max;
    switch (box.mat) {
      case 'floor-timber': b.box(x0, y1 - .05, z0, x1, y1, z1, m.woodFloor, 2.2); b.box(x0, y0 + .04, z0, x1, y1 - .05, z1, m.concrete, 3); b.box(x0, y0, z0, x1, y0 + .04, z1, m.ceiling, 2.4); break;
      case 'roof-deck': b.force = 'out'; b.box(x0, y1 - .06, z0, x1, y1, z1, m.roofGravel, 2.5); b.force = null; b.box(x0, y0 + .04, z0, x1, y1 - .06, z1, m.concrete, 3); b.box(x0, y0, z0, x1, y0 + .04, z1, m.ceiling, 2.4); break;
      case 'roof-sheet': {
        b.force = 'out'; b.box(x0, y0 + .1, z0, x1, y1, z1, m.sheetRoof, 1.4); b.force = null;
        // Portal frames and purlins under the sheeting, high-bay fittings between them.
        for (let x = x0 + 2.5; x < x1 - 1; x += 5) { b.box(x - .09, y0 - .45, z0 + .4, x + .09, y0 + .1, z1 - .4, m.steel, 1); for (const z of [z0 + .5, z1 - .5]) b.box(x - .12, L, z - .12, x + .12, y0, z + .12, m.steel, 1); }
        for (let z = z0 + 1.5; z < z1 - 1; z += 3) b.box(x0 + .4, y0 - .05, z - .05, x1 - .4, y0 + .1, z + .05, m.steel, 1);
        for (let x = x0 + 5; x < x1 - 2; x += 5) for (let z = z0 + 4.5; z < z1 - 2; z += 6) { b.post(x, z, y0 - .9, y0 - .45, .02, m.darkSteel, 6); b.post(x, z, y0 - 1.15, y0 - .9, .26, m.darkSteel, 12, .1); b.box(x - .2, y0 - 1.17, z - .2, x + .2, y0 - 1.15, z + .2, m.lampCool, 1); fixtures.push({ p: new THREE.Vector3(x, y0 - 1.3, z), where: 'hall', color: '#eaf4ff' }); }
        break;
      }
      case 'canopy': case 'brt-roof': {
        b.force = 'out'; b.box(x0, y1 - .06, z0, x1, y1, z1, m.sheetRoof, 1.4); b.box(x0, y0, z0, x1, y1 - .06, z1, m.white, 2);
        b.box(x0 - .05, y0 - .12, z0 - .05, x1 + .05, y1 + .04, z0 + .08, m.blue, 2); b.box(x0 - .05, y0 - .12, z1 - .08, x1 + .05, y1 + .04, z1 + .05, m.blue, 2);
        for (let x = x0 + 1.6; x < x1 - 1; x += 3.2) { b.box(x - .06, y0 - .22, z0 + .1, x + .06, y0, z1 - .1, m.steel, 1); b.box(x - .5, y0 - .05, (z0 + z1) / 2 - .05, x + .5, y0 - .02, (z0 + z1) / 2 + .05, m.lampCool, 1); }
        b.force = null; break;
      }
      case 'grate': b.box(x0, y1 - .04, z0, x1, y1, z1, m.plate, .9); for (const z of [z0, z1 - .1]) b.box(x0, y0 - .1, z, x1, y1 - .04, z + .1, m.darkSteel, 1); for (const x of [x0, x1 - .1]) b.box(x, y0 - .1, z0, x + .1, y1 - .04, z1, m.darkSteel, 1); break;
      case 'stair-stone': b.box(x0, y0, z0, x1, y1, z1, m.plaza, 2); { const ax = x1 - x0 < z1 - z0; if (ax) { b.box(x0, y1, z0, x0 + .05, y1 + .004, z1, m.tactile, 1); } else b.box(x0, y1, z0, x1, y1 + .004, z0 + .05, m.tactile, 1); } break;
      case 'stair-concrete': b.box(x0, y0, z0, x1, y1, z1, m.concrete, 2); break;
      case 'stair-steel': b.box(x0, y1 - .04, z0, x1, y1, z1, m.plate, .8); { const ax = x1 - x0 < z1 - z0; if (ax) { b.box(x0, y1 - .32, z0, x1, y1 - .04, z0 + .03, m.darkSteel, 1); b.box(x0, y1 - .32, z1 - .03, x1, y1 - .04, z1, m.darkSteel, 1); } else { b.box(x0, y1 - .32, z0, x0 + .03, y1 - .04, z1, m.darkSteel, 1); b.box(x1 - .03, y1 - .32, z0, x1, y1 - .04, z1, m.darkSteel, 1); } } break;
      case 'rail': {
        const ax = x1 - x0 >= z1 - z0, len = ax ? x1 - x0 : z1 - z0, c = ax ? (z0 + z1) / 2 : (x0 + x1) / 2, at = (t: number, y: number) => ax ? new THREE.Vector3(x0 + t, y, c) : new THREE.Vector3(c, y, z0 + t), n = Math.max(1, Math.ceil(len / 1.3));
        for (let i = 0; i <= n; i++) b.cyl(at(i * len / n, y0), at(i * len / n, y1), .02, m.darkSteel, 6);
        b.cyl(at(0, y1 - .02), at(len, y1 - .02), .025, m.stainless, 8); b.cyl(at(0, y0 + (y1 - y0) * .5), at(len, y0 + (y1 - y0) * .5), .014, m.darkSteel, 6);
        break;
      }
      case 'quay': b.box(x0, y0, z0, x1, y1 - .12, z1, m.concrete, 3); b.box(x0, y1 - .12, z0 - .08, x1, y1, z1, m.precast, 2); break;
      case 'stone-wall': b.box(x0, y0, z0, x1, y1 - .08, z1, m.stone, 2); b.box(x0 - .03, y1 - .08, z0 - .03, x1 + .03, y1, z1 + .03, m.plaza, 2); break;
      case 'yard-wall': b.box(x0, y0, z0, x1, y1 - .1, z1, m.block, 2.4); b.box(x0 - .04, y1 - .1, z0 - .04, x1 + .04, y1, z1 + .04, m.precast, 2); break;
      case 'hoarding': {
        // Site hoarding: profiled sheet between steel posts, a white band, a kicker board.
        const ax = x1 - x0 >= z1 - z0, len = ax ? x1 - x0 : z1 - z0, skin = hash(x0, z0) > .5 ? m.sheetGreen : m.sheetBlue;
        b.box(x0, y0 + .12, z0, x1, y1, z1, skin, 1.5); b.box(x0 - .01, y0, z0 - .01, x1 + .01, y0 + .12, z1 + .01, m.concrete, 2);
        b.box(x0 - (ax ? 0 : .012), y0 + 1.9, z0 - (ax ? .012 : 0), x1 + (ax ? 0 : .012), y0 + 2.3, z1 + (ax ? .012 : 0), m.white, 2);
        for (let t = 0; t <= len + .01; t += Math.max(1.2, len / Math.max(1, Math.round(len / 2.4)))) { const px = ax ? x0 + t : (x0 + x1) / 2, pz = ax ? (z0 + z1) / 2 : z0 + t; b.box(px - (ax ? .05 : .24), y0, pz - (ax ? .24 : .05), px + (ax ? .05 : .24), y1 + .08, pz + (ax ? .24 : .05), m.darkSteel, 1); }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- openings
  let shopNo = 0;
  for (const d of map.deco) {
    const [x0, y0, z0] = d.min, [x1, y1, z1] = d.max, az = d.alongZ, a0 = az ? z0 : x0, a1 = az ? z1 : x1, w = a1 - a0, c = az ? (x0 + x1) / 2 : (z0 + z1) / 2, t = (az ? x1 - x0 : z1 - z0) / 2;
    const ug = y1 < L, cy = (y0 + y1) / 2;
    // The face in opening coordinates: u along the wall, v up, w across it.
    const origin = az ? new THREE.Vector3(c, 0, a0) : new THREE.Vector3(a0, 0, c);
    const along = az ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), across = az ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const f = new Face(b, origin, along, across, w, y1 - y0);
    const fm = d.kind === 'roller' ? m.yellow : m.frame, j = .07;
    if (d.kind !== 'open') {
      f.box(0, y0, j, y1, -t - .02, t + .02, fm, 1); f.box(w - j, y0, w, y1, -t - .02, t + .02, fm, 1); f.box(0, y1 - j, w, y1, -t - .02, t + .02, fm, 1);
      if (d.kind === 'window' || d.kind === 'shop') f.box(0, y0, w, y0 + j, -t - .02, t + .02, fm, 1);
    }
    if (d.kind === 'window' || d.kind === 'shop') { const n = Math.max(1, Math.round(w / 1.4)); for (let i = 1; i < n; i++) f.box(i * w / n - .022, y0, i * w / n + .022, y1, -.03, .03, fm, 1); }
    if (ug) continue;
    // Which side is the street? (The side that is not inside an enterable building.)
    for (const side of [-1, 1]) {
      const px = az ? c + side * (t + .5) : (a0 + a1) / 2, pz = az ? (a0 + a1) / 2 : c + side * (t + .5), g = buildingAt(px, pz, .05);
      if (g && g.enter && cy < g.y1) continue;
      const out = (w0: number, w1: number): [number, number] => side > 0 ? [t + w0, t + w1] : [-t - w1, -t - w0];
      b.force = 'out';
      if (d.kind === 'window') { const [p, q] = out(0, .1); f.box(-.08, y0 - .07, w + .08, y0, p, q, m.precast, 1); if (detail && hash(a0, c) > .55 && y0 > L + 3) aircon(f.matrix().clone().multiply(T(w * .5, y0 - .85, side > 0 ? t : -t)).multiply(RY(side > 0 ? 0 : Math.PI))); }
      else if (d.kind === 'shop' || (d.kind === 'door' && y0 - L < .1 && !ug)) {
        const upper = y0 > L + 2;
        if (d.kind === 'shop' && !upper) {
          // A fascia sign over the window, or a fabric awning.
          const [fg0, fg1] = out(.02, .1), idx = shopNo++, [bg, fg] = SIGN_COLOURS[idx % SIGN_COLOURS.length];
          if (idx % 3 !== 1) {
            f.box(-.1, y1 + .12, w + .1, y1 + .72, fg0, fg1, m.frame, 1);
            const uv = signs.text(SHOPS[idx % SHOPS.length], bg, fg, 512, 96), Mx = f.matrix().clone().multiply(T(w / 2, y1 + .42, side > 0 ? t + .105 : -t - .105)); if (side < 0) Mx.multiply(RY(Math.PI));
            signPanel(b, signMat, uv, w + .1, .52, Mx);
          } else {
            const g2 = new THREE.BoxGeometry(w + .3, .04, 1.2), Mx = f.matrix().clone().multiply(T(w / 2, y1 + .35, side * (t + .55))).multiply(new THREE.Matrix4().makeRotationX(side * .32));
            b.add(g2, [m.red, m.green, m.orange, m.blue][idx % 4], 1, Mx); g2.dispose();
          }
        } else if (d.kind === 'door') {
          // A door leaf standing open against the wall, and a small canopy.
          const [c0, c1] = out(0, .7); f.box(-.15, y1 + .1, w + .15, y1 + .16, c0, c1, m.frame, 1);
          const leaf = new THREE.BoxGeometry(Math.min(1, w * .5), y1 - y0 - .1, .045), lw = Math.min(1, w * .5);
          const Mx = f.matrix().clone().multiply(T(.05, (y0 + y1) / 2, side * (t + .03))).multiply(RY(side * 1.45)).multiply(T(lw / 2, 0, 0));
          b.add(leaf, m.darkWood, 1, Mx); leaf.dispose();
        }
      } else if (d.kind === 'roller') {
        // The shutter rolled up into its housing.
        const [h0, h1] = out(0, .34); f.box(-.1, y1 - .05, w + .1, y1 + .4, h0, h1, m.steel, 1);
        f.box(j, y1 - .5, w - j, y1 - .05, -.03, .03, m.shutter, 1.2);
        for (const u of [-.14, w + .02]) f.box(u, y0, u + .12, y0 + 1, h0, h0 + (side > 0 ? .12 : -.12) + (side > 0 ? 0 : .34), m.yellow, 1);
      }
      b.force = null;
    }
  }

  // ---------------------------------------------------------------- solid buildings: real fronts
  const solid = (box: Box, style: (face: number) => Parameters<typeof facade>[2] | null, extra = 0) => {
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, H = y1 - y0 + extra;
    // South (+z), north (−z), east (+x), west (−x) faces; u runs so that the face reads left to right from outside.
    const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3, number][] = [
      [new THREE.Vector3(x0, y0, z1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), x1 - x0], [new THREE.Vector3(x1, y0, z0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1), x1 - x0],
      [new THREE.Vector3(x1, y0, z1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), z1 - z0], [new THREE.Vector3(x0, y0, z0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), z1 - z0]];
    b.force = 'out';
    faces.forEach(([o, al, out, len], i) => {
      // Faces against the edge of the site or buried in a neighbour are skipped.
      const mx = o.x + al.x * len / 2 + out.x * .6, mz = o.z + al.z * len / 2 + out.z * .6;
      if (Math.abs(mx) > map.bounds[2] - .2 || Math.abs(mz) > map.bounds[3] - .2) return;
      const s = style(i); if (s) facade(new Face(b, o, al, out, len, H), m, s, detail, detail ? aircon : undefined);
    });
    b.box(x0, y1 + extra - .02, z0, x1, y1 + extra + .02, z1, m.roofGravel, 3);
    b.force = null;
  };
  for (const box of map.boxes) {
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, seed = Math.abs(x0) * 3.1 + z0 * 1.7;
    if (box.mat === 'bld-tower') solid(box, () => ({ wall: m.render[1], bay: 3.25, floor: 3.25, ground: 'shops', balcony: .34, trim: m.precast, seed }), 0);
    else if (box.mat === 'bld-brick-upper') solid(box, i => (i === 0 ? { wall: m.brick, bay: 3.2, floor: 3.4, ground: 'none', balcony: 0, trim: m.precast, seed } : { wall: m.brick, bay: 40, floor: 9, ground: 'none', balcony: 0, trim: m.precast, seed }));
    else if (box.mat === 'bld-panel' && Math.min(x1 - x0, z1 - z0) > .8) solid(box, () => ({ wall: m.panel, bay: 2.5, floor: 3.5, ground: 'shops', balcony: 0, trim: m.frame, seed }));
    else if (box.mat === 'bld-tower-base') { b.force = 'out'; b.box(x0, y0, z0, x1, y1, z1, m.cladding, 3); b.box(x0 - .06, y1 - .5, z0 - .06, x1 + .06, y1 - .3, z1 + .06, m.stainless, 1); b.force = null; }
    else if (box.mat === 'bld-glass-tower' || box.mat === 'bld-tower-shaft') {
      // Curtain wall: reflective glass behind a grid of mullions and spandrel bands.
      const shaft = box.mat === 'bld-tower-shaft', glassM = shaft ? m.curtain : m.curtainGreen, top = shaft ? y1 : y1;
      b.force = 'out'; b.box(x0, y0, z0, x1, top, z1, glassM, 4);
      for (let y = y0; y <= top + .01; y += 3.6) b.box(x0 - .06, y - .22, z0 - .06, x1 + .06, y + .22, z1 + .06, shaft ? m.stainless : m.frame, 2);
      const step = shaft ? 1.5 : 2;
      for (let x = x0; x <= x1 + .01; x += (x1 - x0) / Math.round((x1 - x0) / step)) for (const z of [z0 - .1, z1 + .02]) b.box(x - .04, y0, z, x + .04, top, z + .08, m.frame, 1);
      for (let z = z0; z <= z1 + .01; z += (z1 - z0) / Math.round((z1 - z0) / step)) for (const x of [x0 - .1, x1 + .02]) b.box(x, y0, z - .04, x + .08, top, z + .04, m.frame, 1);
      if (shaft) {
        // The crown: a stepped lantern and a mast with an aviation light. Seen from every district.
        b.box(x0 + .8, top, z0 + .8, x1 - .8, top + 3, z1 - .8, m.curtain, 4); b.box(x0 + .6, top + 3, z0 + .6, x1 - .6, top + 3.3, z1 - .6, m.stainless, 1);
        b.post(0, (z0 + z1) / 2, top + 3.3, top + 13, .16, m.stainless, 8, .05); b.box(-.14, top + 13, (z0 + z1) / 2 - .14, .14, top + 13.3, (z0 + z1) / 2 + .14, m.beacon, 1);
        const uv = signs.text('OKUN TOWER', '#0d1b2a', '#f2e6c8', 512, 96), zc = z1 + .12; signPanel(b, signMat, uv, 7.4, 1.4, T(0, y0 + 2.2, zc));
      } else { b.box(x0, top, z0, x1, top + .9, z1, m.frame, 2); const uv = signs.text('OKUN TRUST', '#0f3d33', '#f2e6c8', 512, 96); const east = x0 > 0; signPanel(b, signMat, uv, 7, 1.3, T(east ? x0 - .13 : x1 + .13, y0 + 1.6, 0).multiply(RY(east ? -Math.PI / 2 : Math.PI / 2))); }
      b.force = null;
    } else if (box.mat === 'bld-block' && Math.min(x1 - x0, z1 - z0) > .8) { b.force = 'out'; b.box(x0, y0, z0, x1, y1, z1, m.blockwork, 1.6); b.force = null; }
  }
  // The street walls behind the site: a row of different buildings, taller than their collision.
  for (const box of map.boxes) {
    if (box.mat !== 'bld-back') continue;
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max, ax = x1 - x0 > z1 - z0, len = ax ? x1 - x0 : z1 - z0;
    let t = 0, n = 0;
    while (t < len - 1) {
      const seed = (ax ? 100 : 200) + n * 17.7 + (x0 + z0), w = Math.min(len - t, 9 + Math.floor(hash(seed) * 3) * 3.25), extra = Math.floor(hash(seed, 3) * 4) * 3.3, style = Math.floor(hash(seed, 5) * 4);
      const wallM = style === 0 ? m.brick : style === 1 ? m.panel : m.render[Math.floor(hash(seed, 9) * m.render.length)];
      const o = ax ? new THREE.Vector3(x0 + t, y0, z0 < 0 ? z1 : z0) : new THREE.Vector3(x0 < 0 ? x1 : x0, y0, x0 < 0 ? z0 + t + w : z0 + t);
      const al = ax ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, x0 < 0 ? -1 : 1), out = ax ? new THREE.Vector3(0, 0, z0 < 0 ? 1 : -1) : new THREE.Vector3(x0 < 0 ? 1 : -1, 0, 0);
      if (ax && z0 < 0) { /* reads left to right from the south */ } else if (ax) { o.x = x0 + t + w; al.x = -1; }
      b.force = 'out';
      // Hidden behind the north block, the wall still needs a face; elsewhere it is a full building front.
      facade(new Face(b, o, al, out, w, y1 - y0 + extra), m, { wall: wallM, bay: 3.25, floor: 3.3, ground: 'shops', balcony: style === 2 ? .3 : .12, trim: style === 1 ? m.frame : m.precast, seed }, detail, detail ? aircon : undefined);
      const bx0 = ax ? x0 + t : x0, bx1 = ax ? x0 + t + w : x1, bz0 = ax ? z0 : z0 + t, bz1 = ax ? z1 : z0 + t + w;
      // The body behind the front (a little depth beyond the site), and its roof.
      const back = 6; b.box(ax ? bx0 : x0 < 0 ? bx0 - back : bx0, y0, ax ? (z0 < 0 ? bz0 - back : bz0) : bz0, ax ? bx1 : x0 < 0 ? bx1 : bx1 + back, y1 + extra, ax ? (z0 < 0 ? bz1 : bz1 + back) : bz1, wallM, 3);
      b.force = null; t += w; n++;
    }
  }
}
export type { Box, Deco };
