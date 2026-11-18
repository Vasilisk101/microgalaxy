// Optical and signal views share the camera. The event catalogue is derived only from the displayed year.
let showSignals=true;
function renderSignals(w){
 const choices=$$('[data-observer-mode]'),log=$('#signal-log');if(!log)return;
 for(const button of choices)button.setAttribute('aria-pressed',String((button.dataset.observerMode==='signals')===showSignals));
 const onHome=view==='planet'&&currentPlanet(w)?.home;
 const events=[];
 if(showSignals&&onHome){
  const count=Core.eventPageCount(w);
  for(let page=count-1;page>=0&&events.length<4;page--){
   const entries=Core.eventPage(w,page,{throughYear:w.year});
   for(let i=entries.length-1;i>=0&&events.length<4;i--){
    const e=entries[i];if(e.year<w.year-10){page=-1;break;}
    if(e.regionIds?.length)events.push(e);
   }
  }
 }
 const points=new Map();
 for(const event of events)for(const id of event.regionIds){
   const r=w.regions.find(region=>region.id===id);
   if(r&&!points.has(id))points.set(id,r);
 }
 renderer.signalRegions=[...points.values()];renderer.hideSignals=!showSignals;
 log.hidden=!onHome||!showSignals;
 log.innerHTML='<summary>Сигналы мест · '+events.length+'</summary>'+(events.length?events.map(e=>'<button data-event="'+h(e.id)+'">Год '+e.year+' · '+h(e.title)+'</button>').join(''):'<p>За последние десять лет в этом срезе нет событий с известным местом.</p>');
}
function observerModeClick(b){
 if(!b.dataset.observerMode)return false;
 showSignals=b.dataset.observerMode==='signals';render();return true;
}
