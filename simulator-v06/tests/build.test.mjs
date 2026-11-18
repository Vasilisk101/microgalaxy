import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createWorld, advance} from '../src/core.mjs';
import '../build.mjs';

test('0.6 production document and Worker have valid JavaScript syntax', async () => {
  const html = await readFile(new URL('../dist/MICROGALAXY-0.6.html', import.meta.url), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const worker = html.match(/<script id="worker-source" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source);
  assert.ok(worker);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotThrow(() => new vm.Script(JSON.parse(worker)));
  assert.match(html, /<title>MICROGALAXY[^<]*0\.6/);
  assert.ok(html.includes('data-view="diplomacy"'));
  assert.ok(html.includes('data-view="stories"'));
  assert.ok(html.includes('data-view="regions"'));
  assert.ok(source.includes('const Geography='));
  assert.ok(source.includes('const Archive='));
  assert.ok(JSON.parse(worker).includes('const Geography='));
  assert.ok(JSON.parse(worker).includes('const Archive='));
});

test('bundled 0.6 Worker executes geography and archive code identically to the source model', async () => {
  const html = await readFile(new URL('../dist/MICROGALAXY-0.6.html', import.meta.url), 'utf8');
  const worker = JSON.parse(html.match(/<script id="worker-source" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const messages = [];
  const context = vm.createContext({structuredClone, self: {postMessage: message => messages.push(JSON.parse(JSON.stringify(message)))}});
  new vm.Script(worker).runInContext(context);
  assert.deepEqual(messages.shift(), {ready:true});
  const input = createWorld('bundled-geography-05', {era:'industrial'});
  context.self.onmessage({data:{id:55, world:input, years:35, stopOnImportant:false}});
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 55);
  assert.ok(!messages[0].error, messages[0].error);
  assert.deepEqual(messages[0].result, JSON.parse(JSON.stringify(advance(input,35))));
});

test('0.6 is self-contained and connects only to its own protected cloud', async () => {
  const html = await readFile(new URL('../dist/MICROGALAXY-0.6.html', import.meta.url), 'utf8');
  assert.ok(html.includes("connect-src 'self'"));
  assert.equal((html.match(/<script[^>]+src=/g) ?? []).length, 0);
  assert.ok(html.includes('/api/v06/worlds'));
  assert.ok(html.includes('/api/world-catalog'));
  assert.ok(html.includes('/v04'));
  assert.ok(html.includes('/v03'));
  assert.ok(html.includes('/classic'));
  assert.ok(!html.includes('ЛОКАЛЬНЫЙ КАНДИДАТ'));
  assert.ok(!/OPENAI_API_KEY|api\.openai\.com|generativelanguage\.googleapis/.test(html));
});
