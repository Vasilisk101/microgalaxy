import {beginRetentionWrite,abandonKnownFailedWrite,afterRetentionWrite} from './retention-cloud';
import { env } from 'cloudflare:workers';
import {
  assertV05Id, assertV05Update, decodeV05Cursor, encodeV05Cursor, MAX_V05_SNAPSHOT_BYTES,
  parseV05Snapshot, validateV05World, V05_PAGE_SIZE, V05StorageError, v05SnapshotContent,
  v05WorldMetrics, type V05Identity, type V05World,
} from '@/lib/world-v05-contract';

export {
  readV05MutationBody, v05Error, v05Response, v05RevisionFromPayload, v05WorldFromPayload,
} from '@/lib/world-v05-contract';

type V05Row = V05Identity & {
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
  if (!env.DB || !env.BUCKET) throw new V05StorageError(503, 'storage_unavailable', 'Облачные сохранения временно недоступны.');
  return { db: env.DB, bucket: env.BUCKET };
}

function rowSummary(row: V05Row) {
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
      timer = setTimeout(() => reject(new V05StorageError(503, 'storage_timeout', 'Облако не ответило вовремя. Проверьте архив перед повторной записью; локальная история не изменена.')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

function snapshotKey(ownerId: string, id: string): string {
  return `worlds-v05/${encodeURIComponent(ownerId)}/${id}/${crypto.randomUUID()}.json`;
}

async function ownedWorld(ownerId: string, id: string): Promise<V05Row> {
  assertV05Id(id);
  const { db } = bindings();
  const row = await storageCall(db.prepare('SELECT * FROM worlds_v05 WHERE id = ? AND owner_id = ?').bind(id, ownerId).first<V05Row>());
  if (!row) throw new V05StorageError(404, 'world_not_found', 'Сохранение не найдено.');
  return row;
}

export async function listV05Worlds(ownerId: string, cursor?: string | null) {
  const position = cursor === undefined || cursor === null ? null : decodeV05Cursor(cursor);
  const { db } = bindings();
  const query = position
    ? db.prepare('SELECT * FROM worlds_v05 WHERE owner_id = ? AND (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC, id ASC LIMIT 101')
      .bind(ownerId, position.updatedAt, position.updatedAt, position.id)
    : db.prepare('SELECT * FROM worlds_v05 WHERE owner_id = ? ORDER BY updated_at DESC, id ASC LIMIT 101').bind(ownerId);
  const { results } = await storageCall(query.all<V05Row>());
  const page = results.slice(0, V05_PAGE_SIZE);
  const hasMore = results.length > V05_PAGE_SIZE;
  const last = page.at(-1);
  return { worlds: page.map(rowSummary), hasMore, nextCursor: hasMore && last ? encodeV05Cursor({ id: last.id, updatedAt: last.updated_at }) : null };
}

export async function createV05World(ownerId: string, input: V05World) {
  const world = validateV05World(structuredClone(input));
  const { db, bucket } = bindings();
  const content = v05SnapshotContent(world);
  const key = snapshotKey(ownerId, world.id);
  const now = new Date().toISOString();
  const metrics = v05WorldMetrics(world);
  await beginRetentionWrite(ownerId,'v05',world.id,key,new TextEncoder().encode(content).byteLength);
  await storageCall(bucket.put(key, content, { httpMetadata: { contentType: 'application/json; charset=utf-8' } }));
  // A database failure may follow a committed transaction. Keep its snapshot.
  const result = await storageCall(db.prepare(`INSERT INTO worlds_v05
    (id, owner_id, name, seed, starting_era, schema_version, model_version, year, population, era, revision, snapshot_key, previous_snapshot_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING`)
    .bind(world.id, ownerId, world.name, world.seed, world.era, world.schema, world.modelVersion,
      world.year, metrics.population, metrics.era, key, now, now).run());
  // D1 counts changes made by retention triggers too. Only zero proves no row was written.
  if (result.meta.changes === 0) {
    await storageCall(bucket.delete(key)).catch(() => {});
    await abandonKnownFailedWrite(key).catch(()=>{});
    throw new V05StorageError(409, 'world_exists', 'Этот мир уже есть в облаке. Откройте его облачную версию или сохраните отдельную копию.');
  }
  if (!(result.meta.changes > 0)) throw new Error('Cloud write receipt unavailable');
  await afterRetentionWrite(ownerId,'v05',world.id);
  return { id: world.id, revision: 1, updatedAt: now };
}

export async function readV05World(ownerId: string, id: string, ifNoneMatch?: string | null) {
  const row = await ownedWorld(ownerId, id);
  const etag = `"v05-${row.revision}"`;
  if (ifNoneMatch === etag) return { notModified: true as const, revision: row.revision, etag };
  const { bucket } = bindings();
  const object = await storageCall(bucket.get(row.snapshot_key));
  if (!object || object.size > MAX_V05_SNAPSHOT_BYTES) throw new V05StorageError(503, 'snapshot_unavailable', 'Не удалось прочитать снимок мира. Сохранение не изменено.');
  let world: V05World;
  try {
    world = parseV05Snapshot(await storageCall(object.text()));
    if (world.id !== row.id || world.year !== row.year || world.seed !== row.seed ||
        world.era !== row.starting_era || world.schema !== row.schema_version || world.modelVersion !== row.model_version) {
      throw new Error('Snapshot identity mismatch');
    }
  } catch {
    throw new V05StorageError(503, 'snapshot_unavailable', 'Не удалось прочитать снимок мира. Сохранение не изменено.');
  }
  return { world, revision: row.revision, updatedAt: row.updated_at, etag };
}

export async function updateV05World(ownerId: string, id: string, input: V05World, revision: number) {
  const world = validateV05World(structuredClone(input));
  const current = await ownedWorld(ownerId, id);
  assertV05Update(current, id, world, revision);
  const { db, bucket } = bindings();
  const content = v05SnapshotContent(world);
  const key = snapshotKey(ownerId, id);
  const now = new Date().toISOString();
  const metrics = v05WorldMetrics(world);
  await beginRetentionWrite(ownerId,'v05',world.id,key,new TextEncoder().encode(content).byteLength);
  await storageCall(bucket.put(key, content, { httpMetadata: { contentType: 'application/json; charset=utf-8' } }));
  const result = await storageCall(db.prepare(`UPDATE worlds_v05 SET name = ?, year = ?, population = ?, era = ?,
    revision = revision + 1, previous_snapshot_key = snapshot_key, snapshot_key = ?, updated_at = ?
    WHERE id = ? AND owner_id = ? AND revision = ?`)
    .bind(world.name, world.year, metrics.population, metrics.era, key, now, id, ownerId, revision).run());
  // D1 counts changes made by retention triggers too. Only zero proves no row was written.
  if (result.meta.changes === 0) {
    await storageCall(bucket.delete(key)).catch(() => {});
    await abandonKnownFailedWrite(key).catch(()=>{});
    throw new V05StorageError(409, 'revision_conflict', 'Мир изменён на другом устройстве. Облачная история не перезаписана.');
  }
  if (!(result.meta.changes > 0)) throw new Error('Cloud write receipt unavailable');
  await afterRetentionWrite(ownerId,'v05',world.id);
  return { id, revision: revision + 1, updatedAt: now };
}
