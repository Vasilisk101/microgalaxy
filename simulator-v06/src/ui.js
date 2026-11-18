'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)], h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=new Intl.NumberFormat('ru-RU'), short=new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}), fmt=n=>nf.format(Math.round(n));
const typeNames={origin:'Начало истории',climate:'Природа',economy:'Хозяйство',science:'Знания',politics:'Политика',diplomacy:'Дипломатия',migration:'Миграции',conflict:'Конфликт',space:'Космос'};
let world,store,revision=0,view='planet',layer='nature',selectedPlanet='p2',selectedSociety=null,snapshotIndex=null,busy=false,running=false,speed=1,autoPause=true,worker=null,workerReady=false,pending=new Map(),serial=0,noticeTimer,sound=true,audio=null,filterType='all',filterQuery='';
let switching=false,localConflict=false,localUnsaved=false,changeGeneration=0,saveTail=Promise.resolve(),cloudSync,cloudTask=null,cloudTimer=null,cloudState='unknown',cloudIssue='',currentRecord=null,cloudCursor=null;
let filterSociety='all',eventOrder='recent',eventLimit=160,storySociety='all',storyQuery='',storyOrder='recent',storyLimit=40,diplomacySociety='all',diplomacyStatus='all',diplomacyOrder='trust',dialogReturnFocus=null,activeStory=null,storyEventLimit=80;
const cloudClient=Cloud.createCloudClient({timeoutMs:6000,validate:validateStoredWorld}),cloudRows=new Map();
let selectedRegion=null,regionSociety='all',regionKind='all',regionQuery='',regionOrder='population',regionLimit=60;
let economyRouteLimit=40,economyShipmentLimit=40;
function resetEconomyPages(){economyRouteLimit=40;economyShipmentLimit=40;}
let displayedCache=null;
const historyCaches=new WeakMap(),movementCaches=new WeakMap();
const centerKinds={village:'Сельский центр',town:'Малый город',city:'Крупный город'};
const specializations={agriculture:'Земледелие',mining:'Добыча',port:'Порт',administration:'Управление',crafts:'Ремесло'};
const catalogModels={v08:{label:'0.8',path:'/v08',db:'microgalaxy_conflicts_v08_v1'},v07:{label:'0.7',path:'/v07'},v06:{label:'0.6',path:'/v06'},v05:{label:'0.5',path:'/v05',db:'microgalaxy_geography_v05_v1'},v04:{label:'0.4',path:'/v04',db:'microgalaxy_history_v04_v1'},v03:{label:'0.3',path:'/v03',db:'microgalaxy_local_candidate_v1'},classic:{label:'0.1–0.2',path:'/classic',db:'microgalaxy-observatory-v1'}};
const catalogCloudRows=new Map(),catalogLocalRows=new Map();
let catalogState='unknown',catalogIssue='',catalogCursor=null,catalogModel='all',catalogQuery='',legacyLocalIssue='',catalogIndexing=false,requestedWorld=null;
function pref(key,value){try{if(value!==undefined)localStorage.setItem(key,value);return localStorage.getItem(key);}catch{return null;}}
const renderer=new Renderer($('#space-canvas'),id=>{selectedPlanet=id;view='planet';render();},id=>showSociety(id),id=>showRegion(id));
function notice(text,conflict=false){clearTimeout(noticeTimer);if(conflict&&$('#dialog').open)$('#dialog').close();else if($('#dialog').open){let alert=$('#dialog-notice');if(!alert){alert=document.createElement('p');alert.id='dialog-notice';alert.className='dialog-notice';alert.setAttribute('role','alert');$('#dialog-body').prepend(alert);}alert.textContent=text;$('#dialog').scrollTop=0;}$('#notice-text').textContent=text;$('#notice').hidden=false;$('#fork').hidden=!conflict;if(!conflict)noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},12000);}
function setRunning(value){running=!!(value&&!localConflict&&!switching&&snapshotIndex===null&&world?.year<Core.LIMITS.years);$('#play').innerHTML=running?'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zm5 0h3v10H9z"/></svg> Пауза':'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 13 8l-9 5.5z"/></svg> Наблюдать';$('#clock-status').textContent=snapshotIndex!==null?'Исторический срез':running?'Наблюдение':'На паузе';}
function displayed(){if(snapshotIndex===null)return world;if(displayedCache?.source!==world||displayedCache?.index!==snapshotIndex)displayedCache={source:world,index:snapshotIndex,value:Core.viewSnapshot(world,snapshotIndex)};return displayedCache.value;}
function historyData(w){let cache=historyCaches.get(w);if(!cache){const events=Core.allEvents(w);cache={events,byId:new Map(events.map(e=>[e.id,e])),indexes:new Map(events.map((e,i)=>[e.id,i])),stories:null,missions:null};historyCaches.set(w,cache);}return cache;}
function worldStories(w){const cache=historyData(w);return cache.stories??(cache.stories=Core.storylines(w));}
function worldMissions(w){const cache=historyData(w);return cache.missions??(cache.missions=Core.allMissions(w));}
function recentEvents(w){const pages=Core.eventPageCount(w);let events=pages?Core.eventPage(w,pages-1):[];if(events.length<2&&pages>1)events=[...Core.eventPage(w,pages-2),...events];return events.slice(-2);}
function recentMovements(w){
  let rows=movementCaches.get(w);if(rows)return rows;
  rows=[];const earliest=Math.max(0,w.year-9);
  for(let i=Core.eventPageCount(w)-1;i>=0;i--){const page=Core.eventPage(w,i);for(const e of page)if(e.movement&&e.year>=earliest&&e.year<=w.year)rows.push(e.movement);if(page.length&&page[0].year<earliest)break;}
  rows.sort((a,b)=>b.year-a.year);movementCaches.set(w,rows);return rows;
}
function movementPeriod(w){return 'годы '+Math.max(0,w.year-9)+'–'+w.year;}
function regionName(w,id){const r=w.regions.find(r=>r.id===id);if(!r)return id;const name=r.settlement?.name??r.name??r.id;return name+(w.regions.some(other=>other.id!==id&&(other.settlement?.name??other.name??other.id)===name)?' · '+r.id:'');}
function regionButton(w,id,label){return '<button class="region-link" data-region="'+h(id)+'">'+h(label??regionName(w,id))+'</button>';}
function modelPath(model,id,source='auto'){if(!catalogModels[model])throw new Error('Неизвестная модель мира.');return catalogModels[model].path+'?world='+encodeURIComponent(id)+'&source='+source;}

function currentPlanet(w){return w.planets.find(p=>p.id===selectedPlanet)??w.planets.find(p=>p.home);}
function playTone(){if(!sound)return;try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.connect(gain);gain.connect(audio.destination);osc.frequency.value=523;gain.gain.setValueAtTime(.015,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.2);osc.start();osc.stop(audio.currentTime+.2);}catch{sound=false;}}
function initWorker(){return new Promise(resolve=>{let settled=false;const finish=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve(ok);};const timer=setTimeout(()=>{worker?.terminate();worker=null;workerReady=false;finish(false);},4000);try{const text=JSON.parse($('#worker-source').textContent),url=URL.createObjectURL(new Blob([text],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);worker.onmessage=({data})=>{if(data.ready){workerReady=true;finish(true);return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};worker.onerror=()=>{workerReady=false;finish(false);for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Расчётный поток остановился. Исходный мир не изменён.'));}pending.clear();worker?.terminate();worker=null;};}catch{worker=null;workerReady=false;finish(false);}});}
const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
function bootStage(text){$('#save-status').textContent=text;$('#save-status').title=text;}
async function validateStoredWorld(candidate){
  const expectedId=candidate?.id;if(!expectedId)throw new Error('У записи отсутствует идентификатор мира.');
  if(!workerReady){bootStage('Проверка мира на устройстве — это может занять время');await yieldFrame();Core.validateWorld(candidate);return;}
  const result=await new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Проверка мира не завершилась; запись не открыта.'));},60000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,type:'validate',world:candidate,expectedId});});
  if(result?.id!==expectedId||candidate.id!==expectedId)throw new Error('Идентификатор проверенного мира не совпадает.');
}
async function calculate(years,stop){
  if(!workerReady){
    bootStage('Расчёт на устройстве · без фонового потока');await yieldFrame();
    let next=world,advanced=0,newEvents=[];
    for(let i=0;i<years;i++){await yieldFrame();const result=Core.advance(next,1,{stopOnImportant:stop});next=result.world;advanced+=result.advanced;newEvents.push(...result.newEvents);if(!result.advanced||(stop&&result.newEvents.some(e=>e.important)))break;}
    return {world:next,advanced,newEvents,stopped:advanced<years};
  }
  return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);worker?.terminate();worker=null;workerReady=false;reject(new Error('Расчёт не завершился. Мир не изменён; повторный шаг выполнится без Worker.'));},15000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,world,years,stopOnImportant:stop});});
}
function showSaveStatus(){
  if(!world){$('#save-status').textContent='Мир не открыт';return;}
  const saved=!!currentRecord&&!localUnsaved;
  let label=localConflict?'Конфликт · копия или экспорт':localUnsaved?'Не сохранено':cloudState==='syncing'?'Сохраняю в облако…':saved&&!Storage.isCloudDirty(currentRecord)?(store?.persistent?'Сохранено в облаке':'В облаке · без локальной копии'):!store?.persistent?'В памяти · экспорт':cloudState==='error'?'На устройстве · облако недоступно':'На устройстве · ждёт облака';
  $('#save-status').textContent=label;
  $('#save-status').title=cloudIssue||label;
}
function persist(){
  if(!store||!world)return Promise.resolve(null);
  const id=world.id,capturedRevision=revision,generation=changeGeneration,snapshot=localUnsaved?Core.clone(world):null;
  const task=saveTail.catch(()=>{}).then(async()=>{
    const previous=await store.getMetadata(id),expected=world?.id===id?revision:capturedRevision;
    if(!previous||previous.revision!==expected){const error=new Error('Мир изменён другой вкладкой. Сохраните текущую историю отдельной копией.');error.name='ConflictError';throw error;}
    let record=previous;
    if(snapshot){const savedRevision=await store.put(snapshot,expected);record={...previous,name:snapshot.name,seed:snapshot.seed,year:snapshot.year,revision:savedRevision};}
    if(world?.id===id){revision=record.revision;currentRecord=record;localUnsaved=changeGeneration!==generation;pref('microgalaxy_economy_v06_last',id);showSaveStatus();}
    return record;
  }).catch(error=>{
    if(world?.id===id){localUnsaved=localUnsaved||!!snapshot;localConflict=error.name==='ConflictError';setRunning(false);showSaveStatus();notice(error.message,localConflict);updateControls();}
    throw error;
  });
  saveTail=task;
  return task;
}
function scheduleSync(){if(cloudTimer||!cloudSync||localConflict)return;cloudTimer=setTimeout(()=>{cloudTimer=null;void syncCurrent(false);},1800);}
function syncCurrent(manual=false){
  if(cloudTask)return cloudTask;
  if(!world||!store||!cloudSync||localConflict){if(manual&&localConflict)notice('Сначала сохраните конфликтующую историю отдельной копией или экспортируйте её.',true);return Promise.resolve(false);}
  const id=world.id;
  const task=(async()=>{
    try{
      await persist();cloudState='syncing';cloudIssue='';showSaveStatus();
      const result=await cloudSync.sync(id);cloudState='ready';
      if(world?.id===id){
        if(result.record.revision===revision)currentRecord=result.record;
        else if(result.record.revision>revision){localConflict=true;setRunning(false);notice('Мир изменён другой вкладкой. Текущий вариант можно сохранить отдельной копией.',true);}
        showSaveStatus();
      }
      if(manual)notice(result.state==='synced'?'Мир сохранён в облаке.':'Облачная копия записана; новый шаг пока сохранён на устройстве.');
      return true;
    }catch(error){
      cloudState='error';cloudIssue=error.message;
      if(world?.id===id&&error.name==='ConflictError'){localConflict=true;setRunning(false);notice(error.message,true);}
      else if(manual)notice(error.message);
      showSaveStatus();return false;
    }finally{updateControls();}
  })();
  cloudTask=task;void task.finally(()=>{if(cloudTask===task)cloudTask=null;});return task;
}
async function step(years,stop=false){if(busy||switching||localConflict||snapshotIndex!==null||!world)return;busy=true;updateControls();try{const result=await calculate(years,stop);world=result.world;changeGeneration++;localUnsaved=true;try{await persist();scheduleSync();}catch{}if((stop&&result.newEvents.some(e=>e.important))||result.world.year>=Core.LIMITS.years)setRunning(false);if(result.newEvents.some(e=>e.important))playTone();render();if(!result.advanced)notice('Достигнут предел расчёта — 10 000 лет. Историю можно исследовать и экспортировать.');}catch(e){setRunning(false);notice(e.message);}finally{busy=false;showSaveStatus();updateControls();}}
function updateControls(){
  const blocked=busy||switching;
  for(const id of ['#step','#next-event','#export','#sync-world'])$(id).disabled=blocked||!world||((snapshotIndex!==null||localConflict)&&['#step','#next-event'].includes(id));
  for(const id of ['#new-world','#worlds','#import'])$(id).disabled=blocked||!store;
  $('#play').disabled=!world||blocked||localConflict||snapshotIndex!==null;$('#history-slider').disabled=!world||blocked;
}
function render(){if(!world)return;const w=displayed(),p=currentPlanet(w),societyIds=new Set(w.societies.map(s=>s.id));if(selectedRegion&&!w.regions.some(r=>r.id===selectedRegion))selectedRegion=null;if(regionSociety!=='all'&&!societyIds.has(regionSociety))regionSociety='all';if(selectedSociety&&!societyIds.has(selectedSociety))selectedSociety=null;for(const key of ['filter','story','diplomacy']){const value=key==='filter'?filterSociety:key==='story'?storySociety:diplomacySociety;if(value!=='all'&&!societyIds.has(value)){if(key==='filter')filterSociety='all';else if(key==='story')storySociety='all';else diplomacySociety='all';}}$('#world-title').textContent='Система '+w.name+' / '+w.seed;$('#year').textContent='Год '+String(w.year).padStart(5,'0');$('#event-count').textContent=Core.eventCount(w);$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$$('[data-layer]').forEach(b=>b.classList.toggle('active',b.dataset.layer===layer));$('#bodies').innerHTML=`<div class="side-title">Звёздная система <span>${w.planets.length}</span></div><button class="body-item" data-star="1"><span class="orb star"></span><span><span class="body-name">${h(w.name.split(' · ')[0])}</span><span class="body-sub">${w.star.mass.toFixed(2)} M☉ · ${(w.star.temperature/1000).toFixed(1)} тыс. K</span></span></button>`+w.planets.map((p,i)=>`<button class="body-item ${p.id===selectedPlanet?'selected':''}" data-planet="${h(p.id)}"><span class="orb" style="background:${p.home?'#588a9b':p.kind==='gas'?'#b7916a':p.kind==='ice'?'#a4c0c9':'#927c69'}"></span><span><span class="body-name">${h(p.name)}</span><span class="body-sub">${p.a.toFixed(2)} а. е.${p.home?' · Биосфера':''}</span></span></button>`).join('');
  const visual=['planet','system'].includes(view);$('#visual').hidden=!visual;$('#page-content').hidden=visual;$('#scene-title').textContent=view==='system'?w.name:p.name;$('#scene-kind').textContent=view==='system'?'Одна система · автономная история':p.home?'Обитаемый мир':p.kind==='gas'?'Газовый гигант':p.kind==='ice'?'Ледяной мир':'Каменистая планета';$('#scene-caption').textContent=view==='system'?`${w.planets.length} планет · ${w.colonies.length} поселений · ${w.missions.filter(m=>m.status==='transit').length} миссий в пути`:`${p.radius.toFixed(2)} R⊕ · ${p.a.toFixed(2)} а. е. · ${p.moons} спутн.`;$('.layers').hidden=view==='system';$('#scene-note').hidden=view==='system';$$('[data-home-layer]').forEach(b=>b.disabled=!p.home);if(visual)renderer.update(w,view,p,layer,selectedSociety,selectedRegion,layer==='routes'?recentMovements(w):[]);else renderPage(w);renderMapLegend(w,p);
  renderInspector(w,p);$('#recent').innerHTML=recentEvents(w).reverse().map(e=>`<button class="event-mini" data-event="${h(e.id)}"><span class="ev-meta">Год ${e.year}<span>${h(typeNames[e.type]??e.type)}</span></span><b>${h(e.title)}</b><p>${h(e.detail)}</p></button>`).join('');$('#history-slider').max=world.snapshots.length;$('#history-slider').value=snapshotIndex===null?world.snapshots.length:snapshotIndex;$('#history-label').textContent=snapshotIndex===null?'Текущее состояние':'Срез: год '+w.year;$('#history-label').classList.toggle('archive-flag',snapshotIndex!==null);$('#history-coverage').textContent=world.snapshots.length+' сохранённых срезов · не каждый год';$('#history-slider').setAttribute('aria-valuetext',snapshotIndex===null?'Текущее состояние: год '+w.year:'Сохранённый срез: год '+w.year);$('#live').disabled=snapshotIndex===null;setRunning(running);updateControls();}
