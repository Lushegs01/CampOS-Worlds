// Analyses transition clips: facing change (from the hip axis), root travel and the active window.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const parse = (file) => new Promise((res, rej) => { const b = fs.readFileSync(file); loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej); });
const out = {};
for (const g of ['m', 'f']) {
  const anim = await parse(`public/assets/characters/anim-${g}.glb`);
  const rig = anim.scene, mixer = new THREE.AnimationMixer(rig), L = rig.getObjectByName('Bip01_L_Thigh'), R = rig.getObjectByName('Bip01_R_Thigh'), root = rig.getObjectByName('Bip01');
  const pose = (clip, t) => { mixer.stopAllAction(); const a = mixer.clipAction(clip).play(); a.time = t; mixer.update(0); rig.updateMatrixWorld(true);
    const l = L.getWorldPosition(new THREE.Vector3()), r = R.getWorldPosition(new THREE.Vector3()), p = root.getWorldPosition(new THREE.Vector3());
    const right = r.sub(l); const yaw = Math.atan2(-right.z, right.x); /* facing = up × right */ return { p, yaw }; };
  out[g] = {};
  for (const name of ['sitDown', 'standUp', 'sitDownTable', 'standUpTable', 'sitIdle', 'sitTable', 'idle']) {
    const clip = anim.animations.find(c => c.name === name); const N = 60, samples = [];
    for (let i = 0; i <= N; i++) samples.push(pose(clip, clip.duration * i / N));
    const moves = samples.map((s, i) => i ? s.p.distanceTo(samples[i - 1].p) + Math.abs(s.yaw - samples[i - 1].yaw) * .3 : 0);
    const active = moves.map(m => m > .004); const first = active.indexOf(true), last = active.lastIndexOf(true);
    const s0 = samples[0], s1 = samples[N];
    out[g][name] = { duration: +clip.duration.toFixed(2), active: [+(clip.duration * Math.max(0, first - 1) / N).toFixed(2), +(clip.duration * Math.min(N, last + 1) / N).toFixed(2)],
      startYaw: +s0.yaw.toFixed(3), endYaw: +s1.yaw.toFixed(3), start: s0.p.toArray().map(v => +v.toFixed(3)), end: s1.p.toArray().map(v => +v.toFixed(3)) };
  }
}
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync('.asset-cache/clip-analysis.json', JSON.stringify(out, null, 1));
