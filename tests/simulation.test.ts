import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advanceWorld, advanceWorldBatch, getWorldStats, validateWorld, MAX_YEAR, MAX_ADVANCE_BATCH, type World, type AdvanceBatchResult } from '../lib/simulation.ts';
test('seed reproduces initial conditions; another seed changes the actual system', () => { const a = createWorld('орбита-17'); assert.deepEqual(a, createWorld('орбита-17')); const b = createWorld('орбита-18'); assert.notDeepEqual(a.planets, b.planets); assert.notDeepEqual(a.societies, b.societies); assert.ok(validateWorld(a)); assert.ok(a.planets.length >= 5 && a.planets.length <= 8);
    // These seeds previously produced duplicate planet and society names.
    for (const seed of ['15LS-141K', 'names-5']) {
        const world = createWorld(seed);
        assert.equal(new Set(world.planets.map(p => p.name)).size, world.planets.length);
        assert.equal(new Set(world.societies.map(s => s.name)).size, world.societies.length);
        assert.deepEqual(world, createWorld(seed));
    }
});
test('fixed yearly steps are independent of processing batch size and do not mutate input', () => { const initial = createWorld('partition'); const frozen = JSON.stringify(initial); let individual = initial; for (let i = 0; i < 150; i++)
    individual = advanceWorld(individual, 1); assert.deepEqual(individual, advanceWorld(initial, 150)); assert.equal(JSON.stringify(initial), frozen); assert.deepEqual(advanceWorld(initial, 0), initial); assert.throws(() => advanceWorld(initial, .5)); });
test('saving, reloading and continuing preserves the whole causal history and RNG', () => { const a = createWorld('save-resume', { epoch: 'industrial' }); const saved = JSON.parse(JSON.stringify(advanceWorld(a, 170))); assert.ok(validateWorld(saved)); assert.deepEqual(advanceWorld(saved, 250), advanceWorld(a, 420)); assert.equal(new Set(saved.events.map((e: any) => e.id)).size, saved.events.length); });
test('societies can reach space through development; journeys complete after launch', () => { const w = advanceWorld(createWorld('space-path', { epoch: 'industrial' }), 900); assert.ok(validateWorld(w)); assert.ok(w.missions.some(m => m.type === 'satellite')); assert.ok(w.missions.some(m => m.type === 'probe')); assert.ok(w.missions.some(m => m.type === 'colony')); for (const m of w.missions) {
    assert.ok(m.arrivalYear > m.launchedAt);
    if (m.active)
        assert.ok(m.arrivalYear <= w.year);
} const colony = w.missions.find(m => m.type === 'colony' && m.active)!; assert.ok(w.societies.some(s => s.id === `c-${colony.ownerId}` && s.planetId === colony.planetId)); assert.equal(new Set(w.societies.map(s => s.name)).size, w.societies.length); for (const e of w.events)
    assert.ok(e.causes.length > 0); });
test('long runs retain valid bounded population, critical history and initial history point', () => { for (const seed of ['a', 'b', 'c']) {
    const w = advanceWorld(createWorld(seed), 2400);
    assert.ok(validateWorld(w), `invalid ${seed}`);
    assert.equal(w.history[0].year, 0);
    assert.equal(w.history.at(-1)!.year, 2400);
    assert.ok(w.history.length <= 1024);
    assert.equal(w.events[0].type, 'origin');
    assert.ok(getWorldStats(w).population > 0);
    assert.ok(w.societies.every(s => s.population >= 0 && s.tech <= 100 && s.food >= 0));
} });
test('snapshot validation rejects non-finite values, unknown versions and broken references', () => { const w = createWorld('validation'); for (const breakIt of [(x: any) => x.societies[0].population = Infinity, (x: any) => x.planets[0].radius = NaN, (x: any) => x.engineVersion = 'future', (x: any) => x.societies[0].planetId = 'missing', (x: any) => x.events[0].causes = [], (x: any) => x.history[0].year = 3, (x: any) => x.societies[1].id = x.societies[0].id, (x: any) => x.year = MAX_YEAR + 1, (x: any) => x.societies[0].food = -1]) {
    const bad = structuredClone(w);
    breakIt(bad);
    assert.equal(validateWorld(bad), false);
} assert.equal(validateWorld(null), false); assert.equal(validateWorld({ ...w, unexpected: 'field' }), false); });

