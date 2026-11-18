import * as Archive from '../../simulator-v08/src/archive.mjs';

const amount=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const n=value=>amount.format(value);
const knownYear=(value,end)=>Number.isSafeInteger(value)&&value>=0&&value<=end;
const purpose=id=>({irrigation:'снабжение хозяйств водой',passage:'сохранение переправы'})[id];
const climateLine=/^Урожайность региона (r[0-9]+) снижена до ([0-9]+) года\.$/u;

function placeNames(world){
  const groups=new Map(),names=new Map();
  for(const r of world.regions??[]){
    const name=r.settlement?.name||'Поселение';
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(r);
  }
  for(const [name,sites] of groups){
    const used=new Map();
    for(const r of sites){
      let label=name;
      if(sites.length>1&&Number.isFinite(r.lat)&&Number.isFinite(r.lon)){
        label+=' ('+n(Math.abs(r.lat))+'° '+(r.lat<0?'ю. ш.':'с. ш.')+', '+n(Math.abs(r.lon))+'° '+(r.lon<0?'з. д.':'в. д.')+')';
      }
      if(!used.has(label))used.set(label,[]);
      used.get(label).push(r.id);
    }
    for(const [label,ids] of used)ids.sort().forEach((id,i)=>names.set(id,ids.length>1?label+' · участок '+(i+1):label));
  }
  return names;
}

export function placeName(world,id){return placeNames(world).get(id)??'Неизвестное место';}

function locations(event,names,disasterSites){
  const sites=new Set((event.regionIds??[]).filter(id=>names.has(id)));
  if(event.movement)for(const id of [event.movement.from,event.movement.to])if(names.has(id))sites.add(id);
  if(event.type==='climate'&&event.title==='Региональная засуха'){
    // The released engines wrote the region into a fixed message and kept the
    // latest event ID in the region. Never infer a location from society alone.
    const id=disasterSites.get(event.id)??climateLine.exec(event.detail??'')?.[1];
    if(names.has(id))sites.add(id);
  }
  return [...sites];
}

function geography(world){
  const names=placeNames(world),disasters=new Map();
  for(const r of world.regions??[])if(r.disasterEventId)disasters.set(r.disasterEventId,r.id);
  return {names,disasters};
}

function* recordedEvents(world){
  if(Array.isArray(world.eventArchive)&&Array.isArray(world.events)){
    yield* Archive.iterateEvents(world,{throughYear:world.year});
  }else for(const e of world.events??[])if(knownYear(e.year,world.year))yield e;
}

export function eventPlaces(world,event){
  if(!event||!knownYear(event.year,world.year))return [];
  const {names,disasters}=geography(world);
  return locations(event,names,disasters);
}

export function eventDetail(world,event){
  if(!event||!knownYear(event.year,world.year))return '';
  const {names,disasters}=geography(world),sites=locations(event,names,disasters),m=event.movement;
  if(m&&names.has(m.from)&&names.has(m.to)){
    const owners=new Map(world.societies.map(s=>[s.id,s.name]));
    const a=owners.get(m.fromOwner),b=owners.get(m.toOwner);
    const societies=a&&b?' '+(a===b?'В пределах общества «'+a+'».':'Из общества «'+a+'» в общество «'+b+'».'):'';
    return 'Путь переселения — «'+names.get(m.from)+'» → «'+names.get(m.to)+'». Число переселенцев — '+n(m.people)+'.'+societies+
      (Number.isFinite(m.distance)?' Длина пути — '+n(Math.round(m.distance))+' условных км.':'');
  }
  if(event.type==='climate'&&event.title==='Региональная засуха'&&sites.length===1){
    const copy=eventCopy(event,sites[0],{names,year:world.year},new Map());
    return copy.text+' '+copy.detail;
  }
  const detail=String(event.detail??'').replace(/\br\d+\b/gu,key=>names.has(key)?'«'+names.get(key)+'»':'участок без названия');
  if(sites.length===1){
    const site=world.regions.find(r=>r.id===sites[0]),literal=site?.settlement?.name,qualified=names.get(sites[0]);
    if(literal&&literal!==qualified){
      for(const verb of [' занят',' передан']){
        const phrase='Регион '+literal+verb;
        if(detail.includes(phrase))return detail.replace(phrase,'Регион «'+qualified+'»'+verb);
      }
      return detail+' Место записи — «'+qualified+'».';
    }
  }
  return detail;
}

