import {retentionTestModule} from './retention-test-loader.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import ts from 'typescript';
import { advance, createWorld } from '../simulator-v08/src/core.mjs';
import { createWorld as createV03World } from '../simulator-v03/src/core.mjs';
import { createWorld as createV04World } from '../simulator-v04/src/core.mjs';
import * as archiveContract from '../lib/world-archive-contract.ts';
import * as registry from '../lib/world-models.mjs';
import * as observatoryContract from '../lib/world-v1-contract.ts';
import {createWorld as createObservatory,advance as advanceObservatory} from '../simulator-v1/src/core.mjs';
import * as contract from '../lib/world-v08-contract.ts';
import type { V08World } from '../lib/world-v08-contract.ts';

type Catalogue = { worlds: { id: string; updatedAt: string; name: string }[]; hasMore: boolean; nextCursor: string | null };
type Receipt = { id: string; revision: number; updatedAt: string };
type Storage = typeof contract & {
  listV08Worlds(owner: string, cursor?: string | null): Promise<Catalogue>;
  createV08World(owner: string, world: V08World): Promise<Receipt>;
  readV08World(owner: string, id: string, etag?: string): Promise<any>;
  updateV08World(owner: string, id: string, world: V08World, revision: number): Promise<Receipt>;
};
const time = '2026-11-16T10:00:00.000Z';
const idFor = (n: number) => `local-00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const makeWorld = (n = 1) => contract.validateV08World({ ...createWorld('STORAGE-' + n), id: idFor(n) });

test('observatory migration preserves the complete old schema, original archives and snapshots', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const dir = new URL('../drizzle/', import.meta.url);
    const addition = '0015_observatory_v1.sql';
    for (const file of readdirSync(dir).filter(name => name.endsWith('.sql') && name < addition).sort()) {
      db.exec(readFileSync(new URL(file, dir), 'utf8'));
    }
    const tables = ['worlds', 'worlds_v03', 'worlds_v04', 'worlds_v05', 'worlds_v06', 'worlds_v07', 'worlds_v08'];
    for (const table of tables) {
      const values = [idFor(1), 'owner', 'Archive', 'seed',
        ...(table === 'worlds' ? [] : ['industrial', 'original-schema', 'original-version']),
        240, 777, 'Era', 5, table + '/current', table + '/previous', time, time];
      db.prepare(`INSERT INTO ${table} VALUES (${values.map(() => '?').join(',')})`).run(...values);
    }
    const schema = () => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name!='worlds_v1' ORDER BY type,name").all();
    const snapshot = () => tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    const oldSchema = schema(), oldRows = snapshot();
    db.exec(readFileSync(new URL(addition, dir), 'utf8'));
    assert.deepEqual(schema(), oldSchema); assert.deepEqual(snapshot(), oldRows);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM worlds_v1').get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger' AND tbl_name='worlds_v1'").get()?.n, 9);
  } finally { db.close(); }
});

test('observatory API authenticates each operation, enforces the snapshot limit and isolates equal IDs across models', async () => {
  const f = fixture();
  try {
    let owner: string | null = null;
    const modules = {
      '@/app/chatgpt-auth': { async getChatGPTUser() { return owner ? {userId:owner, displayName:owner} : null; } },
      '@/lib/world-v1-storage': f.observatory,
    };
    const list = loadModule<typeof import('../app/api/v1/worlds/route')>('../app/api/v1/worlds/route.ts', modules);
    const item = loadModule<typeof import('../app/api/v1/worlds/[id]/route')>('../app/api/v1/worlds/[id]/route.ts', modules);
    const id = idFor(33), context = {params:Promise.resolve({id})};
    const request = (method: string, body?: unknown, extraHeaders: Record<string,string> = {}) => new Request('https://microgalaxy.example/api/v1/worlds', {
      method, body:body === undefined ? undefined : JSON.stringify(body),
      headers:{'content-type':'application/json','x-microgalaxy-retention':'1','x-microgalaxy-session':'test-owner-session', ...extraHeaders},
    });
    assert.equal((await list.GET(request('GET'))).status, 401);
    assert.equal((await list.POST(request('POST', {}))).status, 401);
    assert.equal((await item.GET(request('GET'), context)).status, 401);
    assert.equal((await item.PUT(request('PUT', {}), context)).status, 401);
    assert.equal(f.queries.length, 0);
    owner = 'owner-a';
    assert.equal((await list.POST(request('POST', {}, {'content-length':String(24 * 1024 * 1024 + 1)}))).status, 413);
    const old = makeWorld(33);
    assert.equal((await list.POST(request('POST', {world:old}))).status, 400);
    const world = {...createObservatory('ARCHIVE-V1'), id};
    assert.equal((await list.POST(request('POST', {world:{...world, extra:true}}))).status, 400);
    assert.equal((await list.POST(request('POST', {world:{...world, observatory:null}}))).status, 400);
    const oldReceipt = await f.storage.createV08World(owner,old);
    const created = await list.POST(request('POST', {world}));
    assert.equal(created.status, 201); assert.equal((await created.json() as Receipt).revision, 1);
    assert.ok(created.headers.get('x-microgalaxy-lease'));
    const sessionSnapshot = await item.GET(request('GET'), context);
    assert.equal(sessionSnapshot.headers.get('etag'), '"v1-1"');
    assert.deepEqual((await sessionSnapshot.json() as {world:V08World}).world,world);
    const reads = f.bucketReads;
    assert.equal((await item.GET(request('GET', undefined, {'if-none-match':'"v1-1"'}), context)).status, 304);
    assert.equal(f.bucketReads, reads);
    owner = 'owner-b';
    assert.deepEqual((await (await list.GET(request('GET'))).json() as {worlds:{id:string;modelVersion:string;year:number}[]}).worlds, []);
    assert.equal((await item.GET(request('GET', undefined, {'if-none-match':'"v1-1"'}), context)).status, 404);
    assert.equal((await item.PUT(request('PUT', {world,revision:1}), context)).status, 404);
    assert.equal(f.bucketReads, reads);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM retention_leases WHERE owner_id='owner-b'").get()?.n, 0);
    owner = 'owner-a';
    const next = advanceObservatory(world, 1).world;
    const updated = await item.PUT(request('PUT', {world:next,revision:1}), context);
    assert.equal(updated.status, 200); assert.equal((await updated.json() as Receipt).revision, 2);
    assert.equal((await item.PUT(request('PUT', {world,revision:1}), context)).status, 409);
    const reopened = await item.GET(request('GET'), context);
    assert.deepEqual((await reopened.json() as {world:V08World}).world,next); assert.equal(reopened.headers.get('etag'), '"v1-2"');
    const rows = (await (await list.GET(request('GET'))).json() as {worlds:{id:string;modelVersion:string;year:number}[]}).worlds;
    assert.deepEqual(rows.map((r: {id:string;modelVersion:string;year:number}) => [r.id,r.modelVersion,r.year]), [[id,'1.0.1',1]]);
    const current = f.sqlite.prepare("SELECT * FROM retention_entries WHERE model='v1' AND world_id=?").get(id)!;
    assert.equal(current.revision, 2); assert.equal(current.current_bytes, Buffer.byteLength(JSON.stringify(next)));
    assert.equal(current.previous_bytes, Buffer.byteLength(JSON.stringify(world)));
    assert.match(String(current.snapshot_key), /^worlds-v1\/owner-a\//);
    assert.deepEqual(JSON.parse(f.objects.get(String(current.previous_snapshot_key))!),world);
    assert.equal((await f.storage.readV08World(owner,id)).revision,oldReceipt.revision);
    assert.deepEqual((await f.storage.readV08World(owner,id)).world,old);
    assert.throws(() => f.sqlite.prepare('DELETE FROM worlds_v1 WHERE id=?').run(id), /retention_protected/);
  } finally { f.close(); }
});

function loadModule<T>(file: string, modules: Record<string, unknown>): T {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', outputText)((name: string) => {
    if(name==='./retention-cloud'||name==='@/lib/retention-cloud')return retentionTestModule(modules);
    if (!(name in modules)) throw new Error('Unexpected test dependency: ' + name);
    return modules[name];
  }, exports);
  return exports as T;
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  let beforeWrite: ((sql: string) => void) | null = null;
  let beforeFirst: (() => void) | null = null;
  let beforePut: (() => void) | null = null;
  let loseNextResponse = false;
  const queries: string[] = [];
  const objects = new Map<string, string>();
  const deleted: string[] = [];
  let bucketReads = 0;
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      return { bind(...values: SQLInputValue[]) { return {
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async first() { beforeFirst?.(); return sqlite.prepare(sql).get(...values) ?? null; },
        async run() {
          beforeWrite?.(sql);
          const total = () => Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n);
          const before = total();
          sqlite.prepare(sql).run(...values);
          if (loseNextResponse && /^(?:INSERT INTO worlds|UPDATE worlds)/.test(sql)) { loseNextResponse = false; throw new Error('Lost committed database response'); }
          return { meta: { changes: total() - before } };
        },
      }; } };
    },
  };
  const bucket = {
    async put(key: string, content: string) { beforePut?.(); objects.set(key, content); },
    async get(key: string) {
      bucketReads++;
      const text = objects.get(key);
      return text === undefined ? null : { size: new TextEncoder().encode(text).byteLength, async text() { return text; } };
    },
    async delete(key: string) { deleted.push(key); objects.delete(key); },
  };
  const sharedStorage = loadModule<typeof import('../lib/world-archive-storage')>('../lib/world-archive-storage.ts', {
    'cloudflare:workers': { env: { DB: db, BUCKET: bucket } },
    './world-models.mjs': registry,
    './world-archive-contract.ts': archiveContract,
  });
  const storage = loadModule<Storage>('../lib/world-v08-storage.ts', {
    './world-archive-storage': sharedStorage, './world-v08-contract': contract,
  });
  const observatory = loadModule<typeof import('../lib/world-v1-storage')>('../lib/world-v1-storage.ts', {
    './world-archive-storage': sharedStorage, './world-v1-contract': observatoryContract,
    './world-archive-contract.ts': archiveContract,
  });
  const addRow = (n: number, owner = 'owner-a', updatedAt = time) => {
    const id = idFor(n);
    sqlite.prepare(`INSERT INTO worlds_v08 (id,owner_id,name,seed,starting_era,schema_version,model_version,year,population,era,revision,snapshot_key,previous_snapshot_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,NULL,?,?)`).run(id, owner, 'Мир ' + n, 'seed-' + n, 'agriculture', 'microgalaxy.conflicts/1', '0.8.0', 0, 100, 'Ранние общества', 'mock-' + n, time, updatedAt);
    return { id, owner, updatedAt };
  };
  const row = (id: string) => sqlite.prepare('SELECT * FROM worlds_v08 WHERE id = ?').get(id) as unknown as { revision: number; snapshot_key: string; previous_snapshot_key: string | null };
  return { storage, observatory, sqlite, objects, deleted, queries, addRow, row, get bucketReads() { return bucketReads; },
    setBeforeWrite(fn: ((sql: string) => void) | null) { beforeWrite = fn; },
    setBeforeFirst(fn: (() => void) | null) { beforeFirst = fn; },
    setBeforePut(fn: (() => void) | null) { beforePut = fn; },
    loseNextResponse() { loseNextResponse = true; }, close() { sqlite.close(); } };
}

test('create and update serialize detached, validated snapshots despite caller mutation at async boundaries', async () => {
  const f = fixture();
  try {
    const first = makeWorld();
    const originalId = first.id, originalName = first.name;
    f.setBeforePut(() => { first.name = 'changed-after-validation'; first.id = idFor(77); });
    const created = await f.storage.createV08World('owner-a', first);
    f.setBeforePut(null);
    assert.equal(created.id, originalId);
    assert.equal(f.sqlite.prepare('SELECT name FROM worlds_v08 WHERE id = ?').get(originalId)?.name, originalName);
    const saved = await f.storage.readV08World('owner-a', originalId);
    assert.equal(saved.world.name, originalName);

    const update = advance(saved.world, 10).world as V08World;
    const expected = structuredClone(update);
    f.setBeforeFirst(() => { (update.societies as {population: number}[])[0].population = -1; });
    const result = await f.storage.updateV08World('owner-a', originalId, update, 1);
    f.setBeforeFirst(null);
    assert.equal(result.revision, 2);
    const stored = await f.storage.readV08World('owner-a', originalId);
    assert.deepEqual(stored.world, expected);
    assert.doesNotThrow(() => contract.validateV08World(stored.world));
  } finally { f.close(); }
});

test('conditional read checks owner and ID before avoiding snapshot fetch', async () => {
  const f=fixture();try {const world=makeWorld();await f.storage.createV08World('owner-a',world);
    const unchanged=await f.storage.readV08World('owner-a',world.id,'"v08-1"');assert.equal(unchanged.notModified,true);assert.equal(f.bucketReads,0);
    await assert.rejects(f.storage.readV08World('owner-b',world.id,'"v08-1"'),{status:404});assert.equal(f.bucketReads,0);
    await assert.rejects(f.storage.readV08World('owner-a','bad-id','"v08-1"'));assert.equal(f.bucketReads,0);
    const changed=await f.storage.readV08World('owner-a',world.id,'"v08-2"');assert.equal(changed.revision,1);assert.equal(f.bucketReads,1);
  } finally {f.close();}
});

test('v08 additive SQLite migration preserves every earlier table, row and index', () => {
  const sqlite = new DatabaseSync(':memory:');
  const directory = new URL('../drizzle/', import.meta.url);
  const addition = '0006_dear_mandrill.sql';
  try {
    for (const file of readdirSync(directory).filter(name => name.endsWith('.sql') && name < addition).sort()) {
      sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
    }
    sqlite.prepare('INSERT INTO worlds VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('classic-preserved', 'owner-a', 'Original', 'seed', 50, 100, 'Era', 7, 'classic-object', 'classic-before', time, time);
    for (const [table, schema, model] of [['worlds_v03', 'microgalaxy.local/1', '0.3-local.1'], ['worlds_v04', 'microgalaxy.history/1', '0.4.0'], ['worlds_v05', 'microgalaxy.geography/1', '0.5.0'], ['worlds_v06', 'microgalaxy.economy/1', '0.6.0'], ['worlds_v07', 'microgalaxy.societies/1', '0.7.0']]) {
      sqlite.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(idFor(1), 'owner-a', 'Original', 'seed', 'agriculture', schema, model, 75, 100, 'Era', 9, 'original-object', 'original-before', time, time);
    }
    const oldSchema = sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const oldRows = ['worlds', 'worlds_v03', 'worlds_v04', 'worlds_v05', 'worlds_v06', 'worlds_v07'].map(table => sqlite.prepare(`SELECT * FROM ${table}`).all());
    sqlite.exec(readFileSync(new URL(addition, directory), 'utf8'));
    assert.deepEqual(sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND tbl_name != 'worlds_v08' ORDER BY type,name").all(), oldSchema);
    for (const [index, table] of ['worlds', 'worlds_v03', 'worlds_v04', 'worlds_v05', 'worlds_v06', 'worlds_v07'].entries()) assert.deepEqual(sqlite.prepare(`SELECT * FROM ${table}`).all(), oldRows[index]);
    assert.equal(sqlite.prepare('PRAGMA table_info(worlds_v08)').all().length, 15);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM worlds_v08').get()?.count, 0);
    assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='worlds_v08_owner_updated_idx'").get());
  } finally { sqlite.close(); }
});

test('v08 create/read/update retain immutable snapshots and leave classic, 0.3 and 0.4 archives unchanged', async () => {
  const f = fixture();
  try {
    f.sqlite.prepare('INSERT INTO worlds VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-id', 'owner-a', 'Legacy', 'seed', 50, 100, 'Era', 7, 'legacy-object', 'legacy-previous', time, time);
    const legacy = f.sqlite.prepare('SELECT * FROM worlds').all();
    const initial = makeWorld();
    f.sqlite.prepare('INSERT INTO worlds_v03 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(initial.id, 'owner-a', 'Preserved 0.3', 'seed-03', 'agriculture', 'microgalaxy.local/1', '0.3-local.1', 75, 100, 'Era', 9, 'worlds-v03/owner-a/preserved', null, time, time);
    const previousModel = f.sqlite.prepare('SELECT * FROM worlds_v03').all();
    f.sqlite.prepare('INSERT INTO worlds_v04 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(initial.id, 'owner-a', 'Preserved 0.4', 'seed-04', 'agriculture', 'microgalaxy.history/1', '0.4.0', 90, 100, 'Era', 5, 'worlds-v04/owner-a/preserved', null, time, time);
    const priorHistory = f.sqlite.prepare('SELECT * FROM worlds_v04').all();
    f.sqlite.prepare('INSERT INTO worlds_v05 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(initial.id, 'owner-a', 'Preserved 0.5', 'seed-05', 'agriculture', 'microgalaxy.geography/1', '0.5.0', 90, 100, 'Era', 5, 'worlds-v05/owner-a/preserved', null, time, time);
    const priorGeography = f.sqlite.prepare('SELECT * FROM worlds_v05').all();
    f.objects.set('legacy-object', 'unchanged classic snapshot');
    f.objects.set('worlds-v03/owner-a/preserved', 'unchanged 0.3 snapshot');
    f.objects.set('worlds-v04/owner-a/preserved', 'unchanged 0.4 snapshot');
    f.objects.set('worlds-v05/owner-a/preserved', 'unchanged 0.5 snapshot');
    const created = await f.storage.createV08World('owner-a', initial);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM worlds_v05').all(), priorGeography);
    assert.equal(f.objects.get('worlds-v05/owner-a/preserved'), 'unchanged 0.5 snapshot');
    assert.equal(created.revision, 1);
    assert.deepEqual((await f.storage.readV08World('owner-a', initial.id)).world, initial);
    const originalKey = f.row(initial.id).snapshot_key;
    assert.match(originalKey, /^worlds-v08\/owner-a\/local-/);
    const next = contract.validateV08World(advance(initial, 10).world);
    const updated = await f.storage.updateV08World('owner-a', initial.id, next, 1);
    assert.equal(updated.revision, 2);
    assert.equal((await f.storage.readV08World('owner-a', initial.id)).world.year, 10);
    assert.equal(f.row(initial.id).previous_snapshot_key, originalKey);
    assert.notEqual(f.row(initial.id).snapshot_key, originalKey);
    assert.equal(JSON.parse(f.objects.get(originalKey)!).year, 0);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM worlds').all(), legacy);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM worlds_v03').all(), previousModel);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM worlds_v04').all(), priorHistory);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM worlds_v05').all(), priorGeography);
    assert.equal(f.objects.get('legacy-object'), 'unchanged classic snapshot');
    assert.equal(f.objects.get('worlds-v03/owner-a/preserved'), 'unchanged 0.3 snapshot');
    assert.equal(f.objects.get('worlds-v04/owner-a/preserved'), 'unchanged 0.4 snapshot');
    assert.equal(f.objects.size, 6);
    assert.equal(f.deleted.length, 0);
  } finally { f.close(); }
});

test('v08 storage never reads or updates another owner and rejects duplicate IDs', async () => {
  const f = fixture();
  try {
    const world = makeWorld();
    await f.storage.createV08World('owner-a', world);
    await assert.rejects(f.storage.readV08World('owner-b', world.id), { status: 404, code: 'world_not_found' });
    await assert.rejects(f.storage.updateV08World('owner-b', world.id, world, 1), { status: 404 });
    await assert.rejects(f.storage.createV08World('owner-b', world), { status: 409, code: 'world_exists' });
    assert.equal(f.objects.size, 1);
    assert.equal((await f.storage.listV08Worlds('owner-b')).worlds.length, 0);
    assert.equal(f.row(world.id).revision, 1);
  } finally { f.close(); }
});

test('v08 identity changes and stale revisions cannot overwrite the current cloud history', async () => {
  const f = fixture();
  try {
    const world = makeWorld();
    await f.storage.createV08World('owner-a', world);
    const later = contract.validateV08World(advance(world, 10).world);
    await f.storage.updateV08World('owner-a', world.id, later, 1);
    const keys = [...f.objects.keys()];
    await assert.rejects(f.storage.updateV08World('owner-a', world.id, world, 1), { code: 'revision_conflict' });
    await assert.rejects(f.storage.updateV08World('owner-a', world.id, world, 2), { code: 'history_regression' });
    await assert.rejects(f.storage.updateV08World('owner-a', world.id, { ...later, seed: 'changed' }, 2), { code: 'world_identity_mismatch' });
    await assert.rejects(f.storage.updateV08World('owner-a', world.id, { ...later, era: 'space' }, 2), { code: 'world_identity_mismatch' });
    assert.deepEqual([...f.objects.keys()], keys);
    assert.equal(f.row(world.id).revision, 2);
  } finally { f.close(); }
});

test('v08 CAS detects a writer racing between read and UPDATE; only the unused upload is removed', async () => {
  const f = fixture();
  try {
    const world = makeWorld();
    await f.storage.createV08World('owner-a', world);
    const original = f.row(world.id).snapshot_key;
    f.setBeforeWrite(sql => {
      if (sql.startsWith('UPDATE')) {
        f.setBeforeWrite(null);
        f.sqlite.prepare("INSERT INTO retention_intents SELECT snapshot_key,owner_id,'v08',id,100,updated_at FROM worlds_v08 WHERE id=?").run(world.id);
        f.sqlite.prepare('UPDATE worlds_v08 SET revision = revision + 1 WHERE id = ?').run(world.id);
      }
    });
    await assert.rejects(f.storage.updateV08World('owner-a', world.id, world, 1), { status: 409, code: 'revision_conflict' });
    assert.equal(f.row(world.id).snapshot_key, original);
    assert.equal(f.objects.size, 1);
    assert.ok(f.objects.has(original));
    assert.equal(f.deleted.length, 1);
    assert.notEqual(f.deleted[0], original);
  } finally { f.close(); }
});

test('v08 an uncertain committed write retains its snapshot for subsequent recovery', async () => {
  const f = fixture();
  try {
    const world = makeWorld();
    f.loseNextResponse();
    await assert.rejects(f.storage.createV08World('owner-a', world), /Lost committed database response/);
    const afterCreate = await f.storage.readV08World('owner-a', world.id);
    assert.equal(afterCreate.revision, 1);
    const next = contract.validateV08World(advance(world, 5).world);
    f.loseNextResponse();
    await assert.rejects(f.storage.updateV08World('owner-a', world.id, next, 1), /Lost committed database response/);
    const afterUpdate = await f.storage.readV08World('owner-a', world.id);
    assert.equal(afterUpdate.revision, 2);
    assert.equal(afterUpdate.world.year, 5);
    assert.equal(f.objects.size, 2);
    assert.equal(f.deleted.length, 0);
  } finally { f.close(); }
});

test('v08 corrupted or mismatched R2 snapshots are reported without modifying the catalogue', async () => {
  const f = fixture();
  try {
    const world = makeWorld();
    await f.storage.createV08World('owner-a', world);
    const key = f.row(world.id).snapshot_key;
    for (const body of ['broken', JSON.stringify({ ...world, seed: 'different' }), JSON.stringify({ ...world, modelVersion: 'future' })]) {
      f.objects.set(key, body);
      await assert.rejects(f.storage.readV08World('owner-a', world.id), { status: 503, code: 'snapshot_unavailable' });
      assert.equal(f.row(world.id).revision, 1);
    }
    f.objects.delete(key);
    await assert.rejects(f.storage.readV08World('owner-a', world.id), { code: 'snapshot_unavailable' });
  } finally { f.close(); }
});

test('v08 owner-scoped keyset pagination crosses equal timestamps without duplicates', async () => {
  const f = fixture();
  try {
    const rows = [];
    for (let n = 1; n <= 205; n++) rows.push(f.addRow(n, 'owner-a', new Date(Date.parse(time) - Math.floor(n / 37) * 1000).toISOString()));
    for (let n = 1000; n < 1010; n++) f.addRow(n, 'owner-b');
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    let cursor: string | null | undefined;
    const ids: string[] = [], sizes: number[] = [];
    do {
      const page = await f.storage.listV08Worlds('owner-a', cursor);
      ids.push(...page.worlds.map(row => row.id)); sizes.push(page.worlds.length); cursor = page.nextCursor;
      assert.equal(page.hasMore, !!page.nextCursor);
    } while (cursor);
    assert.deepEqual(sizes, [100, 100, 5]);
    assert.deepEqual(ids, rows.map(row => row.id));
    const first = await f.storage.listV08Worlds('owner-a');
    const other = await f.storage.listV08Worlds('owner-b', first.nextCursor);
    assert.ok(other.worlds.every(row => !ids.includes(row.id)));
    const count = f.queries.length;
    await assert.rejects(f.storage.listV08Worlds('owner-a', 'bad'), { code: 'invalid_cursor' });
    assert.equal(f.queries.length, count);
  } finally { f.close(); }
});

test('v08 actual routes require authentication before queries and expose the documented contracts', async () => {
  const f = fixture();
  try {
    let signedIn = false;
    const modules = {
      '@/app/chatgpt-auth': { async getChatGPTUser() { return signedIn ? { userId: 'owner-a', displayName: 'Наблюдатель' } : null; } },
      '@/lib/world-v08-storage': f.storage,
    };
    const catalogue = loadModule<{ GET(r: Request): Promise<Response>; POST(r: Request): Promise<Response> }>('../app/api/v08/worlds/route.ts', modules);
    const item = loadModule<{ GET(r: Request, c: unknown): Promise<Response>; PUT(r: Request, c: unknown): Promise<Response> }>('../app/api/v08/worlds/[id]/route.ts', modules);
    const world = makeWorld();
    const context = { params: Promise.resolve({ id: world.id }) };
    const get = () => new Request('https://microgalaxy.example/api/v08/worlds',{headers:{'x-microgalaxy-retention':'1','x-microgalaxy-session':'test-session-owner'}});
    const mutation = (method: 'POST' | 'PUT', body: unknown) => new Request('https://microgalaxy.example/api/v08/worlds', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-microgalaxy-retention':'1', 'x-microgalaxy-session':'test-session-owner' } });
    assert.equal((await catalogue.GET(get())).status, 401);
    assert.equal((await catalogue.POST(mutation('POST', { world }))).status, 401);
    assert.equal((await item.GET(get(), context)).status, 401);
    assert.equal((await item.PUT(mutation('PUT', { world, revision: 1 }), context)).status, 401);
    assert.equal(f.queries.length, 0);
    signedIn = true;
    const rejectedOldModel = await catalogue.POST(mutation('POST', { world: { ...createV03World('DO-NOT-MIGRATE'), id: world.id } }));
    assert.equal(rejectedOldModel.status, 400);
    assert.equal((await rejectedOldModel.json() as { code: string }).code, 'invalid_world');
    const rejectedV04 = await catalogue.POST(mutation('POST', { world: { ...createV04World('DO-NOT-MIGRATE-04'), id: world.id } }));
    assert.equal(rejectedV04.status, 400);
    assert.equal(f.queries.length, 0);
    const created = await catalogue.POST(mutation('POST', { world }));
    assert.equal(created.status, 201);
    assert.match(created.headers.get('x-microgalaxy-lease')||'',/^[0-9a-f-]{36}$/i);
    assert.equal((await created.json() as Receipt).revision, 1);
    const snapshot = await item.GET(get(), context);
    assert.equal(snapshot.status, 200);
    assert.match(snapshot.headers.get('x-microgalaxy-lease')||'',/^[0-9a-f-]{36}$/i);
    assert.deepEqual((await snapshot.json() as { world: V08World }).world, world);
    const saved = await item.PUT(mutation('PUT', { world, revision: 1 }), context);
    assert.equal(saved.status, 200);
    assert.match(saved.headers.get('x-microgalaxy-lease')||'',/^[0-9a-f-]{36}$/i);
    assert.equal((await saved.json() as Receipt).revision, 2);
    const all = await catalogue.GET(get());
    assert.equal((await all.json() as Catalogue).worlds.length, 1);
    for (const query of ['cursor=', 'cursor=bad', 'cursor=a&cursor=b']) {
      assert.equal((await catalogue.GET(new Request('https://microgalaxy.example/api/v08/worlds?' + query))).status, 400);
    }
  } finally { f.close(); }
});
