import test from 'node:test';
import assert from 'node:assert/strict';
import * as Core from '../src/core.mjs';
import * as Previous from '../src/previous-core.mjs';
import { describeSettlement } from '../src/settlement-view.mjs';

const snapshot = (seed, year, era = 'industrial') => Core.advance(Core.createWorld(seed, {era}), year).world;
const item = (view, kind) => view.objects.find(it => it.kind === kind);

test('земледельческая, портовая и горнопромышленная сцены различаются по записям самого региона', () => {
  const farmWorld = snapshot('МЕАНДР-19', 8), portWorld = snapshot('BASIN-6', 30);
  const farm = describeSettlement(farmWorld, 'r48'), port = describeSettlement(portWorld, 'r15');
  const mine = describeSettlement(snapshot('ПЕРСЕИДЫ', 30), 'r15');
  assert.equal(farm.name, 'Белей');
  assert.equal(farm.population, 1715);
  assert.equal(item(farm, 'fields').harvest, farmWorld.regions.find(r => r.id === 'r48').economy.harvest);
  assert.ok(!item(farm, 'mine') && !item(farm, 'harbor') && !item(farm, 'workshops'));
  assert.equal(port.name, 'Белур');
  assert.equal(item(port, 'harbor').port, portWorld.regions.find(r => r.id === 'r15').economy.port);
  assert.ok(item(port, 'harbor').seaRouteUse > 0);
  const paths = item(port, 'routes').paths;
  const edges = portWorld.geography.edges.filter(e => e.a === port.regionId || e.b === port.regionId);
  assert.deepEqual(paths.map(p => p.id), edges.map(e => e.id).sort());
  for (const p of paths) {
    const edge = edges.find(e => e.id === p.id);
    assert.equal(p.to, edge.a === port.regionId ? edge.b : edge.a);
    assert.equal(p.used, portWorld.economy.routes.find(r => r.id === p.id).used);
  }
  assert.equal(item(port, 'harbor').seaRouteUse, paths.filter(p => p.kind === 'sea').reduce((sum,p) => sum+p.used,0));
  assert.equal(mine.name, 'Мерон');
  assert.equal(item(mine, 'mine').industrial, true);
  assert.equal(mine.scale, 'town');
  assert.ok(mine.density > farm.density);
  for (const view of [farm, port, mine]) {
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
    assert.ok(view.density > 0 && view.density <= 1);
    assert.equal(new Set(view.objects.map(o => o.id)).size, view.objects.length);
    for (const o of view.objects) {
      assert.equal(o.id, view.regionId + ':' + o.kind);
      assert.match(o.evidence, /[а-яё]/i);
    }
  }
});

test('в опустевшем Нароне остаются лес и маршруты, а прежняя добывающая специализация не оживляет шахту и дома', () => {
  const w = snapshot('БЕРЕГ-132', 350, 'agriculture');
  const region = w.regions.find(r => r.id === 'r15');
  assert.equal(region.settlement.specialization, 'mining');
  const saved = JSON.stringify(w);
  const view = describeSettlement(w, region);
  assert.equal(view.name, 'Нарон');
  assert.equal(view.population, 0);
  assert.equal(view.density, 0);
  assert.equal(view.scale, 'empty');
  assert.equal(item(view, 'terrain').biome, 'forest');
  assert.ok(view.objects.every(o => ['terrain','routes'].includes(o.kind)));
  assert.equal(JSON.stringify(w), saved);
  assert.deepEqual(describeSettlement(w,region.id), view);
  assert.equal(describeSettlement(w, 'несуществующий регион'), null);
});

test('столица, ремесло и засуха проверяются по месту и дате наблюдения', () => {
  const w = snapshot('BASIN-6', 30);
  const capital = w.regions.find(r => r.settlement.specialization === 'administration');
  const artisan = w.regions.find(r => r.settlement.specialization === 'crafts');
  assert.ok(item(describeSettlement(w,capital), 'civic').capital);
  assert.ok(item(describeSettlement(w,artisan), 'workshops'));
  assert.equal(item(describeSettlement(w,capital), 'workshops'), undefined);
  const during = item(describeSettlement(w,'r6'), 'terrain');
  assert.equal(during.drought, true);
  assert.ok(during.droughtEventId);
  Core.createWorkerSession(w).step(4);
  assert.equal(item(describeSettlement(w,'r6'),'terrain').drought, false);
});

test('опоры и назначение появляются в указанном году и только в верховье, пауза сохраняет накопленный труд', () => {
  const w = Core.createWorld('МЕАНДР-19', {era:'industrial'}), run = Core.createWorkerSession(w);
  const stages = new Map();
  for (const year of [2,3,8,13,16]) {
    run.step(year-w.year);
    stages.set(year, structuredClone(w));
  }
  const end = stages.get(16), upper = end.regions.find(r => r.id === 'r8');
  const lateId = 'river:' + end.observatory.living.facts.find(f => f.kind === 'completed').id;
  const projectAt = y => item(describeSettlement(stages.get(y),upper,{id:lateId}), 'project');
  assert.equal(projectAt(2), undefined);
  const first = projectAt(3), stopped = projectAt(8), resumed = projectAt(13), done = projectAt(16);
  assert.deepEqual([first.phase,first.purpose,first.labor,first.required], ['building','passage',18,141]);
  assert.deepEqual([stopped.phase,stopped.reason,stopped.labor], ['paused','нет доступного назначения',72]);
  assert.equal(stopped.progress, 72/141);
  assert.deepEqual([resumed.phase,resumed.purpose], ['building','irrigation']);
  assert.deepEqual([done.phase,done.completed,done.progress,done.labor], ['completed',16,1,144]);
  assert.equal(done.selectedRecordId, lateId);
  assert.equal(done.sourceId, lateId.slice(6));
  for(const stage of [first,stopped,resumed]) {
    assert.equal(stage.id, done.id);
    assert.equal(stage.selectedRecordId, null);
    assert.ok(!stage.recordIds.includes(lateId));
  }
  for(const id of [end.observatory.living.basin.lower,end.observatory.living.basin.alternate]) {
    if(id)assert.equal(item(describeSettlement(end,id), 'project'), undefined);
  }
});

test('реальный разбор меняет стадию и ссылается на датированный акт', () => {
  const w = snapshot('ПЕРЕПРАВА-10',140), id = w.observatory.living.basin.upper;
  const prior = item(describeSettlement(w,id), 'project');
  assert.equal(prior.phase, 'paused');
  Core.createWorkerSession(w).step(1);
  const project = item(describeSettlement(w,id), 'project');
  assert.equal(project.id, prior.id);
  assert.equal(project.phase, 'dismantled');
  assert.equal(project.dismantled, 141);
  assert.equal(project.sourceId, w.observatory.living.basin.project.dismantled.source);
  assert.match(project.evidence, /1,5/);
  assert.ok(!prior.recordIds.includes('river:'+project.sourceId));
});

test('предыдущая редакция реестра сохраняет факт постройки и оставляет незаписанное назначение пустым', () => {
  const w = Previous.advance(Previous.createWorld('BASIN-1',{era:'industrial'}), 60).world;
  const basin = w.observatory.living.basin;
  const project = item(describeSettlement(w,basin.upper), 'project');
  assert.deepEqual([project.phase,project.started,project.completed,project.purpose], ['completed',47,57,null]);
  assert.equal(project.recordIds.length > 0, true);
});
