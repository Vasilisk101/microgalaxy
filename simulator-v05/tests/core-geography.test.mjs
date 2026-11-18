import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,advance,clone,validateWorld,totalPopulation,allEvents,allMissions,eventCount,eventPageCount,eventPage,viewSnapshot,geographySummary,regionSummary} from '../src/core.mjs';
import * as Geography from '../src/geography.mjs';
import * as Archive from '../src/archive.mjs';
import {encodeSave,decodeSave} from '../src/storage.mjs';

function balanced(w){
  for(const s of w.societies){assert.equal(w.regions.filter(r=>r.owner===s.id).reduce((n,r)=>n+r.population,0),s.population);assert.ok(Geography.connectedTerritories(w,s.id));assert.equal(w.regions.find(r=>r.id===s.capitalId).owner,s.id);}
  assert.equal(geographySummary(w).population,w.societies.reduce((n,s)=>n+s.population,0));
  assert.equal(totalPopulation(w),geographySummary(w).population+w.colonies.reduce((n,c)=>n+c.population,0)+w.missions.reduce((n,m)=>n+m.people,0));
}
function appendFixture(w,important=false){
  const e=Archive.appendEvent(w,{year:w.year,type:'politics',title:'Сценарная запись',detail:'Условие архивного теста.',entityId:null,entityIds:[],causes:[],causeEventIds:[],important});
  for(const s of w.snapshots)if(s.year===w.year)s.nextEvent=w.nextEvent;
  return e;
}
function migrationFixture(){
  const w=advance(createWorld('GEO-FORCED',{era:'industrial'}),9).world,s=w.societies[0];
  s.population=1000000;s.food=0;
  for(const r of w.regions.filter(r=>r.owner===s.id)){r.biomass=.08;r.water=.08;r.disasterUntil=100;}
  for(const t of w.societies.filter(t=>t.id!==s.id)){t.population=Math.floor(t.population*.25);t.food=t.population*6;}
  for(const r of w.relations)r.trust=.8;
  Geography.syncRegionalPopulations(w);return w;
}

