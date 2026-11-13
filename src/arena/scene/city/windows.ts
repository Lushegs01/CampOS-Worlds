// Operation: Metropolis — windows with rooms behind them.
//
// Every pane of every solid building is a single quad. Its shader traces the view ray into a box room behind the
// glass (interior mapping): back and side walls, floor and ceiling, a piece of furniture standing in the room and a
// cabinet against a wall, a ceiling light, and blinds or curtains hung just behind the glass. Each window has its
// own size, depth, paint, flooring, furniture and whether its light is on, from a seed. The glass in front is the
// ordinary PBR glass of the scene (reflecting the sky through the image-based light and the sun), and the room
// shows through it by (1 − Fresnel): at a glance along the street the façade is reflection, face-on it is a room.
//
// Three kinds: rooms (flats and offices: sill, blinds, curtains), shops (deep, bright, shelves of stock) and
// curtain-wall offices (floor-to-ceiling, ceiling panels, rows of desks). One material: one draw call per region.
import * as THREE from 'three';
import { heightFog } from './atmosphere';

export const WINDOW_ROOM = 0, WINDOW_SHOP = 1, WINDOW_TOWER = 2;
/** Light in the rooms: daylight that reaches in, a lamp's strength, and how many rooms have it switched on. */
export const windowLight = { uDaylight: { value: .2 }, uLamp: { value: 1.2 }, uLitShare: { value: .25 }, uShopLit: { value: .9 }, uDayTint: { value: new THREE.Color(1, 1, 1) } };
void heightFog;

