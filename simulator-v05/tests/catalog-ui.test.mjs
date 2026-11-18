import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext, runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import * as Core from '../src/core.mjs';
import * as Storage from '../src/storage.mjs';
import * as Cloud from '../src/cloud.mjs';

const REQUESTED = '7b6a2345-1234-4234-8234-123456789abc';
const OTHER = '8b6a2345-1234-4234-8234-123456789abc';
const UPDATED = '2026-11-16T09:00:00.000Z';
const LAST_KEY = 'microgalaxy_geography_v05_last';
const API = '/api/v05/worlds';
const LEGACY = {v04: 'microgalaxy_history_v04_v1', v03: 'microgalaxy_local_candidate_v1', classic: 'microgalaxy-observatory-v1'};
const plain = value => JSON.parse(JSON.stringify(value));
const samples = new Map();
function sample(id = REQUESTED, year = 0) {
  const key = id + ':' + year;
  if (!samples.has(key)) {
    let w = Core.createWorld('catalog-v05-' + id);w.id = id;
    if (year) w = Core.advance(w, year).world;
    samples.set(key, w);
  }
  return Core.clone(samples.get(key));
}
function fakeDocument() {
  const nodes = new Map(), listeners = new Map();
  let document;
  const node = selector => {
    if (!nodes.has(selector)) {const classes=new Set();nodes.set(selector, {
      id: selector.startsWith('#') ? selector.slice(1) : '', tagName: 'DIV', dataset: {}, style: {}, hidden: false,
      disabled: false, open: false, value: '', textContent: '', innerHTML: '', isConnected: true,
      classList: {toggle(name,force) {const next=force===undefined?!classes.has(name):!!force;if(next)classes.add(name);else classes.delete(name);return next;}, add(name) {classes.add(name);}, remove(name) {classes.delete(name);}, contains(name) {return classes.has(name);}}, setAttribute() {}, removeAttribute() {},
      before(child) {nodes.set('#'+child.id,child);},
      addEventListener() {}, removeEventListener() {}, getClientRects() {return [{}];},
      close() {this.open = false;}, showModal() {this.open = true;}, focus() {document.activeElement = this;},
      setSelectionRange() {}, querySelector: node, querySelectorAll() {return [];},
    });}
    return nodes.get(selector);
  };
  const body = node('body');body.tagName = 'BODY';
  document = {body, activeElement: body, hidden: false, querySelector(selector) {return selector==='#mobile-inspector-summary'&&!nodes.has(selector)?null:node(selector);}, createElement() {return node('created-'+nodes.size);}, querySelectorAll() {return [];},
    addEventListener(name, fn) {if (!listeners.has(name)) listeners.set(name, []);listeners.get(name).push(fn);}, removeEventListener() {}};
  return {document, node, listeners};
}
function trackedIndexedDB(factory, calls, listing = 'available') {
  const facade = {
    open(...args) {
      calls.dbOpens.push(args);
      const req = factory.open(...args);
      req.addEventListener('upgradeneeded', () => calls.upgrades++);
      req.addEventListener('success', () => {
        const db = req.result, transaction = db.transaction.bind(db);
        db.transaction = (...parameters) => {calls.transactions.push({name: db.name, mode: parameters[1] ?? 'readonly'});return transaction(...parameters);};
      });
      return req;
    },
  };
  if (listing === 'available') facade.databases = () => factory.databases();
  if (listing === 'rejected') facade.databases = () => Promise.reject(new Error('Database enumeration unavailable'));
  return facade;
}
async function seedDatabase(factory, name, records, {version = 1, keyPath = 'id', createStore = true} = {}) {
  const db = await new Promise((resolve, reject) => {
    const req = factory.open(name, version);
    req.onupgradeneeded = () => {if (createStore) req.result.createObjectStore('worlds', {keyPath});};
    req.onsuccess = () => resolve(req.result);req.onerror = () => reject(req.error);
  });
  if (records.length) await new Promise((resolve, reject) => {
    const tx = db.transaction('worlds', 'readwrite');
    for (const record of records) tx.objectStore('worlds').put(structuredClone(record));
    tx.oncomplete = resolve;tx.onerror = () => reject(tx.error);tx.onabort = () => reject(tx.error);
  });
  db.close();
}
async function databaseRecords(factory, name) {
  const db = await new Promise((resolve, reject) => {const req = factory.open(name);req.onsuccess = () => resolve(req.result);req.onerror = () => reject(req.error);});
  const version = db.version;
  const records = db.objectStoreNames.contains('worlds') ? await new Promise((resolve, reject) => {
    const req = db.transaction('worlds', 'readonly').objectStore('worlds').getAll();req.onsuccess = () => resolve(req.result);req.onerror = () => reject(req.error);
  }) : [];
  db.close();return {version, records};
}
function legacyRecord(model, id = REQUESTED, year = 10, clean = true) {
  const world = {id, name: 'Мир ' + model, seed: 'seed-' + model, year};
  return model === 'classic' ? {world, revision: 1, syncedYear: clean ? year : -1, updatedAt: UPDATED}
    : {id, world, name: world.name, seed: world.seed, year, revision: 1, cloud: clean ? {revision: 1, syncedRevision: 1, updatedAt: UPDATED} : null, updatedAt: UPDATED};
}

