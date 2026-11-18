import {planRetention, retentionConfirmation, DEFAULT_LIMIT_BYTES, LIMIT_OPTIONS_BYTES} from './retention-policy.mjs';
import {withRetentionLock, acquireWorldLease, withInactiveWorld} from './local-retention-locks.mjs';

import {WORLD_MODELS} from './world-models.mjs';
export const LOCAL_DATABASES = Object.freeze(Object.fromEntries(
  Object.entries(WORLD_MODELS).map(([model, entry]) => [model, entry.db])
));
const VERSION=3, SETTINGS='microgalaxy-retention-settings-v1';
const encoder=new TextEncoder();
const catalogIndexPosition = new Map();
let lastNotice=[],lastError='';
function requestValue(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function complete(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('Операция архива отменена.'));tx.onerror=()=>{};});}
export function openRetentionDatabase(model,onVersionChange=()=>{}){
  const name=LOCAL_DATABASES[model];if(!name)throw new TypeError('Unknown storage model');
  return new Promise((resolve,reject)=>{let abandoned=false;const r=indexedDB.open(name,VERSION);
    r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('worlds'))db.createObjectStore('worlds',{keyPath:model==='classic'?'world.id':'id'});for(const store of ['metadata','retention','tombstones'])if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:'id'});};
    r.onblocked=()=>{abandoned=true;const e=new Error('Закройте старые вкладки MICROGALAXY: безопасное обновление архива заблокировано. Автоудаление не выполнялось.');e.code='STORAGE_UPGRADE_BLOCKED';reject(e);};
    r.onerror=()=>reject(r.error);r.onsuccess=()=>{if(abandoned){r.result.close();return;}r.result.onversionchange=()=>{r.result.close();onVersionChange();};resolve(r.result);};
  });
}

/** Do not create/upgrade an absent or old model database just to show its list. */
function existingCatalogDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let absent = false;
    request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => absent ? resolve(null) : reject(request.error);
    request.onblocked = () => reject(new Error('Каталог этой модели занят другой вкладкой.'));
  });
}

async function catalogEntries(db) {
  if (!db.objectStoreNames.contains('worlds')) return {keys:[], metadata:new Map()};
  const hasMetadata = db.objectStoreNames.contains('metadata');
  const tx = db.transaction(hasMetadata ? ['worlds','metadata'] : ['worlds'], 'readonly');
  const [keys, rows] = await Promise.all([
    requestValue(tx.objectStore('worlds').getAllKeys()),
    hasMetadata ? requestValue(tx.objectStore('metadata').getAll()) : [],
  ]);
  return {keys, metadata:new Map(rows.filter(row => Number.isSafeInteger(row.year)).map(row => [row.id,row]))};
}

function catalogRow(model, id, meta) {
  const cloud = meta?.cloud ?? null;
  return {key:model+':'+id, model, id, name:meta?.name ?? null, seed:meta?.seed ?? null,
    year:meta?.year ?? null, revision:meta?.revision ?? null, cloud, updatedAt:meta?.updatedAt ?? null,
    dirty:meta ? (model === 'classic' ? !!meta.local : !cloud || cloud.syncedRevision !== meta.revision) : null,
    ...(model==='v1' && meta?.modelVersion ? {modelVersion:meta.modelVersion}:{}),
    startingEra:meta?.startingEra ?? null, metadataPending:!meta};
}

async function indexCatalogKeys(model, ids) {
  return withRetentionLock(async () => {
    const db = await openRetentionDatabase(model);
    try {
      let indexed = 0;
      for (const id of ids) {
        const tx = db.transaction(['worlds','metadata'],'readwrite');
        const finished = complete(tx), metadata = tx.objectStore('metadata');
        const previous = metadata.get(id);
        previous.onsuccess = () => {
          if (Number.isSafeInteger(previous.result?.year)) return;
          const request = tx.objectStore('worlds').get(id);
          request.onsuccess = () => {
            const row = request.result, w = row?.world;
            if (!w || w.id !== id || (model !== 'classic' && row.id !== id) || !Number.isSafeInteger(w.year) ||
                typeof w.name !== 'string' || typeof w.seed !== 'string' || !Number.isSafeInteger(row.revision)) return;
            const meta = {id, name:w.name, seed:w.seed, year:w.year, revision:row.revision, updatedAt:row.updatedAt,
              startingEra:model === 'classic' ? null : w.era ?? null, cloud:row.cloud ?? null};
            // Classic may enrich this basic row with population and current era in its own validated catalogue.
            if (model === 'classic') meta.local = row.revision === 0 || w.year > (row.syncedYear ?? -1);
            metadata.put(meta);
            indexed++;
          };
        };
        await finished;
      }
      return indexed;
    } finally { db.close(); }
  });
}

