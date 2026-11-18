// Opt-in measurements of normal website actions. Runs independently of the synthetic Worker benchmark.
const DeviceSession=(()=>{
  const key='microgalaxy-device-session/2/'+Core.MODEL_VERSION;
  let memory={visits:[],enabled:false},visit=null,selection=null,currentOpen=null,pageFrame=null,pointer=null;
  const now=()=>performance.now(), ms=n=>Math.round(n*10)/10;
  function read(){try{const v=JSON.parse(localStorage.getItem(key));if(v?.format===2&&Array.isArray(v.visits))return v;}catch{}return memory;}
  function put(data){memory=data;try{localStorage.setItem(key,JSON.stringify(data));}catch{}}
  function flush(){
    if(!visit)return;
    const data=read();if(!data.enabled)return;
    data.visits=data.visits.filter(v=>v.id!==visit.id).concat(visit).slice(-12);put(data);
  }
  function event(kind,details={}){
    if(!visit)return;
    visit.events.push({kind,atMs:ms(now()),...details});if(visit.events.length>400)visit.events.shift();
    flush();
  }
  function openVisit(mode){
    const nav=performance.getEntriesByType('navigation')[0];
    visit={id:crypto.randomUUID(),date:new Date().toISOString(),mode,device:read().device||null,pauseTargetMs:read().pauseTargetMs??null,
      browser:navigator.userAgent,viewport:[innerWidth,innerHeight],navigationType:nav?.type??null,
      model:Core.MODEL_VERSION,events:[],pauses:[]};
    const previous=read().visits.at(-1);
    if(previous)visit.previousVisit=previous.id;
    visit.expected=read().resume??null;selection=null;currentOpen=null;pageFrame=null;flush();
  }
  function enable(device,target){
    const data=read();data.format=2;data.enabled=true;data.device=String(device||'').trim().slice(0,100)||null;
    const value=Number(target);data.pauseTargetMs=Number.isFinite(value)&&value>0?value:null;
    put(data);openVisit('начато на открытой странице');
  }
  function next(mode){
    if(!['cold','warm'].includes(mode))return;
    const data=read();if(!data.enabled)return;
    data.next=mode;put(data);
  }
  function finish(){flush();const data=read();data.enabled=false;data.next=null;put(data);visit=null;}
  function configured(){return !!read().enabled;}
  if(read().enabled){
    const data=read(),mode=data.next??'обычная навигация';data.next=null;put(data);openVisit(mode);
  }
  function worldInfo(w,rev){return w?{id:w.id,seed:w.seed,era:w.era,year:w.year,revision:rev??null}:{};}
  function readResult(source,w,duration){
    if(!visit||!w)return;
    event('snapshot-read',{source,ms:ms(duration),...worldInfo(w)});
  }
  function validation(w,start,ok){if(visit)event('full-validation',{ms:ms(now()-start),ok,...worldInfo(w)});}
  function selecting(w,rev){
    if(!visit)return;
    selection=w;currentOpen={...worldInfo(w,rev),selectedAt:now(),drawn:false,painted:false};pageFrame=null;
    event('world-selected',worldInfo(w,rev));
    if(visit.expected&&!visit.events.some(e=>e.kind==='reopened'))event('reopened',{expected:visit.expected,actual:worldInfo(w,rev),
      sameWorld:visit.expected.id===w.id,sameYear:visit.expected.year===w.year});
  }
  function firstFrame(){
    if(!visit||!currentOpen?.drawn||currentOpen.painted||pageFrame||document.hidden)return;
    const target=currentOpen,which=visit;
    pageFrame=requestAnimationFrame(()=>requestAnimationFrame(()=>{
      pageFrame=null;
      if(visit!==which||currentOpen!==target||!target.drawn||target.painted||document.hidden||switching||busy||
        !world||world.id!==target.id||view!=='planet'||document.querySelector('#visual')?.hidden||
        document.querySelector('#dialog')?.open||document.querySelector('#mobile-object')?.disabled)return;
      target.painted=true;event('globe-interactive',{...worldInfo(world,revision),navigationMs:ms(now()),afterSelectionMs:ms(now()-target.selectedAt)});
      const capture=selection;
      setTimeout(async()=>{
        if(visit!==which||selection!==capture)return;
        const {id,...content}=capture,text=JSON.stringify(capture),size=new TextEncoder().encode(text).length;
        const fingerprint=await Storage.digest(JSON.stringify(content));
        if(visit===which)event('snapshot-size',{...worldInfo(capture,target.revision),jsonBytes:size,contentSHA256:fingerprint});
      },0);
    }));
  }
  function bindRenderer(r){
    const original=r.update;
    r.update=function(w,mode,...args){
      if(!visit||w!==selection||mode!=='planet'||currentOpen?.drawn)return original.call(this,w,mode,...args);
      const start=now(),result=original.call(this,w,mode,...args);
      currentOpen.drawn=true;event('globe-prepare',{...worldInfo(w,currentOpen.revision),ms:ms(now()-start)});firstFrame();return result;
    };
    r.canvas.addEventListener('pointerdown',()=>{if(visit&&currentOpen?.painted&&view==='planet')pointer={angle:r.rotation,id:world?.id};});
    r.canvas.addEventListener('pointerup',()=>{if(pointer&&visit&&pointer.id===world?.id&&r.rotation!==pointer.angle)event('globe-rotated',worldInfo(world,revision));pointer=null;});
    r.canvas.addEventListener('pointercancel',()=>{pointer=null;});
  }
  function pause(press){
    if(!visit||!world)return;
    const selected=visit,info=worldInfo(world,revision),start=Number.isFinite(press)&&press>=0&&press<=now()?press:now();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(visit!==selected||document.hidden||running||world?.id!==info.id)return;
      visit.pauses.push({...info,ms:ms(now()-start),atMs:ms(now())});
      if(visit.pauses.length>150)visit.pauses.shift();flush();
    }));
  }
  function background(hidden,w,rev,wasRunning){
    if(!visit)return;
    event(hidden?'hidden':'visible',{...worldInfo(w,rev),wasRunning,paused:!running});
  }
  function savedBackground(w,rev,ok){
    if(!visit)return;event('background-save',{...worldInfo(w,rev),ok});
    if(ok&&w){const data=read();data.resume=worldInfo(w,rev);put(data);}
  }
  function pageHide(){
    if(!visit)return;const info=worldInfo(world,revision);
    event('pagehide',{...info,unsaved:localUnsaved,conflict:localConflict});
    if(world&&!localUnsaved&&!localConflict){const data=read();data.resume=info;put(data);}
  }
  window.addEventListener('pagehide',pageHide);
  function report(){
    const data=read(),groups=new Map();
    for(const v of data.visits)for(const p of v.pauses){
      const k=JSON.stringify([v.id,p.id]);if(!groups.has(k))groups.set(k,{visit:v.id,seed:p.seed,worldId:p.id,years:[],samples:[]});
      const g=groups.get(k);g.years.push(p.year);g.samples.push(p.ms);
    }
    const pauseSeries=[...groups.values()].map(g=>{const sorted=g.samples.slice().sort((a,b)=>a-b);return {...g,n:sorted.length,
      p95Ms:sorted.length>=20?sorted[Math.ceil(.95*sorted.length)-1]:null,minimumSamples:20};});
    return {format:'microgalaxy-device-session/2',model:Core.MODEL_VERSION,device:data.device??null,visits:data.visits,
      pauseSeries,units:'ms',pauseMethod:'Обычная кнопка паузы до второго requestAnimationFrame. P95 по ближайшему верхнему рангу, не менее 20 на одну историю и запуск.',
      launchMethod:'cold/warm выбирает наблюдатель. Тип навигации фиксируется браузером; состояние его кеша сайт не определяет.'};
  }
  return {enable,next,finish,configured,event,readResult,validation,selecting,bindRenderer,firstFrame,pause,background,savedBackground,report,
    get active(){return !!visit;}};
})();
