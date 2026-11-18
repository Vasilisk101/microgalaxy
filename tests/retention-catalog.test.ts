import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {createWorld} from '../lib/simulation.ts';
import {getLocalWorlds,getLocalWorld,indexLocalWorldMetadata,saveLocalWorld,releaseLocalWorld} from '../lib/local-worlds.ts';
import {openRetentionDatabase} from '../lib/local-retention.mjs';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('classic catalogue uses metadata only; opening loads only its selected world, never fabricated payloads',async()=>{
  globalThis.indexedDB=new IDBFactory();for(let n=1;n<=2;n++)await saveLocalWorld({world:createWorld('catalog-'+n,{id:id(n)}),revision:0,syncedYear:-1,updatedAt:'2026-01-01T00:00:00Z'});await new Promise(r=>setTimeout(r,20));
  const originalAll=IDBObjectStore.prototype.getAll,originalGet=IDBObjectStore.prototype.get;let fullScans=0;const fetched:string[]=[];
  IDBObjectStore.prototype.getAll=function(...args:Parameters<IDBObjectStore['getAll']>){if(this.name==='worlds')fullScans++;return originalAll.apply(this,args);};
  IDBObjectStore.prototype.get=function(key){if(this.name==='worlds')fetched.push(String(key));return originalGet.call(this,key);};
  try{const rows=await getLocalWorlds();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.summary&&r.summary.population>=0&&!('world'in r)));assert.equal(fullScans,0);assert.equal(fetched.length,0);
    const selected=await getLocalWorld(id(1));assert.equal(selected?.world.id,id(1));assert.ok(fetched.length>0);assert.ok(fetched.every(x=>x===id(1)));assert.equal(fullScans,0);
  }finally{IDBObjectStore.prototype.getAll=originalAll;IDBObjectStore.prototype.get=originalGet;await releaseLocalWorld(id(1));await releaseLocalWorld(id(2));}
});
test('classic legacy listing reports null summaries without payload scans; explicit backfill is bounded',async()=>{
  globalThis.indexedDB=new IDBFactory();const db=await openRetentionDatabase('classic') as IDBDatabase;try{const tx=db.transaction('worlds','readwrite');for(let n=1;n<=3;n++)tx.objectStore('worlds').put({world:createWorld('legacy-'+n,{id:id(n)}),revision:1,syncedYear:0,updatedAt:'2026-01-01T00:00:00Z'});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  const originalAll=IDBObjectStore.prototype.getAll,originalGet=IDBObjectStore.prototype.get;let fullScans=0;const fetched:string[]=[];
  IDBObjectStore.prototype.getAll=function(...args:Parameters<IDBObjectStore['getAll']>){if(this.name==='worlds')fullScans++;return originalAll.apply(this,args);};IDBObjectStore.prototype.get=function(key){if(this.name==='worlds')fetched.push(String(key));return originalGet.call(this,key);};
  try{const rows=await getLocalWorlds();assert.equal(rows.length,3);assert.ok(rows.every(r=>r.summary===null));assert.equal(fetched.length,0);assert.equal(fullScans,0);assert.equal(await indexLocalWorldMetadata(2),2);assert.equal(new Set(fetched).size,2);assert.equal((await getLocalWorlds()).filter(r=>r.summary!==null).length,2);assert.equal(fullScans,0);}finally{IDBObjectStore.prototype.getAll=originalAll;IDBObjectStore.prototype.get=originalGet;}
});
for(const version of ['03','04'])test(`v${version} catalogue never materializes every world and deferred backfill is bounded`,async()=>{
  globalThis.indexedDB=new IDBFactory();const core=await import(`../simulator-v${version}/src/core.mjs`),{openWorldStore}=await import(`../simulator-v${version}/src/storage.mjs`),db=await openRetentionDatabase('v'+version) as IDBDatabase;
  try{const tx=db.transaction('worlds','readwrite');for(let n=1;n<=3;n++){const world={...core.createWorld('catalog-'+n),id:id(n)};tx.objectStore('worlds').put({id:world.id,name:world.name,seed:world.seed,year:world.year,revision:1,world,previous:null,cloud:null,updatedAt:'2026-01-01T00:00:00Z'});}await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  const store=await openWorldStore(),originalAll=IDBObjectStore.prototype.getAll,originalGet=IDBObjectStore.prototype.get;let fullScans=0;const fetched:string[]=[];
  IDBObjectStore.prototype.getAll=function(...args:Parameters<IDBObjectStore['getAll']>){if(this.name==='worlds')fullScans++;return originalAll.apply(this,args);};IDBObjectStore.prototype.get=function(key){if(this.name==='worlds')fetched.push(String(key));return originalGet.call(this,key);};
  try{const rows=await store.list();assert.equal(rows.length,3);assert.ok(rows.every((r:{metadataPending?:boolean})=>r.metadataPending));assert.equal(fetched.length,0);assert.equal(fullScans,0);assert.equal(await store.indexLegacy(2),2);assert.equal(new Set(fetched).size,2);assert.equal((await store.list()).filter((r:{metadataPending?:boolean})=>r.metadataPending).length,1);assert.equal(fullScans,0);}finally{IDBObjectStore.prototype.getAll=originalAll;IDBObjectStore.prototype.get=originalGet;store.close();}
});
