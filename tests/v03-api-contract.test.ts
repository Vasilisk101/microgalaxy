import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../simulator-v03/src/core.mjs';
import {
  assertV03Id, assertV03Update, decodeV03Cursor, encodeV03Cursor, MAX_V03_SNAPSHOT_BYTES,
  readV03MutationBody, validateV03World, v03Error, v03RevisionFromPayload, v03WorldFromPayload,
  v03WorldMetrics, type V03Identity,
} from '../lib/world-v03-contract.ts';

const id = 'local-11111111-1111-4111-8111-111111111111';
const world = () => validateV03World({ ...createWorld('API-CONTRACT'), id });
const request = (body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request('https://microgalaxy.example/api/v03/worlds', {
    method: 'POST', body, headers: { 'content-type': 'application/json', ...headers },
    ...(typeof body === 'string' ? {} : { duplex: 'half' }),
  } as RequestInit);

test('v03 validates the complete candidate format, not the legacy model or arbitrary payloads', () => {
  const valid = world();
  assert.equal(v03WorldFromPayload({ world: valid }), valid);
  assert.ok(v03WorldMetrics(valid).population > 0);
  assert.equal(typeof v03WorldMetrics(valid).era, 'string');
  for (const bad of [null, {}, { ...valid, modelVersion: 'future' }, { ...valid, schemaVersion: 1 },
    { ...valid, seed: '' }, { ...valid, name: '\u0000' }, { ...valid, year: -1 },
    { ...valid, extra: 'unbounded user field' }, { ...valid, regions: [] }, { ...valid, planets: [] }]) {
    assert.throws(() => validateV03World(bad), { code: 'invalid_world', status: 400 });
  }
  const invalid = structuredClone(valid);
  (invalid.regions as { owner: string }[])[0].owner = 'missing';
  assert.throws(() => validateV03World(invalid), { code: 'invalid_world' });
  assert.throws(() => v03WorldFromPayload({ world: valid, owner: 'someone-else' }), { code: 'invalid_payload' });
});

test('v03 IDs are bounded UUIDs, including the candidate local-UUID prefix', () => {
  for (const valid of [id, id.slice(6), '22222222-2222-8222-8222-222222222222']) assert.doesNotThrow(() => assertV03Id(valid));
  for (const bad of ['', '../secret', 'w-aabbccdd', `${id}/other`, 'x'.repeat(512), null, 'local-local-' + id.slice(6)]) {
    assert.throws(() => assertV03Id(bad), { code: 'invalid_world_id' });
  }
});

test('v03 revisions and identity guard forbid in-place changes or history regression', () => {
  const w = world();
  const current: V03Identity = { id, seed: w.seed, starting_era: w.era, schema_version: w.schema, model_version: w.modelVersion, year: 0, revision: 4 };
  assert.doesNotThrow(() => assertV03Update(current, id, w, 4));
  assert.throws(() => assertV03Update(current, id, w, 3), { status: 409, code: 'revision_conflict' });
  assert.throws(() => assertV03Update({ ...current, year: 10 }, id, w, 4), { status: 409, code: 'history_regression' });
  for (const changed of [{ ...w, seed: 'other' }, { ...w, era: 'space' as const }, { ...w, schema: 'other' }, { ...w, modelVersion: 'other' }]) {
    assert.throws(() => assertV03Update(current, id, changed, 4), { code: 'world_identity_mismatch' });
  }
  assert.throws(() => assertV03Update(current, id, { ...w, id: id.slice(6) }, 4), { code: 'world_id_mismatch' });
  for (const revision of [undefined, 0, -1, 1.5, NaN, Infinity, 2_000_000_001, '1']) {
    assert.throws(() => v03RevisionFromPayload({ revision }), { code: 'invalid_revision' });
  }
  assert.equal(v03RevisionFromPayload({ revision: 1 }), 1);
});

test('v03 cursor round-trips local UUIDs and rejects malformed or foreign-version cursors', () => {
  const point = { id, updatedAt: '2026-11-16T10:00:00.000Z' };
  const token = encodeV03Cursor(point);
  assert.deepEqual(decodeV03Cursor(token), point);
  const raw = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  for (const bad of ['', token + '=', 'A'.repeat(385), '!', raw({ v: 1, ...point }), raw({ v: 3, ...point, extra: true }),
    raw({ v: 3, ...point, updatedAt: '2026-02-30T10:00:00.000Z' }), raw({ v: 3, ...point, id: '../' }), raw(null)]) {
    assert.throws(() => decodeV03Cursor(bad), { code: 'invalid_cursor', status: 400 });
  }
});

test('v03 request parser accepts streamed UTF-8 JSON and rejects origin/content-type violations', async () => {
  const text = JSON.stringify({ world: world() });
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const chunks = new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.length) return controller.close();
    controller.enqueue(bytes.slice(offset, offset + 137)); offset += 137;
  } });
  assert.deepEqual(await readV03MutationBody(request(chunks, { origin: 'https://microgalaxy.example' })), JSON.parse(text));
  for (const headers of [{ origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }] as Record<string, string>[]) {
    await assert.rejects(readV03MutationBody(request(text, headers)), { code: 'origin_mismatch', status: 403 });
  }
  await assert.rejects(readV03MutationBody(request(text, { 'content-type': 'text/plain' })), { code: 'json_required', status: 415 });
});

test('v03 request parser bounds actual bytes even with a forged Content-Length', async () => {
  await assert.rejects(readV03MutationBody(request('{}', { 'content-length': String(MAX_V03_SNAPSHOT_BYTES + 1) })), { status: 413 });
  await assert.rejects(readV03MutationBody(request('{}', { 'content-length': '-1' })), { code: 'invalid_content_length' });
  let blocks = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    blocks++;
    controller.enqueue(new Uint8Array(1024 * 1024));
  }, cancel() { cancelled = true; } });
  await assert.rejects(readV03MutationBody(request(stream, { 'content-length': '1' })), { status: 413, code: 'snapshot_too_large' });
  assert.equal(cancelled, true);
  assert.ok(blocks <= 26);
});

test('v03 stalled streams time out; malformed UTF-8, special keys and non-objects are rejected', async () => {
  const stalled = new ReadableStream<Uint8Array>({ start() {} });
  await assert.rejects(readV03MutationBody(request(stalled), 10), { status: 408, code: 'request_timeout' });
  for (const bad of ['', 'null', '[]', '{', '{"world":{"__proto__":{"polluted":true}}}', '{"constructor":{}}']) {
    await assert.rejects(readV03MutationBody(request(bad)), { status: 400, code: 'invalid_json' });
  }
  const invalid = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Uint8Array.from([0xc3, 0x28])); controller.close(); } });
  await assert.rejects(readV03MutationBody(request(invalid)), { code: 'invalid_json' });
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('v03 unexpected failures never expose database, object-storage or stack details', async () => {
  const response = v03Error(new Error('SELECT secret SQL; worlds-v03/private-owner/key'));
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.doesNotMatch(text, /SELECT|secret|private-owner|stack/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
