import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,advance,clone,validateWorld,politicsSummary,diplomacySummary,storylines,eventThread,summary,viewSnapshot} from '../src/core.mjs';

function record(w,type,entityIds,title='Сценарное исходное условие',causeEventIds=[]){
  const e={id:'e'+w.nextEvent++,year:w.year,type,title,detail:'Заданное тестом исходное условие.',entityId:entityIds[0]??null,entityIds,causes:[],important:false,causeEventIds};w.events.push(e);for(const s of w.snapshots)if(s.year===w.year)s.nextEvent=w.nextEvent;return e;
}
function shortage(w,s){
  s.population=200000;s.food=0;
  for(const r of w.regions.filter(r=>r.owner===s.id)){r.biomass=.08;r.water=.08;r.disasterUntil=100;}
  for(const r of w.relations.filter(r=>[r.a,r.b].includes(s.id)))r.trust=.2;
}
function tradeFixture(){
  const w=createWorld('TRADE-CONSERVATION',{era:'industrial'}),buyer=w.societies[0],seller=w.societies[1];
  shortage(w,buyer);buyer.population=100000;buyer.politics.policy='food';seller.population=100000;seller.food=600000;seller.politics.policy='food';
  const rel=w.relations.find(r=>r.a===buyer.id&&r.b===seller.id);rel.trust=.8;rel.lastTreatyYear=0;
  const e=record(w,'diplomacy',[buyer.id,seller.id]);return {w,buyer,seller,rel,e};
}

