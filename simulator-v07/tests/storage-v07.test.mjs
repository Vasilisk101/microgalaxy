import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createWorld, advance, clone, SCHEMA, MODEL_VERSION } from '../src/core.mjs';
import { openWorldStore, memoryWorldStore, encodeSave, decodeSave, ensureSaveSize, MAX_FILE_BYTES } from '../src/storage.mjs';
import { createWorld as createV03World } from '../../simulator-v03/src/core.mjs';
import { openWorldStore as openV03Store, encodeSave as encodeV03Save, decodeSave as decodeV03Save } from '../../simulator-v03/src/storage.mjs';
import { createWorld as createV04World } from '../../simulator-v04/src/core.mjs';
import { openWorldStore as openV04Store, encodeSave as encodeV04Save, decodeSave as decodeV04Save } from '../../simulator-v04/src/storage.mjs';
import { createWorld as createV05World } from '../../simulator-v05/src/core.mjs';
import { openWorldStore as openV05Store, encodeSave as encodeV05Save, decodeSave as decodeV05Save } from '../../simulator-v05/src/storage.mjs';
import { createWorld as createV06World } from '../../simulator-v06/src/core.mjs';
import { openWorldStore as openV06Store, encodeSave as encodeV06Save } from '../../simulator-v06/src/storage.mjs';

test('same ID in v06 and v07 remains isolated and v06 is unchanged', async()=>{
  globalThis.indexedDB=new IDBFactory();
  const old=createV06World('old-six'), current=fresh(); current.id=old.id;
  const oldStore=await openV06Store(), currentStore=await openWorldStore(), file=await encodeV06Save(old);
  try {await oldStore.put(old,0); await currentStore.put(current,0);
    assert.deepEqual((await oldStore.get(old.id)).world,old);
    assert.deepEqual((await currentStore.get(current.id)).world,current);
    await assert.rejects(()=>decodeSave(file));
  } finally {oldStore.close(); currentStore.close();}
});

test('same-ID v05 checkpoint and portable file remain untouched and incompatible with v07', async()=>{
  globalThis.indexedDB=new IDBFactory();
  const old=createV05World('old-five'), current=fresh(); current.id=old.id;
  const original=await encodeV05Save(old), oldStore=await openV05Store(), newStore=await openWorldStore();
  try {
    await oldStore.put(old,0); await newStore.put(current,0);
    assert.deepEqual((await oldStore.get(old.id)).world,old);
    assert.deepEqual((await newStore.get(current.id)).world,current);
    await assert.rejects(()=>decodeSave(original));
    const modern=await encodeSave(current);
    await assert.rejects(()=>decodeV05Save(modern));
    assert.deepEqual(await decodeV05Save(original),old);
  } finally {oldStore.close();newStore.close();}
});

