import test from 'node:test';
import assert from 'node:assert/strict';
import {planRetention, MIB} from '../lib/retention-policy.mjs';
const row = (model,id,bytes,updatedAt,extra={}) => ({model,id,bytes:bytes*MIB,updatedAt,revision:1,...extra});
test('oldest across models first, stable ties and duplicate ids across models', () => {
  const result=planRetention([row('v08','same',30,'2026-01-02Z'),row('v03','same',30,'2026-01-01Z'),row('v07','third',30,'2026-01-01Z')],50*MIB);
  assert.deepEqual(result.remove.map(x=>[x.model,x.id]),[['v03','same'],['v07','third']]);
  assert.equal(result.remainingBytes,30*MIB);
});
test('active, pinned, pending and unknown worlds are protected and reported', () => {
  const result=planRetention([row('v03','active',30,'2026-01-01Z',{active:true}),row('v04','pinned',30,'2026-01-01Z',{pinned:true}),row('v05','pending',30,'2026-01-01Z',{pending:true}),{model:'v07',id:'unknown',bytes:null}],50*MIB);
  assert.equal(result.blocked,true); assert.equal(result.complete,false); assert.equal(result.unknownCount,1); assert.deepEqual(result.remove,[]);
});
test('rejects duplicate identities, invalid size and unsupported quota', () => {
  const r=row('v03','a',1,'2026-01-01Z');
  assert.throws(()=>planRetention([r,r])); assert.throws(()=>planRetention([{...r,bytes:-1}])); assert.throws(()=>planRetention([],201*MIB));
});
