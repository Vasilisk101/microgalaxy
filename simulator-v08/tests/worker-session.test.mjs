import assert from 'node:assert/strict';
import test from 'node:test';
import {advance, applyWorkerPatch, createWorkerSession, createWorld, validateWorld} from '../src/core.mjs';

test('worker patches preserve public results through archive paging and checkpoint retention', () => {
  let reference = createWorld('long-run-08-final', {era: 'space'});
  let mirror = structuredClone(reference);
  const session = createWorkerSession(structuredClone(reference));
  for (const [years, stopOnImportant] of [[0, false], [12, true], [650, false], [1000, false], [3, false]]) {
    const previous = mirror;
    const expected = advance(reference, years, {stopOnImportant});
    // The bridge uses structured message delivery, so its results have no shared mutable fields.
    const {patch, ...outcome} = structuredClone(session.step(years, {stopOnImportant}));
    mirror = applyWorkerPatch(previous, patch);
    assert.deepEqual(outcome, {
      advanced: expected.advanced, newEvents: expected.newEvents, stopped: expected.stopped
    });
    assert.deepEqual(mirror, expected.world);
    if (expected.advanced) {
      assert.strictEqual(mirror.snapshots[0], previous.snapshots[0]);
      assert.strictEqual(mirror.planets, previous.planets);
      assert.throws(() => applyWorkerPatch(mirror, patch), /другому состоянию/);
    } else {
      assert.strictEqual(mirror, previous);
    }
    reference = expected.world;
  }
  assert.ok(mirror.eventArchive.length > 0);
  assert.ok(mirror.missionArchive.length > 1);
  assert.equal(mirror.snapshots.length, 64);
  assert.ok(validateWorld(mirror));
  const {patch} = structuredClone(session.step(1));
  assert.ok(!Object.hasOwn(patch, 'snapshots'));
  assert.ok(!Object.hasOwn(patch, 'eventPages'));
  assert.ok(JSON.stringify(patch).length < JSON.stringify(mirror).length / 4);
});

test('an imported historical snapshot is fully checked before any worker steps', () => {
  const world = createWorld('worker-import');
  world.snapshots[0].ledger.totalAfter++;
  assert.throws(() => createWorkerSession(world), /баланс населения/);
  assert.throws(() => advance(world), /баланс населения/);
});

test('invalid requests preserve a healthy session; an interrupted tick cannot be reused', () => {
  const mirror = createWorld('worker-interruption');
  const privateCopy = structuredClone(mirror);
  const session = createWorkerSession(privateCopy);
  assert.throws(() => session.step(1001), /1000/);
  assert.equal(session.step(0).advanced, 0);
  Object.defineProperty(privateCopy.regions[0], 'water', {
    get() { return 0.5; },
    set() { throw new Error('interrupted tick'); }
  });
  assert.throws(() => session.step(1), /interrupted tick/);
  assert.equal(privateCopy.year, 1);
  assert.equal(mirror.year, 0);
  assert.throws(() => session.step(1), /заново/);
  const recovered = createWorkerSession(structuredClone(mirror)).step(1);
  assert.deepEqual(applyWorkerPatch(mirror, structuredClone(recovered.patch)), advance(mirror).world);
});
