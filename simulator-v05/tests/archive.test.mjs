import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_PAGE_SIZE, MISSION_PAGE_SIZE, SNAPSHOT_LIMIT, RECENT_SNAPSHOTS,
  nextEventId, appendEvent, iterateEvents, allEvents, eventsSince, eventsAfter,
  eventCount, eventPageCount, eventPage, eventById, allMissions, missionCount,
  archiveCompletedMissions, archiveThroughYear, validateArchive,
  retainSnapshots, snapshotCoverage,
} from '../src/archive.mjs';

const copy = value => structuredClone(value);
function world(year = 0) {
  return {year, nextEvent: 1, eventArchive: [], events: [], missionArchive: [], missions: []};
}
function payload(year, causeEventIds = []) {
  return {year, type: 'politics', title: 'Событие ' + year, detail: 'Сохранённые условия и последствия',
    entityId: 's0', entityIds: ['s0'], causes: [{label: 'Поддержка', value: .6}],
    important: false, causeEventIds};
}
function fill(w, count, perYear = 1) {
  for (let i = 1; i <= count; i++) {
    w.year = Math.floor((i - 1) / perYear);
    appendEvent(w, payload(w.year, i > 1 ? [...new Set(['e1', 'e' + (i - 1)])] : []));
  }
  return w;
}
function mission(id, departure, arrival, status = 'arrived') {
  return {id, name: 'Экспедиция ' + id, kind: 'supply', owner: 's0', target: 'c100',
    departure, arrival, status, people: 0, cargo: 100 + departure, cost: 20};
}
function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) frozen(child);
  return Object.freeze(value);
}

test('page sizes and retention defaults are architectural bounds, not a lifetime cap', () => {
  assert.equal(EVENT_PAGE_SIZE, 256);
  assert.equal(MISSION_PAGE_SIZE, 128);
  assert.equal(SNAPSHOT_LIMIT, 64);
  assert.equal(RECENT_SNAPSHOTS, 16);
});

test('over 16k events survive with continuous IDs, old causes, and unchanged full pages', () => {
  const w = fill(world(), 513, 3), first = w.eventArchive[0], firstText = JSON.stringify(first);
  const count = 20_013;
  for (let i = 514; i <= count; i++) {
    w.year = Math.floor((i - 1) / 3);
    appendEvent(w, {...payload(w.year, ['e1', 'e' + (i - 1)]), movement: {kind: 'migration', from: 'r0', to: 'r1', people: i}});
  }
  assert.equal(validateArchive(w), true);
  assert.equal(eventCount(w), count);
  assert.equal(allEvents(w).length, count);
  assert.equal(w.nextEvent, count + 1);
  assert.equal(w.eventArchive.length, Math.floor((count - 1) / EVENT_PAGE_SIZE));
  assert.ok(w.events.length >= 1 && w.events.length <= EVENT_PAGE_SIZE);
  assert.ok(w.eventArchive.every(page => page.length === EVENT_PAGE_SIZE));
  assert.strictEqual(w.eventArchive[0], first);
  assert.equal(JSON.stringify(first), firstText);
  assert.equal(eventById(w, 'e1').id, 'e1');
  assert.deepEqual(eventById(w, 'e' + count).causeEventIds, ['e1', 'e' + (count - 1)]);
  assert.deepEqual(eventById(w, 'e' + count).movement, {kind: 'migration', from: 'r0', to: 'r1', people: count});
  assert.equal(new Set(allEvents(w).map(e => e.id)).size, count);
  assert.ok(Buffer.byteLength(JSON.stringify(w), 'utf8') < 24 * 1024 * 1024,
    'this test fixture fits the unchanged storage budget; paging does not bypass it');
});

test('255 → 256 → 257 rollover preserves a complete tail before sealing', () => {
  const w = fill(world(), 255);
  assert.equal(w.events.length, 255);assert.equal(w.eventArchive.length, 0);
  w.year = 255;appendEvent(w, payload(255, ['e1']));
  assert.equal(w.events.length, 256);assert.equal(w.eventArchive.length, 0);
  w.year = 256;appendEvent(w, payload(256, ['e1', 'e256']));
  assert.equal(w.events.length, 1);assert.equal(w.eventArchive.length, 1);
  assert.equal(w.eventArchive[0].length, 256);
  assert.deepEqual(w.events[0].causeEventIds, ['e1', 'e256']);
  assert.equal(eventCount(w), 257);
});

