import * as Economy from '../../simulator-v08/src/economy.mjs';
import * as Archive from '../../simulator-v08/src/archive.mjs';

const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const region = (w, id) => w.regions.find(r => r.id === id);
const hasSkill = (w, owner, skill) => w.societies.find(s => s.id === owner)?.knowledge.some(n => n.id === skill && n.active);
const MATERIALS = {raw: 1.5, equipment: 0.8, food: 9};
const MEMORY_SLOTS = 4;
const MAX_HANDOVERS = 6;
const fieldEdition = w => w.modelVersion === '1.0.1';
// Both hooks are inside one atomic model year. This scratch list never enters a save.
const dueShipments = new WeakMap();
const constructionObservers=new WeakMap();
export function observeConstruction(world,listener){
  if(typeof listener!=='function')throw Error('Нужен обработчик наблюдения.');
  constructionObservers.set(world,listener);
  return ()=>constructionObservers.delete(world);
}
const FACT_NAMES = {
  foundation: 'Заложены опоры плотины', ownership: 'Сменился владелец стройки',
  completed: 'Завершена речная плотина', diversion: 'Вода нашла другое русло',
  closed: 'Переправа стала непроходимой', opened: 'Переправа снова доступна',
  discovery: 'Опознан след прошлого', lost: 'Утрачен след сооружения',
  purpose: 'Изменено назначение работ', payment: 'Сохранилась запись оплаты', dismantled:'Разобрана заброшенная стройка'
};

function chooseBasin(w) {
  const reaches = [];
  for (const edge of w.geography.edges) {
    let upper = region(w, edge.a), lower = region(w, edge.b);
    if (upper.elevation < lower.elevation) [upper, lower] = [lower, upper];
    const drop = upper.elevation - lower.elevation;
    if (lower.coastal && lower.elevation < .2 && upper.water > .65 && drop > .25) {
      reaches.push({edge, upper, lower, drop});
    }
  }
  reaches.sort((a, b) => b.upper.water * b.drop - a.upper.water * a.drop || a.edge.id.localeCompare(b.edge.id));
  if (!reaches.length) return null;
  const {edge, upper, lower, drop} = reaches[0];
  const adjacent = w.geography.edges.filter(e => e.id !== edge.id && (e.a === upper.id || e.b === upper.id));
  const outlets = adjacent.map(e => region(w, e.a === upper.id ? e.b : e.a))
    .filter(r => r.elevation < upper.elevation && r.elevation < lower.elevation + .18)
    .sort((a, b) => a.elevation - b.elevation || a.id.localeCompare(b.id));
  return {
    upper: upper.id, lower: lower.id, alternate: outlets[0]?.id ?? null,
    edge: edge.id, drop, silt: .04, flow: upper.water, diverted: false,
    blockedEdge: null, project: null
  };
}

export function initialize(w) {
  w.observatory ??= {};
  if (w.observatory.living) throw new Error('История бассейна уже создана.');
  w.observatory.living = {version: 1, basin: chooseBasin(w), facts: [], traces: [], memories: [], eventCursor: w.nextEvent - 1};
}

function record(w, kind, site, detail = {}) {
  const facts = w.observatory.living.facts;
  const fact = {id: 'river-' + (facts.length + 1), kind, year: w.year, site, ...detail};
  facts.push(fact);
  return fact;
}

function trace(w, kind, site, fact) {
  const traces = w.observatory.living.traces;
  traces.push({id: 'trace-' + (traces.length + 1), kind, site, source: fact.id, formed: w.year, discovered: null, lost: null});
}

function remember(w, at, fact, carriers, opinion, via, from = null, origin = at, weight = 1, evidence = null, source = null,basis=null) {
  const destination = region(w, at);
  carriers = Math.min(destination.population, Math.floor(carriers));
  if (!carriers) return;
  const memories = w.observatory.living.memories;
  const existing = memories.find(m => m.site === at && m.fact === fact);
  if (existing) {
    existing.carriers = Math.min(destination.population, existing.carriers + carriers);
    if (evidence) existing.evidence = evidence;
    return;
  }
  const local = memories.filter(m => m.site === at);
  if (local.length >= MEMORY_SLOTS) {
    local.sort((a, b) => a.weight - b.weight || a.carriers - b.carriers || a.received - b.received);
    if (local[0].weight > weight || local[0].weight === weight && local[0].carriers >= carriers) return;
    memories.splice(memories.indexOf(local[0]), 1);
  }
  const handovers = source ? [...(source.handovers??[[source.site,source.received,source.via]])] : [];
  let omitted = source?.omitted??0;
  handovers.push([at,w.year,via]);
  if(handovers.length>MAX_HANDOVERS){
    handovers.splice(1,1);
    omitted++;
  }
  const entry={fact, site: at, origin, from, received: w.year, via, opinion, carriers, weight, evidence, handovers, omitted};
  if(fieldEdition(w)&&(basis||source?.basis))entry.basis=structuredClone(basis??source.basis);
  memories.push(entry);
}

function witness(w, site, fact, opinion) {
  remember(w, site, fact.id, region(w, site).population * .24, opinion, 'очевидцы', null, site, 2);
}

export function routeOpen(w, edgeId) {
  return w.observatory?.living?.basin?.blockedEdge !== edgeId;
}

