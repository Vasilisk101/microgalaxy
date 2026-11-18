import {openRetentionDatabase, attachRetentionStore, writeRetentionMetadata} from '../../lib/local-retention.mjs';
import {validateWorld, clone, SCHEMA, MODEL_VERSION} from './core.mjs';
export const MAX_FILE_BYTES=24*1024*1024;
export class ConflictError extends Error {constructor(){super('Мир изменён в другой вкладке. Новая история не перезаписана. Экспортируйте свой вариант или сохраните отдельную копию.');this.name='ConflictError';}}
export function safeParse(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_FILE_BYTES)throw new Error('Файл слишком большой: максимум 24 МБ.');return JSON.parse(text,(k,v)=>{if(['__proto__','constructor','prototype'].includes(k))throw new Error('Недопустимый ключ в файле.');return v;});}
/** Portable SHA-256 for integrity checks when Web Crypto is unavailable in a local preview.
 * No key management, authentication or security boundary relies on this hash.
 */
export function sha256Portable(text){
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const src=new TextEncoder().encode(text),len=Math.ceil((src.length+9)/64)*64,buf=new Uint8Array(len);buf.set(src);buf[src.length]=128;const dv=new DataView(buf.buffer);dv.setUint32(len-8,Math.floor(src.length/536870912));dv.setUint32(len-4,(src.length*8)>>>0);
 const out=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],rot=(x,n)=>(x>>>n)|(x<<(32-n)),w=new Uint32Array(64);
 for(let off=0;off<len;off+=64){for(let i=0;i<16;i++)w[i]=dv.getUint32(off+i*4);for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rot(x,7)^rot(x,18)^(x>>>3))+w[i-7]+(rot(y,17)^rot(y,19)^(y>>>10)))>>>0;}
 let [a,b,c,d,e,f,g,h]=out;for(let i=0;i<64;i++){const t1=(h+(rot(e,6)^rot(e,11)^rot(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rot(a,2)^rot(a,13)^rot(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}const a2=[a,b,c,d,e,f,g,h];for(let i=0;i<8;i++)out[i]=(out[i]+a2[i])>>>0;}
 return out.map(n=>n.toString(16).padStart(8,'0')).join('');
}
export async function digest(text){if(!globalThis.crypto?.subtle)return sha256Portable(text);const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
function saveEnvelope(payload,checksum){return {format:'microgalaxy-local-save',schema:SCHEMA,modelVersion:MODEL_VERSION,checksum,payload};}
/** A local checkpoint must still fit the same complete, lossless portable save. */
export function ensureSaveSize(world){const payload=JSON.stringify(world);const size=new TextEncoder().encode(JSON.stringify(saveEnvelope(payload,'0'.repeat(64)))).length;if(size>MAX_FILE_BYTES)throw new Error('Размер сохранения превысил 24 МБ. Предыдущая запись и полная открытая история не изменены. Экспортируйте доступное сохранение; события не удаляются автоматически.');return payload;}
export async function encodeSave(world){validateWorld(world);const payload=ensureSaveSize(world);return JSON.stringify(saveEnvelope(payload,await digest(payload)));}
export async function decodeSave(text){const e=safeParse(text);if(e?.format!=='microgalaxy-local-save'||e.schema!==SCHEMA||e.modelVersion!==MODEL_VERSION)throw new Error('Формат этой модели не поддерживается. Миры 0.1–0.6 продолжаются в своих версиях; автоматического преобразования нет, исходный файл не изменён.');if(typeof e.payload!=='string'||typeof e.checksum!=='string'||!/^[a-f0-9]{64}$/.test(e.checksum)||await digest(e.payload)!==e.checksum)throw new Error('Контрольная сумма не совпала. Повреждённое сохранение не загружено.');const world=safeParse(e.payload);validateWorld(world);return world;}
/** Pure optimistic-commit rule, shared by memory tests and IndexedDB. */
export function commitRecord(previous,world,expectedRevision){
  validateWorld(world);
  ensureSaveSize(world);
  const detached=previous?{...previous,world:clone(previous.world),cloud:previous.cloud?clone(previous.cloud):null}:previous;
  return commitPrepared(detached,clone(world),expectedRevision);
}
function commitPrepared(previous,world,expectedRevision){
  const revision=previous?.revision??0;
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER||revision!==expectedRevision)throw new ConflictError();
  if(previous&&(previous.id!==world.id||previous.world.seed!==world.seed||previous.world.era!==world.era||previous.world.schema!==world.schema||previous.world.modelVersion!==world.modelVersion||world.year<previous.world.year))throw new ConflictError();
  return {id:world.id,name:world.name,seed:world.seed,year:world.year,revision:revision+1,world,previous:previous?previous.world:null,cloud:previous?.cloud??null,updatedAt:new Date().toISOString()};
}
export function isCloudDirty(record){return !record?.cloud||record.cloud.revision<1||record.cloud.syncedRevision!==record.revision;}
function summaryRecord({id,name,seed,year,revision,cloud,updatedAt}){return {id,name,seed,year,revision,cloud:cloud?clone(cloud):null,updatedAt};}
function acknowledgeCloud(record,localRevision,cloudRevision,updatedAt){
  if(!record||!Number.isSafeInteger(localRevision)||localRevision<1||localRevision>record.revision||!Number.isSafeInteger(cloudRevision)||cloudRevision<1)throw new ConflictError();
  const old=record.cloud;
  if(old&&cloudRevision<old.revision)return record;
  if(old&&cloudRevision===old.revision&&localRevision<old.syncedRevision)return record;
  return {...record,cloud:{revision:cloudRevision,syncedRevision:localRevision,updatedAt:String(updatedAt||'')}};
}
function cloudRecord(previous,world,cloudRevision,updatedAt,expectedLocalRevision,equal=false){
  if((previous?.revision??0)!==expectedLocalRevision||!Number.isSafeInteger(cloudRevision)||cloudRevision<1)throw new ConflictError();
  if(previous&&previous.cloud&&cloudRevision<previous.cloud.revision)throw new ConflictError();
  if(previous&&equal)return acknowledgeCloud(previous,previous.revision,cloudRevision,updatedAt);
  if(previous&&isCloudDirty(previous))throw new ConflictError();
  const record=commitPrepared(previous,world,expectedLocalRevision);
  record.cloud={revision:cloudRevision,syncedRevision:record.revision,updatedAt:String(updatedAt||'')};
  return record;
}
export async function openWorldStore({validate=validateWorld,onVersionChange=()=>{}}={}){
  if(!globalThis.indexedDB)throw new Error('Браузер не предоставляет IndexedDB. Доступен сеанс в памяти и экспорт, но не автосохранение.');
  const db=await openRetentionDatabase('v07',onVersionChange);
  db.onversionchange=()=>{db.close();onVersionChange();};
  const read=(key)=>new Promise((resolve,reject)=>{const tx=db.transaction('worlds','readonly'),r=key===undefined?tx.objectStore('worlds').getAll():tx.objectStore('worlds').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const metaRead=(key)=>new Promise((resolve,reject)=>{const tx=db.transaction('metadata','readonly'),r=key===undefined?tx.objectStore('metadata').getAll():tx.objectStore('metadata').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const worldKeys=()=>new Promise((resolve,reject)=>{const tx=db.transaction('worlds','readonly'),r=tx.objectStore('worlds').getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const mutate=(id,update)=>new Promise((resolve,reject)=>{const tx=db.transaction(['worlds','metadata','retention','tombstones'],'readwrite'),store=tx.objectStore('worlds'),metadata=tx.objectStore('metadata');let result,error;const req=store.get(id);req.onsuccess=()=>{try{result=update(req.result);store.put(result);writeRetentionMetadata(tx,'v07',result,!!req.result);metadata.put(summaryRecord(result));}catch(e){error=e;tx.abort();}};req.onerror=()=>{error=req.error;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error??tx.error??new Error('Сохранение отменено.'));tx.onerror=()=>{error??=tx.error;};});
  const prepare=async world=>{const snapshot=clone(world);await validate(snapshot);ensureSaveSize(snapshot);return snapshot;};
  // A legacy record is indexed only after a revision-guarded reread.
  const indexLegacy=(row)=>new Promise((resolve,reject)=>{const tx=db.transaction(['worlds','metadata'],'readwrite'),r=tx.objectStore('worlds').get(row.id);r.onsuccess=()=>{if(r.result?.revision===row.revision){const meta=summaryRecord(r.result);if(r.result.world?.id!==row.id){meta.corrupted=true;meta.cloud=null;}tx.objectStore('metadata').put(meta);}};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
  return attachRetentionStore({
    persistent:true,
    async list(){let rows=await metaRead();const known=new Set(rows.map(row=>row.id)),missing=(await worldKeys()).filter(id=>!known.has(id));for(const id of missing.slice(0,8)){const row=await read(id);if(row)await indexLegacy(row);}if(missing.length)rows=await metaRead();rows.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||b.year-a.year);Object.defineProperty(rows,'legacyPending',{value:missing.length>8});return rows;},
    async getMetadata(id){let row=await metaRead(id);if(!row){const legacy=await read(id);if(legacy){if(legacy.id!==id||legacy.world?.id!==id)throw new Error('Локальная запись относится к другому миру.');await indexLegacy(legacy);row=await metaRead(id);}}if(row?.corrupted)throw new Error('Локальная запись относится к другому миру.');return row;},
    async get(id){const row=await read(id);if(row){await validate(row.world);if(row.id!==id||row.world?.id!==id)throw new Error('Локальная запись относится к другому миру.');if(!await metaRead(id))await indexLegacy(row);}return row;},
    async put(world,expectedRevision){const snapshot=await prepare(world);return (await mutate(snapshot.id,previous=>commitPrepared(previous,snapshot,expectedRevision))).revision;},
    async markSynced(id,localRevision,cloudRevision,updatedAt){return mutate(id,previous=>acknowledgeCloud(previous,localRevision,cloudRevision,updatedAt));},
    async receiveCloud(world,cloudRevision,updatedAt,expectedLocalRevision=0){const snapshot=await prepare(world), prior=await read(snapshot.id), equal=!!prior&&JSON.stringify(prior.world)===JSON.stringify(snapshot);return mutate(snapshot.id,previous=>cloudRecord(previous,snapshot,cloudRevision,updatedAt,expectedLocalRevision,equal&&previous?.revision===prior.revision));},
    close(){db.close();}
  },'v07',db);
}

/** Explicit session-only fallback. Never presented as a durable save. */
export function memoryWorldStore({validate=validateWorld}={}){const rows=new Map(),prepare=async w=>{const snapshot=clone(w);await validate(snapshot);ensureSaveSize(snapshot);return snapshot;};return {persistent:false,async list(){return [...rows.values()].map(summaryRecord);},async getMetadata(id){const row=rows.get(id);return row?summaryRecord(row):undefined;},async get(id){const row=rows.has(id)?clone(rows.get(id)):undefined;if(row)await validate(row.world);return row;},async put(world,expected){const snapshot=await prepare(world),record=commitPrepared(rows.get(snapshot.id),snapshot,expected);rows.set(snapshot.id,record);return record.revision;},async markSynced(id,localRevision,cloudRevision,updatedAt){const record=acknowledgeCloud(rows.get(id),localRevision,cloudRevision,updatedAt);rows.set(id,record);return clone(record);},async receiveCloud(world,cloudRevision,updatedAt,expectedLocalRevision=0){const snapshot=await prepare(world),previous=rows.get(snapshot.id),equal=!!previous&&JSON.stringify(previous.world)===JSON.stringify(snapshot),record=cloudRecord(previous,snapshot,cloudRevision,updatedAt,expectedLocalRevision,equal);rows.set(snapshot.id,record);return clone(record);},close(){rows.clear();}};}
