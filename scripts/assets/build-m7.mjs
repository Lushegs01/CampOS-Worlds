// Original M7 visual artwork, authored for CampOS Worlds. No extracted game assets.
// Reproducible: node scripts/assets/build-m7.mjs (uses installed Three/glTF/Basis tools).
import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { encodeKTX2Batch, CACHE, OUT, ensureDir } from './common.mjs';

const dir = ensureDir(path.join(CACHE, 'm7')), output = ensureDir(path.join(OUT, 'arena/weapons'));
let seed = 7927;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
// Small shared texture set: micro-normal machining, roughness variation, sparse surface wear.
const size = 256, color = [], normal = [], arm = [];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const n = rand(), scratch = (y % 47 === 0 && n > .4) || n > .997;
  const c = Math.round(226 + n * 18 + (scratch ? 10 : 0)); color.push(c, c, c, 255);
  normal.push(128 + Math.round((rand() - .5) * 9), 128 + Math.round(Math.sin(y * 3) * 4), 254, 255);
  arm.push(255, Math.round(150 + n * 50 - (scratch ? 45 : 0)), 255, 255);
}
await encodeKTX2Batch([['color',color],['normal',normal],['arm',arm]].map(([kind,data]) => ({ raw: { data, width:size, height:size }, kind:kind === 'arm' ? 'linear' : kind, out:path.join(dir, `${kind}.ktx2`), force:true })), 2);

