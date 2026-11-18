import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {retentionTestModule} from './retention-test-loader.ts';
import {retentionConfirmation} from '../lib/retention-policy.mjs';
type Retention=typeof import('../lib/retention-cloud.ts');
test('committed settings return a receipt, leaving unrelated maintenance and protected worlds intact',async()=>{
  const f=fixture();
  try{
    for(let n=1;n<=45;n++)f.seed(n,'v08','owner-a',2*MB);
    const old=f.seed(46,'v03','owner-a',null);await f.api.setCloudPinned('owner-a','v03',old.id,true);
    const dbBefore=f.sql.prepare('SELECT COUNT(*) n FROM worlds_v08').get()?.n;
    const heads=f.headCalls;
    for(let n=0;n<2;n++){
      const status=await f.api.setCloudRetentionLimit('owner-a',500*MB);
      assert.equal(status.settingsSaved,true);assert.equal(status.maintenance,'pending');assert.equal(status.limitBytes,500*MB);
      assert.equal(status.records.length,46);assert.equal(f.headCalls,heads);assert.deepEqual(f.deleted,[]);
    }
    let committed=false;
    f.setHook(s=>{if(s.startsWith('UPDATE retention_settings'))committed=true;else if(committed)throw Error('maintenance temporarily unavailable');});
    const preview=await f.api.cloudRetentionStatus('owner-a');
    const receipt=await f.api.setCloudRetentionLimit('owner-a',50*MB,await retentionConfirmation(preview.records,preview.limitBytes,50*MB));
    assert.equal(receipt.settingsSaved,true);assert.equal(receipt.maintenance,'pending');assert.match(receipt.warning,/не завершено/);
    assert.equal(f.sql.prepare('SELECT limit_bytes FROM retention_settings WHERE owner_id=?').get('owner-a')?.limit_bytes,50*MB);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM worlds_v08').get()?.n,dbBefore);
    assert.deepEqual(f.deleted,[]);
  }finally{f.close();}
});
const MB=1048576,id=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
function fixture(){
  const sql=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
  const objects=new Map<string,{size:number}>(),deleted:string[]=[];let hook:((s:string)=>void)|undefined,headCalls=0;
  const db={async batch(operations:{run:()=>Promise<unknown>}[]){sql.exec('BEGIN');try{const results=[];for(const op of operations)results.push(await op.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}},prepare(statement:string){if(statement.split(' UNION ALL ').length>5)throw Error('D1: too many terms in compound SELECT');return{bind(...args:SQLInputValue[]){return{
    async all(){return {results:sql.prepare(statement).all(...args)};},async first(){return sql.prepare(statement).get(...args)||null;},async run(){hook?.(statement);const r=sql.prepare(statement).run(...args);return{meta:{changes:Number(r.changes)}};},
  };}};}};
  const bucket={async head(key:string){headCalls++;return objects.get(key)||null;},async delete(key:string){objects.delete(key);deleted.push(key);}};
  const api=retentionTestModule({'cloudflare:workers':{env:{DB:db,BUCKET:bucket}}}) as Retention;
  function seed(n:number,model='v08',owner='owner-a',bytes:number|null=30*MB,date=`2026-01-${String(n).padStart(2,'0')}T00:00:00.000Z`){
    const worldId=id(n),key=`${model}/${owner}/${worldId}/one.json`,table=model==='classic'?'worlds':'worlds_'+model;
    if(bytes!==null)sql.prepare('INSERT INTO retention_intents VALUES (?,?,?,?,?,?)').run(key,owner,model,worldId,bytes,date);
    if(model==='classic')sql.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(worldId,owner,'World '+n,'seed',0,100,'era',1,key,null,date,date);
    else sql.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(worldId,owner,'World '+n,'seed','agriculture','schema',model,0,100,'era',1,key,null,date,date);
    objects.set(key,{size:bytes??20*MB});return {id:worldId,key,model,owner};
  }
  return {sql,api,seed,objects,deleted,setHook(fn?:((s:string)=>void)){hook=fn;},get headCalls(){return headCalls;},close(){sql.close();}};
}
test('SQL retention orders oldest last-save across models; equal IDs do not collide and writer survives',async()=>{
  const f=fixture();try{const a=f.seed(1,'v03'),b=f.seed(1,'v08','owner-a',30*MB,'2026-02-01T00:00:00Z'),c=f.seed(2,'classic');
    const status=await f.api.setCloudRetentionLimit('owner-a',50*MB);
    assert.deepEqual(status.deleted.map(x=>[x.model,x.id]),[['v03',a.id],['classic',c.id]]);assert.equal(status.knownBytes,30*MB);assert.equal(f.sql.prepare('SELECT id FROM worlds_v08 WHERE id=?').get(b.id)?.id,b.id);
    assert.equal(f.deleted.length,2);assert.ok(f.objects.has(b.key));
  }finally{f.close();}
});

test('inventory above quota measures legacy objects without running deletion or garbage collection',async()=>{
  const f=fixture();
  try {
    await f.api.setCloudRetentionLimit('owner-a',50*MB);
    f.seed(1,'v08','owner-a',35*MB);f.seed(2,'v03','owner-a',35*MB);
    const status=await f.api.inventoryCloudRetention('owner-a');
    assert.equal(status.knownBytes,70*MB);assert.equal(status.records.length,2);assert.equal(f.deleted.length,0);
    const applied=await f.api.pruneCloudRetention('owner-a');
    assert.deepEqual(applied.deleted.map(r=>r.id),[id(1)]);
  } finally {f.close();}
});
test('a changed candidate invalidates the confirmed quota preview before any world or limit is changed',async()=>{
  const f=fixture();try{
    const first=f.seed(1),second=f.seed(2);
    const before=await f.api.inventoryCloudRetention('owner-a'),limit=50*MB;
    const token=await retentionConfirmation(before.records,before.limitBytes,limit);
    await f.api.setCloudPinned('owner-a','v08',first.id,true);
    await assert.rejects(f.api.setCloudRetentionLimit('owner-a',limit,token),{status:409,code:'retention_changed'});
    const now=await f.api.cloudRetentionStatus('owner-a');
    assert.equal(now.limitBytes,200*MB);assert.equal(now.records.length,2);
    const accepted=await f.api.setCloudRetentionLimit('owner-a',limit,await retentionConfirmation(now.records,now.limitBytes,limit));
    assert.deepEqual(accepted.deleted.map(r=>r.id),[second.id]);
  }finally{f.close();}
});
test('pins, genuine cloud leases, pending/uncertain writes and unknown inventory are protected, owner quotas isolated',async()=>{
  const f=fixture();try{const pinned=f.seed(1),active=f.seed(2),pending=f.seed(3),unknown=f.seed(4,'v03','owner-a',null);f.objects.delete(unknown.key);f.seed(5,'v08','owner-b',100*MB);
    await f.api.setCloudPinned('owner-a','v08',pinned.id,true);await f.api.cloudLease('owner-a','v08',active.id,'live-session');await f.api.beginRetentionWrite('owner-a','v08',pending.id,'pending-upload',123);
    const s=await f.api.setCloudRetentionLimit('owner-a',50*MB);assert.equal(s.deleted.length,0);assert.equal(s.knownBytes,90*MB);assert.equal(s.unknownCount,1);assert.equal(s.blocked,true);assert.equal(s.complete,false);assert.equal(s.uncertainWrites,1);assert.equal(s.physicalR2UsageKnown,false);
    assert.equal((await f.api.cloudRetentionStatus('owner-b')).knownBytes,100*MB);assert.equal(f.objects.size,4);
  }finally{f.close();}
});
test('pin racing with pruning wins at atomic D1 delete; no premature R2 deletion',async()=>{
  const f=fixture();try{const a=f.seed(1),b=f.seed(2);await f.api.cloudRetentionStatus('owner-a');await f.api.cloudLease('owner-a','v08',b.id,'active-current');f.sql.prepare('UPDATE retention_settings SET limit_bytes=? WHERE owner_id=?').run(50*MB,'owner-a');
    f.setHook(statement=>{if(statement.startsWith('DELETE FROM worlds_v08')){f.setHook();f.sql.prepare('UPDATE retention_entries SET pinned=1 WHERE world_id=?').run(a.id);}});
    const result=await f.api.pruneCloudRetention('owner-a',{model:'v08',id:b.id});assert.equal(result.deleted.length,0);assert.ok(f.objects.has(a.key));assert.equal(result.blocked,true);
  }finally{f.close();}
});
test('newer snapshot racing with cleanup survives revision-and-pointer CAS',async()=>{
  const f=fixture();try{const a=f.seed(1),b=f.seed(2);await f.api.cloudRetentionStatus('owner-a');f.sql.prepare('UPDATE retention_settings SET limit_bytes=?').run(50*MB);const newKey=a.key+'new';
    f.setHook(statement=>{if(statement.startsWith('DELETE FROM worlds_v08')){f.setHook();f.objects.set(newKey,{size:MB});f.sql.prepare('INSERT INTO retention_intents VALUES (?,?,?,?,?,?)').run(newKey,'owner-a','v08',a.id,MB,'2026-03-01T00:00:00Z');f.sql.prepare('UPDATE worlds_v08 SET revision=revision+1,previous_snapshot_key=snapshot_key,snapshot_key=?,updated_at=? WHERE id=?').run(newKey,'2026-03-01T00:00:00Z',a.id);}});
    const s=await f.api.pruneCloudRetention('owner-a',{model:'v08',id:b.id});assert.equal(s.deleted.length,0);assert.ok(f.objects.has(newKey));assert.equal(f.sql.prepare('SELECT revision FROM worlds_v08 WHERE id=?').get(a.id)?.revision,2);
  }finally{f.close();}
});
test('concurrent cleanup cannot delete beyond the live owner quota',async()=>{
  const f=fixture();try{f.seed(1,'v03','owner-a',20*MB);f.seed(2,'v04','owner-a',20*MB);f.seed(3,'v08','owner-a',20*MB);await f.api.cloudRetentionStatus('owner-a');f.sql.prepare('UPDATE retention_settings SET limit_bytes=?').run(50*MB);
    await Promise.all([f.api.pruneCloudRetention('owner-a'),f.api.pruneCloudRetention('owner-a')]);const s=await f.api.cloudRetentionStatus('owner-a');assert.equal(s.knownBytes,40*MB);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM retention_tombstones').get()?.n,1);
  }finally{f.close();}
});
test('tombstones reject automatic resurrection and obsolete SQL clients are fenced',async()=>{
  const f=fixture();try{const a=f.seed(1);f.seed(2);await f.api.setCloudRetentionLimit('owner-a',50*MB);
    await assert.rejects(f.api.beginRetentionWrite('owner-a','v08',a.id,'resurrect',100),{status:410,code:'world_retired'});await assert.rejects(f.api.cloudLease('owner-a','v08',a.id,'old-session'),{status:410});
    assert.throws(()=>f.sql.prepare('UPDATE worlds_v08 SET revision=revision+1 WHERE owner_id=?').run('owner-a'),/retention_protocol_required/);
    assert.equal(f.api.retentionProtocol(new Request('https://example.test/api/v08/worlds'))?.status,428);
    assert.equal(f.api.retentionProtocol(new Request('https://example.test/api/v08/worlds',{headers:{'x-microgalaxy-retention':'1','x-microgalaxy-session':'live-session'}})),null);
  }finally{f.close();}
});
test('legacy inventory is bounded and exact target pin does not depend on first-eight indexing',async()=>{
  const f=fixture();try{for(let n=1;n<=12;n++)f.seed(n,'v03','owner-a',null);await f.api.setCloudPinned('owner-a','v03',id(12),true);assert.equal(f.sql.prepare('SELECT pinned FROM retention_entries WHERE world_id=?').get(id(12))?.pinned,1);
    const s=await f.api.pruneCloudRetention('owner-a',undefined,8);assert.equal(f.headCalls,8);assert.equal(s.unknownCount,4);assert.ok(f.sql.prepare('SELECT id FROM worlds_v03 WHERE id=?').get(id(12)));
    await assert.rejects(f.api.setCloudPinned('owner-b','v03',id(12),true),{status:404});assert.equal(f.sql.prepare('SELECT pinned FROM retention_entries WHERE owner_id=? AND world_id=?').get('owner-a',id(12))?.pinned,1);
  }finally{f.close();}
});
test('uncertain uploads/orphans are retained; garbage cleanup only deletes superseded proven pointers',async()=>{
  const f=fixture();try{const a=f.seed(1,'v08','owner-a',MB);await f.api.beginRetentionWrite('owner-a','v08',a.id,'uncertain-orphan',MB);f.objects.set('uncertain-orphan',{size:MB});
    await f.api.pruneCloudRetention('owner-a');assert.ok(f.objects.has('uncertain-orphan'));assert.equal((await f.api.cloudRetentionStatus('owner-a')).uncertainWrites,1);
    // Confirmed CAS failure is the only normal path that abandons its intent.
    await f.api.abandonKnownFailedWrite('uncertain-orphan');assert.ok(f.objects.has('uncertain-orphan'));
  }finally{f.close();}
});
test('pre-protocol legacy world remains protected after HEAD inventory and later coordinated writes',async()=>{
  const f=fixture();try{const old=f.seed(1,'v08','owner-a',null);f.seed(2,'v08','owner-a',40*MB);await f.api.pruneCloudRetention('owner-a',undefined,8);const s=await f.api.cloudRetentionStatus('owner-a');assert.equal(s.records.find(r=>r.id===old.id)?.legacyProtected,1);
    const key='updated-legacy';await f.api.beginRetentionWrite('owner-a','v08',old.id,key,30*MB);f.objects.set(key,{size:30*MB});f.sql.prepare('UPDATE worlds_v08 SET snapshot_key=?,previous_snapshot_key=snapshot_key,revision=revision+1 WHERE id=?').run(key,old.id);
    await f.api.setCloudRetentionLimit('owner-a',50*MB);assert.ok(f.sql.prepare('SELECT id FROM worlds_v08 WHERE id=?').get(old.id));assert.ok(f.objects.has(key));
  }finally{f.close();}
});
test('acknowledged per-world adoption clears only observed old sessions, never current, and keeps pins',async()=>{
  const f=fixture();try{const a=f.seed(1,'v08','owner-a',null);await f.api.pruneCloudRetention('owner-a',undefined,8);await f.api.cloudLease('owner-a','v08',a.id,'old-tab-session');await f.api.cloudLease('owner-a','v08',a.id,'current-session');await f.api.setCloudPinned('owner-a','v08',a.id,true);
    const row=(await f.api.cloudRetentionStatus('owner-a')).records.find(r=>r.id===a.id)!;
    await assert.rejects(f.api.adoptCloudWorld('owner-a','v08',a.id,'current-session',1,row.protection,false),{status:400});
    await assert.rejects(f.api.adoptCloudWorld('owner-b','v08',a.id,'current-session',1,row.protection,true),{status:409});
    const after=await f.api.adoptCloudWorld('owner-a','v08',a.id,'current-session',1,row.protection,true);const retained=after.records.find(r=>r.id===a.id)!;
    assert.equal(retained.legacyProtected,0);assert.equal(retained.pinned,1);assert.deepEqual(retained.protection.sessions,['current-session']);assert.equal(after.deleted.length,0);
  }finally{f.close();}
});
test('adoption CAS rejects a new lease, concurrent pin, in-flight write or newer revision',async()=>{
  for(const race of ['lease','renew','pin','intent','revision']){const f=fixture();try{const a=f.seed(1);await f.api.cloudLease('owner-a','v08',a.id,'old-tab-session');const observed=(await f.api.cloudRetentionStatus('owner-a')).records[0].protection;
      if(race==='lease')await f.api.cloudLease('owner-a','v08',a.id,'new-tab-session');
      if(race==='renew')await f.api.cloudLease('owner-a','v08',a.id,'old-tab-session');
      if(race==='pin')await f.api.setCloudPinned('owner-a','v08',a.id,true);
      if(race==='intent')await f.api.beginRetentionWrite('owner-a','v08',a.id,'inflight',100);
      if(race==='revision'){await f.api.beginRetentionWrite('owner-a','v08',a.id,'new-pointer',100);f.sql.prepare('UPDATE worlds_v08 SET snapshot_key=?,previous_snapshot_key=snapshot_key,revision=revision+1 WHERE id=?').run('new-pointer',a.id);}
      await assert.rejects(f.api.adoptCloudWorld('owner-a','v08',a.id,'current-session',1,observed,true),{status:409});assert.ok(f.sql.prepare('SELECT session FROM retention_leases WHERE session=?').get('old-tab-session'));
    }finally{f.close();}}
});
test('durable deletion notices contain names/bytes and only committed deletion, bounded to fifty',async()=>{
  const f=fixture();try{const a=f.seed(1),b=f.seed(2);const result=await f.api.setCloudRetentionLimit('owner-a',50*MB);assert.equal(result.lastNotice.length,1);assert.equal(result.lastNotice[0].name,'World 1');assert.equal(result.lastNotice[0].bytes,30*MB);assert.equal(result.lastNotice[0].id,a.id);
    await f.api.cloudLease('owner-a','v08',b.id,'active-session');assert.throws(()=>f.sql.prepare('DELETE FROM worlds_v08 WHERE id=?').run(b.id),/retention_protected/);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM retention_notices').get()?.n,1);
  }finally{f.close();}
});
test('notices are bounded across repeated cleanup and do not leak another owner',async()=>{
  const f=fixture();try{for(let n=1;n<=100;n++)f.seed(n,'v08','owner-a',2*MB,'2026-01-01T00:00:00Z');const result=await f.api.setCloudRetentionLimit('owner-a',50*MB);assert.equal(result.deleted.length,75);assert.equal(result.lastNotice.length,10);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM retention_notices').get()?.n,50);assert.equal((await f.api.cloudRetentionStatus('owner-b')).lastNotice.length,0);}finally{f.close();}
});
test('actual cloud transport captures old release receipt before await; renewed same-session lease survives',async()=>{
  const f=fixture(),originalFetch=globalThis.fetch;try{
    const {cloudRequest}=await import('../simulator-v08/src/cloud.mjs');const {releaseCloudWorld,RETENTION_SESSION}=await import('../lib/retention-client.mjs');const a=f.seed(1);
    const first=await f.api.cloudLease('owner-a','v08',a.id,RETENTION_SESSION);
    await cloudRequest('/api/v08/worlds/'+a.id,{},6000,async()=>Response.json({id:a.id},{headers:{'X-Microgalaxy-Lease':String(first)}}));
    let unblock!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>unblock=r),started=new Promise<void>(r=>entered=r),captured:string[]=[];
    globalThis.fetch=(async(_url,init)=>{const body=JSON.parse(String(init?.body));captured.push(body.leaseVersion);entered();await gate;const released=await f.api.cloudLease('owner-a',body.model,body.id,RETENTION_SESSION,true,body.leaseVersion);return Response.json({released});}) as typeof fetch;
    const releasing=releaseCloudWorld('v08',a.id);await started;
    const renewed=await f.api.cloudLease('owner-a','v08',a.id,RETENTION_SESSION);
    await cloudRequest('/api/v08/worlds/'+a.id,{},6000,async()=>Response.json({id:a.id},{headers:{'X-Microgalaxy-Lease':String(renewed)}}));
    unblock();assert.equal((await releasing).released,false);assert.deepEqual(captured,[first]);assert.equal(f.sql.prepare('SELECT version FROM retention_leases WHERE world_id=?').get(a.id)?.version,renewed);
    assert.equal((await releaseCloudWorld('v08',a.id)).released,true);assert.deepEqual(captured,[first,renewed]);assert.equal((await releaseCloudWorld('v08',id(99))).released,false);assert.equal(captured.length,2);
  }finally{globalThis.fetch=originalFetch;f.close();}
});
test('server release requires an exact receipt and cannot clear another owner or renewed lease',async()=>{
  const f=fixture();try{const a=f.seed(1),old=await f.api.cloudLease('owner-a','v08',a.id,'same-session'),fresh=await f.api.cloudLease('owner-a','v08',a.id,'same-session');
    await assert.rejects(f.api.cloudLease('owner-a','v08',a.id,'same-session',true),{code:'lease_receipt_required'});assert.equal(await f.api.cloudLease('owner-a','v08',a.id,'same-session',true,String(old)),false);assert.equal(await f.api.cloudLease('owner-b','v08',a.id,'same-session',true,String(fresh)),false);assert.equal(f.sql.prepare('SELECT version FROM retention_leases WHERE owner_id=?').get('owner-a')?.version,fresh);
  }finally{f.close();}
});
