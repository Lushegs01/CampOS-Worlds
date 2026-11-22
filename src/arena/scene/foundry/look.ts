// Foundry Yard "night shift": the industrial look for the Foundry map only (Sim Quad and Operation: Metropolis keep
// their own lighting). Everything here is presentation: the map's boxes, collision, movement and rules are untouched.
//
// The palette is a deliberately high-contrast dual tone: a deep cool slate fill and exponential haze, broken by
// overhead practicals that alternate emerald green and warm industrial amber, over wet concrete that mirrors them.
import * as THREE from 'three';
import { QA_HOOKS } from '../../../qa';

export interface FoundryLook {
  /** Practical light colours (alternating per fixture / floodlight). */
  emerald: THREE.Color; amber: THREE.Color;
  /** Hemisphere fill (sky / ground) and its intensity: low, so the practicals carry the scene. */
  fillSky: THREE.Color; fillGround: THREE.Color; fill: number;
  /** The moon: the existing shadow-casting directional light, retinted and dimmed. */
  moonColor: THREE.Color; moon: number; moonDir: THREE.Vector3;
  /** Exponential distance haze. */
  fogColor: THREE.Color; fogDensity: number;
  /** Image-based light strength on the world and on the first-person weapon. */
  env: number; weaponEnv: number;
  /** ACES exposure (renderer) and bloom (post stack). */
  exposure: number; bloomThreshold: number; bloomIntensity: number; bloomRadius: number;
  /** Fixture emission (HDR, before tone mapping) and the point/spot light intensities (candela). */
  glow: number; practical: number; practicalRange: number; flood: number;
  /** How lit smoke and dust read (0 dark … 1 daylight). */
  ambient: number;
  /** Wet floor: the share of ground under standing water, and the damp concrete roughness range. */
  puddles: number; dampRough: [number, number]; puddleRough: [number, number];
  /** Volumetric cones and dust. */
  cone: number; dust: number;
}

export const FOUNDRY_LOOK: FoundryLook = {
  emerald: new THREE.Color('#1aff8c'), amber: new THREE.Color('#ff6a1a'),
  fillSky: new THREE.Color('#131c21'), fillGround: new THREE.Color('#07090b'), fill: 4,
  moonColor: new THREE.Color('#9fb4c8'), moon: .55, moonDir: new THREE.Vector3(-.42, .78, .46).normalize(),
  fogColor: new THREE.Color('#0b1215'), fogDensity: .018,
  env: .4, weaponEnv: 1.1,
  exposure: 1.12, bloomThreshold: .85, bloomIntensity: .35, bloomRadius: .6,
  glow: 9, practical: 60, practicalRange: 18, flood: 2600,
  ambient: .22,
  puddles: .38, dampRough: [.72, .85], puddleRough: [.06, .12],
  cone: .1, dust: .9,
};

/**
 * The look for a map, or null for maps that keep their daylight look. QA builds: `?foundry-look=day` turns it off,
 * for before/after captures of the same views.
 */
export function foundryLook(mapId: string): FoundryLook | null {
  if (mapId !== 'foundry') return null;
  if (QA_HOOKS && typeof location !== 'undefined' && new URLSearchParams(location.search).get('foundry-look') === 'day') return null;
  return FOUNDRY_LOOK;
}

/** Which colour a fixture at this position takes: 0 emerald, 1 amber. Deterministic, so bays alternate the same way
 *  for the glowing fitting, its light, its cone and its dust. */
export const fixtureTone = (p: { x: number; z: number }) => (Math.round(p.x / 3.2) + Math.round(p.z / 6.4)) & 1;
/**
 * The light colour of a tone, at a common luminance. #1aff8c is ~2.3× as luminous as #ff6a1a, so at equal intensity
 * emerald swamps amber; normalising keeps each hue and gives the two tones equal weight in the frame.
 */
const toned = new WeakMap<FoundryLook, [THREE.Color, THREE.Color]>();
export function toneColor(look: FoundryLook, tone: number) {
  let pair = toned.get(look);
  if (!pair) {
    const norm = (c: THREE.Color) => c.clone().multiplyScalar(.32 / (c.r * .2126 + c.g * .7152 + c.b * .0722));
    toned.set(look, pair = [norm(look.emerald), norm(look.amber)]);
  }
  return pair[tone ? 1 : 0];
}
