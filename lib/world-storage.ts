import {beginRetentionWrite,abandonKnownFailedWrite,afterRetentionWrite} from './retention-cloud';
import { env } from "cloudflare:workers";
import { getWorldStats, validateWorld, type World } from "@/lib/simulation";
import { decodeWorldCursor, encodeWorldCursor } from "@/lib/world-pagination";

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WorldSummary = {
  id: string;
  name: string;
  seed: string;
  year: number;
  population: number;
  era: string;
  revision: number;
  updatedAt: string;
  createdAt: string;
};

type WorldRow = {
  id: string;
  owner_id: string;
  name: string;
  seed: string;
  year: number;
  population: number;
  era: string;
  revision: number;
  snapshot_key: string;
  previous_snapshot_key: string | null;
  created_at: string;
  updated_at: string;
};

export class WorldStorageError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorldStorageError";
  }
}

export function storageResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie",
    },
  });
}

export function storageError(error: unknown): Response {
  if(error instanceof Error && error.name==='RetentionError' && 'status' in error && typeof error.status==='number' && 'code' in error)return storageResponse({error:error.message,code:String(error.code)},error.status);
  if (error instanceof WorldStorageError) {
    return storageResponse({ error: error.message, code: error.code }, error.status);
  }
  // Do not leak SQL, keys, stack traces or infrastructure details to a visitor.
  return storageResponse(
    {
      error: "Не удалось обратиться к сохранениям. Текущий мир остаётся на устройстве; повторите попытку.",
      code: "storage_unavailable",
    },
    503,
  );
}

function bindings() {
  if (!env.DB || !env.BUCKET) {
    throw new WorldStorageError(503, "storage_unavailable", "Облачные сохранения временно недоступны.");
  }
  return { db: env.DB, bucket: env.BUCKET };
}

