import assert from 'node:assert/strict';
import test from 'node:test';
import { worldApi } from '../lib/world-api.ts';

test('a stalled fetch cannot block local work indefinitely', async () => {
  const original = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  try {
    await assert.rejects(worldApi('/api/worlds', {}, 15), /не ответило вовремя/);
    assert.equal(signal?.aborted, true);
  } finally { globalThis.fetch = original; }
});

test('the deadline also bounds a stalled JSON response body', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({}))) as typeof fetch;
  try {
    await assert.rejects(worldApi('/api/worlds', {}, 15), /не ответило вовремя/);
  } finally { globalThis.fetch = original; }
});

test('HTTP conflicts keep their status and payload for explicit resolution', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ error: 'Конфликт версий' }, { status: 409 })) as typeof fetch;
  try {
    assert.deepEqual(await worldApi('/api/worlds'), { ok: false, status: 409, data: { error: 'Конфликт версий' } });
  } finally { globalThis.fetch = original; }
});
