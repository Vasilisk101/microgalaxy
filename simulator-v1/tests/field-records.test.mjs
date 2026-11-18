import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as Current from '../src/core.mjs';
import * as Released from '../src/previous-core.mjs';
import * as Living from '../src/living-world.mjs';
import * as Space from '../src/space-world.mjs';
import * as Economy from '../../simulator-v08/src/economy.mjs';
import * as Archive from '../../simulator-v08/src/archive.mjs';
import * as Geography from '../../simulator-v08/src/geography.mjs';

test('the released histories still match the complete pre-update public results',()=>{
  for(const [seed,era,end,hash] of [
    ['BASIN-1','industrial',120,'e73329a4ddd526acb1593ce6d93cc35727a1e8f798f4a533362edd255ee80291'],
    ['ГОРИЗОНТ-12','space',220,'170d536c2ca6e4ccc414e2411c26289e38f6596e3e7140994e7735fb107bdbb9'],
    ['BASIN-6','agriculture',180,'9521d440a3af64c990cf2131f5c38444a6ab90932bd647002dcde5a5b2fd745a']
  ]){
    const mid=Released.advance(Released.createWorld(seed,{era}),31).world;
    const restored=JSON.parse(JSON.stringify(mid));Released.validateWorld(restored);
    const final=Released.advance(restored,end-31).world;
    assert.equal(createHash('sha256').update(JSON.stringify(final)).digest('hex'),hash);
  }
});

test('only testimony which boarded at departure arrives; restored manifests survive the loss of local witnesses',()=>{
  for(const treatyBeforeDeparture of [true,false]){
    const w=Current.createWorld('BASIN-6',{era:'industrial'}),[a,b]=w.societies;
    const edge=w.economy.routes.find(e=>e.kind==='land'&&[e.a,e.b].includes(a.capitalId)&&[e.a,e.b].every(id=>w.regions.find(r=>r.id===id).owner===a.id));
    const dest=edge.a===a.capitalId?edge.b:edge.a;
    function treaty(year){
      w.year=year;
      return Archive.appendEvent(w,{type:'diplomacy',title:'Торговый договор',detail:'Обмен',entityId:a.id,entityIds:[a.id,b.id],important:true,causeEventIds:[],causes:[]});
    }
    let event;
    if(treatyBeforeDeparture){event=treaty(1);Living.afterYear(w);}
    w.year=2;w.economy.shipments.push({id:'cargo'+w.economy.nextShipment++,route:edge.id,path:[edge.id],from:a.capitalId,to:dest,resource:'food',amount:120,departure:2,arrival:4,lossRate:.01,status:'transit'});
    Living.afterYear(w);
    if(!treatyBeforeDeparture){event=treaty(3);Living.afterYear(w);}
    else w.observatory.living.memories=[];
    const restored=JSON.parse(JSON.stringify(w));restored.year=4;
    Living.beforeYear(restored);Economy.step(restored);Living.afterYear(restored);
    assert.equal(Living.summary(restored).memories.some(m=>m.fact===event.id&&m.site===dest),treatyBeforeDeparture);
  }
});

test('paid decisions name the payer and show the actual change of use; three discovered sources answer different questions',()=>{
  const start=Current.createWorld('МЕАНДР-19',{era:'industrial'});
  const events=[];const detach=Living.observeConstruction(start,e=>events.push(e));
  Current.createWorkerSession(start).step(95);detach();
  const s=Living.summary(start),p=s.basin.project,ids=s.traces.filter(t=>t.discovered!==null).map(t=>t.id);
  assert.ok(p&&ids.length>=3);assert.ok(s.facts.some(f=>f.kind==='purpose'));
  assert.equal(p.payments.reduce((n,a)=>n+a.crew,0),p.labor);
  assert.equal(p.payments.reduce((n,a)=>n+a.food,0),p.spent.food);
  assert.equal(events.filter(e=>e.canWork).length,p.payments.length);
  const claim={founder:p.founder,payer:p.payments[0].owner,purpose:p.originalPurpose,finisher:p.owner};
  assert.ok(Living.investigate(start,claim,ids).every(x=>x.status==='confirmed'));
  assert.ok(Living.investigate(start,claim,[]).every(x=>x.status==='unknown'));
  const rival=start.societies.find(s=>s.id!==p.founder).id;
  assert.equal(Living.investigate(start,{...claim,founder:rival},ids)[0].status,'contradicted');
  const early=Current.advance(Current.createWorld('МЕАНДР-19',{era:'industrial'}),20).world;
  assert.ok(Living.investigate(early,claim,ids).every(x=>x.status==='unknown'));
  const altered=structuredClone(start);altered.observatory.living.basin.project.payments[0].raw++;
  assert.throws(()=>Living.validate(altered),/платёж/);
});

