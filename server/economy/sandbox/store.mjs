// Immutable experiment records. Each record is written once (temporary file, fsync, atomic rename) by the
// room's single serialized writer before the main lab file references it; the main file keeps a digest index.
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync,unlinkSync} from 'node:fs';
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createExperimentStore(dir=null) {
 if(!dir) {
  const records=new Map();
  return {kind:'memory · resets when this room server restarts',
   async write(record){const text=JSON.stringify(record);records.set(record.id,text);return Buffer.byteLength(text);},
   async read(id){const text=records.get(id);if(!text)throw Error('Experiment record not found.');return JSON.parse(text);},
   async remove(id){records.delete(id);},sweep(){return 0;}};
 }
 const path=id=>{if(!UUID.test(id))throw Error('Invalid experiment ID.');return join(dir,`${id}.json`);};
 return {kind:'server-file',
  async write(record) {
   const text=JSON.stringify(record),target=path(record.id),tmp=join(dir,`${record.id}.${randomUUID()}.tmp`);
   await mkdir(dir,{recursive:true,mode:0o700});
   try{const h=await open(tmp,'wx',0o600);try{await h.writeFile(text);await h.sync();}finally{await h.close();}await rename(tmp,target);}finally{await unlink(tmp).catch(()=>{});}
   return Buffer.byteLength(text);
  },
  async read(id){return JSON.parse(await readFile(path(id),'utf8'));},
  async remove(id){await unlink(path(id)).catch(()=>{});},
  /** At startup only: remove temporary files and records no committed index refers to. */
  sweep(referenced) {
   let removed=0,names=[];try{names=readdirSync(dir);}catch{return 0;}
   for(const name of names) {
    const id=name.slice(0,36),orphan=name.endsWith('.tmp')||(name.endsWith('.json')&&UUID.test(id)&&!referenced.has(id));
    if(orphan)try{unlinkSync(join(dir,name));removed++;}catch{}
   }
   return removed;
  },
  readSync:id=>JSON.parse(readFileSync(path(id),'utf8'))};
}
