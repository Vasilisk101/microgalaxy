'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Archive, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Crosshair, Download, Globe2, Layers3, LoaderCircle, Maximize, Orbit, Pause, Play, Plus, Radio, Save, Search, Settings2, Shuffle, SkipForward, Telescope, Upload, Users, Volume2, VolumeX, X } from 'lucide-react';
import { createWorld, getEra, getWorldStats, validateWorld, MAX_YEAR, type World, type WorldEvent, type HistoryPoint } from '@/lib/simulation';
import { getLocalWorld, getLocalWorlds, indexLocalWorldMetadata, saveLocalWorld, preserveLocalWorld, releaseLocalWorld, type LocalWorld, type LocalWorldCatalogueEntry } from '@/lib/local-worlds';
import { releaseCloudWorld } from '@/lib/retention-client.mjs';
import { disposeSound, setSound, signalSound } from '@/lib/sound';
import { worldApi } from '@/lib/world-api';

import SimulationWorker from '../lib/simulation-worker.ts?worker';

const CosmosScene = lazy(() => import('@/components/CosmosScene'));
type View = 'system' | 'planet' | 'societies' | 'chronicle';
type Layer = 'natural' | 'political' | 'climate';
type Summary = { id: string; name: string; seed: string; year: number; population: number; era: string; revision: number; updatedAt: string; local?: boolean; metadataPending?: boolean };
type CloudSnapshot = { world: World; revision: number; updatedAt: string; error?: string };
type CloudPage = { worlds: Summary[]; nextCursor: string | null; error?: string };
const formats = { number: new Intl.NumberFormat('ru-RU'), compact: new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }), decimal: new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }) };
const kinds = { rocky: 'Каменистая планета', ocean: 'Океанический мир', desert: 'Пустынная планета', gas: 'Газовый гигант', ice: 'Ледяной мир' };
const eventKinds: Record<string,string> = { origin: 'Начало истории', climate: 'Природа', society: 'Общества', science: 'Наука', conflict: 'Конфликты', space: 'Космос' };
const fmt = (n: number) => formats.number.format(Math.round(n));
const compact = (n: number) => formats.compact.format(n);
const dec = (n: number) => formats.decimal.format(n);
const plural = (n:number,one:string,few:string,many:string) => n%10===1&&n%100!==11?one:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?few:many;
function randomSeed() { return Array.from(crypto.getRandomValues(new Uint16Array(2)), n => n.toString(36).padStart(3, '0')).join('-').toUpperCase(); }
function summaryOf(record: LocalWorld): Summary { const s=getWorldStats(record.world); return { id: record.world.id,name:record.world.name,seed:record.world.seed,year:record.world.year,population:s.population,era:s.era,revision:record.revision,updatedAt:record.updatedAt,local:record.revision===0||record.world.year>record.syncedYear }; }
function catalogSummary(entry:LocalWorldCatalogueEntry):Summary {return entry.summary??{id:entry.id,name:'Прежнее сохранение',seed:'',year:0,population:0,era:'',revision:0,updatedAt:'',local:true,metadataPending:true};}
function preference(name: string, value?: string): string | null { try { if(value!==undefined) localStorage.setItem('microgalaxy:'+name,value);return localStorage.getItem('microgalaxy:'+name); } catch { return null; } }

function Mark({ small=false }: {small?:boolean}) {
  return <svg className={small?'orbit-mark small':'orbit-mark'} viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="5.5"/><ellipse cx="20" cy="20" rx="18" ry="8" transform="rotate(-35 20 20)"/><circle className="mark-satellite" cx="33.6" cy="11" r="2.3"/></svg>;
}
function Modal({title,children,onClose,wide=false,dismissible=true}: {title:string;children:ReactNode;onClose:()=>void;wide?:boolean;dismissible?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement;
    const buttons=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')||[]).filter(el=>!(el as HTMLButtonElement).disabled);
    buttons()[0]?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&dismissible)onClose();if(e.key==='Tab'){const items=buttons(),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};
  },[onClose,dismissible]);
  return <div className="modal-shade" onMouseDown={e=>{if(dismissible&&e.target===e.currentTarget)onClose();}}><div ref={ref} className={'modal '+(wide?'wide':'')} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2>{dismissible&&<button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={18}/></button>}</header>{children}</div></div>;
}
function Metric({label,value,unit}: {label:string;value:string;unit?:string}) {return <div className="metric"><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>;}
function HistoryChart({history,field='population'}:{history:HistoryPoint[];field?:'population'|'tech'|'temperature'}) {
  const samples=history.length>1?history:[...history,...history];
  if(!samples.length)return <div className="empty-chart">История начнётся с первого года наблюдения</div>;
  const values=samples.map(s=>s[field]);const low=Math.min(...values)*.95,high=Math.max(...values)*1.05;
  const span=high-low||1;const timeSpan=samples.at(-1)!.year-samples[0].year||1;const d=samples.map((s,i)=>`${i?'L':'M'}${((s.year-samples[0].year)/timeSpan*500).toFixed(1)},${(110-(s[field]-low)/span*90).toFixed(1)}`).join(' ');
  return <div className="history-graph"><div className="chart-labels"><span>{field==='population'?'Население мира':field==='tech'?'Уровень технологий':'Температура'}</span><span>{field==='population'?compact(values.at(-1)||0):dec(values.at(-1)||0)}</span></div><svg viewBox="0 0 500 130" role="img" aria-label="Динамика показателя за сохранённую историю"><path className="chart-grid" d="M0 25H500M0 65H500M0 105H500"/><path className="chart-fill" d={d+' L500,130 L0,130Z'}/><path className="chart-line" d={d}/></svg><div className="chart-years"><span>Год {fmt(samples[0].year)}</span><span>{fmt(samples.at(-1)!.year)}</span></div></div>;
}