async function build(lod) {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene('M7 · MCX SPEAR');
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const tex = Object.fromEntries(['color','normal','arm'].map(k => [k, doc.createTexture(k).setMimeType('image/ktx2').setImage(fs.readFileSync(path.join(dir, `${k}.ktx2`)))]));
  const mat = (name, rgb, metal, rough) => doc.createMaterial(name).setBaseColorFactor([...rgb,1]).setMetallicFactor(metal).setRoughnessFactor(rough).setBaseColorTexture(tex.color).setNormalTexture(tex.normal).setNormalScale(.3).setMetallicRoughnessTexture(tex.arm);
  const mats = {
    bronze:mat('Cerakote coyote bronze',[.36,.255,.145],.7,.7),
    tan:mat('FDE polymer',[.28,.225,.155],0,.94),
    steel:mat('Phosphate steel',[.052,.06,.065],.85,.5),
    rubber:mat('Textured black rubber',[.018,.022,.02],0,.95),
    edge:mat('Machined hardware',[.17,.18,.17],.9,.38),
    lens:doc.createMaterial('Coated optic glass').setBaseColorFactor([.12,.3,.33,.12]).setAlphaMode('BLEND').setDoubleSided(true).setMetallicFactor(.1).setRoughnessFactor(.12),
  };
  const groups = new Map();
  function geo(g, material, xyz, rot=[0,0,0], part='body') {
    const matrix = new T.Matrix4().compose(new T.Vector3(...xyz),new T.Quaternion().setFromEuler(new T.Euler(...rot)),new T.Vector3(1,1,1));
    let b = g.index ? g.toNonIndexed() : g; b.applyMatrix4(matrix);
    // World-scale machining grain: metre-based extrusions otherwise stretch a few texels across the receiver.
    const positions=b.getAttribute('position'),normals=b.getAttribute('normal'),uvs=new Float32Array(positions.count*2);
    for(let i=0;i<positions.count;i++){const nx=Math.abs(normals.getX(i)),ny=Math.abs(normals.getY(i)),nz=Math.abs(normals.getZ(i));uvs[i*2]=(nx>ny&&nx>nz?positions.getZ(i):positions.getX(i))*8;uvs[i*2+1]=(ny>nx&&ny>nz?positions.getZ(i):positions.getY(i))*8;}
    b.setAttribute('uv',new T.BufferAttribute(uvs,2));
    const key = `${part}:${material}`; if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(b);
  }
  function box(w,h,d,xyz,m='bronze',r=[0,0,0],part='body') { geo(new T.BoxGeometry(w,h,d),m,xyz,r,part); }
  function cyl(radius,length,xyz,m='steel',axis='z',part='body',r2=radius) { geo(new T.CylinderGeometry(radius,r2,length,lod?10:24,1),m,xyz,axis==='z'?[Math.PI/2,0,0]:axis==='x'?[0,0,Math.PI/2]:[0,0,0],part); }
  function tube(outer,inner,length,z,m) {
    const points=[[inner,-length/2],[outer,-length/2],[outer,length/2],[inner,length/2],[inner,-length/2]].map(([r,y])=>new T.Vector2(r,y));
    geo(new T.LatheGeometry(points,lod?12:32),m,[0,.104,z],[Math.PI/2,0,0]);
  }
  // Bevelled side silhouettes extruded across X. Points are [z,y], muzzle at z=0.
  function profile(points,width,m='bronze',part='body',holes=[]) {
    const shape = new T.Shape(points.map(([z,y])=>new T.Vector2(z,y)));
    for (const [z,y,w,h] of holes) { const hole=new T.Path(); hole.moveTo(z-w/2,y-h/2);hole.lineTo(z-w/2,y+h/2);hole.lineTo(z+w/2,y+h/2);hole.lineTo(z+w/2,y-h/2);hole.closePath();shape.holes.push(hole); }
    const g=new T.ExtrudeGeometry(shape,{depth:width,bevelEnabled:!lod,bevelSize:.0015,bevelThickness:.0015,bevelSegments:1,steps:1,curveSegments:lod?2:4});
    // (u=z,v=y,depth=x) -> (x,y,z), flat end planes correctly recompute normals.
    const p=g.getAttribute('position'); for(let i=0;i<p.count;i++) {const z=p.getX(i),y=p.getY(i),x=p.getZ(i)-width/2;p.setXYZ(i,x,y,-z);}
    // Flip z below keeps winding valid; reflect the requested z coordinates back with rotation.
    g.rotateY(Math.PI); // x inverted, z now positive; symmetric profiles across X
    g.computeVertexNormals(); geo(g,m,[0,0,0],[0,0,0],part);
  }
  // Suppressed military silhouette: ~1.05 m overall, short barrel and long receiver.
  cyl(.0215,.155,[0,0,.0775]); cyl(.023,.018,[0,0,.161],'edge');
  cyl(.022,.006,[0,0,.004],'rubber'); cyl(.006,.002,[0,0,.0008],'rubber');
  for(let i=0;i<(lod?3:9);i++) cyl(.022,.0015,[0,0,.025+i*.013],'edge');
  cyl(.012,.2,[0,0,.24]); cyl(.018,.018,[0,0,.175],'steel');
  // Piston housing above bore, distinct tall MCX receiver with no AR buffer tube.
  cyl(.009,.23,[0,.024,.35]); box(.032,.033,.045,[0,.018,.27],'steel');
  profile([[.44,-.03],[.435,.028],[.47,.049],[.69,.049],[.724,.027],[.724,-.035],[.65,-.043],[.54,-.035]],.058);
  profile([[.495,-.025],[.7,-.03],[.709,-.066],[.666,-.073],[.649,-.048],[.605,-.056],[.587,-.075],[.509,-.077]],.048);
  // Handguard side panels have actual open M-LOK cuts, not painted black rectangles.
  const handshape=new T.Shape([new T.Vector2(.20,-.028),new T.Vector2(.45,-.028),new T.Vector2(.45,.035),new T.Vector2(.21,.035)]);
  for(let row=0;row<2;row++) for(let j=0;j<5;j++) {
    const z=.224+j*.041,y=-.015+row*.03,w=.029,h=.007;
    const hpath=new T.Path();hpath.moveTo(z,y);hpath.lineTo(z,y+h);hpath.lineTo(z+w,y+h);hpath.lineTo(z+w,y);hpath.closePath();handshape.holes.push(hpath);
  }
  for(const side of [-1,1]) {
    const g=new T.ExtrudeGeometry(handshape,{depth:.003,bevelEnabled:!lod,bevelSize:.0005,bevelThickness:.0005,bevelSegments:1,steps:1});
    const p=g.getAttribute('position');for(let i=0;i<p.count;i++){ const z=p.getX(i),y=p.getY(i),x=p.getZ(i);p.setXYZ(i,(.026+x)*side,y,z); } if(side===1){ // reverse winding for coordinate swap
      const a=p.array;for(let i=0;i<a.length;i+=9)for(let k=0;k<3;k++){const v=a[i+k];a[i+k]=a[i+6+k];a[i+6+k]=v;}
      const uv=g.getAttribute('uv').array;for(let i=0;i<uv.length;i+=6)for(let k=0;k<2;k++){const v=uv[i+k];uv[i+k]=uv[i+4+k];uv[i+4+k]=v;}
    }g.computeVertexNormals();geo(g,'bronze',[0,0,0]);
  }
  box(.05,.004,.245,[0,-.031,.325]); box(.049,.006,.26,[0,.039,.33]);
  // Continuous top rail, individual recoil lugs and angled front/rear backup sights.
  box(.019,.006,.49,[0,.051,.465],'steel');
  for(let i=0;i<(lod?25:49);i++) box(.023,.004,lod?.005:.003,[0,.056,.225+i*(lod?.019:.01)]);
  box(.022,.016,.012,[0,.066,.23],'steel'); box(.005,.018,.005,[0,.081,.23],'steel');
  box(.025,.018,.016,[0,.065,.704],'steel');
  // Stepped receiver machining, reinforcing ribs and captive pins break up the broad side planes.
  for(const side of [-1,1]) {
    box(.003,.007,.18,[side*.031,.028,.574],'bronze');
    box(.003,.006,.07,[side*.026,-.057,.55],'bronze');
    box(.003,.017,.024,[side*.026,-.035,.677],'bronze');
    if(!lod) {
      for(const z of [.52,.609,.68]) {cyl(.0036,.004,[side*.028,-.042,z],'steel','x');cyl(.0013,.0045,[side*.03,-.042,z],'edge','x');}
      for(let i=0;i<6;i++) box(.002,.006,.001,[side*.032,.021,.511+i*.003],'edge');
    }
  }
  // Empty ejection port surround, bolt carrier and ambidextrous controls.
  box(.001,.018,.074,[.030,.008,.598],'rubber');box(.003,.011,.064,[.031,.008,.601],'edge',[0,0,0],'bolt');
  box(.006,.007,.025,[-.034,.012,.53],'steel');box(.018,.008,.014,[-.044,.012,.54],'steel',[0,0,0],'bolt');
  for(const x of [-.03,.03]) {
    cyl(.006,.004,[x,-.048,.655],'steel','x');box(.006,.006,.024,[x,-.046,.646],'steel',[.18,0,0]);
    cyl(.004,.004,[x,-.059,.61],'edge','x');box(.004,.009,.015,[x,-.045,.59],'steel');
    box(.008,.008,.018,[x,.034,.704],'steel',[0,0,0],'bolt');
    if(!lod) for(const z of [.465,.506,.676,.706]) { cyl(.003,.003,[x,.022,z],'edge','x');box(.003,.001,.004,[x*1.07,.022,z],'rubber'); }
  }
  // Magwell with flare; curved 20-round steel magazine, floorplate and stamped ribs.
  profile([[.51,-.056],[.605,-.056],[.601,-.087],[.513,-.09]],.053);
  profile([[.514,-.08],[.595,-.08],[.589,-.185],[.572,-.216],[.503,-.21],[.51,-.153]],.029,'steel','mag');
  box(.035,.008,.077,[0,-.212,.541],'rubber',[0,0,0],'mag');
  for(const side of [-1,1]) for(let i=0;i<(lod?2:4);i++) box(.002,.096,.0025,[side*.016,-.144,.519+i*.019],'edge',[.03,0,0],'mag');
  // Grip, real trigger guard opening and curved trigger, receiver pins.
  profile([[.652,-.061],[.687,-.065],[.715,-.154],[.684,-.168],[.666,-.13]],.031,'tan');
  if(!lod) for(let j=0;j<9;j++) box(.033,.0015,.025,[0,-.09-j*.007,.678+j*.0023],'rubber',[.3,0,0]);
  profile([[.603,-.067],[.656,-.066],[.67,-.105],[.609,-.106]],.012,'steel','body',[[.634,-.086,.037,.026]]);
  profile([[.647,-.067],[.644,-.083],[.633,-.09],[.636,-.095],[.65,-.087],[.654,-.07]],.005,'steel');
  // Folding hinge and telescoping stock: no standard AR buffer tube silhouette.
  cyl(.017,.064,[0,-.003,.729],'steel','y');box(.044,.057,.017,[0,.008,.74],'steel');
  profile([[.75,.026],[.892,.029],[.962,.007],[.968,-.091],[.935,-.11],[.923,-.048],[.805,-.025],[.75,-.025]],.035,'tan');
  profile([[.795,-.025],[.922,-.05],[.921,-.069],[.8,-.047]],.015,'steel');
  box(.042,.107,.017,[0,-.041,.968],'rubber',[-.13,0,0]);box(.04,.017,.1,[0,.033,.869],'tan');
  box(.014,.011,.025,[0,-.048,.851],'rubber');cyl(.005,.043,[0,-.012,.75],'edge','x');
  if(!lod) for(let i=0;i<8;i++)box(.044,.001,.01,[0,-.085+i*.011,.976],'steel',[-.13,0,0]);
  // Fixed magnified optic. Rings and mount leave a clear centreline; no fake rangefinder claims.
  for(const z of [.535,.628]) {box(.035,.014,.025,[0,.066,z],'steel');box(.017,.02,.02,[0,.078,z],'steel');}
  tube(.02,.017,.15,.578,'steel');tube(.025,.019,.042,.5,'bronze');tube(.024,.018,.043,.664,'rubber');
  for(const z of [.535,.628]) tube(.023,.0205,.012,z,'bronze');
  cyl(.019,.001,[0,.104,.477],'lens');cyl(.018,.001,[0,.104,.686],'lens');
  cyl(.012,.017,[0,.13,.58],'steel','y');cyl(.01,.018,[.023,.104,.58],'steel','x');
  if(!lod) for(let i=0;i<12;i++){const a=i*Math.PI/6;box(.002,.003,.035,[Math.cos(a)*.025,.104+Math.sin(a)*.025,.665],'edge',[0,0,a]);}

  const parts = new Map(), stats={};let triangles=0;
  for(const [key, geometries] of groups) {
    const [part,material]=key.split(':'), g=mergeGeometries(geometries);const count=g.getAttribute('position').count;triangles+=count/3;
    const primitive=doc.createPrimitive().setMaterial(mats[material]);
    for(const [attr,type] of [['position','VEC3'],['normal','VEC3'],['uv','VEC2']]) primitive.setAttribute(({position:'POSITION',normal:'NORMAL',uv:'TEXCOORD_0'})[attr],doc.createAccessor().setType(type).setArray(new Float32Array(g.getAttribute(attr).array)).setBuffer(buffer));
    if(!parts.has(part)){const node=doc.createNode(part).setMesh(doc.createMesh(part));parts.set(part,node);scene.addChild(node);stats[part]={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};}
    parts.get(part).getMesh().addPrimitive(primitive);
    g.computeBoundingBox();['x','y','z'].forEach((axis,i)=>{stats[part].min[i]=Math.min(stats[part].min[i],g.boundingBox.min[axis]);stats[part].max[i]=Math.max(stats[part].max[i],g.boundingBox.max[axis]);});
  }
  await doc.transform(weld(),dedup(),prune(),meshopt({encoder:MeshoptEncoder,level:'medium'}));
  const file=path.join(output,`m7${lod?'-lod':''}.glb`);
  await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder}).write(file,doc);
  return {triangles,bytes:fs.statSync(file).size,parts:stats};
}
const first=await build(false), third=await build(true);
const manifestFile=path.join(OUT,'arena/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile));
manifest.weapons=manifest.weapons.filter(w=>w.id!=='m7');manifest.weapons.push({id:'m7',...first,lodTriangles:third.triangles,lodBytes:third.bytes,author:'CampOS Worlds original artwork',license:'Project artwork; no third-party model',configuration:'Suppressed M7 / MCX SPEAR, fixed 2× optic'});
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
console.log({first,third});
