import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as previous from '../../simulator-v04/src/core.mjs';
import * as current from '../src/core.mjs';
import * as previousStorage from '../../simulator-v04/src/storage.mjs';
import * as currentStorage from '../src/storage.mjs';

test('released annual engines are unchanged; 0.3/0.4 save infrastructure uses the approved retention baseline', async () => {
  const preserved = {
    '../../simulator-v04/src/core.mjs': '7bb6eeae53bc6d8d74cb10119316e383219171acfe493c00d0c6e5c551d982d2',
    '../../simulator-v04/src/storage.mjs': 'e618bbe5619e9329df0d79a20e1277d087bbc245f42bdc82a0f7dc05f733bf61',
    '../../simulator-v04/src/cloud.mjs': '1abafd00baaf6cbba24e53d7f3d7e3ba9ad3b4014f75eb902788ca8cdffdf8dd',
    '../../simulator-v03/src/core.mjs': '25c19557dd57eebf03134c796eeccdd1f3fe651060ae45c4f839a112623946fd',
    '../../simulator-v03/src/storage.mjs': '58cdd8a7b348f393966e8a5459a06642e205703de1a475d89ae21b6067f8bb1c',
    '../../simulator-v03/src/cloud.mjs': 'b2bcca5dafc79243ab02feb411718224395fc3c1758b0ef8575378f223108cbc',
    '../../lib/simulation.ts': '43315261286638a92e196ed65d0c67b1065d7e1f8a08e23f3c1cadd3e015307c',
  };
  for (const [path, hash] of Object.entries(preserved)) {
    const actual = createHash('sha256').update((await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')).digest('hex');
    assert.equal(actual, hash, path);
  }
});

test('0.4 saves resume the same history after the 0.5 release', async () => {
  const original = previous.createWorld('preserve-04-history', {era:'industrial'});
  const saved = await previousStorage.decodeSave(await previousStorage.encodeSave(previous.advance(original, 37).world));
  assert.deepEqual(previous.advance(saved, 63).world, previous.advance(original, 100).world);
});

test('0.4 and 0.5 reject each other instead of silently converting historical worlds', async () => {
  const old = previous.createWorld('separate-geography');
  const fresh = current.createWorld('separate-geography');
  assert.notEqual(old.schema, fresh.schema);
  assert.notEqual(old.modelVersion, fresh.modelVersion);
  assert.throws(() => current.validateWorld(old));
  assert.throws(() => previous.validateWorld(fresh));
  await assert.rejects(async () => currentStorage.decodeSave(await previousStorage.encodeSave(old)));
  await assert.rejects(async () => previousStorage.decodeSave(await currentStorage.encodeSave(fresh)));
});

test('0.5 uses its own route, local database, cloud endpoint and build artifact', async () => {
  const text = p => readFile(new URL(p, import.meta.url), 'utf8');
  assert.ok((await text('../../app/route.ts')).includes('simulator-v05/dist/MICROGALAXY-0.5.html'));
  assert.ok((await text('../../app/v04/route.ts')).includes('simulator-v04/dist/MICROGALAXY-0.4.html'));
  assert.ok((await text('../../app/v03/route.ts')).includes('simulator-v03/dist/MICROGALAXY-0.3.html'));
  assert.ok((await text('../../lib/world-models.mjs')).includes('microgalaxy_geography_v05_v1'));
  assert.ok((await text('../src/cloud.mjs')).includes('/api/v05/worlds'));
  assert.ok((await text('../../lib/world-models.mjs')).includes('microgalaxy_history_v04_v1'));
  const api = await text('../../app/api/v05/worlds/route.ts');
  assert.ok(api.includes('getChatGPTUser'));
  assert.ok(!api.includes('world-v04'));
});
