/* Read-only v1 field observer. All visualisations are explicitly schematic. */
const EditionUI=(()=>{
 let tab='place',site='',colony='',trace='',theory='',check='',compare='',worldId=null,cityDetail='housing',skySociety='';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=n=>Number.isFinite(n)?new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n):'нет данных';
 const loc=(w,id)=>{const r=w.regions.find(x=>x.id===id);return r?(r.settlement?.name??r.name??id)+' · '+id:id??'неизвестно';};
 const soc=(w,id)=>w.societies.find(x=>x.id===id)?.name??id??'неизвестно';
 const body=(w,id)=>w.planets.find(x=>x.id===id)?.name??id??'неизвестно';
 const panel=(title,html)=>'<section class="edition-card"><h3>'+esc(title)+'</h3>'+html+'</section>';
 function summary(w){try{return LivingWorld.summary(w,w.year);}catch{return {available:false,exact:false,basin:null,facts:[],traces:[],memories:[]};}}
 function sync(w){if(worldId!==w.id){worldId=w.id;site='';colony='';trace='';theory='';check='';compare='';skySociety='';}if(!w.regions.some(x=>x.id===site))site=w.regions[0]?.id??'';if(!w.colonies.some(x=>x.id===colony))colony=w.colonies[0]?.id??'';if(!w.societies.some(x=>x.id===skySociety))skySociety=w.societies[0]?.id??'';}
 const options=(items,current,label)=>items.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===current?' selected':'')+'>'+esc(label(x))+'</option>').join('');
 function svgPlace(w,r,basin,earlier=null,years=null){
  const map=LivingWorld.placeMap(w,r.id,basin,earlier);
  if(!map)return '';
  const points=new Map(map.points.map(p=>[p.id,p]));
  const line=(path,attrs)=>{
   if(!path)return '';
   const a=points.get(path.from),b=points.get(path.to);if(!a||!b)return '';
   return '<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" '+attrs+'/>';
  };
  let shapes=map.routes.map(e=>line(e,'stroke="'+(e.blocked?'#d39376':'#70858c')+'" stroke-width="2" stroke-dasharray="3 5"')).join('');
  if(map.current)shapes+=line(map.current,'data-channel="current" stroke="#62b7b5" stroke-width="'+map.current.width+'" stroke-linecap="round"');
  if(map.previous)shapes+=line(map.previous,'data-channel="previous" stroke="#efc986" stroke-width="'+Math.max(2,map.previous.width/3)+'" stroke-dasharray="6 5"');
  shapes+=map.points.map(p=>{
   const i=map.points.indexOf(p)+1;
   return '<g><title>'+esc(loc(w,p.id))+'</title><circle cx="'+p.x+'" cy="'+p.y+'" r="'+(p.id===r.id?8:5)+'" fill="'+(p.id===r.id?'#eff8ef':'#9fc6c2')+'" stroke="#14292e" stroke-width="2"/><text x="'+(p.x+10)+'" y="'+(p.y-9)+'" fill="#e6ece8" font-size="13">'+i+'</text></g>';
  }).join('');
  const caption=map.previous?'Год '+years[0]+' — золотой пунктир. Год '+years[1]+' — бирюзовая полоса. Это условные направления водотока между центрами регионов.':map.current?'Бирюзовая полоса — условное направление водотока между центрами регионов.':'Пунктир соединяет соседние регионы.';
  const labels=map.points.map((p,i)=>(i+1)+'. '+esc(loc(w,p.id))).join(' · ');
  return '<figure class="edition-scene" style="margin:0"><svg viewBox="0 0 560 175" role="img" aria-label="Условная схема связей регионов"><title>'+esc(caption)+'</title>'+shapes+'</svg><figcaption>'+esc(caption)+' '+labels+'</figcaption></figure><p class="edition-note">Основание схемы: координаты центров, состояние бассейна и направление стока, не расположение улиц. Линии соединяют центры, а их толщина условно обозначает относительный расход. Это не контуры берегов и не измеренная ширина русла; история границ воды в модели не хранится.</p>';
 }
 function place(w,live){const data=summary(w),r=w.regions.find(x=>x.id===site);if(!r)return panel('Место','<p>В этом состоянии регионов нет.</p>');const b=data.basin,p=b?.upper===r.id?b.project:null;
 let out='<label>Выбрать регион<select data-edition-change="site">'+options(w.regions,site,x=>loc(w,x.id))+'</select></label>'+svgPlace(w,r,b);
 out+=panel('Центр и среда','<p><b>'+esc(r.settlement?.name??r.id)+'</b> · '+esc(r.settlement?.kind??'тип неизвестен')+' · '+esc(r.settlement?.specialization??'специализация неизвестна')+'</p><p>Население всего региона: '+num(r.population)+' · вода: '+num(r.water)+' · биом: '+esc(r.biome)+'</p><p>Владелец: '+esc(soc(w,r.owner))+'</p>');
 const measurements=(w.history??[]).filter(x=>x.year<=w.year).slice(-6);
 out+=panel('Климат планеты','<p>Выбранный срез · год '+w.year+': потепление '+num(w.climate?.warming)+' · загрязнение '+num(w.climate?.pollution)+'. Это общепланетные относительные показатели.</p>'+(measurements.length?'<ul class="edition-list">'+measurements.map(x=>'<li>Год '+x.year+' · потепление '+num(x.warming)+' · загрязнение '+(Number.isFinite(x.pollution)?num(x.pollution):'не записано')+'</li>').join('')+'</ul>':'<p>Исторических измерений в этом срезе нет.</p>')+'<p class="edition-note">Значения взяты из выбранного среза и сохранённого ряда; отсутствующее измерение не подменяется текущим.</p>');
 const eco=b?.ecology?.[r.id],hydro=b&&[b.upper,b.lower,b.alternate].includes(r.id)?LivingWorld.waterProfile(w,b):null;
 const crop=Number.isFinite(r.economy?.harvest)?num(r.economy.harvest):'первого годового измерения ещё нет';
 out+=panel('Урожай и растительность','<p>Год '+w.year+' · урожай региона: '+crop+' · запас пищи: '+num(r.economy?.stock.food)+'.</p><p>Растительный покров: '+num(r.biomass)+(eco?' · маловодье подряд: '+eco.dryYears+' г. · изменение покрова от условий бассейна: '+num(eco.vegetationChange*100)+' процентного пункта.':'.')+'</p>');
 if(hydro)out+=panel('Уровень воды','<p>Уровень в низовье: '+num(hydro.stage)+' · отметка переправы: '+num(hydro.sill)+' · глубина старого русла: '+num(hydro.depth)+'. Относительные единицы высоты.</p>');
 if(!data.available)out+=panel('История места','<p>В этой модели нет архива местной истории.</p>');
 else if(!data.exact)out+=panel('История места','<p>Для этого года нет полного сохранённого среза местности. Записи с датами доступны отдельно.</p>');
 else if(!b)out+=panel('Речная система','<p>Подходящий речной бассейн в этом мире не найден.</p>');
 else if(![b.upper,b.lower,b.alternate].includes(r.id))out+=panel('Речная система','<p>Выбранный регион не относится к учтённому бассейну. <button data-edition="basin">Открыть верховье</button></p>');
 else {const edge=w.geography.edges.find(x=>x.id===b.edge);out+=panel('Русло и путь','<p>Верховье: '+esc(loc(w,b.upper))+' → низовье: '+esc(loc(w,b.lower))+'.</p><p>Расход модели: '+num(b.flow)+' · наносы: '+num(b.silt)+' · русло '+(b.diverted?'изменилось':'сохраняет направление')+'.</p><p>Связь '+esc(edge?.id??b.edge)+': '+(b.blockedEdge?'непроходима':'проходима')+'. Это относительные показатели модели.</p>');
 if(p){const pct=Math.min(100,Math.round(100*p.labor/p.required));out+=panel('Стройка','<p><b>'+esc(({building:'Строится',paused:'Работы приостановлены',completed:'Завершена',dismantled:'Разобрана'})[p.status]??p.status)+'</b> · '+pct+'% расчётного труда ('+num(p.labor)+' из '+num(p.required)+').</p><progress value="'+Math.min(p.labor,p.required)+'" max="'+p.required+'">'+pct+'%</progress><p>Начало: '+p.started+' · инициатор: '+esc(soc(w,p.founder))+' · владелец: '+esc(soc(w,p.owner))+'</p><p>Оплачено лет: '+p.yearsPaid+' · сырьё '+num(p.spent.raw)+' · оборудование '+num(p.spent.equipment)+' · пища '+num(p.spent.food)+'.</p>');}
 else out+=panel('Стройка','<p>'+(b.upper===r.id?'Строительство в выбранном году не начато.':'Сооружение относится к верховью; выберите его, чтобы увидеть стадию.')+'</p>');}
 if(w.modelVersion==='1.0.1'&&p)out+='<button type="button" data-edition="tab" data-id="evidence">Открыть разрез и выбрать улики</button>';
 out+=comparison(w,live,data);return out;
 }
 function comparison(w,live,current){const snapshots=(live.snapshots??[]).filter(s=>s.year<w.year&&s.observatory?.living);if(!snapshots.length)return panel('До и после','<p>Более раннего полного среза местной истории пока нет.</p>');let snap=snapshots.find(s=>String(s.year)===compare)??snapshots.at(-1);compare=String(snap.year);let prev;try{prev=LivingWorld.summary(live,snap.year);}catch{prev=null;}const before=prev?.exact?prev.basin:null,after=current.exact?current.basin:null;
 const state=x=>x?('расход '+num(x.flow)+' · наносы '+num(x.silt)+' · '+(x.diverted?'новое русло':'прежнее русло')):'нет данных';
 const overlay=before&&after?svgPlace(w,w.regions.find(r=>r.id===after.upper),after,before,[snap.year,w.year]):'';
 return panel('До и после','<label>Ранний сохранённый срез<select data-edition-change="compare">'+snapshots.map(s=>'<option value="'+s.year+'"'+(s.year===snap.year?' selected':'')+'>'+s.year+'</option>').join('')+'</select></label>'+overlay+'<div class="edition-compare"><p><b>Год '+snap.year+'</b><br>'+esc(state(before))+'</p><p><b>Год '+w.year+'</b><br>'+esc(state(after))+'</p></div><p class="edition-note">Сравниваются именно сохранённые срезы. Промежуточное состояние не восстанавливается.</p>');}
 const purposeName=id=>({irrigation:'Снабжение хозяйств водой',passage:'Сохранение переправы'})[id]??'Назначение неизвестно';
 let dossier=null;
 function investigation(w,data){
  const p=data.basin?.project,traces=data.traces.filter(t=>t.discovered!==null);
  if(!p&&!traces.length)return panel('Архив следов','<p>К '+w.year+' году стройка и обнаруженные следы в этом месте не записаны.</p>');
  const saved=dossier?.world===w.id&&dossier.year===w.year?dossier:null;
  const labels={founder:'Кто начал стройку?',payer:'Кто оплатил работы по реестру?',finisher:'Кто завершил сооружение?',purpose:'Для чего начинали работы?'};
  const subjects=Object.keys(labels).map(key=>{
   const choices=key==='purpose'?['irrigation','passage'].map(id=>({id,name:purposeName(id)})):w.societies;
   return '<label>'+labels[key]+'<select data-river-claim="'+key+'"><option value="">Пока неизвестно</option>'+options(choices,saved?.claim[key],s=>s.name)+'</select></label>';
  }).join('');
  const clues=traces.map((t,i)=>'<label><span><input type="checkbox" data-river-clue="'+esc(t.id)+'" '+(saved?.ids.includes(t.id)?'checked':'')+'/> '+(i+1)+'. '+esc(t.kind)+'</span> Год слоя '+t.formed+' · опознан в '+t.discovered+' · '+esc(loc(w,t.site))+'</label>').join('');
  const results=saved?.result.map(r=>'<li><b>'+esc(r.title)+'</b> · '+({confirmed:'подтверждено',contradicted:'противоречит свидетельству',unknown:'недостаточно данных'})[r.status]+(r.sources.length?'<br>'+r.sources.map(s=>esc(s.kind)+' · запись '+esc(s.record)+' за год '+s.year+' · '+esc(r.key==='purpose'?purposeName(s.value):soc(w,s.value))).join('<br>'):'')+'</li>').join('');
  const ratio=p?Math.min(1,p.labor/p.required):0;
  const supports=ratio&&p?.status!=='dismantled'?'<rect x="164" y="'+(94-ratio*40)+'" width="17" height="'+(24+ratio*40)+'" fill="#bfa781"/><rect x="237" y="'+(94-ratio*40)+'" width="17" height="'+(24+ratio*40)+'" fill="#bfa781"/>':'';
  const markers=traces.map((t,i)=>{const coords=({'кладка опоры':[171,106],'реестр поставок':[85,57],'пазы водосброса':[246,65],'старый берег':[311,89],'остатки причала':[288,77],'насыпь старой дороги':[282,95]})[t.kind]??[34,54];return '<g><circle cx="'+coords[0]+'" cy="'+coords[1]+'" r="9" fill="#f1ce8a"/><text x="'+coords[0]+'" y="'+(coords[1]+4)+'" text-anchor="middle" font-size="12" fill="#18262c">'+(i+1)+'</text></g>';}).join('');
  const section='<figure class="edition-scene"><svg viewBox="0 0 400 135" role="img" aria-label="Схематический разрез участка"><path d="M0 50L105 50L152 92L256 95L310 62L400 62V135H0Z" fill="#66594b"/><path d="M113 57L146 86L270 87L301 68L274 91L153 98Z" fill="#78b8ba"/>'+supports+(p?.completed!=null?'<path d="M164 53H254" stroke="#d2bb94" stroke-width="7"/>':'')+markers+'</svg><figcaption>Реконструкция участка · год '+w.year+'. Номера соответствуют найденным следам. Геометрия условная.</figcaption></figure>';
  const payments=p?.payments.map(a=>'<li>Год '+a.year+' · '+esc(soc(w,a.owner))+' · '+esc(purposeName(a.purpose))+' · труд '+num(a.crew)+', сырьё '+num(a.raw)+', оборудование '+num(a.equipment)+', пища '+num(a.food)+'</li>').join('');
  const decisions=p?.decisions.map(d=>'<li>Год '+d.year+' · '+esc(soc(w,d.owner))+' · '+esc(d.reason)+'</li>').join('');
  const removed=p?.dismantled?'<p>В '+p.dismantled.year+' году разобрали опоры. Местный склад получил сырьё: '+num(p.dismantled.raw)+'.</p>':'';
  const changes=data.facts.filter(f=>f.kind==='purpose').map(f=>'<li>Год '+f.year+' · '+esc(purposeName(f.previous))+' → '+esc(purposeName(f.purpose))+' · '+esc(f.reason)+'</li>').join('');
  return panel('Разрез и находки',section+removed+(clues||'<p>К этому году опознанных сохранившихся следов нет.</p>'))+
   (clues?panel('Моя версия',subjects+'<button type="button" data-edition="investigate">Проверить мою версию</button>'+(results?'<ul role="status">'+results+'</ul>':'')):'')+
   (payments?panel('Архив работ','<details><summary>Годы оплаты и решения</summary><ol>'+payments+'</ol><ul>'+decisions+changes+'</ul></details>'):'');
 }
 function readClaim(w,root){
  const claim=Object.fromEntries(Array.from(root.querySelectorAll('[data-river-claim]'),s=>[s.dataset.riverClaim,s.value]));
  const ids=Array.from(root.querySelectorAll('[data-river-clue]:checked'),c=>c.dataset.riverClue);
  examine(w,claim,ids);
 }
 function examine(w,claim,ids){dossier={world:w.id,year:w.year,claim,ids,result:LivingWorld.investigate(w,claim,ids)};}
 function evidence(w){const data=summary(w);if(w.modelVersion==='1.0.1')return investigation(w,data);if(!data.available)return panel('Архив следов','<p>Эта версия мира не хранит следы.</p>');const traces=data.traces.filter(t=>t.discovered!==null);let out=panel('Сохранившиеся и обнаруженные следы',traces.length?'<ul class="edition-list">'+traces.map(t=>'<li><button data-edition="trace" data-id="'+esc(t.id)+'">'+esc(t.kind)+' · '+esc(loc(w,t.site))+' · найден в '+t.discovered+'</button></li>').join('')+'</ul>':'<p>К выбранному году подтверждённых находок нет. Отсутствие находки не доказывает отсутствие прошлых событий.</p>');
 const t=traces.find(x=>x.id===trace);if(!t)return out;const source=data.facts.find(f=>f.id===t.source);
 const choices=[['foundation','Опора связана с началом стройки'],['completed','След связан с завершением стройки'],['diversion','След связан с изменением русла'],['closed','След связан с закрытием пути']];
 out+=panel('След '+t.id,'<p>'+esc(t.kind)+' · образован в '+t.formed+' · найден в '+t.discovered+'.</p><label>Моя версия<select data-edition-change="theory"><option value="">Выберите версию</option>'+choices.map(([v,l])=>'<option value="'+v+'"'+(theory===v?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select></label><button data-edition="check">Проверить мою версию</button>'+(check?'<p role="status">'+esc(check)+'</p>':'')+(source?'<p>Источник: '+esc(source.title)+' · год '+source.year+' · '+esc(source.id)+'. Проверка сопоставляет версию с записью источника; её отсутствие не доказывает другой исход.</p>':'<p>Запись источника в выбранном году недоступна.</p>'));return out;
 }
 function voices(w){
  const data=summary(w);
  if(!data.available)return panel('Голоса и источники','<p>Архив памяти этой модели недоступен.</p>');
  if(!data.exact)return panel('Голоса и источники','<p>Для этого года нет полного среза памяти.</p>');
  const mem=data.memories.filter(m=>m.site===site),names=(data.roadNames??[]).filter(n=>n.site===site);
  const rows=mem.map(m=>{
   const chain=(m.handovers??[]).map(([id,year,via],i)=>'<li>'+(i===1&&m.omitted?'Пропущено передач: '+m.omitted+'. ':'')+'Год '+year+' · '+esc(loc(w,id))+' · '+esc(via)+'</li>').join('');
   const eventBasis=m.basis?'<br>Местное свидетельство: '+esc(loc(w,m.basis.site))+' · запись '+esc(m.basis.record)+' за '+m.basis.year+' год'+(m.basis.value===null?'':m.basis.kind==='occupation'?' · потребность в восстановлении '+num(m.basis.value):' · сырьё '+num(m.basis.value)): '';
   return '<li><b>'+esc(m.opinion)+'</b> · '+num(m.carriers)+' носителей<br>Получено в '+m.received+' · '+esc(m.via)+(m.from?' из '+esc(loc(w,m.from)):'')+' · происхождение '+esc(loc(w,m.origin))+'<br>Источник: '+esc(m.title||m.fact)+(m.sourceYear!==null?' · год '+m.sourceYear:' · дата неизвестна')+(m.evidence?' · след '+esc(m.evidence.trace)+' найден в '+m.evidence.year:'')+eventBasis+(chain?'<details><summary>Путь свидетельства</summary><ol>'+chain+'</ol></details>':'')+'</li>';
  }).join('');
  const roads=names.map(n=>'<p><b>'+esc(n.name)+'</b> · закрепилось в '+n.year+' году. '+(n.origin?'Местные жители связывают его с переселением из '+esc(loc(w,n.origin))+'.':'У жителей сохранилось название. Свидетельство о происхождении утрачено.')+'</p>').join('');
  return '<label>Место<select data-edition-change="site">'+options(w.regions,site,x=>loc(w,x.id))+'</select></label>'+panel('Память сообщества',rows?'<ul class="edition-list">'+rows+'</ul>':'<p>На этом месте в выбранном срезе записанных свидетельств нет.</p>')+(roads?panel('Местное название',roads):'');
 }

 function city(w){
  const r=w.regions.find(x=>x.id===site);if(!r?.settlement)return panel('Поселение','<p>В этом срезе сведения о центре отсутствуют.</p>');
  const st=r.settlement,owner=w.societies.find(x=>x.id===r.owner),epoch=owner?Core.epoch(owner):'эпоха не записана',home=w.planets.find(x=>x.home),temperature=(home?.temperature??0)+(w.climate?.warming??0),infra=Math.max(0,Math.min(1,st.infrastructure??0));
  const biomeColors={forest:['#234b3e','#356b54'],grassland:['#485d3e','#6b8059'],drylands:['#766345','#aa905e'],highlands:['#4c5850','#808778'],tundra:['#667970','#abb8ab']},palette=biomeColors[r.biome]??biomeColors.grassland;
  const biomeLabel={forest:'лес',grassland:'степь',drylands:'засушливые земли',highlands:'высокогорье',tundra:'тундра'},kinds={village:'сельское поселение',town:'город',city:'крупный город'},special={agriculture:'земледелие',mining:'добыча',port:'портовая специализация',administration:'управление',crafts:'ремёсла'};
  // Same elevation function as the globe, with north up and east right. This is a sampled overview, not surveyed geometry.
  const coordinate=(x,y)=>({lon:r.lon+(x/600-.5)*16/Math.max(.35,Math.cos(r.lat*Math.PI/180)),lat:Math.max(-89,Math.min(89,r.lat+(.5-y/330)*12))});
  const height=(x,y)=>{const v=coordinate(x,y);return Core.terrain(w.seed,v.lon,v.lat);};
  let terrain='';for(let y=0;y<15;y++)for(let x=0;x<30;x++){const h=height(x*20+10,y*22+11),color=h<.02?'#285c69':h>.4?palette[1]:palette[0];terrain+='<rect x="'+(x*20)+'" y="'+(y*22)+'" width="20.5" height="22.5" fill="'+color+'"/>';}
  const count=({village:9,town:17,city:26}[st.kind]??9)+Math.floor(infra*5),cold=temperature<3||r.biome==='tundra',roof=cold?'#c1c9be':epoch==='Ранние общества'?'#ae825f':'#c2765c',buildings=[];
  for(let i=0;i<count;i++){const col=i%7,row=Math.floor(i/7),x=95+col*54+(Core.rand(w.seed,r.id,'x',i)-.5)*14,y=90+row*36+(Core.rand(w.seed,r.id,'y',i)-.5)*10,ww=22+Core.rand(w.seed,r.id,'w',i)*10,hh=14+Core.rand(w.seed,r.id,'h',i)*8;if(height(x+ww/2,y+hh/2)>=.02)buildings.push({id:'house-'+i,x,y,ww,hh});}
  const shore=!!r.coastal,port=shore&&(r.economy?.port??0)>0&&st.specialization==='port',feature={agriculture:'Поля',mining:'Добыча сырья',port:'Хозяйство у воды',administration:'Общественный центр',crafts:'Мастерские'}[st.specialization]??'Хозяйство';
  const categories=[['housing','Жилые кварталы'],['special',feature],...(shore?[['shore',port?'Побережье и порт':'Побережье']]:[])],picked=buildings.find(o=>o.id===cityDetail);if(!picked&&!categories.some(x=>x[0]===cityDetail))cityDetail='housing';
  const houses=buildings.map((o,i)=>'<g><path d="M'+o.x+' '+o.y+' l'+o.ww+' 0 0 '+o.hh+' -'+o.ww+' 0z" fill="#c1bb9d"/><path d="M'+(o.x-3)+' '+o.y+' l'+(o.ww/2+3)+' -9 '+(o.ww/2+3)+' 9z" fill="'+roof+'"/><rect x="'+(o.x+o.ww*.35)+'" y="'+(o.y+o.hh*.45)+'" width="5" height="7" fill="#1b4040"/>'+(o.id===cityDetail?'<rect x="'+(o.x-6)+'" y="'+(o.y-14)+'" width="'+(o.ww+12)+'" height="'+(o.hh+20)+'" fill="none" stroke="#d4fff2" stroke-width="3"/>':'')+'</g>').join('');
  const detail=picked?'Выбран дом '+(buildings.indexOf(picked)+1)+' на рисунке. Это реконструированный силуэт: модель не хранит отдельного дома или его истории.':cityDetail==='housing'?'Схематичные жилые здания: их количество и расположение не записываются моделью.':cityDetail==='shore'?(port?'Для региона записана портовая специализация и инфраструктура у побережья. Конкретный причал и суда не моделируются.':'Регион отмечен как прибрежный; работающий порт по этим данным не подтверждён.'):('В модели указана специализация «'+(special[st.specialization]??'неизвестно')+'». Формы построек условны.');
  const featureShapes={agriculture:'<g fill="none" stroke="#ddc184" stroke-width="4"><path d="M340 190l80 -18m-78 27l80 -18m-78 27l80 -18"/></g>',mining:'<path d="M350 205l32 -48 25 48z" fill="#7d8980" stroke="#cbd0b2" stroke-width="2"/>',crafts:'<path d="M345 196v-27l15 -9 15 9 15 -9 15 9v27z" fill="#8e9b85" stroke="#cbd0b2"/>',administration:'<path d="M345 194v-22h60v22z M339 172l36 -20 36 20z" fill="#d2c9aa"/>',port:'<path d="M347 216h62m-54 0v20m46 -20v20" fill="none" stroke="#d8c19a" stroke-width="6"/>'};
  const featureShape=st.specialization==='port'&&!port?'':(featureShapes[st.specialization]??''),marker='<circle cx="300" cy="165" r="5" fill="#d7fff4" stroke="#163635" stroke-width="2"/>';
  const svg='<figure class="city-figure"><svg viewBox="0 0 600 330" role="img" aria-labelledby="city-art-title city-art-desc"><title id="city-art-title">Условный вид центра '+esc(st.name)+'</title><desc id="city-art-desc">Рельеф взят из функции глобуса, север сверху; здания реконструированы и отдельно моделью не записаны.</desc>'+terrain+houses+featureShape+marker+'</svg><figcaption>Процедурная реконструкция, не отдельные объекты модели. Север сверху. Цвета суши и воды получены из той же функции рельефа, что и глобус. Белая точка — центр региона; здания и их расположение реконструированы.</figcaption></figure>';
  const buttons='<div class="city-legend" role="group" aria-label="Выбрать часть реконструкции">'+categories.map(([id,label])=>'<button type="button" data-edition="city-detail" data-id="'+id+'" aria-pressed="'+(cityDetail===id)+'">'+esc(label)+'</button>').join('')+'</div>';
  const choices=buildings.length?'<label>Выбрать изображённое здание<select data-edition-change="city-object"><option value="">Выберите силуэт</option>'+buildings.map((o,i)=>'<option value="'+o.id+'"'+(o.id===cityDetail?' selected':'')+'>Дом '+(i+1)+' · реконструкция</option>').join('')+'</select></label>':'<p>На выбранном масштабе нет пригодных точек для условных зданий.</p>';
  return '<button type="button" data-edition="tab" data-id="place">← К региону</button>'+panel('Крупный план · '+st.name,'<p>'+esc(kinds[st.kind]??st.kind)+' · '+esc(special[st.specialization]??st.specialization)+' · '+esc(epoch)+'</p><p>Биом '+esc(biomeLabel[r.biome]??r.biome)+' · условная температура планеты '+num(temperature)+' °C · инфраструктура '+num(infra*100)+'%.</p>'+svg+buttons+choices+'<p role="status" class="city-explanation">'+esc(detail)+'</p><p class="edition-note">Отдельные здания, дороги и их истории в модели не записаны; показанные объекты реконструированы. Слой рельефа — приближение, не точная съёмка.</p>');
 }
 function skies(w){
  const home=w.planets.find(p=>p.home),observer=w.societies.find(s=>s.id===skySociety);
  if(!home||!w.observatory?.space)return panel('Система','<p>В этой версии нет новой модели системы и отдельных спутников.</p>');
  if(!observer)return panel('Система','<p>В выбранном срезе нет общества для наблюдения.</p>');
  const engineering=observer.tech?.[1],capability=!!observer.knowledge?.find(n=>n.id==='orbital')?.active;
  const rows=Number.isFinite(engineering)?SpaceWorld.targetOptions(w,home.id,engineering,w.year):[];
  const received=SpaceWorld.receivedMessages(w,'home',w.year).filter(m=>m.payload?.kind==='probe-result'&&m.payload.owner===observer.id);
  const missions=Core.allMissions(w).filter(m=>m.kind==='probe'&&m.owner===observer.id&&m.departure<=w.year);
  const list=w.planets.map(p=>{
   const target=rows.find(x=>x.id===p.id),messages=received.filter(m=>m.payload.target===p.id).sort((a,b)=>b.deliveredYear-a.deliveredYear),signal=messages[0];
   const launched=missions.filter(m=>m.target===p.id).sort((a,b)=>b.departure-a.departure)[0],known=p.home||observer.probed.includes(p.id);
   const knowledge=p.home?'Родной мир известен.':signal?'Данные зонда получены в '+signal.deliveredYear+' году; наблюдение у цели — '+signal.observedYear+' год.':known?'Разведка отмечена в состоянии общества; дата получения в доступном архиве не указана.':launched?'Зонд отправлен в '+launched.departure+' году; полученного подтверждения нет. Состав и пригодность поверхности неизвестны.':'Данных зонда нет. Состав и пригодность поверхности неизвестны.';
   const engineeringText=target?'<br>По расчёту траектории при уровне '+num(engineering)+': '+(target.reachable?'расстояние доступно':'расстояние недоступно')+' · '+(target.window?'окно открыто':'окно закрыто')+(known?' · '+(target.suitable?'посадка предусмотрена правилами':'посадка правилами не предусмотрена'):''):'';
   return '<li><b>'+esc(p.name)+'</b>'+(p.home?' · родной мир':'')+(p.parentId?' · спутник '+esc(body(w,p.parentId)):'')+'<br>'+esc(knowledge)+engineeringText+'</li>';
  }).join('');
  return '<label>Общество-наблюдатель<select data-edition-change="sky-society">'+options(w.societies,skySociety,s=>s.name+' · '+s.id)+'</select></label>'+panel('Звёздная семья','<p>Год '+w.year+' · родной мир '+esc(home.name)+' · инженерный уровень '+(Number.isFinite(engineering)?num(engineering):'не записан')+'. Орбитальный навык '+(capability?'действует':'недоступен')+'; искусственный спутник '+(observer.satellite?'есть':'не запущен')+'.</p><ul class="edition-list">'+list+'</ul><p class="edition-note">Окно и расстояние основаны на орбитах и инженерном уровне выбранного общества. Для отправки дополнительно нужны ресурсы и другие условия; не все сведения о цели известны до сигнала зонда.</p>');
 }
 function colonies(w){const space=w.observatory?.space;if(!space)return panel('Колонии','<p>Локальные знания и сигналы в этой версии не учитываются.</p>');if(!w.colonies.length)return panel('Колонии','<p>В выбранном году внеземных поселений нет. Они появятся при наличии цели, возможностей и состоявшегося полёта.</p>');const c=w.colonies.find(x=>x.id===colony);if(!c)return '';const st=space.colonies?.[c.id],messages=SpaceWorld.receivedMessages(w,'home',w.year).filter(m=>m.from===c.id&&m.payload?.kind==='colony-status').sort((a,b)=>b.deliveredYear-a.deliveredYear),last=messages[0],returns=space.returns.filter(x=>x.origin===c.id&&x.year<=w.year);
 let out='<label>Поселение<select data-edition-change="colony">'+options(w.colonies,colony,x=>x.name+' · '+body(w,x.planet))+'</select></label>';
 out+=panel('Местный взгляд · год '+w.year,'<p><b>'+esc(c.name)+'</b> · '+esc(body(w,c.planet))+' · жители '+num(c.population)+' · пища '+num(c.food)+'.</p>'+(st?'<p>Местные навыки: '+(st.skills.length?st.skills.map(id=>esc((typeof Knowledge!=='undefined'&&Knowledge.NODES.find(n=>n.id===id)?.name)||id)).join(', '):'не записаны')+'<br>Сырьё '+num(st.raw)+' · оборудование '+num(st.equipment)+' · месторождение '+num(st.deposits)+'.<br>Связь: '+(st.connected?'действует':'прервана')+'.</p>':'<p>Локальные навыки и материалы не записаны.</p>'));
 out+=panel('Что известно дома',last?'<p>Последнее полученное сообщение: состояние за '+last.observedYear+' год, отправлено в '+last.sentYear+', получено в '+last.deliveredYear+'.</p><p>Жители '+num(last.payload.population)+' · пища '+num(last.payload.food)+'.</p>':'<p>Доставленных домой сообщений об этом поселении к выбранному году нет.</p>');
 if(st?.homeMemory){
  const m=st.homeMemory;
  out+=panel('Память о родине',m.carriers?'<p>'+num(m.carriers)+' носителей · '+esc(m.source)+' · год '+m.received+(m.evidence?' · свидетельство '+esc(m.evidence):'')+'.</p>':'<p>В местной общине не сохранилось свидетельства о родной планете.</p>');
 }
 if(st){
  const decision=SpaceWorld.returnAssessment(w,c.id);
  out+=panel('Возможность рейса','<p>'+esc(decision.allowed?decision.motive:decision.reason)+'</p>'+(decision.cost?'<p>Требуется экипаж '+num(decision.crew)+', пища '+num(decision.cost.food)+', сырьё '+num(decision.cost.raw)+', оборудование '+num(decision.cost.equipment)+'.</p>':''));
  if(st.lastTeaching)out+=panel('Местная школа','<p>Год '+num(st.lastTeaching.year)+' · '+(st.lastTeaching.kind==='loss'?'прервалась подготовка орбитальных специалистов':'местная мастерская восстановила подготовку орбитальных специалистов')+'.</p>');
 }
 if(space.exchange){
  const name=id=>w.colonies.find(v=>v.id===id)?.name??id;
  const rows=[...space.exchange.active,...space.exchange.recent].filter(t=>[t.from,t.to].includes(c.id)).sort((a,b)=>b.departure-a.departure);
  if(rows.length)out+=panel('Грузы между поселениями','<ul class="edition-list">'+rows.map(t=>'<li>'+esc(name(t.from))+' → '+esc(name(t.to))+' · '+num(t.food)+' ед. пищи · отправлено в '+t.departure+' · '+(t.arrival<=w.year?'доставлено':'ожидается')+' в '+t.arrival+'<br>Сведения о нужде от '+t.reportYear+' года дошли до отправителя в '+t.knownYear+'.</li>').join('')+'</ul><p>Показаны текущие рейсы и последние двенадцать прибытий по системе.</p>');
 }
 out+=panel('Возвращения',returns.length?'<ul class="edition-list">'+returns.map(x=>'<li>Год '+x.year+' · '+esc(x.motive)+' · миссия '+esc(x.mission)+' · '+(x.hold?'ожидание с '+x.hold.since+' года: '+esc(x.hold.reason)+' · ':'')+(x.arrival!==null?'прибыла в '+x.arrival+' · принято '+esc(soc(w,x.recipient)):'в пути или исход ещё неизвестен')+'</li>').join('')+'</ul>':'<p>Возвратных рейсов от этого поселения к выбранному году нет.</p>');return out;}
 function html(w,live){sync(w);if(tab==='city')return '<div class="edition-observer edition-city"><p class="edition-meta">Год '+w.year+' · '+(w.year===live.year?'настоящее':'сохранённый срез')+'</p>'+city(w)+'</div>';const links=[['place','Место'],['evidence','Следы'],['voices','Голоса'],['skies','Система'],['colonies','Колонии']];return '<div class="edition-observer"><p class="edition-meta">Мир вблизи · год '+w.year+' · '+(w.year===live.year?'настоящее':'сохранённый срез')+'</p><p><button type="button" data-edition="demo">Открыть отдельный пример BASIN-1</button></p><nav class="edition-tabs" aria-label="Разделы наблюдения">'+links.map(([id,label])=>'<button data-edition="tab" data-id="'+id+'" aria-pressed="'+(tab===id)+'">'+label+'</button>').join('')+'</nav>'+(tab==='place'?place(w,live):tab==='city'?city(w):tab==='evidence'?evidence(w):tab==='voices'?voices(w):tab==='skies'?skies(w):colonies(w))+'</div>';}
 function set(name,value,w){if(name==='sky-society'&&w.societies.some(x=>x.id===value)){skySociety=value;return true;}if(name==='city-object'&&/^house-\d+$/.test(value)){cityDetail=value;return true;}if(name==='site'&&w.regions.some(x=>x.id===value)){site=value;trace='';check='';return true;}if(name==='colony'&&w.colonies.some(x=>x.id===value)){colony=value;return true;}if(name==='theory'){theory=value;check='';return true;}if(name==='compare'){compare=value;return true;}return false;}
 function action(name,id,w){if(name==='city'&&w.regions.some(r=>r.id===id)){sync(w);site=id;cityDetail='housing';tab='city';return true;}if(name==='city-detail'&&['housing','special','shore'].includes(id)){cityDetail=id;return true;}if(name==='tab'&&['place','evidence','voices','skies','colonies'].includes(id)){tab=id;return true;}if(name==='trace'){const visible=summary(w).traces.find(t=>t.id===id&&t.discovered!==null);if(visible){trace=id;check='';return true;}}if(name==='basin'){const b=summary(w).basin;if(b){site=b.upper;tab='place';return true;}}if(name==='check'){const d=summary(w),t=d.traces.find(x=>x.id===trace&&x.discovered!==null),f=t&&d.facts.find(x=>x.id===t.source);check=!theory?'Сначала выберите версию.':!f?'Источника недостаточно для проверки.':f.kind===theory?'Версия согласуется с датированной записью источника.':'Версия не совпадает с типом записи источника.';return true;}return false;}
 function demoHtml(w){const d=summary(w),b=d.basin,p=b?.project,traces=d.traces.filter(t=>t.discovered!==null);return '<div class="edition-observer"><p class="edition-meta">Отдельный расчёт · BASIN-1 · индустриальная эпоха · модель '+esc(w.modelVersion)+' · год '+w.year+'</p><p>Пример существует только в памяти. Открытый вами мир не заменён и не изменён.</p>'+panel('Результат расчёта',!d.available?'<p>Местная история в этом движке недоступна.</p>':!b?'<p>Подходящий бассейн не возник.</p>':'<p>Верховье '+esc(loc(w,b.upper))+' · низовье '+esc(loc(w,b.lower))+'.</p><p>'+(p?'Стройка: '+esc(p.status)+' · начало '+p.started+(p.completed!==null?' · завершение '+p.completed:'')+' · труд '+num(p.labor)+' / '+num(p.required)+'.':'Стройка не началась.')+'</p>')+panel('Датированные записи',d.facts.length?'<ul class="edition-list">'+d.facts.map(f=>'<li>Год '+f.year+' · '+esc(f.title)+' · '+esc(loc(w,f.site))+'</li>').join('')+'</ul>':'<p>К этому году записей нет.</p>')+panel('Обнаруженные следы',traces.length?'<ul class="edition-list">'+traces.map(t=>'<li>'+esc(t.kind)+' · найден в '+t.discovered+'</li>').join('')+'</ul>':'<p>К этому году подтверждённых находок нет.</p>')+'<button type="button" data-edition="open">Вернуться к моему миру</button></div>';}
 return {html,set,action,evidence,examine,readClaim,demoHtml};
})();
let editionDemoToken=0;
function editionRender(shown,live){const root=document.getElementById('edition-root');if(root)root.innerHTML=EditionUI.html(shown,live);}
async function editionRunDemo(){
 const token=++editionDemoToken;setRunning(false);modal('Отдельный пример','<div id="edition-demo"><p role="status">Расчёт: год 0 из 100</p><button type="button" data-edition="cancel-demo">Отменить</button></div>',true);
 const target=document.getElementById('edition-demo');
 try{let demo=ReleasedCore.createWorld('BASIN-1',{era:'industrial'});for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,0));if(token!==editionDemoToken||!document.getElementById('dialog')?.open||document.getElementById('edition-demo')!==target)return;demo=ReleasedCore.advance(demo,5).world;target.innerHTML='<p role="status">Расчёт: год '+demo.year+' из 100</p><button type="button" data-edition="cancel-demo">Отменить</button>';}
 if(token===editionDemoToken&&document.getElementById('dialog')?.open&&document.getElementById('edition-demo')===target)target.innerHTML=EditionUI.demoHtml(demo);
 }catch(e){if(token===editionDemoToken&&document.getElementById('edition-demo')===target)target.innerHTML='<p>Не удалось рассчитать пример: '+String(e.message).replace(/[&<>"\']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</p><button type="button" data-edition="open">Вернуться к моему миру</button>';}
}
function editionClick(button){if(!button?.dataset.edition)return false;const action=button.dataset.edition;if(action==='investigate'){
 const shown=displayed(),root=document.getElementById('edition-root');if(!root||shown.modelVersion!=='1.0.1')return true;
 EditionUI.readClaim(shown,root);editionRender(shown,world);return true;}if(action==='city'){if(EditionUI.action('city',button.dataset.id,displayed())){setRunning(false);modal('Мир вблизи','<div id="edition-root"></div>',true);editionRender(displayed(),world);}return true;}if(action==='demo'){void editionRunDemo();return true;}if(action==='cancel-demo'){editionDemoToken++;modal('Мир вблизи','<div id="edition-root"></div>',true);editionRender(displayed(),world);return true;}if(action==='open'){editionDemoToken++;setRunning(false);modal('Мир вблизи','<div id="edition-root"></div>',true);editionRender(displayed(),world);return true;}if(EditionUI.action(action,button.dataset.id,displayed()))editionRender(displayed(),world);return true;}
function editionChange(target){if(!target?.dataset.editionChange)return false;if(EditionUI.set(target.dataset.editionChange,target.value,displayed()))editionRender(displayed(),world);return true;}
