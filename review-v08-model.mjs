import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as C from './simulator-v08/src/core.mjs';
import * as E from './simulator-v08/src/economy.mjs';
import * as G from './simulator-v08/src/geography.mjs';
import * as A from './simulator-v08/src/archive.mjs';
import * as F from './simulator-v08/src/conflicts.mjs';
import * as S from './simulator-v08/src/societies.mjs';

const log=(name,data)=>console.log(JSON.stringify({name,...data}));
const hash=w=>createHash('sha256').update(JSON.stringify(w)).digest('hex');
function war(w,a,b,goal='territory') {
  const c={id:'war'+w.nextEntity++,a,b,start:w.year,active:true,losses:0,originEventId:null,supportedBy:[]};
  F.start(w,c,()=>0);c.goal=goal;
  const event=A.appendEvent(w,{year:w.year,type:'conflict',title:'Начало конфликта',detail:'Independent review fixture',entityId:a,entityIds:[a,b],causes:[],important:true,causeEventIds:[]});
  c.originEventId=event.id;w.wars.push(c);return c;
}
function fixture(){
  for(let i=0;i<100;i++) {
    const w=C.advance(C.createWorld('review-v08-'+i),1).world;
    for(const a of w.societies)for(const b of w.societies) {
      if(a===b||a.population<1.4*b.population)continue;
      const front=F.fronts(w,a.id,b.id).find(([x,y])=>y.id!==b.capitalId&&G.transferRegion(structuredClone(w),y.id,a.id));
      if(front)return {w,a,b,front};
    }
  }
  throw Error('No fixture');
}
function acceptance(name,w,mutate){const bad=structuredClone(w);mutate(bad);try{C.validateWorld(bad);log(name,{accepted:true});}catch(e){log(name,{accepted:false,error:e.message});}}

if(process.argv.includes('--long')){
  for(const era of ['agriculture','industrial','space']) {
    const start=C.createWorld('review-v08-long-'+era,{era});
    const begin=Date.now();const y250=C.advance(start,250).world;
    const y1000=C.advance(y250,750).world;
    const one=C.advance(start,1000).world;
    assert.equal(hash(y1000),hash(one));
    assert.ok(y1000.snapshots.length<=64);
    assert.equal(C.allEvents(y1000).length,y1000.nextEvent-1);
    assert.equal(y1000.ledger.totalBefore+y1000.ledger.births-y1000.ledger.deaths,C.totalPopulation(y1000));
    for(const k of E.RESOURCES)assert.ok(Math.abs(y1000.economy.ledger.balance[k])<1e-5);
    for(const index of [0,Math.floor(y1000.snapshots.length/2),y1000.snapshots.length-1])C.validateWorld(C.viewSnapshot(y1000,index));
    log('long',{era,year250wars:y250.wars.length,year1000wars:y1000.wars.length,active:y1000.wars.filter(c=>c.active).length,goals:y1000.wars.map(c=>c.goal),outcomes:y1000.wars.map(c=>c.outcome),events:y1000.nextEvent-1,bytes:Buffer.byteLength(JSON.stringify(y1000)),snapshots:y1000.snapshots.length,ms:Date.now()-begin});
  }
  process.exit(0);
}

const {w,a,b,front}=fixture();const c=war(w,a.id,b.id);C.validateWorld(w);
log('fixture',{seed:w.seed,a:a.id,b:b.id,populations:[a.population,b.population],front:front.map(r=>r.id)});
for(const [name,change] of [
  ['invalid current owner',x=>x.regions[0].owner='absent'],
  ['invalid historic owner',x=>x.snapshots[0].regions[0].owner='absent'],
  ['invalid capital',x=>x.societies[0].capitalId=x.regions.find(r=>r.owner!==x.societies[0].id).id],
  ['invalid force crossref',x=>{x.wars[0].forces.absent=x.wars[0].forces[a.id];delete x.wars[0].forces[a.id];}],
  ['invalid force magnitude',x=>x.wars[0].forces[a.id].mobilized=Number.MAX_SAFE_INTEGER],
  ['invalid war cause crossref',x=>x.wars[0].originEventId='e1'],
  ['invalid treaty cause crossref',x=>{x.relations[0].treaty={kind:'truce',since:0,eventId:'e1',duration:20};}],
  ['invalid archive event type',x=>x.events[0].type={bad:true}],
  ['missing archive event important',x=>delete x.events[0].important],
  ['invalid snapshot origin',x=>x.snapshots=[]],
])acceptance(name,w,change);

// Occupation must not silently reroute legal owner's freight or population through hostile control.
const occ=structuredClone(w);occ.year=2;const target=occ.regions.find(r=>r.id===front[1].id);target.occupation={warId:c.id,occupier:a.id,since:2};target.reconstruction=.2;
const friendly=occ.economy.routes.find(e=>[e.a,e.b].includes(target.id)&&occ.regions.find(r=>r.id===(e.a===target.id?e.b:e.a)).owner===target.owner);
assert.ok(friendly);
const neighbor=occ.regions.find(r=>r.id===(friendly.a===target.id?friendly.b:friendly.a));
const info=E.summary(occ).routes.find(e=>e.id===friendly.id);
log('occupied route',{occupied:target.id,legalOwner:target.owner,occupier:target.occupation.occupier,neighbor:neighbor.id,freightOpen:info.open,migrationRoute:G.routeBetweenRegions(occ,neighbor.id,target.id,{societyId:target.owner,allowForeign:false})});

// Combat can still hurt population with no equipment/food and no combat power.
const empty=structuredClone(w);for(const r of empty.regions){r.economy.stock.food=0;r.economy.stock.equipment=0;}
empty.year=1;F.step(empty,()=>{},()=>.9);log('empty armies',{forces:empty.wars[0].forces,losses:empty.wars[0].losses});

// Valid input with a fabricated impossible force passes the full strict validator.
const impossible=structuredClone(w);impossible.wars[0].forces[a.id].mobilized=Number.MAX_SAFE_INTEGER;
try {C.validateWorld(impossible);log('impossible force',{accepted:true,mobilized:impossible.wars[0].forces[a.id].mobilized,wholeWorldPopulation:C.totalPopulation(impossible)});}catch(e){log('impossible force',{accepted:false,error:e.message});}

// Explicitly force the accessible targeted occupation/peace state transitions and conservation.
const battle=structuredClone(w);battle.year=3;const popBefore=C.totalPopulation(battle);F.step(battle,()=>{},()=>0);
const occupied=battle.regions.find(r=>r.occupation);assert.ok(occupied);assert.equal(occupied.owner,b.id);
assert.equal(C.totalPopulation(battle),popBefore-battle.wars[0].losses);
battle.year=6;F.step(battle,()=>{},()=>0);assert.equal(occupied.owner,a.id);assert.equal(occupied.occupation,null);assert.equal(battle.wars[0].outcome,'concession');
E.sync(battle);E.close(battle);S.aggregate(battle);for(const k of E.RESOURCES)assert.ok(Math.abs(battle.economy.ledger.balance[k])<1e-5);
log('transition',{occupationDistinguished:true,concession:true,populationConserved:true,resourceBalance: battle.economy.ledger.balance});
