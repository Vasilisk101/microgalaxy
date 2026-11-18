import test from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../src/core.mjs';
import * as Legacy from '../../simulator-v08/src/core.mjs';
import * as Economy from '../../simulator-v08/src/economy.mjs';
import * as Geography from '../../simulator-v08/src/geography.mjs';
import * as Space from '../src/space-world.mjs';

test('space manifests and both import accounts agree across departure, unloading and the next year', () => {
  let w,moon;
  for(let i=0;i<40&&!moon;i++){
    w=Core.createWorld('space-fixture-'+i,{era:'space'});
    moon=w.planets.find(p=>p.parentId===w.planets.find(home=>home.home).id);
  }
  assert.ok(moon);
  const r=w.regions.find(x=>x.population>500),soc=w.societies.find(x=>x.id===r.owner);
  const c={id:'c'+w.nextEntity++,name:'Луна',planet:moon.id,parent:soc.id,population:100,food:800,capacity:150,autonomy:1,independent:true,founded:0,losses:0};
  r.population-=100;soc.population-=100;w.colonies.push(c);
  const colony=Space.registerColony(w,c.id,{skills:['farming','rocketry','orbital'],raw:40,equipment:20});
  colony.connected=false;
  const flight=Space.launchReturn(w,c.id);
  assert.equal(flight.launched,true);
  Space.validate(w);
  w.year=flight.mission.arrival;Economy.step(w);Space.beforeSpace(w,Economy.importSupply);
  Economy.sync(w);Economy.close(w);Space.validate(w);
  const bad=structuredClone(w);bad.economy.ledger.externalIn.food++;bad.economy.cumulative.externalIn.food++;
  assert.throws(()=>Space.validate(bad),/внешнее поступление/);
  const missing=structuredClone(w);missing.observatory.space.returns=[];
  assert.throws(()=>Space.validate(missing),/рейс без записи/);
  w.year++;Economy.step(w);Space.validate(w);
  assert.equal(w.economy.ledger.externalIn.food,0);
  assert.equal(w.economy.cumulative.externalIn.food,flight.mission.cargo);
});

test('an experimental opening permits physical passage but preserves an embargo', () => {
  const w=Core.createWorld('passage-contract',{era:'industrial'});
  const border=w.economy.routes.find(e=>w.regions.find(r=>r.id===e.a).owner!==w.regions.find(r=>r.id===e.b).owner);
  w.year=1;
  w.observatory.experiment={role:'experimental',year:0,condition:{edge:border.id,mode:'open',until:2}};
  assert.equal(Geography.passageOpen(w,border.id),true);
  assert.equal(Economy.summary(w).routes.find(r=>r.id===border.id).open,false);
  w.observatory.experiment.condition.mode='closed';
  assert.equal(Geography.regionSummary(w,border.a).neighbors.find(r=>r.id===border.b).passageOpen,false);
  const travel=Geography.routeBetweenRegions(w,border.a,border.b,{allowForeign:true,ignoreRelations:true});
  assert.ok(!travel || !travel.edges.includes(border.id));
  w.year=3;
  assert.equal(Geography.passageOpen(w,border.id),true);
  const old=Legacy.createWorld('passage-contract');
  old.observatory=w.observatory;old.year=1;
  assert.equal(Geography.passageOpen(old,border.id),true);
});

test('a returning off-world food cargo is credited once, externally to local production', () => {
  const w=Core.createWorld('food-arrival',{era:'space'});
  const place=w.regions[0];
  w.year=1;
  Economy.step(w);
  const produced=w.economy.ledger.production.food, stored=place.economy.stock.food;
  w.missions.push({id:'m-test',kind:'return',status:'transit',arrival:1,originRegion:place.id,people:2,cargo:19.5});
  Space.beforeSpace(w,Economy.importSupply);Space.beforeSpace(w,Economy.importSupply);
  Economy.sync(w);Economy.close(w);
  assert.equal(place.economy.stock.food,stored+19.5);
  assert.equal(w.economy.ledger.production.food,produced);
  assert.equal(w.economy.cumulative.externalIn.food,19.5);
  assert.equal(Economy.summary(w).resources.food.externalIn,19.5);
  assert.doesNotThrow(()=>Economy.validate(w));
  w.economy.ledger.externalIn.food=0;
  assert.throws(()=>Economy.validate(w),/экономика/);
  const old=Legacy.createWorld('food-arrival');
  assert.equal(Object.hasOwn(old.economy.ledger,'externalIn'),false);
  assert.throws(()=>Economy.importSupply(old,'food',19.5),/поступление/);
});

test('local harvest is the measured regional production and sums to the planetary account',()=>{
  const initial=Core.createWorld('measured-harvest',{era:'industrial'});
  const w=Core.advance(initial,1).world;
  const total=w.regions.reduce((sum,r)=>sum+r.economy.harvest,0);
  assert.ok(total>0);assert.equal(total,w.economy.ledger.production.food);
  assert.equal(Object.hasOwn(initial.regions[0].economy,'harvest'),false);
  w.regions[0].economy.harvest+=100;
  assert.throws(()=>Economy.validate(w),/экономика/);
});