// Heights, channel depth and flow are relative model units. The old crossing lies
// on the lower bank. A new outlet can flood it when the river overtops its sill.
export function waterProfile(w, basin) {
  if (!basin) return null;
  const lower = region(w, basin.lower), alternate = region(w, basin.alternate);
  const bed = lower.elevation;
  const sill = bed + .065 + basin.drop * .08;
  const stage = bed + basin.silt * .08 + basin.flow * .16;
  const outlet = alternate ? alternate.elevation + .035 : null;
  const depth = basin.flow * (basin.diverted ? .38 : 1) - basin.silt * .6;
  return {sill, stage, outlet, depth: Math.max(0,depth)};
}

// A common local projection keeps old and new outlets aligned, even across ±180°.
// Width is a relative symbol determined by the recorded flow, not a width in km.
export function placeMap(w, site, basin, earlier = null) {
  const focus = region(w, site);
  if (!focus) return null;
  const inBasin = basin && [basin.upper,basin.lower,basin.alternate].includes(site);
  const anchor = inBasin ? region(w,basin.upper) : focus;
  const neighbors = w.geography.edges.filter(e=>e.a===site || e.b===site)
    .map(e=>e.a===site ? e.b : e.a);
  const ids = [...new Set(inBasin ? [basin.upper,basin.lower,basin.alternate].filter(Boolean) : [site,...neighbors])];
  const points = ids.map(id=>{
    const r=region(w,id),lon=((r.lon-anchor.lon+540)%360)-180;
    return {id,x:lon*Math.cos(anchor.lat*Math.PI/180),y:anchor.lat-r.lat};
  });
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  const scale=Math.min(460/Math.max(1,right-left),110/Math.max(1,bottom-top));
  for(const p of points){
    p.x=Math.round(280+(p.x-(left+right)/2)*scale);
    p.y=Math.round(88+(p.y-(top+bottom)/2)*scale);
  }
  const channel=b=>b ? {from:b.upper,to:b.diverted?b.alternate:b.lower,width:3+Math.round(b.flow*10)} : null;
  const routes = w.geography.edges.filter(e=>ids.includes(e.a) && ids.includes(e.b))
    .map(e=>({from:e.a,to:e.b,blocked:basin?.blockedEdge===e.id}));
  return {points,routes,current:inBasin?channel(basin):null,previous:inBasin?channel(earlier):null};
}

// Persistent low water damages vegetation only after consecutive dry years.
// Recovery depends on the local biome, remaining vegetation and population pressure.
function vegetationYear(w, basin) {
  basin.ecology ??= {};
  for(const id of [basin.upper,basin.lower,basin.alternate].filter(Boolean)){
    const r=region(w,id),prior=basin.ecology[id],dryLimit=r.biome==='drylands'?.44:.5;
    const dryYears=r.water<dryLimit ? (prior?.dryYears??0)+1 : 0;
    const pressure=clamp(r.population/30000);
    const damage=dryYears>=3 ? Math.min(.025,.003*(dryYears-2))*(.5+pressure*.5) : 0;
    const rate=({forest:.022,grassland:.03,drylands:.012,tundra:.008,highlands:.01})[r.biome];
    const recovery=dryYears===0 ? rate*(1-pressure)*r.biomass*(1-r.biomass) : 0;
    const before=r.biomass;
    r.biomass=clamp(before-damage+recovery,.08,1);
    basin.ecology[id]={dryYears,vegetationChange:r.biomass-before};
  }
}

