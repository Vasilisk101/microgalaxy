import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createWorld, advanceWorld, type World } from '../lib/simulation.ts';
import { getLocalWorld, getLocalWorlds, saveLocalWorld, preserveLocalWorld, type LocalWorld } from '../lib/local-worlds.ts';

const worldId = '22222222-2222-4222-8222-222222222222';
const recoveryId = '33333333-3333-4333-8333-333333333333';
const initial = createWorld('LOCAL-PERSISTENCE', { id: worldId });
const record = (year: number, revision = 1, syncedYear = 0): LocalWorld => ({
  world: advanceWorld(initial, year), revision, syncedYear,
  updatedAt: new Date(Date.UTC(2026, 10, 16, 0, 0, year)).toISOString(),
});

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

async function rawRecord(id: string, replacement?: unknown): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('microgalaxy-observatory-v1', 3);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('worlds', replacement === undefined ? 'readonly' : 'readwrite');
    const store = tx.objectStore('worlds');
    if (replacement !== undefined) store.put(replacement);
    const request = store.get(id);
    tx.oncomplete = () => {db.close(); resolve(request.result);};
    tx.onerror = () => {db.close(); reject(tx.error);};
  });
}

test('a damaged existing record cannot be silently replaced by a valid cloud snapshot', async () => {
  await saveLocalWorld(record(10));
  const broken = {...record(10), world:{...record(10).world, year:-1}};
  await rawRecord(worldId, broken);
  await assert.rejects(saveLocalWorld(record(20, 2, 20), {replace:true, preserveReplaced:true}), /повреждена/);
  assert.deepEqual(await rawRecord(worldId), broken);
});

test('a recovery id occupied by a damaged record is preserved and another id is used', async () => {
  await saveLocalWorld(record(10, 2, 10));
  const broken = {...record(10), world:{...record(10).world, id:recoveryId, year:-1}};
  await rawRecord(recoveryId, broken);
  const result = await preserveLocalWorld(record(100, 1, 0), recoveryId);
  assert.equal(result.status, 'recovered');
  assert.notEqual(result.record.world.id, recoveryId);
  assert.deepEqual(await rawRecord(recoveryId), broken);
});

test('a newer cloud revision cannot silently discard advanced unsynchronized progress', async () => {
  await saveLocalWorld(record(10, 2, 10));
  const incoming = record(100, 1, 0);
  const outcome = await saveLocalWorld(incoming);
  assert.equal(outcome.status, 'superseded');
  assert.equal(outcome.record.world.year, 10);
  assert.equal(outcome.record.revision, 2);
  assert.deepEqual(await getLocalWorld(worldId), record(10, 2, 10));

  const preserved = await preserveLocalWorld(incoming, recoveryId);
  assert.equal(preserved.status, 'recovered');
  assert.equal(preserved.record.world.id, recoveryId);
  assert.deepEqual(preserved.record.world, { ...incoming.world, id: recoveryId });
  assert.equal(preserved.record.revision, 0);
  assert.equal(preserved.record.syncedYear, -1);
  assert.equal(preserved.record.recoveryOf, worldId);
  assert.equal((await getLocalWorld(worldId))!.world.year, 10);
  assert.equal((await getLocalWorld(recoveryId))!.world.year, 100);
});

test('concurrent checkpoints retain the later year regardless of submission order', async () => {
  for (const years of [[25, 100], [100, 25]]) {
    globalThis.indexedDB = new IDBFactory();
    await Promise.all(years.map(year => saveLocalWorld(record(year))));
    assert.equal((await getLocalWorld(worldId))!.world.year, 100);
    const lateOldSave = await saveLocalWorld(record(25));
    assert.equal(lateOldSave.status, 'superseded');
    assert.equal(lateOldSave.record.world.year, 100);
  }
});

test('identical snapshots merge synchronization metadata without lowering its revision', async () => {
  const current = record(50, 3, 50);
  await saveLocalWorld(current);
  const delayed = record(50, 1, 0);
  delayed.world = Object.fromEntries(Object.entries(delayed.world).reverse()) as unknown as World;
  delayed.updatedAt = '2026-11-15T00:00:00.000Z';
  const outcome = await saveLocalWorld(delayed);
  assert.equal(outcome.status, 'identical');
  assert.equal(outcome.record.revision, 3);
  assert.equal(outcome.record.syncedYear, 50);
  assert.equal(outcome.record.updatedAt, current.updatedAt);
  assert.deepEqual(outcome.record.world, current.world);
});

