import {retentionHeaders,releaseCloudWorld,rememberCloudLease} from '../../lib/retention-client.mjs';
import {validateWorld, clone} from './core.mjs';
import {MAX_FILE_BYTES, ensureSaveSize} from './storage.mjs';

export class CloudError extends Error {
  constructor(message,status=0){super(message);this.name='CloudError';this.status=status;}
}
export class CloudConflictError extends CloudError {
  constructor(message='В облаке сохранена другая история. Она не перезаписана. Сохраните этот вариант отдельной копией или экспортируйте его.'){super(message,409);this.name='ConflictError';}
}
const API='/api/v06/worlds';
const idPattern=/^(?:local-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRevision=n=>Number.isSafeInteger(n)&&n>0;
const notModifiedReceipts=new WeakSet();
const sameWorld=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function worldPath(id){if(typeof id!=='string'||!idPattern.test(id))throw new CloudError('Неверный идентификатор облачного мира.');return API+'/'+encodeURIComponent(id);}

function allowedPath(path){
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('\\'))return false;
  try{const url=new URL(path,'https://microgalaxy.invalid');if(url.origin!=='https://microgalaxy.invalid'||url.hash||path.split('?')[0]!==url.pathname)return false;
    if(url.pathname===API)return [...url.searchParams.keys()].every(key=>key==='cursor')&&url.searchParams.getAll('cursor').length<=1;
    return url.pathname.startsWith(API+'/')&&idPattern.test(url.pathname.slice(API.length+1))&&!url.search;
  }catch{return false;}
}

// A snapshot remains capped at 24 MiB. The transport envelope carries only a
// small receipt (revision/timestamp), so bound it independently as well.
const MAX_RESPONSE_BYTES=MAX_FILE_BYTES+2048;
async function responseText(response,onReader){
  const declared=Number(response.headers?.get('content-length')??0);
  if(declared>MAX_RESPONSE_BYTES){void response.body?.cancel().catch(()=>{});throw new CloudError('Ответ облака превышает допустимый размер.');}
  if(!response.body){const text=await response.text();if(new TextEncoder().encode(text).length>MAX_RESPONSE_BYTES)throw new CloudError('Ответ облака превышает допустимый размер.');return text;}
  const reader=response.body.getReader();onReader(reader);
  const decoder=new TextDecoder('utf-8',{fatal:true}),fragments=[];let bytes=0,pending=[],pendingBytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_RESPONSE_BYTES)throw new CloudError('Ответ облака превышает допустимый размер.');pending.push(decoder.decode(part.value,{stream:true}));pendingBytes+=part.value.byteLength;
      if(pendingBytes>=65536||pending.length>=256){fragments.push(pending.join(''));pending=[];pendingBytes=0;}}
    pending.push(decoder.decode());fragments.push(pending.join(''));return fragments.join('');
  }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{onReader(null);reader.releaseLock();}
}

/** One deadline covers both headers and body. The client only calls its own Site. */
export async function cloudRequest(path,init={},timeoutMs=6000,fetchImpl=globalThis.fetch){
  if(!allowedPath(path))throw new CloudError('Недопустимый адрес сохранения.');
  if(typeof fetchImpl!=='function')throw new CloudError('Облачное сохранение недоступно.');
  if(init.body!==undefined&&(typeof init.body!=='string'||new TextEncoder().encode(init.body).length>MAX_FILE_BYTES))throw new CloudError('Запрос сохранения превышает 24 МБ или имеет неподдерживаемый формат.');
  const controller=new AbortController();let timer,reader=null;
  const work=(async()=>{
    const response=await fetchImpl(path,{...init,headers:retentionHeaders(init.headers),credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    if(response.status===304){const etag=response.headers?.get('etag'),match=/^"v06-([1-9][0-9]*)"$/.exec(etag||'');const revision=Number(match?.[1]);if(!isRevision(revision)||init.headers?.['If-None-Match']!==etag)throw new CloudError('Неверное подтверждение облачной ревизии.',304);const receipt={notModified:true,revision};notModifiedReceipts.add(receipt);rememberCloudLease('v06',path.split('/').pop(),response.headers?.get?.('x-microgalaxy-lease'));return receipt;}
    const text=await responseText(response,value=>{reader=value;});
    let data;try{data=JSON.parse(text);}catch{throw new CloudError('Сервер вернул неподдерживаемый ответ.',response.status);}
    if(!response.ok){const message=typeof data?.error==='string'?data.error:response.status===401?'Войдите в ChatGPT для облачного сохранения.':'Облако временно недоступно. Локальная история сохранена.';if(response.status===409)throw new CloudConflictError(message);throw new CloudError(message,response.status);}
    rememberCloudLease('v06',data?.id||data?.world?.id,response.headers?.get?.('x-microgalaxy-lease'));
    return data;
  })();
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(new CloudError('Облако не ответило вовремя. Локальная история остаётся на устройстве.'));},timeoutMs);});
  try{return await Promise.race([work,deadline]);}finally{clearTimeout(timer);}
}

