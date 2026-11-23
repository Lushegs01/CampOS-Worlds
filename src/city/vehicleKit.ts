// Procedural models for Metropolitan City's ambient vehicles, one merged geometry per class, drawn instanced.
// Local frame: +z forward, +x to the vehicle's left, y up, origin on the ground at the body's centre.
// Per-vertex tags: paint (1 = takes the instance's paint colour), lamp kind (lights driven per instance),
// roughness and metalness. Glass is a separate, transparent geometry so the drivers inside can be seen.
import * as THREE from 'three';
import { environmentLayer } from '../world/environment';
import { Builder } from './geom';
import { CITY_CLASSES } from '../../shared/city/vehicles.mjs';

export const LAMP = { head: 1, tail: 2, indL: 3, indR: 4, beaconR: 5, beaconB: 6, reverse: 7, taxi: 8 } as const;
type C = typeof CITY_CLASSES[keyof typeof CITY_CLASSES];
const TRIM = { color: '#1c1e21', rough: .55, metal: .1 }, CHROME = { color: '#c9ccd1', rough: .18, metal: 1 }, RUBBER = { color: '#151617', rough: .9 };
const PAINT = { paint: 1, color: '#ffffff', rough: .32, metal: .35 };
const SKIN = ['#5a3826', '#7d5038', '#3f281c', '#8c5d3f'];

function lamps(b: Builder, c: C, yFront: number, yRear: number, wide = .32) {
  const L = c.length / 2, W = c.width / 2;
  for (const s of [-1, 1]) {
    b.round([s * (W - .26), yFront, L - .03], [wide, .13, .08], .03, { lamp: LAMP.head, color: '#e9eef2', rough: .1 });
    b.box([s * (W - .08), yFront - .02, L - .06], [.07, .08, .06], { lamp: s > 0 ? LAMP.indL : LAMP.indR, color: '#d98a2a', rough: .2 });
    b.round([s * (W - .22), yRear, -L + .03], [wide * .95, .14, .08], .03, { lamp: LAMP.tail, color: '#8d1a1a', rough: .2 });
    b.box([s * (W - .5), yRear - .07, -L + .04], [.12, .06, .05], { lamp: LAMP.reverse, color: '#d8d8d8', rough: .2 });
    b.box([s * (W - .05), yRear, -L + .12], [.05, .08, .06], { lamp: s > 0 ? LAMP.indL : LAMP.indR, color: '#c97a24', rough: .2 });
  }
}
function plates(b: Builder, c: C, yF: number, yR: number) {
  b.box([0, yF, c.length / 2 + .005], [.52, .12, .02], { color: '#f1f2ec', rough: .5 });
  b.box([0, yR, -c.length / 2 - .005], [.52, .12, .02], { color: '#f1f2ec', rough: .5 });
}
function driver(b: Builder, x: number, y: number, z: number, seed: number) {
  b.round([x, y + .3, z - .1], [.42, .55, .3], .1, { color: ['#2b3442', '#6b2f2b', '#d9d2c3', '#2f4f3f'][seed % 4], rough: .8 }); // torso
  b.sphere([x, y + .72, z - .05], .11, [1, 1.12, 1.05], { color: SKIN[seed % 4], rough: .6 });
  b.sphere([x, y + .77, z - .08], .112, [1, .7, 1.02], { color: '#161210', rough: .8 }); // hair
  b.box([x, y + .02, z - .25], [.48, .12, .55], { color: '#2a2b2e', rough: .9 }); // seat
  b.box([x, y + .42, z - .42], [.48, .6, .1], { color: '#2a2b2e', rough: .9 });
}
function wheelArches(b: Builder, c: C) {
  for (const z of [c.wheelbase / 2, -c.wheelbase / 2]) for (const s of [-1, 1]) b.cyl([s * (c.width / 2 + .004), c.wheel, z], c.wheel + .07, c.wheel + .07, .012, 16, { color: '#0b0c0d', rough: .95 }, [0, 0, Math.PI / 2]);
}

