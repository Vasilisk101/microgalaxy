import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext, runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as core03 from '../../simulator-v03/src/core.mjs';
import * as core04 from '../../simulator-v04/src/core.mjs';
import * as storage03 from '../../simulator-v03/src/storage.mjs';
import * as storage04 from '../../simulator-v04/src/storage.mjs';
import * as cloud03 from '../../simulator-v03/src/cloud.mjs';
import * as cloud04 from '../../simulator-v04/src/cloud.mjs';

const REQUESTED='7b6a2345-1234-4234-8234-123456789abc';
const OTHER='8b6a2345-1234-4234-8234-123456789abc';
const UPDATED='2026-11-16T09:00:00.000Z';
const versions=[
  {name:'0.3',folder:'simulator-v03',core:core03,storage:storage03,cloud:cloud03,lastKey:'microgalaxy_local_candidate_last',api:'/api/v03/worlds'},
  {name:'0.4',folder:'simulator-v04',core:core04,storage:storage04,cloud:cloud04,lastKey:'microgalaxy_history_v04_last',api:'/api/v04/worlds'},
];

function sample(version,id=REQUESTED,year=0){
  let world=version.core.createWorld('legacy-catalog-'+id);
  world.id=id;
  if(year)world=version.core.advance(world,year).world;
  return world;
}

function fakeDocument(){
  const nodes=new Map();
  function node(selector){
    if(!nodes.has(selector))nodes.set(selector,{
      tagName:'DIV',dataset:{},style:{},hidden:false,disabled:false,open:false,value:'',textContent:'',innerHTML:'',isConnected:true,
      classList:{toggle(){},add(){},remove(){}},setAttribute(){},removeAttribute(){},addEventListener(){},removeEventListener(){},
      close(){this.open=false;},showModal(){this.open=true;},focus(){},getClientRects(){return [{}];},
      querySelector:node,querySelectorAll(){return [];},
    });
    return nodes.get(selector);
  }
  const body=node('body');body.tagName='BODY';
  return {nodes,node,document:{querySelector:node,querySelectorAll(){return [];},addEventListener(){},removeEventListener(){},body,activeElement:body,hidden:false}};
}

/**
 * Execute the complete legacy UI, not an extracted/reimplemented boot branch.
 * Only its unique top-level entry call gets a promise assignment so the test
 * can await completion. Source helpers, validation and storage conflict rules
 * stay real; DOM/renderer, timers, persistence adapter and HTTP transport are
 * isolated from the machine and network. Timers never fire in these boot tests.
 */