function assertId(id: string): void {
  if (!UUID.test(id)) {
    throw new WorldStorageError(400, "invalid_world_id", "Неверный идентификатор мира.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bound the actual stream, not merely an untrusted Content-Length header. */
export async function readMutationBody(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin !== null && origin !== new URL(request.url).origin)
  ) {
    throw new WorldStorageError(403, "origin_mismatch", "Сохранение доступно только из этого сайта.");
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new WorldStorageError(415, "json_required", "Ожидается сохранение в формате JSON.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_SNAPSHOT_BYTES) {
    throw new WorldStorageError(413, "snapshot_too_large", "Сохранение превышает допустимый размер 4 МБ.");
  }
  if (!request.body) {
    throw new WorldStorageError(400, "invalid_json", "Не получены данные сохранения.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SNAPSHOT_BYTES) {
        await reader.cancel();
        throw new WorldStorageError(413, "snapshot_too_large", "Сохранение превышает допустимый размер 4 МБ.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new WorldStorageError(400, "invalid_json", "Не удалось прочитать данные сохранения.");
  }
  if (!isRecord(body)) {
    throw new WorldStorageError(400, "invalid_json", "Неверный формат сохранения.");
  }
  return body;
}

export function worldFromPayload(body: Record<string, unknown>): World {
  let valid = false;
  try {
    valid = validateWorld(body.world);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new WorldStorageError(400, "invalid_world", "Мир повреждён или создан несовместимой версией модели.");
  }
  const world = body.world as World;
  assertId(world.id);
  return world;
}

export function revisionFromPayload(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1 || (body.revision as number) > 2_000_000_000) {
    throw new WorldStorageError(400, "invalid_revision", "Не указана версия облачного сохранения.");
  }
  return body.revision as number;
}

function summary(row: WorldRow): WorldSummary {
  return {
    id: row.id,
    name: row.name,
    seed: row.seed,
    year: row.year,
    population: row.population,
    era: row.era,
    revision: row.revision,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function snapshotKey(ownerId: string, id: string): string {
  return `worlds/${encodeURIComponent(ownerId)}/${id}/${crypto.randomUUID()}.json`;
}

function snapshotContent(world: World): string {
  const content = JSON.stringify(world);
  if (new TextEncoder().encode(content).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new WorldStorageError(413, "snapshot_too_large", "Сохранение превышает допустимый размер 4 МБ.");
  }
  return content;
}

async function ownedWorld(ownerId: string, id: string): Promise<WorldRow> {
  assertId(id);
  const { db } = bindings();
  const row = await db.prepare("SELECT * FROM worlds WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId).first<WorldRow>();
  if (!row) throw new WorldStorageError(404, "world_not_found", "Сохранение не найдено.");
  return row;
}

export async function listWorlds(ownerId: string, cursor?: string | null): Promise<{ worlds: WorldSummary[]; hasMore: boolean; nextCursor: string | null }> {
  let position: ReturnType<typeof decodeWorldCursor> | null = null;
  if (cursor !== undefined && cursor !== null) {
    try { position = decodeWorldCursor(cursor); }
    catch { throw new WorldStorageError(400, "invalid_cursor", "Неверный указатель страницы архива. Откройте архив заново."); }
  }
  const { db } = bindings();
  // Every page remains owner-scoped. Cursor fields are bound values; callers
  // cannot supply a table, sort expression, limit, or SQL fragment.
  const query = position
    ? db.prepare("SELECT * FROM worlds WHERE owner_id = ? AND (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC, id ASC LIMIT 101")
      .bind(ownerId, position.updatedAt, position.updatedAt, position.id)
    : db.prepare("SELECT * FROM worlds WHERE owner_id = ? ORDER BY updated_at DESC, id ASC LIMIT 101")
      .bind(ownerId);
  const { results } = await query.all<WorldRow>();
  const page = results.slice(0, 100);
  const hasMore = results.length > 100;
  const last = page.at(-1);
  return {
    worlds: page.map(summary),
    hasMore,
    nextCursor: hasMore && last ? encodeWorldCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
}

export async function createSavedWorld(ownerId: string, world: World) {
  world=structuredClone(world);
  if(!validateWorld(world))throw new WorldStorageError(400,'invalid_world','Мир повреждён или создан несовместимой версией модели.');
  assertId(world.id);
  const { db, bucket } = bindings();
  const content = snapshotContent(world);
  const key = snapshotKey(ownerId, world.id);
  const now = new Date().toISOString();
  const stats = getWorldStats(world);
  await beginRetentionWrite(ownerId,'classic',world.id,key,new TextEncoder().encode(content).byteLength);
  await bucket.put(key, content, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  let result: D1Result;
  try {
    result = await db.prepare(`INSERT INTO worlds
      (id, owner_id, name, seed, year, population, era, revision, snapshot_key, previous_snapshot_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
      ON CONFLICT(id) DO NOTHING`)
      .bind(world.id, ownerId, world.name, world.seed, world.year, stats.population, stats.era, key, now, now).run();
  } catch (error) {
    // A lost D1 response can follow a committed transaction. Retain the unique
    // snapshot on an uncertain outcome so a committed pointer stays readable.
    throw error;
  }
  // D1 counts changes made by retention triggers too. Only zero proves no row was written.
  if (result.meta.changes === 0) {
    await bucket.delete(key).catch(() => {});
    await abandonKnownFailedWrite(key).catch(()=>{});
    throw new WorldStorageError(409, "world_exists", "Этот мир уже сохранён. Загрузите его облачную версию, чтобы продолжить.");
  }
  if (!(result.meta.changes > 0)) throw new Error('Cloud write receipt unavailable');
  await afterRetentionWrite(ownerId,'classic',world.id);
  return { id: world.id, revision: 1, updatedAt: now };
}

export async function readSavedWorld(ownerId: string, id: string) {
  const row = await ownedWorld(ownerId, id);
  const { bucket } = bindings();
  const object = await bucket.get(row.snapshot_key);
  if (!object || object.size > MAX_SNAPSHOT_BYTES) {
    throw new WorldStorageError(503, "snapshot_unavailable", "Не удалось прочитать снимок мира. Сохранение не изменено.");
  }
  let world: unknown;
  try {
    world = await object.json();
    if (!validateWorld(world) || world.id !== row.id || world.year !== row.year) throw new Error("invalid snapshot");
  } catch {
    throw new WorldStorageError(503, "snapshot_unavailable", "Не удалось прочитать снимок мира. Сохранение не изменено.");
  }
  return { world, revision: row.revision, updatedAt: row.updated_at };
}

export async function updateSavedWorld(ownerId: string, id: string, world: World, revision: number) {
  world=structuredClone(world);
  if(!validateWorld(world))throw new WorldStorageError(400,'invalid_world','Мир повреждён или создан несовместимой версией модели.');
  const current = await ownedWorld(ownerId, id);
  if (world.id !== id) {
    throw new WorldStorageError(400, "world_id_mismatch", "Идентификатор мира не совпадает с сохранением.");
  }
  if (current.revision !== revision) {
    throw new WorldStorageError(409, "revision_conflict", "Мир уже сохранён в другой вкладке или на другом устройстве. Загрузите новую версию перед продолжением.");
  }
  if (world.seed !== current.seed) {
    throw new WorldStorageError(400, "world_seed_mismatch", "Новый исходный код мира требует отдельного сохранения.");
  }
  if (world.year < current.year) {
    throw new WorldStorageError(409, "history_regression", "В облаке уже сохранена более поздняя история. Загрузите её или создайте отдельный мир.");
  }
  const { db, bucket } = bindings();
  const content = snapshotContent(world);
  const key = snapshotKey(ownerId, id);
  const now = new Date().toISOString();
  const stats = getWorldStats(world);
  await beginRetentionWrite(ownerId,'classic',world.id,key,new TextEncoder().encode(content).byteLength);
  await bucket.put(key, content, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  let result: D1Result;
  try {
    result = await db.prepare(`UPDATE worlds SET name = ?, year = ?, population = ?, era = ?,
      revision = revision + 1, previous_snapshot_key = snapshot_key, snapshot_key = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND revision = ?`)
      .bind(world.name, world.year, stats.population, stats.era, key, now, id, ownerId, revision).run();
  } catch (error) {
    // Keep this upload when the outcome is unknown: D1 may have committed even
    // when its response was interrupted.
    throw error;
  }
  // D1 counts changes made by retention triggers too. Only zero proves no row was written.
  if (result.meta.changes === 0) {
    await bucket.delete(key).catch(() => {});
    await abandonKnownFailedWrite(key).catch(()=>{});
    throw new WorldStorageError(409, "revision_conflict", "Мир уже сохранён в другой вкладке или на другом устройстве. Загрузите новую версию перед продолжением.");
  }
  // Previously committed snapshots remain intact, including the previous pointer.
  if (!(result.meta.changes > 0)) throw new Error('Cloud write receipt unavailable');
  await afterRetentionWrite(ownerId,'classic',world.id);
  return { id, revision: revision + 1, updatedAt: now };
}