test('Начальные территории связны, региональные жители точно складываются в общества для трёх эпох',()=>{
  for(const era of ['agriculture','industrial','space'])for(const seed of ['GEO-A','GEO-B']){const w=createWorld(seed,{era});balanced(w);assert.ok(validateWorld(w));for(const r of w.regions){const p=regionSummary(w,r.id);assert.equal(p.population,r.population);assert.ok(p.settlement.kindLabel);assert.ok(p.biomeLabel);}}
});
test('В нулевом году общественная ёмкость уже учитывает новую географию и политический курс',()=>{
  const w=createWorld('TULA');for(const s of w.societies){const factor={food:1.12,research:.96,security:.97,trade:1}[s.politics.policy];const expected=w.regions.filter(r=>r.owner===s.id).reduce((n,r)=>n+Geography.regionalCapacity(w,r),0)*factor;assert.equal(s.capacity,expected);assert.equal(w.snapshots[0].societies.find(t=>t.id===s.id).capacity,expected);}
});
test('Годовой баланс регионов, обществ, колоний и пассажиров не создаёт скрытого населения',()=>{
  let w=createWorld('GEO-YEARLY',{era:'space'});for(let year=0;year<90;year++){const before=totalPopulation(w);w=advance(w,1).world;balanced(w);assert.equal(totalPopulation(w),before+w.ledger.births-w.ledger.deaths);assert.ok(w.missions.every(m=>m.status==='transit'));}
});
test('Внутренние и международные переселения имеют фактические пути и не теряют жителей',()=>{
  const before=migrationFixture(),w=advance(before,1).world,events=allEvents(w).filter(e=>e.year===10&&e.type==='migration');
  assert.ok(events.some(e=>e.movement.kind==='internal'));assert.ok(events.some(e=>e.movement.kind==='migration'));balanced(w);
  assert.equal(totalPopulation(w),totalPopulation(before)+w.ledger.births-w.ledger.deaths);
  assert.equal(events.length,w.geography.movements.length);
  for(const e of events){assert.ok(Geography.validateMovement(w,e.movement));assert.equal(e.movement.year,10);assert.equal(e.movement.people,e.causes.find(c=>c.label==='Переселенцы').value);assert.ok(e.movement.path.length>=2);assert.deepEqual(e.movement,w.geography.movements.find(m=>m.from===e.movement.from&&m.to===e.movement.to));}
  const next=advance(w,1).world;assert.equal(next.geography.movements.length,0);assert.deepEqual(allEvents(next).filter(e=>e.movement).slice(0,events.length),events);
});
test('Недоверие закрывает международную миграцию, но не внутренние пути',()=>{
  const w=migrationFixture();for(const r of w.relations)r.trust=.05;
  const next=advance(w,1).world,moves=allEvents(next).filter(e=>e.year===10&&e.movement);
  assert.ok(moves.some(e=>e.movement.kind==='internal'));assert.ok(moves.every(e=>e.movement.kind==='internal'));balanced(next);
});
test('Внутреннее или исходящее движение не подменяет причину нагрузки от международного притока',()=>{
  const before=migrationFixture(),next=advance(before,1).world,events=allEvents(next).filter(e=>e.year===10&&e.movement),incoming=events.find(e=>e.movement.kind==='migration');assert.ok(incoming);
  const target=next.societies.find(s=>s.id===incoming.movement.toOwner),source=next.societies.find(s=>s.id===incoming.movement.fromOwner);
  assert.ok(events.some(e=>e.movement.kind==='internal'&&e.movement.fromOwner===target.id&&Number(e.id.slice(1))>Number(incoming.id.slice(1))));
  assert.equal(target.politics.events.migration.id,incoming.id);assert.ok(target.politics.migrationPressure>0);
  assert.deepEqual(source.politics.events.migration,before.societies.find(s=>s.id===source.id).politics.events.migration);
});
test('Карта маршрутов и поселений не зависит от размера пакета годовых шагов',()=>{
  const w=createWorld('GEO-BATCH',{era:'space'});let short=w;for(let i=0;i<5;i++)short=advance(short,20).world;assert.deepEqual(advance(w,100).world,short);
});
test('Экологическая нагрузка локальна: густонаселённый регион расходует больше биомассы',()=>{
  const w=createWorld('GEO-ECOLOGY'),s=w.societies.find(s=>w.regions.filter(r=>r.owner===s.id).length>=2),[a,b]=w.regions.filter(r=>r.owner===s.id);
  for(const r of w.regions.filter(r=>r.owner===s.id))r.population=0;
  a.population=s.population;b.population=0;a.biomass=b.biomass=.8;a.water=b.water=.7;
  const next=advance(w,1).world;assert.ok(next.regions.find(r=>r.id===a.id).biomass<next.regions.find(r=>r.id===b.id).biomass);balanced(next);
});
test('Отделение передаёт точное неравномерное население и пропорциональные запасы, обе территории связны',()=>{
  const w=createWorld('GEO-SECESSION',{era:'industrial'}),s=w.societies.reduce((a,b)=>w.regions.filter(r=>r.owner===a.id).length>w.regions.filter(r=>r.owner===b.id).length?a:b);
  const land=w.regions.filter(r=>r.owner===s.id);land.forEach((r,i)=>r.population*=i%3+1);Geography.syncSocietyPopulations(w);
  s.stability=.1;s.unrestYears=20;s.lastReform=0;const chosen=Geography.connectedSecession(w,s.id),control=clone(w);control.societies.find(t=>t.id===s.id).unrestYears=0;
  const expected=advance(control,1).world,next=advance(w,1).world,child=next.societies.find(t=>t.parentId===s.id);
  assert.ok(child);assert.deepEqual(next.regions.filter(r=>r.owner===child.id).map(r=>r.id).sort(),chosen.slice().sort());
  assert.equal(child.population,expected.regions.filter(r=>chosen.includes(r.id)).reduce((n,r)=>n+r.population,0));
  const parent=next.societies.find(t=>t.id===s.id),prior=expected.societies.find(t=>t.id===s.id);assert.equal(parent.population+child.population,prior.population);
  assert.ok(Math.abs(parent.food+child.food-prior.food)<1e-6);assert.ok(Math.abs(parent.minerals+child.minerals-prior.minerals)<1e-6);balanced(next);
});
test('Военный захват доступен только на границе и не отрезает столицу или остаток территории',()=>{
  let w=advance(createWorld('GEO-WAR',{era:'industrial'}),21).world;let pair=null;
  for(const r of w.regions){for(const s of w.societies){const trial=clone(w);if(Geography.transferRegion(trial,r.id,s.id)){pair={winner:s.id,loser:r.owner};break;}}if(pair)break;}
  assert.ok(pair);const winner=w.societies.find(s=>s.id===pair.winner),loser=w.societies.find(s=>s.id===pair.loser);
  winner.population=500000;winner.food=3000000;winner.tech=[6,6,6,6];loser.population=10000;loser.food=60000;Geography.syncRegionalPopulations(w);
  w.wars.push({id:'war-geography-fixture',a:winner.id,b:loser.id,start:0,active:true,losses:0});const oldOwners=new Map(w.regions.map(r=>[r.id,r.owner]));
  const next=advance(w,1).world,changed=next.regions.filter(r=>oldOwners.get(r.id)!==r.owner);assert.equal(changed.length,1);
  assert.equal(changed[0].owner,winner.id);assert.notEqual(changed[0].id,loser.capitalId);
  assert.ok(w.geography.edges.some(e=>[e.a,e.b].includes(changed[0].id)&&oldOwners.get(e.a===changed[0].id?e.b:e.a)===winner.id));balanced(next);
  const peace=allEvents(next).find(e=>e.year===22&&e.title==='Мирное соглашение');assert.deepEqual(peace.regionIds,[changed[0].id]);
});
test('Колониальный запуск списывает жителей из указанного региона один раз и переводит в полёт',()=>{
  let w=createWorld('GEO-DEPARTURE',{era:'space'});const s=w.societies[0],home=w.planets.find(p=>p.home),targets=w.planets.filter(p=>!p.home&&p.kind!=='gas');
  s.satellite=true;s.minerals=10000;s.food=s.population*6;s.probed=targets.map(p=>p.id);s.lastLaunch=-50;s.tech=[4,4,4,4];
  const control=clone(w);control.societies[0].lastLaunch=0;const expected=advance(control,1).world,next=advance(w,1).world;
  const m=next.missions.find(m=>m.owner===s.id&&m.kind==='colony');assert.ok(m);assert.equal(m.people,300);assert.ok(m.arrival>m.departure);assert.notEqual(m.target,home.id);
  assert.equal(expected.societies[0].population-next.societies[0].population,m.people);
  assert.equal(expected.regions.find(r=>r.id===m.originRegion).population-next.regions.find(r=>r.id===m.originRegion).population,m.people);assert.equal(totalPopulation(expected),totalPopulation(next));balanced(next);
});
test('Переход страницы сохраняет полный newEvents и автопаузу',()=>{
  const w=createWorld('GEO-ROLLOVER',{era:'space'});while(eventCount(w)<256)appendFixture(w);
  const result=advance(w,100,{stopOnImportant:true});assert.equal(result.advanced,1);assert.ok(result.newEvents.some(e=>e.important));assert.ok(result.newEvents.every(e=>Number(e.id.slice(1))>256));
  assert.equal(result.newEvents.length,eventCount(result.world)-eventCount(w));assert.equal(eventPageCount(result.world),2);assert.equal(eventPage(result.world,0).length,256);assert.ok(validateWorld(result.world));
});
test('16 000 событий больше не являются пределом жизни мира; архив остаётся полным',()=>{
  const w=createWorld('GEO-MANY-EVENTS');while(eventCount(w)<16010)appendFixture(w);
  assert.ok(validateWorld(w));const previous=clone(allEvents(w)),next=advance(w,1).world;
  assert.ok(eventCount(next)>=16010);assert.ok(next.events.length<=256);assert.deepEqual(allEvents(next).slice(0,previous.length),previous);assert.ok(validateWorld(next));
});
test('Завершённые полёты не занимают 160 активных слотов',()=>{
  const w=createWorld('GEO-MANY-MISSIONS',{era:'space'});w.year=321;const s=w.societies[0],p=w.planets.find(p=>!p.home&&p.kind!=='gas');
  for(let i=0;i<320;i++){w.missions.push({id:'m'+w.nextEntity++,name:'Архивный зонд',kind:'probe',owner:s.id,target:p.id,originRegion:s.capitalId,people:0,cargo:0,cost:15,departure:i+1,arrival:i+2,status:'arrived'});Archive.archiveCompletedMissions(w);}
  assert.equal(w.missions.length,0);assert.equal(allMissions(w).length,320);assert.ok(validateWorld(w));const next=advance(w,35).world;assert.ok(allMissions(next).length>320);assert.ok(next.missions.length<=160);balanced(next);
});
test('Снимок до прибытия показывает реальный transit и не содержит будущих событий или срезов',()=>{
  const w=advance(createWorld('GEO-SNAPSHOT',{era:'space'}),125).world;let checked=0;
  for(let i=0;i<w.snapshots.length;i++){const view=viewSnapshot(w,i);assert.ok(validateWorld(view));assert.ok(allEvents(view).every(e=>e.year<=view.year));assert.ok(view.snapshots.every(s=>s.year<=view.year));
    for(const m of allMissions(w).filter(m=>m.departure<=view.year&&m.arrival>view.year)){const prior=allMissions(view).find(p=>p.id===m.id);assert.ok(prior);assert.equal(prior.status,'transit');checked++;}}
  assert.ok(checked>0);const saved=clone(w);const past=viewSnapshot(w,0);past.geography.edges[0].cost=123;past.regions[0].population=0;assert.deepEqual(w,saved);
});
test('Повреждение архивной причинной ссылки, регионального баланса или маршрута отклоняется',()=>{
  const a=advance(migrationFixture(),1).world,e=allEvents(a).find(e=>e.movement),b=clone(a);const copy=allEvents(b).find(x=>x.id===e.id);copy.movement.path[1]='missing';assert.throws(()=>validateWorld(b));
  const c=clone(a);c.regions[0].population++;assert.throws(()=>validateWorld(c));
  const d=createWorld('GEO-BAD-ARCHIVE');while(eventCount(d)<257)appendFixture(d);const bad=clone(d);bad.eventArchive[0][100].causeEventIds=['e257'];assert.throws(()=>validateWorld(bad));
});
test('География, страницы и движения проходят экспорт/импорт без потери истории',async()=>{
  const w=advance(migrationFixture(),65).world;const payload=await encodeSave(w),restored=await decodeSave(payload);assert.deepEqual(restored,w);assert.deepEqual(advance(restored,10).world,advance(w,10).world);
});