test('closed event pages and nested payloads are immutable and detached from caller input', () => {
  const w = world(), input = {...payload(0), movement: {path: ['r1', 'r2']}};
  const record = appendEvent(w, input);
  input.causes[0].value = -10;input.movement.path.push('r3');
  assert.equal(record.causes[0].value, .6);
  assert.deepEqual(record.movement.path, ['r1', 'r2']);
  for (let i = 2; i <= 257; i++) {w.year = i;appendEvent(w, payload(i, ['e1']));}
  assert.equal(Object.isFrozen(w.eventArchive[0]), true);
  assert.equal(Object.isFrozen(w.eventArchive[0][0].causes[0]), true);
  assert.throws(() => w.eventArchive[0].push(record), TypeError);
  assert.throws(() => {w.eventArchive[0][0].movement.path[0] = 'different';}, TypeError);
});

test('JSON-restored mutable tail is safely sealed without modifying its old references', () => {
  const original = fill(world(), 256), w = JSON.parse(JSON.stringify(original));
  const priorTail = w.events, priorRecord = priorTail[0];
  w.year = 256;appendEvent(w, payload(256, ['e1']));
  assert.equal(priorTail.length, 256);
  assert.notStrictEqual(w.eventArchive[0], priorTail);
  assert.notStrictEqual(w.eventArchive[0][0], priorRecord);
  assert.equal(Object.isFrozen(w.eventArchive[0][0]), true);
  priorRecord.title = 'Caller change';
  assert.notEqual(w.eventArchive[0][0].title, 'Caller change');
});

test('nextEventId previews without allocating; append owns the global counter', () => {
  const w = fill(world(), 600), before = copy(w);
  assert.equal(nextEventId(w), 'e601');assert.equal(nextEventId(w), 'e601');
  assert.deepEqual(w, before);
  appendEvent(w, {...payload(w.year, ['e600']), id: 'e601'});
  assert.equal(nextEventId(w), 'e602');
});

test('failed append does not consume an ID or partially install a page', () => {
  const w = fill(world(), 256), before = copy(w);
  for (const bad of [
    {...payload(w.year), id: 'e1'}, payload(w.year, ['e999']),
    payload(w.year, ['e1', 'e1']), payload(w.year, ['e257']),
    payload(w.year - 1), payload(w.year + 1), {...payload(w.year), run: () => {}},
  ]) {
    assert.throws(() => appendEvent(w, bad));
    assert.deepEqual(w, before);
  }
});

test('counter regression is an explicit error, not a repeated historical ID', () => {
  const w = fill(world(), 257);w.nextEvent = 1;
  assert.throws(() => appendEvent(w, payload(w.year)), /счётчик/);
});

test('eventPage reads only the requested physical page and handles empty/end pages', () => {
  const w = fill(world(), 780);
  assert.deepEqual(eventPage(w, 1).map(e => e.id), Array.from({length: 256}, (_, i) => 'e' + (i + 257)));
  assert.equal(eventPage(w, 3).length, 12);
  assert.deepEqual(eventPage(w, 4), []);
  assert.throws(() => eventPage(w, -1));assert.throws(() => eventPage(w, 1.5));
  Object.defineProperty(w.eventArchive, 0, {get() {throw new Error('unrelated page was read');}});
  assert.equal(eventPage(w, 2)[0].id, 'e513');
  assert.equal(eventPage(w, 3)[0].id, 'e769');
});

test('eventPage, counts and lookup apply an inclusive historical cutoff within a page', () => {
  const w = fill(world(), 800, 2);
  assert.equal(eventCount(w, 150), 302);
  assert.equal(eventPageCount(w, 150), 2);
  assert.equal(eventPage(w, 1, {throughYear: 150}).length, 46);
  assert.equal(eventById(w, 'e302', 150).year, 150);
  assert.equal(eventById(w, 'e303', 150), null);
  for (const bad of ['bad', 'e0', 'e01', 'e1.5', 'e9007199254740992', 'e99999', null]) assert.equal(eventById(w, bad), null);
});