async function boot(version,{search='',locals=[],remote=[],last=OTHER,rawLocal,localReadError,cloudError,status=200,storageError=false}={}){
  const calls={created:0,localGet:[],localList:0,put:0,receive:0,fetch:[],sync:0};
  const backend=version.storage.memoryWorldStore();
  for(const item of locals){
    if(item.clean)await backend.receiveCloud(item.world,item.cloudRevision??1,UPDATED,0);
    else await backend.put(item.world,0);
  }
  const before=await Promise.all((await backend.list()).map(row=>backend.get(row.id)));
  const store={
    ...backend,persistent:true,
    async list(){calls.localList++;return backend.list();},
    async get(id){
      calls.localGet.push(id);
      if(localReadError&&id===REQUESTED)throw localReadError;
      const record=rawLocal?.has(id)?structuredClone(rawLocal.get(id)):await backend.get(id);
      if(record)version.core.validateWorld(record.world); // Same check as IndexedDB's get.
      return record;
    },
    async put(...args){calls.put++;return backend.put(...args);},
    async receiveCloud(...args){calls.receive++;return backend.receiveCloud(...args);},
  };
  const memory={...store,persistent:false};
  const {document,node}=fakeDocument();
  const preferences=new Map([[version.lastKey,last]]);
  const response=data=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)});
  const fetchImpl=async(path,options)=>{
    calls.fetch.push({path,method:options?.method??'GET'});
    if(cloudError)throw cloudError;
    if(path===version.api)return response({worlds:remote.map(record=>({id:record.world.id,name:record.world.name,seed:record.world.seed,year:record.world.year,revision:record.revision??1})),nextCursor:null});
    const record=remote.find(row=>(row.requestId??row.world.id)===decodeURIComponent(path.slice(version.api.length+1)));
    if(!record)return {ok:false,status:404,text:async()=>JSON.stringify({error:'Выбранный мир не найден'})};
    return response({world:record.world,revision:record.revision??1,updatedAt:UPDATED});
  };
  const context=createContext({
    document,window:{location:{search},addEventListener(){}},URLSearchParams,crypto:webcrypto,TextEncoder,TextDecoder,
    localStorage:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,value)},
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    Core:{...version.core,createWorld(...args){calls.created++;return version.core.createWorld(...args);}},
    Storage:{...version.storage,async openWorldStore(){if(storageError)throw new Error('IndexedDB blocked');return store;},memoryWorldStore:()=>memory},
    Cloud:{...version.cloud,createCloudClient:options=>version.cloud.createCloudClient({...options,fetchImpl}),createCloudSync:()=>({sync(){calls.sync++;throw new Error('Background sync must not run during boot');}})},
    Renderer:class{update(){}reset(){}focusSociety(){}},
  });
  const source=await readFile(new URL(`../../${version.folder}/src/ui.js`,import.meta.url),'utf8');
  const entry='boot().catch(error=>';
  assert.equal(source.split(entry).length,2,'UI must have one identifiable boot entry, not an extracted boot implementation');
  const instrumented=source.replace(entry,'globalThis.__bootPromise=boot().catch(error=>')+
    '\nglobalThis.__inspect=()=>({world,revision,currentRecord,switching,running,cloudState});';
  runInContext(instrumented,context,{filename:`${version.folder}/src/ui.js`,timeout:3000});
  await context.__bootPromise;
  const state=context.__inspect();
  const after=await Promise.all((await backend.list()).map(row=>backend.get(row.id)));
  return {state,calls,before,after,notice:node('#notice-text').textContent,dialog:node('#dialog').open,dialogTitle:node('#dialog-title').textContent,dialogBody:node('#dialog-body').innerHTML,preferences};
}

function noFallback(result,{unchanged=true}={}){
  assert.equal(result.state.world,undefined,'An explicitly chosen failed world must not open another world');
  assert.equal(result.calls.created,0,'An explicitly chosen failed world must not create a random world');
  assert.equal(result.calls.localList,0,'Explicit selection must not search the first local record');
  assert.ok(result.calls.fetch.every(call=>!call.path.endsWith('/worlds')),'Explicit selection must not search the first cloud record');
  assert.equal(result.calls.put,0,'Boot failure must not write a new local world');
  assert.equal(result.state.running,false);
  assert.equal(result.state.switching,false);
  if(unchanged)assert.deepEqual(result.after,result.before,'Failure must preserve local histories');
}

