import test from 'node:test';
import assert from 'node:assert/strict';
import { cp,mkdir,mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BASE_CALIBRATION,fixtureCalibration,parseCalibration } from '../shared/primitive-calibration.mjs';
import { doorHandle } from '../shared/character-actions.mjs';
import { DOOR_BY_ID } from '../shared/interactions.mjs';

test('calibration is bounded and missing fixture settings fall back to the authored measurements',()=>{
 assert.deepEqual(fixtureCalibration('unused-fixture'),BASE_CALIBRATION);
 const custom={x:.1,y:-.12,z:.01,yaw:8,approach:-.08};
 assert.deepEqual(parseCalibration(custom),custom);
 for(const illegal of [{...custom,x:Infinity},{...custom,yaw:16},{...custom,z:'0.1'}, {...custom,unexpected:true}])assert.equal(parseCalibration(illegal),null);
 const door=DOOR_BY_ID.get('library-main'), leaf=door.leaves[1];
 const handle=doorHandle(door,leaf,custom);
 assert.ok(Math.abs(handle.x+1.2)<.001);
 assert.equal(handle.y,.93);
 assert.ok(Math.abs(handle.z-.07)<1e-6);
});

test('installer accepts a draft, publishes runtime data in an isolated project, and rejects incompatible data',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'campos-primitive-'));
 t.after(()=>rm(folder,{force:true,recursive:true}));
 const path=join(folder,'draft.json');
 const draft={version:1,fixture:'library-main',calibration:{...BASE_CALIBRATION,y:.05}};
 const run=()=>execFileSync(process.execPath,['scripts/assets/install-primitive-calibration.mjs',path,'--dry-run'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 await writeFile(path,JSON.stringify(draft));
 assert.deepEqual(JSON.parse(run()),draft);
 await cp('shared',join(folder,'shared'),{recursive:true});
 const scripts=join(folder,'scripts','assets');
 await mkdir(scripts,{recursive:true});
 const entry=join(scripts,'install-primitive-calibration.mjs');
 await cp('scripts/assets/install-primitive-calibration.mjs',entry);
 execFileSync(process.execPath,[entry,path],{stdio:'pipe'});
 const registry=JSON.parse(await readFile(join(folder,'shared','primitive-calibrations.json'),'utf8'));
 assert.deepEqual(registry.fixtures['library-main'],draft.calibration);
 const installed=await import(pathToFileURL(join(folder,'shared','primitive-calibration.mjs')));
 assert.deepEqual(installed.fixtureCalibration(draft.fixture),draft.calibration);
 await writeFile(path,JSON.stringify({...draft,fixture:'library-staff'}));
 assert.throws(run,/Invalid version, fixture id, or calibration values/);
});
