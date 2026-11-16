// QA page behind scripts/qa/arena-weapons.mjs (served by the Vite dev server, never bundled).
//   ?mode=sheet&ids=a,b   orthographic side and top views on a 5 cm grid, for placing grips and sights
//   ?mode=fp&id=a&pose=…  the first-person viewmodel in a named pose under the arena's sky lighting
import * as THREE from 'three';
import { initLoaders, loadModel, loadHDR } from '../../src/world/assets';

const params = new URLSearchParams(location.search), mode = params.get('mode') ?? 'sheet';
const canvas = document.createElement('canvas'); document.body.style.margin = '0'; document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
initLoaders(renderer, 8);
const hdr = await loadHDR('sky/environment.hdr'); hdr.mapping = THREE.EquirectangularReflectionMapping;
const env = new THREE.PMREMGenerator(renderer).fromEquirectangular(hdr).texture;

if (mode === 'sheet') {
  const ids = (params.get('ids') ?? '').split(','), W = 1400, ROW = 520;
  renderer.setSize(W, ROW * ids.length); renderer.setScissorTest(true);
  const label = (text: string, size = .012) => { const c = document.createElement('canvas'); c.width = 128; c.height = 48; const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.font = '34px sans-serif'; g.textAlign = 'center'; g.fillText(text, 64, 36); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false })); s.scale.set(size * 2.67, size, 1); s.renderOrder = 10; return s; };
  for (const [row, id] of ids.entries()) {
    const g = await loadModel(`arena/weapons/${id}.glb`), scene = new THREE.Scene(); scene.environment = env; scene.background = new THREE.Color('#30353b');
    scene.add(g.scene, new THREE.DirectionalLight('#fff', 2.5));
    const box = new THREE.Box3().setFromObject(g.scene), len = box.max.z, lo = Math.floor(box.min.y * 20) / 20 - .05, hi = Math.ceil(box.max.y * 20) / 20 + .05;
    const grid: number[] = [], bold: number[] = [];
    for (let z = 0; z <= len + .05; z += .05) (Math.round(z * 100) % 10 ? grid : bold).push(-1, lo, z, -1, hi, z);
    for (let y = lo; y <= hi + 1e-6; y += .05) (Math.abs(Math.round(y * 100)) % 10 ? grid : bold).push(-1, y, 0, -1, y, len + .05);
    const lines = (pts: number[], color: string) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: .6 })); };
    scene.add(lines(grid, '#5d6670'), lines(bold, '#aab4c0'), lines([-1, 0, -.05, -1, 0, len + .05], '#ff5a4a'));
    for (let z = 0; z <= len + .01; z += .1) { const s = label((z * 100).toFixed(0)); s.position.set(-1, lo + .012, z); scene.add(s); }
    for (let y = lo + .05; y <= hi; y += .05) { const s = label((y * 100).toFixed(0)); s.position.set(-1, y, -.03); scene.add(s); }
    const title = label(id, .03); title.position.set(-1, hi - .02, len * .5); scene.add(title);
    const span = len + .12, h = hi - lo, sideW = W * .78, y0 = ROW * (ids.length - 1 - row);
    // Side (from the weapon's left: muzzle at the left edge).
    const k = Math.max(span / sideW, h / ROW), side = new THREE.OrthographicCamera(-sideW * k / 2, sideW * k / 2, ROW * k / 2, -ROW * k / 2, .01, 10);
    side.position.set(-2, (lo + hi) / 2, len / 2 - .02); side.up.set(0, 1, 0); side.lookAt(0, (lo + hi) / 2, len / 2 - .02);
    renderer.setViewport(0, y0, sideW, ROW); renderer.setScissor(0, y0, sideW, ROW); renderer.render(scene, side);
    // Rear (looking down the bore from behind): x to the right.
    const rw = W - sideW, kr = Math.max(.3 / rw, h / ROW), rear = new THREE.OrthographicCamera(-rw * kr / 2, rw * kr / 2, ROW * kr / 2, -ROW * kr / 2, .01, 10);
    rear.position.set(0, (lo + hi) / 2, 3); rear.lookAt(0, (lo + hi) / 2, 0);
    const rg: number[] = []; for (let x = -.1; x <= .101; x += .05) rg.push(x, lo, 2, x, hi, 2);
    scene.add(lines(rg, '#aab4c0'));
    renderer.setViewport(sideW, y0, rw, ROW); renderer.setScissor(sideW, y0, rw, ROW); renderer.render(scene, rear);
  }
  document.title = 'done';
}

