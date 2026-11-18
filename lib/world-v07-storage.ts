import {beginRetentionWrite,abandonKnownFailedWrite,afterRetentionWrite} from './retention-cloud';
import { env } from 'cloudflare:workers';
import {
  assertV07Id, assertV07Update, decodeV07Cursor, encodeV07Cursor, MAX_V07_SNAPSHOT_BYTES,
  parseV07Snapshot, validateV07World, V07_PAGE_SIZE, V07StorageError, v07SnapshotContent,
  v07WorldMetrics, type V07Identity, type V07World,
} from '@/lib/world-v07-contract';

export {
  readV07MutationBody, v07Error, v07Response, v07RevisionFromPayload, v07WorldFromPayload,
} from '@/lib/world-v07-contract';

type V07Row = V07Identity & {
  owner_id: string;
  name: string;
  population: number;
  era: string;
  snapshot_key: string;
  previous_snapshot_key: string | null;
  created_at: string;
  updated_at: string;
};

function bindings() {
  if (!env.DB || !env.BUCKET) throw new V07StorageError(503, 'storage_unavailable', 'Облачные сохранения временно недоступны.');
  return { db: env.DB, bucket: env.BUCKET };
}

function rowSummary(row: V07Row) {
  return {
    id: row.id, name: row.name, seed: row.seed, year: row.year, population: row.population,
    era: row.era, startingEra: row.starting_era, schema: row.schema_version, modelVersion: row.model_version,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** A timed-out write has an uncertain outcome. Its immutable snapshot must not be deleted. */
async function storageCall<T>(operation: Promise<T>, timeoutMs = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new V07StorageError(503, 'storage_timeout', 'Облако не ответило вовремя. Проверьте архив перед повторной записью; локальная история не изменена.')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

function snapshotKey(ownerId: string, id: string): string {
  return `worlds-v07/${encodeURIComponent(ownerId)}/${id}/${crypto.randomUUID()}.json`;
}

async function ownedWorld(ownerId: string, id: string): Promise<V07Row> {
  assertV07Id(id);
  const { db } = bindings();
  const row = await storageCall(db.prepare('SELECT * FROM worlds_v07 WHERE id = ? AND owner_id = ?').bind(id, ownerId).first<V07Row>());
  if (!row) throw new V07StorageError(404, 'world_not_found', 'Сохранение не найдено.');
  return row;
}

export async function listV07Worlds(ownerId: string, cursor?: string | null) {
  const position = cursor === undefined || cursor === null ? null : decodeV07Cursor(cursor);
  const { db } = bindings();
  const query = position
    ? db.prepare('SELECT * FROM worlds_v07 WHERE owner_id = ? AND (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC, id ASC LIMIT 101')
      .bind(ownerId, position.updatedAt, position.updatedAt, position.id)
    : db.prepare('SELECT * FROM worlds_v07 WHERE owner_id = ? ORDER BY updated_at DESC, id ASC LIMIT 101').bind(ownerId);
  const { results } = await storageCall(query.all<V07Row>());
  const page = results.slice(0, V07_PAGE_SIZE);
  const hasMore = results.length > V07_PAGE_SIZE;
  const last = page.at(-1);
  return { worlds: page.map(rowSummary), hasMore, nextCursor: hasMore && last ? encodeV07Cursor({ id: last.id, updatedAt: last.updated_at }) : null };
}

export async function createV07World(ownerId: string, input: V07World) {
  // Own a detached snapshot before validation and before the first asynchronous
  // storage operation; callers cannot mutate the validated payload or metadata.
  const world = validateV07World(structuredClone(input));
  const { db, bucket } = bindings();
  const content = v07SnapshotContent(world);
  const key = snapshotKey(ownerId, world.id);
  const now = new Date().toISOString();
  const metrics = v07WorldMetrics(world);
  await beginRetentionWrite(ownerId,'v07',world.id,key,new TextEncoder().encode(content).byteLength);
  await storageCall(bucket.put(key, content, { httpMetadata: { contentType: 'application/json; charset=utf-8' } }));
  // A database failure may follow a committed transaction. Keep its snapshot.
  const result = await storageCall(db.prepare(`INSERT INTO worlds_v07
    (id, owner_id, name, seed, starting_era, schema_version, model_version, year, population, era, revision, snapshot_key, previous_snapshot_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`)
    .bind(world.id, ownerId, world.name, world.seed, world.era, world.schema, world.modelVersion,
      world.year, metrics.population, metrics.era, key, now, now).run());
  // D1 counts changes made by retention triggers too. Only zero proves no row was written.
  if (result.meta.changes === 0) {
    await storageCall(bucket.delete(key)).catch(() => {});
    await abandonKnownFailedWrite(key).catch(()=>{});
    throw new V07StorageError(409, 'world_exists', 'Этот мир уже есть в облаке. Откройте его облачную версию или сохраните отдельную копию.');
  }
  if (!(result.meta.changes > 0)) throw new Error('Cloud write receipt unavailable');
  await afterRetentionWrite(ownerId,'v07',world.id);
  return { id: world.id, revision: 1, updatedAt: now };
}

export async function readV07World(ownerId: string, id: string, ifNoneMatch?: string | null) {
  const row = await ownedWorld(ownerId, id);
  const etag = `"v07-${row.revision}"`;
  if (ifNoneMatch === etag) return { notModified: true as const, revision: row.revision, etag };
  const { bucket } = bindings();
  const object = await storageCall(bucket.get(row.snapshot_key));
  if (!object || object.size > MAX_V07_SNAPSHOT_BYTES) throw new V07StorageError(503, 'snapshot_unavailable', 'Не удалось прочитать снимок мира. Сохранение не изменено.');
  let world: V07World;
  try {
    world = parseV07Snapshot(await storageCall(object.text()));
    if (world.id !== row.id || world.year !== row.year || world.seed !== row.seed ||
        world.era !== row.starting_era || world.schema !== row.schema_version || world.modelVersion !== row.model_version) {
      throw new Error('Snapshot identity mismatch');
    }
  } catch {
    throw new V07StorageError(503, 'snapshot_unavailable', 'Не удалось прочитать снимок мира. Сохранение не изменено.');
  }
  return { world, revision: row.revision, updatedAt: row.updated_at, etag };
}

export async function updateV07World(ownerId: string, id: string, input: V07World, revision: number) {
  const world = validateV07World(structuredClone(input));
  const current = await ownedWorld(ownerId, id);
  assertV07Update(current, id, world, revision);
  const { db, bucket } = bindings();
  const content = v07SnapshotContent(world);
  const key = snapshotKey(ownerId, id);
  const now = new Date().toISOString();
  const metrics = v07WorldMetrics(world);
  await beginRetentionWrite(ownerId,'v07',world.id,key,new TextEncoder().encode(content).byteLength);
  await storageCall(bucket.put(key, content, { httpMetadata: { contentType: 'application/json; charset=utf-8' } }));
  const result = await storageCall(db.prepare(`UPDATE worlds_v07 SET name = ?, year = ?, population = ?, era = ?,
    revision = revision + 1, previous_snapshot_key = snapshot_key, snapshot_key = ?, updated_at = ?
    WHERE id = ? AND owner_id = ? AND revision = ?`)
    .bind(world.name, world.year, metrics.population, metrics.era, key, now, id, ownerId, revision).run());
  // D1 counts changes made by retention triggers too. Only zero proves no row was written.
  if (result.meta.changes === 0) {
    await storageCall(bucket.delete(key)).catch(() => {});
    await abandonKnownFailedWrite(key).catch(()=>{});
    throw new V07StorageError(409, 'revision_conflict', 'Мир изменён на другом устройстве. Облачная история не перезаписана.');
  }
  if (!(result.meta.changes > 0)) throw new Error('Cloud write receipt unavailable');
  await afterRetentionWrite(ownerId,'v07',world.id);
  return { id, revision: revision + 1, updatedAt: now };
}
