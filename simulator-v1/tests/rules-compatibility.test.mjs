import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as active from '../src/core.mjs';
import * as released from '../src/previous-core.mjs';
import {createSaveCodec,digest} from '../../simulator-v08/src/storage.mjs';

// SHA-256 of complete world JSON generated independently with the published 23516b4 sources.
const expected = {
  "agriculture": [
    "ec4bc2e895c5aee6edca1d10ad455ac0d9161fc62a3bcc470a2898f9ec36496d",
    "8d3cde25e780ef3b8198b772bf8fb638425cba25e1459b9f8009c0ef1863808f",
    "8a73a75fed2ab79c44e9fd65f1224db3e5061ae690ad350b6bf3c1ce2b8ddb38",
    "aa98709da78c4785d32b9082ff7634bbcaed9a5a9ff19f485cac6c79003d8b7f"
  ],
  "industrial": [
    "e853fcf5a416fdded6ac6eb1bb5af512cc2856689d1cf22a372cbd2f1e4ea509",
    "28e6ea413f30e1d90faef1bf2db0463ded1877b6fcec324044b3f86cd6b07050",
    "d5d0e45f60841452e0825753c9e00b1b7e075cd583642e1e2399161016af25b6",
    "a0402e016f23611c9ab9d53bbbd7f0bfd2936bee9e6cc96a3e74ff2656737439"
  ],
  "space": [
    "165e7d02171942e9f0be344a2376b17773ab93ebf67d1cba4f8902cca64824c9",
    "90e306a4190bd096a62b3b16fa642db461ed3e386f85fda45ec2e35e166c4d71",
    "f8b189da1126397d0e0347967b7b947013063a40bddefa937fb4457d4f8b9d26",
    "2e198f48b0e9f5781f00cab10666a6b1c108449ca134104cdb49e41ad1454986"
  ]
};
for (const [era,checksums] of Object.entries(expected)) {
  test('published 1.0.0 continues exactly through year 1000 · '+era,()=>{
    const world=released.createWorld('PATCH-PARITY',{era});
    const run=active.createWorkerSession(world);
    for(const [index,year] of [0,50,200,1000].entries()){
      while(world.year<year)run.step(Math.min(50,year-world.year));
      assert.equal(createHash('sha256').update(JSON.stringify(world)).digest('hex'),checksums[index]);
    }
  });
}
test('the portable file preserves rule identity across old/new revisions',async()=>{
  const codec=createSaveCodec(active.SCHEMA,active.MODEL_VERSION,active.validateWorld,active.acceptsModelVersion);
  for(const engine of [released,active]){
    const world=engine.createWorld('PATCH-FILE');
    const json=await codec.encode(world),envelope=JSON.parse(json);
    assert.equal(envelope.modelVersion,world.modelVersion);
    assert.deepEqual(await codec.decode(json),world);
    const previousPayload=JSON.stringify(world);
    assert.deepEqual(await codec.decode(JSON.stringify({...envelope,payload:previousPayload,checksum:await digest(previousPayload)})),world);
    const other=world.modelVersion==='1.0.0'?'1.0.1':'1.0.0';
    await assert.rejects(codec.decode(JSON.stringify({...envelope,modelVersion:other})),/Версия модели/);
    await assert.rejects(codec.decode(JSON.stringify({...envelope,modelVersion:'9.1.1'})),/не поддерживается/);
  }
  assert.equal(active.createWorld().modelVersion,'1.0.1');
  assert.throws(()=>released.validateWorld(active.createWorld()));
});
