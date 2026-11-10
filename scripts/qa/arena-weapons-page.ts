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

if (mode === 'fp') {
  const { weaponModel, preloadWeapon, preloadArms, FirstPersonArms } = await import('../../src/arena/scene/weapons');
  const id = params.get('id') ?? 'vanguard', pose = params.get('pose') ?? 'hip', team = Number(params.get('team') ?? 0);
  renderer.setSize(1280, 720);
  const scene = new THREE.Scene(); scene.environment = env; scene.background = hdr; scene.backgroundIntensity = .8; scene.environmentIntensity = .95;
  const sun = new THREE.DirectionalLight('#fff0d8', 3.2); sun.position.set(1.2, 2, .8); scene.add(sun, new THREE.HemisphereLight('#cdd9e8', '#5a5348', .5));
  const cam = new THREE.PerspectiveCamera(pose === 'ads' ? 42 : 56, 1280 / 720, .01, 50);
  await Promise.all([preloadWeapon(id), preloadArms()]);
  const gun = weaponModel(id, params.get('skin') ?? 'standard')!, holder = new THREE.Group(); holder.add(gun); scene.add(holder);
  const arms = new FirstPersonArms(await preloadArms(), team); scene.add(arms.root);
  const sightY = gun.userData.sightY as number, hold = gun.userData.hold as string;
  let x = hold === 'blade' ? .15 : hold === 'pistol' ? .085 : .1, y = hold === 'blade' ? -.17 : -sightY - (hold === 'pistol' ? .07 : .068), z = hold === 'blade' ? -.42 : hold === 'pistol' ? -.5 : -.4;
  let rx = hold === 'blade' ? .22 : 0, ry = hold === 'blade' ? .14 : .035, rz = hold === 'blade' ? -.25 : 0, toMag = 0;
  if (pose === 'ads') { x = 0; y = -sightY; z = gun.userData.adsZ; ry = 0; rz = 0; const r = gun.getObjectByName('reticle'); if (r) r.visible = true; }
  if (pose === 'sprint') { x -= .05; y -= .03; z += .05; rx -= .32; ry += .8; rz += .32; }
  if (pose === 'reload') { rx += .22; rz -= .42; ry += .12; y -= .035; x -= .02; toMag = 1; const mag = gun.getObjectByName('mag'); if (mag) mag.position.y -= .12; }
  holder.position.set(x, y, z); holder.rotation.set(rx, ry, rz); holder.updateMatrixWorld(true);
  const r = gun.getObjectByName('gripR')!.getWorldPosition(new THREE.Vector3()), l = gun.getObjectByName('gripL')!.getWorldPosition(new THREE.Vector3());
  if (toMag) { const well = gun.getObjectByName('mag') ?? gun.getObjectByName('magwell')!; well.getWorldPosition(l); if (gun.getObjectByName('mag')) l.y -= .07; }
  if (pose === 'bind') { holder.visible = false; cam.position.set(0, .45, -1.4); cam.lookAt(0, -.35, -.45); }
  else arms.pose(hold as 'rifle', r, l, holder.quaternion, toMag);
  renderer.render(scene, cam);
  document.title = 'done';
}
