import { epoch, MODEL_VERSION, SCHEMA, summary, validateWorld } from '../simulator-v06/src/core.mjs';

/** This API is intentionally separate from the 0.1/0.2, 0.3 and 0.4 archives. */
export const MAX_V06_SNAPSHOT_BYTES = 24 * 1024 * 1024;
export const V06_PAGE_SIZE = 100;
const ID = /^(?:local-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORLD_KEYS = new Set([
  'schema', 'modelVersion', 'id', 'seed', 'era', 'name', 'year', 'nextEvent', 'nextEntity',
  'star', 'planets', 'regions', 'societies', 'relations', 'wars', 'missions', 'colonies',
  'events', 'history', 'snapshots', 'climate', 'ledger', 'archivalCoverage',
  'geography', 'eventArchive', 'missionArchive', 'economy',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type V06World = Record<string, unknown> & {
  schema: string;
  modelVersion: string;
  id: string;
  name: string;
  seed: string;
  era: 'agriculture' | 'industrial' | 'space';
  year: number;
};
export type V06Cursor = { updatedAt: string; id: string };
export type V06Identity = {
  id: string;
  seed: string;
  starting_era: string;
  schema_version: string;
  model_version: string;
  year: number;
  revision: number;
};

export class V06StorageError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'V06StorageError';
    this.status = status;
    this.code = code;
  }
}

export function v06Response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Cookie',
    },
  });
}

export function v06Error(error: unknown): Response {
  if(error instanceof Error && error.name==='RetentionError' && 'status' in error && typeof error.status==='number' && 'code' in error)return v06Response({error:error.message,code:String(error.code)},error.status);
  if (error instanceof V06StorageError) return v06Response({ error: error.message, code: error.code }, error.status);
  return v06Response({
    error: 'Облачное сохранение временно недоступно. Локальная история не изменена; повторите попытку.',
    code: 'storage_unavailable',
  }, 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertV06Id(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !ID.test(id)) {
    throw new V06StorageError(400, 'invalid_world_id', 'Неверный идентификатор мира 0.6.');
  }
}

function safeText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}

/** Validate the complete snapshot, including all historical checkpoints. Never migrate here. */
export function validateV06World(value: unknown): V06World {
  try {
    if (!isRecord(value) || Object.keys(value).some(key => !WORLD_KEYS.has(key)) ||
        !safeText(value.seed, 128) || !safeText(value.name, 128) ||
        value.schema !== SCHEMA || value.modelVersion !== MODEL_VERSION) throw new Error('format');
    // The candidate validator throws on failure; its return value is not a type predicate.
    validateWorld(value);
  } catch {
    throw new V06StorageError(400, 'invalid_world', 'Мир повреждён или создан несовместимой версией модели. Миры 0.1–0.5 открываются в своих версиях без преобразования.');
  }
  assertV06Id(value.id);
  return value as V06World;
}

export function v06WorldFromPayload(body: Record<string, unknown>): V06World {
  if (Object.keys(body).some(key => key !== 'world' && key !== 'revision')) {
    throw new V06StorageError(400, 'invalid_payload', 'Неверный формат запроса сохранения.');
  }
  return validateV06World(body.world);
}

export function v06RevisionFromPayload(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1 || (body.revision as number) > 2_000_000_000) {
    throw new V06StorageError(400, 'invalid_revision', 'Не указана версия облачного сохранения.');
  }
  return body.revision as number;
}

export function assertV06Update(current: V06Identity, id: string, world: V06World, revision: number): void {
  assertV06Id(id);
  if (id !== world.id || id !== current.id) throw new V06StorageError(400, 'world_id_mismatch', 'Идентификатор мира не совпадает с сохранением.');
  if (revision !== current.revision) throw new V06StorageError(409, 'revision_conflict', 'Мир изменён на другом устройстве. Облачная история не перезаписана. Откройте её или сохраните отдельную копию.');
  if (world.seed !== current.seed || world.era !== current.starting_era ||
      world.schema !== current.schema_version || world.modelVersion !== current.model_version) {
    throw new V06StorageError(400, 'world_identity_mismatch', 'Код мира, начальная эпоха и версия модели требуют отдельного сохранения.');
  }
  if (world.year < current.year) throw new V06StorageError(409, 'history_regression', 'В облаке уже есть более поздняя история. Откройте её или сохраните текущую отдельным миром.');
  if (current.revision >= 2_000_000_000) throw new V06StorageError(409, 'revision_limit', 'Лимит версий достигнут. Продолжите историю отдельным миром.');
}