export function createCloudClient({fetchImpl=globalThis.fetch,timeoutMs=6000,validate=validateWorld}={}){
  const request=(path,init)=>cloudRequest(path,init,timeoutMs,fetchImpl);
  return {
    async list(cursor=null){
      const data=await request(API+(cursor?'?cursor='+encodeURIComponent(cursor):''));
      if(!data||!Array.isArray(data.worlds)||data.worlds.length>100||!(data.nextCursor===null||data.nextCursor===undefined||typeof data.nextCursor==='string'))throw new CloudError('Не удалось прочитать облачный архив.');
      for(const row of data.worlds)if(!row||!idPattern.test(row.id)||typeof row.name!=='string'||typeof row.seed!=='string'||!Number.isSafeInteger(row.year)||!isRevision(row.revision))throw new CloudError('Облачный архив содержит неподдерживаемую запись.');
      return {...data,nextCursor:data.nextCursor??null};
    },
    async get(id,{revision}={}){
      if(revision!==undefined&&!isRevision(revision))throw new CloudError('Неизвестна ревизия облачной копии.');
      const data=await request(worldPath(id),revision?{headers:{'If-None-Match':`"v06-${revision}"`}}:undefined);
      if(notModifiedReceipts.has(data))return data;
      await validate(data?.world);
      if(data.world.id!==id||!isRevision(data.revision)||typeof data.updatedAt!=='string')throw new CloudError('Не удалось проверить облачное сохранение.');
      return {world:data.world,revision:data.revision,updatedAt:data.updatedAt};
    },
    async save(world,revision=0){
      world=clone(world);await validate(world);ensureSaveSize(world);worldPath(world.id);
      if(!Number.isSafeInteger(revision)||revision<0||revision>2000000000)throw new CloudError('Неизвестна ревизия облачной копии.');
      const data=await request(revision?worldPath(world.id):API,{method:revision?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(revision?{world,revision}:{world})});
      if(!data||data.id!==world.id||!isRevision(data.revision)||typeof data.updatedAt!=='string'||data.revision!==revision+1)throw new CloudError('Ответ сохранения не подтверждён. Локальная копия остаётся доступна.');
      return data;
    }
  };
}

/** A receipt acknowledges the uploaded local revision, never a later local step. */
export function createCloudSync(store,client){
  const inFlight=new Map();
  return {
    sync(id){
      if(inFlight.has(id))return inFlight.get(id);
      const task=(async()=>{
        const meta=store.getMetadata?await store.getMetadata(id):null;
        if(meta?.cloud?.revision>0&&meta.cloud.syncedRevision===meta.revision)return {state:'synced',record:meta};
        const local=await store.get(id);
        if(!local)throw new CloudError('Локальный мир не найден.');
        if(local.cloud?.revision>0&&local.cloud.syncedRevision===local.revision)return {state:'synced',record:local};
        const snapshot=clone(local.world);let result;
        try{result=await client.save(snapshot,local.cloud?.revision??0);}catch(error){
          if(error.status!==409)throw error;
          // A timed-out request may have succeeded. Reconcile only an exact match.
          const remote=await client.get(id);
          if(!sameWorld(snapshot,remote.world))throw error;
          result={id,revision:remote.revision,updatedAt:remote.updatedAt};
        }
        const record=await store.markSynced(id,local.revision,result.revision,result.updatedAt);
        return {state:record.cloud?.syncedRevision===record.revision?'synced':'pending',record};
      })();
      inFlight.set(id,task);
      void task.then(()=>{if(inFlight.get(id)===task)inFlight.delete(id);},()=>{if(inFlight.get(id)===task)inFlight.delete(id);});
      return task;
    }
  };
}