// Reference the former worker through the unchanged one-year public API.
// This catches changed event precedence, stopping years, or annual RNG use.
function previousWorkerBatch(
    initial: World,
    years: number,
    options: { untilEvent?: boolean; autoPause?: boolean },
): AdvanceBatchResult {
    let world = initial;
    let stopped: AdvanceBatchResult['stopped'] = '';
    for (let i = 0; i < years && world.year < MAX_YEAR; i++) {
        const lastEvent = world.events.at(-1)?.id;
        world = advanceWorld(world, 1);
        const newEvents = lastEvent ? world.events.slice(world.events.findIndex(e => e.id === lastEvent) + 1) : world.events;
        if (options.untilEvent && newEvents.some(e => e.importance >= 2)) { stopped = 'event'; break; }
        if (options.autoPause && newEvents.some(e => e.importance >= 3)) { stopped = 'important'; break; }
    }
    if (world.year >= MAX_YEAR) stopped = 'limit';
    else if (options.untilEvent && !stopped) stopped = 'none';
    return { world, advanced: world.year - initial.year, stopped };
}

test('bounded worker batches preserve old stopping years and complete states, including late history', () => {
    const fixtures = [
        createWorld('KEPLER-17', { epoch: 'industrial' }),
        advanceWorld(createWorld('ORBIT-01'), 75),
        advanceWorld(createWorld('audit-long', { epoch: 'industrial' }), 9000),
    ];
    for (const world of fixtures) {
        const before = JSON.stringify(world);
        for (const options of [{}, { autoPause: true }, { untilEvent: true }, { untilEvent: true, autoPause: true }]) {
            assert.deepEqual(advanceWorldBatch(world, 100, options), previousWorkerBatch(world, 100, options));
        }
        assert.equal(JSON.stringify(world), before, 'the input snapshot must remain untouched');
    }
});

test('bounded worker batches retain limit, no-event, and event-over-important precedence', () => {
    const initial = createWorld('KEPLER-17', { epoch: 'industrial' });
    const quiet = advanceWorldBatch(initial, 5, { untilEvent: true });
    assert.equal(quiet.stopped, 'none');
    assert.equal(quiet.advanced, 5);
    assert.deepEqual(quiet.world, advanceWorld(initial, 5));

    const firstImportant = advanceWorld(initial, 120).events.find(e => e.year > 0 && e.importance >= 3)!;
    assert.ok(firstImportant);
    const beforeImportant = advanceWorld(initial, firstImportant.year - 1);
    const both = advanceWorldBatch(beforeImportant, 10, { untilEvent: true, autoPause: true });
    assert.equal(both.stopped, 'event');
    assert.equal(both.world.year, firstImportant.year);
    assert.equal(advanceWorldBatch(beforeImportant, 10, { autoPause: true }).stopped, 'important');

    const nearLimit = advanceWorld(initial, MAX_YEAR - 2);
    assert.deepEqual(advanceWorldBatch(nearLimit, 10), previousWorkerBatch(nearLimit, 10, {}));
    const limit = advanceWorldBatch(nearLimit, 10);
    assert.equal(limit.stopped, 'limit');
    assert.equal(limit.advanced, 2);
    assert.equal(advanceWorldBatch(limit.world, 10).advanced, 0);
});

test('bounded worker batches accept only valid snapshots and bounded integer steps', () => {
    const initial = createWorld('bounded');
    const result = advanceWorldBatch(initial, MAX_ADVANCE_BATCH);
    assert.deepEqual(result.world, advanceWorld(initial, MAX_ADVANCE_BATCH));
    assert.equal(result.advanced, MAX_ADVANCE_BATCH);
    assert.ok(validateWorld(result.world));
    assert.deepEqual(advanceWorldBatch(initial, 0), { world: initial, advanced: 0, stopped: '' });
    for (const years of [-1, 0.5, MAX_ADVANCE_BATCH + 1, NaN, Infinity]) {
        assert.throws(() => advanceWorldBatch(initial, years));
    }
    assert.throws(() => advanceWorldBatch({ ...initial, rng: NaN }, 1));
});