if (mode === 'fp' || mode === 'seq') {
  // The match's own animator and muzzle effects, driven through scripted scenarios on a 60 Hz simulated clock.
  //   ?mode=fp&id=…&pose=hip|ads|reload|reloadEmpty|sprint|fire   one still (the scenario at a representative moment)
  //   ?mode=seq&id=…&seq=…&fps=30   window.__frame(i) renders frame i (scripts/qa/arena-weapons.mjs seq → video)
  const { weaponModel, preloadWeapon, preloadArms, FirstPersonArms } = await import('../../src/arena/scene/weapons');
  const { ViewmodelAnimator } = await import('../../src/arena/scene/viewmodel');
  const { MuzzleFX } = await import('../../src/arena/scene/muzzle');
  const { WEAPON_BY_ID } = await import('../../shared/arena/weapons.mjs');
  const id = params.get('id') ?? 'vanguard', team = Number(params.get('team') ?? 0), W = 1280, H = 720;
  renderer.setSize(W, H);
  const scene = new THREE.Scene(); scene.environment = env; scene.background = hdr; scene.backgroundIntensity = .8; scene.environmentIntensity = .95;
  // ?bg=dim: an overcast/indoor backdrop (the flash, smoke and the hands' shading read as they do under cover).
  if (params.get('bg') === 'dim') { scene.backgroundIntensity = .12; scene.environmentIntensity = .35; }
  const sun = new THREE.DirectionalLight('#fff0d8', params.get('bg') === 'dim' ? .9 : 3.2); sun.position.set(1.2, 2, .8); scene.add(sun, new THREE.HemisphereLight('#cdd9e8', '#5a5348', .5));
  const cam = new THREE.PerspectiveCamera(50, W / H, .01, 50);
  await Promise.all([preloadWeapon(id), preloadArms()]);
  const gun = weaponModel(id, params.get('skin') ?? 'standard')!, holder = new THREE.Group(); holder.add(gun); scene.add(holder);
  const arms = new FirstPersonArms(await preloadArms(), team); scene.add(arms.root);
  const anim = new ViewmodelAnimator(), fx = new MuzzleFX(); scene.add(fx.group);
  (window as unknown as Record<string, unknown>).__fx = fx;
  fx.setAmbient(params.get('bg') === 'dim' ? .25 : 1);
  const w = WEAPON_BY_ID.get(id) as unknown as { id: string; category: string; fire: string; rpm?: number; reloadMode?: string; reload: number; reloadEmpty: number; swap: number; ads: number; mag: number; burst?: number };
  const weight = w.category === 'shotgun' || w.category === 'sniper' ? 1.5 : w.category === 'pistol' ? .7 : w.category === 'smg' ? .55 : w.id === 'm7' ? .25 : w.category === 'lmg' ? .9 : .8;
  const sim = { phase: 'ready', pt: 0, cool: 0, ads: 0, sprint: false, stance: 0, grounded: true, vx: 0, vy: 0, vz: 0, shots: 0 };
  let mag = w.mag, reloadTotal = 1, reloadEmpty = false, bob = 0, tick = 0;
  /** What the player is doing at time t (seconds) in each scenario. */
  type Want = { ads?: boolean; fire?: boolean; reload?: boolean; sprint?: boolean; walk?: boolean; empty?: boolean; melee?: boolean };
  const SCENARIOS: Record<string, { length: number; at: (t: number) => Want }> = {
    hip: { length: 2, at: () => ({}) },
    ads: { length: 3, at: t => ({ ads: t > .4 && t < 2.1 }) },
    fire: { length: 3.2, at: t => ({ ads: t > .2, fire: t > .6 && t < 1.8 }) },
    hipfire: { length: 2.6, at: t => ({ fire: t > .4 && t < 1.4 }) },
    reload: { length: (w.reload ?? 120) / 60 + 1, at: t => ({ reload: t > .3 && t < .4 }) },
    reloadEmpty: { length: (w.reloadEmpty ?? 150) / 60 + 1, at: t => ({ reload: t > .3 && t < .4, empty: true }) },
    sprint: { length: 2.4, at: t => ({ sprint: t > .2 && t < 2, walk: t > .2 }) },
    walk: { length: 2.4, at: () => ({ walk: true }) },
    melee: { length: 1.6, at: t => ({ melee: t > .3 && t < .35 }) },
  };
  // A still is the scenario at its telling moment.
  const STILL: Record<string, [string, number]> = { hip: ['hip', 1.5], ads: ['ads', 1.6], reload: ['reload', .3 + (w.reload ?? 120) / 60 * .25], reloadEmpty: ['reloadEmpty', .3 + (w.reloadEmpty ?? 150) / 60 * .5], sprint: ['sprint', 1.4], fire: ['fire', .64], walk: ['walk', 1.2], melee: ['melee', .3 + ((w as { swing?: number }).swing ?? 30) / 60 * .45] };
  const seqName = mode === 'fp' ? STILL[params.get('pose') ?? 'hip']?.[0] ?? 'hip' : params.get('seq') ?? 'fire';
  const sc = SCENARIOS[seqName] ?? SCENARIOS.hip;
  if (sc === SCENARIOS.reloadEmpty) mag = 0; else if (sc === SCENARIOS.reload) mag = Math.max(1, w.mag - 9);
  const stepTick = () => {
    const t = tick / 60, want = sc.at(t); tick++;
    if (want.reload && sim.phase === 'ready' && mag < w.mag) { sim.phase = 'reload'; reloadEmpty = !!want.empty || mag === 0; sim.pt = reloadTotal = reloadEmpty ? w.reloadEmpty : w.reload; sim.ads = 0; }
    if (want.melee && sim.phase === 'ready') { sim.phase = 'melee'; sim.pt = (w as { swing?: number }).swing ?? 30; }
    if (sim.phase === 'melee' && --sim.pt <= 0) { sim.phase = 'ready'; sim.pt = 0; }
    if (sim.phase === 'reload' && --sim.pt <= 0) { sim.phase = 'ready'; sim.pt = 0; mag = w.mag; }
    sim.sprint = !!want.sprint;
    if (want.ads && !sim.sprint && sim.phase === 'ready') sim.ads = Math.min(1, sim.ads + 1 / Math.max(1, w.ads)); else sim.ads = Math.max(0, sim.ads - 1.25 / Math.max(1, w.ads));
    const speed = want.sprint ? 6.4 : want.walk ? 4 : 0; sim.vz = -speed;
    if (speed) bob += (1 / 60) * (want.sprint ? 11 : 7.5);
    if (sim.cool > 0) sim.cool--;
    if (want.fire && sim.phase === 'ready' && sim.cool <= 0 && mag > 0 && w.rpm) {
      sim.cool = Math.max(3600 / w.rpm, w.fire === 'auto' ? 0 : 14); mag--; sim.shots++;
      anim.shot(w, sim.ads); fx.fire(weight, sim.ads);
    }
    let dyaw = 0, dpitch = 0; if (want.walk) dyaw = Math.sin(t * 3) * .004;
    const out = anim.update({ dt: 1 / 60, sim, weapon: w, reloadTotal, reloadEmpty, mag, dyaw, dpitch, bob }, gun, holder);
    arms.pose(gun.userData.hold ?? 'rifle', out.handR, out.handL, holder.quaternion, out.reachL);
    const reticle = gun.getObjectByName('reticle'); if (reticle) reticle.visible = out.ads > .55 && sim.phase !== 'reload';
    fx.update(1 / 60, gun.getObjectByName('muzzle') ?? null, anim.barrelHeat, holder.quaternion);
    if (Math.abs(cam.fov - out.vfov) > .01) { cam.fov = out.vfov; cam.updateProjectionMatrix(); }
  };
  const fps = Number(params.get('fps') ?? 30);
  (window as unknown as Record<string, unknown>).__frame = (i: number) => { while (tick < Math.round(i / fps * 60)) stepTick(); renderer.render(scene, cam); return i / fps < sc.length; };
  (window as unknown as Record<string, unknown>).__frames = Math.ceil(sc.length * fps);
  if (mode === 'fp') { const at = STILL[params.get('pose') ?? 'hip']?.[1] ?? 1.5; while (tick < at * 60) stepTick(); renderer.render(scene, cam); }
  document.title = 'done';
}
