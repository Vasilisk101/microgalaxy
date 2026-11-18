import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld as rawWorld} from '../../simulator-v04/src/core.mjs';
import {initializeGeography,validateGeography,validateMovement,syncRegionalPopulations,syncSocietyPopulations,updateSettlements,regionalCapacity,regionAttractiveness,routeBetweenRegions,movePopulation,connectedTerritories,connectedSecession,transferRegion,geographySummary,regionSummary} from '../src/geography.mjs';

function world(seed='ТУЛА-71',era='agriculture') {const w=rawWorld(seed,{era});initializeGeography(w);return w;}
function network(owners,links) {
  const w=world(),template=structuredClone(w.societies[0]), region=structuredClone(w.regions[0]);
  w.societies=[...new Set(owners)].map(id=>({...structuredClone(template),id,capitalId:'r'+owners.indexOf(id),population:owners.filter(x=>x===id).length*1000}));
  w.regions=owners.map((owner,i)=>({...structuredClone(region),id:'r'+i,owner,lat:0,lon:i*10,population:1000,settlement:{...structuredClone(region.settlement),id:'settlement:r'+i,name:'Центр '+i}}));
  w.geography={edges:links.map(([a,b,kind='land'])=>{const ids=['r'+a,'r'+b].sort();return {id:'g:'+ids.join(':'),a:ids[0],b:ids[1],kind,distance:100,cost:2};}),movements:[]};
  w.wars=[];w.relations=[];
  for(let i=0;i<w.societies.length;i++)for(let j=i+1;j<w.societies.length;j++)w.relations.push({a:w.societies[i].id,b:w.societies[j].id,trust:.8});
  return w;
}