test('knowledge of a visible home world and testimony about the home of the founders can part company',()=>{
  const w=Current.createWorld('ГОРИЗОНТ-12',{era:'space'}),r=w.regions[0],home=w.planets.find(p=>p.home),moon=w.planets.find(p=>p.id!==home.id&&p.kind!=='gas');
  const c={id:'c'+w.nextEntity++,name:'Лагерь',planet:moon.id,parent:r.owner,population:80,food:800,capacity:150,autonomy:1,independent:true,founded:0,losses:0};
  w.colonies.push(c);
  const st=Space.registerColony(w,c.id,{skills:['farming','rocketry'],raw:30,equipment:12,homeRegion:r.id});
  for(let y=1;y<=30;y++){w.year=y;Space.afterSpace(w);}
  assert.ok(st.knownBodies.includes(home.id));assert.equal(st.homeMemory.carriers,0);
  assert.match(Space.returnAssessment(w,c.id).reason,/утрачено предание/);
  st.skills.push('orbital');Space.refreshLink(w,c.id);
  const msg=Space.sendMessage(w,'home',c.id,{kind:'skills',skills:['records']});
  assert.equal(st.homeMemory.carriers,0);w.year=msg.receiveYear;Space.processMessages(w);
  assert.equal(st.homeMemory.evidence,msg.id);assert.equal(st.homeMemory.received,w.year);assert.ok(st.homeMemory.carriers>0);
  Space.validate(w);
});

test('a lawful transfer preserves paid work while the new treasury can suspend and then fund a different use',()=>{
  const w=Current.createWorld('МЕАНДР-0',{era:'industrial'}),b=w.observatory.living.basin;
  const r=w.regions.find(s=>s.id===b.upper),lower=w.regions.find(s=>s.id===b.lower),edge=w.economy.routes.find(e=>e.id===b.edge);
  r.settlement.specialization='agriculture';r.settlement.infrastructure=.85;r.economy.stock={raw:100,equipment:50,food:r.population*20,energy:70};
  edge.used=0;w.year=1;Living.afterYear(w);
  const p=b.project,first=p.payments[0];assert.equal(first.purpose,'irrigation');
  assert.ok(Geography.transferRegion(w,r.id,'s3'));w.year=2;r.economy.stock.equipment=0;Living.afterYear(w);
  assert.equal(p.status,'paused');assert.equal(p.labor,first.crew);assert.equal(p.payments.length,1);
  w.year=3;r.economy.stock.equipment=40;r.water=.8;lower.economy.shortage=0;edge.used=edge.capacity*.9;
  Living.afterYear(w);assert.equal(p.payments[1].owner,'s3');assert.equal(p.purpose,'passage');
  assert.equal(p.founder,first.owner);assert.equal(Living.validate(w),true);
});

test('the separate field guide lets a reader select actual dated clues before revealing an answer',async()=>{
  const ctx={Core:Current,ReleasedCore:Released,LivingWorld:Living,SpaceWorld:Space,Intl,document:{}};
  const source=file=>readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  vm.runInNewContext(source('edition-ui.js')+source('field-guide.js')+';globalThis.E=EditionUI;globalThis.F=FieldGuide',ctx);
  const {w,points}=await ctx.F.replay('investigation',Current,async()=>{});
  assert.equal(w.modelVersion,'1.0.1');assert.ok(points.length>=3);
  const before=JSON.stringify(w),p=w.observatory.living.basin.project;
  const html=ctx.E.evidence(w);assert.match(html,/data-river-clue/);assert.doesNotMatch(html,/роль="status"|противоречит свидетельству/);
  const choices={founder:p.founder,payer:p.payments[0].owner,purpose:p.originalPurpose,finisher:p.owner};
  const keys=Object.entries(choices).map(([name,value])=>({dataset:{riverClaim:name},value}));
  const selected=Living.summary(w).traces.filter(t=>t.discovered!==null).map(t=>({dataset:{riverClue:t.id}}));
  ctx.E.readClaim(w,{querySelectorAll:selector=>selector.includes('claim')?keys:selected});
  assert.equal((ctx.E.evidence(w).match(/подтверждено/g)||[]).length,4);
  assert.equal(JSON.stringify(w),before);
});

