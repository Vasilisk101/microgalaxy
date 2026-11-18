import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Core from '../src/core.mjs';
import * as PreviousCore from '../../simulator-v05/src/core.mjs';

const uiSource = fs.readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const rendererSource = fs.readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../src/index.template.html', import.meta.url), 'utf8');
const longWorld = Core.advance(Core.createWorld('ТУЛА-71'), 1000).world;
// This fixture deliberately exercises a known recorded movement; movement is not guaranteed for every 0.6 seed.
const movementWorld = PreviousCore.advance(PreviousCore.createWorld('ТУЛА-71'), 301).world;

function uiHarness(world) {
  const nodes = new Map(), listeners = new Map();
  let focused, flattenCalls = 0;
  function node(selector) {
    if (!nodes.has(selector)) {
      const listeners = new Map();
      const classes = new Set();
      nodes.set(selector, {
        innerHTML: '', textContent: '', value: '', hidden: false, open: false,
        isConnected: true, tagName: selector.includes('search') ? 'INPUT' : 'BUTTON',
        classList: {toggle(name, force) {const next=force===undefined?!classes.has(name):!!force;if(next)classes.add(name);else classes.delete(name);return next;}, add(name) {classes.add(name);}, remove(name) {classes.delete(name);}, contains(name) {return classes.has(name);}},
        before(child) {nodes.set('#'+child.id,child);},
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
    Core: {...Core, allEvents(...args) {flattenCalls++; return Core.allEvents(...args);}},
    Storage: {isCloudDirty() {return true;}}, Cloud: {createCloudClient() {return {};}},
    Renderer: class {update() {} focusSociety() {} focusRegion() {} reset() {}},
    document: {querySelector(selector) {return selector==='#mobile-inspector-summary'&&!nodes.has(selector)?null:node(selector);}, createElement() {return node('created-'+nodes.size);}, querySelectorAll() {return [];}, get activeElement() {return focused;}, addEventListener(type,fn) {listeners.set(type,fn);}},
    window: {addEventListener() {}}, localStorage: {getItem() {return null;}, setItem() {}},
    clearTimeout() {}, setTimeout() {}, setInterval() {}, console, URL, URLSearchParams,
    crypto: globalThis.crypto, fixture: world,
  };
  vm.createContext(context);
  vm.runInContext(uiSource.replace(/boot\(\)\.catch\([\s\S]*$/, ''), context);
  vm.runInContext('world=fixture;store={persistent:true};selectedPlanet=world.planets.find(p=>p.home).id;', context);
  return {node, run: code => vm.runInContext(code, context), change:(id,value)=>listeners.get('change')({target:{id,value}}), flattenCalls: () => flattenCalls};
}

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
  assert.match(uiSource,/document\.hidden\)\{setRunning\(false\)/);
  assert.match(uiSource,/target\.closest\('input,select,textarea,button,a,summary/);
  assert.match(template,/id="cycle-speed"/);
});

test('all eight views render against the real v05 model without mutating it', () => {
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
