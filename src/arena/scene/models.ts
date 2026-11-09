// Original, procedural Combat Arena models: one silhouette per weapon class (built from a handful of
// boxes and cylinders, finished in the player's earned weapon finish) and the simulation mannequin
// every player appears as. Few triangles, shared geometry, no downloads.
import * as THREE from 'three';
import { WEAPON_BY_ID, SKIN_BY_ID } from '../../../shared/arena/weapons.mjs';
import { softTexture } from './world';

const boxGeo = new THREE.BoxGeometry(1, 1, 1), cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
cylGeo.rotateX(Math.PI / 2);
const matCache = new Map<string, THREE.Material>();
export function mat(color: string, opts: { metal?: number; rough?: number; emissive?: string; basic?: boolean } = {}) {
  const key = `${color}|${opts.metal ?? 0}|${opts.rough ?? .6}|${opts.emissive ?? ''}|${opts.basic ?? false}`;
  let m = matCache.get(key);
  if (!m) { m = opts.basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, metalness: opts.metal ?? 0, roughness: opts.rough ?? .6, emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.emissive ? 1 : 0 }); matCache.set(key, m); }
  return m;
}
function part(g: THREE.Object3D, m: THREE.Material, [w, h, d]: number[], [x, y, z]: number[], cyl = false, rx = 0) {
  const mesh = new THREE.Mesh(cyl ? cylGeo : boxGeo, m);
  mesh.scale.set(w, h, d); mesh.position.set(x, y, z); mesh.rotation.x = rx; g.add(mesh);
  return mesh;
}

/**
 * A first-person weapon. Forward is −z, the sight line runs along y = 0.07. Named children: `mag`
 * (moves during reloads), `muzzle` (barrel tip), `flash` (muzzle flash sprite).
 */
export function weaponModel(id: string, skin = 'standard') {
  const w = WEAPON_BY_ID.get(id), g = new THREE.Group();
  const [base, dark] = SKIN_BY_ID.get(skin)?.colors ?? ['#4d545c', '#2c3136'];
  const body = mat(base, { metal: .25, rough: .5 }), black = mat(dark, { metal: .2, rough: .6 }), grip = mat('#26292e', { rough: .8 }), glass = mat('#7fd0ff', { emissive: '#1d4a66', metal: .2, rough: .1 });
  let muzzleZ = -.5, mag: THREE.Object3D | null = null;
  switch (w?.category) {
    case 'ar':
      part(g, body, [.065, .09, .42], [0, 0, -.12]); part(g, black, [.024, .024, .3], [0, .015, -.47], true);
      part(g, black, [.055, .06, .2], [0, -.005, -.36]); mag = part(g, black, [.04, .15, .07], [0, -.11, -.12], false, .25);
      part(g, body, [.05, .08, .2], [0, -.02, .17]); part(g, grip, [.035, .1, .05], [0, -.09, .02], false, -.3);
      part(g, black, [.03, .035, .09], [0, .065, -.08]); part(g, glass, [.022, .022, .01], [0, .07, -.03]);
      if (id === 'halcyon') { part(g, black, [.07, .04, .12], [0, .07, -.2]); muzzleZ = -.6; } else muzzleZ = -.62;
      break;
    case 'smg':
      part(g, body, [.06, .085, .3], [0, 0, -.08]); part(g, black, [.022, .022, .14], [0, .01, -.29], true);
      mag = part(g, black, [.035, .2, .05], [0, -.13, -.05]); part(g, black, [.02, .02, .2], [0, -.01, .16]);
      part(g, grip, [.035, .1, .045], [0, -.09, .05], false, -.25); part(g, black, [.025, .03, .07], [0, .06, -.05]);
      muzzleZ = -.36; break;
    case 'shotgun':
      part(g, body, [.07, .09, .3], [0, 0, -.02]); part(g, black, [.03, .03, .52], [0, .02, -.4], true);
      mag = part(g, grip, [.05, .05, .2], [0, -.04, -.33]); part(g, mat('#6b4a2e', { rough: .7 }), [.055, .1, .26], [0, -.03, .24]);
      part(g, grip, [.035, .09, .045], [0, -.08, .07], false, -.3); muzzleZ = -.66; break;
    case 'sniper':
      part(g, body, [.065, .085, .4], [0, 0, -.05]); part(g, black, [.022, .022, .5], [0, .015, -.5], true);
      part(g, black, [.034, .034, .3], [0, .085, -.06], true); part(g, glass, [.03, .03, .01], [0, .085, .1], true);
      mag = part(g, black, [.04, .07, .08], [0, -.07, -.04]); part(g, mat('#5d4330', { rough: .7 }), [.06, .11, .3], [0, -.02, .27]);
      part(g, black, [.015, .015, .06], [.045, .02, .05], true); muzzleZ = -.76; break;
    case 'lmg':
      part(g, body, [.09, .11, .46], [0, 0, -.1]); part(g, black, [.03, .03, .34], [0, .01, -.5], true);
      mag = part(g, black, [.12, .12, .12], [.03, -.11, -.12]); part(g, body, [.06, .1, .22], [0, -.02, .22]);
      part(g, black, [.02, .06, .14], [0, .09, -.12]); part(g, grip, [.04, .1, .05], [0, -.1, .04], false, -.3);
      part(g, black, [.012, .16, .012], [.03, -.08, -.55], false, .4); part(g, black, [.012, .16, .012], [-.03, -.08, -.55], false, .4);
      muzzleZ = -.68; break;
    case 'pistol':
      part(g, body, [.04, .05, .2], [0, .02, -.08]); part(g, grip, [.035, .11, .05], [0, -.05, .0], false, -.2);
      mag = part(g, black, [.03, .04, .04], [0, -.1, .01]); part(g, black, [.012, .012, .03], [0, .05, -.17]);
      if (id === 'thorn') { part(g, black, [.026, .026, .14], [0, .03, -.22], true); part(g, body, [.05, .05, .05], [0, .01, -.07], true); muzzleZ = -.3; } else muzzleZ = -.19;
      break;
    case 'melee':
      if (id === 'hammer') { part(g, mat('#5c4632', { rough: .8 }), [.03, .03, .5], [0, 0, -.1], true); part(g, body, [.08, .08, .16], [0, 0, -.35], false); part(g, black, [.08, .02, .02], [0, .05, -.35]); }
      else { part(g, grip, [.03, .03, .12], [0, 0, .02], true); part(g, black, [.05, .02, .02], [0, 0, -.05]); part(g, mat('#c9ced3', { metal: .9, rough: .25 }), [.008, .035, .2], [0, .005, -.16]); }
      muzzleZ = -.3; break;
  }
  if (mag) mag.name = 'mag';
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, .015, muzzleZ); g.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: '#ffcf7a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.name = 'flash'; flash.scale.setScalar(.22); flash.visible = false; muzzle.add(flash);
  return g;
}

