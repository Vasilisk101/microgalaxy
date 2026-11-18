import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import '../build.mjs';

test('0.4 production document and Worker have valid JavaScript syntax', async () => {
  const html = await readFile(new URL('../dist/MICROGALAXY-0.4.html', import.meta.url), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const worker = html.match(/<script id="worker-source" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source);
  assert.ok(worker);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotThrow(() => new vm.Script(JSON.parse(worker)));
  assert.match(html, /<title>MICROGALAXY[^<]*0\.4/);
  assert.ok(html.includes('data-view="diplomacy"'));
  assert.ok(html.includes('data-view="stories"'));
});

test('0.4 is self-contained and connects only to its own protected cloud', async () => {
  const html = await readFile(new URL('../dist/MICROGALAXY-0.4.html', import.meta.url), 'utf8');
  assert.ok(html.includes("connect-src 'self'"));
  assert.equal((html.match(/<script[^>]+src=/g) ?? []).length, 0);
  assert.ok(html.includes('/api/v04/worlds'));
  assert.ok(html.includes('/v03'));
  assert.ok(html.includes('/classic'));
  assert.ok(!html.includes('ЛОКАЛЬНЫЙ КАНДИДАТ'));
  assert.ok(!/OPENAI_API_KEY|api\.openai\.com|generativelanguage\.googleapis/.test(html));
});
