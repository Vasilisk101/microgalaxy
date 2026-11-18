import { env } from 'cloudflare:workers';

import { WORLD_MODELS } from './world-models.mjs';

export type CatalogModel = keyof typeof WORLD_MODELS;
export type CatalogCursor = { updatedAt: string; model: CatalogModel; id: string };
const MODELS = WORLD_MODELS;
const ID = /^(?:local-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 100;

export class CatalogError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.name = 'CatalogError'; this.status = status; this.code = code;
  }
}

export function catalogResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie',
  } });
}

export function catalogError(error: unknown): Response {
  if (error instanceof CatalogError) return catalogResponse({ error: error.message, code: error.code }, error.status);
  console.warn('world-catalog', {stage:'request', category:'unexpected'});
  return catalogResponse({
    error: 'Общий облачный архив временно недоступен. Миры на устройстве остаются доступны; повторите загрузку.',
    code: 'catalog_unavailable',
  }, 503);
}

const isModel = (value: unknown): value is CatalogModel => typeof value === 'string' && Object.hasOwn(MODELS, value);
const isTime = (value: unknown): value is string => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function encodeCatalogCursor(position: CatalogCursor): string {
  return btoa(JSON.stringify({ v: 5, kind: 'world-catalog', ...position })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCatalogCursor(value: string): CatalogCursor {
  try {
    if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('token');
    const parsed = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length !== 5 ||
        (parsed.v !== 5 && parsed.v !== 6) || parsed.kind !== 'world-catalog' || !isTime(parsed.updatedAt) || !isModel(parsed.model) ||
        typeof parsed.id !== 'string' || !(parsed.v === 5 ? ID.test(parsed.id) : /^[A-Za-z0-9~-]{1,128}$/.test(parsed.id))) throw new Error('cursor');
    return { updatedAt: parsed.updatedAt, model: parsed.model, id: parsed.id };
  } catch {
    throw new CatalogError(400, 'invalid_cursor', 'Неверный указатель страницы общего архива. Откройте архив заново.');
  }
}


type CatalogRow = {
  id: string; name: string; seed: string; year: number; population: number; era: string; revision: number;
  created_at: string; updated_at: string; model_version: string; starting_era: string | null;
  sort_time: string; sort_id: string;
};

function storedTime(value: string) {
  // Some older SQLite records use UTC at second precision.
  if (typeof value !== 'string') return null;
  if (value.length === 24) return isTime(value) ? value : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}Z?$/.test(value)) return null;
  const iso = value.replace(' ', 'T').replace(/Z$/, '') + '.000Z';
  return isTime(iso) ? iso : null;
}

function publicRow(model: CatalogModel, row: CatalogRow) {
  const updatedAt = storedTime(row.updated_at), createdAt = storedTime(row.created_at);
  if (!ID.test(row.id) || !updatedAt || !createdAt || !Number.isSafeInteger(row.year) || row.year < 0 ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.name !== 'string' || typeof row.seed !== 'string') return null;
  return {
    key: `${model}:${row.id}`, model, modelVersion: row.model_version, versionLabel: MODELS[model].versionLabel,
    source: 'cloud', id: row.id, name: row.name, seed: row.seed, year: row.year, population: row.population,
    era: row.era, startingEra: row.starting_era, revision: row.revision, createdAt, updatedAt,
    openPath: `${MODELS[model].path}?world=${encodeURIComponent(row.id)}&source=cloud`,
  };
}

// All ordering keys are bounded ASCII. A malformed saved ID or timestamp can be skipped even at a page boundary.
const sortTime = "COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at),'0001-01-01T00:00:00.000Z')";
const sortId = "CASE WHEN length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^a-zA-Z0-9-]*' THEN id ELSE '~' || rowid END";
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

async function readModel(db: D1Database, owner: string, model: CatalogModel, position: CatalogCursor | null) {
  const versionColumns = model === 'classic' ? "'0.1.0' AS model_version, NULL AS starting_era" : 'model_version, starting_era';
  const condition = position ? 'WHERE sort_time < ? OR (sort_time = ? AND (? > ? OR (? = ? AND sort_id > ?)))' : '';
  const sql = `WITH owned AS (
    SELECT id,name,seed,year,population,era,revision,created_at,updated_at,${versionColumns},
           ${sortTime} AS sort_time,${sortId} AS sort_id FROM ${MODELS[model].table} WHERE owner_id = ?
  ) SELECT * FROM owned ${condition} ORDER BY sort_time DESC, sort_id ASC LIMIT 101`;
  const stmt = db.prepare(sql);
  const query = position ? stmt.bind(owner, position.updatedAt, position.updatedAt, model, position.model, model, position.model, position.id) : stmt.bind(owner);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      query.all<CatalogRow>(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('catalog_timeout')), 5000); }),
    ]);
    return data.results.map(row => ({model, row}));
  } finally { clearTimeout(timer); }
}

export async function listWorldCatalog(ownerId: string, cursor?: string | null) {
  const position = cursor == null ? null : decodeCatalogCursor(cursor);
  const db = env.DB;
  if (!db) {
    console.warn('world-catalog', {stage:'database', category:'binding_missing'});
    throw new CatalogError(503, 'catalog_unavailable', 'Общий облачный архив временно недоступен.');
  }
  const models = Object.keys(MODELS) as CatalogModel[];
  const results = await Promise.allSettled(models.map(model => readModel(db, ownerId, model, position)));
  const unavailableModels: CatalogModel[] = [];
  const rows = results.flatMap((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const model = models[i];
    unavailableModels.push(model);
    console.warn('world-catalog', {stage:'model_read', category:result.reason?.message === 'catalog_timeout' ? 'timeout' : 'query_failed', model});
    return [];
  });
  if (unavailableModels.length === models.length) throw new CatalogError(503, 'catalog_unavailable', 'Облачный каталог сейчас недоступен. Повторите загрузку.');
  rows.sort((a,b) => order(b.row.sort_time,a.row.sort_time) || order(a.model,b.model) || order(a.row.sort_id,b.row.sort_id));
  const page = rows.slice(0, PAGE_SIZE), hasMore = rows.length > PAGE_SIZE;
  const worlds = page.flatMap(({model,row}) => { const world = publicRow(model,row); return world ? [world] : []; });
  const skippedRows = page.length - worlds.length;
  if (skippedRows) console.warn('world-catalog', {stage:'metadata', category:'invalid_row', count:skippedRows});
  const last = page.at(-1);
  let nextCursor: string | null = null;
  if (hasMore && last) {
    const point = {model:last.model, updatedAt:last.row.sort_time, id:last.row.sort_id};
    nextCursor = ID.test(point.id) ? encodeCatalogCursor(point) :
      btoa(JSON.stringify({v:6,kind:'world-catalog',...point})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  return {worlds, hasMore, source:'cloud', nextCursor,
    ...(unavailableModels.length || skippedRows ? {partial:true, unavailableModels, skippedRows} : {})};
}
