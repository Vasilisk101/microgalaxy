import assert from 'node:assert/strict';
import test from 'node:test';
import * as Archive from '../../simulator-v08/src/archive.mjs';
import * as Core from '../../simulator-v08/src/core.mjs';
import * as Economy from '../../simulator-v08/src/economy.mjs';
import * as Geography from '../../simulator-v08/src/geography.mjs';
import * as Living from '../src/living-world.mjs';

function make(seed) {
  const w = Core.createWorld(seed, {era: 'industrial'});
  Living.initialize(w);
  return w;
}

// Use the real economy opening, production, charges and closing accounts.
// Tests control just the input region, river, or witness to isolate each condition.
function year(w) {
  w.year++;
  w.geography.movements = [];
  Living.beforeYear(w);
  Economy.step(w);
  Living.afterYear(w);
  Economy.sync(w);
  Economy.close(w);
  Economy.validate(w);
  Living.validate(w);
}

test('dry catchment has no engineering or invented river evidence and roundtrips', () => {
  const w = make('BASIN-6');
  for (let i = 0; i < 10; i++) year(w);
  const s = Living.summary(w);
  assert.equal(s.basin, null);
  assert.deepEqual(s.facts, []);
  assert.deepEqual(s.traces, []);
  const restored = JSON.parse(JSON.stringify(w));
  year(w); year(restored);
  assert.deepEqual(restored, w);
  assert.equal(Living.summary(Core.createWorld('old')).available, false);
});

test('paid work survives a funding gap and ownership change; dated traces never reveal the future', () => {
  const w = make('BASIN-3');
  const b = w.observatory.living.basin;
  const place = w.regions.find(r => r.id === b.upper);
  place.settlement.infrastructure = .85;
  place.settlement.specialization = 'agriculture';
  place.economy.stock.raw = 5000;
  place.economy.stock.equipment = 900;
  place.economy.stock.food = place.population * 20;
  year(w);
  const p = b.project;
  assert.equal(p.started, 1);
  assert.equal(p.spent.raw, 1.5);
  assert.ok(w.economy.ledger.construction.food >= p.spent.food);
  const previous = {labor: p.labor, spent: {...p.spent}};
  place.occupation = {occupier: 'test'};
  year(w);
  assert.equal(p.status, 'paused');
  assert.equal(p.labor, previous.labor);
  assert.deepEqual(p.spent, previous.spent);
  place.occupation = null;
  place.owner = w.societies.find(s => s.id !== p.founder).id;
  const reopened = JSON.parse(JSON.stringify(w));
  for (let i = 0; i < 40; i++) { year(w); year(reopened); }
  assert.deepEqual(w, reopened);
  assert.equal(p.status, 'completed');
  assert.notEqual(p.owner, p.founder);
  assert.equal(w.observatory.living.facts.filter(f => f.kind === 'ownership').length, 1);
  assert.equal(p.spent.food, p.yearsPaid * 9);
  assert.ok(Living.summary(w).traces.some(t => t.discovered));
  const past = Living.summary(w, 1);
  assert.equal(past.basin, null);
  assert.ok(past.traces.every(t => t.discovered === null && t.formed <= 1));
  assert.ok(past.facts.every(f => f.year <= 1));
  const altered = structuredClone(w);
  altered.observatory.living.basin.project.spent.raw += 1;
  assert.throws(() => Living.validate(altered), /затраты/);
});

