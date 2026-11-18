import test from 'node:test';
test('JSON cannot impersonate a verified HTTP 304 receipt',async()=>{
  const {createCloudClient}=await import('../src/cloud.mjs');const id='00000000-0000-4000-8000-000000000001';
  for(const flag of [true,'true',false])for(const options of [{},{revision:1}]){
    let validations=0;const client=createCloudClient({fetchImpl:async()=>new Response(JSON.stringify({notModified:flag,revision:1,world:{id,schema:'INVALID'},updatedAt:''}),{status:200}),validate:()=>{validations++;throw new Error('invalid world');}});
    await assert.rejects(()=>client.get(id,options),/invalid world/);assert.equal(validations,1);
  }
  for(const [header,options] of [[null,{revision:1}],['"v06-2"',{revision:1}],['"v06-1"',{}]]){
    const client=createCloudClient({fetchImpl:async()=>new Response(null,{status:304,headers:header?{ETag:header}:{}})});await assert.rejects(()=>client.get(id,options));
  }
});
test('HTTP 200 cannot leak a notModified flag to callers even with a valid world',async()=>{
  const world=fresh();const client=createCloudClient({fetchImpl:async()=>json({notModified:true,world,revision:2,updatedAt:stamp})});
  const result=await client.get(world.id,{revision:1});assert.equal(result.notModified,undefined);assert.deepEqual(result.world,world);assert.equal(result.revision,2);
});
test('conditional cloud fetch accepts only the requested revision receipt',async()=>{
  const {createCloudClient}=await import('../src/cloud.mjs');const id='00000000-0000-4000-8000-000000000001';let seen;
  const client=createCloudClient({fetchImpl:async(_path,init)=>{seen=new Headers(init.headers).get('If-None-Match');return new Response(null,{status:304,headers:{ETag:'"v06-7"'}});}});
  assert.deepEqual(await client.get(id,{revision:7}),{notModified:true,revision:7});assert.equal(seen,'"v06-7"');
  await assert.rejects(()=>client.get(id,{revision:8}));await assert.rejects(()=>client.get(id,{revision:-1}));await assert.rejects(()=>client.get('bad',{revision:7}));
});
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorld, advance, clone } from '../src/core.mjs';
import { createWorld as createV03World } from '../../simulator-v03/src/core.mjs';
import { createWorld as createV04World } from '../../simulator-v04/src/core.mjs';
import { memoryWorldStore, MAX_FILE_BYTES } from '../src/storage.mjs';
import { cloudRequest, createCloudClient, createCloudSync } from '../src/cloud.mjs';

const stamp = '2026-11-16T08:00:00.000Z';
function fresh() { const w = createWorld('CLOUD-05'); w.id = randomUUID(); return w; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('cloud request keeps authenticated requests same-origin and parses JSON', async () => {
  let seen;
  const result = await cloudRequest('/api/v06/worlds', {}, 200, async (path, init) => { seen = { path, init }; return json({ worlds: [], nextCursor: null }); });
  assert.equal(seen.path, '/api/v06/worlds');
  assert.equal(seen.init.credentials, 'same-origin');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(seen.init.redirect, 'error');
  assert.deepEqual(result.worlds, []);
});

test('cloud request rejects external and non-v06 routes without contacting them', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return json({}); };
  for (const path of ['https://example.com/api/v06/worlds', '//example.com/api/v06/worlds', '/api/worlds', '/api/v03/worlds', '/api/v04/worlds', '/api/v03/worlds/'+randomUUID(), '/api/v06/worlds-evil', '/api/v06/worlds/%2e%2e/worlds', '/api/v06/worlds/'+randomUUID()+'/other']) {
    await assert.rejects(() => cloudRequest(path, {}, 200, fetcher));
  }
  assert.equal(calls, 0);
});

test('cloud request rejects authorization and server errors', async () => {
  for (const status of [401, 403, 409, 500, 503]) {
    await assert.rejects(() => cloudRequest('/api/v06/worlds', {}, 200, async () => json({ error: 'Test failure', code: 'test' }, status)), error => error instanceof Error);
  }
});

test('cloud request timeout covers a fetch that never settles', { timeout: 1000 }, async () => {
  let signal;
  await assert.rejects(() => cloudRequest('/api/v06/worlds', {}, 20, async (_path, init) => { signal = init.signal; return new Promise(() => {}); }));
  assert.equal(signal.aborted, true);
});

