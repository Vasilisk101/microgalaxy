// Manual, CPU-intensive release check: node simulator-v1/tests/long-history.mjs <seed> <era>
import assert from 'node:assert/strict';
import * as Core from '../src/core.mjs';
import {createSaveCodec,MAX_FILE_BYTES} from '../../simulator-v08/src/storage.mjs';

const [seed,era]=process.argv.slice(2);
assert.ok(seed&&['agriculture','industrial','space'].includes(era),'Supply a seed and era');
const codec=createSaveCodec(Core.SCHEMA,Core.MODEL_VERSION,Core.validateWorld);
const world=Core.createWorld(seed,{era});
const run=Core.createWorkerSession(world);
let midpoint,peakMemories=0;
for(let batch=1;batch<=10;batch++){
  run.step(1000);
  peakMemories=Math.max(peakMemories,world.observatory.living.memories.length);
  if(batch===5)midpoint=await codec.encode(world);
}
let complete;
try {
  complete=await codec.encode(world);
} catch(error) {
  const sizes=Object.fromEntries(Object.entries(world).map(([key,value])=>[key,Buffer.byteLength(JSON.stringify(value))]));
  const perSnapshot=Object.fromEntries(Object.keys(world.snapshots[0]).map(key=>[key,world.snapshots.reduce((bytes,s)=>bytes+Buffer.byteLength(JSON.stringify(s[key])),0)]));
  console.error({seed,era,sizes,perSnapshot});
  throw error;
}
const restored=await codec.decode(midpoint),continued=Core.createWorkerSession(restored);
for(let batch=0;batch<25;batch++)continued.step(200);
const second=await codec.encode(restored);
assert.ok(complete===second,'The uninterrupted and resumed exports must be identical.');
const loaded=await codec.decode(complete),bytes=Buffer.byteLength(complete);
assert.equal(loaded.year,10000);
assert.equal(loaded.snapshots.length,64);
assert.ok(bytes<=MAX_FILE_BYTES);
console.log(JSON.stringify({seed,era,year:loaded.year,identical:true,checksum:JSON.parse(complete).checksum,
  bytes,capacityRemaining:MAX_FILE_BYTES-bytes,midpointBytes:Buffer.byteLength(midpoint),
  population:Core.totalPopulation(loaded),colonies:loaded.colonies.length,returns:loaded.observatory.space.returns.length,
  intercolonyDeliveries:loaded.observatory.space.exchange.deliveries,
  peakMemories,riverFacts:loaded.observatory.living.facts.length}));
