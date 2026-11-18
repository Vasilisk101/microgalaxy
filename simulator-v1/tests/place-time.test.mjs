import test from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../src/core.mjs';
import {placeRecords} from '../src/place-records.mjs';
import {perform, canVisit} from '../src/place-time.mjs';

const run = input => perform(Core, placeRecords, input, async () => {});
test('gallery and rewind reproduce real river work at the selected date', async () => {
  const {world} = await run({task:'example',seed:'МЕАНДР-19',year:16});
  const saved = JSON.stringify(world);
  const {world:past} = await run({task:'year',world,year:3});
  const original = Core.advance(Core.createWorld(world.seed,{era:'industrial'}),3).world;
  assert.deepEqual(past.regions,original.regions);
  assert.deepEqual(past.observatory,original.observatory);
  assert.equal(past.observatory.living.basin.project.completed,null);
  assert.equal(past.observatory.living.basin.project.purpose,'passage');
  assert.equal(world.observatory.living.basin.project.completed,16);
  assert.equal(JSON.stringify(world),saved);
});
test('a regional stop catches a drought and then migration when there is no basin', async () => {
  const {world:start} = await run({task:'example',seed:'BASIN-6',year:0});
  const first = await run({task:'next',world:start,regionId:'r6'});
  assert.equal(first.found,true);
  assert.equal(first.world.year,28);
  assert.equal(first.world.observatory.living.basin,null);
  const second = await run({task:'next',world:first.world,regionId:'r6'});
  assert.equal(second.world.year,30);
  assert.ok(placeRecords(second.world,'r6').some(e => e.sourceId==='e20' && e.relatedIds.includes('event:e17')));
});
test('a historical replay never crosses an unrecorded experimental intervention', () => {
  const state={year:52,observatory:{experiment:{pairId:'pair-a',year:9}},
    snapshots:[{year:0,observatory:{}},{year:25,observatory:{experiment:{pairId:'pair-a'}}}]};
  assert.equal(canVisit(state,7),true);
  assert.equal(canVisit(state,9),false);
  assert.equal(canVisit(state,24),false);
  assert.equal(canVisit(state,26),true);
  assert.equal(canVisit(state,52),true);
  assert.equal(canVisit(state,53),false);
});
