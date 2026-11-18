import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createWorld, advance, clone } from '../src/core.mjs';
import { openWorldStore, memoryWorldStore } from '../src/storage.mjs';

const stamp = '2026-11-16T08:00:00.000Z';
function fresh(seed = 'STORAGE-03') {
  const w = createWorld(seed);
  w.id = randomUUID();
  return w;
}
function isConflict(error) { return error?.name === 'ConflictError'; }
async function withStore(kind, run) {
  if (kind === 'IndexedDB') globalThis.indexedDB = new IDBFactory();
  const store = kind === 'IndexedDB' ? await openWorldStore() : memoryWorldStore();
  try { await run(store); } finally { store.close(); }
}

for (const kind of ['memory', 'IndexedDB']) {
  test(`${kind}: cloud receipt and local revision are independent`, async () => withStore(kind, async store => {
    const w = fresh();
    assert.equal(await store.put(w, 0), 1);
    await store.markSynced(w.id, 1, 8, stamp);
    const saved = await store.get(w.id);
    assert.equal(saved.revision, 1);
    assert.equal(saved.cloud.revision, 8);
    assert.equal(saved.cloud.syncedRevision, 1);
    assert.equal(saved.cloud.updatedAt, stamp);
  }));

  test(`${kind}: next local step retains cloud CAS revision and previous snapshot`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    await store.markSynced(w.id, 1, 4, stamp);
    const later = advance(w, 10).world;
    assert.equal(await store.put(later, 1), 2);
    const row = await store.get(w.id);
    assert.equal(row.world.year, 10);
    assert.deepEqual(row.previous, w);
    assert.equal(row.cloud.revision, 4);
    assert.equal(row.cloud.syncedRevision, 1);
    assert.notEqual(row.cloud.syncedRevision, row.revision);
  }));

  test(`${kind}: acknowledgement of an old snapshot never marks a newer step clean`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    const later = advance(w, 10).world;
    await store.put(later, 1);
    await store.markSynced(w.id, 1, 1, stamp);
    const row = await store.get(w.id);
    assert.deepEqual(row.world, later);
    assert.equal(row.revision, 2);
    assert.equal(row.cloud.revision, 1);
    assert.equal(row.cloud.syncedRevision, 1);
  }));

  test(`${kind}: late cloud acknowledgement cannot regress metadata`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    await store.markSynced(w.id, 1, 1, stamp);
    await store.put(advance(w, 10).world, 1);
    await store.markSynced(w.id, 2, 2, stamp);
    try { await store.markSynced(w.id, 1, 1, stamp); } catch (error) { assert.ok(error instanceof Error); }
    const row = await store.get(w.id);
    assert.equal(row.cloud.revision, 2);
    assert.equal(row.cloud.syncedRevision, 2);
    assert.equal(row.world.year, 10);
  }));

  test(`${kind}: cloud load on a new device establishes a clean local record`, async () => withStore(kind, async store => {
    const w = advance(fresh(), 25).world;
    await store.receiveCloud(w, 7, stamp, 0);
    const row = await store.get(w.id);
    assert.deepEqual(row.world, w);
    assert.equal(row.cloud.revision, 7);
    assert.equal(row.cloud.syncedRevision, row.revision);
  }));

  test(`${kind}: a newer cloud revision may advance a clean local record`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.receiveCloud(w, 1, stamp, 0);
    const prior = await store.get(w.id);
    const later = advance(w, 20).world;
    await store.receiveCloud(later, 2, stamp, prior.revision);
    const row = await store.get(w.id);
    assert.deepEqual(row.world, later);
    assert.deepEqual(row.previous, w);
    assert.equal(row.cloud.revision, 2);
    assert.equal(row.cloud.syncedRevision, row.revision);
  }));

  test(`${kind}: cloud cannot overwrite an unsynchronised local history`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.receiveCloud(w, 1, stamp, 0);
    const initial = await store.get(w.id);
    await store.put(advance(w, 10).world, initial.revision);
    const before = await store.get(w.id);
    await assert.rejects(() => store.receiveCloud(advance(w, 30).world, 2, stamp, before.revision), isConflict);
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: matching cloud history can acknowledge an uncertain save`, async () => withStore(kind, async store => {
    const w = advance(fresh(), 10).world;
    await store.put(w, 0);
    const before = await store.get(w.id);
    await store.receiveCloud(clone(w), 3, stamp, before.revision);
    const row = await store.get(w.id);
    assert.deepEqual(row.world, w);
    assert.equal(row.cloud.revision, 3);
    assert.equal(row.cloud.syncedRevision, row.revision);
  }));

  test(`${kind}: cloud load also respects local compare-and-swap`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    await store.markSynced(w.id, 1, 1, stamp);
    await store.put(advance(w, 10).world, 1);
    const before = await store.get(w.id);
    await assert.rejects(() => store.receiveCloud(before.world, 2, stamp, 1), isConflict);
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: failed validation does not mutate an existing record`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(w, 0);
    const broken = clone(w);
    broken.societies[0].population = -1;
    const before = await store.get(w.id);
    await assert.rejects(() => store.put(broken, 1));
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: a clean record still rejects a stale cloud revision`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.receiveCloud(advance(w, 20).world, 5, stamp, 0);
    const before = await store.get(w.id);
    await assert.rejects(() => store.receiveCloud(advance(w, 10).world, 4, stamp, before.revision), isConflict);
    assert.deepEqual(await store.get(w.id), before);
  }));

  test(`${kind}: save cannot replace identity or move history backwards`, async () => withStore(kind, async store => {
    const w = fresh();
    await store.put(advance(w, 10).world, 0);
    const before = await store.get(w.id);
    const changedSeed = clone(before.world); changedSeed.seed = 'OTHER-SEED';
    const changedEra = clone(before.world); changedEra.era = 'space';
    for (const next of [w, changedSeed, changedEra]) {
      await assert.rejects(() => store.put(next, before.revision));
      assert.deepEqual(await store.get(w.id), before);
    }
  }));
}

test('IndexedDB: stale second connection cannot overwrite the first connection', async () => {
  globalThis.indexedDB = new IDBFactory();
  const a = await openWorldStore(), b = await openWorldStore();
  try {
    const w = fresh();
    await a.put(w, 0);
    const stale = await b.get(w.id);
    await a.put(advance(w, 10).world, 1);
    await assert.rejects(() => b.put(advance(stale.world, 20).world, stale.revision), isConflict);
    assert.equal((await a.get(w.id)).world.year, 10);
    assert.equal((await b.get(w.id)).world.year, 10);
  } finally { a.close(); b.close(); }
});

test('IndexedDB: reopening preserves the world and cloud receipt', async () => {
  globalThis.indexedDB = new IDBFactory();
  const w = advance(fresh(), 20).world;
  const first = await openWorldStore();
  await first.put(w, 0);
  await first.markSynced(w.id, 1, 9, stamp);
  first.close();
  const reopened = await openWorldStore();
  try {
    const row = await reopened.get(w.id);
    assert.deepEqual(row.world, w);
    assert.equal(row.cloud.revision, 9);
    assert.equal(row.cloud.syncedRevision, row.revision);
    assert.ok((await reopened.list()).some(item => item.id === w.id));
  } finally { reopened.close(); }
});
