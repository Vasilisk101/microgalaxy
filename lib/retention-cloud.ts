import {env} from 'cloudflare:workers';
import {DEFAULT_LIMIT_BYTES,LIMIT_OPTIONS_BYTES,planRetention,retentionConfirmation} from './retention-policy.mjs';

import {WORLD_MODELS} from './world-models.mjs';
export const RETENTION_TABLES: Record<string,string> = Object.fromEntries(
  Object.entries(WORLD_MODELS).map(([model, entry]) => [model, entry.table])
);
const idPattern=/^(?:local-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class RetentionError extends Error {constructor(public status:number,public code:string,message:string){super(message);this.name='RetentionError';}}
function binding(){if(!env.DB||!env.BUCKET)throw new RetentionError(503,'storage_unavailable','Облачный архив недоступен.');return {db:env.DB,bucket:env.BUCKET};}
function identity(model:string,id:string){if(!Object.hasOwn(RETENTION_TABLES,model)||!idPattern.test(id))throw new RetentionError(400,'invalid_identity','Неверный идентификатор архива.');}
async function enroll(owner:string){const {db}=binding();await db.prepare('INSERT INTO retention_settings(owner_id) VALUES (?) ON CONFLICT(owner_id) DO NOTHING').bind(owner).run();}
export function retentionProtocol(request:Request){if(request.headers.get('x-microgalaxy-retention')!=='1'||!/^[-a-zA-Z0-9]{8,100}$/.test(request.headers.get('x-microgalaxy-session')||''))return Response.json({code:'client_update_required',error:'Обновите вкладку MICROGALAXY. Старая версия не может безопасно изменять общий архив.'},{status:428,headers:{'Cache-Control':'private, no-store'}});return null;}
export async function cloudLease(owner:string,model:string,id:string,session:string,release=false,expectedVersion?:string){
  identity(model,id);if(!/^[-a-zA-Z0-9]{8,100}$/.test(session))throw new RetentionError(400,'invalid_session','Неверный сеанс архива.');await enroll(owner);const {db}=binding();
  if(release){if(typeof expectedVersion!=='string'||!/^[0-9a-f-]{36}$/i.test(expectedVersion))throw new RetentionError(400,'lease_receipt_required','Неизвестна версия защиты. Откройте архив для подтверждённого снятия старой защиты.');const result=await db.prepare('DELETE FROM retention_leases WHERE owner_id=? AND model=? AND world_id=? AND session=? AND version=?').bind(owner,model,id,session,expectedVersion).run();return result.meta.changes===1;}
  const version=crypto.randomUUID();const result=await db.prepare(`INSERT INTO retention_leases(owner_id,model,world_id,session,created_at,version) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=? AND model=? AND world_id=?) ON CONFLICT(owner_id,model,world_id,session) DO UPDATE SET created_at=excluded.created_at,version=excluded.version`).bind(owner,model,id,session,new Date().toISOString(),version,owner,model,id).run();
  if(result.meta.changes!==1)throw new RetentionError(410,'world_retired','Мир удалён по лимиту. Автоматическое восстановление отключено; сохраните отдельную копию с новым ID.');
  return version;
}
export async function leaseOwnedWorld(owner:string, model:string, id:string, session:string) {
  identity(model,id);
  const {db} = binding();
  const existing = await db.prepare(`SELECT 1 AS found FROM ${RETENTION_TABLES[model]} WHERE owner_id=? AND id=?`).bind(owner,id).first();
  if (!existing) throw new RetentionError(404,'world_not_found','Сохранение не найдено.');
  return cloudLease(owner,model,id,session);
}
export function withCloudLease(response:Response,version:unknown){if(typeof version==='string')response.headers.set('X-Microgalaxy-Lease',version);return response;}
/** Intent exists before any asynchronous R2 upload. An uncertain upload remains protected. */
export async function beginRetentionWrite(owner:string,model:string,id:string,key:string,bytes:number){
  identity(model,id);await enroll(owner);const {db}=binding();
  const result=await db.prepare(`INSERT INTO retention_intents(snapshot_key,owner_id,model,world_id,bytes,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=? AND model=? AND world_id=?)`).bind(key,owner,model,id,bytes,new Date().toISOString(),owner,model,id).run();
  if(result.meta.changes!==1)throw new RetentionError(410,'world_retired','Мир удалён по лимиту; автоматическая загрузка старой копии заблокирована.');
}
export async function abandonKnownFailedWrite(key:string){const {db}=binding();await db.prepare('DELETE FROM retention_intents WHERE snapshot_key=?').bind(key).run();}

type Entry={model:string,id:string,name:string,revision:number,updatedAt:string,snapshot_key:string,previous_snapshot_key:string|null,current_bytes:number|null,previous_bytes:number|null,pinned:number,active:number,pending:number,legacyProtected:number,bytes?:number|null};
async function entries(owner:string):Promise<Entry[]>{
  const {db}=binding(),models=Object.entries(RETENTION_TABLES);
  const selects=models.map(([model,table])=>`SELECT '${model}' model,w.id,w.name,w.revision,w.updated_at updatedAt,w.snapshot_key,w.previous_snapshot_key,e.current_bytes,e.previous_bytes,COALESCE(e.pinned,0) pinned,
      EXISTS(SELECT 1 FROM retention_leases l WHERE l.owner_id=w.owner_id AND l.model='${model}' AND l.world_id=w.id) active,
      EXISTS(SELECT 1 FROM retention_intents i WHERE i.owner_id=w.owner_id AND i.model='${model}' AND i.world_id=w.id) pending,
      (e.world_id IS NULL OR EXISTS(SELECT 1 FROM retention_legacy_guards g WHERE g.owner_id=w.owner_id AND g.model='${model}' AND g.world_id=w.id)) legacyProtected
      FROM ${table} w LEFT JOIN retention_entries e ON e.owner_id=w.owner_id AND e.model='${model}' AND e.world_id=w.id AND e.revision=w.revision AND e.snapshot_key=w.snapshot_key WHERE w.owner_id=?`);
  const rows:Entry[]=[];
  // D1 accepts at most five branches in a compound SELECT.
  for(let i=0;i<selects.length;i+=5){
    const page=selects.slice(i,i+5);
    const {results}=await db.prepare(page.join(' UNION ALL ')).bind(...page.map(()=>owner)).all<Entry>();
    rows.push(...results);
  }
  return rows.map(r=>({...r,bytes:r.current_bytes===null||r.previous_bytes===null?null:r.current_bytes+r.previous_bytes}));
}
async function inventory(owner:string,budget=8){const {db,bucket}=binding();const all=await entries(owner);let done=0;
  for(const r of all.filter(x=>x.bytes===null).slice(0,budget)){
    try{await db.prepare('INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(?,?,?)').bind(owner,r.model,r.id).run();const current=await bucket.head(r.snapshot_key),previous=r.previous_snapshot_key?await bucket.head(r.previous_snapshot_key):{size:0};if(!current||!previous)continue;
      await db.prepare(`INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
        SELECT ?,?,id,revision,snapshot_key,previous_snapshot_key,?,?,0,updated_at FROM ${RETENTION_TABLES[r.model]} WHERE owner_id=? AND id=? AND revision=? AND snapshot_key=? AND COALESCE(previous_snapshot_key,'')=?
        ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at`)
        .bind(owner,r.model,current.size,previous.size,owner,r.id,r.revision,r.snapshot_key,r.previous_snapshot_key||'').run();done++;
    }catch{/* Missing/uncertain legacy snapshots remain unknown and protected. */}
  }return done;
}
async function garbageCollect(owner:string,budget=8){const {db,bucket}=binding();const {results}=await db.prepare('SELECT snapshot_key FROM retention_garbage WHERE owner_id=? ORDER BY created_at,snapshot_key LIMIT ?').bind(owner,budget).all<{snapshot_key:string}>();let removed=0;
  for(const {snapshot_key:key} of results){
    // All pointers are immutable random keys; a tombstone cannot be revived.
    const references=Object.values(RETENTION_TABLES).map(t=>`EXISTS(SELECT 1 FROM ${t} WHERE snapshot_key=? OR previous_snapshot_key=?)`);
    const live=await db.prepare(`SELECT 1 AS found WHERE EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=?) OR ${references.join(' OR ')}`).bind(key,...Object.values(RETENTION_TABLES).flatMap(()=>[key,key])).first();
    if(live)continue;try{await bucket.delete(key);await db.prepare('DELETE FROM retention_garbage WHERE snapshot_key=? AND owner_id=?').bind(key,owner).run();removed++;}catch{}
  }return removed;
}
export async function cloudRetentionStatus(owner:string){await enroll(owner);const {db}=binding();const settings=await db.prepare('SELECT limit_bytes FROM retention_settings WHERE owner_id=?').bind(owner).first<{limit_bytes:number}>(),rows=await entries(owner),limitBytes=settings?.limit_bytes??DEFAULT_LIMIT_BYTES;
  const plan=planRetention(rows,limitBytes);const pending=await db.prepare('SELECT COUNT(*) count FROM retention_intents WHERE owner_id=?').bind(owner).first<{count:number}>(),garbage=await db.prepare('SELECT COUNT(*) count FROM retention_garbage WHERE owner_id=?').bind(owner).first<{count:number}>();
  const {results:leases}=await db.prepare('SELECT model,world_id,session,version FROM retention_leases WHERE owner_id=? ORDER BY session').bind(owner).all<{model:string,world_id:string,session:string,version:string}>();
  const {results:lastNotice}=await db.prepare('SELECT model,world_id id,name,bytes,deleted_at deletedAt FROM retention_notices WHERE owner_id=? ORDER BY deleted_at DESC,model,world_id LIMIT 10').bind(owner).all();
  return {...plan,remove:undefined,scope:'cloud',maintenance:garbage?.count||plan.unknownCount||plan.remove.length?'pending':'complete',accounting:'logical-current-and-previous-json',physicalR2UsageKnown:false,uncertainWrites:pending?.count||0,garbagePending:garbage?.count||0,lastNotice,legacyProtectedCount:rows.filter(r=>r.legacyProtected).length,records:rows.map(({snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,...r})=>({...r,protection:{revision:r.revision,pinned:!!r.pinned,legacyProtected:!!r.legacyProtected,sessions:leases.filter(l=>l.model===r.model&&l.world_id===r.id).map(l=>l.session),leaseVersions:leases.filter(l=>l.model===r.model&&l.world_id===r.id).map(l=>l.version)}}))};
}
export async function inventoryCloudRetention(owner:string) {
  await enroll(owner);
  await inventory(owner,8);
  return cloudRetentionStatus(owner);
}
export async function pruneCloudRetention(owner:string,protect?:{model:string,id:string},inventoryBudget=0, approved?:Set<string>){await enroll(owner);if(inventoryBudget)await inventory(owner,inventoryBudget);const status=await cloudRetentionStatus(owner),{db}=binding(),rows=await entries(owner),deleted=[];
  for(const r of rows)if(protect?.model===r.model&&protect.id===r.id)r.active=1;
  const plan=planRetention(rows,status.limitBytes);
  for(const candidate of plan.remove){if(approved&&!approved.has(JSON.stringify([candidate.model,candidate.id,candidate.revision,candidate.bytes])))continue;const row=rows.find(r=>r.model===candidate.model&&r.id===candidate.id)!;try{
    const result=await db.prepare(`DELETE FROM ${RETENTION_TABLES[row.model]} WHERE owner_id=? AND id=? AND revision=? AND snapshot_key=?
      AND NOT EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=? AND model=? AND world_id=?)
      AND NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=? AND model=? AND world_id=?)
      AND NOT EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=? AND model=? AND world_id=?)
      AND EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=? AND model=? AND world_id=? AND pinned=0 AND revision=? AND snapshot_key=? AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
      AND (SELECT COALESCE(SUM(current_bytes+previous_bytes),0) FROM retention_entries WHERE owner_id=?)>(SELECT limit_bytes FROM retention_settings WHERE owner_id=?)`)
      .bind(owner,row.id,row.revision,row.snapshot_key,owner,row.model,row.id,owner,row.model,row.id,owner,row.model,row.id,owner,row.model,row.id,row.revision,row.snapshot_key,owner,owner).run();
    if(result.meta.changes>0)deleted.push({model:row.model,id:row.id,name:row.name,bytes:row.bytes});
  }catch{/* Concurrent pin/open/write wins. Never broaden a failed deletion. */}}
  await garbageCollect(owner);return {...await cloudRetentionStatus(owner),deleted};
}
export async function afterRetentionWrite(owner:string,model:string,id:string){try{return await pruneCloudRetention(owner,{model,id},2);}catch{return {blocked:true,complete:false,warning:'Сохранено; общий учёт временно недоступен.'};}}
export async function setCloudRetentionLimit(owner:string,limit:number,confirmation?:string) {
  if(!LIMIT_OPTIONS_BYTES.includes(limit))throw new RetentionError(400,'invalid_limit','Выберите 50, 100, 200 или 500 МиБ.');
  const {db}=binding();
  const status=await cloudRetentionStatus(owner),plan=planRetention(status.records,limit);
  const changed=()=>new RetentionError(409,'retention_changed','Состав архива изменился. Откройте предварительный список снова.');
  if(confirmation!==undefined&&(typeof confirmation!=='string'||confirmation!==await retentionConfirmation(status.records,status.limitBytes,limit)))throw changed();
  const update=await db.prepare('UPDATE retention_settings SET limit_bytes=? WHERE owner_id=? AND limit_bytes=?').bind(limit,owner,status.limitBytes).run();
  if(update.meta.changes!==1)throw changed();
  const previous={...status,...plan,remove:undefined,deleted:[] as {model:string,id:string,name:string,bytes?:number|null}[]};
  function receipt<T extends typeof previous>(state:T,unconfirmed=false){
    const pending=unconfirmed||state.garbagePending>0||state.unknownCount>0||state.knownBytes>limit&&!state.blocked;
    return {...state,settingsSaved:true,maintenance:pending?'pending':'complete',
      warning:unconfirmed?'Лимит сохранён. Обслуживание архива не завершено; обновите учёт. Список отражает состояние до обслуживания.':
        pending?'Лимит сохранён. Часть обслуживания архива ожидает следующего прохода.':''};
  }
  // Raising or reapplying a setting never needs to retire a world or touch R2.
  if(limit>=status.limitBytes)return receipt(previous);
  const approved=confirmation===undefined?undefined:new Set<string>(plan.remove.map(r=>JSON.stringify([r.model,r.id,r.revision,r.bytes])));
  try{return receipt(await pruneCloudRetention(owner,undefined,confirmation===undefined?8:0,approved));}
  catch{return receipt(previous,true);}

}
export async function setCloudPinned(owner:string,model:string,id:string,pinned:boolean){identity(model,id);if(typeof pinned!=='boolean')throw new RetentionError(400,'invalid_pin','Неверный флаг закрепления.');await enroll(owner);const {db}=binding();
  await db.prepare(`INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) SELECT owner_id,?,id FROM ${RETENTION_TABLES[model]} w WHERE owner_id=? AND id=? AND NOT EXISTS(SELECT 1 FROM retention_entries e WHERE e.owner_id=w.owner_id AND e.model=? AND e.world_id=w.id)`).bind(model,owner,id,model).run();
  const result=await db.prepare(`INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at) SELECT ?,?,id,revision,snapshot_key,previous_snapshot_key,NULL,NULL,?,updated_at FROM ${RETENTION_TABLES[model]} WHERE owner_id=? AND id=? ON CONFLICT(owner_id,model,world_id) DO UPDATE SET pinned=excluded.pinned`).bind(owner,model,pinned?1:0,owner,id).run();if(result.meta.changes!==1)throw new RetentionError(404,'world_not_found','Сохранение не найдено; закрепление не изменено.');return cloudRetentionStatus(owner);
}

/** Explicit per-world acknowledgement. One D1 batch atomically compares the
 * exact observed protection state; no expiry and no account-wide lease reset. */
export async function adoptCloudWorld(owner:string,model:string,id:string,session:string,revision:number,observed:{revision:number,pinned:boolean,legacyProtected:boolean,sessions:string[],leaseVersions:string[]},acknowledge:boolean){
  identity(model,id);if(acknowledge!==true||!observed||!Number.isSafeInteger(revision)||revision<1||observed.revision!==revision||typeof observed.pinned!=='boolean'||typeof observed.legacyProtected!=='boolean'||!Array.isArray(observed.sessions)||observed.sessions.length>64||new Set(observed.sessions).size!==observed.sessions.length||observed.sessions.some(s=>typeof s!=='string'||!/^[-a-zA-Z0-9]{8,100}$/.test(s)))throw new RetentionError(400,'acknowledgement_required','Подтвердите, что другие вкладки этого мира закрыты, а изменения сохранены или экспортированы.');
  if(!Array.isArray(observed.leaseVersions)||observed.leaseVersions.length!==observed.sessions.length||observed.leaseVersions.some(v=>typeof v!=='string'||v.length>100))throw new RetentionError(400,'invalid_protection','Обновите сведения о защите.');
  await enroll(owner);const {db}=binding(),token=crypto.randomUUID(),sessions=observed.sessions;
  const matches=`NOT EXISTS(SELECT 1 FROM retention_leases l WHERE owner_id=? AND model=? AND world_id=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$[0]')=l.session AND json_extract(j.value,'$[1]')=l.version))`;
  const insert=db.prepare(`INSERT INTO retention_adoptions(token,owner_id,model,world_id) SELECT ?,?,?,? FROM ${RETENTION_TABLES[model]} w JOIN retention_entries e ON e.owner_id=w.owner_id AND e.model=? AND e.world_id=w.id AND e.revision=w.revision AND e.snapshot_key=w.snapshot_key
    WHERE w.owner_id=? AND w.id=? AND w.revision=? AND e.pinned=? AND e.current_bytes IS NOT NULL AND e.previous_bytes IS NOT NULL
    AND EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=? AND model=? AND world_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=? AND model=? AND world_id=?)
    AND (SELECT COUNT(*) FROM retention_leases WHERE owner_id=? AND model=? AND world_id=?)=? AND ${matches}`)
    .bind(token,owner,model,id,model,owner,id,revision,observed.pinned?1:0,owner,model,id,observed.legacyProtected?1:0,owner,model,id,owner,model,id,sessions.length,owner,model,id,JSON.stringify(sessions.map((s,i)=>[s,observed.leaseVersions[i]])));
  const operations=[insert,db.prepare('DELETE FROM retention_leases WHERE owner_id=? AND model=? AND world_id=? AND session<>? AND EXISTS(SELECT 1 FROM retention_adoptions WHERE token=?)').bind(owner,model,id,session,token),db.prepare('DELETE FROM retention_legacy_guards WHERE owner_id=? AND model=? AND world_id=? AND EXISTS(SELECT 1 FROM retention_adoptions WHERE token=?)').bind(owner,model,id,token),db.prepare('DELETE FROM retention_adoptions WHERE token=?').bind(token)];
  const results=await db.batch(operations);if(results[0].meta.changes!==1)throw new RetentionError(409,'protection_changed','Мир, закрепление или открытые сеансы изменились. Обновите архив и проверьте защиту заново.');
  return pruneCloudRetention(owner);
}
