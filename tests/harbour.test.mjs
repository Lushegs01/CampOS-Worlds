import assert from 'node:assert/strict';
import test from 'node:test';
import { stat } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { HARBOUR_BLOCKS, HARBOUR_BUILDINGS, HARBOUR_LOCATION, HARBOUR_TRAFFIC } from '../shared/harbour.mjs';
import { createFleet, vehicleBlocked } from '../shared/vehicles.mjs';
import { roadRoute } from '../shared/expansion.mjs';
import { LOCATIONS, blocked } from '../shared/campus.mjs';

test('Harbour Exchange connects to the existing road and map; the same parcels block movement',async()=>{
  assert.ok(LOCATIONS.includes(HARBOUR_LOCATION));
  const route=roadRoute({x:136,z:55.55},HARBOUR_LOCATION);
  assert.ok(Number.isFinite(route.distance)&&route.points.length>2);
  for(const b of HARBOUR_BUILDINGS){
    assert.ok(blocked(b.x,b.z));
    assert.ok(!blocked(b.x,b.z+b.front*(b.d/2+2)));
  }
  await MeshoptDecoder.ready;
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
  let total=0;
  for(const p of HARBOUR_BLOCKS){
    const file=new URL('../public/assets/harbour/'+p.id+'.glb',import.meta.url);
    const asset=await io.read(file.pathname),bounds=new Box3();
    assert.ok(asset.getRoot().listMeshes().length<18);
    for(const mesh of asset.getRoot().listMeshes()) for(const primitive of mesh.listPrimitives()){
      const positions=primitive.getAttribute('POSITION');
      assert.equal(positions.getCount(),primitive.getAttribute('TEXCOORD_0').getCount());
    }
    const node=asset.getRoot().listNodes().find(n=>n.getName().includes('paversGrey'));
    const position=node.getMesh().listPrimitives()[0].getAttribute('POSITION');
    const matrix=node.getWorldMatrix();
    for(let i=0;i<position.getCount();i++){
      const [x,y,z]=position.getElement(i,[]);
      bounds.expandByPoint(new Vector3(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],
        matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]));
    }
    assert.ok(Math.abs((bounds.min.x+bounds.max.x)/2-p.x)<.01);
    assert.ok(Math.abs((bounds.min.z+bounds.max.z)/2-p.z)<.01);
    assert.ok(Math.abs(bounds.max.y-.125)<.005);
    const bytes=(await stat(file)).size;
    assert.ok(bytes<370_000,p.id+' fits the per-parcel transfer budget');
    total+=bytes;
  }
  assert.ok(total<2_800_000,'all city parcels fit the streamed mesh budget');
});

test('room traffic follows its route, yields to a pedestrian, and is reserved from player entry',()=>{
  const f=createFleet(), driver={id:'guest',x:428,z:16,y:0,vehicle:null}, dt=.04;
  const traffic=HARBOUR_TRAFFIC.map(r=>f.find(r.id));
  const start=traffic.map(({x,z})=>({x,z}));
  for(let i=0;i<750;i++) f.step(dt,[driver],1+i*40);
  for(let i=0;i<traffic.length;i++){
    assert.ok(Math.hypot(traffic[i].x-start[i].x,traffic[i].z-start[i].z)>5);
    assert.equal(vehicleBlocked(traffic[i],f.vehicles),false);
    assert.equal(f.enter(driver,traffic[i].id).ok,false);
  }
  const car=traffic[0];
  Object.assign(car,{ ...start[0], yaw:Math.PI/2,speed:0 });
  const blockedTraffic=createFleet();
  const sample=blockedTraffic.find(car.id);
  Object.assign(driver,{x:sample.x+6,z:sample.z});
  for(let i=0;i<200;i++)blockedTraffic.step(dt,[driver],1+i*40);
  assert.ok(sample.x>start[0].x&&sample.x<driver.x-2);
});
