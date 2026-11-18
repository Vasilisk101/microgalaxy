import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,advance,validateWorld,viewSnapshot} from '../src/core.mjs';
import {encodeSave,decodeSave} from '../src/storage.mjs';

test('Регрессия: промышленный мир с колониями проходит 10 000 лет без экспоненциального переполнения',async()=>{
  let w=createWorld('REVIEW-LONG-INDEPENDENT',{era:'industrial'});
  for(let i=0;i<10;i++)w=advance(w,1000).world;
  assert.equal(w.year,10000);assert.ok(w.colonies.length>0);assert.ok(validateWorld(w));
  for(const c of w.colonies){const planet=w.planets.find(p=>p.id===c.planet);assert.ok(c.capacity<=250000*planet.radius*planet.radius+1e-6);assert.ok(c.population<=Math.ceil(c.capacity));assert.ok(c.food<=c.population*6+1e-6);}
  assert.ok(Buffer.byteLength(JSON.stringify(w))<24*1024*1024);
  const saved=await encodeSave(w),restored=await decodeSave(saved);assert.deepEqual(restored,w);
  assert.ok(Buffer.byteLength(saved)<24*1024*1024);
  for(const index of [0,1,w.snapshots.length-1])assert.ok(validateWorld(viewSnapshot(w,index)));
});
