'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)], h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=new Intl.NumberFormat('ru-RU'), short=new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}), fmt=n=>nf.format(Math.round(n));
const typeNames={origin:'Начало истории',climate:'Природа',economy:'Хозяйство',science:'Знания',politics:'Политика',diplomacy:'Дипломатия',migration:'Миграции',conflict:'Конфликт',space:'Космос'};
let world,store,revision=0,view='planet',layer='nature',selectedPlanet='p2',selectedSociety=null,snapshotIndex=null,busy=false,running=false,speed=1,autoPause=true,worker=null,workerReady=false,pending=new Map(),serial=0,noticeTimer,sound=true,audio=null,filterType='all',filterQuery='';
let switching=false,localConflict=false,localUnsaved=false,saveTail=Promise.resolve(),cloudSync,cloudTask=null,cloudTimer=null,cloudState='unknown',cloudIssue='',currentRecord=null,cloudCursor=null;
let filterSociety='all',eventOrder='recent',eventLimit=160,storySociety='all',storyQuery='',storyOrder='recent',storyLimit=40,diplomacySociety='all',diplomacyStatus='all',diplomacyOrder='trust',dialogReturnFocus=null,activeStory=null,storyEventLimit=80;
const cloudClient=Cloud.createCloudClient({timeoutMs:6000}),cloudRows=new Map();
function pref(key,value){try{if(value!==undefined)localStorage.setItem(key,value);return localStorage.getItem(key);}catch{return null;}}
function sameWorld(a,b){return JSON.stringify(a)===JSON.stringify(b);}
const renderer=new Renderer($('#space-canvas'),id=>{selectedPlanet=id;view='planet';render();},id=>showSociety(id));
function notice(text,conflict=false){clearTimeout(noticeTimer);if(conflict&&$('#dialog').open)$('#dialog').close();$('#notice-text').textContent=text;$('#notice').hidden=false;$('#fork').hidden=!conflict;if(!conflict)noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},12000);}
function setRunning(value){running=!!(value&&!localConflict&&!switching&&snapshotIndex===null&&world?.year<Core.LIMITS.years);$('#play').textContent=running?'Ⅱ Пауза':'▶ Наблюдать';$('#clock-status').textContent=snapshotIndex!==null?'Исторический срез':running?'Наблюдение':'На паузе';}
function displayed(){return snapshotIndex===null?world:Core.viewSnapshot(world,snapshotIndex);}
function currentPlanet(w){return w.planets.find(p=>p.id===selectedPlanet)??w.planets.find(p=>p.home);}
function playTone(){if(!sound)return;try{audio??=new (window.AudioContext||window.webkitAudioContext)();audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();osc.connect(gain);gain.connect(audio.destination);osc.frequency.value=523;gain.gain.setValueAtTime(.015,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+.2);osc.start();osc.stop(audio.currentTime+.2);}catch{sound=false;}}
function initWorker(){try{const text=JSON.parse($('#worker-source').textContent),url=URL.createObjectURL(new Blob([text],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);worker.onmessage=({data})=>{if(data.ready){workerReady=true;return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.result);};worker.onerror=()=>{workerReady=false;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Расчётный поток остановился. Исходный мир не изменён.'));}pending.clear();worker?.terminate();worker=null;};}catch{worker=null;workerReady=false;}}
function calculate(years,stop){if(!workerReady)return Promise.resolve(Core.advance(world,years,{stopOnImportant:stop}));return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);worker?.terminate();worker=null;workerReady=false;reject(new Error('Расчёт не завершился. Мир не изменён; повторный шаг выполнится без Worker.'));},15000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,world,years,stopOnImportant:stop});});}
function showSaveStatus(){
  const saved=currentRecord&&world&&sameWorld(currentRecord.world,world);
  let label=localConflict?'Конфликт · копия или экспорт':localUnsaved?'Не сохранено':cloudState==='syncing'?'Сохраняю в облако…':saved&&!Storage.isCloudDirty(currentRecord)?(store?.persistent?'Сохранено в облаке':'В облаке · без локальной копии'):!store?.persistent?'В памяти · экспорт':cloudState==='error'?'На устройстве · облако недоступно':'На устройстве · ждёт облака';
  $('#save-status').textContent=label;
  $('#save-status').title=cloudIssue||label;
}
function persist(){
  if(!store||!world)return Promise.resolve(null);
  const snapshot=Core.clone(world),capturedRevision=revision;
  const task=saveTail.catch(()=>{}).then(async()=>{
    const previous=await store.get(snapshot.id);
    let record;
    if(previous&&sameWorld(previous.world,snapshot))record=previous;
    else{
      const expected=world?.id===snapshot.id?revision:capturedRevision;
      const savedRevision=await store.put(snapshot,expected);
      record={id:snapshot.id,name:snapshot.name,seed:snapshot.seed,year:snapshot.year,world:snapshot,revision:savedRevision,cloud:previous?.cloud??null};
    }
    if(world?.id===snapshot.id){revision=record.revision;currentRecord=record;localUnsaved=!sameWorld(snapshot,world);pref('microgalaxy_history_v04_last',snapshot.id);showSaveStatus();}
    return record;
  }).catch(error=>{
    if(world?.id===snapshot.id){localUnsaved=true;localConflict=error.name==='ConflictError';setRunning(false);showSaveStatus();notice(error.message,localConflict);updateControls();}
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
        if(sameWorld(result.record.world,world)){currentRecord=result.record;localUnsaved=false;}
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
async function step(years,stop=false){if(busy||switching||localConflict||snapshotIndex!==null||!world)return;busy=true;updateControls();try{const result=await calculate(years,stop);world=result.world;localUnsaved=true;try{await persist();scheduleSync();}catch{}if((stop&&result.newEvents.some(e=>e.important))||result.world.year>=Core.LIMITS.years)setRunning(false);if(result.newEvents.some(e=>e.important))playTone();render();if(!result.advanced)notice('Достигнут предел расчёта — 10 000 лет. Историю можно исследовать и экспортировать.');}catch(e){setRunning(false);notice(e.message);}finally{busy=false;updateControls();}}
function updateControls(){for(const id of ['#step','#next-event','#new-world','#worlds','#import','#export','#sync-world'])$(id).disabled=busy||switching||!world||((snapshotIndex!==null||localConflict)&&['#step','#next-event'].includes(id));$('#play').disabled=!world||busy||switching||localConflict||snapshotIndex!==null;$('#history-slider').disabled=busy||switching;}
function render(){if(!world)return;const w=displayed(),p=currentPlanet(w),societyIds=new Set(w.societies.map(s=>s.id));if(selectedSociety&&!societyIds.has(selectedSociety))selectedSociety=null;for(const key of ['filter','story','diplomacy']){const value=key==='filter'?filterSociety:key==='story'?storySociety:diplomacySociety;if(value!=='all'&&!societyIds.has(value)){if(key==='filter')filterSociety='all';else if(key==='story')storySociety='all';else diplomacySociety='all';}}$('#world-title').textContent='Система '+w.name+' / '+w.seed;$('#year').textContent='Год '+String(w.year).padStart(5,'0');$('#event-count').textContent=w.events.length;$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$$('[data-layer]').forEach(b=>b.classList.toggle('active',b.dataset.layer===layer));$('#bodies').innerHTML=`<div class="side-title">Звёздная система <span>${w.planets.length}</span></div><button class="body-item" data-star="1"><span class="orb star"></span><span><span class="body-name">${h(w.name.split(' · ')[0])}</span><span class="body-sub">${w.star.mass.toFixed(2)} M☉ · ${(w.star.temperature/1000).toFixed(1)} тыс. K</span></span></button>`+w.planets.map((p,i)=>`<button class="body-item ${p.id===selectedPlanet?'selected':''}" data-planet="${h(p.id)}"><span class="orb" style="background:${p.home?'#588a9b':p.kind==='gas'?'#b7916a':p.kind==='ice'?'#a4c0c9':'#927c69'}"></span><span><span class="body-name">${h(p.name)}</span><span class="body-sub">${p.a.toFixed(2)} а. е.${p.home?' · Биосфера':''}</span></span></button>`).join('');
  const visual=['planet','system'].includes(view);$('#visual').hidden=!visual;$('#page-content').hidden=visual;$('#scene-title').textContent=view==='system'?w.name:p.name;$('#scene-kind').textContent=view==='system'?'Одна система · автономная история':p.home?'Обитаемый мир':p.kind==='gas'?'Газовый гигант':p.kind==='ice'?'Ледяной мир':'Каменистая планета';$('#scene-caption').textContent=view==='system'?`${w.planets.length} планет · ${w.colonies.length} поселений · ${w.missions.filter(m=>m.status==='transit').length} миссий в пути`:`${p.radius.toFixed(2)} R⊕ · ${p.a.toFixed(2)} а. е. · ${p.moons} спутн.`;$('.layers').hidden=view==='system';$('#scene-note').hidden=view==='system';if(visual)renderer.update(w,view,p,layer,selectedSociety);else renderPage(w);renderMapLegend(w,p);
  renderInspector(w,p);$('#recent').innerHTML=w.events.slice(-2).reverse().map(e=>`<button class="event-mini" data-event="${h(e.id)}"><span class="ev-meta">Год ${e.year}<span>${h(typeNames[e.type]??e.type)}</span></span><b>${h(e.title)}</b><p>${h(e.detail)}</p></button>`).join('');$('#history-slider').max=world.snapshots.length;$('#history-slider').value=snapshotIndex===null?world.snapshots.length:snapshotIndex;$('#history-label').textContent=snapshotIndex===null?'Текущее состояние':'Срез: год '+w.year;$('#history-label').classList.toggle('archive-flag',snapshotIndex!==null);$('#live').disabled=snapshotIndex===null;setRunning(running);updateControls();}
function renderMapLegend(w,p){
  const visible=view==='planet'&&layer==='political'&&p.home,node=$('#map-legend');
  node.hidden=!visible;if(!visible)return;
  $('#scene-note').hidden=true;
  const previous=w.snapshots.filter(s=>s.year<w.year).at(-1),owners=previous?new Map(previous.regions.map(r=>[r.id,r.owner])):null,changed=owners?w.regions.filter(r=>owners.get(r.id)!==r.owner).length:0;
  node.innerHTML='<p>Столицы · выберите общество для фокуса</p><div>'+w.societies.filter(s=>s.population>0).map(s=>'<button data-map-society="'+h(s.id)+'" aria-label="Показать столицу '+h(societyName(w,s.id))+'"'+(s.id===selectedSociety?' class="active"':'')+'><i class="dot" style="background:'+h(s.color)+'"></i>'+h(societyName(w,s.id))+'</button>').join('')+'</div>'+(changed?'<small>◇ '+changed+' регионов сменили владельца после '+previous.year+' года</small>':'');
}
const pct=value=>Math.round(Core.clamp(Number(value)||0,0,1)*100)+'%';
function societyName(w,id){const s=w.societies.find(s=>s.id===id);if(!s)return id;return s.name+(w.societies.some(other=>other.id!==id&&other.name===s.name)?' · '+s.id:'');}
function societyOptions(w,value){return '<option value="all">Все общества</option>'+w.societies.map(s=>'<option value="'+h(s.id)+'"'+(value===s.id?' selected':'')+'>'+h(societyName(w,s.id))+'</option>').join('');}
function societyButton(w,id,attribute='data-society'){const s=w.societies.find(s=>s.id===id);return s?'<button class="society-link" '+attribute+'="'+h(id)+'"><i class="dot" style="background:'+h(s.color)+'"></i>'+h(societyName(w,s.id))+'</button>':h(id);}
function measure(label,value,unit=''){return '<div><small>'+h(label)+'</small><strong>'+h(value)+(unit?'<i> '+h(unit)+'</i>':'')+'</strong></div>';}
function meter(label,value){return '<div class="political-meter"><div><span>'+h(label)+'</span><b>'+pct(value)+'</b></div><div class="progress"><span style="width:'+pct(value)+'"></span></div></div>';}
function crisisTag(value){return value?'<span class="state-tag warning">'+h(typeof value==='string'?value:'Кризис управления')+'</span>':'';}
function eventEntities(e){return Array.isArray(e.entityIds)?e.entityIds:e.entityId?[e.entityId]:[];}
function orderedEvents(w,events,reverse=false){const indexes=new Map(w.events.map((e,i)=>[e.id,i]));const result=events.slice().sort((a,b)=>a.year-b.year||(indexes.get(a.id)??0)-(indexes.get(b.id)??0));return reverse?result.reverse():result;}
function pageHeading(title,subtitle,extra=''){return '<div class="page-heading"><div><h1>'+h(title)+'</h1><p class="subtitle">'+h(subtitle)+'</p></div>'+extra+'</div>';}

function renderInspector(w,p){
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
  if(view==='societies'){
    node.innerHTML=pageHeading('Общества','Власть, внутренние группы и институты. Каждая карточка открывает подробную историю общества.')+'<div class="soc-grid">'+w.societies.map(s=>societyCard(w,s)).join('')+'</div><h2 class="section-heading">Внеземные поселения</h2>'+(w.colonies.length?'<div class="soc-grid">'+w.colonies.map(c=>'<article class="soc-card colony-card"><h2>'+h(c.name)+'</h2><div class="soc-meta">'+h(w.planets.find(p=>p.id===c.planet)?.name??c.planet)+' · основано в '+c.founded+'</div><div class="number">'+fmt(c.population)+' <small>жителей</small></div><div class="soc-meta">'+(c.independent?'Самостоятельное поселение':'Связано с '+h(societyName(w,c.parent)))+' · автономия '+pct(c.autonomy)+'</div><button class="outline-action" data-society="'+h(c.parent)+'">Общество-основатель</button></article>').join('')+'</div>':'<p class="empty">Пока нет. Для запуска нужны технологии, материалы и разведка планеты.</p>');
  }else if(view==='diplomacy'){renderDiplomacy(w);}
  else if(view==='stories'){renderStories(w);}
  else if(view==='chronicle'){
    node.innerHTML=pageHeading('Хроника','Условия и связи записываются в момент события. Откройте запись, чтобы проследить её предысторию и последствия.')+'<div class="history-filters"><label class="search-field">Поиск<input type="search" id="event-search" placeholder="Найти событие" value="'+h(filterQuery)+'"></label><label>Общество<select id="event-society">'+societyOptions(w,filterSociety)+'</select></label><label>Тип<select id="event-type"><option value="all">Все события</option>'+Object.entries(typeNames).map(([key,label])=>'<option value="'+key+'"'+(filterType===key?' selected':'')+'>'+h(label)+'</option>').join('')+'</select></label><label>Порядок<select id="event-order"><option value="recent"'+(eventOrder==='recent'?' selected':'')+'>Сначала новые</option><option value="oldest"'+(eventOrder==='oldest'?' selected':'')+'>От начала истории</option></select></label></div><div id="event-match-count" class="result-count" role="status"></div><div id="event-list"></div>';
    renderEvents(w);
  }else if(view==='analysis'){
    const histories=w.history.length?w.history:[Core.summary(w)],s=Core.summary(w);
    node.innerHTML=pageHeading('Состояние системы','Исторические показатели записываются каждые 10 лет. Это значения игровой модели, не научный прогноз.')+'<div class="stat-grid analysis-stats">'+measure('Жителей во всей системе',fmt(s.population))+measure('Изменение температуры',s.warming.toFixed(2),'°C')+measure('Действующие конфликты',s.wars)+measure('Средний уровень исследований',s.knowledge.toFixed(2))+(Number.isFinite(s.activeTreaties)?measure('Действующие договоры',s.activeTreaties):'')+(Number.isFinite(s.avgLegitimacy)?measure('Средняя легитимность',pct(s.avgLegitimacy)):'')+'</div>'+chart(histories,'population','Население системы')+chart(histories,'warming','Потепление, °C')+'<div class="chart-block"><h2>Покрытие архива</h2><p class="subtitle">Сохранена начальная точка и последние 63 среза с шагом 25 лет. В прошлом доступны только эти срезы. События и их причинные ссылки остаются в хронике до лимита 16 000 записей; скрытого удаления нет.</p></div>';
  }
}
function chart(rows,key,title){const vals=rows.map(r=>r[key]),max=Math.max(...vals,1),min=Math.min(...vals,0),points=rows.map((r,i)=>(12+i/Math.max(1,rows.length-1)*576)+','+(148-(r[key]-min)/(max-min)*126)).join(' ');return '<section class="chart-block"><h2>'+h(title)+'</h2><svg viewBox="0 0 600 165" role="img" aria-label="'+h(title)+' по годам"><path d="M12 22H588 M12 85H588 M12 148H588" fill="none" stroke="#36423d" stroke-width=".7"/><polyline points="'+points+'" fill="none" stroke="#c9d5a6" stroke-width="2.5"/></svg><div class="chart-caption"><span>Год '+rows[0].year+'</span><span>Макс. '+nf.format(Number(max.toFixed(2)))+'</span><span>Год '+rows.at(-1).year+'</span></div></section>';}

function renderEvents(w=displayed()){
  const q=filterQuery.toLocaleLowerCase('ru-RU');
  const matched=w.events.filter(e=>(filterType==='all'||e.type===filterType)&&(filterSociety==='all'||eventEntities(e).includes(filterSociety))&&(e.title+' '+e.detail).toLocaleLowerCase('ru-RU').includes(q));
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
  const q=storyQuery.toLocaleLowerCase('ru-RU'),eventMap=new Map(w.events.map(e=>[e.id,e]));
  const matched=Core.storylines(w).filter(s=>(storySociety==='all'||s.societyIds.includes(storySociety))&&(!q||s.title.toLocaleLowerCase('ru-RU').includes(q)||s.eventIds.some(id=>((eventMap.get(id)?.title??'')+' '+(eventMap.get(id)?.detail??'')).toLocaleLowerCase('ru-RU').includes(q)))).sort((a,b)=>storyOrder==='oldest'?a.startYear-b.startYear:b.endYear-a.endYear);
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
  const w=displayed(),e=w.events.find(item=>item.id===id);
  if(!e){notice('Это событие отсутствует в выбранном историческом срезе.');return;}
  const thread=Core.eventThread(w,id),before=orderedEvents(w,thread.before).slice(-12),after=orderedEvents(w,thread.after).slice(0,12);
  const stories=Core.storylines(w).filter(s=>s.eventIds.includes(id));
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
  if(s.parentId)html+='<p class="lineage-note">Общество-предшественник: '+societyButton(w,s.parentId)+'</p>';
  html+='<p class="form-hint">'+h(s.language)+' — языковая традиция. Детальная грамматика и отдельные жители не моделируются.</p><div class="dialog-actions"><button data-society-map="'+h(id)+'">Показать столицу</button><button data-society-diplomacy="'+h(id)+'">Дипломатия</button><button class="primary" data-society-stories="'+h(id)+'">Истории общества</button></div>';
  modal(societyName(w,s.id),html,true);
}
function showRelation(id){
  const w=displayed(),r=Core.diplomacySummary(w).find(item=>item.id===id);if(!r)return;
  const causes=(r.causeEventIds??[]).map(eid=>w.events.find(e=>e.id===eid)).filter(Boolean);
  const html='<div class="relation-parties">'+societyButton(w,r.a)+'<span aria-hidden="true">↔</span>'+societyButton(w,r.b)+'</div><div class="dossier-intro"><p>'+h(r.status)+' · '+h(r.treaty||'Без договора')+'</p></div><div class="stat-grid dossier-stats">'+measure('Доверие',pct(r.trust))+measure('Поставки за год',fmt(r.trade),'ед. пищи')+measure('Потребность '+societyName(w,r.a)+', покрытая '+societyName(w,r.b),pct(r.dependencyA))+measure('Потребность '+societyName(w,r.b)+', покрытая '+societyName(w,r.a),pct(r.dependencyB))+'</div><p class="mechanics-note">Зависимость — сглаженная по последним годам доля потребности в пище, а не доля импорта. Договоры расширяют реальные поставки; союзы допускают помощь и сдерживают конфликт. Всё выражено в игровых единицах.</p><section class="event-causes"><h3>Записанные основания отношений</h3>'+(causes.length?orderedEvents(w,causes).map(linkedEventButton).join(''):'<p class="form-hint">Связанные события пока не записаны.</p>')+'</section>';
  modal('Отношения: '+societyName(w,r.a)+' и '+societyName(w,r.b),html,true);
}
function showStory(id,more=false){
  const w=displayed(),s=Core.storylines(w).find(item=>item.id===id);if(!s){notice('История отсутствует в выбранном срезе.');return;}
  if(!more||activeStory!==id)storyEventLimit=80;activeStory=id;
  const eventMap=new Map(w.events.map(e=>[e.id,e])),events=orderedEvents(w,s.eventIds.map(eid=>eventMap.get(eid)).filter(Boolean)),shown=events.slice(0,storyEventLimit);
  const html='<div class="story-meta"><span>Годы '+s.startYear+(s.endYear!==s.startYear?'–'+s.endYear:'')+' · '+s.eventCount+' событий</span><span>'+h(s.status)+'</span></div><div class="affected-societies">'+s.societyIds.map(sid=>societyButton(w,sid)).join('')+'</div><p class="form-hint">События расположены по времени. Нажмите на событие: в его карточке показаны собственные причинные ссылки, а не только соседние записи.</p><ol class="story-timeline">'+shown.map(e=>'<li><button data-event="'+h(e.id)+'"><time>Год '+e.year+'</time><span class="event-kind">'+h(typeNames[e.type]??e.type)+'</span><b>'+h(e.title)+'</b><p>'+h(e.detail)+'</p></button></li>').join('')+'</ol>'+(events.length>shown.length?'<button class="outline-action" data-more-story="'+h(id)+'">Показать следующие события</button>':'')+'<div class="dialog-actions"><button data-view="stories">Все истории</button></div>';
  modal(s.title,html,true);
}
function openSocietyStories(id){setRunning(false);storySociety=id;storyQuery='';storyLimit=40;selectedSociety=id;view='stories';$('#dialog').close();render();}
function openSocietyDiplomacy(id){setRunning(false);diplomacySociety=id;diplomacyStatus='all';selectedSociety=id;view='diplomacy';$('#dialog').close();render();}
function openChronicle(id){setRunning(false);filterSociety=id;filterType='all';filterQuery='';eventLimit=160;view='chronicle';$('#dialog').close();render();}
function showSocietyMap(id){
  const w=displayed();selectedSociety=id;selectedPlanet=w.planets.find(p=>p.home).id;view='planet';layer='political';$('#dialog').close();setRunning(false);render();renderer.focusSociety(id);
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
  Core.validateWorld(record.world);world=Core.clone(record.world);revision=record.revision;currentRecord=record;
  filterSociety='all';filterType='all';filterQuery='';eventLimit=160;storySociety='all';storyQuery='';storyLimit=40;diplomacySociety='all';diplomacyStatus='all';activeStory=null;
  localConflict=false;localUnsaved=false;snapshotIndex=null;selectedSociety=null;selectedPlanet=world.planets.find(p=>p.home).id;view='planet';renderer.cacheKey='';
  $('#dialog').close();$('#notice').hidden=true;pref('microgalaxy_history_v04_last',world.id);showSaveStatus();render();setRunning(false);
}
async function transition(action){
  if(busy||switching)throw new Error('Дождитесь завершения текущего шага.');
  switching=true;setRunning(false);updateControls();
  const oldId=world?.id, wasDirty=localUnsaved, conflicted=localConflict, oldTail=saveTail;
  try{const result=await action();if(oldId&&oldId!==world?.id&&!conflicted&&store?.releaseWorld&&(!wasDirty||saveTail!==oldTail)){try{await saveTail;const sync=cloudTask?await cloudTask:true;const metadata=await store.getMetadata(oldId);const cloudClean=!!metadata?.cloud?.revision&&metadata.cloud.syncedRevision===metadata.revision&&!Storage.isCloudDirty(metadata);await store.releaseWorld(oldId);if(sync!==false&&cloudClean&&!cloudTask)try{await RetentionClient.releaseCloudWorld("v04",oldId);}catch{}}catch{/* Uncertain final save keeps the old world protected. */}}return result;}finally{switching=false;updateControls();}
}
async function installWorld(w,{skipCurrent=false}={}){
  Core.validateWorld(w);if(!skipCurrent&&world)await persist();
  const next=Core.clone(w);next.id=uniqueId();const savedRevision=await store.put(next,0);
  selectRecord({world:next,revision:savedRevision,cloud:null});scheduleSync();
}
async function openLocal(id){
  if(world)await persist();
  let record=await store.get(id);if(!record)throw new Error('Мир не найден.');
  const remote=cloudRows.get(id);
  if(remote&&record.cloud?.revision&&remote.revision>record.cloud.revision&&!Storage.isCloudDirty(record)){
    try{const saved=await cloudClient.get(id);record=await store.receiveCloud(saved.world,saved.revision,saved.updatedAt,record.revision);cloudState='ready';}
    catch(error){cloudState='error';cloudIssue=error.message;}
  }
  selectRecord(record);
}
async function openCloud(id){
  if(world)await persist();
  const remote=await cloudClient.get(id);let local;
  try{local=await store.get(id);if(local&&local.world.id!==id)throw new Error('Неверный идентификатор локальной записи.');}
  catch(error){
    modal('Локальная копия не читается','<p>Облачная история доступна, но местная запись повреждена. Она не изменена.</p><p class="form-hint">Можно открыть облачную историю отдельным новым миром, сохранив исходную запись для восстановления.</p><div class="dialog-actions"><button class="primary" data-copy-cloud="'+h(id)+'">Облако отдельной копией</button></div>');
    return;
  }
  try{
    const record=await store.receiveCloud(remote.world,remote.revision,remote.updatedAt,local?.revision??0);
    cloudState='ready';cloudIssue='';selectRecord(record);
  }catch(error){
    if(error.name!=='ConflictError')throw error;
    modal('Две сохранённые истории','<p>На устройстве есть другой вариант этого мира. Он не заменён облачной версией.</p><p class="form-hint">Можно продолжить местную историю либо открыть облачный снимок отдельным новым миром. Оба исходных сохранения останутся доступны.</p><div class="dialog-actions"><button data-load-world="'+h(id)+'">Местная история</button><button class="primary" data-copy-cloud="'+h(id)+'">Облако отдельной копией</button></div>');
  }
}
let archiveRequest=0;
function renderArchive(locals){
  const merged=new Map(cloudRows);
  for(const row of locals)merged.set(row.id,{...row,local:true,remote:cloudRows.get(row.id)});
  const rows=[...merged.values()].sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||b.year-a.year);
  let html='<p class="form-hint">Миры модели 0.4. '+(store.persistent?'Локальная запись работает на этом устройстве.':'Постоянное хранилище недоступно: используйте облако и экспорт.')+' '+(cloudState==='error'?'Облако сейчас недоступно; показаны имеющиеся копии.':'Облачные копии доступны после входа с других устройств.')+'</p><div class="version-links"><a class="text-link" href="/v03" data-version-link="/v03">Миры версии 0.3</a><a class="text-link" href="/classic" data-version-link="/classic">Миры версий 0.1–0.2</a></div><p class="form-hint">Прежние миры продолжаются в своих моделях. Новый запуск 0.4 создаёт отдельную историю и не пересчитывает старую.</p>';
  for(const row of rows){
    const different=!!(!row.metadataPending&&row.local&&row.remote&&(Storage.isCloudDirty(row)||row.remote.revision!==(row.cloud?.revision??0)));
    const label=row.metadataPending?'Метаданные ещё не проверены':row.local?(Storage.isCloudDirty(row)?'На устройстве · есть несинхронизированные шаги':'На устройстве и в облаке'):'В облаке';
    html+='<div class="world-row"><div>'+h(row.name)+'<small>'+(row.metadataPending?'':h(row.seed)+' · год '+row.year)+'</small><small>'+label+(different?' · облачная ревизия '+row.remote.revision:'')+'</small></div><div class="world-actions"><button class="primary" '+(row.local?'data-load-world':'data-load-cloud')+'="'+h(row.id)+'">Открыть</button>'+(different?'<button data-load-cloud="'+h(row.id)+'">Облачная версия</button>':'')+'</div></div>';
  }
  if(!rows.length)html+='<p>Пока нет сохранений.</p>';
  html+='<div class="dialog-actions">'+(cloudCursor?'<button id="more-worlds">Ещё облачные миры</button>':'')+'<button id="restore-previous">Предыдущая копия текущего мира</button></div>';
  $('#dialog-body').innerHTML=html;
}
async function worldDialog(more=false){
  if(world&&!localConflict)await persist();
  const request=++archiveRequest;
  if(!more){cloudRows.clear();cloudCursor=null;}
  const locals=await store.list();
  modal('Мои миры','<p class="loading">Проверяю сохранения…</p>');
  renderArchive(locals);
  if(store.indexLegacy&&locals.some(row=>row.metadataPending))setTimeout(()=>{void (async()=>{try{await store.indexLegacy(2);if(request===archiveRequest&&$('#dialog').open&&$('#dialog-title').textContent==='Мои миры')renderArchive(await store.list());}catch{/* Unindexed entries remain visible and unchanged. */}})();},0);
  try{
    const page=await cloudClient.list(more?cloudCursor:null);
    for(const row of page.worlds)cloudRows.set(row.id,row);
    cloudCursor=page.nextCursor;cloudState='ready';cloudIssue='';
  }catch(error){cloudState='error';cloudIssue=error.message;}
  if(request===archiveRequest&&$('#dialog').open&&$('#dialog-title').textContent==='Мои миры')renderArchive(await store.list());
  showSaveStatus();
}
function about(){modal('MICROGALAXY · 0.4 «Истории цивилизаций»','<p>Личная обсерватория одной звёздной системы. Вы наблюдаете историю, а не управляете обществами.</p><h3>Что изменилось</h3><p>Внутренние группы влияют на политический курс, легитимность и преемственность. Договоры изменяют реальные поставки; союзы связывают общества обязательствами. Хроника сохраняет причинные ссылки, из которых складываются истории цивилизаций.</p><h3>Ваши прежние миры</h3><p>Миры <a class="text-link" href="/v03" data-version-link="/v03">версии 0.3</a> и <a class="text-link" href="/classic" data-version-link="/classic">версий 0.1–0.2</a> остаются в своих моделях. Автоматического преобразования нет: новый запуск 0.4 создаёт отдельную историю. Старые файлы импортируются в соответствующей версии.</p><h3>Сохранения</h3><p>Миры сохраняются на устройстве и в личном облачном архиве, когда он доступен. Статус наверху показывает результат; «Сохранить» проверяет синхронизацию. Экспорт нужен для независимой резервной копии.</p><p class="form-hint">Генеративного ИИ и телеметрии нет. Глобус и орбиты рисуются кодом. Горизонт — 10 000 лет; хранятся начальный и последние 63 исторических среза. Единицы производства, политические показатели и исследовательские уровни игровые: это не научный прогноз.</p>',true);}
function updateSound(){ $('#sound').textContent='Звук: '+(sound?'вкл.':'выкл.');$('#sound').setAttribute('aria-label',sound?'Выключить звук':'Включить звук');}
async function exportCurrent(){
  const text=await Storage.encodeSave(world),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='microgalaxy-'+world.year+'-'+world.seed.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',async e=>{
  const versionLink=e.target.closest('[data-version-link]');
  if(versionLink){e.preventDefault();const target=versionLink.dataset.versionLink;if(!['/v03','/classic','/?archive=1'].includes(target))return;try{await transition(async()=>{if(world)await persist();window.location.assign(target);});}catch(error){notice(error.message,error.name==='ConflictError');}return;}
  const b=e.target.closest('button');if(!b||b.disabled||switching)return;
  if(sound&&!audio&&b.id!=='sound')playTone();
  try{
    if(b.dataset.view){setRunning(false);view=b.dataset.view;$('#dialog').close();render();}
    else if(b.dataset.planet){selectedPlanet=b.dataset.planet;view='planet';render();}
    else if(b.dataset.star){view='system';render();}
    else if(b.dataset.layer){layer=b.dataset.layer;render();}
    else if(b.dataset.speed){speed=Number(b.dataset.speed);$$('[data-speed]').forEach(x=>x.classList.toggle('active',x===b));}
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
    else if(b.dataset.loadWorld){await transition(()=>openLocal(b.dataset.loadWorld));}
    else if(b.dataset.loadCloud){await transition(()=>openCloud(b.dataset.loadCloud));}
    else if(b.dataset.copyCloud){await transition(async()=>{const remote=await cloudClient.get(b.dataset.copyCloud);await installWorld(remote.world);notice('Облачный снимок открыт отдельным миром. Местная история и исходная облачная запись сохранены.');});}
    else switch(b.id){
      case 'play':setRunning(!running);break;
      case 'step':setRunning(false);await step(10,false);break;
      case 'next-event':setRunning(false);await step(1000,true);break;
      case 'new-world':newDialog();break;
      case 'create-world':{const seed=$('#seed').value.trim()||randomSeed(),era=$('#era').value;await transition(()=>installWorld(Core.createWorld(seed,{era})));break;}
      case 'worlds':await worldDialog();break;
      case 'more-events':eventLimit+=160;renderEvents();break;
      case 'more-stories':storyLimit+=40;renderStoryList();break;
      case 'more-worlds':await worldDialog(true);break;
      case 'sync-world':await syncCurrent(true);break;
      case 'reset-camera':renderer.reset();break;
      case 'live':snapshotIndex=null;render();break;
      case 'about':about();break;
      case 'sound':sound=!sound;pref('microgalaxy:v04:sound',sound?'on':'off');updateSound();if(sound)playTone();break;
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
$('#history-slider').addEventListener('input',e=>{setRunning(false);const v=Number(e.target.value);snapshotIndex=v===world.snapshots.length?null:v;render();});
document.addEventListener('input',e=>{
  if(e.target.id==='event-search'){setRunning(false);filterQuery=e.target.value;eventLimit=160;renderEvents();}
  if(e.target.id==='story-search'){setRunning(false);storyQuery=e.target.value;storyLimit=40;renderStoryList();}
});
document.addEventListener('change',e=>{
  const id=e.target.id,value=e.target.value;
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
      const remote=await cloudClient.get(initial.world.id);
      if(remote.revision>initial.cloud.revision){
        const local=await store.get(initial.world.id);
        if(world?.id===initial.world.id&&!busy&&!running&&!switching&&!$('#dialog').open&&revision===initial.revision&&!Storage.isCloudDirty(local)){
          await transition(async()=>{const row=await store.receiveCloud(remote.world,remote.revision,remote.updatedAt,local.revision);selectRecord(row);notice('Загружена более новая облачная история.');});
        }else notice('В облаке есть другая версия. Откройте «Мои миры», чтобы выбрать историю.');
      }
    }
  }catch(error){cloudState='error';cloudIssue=error.message;}
  showSaveStatus();
}
async function boot(){
  switching=true;updateControls();sound=(pref('microgalaxy:v04:sound')??pref('microgalaxy:sound'))!=='off';updateSound();initWorker();
  let storageIssue='';
  try{store=await Storage.openWorldStore();}catch(error){store=Storage.memoryWorldStore();storageIssue=error.message||'Браузер запретил постоянное хранилище.';}
  cloudSync=Cloud.createCloudSync(store,cloudClient);
  const query=new URLSearchParams(window.location.search),requestedId=query.get('world'),requestedSource=query.get('source')??'auto';
  if(query.has('world')){
    if(!/^(?:local-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)||!['auto','cloud','local'].includes(requestedSource))throw new Error('Неверная ссылка на сохранённый мир. Вернитесь в общий каталог.');
    const local=requestedSource==='cloud'?undefined:await store.get(requestedId);
    if(requestedSource==='local'||(requestedSource==='auto'&&local)){
      if(!local)throw new Error('Запрошенного мира нет на этом устройстве. Откройте облачную запись из общего каталога.');
      if(local.world.id!==requestedId)throw new Error('Идентификатор местной истории не совпадает со ссылкой. Запись не изменена.');
      selectRecord(local);
    }else await openCloud(requestedId);
    switching=false;updateControls();
  }else{
  let initial;
  try{const last=pref('microgalaxy_history_v04_last'),locals=await store.list(),id=locals.find(r=>r.id===last)?.id??locals[0]?.id;if(id)initial=await store.get(id);}catch(error){notice('Не удалось прочитать локальный мир: '+error.message);}
  if(initial){selectRecord(initial);switching=false;updateControls();void refreshBootCloud(initial);}
  else{
    try{const page=await cloudClient.list();for(const row of page.worlds)cloudRows.set(row.id,row);cloudCursor=page.nextCursor;cloudState='ready';if(page.worlds.length){const remote=await cloudClient.get(page.worlds[0].id);selectRecord(await store.receiveCloud(remote.world,remote.revision,remote.updatedAt,0));}}
    catch(error){cloudState='error';cloudIssue=error.message;}
    if(!world)await installWorld(Core.createWorld(randomSeed()),{skipCurrent:true});
    switching=false;updateControls();
  }
  }
  showSaveStatus();render();
  if(storageIssue)notice('Постоянное хранилище недоступно: '+storageIssue+' Миры остаются в памяти; используйте облако или экспорт.');
  setInterval(()=>{if(running&&!busy&&!switching&&!document.hidden&&!$('#dialog').open)void step(speed,autoPause);},450);
  setInterval(()=>{if(world&&!document.hidden&&!localConflict)void syncCurrent(false);},18000);
  if(currentRecord&&Storage.isCloudDirty(currentRecord))scheduleSync();
}
boot().catch(error=>{switching=false;setRunning(false);notice('Не удалось открыть обсерваторию: '+error.message);updateControls();});


