'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)], h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=new Intl.NumberFormat('ru-RU'), short=new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}), fmt=n=>nf.format(Math.round(n));
const typeNames={origin:'Начало истории',climate:'Природа',economy:'Хозяйство',science:'Знания',politics:'Политика',migration:'Миграции',conflict:'Конфликт',space:'Космос'};
let world,store,revision=0,view='planet',layer='nature',selectedPlanet='p2',selectedSociety=null,snapshotIndex=null,busy=false,running=false,speed=1,autoPause=true,worker=null,workerReady=false,pending=new Map(),serial=0,noticeTimer,sound=true,audio=null,filterType='all',filterQuery='';
let switching=false,localConflict=false,localUnsaved=false,saveTail=Promise.resolve(),cloudSync,cloudTask=null,cloudTimer=null,cloudState='unknown',cloudIssue='',currentRecord=null,cloudCursor=null;
const cloudClient=Cloud.createCloudClient({timeoutMs:6000}),cloudRows=new Map();
function pref(key,value){try{if(value!==undefined)localStorage.setItem(key,value);return localStorage.getItem(key);}catch{return null;}}
function sameWorld(a,b){return JSON.stringify(a)===JSON.stringify(b);}
const renderer=new Renderer($('#space-canvas'),id=>{selectedPlanet=id;view='planet';render();});
function notice(text,conflict=false){clearTimeout(noticeTimer);$('#notice-text').textContent=text;$('#notice').hidden=false;$('#fork').hidden=!conflict;if(!conflict)noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},12000);}
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
    if(world?.id===snapshot.id){revision=record.revision;currentRecord=record;localUnsaved=!sameWorld(snapshot,world);pref('microgalaxy_local_candidate_last',snapshot.id);showSaveStatus();}
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
function render(){if(!world)return;const w=displayed(),p=currentPlanet(w);$('#world-title').textContent='Система '+w.name+' / '+w.seed;$('#year').textContent='Год '+String(w.year).padStart(5,'0');$('#event-count').textContent=w.events.length;$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$$('[data-layer]').forEach(b=>b.classList.toggle('active',b.dataset.layer===layer));$('#bodies').innerHTML=`<div class="side-title">Звёздная система <span>${w.planets.length}</span></div><button class="body-item" data-star="1"><span class="orb star"></span><span><span class="body-name">${h(w.name.split(' · ')[0])}</span><span class="body-sub">${w.star.mass.toFixed(2)} M☉ · ${(w.star.temperature/1000).toFixed(1)} тыс. K</span></span></button>`+w.planets.map((p,i)=>`<button class="body-item ${p.id===selectedPlanet?'selected':''}" data-planet="${h(p.id)}"><span class="orb" style="background:${p.home?'#588a9b':p.kind==='gas'?'#b7916a':p.kind==='ice'?'#a4c0c9':'#927c69'}"></span><span><span class="body-name">${h(p.name)}</span><span class="body-sub">${p.a.toFixed(2)} а. е.${p.home?' · Биосфера':''}</span></span></button>`).join('');
  const visual=['planet','system'].includes(view);$('#visual').hidden=!visual;$('#page-content').hidden=visual;$('#scene-title').textContent=view==='system'?w.name:p.name;$('#scene-kind').textContent=view==='system'?'Одна система · автономная история':p.home?'Обитаемый мир':p.kind==='gas'?'Газовый гигант':p.kind==='ice'?'Ледяной мир':'Каменистая планета';$('#scene-caption').textContent=view==='system'?`${w.planets.length} планет · ${w.colonies.length} поселений · ${w.missions.filter(m=>m.status==='transit').length} миссий в пути`:`${p.radius.toFixed(2)} R⊕ · ${p.a.toFixed(2)} а. е. · ${p.moons} спутн.`;$('.layers').hidden=view==='system';$('#scene-note').hidden=view==='system';if(visual)renderer.update(w,view,p,layer);else renderPage(w);
  renderInspector(w,p);$('#recent').innerHTML=w.events.slice(-2).reverse().map(e=>`<button class="event-mini" data-event="${h(e.id)}"><span class="ev-meta">Год ${e.year}<span>${h(typeNames[e.type]??e.type)}</span></span><b>${h(e.title)}</b><p>${h(e.detail)}</p></button>`).join('');$('#history-slider').max=world.snapshots.length;$('#history-slider').value=snapshotIndex===null?world.snapshots.length:snapshotIndex;$('#history-label').textContent=snapshotIndex===null?'Текущее состояние':'Срез: год '+w.year;$('#history-label').classList.toggle('archive-flag',snapshotIndex!==null);$('#live').disabled=snapshotIndex===null;setRunning(running);updateControls();}
