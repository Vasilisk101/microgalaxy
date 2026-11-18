// The codes and dates select two gallery visits. Rendering and records use the same
// engine as a visit to any player's own region. Gallery worlds stay in memory.
const PlaceVisit = (() => {
  const examples = {
    meander: {seed:'МЕАНДР-19', year:16},
    basin: {seed:'BASIN-6', year:30},
    harbor: {seed:'BASIN-6', year:30, regionId:'r15', focusKind:'harbor'},
    farmland: {seed:'МЕАНДР-19', year:8, regionId:'r48', focusKind:'fields'},
    mining: {seed:'ПЕРСЕИДЫ', year:30, regionId:'r15', focusKind:'mine'},
    quiet: {seed:'БЕРЕГ-132', era:'agriculture', year:350, regionId:'r15', focusKind:'terrain'}
  };
  let visit = null;
  let returnAddress = null;
  function isDemoLink(){return Object.hasOwn(examples,new URLSearchParams(location.search).get('place')||'');}
  function setAddress(path){try{history.replaceState(null,'',path);}catch{/* Local file previews may disallow rewriting the path. */}}
  let sequence = 0;
  const dialog = () => document.getElementById('place-dialog');
  const pinKey = state => 'microgalaxy:v1:place:'+state.id;
  const sampleButtons = '<button data-place-sample="meander">МЕАНДР-19</button><button data-place-sample="basin">BASIN-6</button>';
  function gallery() {
    return '<div class="place-entries"><span>Выбрать местность</span>'+
      '<button data-place-sample="harbor">Гавань Белура</button><button data-place-sample="farmland">Поля Белея</button>'+
      '<button data-place-sample="mining">Добывающий Мерон</button><button data-place-sample="quiet">Лес Нарона</button></div>'+
      '<div class="place-entries"><span>Проследить историю места</span>'+sampleButtons+'</div>';
  }
  function entry(){
    return '<div class="place-entries"><button data-place-gallery>Выбрать место на поверхности →</button></div>';
  }
  function waitTask(input) {
    if (!workerReady) {
      // This fallback does not give the simulation ownership of a saved world.
      return PlaceTime.perform(Core, PlaceRecords.placeRecords, input.world ? {...input,world:Core.clone(input.world)} : input, yieldFrame);
    }
    return new Promise((resolve,reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Расчёт места занял слишком много времени. Повторите наблюдение.'));
      }, 90000);
      pending.set(id, {resolve,reject,timer});
      try { worker.postMessage({type:'place', id, input}); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  function viewData() {
    const {shown,latest,id,demo,working,message} = visit;
    const region = shown.regions.find(item => item.id === id);
    const river = shown.observatory?.living?.basin;
    const basin = river && [river.upper,river.lower,river.alternate].includes(id) ? river : null;
    const project = basin?.project?.site === id ? basin.project : null;
    return {world:shown, region, label:PlaceRecords.placeName(shown,id), records:visit.records,
      timeline:visit.timeline, settlement:visit.settlement, focusKind:examples[visit.sampleKey]?.focusKind,
      project, basin, liveYear:latest.year, demo, pinned:pref(pinKey(latest))===id,
      busy:working, message};
  }
  function updateState(latest,shown) {
    visit.latest = latest;
    visit.shown = shown;
    const region=shown.regions.find(item=>item.id===visit.id);
    visit.settlement=SettlementView.describeSettlement(shown,region);
    visit.records = PlaceRecords.placeRecords(shown,visit.id);
    const available = shown === latest ? visit.records : PlaceRecords.placeRecords(latest,visit.id);
    visit.recordYears = [...new Set(available.map(item=>item.year))].sort((a,b)=>a-b);
    const beforeChanges=visit.recordYears.filter(year=>year>0).map(year=>year-1);
    visit.timeline = [...new Set([0,latest.year,shown.year,...visit.recordYears,...beforeChanges,...latest.snapshots.map(s=>s.year)])]
      .filter(year=>PlaceTime.canVisit(latest,year)).sort((a,b)=>a-b);
  }
  function close() {
    sequence++;
    if (visit) PlaceFocus.close();
    visit = null;
    if (dialog().open) dialog().close();
    if(returnAddress!==null){
      setAddress(returnAddress);
      returnAddress=null;
      startObservatory();
    }
  }
  function start(latest,shown,id,demo,sampleKey=null) {
    visit = {latest,shown,id,demo,sampleKey,working:false,message:''};
    updateState(latest,shown);
    const host = dialog();
    if (!host.open) host.showModal();
    PlaceFocus.open(host,{get:viewData,onAction:action});
  }
  function samplePath(key,year){
    const query=new URLSearchParams({place:key});
    if(Number.isSafeInteger(year)&&year>=0&&year<examples[key].year)query.set('year',year);
    return location.pathname+'?'+query;
  }
  async function sample(key,requestedYear=null) {
    if (!Object.hasOwn(examples,key)) return;
    close();
    const current=new URL(location.href);
    returnAddress=isDemoLink()?current.pathname:current.pathname+current.search+current.hash;
    setAddress(samplePath(key));
    const ticket=++sequence;
    setRunning(false);
    const host=dialog();
    host.innerHTML='<div class="place-loading" role="status">Открывается мир '+h(examples[key].seed)+'… <button data-place-dismiss>Закрыть</button></div>';
    host.showModal();
    try {
      await prepareWorker();
      if(ticket!==sequence)return;
      const example=examples[key];
      const {world:latest}=await waitTask({task:'example',seed:example.seed,year:example.year,era:example.era});
      if (ticket!==sequence) return;
      const target=PlaceRecords.placeSubject(latest,example.regionId);
      const year=requestedYear!==null&&/^\d+$/.test(requestedYear)?Number(requestedYear):latest.year;
      const shown=year!==latest.year&&PlaceTime.canVisit(latest,year)
        ? (await waitTask({task:'year',world:latest,year})).world : latest;
      if(ticket!==sequence)return;
      setAddress(samplePath(key,shown.year));
      start(latest,shown,target,true,key);
    } catch(error) {
      if(ticket===sequence){close();notice(error.message);}
    }
  }
  function open(id) {
    if (busy || switching) return;
    if (!world) {
      modal('Места на поверхности',gallery(),true);
      return;
    }
    const shown=displayed();
    const target=PlaceRecords.placeSubject(shown,id||pref(pinKey(world))||selectedRegion);
    if(!target)return;
    setRunning(false);
    if($('#dialog').open) $('#dialog').close();
    close();
    start(world,shown,target,false);
  }
  async function seeYear(v,year) {
    if(!v.timeline.includes(year))return;
    const shown=year===v.latest.year ? v.latest : (await waitTask({task:'year',world:v.latest,year})).world;
    if(visit===v){
      updateState(v.latest,shown);
      if(v.sampleKey)setAddress(samplePath(v.sampleKey,shown.year));
    }
  }
  async function advanceVisit(v) {
    const year=v.shown.year;
    const archived=v.recordYears.find(date=>date>year && PlaceTime.canVisit(v.latest,date));
    if(archived!==undefined){await seeYear(v,archived);return;}
    if(year<v.latest.year){
      await seeYear(v,v.latest.year);
      if(visit===v)v.message='До '+v.latest.year+' года новых доступных записей об этом месте нет.';
      return;
    }
    if(year>=Core.LIMITS.years){v.message='Достигнут последний год симуляции.';return;}
    if(!v.demo && (world!==v.latest || busy || switching || localConflict || sizeLimitWorld===world?.id || snapshotIndex!==null)){
      v.message='Откройте текущее состояние мира, чтобы продолжить наблюдение.';return;
    }
    const result=await waitTask({task:'next',world:v.latest,regionId:v.id});
    if(visit!==v)return;
    let next=result.world;
    if(!v.demo){
      if(world!==v.latest || busy || switching || localConflict){v.message='Состояние мира изменилось. Откройте место ещё раз.';return;}
      await step(next.year-year,false,null);
      if(visit!==v)return;
      if(world.year!==next.year){v.message='Мир остановился в '+world.year+' году.';updateState(world,world);return;}
      next=world;
    }
    updateState(next,next);
    if(!result.found)v.message='За '+(next.year-year)+' лет новых записей об этом месте нет. Можно продолжить наблюдение.';
  }
  async function action(type,value) {
    const v=visit;
    if(!v)return;
    if(type==='close'){close();return;}
    if(type==='pin'){
      const key=pinKey(v.latest);
      pref(key,pref(key)===v.id?'':v.id);
      PlaceFocus.refresh();return;
    }
    if(v.working)return;
    v.message='';v.working=true;PlaceFocus.refresh();
    try{
      if(type==='year')await seeYear(v,Number(value));
      else if(type==='next')await advanceVisit(v);
    }catch(error){if(visit===v)v.message=error.message;}
    finally{if(visit===v){v.working=false;PlaceFocus.refresh();}}
  }
  function attach() {
    dialog().addEventListener('cancel',event=>{event.preventDefault();close();});
    document.addEventListener('click',event=>{
      const el=event.target.closest('[data-place-open],[data-place-sample],[data-place-dismiss],[data-place-gallery]');
      if(!el)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(el.hasAttribute('data-place-gallery'))modal('Места на поверхности',gallery(),true);
      else if(el.hasAttribute('data-place-dismiss'))close();
      else if(el.dataset.placeSample){if($('#dialog').open)$('#dialog').close();void sample(el.dataset.placeSample);}
      else open(el.dataset.placeOpen);
    },true);
    const params=new URLSearchParams(location.search);
    if(isDemoLink())void sample(params.get('place'),params.get('year'));
  }
  return {attach,entry,open,isDemoLink};
})();