function renderMapLegend(w,p){
  const visible=view==='planet'&&['political','settlements','routes'].includes(layer)&&p.home,node=$('#map-legend');
  node.hidden=!visible;if(!visible)return;
  $('#scene-note').hidden=true;
  if(layer==='political'){
    const previous=w.snapshots.filter(s=>s.year<w.year).at(-1),owners=previous?new Map(previous.regions.map(r=>[r.id,r.owner])):null,changed=owners?w.regions.filter(r=>owners.get(r.id)!==r.owner).length:0;
    node.innerHTML='<p>Столицы · выберите общество для фокуса</p><div>'+w.societies.filter(s=>s.population>0).map(s=>'<button data-map-society="'+h(s.id)+'" aria-label="Показать столицу '+h(societyName(w,s.id))+'"'+(s.id===selectedSociety?' class="active"':'')+'><i class="dot" style="background:'+h(s.color)+'"></i>'+h(societyName(w,s.id))+'</button>').join('')+'</div>'+(changed?'<small>◇ '+changed+' регионов сменили владельца после '+previous.year+' года</small>':'');
    return;
  }
  const movements=recentMovements(w),selected=w.regions.find(r=>r.id===selectedRegion);
  node.innerHTML=(layer==='routes'?'<p>Переселения · '+movementPeriod(w)+' · '+movements.length+' маршрутов</p><div class="map-key"><span><i class="route-line land"></i>Суша</span><span><i class="route-line sea"></i>Море</span><span>Тонкие линии — связи, не потоки</span></div><small>'+(movements.length?'Реальные перемещения; расчёт миграций раз в 10 лет.':'За эти годы переселений нет. Тонкие линии — связи региона, не потоки.')+'</small>':'<p>Значимые центры регионов</p><div class="map-key"><span>○ Сельский</span><span>◆ Малый город</span><span>■ Крупный город</span></div>')+'<label class="map-region-picker">Выбрать регион<select id="map-region"><option value="">Все регионы</option>'+w.regions.map(r=>'<option value="'+h(r.id)+'"'+(r.id===selectedRegion?' selected':'')+'>'+h(regionName(w,r.id))+'</option>').join('')+'</select></label>'+(selected?'<button class="outline-action" data-region="'+h(selected.id)+'">Паспорт: '+h(regionName(w,selected.id))+' · '+fmt(selected.population)+' жителей региона</button>':'');
}

const pct=value=>Math.round(Core.clamp(Number(value)||0,0,1)*100)+'%';
function societyName(w,id){const s=w.societies.find(s=>s.id===id);if(!s)return id;return s.name+(w.societies.some(other=>other.id!==id&&other.name===s.name)?' · '+s.id:'');}
function societyOptions(w,value){return '<option value="all">Все общества</option>'+w.societies.map(s=>'<option value="'+h(s.id)+'"'+(value===s.id?' selected':'')+'>'+h(societyName(w,s.id))+'</option>').join('');}
function societyButton(w,id,attribute='data-society'){const s=w.societies.find(s=>s.id===id);return s?'<button class="society-link" '+attribute+'="'+h(id)+'"><i class="dot" style="background:'+h(s.color)+'"></i>'+h(societyName(w,s.id))+'</button>':h(id);}
function measure(label,value,unit=''){return '<div><small>'+h(label)+'</small><strong>'+h(value)+(unit?'<i> '+h(unit)+'</i>':'')+'</strong></div>';}
function meter(label,value){return '<div class="political-meter"><div><span>'+h(label)+'</span><b>'+pct(value)+'</b></div><div class="progress"><span style="width:'+pct(value)+'"></span></div></div>';}
function crisisTag(value){return value?'<span class="state-tag warning">'+h(typeof value==='string'?value:'Кризис управления')+'</span>':'';}
function eventEntities(e){return Array.isArray(e.entityIds)?e.entityIds:e.entityId?[e.entityId]:[];}
function orderedEvents(w,events,reverse=false){const indexes=historyData(w).indexes;const result=events.slice().sort((a,b)=>a.year-b.year||(indexes.get(a.id)??0)-(indexes.get(b.id)??0));return reverse?result.reverse():result;}
function pageHeading(title,subtitle,extra=''){return '<div class="page-heading"><div><h1>'+h(title)+'</h1><p class="subtitle">'+h(subtitle)+'</p></div>'+extra+'</div>';}

