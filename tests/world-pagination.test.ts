import {retentionTestModule} from './retention-test-loader.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as simulation from '../lib/simulation.ts';
import * as pagination from '../lib/world-pagination.ts';

type Catalogue = { worlds: { id: string; updatedAt: string; name: string }[]; hasMore: boolean; nextCursor: string | null };
type StorageModule = { listWorlds(owner: string, cursor?: string | null): Promise<Catalogue> };
const fixedTime = '2026-11-16T10:00:00.000Z';
const idFor = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

// Execute the actual storage/query implementation against SQLite, replacing
// only the Cloudflare binding. No production route or auth policy is changed.
function loadModule<T>(file: string, modules: Record<string, unknown>): T {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: Record<string, unknown> = {};
    new Function('require', 'exports', outputText)((name: string) => {
    if(name==='./retention-cloud'||name==='@/lib/retention-cloud')return retentionTestModule(modules);
        if (!(name in modules)) throw new Error(`Unexpected test dependency: ${name}`);
        return modules[name];
    }, exports);
    return exports as T;
}

function fixture() {
    const sqlite = new DatabaseSync(':memory:');
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const file of readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()) {
        sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
    let queries = 0;
    const db = {
        prepare(sql: string) {
            queries++;
            return { bind(...values: (string | number)[]) {
                return { async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
            } };
        },
    };
    const storage = loadModule<StorageModule>('../lib/world-storage.ts', {
        'cloudflare:workers': { env: { DB: db, BUCKET: {} } },
        '@/lib/simulation': simulation,
        '@/lib/world-pagination': pagination,
    });
    const insert = sqlite.prepare('INSERT INTO worlds (id,owner_id,name,seed,year,population,era,revision,snapshot_key,previous_snapshot_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?)');
    function add(n: number, owner = 'owner-a', updatedAt = fixedTime) {
        const id = idFor(n);
        insert.run(id, owner, `Мир ${n}`, `seed-${n}`, n, 1000000, 'Ранние государства', 1, `snapshot-${n}`, fixedTime, updatedAt);
        return { id, owner, updatedAt };
    }
    return { storage, add, queryCount: () => queries, close: () => sqlite.close() };
}

test('world cursor round-trips and rejects malformed, oversized and unversioned input', () => {
    const position = { updatedAt: fixedTime, id: idFor(1) };
    const token = pagination.encodeWorldCursor(position);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(pagination.decodeWorldCursor(token), position);
    const rawToken = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    for (const bad of ['', '!', 'a'.repeat(257), token + '=', rawToken(null), rawToken({}),
        rawToken({ v: 2, ...position }), rawToken({ v: 1, ...position, sql: 'DROP TABLE worlds' }),
        rawToken({ v: 1, ...position, id: 'invalid' }),
        rawToken({ v: 1, ...position, updatedAt: '2026-02-30T10:00:00.000Z' }),
        rawToken({ v: 1, ...position, updatedAt: '2026-11-16' })]) {
        assert.throws(() => pagination.decodeWorldCursor(bad), pagination.InvalidWorldCursorError);
    }
});

test('world archive pages retain every owned row exactly once across equal timestamps', async () => {
    const f = fixture();
    try {
        const owned = [];
        for (let n = 1; n <= 205; n++) {
            // Timestamp groups cross the 100-row boundary, exercising id ASC.
            owned.push(f.add(n, 'owner-a', new Date(Date.parse(fixedTime) - Math.floor(n / 37) * 1000).toISOString()));
        }
        for (let n = 1000; n < 1030; n++) f.add(n, 'owner-b');
        const expected = owned.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        const ids: string[] = [];
        const sizes: number[] = [];
        let cursor: string | null | undefined;
        do {
            const page = await f.storage.listWorlds('owner-a', cursor);
            sizes.push(page.worlds.length);
            ids.push(...page.worlds.map(row => row.id));
            assert.equal(page.hasMore, page.nextCursor !== null);
            cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(sizes, [100, 100, 5]);
        assert.deepEqual(ids, expected.map(row => row.id));
        assert.equal(new Set(ids).size, 205);

        const first = await f.storage.listWorlds('owner-a');
        const otherOwner = await f.storage.listWorlds('owner-b', first.nextCursor);
        assert.ok(otherOwner.worlds.every(row => !ids.includes(row.id)), 'a cursor must never broaden owner scope');
        assert.deepEqual(await f.storage.listWorlds('missing-owner'), { worlds: [], hasMore: false, nextCursor: null });
    } finally { f.close(); }
});

test('archive limit is exact and bad cursors return a client error before querying D1', async () => {
    const f = fixture();
    try {
        for (let n = 1; n <= 100; n++) f.add(n);
        const page = await f.storage.listWorlds('owner-a');
        assert.equal(page.worlds.length, 100);
        assert.equal(page.hasMore, false);
        assert.equal(page.nextCursor, null);
        const queries = f.queryCount();
        for (const cursor of ['', 'not-a-json-cursor']) {
            await assert.rejects(f.storage.listWorlds('owner-a', cursor), { status: 400, code: 'invalid_cursor' });
        }
        assert.equal(f.queryCount(), queries);
    } finally { f.close(); }
});

test('GET archive accepts a cursor and rejects duplicate or malformed cursor parameters', async () => {
    const f = fixture();
    try {
        for (let n = 1; n <= 101; n++) f.add(n);
        // Use the real route and storage module; only getChatGPTUser is a fixture.
        const route = loadModule<{ GET(request: Request): Promise<Response> }>('../app/api/worlds/route.ts', {
            '@/app/chatgpt-auth': { async getChatGPTUser() { return { userId: 'owner-a', displayName: 'Наблюдатель' }; } },
            '@/lib/world-storage': f.storage,
        });
        const first = await route.GET(new Request('https://microgalaxy.example/api/worlds'));
        assert.equal(first.status, 200);
        const catalogue = await first.json() as Catalogue;
        assert.ok(catalogue.nextCursor);
        const second = await route.GET(new Request(`https://microgalaxy.example/api/worlds?cursor=${encodeURIComponent(catalogue.nextCursor!)}`));
        assert.equal(second.status, 200);
        assert.equal(((await second.json()) as Catalogue).worlds.length, 1);
        for (const query of ['cursor=', 'cursor=bad', 'cursor=a&cursor=b']) {
            const response = await route.GET(new Request(`https://microgalaxy.example/api/worlds?${query}`));
            assert.equal(response.status, 400);
            assert.equal(((await response.json()) as { code: string }).code, 'invalid_cursor');
        }
    } finally { f.close(); }
});
