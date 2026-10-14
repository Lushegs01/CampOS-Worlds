import * as THREE from 'three';
import { loadTexture } from './assets';

// One coherent PBR library for the whole campus. Geometry carries UVs in metres, so `tile`
// is simply "metres per texture repeat". Surface sets are CC0 scans from Poly Haven.
type Surface = 'grass' | 'grass2' | 'laterite' | 'pavers' | 'paversGrey' | 'hexPaving' | 'stucco' | 'plaster' | 'concrete' | 'ribbed' | 'brushed' | 'brick' | 'roof' | 'terrazzo' | 'granite' | 'palmBark' | 'asphalt' | 'track' | 'wood' | 'bark';
export const SURFACES: Surface[] = ['grass', 'grass2', 'laterite', 'pavers', 'paversGrey', 'hexPaving', 'stucco', 'plaster', 'concrete', 'ribbed', 'brushed', 'brick', 'roof', 'terrazzo', 'granite', 'palmBark', 'asphalt', 'track', 'wood', 'bark'];
export interface SurfaceSet { color: THREE.Texture; normal: THREE.Texture | null; arm: THREE.Texture | null }
export type SurfaceSets = Record<Surface, SurfaceSet>;

export function loadSurfaces(detail = true): Promise<SurfaceSets> {
  return Promise.all(SURFACES.map(async key => {
    // Mobile fetches only albedo: skip 40 normal/ARM downloads, transcodes and GPU uploads.
    const [color, normal, arm] = await Promise.all(['color', 'normal', 'arm'].map(slot => slot === 'color' || detail ? loadTexture(`textures/${key}/${slot}.ktx2`) : Promise.resolve(null)));
    return [key, { color: color!, normal, arm }] as const;
  })).then(entries => Object.fromEntries(entries) as SurfaceSets);
}

// GLSL value noise shared by the weathering, ground and water shaders.
export const NOISE_GLSL = /* glsl */`
float cHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float cNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(cHash(i),cHash(i+vec2(1,0)),f.x),mix(cHash(i+vec2(0,1)),cHash(i+vec2(1,1)),f.x),f.y);}
float cFbm(vec2 p){return cNoise(p)*.5+cNoise(p*2.03+7.1)*.3+cNoise(p*4.11+3.7)*.2;}
`;

const WORLD_POS_VERTEX = /* glsl */`
#include <worldpos_vertex>
vec4 cWorld=vec4(transformed,1.);
#ifdef USE_INSTANCING
cWorld=instanceMatrix*cWorld;
#endif
vWorldPos=(modelMatrix*cWorld).xyz;`;

export interface Weathering { grime?: number; grimeHeight?: number; streaks?: number; macro?: number; base?: number }