test('eventsSince is exclusive by year; eventsAfter is exact through same-year rollover', () => {
  const w = fill(world(), 256, 1000), cursor = eventCount(w);
  appendEvent(w, payload(0, ['e1']));appendEvent(w, payload(0, ['e257']));
  assert.deepEqual(eventsAfter(w, cursor).map(e => e.id), ['e257', 'e258']);
  assert.deepEqual(eventsSince(w, 0), []);
  assert.equal(eventsSince(w, -1).length, 258);
  assert.deepEqual(eventsAfter(w, 258), []);
  assert.throws(() => eventsAfter(w, 259));
});

test('year-window iteration skips early pages and never leaks later events', () => {
  const w = fill(world(), 900);
  assert.deepEqual(eventsSince(w, 510, 515).map(e => e.id), ['e512', 'e513', 'e514', 'e515', 'e516']);
  assert.deepEqual([...iterateEvents(w, {afterYear: 510, throughYear: 515})], eventsSince(w, 510, 515));
  assert.deepEqual(eventsSince(w, 515, 510), []);
  assert.deepEqual(eventsAfter(w, 510, 512).map(e => e.id), ['e511', 'e512', 'e513']);
});

test('pure event readers do not mutate frozen worlds or expose future root archives at an old year', () => {
  const w = fill(world(), 700), before = copy(w);
  frozen(w);
  allEvents(w);eventsSince(w, 10);eventsAfter(w, 10);eventPage(w, 1);eventById(w, 'e1');eventCount(w);eventPageCount(w);nextEventId(w);
  assert.deepEqual(w, before);
  const past = {...w, year: 100};
  assert.equal(allEvents(past).length, 101);
  assert.equal(eventCount(past), 101);
  assert.equal(eventById(past, 'e102'), null);
});

test('archiveThroughYear produces a complete causal prefix with no future pages', () => {
  const w = fill(world(), 700), before = copy(w), cutoff = 350;
  const fields = archiveThroughYear(w, cutoff), past = {...w, ...fields, year: cutoff, nextEvent: 352};
  assert.deepEqual(Object.keys(fields).sort(), ['eventArchive', 'events', 'missionArchive', 'missions']);
  assert.equal(fields.eventArchive.length, 1);assert.equal(fields.events.length, 95);
  assert.equal(eventCount(past), 351);assert.equal(validateArchive(past), true);
  const known = new Set();
  for (const e of allEvents(past)) {
    assert.ok(e.causeEventIds.every(id => known.has(id)));
    known.add(e.id);
  }
  assert.equal(eventById(past, 'e351').causeEventIds[0], 'e1');
  assert.equal(eventById(past, 'e352'), null);
  assert.deepEqual(w, before);
});

test('cutoff exactly at a full-page boundary preserves shape and accepts the next global event', () => {
  const w = fill(world(), 700), past = {...w, ...archiveThroughYear(w, 255), year: 255, nextEvent: 257};
  assert.equal(past.eventArchive.length, 1);assert.equal(past.events.length, 0);
  assert.equal(validateArchive(past), true);
  appendEvent(past, payload(255, ['e1', 'e256']));
  assert.equal(past.events[0].id, 'e257');assert.equal(validateArchive(past), true);
  assert.equal(eventCount(w), 700);
});

test('empty archive helpers have stable shapes without fabricating an origin record', () => {
  const w = world();
  assert.equal(validateArchive(w), true);assert.equal(eventCount(w), 0);assert.equal(eventPageCount(w), 0);
  assert.deepEqual(allEvents(w), []);assert.deepEqual(eventPage(w, 0), []);
  assert.equal(eventById(w, 'e1'), null);assert.equal(nextEventId(w), 'e1');
  assert.deepEqual(archiveThroughYear(w, 0), {eventArchive: [], events: [], missionArchive: [], missions: []});
});

for (const [label, corrupt] of [
  ['short closed page', w => {w.eventArchive[0].pop();}],
  ['oversized closed page', w => {w.eventArchive[0].push(copy(w.events[0]));}],
  ['oversized tail', w => {w.events = Array.from({length: 257}, (_, i) => ({id: 'e' + (257 + i), year: w.year}));}],
  ['repeated sequence ID', w => {w.events[0].id = 'e1';}],
  ['counter beyond records', w => {w.nextEvent += 1;}],
  ['future event', w => {w.events[0].year = w.year + 1;}],
  ['backward event year', w => {w.events[0].year = 0;}],
  ['sparse page', w => {delete w.eventArchive[0][4];}],
  ['missing pages field', w => {delete w.eventArchive;}],
]) {
  test('validateArchive rejects ' + label, () => {
    const w = copy(fill(world(), 257));corrupt(w);
    assert.throws(() => validateArchive(w));
  });
}