test('cloud request timeout also covers a stalled response body', { timeout: 1000 }, async () => {
  let controller, signal;
  const stream = new ReadableStream({ start(c) { controller = c; } });
  try {
    await assert.rejects(() => cloudRequest('/api/v06/worlds', {}, 20, async (_path, init) => { signal = init.signal; return new Response(stream, { headers: { 'Content-Type': 'application/json' } }); }));
    assert.equal(signal.aborted, true);
  } finally { try { controller.close(); } catch {} }
});

test('cloud client POSTs a new world, then PUTs with an expected server revision', async () => {
  const w = fresh(), calls = [];
  const client = createCloudClient({ timeoutMs: 200, fetchImpl: async (path, init) => { calls.push({ path, init }); return json({ id: w.id, revision: calls.length, updatedAt: stamp }, calls.length === 1 ? 201 : 200); } });
  assert.equal((await client.save(w, 0)).revision, 1);
  assert.equal((await client.save(w, 1)).revision, 2);
  assert.equal(calls[0].path, '/api/v06/worlds');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { world: w });
  assert.equal(calls[1].path, `/api/v06/worlds/${w.id}`);
  assert.equal(calls[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[1].init.body), { world: w, revision: 1 });
});

test('cloud client rejects malformed downloaded worlds', async () => {
  const w = fresh();
  w.societies[0].population = -1;
  const client = createCloudClient({ timeoutMs: 200, fetchImpl: async () => json({ world: w, revision: 1, updatedAt: stamp }) });
  await assert.rejects(() => client.get(w.id));
});

test('v06 cloud client rejects a v03 download and will not upload a v03 world', async () => {
  const old = createV03World('WRONG-CLOUD-MODEL'); old.id = randomUUID();
  let calls = 0;
  const client = createCloudClient({ timeoutMs: 200, fetchImpl: async () => { calls++; return json({ world: old, revision: 1, updatedAt: stamp }); } });
  await assert.rejects(() => client.get(old.id));
  assert.equal(calls, 1);
  await assert.rejects(() => client.save(old, 0));
  assert.equal(calls, 1);
});

test('v06 cloud client rejects v04 worlds without attempting in-place migration',async()=>{
  const old=createV04World('DO-NOT-MIGRATE-04');old.id=randomUUID();let calls=0;
  const client=createCloudClient({timeoutMs:200,fetchImpl:async()=>{calls++;return json({world:old,revision:1,updatedAt:stamp});}});
  await assert.rejects(()=>client.get(old.id));await assert.rejects(()=>client.save(old,0));assert.equal(calls,1);
});