test('a wet sediment-filled outlet diverts actual water and a quiet basin remains open', () => {
  const w = make('BASIN-0'), b = w.observatory.living.basin;
  const stable = structuredClone(w), stableBasin = stable.observatory.living.basin;
  const upper = w.regions.find(r => r.id === b.upper), lower = w.regions.find(r => r.id === b.lower);
  const alternate = w.regions.find(r => r.id === b.alternate);
  const previous = alternate.water;
  b.silt = .67;
  upper.water = .9;
  w.economy.routes.find(e => e.id === b.edge).used = 7;
  w.year++; stable.year++;
  Living.beforeYear(w); Living.beforeYear(stable);
  assert.equal(b.diverted, true);
  assert.ok(alternate.water > previous);
  assert.ok(lower.water < stable.regions.find(r => r.id === b.lower).water);
  assert.equal(stableBasin.diverted, false);
  assert.equal(Living.routeOpen(stable, stableBasin.edge), true);
  assert.equal(Living.routeOpen(w, b.edge), false);
  Economy.step(w); Living.afterYear(w); Economy.sync(w); Economy.close(w);
  const mark = Living.summary(w).traces.find(t => t.kind === 'старый берег');
  assert.ok(mark && mark.formed === 1);
  w.year++;
  Living.beforeYear(w); Economy.step(w); Living.afterYear(w); Economy.sync(w); Economy.close(w);
  assert.ok(!Living.summary(w).traces.some(t => t.id === mark.id));
  assert.ok(Living.summary(w, 1).traces.some(t => t.id === mark.id));
  assert.ok(Living.validate(w));
});

test('trade witnesses can agree; a migrated memory keeps the source, while an isolated region hears nothing', () => {
  const w = make('BASIN-6'), [a, b] = w.societies;
  w.year++;
  const entry = Archive.appendEvent(w, {type: 'diplomacy', title: 'Торговый договор', detail: 'Проверочный обмен.',
    entityId: a.id, entityIds: [a.id, b.id], important: true, causeEventIds: [], causes: []});
  Living.afterYear(w);
  let m = Living.summary(w).memories;
  assert.equal(m.length, 2);
  assert.equal(m[0].opinion, m[1].opinion);
  const to = w.regions.find(r => !m.some(x => x.site === r.id)).id;
  w.year++;
  w.geography.movements = [{from: a.capitalId, to, people: 100, year: w.year}];
  Living.afterYear(w);
  m = Living.summary(w).memories;
  assert.ok(m.some(x => x.fact === entry.id && x.site === to && x.origin === a.capitalId && x.via === 'переселение'));
  assert.equal(m.length, 3);
  const isolated = w.regions.find(r => !m.some(x => x.site === r.id));
  assert.ok(isolated);
  w.regions.find(r => r.id === to).population = 0;
  w.year++;
  w.geography.movements = [];
  Living.afterYear(w);
  assert.ok(!Living.summary(w).memories.some(x => x.site === to || x.site === isolated.id));
  assert.ok(Living.validate(w));
});

test('water must overtop the alternate outlet; two saved banks share an antimeridian-safe projection', () => {
  const w=make('BASIN-0'),b=w.observatory.living.basin;
  const upper=w.regions.find(r=>r.id===b.upper),lower=w.regions.find(r=>r.id===b.lower),alt=w.regions.find(r=>r.id===b.alternate);
  b.silt=.65;upper.water=.9;
  upper.lon=179;lower.lon=-179;alt.lon=175;upper.lat=5;lower.lat=4;alt.lat=4;
  const early=structuredClone(b);
  alt.elevation=.85;w.year=1;Living.beforeYear(w);assert.equal(b.diverted,false);
  alt.elevation=.01;w.year=2;Living.beforeYear(w);assert.equal(b.diverted,true);
  const map=Living.placeMap(w,b.upper,b,early);
  assert.equal(map.current.to,b.alternate);assert.equal(map.previous.to,b.lower);
  const at=id=>map.points.find(p=>p.id===id);
  assert.ok(at(b.lower).x>at(b.upper).x && at(b.alternate).x<at(b.upper).x);
  const dry=make('BASIN-6');
  assert.equal(Living.placeMap(dry,dry.regions[0].id,null).current,null);
});

