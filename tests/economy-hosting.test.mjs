import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer,normalizePath} from 'vite';

test('development hosting denies durable lab data, configured stores, temporary snapshots and secrets',async()=>{
 const id=randomUUID(),custom=`server/lab-hosting-${id}.json`,files=[`server/data/lab-hosting-${id}.json`,custom,`${custom}.operation.tmp`,`.env.lab-hosting-${id}`],prior=process.env.LAB_DATA_FILE;
 let web;
 try {
  await mkdir('server/data',{recursive:true});for(const f of files)await writeFile(f,'{"marker":"private-lab-test-data"}');
  process.env.LAB_DATA_FILE=custom;
  web=await createServer({server:{port:0,host:'127.0.0.1',strictPort:false,watch:null},logLevel:'silent'});await web.listen();
  const base=`http://127.0.0.1:${web.httpServer.address().port}`;
  for(const file of files)for(const path of [`/${file}`,`/@fs/${normalizePath(resolve(file))}`]){
   const response=await fetch(base+path);assert.equal(response.status,403,`${path} must not be served`);assert.ok(!(await response.text()).includes('private-lab-test-data'));
  }
  assert.equal((await fetch(base+'/')).status,200,'the campus entry point is still served');
 }finally{if(web)await web.close();await Promise.all(files.map(f=>unlink(f).catch(()=>{})));if(prior===undefined)delete process.env.LAB_DATA_FILE;else process.env.LAB_DATA_FILE=prior;}
});
