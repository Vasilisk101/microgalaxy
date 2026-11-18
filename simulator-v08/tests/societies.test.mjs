import test from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../src/core.mjs';
import * as Knowledge from '../src/knowledge.mjs';
import * as Societies from '../src/societies.mjs';
import * as Economy from '../src/economy.mjs';
import * as Archive from '../src/archive.mjs';

test('same seed and epoch give reproducible worlds and valid public summaries',()=>{
  const a=Core.createWorld('fixture',{era:'industrial'}),b=Core.createWorld('fixture',{era:'industrial'});assert.deepEqual(a,b);
  const d=Core.societyDevelopmentSummary(a,'s0');assert.equal(d.knowledge.nodes.length,14);assert.ok(d.regions.length);assert.equal(d.groups.length,4);assert.ok(d.knowledge.edges.length);
  const x=Core.advance(a,50).world,y=Core.advance(b,50).world;assert.deepEqual(x,y);Core.validateWorld(x);
});
test('regional setting changes interests and actual mobility and migration mixes cultures',()=>{
  const a=Core.createWorld('regional'),b=structuredClone(a),r=b.regions.find(x=>x.owner==='s0'),src=b.regions.find(x=>x.owner!=='s0');
  for(const e of b.economy.routes)if(e.a===r.id||e.b===r.id)e.condition=.1;
  Societies.step(a);Societies.step(b);assert.notEqual(r.social.cohesion,a.regions.find(x=>x.id===r.id).social.cohesion);
  const before=r.culture.exchange;src.culture.exchange=before>.5?0:1;Societies.mix(src,r,r.population/4);assert.notEqual(r.culture.exchange,before);
  Societies.aggregate(b);Core.validateWorld(b);
});
test('contrasting regional economies produce different annual development histories',()=>{
  function run(kind){let w=Core.createWorld('paths-0');for(const r of w.regions.filter(r=>r.owner==='s0')){r.settlement.specialization=kind==='rural'?'agriculture':'crafts';r.culture.exchange=kind==='rural'?.1:.9;r.culture.autonomy=kind==='rural'?.9:.1;}Societies.aggregate(w);w.societies[0].politics.policy=kind==='rural'?'food':'trade';w=Core.advance(w,500).world;Core.validateWorld(w);return Core.allEvents(w).filter(e=>e.entityId==='s0'&&e.type==='science'&&e.title==='Освоена способность').map(e=>e.detail);}
  const rural=run('rural'),trade=run('trade');assert.ok(rural.length&&trade.length);assert.match(rural[0],/Орошение/);assert.match(trade[0],/Содержание путей/);assert.notEqual(rural[0],trade[0]);
});
test('resource crisis causes capability cascade; retained memory restores the graph',()=>{
  const w=Core.createWorld('crisis',{era:'space'}),s=w.societies[0],land=w.regions.filter(r=>r.owner===s.id);s.supply=.4;
  const gained=[];for(let year=1;year<=8;year++){w.year=year;Knowledge.step(w,s,(_s,n,kind)=>{gained.push([n.id,kind]);return null;});}
  assert.equal(Knowledge.has(s,'orbital'),false);assert.equal(s.knowledge.find(n=>n.id==='orbital').memory,1);assert.ok(gained.some(([id,k])=>id==='rocketry'&&k==='lost'));
  const low=s.tech[1];s.supply=1;s.stability=.9;for(const r of land){r.economy.stock.energy+=1e6;r.economy.stock.equipment+=1e6;}
  for(let i=0;i<1600&&!Knowledge.has(s,'orbital');i++){w.year++;Knowledge.step(w,s,()=>null);}
  assert.ok(Knowledge.has(s,'orbital'));assert.ok(s.tech[1]>low);assert.ok(w.economy.ledger.maintenance.energy>0);assert.ok(w.economy.ledger.maintenance.equipment>0);
});
test('invalid prerequisites, trait weights, history and snapshot counters are rejected',()=>{
  const w=Core.advance(Core.createWorld('validation',{era:'space'}),30).world;
  let b=structuredClone(w);b.societies[0].knowledge.find(n=>n.id==='industry').active=false;assert.throws(()=>Core.validateWorld(b));
  b=structuredClone(w);b.regions[0].culture.exchange=2;assert.throws(()=>Core.validateWorld(b));
  b=structuredClone(w);b.societies[0].culture.autonomy=.999;assert.throws(()=>Core.validateWorld(b));
  b=structuredClone(w);b.history.at(-1).year=w.year+1;assert.throws(()=>Core.validateWorld(b));
  b=structuredClone(w);delete b.snapshots[0].societies[0].knowledge;assert.throws(()=>Core.validateWorld(b));
  b=structuredClone(w);b.snapshots[0].nextEntity=w.nextEntity+1;assert.throws(()=>Core.validateWorld(b));
});

