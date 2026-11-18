import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../simulator-v04/src/core.mjs';
import { createWorld as createV03World } from '../simulator-v03/src/core.mjs';
import {
  assertV04Id, assertV04Update, decodeV04Cursor, encodeV04Cursor, MAX_V04_SNAPSHOT_BYTES,
  readV04MutationBody, validateV04World, v04Error, v04RevisionFromPayload, v04WorldFromPayload,
  v04WorldMetrics, type V04Identity,
} from '../lib/world-v04-contract.ts';

const id = 'local-11111111-1111-4111-8111-111111111111';
const world = () => validateV04World({ ...createWorld('API-CONTRACT'), id });
const request = (body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request('https://microgalaxy.example/api/v04/worlds', {
    method: 'POST', body, headers: { 'content-type': 'application/json', ...headers },
    ...(typeof body === 'string' ? {} : { duplex: 'half' }),
  } as RequestInit);

test('v04 validates the complete candidate format, not the legacy model or arbitrary payloads', () => {
  const valid = world();
  assert.equal(v04WorldFromPayload({ world: valid }), valid);
  assert.ok(v04WorldMetrics(valid).population > 0);
  assert.equal(typeof v04WorldMetrics(valid).era, 'string');
  for (const bad of [null, {}, { ...valid, modelVersion: 'future' }, { ...valid, schemaVersion: 1 },
    { ...valid, seed: '' }, { ...valid, name: '\u0000' }, { ...valid, year: -1 },
    { ...valid, extra: 'unbounded user field' }, { ...valid, regions: [] }, { ...valid, planets: [] }]) {
    assert.throws(() => validateV04World(bad), { code: 'invalid_world', status: 400 });
  }
  const invalid = structuredClone(valid);
  (invalid.regions as { owner: string }[])[0].owner = 'missing';
  assert.throws(() => validateV04World(invalid), { code: 'invalid_world' });
  assert.throws(() => v04WorldFromPayload({ world: valid, owner: 'someone-else' }), { code: 'invalid_payload' });
  assert.throws(() => validateV04World({ ...createV03World('DO-NOT-MIGRATE'), id }), { code: 'invalid_world', status: 400 });
});

test('v04 IDs are bounded UUIDs, including the candidate local-UUID prefix', () => {
  for (const valid of [id, id.slice(6), '22222222-2222-8222-8222-222222222222']) assert.doesNotThrow(() => assertV04Id(valid));
  for (const bad of ['', '../secret', 'w-aabbccdd', `${id}/other`, 'x'.repeat(512), null, 'local-local-' + id.slice(6)]) {
    assert.throws(() => assertV04Id(bad), { code: 'invalid_world_id' });
  }
});

test('v04 revisions and identity guard forbid in-place changes or history regression', () => {
  const w = world();
  const current: V04Identity = { id, seed: w.seed, starting_era: w.era, schema_version: w.schema, model_version: w.modelVersion, year: 0, revision: 4 };
  assert.doesNotThrow(() => assertV04Update(current, id, w, 4));
  assert.throws(() => assertV04Update(current, id, w, 3), { status: 409, code: 'revision_conflict' });
  assert.throws(() => assertV04Update({ ...current, year: 10 }, id, w, 4), { status: 409, code: 'history_regression' });
  for (const changed of [{ ...w, seed: 'other' }, { ...w, era: 'space' as const }, { ...w, schema: 'other' }, { ...w, modelVersion: 'other' }]) {
    assert.throws(() => assertV04Update(current, id, changed, 4), { code: 'world_identity_mismatch' });
  }
  assert.throws(() => assertV04Update(current, id, { ...w, id: id.slice(6) }, 4), { code: 'world_id_mismatch' });
  for (const revision of [undefined, 0, -1, 1.5, NaN, Infinity, 2_000_000_001, '1']) {
    assert.throws(() => v04RevisionFromPayload({ revision }), { code: 'invalid_revision' });
  }
  assert.equal(v04RevisionFromPayload({ revision: 1 }), 1);
});

test('v04 cursor round-trips local UUIDs and rejects malformed or foreign-version cursors', () => {
  const point = { id, updatedAt: '2026-11-16T10:00:00.000Z' };
  const token = encodeV04Cursor(point);
  assert.deepEqual(decodeV04Cursor(token), point);
  const raw = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  for (const bad of ['', token + '=', 'A'.repeat(385), '!', raw({ v: 1, ...point }), raw({ v: 3, ...point }), raw({ v: 4, ...point, extra: true }),
    raw({ v: 4, ...point, updatedAt: '2026-02-30T10:00:00.000Z' }), raw({ v: 4, ...point, id: '../' }), raw(null)]) {
    assert.throws(() => decodeV04Cursor(bad), { code: 'invalid_cursor', status: 400 });
  }
});

test('v04 request parser accepts streamed UTF-8 JSON and rejects origin/content-type violations', async () => {
  const text = JSON.stringify({ world: world() });
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const chunks = new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.length) return controller.close();
    controller.enqueue(bytes.slice(offset, offset + 137)); offset += 137;
  } });
  assert.deepEqual(await readV04MutationBody(request(chunks, { origin: 'https://microgalaxy.example' })), JSON.parse(text));
  for (const headers of [{ origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
    await assert.rejects(readV04MutationBody(request(text, headers)), { code: 'origin_mismatch', status: 403 });
  }
  await assert.rejects(readV04MutationBody(request(text, { 'content-type': 'text/plain' })), { code: 'json_required', status: 415 });
});

test('v04 request parser bounds actual bytes even with a forged Content-Length', async () => {
  await assert.rejects(readV04MutationBody(request('{}', { 'content-length': String(MAX_V04_SNAPSHOT_BYTES + 1) })), { status: 413 });
  await assert.rejects(readV04MutationBody(request('{}', { 'content-length': '-1' })), { code: 'invalid_content_length' });
  let blocks = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    blocks++;
    controller.enqueue(new Uint8Array(1024 * 1024));
  }, cancel() { cancelled = true; } });
  await assert.rejects(readV04MutationBody(request(stream, { 'content-length': '1' })), { status: 413, code: 'snapshot_too_large' });
  assert.equal(cancelled, true);
  assert.ok(blocks <= 26);
});

test('v04 stalled streams time out; malformed UTF-8, special keys and non-objects are rejected', async () => {
  const stalled = new ReadableStream<Uint8Array>({ start() {} });
  await assert.rejects(readV04MutationBody(request(stalled), 10), { status: 408, code: 'request_timeout' });
  for (const bad of ['', 'null', '[]', '{', '{"world":{"__proto__":{"polluted":true}}}', '{"constructor":{}}']) {
    await assert.rejects(readV04MutationBody(request(bad)), { status: 400, code: 'invalid_json' });
  }
  const invalid = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([0xc3, 0x28])); controller.close(); } });
  await assert.rejects(readV04MutationBody(request(invalid)), { code: 'invalid_json' });
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('v04 unexpected failures never expose database, object-storage or stack details', async () => {
  const response = v04Error(new Error('SELECT secret SQL; worlds-v04/private-owner/key'));
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /SELECT|secret|private-owner|stack/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
