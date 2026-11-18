// Each selectable item describes a region-level record; individual drawn buildings have no model identity.
const number = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});
const count = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0});
const percent = value => number.format(value * 100) + ' %';
const names = {forest:'Лес', grassland:'Луга', drylands:'Засушливые земли', highlands:'Горная местность', tundra:'Тундра'};
const sizes = {village:'Сельское поселение', town:'Городское поселение', city:'Крупный город'};
const purposes = {irrigation:'снабжение хозяйств водой', passage:'сохранение переправы'};
const dated = (value, year) => Number.isSafeInteger(value) && value >= 0 && value <= year;
const measured = value => Number.isFinite(value) ? value : null;

function routeEntries(world, site) {
  const transport = new Map((world.economy?.routes ?? []).map(route => [route.id, route]));
  return (world.geography?.edges ?? []).filter(edge => edge.a === site || edge.b === site).map(edge => {
    const actual = transport.get(edge.id);
    return {
      id:edge.id, kind:edge.kind, to:edge.a === site ? edge.b : edge.a,
      distance:measured(edge.distance), used:measured(actual?.used), condition:measured(actual?.condition)
    };
  }).sort((a,b) => a.id<b.id?-1:a.id>b.id?1:0);
}

function describeProject(living, site, year, record) {
  const basin = living?.basin, p = basin?.project;
  if (basin?.upper !== site || !p || p.site !== site || !dated(p.started, year)) return null;
  const dismantled = dated(p.dismantled?.year, year);
  const completed = dated(p.completed, year);
  const phase = dismantled ? 'dismantled' : completed ? 'completed' : p.status === 'paused' ? 'paused' : 'building';
  const purpose = Object.hasOwn(purposes,p.purpose) ? p.purpose : null;
  const name = purpose === 'irrigation' ? 'Оросительная плотина' : purpose === 'passage' ? 'Переправа' : 'Речное сооружение';
  const label = {building:'Строительная площадка', paused:'Приостановленная стройка', completed:name, dismantled:'Разобранная стройка'}[phase];
  const relevant = new Set(['foundation','ownership','purpose','payment','completed','dismantled']);
  const facts = (living.facts ?? []).filter(f => f.site === site && f.year >= p.started && dated(f.year,year) && relevant.has(f.kind));
  const decision = (p.decisions ?? []).findLast(item => dated(item.year, year));
  const origin = facts.find(f => f.kind === 'foundation');
  const payments = (p.payments ?? []).filter(item => dated(item.year,year));
  const lastPay = payments.at(-1);
  const change = facts.findLast(f => f.kind === 'purpose');
  const last = facts.at(-1);
  const source = phase === 'dismantled' ? facts.findLast(f=>f.kind==='dismantled') :
    phase === 'completed' ? facts.findLast(f=>f.kind==='completed') : origin;
  const need = measured(p.required), labor = measured(p.labor);
  const reason = phase === 'dismantled' ? 'Разобраны ранее оплаченные опоры.' :
    phase === 'completed' ? (need !== null && labor !== null && labor >= need ? 'Накоплен требуемый объём труда.' : 'Завершение отмечено в реестре.') :
    decision?.reason ?? null;
  const details = ['Год закладки — '+p.started+'.'];
  if (purpose) details.push('Назначение — '+purposes[purpose]+'.');
  if (change && change.purpose === purpose && change.reason) details.push('В '+change.year+'-м году назначение изменилось. Основание — '+change.reason+'.');
  if (labor !== null && need !== null) details.push('Вложено труда '+number.format(labor)+' при требуемых '+number.format(need)+'.');
  if (phase === 'completed') details.push('Год завершения — '+p.completed+'.');
  if (phase === 'dismantled') details.push('Разобрано в '+p.dismantled.year+'-м году'+(Number.isFinite(p.dismantled.raw)?', возвращено сырья '+number.format(p.dismantled.raw):'')+'.');
  if (phase === 'paused' && decision) details.push('Причина остановки в '+decision.year+'-м году — '+decision.reason+'.');
  if (phase === 'building' && lastPay) details.push('Последняя оплата работ — '+lastPay.year+'-й год.');
  const requested = typeof record?.id === 'string' ? record.id.replace(/^river:/,'') : null;
  const selected = requested && facts.find(f => f.id === requested);
  return {
    id:site+':project', kind:'project', label, evidence:details.join(' '), phase, purpose,
    started:p.started, completed:completed?p.completed:null, dismantled:dismantled?p.dismantled.year:null,
    progress:labor !== null && need > 0 ? Math.min(1,Math.max(0,labor/need)) : null,
    reason, labor, required:need, lastWorked:dated(p.lastWorked,year)?p.lastWorked:null,
    sourceId:source?.id??last?.id??null, recordIds:facts.map(f=>'river:'+f.id),
    selectedRecordId:selected?'river:'+selected.id:null
  };
}

/** Read the exact supplied world state. A region object from a different year
 * is resolved by its ID against this world; a newer dossier cannot supply facts. */
