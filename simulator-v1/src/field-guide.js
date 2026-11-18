/* Field guide for the selected snapshot and reproducible, isolated gallery calculations. */
const FieldGuide = (() => {
  const demos = Object.freeze({
    doron: {name:'Дорон и мирное соглашение', seed:'АРХИВ-09', era:'agriculture', model:'0.8', horizon:90},
    basin: {name:'Строительство на реке', seed:'BASIN-1', era:'industrial', model:'1.0', horizon:120},
    voyage: {name:'Колонисты на обратном пути', seed:'ГОРИЗОНТ-12', era:'space', model:'1.0', horizon:220},
    investigation: {name:'Три свидетельства о переправе', seed:'МЕАНДР-19', era:'industrial', model:'1.0.1', horizon:100},
  });
  const eras={agriculture:'ранняя эпоха',industrial:'промышленная эпоха',space:'космическая эпоха'};
  const number=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n);
  const place=(w,id)=>w.regions.find(r=>r.id===id);
  const name=(w,id)=>place(w,id)?.settlement?.name??id;
  const soc=(w,id)=>w.societies.find(s=>s.id===id)?.name??id;
  const anchor=(w,type,id,site=null)=>({schema:w.schema,worldId:w.id,year:w.year,type,id,site});
  function recentEvent(w,engine){
    const since=Math.max(0,w.year-9);
    for(let page=engine.eventPageCount(w,w.year)-1;page>=0;page--){
      const events=engine.eventPage(w,page,{throughYear:w.year});
      for(let i=events.length-1;i>=0;i--){
        const e=events[i];
        if(e.year<since)return null;
        if(e.important&&e.type!=='origin')return e;
      }
    }
    return null;
  }
  function suggestions(w,engine){
    if(!w)return [];
    const out=[],since=Math.max(0,w.year-9);
    const fact=LivingWorld.summary(w,w.year).facts.filter(f=>f.year>=since&&f.year<=w.year&&place(w,f.site)).at(-1);
    if(fact)out.push({title:fact.title,description:name(w,fact.site)+' · запись года '+fact.year,source:'История места',target:anchor(w,'fact',fact.id,fact.site)});
    const ret=w.observatory?.space?.returns.filter(r=>Number.isInteger(r.arrival)&&r.arrival>=since&&r.arrival<=w.year&&place(w,r.region)).at(-1);
    if(ret)out.push({title:'Прибытие с колонии',description:name(w,ret.region)+' · год '+ret.arrival,source:'Журнал рейса',target:anchor(w,'voyage',ret.mission,ret.region)});
    const e=recentEvent(w,engine);
    if(e)out.push({title:e.title,description:'Год '+e.year+(e.regionIds?.length?' · '+name(w,e.regionIds[0]):''),source:'Хроника',target:anchor(w,'event',e.id,e.regionIds?.[0]??null)});
    if(out.length<3){
      const r=w.regions.reduce((best,r)=>!best||r.population>best.population?r:best,null);
      if(r)out.push({title:name(w,r.id),description:'Жителей региона в году '+w.year+': '+number(r.population)+'.',source:out.length?'Паспорт региона':'Спокойное наблюдение',target:anchor(w,'region',r.id,r.id),quiet:!out.length});
    }
    return out;
  }
  function yearIndex(live,target){
    if(!live||live.id!==target.worldId||live.schema!==target.schema)return undefined;
    if(live.year===target.year)return null;
    const index=live.snapshots.findIndex(s=>s.year===target.year);
    return index>=0?index:undefined;
  }
  function markers(key,w,engine){
    if(key==='investigation'){
      return LivingWorld.summary(w,w.year).traces.filter(t=>t.discovered!==null)
        .map(t=>({year:t.discovered,site:t.site,title:t.kind,detail:'След датирован '+t.formed+' годом. Идентифицирован в '+t.discovered+' году.'}))
        .sort((a,b)=>a.year-b.year);
    }
    if(key==='doron'){
      const r=w.regions.find(r=>r.settlement?.name==='Дорон');if(!r)return [];
      const events=engine.allEvents(w).filter(e=>e.regionIds?.includes(r.id));
      const occupation=events.find(e=>e.title==='Оккупация региона');
      const treaty=occupation&&events.find(e=>e.year>=occupation.year&&e.title==='Мирное соглашение');
      return [occupation,treaty].filter(Boolean).map(e=>({year:e.year,site:r.id,title:e.title,detail:e.detail}));
    }
    if(key==='basin'){
      const facts=LivingWorld.summary(w,w.year).facts,foundation=facts.find(f=>f.kind==='foundation');
      const done=foundation&&facts.find(f=>f.kind==='completed'&&f.site===foundation.site&&f.year>=foundation.year);
      return [foundation,done].filter(Boolean).map(f=>({year:f.year,site:f.site,title:f.title,detail:'Владелец в момент записи: '+soc(w,f.owner)+'.'}));
    }
    const records=w.observatory?.space?.returns??[];
    const flight=records.filter(r=>Number.isInteger(r.arrival)&&r.arrival<=w.year).sort((a,b)=>a.arrival-b.arrival)[0]??records[0];
    if(!flight)return [];
    const mission=engine.allMissions(w).find(m=>m.id===flight.mission);if(!mission)return [];
    const colony=w.colonies.find(c=>c.id===flight.origin);
    const aboard='Экипаж: '+number(mission.people)+'. Продовольствие: '+number(mission.cargo)+'.';
    const list=[{year:flight.year,colony:flight.origin,body:colony?.planet,title:'Вылет с колонии',detail:(colony?.name??flight.origin)+'. Пункт назначения: '+name(w,flight.region)+'. '+aboard}];
    if(Number.isInteger(flight.arrival)&&flight.arrival<=w.year)list.push({year:flight.arrival,site:flight.region,title:'Прибытие в родной регион',detail:name(w,flight.region)+'. Получатель: '+soc(w,flight.recipient)+'. '+aboard});
    return list;
  }
  async function replay(key,engine,frame,exactYear=null){
    const spec=demos[key];if(!spec)throw new Error('Неизвестный пример.');
    const limit=exactYear===null?spec.horizon:exactYear;
    if(!Number.isInteger(limit)||limit<0||limit>spec.horizon)throw new Error('Недоступный год примера.');
    const w=engine.createWorld(spec.seed,{era:spec.era}),session=engine.createWorkerSession(w);
    // A private worker session owns only the newly generated world. No user archive or store is opened.
    while(w.year<limit){
      await frame(w.year,limit);
      session.step(Math.min(5,limit-w.year));
      if(exactYear===null){
        const points=markers(key,w,engine);
        if(points.length>=(key==='investigation'?3:2)){
          const end=points.at(-1).year;
          if(w.year!==end)return replay(key,engine,frame,end);
          return {w,points};
        }
      }
    }
    return {w,points:markers(key,w,engine)};
  }
  return {demos,eras,suggestions,yearIndex,markers,replay,name,number};
})();

