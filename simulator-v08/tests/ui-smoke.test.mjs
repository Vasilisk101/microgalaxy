import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as WorldModels from '../../lib/world-models.mjs';
import * as RetentionPolicy from '../../lib/retention-policy.mjs';
import * as Core from '../src/core.mjs';
import * as PreviousCore from '../../simulator-v05/src/core.mjs';

const uiSource = fs.readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const observations = ['observation.js','freight-observation.js'].map(file=>fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8')).join('\n');
const rendererSource = fs.readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
const longWorld = Core.advance(Core.createWorld('ТУЛА-71'), 1000).world;
// This fixture deliberately exercises a known recorded movement; movement is not guaranteed for every 0.6 seed.
const movementWorld = PreviousCore.advance(PreviousCore.createWorld('ТУЛА-71'), 301).world;

function uiHarness(world, extras={}) {
  const nodes = new Map(), listeners = new Map();
  let focused, flattenCalls = 0;
  function node(selector) {
    if (!nodes.has(selector)) {
      const listeners = new Map();
      const classes = new Set();
      nodes.set(selector, {
        innerHTML: '', textContent: '', value: '', hidden: false, open: false,
        isConnected: true, tagName: selector.includes('search') ? 'INPUT' : 'BUTTON', dataset: {},
        classList: {toggle(name, force) {const next=force===undefined?!classes.has(name):!!force;if(next)classes.add(name);else classes.delete(name);return next;}, add(name) {classes.add(name);}, remove(name) {classes.delete(name);}, contains(name) {return classes.has(name);}},
        before(child) {nodes.set('#'+child.id,child);},
        querySelector(selector) {return node(selector);}, querySelectorAll() {return [];},
        insertAdjacentHTML(position, html) {if(position==='beforeend')this.innerHTML+=html;else this.innerHTML=html+this.innerHTML;},
        click() {this.clicked=true;},
        prepend(child) {this.innerHTML=child.innerHTML+this.innerHTML;},
        addEventListener(type, fn) {listeners.set(type, fn);},
        setAttribute(name, value) {this[name] = String(value);},
        removeAttribute(name) {delete this[name];},
        getClientRects() {return [{}];},
        focus() {focused = this;},
        showModal() {this.open = true;},
        close() {const wasOpen = this.open; this.open = false; if (wasOpen) listeners.get('close')?.();},
      });
    }
    return nodes.get(selector);
  }
  focused = node('opener');
  const context = {
    WorldModels, RetentionPolicy, structuredClone, Blob, fetch:extras.fetch, AbortController,
    Core: {...Core, allEvents(...args) {flattenCalls++; return Core.allEvents(...args);}},
    Storage: extras.storage??{isCloudDirty() {return true;}}, Cloud: {createCloudClient() {return {};}},
    Renderer: class {setFreightRoute() {} update() {} focusSociety() {} focusRegion() {} reset() {}},
    document: {getElementById(id) {return node('#'+id);},querySelector(selector) {return ['#mobile-inspector-summary','#back-inspector'].includes(selector)&&!nodes.has(selector)?null:node(selector);}, createElement() {return node('created-'+nodes.size);}, querySelectorAll() {return [];}, get activeElement() {return focused;}, addEventListener(type,fn) {const list=listeners.get(type)??[];list.push(fn);listeners.set(type,list);}},
    window: {addEventListener() {},confirm:extras.confirm??(()=>false)}, localStorage: {getItem() {return null;}, setItem() {}},
    Retention:extras.retention??{},RetentionClient:extras.retentionClient??{},
    clearTimeout() {}, setTimeout() {}, setInterval() {}, console, URL, URLSearchParams,
    crypto: globalThis.crypto, fixture: world,
  };
  vm.createContext(context);
  vm.runInContext(observations, context);
  // A gallery link keeps the personal archive closed. Use that normal entry
  // point to exercise the handlers with the fixture supplied by this harness.
  context.PlaceVisit = {isDemoLink:()=>true};
  vm.runInContext(uiSource, context);
  delete context.PlaceVisit;
  vm.runInContext('world=fixture;store={persistent:true};selectedPlanet=world.planets.find(p=>p.home).id;', context);
  return {node, run: code => vm.runInContext(code, context), change:(id,value)=>listeners.get('change')[0]({target:{id,value}}), click:async id=>{const button=node('#'+id);button.id=id;const event={target:{closest:selector=>selector==='button'?button:null},preventDefault(){}};for(const fn of listeners.get('click'))await fn(event);}, flattenCalls: () => flattenCalls};
}

test('retention shows separate usage, updates settings and only adopts after explicit confirmation',async()=>{
  const calls=[],row={model:'v07',id:'legacy-id',revision:3,bytes:1024,pinned:false,legacyProtected:true,protection:{revision:3,pinned:false,legacyProtected:true,sessions:['old']}};
  const status={knownBytes:1048576,limitBytes:200*1048576,complete:true,records:[row],deleted:[]};
  const retention={inventoryLocalRetention:async()=>({...status,records:[{...row,protection:undefined,active:false}]}),setRetentionLimit:async n=>(calls.push(['limit',n]),{...status,limitBytes:n}),setWorldPinned:async(...v)=>(calls.push(['pin',...v]),status),adoptLocalWorld:async(...v)=>(calls.push(['local-adopt',...v]),status)};
  const retentionClient={cloudRetention:async(...v)=>(calls.push(v),status)};
  let confirmed=false;const ui=uiHarness(longWorld,{retention,retentionClient,confirm:()=>confirmed});ui.run('sound=false');
  await ui.run('refreshRetention()');ui.run('renderRetention(true)');
  assert.match(ui.node('#storage-status').textContent,/1 МиБ \/ 200 МиБ/);assert.match(ui.node('#dialog-body').innerHTML,/На устройстве/);assert.match(ui.node('#dialog-body').innerHTML,/В облаке/);assert.match(ui.node('#dialog-body').innerHTML,/Разрешить очистку/);
  await ui.run("retentionChange('local','settings',{limitBytes:50*1048576})");assert.deepEqual(calls.at(-1),['limit',50*1048576]);
  assert.equal(calls.some(c=>c[0]==='adopt'),false,'inventory must never acknowledge old protection');
  const button=ui.node('#adopt');button.dataset={retentionAdopt:'cloud',model:'v07',worldId:'legacy-id'};await ui.click('adopt');assert.equal(calls.some(c=>c[0]==='adopt'),false);confirmed=true;await ui.click('adopt');assert.equal(calls.at(-1)[0],'adopt');assert.equal(calls.at(-1)[1].acknowledge,true);
  ui.run('retentionState.local.records=[{model:"v07",id:"legacy-id",revision:3,bytes:1024,legacyProtected:true,active:false}]');button.dataset.retentionAdopt='local';await ui.click('adopt');assert.equal(calls.at(-1)[0],'local-adopt');assert.equal(calls.at(-1)[5],true);
});

test('dirty old world releases leases only after confirmed final save and clean metadata',async()=>{
  const releases=[],meta={revision:4,cloud:{revision:8,syncedRevision:4}};
  const ui=uiHarness(longWorld,{storage:{isCloudDirty:r=>r.cloud?.syncedRevision!==r.revision},retentionClient:{releaseCloudWorld:async(...args)=>releases.push(['cloud',...args])}});
  ui.run(`store={persistent:true,getMetadata:async()=>(${JSON.stringify(meta)}),releaseWorld:async id=>globalThis.released.push(['local',id])};globalThis.released=[];localUnsaved=true;localConflict=false;`);
  await ui.run("transition(async()=>{saveTail=Promise.resolve({revision:4});world={id:'next'};})");
  assert.equal(ui.run('released.length'),1);assert.equal(releases.length,1);
  const failed=uiHarness(longWorld,{storage:{isCloudDirty:()=>false},retentionClient:{releaseCloudWorld:async()=>releases.push(['bad'])}});
  failed.run('globalThis.released=[];store={persistent:true,getMetadata:async()=>null,releaseWorld:async id=>released.push(id)};localUnsaved=true;localConflict=false;');
  await failed.run("transition(async()=>{saveTail=Promise.reject(new Error('uncertain'));world={id:'next'};})");
  assert.equal(failed.run('released.length'),0);assert.equal(releases.length,1);
});

test('catalogue opens all registered models, preserves local rows on partial pages and pins the selected copy',async()=>{
  const calls=[],worldId='same-id',local={key:'v08:'+worldId,model:'v08',id:worldId,name:'Долина',seed:'DELTA',year:240,revision:4,dirty:true};
  const page1={worlds:[{model:'v08',id:worldId,name:'Долина',year:230,revision:2}],partial:true,unavailableModels:['v05'],nextCursor:'page-two'};
  const page2={worlds:[{model:'v1',id:worldId,name:'Другая долина',year:20,revision:1}],nextCursor:null};
  const status={records:[{model:'v08',id:worldId,pinned:false,revision:4,bytes:100}],deleted:[]};
  const ui=uiHarness(longWorld,{
    retention:{readModelCatalog:async(model)=>{calls.push(model);return {rows:model==='v08'?[local]:[],pendingCount:0};},
      setWorldPinned:async(...args)=>{calls.push(args);return {...status,records:[{...status.records[0],pinned:true}]};}},
    fetch:async url=>Response.json(url.includes('?')?page2:page1),
  });
  ui.run('world=null;sound=false;retentionState.local='+JSON.stringify(status));
  await ui.click('worlds');
  for(const model of Object.keys(WorldModels.WORLD_MODELS))assert.ok(calls.includes(model),model);
  assert.match(ui.node('#catalog-list').innerHTML,/Местная версия/);
  assert.match(ui.node('#catalog-list').innerHTML,/Облачная версия/);
  assert.match(ui.node('#dialog-body').innerHTML,/Недоступны версии 0.5/);
  await ui.click('more-worlds');
  assert.match(ui.node('#catalog-list').innerHTML,/Другая долина/);
  assert.match(ui.node('#catalog-list').innerHTML,/\/v1\?world=same-id&amp;source=cloud/);
  assert.match(ui.node('#dialog-body').innerHTML,/прочитан частично/);
  const pin=ui.node('#pin');pin.dataset={retentionPin:'local',model:'v08',worldId,pinned:'true'};
  await ui.click('pin');
  assert.deepEqual(calls.at(-1),['v08',worldId,true]);
  assert.match(ui.node('#catalog-list').innerHTML,/Открепить на устройстве/);
});

test('lower-limit buttons list the affected name, cancel safely and submit only on a second confirmation',async()=>{
  const mb=1048576,updates=[];
  const records=['Старый','Закреплённый'].map((name,i)=>({model:'v08',id:'sample-'+i,name,revision:1,bytes:40*mb,pinned:i===1,updatedAt:'2026-01-01T00:00:00Z'}));
  const status={records,knownBytes:80*mb,limitBytes:200*mb,complete:true,deleted:[]};
  const ui=uiHarness(longWorld,{retention:{inventoryLocalRetention:async()=>status,setRetentionLimit:async(...args)=>{updates.push(args);return {...status,limitBytes:50*mb};}}});
  ui.run('sound=false;retentionState.local='+JSON.stringify(status)+';renderRetention(true)');
  ui.node('#limit-button').dataset={retentionLimit:'local'};
  for(const action of ['cancel-retention-limit','confirm-retention-limit']){
    ui.node('#retention-limit-local').value=String(50*mb);await ui.click('limit-button');
    const html=ui.node('#dialog-body').innerHTML;
    assert.match(html,/Старый/);assert.doesNotMatch(html,/Закреплённый/);assert.equal(updates.length,0);
    await ui.click(action);
  }
  assert.equal(updates.length,1);assert.equal(updates[0][0],50*mb);assert.match(updates[0][1],/^[0-9a-f]{64}$/);
});

test('oversize export offers a download of the committed year without replacing the live world',async()=>{
  const savedCalls=[];
  const storage={isCloudDirty:()=>true,encodeSave:async()=>{throw Object.assign(new Error('24 МиБ'),{code:'SAVE_SIZE_LIMIT'});},
    encodeLastSaved:async(store,id)=>{savedCalls.push(id);return {text:'{}',year:240,revision:4,persistent:true};}};
  const ui=uiHarness(longWorld,{storage});ui.run('sound=false;currentRecord={year:240};');
  await ui.click('export');
  assert.match(ui.node('#dialog-body').innerHTML,/Скачать сохранённую копию/);assert.equal(savedCalls.length,0);
  await ui.click('export-checkpoint');
  assert.deepEqual(savedCalls,[longWorld.id]);assert.match(ui.node('#notice-text').textContent,/год 240, ревизия 4/);
  assert.equal(ui.run('world.year'),longWorld.year);
});

test('mobile passport replaces observation and back restores it',async()=>{
  const ui=uiHarness(longWorld);ui.run('sound=false;render()');
  await ui.click('toggle-inspector');assert.equal(ui.node('main').classList.contains('show-inspector'),true);assert.equal(ui.node('#inspector').classList.contains('mobile-expanded'),true);
  await ui.click('back-inspector');assert.equal(ui.node('main').classList.contains('show-inspector'),false);assert.equal(ui.node('#inspector').classList.contains('mobile-expanded'),false);
  ui.change('mobile-view','economy');assert.equal(ui.node('main').classList.contains('content-view'),true);
});

test('mobile native selectors change view and object and reflect the selected state',()=>{
  const ui=uiHarness(longWorld), planet=longWorld.planets.find(p=>p.home);
  ui.change('mobile-view','economy');assert.equal(ui.run('view'),'economy');assert.equal(ui.node('#mobile-view').value,'economy');
  ui.change('mobile-object','system');assert.equal(ui.run('view'),'system');assert.equal(ui.node('#mobile-object').value,'system');
  ui.change('mobile-object',planet.id);assert.equal(ui.run('view'),'planet');assert.equal(ui.node('#mobile-object').value,planet.id);assert.equal(ui.node('#mobile-view').value,'planet');
});

test('society passport displays actual knowledge prerequisites and the selected historical slice', () => {
  const ui=uiHarness(longWorld), snapshot=Core.viewSnapshot(longWorld,0), id=snapshot.societies[0].id;
  ui.run(`snapshotIndex=0;showSociety(${JSON.stringify(id)})`);
  const html=ui.node('#dialog-body').innerHTML, dev=Core.societyDevelopmentSummary(snapshot,id);
  assert.match(html,/Знания и возможности/);
  for(const node of dev.knowledge.nodes){assert.ok(html.includes(node.name));assert.ok(html.includes(node.reason));}
  const inactive=dev.knowledge.nodes.find(n=>!n.active);assert.ok(inactive);
  assert.ok(html.includes((inactive.memory?'Восстановление: ':'Подготовка: ')+Math.round(inactive.progress*100)+'%'));
  const missing=inactive.requires.filter(id=>!dev.knowledge.nodes.find(n=>n.id===id)?.active);
  if(missing.length)assert.ok(html.includes('Не хватает: '+missing.map(id=>dev.knowledge.nodes.find(n=>n.id===id).name).join(', ')));
  assert.ok(html.includes('Культура и регионы'));
  assert.ok(!/undefined|NaN/.test(html));
});

test('observation controls are grouped and historical input never advances the world', () => {
  assert.match(template,/<details class="time-more">/);
  for(const id of ['history-slider','live','step','next-event'])assert.ok(template.includes(`id="${id}"`));
  assert.match(uiSource,/snapshotIndex!==null\|\|!world\)return/);
  assert.match(uiSource,/if\(document\.hidden\)\s*setRunning\(false\)/);
  assert.match(uiSource,/target\.closest\('input,select,textarea,button,a,summary/);
  assert.match(template,/id="cycle-speed"/);
});

test('all nine views render against the real v08 model without mutating it', () => {
  const before = JSON.stringify(longWorld), ui = uiHarness(longWorld);
  const expected = ['planet', 'system', 'regions', 'economy', 'societies', 'diplomacy', 'stories', 'chronicle', 'analysis'];
  assert.deepEqual([...template.matchAll(/<button data-view="([^"]+)"/g)].map(m => m[1]), expected);
  for (const view of expected) {
    ui.run(`view=${JSON.stringify(view)};render()`);
    if (!['planet', 'system'].includes(view)) {
      assert(ui.node('#page-content').innerHTML.length > 200);
      assert(!/undefined|NaN/.test(ui.node('#page-content').innerHTML), view);
    }
  }
  assert.equal(String(ui.node('#event-count').textContent), String(Core.eventCount(longWorld)));
  assert.equal(JSON.stringify(longWorld), before);
});

test('economy screen uses snapshot stocks and labels resources, routes and annual balance', () => {
  const ui = uiHarness(longWorld), snapshot=Core.viewSnapshot(longWorld,0);
  ui.run('snapshotIndex=0;view="economy";render()');
  const html=ui.node('#page-content').innerHTML;
  const number=new Intl.NumberFormat('ru-RU').format(Number(Core.economySummary(snapshot).resources.food.stock.toFixed(2)));
  assert.ok(html.includes(number));
  for(const label of ['Продовольствие','Сырьё','Энергия','Оборудование','Невязка баланса','Дефицит регионов','Специализация и запасы','Дороги и порты','Грузы в пути','Исторический срез'])assert.ok(html.includes(label),label);
  assert.match(html,/ед\.\/год/);
});

test('economy is keyboard navigable and mobile layout preserves compact cards', () => {
  const style=fs.readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(template,/<nav class="tabs" aria-label="Представления">/);
  assert.match(template,/<button data-view="economy">Экономика и пути<\/button>/);
  assert.match(style,/\.economy-list button\{min-height:44px\}/);
  assert.match(style,/@media\(max-width:600px\)\{\.economy-grid/);
});

test('visual rendering and recent movement lookup do not flatten the event archive', () => {
  const ui = uiHarness(longWorld);
  ui.run('view="planet";layer="nature";render();render();render();');
  ui.run('layer="routes";render();render();');
  assert.equal(ui.flattenCalls(), 0);
  ui.run('view="chronicle";render();render();');
  assert.equal(ui.flattenCalls(), 1);
});

test('chronicle search and event dossier include archived events outside the recent tail', () => {
  assert(longWorld.eventArchive.length > 0, 'fixture must exercise the paged archive');
  const old = Core.allEvents(longWorld)[0];
  assert(!longWorld.events.some(e => e.id === old.id));
  const ui = uiHarness(longWorld);
  ui.run(`view="chronicle";filterQuery=${JSON.stringify(old.title)};render()`);
  assert(ui.node('#event-list').innerHTML.includes(`data-event="${old.id}"`));
  ui.run(`showEvent(${JSON.stringify(old.id)})`);
  assert.equal(ui.node('#dialog-title').textContent, old.title);
  assert(ui.node('#dialog-body').innerHTML.includes('160'));
});

test('region, society, relation, story and event dossiers render with real helper contracts', () => {
  const before = JSON.stringify(longWorld), ui = uiHarness(longWorld);
  for (const action of [
    'showRegion(world.regions[0].id)',
    'showSociety(world.societies[0].id)',
    'showRelation(Core.diplomacySummary(world)[0].id)',
    'showStory(Core.storylines(world)[0].id)',
    'showEvent(Core.allEvents(world)[0].id)',
  ]) {
    ui.run(action);
    assert(ui.node('#dialog').open);
    assert(ui.node('#dialog-body').innerHTML.length > 300, action);
    assert(!/undefined|NaN/.test(ui.node('#dialog-body').innerHTML), action);
  }
  ui.run('showSociety(world.societies[0].id)');
  assert(ui.node('#dialog-body').innerHTML.includes('Культура и регионы'));
  ui.run('showRegion(world.regions[0].id)');
  assert(ui.node('#dialog-body').innerHTML.includes('Жителей всего региона'));
  assert.equal(JSON.stringify(longWorld), before);
});

test('society filters and region search use actual identities', () => {
  const ui = uiHarness(longWorld), selected = longWorld.societies[0].id;
  ui.run(`view="regions";regionSociety=${JSON.stringify(selected)};render()`);
  const shown = [...ui.node('#region-list').innerHTML.matchAll(/data-region="([^"]+)"/g)].map(m => m[1]);
  assert(shown.length > 0);
  for (const id of shown) assert.equal(longWorld.regions.find(r => r.id === id).owner, selected);
  ui.run('regionQuery="NO_SUCH_CENTER_75";renderRegionList()');
  assert(ui.node('#region-list').innerHTML.includes('подходящих регионов не найдено'));
});

test('historical state is cached, blocks simulation controls and excludes future events and movements', () => {
  const ui = uiHarness(longWorld);
  ui.run('snapshotIndex=1;view="regions";render()');
  const historical = ui.run('displayed()');
  assert.strictEqual(ui.run('displayed()'), historical);
  assert.equal(ui.node('#step').disabled, true);
  assert.equal(ui.node('#play').disabled, true);
  assert(ui.node('#history-coverage').textContent.includes('не каждый год'));
  assert(ui.run('recentMovements(displayed())').every(m => m.year <= historical.year));
  ui.run('view="chronicle";filterQuery="";render()');
  const ids = [...ui.node('#event-list').innerHTML.matchAll(/data-event="([^"]+)"/g)].map(m => m[1]);
  const events = new Map(Core.allEvents(longWorld).map(e => [e.id, e]));
  assert(ids.every(id => events.get(id).year <= historical.year));
});

test('route layer preserves recorded movements across non-migration years and labels each year', () => {
  assert.equal(movementWorld.geography.movements.length, 0);
  const ui = uiHarness(movementWorld), recent = ui.run('recentMovements(world)');
  assert(recent.length > 0);
  assert(recent.every(m => m.year >= 292 && m.year <= 301));
  const recorded = Core.allEvents(movementWorld).filter(e => e.movement).map(e => JSON.stringify(e.movement));
  for (const m of recent) assert(recorded.includes(JSON.stringify(m)));
  ui.run('view="regions";render()');
  assert(ui.node('#region-movements').innerHTML.includes('Год 300'));
  ui.run('view="planet";layer="routes";selectedRegion=world.regions[0].id;render()');
  assert(ui.node('#map-legend').innerHTML.includes('не потоки'));
  assert(ui.node('#map-legend').innerHTML.includes('раз в 10 лет'));
});

function rendererHarness(world) {
  const labels = [], listeners = new Map(), selected = [], strokes = [];
  const ctx = {
    createRadialGradient() {return {addColorStop() {}};}, setTransform() {}, fillRect() {},
    beginPath() {}, arc() {}, rect() {}, fill() {}, drawImage() {}, moveTo() {}, lineTo() {}, closePath() {},
    stroke() {strokes.push({color: this.strokeStyle, width: this.lineWidth});},
    strokeRect() {}, save() {}, restore() {}, ellipse() {}, setLineDash() {},
    measureText(text) {return {width: text.length * 6};}, fillText(text) {labels.push(text);},
    createImageData(w, h) {return {data: new Uint8ClampedArray(w * h * 4)};}, putImageData() {},
  };
  const canvas = {clientWidth: 1000, clientHeight: 800, getContext() {return ctx;},
    addEventListener(type, fn) {listeners.set(type, fn);}, setPointerCapture() {}, getBoundingClientRect() {return {left: 0, top: 0};}};
  const context = {Core, fixture: world, canvas, selected,
    window: {devicePixelRatio: 1}, ResizeObserver: class {observe() {}},
    document: {createElement() {return {getContext() {return ctx;}};}},
  };
  vm.createContext(context);
  vm.runInContext(rendererSource + ';const r=new Renderer(canvas,()=>{},()=>{},id=>selected.push(id));', context);
  return {run: code => vm.runInContext(code, context), labels, listeners, selected, strokes};
}

test('real Canvas renderer draws selectable regional centers, recorded routes and a separate connection network', () => {
  const before = JSON.stringify(movementWorld), renderer = rendererHarness(movementWorld);
  renderer.run('r.update(fixture,"planet",fixture.planets.find(p=>p.home),"settlements",null,fixture.regions[0].id);r.focusRegion(fixture.regions[0].id)');
  const hit = renderer.run('r.hits.find(h=>h.type==="region")');
  assert(hit);
  renderer.listeners.get('pointerdown')({pointerId: 1, clientX: hit.x, clientY: hit.y});
  renderer.listeners.get('pointerup')({pointerId: 1, clientX: hit.x, clientY: hit.y});
  assert.equal(renderer.selected[0], hit.id);
  renderer.run('const movements=Core.allEvents(fixture).filter(e=>e.movement&&e.year>=fixture.year-9).map(e=>e.movement);r.update(fixture,"planet",fixture.planets.find(p=>p.home),"routes",null,fixture.regions[0].id,movements)');
  assert(renderer.strokes.some(s => s.width === .8), 'thin real connection network');
  assert(renderer.strokes.some(s => s.width >= 1.2 && ['#87c7e4', '#d3dda4'].includes(s.color)), 'actual migration routes');
  assert(renderer.labels.length > 0);
  assert.equal(JSON.stringify(movementWorld), before);
});

test('a recorded regional event links to its place and honest adjacent snapshots without advancing time',()=>{
  const w=Core.advance(Core.createWorld('АРХИВ-09',{era:'agriculture'}),78).world;
  const r=w.regions.find(r=>r.settlement.name==='Дорон'),e=Core.allEvents(w).find(e=>e.year===65&&e.regionIds?.includes(r.id));assert.ok(e);
  const before=JSON.stringify(w),ui=uiHarness(w);ui.run('sound=false');ui.run('showRegion('+JSON.stringify(r.id)+')');assert.match(ui.node('#dialog-body').innerHTML,/События этого места/);assert.match(ui.node('#dialog-body').innerHTML,new RegExp(e.id));
  ui.run('showEvent('+JSON.stringify(e.id)+')');assert.match(ui.node('#dialog-body').innerHTML,/Сравнить срезы/);assert.match(ui.node('#dialog-body').innerHTML,/На карте/);
  ui.run('showEventComparison('+JSON.stringify(e.id)+','+JSON.stringify(r.id)+')');assert.match(ui.node('#dialog-body').innerHTML,/точный год 65/);assert.match(ui.node('#dialog-body').innerHTML,/Срез 50 года/);assert.match(ui.node('#dialog-body').innerHTML,/Срез 75 года/);assert.match(ui.node('#dialog-body').innerHTML,/не доказывает причину/);
  ui.run('showEventLocation('+JSON.stringify(e.id)+','+JSON.stringify(r.id)+')');assert.equal(ui.run('selectedRegion'),r.id);assert.equal(ui.run('displayed().year'),78);assert.match(ui.node('#map-legend').innerHTML,/Вернуться к событию/);assert.equal(JSON.stringify(w),before);
});
