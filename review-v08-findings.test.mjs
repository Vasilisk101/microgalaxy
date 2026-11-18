// Independent reviewer acceptance tests. Red tests describe the required repair,
// not implementation parity. No production I/O or application implementation edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from './simulator-v08/src/core.mjs';
import * as E from './simulator-v08/src/economy.mjs';
import * as A from './simulator-v08/src/archive.mjs';
import * as F from './simulator-v08/src/conflicts.mjs';
import * as G from './simulator-v08/src/geography.mjs';

function addWar(w,a,b) {
  const c={id:'war'+w.nextEntity++,a,b,start:w.year,active:true,losses:0,originEventId:null,supportedBy:[]};
  F.start(w,c,()=>0);
  c.originEventId=A.appendEvent(w,{year:w.year,type:'conflict',title:'Начало конфликта',detail:'Independent review fixture',entityId:a,entityIds:[a,b],causes:[],important:true,causeEventIds:[]}).id;
  w.wars.push(c);return c;
}
function occupiedFixture(era='agriculture') {
  const seed=era==='space'?'review-space-funding':'review-v08-0';
  const w=C.advance(C.createWorld(seed,{era}),1).world;
  let pair;
  for(const a of w.societies)for(const b of w.societies)if(a!==b&&!pair)pair=F.fronts(w,a.id,b.id).find(([,y])=>y.id!==b.capitalId);
  assert.ok(pair);
  const [source,target]=pair,c=addWar(w,source.owner,target.owner);
  target.occupation={warId:c.id,occupier:source.owner,since:w.year};target.reconstruction=.2;
  C.validateWorld(w);return {w,c,target};
}

test('P1: missing origin snapshot is rejected at import, not on the next checkpoint',()=>{
  const w=C.advance(C.createWorld('review-archive-adversary'),50).world;
  w.snapshots.shift();
  assert.throws(()=>C.validateWorld(w),/контрольная|исходн|срез|snapshot/i);
});

test('P1 supporting trace: currently accepted missing origin crashes continuation',()=>{
  const w=C.advance(C.createWorld('review-archive-adversary'),50).world;
  w.snapshots.shift();
  // This trace is expected to be replaced by import rejection after the fix.
  if(!(()=>{try {C.validateWorld(w);return true;}catch{return false;}})())return;
  assert.throws(()=>C.advance(w,25),/исходной контрольной точки/);
});

test('P1: invalid historic mission owner is rejected instead of overwritten during validation',()=>{
  const w=C.advance(C.createWorld('review-archive-adversary'),25).world;
  w.snapshots[1].missions=[{id:'m99999',owner:'absent',status:'transit',people:-100}];
  assert.throws(()=>C.validateWorld(w));
});

test('P1: historic missions must be an array even if canonical missions can be reconstructed',()=>{
  const w=C.advance(C.createWorld('review-archive-adversary'),25).world;
  w.snapshots[1].missions='garbage';assert.throws(()=>C.validateWorld(w));
});

test('P1: occupied resources cannot finance a satellite without the actual material debit',()=>{
  const {w,target}=occupiedFixture('space'),s=w.societies.find(z=>z.id===target.owner);
  for(const r of w.regions)if(r.owner===s.id){r.economy.stock.raw=r.id===target.id?1000:0;r.reserves=0;r.economy.stock.food=r.population*5;}
  s.satellite=false;s.lastLaunch=-50;E.sync(w);
  // Inventories form a synthetic but coherent imported state, not a fake credit
  // injected during the tested annual step. Rebase the opening ledger accordingly.
  for(const k of E.RESOURCES){const old=w.economy.ledger.closing[k],now=w.regions.reduce((n,r)=>n+r.economy.stock[k],0);w.economy.ledger.opening[k]+=now-old;}
  E.close(w);C.validateWorld(w);
  const after=C.advance(w,1).world,ns=after.societies.find(z=>z.id===s.id);
  const launch=C.allEvents(after).find(e=>e.year===2&&e.entityId===s.id&&e.title==='Первый искусственный спутник');
  if(ns.satellite)assert.ok(after.economy.ledger.consumption.raw>=25,`Launched with total WORLD raw consumption only ${after.economy.ledger.consumption.raw}; event ${JSON.stringify(launch)}`);
});

test('P1: hostile occupation closes legal-owner freight and ordinary migration access',()=>{
  const w=C.advance(C.createWorld('review-v08-0'),1).world,c=addWar(w,'s0','s3');
  const target=w.regions.find(r=>r.id==='r13');target.occupation={warId:c.id,occupier:'s0',since:w.year};target.reconstruction=.2;C.validateWorld(w);
  assert.equal(E.summary(w).routes.find(e=>e.id==='g:r13:r24').open,false);
  assert.equal(G.routeBetweenRegions(w,'r24','r13',{societyId:'s3',allowForeign:false}),null);
});

test('P2: impossible force magnitude is rejected',()=>{
  const w=C.advance(C.createWorld('review-v08-0'),1).world,c=addWar(w,'s0','s3');
  c.forces.s0.mobilized=Number.MAX_SAFE_INTEGER;assert.throws(()=>C.validateWorld(w));
});

test('P2: treaty cause cannot point to unrelated origin event',()=>{
  const w=C.createWorld('review-treaty');w.relations[0].treaty={kind:'truce',since:0,eventId:'e1',duration:20};
  assert.throws(()=>C.validateWorld(w));
});

test('P2: event type, importance and cause value shapes are strict',()=>{
  for(const change of [w=>w.events[0].type={bad:true},w=>delete w.events[0].important,w=>w.events[0].causes=[{label:{bad:1},value:{bad:2}}]]) {
    const w=structuredClone(C.createWorld('review-event-shape'));change(w);assert.throws(()=>C.validateWorld(w));
  }
});