/**
 * Execute the complete, real UI script. Only the unique boot call is assigned
 * to an awaitable promise and existing lexical helpers are exposed to tests.
 * Core validation/storage/cloud request logic stay real. DOM, renderer, timers
 * and HTTP are isolated; fake IndexedDB is used only for legacy read-only tests.
 */
async function boot({search = '', locals = [], remote = [], last = OTHER, rawLocal, localReadError,
  cloudError, storageError = false, catalog = [], catalogStatus = 200, catalogError,
  idbFactory, databaseListing = 'available'} = {}) {
  const calls = {created: 0, localList: 0, localGet: [], put: 0, receive: 0, sync: 0, fetch: [], dbOpens: [], upgrades: 0, transactions: [], history: []};
  const backend = Storage.memoryWorldStore();
  for (const item of locals) {
    if (item.clean) await backend.receiveCloud(item.world, item.cloudRevision ?? 1, UPDATED, 0);
    else await backend.put(item.world, 0);
  }
  const records = async () => Promise.all((await backend.list()).map(row => backend.get(row.id)));
  const before = await records();
  const store = {...backend, persistent: true,
    async list() {calls.localList++;return backend.list();},
    async get(id) {
      calls.localGet.push(id);
      if (localReadError && id === REQUESTED) throw localReadError;
      const row = rawLocal?.has(id) ? structuredClone(rawLocal.get(id)) : await backend.get(id);
      if (row) Core.validateWorld(row.world); // IndexedDB get has this real validation.
      return row;
    },
    async put(...args) {calls.put++;return backend.put(...args);},
    async receiveCloud(...args) {calls.receive++;return backend.receiveCloud(...args);},
  };
  const {document, node, listeners} = fakeDocument(), preferences = new Map([[LAST_KEY, last]]);
  const response = (data, status = 200) => ({ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data)});
  const fetchImpl = async (path, options) => {
    calls.fetch.push({path, method: options?.method ?? 'GET'});
    if (path.startsWith('/api/world-catalog')) {
      if (catalogError) throw catalogError;
      return response(catalogStatus === 200 ? {worlds: catalog, nextCursor: null, hasMore: false} : {error: 'Catalogue unavailable'}, catalogStatus);
    }
    if (cloudError) throw cloudError;
    if (path === API) return response({worlds: remote.map(row => ({id: row.world.id, name: row.world.name, seed: row.world.seed, year: row.world.year, revision: row.revision ?? 1})), nextCursor: null});
    const id = decodeURIComponent(path.slice(API.length + 1)), row = remote.find(r => (r.requestId ?? r.world.id) === id);
    if (!row) return response({error: 'Выбранный мир не найден'}, 404);
    return response({world: row.world, revision: row.revision ?? 1, updatedAt: UPDATED});
  };
  const location = {href: 'https://microgalaxy.example/' + search, search, pathname: '/', hash: '', assign(path) {calls.navigation=path;}};
  const context = createContext({
    document, window: {location, addEventListener() {}, history: {replaceState(_state, _title, path) {calls.history.push(path);const url = new URL(path, location.href);Object.assign(location, {href: url.href, pathname: url.pathname, search: url.search, hash: url.hash});}}},
    URL, URLSearchParams, crypto: webcrypto, TextEncoder, TextDecoder, AbortController, fetch: fetchImpl,
    ...(idbFactory ? {indexedDB: trackedIndexedDB(idbFactory, calls, databaseListing)} : {}),
    localStorage: {getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value)},
    setTimeout: (fn,ms) => ms===0?setImmediate(fn):1, clearTimeout(id) {if(id!==1)clearImmediate(id);}, setInterval: () => 1, clearInterval() {},
    Core: {...Core, createWorld(...args) {calls.created++;return Core.createWorld(...args);}},
    Storage: {...Storage, async openWorldStore() {if (storageError) throw new Error('IndexedDB blocked');return store;}, memoryWorldStore: () => ({...store, persistent: false})},
    Cloud: {...Cloud, createCloudClient: options => Cloud.createCloudClient({...options, fetchImpl}), createCloudSync: () => ({sync() {calls.sync++;throw new Error('Unexpected background sync in boot test');}})},
    Renderer: class {update() {} reset() {} focusSociety() {} focusRegion() {}},
  });
  const source = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8'), entry = 'boot().catch(error=>';
  assert.equal(source.split(entry).length, 2, 'One identifiable boot entry is required; no boot implementation is copied into tests');
  runInContext(source.replace(entry, 'globalThis.__bootPromise=boot().catch(error=>') + `
    globalThis.__uiTest={state:()=>({world,revision,currentRecord,switching,running,cloudState,catalogState,catalogIssue,legacyLocalIssue}),
      catalogRows,catalogMetadata,modelPath,readLegacyDatabase,readLegacyCatalog,worldDialog,renderCatalogList,
      setCatalogFilter:(model,query='')=>{catalogModel=model;catalogQuery=query;renderCatalogList();}, markDirty:()=>{localUnsaved=true;changeGeneration++;}};`, context, {filename: 'simulator-v05/src/ui.js', timeout: 3000});
  await context.__bootPromise;
  await new Promise(resolve => setImmediate(resolve)); // Drain resolved background reads, not real timers.
  return {ui: context.__uiTest, state: context.__uiTest.state(), calls, before, after: await records(), node, preferences,
    notice: node('#notice-text').textContent, dialog: node('#dialog').open, dialogTitle: node('#dialog-title').textContent, dialogBody: node('#dialog-body').innerHTML,
    async click(target) {for (const fn of listeners.get('click') ?? []) await fn({target, preventDefault() {}});}};
}
function noFallback(result) {
  assert.equal(result.state.world, undefined, 'Explicit failed selection must not open a different world');
  assert.equal(result.calls.created, 0, 'Explicit failed selection must not create a random world');
  assert.equal(result.calls.localList, 0, 'Explicit selection must not search local first/last records');
  assert.ok(result.calls.fetch.every(c => c.path !== API), 'Explicit selection must not list remote first/last records');
  assert.equal(result.calls.put, 0);assert.equal(result.state.running, false);assert.equal(result.state.switching, false);
  assert.deepEqual(result.after, result.before, 'Failed opening must preserve existing histories');
}