export function beforeYear(w) {
  // A due shipment which remains in the model has been held up. Ignore dust-sized
  // consignments, which can disappear as an accounted loss instead of arriving.
  dueShipments.set(w, w.economy.shipments.filter(s => s.arrival <= w.year && s.amount >= 1)
    .map(s => ({id: s.id, from: s.from, to: s.to, amount: s.amount, testimony:s.testimony})));
  const basin = w.observatory.living.basin;
  if (!basin) return;
  const upper = region(w, basin.upper), lower = region(w, basin.lower);
  const functioning = basin.project?.completed != null && (!fieldEdition(w)||basin.project.purpose==='irrigation');
  const raisedCrossing=fieldEdition(w)&&basin.project?.completed!=null&&basin.project.purpose==='passage';
  const runoff = upper.water * (.68 + upper.elevation * .38);
  basin.flow = clamp(runoff * (functioning ? .82 : 1));
  // Low-gradient flows deposit sediment; steeper, wetter flows scour the channel.
  const equilibrium = clamp(.12 + (1 - basin.drop) * .86 - runoff * .36 + (functioning ? .09 : 0));
  basin.silt += (equilibrium - basin.silt) * .014;
  const profile = waterProfile(w, basin);
  if (!basin.diverted && basin.alternate && basin.silt > .47 && basin.flow > .41 && profile.stage > profile.outlet) {
    basin.diverted = true;
    const fact = record(w, 'diversion', lower.id, {newOutlet: basin.alternate});
    trace(w, 'старый берег', lower.id, fact);
    witness(w, lower.id, fact, 'утрата прежнего русла');
  }
  const {depth} = waterProfile(w,basin);
  const edge = w.geography.edges.find(e => e.id === basin.edge);
  // Hysteresis avoids closing/reopening a route on minute seasonal differences.
  const flooded = basin.diverted && profile.stage > profile.sill + (basin.blockedEdge ? -.012 : .006) + (raisedCrossing?.07:0);
  const minimumDepth=(basin.blockedEdge ? .12 : .025)*(raisedCrossing?.45:1);
  const blocked = edge.kind === 'sea' ? depth < minimumDepth : flooded;
  const next = blocked ? edge.id : null;
  if (next !== basin.blockedEdge) {
    basin.blockedEdge = next;
    const fact = record(w, blocked ? 'closed' : 'opened', lower.id, {edge: edge.id});
    const route = w.economy.routes.find(r => r.id === edge.id);
    if (blocked && route.used > 0 && !basin.crossingLost) {
      const kind = edge.kind === 'sea' ? 'остатки причала' : 'насыпь старой дороги';
      trace(w, kind, lower.id, fact);
      basin.crossingLost = fact.id;
    }
  }
  // These are the water values used by current-year food production and carrying capacity.
  const upstreamBefore = upper.water;
  if (functioning) upper.water = clamp(upper.water + .009, .08, .98);
  const lowerWithoutDam = clamp(lower.water + (runoff - .5) * .008 - (basin.diverted ? .011 : 0), .08, .98);
  lower.water = clamp(lower.water + (basin.flow - .5) * .008 - (functioning ? .005 : 0) - (basin.diverted ? .011 : 0), .08, .98);
  if (functioning && basin.project.completed === w.year - 1) {
    const opening = w.observatory.living.facts.find(f => f.kind === 'completed');
    for (const m of w.observatory.living.memories.filter(m => m.fact === opening.id)) {
      if (m.site === upper.id && upper.water > upstreamBefore) m.opinion = 'воды в верховьях стало больше';
      if (m.site === lower.id && lower.water < lowerWithoutDam) m.opinion = 'меньше воды ниже плотины';
    }
  }
  if (basin.diverted) {
    const alternate = region(w, basin.alternate);
    alternate.water = clamp(alternate.water + basin.flow * .018, .08, .98);
  }
  vegetationYear(w,basin);
}

function build(w, basin) {
  const upper = region(w, basin.upper), lower = region(w, basin.lower);
  let p = basin.project;
  if(fieldEdition(w)&&p?.dismantled)return;
  if (p && p.owner !== upper.owner) {
    const old = p.owner;
    p.owner = upper.owner;
    record(w, 'ownership', upper.id, {previousOwner: old, owner: upper.owner});
  }
  if (p?.completed != null) return;
  const stock = upper.economy.stock;
  const need = upper.settlement.specialization === 'agriculture' || upper.water < .6 || lower.economy.shortage > .12;
  const revised=fieldEdition(w),route=w.economy.routes.find(e=>e.id===basin.edge);
  const canIrrigate=need&&hasSkill(w,upper.owner,'irrigation');
  const trafficUse=revised&&hasSkill(w,upper.owner,'roads')&&route.used>Math.max(1,route.capacity*.12);
  const purpose=trafficUse&&(!canIrrigate||upper.water>.54&&lower.economy.shortage<.12)?'passage':canIrrigate?'irrigation':null;
  const crew = Math.min(18, Math.floor(upper.population * upper.settlement.infrastructure * .04));
  const affordable = Object.entries(MATERIALS).every(([key, amount]) => stock[key] >= amount)
    && stock.food - MATERIALS.food >= upper.population * .25;
  const canWork = !upper.occupation && (!basin.diverted||revised&&purpose==='passage') && crew >= 6 && affordable && (revised?!!purpose:canIrrigate);
  const observe=constructionObservers.get(w);
  if(observe)observe({year:w.year,site:upper.id,owner:upper.owner,need,availablePurpose:purpose,irrigationSkill:hasSkill(w,upper.owner,'irrigation'),
    roadsSkill:hasSkill(w,upper.owner,'roads'),crew,affordable,occupied:!!upper.occupation,diverted:basin.diverted,canWork});
  if (!canWork) {
    if (p) {
      if(revised){
        const reason=upper.occupation?'оккупация':!affordable?'недостаточно запасов':crew<6?'не хватает работников':basin.diverted?'изменилось русло':'нет доступного назначения';
        const last=p.decisions.at(-1);
        if(p.status!=='paused'||last?.owner!==upper.owner)p.decisions.push({year:w.year,owner:upper.owner,reason});
      }
      p.status = 'paused';
    }
    return;
  }
  if (!p) {
    const foundation = record(w, 'foundation', upper.id, {owner: upper.owner});
    trace(w, 'кладка опоры', upper.id, foundation);
    witness(w, upper.id, foundation, 'начало местных работ');
    p = basin.project = {
      site: upper.id, founder: upper.owner, owner: upper.owner, started: w.year, completed: null,
      required: 100 + Math.ceil(basin.drop * 70), labor: 0, yearsPaid: 0, lastWorked: w.year,
      status: 'building', spent: {raw: 0, equipment: 0, food: 0}
    };
    if(revised){
      Object.assign(p,{id:foundation.id,originalPurpose:purpose,purpose,payments:[],decisions:[]});
      foundation.purpose=purpose;
    }
  }
  if(revised&&purpose!==p.purpose){
    record(w,'purpose',upper.id,{owner:upper.owner,previous:p.purpose,purpose,reason:purpose==='passage'?'перевозки по действующей переправе':'потребность хозяйств в воде'});
    p.purpose=purpose;
  }
  const allowed = new Set([upper.id]);
  const payment={};
  for (const [key, amount] of Object.entries(MATERIALS)) {
    const paid = Economy.spend(w, upper.owner, key, amount, 'construction', allowed);
    if (Math.abs(amount - paid) > 1e-8) throw new Error('Неполная оплата годовых работ на плотине.');
    p.spent[key] += paid;
    if(revised)payment[key]=paid;
  }
  p.labor += crew;
  p.yearsPaid++;
  p.lastWorked = w.year;
  if(revised){
    p.payments.push({year:w.year,owner:upper.owner,purpose,crew,...payment});
    const last=p.decisions.at(-1);
    if(last?.reason!=='работы оплачены'||last.owner!==upper.owner)p.decisions.push({year:w.year,owner:upper.owner,reason:'работы оплачены'});
    if(!p.accountRecord&&hasSkill(w,upper.owner,'records')){
      const fact=record(w,'payment',upper.id,{owner:upper.owner,founder:p.founder,purpose,...payment,crew});
      p.accountRecord=fact.id;trace(w,'реестр поставок',upper.id,fact);
    }
  }
  p.status = 'building';
  if (p.labor >= p.required) {
    p.status = 'completed';
    p.completed = w.year;
    const fact = record(w, 'completed', upper.id, {owner: upper.owner, founder: p.founder, downstream: lower.id});
    trace(w, 'пазы водосброса', upper.id, fact);
    witness(w, upper.id, fact, 'окончание работ');
    witness(w, lower.id, fact, 'окончание работ');
  }
}

