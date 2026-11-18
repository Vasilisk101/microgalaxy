import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import * as policy from './lib/retention-policy.mjs';
import * as registry from './lib/world-models.mjs';
import {acquireWorldLease,withRetentionLock} from './lib/local-retention-locks.mjs';
import {getLocalWorlds,getLocalWorld,releaseLocalWorld} from './lib/local-worlds.ts';
import {createWorld as createClassicWorld} from './lib/simulation.ts';
import {openRetentionDatabase,localRetentionMetadata,setRetentionLimit} from './lib/local-retention.mjs';
const MB=1048576,id=n=>`80000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
function setup(){
  const sql=new DatabaseSync(':memory:');
  for(const name of readdirSync('./drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('./drizzle/'+name,'utf8'));
  const blobs=new Map();let heads=0,deletes=0;
  const DB={prepare(q){return {bind(...args){return {async first(){return sql.prepare(q).get(...args)??null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){const r=sql.prepare(q).run(...args);return {meta:{changes:Number(r.changes)}};}};}};},async batch(xs){sql.exec('BEGIN');try{const out=[];for(const x of xs)out.push(await x.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const BUCKET={async head(key){heads++;return blobs.get(key)??null;},async delete(key){deletes++;blobs.delete(key);}};
  const out={},compiled=ts.transpileModule(readFileSync('./lib/retention-cloud.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',compiled)(name=>name==='cloudflare:workers'?{env:{DB,BUCKET}}:name==='./world-models.mjs'?registry:name==='./retention-policy.mjs'?policy:(()=>{throw Error(name);})(),out);
  function world(model,n,owner='review-owner',bytes=MB,legacy=false){
    const key=`${model}/${owner}/${id(n)}/initial`,date='2026-01-01T00:00:00Z',table=model==='classic'?'worlds':`worlds_${model}`;
    if(!legacy)sql.prepare('INSERT INTO retention_intents(snapshot_key,owner_id,model,world_id,bytes,created_at) VALUES(?,?,?,?,?,?)').run(key,owner,model,id(n),bytes,date);
    sql.prepare(`INSERT INTO ${table}(id,owner_id,name,seed,${model==='classic'?'':'starting_era,schema_version,model_version,'}year,population,era,revision,snapshot_key,previous_snapshot_key,created_at,updated_at) VALUES(${Array(model==='classic'?12:15).fill('?').join(',')})`).run(id(n),owner,`Review ${model}`,'seed',...(model==='classic'?[]:['agriculture','schema',model]),0,100,'era',1,key,null,date,date);
    blobs.set(key,{size:bytes});return {key,id:id(n),table};
  }
  return {sql,api:out,world,blobs,get heads(){return heads;},get deletes(){return deletes;},close(){sql.close();}};
}
function renderCloud(status){
  const source=readFileSync('./simulator-v08/src/ui.js','utf8'),start=source.indexOf('function retentionSection('),end=source.indexOf('function renderRetention(',start);
  return new Function('retentionState','world','h','retentionLabel',source.slice(start,end)+';return retentionSection("cloud","Cloud");')({cloud:status,busy:false,errors:{},deleted:{cloud:[]}},null,String,()=>String(status.knownBytes));
}

test('independent SQL+actual UI: inventoried legacy cloud world exposes explicit adoption, without falsely pending',async()=>{
  const f=setup();try{const a=f.world('v03',1,'review-owner',MB,true),status=await f.api.pruneCloudRetention('review-owner',undefined,8),row=status.records.find(r=>r.id===a.id);
    assert.equal(row.legacyProtected,1);assert.equal(status.uncertainWrites,0);
    const html=renderCloud(status);assert.match(html,/data-retention-adopt="cloud"/);assert.doesNotMatch(html,/ожидает записи/);
  }finally{f.close();}
});

test('independent real SQL: all seven model tables retain and count current+previous, preserve owner and pin',async()=>{
  const f=setup();try{
    const models=['classic','v03','v04','v05','v06','v07','v08'];let total=0;
    for(const [i,model]of models.entries()){
      const r=f.world(model,i+1);await f.api.setCloudPinned('review-owner',model,r.id,true);
      const second=r.key+'/second';await f.api.beginRetentionWrite('review-owner',model,r.id,second,2*MB);f.blobs.set(second,{size:2*MB});
      f.sql.prepare(`UPDATE ${r.table} SET previous_snapshot_key=snapshot_key,snapshot_key=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=?`).run(second,'2026-02-01T00:00:00Z','review-owner',r.id);
      const third=r.key+'/third';await f.api.beginRetentionWrite('review-owner',model,r.id,third,3*MB);f.blobs.set(third,{size:3*MB});
      f.sql.prepare(`UPDATE ${r.table} SET previous_snapshot_key=snapshot_key,snapshot_key=?,revision=revision+1,updated_at=? WHERE owner_id=? AND id=?`).run(third,'2026-03-01T00:00:00Z','review-owner',r.id);
      const meta=f.sql.prepare('SELECT * FROM retention_entries WHERE model=? AND world_id=? AND owner_id=?').get(model,r.id,'review-owner');assert.equal(meta.current_bytes,3*MB);assert.equal(meta.previous_bytes,2*MB);assert.equal(meta.pinned,1);total+=5*MB;
    }
    const beforeReads=f.heads,status=await f.api.cloudRetentionStatus('review-owner');assert.equal(status.knownBytes,total);assert.equal(status.limitBytes,200*MB);assert.equal(f.heads,beforeReads);assert.equal((await f.api.cloudRetentionStatus('other-owner')).knownBytes,0);
    await f.api.pruneCloudRetention('review-owner');assert.equal(f.deletes,7);assert.equal(f.blobs.size,14);assert.equal((await f.api.cloudRetentionStatus('review-owner')).knownBytes,total);
  }finally{f.close();}
});

test('independent SQL: adoption never removes lease changed after observed receipt or pending write',async()=>{
  const f=setup();try{const r=f.world('v08',11);await f.api.cloudLease('review-owner','v08',r.id,'review-session-old');const observed=(await f.api.cloudRetentionStatus('review-owner')).records[0].protection;
    await f.api.cloudLease('review-owner','v08',r.id,'review-session-old');
    await assert.rejects(f.api.adoptCloudWorld('review-owner','v08',r.id,'review-session-now',1,observed,true),e=>e.status===409);
    const renewed=(await f.api.cloudRetentionStatus('review-owner')).records[0].protection;await f.api.beginRetentionWrite('review-owner','v08',r.id,'review-inflight',100);
    await assert.rejects(f.api.adoptCloudWorld('review-owner','v08',r.id,'review-session-now',1,renewed,true),e=>e.status===409);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM retention_leases').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM retention_adoptions').get().n,0);
  }finally{f.close();}
});

test('independent classic catalog: ordinary listing must not load every saved world body',async()=>{
  globalThis.indexedDB=new IDBFactory();let worldBodyReads=0;const getAll=IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll=function(...args){if(this.name==='worlds')worldBodyReads++;return getAll.apply(this,args);};
  try{await getLocalWorlds();assert.equal(worldBodyReads,0,'Classic catalog still calls worlds.getAll() and validates every full world');}finally{IDBObjectStore.prototype.getAll=getAll;}
});

test('independent SQL: old release receipt cannot remove renewed session or cross-owner lease',async()=>{
  const f=setup();try{const r=f.world('v08',21),session='review-release-session';
    const old=await f.api.cloudLease('review-owner','v08',r.id,session),fresh=await f.api.cloudLease('review-owner','v08',r.id,session);
    assert.notEqual(old,fresh);
    assert.equal(await f.api.cloudLease('review-owner','v08',r.id,session,true,old),false);
    assert.equal(await f.api.cloudLease('other-owner','v08',r.id,session,true,fresh),false);
    await assert.rejects(f.api.cloudLease('review-owner','v08',r.id,session,true),e=>e.status===400);
    assert.equal(f.sql.prepare('SELECT version FROM retention_leases WHERE owner_id=?').get('review-owner').version,fresh);
    assert.equal(await f.api.cloudLease('review-owner','v08',r.id,session,true,fresh),true);
  }finally{f.close();}
});

test('independent actual client: delayed release response preserves newly remembered lease receipt',async()=>{
  const client=await import('./lib/retention-client.mjs?review-release-client'),oldFetch=globalThis.fetch,calls=[];
  let complete;
  globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));if(calls.length===1)return new Promise(resolve=>{complete=()=>resolve(Response.json({released:true}));});return Response.json({released:true});};
  try{
    assert.deepEqual(await client.releaseCloudWorld('v08',id(22)),{released:false,protected:true});assert.equal(calls.length,0);
    const v1='00000000-0000-4000-8000-000000000001',v2='00000000-0000-4000-8000-000000000002';
    client.rememberCloudLease('v08',id(22),v1);const pending=client.releaseCloudWorld('v08',id(22));assert.equal(calls[0].leaseVersion,v1);
    client.rememberCloudLease('v08',id(22),v2);complete();await pending;await client.releaseCloudWorld('v08',id(22));assert.equal(calls[1].leaseVersion,v2);
  }finally{globalThis.fetch=oldFetch;}
});

test('independent separate JS agents: native Web Locks actually coordinate world protection',async()=>{
  const release=await withRetentionLock(()=>acquireWorldLease('v08','review-cross-agent'));
  const code=`const {parentPort}=require('node:worker_threads');(async()=>{const m=await import(${JSON.stringify(new URL('./lib/local-retention-locks.mjs',import.meta.url).href)});parentPort.on('message',async()=>parentPort.postMessage(await m.withRetentionLock(()=>m.withInactiveWorld('v08','review-cross-agent',()=>true))));parentPort.postMessage('ready');})().catch(e=>{throw e;});`;
  const worker=new Worker(code,{eval:true});
  try{await once(worker,'message');let reply=once(worker,'message');worker.postMessage('probe');assert.equal((await reply)[0],null);await release();reply=once(worker,'message');worker.postMessage('probe');assert.equal((await reply)[0],true);}finally{await release();await worker.terminate();}
});

for(const branch of ['explicit-local','remembered-offline'])test('P1 independent exact classic boot: '+branch+' is protected before cloud wait and delayed checkpoint',async()=>{
  globalThis.indexedDB=new IDBFactory();
  const world=createClassicWorld('review-classic-boot',{id:id(31),epoch:'agrarian'}),record={world,revision:1,syncedYear:world.year,updatedAt:'2026-01-01T00:00:00Z'};
  const put=async(model,row)=>{const db=await openRetentionDatabase(model);try{await new Promise((resolve,reject)=>{const tx=db.transaction(['worlds','retention'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.objectStore('worlds').put(row);tx.objectStore('retention').put({...localRetentionMetadata(model,row),bytes:30*MB});});}finally{db.close();}};
  await put('classic',record);await put('v08',{id:id(32),world:{id:id(32)},revision:1,updatedAt:'2026-02-01T00:00:00Z'});
  const source=readFileSync('./app/simulation-app.tsx','utf8'),start=source.indexOf('const boot=async()=>{'),end=source.indexOf('void boot();',start),bootSource=source.slice(start,end);
  const js=ts.transpileModule(bootSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let installed=null,cloudWaitChecked=false;
  const cleanupProtected=async()=>{const cleanup=await setRetentionLimit(50*MB);assert.equal(cleanup.deleted.some(r=>r.model==='classic'&&r.id===world.id),false,'Quota cleanup deleted the world selected/installed by actual classic boot before its900ms checkpoint');};
  const offline=async()=>{await cleanupProtected();cloudWaitChecked=true;throw Error('Independent offline fixture');};
  try{
    await new Function('getLocalWorlds','getLocalWorld','window','installWorld','setBootIssue','preference','worldApi','let active=true;'+js+';return boot();')(getLocalWorlds,getLocalWorld,{location:{search:branch==='explicit-local'?`?world=${world.id}&source=local`:''}},r=>{installed=r;},message=>{throw Error(message);},()=>world.id,offline);
    assert.equal(installed?.world.id,world.id);if(branch==='remembered-offline')assert.equal(cloudWaitChecked,true);
    await cleanupProtected();
  }finally{await releaseLocalWorld(world.id);}
});

for(const model of ['v03','v04'])test('independent '+model+' catalog: metadata-only listing, bounded legacy indexing and atomic metadata write',async()=>{
  globalThis.indexedDB=new IDBFactory();const core=await import(`./simulator-${model}/src/core.mjs`),storage=await import(`./simulator-${model}/src/storage.mjs`),worlds=[];
  const db=await openRetentionDatabase(model);try{for(let i=0;i<3;i++){const world=core.createWorld('review-catalog-'+model+'-'+i);worlds.push(world);await new Promise((resolve,reject)=>{const tx=db.transaction('worlds','readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.objectStore('worlds').put({id:world.id,name:world.name,seed:world.seed,year:world.year,revision:1,world,previous:null,cloud:null,updatedAt:'2026-01-01T00:00:00Z'});});}}finally{db.close();}
  const store=await storage.openWorldStore(),originalGet=IDBObjectStore.prototype.get,originalGetAll=IDBObjectStore.prototype.getAll,originalPut=IDBObjectStore.prototype.put;let bodyReads=0;
  IDBObjectStore.prototype.get=function(...args){if(this.name==='worlds')bodyReads++;return originalGet.apply(this,args);};
  IDBObjectStore.prototype.getAll=function(...args){if(this.name==='worlds')bodyReads++;return originalGetAll.apply(this,args);};
  try{
    const first=await store.list();assert.equal(bodyReads,0);assert.equal(first.filter(r=>r.metadataPending).length,3);
    assert.equal(await store.indexLegacy(2),2);const beforeList=bodyReads,second=await store.list();assert.equal(bodyReads,beforeList);assert.equal(second.filter(r=>r.metadataPending).length,1);
    const selected=second.find(r=>r.metadataPending);await store.get(selected.id);assert.equal((await store.list()).filter(r=>r.metadataPending).length,0);
    const target=worlds[0];IDBObjectStore.prototype.put=function(row,...args){if(this.name==='metadata')throw new DOMException('Independent metadata commit failure','QuotaExceededError');return originalPut.call(this,row,...args);};
    await assert.rejects(store.put(target,1),{name:'QuotaExceededError'});IDBObjectStore.prototype.put=originalPut;
    assert.equal((await store.get(target.id)).revision,1);assert.equal((await store.list()).find(r=>r.id===target.id).revision,1);
  }finally{IDBObjectStore.prototype.get=originalGet;IDBObjectStore.prototype.getAll=originalGetAll;IDBObjectStore.prototype.put=originalPut;store.close();}
});
