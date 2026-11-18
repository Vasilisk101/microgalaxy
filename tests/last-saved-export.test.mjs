import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,advance} from '../simulator-v08/src/core.mjs';
import {memoryWorldStore,encodeLastSaved,decodeSave,ensureSaveSize,MAX_FILE_BYTES} from '../simulator-v08/src/storage.mjs';

test('after the portable size limit the latest saved year can still be exported and restored',async()=>{
  const store=memoryWorldStore(), world=createWorld('quota-and-previous-revision');
  await store.put(world,0);
  const next=advance(world,5).world;
  await store.put(next,1);
  assert.throws(()=>ensureSaveSize({fullArchive:'x'.repeat(MAX_FILE_BYTES)}),{code:'SAVE_SIZE_LIMIT'});
  const backup=await encodeLastSaved(store,world.id);
  assert.equal(backup.year,5);assert.equal(backup.revision,2);
  assert.deepEqual(await decodeSave(backup.text),next);
});

test('when the current stored body is unreadable, recover only a valid earlier revision of the requested world',async()=>{
  const previous=createWorld('recover-valid-older-revision'),id=previous.id;
  const row={id,world:{id},previous,revision:9};
  const store={persistent:true,getExportCheckpoints:async()=>row};
  const backup=await encodeLastSaved(store,id);
  assert.equal(backup.revision,8);assert.equal(backup.year,0);
  assert.deepEqual(await decodeSave(backup.text),previous);
  row.previous={...previous,id:'other-world'};
  await assert.rejects(encodeLastSaved(store,id));
});