/** Saloon, hatch, SUV, coupé, taxi and police car (they share a three-box layout with different proportions). */
function car(cls: string, c: C) {
  const b = new Builder(), g = new Builder(), L = c.length, W = c.width;
  const p = {
    sedan: { sill: .22, belt: .86, roof: 1.43, cab0: -1.05, cab1: .95, top0: -.8, top1: .35, hood: .82 },
    taxi: { sill: .22, belt: .86, roof: 1.43, cab0: -1.05, cab1: .95, top0: -.8, top1: .35, hood: .82 },
    police: { sill: .22, belt: .88, roof: 1.47, cab0: -1.1, cab1: .95, top0: -.82, top1: .35, hood: .84 },
    hatch: { sill: .22, belt: .88, roof: 1.48, cab0: -1.62, cab1: .78, top0: -1.45, top1: .2, hood: .84 },
    suv: { sill: .32, belt: 1.08, roof: 1.76, cab0: -1.95, cab1: .82, top0: -1.85, top1: .3, hood: 1.04 },
    sports: { sill: .16, belt: .72, roof: 1.2, cab0: -.95, cab1: .75, top0: -.55, top1: .05, hood: .66 },
  }[cls as 'sedan']!;
  const mid = (p.sill + p.belt) / 2;
  // Lower body, with a separate bonnet and boot so the silhouette steps.
  b.round([0, mid, 0], [W, p.belt - p.sill, L], .16, PAINT);
  b.round([0, p.belt - .02, (L / 2 + p.cab1) / 2 + .02], [W - .08, .1, L / 2 - p.cab1 - .02], .05, PAINT);
  if (p.cab0 > -L / 2 + .4) b.round([0, p.belt - .02, (-L / 2 + p.cab0) / 2], [W - .1, .1, p.cab0 + L / 2 - .02], .05, PAINT);
  // Glasshouse (the glass geometry) with a painted roof and pillars over it.
  const gh = p.roof - p.belt;
  g.taper([0, p.belt - .02, (p.cab0 + p.cab1) / 2], W - .14, p.cab1 - p.cab0, W - .38, p.top1 - p.top0, gh - .02, (p.top0 + p.top1) / 2 - (p.cab0 + p.cab1) / 2, { color: '#ffffff' });
  b.round([0, p.roof - .02, (p.top0 + p.top1) / 2], [W - .36, .07, p.top1 - p.top0 + .14], .03, PAINT);
  for (const s of [-1, 1]) {
    // Pillars run from the belt line at the glasshouse's base to the roof's edge (leaning with the screen).
    const xw = (yb: number) => W / 2 - .07 - (yb - p.belt) / gh * .12;
    for (const [z0, z1, w] of [[p.cab0, p.top0, .16], [p.cab1, p.top1, .08]] as const) {
      const len = Math.hypot(z1 - z0, gh), ang = Math.atan2(z1 - z0, gh);
      b.box([s * xw(p.belt + gh / 2), p.belt + gh / 2, (z0 + z1) / 2], [.07, len, w], PAINT, [ang, 0, -s * .12]);
    }
    b.box([s * (W / 2 - .13), p.belt + gh / 2, (p.top0 + p.top1) / 2 - .15], [.06, gh, .09], TRIM, [0, 0, -s * .12]); // B pillar
    b.box([s * (W / 2 + .06), p.belt + .02, p.cab1 - .12], [.1, .09, .16], PAINT); // mirror
    // Door shut lines and handles.
    for (const z of [p.cab1 - .05, (p.top0 + p.top1) / 2 - .15, p.cab0 + .15]) b.box([s * (W / 2 + .002), mid, z], [.006, p.belt - p.sill - .1, .012], { color: '#2a2c2f' });
    for (const z of [(p.top0 + p.top1) / 2 + .2, (p.top0 + p.top1) / 2 - .65]) b.box([s * (W / 2 + .01), p.belt - .1, z], [.02, .03, .14], CHROME);
  }
  // Bumpers, grille, sills.
  b.round([0, p.sill + .12, L / 2 - .02], [W + .02, .24, .16], .06, cls === 'sports' ? PAINT : TRIM);
  b.round([0, p.sill + .12, -L / 2 + .02], [W + .02, .26, .16], .06, cls === 'sports' ? PAINT : TRIM);
  b.box([0, p.hood - .2, L / 2 + .005], [W * .42, .16, .03], { color: '#0f1012', rough: .4, metal: .3 });
  b.box([0, p.hood - .2 - .1, L / 2 + .02], [W * .44, .02, .02], CHROME);
  for (const s of [-1, 1]) b.box([s * (W / 2 + .005), p.sill + .03, 0], [.03, .08, c.wheelbase - .6], TRIM);
  wheelArches(b, c);
  lamps(b, c, p.hood - .14, p.belt - .14);
  plates(b, c, p.sill + .22, p.belt - .32);
  driver(b, .37, p.sill + .2, .05 + (p.top0 + p.top1) / 2 + .1, cls.length);
  if (cls !== 'sports') b.box([-.37, p.sill + .22, (p.top0 + p.top1) / 2 - .2], [.48, .12, .55], { color: '#2a2b2e', rough: .9 });
  b.cyl([.37, p.belt + .12, p.cab1 - .35], .17, .17, .03, 12, { color: '#111', rough: .6 }, [-1.1, 0, 0]); // steering wheel
  b.box([0, p.belt - .05, p.cab1 - .2], [W - .3, .12, .35], { color: '#1b1c1e', rough: .8 }); // dashboard
  if (cls === 'taxi') {
    b.round([0, p.roof + .1, (p.top0 + p.top1) / 2], [.62, .17, .26], .05, { lamp: LAMP.taxi, color: '#f3d36a', rough: .4 });
    for (let i = -6; i < 6; i++) for (const s of [-1, 1]) if ((i & 1) === 0) b.box([s * (W / 2 + .004), mid + .03, i * .19 + .1], [.006, .09, .19], { color: '#151515' });
  }
  if (cls === 'police') {
    b.round([0, p.roof + .08, (p.top0 + p.top1) / 2 + .1], [W - .55, .1, .28], .03, TRIM);
    for (const s of [-1, 1]) b.round([s * .32, p.roof + .16, (p.top0 + p.top1) / 2 + .1], [.5, .1, .22], .04, { lamp: s > 0 ? LAMP.beaconR : LAMP.beaconB, color: s > 0 ? '#7a1010' : '#10207a', rough: .2 });
    for (const s of [-1, 1]) b.box([s * (W / 2 + .004), mid + .02, -.1], [.006, .16, L - .9], { color: '#1d3f8f', rough: .4 });
    b.box([0, p.sill + .26, L / 2 + .09], [W - .2, .3, .08], TRIM); // push bar
  }
  if (cls === 'suv') for (const s of [-1, 1]) b.box([s * (W / 2 - .28), p.roof + .06, (p.top0 + p.top1) / 2], [.04, .05, p.top1 - p.top0], { color: '#2d2f33', metal: .6, rough: .4 });
  return { body: b.build(), glass: g.build() };
}
function pickup(c: C) {
  const b = new Builder(), g = new Builder(), L = c.length, W = c.width;
  b.round([0, .68, 0], [W, .7, L], .12, PAINT);
  g.taper([0, 1.02, .5], W - .14, 1.5, W - .36, 1.05, .74, -.05, {});
  b.round([0, 1.78, .45], [W - .32, .07, 1.05], .03, PAINT);
  // Load bed: walls and floor.
  for (const s of [-1, 1]) b.box([s * (W / 2 - .05), 1.18, -1.25], [.1, .4, 2.3], PAINT);
  b.box([0, 1.18, -L / 2 + .05], [W, .4, .1], PAINT); b.box([0, 1.04, -1.25], [W - .2, .06, 2.25], { color: '#2a2a2a', rough: .8 });
  b.box([0, 1.18, -.12], [W, .4, .08], PAINT);
  b.round([0, .45, L / 2 - .02], [W + .04, .28, .18], .06, CHROME); b.round([0, .45, -L / 2 + .02], [W + .04, .26, .16], .06, TRIM);
  b.box([0, .85, L / 2 + .01], [W * .55, .28, .03], { color: '#101113', metal: .4, rough: .3 });
  wheelArches(b, c); lamps(b, c, .88, 1.05, .28); plates(b, c, .5, .62);
  driver(b, .37, .72, .55, 3);
  return { body: b.build(), glass: g.build() };
}
function van(c: C) {
  const b = new Builder(), g = new Builder(), L = c.length, W = c.width;
  b.round([0, 1.2, -.25], [W, 1.95, L - .5], .14, PAINT);
  b.round([0, .72, L / 2 - .45], [W - .02, .95, .9], .16, PAINT); // bonnet
  g.taper([0, 1.16, L / 2 - 1.05], W - .1, .64, W - .14, .3, .92, -.17, {});
  for (const s of [-1, 1]) b.box([s * (W / 2 + .003), 1.62, -.4], [.006, .5, 1.9], { color: '#22272c', rough: .2, metal: .1 }); // side glass band (tinted)
  b.box([0, 1.62, L / 2 - .5], [W - .22, .72, .02], { color: '#26303a', rough: .06, metal: .2 }, [-.12, 0, 0]); // windscreen
  b.box([0, .42, L / 2 + .02], [W + .02, .26, .14], TRIM); b.box([0, .42, -L / 2 + .02], [W + .02, .26, .14], TRIM);
  wheelArches(b, c); lamps(b, c, .92, 1.0, .3); plates(b, c, .52, .6);
  driver(b, .4, .82, L / 2 - 1.35, 1);
  for (const s of [-1, 1]) b.box([s * (W / 2 + .004), 1.15, -.9], [.006, .5, 1.6], { color: '#1e6b8f', rough: .5 }); // delivery livery panel
  return { body: b.build(), glass: g.build() };
}
function truck(c: C) {
  const b = new Builder(), g = new Builder(), L = c.length, W = c.width;
  b.round([0, 1.45, L / 2 - 1.05], [W, 2.1, 2.0], .14, PAINT); // cab
  g.taper([0, 1.75, L / 2 - .2], W - .1, .4, W - .14, .3, .8, -.05, {});
  b.round([0, 1.95, -1.05], [W + .04, 2.7, L - 2.3], .06, { color: '#ecebe6', rough: .5 }); // box
  for (const s of [-1, 1]) b.box([s * (W / 2 + .03), 1.3, -1.05], [.006, .28, L - 2.5], { color: '#c8402e', rough: .5 });
  b.box([0, .6, 0], [W - .4, .3, L - .4], { color: '#222', rough: .7 }); // chassis
  b.box([0, .48, L / 2 - .02], [W + .02, .3, .14], TRIM);
  wheelArches(b, c); lamps(b, c, .78, .7, .3); plates(b, c, .5, .5);
  driver(b, .5, 1.08, L / 2 - .95, 2);
  return { body: b.build(), glass: g.build() };
}
function bus(c: C) {
  const b = new Builder(), g = new Builder(), L = c.length, W = c.width;
  b.round([0, 1.05, 0], [W, 1.4, L], .14, PAINT);
  b.round([0, 2.7, 0], [W - .02, .55, L - .02], .14, { color: '#eef0ec', rough: .45 });
  g.box([0, 2.05, 0], [W + .01, .85, L - .3], {});
  for (let z = -L / 2 + 1.3; z < L / 2 - .8; z += 1.45) for (const s of [-1, 1]) b.box([s * (W / 2 + .006), 2.05, z], [.02, .85, .1], { color: '#1c1e21' });
  b.box([0, 2.25, L / 2 + .006], [W - .2, 1.1, .02], { color: '#1c1e21' }); g.box([0, 2.0, L / 2 + .01], [W - .3, 1.3, .02], {});
  b.box([0, 2.75, L / 2 + .02], [1.6, .22, .02], { lamp: LAMP.taxi, color: '#e9b824' }); // route display
  wheelArches(b, c); lamps(b, c, .62, .9, .3); plates(b, c, .42, .5);
  driver(b, .6, 1.0, L / 2 - 1.2, 0);
  for (let z = -L / 2 + 2; z < L / 2 - 2; z += 1.5) for (const s of [-1, 1]) b.sphere([s * .7, 2.0, z], .11, [1, 1.1, 1], { color: SKIN[(z * 7 | 0) & 3] }, 8);
  return { body: b.build(), glass: g.build() };
}
function moto(c: C) {
  const b = new Builder(), g = new Builder();
  b.round([0, .62, .05], [.28, .3, 1.2], .1, PAINT); // tank and body
  b.round([0, .78, -.35], [.3, .1, .7], .05, { color: '#1a1a1a', rough: .8 }); // seat
  b.cyl([0, .7, .72], .03, .03, .9, 6, CHROME, [-.35, 0, 0]); // forks
  b.box([0, 1.08, .58], [.7, .04, .04], { color: '#202020', metal: .5, rough: .4 }); // bars
  b.round([0, .95, .78], [.2, .16, .08], .03, { lamp: LAMP.head, color: '#e9eef2', rough: .1 });
  b.box([0, .78, -.78], [.16, .07, .05], { lamp: LAMP.tail, color: '#8d1a1a' });
  b.box([0, .38, -.1], [.18, .22, .6], { color: '#2a2a2c', metal: .6, rough: .35 }); // engine
  // Rider: helmet, jacket, legs on the pegs, arms to the bars.
  b.round([0, 1.25, -.25], [.4, .55, .28], .12, { color: '#2b3442', rough: .8 });
  b.sphere([0, 1.68, -.2], .15, [1, 1.08, 1.1], { color: '#d8d8d8', rough: .25, metal: .1 });
  b.box([0, 1.67, -.06], [.2, .07, .03], { color: '#111', rough: .1 });
  for (const s of [-1, 1]) { b.capsule([s * .17, .75, -.15], .07, .45, { color: '#22262c' }, [1.2, 0, 0]); b.capsule([s * .19, 1.25, .2], .055, .38, { color: '#2b3442' }, [1.1, 0, -s * .2]); }
  void g; const gg = new Builder(); gg.box([0, 1.08, .78], [.22, .18, .02], {}, [-.3, 0, 0]);
  return { body: b.build(), glass: gg.build() };
}

