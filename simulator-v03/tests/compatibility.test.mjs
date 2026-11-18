import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld as createClassic, advanceWorld, validateWorld as validateClassic } from '../../lib/simulation.ts';
import { createWorld, advance, validateWorld } from '../src/core.mjs';
import { encodeSave, decodeSave } from '../src/storage.mjs';

test('Обновление сохраняет прежнее ядро и точное продолжение миров 0.1–0.2', () => {
  const original = createClassic('compatibility-regression', { id: 'd503424f-8ec7-4e47-a640-7b95b9c8b10' });
  assert.equal(original.engineVersion, '0.1.0');
  assert.equal(original.schemaVersion, 1);
  const saved = JSON.parse(JSON.stringify(advanceWorld(original, 125)));
  assert.ok(validateClassic(saved));
  assert.deepEqual(advanceWorld(saved, 125), advanceWorld(original, 250));
});

test('Разные модели не могут молча подменить друг друга при импорте', async () => {
  const classic = createClassic('previous-world');
  const modern = createWorld('new-world');
  assert.equal(validateClassic(modern), false);
  assert.throws(() => validateWorld(classic));
  await assert.rejects(() => decodeSave(JSON.stringify(classic)));
  const restored = await decodeSave(await encodeSave(modern));
  assert.deepEqual(advance(restored, 20).world, advance(modern, 20).world);
});

test('Прежние локальные и облачные пространства имён сохранены', async () => {
  const oldStore = await readFile(new URL('../../lib/world-models.mjs', import.meta.url), 'utf8');
  const newStore = await readFile(new URL('../src/storage.mjs', import.meta.url), 'utf8');
  const classicPage = await readFile(new URL('../../app/classic/page.tsx', import.meta.url), 'utf8');
  const oldApi = await readFile(new URL('../../app/api/worlds/route.ts', import.meta.url), 'utf8');
  assert.ok(oldStore.includes('microgalaxy-observatory-v1'));
  assert.ok(oldStore.includes('microgalaxy_local_candidate_v1'));
  assert.ok(newStore.includes("openRetentionDatabase('v03'"));
  assert.ok(!newStore.includes('microgalaxy-observatory-v1'));
  assert.ok(classicPage.includes('../simulation-app'));
  assert.ok(oldApi.includes('getChatGPTUser'));
});