test('v05 explicit local UUID wins over last-used/first records and rewrites URL to the actual world', async () => {
  const r = await boot({search: `?world=${REQUESTED}&source=local`, locals: [{world: sample(OTHER)}, {world: sample()}]});
  assert.equal(r.state.world.id, REQUESTED);assert.equal(r.calls.created, 0);assert.equal(r.calls.localList, 0);assert.equal(r.calls.fetch.length, 0);
  assert.equal(r.preferences.get(LAST_KEY), REQUESTED);assert.deepEqual(r.after, r.before);
  assert.equal(r.calls.history.at(-1), '/?world=' + REQUESTED);
});
test('v05 explicit auto/omitted source keeps the selected local history without background cloud substitution', async () => {
  for (const suffix of ['', '&source=auto']) {
    const r = await boot({search: '?world=' + REQUESTED + suffix, locals: [{world: sample(), clean: true}], remote: [{world: sample(REQUESTED, 5), revision: 2}]});
    assert.equal(r.state.world.id, REQUESTED);assert.equal(r.state.world.year, 0);
    assert.equal(r.calls.fetch.length, 0);assert.equal(r.calls.created, 0);assert.deepEqual(r.after, r.before);
  }
});
test('v05 auto retrieves only the requested cloud world when its local copy is absent', async () => {
  const r = await boot({search: `?world=${REQUESTED}&source=auto`, locals: [{world: sample(OTHER)}], remote: [{world: sample(OTHER)}, {world: sample()}]});
  assert.equal(r.state.world.id, REQUESTED);assert.equal(r.calls.created, 0);assert.equal(r.calls.localList, 0);assert.equal(r.calls.receive, 1);
  assert.deepEqual(r.calls.fetch, [{path: API + '/' + REQUESTED, method: 'GET'}]);
});
test('v05 cloud source reads exact remote ID and can advance a clean local receipt', async () => {
  const r = await boot({search: `?world=${REQUESTED}&source=cloud`, locals: [{world: sample(), clean: true}], remote: [{world: sample(REQUESTED, 5), revision: 2}]});
  assert.equal(r.state.world.id, REQUESTED);assert.equal(r.state.world.year, 5);assert.equal(r.calls.created, 0);
  assert.deepEqual(r.calls.fetch, [{path: API + '/' + REQUESTED, method: 'GET'}]);
});
test('v05 local-only missing world never tries cloud or another local record', async () => {
  const r = await boot({search: `?world=${REQUESTED}&source=local`, locals: [{world: sample(OTHER)}], remote: [{world: sample()}]});
  noFallback(r);assert.equal(r.calls.fetch.length, 0);assert.match(r.node('#page-content').innerHTML, /Запрошенный мир не открыт/);
});
test('v05 missing or offline remote explicit selection never falls back to local or random', async () => {
  for (const source of ['auto', 'cloud']) {
    const r = await boot({search: `?world=${REQUESTED}&source=${source}`, locals: [{world: sample(OTHER)}], remote: [{world: sample(OTHER)}]});
    noFallback(r);assert.equal(r.calls.fetch.length, 1);
  }
  const offline = await boot({search: `?world=${REQUESTED}&source=cloud`, locals: [{world: sample(), clean: true}], cloudError: new Error('Offline')});
  noFallback(offline);assert.match(offline.notice, /Offline/);
});
test('v05 empty, invalid, path-like and unknown-source selectors remain explicit errors', async () => {
  for (const search of ['?world=', '?world=not-a-uuid', `?world=${REQUESTED}&source=`, `?world=${REQUESTED}&source=unknown`, `?world=${encodeURIComponent('../' + REQUESTED)}&source=cloud`]) {
    const r = await boot({search, locals: [{world: sample(OTHER)}]});
    noFallback(r);assert.equal(r.calls.fetch.length, 0);assert.match(r.node('#page-content').innerHTML, /неверн|Неверн|пуст/);
  }
});
test('v05 local-prefixed UUID remains a valid selector', async () => {
  const id = 'local-' + REQUESTED, r = await boot({search: `?world=${id}&source=local`, locals: [{world: sample(id)}]});
  assert.equal(r.state.world.id, id);assert.equal(r.calls.created, 0);assert.equal(r.calls.fetch.length, 0);
});
test('v05 corrupt selected local payload or mismatched UUID is rejected without fallback', async () => {
  const corrupt = sample();corrupt.year = -1;
  for (const world of [corrupt, sample(OTHER)]) {
    const r = await boot({search: `?world=${REQUESTED}&source=local`, rawLocal: new Map([[REQUESTED, {id: REQUESTED, world, revision: 1}]])});
    noFallback(r);assert.equal(r.calls.fetch.length, 0);
  }
});
test('v05 corrupt or substituted remote snapshot is rejected before local writes', async () => {
  const corrupt = sample();corrupt.year = -1;
  for (const world of [corrupt, sample(OTHER)]) {
    const r = await boot({search: `?world=${REQUESTED}&source=cloud`, remote: [{requestId: REQUESTED, world}]});
    noFallback(r);assert.equal(r.calls.receive, 0);
  }
});
test('v05 explicit cloud/local divergence opens a choice and does not overwrite the local history', async () => {
  const r = await boot({search: `?world=${REQUESTED}&source=cloud`, locals: [{world: sample()}], remote: [{world: sample(REQUESTED, 5), revision: 2}]});
  noFallback(r);assert.equal(r.dialog, true);assert.match(r.dialogTitle, /Две сохранённые истории/);
  assert.ok(r.dialogBody.includes('data-copy-cloud="' + REQUESTED + '"'));
});
test('v05 good remote plus unreadable/mismatched local record offers a separate copy without replacing it', async () => {
  const corrupt = sample();corrupt.year = -1;
  for (const options of [
    {rawLocal: new Map([[REQUESTED, {id: REQUESTED, world: corrupt, revision: 1}]])},
    {rawLocal: new Map([[REQUESTED, {id: REQUESTED, world: sample(OTHER), revision: 1}]])},
    {localReadError: new Error('Local read failed')},
  ]) {
    const before = options.rawLocal ? structuredClone(options.rawLocal) : null;
    const r = await boot({search: `?world=${REQUESTED}&source=cloud`, remote: [{world: sample()}], ...options});
    noFallback(r);assert.equal(r.calls.receive, 0);assert.equal(r.dialog, true);
    assert.ok(r.dialogBody.includes('data-copy-cloud="' + REQUESTED + '"'));
    if (before) assert.deepEqual(options.rawLocal, before);
  }
});
test('v05 blocked IndexedDB preserves explicit-source semantics and supports cloud into session memory', async () => {
  const local = await boot({search: `?world=${REQUESTED}&source=local`, storageError: true});noFallback(local);
  const cloud = await boot({search: `?world=${REQUESTED}&source=cloud`, storageError: true, remote: [{world: sample()}]});
  assert.equal(cloud.state.world.id, REQUESTED);assert.equal(cloud.calls.created, 0);assert.match(cloud.notice, /Постоянное хранилище недоступно/);
});
test('v05 only ordinary empty boot creates a random world; archive-only entry does not', async () => {
  const ordinary = await boot({last:null}), another = await boot({last:null});
  assert.equal(ordinary.calls.created, 1);assert.equal(ordinary.calls.put, 1);
  assert.match(ordinary.state.world.id, /^local-/);assert.match(ordinary.state.world.seed, /^MG-/);
  assert.notEqual(ordinary.state.world.seed, another.state.world.seed);
  const archive = await boot({search: '?archive=1',last:null});
  assert.equal(archive.state.world, undefined);assert.equal(archive.calls.created, 0);assert.equal(archive.calls.put, 0);
  assert.equal(archive.dialogTitle, 'Мои миры');assert.ok(archive.calls.fetch.every(call => call.path !== API));
});
test('v05 ordinary boot restores remembered local world without creating another history', async () => {
  const r = await boot({locals: [{world: sample()}, {world: sample(OTHER)}], last: OTHER});
  assert.equal(r.state.world.id, OTHER);assert.equal(r.calls.created, 0);assert.equal(r.calls.localList, 0);
});
test('stale remembered id does not select a different world or create a new one', async () => {
  const r=await boot({last:OTHER,locals:[{world:sample()}]});
  assert.equal(r.state.world,undefined);assert.equal(r.calls.created,0);assert.equal(r.calls.put,0);assert.equal(r.calls.localList,0);assert.deepEqual(r.after,r.before);
  assert.match(r.node('#page-content').innerHTML,/не открыт/);
});