/** First-person arms: sleeves in the team colour. */
export function armsModel(sleeve: string) {
  const g = new THREE.Group(), cloth = mat(sleeve, { rough: .85 }), glove = mat('#2b2e33', { rough: .9 });
  part(g, cloth, [.06, .06, .26], [.05, -.11, .16], false, .2); part(g, glove, [.05, .05, .07], [.02, -.08, .02]);
  part(g, cloth, [.06, .06, .3], [-.1, -.12, -.1], false, .35).rotation.y = -.55; part(g, glove, [.05, .05, .07], [-.02, -.05, -.3]);
  return g;
}

/**
 * The simulation mannequin (a training-suit figure in the team colour). Pivots: `legL`/`legR` at
 * the hips, `upper` (torso, head, arms and gun) leaning with the view pitch. 1.8 m tall standing.
 */
export function mannequin() {
  const root = new THREE.Group(), body = new THREE.Group(); body.name = 'body'; root.add(body);
  const suit = new THREE.MeshStandardMaterial({ color: '#30353c', roughness: .75 }), accent = new THREE.MeshStandardMaterial({ color: '#ff5a48', emissive: '#ff5a48', emissiveIntensity: .7, roughness: .5 });
  const visor = new THREE.MeshStandardMaterial({ color: '#0d1116', emissive: '#ff5a48', emissiveIntensity: .35, roughness: .2, metalness: .4 });
  const legL = new THREE.Group(), legR = new THREE.Group(); legL.name = 'legL'; legR.name = 'legR';
  legL.position.set(-.1, .88, 0); legR.position.set(.1, .88, 0); body.add(legL, legR);
  part(legL, suit, [.15, .86, .17], [0, -.43, 0]); part(legR, suit, [.15, .86, .17], [0, -.43, 0]);
  part(legL, accent, [.155, .05, .175], [0, -.5, 0]); part(legR, accent, [.155, .05, .175], [0, -.5, 0]);
  const upper = new THREE.Group(); upper.name = 'upper'; upper.position.set(0, .9, 0); body.add(upper);
  part(upper, suit, [.42, .55, .24], [0, .27, 0]); part(upper, accent, [.43, .06, .25], [0, .42, 0]);
  const head = part(upper, suit, [.24, .26, .26], [0, .68, 0]); head.name = 'head';
  part(upper, visor, [.2, .08, .02], [0, .7, -.13]);
  part(upper, suit, [.1, .1, .42], [.2, .38, -.18], false, .1); part(upper, suit, [.1, .1, .4], [-.18, .36, -.22], false, .2);
  const gun = new THREE.Group(); gun.name = 'gun'; gun.position.set(.06, .4, -.42); upper.add(gun);
  part(gun, mat('#1f2328', { metal: .4, rough: .5 }), [.06, .1, .55], [0, 0, 0]);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: '#ffd28a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.name = 'flash'; flash.position.set(0, .02, -.36); flash.scale.setScalar(.45); flash.visible = false; gun.add(flash);
  root.userData = { accent, visor, legL, legR, upper, body, flash };
  return root;
}