/** Adds ground splash grime, faint vertical streaking and macro colour variation in world space. */
export function weather(material: THREE.MeshStandardMaterial, w: Weathering = {}) {
  const uniforms = { uGrime: { value: w.grime ?? .55 }, uGrimeHeight: { value: w.grimeHeight ?? .9 }, uStreaks: { value: w.streaks ?? .35 }, uMacro: { value: w.macro ?? .12 }, uBase: { value: w.base ?? 0 } };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vWorldPos;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', WORLD_POS_VERTEX);
    shader.fragmentShader = `varying vec3 vWorldPos;uniform float uGrime,uGrimeHeight,uStreaks,uMacro,uBase;\n${NOISE_GLSL}` + shader.fragmentShader.replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
      {
        float h=vWorldPos.y-uBase, blot=cFbm(vWorldPos.xz*.21+vWorldPos.y*.13);
        float splash=(1.-smoothstep(0.,uGrimeHeight,h))*uGrime*(.55+.7*blot);
        float column=cNoise(vec2(dot(vWorldPos.xz,vec2(.71,.71))*2.7,7.));
        float streak=uStreaks*smoothstep(.62,.95,column)*smoothstep(0.,2.5,h)*(.5+.5*cNoise(vec2(column*9.,h*.35)));
        float dirt=clamp(splash+streak*.45,0.,.75);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.58,.52,.45),dirt);
        diffuseColor.rgb*=1.+(blot-.5)*uMacro;
      }`);
  };
  material.customProgramCacheKey = () => 'weather';
  return material;
}

function set(s: SurfaceSet, tile: number, rotation = 0) {
  const r = 1 / tile;
  const clone = (t: THREE.Texture | null) => { if (!t) return null; const c = t.clone(); c.repeat.set(r, r); c.rotation = rotation; c.needsUpdate = true; return c; };
  return { map: clone(s.color), normalMap: clone(s.normal), roughnessMap: clone(s.arm), metalnessMap: clone(s.arm), aoMap: clone(s.arm) };
}

export function std(params: THREE.MeshStandardMaterialParameters & { name: string }) { return new THREE.MeshStandardMaterial(params); }

function breezeAlpha() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#000'; x.beginPath(); x.arc(64, 64, 42, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.5, 2.5); t.anisotropy = 4; return t;
}

export function createMaterials(s: SurfaceSets, detail = true) {
  const pbr = (name: string, key: Surface, tile: number, extra: THREE.MeshStandardMaterialParameters = {}, w?: Weathering | false) => {
    const m = new THREE.MeshStandardMaterial({ name, ...set(s[key], tile), metalness: detail ? 1 : 0, roughness: detail ? 1 : .86, aoMapIntensity: .8, ...extra });
    return !detail || w === false ? m : weather(m, w);
  };
  const paint = (name: string, color: string, roughness = .55, metalness = 0) => new THREE.MeshStandardMaterial({ name, color, roughness, metalness });
  const lib = {
    // Walls and structure.
    stucco: pbr('stucco', 'stucco', 3.2, { color: '#f4eee2', normalScale: new THREE.Vector2(.7, .7) }),
    stuccoCream: pbr('stuccoCream', 'stucco', 3.2, { color: '#ecdcb9', normalScale: new THREE.Vector2(.7, .7) }),
    stuccoOchre: pbr('stuccoOchre', 'stucco', 3.2, { color: '#d9a35f', normalScale: new THREE.Vector2(.7, .7) }),
    stuccoGreen: pbr('stuccoGreen', 'stucco', 3.2, { color: '#7d9a86', normalScale: new THREE.Vector2(.7, .7) }),
    // Per-building tint comes from vertex colours (district palettes in the open world).
    stuccoTint: pbr('stuccoTint', 'stucco', 3.2, { color: '#ffffff', vertexColors: true, normalScale: new THREE.Vector2(.7, .7) }),
    plaster: pbr('plaster', 'plaster', 3, { color: '#e2dccf' }),
    concrete: pbr('concrete', 'concrete', 3, { color: '#d8d2c6' }, { grime: .5, streaks: .6 }),
    ribbed: pbr('ribbed', 'ribbed', 1.6, { color: '#d9d3c5' }, { grime: .4, streaks: .5 }),
    brushed: pbr('brushed', 'brushed', 2.2, { color: '#cfc9bd' }, { grime: .25, grimeHeight: .25, streaks: 0 }),
    brick: pbr('brick', 'brick', 1.8, { color: '#e8c0a6' }, { grime: .35, streaks: .2 }),
    granite: pbr('granite', 'granite', 1.2, { color: '#d6d0c8', envMapIntensity: 1.1 }, { grime: .15, grimeHeight: .2, streaks: 0 }),
    terrazzo: pbr('terrazzo', 'terrazzo', 2, { envMapIntensity: .8 }, false),
    roofRed: pbr('roofRed', 'roof', 2, { color: '#b9584a' }, { grime: 0, streaks: .25 }),
    roofGreen: pbr('roofGreen', 'roof', 2, { color: '#6e8f72' }, { grime: 0, streaks: .25 }),
    wood: pbr('wood', 'wood', 1.6, { color: '#c8a27c' }, false),
    // Ground surfaces.
    pavers: pbr('pavers', 'pavers', 2.4, { color: '#f1ddc8' }, false),
    paversGrey: pbr('paversGrey', 'paversGrey', 2.6, {}, false),
    hexPaving: pbr('hexPaving', 'hexPaving', 2.2, { color: '#efe7da' }, false),
    asphalt: pbr('asphalt', 'asphalt', 4, { color: '#b9b7b2' }, false),
    // Acrylic sports surfacing: smooth, flat colour with a slight sheen.
    courtBlue: paint('courtBlue', '#35648f', .62), courtGreen: paint('courtGreen', '#3f7356', .66), courtRed: paint('courtRed', '#b4573c', .62),
    // Vegetation bark.
    bark: pbr('bark', 'bark', 1.2, {}, false),
    palmBark: pbr('palmBark', 'palmBark', 1.4, { color: '#d8cdbd' }, false),
    // Paints, metals and glass.
    paintDark: paint('paintDark', '#24302b', .5), paintWhite: paint('paintWhite', '#ece8df', .45), paintGreen: paint('paintGreen', '#2f4f3f', .45),
    paintTerracotta: paint('paintTerracotta', '#a35a3f', .6), paintYellow: paint('paintYellow', '#e2b440', .5), lineWhite: paint('lineWhite', '#f2efe6', .6),
    aluminium: paint('aluminium', '#a8acae', .35, 1), bronzeFrame: paint('bronzeFrame', '#5a4636', .4, .8), steel: paint('steel', '#7c8285', .45, 1),
    darkMetal: paint('darkMetal', '#2b2f30', .4, .7), chrome: paint('chrome', '#d8dadb', .12, 1),
    glass: new THREE.MeshStandardMaterial({ name: 'glass', color: '#1b2a30', roughness: .04, metalness: 0, envMapIntensity: 1.6, vertexColors: true }),
    glassClear: new THREE.MeshStandardMaterial({ name: 'glassClear', color: '#9fb8bb', roughness: .03, metalness: 0, transparent: true, opacity: .22, depthWrite: false, envMapIntensity: 1.4 }),
    bronze: new THREE.MeshStandardMaterial({ name: 'bronze', color: '#b5874f', roughness: .32, metalness: 1, envMapIntensity: 1.2 }),
    rubber: paint('rubber', '#1e1f1f', .85), fabricShade: paint('fabricShade', '#f1ece0', .9), fabricTerracotta: paint('fabricTerracotta', '#b5583d', .85),
    emissiveWarm: new THREE.MeshStandardMaterial({ name: 'emissiveWarm', color: '#fff4dc', emissive: '#ffe2ad', emissiveIntensity: 1.4, roughness: .5 }),
    breezePanel: new THREE.MeshStandardMaterial({ name: 'breezePanel', ...set(s.stucco, 3.2), color: '#ecdcb9', alphaMap: breezeAlpha(), alphaTest: .5, side: THREE.DoubleSide, metalness: detail ? 1 : 0, roughness: 1 }),
    soil: paint('soil', '#5a3b2a', .95), mulch: paint('mulch', '#4a3426', .95), poolTile: paint('poolTile', '#3e7c84', .3),
  };
  return lib;
}
export type Materials = ReturnType<typeof createMaterials>;
export type MaterialKey = keyof Materials;
