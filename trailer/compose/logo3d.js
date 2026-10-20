// The CampOS mark in three dimensions: the game's own symbol (src/styles.css .brand-symbol: three gold
// bars 7 px wide, 3 px apart, 22 / 30 / 17 px tall, bottom-aligned, skewed -12°) extruded in gold, lit
// by the campus sky (public/assets/sky/environment.hdr) with a rim light. The bars rise like buildings,
// turn once, then settle into the header lockup beside the wordmark.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const clamp01 = x => Math.min(1, Math.max(0, x)), seg = (t, a, b) => clamp01((t - a) / (b - a)), mix = (a, b, k) => a + (b - a) * k;
const ease = { inOut: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2, outBack: x => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }, out: x => 1 - Math.pow(1 - x, 3) };
const BARS = [{ x: 0, h: 22 }, { x: 10, h: 30 }, { x: 20, h: 17 }], BAR_W = 7, DEPTH = 7, SKEW = Math.tan(12 * Math.PI / 180);

export async function createLogo({ width: W, height: H, brand, lockup }) {
  const canvas = document.getElementById('logo'); canvas.width = W; canvas.height = H;
  const raw = document.createElement('canvas'); raw.width = W; raw.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas: raw, alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = .95; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), FOV = 16, D = 400;
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 10, 2000); camera.position.set(0, 0, D);
  const hdr = await new HDRLoader().loadAsync('/public/assets/sky/environment.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromEquirectangular(hdr).texture; scene.environmentIntensity = .55;
  const key = new THREE.DirectionalLight(0xfff1d6, 1.6); key.position.set(-120, 160, 220); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe2a8, 4.2); rim.position.set(160, 60, -260); scene.add(rim);
  // Brushed gold: the brand gold, deep enough that sky reflections read as gold, not white.
  const material = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#d9a24c'), metalness: 1, roughness: .36, clearcoat: .2, clearcoatRoughness: .3 });

  // Bars in the symbol's own pixel units, centred on the symbol box (29 x 30), skewed like the CSS.
  const group = new THREE.Group(), bars = [];
  for (const b of BARS) {
    const geo = new RoundedBoxGeometry(BAR_W, b.h, DEPTH, 3, .9);
    geo.translate(0, b.h / 2, 0);
    const pivot = new THREE.Group(); pivot.position.set(b.x + BAR_W / 2 - 14.5, -15, 0);
    pivot.add(new THREE.Mesh(geo, material)); bars.push(pivot); group.add(pivot);
  }
  // skewY(-12deg) about the symbol's centre: y' = y + tan(12°)·x (screen up is +y here).
  group.matrixAutoUpdate = false;
  const skew = new THREE.Matrix4().set(1, 0, 0, 0, SKEW, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const holder = new THREE.Group(); holder.add(group); scene.add(holder);
  const perPixel = 2 * D * Math.tan(FOV * Math.PI / 360) / H;
  const toWorld = (px, py) => new THREE.Vector3((px - W / 2) * perPixel, (H / 2 - py) * perPixel, 0);

  const L = brand.logo, settle0 = brand.name - .15, settle1 = brand.name + .55;
  // Where the symbol ends: its place in the lockup (compose.js lays the lockup out).
  const target = { x: lockup.x, y: lockup.y, w: 29 * lockup.s, h: 30 * lockup.s, scale: lockup.s };
  const hero = { cx: W / 2, cy: H * (H > W ? .42 : .47), s: lockup.s * (H > W ? 3.0 : 2.5) };
  const glow = canvas.getContext('2d');

  function render(T) {
    const k = ease.inOut(seg(T, settle0, settle1));
    const cx = mix(hero.cx, target.x + target.w / 2, k), cy = mix(hero.cy, target.y + target.h / 2, k), s = mix(hero.s, target.scale, k);
    bars.forEach((p, i) => { const r = ease.outBack(seg(T, L + i * .07, L + .55 + i * .07)); p.scale.set(1, Math.max(.001, r), 1); });
    holder.position.copy(toWorld(cx, cy)); holder.scale.setScalar(s * perPixel);
    // One deliberate turn on the rise, settling almost square to camera in the lockup.
    const turn = mix(-.62, -.16, ease.out(seg(T, L, settle0))) * (1 - k) + -.1 * k;
    holder.rotation.set(mix(.1, .03, k), turn + Math.sin(T * .7) * .015, 0);
    group.matrix.copy(skew); group.matrixWorldNeedsUpdate = true;
    scene.environmentRotation.y = T * .35; // reflections drift across the faces: a slow light sweep
    renderer.render(scene, camera);
    // Restrained glow: a soft copy of the mark under itself.
    glow.clearRect(0, 0, W, H);
    glow.filter = `blur(${Math.round(22 * s / 3.5)}px)`; glow.globalAlpha = .38 * seg(T, L, L + .4); glow.drawImage(raw, 0, 0);
    glow.filter = 'none'; glow.globalAlpha = 1; glow.drawImage(raw, 0, 0);
  }
  return { canvas, render, symbolRect: () => target };
}
