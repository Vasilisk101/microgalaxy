import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import ts from 'typescript';
import * as registry from '../lib/world-models.mjs';
import type { CatalogCursor, CatalogModel } from '../lib/world-catalog';

type Row = { key: string; id: string; model: CatalogModel; modelVersion: string; versionLabel: string; openPath: string; updatedAt: string; source: string };
type Page = { partial?: boolean; unavailableModels?: CatalogModel[]; skippedRows?: number; worlds: Row[]; hasMore: boolean; nextCursor: string | null; source: string };
type Module = {
  listWorldCatalog(owner: string, cursor?: string | null): Promise<Page>;
  encodeCatalogCursor(position: CatalogCursor): string;
  decodeCatalogCursor(token: string): CatalogCursor;
  catalogResponse(value: unknown, status?: number): Response;
  catalogError(error: unknown): Response;
};
const MODELS = Object.keys(registry.WORLD_MODELS) as CatalogModel[];
const VERSIONS = {classic:'0.1.0',v03:'0.3-local.1',v04:'0.4.0',v05:'0.5.0',v06:'0.6.0',v07:'0.7.0',v08:'0.8.0',v1:'1.0.0'};
const TABLES = Object.fromEntries(Object.entries(registry.WORLD_MODELS).map(([model, entry]) => [model,entry.table]));
const PATHS = Object.fromEntries(Object.entries(registry.WORLD_MODELS).map(([model, entry]) => [model,entry.path]));
const time = '2026-11-16T10:00:00.000Z';
const idFor = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function loadModule<T>(file: string, modules: Record<string, unknown>): T {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', outputText)((name: string) => {
    if (!(name in modules)) throw new Error('Unexpected test dependency: ' + name);
    return modules[name];
  }, exports);
  return exports as T;
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const queries: { sql: string; values: SQLInputValue[] }[] = [];
  let broken = false;
  let failedModel: CatalogModel | null = null;
  const env = { DB: {
    prepare(sql: string) {
      assert.match(sql.trim(), /^(WITH|SELECT)\b/);
      assert.doesNotMatch(sql, /snapshot_key|previous_snapshot_key|\b(?:INSERT|UPDATE|DELETE|CREATE|DROP)\b/i);
      return { bind(...values: SQLInputValue[]) { return { async all() {
        queries.push({ sql, values });
        if (broken || (failedModel && sql.includes('FROM '+TABLES[failedModel]+' WHERE owner_id'))) throw new Error('Private SQL/infrastructure detail');
        return { results: sqlite.prepare(sql).all(...values) };
      } }; } };
    },
  } };
  // No R2 binding exists: the catalogue must not read full snapshots.
  const catalogue = loadModule<Module>('../lib/world-catalog.ts', { 'cloudflare:workers': { env }, './world-models.mjs': registry });
  function add(model: CatalogModel, n: number, owner = 'owner-a', updatedAt = time) {
    const id = idFor(n), key = `${model}:${id}`;
    if (model === 'classic') sqlite.prepare('INSERT INTO worlds VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, owner, key, 'seed', n, 1000, 'Era', 3, 'private-object-key', null, time, updatedAt);
    else sqlite.prepare(`INSERT INTO ${TABLES[model]} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, owner, key, 'seed', 'agriculture', 'schema', VERSIONS[model], n, 1000, 'Era', 4, 'private-object-key', null, time, updatedAt);
    return { key, id, model, updatedAt };
  }
  return { catalogue, sqlite, queries, add, setBroken(value: boolean) { broken = value; },
    setFailedModel(model: CatalogModel | null) { failedModel = model; }, close() { sqlite.close(); } };
}

test('unified catalogue cursor keeps model/id composite identity and rejects model-API cursors', () => {
  const f = fixture();
  try {
    const point: CatalogCursor = { updatedAt: time, model: 'v05', id: idFor(1) };
    const token = f.catalogue.encodeCatalogCursor(point);
    assert.deepEqual(f.catalogue.decodeCatalogCursor(token), point);
    const raw = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    for (const bad of ['', token + '=', 'A'.repeat(513), '!', raw({ v: 5, updatedAt: time, id: point.id }),
      raw({ v: 5, kind: 'world-catalog', ...point, model: 'foreign' }),
      raw({ v: 5, kind: 'world-catalog', ...point, updatedAt: '2026-02-30T10:00:00.000Z' }),
      raw({ v: 5, kind: 'world-catalog', ...point, id: '../private' }),
      raw({ v: 5, kind: 'world-catalog', ...point, owner: 'owner-b' })]) {
      assert.throws(() => f.catalogue.decodeCatalogCursor(bad), { status: 400, code: 'invalid_cursor' });
    }
  } finally { f.close(); }
});

test('unified catalogue lists all seven archives and the observatory without merging equal world IDs or touching snapshots', async () => {
  const f = fixture();
  try {
    for (const model of MODELS) f.add(model, 1);
    const before = MODELS.map(model => f.sqlite.prepare(`SELECT * FROM ${TABLES[model]}`).all());
    const page = await f.catalogue.listWorldCatalog('owner-a');
    assert.deepEqual(MODELS, ['classic','v03','v04','v05','v06','v07','v08','v1']);
    assert.equal(page.worlds.length, 8);
    assert.equal(new Set(page.worlds.map(row => row.id)).size, 1);
    assert.equal(new Set(page.worlds.map(row => row.key)).size, 8);
    assert.deepEqual(page.worlds.map(row => row.model), MODELS);
    for (const row of page.worlds) {
      assert.equal(row.modelVersion, VERSIONS[row.model]);
      assert.equal(row.source, 'cloud');
      assert.ok(row.versionLabel.length > 0);
      const link = new URL(row.openPath, 'https://microgalaxy.example');
      assert.equal(link.origin, 'https://microgalaxy.example');
      assert.equal(link.pathname, PATHS[row.model]);
      assert.equal(link.searchParams.get('world'), row.id);
      assert.equal(link.searchParams.get('source'), 'cloud');
      assert.doesNotMatch(JSON.stringify(row), /owner_id|snapshot_key|private-object-key/);
    }
    assert.equal(page.source, 'cloud');
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(MODELS.map(model => f.sqlite.prepare(`SELECT * FROM ${TABLES[model]}`).all()), before);
  } finally { f.close(); }
});

test('unified keyset pagination crosses table, timestamp and ID ties with owner scope on every branch', async () => {
  const f = fixture();
  try {
    const rows = [];
    for (const model of MODELS) for (let n = 1; n <= 61; n++) {
      rows.push(f.add(model, n, 'owner-a', new Date(Date.parse(time) - Math.floor(n / 23) * 1000).toISOString()));
    }
    for (const model of MODELS) for (let n = 1001; n <= 1005; n++) f.add(model, n, 'owner-b');
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.model.localeCompare(b.model) || a.id.localeCompare(b.id));
    const keys: string[] = [], sizes: number[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await f.catalogue.listWorldCatalog('owner-a', cursor);
      keys.push(...page.worlds.map(row => row.key)); sizes.push(page.worlds.length); cursor = page.nextCursor;
      assert.equal(page.hasMore, !!page.nextCursor);
    } while (cursor);
    assert.deepEqual(sizes, [100, 100, 100, 100, 88]);
    assert.deepEqual(keys, rows.map(row => row.key));
    assert.equal(new Set(keys).size, 488);
    for (const query of f.queries) assert.equal(query.values[0], 'owner-a');
    const first = await f.catalogue.listWorldCatalog('owner-a');
    const other = await f.catalogue.listWorldCatalog('owner-b', first.nextCursor);
    assert.ok(other.worlds.every(row => !keys.includes(row.key)));
    const empty = await f.catalogue.listWorldCatalog('missing-owner');
    assert.deepEqual(empty, { worlds: [], hasMore: false, source: 'cloud', nextCursor: null });
  } finally { f.close(); }
});

test('unified catalogue exact page and malformed cursors do not issue extra queries', async () => {
  const f = fixture();
  try {
    for (let n = 1; n <= 100; n++) f.add('v05', n);
    const page = await f.catalogue.listWorldCatalog('owner-a');
    assert.equal(page.worlds.length, 100); assert.equal(page.hasMore, false); assert.equal(page.nextCursor, null);
    const count = f.queries.length;
    await assert.rejects(f.catalogue.listWorldCatalog('owner-a', ''), { status: 400, code: 'invalid_cursor' });
    await assert.rejects(f.catalogue.listWorldCatalog('owner-a', 'bad'), { code: 'invalid_cursor' });
    assert.equal(f.queries.length, count);
  } finally { f.close(); }
});

test('a damaged metadata row at a page boundary does not hide the next valid row', async () => {
  const f = fixture();
  try {
    for (let i = 1; i <= 102; i++) f.add('v08', i);
    f.sqlite.prepare('UPDATE worlds_v08 SET year=-1 WHERE id=?').run(idFor(100));
    f.sqlite.prepare("UPDATE worlds_v08 SET updated_at='2026-11-16 10:00:00' WHERE id=?").run(idFor(102));
    const first = await f.catalogue.listWorldCatalog('owner-a');
    assert.equal(first.partial, true);
    assert.equal(first.skippedRows, 1);
    assert.equal(first.worlds.length, 99);
    const next = await f.catalogue.listWorldCatalog('owner-a', first.nextCursor);
    assert.deepEqual(next.worlds.map(w => w.id), [idFor(101), idFor(102)]);
    assert.equal(next.worlds[1].updatedAt, time);
  } finally { f.close(); }
});

test('a temporarily unavailable model preserves all readable models across pages and recovers on refresh', async () => {
  const f = fixture();
  try {
    for (let i = 1; i <= 103; i++) f.add('v08', i);
    f.add('v04', 1);
    f.setFailedModel('v04');
    const first = await f.catalogue.listWorldCatalog('owner-a');
    const second = await f.catalogue.listWorldCatalog('owner-a', first.nextCursor);
    assert.deepEqual(first.unavailableModels, ['v04']);
    assert.deepEqual(second.unavailableModels, ['v04']);
    assert.equal(new Set([...first.worlds, ...second.worlds].map(w=>w.key)).size, 103);
    f.setFailedModel(null);
    const refreshed = await f.catalogue.listWorldCatalog('owner-a');
    assert.equal(refreshed.partial, undefined);
    assert.equal(refreshed.worlds[0].model, 'v04');
  } finally { f.close(); }
});

test('unified GET is authenticated and read-only; unavailable is not represented as an empty archive', async () => {
  const f = fixture();
  try {
    let signedIn = false;
    const route = loadModule<Record<string, unknown> & { GET(request: Request): Promise<Response> }>('../app/api/world-catalog/route.ts', {
      '@/app/chatgpt-auth': { async getChatGPTUser() { return signedIn ? { userId: 'owner-a', displayName: 'Наблюдатель' } : null; } },
      '@/lib/world-catalog': f.catalogue,
    });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(route[method], undefined);
    const request = (query = '') => new Request('https://microgalaxy.example/api/world-catalog' + query);
    const denied = await route.GET(request());
    assert.equal(denied.status, 401); assert.equal(f.queries.length, 0);
    assert.equal((await denied.json() as { code: string }).code, 'unauthorized');
    signedIn = true;
    f.add('v04', 1);
    const ok = await route.GET(request());
    assert.equal(ok.status, 200); assert.equal((await ok.json() as Page).worlds.length, 1);
    assert.equal(ok.headers.get('cache-control'), 'private, no-store, max-age=0');
    for (const query of ['?cursor=', '?cursor=bad', '?cursor=a&cursor=b']) assert.equal((await route.GET(request(query))).status, 400);
    f.setBroken(true);
    const unavailable = await route.GET(request());
    assert.equal(unavailable.status, 503);
    const body = await unavailable.json() as Record<string, unknown>;
    assert.equal(body.code, 'catalog_unavailable'); assert.equal(body.worlds, undefined);
    assert.doesNotMatch(JSON.stringify(body), /Private SQL|infrastructure/);
  } finally { f.close(); }
});