function renderInspector(w,p){const s=w.societies.find(s=>s.id===selectedSociety);if(s&&['societies','chronicle'].includes(view)){$('#inspector').innerHTML=`<section class="inspect-section"><span class="eyebrow">Паспорт общества</span><h2>${h(s.name)}</h2><p>${h(s.government)} · ${h(Core.epoch(s))}</p></section><section class="inspect-section"><div class="stat-grid"><div><small>Население</small><strong>${short.format(s.population)}</strong></div><div><small>Устойчивость</small><strong>${Math.round(s.stability*100)}<i> %</i></strong></div><div><small>Продовольствие</small><strong>${(s.food/Math.max(1,s.population)).toFixed(1)}<i> года</i></strong></div><div><small>Минералы</small><strong>${short.format(s.minerals)}</strong></div></div></section><section class="inspect-section"><span class="eyebrow">Руководство</span><h2 style="font-size:20px">${h(s.leader.name)}</h2><p>${s.leader.age} лет · смена ${s.leader.index+1}</p><p>Языковая традиция: ${h(s.language)}. Это индекс родства, не сгенерированный язык.</p>${s.parentId?`<p>Предшественник: ${h(w.societies.find(t=>t.id===s.parentId)?.name??s.parentId)}</p>`:''}</section>`;return;}
  const population=p.home?Core.totalPopulation({...w,colonies:[],missions:[]}):w.colonies.filter(c=>c.planet===p.id).reduce((n,c)=>n+c.population,0),temp=p.temperature+(p.home?w.climate.warming:0);const mean=w.societies.reduce((n,s)=>n+s.tech[1],0)/w.societies.length;
  $('#inspector').innerHTML=`<section class="inspect-section"><span class="eyebrow">Паспорт планеты</span><h2>${h(p.name)}</h2><p>${p.home?'Биосфера и самостоятельные общества':'Наблюдаемый объект системы'}</p>${snapshotIndex!==null?'<p class="archive-flag">Сохранённый исторический срез. Расчёт остановлен.</p>':''}</section><section class="inspect-section"><div class="stat-grid"><div><small>Население</small><strong>${short.format(population)}</strong></div><div><small>Температура</small><strong>${temp.toFixed(1)}<i> °C</i></strong></div><div><small>Орбитальный период</small><strong>${p.period.toFixed(1)}<i> г.</i></strong></div><div><small>Поселения вне дома</small><strong>${w.colonies.length}</strong></div></div></section><section class="inspect-section"><span class="eyebrow">Технологическое развитие</span><p>${h(Core.epoch(w.societies[0]))}</p><div class="progress"><span style="width:${Core.clamp(mean/4,0,1)*100}%"></span></div><small style="color:var(--muted);font-size:10px">Ранние общества → первые колонии</small></section><section class="inspect-section"><span class="eyebrow">Общества · ${w.societies.length}</span>${w.societies.map(s=>`<button class="soc-small" data-society="${h(s.id)}"><span><i class="dot" style="background:${s.color}"></i>${h(s.name)}</span><small>${short.format(s.population)} →</small></button>`).join('')}</section>`;
}
function renderPage(w){const node=$('#page-content');if(view==='societies'){node.innerHTML=`<h1>Общества</h1><div class="subtitle">История государств, институтов и их преемников. Нажмите на карточку для подробностей.</div><div class="soc-grid">${w.societies.map(s=>`<button class="soc-card" data-society="${h(s.id)}" style="border-top:2px solid ${s.color}"><h2>${h(s.name)}</h2><div class="soc-meta">${h(s.government)} · ${h(Core.epoch(s))}</div><div class="number">${fmt(s.population)}</div><div class="soc-meta">жителей · пища на ${(s.food/Math.max(1,s.population)).toFixed(1)} года</div><div class="mini-bars">${s.tech.map((v,i)=>`<div><label>${h(Core.TECH_NAMES[i])}<span>${v.toFixed(2)}</span></label><div class="progress"><span style="width:${v/6*100}%"></span></div></div>`).join('')}</div></button>`).join('')}</div><h2 style="font-size:19px;font-weight:400;margin-top:30px">Внеземные поселения</h2>${w.colonies.length?`<div class="soc-grid">${w.colonies.map(c=>`<div class="soc-card"><h2>${h(c.name)}</h2><div class="soc-meta">${h(w.planets.find(p=>p.id===c.planet).name)} · основано в ${c.founded}</div><div class="number">${fmt(c.population)}</div><div class="soc-meta">${c.independent?'Самостоятельное поселение':'Связано с '+h(w.societies.find(s=>s.id===c.parent).name)} · автономия ${Math.round(c.autonomy*100)}%</div></div>`).join('')}</div>`:'<p class="empty">Пока нет. Обществам нужны технологии, материалы и разведка планеты.</p>'}`;}
  else if(view==='chronicle'){node.innerHTML=`<h1>Хроника</h1><div class="subtitle">События рассчитаны моделью. Причины сохранены на момент события и не дописываются задним числом.</div><div class="chronicle-tools"><input type="search" id="event-search" placeholder="Найти в истории" value="${h(filterQuery)}" aria-label="Поиск событий"><select id="event-type" aria-label="Тип события"><option value="all">Все события</option>${Object.entries(typeNames).map(([k,v])=>`<option value="${k}" ${filterType===k?'selected':''}>${v}</option>`).join('')}</select></div><div id="event-list"></div>`;renderEvents(w);}
  else if(view==='analysis'){const histories=w.history.length?w.history:[Core.summary(w)],s=Core.summary(w);node.innerHTML=`<h1>Состояние системы</h1><div class="subtitle">Показатели модели, а не научный прогноз. Исторические метрики записываются каждые 10 лет.</div><div class="stat-grid"><div><small>Жителей во всей системе</small><strong>${fmt(s.population)}</strong></div><div><small>Изменение температуры</small><strong>+${s.warming.toFixed(2)} °C</strong></div><div><small>Действующие конфликты</small><strong>${s.wars}</strong></div><div><small>Средний уровень исследований</small><strong>${s.knowledge.toFixed(2)}</strong></div></div>${chart(histories,'population','Население системы')}${chart(histories,'warming','Потепление, °C')}<div class="chart-block"><h2>Покрытие архива</h2><p class="subtitle">Сохранена начальная точка и последние 63 среза с шагом 25 лет. Просмотр доступен только для этих срезов. Все события остаются в хронике до лимита 16 000 записей; скрытого удаления событий нет.</p></div>`;}
}
function chart(rows,key,title){const vals=rows.map(r=>r[key]),max=Math.max(...vals,1),min=Math.min(...vals,0),points=rows.map((r,i)=>`${12+i/Math.max(1,rows.length-1)*576},${148-(r[key]-min)/(max-min)*126}`).join(' ');return `<section class="chart-block"><h2>${h(title)}</h2><svg viewBox="0 0 600 165" role="img" aria-label="${h(title)} по годам"><path d="M12 22H588 M12 85H588 M12 148H588" fill="none" stroke="#36423d" stroke-width=".7"/><polyline points="${points}" fill="none" stroke="#c9d5a6" stroke-width="2.5"/></svg><div class="chart-caption"><span>Год ${rows[0].year}</span><span>Макс. ${nf.format(Number(max.toFixed(2)))}</span><span>Год ${rows.at(-1).year}</span></div></section>`;}
function renderEvents(w=displayed()){const q=filterQuery.toLowerCase(),events=w.events.filter(e=>(filterType==='all'||e.type===filterType)&&(`${e.title} ${e.detail}`).toLowerCase().includes(q)).slice(-160).reverse();$('#event-list').innerHTML=events.map(e=>`<button class="event-row" data-event="${h(e.id)}"><span class="event-year">${e.year}</span><span><b>${h(e.title)}</b>${e.important?'<span class="pill">важное</span>':''}<p>${h(e.detail)}</p></span></button>`).join('')||'<p class="empty">Событий по этому запросу нет.</p>';}
function modal(title,html){setRunning(false);$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function showEvent(id){const e=displayed().events.find(e=>e.id===id);if(!e)return;modal(e.title,`<span class="eyebrow">Год ${e.year} · ${h(typeNames[e.type]??e.type)}</span><p>${h(e.detail)}</p><div class="event-causes"><span class="eyebrow">Условия в момент события</span>${e.causes.map(c=>`<div class="metric-row"><span>${h(c.label)}</span><b>${h(c.value)}</b></div>`).join('')}</div><p class="form-hint">Эта запись создана программной моделью. Генеративный ИИ не используется.</p>${e.entityId?`<button class="primary" data-jump-society="${h(e.entityId)}">Открыть общество</button>`:''}`);}
function showSociety(id){selectedSociety=id;view='societies';render();const w=displayed(),s=w.societies.find(s=>s.id===id);if(!s)return;modal(s.name,`<p>${h(s.government)} · ${h(Core.epoch(s))}</p><div class="metric-row"><span>Население</span><b>${fmt(s.population)}</b></div><div class="metric-row"><span>Руководитель</span><b>${h(s.leader.name)}, ${s.leader.age}</b></div><div class="metric-row"><span>Устойчивость</span><b>${Math.round(s.stability*100)}%</b></div><div class="metric-row"><span>Пища на складе</span><b>${(s.food/Math.max(1,s.population)).toFixed(2)} годовых потребностей</b></div><div class="metric-row"><span>Регионы</span><b>${w.regions.filter(r=>r.owner===s.id).length}</b></div>${s.parentId?`<p>Предшественник: ${h(w.societies.find(t=>t.id===s.parentId)?.name??s.parentId)}</p>`:''}<p class="form-hint">${h(s.language)} — название языковой традиции. Детальная грамматика и индивидуальные жители в этой версии не моделируются.</p>`);}
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
  localConflict=false;localUnsaved=false;snapshotIndex=null;selectedSociety=null;selectedPlanet=world.planets.find(p=>p.home).id;view='planet';renderer.cacheKey='';
  $('#dialog').close();$('#notice').hidden=true;pref('microgalaxy_local_candidate_last',world.id);showSaveStatus();render();setRunning(false);
}
async function transition(action){
  if(busy||switching)throw new Error('Дождитесь завершения текущего шага.');
  switching=true;setRunning(false);updateControls();
  const oldId=world?.id, wasDirty=localUnsaved, conflicted=localConflict, oldTail=saveTail;
  try{const result=await action();if(oldId&&oldId!==world?.id&&!conflicted&&store?.releaseWorld&&(!wasDirty||saveTail!==oldTail)){try{await saveTail;const sync=cloudTask?await cloudTask:true;const metadata=await store.getMetadata(oldId);const cloudClean=!!metadata?.cloud?.revision&&metadata.cloud.syncedRevision===metadata.revision&&!Storage.isCloudDirty(metadata);await store.releaseWorld(oldId);if(sync!==false&&cloudClean&&!cloudTask)try{await RetentionClient.releaseCloudWorld("v03",oldId);}catch{}}catch{/* Uncertain final save keeps the old world protected. */}}return result;}finally{switching=false;updateControls();}
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
  let html='<p class="form-hint">Миры модели 0.3. '+(store.persistent?'Локальная запись работает на этом устройстве.':'Постоянное хранилище недоступно: используйте облако и экспорт.')+' '+(cloudState==='error'?'Облако сейчас недоступно; показаны имеющиеся копии.':'Облачные копии доступны после входа с других устройств.')+'</p><p><a class="text-link" href="/classic" data-classic-link>Открыть миры прежней модели 0.1–0.2</a></p>';
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
function about(){modal('MICROGALAXY · 0.3','<p>Личная обсерватория одной звёздной системы. Самостоятельная история обществ, региональной среды, миграций, конфликтов и космических миссий. Вы — наблюдатель; управлять обществами нельзя.</p><p>Новые системы рассчитываются моделью 0.3. Старые миры 0.1–0.2 продолжаются по прежним правилам в <a class="text-link" href="/classic" data-classic-link>режиме совместимости</a> — без изменения исходных сохранений.</p><p>Миры сохраняются на устройстве и в личном облачном архиве, когда он доступен. Статус наверху показывает фактический результат; «Сохранить» проверяет синхронизацию. Для резервной копии используйте экспорт.</p><p>Генеративного ИИ и телеметрии нет. Глобус и орбиты рисуются программно; расчётный горизонт — 10 000 лет. Единицы производства и исследовательские уровни игровые: это не научный прогноз.</p><p class="form-hint">Экспорт кандидата 0.3 совместим с этой моделью. Файлы прежней модели импортируются в режиме 0.2; автоматического пересчёта старой истории нет.</p>');}
function updateSound(){ $('#sound').textContent='Звук: '+(sound?'вкл.':'выкл.');$('#sound').setAttribute('aria-label',sound?'Выключить звук':'Включить звук');}
async function exportCurrent(){
  const text=await Storage.encodeSave(world),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download='microgalaxy-'+world.year+'-'+world.seed.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',async e=>{
  const classic=e.target.closest('[data-classic-link],[data-current-link]');
  if(classic){e.preventDefault();try{await transition(async()=>{if(world)await persist();window.location.assign(classic.hasAttribute('data-current-link')?'/?archive=1':'/classic');});}catch(error){notice(error.message,error.name==='ConflictError');}return;}
  const b=e.target.closest('button');if(!b||b.disabled||switching)return;
  if(sound&&!audio&&b.id!=='sound')playTone();
  try{
    if(b.dataset.view){view=b.dataset.view;render();}
    else if(b.dataset.planet){selectedPlanet=b.dataset.planet;view='planet';render();}
    else if(b.dataset.star){view='system';render();}
    else if(b.dataset.layer){layer=b.dataset.layer;render();}
    else if(b.dataset.speed){speed=Number(b.dataset.speed);$$('[data-speed]').forEach(x=>x.classList.toggle('active',x===b));}
    else if(b.dataset.event){showEvent(b.dataset.event);}
    else if(b.dataset.society){showSociety(b.dataset.society);}
    else if(b.dataset.jumpSociety){showSociety(b.dataset.jumpSociety);}
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
      case 'more-worlds':await worldDialog(true);break;
      case 'sync-world':await syncCurrent(true);break;
      case 'reset-camera':renderer.reset();break;
      case 'live':snapshotIndex=null;render();break;
      case 'about':about();break;
      case 'sound':sound=!sound;pref('microgalaxy:v03:sound',sound?'on':'off');updateSound();if(sound)playTone();break;
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
document.addEventListener('input',e=>{if(e.target.id==='event-search'){filterQuery=e.target.value;renderEvents();}});
document.addEventListener('change',e=>{if(e.target.id==='event-type'){filterType=e.target.value;renderEvents();}});
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
  switching=true;updateControls();sound=(pref('microgalaxy:v03:sound')??pref('microgalaxy:sound'))!=='off';updateSound();initWorker();
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
  try{const last=pref('microgalaxy_local_candidate_last'),locals=await store.list(),id=locals.find(r=>r.id===last)?.id??locals[0]?.id;if(id)initial=await store.get(id);}catch(error){notice('Не удалось прочитать локальный мир: '+error.message);}
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