test('over 160 completed missions are preserved outside active slots', () => {
  const w = world(1000), completed = Array.from({length: 500}, (_, i) => mission('m' + (i + 1), i, i + 1));
  const active = Array.from({length: 5}, (_, i) => mission('m' + (i + 501), 995, 1005, 'transit'));
  w.missions = [...completed, ...active];
  assert.equal(archiveCompletedMissions(w), 500);
  assert.equal(w.missions.length, 5);
  assert.deepEqual(w.missionArchive.map(page => page.length), [128, 128, 128, 116]);
  assert.deepEqual(allMissions(w), [...completed, ...active]);
  assert.equal(missionCount(w), 505);assert.equal(validateArchive(w), true);
  assert.equal(new Set(allMissions(w).map(m => m.id)).size, 505);
  assert.equal(allMissions(w).find(m => m.id === 'm499').cargo, 598);
});

test('mission page growth never modifies old full pages or loses a partial-page record', () => {
  const w = world(500);w.missions = Array.from({length: 130}, (_, i) => mission('m' + (i + 1), i, i + 1));
  archiveCompletedMissions(w);
  const full = w.missionArchive[0], partial = w.missionArchive[1], contents = copy(w.missionArchive);
  w.missions = Array.from({length: 130}, (_, i) => mission('m' + (i + 131), i + 130, i + 131));
  archiveCompletedMissions(w);
  assert.strictEqual(w.missionArchive[0], full);
  assert.deepEqual(full, contents[0]);assert.deepEqual(partial, contents[1]);
  assert.notStrictEqual(w.missionArchive[1], partial);
  assert.deepEqual(w.missionArchive.map(page => page.length), [128, 128, 4]);
  assert.equal(missionCount(w), 260);assert.equal(validateArchive(w), true);
  assert.equal(Object.isFrozen(w.missionArchive[1]), true);
});

test('mission archive detaches completed payloads and leaves active object identity intact', () => {
  const w = world(20), done = mission('m1', 0, 10), active = mission('m2', 15, 25, 'transit');
  w.missions = [done, active];archiveCompletedMissions(w);
  done.cargo = -100;
  assert.equal(w.missionArchive[0][0].cargo, 100);
  assert.strictEqual(w.missions[0], active);
  assert.equal(Object.isFrozen(w.missionArchive[0][0]), true);
});

test('no completed missions is a no-op, including array identities', () => {
  const w = world(5);w.missions.push(mission('m1', 0, 10, 'transit'));
  const active = w.missions, pages = w.missionArchive, before = copy(w);
  assert.equal(archiveCompletedMissions(w), 0);
  assert.strictEqual(w.missions, active);assert.strictEqual(w.missionArchive, pages);assert.deepEqual(w, before);
});

test('failed mission archival is atomic and cannot silently drop duplicate or future records', () => {
  for (const bad of [mission('m1', 1, 5), mission('m2', 1, 30), {...mission('m2', 1, 5), status: 'unknown'}]) {
    const w = world(20);w.missions = [mission('m1', 0, 10)];archiveCompletedMissions(w);
    w.missions = [bad];const before = copy(w);
    assert.throws(() => archiveCompletedMissions(w));assert.deepEqual(w, before);
  }
});

test('successful mission archival makes its reusable index immutable without extra persisted fields', () => {
  const w = world(100);w.missions = [mission('m1', 0, 10)];
  const keys = Object.keys(w).sort();archiveCompletedMissions(w);
  assert.equal(Object.isFrozen(w.missionArchive), true);
  assert.throws(() => w.missionArchive.push([mission('m2', 0, 20)]), TypeError);
  assert.throws(() => {w.missionArchive[0][0].id = 'changed';}, TypeError);
  w.missions.push(mission('m2', 10, 20));archiveCompletedMissions(w);
  assert.equal(missionCount(w), 2);assert.deepEqual(Object.keys(w).sort(), keys);
});