export async function readModelCatalog(model, {indexBudget=0, knownNames=null}={}) {
  if (!Object.hasOwn(LOCAL_DATABASES,model)) throw new Error('Неизвестная модель архива.');
  const name = LOCAL_DATABASES[model];
  if (knownNames && !knownNames.has(name)) return {rows:[],pendingCount:0,indexedCount:0};
  const db = await existingCatalogDatabase(name);
  if (!db) return {rows:[],pendingCount:0,indexedCount:0};
  let state;
  try { state = await catalogEntries(db); } finally { db.close(); }
  const missing = state.keys.filter(id=>!state.metadata.has(id));
  const budget = Math.max(0,Math.min(8,Math.floor(indexBudget)||0));
  if (missing.length && budget) {
    // One unreadable old record must not occupy the first slot on every refresh.
    const last = catalogIndexPosition.get(model);
    const start = last === undefined ? 0 : Math.max(0,missing.findIndex(id => indexedDB.cmp(id,last) > 0));
    const batch = missing.slice(start,start+budget);
    if (batch.length < budget) batch.push(...missing.slice(0,Math.min(start,budget-batch.length)));
    const indexedCount = await indexCatalogKeys(model,batch);
    catalogIndexPosition.set(model,batch.at(-1));
    const result = await readModelCatalog(model);
    return {...result,indexedCount};
  }
  return {rows:state.keys.map(id=>catalogRow(model,id,state.metadata.get(id))), pendingCount:missing.length,indexedCount:0};
}
export function localRetentionMetadata(model,row,previousMeta={}){
  const id=model==='classic'?row?.world?.id:row?.id;
  const valid=typeof id==='string'&&row?.world?.id===id&&Number.isSafeInteger(row.revision)&&typeof row.updatedAt==='string';
  let bytes=null;try{if(valid)bytes=encoder.encode(JSON.stringify(row.world)).length+(row.previous?encoder.encode(JSON.stringify(row.previous)).length:0);}catch{}
  return {id,model,name:row?.name||row?.world?.name||id,revision:row?.revision,bytes,updatedAt:row?.updatedAt,pinned:!!previousMeta.pinned,legacyProtected:!!previousMeta.legacyProtected,generation:globalThis.crypto.randomUUID(),
    pending:model==='classic'?row?.syncedYear>=0&&row.syncedYear<row.world.year:!!row?.cloud&&row.cloud.syncedRevision!==row.revision};
}
/** Called from the SAME transaction that commits the validated checkpoint. */
export function writeRetentionMetadata(tx,model,row,existed=false){
  const id=model==='classic'?row.world.id:row.id,store=tx.objectStore('retention'),r=store.get(id);
  r.onsuccess=()=>store.put(localRetentionMetadata(model,row,r.result||{legacyProtected:existed}));
}
export async function assertLocalNotDeleted(db,id){const tx=db.transaction('tombstones','readonly');if(await requestValue(tx.objectStore('tombstones').get(id))){const e=new Error('Это сохранение удалено по лимиту. Автоматическое восстановление отключено; импортируйте отдельную копию с новым ID.');e.code='WORLD_RETIRED';throw e;}}
async function settings(write){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(SETTINGS,1);r.onupgradeneeded=()=>r.result.createObjectStore('settings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{const tx=db.transaction('settings',write?'readwrite':'readonly'),done=complete(tx),s=tx.objectStore('settings');if(write)s.put(write,'limit');const value=write||await requestValue(s.get('limit'));await done;return LIMIT_OPTIONS_BYTES.includes(value)?value:DEFAULT_LIMIT_BYTES;}finally{db.close();}}
async function inventory(db,model,budget){
  const tx=db.transaction(['worlds','retention'],'readonly'),known=await requestValue(tx.objectStore('retention').getAll());
  const keys=await requestValue(db.transaction('worlds','readonly').objectStore('worlds').getAllKeys()),ids=new Set(known.map(r=>r.id));
  const missing=keys.filter(id=>!ids.has(id));
  for(const id of missing.slice(0,budget)){const t=db.transaction(['worlds','retention'],'readwrite'),done=complete(t),r=t.objectStore('worlds').get(id);r.onsuccess=()=>{if(r.result){const m=localRetentionMetadata(model,r.result,{legacyProtected:true});if(m.id===id)t.objectStore('retention').put(m);}};await done;}
  const all=await requestValue(db.transaction('retention','readonly').objectStore('retention').getAll());
  const indexed=new Set(all.map(r=>r.id));return [...all,...keys.filter(id=>!indexed.has(id)).map(id=>({model,id,bytes:null,pending:true,legacyProtected:true}))];
}
async function inspect({prune=false,inventoryBudget=0,protect=[],approved}={}){
  const limitBytes=await settings(),dbs=new Map(),records=[],deleted=[],notices=[];let unavailable=0;
  try{
    for(const model of Object.keys(LOCAL_DATABASES)){try{const db=await openRetentionDatabase(model);dbs.set(model,db);records.push(...await inventory(db,model,inventoryBudget));notices.push(...(await requestValue(db.transaction('tombstones','readonly').objectStore('tombstones').getAll())).map(r=>({...r,model})));}catch{unavailable++;}}
    const held=new Set(protect.map(x=>JSON.stringify(x)));for(const r of records)if(held.has(JSON.stringify([r.model,r.id])))r.active=true;
    // The genuine per-world Web Lock determines activity, never a heartbeat.
    for(const r of records)if(!r.active){const free=await withInactiveWorld(r.model,r.id,()=>true);if(!free)r.active=true;}
    let plan=planRetention(records,limitBytes);
    // A blocked upgrade means an obsolete writer may still own this origin.
    // Never prune any model until the complete coordination boundary is safe.
    if(prune&&!unavailable)for(const candidate of plan.remove){if(approved&&!approved.has(JSON.stringify([candidate.model,candidate.id,candidate.revision,candidate.bytes])))continue;await withInactiveWorld(candidate.model,candidate.id,async()=>{
      const db=dbs.get(candidate.model),tx=db.transaction(['worlds','metadata','retention','tombstones'],'readwrite'),done=complete(tx),s=tx.objectStore('retention'),r=s.get(candidate.id);let notice=null;
      r.onsuccess=()=>{const m=r.result;if(!m||m.revision!==candidate.revision||m.pinned||m.pending||m.legacyProtected)return;
        notice={id:candidate.id,model:candidate.model,name:m.name||candidate.id,bytes:m.bytes,deletedAt:new Date().toISOString(),reason:'quota'};tx.objectStore('tombstones').put(notice);tx.objectStore('worlds').delete(candidate.id);tx.objectStore('metadata').delete(candidate.id);tx.objectStore('metadata').delete(['observation',candidate.id]);s.delete(candidate.id);};
      await done;if(notice)deleted.push(notice);
    });}
    if(deleted.length){const removed=new Set(deleted.map(r=>JSON.stringify([r.model,r.id])));plan=planRetention(records.filter(r=>!removed.has(JSON.stringify([r.model,r.id]))),limitBytes);}
    lastNotice=[...notices,...deleted].sort((a,b)=>String(b.deletedAt).localeCompare(String(a.deletedAt))||a.model.localeCompare(b.model)||a.id.localeCompare(b.id)).slice(0,10);
    return {...plan,remove:undefined,scope:'local',accounting:'current-and-previous-json',records:records.filter(r=>!deleted.some(d=>d.model===r.model&&d.id===r.id)),deleted,lastNotice,unavailable,error:lastError||undefined,blocked:!!unavailable||plan.blocked,complete:!unavailable&&plan.complete,autoDeleteAvailable:!unavailable};
  }finally{for(const db of dbs.values())db.close();}
}
export async function retentionStatus({inventoryBudget=0}={}){try{return await withRetentionLock(()=>inspect({inventoryBudget}));}catch(error){return {scope:'local',limitBytes:DEFAULT_LIMIT_BYTES,knownBytes:0,unknownCount:0,complete:false,blocked:true,autoDeleteAvailable:false,error:error.message,records:[],deleted:[],lastNotice};}}
/** A comparison is optional; it must fit without sacrificing existing worlds.
 * Keep the shared catalogue lock from accounting through the IDB pair commit. */
export async function withBranchQuota(bytes, write) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Некорректный размер пары.');
  return withRetentionLock(async () => {
    const inventory = await inspect({inventoryBudget: 8});
    if (!inventory.complete || inventory.unavailable) throw new Error('Учёт архива ещё не завершён. Повторите после индексации.');
    if (inventory.knownBytes + bytes > inventory.limitBytes) throw new Error('Паре не хватает свободного места в выбранном лимите.');
    return write();
  });
}
export async function inventoryLocalRetention(){return withRetentionLock(()=>inspect({inventoryBudget:8}));}
export async function cleanupLocalRetention(){return withRetentionLock(()=>inspect({inventoryBudget:8,prune:true}));}
export async function setRetentionLimit(bytes,confirmation) {
  if(!LIMIT_OPTIONS_BYTES.includes(bytes))throw new RangeError('Invalid retention limit');
  return withRetentionLock(async()=>{
    let approved;
    if(confirmation!==undefined){
      const status=await inspect({});
      if(status.unavailable||confirmation!==await retentionConfirmation(status.records,status.limitBytes,bytes))throw new Error('Состав архива изменился. Откройте предварительный список снова.');
      approved=new Set(planRetention(status.records,bytes).remove.map(r=>JSON.stringify([r.model,r.id,r.revision,r.bytes])));
    }
    await settings(bytes);
    return inspect({prune:true,inventoryBudget:confirmation===undefined?8:0,approved});
  });
}
export async function setWorldPinned(model,id,pinned){if(typeof pinned!=='boolean')throw new TypeError('Invalid pin');return withRetentionLock(async()=>{const db=await openRetentionDatabase(model);try{const tx=db.transaction(['worlds','retention'],'readwrite'),done=complete(tx),s=tx.objectStore('retention'),r=tx.objectStore('worlds').get(id);let found=false;r.onsuccess=()=>{if(!r.result)return;const row=r.result,m=s.get(id);m.onsuccess=()=>{s.put({...localRetentionMetadata(model,row,m.result||{legacyProtected:true}),pinned});found=true;};};await done;if(!found)throw new Error('Сохранение не найдено; закрепление не изменено.');}finally{db.close();}return inspect();});}
export async function adoptLocalWorld(model,id,revision,observed,acknowledge){
  if(acknowledge!==true||!observed||observed.id!==id||observed.model!==model||observed.revision!==revision)throw new Error('Подтвердите: другие вкладки этого мира закрыты, изменения сохранены или экспортированы.');
  return withRetentionLock(async()=>{const result=await withInactiveWorld(model,id,async()=>{const db=await openRetentionDatabase(model);try{const tx=db.transaction(['worlds','retention','tombstones'],'readwrite'),end=complete(tx),meta=tx.objectStore('retention'),r=meta.get(id);let changed=false;
    r.onsuccess=()=>{const m=r.result;if(!m||m.revision!==revision||m.generation!==observed.generation||m.pinned!==observed.pinned||m.pending||m.bytes===null||m.legacyProtected!==observed.legacyProtected)return;const world=tx.objectStore('worlds').get(id);world.onsuccess=()=>{if(!world.result||world.result.revision!==revision||world.result.updatedAt!==m.updatedAt)return;meta.put({...m,legacyProtected:false,generation:crypto.randomUUID()});changed=true;};};await end;return changed;
  }finally{db.close();}});if(!result){const error=new Error('Мир открыт или его защита изменилась. Закройте другие вкладки, обновите архив и проверьте сохранение.');error.code='PROTECTION_CHANGED';throw error;}return inspect({prune:true});});
}
export async function activateWorld(model,id){return withRetentionLock(()=>acquireWorldLease(model,id));}
export function pruneLocalAfterWrite(model,id){setTimeout(()=>{void withRetentionLock(()=>inspect({prune:true,inventoryBudget:2,protect:[[model,id]]})).then(()=>{lastError='';},error=>{lastError='Сохранение записано; автоматическая очистка не завершена: '+error.message;});},0);}
/** Wrap old model persistence without touching a single annual model rule. */
export function attachRetentionStore(store,model,db){
  const leases=new Map();let closed=false;
  const hold=async id=>{if(!leases.has(id))leases.set(id,await acquireWorldLease(model,id));};
  const mutate=(name)=>async(...args)=>{const input=typeof args[0]==='object'?structuredClone(args[0]):args[0];args[0]=input;const id=typeof input==='object'?input.id:input;
    return withRetentionLock(async()=>{if(closed)throw new Error('Архив закрыт.');await hold(id);await assertLocalNotDeleted(db,id);const result=await store[name](...args);pruneLocalAfterWrite(model,id);return result;});};
  const read = name => async id => withRetentionLock(async () => {
    await hold(id);
    await assertLocalNotDeleted(db,id);
    return store[name](id);
  });
  return {...store,get:read('get'),...(store.getExportCheckpoints ? {getExportCheckpoints:read('getExportCheckpoints')} : {}),put:mutate('put'),markSynced:mutate('markSynced'),receiveCloud:mutate('receiveCloud'),
    releaseWorld:async id=>withRetentionLock(async()=>{const release=leases.get(id);if(release){leases.delete(id);await release();}}),
    close(){closed=true;store.close();for(const release of leases.values())void release();leases.clear();}};
}