test('unified catalogue keeps same UUID in different models distinct and explicit local/cloud choices', async () => {
  const factory = new IDBFactory();
  for (const model of ['v04', 'v03']) await seedDatabase(factory, LEGACY[model], [legacyRecord(model)]);
  await seedDatabase(factory, LEGACY.classic, [legacyRecord('classic', OTHER)], {keyPath: 'world.id'});
  const catalog = [
    {model: 'v05', id: REQUESTED, name: 'New cloud', seed: 'new', year: 0, revision: 1, updatedAt: UPDATED},
    {model: 'v04', id: REQUESTED, name: 'Old cloud 04', seed: 'old04', year: 25, revision: 2, updatedAt: UPDATED},
    {model: 'v03', id: REQUESTED, name: 'Old cloud 03', seed: 'old03', year: 10, revision: 1, updatedAt: UPDATED},
    {model: 'classic', id: REQUESTED, name: 'Classic cloud', seed: 'classic', year: 10, revision: 1, updatedAt: UPDATED},
  ];
  const r = await boot({search: '?archive=1', locals: [{world: sample()}], catalog, idbFactory: factory});
  const rows = plain(r.ui.catalogRows());
  assert.equal(rows.length, 5);assert.equal(new Set(rows.map(row => row.key)).size, 5);
  assert.ok(rows.some(row => row.key === 'v05:' + REQUESTED && row.local && row.remote));
  assert.ok(rows.some(row => row.key === 'v04:' + REQUESTED && row.local && row.remote));
  const html = r.node('#catalog-list').innerHTML;
  for (const model of ['v05', 'v04', 'v03', 'classic']) assert.ok(html.includes('data-catalog-open="' + model + '"'));
  assert.match(html, /Местная версия/);assert.match(html, /Облачная версия/);
  assert.ok(html.includes('href="/v04?world=' + REQUESTED + '&amp;source=cloud"'));
  assert.ok(html.includes('href="/v03?world=' + REQUESTED + '&amp;source=local"'));
  assert.ok(html.includes('href="/classic?world=' + REQUESTED + '&amp;source=cloud"'));
  assert.ok(html.includes('Модель 0.1–0.2'));
  r.ui.setCatalogFilter('legacy');assert.ok(!r.node('#catalog-list').innerHTML.includes('data-catalog-open="v05"'));
  r.ui.setCatalogFilter('v04');assert.match(r.node('#catalog-count').textContent, /^1 миров/);
  r.ui.setCatalogFilter('all', 'nothing-matches');assert.match(r.node('#catalog-count').textContent, /^0 миров/);
});
test('unavailable cloud catalogue does not claim sync or hide readable local worlds', async () => {
  const r = await boot({search: '?archive=1', locals: [{world: sample()}], catalogStatus: 401});
  assert.equal(r.state.catalogState, 'unauthorized');assert.match(r.dialogBody, /нужен вход/);
  assert.equal(r.ui.catalogRows().length, 1);assert.ok(r.node('#catalog-list').innerHTML.includes('data-source="local"'));
  assert.ok(!r.node('#catalog-list').innerHTML.includes('На устройстве и в облаке'));assert.equal(r.calls.created, 0);
});
test('old catalog links to the complete 0.6 catalog after saving a dirty world', async () => {
  const r=await boot({search:'?archive=1',locals:[{world:sample()}],last:REQUESTED});
  assert.match(r.dialogBody,/Общий каталог 0\.6/);
  r.ui.markDirty();
  await r.click({closest(selector){return selector==='[data-version-link]'?{dataset:{versionLink:'/v06?archive=1'}}:null;}});
  assert.equal(r.calls.put,1);
  assert.equal(r.calls.navigation,'/v06?archive=1');
});
test('catalogue display escapes untrusted names and rejects unknown model routes', async () => {
  const r = await boot({search: '?archive=1', catalog: [{model: 'v04', id: REQUESTED, name: '<script>attack</script>', seed: '"<unsafe>', year: 1, revision: 1}]});
  assert.ok(!r.node('#catalog-list').innerHTML.includes('<script>'));
  assert.ok(r.node('#catalog-list').innerHTML.includes('&lt;script&gt;'));
  assert.throws(() => r.ui.modelPath('unknown', REQUESTED));
  assert.doesNotThrow(() => r.ui.catalogMetadata('classic', {id: OTHER, year: 2}));
});
test('legacy database enumeration skips missing DBs instead of opening/creating them', async () => {
  const factory = new IDBFactory(), r = await boot({search: '?world=', idbFactory: factory});
  assert.deepEqual(plain(await r.ui.readLegacyCatalog()), []);
  assert.equal(r.calls.dbOpens.length, 0);assert.deepEqual(await factory.databases(), []);
});
test('legacy fallback without enumeration aborts upgrades and does not create empty databases', async () => {
  for (const databaseListing of ['missing', 'rejected']) {
    const factory = new IDBFactory(), r = await boot({search: '?world=', idbFactory: factory, databaseListing});
    assert.deepEqual(plain(await r.ui.readLegacyCatalog()), []);
    assert.equal(r.calls.dbOpens.length, 4);assert.equal(r.calls.upgrades, 4);
    assert.ok(r.calls.dbOpens.every(args => args.length === 1), 'no version request may upgrade an existing database');
    assert.deepEqual(await factory.databases(), []);assert.deepEqual(r.calls.transactions, []);
  }
});
test('legacy databases are cursor-readonly, preserve version/data, and are not imported into v05', async () => {
  const factory = new IDBFactory(), expected = new Map();
  for (const [model, name] of Object.entries(LEGACY)) {
    await seedDatabase(factory, name, [legacyRecord(model)], {version: 7, keyPath: model === 'classic' ? 'world.id' : 'id'});
    expected.set(name, await databaseRecords(factory, name));
  }
  const r = await boot({search: '?world=', idbFactory: factory}), rows = plain(await r.ui.readLegacyCatalog());
  assert.deepEqual(rows.map(row => row.model).sort(), ['classic', 'v03', 'v04']);
  assert.equal(r.calls.transactions.length, 3);assert.ok(r.calls.transactions.every(tx => tx.mode === 'readonly'));
  assert.equal(r.calls.upgrades, 0);assert.equal(r.calls.put, 0);assert.equal(r.calls.receive, 0);
  assert.ok(r.calls.dbOpens.every(args => args.length === 1));
  for (const [name, before] of expected) assert.deepEqual(await databaseRecords(factory, name), before);
});
test('existing legacy DB without worlds store is skipped without schema repair', async () => {
  const factory = new IDBFactory();await seedDatabase(factory, LEGACY.v04, [], {version: 3, createStore: false});
  const before = await databaseRecords(factory, LEGACY.v04), r = await boot({search: '?world=', idbFactory: factory});
  assert.deepEqual(plain(await r.ui.readLegacyCatalog()), []);assert.equal(r.calls.transactions.length, 0);assert.equal(r.calls.upgrades, 0);
  assert.deepEqual(await databaseRecords(factory, LEGACY.v04), before);
});