function salvage(w,b){
  const p=b.project;
  if(p?.status!=='paused'||w.year-p.lastWorked<25)return;
  const r=region(w,p.site);
  if(r.occupation||r.population<120||r.economy.stock.raw>=3||!hasSkill(w,r.owner,'workshops'))return;
  const damaged=r.reconstruction>0||w.economy.routes.some(route=>[route.a,route.b].includes(r.id)&&route.condition<.7);
  if(!damaged)return;
  const raw=Math.floor(p.spent.raw*.5*1000)/1000;
  if(raw<=0)return;
  Economy.reclaimMaterial(w,r.id,raw);
  const fact=record(w,'dismantled',r.id,{owner:r.owner,raw,project:p.id});
  p.dismantled={year:w.year,owner:r.owner,raw,source:fact.id};p.status='dismantled';
  for(const t of w.observatory.living.traces){
    if(t.lost===null&&t.source===p.id&&t.kind==='кладка опоры'){
      t.lost=w.year;record(w,'lost',r.id,{trace:t.id,reason:'разбор',cause:fact.id});
    }
  }
  witness(w,r.id,fact,'сырьё разобранных опор поступило на местный склад');
}

function discover(w, basin) {
  for (const t of w.observatory.living.traces) {
    if (t.lost !== null || w.year <= t.formed) continue;
    const r = region(w, t.site);
    const eroded = ['старый берег', 'остатки причала', 'насыпь старой дороги'].includes(t.kind)
      && basin.silt > .6 && basin.flow > .45;
    if (eroded) {
      t.lost = w.year;
      record(w, 'lost', t.site, {trace: t.id});
      continue;
    }
    if (t.discovered !== null || w.year - t.formed < 30 || r.population < 400 || !hasSkill(w, r.owner, 'records')) continue;
    // A working structure is visible in the present. Its archaeology opens when
    // a changed owner, abandonment or exposed bank gives the community a reason to investigate.
    const survey=fieldEdition(w)&&(t.kind==='реестр поставок'||r.settlement.infrastructure>=.22&&basin.flow<.60);
    const disused = survey||['старый берег', 'остатки причала', 'насыпь старой дороги'].includes(t.kind) || basin.project?.status === 'paused'
      || basin.project?.founder !== basin.project?.owner;
    if (!disused) continue;
    t.discovered = w.year;
    record(w, 'discovery', t.site, {trace: t.id});
    remember(w, t.site, t.source, r.population * .12, 'сохранился вещественный след', 'находка', null, t.site, 2,
      {year: w.year, trace: t.id});
  }
}

export function nextGeneration(carriers,population,canTeach) {
  const retiring=Math.ceil(carriers/32);
  const students=canTeach&&population ? Math.min(retiring,Math.floor(population*.015)) : Math.floor(retiring*.7);
  return Math.min(population,carriers-retiring+students);
}