for(const version of versions){
  test(`${version.name}: explicit local UUID wins over last-used and first records`,async()=>{
    const chosen=sample(version),other=sample(version,OTHER);
    const r=await boot(version,{search:`?world=${REQUESTED}&source=local`,locals:[{world:other},{world:chosen}]});
    assert.equal(r.state.world.id,REQUESTED);
    assert.equal(r.state.world.seed,chosen.seed);
    assert.equal(r.calls.localList,0);assert.equal(r.calls.fetch.length,0);assert.equal(r.calls.created,0);
    assert.equal(r.preferences.get(version.lastKey),REQUESTED);
    assert.deepEqual(r.after,r.before);
  });

  test(`${version.name}: auto and omitted source use the selected local history without cloud replacement`,async()=>{
    for(const suffix of ['','&source=auto']){
      const r=await boot(version,{search:`?world=${REQUESTED}${suffix}`,locals:[{world:sample(version,OTHER)},{world:sample(version)}],remote:[{world:sample(version,REQUESTED,5)}]});
      assert.equal(r.state.world.id,REQUESTED);assert.equal(r.state.world.year,0);
      assert.equal(r.calls.fetch.length,0);assert.equal(r.calls.created,0);assert.deepEqual(r.after,r.before);
    }
  });

  test(`${version.name}: auto retrieves only the requested cloud UUID if its local copy is absent`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=auto`,locals:[{world:sample(version,OTHER)}],remote:[{world:sample(version,OTHER)},{world:sample(version)}]});
    assert.equal(r.state.world.id,REQUESTED);
    assert.deepEqual(r.calls.fetch,[{path:version.api+'/'+REQUESTED,method:'GET'}]);
    assert.equal(r.calls.created,0);assert.equal(r.calls.localList,0);assert.equal(r.calls.receive,1);
  });

  test(`${version.name}: cloud source requests the exact remote history even when a clean local copy exists`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,locals:[{world:sample(version),clean:true}],remote:[{world:sample(version,REQUESTED,5),revision:2}]});
    assert.equal(r.state.world.id,REQUESTED);assert.equal(r.state.world.year,5);
    assert.deepEqual(r.calls.fetch,[{path:version.api+'/'+REQUESTED,method:'GET'}]);
    assert.equal(r.calls.created,0);assert.equal(r.calls.localList,0);
  });

  test(`${version.name}: local-only missing UUID never consults cloud or opens another local record`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=local`,locals:[{world:sample(version,OTHER)}],remote:[{world:sample(version)}]});
    noFallback(r);assert.equal(r.calls.fetch.length,0);assert.match(r.notice,/нет на этом устройстве/);
  });

  test(`${version.name}: missing remote UUID never opens the first local or cloud world`,async()=>{
    for(const source of ['auto','cloud']){
      const r=await boot(version,{search:`?world=${REQUESTED}&source=${source}`,locals:[{world:sample(version,OTHER)}],remote:[{world:sample(version,OTHER)}]});
      noFallback(r);assert.equal(r.calls.fetch.length,1);assert.match(r.notice,/не найден/);
    }
  });

  test(`${version.name}: explicit cloud failure does not silently select even the same UUID locally`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,locals:[{world:sample(version),clean:true}],cloudError:new Error('Offline')});
    noFallback(r);assert.match(r.notice,/Offline/);
  });

  test(`${version.name}: corrupt selected local payload is rejected without random or first-record fallback`,async()=>{
    const corrupt=sample(version);corrupt.year=-1;
    for(const source of ['local','auto']){
      const r=await boot(version,{search:`?world=${REQUESTED}&source=${source}`,locals:[{world:sample(version,OTHER)}],rawLocal:new Map([[REQUESTED,{id:REQUESTED,world:corrupt,revision:1}]])});
      noFallback(r);assert.equal(r.calls.fetch.length,0);assert.match(r.notice,/Не удалось открыть/);
    }
  });

  test(`${version.name}: local payload UUID must equal the explicitly requested record key`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=local`,rawLocal:new Map([[REQUESTED,{id:REQUESTED,world:sample(version,OTHER),revision:1}]])});
    noFallback(r);assert.equal(r.calls.fetch.length,0);assert.match(r.notice,/Не удалось открыть/);
  });

  test(`${version.name}: corrupt remote snapshot is rejected before local writes`,async()=>{
    const corrupt=sample(version);corrupt.year=-1;
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,locals:[{world:sample(version,OTHER)}],remote:[{world:corrupt}]});
    noFallback(r);assert.equal(r.calls.receive,0);assert.match(r.notice,/Не удалось открыть/);
  });

  test(`${version.name}: cloud response cannot substitute another valid UUID`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,remote:[{requestId:REQUESTED,world:sample(version,OTHER)}]});
    noFallback(r);assert.equal(r.calls.receive,0);assert.match(r.notice,/проверить облачное сохранение/);
  });

  test(`${version.name}: invalid, empty and malformed selector values are errors rather than default boot`,async()=>{
    for(const search of ['?world=','?world=not-a-uuid',`?world=${REQUESTED}&source=unknown`,`?world=${REQUESTED}&source=`,`?world=${encodeURIComponent('../'+REQUESTED)}&source=cloud`]){
      const r=await boot(version,{search,locals:[{world:sample(version,OTHER)}]});
      noFallback(r);assert.equal(r.calls.fetch.length,0);assert.match(r.notice,/Неверная ссылка/);
    }
  });

  test(`${version.name}: local-prefixed UUID remains a valid explicit selector`,async()=>{
    const id='local-'+REQUESTED;
    const r=await boot(version,{search:`?world=${id}&source=local`,locals:[{world:sample(version,id)}]});
    assert.equal(r.state.world.id,id);assert.equal(r.calls.created,0);assert.equal(r.calls.fetch.length,0);
  });

  test(`${version.name}: blocked IndexedDB cannot turn an explicit missing local world into a fresh world`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=local`,storageError:true});
    noFallback(r);assert.equal(r.calls.fetch.length,0);
  });

  test(`${version.name}: explicit cloud world can open into session-only storage after IndexedDB failure`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,storageError:true,remote:[{world:sample(version)}]});
    assert.equal(r.state.world.id,REQUESTED);assert.equal(r.calls.created,0);
    assert.match(r.notice,/Постоянное хранилище недоступно/);
  });

  test(`${version.name}: conflicting cloud/local histories require choice and do not get overwritten at boot`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,locals:[{world:sample(version)}],remote:[{world:sample(version,REQUESTED,5),revision:2}]});
    noFallback(r);assert.equal(r.dialog,true);assert.match(r.dialogTitle,/Две сохранённые истории/);
    assert.equal(r.calls.receive,1);
  });

  test(`${version.name}: valid cloud plus corrupt local payload offers a separate copy without replacing the original`,async()=>{
    const corrupt=sample(version);corrupt.year=-1;
    const rawLocal=new Map([[REQUESTED,{id:REQUESTED,world:corrupt,revision:1}]]);
    const original=structuredClone(rawLocal);
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,rawLocal,remote:[{world:sample(version)}]});
    noFallback(r);assert.equal(r.calls.receive,0);assert.equal(r.dialog,true);
    assert.match(r.dialogTitle,/Локальная копия не читается/);
    assert.ok(r.dialogBody.includes(`data-copy-cloud="${REQUESTED}"`));
    assert.deepEqual(rawLocal,original);
    assert.deepEqual(r.calls.fetch,[{path:version.api+'/'+REQUESTED,method:'GET'}]);
  });

  test(`${version.name}: valid cloud plus mismatched local UUID also preserves the original and offers a separate copy`,async()=>{
    const rawLocal=new Map([[REQUESTED,{id:REQUESTED,world:sample(version,OTHER),revision:1}]]);
    const original=structuredClone(rawLocal);
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,rawLocal,remote:[{world:sample(version)}]});
    noFallback(r);assert.equal(r.calls.receive,0);assert.equal(r.dialog,true);
    assert.ok(r.dialogBody.includes(`data-copy-cloud="${REQUESTED}"`));assert.deepEqual(rawLocal,original);
  });

  test(`${version.name}: local read error after a successful explicit cloud read cannot trigger fallback or overwrite`,async()=>{
    const r=await boot(version,{search:`?world=${REQUESTED}&source=cloud`,locals:[{world:sample(version)}],localReadError:new Error('Storage read failure'),remote:[{world:sample(version)}]});
    noFallback(r);assert.equal(r.calls.receive,0);assert.equal(r.dialog,true);
    assert.ok(r.dialogBody.includes(`data-copy-cloud="${REQUESTED}"`));
    assert.deepEqual(r.calls.fetch,[{path:version.api+'/'+REQUESTED,method:'GET'}]);
  });

  test(`${version.name}: ordinary boot still restores the remembered local world without an explicit selector`,async()=>{
    const r=await boot(version,{locals:[{world:sample(version)},{world:sample(version,OTHER)}],last:OTHER});
    assert.equal(r.state.world.id,OTHER);assert.equal(r.calls.created,0);assert.equal(r.calls.localList,1);
  });

  test(`${version.name}: only ordinary empty boot may create a new random world`,async()=>{
    const r=await boot(version);
    assert.ok(r.state.world);assert.equal(r.calls.created,1);assert.equal(r.calls.put,1);
    assert.equal(r.calls.localList,1);assert.match(r.state.world.id,/^local-/);
  });
}
