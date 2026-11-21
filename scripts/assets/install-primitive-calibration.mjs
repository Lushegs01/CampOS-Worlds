import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseCalibration } from '../../shared/primitive-calibration.mjs';
import { DOOR_BY_ID, SEAT_BY_ID } from '../../shared/interactions.mjs';

const args=process.argv.slice(2),dryRun=args.includes('--dry-run');
const file=args.find(arg=>arg!=='--dry-run');
if(!file)throw Error('Usage: node scripts/assets/install-primitive-calibration.mjs <primitive-draft.json> [--dry-run]');
const draft=JSON.parse(await readFile(file,'utf8'));
const {fixture, calibration}=draft;
const door=DOOR_BY_ID.get(fixture);
const values=parseCalibration(calibration);
if(draft.version!==1||typeof fixture!=='string'||(!door&&!SEAT_BY_ID.has(fixture))||!values||door?.locked||(door&&values.yaw!==0)){
  throw Error('Invalid version, fixture id, or calibration values.');
}
if(dryRun){console.log(JSON.stringify({version:1,fixture,calibration:values}));process.exit(0);}
const path=new URL('../../shared/primitive-calibrations.json',import.meta.url);
const original=JSON.parse(await readFile(path,'utf8'));
const fixtures=Object.fromEntries(Object.entries({...original.fixtures,[fixture]:values}).sort(([a],[b])=>a.localeCompare(b)));
const stage=new URL(`primitive-calibrations.${process.pid}.tmp`,path);
await writeFile(stage,JSON.stringify({version:1,fixtures},null,2)+'\n',{flag:'wx'});
await rename(stage,path);
console.log(`Installed calibration for ${fixture}.`);