test('annual-step fields are required and validated in current and historical states',()=>{
  const initial=Core.createWorld('annual-fields',{era:'space'});
  const mutations=[
    w=>delete w.societies[0].divergence,
    w=>delete w.societies[0].unrestYears,
    w=>delete w.societies[0].lastLaunch,
    w=>delete w.societies[0].satellite,
    w=>w.societies[0].foundingYear=w.year+1,
    w=>w.societies[0].lastReform=w.year+1,
    w=>w.societies[0].parentId=w.societies[0].id,
    w=>w.societies[0].leader.name={bad:true},
    w=>delete w.regions[0].disasterUntil,
    w=>w.regions[0].stress=-1,
    w=>delete w.ledger.births,
    w=>w.ledger.totalAfter++,
  ];
  for(const mutation of mutations)for(const historical of [false,true]){
    const world=structuredClone(initial);mutation(historical?world.snapshots[0]:world);
    assert.throws(()=>Core.validateWorld(world));
  }
  for(const mutation of [w=>delete w.star.temperature,w=>delete w.planets[0].phase,w=>delete w.planets[0].home]){
    const world=structuredClone(initial);mutation(world);assert.throws(()=>Core.validateWorld(world));
  }
  assert.equal(Core.advance(initial,1).advanced,1);
});

test('knowledge memory references its actual event, node, year and originating lineage',()=>{
  const world=Core.createWorld('knowledge-provenance'),s=world.societies[0];world.year=1;
  s.supply=.4;s.knowledge[0].neglect=7;
  Knowledge.step(world,s,(subject,node,kind,reason)=>Archive.appendEvent(world,{
    year:world.year,type:'science',title:kind==='lost'?'Утрачена способность':'Освоена способность',
    detail:`${subject.name}: ${node.name}. ${reason}.`,entityId:subject.id,entityIds:[subject.id],causes:[],causeEventIds:[],important:true,
  }).id);
  Economy.sync(world);Economy.close(world);Core.validateWorld(world);
  const lost=s.knowledge[0];assert.ok(lost.eventId);assert.equal(lost.active,false);
  for(const mutation of [
    w=>w.societies[0].knowledge[0].eventId='e1',
    w=>w.societies[0].knowledge[0].lastChange=0,
    w=>w.societies[0].knowledge[0].eventId=null,
    w=>w.societies[0].knowledge[0].reason='Подменённая причина',
    w=>{const e={...w.events.at(-1)};e.detail=e.detail.replace('Земледельческие практики','Мастерские');w.events[w.events.length-1]=e;},
    w=>{const e={...w.events.at(-1)};e.entityId=w.societies[1].id;e.entityIds=[e.entityId];w.events[w.events.length-1]=e;},
  ]){const bad=structuredClone(world);mutation(bad);assert.throws(()=>Core.validateWorld(bad));}
  // A new polity may genuinely inherit its predecessor's remembered event.
  s.stability=.1;s.unrestYears=15;
  const successor=Core.advance(world,1).world;
  const child=successor.societies.find(item=>item.parentId===s.id);
  assert.ok(child,'fixture must exercise actual secession');
  assert.equal(child.knowledge[0].eventId,lost.eventId);Core.validateWorld(successor);
});