function rememberConflict(w,event){
  const kept=new Set();
  function local(site,opinion,kind,value,record=event){
    const r=region(w,site);
    if(!r?.population||kept.has(site))return;
    kept.add(site);
    const basis={site,kind,value,record:record.id,year:record.year};
    remember(w,site,event.id,r.population*.18,opinion,'очевидцы',null,site,2,null,null,basis);
  }
  if(event.title==='Оккупация региона'){
    for(const site of event.regionIds??[])local(site,'пережили занятие региона','occupation',region(w,site).reconstruction);
    return;
  }
  if(event.title!=='Мирное соглашение')return;
  const war=w.wars.find(c=>!c.active&&event.causeEventIds.includes(c.originEventId));
  if(!war)return;
  if(war.compensation?.amount>0){
    local(war.compensation.fromRegion,'по соглашению передали сырьё','paid',war.compensation.amount);
    local(war.compensation.toRegion,'по соглашению получили сырьё','received',war.compensation.amount);
  }
  for(const site of event.regionIds??[])local(site,'по соглашению изменился владелец региона','boundary',null);
  for(const earlier of Archive.iterateEvents(w,{afterYear:war.start-1,throughYear:event.year})){
    if(earlier.title!=='Оккупация региона'||!earlier.causeEventIds.includes(war.originEventId))continue;
    for(const site of earlier.regionIds??[])local(site,'после занятия дождались мира','relief',null,earlier);
  }
}

function advanceMemories(w) {
  const living = w.observatory.living;
  for (const m of living.memories) {
    const r = region(w, m.site);
    m.carriers=nextGeneration(m.carriers,r.population,hasSkill(w,r.owner,'records')&&r.social.access>=.35);
  }
  living.memories = living.memories.filter(m => m.carriers > 0);
  for (const move of w.geography.movements) {
    if (move.year !== w.year) continue;
    const sourcePop = region(w, move.from).population + move.people;
    const memories = living.memories.filter(m => m.site === move.from);
    for (const m of memories) {
      const travellers = Math.min(m.carriers, Math.floor(move.people * m.carriers / Math.max(1, sourcePop)));
      if (!travellers) continue;
      m.carriers -= travellers;
      remember(w, move.to, m.fact, travellers, m.opinion, 'переселение', move.from, m.origin, m.weight, m.evidence,m);
    }
  }
  living.memories = living.memories.filter(m => m.carriers > 0);
  const stillInTransit = new Set(w.economy.shipments.map(s => s.id));
  for (const delivery of dueShipments.get(w) ?? []) {
    if (stillInTransit.has(delivery.id) || delivery.amount < 30) continue;
    const source = fieldEdition(w) ? delivery.testimony : living.memories.filter(m => m.site === delivery.from && m.received < w.year)
      .sort((a, b) => b.weight - a.weight || b.carriers - a.carriers || a.received - b.received)[0];
    if (source) remember(w, delivery.to, source.fact, Math.min(source.carriers, Math.ceil(delivery.amount / 50)),
      source.opinion, 'обмен', delivery.from, source.origin, source.weight, source.evidence,source);
  }
  dueShipments.delete(w);
  for (const e of Archive.eventsAfter(w, living.eventCursor)) {
    if(fieldEdition(w)&&e.type==='conflict')rememberConflict(w,e);
    if (e.type !== 'diplomacy' || e.title !== 'Торговый договор') continue;
    for (const id of e.entityIds) {
      const s = w.societies.find(society => society.id === id);
      if (s) remember(w, s.capitalId, e.id, region(w, s.capitalId).population * .12, 'договор о торговле', 'очевидцы');
    }
  }
  living.eventCursor = w.nextEvent - 1;
  // A locally used road name can persist after the last person who knew its
  // explanation. Keep at most one established name per settlement.
  living.roadNames ??= [];
  for(const name of living.roadNames){
    if(name.silent===null && !region(w,name.site).population)name.silent=w.year;
  }
  for(const m of living.memories){
    if(m.via!=='переселение'||m.origin===m.site||w.year-m.received<40||m.carriers<8||living.roadNames.some(n=>n.site===m.site))continue;
    const origin=region(w,m.origin);
    living.roadNames.push({site:m.site,fact:m.fact,origin:m.origin,year:w.year,silent:null,
      name:'Дорога «'+origin.settlement.name+'»'});
  }
}

export function afterYear(w) {
  if(fieldEdition(w)){
    const living=w.observatory.living;
    for(const cargo of w.economy.shipments){
      if(cargo.departure!==w.year||cargo.amount<30)continue;
      const source=living.memories.filter(m=>m.site===cargo.from&&m.received<=cargo.departure)
        .sort((a,b)=>b.weight-a.weight||b.carriers-a.carriers||a.received-b.received)[0];
      if(source)cargo.testimony=structuredClone(source);
    }
  }
  advanceMemories(w);
  const b = w.observatory.living.basin;
  if (b) {
    build(w, b);
    if(fieldEdition(w))salvage(w,b);
    discover(w, b);
  }
}

