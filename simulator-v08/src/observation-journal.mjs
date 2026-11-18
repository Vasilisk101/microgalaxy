import {ROUTE_CLOSURES} from './economy.mjs';
// Measurements belong to the observer. They never enter the simulation snapshot.
export const MAX_JOURNAL_BYTES=2*1024*1024;
const STORE='metadata';
const bytes=text=>new TextEncoder().encode(text).length;
const fail=()=>{throw new Error('Журнал повреждён или относится к другой истории мира.');};
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const year=n=>Number.isSafeInteger(n)&&n>=0;
const numeric=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const kinds=new Set(['observed','state','gap','unknown','lost','delivered']);

function checkState(world,state) {
  if(!plain(state)||Object.keys(state).some(key=>!['place','freight'].includes(key)))fail();
  if(state.place!==null){
    const p=state.place,list=p?.type==='region'?world.regions:p?.type==='society'?world.societies:[];
    if(!plain(p)||!list.some(x=>x.id===p.id))fail();
  }
  const f=state.freight;
  if(f!==null){
    const sh=f?.shipment;
    if(!plain(f)||!plain(sh)||typeof f.id!=='string'||!/^cargo[1-9]\d*$/.test(f.id)||
       sh.id!==f.id||Number(f.id.slice(5))>=world.economy.nextShipment||
       !year(f.started)||!year(f.lastYear)||f.started>f.lastYear||f.lastYear>world.year||
       !world.regions.some(r=>r.id===sh.from)||!world.regions.some(r=>r.id===sh.to)||sh.from===sh.to||
       !['food','raw','energy','equipment'].includes(sh.resource)||!['waiting','transit'].includes(sh.status)||
       !year(sh.departure)||sh.departure>f.started||!year(sh.arrival)||!numeric(sh.amount)||
       !Array.isArray(sh.path)||!sh.path.length||sh.path.length>world.geography.edges.length||
       !sh.path.every(id=>world.geography.edges.some(edge=>edge.id===id))||
       !Array.isArray(f.records)||!f.records.length||f.records.length>10001||
       f.records[0]?.kind!=='observed'||f.records[0]?.year!==f.started)fail();
    let previous=f.started-1;
    for(const r of f.records){
      if(!plain(r)||!kinds.has(r.kind)||!year(r.year)||r.year<=previous||r.year>f.lastYear||
         (r.receiverStock!=null&&!numeric(r.receiverStock)))fail();
      if((r.kind==='observed'||r.kind==='state')&&(!numeric(r.amount)||!year(r.arrival)||!['waiting','transit'].includes(r.status)))fail();
      if(r.kind==='state'&&!Number.isFinite(r.amountChange))fail();
      if(['unknown','lost','delivered'].includes(r.kind)&&!numeric(r.amountBefore))fail();
      if(r.closed!==undefined && (r.kind!=='state'||r.status!=='waiting'||!Array.isArray(r.closed)||!r.closed.length||
        r.closed.length>sh.path.length||new Set(r.closed.map(edge=>edge?.edgeId)).size!==r.closed.length||
        !r.closed.every(edge=>plain(edge)&&sh.path.includes(edge.edgeId)&&Object.values(ROUTE_CLOSURES).includes(edge.reason))))fail();
      if(r.kind==='gap'&&!year(r.from))fail();
      if(r.kind==='delivered'&&!numeric(r.delivered)||['delivered','lost'].includes(r.kind)&&!numeric(r.lost))fail();
      previous=r.year;
    }
  }
  if(bytes(JSON.stringify(state))>MAX_JOURNAL_BYTES)throw new Error('Журнал превышает 2 МиБ.');
  return structuredClone(state);
}
function database(name) {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(name);
    request.onupgradeneeded=()=>request.transaction.abort();
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Журнал занят другой вкладкой.'));
  });
}
// Compound metadata keys cannot collide with string world IDs. Catalogue reads
// only copy Blob handles, leaving journal bodies out of the metadata scan.
const keyFor=id=>['observation',id];
export async function readLocal(world,revision,dbName) {
  const db=await database(dbName);
  try{
    const row=await new Promise((resolve,reject)=>{
      const req=db.transaction(STORE).objectStore(STORE).get(keyFor(world.id));
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    const entry=row?.entries.find(r=>r.revision===revision&&r.year===world.year);
    return entry?checkState(world,JSON.parse(await entry.notes.text())):null;
  } finally {db.close();}
}
export async function writeLocal(world,revision,state,dbName) {
  if(!Number.isSafeInteger(revision)||revision<1)fail();
  const notes=new Blob([JSON.stringify(checkState(world,state))],{type:'application/json'});
  const entry={year:world.year,revision,notes},id=keyFor(world.id);
  const db=await database(dbName);
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),current=store.get(world.id);
      let problem;
      current.onsuccess=()=>{
        if(current.result?.revision!==revision||current.result.year!==world.year){
          problem=new Error('Сохранённая ревизия изменилась. Можно скачать журнал этого сеанса.');tx.abort();return;
        }
        const req=store.get(id);
        req.onsuccess=()=>{
          const rows=(req.result?.entries??[]).filter(r=>r.revision!==revision);
          rows.push(entry);rows.sort((a,b)=>b.revision-a.revision);store.put({id,entries:rows.slice(0,2)});
        };
      };
      tx.oncomplete=resolve;tx.onabort=()=>reject(problem??tx.error);
    });
  } finally {db.close();}
}
async function fingerprint(world,digest) {
  // Importing a world creates a new local ID, all other simulation data must match.
  const {id,...simulation}=world;
  return digest(JSON.stringify(simulation));
}
export async function exportJournal(world,revision,state,digest) {
  const payload={schema:world.schema,modelVersion:world.modelVersion,year:world.year,revision,
    worldHash:await fingerprint(world,digest),state:checkState(world,state)};
  const text=JSON.stringify({format:'microgalaxy-observation/1',payload,checksum:await digest(JSON.stringify(payload))});
  if(bytes(text)>MAX_JOURNAL_BYTES)throw new Error('Журнал превышает 2 МиБ.');
  return text;
}
export async function importJournal(world,text,digest) {
  if(typeof text!=='string'||bytes(text)>MAX_JOURNAL_BYTES)fail();
  const data=JSON.parse(text,(key,value)=>{if(['__proto__','constructor','prototype'].includes(key))fail();return value;});
  const p=data?.payload;
  if(data?.format!=='microgalaxy-observation/1'||!plain(p)||p.schema!==world.schema||
    p.modelVersion!==world.modelVersion||p.year!==world.year||!Number.isSafeInteger(p.revision)||p.revision<1||
    await digest(JSON.stringify(p))!==data.checksum||await fingerprint(world,digest)!==p.worldHash)fail();
  return checkState(world,p.state);
}