export function buildClassModel(cls: string) {
  const c = CITY_CLASSES[cls as keyof typeof CITY_CLASSES];
  if (cls === 'pickup') return pickup(c);
  if (cls === 'van') return van(c);
  if (cls === 'truck') return truck(c);
  if (cls === 'bus') return bus(c);
  if (cls === 'moto') return moto(c);
  return car(cls, c);
}
/** One wheel: tyre, sidewall, rim and hub (unit radius 1, width 1 across x; scaled per class by the instance). */
export function buildWheel() {
  const b = new Builder();
  b.cyl([0, 0, 0], 1, 1, 1, 18, RUBBER, [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) {
    b.cyl([s * .5, 0, 0], .66, .66, .04, 14, { color: '#a9adb3', rough: .25, metal: .9 }, [0, 0, Math.PI / 2]);
    for (let k = 0; k < 5; k++) b.box([s * .53, 0, 0], [.03, .12, 1.15], { color: '#8d9197', metal: .9, rough: .3 }, [k * Math.PI / 5, 0, 0]);
    b.cyl([s * .55, 0, 0], .16, .16, .05, 8, { color: '#3a3c40', metal: .7, rough: .4 }, [0, 0, Math.PI / 2]);
  }
  return b.build();
}
/** The body/glass material: vertex colours, per-instance paint, lamps driven per instance. */
export function vehicleMaterial(kind: 'body' | 'glass') {
  const m = kind === 'body'
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 1 })
    : new THREE.MeshPhysicalMaterial({ color: '#7d8e96', roughness: .06, metalness: .1, transparent: true, opacity: .5, envMapIntensity: 1.6, clearcoat: 1, depthWrite: false });
  const uniforms = { uTime: { value: 0 }, uNight: { value: .35 } };
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aTag; attribute vec3 iPaint; attribute vec4 iLamps;
varying vec4 vTag; varying vec3 vPaint; varying vec4 vLamps; varying float vLampX;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTag = aTag; vPaint = iPaint; vLamps = iLamps; vLampX = position.x;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uNight; varying vec4 vTag; varying vec3 vPaint; varying vec4 vLamps; varying float vLampX;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${kind === 'body' ? 'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vPaint, vTag.x);' : ''}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = ${kind === 'body' ? 'vTag.z' : 'roughness'};`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = ${kind === 'body' ? 'vTag.w' : 'metalness'};`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${kind === 'body' ? `{
  // iLamps: x brake (0..1), y indicators (-1 left, 1 right, 2 hazards, 0 off), z beacons (0/1), w reverse.
  float k = floor(vTag.y + .5); float blink = step(.5, fract(uTime * 1.6)); float beacon = step(.5, fract(uTime * 3.0 + (vLampX > 0.0 ? .5 : 0.)));
  vec3 e = vec3(0.);
  if (k == 1.) e = vec3(1., .95, .85) * (.6 + 2.2 * uNight);
  else if (k == 2.) e = vec3(1., .08, .05) * (.35 + uNight * .6 + vLamps.x * 2.6);
  else if (k == 3. || k == 4.) { float side = k == 3. ? -1. : 1.; float on = (vLamps.y == side || vLamps.y > 1.5) ? blink : 0.; e = vec3(1., .5, .08) * on * 3.; }
  else if (k == 5.) e = vec3(1., .05, .05) * vLamps.z * beacon * 5.;
  else if (k == 6.) e = vec3(.1, .25, 1.) * vLamps.z * (1. - beacon) * 5.;
  else if (k == 7.) e = vec3(1.) * vLamps.w * 2.;
  else if (k == 8.) e = vec3(1., .82, .3) * 1.4;
  totalEmissiveRadiance += e;
}` : ''}`);
  };
  m.customProgramCacheKey = () => 'city-vehicle-' + kind;
  // Rain beads on the paint and glass: wet cars are darker and glossier (./../world/environment.ts).
  environmentLayer(m, { porosity: .15 });
  return { material: m, uniforms };
}