export function summary(w, year = w.year) {
  if (!Number.isSafeInteger(year) || year < 0 || year > w.year) throw new Error('Недоступный год наблюдения.');
  const living = w.observatory?.living;
  if (!living) return {year, available: false, basin: null, facts: [], traces: [], memories: []};
  const exact = year === w.year ? living : w.snapshots?.find(s => s.year === year)?.observatory?.living;
  const facts = living.facts.filter(f => f.year <= year);
  const visible = living.traces.filter(t => t.formed <= year && (t.lost === null || t.lost > year));
  return structuredClone({
    year, available: true, exact: !!exact, basin: exact?.basin ?? null,
    roadNames:(exact?.roadNames??[]).filter(n=>n.silent===null).map(n=>{
      const witness=exact.memories.find(m=>m.site===n.site&&m.fact===n.fact);
      return {site:n.site,year:n.year,name:n.name,origin:witness?n.origin:null,fact:witness?n.fact:null};
    }),
    facts: facts.map(f => ({...f, title: FACT_NAMES[f.kind]})),
    traces: visible.map(t => ({...t, discovered: t.discovered <= year ? t.discovered : null, lost: null})),
    memories: (exact?.memories ?? []).map(m => {
      const source = m.fact.startsWith('river-') ? facts.find(f => f.id === m.fact) : Archive.eventById(w, m.fact, year);
      return {...m, sourceYear: source?.year ?? null, title: FACT_NAMES[source?.kind] ?? source?.title ?? ''};
    })
  });
}

// Each inference uses only the selected, surviving and already identified traces.
export function investigate(w,claim,ids){
  const data=summary(w),chosen=new Set(ids),facts=new Map(data.facts.map(f=>[f.id,f]));
  const sources=data.traces.filter(t=>chosen.has(t.id)&&t.discovered!==null).map(t=>({trace:t,fact:facts.get(t.source)})).filter(x=>x.fact);
  const questions=[
    ['founder','Инициатор стройки','foundation','owner'],
    ['payer','Плательщик по сохранившемуся реестру','payment','owner'],
    ['purpose','Исходное назначение','foundation','purpose'],
    ['finisher','Владелец при завершении','completed','owner']
  ];
  return questions.map(([key,title,kind,field])=>{
    const evidence=sources.filter(s=>s.fact.kind===kind&&s.fact[field]!=null);
    const status=!claim[key]||!evidence.length?'unknown':evidence.some(s=>s.fact[field]!==claim[key])?'contradicted':'confirmed';
    return {key,title,status,sources:evidence.map(s=>({trace:s.trace.id,kind:s.trace.kind,record:s.fact.id,year:s.fact.year,value:s.fact[field]}))};
  });
}

