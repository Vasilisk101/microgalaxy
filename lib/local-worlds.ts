import { validateWorld, getWorldStats, type World } from './simulation.ts';
import {openRetentionDatabase, assertLocalNotDeleted, writeRetentionMetadata, pruneLocalAfterWrite} from './local-retention.mjs';
import {withRetentionLock, acquireWorldLease} from './local-retention-locks.mjs';

export type LocalWorld = { world: World; revision: number; updatedAt: string; syncedYear: number; recoveryOf?: string };
export type LocalWorldSummary={id:string,name:string,seed:string,year:number,population:number,era:string,revision:number,updatedAt:string,local:boolean};
export type LocalWorldCatalogueEntry={id:string,summary:LocalWorldSummary|null};
function localSummary(row:LocalWorld):LocalWorldSummary{const stats=getWorldStats(row.world);return {id:row.world.id,name:row.world.name,seed:row.world.seed,year:row.world.year,population:stats.population,era:stats.era,revision:row.revision,updatedAt:row.updatedAt,local:row.revision===0||row.world.year>row.syncedYear};}
export type LocalSaveOptions = { replace?: boolean; preserveReplaced?: boolean; recoveryId?: string };
export type LocalSaveResult =
  | { status: 'written' | 'identical'; record: LocalWorld; recovery?: LocalWorld }
  | { status: 'superseded'; record: LocalWorld };
export type PreservedLocalSaveResult =
  | Exclude<LocalSaveResult, { status: 'superseded' }>
  | { status: 'recovered'; record: LocalWorld; current: LocalWorld };
function openDatabase(): Promise<IDBDatabase> {
  return openRetentionDatabase('classic') as Promise<IDBDatabase>;
}
const activeLocalWorlds = new Map<string, () => Promise<void>>();
async function holdWorld(id: string) { if (!activeLocalWorlds.has(id)) activeLocalWorlds.set(id,await acquireWorldLease('classic',id)); }
export async function releaseLocalWorld(id: string) { return withRetentionLock(async()=>{const release=activeLocalWorlds.get(id);if(release){activeLocalWorlds.delete(id);await release();}}); }
function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameData(a[key], b[key]));
}

function sameWorld(left: World, right: World, ignoreId = false): boolean {
  if (left.year !== right.year) return false;
  if (!ignoreId) return sameData(left, right);
  return sameData({ ...left, id: '' }, { ...right, id: '' });
}

function mergeMetadata(previous: LocalWorld, record: LocalWorld): LocalWorld {
  return {
    ...previous,
    ...record,
    revision: Math.max(previous.revision, record.revision),
    syncedYear: Math.min(record.world.year, Math.max(previous.syncedYear, record.syncedYear)),
    updatedAt: previous.updatedAt > record.updatedAt ? previous.updatedAt : record.updatedAt,
  };
}

/** A skipped stale write is explicit: it must not be counted as a durable save. */
export function saveLocalWorld(record: LocalWorld, options: LocalSaveOptions = {}): Promise<LocalSaveResult> {
  return writeLocalWorld(record, options, false) as Promise<LocalSaveResult>;
}

/**
 * Preserve an incoming snapshot even when another tab owns a newer revision.
 * Reuse recoveryId for subsequent checkpoints of the same active history.
 * The returned recovery may already be at a later year of that history.
 */
export function preserveLocalWorld(record: LocalWorld, recoveryId?: string): Promise<PreservedLocalSaveResult> {
  return writeLocalWorld(record, { recoveryId }, true) as Promise<PreservedLocalSaveResult>;
}