function movementRows(w,movements){
  return movements.map(m=>{
    const sea=m.edgeIds.some(id=>w.geography.edges.find(e=>e.id===id)?.kind==='sea');
    return '<article class="movement-row"><div class="movement-path">'+regionButton(w,m.from)+'<span aria-hidden="true">→</span>'+regionButton(w,m.to)+'</div><strong>'+fmt(m.people)+' <small>жителей</small></strong><p>Год '+m.year+' · '+(m.kind==='internal'?'Внутри общества':'Между обществами')+' · '+(sea?'С морским участком':'По суше')+' · '+fmt(m.distance)+' усл. км · '+nf.format(Number(m.cost.toFixed(1)))+' усл. дней</p><button class="outline-action" data-route-from="'+h(m.from)+'">Показать на карте</button></article>';
  }).join('')||'<p class="empty">За последние 10 модельных лет подходящих переселений нет. Решения о переселении рассчитываются раз в 10 лет.</p>';
}
function renderRegions(w){
  const g=Core.geographySummary(w);
  $('#page-content').innerHTML=pageHeading('Живая география','Среда, центры и связи регионов. Население в карточках относится ко всему региону, а не только к его городу.')+'<div class="stat-grid geography-stats">'+measure('Регионов',g.regions)+measure('Жителей регионов',fmt(g.population))+measure('Городских центров',g.towns+g.cities)+measure('Переселенцев · год '+w.year,fmt(g.internalMigrants+g.externalMigrants))+'</div><div class="history-filters region-filters"><label class="search-field">Найти центр<input type="search" id="region-search" value="'+h(regionQuery)+'" placeholder="Название или код региона"></label><label>Общество<select id="region-society">'+societyOptions(w,regionSociety)+'</select></label><label>Центр<select id="region-kind"><option value="all">Все центры</option>'+Object.entries(centerKinds).map(([value,label])=>'<option value="'+value+'"'+(regionKind===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label><label>Порядок<select id="region-order"><option value="population"'+(regionOrder==='population'?' selected':'')+'>По населению</option><option value="infrastructure"'+(regionOrder==='infrastructure'?' selected':'')+'>По инфраструктуре</option><option value="name"'+(regionOrder==='name'?' selected':'')+'>По названию</option></select></label></div><div id="region-match-count" class="result-count" role="status"></div><div id="region-list" class="region-grid"></div><section class="geography-movements"><h2 class="section-heading">Переселения · '+movementPeriod(w)+'</h2><p class="mechanics-note">Показаны реальные перемещения последних 10 лет с годом каждого перехода. Миграции рассчитываются раз в 10 лет, демография — ежегодно. Это агрегированные переселения, не индивидуальные поездки и не грузопотоки.</p><div id="region-movements"></div></section>';
  renderRegionList(w);
}
function renderRegionList(w=displayed()){
  const q=regionQuery.toLocaleLowerCase('ru-RU');
  const rows=w.regions.filter(r=>(regionSociety==='all'||r.owner===regionSociety)&&(regionKind==='all'||r.settlement.kind===regionKind)&&(!q||(regionName(w,r.id)+' '+r.id).toLocaleLowerCase('ru-RU').includes(q))).sort((a,b)=>regionOrder==='name'?regionName(w,a.id).localeCompare(regionName(w,b.id),'ru'):regionOrder==='infrastructure'?b.settlement.infrastructure-a.settlement.infrastructure:b.population-a.population);
  $('#region-match-count').textContent='Показано '+Math.min(rows.length,regionLimit)+' из '+rows.length+' регионов';
  $('#region-list').innerHTML=rows.slice(0,regionLimit).map(r=>'<article class="region-card"><div class="region-card-heading"><button data-region="'+h(r.id)+'">'+h(regionName(w,r.id))+'</button><small>'+h(r.id)+'</small></div><div class="region-owner">'+societyButton(w,r.owner)+'</div><div class="region-population">'+fmt(r.population)+' <small>жителей региона</small></div><div class="region-facts"><span>'+h(centerKinds[r.settlement.kind])+'</span><span>'+h(specializations[r.settlement.specialization])+'</span></div>'+meter('Инфраструктура',r.settlement.infrastructure)+'<div class="card-footer"><button data-region="'+h(r.id)+'">Паспорт</button><button data-region-map="'+h(r.id)+'">На глобусе</button></div></article>').join('')+(rows.length>regionLimit?'<button class="outline-action" id="more-regions">Показать ещё регионы</button>':'')+(!rows.length?'<p class="empty">Измените фильтры — подходящих регионов не найдено.</p>':'');
  const allowed=new Set(rows.map(r=>r.id));
  $('#region-movements').innerHTML=movementRows(w,recentMovements(w).filter(m=>allowed.has(m.from)||allowed.has(m.to)));
}
function showRegion(id){
  const w=displayed(),r=Core.regionSummary(w,id);if(!r){notice('Регион отсутствует в выбранном срезе.');return;}
  selectedRegion=id;selectedSociety=r.owner;setRunning(false);render();
  const arrivals=r.movements.filter(m=>m.to===id).reduce((n,m)=>n+m.people,0),departures=r.movements.filter(m=>m.from===id).reduce((n,m)=>n+m.people,0);
  const html='<div class="dossier-intro"><p>Регион '+h(id)+' · '+h(r.biomeLabel)+(r.coastal?' · Побережье':'')+'</p>'+societyButton(w,r.owner)+'</div><div class="stat-grid dossier-stats">'+measure('Жителей всего региона',fmt(r.population))+measure('Условная вместимость',fmt(r.capacity))+measure('Прибыло за год',fmt(arrivals))+measure('Уехало за год',fmt(departures))+'</div><div class="dossier-grid"><section><h3>Значимый центр</h3><dl class="compact-facts"><dt>Тип центра</dt><dd>'+h(r.settlement.kindLabel??centerKinds[r.settlement.kind])+'</dd><dt>Специализация</dt><dd>'+h(r.settlement.specializationLabel??specializations[r.settlement.specialization])+'</dd><dt>Год основания</dt><dd>'+r.settlement.founded+'</dd></dl>'+meter('Инфраструктура',r.settlement.infrastructure)+meter('Привлекательность региона',r.attractiveness)+'<p class="mechanics-note">Центр представляет регион. Отдельное население города не рассчитывается; все жители учтены на уровне региона.</p></section><section><h3>Среда и ресурсы</h3>'+meter('Водная обеспеченность',r.water)+meter('Плодородие',r.fertility)+meter('Биомасса',r.biomass)+meter('Экологическая нагрузка',r.stress)+meter('Относительная высота',r.elevation)+'<div class="metric-row"><span>Оставшееся сырьё</span><b>'+fmt(r.reserves)+' игр. ед.</b></div></section></div><section><h3>Связанные регионы</h3><p class="form-hint">Реальные связи сети. Расстояние — условные километры, стоимость пути — условные дни, не точный транспортный прогноз.</p><div class="region-neighbors">'+r.neighbors.map(n=>'<div>'+regionButton(w,n.id)+'<span><i class="route-line '+n.kind+'"></i>'+(n.kind==='sea'?'Море':'Суша')+' · '+fmt(n.distance)+' усл. км · '+nf.format(Number(n.cost.toFixed(1)))+' усл. дней</span></div>').join('')+'</div></section><section class="geography-movements"><h3>Переселения · '+movementPeriod(w)+'</h3>'+movementRows(w,recentMovements(w).filter(m=>m.from===id||m.to===id))+'</section><div class="dialog-actions"><button data-region-society="'+h(r.owner)+'">Все регионы общества</button><button class="primary" data-region-map="'+h(id)+'">Показать центр на глобусе</button></div>';
  modal(regionName(w,id),html,true);
}
function showRegionMap(id,nextLayer='settlements'){
  const w=displayed(),r=w.regions.find(r=>r.id===id);if(!r)return;
  setRunning(false);selectedRegion=id;selectedSociety=r.owner;selectedPlanet=w.planets.find(p=>p.home).id;view='planet';layer=nextLayer;$('#dialog').close();render();renderer.focusRegion(id);
}
function openSocietyRegions(id){setRunning(false);regionSociety=id;regionKind='all';regionQuery='';regionLimit=60;selectedSociety=id;view='regions';$('#dialog').close();render();}
function societyRegions(w,id){
  const rows=w.regions.filter(r=>r.owner===id).sort((a,b)=>b.population-a.population),total=rows.reduce((n,r)=>n+r.population,0);
  return '<section class="society-regions"><h3>Распределение жителей по регионам</h3><p class="form-hint">'+fmt(total)+' жителей в '+rows.length+' регионах. Каждая строка открывает паспорт среды и центра.</p><div class="regional-distribution">'+rows.map(r=>'<button data-region="'+h(r.id)+'"><span>'+h(regionName(w,r.id))+'<small>'+h(centerKinds[r.settlement.kind])+' · '+h(specializations[r.settlement.specialization])+'</small></span><span><b>'+fmt(r.population)+'</b><i class="fraction-bar"><i style="width:'+pct(r.population/Math.max(1,total))+'"></i></i></span></button>').join('')+'</div></section>';
}

function renderInspector(w,p){
  let summary=$('#mobile-inspector-summary');if(!summary){summary=document.createElement('div');summary.id='mobile-inspector-summary';summary.className='mobile-inspector-summary';$('#inspector').before(summary);}
  const mobilePopulation=p.home?Core.totalPopulation({...w,colonies:[],missions:[]}):w.colonies.filter(c=>c.planet===p.id).reduce((n,c)=>n+c.population,0),expanded=$('#inspector').classList.contains('mobile-expanded');
  summary.innerHTML='<div><small>Население</small><strong>'+short.format(mobilePopulation)+'</strong></div><div><small>Обществ</small><strong>'+w.societies.length+'</strong></div><button id="toggle-inspector" aria-controls="inspector" aria-expanded="'+expanded+'">'+(expanded?'Свернуть паспорт':'Паспорт')+'</button>';
  const selected=w.regions.find(r=>r.id===selectedRegion);
  if(selected&&(view==='regions'||(view==='planet'&&['settlements','routes'].includes(layer)))){
    const r=Core.regionSummary(w,selectedRegion);
    $('#inspector').innerHTML='<section class="inspect-section"><span class="eyebrow">Регион · '+h(r.id)+'</span><h2>'+h(regionName(w,r.id))+'</h2><p>'+h(r.biomeLabel)+(r.coastal?' · Побережье':'')+'</p>'+societyButton(w,r.owner)+'</section><section class="inspect-section"><div class="stat-grid">'+measure('Жителей региона',fmt(r.population))+measure('Связей',r.neighbors.length)+'</div>'+meter('Инфраструктура',r.settlement.infrastructure)+meter('Привлекательность',r.attractiveness)+'</section><section class="inspect-section"><span class="eyebrow">Значимый центр</span><p>'+h(centerKinds[r.settlement.kind])+' · '+h(specializations[r.settlement.specialization])+'</p><button class="outline-action" data-region="'+h(r.id)+'">Паспорт региона</button><button class="outline-action" data-route-from="'+h(r.id)+'">Переселения на карте</button></section>';
    return;
  }
  const s=w.societies.find(item=>item.id===selectedSociety);
  if(s&&(['societies','chronicle','stories','diplomacy'].includes(view)||(view==='planet'&&layer==='political'))){
    const politics=Core.politicsSummary(w,s.id);
    $('#inspector').innerHTML='<section class="inspect-section"><span class="eyebrow">Общество · год '+w.year+'</span><h2>'+h(societyName(w,s.id))+'</h2><p>'+h(politics.government)+' · '+h(Core.epoch(s))+'</p>'+crisisTag(politics.crisis)+'</section><section class="inspect-section"><div class="stat-grid">'+measure('Население',short.format(s.population))+measure('Устойчивость',pct(s.stability))+'</div>'+meter('Легитимность',politics.legitimacy)+meter('Память институтов',politics.institutionalMemory)+'</section><section class="inspect-section"><span class="eyebrow">Власть и преемственность</span><h2 class="leader-name">'+h(s.leader.name)+'</h2><p>'+s.leader.age+' лет · '+h(politics.successionLabel)+'</p><dl class="compact-facts"><dt>Правящая группа</dt><dd>'+h(politics.rulingFactionLabel)+'</dd><dt>Курс</dt><dd>'+h(politics.policyLabel)+'</dd></dl><button class="outline-action" data-society="'+h(s.id)+'">Паспорт общества</button><button class="outline-action" data-society-stories="'+h(s.id)+'">Связанные истории</button><button class="outline-action" data-society-diplomacy="'+h(s.id)+'">Отношения с соседями</button></section>';
    return;
  }
  const population=p.home?Core.totalPopulation({...w,colonies:[],missions:[]}):w.colonies.filter(c=>c.planet===p.id).reduce((n,c)=>n+c.population,0),temp=p.temperature+(p.home?w.climate.warming:0),mean=w.societies.reduce((n,s)=>n+s.tech[1],0)/w.societies.length;
  $('#inspector').innerHTML='<section class="inspect-section"><span class="eyebrow">Паспорт планеты</span><h2>'+h(p.name)+'</h2><p>'+(p.home?'Биосфера и самостоятельные общества':'Наблюдаемый объект системы')+'</p>'+(snapshotIndex!==null?'<p class="archive-flag">Исторический срез. Расчёт остановлен.</p>':'')+'</section><section class="inspect-section"><div class="stat-grid">'+measure('Население',short.format(population))+measure('Температура',temp.toFixed(1),'°C')+measure('Орбитальный период',p.period.toFixed(1),'г.')+measure('Внеземные поселения',w.colonies.length)+'</div></section><section class="inspect-section"><span class="eyebrow">Развитие</span><p>'+h(Core.epoch(w.societies[0]))+'</p><div class="progress"><span style="width:'+Core.clamp(mean/4,0,1)*100+'%"></span></div><p>Ранние общества → первые колонии</p></section><section class="inspect-section"><span class="eyebrow">Общества · '+w.societies.length+'</span>'+w.societies.map(item=>'<button class="soc-small" data-society="'+h(item.id)+'"><span><i class="dot" style="background:'+h(item.color)+'"></i>'+h(societyName(w,item.id))+'</span><small>'+short.format(item.population)+' →</small></button>').join('')+'</section>';
}
function societyCard(w,s){
  const p=Core.politicsSummary(w,s.id);
  return '<button class="soc-card political-card" data-society="'+h(s.id)+'" style="--society-color:'+h(s.color)+'"><div class="card-heading"><h2>'+h(societyName(w,s.id))+'</h2>'+crisisTag(p.crisis)+'</div><div class="soc-meta">'+h(p.government)+' · '+h(Core.epoch(s))+'</div><div class="number">'+fmt(s.population)+' <small>жителей</small></div><div class="card-politics">'+meter('Легитимность',p.legitimacy)+meter('Память институтов',p.institutionalMemory)+'</div><dl class="compact-facts"><dt>Правящая группа</dt><dd>'+h(p.rulingFactionLabel)+'</dd><dt>Курс</dt><dd>'+h(p.policyLabel)+'</dd></dl><div class="card-footer"><span>'+h(s.leader.name)+'</span><span>Паспорт →</span></div></button>';
}
function renderPage(w){
  const node=$('#page-content');
  if(view==='economy'){renderEconomy(w);}
  else if(view==='regions'){renderRegions(w);}
  else if(view==='societies'){
    node.innerHTML=pageHeading('Общества','Власть, внутренние группы и институты. Каждая карточка открывает подробную историю общества.')+'<div class="soc-grid">'+w.societies.map(s=>societyCard(w,s)).join('')+'</div><h2 class="section-heading">Внеземные поселения</h2>'+(w.colonies.length?'<div class="soc-grid">'+w.colonies.map(c=>'<article class="soc-card colony-card"><h2>'+h(c.name)+'</h2><div class="soc-meta">'+h(w.planets.find(p=>p.id===c.planet)?.name??c.planet)+' · основано в '+c.founded+'</div><div class="number">'+fmt(c.population)+' <small>жителей</small></div><div class="soc-meta">'+(c.independent?'Самостоятельное поселение':'Связано с '+h(societyName(w,c.parent)))+' · автономия '+pct(c.autonomy)+'</div><button class="outline-action" data-society="'+h(c.parent)+'">Общество-основатель</button></article>').join('')+'</div>':'<p class="empty">Пока нет. Для запуска нужны технологии, материалы и разведка планеты.</p>');
  }else if(view==='diplomacy'){renderDiplomacy(w);}
  else if(view==='stories'){renderStories(w);}
  else if(view==='chronicle'){
    node.innerHTML=pageHeading('Хроника','Условия и связи записываются в момент события. Откройте запись, чтобы проследить её предысторию и последствия.')+'<div class="history-filters"><label class="search-field">Поиск<input type="search" id="event-search" placeholder="Найти событие" value="'+h(filterQuery)+'"></label><label>Общество<select id="event-society">'+societyOptions(w,filterSociety)+'</select></label><label>Тип<select id="event-type"><option value="all">Все события</option>'+Object.entries(typeNames).map(([key,label])=>'<option value="'+key+'"'+(filterType===key?' selected':'')+'>'+h(label)+'</option>').join('')+'</select></label><label>Порядок<select id="event-order"><option value="recent"'+(eventOrder==='recent'?' selected':'')+'>Сначала новые</option><option value="oldest"'+(eventOrder==='oldest'?' selected':'')+'>От начала истории</option></select></label></div><div id="event-match-count" class="result-count" role="status"></div><div id="event-list"></div>';
    renderEvents(w);
  }else if(view==='analysis'){
    const histories=w.history.length?w.history:[Core.summary(w)],s=Core.summary(w),missions=worldMissions(w);
    node.innerHTML=pageHeading('Состояние системы','Исторические показатели записываются каждые 10 лет. Это значения игровой модели, не научный прогноз.')+'<div class="stat-grid analysis-stats">'+measure('Жителей во всей системе',fmt(s.population))+measure('Изменение температуры',s.warming.toFixed(2),'°C')+measure('Действующие конфликты',s.wars)+measure('Средний уровень исследований',s.knowledge.toFixed(2))+(Number.isFinite(s.activeTreaties)?measure('Действующие договоры',s.activeTreaties):'')+(Number.isFinite(s.avgLegitimacy)?measure('Средняя легитимность',pct(s.avgLegitimacy)):'')+measure('Событий во всём архиве',Core.eventCount(w))+measure('Завершённых миссий',missions.filter(m=>m.status!=='transit').length)+'</div>'+chart(histories,'population','Население системы')+chart(histories,'warming','Потепление, °C')+'<div class="chart-block"><h2>Покрытие архива</h2><p class="subtitle">Сохранена начальная точка, последние 16 срезов и разреженные опоры всей истории — до 64 срезов всего. Полное состояние доступно только в сохранённые годы. Все события, причинные ссылки и завершённые миссии сохраняются в страницах архива; недавний хвост не заменяет полную хронику.</p></div>';
  }
}
const resourceNames={food:'Продовольствие',raw:'Сырьё',energy:'Энергия',equipment:'Оборудование'};
function renderEconomy(w){
  const data=Core.economySummary(w),res=data.resources,ledger=data.ledger;
  const n=value=>Number.isFinite(value)?nf.format(Number(value.toFixed(2))):'—';
  const cards=Object.entries(resourceNames).map(([key,label])=>{const r=res[key];return '<article class="economy-card"><h2>'+h(label)+'</h2><div class="number">'+n(r.stock)+' <small>ед. в запасах</small></div><p>В пути: '+n(r.inTransit)+' ед.</p><dl class="compact-facts"><dt>Произведено</dt><dd>'+n(r.production)+' ед./год</dd><dt>Потреблено</dt><dd>'+n(r.consumption)+' ед./год</dd><dt>Строительство</dt><dd>'+n(r.construction)+' ед./год</dd><dt>Содержание</dt><dd>'+n(r.maintenance)+' ед./год</dd><dt>Потери</dt><dd>'+n(r.losses)+' ед./год</dd><dt>Невязка баланса</dt><dd>'+n(r.balance)+' ед.</dd></dl></article>';}).join('');
  const regions=data.regions.filter(r=>r.shortage>0);
  const shortages=regions.slice(0,30).map(r=>'<li>'+regionButton(w,r.id)+' · '+h(specializations[r.specialization]??r.specialization??'без специализации')+' · нехватка продовольствия '+n(r.shortage*100)+'% потребности за год</li>').join('');
  const regional=data.regions.map(r=>'<li>'+regionButton(w,r.id)+' · '+h(specializations[r.specialization]??r.specialization??'без специализации')+' · продовольствие '+n(r.stock.food)+' ед. · порт '+n(r.port*100)+'%</li>').join('');
  const routes=data.routes.slice(0,economyRouteLimit).map(r=>{const geo=w.geography.edges.find(e=>e.id===r.id);return '<li>'+regionButton(w,r.a)+' — '+regionButton(w,r.b)+' · '+(r.kind==='sea'?'морской путь':'сухопутный путь')+' · '+(r.open?'открыт':'закрыт')+' · '+n(r.used)+' / '+n(r.effectiveCapacity)+' ед./год · '+n(geo?.distance)+' усл. км</li>';}).join('');
  const shipments=data.shipments.slice(0,economyShipmentLimit).map(s=>{const path=s.path??[s.route],distance=path.reduce((sum,id)=>sum+(w.geography.edges.find(e=>e.id===id)?.distance??0),0);return '<li>'+regionButton(w,s.from)+' → '+regionButton(w,s.to)+' · '+h(resourceNames[s.resource]??s.resource)+' '+n(s.amount)+' ед. · путь: '+path.length+' участк., '+n(distance)+' усл. км · '+(s.status==='waiting'?'ожидает открытия пути':'в пути')+' · ожидаемое прибытие: год '+h(s.arrival)+'</li>';}).join('');
  const recent=Core.allEvents(w).filter(e=>['economy','migration','politics','diplomacy'].includes(e.type)).slice(-8).reverse().map(e=>'<li><button class="region-link" data-event="'+h(e.id)+'">'+h(e.year)+' · '+h(e.title)+'</button> — '+h(e.detail)+'</li>').join('');
$('#page-content').innerHTML=pageHeading('Экономика и пути','Наблюдение за запасами, перевозками и дефицитом. Управлять хозяйством напрямую нельзя.')+(snapshotIndex!==null?'<p class="archive-flag">Исторический срез: показатели только на год '+w.year+'.</p>':'')+'<div class="economy-grid">'+cards+'</div><p class="subtitle">Планетарный учёт в условных единицах, не научный прогноз. Материалы межпланетных миссий записываются как потребление при выходе за границу модели; запасы колоний сюда не входят. Баланс: начальные запасы и груз в пути + производство − потребление, строительство, содержание и потери = конечные запасы и груз в пути. Невязка показывает разницу сторон за последний расчётный год.</p><section class="chart-block"><h2>Дефицит регионов</h2><p class="subtitle">Нехватка может повлиять на переселение и общественное недовольство.</p><ul class="economy-list">'+(shortages||'<li>За расчётный год дефицит не отмечен.</li>')+'</ul></section><section class="chart-block"><h2>Специализация и запасы</h2><ul class="economy-list">'+regional+'</ul></section><section class="chart-block"><h2>Дороги и порты</h2><p class="subtitle">Использование / действующая пропускная способность; доступ зависит от связей и договоров.</p><p id="economy-route-count" tabindex="-1" class="result-count" role="status">Показано '+Math.min(economyRouteLimit,data.routes.length)+' из '+data.routes.length+' путей</p><ul class="economy-list">'+(routes||'<li>Пути пока не построены.</li>')+'</ul>'+(economyRouteLimit<data.routes.length?'<button id="more-economy-routes">Ещё пути</button>':'')+'</section><section class="chart-block"><h2>Грузы в пути</h2><p id="economy-shipment-count" tabindex="-1" class="result-count" role="status">Показано '+Math.min(economyShipmentLimit,data.shipments.length)+' из '+data.shipments.length+' грузов</p><ul class="economy-list">'+(shipments||'<li>Сейчас отправлений в пути нет.</li>')+'</ul>'+(economyShipmentLimit<data.shipments.length?'<button id="more-economy-shipments">Ещё грузы</button>':'')+'</section><section class="chart-block"><h2>Связанные события</h2><p class="subtitle">Хозяйственные, миграционные, политические и дипломатические события в хронологии.</p><ul class="economy-list">'+(recent||'<li>Записей пока нет.</li>')+'</ul></section>';
}
function chart(rows,key,title){const vals=rows.map(r=>r[key]),max=Math.max(...vals,1),min=Math.min(...vals,0),points=rows.map((r,i)=>(12+i/Math.max(1,rows.length-1)*576)+','+(148-(r[key]-min)/(max-min)*126)).join(' ');return '<section class="chart-block"><h2>'+h(title)+'</h2><svg viewBox="0 0 600 165" role="img" aria-label="'+h(title)+' по годам"><path d="M12 22H588 M12 85H588 M12 148H588" fill="none" stroke="#36423d" stroke-width=".7"/><polyline points="'+points+'" fill="none" stroke="#c9d5a6" stroke-width="2.5"/></svg><div class="chart-caption"><span>Год '+rows[0].year+'</span><span>Макс. '+nf.format(Number(max.toFixed(2)))+'</span><span>Год '+rows.at(-1).year+'</span></div></section>';}

function renderEvents(w=displayed()){
  const q=filterQuery.toLocaleLowerCase('ru-RU');
  const matched=historyData(w).events.filter(e=>(filterType==='all'||e.type===filterType)&&(filterSociety==='all'||eventEntities(e).includes(filterSociety))&&(e.title+' '+e.detail).toLocaleLowerCase('ru-RU').includes(q));
  const events=orderedEvents(w,matched,eventOrder==='recent').slice(0,eventLimit);
  $('#event-match-count').textContent=matched.length?'Показано '+events.length+' из '+matched.length+' событий':'Подходящих событий пока нет';
  $('#event-list').innerHTML=events.map(e=>'<button class="event-row" data-event="'+h(e.id)+'"><span class="event-year">'+e.year+'</span><span><span class="event-kind">'+h(typeNames[e.type]??e.type)+'</span><b>'+h(e.title)+'</b>'+(e.important?'<span class="pill">важное</span>':'')+'<p>'+h(e.detail)+'</p>'+((e.causeEventIds?.length??0)?'<small class="linked-note">Связано с предыдущими событиями · '+e.causeEventIds.length+'</small>':'')+'</span></button>').join('')+(matched.length>events.length?'<button id="more-events" class="outline-action">Показать ещё события</button>':'');
}
function renderDiplomacy(w){
  const all=Core.diplomacySummary(w),statuses=[...new Set(all.map(r=>r.status))];
  if(diplomacyStatus!=='all'&&!statuses.includes(diplomacyStatus))diplomacyStatus='all';
  $('#page-content').innerHTML=pageHeading('Дипломатия','Договоры, взаимное доверие и реальные продовольственные связи между обществами.')+'<div class="history-filters diplomacy-filters"><label>Общество<select id="diplomacy-society">'+societyOptions(w,diplomacySociety)+'</select></label><label>Отношения<select id="diplomacy-status"><option value="all">Все отношения</option>'+statuses.map(value=>'<option value="'+h(value)+'"'+(value===diplomacyStatus?' selected':'')+'>'+h(value)+'</option>').join('')+'</select></label><label>Порядок<select id="diplomacy-order"><option value="trust"'+(diplomacyOrder==='trust'?' selected':'')+'>Сначала тесные связи</option><option value="tension"'+(diplomacyOrder==='tension'?' selected':'')+'>Сначала низкое доверие</option><option value="trade"'+(diplomacyOrder==='trade'?' selected':'')+'>По объёму поставок</option></select></label></div><p class="mechanics-note">Зависимость — сглаженная по последним годам доля потребности в пище, покрываемая вторым участником пары. Объём поставок — игровые единицы пищи за текущий год, не деньги.</p><div id="diplomacy-list" class="diplomacy-list"></div>';
  renderRelations(w,all);
}
function renderRelations(w=displayed(),all=Core.diplomacySummary(w)){
  const rows=all.filter(r=>(diplomacySociety==='all'||[r.a,r.b].includes(diplomacySociety))&&(diplomacyStatus==='all'||r.status===diplomacyStatus)).sort((a,b)=>diplomacyOrder==='trade'?b.trade-a.trade:diplomacyOrder==='tension'?a.trust-b.trust:b.trust-a.trust);
  $('#diplomacy-list').innerHTML=rows.map(r=>'<article class="relation-card"><div class="relation-heading"><div class="relation-parties">'+societyButton(w,r.a)+'<span class="relation-connector" aria-hidden="true">↔</span>'+societyButton(w,r.b)+'</div><span class="state-tag">'+h(r.status)+'</span></div><div class="relation-treaty">'+h(r.treaty||'Без договора')+(Number.isFinite(r.startYear)?'<span>С '+r.startYear+' года</span>':'')+'</div><div class="relation-metrics">'+meter('Доверие',r.trust)+'<div><small>Поставки за год</small><b>'+fmt(r.trade)+' <small>ед. пищи</small></b></div></div><div class="dependency-pair"><div><span>'+h(societyName(w,r.a))+' зависит от '+h(societyName(w,r.b))+'</span><b>'+pct(r.dependencyA)+'</b></div><div><span>'+h(societyName(w,r.b))+' зависит от '+h(societyName(w,r.a))+'</span><b>'+pct(r.dependencyB)+'</b></div></div><button class="outline-action" data-relation="'+h(r.id)+'">Условия и история отношений</button></article>').join('')||'<p class="empty">Нет отношений, соответствующих этому фильтру.</p>';
}
function renderStories(w){
  $('#page-content').innerHTML=pageHeading('Истории цивилизаций','Не пересказ, а цепочки записанных связей: какие события привели к переменам и что последовало за ними.')+'<div class="history-filters stories-filters"><label class="search-field">Поиск<input type="search" id="story-search" placeholder="Название или событие в истории" value="'+h(storyQuery)+'"></label><label>Общество<select id="story-society">'+societyOptions(w,storySociety)+'</select></label><label>Порядок<select id="story-order"><option value="recent"'+(storyOrder==='recent'?' selected':'')+'>По последнему событию</option><option value="oldest"'+(storyOrder==='oldest'?' selected':'')+'>От начала истории</option></select></label></div><div id="story-match-count" class="result-count" role="status"></div><div id="story-list" class="story-list"></div>';
  renderStoryList(w);
}
function renderStoryList(w=displayed()){
  const q=storyQuery.toLocaleLowerCase('ru-RU'),eventMap=historyData(w).byId;
  const matched=worldStories(w).filter(s=>(storySociety==='all'||s.societyIds.includes(storySociety))&&(!q||s.title.toLocaleLowerCase('ru-RU').includes(q)||s.eventIds.some(id=>((eventMap.get(id)?.title??'')+' '+(eventMap.get(id)?.detail??'')).toLocaleLowerCase('ru-RU').includes(q)))).sort((a,b)=>storyOrder==='oldest'?a.startYear-b.startYear:b.endYear-a.endYear);
  const stories=matched.slice(0,storyLimit);
  $('#story-match-count').textContent=matched.length?'Показано '+stories.length+' из '+matched.length+' цепочек':q||storySociety!=='all'?'Подходящих историй не найдено':'Связанные цепочки ещё не возникли';
  $('#story-list').innerHTML=stories.map(s=>'<button class="story-card" data-story="'+h(s.id)+'"><div class="story-meta"><span>Годы '+s.startYear+(s.endYear!==s.startYear?'–'+s.endYear:'')+'</span><span>'+h(s.status)+'</span></div><h2>'+h(s.title)+'</h2><div class="story-societies">'+s.societyIds.map(id=>'<span>'+h(societyName(w,id))+'</span>').join('')+'</div><div class="card-footer"><span>'+s.eventCount+' связанных событий</span><span>Проследить →</span></div></button>').join('')+(matched.length>stories.length?'<button id="more-stories" class="outline-action">Показать ещё истории</button>':'')+(!stories.length?'<p class="empty">'+(q||storySociety!=='all'?'Измените поиск или выберите все общества.':'Продолжите наблюдение. Когда события породят новые связанные события, их история появится здесь.')+'</p>':'');
}
function modal(title,html,wide=false){
  setRunning(false);
  if(!$('#dialog').open){const target=document.activeElement;dialogReturnFocus=target&&target!==document.body&&target.isConnected&&target.getClientRects().length?target:$('.tabs [data-view="'+view+'"]');}
  $('#dialog').classList.toggle('wide-dialog',wide);$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;
  if(!$('#dialog').open)$('#dialog').showModal();
  $('#dialog-title').focus();
}
function linkedEventButton(e){return '<button class="thread-event" data-event="'+h(e.id)+'"><time>Год '+e.year+'</time><span>'+h(e.title)+'</span><small>'+h(typeNames[e.type]??e.type)+'</small></button>';}
function showEvent(id){
  const w=displayed(),e=historyData(w).byId.get(id);
  if(!e){notice('Это событие отсутствует в выбранном историческом срезе.');return;}
  const thread=Core.eventThread(w,id),before=orderedEvents(w,thread.before).slice(-12),after=orderedEvents(w,thread.after).slice(0,12);
  const stories=worldStories(w).filter(s=>s.eventIds.includes(id));
  let html='<div class="event-heading"><span class="eyebrow">Год '+e.year+' · '+h(typeNames[e.type]??e.type)+'</span>'+(e.important?'<span class="state-tag">Важное событие</span>':'')+'</div><p class="event-detail">'+h(e.detail)+'</p><div class="affected-societies">'+eventEntities(e).map(sid=>societyButton(w,sid)).join('')+'</div><section class="event-causes"><h3>Условия в момент события</h3>'+e.causes.map(c=>'<div class="metric-row"><span>'+h(c.label)+'</span><b>'+h(c.value)+'</b></div>').join('')+'</section><div class="event-thread-grid"><section><h3>Предшествующие звенья</h3>'+(before.length?before.map(linkedEventButton).join(''):'<p class="form-hint">Ссылок на предыдущие события нет. Исходные условия перечислены выше.</p>')+(thread.before.length>before.length?'<p class="form-hint">Показаны последние '+before.length+' из '+thread.before.length+' предшествующих событий в этом фрагменте.</p>':'')+'</section><section><h3>Последующие звенья</h3>'+(after.length?after.map(linkedEventButton).join(''):'<p class="form-hint">В этом срезе связанные последствия ещё не записаны.</p>')+(thread.after.length>after.length?'<p class="form-hint">Показаны первые '+after.length+' из '+thread.after.length+' последующих событий в этом фрагменте.</p>':'')+'</section></div>';
  if(stories.length)html+='<section class="event-causes"><h3>В составе историй</h3>'+stories.slice(0,6).map(s=>'<button class="outline-action" data-story="'+h(s.id)+'">'+h(s.title)+' · '+s.eventCount+' событий</button>').join('')+'</section>';
  html+='<p class="form-hint">Здесь показан фрагмент связей: поиск ограничен 160 предшествующими и 160 последующими событиями, на экран выводится до 12 с каждой стороны. '+(stories.length?'Полная связанная история доступна выше с постраничной загрузкой. ':'')+'Причинные ссылки сохранены расчётной моделью; придуманного пересказа и генеративного ИИ нет.</p><div class="dialog-actions"><button data-open-chronicle="'+h(e.entityId??'all')+'">К хронологии</button></div>';
  modal(e.title,html,true);
}
function showSociety(id){
  selectedSociety=id;view='societies';render();
  const w=displayed(),s=w.societies.find(item=>item.id===id);if(!s)return;
  const p=Core.politicsSummary(w,id),tech=s.tech.map((v,i)=>'<div class="political-meter"><div><span>'+h(Core.TECH_NAMES[i])+'</span><b>'+v.toFixed(2)+'</b></div><div class="progress"><span style="width:'+Core.clamp(v/6,0,1)*100+'%"></span></div></div>').join('');
  let html='<div class="dossier-intro"><p>'+h(p.government)+' · '+h(Core.epoch(s))+'</p>'+crisisTag(p.crisis)+'</div><div class="stat-grid dossier-stats">'+measure('Население',fmt(s.population))+measure('Устойчивость',pct(s.stability))+measure('Легитимность',pct(p.legitimacy))+measure('Память институтов',pct(p.institutionalMemory))+'</div><div class="dossier-grid"><section><h3>Власть</h3><dl class="compact-facts"><dt>Руководитель</dt><dd>'+h(s.leader.name)+', '+s.leader.age+' лет</dd><dt>Смена руководства</dt><dd>'+h(p.successionLabel)+'</dd><dt>Правящая группа</dt><dd>'+h(p.rulingFactionLabel)+'</dd><dt>Курс</dt><dd>'+h(p.policyLabel)+'</dd><dt>Текущее руководство</dt><dd>С '+p.since+' года</dd></dl><p class="mechanics-note">Институциональная память отражает сохранность процедур: она смягчает смену лидера и помогает исследованиям.</p></section><section><h3>Хозяйство и знания</h3><div class="metric-row"><span>Пищи на складе</span><b>'+(s.food/Math.max(1,s.population)).toFixed(2)+' годовых потребностей</b></div><div class="metric-row"><span>Минералы</span><b>'+fmt(s.minerals)+'</b></div><div class="metric-row"><span>Регионы</span><b>'+w.regions.filter(r=>r.owner===id).length+'</b></div><div class="dossier-tech">'+tech+'</div></section></div><section class="factions-section"><h3>Внутренние группы</h3><p class="mechanics-note">Влияние — доля политического веса всех групп. Поддержка — отношение каждой группы к власти; эти проценты не суммируются.</p><div class="faction-table" role="table" aria-label="Влияние и поддержка внутренних групп"><div class="faction-row faction-table-head" role="row"><span role="columnheader">Группа</span><span role="columnheader">Влияние</span><span role="columnheader">Поддержка</span></div>'+p.factions.map(f=>'<div class="faction-row" role="row"><span role="cell">'+h(f.name)+(f.name===p.rulingFactionLabel?'<small>Правящая группа</small>':'')+'</span><span role="cell" aria-label="Влияние '+pct(f.influence)+'"><b>'+pct(f.influence)+'</b><i class="fraction-bar"><i style="width:'+pct(f.influence)+'"></i></i></span><span role="cell" aria-label="Поддержка '+pct(f.support)+'"><b>'+pct(f.support)+'</b><i class="fraction-bar"><i style="width:'+pct(f.support)+'"></i></i></span></div>').join('')+'</div></section>';
  html+=societyRegions(w,id);
  if(s.parentId)html+='<p class="lineage-note">Общество-предшественник: '+societyButton(w,s.parentId)+'</p>';
  html+='<p class="form-hint">'+h(s.language)+' — языковая традиция. Детальная грамматика и отдельные жители не моделируются.</p><div class="dialog-actions"><button data-society-map="'+h(id)+'">Показать столицу</button><button data-society-diplomacy="'+h(id)+'">Дипломатия</button><button class="primary" data-society-stories="'+h(id)+'">Истории общества</button></div>';
  modal(societyName(w,s.id),html,true);
}
function showRelation(id){
  const w=displayed(),r=Core.diplomacySummary(w).find(item=>item.id===id);if(!r)return;
  const causes=(r.causeEventIds??[]).map(eid=>historyData(w).byId.get(eid)).filter(Boolean);
  const html='<div class="relation-parties">'+societyButton(w,r.a)+'<span aria-hidden="true">↔</span>'+societyButton(w,r.b)+'</div><div class="dossier-intro"><p>'+h(r.status)+' · '+h(r.treaty||'Без договора')+'</p></div><div class="stat-grid dossier-stats">'+measure('Доверие',pct(r.trust))+measure('Поставки за год',fmt(r.trade),'ед. пищи')+measure('Потребность '+societyName(w,r.a)+', покрытая '+societyName(w,r.b),pct(r.dependencyA))+measure('Потребность '+societyName(w,r.b)+', покрытая '+societyName(w,r.a),pct(r.dependencyB))+'</div><p class="mechanics-note">Зависимость — сглаженная по последним годам доля потребности в пище, а не доля импорта. Договоры расширяют реальные поставки; союзы допускают помощь и сдерживают конфликт. Всё выражено в игровых единицах.</p><section class="event-causes"><h3>Записанные основания отношений</h3>'+(causes.length?orderedEvents(w,causes).map(linkedEventButton).join(''):'<p class="form-hint">Связанные события пока не записаны.</p>')+'</section>';
  modal('Отношения: '+societyName(w,r.a)+' и '+societyName(w,r.b),html,true);
}
function showStory(id,more=false){
  const w=displayed(),s=worldStories(w).find(item=>item.id===id);if(!s){notice('История отсутствует в выбранном срезе.');return;}
  if(!more||activeStory!==id)storyEventLimit=80;activeStory=id;
  const eventMap=historyData(w).byId,events=orderedEvents(w,s.eventIds.map(eid=>eventMap.get(eid)).filter(Boolean)),shown=events.slice(0,storyEventLimit);
  const html='<div class="story-meta"><span>Годы '+s.startYear+(s.endYear!==s.startYear?'–'+s.endYear:'')+' · '+s.eventCount+' событий</span><span>'+h(s.status)+'</span></div><div class="affected-societies">'+s.societyIds.map(sid=>societyButton(w,sid)).join('')+'</div><p class="form-hint">События расположены по времени. Нажмите на событие: в его карточке показаны собственные причинные ссылки, а не только соседние записи.</p><ol class="story-timeline">'+shown.map(e=>'<li><button data-event="'+h(e.id)+'"><time>Год '+e.year+'</time><span class="event-kind">'+h(typeNames[e.type]??e.type)+'</span><b>'+h(e.title)+'</b><p>'+h(e.detail)+'</p></button></li>').join('')+'</ol>'+(events.length>shown.length?'<button class="outline-action" data-more-story="'+h(id)+'">Показать следующие события</button>':'')+'<div class="dialog-actions"><button data-view="stories">Все истории</button></div>';
  modal(s.title,html,true);
}
function openSocietyStories(id){setRunning(false);storySociety=id;storyQuery='';storyLimit=40;selectedSociety=id;view='stories';$('#dialog').close();render();}
function openSocietyDiplomacy(id){setRunning(false);diplomacySociety=id;diplomacyStatus='all';selectedSociety=id;view='diplomacy';$('#dialog').close();render();}
function openChronicle(id){setRunning(false);filterSociety=id;filterType='all';filterQuery='';eventLimit=160;view='chronicle';$('#dialog').close();render();}
function showSocietyMap(id){
  const w=displayed();selectedSociety=id;selectedPlanet=w.planets.find(p=>p.home).id;view='planet';layer='political';selectedRegion=null;$('#dialog').close();setRunning(false);render();renderer.focusSociety(id);
}
function newDialog(){modal('Новая случайная система',`<p class="form-hint">Создаётся отдельный мир. Уже сохранённые системы остаются в «Моих мирах».</p><div class="form-row"><label for="seed">Код генерации</label><input id="seed" type="text" maxlength="128" placeholder="Оставьте пустым для случайного мира"></div><div class="form-row"><label for="era">Начальная эпоха</label><select id="era"><option value="agriculture">Ранние общества → освоение космоса</option><option value="industrial">Промышленная эпоха</option><option value="space">Первые космические технологии</option></select></div><p class="form-hint">Одинаковые код, эпоха и версия модели дают одинаковые исходные условия. Предыстория до старта не симулируется.</p><div class="dialog-actions"><button id="create-world" class="primary">Создать систему</button></div>`);}
function randomSeed(){const a=new Uint32Array(2);crypto.getRandomValues(a);return 'MG-'+a[0].toString(36).toUpperCase()+'-'+a[1].toString(36).toUpperCase();}
function uniqueId(){
  if(typeof crypto.randomUUID==='function')return 'local-'+crypto.randomUUID();
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  return 'local-'+hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
function selectRecord(record){
  resetEconomyPages();
  world=record.world;revision=record.revision;currentRecord=record;changeGeneration=0;
  selectedRegion=null;regionSociety='all';regionKind='all';regionQuery='';regionLimit=60;displayedCache=null;filterSociety='all';filterType='all';filterQuery='';eventLimit=160;storySociety='all';storyQuery='';storyLimit=40;diplomacySociety='all';diplomacyStatus='all';activeStory=null;
  localConflict=false;localUnsaved=false;snapshotIndex=null;selectedSociety=null;selectedPlanet=world.planets.find(p=>p.home).id;view='planet';renderer.cacheKey='';
  $('#dialog').close();$('#notice').hidden=true;pref('microgalaxy_economy_v06_last',world.id);
  try{const url=new URL(window.location.href);url.searchParams.set('world',world.id);url.searchParams.delete('source');url.searchParams.delete('archive');window.history.replaceState(null,'',"/v06"+url.search+url.hash);}catch{}
showSaveStatus();render();setRunning(false);
}
async function transition(action){
  if(busy||switching)throw new Error('Дождитесь завершения текущего шага.');
  switching=true;setRunning(false);updateControls();
  const oldId=world?.id, wasDirty=localUnsaved, conflicted=localConflict, oldTail=saveTail;
  try{const result=await action();if(oldId&&oldId!==world?.id&&!conflicted&&store?.releaseWorld&&(!wasDirty||saveTail!==oldTail)){try{await saveTail;const sync=cloudTask?await cloudTask:true;const metadata=await store.getMetadata(oldId);const cloudClean=!!metadata?.cloud?.revision&&metadata.cloud.syncedRevision===metadata.revision&&!Storage.isCloudDirty(metadata);await store.releaseWorld(oldId);if(sync!==false&&cloudClean&&!cloudTask)try{await RetentionClient.releaseCloudWorld("v06",oldId);}catch{}}catch{/* Uncertain final save keeps the old world protected. */}}return result;}finally{switching=false;updateControls();}
}
async function installWorld(w,{skipCurrent=false}={}){
  Core.validateWorld(w);if(!skipCurrent&&world)await persist();
  const next=Core.clone(w);next.id=uniqueId();const savedRevision=await store.put(next,0);
  selectRecord({world:next,revision:savedRevision,cloud:null});scheduleSync();
}
async function openLocal(id,{refresh=true}={}){
  if(world)await persist();
  let record=await store.get(id);if(!record)throw new Error('Мир не найден.');if(record.world.id!==id)throw new Error('Локальная запись относится к другому миру. Она не открыта и не изменена.');
  const remote=cloudRows.get(id);
  if(refresh&&remote&&record.cloud?.revision&&remote.revision>record.cloud.revision&&!Storage.isCloudDirty(record)){
    try{const saved=await cloudClient.get(id);record=await store.receiveCloud(saved.world,saved.revision,saved.updatedAt,record.revision);cloudState='ready';}
    catch(error){cloudState='error';cloudIssue=error.message;}
  }
  selectRecord(record);
}
async function openCloud(id){
  if(world)await persist();
  const remote=await cloudClient.get(id);let local;
  try{local=await store.get(id);if(local&&local.world.id!==id)throw new Error('Локальная запись относится к другому миру.');}
  catch(error){modal('Местная запись не читается','<p>Облачный мир доступен, но местная запись повреждена или содержит другой идентификатор. Она не перезаписана.</p><p class="form-hint">'+h(error.message)+'</p><div class="dialog-actions"><button data-open-archive="all">Мои миры</button><button class="primary" data-copy-cloud="'+h(id)+'">Облако отдельной копией</button></div>');return;}
  try{
    const record=await store.receiveCloud(remote.world,remote.revision,remote.updatedAt,local?.revision??0);
    cloudState='ready';cloudIssue='';selectRecord(record);
  }catch(error){
    if(error.name!=='ConflictError')throw error;
    modal('Две сохранённые истории','<p>На устройстве есть другой вариант этого мира. Он не заменён облачной версией.</p><p class="form-hint">Можно продолжить местную историю либо открыть облачный снимок отдельным новым миром. Оба исходных сохранения останутся доступны.</p><div class="dialog-actions"><button data-load-world="'+h(id)+'">Местная история</button><button class="primary" data-copy-cloud="'+h(id)+'">Облако отдельной копией</button></div>');
  }
}
let archiveRequest=0;
function catalogMetadata(model,record){
  const w=record?.world,id=record?.id??w?.id;
  if(model==='classic'&&(!w||typeof w!=='object'))return null;
  if(typeof id!=='string'||!id||!Number.isFinite(record?.year??w?.year))return null;
  const cloud=record.cloud?{revision:record.cloud.revision,syncedRevision:record.cloud.syncedRevision}:null;
  return {key:model+':'+id,model,id,name:String(record.name??w?.name??'Без названия'),seed:String(record.seed??w?.seed??''),year:record.year??w.year,revision:record.revision??0,cloud,updatedAt:String(record.updatedAt??''),dirty:model==='classic'?(record.syncedYear??-1)<w.year:Storage.isCloudDirty({revision:record.revision,cloud}),ephemeral:model==='v06'&&!store?.persistent};
}
function readLegacyDatabase(model,knownNames){
  const definition=catalogModels[model];
  if(knownNames&&!knownNames.has(definition.db))return Promise.resolve([]);
  return new Promise((resolve,reject)=>{
    let db,tx,settled=false,missing=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error&&tx)try{tx.abort();}catch{}db?.close();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('Локальный каталог '+definition.label+' не ответил вовремя.')),5000);
    let request;
    try{request=indexedDB.open(definition.db);}catch(error){finish(error);return;}
    request.onupgradeneeded=()=>{missing=true;request.transaction.abort();};
    request.onerror=()=>missing?finish(null,[]):finish(new Error('Не удалось прочитать локальный каталог '+definition.label+'.'));
    request.onblocked=()=>finish(new Error('Локальный каталог '+definition.label+' занят другой вкладкой.'));
    request.onsuccess=()=>{
      db=request.result;if(settled){db.close();return;}
      if(!db.objectStoreNames.contains('worlds')){finish(null,[]);return;}
      const rows=[];
      try{
        const metadataOnly=model==='v05'&&db.objectStoreNames.contains('metadata');
        tx=db.transaction(metadataOnly?['worlds','metadata']:'worlds','readonly');
        let keys=null;
        if(metadataOnly){const keyRequest=tx.objectStore('worlds').getAllKeys();keyRequest.onsuccess=()=>{keys=keyRequest.result;};}
        const cursor=tx.objectStore(metadataOnly?'metadata':'worlds').openCursor();
        cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const row=catalogMetadata(model,c.value);if(row)rows.push(row);c.continue();};
        tx.oncomplete=()=>{if(metadataOnly&&keys?.some(id=>!rows.some(row=>row.id===id)))Object.defineProperty(rows,'legacyPending',{value:true});finish(null,rows);};
        tx.onerror=()=>finish(new Error('Не удалось прочитать локальные миры '+definition.label+'.'));
        tx.onabort=()=>finish(new Error('Чтение локального каталога '+definition.label+' прервано.'));
      }catch(error){finish(error);}
    };
  });
}
async function readLegacyCatalog(){
  if(!globalThis.indexedDB){legacyLocalIssue='Браузер не предоставляет локальные каталоги прежних моделей.';return [];}
  let knownNames=null;
  if(typeof indexedDB.databases==='function'){
    let timer;
    try{const dbs=await Promise.race([indexedDB.databases(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),1500);})]);knownNames=new Set(dbs.map(d=>d.name));}catch{}finally{clearTimeout(timer);}
  }
  const results=await Promise.allSettled(['v08','v05','v04','v03','classic'].map(model=>readLegacyDatabase(model,knownNames)));
  legacyLocalIssue=[...results.filter(r=>r.status==='rejected').map(r=>r.reason.message),...(results.some(r=>r.status==='fulfilled'&&r.value.legacyPending)?['Каталог 0.5 на устройстве ещё не полностью проиндексирован. Откройте «Мои миры» в версии 0.5, затем обновите этот каталог.']:[])].join(' ');
  return results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
}
async function readCatalogPage(cursor){
  const controller=new AbortController();let timer;
  try{
    return await Promise.race([(async()=>{
      const response=await fetch('/api/world-catalog'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
      const text=await response.text();if(text.length>1500000)throw new Error('Ответ каталога слишком велик.');
      let data;try{data=JSON.parse(text);}catch{throw new Error('Облачный каталог вернул неподдерживаемый ответ.');}
      if(!response.ok){const error=new Error(response.status===401?'Для облачного каталога нужен вход. Локальные миры доступны.':data.error||'Облачный каталог сейчас недоступен.');error.code=response.status===401?'unauthorized':data.code;throw error;}
      if(!Array.isArray(data.worlds))throw new Error('Облачный каталог вернул неподдерживаемый ответ.');
      return data;
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Облачный каталог не ответил вовремя. Локальные миры доступны.'));},7000);})]);
  }finally{clearTimeout(timer);}
}
function catalogRows(){
  const rows=new Map();
  for(const remote of catalogCloudRows.values())rows.set(remote.key,{...remote,remote});
  for(const local of catalogLocalRows.values()){const remote=catalogCloudRows.get(local.key);rows.set(local.key,{...local,local,remote,updatedAt:[local.updatedAt,remote?.updatedAt??''].sort().at(-1)});}
  return [...rows.values()].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||b.year-a.year||a.key.localeCompare(b.key));
}
function catalogOpenButton(row,source,label,primary=false){
  return '<a class="catalog-open '+(primary?'primary':'')+'" href="'+h(modelPath(row.model,row.id,source))+'" data-catalog-open="'+row.model+'" data-world-id="'+h(row.id)+'" data-source="'+source+'">'+h(label)+'</a>';
}
function renderCatalogList(){
  const q=catalogQuery.toLocaleLowerCase('ru-RU'),rows=catalogRows().filter(r=>(catalogModel==='all'||catalogModel==='legacy'&&r.model!=='v06'||r.model===catalogModel)&&(!q||(r.name+' '+r.seed).toLocaleLowerCase('ru-RU').includes(q)));
  $('#catalog-count').textContent=rows.length+' миров'+(catalogCursor?' · есть следующая страница облака':'');
  $('#catalog-list').innerHTML=rows.map(row=>{
    const local=row.local,remote=row.remote,different=!!(local&&remote&&(local.dirty||local.year!==remote.year||(local.cloud?.revision??local.revision)!==remote.revision));
    const status=local?(local.ephemeral?'Только в памяти этого сеанса':remote?local.dirty?'На устройстве · есть несинхронизированные шаги':'На устройстве и в облаке':'На устройстве'):'В облаке';
    let actions;
    if(different)actions=catalogOpenButton(row,'local','Местная версия',true)+catalogOpenButton(row,'cloud','Облачная версия');
    else actions=catalogOpenButton(row,local?'local':'cloud','Продолжить',true);
    return '<article class="catalog-row"><div><div class="catalog-title"><h3>'+h(row.name)+'</h3><span class="model-badge">Модель '+h(catalogModels[row.model].label)+'</span></div><p>'+h(row.seed)+' · год '+row.year+'</p><small>'+h(status)+(different?' · в облаке год '+remote.year:'')+'</small></div><div class="world-actions">'+actions+'</div></article>';
  }).join('')||'<p class="empty">'+(catalogState==='loading'?'Локальных миров с такими условиями не найдено; облачный каталог загружается.':catalogState==='ready'?'В доступном каталоге нет миров с такими условиями.':'В доступных локальных каталогах таких миров нет. Облачный каталог пока не проверен.')+'</p>';
}
function renderArchive(){
  const focused=document.activeElement,restoreSearch=focused?.id==='catalog-search',selection=restoreSearch?[focused.selectionStart,focused.selectionEnd]:null;
  const stateText=(catalogIndexing?'Читаю дополнительные сохранения на устройстве. Список пока неполный. ':'')+(catalogState==='loading'?'Облачный каталог загружается.':catalogState==='ready'?'Облачный каталог проверен.':catalogIssue||'Облачный каталог пока не проверен.');
  $('#dialog-body').innerHTML='<p class="form-hint">Все модели в одном каталоге. Каждый мир продолжится в своей версии — пересчёта и автоматической миграции нет.</p><div class="catalog-status" role="status">'+h(stateText)+'</div>'+(legacyLocalIssue?'<p class="form-hint">'+h(legacyLocalIssue)+'</p>':'')+'<div class="history-filters catalog-filters"><label class="search-field">Найти мир<input id="catalog-search" type="search" value="'+h(catalogQuery)+'" placeholder="Название или код генерации"></label><label>Модель<select id="catalog-model"><option value="all">Все модели</option><option value="legacy"'+(catalogModel==='legacy'?' selected':'')+'>Все прежние модели</option>'+Object.entries(catalogModels).map(([key,model])=>'<option value="'+key+'"'+(catalogModel===key?' selected':'')+'>Версия '+h(model.label)+'</option>').join('')+'</select></label></div><div id="catalog-count" class="result-count"></div><div id="catalog-list"></div><div class="version-links"><a class="text-link" href="/v06?archive=1" data-open-archive="legacy">Прежние миры</a></div><p class="form-hint">Чтение прежних локальных каталогов не меняет сохранения. Если браузер не видит сохранение другого устройства, оно появится здесь только после облачной синхронизации.</p><div class="dialog-actions"><button id="retry-catalog">Обновить каталог</button>'+(catalogCursor?'<button id="more-worlds">Ещё облачные миры</button>':'')+(world?'<button id="restore-previous">Предыдущая копия текущего мира</button>':'')+'</div>';
  renderCatalogList();
  if(restoreSearch){const input=$('#catalog-search');input.focus();if(selection)input.setSelectionRange?.(...selection);}
}
async function worldDialog(more=false){
  setRunning(false);if(world&&!localConflict)await persist();
  const request=++archiveRequest;
  if(!more){catalogCloudRows.clear();catalogLocalRows.clear();catalogCursor=null;legacyLocalIssue='';}
  const firstPage=await store.list();catalogIndexing=!!firstPage.legacyPending;for(const record of firstPage){const row=catalogMetadata('v06',record);if(row)catalogLocalRows.set(row.key,row);}
  catalogState='loading';catalogIssue='';
  modal('Мои миры','<p class="loading">Читаю каталог…</p>',true);renderArchive();
  const repaint=()=>{if(request===archiveRequest&&$('#dialog').open&&$('#dialog-title').textContent==='Мои миры')renderArchive();};
  const indexOlder=(async()=>{let page=firstPage;while(page.legacyPending&&request===archiveRequest){await yieldFrame();page=await store.list();for(const record of page){const row=catalogMetadata('v06',record);if(row)catalogLocalRows.set(row.key,row);}catalogIndexing=!!page.legacyPending;repaint();}})();
  const legacy=more?Promise.resolve():readLegacyCatalog().then(rows=>{if(request!==archiveRequest)return;for(const row of rows)catalogLocalRows.set(row.key,row);repaint();});
  const remote=readCatalogPage(more?catalogCursor:null).then(page=>{
    if(request!==archiveRequest)return;
    for(const row of page.worlds){if(!catalogModels[row.model]||typeof row.id!=='string')continue;const safe={...row,key:row.model+':'+row.id};catalogCloudRows.set(safe.key,safe);if(row.model==='v06')cloudRows.set(row.id,row);}
    catalogCursor=page.nextCursor??null;catalogState='ready';catalogIssue='';repaint();
  }).catch(error=>{if(request!==archiveRequest)return;catalogState=error.code==='unauthorized'?'unauthorized':'error';catalogIssue=error.message;repaint();});
  await Promise.all([legacy,remote,indexOlder]);
}
function about(){modal('MICROGALAXY · 0.6 «Экономика и пути»','<p>Личная обсерватория одной звёздной системы: вы наблюдаете историю, а не управляете обществами.</p><h3>Ресурсы и пути</h3><p>Продовольствие, сырьё, энергия и оборудование учитываются в региональных запасах и отправлениях. Дороги и порты требуют строительства и содержания; грузы занимают время и могут теряться или ожидать открытия пути. Дефицит влияет на общества и миграцию.</p><p>Все величины условны: это игровая модель, а не научный прогноз. На глобусе слой маршрутов показывает переселения, а не грузопотоки. Полные сведения о грузах и балансе — на странице «Экономика и пути».</p><h3>История и сохранения</h3><p>Исторические срезы показывают сохранённое состояние, не каждый год. Старые миры открываются в собственных моделях через «Мои миры» и не преобразуются автоматически. Экспорт создаёт резервную копию; статус сообщает о локальном и облачном сохранении.</p>',true);}
function updateSound(){ $('#sound').textContent='Звук: '+(sound?'вкл.':'выкл.');$('#sound').setAttribute('aria-label',sound?'Выключить звук':'Включить звук');}
async function exportCurrent(){
  const text=await Storage.encodeSave(world),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='microgalaxy-'+world.year+'-'+world.seed.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',async e=>{
  const catalogLink=e.target.closest('[data-catalog-open]');
  if(catalogLink){e.preventDefault();const model=catalogLink.dataset.catalogOpen,id=catalogLink.dataset.worldId,source=catalogLink.dataset.source;if(!catalogModels[model]||!id||!['local','cloud'].includes(source))return;try{await transition(async()=>{if(model==='v06'){if(source==='local')await openLocal(id,{refresh:false});else await openCloud(id);}else{if(world)await persist();window.location.assign(modelPath(model,id,source));}});}catch(error){notice(error.message,error.name==='ConflictError');}return;}
  const archiveLink=e.target.closest('[data-open-archive]');
  if(archiveLink){e.preventDefault();catalogModel=archiveLink.dataset.openArchive==='legacy'?'legacy':'all';catalogQuery='';if($('#dialog').open&&$('#dialog-title').textContent==='Мои миры')renderArchive();else try{await worldDialog();}catch(error){notice(error.message,error.name==='ConflictError');}return;}
  const versionLink=e.target.closest('[data-version-link]');
  if(versionLink){e.preventDefault();const target=versionLink.dataset.versionLink;if(!['/v04','/v03','/classic'].includes(target))return;try{await transition(async()=>{if(world)await persist();window.location.assign(target);});}catch(error){notice(error.message,error.name==='ConflictError');}return;}
  const b=e.target.closest('button');if(!b||b.disabled||switching)return;
  if(sound&&!audio&&b.id!=='sound')playTone();
  try{
    if(b.dataset.view){setRunning(false);if(view!==b.dataset.view)resetEconomyPages();view=b.dataset.view;$('#dialog').close();render();}
    else if(b.dataset.planet){selectedPlanet=b.dataset.planet;view='planet';render();}
    else if(b.dataset.star){view='system';render();}
    else if(b.dataset.layer){layer=b.dataset.layer;if(layer==='routes'&&!selectedRegion){const w=displayed();selectedRegion=w.societies.find(s=>s.id===selectedSociety)?.capitalId??w.regions[0].id;}setRunning(false);render();}
    else if(b.dataset.speed){speed=Number(b.dataset.speed);$$('[data-speed]').forEach(x=>x.classList.toggle('active',x===b));}
    else if(b.dataset.region){showRegion(b.dataset.region);}
    else if(b.dataset.regionMap){showRegionMap(b.dataset.regionMap);}
    else if(b.dataset.routeFrom){showRegionMap(b.dataset.routeFrom,'routes');}
    else if(b.dataset.regionSociety){openSocietyRegions(b.dataset.regionSociety);}
    else if(b.dataset.event){showEvent(b.dataset.event);}
    else if(b.dataset.society){showSociety(b.dataset.society);}
    else if(b.dataset.jumpSociety){showSociety(b.dataset.jumpSociety);}
    else if(b.dataset.story){showStory(b.dataset.story);}
    else if(b.dataset.moreStory){storyEventLimit+=80;showStory(b.dataset.moreStory,true);}
    else if(b.dataset.relation){showRelation(b.dataset.relation);}
    else if(b.dataset.societyStories){openSocietyStories(b.dataset.societyStories);}
    else if(b.dataset.societyDiplomacy){openSocietyDiplomacy(b.dataset.societyDiplomacy);}
    else if(b.dataset.openChronicle){openChronicle(b.dataset.openChronicle);}
    else if(b.dataset.societyMap){showSocietyMap(b.dataset.societyMap);}
    else if(b.dataset.mapSociety){showSocietyMap(b.dataset.mapSociety);}
    else if(b.dataset.loadWorld){await transition(()=>openLocal(b.dataset.loadWorld,{refresh:false}));}
    else if(b.dataset.loadCloud){await transition(()=>openCloud(b.dataset.loadCloud));}
    else if(b.dataset.copyCloud){await transition(async()=>{const remote=await cloudClient.get(b.dataset.copyCloud);await installWorld(remote.world);notice('Облачный снимок открыт отдельным миром. Местная история и исходная облачная запись сохранены.');});}
    else switch(b.id){
      case 'toggle-inspector':{const expanded=$('#inspector').classList.toggle('mobile-expanded');b.setAttribute('aria-expanded',String(expanded));b.textContent=expanded?'Свернуть паспорт':'Паспорт';break;}
      case 'play':setRunning(!running);break;
      case 'step':setRunning(false);await step(10,false);break;
      case 'next-event':setRunning(false);await step(1000,true);break;
      case 'new-world':newDialog();break;
      case 'create-world':{const seed=$('#seed').value.trim()||randomSeed(),era=$('#era').value;await transition(()=>installWorld(Core.createWorld(seed,{era})));break;}
      case 'worlds':await worldDialog();break;
      case 'more-events':eventLimit+=160;renderEvents();break;
      case 'more-stories':storyLimit+=40;renderStoryList();break;
      case 'more-economy-routes':economyRouteLimit+=40;renderEconomy(displayed());($('#more-economy-routes')??$('#economy-route-count'))?.focus();break;
      case 'more-economy-shipments':economyShipmentLimit+=40;renderEconomy(displayed());($('#more-economy-shipments')??$('#economy-shipment-count'))?.focus();break;
      case 'more-worlds':await worldDialog(true);break;
      case 'retry-catalog':await worldDialog();break;
      case 'more-regions':regionLimit+=60;renderRegionList();break;
      case 'retry-requested':if(!requestedWorld){window.location.reload();break;}await transition(async()=>{await openRequestedWorld();});break;
      case 'sync-world':await syncCurrent(true);break;
      case 'reset-camera':renderer.reset();break;
      case 'live':snapshotIndex=null;resetEconomyPages();render();break;
      case 'about':about();break;
      case 'sound':sound=!sound;pref('microgalaxy:v06:sound',sound?'on':'off');updateSound();if(sound)playTone();break;
      case 'export':await exportCurrent();break;
      case 'import':setRunning(false);$('#import-file').click();break;
      case 'restore-previous':await transition(async()=>{const r=await store.get(world.id);if(!r?.previous)throw new Error('Предыдущей сохранённой копии пока нет.');await installWorld(r.previous);notice('Предыдущая версия открыта отдельным миром; исходная запись сохранена.');});break;
      case 'fork':await transition(async()=>{await installWorld(world,{skipCurrent:true});notice('Создана отдельная копия. Конфликтующая запись не перезаписана.');});break;
      case 'close-notice':$('#notice').hidden=true;break;
      case 'close-dialog':$('#dialog').close();break;
    }
  }catch(error){notice(error.message,error.name==='ConflictError');}
});
$('#auto-pause').addEventListener('change',e=>{autoPause=e.target.checked;});
$('#history-slider').addEventListener('input',e=>{setRunning(false);const v=Number(e.target.value);snapshotIndex=v===world.snapshots.length?null:v;resetEconomyPages();render();});
document.addEventListener('input',e=>{
  if(e.target.id==='region-search'){setRunning(false);regionQuery=e.target.value;regionLimit=60;renderRegionList();}
  if(e.target.id==='catalog-search'){catalogQuery=e.target.value;renderCatalogList();}
  if(e.target.id==='event-search'){setRunning(false);filterQuery=e.target.value;eventLimit=160;renderEvents();}
  if(e.target.id==='story-search'){setRunning(false);storyQuery=e.target.value;storyLimit=40;renderStoryList();}
});
document.addEventListener('change',e=>{
  const id=e.target.id,value=e.target.value;
  if(id==='map-region'){if(value)showRegionMap(value,layer==='routes'?'routes':'settlements');else{selectedRegion=null;render();}return;}
  if(id==='catalog-model'){catalogModel=value;renderCatalogList();return;}
  if(['region-society','region-kind','region-order'].includes(id)){setRunning(false);if(id==='region-society')regionSociety=value;else if(id==='region-kind')regionKind=value;else regionOrder=value;regionLimit=60;renderRegionList();return;}
  if(['event-type','event-society','event-order'].includes(id)){
    setRunning(false);if(id==='event-type')filterType=value;if(id==='event-society')filterSociety=value;if(id==='event-order')eventOrder=value;eventLimit=160;renderEvents();
  }else if(['story-society','story-order'].includes(id)){
    setRunning(false);if(id==='story-society')storySociety=value;else storyOrder=value;storyLimit=40;renderStoryList();
  }else if(['diplomacy-society','diplomacy-status','diplomacy-order'].includes(id)){
    setRunning(false);if(id==='diplomacy-society')diplomacySociety=value;if(id==='diplomacy-status')diplomacyStatus=value;if(id==='diplomacy-order')diplomacyOrder=value;renderRelations();
  }
});
$('#dialog').addEventListener('close',()=>{const target=dialogReturnFocus;dialogReturnFocus=null;const fallback=$('.tabs [data-view="'+view+'"]');(target&&target!==document.body&&target.isConnected&&target.getClientRects().length?target:fallback)?.focus();});
$('#import-file').addEventListener('change',async e=>{
  try{const f=e.target.files[0];if(!f)return;if(f.size>Storage.MAX_FILE_BYTES)throw new Error('Максимальный размер — 24 МБ.');
    const w=await Storage.decodeSave(await f.text());await transition(()=>installWorld(w));notice('Сохранение проверено и открыто отдельной копией.');
  }catch(error){notice(error.message,error.name==='ConflictError');}finally{e.target.value='';}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){setRunning(false);if(world&&!busy)void persist().then(()=>syncCurrent(false)).catch(()=>{});}});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(document.activeElement.tagName)&&!$('#dialog').open){e.preventDefault();setRunning(!running);}});