export default function SimulationApp() {
  const [world,setWorld]=useState<World|null>(null);
  const worldRef=useRef<World|null>(null);
  const [view,setView]=useState<View>('planet');
  const [selectedPlanet,setSelectedPlanet]=useState('');
  const [selectedSociety,setSelectedSociety]=useState<string>();
  const [selectedEvent,setSelectedEvent]=useState<WorldEvent|null>(null);
  const [layer,setLayer]=useState<Layer>('natural');
  const [playing,setPlaying]=useState(false);
  const [speed,setSpeed]=useState(1);
  const [autoPause,setAutoPause]=useState(true);
  const [busy,setBusy]=useState(false);
  const [sound,setSoundEnabled]=useState(true);
  const [preferencesLoaded,setPreferencesLoaded]=useState(false);
  const [focus,setFocus]=useState(0);
  const [immersive,setImmersive]=useState(false);
  const [mobileDetails,setMobileDetails]=useState(false);
  const [modal,setModal]=useState<'new'|'archive'|'about'|'conflict'|null>(null);
  const [seed,setSeed]=useState('');
  const [epoch,setEpoch]=useState<'agrarian'|'industrial'>('agrarian');
  const [creating,setCreating]=useState(false);
  const [archive,setArchive]=useState<Summary[]>([]);
  const [archiveBusy,setArchiveBusy]=useState(false);
  const [archiveCursor,setArchiveCursor]=useState<string|null>(null);
  const [archiveLoadingMore,setArchiveLoadingMore]=useState(false);
  const [conflictSource,setConflictSource]=useState<'local'|'cloud'>('cloud');
  const [filter,setFilter]=useState('all');
  const [query,setQuery]=useState('');
  const [toast,setToast]=useState('');
  const [saveStatus,setSaveStatus]=useState<'pending'|'saving'|'cloud'|'local'|'error'>('pending');
  const [lastSaved,setLastSaved]=useState('');
  const [workerError,setWorkerError]=useState(false);
  const [bootIssue,setBootIssue]=useState('');
  const worker=useRef<Worker|null>(null), busyRef=useRef(false), sequence=useRef(0);
  const switching=useRef(false);
  const revision=useRef(0), syncedYear=useRef(-1), cloudReady=useRef(false), conflictRef=useRef(false);
  const savePromise=useRef<Promise<boolean>|null>(null), saveRef=useRef<(manual?:boolean)=>Promise<boolean>>(async()=>false);
  const localSavePromise=useRef<Promise<boolean>|null>(null);
  const checkpointRef=useRef<()=>Promise<boolean>>(async()=>false);
  const checkpointTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const recoveryId=useRef<string|undefined>(undefined);
  const importRef=useRef<HTMLInputElement>(null);
  const soundRef=useRef(true),autoPauseRef=useRef(true);
  const notify=useCallback((message:string)=>setToast(message),[]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(t);}},[toast]);
  useEffect(()=>{setSoundEnabled(preference('sound')!=='off');setPreferencesLoaded(true);},[]);
  useEffect(()=>{if(preferencesLoaded){soundRef.current=sound;preference('sound',sound?'on':'off');}},[sound,preferencesLoaded]);
  useEffect(()=>{autoPauseRef.current=autoPause;},[autoPause]);
  const closeModal=useCallback(()=>setModal(conflictRef.current?'conflict':null),[]);

  const installWorld=useCallback((record:LocalWorld)=>{
    setPlaying(false);busyRef.current=false;setBusy(false);sequence.current++;
    worldRef.current=record.world;revision.current=record.revision;syncedYear.current=record.syncedYear;
    conflictRef.current=false;recoveryId.current=undefined;setWorld(record.world);setSelectedPlanet(record.world.homePlanetId);
    setSelectedEvent(null);setSelectedSociety(undefined);setView('planet');setLayer('natural');setFocus(n=>n+1);
    preference('active-world',record.world.id);
    worker.current?.postMessage({type:'load',world:record.world,id:sequence.current});
    setSaveStatus(record.revision>0&&record.syncedYear===record.world.year?'cloud':'local');
    setLastSaved(record.updatedAt);
  },[]);

  useEffect(()=>{
    const w=new SimulationWorker();worker.current=w;
    w.onmessage=(e)=>{
      const m=e.data;if(m.id!==sequence.current)return;
      if(m.type==='state'){
        busyRef.current=false;setBusy(false);
        if(m.world.id!==worldRef.current?.id)return;
        worldRef.current=m.world;setWorld(m.world);setSaveStatus(m.world.year>syncedYear.current?'pending':'cloud');
        if(m.stopped){setPlaying(false);if(m.stopped==='important'){signalSound();notify('Важное событие — время приостановлено');}else if(m.stopped==='limit')notify('Достигнута граница первой модели: 10 000 лет');else if(m.stopped==='none')notify('За 500 лет подходящих событий не обнаружено');}
        if(m.advanced===0)setPlaying(false);
        if(document.hidden)void checkpointRef.current();
      }else if(m.type==='error'){busyRef.current=false;setBusy(false);setPlaying(false);notify(m.error||'Расчёт остановлен');}
    };
    w.onerror=()=>{setWorkerError(true);setPlaying(false);busyRef.current=false;setBusy(false);notify('Не удалось запустить расчёт. Перезагрузите страницу.');};
    if(worldRef.current)w.postMessage({type:'load',world:worldRef.current,id:sequence.current});
    return()=>{w.terminate();worker.current=null;disposeSound();};
  },[notify]);

  useEffect(()=>{
    let active=true;
    const boot=async()=>{
      let locals:LocalWorldCatalogueEntry[]=[];try{locals=await getLocalWorlds();}catch(error){if(active)setBootIssue(error instanceof Error?error.message:'Не удалось прочитать локальный каталог');return;}
      const query=new URLSearchParams(window.location.search),requestedId=query.get('world'),source=query.get('source')??'auto';
      if(query.has('world')){
        try{
          if(!requestedId||!/^(?:local-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)||!['auto','cloud','local'].includes(source))throw new Error('Неверная ссылка на сохранённый мир');
          const listed=locals.some(record=>record.id===requestedId),local=listed?await getLocalWorld(requestedId):null;
          if(listed&&!local)throw new Error('Выбранная локальная история недоступна; новый мир не создан');
          let selected=source==='cloud'?null:local??null;
          if(!selected&&source!=='local'){
            const response=await worldApi<CloudSnapshot>('/api/worlds/'+encodeURIComponent(requestedId),{cache:'no-store'},4000);
            if(!response.ok||!validateWorld(response.data.world)||response.data.world.id!==requestedId)throw new Error('Не удалось открыть выбранную облачную историю');
            const remote=response.data;cloudReady.current=true;
            const saved=await saveLocalWorld({world:remote.world,revision:remote.revision,updatedAt:remote.updatedAt,syncedYear:remote.world.year},{replace:true,preserveReplaced:true});
            selected=saved.record;
            if('recovery' in saved&&saved.recovery&&active)notify('Местная история сохранена отдельной копией');
          }
          if(!selected)throw new Error('Выбранного мира нет на этом устройстве');
          if(active)installWorld(selected);
        }catch(error){if(active)setBootIssue(error instanceof Error?error.message:'Не удалось открыть выбранный мир');}
        return;
      }
      const last=preference('active-world');
      const remembered=locals.find(x=>x.id===last),first=remembered??locals[0];
      let chosen:LocalWorld|null=null;
      if(first){try{chosen=await getLocalWorld(first.id);if(!chosen)throw new Error('Сохранённый мир недоступен; новая история не создана');}catch(error){if(active)setBootIssue(error instanceof Error?error.message:'Не удалось открыть сохранение');return;}}
      try{
        const response=await worldApi<CloudPage>('/api/worlds',{cache:'no-store'},4000);
        if(response.ok){
          cloudReady.current=true;
          const targetId=remembered?.id||response.data.worlds.find(x=>x.id===last)?.id||response.data.worlds[0]?.id;
          if(targetId){
            const local=chosen?.world.id===targetId?chosen:locals.some(x=>x.id===targetId)?await getLocalWorld(targetId):null;
            if(locals.some(x=>x.id===targetId)&&!local)throw new Error('Локальная история недоступна');
            const r=await worldApi<CloudSnapshot>('/api/worlds/'+targetId,{cache:'no-store'},4000);
            if(r.ok&&validateWorld(r.data.world)&&r.data.world.id===targetId){
              const server=r.data;
              if(local&&local.revision===server.revision&&local.world.year>=server.world.year)chosen=local;
              else{
                const saved=await saveLocalWorld({world:server.world,revision:server.revision,updatedAt:server.updatedAt,syncedYear:server.world.year},{replace:true,preserveReplaced:true});
                chosen=saved.record;
                if('recovery' in saved&&saved.recovery&&active)notify('Несинхронизированная история сохранена отдельным миром');
              }
            }
          }
        }
      }catch{}
      if(!chosen){try{const fresh=createWorld(randomSeed(),{id:crypto.randomUUID(),epoch:'agrarian'});const saved=await saveLocalWorld({world:fresh,revision:0,syncedYear:-1,updatedAt:new Date().toISOString()});chosen=saved.record;}catch(error){if(active)setBootIssue(error instanceof Error?error.message:'Не удалось сохранить новую систему');return;}}
      if(active)installWorld(chosen);
    };
    void boot();return()=>{active=false;};
  },[installWorld,notify]);

  const checkpoint=useCallback(async():Promise<boolean>=>{
    while(localSavePromise.current)await localSavePromise.current;
    const snapshot=worldRef.current;if(!snapshot)return false;
    const record={world:snapshot,revision:revision.current,syncedYear:syncedYear.current,updatedAt:new Date().toISOString()};
    const task=(async()=>{
      try{
        const result=await preserveLocalWorld(record,recoveryId.current);
        if(worldRef.current?.id===snapshot.id){
          if(result.status==='recovered'){
            recoveryId.current=result.record.world.id;conflictRef.current=true;
            setConflictSource('local');setPlaying(false);setModal('conflict');setSaveStatus('error');
          }else{
            revision.current=Math.max(revision.current,result.record.revision);
            syncedYear.current=Math.max(syncedYear.current,result.record.syncedYear);
            setLastSaved(result.record.updatedAt);
          }
        }
        return true;
      }catch{setSaveStatus('error');return false;}
    })();
    localSavePromise.current=task;
    try{return await task;}finally{if(localSavePromise.current===task)localSavePromise.current=null;}
  },[]);
  checkpointRef.current=checkpoint;

  const persist=useCallback((manual=false):Promise<boolean>=>{
    if(savePromise.current)return savePromise.current;
    const task=(async()=>{
      const localOK=await checkpoint();
      const snapshot=worldRef.current;if(!snapshot)return false;
      const oldRevision=revision.current;
      if(!localOK)notify('Локальная копия недоступна. Проверяю облачное сохранение.');
      if(conflictRef.current){setModal('conflict');return false;}
      if(oldRevision>0&&snapshot.year===syncedYear.current){setSaveStatus('cloud');if(manual)notify('Мир сохранён');return true;}
      setSaveStatus('saving');
      try{
        const response=await worldApi<{revision:number;updatedAt:string;error?:string}>(oldRevision>0?'/api/worlds/'+snapshot.id:'/api/worlds',{method:oldRevision>0?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(oldRevision>0?{world:snapshot,revision:oldRevision}:{world:snapshot})});
        if(response.status===409){conflictRef.current=true;setConflictSource('cloud');setPlaying(false);setModal('conflict');setSaveStatus('error');return false;}
        if(!response.ok)throw new Error(response.status===401?'Войдите в аккаунт для облачного сохранения':response.data.error||'Облачное сохранение недоступно');
        const result=response.data;cloudReady.current=true;
        if(worldRef.current?.id===snapshot.id){
          revision.current=result.revision;syncedYear.current=snapshot.year;
          setSaveStatus(worldRef.current.year===snapshot.year?'cloud':'pending');setLastSaved(result.updatedAt);
          await checkpoint();
        }
        if(conflictRef.current){setModal('conflict');return false;}
        if(manual)notify('Мир сохранён в облаке');return true;
      }catch(error){
        if(conflictRef.current){setSaveStatus('error');setModal('conflict');return false;}
        setSaveStatus(localOK?'local':'error');
        if(manual)notify(localOK?'Копия сохранена на этом устройстве. Облако пока недоступно.':(error instanceof Error?error.message:'Не удалось сохранить мир'));
        return localOK;
      }
    })();savePromise.current=task;void task.finally(()=>{savePromise.current=null;});return task;
  },[checkpoint,notify]);
  saveRef.current=persist;

  useEffect(()=>{
    if(!world||checkpointTimer.current!==null)return;
    checkpointTimer.current=setTimeout(()=>{checkpointTimer.current=null;void checkpointRef.current();},900);
  },[world]);
  useEffect(()=>()=>{if(checkpointTimer.current!==null)clearTimeout(checkpointTimer.current);},[]);
  useEffect(()=>{if(!world?.id)return;const first=setTimeout(()=>void persist(),1800);const timer=setInterval(()=>void persist(),18000);return()=>{clearTimeout(first);clearInterval(timer);};},[world?.id,persist]);
  useEffect(()=>{
    const hide=()=>{if(document.hidden){setPlaying(false);setSound(false);void checkpointRef.current();void saveRef.current();}};
    const leave=()=>{setPlaying(false);void checkpointRef.current();};
    document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
    return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};
  },[]);

  const advance=useCallback((years:number,untilEvent=false)=>{
    if(!worker.current||busyRef.current||switching.current||!worldRef.current||conflictRef.current||worldRef.current.year>=MAX_YEAR)return;
    busyRef.current=true;setBusy(true);sequence.current++;
    worker.current.postMessage({type:'advance',years,untilEvent,autoPause:autoPauseRef.current,id:sequence.current});
  },[]);
  const togglePlay=useCallback(()=>{if(conflictRef.current){setModal('conflict');return;}if(workerError||switching.current||!worldRef.current||worldRef.current.year>=MAX_YEAR)return;if(soundRef.current)setSound(true);setPlaying(p=>!p);},[workerError]);
  useEffect(()=>{if(!playing)return;let bank=0;const interval=setInterval(()=>{if(document.hidden||busyRef.current)return;bank+=speed/4;if(bank>=1){const years=Math.floor(bank);bank-=years;advance(years);}},250);return()=>clearInterval(interval);},[playing,speed,advance]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(modal||e.repeat||(e.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable="true"]'))return;if(e.code==='Space'){e.preventDefault();togglePlay();}if(e.key==='Escape'){setImmersive(false);setSelectedEvent(null);}if(e.key==='1')setSpeed(1);if(e.key==='2')setSpeed(10);if(e.key==='3')setSpeed(50);};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[modal,togglePlay]);

  const quiesce=async()=>{
    setPlaying(false);
    const started=Date.now();
    while(busyRef.current){if(Date.now()-started>15000)throw new Error('Дождитесь завершения расчёта и повторите');await new Promise(resolve=>setTimeout(resolve,20));}
    if(savePromise.current)await savePromise.current;
    if(localSavePromise.current)await localSavePromise.current;
  };
  const openNew=()=>{if(conflictRef.current){setModal('conflict');return;}setPlaying(false);setSeed(randomSeed());setEpoch('agrarian');setModal('new');};
  const installAfterSave=async(record:LocalWorld)=>{
    const old=worldRef.current, saved=!!old&&!conflictRef.current&&await checkpoint(),safe=saved&&!conflictRef.current;
    const cloudClean=!!old&&revision.current>0&&syncedYear.current>=old.year&&!savePromise.current;
    installWorld(record);
    if(safe&&old&&old.id!==record.world.id){try{await releaseLocalWorld(old.id);}catch{/* Keep protection on release failure. */}if(cloudClean)try{await releaseCloudWorld('classic',old.id);}catch{/* Keep conservative server protection on failure. */}}
  };
  const newWorld=async()=>{
    if(!seed.trim()||/[\u0000-\u001f]/.test(seed)||switching.current)return;switching.current=true;setCreating(true);
    try{
      await quiesce();
      if(worldRef.current&&!await persist())throw new Error(conflictRef.current?'Сначала выберите, какую историю продолжить.':'Не удалось сохранить текущий мир. Новый запуск отменён.');
      const fresh=createWorld(seed.trim(),{epoch,id:crypto.randomUUID()});
      const record={world:fresh,revision:0,syncedYear:-1,updatedAt:new Date().toISOString()};
      const saved=await saveLocalWorld(record);if(saved.status==='superseded')throw new Error('Не удалось сохранить новую систему. Повторите запуск.');await installAfterSave(saved.record);setModal(null);notify('Новая система создана. Наблюдение на паузе.');if(sound)setSound(true);
    }catch(error){notify(error instanceof Error?error.message:'Не удалось сохранить новую систему');}finally{setCreating(false);switching.current=false;}
  };
  const refreshArchive=async()=>{
    setArchiveBusy(true);setArchiveCursor(null);const merged=new Map<string,Summary>();
    try{for(const r of await getLocalWorlds())merged.set(r.id,catalogSummary(r));}catch{}
    try{const r=await worldApi<CloudPage>('/api/worlds',{cache:'no-store'},4000);if(r.ok){cloudReady.current=true;for(const s of r.data.worlds){const local=merged.get(s.id);if(!local||s.revision>local.revision||s.year>local.year)merged.set(s.id,s);}setArchiveCursor(r.data.nextCursor);}}catch{}
    if(worldRef.current)merged.set(worldRef.current.id,summaryOf({world:worldRef.current,revision:revision.current,syncedYear:syncedYear.current,updatedAt:new Date().toISOString()}));
    setArchive([...merged.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));setArchiveBusy(false);
    setTimeout(()=>{void (async()=>{try{await indexLocalWorldMetadata(2);const entries=await getLocalWorlds();setArchive(previous=>{const next=new Map(previous.map(item=>[item.id,item]));for(const entry of entries){const old=next.get(entry.id);if(!old||old.metadataPending)next.set(entry.id,catalogSummary(entry));}return [...next.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));});}catch{/* Leave explicitly unindexed entries visible. */}})();},0);
  };
  const loadMoreArchive=async()=>{
    if(!archiveCursor||archiveLoadingMore)return;setArchiveLoadingMore(true);
    try{
      const response=await worldApi<CloudPage>('/api/worlds?cursor='+encodeURIComponent(archiveCursor),{cache:'no-store'},4000);
      if(!response.ok)throw new Error(response.data.error||'Не удалось загрузить следующую страницу');
      setArchive(previous=>{
        const merged=new Map(previous.map(item=>[item.id,item]));
        for(const item of response.data.worlds){const local=merged.get(item.id);if(!local||item.revision>local.revision||item.year>local.year)merged.set(item.id,item);}
        return [...merged.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      });setArchiveCursor(response.data.nextCursor);
    }catch(error){notify(error instanceof Error?error.message:'Не удалось загрузить остальные миры');}finally{setArchiveLoadingMore(false);}
  };
  const openArchive=async()=>{
    if(switching.current)return;if(conflictRef.current){setModal('conflict');return;}
    switching.current=true;setPlaying(false);setModal('archive');setArchiveBusy(true);
    try{await quiesce();await checkpoint();await refreshArchive();}
    catch(error){setArchiveBusy(false);notify(error instanceof Error?error.message:'Не удалось открыть архив');}
    finally{switching.current=false;}
  };
  const loadWorld=async(id:string,source:'auto'|'cloud'|'local'='auto')=>{
    if(switching.current)return;switching.current=true;setCreating(true);setPlaying(false);
    try{
      await quiesce();
      if(source==='auto'){
        if(!await persist())throw new Error(conflictRef.current?'Сначала выберите, какую историю продолжить.':'Не удалось сохранить текущий мир');
      }else if(!await checkpoint())throw new Error('Не удалось сохранить текущую историю на устройстве');
      const local=await getLocalWorld(id).catch(()=>null);let chosen=source==='cloud'?null:local;let fromCloud=false;
      if(source!=='local'){
        try{
          const response=await worldApi<CloudSnapshot>('/api/worlds/'+id,{cache:'no-store'});
          if(response.ok){
            const data=response.data;if(!validateWorld(data.world))throw new Error('Формат сохранения не поддерживается');
            if(source==='cloud'||!local||local.revision!==data.revision||local.world.year<data.world.year){
              chosen={world:data.world,revision:data.revision,syncedYear:data.world.year,updatedAt:data.updatedAt};fromCloud=true;
            }
          }else if(source==='cloud')throw new Error('Не удалось загрузить облачную версию');
        }catch(error){if(source==='cloud')throw error;}
      }
      if(!chosen)throw new Error('Не удалось загрузить мир');
      const saved=await saveLocalWorld(chosen,{replace:fromCloud,preserveReplaced:fromCloud});
      await installAfterSave(saved.record);setModal(null);notify('recovery' in saved&&saved.recovery?'Сохранённый мир открыт. Локальная история сохранена отдельной копией.':'Наблюдение восстановлено');
    }catch(error){notify(error instanceof Error?error.message:'Не удалось загрузить мир');}finally{setCreating(false);switching.current=false;}
  };
  const forkConflict=async()=>{
    if(!worldRef.current||switching.current)return;switching.current=true;setCreating(true);
    try{await quiesce();if(!await checkpoint())throw new Error('Локальная копия недоступна');const fork={...worldRef.current!,id:recoveryId.current||crypto.randomUUID()};const record={world:fork,revision:0,syncedYear:-1,updatedAt:new Date().toISOString()};const saved=await saveLocalWorld(record);installWorld(saved.record);setModal(null);notify('Текущая история сохранена отдельным миром');}
    catch{notify('Не удалось сохранить отдельную копию. Исходная история остаётся открытой.');}finally{switching.current=false;setCreating(false);}
  };
  const exportWorld=()=>{
    if(!worldRef.current)return;const w=worldRef.current;
    const blob=new Blob([JSON.stringify(w,null,2)],{type:'application/json'});const a=document.createElement('a');const url=URL.createObjectURL(blob);
    a.href=url;a.download=`microgalaxy-${w.seed.replace(/[^a-z0-9-]/gi,'_')}-year-${w.year}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const importWorld=async(file?:File)=>{
    if(!file||switching.current)return;if(file.size>4*1024*1024){notify('Файл слишком большой: максимум 4 МБ');return;}
    switching.current=true;setCreating(true);
    try{const value=JSON.parse(await file.text());if(!validateWorld(value))throw new Error('Это сохранение другой версии или файл повреждён');await quiesce();if(!await persist())throw new Error('Не удалось сохранить текущий мир');
      const imported={...value,id:crypto.randomUUID()};const record={world:imported,revision:0,syncedYear:-1,updatedAt:new Date().toISOString()};const saved=await saveLocalWorld(record);if(saved.status==='superseded')throw new Error('Не удалось сохранить импортированную копию');await installAfterSave(saved.record);setModal(null);notify('Мир импортирован отдельной копией');
    }catch(error){notify(error instanceof Error?error.message:'Не удалось открыть файл');}finally{switching.current=false;setCreating(false);}
  };
  const openEvent=(event:WorldEvent)=>{setSelectedEvent(event);if(event.planetId)setSelectedPlanet(event.planetId);setSelectedSociety(event.societyId);setMobileDetails(true);};
  const selectPlanet=(id:string)=>{setSelectedPlanet(id);setSelectedEvent(null);setSelectedSociety(undefined);setFocus(n=>n+1);};
  const stats=useMemo(()=>world?getWorldStats(world):null,[world]);
  const planet=world?.planets.find(p=>p.id===selectedPlanet)||world?.planets.find(p=>p.id===world.homePlanetId);
  const society=world?.societies.find(s=>s.id===selectedSociety);
  const planetSocieties=world?.societies.filter(s=>s.planetId===planet?.id)||[];
  const planetPopulation=planetSocieties.reduce((n,s)=>n+s.population,0);
  const planetTech=planetPopulation?planetSocieties.reduce((n,s)=>n+s.tech*s.population,0)/planetPopulation:0;
  const events=useMemo(()=>world?[...world.events].reverse().filter(e=>(filter==='all'||e.type===filter)&&(!query||(e.title+' '+e.description).toLowerCase().includes(query.toLowerCase()))):[],[world,filter,query]);
  const seedError=/[\u0000-\u001f]/.test(seed)?'Код мира не должен содержать табуляцию и служебные символы.':'';
  const preview=useMemo(()=>{try{return seed.trim()&&!/[\u0000-\u001f]/.test(seed)?createWorld(seed.trim(),{epoch,id:'preview'}):null;}catch{return null;}},[seed,epoch]);
  const cloudText=saveStatus==='saving'?'Сохранение…':saveStatus==='cloud'?'Сохранено':saveStatus==='local'?'На устройстве':saveStatus==='error'?'Ошибка сохранения':'Есть изменения';

  if(!world||!stats||!planet)return <main className="boot-screen"><Mark/><h1>MICROGALAXY</h1><p>{bootIssue||'Открываем обсерваторию'}</p>{bootIssue?<a href="/?archive=1">Вернуться в общий каталог миров</a>:<LoaderCircle className="loading-spin" size={18}/>}</main>;
  return <main className={'observatory '+(immersive?'immersive':'')}>
    <header className="topbar"><a className="brand" href="/classic" aria-label="Microgalaxy — прежние миры 0.1–0.2"><Mark/><span>MICROGALAXY<small>Миры 0.1–0.2 · совместимость</small></span></a><div className="top-system"><span className="status-dot"/>{world.name}<span className="mono">/ {world.seed}</span></div><div className="top-actions"><button className="quiet-button" onClick={async()=>{setPlaying(false);if(busyRef.current){notify("Дождитесь завершения шага перед переходом");return;}if(await persist())window.location.assign("/?archive=1");}} title="Сохранить мир и открыть общий каталог">Все мои миры</button><button className={'save-state '+(saveStatus==='error'?'error':'')} onClick={()=>void persist(true)} title={lastSaved?'Сохранено '+new Date(lastSaved).toLocaleTimeString('ru-RU'):'Сохранить мир'}>{saveStatus==='saving'?<LoaderCircle className="loading-spin" size={14}/>:saveStatus==='cloud'?<Check size={14}/>:<Save size={14}/>}<span>{cloudText}</span></button><button className="icon-button" title={sound?'Выключить звук':'Включить звук'} aria-label={sound?'Выключить звук':'Включить звук'} onClick={()=>{setSoundEnabled(!sound);setSound(!sound);}}>{sound?<Volume2 size={17}/>:<VolumeX size={17}/>}</button><button className="quiet-button archive-button" aria-label="Мои миры" onClick={()=>void openArchive()}><Archive size={16}/><span>Мои миры</span></button><button className="new-world-button" aria-label="Новая система" onClick={openNew}><Plus size={16}/><span>Новая система</span></button></div></header>
    <nav className="viewbar" aria-label="Представления мира"><div className="station-label"><Telescope size={14}/><span>Станция наблюдения</span><small>01</small></div><div className="view-tabs">{([{id:'system',label:'Система',icon:Orbit},{id:'planet',label:'Планета',icon:Globe2},{id:'societies',label:'Общества',icon:Users},{id:'chronicle',label:'Хроника',icon:Radio}] as const).map(t=><button key={t.id} className={view===t.id?'active':''} aria-pressed={view===t.id} onClick={()=>{setView(t.id);setSelectedEvent(null);}}><t.icon size={16}/>{t.label}{t.id==='chronicle'&&<small>{world.events.length}</small>}</button>)}</div><button className="about-button" aria-label="О наблюдении" onClick={()=>setModal('about')}><CircleHelp size={15}/><span>О наблюдении</span></button></nav>
    <div className="main-grid">
      <aside className="system-sidebar"><div className="sidebar-heading"><span>Звёздная система</span><span className="mono">{String(world.planets.length).padStart(2,'0')}</span></div><button className={'star-card '+(view==='system'?'selected':'')} onClick={()=>{setView('system');setSelectedEvent(null);}}><span className="star-orb" style={{'--star':world.star.color} as React.CSSProperties}/><span><strong>{world.star.name}</strong><small>Звезда · {world.star.type}</small></span><ChevronRight size={14}/></button><div className="orbit-tree">{world.planets.map((p,index)=><button key={p.id} className={'planet-row '+(p.id===selectedPlanet?'selected':'')} onClick={()=>{selectPlanet(p.id);setView('planet');}}><span className="planet-index mono">{String(index+1).padStart(2,'0')}</span><span className={'planet-swatch '+p.kind} style={{'--planet':p.color} as React.CSSProperties}/><span className="planet-label"><strong>{p.name}</strong><small>{dec(p.orbit)} а.е.{p.habitable?' · Биосфера':''}</small></span>{p.id===world.homePlanetId&&<span className="life-dot" title="Обитаемый мир"/>}</button>)}</div><div className="sidebar-note"><span className="tiny-label">Параметры звезды</span><dl><div><dt>Масса</dt><dd>{dec(world.star.mass)} M☉</dd></div><div><dt>Температура</dt><dd>{fmt(world.star.temperature)} K</dd></div><div><dt>Возраст</dt><dd>{dec(world.star.age)} млрд лет</dd></div></dl></div><div className="sidebar-bottom"><span className="status-dot"/><div>Автономный мир<small>Наблюдение без вмешательства</small></div></div></aside>
      <section className={'workspace view-'+view} aria-label="Область наблюдения">
        {(view==='planet'||view==='system')&&<><Suspense fallback={<div className="scene-loading"><LoaderCircle className="loading-spin" size={20}/><span>Загружаем оптику</span></div>}><CosmosScene world={world} mode={view} selectedPlanetId={selectedPlanet} onSelectPlanet={selectPlanet} layer={layer} selectedSocietyId={selectedSociety} focus={focus}/></Suspense><div className="scene-heading"><div className="scene-caption"><span className="cross-marker">+</span>{view==='system'?'Общий вид системы':kinds[planet.kind]}</div><h1>{view==='system'?world.name:planet.name}</h1><p>{view==='system'?`${world.planets.length} планет · ${world.star.type} · ${world.missions.length} миссий`:`${dec(planet.radius)} R⊕ · ${dec(planet.orbit)} а.е. · ${planet.moons} ${plural(planet.moons,'спутник','спутника','спутников')}`}</p></div><div className="scene-actions"><button className="icon-button" title="Сбросить камеру" aria-label="Сбросить камеру" onClick={()=>setFocus(n=>n+1)}><Crosshair size={17}/></button><button className="icon-button" title={immersive?'Показать панели':'Скрыть панели'} aria-label={immersive?'Показать панели':'Скрыть панели'} onClick={()=>setImmersive(!immersive)}><Maximize size={17}/></button><button className="icon-button mobile-info" aria-label="Показать сведения о планете" onClick={()=>setMobileDetails(true)}><Settings2 size={17}/></button></div><div className="scene-bottom"><div className="scene-hint"><span className="mouse-indicator"/>Вращайте, чтобы исследовать<span>Колесо — масштаб</span></div>{view==='planet'&&<div className="layer-switch" aria-label="Слои планеты"><Layers3 size={14}/>{([{id:'natural',label:'Рельеф'},{id:'political',label:'Общества'},{id:'climate',label:'Климат'}]as const).map(l=><button key={l.id} className={layer===l.id?'active':''} aria-pressed={layer===l.id} onClick={()=>setLayer(l.id)}>{l.label}</button>)}</div>}</div></>}
        {view==='societies'&&<div className="data-view societies-view"><div className="data-view-heading"><div><span className="scene-caption">Разумная жизнь</span><h1>Общества системы</h1><p>{world.name} · разные пути развития</p></div><span className="large-counter mono">{String(world.societies.length).padStart(2,'0')}</span></div><div className="overview-metrics"><Metric label="Население" value={compact(stats.population)}/><Metric label="Технологии" value={dec(stats.tech)} unit="/ 100"/><Metric label="Устойчивость" value={dec(stats.stability)} unit="/ 100"/></div><div className="society-table"><div className="society-table-head"><span>Общество</span><span>Население</span><span>Технологии</span><span>Устойчивость</span></div>{world.societies.map(s=><button key={s.id} className={'society-table-row '+(s.id===selectedSociety?'active':'')} onClick={()=>{setSelectedSociety(s.id);setSelectedEvent(null);setSelectedPlanet(s.planetId);setMobileDetails(true);}}><span className="society-name"><i style={{background:s.color}}/><span><strong>{s.name}</strong><small>{s.government} · {world.planets.find(p=>p.id===s.planetId)?.name}</small></span></span><span className="mono">{compact(s.population)}</span><span className="table-bar"><span style={{width:s.tech+'%',background:s.color}}/><b>{Math.round(s.tech)}</b></span><span className="mono">{Math.round(s.stability)}<ChevronRight size={14}/></span></button>)}</div><HistoryChart history={world.history}/>{world.missions.length>0&&<div className="mission-list"><h3>Присутствие в космосе</h3>{world.missions.map(m=><div key={m.id}><Orbit size={15}/><span>{m.name}<small>{world.planets.find(p=>p.id===m.planetId)?.name} · {m.type==='colony'?'Поселение':m.type==='probe'?'Зонд':'Спутник'}</small></span><span className="mono">{m.active?'Действует':`Прибытие: ${m.arrivalYear}`}</span></div>)}</div>}</div>}
        {view==='chronicle'&&<div className="data-view chronicle-view"><div className="data-view-heading"><div><span className="scene-caption">Архив наблюдений</span><h1>История системы</h1><p>Причины, события и их последствия</p></div><span className="large-counter mono">{String(world.events.length).padStart(2,'0')}</span></div><div className="chronicle-toolbar"><label className="search-field"><Search size={15}/><input placeholder="Найти событие" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Тип событий" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Все события</option>{Object.entries(eventKinds).map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></div><div className="chronicle-list">{events.length===0?<div className="empty-state">По этому запросу событий нет</div>:events.map(e=><button key={e.id} className={'chronicle-event '+(selectedEvent?.id===e.id?'active':'')} onClick={()=>openEvent(e)}><span className="event-date mono">{fmt(e.year)}<small>год</small></span><span className={'event-type-dot '+e.type}/><span><small>{eventKinds[e.type]}</small><strong>{e.title}</strong><p>{e.description}</p></span><ArrowUpRight size={16}/></button>)}</div></div>}
      </section>
      <aside className={'details-panel '+(mobileDetails?'mobile-open':'')}><div className="details-heading"><span>{selectedEvent?'Карточка события':society?'Паспорт общества':'Паспорт планеты'}</span><button className="icon-button mobile-info" onClick={()=>setMobileDetails(false)} aria-label="Закрыть сведения"><X size={18}/></button><span className="panel-code mono">{selectedEvent?'EV':society?'CV':'PL'}/{String(world.planets.findIndex(p=>p.id===planet.id)+1).padStart(2,'0')}</span></div>
        {selectedEvent?<div className="event-details"><span className="event-kicker">{eventKinds[selectedEvent.type]} · Год {fmt(selectedEvent.year)}</span><h2>{selectedEvent.title}</h2><p>{selectedEvent.description}</p><h3>Что привело к событию</h3><ul>{selectedEvent.causes.map((cause,i)=><li key={i}>{cause}</li>)}</ul><button className="text-button" onClick={()=>{setSelectedEvent(null);setSelectedSociety(undefined);setView('planet');setMobileDetails(false);}}>К месту события<ArrowRight size={15}/></button></div>:<><div className="details-title"><span className="tiny-label">{society?society.government:planet.id===world.homePlanetId?'Обитаемый мир':kinds[planet.kind]}</span><h2>{society?society.name:planet.name}</h2><p>{society?society.culture:planet.habitable?'На поверхности существует биосфера':planet.kind==='gas'?'Плотная атмосфера и глубокие газовые слои':'Наблюдение за природными условиями'}</p></div><div className="details-metrics">{society?<><Metric label="Население" value={compact(society.population)}/><Metric label="Запас продовольствия" value={dec(society.food*12)} unit="мес."/><Metric label="Устойчивость" value={dec(society.stability)} unit="/100"/><Metric label="Промышленность" value={dec(society.industry)}/></>:<><Metric label="Население" value={compact(world.societies.filter(s=>s.planetId===planet.id).reduce((a,s)=>a+s.population,0))}/><Metric label="Температура" value={dec(planet.id===world.homePlanetId?world.climate.temperature:planet.temp)} unit="°C"/><Metric label="Вода на поверхности" value={fmt(planet.water*100)} unit="%"/><Metric label="Масса" value={dec(planet.mass)} unit="M⊕"/></>}</div>{(society||planetSocieties.length>0)&&<><div className="era-block"><span className="tiny-label">Технологическое развитие</span><strong>{society?getEra(society.tech):getEra(planetTech)}</strong><div className="era-progress"><span style={{width:(society?society.tech:planetTech)+'%'}}/></div><div className="era-endpoints"><span>Ранние общества</span><span>Космос</span></div></div><div className="detail-societies"><div className="section-line"><h3>{society?'Связанные события':'Общества'}</h3><span className="mono">{society?'':planetSocieties.length}</span></div>{society?world.events.filter(e=>e.societyId===society.id).slice(-3).reverse().map(e=><button className="related-event" key={e.id} onClick={()=>openEvent(e)}><small>Год {e.year}</small>{e.title}<ChevronRight size={13}/></button>):planetSocieties.map(s=><button key={s.id} onClick={()=>{setSelectedSociety(s.id);setSelectedPlanet(s.planetId);setLayer('political');}}><i style={{background:s.color}}/><span>{s.name}</span><small className="mono">{compact(s.population)}</small><ChevronRight size={13}/></button>)}</div></>}{planet.id!==world.homePlanetId&&!society&&<dl className="planet-facts"><div><dt>Орбита</dt><dd>{dec(planet.orbit)} а.е.</dd></div><div><dt>Радиус</dt><dd>{dec(planet.radius)} R⊕</dd></div><div><dt>Спутники</dt><dd>{planet.moons}</dd></div></dl>}<div className="detail-footnote"><Radio size={14}/><span>{playing?'Наблюдение продолжается':'Мир на паузе'}<small>{world.missions.length?`${world.missions.length} миссий в космосе`:'Космическая эра ещё впереди'}</small></span></div></>}
      </aside>
    </div>
    <section className="recent-strip" aria-label="Последние события"><div className="recent-title"><span>Последние события</span><button onClick={()=>setView('chronicle')}>Вся хроника<ArrowUpRight size={14}/></button><small className="mono">{world.events.length} записей</small></div><div className="recent-events">{[...world.events].reverse().slice(0,3).map(e=><button key={e.id} className="recent-event" onClick={()=>openEvent(e)}><div><span className={'event-type-dot '+e.type}/><span className="mono">Год {fmt(e.year)}</span><small>{eventKinds[e.type]}</small></div><strong>{e.title}</strong><p>{e.description}</p></button>)}</div></section>
    <footer className="timebar"><div className="world-time"><span className={'status-dot '+(playing?'running':'')}/><div><small>{playing?'Время идёт':'На паузе'}</small><strong className="mono">Год {fmt(world.year).padStart(5,'0')}</strong></div></div><div className="playback"><button className="play-button" disabled={workerError||world.year>=MAX_YEAR||conflictRef.current} onClick={togglePlay} aria-label={playing?'Приостановить':'Начать наблюдение'}>{playing?<Pause size={18}/>:<Play size={18} fill="currentColor"/>}<span>{playing?'Пауза':'Наблюдать'}</span></button><div className="speed-control" aria-label="Скорость времени">{[1,10,50].map(s=><button key={s} className={speed===s?'active':''} aria-pressed={speed===s} onClick={()=>setSpeed(s)} title={s+' '+plural(s,'год','года','лет')+' в секунду'}>{s}×</button>)}</div><button className="step-button" disabled={busy||workerError||world.year>=MAX_YEAR||conflictRef.current} onClick={()=>{setPlaying(false);advance(10);}} title="Рассчитать 10 лет">+10 лет</button><button className="next-event-button" disabled={busy||workerError||world.year>=MAX_YEAR||conflictRef.current} onClick={()=>{setPlaying(false);advance(500,true);}}>{busy?<LoaderCircle className="loading-spin" size={15}/>:<SkipForward size={15}/>}<span>До события</span></button></div><div className="timebar-right"><label className="autopause"><input type="checkbox" checked={autoPause} onChange={e=>setAutoPause(e.target.checked)}/><span className="switch-track"/><span>Пауза на важном</span></label><span className="keyboard-hint"><kbd>Space</kbd> пауза</span></div></footer>
    {toast&&<div className="toast" role="status">{toast}<button onClick={()=>setToast('')} aria-label="Закрыть уведомление"><X size={14}/></button></div>}
    {modal==='new'&&<Modal title="Новая звёздная система" onClose={closeModal}><div className="modal-body"><p className="modal-intro">Другие планеты. Другие общества. Новая история.</p><label className="form-label">Код мира<div className="seed-input"><input aria-label="Код мира" aria-invalid={!!seedError} aria-describedby={seedError?'seed-error':undefined} value={seed} onChange={e=>setSeed(e.target.value.slice(0,64))} spellCheck={false} maxLength={64} autoComplete="off"/><button onClick={()=>setSeed(randomSeed())} aria-label="Случайный код мира" title="Случайные характеристики"><Shuffle size={18}/></button></div><small>Одинаковый код и эпоха повторяют начальные условия</small>{seedError&&<small id="seed-error" className="form-error" role="alert">{seedError}</small>}</label><label className="form-label">Начало наблюдения<select value={epoch} onChange={e=>setEpoch(e.target.value as typeof epoch)}><option value="agrarian">Ранние общества</option><option value="industrial">Начало промышленной эпохи</option></select></label>{preview&&<div className="world-preview"><div className="preview-star" style={{background:preview.star.color}}/><div><strong>{preview.name}</strong><span>Звезда {preview.star.type} · {preview.planets.length} планет</span><small>{preview.societies.length} обществ на планете {preview.planets.find(p=>p.id===preview.homePlanetId)?.name}</small></div></div>}<div className="preserve-note"><Archive size={16}/><span>Текущий мир останется в «Моих мирах»</span></div></div><footer className="modal-footer"><button className="quiet-button" onClick={closeModal}>Отмена</button><button className="primary-button" onClick={()=>void newWorld()} disabled={creating||!preview||!!seedError}>{creating?<LoaderCircle className="loading-spin" size={16}/>:<Plus size={16}/>}Создать систему</button></footer></Modal>}
    {modal==='archive'&&<Modal title="Мои миры" onClose={closeModal} wide><div className="modal-body archive-body"><div className="archive-tools"><p>Истории, к которым можно вернуться</p><button className="quiet-button" onClick={exportWorld}><Download size={15}/>Экспорт</button><button className="quiet-button" onClick={()=>importRef.current?.click()}><Upload size={15}/>Импорт</button><input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';void importWorld(file);}}/></div>{archiveBusy?<div className="empty-state"><LoaderCircle className="loading-spin"/></div>:archive.map(item=><button className={'archive-world '+(item.id===world.id?'current':'')} key={item.id} disabled={creating} onClick={()=>void loadWorld(item.id)}><span className="archive-symbol"><Orbit size={24}/></span><span><strong>{item.name}{item.id===world.id&&<small>Текущий</small>}</strong>{item.metadataPending?<span>Метаданные ещё не проверены</span>:<><span>{item.era} · {compact(item.population)} жителей</span><small className="mono">{item.seed}{item.local?' · Копия на устройстве':''}</small></>}</span><span className="archive-year mono">{item.metadataPending?'Открыть':`Год ${fmt(item.year)}`}<ArrowUpRight size={17}/></span></button>)}{!archiveBusy&&!archive.length&&<div className="empty-state">Здесь появятся сохранённые миры</div>}{!archiveBusy&&archiveCursor&&<button className="archive-more quiet-button" disabled={archiveLoadingMore||creating} onClick={()=>void loadMoreArchive()}>{archiveLoadingMore?<LoaderCircle className="loading-spin" size={16}/>:<Archive size={16}/>}Ещё миры</button>}</div></Modal>}
    {modal==='conflict'&&<Modal title="Есть другая версия мира" onClose={closeModal} dismissible={false}><div className="modal-body"><p>{conflictSource==='cloud'?'На другом устройстве уже сохранена новая версия этой истории.':'Другая вкладка сохранила новую версию этой истории.'} Расчёт приостановлен.</p><p>Откройте последнее сохранение или продолжите текущую историю отдельным миром. Обе истории сохранятся.</p><button className="quiet-button" onClick={exportWorld}><Download size={15}/>Экспорт текущей истории</button></div><footer className="modal-footer"><button className="quiet-button" disabled={creating} onClick={()=>void forkConflict()}>Продолжить отдельным миром</button><button className="primary-button" disabled={creating} onClick={()=>void loadWorld(world.id,conflictSource)}>Открыть сохранённую версию</button></footer></Modal>}
    {modal==='about'&&<Modal title="Обсерватория MICROGALAXY" onClose={closeModal} wide><div className="modal-body about-body"><p className="about-lead">У каждого мира своя история.<br/>У вас — возможность её увидеть.</p><div className="about-columns"><div><h3>Как наблюдать</h3><p>Выберите планету, вращайте глобус и меняйте слои. Запустите время или перейдите к следующему событию. Нажмите на запись в хронике, чтобы увидеть её причины.</p><p>Общества сами развивают хозяйство, исследуют технологии, переживают кризисы и выходят в космос. При закрытии или скрытии вкладки мир приостанавливается.</p></div><div><h3>Версия обсерватории · 0.2</h3><p>Одна подробная планета, несколько обществ и путь от ранних поселений до космических миссий. История рассчитывается по правилам и случайным последовательностям заданного мира.</p><p>Климат, хозяйство и общество описаны упрощёнными моделями. Карта показывает центры обществ; их цветные области условны. Орбиты в общем виде показаны в обзорном масштабе.</p></div></div><dl className="shortcut-list"><div><dt><kbd>Space</kbd></dt><dd>Начать или приостановить</dd></div><div><dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt><dd>Скорость 1×, 10×, 50×</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Вернуться к панелям</dd></div></dl><div className="about-version mono">Модель {world.engineVersion} · Код мира {world.seed}</div></div></Modal>}
  </main>;
}