async function writeLocalWorld(record: LocalWorld, options: LocalSaveOptions, preserveIncoming: boolean): Promise<LocalSaveResult | PreservedLocalSaveResult> {
  const snapshot=structuredClone(record), detachedOptions={...options};
  return withRetentionLock(async()=>{
    await holdWorld(snapshot.world.id);
    const check=await openDatabase();
    try { await assertLocalNotDeleted(check,snapshot.world.id);if(detachedOptions.recoveryId)await assertLocalNotDeleted(check,detachedOptions.recoveryId); }finally{check.close();}
    const result=await writeLocalWorldUncoordinated(snapshot,detachedOptions,preserveIncoming);
    if('recovery' in result&&result.recovery)await holdWorld(result.recovery.world.id);
    if(result.status==='recovered')await holdWorld(result.record.world.id);
    try { await pruneLocalAfterWrite('classic',result.record.world.id); }catch{}
    return result;
  });
}
async function writeLocalWorldUncoordinated(record: LocalWorld, options: LocalSaveOptions, preserveIncoming: boolean): Promise<LocalSaveResult | PreservedLocalSaveResult> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['worlds','metadata','retention','tombstones'], 'readwrite');
    const store = tx.objectStore('worlds');
    const existingIds=new Set<string>();
    const put=(row: LocalWorld)=>{store.put(row);tx.objectStore('metadata').put({...localSummary(row),catalogVersion:1});writeRetentionMetadata(tx,'classic',row,existingIds.has(row.world.id));};
    let result: LocalSaveResult | PreservedLocalSaveResult | undefined;
    let failure: Error | undefined;
    const fail = (error: unknown) => {
      failure = error instanceof Error ? error : new Error('Не удалось сохранить локальную копию');
      tx.abort();
    };

    // The original and its recovery copy share one transaction. A concurrent
    // writer cannot slip a newer snapshot between the backup and replacement.
    const preserve = (source: LocalWorld, preferredId: string | undefined, done: (recovery: LocalWorld) => void, attempts = 0) => {
      const id = preferredId ?? crypto.randomUUID();
      if (id === source.world.id || id === record.world.id) {
        fail(new Error('Резервной копии нужен отдельный идентификатор')); return;
      }
      const originId = source.recoveryOf ?? source.world.id;
      const recovery: LocalWorld = {
        world: { ...source.world, id }, revision: 0, syncedYear: -1,
        updatedAt: source.updatedAt, recoveryOf: originId,
      };
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          const existing = request.result as LocalWorld | undefined;
          if(existing)existingIds.add(id);
          if (existing && !validateWorld(existing.world)) {
            if (attempts >= 3) throw new Error('Не удалось выделить отдельное сохранение без замены повреждённой записи');
            preserve(source, undefined, done, attempts + 1); return;
          }
          if (existing && validateWorld(existing.world)) {
            const belongs = existing.recoveryOf === originId && existing.world.seed === source.world.seed &&
              existing.world.engineVersion === source.world.engineVersion && existing.world.startEpoch === source.world.startEpoch;
            if (belongs && sameWorld(existing.world, recovery.world)) { done(existing); return; }
            // Checkpoints of one deterministic history can arrive out of order.
            if (belongs && existing.world.year > recovery.world.year) { done(existing); return; }
            if (!belongs || existing.revision > 0 || existing.world.year === recovery.world.year) {
              if (attempts >= 3) throw new Error('Не удалось выделить отдельное сохранение');
              preserve(source, undefined, done, attempts + 1); return;
            }
          }
          put(recovery); done(recovery);
        } catch (error) { fail(error); }
      };
    };

    const current = store.get(record.world.id);
    current.onsuccess = () => {
      try {
        const found = current.result as LocalWorld | undefined;
        if(found)existingIds.add(record.world.id);
        if (found && !validateWorld(found.world)) {
          throw new Error('Местная запись повреждена и оставлена без изменений. Для восстановления нужна отдельная копия мира.');
        }
        const previous = found && validateWorld(found.world) ? found : undefined;
        if (previous && sameWorld(previous.world, record.world)) {
          const merged = mergeMetadata(previous, record);
          put(merged); result = { status: 'identical', record: merged }; return;
        }
        if (previous && options.replace && options.preserveReplaced && previous.world.year > previous.syncedYear) {
          preserve(previous, options.recoveryId, recovery => {
            put(record); result = { status: 'written', record, recovery };
          }); return;
        }
        if (previous && !options.replace &&
          (previous.world.year >= record.world.year || previous.revision > record.revision)) {
          if (preserveIncoming) preserve(record, options.recoveryId, recovery => {
            result = { status: 'recovered', record: recovery, current: previous };
          });
          else result = { status: 'superseded', record: previous };
          return;
        }
        const next = previous && !options.replace ? mergeMetadata(previous, record) : record;
        put(next); result = { status: 'written', record: next };
      } catch (error) { fail(error); }
    };
    tx.oncomplete = () => {
      db.close();
      if (result) resolve(result);
      else reject(new Error('Локальное сохранение не завершено'));
    };
    tx.onerror = () => { db.close(); reject(new Error('Не удалось сохранить локальную копию')); };
    tx.onabort = () => { db.close(); reject(failure ?? new Error('Локальное сохранение прервано')); };
  });
}
export async function getLocalWorld(id: string): Promise<LocalWorld | null> {
  return withRetentionLock(async()=>{await holdWorld(id);return getLocalWorldHeld(id);});
}
async function getLocalWorldHeld(id: string): Promise<LocalWorld | null> {
  const db = await openDatabase();
  try { await assertLocalNotDeleted(db,id);const row=await new Promise<LocalWorld|null>((resolve,reject)=>{const tx=db.transaction('worlds','readonly'),req=tx.objectStore('worlds').get(id);tx.oncomplete=()=>resolve(req.result&&validateWorld(req.result.world)?req.result:null);tx.onabort=()=>reject(tx.error);req.onerror=()=>reject(req.error);});if(row)await indexClassicRow(db,row);return row;}finally{db.close();}
}
async function indexClassicRow(db:IDBDatabase,row:LocalWorld){return new Promise<void>((resolve,reject)=>{const tx=db.transaction(['worlds','metadata'],'readwrite'),r=tx.objectStore('worlds').get(row.world.id);r.onsuccess=()=>{if(r.result?.revision===row.revision&&r.result?.updatedAt===row.updatedAt)tx.objectStore('metadata').put({...localSummary(row),catalogVersion:1});};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}
/** Catalogues never materialize full world payloads. Unknown legacy metadata is
 * an explicit null summary, not a fabricated simulation World. */
export async function getLocalWorlds(): Promise<LocalWorldCatalogueEntry[]> {
  const db=await openDatabase();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(['worlds','metadata'],'readonly'),keys=tx.objectStore('worlds').getAllKeys(),metas=tx.objectStore('metadata').getAll();tx.oncomplete=()=>{const rows=new Map((metas.result as (LocalWorldSummary&{catalogVersion?:number})[]).filter(r=>r.catalogVersion===1).map(r=>[r.id,r]));resolve(keys.result.map(id=>({id:String(id),summary:rows.get(String(id))??null})).sort((a,b)=>(b.summary?.updatedAt||'').localeCompare(a.summary?.updatedAt||'')||a.id.localeCompare(b.id)));};tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function indexLocalWorldMetadata(limit=2):Promise<number>{return withRetentionLock(async()=>{const entries=await getLocalWorlds(),db=await openDatabase();let indexed=0;try{for(const entry of entries.filter(r=>!r.summary).slice(0,Math.max(0,Math.min(8,limit)))){const row=await new Promise<LocalWorld|undefined>((resolve,reject)=>{const tx=db.transaction('worlds','readonly'),r=tx.objectStore('worlds').get(entry.id);tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);});if(row&&validateWorld(row.world)){await indexClassicRow(db,row);indexed++;}}return indexed;}finally{db.close();}});}
