import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as Core from '../src/core.mjs';
import * as Branches from '../src/branches.mjs';
import * as Storage from '../../simulator-v08/src/storage.mjs';
import {openRetentionDatabase,retentionStatus,setRetentionLimit} from '../../lib/local-retention.mjs';

function fresh(){const w=Core.createWorld('BASIN-16',{era:'industrial'});w.id=crypto.randomUUID();return w;}

test('identical branches replay the same world and record a zero comparison',async()=>{
  const parent=fresh(),original=structuredClone(parent);
  const pair=await Branches.comparePair(parent,{parentRevision:1,horizon:5},Core);
  assert.deepEqual(parent,original);
  assert.equal(new Set([parent.id,...pair.map(w=>w.id)]).size,3);
  const [a,b]=pair;
  assert.equal(a.observatory.experiment.peerId,b.id);
  assert.equal(b.observatory.experiment.peerId,a.id);
  for(const w of pair){
    assert.ok(Branches.validate(w));
    assert.equal(w.observatory.experiment.report.firstMovement,null);
    assert.equal(w.observatory.experiment.report.firstEconomy,null);
    assert.equal(w.observatory.experiment.report.samples.at(-1)[0],5);
    assert.match(w.id,/^[a-f0-9-]{36}$/);
  }
  assert.deepEqual(a.economy,b.economy);
  assert.deepEqual(a.societies,b.societies);
  assert.deepEqual(a.events,b.events);
  const restored=Core.advance(JSON.parse(JSON.stringify(a)),1).world;
  assert.deepEqual(restored,Core.advance(a,1).world);
  assert.equal(b.year,5);
});

test('an interrupted or invalid comparison leaves its parent and both original snapshots untouched',async()=>{
  const w=fresh(),saved=JSON.stringify(w);
  await assert.rejects(Branches.comparePair(w,{parentRevision:1,horizon:0},Core));
  await assert.rejects(Branches.comparePair(w,{parentRevision:1,horizon:9,condition:{edge:'missing',mode:'open',until:9}},Core));
  await assert.rejects(Branches.comparePair(w,{parentRevision:1,horizon:200},Core,()=>{throw Error('cancel');}),/cancel/);
  assert.equal(JSON.stringify(w),saved);
});

test('a real freight crossing and an unused intervention give different results',async()=>{
  const w=fresh();
  const second=Core.advance(w,2).world;
  const used=second.economy.routes.filter(e=>e.used>0).sort((a,b)=>b.used-a.used)[0];
  assert.ok(used);
  const [a,b]=await Branches.comparePair(w,{parentRevision:1,horizon:4,condition:{edge:used.id,mode:'closed',until:2}},Core);
  assert.equal(a.observatory.experiment.report.firstMovement.year,2);
  const freight=a.observatory.experiment.report.firstFreight;
  assert.equal(freight.year,2);assert.equal(freight.kind,'independent');
  assert.equal(freight.control.id,freight.experimental.id,'branch-local counters may coincide');
  assert.notEqual(freight.control.from,freight.experimental.from,'the coincident IDs are not one shipment');
  assert.notDeepEqual(freight.control.path,freight.experimental.path);
  assert.deepEqual(a.observatory.experiment.report,b.observatory.experiment.report);
  assert.equal(Branches.routeOverride({...b,year:1},used.id),false);
  assert.equal(Branches.routeOverride({...b,year:2},used.id),false);
  assert.equal(Branches.routeOverride({...b,year:3},used.id),null);
  assert.equal(Branches.routeOverride({...b,year:0},used.id),null);
  assert.equal(Branches.routeOverride({...a,year:1},used.id),null);
  await assert.rejects(Branches.comparePair(w,{parentRevision:1,horizon:1,condition:{edge:used.id,mode:'open',until:1}},Core),/неприменимо/);
  const [,quiet]=await Branches.comparePair(w,{parentRevision:1,horizon:1,observedEdge:used.id},Core);
  assert.equal(quiet.observatory.experiment.report.firstMovement,null);
  assert.equal(quiet.observatory.experiment.report.firstEconomy,null);
});

test('1.0.1 exposes only interventions applicable to the selected basin crossing',async()=>{
  const w=fresh(),b=w.observatory.living.basin;assert.ok(b);
  const other=w.geography.edges.find(e=>e.id!==b.edge);
  assert.deepEqual(Branches.conditionModes(w,other.id),['none','closed']);
  await assert.rejects(Branches.comparePair(w,{parentRevision:1,horizon:2,condition:{edge:other.id,mode:'open',until:2}},Core),/неприменимо/);
  b.blockedEdge=b.edge;assert.deepEqual(Branches.conditionModes(w,b.edge),['none','open']);
  await assert.rejects(Branches.comparePair(w,{parentRevision:1,horizon:2,condition:{edge:b.edge,mode:'closed',until:2}},Core),/неприменимо/);
  const pair=await Branches.comparePair(w,{parentRevision:1,horizon:2,condition:{edge:b.edge,mode:'open',until:2}},Core);
  assert.equal(pair.length,2);
  const same=await Branches.comparePair(w,{parentRevision:1,horizon:1},Core);assert.equal(same[0].observatory.experiment.report.firstFreight,null);
});

test('old reports without per-shipment records remain readable',async()=>{
  const [w]=await Branches.comparePair(fresh(),{parentRevision:1,horizon:2},Core);
  w.modelVersion='1.0.0';delete w.observatory.experiment.report.firstFreight;
  assert.equal(Branches.validate(w),true);assert.doesNotThrow(()=>Core.validateWorld(w));
});

test('a pair is atomic, parent-revision guarded and fits the combined local quota',async()=>{
  globalThis.indexedDB=new IDBFactory();
  const store=await Storage.openWorldStore({validate:Core.validateWorld});
  try{
    const w=fresh();await store.put(w,0);
    const pair=await Branches.comparePair(w,{parentRevision:1,horizon:2},Core);
    // A pre-existing second ID aborts the whole transaction, including metadata for the first ID.
    await store.put(pair[1],0);
    await assert.rejects(store.commitBranchPair(w.id,1,pair));
    assert.equal(await store.getMetadata(pair[0].id),undefined);
    assert.equal((await store.get(w.id)).revision,1);
    const freshPair=await Branches.comparePair(w,{parentRevision:1,horizon:2},Core);
    await setRetentionLimit(50*1048576);
    const db=await openRetentionDatabase('v08');
    try{
      const tx=db.transaction('retention','readwrite'),meta=tx.objectStore('retention'),req=meta.get(w.id);
      req.onsuccess=()=>meta.put({...req.result,bytes:50*1048576});
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    }finally{db.close();}
    await assert.rejects(store.commitBranchPair(w.id,1,freshPair),/свободного места/);
    assert.equal(await store.getMetadata(freshPair[0].id),undefined);
    assert.equal(await store.getMetadata(freshPair[1].id),undefined);
    assert.equal((await store.get(w.id)).revision,1);
    await setRetentionLimit(100*1048576);
    const saved=await store.commitBranchPair(w.id,1,freshPair);
    assert.deepEqual(saved.map(x=>x.id),freshPair.map(w=>w.id));
    assert.ok((await retentionStatus()).records.some(r=>r.id===saved[1].id));
    const stale=await Branches.comparePair(w,{parentRevision:1,horizon:1},Core);
    await store.put(Core.advance(w,1).world,1);
    await assert.rejects(store.commitBranchPair(w.id,1,stale),/другой вкладке/);
    assert.equal((await store.get(w.id)).year,1);
    assert.equal(await store.getMetadata(stale[0].id),undefined);
  }finally{store.close();}
});
