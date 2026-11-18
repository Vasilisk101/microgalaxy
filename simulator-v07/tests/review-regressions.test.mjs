import test from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../src/core.mjs';
import * as Economy from '../src/economy.mjs';
import * as Knowledge from '../src/knowledge.mjs';
import * as Societies from '../src/societies.mjs';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const disable=(world,ids)=>{for(const society of world.societies){for(const id of ids)society.knowledge.find(node=>node.id===id).active=false;Knowledge.derive(society);}};

test('early development funds only two selected branches and debits the real ledger',()=>{
  const world=Core.createWorld('bounded-research'),society=world.societies[0];
  const required=Math.max(.015,society.population*.000002);
  const initial=Economy.summary(world).resources;
  Knowledge.step(world,society,()=>{throw Error('a fresh branch cannot complete in one year');});
  assert.equal(society.knowledge.filter(node=>!node.active&&node.progress>0).length,2);
  const maintenance=world.economy.ledger.maintenance;
  close(maintenance.energy,required*7);close(maintenance.equipment,required*7*.25);
  Economy.close(world);Economy.validate(world);
  const final=Economy.summary(world).resources;
  assert.ok(Math.abs(initial.energy.stock-final.energy.stock-maintenance.energy)<1e-8);
  assert.ok(Math.abs(initial.equipment.stock-final.equipment.stock-maintenance.equipment)<1e-8);
});

test('capabilities change real food, equipment, road capacity and representation',()=>{
  const high=Core.createWorld('effects',{era:'industrial'}),low=structuredClone(high);
  disable(low,['irrigation','industry','roads','regional_councils','coordination']);
  const road=Economy.summary(high).routes.find(route=>route.kind==='land');
  close(road.effectiveCapacity/Economy.summary(low).routes.find(route=>route.id===road.id).effectiveCapacity,1/.7);
  Societies.step(high);Societies.step(low);
  close(high.regions[0].social.representation-low.regions[0].social.representation,.15);
  for(const world of [high,low]){
    for(const region of world.regions){region.economy.stock.raw=10000;region.economy.stock.energy=10000;}
    world.year=1;Economy.step(world);Economy.validate(world);
    assert.ok(Math.abs(world.societies.reduce((sum,society)=>sum+society.production,0)-world.economy.ledger.production.food)<1e-7);
  }
  close(high.economy.ledger.production.food/low.economy.ledger.production.food,1.18);
  close(high.economy.ledger.production.equipment/low.economy.ledger.production.equipment,1.4);
  for(const society of high.societies)close(society.production/low.societies.find(item=>item.id===society.id).production,1.18);
});

test('orbital and settlement capabilities gate actual launches',()=>{
  let high=Core.createWorld('gates',{era:'space'}),low=structuredClone(high);
  disable(low,['orbital','settlement']);
  assert.ok(Core.advance(high,1).world.societies.some(s=>s.satellite));
  assert.equal(Core.advance(low,1).world.societies.some(s=>s.satellite),false);
  high=Core.createWorld('gates',{era:'space'});
  for(const s of high.societies){s.satellite=true;s.minerals=1000;s.probed=high.planets.filter(p=>!p.home&&p.kind!=='gas').map(p=>p.id);}
  Economy.initialize(high);low=structuredClone(high);disable(low,['settlement']);
  assert.ok(Core.advance(high,1).world.missions.some(m=>m.kind==='colony'));
  assert.equal(Core.advance(low,1).world.missions.some(m=>m.kind==='colony'),false);
});

test('only actual delivered freight mixes cultures and increases trade',()=>{
  const initial=Core.createWorld('delivered-contact',{era:'industrial'});
  const edge=initial.economy.routes.find(e=>initial.regions.find(r=>r.id===e.a).owner!==initial.regions.find(r=>r.id===e.b).owner);
  const src=initial.regions.find(r=>r.id===edge.a),dst=initial.regions.find(r=>r.id===edge.b);
  const relation=initial.relations.find(r=>[r.a,r.b].includes(src.owner)&&[r.a,r.b].includes(dst.owner));
  relation.treaty={kind:'trade',since:0,eventId:'e1'};src.culture.exchange=1;dst.culture.exchange=0;
  initial.economy.shipments=[{id:'cargo1',route:edge.id,path:[edge.id],from:src.id,to:dst.id,resource:'food',amount:40,departure:0,arrival:2,lossRate:.1,status:'transit'}];
  initial.economy.nextShipment=2;src.economy.stock.food-=40;
  for(const [year,closed,expected] of [[1,false,0],[2,false,36],[2,true,0]]){
    const world=structuredClone(initial);world.year=year;
    const rel=world.relations.find(r=>r.a===relation.a&&r.b===relation.b);
    if(closed)rel.treaty=null;
    Economy.step(world);Economy.validate(world);
    const target=world.regions.find(r=>r.id===dst.id);
    assert.equal(target.social.delivered,expected);assert.equal(rel.trade,expected);
    assert.equal(target.culture.exchange>0,expected>0);
    assert.equal(world.economy.shipments.some(shipment=>shipment.id==='cargo1'),expected===0);
  }
});
