/* Read-only observer state. It is deliberately separate from a saved world. */
const Observation = (()=>{
 let watched=null, worldId=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function sync(w){if(worldId!==w?.id){worldId=w?.id??null;watched=null;}}
 function setWatch(w,type,id){sync(w);const list=type==='region'?w.regions:type==='society'?w.societies:[];if(!list.some(x=>x.id===id))return false;watched={type,id};return true;}
 function getWatch(){return watched?{...watched}:null;}
 function matches(event){if(!watched||!event?.important)return false;if(watched.type==='region')return (event.regionIds??[]).includes(watched.id)||event.movement?.from===watched.id||event.movement?.to===watched.id;return event.entityId===watched.id||(event.entityIds??[]).includes(watched.id);}
 function closestIndex(w,year){let found=-1;for(let i=0;i<w.snapshots.length;i++){if(w.snapshots[i].year>year)break;found=i;}return found;}
 function recent(w,limit=3){let out=[];for(let page=Core.eventPageCount(w)-1;page>=0&&out.length<limit;page--){for(const e of Core.eventPage(w,page,{throughYear:w.year}).slice().reverse())if(matches(e)){out.push(e);if(out.length===limit)break;}}return out;}
 function regionName(r){return r.settlement?.name??r.name??r.id;}
 function scheme(r){return '<div class="observation-scheme" role="img" aria-label="Условная схема центра региона: положение улиц и зданий не хранится моделью"><svg viewBox="0 0 240 98" aria-hidden="true"><path d="M0 67 Q72 48 121 57 T240 39" fill="none" stroke="#8cc9c3" stroke-width="3" stroke-dasharray="6 5"/><circle cx="120" cy="55" r="16" fill="#a3d4cb"/><circle cx="120" cy="55" r="6" fill="#17383c"/><path d="M56 74 L78 58 M167 44 L193 35" stroke="#b6c5aa" stroke-width="2"/></svg><span>'+esc(regionName(r))+' · '+esc(r.id)+'</span></div><p class="obs-note">Условный центр региона. Улицы, здания и их расположение модель не хранит; схема не изображает реальный план города.</p>';}
 function render(w,live){const el=document.getElementById('observation-panel');if(!el||!w||!live)return;sync(live);
 const regopts=w.regions.map(r=>'<option value="'+esc(r.id)+'">'+esc(regionName(r))+' · '+esc(r.id)+'</option>').join('');
 const socopts=w.societies.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' · '+esc(s.id)+'</option>').join('');
 const obj=watched&&(watched.type==='region'?w.regions.find(r=>r.id===watched.id):w.societies.find(s=>s.id===watched.id));
 const ev=recent(w),current=watched?(obj?(watched.type==='region'?'Регион '+regionName(obj):'Общество '+obj.name):'Объект отсутствует в этом срезе'):'Ничего не выбрано';
 const years=live.snapshots.map((s,i)=>'<option value="'+i+'"'+(s.year===w.year?' selected':'')+'>Срез · '+s.year+'</option>').join('')+'<option value="live"'+(w.year===live.year?' selected':'')+'>Настоящее · '+live.year+'</option>';
 el.innerHTML='<p class="obs-kicker">Текущий объект</p><strong>'+esc(current)+'</strong><div class="obs-selects"><label>Регион<select id="obs-region"><option value="">Выберите регион</option>'+regopts+'</select></label><button type="button" data-obs="watch-region">Следить</button><label>Общество<select id="obs-society"><option value="">Выберите общество</option>'+socopts+'</select></label><button type="button" data-obs="watch-society">Следить</button></div><div class="obs-time"><label>Доступные годы<select id="obs-snapshot">'+years+'</select></label><button type="button" data-obs="previous">Предыдущий срез</button><button type="button" data-obs="live">К настоящему</button></div><p class="obs-note">Архив содержит отдельные срезы, не каждый год. Выбор среза не продвигает время.</p>'+(obj&&watched.type==='region'?scheme(obj):'')+'<p class="obs-kicker">Записи объекта до '+w.year+' года</p>'+(watched?(ev.length?'<ul class="obs-events">'+ev.map(e=>'<li><button type="button" data-obs-event="'+esc(e.id)+'">'+esc(e.year)+' · '+esc(e.title)+'</button></li>').join('')+'</ul>':'<p class="obs-note">Подходящих важных записей с явной привязкой пока нет.</p>'):'<p class="obs-note">Выберите регион или общество.</p>')+'<button type="button" data-obs="search"'+(!watched||w.year!==live.year?' disabled':'')+'>До важного события объекта</button><p class="obs-note">Поиск учитывает только явно указанных участников и регионы события.</p><button type="button" data-obs="demo">Пример «АРХИВ-09»</button>';
 if(typeof ObservationJournal!=='undefined')el.insertAdjacentHTML('beforeend','<div class="obs-time"><button type="button" data-obs="journal-export">Скачать журнал наблюдения</button><label>Открыть журнал<input id="observation-journal-file" type="file" accept="application/json,.json"></label></div><p class="obs-note">Журнал хранит выбор объекта и записи выбранной партии. Для переноса откройте соответствующий файл мира и импортируйте журнал того же года.</p>');
 if(watched){const select=el.querySelector(watched.type==='region'?'#obs-region':'#obs-society');if(select)select.value=watched.id;}
 }
 function restore(w,state){sync(w);watched=null;if(state)setWatch(w,state.type,state.id);}
 return {sync,setWatch,getWatch,matches,closestIndex,render,restore};
})();
function observationRender(shown,live){Observation.render(shown,live);}
function observationMatches(event){return Observation.matches(event);}
function observationWatch(){return Observation.getWatch();}
function observationChange(target){if(target.id!=='obs-snapshot'||!world)return false;setRunning(false);snapshotIndex=target.value==='live'?null:Number(target.value);resetEconomyPages();render();return true;}
async function observationClick(button){
 if(!button)return false;
 if(button.dataset.obsEvent){const id=button.dataset.obsEvent;showEvent(id);return true;}
 const action=button.dataset.obs;if(!action)return false;
 if(action==='watch-region'||action==='watch-society'){const type=action==='watch-region'?'region':'society',select=document.getElementById(type==='region'?'obs-region':'obs-society');if(!select.value){notice('Сначала выберите '+(type==='region'?'регион.':'общество.'));return true;}Observation.setWatch(world,type,select.value);setRunning(false);render();if(typeof observationChanged==='function')await observationChanged();return true;}
 if(action==='journal-export'){await exportObservations();return true;}
 if(action==='live'){setRunning(false);snapshotIndex=null;resetEconomyPages();render();return true;}
 if(action==='previous'){setRunning(false);const idx=Observation.closestIndex(world,displayed().year-1);if(idx<0){notice('Более раннего сохранённого среза нет.');return true;}snapshotIndex=idx;resetEconomyPages();render();return true;}
 if(action==='search'){setRunning(false);await observationSearch();return true;}
 if(action==='demo'){
   setRunning(false);modal('Пример «АРХИВ-09»','<p class="loading">Рассчитываем отдельный пример…</p>',true);await yieldFrame();
   try{const engine=typeof LegacyCore!=='undefined'?LegacyCore:Core;const demo=engine.advance(engine.createWorld('АРХИВ-09',{era:'agriculture'}),78).world;const region=demo.regions.find(r=>r.settlement.name==='Дорон');const records=region?engine.allEvents(demo).filter(e=>(e.regionIds??[]).includes(region.id)):[];
   const html='<p>Отдельный расчёт в памяти · модель 0.8 · ранняя эпоха · год 78. Ваш текущий мир не меняется и не заменяется.</p>'+(region?'<p>Дорон · регион '+h(region.id)+' · планета '+h(demo.planets.find(p=>p.home).name)+'</p><ol>'+records.map(e=>'<li><b>Год '+e.year+' · '+h(e.title)+'</b><p>'+h(e.detail)+'</p></li>').join('')+'</ol>':'<p>В этом расчёте Дорон не найден.</p>')+'<p class="form-hint">Занятие военными и передача по соглашению — разные записи модели. Пример не является сохранением вашего мира.</p>';modal('Пример «АРХИВ-09»',html,true);
   }catch(e){modal('Пример «АРХИВ-09»','<p>Не удалось рассчитать пример: '+h(e.message)+'</p>',true);}return true;
 }
 return false;
}
