import {retentionHeaders,releaseCloudWorld,rememberCloudLease} from '../../lib/retention-client.mjs';
import {validateWorld, clone} from './core.mjs';

export class CloudError extends Error {
  constructor(message,status=0){super(message);this.name='CloudError';this.status=status;}
}
export class CloudConflictError extends CloudError {
  constructor(message='В облаке сохранена другая история. Она не перезаписана. Сохраните этот вариант отдельной копией или экспортируйте его.'){super(message,409);this.name='ConflictError';}
}
const API='/api/v03/worlds';
const idPattern=/^(?:local-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRevision=n=>Number.isSafeInteger(n)&&n>0;
const sameWorld=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function worldPath(id){if(typeof id!=='string'||!idPattern.test(id))throw new CloudError('Неверный идентификатор облачного мира.');return API+'/'+encodeURIComponent(id);}

/** One deadline covers both headers and body. The client only calls its own Site. */
export async function cloudRequest(path,init={},timeoutMs=6000,fetchImpl=globalThis.fetch){
  if(typeof path!=='string'||!/^\/api\/v03\/worlds(?:\?|\/|$)/.test(path)||path.includes('..')||path.includes('\\'))throw new CloudError('Недопустимый адрес сохранения.');
  if(typeof fetchImpl!=='function')throw new CloudError('Облачное сохранение недоступно.');
  const controller=new AbortController();let timer;
  const work=(async()=>{
    const response=await fetchImpl(path,{...init,headers:retentionHeaders(init.headers),credentials:'same-origin',cache:'no-store',signal:controller.signal});
    const text=await response.text();
    let data;try{data=JSON.parse(text);}catch{throw new CloudError('Сервер вернул неподдерживаемый ответ.',response.status);}
    if(!response.ok){const message=typeof data?.error==='string'?data.error:response.status===401?'Войдите в ChatGPT для облачного сохранения.':'Облако временно недоступно. Локальная история сохранена.';if(response.status===409)throw new CloudConflictError(message);throw new CloudError(message,response.status);}
    rememberCloudLease('v03',data?.id||data?.world?.id,response.headers?.get?.('x-microgalaxy-lease'));
    return data;
  })();
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new CloudError('Облако не ответило вовремя. Локальная история остаётся на устройстве.'));},timeoutMs);});
  try{return await Promise.race([work,deadline]);}finally{clearTimeout(timer);}
}

export function createCloudClient({fetchImpl=globalThis.fetch,timeoutMs=6000}={}){
  const request=(path,init)=>cloudRequest(path,init,timeoutMs,fetchImpl);
  return {
    async list(cursor=null){
      const data=await request(API+(cursor?'?cursor='+encodeURIComponent(cursor):''));
      if(!data||!Array.isArray(data.worlds)||data.worlds.length>100||!(data.nextCursor===null||data.nextCursor===undefined||typeof data.nextCursor==='string'))throw new CloudError('Не удалось прочитать облачный архив.');
      for(const row of data.worlds)if(!row||!idPattern.test(row.id)||typeof row.name!=='string'||typeof row.seed!=='string'||!Number.isSafeInteger(row.year)||!isRevision(row.revision))throw new CloudError('Облачный архив содержит неподдерживаемую запись.');
      return {...data,nextCursor:data.nextCursor??null};
    },
    async get(id){
      const data=await request(worldPath(id));
      validateWorld(data?.world);
      if(data.world.id!==id||!isRevision(data.revision)||typeof data.updatedAt!=='string')throw new CloudError('Не удалось проверить облачное сохранение.');
      return data;
    },
    async save(world,revision=0){
      validateWorld(world);worldPath(world.id);
      if(!Number.isSafeInteger(revision)||revision<0)throw new CloudError('Неизвестна ревизия облачной копии.');
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
