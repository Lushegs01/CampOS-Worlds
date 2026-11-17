import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../src/graphics/compatibility.ts', import.meta.url), 'utf8')).replace("'three'", JSON.stringify(import.meta.resolve('three')));
const { installCompatibilityMaterials } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })).toString('base64'));

test('compatibility uses cached Lambert materials for compile and draw, then restores shared source materials', () => {
  const scene = new THREE.Scene(), map = new THREE.Texture();
  const original = new THREE.MeshPhysicalMaterial({ map, color: '#fab123', alphaTest: .4, transparent: true, opacity: .6, side: THREE.DoubleSide });
  original.onBeforeCompile = () => { throw Error('complex shader must not run in recovery'); };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [original, original]); scene.add(mesh);
  const draws = [], renderer = {
    render() { draws.push([...mesh.material]); },
    compile() { return new Set(mesh.material); },
  };
  const dispose = installCompatibilityMaterials(renderer);
  const compiled = [...renderer.compile(scene, new THREE.Camera())];
  assert.equal(compiled.length, 1);
  const simple = compiled[0];
  assert.equal(simple.isMeshLambertMaterial, true);
  assert.equal(simple.map, map); assert.equal(simple.alphaTest, .4);
  assert.equal(simple.opacity, .6); assert.equal(simple.side, THREE.DoubleSide);
  assert.equal(simple.color.getHex(), original.color.getHex());
  assert.equal(mesh.material[0], original);
  renderer.render(scene, new THREE.Camera());
  assert.equal(draws[0][0], simple); assert.equal(draws[0][1], simple);
  assert.equal(mesh.material[0], original);
  original.opacity = .2; original.visible = false; original.color.set('#ff0000');
  renderer.render(scene, new THREE.Camera());
  assert.equal(simple.opacity, .2); assert.equal(simple.visible, false); assert.equal(simple.color.getHex(), 0xff0000);
  let disposed = 0; simple.addEventListener('dispose', () => disposed++);
  dispose(); dispose(); assert.equal(disposed, 1);
});
test('draw failures restore source materials for later owners and disposal', () => {
  const scene = new THREE.Scene(), original = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original); scene.add(mesh);
  const renderer = { render() { throw Error('driver draw failure'); }, compile() { throw Error('driver compile failure'); } };
  const dispose = installCompatibilityMaterials(renderer);
  assert.throws(() => renderer.render(scene, new THREE.Camera()), /driver draw failure/);
  assert.equal(mesh.material, original);
  assert.throws(() => renderer.compile(scene, new THREE.Camera()), /driver compile failure/);
  assert.equal(mesh.material, original); dispose();
});