export function placeSubject(world,preferredId){
  const {names,disasters}=geography(world);
  if(names.has(preferredId))return preferredId;
  const upper=world.observatory?.living?.basin?.upper;
  if(names.has(upper))return upper;
  const seen=new Map();let first=null,firstClimate=null;
  for(const e of recordedEvents(world)){
    const sites=locations(e,names,disasters);
    for(const id of sites){
      first??=id;
      if(e.type==='climate')firstClimate??=id;
      if((e.causeEventIds??[]).some(key=>seen.get(key)?.includes(id)))return id;
    }
    if(sites.length)seen.set(e.id,sites);
  }
  return firstClimate??first??world.regions.find(r=>r.population>0)?.id??world.regions[0]?.id??null;
}

function eventCopy(e,id,ctx,local){
  const name=ctx.names.get(id),m=e.movement;
  if(m&&(id===m.from||id===m.to)){
    const from=ctx.names.get(m.from),to=ctx.names.get(m.to);
    if(!from||!to)return null;
    const incoming=id===m.to,links=(e.causeEventIds??[]).filter(k=>local.has(k));
    const drought=links.map(k=>local.get(k)).find(x=>x.type==='climate'&&x.title==='Региональная засуха');
    return {kind:'movement',title:(incoming?'Прибыли переселенцы':'Отправились переселенцы'),source:'Запись о переселении',
      text:'«'+from+'» → «'+to+'». Число переселенцев — '+n(m.people)+'.',
      detail:drought?'Запись о переселении ссылается на местную засуху '+drought.year+' года.':'Архив указывает место отправления, место прибытия и число людей.',
      relatedIds:links.map(key=>'event:'+key)};
  }
  if(e.type==='climate'&&e.title==='Региональная засуха'){
    const line=climateLine.exec(e.detail??''),end=line?Number(line[2]):null;
    return {kind:'drought',title:'Началась засуха',source:'Климатическая хроника',
      text:'В районе поселения «'+name+'» модель снизила урожайность.',
      detail:end!==null&&end<=ctx.year?'В исходной записи срок снижения урожайности указан по '+end+' год.':'Запись датирует начало засухи. Размер потерь урожая в ней не указан.'};
  }
  if(e.title==='Оккупация региона')return {kind:'occupation',title:'Поселение занято',source:'Хроника конфликта',
    text:'Войска заняли район поселения «'+name+'».',detail:'На момент занятия юридическая принадлежность региона сохранялась.'};
  if(e.title==='Мирное соглашение')return {kind:'peace',title:'Изменилась граница',source:'Мирное соглашение',
    text:'Район поселения «'+name+'» передали по мирному соглашению.',detail:'Регион указан в записи соглашения как переданная сторонами территория.'};
  if(e.title==='Возникло новое государство')return {kind:'state',title:'Возникло новое государство',source:'Политическая хроника',
    text:'Район поселения «'+name+'» вошёл в новое государство.',detail:'Место входит в список регионов, отделившихся в этом году.'};
  return {kind:'event',title:e.title,source:'Хроника',text:'Место прямо указано в записи «'+e.title+'».',detail:'Запись за '+e.year+' год.'};
}