const ROOM = /* glsl */`
uniform float uDaylight, uLamp, uLitShare, uShopLit; uniform vec3 uDayTint;
flat varying vec4 vWin; varying vec2 vWinUv; varying vec3 vWinW; varying vec3 vWinN;
// (vWin is flat and its seed a small integer: the hash below amplifies any interpolation error into per-pixel noise.)
float wH(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
float wN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); float a = wH(i.x + i.y * 57.), b = wH(i.x + 1. + i.y * 57.), c = wH(i.x + (i.y + 1.) * 57.), d = wH(i.x + 1. + (i.y + 1.) * 57.); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
vec3 wallPaint(float r) {
  return r < .17 ? vec3(.62, .6, .55) : r < .33 ? vec3(.55, .46, .35) : r < .5 ? vec3(.4, .48, .53) : r < .66 ? vec3(.46, .5, .4) : r < .83 ? vec3(.42, .41, .4) : vec3(.52, .33, .25);
}
vec3 floorFinish(float r) { return r < .35 ? vec3(.3, .18, .1) : r < .6 ? vec3(.44, .42, .39) : r < .85 ? vec3(.16, .16, .18) : vec3(.36, .3, .25); }
/** The ray (p + rd t) against an axis-aligned box: entry distance, or -1. */
float boxHit(vec3 p, vec3 rd, vec3 b0, vec3 b1, out vec3 n) {
  vec3 t0 = (b0 - p) / rd, t1 = (b1 - p) / rd, tmin = min(t0, t1), tmax = max(t0, t1);
  float a = max(max(tmin.x, tmin.y), tmin.z), b = min(min(tmax.x, tmax.y), tmax.z);
  n = a == tmin.x ? vec3(-sign(rd.x), 0, 0) : a == tmin.y ? vec3(0, -sign(rd.y), 0) : vec3(0, 0, -sign(rd.z));
  return (b > max(a, 0.)) ? a : -1.;
}
vec3 windowRoom(out float glassRough) {
  vec3 Nw = normalize(vWinN), T = normalize(cross(vec3(0., 1., 0.), Nw)), V = normalize(vWinW - cameraPosition);
  vec3 rd = vec3(dot(V, T), V.y, -dot(V, Nw)); rd.z = max(rd.z, .02);
  rd = mix(rd, sign(rd + 1e-6) * 1e-4, step(abs(rd), vec3(1e-4)));
  float w = vWin.x, h = vWin.y, seed = vWin.z, kind = vWin.w;
  bool shop = abs(kind - 1.) < .5, tower = kind > 1.5;
  float r1 = wH(seed), r2 = wH(seed + 1.7), r3 = wH(seed + 3.1), r4 = wH(seed + 5.3), r5 = wH(seed + 7.9), r6 = wH(seed + 11.3);
  float depth = shop ? 5. + r2 * 2.5 : tower ? 6. + r2 * 4. : 3. + r2 * 2.4;
  float sill = shop ? .12 : tower ? .12 : .92, ceilY = shop ? max(h + .7, 3.1) - sill : tower ? h + .3 : 2.8 - sill;
  float side = shop ? .7 : tower ? .25 : max(.55, (3.4 - w) * .5);
  vec3 p = vec3(vWinUv.x * w, vWinUv.y * h, 0.);
  vec3 b0 = vec3(-side, -sill, 0.), b1 = vec3(w + side, ceilY, depth);
  vec3 tm = (mix(b0, b1, step(0., rd)) - p) / rd; float t = min(min(tm.x, tm.y), tm.z); vec3 q = p + rd * t;
  bool lit = shop ? r3 < uShopLit : r3 < uLitShare;
  vec3 lampCol = (r6 < .6 ? vec3(1., .82, .62) : vec3(.92, .97, 1.)) * uLamp * (lit ? 1. : 0.);
  vec3 paint = shop ? vec3(.7, .68, .64) : wallPaint(r1), fl = shop ? vec3(.5, .48, .45) : floorFinish(r2), ceil = vec3(.72, .71, .68);
  // What the ray reaches, and its albedo; the light there: daylight from the window (falling off with depth) and the
  // ceiling light (inverse square from the middle of the room).
  vec3 alb, n; vec2 fuv; float emit = 0.;
  if (t == tm.z) { alb = paint; n = vec3(0, 0, -1); fuv = q.xy; }
  else if (t == tm.x) { alb = paint * .92; n = vec3(-sign(rd.x), 0, 0); fuv = q.zy; }
  else if (rd.y < 0.) { alb = fl * (.85 + .3 * wN(q.xz * vec2(1.5, 6.))); n = vec3(0, 1, 0); fuv = q.xz; }
  else {
    alb = ceil; n = vec3(0, -1, 0); fuv = q.xz;
    // Light fittings: a panel grid (offices, shops) or one fitting in the middle (rooms).
    vec2 cell = shop || tower ? abs(fract(q.xz / vec2(1.8, 1.8)) - .5) : abs(q.xz - vec2(w * .5, depth * .45));
    float panel = shop || tower ? step(cell.x, .28) * step(cell.y, .1) : step(length(cell), .22);
    emit = panel * (lit ? 6. : .0);
  }
  // Furniture: a low piece in the room (sofa, desk, counter) and a tall cabinet against a side wall.
  vec3 fn; float lowW = 1.2 + r4 * 1., lowX = -side + .2 + r5 * max(.1, w + 2. * side - lowW - .4), lowZ = shop ? depth * .55 : depth * (.35 + .4 * r6);
  float tf = boxHit(p, rd, vec3(lowX, -sill, lowZ), vec3(lowX + lowW, -sill + (shop ? 1.0 : .48 + .32 * r1), lowZ + .75), fn);
  if (tf > 0. && tf < t) { t = tf; q = p + rd * t; n = fn; alb = shop ? vec3(.35, .3, .26) : vec3(.07, .06, .055) + vec3(.22, .16, .1) * r4; emit = 0.; fuv = q.xy; }
  if (r5 > .45 || shop) {
    float cx = r1 > .5 ? w + side - .5 : -side;
    tf = boxHit(p, rd, vec3(cx, -sill, depth * .25), vec3(cx + .5, -sill + (shop ? 2.1 : 1.9), depth * .25 + 1.3), fn);
    if (tf > 0. && tf < t) { t = tf; q = p + rd * t; n = fn; alb = vec3(.18, .13, .09) * (.6 + r2); emit = 0.; fuv = q.zy;
      if (shop) alb = mix(alb, vec3(wN(q.zy * 5.), wN(q.zy * 5. + 3.), wN(q.zy * 5. + 7.)) * .7, step(.5, fract(q.y * 2.2))); }
  }
  // Shops: stock on the walls in rows.
  if (shop && n.z == 0. && abs(n.y) < .5 && emit == 0.) alb = mix(alb, vec3(wN(fuv * 4.), wN(fuv * 4. + 5.), wN(fuv * 4. + 9.)) * .75, step(.45, fract(fuv.y * 2.1)) * step(.2, fuv.y + sill));
  if (tower && n.y > .5) alb *= .9 + .1 * step(.5, fract(q.x * .8));
  // Pictures on the back wall.
  if (!shop && n.z < -.5) { vec2 c = abs(fuv - vec2(w * (.3 + .4 * r6), 1.4 - sill)); if (c.x < .35 + .2 * r4 && c.y < .25 + .12 * r5) alb = vec3(.05) + vec3(.4, .3, .2) * r2; }
  float dayIn = uDaylight * (.25 + .75 * exp(-q.z * .5)) * (n.y > .5 ? 1.3 : n.y < -.5 ? .55 : 1.);
  vec3 lampAt = vec3(w * .5, ceilY - .1, depth * .45); float ld = length(q - lampAt);
  vec3 L = uDayTint * dayIn + lampCol * (1.4 / (1. + ld * ld * .35)) * (n.y < -.5 ? .35 : 1.);
  // Contact shadow in the room's corners.
  float edge = min(min(q.x + side, w + side - q.x), min(q.y + sill, ceilY - q.y)); edge = min(edge, depth - q.z);
  vec3 room = alb * L * (.55 + .45 * smoothstep(0., .45, edge)) + lampCol * emit;
  // Blinds (from the top) or curtains (from the sides), a few centimetres behind the glass.
  float cover = 0.; vec3 coverCol = vec3(0.);
  float blinds = r4 > .55 && !shop ? .1 + .75 * fract(r4 * 7.31) : 0.;
  if (!shop && vWinUv.y > 1. - blinds) { cover = .93; coverCol = vec3(.56, .54, .5) * (.75 + .25 * sin(vWinUv.y * h * 62.)); }
  else if (!shop && !tower && r5 > .6) { float cw = .12 + .22 * fract(r5 * 13.7); if (vWinUv.x < cw || vWinUv.x > 1. - cw) { cover = .88; coverCol = wallPaint(fract(r5 * 3.3)) * vec3(1.05, .85, .8) * (.72 + .28 * sin(vWinUv.x * w * 26.)); } }
  // A cover is lit from the street by day and glows with the room's light from behind at night.
  room = mix(room, coverCol * (uDayTint * uDaylight * 1.8 + lampCol * .55), cover);
  glassRough = .035 + .09 * smoothstep(.55, .95, wN(vWinUv * vec2(w, h) * 3.1 + seed));
  return room;
}
`;