test('geography generation is deterministic and preserves initial society totals',()=>{
  const raw=rawWorld('ТУЛА-71'),totals=raw.societies.map(s=>[s.id,s.population]);initializeGeography(raw);
  assert.deepEqual(raw,world());assert.deepEqual(raw.societies.map(s=>[s.id,s.population]),totals);assert.ok(validateGeography(raw));
});
test('generated sparse land/sea graph and all initial territories are connected',()=>{
  for(const seed of ['ТУЛА-71','A','B','C','побережья',...Array.from({length:15},(_,i)=>'GEO-'+i)]){
    const w=world(seed);assert.ok(validateGeography(w));assert.ok(w.geography.edges.length<=w.regions.length*4);
    assert.ok(w.geography.edges.length<w.regions.length*(w.regions.length-1)/2);
    for(const s of w.societies){assert.ok(connectedTerritories(w,s.id));assert.equal(w.regions.find(r=>r.id===s.capitalId).owner,s.id);}
    assert.equal(w.regions.reduce((a,r)=>a+r.population,0),w.societies.reduce((a,s)=>a+s.population,0));
  }
});
test('terrain, coast, settlements and infrastructure are saved, finite and era-dependent',()=>{
  const early=world(),late=world('ТУЛА-71','industrial');
  assert.deepEqual(early.geography.edges,late.geography.edges);
  for(let i=0;i<early.regions.length;i++){
    const r=early.regions[i],s=late.regions[i];assert.ok(Number.isSafeInteger(r.population));assert.ok(r.settlement.name);
    assert.ok(s.settlement.infrastructure>r.settlement.infrastructure);assert.ok(regionalCapacity(early,r)>0);assert.ok(regionAttractiveness(early,r)>0);
  }
  assert.ok(early.geography.edges.some(e=>e.kind==='land'));assert.ok(early.geography.edges.some(e=>e.kind==='sea'));
});
test('population synchronization allocates only the exact aggregate delta',()=>{
  const w=network(['a','a','a'],[[0,1],[1,2]]),before=w.regions.map(r=>r.population);
  syncRegionalPopulations(w);assert.deepEqual(w.regions.map(r=>r.population),before);
  w.societies[0].population+=17;syncRegionalPopulations(w);assert.equal(w.regions.reduce((n,r)=>n+r.population,0),3017);
  assert.ok(w.regions.every(r=>r.population>=1000));
  w.societies[0].population=1;syncRegionalPopulations(w);assert.equal(w.regions.reduce((n,r)=>n+r.population,0),1);
  assert.ok(w.regions.every(r=>r.population>=0&&Number.isSafeInteger(r.population)));assert.equal(w.geography.movements.length,0);
  w.societies[0].population=0;syncRegionalPopulations(w);assert.ok(w.regions.every(r=>r.population===0));
  w.societies[0].population=10000;syncRegionalPopulations(w);assert.equal(w.regions.reduce((n,r)=>n+r.population,0),10000);
});
test('regional aggregation exactly follows ownership and does not count centres twice',()=>{
  const w=world();for(const r of w.regions)r.population=123;
  syncSocietyPopulations(w);assert.equal(w.societies.reduce((n,s)=>n+s.population,0),w.regions.length*123);
  assert.equal(geographySummary(w).population,w.regions.length*123);assert.ok(validateGeography(w));
});
test('international routes require friendly peaceful transit; internal routes stay in own land',()=>{
  const w=network(['a','b','c'],[[0,1],[1,2,'sea']]);
  assert.equal(routeBetweenRegions(w,'r0','r2'),null);
  let route=routeBetweenRegions(w,'r0','r2',{societyId:'a',allowForeign:true});
  assert.deepEqual(route.regions,['r0','r1','r2']);assert.equal(route.seaLegs,1);assert.equal(route.distance,200);
  w.relations.find(r=>r.a==='a'&&r.b==='b').trust=.3;
  assert.equal(routeBetweenRegions(w,'r0','r2',{societyId:'a',allowForeign:true}),null);
  w.relations.find(r=>r.a==='a'&&r.b==='b').trust=.8;w.wars.push({a:'a',b:'b',active:true});
  assert.equal(routeBetweenRegions(w,'r0','r2',{societyId:'a',allowForeign:true}),null);
  w.wars=[];w.geography.edges.pop();assert.equal(routeBetweenRegions(w,'r0','r2',{societyId:'a',allowForeign:true}),null);
});
test('route selection prefers lower travel cost, including infrastructure',()=>{
  const w=network(['a','a','a','a'],[[0,1],[1,3],[0,2],[2,3]]);
  w.geography.edges.find(e=>e.id==='g:r0:r1').cost=20;
  const path=routeBetweenRegions(w,'r0','r3');assert.deepEqual(path.regions,['r0','r2','r3']);
  const cost=path.cost;w.regions[2].settlement.infrastructure=.95;
  assert.ok(routeBetweenRegions(w,'r0','r3').cost<cost);
});
test('migration moves actual people, preserves totals and records the actual route',()=>{
  const w=network(['a','b','c'],[[0,1],[1,2]]),total=w.societies.reduce((n,s)=>n+s.population,0);
  assert.equal(movePopulation(w,'r0','r2',117,{path:['r0','r2']}),117);
  assert.equal(w.regions[0].population,883);assert.equal(w.regions[2].population,1117);
  assert.equal(w.societies[0].population,883);assert.equal(w.societies[2].population,1117);
  assert.equal(w.societies.reduce((n,s)=>n+s.population,0),total);
  assert.deepEqual(w.geography.movements[0].path,['r0','r1','r2']);assert.equal(w.geography.movements[0].people,117);assert.ok(validateGeography(w));
  const old=structuredClone(w);w.relations.find(r=>r.a==='a'&&r.b==='b').trust=.1;
  assert.equal(movePopulation(w,'r0','r2',100,{path:['r0','r2']}),0);assert.equal(w.regions[0].population,old.regions[0].population);
});
test('internal relocation leaves society totals unchanged and coalesces same annual path',()=>{
  const w=network(['a','a','a'],[[0,1],[1,2]]);
  assert.equal(movePopulation(w,'r0','r2',10),10);assert.equal(movePopulation(w,'r0','r2',20),20);
  assert.equal(w.societies[0].population,3000);assert.equal(w.geography.movements.length,1);assert.equal(w.geography.movements[0].people,30);
  assert.equal(geographySummary(w).internalMigrants,30);assert.equal(geographySummary(w).externalMigrants,0);assert.ok(validateGeography(w));
});
test('movement cannot exceed the source and never introduces fractional population',()=>{
  const w=network(['a','a'],[[0,1]]);assert.equal(movePopulation(w,'r0','r1',2000),1000);
  assert.equal(w.regions[0].population,0);assert.equal(w.regions[1].population,2000);assert.throws(()=>movePopulation(w,'r1','r0',.5));
});
test('secession is a connected region block without the capital and leaves a connected parent',()=>{
  for(const seed of ['ТУЛА-71','A','B','C','SECESSION']){
    const w=world(seed);
    for(const s of w.societies){const all=w.regions.filter(r=>r.owner===s.id).map(r=>r.id);if(all.length<3)continue;
      const chosen=connectedSecession(w,s.id);assert.ok(chosen.length>=1);assert.ok(!chosen.includes(s.capitalId));
      assert.ok(connectedTerritories(w,s.id,chosen));assert.ok(connectedTerritories(w,s.id,all.filter(id=>!chosen.includes(id))));
    }
  }
});
test('annexation cannot take a capital, a non-border region or a bridge splitting the loser',()=>{
  const w=network(['a','a','a','b','b'],[[0,1],[1,2],[1,3],[3,4]]);
  assert.equal(transferRegion(w,'r0','b'),false);assert.equal(transferRegion(w,'r2','b'),false);assert.equal(transferRegion(w,'r1','b'),false);
  assert.equal(w.regions[1].owner,'a');assert.ok(validateGeography(w));
});
test('valid border transfer moves its residents between societies without births or losses',()=>{
  const w=network(['a','a','a','b','b'],[[0,1],[1,2],[2,3],[3,4]]);
  const total=w.societies.reduce((n,s)=>n+s.population,0);
  assert.equal(transferRegion(w,'r2','b'),true);assert.equal(w.regions[2].population,1000);assert.equal(w.societies[0].population,2000);assert.equal(w.societies[1].population,3000);
  assert.equal(w.societies.reduce((n,s)=>n+s.population,0),total);assert.ok(validateGeography(w));
});
test('historical movement validation preserves the path after relations and borders change',()=>{
  const w=network(['a','a','b','b'],[[0,1],[1,2],[2,3]]);movePopulation(w,'r1','r3',30);
  const historical=structuredClone(w.geography.movements[0]);
  w.relations[0].trust=.1;assert.equal(transferRegion(w,'r1','b'),true);
  w.wars.push({a:'a',b:'b',active:true});w.year++;
  w.regions[2].settlement.infrastructure=.95;
  assert.ok(validateGeography(w));assert.equal(w.geography.movements[0].fromOwner,'a');assert.equal(w.regions[1].owner,'b');
  updateSettlements(w);assert.equal(w.geography.movements.length,0);
  assert.equal(routeBetweenRegions(w,'r0','r3',{societyId:'a',allowForeign:true}),null);
  assert.ok(validateMovement(w,historical));
});
test('standalone historical movement validation rejects malformed paths, references and counts',()=>{
  const w=network(['a','b','c'],[[0,1],[1,2]]);movePopulation(w,'r0','r2',7);
  const original=w.geography.movements[0];assert.ok(validateMovement(w,original));
  for(const mutate of [m=>m.year=w.year+1,m=>m.fromOwner='missing',m=>m.toOwner='missing',m=>m.people=.5,m=>m.people=0,m=>m.kind='internal',m=>m.path[1]='missing',m=>m.path=['r0','r2'],m=>m.edgeIds[0]='missing',m=>m.edgeIds.reverse(),m=>m.distance++,m=>m.cost=NaN]){
    const bad=structuredClone(original);mutate(bad);assert.throws(()=>validateMovement(w,bad));
  }
  assert.throws(()=>validateMovement(w,null));
});
test('standalone movement audit does not redundantly validate current population balances',()=>{
  const w=network(['a','a'],[[0,1]]);movePopulation(w,'r0','r1',10);
  const m=structuredClone(w.geography.movements[0]);w.regions[0].population++;
  assert.ok(validateMovement(w,m));assert.throws(()=>validateGeography(w));
});
test('settlement update is bounded and clears only movements from earlier years',()=>{
  const w=network(['a','a'],[[0,1]]);movePopulation(w,'r0','r1',5);updateSettlements(w);assert.equal(w.geography.movements.length,1);
  w.year++;updateSettlements(w);assert.equal(w.geography.movements.length,0);
  for(let i=0;i<10000;i++)updateSettlements(w);assert.ok(w.regions.every(r=>r.settlement.infrastructure<=.95));
});
test('geographic validation rejects corrupt references, population and movement paths',()=>{
  const w=world();
  for(const corrupt of [x=>x.regions[0].population+=1,x=>x.regions[0].settlement.infrastructure=2,x=>x.geography.edges[0].a='missing',x=>x.geography.edges.push({...x.geography.edges[0]}),x=>x.regions[0].elevation=NaN]){
    const bad=structuredClone(w);corrupt(bad);assert.throws(()=>validateGeography(bad));
  }
  const moved=network(['a','a','a'],[[0,1],[1,2]]);movePopulation(moved,'r0','r2',3);moved.geography.movements[0].path=['r0','r2'];assert.throws(()=>validateGeography(moved));
});
test('region and geographic summaries expose accurate data without mutating the model',()=>{
  const w=world(),before=JSON.stringify(w),r=w.regions[0],summary=regionSummary(w,r.id);
  assert.equal(summary.population,r.population);assert.equal(summary.name,r.settlement.name);assert.ok(summary.neighbors.length);assert.ok(summary.settlement.specializationLabel);
  summary.settlement.infrastructure=0;summary.neighbors.length=0;assert.equal(JSON.stringify(w),before);
  assert.equal(regionSummary(w,'missing'),null);assert.equal(geographySummary(w).regions,w.regions.length);
});