test('mission archive replacement and structuredClone invalidate any cached ID index', () => {
  const w = world(100);w.missions = [mission('m1', 0, 10)];archiveCompletedMissions(w);
  w.missionArchive = [[mission('m9', 0, 10)]];
  w.missions = [mission('m9', 20, 30)];
  assert.throws(() => archiveCompletedMissions(w), /повтор/);
  assert.equal(Object.isFrozen(w.missionArchive[0]), false, 'failed operation must not freeze caller data');
  w.missions = [mission('m10', 20, 30)];archiveCompletedMissions(w);
  assert.deepEqual(allMissions(w).map(m => m.id), ['m9', 'm10']);
  const restored = copy(w);restored.missions = [mission('m9', 30, 40)];
  assert.throws(() => archiveCompletedMissions(restored), /повтор/);
});

test('unsupported delayed completion is rejected rather than producing an invalid historical transit', () => {
  const w = world(10);w.missions = [{...mission('m1', 0, 5), completedAt: 8}];
  const before = copy(w);
  assert.throws(() => archiveCompletedMissions(w), /время завершения/);
  assert.deepEqual(w, before);
  const bad = {...w, missions: [], missionArchive: [[w.missions[0]]]};
  assert.throws(() => validateArchive(bad), /время завершения/);
});

test('mission historical readers reconstruct transit before a later completion', () => {
  const w = world(100), first = mission('m1', 0, 20), crossing = mission('m2', 10, 80), future = mission('m3', 90, 95);
  w.missions = [first, crossing, future];archiveCompletedMissions(w);
  const historical = allMissions(w, 30);
  assert.deepEqual(historical.map(m => [m.id, m.status]), [['m1', 'arrived'], ['m2', 'transit']]);
  assert.equal(historical[1].arrival, 80);
  assert.equal(w.missionArchive[0][1].status, 'arrived');
  assert.equal(missionCount(w, 30), 2);
  assert.equal(allMissions(w, 80).find(m => m.id === 'm2').status, 'arrived');
});

test('cutoff inside one mission page keeps completed records once and future completions active', () => {
  const w = fill(world(), 101);w.missions = [mission('m1', 0, 10), mission('m2', 5, 40), mission('m3', 60, 70), mission('m4', 90, 110, 'transit')];
  archiveCompletedMissions(w);
  const fields = archiveThroughYear(w, 20), past = {...w, ...fields, year: 20, nextEvent: 22};
  assert.deepEqual(past.missionArchive.flat().map(m => m.id), ['m1']);
  assert.deepEqual(past.missions.map(m => [m.id, m.status]), [['m2', 'transit']]);
  assert.equal(validateArchive(past), true);
  assert.equal(new Set(allMissions(past).map(m => m.id)).size, 2);
  assert.deepEqual(allMissions(past), allMissions(w, 20));
});

test('mission cutoff never leaks a future departure and sorts equal-year numeric IDs deterministically', () => {
  const w = world(100);w.missions = [mission('m10', 1, 20), mission('m2', 1, 20), mission('m11', 90, 120, 'transit')];
  archiveCompletedMissions(w);
  assert.deepEqual(allMissions(w, 5).map(m => m.id), ['m2', 'm10']);
  assert.deepEqual(allMissions({...w, year: 5}).map(m => [m.id, m.status]), [['m2', 'transit'], ['m10', 'transit']]);
});

test('pure mission and cutoff helpers do not mutate deeply frozen input', () => {
  const w = fill(world(), 700);w.missions = [mission('m1', 0, 100), mission('m2', 200, 500), mission('m3', 690, 710, 'transit')];
  archiveCompletedMissions(w);const before = copy(w);frozen(w);
  allMissions(w);allMissions(w, 300);missionCount(w);archiveThroughYear(w, 300);validateArchive(w);
  assert.deepEqual(w, before);
});

