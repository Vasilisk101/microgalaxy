import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as Core from '../src/core.mjs';
import * as Branches from '../src/branches.mjs';
import * as Storage from '../../simulator-v08/src/storage.mjs';

test('two complete copies are previewed before save; the user can open either branch and return',async()=>{
  const world=Core.createWorld('BASIN-16',{era:'industrial'});
  world.id=crypto.randomUUID();
  const store=Storage.memoryWorldStore({validate:Core.validateWorld});
  await store.put(world,0);
  const elements=new Map(),element=key=>{
    if(!elements.has(key))elements.set(key,{value:'',addEventListener(){},removeEventListener(){},close(){}});
    return elements.get(key);
  };
  const errors=[];
  const ctx={world,store,Core,Branches,Storage,TextEncoder,Intl,Number,
    busy:false,switching:false,localConflict:false,snapshotIndex:null,revision:1,
    h:x=>String(x).replaceAll('<','&lt;'),$:element,
    modal:(title,html)=>{ctx.title=title;ctx.html=html;},
    notice:message=>errors.push(message),persist:async()=>({revision:ctx.revision}),transition:cb=>cb(),
    selectRecord:r=>{ctx.world=r.world;ctx.revision=r.revision;},scheduleSync(){},resetEconomyPages(){},showRegionMap:id=>{ctx.selectedRegion=id;},
    openLocal:async id=>ctx.selectRecord(await store.get(id))};
  vm.runInNewContext(readFileSync(new URL('../src/branches-ui.js',import.meta.url),'utf8')+
    ';globalThis.click=branchesClick;',ctx);
  const click=(action,data={})=>ctx.click({dataset:{branches:action,...data}});
  assert.ok(await click('open'));
  assert.match(ctx.html,/Сравнить до года/);
  element('#twin-edge').value=world.geography.edges[0].id;
  element('#twin-mode').value='none';
  element('#twin-end').value='3';
  await click('run');
  assert.match(ctx.html,/Сохранить обе ветви/);
  assert.equal((await store.list()).length,1);
  const selectedSite=world.geography.edges[0].b;
  assert.match(ctx.html,/Открыть регион/);
  await click('inspect',{side:'0',sample:'2',site:selectedSite});
  assert.match(ctx.html,/выбран год 2/);assert.match(ctx.html,/Ближайший доступный ранний срез: 0/);
  await click('report',{side:'0',sample:'2'});assert.match(ctx.html,/Сравнение от года/);
  await click('commit');
  assert.equal((await store.list()).length,3);
  assert.equal(ctx.world.observatory.experiment.role,'control');
  assert.match(ctx.html,/Открыть соседнюю ветвь/);
  await click('peer');
  assert.equal(ctx.world.observatory.experiment.role,'experimental');
  await click('inspect',{side:'0',sample:'2',site:selectedSite});assert.match(ctx.html,/Контроль/);
  await click('focus',{side:'0',sample:'2',site:selectedSite});assert.equal(ctx.world.observatory.experiment.role,'control');assert.equal(ctx.snapshotIndex,0);assert.equal(ctx.selectedRegion,selectedSite);assert.match(errors.pop(),/ближайший ранний срез 0/);
  await click('parent');
  assert.equal(ctx.world.id,world.id);
  assert.equal(ctx.world.year,0);
  ctx.snapshotIndex=0;
  await click('open');
  assert.match(errors.pop(),/полное состояние/);
  assert.deepEqual(errors,[]);
});

test('a report labels equal post-split cargo numbers as independent and older reports as incomplete',async()=>{
  const world=Core.createWorld('BASIN-16',{era:'industrial'});world.id=crypto.randomUUID();
  const used=Core.advance(world,2).world.economy.routes.filter(e=>e.used>0).sort((a,b)=>b.used-a.used)[0];
  const [branch]=await Branches.comparePair(world,{parentRevision:1,horizon:4,condition:{edge:used.id,mode:'closed',until:2}},Core);
  const ctx={world,Core,Branches,Storage,TextEncoder,Intl,Number,h:x=>String(x).replaceAll('<','&lt;')};
  vm.runInNewContext(readFileSync(new URL('../src/branches-ui.js',import.meta.url),'utf8')+';globalThis.report=branchReport;',ctx);
  const experiment=branch.observatory.experiment,html=ctx.report(experiment,experiment.report.samples.length-1,0);
  assert.match(html,/Партии возникли после разделения и показаны независимо/);assert.match(html,/cargo1/);assert.match(html,/совпадение номеров не доказывает общего происхождения/);
  delete experiment.report.firstFreight;
  assert.match(ctx.report(experiment,experiment.report.samples.length-1,0),/Старый отчёт не содержит сравнения партий/);
});