export function describeSettlement(world, region, record) {
  const regionId = typeof region === 'string' ? region : region?.id;
  const r = world?.regions?.find(item => item.id === regionId);
  if (!r || !Number.isSafeInteger(world.year)) return null;
  const year=world.year, st=r.settlement, population=Math.max(0,r.population??0);
  const inhabited=population>0 && !!st && dated(st.founded,year);
  const scale=inhabited && Object.hasOwn(sizes,st.kind) ? st.kind : 'empty';
  const infrastructure=measured(st?.infrastructure), specialty=inhabited?st.specialization:null;
  const density=inhabited ? Math.min(1,Math.sqrt(population/(population+6000))*(.65+.35*(infrastructure??0))) : 0;
  const society=world.societies?.find(s=>s.id===r.owner);
  const capability=key=>society?.knowledge?.some(k=>k.id===key&&k.active===true)??false;
  const living=world.observatory?.living, basin=living?.basin;
  const inBasin=!!basin && [basin.upper,basin.lower,basin.alternate].includes(r.id);
  const drought=!!r.disasterEventId && Number.isSafeInteger(r.disasterUntil) && year<=r.disasterUntil;
  const paths=routeEntries(world,r.id), seaPaths=paths.filter(p=>p.kind==='sea');
  const objects=[];
  const add=(kind,label,evidence,data={})=>objects.push({id:r.id+':'+kind,kind,label,evidence,...data});
  const name=st?.name??r.id,biome=names[r.biome]??'Местность';
  const geo=[biome+(r.coastal?', морское побережье':'')+'.'];
  if(Number.isFinite(r.water))geo.push('Водообеспеченность '+percent(r.water)+'.');
  if(inBasin)geo.push(r.id===basin.upper?'Здесь расположено верховье записанного речного бассейна.':
    r.id===basin.lower?'Участок исходного нижнего русла.':'Участок возможного отвода русла.');
  if(drought)geo.push('Засуха зарегистрирована до '+r.disasterUntil+' года.');
  if(!population)geo.push('В этом году постоянных жителей нет.');
  add('terrain',biome,geo.join(' '),{biome:r.biome,coastal:!!r.coastal,elevation:measured(r.elevation),
    water:measured(r.water),basin:inBasin,drought,droughtEventId:drought?r.disasterEventId:null});
  if(inhabited){
    add('housing','Жилые кварталы',(sizes[scale]??'Поселение')+' '+name+'. Население в выбранном году — '+count.format(population)+'.'+
      (infrastructure!==null?' Уровень инфраструктуры '+percent(infrastructure)+'.':''),{population,infrastructure,settlementId:st.id});
    if(specialty==='agriculture'){
      const harvest=measured(r.economy?.harvest);
      add('fields','Земледельческие угодья','В реестре поселения указано земледелие.'+
        (harvest!==null?' За выбранный год получено '+number.format(harvest)+' ед. продовольствия.':'')+
        (Number.isFinite(r.fertility)?' Плодородие '+percent(r.fertility)+'.':''),{harvest,fertility:measured(r.fertility)});
    }
    if(specialty==='mining'){
      const industrial=capability('industry'),reserves=measured(r.reserves);
      add('mine',industrial?'Промышленная добыча':'Добыча сырья','Специализация поселения — добыча сырья.'+
        (reserves!==null?' В регионе остаётся '+number.format(reserves)+' ед. запасов.':'')+
        (industrial?' Общество владеет промышленной технологией.':''),{industrial,reserves});
    }
    if(specialty==='crafts'){
      const industrial=capability('industry'),trained=capability('workshops');
      add('workshops','Ремесленные мастерские','В реестре поселения указаны ремёсла.'+
        (trained?' Общество освоило мастерские.':'')+(industrial?' Доступна промышленная технология.':''),
        {industrial,trained});
    }
    if(specialty==='administration')add('civic','Административный центр','У поселения записана административная специализация.'+
      (society?.capitalId===r.id?' Здесь находится столица общества '+society.name+'.':''),{capital:society?.capitalId===r.id});
  }
  const port=measured(r.economy?.port);
  if(r.coastal && port>0){
    const used=seaPaths.reduce((sum,p)=>sum+(p.used??0),0);
    add('harbor','Гавань','У побережья учтена портовая инфраструктура, её состояние '+percent(port)+'.'+
      (seaPaths.length?' Морских участков в сети — '+seaPaths.length+'.':'')+
      (used>0?' Суммарная грузовая нагрузка на эти участки за год — '+number.format(used)+' ед.':'')+
      (!population?' В регионе не числятся постоянные жители.':''),
      {port,seaRouteCount:seaPaths.length,seaRouteUse:used,inhabited});
  }
  if(paths.length){
    const landCount=paths.length-seaPaths.length,usedCount=paths.filter(p=>p.used>0).length;
    add('routes','Пути сообщения','В географической сети учтены сухопутные участки — '+landCount+', морские — '+seaPaths.length+'.'+
      (usedCount?' Участков с грузовой нагрузкой в выбранном году — '+usedCount+'.':''),
      {paths,landCount,seaCount:seaPaths.length,usedCount});
  }
  const project=describeProject(living,r.id,year,record);
  if(project)objects.push(project);
  return {year,regionId:r.id,name,population,scale,density,objects};
}