export function v06WorldMetrics(world: V06World): { population: number; era: string } {
  const state = summary(world);
  const societies = world.societies as { population: number; tech: number[]; satellite: boolean }[];
  const largest = societies.reduce<(typeof societies)[number] | null>((best, society) =>
    society.population > (best?.population ?? 0) ? society : best, null);
  return { population: state.population, era: largest ? epoch(largest) : state.population > 0 ? 'Внеземные поселения' : 'История завершена' };
}

function parseJson(text: string): unknown {
  return JSON.parse(text, (key, value: unknown) => {
    if (FORBIDDEN_KEYS.has(key)) throw new Error('Forbidden property');
    return value;
  });
}

export function v06SnapshotContent(world: V06World): string {
  const content = JSON.stringify(world);
  if (new TextEncoder().encode(content).byteLength > MAX_V06_SNAPSHOT_BYTES) {
    throw new V06StorageError(413, 'snapshot_too_large', 'Сохранение превышает допустимый размер 24 МБ.');
  }
  return content;
}

export function parseV06Snapshot(content: string): V06World {
  if (new TextEncoder().encode(content).byteLength > MAX_V06_SNAPSHOT_BYTES) throw new Error('Snapshot too large');
  return validateV06World(parseJson(content));
}

/** Bound the actual upload stream, including a missing or forged Content-Length. */
export async function readV06MutationBody(request: Request, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin !== null && origin !== new URL(request.url).origin)) {
    throw new V06StorageError(403, 'origin_mismatch', 'Сохранение доступно только из этого сайта.');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new V06StorageError(415, 'json_required', 'Ожидается сохранение в формате JSON.');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new V06StorageError(400, 'invalid_content_length', 'Неверный размер запроса.');
  }
  if (Number(declared ?? 0) > MAX_V06_SNAPSHOT_BYTES) throw new V06StorageError(413, 'snapshot_too_large', 'Сохранение превышает допустимый размер 24 МБ.');
  if (!request.body) throw new V06StorageError(400, 'invalid_json', 'Не получены данные сохранения.');

  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
      reject(new V06StorageError(408, 'request_timeout', 'Передача сохранения не завершилась вовремя. Локальная история сохранена.'));
    }, timeoutMs);
  });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const fragments: string[] = [];
    let pending: string[] = [];
    let pendingBytes = 0;
    let bytes = 0;
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (timedOut) throw new V06StorageError(408, 'request_timeout', 'Передача сохранения не завершилась вовремя.');
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_V06_SNAPSHOT_BYTES) {
        void reader.cancel().catch(() => {});
        throw new V06StorageError(413, 'snapshot_too_large', 'Сохранение превышает допустимый размер 24 МБ.');
      }
      pending.push(decoder.decode(part.value, { stream: true }));
      pendingBytes += part.value.byteLength;
      // Bound per-chunk bookkeeping even if a peer sends tiny chunks.
      if (pendingBytes >= 64 * 1024 || pending.length >= 256) {
        fragments.push(pending.join(''));
        pending = [];
        pendingBytes = 0;
      }
    }
    pending.push(decoder.decode());
    fragments.push(pending.join(''));
    const body = parseJson(fragments.join(''));
    if (!isRecord(body)) throw new Error('Expected object');
    return body;
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof V06StorageError) throw error;
    throw new V06StorageError(400, 'invalid_json', 'Не удалось прочитать данные сохранения.');
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export function encodeV06Cursor(cursor: V06Cursor): string {
  return btoa(JSON.stringify({ v: 5, ...cursor })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeV06Cursor(value: string): V06Cursor {
  try {
    if (!value || value.length > 384 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('token');
    const parsed: unknown = parseJson(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (!isRecord(parsed) || Object.keys(parsed).length !== 3 || parsed.v !== 5 ||
        typeof parsed.updatedAt !== 'string' || parsed.updatedAt.length !== 24 ||
        new Date(parsed.updatedAt).toISOString() !== parsed.updatedAt) throw new Error('cursor');
    assertV06Id(parsed.id);
    return { id: parsed.id, updatedAt: parsed.updatedAt };
  } catch {
    throw new V06StorageError(400, 'invalid_cursor', 'Неверный указатель страницы архива. Откройте архив заново.');
  }
}