export function validate(w) {
  const fail = message => { throw new Error('Некорректная история места: ' + message); };
  const living = w.observatory?.living;
  const count = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const sites = new Set(w.regions.map(r => r.id));
  const societies = new Set(w.societies.map(s => s.id));
  // Other edition hooks may append an event after this year's memory pass
  // (including the origin event immediately following initialization).
  if (!living || living.version !== 1 || !count(living.eventCursor, w.nextEvent - 1)
    || Archive.eventsAfter(w, living.eventCursor).some(e => e.year !== w.year)) fail('версия или курсор');
  if (!Array.isArray(living.facts) || living.facts.length > w.year * (fieldEdition(w)?9:6) || !Array.isArray(living.traces)
    || living.traces.length > (fieldEdition(w)?5:4) || !Array.isArray(living.memories) || living.memories.length > sites.size * MEMORY_SLOTS) fail('размеры истории');
  const facts = new Map(), traces = new Map();
  let lastYear = 0;
  for (const [i, fact] of living.facts.entries()) {
    if (!fact || fact.id !== 'river-' + (i + 1) || !Object.hasOwn(FACT_NAMES, fact.kind) || !fieldEdition(w)&&['purpose','payment','dismantled'].includes(fact.kind) || !sites.has(fact.site)
      || !count(fact.year, w.year) || fact.year < lastYear || fact.year === 0) fail('запись');
    for (const key of ['owner', 'founder', 'previousOwner']) if (key in fact && !societies.has(fact[key])) fail('общество записи');
    for (const key of ['downstream', 'newOutlet']) if (key in fact && !sites.has(fact[key])) fail('место записи');
    facts.set(fact.id, fact);
    lastYear = fact.year;
  }
  const basin = living.basin;
  if (basin === null && (living.facts.length || living.traces.length)) fail('объекты без бассейна');
  if (basin !== null) {
    const edge = w.geography.edges.find(e => e.id === basin?.edge);
    if (!edge || basin.upper === basin.lower || ![edge.a, edge.b].includes(basin.upper) || ![edge.a, edge.b].includes(basin.lower)
      || !unit(basin.silt) || !unit(basin.flow) || !unit(basin.drop) || typeof basin.diverted !== 'boolean'
      || basin.blockedEdge !== null && basin.blockedEdge !== basin.edge) fail('бассейн');
    if (basin.alternate !== null && (!sites.has(basin.alternate) || [basin.upper, basin.lower].includes(basin.alternate)
      || !w.geography.edges.some(e => [e.a, e.b].includes(basin.upper) && [e.a, e.b].includes(basin.alternate)))) fail('обход русла');
    if (basin.diverted && !basin.alternate) fail('новое русло');
    if (basin.ecology!==undefined) {
      const members=[basin.upper,basin.lower,basin.alternate].filter(Boolean);
      if (!basin.ecology||Object.keys(basin.ecology).length!==members.length) fail('растительность бассейна');
      for (const id of members){
        const e=basin.ecology[id];
        if(!e||!count(e.dryYears,w.year)||!Number.isFinite(e.vegetationChange)||Math.abs(e.vegetationChange)>.026)fail('маловодье бассейна');
      }
    }
    if (basin.crossingLost !== undefined && facts.get(basin.crossingLost)?.kind !== 'closed') fail('след старой переправы');
    for (const f of living.facts) if (['closed', 'opened'].includes(f.kind) && f.edge !== basin.edge) fail('изменение пути');
    const p = basin.project;
    if (p !== null) {
      if (!p || p.site !== basin.upper || !societies.has(p.founder) || !societies.has(p.owner)
        || !count(p.started, w.year) || p.started < 1 || !count(p.lastWorked, w.year) || p.lastWorked < p.started
        || !count(p.yearsPaid, p.lastWorked - p.started + 1) || p.yearsPaid < 1
        || p.required !== 100 + Math.ceil(basin.drop * 70) || !count(p.labor, p.yearsPaid * 18) || p.labor < p.yearsPaid * 6
        || !(['building', 'paused', 'completed'].includes(p.status)||fieldEdition(w)&&p.status==='dismantled')) fail('стройка');
      if (p.completed !== null && (p.completed !== p.lastWorked || p.labor < p.required)
        || (p.status === 'completed') !== (p.completed !== null) || p.completed === null && p.labor >= p.required) fail('завершение стройки');
      for (const [key, amount] of Object.entries(MATERIALS)) {
        if (!Number.isFinite(p.spent?.[key]) || Math.abs(p.spent[key] - p.yearsPaid * amount) > 1e-7) fail('затраты стройки');
      }
      if (!living.facts.some(f => f.kind === 'foundation' && f.year === p.started && f.owner === p.founder)
        || p.completed !== null && !living.facts.some(f => f.kind === 'completed' && f.year === p.completed)) fail('хроника стройки');
      if(fieldEdition(w)){
        const purposes=['irrigation','passage'],foundation=facts.get(p.id);
        if(foundation?.kind!=='foundation'||foundation.purpose!==p.originalPurpose||!purposes.includes(p.purpose)||!Array.isArray(p.payments)||p.payments.length!==p.yearsPaid||!Array.isArray(p.decisions)||!p.decisions.length||p.decisions.length>w.year)fail('журнал стройки');
        let paidYear=0,labor=0,owner=p.founder,purpose=p.originalPurpose,cursor=0;
        const changes=living.facts.filter(f=>f.kind==='ownership'||f.kind==='purpose');
        const payment=facts.get(p.accountRecord);
        for(const a of p.payments){
          while(cursor<changes.length&&changes[cursor].year<=a.year){
            const f=changes[cursor++];
            if(f.kind==='ownership'){if(f.previousOwner!==owner)fail('прежний владелец');owner=f.owner;}
            else {if(f.previous!==purpose||!purposes.includes(f.purpose)||f.owner!==owner)fail('изменение назначения');purpose=f.purpose;}
          }
          if(!count(a?.year,p.lastWorked)||a.year<=paidYear||!societies.has(a.owner)||!purposes.includes(a.purpose)||!count(a.crew,18)||a.crew<6||Object.entries(MATERIALS).some(([k,v])=>Math.abs(a[k]-v)>1e-8||!Number.isFinite(a[k])))fail('платёж стройки');
          if(a.owner!==owner||a.purpose!==purpose)fail('плательщик и назначение');
          if(payment?.year===a.year&&(payment.owner!==owner||payment.purpose!==purpose||payment.crew!==a.crew||Object.keys(MATERIALS).some(k=>payment[k]!==a[k])))fail('содержание реестра');
          paidYear=a.year;labor+=a.crew;
        }
        if(labor!==p.labor||p.payments[0].year!==p.started||paidYear!==p.lastWorked||p.payments.at(-1).purpose!==p.purpose)fail('сумма работ');
        let decisionYear=0;
        for(const d of p.decisions){
          if(!count(d?.year,w.year)||d.year<=decisionYear||!societies.has(d.owner)||typeof d.reason!=='string'||!d.reason||d.reason.length>100)fail('решение стройки');
          decisionYear=d.year;
        }
        if(p.accountRecord!==undefined&&(payment?.kind!=='payment'||!p.payments.some(a=>a.year===payment.year)))fail('источник платежа');
      }
    }
  }
  if(fieldEdition(w)){
    const p=basin?.project,removed=p?.dismantled;
    if(!!removed!==(p?.status==='dismantled'))fail('состояние разобранной стройки');
    if(removed){
      const f=facts.get(removed.source);
      if(!f||f.kind!=='dismantled'||f.year!==removed.year||f.owner!==removed.owner||f.project!==p.id||f.raw!==removed.raw||!societies.has(removed.owner)||removed.year<p.lastWorked+25||removed.raw!==Math.floor(p.spent.raw*.5*1000)/1000)fail('акт разбора');
    }
    if(w.economy.cumulative.reclaimed.raw!==(removed?.raw??0)||w.economy.ledger.reclaimed.raw!==(removed?.year===w.year?removed.raw:0))fail('баланс разобранного материала');
  }
  for (const [i, t] of living.traces.entries()) {
    const f = facts.get(t?.source);
    const expectedKind = {'кладка опоры': 'foundation', 'пазы водосброса': 'completed', 'старый берег': 'diversion',
      'остатки причала': 'closed', 'насыпь старой дороги': 'closed'};
    if(fieldEdition(w))expectedKind['реестр поставок']='payment';
    if (!f || t.id !== 'trace-' + (i + 1) || f.kind !== expectedKind[t.kind] || t.site !== f.site || t.formed !== f.year) fail('след');
    for (const [key, kind] of [['discovered', 'discovery'], ['lost', 'lost']]) {
      if (t[key] !== null && (!count(t[key], w.year) || t[key] < t.formed
        || !living.facts.some(f => f.kind === kind && f.trace === t.id && f.year === t[key]))) fail('дата следа');
    }
    if (t.discovered !== null && t.lost !== null && t.discovered >= t.lost) fail('обнаружение утраченного следа');
    traces.set(t.id, t);
  }
  for (const f of living.facts) if (['lost', 'discovery'].includes(f.kind) && !traces.has(f.trace)) fail('ссылка на след');
  if(living.roadNames!==undefined){
    if(!Array.isArray(living.roadNames)||living.roadNames.length>sites.size)fail('местные названия');
    const named=new Set();
    for(const n of living.roadNames){
      const source=facts.get(n?.fact)??Archive.eventById(w,n?.fact);
      if(!n||!sites.has(n.site)||!sites.has(n.origin)||n.site===n.origin||named.has(n.site)||!source||!count(n.year,w.year)||n.year<source.year+40
        ||typeof n.name!=='string'||!n.name.length||n.name.length>180||n.silent!==null&&(!count(n.silent,w.year)||n.silent<n.year))fail('название дороги');
      named.add(n.site);
    }
  }
  const seen = new Set(), slots = new Map();
  if(fieldEdition(w))for(const cargo of w.economy.shipments){
    const m=cargo.testimony;if(!m)continue;
    const f=facts.get(m.fact)??Archive.eventById(w,m.fact,cargo.departure);
    if(!f||f.year>cargo.departure||m.site!==cargo.from||!count(m.received,cargo.departure)||m.received<f.year||!sites.has(m.origin)||!count(m.carriers,1e12)||m.carriers<1
      ||typeof m.opinion!=='string'||m.opinion.length>128||![1,2].includes(m.weight)||!Array.isArray(m.handovers)||m.handovers.length>MAX_HANDOVERS||!m.handovers.length||m.handovers.some(h=>!Array.isArray(h)||!sites.has(h[0])||!count(h[1],cargo.departure))
      ||m.evidence&&(!traces.has(m.evidence.trace)||!count(m.evidence.year,cargo.departure)))fail('свидетельство в грузе');
  }
  for (const m of living.memories) {
    if (!m || !sites.has(m.site) || !sites.has(m.origin) || m.from !== null && !sites.has(m.from)
      || !['очевидцы', 'переселение', 'обмен', 'находка'].includes(m.via) || ['переселение','обмен'].includes(m.via) !== (m.from !== null)
      || typeof m.opinion !== 'string' || m.opinion.length > 128 || !count(m.received, w.year)
      || !count(m.carriers, region(w, m.site).population) || m.carriers < 1 || ![1, 2].includes(m.weight)) fail('носитель');
    const f = facts.get(m.fact) ?? Archive.eventById(w, m.fact);
    if (!f || m.received < f.year || seen.has(m.site + '/' + m.fact)) fail('источник памяти');
    if(fieldEdition(w)&&m.basis){
      const b=m.basis,source=Archive.eventById(w,b.record,m.received);
      if(!source||source.type!=='conflict'||source.year!==b.year||!sites.has(b.site)||b.site!==m.origin
        ||!['paid','received','occupation','boundary','relief'].includes(b.kind)
        ||(['paid','received','occupation'].includes(b.kind)?(!Number.isFinite(b.value)||b.value<0):b.value!==null))fail('местное основание свидетельства');
      if(['occupation','boundary','relief'].includes(b.kind)&&!source.regionIds?.includes(b.site))fail('место свидетельства');
    }
    if(m.handovers!==undefined){
      if(!Array.isArray(m.handovers)||!m.handovers.length||m.handovers.length>MAX_HANDOVERS||!count(m.omitted,w.year*w.regions.length))fail('цепочка передачи');
      let priorYear=f.year;
      for(const hop of m.handovers){
        if(!Array.isArray(hop)||hop.length!==3||!sites.has(hop[0])||!count(hop[1],m.received)||hop[1]<priorYear||!['очевидцы','переселение','обмен','находка'].includes(hop[2]))fail('источник передачи');
        priorYear=hop[1];
      }
      const last=m.handovers.at(-1),prior=m.handovers.at(-2);
      if(last[0]!==m.site||last[1]!==m.received||last[2]!==m.via||prior&&prior[0]!==m.from||m.omitted>0&&m.handovers.length!==MAX_HANDOVERS)fail('последняя передача');
    }
    if (m.evidence !== null && (!m.evidence || !traces.has(m.evidence.trace)
      || traces.get(m.evidence.trace).source !== m.fact || traces.get(m.evidence.trace).discovered !== m.evidence.year)) fail('подтверждение памяти');
    seen.add(m.site + '/' + m.fact);
    slots.set(m.site, (slots.get(m.site) ?? 0) + 1);
    if (slots.get(m.site) > MEMORY_SLOTS) fail('число местных преданий');
  }
  return true;
}
