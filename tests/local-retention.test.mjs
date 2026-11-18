import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {openWorldStore} from '../simulator-v08/src/storage.mjs';
import {openRetentionDatabase,localRetentionMetadata,writeRetentionMetadata,retentionStatus,inventoryLocalRetention,cleanupLocalRetention,readModelCatalog,setRetentionLimit,setWorldPinned,activateWorld,assertLocalNotDeleted,adoptLocalWorld} from '../lib/local-retention.mjs';
const MB=1048576,id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const value=r=>new Promise((yes,no)=>{r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
const done=t=>new Promise((yes,no)=>{t.oncomplete=yes;t.onabort=()=>no(t.error);});
async function seed(model,n,{bytes=21*MB,pinned=false,pending=false,date=`2026-01-${String(n).padStart(2,'0')}T00:00:00Z`,metadata=true}={}){
  const db=await openRetentionDatabase(model);try{const tx=db.transaction(['worlds','retention'],'readwrite'),end=done(tx),world={id:id(n),name:'World '+n,year:0,payload:'fixture'},row={id:world.id,name:world.name,revision:1,world,previous:null,cloud:null,updatedAt:date};
    tx.objectStore('worlds').put(row);if(metadata)tx.objectStore('retention').put({...localRetentionMetadata(model,row),bytes,pinned,pending});await end;return row;
  }finally{db.close();}
}
async function exists(model,worldId){const db=await openRetentionDatabase(model);try{return !!await value(db.transaction('worlds','readonly').objectStore('worlds').get(worldId));}finally{db.close();}}
test('real IndexedDB deletion uses cross-model oldest update order and genuine live Web Locks',async()=>{
  globalThis.indexedDB=new IDBFactory();await seed('v03',1);await seed('v08',1,{date:'2026-03-01T00:00:00Z'});await seed('v07',2);const release=await activateWorld('v08',id(1));
  try{const status=await setRetentionLimit(50*MB);assert.deepEqual(status.deleted.map(x=>[x.model,x.id]),[['v03',id(1)]]);assert.equal(status.knownBytes,42*MB);assert.equal(await exists('v03',id(1)),false);assert.equal(await exists('v08',id(1)),true);}finally{await release();}
});

test('checking local storage never deletes a snapshot even above its quota',async()=>{
  globalThis.indexedDB = new IDBFactory();
  await setRetentionLimit(50*MB);
  await seed('v08',1,{bytes:40*MB}); await seed('v03',2,{bytes:40*MB});
  assert.deepEqual((await inventoryLocalRetention()).deleted,[]);
  assert.equal(await exists('v08',id(1)),true);
  const cleanup = await cleanupLocalRetention();
  assert.deepEqual(cleanup.deleted.map(r=>r.id),[id(1)]);
});

test('an unreadable record cannot block later indexing and v1 has an independent local archive',async()=>{
  globalThis.indexedDB = new IDBFactory();
  for (const model of ['v08','v1']) {
    const db = await openRetentionDatabase(model);
    try {
      const tx = db.transaction('worlds','readwrite'), end = done(tx);
      for (const n of [1,2]) {
        const world = {id:id(n),name:model,year:240,seed:'delta',era:'industrial'};
        tx.objectStore('worlds').put({id:id(n),world:n === 1 ? null : world,revision:2,updatedAt:'2026-11-18T00:00:00.000Z'});
      }
      await end;
    } finally {db.close();}
    await readModelCatalog(model,{indexBudget:1});
    const catalogue = await readModelCatalog(model,{indexBudget:1});
    assert.equal(catalogue.rows.find(r=>r.id === id(1)).metadataPending,true);
    const row = catalogue.rows.find(r=>r.id === id(2));
    assert.equal(row.key,model+':'+id(2)); assert.equal(row.name,model); assert.equal(row.year,240);
  }
  const names=(await indexedDB.databases()).map(db=>db.name);
  assert.ok(names.includes('microgalaxy_observatory_v1_v1'));
  assert.ok(names.includes('microgalaxy_conflicts_v08_v1'));
});

test('combined local catalogue reads keys and indexed metadata and backfills at most two missing snapshots',async()=>{
  globalThis.indexedDB = new IDBFactory();
  for (let n=1;n<=4;n++) {
    const db=await openRetentionDatabase('v03');
    try {
      const tx=db.transaction(['worlds','metadata'],'readwrite'),end=done(tx);
      const world={id:id(n),name:'World '+n,seed:'same-seed',year:n,era:'space'};
      const row={id:id(n),name:world.name,seed:world.seed,year:n,world,previous:world,cloud:null,revision:n,updatedAt:'2026-01-01T00:00:00Z'};
      tx.objectStore('worlds').put(row);
      if(n===1)tx.objectStore('metadata').put({id:id(n),name:world.name,seed:world.seed,year:n,revision:n});
      await end;
    } finally {db.close();}
  }
  let bodies=0;const replacements={};
  for (const method of ['get','getAll','openCursor']) {
    replacements[method]=IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method]=function(...args){if(this.name==='worlds')bodies++;return replacements[method].apply(this,args);};
  }
  try {
    const first=await readModelCatalog('v03'); assert.equal(bodies,0);assert.equal(first.rows.length,4);assert.equal(first.pendingCount,3);
    assert.equal(first.rows.find(r=>r.id===id(4)).year,null);
    const indexed=await readModelCatalog('v03',{indexBudget:2});assert.equal(indexed.indexedCount,2);assert.equal(bodies,2);
    assert.equal(indexed.rows.find(r=>r.id===id(3)).year,3);assert.equal(indexed.pendingCount,1);
    const absent=await readModelCatalog('v04');assert.deepEqual(absent.rows,[]);
    assert.equal((await indexedDB.databases()).some(d=>d.name==='microgalaxy_history_v04_v1'),false);
  } finally {for(const [method,original] of Object.entries(replacements))IDBObjectStore.prototype[method]=original;}
});
test('active, pinned, dirty and corrupt unknown records cannot be auto-deleted',async()=>{
  globalThis.indexedDB=new IDBFactory();await seed('v08',1,{pinned:true});await seed('v07',2,{pending:true});await seed('v06',3);await seed('v03',4,{bytes:null});const release=await activateWorld('v06',id(3));
  try{const s=await setRetentionLimit(50*MB);assert.equal(s.deleted.length,0);assert.equal(s.knownBytes,63*MB);assert.equal(s.unknownCount,1);assert.equal(s.blocked,true);assert.equal(s.complete,false);}finally{await release();}
});
test('pin targets a twelfth legacy record directly before arbitrary bounded inventory',async()=>{
  globalThis.indexedDB=new IDBFactory();for(let n=1;n<=12;n++)await seed('v03',n,{metadata:false});const s=await setWorldPinned('v03',id(12),true);const pinned=s.records.find(x=>x.id===id(12));assert.equal(pinned.pinned,true);assert.equal(s.unknownCount,11);
  await assert.rejects(setWorldPinned('v03',id(13),true),/не найдено/);
});
test('metadata byte accounting measures UTF-8 current and previous, commits with the checkpoint',async()=>{
  globalThis.indexedDB=new IDBFactory();const db=await openRetentionDatabase('v08'),row={id:id(1),name:'Тест',revision:1,updatedAt:'2026-01-01T00:00:00Z',world:{id:id(1),text:'кириллица🌌'},previous:{id:id(1),text:'прежняя🌍'}};
  try{const tx=db.transaction(['worlds','retention'],'readwrite'),end=done(tx);tx.objectStore('worlds').put(row);writeRetentionMetadata(tx,'v08',row);await end;const meta=await value(db.transaction('retention','readonly').objectStore('retention').get(row.id));assert.equal(meta.bytes,new TextEncoder().encode(JSON.stringify(row.world)+JSON.stringify(row.previous)).length);
    const failed=db.transaction(['worlds','retention'],'readwrite'),settled=done(failed).catch(()=>{});failed.objectStore('worlds').put({...row,revision:2});writeRetentionMetadata(failed,'v08',{...row,revision:2});failed.abort();await settled;assert.equal((await value(db.transaction('retention','readonly').objectStore('retention').get(row.id))).revision,1);
  }finally{db.close();}
});
test('local tombstone blocks automatic restore and obsolete IDB generation is rejected',async()=>{
  globalThis.indexedDB=new IDBFactory();await seed('v03',1);await seed('v07',2);await seed('v08',3);await setRetentionLimit(50*MB);const db=await openRetentionDatabase('v03');try{await assert.rejects(assertLocalNotDeleted(db,id(1)),{code:'WORLD_RETIRED'});}finally{db.close();}
  await assert.rejects(value(indexedDB.open('microgalaxy_local_candidate_v1',1)),{name:'VersionError'});
});
test('a blocked obsolete database stops cross-version deletion, not merely its own database',async()=>{
  globalThis.indexedDB=new IDBFactory();await seed('v07',1);await seed('v08',2);await seed('v06',3);
  const request=indexedDB.open('microgalaxy_history_v04_v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('worlds',{keyPath:'id'});const old=await value(request);
  try{const s=await setRetentionLimit(50*MB);assert.equal(s.deleted.length,0);assert.equal(s.blocked,true);assert.equal(s.autoDeleteAvailable,false);assert.equal(await exists('v07',id(1)),true);}finally{old.close();}
});
test('without Web Locks auto-delete fails closed; no tab-local mutex fallback',async()=>{
  globalThis.indexedDB=new IDBFactory();await seed('v08',1);const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
  try{const s=await retentionStatus();assert.equal(s.autoDeleteAvailable,false);assert.equal(s.complete,false);assert.equal(await exists('v08',id(1)),true);}finally{if(original)Object.defineProperty(globalThis,'navigator',original);}
});
test('bounded legacy inventory reports all remaining unknown records honestly',async()=>{
  globalThis.indexedDB=new IDBFactory();for(let n=1;n<=12;n++)await seed('v04',n,{metadata:false});const before=await retentionStatus();assert.equal(before.unknownCount,12);const next=await inventoryLocalRetention();assert.equal(next.unknownCount,4);assert.equal(next.complete,false);
});
test('an old tab closing its IDB connection does not silently make its dirty world eligible',async()=>{
  globalThis.indexedDB=new IDBFactory();const request=indexedDB.open('microgalaxy_history_v04_v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('worlds',{keyPath:'id'});const old=await value(request),dirtyInMemory={id:id(1),year:99};
  const tx=old.transaction('worlds','readwrite'),end=done(tx);tx.objectStore('worlds').put({id:id(1),revision:1,world:{id:id(1),year:1},previous:null,cloud:null,updatedAt:'2026-01-01T00:00:00Z'});await end;old.onversionchange=()=>old.close();
  await inventoryLocalRetention();const row=(await retentionStatus()).records.find(r=>r.id===id(1));assert.equal(row.legacyProtected,true);assert.equal(dirtyInMemory.year,99);assert.equal(await exists('v04',id(1)),true);
});
test('local adoption requires human acknowledgement, inactive exclusive lock, and exact protection CAS',async()=>{
  globalThis.indexedDB=new IDBFactory();await seed('v04',1,{metadata:false});await inventoryLocalRetention();let row=(await retentionStatus()).records.find(r=>r.id===id(1));
  await assert.rejects(adoptLocalWorld('v04',id(1),1,row,false),/Подтвердите/);const release=await activateWorld('v04',id(1));try{await assert.rejects(adoptLocalWorld('v04',id(1),1,row,true),{code:'PROTECTION_CHANGED'});}finally{await release();}
  await setWorldPinned('v04',id(1),true);await assert.rejects(adoptLocalWorld('v04',id(1),1,row,true),{code:'PROTECTION_CHANGED'});
  row=(await retentionStatus()).records.find(r=>r.id===id(1));const result=await adoptLocalWorld('v04',id(1),1,row,true);const adopted=result.records.find(r=>r.id===id(1));assert.equal(adopted.legacyProtected,false);assert.equal(adopted.pinned,true);
});
test('QuotaExceeded failure never starts pruning before a new checkpoint is committed',async()=>{
  globalThis.indexedDB=new IDBFactory();await setRetentionLimit(50*MB);const current=await seed('v08',1);await seed('v07',2);await seed('v06',3);const store=await openWorldStore({validate:()=>{}}),original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(row,...args){if(this.name==='worlds'&&this.transaction.db.name==='microgalaxy_conflicts_v08_v1')throw new DOMException('Fixture device full','QuotaExceededError');return original.call(this,row,...args);};
  try{await assert.rejects(store.put({...current.world,year:1},1),{name:'QuotaExceededError'});assert.equal((await store.get(current.id)).revision,1);assert.equal(await exists('v07',id(2)),true);assert.equal(await exists('v06',id(3)),true);}finally{IDBObjectStore.prototype.put=original;store.close();}
});
test('local deletion notices survive module reload with name/bytes/time',async()=>{
  globalThis.indexedDB=new IDBFactory();await seed('v03',1);await seed('v07',2);await seed('v08',3);await setRetentionLimit(50*MB);
  const fresh=await import('../lib/local-retention.mjs?notice-refresh');const status=await fresh.retentionStatus();assert.equal(status.lastNotice.length,1);assert.equal(status.lastNotice[0].id,id(1));assert.equal(status.lastNotice[0].name,'World 1');assert.equal(status.lastNotice[0].bytes,21*MB);assert.ok(Number.isFinite(Date.parse(status.lastNotice[0].deletedAt)));
});
test('an aborted deletion transaction produces neither tombstone nor success notice',async()=>{
  globalThis.indexedDB=new IDBFactory();await seed('v03',1);await seed('v07',2);await seed('v08',3);const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(row,...args){const request=original.call(this,row,...args);if(this.name==='tombstones')request.onsuccess=()=>this.transaction.abort();return request;};
  try{await assert.rejects(setRetentionLimit(50*MB));}finally{IDBObjectStore.prototype.put=original;}
  assert.equal(await exists('v03',id(1)),true);const status=await retentionStatus();assert.equal(status.lastNotice.length,0);const db=await openRetentionDatabase('v03');try{await assertLocalNotDeleted(db,id(1));}finally{db.close();}
});