for (const [label, corrupt] of [
  ['arrived record in active missions', w => {w.missions.push(mission('m200', 0, 20));}],
  ['transit record in mission archive', w => {w.missionArchive[0][0].status = 'transit';}],
  ['duplicate mission identity', w => {w.missions.push(mission('m1', 90, 110, 'transit'));}],
  ['empty mission archive page', w => {w.missionArchive.push([]);}],
  ['partial nonfinal mission page', w => {w.missionArchive = [[w.missionArchive[0][0]], [w.missionArchive[0][1]]];}],
  ['oversized mission page', w => {w.missionArchive[0] = Array.from({length: 129}, (_, i) => mission('m' + (i + 1), 0, 10));}],
  ['future archived arrival', w => {w.missionArchive[0][0].arrival = 101;}],
  ['expired transit mission', w => {w.missions.push(mission('m200', 0, 100, 'transit'));}],
  ['nonpositive journey duration', w => {w.missionArchive[0][0].arrival = 0;}],
  ['sparse mission page', w => {delete w.missionArchive[0][0];}],
]) {
  test('validateArchive rejects ' + label, () => {
    const w = world(100);w.missions = [mission('m1', 0, 10), mission('m2', 0, 20)];archiveCompletedMissions(w);
    const bad = copy(w);corrupt(bad);assert.throws(() => validateArchive(bad));
  });
}

test('10k-year streaming retention keeps origin, recent 16 and anchors throughout history', () => {
  let kept = [];
  for (let year = 0; year <= 10_000; year += 25) kept = retainSnapshots([...kept, {year, marker: 'snapshot-' + year}]);
  assert.equal(kept.length, 64);assert.equal(kept[0].year, 0);
  assert.deepEqual(kept.slice(-16).map(s => s.year), Array.from({length: 16}, (_, i) => 9625 + i * 25));
  const coverage = snapshotCoverage(kept);
  assert.equal(coverage.oldestYear, 0);assert.equal(coverage.newestYear, 10_000);assert.equal(coverage.recentFromYear, 9625);
  assert.ok(coverage.largestGap <= 400, 'past is spread, not erased to a single origin + recent tail');
  for (let start = 0; start < 10_000; start += 1000) assert.ok(kept.some(s => s.year >= start && s.year < start + 1000), 'missing history near year ' + start);
  assert.ok(kept.every((s, i) => !i || s.year > kept[i - 1].year));
});

test('retention uses the densest eligible interval with deterministic oldest-first ties', () => {
  const points = [0, 1, 2, 3, 4, 100, 200].map(year => ({year}));
  assert.deepEqual(retainSnapshots(points, {limit: 6, recent: 2}).map(s => s.year), [0, 2, 3, 4, 100, 200]);
  const uneven = [0, 10, 11, 12, 100, 200, 300].map(year => ({year}));
  assert.deepEqual(retainSnapshots(uneven, {limit: 6, recent: 2}).map(s => s.year), [0, 10, 12, 100, 200, 300]);
});

test('retention is pure, preserves snapshot payloads and is deterministic across identical runs', () => {
  const points = frozen(Array.from({length: 401}, (_, i) => ({year: i * 25, nested: {population: i}}))), before = copy(points);
  const first = retainSnapshots(points), second = retainSnapshots(points);
  assert.deepEqual(first, second);assert.deepEqual(points, before);
  assert.notStrictEqual(first, points);
  assert.ok(first.every(s => points.includes(s)));
  assert.deepEqual(snapshotCoverage(points).retainedYears, first.map(s => s.year));
});

test('retention handles empty/short histories without inventing extra checkpoints', () => {
  assert.deepEqual(retainSnapshots([]), []);
  assert.deepEqual(snapshotCoverage([]), {count: 0, oldestYear: null, newestYear: null, recentFromYear: null, largestGap: 0, retainedYears: []});
  const points = [{year: 0}, {year: 25}, {year: 50}];
  assert.deepEqual(retainSnapshots(points), points);
  assert.notStrictEqual(retainSnapshots(points), points);
});

test('retention rejects missing origin, nonincreasing dates and impossible protected-tail options', () => {
  for (const points of [[{year: 25}], [{year: 0}, {year: 0}], [{year: 0}, {year: -1}], [{year: 0}, {year: 1.5}], [{year: 0}, {year: 50}, {year: 25}]]) {
    assert.throws(() => retainSnapshots(points));
  }
  assert.throws(() => retainSnapshots([{year: 0}], {limit: 16, recent: 16}));
  assert.throws(() => retainSnapshots([{year: 0}], {limit: 1}));
});