/** The window material (one for the whole city). */
export function windowMaterial() {
  const m = new THREE.MeshStandardMaterial({ name: 'window', color: '#0a0b0c', roughness: .05, metalness: 0, envMapIntensity: 1 });
  m.userData.fixed = true;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, windowLight);
    shader.vertexShader = 'attribute vec4 aWin; flat varying vec4 vWin; varying vec2 vWinUv; varying vec3 vWinW; varying vec3 vWinN;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vWin = aWin; vWinUv = uv; vWinW = (modelMatrix * vec4(transformed, 1.)).xyz; vWinN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = ROOM + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nfloat glassRough; vec3 roomLight = windowRoom(glassRough); roughnessFactor = glassRough;')
      .replace('#include <opaque_fragment>', `{ float nv = clamp(dot(normal, normalize(vViewPosition)), 0., 1.), F = .04 + .96 * pow(1. - nv, 5.);
        outgoingLight += roomLight * (1. - F); }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'city-window';
  return m;
}

/** A pane quad facing +z in the coordinates of `M`, `w` × `h`, from (0,0): uv 0…1, and its window parameters. */
export function paneGeometry(w: number, h: number, seed: number, kind: number) {
  const g = new THREE.PlaneGeometry(w, h).translate(w / 2, h / 2, 0), n = g.attributes.position.count;
  // A small whole-number seed per window (see the shader's note on precision).
  const id = Math.floor(Math.abs(seed) * 7.31) % 4093, a = new Float32Array(n * 4); for (let i = 0; i < n; i++) a.set([w, h, id, kind], i * 4);
  g.setAttribute('aWin', new THREE.BufferAttribute(a, 4));
  return g;
}
/** Lighting of the rooms for a variant (daylight 0…1 night). */
export function setWindowLight(glow: number, overcast: boolean) {
  windowLight.uDaylight.value = overcast ? .1 : .22 * (1 - glow) + .004 * glow;
  windowLight.uLamp.value = 1 + glow * .6;
  windowLight.uLitShare.value = overcast ? .45 : .22 + glow * .4;
  windowLight.uShopLit.value = .92;
  windowLight.uDayTint.value.set(overcast ? '#d9e2ea' : glow > .7 ? '#7d8fb8' : '#fff4e6');
}