test('cloud transport bounds request and response bytes, independent of Content-Length',async()=>{
  let calls=0;
  await assert.rejects(()=>cloudRequest('/api/v06/worlds',{method:'POST',body:'x'.repeat(MAX_FILE_BYTES+1)},200,async()=>{calls++;return json({});}),/24 МБ/);
  assert.equal(calls,0);
  await assert.rejects(()=>cloudRequest('/api/v06/worlds',{},200,async()=>new Response('{}',{headers:{'Content-Length':String(MAX_FILE_BYTES+2049)}})),/размер/);
  let cancelled=false,blocks=0;
  const stream=new ReadableStream({pull(c){blocks++;c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
  await assert.rejects(()=>cloudRequest('/api/v06/worlds',{},2000,async()=>new Response(stream,{headers:{'Content-Length':'1'}})),/размер/);
  assert.equal(cancelled,true);assert.ok(blocks<=26);
});

test('cloud client does not accept an unrelated or jumping save receipt', async () => {
  const w = fresh();
  for (const receipt of [
    { id: randomUUID(), revision: 1, updatedAt: stamp },
    { id: w.id, revision: 5, updatedAt: stamp },
    { id: w.id, revision: 0, updatedAt: stamp },
  ]) {
    const client = createCloudClient({ timeoutMs: 200, fetchImpl: async () => json(receipt, 201) });
    await assert.rejects(() => client.save(w, 0));
  }
});

test('cloud client keeps pagination cursors in the query parameter', async () => {
  let path;
  const client = createCloudClient({ timeoutMs: 200, fetchImpl: async (value) => { path = value; return json({ worlds: [], hasMore: false, nextCursor: null }); } });
  await client.list('owner/snapshot+next=');
  const parsed = new URL(path, 'https://microgalaxy.test');
  assert.equal(parsed.pathname, '/api/v06/worlds');
  assert.equal(parsed.searchParams.get('cursor'), 'owner/snapshot+next=');
});

test('cloud sync saves the local snapshot and records independent server revision', async () => {
  const store = memoryWorldStore(), w = fresh(), calls = [];
  await store.put(w, 0);
  const sync = createCloudSync(store, { save: async (snapshot, revision) => { calls.push({ snapshot, revision }); return { id: snapshot.id, revision: 6, updatedAt: stamp }; } });
  await sync.sync(w.id);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].snapshot, w);
  assert.equal(calls[0].revision, 0);
  const row = await store.get(w.id);
  assert.equal(row.cloud.revision, 6);
  assert.equal(row.cloud.syncedRevision, row.revision);
  store.close();
});

test('overlapping cloud sync requests do not issue parallel writes for one world', async () => {
  const store = memoryWorldStore(), w = fresh(), entered = deferred(), release = deferred();
  await store.put(w, 0);
  let calls = 0;
  const sync = createCloudSync(store, { save: async () => { calls++; entered.resolve(); await release.promise; return { id: w.id, revision: 1, updatedAt: stamp }; } });
  const a = sync.sync(w.id), b = sync.sync(w.id);
  await entered.promise;
  release.resolve();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
  store.close();
});

test('local progress made during cloud upload stays dirty and is saved by the next sync', async () => {
  const store = memoryWorldStore(), w = fresh(), entered = deferred(), release = deferred(), sent = [];
  await store.put(w, 0);
  const sync = createCloudSync(store, { save: async (snapshot, revision) => { sent.push({ snapshot: clone(snapshot), revision }); if (sent.length === 1) { entered.resolve(); await release.promise; } return { id: w.id, revision: sent.length, updatedAt: stamp }; } });
  const upload = sync.sync(w.id);
  await entered.promise;
  const later = advance(w, 10).world;
  await store.put(later, 1);
  release.resolve();
  await upload;
  let row = await store.get(w.id);
  assert.deepEqual(row.world, later);
  assert.notEqual(row.cloud.syncedRevision, row.revision);
  await sync.sync(w.id);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].snapshot.year, 10);
  assert.equal(sent[1].revision, 1);
  row = await store.get(w.id);
  assert.equal(row.cloud.syncedRevision, row.revision);
  store.close();
});

test('ambiguous successful save is recovered only when cloud history matches exactly', async () => {
  const store = memoryWorldStore(), w = fresh();
  await store.put(w, 0);
  const client = createCloudClient({ timeoutMs: 200, fetchImpl: async (_path, init) => init.method === 'POST' ? json({ error: 'Exists', code: 'world_exists' }, 409) : json({ world: clone(w), revision: 2, updatedAt: stamp }) });
  await createCloudSync(store, client).sync(w.id);
  const row = await store.get(w.id);
  assert.equal(row.cloud.revision, 2);
  assert.equal(row.cloud.syncedRevision, row.revision);
  store.close();
});

test('different cloud history on conflict cannot mark local progress saved', async () => {
  const store = memoryWorldStore(), w = fresh();
  await store.put(w, 0);
  const before = await store.get(w.id);
  const client = createCloudClient({ timeoutMs: 200, fetchImpl: async (_path, init) => init.method === 'POST' ? json({ error: 'Exists', code: 'world_exists' }, 409) : json({ world: advance(w, 10).world, revision: 2, updatedAt: stamp }) });
  await assert.rejects(() => createCloudSync(store, client).sync(w.id));
  assert.deepEqual(await store.get(w.id), before);
  store.close();
});

test('cloud failure leaves the local snapshot available for retry/export', async () => {
  const store = memoryWorldStore(), w = fresh();
  await store.put(w, 0);
  const before = await store.get(w.id);
  const sync = createCloudSync(store, { save: async () => { throw new Error('Network unavailable'); } });
  await assert.rejects(() => sync.sync(w.id));
  assert.deepEqual(await store.get(w.id), before);
  store.close();
});

test('cloud sync does not re-upload a clean local record or a missing world', async () => {
  const store = memoryWorldStore(), w = fresh();
  await store.receiveCloud(w, 8, stamp, 0);
  let calls = 0;
  const sync = createCloudSync(store, { save: async () => { calls++; throw new Error('Unexpected save'); } });
  await sync.sync(w.id);
  await assert.rejects(() => sync.sync(randomUUID()));
  assert.equal(calls, 0);
  store.close();
});
