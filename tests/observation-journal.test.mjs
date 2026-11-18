import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {WORLD_MODELS} from '../lib/world-models.mjs';
import {readModelCatalog} from '../lib/local-retention.mjs';
import {createWorld,advance,validateWorld} from '../simulator-v08/src/core.mjs';
import {openWorldStore,digest,createSaveCodec} from '../simulator-v08/src/storage.mjs';
import {readLocal,writeLocal,exportJournal,importJournal} from '../simulator-v08/src/observation-journal.mjs';
import * as V1 from '../simulator-v1/src/core.mjs';

test('observer sidecar reopens the recorded shipment and place only for the same simulation and saved revision',async()=>{
  globalThis.indexedDB=new IDBFactory();
  const store=await openWorldStore(),dbName=WORLD_MODELS.v08.db;
  try{
    let w=createWorld('freight-test');
    while(!w.economy.shipments.length&&w.year<60)w=advance(w,1).world;
    w.id='local-00000000-0000-4000-8000-000000000001';
    const sh=w.economy.shipments[0],state={place:{type:'region',id:sh.from},freight:{
      id:sh.id,worldId:w.id,started:w.year,lastYear:w.year,shipment:sh,
      records:[{year:w.year,kind:'observed',status:sh.status,amount:sh.amount,arrival:sh.arrival,receiverStock:0}],
    }};
    assert.equal(await store.put(w,0),1);
    await writeLocal(w,1,state,dbName);
    assert.deepEqual(await readLocal(w,1,dbName),state);
    assert.equal((await store.list()).length,1);
    assert.equal((await readModelCatalog('v08')).rows.length,1);
    const next=advance(w,1).world;
    assert.equal(await store.put(next,1),2);
    assert.equal(await readLocal(next,2,dbName),null);
    await assert.rejects(writeLocal(w,1,state,dbName),/ревизия изменилась/);
    await writeLocal(next,2,{...state,place:null},dbName);
    assert.deepEqual(await readLocal(w,1,dbName),state);
    const text=await exportJournal(w,1,state,digest);
    const imported={...w,id:'different-local-id'};
    assert.deepEqual(await importJournal(imported,text,digest),state);
    await assert.rejects(importJournal(next,text,digest));
    await assert.rejects(importJournal({...w,seed:'different'},text,digest));
    const change=JSON.parse(text);change.payload.state.freight.records[0].amount++;
    await assert.rejects(importJournal(w,JSON.stringify(change),digest));
    assert.doesNotThrow(()=>validateWorld(w));
  } finally {await store.releaseWorld?.('local-00000000-0000-4000-8000-000000000001');store.close();}
});

test('v1 portable archives check object payloads and still open earlier string payloads losslessly',async()=>{
  const codec=createSaveCodec(V1.SCHEMA,V1.MODEL_VERSION,V1.validateWorld),w=V1.createWorld('PORTABLE-V1');
  const text=await codec.encode(w), envelope=JSON.parse(text);
  assert.equal(typeof envelope.payload,'object');assert.deepEqual(await codec.decode(text),w);
  const old={...envelope,payload:JSON.stringify(w)};
  assert.deepEqual(await codec.decode(JSON.stringify(old)),w);
  envelope.payload.year++;await assert.rejects(codec.decode(JSON.stringify(envelope)),/сумма/);
  assert.ok(Buffer.byteLength(text)<Buffer.byteLength(JSON.stringify(old)));
});