function localFact(f,ctx){
  const owner=ctx.societies.get(f.owner),who=owner?'Общество «'+owner+'». ':'';
  const name=ctx.names.get(f.site),trace=ctx.traces.get(f.trace);
  switch(f.kind){
  case 'foundation':return ['Начались работы на реке',who+(purpose(f.purpose)?'Исходное назначение — '+purpose(f.purpose)+'.':'В районе поселения заложили опоры плотины.'),'Запись о начале стройки'];
  case 'payment':return ['Оплачены работы',who+'На стройку передали пищу ('+n(f.food)+'), сырьё ('+n(f.raw)+') и оборудование ('+n(f.equipment)+').','Реестр поставок'];
  case 'ownership':return ['Сменился владелец стройки','Прежний владелец — '+(ctx.societies.get(f.previousOwner)??'общество из архива')+'. Новый владелец — '+(owner??'общество из архива')+'.','Запись о владении'];
  case 'purpose':return ['Изменилось назначение стройки','Прежняя цель — '+purpose(f.previous)+'. Новая — '+purpose(f.purpose)+'. Основание в записи — '+f.reason+'.','Решение о стройке'];
  case 'completed':return ['Стройка завершена',who+'На участке поселения «'+name+'» завершены работы.','Запись о завершении'];
  case 'dismantled':return ['Разобраны опоры',who+'На склад вернули сырьё — '+n(f.raw)+' ед.','Акт разбора'];
  case 'diversion':return ['Вода нашла другое русло','Участок прежнего русла изменился. Новый сток направлен к месту «'+(ctx.names.get(f.newOutlet)??'соседнее поселение')+'».','История русла'];
  case 'opened':case 'closed':return [f.kind==='opened'?'Переправа снова доступна':'Переправа закрылась','Изменилась природная проходимость переправы у поселения «'+name+'».','История пути'];
  case 'discovery':case 'lost':
    if(!trace||!knownYear(trace.formed,f.year)||trace.site!==f.site)return null;
    return [(f.kind==='discovery'?'Опознан след «':'Утрачен след «')+trace.kind+'»','Год образования следа — '+trace.formed+'.','Датированная запись о следе'];
  default:return null;
  }
}

/** Read the supplied live world or exact historical snapshot, without advancing it. */
export function placeRecords(world,regionId){
  const {names,disasters}=geography(world);
  if(!names.has(regionId))return [];
  const living=world.observatory?.living,year=world.year,siteName=names.get(regionId);
  const ctx={names,year,societies:new Map(world.societies.map(s=>[s.id,s.name])),
    traces:new Map((living?.traces??[]).filter(t=>knownYear(t.formed,year)).map(t=>[t.id,t]))};
  const result=[],local=new Map();
  function put(id,date,sourceId,copy){
    if(copy&&knownYear(date,year))result.push({id,year:date,regionId,sourceId,detail:'',relatedIds:[],...copy});
  }
  for(const e of recordedEvents(world)){
    if(!locations(e,names,disasters).includes(regionId))continue;
    put('event:'+e.id,e.year,e.id,eventCopy(e,regionId,ctx,local));
    local.set(e.id,e);
  }
  const facts=new Map((living?.facts??[]).filter(f=>knownYear(f.year,year)).map(f=>[f.id,f]));
  for(const f of facts.values()){
    if(f.site!==regionId)continue;
    const copy=localFact(f,ctx);
    if(!copy)continue;
    const [title,text,source]=copy,t=ctx.traces.get(f.trace);
    put('river:'+f.id,f.year,f.id,{kind:f.kind,title,text,source,detail:source+' · '+siteName+' · '+f.year+' год.',
      relatedIds:t&&facts.has(t.source)&&facts.get(t.source).site===regionId?['river:'+t.source]:[]});
  }
  for(const m of living?.memories??[]){
    if(m.site!==regionId||!knownYear(m.received,year))continue;
    const f=facts.get(m.fact)??(Array.isArray(world.eventArchive)&&Array.isArray(world.events)?Archive.eventById(world,m.fact,m.received):
      (world.events??[]).find(e=>e.id===m.fact&&knownYear(e.year,m.received)));
    if(!f||f.year>m.received||!['переселение','обмен'].includes(m.via)||!names.has(m.from))continue;
    put('memory:'+m.fact+':'+m.received+':'+m.site,m.received,m.fact,{kind:'memory',title:'До общины дошёл рассказ',source:'Свидетельство общины',
      text:'Сообщение пришло из поселения «'+names.get(m.from)+'». Канал передачи — '+m.via+'.',
      detail:'Год исходной записи — '+f.year+'. Год передачи рассказа этой общине — '+m.received+'.'});
  }
  for(const ret of world.observatory?.space?.returns??[]){
    if(ret.region!==regionId||!knownYear(ret.arrival,year))continue;
    const name=world.colonies.find(c=>c.id===ret.origin)?.name;
    put('arrival:'+ret.mission,ret.arrival,ret.mission,{kind:'arrival',title:'Прибыла экспедиция с колонии',source:'Журнал возвращений',
      text:name?'В «'+siteName+'» прибыла экспедиция колонии «'+name+'».':'Район поселения принял экспедицию с колонии.',
      detail:'Вылет зафиксирован в '+ret.year+' году, прибытие — в '+ret.arrival+' году.'});
  }
  return result.sort((a,b)=>a.year-b.year);
}