test('abandoned supports yield actual raw once, disappear from the later slice, and leave the dated paper source',()=>{
  const w=Current.createWorld('ПЕРЕПРАВА-10',{era:'industrial'}),run=Current.createWorkerSession(w);
  run.step(140);
  const before=Living.summary(w),p=before.basin.project;
  assert.equal(p.status,'paused');assert.ok(before.traces.some(t=>t.kind==='кладка опоры'));
  const resumed=structuredClone(w);run.step(1);Current.createWorkerSession(resumed).step(1);
  assert.deepEqual(resumed,w);
  const now=Living.summary(w),act=now.basin.project.dismantled;
  assert.equal(act.year,141);assert.equal(act.raw,1.5);
  assert.equal(w.economy.ledger.reclaimed.raw,act.raw);assert.equal(w.economy.cumulative.reclaimed.raw,act.raw);
  assert.equal(w.economy.ledger.balance.raw<1e-7,true);
  assert.ok(!now.traces.some(t=>t.kind==='кладка опоры'));assert.ok(now.traces.some(t=>t.kind==='реестр поставок'));
  assert.ok(Living.summary(w,140).traces.some(t=>t.kind==='кладка опоры'));
  run.step(1);assert.equal(w.economy.ledger.reclaimed.raw,0);assert.equal(w.economy.cumulative.reclaimed.raw,act.raw);
  const fake=structuredClone(w);fake.economy.cumulative.reclaimed.raw++;
  assert.throws(()=>Living.validate(fake),/баланс/);
  const completed=Current.advance(Current.createWorld('МЕАНДР-19',{era:'industrial'}),160).world;
  assert.equal(completed.observatory.living.basin.project.status,'completed');assert.equal(completed.economy.cumulative.reclaimed.raw,0);
});

test('the actual peace at Doron is remembered differently in a ceded region and in another formerly occupied place',()=>{
  const w=Current.createWorld('АРХИВ-09',{era:'agriculture'}),run=Current.createWorkerSession(w);
  run.step(65);
  const occupied=Living.summary(w).memories.find(m=>m.basis?.kind==='occupation');
  assert.ok(occupied);assert.equal(occupied.basis.year,65);assert.ok(occupied.basis.value>0);
  run.step(13);
  const current=Living.summary(w),peace=current.memories.filter(m=>m.received===78&&m.via==='очевидцы'&&m.title==='Мирное соглашение');
  assert.equal(peace.length,2);assert.equal(peace[0].fact,peace[1].fact);
  assert.deepEqual(peace.map(m=>m.basis.kind).sort(),['boundary','relief']);
  const relief=peace.find(m=>m.basis.kind==='relief');
  assert.equal(Archive.eventById(w,relief.basis.record).title,'Оккупация региона');assert.equal(relief.basis.year,68);
  assert.ok(!Living.summary(w,65).memories.some(m=>m.fact===relief.fact));
  assert.ok(current.memories.filter(m=>m.fact===relief.fact&&m.via==='очевидцы').every(m=>['r51','r55'].includes(m.site)));
});

test('a crew remains in transit while its recorded landing site is occupied and unloads once after the site reopens',()=>{
  let w,moon;
  for(let i=0;i<35&&!moon;i++){w=Current.createWorld('landing-'+i,{era:'space'});moon=w.planets.find(p=>p.parentId===w.planets.find(b=>b.home).id);}
  assert.ok(moon);
  const r=w.regions[0],home=w.planets.find(p=>p.home),c={id:'c'+w.nextEntity++,name:'Лагерь',planet:moon.id,parent:r.owner,population:100,food:800,capacity:150,autonomy:1,independent:true,founded:0,losses:0};
  w.colonies.push(c);Space.registerColony(w,c.id,{skills:['farming','rocketry'],raw:40,equipment:20,homeRegion:r.id});
  const flight=Space.launchReturn(w,c.id);assert.equal(flight.launched,true);assert.equal(flight.mission.target,home.id);
  w.year=flight.mission.arrival;w.wars.push({id:'w-test',start:0,active:true});r.occupation={warId:'w-test',since:w.year};
  const pop=r.population;Economy.step(w);assert.deepEqual(Space.beforeSpace(w,Economy.importSupply),[]);
  const booked=w.observatory.space.returns[0];assert.equal(booked.hold.since,w.year);
  assert.equal(r.population,pop);assert.equal(w.economy.ledger.externalIn.food,0);Space.validate(w);
  const saved=structuredClone(w);saved.year++;const site=saved.regions.find(p=>p.id===r.id);site.occupation=null;Economy.step(saved);
  assert.deepEqual(Space.beforeSpace(saved,Economy.importSupply),[flight.mission.id]);Space.beforeSpace(saved,Economy.importSupply);
  assert.equal(site.population,pop+flight.mission.people);assert.equal(saved.economy.ledger.externalIn.food,flight.mission.cargo);
  assert.equal(saved.observatory.space.returns[0].arrival,saved.year);Space.validate(saved);
});