test('Политическая модель создаёт четыре нормированные группы и публичный паспорт',()=>{
  const w=createWorld('POLITY');for(const s of w.societies){const p=politicsSummary(w,s.id);assert.equal(p.factions.length,4);assert.ok(Math.abs(p.factions.reduce((n,f)=>n+f.influence,0)-1)<1e-10);assert.ok(p.policyLabel);assert.ok(p.successionLabel);assert.equal(p.crisis,false);}
});
test('Продовольственный и исследовательский курсы меняют вычисления, а не только подписи',()=>{
  const a=createWorld('POLICY',{era:'industrial'}),b=clone(a);a.societies[0].politics.policy='food';b.societies[0].politics.policy='research';
  const sa=advance(a,1).world.societies[0],sb=advance(b,1).world.societies[0];
  assert.ok(sa.production>sb.production);assert.ok(sb.tech[2]-b.societies[0].tech[2]>sa.tech[2]-a.societies[0].tech[2]);
});
test('Институциональная память уменьшает потери устойчивости при наследовании',()=>{
  const a=createWorld('MEMORY'),b=clone(a);for(const w of [a,b]){w.societies[0].government='Наследственная власть';w.societies[0].leader.age=87;}
  a.societies[0].politics.institutionalMemory=.9;b.societies[0].politics.institutionalMemory=.1;
  const ra=advance(a,1).world,rb=advance(b,1).world;
  const impact=w=>w.events.find(e=>e.entityId==='s0'&&e.title==='Смена руководства').causes.find(c=>c.label==='Изменение устойчивости').value;
  assert.ok(impact(ra)>impact(rb));assert.ok(ra.societies[0].stability>rb.societies[0].stability);
});
test('В обычном мире появляются договоры и содержательные причинные истории',()=>{
  const w=advance(createWorld('ТУЛА-71'),300).world;
  assert.ok(summary(w).activeTreaties>0);assert.ok(storylines(w).some(s=>s.eventCount>=2));
  assert.ok(diplomacySummary(w).some(r=>r.treaty!=='Нет договора'));
});
test('Торговый договор расширяет реальную поставку, а продавец теряет тот же дополнительный объём',()=>{
  const {w,rel,e}=tradeFixture(),withPact=clone(w);withPact.relations.find(r=>r.a===rel.a&&r.b===rel.b).treaty={kind:'trade',since:0,eventId:e.id};
  const baseline=advance(w,1).world,pact=advance(withPact,1).world;
  const flow=x=>x.relations.find(r=>r.a===rel.a&&r.b===rel.b).trade,difference=flow(pact)-flow(baseline);
  assert.ok(Math.abs(difference-10000)<1e-6);assert.ok(Math.abs((baseline.societies[1].food-pact.societies[1].food)-difference)<1e-6);
  assert.ok(pact.societies[0].supply>baseline.societies[0].supply);
});
test('Зависимость относится к стороне-получателю и доле её потребности',()=>{
  const {w,rel,e}=tradeFixture();rel.treaty={kind:'trade',since:0,eventId:e.id};const next=advance(w,1).world,r=next.relations.find(r=>r.a===rel.a&&r.b===rel.b);
  assert.ok(Math.abs(r.dependencyA-.2*r.trade/100000)<1e-10);assert.equal(r.dependencyB,0);
});
test('Союзная помощь списывает материалы у союзника и уменьшает военные потери',()=>{
  const a=createWorld('ALLIANCE',{era:'industrial'}),[target,enemy,donor]=a.societies;donor.minerals=1000;target.politics.policy='food';
  const rel=a.relations.find(r=>[r.a,r.b].includes(target.id)&&[r.a,r.b].includes(donor.id));rel.trust=.9;
  const e=record(a,'diplomacy',[target.id,donor.id]);rel.treaty={kind:'alliance',since:0,eventId:e.id};
  a.wars.push({id:'war-fixture',a:target.id,b:enemy.id,start:0,active:true,losses:0});const b=clone(a);b.relations.find(r=>r.a===rel.a&&r.b===rel.b).treaty=null;
  const supported=advance(a,1).world,alone=advance(b,1).world;
  assert.ok(supported.societies[2].minerals<alone.societies[2].minerals);assert.ok(supported.wars[0].losses<alone.wars[0].losses);assert.ok(supported.events.some(e=>e.title==='Союзная помощь'&&e.causeEventIds.includes(rel.treaty.eventId)));
});
test('Мирный договор не исчезает из-за недоверия до истечения 20 лет',()=>{
  const w=createWorld('TRUCE'),rel=w.relations[0];rel.trust=.01;const e=record(w,'conflict',[rel.a,rel.b]);rel.treaty={kind:'truce',since:0,eventId:e.id};
  const result=advance(w,19).world,r=result.relations.find(r=>r.a===rel.a&&r.b===rel.b);assert.equal(r.treaty.kind,'truce');assert.ok(!result.wars.some(c=>[c.a,c.b].includes(rel.a)&&[c.a,c.b].includes(rel.b)));
});
test('Засуха → продовольствие → кризис → реформа имеет явные причинные рёбра',()=>{
  const w=createWorld('CAUSAL-CRISIS'),s=w.societies[0];shortage(w,s);s.stability=.15;s.politics.legitimacy=.15;s.politics.hungerYears=6;
  const drought=record(w,'climate',[s.id],'Сценарная засуха');for(const r of w.regions.filter(r=>r.owner===s.id))r.disasterEventId=drought.id;
  const next=advance(w,8).world,food=next.events.find(e=>e.entityId===s.id&&e.title==='Недостаток продовольствия'),crisis=next.events.find(e=>e.entityId===s.id&&e.title==='Кризис легитимности'),reform=next.events.find(e=>e.entityId===s.id&&e.title==='Перестройка институтов');
  assert.ok(food.causeEventIds.includes(drought.id));assert.ok(crisis.causeEventIds.includes(food.id));assert.ok(reform.causeEventIds.includes(crisis.id));
  const chain=eventThread(next,crisis.id);assert.ok(chain.before.some(e=>e.id===drought.id));assert.ok(chain.after.some(e=>e.id===reform.id));
});
test('Возрастная смена лидера не приписывается совпавшему по времени завершённому кризису',()=>{
  const w=createWorld('NOT-CORRELATION'),s=w.societies[0],e=record(w,'politics',[s.id],'Прежний кризис');s.politics.events.crisis={id:e.id,year:0};s.leader.age=87;
  const next=advance(w,1).world,change=next.events.find(e=>e.entityId===s.id&&e.title==='Смена руководства');assert.deepEqual(change.causeEventIds,[]);
});
test('Ссылки на будущее, самого себя и циклы внутри одного года отвергаются',()=>{
  const a=createWorld('DAG');a.events[0].causeEventIds=['e1'];assert.throws(()=>validateWorld(a));
  const b=createWorld('DAG');record(b,'politics',['s0'],'A',['e3']);record(b,'politics',['s0'],'B',['e2']);assert.throws(()=>validateWorld(b));
});
test('Снимок не содержит будущих политических полей, событий и срезов',()=>{
  const w=advance(createWorld('SNAPSHOT'),75).world,before=clone(w),past=viewSnapshot(w,1);
  assert.equal(past.year,25);assert.ok(past.snapshots.every(s=>s.year<=25));assert.ok(past.events.every(e=>e.year<=25));
  assert.equal(eventThread(past,w.events.at(-1).id).focus,null);
  past.events[0].title='Изменение копии';past.societies[0].politics.legitimacy=0;assert.deepEqual(w,before);
});
test('При отделении новая страна не забирает столицу предшественника',()=>{
  const w=createWorld('CAPITAL',{era:'industrial'}),s=w.societies.reduce((a,b)=>w.regions.filter(r=>r.owner===a.id).length>w.regions.filter(r=>r.owner===b.id).length?a:b),land=w.regions.filter(r=>r.owner===s.id);
  s.capitalId=land.at(-1).id;s.population=Math.max(40000,s.population);s.stability=.1;s.unrestYears=20;s.lastReform=0;
  const next=advance(w,1).world;assert.ok(next.societies.length>w.societies.length);assert.equal(next.regions.find(r=>r.id===s.capitalId).owner,s.id);assert.ok(validateWorld(next));
});
test('Невалидные группы, договоры и память причин отклоняются',()=>{
  const a=createWorld('INVALID');a.societies[0].politics.factions[0].influence=.99;assert.throws(()=>validateWorld(a));
  const b=createWorld('INVALID');b.relations[0].treaty={kind:'alliance',since:0,eventId:'missing'};assert.throws(()=>validateWorld(b));
  const c=createWorld('INVALID');c.societies[0].politics.events.crisis={id:'e1',year:0};assert.throws(()=>validateWorld(c));
});
test('Политические и дипломатические метрики ограничены после 500 лет',()=>{
  const w=advance(createWorld('METRICS',{era:'space'}),500).world;assert.ok(validateWorld(w));
  for(const s of w.societies){const p=politicsSummary(w,s.id);assert.ok(p.legitimacy>=0&&p.legitimacy<=1);assert.ok(Math.abs(p.factions.reduce((n,f)=>n+f.influence,0)-1)<1e-8);}
  for(const r of diplomacySummary(w))assert.ok(r.dependencyA>=0&&r.dependencyA<=1&&r.dependencyB>=0&&r.dependencyB<=1);
});
