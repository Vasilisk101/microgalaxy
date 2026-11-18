// The codes and dates select two gallery visits. Rendering and records use the same
// engine as a visit to any player's own region. Gallery worlds stay in memory.
const PlaceVisit = (() => {
  const examples = {
    meander: {seed:'МЕАНДР-19', year:16},
    basin: {seed:'BASIN-6', year:30}
  };
  let visit = null;
  let returnAddress = null;
  function isDemoLink(){return Object.hasOwn(examples,new URLSearchParams(location.search).get('place')||'');}
  function setAddress(path){try{history.replaceState(null,'',path);}catch{/* Local file previews may disallow rewriting the path. */}}
  let sequence = 0;
  const dialog = () => document.getElementById('place-dialog');
  const pinKey = state => 'microgalaxy:v1:place:'+state.id;
  const sampleButtons = '<button data-place-sample="meander">МЕАНДР-19</button><button data-place-sample="basin">BASIN-6</button>';
  function entry() {
    return '<div class="place-entries"><span>Два мира крупным планом</span>'+sampleButtons+'</div>';
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
      timeline:visit.timeline, project, basin, liveYear:latest.year, demo, pinned:pref(pinKey(latest))===id,
      busy:working, message};
  }
  function updateState(latest,shown) {
    visit.latest = latest;
    visit.shown = shown;
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
  function start(latest,shown,id,demo) {
    visit = {latest,shown,id,demo,working:false,message:''};
    updateState(latest,shown);
    const host = dialog();
    if (!host.open) host.showModal();
    PlaceFocus.open(host,{get:viewData,onAction:action});
  }
  async function sample(key) {
    if (!Object.hasOwn(examples,key)) return;
    close();
    const current=new URL(location.href);
    returnAddress=isDemoLink()?current.pathname:current.pathname+current.search+current.hash;
    setAddress(current.pathname+'?place='+encodeURIComponent(key));
    const ticket=++sequence;
    setRunning(false);
    const host=dialog();
    host.innerHTML='<div class="place-loading" role="status">Открывается мир '+h(examples[key].seed)+'… <button data-place-dismiss>Закрыть</button></div>';
    host.showModal();
    try {
      await prepareWorker();
      if(ticket!==sequence)return;
      const {world:latest}=await waitTask({task:'example',...examples[key]});
      if (ticket!==sequence) return;
      start(latest,latest,PlaceRecords.placeSubject(latest,pref(pinKey(latest))),true);
    } catch(error) {
      if(ticket===sequence){close();notice(error.message);}
    }
  }
  function open(id) {
    if (busy || switching) return;
    if (!world) {
      modal('Два мира крупным планом',entry(),true);
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
    if(visit===v) updateState(v.latest,shown);
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
      const el=event.target.closest('[data-place-open],[data-place-sample],[data-place-dismiss]');
      if(!el)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(el.hasAttribute('data-place-dismiss'))close();
      else if(el.dataset.placeSample){if($('#dialog').open)$('#dialog').close();void sample(el.dataset.placeSample);}
      else open(el.dataset.placeOpen);
    },true);
    const key=new URLSearchParams(location.search).get('place');
    if(isDemoLink())void sample(key);
  }
  return {attach,entry,open,isDemoLink};
})();