const stamp = '2026-11-16T08:00:00.000Z';
test('local record identity cannot be substituted through a legacy record',async()=>{
  globalThis.indexedDB=new IDBFactory();const original=fresh(),other=fresh();
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('microgalaxy_societies_v07_v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('worlds',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('worlds','readwrite');tx.objectStore('worlds').put({id:original.id,name:original.name,seed:original.seed,year:original.year,revision:1,world:other,previous:null,cloud:null,updatedAt:stamp});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  const store=await openWorldStore();try{await assert.rejects(()=>store.get(original.id),/другому миру/);await store.list();await assert.rejects(()=>store.getMetadata(original.id),/другому миру/);}finally{store.close();}
});
test('blocked upgrades stop safely and version changes notify the active tab',async()=>{
  globalThis.indexedDB=new IDBFactory();const old=await new Promise((resolve,reject)=>{const r=indexedDB.open('microgalaxy_societies_v07_v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('worlds',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await assert.rejects(()=>openWorldStore(),{code:'STORAGE_UPGRADE_BLOCKED'});old.close();
  const store=await openWorldStore({onVersionChange:()=>{notified=true;}});let notified=false;
  const newer=await new Promise((resolve,reject)=>{const r=indexedDB.open('microgalaxy_societies_v07_v1',4);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});assert.equal(notified,true);newer.close();store.close();
  await assert.rejects(()=>openWorldStore(),{name:'VersionError'});
});
test('metadata upgrade retains legacy snapshots and indexes in bounded batches', async()=>{
  globalThis.indexedDB=new IDBFactory();const w=fresh();
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('microgalaxy_societies_v07_v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('worlds',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('worlds','readwrite');tx.objectStore('worlds').put({id:w.id,name:w.name,seed:w.seed,year:w.year,revision:1,world:w,previous:clone(w),cloud:null,updatedAt:stamp});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  const store=await openWorldStore();try{assert.equal((await store.list())[0].id,w.id);assert.deepEqual((await store.get(w.id)).previous,w);}finally{store.close();}
});
test('async validation isolates snapshot from mutation while awaiting',async()=>{
  globalThis.indexedDB=new IDBFactory();let release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);const w=fresh();
  const store=await openWorldStore({validate:async snapshot=>{entered();await waiting;assert.notEqual(snapshot.name,'changed during validation');}});
  try{const pending=store.put(w,0);await started;w.name='changed during validation';release();await pending;assert.notEqual((await store.get(w.id)).world.name,w.name);}finally{store.close();}
});
test('clean cloud sync reads metadata only and detects another tab becoming dirty',async()=>{
  globalThis.indexedDB=new IDBFactory();const a=await openWorldStore(),b=await openWorldStore(),w=fresh();
  try{await a.put(w,0);await a.markSynced(w.id,1,1,stamp);let heavy=0,requests=0;const {createCloudSync}=await import('../src/cloud.mjs');const wrapper={getMetadata:id=>b.getMetadata(id),get:async id=>{heavy++;return b.get(id);},markSynced:(...x)=>b.markSynced(...x)};const client={save:async()=>{requests++;return {id:w.id,revision:2,updatedAt:stamp};}};const sync=createCloudSync(wrapper,client);assert.equal((await sync.sync(w.id)).state,'synced');assert.equal(heavy,0);assert.equal(requests,0);await a.put(advance(w,10).world,1);await sync.sync(w.id);assert.equal(heavy,1);assert.equal(requests,1);}finally{a.close();b.close();}
});
function fresh(seed = 'STORAGE-05') {
  const w = createWorld(seed);
  w.id = randomUUID();
  return w;
}
function isConflict(error) { return error?.name === 'ConflictError'; }
async function withStore(kind, run) {
  if (kind === 'IndexedDB') globalThis.indexedDB = new IDBFactory();
  const store = kind === 'IndexedDB' ? await openWorldStore() : memoryWorldStore();
  try { await run(store); } finally { store.close(); }
}

for (const kind of ['memory', 'IndexedDB']) {
  test(`${kind}: cloud receipt and local revision are independent`, async () => withStore(kind, async store => {
    const w = fresh();
    assert.equal(await store.put(w, 0), 1);
    await store.markSynced(w.id, 1, 8, stamp);
    const saved = await store.get(w.id);
    assert.equal(saved.revision, 1);
    assert.equal(saved.cloud.revision, 8);
    assert.equal(saved.cloud.syncedRevision, 1);
    assert.equal(saved.cloud.updatedAt, stamp);
  }));

  test(`${kind}: next local step retains cloud CAS revision and previous snapshot`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    await store.markSynced(w.id, 1, 4, stamp);
    const later = advance(w, 10).world;
    assert.equal(await store.put(later, 1), 2);
    const row = await store.get(w.id);
    assert.equal(row.world.year, 10);
    assert.deepEqual(row.previous, w);
    assert.equal(row.cloud.revision, 4);
    assert.equal(row.cloud.syncedRevision, 1);
    assert.notEqual(row.cloud.syncedRevision, row.revision);
  }));

  test(`${kind}: acknowledgement of an old snapshot never marks a newer step clean`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    const later = advance(w, 10).world;
    await store.put(later, 1);
    await store.markSynced(w.id, 1, 1, stamp);
    const row = await store.get(w.id);
    assert.deepEqual(row.world, later);
    assert.equal(row.revision, 2);
    assert.equal(row.cloud.revision, 1);
    assert.equal(row.cloud.syncedRevision, 1);
  }));

  test(`${kind}: late cloud acknowledgement cannot regress metadata`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    await store.markSynced(w.id, 1, 1, stamp);
    await store.put(advance(w, 10).world, 1);
    await store.markSynced(w.id, 2, 2, stamp);
    try { await store.markSynced(w.id, 1, 1, stamp); } catch (error) { assert.ok(error instanceof Error); }
    const row = await store.get(w.id);
    assert.equal(row.cloud.revision, 2);
    assert.equal(row.cloud.syncedRevision, 2);
    assert.equal(row.world.year, 10);
  }));

  test(`${kind}: cloud load on a new device establishes a clean local record`, async () => withStore(kind, async store => {
    const w = advance(fresh(), 25).world;
    await store.receiveCloud(w, 7, stamp, 0);
    const row = await store.get(w.id);
    assert.deepEqual(row.world, w);
    assert.equal(row.cloud.revision, 7);
    assert.equal(row.cloud.syncedRevision, row.revision);
  }));

  test(`${kind}: a newer cloud revision may advance a clean local record`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.receiveCloud(w, 1, stamp, 0);
    const prior = await store.get(w.id);
    const later = advance(w, 20).world;
    await store.receiveCloud(later, 2, stamp, prior.revision);
    const row = await store.get(w.id);
    assert.deepEqual(row.world, later);
    assert.deepEqual(row.previous, w);
    assert.equal(row.cloud.revision, 2);
    assert.equal(row.cloud.syncedRevision, row.revision);
  }));

  test(`${kind}: cloud cannot overwrite an unsynchronised local history`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.receiveCloud(w, 1, stamp, 0);
    const initial = await store.get(w.id);
    await store.put(advance(w, 10).world, initial.revision);
    const before = await store.get(w.id);
    await assert.rejects(() => store.receiveCloud(advance(w, 30).world, 2, stamp, before.revision), isConflict);
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: matching cloud history can acknowledge an uncertain save`, async () => withStore(kind, async store => {
    const w = advance(fresh(), 10).world;
    await store.put(w, 0);
    const before = await store.get(w.id);
    await store.receiveCloud(clone(w), 3, stamp, before.revision);
    const row = await store.get(w.id);
    assert.deepEqual(row.world, w);
    assert.equal(row.cloud.revision, 3);
    assert.equal(row.cloud.syncedRevision, row.revision);
  }));

  test(`${kind}: cloud load also respects local compare-and-swap`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    await store.markSynced(w.id, 1, 1, stamp);
    await store.put(advance(w, 10).world, 1);
    const before = await store.get(w.id);
    await assert.rejects(() => store.receiveCloud(before.world, 2, stamp, 1), isConflict);
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: failed validation does not mutate an existing record`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    const broken = clone(w);
    broken.societies[0].population = -1;
    const before = await store.get(w.id);
    await assert.rejects(() => store.put(broken, 1));
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: a clean record still rejects a stale cloud revision`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.receiveCloud(advance(w, 20).world, 5, stamp, 0);
    const before = await store.get(w.id);
    await assert.rejects(() => store.receiveCloud(advance(w, 10).world, 4, stamp, before.revision), isConflict);
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: save cannot replace identity or move history backwards`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(advance(w, 10).world, 0);
    const before = await store.get(w.id);
    const changedSeed = clone(before.world); changedSeed.seed = 'OTHER-SEED';
    const changedEra = clone(before.world); changedEra.era = 'space';
    for (const next of [w, changedSeed, changedEra]) {
      await assert.rejects(() => store.put(next, before.revision));
      assert.deepEqual(await store.get(w.id), before);
    }
  }));

  test(`${kind}: v03 worlds cannot replace a v07 record through local or cloud writes`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    const before = await store.get(w.id);
    const old = createV03World(w.seed); old.id = w.id;
    await assert.rejects(() => store.put(old, before.revision));
    await assert.rejects(() => store.receiveCloud(old, 1, stamp, before.revision));
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: v04 worlds and invalid local revisions cannot replace a v07 checkpoint`, async () => withStore(kind, async store => {
    const w=fresh();await store.put(w,0);const before=await store.get(w.id);
    const old=createV04World(w.seed);old.id=w.id;
    await assert.rejects(()=>store.put(old,before.revision));
    await assert.rejects(()=>store.receiveCloud(old,1,stamp,before.revision));
    for(const revision of [NaN,Infinity,-1,1.1,Number.MAX_SAFE_INTEGER])await assert.rejects(()=>store.put(w,revision));
    assert.deepEqual(await store.get(w.id),before);
  }));
}

test('IndexedDB: stale second connection cannot overwrite the first connection', async () => {
  globalThis.indexedDB = new IDBFactory();
  const a = await openWorldStore(), b = await openWorldStore();
  try {
    const w = fresh();
    await a.put(w, 0);
    const stale = await b.get(w.id);
    await a.put(advance(w, 10).world, 1);
    await assert.rejects(() => b.put(advance(stale.world, 20).world, stale.revision), isConflict);
    assert.equal((await a.get(w.id)).world.year, 10);
    assert.equal((await b.get(w.id)).world.year, 10);
  } finally { a.close(); b.close(); }
});

test('IndexedDB: reopening preserves the world and cloud receipt', async () => {
  globalThis.indexedDB = new IDBFactory();
  const w = advance(fresh(), 20).world;
  const first = await openWorldStore();
  await first.put(w, 0);
  await first.markSynced(w.id, 1, 9, stamp);
  first.close();
  const reopened = await openWorldStore();
  try {
    const row = await reopened.get(w.id);
    assert.deepEqual(row.world, w);
    assert.equal(row.cloud.revision, 9);
    assert.equal(row.cloud.syncedRevision, row.revision);
    assert.ok((await reopened.list()).some(item => item.id === w.id));
  } finally { reopened.close(); }
});

test('v07 exports use an explicit new model and schema, preserving an exact round trip', async () => {
  const w = advance(fresh(), 10).world;
  const text = await encodeSave(w), envelope = JSON.parse(text);
  assert.equal(SCHEMA, 'microgalaxy.societies/1');
  assert.equal(MODEL_VERSION, '0.7.0');
  assert.equal(envelope.schema, SCHEMA);
  assert.equal(envelope.modelVersion, MODEL_VERSION);
  assert.deepEqual(await decodeSave(text), w);
});

test('v03 and v07 exports are rejected by the other model without modifying their original bytes', async () => {
  const old = createV03World('RETAIN-03'), current = fresh();
  const oldText = await encodeV03Save(old), currentText = await encodeSave(current);
  await assert.rejects(() => decodeSave(oldText));
  await assert.rejects(() => decodeV03Save(currentText));
  assert.deepEqual(await decodeV03Save(oldText), old);
  assert.deepEqual(await decodeSave(currentText), current);
});

test('relabelled v03 export still fails validation even with its correct original checksum', async () => {
  const envelope = JSON.parse(await encodeV03Save(createV03World('NOT-A-MIGRATION')));
  envelope.schema = SCHEMA;
  envelope.modelVersion = MODEL_VERSION;
  await assert.rejects(() => decodeSave(JSON.stringify(envelope)));
});

test('IndexedDB: v07 has a separate database and leaves v03 worlds and metadata unchanged', async () => {
  globalThis.indexedDB = new IDBFactory();
  const oldStore = await openV03Store();
  const old = createV03World('KEEP-OLD-DATABASE'); old.id = randomUUID();
  await oldStore.put(old, 0);
  await oldStore.markSynced(old.id, 1, 3, stamp);
  const before = await oldStore.get(old.id);
  const currentStore = await openWorldStore();
  try {
    assert.deepEqual(await currentStore.list(), []);
    assert.equal(await currentStore.get(old.id), undefined);
    const current = fresh(); current.id = old.id;
    await currentStore.put(current, 0);
    assert.deepEqual((await currentStore.get(old.id)).world, current);
    assert.deepEqual(await oldStore.get(old.id), before);
    const databases = await indexedDB.databases();
    assert.ok(databases.some(row => row.name === 'microgalaxy_societies_v07_v1'));
    assert.ok(databases.some(row => row.name === 'microgalaxy_local_candidate_v1'));
  } finally { oldStore.close(); currentStore.close(); }
});

test('v04 and v07 portable files keep their original engines without implicit conversion', async()=>{
  const old=createV04World('PRESERVE-04'),current=fresh();
  const oldText=await encodeV04Save(old),currentText=await encodeSave(current);
  await assert.rejects(()=>decodeSave(oldText));await assert.rejects(()=>decodeV04Save(currentText));
  assert.deepEqual(await decodeV04Save(oldText),old);assert.deepEqual(await decodeSave(currentText),current);
});

test('IndexedDB: a v07 save leaves same-ID v04 data, revisions and previous snapshots untouched',async()=>{
  globalThis.indexedDB=new IDBFactory();const oldStore=await openV04Store(),currentStore=await openWorldStore();
  try{const old=createV04World('PRESERVE-V04-DB');old.id=randomUUID();await oldStore.put(old,0);await oldStore.markSynced(old.id,1,5,stamp);
    const before=await oldStore.get(old.id);const current=fresh();current.id=old.id;
    await currentStore.put(current,0);assert.deepEqual(await oldStore.get(old.id),before);
    assert.notDeepEqual((await currentStore.get(old.id)).world,before.world);
    const databases=await indexedDB.databases();assert.ok(databases.some(row=>row.name==='microgalaxy_history_v04_v1'));assert.ok(databases.some(row=>row.name==='microgalaxy_societies_v07_v1'));
  }finally{oldStore.close();currentStore.close();}
});

test('the complete portable snapshot keeps the fixed24MiB budget, including its envelope',()=>{
  const tooLarge={data:'x'.repeat(MAX_FILE_BYTES)};const size=tooLarge.data.length;
  assert.throws(()=>ensureSaveSize(tooLarge),/24 МБ/);assert.equal(tooLarge.data.length,size);
  assert.equal(typeof ensureSaveSize(fresh()),'string');
});