let guideJob=0,guideTips=[],guidePreview=null;
const guideButton=(action,label,attrs='')=>'<button type="button" data-guide="'+action+'" '+attrs+'>'+h(label)+'</button>';
function guideHome(){
  guideJob++;guidePreview=null;setRunning(false);
  const shown=world?displayed():null;
  guideTips=shown?FieldGuide.suggestions(shown,Core):[];
  const hint=guideTips.some(t=>t.quiet)?'<p>В доступных записях за последние десять лет нет недавнего важного события. Можно изучить состояние региона в этом срезе.</p>':'';
  const tips=guideTips.map((tip,i)=>'<article class="edition-card"><small>'+h(tip.source)+'</small><h3>'+h(tip.title)+'</h3><p>'+h(tip.description)+'</p>'+guideButton('tip','Открыть наблюдение','data-guide-index="'+i+'"')+'</article>').join('');
  const cards=Object.entries(FieldGuide.demos).map(([key,spec])=>'<article class="edition-card"><h3>'+h(spec.name)+'</h3><p>'+h(spec.seed)+' · '+h(FieldGuide.eras[spec.era])+' · модель '+h(spec.model==='0.8'?'0.8.0':spec.model==='1.0'?'1.0.0':spec.model)+'</p>'+guideButton('demo','Рассчитать пример','data-guide-key="'+key+'"')+'</article>').join('');
  modal('Куда посмотреть',(shown?'<h2>Ваш мир · год '+shown.year+'</h2>'+hint+tips:'<p>Выберите пример. Он откроется в памяти и его можно изучить до создания своего мира.</p>')+'<h2>Галерея наблюдений</h2>'+cards,true);
}
function openGuideTip(tip){
  if(!tip)return;
  const index=FieldGuide.yearIndex(world,tip.target);
  if(index===undefined){notice('Исходный год отсутствует среди доступных срезов. Обновите подсказки.');return;}
  setRunning(false);snapshotIndex=index;resetEconomyPages();render();
  const w=displayed(),target=tip.target;
  if(target.type==='event'){showEvent(target.id);return;}
  if(target.type==='region'){showRegionMap(target.site);return;}
  let detail='';
  if(target.type==='fact'){
    const f=LivingWorld.summary(w,w.year).facts.find(f=>f.id===target.id&&f.site===target.site);
    if(!f)return;
    detail='<p>Запись года '+f.year+': '+h(f.title)+'.</p>';
  }else{
    const r=w.observatory.space.returns.find(r=>r.mission===target.id&&r.region===target.site);
    if(!r||r.arrival===null||r.arrival>w.year)return;
    const m=Core.allMissions(w).find(m=>m.id===r.mission);
    detail='<p>Вылет в году '+r.year+', прибытие в году '+r.arrival+'.</p>'+(m?'<p>Экипаж: '+h(FieldGuide.number(m.people))+'. Доставлено продовольствия: '+h(FieldGuide.number(m.cargo))+'.</p>':'');
  }
  modal(tip.title,detail+'<p>'+h(FieldGuide.name(w,target.site))+' · выбранный срез: год '+w.year+'</p>'+guideButton('place','Открыть этот регион в году '+w.year,'data-guide-index="'+guideTips.indexOf(tip)+'"'),true);
}
function guidePreviewHtml(){
  const {key,w,points,available}=guidePreview,spec=FieldGuide.demos[key];
  const current=points.at(-1),site=current&&w.regions.find(r=>r.id===current.site);
  const steps=available.map((m,i)=>guideButton('moment','Год '+m.year+' · '+(m.year>w.year?'следующий момент':m.title),'data-guide-index="'+i+'"')).join(' ');
  const facts=points.map(p=>'<li><b>Год '+p.year+' · '+h(p.title)+'</b><p>'+h(p.detail)+'</p></li>').join('');
  const colony=current?.colony&&w.colonies.find(c=>c.id===current.colony);
  const body=colony&&w.planets.find(p=>p.id===colony.planet);
  const subject=colony?'<p>Колония '+h(colony.name)+' · '+h(body?.name??colony.planet)+' · жителей в году '+w.year+': '+h(FieldGuide.number(colony.population))+'.</p>':site?'<p>Регион '+h(FieldGuide.name(w,site.id))+' · '+h(site.id)+' · жителей в году '+w.year+': '+h(FieldGuide.number(site.population))+'.</p>':'';
  const caseButton=guidePreview.key==='investigation'?guideButton('casework','Исследовать улики')+' ':'';
  const action=spec.model!=='0.8'?caseButton+guideButton('save','Сохранить отдельным миром'):guideButton('download','Скачать мир для версии 0.8')+' <a href="/v08">Открыть версию 0.8</a>';
  const result=available.length>=2?'':'<p>В пределах расчёта полный эпизод не возник.</p>';
  return '<p>'+h(spec.seed)+' · '+h(FieldGuide.eras[spec.era])+' · модель '+h(w.modelVersion)+' · год '+w.year+'</p>'+result+subject+(facts?'<ol>'+facts+'</ol>':'<p>К этому году записи эпизода отсутствуют.</p>')+'<div class="dialog-actions">'+steps+'</div><div class="dialog-actions">'+action+' '+guideButton('open','К галерее')+'</div>';
}
async function guideDemo(key,exactYear=null){
  const spec=FieldGuide.demos[key];if(!spec)return;
  const available=exactYear===null?null:guidePreview?.available;
  if(exactYear!==null&&!available?.some(m=>m.year===exactYear))return;
  const token=++guideJob,engine=spec.model==='0.8'?LegacyCore:spec.model==='1.0'?ReleasedCore:Core;
  setRunning(false);modal(spec.name,'<div id="field-guide-progress" role="status">Расчёт начинается…</div>'+guideButton('open','Отменить и вернуться'),true);
  const owner=$('#field-guide-progress');
  const current=()=>token===guideJob&&$('#dialog').open&&$('#field-guide-progress')===owner;
  try{
    const {w,points}=await FieldGuide.replay(key,engine,async(y,end)=>{
      if(!current())throw new Error('Расчёт отменён.');
      owner.textContent='Считаю пример · год '+y+' из '+end;await yieldFrame();
    },exactYear);
    if(!current())return;
    guidePreview={key,w,points,available:available??points};modal(spec.name,guidePreviewHtml(),true);
  }catch(error){if(current())modal(spec.name,'<p>'+h(error.message)+'</p>'+guideButton('open','К галерее'),true);}
}
async function fieldGuideClick(button){
  const action=button?.dataset.guide;if(!action)return false;
  try{
    const index=Number(button.dataset.guideIndex);
    if(action==='open')guideHome();
    else if(action==='tip')openGuideTip(guideTips[index]);
    else if(action==='place'){
      const t=guideTips[index]?.target,idx=t&&FieldGuide.yearIndex(world,t);
      if(t&&idx!==undefined){snapshotIndex=idx;setRunning(false);showRegionMap(t.site);}
    }else if(action==='demo')await guideDemo(button.dataset.guideKey);
    else if(action==='moment'&&guidePreview?.available[index])await guideDemo(guidePreview.key,guidePreview.available[index].year);
    else if((action==='casework'||action==='case-proof')&&guidePreview?.key==='investigation'){
      const w=guidePreview.w;
      if(action==='case-proof'){
        const root=$('#guide-investigation');
        if(root)EditionUI.readClaim(w,root);
      }
      const contents=EditionUI.evidence(w).replace('data-edition="investigate"','data-guide="case-proof"');
      modal('Исследование переправы','<div id="guide-investigation" class="edition-observer">'+contents+'</div>'+guideButton('case-return','К датам примера'),true);
    }else if(action==='case-return'&&guidePreview)modal(FieldGuide.demos[guidePreview.key].name,guidePreviewHtml(),true);
    else if(action==='save'&&guidePreview&&FieldGuide.demos[guidePreview.key].model!=='0.8'){
      const preview=guidePreview;
      await transition(()=>installWorld(preview.w));
      const point=preview.points.at(-1);
      guidePreview=null;
      if(point?.site)showRegionMap(point.site);
      else if(point?.body){selectedPlanet=point.body;view='planet';render();}
      notice('Пример сохранён отдельным миром. Год '+world.year+'.');
    }else if(action==='download'&&guidePreview?.key==='doron'){
      const w=LegacyCore.clone(guidePreview.w);w.id=uniqueId();
      const codec=Storage.createSaveCodec(LegacyCore.SCHEMA,LegacyCore.MODEL_VERSION,LegacyCore.validateWorld);
      const text=await codec.encode(w),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');
      a.href=url;a.download='microgalaxy-08-archive09-'+w.year+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notice('Файл готов. В версии 0.8 откройте «Импорт» и выберите его.');
    }
  }catch(error){notice(error.message,error.name==='ConflictError');}
  return true;
}