test('a delayed cargo carries no account until it actually arrives', () => {
  const w = make('BASIN-6'), [a,b] = w.societies;
  w.year = 1;
  Archive.appendEvent(w, {type:'diplomacy',title:'Торговый договор',detail:'Датированный договор.',entityId:a.id,
    entityIds:[a.id,b.id],important:true,causeEventIds:[],causes:[]});
  Living.afterYear(w);
  const path = w.economy.routes.find(e => e.kind==='land' && [e.a,e.b].includes(a.capitalId) &&
    [e.a,e.b].every(id=>w.regions.find(r=>r.id===id).owner===a.id));
  assert.ok(path);
  const destination=path.a===a.capitalId?path.b:path.a;
  w.economy.shipments.push({id:'cargo'+w.economy.nextShipment++,route:path.id,path:[path.id],
    from:a.capitalId,to:destination,resource:'food',amount:120,departure:1,arrival:2,lossRate:.01,status:'transit'});
  const closed = structuredClone(w);
  closed.economy.routes.find(e=>e.id===path.id).condition=.01;
  year(w); year(closed);
  assert.ok(Living.summary(w).memories.some(m=>m.site===destination&&m.via==='обмен'&&m.from===a.capitalId));
  assert.ok(!Living.summary(closed).memories.some(m=>m.site===destination));
  assert.ok(closed.economy.shipments.some(s=>s.id==='cargo1'&&s.status==='waiting'));
});

test('persistent low water harms vegetation after two dry years, wet biomes regrow at different rates',()=>{
  const w=make('BASIN-0'),b=w.observatory.living.basin,at=w.regions.find(r=>r.id===b.upper);
  at.biomass=.55;at.population=0;at.biome='forest';at.water=.35;
  for(let year=1;year<=3;year++){
    w.year=year;Living.beforeYear(w);
    assert.equal(b.ecology[at.id].dryYears,year);
    assert.equal(b.ecology[at.id].vegetationChange<0,year===3);
  }
  at.water=.8;
  const tundra=structuredClone(w),cold=tundra.regions.find(r=>r.id===at.id);cold.biome='tundra';
  w.year++;tundra.year++;Living.beforeYear(w);Living.beforeYear(tundra);
  assert.equal(b.ecology[at.id].dryYears,0);
  assert.ok(at.biomass>cold.biomass);
  assert.ok(tundra.observatory.living.basin.ecology[at.id].vegetationChange>0);
});

test('a thousand years of river records and oral evidence fit a small part of a portable save', () => {
  const w = make('BASIN-16');
  for (let i=0;i<1000;i++) year(w);
  assert.ok(Buffer.byteLength(JSON.stringify(w.observatory.living)) < 100_000);
  assert.ok(w.observatory.living.memories.length <= w.regions.length * 4);
  assert.equal(Living.validate(JSON.parse(JSON.stringify(w))),true);
});

test('a migrated tradition retains intermediate witnesses, then its road name can outlive its origin story',()=>{
  const w=make('BASIN-6'),[a,b]=w.societies;
  const from=w.regions.find(r=>r.id===a.capitalId);
  const [middle,end]=w.regions.filter(r=>r.owner===a.id&&r.id!==from.id);
  w.year=1;
  const event=Archive.appendEvent(w,{type:'diplomacy',title:'Торговый договор',detail:'Обмен',entityId:a.id,entityIds:[a.id,b.id],important:true,causeEventIds:[],causes:[]});
  Living.afterYear(w);
  for(const [origin,to] of [[from,middle],[middle,end]]){
    w.year++;
    const moved=Geography.movePopulation(w,origin.id,to.id,Math.floor(origin.population*.4));
    assert.ok(moved>0);Living.afterYear(w);
  }
  const account=()=>Living.summary(w).memories.find(m=>m.site===end.id&&m.fact===event.id);
  assert.deepEqual(account().handovers.map(h=>h[0]),[from.id,middle.id,end.id]);
  const skill=a.knowledge.find(k=>k.id==='records');skill.active=true;end.social.access=.9;
  for(let i=0;i<40;i++){w.year++;Living.afterYear(w);}
  const road=Living.summary(w).roadNames.find(n=>n.site===end.id);
  assert.equal(road.origin,from.id);
  assert.equal(Living.summary(w,2).roadNames.length,0);
  end.population=1;skill.active=false;
  for(let i=0;i<2;i++){w.year++;Living.afterYear(w);}
  assert.equal(account(),undefined);
  const survivor=Living.summary(w).roadNames.find(n=>n.site===end.id);
  assert.equal(survivor.name,road.name);
  assert.equal(survivor.origin,null);assert.equal(survivor.fact,null);
  assert.equal(Living.validate(w),true);
});
