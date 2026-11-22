// Foundry night shift: the image-based light and the sky.
//
// IBL: a procedural industrial interior, baked once through PMREMGenerator.fromScene: a dark slate shell, long
// fluorescent strips overhead alternating emerald and amber, a cooler skylight band and a sodium-lit horizon. Wet
// concrete, brushed steel and the weapon's gunmetal then carry real coloured specular streaks instead of the
// daylight HDR's blue sky.
//
// Sky: a dark overcast dome over the yard, its horizon lit from below by the town's sodium glow, fading into the haze
// colour so the exponential fog meets it without a seam.
import * as THREE from 'three';
import { toneColor, type FoundryLook } from './look';

export function bakeIndustrialEnvironment(gl: THREE.WebGLRenderer, look: FoundryLook) {
  const scene = new THREE.Scene(), disposables: { dispose(): void }[] = [];
  const mat = (c: THREE.Color, k: number) => { const m = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), side: THREE.BackSide, fog: false, toneMapped: false }); disposables.push(m); return m; };
  const box = (w: number, h: number, d: number) => { const g = new THREE.BoxGeometry(w, h, d); disposables.push(g); return g; };
  const plane = (w: number, h: number) => { const g = new THREE.PlaneGeometry(w, h); disposables.push(g); return g; };
  // Shell: walls a cool slate, the floor near black, the ceiling a little lighter (light bounced up off the strips).
  const shell = new THREE.Mesh(box(60, 24, 60), [
    mat(new THREE.Color('#1a2428'), .5), mat(new THREE.Color('#1a2428'), .5),
    mat(new THREE.Color('#24302f'), .55), mat(new THREE.Color('#06080a'), .5),
    mat(new THREE.Color('#1a2428'), .5), mat(new THREE.Color('#1a2428'), .5),
  ]);
  scene.add(shell);
  // Overhead strips: two rows of long fixtures, alternating tone along the row.
  const strip = (x: number, z: number, c: THREE.Color, k: number, len = 9) => {
    const m = new THREE.Mesh(plane(len, .9), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false }));
    disposables.push(m.material as THREE.Material);
    m.rotation.x = Math.PI / 2; m.position.set(x, 11.5, z); scene.add(m);
  };
  for (let i = 0; i < 5; i++) for (const z of [-9, 9]) strip(-22 + i * 11, z, toneColor(look, i % 2), 26);
  // A softer, cooler skylight band down the middle (moonlit roof lights) and a sodium horizon glow on two walls.
  strip(0, 0, new THREE.Color('#8fb0c8'), 3.5, 40);
  const glow = (x: number, z: number, ry: number, c: THREE.Color, k: number) => {
    const m = new THREE.Mesh(plane(50, 5), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false }));
    disposables.push(m.material as THREE.Material);
    m.position.set(x, -4, z); m.rotation.y = ry; scene.add(m);
  };
  glow(0, -29.5, 0, new THREE.Color('#ff8a3c'), 2.2); glow(29.5, 0, Math.PI / 2, new THREE.Color('#3cffa0'), 1.1);
  glow(-29.5, 0, Math.PI / 2, new THREE.Color('#ffb070'), 1.2);
  const pmrem = new THREE.PMREMGenerator(gl);
  const target = pmrem.fromScene(scene, .035, .1, 100);
  pmrem.dispose(); disposables.forEach(d => d.dispose());
  return target;
}

/** The night dome: zenith near black, a low overcast with faint structure, the horizon lit warm from below. */
export function nightSky(look: FoundryLook) {
  const fog = look.fogColor;
  const material = new THREE.ShaderMaterial({
    uniforms: { uHorizon: { value: new THREE.Vector3(fog.r, fog.g, fog.b) }, uGlow: { value: new THREE.Vector3(.42, .2, .08) }, uGreen: { value: new THREE.Vector3(.03, .12, .07) }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uHorizon, uGlow, uGreen; uniform float uTime; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0., k = .5; for (int i = 0; i < 5; i++) { a += k * n(p); p *= 2.03; k *= .5; } return a; }
      void main(){
        vec3 d = normalize(vDir); float up = max(d.y, 0.);
        vec3 zenith = vec3(.006, .009, .012);
        vec3 sky = mix(uHorizon * 1.1, zenith, pow(up, .45));
        // Low overcast: cloud bellies lit from below by the yard, drifting slowly.
        vec2 cp = d.xz / max(d.y + .08, .05) * .35 + vec2(uTime * .004, 0.);
        float cloud = smoothstep(.35, .85, fbm(cp));
        sky += cloud * (uGlow * .22 + uGreen * .3) * (1. - pow(up, .6));
        // Sodium glow along the horizon (strongest to the south), a faint green spill opposite.
        float band = exp(-abs(d.y) * 9.);
        sky += band * (uGlow * (.55 + .45 * max(-d.z, 0.)) + uGreen * max(d.x, 0.));
        gl_FragColor = vec4(sky, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), material);
  mesh.scale.setScalar(900); mesh.renderOrder = -1000; mesh.frustumCulled = false; mesh.name = 'sky';
  return mesh;
}
