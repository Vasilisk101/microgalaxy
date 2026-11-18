let branchPreview = null, branchJob = null;
const branchNumber = n => n.toLocaleString('ru-RU', {maximumFractionDigits:2});
function branchSize(w) { return new TextEncoder().encode(Storage.ensureSaveSize(w)).length; }
const branchMiB = n => branchNumber(n/1048576)+' МиБ';
const branchPlace = id => world.regions.find(r=>r.id===id)?.settlement.name ?? id;
const branchBtn = (action,label) => '<button data-branches="'+action+'">'+label+'</button>';
function branchModeOptions(w,edgeId){
  const labels={none:'Одинаковые условия',closed:'Закрыть природный переход',open:'Открыть перекрытый переход'};
  return Branches.conditionModes(w,edgeId).map(mode=>'<option value="'+mode+'">'+labels[mode]+'</option>').join('');
}
function branchReport(x, index, mobileRole) {
  const report = x.report, row = report.samples[index], e = world.geography.edges.find(edge=>edge.id===report.edge);
  const point = id => {const r=world.regions.find(r=>r.id===id);return [((r.lon+180)/360*284+8).toFixed(2),((90-r.lat)/180*128+8).toFixed(2)];};
  function map(role,i){
    const dots=world.regions.map(r=>{const [cx,cy]=point(r.id);return '<circle cx="'+cx+'" cy="'+cy+'" r="'+(e&&[e.a,e.b].includes(r.id)?4:1.5)+'" fill="currentColor"/>';}).join('');
    const line=e?'<line x1="'+point(e.a)[0]+'" y1="'+point(e.a)[1]+'" x2="'+point(e.b)[0]+'" y2="'+point(e.b)[1]+'" stroke="currentColor" stroke-width="2"/>':'';
    return '<article class="twin-map '+(mobileRole===i?'shown':'')+'"><h3>'+role+'</h3><svg viewBox="0 0 300 144" aria-label="Схема центров регионов">'+dots+line+'</svg><p>'+branchNumber(row[1+i])+' ед. перевозок · '+branchNumber(row[3+i])+' ед. пищи</p>'+(report.site?'<button data-branches="inspect" data-side="'+i+'" data-sample="'+index+'" data-site="'+h(report.site)+'">Открыть регион '+h(branchPlace(report.site))+'</button>':'')+'</article>';
  }
  function description(c){return c&&c.year<=row[0]?'Год '+c.year+' · '+h(c.metric)+' · '+h(branchPlace(c.place))+' · '+branchNumber(c.control)+' / '+branchNumber(c.experimental):'К выбранному году различий не обнаружено.';}
  const choices=report.samples.map((v,i)=>'<option value="'+i+'" '+(i===index?'selected':'')+'>'+v[0]+'</option>').join('');
  const cargo=report.firstFreight;
  const cargoSide=(label,item)=>'<p><b>'+label+':</b> '+(item?h(item.id)+' · '+h(branchPlace(item.from))+' → '+h(branchPlace(item.to))+' · '+h(item.resource)+' · отправление '+item.departure+' · путь '+h(item.path.join(' → '))+' · '+(item.status==='waiting'?'ожидает':'в пути')+' · '+branchNumber(item.amount)+' ед. · ожидаемый год '+item.arrival:cargo?.kind==='shared'?'общая партия больше не в активном списке; её исход не установлен':'отдельная отличающаяся партия не зафиксирована')+'</p>';
  const cargoText=!Object.hasOwn(report,'firstFreight')?'Старый отчёт не содержит сравнения партий.':!cargo||cargo.year>row[0]?'К выбранному году различий партий не обнаружено.':'<p>Год '+cargo.year+'. '+(cargo.kind==='shared'?'Это одна партия, существовавшая до разделения ветвей.':'Партии возникли после разделения и показаны независимо; совпадение номеров не доказывает общего происхождения.')+'</p>'+cargoSide('Контроль',cargo.control)+cargoSide('Опыт',cargo.experimental);
  return '<p>Сравнение от года '+report.start+' до '+report.end+'. '+(e?'Путь '+h(branchPlace(e.a))+' → '+h(branchPlace(e.b))+'.':'Показатели всей системы.')+'</p>'+
    '<p>'+(x.condition?'Условие опыта: путь '+(x.condition.mode==='open'?'доступен по рельефу':'закрыт')+' с '+(x.year+1)+' по '+x.condition.until+' год.':'Контрольная пара с одинаковыми условиями.')+'</p>'+
    '<label>Общий год обеих схем<select id="twin-year">'+choices+'</select></label><div class="twin-tabs">'+branchBtn('left','Контроль')+branchBtn('right','Опыт')+'</div>'+
    '<div class="twin-maps">'+map('Контроль',0)+map('Опыт',1)+'</div><p class="form-hint">'+(e?'Перевозки по выбранному пути и запас пищи у '+h(branchPlace(e.b))+'.':'Сумма использованной вместимости участков и пища во всех регионах.')+'</p>'+
    '<h3>Первое изменение движения</h3><p>'+description(report.firstMovement)+'</p><h3>Первое различие партий</h3>'+cargoText+'<h3>Первое изменение запасов или населения</h3><p>'+description(report.firstEconomy)+'</p>'+
    (row[0]===report.end&&report.firstEconomy&&!report.lastEconomy?'<p>К концу периода численность и региональные запасы обеих ветвей вновь совпали.</p>':'');
}
function branchComparison(x,index=x.report.samples.length-1,mobileRole=0){
  const style='<style>.twin-maps{display:grid;grid-template-columns:1fr 1fr;gap:12px}.twin-map{min-width:0;border:1px solid currentColor;padding:10px}.twin-map svg{width:100%;max-height:150px}.twin-tabs{display:none}@media(max-width:650px){.twin-tabs{display:flex;gap:8px}.twin-maps{display:block}.twin-map:not(.shown){display:none}}</style>';
  modal('Сравнение миров',style+branchReport(x,index,mobileRole)+'<div class="dialog-actions">'+
    (branchPreview?branchBtn('commit','Сохранить обе ветви · '+branchMiB(branchPreview.bytes))+' '+branchBtn('discard','Отменить'):
      branchBtn('peer','Открыть соседнюю ветвь')+' '+(x.report.site?branchBtn('map','Место на глобусе')+' ':'')+branchBtn('parent','Исходный мир'))+'</div>',true);
  $('#twin-year').onchange=event=>branchComparison(x,Number(event.target.value),mobileRole);
  for(const [i,key] of ['left','right'].entries())$('#dialog-body [data-branches="'+key+'"]').onclick=event=>{
    event.stopPropagation();branchComparison(x,index,i);
  };
}
function branchSnapshotAt(source,year){
  if(source.year<=year)return {world:source,index:null,year:source.year};
  let index=-1;for(let i=0;i<source.snapshots.length;i++)if(source.snapshots[i].year<=year)index=i;else break;
  return index<0?null:{world:Core.viewSnapshot(source,index),index,year:source.snapshots[index].year};
}
async function branchSource(side){
  if(branchPreview)return branchPreview.pair[side];
  const x=world.observatory?.experiment;if(!x)throw new Error('Отчёт сравнения недоступен.');
  const role=side?'experimental':'control';if(x.role===role)return world;
  const record=await store.get(x.peerId);if(!record?.world)throw new Error('Соседняя ветвь отсутствует на устройстве. Сначала откройте её из каталога.');return record.world;
}
async function branchInspect(side,index,site){
  const source=await branchSource(side),report=source.observatory.experiment.report,row=report.samples[index];
  if(!row||!site||!source.regions.some(r=>r.id===site))throw new Error('Место или год в отчёте недоступны.');
  const point=branchSnapshotAt(source,row[0]);if(!point)throw new Error('Для выбранного года нет более раннего полного среза.');
  const r=point.world.regions.find(r=>r.id===site);if(!r)throw new Error('Регион отсутствует в доступном срезе.');
  const role=side?'Опыт':'Контроль';
  modal('Регион · '+r.settlement.name,'<p>'+role+' · выбран год '+row[0]+'. '+(point.year===row[0]?'Открыт точный срез.':'Ближайший доступный ранний срез: '+point.year+' год.')+'</p><p>Регион '+h(site)+' · жители '+branchNumber(r.population)+' · пища '+branchNumber(r.economy.stock.food)+' · владелец '+h(point.world.societies.find(s=>s.id===r.owner)?.name??r.owner)+'.</p>'+
    '<div class="dialog-actions"><button data-branches="report" data-sample="'+index+'" data-side="'+side+'">К сравнению</button>'+(!branchPreview?'<button data-branches="focus" data-sample="'+index+'" data-side="'+side+'" data-site="'+h(site)+'">На глобус этой ветви</button>':'<p>Для перехода на глобус сначала сохраните пару.</p>')+'</div>',true);
}
function branchesDialog() {
  if(!world || busy || switching || localConflict || snapshotIndex!==null){notice('Для сравнения откройте настоящее полное состояние мира и дождитесь окончания шага.');return;}
  if(world.observatory?.experiment?.report){branchComparison(world.observatory.experiment);return;}
  if(world.year>=Core.LIMITS.years){notice('Этот мир достиг предельного года модели.');return;}
  const cap=Core.LIMITS.years, end=Math.min(world.year+20,cap);
  const getName=e=>branchPlace(e.a)+' → '+branchPlace(e.b)+' · '+(e.kind==='sea'?'море':'суша');
  const rows=world.geography.edges.map(e=>'<option value="'+h(e.id)+'">'+h(getName(e))+'</option>').join('');
  modal('Миры-двойники','<p>Обе копии начнут в году '+world.year+' и пройдут одинаковое число лет. После сравнения можно сохранить их отдельно. Текущий мир останется в исходном году.</p>'+
    '<div class="form-row"><label for="twin-edge">Путь</label><select id="twin-edge">'+rows+'</select></div>'+
    '<div class="form-row"><label for="twin-mode">Единственное отличие</label><select id="twin-mode">'+branchModeOptions(world,world.geography.edges[0]?.id)+'</select><p class="form-hint">Открытие доступно только для перекрытого природного перехода бассейна; торговые и военные ограничения оно не снимает.</p></div>'+
    '<div class="form-row"><label for="twin-until">Условие действует по год</label><input id="twin-until" type="number" min="'+(world.year+1)+'" max="'+cap+'" value="'+end+'"></div>'+
    '<div class="form-row"><label for="twin-end">Сравнить до года</label><input id="twin-end" type="number" min="'+(world.year+1)+'" max="'+cap+'" value="'+end+'"></div>'+
    '<p>Две копии текущего состояния занимают около '+branchMiB(branchSize(world)*2)+'. После расчёта будет известен размер готовой пары.</p>'+
    (store.persistent?'':'<p>Хранилище браузера недоступно. Пара будет доступна в этом сеансе, каждую ветвь можно экспортировать.</p>')+
    '<div class="dialog-actions">'+branchBtn('run','Сравнить')+'</div>',true);
  $('#twin-edge').onchange=event=>{$('#twin-mode').innerHTML=branchModeOptions(world,event.target.value);};
}
async function branchCompute(parent,options,onProgress,job){
  const fallback=()=>Branches.comparePair(parent,options,Core,async(y,end)=>{
    if(job.cancelled)throw new Error('Сравнение отменено.');onProgress(y,end);
  });
  if(typeof Worker!=='function')return fallback();
  let engine;
  try{
    const base=JSON.parse($('#worker-source').textContent);
    const code=base+'\nself.onmessage=async({data})=>{try {const pair=await Branches.comparePair(data.world,data.options,Core,(year,end)=>self.postMessage({year,end}));self.postMessage({pair});}catch(e){self.postMessage({failure:e.message});}};';
    const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
    try{engine=new Worker(url);}finally{URL.revokeObjectURL(url);}
  }catch{return fallback();}
  try{
    return await new Promise((resolve,reject)=>{
      job.cancel=()=>{job.cancelled=true;reject(new Error('Сравнение отменено.'));};
      engine.onerror=()=>reject(new Error('Расчёт пары прерван. Исходный мир доступен.'));
      engine.onmessage=({data})=>{
        if(data.failure)reject(new Error(data.failure));
        else if(data.pair)resolve(data.pair);
        else if(data.year!==undefined)onProgress(data.year,data.end);
      };
      engine.postMessage({world:parent,options});
    });
  }finally{engine.terminate();job.cancel=null;}
}
async function branchesClick(button) {
  const action=button.dataset.branches;
  if(!action)return false;
  try{
    if(action==='open'){branchesDialog();return true;}
    if(action==='inspect'){
      await branchInspect(Number(button.dataset.side),Number(button.dataset.sample),button.dataset.site);return true;
    }
    if(action==='report'){
      const side=Number(button.dataset.side),source=await branchSource(side),x=source.observatory.experiment;
      branchComparison(x,Number(button.dataset.sample),side);return true;
    }
    if(action==='focus'){
      const side=Number(button.dataset.side),index=Number(button.dataset.sample),site=button.dataset.site;
      const source=await branchSource(side),row=source.observatory.experiment.report.samples[index],point=row&&branchSnapshotAt(source,row[0]);
      if(!point||!source.regions.some(r=>r.id===site))throw new Error('Место или срез больше недоступны.');
      if(source.id!==world.id)await transition(()=>openLocal(source.id));
      snapshotIndex=point.index;resetEconomyPages();showRegionMap(site);
      notice(point.year===row[0]?'Открыт регион в выбранном году '+row[0]+'.':'Выбран год '+row[0]+'; открыт ближайший ранний срез '+point.year+'.');return true;
    }
    if(action==='discard'){
      if(branchJob){branchJob.cancelled=true;branchJob.cancel?.();}
      branchPreview=null;$('#dialog').close();return true;
    }
    if(action==='run'){
      if(branchJob||busy||switching||localConflict||snapshotIndex!==null)return true;
      const parent=world,mode=$('#twin-mode').value,horizon=Number($('#twin-end').value);
      const observedEdge=$('#twin-edge').value;
      const condition=mode==='none'?null:{edge:observedEdge,mode,until:Number($('#twin-until').value)};
      const job={cancelled:false};branchJob=job;
      try{
        const from=await persist();
        if(parent!==world||!from)throw new Error('Выбранный мир изменился.');
        modal('Сравнение миров','<p id="twin-progress" role="status">Подготовка полных точек…</p>'+branchBtn('discard','Отменить'));
        const close=()=>{job.cancelled=true;job.cancel?.();};
        $('#dialog').addEventListener('close',close,{once:true});
        let pair;
        try{pair=await branchCompute(parent,{condition,horizon,observedEdge,parentRevision:from.revision},(y,end)=>{
          const node=$('#twin-progress');if(node)node.textContent='Рассчитан год '+y+' из '+end+'.';
        },job);}finally{$('#dialog').removeEventListener('close',close);}
        if(job.cancelled||world!==parent)return true;
        branchPreview={pair,parentId:parent.id,revision:from.revision,bytes:pair.reduce((n,w)=>n+branchSize(w),0)};
        branchComparison(pair[0].observatory.experiment);
        $('#dialog').addEventListener('close',()=>{branchPreview=null;},{once:true});
      }finally{branchJob=null;}
      return true;
    }
    if(action==='commit'&&branchPreview){
      const preview=branchPreview;
      await transition(async()=>{
        if(world.id!==preview.parentId||revision!==preview.revision)throw new Error('Исходная ревизия изменилась. Повторите сравнение.');
        const [a]=await store.commitBranchPair(preview.parentId,preview.revision,preview.pair);
        const record=await store.get(a.id);
        selectRecord(record);scheduleSync();
      });
      branchPreview=null;branchComparison(world.observatory.experiment);return true;
    }
    const x=world.observatory?.experiment;
    if(x&&(action==='peer'||action==='parent')){
      const id=action==='peer'?x.peerId:x.parentId;
      await transition(()=>openLocal(id));
      if(action==='peer'&&world.observatory?.experiment?.report)branchComparison(world.observatory.experiment);
    }else if(action==='map'&&x?.report?.site){showRegionMap(x.report.site);}
  }catch(error){if(!branchJob?.cancelled)notice(error.message,error.name==='ConflictError');}
  return true;
}
