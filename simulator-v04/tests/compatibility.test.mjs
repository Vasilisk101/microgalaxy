import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as previous from '../../simulator-v03/src/core.mjs';
import * as current from '../src/core.mjs';
import * as previousStorage from '../../simulator-v03/src/storage.mjs';
import * as currentStorage from '../src/storage.mjs';

test('0.3 annual engine is unchanged; save infrastructure uses the approved retention baseline', async () => {
  const preserved = {
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

test('0.3 saved histories resume exactly, independently of the 0.4 engine', async () => {
  const original = previous.createWorld('preserve-03', {era:'industrial'});
  const saved = await previousStorage.decodeSave(await previousStorage.encodeSave(previous.advance(original, 35).world));
  assert.deepEqual(previous.advance(saved, 65).world, previous.advance(original, 100).world);
});

test('versions cannot silently import, validate or overwrite each other', async () => {
  const old = previous.createWorld('separate-history');
  const fresh = current.createWorld('separate-history');
  assert.notEqual(old.schema, fresh.schema);
  assert.notEqual(old.modelVersion, fresh.modelVersion);
  assert.throws(() => current.validateWorld(old));
  assert.throws(() => previous.validateWorld(fresh));
  const oldExport = await previousStorage.encodeSave(old);
  const newExport = await currentStorage.encodeSave(fresh);
  await assert.rejects(() => currentStorage.decodeSave(oldExport));
  await assert.rejects(() => previousStorage.decodeSave(newExport));
});

test('old and current routes use distinct build artifacts and save namespaces', async () => {
  const text = async p => readFile(new URL(p, import.meta.url), 'utf8');
  assert.ok((await text('../../app/v04/route.ts')).includes('simulator-v04/dist/MICROGALAXY-0.4.html'));
  assert.ok((await text('../../app/v03/route.ts')).includes('simulator-v03/dist/MICROGALAXY-0.3.html'));
  assert.ok((await text('../../lib/world-models.mjs')).includes('microgalaxy_history_v04_v1'));
  assert.ok((await text('../../lib/world-models.mjs')).includes('microgalaxy_local_candidate_v1'));
  assert.ok((await text('../../lib/world-models.mjs')).includes('microgalaxy-observatory-v1'));
  const newApi = await text('../../app/api/v04/worlds/route.ts');
  assert.ok(newApi.includes('getChatGPTUser'));
  assert.ok(!newApi.includes('world-v03'));
});