test('different histories at the same year are not mistaken for identical saved data', async () => {
  const first = record(40, 2, 40);
  await saveLocalWorld(first);
  const second = record(40, 2, 0);
  second.world.societies[0].food += second.world.societies[0].food <= 2.5 ? 0.25 : -0.25;
  assert.equal((await saveLocalWorld(second)).status, 'superseded');
  const preserved = await preserveLocalWorld(second, recoveryId);
  assert.equal(preserved.status, 'recovered');
  assert.deepEqual((await getLocalWorld(worldId))!.world, first.world);
  assert.deepEqual((await getLocalWorld(recoveryId))!.world, { ...second.world, id: recoveryId });
});

test('one recovery id coalesces advancing checkpoints and rejects late regressions', async () => {
  await saveLocalWorld(record(10, 3, 10));
  await Promise.all([100, 150, 120].map(year => preserveLocalWorld(record(year, 1, 0), recoveryId)));
  assert.equal((await getLocalWorld(worldId))!.world.year, 10);
  assert.equal((await getLocalWorld(recoveryId))!.world.year, 150);
  assert.equal((await getLocalWorlds()).length, 2);
  const result = await preserveLocalWorld(record(125, 1, 0), recoveryId);
  assert.equal(result.status, 'recovered');
  assert.equal(result.record.world.year, 150);
});

test('forced cloud replacement preserves a concurrent unsynchronized checkpoint atomically', async () => {
  await saveLocalWorld(record(10, 1, 0));
  const [, replacement] = await Promise.all([
    saveLocalWorld(record(100, 1, 0)),
    saveLocalWorld(record(20, 2, 20), { replace: true, preserveReplaced: true, recoveryId }),
  ]);
  assert.equal(replacement.status, 'written');
  assert.equal(replacement.recovery?.world.year, 100);
  assert.equal((await getLocalWorld(worldId))!.world.year, 20);
  assert.equal((await getLocalWorld(worldId))!.revision, 2);
  assert.equal((await getLocalWorld(recoveryId))!.world.year, 100);
});

test('an older writer after cloud replacement gets an explicit conflict and can preserve its progress', async () => {
  await saveLocalWorld(record(10, 1, 0));
  const [, lateWrite] = await Promise.all([
    saveLocalWorld(record(20, 2, 20), { replace: true, preserveReplaced: true, recoveryId }),
    saveLocalWorld(record(100, 1, 0)),
  ]);
  assert.equal(lateWrite.status, 'superseded');
  await preserveLocalWorld(record(100, 1, 0), recoveryId);
  assert.equal((await getLocalWorld(worldId))!.world.year, 20);
  assert.equal((await getLocalWorld(recoveryId))!.world.year, 100);
});

test('a failed backup prevents forced replacement from losing the previous checkpoint', async () => {
  const previous = record(100, 1, 0);
  await saveLocalWorld(previous);
  await assert.rejects(saveLocalWorld(record(20, 2, 20), {
    replace: true, preserveReplaced: true, recoveryId: worldId,
  }));
  assert.deepEqual(await getLocalWorld(worldId), previous);
  assert.equal((await getLocalWorlds()).length, 1);
});

test('a recovery id collision never overwrites another independent world', async () => {
  const independent: LocalWorld = {
    world: createWorld('OTHER-HISTORY', { id: recoveryId }),
    revision: 1, syncedYear: 0, updatedAt: '2026-11-16T00:00:00.000Z',
  };
  await saveLocalWorld(record(10, 2, 10));
  await saveLocalWorld(independent);
  const outcome = await preserveLocalWorld(record(100, 1, 0), recoveryId);
  assert.equal(outcome.status, 'recovered');
  assert.notEqual(outcome.record.world.id, recoveryId);
  assert.equal(outcome.record.world.year, 100);
  assert.deepEqual(await getLocalWorld(recoveryId), independent);
  assert.equal((await getLocalWorlds()).length, 3);
});