window.addEventListener('beforeunload',e=>{if(busy||localUnsaved||(!store?.persistent&&world&&(!currentRecord||Storage.isCloudDirty(currentRecord)))){e.preventDefault();e.returnValue='';}});
async function refreshBootCloud(initial){
  try{
    const page=await cloudClient.list();for(const row of page.worlds)cloudRows.set(row.id,row);cloudCursor=page.nextCursor;cloudState='ready';cloudIssue='';
    if(initial?.cloud?.revision){
      const remote=await cloudClient.get(initial.world.id,{revision:initial.cloud.revision});
      if(!remote.notModified&&remote.revision>initial.cloud.revision){
        const local=await store.getMetadata(initial.world.id);
        if(world?.id===initial.world.id&&!busy&&!running&&!switching&&!$('#dialog').open&&revision===initial.revision&&!Storage.isCloudDirty(local)){
          await transition(async()=>{const row=await store.receiveCloud(remote.world,remote.revision,remote.updatedAt,local.revision);selectRecord(row);notice('Загружена более новая облачная история.');});
        }else notice('В облаке есть другая версия. Откройте «Мои миры», чтобы выбрать историю.');
      }
    }
  }catch(error){cloudState='error';cloudIssue=error.message;}
  showSaveStatus();
}
function requestedWorldFromUrl(){
  const query=new URLSearchParams(window.location.search);
  if(!query.has('world'))return null;
  return {id:query.get('world')??'',source:query.get('source')??'auto'};
}
function showRequestedFailure(error){
  setRunning(false);$('#visual').hidden=true;$('#page-content').hidden=false;
  $('#page-content').innerHTML=pageHeading('Запрошенный мир не открыт','Другой мир не выбран и новая история не создана.')+'<p class="form-hint">'+h(error.message)+'</p><div class="dialog-actions"><button class="primary" id="retry-requested">Повторить открытие</button><button data-open-archive="all">Мои миры</button></div><p class="form-hint">Также можно явно создать новую систему или импортировать файл кнопками наверху.</p>';
  $('#world-title').textContent='Мир не открыт';$('#year').textContent='—';showSaveStatus();updateControls();
}
async function openRequestedWorld(){
  if(!requestedWorld)throw new Error('В ссылке не указан мир.');
  const {id,source}=requestedWorld;
  if(!/^(?:local-)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)||!['auto','local','cloud'].includes(source))throw new Error('Ссылка содержит пустой или неверный идентификатор мира либо источник.');
  if(source==='cloud'){await openCloud(id);return;}
  const local=await store.get(id);
  if(local){if(local.world.id!==id)throw new Error('Локальная запись относится к другому миру. Она не открыта и не изменена.');selectRecord(local);return;}
  if(source==='local')throw new Error('Этот мир не найден в локальном хранилище данного устройства. Откройте «Мои миры», чтобы проверить облачную копию.');
  await openCloud(id);
}
async function boot(){
  const openArchive=new URLSearchParams(window.location.search).get('archive')==='1';requestedWorld=requestedWorldFromUrl();
  switching=true;updateControls();bootStage('Подготовка обсерватории');sound=(pref('microgalaxy:v06:sound')??pref('microgalaxy:sound'))!=='off';updateSound();await yieldFrame();await initWorker();bootStage(workerReady?'Открытие хранилища':'Открытие хранилища · без фонового потока');await yieldFrame();
  let storageIssue='';
  try{store=await Storage.openWorldStore({validate:validateStoredWorld,onVersionChange:()=>{localConflict=true;setRunning(false);notice('Хранилище обновлено в другой вкладке. Экспортируйте текущую историю и обновите страницу.',true);showSaveStatus();updateControls();}});}catch(error){if(error.name==='VersionError'||error.code==='STORAGE_UPGRADE_BLOCKED'){switching=false;showRequestedFailure(new Error('Хранилище занято или имеет более новую версию. Закройте старые вкладки MICROGALAXY и обновите страницу.'));notice('Мир не открыт: '+error.message);return;}store=Storage.memoryWorldStore({validate:validateStoredWorld});storageIssue=error.message||'Браузер запретил постоянное хранилище.';}
  cloudSync=Cloud.createCloudSync(store,cloudClient);
  let initial,showModelChoice=false;
  if(requestedWorld){
    try{await openRequestedWorld();}catch(error){showRequestedFailure(error);notice(error.message,error.name==='ConflictError');}
  }else{
    let localFailed=false,last=pref('microgalaxy_economy_v06_last');
    try{bootStage('Проверка сохранённого мира');await yieldFrame();if(last){initial=await store.get(last);if(!initial)throw new Error('Последний выбранный мир не найден на устройстве.');}else{let locals=await store.list();while(locals.legacyPending){bootStage('Чтение сохранений на устройстве');await yieldFrame();locals=await store.list();}if(locals[0]?.id){last=locals[0].id;initial=await store.get(last);}}if(initial&&(initial.id!==last||initial.world?.id!==last))throw new Error('Сохранённая запись относится к другому миру.');}catch(error){initial=null;localFailed=true;if(last)requestedWorld={id:last,source:'local'};showRequestedFailure(error);notice('Не удалось прочитать локальный мир: '+error.message);}
    if(initial){selectRecord(initial);void refreshBootCloud(initial);}
    else if(!openArchive&&!localFailed){
      let cloudFailed=false;try{bootStage('Проверка облачного архива');await yieldFrame();const page=await cloudClient.list();for(const row of page.worlds)cloudRows.set(row.id,row);cloudCursor=page.nextCursor;cloudState='ready';if(page.worlds.length)await openCloud(page.worlds[0].id);}
      catch(error){cloudFailed=true;cloudState='error';cloudIssue=error.message;showRequestedFailure(error);}
      if(!world&&!cloudFailed&&!$('#dialog').open){
        const [older,all]=await Promise.all([readLegacyCatalog().catch(()=>[]),readCatalogPage(null).catch(()=>({worlds:[]}))]);
        showModelChoice=older.length>0||!!legacyLocalIssue||all.worlds.some(row=>row.model!=='v06'&&catalogModels[row.model]);
        if(showModelChoice){$('#visual').hidden=true;$('#page-content').hidden=false;$('#page-content').innerHTML=pageHeading('Выберите мир','Прежние миры сохраняются в своих моделях. Откройте один из них или создайте новую систему 0.6.');}
        else await installWorld(Core.createWorld(randomSeed()),{skipCurrent:true});
      }
    }else if(!localFailed){
      $('#visual').hidden=true;$('#page-content').hidden=false;$('#page-content').innerHTML=pageHeading('Личная обсерватория','Выберите сохранённый мир или создайте новую систему. Каждый мир продолжит свою историю в подходящей модели.');
    }
  }
  switching=false;updateControls();showSaveStatus();
  if(storageIssue)notice('Постоянное хранилище недоступно: '+storageIssue+' Миры остаются в памяти; используйте облако или экспорт.');
  setInterval(()=>{if(running&&!busy&&!switching&&!document.hidden&&!$('#dialog').open)void step(speed,autoPause);},450);
  setInterval(()=>{if(world&&!document.hidden&&!localConflict)void syncCurrent(false);},18000);
  if(currentRecord&&Storage.isCloudDirty(currentRecord))scheduleSync();
  if(openArchive||showModelChoice)await worldDialog();
}
boot().catch(error=>{switching=false;setRunning(false);notice('Не удалось открыть обсерваторию: '+error.message);updateControls();});
